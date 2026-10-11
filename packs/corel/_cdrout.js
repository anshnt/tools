// CDR writer: a Doc (flat, or tree with layers and groups) -> a .cdr file. No DOM needed except for decoding images (see decodeImage).
//
//   writeCdr(doc, {title, textToCurves = true, onProgress, signal, compress = false, maxDpi = 300, bitmapAlpha = 'flatten', lean = false, decodeImage}) -> {blob, notes}
//   compress: wrap the drawing in the zlib "cmpr" list (much smaller files with photos). maxDpi: reduce bitmaps above this many pixels per inch of
//   placed size (0 = never). bitmapAlpha: 'flatten' (transparent bitmap areas become white, 24 bit) or 'rgba' (32 bit with an alpha byte, unverified).
//   lean: leave out the records that are only guessed to belong in a file (empty style table, outline boxes, static ids, layer ids, palette ids, long
//   page settings). The result is the smallest structure a reader needs. It exists to find out, on a machine that has the desktop application, which
//   of the two shapes it prefers.
//
// Target: the RIFF layout of CDR version 13 (form type "CDRD"), the newest version that is a plain RIFF file. Newer desktop versions open it,
// and it is the best documented layout. The file is written without the compressed "cmpr" wrapper unless compress is true.
//
// Layout:
//   RIFF "CDRD"
//     vrsn        version number (1300)
//     DISP        preview bitmap
//     LIST doc    mcfg (page size), stlt (style table), LIST fild, LIST outl, LIST font, LIST bmpt (the global tables)
//     LIST page   the master page: flgs, loda, three default layers (desktop, guides, grid)
//     LIST page   one per page: flgs, loda (name, size), LIST layr per layer: flgs, loda (name, guid), then LIST grp / LIST obj
//   A group is LIST grp (flgs, loda, trfd, bbox, children). An object is LIST obj (flgs, loda, trfd, txsm for text, bbox, obbx, usdn).
//
// Coordinates: 1/254000 inch, y up, origin at the centre of the page (each page has its own). Colours are RGB (colour model 5).
// Every object is written with an identity transform except bitmaps and text, whose frame carries their placement.
//
// What is approximated (each case adds a plain English line to `notes`): hidden, locked and non-printable layers (their flags are not
// publicly documented), guides, fill rule (even-odd), gradient transparency, repeat and reflect gradients, off-centre radial gradients,
// one transparency value per object, dash lengths (stored in line widths), clipping (see the clipping section), bitmap transparency (flattened on white).
// Not written at all: guides, per-object lock and hide flags, the document title, text outside a single line and left alignment.
//
// decodeImage(bytes, mime, plan) -> {w, h, data: RGBA} is the hook for image decoding. The default uses createImageBitmap and a canvas, so the
// module works in a browser. plan(naturalW, naturalH) returns {sx, sy, sw, sh, w, h}: the source rectangle and the size the result should have.
// A decoder may ignore the plan and return the full image: it is then cropped and scaled here.
import { mapPath, pathBBox, mul, apply, invert, meanScale, rgbOf, parseColor, itemBBox, dataUrlBytes } from './_model.js'

const VERSION = 1300
const INCH = 254000
const K = INCH / 72 // file units per point
const MAXI = 2147483647
const MAX_DEPTH = 28 // the reader (and most tools) stop descending below 40 nested lists
const IDENT = [1, 0, 0, 1, 0, 0]
const COMPAT_NOTE = 'Compatibility with the desktop application cannot be verified on this machine. The file follows the CDR version 13 layout from public format notes and was only checked by reading it back with this site\'s own CDR reader. If the desktop application refuses it, save PDF or SVG instead.'

// ---------- bytes ----------
class W {
  constructor(n = 128) { this.b = new Uint8Array(n); this.v = new DataView(this.b.buffer); this.n = 0 }
  need(k) {
    if (this.n + k <= this.b.length) return
    const nb = new Uint8Array(Math.max(this.b.length * 2, this.n + k))
    nb.set(this.b); this.b = nb; this.v = new DataView(nb.buffer)
  }
  u8(x) { this.need(1); this.b[this.n++] = x; return this }
  u16(x) { this.need(2); this.v.setUint16(this.n, x, true); this.n += 2; return this }
  u32(x) { this.need(4); this.v.setUint32(this.n, x >>> 0, true); this.n += 4; return this }
  i32(x) { this.need(4); this.v.setInt32(this.n, x, true); this.n += 4; return this }
  f64(x) { this.need(8); this.v.setFloat64(this.n, x, true); this.n += 8; return this }
  z(k) { this.need(k); this.n += k; return this }
  put(u8) { this.need(u8.length); this.b.set(u8, this.n); this.n += u8.length; return this }
  get out() { return this.b.subarray(0, this.n) }
}
const asc = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b }
/** UTF-16LE with a terminating zero, the string layout of this version. */
const u16z = (s) => { const w = new W(s.length * 2 + 2); for (let i = 0; i < s.length; i++) w.u16(s.charCodeAt(i)); return w.u16(0).out }
const clampI = (v) => Math.max(-MAXI, Math.min(MAXI, Math.round(v)))
const coord = (w, inches) => w.i32(clampI(inches * INCH))
const color12 = (w, hex) => { const [r, g, b] = rgbOf(hex); w.u16(5).u16(5).z(4).u8(b).u8(g).u8(r).u8(0) } // model bgr, palette user, 4 unknown, b g r 0

// ---------- chunk tree (serialised plain, or inside a "cmpr" wrapper) ----------
const leaf = (id, body) => ({ id, body })
const list = (form, kids) => ({ id: 'LIST', form, kids })
const rawList = (form, body) => ({ id: 'LIST', form, body }) // a list whose body is not a chunk sequence (the style table)
/** Sets node.n (body length, without header and pad) and returns the size on disk. */
function measure(n) {
  if (n.kids) { let s = 4; for (const k of n.kids) s += measure(k); n.n = s } else n.n = n.body.length + (n.form ? 4 : 0)
  return 8 + n.n + (n.n & 1)
}
const PAD = new Uint8Array(1)
const header = (id, len) => { const h = new Uint8Array(8); h.set(asc(id)); new DataView(h.buffer).setUint32(4, len, true); return h }
function emit(n, parts) {
  parts.push(header(n.id, n.n))
  if (n.kids) { parts.push(asc(n.form)); for (const k of n.kids) emit(k, parts) } else { if (n.form) parts.push(asc(n.form)); parts.push(n.body); if (n.n & 1) parts.push(PAD) }
}
const concat = (parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); n = 0; for (const p of parts) { o.set(p, n); n += p.length } return o }

async function deflate(u8) {
  const cs = new CompressionStream('deflate')
  const w = cs.writable.getWriter()
  w.write(u8).catch(() => {}); w.close().catch(() => {})
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}
/** The "cmpr" wrapper: one zlib stream of the chunks (each header carries an index instead of a length) and one zlib stream with the pool of lengths. */
async function compressed(nodes) {
  const pool = [], parts = []
  const conv = (n) => {
    const idx = pool.length; pool.push(n.n)
    parts.push(header(n.id, idx))
    if (n.kids) { parts.push(asc(n.form)); n.kids.forEach(conv) } else { if (n.form) parts.push(asc(n.form)); parts.push(n.body); if (n.n & 1) parts.push(PAD) }
  }
  nodes.forEach(conv)
  const stream = concat(parts), sizes = new W(pool.length * 4 + 4)
  for (const s of pool) sizes.u32(s)
  const mk = async (u8) => { const z = await deflate(u8); return concat([asc('CPng'), Uint8Array.of(1, 0, 4, 0), z]) }
  const c1 = await mk(stream), c2 = await mk(sizes.out)
  const w = new W(16 + c1.length + c2.length)
  w.u32(c1.length).u32(stream.length).u32(c2.length).u32(sizes.n).put(c1).put(c2)
  return rawList('cmpr', w.out)
}

// ---------- records ----------
const flgs = (f0, f2, type) => leaf('flgs', Uint8Array.of(f0, 0, f2, type))
/** loda: an object description made of typed arguments. args = [[type, bytes]] in file order. */
function loda(ctype, args) {
  const n = args.length, typesAt = 20 + (n + 1) * 4
  let pos = typesAt + n * 4
  const offs = args.map(([, b]) => { const o = pos; pos += b.length; return o })
  const w = new W(pos).u32(pos).u32(n).u32(20).u32(typesAt).u32(ctype)
  for (const o of offs) w.u32(o)
  w.u32(pos)
  for (let j = 0; j < n; j++) w.u32(args[n - 1 - j][0]) // the types run in reverse order
  for (const [, b] of args) w.put(b)
  return leaf('loda', w.out)
}
const argU32 = (v) => new W(4).u32(v).out
const argName = (s) => u16z(String(s).slice(0, 255))
const argSize = (wIn, hIn) => { const w = new W(8); coord(w, wIn); coord(w, hIn); return w.out }
const argOpacity = (o) => new W(16).z(14).u16(Math.max(0, Math.min(1000, Math.round(o * 1000)))).out
/** Object frame (a, b, c, d, tx, ty with tx and ty in inches), stored as one 48 byte matrix with a 8 byte block header (this version). */
function trfd(m) {
  const t = new W(64).u32(VERSION).u32(56).u16(8).z(6).f64(m[0]).f64(m[2]).f64(m[4] * INCH).f64(m[1]).f64(m[3]).f64(m[5] * INCH).out
  const w = new W(96).u32(12 + 4 + t.length).u32(1).u32(12).u32(16).put(t)
  return leaf('trfd', w.out)
}
const bboxChunk = (b) => leaf('bbox', new W(16).i32(b[0]).i32(b[1]).i32(b[2]).i32(b[3]).out)
const obbxChunk = (b, pad) => {
  const x0 = clampI(b[0] - pad), y0 = clampI(b[1] - pad), x1 = clampI(b[2] + pad), y1 = clampI(b[3] + pad)
  return leaf('obbx', new W(32).i32(x0).i32(y0).i32(x1).i32(y0).i32(x1).i32(y1).i32(x0).i32(y1).out)
}
const guid = (seed) => { // a stable pseudo random GUID (the file wants one per layer; stable output makes files comparable)
  let h = 2166136261
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) { for (const ch of seed + ':' + i) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); out[i] = h >>> 24 }
  out[7] = (out[7] & 0x0f) | 0x40; out[8] = (out[8] & 0x3f) | 0x80
  return out
}

// ---------- global tables: fills, outlines, fonts, bitmaps ----------
class Styles {
  constructor(lean) { this.lean = lean; this.next = 100; this.fills = new Map(); this.outls = new Map(); this.fonts = new Map(); this.bmps = []; this.usd = 0 }
  id() { return ++this.next }
  fill(spec) {
    const key = JSON.stringify(spec)
    let f = this.fills.get(key)
    if (f) return f.id
    const id = this.id(), w = new W(160).u32(id).u32(VERSION)
    if (spec.k === 'none') w.u32(2).u16(0)
    else if (spec.k === 'solid') {
      const props = new W(64).u8(1).u32(12); color12(props, spec.c)
      if (!this.lean) props.u8(7).u32(16).z(16) // the (empty) user palette id
      props.u8(0).u32(0) // end marker
      const solid = new W(64).u32(VERSION).u32(props.n).put(props.out).u16(0).z(2).u32(0).i32(45e6).u32(60)
      w.u32(2 + solid.n).u16(1).put(solid.out)
    } else { // gradient: kind 1 linear, 2 radial
      const r = new W(256).u8(spec.kind).z(17).z(2).i32(Math.round(spec.angle * 1e6)).i32(0).i32(0).z(2).u32(0).u8(50).u8(0).u32(spec.stops.length).z(3)
      for (const s of spec.stops) { color12(r, s.c); r.z(5).u32(Math.round(s.o * 10000)).z(3) }
      r.z(3)
      const g = new W(r.n + 8).u32(VERSION).u32(r.n).put(r.out)
      w.u32(2 + g.n).u16(2).put(g.out)
    }
    f = { id, node: leaf('fild', w.out) }
    this.fills.set(key, f)
    return id
  }
  outline(spec) {
    const key = JSON.stringify(spec)
    let o = this.outls.get(key)
    if (o) return o.id
    const id = this.id()
    const dash = spec.dash || []
    const r = new W(160).u16((spec.none ? 1 : 0) | (dash.length ? 2 : 0)).u16(spec.cap || 0).u16(spec.join || 0).i32(spec.w || 0).u16(100).z(2).i32(0).z(46)
    color12(r, spec.c || '#000000')
    r.z(16).u16(dash.length)
    for (let i = 0; i < 11; i++) r.u16(dash[i] || 0) // room for 11 dash lengths
    r.u32(0).u32(0) // start and end markers
    const w = new W(r.n + 12).u32(id).u32(1).u32(r.n).put(r.out)
    o = { id, node: leaf('outl', w.out) }
    this.outls.set(key, o)
    return id
  }
  font(name) {
    let f = this.fonts.get(name)
    if (f) return f.id
    const id = this.fonts.size + 1
    const w = new W(64).u16(id).u16(0).u32(0).z(10).put(u16z(name))
    f = { id, node: leaf('font', w.out) }
    this.fonts.set(name, f)
    return id
  }
  /**
   * rgba: Uint8ClampedArray w*h*4. Rows go bottom up, padded to 4 bytes. 24 bit BGR (transparency flattened on white), or with alpha = 'rgba' and any
   * transparent pixel: 32 bit BGRA (fully transparent pixels get alpha 1 and white colour, because readers treat a zero alpha byte as "unused").
   * Returns {id, flattened}.
   */
  bitmap(w, h, rgba, alpha) {
    let opaque = true
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break }
    const bpp = !opaque && alpha === 'rgba' ? 32 : 24, bytes = bpp / 8
    const stride = ((w * bpp + 31) >> 5) << 2, px = new Uint8Array(stride * h)
    for (let y = 0; y < h; y++) {
      let s = y * w * 4, d = (h - 1 - y) * stride
      for (let x = 0; x < w; x++, s += 4, d += bytes) {
        const a = rgba[s + 3]
        if (bpp === 32) {
          if (a === 0) { px[d] = px[d + 1] = px[d + 2] = 255; px[d + 3] = 1 } else { px[d] = rgba[s + 2]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s]; px[d + 3] = a }
        } else if (a === 255) { px[d] = rgba[s + 2]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s] } else { const k = a / 255, m = 255 * (1 - k); px[d] = rgba[s + 2] * k + m; px[d + 1] = rgba[s + 1] * k + m; px[d + 2] = rgba[s] * k + m }
      }
    }
    const id = this.bmps.length + 1
    const head = new W(130).u32(id).z(50).u32(5).z(4).u32(w).u32(h).z(4).u32(bpp).z(4).u32(px.length).z(32)
    this.bmps.push(leaf('bmp ', concat([head.out, px])))
    return { id, flattened: !opaque && bpp === 24, alpha: bpp === 32 }
  }
}

// ---------- colours and gradients ----------
const hexOf = (c, say) => {
  const p = c == null ? null : parseColor(c)
  if (!p) { if (c != null && c !== 'none') say('Some colours were not understood and are written as black.'); return c == null || c === 'none' ? null : '#000000' }
  return p.c
}
const mix = (a, b, t) => { const p = rgbOf(a), q = rgbOf(b); return '#' + [0, 1, 2].map((i) => Math.round(p[i] + (q[i] - p[i]) * t).toString(16).padStart(2, '0')).join('') }
const colorAt = (stops, o) => {
  if (o <= stops[0].o) return stops[0].c
  for (let i = 1; i < stops.length; i++) if (o <= stops[i].o) { const a = stops[i - 1], b = stops[i]; return b.o === a.o ? b.c : mix(a.c, b.c, (o - a.o) / (b.o - a.o)) }
  return stops[stops.length - 1].c
}
/**
 * The format fits a fountain fill to the bounding box of the object: linear fills run along an angle edge to edge, radial fills reach a circle of half
 * the larger side. The stops are re-mapped so the look is the same, whatever the original end points were. Returns a fill spec.
 */
function gradientSpec(g, box, say) {
  const raw = (g.stops || []).map((s) => ({ o: Math.max(0, Math.min(1, +s.o || 0)), c: hexOf(s.c, say) || '#000000', a: s.a == null ? 1 : s.a })).sort((a, b) => a.o - b.o)
  if (!raw.length) return { k: 'none' }
  if (raw.some((s) => s.a < 1)) say('Transparency inside gradients is not written (the colours are kept).')
  if (g.spread && g.spread !== 'pad') say('Repeating and reflecting gradients are written as plain gradients.')
  const solid = (c) => ({ k: 'solid', c })
  if (raw.length === 1) return solid(raw[0].c)
  const M = g.m || IDENT
  const clean = (list) => { // at most 64 stops, strictly inside 0..1 with the end stops at both ends
    if (list.length > 64) { say('Gradients with more than 64 colour stops were thinned out.'); const step = (list.length - 1) / 63; list = Array.from({ length: 64 }, (_, i) => list[Math.round(i * step)]) }
    return list.map((s) => ({ o: Math.round(Math.max(0, Math.min(1, s.o)) * 1e4) / 1e4, c: s.c }))
  }
  if (g.g === 'radial') {
    const [cx, cy] = apply(M, g.cx, g.cy), r = (g.r || 1) * meanScale(M), Rc = Math.max(box.w, box.h) / 2
    if (!(r > 1e-9) || !(Rc > 1e-9)) return solid(raw[raw.length - 1].c)
    if (Math.hypot(cx - (box.x + box.w / 2), cy - (box.y + box.h / 2)) > 0.03 * Rc) say('Radial gradients whose centre is not the centre of the object are written centred.')
    const k = Rc / r
    const stops = [{ o: 0, c: colorAt(raw, 0) }, ...raw.map((s) => ({ o: s.o / k, c: s.c })).filter((s) => s.o > 1e-4 && s.o < 1 - 1e-4), { o: 1, c: colorAt(raw, Math.min(1, k)) }]
    return { k: 'grad', kind: 2, angle: 0, stops: clean(stops) }
  }
  const [x1, y1] = apply(M, g.x1, g.y1), [x2, y2] = apply(M, g.x2, g.y2)
  const L = Math.hypot(x2 - x1, y2 - y1)
  if (!(L > 1e-9)) return solid(raw[raw.length - 1].c)
  const ux = (x2 - x1) / L, uy = (y2 - y1) / L
  const half = (Math.abs(box.w * ux) + Math.abs(box.h * uy)) / 2
  if (!(half > 1e-9)) return solid(raw[0].c)
  const mid = (box.x + box.w / 2) * ux + (box.y + box.h / 2) * uy, pmin = mid - half, p1 = x1 * ux + y1 * uy
  const sOf = (o) => (p1 + o * L - pmin) / (2 * half), tOf = (s) => (pmin + s * 2 * half - p1) / L
  const stops = [{ o: 0, c: colorAt(raw, Math.max(0, Math.min(1, tOf(0)))) }, ...raw.map((s) => ({ o: sOf(s.o), c: s.c })).filter((s) => s.o > 1e-4 && s.o < 1 - 1e-4), { o: 1, c: colorAt(raw, Math.max(0, Math.min(1, tOf(1)))) }]
  return { k: 'grad', kind: 1, angle: Math.round((Math.atan2(-uy, ux) * 180) / Math.PI * 1e3) / 1e3, stops: clean(stops) }
}

// ---------- clipping ----------
// The format keeps clipping in a container structure that is not publicly documented. Instead the clip is applied to the content itself.
// Paths: convex clip shapes (rectangles, ellipses, rounded boxes) cut them (curves that are cut become short straight segments); other clip
// shapes are written without the clip and said in the notes. Bitmaps: any clip shape works. The bitmap is cropped to the area the clips can
// show and the pixels outside the shapes get alpha 0 (white in the default flattened mode), see maskImage.
const area2 = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1] } return s }
function flatten(d) {
  const out = []
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0
  const begin = () => { if (!cur) { cur = { p: [[cx, cy]], closed: false }; out.push(cur) } }
  for (const c of d) {
    if (c[0] === 'M') { cur = { p: [[c[1], c[2]]], closed: false }; out.push(cur); cx = sx = c[1]; cy = sy = c[2] }
    else if (c[0] === 'L') { begin(); cur.p.push([c[1], c[2]]); cx = c[1]; cy = c[2] }
    else if (c[0] === 'C') {
      begin()
      const len = Math.hypot(c[1] - cx, c[2] - cy) + Math.hypot(c[3] - c[1], c[4] - c[2]) + Math.hypot(c[5] - c[3], c[6] - c[4])
      const n = Math.max(6, Math.min(64, Math.ceil(Math.sqrt(len) * 2)))
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, e = 3 * u * t * t, f = t * t * t
        cur.p.push([a * cx + b * c[1] + e * c[3] + f * c[5], a * cy + b * c[2] + e * c[4] + f * c[6]])
      }
      cx = c[5]; cy = c[6]
    } else if (c[0] === 'Z') { if (cur) cur.closed = true; cur = null; cx = sx; cy = sy }
  }
  return out
}
const toD = (polys) => polys.flatMap((q) => (q.p.length < 2 ? [] : [['M', q.p[0][0], q.p[0][1]], ...q.p.slice(1).map((v) => ['L', v[0], v[1]]), ...(q.closed ? [['Z']] : [])]))
const extent = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const v of pts) { if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0]; if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1] }
  return { x0, y0, x1, y1 }
}
const shapeCache = new WeakMap()
/** A clip as a convex ring, or null when it is not one. {ring, sgn, box:{x0,y0,x1,y1}, rect} */
function clipShape(c) {
  if (!c || typeof c !== 'object') return null
  if (shapeCache.has(c)) return shapeCache.get(c)
  const r = clipShape1(c)
  shapeCache.set(c, r)
  return r
}
function clipShape1(c) {
  const subs = flatten(c.d || []).filter((s) => s.p.length >= 3)
  if (subs.length !== 1) return null
  let p = subs[0].p
  if (Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6) p = p.slice(0, -1)
  const A = area2(p)
  if (p.length < 3 || Math.abs(A) < 1e-9) return null
  const sgn = A > 0 ? 1 : -1
  for (let i = 0; i < p.length; i++) { // convex: no turn to the other side
    const a = p[i], b = p[(i + 1) % p.length], e = p[(i + 2) % p.length]
    if (sgn * ((b[0] - a[0]) * (e[1] - b[1]) - (b[1] - a[1]) * (e[0] - b[0])) < -1e-6 * (Math.abs(A) + 1)) return null
  }
  const box = extent(p)
  const rect = p.length === 4 && p.every((v) => (Math.abs(v[0] - box.x0) < 1e-6 || Math.abs(v[0] - box.x1) < 1e-6) && (Math.abs(v[1] - box.y0) < 1e-6 || Math.abs(v[1] - box.y1) < 1e-6))
  return { ring: p, sgn, box, rect }
}
const inside = (cl, x, y, tol = 1e-6) => { for (let i = 0; i < cl.ring.length; i++) { const a = cl.ring[i], b = cl.ring[(i + 1) % cl.ring.length]; if (cl.sgn * ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) < -tol) return false } return true }
function clipPolygon(poly, cl) { // Sutherland-Hodgman against a convex ring
  let out = poly
  for (let i = 0; i < cl.ring.length && out.length; i++) {
    const a = cl.ring[i], b = cl.ring[(i + 1) % cl.ring.length], inp = out
    const side = (p) => cl.sgn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
    out = []
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q)
      if (sp >= 0) out.push(p)
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]) }
    }
  }
  return out
}
function clipSegment(p, q, cl) { // Cyrus-Beck: the part of segment pq inside a convex ring, or null
  let t0 = 0, t1 = 1
  for (let i = 0; i < cl.ring.length; i++) {
    const a = cl.ring[i], b = cl.ring[(i + 1) % cl.ring.length]
    const sp = cl.sgn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])), sq = cl.sgn * ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]))
    if (sp < 0 && sq < 0) return null
    if (sp < 0) t0 = Math.max(t0, sp / (sp - sq)); else if (sq < 0) t1 = Math.min(t1, sp / (sp - sq))
  }
  if (t0 > t1) return null
  return [[p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0], [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1]]
}
function clipPolyline(sub, cl) { // open pieces of a (closed or open) polyline inside the ring
  const pts = sub.closed ? [...sub.p, sub.p[0]] : sub.p, pieces = []
  let cur = null
  for (let i = 0; i + 1 < pts.length; i++) {
    const s = clipSegment(pts[i], pts[i + 1], cl)
    if (!s) { cur = null; continue }
    if (cur && Math.hypot(cur.p[cur.p.length - 1][0] - s[0][0], cur.p[cur.p.length - 1][1] - s[0][1]) < 1e-6) cur.p.push(s[1])
    else { cur = { p: [s[0], s[1]], closed: false }; pieces.push(cur) }
  }
  return pieces
}
/** Applies convex clips to a path item. Returns the items that replace it ([] = nothing visible), or null when a clip cannot be applied. */
function clipPath(it, clips, say) {
  const cls = clips.map(clipShape)
  if (cls.some((c) => !c)) return null
  const filled = !!it.fill, stroked = !!(it.stroke && it.strokeWidth > 0), pad = stroked ? it.strokeWidth / 2 : 0
  const bb = pathBBox(it.d)
  if (!bb) return []
  const within = (cl, x0, y0, x1, y1) => x0 >= cl.box.x0 && x1 <= cl.box.x1 && y0 >= cl.box.y0 && y1 <= cl.box.y1
  if (cls.every((cl) => cl.rect && within(cl, bb.x - pad, bb.y - pad, bb.x + bb.w + pad, bb.y + bb.h + pad))) return [it] // the common case: nothing to cut
  let subs = flatten(it.d), changed = false
  for (const cl of cls) {
    const e = extent(subs.flatMap((s) => s.p))
    if (e.x0 === Infinity) return []
    if (e.x1 + pad < cl.box.x0 || e.x0 - pad > cl.box.x1 || e.y1 + pad < cl.box.y0 || e.y0 - pad > cl.box.y1) return []
    if (cl.rect ? within(cl, e.x0 - pad, e.y0 - pad, e.x1 + pad, e.y1 + pad) : subs.every((s) => s.p.every((v) => inside(cl, v[0], v[1])))) continue // untouched by this clip
    changed = true
    subs = subs.flatMap((s) => {
      if (filled && !stroked) { const q = clipPolygon(s.p, cl); return q.length >= 3 ? [{ p: q, closed: true }] : [] }
      return clipPolyline(s, cl)
    })
  }
  if (!changed) return [it]
  say('Curves cut by a clip are written as straight segments.')
  if (filled && stroked) {
    // the fill and the outline are clipped separately, so the cut edge carries no outline
    say('Objects with a fill and an outline that were cut by a clip are written as two objects.')
    const out = []
    const fillSubs = cls.reduce((acc, cl) => acc.flatMap((s) => { const q = clipPolygon(s.p, cl); return q.length >= 3 ? [{ p: q, closed: true }] : [] }), flatten(it.d))
    const lineSubs = cls.reduce((acc, cl) => acc.flatMap((s) => clipPolyline(s, cl)), flatten(it.d))
    if (fillSubs.length) out.push({ ...it, d: toD(fillSubs), stroke: null, strokeWidth: 0 })
    if (lineSubs.length) out.push({ ...it, d: toD(lineSubs), fill: null })
    return out
  }
  return subs.length ? [{ ...it, d: toD(subs) }] : []
}

// ---------- images ----------
async function sourceBytes(href) {
  if (/^data:/i.test(href)) return dataUrlBytes(href)
  if (/^blob:/i.test(href) && typeof fetch === 'function') { const r = await fetch(href); return { mime: r.headers.get('content-type') || '', bytes: new Uint8Array(await r.arrayBuffer()) } }
  throw new Error('This image source is not supported.')
}
async function browserDecode(bytes, mime, plan) {
  if (typeof createImageBitmap !== 'function') throw new Error('This environment cannot decode images.')
  const bmp = await createImageBitmap(new Blob([bytes], { type: mime }))
  try {
    const p = plan(bmp.width, bmp.height)
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(p.w, p.h) : Object.assign(document.createElement('canvas'), { width: p.w, height: p.h })
    const g = cv.getContext('2d', { willReadFrequently: true })
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, p.sx, p.sy, p.sw, p.sh, 0, 0, p.w, p.h)
    return { w: p.w, h: p.h, data: g.getImageData(0, 0, p.w, p.h).data }
  } finally { bmp.close?.() }
}
/** Crop and scale RGBA pixels (box filter) for decoders that return the full image. The source rectangle may have fractional edges. */
function cropScale(img, p) {
  const out = new Uint8ClampedArray(p.w * p.h * 4)
  for (let y = 0; y < p.h; y++) {
    const y0 = Math.max(0, Math.floor(p.sy + (y * p.sh) / p.h + 1e-9)), y1 = Math.min(img.h, Math.max(y0 + 1, Math.ceil(p.sy + ((y + 1) * p.sh) / p.h - 1e-9)))
    for (let x = 0; x < p.w; x++) {
      const x0 = Math.max(0, Math.floor(p.sx + (x * p.sw) / p.w + 1e-9)), x1 = Math.min(img.w, Math.max(x0 + 1, Math.ceil(p.sx + ((x + 1) * p.sw) / p.w - 1e-9)))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * img.w + xx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3]; n++ }
      const o = (y * p.w + x) * 4
      if (n) { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n }
    }
  }
  return { w: p.w, h: p.h, data: out }
}

/** Spans [x0, x1] of the clip shape along the horizontal line y (polygons in pixel coordinates). */
function spansAt(cl, y) {
  const xs = []
  for (const q of cl.subs) for (let i = 0, n = q.length; i < n; i++) {
    const a = q[i], b = q[(i + 1) % n]
    if ((a[1] <= y) !== (b[1] <= y)) xs.push([a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), b[1] > a[1] ? 1 : -1])
  }
  xs.sort((p, q) => p[0] - q[0])
  const out = []
  if (cl.rule === 'evenodd') { for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i][0], xs[i + 1][0]]) }
  else { let wind = 0, start = 0; for (const [x, d] of xs) { const was = wind; wind += d; if (!was && wind) start = x; else if (was && !wind) out.push([start, x]) } }
  return out
}
/** Multiplies the alpha of RGBA pixels by how much of each pixel the clip shapes cover (two sub-scanlines per row, exact across). */
function maskImage(img, clips) {
  const { w, h, data } = img
  const cov = new Float32Array(w), acc = new Float32Array(w)
  for (let y = 0; y < h; y++) {
    cov.fill(1)
    for (const cl of clips) {
      acc.fill(0)
      for (const yc of [y + 0.25, y + 0.75]) {
        for (const [x0, x1] of spansAt(cl, yc)) {
          const a = Math.max(0, x0), b = Math.min(w, x1)
          for (let px = Math.floor(a); px < b; px++) acc[px] += 0.5 * (Math.min(px + 1, b) - Math.max(px, a))
        }
      }
      for (let x = 0; x < w; x++) cov[x] *= Math.min(1, acc[x])
    }
    for (let x = 0; x < w; x++) if (cov[x] < 1) { const o = (y * w + x) * 4 + 3; data[o] = Math.round(data[o] * cov[x]) }
  }
}

// ---------- the writer ----------
const nameOf = (s) => String(s ?? '').trim()
const fontFamily = (f) => nameOf(String(f || 'Arial').split(',')[0].replace(/^['"]|['"]$/g, '')) || 'Arial'

function normalize(doc) {
  const pages = (doc?.pages?.length ? doc.pages : [{ w: 595.28, h: 841.89, items: [] }]).map((p, i) => {
    const w = Number.isFinite(+p.w) && p.w > 0 ? +p.w : 595.28, h = Number.isFinite(+p.h) && p.h > 0 ? +p.h : 841.89
    const layers = (Array.isArray(p.layers) ? p.layers : [{ name: 'Layer 1', items: p.items || [] }]).filter((l) => l && typeof l === 'object')
    return { name: nameOf(p.name) || `Page ${i + 1}`, w, h, guides: p.guides || [], layers: layers.length ? layers : [{ name: 'Layer 1', items: [] }] }
  })
  return pages
}
const countLeaves = (items) => items.reduce((n, it) => n + (it?.t === 'group' ? countLeaves(it.items || []) : 1), 0)

export async function writeCdr(doc, { title, textToCurves = true, onProgress, signal, compress = false, maxDpi = 300, bitmapAlpha = 'flatten', lean = false, decodeImage } = {}) {
  void title // the version 13 layout has no document title field
  const check = () => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' }) }
  const progress = (f, t) => onProgress?.(Math.max(0, Math.min(1, f)), t)
  const counts = new Map()
  const say = (text, n = 1) => counts.set(text, (counts.get(text) || 0) + n)
  const S = new Styles(lean)
  check(); progress(0, 'Preparing')

  let pages = normalize(doc)
  if (textToCurves && pages.some((p) => p.layers.some((l) => hasText(l.items || [])))) pages = await outlineText(pages, doc.fonts, check, say)
  const total = Math.max(1, pages.reduce((n, p) => n + p.layers.reduce((m, l) => m + countLeaves(l.items || []), 0), 0))
  let done = 0, lastTick = Date.now()
  const tick = async (text) => {
    check()
    progress(0.05 + 0.8 * (done / total), text)
    if (Date.now() - lastTick > 30) { await new Promise((r) => setTimeout(r, 0)); lastTick = Date.now() }
  }
  const decoder = decodeImage || browserDecode
  const NONE_FILL = { k: 'none' }, NONE_LINE = { none: true, w: 0, c: '#000000' }
  const layerNotes = []
  let nGuides = 0, nHidden = 0, nLocked = 0, nSolidRule = 0

  const objectNode = (o) => {
    const args = [[30, o.geom], [20, argU32(o.fillId)], [10, argU32(o.outId)]]
    if (o.name) args.push([1000, argName(o.name)])
    if (o.opacity < 0.999) args.push([8000, argOpacity(o.opacity)])
    const kids = [flgs(0, 0, 0x08), loda(o.ctype, args), trfd(o.m)]
    if (o.txsm) kids.push(leaf('txsm', o.txsm))
    kids.push(bboxChunk(o.bb))
    if (!lean) kids.push(obbxChunk(o.bb, o.pad || 0), leaf('usdn', argU32(++S.usd)))
    return { node: list('obj ', kids), bb: o.bb }
  }
  const unitBox = (P, b) => [clampI((b.x - P.cx) * K), clampI((P.cy - b.y - b.h) * K), clampI((b.x + b.w - P.cx) * K), clampI((P.cy - b.y) * K)]

  /** Path commands -> point list of a curve object: [n, all x y pairs, one type byte per point]. Closed sub-paths flag their move and closing points. */
  const curveGeom = (d, P) => {
    const X = (x) => clampI((x - P.cx) * K), Y = (y) => clampI((P.cy - y) * K)
    const pts = []
    let start = -1, open = false, segs = 0, sx = 0, sy = 0, total = 0
    const pt = (x, y, t) => pts.push({ x: X(x), y: Y(y), t })
    const dropLoneMove = () => { if (open && segs === 0 && start >= 0) pts.length = start }
    const begin = (x, y) => { dropLoneMove(); start = pts.length; pt(x, y, 0x04); open = true; segs = 0 }
    for (const c of d) {
      if (c[0] === 'M') { begin(c[1], c[2]); sx = c[1]; sy = c[2] }
      else if (c[0] === 'L' || c[0] === 'C') {
        if (!open) begin(sx, sy)
        if (c[0] === 'L') pt(c[1], c[2], 0x44)
        else { pt(c[1], c[2], 0xc0); pt(c[3], c[4], 0xc0); pt(c[5], c[6], 0x84) }
        segs++; total++
      } else if (c[0] === 'Z' && open && segs) {
        const last = pts[pts.length - 1], first = pts[start]
        if (last.x === first.x && last.y === first.y) last.t = (last.t & ~4) | 8
        else pt(sx, sy, 0x48)
        first.t |= 8
        open = false
      }
    }
    dropLoneMove()
    if (!total) return null
    const w = new W(pts.length * 9 + 8).u32(pts.length)
    for (const p of pts) w.i32(p.x).i32(p.y)
    for (const p of pts) w.u8(p.t)
    return w.out
  }

  const pathItems = (it, P) => {
    let items = [it]
    if (it.clip?.length) {
      const r = clipPath(it, it.clip, say)
      if (r) items = r; else say('Some clip shapes are too complex for this format and are written without the clip.')
    }
    const out = []
    for (const p of items) {
      const d = Array.isArray(p.d) ? p.d : []
      if (!d.every((c) => Array.isArray(c) && c.every((v, i) => i === 0 || Number.isFinite(v)))) { say('Paths with invalid numbers were left out.'); continue }
      const geom = curveGeom(d, P)
      if (!geom) { say('Empty paths were left out.'); continue }
      const mapped = pathBBox(d)
      if (!mapped) continue
      const fillColor = typeof p.fill === 'string' ? hexOf(p.fill, say) : null
      const stroked = !!(p.stroke && p.strokeWidth > 0)
      let fillSpec = NONE_FILL
      if (p.fill && typeof p.fill === 'object') fillSpec = gradientSpec(p.fill, mapped, say)
      else if (fillColor) fillSpec = { k: 'solid', c: fillColor }
      let outSpec = NONE_LINE
      if (stroked) {
        const sw = p.strokeWidth
        let dash = (p.dash || []).filter((v) => v > 0).map((v) => Math.max(1, Math.min(65535, Math.round(v / sw))))
        if (dash.length % 2) dash = dash.concat(dash)
        if (dash.length > 10) { say('Dash patterns with more than five dashes were shortened.'); dash = dash.slice(0, 10) }
        outSpec = { w: clampI(sw * K), c: hexOf(p.stroke, say) || '#000000', cap: p.cap === 1 || p.cap === 2 ? p.cap : 0, join: p.join === 1 || p.join === 2 ? p.join : 0, ...(dash.length ? { dash } : {}) }
        if (dash.length) say('Dash lengths are stored in multiples of the line width and are rounded.')
      }
      const hasFill = fillSpec.k !== 'none'
      let opacity = hasFill ? p.fillOpacity ?? 1 : stroked ? p.strokeOpacity ?? 1 : 1
      if (hasFill && stroked && Math.abs((p.fillOpacity ?? 1) - (p.strokeOpacity ?? 1)) > 0.01) say('Objects with different fill and outline transparency use the fill value for both.')
      if (!Number.isFinite(opacity)) opacity = 1
      if (hasFill && p.rule === 'nonzero' && d.filter((c) => c[0] === 'M').length > 1) nSolidRule++
      out.push(objectNode({ ctype: 3, geom, fillId: S.fill(fillSpec), outId: S.outline(outSpec), name: p.name, opacity, m: IDENT, bb: unitBox(P, mapped), pad: stroked ? (p.strokeWidth / 2) * K : 0 }))
    }
    return out
  }

  const imageItems = async (it, P) => {
    const U = it.m || IDENT
    const wl = Math.hypot(U[0], U[1]) / 72, hl = Math.hypot(U[2], U[3]) / 72
    if (!(wl > 1e-6) || !(hl > 1e-6) || Math.abs(U[0] * U[3] - U[1] * U[2]) < 1e-9) { say('Images with no size were left out.'); return [] }
    let crop = null, masks = null
    const quad = mapPath([['M', 0, 0], ['L', 1, 0], ['L', 1, 1], ['L', 0, 1], ['Z']], U)
    if (it.clip?.length) {
      // the image is cropped to the area the clips can show, and the rest of the pixels are masked (alpha) when the clips are not plain rectangles
      const corners = quad.filter((c) => c[0] !== 'Z')
      const infos = it.clip.map((c) => ({ rule: c?.rule === 'evenodd' ? 'evenodd' : 'nonzero', sh: clipShape(c), subs: flatten(c?.d || []).filter((q) => q.p.length > 1) }))
      if (!infos.every((i) => i.sh && corners.every((c) => inside(i.sh, c[1], c[2])))) {
        const inv = invert(U)
        let u0 = 0, v0 = 0, u1 = 1, v1 = 1
        for (const i of infos) {
          let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
          for (const q of i.subs) for (const pt of q.p) { const t = apply(inv, pt[0], pt[1]); a = Math.min(a, t[0]); c = Math.max(c, t[0]); b = Math.min(b, t[1]); d = Math.max(d, t[1]) }
          u0 = Math.max(u0, a); u1 = Math.min(u1, c); v0 = Math.max(v0, b); v1 = Math.min(v1, d)
        }
        if (!(u1 > u0 && v1 > v0)) return []
        crop = { u0, u1, v0, v1 }
        const tiny = 1e-9 * Math.max(Math.abs(U[0]), Math.abs(U[1]), Math.abs(U[2]), Math.abs(U[3]))
        const axes = (Math.abs(U[1]) < tiny && Math.abs(U[2]) < tiny) || (Math.abs(U[0]) < tiny && Math.abs(U[3]) < tiny) // upright, or turned by a multiple of 90 degrees
        masks = infos.filter((i) => !(i.sh?.rect && axes))
        if (!masks.length) masks = null
      }
    }
    let res, used = null
    const plan = (nw, nh) => {
      // source rectangle in natural pixels (fractional edges are fine for canvas drawing) and the output size
      const sx = crop ? crop.u0 * nw : 0, sy = crop ? crop.v0 * nh : 0, sw = crop ? (crop.u1 - crop.u0) * nw : nw, sh = crop ? (crop.v1 - crop.v0) * nh : nh
      let w = Math.max(1, Math.round(sw)), h = Math.max(1, Math.round(sh))
      if (maxDpi > 0) { w = Math.min(w, Math.max(1, Math.ceil(wl * (sw / nw) * maxDpi))); h = Math.min(h, Math.max(1, Math.ceil(hl * (sh / nh) * maxDpi))) }
      const big = (w * h) / 4e7
      if (big > 1) { w = Math.max(1, Math.floor(w / Math.sqrt(big))); h = Math.max(1, Math.floor(h / Math.sqrt(big))) }
      return (used = { sx, sy, sw, sh, w, h, nw, nh })
    }
    try {
      const { mime, bytes } = await sourceBytes(it.href || '')
      res = await decoder(bytes, mime, plan)
      if (!used) plan(res.w, res.h)
      if (res.w !== used.w || res.h !== used.h) res = cropScale(res, used)
      if (used.w < used.sw * 0.99 || used.h < used.sh * 0.99) say(`Images above ${maxDpi} pixels per inch at their placed size were reduced to save space.`)
    } catch {
      say('Some images could not be read and were left out.')
      return []
    }
    if (masks) {
      const fu0 = used.sx / used.nw, fu1 = (used.sx + used.sw) / used.nw, fv0 = used.sy / used.nh, fv1 = (used.sy + used.sh) / used.nh
      const toPx = mul([used.w / (fu1 - fu0), 0, 0, used.h / (fv1 - fv0), (-fu0 * used.w) / (fu1 - fu0), (-fv0 * used.h) / (fv1 - fv0)], invert(U))
      maskImage(res, masks.map((m) => ({ rule: m.rule, subs: m.subs.map((q) => q.p.map(([x, y]) => apply(toPx, x, y))) })))
    }
    // the placed frame follows the cropped and scaled pixel area
    const u0 = used.sx / used.nw, u1 = (used.sx + used.sw) / used.nw, v0 = used.sy / used.nh, v1 = (used.sy + used.sh) / used.nh
    const Uc = mul(U, [u1 - u0, 0, 0, v1 - v0, u0, v0])
    const cwl = wl * (u1 - u0), chl = hl * (v1 - v0)
    const F = [1 / cwl, 0, 0, -1 / chl, 0, 1] // local box (y up) -> unit square
    const A = [1 / 72, 0, 0, -1 / 72, -P.cx / 72, P.cy / 72] // page points -> inches, y up, centred
    const m = mul(A, mul(Uc, F))
    const { id, flattened, alpha } = S.bitmap(used.w, used.h, res.data, bitmapAlpha)
    if (flattened) say('Transparent areas of images are filled with white, because the transparency layout of bitmaps in this format is not publicly documented.')
    if (alpha) say('Image transparency is written as a 32 bit alpha channel. The desktop application was not available to check that it understands it.')
    const g = new W(256)
    coord(g, 0); coord(g, 0); coord(g, cwl); coord(g, chl)
    g.z(32).u32(id).z(20).u32(5)
    const rx = clampI(cwl * INCH), ry = clampI(chl * INCH), ring = [[0, 0, 0x0c], [rx, 0, 0x44], [rx, ry, 0x44], [0, ry, 0x44], [0, 0, 0x48]]
    for (const p of ring) g.i32(p[0]).i32(p[1])
    for (const p of ring) g.u8(p[2])
    const bb = unitBox(P, pathBBox(mapPath([['M', 0, 0], ['L', 1, 0], ['L', 1, 1], ['L', 0, 1], ['Z']], Uc)))
    return [objectNode({ ctype: 5, geom: g.out, fillId: S.fill(NONE_FILL), outId: S.outline(NONE_LINE), name: it.name, opacity: it.opacity ?? 1, m, bb })]
  }

  const textItems = (it, P) => {
    let str = String(it.str ?? '')
    if (str.includes('\n')) { str = str.replace(/\s*\n\s*/g, ' '); say('Line breaks inside live text were replaced by spaces.') }
    if (!str.trim()) return []
    if (it.clip?.length) say('Live text cannot be clipped; it is written without the clip.')
    say('Live text refers to fonts by name, so the computer that opens the file needs those fonts installed.')
    // similarity transforms keep the rotation in the frame and the scale in the font size
    const M = it.m || IDENT, k = Math.hypot(M[0], M[1])
    if (!(k > 1e-9)) return []
    const sim = Math.abs(M[3] - M[0]) < 1e-6 * k && Math.abs(M[2] + M[1]) < 1e-6 * k
    const mt = sim ? [M[0] / k, M[1] / k, M[2] / k, M[3] / k, M[4], M[5]] : M
    const size = (it.size || 12) * (sim ? k : 1)
    if (!sim) say('Stretched or skewed text keeps its distortion in the object frame, which the desktop application may not apply.')
    const A = [1 / 72, 0, 0, -1 / 72, -P.cx / 72, P.cy / 72]
    const m = mul(A, mul(mt, [72, 0, 0, -72, 0, 0])) // text units (points, y down) -> object inches, y up
    const c = hexOf(it.fill, say) || '#000000'
    const fillId = S.fill({ k: 'solid', c }), fid = S.font(fontFamily(it.family))
    const w = new W(256)
    w.u32(0).z(32).u32(1).u32(1).z(48).u32(0).z(34) // text header, one frame
    w.u32(1).u32(0).u8(0).u32(1) // one paragraph with one style run
    const units = str.length
    w.u16(units).u8(0x01 | 0x02 | 0x04 | 0x40).u8(0)
    w.u16(fid).u16(0).u32(it.bold && it.italic ? 0x2000 : it.bold ? 0x1000 : it.italic ? 0x80 : 0x40)
    coord(w, size / 72); w.u32(fillId).z(48)
    w.u32(units).z(units * 8).u32(units * 2)
    for (let i = 0; i < units; i++) w.u16(str.charCodeAt(i))
    w.u8(0)
    const g = new W(8); coord(g, 0); coord(g, 0)
    const bb0 = itemBBox({ t: 'text', str, size, m: mt }) || { x: mt[4], y: mt[5] - size, w: size, h: size }
    return [objectNode({ ctype: 4, geom: g.out, fillId, outId: S.outline(NONE_LINE), name: it.name, opacity: it.opacity ?? 1, m, txsm: w.out, bb: unitBox(P, bb0) })]
  }

  const emitItems = async (items, P, depth) => {
    const out = []
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      if (it.hidden) { nHidden++; continue }
      if (it.locked) nLocked++
      if (it.t === 'group') {
        const kids = await emitItems(it.items || [], P, depth + 1)
        if (!kids.length) continue
        if (depth >= MAX_DEPTH) { out.push(...kids); say('Groups nested more than 28 levels deep were flattened.'); continue }
        let bb = null
        for (const k of kids) bb = bb ? [Math.min(bb[0], k.bb[0]), Math.min(bb[1], k.bb[1]), Math.max(bb[2], k.bb[2]), Math.max(bb[3], k.bb[3])] : k.bb
        const head = [flgs(0, 0, 0x10)]
        if (nameOf(it.name)) head.push(loda(0x10, [[1000, argName(nameOf(it.name))]]))
        out.push({ node: list('grp ', [...head, trfd(IDENT), bboxChunk(bb), ...kids.map((k) => k.node)]), bb })
        continue
      }
      let r = []
      try {
        if (it.t === 'path') r = pathItems(it, P)
        else if (it.t === 'image') r = await imageItems(it, P)
        else if (it.t === 'text') r = textItems(it, P)
        else say('Some unknown kinds of objects were left out.')
      } catch (e) {
        if (e?.code === 'ABORT') throw e
        say('Some objects could not be written and were left out.')
      }
      out.push(...r)
      done++
      await tick(it.t === 'image' ? 'Writing images' : 'Writing objects')
    }
    return out
  }

  const pageNodes = []
  let pi = 0
  for (const page of pages) {
    const P = { w: page.w, h: page.h, cx: page.w / 2, cy: page.h / 2 }
    nGuides += page.guides?.length || 0
    const layers = []
    for (const layer of page.layers) {
      const name = nameOf(layer.name) || `Layer ${layers.length + 1}`
      if (layer.hidden || layer.locked || layer.printable === false) layerNotes.push(name)
      const objs = await emitItems(layer.items || [], P, 0)
      layers.push(list('layr', [flgs(0, 0, 0x98), loda(0x98, [[1000, argName(name)], ...(lean ? [] : [[40050, guid(`${pi}/${layers.length}/${name}`)]])]), ...objs.map((o) => o.node)]))
    }
    pageNodes.push({ page, node: list('page', [flgs(0, 0, 0x90), loda(0x90, [[1000, argName(page.name)], [19130, argSize(page.w / 72, page.h / 72)]]), ...layers]) })
    pi++
  }
  const master = list('page', [flgs(0, 1, 0x90), loda(0x90, [[1000, argName('Master page')]]),
    ...[[0x08, 'Desktop'], [0x0a, 'Guides'], [0x1a, 'Document Grid']].map(([t, n]) => list('layr', [flgs(t, 0, 0x98), loda(0x98, [[1000, argName(n)], ...(lean ? [] : [[40050, guid('master/' + n)]])])]))])

  check(); progress(0.88, 'Assembling the file')
  const first = pages[0]
  const mcfg = new W(128).z(12); coord(mcfg, first.w / 72); coord(mcfg, first.h / 72); mcfg.z((lean ? 36 : 128) - mcfg.n)
  const docNode = list('doc ', [leaf('mcfg', mcfg.out), ...(lean ? [] : [rawList('stlt', argU32(0))]),
    list('fild', [...S.fills.values()].map((f) => f.node)), list('outl', [...S.outls.values()].map((o) => o.node)),
    list('font', [...S.fonts.values()].map((f) => f.node)), list('bmpt', S.bmps)])
  const top = [leaf('vrsn', new W(2).u16(VERSION).out), leaf('DISP', await preview(pages[0])), docNode, master, ...pageNodes.map((p) => p.node)]
  for (const n of top) measure(n)
  const body = compress ? [top[0], top[1], await compressed(top.slice(2))] : top
  let size = 4
  for (const n of body) size += measure(n)
  if (size > 0xfffffff0) throw new Error('This drawing is too large for the CDR format (4 GB limit). Try a lower image resolution.')
  const parts = [header('RIFF', size), asc('CDRD')]
  for (const n of body) emit(n, parts)
  check(); progress(1, 'Done')

  const notes = [COMPAT_NOTE, 'Colours are written as RGB.']
  if (S.bmps.length && !compress) notes.push('Bitmaps are stored uncompressed, so files with photos can be large.')
  if (layerNotes.length) notes.push(`Layer visibility, locking and printing settings are not stored because the file format does not document them publicly: ${layerNotes.map((n) => `"${n}"`).join(', ')} ${layerNotes.length === 1 ? 'is' : 'are'} written as a normal layer.`)
  if (nGuides) notes.push(`Guides (${nGuides}) are not written.`)
  if (nHidden) notes.push(`Hidden objects (${nHidden}) were left out.`)
  if (nLocked) notes.push(`Locked objects (${nLocked}) are written unlocked.`)
  if (nSolidRule) notes.push(`Combined paths with the non-zero fill rule (${nSolidRule} objects) are written with the even-odd rule, so overlapping parts can look different.`)
  for (const t of counts.keys()) notes.push(t)
  return { blob: new Blob(parts, { type: 'application/octet-stream' }), notes }
}

// ---------- text to curves ----------
const hasText = (items) => items.some((it) => it?.t === 'text' || (it?.t === 'group' && hasText(it.items || [])))
async function outlineText(pages, fonts, check, say) {
  let outlineDoc
  try { ({ outlineDoc } = await import('./_text.js')) } catch { say('Text could not be converted to curves and is written as live text.'); return pages }
  const lists = async (items) => {
    const out = []
    for (const it of items) out.push(it?.t === 'group' ? { ...it, items: await lists(it.items || []) } : it)
    if (!out.some((x) => x?.t === 'text')) return out
    check()
    const pseudo = { pages: [{ items: out }], fonts }
    try {
      const r = await outlineDoc(pseudo)
      if (r.kept) say('Some text could not be converted to curves and is written as live text.')
      return pseudo.pages[0].items
    } catch { say('Text could not be converted to curves and is written as live text.'); return out }
  }
  const res = []
  for (const p of pages) {
    const layers = []
    for (const l of p.layers) layers.push({ ...l, items: await lists(l.items || []) })
    res.push({ ...p, layers })
  }
  return res
}

// ---------- preview bitmap ----------
/** A small bitmap of the first page (solid colours only, drawn with a canvas when there is one, else a blank sheet). */
async function preview(page) {
  const canvas = typeof OffscreenCanvas !== 'undefined' && typeof Path2D !== 'undefined'
  const sc = Math.min(1, (canvas ? 200 : 48) / Math.max(page.w, page.h)), w = Math.max(1, Math.round(page.w * sc)), h = Math.max(1, Math.round(page.h * sc))
  let rgba = null
  try {
    if (canvas) {
      const cv = new OffscreenCanvas(w, h), g = cv.getContext('2d', { willReadFrequently: true })
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h)
      g.setTransform(sc, 0, 0, sc, 0, 0)
      let n = 0
      const paint = (items) => {
        for (const it of items) {
          if (n > 4000) return
          if (it.t === 'group') { paint(it.items || []); continue }
          n++
          if (it.t === 'path') {
            const p = new Path2D(it.d.map((c) => c[0] + c.slice(1).join(' ')).join(' '))
            const f = typeof it.fill === 'object' && it.fill ? it.fill.stops?.[0]?.c : it.fill
            g.globalAlpha = it.fillOpacity ?? 1
            if (f) { g.fillStyle = f; g.fill(p, it.rule === 'evenodd' ? 'evenodd' : 'nonzero') }
            if (it.stroke && it.strokeWidth > 0) { g.globalAlpha = it.strokeOpacity ?? 1; g.strokeStyle = it.stroke; g.lineWidth = Math.max(it.strokeWidth, 1 / sc); g.stroke(p) }
          } else if (it.t === 'image' || it.t === 'text') {
            const b = itemBBox(it)
            if (b) { g.globalAlpha = 0.25; g.fillStyle = '#808080'; g.fillRect(b.x, b.y, b.w, b.h) }
          }
        }
      }
      for (const l of page.layers) if (!l.hidden) paint(l.items || [])
      rgba = g.getImageData(0, 0, w, h).data
    }
  } catch { rgba = null }
  const stride = ((w * 24 + 31) >> 5) << 2, px = new Uint8Array(stride * h).fill(255)
  if (rgba) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = (h - 1 - y) * stride + x * 3; px[d] = rgba[s + 2]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s] }
  return new W(px.length + 64).u32(0).u32(40).u32(w).u32(h).u16(1).u16(24).u32(0).u32(px.length).u32(0).u32(0).u32(0).u32(0).put(px).out
}
