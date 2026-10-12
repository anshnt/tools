// PDF -> model, page by page, by replaying the pdf.js operator list: paths (fill, stroke, even-odd, dashes, caps, joins), clips,
// colours (any colour space arrives as RGB), opacity, axial and radial gradients, images, and text.
// Text keeps the embedded font programs: Doc.fonts holds each font file the pages use, and a text item carries `font` (a key into
// Doc.fonts) plus `glyphs` ([{c, x}], the glyph characters of that font with exact x offsets in text units) so it draws exactly
// until it is edited. `str` is the Unicode text. Glyph runs on one baseline are merged into one item per line or word.
// Images: original JPEG bytes pass through untouched when that is safe, soft masks arrive as PNG with alpha, stencil masks take
// the fill colour. Best effort: tiling patterns, graphics-state soft masks and exotic blend modes are noted and skipped.
import { pdfjs, pdfjsDocOptions, pdfLib } from '../../lib/libs.js'
import { I, mul, translate, meanScale, pathBBox, rectPath, mapPath, apply, invert } from './_model.js'

const FLIP = [1, 0, 0, -1, 0, 0]
const UNIT_FLIP = [1, 0, 0, -1, 0, 1]
const sameClips = (a, b) => a === b || (a.length === b.length && a.every((c, i) => c === b[i] || (c.rule === b[i].rule && JSON.stringify(c.d) === JSON.stringify(b[i].d))))
const clone = (s) => ({ ...s, clips: [...s.clips] })
const abort = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
const r3 = (v) => Math.round(v * 1000) / 1000

// ---------- opening (a local copy of lib/pdf.js openPdf that also asks pdf.js for the converted font programs) ----------
const toBytes = async (data) => (data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data.slice ? data.slice(0) : data))
const passwordError = (password) => Object.assign(new Error(password ? 'Wrong password for this PDF.' : 'This PDF is password-protected. Enter its password (or unlock it first with Remove PDF password).'), { code: 'PASSWORD' })
async function openWithFonts(lib, bytes, password) {
  const task = lib.getDocument({ data: bytes, password, fontExtraProperties: true, ...pdfjsDocOptions() })
  try {
    return await task.promise
  } catch (e) {
    try { await task.destroy() } catch { /* a failed open still holds its worker until destroyed */ }
    if (e?.name === 'PasswordException') throw passwordError(password)
    throw Object.assign(new Error('Could not open this PDF. It may be damaged or not a PDF.'), { cause: e })
  }
}

// ---------- fonts ----------
const FONT_MAGIC = ['\0\x01\0\0', 'OTTO', 'true']
const usableFont = (d) => d && d.length > 64 && FONT_MAGIC.includes(String.fromCharCode(d[0], d[1], d[2], d[3]))
const BOLD = /bold|black|heavy|semibold|demibold/i, ITALIC = /italic|oblique/i
const genericOf = (f, name) => (/mono|courier|consolas|menlo/i.test(name) || f.isMonospace ? 'monospace' : /times|serif|georgia|garamond|palatino|cambria|book/i.test(name) && !/sans/i.test(name) ? 'serif' : f.fallbackName || 'sans-serif')
const familyOf = (name) => name.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0].replace(/([a-z])([A-Z])/g, '$1 $2').trim() || 'Font'

// ---------- JPEG pass-through ----------
/** {w, h, n, orient} of a baseline or progressive 8-bit JPEG, or null. */
function jpegInfo(b) {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2, orient = 1, info = null
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const mk = b[i + 1]
    if (mk === 0xff) { i++; continue }
    if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (mk === 0xda) break
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
      if (b[i + 4] !== 8) return null
      info = { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], n: b[i + 9] }
    } else if (mk === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) { // Exif: browsers would rotate by the tag, PDF viewers do not
      const t = i + 10, le = b[t] === 0x49
      const u16 = (o) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1])
      const u32 = (o) => (le ? (u16(o) | (u16(o + 2) << 16)) >>> 0 : ((u16(o) << 16) | u16(o + 2)) >>> 0)
      const n = u16(u32(4))
      for (let k = 0; k < n && k < 64; k++) { const e = u32(4) + 2 + k * 12; if (e + 12 > len) break; if (u16(e) === 0x0112) orient = u16(e + 8) }
    }
    i += 2 + len
  }
  return info && (info.n === 1 || info.n === 3) ? { ...info, orient } : null
}

/** Is the file likely to contain a DCT image stream at all? (cheap scan, lets us skip loading pdf-lib) */
function mentionsDct(b) {
  const pat = 'DCTDecode'
  for (let i = b.indexOf(0x44); i >= 0; i = b.indexOf(0x44, i + 1)) {
    let k = 1
    while (k < 9 && b[i + k] === pat.charCodeAt(k)) k++
    if (k === 9) return true
  }
  return false
}

// ---------- decoded images -> blob ----------
const makeCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }))
const canvasBlob = (c, type, q) => (c.convertToBlob ? c.convertToBlob({ type, quality: q }) : new Promise((res) => c.toBlob(res, type, q)))
const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob) })

/** RGBA pixels of a pdf.js image object (RGBA, RGB or 1 bit grey data), or null. mask: paint with the colour [r,g,b] where the bit is 0. */
function rgbaOf(obj, mask) {
  const w = obj.width, h = obj.height, n = w * h, d = obj.data
  if (!d) return null
  const out = new Uint8ClampedArray(n * 4)
  if (mask) {
    const rowBytes = (w + 7) >> 3
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; out[o] = mask[0]; out[o + 1] = mask[1]; out[o + 2] = mask[2]; out[o + 3] = d[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 0 : 255 }
    return out
  }
  const kind = obj.kind ?? (d.length === n * 4 ? 3 : d.length === n * 3 ? 2 : 1)
  if (kind === 3) out.set(d.subarray(0, n * 4))
  else if (kind === 2) for (let i = 0, j = 0; i < n; i++, j += 3) { out[i * 4] = d[j]; out[i * 4 + 1] = d[j + 1]; out[i * 4 + 2] = d[j + 2]; out[i * 4 + 3] = 255 }
  else { const rowBytes = (w + 7) >> 3; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = d[y * rowBytes + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0; const o = (y * w + x) * 4; out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255 } }
  return out
}

/** Encode a pdf.js image object: opaque photographs as JPEG 0.92, everything with alpha (or flat graphics) as PNG. -> {blob, w, h} | null */
async function encodeImage(obj, mask, maxSide = 4096) {
  const w = obj.width, h = obj.height
  if (!(w > 0 && h > 0)) return null
  const k = Math.min(1, maxSide / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k))
  const c = makeCanvas(cw, ch)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (obj.bitmap && !mask) ctx.drawImage(obj.bitmap, 0, 0, cw, ch)
  else {
    const rgba = rgbaOf(obj, mask)
    if (!rgba) return null
    if (k === 1) ctx.putImageData(new ImageData(rgba, w, h), 0, 0)
    else { const tmp = makeCanvas(w, h); tmp.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0); ctx.drawImage(tmp, 0, 0, cw, ch) }
  }
  let alpha = !!mask, flat = false
  if (!mask) {
    const px = ctx.getImageData(0, 0, cw, ch).data
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { alpha = true; break }
    if (!alpha) { const seen = new Set(), step = Math.max(1, Math.floor((cw * ch) / 4096)) * 4; for (let i = 0; i < px.length && seen.size < 64; i += step) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]); flat = seen.size < 64 && cw * ch < 4e6 }
  }
  const jpeg = !alpha && !flat && cw * ch >= 40000
  const blob = await canvasBlob(c, jpeg ? 'image/jpeg' : 'image/png', 0.92)
  return blob ? { blob, w: cw, h: ch } : null
}

const wait = (fn, ms = 4000) => new Promise((res) => { let done = false; const t = setTimeout(() => { if (!done) { done = true; res(null) } }, ms); try { fn((v) => { if (!done) { done = true; clearTimeout(t); res(v) } }) } catch { res(null) } })

/**
 * Convert PDF data (File, Blob or bytes). opts: {password, pages: [1-based], onProgress(fraction, text), signal, images: 'blob' | 'data' (default data)}
 * Returns {pages: [{w, h, name, items}], warnings, numPages, fonts: {key: {name, family, bold, italic, data}}}.
 * images 'blob': Image.href values are blob: object URLs the caller owns (revoke them). Otherwise data: URLs.
 */
export async function pdfToDoc(data, { password, pages, onProgress, signal, images } = {}) {
  const lib = await pdfjs()
  const OPS = lib.OPS
  const bytes = await toBytes(data)
  const dct = mentionsDct(bytes)
  const doc = await openWithFonts(lib, dct ? bytes.slice() : bytes, password)
  const made = []
  try {
    return await convert(lib, OPS, doc, bytes, dct, { password, pages, onProgress, signal, blob: images === 'blob', made })
  } catch (e) {
    for (const u of made) URL.revokeObjectURL(u) // the caller never gets them
    throw e
  } finally {
    try { await (doc.loadingTask ? doc.loadingTask.destroy() : doc.destroy?.()) } catch (e) { console.warn(e) } // frees the worker and the copy of the file
  }
}

async function convert(lib, OPS, doc, bytes, dct, { password, pages, onProgress, signal, blob, made }) {
  const list = pages || Array.from({ length: doc.numPages }, (_, i) => i + 1)
  const warnings = new Set()
  const out = []
  const fontsOut = {}, fontKey = new Map()
  const check = () => { if (signal?.aborted) throw abort() }
  const hrefOf = async (b) => (blob ? (made.push(URL.createObjectURL(b)), made[made.length - 1]) : blobToDataUrl(b))

  // pdf-lib, loaded once and only when a JPEG stream may exist, to read original image streams by their reference
  let pdfl
  const jpegBytes = async (obj) => {
    const m = /^(\d+)R(\d*)$/.exec(String(obj.ref || ''))
    if (!dct || !m) return null
    try {
      if (pdfl === undefined) {
        const L = await pdfLib()
        pdfl = { L, pdf: await L.PDFDocument.load(bytes, { password: password ?? '', updateMetadata: false, throwOnInvalidObject: false }) }
      }
      if (!pdfl) return null
      const { L, pdf } = pdfl
      const s = pdf.context.lookup(L.PDFRef.of(+m[1], +(m[2] || 0)))
      const d = s?.dict, raw = s?.contents
      if (!d || !raw) return null
      const nm = (k) => d.lookup(L.PDFName.of(k))
      const filter = nm('Filter'), only = filter instanceof L.PDFArray ? (filter.size() === 1 ? filter.lookup(0) : null) : filter
      if (String(only) !== '/DCTDecode' || !/^\/Device(RGB|Gray)$/.test(String(nm('ColorSpace')))) return null
      if (d.has(L.PDFName.of('SMask')) || d.has(L.PDFName.of('Mask')) || d.has(L.PDFName.of('Decode')) || d.has(L.PDFName.of('ImageMask'))) return null
      const info = jpegInfo(raw)
      if (!info || info.orient !== 1 || info.w !== obj.width || info.h !== obj.height) return null
      return { bytes: raw, w: info.w, h: info.h }
    } catch {
      pdfl = pdfl || false
      return null
    }
  }

  for (let pi = 0; pi < list.length; pi++) {
    check()
    const page = await doc.getPage(list[pi])
    const vp = page.getViewport({ scale: 1 })
    const V = vp.transform
    const W = vp.width, H = vp.height
    const ol = await page.getOperatorList()
    check()
    const fonts = new Map()
    for (let i = 0; i < ol.fnArray.length; i++) {
      if (ol.fnArray[i] === OPS.setFont) {
        const id = ol.argsArray[i][0]
        if (!fonts.has(id)) fonts.set(id, await wait((cb) => page.commonObjs.get(id, cb)))
      }
    }
    const items = []
    const pending = []
    const imgCache = new Map()
    let st = { ctm: I, fill: '#000000', stroke: '#000000', fillA: 1, strokeA: 1, lw: 1, cap: 0, join: 0, miter: 10, dash: [], dashPhase: 0, clips: [], fillGrad: null,
      fontId: null, fs: 12, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, render: 0, tm: I, tlm: I }
    const stack = []
    const formStack = []
    let pendingClip = null
    let run = null
    const note = (s) => warnings.add(s)
    const M = () => mul(V, st.ctm)
    const pathFrom = (data) => {
      const d = []
      let cx = 0, cy = 0, sx = 0, sy = 0
      const m = M()
      const P = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
      for (let i = 0; i < data.length;) {
        const op = data[i++]
        if (op === 0) { const q = P(data[i], data[i + 1]); i += 2; d.push(['M', q[0], q[1]]); cx = q[0]; cy = q[1]; sx = cx; sy = cy }
        else if (op === 1) { const q = P(data[i], data[i + 1]); i += 2; d.push(['L', q[0], q[1]]); cx = q[0]; cy = q[1] }
        else if (op === 2) { const a = P(data[i], data[i + 1]), b = P(data[i + 2], data[i + 3]), c = P(data[i + 4], data[i + 5]); i += 6; d.push(['C', a[0], a[1], b[0], b[1], c[0], c[1]]); cx = c[0]; cy = c[1] }
        else if (op === 3) { const q = P(data[i], data[i + 1]), e = P(data[i + 2], data[i + 3]); i += 4; d.push(['C', cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy), e[0] + (2 / 3) * (q[0] - e[0]), e[1] + (2 / 3) * (q[1] - e[1]), e[0], e[1]]); cx = e[0]; cy = e[1] }
        else if (op === 4) { d.push(['Z']); cx = sx; cy = sy }
        else break
      }
      return d
    }
    const covers = (d) => { const b = pathBBox(d); return b && b.x <= 0.5 && b.y <= 0.5 && b.x + b.w >= W - 0.5 && b.y + b.h >= H - 0.5 && d.length <= 6 }
    const addClip = (d, rule) => { if (d.length && !covers(d)) st.clips = [...st.clips, { d, rule }] }
    const withClip = (it, clips = st.clips) => (clips.length ? { ...it, clip: clips } : it)
    const strokeScale = () => meanScale(M())

    // ---------- text ----------
    const fontRecord = (id, f) => {
      if (fontKey.has(id)) return fontKey.get(id)
      const key = `f${fontKey.size + 1}`
      const name = String(f.name || 'Font').slice(0, 120)
      const d = !f.missingFile && !f.isType3Font && usableFont(f.data) ? new Uint8Array(f.data) : null
      fontsOut[key] = { name, family: familyOf(name), bold: !!f.bold || BOLD.test(name), italic: !!f.italic || ITALIC.test(name), data: d }
      fontKey.set(id, key)
      return key
    }
    const flush = () => {
      const r = run
      run = null
      if (!r || !r.str.trim()) return
      const it = { t: 'text', str: r.str.trimEnd(), family: r.family, fontName: r.name, size: r.size, bold: r.bold, italic: r.italic, fill: r.fill, opacity: r.opacity, m: r.m, font: r.key }
      if (r.glyphs.length && fontsOut[r.key].data) it.glyphs = r.glyphs
      items.push(withClip(it, r.clips))
    }
    const showText = (glyphs) => {
      const f = st.fontId && fonts.get(st.fontId)
      if (!f) return
      const fm0 = f.fontMatrix?.[0] || 0.001
      let adv = 0, str = ''
      const gl = []
      for (const g of glyphs) {
        if (typeof g === 'number') { adv += (-g / 1000) * st.fs; continue }
        const fc = g.fontChar ? String.fromCodePoint(g.fontChar.codePointAt(0)) : ''
        if (fc && g.isInFont !== false) gl.push({ c: fc, x: adv })
        str += g.unicode || g.fontChar || ''
        adv += (g.width || 0) * fm0 * st.fs + st.tc + (g.isSpace ? st.tw : 0)
      }
      const th = st.th
      const visible = st.render !== 3 && st.render !== 7 && !(st.render === 0 && st.fill === null) && (str.trim() || run) // a lone space is a word gap: it joins the run (a run of only spaces is dropped by flush)
      if (visible) {
        const base = mul(V, mul(st.ctm, mul(st.tm, translate(0, st.rise))))
        const m = mul(mul(base, [th, 0, 0, 1, 0, 0]), FLIP)
        const name = String(f.name || '')
        const key = fontRecord(st.fontId, f)
        const stroked = st.render === 1 || st.render === 5
        const fill = (stroked ? st.stroke : st.fill) || '#000000'
        if (stroked) note('Outlined (stroke only) text was drawn filled.')
        if (st.render >= 4) note('Text used as a clipping shape was drawn as ordinary text.')
        let ox = 0, join = false
        if (run && run.key === key && run.size === st.fs && run.fill === fill && run.opacity === st.fillA && sameClips(run.clips, st.clips)) {
          const rm = run.m
          const same = [0, 1, 2, 3].every((i) => Math.abs(rm[i] - m[i]) <= 1e-4 * Math.max(1, Math.abs(rm[i])))
          const inv = same && invert(rm)
          if (inv) {
            const [lx, ly] = apply(inv, m[4], m[5])
            const gap = lx - run.end, sz = Math.abs(st.fs)
            if (Math.abs(ly) <= 0.03 * sz && gap >= -0.2 * sz && gap <= 1.2 * sz) { join = true; ox = lx; if (gap >= 0.18 * sz && !/\s$/.test(run.str) && !/^\s/.test(str)) run.str += ' ' }
          }
        }
        if (!join) {
          flush()
          const generic = genericOf(f, name)
          run = { key, name, family: generic, size: st.fs, bold: fontsOut[key].bold, italic: fontsOut[key].italic, fill, opacity: st.fillA, m, clips: st.clips, str: '', glyphs: [], end: 0 }
        }
        run.str += str
        for (const g of gl) run.glyphs.push({ c: g.c, x: r3(ox + g.x) })
        run.end = ox + adv
      } else if (run) flush()
      st.tm = mul(st.tm, translate(adv * th, 0))
    }

    // ---------- paths and shadings ----------
    const paintPath = (d, opn) => {
      const doFill = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(opn)
      const doStroke = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(opn)
      const closes = [OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(opn)
      const even = [OPS.eoFill, OPS.eoFillStroke, OPS.closeEOFillStroke].includes(opn)
      if (closes && d.length && d[d.length - 1][0] !== 'Z') d = [...d, ['Z']]
      const k = strokeScale()
      const fill = doFill ? st.fillGrad || st.fill : null
      const stroke = doStroke ? st.stroke : null
      if (!fill && !stroke) return
      items.push(withClip({ t: 'path', d, fill, fillOpacity: st.fillA, rule: even ? 'evenodd' : 'nonzero', stroke, strokeWidth: stroke ? Math.max(st.lw, 0) * k : 0, strokeOpacity: st.strokeA,
        cap: st.cap, join: st.join, miter: st.miter, dash: stroke && st.dash.length ? st.dash.map((v) => v * k) : null, dashOffset: st.dashPhase * k }))
    }
    const gradientOf = (pat, m) => {
      if (!Array.isArray(pat) || pat[0] !== 'RadialAxial') return null
      const stops = (pat[3] || []).map(([o, c]) => ({ o, c, a: 1 }))
      if (!stops.length) return null
      if (pat[1] === 'axial') return { g: 'linear', x1: pat[4][0], y1: pat[4][1], x2: pat[5][0], y2: pat[5][1], m, stops, spread: 'pad' }
      const [x0, y0] = pat[4], [x1, y1] = pat[5], r1 = pat[7] || pat[6] || 1
      return { g: 'radial', cx: x1, cy: y1, r: r1, fx: x0, fy: y0, m, stops, spread: 'pad' }
    }

    // ---------- images ----------
    // Each image becomes an item at once; its href is filled in when the (parallel, at most 3 at a time) encode finishes.
    let busy = 0
    const slots = []
    const slot = async () => { if (busy >= 3) await new Promise((r) => slots.push(r)); busy++ }
    const release = () => { busy--; slots.shift()?.() }
    const addImage = (key, loadObj, m, opacity, clips, mask) => {
      const item = withClip({ t: 'image', href: '', w: 1, h: 1, opacity, m }, clips)
      items.push(item)
      const ck = key && `${key}|${mask || ''}`
      if (ck && imgCache.has(ck)) { pending.push(imgCache.get(ck).then((r) => { if (r) Object.assign(item, r); else item.t = 'drop' })); return }
      const job = (async () => {
        await slot()
        try {
          const obj = await loadObj()
          if (!obj) return null
          const jp = !mask && (await jpegBytes(obj))
          const res = jp ? { blob: new Blob([jp.bytes], { type: 'image/jpeg' }), w: jp.w, h: jp.h } : await encodeImage(obj, mask)
          return res ? { href: await hrefOf(res.blob), w: res.w, h: res.h } : null
        } catch (e) { console.warn(e); return null } finally { release() }
      })()
      if (ck) imgCache.set(ck, job)
      pending.push(job.then((r) => { if (r) Object.assign(item, r); else { item.t = 'drop'; note('An image could not be read and was skipped.') } }))
    }
    // pdf.js keeps an image that several pages use in the document wide store (ids starting g_), the rest in the page's own store
    const objOf = (id) => () => wait((cb) => { const o = String(id).startsWith('g_') ? page.commonObjs : page.objs; if (o.has(id)) cb(o.get(id)); else o.get(id, cb) })
    const maskColor = () => { const m = /^#([0-9a-f]{6})$/i.exec(st.fill || ''); const v = m ? parseInt(m[1], 16) : 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255] }

    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i]
      switch (fn) {
        case OPS.save: stack.push(clone(st)); break
        case OPS.restore: if (stack.length) st = stack.pop(); break
        case OPS.transform: st.ctm = mul(st.ctm, a); break
        case OPS.paintFormXObjectBegin:
          flush(); stack.push(clone(st)); formStack.push(stack.length)
          if (a[0]) st.ctm = mul(st.ctm, a[0])
          if (a[1]) addClip(pathFrom([0, a[1][0], a[1][1], 1, a[1][2], a[1][1], 1, a[1][2], a[1][3], 1, a[1][0], a[1][3], 4]), 'nonzero')
          break
        case OPS.paintFormXObjectEnd: flush(); if (formStack.pop() && stack.length) st = stack.pop(); break
        case OPS.setLineWidth: st.lw = a[0]; break
        case OPS.setLineCap: st.cap = a[0]; break
        case OPS.setLineJoin: st.join = a[0]; break
        case OPS.setMiterLimit: st.miter = a[0]; break
        case OPS.setDash: st.dash = (a[0] || []).length % 2 ? [...a[0], ...a[0]] : [...(a[0] || [])]; st.dashPhase = a[1] || 0; if (st.dash.every((v) => !v)) st.dash = []; break
        case OPS.setGState:
          for (const [k, v] of a[0]) {
            if (k === 'LW') st.lw = v; else if (k === 'LC') st.cap = v; else if (k === 'LJ') st.join = v; else if (k === 'ML') st.miter = v
            else if (k === 'D') { st.dash = (v[0] || []).length % 2 ? [...v[0], ...v[0]] : [...(v[0] || [])]; st.dashPhase = v[1] || 0 }
            else if (k === 'CA') st.strokeA = v; else if (k === 'ca') st.fillA = v
            else if (k === 'SMask' && v) note('Soft masks (fades and some shadows) were not carried over.')
            else if (k === 'BM' && v && v !== 'Normal') note('Blend modes were not carried over.')
          }
          break
        case OPS.setFillRGBColor: st.fill = a[0]; st.fillGrad = null; break
        case OPS.setStrokeRGBColor: st.stroke = a[0]; break
        case OPS.setFillTransparent: st.fill = null; st.fillGrad = null; break
        case OPS.setStrokeTransparent: st.stroke = null; break
        case OPS.setFillColorN:
          if (Array.isArray(a) && a[0] === 'RadialAxial') { st.fillGrad = gradientOf(a, V); st.fill = st.fillGrad?.stops?.[0]?.c || '#808080' }
          else if (Array.isArray(a) && a[0] === 'TilingPattern') { st.fill = '#cccccc'; st.fillGrad = null; note('Tiling pattern fills were replaced by a plain light grey.') }
          break
        case OPS.setStrokeColorN:
          if (Array.isArray(a) && a[0] === 'RadialAxial') st.stroke = a[3]?.[0]?.[1] || '#808080'
          else if (Array.isArray(a) && a[0] === 'TilingPattern') { st.stroke = '#808080'; note('Tiling pattern strokes were replaced by grey.') }
          break
        case OPS.shadingFill: {
          flush()
          const pat = await wait((cb) => page.objs.get(a[0], cb))
          const g = gradientOf(pat, M())
          if (g) {
            const clipBox = st.clips.length ? st.clips.map((c) => pathBBox(c.d)).filter(Boolean).reduce((p, b) => (p ? { x: Math.max(p.x, b.x), y: Math.max(p.y, b.y), w: Math.min(p.x + p.w, b.x + b.w) - Math.max(p.x, b.x), h: Math.min(p.y + p.h, b.y + b.h) - Math.max(p.y, b.y) } : b), null) : { x: 0, y: 0, w: W, h: H }
            if (clipBox && clipBox.w > 0 && clipBox.h > 0) items.push(withClip({ t: 'path', d: rectPath(clipBox.x, clipBox.y, clipBox.w, clipBox.h), fill: g, fillOpacity: st.fillA, rule: 'nonzero', stroke: null, strokeWidth: 0 }))
          } else note('A shading fill could not be read and was skipped.')
          break
        }
        case OPS.constructPath: {
          flush()
          const [op, args] = a
          const data = args?.[0]
          const d = data && data.length ? pathFrom(data) : []
          if (op === OPS.endPath) {
            if (pendingClip && d.length) addClip(d, pendingClip)
            pendingClip = null
          } else {
            if (d.length) paintPath(d, op)
            if (pendingClip && d.length) { addClip(d, pendingClip); pendingClip = null }
          }
          break
        }
        case OPS.clip: pendingClip = 'nonzero'; break
        case OPS.eoClip: pendingClip = 'evenodd'; break
        case OPS.paintImageXObject: flush(); addImage(a[0], objOf(a[0]), mul(M(), UNIT_FLIP), st.fillA, st.clips); break
        case OPS.paintInlineImageXObject: flush(); addImage(null, async () => a[0], mul(M(), UNIT_FLIP), st.fillA, st.clips); break
        case OPS.paintImageXObjectRepeat:
          flush()
          for (let k = 0; k + 1 < a[3].length; k += 2) addImage(a[0], objOf(a[0]), mul(M(), mul([a[1], 0, 0, a[2], a[3][k], a[3][k + 1]], UNIT_FLIP)), st.fillA, st.clips)
          break
        case OPS.paintSolidColorImageMask:
          flush()
          items.push(withClip({ t: 'path', d: mapPath(rectPath(0, 0, 1, 1), M()), fill: st.fill, fillOpacity: st.fillA, rule: 'nonzero', stroke: null, strokeWidth: 0 }))
          break
        case OPS.paintImageMaskXObject: { flush(); const c = maskColor(); addImage(null, async () => a[0], mul(M(), UNIT_FLIP), st.fillA, st.clips, c.join(',')); break }
        case OPS.paintImageMaskXObjectGroup:
          flush()
          for (const im of a[0]) { const c = maskColor(); addImage(null, async () => im, mul(mul(M(), im.transform), UNIT_FLIP), st.fillA, st.clips, c.join(',')) }
          break
        case OPS.paintImageMaskXObjectRepeat:
          flush()
          for (let k = 0; k + 1 < a[5].length; k += 2) { const c = maskColor(); addImage(null, async () => a[0], mul(M(), mul([a[1], a[2] || 0, a[3] || 0, a[4], a[5][k], a[5][k + 1]], UNIT_FLIP)), st.fillA, st.clips, c.join(',')) }
          break
        // text
        case OPS.beginText: st.tm = I; st.tlm = I; break
        case OPS.endText: break // a design tool puts every word in its own q, BT, ET block: only painting something else ends a run
        case OPS.setFont: st.fontId = a[0]; st.fs = a[1]; break
        case OPS.setCharSpacing: st.tc = a[0]; break
        case OPS.setWordSpacing: st.tw = a[0]; break
        case OPS.setHScale: st.th = a[0] / 100; break
        case OPS.setLeading: st.tl = a[0]; break
        case OPS.setTextRise: st.rise = a[0]; break
        case OPS.setTextRenderingMode: st.render = a[0]; break
        case OPS.setTextMatrix: st.tm = st.tlm = a.length === 1 ? a[0] : a; break
        case OPS.moveText: st.tlm = mul(st.tlm, translate(a[0], a[1])); st.tm = st.tlm; break
        case OPS.setLeadingMoveText: st.tl = -a[1]; st.tlm = mul(st.tlm, translate(a[0], a[1])); st.tm = st.tlm; break
        case OPS.nextLine: st.tlm = mul(st.tlm, translate(0, -st.tl)); st.tm = st.tlm; break
        case OPS.showText: showText(a[0]); break
        case OPS.showSpacedText: showText(a[0]); break
        case OPS.nextLineShowText: st.tlm = mul(st.tlm, translate(0, -st.tl)); st.tm = st.tlm; showText(a[0]); break
        case OPS.nextLineSetSpacingShowText: st.tw = a[0]; st.tc = a[1]; st.tlm = mul(st.tlm, translate(0, -st.tl)); st.tm = st.tlm; showText(a[2]); break
        default: break
      }
      if (i % 400 === 399) { check(); onProgress?.((pi + i / ol.fnArray.length) / list.length, `Reading page ${list[pi]} of ${doc.numPages}`); await new Promise((r) => setTimeout(r, 0)) }
    }
    flush()
    if (pending.length) { onProgress?.((pi + 0.9) / list.length, `Reading images on page ${list[pi]}`); await Promise.all(pending) }
    check()
    out.push({ w: W, h: H, name: `Page ${list[pi]}`, items: items.filter((it) => it.t !== 'drop') })
    page.cleanup()
    onProgress?.((pi + 1) / list.length, `Read page ${list[pi]}`)
  }
  const fontList = Object.values(fontsOut)
  if (fontList.some((f) => f.data)) warnings.add('Text keeps the letter shapes of the fonts inside the PDF until you edit it. Edited text uses the closest installed font, so use "Convert text to outlines" to keep the exact shapes.')
  if (fontList.some((f) => !f.data)) warnings.add('Some fonts are not embedded in the PDF, so that text uses a similar font and may look a little different.')
  return { pages: out, warnings: [...warnings], numPages: doc.numPages, fonts: fontsOut }
}
