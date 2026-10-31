// Shapefile (.shp/.shx) and dBase (.dbf) reading and writing, written from the public format description.
import { fixWinding, ringArea, isNum, cell, tick } from './_util.js'
import { decodeWith, makeEncoder, labelFromCpg, labelFromLdid, cpgName, ldidFor, guessLegacyEncoding } from './_enc.js'

// ---------------- DBF ----------------
const FIELD_RE = /^[CNFLDIB@+OMG]$/
/**
 * Read a .dbf. `encoding` is a TextDecoder label or null (use the language byte, else UTF-8 with a Windows-1252 fallback).
 * Returns { fields: [{name,type,len,dec}], rows: [object|null], encoding } where null rows are deleted records.
 */
export function readDbf(buf, { encoding, cpg } = {}) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (buf.length < 33) throw new Error('The .dbf file is too short to be valid.')
  const nrec = dv.getUint32(4, true), hlen = dv.getUint16(8, true), rlen = dv.getUint16(10, true), ldid = buf[29]
  const fields = []
  for (let p = 32; p + 32 <= hlen && buf[p] !== 0x0d; p += 32) {
    let e = p
    while (e < p + 11 && buf[e]) e++
    fields.push({ nameBytes: buf.subarray(p, e), type: String.fromCharCode(buf[p + 11]), len: buf[p + 16], dec: buf[p + 17] })
  }
  if (!fields.length) throw new Error('The .dbf file has no fields.')
  let label = encoding && encoding !== 'auto' ? encoding : labelFromCpg(cpg) || labelFromLdid(ldid)
  let auto = false
  if (!label) { label = 'utf-8'; auto = true }
  // With no language information, UTF-8 is tried first; other bytes are read as Korean (CP949) when they clearly are, else Windows-1252.
  if (auto) {
    const body = buf.subarray(hlen)
    if (decodeWith('utf-8', body, true) === null) label = guessLegacyEncoding(body)
  }
  const dec = new TextDecoder(label)
  const text = (bytes) => dec.decode(bytes).replace(/[\0\s]+$/, '').replace(/^[\0]+/, '')
  for (const f of fields) f.name = text(f.nameBytes) || 'field'
  const seen = new Set()
  for (const f of fields) { let n = f.name, i = 1; while (seen.has(n)) n = `${f.name}_${i++}`; seen.add(n); f.name = n }
  const rows = []
  for (let r = 0; r < nrec; r++) {
    let o = hlen + r * rlen
    if (o + rlen > buf.length) break
    if (buf[o] === 0x2a) { rows.push(null); continue }
    o++
    const row = {}
    for (const f of fields) {
      const raw = buf.subarray(o, o + f.len)
      o += f.len
      row[f.name] = parseCell(f, raw, dec)
    }
    rows.push(row)
  }
  return { fields, rows, encoding: label }
}

function parseCell(f, raw, dec) {
  const t = f.type
  if (t === 'C') return dec.decode(raw).replace(/[\0\s]+$/, '').replace(/^\0+/, '')
  if (t === 'I') return new DataView(raw.buffer, raw.byteOffset, 4).getInt32(0, true)
  if (t === 'B' && f.len === 8) return new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true)
  if (t === 'O' && f.len === 8) return new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true)
  const s = String.fromCharCode(...raw).trim().replace(/\0/g, '')
  if (t === 'N' || t === 'F') { if (!s || /^\*+$/.test(s)) return null; const n = Number(s); return Number.isFinite(n) ? n : null }
  if (t === 'L') return /^[TtYy]$/.test(s) ? true : /^[FfNn]$/.test(s) ? false : null
  if (t === 'D') return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
  if (t === 'M' || t === 'G') return null
  return s || null
}

const DBF_MAX_TEXT = 254
/** Write a .dbf for the given rows. Returns { bytes, cpg, notes[] }. `columns` lists property names in order. */
export function writeDbf(rows, columns, encodingLabel = 'utf-8') {
  const enc = makeEncoder(encodingLabel)
  const notes = []
  const names = []
  const used = new Set()
  const cols = columns.length ? columns : null
  const nameBytes = (name) => {
    let b = enc(String(name).replace(/[\0-\x1f]/g, ''))
    if (b.length > 10) {
      let acc = '', n = 0
      for (const ch of String(name)) { const l = enc(ch).length; if (n + l > 10) break; acc += ch; n += l }
      b = enc(acc)
    }
    return b
  }
  const fieldDefs = (cols || ['ID']).map((c) => {
    const b = nameBytes(c), s = decodeWith(encodingLabel, b)
    let key = s || 'FIELD', i = 1
    while (used.has(key.toLowerCase())) {
      const suffix = `_${i++}`
      let base = key
      while (enc(base + suffix).length > 10 && base.length > 1) base = [...base].slice(0, -1).join('')
      key = base + suffix
    }
    used.add(key.toLowerCase())
    names.push(key)
    return { col: c, name: enc(key) }
  })
  // infer types
  const kinds = fieldDefs.map(({ col }, ci) => {
    if (!cols) return { type: 'N', len: 10, dec: 0 }
    let allNull = true, allBool = true, allNum = true, allInt = true, allDate = true, maxDec = 0, maxInt = 1, maxText = 1, trunc = false
    for (const r of rows) {
      const v = cell(r[col])
      if (v === null || v === '') continue
      allNull = false
      if (typeof v !== 'boolean') allBool = false
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (!Number.isInteger(v)) { allInt = false; const m = String(v).match(/\.(\d+)/); maxDec = Math.max(maxDec, m ? m[1].length : 15) }
        maxInt = Math.max(maxInt, String(Math.trunc(Math.abs(v))).length + (v < 0 ? 1 : 0))
      } else allNum = false
      if (!(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) allDate = false
      const len = enc(String(v)).length
      if (len > maxText) maxText = len
    }
    if (allNull) return { type: 'C', len: 1, dec: 0 }
    if (allBool) return { type: 'L', len: 1, dec: 0 }
    if (allNum) {
      if (allInt && maxInt <= 18) return { type: 'N', len: Math.max(maxInt, 1), dec: 0 }
      let dec = Math.min(maxDec, 15)
      if (maxInt + dec + 1 > 24) dec = Math.max(0, 24 - maxInt - 1)
      return { type: 'N', len: Math.min(24, maxInt + dec + 1), dec }
    }
    if (allDate) return { type: 'D', len: 8, dec: 0 }
    if (maxText > DBF_MAX_TEXT) notes.push(`Text longer than ${DBF_MAX_TEXT} bytes in "${col}" was cut (the .dbf format cannot hold more).`)
    return { type: 'C', len: Math.min(DBF_MAX_TEXT, maxText), dec: 0 }
  })
  const recLen = 1 + kinds.reduce((s, k) => s + k.len, 0)
  const hLen = 32 + 32 * kinds.length + 1
  const out = new Uint8Array(hLen + rows.length * recLen + 1)
  const dv = new DataView(out.buffer)
  const now = new Date()
  out[0] = 3; out[1] = now.getFullYear() - 1900; out[2] = now.getMonth() + 1; out[3] = now.getDate()
  dv.setUint32(4, rows.length, true); dv.setUint16(8, hLen, true); dv.setUint16(10, recLen, true)
  out[29] = ldidFor(encodingLabel)
  kinds.forEach((k, i) => {
    const p = 32 + i * 32
    out.set(fieldDefs[i].name, p)
    out[p + 11] = k.type.charCodeAt(0); out[p + 16] = k.len; out[p + 17] = k.dec
  })
  out[hLen - 1] = 0x0d
  let o = hLen
  rows.forEach((r, ri) => {
    out[o++] = 0x20
    kinds.forEach((k, ci) => {
      const v = cols ? cell(r[fieldDefs[ci].col]) : ri + 1
      let bytes
      if (v === null || v === '' || v === undefined) bytes = new Uint8Array(0)
      else if (k.type === 'N') bytes = enc(isNum(v) ? (k.dec ? v.toFixed(k.dec) : String(Math.round(v))) : '')
      else if (k.type === 'L') bytes = enc(v === true ? 'T' : v === false ? 'F' : '?')
      else if (k.type === 'D') bytes = enc(String(v).replace(/-/g, ''))
      else { bytes = enc(String(v)); if (bytes.length > k.len) bytes = cutBytes(bytes, k.len, encodingLabel) }
      if (bytes.length > k.len) bytes = bytes.subarray(0, k.len)
      const pad = k.len - bytes.length
      if (k.type === 'N') { out.fill(0x20, o, o + pad); out.set(bytes, o + pad) } else { out.set(bytes, o); out.fill(0x20, o + bytes.length, o + k.len) }
      o += k.len
    })
  })
  out[o] = 0x1a
  return { bytes: out, cpg: cpgName(encodingLabel), notes, names }
}
function cutBytes(bytes, n, label) {
  if (label !== 'utf-8') return bytes.subarray(0, n)
  let e = n
  while (e > 0 && (bytes[e] & 0xc0) === 0x80) e--
  return bytes.subarray(0, e)
}

// ---------------- SHP reading ----------------
const TYPE_NAMES = { 0: 'Null', 1: 'Point', 3: 'PolyLine', 5: 'Polygon', 8: 'MultiPoint', 11: 'PointZ', 13: 'PolyLineZ', 15: 'PolygonZ', 18: 'MultiPointZ', 21: 'PointM', 23: 'PolyLineM', 25: 'PolygonM', 28: 'MultiPointM', 31: 'MultiPatch' }

/** Read all records of a .shp as GeoJSON geometries (null for null shapes). Returns { geoms, shapeType, typeName, notes[] }. */
export async function readShp(buf, { onProgress, signal } = {}) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (buf.length < 100 || dv.getInt32(0, false) !== 9994) throw new Error('This is not a valid .shp file (the header is missing).')
  const fileEnd = Math.min(dv.getInt32(24, false) * 2, buf.length)
  const shapeType = dv.getInt32(32, true)
  const geoms = []
  const notes = []
  let unsupported = 0
  let o = 100
  let n = 0
  while (o + 12 <= fileEnd) {
    const clen = dv.getInt32(o + 4, false) * 2
    const base = o + 8
    const next = base + clen
    if (next > buf.length) { notes.push('The .shp file ends in the middle of a record; the rest was ignored.'); break }
    const t = dv.getInt32(base, true)
    let g = null
    try { g = readShape(dv, base, t, next) } catch { g = null; unsupported++ }
    if (t === 31) unsupported++
    geoms.push(g)
    o = next
    if (++n % 20000 === 0) {
      await tick()
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'ABORT' })
      onProgress?.(o / fileEnd)
    }
  }
  if (unsupported) notes.push(`${unsupported} shape(s) of an unsupported kind (multipatch or damaged) were read without geometry.`)
  return { geoms, shapeType, typeName: TYPE_NAMES[shapeType] || `type ${shapeType}`, notes }
}

function readShape(dv, base, t, end) {
  if (t === 0) return null
  const k = t >= 11 && t <= 18 ? t - 10 : t >= 21 && t <= 28 ? t - 20 : t
  const hasZ = t >= 11 && t <= 18
  if (k === 1) {
    const x = dv.getFloat64(base + 4, true), y = dv.getFloat64(base + 12, true)
    const z = hasZ && base + 28 <= end ? dv.getFloat64(base + 20, true) : undefined
    return { type: 'Point', coordinates: isNum(z) ? [x, y, z] : [x, y] }
  }
  if (k === 8) {
    const np = dv.getInt32(base + 36, true)
    let p = base + 40
    const pts = []
    for (let i = 0; i < np; i++, p += 16) pts.push([dv.getFloat64(p, true), dv.getFloat64(p + 8, true)])
    if (hasZ && p + 16 + np * 8 <= end) { p += 16; for (let i = 0; i < np; i++, p += 8) pts[i].push(dv.getFloat64(p, true)) }
    return { type: 'MultiPoint', coordinates: pts }
  }
  if (k === 3 || k === 5) {
    const nparts = dv.getInt32(base + 36, true), np = dv.getInt32(base + 40, true)
    if (nparts < 0 || np < 0 || nparts > np + 1) throw new Error('bad')
    let p = base + 44
    const parts = []
    for (let i = 0; i < nparts; i++, p += 4) parts.push(dv.getInt32(p, true))
    const pts = new Array(np)
    for (let i = 0; i < np; i++, p += 16) pts[i] = [dv.getFloat64(p, true), dv.getFloat64(p + 8, true)]
    if (hasZ && p + 16 + np * 8 <= end) { p += 16; for (let i = 0; i < np; i++, p += 8) pts[i].push(dv.getFloat64(p, true)) }
    const rings = parts.map((s, i) => pts.slice(s, i + 1 < nparts ? parts[i + 1] : np))
    if (k === 3) {
      const lines = rings.filter((r) => r.length > 1)
      if (!lines.length) return null
      return lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines }
    }
    // polygons: clockwise rings start a polygon, counter-clockwise rings are holes of the polygon before them
    const polys = []
    for (const r of rings) {
      if (r.length < 4) continue
      if (ringArea(r) <= 0 || !polys.length) polys.push([r])
      else polys[polys.length - 1].push(r)
    }
    if (!polys.length) return null
    const fixed = polys.map((p) => fixWinding(p))
    return fixed.length === 1 ? { type: 'Polygon', coordinates: fixed[0] } : { type: 'MultiPolygon', coordinates: fixed }
  }
  throw new Error('unsupported')
}

// ---------------- SHP writing ----------------
/** 'point' | 'multipoint' | 'line' | 'polygon' for a simple geometry. */
export const shpClass = (g) => ({ Point: 'point', MultiPoint: 'multipoint', LineString: 'line', MultiLineString: 'line', Polygon: 'polygon', MultiPolygon: 'polygon' }[g.type])

/** Write .shp and .shx for geometries that all belong to one class. Returns { shp, shx }. */
export function writeShp(geoms, cls) {
  const hasZ = geoms.some((g) => hasZCoords(g))
  const typeCode = { point: hasZ ? 11 : 1, multipoint: hasZ ? 18 : 8, line: hasZ ? 13 : 3, polygon: hasZ ? 15 : 5 }[cls]
  const recs = geoms.map((g) => encodeShape(g, cls, hasZ))
  const total = 100 + recs.reduce((s, r) => s + 8 + r.length, 0)
  const shp = new Uint8Array(total), shx = new Uint8Array(100 + 8 * recs.length)
  const dv = new DataView(shp.buffer), xv = new DataView(shx.buffer)
  let box = [Infinity, Infinity, -Infinity, -Infinity], zr = [Infinity, -Infinity]
  for (const g of geoms) walkPos(g, (p) => {
    if (p[0] < box[0]) box[0] = p[0]; if (p[1] < box[1]) box[1] = p[1]; if (p[0] > box[2]) box[2] = p[0]; if (p[1] > box[3]) box[3] = p[1]
    if (isNum(p[2])) { if (p[2] < zr[0]) zr[0] = p[2]; if (p[2] > zr[1]) zr[1] = p[2] }
  })
  if (box[0] === Infinity) box = [0, 0, 0, 0]
  if (zr[0] === Infinity) zr = [0, 0]
  for (const [v, len] of [[dv, total], [xv, shx.length]]) {
    v.setInt32(0, 9994, false); v.setInt32(24, len / 2, false); v.setInt32(28, 1000, true); v.setInt32(32, typeCode, true)
    box.forEach((b, i) => v.setFloat64(36 + i * 8, b, true))
    if (hasZ) { v.setFloat64(68, zr[0], true); v.setFloat64(76, zr[1], true) }
  }
  let o = 100
  recs.forEach((r, i) => {
    dv.setInt32(o, i + 1, false); dv.setInt32(o + 4, r.length / 2, false)
    xv.setInt32(100 + i * 8, o / 2, false); xv.setInt32(104 + i * 8, r.length / 2, false)
    shp.set(r, o + 8)
    o += 8 + r.length
  })
  return { shp, shx, typeCode }
}
const walkPos = (g, fn) => { const w = (c, d) => { if (d === 0) fn(c); else for (const x of c) w(x, d - 1) }; w(g.coordinates, { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }[g.type]) }
const hasZCoords = (g) => { let z = false; walkPos(g, (p) => { if (isNum(p[2])) z = true }); return z }
const NODATA = -1e40

function encodeShape(g, cls, hasZ) {
  if (cls === 'point') {
    const b = new Uint8Array(hasZ ? 36 : 20), v = new DataView(b.buffer)
    v.setInt32(0, hasZ ? 11 : 1, true); v.setFloat64(4, g.coordinates[0], true); v.setFloat64(12, g.coordinates[1], true)
    if (hasZ) { v.setFloat64(20, g.coordinates[2] ?? 0, true); v.setFloat64(28, NODATA, true) }
    return b
  }
  let parts = [], pts = []
  if (cls === 'multipoint') pts = g.coordinates
  else {
    const lists = cls === 'line' ? (g.type === 'LineString' ? [g.coordinates] : g.coordinates) : (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flatMap((p) => fixWinding(p, true))
    for (const l of lists) { parts.push(pts.length); for (const p of l) pts.push(p) }
  }
  const np = pts.length
  const head = cls === 'multipoint' ? 40 : 44 + 4 * parts.length
  const size = head + 16 * np + (hasZ ? 16 + 8 * np : 0)
  const b = new Uint8Array(size), v = new DataView(b.buffer)
  const typeCode = { multipoint: hasZ ? 18 : 8, line: hasZ ? 13 : 3, polygon: hasZ ? 15 : 5 }[cls]
  v.setInt32(0, typeCode, true)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1] }
  ;[x0, y0, x1, y1].forEach((c, i) => v.setFloat64(4 + i * 8, c, true))
  let o = 36
  if (cls === 'multipoint') { v.setInt32(o, np, true); o += 4 } else { v.setInt32(o, parts.length, true); v.setInt32(o + 4, np, true); o += 8; for (const s of parts) { v.setInt32(o, s, true); o += 4 } }
  for (const p of pts) { v.setFloat64(o, p[0], true); v.setFloat64(o + 8, p[1], true); o += 16 }
  if (hasZ) {
    let zmin = Infinity, zmax = -Infinity
    for (const p of pts) { const z = p[2] ?? 0; if (z < zmin) zmin = z; if (z > zmax) zmax = z }
    v.setFloat64(o, zmin, true); v.setFloat64(o + 8, zmax, true); o += 16
    for (const p of pts) { v.setFloat64(o, p[2] ?? 0, true); o += 8 }
  }
  return b
}
