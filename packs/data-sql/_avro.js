// Minimal Avro object container reader (the .avro file format): reads every record into JSON Lines text.
// Supports the null, deflate and snappy block codecs, all Avro types, unions and the common logical types
// (date, timestamp, time, decimal, uuid). DOM-free.
import { DataError } from './_engine.js'

const td = new TextDecoder()
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
const p2 = (n, w = 2) => String(n).padStart(w, '0')

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength) }
  eof() { return this.p >= this.b.length }
  long() {
    // zig-zag varint; plain numbers up to 2^49, BigInt beyond
    let n = 0, shift = 0, b
    do {
      b = this.b[this.p++]
      if (b === undefined) throw new DataError('The Avro file ends unexpectedly. It may be truncated.')
      if (shift < 49) n += (b & 0x7f) * 2 ** shift
      else return this.longBig(n, shift, b)
      shift += 7
    } while (b & 0x80)
    return n % 2 ? -(n + 1) / 2 : n / 2
  }
  longBig(n, shift, b) {
    let v = BigInt(n)
    for (;;) {
      v += BigInt(b & 0x7f) << BigInt(shift)
      shift += 7
      if (!(b & 0x80)) break
      b = this.b[this.p++]
    }
    const z = v & 1n ? -((v + 1n) >> 1n) : v >> 1n
    return Number.isSafeInteger(Number(z)) ? Number(z) : z.toString()
  }
  bytes() { const n = this.long(); const out = this.b.subarray(this.p, this.p + n); this.p += n; return out }
  string() { return td.decode(this.bytes()) }
  take(n) { const out = this.b.subarray(this.p, this.p + n); this.p += n; return out }
}

function snappy(src) {
  let p = 0, len = 0, shift = 0, b
  do { b = src[p++]; len |= (b & 0x7f) << shift; shift += 7 } while (b & 0x80)
  const out = new Uint8Array(len)
  let o = 0
  while (p < src.length && o < len) {
    const tag = src[p++]
    const t = tag & 3
    if (t === 0) {
      let n = tag >> 2
      if (n >= 60) { const k = n - 59; n = 0; for (let i = 0; i < k; i++) n |= src[p++] << (8 * i); n = n >>> 0 }
      n += 1
      out.set(src.subarray(p, p + n), o)
      p += n; o += n
    } else {
      let n, off
      if (t === 1) { n = 4 + ((tag >> 2) & 7); off = ((tag >> 5) << 8) | src[p++] }
      else if (t === 2) { n = (tag >> 2) + 1; off = src[p] | (src[p + 1] << 8); p += 2 }
      else { n = (tag >> 2) + 1; off = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0; p += 4 }
      if (off === 0 || off > o) throw new DataError('The Avro file has a damaged Snappy block.')
      for (let i = 0; i < n; i++, o++) out[o] = out[o - off]
    }
  }
  return out
}

async function inflateRaw(u8) {
  // some writers leave up to 4 stray bytes (a zlib checksum) after the deflate stream, which the strict decoder rejects
  let err
  for (let trim = 0; trim <= 4; trim++) {
    try { return new Uint8Array(await new Response(new Blob([u8.subarray(0, u8.length - trim)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) } catch (e) { err = e }
  }
  throw new DataError('The Avro file has a damaged deflate block.', { cause: err })
}

function dateText(days) { const d = new Date(days * 86400000); return `${p2(d.getUTCFullYear(), 4)}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` }
function tsText(ms) {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(ms)
  const f = d.getUTCMilliseconds()
  return `${p2(d.getUTCFullYear(), 4)}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}${f ? `.${String(f).padStart(3, '0')}` : ''}`
}
function timeText(ms) { const s = Math.floor(ms / 1000); return `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}` }
function decimalText(u8, scale) {
  let v = 0n
  for (const x of u8) v = (v << 8n) | BigInt(x)
  if (u8.length && u8[0] & 0x80) v -= 1n << BigInt(8 * u8.length) // two's complement
  const neg = v < 0n
  let s = (neg ? -v : v).toString().padStart(scale + 1, '0')
  if (scale) s = `${s.slice(0, -scale)}.${s.slice(-scale)}`
  return (neg ? '-' : '') + s
}

/** Compile an Avro schema into a decoder function (reader) => value. */
function compile(schema, names, ns = '') {
  if (typeof schema === 'string') {
    if (names.has(schema)) return names.get(schema)
    if (ns && names.has(`${ns}.${schema}`)) return names.get(`${ns}.${schema}`)
    return primitive(schema)
  }
  if (Array.isArray(schema)) {
    const branches = schema.map((s) => compile(s, names, ns))
    return (r) => { const i = r.long(); if (!branches[i]) throw new DataError('The Avro file has an invalid union branch.'); return branches[i](r) }
  }
  const type = schema.type
  const lt = schema.logicalType
  if (type === 'record' || type === 'error') {
    const full = schema.name.includes('.') ? schema.name : `${schema.namespace || ns}${schema.namespace || ns ? '.' : ''}${schema.name}`
    const nsHere = full.includes('.') ? full.slice(0, full.lastIndexOf('.')) : ''
    const fields = []
    // register before compiling the fields so recursive records resolve
    const self = (r) => { const o = {}; for (const f of fields) o[f.name] = f.read(r); return o }
    names.set(schema.name, self); names.set(full, self)
    for (const f of schema.fields) fields.push({ name: f.name, read: compile(f.type, names, nsHere) })
    return self
  }
  if (type === 'enum') {
    const read = (r) => schema.symbols[r.long()]
    names.set(schema.name, read); if (schema.namespace || ns) names.set(`${schema.namespace || ns}.${schema.name}`, read)
    return read
  }
  if (type === 'fixed') {
    const read = lt === 'decimal' ? (r) => decimalText(r.take(schema.size), schema.scale || 0) : (r) => b64(r.take(schema.size))
    names.set(schema.name, read); if (schema.namespace || ns) names.set(`${schema.namespace || ns}.${schema.name}`, read)
    return read
  }
  if (type === 'array') {
    const item = compile(schema.items, names, ns)
    return (r) => { const out = []; for (;;) { let n = r.long(); if (!n) break; if (n < 0) { n = -n; r.long() } for (let i = 0; i < n; i++) out.push(item(r)) } return out }
  }
  if (type === 'map') {
    const val = compile(schema.values, names, ns)
    return (r) => { const o = {}; for (;;) { let n = r.long(); if (!n) break; if (n < 0) { n = -n; r.long() } for (let i = 0; i < n; i++) { const k = r.string(); o[k] = val(r) } } return o }
  }
  // a primitive written as an object, possibly with a logical type
  if (lt === 'date' && type === 'int') return (r) => dateText(r.long())
  if ((lt === 'timestamp-millis' || lt === 'local-timestamp-millis') && type === 'long') return (r) => { const v = r.long(); return typeof v === 'number' ? tsText(v) : v }
  if ((lt === 'timestamp-micros' || lt === 'local-timestamp-micros') && type === 'long') return (r) => { const v = r.long(); return typeof v === 'number' ? tsText(Math.round(v / 1000)) : v }
  if (lt === 'time-millis' && type === 'int') return (r) => timeText(r.long())
  if (lt === 'time-micros' && type === 'long') return (r) => { const v = r.long(); return typeof v === 'number' ? timeText(v / 1000) : v }
  if (lt === 'decimal' && type === 'bytes') return (r) => decimalText(r.bytes(), schema.scale || 0)
  return compile(type, names, ns)
}

function primitive(t) {
  switch (t) {
    case 'null': return () => null
    case 'boolean': return (r) => r.b[r.p++] !== 0
    case 'int': case 'long': return (r) => r.long()
    case 'float': return (r) => { const v = r.dv.getFloat32(r.p, true); r.p += 4; return v }
    case 'double': return (r) => { const v = r.dv.getFloat64(r.p, true); r.p += 8; return v }
    case 'bytes': return (r) => b64(r.bytes())
    case 'string': return (r) => r.string()
    default: throw new DataError(`The Avro schema uses a type this reader does not know: ${t}.`)
  }
}

/** Read an Avro file. Returns { columns: [{name}], rows: number, json: JSON Lines text, schema }. */
export async function readAvro(bytes, { maxRows = Infinity } = {}) {
  if (bytes.length < 20 || td.decode(bytes.subarray(0, 3)) !== 'Obj' || bytes[3] !== 1) throw new DataError('This is not an Avro container file (it does not start with the Avro header).')
  const r = new Reader(bytes)
  r.p = 4
  const meta = {}
  for (;;) {
    let n = r.long()
    if (!n) break
    if (n < 0) { n = -n; r.long() }
    for (let i = 0; i < n; i++) { const k = r.string(); meta[k] = r.bytes() }
  }
  const sync = r.take(16)
  let schema
  try { schema = JSON.parse(td.decode(meta['avro.schema'])) } catch { throw new DataError('The Avro file has no readable schema.') }
  const codec = meta['avro.codec'] ? td.decode(meta['avro.codec']) : 'null'
  if (!['null', 'deflate', 'snappy'].includes(codec)) throw new DataError(`This Avro file uses the "${codec}" codec, which is not supported in the browser yet. Re-save it with snappy, deflate or no compression.`)
  const read = compile(schema, new Map())
  const isRecord = schema && typeof schema === 'object' && !Array.isArray(schema) && schema.type === 'record'
  const columns = isRecord ? schema.fields.map((f) => ({ name: f.name })) : [{ name: 'value' }]
  const lines = []
  while (!r.eof() && lines.length < maxRows) {
    const count = r.long()
    const size = r.long()
    let data = r.take(size)
    const mark = r.take(16)
    if (mark.length !== 16 || mark.some((x, i) => x !== sync[i])) throw new DataError('The Avro file is damaged (a block does not match the sync marker).')
    if (codec === 'deflate') data = await inflateRaw(data)
    else if (codec === 'snappy') data = snappy(data.subarray(0, data.length - 4)) // the last 4 bytes are a CRC
    const br = new Reader(data)
    for (let i = 0; i < count && lines.length < maxRows; i++) {
      const v = read(br)
      lines.push(JSON.stringify(isRecord ? v : { value: v }))
    }
  }
  return { columns, rows: lines.length, json: lines.join('\n'), schema }
}
