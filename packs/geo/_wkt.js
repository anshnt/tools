// WKT / EWKT / WKB (hex or binary) reading and WKT writing.
import { isNum } from './_util.js'

const TOKEN = /[A-Za-z]+|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[(),]/g

/** WKT or EWKT text -> { geometry, srid }. Throws on text that is not WKT. */
export function parseWkt(text) {
  let str = String(text).trim()
  let srid
  const m = /^SRID\s*=\s*(\d+)\s*;/i.exec(str)
  if (m) { srid = Number(m[1]); str = str.slice(m[0].length) }
  const toks = str.match(TOKEN) || []
  let i = 0
  const bad = () => new Error(`Not valid WKT near "${toks.slice(Math.max(0, i - 1), i + 3).join(' ')}".`)
  const peek = () => toks[i]
  const next = () => toks[i++]
  const expect = (t) => { if (next() !== t) { i--; throw bad() } }
  const coord = (dims) => {
    const nums = []
    while (i < toks.length && /^[-+.\d]/.test(toks[i])) nums.push(Number(toks[i++]))
    if (nums.length < 2 || !nums.every(isNum)) throw bad()
    if (dims === 'M') return [nums[0], nums[1]]
    return nums.length >= 3 ? [nums[0], nums[1], nums[2]] : [nums[0], nums[1]]
  }
  const list = (item) => { expect('('); const out = [item()]; while (peek() === ',') { i++; out.push(item()) } expect(')'); return out }
  const geometry = () => {
    const type = (next() || '').toUpperCase()
    let dims = ''
    if (/^(Z|M|ZM)$/i.test(peek() || '')) dims = next().toUpperCase()
    if ((peek() || '').toUpperCase() === 'EMPTY') { i++; return type === 'GEOMETRYCOLLECTION' ? { type: 'GeometryCollection', geometries: [] } : null }
    const c = () => coord(dims)
    switch (type) {
      case 'POINT': { expect('('); const p = c(); expect(')'); return { type: 'Point', coordinates: p } }
      case 'LINESTRING': return { type: 'LineString', coordinates: list(c) }
      case 'POLYGON': return { type: 'Polygon', coordinates: list(() => list(c)) }
      case 'MULTIPOINT': return { type: 'MultiPoint', coordinates: list(() => { if (peek() === '(') { i++; const p = c(); expect(')'); return p } return c() }) }
      case 'MULTILINESTRING': return { type: 'MultiLineString', coordinates: list(() => list(c)) }
      case 'MULTIPOLYGON': return { type: 'MultiPolygon', coordinates: list(() => list(() => list(c))) }
      case 'GEOMETRYCOLLECTION': return { type: 'GeometryCollection', geometries: list(geometry).filter(Boolean) }
      default: i--; throw bad()
    }
  }
  const g = geometry()
  if (i < toks.length) throw bad()
  return { geometry: g, srid }
}

/** Quick check used when sniffing text: does this look like a WKT geometry? */
export const looksLikeWkt = (s) => /^\s*(SRID\s*=\s*\d+\s*;\s*)?(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*(Z|M|ZM)?\s*(\(|EMPTY)/i.test(s)

const pos = (c) => c.join(' ')
const ring = (r) => `(${r.map(pos).join(', ')})`
const hasZ = (g) => { let z = false; const w = (c) => { if (typeof c[0] === 'number') { if (isNum(c[2])) z = true } else c.forEach(w) }; if (g.coordinates) w(g.coordinates); return z }
export function toWkt(g) {
  if (!g) return ''
  const z = g.type !== 'GeometryCollection' && hasZ(g) ? ' Z' : ''
  switch (g.type) {
    case 'Point': return `POINT${z} (${pos(g.coordinates)})`
    case 'MultiPoint': return `MULTIPOINT${z} (${g.coordinates.map((p) => `(${pos(p)})`).join(', ')})`
    case 'LineString': return `LINESTRING${z} ${ring(g.coordinates)}`
    case 'MultiLineString': return `MULTILINESTRING${z} (${g.coordinates.map(ring).join(', ')})`
    case 'Polygon': return `POLYGON${z} (${g.coordinates.map(ring).join(', ')})`
    case 'MultiPolygon': return `MULTIPOLYGON${z} (${g.coordinates.map((p) => `(${p.map(ring).join(', ')})`).join(', ')})`
    case 'GeometryCollection': return `GEOMETRYCOLLECTION (${g.geometries.map(toWkt).join(', ')})`
    default: return ''
  }
}

// ---------------- WKB ----------------
/** WKB / EWKB bytes -> { geometry, srid }. */
export function parseWkb(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 0
  let srid
  const read = () => {
    const little = bytes[o++] === 1
    const raw = dv.getUint32(o, little); o += 4
    let z = !!(raw & 0x80000000), m = !!(raw & 0x40000000)
    if (raw & 0x20000000) { const s = dv.getInt32(o, little); o += 4; if (srid === undefined) srid = s }
    let t = raw & 0x1fffffff
    if (t >= 3000) { z = true; m = true; t -= 3000 } else if (t >= 2000) { m = true; t -= 2000 } else if (t >= 1000) { z = true; t -= 1000 }
    const f = (le) => { const v = dv.getFloat64(o, le); o += 8; return v }
    const pt = () => { const p = [f(little), f(little)]; if (z) p.push(f(little)); if (m) f(little); return p }
    const n = () => { const v = dv.getUint32(o, little); o += 4; return v }
    const pts = () => Array.from({ length: n() }, pt)
    switch (t) {
      case 1: { const p = pt(); return p.every(Number.isNaN) || Number.isNaN(p[0]) ? null : { type: 'Point', coordinates: p } }
      case 2: return { type: 'LineString', coordinates: pts() }
      case 3: return { type: 'Polygon', coordinates: Array.from({ length: n() }, pts) }
      case 4: return { type: 'MultiPoint', coordinates: Array.from({ length: n() }, () => read().coordinates) }
      case 5: return { type: 'MultiLineString', coordinates: Array.from({ length: n() }, () => read().coordinates) }
      case 6: return { type: 'MultiPolygon', coordinates: Array.from({ length: n() }, () => read().coordinates) }
      case 7: return { type: 'GeometryCollection', geometries: Array.from({ length: n() }, read) }
      default: throw new Error('This WKB geometry type is not supported.')
    }
  }
  return { geometry: read(), srid }
}
export const hexToBytes = (hex) => Uint8Array.from(hex.replace(/^\\x|^0x/i, '').match(/../g).map((h) => parseInt(h, 16)))
export const looksLikeHexWkb = (s) => /^\s*(?:0x|\\x)?[0-9a-f]{10,}\s*$/i.test(s) && /^\s*(?:0x|\\x)?0[01]/i.test(s)
