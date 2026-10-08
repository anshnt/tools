// Shared data core for the data pack: decoding, CSV/Excel/JSON/HTML/Markdown parsing, type inference,
// writers (CSV, JSON, TSV) and table operations (sort, filter, dedupe, aggregate, statistics).
// A table is { headers: string[], rows: (string | number | boolean)[][] }. Nothing here touches the DOM
// at import time, so the pure functions can be tested in Node.
import { papaparse, xlsx as loadXlsx } from '../../lib/libs.js'

// ---------- Basics ----------
export const str = (v) => (v == null ? '' : typeof v === 'string' ? v : String(v))
export const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '')
export const NULLISH = new Set(['', 'n/a', 'na', 'null', 'nil', 'none', 'nan', '-', '--', '?', '#n/a', 'undefined', 'missing', '#null!'])
export const isNullish = (v) => v == null || (typeof v === 'string' ? NULLISH.has(v.trim().toLowerCase()) : false)
export const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
export const emptyTable = () => ({ headers: [], rows: [] })
export const cloneTable = (t) => ({ headers: [...t.headers], rows: t.rows.map((r) => [...r]) })
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Unique, non-empty header names ("name", "name_2", "Column 3"). */
export function uniqueHeaders(headers, width = headers.length) {
  const seen = new Map()
  const out = []
  for (let i = 0; i < Math.max(width, headers.length); i++) {
    let n = str(headers[i]).replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ')
    if (!n) n = `Column ${i + 1}`
    const k = n.toLowerCase()
    const c = (seen.get(k) || 0) + 1
    seen.set(k, c)
    out.push(c === 1 ? n : `${n}_${c}`)
  }
  return out
}

/** Header guess: the first row has text only (no numbers or dates) and at least one value. */
export function looksLikeHeader(rows) {
  const first = rows[0]
  if (!first) return false
  let text = 0
  for (const v of first) {
    if (isEmpty(v)) continue
    if (typeof v === 'number' || typeof v === 'boolean') return false
    const s = String(v).trim()
    if (parseNumberEx(s) || parseDate(s)) return false
    text++
  }
  return text > 0
}

/** Build a table from raw rows. header: 'auto' | true | false. Pads short rows and widens the header to the widest row. */
export function makeTable(rows, header = 'auto') {
  let width = 0
  for (const r of rows) if (r.length > width) width = r.length
  const hasHeader = header === 'auto' ? looksLikeHeader(rows) : !!header
  let headers = []
  let body = rows
  if (hasHeader && rows.length) { headers = rows[0]; body = rows.slice(1) }
  headers = uniqueHeaders(headers, width)
  for (const r of body) while (r.length < width) r.push('')
  const table = { headers, rows: body }
  Object.defineProperty(table, 'hasHeader', { value: hasHeader, enumerable: false })
  return table
}

// ---------- Numbers ----------
const CUR = '$€£¥₹'
const RE_US = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/
const RE_IN = /^[+-]?\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/
const RE_EU = /^[+-]?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/

/**
 * Parse a number written by a human: 1,234.50  1.234,50  12,34,567  $1,200  (45)  12.5%  1 234,5
 * Returns { n, pct, cur } or null. decimal: 'auto' | '.' | ','. Percentages come back as fractions (12.5% -> 0.125).
 */
export function parseNumberEx(input, decimal = 'auto') {
  if (typeof input === 'number') return Number.isFinite(input) ? { n: input, pct: false, cur: null } : null
  if (typeof input !== 'string') return null
  let s = input.trim()
  if (!s || s.length > 40) return null
  let neg = false, pct = false, cur = null
  if (s[0] === '(' && s[s.length - 1] === ')') { neg = true; s = s.slice(1, -1).trim() }
  let m = new RegExp(`^([+-]?)\\s*([${CUR}])\\s*`).exec(s)
  if (m) { cur = m[2]; s = m[1] + s.slice(m[0].length) }
  m = new RegExp(`\\s*([${CUR}])$`).exec(s)
  if (m) { cur = m[1]; s = s.slice(0, m.index) }
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1).trim() }
  if (!/^[+-]?[\d.,'\s\u00A0\u202F]+$/.test(s) || !/\d/.test(s)) return null
  s = s.replace(/(?<=\d)[\s\u00A0\u202F'](?=\d{3}(?:\D|$))/g, '')
  if (/[\s\u00A0\u202F']/.test(s)) return null
  const hasC = s.includes(','), hasD = s.includes('.')
  let v
  if (hasC && hasD) {
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) { if (!(RE_US.test(s) || RE_IN.test(s))) return null; v = Number(s.replace(/,/g, '')) }
    else { if (!RE_EU.test(s)) return null; v = Number(s.replace(/\./g, '').replace(',', '.')) }
  } else if (hasC) {
    const thousands = RE_US.test(s) || RE_IN.test(s)
    const commaDec = /^[+-]?\d+,\d+$/.test(s)
    const asThousands = decimal === '.' ? true : decimal === ',' ? false : thousands && !/^[+-]?\d{1,3},\d{1,2}$/.test(s)
    if (asThousands) { if (!thousands) return null; v = Number(s.replace(/,/g, '')) }
    else { if (!commaDec) return null; v = Number(s.replace(',', '.')) }
  } else if (hasD) {
    if (decimal === ',') { if (!/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) return null; v = Number(s.replace(/\./g, '')) }
    else { if (!/^[+-]?(\d+\.\d+|\.\d+)$/.test(s)) return null; v = Number(s) }
  } else {
    if (!/^[+-]?\d+$/.test(s)) return null
    v = Number(s)
  }
  if (!Number.isFinite(v)) return null
  if (neg) v = -v
  if (pct) v /= 100
  return { n: v, pct, cur }
}
export const parseNumber = (s, decimal) => parseNumberEx(s, decimal)?.n ?? null
/** Numeric value of a cell, or null. */
export const num = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' ? parseNumber(v) : null)

// ---------- Dates ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const TIME = '(?:[T\\s]+(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.\\d+)?)?\\s*([AaPp][Mm])?\\s*(?:Z|[+-]\\d{2}:?\\d{2})?)?'
const RE_YMD = new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${TIME}$`)
const RE_DMY = new RegExp(`^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4}|\\d{2})${TIME}$`)
const RE_DMON = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+([A-Za-z]{3,9})\\.?,?[\\s-]+(\\d{4}|\\d{2})${TIME}$`)
const RE_MONDY = new RegExp(`^([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${TIME}$`)
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const year2 = (s) => (s.length === 2 ? (+s < 70 ? 2000 + +s : 1900 + +s) : +s)
function tparts(m, i) {
  let H = m[i] ? +m[i] : 0
  const ap = m[i + 3]
  if (ap) { const pm = /p/i.test(ap); if (H === 12) H = pm ? 12 : 0; else if (pm) H += 12 }
  return { H, M: m[i + 1] ? +m[i + 1] : 0, S: m[i + 2] ? +m[i + 2] : 0, hasTime: m[i] != null }
}
/** Parse a date or date-time string into { y, m, d, H, M, S, hasTime } or null. order is used for 03/04/2024 style dates. */
export function parseDate(input, order = 'mdy') {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (s.length < 6 || s.length > 40) return null
  let m, y, mo, d, t
  if ((m = RE_YMD.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; t = tparts(m, 4) }
  else if ((m = RE_DMY.exec(s))) {
    const a = +m[1], b = +m[2]
    y = year2(m[3]); t = tparts(m, 4)
    if (order === 'dmy') { d = a; mo = b } else { mo = a; d = b }
    if (mo > 12 && d <= 12) [mo, d] = [d, mo]
  } else if ((m = RE_DMON.exec(s))) { d = +m[1]; mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; y = year2(m[3]); t = tparts(m, 4) }
  else if ((m = RE_MONDY.exec(s))) { mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = +m[3]; t = tparts(m, 4) }
  else return null
  if (!mo || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || y < 1000 || t.H > 23 || t.M > 59 || t.S > 59) return null
  return { y, m: mo, d, ...t }
}
const p2 = (n) => String(n).padStart(2, '0')
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEK_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Bucket a date cell: mode 'year' | 'quarter' | 'month' | 'day' | 'weekday'. Returns { label, sort } or null when it is not a date. */
export function groupDate(raw, mode, order = 'mdy') {
  const p = typeof raw === 'string' ? parseDate(raw, order) : null
  if (!p) return null
  const p2 = (n) => String(n).padStart(2, '0')
  if (mode === 'year') return { label: String(p.y), sort: p.y }
  if (mode === 'quarter') return { label: `${p.y} Q${Math.ceil(p.m / 3)}`, sort: p.y * 10 + Math.ceil(p.m / 3) }
  if (mode === 'month') return { label: `${MON_ABBR[p.m - 1]} ${p.y}`, sort: p.y * 100 + p.m }
  if (mode === 'weekday') { const wd = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7; return { label: WEEK_ABBR[wd], sort: wd } }
  return { label: `${p.y}-${p2(p.m)}-${p2(p.d)}`, sort: p.y * 10000 + p.m * 100 + p.d }
}
export const fmtDate = (p, withTime = p.hasTime) => `${String(p.y).padStart(4, '0')}-${p2(p.m)}-${p2(p.d)}${withTime ? ` ${p2(p.H)}:${p2(p.M)}:${p2(p.S)}` : ''}`
/** Excel serial number (days since 1899-12-30, with the time as the fraction). */
export const dateSerial = (p) => Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) / 864e5 + 25569
export const dateMillis = (p) => Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S)
export function serialToParts(serial) {
  const dt = new Date(Math.round(((serial - 25569) * 864e5) / 1000) * 1000)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), H: dt.getUTCHours(), M: dt.getUTCMinutes(), S: dt.getUTCSeconds(), hasTime: serial % 1 !== 0 }
}
/** 'mdy' or 'dmy' from the visitor's locale (used only for ambiguous dates like 03/04/2024). */
export function localeDateOrder() {
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2001, 10, 25)).map((x) => x.type).filter((x) => x === 'day' || x === 'month')
    return parts[0] === 'month' ? 'mdy' : 'dmy'
  } catch { return 'mdy' }
}
/** Decide day-first or month-first for a column from values like 25/12/2024; null when every value is ambiguous. */
export function inferDateOrder(values) {
  let dmy = 0, mdy = 0
  for (const v of values) {
    if (typeof v !== 'string') continue
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/.exec(v.trim())
    if (!m) continue
    if (+m[1] > 12) dmy++
    else if (+m[2] > 12) mdy++
  }
  return dmy > mdy ? 'dmy' : mdy > dmy ? 'mdy' : null
}

// ---------- Type inference ----------
export const TYPE_LABELS = { text: 'Text', integer: 'Whole number', number: 'Number', percent: 'Percent', currency: 'Currency', boolean: 'True/False', date: 'Date', datetime: 'Date and time', empty: 'Empty' }
export const isNumericType = (t) => t === 'integer' || t === 'number' || t === 'percent' || t === 'currency'

/** Infer one column's type from its cells. */
export function inferType(values, { dateOrder, sample = 1000 } = {}) {
  let n = 0, nums = 0, ints = 0, pcts = 0, bools = 0, dates = 0, times = 0, curN = 0, lead0 = false, long = false
  const curs = new Set()
  const order = dateOrder || inferDateOrder(values.slice(0, sample * 2)) || localeDateOrder()
  for (const v of values) {
    if (isEmpty(v) || isNullish(v)) continue
    if (++n > sample) { n--; break }
    if (typeof v === 'number') { nums++; if (Number.isInteger(v)) ints++; continue }
    if (typeof v === 'boolean') { bools++; continue }
    const s = String(v).trim()
    if (/^(true|false)$/i.test(s)) { bools++; continue }
    if (/^[+-]?0\d/.test(s)) lead0 = true
    if (/^\d{16,}$/.test(s) || /^\+\d{9,}$/.test(s)) long = true
    const p = parseNumberEx(s)
    if (p) {
      nums++
      if (p.pct) pcts++
      if (p.cur) { curN++; curs.add(p.cur) }
      if (Number.isInteger(p.n) && !p.pct && !/[.,]\d/.test(s.replace(/,\d{3}/g, ''))) ints++
      continue
    }
    const d = parseDate(s, order)
    if (d) { dates++; if (d.hasTime) times++ }
  }
  if (!n) return 'empty'
  const thr = n <= 10 ? n : Math.ceil(n * 0.9)
  if (bools === n) return 'boolean'
  if (!lead0 && !long && nums >= thr) {
    if (pcts === nums) return 'percent'
    if (curN === nums && curs.size === 1) return 'currency'
    return ints === nums ? 'integer' : 'number'
  }
  if (dates >= thr) return times ? 'datetime' : 'date'
  return 'text'
}
export function inferTypes(table, opts = {}) {
  const rows = table.rows.length > 4000 ? table.rows.slice(0, 4000) : table.rows
  return table.headers.map((_, c) => inferType(rows.map((r) => r[c]), opts))
}
export const columnValues = (table, c) => table.rows.map((r) => r[c])

// ---------- Decoding and delimiter detection ----------
export const ENCODINGS = [
  ['auto', 'Auto-detect'], ['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 (LE)'], ['utf-16be', 'UTF-16 (BE)'], ['windows-1252', 'Western (Windows-1252)'],
  ['iso-8859-2', 'Central European (ISO-8859-2)'], ['windows-1251', 'Cyrillic (Windows-1251)'], ['windows-1253', 'Greek (Windows-1253)'], ['windows-1254', 'Turkish (Windows-1254)'],
  ['gbk', 'Chinese (GBK)'], ['big5', 'Chinese (Big5)'], ['shift_jis', 'Japanese (Shift JIS)'], ['euc-kr', 'Korean (EUC-KR)'],
]
export const encodingLabel = (e) => ENCODINGS.find((x) => x[0] === e)?.[1] || e

/** Decode bytes to text. encoding 'auto' checks for a BOM, then valid UTF-8, then falls back to Windows-1252. */
export function decodeBuffer(buf, encoding = 'auto') {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let enc = encoding
  if (enc === 'auto') {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) enc = 'utf-8'
    else if (u8[0] === 0xFF && u8[1] === 0xFE) enc = 'utf-16le'
    else if (u8[0] === 0xFE && u8[1] === 0xFF) enc = 'utf-16be'
    else {
      let even = 0, odd = 0
      const n = Math.min(u8.length, 400)
      for (let i = 0; i < n; i++) if (u8[i] === 0) (i % 2 ? odd++ : even++)
      if (odd > n / 8 && !even) enc = 'utf-16le'
      else if (even > n / 8 && !odd) enc = 'utf-16be'
      else {
        try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'utf-8' } } catch { enc = 'windows-1252' }
      }
    }
  }
  return { text: new TextDecoder(enc).decode(u8), encoding: enc }
}

const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
  0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F }
/** Encode text. enc: 'utf-8' | 'utf-16le' | 'windows-1252'. Returns { bytes, lossy } (lossy = characters replaced by "?"). */
export function encodeText(text, enc = 'utf-8', bom = false) {
  if (enc === 'utf-16le') {
    const out = new Uint8Array((text.length + (bom ? 1 : 0)) * 2)
    let o = 0
    if (bom) { out[o++] = 0xFF; out[o++] = 0xFE }
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[o++] = c & 255; out[o++] = c >> 8 }
    return { bytes: out, lossy: 0 }
  }
  if (enc === 'windows-1252') {
    const out = new Uint8Array(text.length)
    let lossy = 0, o = 0
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) out[o++] = c
      else if (CP1252[c]) out[o++] = CP1252[c]
      else { out[o++] = 63; lossy++; if (c >= 0xD800 && c <= 0xDBFF) i++ }
    }
    return { bytes: out.subarray(0, o), lossy }
  }
  const body = new TextEncoder().encode(text)
  if (!bom) return { bytes: body, lossy: 0 }
  const out = new Uint8Array(body.length + 3)
  out.set([0xEF, 0xBB, 0xBF]); out.set(body, 3)
  return { bytes: out, lossy: 0 }
}

export const DELIMITERS = [['auto', 'Auto-detect'], [',', 'Comma ( , )'], [';', 'Semicolon ( ; )'], ['\t', 'Tab'], ['|', 'Pipe ( | )']]
export const delimiterLabel = (d) => ({ ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'pipe' }[d] || JSON.stringify(d))

/** Pick the delimiter that splits the first lines most consistently (quote-aware). */
export function detectDelimiter(text) {
  const sample = text.slice(0, 30000)
  const cands = [',', ';', '\t', '|']
  const lines = []
  let counts = cands.map(() => 0), inQ = false, seen = false
  for (let i = 0; i < sample.length && lines.length < 40; i++) {
    const ch = sample[i]
    if (ch === '"') { inQ = !inQ; seen = true; continue }
    if (inQ) continue
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && sample[i + 1] === '\n') i++
      if (seen || counts.some(Boolean)) lines.push(counts)
      counts = cands.map(() => 0); seen = false
      continue
    }
    seen = true
    const k = cands.indexOf(ch)
    if (k >= 0) counts[k]++
  }
  if (!lines.length && counts.some(Boolean)) lines.push(counts)
  let best = ',', bestScore = 0
  cands.forEach((d, k) => {
    const freq = new Map()
    for (const l of lines) if (l[k] > 0) freq.set(l[k], (freq.get(l[k]) || 0) + 1)
    let modal = 0, modalN = 0
    for (const [c, n] of freq) if (n > modalN || (n === modalN && c > modal)) { modal = c; modalN = n }
    if (!modal) return
    const score = modalN / lines.length + Math.min(modal, 50) * 0.001
    if (score > bestScore + 1e-9) { bestScore = score; best = d }
  })
  return best
}

// ---------- CSV ----------
/** Parse delimited text. Returns { table, delimiter, hasHeader, warnings }. */
export async function parseCsvText(text, { delimiter = 'auto', header = 'auto' } = {}) {
  const Papa = await papaparse()
  let t = text.replace(/^\uFEFF/, '')
  const sep = /^sep=(.)\r?\n/i.exec(t)
  if (sep) { t = t.slice(sep[0].length); if (delimiter === 'auto') delimiter = sep[1] }
  const d = delimiter === 'auto' ? detectDelimiter(t) : delimiter
  const res = Papa.parse(t, { delimiter: d, skipEmptyLines: true })
  const warnings = []
  if (res.errors?.some((e) => e.type === 'Quotes')) warnings.push('Some quoted values looked malformed and were kept as written.')
  const table = makeTable(res.data, header)
  return { table, delimiter: d, hasHeader: table.hasHeader, warnings }
}

/** Serialize a table to delimited text. quote: 'min' | 'all'. */
export function toCsv(table, { delimiter = ',', quote = 'min', eol = '\n', header = true } = {}) {
  const re = new RegExp(`[${delimiter === '\t' ? '\\t' : delimiter.replace(/[\\\]^-]/g, '\\$&')}"\\r\\n]`)
  const cell = (v) => {
    const s = typeof v === 'string' ? v : str(v)
    if (quote === 'all' ? true : re.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = []
  if (header) lines.push(table.headers.map(cell).join(delimiter))
  for (const r of table.rows) {
    let line = cell(r[0])
    for (let c = 1; c < table.headers.length; c++) line += delimiter + cell(r[c])
    lines.push(line)
  }
  return lines.join(eol) + (lines.length ? eol : '')
}
export const toTsv = (table, header = true) => {
  const clean = (v) => str(v).replace(/[\t\r\n]+/g, ' ')
  return [...(header ? [table.headers.map(clean).join('\t')] : []), ...table.rows.map((r) => r.map(clean).join('\t'))].join('\n')
}

// ---------- Excel ----------
export async function readWorkbook(buf) {
  const X = await loadXlsx()
  const wb = X.read(buf, { type: 'array', dense: true, cellNF: true, cellText: true, cellDates: false })
  if (!wb.SheetNames?.length) throw new Error('This workbook has no sheets.')
  return { X, wb, names: wb.SheetNames }
}

/** One worksheet to a table. formatted: use the text Excel shows instead of raw values. fillMerged: copy merged values into every merged cell. */
export function sheetToTable({ X, wb }, name, { header = 'auto', formatted = false, fillMerged = false } = {}) {
  const ws = wb.Sheets[name]
  const data = ws?.['!data'] || []
  const rows = []
  let maxCol = -1, lastRow = -1
  for (let r = 0; r < data.length; r++) {
    const src = data[r]
    const out = []
    if (src) {
      for (let c = 0; c < src.length; c++) {
        const cell = src[c]
        let v = ''
        if (cell && cell.t !== 'z') {
          if (formatted && cell.w != null && cell.t !== 'e') v = cell.w
          else if (cell.t === 'n') v = cell.z && X.SSF.is_date(cell.z) ? serialText(cell.v) : cell.v
          else if (cell.t === 'b') v = cell.v ? 'TRUE' : 'FALSE'
          else if (cell.t === 'e') v = cell.w || '#ERROR'
          else if (cell.t === 'd') v = cell.v instanceof Date ? fmtDate(serialToParts(cell.v.getTime() / 864e5 + 25569)) : str(cell.v)
          else v = cell.v == null ? '' : String(cell.v)
        }
        out.push(v)
        if (v !== '') { if (c > maxCol) maxCol = c; lastRow = r }
      }
    }
    rows.push(out)
  }
  rows.length = lastRow + 1
  if (fillMerged) {
    for (const m of ws?.['!merges'] || []) {
      const v = rows[m.s.r]?.[m.s.c]
      if (v == null || v === '') continue
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) { rows[r] ||= []; rows[r][c] = v }
    }
  }
  for (const r of rows) { r.length = Math.min(r.length, maxCol + 1); while (r.length < maxCol + 1) r.push('') }
  return makeTable(rows, header)
}
function serialText(v) {
  if (typeof v !== 'number') return str(v)
  const p = serialToParts(v)
  if (v >= 0 && v < 1) return `${p2(p.H)}:${p2(p.M)}:${p2(p.S)}`
  return fmtDate(p, v % 1 !== 0)
}

// ---------- JSON ----------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Parse JSON text, falling back to JSON Lines. Throws an Error with a line and column on bad input. */
export function parseJsonText(text) {
  const t = text.replace(/^\uFEFF/, '').trim()
  if (!t) throw new Error('There is no JSON to read yet.')
  try {
    return JSON.parse(t)
  } catch (err) {
    const lines = t.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length > 1) {
      try { return lines.map((l) => JSON.parse(l)) } catch { /* not JSON Lines either */ }
    }
    throw new Error(jsonErrorHint(t, err))
  }
}
function jsonErrorHint(text, err) {
  const pos = jsonErrorPos(text)
  const before = text.slice(0, pos).split('\n')
  const where = pos < text.length ? `line ${before.length}, column ${before.at(-1).length + 1}` : 'the end of the text'
  const near = text.slice(pos, pos + 20).split('\n')[0]
  const what = pos >= text.length ? 'it ends too early (a bracket or quote is not closed)' : `unexpected "${near.slice(0, 1)}"${near.length > 1 ? ` near "${near}"` : ''}`
  return `That is not valid JSON: ${what} at ${where}.`
}
/** Offset of the first syntax error in a JSON text (text.length when it ends too early). */
function jsonErrorPos(text) {
  let i = 0
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++ }
  const fail = () => { throw i }
  const value = () => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++; ws()
      if (text[i] === '}') { i++; return }
      for (;;) {
        ws(); if (text[i] !== '"') fail()
        string(); ws()
        if (text[i] !== ':') fail()
        i++; value(); ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return }
        fail()
      }
    } else if (c === '[') {
      i++; ws()
      if (text[i] === ']') { i++; return }
      for (;;) {
        value(); ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return }
        fail()
      }
    } else if (c === '"') string()
    else {
      const m = /^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 400))
      if (!m) fail()
      i += m[0].length
    }
  }
  const string = () => {
    i++
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\n') fail()
      if (text[i] === '\\') i++
      i++
    }
    if (i >= text.length) fail()
    i++
  }
  try { value(); ws(); return i < text.length ? i : text.length } catch (e) { return typeof e === 'number' ? e : 0 }
}

/** Candidate record lists inside a JSON value: arrays of objects/arrays, and objects whose values are all objects. */
export function findRecordPaths(root) {
  const found = []
  const visit = (v, path, depth) => {
    if (Array.isArray(v)) {
      if (v.length && (!path.length || v.some((x) => isObj(x) || Array.isArray(x)))) found.push({ path, count: v.length, kind: 'array' })
    } else if (isObj(v)) {
      const vals = Object.values(v)
      if (vals.length > 1 && vals.every(isObj)) found.push({ path, count: vals.length, kind: 'map' })
      if (depth < 3) for (const [k, x] of Object.entries(v)) visit(x, [...path, k], depth + 1)
    }
  }
  visit(root, [], 0)
  return found.sort((a, b) => b.count - a.count || a.path.length - b.path.length)
}
export const pathLabel = (p) => (p.length ? p.map((x) => (typeof x === 'number' ? `[${x}]` : `.${x}`)).join('').replace(/^\./, '') : '(whole file)')
export const getPath = (v, path) => path.reduce((a, k) => (a == null ? a : a[k]), v)

/**
 * Flatten one value into one or more flat objects (several only when arrays: 'explode').
 * arrays: 'join' (primitive lists become "a, b"), 'index' (tags.0, tags.1), 'json' (kept as JSON text), 'explode' (one row per item).
 */
export function flattenRecord(value, { sep = '.', arrays = 'join', joiner = ', ', flatten = true, limit = 500000 } = {}) {
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      if (!v.length) return [{ [key]: '' }]
      if (arrays === 'json') return [{ [key]: JSON.stringify(v) }]
      if (arrays === 'join' && v.every((x) => x === null || typeof x !== 'object')) return [{ [key]: v.map((x) => (x == null ? '' : x)).join(joiner) }]
      if (arrays === 'explode') return v.flatMap((x) => walk(x, key))
      return crossAll(v.map((x, i) => walk(x, key ? `${key}${sep}${i}` : String(i))))
    }
    if (isObj(v)) {
      if (!flatten) return [{ [key]: JSON.stringify(v) }]
      const ents = Object.entries(v)
      if (!ents.length) return [{ [key]: '' }]
      return crossAll(ents.map(([k, x]) => walk(x, key ? `${key}${sep}${k}` : k)))
    }
    return [{ [key]: v === undefined ? '' : v }]
  }
  const crossAll = (parts) => {
    let rows = [{}]
    for (const list of parts) {
      if (list.length === 1) { for (const r of rows) Object.assign(r, list[0]); continue }
      const next = []
      for (const r of rows) for (const o of list) { next.push({ ...r, ...o }); if (next.length > limit) throw new Error('Exploding the arrays would create more than 500,000 rows. Pick another array option.') }
      rows = next
    }
    return rows
  }
  const out = walk(value, '')
  return out.map((o) => (o[''] !== undefined && Object.keys(o).length === 1 ? { value: o[''] } : o))
}

/** Turn parsed JSON into a table. path: 'auto' or a key path to the records. Returns { table, path, candidates }. */
export function jsonToTable(root, { path = 'auto', ...flat } = {}) {
  const candidates = findRecordPaths(root)
  let p = path
  if (p === 'auto') p = candidates[0]?.path ?? []
  const cand = candidates.find((c) => c.path.join('\u0000') === p.join('\u0000'))
  let recs = getPath(root, p)
  if (cand?.kind === 'map') recs = Object.entries(recs).map(([k, v]) => ({ key: k, ...v }))
  if (!Array.isArray(recs)) recs = [recs]
  if (recs.length && recs.every(Array.isArray) && recs.every((r) => r.every((x) => x === null || typeof x !== 'object'))) {
    const t = makeTable(recs.map((r) => r.map((x) => (x == null ? '' : x))), flat.header ?? 'auto')
    return { table: { headers: t.headers, rows: t.rows }, path: p, candidates, hasHeader: t.hasHeader }
  }
  const keys = []
  const seen = new Set()
  const flats = []
  for (const r of recs) {
    for (const o of flattenRecord(r, flat)) {
      flats.push(o)
      for (const k of Object.keys(o)) if (!seen.has(k)) { seen.add(k); keys.push(k) }
    }
  }
  const headers = keys.length ? keys : ['value']
  const rows = flats.map((o) => headers.map((k) => (o[k] === undefined || o[k] === null ? '' : o[k])))
  return { table: { headers, rows }, path: p, candidates, hasHeader: true }
}

function setPath(obj, parts, val) {
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i], nextIsIdx = /^\d+$/.test(parts[i + 1])
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = nextIsIdx ? [] : {}
    cur = cur[k]
  }
  cur[parts.at(-1)] = val
}

/** Convert a table to JSON-ready values. shape: 'objects' | 'arrays' | 'columns'. infer: numbers and booleans. nest: unflatten "a.b" headers. */
export function tableToJson(table, { shape = 'objects', infer = true, nest = false, empty = 'null', types } = {}) {
  const ty = infer ? (types || inferTypes(table)) : table.headers.map(() => 'text')
  const conv = (v, c) => {
    if (isEmpty(v)) return empty === 'null' ? null : empty === 'omit' ? undefined : ''
    if (typeof v !== 'string') return v
    const t = ty[c]
    if (t === 'integer' || t === 'number') { const n = parseNumber(v); return n == null ? v : n }
    if (t === 'boolean') return /^true$/i.test(v.trim())
    return v
  }
  if (shape === 'arrays') return [table.headers, ...table.rows.map((r) => r.map((v, c) => { const x = conv(v, c); return x === undefined ? null : x }))]
  if (shape === 'columns') return Object.fromEntries(table.headers.map((h, c) => [h, table.rows.map((r) => { const x = conv(r[c], c); return x === undefined ? null : x })]))
  const keyParts = nest ? table.headers.map((h) => h.split('.')) : null
  return table.rows.map((r) => {
    const o = {}
    for (let c = 0; c < table.headers.length; c++) {
      const x = conv(r[c], c)
      if (x === undefined) continue
      if (nest && keyParts[c].length > 1) setPath(o, keyParts[c], x)
      else o[table.headers[c]] = x
    }
    return o
  })
}
export function jsonText(value, { indent = 2, lines = false } = {}) {
  if (lines && Array.isArray(value)) return value.map((x) => JSON.stringify(x)).join('\n') + '\n'
  return JSON.stringify(value, null, indent === 'tab' ? '\t' : indent || undefined)
}

// ---------- HTML, Markdown and ASCII tables ----------
/** All <table> elements in an HTML string as tables. spans: 'repeat' copies a spanned value into every covered cell. */
export function htmlToTables(html, { spans = 'repeat' } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = []
  for (const tbl of doc.querySelectorAll('table')) {
    for (const br of tbl.querySelectorAll('br')) br.replaceWith('\u0001')
    const grid = []
    let headerRows = 0
    const trs = [...tbl.rows]
    trs.forEach((tr, r) => {
      grid[r] ||= []
      let c = 0
      let allTh = tr.cells.length > 0
      for (const cell of tr.cells) {
        while (grid[r][c] !== undefined) c++
        const text = cell.textContent.replace(/\s+/g, ' ').replace(/ ?\u0001 ?/g, '\n').replace(/\u0001/g, '\n').trim()
        if (cell.tagName !== 'TH') allTh = false
        const rs = Math.max(1, Math.min(+cell.getAttribute('rowspan') || 1, 1000)), cs = Math.max(1, Math.min(+cell.getAttribute('colspan') || 1, 200))
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) {
          grid[r + i] ||= []
          grid[r + i][c + j] = i === 0 && j === 0 ? text : spans === 'repeat' ? text : ''
        }
        c += cs
      }
      if (allTh && r === headerRows) headerRows++
    })
    if (!grid.length) continue
    const rows = grid.map((r) => Array.from(r, (x) => x ?? ''))
    const t = makeTable(rows, headerRows > 0 || tbl.tHead?.rows.length ? true : 'auto')
    out.push({ table: { headers: t.headers, rows: t.rows }, hasHeader: t.hasHeader, label: tbl.querySelector('caption')?.textContent.trim() || '' })
  }
  return out
}

const BORDER_ONLY = /^[\s+\-=_:|\u2500-\u257F]+$/
const stripMd = (x) => x.replace(/<br\s*\/?>/gi, '\n').replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
function splitRow(line, bar) {
  let s = line.trim()
  if (s.startsWith(bar)) s = s.slice(1)
  if (s.endsWith(bar) && !s.endsWith('\\' + bar)) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === bar) { cur += bar; i++ } else if (s[i] === bar) { cells.push(cur.trim()); cur = '' } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}
/** Markdown (pipe) and ASCII / box-drawing tables found in text. Returns [{ table, hasHeader }]. */
export function markdownToTables(text) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks = []
  let cur = []
  const isTableLine = (l) => /[|\u2502\u2551]/.test(l) || (l.trim() && BORDER_ONLY.test(l) && /[-\u2500\u2550]{2,}/.test(l))
  for (const l of lines) {
    if (isTableLine(l)) cur.push(l)
    else { if (cur.length) blocks.push(cur); cur = [] }
  }
  if (cur.length) blocks.push(cur)
  const out = []
  for (const b of blocks) {
    const rows = []
    let headerSep = false
    for (const l of b) {
      if (BORDER_ONLY.test(l) && !/[A-Za-z0-9\u00C0-\uFFFF]/.test(l)) { if (rows.length === 1) headerSep = true; continue }
      const bar = l.includes('\u2502') ? '\u2502' : l.includes('\u2551') ? '\u2551' : '|'
      rows.push(splitRow(l, bar).map(bar === '|' ? stripMd : (x) => x))
    }
    if (!rows.length || Math.max(...rows.map((r) => r.length)) < 2) continue
    const t = makeTable(rows, headerSep ? true : 'auto')
    out.push({ table: { headers: t.headers, rows: t.rows }, hasHeader: t.hasHeader, label: '' })
  }
  return out
}

/** Sniff pasted text: JSON, an HTML table, a Markdown/ASCII table, or delimited text. Returns { table, kind, hasHeader, delimiter?, tables? }. */
export async function parsePasted(text, { delimiter = 'auto', header = 'auto' } = {}) {
  const t = text.trim()
  if (!t) return null
  if (/^[[{]/.test(t)) {
    try {
      const root = parseJsonText(t)
      const r = jsonToTable(root, {})
      return { table: r.table, kind: 'json', hasHeader: true, root }
    } catch (err) {
      // Looks like JSON but is not valid: say where it breaks instead of guessing a table.
      if (/^\s*(\{|\[\s*[[{"\d-])/.test(t) && /["\]}]/.test(t)) throw err
    }
  }
  if (/<t(able|r|d|h)[\s>]/i.test(t) && typeof DOMParser !== 'undefined') {
    const tables = htmlToTables(t)
    if (tables.length) return { table: tables[0].table, kind: 'html', hasHeader: tables[0].hasHeader, tables }
  }
  if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/m.test(t) || /^\s*[+\u250C\u2554][-+\u2500\u2550\u252C\u2566]+[+\u2510\u2557]?\s*$/m.test(t)) {
    const tables = markdownToTables(t)
    if (tables.length) return { table: tables[0].table, kind: 'markdown', hasHeader: tables[0].hasHeader, tables }
  }
  const r = await parseCsvText(text, { delimiter, header })
  return { table: r.table, kind: 'csv', hasHeader: r.hasHeader, delimiter: r.delimiter, warnings: r.warnings }
}

// ---------- Files ----------
export const TABLE_ACCEPT = '.csv,.tsv,.txt,.tab,.psv,.xlsx,.xlsm,.xlsb,.xls,.ods,.fods,.json,.ndjson,.jsonl,text/csv,application/json'
const EXCEL_EXT = new Set(['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'xltx', 'xlt'])
export const fileExt = (name = '') => (name.match(/\.([^.\/\\]+)$/)?.[1] || '').toLowerCase()
export const MAX_FILE_BYTES = 200 * 1024 * 1024

/** 'excel' | 'json' | 'text' from the extension, falling back to the first bytes. */
export async function sniffKind(file) {
  const e = fileExt(file.name)
  if (EXCEL_EXT.has(e)) return 'excel'
  if (e === 'json' || e === 'ndjson' || e === 'jsonl') return 'json'
  if (e === 'html' || e === 'htm' || e === 'xhtml' || e === 'md' || e === 'markdown') return 'markup'
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  if ((head[0] === 0x50 && head[1] === 0x4B) || (head[0] === 0xD0 && head[1] === 0xCF)) return 'excel'
  if (e === 'csv' || e === 'tsv' || e === 'txt' || e === 'tab') return 'text'
  const first = String.fromCharCode(...head).trim()[0]
  return first === '{' || first === '[' ? 'json' : 'text'
}

/**
 * Read a File into an entry: { name, size, kind, table, hasHeader, delimiter, encoding, sheets, sheet, ... }.
 * The raw text / workbook is kept on the entry so options can be changed without re-reading the file.
 */
export async function entryFromFile(file, opts = {}) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB. Files over ${MAX_FILE_BYTES / 1048576} MB are too big for the browser. Split it first.`)
  const kind = await sniffKind(file)
  if (kind === 'markup') {
    const d = decodeBuffer(await file.arrayBuffer(), 'auto')
    const e = await entryFromText(d.text, file.name)
    e.size = file.size; e.file = file
    return e
  }
  const entry = { name: file.name, size: file.size, kind: kind === 'text' ? 'csv' : kind, file, opts: { header: 'auto', delimiter: 'auto', encoding: 'auto', ...opts } }
  const buf = await file.arrayBuffer()
  if (kind === 'excel') {
    try {
      entry.book = await readWorkbook(buf)
    } catch (err) {
      if (/password|encrypt/i.test(String(err.message))) throw new Error(`${file.name} is password-protected. Remove the password in Excel first, then open it here.`)
      throw new Error(`${file.name} could not be read as a spreadsheet (${err.message}).`)
    }
    entry.sheets = entry.book.names
    entry.sheet = entry.opts.sheet && entry.sheets.includes(entry.opts.sheet) ? entry.opts.sheet : entry.sheets[0]
  } else {
    const d = decodeBuffer(buf, entry.opts.encoding)
    entry.text = d.text
    entry.encoding = d.encoding
  }
  return reparse(entry)
}
export async function entryFromText(text, name = 'pasted-data', opts = {}) {
  const entry = { name, size: text.length, kind: 'paste', text, opts: { header: 'auto', delimiter: 'auto', ...opts } }
  return reparse(entry)
}
/** Re-run the parser with entry.opts (after changing delimiter, header, sheet, ...). Mutates and returns the entry. */
export async function reparse(entry) {
  const o = entry.opts
  entry.warnings = []
  if (entry.kind === 'excel') {
    entry.sheet = o.sheet && entry.sheets.includes(o.sheet) ? o.sheet : entry.sheet
    const t = sheetToTable(entry.book, entry.sheet, { header: o.header, formatted: o.formatted, fillMerged: o.fillMerged })
    entry.table = { headers: t.headers, rows: t.rows }
    entry.hasHeader = t.hasHeader
  } else if (entry.kind === 'json') {
    entry.root ||= parseJsonText(entry.text)
    const r = jsonToTable(entry.root, { path: o.path || 'auto', arrays: o.arrays || 'join', flatten: o.flatten !== false, sep: o.sep || '.', header: o.header })
    entry.table = r.table
    entry.candidates = r.candidates
    entry.path = r.path
    entry.hasHeader = true
  } else if (entry.kind === 'paste') {
    const r = await parsePasted(entry.text, { delimiter: o.delimiter, header: o.header })
    if (!r) { entry.table = emptyTable(); return entry }
    entry.table = r.table; entry.hasHeader = r.hasHeader; entry.delimiter = r.delimiter; entry.pasteKind = r.kind; entry.root = r.root; entry.warnings = r.warnings || []
    entry.found = r.tables
    const ti = o.tableIndex || 0
    if (r.tables?.[ti]) { entry.table = r.tables[ti].table; entry.hasHeader = r.tables[ti].hasHeader }
    if (r.kind === 'json') {
      const j = jsonToTable(r.root, { path: o.path || 'auto', arrays: o.arrays || 'join', flatten: o.flatten !== false, sep: o.sep || '.' })
      entry.table = j.table; entry.candidates = j.candidates; entry.path = j.path
    }
  } else {
    const r = await parseCsvText(entry.text, { delimiter: o.delimiter, header: o.header })
    entry.table = r.table; entry.hasHeader = r.hasHeader; entry.delimiter = r.delimiter; entry.warnings = r.warnings
  }
  return entry
}
export const baseOf = (name = '') => name.replace(/\.[^.\/\\]+$/, '') || 'data'

// ---------- Table operations ----------
export const selectColumns = (t, idx) => ({ headers: idx.map((i) => t.headers[i]), rows: t.rows.map((r) => idx.map((i) => r[i])) })
export function transpose(t, { includeHeader = true, headerFromFirstRow = true } = {}) {
  const grid = includeHeader ? [t.headers, ...t.rows] : t.rows
  const w = grid.reduce((m, r) => Math.max(m, r.length), 0)
  const cols = []
  for (let c = 0; c < w; c++) cols.push(grid.map((r) => (r[c] == null ? '' : r[c])))
  if (!headerFromFirstRow || !cols.length) return { headers: cols[0]?.map((_, i) => `Column ${i + 1}`) || [], rows: cols }
  return { headers: uniqueHeaders(cols[0]), rows: cols.slice(1) }
}

function typedKey(v, kind, order) {
  if (isEmpty(v)) return null
  if (kind === 'number') { const n = num(v); return n }
  if (kind === 'date') { const p = typeof v === 'string' ? parseDate(v, order) : null; return p ? dateMillis(p) : null }
  return String(v)
}
/** Sort row indexes. specs: [{ col, dir: 'asc'|'desc', as: 'auto'|'text'|'number'|'date' }]. Empty cells always sort last. */
export function sortIndices(table, specs, { types, base } = {}) {
  const ty = types || inferTypes(table)
  const n = table.rows.length
  const idx = base ? Array.from(base) : Array.from({ length: n }, (_, i) => i)
  const keys = specs.map((s) => {
    let kind = s.as && s.as !== 'auto' ? s.as : isNumericType(ty[s.col]) ? 'number' : ty[s.col] === 'date' || ty[s.col] === 'datetime' ? 'date' : 'text'
    const order = inferDateOrder(table.rows.slice(0, 2000).map((r) => r[s.col])) || localeDateOrder()
    const arr = new Array(n)
    for (let i = 0; i < n; i++) {
      arr[i] = typedKey(table.rows[i][s.col], kind, order)
    }
    return { arr, kind, dir: s.dir === 'desc' ? -1 : 1 }
  })
  idx.sort((a, b) => {
    for (const k of keys) {
      const x = k.arr[a], y = k.arr[b]
      const xe = x == null, ye = y == null
      if (xe || ye) { if (xe && ye) continue; return xe ? 1 : -1 }
      const d = k.kind === 'text' ? collator.compare(x, y) : x < y ? -1 : x > y ? 1 : 0
      if (d) return d * k.dir
    }
    return 0
  })
  return idx
}

export const FILTER_OPS = [
  ['contains', 'contains'], ['notcontains', 'does not contain'], ['eq', 'equals'], ['neq', 'does not equal'], ['starts', 'starts with'], ['ends', 'ends with'],
  ['gt', 'is greater than'], ['gte', 'is at least'], ['lt', 'is less than'], ['lte', 'is at most'], ['between', 'is between'],
  ['empty', 'is empty'], ['notempty', 'is not empty'], ['regex', 'matches regex'], ['in', 'is one of (comma list)'],
]
export const opNeedsValue = (op) => op !== 'empty' && op !== 'notempty'

/** Compile filter rules into a (row) => boolean function. match: 'all' | 'any'. */
export function compileFilter(table, rules, { match = 'all', caseSensitive = false } = {}) {
  const active = rules.filter((r) => r.col >= 0 && (!opNeedsValue(r.op) || (r.value ?? '') !== '' || r.op === 'eq' || r.op === 'neq'))
  if (!active.length) return () => true
  const order = localeDateOrder()
  const cs = (s) => (caseSensitive ? s : s.toLowerCase())
  const ref = (x) => ({ s: str(x), n: parseNumber(str(x)), d: parseDate(str(x), order) })
  const cmpv = (cell, r) => {
    const cn = num(cell)
    if (r.n != null && cn != null) return cn < r.n ? -1 : cn > r.n ? 1 : 0
    if (r.d && typeof cell === 'string') { const cd = parseDate(cell, order); if (cd) { const a = dateMillis(cd), b = dateMillis(r.d); return a < b ? -1 : a > b ? 1 : 0 } }
    return collator.compare(str(cell), r.s)
  }
  const fns = active.map((r) => {
    const val = str(r.value)
    const a = ref(val), b = ref(r.value2)
    let re = null
    if (r.op === 'regex') { try { re = new RegExp(val, caseSensitive ? '' : 'i') } catch { re = null } }
    const list = r.op === 'in' ? new Set(val.split(',').map((x) => cs(x.trim()))) : null
    const vl = cs(val)
    return (row) => {
      const cell = row[r.col]
      const s = str(cell), sl = cs(s)
      switch (r.op) {
        case 'contains': return sl.includes(vl)
        case 'notcontains': return !sl.includes(vl)
        case 'eq': { const cn = num(cell); return a.n != null && cn != null ? cn === a.n : sl.trim() === vl.trim() }
        case 'neq': { const cn = num(cell); return a.n != null && cn != null ? cn !== a.n : sl.trim() !== vl.trim() }
        case 'starts': return sl.startsWith(vl)
        case 'ends': return sl.endsWith(vl)
        case 'gt': return !isEmpty(cell) && cmpv(cell, a) > 0
        case 'gte': return !isEmpty(cell) && cmpv(cell, a) >= 0
        case 'lt': return !isEmpty(cell) && cmpv(cell, a) < 0
        case 'lte': return !isEmpty(cell) && cmpv(cell, a) <= 0
        case 'between': {
          if (isEmpty(cell)) return false
          const [lo, hi] = isEmpty(r.value2) || cmpv(val, b) <= 0 ? [a, b] : [b, a]
          return cmpv(cell, lo) >= 0 && (isEmpty(r.value2) || cmpv(cell, hi) <= 0)
        }
        case 'empty': return isEmpty(cell)
        case 'notempty': return !isEmpty(cell)
        case 'regex': return re ? re.test(s) : false
        case 'in': return list.has(sl.trim())
        default: return true
      }
    }
  })
  return match === 'any' ? (row) => fns.some((f) => f(row)) : (row) => fns.every((f) => f(row))
}

/** Remove duplicate rows. cols: column indexes forming the key (empty = all). keep: 'first' | 'last'. */
export function dedupeRows(table, { cols, keep = 'first', ignoreCase = false, trim = true } = {}) {
  const idx = cols?.length ? cols : table.headers.map((_, i) => i)
  const keyOf = (r) => idx.map((c) => { let s = str(r[c]); if (trim) s = s.trim().replace(/\s+/g, ' '); return ignoreCase ? s.toLowerCase() : s }).join('\u0001')
  const keptRows = [], removed = []
  const seen = new Map()
  if (keep === 'last') {
    for (let i = table.rows.length - 1; i >= 0; i--) {
      const k = keyOf(table.rows[i])
      if (seen.has(k)) { removed.push(table.rows[i]); seen.get(k).n++ } else { seen.set(k, { n: 1 }); keptRows.push(table.rows[i]) }
    }
    keptRows.reverse(); removed.reverse()
  } else {
    for (const r of table.rows) {
      const k = keyOf(r)
      if (seen.has(k)) { removed.push(r); seen.get(k).n++ } else { seen.set(k, { n: 1 }); keptRows.push(r) }
    }
  }
  let groups = 0
  for (const v of seen.values()) if (v.n > 1) groups++
  return { table: { headers: table.headers, rows: keptRows }, removed, groups }
}

// ---------- Statistics ----------
export const sum = (a) => { let s = 0, c = 0; for (const x of a) { const y = x - c, t = s + y; c = (t - s) - y; s = t } return s }
export const mean = (a) => (a.length ? sum(a) / a.length : NaN)
export function percentile(sorted, p) {
  if (!sorted.length) return NaN
  const i = ((sorted.length - 1) * p) / 100
  const lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}
export const median = (sorted) => percentile(sorted, 50)
export function modes(a) {
  const f = new Map()
  for (const x of a) f.set(x, (f.get(x) || 0) + 1)
  let max = 0
  for (const c of f.values()) if (c > max) max = c
  return { values: max > 1 ? [...f].filter(([, c]) => c === max).map(([x]) => x).sort((x, y) => x - y) : [], count: max }
}
/** Descriptive statistics for an array of numbers. */
export function describe(values) {
  const a = values.filter((x) => Number.isFinite(x))
  const n = a.length
  const sorted = [...a].sort((x, y) => x - y)
  const m = mean(a)
  const ss = sum(a.map((x) => (x - m) ** 2))
  const varS = n > 1 ? ss / (n - 1) : NaN, varP = n ? ss / n : NaN
  const sd = Math.sqrt(varS)
  const q1 = percentile(sorted, 25), q3 = percentile(sorted, 75), iqr = q3 - q1
  let skew = NaN, kurt = NaN
  if (n > 2 && sd > 0) skew = (n / ((n - 1) * (n - 2))) * sum(a.map((x) => ((x - m) / sd) ** 3))
  if (n > 3 && sd > 0) kurt = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum(a.map((x) => ((x - m) / sd) ** 4)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3))
  const md = modes(a)
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr
  return {
    count: n, sum: sum(a), mean: m, median: median(sorted), mode: md.values, modeCount: md.count, min: sorted[0], max: sorted[n - 1], range: sorted[n - 1] - sorted[0],
    q1, q3, iqr, varianceSample: varS, variancePop: varP, stdSample: sd, stdPop: Math.sqrt(varP), sem: sd / Math.sqrt(n), cv: sd / Math.abs(m),
    skew, kurt, outliers: a.filter((x) => x < lo || x > hi).length, lowFence: lo, highFence: hi, sorted,
  }
}
export function pearson(x, y) {
  const n = Math.min(x.length, y.length)
  if (n < 2) return NaN
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN
}
export function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0])
  const r = new Array(a.length)
  for (let i = 0; i < idx.length;) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}
export const spearman = (x, y) => pearson(ranks(x), ranks(y))

/** Group-aggregate helper used by the pivot table and column profiles. */
export const AGGREGATES = [['sum', 'Sum'], ['count', 'Count'], ['counta', 'Count (non-empty)'], ['distinct', 'Count distinct'], ['avg', 'Average'], ['min', 'Min'], ['max', 'Max'], ['median', 'Median']]
export function aggregate(cells, fn) {
  if (fn === 'count') return cells.length
  const nonEmpty = cells.filter((v) => !isEmpty(v))
  if (fn === 'counta') return nonEmpty.length
  if (fn === 'distinct') return new Set(nonEmpty.map((v) => str(v).trim())).size
  const nums = []
  for (const v of nonEmpty) { const x = num(v); if (x != null) nums.push(x) }
  if (!nums.length) return fn === 'sum' ? 0 : ''
  switch (fn) {
    case 'sum': return sum(nums)
    case 'avg': return mean(nums)
    case 'min': return nums.reduce((a, b) => (b < a ? b : a))
    case 'max': return nums.reduce((a, b) => (b > a ? b : a))
    case 'median': return median(nums.sort((a, b) => a - b))
    default: return ''
  }
}

/** Profile of one column for the viewer: counts, unique values, top values and numeric summary. */
export function columnProfile(table, c, type) {
  const vals = table.rows.map((r) => r[c])
  const filled = vals.filter((v) => !isEmpty(v))
  const freq = new Map()
  for (const v of filled) { const k = str(v).trim(); freq.set(k, (freq.get(k) || 0) + 1) }
  const top = [...freq].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0])).slice(0, 6)
  const out = { type, count: vals.length, filled: filled.length, empty: vals.length - filled.length, unique: freq.size, top }
  if (isNumericType(type)) {
    const nums = []
    for (const v of filled) { const x = num(v); if (x != null) nums.push(x) }
    out.numeric = describe(nums)
  } else if (filled.length) {
    const lens = filled.map((v) => str(v).length)
    out.minLen = lens.reduce((a, b) => (b < a ? b : a)); out.maxLen = lens.reduce((a, b) => (b > a ? b : a))
  }
  return out
}

// ---------- Naming helpers ----------
/** A safe table/column identifier for SQL ("Order Date" -> order_date). */
export function sqlName(name, used = new Set()) {
  let n = str(name).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'col'
  if (/^\d/.test(n)) n = `c_${n}`
  let k = n, i = 2
  while (used.has(k)) k = `${n}_${i++}`
  used.add(k)
  return k
}
export const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`
