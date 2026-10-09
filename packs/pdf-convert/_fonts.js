// Unicode fonts for building PDFs in the browser: Noto Sans, Noto Serif and Noto Sans Mono (Latin, Latin Extended, Vietnamese, Cyrillic, Greek)
// embedded as real text, plus the Noto Sans scripts for Hindi, Bengali, Gujarati, Punjabi, Tamil, Telugu, Kannada and Malayalam.
// Indic scripts need a shaping engine (reordered vowel signs, conjuncts) that pdf-lib does not have, so those words are drawn by the
// browser's own text shaper onto a canvas and placed in the PDF as sharp images. Fonts come from the @fontsource packages on jsDelivr
// and only the ones a text needs are fetched.
import { script } from '../../lib/libs.js'

const FONTSOURCE = '5.3.0'
const url = (pkg, name) => `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@${FONTSOURCE}/files/${name}.woff`
const FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm'

const bytes = new Map(), sfnts = new Map()
const fetchBytes = (u) => {
  if (!bytes.has(u)) bytes.set(u, fetch(u).then((r) => { if (!r.ok) throw new Error(`Could not load a font (${r.status}). Check your connection and try again.`); return r.arrayBuffer() }).then((b) => new Uint8Array(b)).catch((e) => { bytes.delete(u); throw e }))
  return bytes.get(u)
}
const fetchSfnt = (u) => { if (!sfnts.has(u)) sfnts.set(u, fetchBytes(u).then(woffToSfnt).catch((e) => { sfnts.delete(u); throw e })); return sfnts.get(u) }

/** WOFF 1.0 -> plain sfnt (TTF/OTF) so fontkit can read it. Tables are zlib-compressed in WOFF; the browser inflates them natively. */
export async function woffToSfnt(woff) {
  const dv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)
  if (dv.getUint32(0) !== 0x774f4646) return woff // not a WOFF: already sfnt
  const flavor = dv.getUint32(4), n = dv.getUint16(12)
  const inflate = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
  const tables = []
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20
    const tag = dv.getUint32(o), off = dv.getUint32(o + 4), comp = dv.getUint32(o + 8), orig = dv.getUint32(o + 12), sum = dv.getUint32(o + 16)
    const raw = woff.subarray(off, off + comp)
    tables.push({ tag, sum, data: comp < orig ? await inflate(raw) : raw })
  }
  tables.sort((a, b) => a.tag - b.tag)
  let size = 12 + 16 * n
  const offsets = tables.map((t) => { const o = size; size += (t.data.length + 3) & ~3; return o })
  const out = new Uint8Array(size), ov = new DataView(out.buffer)
  ov.setUint32(0, flavor); ov.setUint16(4, n)
  let pow = 1, log = 0
  while (pow * 2 <= n) { pow *= 2; log++ }
  ov.setUint16(6, pow * 16); ov.setUint16(8, log); ov.setUint16(10, n * 16 - pow * 16)
  tables.forEach((t, i) => {
    const o = 12 + i * 16
    ov.setUint32(o, t.tag); ov.setUint32(o + 4, t.sum); ov.setUint32(o + 8, offsets[i]); ov.setUint32(o + 12, t.data.length)
    out.set(t.data, offsets[i])
  })
  return out
}

let fontkitP
// @pdf-lib/fontkit 1.1.1 was compiled with Babel and expects a global regeneratorRuntime
const REGEN = 'https://cdn.jsdelivr.net/npm/regenerator-runtime@0.14.1/runtime.js'
export const fontkit = () => (fontkitP ||= script(REGEN).then(() => import(FONTKIT)).then((m) => m.default || m).catch((e) => { fontkitP = null; throw Object.assign(new Error('Could not load the font engine. Check your connection.'), { cause: e }) }))

/** Script subsets, in lookup order. ranges are [from, to] code points; complex = needs the browser's text shaper. */
const SUBSETS = [
  { id: 'latin', ranges: [[0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x2c6, 0x2c6], [0x2da, 0x2da], [0x2dc, 0x2dc], [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193], [0x2212, 0x2212], [0x2215, 0x2215]] },
  { id: 'latin-ext', ranges: [[0x100, 0x2af], [0x1d00, 0x1dbf], [0x1e00, 0x1eff], [0x2020, 0x20cf], [0x2c60, 0x2c7f], [0xa720, 0xa7ff]] },
  { id: 'vietnamese', ranges: [[0x102, 0x103], [0x110, 0x111], [0x128, 0x129], [0x168, 0x169], [0x1a0, 0x1a1], [0x1af, 0x1b0], [0x300, 0x301], [0x303, 0x304], [0x308, 0x309], [0x323, 0x323], [0x329, 0x329], [0x1ea0, 0x1ef9], [0x20ab, 0x20ab]] },
  { id: 'cyrillic', ranges: [[0x400, 0x52f], [0x1c80, 0x1c88], [0x2de0, 0x2dff], [0xa640, 0xa69f]] },
  { id: 'greek', ranges: [[0x370, 0x3ff], [0x1f00, 0x1fff]] },
  { id: 'devanagari', complex: true, pkg: 'noto-sans-devanagari', ranges: [[0x900, 0x97f], [0xa8e0, 0xa8ff]] },
  { id: 'bengali', complex: true, pkg: 'noto-sans-bengali', ranges: [[0x980, 0x9ff]] },
  { id: 'gurmukhi', complex: true, pkg: 'noto-sans-gurmukhi', ranges: [[0xa00, 0xa7f]] },
  { id: 'gujarati', complex: true, pkg: 'noto-sans-gujarati', ranges: [[0xa80, 0xaff]] },
  { id: 'tamil', complex: true, pkg: 'noto-sans-tamil', ranges: [[0xb80, 0xbff]] },
  { id: 'telugu', complex: true, pkg: 'noto-sans-telugu', ranges: [[0xc00, 0xc7f]] },
  { id: 'kannada', complex: true, pkg: 'noto-sans-kannada', ranges: [[0xc80, 0xcff]] },
  { id: 'malayalam', complex: true, pkg: 'noto-sans-malayalam', ranges: [[0xd00, 0xd7f]] },
]
export const SCRIPT_NAMES = { latin: 'Latin', 'latin-ext': 'Latin Extended', vietnamese: 'Vietnamese', cyrillic: 'Cyrillic', greek: 'Greek', devanagari: 'Devanagari (Hindi, Marathi)', bengali: 'Bengali', gurmukhi: 'Gurmukhi (Punjabi)', gujarati: 'Gujarati', tamil: 'Tamil', telugu: 'Telugu', kannada: 'Kannada', malayalam: 'Malayalam' }
const inRanges = (s, cp) => s.ranges.some(([a, b]) => cp >= a && cp <= b)
const JOINER = /\p{M}|‌|‍/u

/** Which script subsets does this text need? -> {need: Set(ids), unsupported: Set(chars)} */
export function scan(text) {
  const need = new Set(['latin']), unsupported = new Set()
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp === 0x20 || cp === 0x0a || cp === 0x0d || cp === 0x09 || cp === 0x200c || cp === 0x200d) continue
    const hit = SUBSETS.filter((s) => inRanges(s, cp))
    if (!hit.length) { if (cp >= 0x80 && !/\p{M}/u.test(ch)) unsupported.add(ch); continue }
    for (const s of hit) need.add(s.id)
  }
  return { need, unsupported }
}

const FAMILY_PKG = { sans: 'noto-sans', serif: 'noto-serif', mono: 'noto-sans-mono' }
/** [pkg, file-name] for a subset/weight/italic. */
function fileFor(family, subset, weight, italic) {
  const s = SUBSETS.find((x) => x.id === subset)
  if (s.pkg) return [s.pkg, `${s.pkg}-${subset}-${weight}-normal`]
  if (family === 'mono') return subset === 'latin' ? ['noto-sans-mono', `noto-sans-mono-latin-${weight}-normal`] : fileFor('sans', subset, weight, italic)
  const pkg = FAMILY_PKG[family]
  if (subset === 'latin') return [pkg, `${pkg}-latin-${weight}-${italic ? 'italic' : 'normal'}`]
  if (family === 'serif' && subset !== 'latin-ext') return fileFor('sans', subset, weight, italic)
  return [pkg, `${pkg}-${subset}-${weight}-normal`]
}

const measureCtx = (() => { let c; return () => (c ||= document.createElement('canvas').getContext('2d')) })()

/** A stand-in for a PDF font whose glyphs are shaped and drawn by the browser (Indic scripts). */
function complexFace(css, bold) {
  return {
    complex: true, css, bold,
    widthOfTextAtSize(text, size) {
      const ctx = measureCtx()
      ctx.font = `${bold ? 700 : 400} 100px "${css}"`
      return (ctx.measureText(text).width * size) / 100
    },
    heightAtSize: (size) => size * 1.3,
    getCharacterSet: () => [],
  }
}

/**
 * A set of fonts for one PDF. api.runs(text, style) splits text into runs that each use one face (characters no face can draw become "?").
 * api.width(text, size, style) measures in points. Draw runs with drawRuns().
 */
export async function createFontSet(pdfDoc, { family = 'sans', text = '', styles = [{ bold: false, italic: false }] } = {}) {
  const fk = await fontkit()
  pdfDoc.registerFontkit(fk)
  const { need, unsupported } = scan(text)
  if (need.has('latin-ext')) need.add('vietnamese')
  const faces = new Map() // style key -> [{font, has, order}]
  const keyOf = (b, i) => `${+!!b}${+!!i}`
  const embed = async (subset, bold, italic) => {
    const sub = SUBSETS.find((s) => s.id === subset)
    let f = fileFor(family, subset, bold ? 700 : 400, italic)
    let wbytes
    try { wbytes = await fetchBytes(url(f[0], f[1])) } catch (e) {
      if (!bold && !italic) throw e
      f = fileFor(family, subset, 400, false)
      wbytes = await fetchBytes(url(f[0], f[1]))
    }
    if (sub.complex) {
      const css = `cv-${f[1]}`
      if (![...document.fonts].some((x) => x.family === css)) {
        const face = new FontFace(css, wbytes.slice().buffer, { weight: '400' })
        await face.load()
        document.fonts.add(face)
      }
      return { font: complexFace(css, bold), has: { has: (cp) => inRanges(sub, cp) || cp === 0x200c || cp === 0x200d } }
    }
    // fontkit cannot subset these files, so they are embedded whole (they are small, script-specific files)
    const font = await pdfDoc.embedFont(await fetchSfnt(url(f[0], f[1])), { subset: false, features: { liga: false, clig: false, dlig: false, calt: false } })
    return { font, has: new Set(font.getCharacterSet()) }
  }
  const wanted = new Set(styles.map((s) => keyOf(s.bold, s.italic)))
  wanted.add('00')
  const pending = []
  for (const k of wanted) {
    const bold = k[0] === '1', italic = k[1] === '1'
    const list = []
    faces.set(k, list)
    for (const s of SUBSETS) if (need.has(s.id)) pending.push(embed(s.id, bold, italic).then((f) => list.push({ ...f, order: SUBSETS.indexOf(s) })))
  }
  await Promise.all(pending)
  for (const list of faces.values()) list.sort((a, b) => a.order - b.order)
  const cache = new Map(), widths = new Map(), missing = new Set()
  // letters of an Indic script must use that script's face even though the Latin face has the space and digits
  const preferred = (cp) => SUBSETS.find((s) => s.complex && inRanges(s, cp))
  const api = {
    unsupported, scripts: need, missing,
    fontFor(cp, style = {}) {
      const reg = faces.get('00')
      const list = faces.get(keyOf(style.bold, style.italic)) || reg
      const pref = preferred(cp)
      const order = pref ? SUBSETS.indexOf(pref) : -1
      for (const f of list) if (f.has.has(cp) && (!pref || f.order === order)) return f.font
      for (const f of list) if (f.has.has(cp)) return f.font
      if (list !== reg) for (const f of reg) if (f.has.has(cp)) return f.font
      return null
    },
    runs(str, style = {}) {
      const ck = `${keyOf(style.bold, style.italic)}|${str}`
      if (cache.has(ck)) return cache.get(ck)
      const out = []
      for (const ch of str) {
        const cp = ch.codePointAt(0)
        let font = this.fontFor(cp, style)
        let c = ch
        const last = out[out.length - 1]
        if (!font && JOINER.test(ch) && last) font = last.font
        if (!font) { missing.add(ch); c = '?'; font = this.fontFor(63, style) }
        // zero-width joiners and combining marks stay with the preceding complex run
        if (last && (last.font === font || (last.font.complex && JOINER.test(ch)))) last.text += c
        else out.push({ text: c, font })
      }
      if (cache.size > 20000) cache.clear()
      cache.set(ck, out)
      return out
    },
    width(str, size, style = {}) {
      const wk = `${keyOf(style.bold, style.italic)}|${size}|${str}`
      if (widths.has(wk)) return widths.get(wk)
      let w = 0
      for (const r of this.runs(str, style)) w += r.font.widthOfTextAtSize(r.text, size)
      if (widths.size > 50000) widths.clear()
      widths.set(wk, w)
      return w
    },
  }
  return api
}

/**
 * drawRuns(pdfDoc, page, runs, {x, y, size, color: rgb(), rgbCss, bold}) draws runs left to right from baseline (x, y); returns the end x.
 * Complex-script runs are drawn onto a canvas with the browser's text shaper and embedded as PNG images.
 */
export async function drawRuns(pdfDoc, page, runs, { x, y, size, color, bold = false, rgbCss = '#111118' }) {
  for (const r of runs) {
    if (!r.text) continue
    const w = r.font.widthOfTextAtSize(r.text, size)
    if (r.font.complex) {
      if (r.text.trim()) {
        const k = 4
        const pad = size * 0.25
        const c = document.createElement('canvas')
        c.width = Math.ceil((w + pad * 2) * k)
        c.height = Math.ceil(size * 2.1 * k)
        const g = c.getContext('2d')
        g.font = `${bold ? 700 : 400} ${size * k}px "${r.font.css}"`
        g.fillStyle = rgbCss
        g.textBaseline = 'alphabetic'
        g.fillText(r.text, pad * k, size * 1.5 * k)
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
        const img = await pdfDoc.embedPng(new Uint8Array(await blob.arrayBuffer()))
        page.drawImage(img, { x: x - pad, y: y - size * 0.6, width: c.width / k, height: c.height / k })
        c.width = c.height = 0
      }
    } else {
      try { page.drawText(r.text, { x, y, size, font: r.font, color }) } catch { /* glyph this font cannot encode */ }
    }
    x += w
  }
  return x
}

// ---------------------------------------------------------------- inline @font-face for HTML documents

const cssText = new Map()
const fetchCss = (u) => {
  if (!cssText.has(u)) cssText.set(u, fetch(u).then((r) => { if (!r.ok) throw new Error(`Could not load a font (${r.status}). Check your connection and try again.`); return r.text() }).catch((e) => { cssText.delete(u); throw e }))
  return cssText.get(u)
}
const b64Cache = new Map(), registered = new Set()
const toBase64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }

/**
 * @font-face rules for HTML that is rendered by html2canvas or printed: the font files are embedded as data URLs, so the clone html2canvas makes
 * of the page never waits for a network font and every glyph is measured with the real font. Only the unicode-range blocks the text needs are included.
 * specs: [['noto-sans', '400'], ['noto-sans', '700-italic'], ...]
 */
export async function inlineFontCss(specs, text) {
  const cps = new Set([...text].map((c) => c.codePointAt(0)))
  const rangesOf = (str) => str.split(',').map((p) => p.trim().replace(/^U\+/i, '')).filter(Boolean).map((p) => { const [a, b] = p.split('-'); return [parseInt(a, 16), parseInt(b || a, 16)] })
  const out = []
  for (const [pkg, file] of specs) {
    const base = `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@${FONTSOURCE}/`
    let css
    try { css = await fetchCss(`${base}${file}.css`) } catch { continue }
    for (const block of css.split('@font-face').slice(1)) {
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1] || ''
      const src = /url\((\.\/files\/[^)]+?\.woff)\)/.exec(block)?.[1]
      if (!src) continue
      const isLatin = /latin-\d{3}/.test(src) && !/latin-ext/.test(src)
      const needed = isLatin || rangesOf(range).some(([a, b]) => { for (const cp of cps) if (cp >= a && cp <= b) return true; return false })
      if (!needed) continue
      const u = new URL(src, base).href
      if (!b64Cache.has(u)) b64Cache.set(u, fetchBytes(u).then(toBase64))
      const family = /font-family:\s*'([^']+)'/.exec(block)?.[1] || pkg
      const style = /font-style:\s*(\w+)/.exec(block)?.[1] || 'normal'
      const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] || '400'
      out.push(`@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url(data:font/woff;base64,${await b64Cache.get(u)}) format('woff');unicode-range:${range}}`)
      // html2canvas paints on a canvas that belongs to this page, so the page itself needs the same fonts
      const key = `${family}|${style}|${weight}|${range}`
      if (!registered.has(key)) {
        registered.add(key)
        try {
          const face = new FontFace(family, (await fetchBytes(u)).slice().buffer, { style, weight, unicodeRange: range })
          await face.load()
          document.fonts.add(face)
        } catch { registered.delete(key) }
      }
    }
  }
  return out.join('\n')
}
