// Property list reader and writer shared by the plist viewer and the IPA inspector. DOM-free so Node tests can import it.
// Values are typed nodes so nothing is lost in a round trip:
//   { t: 'dict', v: [[key, node], ...] }   { t: 'array', v: [node, ...] }   { t: 'string', v: 'text' }
//   { t: 'int', v: bigint }  { t: 'real', v: number }  { t: 'bool', v: true }  { t: 'date', v: Date }
//   { t: 'data', v: Uint8Array }  { t: 'uid', v: number }  { t: 'null' }
// Binary plists (bplist00) and XML plists are read; both are also written. JSON export maps data to base64 and dates to ISO.

const APPLE_EPOCH = Date.UTC(2001, 0, 1) // bplist dates are seconds since 2001-01-01 UTC

export const node = {
  dict: (entries) => ({ t: 'dict', v: entries }),
  array: (items) => ({ t: 'array', v: items }),
  string: (s) => ({ t: 'string', v: s }),
  int: (n) => ({ t: 'int', v: BigInt(n) }),
  real: (n) => ({ t: 'real', v: n }),
  bool: (b) => ({ t: 'bool', v: !!b }),
  date: (d) => ({ t: 'date', v: d }),
  data: (u8) => ({ t: 'data', v: u8 }),
  uid: (n) => ({ t: 'uid', v: n }),
  null: () => ({ t: 'null' }),
}

const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }

/** Which plist flavour the bytes look like: 'binary', 'xml', 'json' or null. */
export function sniffPlist(bytes) {
  if (bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 6)) === 'bplist') return 'binary'
  let i = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3
  while (i < bytes.length && i < 4096 && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)) i++
  if (bytes[i] === 0x3c) return 'xml'
  if (bytes[i] === 0x7b || bytes[i] === 0x5b) return 'json'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'xml' // UTF-16 BE BOM
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'xml' // UTF-16 LE BOM
  return null
}

/** Parse plist bytes of either kind into a typed node. */
export function parsePlist(bytes) {
  const kind = sniffPlist(bytes)
  if (kind === 'binary') return parseBplist(bytes)
  if (kind === 'xml') return parseXmlPlist(decodeText(bytes))
  if (kind === 'json') return fromJSON(JSON.parse(decodeText(bytes)))
  fail('This is not a property list. Expected a binary plist (bplist00) or an XML plist.')
}

export function decodeText(bytes) {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  return new TextDecoder().decode(bytes)
}

// ---------- Binary plist reader ----------

/** Parse a bplist00 file. Handles 1/2/4/8/16 byte ints (8 byte ints become BigInt, signed), all object types and reference cycles. */
export function parseBplist(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (b.length < 40 || String.fromCharCode(...b.subarray(0, 6)) !== 'bplist') fail('Not a binary plist (missing the bplist header).')
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const t = b.length - 32
  const offSize = b[t + 6], refSize = b[t + 7]
  const numObjects = Number(dv.getBigUint64(t + 8)), top = Number(dv.getBigUint64(t + 16)), tableOff = Number(dv.getBigUint64(t + 24))
  if (!offSize || !refSize || offSize > 8 || refSize > 8) fail('This binary plist has a damaged trailer.')
  if (tableOff + numObjects * offSize > t || top >= numObjects) fail('This binary plist is truncated or damaged (offset table out of range).')
  const uint = (o, n) => {
    if (o + n > b.length) fail('This binary plist is truncated.')
    let v = 0
    for (let i = 0; i < n; i++) v = v * 256 + b[o + i]
    return v
  }
  const offsets = new Array(numObjects)
  for (let i = 0; i < numObjects; i++) offsets[i] = uint(tableOff + i * offSize, offSize)
  const cache = new Map()
  const active = new Set()

  function readInt(o, n) { // n bytes big-endian, returns bigint
    if (n === 8) return dv.getBigInt64(o)
    if (n === 16) return dv.getBigInt64(o + 8) // 128-bit ints only appear for values over 2^63; keep the low 64 bits signed
    return BigInt(uint(o, n))
  }
  function count(o, info, unit = 1) { // returns [count, dataStart]; unit is the byte size of one item, used to bounds-check
    let r
    if (info !== 0x0f) r = [info, o + 1]
    else {
      const m = b[o + 1]
      if ((m & 0xf0) !== 0x10) fail('This binary plist has a damaged length field.')
      const n = 1 << (m & 0x0f)
      r = [Number(readInt(o + 2, n)), o + 2 + n]
    }
    if (r[0] < 0 || r[1] + r[0] * unit > t) fail('This binary plist is truncated (an object runs past the end).')
    return r
  }
  // Objects can be shared, so a tiny file can describe a huge tree. Cap the expanded size so viewing it cannot hang the tab.
  const MAX_EXPANDED = 5_000_000
  const sizes = new Map()
  const child = (ref) => { const n = obj(ref); return [n, sizes.get(ref) || 1] }
  function obj(ref) {
    if (ref >= numObjects) fail('This binary plist refers to an object that does not exist.')
    if (cache.has(ref)) return cache.get(ref)
    if (active.has(ref)) fail('This binary plist contains a reference loop.')
    active.add(ref)
    const o = offsets[ref]
    if (o >= t) fail('This binary plist has an object offset out of range.')
    const m = b[o], hi = m >> 4, info = m & 0x0f
    let r, size = 1
    switch (hi) {
      case 0x0:
        r = info === 0x08 ? node.bool(false) : info === 0x09 ? node.bool(true) : node.null()
        break
      case 0x1: r = node.int(readInt(o + 1, 1 << info)); break
      case 0x2: r = node.real(info === 2 ? dv.getFloat32(o + 1) : dv.getFloat64(o + 1)); break
      case 0x3: r = node.date(new Date(APPLE_EPOCH + dv.getFloat64(o + 1) * 1000)); break
      case 0x4: { const [n, s] = count(o, info); r = node.data(b.slice(s, s + n)); break }
      case 0x5: { const [n, s] = count(o, info); let str = ''; for (let i = 0; i < n; i++) str += String.fromCharCode(b[s + i]); r = node.string(str); break }
      case 0x6: { const [n, s] = count(o, info, 2); let str = ''; for (let i = 0; i < n; i++) str += String.fromCharCode(dv.getUint16(s + i * 2)); r = node.string(str); break }
      case 0x7: { const [n, s] = count(o, info); r = node.string(new TextDecoder().decode(b.subarray(s, s + n))); break }
      case 0x8: r = node.uid(uint(o + 1, info + 1)); break
      case 0xa: case 0xb: case 0xc: {
        const [n, s] = count(o, info, refSize)
        const items = []
        r = node.array(items)
        for (let i = 0; i < n; i++) { const [c, cs] = child(uint(s + i * refSize, refSize)); items.push(c); size += cs }
        break
      }
      case 0xd: {
        const [n, s] = count(o, info, refSize * 2)
        const entries = []
        r = node.dict(entries)
        for (let i = 0; i < n; i++) {
          const k = obj(uint(s + i * refSize, refSize))
          const [v, vs] = child(uint(s + (n + i) * refSize, refSize))
          entries.push([k.t === 'string' ? k.v : String(k.v), v])
          size += vs
        }
        break
      }
      default: fail(`This binary plist has an unknown object type (0x${m.toString(16)}).`)
    }
    if (size > MAX_EXPANDED) fail('This binary plist reuses objects so often that it expands to millions of values, which is too many to show.')
    active.delete(ref)
    sizes.set(ref, size)
    cache.set(ref, r)
    return r
  }
  return obj(top)
}

// ---------- XML reader (small, DOM-free) ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
  return ENT[e] ?? m
})

/** Tiny XML tokenizer: returns the root element as {name, attrs, kids: [elements | text strings]}. Enough for plists. */
export function parseXml(text) {
  let i = 0
  const n = text.length
  const stack = [{ name: '#doc', attrs: {}, kids: [] }]
  while (i < n) {
    const lt = text.indexOf('<', i)
    if (lt < 0) { pushText(text.slice(i)); break }
    if (lt > i) pushText(text.slice(i, lt))
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); if (e < 0) fail('The XML has an unclosed comment.'); i = e + 3; continue }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); if (e < 0) fail('The XML has an unclosed CDATA section.'); stack.at(-1).kids.push(text.slice(lt + 9, e)); i = e + 3; continue }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt + 2); if (e < 0) fail('The XML has a damaged declaration.'); i = e + 2; continue }
    if (text.startsWith('<!', lt)) { // DOCTYPE, possibly with an internal subset
      let depth = 0, j = lt + 2
      for (; j < n; j++) { const c = text[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break }
      i = j + 1
      continue
    }
    const gt = text.indexOf('>', lt)
    if (gt < 0) fail('The XML ends in the middle of a tag.')
    const raw = text.slice(lt + 1, gt)
    i = gt + 1
    if (raw[0] === '/') {
      const name = raw.slice(1).trim()
      const top = stack.pop()
      if (!top || top.name !== name) fail(`The XML is not well formed: </${name}> does not match <${top?.name}>.`)
      stack.at(-1).kids.push(top)
      continue
    }
    const self = raw.endsWith('/')
    const body = self ? raw.slice(0, -1) : raw
    const m = body.match(/^\s*([^\s/>]+)/)
    if (!m) fail('The XML has an empty tag.')
    const el = { name: m[1], attrs: {}, kids: [] }
    for (const a of body.slice(m[0].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = unescapeXml(a[3] ?? a[4])
    if (self) stack.at(-1).kids.push(el)
    else stack.push(el)
  }
  if (stack.length !== 1) fail(`The XML ends before <${stack.at(-1).name}> is closed.`)
  const root = stack[0].kids.find((k) => typeof k === 'object')
  if (!root) fail('No XML element found.')
  return root

  function pushText(s) { stack.at(-1).kids.push(unescapeXml(s)) }
}

const elKids = (el) => el.kids.filter((k) => typeof k === 'object')
const textOf = (el) => el.kids.filter((k) => typeof k === 'string').join('')

/** Parse XML plist text into a typed node. Also accepts the <?xml ... </plist> text embedded in a .mobileprovision. */
export function parseXmlPlist(text) {
  const root = parseXml(text.replace(/^﻿/, ''))
  let top = root
  if (root.name === 'plist') {
    const kids = elKids(root)
    if (!kids.length) return node.dict([])
    top = kids[0]
  }
  return xmlNode(top)
}

function xmlNode(el) {
  switch (el.name) {
    case 'dict': {
      const kids = elKids(el)
      const entries = []
      for (let i = 0; i < kids.length; i++) {
        if (kids[i].name !== 'key') fail(`A plist <dict> expects <key> but found <${kids[i].name}>.`)
        const val = kids[i + 1]
        if (!val) fail(`The key "${textOf(kids[i])}" has no value.`)
        entries.push([textOf(kids[i]), xmlNode(val)])
        i++
      }
      // A dict with only CF$UID is how XML stores a UID
      if (entries.length === 1 && entries[0][0] === 'CF$UID' && entries[0][1].t === 'int') return node.uid(Number(entries[0][1].v))
      return node.dict(entries)
    }
    case 'array': return node.array(elKids(el).map(xmlNode))
    case 'string': return node.string(textOf(el))
    case 'key': return node.string(textOf(el))
    case 'integer': {
      const s = textOf(el).trim()
      try { return node.int(BigInt(/^-?0x/i.test(s) ? (s[0] === '-' ? -BigInt(s.slice(1)) : s) : s || '0')) } catch { fail(`"${s}" is not a valid plist integer.`) }
      break
    }
    case 'real': {
      const s = textOf(el).trim()
      const v = /^[+-]?inf(inity)?$/i.test(s) ? (s[0] === '-' ? -Infinity : Infinity) : /^nan$/i.test(s) ? NaN : Number(s)
      if (Number.isNaN(v) && !/^nan$/i.test(s)) fail(`"${s}" is not a valid plist real.`)
      return node.real(v)
    }
    case 'true': return node.bool(true)
    case 'false': return node.bool(false)
    case 'date': {
      const d = new Date(textOf(el).trim())
      if (Number.isNaN(d.getTime())) fail(`"${textOf(el)}" is not a valid plist date.`)
      return node.date(d)
    }
    case 'data': return node.data(b64decode(textOf(el)))
    default: fail(`Unknown plist element <${el.name}>.`)
  }
}

// ---------- base64 (works in browsers and Node) ----------
export function b64decode(s) {
  const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function b64encode(u8) {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

// ---------- Writers ----------

const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const isoDate = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
function realText(v) {
  if (Number.isNaN(v)) return 'nan'
  if (v === Infinity) return '+infinity'
  if (v === -Infinity) return '-infinity'
  const s = String(v)
  return /[.eE]/.test(s) ? s : s + '.0'
}

/** Write a typed node as an XML plist string (tabs, like Apple tools). */
export function writeXmlPlist(root) {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">', '<plist version="1.0">']
  const walk = (n, ind) => {
    const p = '\t'.repeat(ind)
    switch (n.t) {
      case 'dict':
        if (!n.v.length) { out.push(`${p}<dict/>`); break }
        out.push(`${p}<dict>`)
        for (const [k, v] of n.v) { out.push(`${p}\t<key>${escXml(k)}</key>`); walk(v, ind + 1) }
        out.push(`${p}</dict>`)
        break
      case 'array':
        if (!n.v.length) { out.push(`${p}<array/>`); break }
        out.push(`${p}<array>`)
        for (const v of n.v) walk(v, ind + 1)
        out.push(`${p}</array>`)
        break
      case 'string': out.push(`${p}<string>${escXml(n.v)}</string>`); break
      case 'int': out.push(`${p}<integer>${n.v}</integer>`); break
      case 'real': out.push(`${p}<real>${realText(n.v)}</real>`); break
      case 'bool': out.push(`${p}<${n.v ? 'true' : 'false'}/>`); break
      case 'date': out.push(`${p}<date>${isoDate(n.v)}</date>`); break
      case 'data': {
        const b = b64encode(n.v)
        if (b.length <= 68) out.push(`${p}<data>${b}</data>`)
        else { out.push(`${p}<data>`); for (let i = 0; i < b.length; i += 68) out.push(p + b.slice(i, i + 68)); out.push(`${p}</data>`) }
        break
      }
      case 'uid': out.push(`${p}<dict>`, `${p}\t<key>CF$UID</key>`, `${p}\t<integer>${n.v}</integer>`, `${p}</dict>`); break
      case 'null': out.push(`${p}<string></string>`); break // XML plists have no null; an empty string is the closest
      default: fail(`Unknown node type ${n.t}`)
    }
  }
  walk(root, 0)
  out.push('</plist>', '')
  return out.join('\n')
}

/** Write a typed node as a bplist00 Uint8Array. Strings, numbers and dates are de-duplicated like Apple's writer does. */
export function writeBplist(root) {
  const objs = [] // flattened: {n, refs}
  const uniq = new Map()
  const keyOf = (n) => {
    switch (n.t) {
      case 'string': return 's' + n.v
      case 'int': return 'i' + n.v
      case 'real': return 'r' + n.v
      case 'bool': return 'b' + n.v
      case 'date': return 'd' + n.v.getTime()
      case 'uid': return 'u' + n.v
      case 'null': return 'n'
      default: return null
    }
  }
  const seen = new Set()
  const add = (n) => {
    const k = keyOf(n)
    if (k != null && uniq.has(k)) return uniq.get(k)
    if (seen.has(n)) fail('This plist contains a loop and cannot be written.')
    const idx = objs.length
    const rec = { n, refs: null }
    objs.push(rec)
    if (k != null) uniq.set(k, idx)
    if (n.t === 'array') { seen.add(n); rec.refs = n.v.map(add); seen.delete(n) } else if (n.t === 'dict') {
      seen.add(n)
      const ks = n.v.map(([key]) => add(node.string(key)))
      const vs = n.v.map(([, v]) => add(v))
      rec.refs = [...ks, ...vs]
      seen.delete(n)
    }
    return idx
  }
  add(root)
  const refSize = objs.length < 256 ? 1 : objs.length < 65536 ? 2 : 4
  const chunks = []
  let pos = 8
  const offsets = []
  const push = (u8) => { chunks.push(u8); pos += u8.length }
  const be = (v, n) => { const a = new Uint8Array(n); let x = BigInt(v); for (let i = n - 1; i >= 0; i--) { a[i] = Number(x & 0xffn); x >>= 8n } return a }
  const intBytes = (v) => { // marker + payload for an integer
    const x = BigInt(v)
    if (x < 0n) return [0x13, be(BigInt.asUintN(64, x), 8)]
    if (x < 0x100n) return [0x10, be(x, 1)]
    if (x < 0x10000n) return [0x11, be(x, 2)]
    if (x < 0x100000000n) return [0x12, be(x, 4)]
    if (x < 0x8000000000000000n) return [0x13, be(x, 8)]
    return [0x14, be(x, 16)]
  }
  const header = (hi, n) => {
    if (n < 15) return Uint8Array.of((hi << 4) | n)
    const [m, p] = intBytes(n)
    return Uint8Array.of((hi << 4) | 0x0f, m, ...p)
  }
  for (const { n, refs } of objs) {
    offsets.push(pos)
    switch (n.t) {
      case 'null': push(Uint8Array.of(0x00)); break
      case 'bool': push(Uint8Array.of(n.v ? 0x09 : 0x08)); break
      case 'int': { const [m, p] = intBytes(n.v); push(Uint8Array.of(m, ...p)); break }
      case 'real': { const a = new Uint8Array(9); a[0] = 0x23; new DataView(a.buffer).setFloat64(1, n.v); push(a); break }
      case 'date': { const a = new Uint8Array(9); a[0] = 0x33; new DataView(a.buffer).setFloat64(1, (n.v.getTime() - APPLE_EPOCH) / 1000); push(a); break }
      case 'data': push(header(0x4, n.v.length)); push(n.v); break
      case 'string': {
        if (/^[\x00-\x7f]*$/.test(n.v)) {
          push(header(0x5, n.v.length))
          const a = new Uint8Array(n.v.length)
          for (let i = 0; i < a.length; i++) a[i] = n.v.charCodeAt(i)
          push(a)
        } else {
          push(header(0x6, n.v.length))
          const a = new Uint8Array(n.v.length * 2)
          const dv = new DataView(a.buffer)
          for (let i = 0; i < n.v.length; i++) dv.setUint16(i * 2, n.v.charCodeAt(i))
          push(a)
        }
        break
      }
      case 'uid': {
        const len = n.v < 0x100 ? 1 : n.v < 0x10000 ? 2 : 4
        push(Uint8Array.of(0x80 | (len - 1), ...be(n.v, len)))
        break
      }
      case 'array': case 'dict': {
        push(header(n.t === 'array' ? 0xa : 0xd, n.t === 'array' ? refs.length : refs.length / 2))
        const a = new Uint8Array(refs.length * refSize)
        refs.forEach((r, i) => a.set(be(r, refSize), i * refSize))
        push(a)
        break
      }
      default: fail(`Unknown node type ${n.t}`)
    }
  }
  const tableOff = pos
  const offSize = tableOff < 256 ? 1 : tableOff < 65536 ? 2 : tableOff < 2 ** 32 ? 4 : 8
  const table = new Uint8Array(offsets.length * offSize)
  offsets.forEach((o, i) => table.set(be(o, offSize), i * offSize))
  const trailer = new Uint8Array(32)
  trailer[6] = offSize
  trailer[7] = refSize
  trailer.set(be(objs.length, 8), 8)
  trailer.set(be(0, 8), 16)
  trailer.set(be(tableOff, 8), 24)
  const all = [Uint8Array.from('bplist00', (c) => c.charCodeAt(0)), ...chunks, table, trailer]
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0))
  let o = 0
  for (const a of all) { out.set(a, o); o += a.length }
  return out
}

// ---------- JSON and plain values ----------

/** Typed node -> JSON-safe value (data as base64, dates as ISO strings, UIDs as {"CF$UID": n}, big ints as strings). */
export function toJSONValue(n) {
  switch (n.t) {
    case 'dict': { const o = {}; for (const [k, v] of n.v) o[k] = toJSONValue(v); return o }
    case 'array': return n.v.map(toJSONValue)
    case 'int': return n.v >= BigInt(Number.MIN_SAFE_INTEGER) && n.v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n.v) : String(n.v)
    case 'real': return Number.isFinite(n.v) ? n.v : String(n.v)
    case 'date': return n.v.toISOString()
    case 'data': return b64encode(n.v)
    case 'uid': return { 'CF$UID': n.v }
    case 'null': return null
    default: return n.v
  }
}
export const toJSONText = (n) => JSON.stringify(toJSONValue(n), null, 2)

/** JSON value -> typed node. Integers become <integer>, other numbers <real>; nulls are kept as null nodes. */
export function fromJSON(v) {
  if (v === null || v === undefined) return node.null()
  if (Array.isArray(v)) return node.array(v.map(fromJSON))
  switch (typeof v) {
    case 'string': return node.string(v)
    case 'boolean': return node.bool(v)
    case 'number': return Number.isInteger(v) ? node.int(v) : node.real(v)
    case 'object': {
      const keys = Object.keys(v)
      if (keys.length === 1 && keys[0] === 'CF$UID' && Number.isInteger(v['CF$UID'])) return node.uid(v['CF$UID'])
      return node.dict(keys.map((k) => [k, fromJSON(v[k])]))
    }
    default: return node.string(String(v))
  }
}

/** Typed node -> plain JS (dict -> object, int -> number or BigInt when unsafe, data -> Uint8Array, date -> Date). Handy for reading Info.plist fields. */
export function toPlain(n) {
  switch (n.t) {
    case 'dict': { const o = {}; for (const [k, v] of n.v) o[k] = toPlain(v); return o }
    case 'array': return n.v.map(toPlain)
    case 'int': return n.v >= BigInt(Number.MIN_SAFE_INTEGER) && n.v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n.v) : n.v
    case 'null': return null
    default: return n.v
  }
}

/** Count nodes (for stats). */
export function countNodes(n) {
  let c = 1
  if (n.t === 'dict') for (const [, v] of n.v) c += countNodes(v)
  else if (n.t === 'array') for (const v of n.v) c += countNodes(v)
  return c
}

/** Find the XML plist inside a CMS-signed .mobileprovision (or any bytes) and parse it. Returns null when none is found. */
export function extractEmbeddedPlist(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const a = s.indexOf('<?xml')
  const e = s.indexOf('</plist>', a)
  if (a < 0 || e < 0) return null
  const raw = s.slice(a, e + 8)
  const text = new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)))
  return { text, plist: parseXmlPlist(text) }
}
