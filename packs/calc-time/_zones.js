// Time zone helpers (Intl only, DST aware), city search with aliases, the zone picker and the day/night hour strips
// shared by the time zone converter and the meeting planner.
import { h, icon, onCleanup } from '../../lib/ui.js'
import { addStyles } from './_kit.js'
import { toDayNum } from './_dates.js'

const MIN = 60_000, HOUR = 3_600_000

// ---------- Intl helpers ----------
const dtfCache = new Map()
function dtf(zone) {
  let f = dtfCache.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    dtfCache.set(zone, f)
  }
  return f
}
export function isValidZone(zone) {
  try { dtf(zone); return true } catch { return false }
}
/** Wall-clock parts of an instant in a zone. */
export function localParts(zone, ms) {
  const o = {}
  for (const p of dtf(zone).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = +p.value
  return { y: o.year, m: o.month, d: o.day, hh: o.hour % 24, mm: o.minute, ss: o.second }
}
/** UTC offset in minutes at an instant (+330 for India). */
export function offsetMin(zone, ms) {
  const p = localParts(zone, ms)
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000) / MIN)
}
/**
 * The instant for a wall-clock time in a zone. In the hour that does not exist (clocks jump forward) it moves ahead by the gap
 * and sets gap: true; in the repeated hour it takes the first one and sets overlap: true.
 */
export function zonedToMs(y, m, d, hh, mm, zone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  const before = offsetMin(zone, guess - 24 * HOUR), after = offsetMin(zone, guess + 24 * HOUR)
  const valid = []
  for (const o of new Set([before, after])) { const ms = guess - o * MIN; if (offsetMin(zone, ms) === o) valid.push(ms) }
  valid.sort((a, b) => a - b)
  if (valid.length) return { ms: valid[0], overlap: valid.length > 1, gap: false }
  return { ms: guess - before * MIN, overlap: false, gap: true }
}
/** True when the zone is on daylight saving time at that instant. */
export function isDst(zone, ms) {
  const y = new Date(ms).getUTCFullYear()
  const jan = offsetMin(zone, Date.UTC(y, 0, 1)), jul = offsetMin(zone, Date.UTC(y, 6, 1))
  return jan !== jul && offsetMin(zone, ms) > Math.min(jan, jul)
}
export function fmtOffset(min, long = true) {
  if (min === 0) return long ? 'UTC' : '+0'
  const a = Math.abs(min), hh = Math.floor(a / 60), mm = a % 60
  return `${long ? 'UTC' : ''}${min < 0 ? '-' : '+'}${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}`
}
const abbrCache = new Map()
/** Short name like IST, PDT, BST or CEST; '' when the browser only knows a GMT offset for that zone. */
export function tzAbbr(zone, ms) {
  for (const loc of ['en-US', 'en-GB', 'en-IN', 'en-AU']) {
    const key = `${loc}|${zone}`
    let f = abbrCache.get(key)
    if (!f) { f = new Intl.DateTimeFormat(loc, { timeZone: zone, timeZoneName: 'short' }); abbrCache.set(key, f) }
    const n = f.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value
    if (n && !/^(GMT|UTC)[+\-−]/.test(n)) return n
  }
  return ''
}
/** Day number of the wall-clock date in a zone (for "tomorrow" / "yesterday" maths). */
export const localDay = (zone, ms) => { const p = localParts(zone, ms); return toDayNum(p.y, p.m, p.d) }
export const localMinutes = (zone, ms) => { const p = localParts(zone, ms); return p.hh * 60 + p.mm }
export const localZone = () => { try { return canon(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') } catch { return 'UTC' } }

/** Format an instant in a zone: fmtTime(ms, zone, h24) -> "17:30" or "5:30 PM". */
export function fmtTime(ms, zone, h24 = true) {
  const p = localParts(zone, ms)
  const mm = String(p.mm).padStart(2, '0')
  return h24 ? `${String(p.hh).padStart(2, '0')}:${mm}` : `${p.hh % 12 || 12}:${mm} ${p.hh < 12 ? 'AM' : 'PM'}`
}
const dateFmtCache = new Map()
export function fmtZoneDate(ms, zone, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const key = zone + JSON.stringify(opts)
  if (!dateFmtCache.has(key)) dateFmtCache.set(key, new Intl.DateTimeFormat(undefined, { ...opts, timeZone: zone }))
  return dateFmtCache.get(key).format(new Date(ms))
}

// ---------- Zone list and city search ----------
const FALLBACK = ['UTC', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'America/Anchorage', 'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Chicago',
  'America/Denver', 'America/Halifax', 'America/Los_Angeles', 'America/Mexico_City', 'America/New_York', 'America/Phoenix', 'America/Sao_Paulo', 'America/Toronto', 'America/Vancouver',
  'Asia/Bangkok', 'Asia/Dhaka', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta', 'Asia/Karachi', 'Asia/Kathmandu', 'Asia/Kolkata', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Riyadh',
  'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tehran', 'Asia/Tokyo', 'Atlantic/Reykjavik', 'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Dublin', 'Europe/Istanbul', 'Europe/Lisbon', 'Europe/London', 'Europe/Madrid', 'Europe/Moscow', 'Europe/Paris', 'Europe/Rome',
  'Europe/Zurich', 'Pacific/Auckland', 'Pacific/Honolulu']
// Older names some browsers still list, mapped to the name people look for.
const RENAMED = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv', 'Asia/Dacca': 'Asia/Dhaka', 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires' }
const canon = (z) => { const r = RENAMED[z]; return r && isValidZone(r) ? r : z }

let zoneList
/** Every IANA zone the browser knows (Intl.supportedValuesOf), plus UTC. */
export function allZones() {
  if (zoneList) return zoneList
  let z = []
  try { z = Intl.supportedValuesOf('timeZone') } catch { /* older browsers */ }
  if (z.length < 50) z = FALLBACK
  const set = new Set(['UTC'])
  for (const n of z) set.add(canon(n))
  return (zoneList = [...set].sort())
}

// zone -> comma separated cities, countries and abbreviations people search for
const ALIASES = {
  'Asia/Kolkata': 'Mumbai,Delhi,New Delhi,Bangalore,Bengaluru,Chennai,Calcutta,Hyderabad,Pune,Ahmedabad,Jaipur,Lucknow,Bombay,India,IST,Indian Standard Time,Gurgaon,Noida,Kochi',
  'America/New_York': 'New York,NYC,Boston,Washington,Miami,Atlanta,Philadelphia,Detroit,EST,EDT,ET,Eastern Time,US East,Eastern',
  'America/Los_Angeles': 'Los Angeles,LA,San Francisco,San Jose,Seattle,Silicon Valley,San Diego,Las Vegas,Portland,PST,PDT,PT,Pacific Time,US West,California',
  'America/Chicago': 'Chicago,Dallas,Houston,Austin,Minneapolis,New Orleans,CST,CDT,CT,Central Time,Texas',
  'America/Denver': 'Denver,Salt Lake City,Boulder,MST,MDT,MT,Mountain Time',
  'America/Phoenix': 'Phoenix,Arizona', 'America/Anchorage': 'Anchorage,Alaska', 'Pacific/Honolulu': 'Honolulu,Hawaii',
  'America/Toronto': 'Toronto,Ottawa,Montreal,Canada', 'America/Vancouver': 'Vancouver,British Columbia', 'America/Mexico_City': 'Mexico City,Mexico',
  'America/Sao_Paulo': 'Sao Paulo,Rio,Rio de Janeiro,Brazil,Brasilia', 'America/Argentina/Buenos_Aires': 'Buenos Aires,Argentina', 'America/Bogota': 'Bogota,Colombia',
  'America/Lima': 'Lima,Peru', 'America/Santiago': 'Santiago,Chile', 'America/Halifax': 'Halifax,Atlantic Time',
  'Europe/London': 'London,UK,United Kingdom,England,Manchester,Edinburgh,GMT,BST,Britain',
  'Europe/Dublin': 'Dublin,Ireland', 'Europe/Lisbon': 'Lisbon,Portugal',
  'Europe/Paris': 'Paris,France,CET,CEST,Central European,Brussels,Belgium', 'Europe/Berlin': 'Berlin,Germany,Munich,Frankfurt,Hamburg',
  'Europe/Madrid': 'Madrid,Spain,Barcelona', 'Europe/Rome': 'Rome,Italy,Milan', 'Europe/Amsterdam': 'Amsterdam,Netherlands,Holland', 'Europe/Zurich': 'Zurich,Switzerland,Geneva',
  'Europe/Stockholm': 'Stockholm,Sweden', 'Europe/Warsaw': 'Warsaw,Poland', 'Europe/Vienna': 'Vienna,Austria', 'Europe/Athens': 'Athens,Greece,EET,Eastern European',
  'Europe/Istanbul': 'Istanbul,Turkey,Ankara', 'Europe/Moscow': 'Moscow,Russia,MSK', 'Europe/Kyiv': 'Kyiv,Kiev,Ukraine',
  'Asia/Dubai': 'Dubai,Abu Dhabi,UAE,GST,Gulf Standard,Emirates,Sharjah', 'Asia/Riyadh': 'Riyadh,Saudi Arabia,Jeddah,Kuwait,Doha,Qatar', 'Asia/Karachi': 'Karachi,Lahore,Islamabad,Pakistan,PKT',
  'Asia/Dhaka': 'Dhaka,Bangladesh', 'Asia/Kathmandu': 'Kathmandu,Nepal', 'Asia/Colombo': 'Colombo,Sri Lanka', 'Asia/Bangkok': 'Bangkok,Thailand', 'Asia/Ho_Chi_Minh': 'Ho Chi Minh,Saigon,Hanoi,Vietnam',
  'Asia/Jakarta': 'Jakarta,Indonesia', 'Asia/Singapore': 'Singapore,SGT', 'Asia/Kuala_Lumpur': 'Kuala Lumpur,Malaysia', 'Asia/Manila': 'Manila,Philippines',
  'Asia/Hong_Kong': 'Hong Kong,HKT', 'Asia/Shanghai': 'Shanghai,Beijing,China,Shenzhen,Guangzhou', 'Asia/Taipei': 'Taipei,Taiwan', 'Asia/Seoul': 'Seoul,South Korea,Korea,KST',
  'Asia/Tokyo': 'Tokyo,Japan,Osaka,JST', 'Asia/Tehran': 'Tehran,Iran', 'Asia/Jerusalem': 'Jerusalem,Tel Aviv,Israel', 'Asia/Kabul': 'Kabul,Afghanistan', 'Asia/Tashkent': 'Tashkent,Uzbekistan',
  'Australia/Sydney': 'Sydney,Melbourne,Canberra,Australia,AEST,AEDT,Eastern Australia', 'Australia/Brisbane': 'Brisbane,Queensland', 'Australia/Perth': 'Perth,Western Australia,AWST',
  'Australia/Adelaide': 'Adelaide', 'Pacific/Auckland': 'Auckland,Wellington,New Zealand,NZ,NZST',
  'Africa/Johannesburg': 'Johannesburg,Cape Town,South Africa,SAST', 'Africa/Cairo': 'Cairo,Egypt', 'Africa/Lagos': 'Lagos,Nigeria,WAT', 'Africa/Nairobi': 'Nairobi,Kenya,EAT',
  'Africa/Casablanca': 'Casablanca,Morocco', 'Africa/Accra': 'Accra,Ghana', 'Atlantic/Reykjavik': 'Reykjavik,Iceland',
  UTC: 'UTC,GMT,Zulu,Coordinated Universal Time,Greenwich,Universal',
}
export const cityOf = (zone) => (zone === 'UTC' ? 'UTC' : zone.split('/').pop().replace(/_/g, ' '))

let index
function buildIndex() {
  if (index) return index
  const zones = new Set(allZones())
  index = []
  for (const z of zones) index.push({ zone: z, label: cityOf(z), key: `${cityOf(z)} ${z.replace(/[/_]/g, ' ')}`.toLowerCase(), primary: true })
  for (const [z, list] of Object.entries(ALIASES)) {
    if (!zones.has(z) && !isValidZone(z)) continue
    for (const a of list.split(',')) index.push({ zone: z, label: a, key: a.toLowerCase(), primary: false })
  }
  return index
}
/** Search cities, aliases (Mumbai, PST, NYC) and zone ids. Returns [{zone, label}] best first. */
export function searchZones(q, limit = 10) {
  const s = q.toLowerCase().trim().replace(/[/_]/g, ' ')
  if (!s) return []
  const scored = []
  for (const e of buildIndex()) {
    let sc = 0
    if (e.key === s || e.label.toLowerCase() === s) sc = 100
    else if (e.label.toLowerCase().startsWith(s)) sc = 85
    else if (e.key.startsWith(s)) sc = 75
    else if (e.key.split(' ').some((w) => w.startsWith(s))) sc = 55
    else if (e.key.includes(s)) sc = 30
    if (!sc) continue
    scored.push({ ...e, sc: sc + (e.primary ? 0 : 3) - e.label.length / 100 })
  }
  scored.sort((a, b) => b.sc - a.sc)
  const seen = new Set(), out = []
  for (const e of scored) {
    const k = e.zone + (e.primary ? '' : e.label.toLowerCase())
    if (seen.has(k) || (e.primary && out.some((o) => o.zone === e.zone && o.label.toLowerCase() === e.label.toLowerCase()))) continue
    seen.add(k)
    out.push({ zone: e.zone, label: e.label })
    if (out.length >= limit) break
  }
  return out
}
export const POPULAR = [['Asia/Kolkata', 'Mumbai'], ['America/New_York', 'New York'], ['Europe/London', 'London'], ['America/Los_Angeles', 'Los Angeles'], ['Asia/Dubai', 'Dubai'], ['Asia/Singapore', 'Singapore'],
  ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney'], ['Europe/Paris', 'Paris'], ['Europe/Berlin', 'Berlin'], ['America/Chicago', 'Chicago'], ['Asia/Hong_Kong', 'Hong Kong'], ['America/Toronto', 'Toronto'], ['UTC', 'UTC']]
  .map(([zone, label]) => ({ zone, label }))

/** A zone entry as saved: {zone, label}. Fills the label from the zone and drops unknown zones. */
export function cleanZones(list, max = 12) {
  const out = []
  for (const e of Array.isArray(list) ? list : []) {
    const zone0 = typeof e === 'string' ? e : e?.zone
    const zone = zone0 && canon(zone0)
    if (!zone || !isValidZone(zone) || out.some((o) => o.zone === zone)) continue
    out.push({ zone, label: (typeof e === 'object' && e.label) || cityOf(zone) })
    if (out.length >= max) break
  }
  return out
}

// ---------- Styles ----------
const CSS = `
.ct-zp { position: relative; }
.ct-zp .input { padding-left: 38px; }
.ct-zp > .icon { position: absolute; left: 12px; top: 12px; width: 18px; height: 18px; color: var(--muted); pointer-events: none; z-index: 1; }
.ct-zp-list { position: absolute; z-index: 40; left: 0; right: 0; top: calc(100% + 6px); margin: 0; padding: 6px; list-style: none; max-height: 320px; overflow: auto; border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 96%, transparent); backdrop-filter: blur(14px); border: 1px solid var(--border); box-shadow: var(--shadow-lg); animation: ctPop .22s var(--spring); }
.ct-zp-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border-radius: 11px; cursor: pointer; min-height: 40px; }
.ct-zp-list li[aria-selected="true"] { background: var(--surface-2); }
.ct-zp-list li b { font-weight: 550; font-size: 14px; }
.ct-zp-list li span { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ct-zp-list li .r { text-align: right; flex: none; max-width: 55%; }
.ct-zp-list .hd { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); padding: 6px 10px 2px; cursor: default; min-height: 0; }

.ct-zt { position: relative; --lw: 118px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); padding: 8px 0; overflow: hidden; touch-action: pan-y; }
.ct-zt-scroll { overflow-x: auto; border-radius: 18px; }
.ct-zt-in { position: relative; min-width: 640px; }
.ct-zr { display: grid; grid-template-columns: var(--lw) minmax(0, 1fr); align-items: center; gap: 8px; height: 46px; padding: 0 10px; }
.ct-zl { min-width: 0; line-height: 1.15; }
.ct-zl b { display: block; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ct-zl span { font-size: 11.5px; color: var(--muted); white-space: nowrap; }
.ct-zs { position: relative; display: grid; grid-template-columns: repeat(48, minmax(0, 1fr)); height: 30px; border-radius: 9px; overflow: hidden; cursor: ew-resize; }
.ct-zs i { display: block; transition: background .25s; }
.ct-zs i.night { background: color-mix(in srgb, #4f46e5 26%, var(--surface-2)); }
.ct-zs i.day { background: color-mix(in srgb, #f59e0b 24%, var(--surface-2)); }
.ct-zs i.work { background: color-mix(in srgb, #22c55e 52%, var(--surface-2)); }
.ct-zs i.best { background: color-mix(in srgb, #16a34a 78%, var(--surface-2)); }
.ct-zs b { position: absolute; top: 50%; transform: translate(-50%, -50%); font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-2); pointer-events: none; text-shadow: 0 0 3px var(--surface); }
.ct-zs b.mid { color: var(--c, var(--accent)); font-weight: 800; }
.ct-play { position: absolute; top: 4px; bottom: 4px; width: 2px; margin-left: -1px; border-radius: 2px; background: var(--text); pointer-events: none; left: calc(var(--lw) + 18px + (100% - var(--lw) - 28px) * var(--p, 0)); transition: left .12s linear; z-index: 3; box-shadow: 0 0 0 3px color-mix(in srgb, var(--surface) 70%, transparent); }
.ct-play::before { content: ""; position: absolute; top: -4px; left: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--text); }
.ct-sel { position: absolute; top: 4px; bottom: 4px; border-radius: 10px; pointer-events: none; z-index: 2; left: calc(var(--lw) + 18px + (100% - var(--lw) - 28px) * var(--sp, 0)); width: calc((100% - var(--lw) - 28px) * var(--sw, .04));
  border: 2px solid var(--c, var(--accent)); background: color-mix(in srgb, var(--c, var(--accent)) 12%, transparent); box-shadow: 0 8px 22px -10px var(--c, var(--accent)); transition: left .18s var(--ease), width .18s var(--ease); }
.ct-key { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12px; color: var(--muted); }
.ct-key span { display: inline-flex; align-items: center; gap: 6px; }
.ct-key i { width: 14px; height: 14px; border-radius: 5px; display: inline-block; }
.ct-key .night { background: color-mix(in srgb, #4f46e5 26%, var(--surface-2)); } .ct-key .day { background: color-mix(in srgb, #f59e0b 24%, var(--surface-2)); } .ct-key .work { background: color-mix(in srgb, #22c55e 52%, var(--surface-2)); }
@media (max-width: 720px) { .ct-zt { --lw: 96px; } }
`

/**
 * zonePicker({placeholder, onPick({zone, label}), ariaLabel}) -> {el, input}. Type a city, alias (Mumbai, PST, NYC) or zone id; arrow keys and Enter work.
 * With nothing typed it offers popular cities.
 */
export function zonePicker({ placeholder = 'Search a city or time zone', onPick, ariaLabel = 'Search a city or time zone' }) {
  addStyles('ct-zones', CSS)
  const listId = `zp${Math.random().toString(36).slice(2, 8)}`
  const input = h('input', {
    class: 'input', type: 'text', placeholder, autocomplete: 'off', spellcheck: false, role: 'combobox', 'aria-label': ariaLabel, 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list',
    onfocus: () => draw(), oninput: () => { sel = 0; draw() },
    onkeydown: (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) draw(); sel = Math.min(sel + 1, items.length - 1); mark() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark() }
      else if (e.key === 'Enter') { if (items[sel]) { e.preventDefault(); pick(items[sel]) } }
      else if (e.key === 'Escape') close()
    },
  })
  const list = h('ul', { class: 'ct-zp-list', id: listId, role: 'listbox', hidden: true })
  const el = h('div', { class: 'ct-zp' }, icon('search'), input, list)
  let items = [], sel = 0
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false') }
  function pick(it) { close(); input.value = ''; input.blur(); onPick?.(it) }
  function mark() {
    ;[...list.querySelectorAll('li[role=option]')].forEach((li, i) => { li.setAttribute('aria-selected', String(i === sel)); if (i === sel) { li.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', li.id) } })
  }
  function draw() {
    const q = input.value.trim()
    items = q ? searchZones(q) : POPULAR
    list.replaceChildren(...(q ? [] : [h('li', { class: 'hd', role: 'presentation' }, 'Popular')]),
      ...items.map((it, i) => {
        const now = Date.now()
        return h('li', { role: 'option', id: `${listId}-${i}`, 'aria-selected': String(i === sel), onmousedown: (e) => { e.preventDefault(); pick(it) }, onpointermove: () => { if (sel !== i) { sel = i; mark() } } },
          h('b', it.label), h('span', { class: 'r' }, `${it.zone === 'UTC' ? 'Coordinated Universal Time' : it.zone.replace(/_/g, ' ')} · ${fmtOffset(offsetMin(it.zone, now))}`))
      }))
    if (!items.length) list.replaceChildren(h('li', { role: 'presentation', style: 'cursor:default;color:var(--muted)' }, 'No match. Try a city, country or zone name like Asia/Tokyo.'))
    list.hidden = false
    input.setAttribute('aria-expanded', 'true')
    mark()
  }
  const away = (e) => { if (!el.contains(e.target)) close() }
  document.addEventListener('pointerdown', away)
  onCleanup(() => document.removeEventListener('pointerdown', away))
  return { el, input }
}

/** Colour class of a cell by local minute of day. */
export const cellClass = (m, ws, we) => (m >= ws && m < we ? 'work' : m >= 360 && m < 1320 ? 'day' : 'night')

/**
 * 48 half-hour cells (24 hours from startMs) for one zone with hour labels. Returns {el, cells}.
 * classify(minuteOfDay, index) can override the colour class (the meeting planner marks shared slots).
 */
export function zoneStrip({ zone, startMs, work = [540, 1080], h24 = true, classify }) {
  addStyles('ct-zones', CSS)
  const el = h('div', { class: 'ct-zs', role: 'presentation' })
  const cells = []
  for (let i = 0; i < 48; i++) {
    const ms = startMs + i * 30 * MIN
    const p = localParts(zone, ms)
    const m = p.hh * 60 + p.mm
    const cls = classify ? classify(m, i, ms) : cellClass(m, work[0], work[1])
    cells.push({ m, cls, ms })
    el.append(h('i', { class: cls }))
    if (p.mm === 0 && i < 47) {
      const midnight = p.hh === 0
      el.append(h('b', { class: midnight ? 'mid' : '', style: { left: `${((i + 1) / 48) * 100}%` } },
        midnight ? new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: zone }).format(new Date(ms)) : h24 ? String(p.hh) : `${p.hh % 12 || 12}${p.hh < 12 ? 'a' : 'p'}`))
    }
  }
  return { el, cells }
}

export const timelineKey = () => h('div', { class: 'ct-key', 'aria-hidden': 'true' }, h('span', h('i', { class: 'work' }), 'Working hours'), h('span', h('i', { class: 'day' }), 'Awake hours'), h('span', h('i', { class: 'night' }), 'Night'))
