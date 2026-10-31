// iCalendar (.ics) reader and writer, plus event <-> table layouts (full, Google Calendar import).
// DOM-free. An item is a plain object:
//   { type: 'VEVENT' | 'VTODO', uid, summary, description, location, status, class, transparency, priority, url, categories[], organizer, attendees: [{ name, email, role, status }],
//     rrule, rdate[], exdate[], start, end, due, completed, duration, percent, created, modified, sequence, geo, alarms: [{ action, trigger }] }
// where start, end, due and completed are { date: 'YYYY-MM-DD', time: 'HH:MM:SS' | '', tzid, utc, allDay }. A recurrence rule is kept as text.
const CRLF = '\r\n'
const enc = new TextEncoder()
const pad = (n, w = 2) => String(n).padStart(w, '0')
const unescapeText = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c))
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')

function fold(line) {
  if (enc.encode(line).length <= 75) return line
  const out = []
  let cur = '', len = 0, limit = 75
  for (const ch of line) {
    const l = enc.encode(ch).length
    if (len + l > limit) { out.push(cur); cur = ''; len = 0; limit = 74 }
    cur += ch
    len += l
  }
  out.push(cur)
  return out.join(CRLF + ' ')
}

// ---------- Time helpers ----------
/** Offset (minutes) of a time zone at an instant. Throws RangeError for an unknown zone. */
function tzOffsetMin(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms))
  const g = (t) => Number(parts.find((p) => p.type === t).value)
  return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - Math.floor(ms / 1000) * 1000) / 60000
}
/** Wall-clock time in a zone -> UTC milliseconds. */
export function wallToUtcMs(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number)
  const [H = 0, M = 0, S = 0] = (time || '00:00:00').split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, H, M, S)
  const first = guess - tzOffsetMin(guess, tz) * 60000
  return guess - tzOffsetMin(first, tz) * 60000
}
/** UTC milliseconds -> { date, time } wall clock in a zone. */
export function utcMsToWall(ms, tz) {
  const o = tz ? tzOffsetMin(ms, tz) : 0
  const d = new Date(ms + o * 60000)
  return { date: `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` }
}
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }
export const isoOf = (d) => (!d ? '' : d.allDay ? d.date : `${d.date}T${d.time}${d.utc ? 'Z' : ''}`)
function addDuration(dt, dur) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(dur || '')
  if (!m || !dt) return null
  const sign = m[1] === '-' ? -1 : 1
  const secs = sign * ((Number(m[2] || 0) * 7 + Number(m[3] || 0)) * 86400 + Number(m[4] || 0) * 3600 + Number(m[5] || 0) * 60 + Number(m[6] || 0))
  if (dt.allDay) return { ...dt, date: addDays(dt.date, Math.round(secs / 86400)) }
  const base = Date.parse(`${dt.date}T${dt.time}Z`) + secs * 1000
  const w = new Date(base).toISOString()
  return { ...dt, date: w.slice(0, 10), time: w.slice(11, 19) }
}

// ---------- Parsing ----------
function parseDt(value, params) {
  const v = String(value || '').trim()
  const m = /^(\d{4})-?(\d{2})-?(\d{2})(?:T(\d{2}):?(\d{2}):?(\d{2})?(Z)?)?$/i.exec(v)
  if (!m) return null
  const allDay = params?.VALUE?.[0]?.toUpperCase() === 'DATE' || m[4] === undefined
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (allDay) return { date, time: '', tzid: '', utc: false, allDay: true }
  return { date, time: `${m[4]}:${m[5]}:${m[6] || '00'}`, tzid: m[7] ? '' : params?.TZID?.[0] || '', utc: !!m[7], allDay: false }
}
/** Parse .ics text. Returns { items, calendar: { name, timezone, prodid, version } }. */
export function parseIcs(text) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n').split('\n')
  const lines = []
  for (const l of src) {
    if (lines.length && /^[ \t]/.test(l)) lines[lines.length - 1] += l.slice(1)
    else lines.push(l)
  }
  const calendar = { name: '', timezone: '', prodid: '', version: '' }
  const items = []
  const stack = []
  let cur = null, alarm = null
  for (const line of lines) {
    if (!line.trim()) continue
    let q = false, colon = -1
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) { colon = i; break } }
    if (colon < 0) continue
    const head = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const segs = []
    q = false
    let seg = ''
    for (const c of head) { if (c === '"') { q = !q; seg += c } else if (c === ';' && !q) { segs.push(seg); seg = '' } else seg += c }
    segs.push(seg)
    const name = segs.shift().trim().toUpperCase()
    const params = {}
    for (const s of segs) { const eq = s.indexOf('='); if (eq > 0) (params[s.slice(0, eq).trim().toUpperCase()] ||= []).push(...s.slice(eq + 1).split(',').map((x) => x.replace(/^"|"$/g, ''))) }
    if (name === 'BEGIN') {
      const t = value.trim().toUpperCase()
      stack.push(t)
      if (t === 'VEVENT' || t === 'VTODO') cur = { type: t, uid: '', summary: '', description: '', location: '', status: '', class: '', transparency: '', priority: '', url: '', categories: [], organizer: '', attendees: [], rrule: '', rdate: [], exdate: [], start: null, end: null, due: null, completed: null, duration: '', percent: '', created: '', modified: '', sequence: '', geo: '', alarms: [] }
      else if (t === 'VALARM' && cur) alarm = { action: '', trigger: '' }
      continue
    }
    if (name === 'END') {
      const t = stack.pop()
      if ((t === 'VEVENT' || t === 'VTODO') && cur) {
        if (!cur.end && cur.duration && cur.start) cur.end = addDuration(cur.start, cur.duration)
        items.push(cur)
        cur = null
      } else if (t === 'VALARM' && cur && alarm) { cur.alarms.push(alarm); alarm = null }
      continue
    }
    const top = stack[stack.length - 1]
    if (top === 'VCALENDAR') {
      if (name === 'X-WR-CALNAME') calendar.name = unescapeText(value)
      else if (name === 'X-WR-TIMEZONE') calendar.timezone = value.trim()
      else if (name === 'PRODID') calendar.prodid = value.trim()
      else if (name === 'VERSION') calendar.version = value.trim()
      continue
    }
    if (top === 'VALARM' && alarm) { if (name === 'ACTION') alarm.action = value.trim(); else if (name === 'TRIGGER') alarm.trigger = value.trim(); continue }
    if (!cur || (top !== 'VEVENT' && top !== 'VTODO')) continue
    switch (name) {
      case 'UID': cur.uid = value.trim(); break
      case 'SUMMARY': cur.summary = unescapeText(value); break
      case 'DESCRIPTION': cur.description = unescapeText(value); break
      case 'LOCATION': cur.location = unescapeText(value); break
      case 'STATUS': cur.status = value.trim(); break
      case 'CLASS': cur.class = value.trim(); break
      case 'TRANSP': cur.transparency = value.trim(); break
      case 'PRIORITY': cur.priority = value.trim(); break
      case 'URL': cur.url = value.trim(); break
      case 'CATEGORIES': cur.categories.push(...value.split(/(?<!\\),/).map((x) => unescapeText(x).trim()).filter(Boolean)); break
      case 'ORGANIZER': cur.organizer = (params.CN?.[0] ? `${params.CN[0]} <${value.replace(/^mailto:/i, '').trim()}>` : value.replace(/^mailto:/i, '').trim()); break
      case 'ATTENDEE': cur.attendees.push({ name: params.CN?.[0] || '', email: value.replace(/^mailto:/i, '').trim(), role: params.ROLE?.[0] || '', status: params.PARTSTAT?.[0] || '' }); break
      case 'RRULE': cur.rrule = value.trim(); break
      case 'RDATE': cur.rdate.push(value.trim()); break
      case 'EXDATE': cur.exdate.push(value.trim()); break
      case 'DTSTART': cur.start = parseDt(value, params); break
      case 'DTEND': cur.end = parseDt(value, params); break
      case 'DUE': cur.due = parseDt(value, params); break
      case 'COMPLETED': cur.completed = parseDt(value, params); break
      case 'DURATION': cur.duration = value.trim(); break
      case 'PERCENT-COMPLETE': cur.percent = value.trim(); break
      case 'CREATED': cur.created = isoOf(parseDt(value, params)); break
      case 'LAST-MODIFIED': cur.modified = isoOf(parseDt(value, params)); break
      case 'SEQUENCE': cur.sequence = value.trim(); break
      case 'GEO': cur.geo = value.trim(); break
      default:
    }
  }
  return { items, calendar }
}

// ---------- Tables ----------
export const CALENDAR_PRESETS = [['full', 'Full detail (all fields)'], ['google', 'Google Calendar import']]
const FULL_HEADERS = ['Type', 'Summary', 'Start', 'End', 'All day', 'Time zone', 'Location', 'Description', 'Recurrence (RRULE)', 'Status', 'Class', 'Transparency', 'Organizer', 'Attendees', 'Categories', 'URL', 'Priority', 'Percent complete', 'Due', 'Completed', 'UID', 'Created', 'Modified']
const GOOGLE_HEADERS = ['Subject', 'Start Date', 'Start Time', 'End Date', 'End Time', 'All Day Event', 'Description', 'Location', 'Private']
const attText = (a) => (a.name ? `${a.name} <${a.email}>` : a.email)

/** Shift a start/end struct to another zone for display. Unknown zones are reported through warn. */
function shown(dt, mode, warn) {
  if (!dt || dt.allDay || !dt.utc || !mode || mode === 'keep') return dt
  const tz = mode === 'local' ? localTz() : mode
  try { const w = utcMsToWall(Date.parse(`${dt.date}T${dt.time}Z`), tz); return { ...dt, ...w, utc: false, tzid: tz } } catch { warn?.(`"${mode}" is not a time zone name, so UTC times were left as they are.`); return dt }
}
const fmtDate = (date, how) => { const [y, m, d] = date.split('-'); return how === 'iso' ? date : how === 'dmy' ? `${d}/${m}/${y}` : `${m}/${d}/${y}` }
const fmtTime = (time, how) => {
  const [H, M] = time.split(':').map(Number)
  return how === '24h' ? `${pad(H)}:${pad(M)}` : `${H % 12 || 12}:${pad(M)} ${H < 12 ? 'AM' : 'PM'}`
}

/** items -> { headers, rows } for a layout. opts: { dateFormat: 'mdy'|'dmy'|'iso', timeFormat: '12h'|'24h', tzMode: 'keep'|'local'|<IANA> }. */
export function itemsToTable(items, preset = 'full', opts = {}, warn = () => {}) {
  const o = { dateFormat: 'mdy', timeFormat: '12h', tzMode: 'keep', ...opts }
  if (preset === 'google') {
    const ev = items.filter((i) => i.type === 'VEVENT' && i.start)
    const skipped = items.length - ev.length
    if (skipped) warn(`${skipped} to-do${skipped === 1 ? '' : 's'} or undated item${skipped === 1 ? ' was' : 's were'} left out, because the Google Calendar import only takes events with a start date.`)
    if (ev.some((i) => i.rrule)) warn('Repeating events become a single event: the Google Calendar import has no repeat column. Use the full layout to keep RRULE.')
    if (ev.some((i) => i.start.utc) && (!o.tzMode || o.tzMode === 'keep')) warn('Some times are in UTC. Choose a time zone to convert them, because the import reads times in your calendar time zone.')
    const rows = ev.map((i) => {
      const s = shown(i.start, o.tzMode, warn), e = shown(i.end, o.tzMode, warn)
      const allDay = s.allDay
      const endDate = e ? (allDay ? addDays(e.date, -1) : e.date) : s.date
      return [i.summary, fmtDate(s.date, o.dateFormat), allDay ? '' : fmtTime(s.time, o.timeFormat), fmtDate(allDay && endDate < s.date ? s.date : endDate, o.dateFormat),
        allDay ? '' : e ? fmtTime(e.time, o.timeFormat) : fmtTime(s.time, o.timeFormat), allDay ? 'True' : 'False', i.description, i.location, /^(private|confidential)$/i.test(i.class) ? 'True' : 'False']
    })
    return { headers: GOOGLE_HEADERS, rows }
  }
  const rows = items.map((i) => {
    const s = shown(i.start, o.tzMode, warn), e = shown(i.end, o.tzMode, warn)
    const allDay = !!s?.allDay
    const endIso = e ? isoOf(allDay ? { ...e, date: addDays(e.date, -1) } : e) : ''
    return [i.type, i.summary, isoOf(s), allDay && endIso < isoOf(s) ? isoOf(s) : endIso, allDay ? 'True' : 'False', s?.tzid || i.due?.tzid || '', i.location, i.description, i.rrule, i.status, i.class, i.transparency, i.organizer, i.attendees.map(attText).join('; '), i.categories.join(', '), i.url, i.priority, i.percent, isoOf(shown(i.due, o.tzMode, warn)), isoOf(i.completed), i.uid, i.created, i.modified]
  })
  return { headers: FULL_HEADERS, rows }
}

export function itemsToJson(items) {
  return items.map((i) => {
    const o = { type: i.type, uid: i.uid, summary: i.summary, description: i.description, location: i.location, start: isoOf(i.start), end: isoOf(i.end), allDay: !!i.start?.allDay, timeZone: i.start?.tzid || '', due: isoOf(i.due), completed: isoOf(i.completed),
      status: i.status, class: i.class, transparency: i.transparency, priority: i.priority, percentComplete: i.percent, rrule: i.rrule, rdate: i.rdate, exdate: i.exdate, categories: i.categories, organizer: i.organizer, attendees: i.attendees, url: i.url, created: i.created, modified: i.modified, sequence: i.sequence, geo: i.geo, alarms: i.alarms }
    for (const k of Object.keys(o)) if (o[k] === '' || (Array.isArray(o[k]) && !o[k].length) || o[k] === false && k === 'allDay') delete o[k]
    return o
  })
}

/** "03/05/2024", "5.3.2024", "2024-03-05", "Mar 5, 2024" -> "2024-03-05". order: 'mdy' | 'dmy'. */
export function parseDateCell(s, order = 'mdy') {
  const t = String(s || '').trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(t)
  if (m) {
    let [, a, b, y] = m
    if (y.length === 2) y = (Number(y) > 69 ? '19' : '20') + y
    const [mo, d] = order === 'dmy' ? [b, a] : [a, b]
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null
    return `${y}-${pad(mo)}-${pad(d)}`
  }
  if (/[a-z]{3}/i.test(t)) { const d = new Date(`${t} 12:00:00 UTC`); if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10) }
  return null
}
/** "10:00 AM", "22:30", "10am", "10:00:30" -> "HH:MM:SS". */
export function parseTimeCell(s) {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?:[:.](\d{2}))?(?:\.\d+)?\s*([ap])?\.?m?\.?$/i.exec(String(s || '').trim())
  if (!m) return null
  let H = Number(m[1])
  const M = Number(m[2] || 0), S = Number(m[3] || 0)
  if (m[4]) { if (H < 1 || H > 12) return null; H = (H % 12) + (m[4].toLowerCase() === 'p' ? 12 : 0) }
  if (H > 23 || M > 59 || S > 59) return null
  return `${pad(H)}:${pad(M)}:${pad(S)}`
}
/** Guess month-first or day-first from the date cells (defaults to month first). */
export function detectDateOrder(values) {
  let dmy = false, mdy = false
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/.exec(String(v || '').trim())
    if (!m) continue
    if (Number(m[1]) > 12) dmy = true
    if (Number(m[2]) > 12) mdy = true
  }
  return dmy && !mdy ? 'dmy' : 'mdy'
}
/** One cell holding a date, optionally with a time, "Z" or an offset -> struct or null. */
function parseDateTimeCell(s, order, defaultTz) {
  const t = String(s || '').trim()
  if (!t) return null
  const m = /^(.*?)(?:[T\s]+(\d{1,2}(?:[:.]\d{2}){0,2}(?:\.\d+)?\s*(?:[ap]\.?m\.?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(t)
  if (!m) return null
  const date = parseDateCell(m[1], order)
  if (!date) return null
  if (!m[2]) return { date, time: '', tzid: '', utc: false, allDay: true }
  const time = parseTimeCell(m[2])
  if (!time) return null
  if (m[3]) {
    if (/^z$/i.test(m[3])) return { date, time, tzid: '', utc: true, allDay: false }
    const sign = m[3][0] === '-' ? -1 : 1
    const off = sign * (Number(m[3].slice(1, 3)) * 60 + Number(m[3].slice(-2)))
    const w = utcMsToWall(Date.parse(`${date}T${time}Z`) - off * 60000, '')
    return { ...w, tzid: '', utc: true, allDay: false }
  }
  return { date, time, tzid: defaultTz || '', utc: false, allDay: false }
}
const truthy = (v) => /^(true|yes|y|1|x)$/i.test(String(v ?? '').trim())

/**
 * Table rows -> items. Understands the full layout, the Google Calendar layout and common header names.
 * opts: { dateOrder: 'auto'|'mdy'|'dmy', timeZone: default zone name for times without one }.
 */
export function tableToItems(headers, rows, opts = {}, warn = () => {}) {
  const hs = headers.map((x) => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
  const col = (...names) => { for (const n of names) { const i = hs.indexOf(n); if (i >= 0) return i } return -1 }
  const c = {
    type: col('type', 'component'), summary: col('summary', 'subject', 'title', 'event', 'name', 'event name'),
    start: col('start', 'start datetime', 'start date time', 'dtstart', 'begin'), startDate: col('start date', 'date', 'start day'), startTime: col('start time', 'time'),
    end: col('end', 'end datetime', 'end date time', 'dtend'), endDate: col('end date', 'end day'), endTime: col('end time'),
    allDay: col('all day', 'all day event', 'all-day', 'allday', 'all day event?'), tz: col('time zone', 'timezone', 'tz', 'tzid'),
    location: col('location', 'where', 'venue'), description: col('description', 'details', 'notes', 'note', 'body'),
    rrule: col('recurrence (rrule)', 'rrule', 'recurrence', 'repeat'), status: col('status'), class: col('class', 'visibility'), transp: col('transparency', 'show as'), organizer: col('organizer'), attendees: col('attendees', 'attendee', 'guests', 'required attendees'),
    categories: col('categories', 'category', 'tags'), url: col('url', 'link'), priority: col('priority'), percent: col('percent complete', 'percent', 'progress'),
    due: col('due', 'due date', 'deadline'), completed: col('completed'), uid: col('uid', 'id'), private: col('private', 'sensitivity'),
  }
  if (c.summary < 0) throw Object.assign(new Error('Could not find a title column. Add a header named Summary, Subject or Title.'), { userMessage: 'Could not find a title column. Add a header named Summary, Subject or Title.' })
  if (c.start < 0 && c.startDate < 0) throw Object.assign(new Error('Could not find a start column. Add a header named Start or Start Date.'), { userMessage: 'Could not find a start column. Add a header named Start or Start Date.' })
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '')
  const order = opts.dateOrder && opts.dateOrder !== 'auto' ? opts.dateOrder : detectDateOrder(rows.flatMap((r) => [cell(r, c.start), cell(r, c.startDate), cell(r, c.end), cell(r, c.endDate)]))
  const items = []
  let bad = 0
  rows.forEach((r, n) => {
    if (r.every((x) => String(x ?? '').trim() === '')) return
    const tz = cell(r, c.tz) || opts.timeZone || ''
    const t = cell(r, c.type).toUpperCase()
    const isTodo = /TODO|TASK/.test(t)
    let start, end
    if (c.start >= 0 && cell(r, c.start)) { start = parseDateTimeCell(cell(r, c.start), order, tz); end = c.end >= 0 ? parseDateTimeCell(cell(r, c.end), order, tz) : null } else {
      const d = parseDateCell(cell(r, c.startDate), order)
      const tm = parseTimeCell(cell(r, c.startTime))
      start = d ? (tm ? { date: d, time: tm, tzid: tz, utc: false, allDay: false } : { date: d, time: '', tzid: '', utc: false, allDay: true }) : null
      const ed = parseDateCell(cell(r, c.endDate), order) || d
      const et = parseTimeCell(cell(r, c.endTime))
      end = ed ? (et && tm ? { date: ed, time: et, tzid: tz, utc: false, allDay: false } : { date: ed, time: '', tzid: '', utc: false, allDay: true }) : null
    }
    const dueDt = c.due >= 0 ? parseDateTimeCell(cell(r, c.due), order, tz) : null
    if (!start && !(isTodo && dueDt)) { bad++; return }
    const flagged = c.allDay >= 0 && cell(r, c.allDay) !== ''
    if (start && flagged) {
      if (truthy(cell(r, c.allDay)) && !start.allDay) { start = { date: start.date, time: '', tzid: '', utc: false, allDay: true }; if (end) end = { date: end.date, time: '', tzid: '', utc: false, allDay: true } } else if (!truthy(cell(r, c.allDay)) && start.allDay && !isTodo) { /* date only but marked timed: keep as all day */ }
    }
    if (start?.allDay) {
      // CSV end dates are the last day (inclusive); iCalendar wants the day after
      end = end ? { ...end, allDay: true, time: '', date: addDays(end.date < start.date ? start.date : end.date, 1) } : null
    }
    items.push({
      type: isTodo ? 'VTODO' : 'VEVENT', uid: cell(r, c.uid), summary: cell(r, c.summary), description: cell(r, c.description), location: cell(r, c.location),
      status: cell(r, c.status).toUpperCase(), class: cell(r, c.class).toUpperCase() || (c.private >= 0 && truthy(cell(r, c.private)) ? 'PRIVATE' : ''), transparency: cell(r, c.transp).toUpperCase(), priority: cell(r, c.priority), url: cell(r, c.url),
      categories: cell(r, c.categories).split(/\s*[,;]\s*/).filter(Boolean), organizer: cell(r, c.organizer),
      attendees: cell(r, c.attendees).split(/\s*;\s*|\s*,\s*(?=[^<>]*(?:<|$))/).filter(Boolean).map((a) => { const m = /^(.*?)\s*<([^>]+)>$/.exec(a); return m ? { name: m[1].replace(/^"|"$/g, ''), email: m[2], role: '', status: '' } : { name: '', email: a, role: '', status: '' } }),
      rrule: cell(r, c.rrule).replace(/^RRULE:/i, ''), rdate: [], exdate: [], start, end, due: dueDt, completed: c.completed >= 0 ? parseDateTimeCell(cell(r, c.completed), order, '') : null,
      duration: '', percent: cell(r, c.percent), created: '', modified: '', sequence: '', geo: '', alarms: [], row: n + 2,
    })
  })
  if (bad) warn(`${bad} row${bad === 1 ? '' : 's'} had no readable start date and ${bad === 1 ? 'was' : 'were'} skipped.`)
  return items
}

// ---------- Writing ----------
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16).padStart(8, '0') }
const dtLine = (name, d, tzOut, warn) => {
  if (!d) return null
  if (d.allDay) return `${name};VALUE=DATE:${d.date.replace(/-/g, '')}`
  const base = `${d.date.replace(/-/g, '')}T${d.time.replace(/:/g, '')}`
  if (d.utc) return `${name}:${base}Z`
  if (d.tzid) {
    if (tzOut === 'utc') { try { return `${name}:${stamp(wallToUtcMs(d.date, d.time, d.tzid))}` } catch { warn?.(`"${d.tzid}" is not a time zone name, so its times were written as local (floating) times.`); return `${name}:${base}` } }
    return `${name};TZID=${d.tzid}:${base}`
  }
  return `${name}:${base}`
}
/** items -> .ics text. opts: { calName, tzOut: 'tzid' | 'utc', prodid }. */
export function writeIcs(items, { calName = '', tzOut = 'tzid', prodid = '-//Toolverse//Data Formats//EN' } = {}, warn = () => {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodid}`, 'CALSCALE:GREGORIAN']
  if (calName) L.push(fold(`X-WR-CALNAME:${esc(calName)}`))
  const now = stamp(Date.now())
  const put = (s) => { if (s) L.push(fold(s)) }
  items.forEach((i, n) => {
    L.push(`BEGIN:${i.type}`)
    put(`UID:${i.uid || `${hash(`${i.summary}|${isoOf(i.start)}|${n}`)}-${n + 1}@data-formats`}`)
    put(`DTSTAMP:${now}`)
    put(dtLine('DTSTART', i.start, tzOut, warn))
    put(dtLine('DTEND', i.end, tzOut, warn))
    if (i.type === 'VTODO') { put(dtLine('DUE', i.due, tzOut, warn)); put(dtLine('COMPLETED', i.completed && { ...i.completed, utc: true }, tzOut, warn)) }
    put(`SUMMARY:${esc(i.summary)}`)
    if (i.description) put(`DESCRIPTION:${esc(i.description)}`)
    if (i.location) put(`LOCATION:${esc(i.location)}`)
    if (i.rrule) put(`RRULE:${i.rrule}`)
    for (const r of i.rdate || []) put(`RDATE:${r}`)
    for (const r of i.exdate || []) put(`EXDATE:${r}`)
    if (i.status) put(`STATUS:${i.status}`)
    if (i.class) put(`CLASS:${i.class}`)
    if (i.transparency) put(`TRANSP:${i.transparency}`)
    if (i.priority) put(`PRIORITY:${i.priority}`)
    if (i.percent && i.type === 'VTODO') put(`PERCENT-COMPLETE:${i.percent}`)
    if (i.url) put(`URL:${i.url}`)
    if (i.categories?.length) put(`CATEGORIES:${i.categories.map(esc).join(',')}`)
    if (i.organizer) { const m = /^(.*?)\s*<([^>]+)>$/.exec(i.organizer); put(m ? `ORGANIZER;CN=${/[;:,]/.test(m[1]) ? `"${m[1]}"` : m[1]}:mailto:${m[2]}` : `ORGANIZER:${/@/.test(i.organizer) ? 'mailto:' : ''}${i.organizer}`) }
    for (const a of i.attendees || []) put(`ATTENDEE${a.name ? `;CN=${/[;:,]/.test(a.name) ? `"${a.name}"` : a.name}` : ''}${a.role ? `;ROLE=${a.role}` : ''}${a.status ? `;PARTSTAT=${a.status}` : ''}:mailto:${a.email}`)
    for (const al of i.alarms || []) if (al.trigger) { L.push('BEGIN:VALARM', `ACTION:${al.action || 'DISPLAY'}`, `TRIGGER:${al.trigger}`, 'DESCRIPTION:Reminder', 'END:VALARM') }
    L.push(`END:${i.type}`)
  })
  L.push('END:VCALENDAR')
  return L.join(CRLF) + CRLF
}

export const ICS_SAMPLE = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example//Sample//EN', 'X-WR-CALNAME:Team calendar',
  'BEGIN:VEVENT', 'UID:standup-1@example.com', 'DTSTAMP:20240301T090000Z', 'DTSTART;TZID=America/New_York:20240304T093000', 'DTEND;TZID=America/New_York:20240304T094500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'SUMMARY:Daily stand-up', 'LOCATION:Room 4\\, Floor 2', 'DESCRIPTION:Quick sync.\\nBring blockers.', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:offsite-2@example.com', 'DTSTAMP:20240301T090000Z', 'DTSTART;VALUE=DATE:20240315', 'DTEND;VALUE=DATE:20240317', 'SUMMARY:Team offsite', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:call-3@example.com', 'DTSTAMP:20240301T090000Z', 'DTSTART:20240320T140000Z', 'DTEND:20240320T150000Z', 'SUMMARY:Vendor call', 'END:VEVENT',
  'BEGIN:VTODO', 'UID:todo-4@example.com', 'DTSTAMP:20240301T090000Z', 'DUE;VALUE=DATE:20240322', 'SUMMARY:Send invoice', 'STATUS:NEEDS-ACTION', 'END:VTODO',
  'END:VCALENDAR', '',
].join('\r\n')
