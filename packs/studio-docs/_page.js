// Page setup: paper sizes, margins and per-document settings.
import { DEFAULT_FONT, DEFAULT_SIZE } from './_schema.js'

export const PAPERS = {
  a4: { name: 'A4', w: 210, h: 297 },
  letter: { name: 'Letter', w: 215.9, h: 279.4 },
  legal: { name: 'Legal', w: 215.9, h: 355.6 },
  a5: { name: 'A5', w: 148, h: 210 },
}
export const MARGIN_PRESETS = {
  normal: { name: 'Normal', top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  narrow: { name: 'Narrow', top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  moderate: { name: 'Moderate', top: 25.4, right: 19.1, bottom: 25.4, left: 19.1 },
  wide: { name: 'Wide', top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 },
}
export const MM_PX = 96 / 25.4
export const TWIPS_PER_MM = 1440 / 25.4

const { name: _n, ...NORMAL } = MARGIN_PRESETS.normal
export const defaultSettings = () => ({
  paper: 'a4', orient: 'portrait', margins: { ...NORMAL },
  pageNumbers: false, header: '', footer: '', font: DEFAULT_FONT, fontSize: DEFAULT_SIZE,
})

/** Fill missing keys so older or partial records always work. */
export function normSettings(s) {
  const d = defaultSettings()
  const out = { ...d, ...(s || {}) }
  out.margins = { ...d.margins, ...(s?.margins || {}) }
  if (!PAPERS[out.paper]) out.paper = 'a4'
  if (out.orient !== 'landscape') out.orient = 'portrait'
  for (const k of ['top', 'right', 'bottom', 'left']) out.margins[k] = Math.min(80, Math.max(0, Number(out.margins[k]) || 0))
  return out
}

/** Page size in mm after orientation. */
export function pageMm(s) {
  const p = PAPERS[s.paper] || PAPERS.a4
  return s.orient === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h }
}
export function pagePx(s) {
  const { w, h } = pageMm(s)
  const m = s.margins
  return { w: w * MM_PX, h: h * MM_PX, mt: m.top * MM_PX, mr: m.right * MM_PX, mb: m.bottom * MM_PX, ml: m.left * MM_PX }
}
export const contentWidthPx = (s) => { const p = pagePx(s); return Math.max(120, p.w - p.ml - p.mr) }

export function marginPresetName(s) {
  const m = s.margins
  for (const [id, p] of Object.entries(MARGIN_PRESETS)) if (['top', 'right', 'bottom', 'left'].every((k) => Math.abs(p[k] - m[k]) < 0.15)) return id
  return 'custom'
}
