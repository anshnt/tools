// Compositor: draws a document's layers (raster, text, shape, adjustment) with masks, opacity and blend modes
// into any 2D context through a view transform { ox, oy, s } (device x = ox + docX * s).
// Used for the on-screen canvas (viewport sized, so cost follows the screen, not the image), exports, merges and thumbnails.
import { clamp, cv, rctx, rectIntersect } from './_util.js'
import { applyAdjust } from './_adjust.js'

const scratchBuf = new Map() // keyed by slot and size so thumbnails never resize the big on-screen buffers
function scratch(slot, w, h) {
  const key = `${slot}:${w}x${h}`
  let s = scratchBuf.get(key)
  if (!s) {
    if (scratchBuf.size > 10) scratchBuf.delete(scratchBuf.keys().next().value)
    s = document.createElement('canvas')
    s.width = w; s.height = h
    s._ctx = rctx(s)
    scratchBuf.set(key, s)
  }
  const c = s._ctx
  c.setTransform(1, 0, 0, 1, 0, 0)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  return c
}

/** Draw `img` positioned at doc (ix, iy) onto c (identity transform), limited to device rect r. */
function blit(c, img, ix, iy, view, r) {
  const { ox, oy, s } = view
  const sx0 = clamp(Math.floor((r.x - ox) / s - ix) - 1, 0, img.width), sy0 = clamp(Math.floor((r.y - oy) / s - iy) - 1, 0, img.height)
  const sx1 = clamp(Math.ceil((r.x + r.w - ox) / s - ix) + 1, 0, img.width), sy1 = clamp(Math.ceil((r.y + r.h - oy) / s - iy) + 1, 0, img.height)
  if (sx1 <= sx0 || sy1 <= sy0) return
  c.imageSmoothingEnabled = s < 2
  c.imageSmoothingQuality = 'medium'
  c.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0, ox + (ix + sx0) * s, oy + (iy + sy0) * s, (sx1 - sx0) * s, (sy1 - sy0) * s)
}

// ---------- text and shapes ----------
const measureCtx = document.createElement('canvas').getContext('2d')
export const FONTS = ['Geist', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'system-ui', 'serif', 'monospace', 'cursive']
const GENERIC = /^(serif|sans-serif|monospace|cursive|system-ui)$/
export const fontString = (t) => `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px ${GENERIC.test(t.font) ? t.font : `"${t.font}"`}, sans-serif`

export function measureText(t) {
  measureCtx.font = fontString(t)
  const lines = String(t.text).split('\n')
  const widths = lines.map((l) => measureCtx.measureText(l || ' ').width)
  return { lines, widths, w: Math.max(1, ...widths), h: Math.max(1, lines.length * t.size * t.lineHeight) }
}
export function textBounds(t) {
  const m = measureText(t)
  const x = t.align === 'center' ? t.x - m.w / 2 : t.align === 'right' ? t.x - m.w : t.x
  return { x, y: t.y, w: m.w, h: m.h }
}
export function drawText(c, t, scale = 1) {
  const m = measureText(t), lh = t.size * t.lineHeight
  c.save()
  c.font = fontString(t)
  c.textBaseline = 'top'
  c.textAlign = t.align
  c.fillStyle = t.color
  if (t.shadow) { c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = t.size * 0.12 * scale; c.shadowOffsetY = t.size * 0.05 * scale }
  m.lines.forEach((ln, i) => {
    const y = t.y + i * lh + (lh - t.size) / 2
    if (t.strokeW > 0) { c.lineWidth = t.strokeW * 2; c.strokeStyle = t.strokeColor; c.lineJoin = 'round'; c.strokeText(ln, t.x, y) }
    c.fillText(ln, t.x, y)
  })
  c.restore()
}

export function shapePath(c, sh) {
  const { x, y, w, h } = sh
  c.beginPath()
  if (sh.kind === 'ellipse') c.ellipse(x + w / 2, y + h / 2, Math.max(0.01, Math.abs(w) / 2), Math.max(0.01, Math.abs(h) / 2), 0, 0, Math.PI * 2)
  else if (sh.kind === 'line') { c.moveTo(x, y); c.lineTo(x + w, y + h) }
  else if (sh.kind === 'triangle') { c.moveTo(x + w / 2, y); c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.closePath() }
  else if (sh.kind === 'polygon' || sh.kind === 'star') {
    const n = Math.max(3, sh.sides | 0), pts = sh.kind === 'star' ? n * 2 : n
    for (let i = 0; i < pts; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / pts, rad = sh.kind === 'star' && i % 2 ? 0.45 : 1
      const px = x + w / 2 + (Math.cos(a) * w * rad) / 2, py = y + h / 2 + (Math.sin(a) * h * rad) / 2
      i ? c.lineTo(px, py) : c.moveTo(px, py)
    }
    c.closePath()
  } else if (sh.radius > 0 && c.roundRect) c.roundRect(x, y, w, h, Math.min(sh.radius, Math.abs(w) / 2, Math.abs(h) / 2))
  else c.rect(x, y, w, h)
}
export function drawShape(c, sh) {
  shapePath(c, sh)
  if (sh.kind !== 'line' && sh.hasFill) { c.fillStyle = sh.fill; c.fill() }
  if (sh.strokeW > 0 || sh.kind === 'line') {
    c.lineWidth = Math.max(1, sh.strokeW); c.strokeStyle = sh.stroke; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke()
  }
}

/** Doc-space bounds of a layer (null for adjustment layers). */
export function layerBounds(L) {
  if (L.type === 'raster') return { x: L.x, y: L.y, w: L.canvas.width, h: L.canvas.height }
  if (L.type === 'text') return textBounds(L.text)
  if (L.type === 'shape') { const s = L.shape, pad = (s.strokeW || 0) / 2; return { x: Math.min(s.x, s.x + s.w) - pad, y: Math.min(s.y, s.y + s.h) - pad, w: Math.abs(s.w) + pad * 2, h: Math.abs(s.h) + pad * 2 } }
  return null
}

// ---------- compositor ----------
function paintLive(c, live, view, r, ix, iy) {
  c.globalAlpha = live.alpha ?? 1
  c.globalCompositeOperation = live.mode === 'erase' ? 'destination-out' : 'source-over'
  blit(c, live.canvas, ix, iy, view, r)
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
}

function paintContent(c, L, view, r, live, over) {
  if (L.type === 'raster') {
    blit(c, over ? over.canvas : L.canvas, L.x, L.y, view, r)
    if (live && live.target === 'layer') paintLive(c, live, view, r, L.x, L.y)
  } else {
    c.setTransform(view.s, 0, 0, view.s, view.ox, view.oy)
    if (L.type === 'text') drawText(c, L.text, view.s)
    else if (L.type === 'shape') drawShape(c, L.shape)
    c.setTransform(1, 0, 0, 1, 0, 0)
  }
}

function maskInto(L, W, H, view, r, live) {
  const mc = scratch(1, W, H)
  mc.clearRect(r.x, r.y, r.w, r.h)
  blit(mc, L.mask.canvas, 0, 0, view, r)
  if (live && live.target === 'mask') paintLive(mc, live, view, r, 0, 0)
  return mc
}

function adjustLayer(acc, L, view, r, opts, W, H) {
  const k = opts.raw ? 1 : L.opacity
  if (k <= 0) return
  const maskOn = L.mask && L.maskOn && !opts.noMask
  const img = acc.getImageData(r.x, r.y, r.w, r.h)
  const d = img.data
  const orig = k < 1 || maskOn ? new Uint8ClampedArray(d) : null
  applyAdjust(d, L.adjust.kind, L.adjust.params)
  if (orig) {
    const md = maskOn ? maskInto(L, W, H, view, r, opts.live?.layerId === L.id ? opts.live : null).getImageData(r.x, r.y, r.w, r.h).data : null
    for (let i = 0; i < d.length; i += 4) {
      const w = md ? (k * md[i + 3]) / 255 : k
      d[i] = orig[i] + (d[i] - orig[i]) * w
      d[i + 1] = orig[i + 1] + (d[i + 1] - orig[i + 1]) * w
      d[i + 2] = orig[i + 2] + (d[i + 2] - orig[i + 2]) * w
    }
  }
  acc.putImageData(img, r.x, r.y)
}

/**
 * compose(doc, accCtx, view, rect?, opts?)
 *   rect: device-pixel rectangle to redraw (default: the whole canvas)
 *   opts.live: { layerId, target: 'layer'|'mask', canvas, mode: 'paint'|'erase', alpha } - an in-progress brush stroke shown on top of a layer
 *   opts.override: { layerId, canvas } - replace a raster layer's pixels (filter previews)
 *   opts.only: Set of layer ids to draw; opts.raw: true to ignore opacity/blend; opts.noMask: ignore masks
 */
export function compose(doc, acc, view, rect, opts = {}) {
  const W = acc.canvas.width, H = acc.canvas.height
  const r = rectIntersect(rect || { x: 0, y: 0, w: W, h: H }, { x: 0, y: 0, w: W, h: H })
  if (!r) return
  acc.save()
  acc.setTransform(1, 0, 0, 1, 0, 0)
  acc.globalAlpha = 1
  acc.globalCompositeOperation = 'source-over'
  acc.clearRect(r.x, r.y, r.w, r.h)
  acc.beginPath(); acc.rect(r.x, r.y, r.w, r.h); acc.clip()
  for (const L of doc.layers) {
    if ((!L.visible && !opts.showHidden) || (opts.only && !opts.only.has(L.id))) continue
    if (L.type === 'adjust') { adjustLayer(acc, L, view, r, opts, W, H); continue }
    const live = opts.live && opts.live.layerId === L.id ? opts.live : null
    const over = opts.override && opts.override.layerId === L.id ? opts.override : null
    const maskOn = L.mask && L.maskOn && !opts.noMask
    const alpha = opts.raw ? 1 : L.opacity, blend = opts.raw ? 'source-over' : L.blend
    if (L.type === 'raster' && !maskOn && !(live && live.target === 'layer')) {
      acc.globalAlpha = alpha; acc.globalCompositeOperation = blend
      paintContent(acc, L, view, r, live, over)
      acc.globalAlpha = 1; acc.globalCompositeOperation = 'source-over'
      continue
    }
    const sc = scratch(0, W, H)
    sc.clearRect(r.x, r.y, r.w, r.h)
    paintContent(sc, L, view, r, live, over)
    if (maskOn) {
      const mc = maskInto(L, W, H, view, r, live)
      sc.globalCompositeOperation = 'destination-in'
      sc.drawImage(mc.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
      sc.globalCompositeOperation = 'source-over'
    }
    acc.globalAlpha = alpha; acc.globalCompositeOperation = blend
    acc.drawImage(sc.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
    acc.globalAlpha = 1; acc.globalCompositeOperation = 'source-over'
  }
  acc.restore()
}

/** Render the whole document (or a sub-rect in doc px) at a scale into a new canvas. background fills transparency (e.g. white for JPG). */
export function renderDoc(doc, { scale = 1, background = null, rect = null, opts = {} } = {}) {
  const r = rect || { x: 0, y: 0, w: doc.w, h: doc.h }
  const w = Math.max(1, Math.round(r.w * scale)), h = Math.max(1, Math.round(r.h * scale))
  const a = cv(w, h)
  compose(doc, rctx(a), { ox: -r.x * scale, oy: -r.y * scale, s: scale }, null, opts)
  if (!background) return a
  const out = cv(w, h), ctx = rctx(out)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(a, 0, 0)
  return out
}

/** Tiny doc-proportional preview of one layer (raster, text or shape) for the layers panel. */
export function layerThumb(doc, L, size = 40) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  if (L.type === 'adjust') return c
  const s = Math.min(size / doc.w, size / doc.h)
  const view = { ox: (size - doc.w * s) / 2, oy: (size - doc.h * s) / 2, s }
  ctx.fillStyle = 'rgba(128,128,128,.18)'
  ctx.fillRect(view.ox, view.oy, doc.w * s, doc.h * s)
  const only = new Set([L.id])
  const tmp = document.createElement('canvas')
  tmp.width = tmp.height = size
  compose({ layers: [L] }, tmp.getContext('2d'), view, null, { only, raw: true, noMask: true })
  ctx.drawImage(tmp, 0, 0)
  return c
}

export function maskThumb(doc, L, size = 40) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const s = Math.min(size / doc.w, size / doc.h), w = doc.w * s, h = doc.h * s
  const x = (size - w) / 2, y = (size - h) / 2
  ctx.fillStyle = '#000'
  ctx.fillRect(x, y, w, h)
  const t = document.createElement('canvas')
  t.width = Math.max(1, Math.round(w)); t.height = Math.max(1, Math.round(h))
  const tc = t.getContext('2d')
  tc.drawImage(L.mask.canvas, 0, 0, t.width, t.height)
  tc.globalCompositeOperation = 'source-in'
  tc.fillStyle = '#fff'
  tc.fillRect(0, 0, t.width, t.height)
  ctx.drawImage(t, x, y)
  return c
}
