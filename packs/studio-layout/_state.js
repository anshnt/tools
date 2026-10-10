// Document store: snapshot undo/redo, change events, assets and IndexedDB persistence.
import * as idb from '../../lib/idb.js'
import { normalizeDoc, containers } from './_model.js'

export class Store {
  constructor(doc) {
    this.doc = doc
    this.version = 0
    this.undoStack = []
    this.redoStack = []
    this.listeners = new Set()
    this.assets = new Map() // id -> {id, name, type, w, h, blob}
    this.unsavedAssets = new Set()
    this.pending = null
    this.last = { key: null, t: 0 }
    this.dirty = false
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit(kind = 'change') {
    this.version++
    if (kind !== 'fonts' && kind !== 'view') this.dirty = true
    for (const fn of [...this.listeners]) fn(kind)
  }
  /** Invalidate layout caches after mutating the doc inside a single exec (used by multi-step commands). */
  bump() { this.version++ }
  snapshot() { return JSON.stringify(this.doc) }
  push(snap) {
    this.undoStack.push(snap)
    if (this.undoStack.length > 120) this.undoStack.shift()
    this.redoStack.length = 0
  }
  /** Run one undoable edit. Edits with the same `key` in quick succession (typing, nudging, sliders) merge into one step. */
  exec(label, fn, { key } = {}) {
    const now = performance.now()
    if (!(key && this.last.key === key && now - this.last.t < 1200)) this.push(this.snapshot())
    this.last = { key: key || null, t: now }
    const r = fn(this.doc)
    this.emit('change')
    return r
  }
  /** Continuous gestures (drag, resize): begin(), mutate doc and call touch(), then commit(). */
  begin() { this.pending = this.snapshot() }
  touch() { this.emit('change') }
  commit() {
    if (this.pending == null) return
    if (this.snapshot() !== this.pending) this.push(this.pending)
    this.pending = null
    this.last.key = null
    this.emit('commit')
  }
  cancel() {
    if (this.pending == null) return
    this.doc = JSON.parse(this.pending)
    this.pending = null
    this.emit('undo')
  }
  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
  undo() {
    if (!this.undoStack.length) return false
    this.redoStack.push(this.snapshot())
    this.doc = JSON.parse(this.undoStack.pop())
    this.last.key = null
    this.emit('undo')
    return true
  }
  redo() {
    if (!this.redoStack.length) return false
    this.undoStack.push(this.snapshot())
    this.doc = JSON.parse(this.redoStack.pop())
    this.last.key = null
    this.emit('undo')
    return true
  }
  /** Replace the whole document (open, new). Clears history. */
  load(doc, assets = new Map()) {
    this.doc = normalizeDoc(doc)
    this.assets = assets
    this.unsavedAssets = new Set()
    this.undoStack = []
    this.redoStack = []
    this.pending = null
    this.dirty = false
    this.emit('load')
    this.dirty = false
  }
  addAsset(a) { this.assets.set(a.id, a); this.unsavedAssets.add(a.id); this.emit('assets') }
}

// ---------- Persistence ----------
const PK = 'layout-studio:project:'
const AK = 'layout-studio:asset:'
export const LAST_KEY = 'layout-studio:last'

export async function saveProject(store, thumb) {
  const doc = store.doc, assets = store.assets
  const used = new Set(containers(doc).flatMap(({ c }) => c.items.map((i) => i.asset).filter(Boolean)))
  const ids = [...used].filter((id) => assets.has(id))
  for (const id of ids) {
    if (!store.unsavedAssets.has(id)) continue
    if (await idb.set(`${AK}${doc.id}:${id}`, assets.get(id))) store.unsavedAssets.delete(id)
  }
  const rec = { id: doc.id, name: doc.name, updated: Date.now(), pages: doc.pages.length, doc, assetIds: ids, thumb: thumb || null }
  return idb.set(PK + doc.id, rec)
}
export async function loadProject(id) {
  const rec = await idb.get(PK + id)
  if (!rec?.doc) return null
  const assets = new Map()
  for (const aid of rec.assetIds || []) {
    const a = await idb.get(`${AK}${id}:${aid}`)
    if (a) assets.set(aid, a)
  }
  return { doc: rec.doc, assets }
}
export async function listProjects() {
  const out = []
  for (const k of await idb.keys(PK)) {
    const r = await idb.get(k)
    if (r) out.push({ id: r.id, name: r.name, updated: r.updated, pages: r.pages, thumb: r.thumb })
  }
  return out.sort((a, b) => b.updated - a.updated)
}
export async function deleteProject(id) {
  const rec = await idb.get(PK + id)
  for (const aid of rec?.assetIds || []) await idb.del(`${AK}${id}:${aid}`)
  return idb.del(PK + id)
}
export const getPointer = (key = LAST_KEY) => idb.get(key)
export const setPointer = (id, key = LAST_KEY) => idb.set(key, id)
