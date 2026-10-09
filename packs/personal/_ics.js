// iCalendar (.ics) export and import for the personal pack. Pure functions, no DOM.
// Event shape: {id, title, date, endDate, allDay, start, end, repeat: none|daily|weekly|monthly|yearly, interval, until, remind, notes, place}
//   date/endDate/until are YYYY-MM-DD, start/end are HH:MM, remind is minutes before (or null).

const pad = (n) => String(n).padStart(2, '0')
const compact = (ymd) => ymd.replace(/-/g, '')
const addDay = (ymd, n) => { const [y, m, d] = ymd.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` }

export const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const unescapeIcs = (s) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

/** Fold a content line to 75 octets (RFC 5545). */
export function fold(line) {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const b = enc.encode(ch).length
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch; bytes += b
  }
  out.push(cur)
  return out.map((l, i) => (i ? ' ' + l : l)).join('\r\n')
}

const FREQ = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }

export function buildIcs(events, { name = 'Calendar' } = {}) {
  const now = new Date()
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tools//Calendar planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEscape(name)}`]
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.id}@tools-calendar`, `DTSTAMP:${stamp}`)
    if (e.allDay) {
      const last = e.repeat && e.repeat !== 'none' ? e.date : e.endDate || e.date
      L.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(addDay(last, 1))}`)
    } else {
      const s = e.start || '09:00'
      let en = e.end || ''
      if (!en || en <= s) en = s
      L.push(`DTSTART:${compact(e.date)}T${s.replace(':', '')}00`, `DTEND:${compact(e.date)}T${en.replace(':', '')}00`)
    }
    L.push(`SUMMARY:${icsEscape(e.title)}`)
    if (e.place) L.push(`LOCATION:${icsEscape(e.place)}`)
    if (e.notes) L.push(`DESCRIPTION:${icsEscape(e.notes)}`)
    if (e.repeat && e.repeat !== 'none' && FREQ[e.repeat]) {
      let r = `RRULE:FREQ=${FREQ[e.repeat]}`
      if (e.interval > 1) r += `;INTERVAL=${e.interval}`
      if (e.until) r += `;UNTIL=${compact(e.until)}`
      L.push(r)
    }
    if (e.remind != null && e.remind !== '') L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(e.title)}`, `TRIGGER:-PT${Math.max(0, Number(e.remind))}M`, 'END:VALARM')
    L.push('END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.map(fold).join('\r\n') + '\r\n'
}

/** "20261009" or "20261009T143000Z" or "20261009T143000" -> {date, time, allDay}. UTC values are converted to local time. */
export function parseIcsDate(value) {
  const v = value.trim()
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  if (m[4] == null) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '', allDay: true }
  if (m[7]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)))
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, allDay: false }
  }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}`, allDay: false }
}

const unfold = (text) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')

/** Parse .ics text -> {events, skipped, notes}. Recurrence support: FREQ, INTERVAL, UNTIL (BYDAY and others are ignored, noted). */
export function parseIcs(text, makeId = () => Math.random().toString(36).slice(2, 10)) {
  const lines = unfold(text)
  const events = []
  const notes = new Set()
  let skipped = 0
  let cur = null
  let alarm = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === 'BEGIN:VEVENT') { cur = { props: [], alarmMin: null }; continue }
    if (line === 'END:VEVENT') {
      if (cur) { const ev = toEvent(cur, makeId, notes); if (ev) events.push(ev); else skipped++ }
      cur = null; alarm = false; continue
    }
    if (!cur) continue
    if (line === 'BEGIN:VALARM') { alarm = true; continue }
    if (line === 'END:VALARM') { alarm = false; continue }
    const i = line.indexOf(':')
    if (i < 0) continue
    const head = line.slice(0, i)
    const [name, ...pr] = head.split(';')
    const value = line.slice(i + 1)
    if (alarm) {
      if (name.toUpperCase() === 'TRIGGER') {
        const t = value.match(/^(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i)
        if (t && cur.alarmMin == null) cur.alarmMin = t[1] === '-' ? (+(t[2] || 0)) * 1440 + (+(t[3] || 0)) * 60 + (+(t[4] || 0)) : 0
      }
      continue
    }
    cur.props.push([name.toUpperCase(), pr.join(';'), value])
  }
  return { events, skipped, notes: [...notes] }
}

function toEvent(cur, makeId, notes) {
  const get = (n) => cur.props.find((p) => p[0] === n)
  const ds = get('DTSTART')
  if (!ds) return null
  const s = parseIcsDate(ds[2])
  if (!s) return null
  const de = get('DTEND')
  const e = de ? parseIcsDate(de[2]) : null
  const dur = get('DURATION')
  const ev = { id: makeId(), title: unescapeIcs(get('SUMMARY')?.[2] || '(no title)'), date: s.date, endDate: '', allDay: s.allDay, start: s.time, end: '', color: '', repeat: 'none', interval: 1, until: '', remind: cur.alarmMin, notes: unescapeIcs(get('DESCRIPTION')?.[2] || ''), place: unescapeIcs(get('LOCATION')?.[2] || '') }
  if (s.allDay) {
    if (e) { const last = addDay(e.date, -1); ev.endDate = last > s.date ? last : '' }
  } else {
    if (e && e.date === s.date) ev.end = e.time
    else if (e && !e.allDay) { ev.end = '23:59'; notes.add('Some events that span several days were shortened to their first day.') }
    else if (dur) { const d = dur[2].match(/PT(?:(\d+)H)?(?:(\d+)M)?/i); if (d) { const mins = (+(d[1] || 0)) * 60 + +(d[2] || 0); const [hh, mm] = s.time.split(':').map(Number); const t = hh * 60 + mm + mins; if (t < 1440) ev.end = `${pad(Math.floor(t / 60))}:${pad(t % 60)}` } }
  }
  const rr = get('RRULE')
  if (rr) {
    const parts = Object.fromEntries(rr[2].split(';').map((x) => x.split('=')))
    const f = (parts.FREQ || '').toLowerCase()
    if (FREQ[f]) {
      ev.repeat = f
      ev.interval = Math.max(1, parseInt(parts.INTERVAL) || 1)
      if (parts.UNTIL) { const u = parseIcsDate(parts.UNTIL); if (u) ev.until = u.date }
      if (parts.COUNT || parts.BYDAY || parts.BYMONTHDAY || parts.BYSETPOS) notes.add('Some repeat rules (counts and "on these weekdays") were simplified to plain repeats.')
    } else notes.add('Repeat rules other than daily, weekly, monthly and yearly were imported as single events.')
  }
  return ev
}
