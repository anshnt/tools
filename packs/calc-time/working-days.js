// Working days calculator (also serves business-days-india via params.holidays = 'in').
import { h, toggle, number, field, alert, clear, button, copyText, icon } from '../../lib/ui.js'
import { useStyles, hero, liveTiles, counter, dateField, chips, miniCalendars, legend, settleOnce } from './_kit.js'
import { holidayPanel, weekendPicker, holidayRows } from './_holidays.js'
import { today, ymd, toDayNum, weekday, daysInMonth, countWorking, holidaysIn, fmtDate, plural, SAT_SUN, MONTHS, addMonths } from './_dates.js'

/** 2nd and 4th Saturdays in [a, b] (the Indian bank holiday pattern). */
export function altSaturdays(a, b) {
  const out = new Set()
  for (let d = a; d <= b; d++) if (weekday(d) === 5 && [2, 4].includes(Math.ceil(ymd(d).d / 7))) out.add(d)
  return out
}

/** Working-day figures for [a, b]. incStart / incEnd choose whether the first / last day are counted. */
export function workingStats(a, b, { incStart = true, incEnd = true, weekend = SAT_SUN, holidays = new Set(), alt = new Set() } = {}) {
  const lo = incStart ? a : a + 1, hi = incEnd ? b : b - 1
  const total = Math.max(0, hi - lo + 1)
  const off = new Set([...holidays, ...alt])
  const working = countWorking(lo, hi, weekend, off)
  const weekendDays = total - countWorking(lo, hi, weekend)
  const altOnly = [...alt].filter((d) => d >= lo && d <= hi && !weekend.has(weekday(d))).length
  const hols = holidaysIn(lo, hi, weekend, holidays).filter((d) => !alt.has(d))
  return { lo, hi, total, working, weekendDays, holidayDays: hols, altDays: altOnly }
}

export function mount(root, { params }) {
  useStyles()
  const india = params?.holidays === 'in'
  const t = today()
  let weekend = new Set(SAT_SUN)
  const count = counter()
  const startF = dateField('From', t, () => render())
  const endF = dateField('To', t + 30, () => render())
  const incS = toggle('Count the first day', true, () => render())
  const incE = toggle('Count the last day', true, () => render())
  const altSat = toggle('2nd and 4th Saturdays are off (Indian banks)', false, () => render())
  const hours = number(8, { min: 0, max: 24, step: 0.5, onInput: () => render(), ariaLabel: 'Working hours per day' })
  const holidays = holidayPanel({ id: india ? 'wd-in' : 'wd', list: india ? 'in' : 'none', onChange: () => render() })
  const wk = weekendPicker(SAT_SUN, (s) => { weekend = s; render() })
  weekend = wk.set
  const quick = chips([
    { label: 'This month', onClick: () => { const y = ymd(t); startF.set(toDayNum(y.y, y.m, 1)); endF.set(toDayNum(y.y, y.m, daysInMonth(y.y, y.m))); render() } },
    { label: 'Next 30 days', onClick: () => { startF.set(t); endF.set(t + 30); render() } },
    { label: 'This quarter', onClick: () => { const y = ymd(t), q = Math.floor((y.m - 1) / 3) * 3 + 1; startF.set(toDayNum(y.y, q, 1)); endF.set(toDayNum(y.y, q + 2, daysInMonth(y.y, q + 2))); render() } },
    { label: 'This year', onClick: () => { const y = ymd(t).y; startF.set(toDayNum(y, 1, 1)); endF.set(toDayNum(y, 12, 31)); render() } },
    { label: 'Next 6 months', onClick: () => { startF.set(t); endF.set(addMonths(t, 6)); render() } },
  ])

  const hr = hero()
  hr.big.classList.add('ct-grad')
  const big = h('span'), unit = h('span', { class: 'u' }, 'working days')
  hr.big.append(big, unit)
  let summary = ''
  hr.actions.append(button('Copy result', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))
  const T = liveTiles([
    { key: 'cal', icon: 'calendar-range', label: 'Calendar days', color: '#3e63dd' },
    { key: 'we', icon: 'sofa', label: 'Weekly days off', color: '#d6409f' },
    { key: 'hol', icon: 'calendar-heart', label: 'Holidays off', color: '#f76b15' },
    { key: 'alt', icon: 'landmark', label: 'Alternate Saturdays', color: '#8e4ec6' },
    { key: 'wk', icon: 'briefcase', label: 'Working weeks', color: '#0d9b8a' },
    { key: 'hrs', icon: 'clock', label: 'Working hours', color: '#e2a336' },
  ])
  const monthsHost = h('section', { class: 'panel stack' })
  const calHost = h('section', { class: 'panel stack' })
  const holHost = h('section', { class: 'panel stack' })
  const note = h('div')
  const warn = h('div')
  const results = h('div', { class: 'ct', hidden: true }, hr.el, T.el, monthsHost, calHost, holHost)

  function render() {
    let s = startF.get(), e = endF.get()
    const ok = Number.isFinite(s) && Number.isFinite(e)
    results.hidden = !ok
    clear(warn, ok ? null : alert('info', 'Pick both dates.'))
    if (!ok) return
    settleOnce(results)
    const swapped = s > e
    if (swapped) [s, e] = [e, s]
    const hol = holidays.resolve(s, e)
    const useAlt = altSat.input.checked && !weekend.has(5)
    const alt = useAlt ? altSaturdays(s, e) : new Set()
    const st = workingStats(s, e, { incStart: incS.input.checked, incEnd: incE.input.checked, weekend, holidays: hol.set, alt })
    clear(note,
      hol.missing.length ? alert('warn', `The India list covers 2025 to 2027, so ${hol.missing.join(', ')} count${hol.missing.length === 1 ? 's' : ''} weekends only. Add those holidays yourself below.`) : null,
      holidays.listId === 'in' ? alert('info', 'Central government gazetted holidays for Delhi/New Delhi (DoPT). Offices in your state may observe others: add state holidays below, or untick any holiday that does not apply to you.') : null)

    hr.kicker.textContent = swapped ? 'Working days (dates swapped, the end was earlier)' : 'Working days between'
    count(big, 'w', st.working)
    unit.textContent = st.working === 1 ? 'working day' : 'working days'
    hr.lede.textContent = `${fmtDate(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} to ${fmtDate(e, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}: ${plural(st.total, 'day')} counted, minus ${plural(st.weekendDays, 'day')} off each week${st.holidayDays.length ? `, ${plural(st.holidayDays.length, 'holiday')}` : ''}${st.altDays ? ` and ${plural(st.altDays, 'alternate Saturday', 'alternate Saturdays')}` : ''}.`
    const hrs = Number.isFinite(hours.valueAsNumber) ? hours.valueAsNumber : 8
    const perWeek = 7 - weekend.size
    T.set('cal', st.total, 'days counted')
    T.set('we', st.weekendDays, [...weekend].sort().map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', '))
    T.set('hol', st.holidayDays.length, 'on working days')
    T.set('alt', st.altDays, useAlt ? '2nd and 4th Saturdays' : 'not used', { hide: !useAlt })
    T.set('wk', st.working / perWeek, `of ${perWeek} days`, { fmt: (v) => v.toLocaleString(undefined, { maximumFractionDigits: 1 }) })
    T.set('hrs', st.working * hrs, `at ${hrs} hours a day`, { fmt: (v) => Math.round(v).toLocaleString() })

    // working days per month
    const rows = []
    for (let y = ymd(s).y, m = ymd(s).m; y < ymd(e).y || (y === ymd(e).y && m <= ymd(e).m);) {
      const a = Math.max(s, toDayNum(y, m, 1)), b = Math.min(e, toDayNum(y, m, daysInMonth(y, m)))
      const ms = workingStats(a, b, { incStart: a !== s || incS.input.checked, incEnd: b !== e || incE.input.checked, weekend, holidays: hol.set, alt })
      rows.push({ label: `${MONTHS[m - 1].slice(0, 3)} ${y}`, w: ms.working, total: ms.total })
      if (++m > 12) { m = 1; y++ }
      if (rows.length > 60) break
    }
    const max = Math.max(1, ...rows.map((r) => r.w))
    clear(monthsHost, h('div', { class: 'ct-h' }, icon('chart-no-axes-column'), 'Working days by month'),
      rows.length > 36 ? h('div', { class: 'small muted' }, 'The span is longer than 36 months, so the month list is skipped.')
        : h('div', { class: 'ct-bars' }, rows.map((r, i) => h('div', { class: 'ct-bar', style: { '--i': Math.min(i, 14), '--w': `${(r.w / max) * 100}%` } },
          h('span', { class: 'n' }, r.label), h('span', { class: 'bar' }, h('i')), h('b', String(r.w))))))

    const inView = hol.items
    const cal = miniCalendars(s, e, (n) => {
      const inRange = n >= st.lo && n <= st.hi
      const isHol = hol.set.has(n)
      return { cls: [inRange && 'in', inRange && (weekend.has(weekday(n)) || alt.has(n)) && 'off', inRange && isHol && !weekend.has(weekday(n)) && 'hol', n === s && 'a', n === e && 'b', n === t && 'today'].filter(Boolean).join(' '), title: inView.find((x) => x.date === n)?.name }
    }, { max: 12 })
    clear(calHost, h('div', { class: 'ct-h' }, icon('calendar-days'), 'Calendar'),
      cal || h('div', { class: 'small muted' }, 'The calendar is shown for spans up to 12 months.'),
      cal && legend([['k-ab', 'First and last day'], ['', 'Working day'], ['k-off', 'Day off'], ['k-hol', 'Holiday']]))

    clear(holHost, h('div', { class: 'ct-h' }, icon('calendar-heart'), `Holidays in this period (${inView.length})`),
      holidayRows(inView, weekend, (d, v) => holidays.setOff(d, v)))
    summary = `${st.working} working days from ${fmtDate(s)} to ${fmtDate(e)} (${st.total} days counted, ${st.weekendDays} weekly days off, ${st.holidayDays.length} holidays${st.altDays ? `, ${st.altDays} alternate Saturdays` : ''}).`
  }

  root.append(h('div', { class: 'ct' },
    h('section', { class: 'panel stack' },
      h('div', { class: 'ct-fields' }, startF.el, endF.el, field('Hours per working day', hours)),
      h('div', { class: 'row' }, incS, incE), quick, wk.el, altSat),
    holidays.el, note, warn, results))
  render()
}
