// Pure text helpers for Draw Studio: line layout (C1), font stacks with safe quoting, glyph x lists (C2), scale folding.
// No DOM: measuring is injected as measure(text) -> width in text units.
import { mul, translate } from './_model.js'

export const DEFAULT_LH = 1.2
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace'])
/** One family name ready for a CSS font-family attribute: control characters and <>{}; removed, quotes and backslashes escaped. Generic names stay bare. */
export function quoteFamily(name) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f<>{};]/g, '').trim().slice(0, 160)
  if (!s) return ''
  if (GENERIC.has(s.toLowerCase())) return s.toLowerCase()
  return `"${s.replace(/[\\"]/g, '\\$&')}"`
}
/** The bundled family (the one the curves export draws) that stands in for any family: sans -> Inter, serif -> Noto Serif, mono -> Roboto Mono. */
export function bundledFor(family = '') {
  const k = kindOf(family)
  return k === 'monospace' ? 'Roboto Mono' : k === 'serif' ? 'Noto Serif' : 'Inter'
}
export const faceFamily = (uid, key) => `ds${uid}-${String(key).replace(/[^\w-]/g, '_')}`
export const COMPLEX_FALLBACK = '"Nirmala UI","Noto Sans Devanagari",Mangal'
const kindOf = (family = '') => (/mono|courier|consolas|menlo|code/i.test(family) ? 'monospace' : /serif|times|georgia|garamond|palatino|cambria|book/i.test(family) && !/sans/i.test(family) ? 'serif' : 'sans-serif')

/**
 * font-family value for a text node: the embedded face first (when it loaded), then the node's own family, the complex-script
 * fallbacks, then a generic family. `faces` is the font registry state: {family(key), ok(key)}.
 */
export function fontStack(node, faces, uid) {
  const parts = []
  if (node.font != null && (!faces || faces.ok?.(node.font) !== false)) parts.push(quoteFamily(faces?.family?.(node.font) || faceFamily(uid, node.font)))
  const own = quoteFamily(node.family)
  if (own) parts.push(own)
  parts.push(quoteFamily(bundledFor(node.family)), COMPLEX_FALLBACK, kindOf(node.family)) // the bundled stand-in comes first, so a letter the font lacks looks the same on screen and in a curves export
  return [...new Set(parts.filter(Boolean))].join(',')
}

/** Lines of a text node: [{text, y}] with y = k * lh * size in text units (C1). measure(text) adds width. */
export function lineSplit(node, measure) {
  const lh = node.lh || DEFAULT_LH
  return String(node.str ?? '').split('\n').map((text, k) => ({ text, y: k * lh * node.size, ...(measure ? { width: measure(text) } : {}) }))
}
/** Horizontal start offset of a line of width w for an alignment: the origin is the start, centre or end of the line (C1). */
export const bakeAlign = (align, w) => (align === 'center' ? -w / 2 : align === 'right' ? -w : 0)

/** Single-line, left-aligned Text items for writers: one per line with the alignment baked into m. glyphs stay only on single-line text. */
export function bakeLines(node, measure) {
  const lines = lineSplit(node, measure)
  const { lh, align, ...rest } = node
  const keepGlyphs = lines.length === 1 && !(align === 'center' || align === 'right')
  return lines.map((ln, k) => {
    const o = { ...rest, str: ln.text, m: mul(node.m, translate(bakeAlign(align, ln.width || 0), ln.y)) }
    if (!keepGlyphs || k) delete o.glyphs
    if (k) delete o.id
    return o
  })
}

/** x attribute list for glyph-exact SVG text: one value per UTF-16 unit, astral characters repeat their offset. */
export function glyphXList(node) {
  const xs = []
  for (const g of node.glyphs || []) for (let i = 0; i < g.c.length; i++) xs.push(g.x)
  return xs
}
export const glyphString = (node) => (node.glyphs || []).map((g) => g.c).join('')

/** Fold a uniform positive scale with no rotation or skew into size (and glyph x), so the size shown is the effective one. */
export function normalizeText(node) {
  const m = node.m
  const s = m[0]
  const eps = 1e-9 * Math.max(1, Math.abs(s))
  if (!(s > 0) || Math.abs(m[1]) > eps || Math.abs(m[2]) > eps || Math.abs(m[3] - s) > eps || Math.abs(s - 1) < 1e-12) return node
  const out = { ...node, size: node.size * s, m: [1, 0, 0, 1, m[4], m[5]] }
  if (node.glyphs) out.glyphs = node.glyphs.map((g) => ({ c: g.c, x: g.x * s }))
  return out
}

/**
 * Family and style names plus bold and italic flags of a TrueType or OpenType font file (the sfnt name, OS/2 and head tables), or null when the
 * bytes are not one (WOFF files are compressed: the browser loads those, the caller falls back to the file name). Never throws.
 */
export function readFontNames(b) {
  try {
    if (!(b instanceof Uint8Array) || b.length < 12) return null
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const tag = (at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
    let o = 0
    if (tag(0) === 'ttcf') o = v.getUint32(12)
    if (!['\u0000\u0001\u0000\u0000', 'OTTO', 'true', 'typ1'].includes(tag(o))) return null
    const tables = {}
    for (let i = 0, n = Math.min(v.getUint16(o + 4), 100); i < n; i++) { const at = o + 12 + i * 16; tables[tag(at)] = v.getUint32(at + 8) }
    const names = {}
    if (tables.name != null) {
      const t = tables.name, count = Math.min(v.getUint16(t + 2), 2000), base = t + v.getUint16(t + 4)
      for (let i = 0; i < count; i++) {
        const r = t + 6 + i * 12, plat = v.getUint16(r), lang = v.getUint16(r + 4), id = v.getUint16(r + 6), len = v.getUint16(r + 8), off = base + v.getUint16(r + 10)
        if (off + len > b.length) continue
        let s = ''
        if (plat === 3 || plat === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(v.getUint16(off + k))
        else if (plat === 1) for (let k = 0; k < len; k++) s += String.fromCharCode(b[off + k])
        else continue
        const rank = plat === 3 && lang === 0x409 ? 3 : plat === 1 && lang === 0 ? 2 : 1
        if (!names[id] || rank > names[id].rank) names[id] = { s: s.replace(/[\u0000-\u001f\u007f<>{};"\\]/g, '').trim(), rank }
      }
    }
    const family = names[16]?.s || names[1]?.s || '', style = names[17]?.s || names[2]?.s || ''
    let bold = /\b(bold|black|heavy)\b/i.test(style), italic = /\b(italic|oblique)\b/i.test(style)
    if (tables['OS/2'] != null) { const fs = v.getUint16(tables['OS/2'] + 62); bold = !!(fs & 32); italic = !!(fs & 1) } else if (tables.head != null) { const ms = v.getUint16(tables.head + 44); bold = !!(ms & 1); italic = !!(ms & 2) }
    return family ? { family: family.slice(0, 160), style: style.slice(0, 80), bold, italic, postscript: (names[6]?.s || '').slice(0, 120) } : null
  } catch { return null }
}

/** Font families offered in the property bar: bundled-exact first, then fonts embedded in the document, then common system families. */
export const BUNDLED_FAMILIES = ['Inter', 'Noto Serif', 'Roboto Mono']
export const SYSTEM_FAMILIES = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Nirmala UI']
export function fontList(docFonts = {}) {
  const out = BUNDLED_FAMILIES.map((family) => ({ family, group: 'Exact in exports' }))
  const seen = new Set(out.map((o) => o.family))
  for (const f of Object.values(docFonts)) if (f.family && !seen.has(f.family)) { seen.add(f.family); out.push({ family: f.family, group: 'In this document' }) }
  for (const family of SYSTEM_FAMILIES) if (!seen.has(family)) out.push({ family, group: 'System (shown with a similar font in curves)' })
  return out
}
