// Age calculator: exact age (years, months, days), totals, weekday born, next birthday, milestones, zodiac.
import { h, button, alert, clear, copyText, empty, icon } from '../../lib/ui.js'
import { useStyles, hero, liveTiles, ring, counter, burst, dateField, settleOnce } from './_kit.js'
import { today, ymd, toDayNum, diffYMD, weekday, fmtDate, longDate, WEEKDAYS, plural, daysInMonth, addYears, dayOfYear } from './_dates.js'

const SIGNS = [ // [sign, glyph, end month, end day]: each sign runs until that date, inclusive
  ['Capricorn', '♑', 1, 19], ['Aquarius', '♒', 2, 18], ['Pisces', '♓', 3, 20], ['Aries', '♈', 4, 19], ['Taurus', '♉', 5, 20],
  ['Gemini', '♊', 6, 20], ['Cancer', '♋', 7, 22], ['Leo', '♌', 8, 22], ['Virgo', '♍', 9, 22], ['Libra', '♎', 10, 22],
  ['Scorpio', '♏', 11, 21], ['Sagittarius', '♐', 12, 21], ['Capricorn', '♑', 12, 31],
]
const ANIMALS = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig']

export function westernSign(n) {
  const { m, d } = ymd(n)
  const s = SIGNS.find(([, , em, ed]) => m < em || (m === em && d <= ed))
  return { name: s[0], glyph: s[1] }
}
/** Chinese zodiac animal from the browser's Chinese calendar, so dates before Lunar New Year belong to the previous animal. */
export function chineseAnimal(n) {
  let year = ymd(n).y
  try {
    const part = new Intl.DateTimeFormat('en-u-ca-chinese', { year: 'numeric', timeZone: 'UTC' }).formatToParts(new Date(n * 86_400_000)).find((p) => p.type === 'relatedYear')
    if (part) year = +part.value
  } catch { /* fall back to the calendar year */ }
  return ANIMALS[(((year - 4) % 12) + 12) % 12]
}

/** Birthday in year y (a 29 February birthday falls on 28 February in non-leap years). */
export const birthdayIn = (dob, y) => { const { m, d } = ymd(dob); return toDayNum(y, m, Math.min(d, daysInMonth(y, m))) }

export function nextBirthday(dob, ref) {
  let y = ymd(ref).y
  let next = birthdayIn(dob, y)
  if (next < ref) next = birthdayIn(dob, ++y)
  const prev = birthdayIn(dob, y - 1)
  return { date: next, turns: y - ymd(dob).y, daysLeft: next - ref, span: next - prev }
}

/** Day counts people like to celebrate, with the date each is reached. */
export function milestones(dob) {
  const days = [1000, 5000, 10000, 12345, 15000, 20000, 25000, 30000].map((d) => ({ label: `${d.toLocaleString()} days old`, date: dob + d, icon: 'sparkles' }))
  const secs = [[1e9, '1 billion seconds old'], [1.5e9, '1.5 billion seconds old'], [2e9, '2 billion seconds old']].map(([s, label]) => ({ label, date: dob + Math.floor(s / 86400), icon: 'timer' }))
  return [...days, ...secs].sort((a, b) => a.date - b.date)
}

const ord = (n) => { const v = n % 100; return v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th' }
const rel = (from, to) => {
  const d = to - from
  if (d === 0) return 'today'
  const a = Math.abs(d)
  const txt = a < 90 ? plural(a, 'day') : a < 730 ? plural(Math.round(a / 30.44), 'month') : plural(Math.round(a / 365.25), 'year')
  return d > 0 ? `in ${txt}` : `${txt} ago`
}

export function mount(root) {
  useStyles()
  const count = counter()
  const t = today()
  const dobF = dateField('Date of birth', NaN, () => render(), { quick: false })
  const refF = dateField('Age on', t, () => render(), { hint: 'Leave it on today, or pick any date to see the age then.' })

  const rg = ring({ size: 152, stroke: 12 })
  const bnote = h('div', { class: 'ct-sub' })
  const hr = hero({ side: h('div', { style: 'display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;flex:none' }, rg.el, bnote) })
  const yEl = h('span'), mEl = h('span'), dEl = h('span')
  hr.big.classList.add('ct-grad')
  hr.big.append(yEl, h('span', { class: 'u' }, 'years'), mEl, h('span', { class: 'u' }, 'months'), dEl, h('span', { class: 'u' }, 'days'))
  let summary = ''
  hr.actions.append(button('Copy summary', { icon: 'copy', size: 'sm', onClick: () => copyText(summary) }))

  const T = liveTiles([
    { key: 'months', icon: 'calendar-days', label: 'Total months', accent: true },
    { key: 'weeks', icon: 'calendar-range', label: 'Total weeks' },
    { key: 'days', icon: 'sun', label: 'Total days' },
    { key: 'hours', icon: 'clock', label: 'Total hours' },
    { key: 'born', icon: 'calendar-check', label: 'Born on a', color: '#0d9b8a' },
    { key: 'next', icon: 'party-popper', label: 'Next birthday', color: '#e54666' },
    { key: 'sun', icon: 'sparkles', label: 'Sun sign', color: '#8e4ec6' },
    { key: 'cn', icon: 'moon-star', label: 'Chinese zodiac', color: '#e2a336' },
  ], 4)
  const mileBody = h('ul', { class: 'ct-list' })
  const mile = h('section', { class: 'panel' }, h('div', { class: 'panel-title' }, h('span', { class: 'ct-h' }, icon('flag'), 'Milestones')), mileBody)

  const hint = empty('Pick a date of birth to see the exact age.', 'cake')
  const warn = h('div')
  const results = h('div', { class: 'ct', hidden: true }, hr.el, T.el, mile)
  let wasBirthday = false

  function render() {
    const dob = dobF.get(), ref = refF.get()
    const ready = Number.isFinite(dob) && Number.isFinite(ref)
    hint.hidden = ready
    const bad = ready && dob > ref
    clear(warn, bad ? alert('warn', 'That date of birth is after the "Age on" date. Check the two dates.') : null)
    results.hidden = !ready || bad
    if (results.hidden) return
    settleOnce(results)

    const age = diffYMD(dob, ref)
    const totalDays = ref - dob
    const nb = nextBirthday(dob, ref)
    const isBday = nb.daysLeft === 0 && totalDays > 0
    const sign = westernSign(dob)

    hr.kicker.textContent = ref === t ? 'Your age today' : `Age on ${fmtDate(ref, { day: 'numeric', month: 'short', year: 'numeric' })}`
    count(yEl, 'y', age.years); count(mEl, 'm', age.months); count(dEl, 'd', age.days)
    hr.lede.textContent = `Born on ${longDate(dob)}.`
    rg.set(isBday ? 1 : 1 - nb.daysLeft / nb.span, isBday ? '0' : nb.daysLeft.toLocaleString(), isBday ? 'today!' : nb.daysLeft === 1 ? 'day to go' : 'days to go',
      isBday ? 'Birthday today' : `${nb.daysLeft} days until the next birthday`)
    bnote.textContent = isBday ? `Happy ${nb.turns}${ord(nb.turns)} birthday!` : `Turns ${nb.turns} on ${fmtDate(nb.date, { weekday: 'long', day: 'numeric', month: 'long' })}`
    if (isBday && !wasBirthday) burst(hr.el)
    wasBirthday = isBday

    T.set('months', age.totalMonths, 'complete months')
    T.set('weeks', Math.floor(totalDays / 7), `and ${totalDays % 7} days`)
    T.set('days', totalDays, 'midnight to midnight')
    T.set('hours', totalDays * 24, `${(totalDays * 24 * 60).toLocaleString()} minutes`)
    T.set('born', WEEKDAYS[weekday(dob)], `day ${dayOfYear(dob)} of the year`)
    T.set('next', isBday ? 'Today!' : nb.daysLeft === 1 ? 'Tomorrow' : plural(nb.daysLeft, 'day'), `on a ${WEEKDAYS[weekday(nb.date)]}`)
    T.set('sun', `${sign.glyph} ${sign.name}`, 'Western zodiac')
    T.set('cn', chineseAnimal(dob), 'by lunar new year')

    const list = milestones(dob).filter((m) => m.date <= addYears(dob, 110))
    const shown = [...list.filter((m) => m.date <= ref).slice(-1), ...list.filter((m) => m.date > ref).slice(0, 5)]
    clear(mileBody, shown.map((m, i) => h('li', { class: ['ct-li', m.date <= ref && 'past'], style: { '--i': i, '--c': m.icon === 'timer' ? '#0090ff' : '#f76b15' } },
      h('span', { class: 'dot' }, icon(m.icon)),
      h('div', { class: 'tx' }, h('b', m.label), h('span', fmtDate(m.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))),
      h('span', { class: 'when' }, rel(ref, m.date)))))

    summary = `Age${ref === t ? '' : ' on ' + fmtDate(ref)}: ${age.years} years, ${age.months} months, ${age.days} days. Born ${longDate(dob)}. `
      + `${totalDays.toLocaleString()} days in total. ${isBday ? 'Birthday is today!' : `Next birthday in ${plural(nb.daysLeft, 'day')} (${fmtDate(nb.date)}).`}`
  }

  root.append(h('div', { class: 'ct' }, h('section', { class: 'panel' }, h('div', { class: 'ct-fields' }, dobF.el, refF.el)), hint, warn, results))
  render()
  dobF.input.focus({ preventScroll: true })
}
