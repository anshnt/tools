// Slides Studio document model: plain JSON objects, factories and helpers. No DOM in here, so it is easy to test.
//
// deck   { v, title, w, h, theme, slides: [slide] }      w/h in points (960 x 540 = 13.33in x 7.5in, 1pt = 1 CSS px on the stage)
// slide  { id, layout, bg, notes, tr, elements: [el] }   bg: null | { c1, c2?, ang? }   tr: transition id
// el     { id, type: text|shape|line|image|table, x, y, w, h, rot, op, ph? ... }
// colour values are '#rrggbb' or a theme token such as '@accent' (resolved by the theme, so switching theme recolours the deck)

export const uid = (p = 'e') => `${p}${Math.random().toString(36).slice(2, 8)}${(Date.now() % 1e6).toString(36)}`
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const round = (v, d = 1) => { const k = 10 ** d; return Math.round(v * k) / k }
export const clone = (o) => JSON.parse(JSON.stringify(o))

/** [name, css stack]. Only fonts that ship with Windows, macOS and Office, so PPTX export looks the same in PowerPoint. */
export const FONTS = [
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Calibri', "Calibri, Carlito, 'Segoe UI', Arial, sans-serif"],
  ['Segoe UI', "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"],
  ['Trebuchet MS', "'Trebuchet MS', 'Lucida Grande', Arial, sans-serif"],
  ['Verdana', 'Verdana, Geneva, sans-serif'],
  ['Tahoma', 'Tahoma, Geneva, sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Cambria', 'Cambria, Georgia, serif'],
  ['Palatino Linotype', "'Palatino Linotype', 'Book Antiqua', Palatino, serif"],
  ['Times New Roman', "'Times New Roman', Times, serif"],
  ['Courier New', "'Courier New', Courier, monospace"],
  ['Impact', "Impact, 'Arial Narrow Bold', sans-serif"],
]
export const fontStack = (name) => FONTS.find((f) => f[0] === name)?.[1] || `'${String(name).replace(/['"\\]/g, '')}', Arial, sans-serif`
export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 54, 60, 72, 96]

export const SHAPES = [
  ['rect', 'Rectangle'], ['roundRect', 'Rounded rectangle'], ['ellipse', 'Oval'], ['triangle', 'Triangle'], ['rtTriangle', 'Right triangle'],
  ['diamond', 'Diamond'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['octagon', 'Octagon'], ['parallelogram', 'Parallelogram'],
  ['trapezoid', 'Trapezoid'], ['star4', '4-point star'], ['star5', '5-point star'], ['rightArrow', 'Right arrow'], ['leftArrow', 'Left arrow'],
  ['chevron', 'Chevron'], ['mathPlus', 'Plus'], ['heart', 'Heart'], ['wedgeRoundRectCallout', 'Speech bubble'], ['donut', 'Ring'],
]
export const SHAPE_ICON = { rect: 'square', roundRect: 'rectangle-horizontal', ellipse: 'circle', triangle: 'triangle', diamond: 'diamond', pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', star5: 'star', rightArrow: 'arrow-right', heart: 'heart' }

export const TRANSITIONS = [['none', 'None'], ['fade', 'Fade'], ['slide', 'Slide'], ['zoom', 'Zoom']]
export const SIZES = [['16:9', 'Widescreen 16:9', 960, 540], ['4:3', 'Standard 4:3', 720, 540], ['16:10', 'Wide 16:10', 864, 540]]

// ---------- Text ----------
export const textBase = (o = {}) => ({ font: '@body', size: 24, color: '@text', b: false, i: false, a: 'left', va: 'top', lh: 1, ps: 0, pad: 8, ...o })
export const para = (text = '', extra = {}) => ({ runs: [{ t: text }], ...extra })
/** 'a\nb' -> paragraphs. Lines starting with "- " or "* " become bullets, indentation (2 spaces or a tab) becomes the level. */
export function parasFrom(text, { bullets = false } = {}) {
  return String(text ?? '').split(/\r?\n/).map((line) => {
    const m = /^(\s*)([-*\u2022]\s+)?(.*)$/.exec(line)
    const lv = Math.min(4, Math.floor(m[1].replace(/\t/g, '  ').length / 2))
    const p = para(m[3])
    if (m[2] || bullets) p.bu = 'dot'
    if (lv && p.bu) p.lv = lv
    return p
  })
}
export const plain = (tx) => (tx?.paras || []).map((p) => p.runs.map((r) => r.t).join('')).join('\n')
export const isEmptyText = (tx) => !plain(tx).trim()
export const isEmptyEl = (e) => (e.type === 'text' || e.type === 'shape' ? isEmptyText(e.tx) : e.type === 'image' ? !e.asset : false)

// ---------- Elements ----------
const base = (type, o) => ({ id: uid(), type, x: 80, y: 80, w: 200, h: 100, rot: 0, op: 1, ...o })
export const textEl = (o = {}) => base('text', { w: 360, h: 56, ...o, tx: { ...textBase({ auto: true }), paras: [para('')], ...(o.tx || {}) } })
export const shapeEl = (shape = 'rect', o = {}) => base('shape', {
  shape, fill: '@accent', stroke: '', sw: 0, dash: '', rad: 0.2, w: 220, h: 140, ...o,
  tx: { ...textBase({ size: 22, color: '@onAccent', a: 'center', va: 'middle' }), paras: [para('')], ...(o.tx || {}) },
})
export const lineEl = (o = {}) => base('line', { stroke: '@text', sw: 3, dash: '', as: false, ae: false, fh: false, fv: false, w: 240, h: 0, ...o })
export const imageEl = (asset, o = {}) => base('image', { asset, fit: 'contain', rad: 0, stroke: '', sw: 0, alt: '', ...o })
export function tableEl(rows = 3, cols = 3, o = {}) {
  const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === 0 ? `Header ${c + 1}` : '')))
  return base('table', { cells, colw: Array(cols).fill(1 / cols), hdr: true, band: true, size: 18, w: 600, h: rows * 44, ...o })
}

export const isTextual = (e) => e.type === 'text' || e.type === 'shape'
export const bboxOf = (els) => {
  if (!els.length) return null
  const x1 = Math.min(...els.map((e) => e.x)), y1 = Math.min(...els.map((e) => e.y))
  const x2 = Math.max(...els.map((e) => e.x + e.w)), y2 = Math.max(...els.map((e) => e.y + e.h))
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

// ---------- Deck ----------
export const newDeck = (o = {}) => ({ v: 1, title: 'Untitled deck', w: 960, h: 540, theme: 'aurora', slides: [], ...o })

const TYPES = new Set(['text', 'shape', 'line', 'image', 'table'])
/** Fill in anything a foreign or older element is missing so the renderer never throws. */
function fixElement(e) {
  const out = {
    op: 1, rot: 0, ...e, id: e.id || uid(),
    x: Number(e.x) || 0, y: Number(e.y) || 0, w: Math.max(0, Number(e.w) || 0), h: Math.max(0, Number(e.h) || 0),
  }
  if (out.type === 'text' || out.type === 'shape') {
    out.tx = { ...textBase(), ...(out.tx || {}) }
    if (!Array.isArray(out.tx.paras) || !out.tx.paras.length) out.tx.paras = [para('')]
    out.tx.paras = out.tx.paras.map((p) => ({ ...p, runs: Array.isArray(p.runs) && p.runs.length ? p.runs.map((r) => ({ ...r, t: String(r.t ?? '') })) : [{ t: '' }] }))
  }
  if (out.type === 'shape') out.shape ||= 'rect'
  if (out.type === 'table') {
    const cells = Array.isArray(out.cells) && out.cells.length && Array.isArray(out.cells[0]) ? out.cells : [['']]
    out.cells = cells.map((r) => Array.from({ length: cells[0].length }, (_, i) => String(r[i] ?? '')))
    if (!Array.isArray(out.colw) || out.colw.length !== out.cells[0].length) out.colw = Array(out.cells[0].length).fill(1 / out.cells[0].length)
  }
  return out
}

/** Make a possibly foreign or older deck safe to render (used on load, import and undo). */
export function normalizeDeck(d) {
  const deck = { ...newDeck(), ...d }
  deck.w = clamp(Number(deck.w) || 960, 240, 4000)
  deck.h = clamp(Number(deck.h) || 540, 240, 4000)
  deck.title = String(deck.title || 'Untitled deck').slice(0, 120)
  deck.slides = (Array.isArray(deck.slides) ? deck.slides : []).map((s) => ({
    id: s.id || uid('s'), layout: s.layout || 'blank', bg: s.bg || null, notes: String(s.notes || ''), tr: s.tr || 'none', ...(s.plain ? { plain: true } : {}),
    elements: (Array.isArray(s.elements) ? s.elements : []).filter((e) => e && TYPES.has(e.type)).map(fixElement),
  }))
  return deck
}

/** Outline text to slide specs: an unindented line starts a slide, indented or "- " lines are its bullets (nesting by indentation). */
export function parseOutline(text) {
  const slides = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue
    const heading = /^#{1,2}\s+(.*)$/.exec(raw)
    const indent = raw.replace(/\t/g, '  ').match(/^\s*/)[0].length
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw)
    if (heading || (!bullet && indent === 0) || !slides.length) {
      slides.push({ title: (heading ? heading[1] : raw).trim(), lines: [] })
      continue
    }
    slides.at(-1).lines.push({ t: (bullet ? bullet[1] : raw).trim(), indent })
  }
  return slides.map((s) => {
    const base = Math.min(...s.lines.map((l) => l.indent), 99)
    return { title: s.title, bullets: s.lines.map((l) => ({ t: l.t, lv: Math.min(4, Math.round((l.indent - base) / 2)) })) }
  })
}

/** Rotate a point around a centre (degrees). */
export function rotatePoint(px, py, cx, cy, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c]
}

/** Line endpoints in slide coordinates from the box and flip flags. */
export function linePoints(e) {
  const x1 = e.x + (e.fh ? e.w : 0), y1 = e.y + (e.fv ? e.h : 0)
  return [[x1, y1], [e.x + (e.fh ? 0 : e.w), e.y + (e.fv ? 0 : e.h)]]
}
export function lineFromPoints(e, [x1, y1], [x2, y2]) {
  e.x = Math.min(x1, x2); e.y = Math.min(y1, y2); e.w = Math.abs(x2 - x1); e.h = Math.abs(y2 - y1)
  e.fh = x1 > x2; e.fv = y1 > y2
}

export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return null
  const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
export const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`
/** Any CSS colour string to '#rrggbb' (returns '' for transparent). */
export function cssToHex(c) {
  if (!c) return ''
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(c.trim())
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return ''
    return rgbToHex(+m[1], +m[2], +m[3])
  }
  const rgb = hexToRgb(c)
  return rgb ? rgbToHex(...rgb) : ''
}
/** Perceived brightness 0..255, for choosing readable text on a fill. */
export const luma = (hex) => { const c = hexToRgb(hex); return c ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : 255 }
