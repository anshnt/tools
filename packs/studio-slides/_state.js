// Document store: the deck, image assets, selection, undo/redo history and autosave to IndexedDB.
// Every edit is a command that runs through edit() or begin()/end(), so it is one undo step.
import * as idb from '../../lib/idb.js'
import { jszip } from '../../lib/libs.js'
import { loadImage, toCanvas, toBlob } from '../../lib/image.js'
import { normalizeDeck, uid, clone } from './_model.js'
import { newSlide } from './_themes.js'

const MAX_IMG = 2400
const MAX_HISTORY = 120
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export class Store {
  constructor(ns = 'main') {
    this.ns = ns
    this.key = `slides-studio:${ns}`
    this.deck = normalizeDeck({})
    this.assets = new Map() // id -> { id, blob, type, w, h, name, url? }
    this.cur = 0
    this.sel = []
    this.undo = []
    this.redo = []
    this.listeners = new Set()
    this.saveState = 'saved' // saved | saving | unsaved
    this._timer = 0
    this._saving = Promise.resolve()
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit(type, detail = {}) { for (const fn of [...this.listeners]) fn(type, detail) }

  get slide() { return this.deck.slides[this.cur] }
  get selected() { const s = this.slide; return s ? s.elements.filter((e) => this.sel.includes(e.id)) : [] }
  snapshot() { return JSON.stringify(this.deck) }

  // ----- history -----
  /** Run fn(deck) as one undo step. what: 'slide' (current slide content), 'deck' (structure, theme, size) or 'meta'. */
  edit(label, fn, what = 'slide', merge = false) {
    const before = this.snapshot()
    fn(this.deck, this)
    return this.end(before, label, what, merge)
  }
  begin() { return this.snapshot() }
  /** Finish a gesture started with begin(): records history if anything changed. */
  end(before, label, what = 'slide', merge = false) {
    if (this.snapshot() === before) return false
    const last = this.undo.at(-1)
    if (merge && last && last.label === label && last.cur === this.cur && Date.now() - last.t < 900) last.t = Date.now()
    else this.undo.push({ s: before, label, cur: this.cur, sel: [...this.sel], t: Date.now() })
    if (this.undo.length > MAX_HISTORY) this.undo.shift()
    this.redo.length = 0
    this.changed(what)
    return true
  }
  changed(what = 'slide') {
    this.cur = Math.max(0, Math.min(this.cur, this.deck.slides.length - 1))
    const ids = new Set(this.slide?.elements.map((e) => e.id))
    this.sel = this.sel.filter((id) => ids.has(id))
    this.emit('change', { what })
    this.scheduleSave()
  }
  get canUndo() { return this.undo.length > 0 }
  get canRedo() { return this.redo.length > 0 }
  _restore(rec, label) {
    this.deck = normalizeDeck(JSON.parse(rec.s))
    this.cur = Math.min(rec.cur, this.deck.slides.length - 1)
    this.sel = rec.sel.filter((id) => this.slide?.elements.some((e) => e.id === id))
    this.emit('change', { what: 'deck', restored: label })
    this.scheduleSave()
  }
  undoStep() {
    const rec = this.undo.pop()
    if (!rec) return
    this.redo.push({ s: this.snapshot(), label: rec.label, cur: this.cur, sel: [...this.sel] })
    this._restore(rec, `Undo ${rec.label}`)
  }
  redoStep() {
    const rec = this.redo.pop()
    if (!rec) return
    this.undo.push({ s: this.snapshot(), label: rec.label, cur: this.cur, sel: [...this.sel] })
    this._restore(rec, `Redo ${rec.label}`)
  }

  // ----- selection and navigation -----
  select(ids) {
    const next = [...new Set(ids)]
    if (next.length === this.sel.length && next.every((x, i) => x === this.sel[i])) return
    this.sel = next
    this.emit('sel')
  }
  goto(i) {
    i = Math.max(0, Math.min(this.deck.slides.length - 1, i))
    if (i === this.cur) return
    this.cur = i
    this.sel = []
    this.emit('slide')
  }

  // ----- slide commands -----
  addSlide(layout = 'title-content', at = this.cur + 1, content) {
    this.edit('Add slide', (d) => { d.slides.splice(at, 0, newSlide(d, layout, content)) }, 'deck')
    this.cur = Math.min(at, this.deck.slides.length - 1)
    this.sel = []
    this.emit('slide')
  }
  duplicateSlide(i = this.cur) {
    this.edit('Duplicate slide', (d) => {
      const copy = clone(d.slides[i])
      copy.id = uid('s')
      for (const e of copy.elements) e.id = uid()
      d.slides.splice(i + 1, 0, copy)
    }, 'deck')
    this.cur = i + 1
    this.sel = []
    this.emit('slide')
  }
  deleteSlide(i = this.cur) {
    if (this.deck.slides.length <= 1) {
      this.edit('Clear slide', (d) => { d.slides[0] = newSlide(d, 'blank') }, 'deck')
      return
    }
    this.edit('Delete slide', (d) => { d.slides.splice(i, 1) }, 'deck')
    this.cur = Math.min(i, this.deck.slides.length - 1)
    this.sel = []
    this.emit('slide')
  }
  moveSlide(from, to) {
    if (from === to || to < 0 || to >= this.deck.slides.length) return
    this.edit('Move slide', (d) => { const [s] = d.slides.splice(from, 1); d.slides.splice(to, 0, s) }, 'deck')
    this.cur = to
    this.emit('slide')
  }

  // ----- assets -----
  asset(id) { return this.assets.get(id) }
  assetUrl(id) {
    const a = this.assets.get(id)
    if (!a) return ''
    return (a.url ||= URL.createObjectURL(a.blob))
  }
  /** Decode, downscale if huge, and keep as PNG or JPEG so PowerPoint can open it. Returns the asset id. */
  async addImageFile(file) {
    const a = await prepareImage(file)
    this.assets.set(a.id, a)
    return a.id
  }
  async dataUrl(id) {
    const a = this.assets.get(id)
    if (!a) return ''
    if (!a.data) a.data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(a.blob) })
    return a.data
  }
  usedAssets() {
    const ids = new Set()
    for (const s of this.deck.slides) for (const e of s.elements) if (e.asset) ids.add(e.asset)
    return [...ids].filter((id) => this.assets.has(id))
  }

  /** Swap in a whole new deck as one undo step (New, Open, Import). Image assets are added, never removed, so undo can bring them back. */
  replace(deck, assets = [], label = 'Replace deck') {
    const before = this.snapshot()
    for (const a of assets) this.assets.set(a.id, { ...a })
    this.deck = normalizeDeck(deck)
    if (!this.deck.slides.length) this.deck.slides.push(newSlide(this.deck, 'title'))
    this.cur = 0
    this.sel = []
    this.undo.push({ s: before, label, cur: 0, sel: [], t: Date.now() })
    this.redo.length = 0
    this.changed('deck')
  }

  // ----- load / save -----
  /** Replace the whole document (open, import, new). Clears history. */
  load(deck, assets = []) {
    for (const a of this.assets.values()) if (a.url) URL.revokeObjectURL(a.url)
    this.deck = normalizeDeck(deck)
    if (!this.deck.slides.length) this.deck.slides.push(newSlide(this.deck, 'title'))
    this.assets = new Map(assets.map((a) => [a.id, { ...a }]))
    this.cur = 0
    this.sel = []
    this.undo = []
    this.redo = []
    this.emit('change', { what: 'deck', loaded: true })
    this.scheduleSave()
  }
  scheduleSave() {
    this.saveState = 'unsaved'
    this.emit('save')
    clearTimeout(this._timer)
    this._timer = setTimeout(() => this.save(), 900)
  }
  async save() {
    clearTimeout(this._timer)
    this.saveState = 'saving'
    this.emit('save')
    const payload = {
      v: 1, savedAt: Date.now(), deck: clone(this.deck),
      assets: this.usedAssets().map((id) => { const { blob, type, w, h, name } = this.assets.get(id); return { id, blob, type, w, h, name } }),
    }
    this._saving = this._saving.then(() => idb.set(this.key, payload)).then((ok) => { this.saveState = ok ? 'saved' : 'failed'; this.emit('save') })
    return this._saving
  }
  async restore() {
    const rec = await idb.get(this.key)
    if (!rec?.deck?.slides?.length) return false
    this.deck = normalizeDeck(rec.deck)
    this.assets = new Map((rec.assets || []).filter((a) => a.blob).map((a) => [a.id, { ...a }]))
    this.cur = 0
    this.sel = []
    this.undo = []
    this.redo = []
    this.saveState = 'saved'
    return true
  }
  dispose() {
    clearTimeout(this._timer)
    for (const a of this.assets.values()) if (a.url) URL.revokeObjectURL(a.url)
    this.listeners.clear()
  }

  // ----- project file: ZIP with deck.json and assets/ -----
  async exportProject() {
    const JSZip = await jszip()
    const z = new JSZip()
    z.file('deck.json', JSON.stringify({ app: 'slides-studio', v: 1, deck: this.deck, assets: this.usedAssets().map((id) => { const a = this.assets.get(id); return { id, type: a.type, w: a.w, h: a.h, name: a.name } }) }))
    for (const id of this.usedAssets()) { const a = this.assets.get(id); z.file(`assets/${id}.${EXT[a.type] || 'bin'}`, a.blob) }
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  }
  async importProject(file) {
    const JSZip = await jszip()
    let zip
    try { zip = await JSZip.loadAsync(file) } catch { throw new Error('That file is not a Slides Studio project.') }
    const entry = zip.file('deck.json')
    if (!entry) throw new Error('That ZIP has no deck.json, so it is not a Slides Studio project.')
    let doc
    try { doc = JSON.parse(await entry.async('string')) } catch { throw new Error('The project file is damaged (deck.json is not valid).') }
    if (!doc?.deck?.slides) throw new Error('The project file has no slides in it.')
    const assets = []
    for (const meta of doc.assets || []) {
      const f = zip.file(new RegExp(`^assets/${meta.id}\\.`))[0]
      if (f) assets.push({ ...meta, blob: new Blob([await f.async('arraybuffer')], { type: meta.type }) })
    }
    return { deck: doc.deck, assets }
  }
}

/** Decode an image file and return an asset { id, blob, type, w, h, name } that PowerPoint can open (PNG or JPEG, at most 2400 px). */
export async function prepareImage(file) {
  const img = await loadImage(file)
  let w = img.naturalWidth || 1200, h = img.naturalHeight || 800
  const type = (file.type || '').toLowerCase()
  let blob = file, outType = type
  const keep = (type === 'image/png' || type === 'image/jpeg') && Math.max(w, h) <= MAX_IMG
  if (!keep) {
    const k = type === 'image/svg+xml' ? Math.min(8, 1600 / Math.max(w, h)) : Math.min(1, MAX_IMG / Math.max(w, h))
    const c = toCanvas(img, Math.round(w * k), Math.round(h * k))
    // graphics (PNG, SVG, GIF, BMP) stay lossless; photos (JPEG, WebP, AVIF, HEIC) become JPEG unless they have transparency
    const graphic = ['image/svg+xml', 'image/gif', 'image/bmp', 'image/png'].includes(type)
    outType = !graphic && (type === 'image/jpeg' || !hasAlpha(c)) ? 'image/jpeg' : 'image/png'
    blob = await toBlob(c, outType, 0.9)
    w = c.width
    h = c.height
  }
  return { id: uid('i'), blob, type: outType, w, h, name: file.name || 'image' }
}

function hasAlpha(c) {
  const s = toCanvas(c, Math.min(64, c.width), Math.min(64, c.height))
  const d = s.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, s.width, s.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true
  return false
}
