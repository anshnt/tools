// Project store: the document, undo/redo history, selection, playhead, image assets and IndexedDB autosave.
// Every document change goes through edit() (one undo step) or begin() / mutate() / end() (a drag = one undo step).
import * as idb from '../../lib/idb.js'
import { loadImage, isHeic, heicToBlob } from '../../lib/image.js'
import { readDataURL } from '../../lib/files.js'
import { debounce } from '../../lib/ui.js'
import { uid, clamp } from './_anim.js'
import { sanitizeDoc, allLayers, walk } from './_model.js'

const HISTORY_MAX = 150

export function createStore({ key, makeInitial }) {
  const listeners = new Set()
  const s = {
    doc: makeInitial(),
    assets: new Map(), // id -> {id, name, blob, img, w, h}
    sel: [], // selected layer ids
    kfSel: new Set(), // selected keyframe ids
    time: 0,
    undoStack: [],
    redoStack: [],
    clip: [], // copied layers
    txn: null,
    lastMerge: null,
    lastAt: 0,
    onSaved: null,
    cur: '',

    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    emit(type) { for (const fn of [...listeners]) fn(type) },

    get comp() { return this.doc.comp },
    get frames() { return Math.max(1, Math.round(this.doc.comp.duration * this.doc.comp.fps)) },
    /** Last frame time, so the playhead never sits past the final frame. */
    get endTime() { return (this.frames - 1) / this.doc.comp.fps },
    snapTime(t) { const f = this.doc.comp.fps; return clamp(Math.round(t * f) / f, 0, Math.max(this.endTime, 0)) },
    setTime(t, snap = true) {
      const v = snap ? this.snapTime(t) : clamp(t, 0, this.doc.comp.duration)
      if (v === this.time) return
      this.time = v
      this.emit('time')
    },

    // ----- history -----
    begin(label, merge) { if (!this.txn) this.txn = { label, merge, before: this.cur } },
    /** Apply a change inside begin()/end() (e.g. while dragging) without adding history. */
    mutate(fn) { fn(this.doc); this.emit('doc') },
    end() {
      const txn = this.txn
      this.txn = null
      if (!txn) return false
      const after = JSON.stringify(this.doc)
      if (after === txn.before) return false
      const now = performance.now()
      if (txn.merge && txn.merge === this.lastMerge && now - this.lastAt < 800 && this.undoStack.length) { /* keep the first snapshot of this run of edits */ }
      else {
        this.undoStack.push({ label: txn.label, json: txn.before })
        if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift()
      }
      this.redoStack.length = 0
      this.lastMerge = txn.merge || null
      this.lastAt = now
      this.cur = after
      this.emit('doc')
      this.emit('history')
      save()
      return true
    },
    /** One undoable edit. merge: a key; consecutive edits with the same key within 0.8 s share one undo step (sliders, typing). */
    edit(label, fn, merge) {
      this.begin(label, merge)
      fn(this.doc)
      return this.end()
    },
    setDoc(json) {
      this.cur = json
      this.doc = JSON.parse(json)
      this.lastMerge = null
      this.prune()
      this.time = clamp(this.time, 0, Math.max(0, this.endTime))
      this.emit('doc')
      this.emit('history')
      save()
    },
    undo() {
      const e = this.undoStack.pop()
      if (!e) return null
      this.redoStack.push({ label: e.label, json: this.cur })
      this.setDoc(e.json)
      return e.label
    },
    redo() {
      const e = this.redoStack.pop()
      if (!e) return null
      this.undoStack.push({ label: e.label, json: this.cur })
      this.setDoc(e.json)
      return e.label
    },
    /** Drop selections that no longer exist. */
    prune() {
      const ids = new Set(), kfs = new Set()
      walk(this.doc.layers, (L) => {
        ids.add(L.id)
        const ps = [...Object.values(L.props), ...L.effects.flatMap((e) => Object.values(e.params)), ...(L.animators || []).flatMap((a) => Object.values(a.props))]
        for (const p of ps) for (const k of p.k || []) kfs.add(k.id)
      })
      const sel = this.sel.filter((i) => ids.has(i))
      if (sel.length !== this.sel.length) { this.sel = sel; this.emit('select') }
      for (const k of [...this.kfSel]) if (!kfs.has(k)) this.kfSel.delete(k)
    },

    // ----- selection -----
    select(ids, additive = false) {
      const next = additive ? [...new Set([...this.sel, ...ids])] : [...ids]
      if (next.length === this.sel.length && next.every((x, i) => x === this.sel[i])) return
      this.sel = next
      this.kfSel.clear()
      this.emit('select')
    },
    toggle(id) { this.select(this.sel.includes(id) ? this.sel.filter((x) => x !== id) : [...this.sel, id]) },
    selectKeys(ids, additive = false) {
      if (!additive) this.kfSel.clear()
      for (const i of ids) { additive && this.kfSel.has(i) ? this.kfSel.delete(i) : this.kfSel.add(i) }
      this.emit('keys')
    },
    get selected() { return this.sel.map((id) => allLayers(this.doc).find((l) => l.id === id)).filter(Boolean) },

    // ----- project / assets -----
    /** Replace the whole project (new, open, restore). */
    load(doc, assets = []) {
      this.doc = doc
      this.assets = new Map(assets.map((a) => [a.id, a]))
      this.cur = JSON.stringify(doc)
      this.undoStack = []; this.redoStack = []; this.lastMerge = null; this.txn = null
      this.sel = []; this.kfSel.clear(); this.time = 0
      this.emit('assets'); this.emit('doc'); this.emit('select'); this.emit('history'); this.emit('time')
      save()
    },
    async addAsset(file) {
      let blob = file
      if (isHeic(file)) blob = await heicToBlob(file)
      const a = await decodeAsset({ id: uid('a'), name: file.name || 'image', blob })
      this.assets.set(a.id, a)
      this.emit('assets')
      return a
    },
    async saveNow() {
      const used = new Set(allLayers(this.doc).filter((l) => l.type === 'image').map((l) => l.data.asset))
      const assets = [...this.assets.values()].filter((a) => used.has(a.id)).map(({ id, name, blob }) => ({ id, name, blob }))
      const ok = await idb.set(key, { v: 1, doc: this.doc, assets, time: this.time, savedAt: Date.now() })
      this.onSaved?.(ok)
      return ok
    },
    async restore() {
      const r = await idb.get(key)
      if (!r?.doc) return false
      try {
        const doc = sanitizeDoc(r.doc)
        const assets = []
        for (const a of r.assets || []) { try { assets.push(await decodeAsset(a)) } catch { /* skip an unreadable image */ } }
        this.load(doc, assets)
        this.time = clamp(+r.time || 0, 0, Math.max(0, this.endTime))
        this.emit('time')
        return true
      } catch { return false }
    },
    async clearSaved() { await idb.del(key) },

    /** Project file: JSON with images embedded as data URLs. */
    async toProjectBlob() {
      const used = new Set(allLayers(this.doc).filter((l) => l.type === 'image').map((l) => l.data.asset))
      const assets = []
      for (const a of this.assets.values()) if (used.has(a.id)) assets.push({ id: a.id, name: a.name, data: await readDataURL(a.blob) })
      return new Blob([JSON.stringify({ format: 'motion-studio', version: 1, doc: this.doc, assets })], { type: 'application/json' })
    },
    async fromProjectText(text) {
      let raw
      try { raw = JSON.parse(text) } catch { throw new Error('This file is not valid JSON, so it cannot be a Motion Studio project.') }
      if (raw?.format !== 'motion-studio') throw new Error('This file is not a Motion Studio project.')
      const doc = sanitizeDoc(raw.doc)
      const assets = []
      for (const a of raw.assets || []) {
        if (typeof a?.data !== 'string' || !a.data.startsWith('data:')) continue
        try { assets.push(await decodeAsset({ id: a.id, name: a.name, blob: await (await fetch(a.data)).blob() })) } catch { /* skip */ }
      }
      this.load(doc, assets)
    },
  }
  s.cur = JSON.stringify(s.doc)
  const save = debounce(() => s.saveNow(), 900)
  return s
}

async function decodeAsset({ id, name, blob }) {
  const img = await loadImage(blob)
  const w = img.naturalWidth || 512, h = img.naturalHeight || 512
  return { id, name, blob, img, w, h }
}
