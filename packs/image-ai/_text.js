// Text helpers for "Edit text in image": find the text pixels inside a box, estimate colour, font, size and spacing, and draw
// replacement text with canvas. Pure canvas code, no network.
import { canvas as makeCanvas } from '../../lib/image.js'
import { pushPullFill } from './_inpaint.js'

export const FONTS = [
  { key: 'sans', label: 'Arial', css: 'Arial, Helvetica, "Liberation Sans", sans-serif' },
  { key: 'verdana', label: 'Verdana', css: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
  { key: 'tahoma', label: 'Tahoma', css: 'Tahoma, "Segoe UI", Geneva, sans-serif' },
  { key: 'trebuchet', label: 'Trebuchet MS', css: '"Trebuchet MS", "Lucida Grande", sans-serif' },
  { key: 'georgia', label: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  { key: 'times', label: 'Times New Roman', css: '"Times New Roman", Times, "Liberation Serif", serif' },
  { key: 'palatino', label: 'Palatino', css: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  { key: 'courier', label: 'Courier New', css: '"Courier New", Courier, "Liberation Mono", monospace' },
  { key: 'impact', label: 'Impact', css: 'Impact, "Arial Narrow Bold", "Arial Black", sans-serif' },
]
const CSS = Object.fromEntries(FONTS.map((f) => [f.key, f.css]))
const GUESS = ['sans', 'verdana', 'trebuchet', 'georgia', 'times', 'courier', 'impact']

export const fontString = (e, size) => `${e.italic ? 'italic ' : ''}${e.bold ? '700' : '400'} ${size}px ${CSS[e.family] || CSS.sans}`
export const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// ---------------------------------------------------------------- finding the text pixels

function otsu(hist, total) {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let wB = 0, sB = 0, best = -1, t = 0
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sB += i * hist[i]
    const d = sB / wB - (sum - sB) / wF
    const v = wB * wF * d * d
    if (v > best) { best = v; t = i }
  }
  return t
}

/**
 * Look inside `box` ({x, y, w, h} in pixels of `src`) and separate text from background.
 * The background is rebuilt from the pixels just outside the box (so gradients survive), then pixels that differ clearly
 * from it are the text. -> {ink: {x, y, w, h}, mask (Uint8, size reg.w * reg.h), reg: {x, y, w, h}, color: '#rrggbb', bg: [r, g, b], weak}
 * weak = no clear text pixels were found, so the whole box is used.
 */
export function analyze(src, box) {
  const W = src.width, H = src.height
  const inf = Math.max(1, Math.round(box.h * 0.08))
  const pad = Math.max(4, Math.round(box.h * 0.4)) + inf
  const bx0 = clamp(Math.floor(box.x) - inf, 0, W - 1), by0 = clamp(Math.floor(box.y) - inf, 0, H - 1)
  const bx1 = clamp(Math.ceil(box.x + box.w) + inf, bx0 + 1, W), by1 = clamp(Math.ceil(box.y + box.h) + inf, by0 + 1, H)
  const rx0 = Math.max(0, bx0 - pad), ry0 = Math.max(0, by0 - pad), rx1 = Math.min(W, bx1 + pad), ry1 = Math.min(H, by1 + pad)
  const rw = rx1 - rx0, rh = ry1 - ry0
  const id = src.getContext('2d', { willReadFrequently: true }).getImageData(rx0, ry0, rw, rh)
  const d = id.data
  const inBox = (x, y) => x >= bx0 - rx0 && x < bx1 - rx0 && y >= by0 - ry0 && y < by1 - ry0
  const hole = new Uint8Array(rw * rh)
  let known = 0
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { if (inBox(x, y)) hole[y * rw + x] = 1; else known++ }
  const bgData = new Uint8ClampedArray(d)
  if (known) pushPullFill(bgData, hole, rw, rh)
  else {
    let r = 0, g = 0, b = 0
    for (let i = 0; i < rw * rh; i++) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2] }
    const n = rw * rh
    for (let i = 0; i < rw * rh; i++) { bgData[i * 4] = r / n; bgData[i * 4 + 1] = g / n; bgData[i * 4 + 2] = b / n }
  }
  const dist = new Uint8Array(rw * rh)
  const hist = new Uint32Array(256)
  let total = 0, maxD = 0
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (!hole[y * rw + x]) continue
      const i = y * rw + x
      const v = Math.round((Math.abs(d[i * 4] - bgData[i * 4]) + Math.abs(d[i * 4 + 1] - bgData[i * 4 + 1]) + Math.abs(d[i * 4 + 2] - bgData[i * 4 + 2])) / 3)
      dist[i] = v; hist[v]++; total++
      if (v > maxD) maxD = v
    }
  }
  const T = clamp(otsu(hist, total), 14, 140)
  const mask = new Uint8Array(rw * rh)
  let count = 0, x0 = rw, y0 = rh, x1 = -1, y1 = -1
  if (maxD > T) {
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x
        if (hole[i] && dist[i] > T) { mask[i] = 1; count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
      }
    }
  }
  // mean background colour around the box (used to pad OCR crops)
  let br = 0, bgc = 0, bb = 0, bn = 0
  for (let i = 0; i < rw * rh; i += 3) if (!hole[i]) { br += d[i * 4]; bgc += d[i * 4 + 1]; bb += d[i * 4 + 2]; bn++ }
  const bg = bn ? [br / bn, bgc / bn, bb / bn] : [bgData[0], bgData[1], bgData[2]]
  const reg = { x: rx0, y: ry0, w: rw, h: rh }
  const lum = (bg[0] * 0.299 + bg[1] * 0.587 + bg[2] * 0.114)
  if (count < 6) {
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) if (hole[y * rw + x]) mask[y * rw + x] = 1
    return { ink: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, mask, reg, color: lum > 140 ? '#111111' : '#ffffff', bg, weak: true }
  }
  // text colour: average of the strongest pixels
  const ds = []
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) ds.push(dist[i])
  ds.sort((a, b) => a - b)
  const cut = ds[Math.floor(ds.length * 0.97)] * 0.7
  let r = 0, g = 0, b = 0, n = 0
  for (let i = 0; i < mask.length; i++) if (mask[i] && dist[i] >= cut) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++ }
  return { ink: { x: rx0 + x0, y: ry0 + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, mask, reg, color: toHex(r / n, g / n, b / n), bg, weak: false }
}

// ---------------------------------------------------------------- guessing the font

const GW = 200, GH = 48
const scratch = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }

/** Render `text` at 100 px, crop to its ink and squash to a GW x GH bitmap. -> {bits, w, h} (w, h = ink size at 100 px) */
function textBits(text, e) {
  const m = scratch(8, 8).getContext('2d')
  m.font = fontString(e, 100)
  const width = Math.ceil(m.measureText(text).width) + 80
  const c = scratch(Math.min(width, 6000), 220)
  const x = c.getContext('2d', { willReadFrequently: true })
  x.font = fontString(e, 100)
  x.textBaseline = 'alphabetic'
  x.fillStyle = '#000'
  x.fillText(text, 40, 150)
  const d = x.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1
  for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3] > 60) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return null
  const g = scratch(GW, GH)
  const gx = g.getContext('2d', { willReadFrequently: true })
  gx.drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, GW, GH)
  return { bits: binarize(gx), w: x1 - x0 + 1, h: y1 - y0 + 1 }
}
function binarize(gx) {
  const d = gx.getImageData(0, 0, GW, GH).data
  const bits = new Uint8Array(GW * GH)
  for (let i = 0; i < bits.length; i++) bits[i] = d[i * 4 + 3] > 110 ? 1 : 0
  return bits
}
function maskBits(an) {
  const { ink, mask, reg } = an
  const c = scratch(ink.w, ink.h)
  const x = c.getContext('2d')
  const id = x.createImageData(ink.w, ink.h)
  for (let y = 0; y < ink.h; y++) {
    for (let xx = 0; xx < ink.w; xx++) {
      if (mask[(ink.y - reg.y + y) * reg.w + (ink.x - reg.x + xx)]) id.data[(y * ink.w + xx) * 4 + 3] = 255
    }
  }
  x.putImageData(id, 0, 0)
  const g = scratch(GW, GH)
  const gx = g.getContext('2d', { willReadFrequently: true })
  gx.drawImage(c, 0, 0, GW, GH)
  return binarize(gx)
}
const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++ } return u ? i / u : 0 }

/**
 * Pick the closest of our fonts for the pixels in `an` by overlaying each rendering of `text` on the real text shape.
 * -> {family, bold, italic, size, spacing, base}  (base = baseline y in image pixels)
 */
export function guessStyle(an, text) {
  const ink = an.ink
  const one = text.replace(/\s+/g, ' ').trim()
  let e = { family: 'sans', bold: false, italic: false }
  let size = Math.max(6, ink.h / 0.93), spacing = 0
  if (!an.weak && one.length >= 2 && one.length <= 60 && !text.includes('\n')) {
    const target = maskBits(an)
    let best = -1, bestBits = null
    for (const family of GUESS) {
      for (const bold of [false, true]) {
        for (const italic of [false, true]) {
          const cand = { family, bold, italic }
          const t = textBits(one, cand)
          const s = t ? iou(target, t.bits) : -1
          if (s > best) { best = s; e = cand; bestBits = t }
        }
      }
    }
    if (bestBits) {
      const sH = (100 * ink.h) / bestBits.h, sW = (100 * ink.w) / bestBits.w
      size = Math.sqrt(sH * sW)
      spacing = one.length > 1 ? clamp((ink.w - (bestBits.w * size) / 100) / (one.length - 1), -0.05 * size, 0.25 * size) : 0
    }
  }
  size = Math.round(size * 2) / 2
  spacing = Math.round(spacing * 10) / 10
  const m = scratch(8, 8).getContext('2d')
  m.font = fontString(e, size)
  const lines = text.split('\n')
  const descent = one ? m.measureText(lines[lines.length - 1]).actualBoundingBoxDescent : 0
  const base = lines.length > 1 ? ink.y + ink.h * 0.8 : ink.y + ink.h - descent
  return { ...e, size, spacing, base }
}

// ---------------------------------------------------------------- drawing

/** Measure lines for an edit, shrinking the size when `fit` is on and the text is wider than the original. */
export function layout(ctx, e) {
  const lines = e.text.split('\n')
  let size = e.size, spacing = e.spacing
  const measure = () => {
    ctx.font = fontString(e, size)
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`
    return lines.map((l) => ctx.measureText(l))
  }
  let ms = measure()
  const widest = Math.max(...ms.map((m) => m.width))
  if (e.fit && e.box.w > 4 && widest > e.box.w) {
    const k = e.box.w / widest
    size = Math.max(4, size * k); spacing *= k
    ms = measure()
  }
  return { lines, ms, size }
}

/** Draw one edit onto ctx (k = scale from image pixels to ctx pixels). Skips untouched, erased and empty edits. */
export function drawText(ctx, e, k = 1) {
  if (!e.touched || e.deleted || !e.text.trim()) return
  ctx.save()
  ctx.scale(k, k)
  const { lines, ms, size } = layout(ctx, e)
  const b = e.box
  ctx.fillStyle = e.color
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const ax = b.x + e.dx + (e.align === 'left' ? 0 : e.align === 'center' ? b.w / 2 : b.w)
  if (e.rot) {
    ctx.translate(b.x + e.dx + b.w / 2, b.y + e.dy + b.h / 2)
    ctx.rotate((e.rot * Math.PI) / 180)
    ctx.translate(-(b.x + e.dx + b.w / 2), -(b.y + e.dy + b.h / 2))
  }
  lines.forEach((l, i) => {
    const m = ms[i]
    const abl = m.actualBoundingBoxLeft || 0, abr = m.actualBoundingBoxRight || m.width
    const x = e.align === 'left' ? ax + abl : e.align === 'center' ? ax - (abr - abl) / 2 : ax - abr
    ctx.fillText(l, x, e.base + e.dy + i * size * 1.2)
  })
  ctx.restore()
}

/** Make a throwaway canvas the size of a crop, padded with the background colour (OCR likes a margin). */
export function paddedCrop(src, box, bg, scale = 1, margin = 12) {
  const w = Math.round(box.w * scale), h = Math.round(box.h * scale)
  const c = makeCanvas(w + margin * 2, h + margin * 2)
  const x = c.getContext('2d')
  x.fillStyle = toHex(...bg)
  x.fillRect(0, 0, c.width, c.height)
  x.imageSmoothingQuality = 'high'
  x.drawImage(src, box.x, box.y, box.w, box.h, margin, margin, w, h)
  return c
}
