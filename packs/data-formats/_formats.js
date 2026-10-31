// Universal data-format engine: JSON, JSON Lines, YAML, TOML, XML, CSV, TSV, XLSX, INI, .properties, .env, PLIST, JSON5, HJSON,
// MessagePack and CBOR. Every format is parsed into a plain JS value and written from one, so any pair converts.
// DOM-free (libraries are loaded lazily), so the File Converter hub and the unit tests can import it cheaply.
import { papaparse, xlsx as loadXlsx } from '../../lib/libs.js'
import { node as pnode, parsePlist, parseXmlPlist, toPlain, writeXmlPlist, sniffPlist } from '../reverse/_pkg-plist.js'

const jsd = (path) => `https://cdn.jsdelivr.net/npm/${path}`
const memo = new Map()
const lazy = (key, fn) => {
  if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw Object.assign(new Error(`Could not load ${key}. Check your connection and try again.`), { cause: e }) }))
  return memo.get(key)
}
// js-yaml (YAML), smol-toml (TOML), fast-xml-parser (XML), @msgpack/msgpack, cbor-x, json5, hjson: pinned, loaded on first use.
const yamlLib = () => lazy('the YAML library', () => import(jsd('js-yaml@5.4.2/+esm')))
const tomlLib = () => lazy('the TOML library', () => import(jsd('smol-toml@1.9.0/+esm')))
const xmlLib = () => lazy('the XML library', () => import(jsd('fast-xml-parser@5.11.2/+esm')))
const msgpackLib = () => lazy('the MessagePack library', () => import(jsd('@msgpack/msgpack@3.1.3/+esm')))
const cborLib = () => lazy('the CBOR library', () => import(jsd('cbor-x@1.6.6/+esm')))
const json5Lib = () => lazy('the JSON5 library', () => import(jsd('json5@2.2.3/+esm')).then((m) => m.default || m))
const hjsonLib = () => lazy('the HJSON library', () => import(jsd('hjson@3.2.2/+esm')).then((m) => m.default || m))

/** A user-facing error, optionally with a position. */
export class DataError extends Error {
  constructor(message, o = {}) { super(message); this.name = 'DataError'; this.userMessage = message; this.line = o.line; this.col = o.col; this.lines = o.lines }
}
const aborted = () => Object.assign(new Error('Cancelled'), { code: 'ABORT', name: 'AbortError' })
const tick = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)))

// ---------- Formats ----------
export const FORMATS = {
  json: { label: 'JSON', exts: ['json'], mime: 'application/json' },
  jsonl: { label: 'JSON Lines', exts: ['jsonl', 'ndjson'], mime: 'application/x-ndjson' },
  yaml: { label: 'YAML', exts: ['yaml', 'yml'], mime: 'application/yaml' },
  toml: { label: 'TOML', exts: ['toml'], mime: 'application/toml' },
  xml: { label: 'XML', exts: ['xml'], mime: 'application/xml' },
  csv: { label: 'CSV', exts: ['csv'], mime: 'text/csv', table: true },
  tsv: { label: 'TSV', exts: ['tsv', 'tab'], mime: 'text/tab-separated-values', table: true },
  xlsx: { label: 'Excel (XLSX)', exts: ['xlsx', 'xlsm'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', table: true, binary: true },
  ini: { label: 'INI', exts: ['ini', 'cfg', 'conf'], mime: 'text/plain' },
  properties: { label: '.properties', exts: ['properties'], mime: 'text/plain' },
  env: { label: '.env', exts: ['env'], mime: 'text/plain' },
  plist: { label: 'Property list (plist)', exts: ['plist'], mime: 'application/x-plist' },
  json5: { label: 'JSON5', exts: ['json5'], mime: 'application/json5' },
  hjson: { label: 'HJSON', exts: ['hjson'], mime: 'application/hjson', readOnly: true },
  msgpack: { label: 'MessagePack', exts: ['msgpack', 'mpk'], mime: 'application/msgpack', binary: true },
  cbor: { label: 'CBOR', exts: ['cbor'], mime: 'application/cbor', binary: true },
}
export const EXT_TO_FORMAT = Object.fromEntries(Object.entries(FORMATS).flatMap(([k, f]) => f.exts.map((e) => [e, k])))
export const isBinaryFormat = (f) => !!FORMATS[f]?.binary
export const READ_FORMATS = Object.keys(FORMATS)
export const WRITE_FORMATS = Object.keys(FORMATS).filter((f) => !FORMATS[f].readOnly)
export const outExt = (f) => FORMATS[f].exts[0]

export const DEFAULTS = {
  indent: 2, // 2 | 4 | 'tab' | 0 (minified)
  flatten: 'dotted', // tables: 'dotted' (a.b.c columns) | 'json' (nested values kept as JSON text)
  nest: true, // tables: rebuild nested data from dotted headers
  infer: true, // convert text that looks like a number or true/false
  parseJson: true, // tables: cells that hold JSON objects or lists become real data
  empty: 'empty', // tables: empty cells become '' | null | are left out
  header: true, // tables: first row holds the column names
  records: '', // tables: path to the list of records, blank to find it
  delimiter: ',', // CSV output
  bom: false, // CSV and TSV output: UTF-8 byte order mark (helps older Excel with accents)
  sheet: 'first', // XLSX input: 'first' | 'all' | a sheet name
  sheetName: 'Sheet1', // XLSX output
  typedXlsx: true, // XLSX output: real numbers and dates
  attrPrefix: '@', // XML attribute marker
  textKey: '#text', // XML text marker
  ignoreAttrs: false, // XML input: drop attributes
  rootName: 'root', // XML output: wrapper element when needed
  skipBad: false, // JSON Lines input: leave out lines that are not valid JSON
  sortKeys: false, // TOML output: sort keys
  yamlDocs: false, // YAML output: a list becomes separate documents
  expand: true, // .properties input: build nested data from dotted keys
  upper: false, // .env output: UPPER_CASE keys
  unicodeEscape: false, // .properties output: write non-ASCII as \uXXXX
  binText: 'base64', // text mode for MessagePack/CBOR: 'base64' | 'hex'
}

// ---------- Small helpers ----------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const pad = (n, w = 2) => String(n).padStart(w, '0')

export function bytesToBase64(u8) {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}
export function base64ToBytes(b64) {
  const s = atob(b64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
export const bytesToHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join(' ')
export function hexToBytes(text) {
  const t = text.replace(/0x/gi, '').replace(/\\x/gi, '').replace(/[\s,:-]+/g, '')
  if (!/^[0-9a-fA-F]*$/.test(t) || t.length % 2) throw new DataError('That is not valid hex. Use pairs of digits 0-9 and a-f, like "82 a1 61 01".')
  const out = new Uint8Array(t.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16)
  return out
}
/** Turn pasted hex or Base64 into bytes (the chosen form first, the other as a fallback). */
export function textToBytes(text, form = 'base64') {
  const t = text.trim()
  if (!t) return new Uint8Array(0)
  const tries = form === 'hex' ? [hexToBytes, base64ToBytes] : [base64ToBytes, hexToBytes]
  for (const f of tries) { try { return f(t) } catch { /* try the next one */ } }
  throw new DataError(`That is not valid ${form === 'hex' ? 'hex' : 'Base64'}. Paste the bytes as ${form === 'hex' ? 'hex digits' : 'Base64 text'}, or use the Files tab.`)
}
export const bytesToText = (u8, form = 'base64') => (form === 'hex' ? bytesToHex(u8) : bytesToBase64(u8))

/** Decode bytes to text: UTF-8 (with or without BOM), UTF-16 BOMs, else Windows-1252. */
export function decodeText(input) {
  if (typeof input === 'string') return input
  const b = input
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2))
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^\uFEFF/, '') } catch { return new TextDecoder('windows-1252').decode(b) }
}

/** Dates become ISO text (TOML local dates and times keep their own form); formats that store real dates keep them. */
function dateOut(x, keepRich) {
  const toml = typeof x.isDateTime === 'function'
  if (keepRich && !(toml && x.isLocal())) return new Date(x.getTime())
  if (Number.isNaN(x.getTime())) return null
  return x.toISOString().replace(/\.000(?=Z|[+-]\d\d:\d\d|$)/, '')
}
/** Make a value safe for any writer: dates and bytes become text (unless the target keeps them), BigInt, Map, Set and undefined are normalised. */
export function plain(v, keepRich = false) {
  const go = (x) => {
    if (x === undefined) return null
    if (x === null) return null
    if (typeof x === 'bigint') return x >= BigInt(Number.MIN_SAFE_INTEGER) && x <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(x) : (keepRich ? x : x.toString())
    if (x instanceof Date) return dateOut(x, keepRich)
    if (x instanceof Uint8Array || x instanceof ArrayBuffer) return keepRich ? new Uint8Array(x) : bytesToBase64(new Uint8Array(x))
    if (ArrayBuffer.isView(x)) return keepRich ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : bytesToBase64(new Uint8Array(x.buffer, x.byteOffset, x.byteLength))
    if (Array.isArray(x) || x instanceof Set) return [...x].map(go)
    if (x instanceof Map) { const o = {}; for (const [k, val] of x) o[String(k)] = go(val); return o }
    if (typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) Object.defineProperty(o, k, { value: go(x[k]), enumerable: true, writable: true, configurable: true }); return o }
    if (typeof x === 'function' || typeof x === 'symbol') return null
    return x
  }
  return go(v)
}

const NUM_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/
/** "12" -> 12, "true" -> true, anything else stays text. Numbers that would lose digits stay text. */
export function inferScalar(s) {
  if (typeof s !== 'string') return s
  const t = s.trim()
  if (NUM_RE.test(t) && t.replace(/[-.eE+]|^0+(?=\d)/g, '').replace(/^0+/, '').length <= 15) {
    const n = Number(t)
    if (Number.isFinite(n)) return n
  }
  if (/^true$/i.test(t)) return true
  if (/^false$/i.test(t)) return false
  return s
}

const PATH_RE = /^[^\s.[\]]+(?:\.[^\s.[\]]+|\[\d+\])+$/
/** Put value at a dotted (a.b.c) or bracket (a[0].b) path. Returns false when the path collides with existing data. */
export function setPath(obj, key, value) {
  if (!PATH_RE.test(key)) {
    if (hasOwn(obj, key)) return false
    obj[key] = value
    return true
  }
  const tokens = key.match(/[^.[\]]+/g)
  if (tokens.includes('__proto__')) return false
  let cur = obj
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i]
    if (!hasOwn(cur, t)) cur[t] = {}
    else if (!isObj(cur[t])) return false
    cur = cur[t]
  }
  const last = tokens[tokens.length - 1]
  if (hasOwn(cur, last)) return false
  cur[last] = value
  return true
}
/** Objects whose keys are exactly 0..n-1 become arrays (the way a.0, a.1 or a[0] columns come back). */
export function arrayify(v) {
  if (Array.isArray(v)) return v.map(arrayify)
  if (!isObj(v)) return v
  const keys = Object.keys(v)
  for (const k of keys) v[k] = arrayify(v[k])
  if (keys.length && keys.every((k) => /^(0|[1-9]\d*)$/.test(k))) {
    const idx = keys.map(Number).sort((a, b) => a - b)
    if (idx.every((n, i) => n === i)) return idx.map((n) => v[String(n)])
  }
  return v
}
/** Nested value -> flat { "a.b": 1, "list.0": 2 }. style 'bracket' writes list[0]. Empty lists and objects become "[]" and "{}". */
export function flattenValue(v, { style = 'dot', sep = '.' } = {}) {
  const out = {}
  const go = (x, key) => {
    if (Array.isArray(x)) {
      if (!x.length) out[key] = '[]'
      else x.forEach((item, i) => go(item, style === 'bracket' ? `${key}[${i}]` : key ? `${key}${sep}${i}` : String(i)))
    } else if (isObj(x)) {
      const ks = Object.keys(x)
      if (!ks.length && key) out[key] = '{}'
      for (const k of ks) go(x[k], key ? `${key}${sep}${k}` : k)
    } else out[key || 'value'] = x
  }
  go(v, '')
  return out
}

function lineColAt(text, pos) {
  let line = 1, last = -1
  for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) { line++; last = i }
  return { line, col: pos - last }
}

// ---------- JSON, JSON Lines, JSON5, HJSON ----------
function parseJson(text) {
  const t = text.replace(/^\uFEFF/, '')
  if (!t.trim()) throw new DataError('The JSON is empty.')
  try { return JSON.parse(t) } catch (e) {
    const m = /position (\d+)/.exec(e.message)
    const lc = /line (\d+) column (\d+)/.exec(e.message)
    const pos = m ? lineColAt(t, Number(m[1])) : lc ? { line: Number(lc[1]), col: Number(lc[2]) } : null
    const why = e.message.replace(/ in JSON at position \d+.*$/, '').replace(/ \(line \d+ column \d+\)/, '')
    throw new DataError(`That is not valid JSON${pos ? ` (line ${pos.line}, column ${pos.col})` : ''}: ${why}.`, pos || {})
  }
}
/** JSON Lines: one value per line. Returns { values, errors: [{line, message}], lines }. Blank lines are skipped. */
export function parseJsonl(text) {
  const values = [], errors = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  lines.forEach((ln, i) => {
    if (!ln.trim()) return
    try { values.push(JSON.parse(ln)) } catch (e) { errors.push({ line: i + 1, message: String(e.message).replace(/ in JSON at position \d+.*$/, ''), text: ln }) }
  })
  return { values, errors, lines: lines.length }
}
function readJsonl(text, o) {
  const { values, errors } = parseJsonl(text)
  if (errors.length && o.skipBad) { o._warn?.(`${errors.length} invalid line${errors.length === 1 ? ' was' : 's were'} skipped (${errors.slice(0, 5).map((e) => e.line).join(', ')}${errors.length > 5 ? ', ...' : ''}).`); return values }
  if (errors.length) {
    throw new DataError(`${errors.length} line${errors.length === 1 ? ' is' : 's are'} not valid JSON. Fix ${errors.length === 1 ? 'it' : 'them'} or turn on "Skip invalid lines".`, { line: errors[0].line, lines: errors.slice(0, 20).map((e) => `Line ${e.line}: ${e.message}`).concat(errors.length > 20 ? [`... and ${errors.length - 20} more`] : []) })
  }
  return values
}

const indentOf = (o) => (o.indent === 'tab' ? '\t' : o.indent === 0 || o.indent === '0' ? 0 : Number(o.indent) || 2)

// ---------- YAML ----------
async function readYaml(text) {
  const y = await yamlLib()
  let docs
  try { docs = y.loadAll(text, { schema: y.CORE_SCHEMA.withTags(y.mergeTag) }) } catch (e) {
    const m = e.mark
    const reason = String(e.reason || e.message || '').split('\n')[0].replace(/\s*\(\d+:\d+\)\s*$/, '')
    throw new DataError(`That is not valid YAML${m ? ` (line ${m.line + 1}, column ${m.column + 1})` : ''}: ${reason}.`, m ? { line: m.line + 1, col: m.column + 1 } : {})
  }
  return docs.length === 0 ? null : docs.length === 1 ? docs[0] : docs
}
async function writeYaml(v, o) {
  const y = await yamlLib()
  const dump = (x) => y.dump(x, { indent: indentOf(o) || 2, lineWidth: -1, noRefs: true })
  if (o.yamlDocs && Array.isArray(v)) return v.map((d, i) => (i ? '---\n' : '') + dump(d)).join('')
  return dump(v)
}

// ---------- TOML ----------
async function readToml(text) {
  const t = await tomlLib()
  try { return t.parse(text, { integersAsBigInt: 'asNeeded' }) } catch (e) {
    const where = e.line ? ` (line ${e.line}, column ${e.column})` : ''
    throw new DataError(`That is not valid TOML${where}: ${String(e.message).split('\n')[0].replace(/^TOML Error:?\s*/i, '').replace(/\s*\(line.*$/, '')}.`, { line: e.line, col: e.column })
  }
}
/** TOML has no null. Remove nulls (and say how many). */
function dropNulls(v, count) {
  if (Array.isArray(v)) return v.filter((x) => { if (x === null) { count.n++; return false } return true }).map((x) => dropNulls(x, count))
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) { if (v[k] === null) count.n++; else o[k] = dropNulls(v[k], count) } return o }
  return v
}
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
  return v
}
async function writeToml(v, o, warn) {
  const t = await tomlLib()
  const count = { n: 0 }
  let root = dropNulls(v, count)
  if (o.sortKeys) root = sortDeep(root)
  if (!isObj(root)) {
    root = { [Array.isArray(root) ? 'items' : 'value']: root }
    warn(`TOML needs a table at the top level, so the data was put under "${Object.keys(root)[0]}".`)
  }
  if (count.n) warn(`TOML has no null, so ${count.n} null value${count.n === 1 ? ' was' : 's were'} left out.`)
  return t.stringify(root).trimEnd() + '\n'
}

// ---------- XML ----------
const XML_BAD = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]', 'g')
async function readXml(text, o) {
  const { XMLParser, XMLValidator } = await xmlLib()
  const bad = XMLValidator.validate(text)
  if (bad !== true) {
    const e = bad.err || {}
    throw new DataError(`That is not valid XML${e.line ? ` (line ${e.line}, column ${e.col})` : ''}: ${String(e.msg || 'could not be read').replace(/\.$/, '')}.`, { line: e.line, col: e.col })
  }
  const p = new XMLParser({
    ignoreAttributes: !!o.ignoreAttrs, attributeNamePrefix: o.attrPrefix ?? '@', textNodeName: o.textKey || '#text',
    parseTagValue: !!o.infer, parseAttributeValue: !!o.infer, trimValues: true, ignoreDeclaration: true, ignorePiTags: true,
    numberParseOptions: { hex: false, leadingZeros: false, eNotation: true, skipLike: /^[+-]?\d{16,}$/ },
  })
  const out = p.parse(text)
  return o.ignoreAttrs ? out : attrsFirst(out, o.attrPrefix ?? '@')
}
/** Put attributes before child elements, the way people read XML. */
function attrsFirst(v, prefix) {
  if (Array.isArray(v)) return v.map((x) => attrsFirst(x, prefix))
  if (!isObj(v)) return v
  const keys = Object.keys(v)
  const a = prefix ? keys.filter((k) => k.startsWith(prefix)) : []
  const out = {}
  for (const k of [...a, ...keys.filter((k) => !a.includes(k))]) out[k] = attrsFirst(v[k], prefix)
  return out
}
const xmlName = (k, o) => {
  if (k === o.textKey || k === '#text') return k
  const prefixed = o.attrPrefix && k.startsWith(o.attrPrefix) && k.length > o.attrPrefix.length
  const base = prefixed ? k.slice(o.attrPrefix.length) : k
  let n = String(base).replace(/[^\w.\-:·À-￿]/g, '_')
  if (!n || /^[\d.\-]/.test(n)) n = `_${n}`
  return prefixed ? o.attrPrefix + n : n
}
function prepXml(v, o) {
  if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? { item: prepXml(x, o) } : prepXml(x, o)))
  if (isObj(v)) {
    const out = {}
    for (const k of Object.keys(v)) {
      const val = v[k]
      const key = xmlName(k, o)
      out[key] = typeof val === 'string' ? val.replace(XML_BAD, '') : prepXml(val, o)
    }
    return out
  }
  if (typeof v === 'string') return v.replace(XML_BAD, '')
  return v
}
async function writeXml(v, o) {
  const { XMLBuilder } = await xmlLib()
  const ob = { attrPrefix: o.attrPrefix || '@', textKey: o.textKey || '#text' }
  let doc = prepXml(v, ob)
  const keys = isObj(doc) ? Object.keys(doc) : []
  const single = keys.length === 1 && !keys[0].startsWith(ob.attrPrefix) && keys[0] !== ob.textKey && !Array.isArray(doc[keys[0]])
  if (!single) {
    const name = xmlName(o.rootName || 'root', ob)
    doc = { [name]: Array.isArray(doc) ? { item: doc } : doc }
  }
  const n = indentOf(o)
  const b = new XMLBuilder({
    ignoreAttributes: false, attributeNamePrefix: ob.attrPrefix, textNodeName: ob.textKey, format: n !== 0,
    indentBy: n === '\t' ? '\t' : ' '.repeat(n || 2), suppressEmptyNode: true, suppressBooleanAttributes: false, processEntities: true,
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n${b.build(doc)}${n === 0 ? '' : '\n'}`.replace(/\n\n$/, '\n')
}

// ---------- Tables: CSV, TSV, XLSX ----------
function cellText(c, o) {
  if (typeof c === 'string') {
    if (c === '') return o.empty === 'null' ? null : o.empty === 'omit' ? undefined : ''
    if (o.parseJson && /^[[{]/.test(c.trim()) && /[\]}]$/.test(c.trim())) { try { return JSON.parse(c) } catch { /* plain text */ } }
    return o.infer ? inferScalar(c) : c
  }
  if (c === null || c === undefined) return o.empty === 'omit' ? undefined : o.empty === 'empty' ? '' : null
  return c
}
function dedupeHeaders(headers) {
  const seen = new Map()
  return headers.map((h0, i) => {
    let n = String(h0 ?? '').replace(/^\uFEFF/, '').trim() || `column${i + 1}`
    const c = (seen.get(n) || 0) + 1
    seen.set(n, c)
    return c === 1 ? n : `${n}_${c}`
  })
}
/** rows (array of arrays) -> array of records. */
async function rowsToRecords(rows, o, isXlsx = false) {
  if (!rows.length) return []
  const width = Math.max(...rows.slice(0, 2000).map((r) => r.length))
  const header = o.header !== false
  const headers = header ? dedupeHeaders(Array.from({ length: width }, (_, i) => rows[0][i])) : Array.from({ length: width }, (_, i) => `column${i + 1}`)
  const body = header ? rows.slice(1) : rows
  const opt = isXlsx ? { ...o, infer: false } : o
  const out = []
  for (let r = 0; r < body.length; r++) {
    const row = body[r]
    const rec = {}
    for (let c = 0; c < headers.length; c++) {
      const isPath = o.nest && PATH_RE.test(headers[c])
      let val = cellText(row[c], opt)
      if (isPath && val === '' && o.empty !== 'null') val = undefined // an empty cell inside a nested path means "not there"
      if (val === undefined) continue
      if (o.nest) { if (!setPath(rec, headers[c], val)) rec[hasOwn(rec, headers[c]) ? `${headers[c]}_value` : headers[c]] = val } else rec[headers[c]] = val
    }
    out.push(o.nest ? arrayify(rec) : rec)
    if (r % 20000 === 19999) await tick()
  }
  return out
}
async function readDelimited(text, delim, o) {
  const Papa = await papaparse()
  let t = text.replace(/^\uFEFF/, '')
  const sep = /^sep=(.)\r?\n/i.exec(t)
  if (sep) { t = t.slice(sep[0].length); delim = sep[1] }
  if (!t.trim()) return []
  const res = Papa.parse(t, { delimiter: delim || '', skipEmptyLines: true })
  return rowsToRecords(res.data, o)
}
async function readXlsx(bytes, o) {
  const X = await loadXlsx()
  let wb
  try { wb = X.read(bytes, { type: 'array', cellNF: true }) } catch { throw new DataError('This does not look like an Excel workbook (.xlsx).') }
  if (!wb.SheetNames?.length) throw new DataError('This workbook has no sheets.')
  const names = o.sheet === 'all' ? wb.SheetNames : [wb.SheetNames.includes(o.sheet) ? o.sheet : wb.SheetNames[0]]
  const out = {}
  for (const n of names) {
    out[n] = await rowsToRecords(sheetRows(X, wb, wb.Sheets[n], null), o, true)
  }
  return o.sheet === 'all' && names.length > 1 ? out : out[names[0]]
}
/**
 * A sheet as rows of plain cells. Date-formatted numbers become "2024-03-05" or "2024-03-05T14:30:15" (read straight from the
 * serial number, so the time zone of the visitor never shifts them); everything else keeps its type. blank: value for empty cells.
 */
function sheetRows(X, wb, ws, blank) {
  if (!ws || !ws['!ref']) return []
  const range = X.utils.decode_range(ws['!ref'])
  const date1904 = !!wb.Workbook?.WBProps?.date1904
  const rows = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = []
    let any = false
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[X.utils.encode_cell({ r, c })]
      let v = blank
      if (cell && cell.v !== undefined && cell.v !== null && cell.t !== 'z') {
        any = true
        if (cell.t === 'n' && cell.z && X.SSF.is_date(cell.z)) {
          const d = X.SSF.parse_date_code(cell.v, { date1904 })
          v = !d ? cell.v : cell.v < 1 ? `${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}` : d.H || d.M || Math.floor(d.S) ? `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}T${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}` : `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}`
        } else if (cell.t === 'e') v = blank
        else v = cell.v
      }
      row.push(v)
    }
    if (any) rows.push(row)
  }
  return rows
}
/** Names of the sheets in a workbook (for a sheet picker). */
export async function xlsxSheetNames(bytes) {
  const X = await loadXlsx()
  return X.read(bytes, { type: 'array', bookSheets: true }).SheetNames || []
}

/** Walk a value for the biggest list of records (up to 5 levels deep). */
function findRecords(value, path) {
  if (path) {
    let cur = value
    for (const t of path.match(/[^.[\]]+/g) || []) { cur = cur == null ? undefined : cur[t] }
    if (cur === undefined) throw new DataError(`Could not find "${path}" in the data. Check the path, or leave it blank to find the list automatically.`)
    value = cur
  }
  if (Array.isArray(value)) return value
  if (isObj(value)) {
    let best = null
    const walk = (v, depth) => {
      if (Array.isArray(v)) {
        const objs = v.filter(isObj).length
        if (objs && objs >= v.length / 2 && (!best || v.length > best.length)) best = v
        if (depth < 5) for (const x of v.slice(0, 50)) if (isObj(x)) walk(x, depth + 1)
      } else if (isObj(v) && depth < 5) for (const k of Object.keys(v)) walk(v[k], depth + 1)
    }
    walk(value, 0)
    return best || [value]
  }
  return [value]
}
/** Value -> { headers, rows } with flattened keys. */
async function toTable(value, o) {
  const recs = findRecords(value, o.records)
  const allArrays = recs.length && recs.every(Array.isArray)
  const headers = []
  const seen = new Set()
  const flat = []
  for (let i = 0; i < recs.length; i++) {
    let r = recs[i]
    if (allArrays) r = Object.fromEntries(r.map((x, j) => [`column${j + 1}`, x]))
    const f = !isObj(r) ? { value: r } : o.flatten === 'json'
      ? Object.fromEntries(Object.keys(r).map((k) => [k, r[k] !== null && typeof r[k] === 'object' && !(r[k] instanceof Date) ? JSON.stringify(r[k]) : r[k]]))
      : flattenValue(r)
    for (const k of Object.keys(f)) if (!seen.has(k)) { seen.add(k); headers.push(k) }
    flat.push(f)
    if (i % 20000 === 19999) await tick()
  }
  if (!headers.length) throw new DataError('There are no rows to write. The data needs a list of records (objects).')
  const rows = flat.map((f) => headers.map((k) => { const c = f[k]; return c === undefined || c === null ? '' : c }))
  return { headers, rows }
}
/** A value is "several sheets" when it is an object of two or more lists of records. */
export function sheetsOf(value) {
  if (!isObj(value)) return null
  const ks = Object.keys(value)
  if (ks.length < 2 || !ks.every((k) => Array.isArray(value[k]) && value[k].every((x) => isObj(x) || Array.isArray(x)))) return null
  return ks.map((k) => ({ name: k, value: value[k] }))
}
const csvCell = (c, d) => {
  const s = typeof c === 'string' ? c : c instanceof Date ? c.toISOString() : String(c)
  return s === '' ? '' : s.includes(d) || /["\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
}
export function tableToDelimited({ headers, rows }, d, eol = '\r\n') {
  const out = [headers.map((h0) => csvCell(h0, d)).join(d)]
  for (const r of rows) out.push(r.map((c) => csvCell(c, d)).join(d))
  return out.join(eol) + eol
}
async function writeXlsx(value, o) {
  const { buildXlsx } = await import('../data/_xlsx.js')
  const multi = sheetsOf(value)
  const sheets = []
  for (const s of multi || [{ name: o.sheetName || 'Sheet1', value }]) {
    const t = await toTable(s.value, { ...o, records: multi ? '' : o.records })
    sheets.push({ name: s.name, headers: t.headers, rows: t.rows, freeze: true, filter: true })
  }
  const blob = await buildXlsx(sheets, { typed: o.typedXlsx !== false })
  return new Uint8Array(await blob.arrayBuffer())
}

// ---------- INI ----------
function readIni(text, o) {
  const out = {}
  let cur = out
  const val = (raw) => {
    let s = raw.trim()
    if (/^"(?:[^"\\]|\\.)*"$/.test(s)) { try { return JSON.parse(s) } catch { return s.slice(1, -1) } }
    if (/^'.*'$/.test(s)) return s.slice(1, -1)
    s = s.replace(/\s+[;#].*$/, '')
    return o.infer ? inferScalar(s) : s
  }
  text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line[0] === ';' || line[0] === '#') return
    const sec = /^\[([^\]]*)\]\s*(?:[;#].*)?$/.exec(line)
    if (sec) {
      const name = sec[1].trim()
      if (!hasOwn(out, name) || !isObj(out[name])) out[name] = {}
      cur = out[name]
      return
    }
    const m = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(line)
    if (!m) throw new DataError(`Line ${i + 1} is not a "key = value" pair or a [section]: ${line.slice(0, 60)}`, { line: i + 1 })
    const key = m[1].trim()
    const v = val(m[2])
    if (key.endsWith('[]')) { const k = key.slice(0, -2); cur[k] = [...(Array.isArray(cur[k]) ? cur[k] : []), v] } else cur[key] = v
  })
  return out
}
function iniValue(v) {
  if (v === null) return ''
  if (typeof v !== 'string') return String(v)
  return v === '' || v !== v.trim() || /[\r\n"';#=]/.test(v) ? JSON.stringify(v) : v
}
function iniLines(obj, lines) {
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) for (const x of v) lines.push(`${k}[] = ${iniValue(x)}`)
    else if (v !== null && typeof v === 'object') for (const [fk, fv] of Object.entries(flattenValue(v))) lines.push(`${k}.${fk} = ${iniValue(fv)}`)
    else lines.push(`${k} = ${iniValue(v)}`)
  }
}
function writeIni(v, o, warn) {
  let root = v
  if (!isObj(root)) { root = { [Array.isArray(root) ? 'items' : 'value']: root }; warn(`INI needs key and value pairs, so the data was put under "${Object.keys(root)[0]}".`) }
  const lines = []
  const top = Object.fromEntries(Object.entries(root).filter(([, x]) => !isObj(x)))
  iniLines(top, lines)
  let deep = false
  for (const [name, sec] of Object.entries(root)) {
    if (!isObj(sec)) continue
    if (lines.length) lines.push('')
    lines.push(`[${name}]`)
    if (Object.values(sec).some((x) => isObj(x) || (Array.isArray(x) && x.some((y) => y !== null && typeof y === 'object')))) deep = true
    iniLines(sec, lines)
  }
  if (deep) warn('INI only has one level of sections, so deeper levels were written as dotted keys (a.b = value).')
  return lines.join('\n') + '\n'
}

// ---------- .properties ----------
const unescProp = (s) => s.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_, c) => (c[0] === 'u' && c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : { n: '\n', t: '\t', r: '\r', f: '\f' }[c] ?? c))
function readProperties(text, o) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  const out = {}
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^[ \t\f]+/, '')
    if (!line || line[0] === '#' || line[0] === '!') continue
    while (/(?:^|[^\\])(?:\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].replace(/^[ \t\f]+/, '')
    let k = '', j = 0
    for (; j < line.length; j++) {
      const c = line[j]
      if (c === '\\') { k += c + (line[j + 1] ?? ''); j++; continue }
      if (c === '=' || c === ':' || c === ' ' || c === '\t' || c === '\f') break
      k += c
    }
    let rest = line.slice(j).replace(/^[ \t\f]+/, '')
    if (rest[0] === '=' || rest[0] === ':') rest = rest.slice(1).replace(/^[ \t\f]+/, '')
    const key = unescProp(k)
    const v = unescProp(rest)
    const val = o.infer ? inferScalar(v) : v
    if (!o.expand || !setPath(out, key, val)) out[key] = val
  }
  return o.expand ? arrayify(out) : out
}
function escProp(s, isKey, o) {
  let r = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\f/g, '\\f')
  if (isKey) r = r.replace(/[ =:#!]/g, (c) => `\\${c}`)
  else r = r.replace(/^ /, '\\ ')
  if (o.unicodeEscape) r = r.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return r
}
function writeProperties(v, o) {
  const flat = flattenValue(v, { style: 'bracket' })
  return Object.entries(flat).map(([k, x]) => `${escProp(k, true, o)}=${escProp(x === null ? '' : String(x), false, o)}`).join('\n') + '\n'
}

// ---------- .env ----------
function readEnv(text, o) {
  const out = {}
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line[0] === '#') continue
    const m = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line)
    if (!m) throw new DataError(`Line ${i + 1} is not KEY=value: ${line.slice(0, 60)}`, { line: i + 1 })
    let rest = m[2]
    const q = rest[0]
    if (q === '"' || q === "'" || q === '`') {
      let body = rest.slice(1)
      let end = -1
      for (;;) {
        for (let j = 0; j < body.length; j++) {
          if (q !== "'" && body[j] === '\\') { j++; continue }
          if (body[j] === q) { end = j; break }
        }
        if (end >= 0 || i + 1 >= lines.length) break
        body += '\n' + lines[++i]
      }
      if (end < 0) end = body.length
      let s = body.slice(0, end)
      if (q !== "'") s = s.replace(/\\([nrt"'`\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c] ?? c))
      out[m[1]] = s
    } else {
      const s = rest.replace(/\s+#.*$/, '').trim()
      out[m[1]] = o.infer ? inferScalar(s) : s
    }
  }
  return o.expand === 'env' ? arrayify(Object.fromEntries(Object.entries(out))) : out
}
function writeEnv(v, o, warn) {
  const flat = {}
  const go = (x, key) => {
    if (isObj(x)) { const ks = Object.keys(x); if (!ks.length && key) flat[key] = ''; for (const k of ks) go(x[k], key ? `${key}_${k}` : k) } else flat[key || 'VALUE'] = x
  }
  go(v, '')
  let changed = false
  const lines = Object.entries(flat).map(([k0, x]) => {
    let k = k0.replace(/[^A-Za-z0-9_]/g, '_')
    if (/^\d/.test(k)) k = `_${k}`
    if (o.upper) k = k.toUpperCase()
    if (k !== k0 && !o.upper) changed = true
    const s = x === null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x)
    const plainOk = /^[A-Za-z0-9_./:@%+,-]*$/.test(s)
    return `${k}=${plainOk ? s : `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`}`
  })
  if (changed) warn('Some keys had characters that .env files do not allow, so they were changed to underscores.')
  return lines.join('\n') + '\n'
}

// ---------- plist ----------
async function readPlist(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  try {
    const n = sniffPlist(bytes) === 'binary' ? parsePlist(bytes) : parseXmlPlist(decodeText(bytes))
    return toPlain(n)
  } catch (e) { throw new DataError(e.userMessage || `That is not a valid property list: ${e.message}`) }
}
function toNode(v) {
  if (v === null || v === undefined) return pnode.string('')
  if (Array.isArray(v)) return pnode.array(v.map(toNode))
  if (v instanceof Date) return pnode.date(v)
  if (v instanceof Uint8Array) return pnode.data(v)
  if (typeof v === 'bigint') return pnode.int(v)
  switch (typeof v) {
    case 'string': return pnode.string(v)
    case 'boolean': return pnode.bool(v)
    case 'number': return Number.isInteger(v) ? pnode.int(v) : pnode.real(v)
    default: return pnode.dict(Object.keys(v).map((k) => [k, toNode(v[k])]))
  }
}

// ---------- Format sniffing ----------
/** Guess the format of pasted text. */
export function sniffText(text) {
  const t = text.replace(/^\uFEFF/, '').trim()
  if (!t) return null
  if (/^bplist/.test(t)) return 'plist'
  if (t[0] === '<') return /<plist[\s>]/.test(t.slice(0, 600)) ? 'plist' : 'xml'
  if (t[0] === '{' || t[0] === '[') {
    try { JSON.parse(t); return 'json' } catch { /* fall through */ }
    const lines = t.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length > 1 && lines.every((l) => { try { JSON.parse(l); return true } catch { return false } })) return 'jsonl'
    return /^\s*(\/\/|\/\*|#)|[{,]\s*[A-Za-z_$][\w$]*\s*:|,\s*[}\]]/.test(t) ? 'json5' : 'json'
  }
  if (/^---(\s|$)/.test(t)) return 'yaml'
  const lines = t.split(/\r?\n/).filter((l) => l.trim() && !/^\s*[#;]/.test(l))
  const tomlish = lines.some((l) => /^\s*[\w.-]+\s*=\s*("|'|\[|\{)/.test(l)) || lines.some((l) => /^\[\[.+\]\]$/.test(l.trim()))
  const hasSection = lines.some((l) => /^\[[^\]\n]+\]$/.test(l.trim()))
  if (hasSection && lines.every((l) => /^\s*(\[.*\]|[^=:]+\s*[=:].*)$/.test(l))) return tomlish ? 'toml' : 'ini'
  if (lines.length && lines.every((l) => /^\s*(export\s+)?[A-Za-z_][\w.]*\s*=/.test(l))) {
    if (!tomlish && lines.every((l) => /^\s*(export\s+)?[A-Z_][A-Z0-9_]*\s*=/.test(l))) return 'env'
    return tomlish ? 'toml' : 'properties'
  }
  const first = lines[0] || ''
  if (/\t/.test(first) && !/^\s*[\w-]+:\s/.test(first)) return 'tsv'
  if (/,/.test(first) && lines.length > 1 && !/^\s*[\w-]+:\s/.test(first)) return 'csv'
  if (/^\s*([\w-]+:\s|- )/.test(first)) return 'yaml'
  return null
}
/** Format for a file name (by extension), or null. */
export const formatOfName = (name = '') => EXT_TO_FORMAT[(name.match(/\.([^.\/\\]+)$/)?.[1] || '').toLowerCase()] || null

// ---------- Parse and serialize ----------
/** Parse input (text or bytes) in the given format into a plain value. */
export async function parse(input, fmt, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  if (!FORMATS[fmt]) throw new DataError(`Unknown format "${fmt}".`)
  if (isBinaryFormat(fmt)) {
    const bytes = typeof input === 'string' ? textToBytes(input, o.binText) : input
    if (fmt === 'xlsx') return readXlsx(bytes, o)
    if (!bytes.length) throw new DataError('There is nothing to read. Paste the bytes or choose a file.')
    try {
      if (fmt === 'msgpack') {
        const { decodeMulti } = await msgpackLib()
        const all = [...decodeMulti(bytes)]
        return all.length === 1 ? all[0] : all
      }
      const { Decoder } = await cborLib()
      const d = new Decoder({ useRecords: false, mapsAsObjects: true })
      const all = d.decodeMultiple(bytes)
      return all && all.length === 1 ? all[0] : all
    } catch (e) { throw new DataError(`That is not valid ${FORMATS[fmt].label} data: ${String(e.message).split('\n')[0]}`) }
  }
  if (fmt === 'plist') return readPlist(input)
  const text = decodeText(input)
  switch (fmt) {
    case 'json': return parseJson(text)
    case 'jsonl': return readJsonl(text, o)
    case 'yaml': return readYaml(text)
    case 'toml': return readToml(text)
    case 'xml': return readXml(text, o)
    case 'csv': return readDelimited(text, '', o)
    case 'tsv': return readDelimited(text, '\t', o)
    case 'ini': return readIni(text, o)
    case 'properties': return readProperties(text, o)
    case 'env': return readEnv(text, o)
    case 'json5': {
      const J = await json5Lib()
      try { return J.parse(text) } catch (e) { throw new DataError(`That is not valid JSON5${e.lineNumber ? ` (line ${e.lineNumber}, column ${e.columnNumber})` : ''}: ${String(e.message).replace(/^JSON5: /, '').replace(/ at \d+:\d+$/, '')}.`, { line: e.lineNumber, col: e.columnNumber }) }
    }
    case 'hjson': {
      const H = await hjsonLib()
      try { return H.parse(text) } catch (e) { throw new DataError(`That is not valid HJSON: ${String(e.message).split('\n')[0]}.`) }
    }
    default: throw new DataError(`Cannot read ${fmt}.`)
  }
}

/**
 * Write a plain value as `fmt`. Returns { text } or { bytes }. `warn(message)` collects notes about anything that could not be kept.
 */
export async function serialize(value, fmt, opts = {}, warn = () => {}) {
  const o = { ...DEFAULTS, ...opts }
  if (!FORMATS[fmt] || FORMATS[fmt].readOnly) throw new DataError(`Cannot write ${FORMATS[fmt]?.label || fmt} here.`)
  const rich = fmt === 'msgpack' || fmt === 'cbor' || fmt === 'plist'
  const v = plain(value, rich)
  const n = indentOf(o)
  switch (fmt) {
    case 'json': return { text: JSON.stringify(v, null, n === '\t' ? '\t' : n || undefined) + '\n' }
    case 'jsonl': return { text: (Array.isArray(v) ? v : [v]).map((x) => JSON.stringify(x)).join('\n') + '\n' }
    case 'yaml': return { text: await writeYaml(v, o) }
    case 'toml': return { text: await writeToml(v, o, warn) }
    case 'xml': return { text: await writeXml(v, o) }
    case 'csv': case 'tsv': {
      const t = await toTable(v, o)
      const d = fmt === 'tsv' ? '\t' : o.delimiter === 'tab' ? '\t' : o.delimiter || ','
      if (fmt === 'tsv') for (const r of t.rows) for (let i = 0; i < r.length; i++) if (typeof r[i] === 'string' && /[\t\r\n]/.test(r[i])) r[i] = r[i].replace(/[\t\r\n]+/g, ' ')
      return { text: (o.bom ? '\uFEFF' : '') + tableToDelimited(t, d) }
    }
    case 'xlsx': return { bytes: await writeXlsx(v, o) }
    case 'ini': return { text: writeIni(v, o, warn) }
    case 'properties': return { text: writeProperties(v, o) }
    case 'env': return { text: writeEnv(v, o, warn) }
    case 'plist': return { text: writeXmlPlist(toNode(v)) }
    case 'json5': { const J = await json5Lib(); return { text: J.stringify(v, null, n === '\t' ? '\t' : n || undefined) + '\n' } }
    case 'msgpack': { const { encode } = await msgpackLib(); return { bytes: encode(v) } }
    case 'cbor': { const { Encoder } = await cborLib(); return { bytes: new Uint8Array(new Encoder({ useRecords: false, variableMapSize: true }).encode(v)) } }
    default: throw new DataError(`Cannot write ${fmt}.`)
  }
}

/**
 * Convert between any two formats. input: string or Uint8Array. Returns
 * { outputs: [{ suffix, text?, bytes?, ext, mime }], warnings: string[], value }.
 * Several outputs only happen for a multi-sheet workbook written as CSV or TSV with opts.sheet === 'all'.
 */
export async function convertData(input, from, to, opts = {}, ctx = {}) {
  const warnings = []
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m) }
  if (ctx.signal?.aborted) throw aborted()
  const value = await parse(input, from, { ...opts, _warn: warn })
  if (ctx.signal?.aborted) throw aborted()
  ctx.onProgress?.(0.5)
  const outputs = []
  const multi = (to === 'csv' || to === 'tsv') && sheetsOf(value)
  if (multi) {
    for (const s of multi) {
      const r = await serialize(s.value, to, opts, warn)
      outputs.push({ suffix: s.name, ...r, ext: outExt(to), mime: FORMATS[to].mime })
    }
  } else {
    const r = await serialize(value, to, opts, warn)
    outputs.push({ suffix: '', ...r, ext: outExt(to), mime: FORMATS[to].mime })
  }
  ctx.onProgress?.(1)
  return { outputs, warnings, value }
}

/** Small sample for each format (for the "Try a sample" button). */
export const SAMPLES = {
  json: JSON.stringify([
    { id: 1, name: 'Asha Verma', email: 'asha@example.com', active: true, address: { city: 'Pune', zip: '411001' }, tags: ['admin', 'beta'] },
    { id: 2, name: 'Liam Chen', email: 'liam@example.com', active: false, address: { city: 'Oslo', zip: '0150' }, tags: [] },
  ], null, 2),
  yaml: 'app:\n  name: demo\n  port: 8080\n  debug: false\nservers:\n  - host: a.example.com\n    weight: 3\n  - host: b.example.com\n    weight: 1\n',
  toml: 'title = "Demo"\n\n[owner]\nname = "Asha"\ndob = 1979-05-27T07:32:00Z\n\n[[servers]]\nhost = "a.example.com"\nports = [80, 443]\n\n[[servers]]\nhost = "b.example.com"\nports = [8080]\n',
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n<catalog>\n  <book id="bk101" available="true">\n    <title>XML Developer Guide</title>\n    <price currency="USD">44.95</price>\n    <genre>Computer</genre>\n  </book>\n  <book id="bk102" available="false">\n    <title>Midnight Rain</title>\n    <price currency="USD">5.95</price>\n    <genre>Fantasy</genre>\n  </book>\n</catalog>\n',
  csv: 'id,name,email,address.city,tags.0,tags.1\n1,Asha Verma,asha@example.com,Pune,admin,beta\n2,Liam Chen,liam@example.com,Oslo,,\n',
  tsv: 'id\tname\tcity\n1\tAsha Verma\tPune\n2\tLiam Chen\tOslo\n',
  jsonl: '{"id":1,"event":"login","user":"asha"}\n{"id":2,"event":"purchase","user":"liam","total":19.9}\n{"id":3,"event":"logout","user":"asha"}\n',
  ini: '; app settings\nname = demo\n\n[server]\nhost = localhost\nport = 8080\n\n[database]\nuser = admin\nssl = true\n',
  properties: '# server\nserver.host=localhost\nserver.port=8080\napp.name=Demo App\nlist[0]=a\nlist[1]=b\n',
  env: '# database\nDB_HOST=localhost\nDB_PORT=5432\nDB_NAME="my app"\nDEBUG=false\n',
  plist: '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>CFBundleName</key>\n\t<string>Demo</string>\n\t<key>CFBundleVersion</key>\n\t<integer>12</integer>\n\t<key>Debug</key>\n\t<false/>\n</dict>\n</plist>\n',
  json5: "{\n  // comments and trailing commas are fine\n  name: 'demo',\n  port: 8080,\n  tags: ['a', 'b',],\n}\n",
  hjson: '{\n  # comments, no quotes, no commas\n  name: demo\n  port: 8080\n  tags: [\n    a\n    b\n  ]\n}\n',
  msgpack: 'gqRuYW1lpGRlbW+kcG9ydM0fkA==',
  cbor: 'omRuYW1lZGRlbW9kcG9ydBkfkA==',
}

// ---------- Plain tables (contacts and calendar tools) ----------
/** CSV, TSV or XLSX -> { headers, rows } of cells exactly as written (first sheet, or opts.sheet). */
export async function readRows(input, fmt, o = {}) {
  let aoa
  if (fmt === 'xlsx') {
    const X = await loadXlsx()
    let wb
    try { wb = X.read(input, { type: 'array', cellNF: true }) } catch { throw new DataError('This does not look like an Excel workbook (.xlsx).') }
    if (!wb.SheetNames?.length) throw new DataError('This workbook has no sheets.')
    const name = wb.SheetNames.includes(o.sheet) ? o.sheet : wb.SheetNames[0]
    aoa = sheetRows(X, wb, wb.Sheets[name], '')
  } else {
    const Papa = await papaparse()
    let t = decodeText(input).replace(/^\uFEFF/, '')
    const sep = /^sep=(.)\r?\n/i.exec(t)
    let delim = fmt === 'tsv' ? '\t' : ''
    if (sep) { t = t.slice(sep[0].length); delim = sep[1] }
    aoa = Papa.parse(t, { delimiter: delim, skipEmptyLines: true }).data
  }
  if (!aoa.length) throw new DataError('The table is empty.')
  return { headers: aoa[0].map((x) => String(x ?? '')), rows: aoa.slice(1) }
}
/** { headers, rows } -> CSV, TSV or XLSX. typed: real numbers and dates in XLSX. */
export async function writeRows(table, fmt, o = {}) {
  if (fmt === 'xlsx') {
    const { buildXlsx } = await import('../data/_xlsx.js')
    const blob = await buildXlsx([{ name: o.sheetName || 'Sheet1', headers: table.headers, rows: table.rows, freeze: true, filter: true }], { typed: !!o.typed })
    return { bytes: new Uint8Array(await blob.arrayBuffer()) }
  }
  const d = fmt === 'tsv' ? '\t' : o.delimiter === 'tab' ? '\t' : o.delimiter || ','
  const t = fmt === 'tsv' ? { headers: table.headers, rows: table.rows.map((r) => r.map((c) => (typeof c === 'string' ? c.replace(/[\t\r\n]+/g, ' ') : c))) } : table
  return { text: (o.bom ? '\uFEFF' : '') + tableToDelimited(t, d) }
}
