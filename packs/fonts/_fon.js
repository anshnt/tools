// Windows bitmap fonts: read .FON (NE or PE) and .FNT files, and turn each size into a TrueType font made of pixel squares. DOM-free.
import { dv } from './_info.js'
import { writeSfnt } from './_sfnt.js'
import { buildTtf } from './_ttfbuild.js'

const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }

// ---------- resources ----------
function neFonts(b) {
  const v = dv(b)
  const ne = v.getUint32(0x3c, true)
  if (b[ne] !== 0x4e || b[ne + 1] !== 0x45) return null
  const tbl = ne + v.getUint16(ne + 0x24, true)
  const shift = v.getUint16(tbl, true)
  const out = []
  let p = tbl + 2
  while (p + 8 <= b.length) {
    const type = v.getUint16(p, true)
    if (type === 0) break
    const count = v.getUint16(p + 2, true)
    p += 8
    for (let i = 0; i < count; i++, p += 12) {
      if (type !== 0x8008) continue // RT_FONT
      const off = v.getUint16(p, true) << shift, len = v.getUint16(p + 2, true) << shift
      if (off < b.length) out.push(b.subarray(off, Math.min(b.length, off + len)))
    }
  }
  return out
}

function peFonts(b) {
  const v = dv(b)
  const pe = v.getUint32(0x3c, true)
  if (v.getUint32(pe, true) !== 0x4550) return null
  const nSec = v.getUint16(pe + 6, true), optSize = v.getUint16(pe + 20, true), opt = pe + 24
  const dirs = opt + (v.getUint16(opt, true) === 0x20b ? 112 : 96)
  const rva = v.getUint32(dirs + 16, true)
  if (!rva) return []
  const secs = []
  for (let i = 0; i < nSec; i++) { const s = opt + optSize + i * 40; secs.push({ va: v.getUint32(s + 12, true), size: Math.max(v.getUint32(s + 8, true), v.getUint32(s + 16, true)), raw: v.getUint32(s + 20, true) }) }
  const toOff = (r) => { const s = secs.find((x) => r >= x.va && r < x.va + x.size); return s ? r - s.va + s.raw : -1 }
  const root = toOff(rva)
  if (root < 0) return []
  const entries = (dir) => {
    const n = v.getUint16(root + dir + 12, true) + v.getUint16(root + dir + 14, true)
    return Array.from({ length: n }, (_, i) => ({ id: v.getUint32(root + dir + 16 + i * 8, true), off: v.getUint32(root + dir + 20 + i * 8, true) }))
  }
  const out = []
  const leaves = (e, depth) => {
    if (e.off & 0x80000000) for (const c of entries(e.off & 0x7fffffff)) leaves(c, depth + 1)
    else {
      const d = root + e.off
      const o = toOff(v.getUint32(d, true)), size = v.getUint32(d + 4, true)
      if (o >= 0 && o + size <= b.length) out.push(b.subarray(o, o + size))
    }
  }
  for (const t of entries(0)) if (t.id === 8 && (t.off & 0x80000000)) leaves(t, 1)
  return out
}

// ---------- FNT ----------
const cstr = (b, o) => { let s = ''; while (o < b.length && b[o]) s += String.fromCharCode(b[o++]); return s }

/** Parse one FNT resource. Returns null for vector fonts. glyphs: Map(code -> {width, rows: Uint8Array[height][width]}) */
export function parseFnt(b) {
  if (b.length < 118) fail('This bitmap font is too short to be valid.')
  const v = dv(b)
  const version = v.getUint16(0, true)
  if (version !== 0x200 && version !== 0x300) fail('This is not a Windows bitmap font (.fnt).')
  const type = v.getUint16(66, true)
  if (type & 1) return null // vector (plotter) font
  const f = {
    version, copyright: cstr(b.subarray(6, 66), 0), points: v.getUint16(68, true), ascent: v.getUint16(74, true), internalLeading: v.getUint16(76, true), externalLeading: v.getUint16(78, true),
    italic: !!b[80], weight: v.getUint16(83, true), charset: b[85], pixWidth: v.getUint16(86, true), pixHeight: v.getUint16(88, true), pitch: b[90], avgWidth: v.getUint16(91, true),
    maxWidth: v.getUint16(93, true), first: b[95], last: b[96], defaultChar: b[97], breakChar: b[98],
  }
  const faceOff = v.getUint32(105, true)
  f.face = (faceOff && faceOff < b.length ? cstr(b, faceOff) : '') || 'Bitmap font'
  const h = f.pixHeight
  if (!h || h > 255 || f.last < f.first) fail('This bitmap font has an invalid size.')
  const tbl = version === 0x300 ? 148 : 118, rec = version === 0x300 ? 6 : 4
  f.glyphs = new Map()
  for (let c = f.first; c <= f.last; c++) {
    const e = tbl + (c - f.first) * rec
    if (e + rec > b.length) break
    const w = v.getUint16(e, true), off = rec === 6 ? v.getUint32(e + 2, true) : v.getUint16(e + 2, true)
    if (!w) continue
    const cols = Math.ceil(w / 8)
    if (off + cols * h > b.length) continue
    const rows = Array.from({ length: h }, () => new Uint8Array(w))
    for (let col = 0; col < cols; col++) for (let r = 0; r < h; r++) {
      const byte = b[off + col * h + r]
      for (let bit = 0; bit < 8 && col * 8 + bit < w; bit++) rows[r][col * 8 + bit] = (byte >> (7 - bit)) & 1
    }
    f.glyphs.set(c, { width: w, rows })
  }
  if (!f.glyphs.size) fail('This bitmap font has no characters in it.')
  f.fixed = !(f.pitch & 1) && f.pixWidth > 0 // bit 0 set means variable pitch
  return f
}

/** All raster fonts in a .fon or .fnt file. */
export function readFonFile(bytes) {
  let list
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) {
    try { list = neFonts(bytes) || peFonts(bytes) } catch { list = null }
    if (!list) fail('This does not look like a Windows font library (.fon).')
  } else list = [bytes]
  const fonts = []
  let vector = 0
  for (const r of list) { const f = parseFnt(r); f ? fonts.push(f) : vector++ }
  if (!fonts.length) fail(vector ? 'This file only has vector (stroke) fonts, which cannot be converted.' : 'No bitmap fonts were found in this file.')
  return { fonts, vector }
}

// ---------- Unicode mapping ----------
const CP437_LOW = '\u0000☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼'
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '
const CHARSET_LABEL = { 0: 'windows-1252', 238: 'windows-1250', 204: 'windows-1251', 161: 'windows-1253', 162: 'windows-1254', 177: 'windows-1255', 178: 'windows-1256', 186: 'windows-1257', 163: 'windows-1258', 222: 'windows-874' }
const decoders = new Map()
export function unicodeFor(code, charset) {
  if (charset === 2) return 0xf000 + code // symbol fonts live in the private use area
  if (charset === 255) return code < 0x20 ? CP437_LOW.codePointAt(code) || 0 : code < 0x7f ? code : code === 0x7f ? 0x2302 : CP437_HIGH.codePointAt(code - 0x80)
  const label = CHARSET_LABEL[charset] || 'windows-1252'
  if (code < 0x20 || code === 0x7f) return 0
  if (code < 0x80) return code
  if (!decoders.has(label)) decoders.set(label, new TextDecoder(label))
  const s = decoders.get(label).decode(Uint8Array.of(code))
  return s && s !== '�' ? s.codePointAt(0) : 0
}

// ---------- FNT -> TTF ----------
/** Pixel rows -> merged rectangles [{x0, x1, r0, r1}] (equal runs in neighbouring rows join into one taller box). */
export function rectsOf(rows) {
  const done = [], open = new Map()
  rows.forEach((row, r) => {
    const seen = new Set()
    for (let x = 0; x < row.length;) {
      if (!row[x]) { x++; continue }
      let e = x
      while (e < row.length && row[e]) e++
      const key = `${x}-${e}`
      seen.add(key)
      const o = open.get(key)
      if (o) o.r1 = r
      else { const n = { x0: x, x1: e, r0: r, r1: r }; open.set(key, n); done.push(n) }
      x = e
    }
    for (const k of [...open.keys()]) if (!seen.has(k)) open.delete(k)
  })
  return done
}

/** Build a TrueType font (bytes) for one bitmap font size. */
export function fntToTtf(f, familyOverride) {
  const h = f.pixHeight
  const k = Math.max(1, Math.ceil(64 / h))
  const glyphFor = (g) => ({
    advance: g.width * k,
    contours: rectsOf(g.rows).map((r) => {
      const x0 = r.x0 * k, x1 = r.x1 * k, top = (f.ascent - r.r0) * k, bot = (f.ascent - r.r1 - 1) * k
      return [{ x: x0, y: bot, on: true }, { x: x0, y: top, on: true }, { x: x1, y: top, on: true }, { x: x1, y: bot, on: true }]
    }),
  })
  const notdefSrc = f.glyphs.get(f.defaultChar) || [...f.glyphs.values()][0]
  const glyphs = [glyphFor(notdefSrc)]
  const cmap = [], seen = new Set()
  for (const [code, g] of [...f.glyphs].sort((a, b) => a[0] - b[0])) {
    const cp = unicodeFor(code, f.charset)
    if (!cp || seen.has(cp)) continue
    seen.add(cp)
    cmap.push([cp, glyphs.length])
    glyphs.push(glyphFor(g))
  }
  if (!cmap.length) fail('None of the characters in this bitmap font could be mapped to Unicode.')
  const base = familyOverride || f.face
  const family = f.fixed ? `${base} ${f.pixWidth}x${h}` : `${base} ${h}`
  const widths = new Set([...f.glyphs.values()].map((g) => g.width))
  return writeSfnt(buildTtf({
    family, style: f.italic ? 'Italic' : f.weight >= 600 ? 'Bold' : 'Regular', unitsPerEm: h * k, ascent: f.ascent * k, descent: Math.max(0, h - f.ascent) * k, lineGap: f.externalLeading * k,
    glyphs, cmap, weight: f.weight || 400, italic: f.italic, bold: f.weight >= 600, fixedPitch: widths.size === 1, copyright: f.copyright, lowestPpem: h,
  }))
}

export const fntLabel = (f) => (f.fixed ? `${f.pixWidth} x ${f.pixHeight} px` : `${f.pixHeight} px, variable width`)
