// Model -> EMF (enhanced metafile, GDI records only) and model -> WMF (placeable Windows metafile). Paths, solid fills, strokes with caps, joins and
// dashes, text and pictures. Gradients become their middle colour, opacity is blended with white, clips are written as clip paths (EMF)
// or rectangle clips only (WMF, which has no paths and no curves: curves are flattened).
import { rgbOf, onWhite, imagePixels, apply } from '../corel/_model.js'
import { colorAt } from '../corel/_eps.js'

const U = 100 * 25.4 / 72 // points -> 0.01 mm
const rnd = Math.round
const cref = (c) => { const [r, g, b] = rgbOf(c); return r | (g << 8) | (b << 16) }
const mid = (g, a = 1) => { const stops = [...g.stops].sort((x, y) => x.o - y.o); return onWhite(colorAt(stops, 0.5), a) }
const solid = (it) => (it.fill ? (typeof it.fill === 'object' ? mid(it.fill, it.fillOpacity ?? 1) : onWhite(it.fill, it.fillOpacity ?? 1)) : null)

class Buf {
  constructor() { this.a = []; this.len = 0 }
  push(u8) { this.a.push(u8); this.len += u8.length }
  bytes() { const o = new Uint8Array(this.len); let p = 0; for (const x of this.a) { o.set(x, p); p += x.length } return o }
}
/** Record writer: fields are 'i' (int32), 'u' (uint32), 'f' (float32), 'h' (int16), 'H' (uint16), 'b' bytes. */
function rec(w, parts) {
  let n = 0
  for (const [k, v] of parts) n += k === 'b' ? v.length : k === 'h' || k === 'H' ? 2 : 4
  const pad = (4 - (n % 4)) % 4
  const out = new Uint8Array(n + pad)
  const dv = new DataView(out.buffer)
  let p = 0
  for (const [k, v] of parts) {
    if (k === 'i') { dv.setInt32(p, v, true); p += 4 } else if (k === 'u') { dv.setUint32(p, v >>> 0, true); p += 4 } else if (k === 'f') { dv.setFloat32(p, v, true); p += 4 } else if (k === 'h') { dv.setInt16(p, v, true); p += 2 } else if (k === 'H') { dv.setUint16(p, v, true); p += 2 } else { out.set(v, p); p += v.length }
  }
  w.push(out)
}

/** Flatten cubic commands into straight segments (tolerance in the unit of the commands). */
export function flattenPath(d, tol = 0.2) {
  const subs = []
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0
  for (const c of d) {
    if (c[0] === 'M') { cur = { pts: [[c[1], c[2]]], closed: false }; subs.push(cur); cx = sx = c[1]; cy = sy = c[2] } else if (c[0] === 'L') { cur ||= (subs.push({ pts: [[cx, cy]], closed: false }), subs[subs.length - 1]); cur.pts.push([c[1], c[2]]); cx = c[1]; cy = c[2] } else if (c[0] === 'C') {
      cur ||= (subs.push({ pts: [[cx, cy]], closed: false }), subs[subs.length - 1])
      const len = Math.hypot(c[1] - cx, c[2] - cy) + Math.hypot(c[3] - c[1], c[4] - c[2]) + Math.hypot(c[5] - c[3], c[6] - c[4])
      const n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / tol) / 1.5)))
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t
        cur.pts.push([u * u * u * cx + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5], u * u * u * cy + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]])
      }
      cx = c[5]; cy = c[6]
    } else if (c[0] === 'Z') { if (cur) cur.closed = true; cx = sx; cy = sy; cur = null }
  }
  return subs.filter((s) => s.pts.length > 1 || s.closed)
}

const dashFor = (it) => (it.dash?.length ? it.dash.map((v) => Math.max(1, rnd(v * U))) : null)

/** Rasterised copy of an image item composited on white: {w, h, bgr (bottom-up, 24 bit rows padded)} */
async function dib24(it) {
  const px = await imagePixels(it, 2048)
  const stride = (px.w * 3 + 3) & ~3
  const out = new Uint8Array(stride * px.h)
  for (let y = 0; y < px.h; y++) {
    const row = (px.h - 1 - y) * stride
    for (let x = 0; x < px.w; x++) {
      const i = (y * px.w + x) * 4, a = px.data[i + 3] / 255
      out[row + x * 3] = px.data[i + 2] * a + 255 * (1 - a); out[row + x * 3 + 1] = px.data[i + 1] * a + 255 * (1 - a); out[row + x * 3 + 2] = px.data[i] * a + 255 * (1 - a)
    }
  }
  return { w: px.w, h: px.h, data: out, alpha: px.data.some((v, i) => i % 4 === 3 && v < 255) }
}
const bih = (w, h, size) => { const o = new Uint8Array(40); const dv = new DataView(o.buffer); dv.setUint32(0, 40, true); dv.setInt32(4, w, true); dv.setInt32(8, h, true); dv.setUint16(12, 1, true); dv.setUint16(14, 24, true); dv.setUint32(20, size, true); return o }
const utf16 = (s, n) => { const o = new Uint8Array(n * 2); for (let i = 0; i < Math.min(s.length, n - 1); i++) { o[i * 2] = s.charCodeAt(i) & 255; o[i * 2 + 1] = s.charCodeAt(i) >> 8 } return o }
const isAxis = (m) => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9

export async function pageToEmf(page, { title = 'Drawing' } = {}) {
  const notes = new Set()
  const body = new Buf()
  let nRec = 0
  const R = (parts) => { rec(body, parts); nRec++ }
  const Wd = Math.max(1, rnd(page.w * U)), Ht = Math.max(1, rnd(page.h * U))
  let handle = 0, maxHandle = 0
  const newH = () => { const h = ++handle; maxHandle = Math.max(maxHandle, h); return h }
  const pt = (x, y) => [rnd(x * U), rnd(y * U)]
  // low level record builders (type, size filled by rec2)
  const rec2 = (type, parts) => { let n = 8; for (const [k, v] of parts) n += k === 'b' ? v.length : k === 'h' || k === 'H' ? 2 : 4; const sz = (n + 3) & ~3; R([['u', type], ['u', sz], ...parts]) }
  const pathOps = (d) => {
    rec2(59, [])
    for (const c of d) {
      if (c[0] === 'M') rec2(27, [['i', rnd(c[1] * U)], ['i', rnd(c[2] * U)]])
      else if (c[0] === 'L') rec2(54, [['i', rnd(c[1] * U)], ['i', rnd(c[2] * U)]])
      else if (c[0] === 'C') rec2(5, [['i', 0], ['i', 0], ['i', 0], ['i', 0], ['u', 3], ...[[1, 2], [3, 4], [5, 6]].flatMap(([a, b]) => [['i', rnd(c[a] * U)], ['i', rnd(c[b] * U)]])])
      else rec2(61, [])
    }
    rec2(60, [])
  }
  const bounds = [['i', 0], ['i', 0], ['i', Wd], ['i', Ht]]
  // header written last (needs counts)
  rec2(18, [['u', 1]]) // transparent background
  const brush = (color) => { const h = newH(); rec2(39, [['u', h], ['u', 0], ['u', cref(color)], ['u', 0]]); rec2(37, [['u', h]]); return h }
  const pen = (it, color) => {
    const h = newH()
    const w = Math.max(1, rnd(it.strokeWidth * U))
    const dash = dashFor(it)
    const cap = [0x200, 0, 0x100][it.cap || 0], join = [0x2000, 0, 0x1000][it.join || 0]
    const style = 0x10000 | cap | join | (dash ? 7 : 0)
    rec2(95, [['u', h], ['u', 0], ['u', 0], ['u', 0], ['u', 0], ['u', style], ['u', w], ['u', 0], ['u', cref(color)], ['u', 0], ['u', dash ? dash.length : 0], ...(dash || []).map((v) => ['u', v])])
    rec2(37, [['u', h]])
    return h
  }
  const del = (h) => { rec2(40, [['u', h]]); handle-- }
  let lastRule = 0
  const clipsFor = (it) => { for (const c of it.clip || []) { pathOps(c.d); rec2(67, [['u', 1]]) } }

  for (const it of page.items) {
    rec2(33, []) // SAVEDC
    clipsFor(it)
    if (it.t === 'path') {
      const f = solid(it), hasStroke = it.stroke && it.strokeWidth > 0
      if (typeof it.fill === 'object' && it.fill) notes.add('Gradients were written as one solid colour.')
      if ((it.fillOpacity ?? 1) < 1 || (it.strokeOpacity ?? 1) < 1) notes.add('Transparency was blended with white.')
      if (!f && !hasStroke) { rec2(34, [['i', -1]]); continue }
      const rule = it.rule === 'evenodd' ? 1 : 2
      if (rule !== lastRule) { rec2(19, [['u', rule]]); lastRule = rule }
      let hb = null, hp = null
      if (f) hb = brush(f); else rec2(37, [['u', 0x80000005]])
      if (hasStroke) hp = pen(it, onWhite(it.stroke, it.strokeOpacity ?? 1)); else rec2(37, [['u', 0x80000008]])
      if (it.join === 0 && it.miter) rec2(58, [['u', Math.max(1, rnd(it.miter))]])
      pathOps(it.d)
      rec2(f && hasStroke ? 63 : f ? 62 : 64, bounds)
      if (hp != null) del(hp)
      if (hb != null) del(hb)
    } else if (it.t === 'text') {
      const m = it.m
      const sc = Math.hypot(m[0], m[1])
      const size = Math.max(1, rnd(it.size * sc * U))
      const ang = rnd((-Math.atan2(m[1], m[0]) * 1800) / Math.PI)
      const h = newH()
      const face = utf16((it.family || 'Arial').split(',')[0].replace(/['"]/g, ''), 32)
      const lf = new Uint8Array(92)
      const dv = new DataView(lf.buffer)
      dv.setInt32(0, -size, true); dv.setInt32(8, ang, true); dv.setInt32(12, ang, true); dv.setInt32(16, it.bold ? 700 : 400, true)
      lf[20] = it.italic ? 1 : 0; lf[23] = 1; lf.set(face, 28)
      rec2(82, [['u', h], ['b', lf]])
      rec2(37, [['u', h]])
      rec2(24, [['u', cref(onWhite(it.fill || '#000000', it.opacity ?? 1))]])
      rec2(22, [['u', 24]]) // TA_BASELINE | TA_LEFT
      const lines = String(it.str).split('\n')
      const lh = it.size * (it.lh || 1.2)
      lines.forEach((ln, i) => {
        if (!ln) return
        const [x, y] = apply(m, 0, i * lh)
        const s16 = utf16(ln, ln.length + 1).subarray(0, ln.length * 2)
        const sp = new Uint8Array((s16.length + 3) & ~3); sp.set(s16)
        rec2(84, [...bounds, ['u', 1], ['f', 0], ['f', 0], ['i', rnd(x * U)], ['i', rnd(y * U)], ['u', ln.length], ['u', 76], ['u', 0], ['i', 0], ['i', 0], ['i', 0], ['i', 0], ['u', 0], ['b', sp]])
      })
      del(h)
    } else if (it.t === 'image') {
      const m = it.m
      const d = await dib24(it)
      if (d.alpha) notes.add('Picture transparency was blended with white.')
      const bits = d.data
      const info = bih(d.w, d.h, bits.length)
      const infoBlock = new Uint8Array((info.length + 3) & ~3); infoBlock.set(info)
      const bitsBlock = new Uint8Array((bits.length + 3) & ~3); bitsBlock.set(bits)
      // StretchDIBits record, offsets are from the record start: fixed part is 80 bytes
      const off = 80
      const parts = (dx, dy, dw, dh) => [...bounds, ['i', dx], ['i', dy], ['i', 0], ['i', 0], ['i', d.w], ['i', d.h], ['u', off], ['u', infoBlock.length], ['u', off + infoBlock.length], ['u', bitsBlock.length], ['u', 0], ['u', 0x00cc0020], ['i', dw], ['i', dh], ['b', infoBlock], ['b', bitsBlock]]
      if (isAxis(m)) {
        const [x0, y0] = pt(m[4], m[5])
        rec2(81, parts(x0, y0, rnd(m[0] * U), rnd(m[3] * U)))
      } else {
        // rotated or skewed: draw the bitmap at its own pixel size under a world transform
        rec2(35, [['f', (m[0] * U) / d.w], ['f', (m[1] * U) / d.w], ['f', (m[2] * U) / d.h], ['f', (m[3] * U) / d.h], ['f', m[4] * U], ['f', m[5] * U]])
        rec2(81, parts(0, 0, d.w, d.h))
      }
    }
    rec2(34, [['i', -1]]) // RESTOREDC
  }
  rec2(14, [['u', 0], ['u', 16], ['u', 20]])
  // header
  const desc = utf16(`${title}\0`, title.length + 2)
  const hdrLen = 88 + ((desc.length + 3) & ~3)
  const header = new Buf()
  const mmW = (Wd / 100), mmH = (Ht / 100)
  const total = hdrLen + body.len
  rec(header, [['u', 1], ['u', hdrLen], ['i', 0], ['i', 0], ['i', Wd - 1], ['i', Ht - 1], ['i', 0], ['i', 0], ['i', Wd], ['i', Ht], ['u', 0x464d4520], ['u', 0x10000], ['u', total], ['u', nRec + 1], ['H', maxHandle + 1], ['H', 0], ['u', desc.length / 2], ['u', 88], ['u', 0], ['i', Wd], ['i', Ht], ['i', rnd(mmW)], ['i', rnd(mmH)], ['b', desc]])
  const out = new Uint8Array(total)
  out.set(header.bytes(), 0); out.set(body.bytes(), hdrLen)
  return { blob: new Blob([out], { type: 'image/emf' }), notes: [...notes] }
}

export async function toEmf(doc, { pageIndex = 0, title } = {}) { return pageToEmf(doc.pages[pageIndex], { title }) }

// ---------------- WMF ----------------
const CP1252 = (s) => { const o = []; for (const ch of s) { const c = ch.codePointAt(0); o.push(c < 256 ? c : c === 0x2013 || c === 0x2014 ? 45 : c === 0x2018 || c === 0x2019 ? 39 : c === 0x201c || c === 0x201d ? 34 : 63) } return Uint8Array.from(o) }

export async function pageToWmf(page, { title = 'Drawing' } = {}) {
  const notes = new Set()
  const maxDim = Math.max(page.w, page.h) / 72
  const inch = Math.max(100, Math.min(1440, Math.floor(30000 / Math.max(maxDim, 0.01))))
  const S = inch / 72
  const clamp = (v) => Math.max(-32768, Math.min(32767, rnd(v)))
  const body = new Buf()
  let nRec = 0, maxRec = 0
  const W = (fn, words) => { // words: array of [kind, value] with 'h' int16, 'H' uint16, 'u' uint32, 'b' bytes
    let n = 6
    for (const [k, v] of words) n += k === 'b' ? v.length : k === 'u' ? 4 : 2
    const sz = (n + 1) & ~1
    const out = new Uint8Array(sz)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, sz / 2, true); dv.setUint16(4, fn, true)
    let p = 6
    for (const [k, v] of words) { if (k === 'h') { dv.setInt16(p, v, true); p += 2 } else if (k === 'H') { dv.setUint16(p, v, true); p += 2 } else if (k === 'u') { dv.setUint32(p, v >>> 0, true); p += 4 } else { out.set(v, p); p += v.length } }
    body.push(out); nRec++; maxRec = Math.max(maxRec, sz / 2)
  }
  const Wd = clamp(page.w * S), Ht = clamp(page.h * S)
  W(0x020c, [['h', Ht], ['h', Wd]]) // window extent (y, x)
  W(0x020b, [['h', 0], ['h', 0]])
  W(0x0102, [['H', 1]]) // transparent
  let slots = 0
  const create = (fn, words) => { W(fn, words); const idx = slots; slots++; W(0x012d, [['H', idx]]); return idx }
  const delObj = (idx) => { W(0x01f0, [['H', idx]]); slots = idx }
  let lastRule = -1
  for (const it of page.items) {
    if (it.t === 'path') {
      const f = solid(it), hasStroke = it.stroke && it.strokeWidth > 0
      if (!f && !hasStroke) continue
      if (it.fill && typeof it.fill === 'object') notes.add('Gradients were written as one solid colour.')
      if ((it.fillOpacity ?? 1) < 1 || (it.strokeOpacity ?? 1) < 1) notes.add('Transparency was blended with white.')
      if (it.clip?.length) notes.add('Clipping is not supported by WMF and was dropped.')
      if (it.d.some((c) => c[0] === 'C')) notes.add('Curves were flattened into straight segments (WMF has no curves).')
      const rule = it.rule === 'evenodd' ? 1 : 2
      if (rule !== lastRule) { W(0x0106, [['H', rule]]); lastRule = rule }
      if (it.dash?.length) notes.add('Dashed lines were written solid.')
      const subs = flattenPath(it.d, 0.2).map((s) => ({ closed: s.closed || (f && s.pts.length > 2), pts: s.pts.map(([x, y]) => [clamp(x * S), clamp(y * S)]) }))
      const bIdx = f ? create(0x02fc, [['H', 0], ['u', cref(f)], ['H', 0]]) : create(0x02fc, [['H', 1], ['u', 0], ['H', 0]])
      const penW = it.strokeWidth * S
      const pIdx = hasStroke ? create(0x02fa, [['H', 0], ['h', Math.max(1, clamp(penW))], ['h', 0], ['u', cref(onWhite(it.stroke, it.strokeOpacity ?? 1))]]) : create(0x02fa, [['H', 5], ['h', 0], ['h', 0], ['u', 0]])
      const closedSubs = subs.filter((s) => s.closed)
      const openSubs = subs.filter((s) => !s.closed)
      if (closedSubs.length) {
        const flat = closedSubs.flatMap((s) => s.pts).flat()
        const mapped = closedSubs.map((s) => s.pts.length)
        if (mapped.every((n) => n < 30000) && flat.length / 2 < 32000) W(0x0538, [['H', mapped.length], ...mapped.map((n) => ['H', n]), ...flat.map((v) => ['h', v])])
      }
      for (const s of openSubs) {
        if (f && s.pts.length > 2) { /* open fills are closed above */ }
        if (hasStroke && s.pts.length <= 32000) W(0x0325, [['H', s.pts.length], ...s.pts.flat().map((v) => ['h', v])])
      }
      delObj(pIdx); delObj(bIdx)
    } else if (it.t === 'text') {
      const m = it.m, sc = Math.hypot(m[0], m[1])
      const h = Math.max(1, clamp(it.size * sc * S))
      const ang = rnd((-Math.atan2(m[1], m[0]) * 1800) / Math.PI)
      const lf = new Uint8Array(50)
      const dv = new DataView(lf.buffer)
      dv.setInt16(0, -h, true); dv.setInt16(4, ang, true); dv.setInt16(6, ang, true); dv.setInt16(8, it.bold ? 700 : 400, true)
      lf[10] = it.italic ? 1 : 0; lf[13] = 1
      const fam = CP1252((it.family || 'Arial').split(',')[0].replace(/['"]/g, '')).subarray(0, 31)
      lf.set(fam, 18)
      const fIdx = create(0x02fb, [['b', lf]])
      W(0x0209, [['u', cref(onWhite(it.fill || '#000000', it.opacity ?? 1))]])
      W(0x012e, [['H', 24]])
      const lh = it.size * (it.lh || 1.2)
      String(it.str).split('\n').forEach((ln, i) => {
        if (!ln) return
        const [x, y] = apply(m, 0, i * lh)
        const bytes = CP1252(ln)
        const padded = new Uint8Array((bytes.length + 1) & ~1); padded.set(bytes)
        W(0x0521, [['H', bytes.length], ['b', padded], ['h', clamp(y * S)], ['h', clamp(x * S)]])
      })
      delObj(fIdx)
    } else if (it.t === 'image') {
      const m = it.m
      if (!isAxis(m)) { notes.add('Rotated pictures were skipped (WMF pictures are axis-aligned).'); continue }
      const d = await dib24(it)
      const info = bih(d.w, d.h, d.data.length)
      const x = clamp(m[4] * S), y = clamp(m[5] * S), w = clamp(m[0] * S), hh = clamp(m[3] * S)
      W(0x0f43, [['u', 0x00cc0020], ['H', 0], ['h', d.h], ['h', d.w], ['h', 0], ['h', 0], ['h', hh], ['h', w], ['h', y], ['h', x], ['b', info], ['b', d.data]])
    }
  }
  W(0x0000, [])
  const sizeWords = (18 + body.len) / 2
  const hdr = new Uint8Array(22 + 18)
  const dv = new DataView(hdr.buffer)
  dv.setUint32(0, 0x9ac6cdd7, true); dv.setInt16(6, 0, true); dv.setInt16(8, 0, true); dv.setInt16(10, Wd, true); dv.setInt16(12, Ht, true); dv.setUint16(14, inch, true)
  let cs = 0
  for (let i = 0; i < 20; i += 2) cs ^= dv.getUint16(i, true)
  dv.setUint16(20, cs, true)
  dv.setUint16(22, 1, true); dv.setUint16(24, 9, true); dv.setUint16(26, 0x300, true); dv.setUint32(28, sizeWords, true); dv.setUint16(32, 16, true); dv.setUint32(34, maxRec, true); dv.setUint16(38, 0, true)
  void title; void nRec
  const out = new Uint8Array(hdr.length + body.len)
  out.set(hdr, 0); out.set(body.bytes(), hdr.length)
  return { blob: new Blob([out], { type: 'image/wmf' }), notes: [...notes] }
}
export async function toWmf(doc, { pageIndex = 0, title } = {}) { return pageToWmf(doc.pages[pageIndex], { title }) }
