// Days between two dates: inclusive/exclusive, years-months-days, weeks, hours, working days, with month calendars.
import { h, button, toggle, alert, clear, copyText, icon } from '../../lib/ui.js'
import { useStyles, hero, liveTiles, counter, dateField, chips, miniCalendars, legend, settleOnce } from './_kit.js'
import { today, ymd, addMonths, addYears, toDayNum, diffYMD, fmtDate, countWorking, weekday, SAT_SUN, ymdText, plural } from './_dates.js'

/** Everything the tool shows, as plain numbers. `inclusive` counts both the start and the end day. */
export function between(a, b, inclusive = false) {
  const swapped = a > b
  if (swapped) [a, b] = [b, a]
  const days = b - a + (inclusive ? 1 : 0)
  const parts = diffYMD(a, inclusive ? b + 1 : b)
  const last = inclusive ? b : b - 1 // working days between: exclude the end day unless inclusive
  return {
    a, b, swapped, days, parts, weeks: Math.floor(days / 7), restDays: days % 7,
    working: countWorking(a, Math.max(last, a - 1), SAT_SUN), weekends: Math.max(0, days) - countWorking(a, Math.max(last, a - 1), SAT_SUN),
    months: parts.totalMonths + parts.days / 30.4375, years: days / 365.2425,
  }
}

export function mount(root) {
  useStyles()
  const t = today()
  const startF = dateField('Start date', t, render)
  const endF = dateField('End date', t + 60, render)
  const incl = toggle('Include the end date (count both days)', false, render)
  const swap = button('Swap', { icon: 'arrow-left-right', variant: 'ghost', size: 'sm', onClick: () => { const s = startF.get(); startF.set(endF.get()); endF.set(s); render() } })
  const quick = chips([
    { label: '30 days', onClick: () => preset(addDays(30)) }, { label: '90 days', onClick: () => preset(addDays(90)) },
    { label: '6 months', onClick: () => preset(addMonthsTo(6)) }, { label: '1 year', onClick: () => preset(addYearsTo(1)) },
    { label: 'Until year end', onClick: () => preset(toDayNum(ymd(startBase()).y, 12, 31)) },
    { label: 'Year to date', icon: 'history', onClick: () => { startF.set(toDayNum(ymd(t).y, 1, 1)); endF.set(t); render() } },
  ])
  const startBase = () => (Number.isFinite(startF.get()) ? startF.get() : t)
  const addDays = (n) => startBase() + n
  const addMonthsTo = (n) => addMonths(startBase(), n)
  const addYearsTo = (n) => addYears(startBase(), n)
  function preset(end) { if (!Number.isFinite(startF.get())) startF.set(t); endF.set(end); render() }

  const hr = hero()
  const big = h('span'), unit = h('span', { class: 'u' }, 'days')
  hr.big.classList.add('ct-grad')
  hr.big.append(big, unit)
  const count = counter()
  let summary = ''
  hr.actions.append(button('Copy result', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))
  const T = liveTiles([
    { key: 'ymd', icon: 'calendar-range', label: 'Years, months, days', accent: true, wide: true },
    { key: 'weeks', icon: 'calendar-days', label: 'Weeks', color: '#3e63dd' },
    { key: 'months', icon: 'calendar', label: 'Months', color: '#8e4ec6' },
    { key: 'years', icon: 'hourglass', label: 'Years', color: '#e5484d' },
    { key: 'hours', icon: 'clock', label: 'Hours', color: '#0d9b8a' },
    { key: 'working', icon: 'briefcase', label: 'Working days', color: '#30a46c' },
    { key: 'weekend', icon: 'sofa', label: 'Weekend days', color: '#d6409f' },
  ], 4)
  const calHost = h('section', { class: 'panel stack' })
  const warn = h('div')
  const results = h('div', { class: 'ct', hidden: true }, hr.el, T.el, calHost)

  function render() {
    const s = startF.get(), e = endF.get()
    const ok = Number.isFinite(s) && Number.isFinite(e)
    results.hidden = !ok
    clear(warn, ok ? null : alert('info', 'Pick both dates to see the difference.'))
    if (!ok) return
    settleOnce(results)
    const r = between(s, e, incl.input.checked)
    hr.kicker.textContent = r.swapped ? 'Between (end date is earlier, so we swapped them)' : 'Between the two dates'
    count(big, 'days', r.days)
    unit.textContent = r.days === 1 ? 'day' : 'days'
    hr.lede.textContent = `${fmtDate(r.a, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}  to  ${fmtDate(r.b, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${incl.input.checked ? ' (both days counted)' : ''}`
    T.set('ymd', ymdText(r.parts), `${plural(r.parts.totalMonths, 'full month')} and ${plural(r.parts.days, 'day')}`)
    T.set('weeks', `${r.weeks.toLocaleString()} w ${r.restDays} d`, `${(r.days / 7).toLocaleString(undefined, { maximumFractionDigits: 2 })} weeks`)
    T.set('months', r.months, 'average-length months', { fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 2 }) })
    T.set('years', r.years, 'of 365.24 days', { fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 3 }) })
    T.set('hours', r.days * 24, `${(r.days * 1440).toLocaleString()} minutes`)
    T.set('working', r.working, 'Mon to Fri, no holidays')
    T.set('weekend', r.weekends, 'Saturdays and Sundays')

    const cal = miniCalendars(r.a, r.b, (n) => {
      const inRange = n >= r.a && n <= r.b
      return { cls: [inRange && 'in', inRange && SAT_SUN.has(weekday(n)) && 'off', n === r.a && 'a', n === r.b && 'b', n === t && 'today'].filter(Boolean).join(' '), title: inRange ? fmtDate(n) : undefined }
    })
    clear(calHost,
      h('div', { class: 'ct-h' }, icon('calendar-range'), 'The span on a calendar'),
      cal || h('div', { class: 'small muted' }, 'This span is longer than 24 months, so the calendar is skipped.'),
      cal && legend([['k-ab', 'Start and end'], ['', 'Days counted'], ['k-off', 'Weekends']]))
    summary = `${r.days.toLocaleString()} days between ${fmtDate(r.a)} and ${fmtDate(r.b)}${incl.input.checked ? ' (inclusive)' : ''}: ${ymdText(r.parts)}; ${r.weeks} weeks ${r.restDays} days; ${r.working} working days.`
  }

  root.append(h('div', { class: 'ct' },
    h('section', { class: 'panel stack' },
      h('div', { class: 'ct-fields' }, startF.el, endF.el),
      h('div', { class: 'row between' }, incl, swap),
      quick),
    warn, results))
  render()
}
