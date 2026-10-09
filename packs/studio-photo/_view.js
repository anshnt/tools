// Viewport: the on-screen canvas, zoom and pan, dirty-rectangle rendering, selection ants and tool overlays.
// The document is composited at screen resolution (viewport sized), so zooming and painting stay fast on large images.
import { h } from '../../lib/ui.js'
import { clamp, rectIntersect } from './_util.js'
import { compose } from './_render.js'

const FULL = 'full'

export class Viewport {
  constructor(app) {
    this.app = app
    this.zoom = 1; this.ox = 0; this.oy = 0
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.fitted = true
    this.dirty = null; this.raf = 0; this.overRaf = 0; this.antsRaf = 0
    this.canvas = h('canvas', { class: 'ps-canvas' })
    this.antsA = h('canvas', { class: 'ps-ants a' })
    this.antsB = h('canvas', { class: 'ps-ants b' })
    this.over = h('canvas', { class: 'ps-over' })
    this.el = h('div', { class: 'ps-stage', tabindex: 0, 'aria-label': 'Canvas' }, this.canvas, this.antsA, this.antsB, this.over)
    this.acc = document.createElement('canvas')
    this.accCtx = this.acc.getContext('2d', { willReadFrequently: true })
    this.ctx = this.canvas.getContext('2d')
    this.overCtx = this.over.getContext('2d')
    this.pointers = new Map()
    this.gesture = null
    this.pan = null
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.el)
    this.bindEvents()
  }

  destroy() { this.ro.disconnect(); cancelAnimationFrame(this.raf); cancelAnimationFrame(this.overRaf); cancelAnimationFrame(this.antsRaf) }

  get W() { return this.el.clientWidth }
  get H() { return this.el.clientHeight }
  get doc() { return this.app.doc }
  d2s(x, y) { return { x: x * this.zoom + this.ox, y: y * this.zoom + this.oy } }
  s2d(x, y) { return { x: (x - this.ox) / this.zoom, y: (y - this.oy) / this.zoom } }
  point(e) {
    const r = this.el.getBoundingClientRect()
    const sx = e.clientX - r.left, sy = e.clientY - r.top
    return { ...this.s2d(sx, sy), sx, sy }
  }

  /** Device pixel ratio to render at: full on plain documents, capped when pixel-level adjustment layers must run on every frame. */
  wantDpr() {
    const base = Math.min(2, window.devicePixelRatio || 1)
    const heavy = this.doc?.layers.some((l) => l.type === 'adjust' && l.visible)
    return heavy ? Math.min(base, 1.25) : base
  }

  resize() {
    const W = this.W, H = this.H
    if (W < 2 || H < 2) return
    this.dpr = this.wantDpr()
    const dw = Math.round(W * this.dpr), dh = Math.round(H * this.dpr)
    if (this.canvas.width !== dw || this.canvas.height !== dh || this.antsA.width !== W) {
      for (const c of [this.canvas, this.over, this.acc]) { c.width = dw; c.height = dh }
      for (const c of [this.antsA, this.antsB]) { c.width = W; c.height = H }
      if (this.fitted && this.doc) this.fit(false)
      this.invalidate()
      this.invalidateOverlay()
      this.updateAnts()
    }
  }

  setDoc() { this.fit(); this.invalidate(); this.invalidateOverlay(); this.updateAnts() }

  fit(emit = true) {
    const doc = this.doc
    if (!doc || this.W < 2) return
    const pad = this.W < 700 ? 12 : 36
    this.zoom = clamp(Math.min((this.W - pad * 2) / doc.w, (this.H - pad * 2) / doc.h), 0.02, 2)
    this.ox = (this.W - doc.w * this.zoom) / 2
    this.oy = (this.H - doc.h * this.zoom) / 2
    this.fitted = true
    if (emit) this.changed()
  }

  /** Zoom to z keeping the screen point (ax, ay) fixed. */
  setZoom(z, ax = this.W / 2, ay = this.H / 2) {
    z = clamp(z, 0.02, 32)
    const d = this.s2d(ax, ay)
    this.zoom = z
    this.ox = ax - d.x * z
    this.oy = ay - d.y * z
    this.fitted = false
    this.changed()
  }
  zoomBy(f, ax, ay) { this.setZoom(this.zoom * f, ax, ay) }
  panBy(dx, dy) { this.ox += dx; this.oy += dy; this.fitted = false; this.changed() }

  changed() {
    this.invalidate()
    this.invalidateOverlay()
    this.updateAnts()
    this.app.emit('view')
  }

  // ----- rendering -----
  /** Redraw after a change. rect is in doc pixels; omit for everything. */
  invalidate(rect) {
    if (!rect) this.dirty = FULL
    else if (this.dirty !== FULL) {
      const s = this.zoom * this.dpr
      const r = { x: Math.floor((rect.x * this.zoom + this.ox) * this.dpr) - 3, y: Math.floor((rect.y * this.zoom + this.oy) * this.dpr) - 3, w: Math.ceil(rect.w * s) + 6, h: Math.ceil(rect.h * s) + 6 }
      if (!this.dirty) this.dirty = r
      else {
        const x0 = Math.min(this.dirty.x, r.x), y0 = Math.min(this.dirty.y, r.y)
        this.dirty = { x: x0, y: y0, w: Math.max(this.dirty.x + this.dirty.w, r.x + r.w) - x0, h: Math.max(this.dirty.y + this.dirty.h, r.y + r.h) - y0 }
      }
    }
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.renderNow() })
  }

  pattern() {
    const dark = document.documentElement.dataset.theme === 'dark'
    if (this._pat && this._patDark === dark) return this._pat
    const c = document.createElement('canvas')
    c.width = c.height = 16
    const x = c.getContext('2d')
    x.fillStyle = dark ? '#1c1c25' : '#ffffff'; x.fillRect(0, 0, 16, 16)
    x.fillStyle = dark ? '#2b2b37' : '#e6e6ec'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8)
    this._patDark = dark
    return (this._pat = this.ctx.createPattern(c, 'repeat'))
  }

  renderNow() {
    if (this.doc && this.wantDpr() !== this.dpr) { this.resize(); if (this.raf === 0) this.dirty = FULL }
    const doc = this.doc, W = this.canvas.width, H = this.canvas.height
    if (!doc || !W) { this.ctx.clearRect(0, 0, W, H); this.dirty = null; return }
    const r = this.dirty === FULL || !this.dirty ? { x: 0, y: 0, w: W, h: H } : rectIntersect(this.dirty, { x: 0, y: 0, w: W, h: H })
    this.dirty = null
    if (!r) return
    const d = this.dpr
    compose(doc, this.accCtx, { ox: this.ox * d, oy: this.oy * d, s: this.zoom * d }, r, this.app.renderOpts())
    const c = this.ctx
    c.clearRect(r.x, r.y, r.w, r.h)
    const dr = rectIntersect(r, { x: this.ox * d, y: this.oy * d, w: doc.w * this.zoom * d, h: doc.h * this.zoom * d })
    if (dr) { c.fillStyle = this.pattern(); c.fillRect(dr.x, dr.y, dr.w, dr.h) }
    c.drawImage(this.acc, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
  }

  // ----- overlays -----
  invalidateOverlay() {
    if (!this.overRaf) this.overRaf = requestAnimationFrame(() => { this.overRaf = 0; this.drawOverlay() })
  }
  drawOverlay() {
    const c = this.overCtx, d = this.dpr
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.over.width, this.over.height)
    const doc = this.doc
    if (!doc) return
    c.setTransform(d, 0, 0, d, 0, 0)
    c.strokeStyle = 'rgba(128,128,140,.55)'
    c.lineWidth = 1
    c.strokeRect(Math.round(this.ox) - 0.5, Math.round(this.oy) - 0.5, Math.round(doc.w * this.zoom) + 1, Math.round(doc.h * this.zoom) + 1)
    this.app.drawToolOverlay(c, this)
  }

  /** Marching ants: edge pixels of the selection at screen resolution, in two phases toggled by CSS animation. */
  updateAnts() {
    if (this.antsRaf) return
    this.antsRaf = requestAnimationFrame(() => { this.antsRaf = 0; this.buildAnts() })
  }
  buildAnts() {
    const sel = this.doc?.sel, W = this.W, H = this.H
    for (const c of [this.antsA, this.antsB]) c.getContext('2d').clearRect(0, 0, c.width, c.height)
    if (!sel || !W) return
    const z = this.zoom, doc = this.doc
    const x0 = clamp(Math.floor(sel.x * z + this.ox) - 1, 0, W), y0 = clamp(Math.floor(sel.y * z + this.oy) - 1, 0, H)
    const x1 = clamp(Math.ceil((sel.x + sel.w) * z + this.ox) + 1, 0, W), y1 = clamp(Math.ceil((sel.y + sel.h) * z + this.oy) + 1, 0, H)
    const bw = x1 - x0, bh = y1 - y0
    if (bw < 1 || bh < 1) return
    const ins = new Uint8Array(bw * bh), mask = sel.mask
    for (let y = 0; y < bh; y++) {
      const dy = Math.floor((y0 + y - this.oy) / z)
      if (dy < 0 || dy >= doc.h) continue
      const row = dy * doc.w
      for (let x = 0; x < bw; x++) {
        const dx = Math.floor((x0 + x - this.ox) / z)
        if (dx >= 0 && dx < doc.w && mask[row + dx] >= 128) ins[y * bw + x] = 1
      }
    }
    const a = new ImageData(bw, bh), b = new ImageData(bw, bh)
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x
        if (!ins[i]) continue
        const edge = x === 0 || y === 0 || x === bw - 1 || y === bh - 1 || !ins[i - 1] || !ins[i + 1] || !ins[i - bw] || !ins[i + bw]
        if (!edge) continue
        const k = ((x + y) & 7) < 4, o = i * 4
        a.data[o] = a.data[o + 1] = a.data[o + 2] = k ? 0 : 255; a.data[o + 3] = 255
        b.data[o] = b.data[o + 1] = b.data[o + 2] = k ? 255 : 0; b.data[o + 3] = 255
      }
    }
    this.antsA.getContext('2d').putImageData(a, x0, y0)
    this.antsB.getContext('2d').putImageData(b, x0, y0)
  }

  // ----- input: pan, pinch, wheel, tools -----
  bindEvents() {
    const el = this.el
    el.addEventListener('pointerdown', (e) => this.onDown(e))
    el.addEventListener('pointermove', (e) => this.onMove(e))
    el.addEventListener('pointerup', (e) => this.onUp(e))
    el.addEventListener('pointercancel', (e) => this.onUp(e))
    el.addEventListener('pointerleave', () => this.app.hoverOut())
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    el.addEventListener('wheel', (e) => {
      if (!this.doc) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) this.zoomBy(Math.exp(-clamp(e.deltaY, -120, 120) * (Math.abs(e.deltaY) < 30 ? 0.012 : 0.0022)), e.clientX - r.left, e.clientY - r.top)
      else if (e.shiftKey) this.panBy(-(e.deltaY || e.deltaX), 0)
      else this.panBy(-e.deltaX, -e.deltaY)
    }, { passive: false })
  }

  onDown(e) {
    if (!this.doc) return
    this.el.focus({ preventScroll: true })
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try { this.el.setPointerCapture?.(e.pointerId) } catch { /* synthetic or already released pointer */ }
    if (this.pointers.size === 2) { // pinch / two-finger pan cancels whatever the tool was doing
      this.app.cancelTool()
      this.pan = null
      this.gesture = this.gestureState()
      return
    }
    if (this.pointers.size > 2) return
    const wantPan = e.button === 1 || this.app.spaceDown || this.app.tool === 'hand'
    if (wantPan) { this.pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; this.el.classList.add('panning'); return }
    if (e.button === 2) return
    this.app.toolDown(e, this.point(e))
  }
  onMove(e) {
    if (!this.doc) return
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.gesture && this.pointers.size >= 2) {
      const g = this.gestureState(), o = this.gesture
      const r = this.el.getBoundingClientRect()
      const d = this.s2d(o.cx - r.left, o.cy - r.top)
      const z = clamp(o.zoom * (g.dist / (o.dist || 1)), 0.02, 32)
      this.zoom = z
      this.ox = g.cx - r.left - d.x * z
      this.oy = g.cy - r.top - d.y * z
      this.fitted = false
      this.changed()
      return
    }
    if (this.pan && this.pan.id === e.pointerId) {
      this.panBy(e.clientX - this.pan.x, e.clientY - this.pan.y)
      this.pan.x = e.clientX; this.pan.y = e.clientY
      return
    }
    const p = this.point(e)
    if (this.pointers.has(e.pointerId)) this.app.toolMove(e, p)
    else this.app.hover(e, p)
  }
  onUp(e) {
    const had = this.pointers.has(e.pointerId)
    this.pointers.delete(e.pointerId)
    if (this.gesture) { if (this.pointers.size < 2) this.gesture = null; return }
    if (this.pan && this.pan.id === e.pointerId) { this.pan = null; this.el.classList.remove('panning'); return }
    if (had && this.doc) this.app.toolUp(e, this.point(e))
  }
  gestureState() {
    const [a, b] = [...this.pointers.values()]
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom }
  }
}
