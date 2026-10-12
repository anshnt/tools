// Display units for Draw Studio. The document stores points; the UI shows mm, in, pt or px (px = 0.75 pt, the factor _svgin.js uses).
// The y flip lives here and nowhere else: UI y is measured UP from the page bottom-left by default (yUp), as in the desktop editor convention.
export const PT_PER = { mm: 72 / 25.4, in: 72, pt: 1, px: 0.75 }
export const UNITS_LIST = ['mm', 'in', 'pt', 'px']
const DECIMALS = { mm: 2, in: 3, pt: 2, px: 1 }

export const toUnit = (pt, unit = 'mm') => pt / (PT_PER[unit] || 1)
export const fromUnit = (v, unit = 'mm') => v * (PT_PER[unit] || 1)
/** '12.34' style text, trailing zeros trimmed. */
export function fmt(pt, unit = 'mm', withUnit = false) {
  const v = toUnit(pt, unit)
  const s = (Math.round(v * 10 ** DECIMALS[unit]) / 10 ** DECIMALS[unit]).toString()
  return withUnit ? `${s} ${unit}` : s
}
/** Page point (x, y down from the top) to UI coordinates in `unit` (y up from the bottom unless yUp is false). */
export function pageToUi(page, x, y, { unit = 'mm', yUp = true } = {}) {
  return [toUnit(x, unit), toUnit(yUp ? page.h - y : y, unit)]
}
/** Inverse of pageToUi: UI numbers back to page points. */
export function uiToPage(page, ux, uy, { unit = 'mm', yUp = true } = {}) {
  const y = fromUnit(uy, unit)
  return [fromUnit(ux, unit), yUp ? page.h - y : y]
}
/** Smallest 1, 2 or 5 times 10^k (in `unit`) that leaves at least `minPx` screen pixels between labelled ticks at `zoom` (screen px per point). */
export function niceStep(zoom, unit = 'mm', minPx = 50) {
  const raw = minPx / (zoom * (PT_PER[unit] || 1))
  const p = 10 ** Math.floor(Math.log10(raw))
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p
  return 10 * p
}
/** Default grid spacing in points for a unit: 10 mm, half an inch, 36 pt or 32 px. */
export const defaultGrid = (unit) => ({ mm: 10 * PT_PER.mm, in: 36, pt: 36, px: 24 })[unit] || 36
