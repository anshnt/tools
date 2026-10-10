// Document model for CAD Studio: entities, layers, settings and an undo/redo history. No DOM.
// All edits go through Doc.commit(label, tx => ...). Entities are never mutated; a commit swaps in a new state object,
// so every history step is just a pointer to an earlier state (untouched entities are shared).
import { emptyBox, unionBox, boxValid } from './_vec.js'
import { bbox } from './_ent.js'

export const UNITS = {
  mm: { name: 'Millimetres', short: 'mm', mm: 1, insunits: 4 },
  cm: { name: 'Centimetres', short: 'cm', mm: 10, insunits: 5 },
  m: { name: 'Metres', short: 'm', mm: 1000, insunits: 6 },
  in: { name: 'Inches', short: 'in', mm: 25.4, insunits: 1 },
  ft: { name: 'Feet', short: 'ft', mm: 304.8, insunits: 2 },
}

/** Dash patterns in drawing units at LTSCALE 1 (alternating dash and gap lengths). */
export const LTYPES = {
  continuous: { name: 'Continuous', dash: [] },
  dashed: { name: 'Dashed', dash: [12, 6] },
  hidden: { name: 'Hidden', dash: [6, 3] },
  center: { name: 'Center', dash: [24, 4, 4, 4] },
  phantom: { name: 'Phantom', dash: [24, 4, 4, 4, 4, 4] },
  dot: { name: 'Dotted', dash: [1, 4] },
  dashdot: { name: 'Dash dot', dash: [12, 4, 1, 4] },
}

export const LINEWEIGHTS = [0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0, 1.4, 2.0]

/** Layer colour choices. White (#ffffff) means "black on a light canvas, white on a dark one". */
export const PALETTE = [
  ['#ffffff', 'White / black'], ['#e5484d', 'Red'], ['#f76b15', 'Orange'], ['#f5a524', 'Yellow'], ['#30a46c', 'Green'],
  ['#12a594', 'Cyan'], ['#3e63dd', 'Blue'], ['#8e4ec6', 'Magenta'], ['#7d8590', 'Grey'],
]

/** Starter sizes that make sense for the chosen unit. */
export function defaultsFor(units) {
  if (units === 'mm') return { gridStep: 10, textH: 2.5, dimTh: 2.5, dimAs: 2.5, hatchScale: 1, ltscale: 1 }
  if (units === 'cm') return { gridStep: 1, textH: 0.25, dimTh: 0.25, dimAs: 0.25, hatchScale: 0.1, ltscale: 0.1 }
  if (units === 'm') return { gridStep: 0.5, textH: 0.1, dimTh: 0.1, dimAs: 0.1, hatchScale: 0.01, ltscale: 0.01 }
  if (units === 'ft') return { gridStep: 1, textH: 0.25, dimTh: 0.25, dimAs: 0.25, hatchScale: 0.03, ltscale: 0.03 }
  return { gridStep: 0.5, textH: 0.1, dimTh: 0.1, dimAs: 0.1, hatchScale: 0.04, ltscale: 0.04 }
}

export const newLayer = (name, o = {}) => ({ name, color: '#ffffff', ltype: 'continuous', lw: 0.25, visible: true, locked: false, ...o })

export function blankState(units = 'mm') {
  return {
    ents: [],
    layers: [newLayer('0'), newLayer('Dimensions', { color: '#12a594' }), newLayer('Hidden', { color: '#8e4ec6', ltype: 'dashed' }), newLayer('Centre', { color: '#e5484d', ltype: 'center' })],
    settings: { units, prec: 2, dimPr: 2, ...defaultsFor(units) },
    nextId: 1,
  }
}

class Tx {
  constructor(state) {
    this.ents = state.ents.slice()
    this.layers = state.layers
    this.settings = state.settings
    this.nextId = state.nextId
    this.dirty = false
    this.index = null
    this.added = []
    this.gone = new Set()
  }
  idx() {
    if (!this.index) { this.index = new Map(); this.ents.forEach((e, i) => e && this.index.set(e.id, i)) }
    return this.index
  }
  get(id) { const i = this.idx().get(id); return i === undefined ? undefined : this.ents[i] }
  /** Add an entity (id is assigned). Returns the stored entity. */
  add(e) {
    const ent = { ...e, id: this.nextId++ }
    for (const k of Object.keys(ent)) if (ent[k] === undefined) delete ent[k]
    this.ents.push(ent)
    if (this.index) this.index.set(ent.id, this.ents.length - 1)
    this.added.push(ent)
    this.dirty = true
    return ent
  }
  /** Replace entity id with obj (or fn(old) -> new). Keeps the id. */
  replace(id, fnOrObj) {
    const i = this.idx().get(id)
    if (i === undefined) return null
    const old = this.ents[i]
    const next = { ...(typeof fnOrObj === 'function' ? fnOrObj(old) : fnOrObj), id }
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    this.ents[i] = next
    this.dirty = true
    return next
  }
  remove(ids) {
    for (const id of [].concat(ids)) {
      const i = this.idx().get(id)
      if (i === undefined) continue
      this.ents[i] = null
      this.gone.add(id)
      this.dirty = true
    }
  }
  setLayers(layers) { this.layers = layers; this.dirty = true }
  setSettings(patch) { this.settings = { ...this.settings, ...patch }; this.dirty = true }
  finish() { return { ents: this.ents.filter(Boolean), layers: this.layers, settings: this.settings, nextId: this.nextId } }
}

const MAX_HISTORY = 300

export class Doc {
  constructor(state) {
    this.state = state || blankState()
    this.undoStack = []
    this.redoStack = []
    this.listeners = new Set()
    this.name = 'Untitled'
    this.indexCache = new WeakMap()
    this.extCache = new WeakMap()
  }
  get ents() { return this.state.ents }
  get layers() { return this.state.layers }
  get settings() { return this.state.settings }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit(kind, label) { for (const fn of this.listeners) fn(kind, label) }

  /** Apply fn(tx) as ONE undo step. Returns the transaction's added entities, or null if nothing changed. */
  commit(label, fn) {
    const tx = new Tx(this.state)
    fn(tx)
    if (!tx.dirty) return null
    this.undoStack.push({ label, state: this.state })
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack = []
    this.state = tx.finish()
    this.emit('commit', label)
    return tx.added
  }
  canUndo() { return this.undoStack.length > 0 }
  canRedo() { return this.redoStack.length > 0 }
  undo() {
    const s = this.undoStack.pop()
    if (!s) return null
    this.redoStack.push({ label: s.label, state: this.state })
    this.state = s.state
    this.emit('undo', s.label)
    return s.label
  }
  redo() {
    const s = this.redoStack.pop()
    if (!s) return null
    this.undoStack.push({ label: s.label, state: this.state })
    this.state = s.state
    this.emit('redo', s.label)
    return s.label
  }
  /** Replace the whole drawing (open, new). History is cleared. */
  load(state, name) {
    this.state = state
    this.undoStack = []
    this.redoStack = []
    if (name) this.name = name
    this.emit('load')
  }

  byId(id) {
    let m = this.indexCache.get(this.state)
    if (!m) { m = new Map(this.state.ents.map((e) => [e.id, e])); this.indexCache.set(this.state, m) }
    return m.get(id)
  }
  layer(name) { return this.state.layers.find((l) => l.name === name) || this.state.layers[0] }
  isVisible(e) { return this.layer(e.layer).visible }
  isLocked(e) { return this.layer(e.layer).locked }
  /** Entities on visible layers. */
  visible() { const vis = new Set(this.state.layers.filter((l) => l.visible).map((l) => l.name)); return this.state.ents.filter((e) => vis.has(e.layer) || !this.state.layers.some((l) => l.name === e.layer)) }

  /** Effective colour, linetype and lineweight of an entity (ByLayer resolved). */
  style(e) {
    const l = this.layer(e.layer)
    return { color: e.color || l.color, ltype: e.ltype || l.ltype, lw: e.lw ?? l.lw }
  }

  /** Bounding box of everything visible, or null for an empty drawing. */
  extents() {
    let b = this.extCache.get(this.state)
    if (b === undefined) {
      b = emptyBox()
      for (const e of this.visible()) b = unionBox(b, bbox(e))
      b = boxValid(b) ? b : null
      this.extCache.set(this.state, b)
    }
    return b
  }

  toJSON(extra = {}) {
    const s = this.state
    return { format: 'cad-studio', version: 1, name: this.name, settings: s.settings, layers: s.layers, nextId: s.nextId, ents: s.ents, ...extra }
  }
}

/** Build a state from saved JSON (validates enough to avoid crashing the renderer). */
export function stateFromJSON(j) {
  if (!j || j.format !== 'cad-studio' || !Array.isArray(j.ents)) throw Object.assign(new Error('That file is not a CAD Studio drawing.'), { userMessage: 'That file is not a CAD Studio drawing.' })
  const base = blankState(j.settings?.units || 'mm')
  const layers = Array.isArray(j.layers) && j.layers.length ? j.layers.map((l) => newLayer(String(l.name), l)) : base.layers
  if (!layers.some((l) => l.name === '0')) layers.unshift(newLayer('0'))
  let nextId = 1
  const ents = j.ents.filter((e) => e && typeof e.type === 'string').map((e) => { const id = Number.isFinite(e.id) ? e.id : nextId; nextId = Math.max(nextId, id + 1); return { ...e, id, layer: e.layer ?? '0' } })
  return { ents, layers, settings: { ...base.settings, ...j.settings }, nextId: Math.max(nextId, j.nextId || 1) }
}

/** Display colour on the current canvas: white/black swap, and washed-out colours are darkened on a light canvas. */
export function shade(hex, darkBg) {
  const h = String(hex || '#ffffff').toLowerCase()
  if (h === '#ffffff' || h === '#fff') return darkBg ? '#f2f2f7' : '#17171c'
  if (h === '#000000' || h === '#000') return darkBg ? '#f2f2f7' : '#17171c'
  const m = /^#([0-9a-f]{6})$/.exec(h)
  if (!m) return h
  const n = parseInt(m[1], 16)
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (!darkBg && lum > 0.7) { r *= 0.68; g *= 0.68; b *= 0.68 }
  else if (darkBg && lum < 0.28) { r = r + (255 - r) * 0.5; g = g + (255 - g) * 0.5; b = b + (255 - b) * 0.5 }
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}
