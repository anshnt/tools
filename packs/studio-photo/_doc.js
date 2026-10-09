// Document model: layers, selection, history. Every edit goes through the doc so undo/redo always works.
// Two kinds of history entries: structural snapshots (cheap, shallow copies of layer fields; nested objects are treated as immutable)
// and pixel patches (the previous pixels of the edited rectangle, swapped on undo/redo).
import { cv, rctx, uid, rectIntersect, copyCanvas, rectOut } from './_util.js'
import { selCanvas } from './_select.js'
import { adjustDefaults, ADJUSTMENTS } from './_adjust.js'
import { renderDoc, layerBounds } from './_render.js'

export const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'],
  ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'],
  ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']]

export function mkLayer(type, o = {}) {
  return { id: uid(), type, name: 'Layer', visible: true, locked: false, opacity: 1, blend: 'source-over', x: 0, y: 0, canvas: null, mask: null, maskOn: true, text: null, shape: null, adjust: null, bg: false, v: 0, ...o }
}
export const rasterLayer = (w, h, name = 'Layer', o = {}) => mkLayer('raster', { name, canvas: cv(w, h), ...o })
export const textLayer = (t, name) => mkLayer('text', { name: name || String(t.text).split('\n')[0].slice(0, 24) || 'Text', text: { ...DEFAULT_TEXT, ...t } })
export const shapeLayer = (s, name) => mkLayer('shape', { name: name || 'Shape', shape: { ...DEFAULT_SHAPE, ...s } })
export const adjustLayer = (kind, params) => mkLayer('adjust', { name: ADJUSTMENTS[kind].name, adjust: { kind, params: params || adjustDefaults(kind) } })

export const DEFAULT_TEXT = { text: 'Text', font: 'Geist', size: 72, color: '#111111', bold: false, italic: false, align: 'left', lineHeight: 1.2, x: 0, y: 0, strokeW: 0, strokeColor: '#ffffff', shadow: false }
export const DEFAULT_SHAPE = { kind: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#5b4cf0', hasFill: true, stroke: '#111111', strokeW: 0, radius: 0, sides: 5 }

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)))

/** Make sure a raster layer's canvas covers a doc-space rectangle (it only ever grows). */
export function cover(L, r) {
  const c = L.canvas
  const x0 = Math.min(L.x, r.x), y0 = Math.min(L.y, r.y), x1 = Math.max(L.x + c.width, r.x + r.w), y1 = Math.max(L.y + c.height, r.y + r.h)
  if (x0 === L.x && y0 === L.y && x1 === L.x + c.width && y1 === L.y + c.height) return
  const n = cv(x1 - x0, y1 - y0)
  rctx(n).drawImage(c, L.x - x0, L.y - y0)
  L.canvas = n; L.x = x0; L.y = y0
}

function grab(c, r) {
  const n = cv(r.w, r.h)
  rctx(n).drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return n
}

export function xformCanvas(c, op) {
  const w = c.width, h = c.height
  const n = op === 'cw' || op === 'ccw' ? cv(h, w) : cv(w, h), x = rctx(n)
  if (op === 'cw') { x.translate(h, 0); x.rotate(Math.PI / 2) } else if (op === 'ccw') { x.translate(0, w); x.rotate(-Math.PI / 2) }
  else if (op === '180') { x.translate(w, h); x.rotate(Math.PI) } else if (op === 'fh') { x.translate(w, 0); x.scale(-1, 1) } else { x.translate(0, h); x.scale(1, -1) }
  x.drawImage(c, 0, 0)
  return n
}
function xformRect(r, op, W, H) {
  if (op === 'cw') return { x: H - (r.y + r.h), y: r.x, w: r.h, h: r.w }
  if (op === 'ccw') return { x: r.y, y: W - (r.x + r.w), w: r.h, h: r.w }
  if (op === '180') return { x: W - (r.x + r.w), y: H - (r.y + r.h), w: r.w, h: r.h }
  if (op === 'fh') return { x: W - (r.x + r.w), y: r.y, w: r.w, h: r.h }
  return { x: r.x, y: H - (r.y + r.h), w: r.w, h: r.h }
}

class History {
  constructor(doc, cap = 420e6) { this.doc = doc; this.list = []; this.i = 0; this.cap = cap; this.dropped = 0 }
  get bytes() { return this.list.reduce((s, e) => s + e.bytes, 0) }
  get top() { return this.list[this.list.length - 1] }
  push(e) {
    this.list.length = this.i
    e.t = Date.now()
    this.list.push(e)
    while (this.list.length > 1 && (this.bytes > this.cap || this.list.length > 200)) { this.list.shift(); this.dropped++ }
    this.i = this.list.length
    this.doc.emit('history')
  }
  undo() { if (this.i > 0) { this.list[--this.i].undo(); this.doc.emit('all') } }
  redo() { if (this.i < this.list.length) { this.list[this.i++].redo(); this.doc.emit('all') } }
  jump(n) { while (this.i > n) this.undo(); while (this.i < n) this.redo() }
  get canUndo() { return this.i > 0 }
  get canRedo() { return this.i < this.list.length }
}

export class Doc {
  constructor(w, h, name = 'Untitled') {
    this.w = w; this.h = h; this.name = name
    this.layers = []; this.activeId = null; this.editMask = false; this.sel = null
    this.subs = new Set(); this.hist = new History(this)
    this.bgColor = '#ffffff'
  }

  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn) }
  emit(what, extra = {}) { for (const fn of [...this.subs]) fn({ what, ...extra }) }

  get active() { return this.layers.find((l) => l.id === this.activeId) || null }
  get target() { return this.editMask && this.active?.mask ? 'mask' : 'layer' }
  layer(id) { return this.layers.find((l) => l.id === id) || null }
  index(id) { return this.layers.findIndex((l) => l.id === id) }

  // ----- snapshots -----
  snap() { return { w: this.w, h: this.h, layers: this.layers.map((l) => [l, { ...l }]), activeId: this.activeId, editMask: this.editMask, sel: this.sel } }
  restore(s) {
    this.w = s.w; this.h = s.h
    for (const [l, st] of s.layers) Object.assign(l, st)
    this.layers = s.layers.map((p) => p[0]); this.activeId = s.activeId; this.editMask = s.editMask; this.sel = s.sel
  }
  /** Run fn as one undoable step. opts.key merges rapid repeats (sliders, drags) into one entry; opts.quiet emits a narrower event. */
  tx(label, fn, opts = {}) {
    const before = this.snap()
    const res = fn()
    const after = this.snap()
    const top = this.hist.top
    if (opts.key && top && top.key === opts.key && this.hist.i === this.hist.list.length && Date.now() - top.t < 1500) {
      top.redo = () => this.restore(after); top.t = Date.now(); top.after = after
    } else {
      const canv = (s) => new Set(s.layers.flatMap(([, st]) => [st.canvas, st.mask?.canvas]).filter(Boolean))
      const cb = canv(before), ca = canv(after)
      let bytes = 2000
      for (const c of cb) if (!ca.has(c)) bytes += c.width * c.height * 4
      for (const c of ca) if (!cb.has(c)) bytes += c.width * c.height * 4
      this.hist.push({ label, key: opts.key, bytes, undo: () => this.restore(before), redo: () => this.restore(after), after })
    }
    this.emit(opts.quiet || 'all')
    return res
  }

  // ----- pixel edits with patch undo -----
  /**
   * Edit pixels of a layer or its mask inside a doc-space rectangle. fn(ctx, r) draws on the target canvas; r is the rect in canvas coordinates.
   * Returns false when the rect is outside the document.
   */
  editPixels(L, target, docRect, label, fn) {
    const r0 = rectIntersect(rectOut(docRect), { x: 0, y: 0, w: this.w, h: this.h })
    if (!r0) return false
    const r = r0
    const isMask = target === 'mask' && L.mask
    if (!isMask) cover(L, r)
    const canvasRect = () => ({ x: r.x - (isMask ? 0 : L.x), y: r.y - (isMask ? 0 : L.y), w: r.w, h: r.h })
    const cvs = () => (isMask ? L.mask.canvas : L.canvas)
    let cr = canvasRect()
    let patch = grab(cvs(), cr)
    fn(rctx(cvs()), cr)
    L.v++
    const swap = () => {
      if (!isMask) cover(L, r)
      cr = canvasRect()
      const cur = grab(cvs(), cr), ctx = rctx(cvs())
      ctx.clearRect(cr.x, cr.y, cr.w, cr.h)
      ctx.drawImage(patch, cr.x, cr.y)
      patch = cur
      L.v++
    }
    this.hist.push({ label, bytes: r.w * r.h * 4, undo: swap, redo: swap })
    this.emit('pixels', { rect: r, layerId: L.id })
    return true
  }

  // ----- selection -----
  setSel(sel, label = 'Selection') { this.tx(label, () => { this.sel = sel }, { quiet: 'sel' }) }
  selectionCanvas() { return this.sel ? selCanvas(this.sel, this.w, this.h) : null }

  // ----- layers -----
  /** Add a layer above the active one (or at `index`). Becomes the active layer. */
  addLayer(L, label = 'New layer', index) {
    return this.tx(label, () => {
      const at = index ?? (this.active ? this.index(this.activeId) + 1 : this.layers.length)
      this.layers.splice(at, 0, L)
      this.activeId = L.id; this.editMask = false
      return L
    })
  }
  deleteLayer(id) {
    this.tx('Delete layer', () => {
      const i = this.index(id)
      if (i < 0) return
      this.layers.splice(i, 1)
      this.activeId = this.layers[Math.min(i, this.layers.length - 1)]?.id || null
      this.editMask = false
    })
  }
  duplicate(id) {
    const L = this.layer(id)
    if (!L) return null
    const n = { ...L, id: uid(), name: `${L.name} copy`, canvas: L.canvas ? copyCanvas(L.canvas) : null, mask: L.mask ? { canvas: copyCanvas(L.mask.canvas) } : null, text: clone(L.text), shape: clone(L.shape), adjust: clone(L.adjust), bg: false, v: 0 }
    return this.addLayer(n, 'Duplicate layer', this.index(id) + 1)
  }
  /** Move a layer to a new stack index (0 = bottom). */
  moveTo(id, to) {
    const i = this.index(id)
    to = Math.max(0, Math.min(this.layers.length - 1, to))
    if (i < 0 || i === to) return
    this.tx('Reorder layers', () => { const [L] = this.layers.splice(i, 1); this.layers.splice(to, 0, L) })
  }
  /** Change layer fields. Nested objects (text, shape, adjust) must be passed as whole new objects. */
  setProps(id, patch, label = 'Layer properties', key) {
    const L = this.layer(id)
    if (!L) return
    this.tx(label, () => Object.assign(L, patch, { v: L.v + 1 }), { key: key ? `${key}:${id}` : undefined })
  }
  select(id, mask = false) {
    this.activeId = id; this.editMask = !!mask && !!this.layer(id)?.mask
    this.emit('active')
  }

  rasterize(id) {
    const L = this.layer(id)
    if (!L || (L.type !== 'text' && L.type !== 'shape')) return
    this.tx('Rasterize layer', () => this._rasterize(L))
  }
  _rasterize(L) {
    const b = layerBounds(L)
    const pad = L.type === 'text' ? Math.ceil(L.text.size * 0.4) : 4
    const r = rectOut(b, pad)
    const c = renderDoc({ layers: [L], w: this.w, h: this.h }, { rect: r, opts: { only: new Set([L.id]), raw: true, noMask: true } })
    Object.assign(L, { type: 'raster', canvas: c, x: r.x, y: r.y, text: null, shape: null, v: L.v + 1 })
  }

  mergeDown(id) {
    const i = this.index(id), top = this.layers[i], below = this.layers[i - 1]
    if (!top || !below || below.type === 'adjust') return false
    this.tx('Merge down', () => {
      const c = renderDoc(this, { opts: { only: new Set([top.id, below.id]) } })
      Object.assign(below, { type: 'raster', canvas: c, x: 0, y: 0, text: null, shape: null, mask: null, opacity: 1, blend: 'source-over', visible: true, v: below.v + 1 })
      this.layers.splice(i, 1)
      this.activeId = below.id; this.editMask = false
    })
    return true
  }
  flatten() {
    if (this.layers.length < 2) return
    this.tx('Flatten image', () => {
      const L = rasterLayer(1, 1, 'Background', { bg: true })
      L.canvas = renderDoc(this)
      this.layers = [L]; this.activeId = L.id; this.editMask = false
    })
  }

  // ----- masks -----
  addMask(id, kind = 'reveal') {
    const L = this.layer(id)
    if (!L || L.mask) return false
    if ((kind === 'sel' || kind === 'hidesel') && !this.sel) return false
    this.tx('Add layer mask', () => {
      const c = cv(this.w, this.h), ctx = rctx(c)
      if (kind === 'reveal') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height) }
      else if (kind === 'sel') ctx.drawImage(this.selectionCanvas(), 0, 0)
      else if (kind === 'hidesel') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(this.selectionCanvas(), 0, 0) }
      L.mask = { canvas: c }; L.maskOn = true; L.v++
      this.activeId = id; this.editMask = true
    })
    return true
  }
  removeMask(id, apply) {
    const L = this.layer(id)
    if (!L?.mask) return
    this.tx(apply ? 'Apply layer mask' : 'Delete layer mask', () => {
      if (apply) {
        if (L.type !== 'raster') this._rasterize(L)
        cover(L, { x: 0, y: 0, w: this.w, h: this.h })
        const ctx = rctx(L.canvas)
        ctx.globalCompositeOperation = 'destination-in'
        ctx.drawImage(L.mask.canvas, -L.x, -L.y)
        ctx.globalCompositeOperation = 'source-over'
      }
      L.mask = null; L.v++; this.editMask = false
    })
  }
  invertMask(id) {
    const L = this.layer(id)
    if (!L?.mask) return
    this.editPixels(L, 'mask', { x: 0, y: 0, w: this.w, h: this.h }, 'Invert mask', (ctx, r) => {
      const img = ctx.getImageData(r.x, r.y, r.w, r.h), d = img.data
      for (let i = 3; i < d.length; i += 4) d[i] = 255 - d[i]
      ctx.putImageData(img, r.x, r.y)
    })
  }

  // ----- document geometry -----
  /** Shared by crop, canvas size and trim: new size, layers shifted by (dx, dy). trim: drop raster pixels outside the new bounds. */
  reframe(nw, nh, dx, dy, label, trim = false) {
    this.tx(label, () => {
      const W = this.w, H = this.h
      for (const L of this.layers) {
        if (L.type === 'raster') {
          L.x += dx; L.y += dy
          if (L.bg) { // extend the background layer with the background color
            const n = cv(nw, nh), ctx = rctx(n)
            ctx.fillStyle = this.bgColor; ctx.fillRect(0, 0, nw, nh)
            ctx.drawImage(L.canvas, L.x, L.y)
            L.canvas = n; L.x = 0; L.y = 0
          } else if (trim) {
            const r = rectIntersect({ x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height }, { x: 0, y: 0, w: nw, h: nh })
            const n = cv(r ? r.w : 1, r ? r.h : 1)
            if (r) rctx(n).drawImage(L.canvas, L.x - r.x, L.y - r.y)
            L.canvas = n; L.x = r ? r.x : 0; L.y = r ? r.y : 0
          }
        } else if (L.type === 'text') L.text = { ...L.text, x: L.text.x + dx, y: L.text.y + dy }
        else if (L.type === 'shape') L.shape = { ...L.shape, x: L.shape.x + dx, y: L.shape.y + dy }
        if (L.mask) {
          const n = cv(nw, nh), ctx = rctx(n)
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, nw, nh)
          ctx.clearRect(dx, dy, W, H)
          ctx.drawImage(L.mask.canvas, dx, dy)
          L.mask = { canvas: n }
        }
        L.v++
      }
      this.w = nw; this.h = nh; this.sel = null
    })
    this.emit('size')
  }
  crop(r) { this.reframe(Math.round(r.w), Math.round(r.h), -Math.round(r.x), -Math.round(r.y), 'Crop', true) }
  resizeCanvas(nw, nh, ax = 0.5, ay = 0.5) { this.reframe(nw, nh, Math.round((nw - this.w) * ax), Math.round((nh - this.h) * ay), 'Canvas size') }

  resizeImage(nw, nh) {
    const sx = nw / this.w, sy = nh / this.h
    this.tx('Image size', () => {
      for (const L of this.layers) {
        if (L.type === 'raster') {
          const n = cv(Math.max(1, Math.round(L.canvas.width * sx)), Math.max(1, Math.round(L.canvas.height * sy))), ctx = rctx(n)
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(L.canvas, 0, 0, n.width, n.height)
          L.canvas = n; L.x = Math.round(L.x * sx); L.y = Math.round(L.y * sy)
        } else if (L.type === 'text') L.text = { ...L.text, x: L.text.x * sx, y: L.text.y * sy, size: L.text.size * (sx + sy) / 2, strokeW: L.text.strokeW * (sx + sy) / 2 }
        else if (L.type === 'shape') L.shape = { ...L.shape, x: L.shape.x * sx, y: L.shape.y * sy, w: L.shape.w * sx, h: L.shape.h * sy, strokeW: L.shape.strokeW * (sx + sy) / 2, radius: L.shape.radius * (sx + sy) / 2 }
        if (L.mask) {
          const n = cv(nw, nh), ctx = rctx(n)
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(L.mask.canvas, 0, 0, nw, nh)
          L.mask = { canvas: n }
        }
        L.v++
      }
      this.w = nw; this.h = nh; this.sel = null
    })
    this.emit('size')
  }

  /** op: 'cw' | 'ccw' | '180' | 'fh' | 'fv'. Text and shape layers are rasterized first. */
  transform(op) {
    const label = { cw: 'Rotate 90° clockwise', ccw: 'Rotate 90° counter-clockwise', 180: 'Rotate 180°', fh: 'Flip horizontal', fv: 'Flip vertical' }[op]
    this.tx(label, () => {
      const W = this.w, H = this.h
      for (const L of this.layers) {
        if (L.type === 'text' || L.type === 'shape') this._rasterize(L)
        if (L.type === 'raster') {
          const nr = xformRect({ x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height }, op, W, H)
          L.canvas = xformCanvas(L.canvas, op); L.x = nr.x; L.y = nr.y
        }
        if (L.mask) L.mask = { canvas: xformCanvas(L.mask.canvas, op) }
        L.v++
      }
      if (op === 'cw' || op === 'ccw') { this.w = H; this.h = W }
      this.sel = null
    })
    this.emit('size')
  }
  /** Scale and rotate a pixel layer around its center. */
  transformLayer(id, s, rad) {
    const L = this.layer(id)
    if (!L || L.type !== 'raster') return
    this.tx('Transform layer', () => {
      const c = L.canvas, w = c.width * s, h = c.height * s
      const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad))
      const nw = Math.max(1, Math.ceil(w * cos + h * sin)), nh = Math.max(1, Math.ceil(w * sin + h * cos))
      const n = cv(nw, nh), ctx = rctx(n)
      ctx.imageSmoothingQuality = 'high'
      ctx.translate(nw / 2, nh / 2); ctx.rotate(rad); ctx.scale(s, s)
      ctx.drawImage(c, -c.width / 2, -c.height / 2)
      const cx = L.x + c.width / 2, cy = L.y + c.height / 2
      L.canvas = n; L.x = Math.round(cx - nw / 2); L.y = Math.round(cy - nh / 2); L.v++
    })
  }
  /** Flip one pixel layer around its own center. */
  flipLayer(id, op) {
    const L = this.layer(id)
    if (!L) return
    this.tx(op === 'fh' ? 'Flip layer horizontally' : 'Flip layer vertically', () => {
      if (L.type === 'text' || L.type === 'shape') this._rasterize(L)
      if (L.type === 'raster') L.canvas = xformCanvas(L.canvas, op) // flips around the layer's own center; the mask stays put
      L.v++
    })
  }
}
