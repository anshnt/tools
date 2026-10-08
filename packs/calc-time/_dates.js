// Pure calendar maths shared by the date tools (no DOM, no time zones, no DST surprises).
// A date is a "day number": whole days since 1970-01-01 (a plain integer). Weekdays are 0 = Monday ... 6 = Sunday.

export const DAY_MS = 86_400_000
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
export const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]

/** Day number of a civil date. Works for any year (Date.UTC would remap years 0-99). */
export function toDayNum(y, m, d) {
  const t = new Date(0)
  t.setUTCFullYear(y, m - 1, d)
  return Math.round(t.getTime() / DAY_MS)
}
/** {y, m, d} of a day number. */
export function ymd(n) {
  const t = new Date(n * DAY_MS)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
export function today() {
  const t = new Date()
  return toDayNum(t.getFullYear(), t.getMonth() + 1, t.getDate())
}

const pad = (n, w = 2) => String(n).padStart(w, '0')
/** Day number -> 'YYYY-MM-DD' (the value format of <input type="date">). */
export function isoDate(n) {
  const { y, m, d } = ymd(n)
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}
/** 'YYYY-MM-DD' -> day number, or NaN when empty or not a real date (like 2026-02-30). */
export function parseISO(s) {
  const m = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(String(s || '').trim())
  if (!m) return NaN
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return NaN
  return toDayNum(y, mo, d)
}

/** Monday = 0 ... Sunday = 6. 1970-01-01 (day 0) was a Thursday. */
export const weekday = (n) => (((n + 3) % 7) + 7) % 7
export const dayOfYear = (n) => n - toDayNum(ymd(n).y, 1, 1) + 1
export const daysInYear = (y) => (isLeap(y) ? 366 : 365)

/** Add whole months, clamping to the last day of a shorter month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(n, k) {
  const { y, m, d } = ymd(n)
  const idx = y * 12 + (m - 1) + k
  const ny = Math.floor(idx / 12)
  const nm = (((idx % 12) + 12) % 12) + 1
  return toDayNum(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}
export const addYears = (n, k) => addMonths(n, k * 12)

/**
 * Exact calendar difference between two days (a <= b): whole months first (with month-end clamping), then the leftover days.
 * Same convention as Python dateutil: 31 Jan to 28 Feb (non-leap) is 1 month 0 days, 31 Jan to 1 Mar is 1 month 1 day.
 */
export function diffYMD(a, b) {
  if (a > b) [a, b] = [b, a]
  const A = ymd(a), B = ymd(b)
  let months = (B.y - A.y) * 12 + (B.m - A.m)
  if (addMonths(a, months) > b) months--
  return { years: Math.floor(months / 12), months: months % 12, days: b - addMonths(a, months), totalMonths: months }
}

/** ISO 8601 week: the week containing Thursday decides the year. Returns {year, week}. */
export function isoWeek(n) {
  const thu = n - weekday(n) + 3
  const year = ymd(thu).y
  return { year, week: Math.floor((thu - toDayNum(year, 1, 1)) / 7) + 1 }
}
/** Monday (day number) of ISO week `week` in ISO year `year`. Week 1 always contains 4 January. */
export function isoWeekStart(year, week) {
  const jan4 = toDayNum(year, 1, 4)
  return jan4 - weekday(jan4) + (week - 1) * 7
}
/** 52 or 53. 28 December is always in the last ISO week of its year. */
export const weeksInIsoYear = (year) => isoWeek(toDayNum(year, 12, 28)).week

/** US-style week number: weeks start on Sunday and week 1 is the one containing 1 January. */
export function usWeek(n) {
  const jan1 = toDayNum(ymd(n).y, 1, 1)
  const sunBefore = jan1 - ((weekday(jan1) + 1) % 7)
  return Math.floor((n - sunBefore) / 7) + 1
}

export const quarter = (n) => Math.ceil(ymd(n).m / 3)

// ---------- Working days ----------
/** Default weekend: Saturday and Sunday. */
export const SAT_SUN = new Set([5, 6])

/**
 * Working days in [a, b] (both ends included): every day that is not a weekend day and not a holiday.
 * Holidays are a Set of day numbers; one that falls on a weekend is not counted twice.
 */
export function countWorking(a, b, weekend = SAT_SUN, holidays = new Set()) {
  if (b < a) return 0
  const span = b - a + 1
  const perWeek = 7 - weekend.size
  const full = Math.floor(span / 7)
  let n = full * perWeek
  for (let d = a + full * 7; d <= b; d++) if (!weekend.has(weekday(d))) n++
  for (const h of holidays) if (h >= a && h <= b && !weekend.has(weekday(h))) n--
  return n
}
/** Holidays that actually cost a working day inside [a, b], sorted. */
export function holidaysIn(a, b, weekend, holidays) {
  return [...holidays].filter((h) => h >= a && h <= b && !weekend.has(weekday(h))).sort((x, y) => x - y)
}

/** Move n working days from `start` (negative goes back). Zero returns the start day itself. */
export function addWorking(start, n, weekend = SAT_SUN, holidays = new Set()) {
  if (weekend.size >= 7) return NaN
  const step = n < 0 ? -1 : 1
  let d = start, left = Math.abs(Math.trunc(n))
  let guard = 0
  while (left > 0) {
    d += step
    if (!weekend.has(weekday(d)) && !holidays.has(d)) left--
    if (++guard > 400_000) return NaN
  }
  return d
}

// ---------- Formatting ----------
const dateFmt = new Map()
/** Format a day number with Intl in UTC so the weekday never shifts. fmtDate(n, {weekday:'short', day:'numeric', month:'short', year:'numeric'}). */
export function fmtDate(n, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }, locale) {
  const key = JSON.stringify(opts) + (locale || '')
  if (!dateFmt.has(key)) dateFmt.set(key, new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }))
  return dateFmt.get(key).format(new Date(n * DAY_MS))
}
export const longDate = (n) => fmtDate(n, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${Math.abs(n) === 1 ? one : many}`

/** "1 year, 2 months, 3 days" (skips zero parts but keeps at least days). */
export function ymdText({ years, months, days }) {
  const parts = []
  if (years) parts.push(plural(years, 'year'))
  if (months) parts.push(plural(months, 'month'))
  if (days || !parts.length) parts.push(plural(days, 'day'))
  return parts.join(', ')
}
