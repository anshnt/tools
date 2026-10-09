// Unix timestamp converter: seconds/ms/us/ns auto-detect, any time zone, date picker to epoch, live clock, batch mode.
import { h, icon, button, input, textarea, select, segmented, split, table, alert, clear, onCleanup, debounce, copyText } from '../../lib/ui.js'
import { useKit, css, copyRow, eyebrow, pill, outBox, pad } from './_kit.js'

// ---------- Pure helpers (BigInt nanoseconds are the exact instant) ----------
const FACTOR = { s: 1_000_000_000n, ms: 1_000_000n, us: 1_000n, ns: 1n }
export const UNIT_LABEL = { s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds' }
const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q }

/** Which unit does this integer look like? Seconds up to year 5138, then ms, us, ns. */
export function detectUnit(intPart) {
  const n = intPart < 0n ? -intPart : intPart
  return n < 100_000_000_000n ? 's' : n < 100_000_000_000_000n ? 'ms' : n < 100_000_000_000_000_000n ? 'us' : 'ns'
}

/** "1700000000.123" + unit (or 'auto') -> {ns: BigInt, unit} or null. Keeps full precision. */
export function parseNumeric(text, unit = 'auto') {
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text.trim().replace(/[_,\s]/g, ''))
  if (!m) return null
  const neg = m[1] === '-'
  const int = BigInt(m[2])
  const u = unit === 'auto' ? detectUnit(int) : unit
  const f = FACTOR[u]
  const digits = f.toString().length - 1
  const frac = BigInt((m[3] || '').padEnd(digits, '0').slice(0, digits) || '0')
  let ns = int * f + (digits ? frac : 0n)
  if (neg) ns = -ns
  return { ns, unit: u }
}

export const msOf = (ns) => Number(floorDiv(ns, 1_000_000n))

/** UTC offset (minutes) of a time zone at an instant. */
export function tzOffsetMin(ms, tz) {
  const dtf = tzFmt(tz)
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000)
}
const fmtCache = new Map()
function tzFmt(tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }))
  return fmtCache.get(tz)
}

/** Wall-clock time in a zone -> epoch ms (handles DST gaps and overlaps by taking the earlier valid instant). */
export function zonedToEpoch({ y, mo, d, h: hh = 0, mi = 0, s = 0, ms = 0 }, tz) {
  const guess = Date.UTC(y, mo - 1, d, hh, mi, s, ms)
  let t = guess - tzOffsetMin(guess, tz) * 60000
  t = guess - tzOffsetMin(t, tz) * 60000
  return t
}

export const offsetLabel = (min, colon = true) => `${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}${colon ? ':' : ''}${pad(Math.abs(min) % 60)}`

/** Wall-clock parts of an instant in a zone. */
export function partsIn(ms, tz) {
  const p = Object.fromEntries(tzFmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second }
}
export function isoIn(ms, tz) {
  const p = partsIn(ms, tz)
  const frac = String(((ms % 1000) + 1000) % 1000).padStart(3, '0')
  return `${String(p.y).padStart(4, '0')}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}.${frac}${tz === 'UTC' ? 'Z' : offsetLabel(tzOffsetMin(ms, tz))}`
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function rfc2822In(ms, tz) {
  const p = partsIn(ms, tz)
  const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()
  return `${DAYS[dow]}, ${pad(p.d)} ${MONTHS[p.mo - 1]} ${p.y} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)} ${tz === 'UTC' ? '+0000' : offsetLabel(tzOffsetMin(ms, tz), false)}`
}
export function relative(ms, now = Date.now()) {
  const diff = (ms - now) / 1000
  const a = Math.abs(diff)
  const units = [['year', 31557600], ['month', 2629800], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]
  if (a < 1) return 'right now'
  const [u, sec] = units.find(([, s]) => a >= s)
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round(diff / sec), u)
}
export function dayOfYear(p) { return Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(p.y, 0, 0)) / 86400000) }
export function isoWeek(p) {
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.d))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1)
  return { week: Math.ceil(((d - y0) / 86400000 + 1) / 7), year: d.getUTCFullYear() }
}

/** Parse anything people paste: numbers (any unit), ISO strings, RFC 2822, "now". Wall times without a zone use tz. */
export function parseInstant(text, { unit = 'auto', tz = 'UTC' } = {}) {
  const t = text.trim()
  if (!t) return null
  if (/^now$/i.test(t)) return { ns: BigInt(Date.now()) * 1_000_000n, unit: 'ms', kind: 'now' }
  const num = parseNumeric(t, unit)
  if (num) return { ...num, kind: 'number' }
  const w = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?$/.exec(t)
  if (w) {
    const ms = zonedToEpoch({ y: +w[1], mo: +w[2], d: +w[3], h: +(w[4] || 0), mi: +(w[5] || 0), s: +(w[6] || 0) }, tz)
    const fracNs = BigInt((w[7] || '').padEnd(9, '0') || '0')
    if (Number.isNaN(ms)) return null
    return { ns: BigInt(ms) * 1_000_000n + fracNs, unit: 'ms', kind: 'wall' }
  }
  const ms = Date.parse(t)
  if (Number.isNaN(ms)) return null
  return { ns: BigInt(ms) * 1_000_000n, unit: 'ms', kind: 'date' }
}

// Browsers still report some old IANA names (Asia/Calcutta); show the modern ones people search for.
const ZONE_ALIAS = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires', 'Atlantic/Faeroe': 'Atlantic/Faroe', 'Pacific/Truk': 'Pacific/Chuuk', 'Pacific/Ponape': 'Pacific/Pohnpei' }
export const canonicalZone = (tz) => ZONE_ALIAS[tz] || tz
/** Sorted list of IANA zones for a picker (always includes UTC and the common modern spellings). */
export function zoneList() {
  let list
  try { list = Intl.supportedValuesOf('timeZone') } catch { list = ['America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'] }
  const out = new Set(list.map(canonicalZone))
  for (const z of Object.values(ZONE_ALIAS)) { try { new Intl.DateTimeFormat('en', { timeZone: z }); out.add(z) } catch { /* not supported */ } }
  out.delete('UTC')
  return [...out].sort()
}
const ZONES = zoneList()
const BROWSER_TZ = canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
const WORLD = ['UTC', 'America/Los_Angeles', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney']

const STYLE = `
.t-ts .ts-now { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 12px 24px; align-items: center; }
.t-ts .ts-big { font-family: var(--mono); font-size: clamp(24px, 4.6vw, 40px); font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.15; overflow-wrap: anywhere; }
.t-ts .ts-lbl { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.t-ts .ts-grid { display: grid; gap: 8px; }
.t-ts .ts-two { display: grid; grid-template-columns: 1fr; gap: 8px; }
@media (min-width: 560px) { .t-ts .ts-two { grid-template-columns: 1fr 1fr; } }
`

export function mount(root) {
  useKit()
  css('t-ts-css', STYLE)
  let tz = BROWSER_TZ
  let paused = false

  // ----- live clock -----
  const nowS = h('div', { class: 'ts-big', 'aria-label': 'Current Unix time in seconds' })
  const nowMs = h('div', { class: 'ts-big', style: 'font-size:clamp(18px,3vw,26px);color:var(--text-2)', 'aria-label': 'Current Unix time in milliseconds' })
  const nowIso = h('div', { class: 'small muted', style: 'font-family:var(--mono)' })
  const tick = () => {
    if (paused) return
    const n = Date.now()
    nowS.textContent = String(Math.floor(n / 1000))
    nowMs.textContent = String(n)
    nowIso.textContent = isoIn(n, tz)
  }
  tick()
  const timer = setInterval(tick, 100)
  onCleanup(() => clearInterval(timer))
  const pauseBtn = button('Pause', { icon: 'pause', size: 'sm', variant: 'ghost', onClick: () => { paused = !paused; pauseBtn.replaceChildren(icon(paused ? 'play' : 'pause'), h('span', paused ? 'Resume' : 'Pause')); pauseBtn.setAttribute('aria-pressed', String(paused)) } })

  // ----- time zone -----
  const zoneOpts = [[BROWSER_TZ, `Your zone (${BROWSER_TZ})`], ...(BROWSER_TZ === 'UTC' ? [] : [['UTC', 'UTC']]), ...ZONES.filter((z) => z !== BROWSER_TZ && z !== 'UTC').map((z) => [z, z.replace(/_/g, ' ')])]
  const tzSel = select(zoneOpts, tz, (v) => { tz = v; convertTs(); convertDate(); worldClock(); tick() })
  tzSel.setAttribute('aria-label', 'Time zone')

  // ----- timestamp -> date -----
  const tsIn = input({ mono: true, placeholder: 'e.g. 1767225600 or 1767225600000', 'aria-label': 'Unix timestamp or date', spellcheck: false, inputmode: 'text', autocomplete: 'off', oninput: () => convertTs() })
  const unitSeg = segmented([['auto', 'Auto'], ['s', 'sec'], ['ms', 'ms'], ['us', 'µs'], ['ns', 'ns']], 'auto', () => convertTs(), 'Unit')
  const tsStatus = h('div', { class: 'row', style: 'min-height:28px' })
  const tsOut = h('div', { class: 'ts-grid' })
  const tsFacts = h('div', { class: 'row', style: 'gap:6px' })

  function convertTs() {
    clear(tsStatus); clear(tsOut); clear(tsFacts)
    const text = tsIn.value
    if (!text.trim()) { tsOut.append(h('div', { class: 'small muted' }, 'Paste a Unix timestamp (seconds, milliseconds, microseconds or nanoseconds) or a date like 2026-03-14 15:30.')); return }
    const r = parseInstant(text, { unit: unitSeg.value, tz })
    if (!r) { tsStatus.append(pill('bad', 'circle-alert', 'Not recognised')); tsOut.append(alert('warn', 'That is not a number or a date I can read. Try 1767225600, 2026-03-14T15:30:00Z or "now".')); return }
    const ms = msOf(r.ns)
    if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) { tsStatus.append(pill('bad', 'circle-alert', 'Out of range')); tsOut.append(alert('warn', 'That is beyond the dates JavaScript can represent (about year 275760).')); return }
    tsStatus.append(r.kind === 'number' ? pill(unitSeg.value === 'auto' ? 'info' : 'ok', 'wand-sparkles', unitSeg.value === 'auto' ? `Detected ${UNIT_LABEL[r.unit]}` : `Read as ${UNIT_LABEL[r.unit]}`) : pill('info', 'calendar', r.kind === 'wall' ? `Read as ${tz} time` : r.kind === 'now' ? 'Now' : 'Parsed date'))
    const p = partsIn(ms, tz)
    const wk = isoWeek(p)
    const off = tzOffsetMin(ms, tz)
    const long = new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }).format(new Date(ms))
    const secs = floorDiv(r.ns, 1_000_000_000n)
    const rows = [
      [tz === BROWSER_TZ ? 'Local' : 'Zone', long], ['Zone ISO', isoIn(ms, tz)], ['UTC', new Date(ms).toUTCString()], ['ISO UTC', new Date(ms).toISOString()],
      ['RFC 2822', rfc2822In(ms, tz)], ['Relative', relative(ms)],
      ['Seconds', String(secs)], ['Millis', String(floorDiv(r.ns, 1_000_000n))], ['Micros', String(floorDiv(r.ns, 1_000n))], ['Nanos', String(r.ns)],
    ]
    tsOut.append(...rows.map(([k, v]) => copyRow(k, v, { initial: v })))
    tsFacts.append(pill('', 'calendar-days', `Day ${dayOfYear(p)} of the year`), pill('', 'calendar-range', `ISO week ${wk.week}, ${wk.year}`), pill('', 'globe', `UTC${offsetLabel(off)}`),
      secs > 2147483647n || secs < -2147483648n ? pill('warn', 'triangle-alert', 'Beyond 32-bit time (year 2038)', 'Does not fit in a signed 32-bit integer') : null)
  }

  // ----- date -> timestamp -----
  const nowLocal = () => { const p = partsIn(Date.now(), tz); return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}` }
  const dtIn = h('input', { class: 'input', type: 'datetime-local', step: 1, value: nowLocal(), 'aria-label': 'Date and time', oninput: () => convertDate() })
  const dtOut = h('div', { class: 'ts-grid' })
  const dtNote = h('div', { class: 'small muted' })
  function convertDate() {
    clear(dtOut); clear(dtNote)
    const v = dtIn.value
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v)
    if (!m) { dtOut.append(h('div', { class: 'small muted' }, 'Pick a date and time.')); return }
    const ms = zonedToEpoch({ y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0) }, tz)
    const back = partsIn(ms, tz)
    if (back.h !== +m[4] || back.mi !== +m[5]) dtNote.textContent = 'That wall-clock time does not exist in this zone (daylight saving gap), so the nearest valid instant is used.'
    else dtNote.textContent = `Interpreted in ${tz.replace(/_/g, ' ')} (UTC${offsetLabel(tzOffsetMin(ms, tz))}).`
    const rows = [['Seconds', String(Math.floor(ms / 1000))], ['Millis', String(ms)], ['ISO UTC', new Date(ms).toISOString()], ['Zone ISO', isoIn(ms, tz)]]
    dtOut.append(...rows.map(([k, val]) => copyRow(k, val, { initial: val })))
  }

  // ----- world clock -----
  const worldEl = h('div')
  function worldClock() {
    const r = tsIn.value.trim() ? parseInstant(tsIn.value, { unit: unitSeg.value, tz }) : null
    const ms = r && Math.abs(msOf(r.ns)) <= 8.64e15 ? msOf(r.ns) : Date.now()
    const zones = [...new Set([tz, ...WORLD])]
    clear(worldEl, table({ columns: ['Zone', 'Date and time', { label: 'Offset', num: true }], rows: zones.map((z) => { const p = partsIn(ms, z); return [z.replace(/_/g, ' '), `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`, z === 'UTC' ? 'UTC' : `UTC${offsetLabel(tzOffsetMin(ms, z))}`] }) }))
  }
  tsIn.addEventListener('input', debounce(worldClock, 150))
  unitSeg.addEventListener('click', () => setTimeout(worldClock, 0))

  // ----- batch -----
  const batchIn = textarea({ rows: 5, mono: true, spellcheck: false, placeholder: 'One timestamp or date per line...', 'aria-label': 'Timestamps to convert, one per line', oninput: () => batch() })
  const batchOut = outBox('ISO 8601 (UTC)', { placeholder: 'Converted lines appear here.' })
  function batch() {
    const lines = batchIn.value.split(/\r?\n/)
    const out = lines.map((l) => {
      if (!l.trim()) return ''
      const r = parseInstant(l, { tz })
      if (!r) return `${l.trim()}  ->  (not recognised)`
      const ms = msOf(r.ns)
      return Math.abs(ms) > 8.64e15 ? `${l.trim()}  ->  (out of range)` : `${l.trim()}  ->  ${new Date(ms).toISOString()}`
    })
    batchOut.set(out.join('\n').replace(/\s+$/, ''), { quiet: true })
  }

  const useNow = button('Use now', { icon: 'clock', size: 'sm', onClick: () => { tsIn.value = String(Math.floor(Date.now() / 1000)); unitSeg.set('s'); convertTs(); worldClock() } })
  const dtNow = button('Now', { icon: 'clock', size: 'sm', variant: 'ghost', onClick: () => { dtIn.value = nowLocal(); convertDate() } })
  const sample = button('Example', { icon: 'sparkles', size: 'sm', variant: 'ghost', onClick: () => { tsIn.value = '1767225600'; unitSeg.set('auto'); convertTs(); worldClock() } })

  root.append(h('div', { class: 'dv t-ts stack' },
    h('div', { class: 'dv-hero' }, h('div', { class: 'ts-now' },
      h('div', { class: 'stack tight' }, h('div', { class: 'ts-lbl' }, h('span', { class: 'dv-live' }), 'Current Unix time'), nowS, nowMs, nowIso),
      h('div', { class: 'stack tight' }, h('div', { class: 'row' }, button('Copy seconds', { icon: 'copy', size: 'sm', variant: 'primary', onClick: () => copyText(String(Math.floor(Date.now() / 1000))) }), button('Copy ms', { icon: 'copy', size: 'sm', onClick: () => copyText(String(Date.now())) }), pauseBtn),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Time zone for results'), tzSel)))),
    split(
      h('div', { class: 'panel stack' }, h('div', { class: 'row between' }, eyebrow('arrow-right-left', 'Timestamp to date'), h('div', { class: 'row', style: 'gap:6px' }, sample, useNow)), tsIn, unitSeg, tsStatus, tsFacts, tsOut),
      h('div', { class: 'stack' },
        h('div', { class: 'panel stack' }, h('div', { class: 'row between' }, eyebrow('calendar-clock', 'Date to timestamp'), dtNow), dtIn, dtNote, dtOut),
        h('div', { class: 'panel stack tight' }, eyebrow('globe', 'Same moment around the world'), worldEl))),
    h('div', { class: 'panel stack tight' }, eyebrow('list', 'Convert many at once'), batchIn, batchOut.el),
    h('p', { class: 'small muted' }, 'Unix time counts seconds since 1 January 1970 UTC. Auto-detect reads up to 11 digits as seconds, 12-14 as milliseconds, 15-17 as microseconds and longer as nanoseconds. Dates without a zone are read in the zone selected above. Everything runs in your browser.')))
  convertTs(); convertDate(); worldClock(); batch()
}
