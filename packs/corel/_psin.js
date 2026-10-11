// PostScript reader (clean-room subset interpreter). EPS, PS and legacy (non-PDF) AI files -> flat Doc in points, y down, origin top-left.
//
//   isPostScript(bytes) -> bool                 cheap, reads at most the first 4 KB
//   psToDoc(data, {onProgress, signal, limits}) -> {pages, warnings}   data: Uint8Array, ArrayBuffer, Blob or string
//     onProgress(fraction 0..1, text); signal aborts with Error('Cancelled') whose code is 'ABORT'; limits overrides LIMITS (tests, tuning).
//     Each %%Page / showpage becomes a page; items are Path, Text and Image objects of the shared model, clips are `clip` arrays.
//
// What runs: operand/dictionary/execution stacks, procedures, control flow, graphics state, paths, fill/stroke/clip, images
// (image, imagemask, colorimage with hex, ASCII85, RunLength, Flate, LZW, DCT data), standard-font text and the legacy AI operator set.
// What does not: real font programs (text in embedded fonts is skipped with a warning), shadings and patterns (approximated or skipped),
// halftones, anything that needs a device. The interpreter is iterative (explicit execution stack), checks the abort signal and a wall clock
// between operators and yields to the event loop about every 25 ms, so a hostile file can be cancelled and cannot hang the page.
// Pure: no DOM at import or run time. PNG for images is encoded here (CompressionStream when present, stored blocks otherwise).
import { mul, invert, hex, cmykToRgb, bytesToDataUrl, pathBBox } from './_model.js'

// Marker that the prolog of legacy AI files defines (assembled so the file format's own identifier is the only place it appears).
const AI_TAG = ['Adobe', 'Illustrator', 'AI'].join('_')
const LIMITS = {
  ops: 60e6, ms: 60000, execDepth: 1500, procDepth: 200, opStack: 250000, dictStack: 400, gstack: 1500,
  pathCmds: 600000, items: 300000, imgPx: 30e6, str: 32e6, arr: 4e6, file: 250e6, errors: 400, clips: 16, pages: 300,
}

class PSError extends Error { constructor(name, detail) { super(detail ? `${name}: ${detail}` : name); this.psName = name } }

// ---------- objects ----------
class Name { constructor(s, x) { this.s = s; this.x = x } }
class PSStr {
  constructor(a, o = 0, n = a.length, x = false) { this.a = a; this.o = o; this.n = n; this.x = x }
  get text() { return latin1(this.a, this.o, this.n) }
  static of(s) { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return new PSStr(a) }
}
class PSArr { constructor(a, o = 0, n = a.length, x = false) { this.a = a; this.o = o; this.n = n; this.x = x } }
class PSDict { constructor() { this.m = new Map() } }
class Op { constructor(name, fn) { this.name = name; this.fn = fn } }
class PSFile {
  constructor(kind, s = '', src = null) { this.kind = kind; this.s = s; this.p = 0; this.src = src; this.buf = null; this.bp = 0; this.q = []; this.qi = 0; this.eod = false; this.par = null; this.rlN = 0; this.main = false }
}
const MARK = Object.freeze({ mark: true })
const NULL = Object.freeze({ nul: true })
const EOF = Object.freeze({ eof: true })
const LB = Object.freeze({ lb: true })
const RB = Object.freeze({ rb: true })

function latin1(a, o, n) {
  let s = ''
  for (let i = 0; i < n; i += 8192) s += String.fromCharCode.apply(null, a.subarray(o + i, o + Math.min(n, i + 8192)))
  return s
}
const K = (o) => (o instanceof Name ? o.s : o instanceof PSStr ? o.text : o)
function psEq(a, b) {
  if (a === b) return true
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'boolean' || typeof b === 'boolean') return false
  const sa = a instanceof Name ? a.s : a instanceof PSStr ? a.text : undefined
  return sa !== undefined && sa === (b instanceof Name ? b.s : b instanceof PSStr ? b.text : null)
}
const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37
const hexVal = (c) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1)
const r3 = (v) => { const r = Math.round(Math.max(-1e8, Math.min(1e8, v)) * 1000) / 1000; return r === 0 || r !== r ? 0 : r }
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const RADIX_RE = /^(\d{1,2})#([0-9a-zA-Z]+)$/
function parseNum(t) {
  const c = t.charCodeAt(0)
  if (!((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return null
  if (NUM_RE.test(t)) return +t
  const m = RADIX_RE.exec(t)
  if (m && +m[1] >= 2 && +m[1] <= 36) { const v = parseInt(m[2], +m[1]); return Number.isNaN(v) ? null : v }
  return null
}

// ---------- scanner ----------
/** Next token from a PSFile: number, boolean-free object (Name, PSStr), or the sentinels EOF, LB, RB. `it` resolves //name and DSC comments. */
function scanToken(f, it) {
  const s = f.s, n = s.length
  let p = f.p
  for (;;) {
    while (p < n && isWs(s.charCodeAt(p))) p++
    if (p >= n) { f.p = p; return EOF }
    const c = s.charCodeAt(p)
    if (c === 37) {
      let q = p
      while (q < n) { const d = s.charCodeAt(q); if (d === 10 || d === 13) break; q++ }
      p = f.main ? it.comment(s, p, q) : q
      continue
    }
    if (c === 40) { // ( string )
      const out = []
      let depth = 1
      p++
      while (p < n) {
        let d = s.charCodeAt(p++)
        if (d === 40) depth++
        else if (d === 41) { if (--depth === 0) break } else if (d === 92) {
          d = s.charCodeAt(p++)
          if (d === 110) d = 10; else if (d === 114) d = 13; else if (d === 116) d = 9; else if (d === 98) d = 8; else if (d === 102) d = 12
          else if (d >= 48 && d <= 55) {
            let v = d - 48
            for (let k = 0; k < 2; k++) { const e = s.charCodeAt(p); if (e >= 48 && e <= 55) { v = v * 8 + e - 48; p++ } else break }
            d = v & 255
          } else if (d === 13) { if (s.charCodeAt(p) === 10) p++; continue } else if (d === 10) continue
        } else if (d === 13) { if (s.charCodeAt(p) === 10) p++; d = 10 }
        out.push(d)
      }
      f.p = p
      return new PSStr(Uint8Array.from(out))
    }
    if (c === 60) {
      const d = s.charCodeAt(p + 1)
      if (d === 60) { f.p = p + 2; return new Name('<<', true) }
      if (d === 126) { // <~ ascii85 ~>
        const e = s.indexOf('~>', p + 2)
        const body = s.slice(p + 2, e < 0 ? n : e)
        f.p = e < 0 ? n : e + 2
        const g = new PSFile('a85', '', new PSFile('raw', body))
        const out = []
        for (let b = rb(g); b >= 0; b = rb(g)) out.push(b)
        return new PSStr(Uint8Array.from(out))
      }
      const out = []
      let hi = -1
      p++
      while (p < n) {
        const e = s.charCodeAt(p++)
        if (e === 62) break
        const v = hexVal(e)
        if (v < 0) continue
        if (hi < 0) hi = v; else { out.push((hi << 4) | v); hi = -1 }
      }
      if (hi >= 0) out.push(hi << 4)
      f.p = p
      return new PSStr(Uint8Array.from(out))
    }
    if (c === 62) { f.p = p + (s.charCodeAt(p + 1) === 62 ? 2 : 1); return new Name(s.charCodeAt(p + 1) === 62 ? '>>' : '>', true) }
    if (c === 91 || c === 93) { f.p = p + 1; return new Name(c === 91 ? '[' : ']', true) }
    if (c === 123) { f.p = p + 1; return LB }
    if (c === 125) { f.p = p + 1; return RB }
    if (c === 41) { p++; continue }
    let imm = false, q = p
    if (c === 47) { q++; if (s.charCodeAt(q) === 47) { imm = true; q++ } }
    const st = q
    while (q < n) { const d = s.charCodeAt(q); if (isWs(d) || isDelim(d)) break; q++ }
    const t = s.slice(st, q)
    if (q < n && isWs(s.charCodeAt(q))) { if (s.charCodeAt(q) === 13 && s.charCodeAt(q + 1) === 10) q++; q++ }
    f.p = q
    if (c === 47) return imm ? it.immediate(t) : new Name(t, false)
    const v = parseNum(t)
    return v !== null ? v : new Name(t, true)
  }
}

// ---------- streams and filters ----------
/** Next byte of a file object or -1. Filters decode lazily, so image data can be read straight out of the program text. */
function rb(f) {
  switch (f.kind) {
    case 'raw': return f.p < f.s.length ? f.s.charCodeAt(f.p++) : -1
    case 'hex': {
      if (f.eod) return -1
      let hi = -1
      for (;;) {
        const c = rb(f.src)
        if (c < 0 || c === 62) { f.eod = true; return hi < 0 ? -1 : hi << 4 }
        const v = hexVal(c)
        if (v < 0) continue
        if (hi < 0) hi = v; else return (hi << 4) | v
      }
    }
    case 'a85':
      for (;;) {
        if (f.qi < f.q.length) return f.q[f.qi++]
        if (f.eod) return -1
        f.q = a85Group(f); f.qi = 0
      }
    case 'rl': {
      if (f.rlN > 0) { f.rlN--; return f.rlLit ? rb(f.src) : f.rlV }
      if (f.eod) return -1
      const l = rb(f.src)
      if (l < 0 || l === 128) { f.eod = true; return -1 }
      if (l < 128) { f.rlN = l + 1; f.rlLit = true } else { f.rlN = 257 - l; f.rlLit = false; f.rlV = rb(f.src) }
      return rb(f)
    }
    default: return f.buf && f.bp < f.buf.length ? f.buf[f.bp++] : -1
  }
}
function a85Group(f) {
  const g = []
  for (;;) {
    const c = rb(f.src)
    if (c < 0) { f.eod = true; break }
    if (isWs(c)) continue
    if (c === 126) { f.eod = true; rb(f.src); break }
    if (c === 122 && !g.length) return [0, 0, 0, 0]
    if (c < 33 || c > 117) continue
    g.push(c - 33)
    if (g.length === 5) break
  }
  const n = g.length
  if (n < 2) return []
  while (g.length < 5) g.push(84)
  let v = 0
  for (const d of g) v = v * 85 + d
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1)
}
const MATERIAL = new Set(['flate', 'lzw', 'dct', 'sub'])
function drain(src, cap) {
  let out = new Uint8Array(1 << 16), n = 0
  for (let b = rb(src); b >= 0; b = rb(src)) {
    if (n === out.length) { if (n >= cap) throw new PSError('limitcheck', 'data stream too long'); const t = new Uint8Array(n * 2); t.set(out); out = t }
    out[n++] = b
  }
  return out.subarray(0, n)
}
async function pump(readable) {
  const rd = readable.getReader(), chunks = []
  let total = 0
  for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); total += value.length }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
async function viaStream(kind, bytes) {
  const S = kind === 'deflate' ? globalThis.CompressionStream : globalThis.DecompressionStream
  if (typeof S !== 'function') return null
  const st = new S('deflate')
  const w = st.writable.getWriter()
  w.write(bytes).catch(() => {}); w.close().catch(() => {})
  return pump(st.readable)
}
function lzwDecode(data, early = 1) {
  const out = []
  let table = [], bits = 9, buf = 0, nb = 0, prev = null, i = 0
  const reset = () => { table = []; for (let k = 0; k < 256; k++) table.push([k]); table.push(null, null); bits = 9; prev = null }
  reset()
  for (;;) {
    while (nb < bits && i < data.length) { buf = (buf << 8) | data[i++]; nb += 8 }
    if (nb < bits) break
    const code = (buf >> (nb - bits)) & ((1 << bits) - 1)
    nb -= bits; buf &= (1 << nb) - 1
    if (code === 256) { reset(); continue }
    if (code === 257) break
    let ent
    if (code < table.length) ent = table[code]
    else if (prev) ent = prev.concat(prev[0])
    else break
    if (!ent) break
    for (const b of ent) out.push(b)
    if (prev) table.push(prev.concat(ent[0]))
    prev = ent
    const sz = table.length + early
    bits = sz >= 2048 ? 12 : sz >= 1024 ? 11 : sz >= 512 ? 10 : 9
    if (out.length > LIMITS.file) throw new PSError('limitcheck', 'LZW data too long')
  }
  return Uint8Array.from(out)
}
async function ensureReady(f) {
  if (!(f instanceof PSFile)) return
  if (f.src) await ensureReady(f.src)
  if (f.buf || !MATERIAL.has(f.kind)) return
  if (f.kind === 'sub') {
    const e = f.par?.eodStr || ''
    const out = []
    for (let b = rb(f.src); b >= 0; b = rb(f.src)) {
      out.push(b)
      if (e && out.length >= e.length) {
        let hit = true
        for (let k = 0; k < e.length; k++) if (out[out.length - e.length + k] !== e.charCodeAt(k)) { hit = false; break }
        if (hit) { out.length -= e.length; break }
      }
      if (out.length > LIMITS.file) throw new PSError('limitcheck', 'data stream too long')
    }
    f.buf = Uint8Array.from(out)
    return
  }
  const raw = drain(f.src, LIMITS.file)
  if (f.kind === 'dct') f.buf = raw
  else if (f.kind === 'lzw') f.buf = lzwDecode(raw, f.par?.early ?? 1)
  else {
    const r = await viaStream('inflate', raw).catch((e) => { throw new PSError('ioerror', 'could not decompress image data: ' + (e?.message || e)) })
    if (!r) throw new PSError('undefinedfilename', 'this browser cannot decompress FlateDecode data')
    f.buf = r
  }
}

// ---------- PNG ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function adler32(b) {
  let a = 1, s = 0
  for (let i = 0; i < b.length;) { const e = Math.min(b.length, i + 5552); for (; i < e; i++) { a += b[i]; s += a } a %= 65521; s %= 65521 }
  return ((s << 16) | a) >>> 0
}
function zlibStore(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  let o = 0
  out[o++] = 0x78; out[o++] = 0x01
  for (let i = 0; i < blocks; i++) {
    const a = i * 65535, len = Math.min(65535, raw.length - a)
    out[o++] = i === blocks - 1 ? 1 : 0
    out[o++] = len & 255; out[o++] = len >> 8; out[o++] = ~len & 255; out[o++] = (~len >> 8) & 255
    out.set(raw.subarray(a, a + len), o); o += len
  }
  const ad = adler32(raw)
  out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 255; out[o++] = (ad >>> 8) & 255; out[o++] = ad & 255
  return out
}
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  out.set(u32(data.length), 0)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  out.set(u32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length)
  return out
}
/** Encode 8-bit RGB (channels 3) or RGBA (channels 4) pixels as a PNG. */
export async function encodePng(w, h, px, channels) {
  const rowBytes = w * channels
  const raw = new Uint8Array((rowBytes + 1) * h)
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1)
  const z = (await viaStream('deflate', raw).catch(() => null)) || zlibStore(raw)
  const ihdr = new Uint8Array([...u32(w), ...u32(h), 8, channels === 4 ? 6 : 2, 0, 0, 0])
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), pngChunk('IHDR', ihdr), pngChunk('IDAT', z), pngChunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// ---------- standard fonts (approximate advance widths, 1000 units per em) ----------
const HELV = [278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 222,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const TIMES = [250, 333, 408, 500, 500, 833, 778, 333, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921,
  722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333,
  444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541]
function charWidth(kind, bold, code) {
  if (kind === 'c') return 600
  const t = kind === 't' ? TIMES : HELV
  let w = code >= 32 && code <= 126 ? t[code - 32] : kind === 't' ? 500 : 556
  if (bold) w *= kind === 't' ? 1.04 : 1.06
  return w
}
const CP1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178]
const GLYPH_NAMES = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at'.split(' ')
const AGL = { quoteright: 0x2019, quoteleft: 0x2018, endash: 0x2013, emdash: 0x2014, bullet: 0x2022, fi: 0xfb01, fl: 0xfb02, Euro: 0x20ac, degree: 0xb0, minus: 0x2212, quotedblleft: 0x201c, quotedblright: 0x201d, ellipsis: 0x2026, copyright: 0xa9, registered: 0xae, trademark: 0x2122, grave: 0x60, asciitilde: 0x7e, asciicircum: 0x5e, underscore: 0x5f, bracketleft: 0x5b, bracketright: 0x5d, backslash: 0x5c, braceleft: 0x7b, braceright: 0x7d, bar: 0x7c, quotedbl: 0x22, quotesingle: 0x27, hyphen: 0x2d, nbspace: 0xa0, periodcentered: 0xb7 }
GLYPH_NAMES.forEach((n, i) => { AGL[n] = 32 + i })
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { AGL[c] = 65 + i; AGL[c.toLowerCase()] = 97 + i })
function glyphToChar(name, code) {
  if (typeof name !== 'string') return String.fromCharCode(code)
  if (AGL[name] !== undefined) return String.fromCodePoint(AGL[name])
  let m = /^uni([0-9A-Fa-f]{4})$/.exec(name)
  if (m) return String.fromCharCode(parseInt(m[1], 16))
  if (name === '.notdef') return ''
  return ''
}
const decodeByte = (b) => String.fromCharCode(b >= 128 && b < 160 ? CP1252[b - 128] : b)
const classCache = new Map()
function classifyFont(rawName) {
  let c = classCache.get(rawName)
  if (c) return c
  const name = rawName.replace(/^_/, '').replace(/^[A-Z]{6}\+/, '')
  const l = name.toLowerCase()
  const bold = /bold|black|heavy|demi|extrabd/.test(l), italic = /italic|oblique|\bital\b|-it$/.test(l)
  const symbolic = /^(symbol|zapfdingbats|dingbats|wingdings|webdings)/.test(l)
  let family, kind, std = true
  if (/helvetica|arial/.test(l)) { family = 'Helvetica'; kind = 'h' } else if (/times/.test(l)) { family = 'Times'; kind = 't' } else if (/courier/.test(l)) { family = 'Courier'; kind = 'c' } else {
    std = false
    family = name.split(/[-,_]/)[0].replace(/([a-z])([A-Z])/g, '$1 $2') || 'Helvetica'
    kind = /mono|consol|code|typewriter/.test(l) ? 'c' : /serif|garamond|georgia|palatino|bookman|century|caslon|minion|cambria|roman|book/.test(l) && !/sans/.test(l) ? 't' : 'h'
  }
  c = { family, kind, bold, italic, symbolic, std, name }
  classCache.set(rawName, c)
  return c
}

// ---------- DSC comments, read before running ----------
function lineValues(text, key) {
  const out = [], tag = '%%' + key + ':'
  for (let p = text.indexOf(tag); p >= 0 && out.length < 5000; p = text.indexOf(tag, p + tag.length)) {
    if (p > 0 && text.charCodeAt(p - 1) !== 10 && text.charCodeAt(p - 1) !== 13) continue
    let e = p
    while (e < text.length && text.charCodeAt(e) !== 10 && text.charCodeAt(e) !== 13) e++
    out.push({ pos: p, val: text.slice(p + tag.length, e).trim() })
  }
  return out
}
const box4 = (v) => { const a = v.split(/[\s,]+/).map(Number); return a.length >= 4 && a.slice(0, 4).every(Number.isFinite) ? a.slice(0, 4) : null }
function prescan(text) {
  const begins = lineValues(text, 'BeginDocument').map((x) => x.pos), ends = lineValues(text, 'EndDocument').map((x) => x.pos)
  const nested = (pos) => begins.filter((b) => b < pos).length > ends.filter((e) => e < pos).length
  const own = (list) => list.filter((x) => !nested(x.pos))
  let box = null
  for (const key of ['HiResBoundingBox', 'BoundingBox']) for (const x of own(lineValues(text, key))) { const b = box4(x.val); if (b && !box) box = b }
  const pageBoxes = lineValues(text, 'PageBoundingBox').map((x) => box4(x.val))
  const pageCount = lineValues(text, 'Page').length
  const embedded = []
  for (const x of lineValues(text, 'BeginFont')) embedded.push(x.val.split(/\s+/)[0])
  for (const x of lineValues(text, 'BeginResource')) { const p = x.val.split(/\s+/); if (p[0].toLowerCase() === 'font' && p[1]) embedded.push(p[1]) }
  return { box, pageBoxes: pageBoxes.length && pageBoxes.length === pageCount && pageBoxes.every(Boolean) ? pageBoxes : null, embedded }
}

// ---------- graphics state ----------
const GRAY = { kind: 'gray', n: 1 }, RGB = { kind: 'rgb', n: 3 }, CMYK = { kind: 'cmyk', n: 4 }
const msc = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
const rN = (v) => { const r = Math.round(v * 1e5) / 1e5; return r === 0 ? 0 : r }
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0)
const rgbHex = (r, g, b) => hex(clamp01(r) * 255, clamp01(g) * 255, clamp01(b) * 255)
const cmykHex = (c, m, y, k) => { const [r, g, b] = cmykToRgb(clamp01(c), clamp01(m), clamp01(y), clamp01(k)); return hex(r, g, b) }
const mkArr = (list, x = false) => new PSArr(list, 0, list.length, x)
const arrNums = (a) => { const out = []; for (let i = 0; i < a.n; i++) { const v = a.a[a.o + i]; if (typeof v !== 'number') throw new PSError('typecheck', 'number expected in array'); out.push(v) } return out }
const sameClip = (a, b) => (!a || !a.length ? !b || !b.length : !!b && a.length === b.length && a.every((c, i) => c === b[i]))
const sameD = (a, b) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) { const p = a[i], q = b[i]; if (p.length !== q.length) return false; for (let j = 0; j < p.length; j++) if (p[j] !== q[j]) return false }
  return true
}
const ENC_NAMES = (() => {
  const a = Array(256).fill('.notdef')
  GLYPH_NAMES.forEach((n, i) => { a[32 + i] = n })
  for (let i = 0; i < 26; i++) { a[65 + i] = String.fromCharCode(65 + i); a[97 + i] = String.fromCharCode(97 + i) }
  ;['bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore', 'grave'].forEach((n, i) => { a[91 + i] = n })
  ;['braceleft', 'bar', 'braceright', 'asciitilde'].forEach((n, i) => { a[123 + i] = n })
  return a
})()

function csFromObj(o, it) {
  if (o instanceof Name) {
    switch (o.s) {
      case 'DeviceGray': case 'CalGray': case 'G': case 'CIEBasedA': return GRAY
      case 'DeviceRGB': case 'CalRGB': case 'RGB': case 'CIEBasedABC': return RGB
      case 'DeviceCMYK': case 'CMYK': return CMYK
      case 'Pattern': return { kind: 'pat', n: 0 }
      default: it.warn(`Colour space ${o.s} is approximated as grey.`); return GRAY
    }
  }
  if (o instanceof PSArr && o.n) {
    const a = o.a.slice(o.o, o.o + o.n), nm = a[0] instanceof Name ? a[0].s : ''
    if (nm === 'Indexed' || nm === 'I') {
      const base = csFromObj(a[1], it)
      return { kind: 'idx', n: 1, base: base.kind === 'idx' || base.kind === 'sep' ? RGB : base, hival: typeof a[2] === 'number' ? a[2] : 255, lookup: a[3] }
    }
    if (nm === 'Separation' || nm === 'DeviceN') {
      const names = nm === 'DeviceN' && a[1] instanceof PSArr ? a[1].n : 1
      return { kind: 'sep', n: names, alt: csFromObj(a[2], it), proc: a[3], none: nm === 'Separation' && a[1] instanceof Name && a[1].s === 'None' }
    }
    if (nm === 'Pattern') return { kind: 'pat', n: 0 }
    if (nm === 'ICCBased' || nm === 'CalRGB' || nm === 'CIEBasedABC' || nm === 'CIEBasedDEF' || nm === 'Lab') {
      const n = a[1] instanceof PSDict ? a[1].m.get('N') : 3
      return n === 1 ? GRAY : n === 4 ? CMYK : RGB
    }
    if (nm === 'CalGray' || nm === 'CIEBasedA') return GRAY
    if (nm === 'CIEBasedDEFG') return CMYK
    return csFromObj(a[0], it)
  }
  return GRAY
}
/** Components (0..1) in a plain device-style colour space -> '#rrggbb'. */
function csHex(cs, c) {
  switch (cs.kind) {
    case 'rgb': return rgbHex(c[0], c[1], c[2])
    case 'cmyk': return cmykHex(c[0], c[1], c[2], c[3])
    default: return rgbHex(c[0], c[0], c[0])
  }
}

const WHY = {
  stackunderflow: 'it needed values that were not there', typecheck: 'it got the wrong kind of value', rangecheck: 'a value was out of range', nocurrentpoint: 'there was no current point',
  undefinedresult: 'the result is not defined', limitcheck: 'a limit was reached', invalidfont: 'no usable font was set', unmatchedmark: 'a bracket was not matched', syntaxerror: 'the syntax is invalid',
  invalidexit: 'exit was used outside a loop', ioerror: 'the data could not be read', undefinedfilename: 'a data filter is not supported', dictstackoverflow: 'too many dictionaries were opened', dictstackunderflow: 'a dictionary was closed that was never opened',
}

// ---------- interpreter ----------
class Interp {
  constructor(text, o) {
    this.s = text
    this.lim = { ...LIMITS, ...(o.limits || {}) }
    this.signal = o.signal; this.onProgress = o.onProgress
    this.t0 = performance.now(); this.lastYield = this.t0
    this.os = []; this.es = []; this.gstack = []; this.items = []; this.pages = []
    this.warnings = new Map(); this.extraWarnings = 0
    this.ops = 0; this.errors = 0; this.pending = null; this.showpages = 0
    this.compound = null; this.aiText = null
    this.fontDir = new PSDict(); this.resources = new Map(); this.embedded = new Set()
    this.pre = prescan(text)
    for (const n of this.pre.embedded) this.embedded.add(n)
    this.hasBox = !!this.pre.box
    if (!this.hasBox) this.warn('The file has no BoundingBox, so the page was set to US Letter size.')
    this.setBox((this.pre.pageBoxes && this.pre.pageBoxes[0]) || this.pre.box || [0, 0, 612, 792])
    this.sysd = new PSDict(); this.userd = new PSDict(); this.ds = [this.sysd, this.userd]
    this.stdEnc = mkArr(ENC_NAMES.map((n) => new Name(n, false))); this.isoEnc = mkArr(ENC_NAMES.map((n) => new Name(n, false)))
    for (const k of Object.keys(OPS)) this.sysd.m.set(k, new Op(k, OPS[k]))
    for (const k of Object.keys(AIOPS)) this.userd.m.set(k, new Op(k, AIOPS[k]))
    const sm = this.sysd.m
    sm.set('systemdict', this.sysd); sm.set('userdict', this.userd); sm.set('globaldict', this.userd); sm.set('FontDirectory', this.fontDir)
    sm.set('GlobalFontDirectory', this.fontDir); sm.set('SharedFontDirectory', this.fontDir)
    sm.set('StandardEncoding', this.stdEnc); sm.set('ISOLatin1Encoding', this.isoEnc)
    for (const k of ['statusdict', 'errordict', '$error', 'internaldict']) sm.set(k, new PSDict())
    sm.get('$error').m.set('newerror', false)
    for (const k of [3, 5, 7, 8].flatMap((v) => [AI_TAG + v, AI_TAG + v + '_vars'])) { // names the legacy AI setup section calls into; the real ones are skipped with the prolog
      const d = new PSDict()
      for (const n of ['initialize', 'terminate']) d.m.set(n, mkArr([], true))
      this.userd.m.set(k, d)
    }
    this.gs = this.newGS()
    const f = new PSFile('raw', text); f.main = true
    this.mainFile = f
    this.es.push({ k: 1, f })
  }

  setBox(b) {
    this.box = b
    this.W = Math.min(20000, Math.max(1, b[2] - b[0])); this.H = Math.min(20000, Math.max(1, b[3] - b[1]))
    this.base = [1, 0, 0, -1, -b[0], b[3]]
  }
  newGS() {
    return { ctm: this.base, d: [], cx: 0, cy: 0, sx: 0, sy: 0, has: false, closed: false, clip: [], fill: '#000000', stroke: '#000000', lw: 1, cap: 0, join: 0, miter: 10, dash: [], doff: 0, font: null, cs: GRAY, tm: null }
  }
  cloneGS() { const g = this.gs; return { ...g, d: g.d.slice() } }

  warn(msg) {
    if (this.warnings.has(msg)) return
    if (this.warnings.size >= 40) { this.extraWarnings++; return }
    this.warnings.set(msg, true)
  }

  // ----- names and dictionaries -----
  tryLookup(name) {
    const ds = this.ds
    for (let i = ds.length - 1; i >= 0; i--) { const v = ds[i].m.get(name); if (v !== undefined) return v }
    return undefined
  }
  lookup(name) { const v = this.tryLookup(name); if (v === undefined) throw new PSError('undefined', name); return v }
  immediate(name) { return this.lookup(name) }

  // ----- DSC comments met while scanning the main file: returns where scanning resumes -----
  comment(s, p, q) {
    const c1 = s.charCodeAt(p + 1)
    if (c1 !== 37 && c1 !== 65) return q
    const line = s.slice(p, Math.min(q, p + 120))
    if (c1 === 37) {
      if (line.startsWith('%%BeginProlog')) {
        const e = s.indexOf('%%EndProlog', q)
        if (e > 0 && s.slice(q, e).includes(AI_TAG)) return e // the AI prolog defines its operators in PostScript; they are built in here
        return q
      }
      if (line.startsWith('%%BeginFont') || /^%%BeginResource:\s*font\b/i.test(line)) {
        const e = s.indexOf(line.startsWith('%%BeginFont') ? '%%EndFont' : '%%EndResource', q)
        if (e > 0) return e
      }
    } else if (line.startsWith('%AI5_BeginRaster')) {
      const e = s.indexOf('%AI5_EndRaster', q)
      this.warn('A picture embedded in this legacy AI file could not be read and was skipped.')
      if (e > 0) return e
    }
    return q
  }

  // ----- execution -----
  scanProc(f, depth) {
    if (depth > this.lim.procDepth) throw new Error('This PostScript file nests procedures too deeply.')
    const a = []
    for (;;) {
      const t = scanToken(f, this)
      if (t === EOF) throw new PSError('syntaxerror', 'procedure is not closed')
      if (t === RB) break
      a.push(t === LB ? this.scanProc(f, depth + 1) : t)
      if (a.length > this.lim.arr) throw new Error('This PostScript file has a procedure that is too long.')
    }
    return new PSArr(a, 0, a.length, true)
  }
  pushProc(arr) {
    if (!arr.n) return
    if (this.es.length >= this.lim.execDepth) throw new Error('This PostScript file nests calls too deeply, so reading stopped.')
    this.es.push({ k: 0, a: arr.a, i: arr.o, e: arr.o + arr.n })
  }
  pushFile(str) {
    if (this.es.length >= this.lim.execDepth) throw new Error('This PostScript file nests calls too deeply, so reading stopped.')
    this.es.push({ k: 1, f: new PSFile('raw', str.text) })
  }
  callName(o) {
    let v = this.lookup(o.s)
    for (let g = 0; ; g++) {
      if (v instanceof Op) return v.fn(this)
      if (v instanceof PSArr && v.x) return this.pushProc(v)
      if (v instanceof Name && v.x && g < 8) { v = this.lookup(v.s); continue }
      if (v instanceof PSStr && v.x) return this.pushFile(v)
      this.os.push(v)
      return
    }
  }
  /** `exec`: run an object the way the interpreter would run it from a file. */
  runObj(o) {
    if (o instanceof PSArr) { if (o.x) this.pushProc(o); else this.os.push(o) } else if (o instanceof Name) { if (o.x) this.callName(o); else this.os.push(o) } else if (o instanceof Op) o.fn(this)
    else if (o instanceof PSStr) { if (o.x) this.pushFile(o); else this.os.push(o) } else if (o instanceof PSFile) this.es.push({ k: 1, f: o })
    else this.os.push(o)
  }
  runChunk(limit) {
    const es = this.es, os = this.os
    for (let k = 0; k < limit; k++) {
      if (!es.length) return
      const fr = es[es.length - 1]
      this.ops++
      let obj
      if (fr.k === 0) {
        if (fr.i >= fr.e) { es.pop(); continue }
        obj = fr.a[fr.i++]
        if (fr.i >= fr.e) es.pop()
      } else if (fr.k === 1) {
        obj = scanToken(fr.f, this)
        if (obj === EOF) { es.pop(); continue }
        if (obj === RB) throw new PSError('syntaxerror', 'unmatched }')
        if (obj === LB) { os.push(this.scanProc(fr.f, 0)); continue }
      } else {
        if (fr.step(this)) es.pop()
        if (this.pending) return
        continue
      }
      if (typeof obj === 'number') os.push(obj)
      else if (obj instanceof Name) { if (obj.x) this.callName(obj); else os.push(obj) } else if (obj instanceof Op) obj.fn(this)
      else if (obj instanceof PSStr && obj.x) this.pushFile(obj)
      else os.push(obj)
      if (this.pending) return
    }
  }
  async tick() {
    if (this.signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const now = performance.now()
    if (now - this.t0 > this.lim.ms) throw new Error('This PostScript file takes too long to run, so reading was stopped.')
    if (this.ops > this.lim.ops) throw new Error('This PostScript file runs too many operations, so reading was stopped.')
    if (now - this.lastYield > 25) {
      this.lastYield = now
      this.onProgress?.(Math.min(0.99, this.mainFile.p / Math.max(1, this.s.length)), 'Reading PostScript')
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  async run() {
    for (;;) {
      try {
        while (this.es.length) {
          this.runChunk(4000)
          if (this.pending) { const p = this.pending; this.pending = null; await p }
          if (this.os.length > this.lim.opStack) throw new Error('This PostScript file piles up too much data, so reading was stopped.')
          await this.tick()
        }
        return
      } catch (e) {
        if (e instanceof TypeError || e instanceof RangeError) e = new PSError('typecheck', 'internal: ' + e.message) // a hostile operand shape, treated like any failed operator
        if (!(e instanceof PSError)) throw e
        this.onPSError(e)
      }
    }
  }
  onPSError(e) {
    if (++this.errors > this.lim.errors) throw new Error('This PostScript file has too many errors, so reading was stopped.')
    const es = this.es
    for (let i = es.length - 1; i >= 0; i--) { const f = es[i]; if (f.k === 2 && f.stopped) { es.length = i; this.os.push(true); return } }
    if (e.psName === 'undefined') this.warn(`Skipped an unsupported PostScript operator (${e.message.slice(11)}).`)
    else this.warn(`A PostScript operator failed and was skipped (${WHY[e.psName] || e.message}).`)
  }

  // ----- operand helpers -----
  pop() { if (!this.os.length) throw new PSError('stackunderflow'); return this.os.pop() }
  pn() { const v = this.pop(); if (typeof v !== 'number') throw new PSError('typecheck', 'a number was expected'); return v }
  pi() { return Math.trunc(this.pn()) }
  pb() { const v = this.pop(); if (typeof v !== 'boolean') throw new PSError('typecheck', 'a boolean was expected'); return v }
  pa() { const v = this.pop(); if (!(v instanceof PSArr)) throw new PSError('typecheck', 'an array was expected'); return v }
  ps() { const v = this.pop(); if (!(v instanceof PSStr)) throw new PSError('typecheck', 'a string was expected'); return v }
  pd() { const v = this.pop(); if (!(v instanceof PSDict)) throw new PSError('typecheck', 'a dictionary was expected'); return v }
  nums(k) {
    const os = this.os
    if (os.length < k) throw new PSError('stackunderflow')
    const a = os.splice(os.length - k, k)
    for (let i = 0; i < k; i++) if (typeof a[i] !== 'number') throw new PSError('typecheck', 'a number was expected')
    return a
  }
  matOf(a) { if (a.n !== 6) throw new PSError('rangecheck', 'a matrix has 6 numbers'); return arrNums(a) }
  setMat(arr, m) { for (let i = 0; i < 6; i++) arr.a[arr.o + i] = m[i] }

  // ----- paths (stored in page space, already through the CTM) -----
  cmd(c) {
    for (let i = 1; i < c.length; i++) if (!Number.isFinite(c[i])) throw new PSError('limitcheck', 'a coordinate is out of range')
    const g = this.gs
    if (g.d.length >= this.lim.pathCmds) throw new Error('This PostScript file draws a path that is too long, so reading was stopped.'); g.d.push(c) }
  dev(x, y) { const m = this.gs.ctm; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] }
  moveDev(X, Y) { const g = this.gs; this.cmd(['M', r3(X), r3(Y)]); g.cx = g.sx = X; g.cy = g.sy = Y; g.has = true; g.closed = false }
  reopen() { const g = this.gs; if (g.closed) { this.cmd(['M', r3(g.cx), r3(g.cy)]); g.closed = false } }
  lineDev(X, Y) { const g = this.gs; if (!g.has) throw new PSError('nocurrentpoint'); this.reopen(); this.cmd(['L', r3(X), r3(Y)]); g.cx = X; g.cy = Y }
  curveDev(a, b, c, d, e, f) { const g = this.gs; if (!g.has) throw new PSError('nocurrentpoint'); this.reopen(); this.cmd(['C', r3(a), r3(b), r3(c), r3(d), r3(e), r3(f)]); g.cx = e; g.cy = f }
  closePath() { const g = this.gs; if (!g.has || g.closed) return; this.cmd(['Z']); g.cx = g.sx; g.cy = g.sy; g.closed = true }
  clearPath() { const g = this.gs; g.d = []; g.has = false; g.closed = false }
  setCurDev(X, Y) {
    if (!Number.isFinite(X + Y)) throw new PSError('limitcheck', 'a coordinate is out of range')
    const g = this.gs, last = g.d[g.d.length - 1]
    if (last && last[0] === 'M') g.d[g.d.length - 1] = ['M', r3(X), r3(Y)]; else this.cmd(['M', r3(X), r3(Y)])
    g.cx = g.sx = X; g.cy = g.sy = Y; g.has = true; g.closed = false
  }
  /** The current path without trailing lone moves, or null when nothing would be drawn. */
  takePath() {
    const d = this.gs.d
    let n = d.length
    while (n && d[n - 1][0] === 'M') n--
    return n ? (n < d.length ? d.slice(0, n) : d) : null
  }
  /** Draw an arc given in user space (angles in degrees), as cubic segments through the CTM. */
  arc(x, y, r, a1, a2, ccw) {
    let s = (a1 * Math.PI) / 180, e = (a2 * Math.PI) / 180
    if (ccw) { while (e < s) e += 2 * Math.PI; if (e - s > 2 * Math.PI) e = s + ((e - s) % (2 * Math.PI) || 2 * Math.PI) } else { while (e > s) e -= 2 * Math.PI; if (s - e > 2 * Math.PI) e = s - ((s - e) % (2 * Math.PI) || 2 * Math.PI) }
    const [sx, sy] = this.dev(x + r * Math.cos(s), y + r * Math.sin(s))
    if (this.gs.has) this.lineDev(sx, sy); else this.moveDev(sx, sy)
    const segs = Math.max(1, Math.ceil(Math.abs(e - s) / (Math.PI / 2) - 1e-9)), step = (e - s) / segs, k = (4 / 3) * Math.tan(step / 4)
    let a = s
    for (let i = 0; i < segs; i++) {
      const b = a + step, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b)
      const p1 = this.dev(x + r * (ca - k * sa), y + r * (sa + k * ca)), p2 = this.dev(x + r * (cb + k * sb), y + r * (sb - k * cb)), p3 = this.dev(x + r * cb, y + r * sb)
      this.curveDev(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1])
      a = b
    }
  }

  // ----- painting -----
  addItem(item, clip = this.gs.clip) {
    if (clip.length) item.clip = clip.slice() // own array per object; the {d, rule} entries are shared, treat them as read-only
    if (this.items.length >= this.lim.items) throw new Error('This file has too many objects to open, so reading was stopped.')
    this.items.push(item)
    return item
  }
  fillPath(rule) {
    const g = this.gs, d = this.takePath()
    if (d && g.fill) this.addItem({ t: 'path', d, fill: g.fill, fillOpacity: 1, rule, stroke: null, strokeWidth: 0 })
    this.clearPath()
  }
  strokeProps() {
    const g = this.gs, k = msc(g.ctm)
    let dash = g.dash.map((v) => r3(v * k))
    if (dash.length && (dash.every((v) => !(v > 0)) || !dash.every(Number.isFinite))) dash = []
    if (dash.length % 2) dash = dash.concat(dash)
    return { stroke: g.stroke, strokeWidth: r3(g.lw > 0 ? Math.max(g.lw * k, 0.01) : 0.25), strokeOpacity: 1, cap: g.cap, join: g.join, miter: Math.max(1, g.miter), dash, dashOffset: dash.length ? r3(g.doff * k) : 0 }
  }
  strokePath() {
    const g = this.gs, d = this.takePath()
    if (d && g.stroke) {
      const last = this.items[this.items.length - 1], clip = g.clip
      const sp = this.strokeProps()
      if (last && last.t === 'path' && last.fill && !last.stroke && sameClip(last.clip, clip) && sameD(last.d, d)) Object.assign(last, sp) // fill then stroke of one path = one object
      else this.addItem({ t: 'path', d, fill: null, fillOpacity: 1, rule: 'nonzero', ...sp })
    }
    this.clearPath()
  }
  fillStroke(rule) {
    const g = this.gs, d = this.takePath()
    if (d && (g.fill || g.stroke)) this.addItem({ t: 'path', d, fill: g.fill, fillOpacity: 1, rule, ...(g.stroke ? this.strokeProps() : { stroke: null, strokeWidth: 0 }) })
    this.clearPath()
  }
  coversPage(d) {
    if (d.length > 7 || d.some((c) => c[0] === 'C')) return false
    const b = pathBBox(d)
    if (!b || b.x > 0.51 || b.y > 0.51 || b.x + b.w < this.W - 0.51 || b.y + b.h < this.H - 0.51) return false
    let a = 0
    const pts = d.filter((c) => c[0] !== 'Z')
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[1] * q[2] - q[1] * p[2] }
    return Math.abs(a / 2) > 0.98 * b.w * b.h
  }
  doClip(rule) {
    const g = this.gs, d = this.takePath()
    if (!d || this.coversPage(d)) return
    let clip = [...g.clip, { d: d.slice(), rule }]
    if (clip.length > this.lim.clips) { clip = clip.slice(-this.lim.clips); this.warn('Some nested clipping shapes were dropped (the limit is 16 per object).') }
    g.clip = clip
  }

  // ----- colour -----
  setColor(hexColor, which = 3) { const g = this.gs; if (which & 1) g.fill = hexColor; if (which & 2) g.stroke = hexColor }
  /** Colour components popped from the stack for the current colour space. Separation spaces run their tint transform first. */
  setcolor() {
    const g = this.gs, cs = g.cs
    if (cs.kind === 'pat') { this.pop(); this.warn('Pattern fills are approximated with grey.'); this.setColor('#808080'); return }
    const c = this.nums(cs.n)
    if (cs.kind === 'idx') { this.setColor(this.paletteColor(cs, c[0])); return }
    if (cs.kind === 'sep') {
      if (cs.none) return
      if (!(cs.proc instanceof PSArr)) { this.setColor(rgbHex(1 - c[0], 1 - c[0], 1 - c[0])); return }
      this.es.push({ k: 2, step: (it) => { it.setColor(csHex(cs.alt, it.nums(cs.alt.n))); return true } })
      for (const v of c) this.os.push(v)
      this.pushProc(cs.proc)
      return
    }
    this.setColor(csHex(cs, c))
  }
  paletteColor(cs, idx) {
    const pal = this.palette(cs), i = Math.max(0, Math.min(pal.length - 1, Math.round(idx)))
    return pal[i] || '#000000'
  }
  palette(cs) {
    if (cs.pal) return cs.pal
    const base = cs.base, nb = base.n, lk = cs.lookup, out = []
    if (lk instanceof PSStr) {
      for (let i = 0; i <= cs.hival && i * nb < lk.n; i++) { const c = []; for (let j = 0; j < nb; j++) c.push(lk.a[lk.o + i * nb + j] / 255); out.push(csHex(base, c)) }
    } else this.warn('An indexed colour table that is a procedure was approximated with grey.')
    if (!out.length) for (let i = 0; i <= Math.min(cs.hival, 255); i++) out.push(rgbHex(i / 255, i / 255, i / 255))
    cs.pal = out
    return out
  }

  // ----- fonts and text -----
  synthFont(name) {
    const d = new PSDict()
    d.m.set('FontName', new Name(name, false)); d.m.set('FontMatrix', mkArr([0.001, 0, 0, 0.001, 0, 0])); d.m.set('FontType', 1); d.m.set('PaintType', 0)
    d.m.set('Encoding', this.stdEnc); d.m.set('FontBBox', mkArr([0, 0, 1000, 1000]))
    return d
  }
  fontMatrix(f) { const a = f.m.get('FontMatrix'); return a instanceof PSArr && a.n === 6 ? arrNums(a) : [0.001, 0, 0, 0.001, 0, 0] }
  fontInfo(f) {
    const no = f.m.get('FontName'), nm = no === undefined ? 'Helvetica' : String(K(no))
    const c = classifyFont(nm), embedded = this.embedded.has(nm) || f.m.has('CharStrings') || f.m.get('FontType') === 3
    let enc = f.m.get('Encoding')
    if (!(enc instanceof PSArr) || enc === this.stdEnc || enc === this.isoEnc) enc = null
    return { ...c, embedded, enc, skip: embedded || c.symbolic, rawName: nm }
  }
  /** Draw bytes at the current point with the current font, then move the current point along. */
  showBytes(bytes) {
    const g = this.gs, f = g.font
    if (!f) throw new PSError('invalidfont', 'no font has been set')
    if (!g.has) throw new PSError('nocurrentpoint')
    const info = this.fontInfo(f), fm = this.fontMatrix(f)
    let str = '', w = 0
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      w += charWidth(info.kind, info.bold, b)
      if (info.enc) { const nm = info.enc.a[info.enc.o + b]; str += nm instanceof Name ? glyphToChar(nm.s, b) : decodeByte(b) } else str += decodeByte(b)
    }
    const sc = Math.sqrt(Math.abs(fm[0] * fm[3] - fm[1] * fm[2])), size = sc * 1000
    if (str.trim() && size > 0.01 && size < 1e6 && Number.isFinite(size)) {
      if (info.skip) this.warn(info.embedded ? `Text in the embedded font "${info.name}" was skipped (font programs are not read).` : `Text in the symbol font "${info.name}" was skipped.`)
      else {
        if (!info.std) this.warn(`The font "${info.name}" is not embedded, so its text uses a stand-in font.`)
        const c = g.ctm, lin = mul([c[0], c[1], c[2], c[3], 0, 0], [fm[0] / sc, fm[1] / sc, -fm[2] / sc, -fm[3] / sc, 0, 0])
        const tm = [rN(lin[0]), rN(lin[1]), rN(lin[2]), rN(lin[3]), r3(g.cx), r3(g.cy)]
        if (tm.every(Number.isFinite)) this.addItem({ t: 'text', str, family: info.family, size: r3(size), bold: info.bold, italic: info.italic, fill: g.fill, opacity: 1, m: tm })
      }
    }
    const adx = fm[0] * w, ady = fm[1] * w, c = g.ctm
    this.setCurDev(g.cx + c[0] * adx + c[2] * ady, g.cy + c[1] * adx + c[3] * ady)
  }

  // ----- images -----
  /** spec: {w,h,bps,ncomp,cs,im,src,mask,polarity,decode,multi}. Runs now for strings and files, in steps for procedure sources. */
  image(spec) {
    const g = this.gs
    spec.ctm = g.ctm; spec.clip = g.clip; spec.fill = g.fill
    const { w, h } = spec
    if (!(w > 0 && h > 0) || !Number.isInteger(w) || !Number.isInteger(h) || ![1, 2, 4, 8, 16].includes(spec.bps)) { this.warn('A picture with unsupported settings was skipped.'); return }
    if (w * h > this.lim.imgPx) { this.warn(`A picture of ${w} x ${h} pixels is too large and was skipped.`); return }
    if (spec.multi) { this.warn('A picture stored as separate colour planes was skipped.'); return }
    spec.need = h * Math.ceil((w * spec.ncomp * spec.bps) / 8)
    const src = spec.src
    if (src instanceof PSArr) {
      const chunks = []
      let got = 0, empty = 0, started = false
      this.es.push({ k: 2, step: (it) => {
        if (started) {
          const v = it.pop()
          if (!(v instanceof PSStr)) throw new PSError('typecheck', 'picture data must be a string')
          if (v.n) { chunks.push(v.a.subarray(v.o, v.o + v.n)); got += v.n; empty = 0 } else empty++
        }
        if (got >= spec.need || empty > 2) {
          const bytes = new Uint8Array(spec.need)
          let o = 0
          for (const c of chunks) { bytes.set(c.subarray(0, Math.min(c.length, spec.need - o)), o); o += c.length; if (o >= spec.need) break }
          it.pending = it.buildImage(spec, bytes)
          return true
        }
        started = true
        it.pushProc(src)
        return false
      } })
    } else this.pending = this.imageFromSource(spec)
  }
  async imageFromSource(spec) {
    const src = spec.src
    if (src instanceof PSStr) return this.buildImage(spec, src.a.subarray(src.o, src.o + Math.min(src.n, spec.need)))
    if (!(src instanceof PSFile)) throw new PSError('typecheck', 'picture data source')
    await ensureReady(src)
    if (src.kind === 'dct') return this.buildJpeg(spec, src.buf)
    const bytes = new Uint8Array(spec.need)
    let n = 0
    for (; n < spec.need; n++) { const b = rb(src); if (b < 0) break; bytes[n] = b }
    if (n < spec.need) this.warn('Picture data ended early; the missing part was left black.')
    skipEod(src)
    return this.buildImage(spec, bytes)
  }
  imageMatrix(spec, w, h) {
    const inv = invert(spec.im)
    const m = inv ? mul(spec.ctm, mul(inv, [w, 0, 0, h, 0, 0])).map(rN) : null
    return m && m.every(Number.isFinite) ? m : null
  }
  buildJpeg(spec, bytes) {
    let i = 2, w = 0, h = 0, comps = 0
    while (bytes[0] === 0xff && bytes[1] === 0xd8 && i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const mk = bytes[i + 1]
      if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) { i += mk === 0xff ? 1 : 2; continue }
      const len = (bytes[i + 2] << 8) | bytes[i + 3]
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) { h = (bytes[i + 5] << 8) | bytes[i + 6]; w = (bytes[i + 7] << 8) | bytes[i + 8]; comps = bytes[i + 9]; break }
      i += 2 + len
    }
    if (!w || !h) { this.warn('A JPEG picture in this file could not be read and was skipped.'); return }
    if (comps === 4) { this.warn('A CMYK JPEG picture in this file cannot be shown and was skipped.'); return }
    if (w * h > this.lim.imgPx) { this.warn('A very large JPEG picture was skipped.'); return }
    const m = this.imageMatrix(spec, spec.w || w, spec.h || h)
    if (!m) return
    this.addItem({ t: 'image', href: bytesToDataUrl(bytes, 'image/jpeg'), w, h, m, opacity: 1 }, spec.clip)
  }
  async buildImage(spec, bytes) {
    const { w, h, bps, ncomp, cs } = spec
    const rowBytes = Math.ceil((w * ncomp * bps) / 8), maxv = bps === 16 ? 255 : (1 << bps) - 1
    const ch = spec.mask ? 4 : 3
    const out = new Uint8Array(w * h * ch)
    const dec = spec.decode && spec.decode.length >= 2 * ncomp ? spec.decode : null
    const pal = cs.kind === 'idx' ? this.palette(cs).map((c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]) : null
    if (cs.kind === 'sep') this.warn('A picture using a spot colour was approximated in grey.')
    const [fr, fg, fb] = spec.mask ? [parseInt(spec.fill.slice(1, 3), 16), parseInt(spec.fill.slice(3, 5), 16), parseInt(spec.fill.slice(5, 7), 16)] : [0, 0, 0]
    const vals = new Array(ncomp)
    let o = 0
    const fast = bps === 8 && !dec && !spec.mask && (cs.kind === 'rgb' || cs.kind === 'gray')
    for (let y = 0; y < h; y++) {
      const ro = y * rowBytes
      if (fast) {
        if (cs.kind === 'rgb') { out.set(bytes.subarray(ro, ro + w * 3), o); o += w * 3 } else for (let x = 0; x < w; x++) { const v = bytes[ro + x]; out[o++] = v; out[o++] = v; out[o++] = v }
        continue
      }
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < ncomp; c++) {
          const idx = x * ncomp + c
          let v
          if (bps === 8) v = bytes[ro + idx]
          else if (bps === 16) v = bytes[ro + idx * 2]
          else { const bit = idx * bps; v = (bytes[ro + (bit >> 3)] >> (8 - bps - (bit & 7))) & maxv }
          vals[c] = v === undefined ? 0 : v
        }
        if (spec.mask) {
          const paint = (vals[0] === 0) !== !!spec.polarity
          out[o++] = fr; out[o++] = fg; out[o++] = fb; out[o++] = paint ? 255 : 0
          continue
        }
        const t = (c) => { const v = vals[c] / maxv; return dec ? dec[2 * c] + v * (dec[2 * c + 1] - dec[2 * c]) : v }
        let r, g, b
        if (cs.kind === 'idx') {
          const i = dec ? dec[0] + (vals[0] / maxv) * (dec[1] - dec[0]) : vals[0]
          const p = pal[Math.max(0, Math.min(pal.length - 1, Math.round(i)))] || [0, 0, 0]
          r = p[0]; g = p[1]; b = p[2]
        } else if (cs.kind === 'rgb') { r = clamp01(t(0)) * 255; g = clamp01(t(1)) * 255; b = clamp01(t(2)) * 255 } else if (cs.kind === 'cmyk') [r, g, b] = cmykToRgb(clamp01(t(0)), clamp01(t(1)), clamp01(t(2)), clamp01(t(3)))
        else if (cs.kind === 'sep') r = g = b = (1 - clamp01(t(0))) * 255
        else r = g = b = clamp01(t(0)) * 255
        out[o++] = r; out[o++] = g; out[o++] = b
      }
    }
    const m = this.imageMatrix(spec, w, h)
    if (!m) return
    const png = await encodePng(w, h, out, ch)
    this.addItem({ t: 'image', href: bytesToDataUrl(png, 'image/png'), w, h, m, opacity: 1 }, spec.clip)
  }

  // ----- pages -----
  finishPage() {
    if (!this.items.length) return
    if (this.pages.length >= this.lim.pages) { this.items = []; this.warn('Pages beyond the first 300 were skipped.'); return }
    this.pages.push({ w: r3(this.W), h: r3(this.H), items: this.items })
    this.items = []
  }
  showpage() {
    this.showpages++
    this.finishPage()
    const pb = this.pre.pageBoxes
    if (pb && pb[this.showpages]) this.setBox(pb[this.showpages])
    const font = this.gs.font
    this.gs = this.newGS(); this.gs.font = font
  }
  result() {
    this.finishPage()
    if (!this.pages.length) this.pages.push({ w: r3(this.W), h: r3(this.H), items: [] })
    const eof = this.s.lastIndexOf('%%EOF') >= 0
    const total = this.pages.reduce((a, p) => a + p.items.length, 0)
    if (!eof && !this.showpages) {
      if (!total) throw new Error('This PostScript file looks cut short and nothing could be drawn from it.')
      this.warn('The file seems to end early, so some of the drawing may be missing.')
    } else if (!total) this.warn('Nothing was drawn by this file.')
    const warnings = [...this.warnings.keys()]
    if (this.extraWarnings) warnings.push(`${this.extraWarnings} more warnings were left out.`)
    return { pages: this.pages, warnings }
  }
}

/** After picture data was read from a program-text filter, step over what is left of it (spare digits and the end-of-data mark) so the program carries on cleanly. */
function skipEod(f) {
  if (!(f instanceof PSFile)) return
  if (f.kind === 'rl') return skipEod(f.src)
  if ((f.kind === 'hex' || f.kind === 'a85') && f.src?.kind === 'raw') {
    const r = f.src, s = r.s
    let p = r.p
    if (f.kind === 'hex') {
      while (p < s.length && (isWs(s.charCodeAt(p)) || hexVal(s.charCodeAt(p)) >= 0)) p++
      if (s.charCodeAt(p) === 62) r.p = p + 1 // only when the run ends in '>', so a missing mark never swallows the program
    } else {
      while (p < s.length && isWs(s.charCodeAt(p))) p++
      if (s.charCodeAt(p) === 126 && s.charCodeAt(p + 1) === 62) r.p = p + 2
    }
  }
}

// ---------- operators ----------
const OPS = {}, AIOPS = {}
const D = (names, fn) => { for (const n of names.split(' ')) OPS[n] = fn }
const toText = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(7)))
  if (typeof v === 'boolean') return String(v)
  if (v instanceof Name) return v.s
  if (v instanceof PSStr) return v.text
  if (v instanceof Op) return `--${v.name}--`
  return '--nostringval--'
}
const typeName = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? 'integertype' : 'realtype') : typeof v === 'boolean' ? 'booleantype' : v instanceof Name ? 'nametype' : v instanceof PSStr ? 'stringtype'
  : v instanceof PSArr ? 'arraytype' : v instanceof PSDict ? 'dicttype' : v instanceof Op ? 'operatortype' : v === MARK ? 'marktype' : v === NULL ? 'nulltype' : v instanceof PSFile ? 'filetype' : 'savetype')
const needsReady = (f) => { for (let x = f; x instanceof PSFile; x = x.src) if (MATERIAL.has(x.kind) && !x.buf) return true; return false }
const withReady = (it, f, fn) => { if (needsReady(f)) it.pending = ensureReady(f).then(fn); else fn() }
const loopFrame = (step) => ({ k: 2, loop: true, step })

// --- stack ---
D('pop', (it) => { it.pop() })
D('exch', (it) => { const os = it.os, n = os.length; if (n < 2) throw new PSError('stackunderflow'); const t = os[n - 1]; os[n - 1] = os[n - 2]; os[n - 2] = t })
D('dup', (it) => { const os = it.os; if (!os.length) throw new PSError('stackunderflow'); os.push(os[os.length - 1]) })
D('copy', (it) => {
  const v = it.pop(), os = it.os
  if (typeof v === 'number') {
    if (v < 0 || v > os.length) throw new PSError('rangecheck', 'copy')
    const b = os.length - v
    for (let i = 0; i < v; i++) os.push(os[b + i])
    return
  }
  const src = it.pop()
  if (v instanceof PSArr && src instanceof PSArr) { if (src.n > v.n) throw new PSError('rangecheck', 'copy'); for (let i = 0; i < src.n; i++) v.a[v.o + i] = src.a[src.o + i]; os.push(new PSArr(v.a, v.o, src.n, v.x)) } else if (v instanceof PSStr && src instanceof PSStr) {
    if (src.n > v.n) throw new PSError('rangecheck', 'copy')
    v.a.set(src.a.subarray(src.o, src.o + src.n), v.o); os.push(new PSStr(v.a, v.o, src.n))
  } else if (v instanceof PSDict && src instanceof PSDict) { for (const [k, val] of src.m) v.m.set(k, val); os.push(v) } else throw new PSError('typecheck', 'copy')
})
D('index', (it) => { const n = it.pi(), os = it.os; if (n < 0 || n >= os.length) throw new PSError('rangecheck', 'index'); os.push(os[os.length - 1 - n]) })
D('roll', (it) => {
  const j = it.pi(), n = it.pi(), os = it.os
  if (n < 0 || n > os.length) throw new PSError('rangecheck', 'roll')
  if (n < 2) return
  const part = os.splice(os.length - n, n), s = ((j % n) + n) % n
  for (let i = n - s; i < n; i++) os.push(part[i])
  for (let i = 0; i < n - s; i++) os.push(part[i])
})
D('clear', (it) => { it.os.length = 0 })
D('count', (it) => { it.os.push(it.os.length) })
D('mark [ <<', (it) => { it.os.push(MARK) })
D('counttomark', (it) => { const i = it.os.lastIndexOf(MARK); if (i < 0) throw new PSError('unmatchedmark'); it.os.push(it.os.length - 1 - i) })
D('cleartomark', (it) => { const i = it.os.lastIndexOf(MARK); if (i < 0) throw new PSError('unmatchedmark'); it.os.length = i })
D(']', (it) => { const i = it.os.lastIndexOf(MARK); if (i < 0) throw new PSError('unmatchedmark'); const a = it.os.splice(i); a.shift(); it.os.push(mkArr(a)) })
D('>>', (it) => {
  const i = it.os.lastIndexOf(MARK); if (i < 0) throw new PSError('unmatchedmark')
  const a = it.os.splice(i), d = new PSDict()
  for (let k = 1; k + 1 < a.length; k += 2) d.m.set(K(a[k]), a[k + 1])
  it.os.push(d)
})

// --- arithmetic and logic ---
const bin = (fn) => (it) => { const b = it.pn(), a = it.pn(); it.os.push(fn(a, b)) }
const un = (fn) => (it) => { it.os.push(fn(it.pn())) }
D('add', bin((a, b) => a + b)); D('sub', bin((a, b) => a - b)); D('mul', bin((a, b) => a * b))
D('div', bin((a, b) => { if (b === 0) throw new PSError('undefinedresult', 'div'); return a / b }))
D('idiv', bin((a, b) => { if (b === 0) throw new PSError('undefinedresult', 'idiv'); return Math.trunc(a / b) }))
D('mod', bin((a, b) => { if (b === 0) throw new PSError('undefinedresult', 'mod'); return a % b }))
D('neg', un((a) => -a)); D('abs', un(Math.abs)); D('ceiling', un(Math.ceil)); D('floor', un(Math.floor)); D('round', un((a) => Math.floor(a + 0.5))); D('truncate cvi', un(Math.trunc))
D('sqrt', un((a) => { if (a < 0) throw new PSError('rangecheck', 'sqrt'); return Math.sqrt(a) }))
D('sin', un((a) => Math.sin((a * Math.PI) / 180))); D('cos', un((a) => Math.cos((a * Math.PI) / 180)))
D('atan', bin((a, b) => { let r = (Math.atan2(a, b) * 180) / Math.PI; if (r < 0) r += 360; return r }))
D('exp', bin((a, b) => a ** b)); D('ln', un(Math.log)); D('log', un(Math.log10))
let seed = 12345
D('rand', (it) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; it.os.push(seed) }); D('srand', (it) => { seed = it.pi() & 0x7fffffff }); D('rrand', (it) => { it.os.push(seed) })
D('bitshift', bin((a, b) => (b >= 0 ? Math.trunc(a) << b : Math.trunc(a) >> -b)))
const logic = (bf, nf) => (it) => { const b = it.pop(), a = it.pop(); if (typeof a === 'boolean' && typeof b === 'boolean') it.os.push(bf(a, b)); else if (typeof a === 'number' && typeof b === 'number') it.os.push(nf(a | 0, b | 0)); else throw new PSError('typecheck', 'logic') }
D('and', logic((a, b) => a && b, (a, b) => a & b)); D('or', logic((a, b) => a || b, (a, b) => a | b)); D('xor', logic((a, b) => a !== b, (a, b) => a ^ b))
D('not', (it) => { const a = it.pop(); if (typeof a === 'boolean') it.os.push(!a); else if (typeof a === 'number') it.os.push(~(a | 0)); else throw new PSError('typecheck', 'not') })
D('true', (it) => { it.os.push(true) }); D('false', (it) => { it.os.push(false) }); D('null', (it) => { it.os.push(NULL) })
D('eq', (it) => { const b = it.pop(), a = it.pop(); it.os.push(psEq(a, b)) }); D('ne', (it) => { const b = it.pop(), a = it.pop(); it.os.push(!psEq(a, b)) })
const cmp = (f) => (it) => { const b = it.pop(), a = it.pop(); if (typeof a === 'number' && typeof b === 'number') it.os.push(f(a, b)); else if ((a instanceof PSStr || a instanceof Name) && (b instanceof PSStr || b instanceof Name)) { const x = toText(a), y = toText(b); it.os.push(f(x < y ? -1 : x > y ? 1 : 0, 0)) } else throw new PSError('typecheck', 'compare') }
D('gt', cmp((a, b) => a > b)); D('ge', cmp((a, b) => a >= b)); D('lt', cmp((a, b) => a < b)); D('le', cmp((a, b) => a <= b))

// --- conversion and attributes ---
D('cvr', (it) => { const v = it.pop(); if (typeof v === 'number') it.os.push(v); else if (v instanceof PSStr) { const n = parseNum(v.text.trim()); if (n === null) throw new PSError('syntaxerror', 'cvr'); it.os.push(n) } else throw new PSError('typecheck', 'cvr') })
const cvi = OPS.cvi
D('cvi', (it) => { const v = it.os[it.os.length - 1]; if (v instanceof PSStr) { it.os.pop(); const n = parseNum(v.text.trim()); if (n === null) throw new PSError('syntaxerror', 'cvi'); it.os.push(Math.trunc(n)) } else cvi(it) })
D('cvs', (it) => { const s = it.ps(), v = it.pop(), t = toText(v); if (t.length > s.n) throw new PSError('rangecheck', 'cvs'); for (let i = 0; i < t.length; i++) s.a[s.o + i] = t.charCodeAt(i); it.os.push(new PSStr(s.a, s.o, t.length)) })
D('cvrs', (it) => { const s = it.ps(), radix = it.pi(), v = Math.trunc(it.pn()), t = v.toString(radix).toUpperCase(); if (t.length > s.n) throw new PSError('rangecheck', 'cvrs'); for (let i = 0; i < t.length; i++) s.a[s.o + i] = t.charCodeAt(i); it.os.push(new PSStr(s.a, s.o, t.length)) })
D('cvn', (it) => { const s = it.ps(); it.os.push(new Name(s.text, s.x)) })
D('cvx', (it) => { const v = it.pop(); it.os.push(v instanceof PSArr ? new PSArr(v.a, v.o, v.n, true) : v instanceof Name ? new Name(v.s, true) : v instanceof PSStr ? new PSStr(v.a, v.o, v.n, true) : v) })
D('cvlit', (it) => { const v = it.pop(); it.os.push(v instanceof PSArr ? new PSArr(v.a, v.o, v.n, false) : v instanceof Name ? new Name(v.s, false) : v instanceof PSStr ? new PSStr(v.a, v.o, v.n, false) : v) })
D('xcheck', (it) => { const v = it.pop(); it.os.push(v instanceof Op || ((v instanceof PSArr || v instanceof Name || v instanceof PSStr) && !!v.x)) })
D('readonly executeonly noaccess', () => {}); D('rcheck wcheck', (it) => { it.pop(); it.os.push(true) })
D('type', (it) => { it.os.push(new Name(typeName(it.pop()), false)) })

// --- composite objects ---
D('array', (it) => { const n = it.pi(); if (n < 0 || n > it.lim.arr) throw new PSError('limitcheck', 'array'); it.os.push(mkArr(new Array(n).fill(NULL))) })
D('string', (it) => { const n = it.pi(); if (n < 0 || n > it.lim.str) throw new PSError('limitcheck', 'string'); it.os.push(new PSStr(new Uint8Array(n))) })
D('dict', (it) => { const n = it.pi(); if (n < 0) throw new PSError('rangecheck', 'dict'); it.os.push(new PSDict()) })
D('length', (it) => { const v = it.pop(); it.os.push(v instanceof PSArr || v instanceof PSStr ? v.n : v instanceof PSDict ? v.m.size : v instanceof Name ? v.s.length : (() => { throw new PSError('typecheck', 'length') })()) })
D('maxlength', (it) => { const d = it.pd(); it.os.push(Math.max(d.m.size, 16)) })
D('get', (it) => {
  const k = it.pop(), o = it.pop()
  if (o instanceof PSDict) { const v = o.m.get(K(k)); if (v === undefined) throw new PSError('undefined', String(K(k))); it.os.push(v) } else if (o instanceof PSArr) { if (typeof k !== 'number' || k < 0 || k >= o.n) throw new PSError('rangecheck', 'get'); it.os.push(o.a[o.o + k]) } else if (o instanceof PSStr) { if (typeof k !== 'number' || k < 0 || k >= o.n) throw new PSError('rangecheck', 'get'); it.os.push(o.a[o.o + k]) } else throw new PSError('typecheck', 'get')
})
D('put', (it) => {
  const v = it.pop(), k = it.pop(), o = it.pop()
  if (o instanceof PSDict) o.m.set(K(k), v)
  else if (o instanceof PSArr) { if (typeof k !== 'number' || k < 0 || k >= o.n) throw new PSError('rangecheck', 'put'); o.a[o.o + k] = v } else if (o instanceof PSStr) { if (typeof k !== 'number' || k < 0 || k >= o.n || typeof v !== 'number') throw new PSError('rangecheck', 'put'); o.a[o.o + k] = v & 255 } else throw new PSError('typecheck', 'put')
})
D('getinterval', (it) => {
  const n = it.pi(), i = it.pi(), o = it.pop()
  if (!(o instanceof PSArr || o instanceof PSStr) || i < 0 || n < 0 || i + n > o.n) throw new PSError('rangecheck', 'getinterval')
  it.os.push(o instanceof PSArr ? new PSArr(o.a, o.o + i, n, o.x) : new PSStr(o.a, o.o + i, n, o.x))
})
D('putinterval', (it) => {
  const src = it.pop(), i = it.pi(), dst = it.pop()
  if (dst instanceof PSArr && src instanceof PSArr && i >= 0 && i + src.n <= dst.n) { const t = src.a.slice(src.o, src.o + src.n); for (let k = 0; k < t.length; k++) dst.a[dst.o + i + k] = t[k] } else if (dst instanceof PSStr && src instanceof PSStr && i >= 0 && i + src.n <= dst.n) dst.a.set(src.a.slice(src.o, src.o + src.n), dst.o + i)
  else throw new PSError('rangecheck', 'putinterval')
})
D('aload', (it) => { const a = it.pa(); for (let i = 0; i < a.n; i++) it.os.push(a.a[a.o + i]); it.os.push(a) })
D('astore', (it) => { const a = it.pa(); if (it.os.length < a.n) throw new PSError('stackunderflow'); const v = it.os.splice(it.os.length - a.n, a.n); for (let i = 0; i < a.n; i++) a.a[a.o + i] = v[i]; it.os.push(a) })
D('known', (it) => { const k = it.pop(), d = it.pd(); it.os.push(d.m.has(K(k))) })
D('where', (it) => { const k = K(it.pop()); for (let i = it.ds.length - 1; i >= 0; i--) if (it.ds[i].m.has(k)) { it.os.push(it.ds[i], true); return } it.os.push(false) })
D('undef', (it) => { const k = it.pop(), d = it.pd(); d.m.delete(K(k)) })
D('begin', (it) => { const d = it.pd(); if (it.ds.length >= it.lim.dictStack) throw new PSError('dictstackoverflow'); it.ds.push(d) })
D('end', (it) => { if (it.ds.length <= 2) throw new PSError('dictstackunderflow'); it.ds.pop() })
D('def', (it) => { const v = it.pop(), k = it.pop(); it.ds[it.ds.length - 1].m.set(K(k), v) })
D('load', (it) => { it.os.push(it.lookup(String(K(it.pop())))) })
D('store', (it) => { const v = it.pop(), k = String(K(it.pop())); for (let i = it.ds.length - 1; i >= 0; i--) if (it.ds[i].m.has(k)) { it.ds[i].m.set(k, v); return } it.ds[it.ds.length - 1].m.set(k, v) })
D('currentdict', (it) => { it.os.push(it.ds[it.ds.length - 1]) })
D('countdictstack', (it) => { it.os.push(it.ds.length) })
D('search', (it) => {
  const seek = it.ps(), s = it.ps(), t = s.text, i = t.indexOf(seek.text)
  if (i < 0) { it.os.push(s, false); return }
  it.os.push(new PSStr(s.a, s.o + i + seek.n, s.n - i - seek.n), new PSStr(s.a, s.o + i, seek.n), new PSStr(s.a, s.o, i), true)
})
D('anchorsearch', (it) => {
  const seek = it.ps(), s = it.ps()
  if (s.text.startsWith(seek.text)) it.os.push(new PSStr(s.a, s.o + seek.n, s.n - seek.n), new PSStr(s.a, s.o, seek.n), true); else it.os.push(s, false)
})
D('token', (it) => {
  const o = it.pop()
  const f = o instanceof PSStr ? new PSFile('raw', o.text) : o
  if (!(f instanceof PSFile) || f.kind !== 'raw') throw new PSError('typecheck', 'token')
  const t = scanToken(f, it)
  if (t === EOF) { it.os.push(false); return }
  if (t === RB) throw new PSError('syntaxerror', 'token')
  const v = t === LB ? it.scanProc(f, 0) : t
  if (o instanceof PSStr) it.os.push(new PSStr(o.a, o.o + f.p, o.n - f.p), v, true); else it.os.push(v, true)
})
D('bind', (it) => {
  const proc = it.os[it.os.length - 1]
  if (!(proc instanceof PSArr) || !proc.x) return
  const seen = new Set()
  const rec = (p, depth) => {
    if (seen.has(p) || depth > 50) return
    seen.add(p)
    for (let i = p.o; i < p.o + p.n; i++) {
      const v = p.a[i]
      if (v instanceof Name && v.x) { const r = it.sysd.m.get(v.s); if (r instanceof Op && it.tryLookup(v.s) === r) p.a[i] = r } else if (v instanceof PSArr && v.x) rec(v, depth + 1)
    }
  }
  rec(proc, 0)
})
D('save', (it) => { it.os.push({ sv: true, gs: it.cloneGS(), depth: it.gstack.length }) })
D('restore', (it) => { const s = it.pop(); if (!s || !s.sv) throw new PSError('typecheck', 'restore'); it.gstack.length = Math.min(it.gstack.length, s.depth); it.gs = s.gs })
D('vmstatus', (it) => { it.os.push(0, 1e6, 1e8) })
D('setglobal setpacking setvmthreshold setcachelimit setcacheparams setobjectformat setuserparams setsystemparams setdevparams setcachedevice2 settransfer setblackgeneration setundercolorremoval sethalftone setflat setstrokeadjust setoverprint setfileposition setsmoothness setaccuratescreens setstrokeadjust', (it) => { it.pop() })
D('setscreen', (it) => { it.pop(); it.pop(); it.pop() }); D('setcolortransfer', (it) => { for (let i = 0; i < 4; i++) it.pop() }); D('setcachedevice', (it) => { for (let i = 0; i < 6; i++) it.pop() })
D('currentglobal currentpacking gcheck', (it) => { it.os.push(false) }); D('currentflat', (it) => { it.os.push(1) }); D('currentoverprint', (it) => { it.os.push(false) })
D('usertime realtime', (it) => { it.os.push(Math.trunc(performance.now())) })
D('languagelevel', (it) => { it.os.push(2) }); D('revision serialnumber', (it) => { it.os.push(1) })
D('version', (it) => { it.os.push(PSStr.of('2017.0')) }); D('product', (it) => { it.os.push(PSStr.of('Draw Studio')) })
D('prompt flush flushfile vmreclaim pstack stack', () => {}); D('print = ==', (it) => { it.pop() }); D('write writestring writehexstring', (it) => { it.pop(); it.pop() })
D('setpagedevice', (it) => {
  const d = it.pop()
  const ps = d instanceof PSDict ? d.m.get('PageSize') : null
  if (ps instanceof PSArr && ps.n >= 2 && !it.hasBox && !it.items.length) {
    const w = ps.a[ps.o], h = ps.a[ps.o + 1]
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) { it.setBox([0, 0, w, h]); it.gs.ctm = it.base }
  }
})
D('currentpagedevice', (it) => { it.os.push(new PSDict()) })
D('findresource', (it) => {
  const cat = String(K(it.pop())), key = String(K(it.pop()))
  if (cat === 'Font') { it.os.push(it.fontDir.m.get(key) || it.synthFont(key)); return }
  const v = it.resources.get(cat + '/' + key)
  if (v === undefined) throw new PSError('undefined', key)
  it.os.push(v)
})
D('defineresource', (it) => { const cat = String(K(it.pop())), inst = it.pop(), key = String(K(it.pop())); if (cat === 'Font') it.fontDir.m.set(key, inst); else it.resources.set(cat + '/' + key, inst); it.os.push(inst) })
D('resourcestatus', (it) => { const cat = String(K(it.pop())), key = String(K(it.pop())); const has = cat === 'Font' ? it.fontDir.m.has(key) : it.resources.has(cat + '/' + key); if (has) it.os.push(0, 0, true); else it.os.push(false) })

// --- control ---
D('exec', (it) => { it.runObj(it.pop()) })
D('if', (it) => { const p = it.pop(), b = it.pb(); if (b) it.runObj(p) })
D('ifelse', (it) => { const q = it.pop(), p = it.pop(), b = it.pb(); it.runObj(b ? p : q) })
D('repeat', (it) => { const p = it.pop(), n = it.pi(); if (n < 0) throw new PSError('rangecheck', 'repeat'); let i = 0; it.es.push(loopFrame((it2) => { if (i++ >= n) return true; it2.runObj(p); return false })) })
D('loop', (it) => { const p = it.pop(); it.es.push(loopFrame((it2) => { it2.runObj(p); return false })) })
D('for', (it) => {
  const p = it.pop(), lim = it.pn(), inc = it.pn()
  let cur = it.pn()
  it.es.push(loopFrame((it2) => { if (inc > 0 ? cur > lim : cur < lim) return true; it2.os.push(cur); cur += inc; it2.runObj(p); return false }))
})
D('forall', (it) => {
  const p = it.pop(), o = it.pop()
  let i = 0
  if (o instanceof PSArr) it.es.push(loopFrame((it2) => { if (i >= o.n) return true; it2.os.push(o.a[o.o + i++]); it2.runObj(p); return false }))
  else if (o instanceof PSStr) it.es.push(loopFrame((it2) => { if (i >= o.n) return true; it2.os.push(o.a[o.o + i++]); it2.runObj(p); return false }))
  else if (o instanceof PSDict) {
    const ents = [...o.m.entries()]
    it.es.push(loopFrame((it2) => { if (i >= ents.length) return true; const [k, v] = ents[i++]; it2.os.push(typeof k === 'string' ? new Name(k, false) : k, v); it2.runObj(p); return false }))
  } else throw new PSError('typecheck', 'forall')
})
D('exit', (it) => {
  const es = it.es
  while (es.length) { const f = es.pop(); if (f.k === 2 && f.loop) return; if (f.k === 1) { es.push(f); break } }
  throw new PSError('invalidexit')
})
D('stopped', (it) => { const o = it.pop(); it.es.push({ k: 2, stopped: true, step: (it2) => { it2.os.push(false); return true } }); it.runObj(o) })
D('stop', (it) => {
  const es = it.es
  for (let i = es.length - 1; i >= 0; i--) { const f = es[i]; if (f.k === 2 && f.stopped) { es.length = i; it.os.push(true); return } if (f.k === 1 && f.f.main) { es.length = i + 1; return } }
})
D('quit', (it) => { it.es.length = 0 })
D('countexecstack', (it) => { it.os.push(it.es.length) })
D('start', () => {})

// --- files ---
D('currentfile', (it) => {
  for (let i = it.es.length - 1; i >= 0; i--) if (it.es[i].k === 1) { it.os.push(it.es[i].f); return }
  it.os.push(new PSFile('raw', ''))
})
D('file', (it) => { it.pop(); it.pop(); it.os.push(new PSFile('raw', '')) })
D('status', (it) => { it.pop(); it.os.push(false) })
D('closefile', (it) => { const f = it.pop(); if (f instanceof PSFile && !f.main) f.eod = true })
D('read', (it) => { const f = it.pop(); if (!(f instanceof PSFile)) throw new PSError('typecheck', 'read'); withReady(it, f, () => { const b = rb(f); if (b < 0) it.os.push(false); else it.os.push(b, true) }) })
D('readstring', (it) => {
  const s = it.ps(), f = it.pop()
  if (!(f instanceof PSFile)) throw new PSError('typecheck', 'readstring')
  withReady(it, f, () => { let n = 0; for (; n < s.n; n++) { const b = rb(f); if (b < 0) break; s.a[s.o + n] = b } it.os.push(new PSStr(s.a, s.o, n), n === s.n) })
})
D('readhexstring', (it) => {
  const s = it.ps(), f = it.pop()
  if (!(f instanceof PSFile)) throw new PSError('typecheck', 'readhexstring')
  withReady(it, f, () => {
    let n = 0, hi = -1, eof = false
    while (n < s.n) {
      const c = rb(f)
      if (c < 0 || c === 62) { eof = true; break }
      const v = hexVal(c)
      if (v < 0) continue
      if (hi < 0) hi = v; else { s.a[s.o + n++] = (hi << 4) | v; hi = -1 }
    }
    it.os.push(new PSStr(s.a, s.o, n), !eof)
  })
})
D('readline', (it) => {
  const s = it.ps(), f = it.pop()
  if (!(f instanceof PSFile)) throw new PSError('typecheck', 'readline')
  withReady(it, f, () => {
    let n = 0, eof = true
    for (;;) {
      const b = rb(f)
      if (b < 0) break
      eof = false
      if (b === 10) break
      if (b === 13) continue
      if (n >= s.n) throw new PSError('rangecheck', 'readline')
      s.a[s.o + n++] = b
    }
    it.os.push(new PSStr(s.a, s.o, n), !eof)
  })
})
D('filter', (it) => {
  const name = String(K(it.pop()))
  let par = null
  const top = it.os[it.os.length - 1]
  if (top instanceof PSDict) par = it.pop()
  else if (name === 'SubFileDecode' && top instanceof PSStr) { const e = it.pop(); it.pop(); par = new PSDict(); par.m.set('EODString', e) }
  let src = it.pop()
  if (src instanceof PSStr) src = new PSFile('raw', src.text)
  if (!(src instanceof PSFile)) { it.warn('A data filter on a procedure source is not supported.'); src = new PSFile('raw', '') }
  const kinds = { ASCIIHexDecode: 'hex', AHx: 'hex', ASCII85Decode: 'a85', A85: 'a85', RunLengthDecode: 'rl', RL: 'rl', FlateDecode: 'flate', Fl: 'flate', LZWDecode: 'lzw', LZW: 'lzw', DCTDecode: 'dct', DCT: 'dct', SubFileDecode: 'sub' }
  const kind = kinds[name]
  if (!kind) throw new PSError('undefinedfilename', name)
  const f = new PSFile(kind, '', src)
  if (par) {
    const pr = par.m.get('Predictor')
    if (typeof pr === 'number' && pr > 1) it.warn('Image data with a predictor is not supported.')
    const ec = par.m.get('EarlyChange'), es = par.m.get('EODString')
    f.par = { early: typeof ec === 'number' ? ec : 1, eodStr: es instanceof PSStr ? es.text : '' }
  }
  it.os.push(f)
})
D('eexec', (it) => {
  const f = it.pop()
  if (!(f instanceof PSFile) || f.kind !== 'raw') return
  const pre = f.s.slice(Math.max(0, f.p - 4000), f.p)
  let nm = null
  for (const m of pre.matchAll(/\/FontName\s*\/([^\s/[\]{}()<>]+)/g)) nm = m[1]
  const e = f.s.indexOf('cleartomark', f.p)
  f.p = e < 0 ? f.s.length : e + 11
  const top = it.os[it.os.length - 1]
  if (top instanceof PSDict && top.m.has('FontName')) { it.os.pop(); nm = String(K(top.m.get('FontName'))); it.fontDir.m.set(nm, top) }
  if (nm) it.embedded.add(nm)
})

// --- graphics state ---
D('gsave', (it) => { if (it.gstack.length >= it.lim.gstack) throw new PSError('limitcheck', 'gsave'); it.gstack.push(it.cloneGS()) })
D('grestore', (it) => { if (it.gstack.length) it.gs = it.gstack.pop() })
D('grestoreall', (it) => { if (it.gstack.length) { it.gs = it.gstack[0]; it.gstack.length = 0 } })
D('initgraphics', (it) => { const f = it.gs.font; it.gs = it.newGS(); it.gs.font = f })
D('showpage copypage', (it) => { it.showpage() })
D('erasepage', (it) => { it.items = [] })
D('initclip', (it) => { it.gs.clip = [] })
D('setgray', (it) => { const [v] = it.nums(1); it.gs.cs = GRAY; it.setColor(rgbHex(v, v, v)) })
D('setrgbcolor', (it) => { const [r, g, b] = it.nums(3); it.gs.cs = RGB; it.setColor(rgbHex(r, g, b)) })
D('setcmykcolor', (it) => { const [c, m, y, k] = it.nums(4); it.gs.cs = CMYK; it.setColor(cmykHex(c, m, y, k)) })
D('sethsbcolor', (it) => {
  const [h, s, v] = it.nums(3), hh = (((h % 1) + 1) % 1) * 6, i = Math.floor(hh), f = hh - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f))
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]
  it.gs.cs = RGB; it.setColor(rgbHex(r, g, b))
})
D('setcolorspace', (it) => { const cs = csFromObj(it.pop(), it); it.gs.cs = cs; if (cs.kind !== 'pat') it.setColor('#000000') })
D('setcolor', (it) => { it.setcolor() })
D('setpattern', (it) => { it.pop(); it.warn('Pattern fills are approximated with grey.'); it.setColor('#808080') })
D('makepattern', (it) => { it.pop() })
D('shfill sh', (it) => { it.pop(); it.warn('A shading (smooth colour blend) in this file was skipped.') })
D('currentrgbcolor', (it) => { const h = it.gs.fill || '#000000'; it.os.push(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255) })
D('currentgray', (it) => { const h = it.gs.fill || '#000000'; it.os.push((0.3 * parseInt(h.slice(1, 3), 16) + 0.59 * parseInt(h.slice(3, 5), 16) + 0.11 * parseInt(h.slice(5, 7), 16)) / 255) })
D('setlinewidth', (it) => { it.gs.lw = Math.abs(it.pn()) })
D('setlinecap', (it) => { it.gs.cap = Math.max(0, Math.min(2, it.pi())) })
D('setlinejoin', (it) => { it.gs.join = Math.max(0, Math.min(2, it.pi())) })
D('setmiterlimit', (it) => { it.gs.miter = it.pn() })
D('setdash', (it) => { const off = it.pn(), a = it.pa(); it.gs.dash = arrNums(a).map(Math.abs); it.gs.doff = off })
D('currentlinewidth', (it) => { it.os.push(it.gs.lw) }); D('currentlinecap', (it) => { it.os.push(it.gs.cap) }); D('currentlinejoin', (it) => { it.os.push(it.gs.join) }); D('currentmiterlimit', (it) => { it.os.push(it.gs.miter) })
D('currentdash', (it) => { it.os.push(mkArr(it.gs.dash.slice()), it.gs.doff) })

// --- matrices ---
D('matrix', (it) => { it.os.push(mkArr([1, 0, 0, 1, 0, 0])) })
D('identmatrix', (it) => { const a = it.pa(); it.setMat(a, [1, 0, 0, 1, 0, 0]); it.os.push(a) })
D('currentmatrix', (it) => { const a = it.pa(); it.setMat(a, it.gs.ctm); it.os.push(a) })
D('defaultmatrix', (it) => { const a = it.pa(); it.setMat(a, it.base); it.os.push(a) })
D('setmatrix', (it) => { it.gs.ctm = it.matOf(it.pa()) })
D('initmatrix', (it) => { it.gs.ctm = it.base })
D('concat', (it) => { it.gs.ctm = mul(it.gs.ctm, it.matOf(it.pa())) })
D('concatmatrix', (it) => { const c = it.pa(), b = it.matOf(it.pa()), a = it.matOf(it.pa()); it.setMat(c, mul(b, a)); it.os.push(c) })
D('invertmatrix', (it) => { const b = it.pa(), a = it.matOf(it.pa()), inv = invert(a); if (!inv) throw new PSError('undefinedresult', 'invertmatrix'); it.setMat(b, inv); it.os.push(b) })
const withMat = (it, make) => {
  const top = it.os[it.os.length - 1]
  if (top instanceof PSArr) { const a = it.pa(), v = make(it); it.setMat(a, v); it.os.push(a) } else it.gs.ctm = mul(it.gs.ctm, make(it))
}
D('translate', (it) => { const top = it.os[it.os.length - 1]; if (top instanceof PSArr) { const a = it.pa(), [x, y] = it.nums(2); it.setMat(a, [1, 0, 0, 1, x, y]); it.os.push(a) } else { const [x, y] = it.nums(2); it.gs.ctm = mul(it.gs.ctm, [1, 0, 0, 1, x, y]) } })
D('scale', (it) => { const top = it.os[it.os.length - 1]; if (top instanceof PSArr) { const a = it.pa(), [x, y] = it.nums(2); it.setMat(a, [x, 0, 0, y, 0, 0]); it.os.push(a) } else { const [x, y] = it.nums(2); it.gs.ctm = mul(it.gs.ctm, [x, 0, 0, y, 0, 0]) } })
D('rotate', (it) => {
  const rot = (deg) => { const r = (deg * Math.PI) / 180; return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0] }
  withMat(it, (i2) => rot(i2.pn()))
})
const xf = (it, linear, inverse) => {
  const top = it.os[it.os.length - 1]
  let m = it.gs.ctm
  if (top instanceof PSArr) m = it.matOf(it.pa())
  if (inverse) { m = invert(m); if (!m) throw new PSError('undefinedresult', 'itransform') }
  const [x, y] = it.nums(2)
  it.os.push(m[0] * x + m[2] * y + (linear ? 0 : m[4]), m[1] * x + m[3] * y + (linear ? 0 : m[5]))
}
D('transform', (it) => xf(it, false, false)); D('itransform', (it) => xf(it, false, true)); D('dtransform', (it) => xf(it, true, false)); D('idtransform', (it) => xf(it, true, true))

// --- paths ---
D('newpath', (it) => { it.clearPath() })
D('moveto', (it) => { const [x, y] = it.nums(2), [X, Y] = it.dev(x, y); it.moveDev(X, Y) })
D('lineto', (it) => { const [x, y] = it.nums(2), [X, Y] = it.dev(x, y); it.lineDev(X, Y) })
D('curveto', (it) => { const v = it.nums(6), a = it.dev(v[0], v[1]), b = it.dev(v[2], v[3]), c = it.dev(v[4], v[5]); it.curveDev(a[0], a[1], b[0], b[1], c[0], c[1]) })
const rel = (it, dx, dy) => { const g = it.gs, c = g.ctm; if (!g.has) throw new PSError('nocurrentpoint'); return [g.cx + c[0] * dx + c[2] * dy, g.cy + c[1] * dx + c[3] * dy] }
D('rmoveto', (it) => { const [dx, dy] = it.nums(2), [X, Y] = rel(it, dx, dy); it.moveDev(X, Y) })
D('rlineto', (it) => { const [dx, dy] = it.nums(2), [X, Y] = rel(it, dx, dy); it.lineDev(X, Y) })
D('rcurveto', (it) => { const v = it.nums(6), a = rel(it, v[0], v[1]), b = rel(it, v[2], v[3]), c = rel(it, v[4], v[5]); it.curveDev(a[0], a[1], b[0], b[1], c[0], c[1]) })
D('closepath', (it) => { it.closePath() })
D('currentpoint', (it) => { const g = it.gs; if (!g.has) throw new PSError('nocurrentpoint'); const inv = invert(g.ctm); if (!inv) throw new PSError('undefinedresult', 'currentpoint'); it.os.push(inv[0] * g.cx + inv[2] * g.cy + inv[4], inv[1] * g.cx + inv[3] * g.cy + inv[5]) })
D('arc', (it) => { const [x, y, r, a, b] = it.nums(5); it.arc(x, y, r, a, b, true) })
D('arcn', (it) => { const [x, y, r, a, b] = it.nums(5); it.arc(x, y, r, a, b, false) })
D('arcto arct', (it) => {
  const [x1, y1, x2, y2, r] = it.nums(5), g = it.gs, inv = invert(g.ctm)
  if (!g.has || !inv) throw new PSError('nocurrentpoint')
  const x0 = inv[0] * g.cx + inv[2] * g.cy + inv[4], y0 = inv[1] * g.cx + inv[3] * g.cy + inv[5]
  const ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
  const cross = ax * by - ay * bx
  if (!la || !lb || Math.abs(cross) < 1e-9 * la * lb || !(r > 0)) { const [X, Y] = it.dev(x1, y1); it.lineDev(X, Y); it.os.push(x1, y1, x1, y1); return }
  const ux = ax / la, uy = ay / la, vx = bx / lb, vy = by / lb
  const theta = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy))), d = r / Math.tan(theta / 2)
  const t1x = x1 + ux * d, t1y = y1 + uy * d, t2x = x1 + vx * d, t2y = y1 + vy * d
  let mx = ux + vx, my = uy + vy
  const ml = Math.hypot(mx, my); mx /= ml; my /= ml
  const cd = r / Math.sin(theta / 2), cx = x1 + mx * cd, cy = y1 + my * cd
  const s = (Math.atan2(t1y - cy, t1x - cx) * 180) / Math.PI, e = (Math.atan2(t2y - cy, t2x - cx) * 180) / Math.PI
  it.arc(cx, cy, r, s, e, cross < 0)
  it.os.push(t1x, t1y, t2x, t2y)
})
D('fill', (it) => { it.fillPath('nonzero') }); D('eofill', (it) => { it.fillPath('evenodd') }); D('stroke', (it) => { it.strokePath() })
D('clip', (it) => { it.doClip('nonzero') }); D('eoclip', (it) => { it.doClip('evenodd') })
D('flattenpath reversepath', () => {}); D('strokepath', (it) => { it.warn('strokepath is not supported; the outline was left as is.') })
D('pathbbox', (it) => {
  const d = it.takePath(), g = it.gs, inv = invert(g.ctm), b = d && pathBBox(d)
  if (!b) throw new PSError('nocurrentpoint')
  if (!inv) throw new PSError('undefinedresult', 'pathbbox')
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]])
  it.os.push(Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])))
})
D('clippath', (it) => {
  it.clearPath()
  it.moveDev(0, 0); it.lineDev(it.W, 0); it.lineDev(it.W, it.H); it.lineDev(0, it.H); it.closePath()
})
const rectArgs = (it) => {
  const top = it.os[it.os.length - 1]
  if (top instanceof PSArr) { const a = arrNums(it.pa()); if (a.length < 4) throw new PSError('rangecheck', 'rect'); return a.slice(0, 4) }
  return it.nums(4)
}
const tempRect = (it, v, fn) => {
  const g = it.gs, saved = { d: g.d, has: g.has, closed: g.closed, cx: g.cx, cy: g.cy, sx: g.sx, sy: g.sy }
  g.d = []; g.has = false; g.closed = false
  const [x, y, w, h] = v, p = [it.dev(x, y), it.dev(x + w, y), it.dev(x + w, y + h), it.dev(x, y + h)]
  it.moveDev(...p[0]); it.lineDev(...p[1]); it.lineDev(...p[2]); it.lineDev(...p[3]); it.closePath()
  fn()
  Object.assign(g, saved)
}
D('rectfill', (it) => { const v = rectArgs(it); tempRect(it, v, () => it.fillPath('nonzero')) })
D('rectstroke', (it) => { const v = rectArgs(it); tempRect(it, v, () => it.strokePath()) })
D('rectclip', (it) => { const v = rectArgs(it); tempRect(it, v, () => it.doClip('nonzero')) })

// --- fonts and text ---
const copyFont = (f) => { const d = new PSDict(); d.m = new Map(f.m); return d }
const scaled = (f, m) => { const d = copyFont(f); d.m.set('FontMatrix', mkArr(mul(m, it_fm(f)))); return d }
const it_fm = (f) => { const a = f.m.get('FontMatrix'); return a instanceof PSArr && a.n === 6 ? arrNums(a) : [0.001, 0, 0, 0.001, 0, 0] }
D('findfont', (it) => { const k = String(K(it.pop())); it.os.push(it.fontDir.m.get(k) || it.synthFont(k)) })
D('scalefont', (it) => { const s = it.pn(), f = it.pd(); it.os.push(scaled(f, [s, 0, 0, s, 0, 0])) })
D('makefont', (it) => { const m = it.matOf(it.pa()), f = it.pd(); it.os.push(scaled(f, m)) })
D('setfont', (it) => { it.gs.font = it.pd() })
D('currentfont rootfont', (it) => { if (!it.gs.font) throw new PSError('invalidfont'); it.os.push(it.gs.font) })
D('definefont', (it) => { const f = it.pd(), k = String(K(it.pop())); it.fontDir.m.set(k, f); it.os.push(f) })
D('undefinefont', (it) => { it.fontDir.m.delete(String(K(it.pop()))) })
D('selectfont', (it) => {
  const sz = it.pop(), k = String(K(it.pop())), f = it.fontDir.m.get(k) || it.synthFont(k)
  it.gs.font = scaled(f, sz instanceof PSArr ? it.matOf(sz) : [sz, 0, 0, sz, 0, 0])
})
const bytesOf = (s) => s.a.subarray(s.o, s.o + s.n)
D('show', (it) => { it.showBytes(bytesOf(it.ps())) })
D('ashow', (it) => { const s = it.ps(); it.nums(2); it.showBytes(bytesOf(s)) })
D('widthshow', (it) => { const s = it.ps(); it.nums(3); it.showBytes(bytesOf(s)) })
D('awidthshow', (it) => { const s = it.ps(); it.nums(5); it.showBytes(bytesOf(s)) })
D('xshow yshow xyshow', (it) => { it.pop(); it.showBytes(bytesOf(it.ps())) })
D('kshow', (it) => { const s = it.ps(); it.pop(); it.showBytes(bytesOf(s)) })
D('cshow', (it) => { it.ps(); it.pop(); it.warn('cshow is not supported; that text was skipped.') })
D('charpath', (it) => { it.pb(); it.ps(); it.warn('Text turned into outlines by charpath was skipped.') })
D('stringwidth', (it) => {
  const s = it.ps(), g = it.gs
  if (!g.font) throw new PSError('invalidfont')
  const info = it.fontInfo(g.font), fm = it.fontMatrix(g.font)
  let w = 0
  for (const b of bytesOf(s)) w += charWidth(info.kind, info.bold, b)
  it.os.push(fm[0] * w, fm[1] * w)
})
D('image', (it) => {
  const top = it.os[it.os.length - 1]
  if (top instanceof PSDict) {
    const d = it.pop(), n = (k) => d.m.get(k)
    if (n('ImageType') === 3 || n('ImageType') === 4 || (typeof n('ImageType') === 'number' && n('ImageType') !== 1)) { it.warn('A masked picture in this file was skipped.'); return }
    const mask = n('ImageMask') === true
    const cs = mask ? GRAY : it.gs.cs.kind === 'pat' ? GRAY : it.gs.cs
    const im = n('ImageMatrix'), dec = n('Decode')
    const decode = dec instanceof PSArr ? arrNums(dec) : null
    it.image({ w: n('Width'), h: n('Height'), bps: mask ? 1 : n('BitsPerComponent'), ncomp: mask ? 1 : cs.n, cs, im: im instanceof PSArr ? it.matOf(im) : [1, 0, 0, 1, 0, 0], src: n('DataSource'), mask, polarity: mask && decode ? decode[0] === 1 : false, decode: mask ? null : decode, multi: n('MultipleDataSources') === true })
    return
  }
  const src = it.pop(), im = it.matOf(it.pa()), bps = it.pi(), h = it.pi(), w = it.pi()
  const cs = it.gs.cs.kind === 'pat' ? GRAY : it.gs.cs
  it.image({ w, h, bps, ncomp: cs.n, cs, im, src })
})
D('imagemask', (it) => {
  const top = it.os[it.os.length - 1]
  if (top instanceof PSDict) { OPS.image(it); return }
  const src = it.pop(), im = it.matOf(it.pa()), polarity = it.pb(), h = it.pi(), w = it.pi()
  it.image({ w, h, bps: 1, ncomp: 1, cs: GRAY, im, src, mask: true, polarity })
})
D('colorimage', (it) => {
  const ncomp = it.pi(), multi = it.pb()
  const srcs = []
  for (let i = 0; i < (multi ? ncomp : 1); i++) srcs.unshift(it.pop())
  const im = it.matOf(it.pa()), bps = it.pi(), h = it.pi(), w = it.pi()
  if (![1, 3, 4].includes(ncomp)) throw new PSError('rangecheck', 'colorimage')
  it.image({ w, h, bps, ncomp, cs: ncomp === 1 ? GRAY : ncomp === 3 ? RGB : CMYK, im, src: srcs[0], multi })
})

// ---------- legacy AI operators (the prolog of these files is not run, so they are built in) ----------
const A = (names, fn) => { for (const n of names.split(' ')) AIOPS[n] = fn }
const aiPaint = (close, fill, stroke) => (it) => {
  if (close) it.closePath()
  const c = it.compound
  if (c) {
    const g = it.gs
    for (const cmd of g.d) c.d.push(cmd)
    if (fill || stroke) c.op = { fill, stroke }
    it.clearPath()
    return
  }
  if (fill && stroke) it.fillStroke('nonzero'); else if (fill) it.fillPath('nonzero'); else if (stroke) it.strokePath(); else it.clearPath()
}
A('m', OPS.moveto); A('l L', OPS.lineto); A('c C', OPS.curveto); A('h', OPS.closepath); A('H', () => {})
A('v V', (it) => { const [x2, y2, x3, y3] = it.nums(4), g = it.gs, a = it.dev(x2, y2), b = it.dev(x3, y3); if (!g.has) throw new PSError('nocurrentpoint'); it.curveDev(g.cx, g.cy, a[0], a[1], b[0], b[1]) })
A('y Y', (it) => { const [x1, y1, x3, y3] = it.nums(4), a = it.dev(x1, y1), b = it.dev(x3, y3); it.curveDev(a[0], a[1], b[0], b[1], b[0], b[1]) })
A('f', aiPaint(true, true, false)); A('F', aiPaint(false, true, false)); A('s', aiPaint(true, false, true)); A('S', aiPaint(false, false, true))
A('b', aiPaint(true, true, true)); A('B', aiPaint(false, true, true)); A('n', aiPaint(true, false, false)); A('N', aiPaint(false, false, false))
A('g', (it) => { const [v] = it.nums(1); it.setColor(rgbHex(v, v, v), 1) })
A('G', (it) => { const [v] = it.nums(1); it.setColor(rgbHex(v, v, v), 2) })
A('k', (it) => { const [c, m, y, k] = it.nums(4); it.setColor(cmykHex(c, m, y, k), 1) })
A('K', (it) => { const [c, m, y, k] = it.nums(4); it.setColor(cmykHex(c, m, y, k), 2) })
const aiCustom = (which) => (it) => {
  let tint = 1
  if (typeof it.os[it.os.length - 1] === 'number') tint = it.pn()
  it.ps()
  const [c, m, y, k] = it.nums(4), t = clamp01(tint)
  it.setColor(cmykHex(c * t, m * t, y * t, k * t), which)
}
A('x', aiCustom(1)); A('X', aiCustom(2))
A('Xa', (it) => { const [r, g, b] = it.nums(3); it.setColor(rgbHex(r, g, b), 1) }); A('XA', (it) => { const [r, g, b] = it.nums(3); it.setColor(rgbHex(r, g, b), 2) })
A('w', OPS.setlinewidth); A('j', OPS.setlinejoin); A('J', OPS.setlinecap); A('M', OPS.setmiterlimit); A('d', OPS.setdash)
A('i D O R A Z', (it) => { it.pop() })
A('u U', () => {}); A('q', OPS.gsave); A('Q', OPS.grestore); A('W', (it) => { it.doClip('nonzero') })
A('*u', (it) => { it.compound = { d: [], op: null } })
A('*U', (it) => {
  const c = it.compound
  it.compound = null
  if (!c) return
  const g = it.gs
  g.d = c.d; g.has = c.d.length > 0; g.closed = false
  if (c.op && c.op.fill && c.op.stroke) it.fillStroke('nonzero'); else if (c.op && c.op.fill) it.fillPath('nonzero'); else if (c.op && c.op.stroke) it.strokePath(); else it.clearPath()
})
A('Lb', (it) => { for (let i = 0; i < 10 && it.os.length; i++) it.pop() }); A('Ln', (it) => { it.pop() }); A('LB', () => {})
// text blocks: a text matrix, a font, then strings shown at the matrix origin
const aiTm = (it) => (it.aiText ||= { tm: [1, 0, 0, 1, 0, 0], size: 12, hide: false })
A('To', (it) => { if (typeof it.os[it.os.length - 1] === 'number') it.pop(); it.aiText = { tm: [1, 0, 0, 1, 0, 0], size: 12, hide: false } }); A('TO', (it) => { it.aiText = null })
A('Tp Tm', (it) => { aiTm(it).tm = it.nums(6) }); A('TP', () => {})
A('Tf', (it) => {
  const nums = []
  while (typeof it.os[it.os.length - 1] === 'number') nums.unshift(it.os.pop())
  const nm = String(K(it.pop())), t = aiTm(it), size = nums[0] > 0 ? nums[0] : 12
  t.size = size
  it.gs.font = scaled(it.fontDir.m.get(nm.replace(/^_/, '')) || it.synthFont(nm), [size, 0, 0, size, 0, 0])
})
A('Tr', (it) => { const v = it.pn(); aiTm(it).hide = v === 3 })
A('Tl Tc Tw Tz Ts Tt', (it) => { it.pop() })
A('Tx Tj TX', (it) => {
  const s = it.ps(), t = aiTm(it), g = it.gs
  if (!g.font) g.font = scaled(it.synthFont('Helvetica'), [12, 0, 0, 12, 0, 0])
  const info = it.fontInfo(g.font), fm = it.fontMatrix(g.font)
  let w = 0
  for (const b of bytesOf(s)) w += charWidth(info.kind, info.bold, b)
  const sz = Math.sqrt(Math.abs(fm[0] * fm[3] - fm[1] * fm[2])) * 1000
  if (!t.hide) {
    const saved = { ctm: g.ctm, d: g.d, has: g.has, closed: g.closed, cx: g.cx, cy: g.cy, sx: g.sx, sy: g.sy }
    g.ctm = mul(g.ctm, t.tm); g.d = []; g.has = false
    it.moveDev(g.ctm[4], g.ctm[5])
    it.showBytes(bytesOf(s))
    Object.assign(g, saved)
  }
  const adv = (w * sz) / 1000
  t.tm = [t.tm[0], t.tm[1], t.tm[2], t.tm[3], t.tm[4] + t.tm[0] * adv, t.tm[5] + t.tm[1] * adv]
})

// ---------- entry points ----------
const toBytes = (data, max = Infinity) => {
  if (typeof data === 'string') { const n = Math.min(data.length, max), a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = data.charCodeAt(i) & 255; return a }
  if (data instanceof ArrayBuffer) return new Uint8Array(data, 0, Math.min(data.byteLength, max))
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, Math.min(data.byteLength, max))
  return null
}
/** True for PostScript text (%!), a DOS EPS binary header (C5 D0 D3 C6), or PostScript behind a printer-job header. Reads at most 4 KB. */
export function isPostScript(bytes) {
  const b = toBytes(bytes, 4096)
  if (!b || b.length < 2) return false
  if (b.length >= 4 && b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6) return true
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0
  while (i < b.length && (b[i] === 32 || b[i] === 9 || b[i] === 10 || b[i] === 13)) i++
  if (b[i] === 0x25 && b[i + 1] === 0x21) return true
  if (b[i] === 0x1b) for (let k = i; k + 3 < b.length; k++) if (b[k] === 0x25 && b[k + 1] === 0x21 && b[k + 2] === 0x50 && b[k + 3] === 0x53) return true
  return false
}
function programText(data, lim) {
  let b = toBytes(data)
  if (!b) throw new Error('This does not look like a PostScript file.')
  if (b.length > lim.file) throw new Error('This PostScript file is too large to open here.')
  if (b.length >= 12 && b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6) { // DOS EPS: a small header points at the PostScript section
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), off = dv.getUint32(4, true), len = dv.getUint32(8, true)
    if (off >= 12 && off < b.length) b = b.subarray(off, len > 0 && off + len <= b.length ? off + len : b.length)
  }
  const head = latin1(b, 0, Math.min(b.length, 1024))
  if (/^\s*%PDF-/.test(head)) throw new Error('This file is PDF-based, not PostScript. Open it as a PDF instead.')
  if (!isPostScript(b)) throw new Error('This does not look like a PostScript file (it does not start with "%!").')
  if (b[0] === 0x1b) { const k = head.indexOf('%!'); if (k > 0) b = b.subarray(k) }
  return latin1(b, 0, b.length)
}

/** Interpret a PostScript, EPS or legacy AI file. data: Uint8Array, ArrayBuffer or string. Returns {pages: [{w, h, items}], warnings: [string]} in points, y down. */
export async function psToDoc(data, { onProgress, signal, limits } = {}) {
  if (typeof Blob === 'function' && data instanceof Blob) data = await data.arrayBuffer()
  const lim = { ...LIMITS, ...(limits || {}) }
  const it = new Interp(programText(data, lim), { onProgress, signal, limits })
  await it.run()
  onProgress?.(1, 'Done')
  return it.result()
}
