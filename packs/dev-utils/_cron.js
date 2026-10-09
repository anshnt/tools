// Cron parsing, validation and next-run calculation (standard 5-field, seconds-first 6-field, and Quartz with ? L W #).
// Pure functions, no DOM. Wall-clock fields are resolved in an IANA time zone with the helpers from timestamp-converter.
import { zonedToEpoch, partsIn } from './timestamp-converter.js'

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
export const DIALECTS = {
  std: { label: 'Standard (5 fields)', keys: ['min', 'hour', 'dom', 'mon', 'dow'] },
  sec: { label: 'With seconds (6 fields)', keys: ['sec', 'min', 'hour', 'dom', 'mon', 'dow'] },
  quartz: { label: 'Quartz / Spring (6-7 fields)', keys: ['sec', 'min', 'hour', 'dom', 'mon', 'dow', 'year'] },
}
export const FIELD_LABEL = { sec: 'Second', min: 'Minute', hour: 'Hour', dom: 'Day of month', mon: 'Month', dow: 'Day of week', year: 'Year' }
const RANGE = { sec: [0, 59], min: [0, 59], hour: [0, 23], dom: [1, 31], mon: [1, 12], dow: [0, 7], year: [1970, 2199] }
const ALIASES = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' }

export class CronError extends Error {
  constructor(message, field) { super(message); this.field = field }
}

/** Split an expression into dialect + field texts. dialect 'auto' guesses from the field count and any Quartz-only symbols. */
export function splitCron(expr, dialect = 'auto') {
  let t = expr.trim().replace(/\s+/g, ' ')
  if (!t) throw new CronError('Enter a cron expression.')
  if (/^@reboot$/i.test(t)) throw new CronError('@reboot runs once at startup, so it has no schedule to calculate.')
  if (t[0] === '@') {
    const a = ALIASES[t.toLowerCase()]
    if (!a) throw new CronError(`Unknown shortcut ${t}. Use @hourly, @daily, @weekly, @monthly or @yearly.`)
    t = a
    if (dialect === 'auto') dialect = 'std'
  }
  const parts = t.split(' ')
  if (dialect === 'auto') {
    const q = /[?LW#]/i.test(t.replace(/\b(MON|WED|FRI|SAT|SUN|THU|TUE|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/gi, ''))
    dialect = parts.length === 5 ? 'std' : q || parts.length === 7 ? 'quartz' : parts.length === 6 ? 'sec' : 'std'
  }
  const keys = DIALECTS[dialect].keys
  const ok = dialect === 'quartz' ? parts.length === 6 || parts.length === 7 : parts.length === keys.length
  if (!ok) throw new CronError(`A ${DIALECTS[dialect].label.toLowerCase()} expression needs ${dialect === 'quartz' ? '6 or 7' : keys.length} space-separated fields, but this has ${parts.length}.`)
  return { dialect, fields: parts.map((text, i) => ({ key: keys[i], text })) }
}

/** Parse one field into {star, values:Set, ...specials}. Values for dow are normalised to 0-6 (Sunday = 0). */
export function parseField(key, text, dialect) {
  const q = dialect === 'quartz'
  const [lo, hi] = key === 'dow' ? (q ? [1, 7] : [0, 7]) : RANGE[key]
  const f = { key, text, star: /^[*?]/.test(text), any: text === '*' || text === '?', values: new Set(), last: false, lastOffset: null, nearest: [], lastDow: [], nth: [] }
  const fail = (m) => { throw new CronError(`${FIELD_LABEL[key]}: ${m}`, key) }
  if (text === '?') {
    if (!q || (key !== 'dom' && key !== 'dow')) fail('"?" is only valid for day of month and day of week in Quartz expressions.')
    return f
  }
  // token -> number in this dialect's numbering (names map to 1-7 for Quartz weekdays, 0-6 otherwise)
  const tokNum = (tok) => {
    const u = tok.toUpperCase()
    if (key === 'dow') { const i = DOWS.indexOf(u); if (i >= 0) return q ? i + 1 : i }
    if (key === 'mon') { const i = MONTHS.indexOf(u); if (i >= 0) return i + 1 }
    return /^\d+$/.test(tok) ? +tok : NaN
  }
  const norm = (n) => (key !== 'dow' ? n : q ? n - 1 : n % 7)
  const checkRange = (n, tok) => {
    if (Number.isNaN(n)) fail(`"${tok}" is not a valid ${key === 'mon' ? 'month' : key === 'dow' ? 'weekday' : 'number'}.`)
    if (n < lo || n > hi) fail(`${n} is out of range (${lo}-${hi}).`)
  }
  for (const item of text.split(',')) {
    if (!item) fail('empty value between commas.')
    let m
    if (q && key === 'dom') {
      if (/^L$/i.test(item)) { f.last = true; continue }
      if ((m = /^L-(\d+)$/i.exec(item))) { if (+m[1] > 30) fail('L-n needs n between 0 and 30.'); f.lastOffset = +m[1]; continue }
      if (/^LW$/i.test(item)) { f.nearest.push('L'); continue }
      if ((m = /^(\d+)W$/i.exec(item))) { if (+m[1] < 1 || +m[1] > 31) fail(`${m[1]} is out of range (1-31).`); f.nearest.push(+m[1]); continue }
    }
    if (q && key === 'dow') {
      if (/^L$/i.test(item)) { f.values.add(6); continue }
      if ((m = /^(\w+)#(\d)$/.exec(item))) {
        const n = tokNum(m[1])
        if (!(n >= 1 && n <= 7) || +m[2] < 1 || +m[2] > 5) fail(`"${item}" is not valid. Use day#n with n from 1 to 5, for example 6#3 for the third Friday.`)
        f.nth.push({ dow: n - 1, k: +m[2] }); continue
      }
      if ((m = /^(\w+?)L$/i.exec(item)) && tokNum(m[1]) >= 1 && tokNum(m[1]) <= 7) { f.lastDow.push(tokNum(m[1]) - 1); continue }
    }
    m = /^(\*|\w+)(?:-(\w+))?(?:\/(\d+))?$/.exec(item)
    if (!m) fail(`"${item}" is not a valid value.`)
    const hasStep = m[3] != null
    const step = hasStep ? +m[3] : 1
    if (hasStep && step < 1) fail('the step after "/" must be at least 1.')
    let a, b
    if (m[1] === '*') { a = lo; b = key === 'dow' ? (q ? 7 : 6) : hi } else {
      a = tokNum(m[1]); checkRange(a, m[1])
      if (m[2] != null) { b = tokNum(m[2]); checkRange(b, m[2]) } else b = hasStep ? (key === 'dow' ? (q ? 7 : 6) : hi) : a
    }
    if (a > b) {
      if (key !== 'dow') fail(`the range ${m[1]}-${m[2]} is out of order.`)
      for (let v = a; v <= hi; v += step) f.values.add(norm(v))
      for (let v = lo; v <= b; v += step) f.values.add(norm(v))
      continue
    }
    for (let v = a; v <= b; v += step) f.values.add(norm(v))
  }
  if (!f.values.size && !f.last && f.lastOffset == null && !f.nearest.length && !f.lastDow.length && !f.nth.length) fail('no values selected.')
  return f
}

export function parseCron(expr, dialect = 'auto') {
  const { dialect: d, fields } = splitCron(expr, dialect)
  const spec = { dialect: d, fields: {}, raw: fields }
  for (const f of fields) spec.fields[f.key] = parseField(f.key, f.text, d)
  return spec
}

const daysIn = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate()
function domMatch(f, y, mo, d) {
  if (f.any) return true
  const last = daysIn(y, mo)
  if (f.values.has(d)) return true
  if (f.last && d === last) return true
  if (f.lastOffset != null && d === last - f.lastOffset) return true
  for (const n of f.nearest) {
    const target = n === 'L' ? last : Math.min(n, last)
    const dow = new Date(Date.UTC(y, mo - 1, target)).getUTCDay()
    let day = target
    if (dow === 6) day = target === 1 ? 3 : target - 1
    else if (dow === 0) day = target === last ? target - 2 : target + 1
    if (n !== 'L' && +n > last) continue
    if (d === day) return true
  }
  return false
}
function dowMatch(f, y, mo, d) {
  if (f.any) return true
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  if (f.values.has(dow)) return true
  for (const n of f.lastDow) if (dow === n && d + 7 > daysIn(y, mo)) return true
  for (const { dow: n, k } of f.nth) if (dow === n && Math.ceil(d / 7) === k) return true
  return false
}

export function dayMatches(spec, y, mo, d) {
  const F = spec.fields
  if (F.year && !F.year.any && !F.year.values.has(y)) return false
  if (!F.mon.values.has(mo) && !F.mon.any) return false
  const dm = domMatch(F.dom, y, mo, d)
  const dw = dowMatch(F.dow, y, mo, d)
  if (spec.dialect !== 'quartz' && !F.dom.star && !F.dow.star) return dm || dw // Vixie cron: both restricted means either may match
  return dm && dw
}

const sorted = (f, lo, hi) => (f.any ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [...f.values].sort((a, b) => a - b))

/** Next `count` run times after `from` (epoch ms) as epoch ms values, evaluated in time zone `tz`. */
export function nextRuns(spec, { from = Date.now(), tz = 'UTC', count = 10, maxDays = 366 * 45 } = {}) {
  const F = spec.fields
  const secs = F.sec ? sorted(F.sec, 0, 59) : [0]
  const mins = sorted(F.min, 0, 59)
  const hours = sorted(F.hour, 0, 23)
  const out = []
  const startMs = Math.floor(from / 1000) * 1000 + 1000
  const s = partsIn(startMs, tz)
  const startKey = [s.y, s.mo, s.d, s.h, s.mi, s.s].reduce((a, v) => a * 100 + v, 0)
  let day = Date.UTC(s.y, s.mo - 1, s.d)
  for (let n = 0; n < maxDays && out.length < count; n++, day += 86400000) {
    const dt = new Date(day)
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate()
    if (!dayMatches(spec, y, mo, d)) continue
    for (const h of hours) for (const mi of mins) for (const se of secs) {
      if (n === 0 && [y, mo, d, h, mi, se].reduce((a, v) => a * 100 + v, 0) < startKey) continue
      const t = zonedToEpoch({ y, mo, d, h, mi, s: se }, tz)
      const back = partsIn(t, tz)
      if (back.h !== h || back.mi !== mi || back.d !== d) continue // inside a daylight-saving gap
      if (t < startMs) continue
      out.push(t)
      if (out.length >= count) return out
    }
  }
  return out
}

/** Plain list of what each field matches, for the breakdown table. */
export function expandField(f) {
  if (f.any) return f.text === '?' ? 'no specific value' : 'every value'
  const parts = []
  const nm = (v) => (f.key === 'mon' ? MONTHS[v - 1] : f.key === 'dow' ? DOWS[v] : String(v))
  if (f.values.size) parts.push([...f.values].sort((a, b) => a - b).map(nm).join(', '))
  if (f.last) parts.push('last day of the month')
  if (f.lastOffset != null) parts.push(`${f.lastOffset} day${f.lastOffset === 1 ? '' : 's'} before the month end`)
  for (const n of f.nearest) parts.push(n === 'L' ? 'last weekday of the month' : `weekday nearest the ${n}th`)
  for (const n of f.lastDow) parts.push(`last ${DOWS[n]} of the month`)
  for (const { dow, k } of f.nth) parts.push(`${['1st', '2nd', '3rd', '4th', '5th'][k - 1]} ${DOWS[dow]} of the month`)
  return parts.join('; ')
}

/** Per-field validation for the UI: returns {ok, error?, field?, spec?} */
export function validateCron(expr, dialect = 'auto') {
  try { return { ok: true, spec: parseCron(expr, dialect) } } catch (e) {
    if (e instanceof CronError) return { ok: false, error: e.message, field: e.field }
    throw e
  }
}
