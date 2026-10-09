// Day of the week for any date, plus day of year, leap year and the same date in other years.
import { h, clear, copyText, button, icon, alert } from '../../lib/ui.js'
import { useStyles, hero, liveTiles, dateField, miniCalendars, chips, settleOnce } from './_kit.js'
import { today, ymd, toDayNum, weekday, dayOfYear, daysInYear, daysInMonth, isLeap, isoWeek, fmtDate, longDate, WEEKDAYS, plural } from './_dates.js'

/** The same month and day in another year (29 Feb moves to 28 Feb when the year has no leap day). */
export const sameDateIn = (n, year) => { const { m, d } = ymd(n); return toDayNum(year, m, Math.min(d, daysInMonth(year, m))) }

export function mount(root) {
  useStyles()
  const t = today()
  const dateF = dateField('Date', t, () => render())
  const hr = hero()
  hr.big.classList.add('ct-grad')
  let summary = ''
  hr.actions.append(button('Copy', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))
  const T = liveTiles([
    { key: 'doy', icon: 'sun', label: 'Day of the year', accent: true },
    { key: 'left', icon: 'hourglass', label: 'Days left in the year', color: '#d6409f' },
    { key: 'week', icon: 'calendar-days', label: 'ISO week', color: '#3e63dd' },
    { key: 'leap', icon: 'sparkles', label: 'Leap year', color: '#8e4ec6' },
    { key: 'dim', icon: 'calendar', label: 'Days in the month', color: '#0d9b8a' },
    { key: 'from', icon: 'locate-fixed', label: 'From today', color: '#e2a336' },
  ])
  const calHost = h('section', { class: 'panel stack' })
  const yearsHost = h('section', { class: 'panel stack' })
  const warn = h('div')
  const results = h('div', { class: 'ct', hidden: true }, hr.el, T.el, calHost, yearsHost)

  function render() {
    const n = dateF.get()
    results.hidden = !Number.isFinite(n)
    clear(warn, Number.isFinite(n) ? null : alert('info', 'Pick a date to see its weekday.'))
    if (results.hidden) return
    settleOnce(results)
    const { y, m } = ymd(n)
    const w = isoWeek(n)
    const wd = weekday(n)
    hr.kicker.textContent = fmtDate(n, { day: 'numeric', month: 'long', year: 'numeric' }) + (n > t ? ' will be a' : n === t ? ' is a' : ' was a')
    hr.big.textContent = WEEKDAYS[wd]
    hr.lede.textContent = `${longDate(n)}${n === t ? ', which is today.' : n > t ? `, in ${plural(n - t, 'day')}.` : `, ${plural(t - n, 'day')} ago.`}`
    T.set('doy', dayOfYear(n), `of ${daysInYear(y)}`)
    T.set('left', daysInYear(y) - dayOfYear(n), 'until 31 December')
    T.set('week', `Week ${w.week}`, `of ${w.year}`)
    T.set('leap', isLeap(y) ? 'Yes' : 'No', `${y} has ${daysInYear(y)} days`)
    T.set('dim', daysInMonth(y, m), fmtDate(n, { month: 'long' }))
    T.set('from', n === t ? 'Today' : `${n > t ? '+' : '-'}${Math.abs(n - t).toLocaleString()} d`, n > t ? 'in the future' : n < t ? 'in the past' : '')
    clear(calHost, h('div', { class: 'ct-h' }, icon('calendar-days'), fmtDate(n, { month: 'long', year: 'numeric' })),
      miniCalendars(n, n, (d) => ({ cls: [d === n && 'b', d === t && 'today', weekday(d) >= 5 && 'in off'].filter(Boolean).join(' ') })))
    const first = Math.max(1, y - 3)
    clear(yearsHost, h('div', { class: 'ct-h' }, icon('history'), `The same date in other years`), h('div', { class: 'ct-sub' }, 'Tap a year to jump to it.'),
      chips(Array.from({ length: 13 }, (_, i) => first + i).map((yr) => {
        const d = sameDateIn(n, yr)
        return { label: `${yr}: ${WEEKDAYS[weekday(d)].slice(0, 3)}`, pressed: yr === y, onClick: () => { dateF.set(d); render() } }
      })))
    summary = `${longDate(n)} ${n > t ? 'will be' : n === t ? 'is' : 'was'} a ${WEEKDAYS[wd]}. It is day ${dayOfYear(n)} of ${y}, in ISO week ${w.week}.`
  }

  root.append(h('div', { class: 'ct' }, h('section', { class: 'panel' }, h('div', { class: 'ct-fields' }, dateF.el)), warn, results))
  render()
}
