// Date + N days: add or subtract years, months, weeks, days or business days from a date.
import { h, segmented, number, field, clear, button, copyText, icon, alert } from '../../lib/ui.js'
import { useStyles, hero, liveTiles, dateField, chips, miniCalendars, legend, settleOnce } from './_kit.js'
import { holidayPanel, weekendPicker, holidayRows } from './_holidays.js'
import { today, addMonths, addWorking, weekday, isoWeek, dayOfYear, quarter, fmtDate, longDate, countWorking, plural, SAT_SUN, WEEKDAYS } from './_dates.js'

/** Calendar offset: months/years first (month-end clamped), then weeks and days. sign is +1 or -1. */
export function offsetDate(start, sign, { years = 0, months = 0, weeks = 0, days = 0 }) {
  return addMonths(start, sign * (years * 12 + months)) + sign * (weeks * 7 + days)
}

const n0 = (v) => (Number.isFinite(v) ? Math.trunc(v) : 0)

export function mount(root) {
  useStyles()
  const t = today()
  let sign = 1, mode = 'calendar'
  const startF = dateField('Start date', t, () => render())
  const dir = segmented([['add', 'Add'], ['sub', 'Subtract']], 'add', (v) => { sign = v === 'add' ? 1 : -1; render() }, 'Add or subtract')
  const setMode = (v) => { mode = v; modeSeg.set(v); calBox.hidden = v !== 'calendar'; busBox.hidden = v !== 'business'; holidays.el.hidden = v !== 'business'; render() }
  const modeSeg = segmented([['calendar', 'Calendar days'], ['business', 'Business days']], 'calendar', setMode, 'Unit type')
  const fy = number(0, { min: 0, step: 1, onInput: () => render(), ariaLabel: 'Years' }), fm = number(0, { min: 0, step: 1, onInput: () => render(), ariaLabel: 'Months' })
  const fw = number(0, { min: 0, step: 1, onInput: () => render(), ariaLabel: 'Weeks' }), fd = number(30, { min: 0, step: 1, onInput: () => render(), ariaLabel: 'Days' })
  const fb = number(10, { min: 0, step: 1, onInput: () => render(), ariaLabel: 'Business days' })
  const holidays = holidayPanel({ id: 'add-days', list: 'none', onChange: () => render() })
  holidays.el.hidden = true
  const wk = weekendPicker(SAT_SUN, () => render())
  const weekend = wk.set
  const calBox = h('div', { class: 'ct-fields', style: 'grid-template-columns:repeat(auto-fit,minmax(min(100%,110px),1fr))' },
    field('Years', fy), field('Months', fm), field('Weeks', fw), field('Days', fd))
  const busBox = h('div', { class: 'stack', hidden: true }, h('div', { class: 'ct-fields' }, field('Business days', fb)), wk.el)
  const quickHost = h('div', { class: 'stack tight' })

  const hr = hero()
  hr.big.classList.add('ct-grad', 'sm')
  let summary = ''
  hr.actions.append(button('Copy date', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))
  const T = liveTiles([
    { key: 'wd', icon: 'calendar-check', label: 'Weekday', accent: true },
    { key: 'week', icon: 'calendar-days', label: 'ISO week', color: '#3e63dd' },
    { key: 'doy', icon: 'sun', label: 'Day of the year', color: '#e2a336' },
    { key: 'today', icon: 'locate-fixed', label: 'From today', color: '#d6409f' },
    { key: 'other', icon: 'briefcase', label: 'Business days', color: '#30a46c' },
    { key: 'q', icon: 'chart-pie', label: 'Quarter', color: '#8e4ec6' },
  ])
  const calHost = h('section', { class: 'panel stack' })
  const holHost = h('section', { class: 'panel stack', hidden: true })
  const warn = h('div')
  const results = h('div', { class: 'ct', hidden: true }, hr.el, T.el, calHost, holHost)

  function render() {
    const s = startF.get()
    const ok = Number.isFinite(s)
    results.hidden = !ok
    clear(warn, ok ? null : alert('info', 'Pick a start date.'))
    if (!ok) return
    settleOnce(results)
    const span = mode === 'business' ? Math.min(40_000, n0(fb.valueAsNumber) * 2 + 400) : 0
    const hol = holidays.resolve(s - span, s + span)
    let res, label
    if (mode === 'calendar') {
      const o = { years: n0(fy.valueAsNumber), months: n0(fm.valueAsNumber), weeks: n0(fw.valueAsNumber), days: n0(fd.valueAsNumber) }
      res = offsetDate(s, sign, o)
      const bits = [o.years && plural(o.years, 'year'), o.months && plural(o.months, 'month'), o.weeks && plural(o.weeks, 'week'), o.days && plural(o.days, 'day')].filter(Boolean)
      label = `${bits.join(', ') || 'Nothing'} ${sign > 0 ? 'after' : 'before'}`
    } else {
      const n = n0(fb.valueAsNumber)
      res = addWorking(s, sign * n, weekend, hol.set)
      label = `${plural(n, 'business day')} ${sign > 0 ? 'after' : 'before'}`
    }
    if (!Number.isFinite(res) || Math.abs(res) > 3_000_000) { results.hidden = true; clear(warn, alert('warn', 'That is too far away. Try a smaller number.')); return }
    clear(warn)
    hr.kicker.textContent = `${label} ${fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`
    hr.big.textContent = fmtDate(res, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    const fromToday = res - t
    hr.lede.textContent = `${longDate(res)}${fromToday === 0 ? ' is today.' : fromToday > 0 ? `, ${plural(fromToday, 'day')} from today.` : `, ${plural(-fromToday, 'day')} ago.`}`
    const w = isoWeek(res)
    T.set('wd', WEEKDAYS[weekday(res)], weekend.has(weekday(res)) ? 'a day off' : 'a working day')
    T.set('week', `Week ${w.week}`, `of ${w.year}`)
    T.set('doy', dayOfYear(res), 'out of 365 or 366')
    T.set('today', fromToday === 0 ? 'Today' : `${fromToday > 0 ? '+' : '-'}${Math.abs(fromToday).toLocaleString()} d`, fromToday > 0 ? 'in the future' : fromToday < 0 ? 'in the past' : '')
    T.set('q', `Q${quarter(res)}`, fmtDate(res, { year: 'numeric' }))
    const lo = Math.min(s, res), hi = Math.max(s, res)
    if (mode === 'calendar') T.set('other', countWorking(lo, hi - 1, SAT_SUN), 'Mon to Fri in between', { label: 'Business days between' })
    else T.set('other', hi - lo, 'calendar days in between', { label: 'Calendar days between' })

    const cal = miniCalendars(lo, hi, (n) => ({
      cls: [n >= lo && n <= hi && 'in', n >= lo && n <= hi && weekend.has(weekday(n)) && 'off', n === s && 'a', n === res && 'b', mode === 'business' && hol.set.has(n) && 'hol', n === t && 'today'].filter(Boolean).join(' '),
      title: n === s ? 'Start' : n === res ? 'Result' : hol.items.find((x) => x.date === n)?.name,
    })) || miniCalendars(res, res, (n) => ({ cls: [n === res && 'b', n === t && 'today'].filter(Boolean).join(' ') }))
    clear(calHost, h('div', { class: 'ct-h' }, icon('calendar-range'), 'On the calendar'), cal, legend([['k-ab', 'Start and result'], ['', 'Days in between'], ['k-off', 'Days off'], ['k-hol', 'Holidays']]))

    const inView = hol.items.filter((x) => x.date >= lo && x.date <= hi)
    holHost.hidden = mode !== 'business' || !inView.length
    if (!holHost.hidden) clear(holHost, h('div', { class: 'ct-h' }, icon('calendar-heart'), 'Holidays skipped in this span'), holidayRows(inView, weekend, (d, v) => holidays.setOff(d, v)))

    clear(quickHost, h('div', { class: 'ct-sub' }, `Common offsets ${sign > 0 ? 'after' : 'before'} the start date`), chips([7, 14, 30, 45, 60, 90, 180, 365].map((n) => ({
      label: `${n} days: ${fmtDate(offsetDate(s, sign, { days: n }), { day: 'numeric', month: 'short', year: 'numeric' })}`,
      onClick: () => { fy.value = fm.value = fw.value = 0; fd.value = n; setMode('calendar') },
    }))))
    summary = `${label} ${fmtDate(s)} is ${longDate(res)}.`
  }

  root.append(h('div', { class: 'ct' },
    h('section', { class: 'panel stack' },
      h('div', { class: 'ct-fields' }, startF.el, field('Operation', dir), field('Unit', modeSeg)),
      calBox, busBox),
    holidays.el, warn, results, quickHost))
  render()
}
