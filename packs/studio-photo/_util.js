// Small shared helpers for the Photo Studio modules (math, colors, canvases, rectangles).
import { canvas as libCanvas } from '../../lib/image.js'

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const round = Math.round

let counter = 0
export const uid = () => `l${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** Canvas with a size guard (throws a friendly error when the area is too large for this device). */
export const cv = (w, h) => libCanvas(w, h)
/** 2D context tuned for frequent pixel reads (layers, masks, scratch buffers). */
export const rctx = (c) => c.getContext('2d', { willReadFrequently: true })
export const sctx = (c) => c.getContext('2d')

export function copyCanvas(c) {
  const n = cv(c.width, c.height)
  rctx(n).drawImage(c, 0, 0)
  return n
}

// ---------- colors ----------
export function hexToRgb(hex) {
  let s = String(hex || '#000').replace('#', '')
  if (s.length === 3) s = s.split('').map((x) => x + x).join('')
  const n = parseInt(s.slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
export const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
export const rgba = (hex, a = 1) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})` }

/** r,g,b 0..255 -> h 0..360, s 0..1, l 0..1 */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return [h, s, l]
}
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360
  if (s === 0) { const v = l * 255; return [v, v, v] }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const f = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

// ---------- rectangles {x, y, w, h} ----------
export const rect = (x, y, w, h) => ({ x, y, w, h })
export function rectIntersect(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}
export function rectUnion(a, b) {
  if (!a) return b
  if (!b) return a
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y)
  return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 }
}
/** Round a rect outward to whole pixels, optionally padded. */
export const rectOut = (r, pad = 0) => {
  const x = Math.floor(r.x - pad), y = Math.floor(r.y - pad)
  return { x, y, w: Math.ceil(r.x + r.w + pad) - x, h: Math.ceil(r.y + r.h + pad) - y }
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** Download-safe file name pieces. */
export const stem = (name = 'Untitled') => name.replace(/\.[^.\/\\]+$/, '') || 'Untitled'

let heavyTail = Promise.resolve()
/** Run big encode jobs (autosave, export, project save) one at a time: several 12 MP encodes at once can exhaust browser memory. */
export const heavy = (fn) => (heavyTail = heavyTail.then(fn, fn))
