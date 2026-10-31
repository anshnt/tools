// TrueType writing: glyf/loca encoder, plus a from-scratch font builder (name, cmap, OS/2, head, hhea, maxp, post, hmtx). DOM-free.
import { dv } from './_info.js'

const u16 = (n) => [(n >> 8) & 255, n & 255]
const i16 = (n) => u16(n & 0xffff)

/** One glyph record. contours: [[{x, y, on}]] with integer coordinates. Returns {data, bbox|null, points, contours}. */
function encodeGlyph(contours) {
  const pts = contours.flat()
  if (!pts.length) return { data: new Uint8Array(0), bbox: null, points: 0, contours: 0 }
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity
  for (const p of pts) { xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x); yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y) }
  const flags = [], xb = [], yb = []
  let px = 0, py = 0
  for (const p of pts) {
    let f = p.on ? 1 : 0
    const dx = p.x - px, dy = p.y - py
    if (dx === 0) f |= 0x10
    else if (Math.abs(dx) <= 255) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xb.push(Math.abs(dx)) }
    else xb.push(...i16(dx))
    if (dy === 0) f |= 0x20
    else if (Math.abs(dy) <= 255) { f |= 0x04 | (dy > 0 ? 0x20 : 0); yb.push(Math.abs(dy)) }
    else yb.push(...i16(dy))
    flags.push(f)
    px = p.x; py = p.y
  }
  const packed = []
  for (let i = 0; i < flags.length;) {
    let n = 1
    while (i + n < flags.length && flags[i + n] === flags[i] && n < 256) n++
    if (n > 1) { packed.push(flags[i] | 0x08, n - 1); i += n } else { packed.push(flags[i]); i++ }
  }
  const ends = []
  let c = -1
  for (const k of contours) { c += k.length; ends.push(c) }
  const body = [...i16(contours.length), ...i16(xMin), ...i16(yMin), ...i16(xMax), ...i16(yMax), ...ends.flatMap(u16), 0, 0, ...packed, ...xb, ...yb]
  while (body.length % 4) body.push(0)
  return { data: Uint8Array.from(body), bbox: [xMin, yMin, xMax, yMax], points: pts.length, contours: contours.length }
}

/** glyphs: [{contours}] -> {glyf, loca, format (indexToLocFormat), bboxes, maxPoints, maxContours} */
export function encodeGlyf(glyphs) {
  const recs = glyphs.map((g) => encodeGlyph(g.contours || []))
  const total = recs.reduce((a, r) => a + r.data.length, 0)
  const glyf = new Uint8Array(total)
  const long = total >= 0x20000
  const loca = new Uint8Array((glyphs.length + 1) * (long ? 4 : 2))
  const lv = dv(loca)
  let off = 0
  recs.forEach((r, i) => {
    long ? lv.setUint32(i * 4, off) : lv.setUint16(i * 2, off / 2)
    glyf.set(r.data, off)
    off += r.data.length
  })
  long ? lv.setUint32(glyphs.length * 4, off) : lv.setUint16(glyphs.length * 2, off / 2)
  return { glyf, loca, format: long ? 1 : 0, bboxes: recs.map((r) => r.bbox), maxPoints: Math.max(0, ...recs.map((r) => r.points)), maxContours: Math.max(0, ...recs.map((r) => r.contours)) }
}

const secs1904 = () => Math.floor(Date.now() / 1000) + 2082844800

/** maxp version 1.0 for an unhinted TrueType font. */
export function makeMaxp(numGlyphs, maxPoints, maxContours) {
  const b = new Uint8Array(32)
  const v = dv(b)
  v.setUint32(0, 0x00010000); v.setUint16(4, numGlyphs); v.setUint16(6, maxPoints); v.setUint16(8, maxContours); v.setUint16(14, 2) // maxZones = 2
  return b
}

/** hmtx with one full record per glyph; lsb is the glyph's xMin, which TrueType scalers expect. */
export function makeHmtx(advances, bboxes) {
  const b = new Uint8Array(advances.length * 4)
  const v = dv(b)
  advances.forEach((a, i) => { v.setUint16(i * 4, Math.max(0, Math.min(65535, Math.round(a)))); v.setInt16(i * 4 + 2, bboxes[i] ? bboxes[i][0] : 0) })
  return b
}

/** post table: version 2 with glyph names when names are given, else version 3 (no names). header: an existing post table (first 32 bytes are reused). */
export function makePost(header, names) {
  const h = header && header.length >= 32 ? header.slice(0, 32) : new Uint8Array(32)
  const named = names && names.some((n, i) => i > 0 && n)
  dv(h).setUint32(0, named ? 0x00020000 : 0x00030000)
  if (!named) return h
  const enc = new TextEncoder()
  const strs = [], idx = []
  names.forEach((n, i) => {
    if (i === 0) { idx.push(0); return }
    const b = enc.encode((n || `glyph${i}`).replace(/[^!-~]/g, '_').slice(0, 63))
    idx.push(258 + strs.length); strs.push(b)
  })
  const out = new Uint8Array(32 + 2 + names.length * 2 + strs.reduce((a, b) => a + b.length + 1, 0))
  out.set(h)
  const v = dv(out)
  v.setUint16(32, names.length)
  idx.forEach((x, i) => v.setUint16(34 + i * 2, x))
  let p = 34 + names.length * 2
  for (const b of strs) { out[p++] = b.length; out.set(b, p); p += b.length }
  return out
}

export const GASP = Uint8Array.from([0, 1, 0, 1, 0xff, 0xff, 0, 0x0f]) // version 1, one range for every size: grid-fit, smoothing and their symmetric variants

/** Rewrite head and hhea for new glyph boxes and metrics (and the loca format). */
export function patchHeadHhea(head, hhea, { format, bboxes, advances }) {
  head = head.slice(); hhea = hhea.slice()
  const hv = dv(head), av = dv(hhea)
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity, minL = Infinity, minR = Infinity, maxExt = -Infinity
  bboxes.forEach((bb, i) => {
    if (!bb) return
    xMin = Math.min(xMin, bb[0]); yMin = Math.min(yMin, bb[1]); xMax = Math.max(xMax, bb[2]); yMax = Math.max(yMax, bb[3])
    minL = Math.min(minL, bb[0]); minR = Math.min(minR, advances[i] - bb[2]); maxExt = Math.max(maxExt, bb[2])
  })
  if (!Number.isFinite(xMin)) { xMin = yMin = xMax = yMax = minL = minR = maxExt = 0 }
  hv.setInt16(36, xMin); hv.setInt16(38, yMin); hv.setInt16(40, xMax); hv.setInt16(42, yMax)
  hv.setUint16(16, hv.getUint16(16) | 0x0003) // baseline at y=0 and lsb at x=0
  hv.setInt16(50, format); hv.setInt16(52, 0)
  av.setUint16(10, Math.max(0, ...advances))
  av.setInt16(12, minL); av.setInt16(14, minR); av.setInt16(16, maxExt)
  av.setUint16(34, advances.length)
  return { head, hhea }
}

// ---------- From-scratch builder (used for bitmap font conversion) ----------
const utf16 = (s) => { const o = []; for (let i = 0; i < s.length; i++) o.push(...u16(s.charCodeAt(i))); return o }

function makeName(strings) {
  const ids = Object.keys(strings).map(Number).filter((k) => strings[k]).sort((a, b) => a - b)
  const recs = ids.map((id) => ({ id, bytes: utf16(strings[id]) }))
  const strOff = 6 + recs.length * 12
  const out = [0, 0, ...u16(recs.length), ...u16(strOff)]
  let off = 0
  for (const r of recs) { out.push(...u16(3), ...u16(1), ...u16(0x409), ...u16(r.id), ...u16(r.bytes.length), ...u16(off)); off += r.bytes.length }
  for (const r of recs) out.push(...r.bytes)
  return Uint8Array.from(out)
}

/** cmap with a format 4 subtable (BMP) and, when needed, a format 12 one. pairs: [[codePoint, glyphId]] */
function makeCmap(pairs) {
  pairs = [...pairs].sort((a, b) => a[0] - b[0])
  const bmp = pairs.filter(([c]) => c < 0xffff)
  const segs = []
  for (const [c, g] of bmp) {
    const s = segs[segs.length - 1]
    if (s && c === s.end + 1 && g === s.gid + (c - s.start)) s.end = c
    else segs.push({ start: c, end: c, gid: g })
  }
  segs.push({ start: 0xffff, end: 0xffff, gid: 0, last: true })
  const n = segs.length
  const f4 = [...u16(4), ...u16(16 + n * 8), ...u16(0), ...u16(n * 2)]
  const pow = 2 ** Math.floor(Math.log2(n))
  f4.push(...u16(pow * 2), ...u16(Math.log2(pow)), ...u16(n * 2 - pow * 2))
  segs.forEach((s) => f4.push(...u16(s.end)))
  f4.push(0, 0)
  segs.forEach((s) => f4.push(...u16(s.start)))
  segs.forEach((s) => f4.push(...i16(s.last ? 1 : (s.gid - s.start) & 0xffff)))
  segs.forEach(() => f4.push(0, 0))
  const astral = pairs.filter(([c]) => c > 0xffff)
  const w32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  let f12 = []
  if (astral.length) {
    const groups = []
    for (const [c, g] of pairs) {
      const s = groups[groups.length - 1]
      if (s && c === s.end + 1 && g === s.gid + (c - s.start)) s.end = c
      else groups.push({ start: c, end: c, gid: g })
    }
    f12 = [...u16(12), ...u16(0), ...w32(16 + groups.length * 12), ...w32(0), ...w32(groups.length)]
    for (const s of groups) f12.push(...w32(s.start), ...w32(s.end), ...w32(s.gid))
  }
  const recs = astral.length ? 3 : 2
  const base = 4 + recs * 8
  const off4 = base, off12 = base + f4.length
  const head = [...u16(0), ...u16(recs), ...u16(0), ...u16(astral.length ? 4 : 3), ...w32(astral.length ? off12 : off4), ...u16(3), ...u16(1), ...w32(off4)]
  if (astral.length) head.push(...u16(3), ...u16(10), ...w32(off12))
  return Uint8Array.from([...head, ...f4, ...f12])
}

/**
 * Build a TrueType font. glyphs[0] must be .notdef.
 * { family, style, psName, unitsPerEm, ascent, descent (positive), lineGap, glyphs: [{advance, contours}], cmap: [[cp, gid]],
 *   weight, italic, bold, fixedPitch, copyright, lowestPpem, version }
 */
export function buildTtf(o) {
  const upm = o.unitsPerEm
  const enc = encodeGlyf(o.glyphs)
  const advances = o.glyphs.map((g) => g.advance)
  const hmtx = makeHmtx(advances, enc.bboxes)
  const head = new Uint8Array(54), hhea = new Uint8Array(36)
  const hv = dv(head)
  hv.setUint32(0, 0x00010000); hv.setUint32(4, Math.round((o.version || 1) * 65536)); hv.setUint32(12, 0x5f0f3cf5)
  hv.setUint16(18, upm); hv.setBigInt64(20, BigInt(secs1904())); hv.setBigInt64(28, BigInt(secs1904()))
  hv.setUint16(44, (o.bold ? 1 : 0) | (o.italic ? 2 : 0)); hv.setUint16(46, o.lowestPpem || 8); hv.setInt16(48, 2)
  dv(hhea).setUint32(0, 0x00010000); dv(hhea).setInt16(4, o.ascent); dv(hhea).setInt16(6, -o.descent); dv(hhea).setInt16(8, o.lineGap || 0)
  const patched = patchHeadHhea(head, hhea, { format: enc.format, bboxes: enc.bboxes, advances })
  patched.head = patched.head.slice(); dv(patched.head).setUint16(16, dv(patched.head).getUint16(16) | 0x0008) // force integer ppem: these are pixel fonts

  const os2 = new Uint8Array(96)
  const ov = dv(os2)
  const avg = Math.round(advances.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, advances.length - 1))
  const cps = o.cmap.map((p) => p[0])
  ov.setUint16(0, 4); ov.setInt16(2, avg); ov.setUint16(4, o.weight || 400); ov.setUint16(6, 5)
  ov.setInt16(10, Math.round(upm * 0.65)); ov.setInt16(12, Math.round(upm * 0.7)); ov.setInt16(14, 0); ov.setInt16(16, Math.round(upm * 0.14))
  ov.setInt16(18, Math.round(upm * 0.65)); ov.setInt16(20, Math.round(upm * 0.7)); ov.setInt16(22, 0); ov.setInt16(24, Math.round(upm * 0.48))
  ov.setInt16(26, Math.max(1, Math.round(upm * 0.05))); ov.setInt16(28, Math.round(upm * 0.26))
  os2[32 + 0] = 2; os2[32 + 3] = o.fixedPitch ? 9 : 0 // PANOSE family kind "Latin text", proportion monospaced
  const has = (a, b) => cps.some((c) => c >= a && c <= b)
  const bit = (n) => { ov.setUint32(42 + ((n >> 5) * 4), ov.getUint32(42 + ((n >> 5) * 4)) | (1 << (n & 31))) }
  if (has(0x20, 0x7e)) bit(0); if (has(0xa0, 0xff)) bit(1); if (has(0x100, 0x17f)) bit(2); if (has(0x370, 0x3ff)) bit(7); if (has(0x400, 0x4ff)) bit(9)
  if (has(0x2500, 0x257f)) bit(44); if (has(0x2580, 0x259f)) bit(45); if (has(0x25a0, 0x25ff)) bit(46)
  ov.setUint32(58, 0x4e4f4e45) // 'NONE'
  ov.setUint16(62, (o.italic ? 1 : 0) | (o.bold ? 32 : 0) | (!o.bold && !o.italic ? 64 : 0) | 128)
  ov.setUint16(64, Math.min(0xffff, Math.min(...cps)));
  ov.setUint16(66, Math.min(0xffff, Math.max(...cps)))
  ov.setInt16(68, o.ascent); ov.setInt16(70, -o.descent); ov.setInt16(72, o.lineGap || 0); ov.setUint16(74, o.ascent); ov.setUint16(76, o.descent)
  ov.setUint32(78, 1) // code page 1252
  const gx = o.cmap.find(([c]) => c === 0x78)?.[1], gh = o.cmap.find(([c]) => c === 0x48)?.[1]
  ov.setInt16(86, gx && enc.bboxes[gx] ? enc.bboxes[gx][3] : 0); ov.setInt16(88, gh && enc.bboxes[gh] ? enc.bboxes[gh][3] : 0)
  ov.setUint16(90, 0); ov.setUint16(92, o.cmap.find(([c]) => c === 0x20)?.[1] ? 0x20 : 0); ov.setUint16(94, 1)

  const post = new Uint8Array(32)
  const pv = dv(post)
  pv.setUint32(0, 0x00030000); pv.setInt16(8, -Math.round(upm * 0.1)); pv.setInt16(10, Math.max(1, Math.round(upm * 0.05))); pv.setUint32(12, o.fixedPitch ? 1 : 0)

  const full = o.style && o.style !== 'Regular' ? `${o.family} ${o.style}` : o.family
  const ps = o.psName || full.replace(/[^A-Za-z0-9-]/g, '')
  const name = makeName({ 0: o.copyright || '', 1: o.family, 2: o.style || 'Regular', 3: `${ps};1.0`, 4: full, 5: 'Version 1.000', 6: ps })
  return new Map([
    ['OS/2', os2], ['cmap', makeCmap(o.cmap)], ['glyf', enc.glyf], ['head', patched.head], ['hhea', patched.hhea], ['hmtx', hmtx], ['loca', enc.loca],
    ['maxp', makeMaxp(o.glyphs.length, enc.maxPoints, enc.maxContours)], ['name', name], ['post', post],
  ])
}
