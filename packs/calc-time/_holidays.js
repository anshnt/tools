// Holiday lists for the working-day tools, plus the shared "Holidays" panel (list picker + your own dates).
//
// India (central government gazetted / closed holidays, Annexure I for administrative offices in Delhi/New Delhi):
//   Department of Personnel and Training (DoPT), Ministry of Personnel, Public Grievances and Pensions, O.M. F.No.12/2/2023-JCA
//     2025: dated 09.07.2024 | 2026: dated 03.07.2025 | 2027: dated 16.07.2026
//   Official source: https://dopt.gov.in (Establishment / JCA section circulars). The dates below were read from the text of those
//   memoranda as reproduced by https://www.staffnews.in and https://www.gconnect.in and agree between the two (the official 2027 PDF is a scan).
//   Notes from the O.M.s: a festival that falls on a weekly off day is not shifted; Id-ul-Fitr, Id-ul-Zuha, Muharram and Id-e-Milad can move
//   by a day with moon sighting; offices outside Delhi follow a state list (a fixed core plus holidays chosen by the state's Central
//   Government Employees Welfare Coordination Committee). That is why users can switch holidays off and add their own state holidays.
// United States federal and UK (England and Wales) bank holidays are computed from their rules, so any year works.
import { h, select, field, input, button, icon, toast, textarea } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { toDayNum, parseISO, isoDate, ymd, weekday, daysInMonth, fmtDate, MONTHS } from './_dates.js'

const INDIA = {
  2025: [['01-26', 'Republic Day'], ['02-26', 'Maha Shivaratri'], ['03-14', 'Holi'], ['03-31', 'Id-ul-Fitr'], ['04-10', 'Mahavir Jayanti'], ['04-18', 'Good Friday'],
    ['05-12', 'Buddha Purnima'], ['06-07', 'Id-ul-Zuha (Bakrid)'], ['07-06', 'Muharram'], ['08-15', 'Independence Day'], ['08-16', 'Janmashtami'],
    ['09-05', 'Milad-un-Nabi (Id-e-Milad)'], ['10-02', "Mahatma Gandhi's Birthday"], ['10-02', 'Dussehra'], ['10-20', 'Diwali (Deepavali)'],
    ['11-05', "Guru Nanak's Birthday"], ['12-25', 'Christmas Day']],
  2026: [['01-26', 'Republic Day'], ['03-04', 'Holi'], ['03-21', 'Id-ul-Fitr'], ['03-26', 'Ram Navami'], ['03-31', 'Mahavir Jayanti'], ['04-03', 'Good Friday'],
    ['05-01', 'Buddha Purnima'], ['05-27', 'Id-ul-Zuha (Bakrid)'], ['06-26', 'Muharram'], ['08-15', 'Independence Day'], ['08-26', 'Milad-un-Nabi (Id-e-Milad)'],
    ['09-04', 'Janmashtami'], ['10-02', "Mahatma Gandhi's Birthday"], ['10-20', 'Dussehra'], ['11-08', 'Diwali (Deepavali)'], ['11-24', "Guru Nanak's Birthday"],
    ['12-25', 'Christmas Day']],
  2027: [['01-26', 'Republic Day'], ['03-10', 'Id-ul-Fitr'], ['03-23', 'Holi'], ['03-26', 'Good Friday'], ['04-15', 'Ram Navami'], ['04-19', 'Mahavir Jayanti'],
    ['05-17', 'Id-ul-Zuha (Bakrid)'], ['05-20', 'Buddha Purnima'], ['06-16', 'Muharram'], ['08-15', 'Independence Day'], ['08-15', 'Milad-un-Nabi (Id-e-Milad)'],
    ['08-25', 'Janmashtami'], ['10-02', "Mahatma Gandhi's Birthday"], ['10-09', 'Dussehra'], ['10-29', 'Diwali (Deepavali)'], ['11-14', "Guru Nanak's Birthday"],
    ['12-25', 'Christmas Day']],
}
export const INDIA_YEARS = [2025, 2027]

const nthWeekday = (y, m, wd, n) => { const first = toDayNum(y, m, 1); return first + ((wd - weekday(first) + 7) % 7) + (n - 1) * 7 }
const lastWeekday = (y, m, wd) => { const last = toDayNum(y, m, daysInMonth(y, m)); return last - ((weekday(last) - wd + 7) % 7) }

/** Easter Sunday (Anonymous Gregorian algorithm). */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451)
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1
  return toDayNum(y, month, day)
}

/** US federal holidays as observed (a Saturday holiday is observed on Friday, a Sunday one on Monday). May land in the neighbouring year. */
function usHolidays(y) {
  const obs = (n) => (weekday(n) === 5 ? n - 1 : weekday(n) === 6 ? n + 1 : n)
  return [
    [obs(toDayNum(y, 1, 1)), "New Year's Day"], [nthWeekday(y, 1, 0, 3), 'Martin Luther King Jr. Day'], [nthWeekday(y, 2, 0, 3), "Washington's Birthday"],
    [lastWeekday(y, 5, 0), 'Memorial Day'], ...(y >= 2021 ? [[obs(toDayNum(y, 6, 19)), 'Juneteenth']] : []), [obs(toDayNum(y, 7, 4)), 'Independence Day'],
    [nthWeekday(y, 9, 0, 1), 'Labor Day'], [nthWeekday(y, 10, 0, 2), 'Columbus Day'], [obs(toDayNum(y, 11, 11)), 'Veterans Day'],
    [nthWeekday(y, 11, 3, 4), 'Thanksgiving Day'], [obs(toDayNum(y, 12, 25)), 'Christmas Day'],
  ]
}

/** UK bank holidays for England and Wales, with substitute days. */
function ukHolidays(y) {
  const ny = toDayNum(y, 1, 1), xmas = toDayNum(y, 12, 25), e = easter(y)
  const out = [[weekday(ny) >= 5 ? ny + (7 - weekday(ny)) : ny, "New Year's Day"], [e - 2, 'Good Friday'], [e + 1, 'Easter Monday'],
    [nthWeekday(y, 5, 0, 1), 'Early May bank holiday'], [lastWeekday(y, 5, 0), 'Spring bank holiday'], [lastWeekday(y, 8, 0), 'Summer bank holiday']]
  const wd = weekday(xmas)
  if (wd === 5) out.push([xmas + 2, 'Christmas Day (substitute)'], [xmas + 3, 'Boxing Day (substitute)'])
  else if (wd === 6) out.push([xmas + 2, 'Christmas Day (substitute)'], [xmas + 1, 'Boxing Day'])
  else if (wd === 4) out.push([xmas, 'Christmas Day'], [xmas + 3, 'Boxing Day (substitute)'])
  else out.push([xmas, 'Christmas Day'], [xmas + 1, 'Boxing Day'])
  return out
}

export const LISTS = {
  none: { name: 'No public holidays' },
  in: { name: 'India: central government (2025-2027)', get: (y) => (INDIA[y] || []).map(([md, name]) => [toDayNum(y, +md.slice(0, 2), +md.slice(3)), name]), years: INDIA_YEARS },
  us: { name: 'United States: federal holidays', get: usHolidays },
  uk: { name: 'United Kingdom: bank holidays (England & Wales)', get: ukHolidays },
}

/** Built-in holidays inside [a, b] for a list id: [{date, name}] sorted. */
export function listHolidays(id, a, b) {
  const L = LISTS[id]
  if (!L?.get) return []
  const seen = new Set(), out = []
  for (let y = ymd(a).y - 1; y <= ymd(b).y + 1; y++) {
    for (const [date, name] of L.get(y)) {
      const k = `${date}|${name}`
      if (date >= a && date <= b && !seen.has(k)) { seen.add(k); out.push({ date, name }) }
    }
  }
  return out.sort((x, y) => x.date - y.date)
}
/** Years in [a, b] that a list has no data for (only the India list has gaps). */
export function missingYears(id, a, b) {
  const L = LISTS[id]
  if (!L?.years) return []
  const out = []
  for (let y = ymd(a).y; y <= ymd(b).y; y++) if (y < L.years[0] || y > L.years[1]) out.push(y)
  return out
}

/** One holiday per line: "2026-11-14 Name", "14/11/2026 Name" (day first), "14 Nov 2026 Name", "Nov 14, 2026 Name". */
export function parseHolidayLine(line) {
  const s = line.trim()
  if (!s) return null
  const mon = (w) => MONTHS.findIndex((x) => x.toLowerCase().startsWith(w.slice(0, 3).toLowerCase())) + 1
  let m, y, mo, d, name
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b[\s,:;-]*(.*)$/.exec(s))) [y, mo, d, name] = [+m[1], +m[2], +m[3], m[4]]
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b[\s,:;-]*(.*)$/.exec(s))) [d, mo, y, name] = [+m[1], +m[2], +m[3], m[4]]
  else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b[\s,:;-]*(.*)$/.exec(s))) [d, mo, y, name] = [+m[1], mon(m[2]), +m[3], m[4]]
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b[\s,:;-]*(.*)$/.exec(s))) [mo, d, y, name] = [mon(m[1]), +m[2], +m[3], m[4]]
  else return { error: s }
  if (!mo || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return { error: s }
  return { date: toDayNum(y, mo, d), name: name.trim() || 'Holiday' }
}

const CUSTOM_KEY = 'holidays:custom'

/**
 * holidayPanel({id, list, onChange}) -> {el, resolve(a, b), setOff(date, off)}
 * resolve gives {items: [{date, name, custom, off}], set: Set of day numbers that count as holidays, missing: [years without data]}.
 * Your own dates are saved on this device and shared by every working-day tool.
 */
export function holidayPanel({ id = 'wd', list = 'none', onChange }) {
  const saved = load(`holidays:list:${id}`, null)
  let listId = LISTS[saved] ? saved : list
  let custom = load(CUSTOM_KEY, []).map((c) => ({ date: parseISO(c.date), name: c.name })).filter((c) => Number.isFinite(c.date))
  const off = new Set()
  const persist = () => save(CUSTOM_KEY, custom.map((c) => ({ date: isoDate(c.date), name: c.name })))
  const changed = () => onChange?.()

  const sel = select(Object.entries(LISTS).map(([k, v]) => [k, v.name]), listId, (v) => { listId = v; save(`holidays:list:${id}`, v); off.clear(); changed() })
  const dateIn = h('input', { class: 'input', type: 'date', 'aria-label': 'Holiday date' })
  const nameIn = input({ placeholder: 'Name (optional)', 'aria-label': 'Holiday name', maxLength: 60 })
  const chipsEl = h('div', { class: 'ct-chips' })
  const pasteArea = textarea({ rows: 5, placeholder: '2026-11-14 Children\'s Day\n14/12/2026 State foundation day\n3 Jan 2027 Local holiday', 'aria-label': 'Paste holidays, one per line', mono: true })
  const paste = h('details', { class: 'ct-paste' }, h('summary', 'Paste many at once'),
    h('div', { class: 'stack tight', style: 'margin-top:10px' }, pasteArea,
      h('div', { class: 'row' }, button('Add these', { size: 'sm', icon: 'list-plus', onClick: addMany }), h('span', { class: 'small muted' }, 'One per line: date first (day/month/year, 2026-11-14 or 14 Nov 2026), then the name.'))))

  function add(date, name) {
    if (!Number.isFinite(date)) return false
    if (custom.some((c) => c.date === date)) return true
    custom.push({ date, name: name || 'My holiday' })
    custom.sort((a, b) => a.date - b.date)
    return true
  }
  function addOne() {
    const d = parseISO(dateIn.value)
    if (!Number.isFinite(d)) return toast('Pick a date for the holiday first.', 'error')
    add(d, nameIn.value.trim())
    dateIn.value = ''; nameIn.value = ''
    persist(); drawChips(); changed()
  }
  function addMany() {
    const lines = pasteArea.value.split(/\r?\n/).map(parseHolidayLine).filter(Boolean)
    const bad = lines.filter((l) => l.error)
    for (const l of lines) if (!l.error) add(l.date, l.name)
    if (lines.length - bad.length) { persist(); drawChips(); changed(); pasteArea.value = bad.map((b) => b.error).join('\n') }
    toast(`Added ${lines.length - bad.length} holiday${lines.length - bad.length === 1 ? '' : 's'}${bad.length ? `. Could not read ${bad.length} line${bad.length === 1 ? '' : 's'} (left in the box).` : '.'}`, bad.length ? 'error' : 'success')
  }
  function drawChips() {
    chipsEl.replaceChildren(...custom.map((c) => h('span', { class: 'ct-chip x', title: c.name },
      h('span', `${fmtDate(c.date, { day: 'numeric', month: 'short', year: 'numeric' })} ${c.name}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-icon', 'aria-label': `Remove ${c.name} on ${fmtDate(c.date)}`, style: 'height:24px;width:24px', onclick: () => { custom = custom.filter((x) => x !== c); persist(); drawChips(); changed() } }, icon('x')))))
    if (!custom.length) chipsEl.append(h('span', { class: 'small muted' }, 'No custom holidays yet. Add state, company or one-off days here.'))
  }
  drawChips()

  const el = h('section', { class: 'panel stack' },
    h('div', { class: 'ct-h' }, icon('calendar-heart'), 'Holidays'),
    h('div', { class: 'ct-fields' }, field('Holiday list', sel)),
    h('div', { class: 'ct-fields' }, field('Add your own', dateIn), field('Name', nameIn), h('div', { style: 'align-self:end' }, button('Add', { icon: 'plus', onClick: addOne }))),
    chipsEl, paste)
  for (const i of [dateIn, nameIn]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') addOne() })

  return {
    el,
    get listId() { return listId },
    resolve(a, b) {
      const items = [...listHolidays(listId, a, b).map((x) => ({ ...x, custom: false })), ...custom.filter((c) => c.date >= a && c.date <= b).map((c) => ({ ...c, custom: true }))]
        .sort((x, y) => x.date - y.date).map((x) => ({ ...x, off: off.has(x.date) }))
      return { items, set: new Set(items.filter((x) => !x.off).map((x) => x.date)), missing: missingYears(listId, a, b) }
    },
    setOff(date, v) { v ? off.add(date) : off.delete(date); changed() },
  }
}

/** Seven day buttons (Mon..Sun) for choosing the weekend. Keeps at least one working day. Returns {el, set} (set = Set of 0..6, Monday = 0). */
export function weekendPicker(initial, onChange) {
  const set = new Set(initial)
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const btns = names.map((n, i) => h('button', {
    type: 'button', class: 'ct-chip', 'aria-pressed': String(set.has(i)), title: `${n} is a day off`,
    onclick: () => {
      if (!set.has(i) && set.size >= 6) return toast('At least one day of the week has to be a working day.', 'error')
      set.has(i) ? set.delete(i) : set.add(i)
      btns[i].setAttribute('aria-pressed', String(set.has(i)))
      onChange?.(set)
    },
  }, n))
  return { el: field('Weekly days off', h('div', { class: 'ct-daychips', role: 'group', 'aria-label': 'Weekly days off' }, btns), 'Highlighted days are not working days. Pick Fri and Sat for Middle East weeks.'), set }
}

/** List of holidays in the range with a checkbox each (untick to treat a day as a normal working day). */
export function holidayRows(items, weekend, onToggle) {
  if (!items.length) return h('div', { class: 'small muted' }, 'No holidays fall in this period.')
  return h('ul', { class: 'ct-list' }, items.map((x, i) => {
    const onWeekend = weekend.has(weekday(x.date))
    const box = h('input', { type: 'checkbox', checked: !x.off, 'aria-label': `${x.name}, ${fmtDate(x.date)}: count as a day off`, onchange: () => onToggle(x.date, !box.checked) })
    return h('li', { class: ['ct-li', x.off && 'past'], style: { '--i': Math.min(i, 12), '--c': x.custom ? '#8e4ec6' : '#f76b15' } },
      box,
      h('div', { class: 'tx' }, h('b', x.name), h('span', fmtDate(x.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))),
      onWeekend ? h('span', { class: 'when', style: '--c: var(--muted)' }, 'weekend') : x.custom ? h('span', { class: 'when' }, 'yours') : null)
  }))
}
