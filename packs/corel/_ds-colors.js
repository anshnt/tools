// Colour helpers for Draw Studio. Colours are RGB hex in the document and in every file; CMYK is a display convenience only.
import { cmykToRgb } from './_model.js'

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)))
const h2 = (v) => clamp255(v).toString(16).padStart(2, '0')
export const normHex = (s) => {
  s = String(s ?? '').trim().toLowerCase().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/.test(s)) s = [...s].map((c) => c + c).join('')
  return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null
}
export const hexToRgb = (hex) => { const v = parseInt((normHex(hex) || '#000000').slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255] }
export const rgbToHex = (r, g, b) => '#' + h2(r) + h2(g) + h2(b)
/** [c,m,y,k] in 0..1 from RGB 0..255 (plain conversion, no colour management). */
export function cmykFromRgb(r, g, b) {
  const k = 1 - Math.max(r, g, b) / 255
  if (k >= 1) return [0, 0, 0, 1]
  return [(1 - r / 255 - k) / (1 - k), (1 - g / 255 - k) / (1 - k), (1 - b / 255 - k) / (1 - k), k]
}
/** RGB 0..255 (rounded) from [c,m,y,k] in 0..1. */
export const rgbFromCmyk = (c, m, y, k) => cmykToRgb(c, m, y, k).map(clamp255)
export function hslFromRgb(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}
export function rgbFromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [clamp255((r + m) * 255), clamp255((g + m) * 255), clamp255((b + m) * 255)]
}

/** About 100 swatches generated from tables: a grey ramp, then hues at several lightness steps. */
function makePalette() {
  const out = []
  for (let i = 0; i < 12; i++) { const v = Math.round((255 * (11 - i)) / 11); out.push(rgbToHex(v, v, v)) }
  const hues = [0, 20, 40, 55, 75, 120, 160, 185, 205, 225, 255, 285, 315, 340]
  for (const l of [0.88, 0.76, 0.64, 0.52, 0.4, 0.28]) for (const hh of hues) out.push(rgbToHex(...rgbFromHsl(hh, l > 0.8 || l < 0.3 ? 0.55 : 0.85, l)))
  return out
}
export const DEFAULT_PALETTE = makePalette()

/** Colours used on a page, most used first: [{hex, count}]. Looks at fills and strokes (gradient stops count too). Capped at 20k items. */
export function usedColors(root, pageId, cap = 20000) {
  const page = root.pages.find((p) => p.id === pageId) || root.pages[0]
  const counts = new Map()
  let seen = 0
  const bump = (c) => { if (c) counts.set(c, (counts.get(c) || 0) + 1) }
  const rec = (items) => {
    for (const n of items) {
      if (seen++ > cap) return
      if (n.t === 'group') rec(n.items)
      else if (n.t === 'path') {
        if (n.fill && typeof n.fill === 'object') for (const s of n.fill.stops) bump(s.c); else bump(n.fill)
        bump(n.stroke)
      } else if (n.t === 'text') bump(n.fill)
    }
  }
  for (const l of page?.layers || []) rec(l.items)
  return [...counts].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count)
}
