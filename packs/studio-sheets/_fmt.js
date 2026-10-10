// Number and date formatting (Excel format codes) and typed-input parsing. No DOM.
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_MS = 86400000
const BASE_1900 = Date.UTC(1899, 11, 30)

// ---------- Excel serial dates (1900 system, including its leap-year quirk) ----------
export function serialParts(s) {
  let days = Math.floor(s)
  let secs = Math.round((s - days) * 86400)
  if (secs >= 86400) { secs -= 86400; days++ }
  let y, m, d
  if (days === 60) { y = 1900; m = 2; d = 29 } else {
    const dt = new Date((days < 60 ? Date.UTC(1899, 11, 31) : BASE_1900) + days * DAY_MS)
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate()
  }
  return { y, m, d, hh: Math.floor(secs / 3600), mm: Math.floor((secs % 3600) / 60), ss: secs % 60, dow: ((days + 6) % 7 + 7) % 7, days }
}
export function ymdToSerial(y, m, d) {
  if (y === 1900 && m === 2 && d === 29) return 60
  const t = Date.UTC(y, m - 1, d)
  const diff = Math.round((t - BASE_1900) / DAY_MS)
  return t < Date.UTC(1900, 2, 1) ? diff - 1 : diff
}
export const dateToSerial = (dt) => ymdToSerial(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()) + (dt.getHours() * 3600 + dt.getMinutes() * 60 + dt.getSeconds()) / 86400
export const todaySerial = () => ymdToSerial(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate())
export const nowSerial = () => dateToSerial(new Date())
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

// ---------- General ----------
export function generalText(n) {
  if (!Number.isFinite(n)) return String(n)
  if (n === 0) return '0'
  const a = Math.abs(n)
  if (a >= 1e11 || a < 1e-9) return n.toExponential(5).replace(/\.?0+e/, 'e').replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2')
  return String(+n.toPrecision(11))
}
/** Number to string the way formulas coerce it (up to 15 significant digits). */
export function numToString(n) {
  if (!Number.isFinite(n)) return String(n)
  const a = Math.abs(n)
  if (a >= 1e21 || (a < 1e-7 && a > 0)) return n.toExponential(14).replace(/\.?0+e/, 'E')
  return String(+n.toPrecision(15))
}

// ---------- Format code compiler ----------
const COLORS = { black: '#000000', blue: '#2563eb', cyan: '#0891b2', green: '#16a34a', magenta: '#c026d3', red: '#dc2626', white: '#ffffff', yellow: '#ca8a04' }
const cache = new Map()

function tokenize(sec) {
  const toks = []
  let cond = null, color = null, i = 0
  while (i < sec.length) {
    const ch = sec[i]
    if (ch === '"') { let j = sec.indexOf('"', i + 1); if (j < 0) j = sec.length; toks.push({ t: 'lit', s: sec.slice(i + 1, j) }); i = j + 1 }
    else if (ch === '\\') { toks.push({ t: 'lit', s: sec[i + 1] || '' }); i += 2 }
    else if (ch === '_') { toks.push({ t: 'lit', s: ' ' }); i += 2 }
    else if (ch === '*') i += 2
    else if (ch === '[') {
      let j = sec.indexOf(']', i); if (j < 0) j = sec.length
      const inner = sec.slice(i + 1, j); i = j + 1
      const low = inner.toLowerCase()
      if (COLORS[low]) color = COLORS[low]
      else if (/^[<>=]/.test(inner)) { const m = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)/.exec(inner); if (m) cond = { op: m[1], n: parseFloat(m[2]) } }
      else if (inner[0] === '$') { const sym = inner.slice(1).split('-')[0]; if (sym) toks.push({ t: 'lit', s: sym }) }
      else if (/^(h+|m+|s+)$/i.test(inner)) toks.push({ t: 'el', ch: low[0], n: inner.length })
    }
    else if (ch === '0' || ch === '#' || ch === '?') { toks.push({ t: 'd', ch }); i++ }
    else if (ch === '.') { toks.push({ t: 'dot' }); i++ }
    else if (ch === ',') { toks.push({ t: 'comma' }); i++ }
    else if (ch === '%') { toks.push({ t: 'pct' }); i++ }
    else if ((ch === 'E' || ch === 'e') && (sec[i + 1] === '+' || sec[i + 1] === '-')) { toks.push({ t: 'exp', sign: sec[i + 1] }); i += 2 }
    else if (ch === '@') { toks.push({ t: 'text' }); i++ }
    else if (/[yYmMdDhHsS]/.test(ch)) {
      let j = i
      while (j < sec.length && sec[j].toLowerCase() === ch.toLowerCase()) j++
      toks.push({ t: 'dt', ch: ch.toLowerCase(), n: j - i }); i = j
    }
    else if (/^(am\/pm|a\/p)/i.test(sec.slice(i))) { const m = /^(am\/pm|a\/p)/i.exec(sec.slice(i))[0]; toks.push({ t: 'ampm', s: m }); i += m.length }
    else { toks.push({ t: 'lit', s: ch }); i++ }
  }
  const kind = toks.some((t) => t.t === 'dt' || t.t === 'ampm' || t.t === 'el') ? 'date' : toks.some((t) => t.t === 'd' || t.t === 'exp') ? 'num' : toks.some((t) => t.t === 'text') ? 'text' : 'num'
  return { toks, cond, color, kind }
}
function splitSections(code) {
  const out = []
  let cur = '', q = false, br = false
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]
    if (ch === '\\') { cur += ch + (code[++i] || ''); continue }
    if (ch === '"') q = !q
    else if (!q && ch === '[') br = true
    else if (!q && ch === ']') br = false
    if (ch === ';' && !q && !br) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}
export function compile(code) {
  let f = cache.get(code)
  if (f) return f
  const isGeneral = !code || /^general$/i.test(code.trim())
  const secs = isGeneral ? [] : splitSections(code).map(tokenize)
  f = { code, isGeneral, secs, indian: /##\\,##\\,##|\[>=10000000\]/.test(code || '') }
  if (cache.size > 500) cache.clear()
  cache.set(code, f)
  return f
}
const testCond = (c, x) => (c.op === '>' ? x > c.n : c.op === '<' ? x < c.n : c.op === '>=' ? x >= c.n : c.op === '<=' ? x <= c.n : c.op === '=' ? x === c.n : x !== c.n)

function pickSection(secs, x) {
  const n = secs.length
  if (secs.some((s) => s.cond)) {
    for (let i = 0; i < n; i++) if (!secs[i].cond || testCond(secs[i].cond, x)) return { sec: secs[i], autoMinus: x < 0 }
    return { sec: secs[n - 1], autoMinus: x < 0 }
  }
  if (n === 1) return { sec: secs[0], autoMinus: x < 0 }
  if (n === 2) return x >= 0 ? { sec: secs[0], autoMinus: false } : { sec: secs[1], autoMinus: false }
  return x > 0 ? { sec: secs[0], autoMinus: false } : x < 0 ? { sec: secs[1], autoMinus: false } : { sec: secs[2], autoMinus: false }
}

export function roundDec(x, dec) {
  const s = x.toPrecision(15)
  if (/e/.test(s) || dec > 15) return +x.toFixed(Math.min(dec, 100))
  return +(Math.round(+(s + 'e' + dec)) + 'e-' + dec)
}
function group(digits, indian) {
  if (digits.length <= 3) return digits
  if (!indian) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const last3 = digits.slice(-3)
  return digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
}

function fmtNumber(x, sec, indian) {
  const toks = sec.toks
  let first = toks.findIndex((t) => t.t === 'd')
  const expAt = toks.findIndex((t) => t.t === 'exp')
  let v = Math.abs(x)
  for (const t of toks) if (t.t === 'pct') v *= 100
  if (first < 0) return toks.map((t) => (t.t === 'lit' ? t.s : t.t === 'pct' ? '%' : '')).join('')
  let last = -1
  for (let i = toks.length - 1; i >= 0; i--) if (toks[i].t === 'd' && (expAt < 0 || i < expAt)) { last = i; break }
  // scaling commas right after the last digit placeholder
  let k = last + 1, scale = 0
  while (toks[k]?.t === 'comma') { scale++; k++ }
  if (scale) v /= Math.pow(1000, scale)
  const prefix = toks.slice(0, first).map((t) => (t.t === 'lit' ? t.s : t.t === 'pct' ? '%' : '')).join('')
  const region = toks.slice(first, last + 1)
  const tail = toks.slice(last + 1 + scale, expAt < 0 ? undefined : expAt)
  const expTok = expAt >= 0 ? toks[expAt] : null
  const expDigits = expAt >= 0 ? toks.slice(expAt + 1).filter((t) => t.t === 'd').length : 0
  const suffixAfterExp = expAt >= 0 ? toks.slice(expAt + 1).filter((t) => t.t !== 'd').map((t) => (t.t === 'lit' ? t.s : t.t === 'pct' ? '%' : '')).join('') : ''
  const tailText = tail.map((t) => (t.t === 'lit' ? t.s : t.t === 'pct' ? '%' : '')).join('')
  const dotAt = region.findIndex((t) => t.t === 'dot')
  const intT = dotAt < 0 ? region : region.slice(0, dotAt)
  const fracT = dotAt < 0 ? [] : region.slice(dotAt + 1).filter((t) => t.t === 'd')
  const dec = fracT.length
  const intPh = intT.filter((t) => t.t === 'd')
  let e = 0
  if (expTok) {
    e = v === 0 ? 0 : Math.floor(Math.log10(v))
    const n = Math.max(1, intPh.length)
    e -= ((e % n) + n) % n
    v = v / Math.pow(10, e)
    if (roundDec(v, dec) >= Math.pow(10, n)) { e += n; v = v / Math.pow(10, n) }
  }
  v = roundDec(v, dec)
  const fixed = v.toFixed(Math.min(dec, 100))
  let [ip, fp = ''] = fixed.split('.')
  const zeros = intPh.filter((t) => t.ch === '0').length
  if (ip === '0' && !zeros) ip = ''
  const thousands = intT.some((t) => t.t === 'comma')
  let intStr
  if (thousands) {
    intStr = group(ip.padStart(zeros, '0'), indian)
  } else {
    const out = []
    let di = ip.length - 1
    for (let i = intT.length - 1; i >= 0; i--) {
      const t = intT[i]
      if (t.t === 'd') { if (di >= 0) out.push({ s: ip[di--], dig: true }); else if (t.ch === '0') out.push({ s: '0', dig: true }); else if (t.ch === '?') out.push({ s: ' ' }) }
      else if (t.t === 'lit') out.push({ s: t.s, lit: true })
      else if (t.t === 'pct') out.push({ s: '%', lit: true })
    }
    while (di >= 0) out.push({ s: ip[di--], dig: true })
    out.reverse()
    while (out.length && out[0].lit) out.shift()
    intStr = out.map((o) => o.s).join('')
  }
  let fracStr = ''
  if (dec) {
    let nz = -1
    for (let j = 0; j < fp.length; j++) if (fp[j] !== '0') nz = j
    for (let j = 0; j < dec; j++) fracStr += fracT[j].ch === '0' || j <= nz ? fp[j] : fracT[j].ch === '?' ? ' ' : ''
  }
  let s = intStr + (dec ? '.' + fracStr : '')
  if (expTok) {
    const sign = e < 0 ? '-' : expTok.sign === '+' ? '+' : ''
    s += 'E' + sign + String(Math.abs(e)).padStart(expDigits || 1, '0') + suffixAfterExp
  }
  return prefix + s + tailText
}

function fmtDate(x, sec) {
  const p = serialParts(x)
  const toks = sec.toks
  const ampm = toks.some((t) => t.t === 'ampm')
  let out = ''
  const sig = (i, dir) => { for (let j = i + dir; j >= 0 && j < toks.length; j += dir) { const t = toks[j]; if (t.t === 'dt' || t.t === 'el') return t; if (t.t === 'ampm') return null } return null }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t === 'lit') out += t.s
    else if (t.t === 'dt') {
      const n = t.n
      if (t.ch === 'y') out += n >= 3 ? String(p.y).padStart(4, '0') : String(p.y % 100).padStart(2, '0')
      else if (t.ch === 'd') out += n === 1 ? p.d : n === 2 ? String(p.d).padStart(2, '0') : n === 3 ? DAYS[p.dow].slice(0, 3) : DAYS[p.dow]
      else if (t.ch === 'h') { const h = ampm ? ((p.hh + 11) % 12) + 1 : p.hh; out += n >= 2 ? String(h).padStart(2, '0') : h }
      else if (t.ch === 's') out += n >= 2 ? String(p.ss).padStart(2, '0') : p.ss
      else if (t.ch === 'm') {
        const prev = sig(i, -1), next = sig(i, 1)
        const isMin = (prev && (prev.ch === 'h')) || (next && next.ch === 's')
        if (isMin) out += n >= 2 ? String(p.mm).padStart(2, '0') : p.mm
        else out += n === 1 ? p.m : n === 2 ? String(p.m).padStart(2, '0') : n === 3 ? MONTHS[p.m - 1].slice(0, 3) : n === 4 ? MONTHS[p.m - 1] : MONTHS[p.m - 1][0]
      }
    }
    else if (t.t === 'ampm') {
      const pm = p.hh >= 12
      out += t.s.toLowerCase() === 'a/p' ? (t.s[0] === 'a' ? (pm ? 'p' : 'a') : pm ? 'P' : 'A') : t.s === 'am/pm' ? (pm ? 'pm' : 'am') : pm ? 'PM' : 'AM'
    }
    else if (t.t === 'el') {
      const total = Math.floor(x * 86400 + 1e-6)
      const val = t.ch === 'h' ? Math.floor(total / 3600) : t.ch === 'm' ? Math.floor(total / 60) : total
      out += String(val).padStart(t.n, '0')
    }
    else if (t.t === 'dot') out += '.'
    else if (t.t === 'd') out += '0'
    else if (t.t === 'comma') out += ','
  }
  return out
}

/** Format any cell value. Returns {text, color}. */
export function formatValue(v, code, opts = {}) {
  if (v == null) return { text: '' }
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE' }
  if (typeof v === 'object') return { text: v.code || String(v) }
  const f = compile(code || 'General')
  if (typeof v === 'string') {
    if (f.isGeneral) return { text: v }
    const sec = f.secs[f.secs.length >= 4 ? 3 : f.secs.length - 1]
    const t = f.secs.find((s) => s.kind === 'text') || (sec.toks.some((x) => x.t === 'text') ? sec : null)
    if (!t) return { text: v }
    return { text: t.toks.map((x) => (x.t === 'text' ? v : x.t === 'lit' ? x.s : '')).join(''), color: t.color }
  }
  if (!Number.isFinite(v)) return { text: Number.isNaN(v) ? '#NUM!' : '#NUM!' }
  if (f.isGeneral) return { text: generalText(v) }
  const { sec, autoMinus } = pickSection(f.secs, v)
  if (sec.kind === 'date') {
    if (v < 0) return { text: '#'.repeat(opts.chars || 8), color: sec.color }
    return { text: fmtDate(v, sec), color: sec.color }
  }
  if (sec.kind === 'text') return { text: sec.toks.map((x) => (x.t === 'lit' ? x.s : '')).join(''), color: sec.color }
  let text = fmtNumber(v, sec, f.indian)
  if (autoMinus && v < 0 && /[1-9]/.test(text)) text = '-' + text
  return { text, color: sec.color }
}
export const formatText = (v, code) => formatValue(v, code).text

export const isDateFormat = (code) => { const f = compile(code || 'General'); return !f.isGeneral && f.secs.some((s) => s.kind === 'date') }
export const isPercentFormat = (code) => { const f = compile(code || 'General'); return !f.isGeneral && f.secs.some((s) => s.kind === 'num' && s.toks.some((t) => t.t === 'pct')) }

// ---------- Presets for the UI ----------
const INR = (sym, dec) => { const d = dec ? '.' + '0'.repeat(dec) : ''; return `[>=10000000]${sym}##\\,##\\,##\\,##0${d};[>=100000]${sym}##\\,##\\,##0${d};${sym}##,##0${d}` }
export const FMT = {
  general: 'General', int: '0', dec2: '0.00', thousands: '#,##0', thousands2: '#,##0.00',
  inr: INR('"₹"', 2), inr0: INR('"₹"', 0), indian: INR('', 2), usd: '"$"#,##0.00', eur: '"€"#,##0.00', gbp: '"£"#,##0.00',
  pct0: '0%', pct2: '0.00%', sci: '0.00E+00', text: '@',
  dmy: 'dd/mm/yyyy', mdy: 'mm/dd/yyyy', iso: 'yyyy-mm-dd', dmony: 'dd-mmm-yyyy', mdy_long: 'mmm d, yyyy', long: 'dddd, mmmm d, yyyy',
  hm: 'hh:mm', hms: 'hh:mm:ss', hm12: 'h:mm AM/PM', dmyhm: 'dd/mm/yyyy hh:mm',
}
export const PRESETS = [
  ['General', FMT.general, 1234.5], ['Number', FMT.dec2, 1234.5], ['Number, no decimals', FMT.int, 1234.5], ['Thousands separator', FMT.thousands2, 1234567.891],
  ['Indian grouping', FMT.indian, 1234567.891], ['Rupee (₹)', FMT.inr, 1234567.891], ['Rupee, no decimals', FMT.inr0, 1234567.891], ['Dollar ($)', FMT.usd, 1234.5], ['Euro (€)', FMT.eur, 1234.5], ['Pound (£)', FMT.gbp, 1234.5],
  ['Percent', FMT.pct0, 0.256], ['Percent, 2 decimals', FMT.pct2, 0.256], ['Scientific', FMT.sci, 12345.678],
  ['Date dd/mm/yyyy', FMT.dmy, 45678], ['Date mm/dd/yyyy', FMT.mdy, 45678], ['Date yyyy-mm-dd', FMT.iso, 45678], ['Date 05-Jan-2025', FMT.dmony, 45678], ['Date Jan 5, 2025', FMT.mdy_long, 45678], ['Long date', FMT.long, 45678],
  ['Time hh:mm', FMT.hm, 0.5625], ['Time hh:mm:ss', FMT.hms, 0.5625], ['Time 12-hour', FMT.hm12, 0.5625], ['Date and time', FMT.dmyhm, 45678.5625], ['Text', FMT.text, 'abc'],
]
export const nfLabel = (code) => PRESETS.find((p) => p[1] === code)?.[0] || (code && code !== 'General' ? 'Custom' : 'General')

/** Add or remove a decimal place from a format code. */
export function adjustDecimals(code, delta, sample) {
  if (!code || /^general$/i.test(code)) {
    if (delta < 0) return code || 'General'
    const s = typeof sample === 'number' ? generalText(sample) : ''
    const d = /\.(\d+)/.exec(s)?.[1].length || 0
    return d + delta <= 0 ? '0' : '0.' + '0'.repeat(d + delta)
  }
  const sections = splitSections(code)
  return sections.map((sec) => {
    let i = 0, q = false, br = false, dot = -1, lastDigit = -1
    for (; i < sec.length; i++) {
      const ch = sec[i]
      if (ch === '\\') { i++; continue }
      if (ch === '"') q = !q
      else if (!q && ch === '[') br = true
      else if (!q && ch === ']') br = false
      else if (!q && !br) {
        if (ch === '.' && dot < 0) dot = i
        if ((ch === '0' || ch === '#') && (dot < 0 || i > dot)) lastDigit = i
        if (/[eE]/.test(ch) && sec[i + 1] && /[+-]/.test(sec[i + 1])) break
      }
    }
    if (lastDigit < 0) return sec
    if (dot < 0) return delta > 0 ? sec.slice(0, lastDigit + 1) + '.' + '0'.repeat(delta) + sec.slice(lastDigit + 1) : sec
    let end = dot + 1
    while (end < sec.length && /[0#?]/.test(sec[end])) end++
    const n = end - dot - 1 + delta
    return n <= 0 ? sec.slice(0, dot) + sec.slice(end) : sec.slice(0, dot + 1) + '0'.repeat(n) + sec.slice(end)
  }).join(';')
}

// ---------- Typed input ----------
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const monthNum = (s) => MON[s.slice(0, 3).toLowerCase()] || (s.toLowerCase().startsWith('sept') ? 9 : 0)
const yr = (s) => { const n = parseInt(s, 10); return s.length <= 2 ? (n < 30 ? 2000 + n : 1900 + n) : n }
const validYMD = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) && y >= 1900 && y <= 9999
const CUR = { '₹': FMT.inr, 'Rs.': FMT.inr, 'Rs': FMT.inr, 'INR': FMT.inr, '$': FMT.usd, '€': FMT.eur, '£': FMT.gbp }

function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|AM|PM)?$/.exec(s)
  if (!m) return null
  let h = parseInt(m[1], 10); const mi = parseInt(m[2], 10), se = m[3] ? parseInt(m[3], 10) : 0
  if (mi > 59 || se > 59) return null
  if (m[4]) { if (h < 1 || h > 12) return null; h = (h % 12) + (/pm/i.test(m[4]) ? 12 : 0) } else if (h > 47) return null
  return { frac: (h * 3600 + mi * 60 + se) / 86400, nf: m[4] ? FMT.hm12 : m[3] ? FMT.hms : FMT.hm, secs: !!m[3], ampm: !!m[4] }
}
function parseDate(s, order) {
  let m
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) { const y = +m[1], mo = +m[2], d = +m[3]; return validYMD(y, mo, d) ? { serial: ymdToSerial(y, mo, d), nf: FMT.iso } : null }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    let d = +m[1], mo = +m[2]; if (order === 'mdy') [d, mo] = [mo, d]
    const y = yr(m[3])
    return validYMD(y, mo, d) ? { serial: ymdToSerial(y, mo, d), nf: order === 'mdy' ? FMT.mdy : FMT.dmy } : null
  }
  if ((m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})\.?[-\s,]*(\d{2}|\d{4})$/.exec(s))) { const mo = monthNum(m[2]); const y = yr(m[3]); return mo && validYMD(y, mo, +m[1]) ? { serial: ymdToSerial(y, mo, +m[1]), nf: FMT.dmony } : null }
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) { const mo = monthNum(m[1]); return mo && validYMD(+m[3], mo, +m[2]) ? { serial: ymdToSerial(+m[3], mo, +m[2]), nf: FMT.mdy_long } : null }
  if ((m = /^([A-Za-z]{3,9})[-\s](\d{2}|\d{4})$/.exec(s))) { const mo = monthNum(m[1]); const y = yr(m[2]); return mo ? { serial: ymdToSerial(y, mo, 1), nf: 'mmm-yy' } : null }
  return null
}
/**
 * parseInput('1,234.5') -> {kind:'value', v, nf?} | {kind:'formula', f} | {kind:'empty'}.
 * opts.dateOrder: 'dmy' (default) or 'mdy'.
 */
export function parseInput(text, opts = {}) {
  if (text == null || text === '') return { kind: 'empty' }
  if (typeof text !== 'string') return { kind: 'value', v: text }
  if (text[0] === '=' && text.length > 1) return { kind: 'formula', f: text.slice(1) }
  if (text[0] === "'") return { kind: 'value', v: text.slice(1), text: true }
  const s = text.trim()
  if (s === '') return { kind: 'value', v: text }
  if (/^(true|false)$/i.test(s)) return { kind: 'value', v: s.toLowerCase() === 'true' }
  const order = opts.dateOrder || 'dmy'
  // numbers, currency, percent
  let body = s, nf = null, neg = false
  const par = /^\((.*)\)$/.exec(body)
  if (par) { body = par[1].trim(); neg = true }
  let sign = ''
  if (/^[+-]/.test(body)) { sign = body[0]; body = body.slice(1).trim() }
  const cur = /^(₹|Rs\.?|INR|\$|€|£)\s*/i.exec(body)
  if (cur) { nf = CUR[cur[1]] || CUR[cur[1].replace(/\.$/, '')] || CUR[cur[1].toUpperCase()] || FMT.inr; body = body.slice(cur[0].length) }
  if (!sign && /^[+-]/.test(body)) { sign = body[0]; body = body.slice(1) }
  const pct = /%$/.test(body)
  if (pct) body = body.slice(0, -1).trim()
  const plain = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(body)
  const western = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(body)
  const indian = /^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/.test(body)
  if (plain || western || indian) {
    let n = parseFloat(body.replace(/,/g, ''))
    if (sign === '-' || neg) n = -n
    if (pct) { n /= 100; nf = (/\.(\d+)/.exec(body)?.[1].length ? '0.' + '0'.repeat(/\.(\d+)/.exec(body)[1].length) + '%' : FMT.pct0) }
    else if (!nf && (western || indian) && /,/.test(body) && !opts.noGroupFormat) nf = /\./.test(body) ? FMT.thousands2 : FMT.thousands
    return Number.isFinite(n) ? { kind: 'value', v: n, ...(nf ? { nf } : {}) } : { kind: 'value', v: text }
  }
  // time / date / date-time
  const t = parseTime(s)
  if (t) return { kind: 'value', v: t.frac, nf: t.nf }
  const dt = parseDate(s, order)
  if (dt) return { kind: 'value', v: dt.serial, nf: dt.nf }
  const sp = /^(.*\S)(?:\s+|T)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm))?)$/i.exec(s)
  if (sp) {
    const d2 = parseDate(sp[1], order), t2 = parseTime(sp[2].trim())
    if (d2 && t2) return { kind: 'value', v: d2.serial + t2.frac, nf: `${d2.nf} ${t2.secs ? 'hh:mm:ss' : t2.ampm ? 'h:mm AM/PM' : 'hh:mm'}` }
  }
  return { kind: 'value', v: text }
}
