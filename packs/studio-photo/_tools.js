// Tools: each has down/move/up/hover handlers (doc-space points), an optional canvas overlay, and an options schema for the options bar.
import { clamp, cv, rctx, rgba, hexToRgb, luma, rectIntersect, rectUnion, copyCanvas } from './_util.js'
import { cover, textLayer, shapeLayer } from './_doc.js'
import { drawShape, layerBounds, renderDoc } from './_render.js'
import { rectMask, ellipseMask, polyMask, featherMask, combineMask, makeSel, floodMask, softenMask } from './_select.js'

export const SEL_MODES = [['new', 'New'], ['add', 'Add'], ['sub', 'Subtract'], ['int', 'Intersect']]
const docRect = (d) => ({ x: 0, y: 0, w: d.w, h: d.h })
const near = (a, b, r) => Math.abs(a.x - b.x) <= r && Math.abs(a.y - b.y) <= r

// ---------- selection helpers ----------
function modeFor(app, e) {
  if (e.shiftKey && e.altKey) return 'int'
  if (e.shiftKey) return 'add'
  if (e.altKey) return 'sub'
  return app.opts.selMode || 'new'
}
export function applySelection(app, newMask, mode, label, feather = 0) {
  const d = app.doc
  let m = feather > 0 ? featherMask(newMask, d.w, d.h, feather) : newMask
  m = combineMask(d.sel?.mask || null, m, d.w, d.h, mode)
  d.setSel(makeSel(m, d.w, d.h), label)
}

/** Doc-sized RGBA pixels of a layer (or of the merged image). */
export function layerPixels(app, merged) {
  const d = app.doc, L = d.active
  if (merged || !L || L.type !== 'raster') return renderDoc(d).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, d.w, d.h)
  const c = cv(d.w, d.h), ctx = rctx(c)
  ctx.drawImage(L.canvas, L.x, L.y)
  return ctx.getImageData(0, 0, d.w, d.h)
}

// ---------- brush engine ----------
const stamps = new Map()
function stampFor(size, hardness, color) {
  const key = `${size}|${hardness}|${color}`
  let s = stamps.get(key)
  if (s) return s
  const d = Math.max(3, Math.ceil(size) + 2)
  s = document.createElement('canvas')
  s.width = s.height = d
  const x = s.getContext('2d'), r = size / 2, c = d / 2
  if (hardness >= 0.99) { x.beginPath(); x.arc(c, c, r, 0, Math.PI * 2); x.fillStyle = color; x.fill() }
  else {
    const g = x.createRadialGradient(c, c, 0, c, c, Math.max(0.5, r))
    g.addColorStop(0, rgba(color, 1)); g.addColorStop(Math.min(0.98, hardness), rgba(color, 1)); g.addColorStop(1, rgba(color, 0))
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
  }
  if (stamps.size > 24) stamps.delete(stamps.keys().next().value)
  stamps.set(key, s)
  return s
}

class Stroke {
  /** kind: 'paint' | 'erase' | 'clone'. Paints into a buffer shown live and committed once, so opacity never builds up within a stroke. */
  constructor(app, kind, opt) {
    this.app = app; this.kind = kind; this.opt = opt
    const t = app.paintTarget()
    if (!t) { this.ok = false; return }
    this.ok = true
    const d = app.doc
    this.L = t.L; this.target = t.target
    if (this.target === 'layer') cover(this.L, docRect(d))
    this.ox = this.target === 'layer' ? this.L.x : 0
    this.oy = this.target === 'layer' ? this.L.y : 0
    const src = this.target === 'layer' ? this.L.canvas : this.L.mask.canvas
    const buf = (app._buf ||= {})
    if (!buf.S || buf.S.width !== src.width || buf.S.height !== src.height) {
      buf.S = cv(src.width, src.height); buf.C = null
    }
    this.S = buf.S; this.Sx = rctx(this.S)
    this.sel = d.sel
    if (this.sel && (!buf.C || buf.C.width !== this.S.width || buf.C.height !== this.S.height)) buf.C = cv(this.S.width, this.S.height)
    this.C = this.sel ? buf.C : this.S; this.Cx = rctx(this.C)
    this.bounds = null
    this.last = null
    this.carry = 0
    this.mode = this.target === 'mask'
      ? (kind === 'erase' ? 'erase' : (luma(...hexToRgb(app.fg)) >= 0.5 ? 'paint' : 'erase'))
      : (kind === 'erase' ? 'erase' : 'paint')
    this.color = this.target === 'mask' ? '#000000' : app.fg
    this.alpha = clamp(opt.opacity / 100, 0.01, 1)
    app.live = { layerId: this.L.id, target: this.target, canvas: this.C, mode: this.mode, alpha: this.alpha }
  }

  size(pressure) { return Math.max(1, Math.round(this.opt.size * (this.pen && this.opt.pressure ? Math.max(0.12, pressure) : 1))) }

  begin(p, e) {
    this.pen = e.pointerType === 'pen'
    if (this.kind === 'clone') {
      const src = this.app.opts.cloneSource
      if (!src) { this.app.warn('Alt-click (or use "Set source") to pick the area to copy from, then paint.'); this.ok = false; this.app.live = null; return }
      if (!this.app.opts.cloneOffset || !this.opt.aligned) this.app.opts.cloneOffset = { x: src.x - p.x, y: src.y - p.y }
    }
    this.dab(p, e.pointerType === 'pen' ? e.pressure : 1)
    this.last = { x: p.x, y: p.y, pr: e.pointerType === 'pen' ? e.pressure : 1 }
  }

  move(p, e) {
    const co = e.getCoalescedEvents?.()
    const evs = co && co.length ? co : [e]
    const vp = this.app.vp
    for (const ev of evs) {
      const q = ev === e ? p : vp.point(ev)
      const pr = ev.pointerType === 'pen' ? ev.pressure : 1
      this.segment(q, pr)
    }
  }

  segment(q, pr) {
    const a = this.last, size = this.size(pr), spacing = Math.max(0.6, size * 0.1)
    const dx = q.x - a.x, dy = q.y - a.y, dist = Math.hypot(dx, dy)
    if (dist < 0.01) return
    let t = spacing - this.carry
    while (t <= dist) {
      const f = t / dist
      this.dab({ x: a.x + dx * f, y: a.y + dy * f }, a.pr + (pr - a.pr) * f)
      t += spacing
    }
    this.carry = dist - (t - spacing)
    this.last = { x: q.x, y: q.y, pr }
    this.flush()
  }

  dab(p, pr) {
    const size = this.size(pr)
    const x = p.x - this.ox, y = p.y - this.oy
    const d = Math.max(3, Math.ceil(size) + 2)
    this.Sx.globalAlpha = this.pen && this.opt.pressure ? clamp(pr * 1.4, 0.1, 1) : 1
    if (this.kind === 'clone') {
      const off = this.app.opts.cloneOffset
      const tmp = this._tmp?.width === d ? this._tmp : (this._tmp = cv(d, d)), tx = rctx(tmp)
      tx.globalCompositeOperation = 'source-over'
      tx.clearRect(0, 0, d, d)
      tx.drawImage(this.L.canvas, p.x + off.x - this.L.x - d / 2, p.y + off.y - this.L.y - d / 2, d, d, 0, 0, d, d)
      tx.globalCompositeOperation = 'destination-in'
      tx.drawImage(stampFor(size, this.opt.hardness / 100, '#000000'), 0, 0)
      this.Sx.drawImage(tmp, x - d / 2, y - d / 2)
    } else {
      this.Sx.drawImage(stampFor(size, this.opt.hardness / 100, this.color), x - d / 2, y - d / 2)
    }
    this.Sx.globalAlpha = 1
    const r = { x: p.x - d / 2 - 1, y: p.y - d / 2 - 1, w: d + 2, h: d + 2 }
    this.bounds = rectUnion(this.bounds, r)
    this.dirty = rectUnion(this.dirty, r)
  }

  /** Apply the selection clip to the freshly painted area and redraw it. */
  flush() {
    const r = this.dirty
    if (!r) return
    this.dirty = null
    if (this.sel) this.clip(r)
    this.app.vp.invalidate(r)
  }
  clip(r) {
    const d = this.app.doc
    const c = rectIntersect({ x: r.x - this.ox, y: r.y - this.oy, w: r.w, h: r.h }, { x: -this.ox, y: -this.oy, w: d.w, h: d.h })
    if (!c) return
    const sc = d.selectionCanvas(), cx = this.Cx
    cx.save()
    cx.beginPath(); cx.rect(c.x, c.y, c.w, c.h); cx.clip() // destination-in would otherwise clear everything outside the drawn rect
    cx.globalCompositeOperation = 'source-over'
    cx.clearRect(c.x, c.y, c.w, c.h)
    cx.drawImage(this.S, c.x, c.y, c.w, c.h, c.x, c.y, c.w, c.h)
    cx.globalCompositeOperation = 'destination-in'
    cx.drawImage(sc, c.x + this.ox, c.y + this.oy, c.w, c.h, c.x, c.y, c.w, c.h)
    cx.restore()
  }

  end(label) {
    this.flush()
    const b = this.bounds
    const app = this.app, doc = app.doc
    if (b) {
      doc.editPixels(this.L, this.target, b, label, (ctx, r) => {
        ctx.globalAlpha = this.alpha
        ctx.globalCompositeOperation = this.mode === 'erase' ? 'destination-out' : 'source-over'
        ctx.drawImage(this.C, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
      })
    }
    this.release(b)
  }
  release(b) {
    const app = this.app
    app.live = null
    if (b) {
      const r = { x: Math.floor(b.x - this.ox), y: Math.floor(b.y - this.oy), w: Math.ceil(b.w), h: Math.ceil(b.h) }
      this.Sx.clearRect(r.x, r.y, r.w, r.h)
      if (this.C !== this.S) this.Cx.clearRect(r.x, r.y, r.w, r.h)
    }
    app.vp.invalidate()
  }
  cancel() { this.release(this.bounds) }
}

function brushLike(id, name, icon, key, kind, defaults) {
  let st = null
  return {
    id, name, icon, key, cursor: 'none', defaults,
    opts: [
      { k: 'size', label: 'Size', type: 'range', min: 1, max: 400, step: 1, fmt: (v) => `${v}px` },
      { k: 'hardness', label: 'Hardness', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => `${v}%` },
      { k: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, fmt: (v) => `${v}%` },
      ...(kind === 'clone' ? [{ k: 'aligned', label: 'Aligned', type: 'toggle' }, { k: 'setSource', label: 'Set source', type: 'button', title: 'Next tap or click picks the source (same as Alt-click)' }] : []),
      { k: 'pressure', label: 'Pen pressure', type: 'toggle', title: 'Size and opacity follow pen pressure' },
    ],
    down(app, e, p) {
      const o = app.toolOpts()
      if (kind === 'clone' && (e.altKey || app.armClone)) {
        app.opts.cloneSource = { x: p.x, y: p.y }; app.opts.cloneOffset = null; app.armClone = false
        app.vp.invalidateOverlay(); app.toast('Clone source set. Now paint where you want the copy.'); return
      }
      st = new Stroke(app, kind, o)
      if (!st.ok) { st = null; return }
      st.begin(p, e)
      if (!st.ok) { st = null; return }
      st.flush()
    },
    move(app, e, p) { if (st) { st.move(p, e); this.hover(app, e, p) } },
    up(app) { if (st) { st.end(kind === 'erase' ? 'Eraser' : kind === 'clone' ? 'Clone stamp' : 'Brush stroke'); st = null } },
    cancel() { if (st) { st.cancel(); st = null } },
    hover(app, e, p) {
      const o = app.toolOpts(), size = o.size * app.vp.zoom
      app.setRing(p.sx, p.sy, size)
    },
    overlay(app, c, vp) {
      const s = app.opts.cloneSource
      if (kind === 'clone' && s) {
        const q = vp.d2s(s.x, s.y)
        c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(q.x - 9, q.y); c.lineTo(q.x + 9, q.y); c.moveTo(q.x, q.y - 9); c.lineTo(q.x, q.y + 9); c.stroke()
        c.strokeStyle = '#e11d48'; c.lineWidth = 1.5; c.stroke()
      }
    },
  }
}

// ---------- tools ----------
function dragEdit(app, L) {
  const orig = { x: L.x, y: L.y, text: L.text, shape: L.shape }
  let moved = false
  return {
    set(patch) { Object.assign(L, patch); moved = true; app.vp.invalidate(); app.vp.invalidateOverlay() },
    end(label) {
      const fin = { x: L.x, y: L.y, text: L.text, shape: L.shape }
      Object.assign(L, orig)
      if (moved) app.doc.setProps(L.id, fin, label)
      else app.vp.invalidate()
    },
    cancel() { Object.assign(L, orig); app.vp.invalidate() },
    orig,
  }
}

export function hitLayer(app, p) {
  const d = app.doc
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const L = d.layers[i]
    if (!L.visible || L.type === 'adjust') continue
    const b = layerBounds(L)
    if (p.x < b.x || p.y < b.y || p.x >= b.x + b.w || p.y >= b.y + b.h) continue
    if (L.type === 'raster') {
      const px = rctx(L.canvas).getImageData(Math.floor(p.x - L.x), Math.floor(p.y - L.y), 1, 1).data
      if (px[3] < 10) continue
    }
    return L
  }
  return null
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
function handlePoints(b) {
  const xs = { w: b.x, '': b.x + b.w / 2, e: b.x + b.w }, ys = { n: b.y, '': b.y + b.h / 2, s: b.y + b.h }
  return HANDLES.map((n) => ({ n, x: xs[n.replace(/[ns]/g, '')], y: ys[n.replace(/[we]/g, '')] }))
}
function drawHandles(c, vp, b, line) {
  const a = vp.d2s(b.x, b.y), z = vp.zoom
  c.strokeStyle = '#5b4cf0'; c.lineWidth = 1.2
  c.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.w * z), Math.round(b.h * z))
  if (line) return
  for (const hp of handlePoints(b)) {
    const q = vp.d2s(hp.x, hp.y)
    c.fillStyle = '#fff'; c.strokeStyle = '#5b4cf0'
    c.beginPath(); c.rect(q.x - 4, q.y - 4, 8, 8); c.fill(); c.stroke()
  }
}

const move = (() => {
  let st = null
  const shapeBox = (L) => ({ x: Math.min(L.shape.x, L.shape.x + L.shape.w), y: Math.min(L.shape.y, L.shape.y + L.shape.h), w: Math.abs(L.shape.w), h: Math.abs(L.shape.h) })
  return {
    id: 'move', name: 'Move', icon: 'move', key: 'v', cursor: 'default', defaults: { autoSelect: false },
    opts: [{ k: 'autoSelect', label: 'Auto-select layer', type: 'toggle', title: 'Click an object to pick its layer (Ctrl-click does this temporarily)' }],
    down(app, e, p) {
      const d = app.doc
      if (e.ctrlKey || e.metaKey || app.toolOpts().autoSelect) {
        const hit = hitLayer(app, p)
        if (hit) d.select(hit.id)
      }
      let L = d.active
      if (!L || L.type === 'adjust') { app.warn('Pick a layer to move (adjustment layers have no position).'); return }
      if (L.locked) { app.warn('This layer is locked. Click the lock icon to unlock it.'); return }
      if (d.editMask && L.mask) { app.warn('You are editing the layer mask. Select the layer thumbnail to move the layer.'); return }
      // resize handles on shape layers
      if (L.type === 'shape' && L.shape.kind !== 'line') {
        const b = shapeBox(L), vp = app.vp
        const hit = handlePoints(b).find((hp) => { const q = vp.d2s(hp.x, hp.y); return Math.abs(q.x - p.sx) < 9 && Math.abs(q.y - p.sy) < 9 })
        if (hit) { st = { mode: 'resize', h: hit.n, b, drag: dragEdit(app, L), L }; return }
      }
      st = { mode: 'move', start: p, drag: null, L, lifted: false }
    },
    move(app, e, p) {
      if (!st) return
      const L = st.L
      if (st.mode === 'resize') {
        let x0 = st.b.x, y0 = st.b.y, x1 = st.b.x + st.b.w, y1 = st.b.y + st.b.h
        if (st.h.includes('w')) x0 = p.x; if (st.h.includes('e')) x1 = p.x
        if (st.h.includes('n')) y0 = p.y; if (st.h.includes('s')) y1 = p.y
        let nx = Math.min(x0, x1), ny = Math.min(y0, y1), nw = Math.abs(x1 - x0), nh = Math.abs(y1 - y0)
        if (e.shiftKey && st.b.w && st.b.h) { const k = st.b.w / st.b.h; if (st.h.length === 2) { nh = nw / k; if (st.h.includes('n')) ny = y1 - nh } else if ('ns'.includes(st.h)) nw = nh * k; else nh = nw / k }
        st.drag.set({ shape: { ...L.shape, x: Math.round(nx), y: Math.round(ny), w: Math.max(1, Math.round(nw)), h: Math.max(1, Math.round(nh)) } })
        return
      }
      let dx = p.x - st.start.x, dy = p.y - st.start.y
      if (!st.drag) {
        if (Math.hypot(dx, dy) * app.vp.zoom < 3) return
        // with a selection on a pixel layer, lift the selected pixels onto their own layer first
        if (app.doc.sel && L.type === 'raster' && !st.lifted) { st.lifted = true; if (app.ops.liftSelection()) st.L = app.doc.active }
        st.drag = dragEdit(app, st.L)
      }
      const Lm = st.L
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      dx = Math.round(dx); dy = Math.round(dy)
      const o = st.drag.orig
      if (Lm.type === 'raster') st.drag.set({ x: o.x + dx, y: o.y + dy })
      else if (Lm.type === 'text') st.drag.set({ text: { ...o.text, x: o.text.x + dx, y: o.text.y + dy } })
      else if (Lm.type === 'shape') st.drag.set({ shape: { ...o.shape, x: o.shape.x + dx, y: o.shape.y + dy } })
    },
    up() { if (st?.drag) st.drag.end(st.mode === 'resize' ? 'Resize shape' : 'Move layer'); st = null },
    cancel() { st?.drag?.cancel(); st = null },
    overlay(app, c, vp) {
      const L = app.doc.active
      if (!L || L.type === 'adjust' || !L.visible) return
      const b = layerBounds(L)
      if (b) drawHandles(c, vp, b, L.type !== 'shape' || L.shape.kind === 'line')
    },
  }
})()

function marqueeTool(shape) {
  let st = null
  const rectOf = (e) => {
    let { x0, y0, p } = st
    let w = p.x - x0, h = p.y - y0
    if (st.shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m }
    let x = x0, y = y0
    if (st.alt) { x = x0 - w; y = y0 - h; w *= 2; h *= 2 }
    return { x: Math.round(Math.min(x, x + w)), y: Math.round(Math.min(y, y + h)), w: Math.round(Math.abs(w)), h: Math.round(Math.abs(h)) }
  }
  return {
    id: shape === 'rect' ? 'marquee' : 'ellipse', name: shape === 'rect' ? 'Rectangular marquee' : 'Elliptical marquee', icon: shape === 'rect' ? 'square-dashed' : 'circle-dashed', key: 'm', cursor: 'crosshair',
    defaults: { feather: 0 },
    opts: [{ k: 'selMode', label: 'Mode', type: 'seg', options: SEL_MODES, shared: true }, { k: 'feather', label: 'Feather', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => `${v}px` }],
    down(app, e, p) { st = { x0: p.x, y0: p.y, p, mode: modeFor(app, e), shift: false, alt: false } },
    move(app, e, p) { if (!st) return; st.p = p; st.shift = e.shiftKey; st.alt = e.altKey; app.vp.invalidateOverlay() },
    up(app, e, p) {
      if (!st) return
      st.p = p; st.shift = e.shiftKey; st.alt = e.altKey
      const r = rectOf(), d = app.doc, mode = st.mode
      st = null
      app.vp.invalidateOverlay()
      if (r.w < 2 && r.h < 2) { if (mode === 'new') d.setSel(null, 'Deselect'); return }
      const m = shape === 'rect' ? rectMask(d.w, d.h, r) : ellipseMask(d.w, d.h, r)
      applySelection(app, m, mode, shape === 'rect' ? 'Rectangular marquee' : 'Elliptical marquee', app.toolOpts().feather)
    },
    cancel() { st = null },
    overlay(app, c, vp) {
      if (!st) return
      const r = rectOf(), a = vp.d2s(r.x, r.y), z = vp.zoom
      c.save(); c.lineWidth = 1
      for (const [col, off] of [['#000', 0], ['#fff', 4]]) {
        c.strokeStyle = col; c.setLineDash([4, 4]); c.lineDashOffset = off; c.beginPath()
        if (shape === 'rect') c.rect(a.x, a.y, r.w * z, r.h * z); else c.ellipse(a.x + r.w * z / 2, a.y + r.h * z / 2, Math.max(0.1, r.w * z / 2), Math.max(0.1, r.h * z / 2), 0, 0, Math.PI * 2)
        c.stroke()
      }
      c.restore()
    },
  }
}

const lasso = (() => {
  let st = null
  return {
    id: 'lasso', name: 'Lasso', icon: 'lasso', key: 'l', cursor: 'crosshair', defaults: { feather: 0 },
    opts: [{ k: 'selMode', label: 'Mode', type: 'seg', options: SEL_MODES, shared: true }, { k: 'feather', label: 'Feather', type: 'range', min: 0, max: 100, step: 1, fmt: (v) => `${v}px` }],
    down(app, e, p) { st = { pts: [{ x: p.x, y: p.y }], mode: modeFor(app, e) } },
    move(app, e, p) {
      if (!st) return
      const l = st.pts[st.pts.length - 1]
      if (Math.hypot(p.x - l.x, p.y - l.y) * app.vp.zoom > 2) { st.pts.push({ x: p.x, y: p.y }); app.vp.invalidateOverlay() }
    },
    up(app) {
      if (!st) return
      const { pts, mode } = st
      st = null
      app.vp.invalidateOverlay()
      if (pts.length < 3) { if (mode === 'new') app.doc.setSel(null, 'Deselect'); return }
      applySelection(app, polyMask(app.doc.w, app.doc.h, pts), mode, 'Lasso', app.toolOpts().feather)
    },
    cancel() { st = null },
    overlay(app, c, vp) {
      if (!st || st.pts.length < 2) return
      c.save(); c.lineWidth = 1
      for (const [col, off] of [['#000', 0], ['#fff', 4]]) {
        c.strokeStyle = col; c.setLineDash([4, 4]); c.lineDashOffset = off; c.beginPath()
        st.pts.forEach((q, i) => { const s = vp.d2s(q.x, q.y); i ? c.lineTo(s.x, s.y) : c.moveTo(s.x, s.y) })
        c.stroke()
      }
      c.restore()
    },
  }
})()

const wand = {
  id: 'wand', name: 'Magic wand', icon: 'wand-sparkles', key: 'w', cursor: 'crosshair', defaults: { tolerance: 32, contiguous: true, sampleAll: false },
  opts: [{ k: 'selMode', label: 'Mode', type: 'seg', options: SEL_MODES, shared: true }, { k: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 128, step: 1 },
    { k: 'contiguous', label: 'Contiguous', type: 'toggle' }, { k: 'sampleAll', label: 'All layers', type: 'toggle', title: 'Sample the merged image instead of the active layer' }],
  down(app, e, p) {
    const d = app.doc, o = app.toolOpts()
    if (p.x < 0 || p.y < 0 || p.x >= d.w || p.y >= d.h) return
    const img = layerPixels(app, o.sampleAll)
    let m = floodMask(img.data, d.w, d.h, p.x, p.y, o.tolerance, o.contiguous)
    if (d.w * d.h < 3e6) m = softenMask(m, d.w, d.h)
    applySelection(app, m, modeFor(app, e), 'Magic wand')
  },
}

const crop = (() => {
  let st = null
  const RATIOS = [['free', 'Free'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['3:4', '3:4'], ['2:3', '2:3'], ['9:16', '9:16']]
  const ratioOf = (app) => { const r = app.toolOpts().ratio; if (!r || r === 'free') return 0; const [a, b] = r.split(':').map(Number); return a / b }
  const norm = (r, d) => { const x0 = clamp(Math.min(r.x, r.x + r.w), 0, d.w), y0 = clamp(Math.min(r.y, r.y + r.h), 0, d.h), x1 = clamp(Math.max(r.x, r.x + r.w), 0, d.w), y1 = clamp(Math.max(r.y, r.y + r.h), 0, d.h); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }
  return {
    id: 'crop', name: 'Crop', icon: 'crop', key: 'c', cursor: 'crosshair', defaults: { ratio: 'free' },
    opts: [{ k: 'ratio', label: 'Ratio', type: 'select', options: RATIOS }, { k: 'applyCrop', label: 'Apply', type: 'button', primary: true, icon: 'check', title: 'Apply crop (Enter)' }, { k: 'cancelCrop', label: 'Reset', type: 'button', icon: 'x', title: 'Reset crop box (Esc)' }],
    activate(app) { app.crop = app.crop || { x: 0, y: 0, w: app.doc.w, h: app.doc.h }; app.vp.invalidateOverlay() },
    deactivate(app) { app.crop = null; app.vp.invalidateOverlay() },
    down(app, e, p) {
      const r = app.crop, vp = app.vp
      const hp = handlePoints(r).find((q) => { const s = vp.d2s(q.x, q.y); return Math.abs(s.x - p.sx) < 12 && Math.abs(s.y - p.sy) < 12 })
      if (hp) st = { mode: 'h', h: hp.n, r0: { ...r }, p0: p }
      else if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h && (r.w < app.doc.w || r.h < app.doc.h)) st = { mode: 'move', r0: { ...r }, p0: p }
      else st = { mode: 'new', p0: p }
    },
    move(app, e, p) {
      if (!st) return
      const d = app.doc, ratio = ratioOf(app)
      if (st.mode === 'move') {
        const dx = p.x - st.p0.x, dy = p.y - st.p0.y
        app.crop = { ...st.r0, x: Math.round(clamp(st.r0.x + dx, 0, d.w - st.r0.w)), y: Math.round(clamp(st.r0.y + dy, 0, d.h - st.r0.h)) }
      } else if (st.mode === 'new') {
        let w = p.x - st.p0.x, h = p.y - st.p0.y
        if (ratio) h = Math.sign(h || 1) * Math.abs(w) / ratio
        app.crop = norm({ x: Math.round(st.p0.x), y: Math.round(st.p0.y), w: Math.round(w), h: Math.round(h) }, d)
      } else {
        const r0 = st.r0
        let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h
        if (st.h.includes('w')) x0 = p.x; if (st.h.includes('e')) x1 = p.x
        if (st.h.includes('n')) y0 = p.y; if (st.h.includes('s')) y1 = p.y
        let r = norm({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, d)
        if (ratio && st.h.length === 2) { r.h = r.w / ratio; if (st.h.includes('n')) r.y = (y1 > y0 ? Math.max(y0, y1) : y1) - r.h; r = norm(r, d) }
        app.crop = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }
      }
      app.vp.invalidateOverlay(); app.updateStatus()
    },
    up() { st = null },
    cancel() { st = null },
    overlay(app, c, vp) {
      const r = app.crop
      if (!r) return
      const a = vp.d2s(r.x, r.y), z = vp.zoom, W = vp.W, H = vp.H
      c.save()
      c.fillStyle = 'rgba(0,0,0,.55)'
      c.beginPath(); c.rect(0, 0, W, H); c.rect(a.x, a.y, r.w * z, r.h * z); c.fill('evenodd')
      c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1
      for (let i = 1; i < 3; i++) { c.beginPath(); c.moveTo(a.x + (r.w * z * i) / 3, a.y); c.lineTo(a.x + (r.w * z * i) / 3, a.y + r.h * z); c.moveTo(a.x, a.y + (r.h * z * i) / 3); c.lineTo(a.x + r.w * z, a.y + (r.h * z * i) / 3); c.stroke() }
      c.restore()
      drawHandles(c, vp, r)
    },
  }
})()

const eyedropper = (() => {
  const sample = (app, e, p) => {
    const d = app.doc, x = Math.floor(p.x), y = Math.floor(p.y)
    if (x < 0 || y < 0 || x >= d.w || y >= d.h) return
    let px
    const L = d.active
    if (app.toolOpts().sample === 'layer' && L?.type === 'raster') {
      const lx = x - L.x, ly = y - L.y
      if (lx < 0 || ly < 0 || lx >= L.canvas.width || ly >= L.canvas.height) return
      px = rctx(L.canvas).getImageData(lx, ly, 1, 1).data
    } else px = rctx(renderDoc(d, { rect: { x, y, w: 1, h: 1 } })).getImageData(0, 0, 1, 1).data
    if (px[3] === 0) return
    const hex = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
    if (e.altKey) app.setBg(hex); else app.setFg(hex)
  }
  return {
    id: 'eyedropper', name: 'Eyedropper', icon: 'pipette', key: 'i', cursor: 'crosshair', defaults: { sample: 'merged' },
    opts: [{ k: 'sample', label: 'Sample', type: 'seg', options: [['merged', 'All layers'], ['layer', 'Layer']] }],
    down: sample, move: sample,
  }
})()

const bucket = {
  id: 'bucket', name: 'Paint bucket', icon: 'paint-bucket', key: 'k', cursor: 'crosshair', defaults: { tolerance: 32, contiguous: true, opacity: 100, sampleAll: false },
  opts: [{ k: 'tolerance', label: 'Tolerance', type: 'range', min: 0, max: 128, step: 1 }, { k: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, fmt: (v) => `${v}%` },
    { k: 'contiguous', label: 'Contiguous', type: 'toggle' }, { k: 'sampleAll', label: 'All layers', type: 'toggle' }],
  down(app, e, p) {
    const t = app.paintTarget(); if (!t) return
    const d = app.doc, o = app.toolOpts()
    if (p.x < 0 || p.y < 0 || p.x >= d.w || p.y >= d.h) return
    let m
    if (t.target === 'mask') { // flood the mask itself
      const c = cv(d.w, d.h), cx = rctx(c); cx.drawImage(t.L.mask.canvas, 0, 0)
      const img = cx.getImageData(0, 0, d.w, d.h)
      m = floodMask(img.data, d.w, d.h, p.x, p.y, o.tolerance, o.contiguous)
    } else m = floodMask(layerPixels(app, o.sampleAll).data, d.w, d.h, p.x, p.y, o.tolerance, o.contiguous)
    if (d.w * d.h < 3e6) m = softenMask(m, d.w, d.h)
    if (d.sel) { const s = d.sel.mask; for (let i = 0; i < m.length; i++) m[i] = (m[i] * s[i]) / 255 }
    app.ops.fillMask(m, t, app.fg, o.opacity / 100, 'Paint bucket')
  },
}

const gradient = (() => {
  let st = null
  return {
    id: 'gradient', name: 'Gradient', icon: 'blend', key: 'g', cursor: 'crosshair', defaults: { type: 'linear', preset: 'fgbg', reverse: false, opacity: 100 },
    opts: [{ k: 'type', label: 'Type', type: 'seg', options: [['linear', 'Linear'], ['radial', 'Radial']] },
      { k: 'preset', label: 'Colors', type: 'select', options: [['fgbg', 'Foreground to background'], ['fgt', 'Foreground to transparent'], ['bw', 'Black to white']] },
      { k: 'reverse', label: 'Reverse', type: 'toggle' }, { k: 'opacity', label: 'Opacity', type: 'range', min: 1, max: 100, step: 1, fmt: (v) => `${v}%` }],
    down(app, e, p) { if (!app.paintTarget()) return; st = { a: p, b: p } },
    move(app, e, p) { if (!st) return; st.b = e.shiftKey ? snap45(st.a, p) : p; app.vp.invalidateOverlay() },
    up(app) {
      if (!st) return
      const { a, b } = st
      st = null
      app.vp.invalidateOverlay()
      if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return
      app.ops.applyGradient(a, b, app.toolOpts())
    },
    cancel() { st = null },
    overlay(app, c, vp) {
      if (!st) return
      const a = vp.d2s(st.a.x, st.a.y), b = vp.d2s(st.b.x, st.b.y)
      c.save(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke()
      c.lineWidth = 1; c.strokeStyle = '#000'; c.stroke()
      for (const q of [a, b]) { c.beginPath(); c.arc(q.x, q.y, 4, 0, 7); c.fillStyle = '#fff'; c.fill(); c.stroke() }
      c.restore()
    },
  }
})()
function snap45(a, p) {
  const dx = p.x - a.x, dy = p.y - a.y, r = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: a.x + Math.cos(ang) * r, y: a.y + Math.sin(ang) * r }
}

const text = {
  id: 'text', name: 'Text', icon: 'type', key: 't', cursor: 'text', defaults: { font: 'Geist', size: 96, bold: true, italic: false, align: 'left' },
  opts: [{ k: 'font', label: 'Font', type: 'select', options: 'fonts' }, { k: 'size', label: 'Size', type: 'range', min: 8, max: 600, step: 1, fmt: (v) => `${v}px` },
    { k: 'bold', label: 'Bold', type: 'toggle' }, { k: 'italic', label: 'Italic', type: 'toggle' },
    { k: 'align', label: 'Align', type: 'seg', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] }],
  down(app, e, p) {
    const d = app.doc, o = app.toolOpts()
    const hit = [...d.layers].reverse().find((L) => L.visible && L.type === 'text' && (() => { const b = layerBounds(L); return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h })())
    if (hit) { d.select(hit.id); app.focusText(); return }
    const L = textLayer({ text: 'Your text', x: Math.round(p.x), y: Math.round(p.y), font: o.font, size: o.size, bold: o.bold, italic: o.italic, align: o.align, color: app.fg })
    d.addLayer(L, 'Add text')
    app.focusText(true)
  },
}

const shapes = (() => {
  let st = null
  const KINDS = [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['triangle', 'Triangle'], ['polygon', 'Polygon'], ['star', 'Star']]
  const build = (app, a, b, shift) => {
    const o = app.toolOpts()
    let w = b.x - a.x, h = b.y - a.y
    if (o.kind === 'line') { if (shift) { const q = snap45(a, b); w = q.x - a.x; h = q.y - a.y } return { x: a.x, y: a.y, w, h } }
    if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m }
    return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) }
  }
  const make = (app, box) => {
    const o = app.toolOpts()
    return { ...box, kind: o.kind, fill: app.fg, hasFill: o.fill, stroke: o.kind === 'line' ? app.fg : app.bg, strokeW: o.kind === 'line' ? Math.max(2, o.strokeW) : o.strokeW, radius: o.kind === 'rect' ? o.radius : 0, sides: o.sides }
  }
  return {
    id: 'shapes', name: 'Shapes', icon: 'shapes', key: 'u', cursor: 'crosshair', defaults: { kind: 'rect', fill: true, strokeW: 0, radius: 0, sides: 5 },
    opts: [{ k: 'kind', label: 'Shape', type: 'select', options: KINDS }, { k: 'fill', label: 'Fill', type: 'toggle', title: 'Filled with the foreground color; outline uses the background color' },
      { k: 'strokeW', label: 'Outline', type: 'range', min: 0, max: 60, step: 1, fmt: (v) => `${v}px` }, { k: 'radius', label: 'Corner radius', type: 'range', min: 0, max: 300, step: 1, fmt: (v) => `${v}px` },
      { k: 'sides', label: 'Sides / points', type: 'range', min: 3, max: 12, step: 1 }],
    down(app, e, p) { st = { a: p, b: p, shift: false } },
    move(app, e, p) { if (!st) return; st.b = p; st.shift = e.shiftKey; app.vp.invalidateOverlay() },
    up(app, e, p) {
      if (!st) return
      const { a } = st
      let box = build(app, a, p, e.shiftKey)
      st = null
      app.vp.invalidateOverlay()
      if (Math.hypot(box.w, box.h) * app.vp.zoom < 6) { const s = 200; box = app.toolOpts().kind === 'line' ? { x: a.x, y: a.y, w: s, h: 0 } : { x: a.x - s / 2, y: a.y - s / 2, w: s, h: s } }
      const o = app.toolOpts()
      const L = shapeLayer(make(app, { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) }), KINDS.find((k) => k[0] === o.kind)[1])
      app.doc.addLayer(L, 'Add shape')
    },
    cancel() { st = null },
    overlay(app, c, vp) {
      if (!st) return
      const box = build(app, st.a, st.b, st.shift)
      c.save(); c.setTransform(vp.dpr * vp.zoom, 0, 0, vp.dpr * vp.zoom, vp.ox * vp.dpr, vp.oy * vp.dpr)
      c.globalAlpha = 0.75
      drawShape(c, make(app, box))
      c.restore()
    },
  }
})()

const zoom = {
  id: 'zoom', name: 'Zoom', icon: 'zoom-in', key: 'z', cursor: 'zoom-in', defaults: {},
  opts: [{ k: 'zoomFit', label: 'Fit', type: 'button', icon: 'scan', title: 'Fit on screen (Ctrl+0)' }, { k: 'zoom100', label: '100%', type: 'button', title: 'Actual pixels (Ctrl+1)' }],
  down(app, e, p) { app.vp.zoomBy(e.altKey ? 1 / 1.6 : 1.6, p.sx, p.sy) },
}
const hand = { id: 'hand', name: 'Hand', icon: 'hand', key: 'h', cursor: 'grab', defaults: {}, opts: [{ k: 'zoomFit', label: 'Fit', type: 'button', icon: 'scan' }, { k: 'zoom100', label: '100%', type: 'button' }], down() {} }

export const TOOLS = [
  move, marqueeTool('rect'), marqueeTool('ellipse'), lasso, wand, crop,
  brushLike('brush', 'Brush', 'brush', 'b', 'paint', { size: 28, hardness: 70, opacity: 100, pressure: true }),
  brushLike('eraser', 'Eraser', 'eraser', 'e', 'erase', { size: 48, hardness: 90, opacity: 100, pressure: true }),
  brushLike('clone', 'Clone stamp', 'stamp', 's', 'clone', { size: 48, hardness: 60, opacity: 100, aligned: true, pressure: false }),
  bucket, gradient, text, shapes, eyedropper, zoom, hand,
]
export const toolById = (id) => TOOLS.find((t) => t.id === id)
