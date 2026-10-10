// CorelDRAW (.cdr / .cdt) reader, written from the public description of the CDR format.
// DOM-free, so it also runs in Node for tests.
//
// Supported containers: RIFF files tagged CDR (CorelDRAW 7 to X3), zlib-compressed 'cmpr' lists, and the ZIP container of X4 and later
// (content/riffData.cdr for X4/X5, content/root.dat with external data streams for X6 and later).
//
// readCdr(bytes, {JSZip}) -> {
//   version, container, truncated, warnings,
//   pages: [{name, master, w, h (inches), layers: [{name, type, objects: [Node]}]}],
//   preview: {mime, bytes} | null
// }
// Node: {id, kind: 'rect'|'ellipse'|'path'|'text'|'bitmap'|'group'|'unknown', name, m (matrix, inches, y up), bbox, fill, line, opacity, geom, children}
// Coordinates inside a node are inches in the object's own frame, y up; m maps them to the page frame (origin at the page centre).

class Reader {
  constructor(b) { this.b = b; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); this.p = 0 }
  get left() { return this.b.length - this.p }
  need(n) { if (this.p + n > this.b.length) throw new RangeError('read past end') }
  u8() { this.need(1); return this.b[this.p++] }
  u16() { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v }
  u32() { this.need(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v }
  i32() { this.need(4); const v = this.dv.getInt32(this.p, true); this.p += 4; return v }
  f64() { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v }
  skip(n) { this.need(n); this.p += n }
  bytes(n) { this.need(n); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v }
  at(p) { this.p = p; return this }
}
const ascii = (b, o = 0, n = 4) => String.fromCharCode(...b.subarray(o, o + n))
const INCH = 254000 // coordinates are stored in 1/254000 inch

/** CDR version number (700 = CorelDRAW 7, 1300 = X3 ...) from the RIFF form tag, as in the format description. */
export function versionFromTag(tag) {
  const form = tag.slice(0, 3), c = tag.charCodeAt(3)
  if (form === 'cdr' && c === 0x38) return 801
  if (c === 0x20) return 300
  if (c < 0x31) return 0
  if (c < 0x3a) return 100 * (c - 0x30)
  if (c < 0x41) return 0
  if (c < 0x49) return 100 * (c - 0x37)
  if (c === 0x49) return 0
  return 100 * (c - 0x38)
}
export const versionName = (v) => (v >= 1400 ? `CorelDRAW X${v / 100 - 10}` : v === 1300 ? 'CorelDRAW X3' : `CorelDRAW ${Math.floor(v / 100)}`)

export async function inflate(u8) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate')
    const w = ds.writable.getWriter()
    w.write(u8).catch(() => {}); w.close().catch(() => {})
    return new Uint8Array(await new Response(ds.readable).arrayBuffer())
  }
  const { pako } = await import('./_libs.js')
  return (await pako()).inflate(u8)
}

// ---------- RIFF chunk tree ----------
/** Chunk: {id, body, form?, children?} */
async function readChunks(bytes, ctx, depth) {
  const out = []
  let p = 0
  while (p + 8 <= bytes.length) {
    const id = ascii(bytes, p), len = new DataView(bytes.buffer, bytes.byteOffset + p + 4, 4).getUint32(0, true)
    let body = bytes.subarray(p + 8, p + 8 + len)
    if (p + 8 + len > bytes.length) ctx.truncated = true
    p += 8 + len + (len & 1)
    if (ctx.version >= 1600 && body.length === 16) body = resolveExternal(body, ctx)
    out.push(await makeChunk(id, body, ctx, depth))
  }
  return out
}
function resolveExternal(body, ctx) {
  const r = new Reader(body)
  const stream = r.u32(), len = r.u32()
  if (stream === 0xffffffff) return body.subarray(8, 8 + len)
  const ofs = r.u32()
  const s = ctx.streams?.[stream]
  if (!s) { ctx.warn(`A data stream (${stream}) of this X6 or later file is missing.`); return new Uint8Array(0) }
  return s.subarray(ofs, ofs + len)
}
async function makeChunk(id, body, ctx, depth) {
  const c = { id, body }
  if (id !== 'LIST' && id !== 'RIFF') return c
  if (body.length < 4) return c
  c.form = ascii(body, 0)
  const rest = body.subarray(4)
  if (depth > 40) return c
  if (c.form === 'cmpr') c.children = await readCompressed(rest, ctx, depth + 1)
  else if (c.form === 'stlt' && ctx.version >= 700) c.children = []
  else c.children = await readChunks(rest, ctx, depth + 1)
  return c
}
async function readCompressed(b, ctx, depth) {
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const c0 = dv.getUint32(0, true), c1 = dv.getUint32(8, true)
    const first = b.subarray(16, 16 + c0), second = b.subarray(16 + c0, 16 + c0 + c1)
    if (ascii(first, 0) !== 'CPng' || ascii(second, 0) !== 'CPng') throw new Error('bad cmpr')
    const data = await inflate(first.subarray(8)), sizes = await inflate(second.subarray(8))
    const sz = new DataView(sizes.buffer, sizes.byteOffset, sizes.byteLength)
    ctx.compressed = true
    return readCompList(data, sz, ctx, depth)
  } catch (e) {
    ctx.warn('Part of this file is compressed and could not be unpacked (the file may be damaged).')
    ctx.failed = true
    return []
  }
}
async function readCompList(bytes, sizes, ctx, depth) {
  const out = []
  let p = 0
  while (p + 8 <= bytes.length) {
    const id = ascii(bytes, p), idx = new DataView(bytes.buffer, bytes.byteOffset + p + 4, 4).getUint32(0, true)
    if (idx * 4 + 4 > sizes.byteLength) { ctx.truncated = true; break }
    const len = sizes.getUint32(idx * 4, true)
    const body = bytes.subarray(p + 8, p + 8 + len)
    if (p + 8 + len > bytes.length) ctx.truncated = true
    p += 8 + len + (len & 1)
    const c = { id, body }
    if (id === 'LIST' && body.length >= 4) {
      c.form = ascii(body, 0)
      c.children = c.form === 'stlt' && ctx.version >= 700 ? [] : depth > 40 ? [] : await readCompList(body.subarray(4), sizes, ctx, depth + 1)
    }
    out.push(c)
  }
  return out
}

// ---------- values ----------
const coord = (r) => r.i32() / INCH
const angle = (r) => r.i32() / 1e6 // degrees

/** {model, vals[4]} -> '#rrggbb' (approximate for spot and palette models). */
export function colorToHex(model, v) {
  const clamp = (x) => Math.max(0, Math.min(255, Math.round(x)))
  const rgb = (r, g, b) => '#' + [r, g, b].map((x) => clamp(x).toString(16).padStart(2, '0')).join('')
  const cmyk = (c, m, y, k) => rgb(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k))
  switch (model) {
    case 5: case 21: return rgb(v[2], v[1], v[0]) // bgr (and bgr with tint): blue, green, red
    case 2: case 25: return cmyk(v[0] / 100, v[1] / 100, v[2] / 100, v[3] / 100) // cmyk 0..100 (spot colours approximated)
    case 3: case 17: return cmyk(v[0] / 255, v[1] / 255, v[2] / 255, v[3] / 255)
    case 4: return cmyk(v[0] / 255, v[1] / 255, v[2] / 255, 0) // cmy
    case 9: return rgb(v[0], v[0], v[0]) // grayscale
    case 8: return v[0] ? '#000000' : '#ffffff' // bw
    case 6: { // hsb: hue u16 degrees, saturation, brightness (0..255)
      const h = (v[0] | (v[1] << 8)) % 360, s = v[2] / 255, b = v[3] / 255
      const f = (n) => { const k = (n + h / 60) % 6; return b - b * s * Math.max(0, Math.min(k, 4 - k, 1)) }
      return rgb(255 * f(5), 255 * f(3), 255 * f(1))
    }
    case 7: { // hls
      const h = (v[0] | (v[1] << 8)) % 360, l = v[2] / 255, s = v[3] / 255
      const a = s * Math.min(l, 1 - l)
      const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)) }
      return rgb(255 * f(0), 255 * f(8), 255 * f(4))
    }
    case 12: case 18: { // CIE Lab: L 0..255 -> 0..100, a and b signed (model 12) or offset by 128 (model 18)
      const L = (v[0] * 100) / 255, a = model === 18 ? v[1] - 128 : (v[1] << 24) >> 24, b = model === 18 ? v[2] - 128 : (v[2] << 24) >> 24
      const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200
      const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787)
      const X = 0.9642 * f(fx), Y = f(fy), Z = 0.8249 * f(fz) // D50
      const lin = [3.1339 * X - 1.6169 * Y - 0.4906 * Z, -0.9788 * X + 1.9161 * Y + 0.0335 * Z, 0.0719 * X - 0.229 * Y + 1.4052 * Z]
      const g = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055)
      return rgb(g(lin[0]), g(lin[1]), g(lin[2]))
    }
    case 11: { // yiq
      const y = v[0], i = v[1] - 128, q = v[2] - 128
      return rgb(y + 0.956 * i + 0.621 * q, y - 0.272 * i - 0.647 * q, y - 1.106 * i + 1.703 * q)
    }
    case 20: return '#000000' // registration
    default: return null
  }
}
function readColor(r, ctx) {
  const model = r.u16(); r.skip(2 + 4) // palette, unknown
  const v = [r.u8(), r.u8(), r.u8(), r.u8()]
  const hex = colorToHex(model, v)
  if (!hex) { ctx.warn(`A colour model (${model}) used by this file is approximated as grey.`); return '#808080' }
  if (model === 1 || model === 14 || model === 25) ctx.approx.add('Spot and Pantone colours are approximated.')
  return hex
}

// ---------- fills, outlines, bitmaps ----------
function parseFild(body, ctx) {
  const r = new Reader(body)
  const id = r.u32()
  let end = body.length
  if (ctx.version >= 1300) { r.u32(); const len = r.u32(); end = Math.min(body.length, r.p + len) }
  const type = r.u16()
  if (type === 0) return { id, fill: { type: 'none' } }
  if (type === 1) {
    let color = null
    if (ctx.version < 1300) { r.skip(2); color = readColor(r, ctx) }
    else {
      r.u32(); const len = r.u32(); const stop = Math.min(end, r.p + len)
      while (r.p + 5 <= stop && !color) {
        const t = r.u8(), l = r.u32()
        if (t === 0) break
        if (t === 1 && l >= 12) color = readColor(new Reader(r.bytes(l)), ctx)
        else r.skip(l)
      }
    }
    return { id, fill: color ? { type: 'solid', color } : { type: 'unsupported', note: 'solid fill' } }
  }
  if (type === 2) {
    try { return { id, fill: parseGradient(r, ctx) } } catch { return { id, fill: { type: 'unsupported', note: 'gradient' } } }
  }
  ctx.approx.add('Pattern, texture and bitmap fills are shown as plain grey.')
  return { id, fill: { type: 'unsupported', note: 'pattern' } }
}
function parseGradient(r, ctx) {
  const v = ctx.version
  r.skip(v >= 1300 ? 8 : 2)
  const kind = r.u8()
  r.skip(v >= 1300 ? 17 : v >= 600 ? 19 : 11)
  if (v >= 600 && v < 1300) r.i32(); else r.skip(2)
  const ang = angle(r)
  r.skip(8) // centre offsets
  if (v >= 600) r.skip(2)
  r.skip(4); r.u8(); r.skip(1)
  const n = r.u32() & 0xffff
  if (v >= 1300) r.skip(3)
  const stops = []
  for (let i = 0; i < n && i < 64; i++) {
    const c = readColor(r, ctx)
    r.skip(v >= 1500 ? 26 : v >= 1300 ? 5 : 0)
    const o = (r.u32() & 0xffff) / 10000
    if (v >= 1300) r.skip(3)
    stops.push({ o: Math.max(0, Math.min(1, o)), c })
  }
  if (stops.length < 2) throw new Error('no stops')
  return { type: 'gradient', kind: kind === 2 ? 'radial' : 'linear', angle: ang, stops }
}
function parseOutl(body, ctx) {
  const r = new Reader(body)
  const id = r.u32(), v = ctx.version
  if (v >= 1300) { for (;;) { const sid = r.u32(), len = r.u32(); if (sid !== 1) r.skip(len); else break } }
  const lineType = r.u16(), caps = r.u16(), join = r.u16()
  if (v < 1300 && v >= 600) r.skip(2)
  const width = coord(r)
  r.skip(2) // stretch
  if (v >= 600) r.skip(2)
  r.skip(4) // angle
  r.skip(v >= 1300 ? 46 : v >= 600 ? 52 : 0)
  const color = readColor(r, ctx)
  r.skip(v < 600 ? 10 : 16)
  let nd = r.u16()
  const dashAt = r.p
  const maxd = Math.floor((r.left) / 2)
  nd = Math.min(nd, maxd)
  const dash = []
  for (let i = 0; i < nd; i++) dash.push(r.at(dashAt + i * 2).u16())
  return { id, line: { none: !!(lineType & 1), width, color, dash: lineType & 2 && dash.length ? dash : null, cap: caps === 1 ? 1 : caps === 2 ? 2 : 0, join: join === 1 ? 1 : join === 2 ? 2 : 0 } }
}
function parseBmp(body, ctx) {
  const r = new Reader(body)
  const id = r.u32()
  r.skip(ctx.version < 600 ? 14 : ctx.version < 700 ? 46 : 50)
  const model = r.u32(); r.skip(4)
  const w = r.u32(), h = r.u32(); r.skip(4)
  const bpp = r.u32(); r.skip(4)
  const size = r.u32(); r.skip(32)
  let pal = null
  if (bpp < 24 && model !== 5 && model !== 6) {
    r.skip(2)
    const n = Math.min(r.u16(), Math.floor(r.left / 3))
    pal = []
    for (let i = 0; i < n; i++) { const b = r.u8(), g = r.u8(), rr = r.u8(); pal.push([rr, g, b]) }
  }
  const px = body.subarray(r.p, r.p + size)
  if (!w || !h || w > 16384 || h > 16384) throw new Error('bad bitmap size')
  // rows are padded to 4 bytes and stored bottom-up
  const stride = ((w * bpp + 31) >> 5) << 2
  if (px.length < stride * h) throw new Error('short bitmap')
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * stride
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      let R = 0, G = 0, B = 0, A = 255
      if (bpp === 24) { B = px[row + x * 3]; G = px[row + x * 3 + 1]; R = px[row + x * 3 + 2] }
      else if (bpp === 32) {
        const a = px[row + x * 4], b2 = px[row + x * 4 + 1], c2 = px[row + x * 4 + 2], d2 = px[row + x * 4 + 3]
        if (model === 2 || model === 3 || model === 17) { const k = d2 / 255; R = 255 * (1 - a / 255) * (1 - k); G = 255 * (1 - b2 / 255) * (1 - k); B = 255 * (1 - c2 / 255) * (1 - k) } else { B = a; G = b2; R = c2; A = d2 || 255 }
      } else if (bpp === 8) { const i = px[row + x]; if (pal) [R, G, B] = pal[i] || [0, 0, 0]; else R = G = B = i }
      else if (bpp === 1) { const bit = (px[row + (x >> 3)] >> (7 - (x & 7))) & 1; if (pal?.length >= 2) [R, G, B] = pal[bit]; else R = G = B = bit ? 255 : 0 }
      else if (bpp === 4) { const byte = px[row + (x >> 1)], i = x & 1 ? byte & 15 : byte >> 4; if (pal) [R, G, B] = pal[i] || [0, 0, 0]; else R = G = B = i * 17 }
      else throw new Error('unsupported bitmap depth')
      rgba[o] = R; rgba[o + 1] = G; rgba[o + 2] = B; rgba[o + 3] = A
    }
  }
  return { id, bmp: { w, h, rgba } }
}

/** Turn a DISP chunk (a device-independent bitmap without its file header) into a BMP file. */
export function dispToBmp(body) {
  if (body.length < 4 + 40) return null
  const dib = body.subarray(4)
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength)
  const hs = dv.getUint32(0, true), bpp = dv.getUint16(14, true), comp = dv.getUint32(16, true)
  let colors = dv.getUint32(32, true)
  if (hs < 40 || hs > 124) return null
  if (!colors && bpp <= 8) colors = 1 << bpp
  const off = 14 + hs + colors * 4 + (comp === 3 && hs === 40 ? 12 : 0)
  const out = new Uint8Array(14 + dib.length)
  out.set([0x42, 0x4d]); new DataView(out.buffer).setUint32(2, out.length, true); new DataView(out.buffer).setUint32(10, off, true)
  out.set(dib, 14)
  return out
}

// ---------- objects ----------
function parseLoda(body, ctx) {
  const r = new Reader(body)
  r.skip(4) // chunk length
  const n = r.u32(), startArgs = r.u32(), startTypes = r.u32(), chunkType = r.u32()
  if (n > 400) throw new RangeError('too many arguments')
  const offs = [], types = []
  for (let i = 0; i <= n; i++) offs.push(r.at(startArgs + i * 4).u32())
  for (let i = 0; i < n; i++) types.push(r.at(startTypes + i * 4).u32())
  const args = []
  for (let i = 0; i < n; i++) args.push({ type: types[n - 1 - i], body: body.subarray(offs[i], Math.max(offs[i], offs[i + 1])) })
  return { chunkType, args }
}
function pointsList(r, count) {
  const start = r.p
  const maxN = Math.floor((r.left) / 9)
  const n = Math.min(count, maxN)
  const pts = []
  for (let i = 0; i < n; i++) pts.push([r.at(start + i * 8).i32() / INCH, r.i32() / INCH])
  const types = []
  for (let i = 0; i < n; i++) types.push(r.at(start + n * 8 + i).u8())
  return pts.map((p, i) => ({ x: p[0], y: p[1], op: (types[i] & 0xc0) >> 6, close: !!(types[i] & 8) }))
}
/** Path commands (inches, y up) from CDR points: 0 move, 1 line, 2 cubic end (preceded by two controls), 3 control. */
function pointsToPath(pts) {
  const d = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p.op === 0) d.push(['M', p.x, p.y])
    else if (p.op === 1) { d.push(['L', p.x, p.y]); if (p.close) d.push(['Z']) }
    else if (p.op === 2) {
      const a = pts[i - 2], b = pts[i - 1]
      if (a && b && a.op === 3 && b.op === 3) d.push(['C', a.x, a.y, b.x, b.y, p.x, p.y]); else d.push(['L', p.x, p.y])
      if (p.close) d.push(['Z'])
    }
  }
  // a move that closes the subpath is only a flag: close any subpath that has a closing point but no explicit Z handled above
  return d
}
function parseGeom(chunkType, b, ctx) {
  const r = new Reader(b), v = ctx.version
  if (chunkType === 1) {
    const rc = () => (v < 1500 ? coord(r) : r.f64() / INCH)
    const w = Math.abs(rc()), h = Math.abs(rc())
    let radii = [0, 0, 0, 0]
    if (v < 1500) { if (v >= 900) { const r3 = coord(r), r2 = coord(r), r1 = coord(r), r0 = coord(r); radii = [r3, r2, r1, r0] } else radii = [coord(r), 0, 0, 0] }
    else {
      const sx = r.f64(), sy = r.f64(), sw = r.u8(); r.skip(7)
      const sc = sw === 0 ? 1 : INCH
      const r3 = r.f64() * sc; r.u8(); r.skip(15); const r2 = r.f64() * sc; r.skip(16); const r1 = r.f64() * sc; r.skip(16); const r0 = r.f64() * sc
      void sx; void sy
      radii = [r3, r2, r1, r0]
    }
    return { kind: 'rect', w, h, radii: radii.map((x) => Math.abs(x) || 0) }
  }
  if (chunkType === 2) {
    const x = coord(r), y = coord(r), a1 = angle(r), a2 = angle(r), pie = r.u32()
    return { kind: 'ellipse', cx: x / 2, cy: y / 2, rx: Math.abs(x / 2), ry: Math.abs(y / 2), a1, a2, pie: pie !== 0 }
  }
  if (chunkType === 3 || chunkType === 0x14) {
    const n = r.u32()
    return { kind: 'path', d: pointsToPath(pointsList(r, n)), closed: chunkType === 0x14 }
  }
  if (chunkType === 0x25) {
    r.skip(4); const n1 = r.u16(), n2 = r.u16(); r.skip(16)
    return { kind: 'path', d: pointsToPath(pointsList(r, n1 + n2)), closed: false }
  }
  if (chunkType === 4) return { kind: 'text', x: coord(r), y: coord(r) }
  if (chunkType === 5) {
    const x1 = coord(r), y1 = coord(r), x2 = coord(r), y2 = coord(r)
    r.skip(32)
    const image = r.u32()
    return { kind: 'bitmap', x1, y1, x2, y2, image }
  }
  if (chunkType === 6) { r.skip(4); return { kind: 'unknown', note: 'paragraph text', w: coord(r), h: coord(r) } }
  return { kind: 'unknown', note: `object type ${chunkType}` }
}
function parseTrfd(body, ctx) {
  const r = new Reader(body)
  r.skip(4)
  const n = r.u32(), start = r.u32()
  const ms = []
  for (let i = 0; i < n; i++) {
    const off = r.at(start + i * 4).u32()
    const rr = new Reader(body).at(off + (ctx.version >= 1300 ? 8 : 0))
    const t = rr.u16()
    if (t === 0x08 && ctx.version >= 500) {
      if (ctx.version >= 600) rr.skip(6)
      const a = rr.f64(), c = rr.f64(), tx = rr.f64() / (ctx.version < 600 ? 1000 : INCH), b = rr.f64(), d = rr.f64(), ty = rr.f64() / (ctx.version < 600 ? 1000 : INCH)
      ms.push([a, b, c, d, tx, ty])
    }
  }
  return ms
}
const mulM = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]

const winDecode = (b, utf16) => { try { return new TextDecoder(utf16 ? 'utf-16le' : 'windows-1252').decode(b).replace(/\0+$/, '') } catch { return '' } }
/** Text of a txsm chunk (CorelDRAW 7 to 15 layout): {text, size, fillId, fontId, bold, italic}. */
function parseTxsm(body, ctx) {
  const v = ctx.version
  if (v >= 1600 || v < 700) throw new Error('unsupported text layout')
  const r = new Reader(body)
  const frameFlag = r.u32() !== 0
  r.skip(32)
  if (v >= 1500) r.skip(1)
  if (v < 800) { const top = r.u32() !== 0; if (top) r.skip(32) }
  const nf = r.u32()
  for (let i = 0; i < nf; i++) {
    r.u32(); r.skip(48)
    if (v >= 800) { const top = r.u32() !== 0; if (top) { r.skip(4); if (v >= 1300) r.skip(8); r.skip(28); if (v >= 1500) r.skip(8) } else if (v >= 1500) r.skip(8) }
    if (!frameFlag) r.skip(v >= 1500 ? 40 : v >= 1400 ? 36 : v >= 801 ? 34 : v === 800 ? 32 : 36)
    else if (v >= 1500) r.skip(4)
  }
  const np = r.u32()
  const info = { text: '', size: 0, fillId: null, fontId: null, bold: false, italic: false }
  const lines = []
  for (let i = 0; i < np; i++) {
    r.u32(); r.skip(1)
    if (v >= 1300 && frameFlag) r.skip(1)
    const ns = r.u32()
    for (let s = 0; s < ns; s++) {
      r.u16()
      const fl = r.u8() | 0
      const flags = fl
      const fl3 = v >= 800 ? r.u8() : 0
      if (flags & 1) { const fid = r.u16(); r.u16(); if (info.fontId == null) info.fontId = fid }
      if (flags & 2) { const sf = r.u32() & 0x3ffff; if (!info.bold && sf & 0x3f000) info.bold = true; if (!info.italic && sf & 0x2aaaa) info.italic = true }
      if (flags & 4) { const sz = coord(r); if (!info.size) info.size = sz }
      if (flags & 8) r.skip(4)
      if (flags & 0x10) r.skip(4)
      if (flags & 0x20) r.skip(4)
      if (flags & 0x40) { const f = r.u32(); if (info.fillId == null) info.fillId = f; if (v >= 1300) r.skip(48) }
      if (flags & 0x80) r.skip(4)
      if (fl3 & 0x02) { const n = r.u32(); r.skip(v < 1700 ? n * 2 : n) }
      if (fl3 & 0x08) { if (v < 1300) r.skip(4); else { const n = r.u32(); r.skip(n * 2) } }
      if (fl3 & 0x20 && r.b[r.p] !== 0) r.skip(v >= 1500 ? 52 : 4)
    }
    const nc = r.u32()
    r.skip(nc * (v >= 1200 ? 8 : 4))
    const nb = v >= 1200 ? r.u32() : nc
    lines.push(winDecode(r.bytes(nb), v >= 1200))
    const hasPath = r.u8() !== 0
    if (hasPath) r.skip(nc * 24)
  }
  info.text = lines.join('\n')
  return info
}
// last resort for text: longest run of printable characters in the chunk
function scanText(body, ctx) {
  const s = ctx.version >= 1200 ? new TextDecoder('utf-16le').decode(body.subarray(0, body.length & ~1)) : new TextDecoder('windows-1252').decode(body)
  const m = s.match(/[\p{L}\p{N}\p{P}\p{Zs}]{3,}/gu)
  return m ? m.sort((a, b) => b.length - a.length)[0].trim() : ''
}

function readFlags(chunk) {
  const f = chunk.children?.find((c) => c.id === 'flgs')?.body
  return f && f.length >= 4 ? { type: f[3], f2: f[2], f0: f[0] } : null
}
const FORM = { page: 'page', 'layr': 'layer', 'grp ': 'group', 'obj ': 'object' }
const BY_FLAG = { 0x90: 'page', 0x98: 'layer', 0x10: 'group', 0x08: 'object' }
const classify = (c) => FORM[c.form] || BY_FLAG[readFlags(c)?.type]
const SKIP_LISTS = new Set(['fild', 'outl', 'font', 'bmpt', 'stlt', 'vect', 'arrw', 'styd', 'ptrt'])

/**
 * Read a .cdr (or .cdt) file. Never throws for damaged files: returns what could be read plus warnings, and `failed: true` when no page was found.
 */
export async function readCdr(input, { JSZip } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const warnings = []
  const approx = new Set()
  const ctx = { version: 0, truncated: false, failed: false, streams: null, compressed: false, approx, warn: (s) => { if (!warnings.includes(s)) warnings.push(s) } }
  const res = { container: 'riff', version: 0, versionName: '', pages: [], preview: null, warnings, truncated: false, failed: false, stats: {} }
  let riff = bytes
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // ZIP: X4 and later
    if (!JSZip) { res.failed = true; warnings.push('This is a ZIP-based file (CorelDRAW X4 or newer) and the ZIP reader is not available.'); return res }
    let zip
    try { zip = await JSZip.loadAsync(bytes) } catch { res.failed = true; warnings.push('This file looks like a ZIP archive but could not be unpacked.'); return res }
    res.container = 'zip'
    const find = (re) => Object.keys(zip.files).find((n) => re.test(n) && !zip.files[n].dir)
    const thumb = find(/(^|\/)thumbnails?\/thumbnail\.(png|jpe?g)$/i) || find(/thumbnail\.(png|jpe?g)$/i)
    if (thumb) res.preview = { mime: /png$/i.test(thumb) ? 'image/png' : 'image/jpeg', bytes: await zip.files[thumb].async('uint8array') }
    const rd = find(/content\/riffData\.cdr$/i)
    const root = find(/content\/root\.dat$/i)
    if (rd) riff = await zip.files[rd].async('uint8array')
    else if (root) {
      riff = await zip.files[root].async('uint8array')
      res.container = 'zip-x6'
      const list = find(/content\/dataFileList\.dat$/i)
      const names = list ? (await zip.files[list].async('string')).split(/[\r\n\0]+/).map((s) => s.trim()).filter(Boolean) : []
      ctx.streams = []
      for (const n of names) {
        const key = Object.keys(zip.files).find((k) => k === n || k.endsWith('/' + n) || k.endsWith('/' + n.split(/[\\/]/).pop()))
        ctx.streams.push(key ? await zip.files[key].async('uint8array') : null)
      }
    } else { res.failed = true; warnings.push('This ZIP archive has no CorelDRAW drawing data inside.'); return res }
  }
  if (riff.length < 12 || ascii(riff, 0) !== 'RIFF') { res.failed = true; warnings.push('This does not look like a CorelDRAW file (no RIFF header).'); return res }
  const tag = ascii(riff, 8)
  if (!/^(CDR|cdr)/.test(tag)) { res.failed = true; warnings.push(tag === 'CDRX' ? 'This is a CorelDRAW Exchange (CCX) file, not a drawing.' : `This RIFF file is not a CorelDRAW drawing (form type "${tag}").`); return res }
  ctx.version = versionFromTag(tag)
  const declared = new DataView(riff.buffer, riff.byteOffset, riff.byteLength).getUint32(4, true)
  if (declared + 8 > riff.length) ctx.truncated = true
  let root
  try {
    const body = riff.subarray(12, Math.min(riff.length, 8 + declared))
    root = { id: 'RIFF', form: tag, children: await readChunks(body, ctx, 1) }
  } catch (e) {
    res.failed = true; warnings.push('The file structure could not be read.'); return res
  }
  // the version chunk is authoritative when present
  const find1 = (id, list = root.children) => { for (const c of list) { if (c.id === id) return c; const f = c.children && find1(id, c.children); if (f) return f } return null }
  const vr = find1('vrsn')
  res.version = ctx.version || (vr ? new DataView(vr.body.buffer, vr.body.byteOffset, vr.body.byteLength).getUint16(0, true) : 0)
  ctx.version = res.version
  res.versionName = versionName(res.version)
  res.truncated = ctx.truncated
  if (ctx.truncated) warnings.push('The file ends early, so it may be truncated or damaged.')
  // preview (RIFF DISP)
  const disp = find1('DISP')
  if (disp && !res.preview) { const bmp = dispToBmp(disp.body); if (bmp) res.preview = { mime: 'image/bmp', bytes: bmp } }
  if (res.version < 700) { res.failed = true; warnings.push(`${res.versionName} files are older than the versions this viewer reads (CorelDRAW 7 and newer).`); return res }
  if (res.version >= 1600 && !ctx.streams) { res.failed = true; warnings.push('This CorelDRAW X6 or newer file keeps its content in separate data streams that were not found.'); return res }

  // global tables
  const fills = new Map(), outls = new Map(), bmps = new Map(), fonts = new Map()
  let mcfg = null
  const collect = (list) => {
    for (const c of list) {
      try {
        if (c.id === 'fild' || c.id === 'fill') { const f = parseFild(c.body, ctx); fills.set(f.id, f.fill) }
        else if (c.id === 'outl') { const o = parseOutl(c.body, ctx); outls.set(o.id, o.line) }
        else if (c.id === 'bmp ') { try { const b = parseBmp(c.body, ctx); bmps.set(b.id, b.bmp) } catch { ctx.warn('An embedded bitmap could not be decoded.') } }
        else if (c.id === 'font') { const r = new Reader(c.body); const fid = r.u16(); r.skip(2 + 4 + 10); fonts.set(fid, winDecode(r.bytes(r.left), ctx.version >= 1200).replace(/\0.*$/s, '')) }
        else if (c.id === 'mcfg' && !mcfg) {
          const r = new Reader(c.body)
          r.skip(ctx.version >= 1300 ? 12 : ctx.version >= 900 ? 4 : 0)
          mcfg = { w: coord(r), h: coord(r) }
        }
      } catch (e) { /* damaged table entry: skip */ }
      if (c.children) collect(c.children)
    }
  }
  collect(root.children)
  ctx.fills = fills; ctx.outls = outls; ctx.bmps = bmps; ctx.fonts = fonts

  // pages
  let nextId = 1
  const pages = []
  const newPage = (master = false) => { const p = { name: '', master, w: mcfg?.w || 0, h: mcfg?.h || 0, layers: [] }; pages.push(p); return p }
  const layerOf = (page, type = 0, name = '') => { const l = { name, type, objects: [] }; page.layers.push(l); return l }
  const resolveFill = (id) => (id == null ? null : fills.get(id) ?? null)
  const resolveLine = (id) => (id == null ? null : outls.get(id) ?? null)
  const argsOf = (loda) => {
    const out = { fillId: null, lineId: null, name: '', opacity: 1, geom: null, pageSize: null }
    for (const a of loda.args) {
      try {
        const r = new Reader(a.body)
        if (a.type === 20 && ctx.version >= 400) out.fillId = r.u32()
        else if (a.type === 10 && ctx.version >= 400) out.lineId = r.u32()
        else if (a.type === 1000) out.name = winDecode(a.body, ctx.version >= 1200)
        else if (a.type === 8000) { r.skip(ctx.version < 1300 ? 10 : 14); out.opacity = r.u16() / 1000 }
        else if (a.type === 19130) out.pageSize = { w: coord(r), h: coord(r) }
        else if (a.type === 30) out.geom = a.body
      } catch { /* skip */ }
    }
    return out
  }
  const makeObject = (c) => {
    const node = { id: nextId++, kind: 'unknown', name: '', m: null, bbox: null, fill: null, line: null, opacity: 1, geom: null }
    const loda = c.children.find((x) => x.id === 'loda' || x.id === 'lobj')
    if (!loda) return null
    let L
    try { L = parseLoda(loda.body, ctx) } catch { ctx.warn('An object description could not be read.'); return null }
    const a = argsOf(L)
    node.name = a.name; node.opacity = a.opacity
    node.fill = resolveFill(a.fillId); node.line = resolveLine(a.lineId)
    try { node.geom = a.geom ? parseGeom(L.chunkType, a.geom, ctx) : { kind: 'unknown', note: 'no geometry' } } catch { node.geom = { kind: 'unknown', note: 'geometry could not be read' } }
    node.kind = node.geom.kind
    const t = c.children.find((x) => x.id === 'trfd')
    if (t) { try { const ms = parseTrfd(t.body, ctx); if (ms.length) node.m = ms[0] } catch { /* identity */ } }
    const bb = c.children.find((x) => x.id === 'bbox')
    if (bb && bb.body.length >= 16) { const r = new Reader(bb.body); const x0 = coord(r), y0 = coord(r), x1 = coord(r), y1 = coord(r); node.bbox = { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) } }
    if (node.kind === 'text') {
      const tx = c.children.find((x) => x.id === 'txsm')
      let info = null
      if (tx) { try { info = parseTxsm(tx.body, ctx) } catch { info = { text: scanText(tx.body, ctx), size: 0, fillId: null, fontId: null, bold: false, italic: false }; ctx.warn('Some text formatting could not be read.') } }
      if (info) {
        node.geom.text = info.text; node.geom.size = info.size || 0.1667; node.geom.bold = info.bold; node.geom.italic = info.italic
        node.geom.family = (info.fontId != null && fonts.get(info.fontId)) || 'Arial'
        const tf = info.fillId != null ? resolveFill(info.fillId) : null
        if (tf?.type === 'solid') node.fill = tf
        else if (!node.fill) node.fill = { type: 'solid', color: '#000000' }
      }
      if (!info?.text) { node.kind = 'unknown'; node.geom = { kind: 'unknown', note: 'text' } }
    }
    if (node.kind === 'bitmap') node.geom.bmp = bmps.get(node.geom.image) || null
    return node
  }
  const walk = (list, st) => {
    for (const c of list) {
      if (c.id !== 'LIST' || !c.children) continue
      const kind = classify(c)
      if (kind === 'page') {
        const fl = readFlags(c)
        const page = newPage(!!(fl && fl.f2))
        const lo = c.children.find((x) => x.id === 'loda')
        if (lo) { try { const a = argsOf(parseLoda(lo.body, ctx)); if (a.pageSize) { page.w = a.pageSize.w; page.h = a.pageSize.h } page.name = a.name } catch { /* keep defaults */ } }
        walk(c.children, { page, layer: null, group: null })
      } else if (kind === 'layer') {
        const page = st.page || newPage()
        const fl = readFlags(c)
        let name = ''
        const lo = c.children.find((x) => x.id === 'loda')
        if (lo) { try { name = argsOf(parseLoda(lo.body, ctx)).name } catch { /* */ } }
        const layer = layerOf(page, fl ? fl.f0 : 0, name)
        walk(c.children, { page, layer, group: null })
      } else if (kind === 'group') {
        const page = st.page || newPage()
        const layer = st.layer || layerOf(page)
        const g = { id: nextId++, kind: 'group', name: '', m: null, bbox: null, fill: null, line: null, opacity: 1, children: [] }
        const t = c.children.find((x) => x.id === 'trfd')
        if (t) { try { const ms = parseTrfd(t.body, ctx); if (ms.length) g.m = ms[0] } catch { /* */ } }
        const lo = c.children.find((x) => x.id === 'loda')
        if (lo) { try { g.name = argsOf(parseLoda(lo.body, ctx)).name } catch { /* */ } }
        ;(st.group ? st.group.children : layer.objects).push(g)
        walk(c.children, { page, layer, group: g })
      } else if (kind === 'object') {
        const page = st.page || newPage()
        const layer = st.layer || layerOf(page)
        const o = makeObject(c)
        if (o) (st.group ? st.group.children : layer.objects).push(o)
      } else if (!SKIP_LISTS.has(c.form)) {
        // a list with its own geometry and transform is an object even when its form tag is not the usual one
        if (c.children.some((x) => x.id === 'loda' || x.id === 'lobj') && c.children.some((x) => x.id === 'trfd')) {
          const page = st.page || newPage()
          const layer = st.layer || layerOf(page)
          const o = makeObject(c)
          if (o) (st.group ? st.group.children : layer.objects).push(o)
        } else walk(c.children, st)
      }
    }
  }
  walk(root.children, {})
  // the preview image is in a page-less file too
  const useful = pages.filter((p) => p.layers.some((l) => l.objects.length))
  if (!useful.length) { res.failed = true; warnings.push('No drawing objects could be read from this file.') }
  // names, sizes
  let n = 0
  for (const p of pages) { if (!p.name) p.name = p.master ? 'Master page' : `Page ${++n}`; if (!p.w || !p.h) { p.w = mcfg?.w || 8.5; p.h = mcfg?.h || 11 } }
  res.pages = pages
  res.approx = [...approx]
  res.stats = { fills: fills.size, outlines: outls.size, bitmaps: bmps.size, fonts: fonts.size }
  return res
}
export { mulM }
