// Salary calculator: convert between hourly, daily, weekly, monthly and yearly pay, and estimate take-home.
import { h } from '../../lib/ui.js'
import { shell, num, hero, tiles, card, layout, note, switcher, pick, currencyPicker, chartBox, money, short, fnum, pct, firstIssue, stack, block, style } from './_shared.js'
import { newRegimeTax, NEW_REGIME } from './_math.js'

export const PERIODS = ['hour', 'day', 'week', 'fortnight', 'month', 'year']

/**
 * Pay conversions. hoursPerWeek, daysPerWeek and weeksPerYear describe your working pattern (paid weeks).
 * Returns the gross amount per period.
 */
export function convertPay(amount, period, { hoursPerWeek = 40, daysPerWeek = 5, weeksPerYear = 52 }) {
  const perYear = { hour: hoursPerWeek * weeksPerYear, day: daysPerWeek * weeksPerYear, week: weeksPerYear, fortnight: weeksPerYear / 2, month: 12, year: 1 }
  const annual = amount * perYear[period]
  return { annual, hour: annual / (hoursPerWeek * weeksPerYear), day: annual / (daysPerWeek * weeksPerYear), week: annual / weeksPerYear, fortnight: annual / (weeksPerYear / 2), month: annual / 12, year: annual }
}

const LABEL = { hour: 'Hourly', day: 'Daily', week: 'Weekly', fortnight: 'Every 2 weeks', month: 'Monthly', year: 'Yearly' }
const CSS = `
.sc-tile-cur { outline: 2px solid color-mix(in srgb, var(--t) 55%, transparent); outline-offset: -2px; }
`

export function mount(root) {
  style('sc-style', CSS)
  let cur = 'INR'
  let period = 'month'
  let taxMode = 'flat'
  const curSel = currencyPicker((c) => { cur = c; prefix(); showTax(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const amount = num('I earn', { value: cur === 'INR' ? 60000 : 3500, min: 0, max: 1e12 })
  const periodSel = pick(PERIODS.map((p) => [p, `per ${p === 'fortnight' ? '2 weeks' : p}`]), period, (v) => { period = v; update() }, 'Pay period')
  const hours = num('Hours per week', { value: 40, min: 1, max: 168 })
  const days = num('Days per week', { value: 5, min: 1, max: 7 })
  const weeks = num('Paid weeks per year', { value: 52, min: 1, max: 53, hint: 'Take off unpaid leave if you have any' })
  const flat = num('Tax rate', { value: 15, min: 0, max: 80, suffix: '%', optional: true, hint: 'Your overall share of pay that goes to tax' })
  const deduct = num('Other deductions per month', { value: 0, min: 0, max: 1e11, optional: true, hint: 'Provident fund, insurance, loan repayments and similar' })
  const taxSw = switcher([['flat', 'Flat tax rate'], ['india', 'India new regime']], taxMode, (v) => { taxMode = v; showTax(); update() }, 'How to estimate tax')
  const taxBox = h('div', { class: 'cm-stack' })
  const hr = hero({ label: 'Take-home per month', tone: 'ocean', icon: 'wallet' })
  const t = tiles()
  const split = chartBox({ height: 240, ariaLabel: 'Where your pay goes' })

  function prefix() { for (const f of [amount, deduct]) f.setPrefix(sym()) }
  function showTax() {
    if (cur !== 'INR') taxMode = 'flat'
    taxSw.set(taxMode)
    taxBox.replaceChildren(...[cur === 'INR' ? taxSw : null, taxMode === 'flat' ? flat : note(`Uses the ${NEW_REGIME.label} slabs, the 75,000 standard deduction, the 87A rebate and 4% cess. Treat the number as a guide, not tax advice.`), deduct].filter(Boolean))
  }

  function update() {
    const bad = firstIssue(amount, hours, days, weeks, ...(taxMode === 'flat' ? [flat] : []), deduct)
    if (bad) { hr.empty(bad); t.set([]); return }
    const m = (x) => money(x, cur)
    const pay = convertPay(amount.val(), period, { hoursPerWeek: hours.val(), daysPerWeek: days.val(), weeksPerYear: weeks.val() })
    const annual = pay.annual
    const ded = deduct.val() * 12
    let tax
    if (taxMode === 'india') tax = newRegimeTax(Math.max(0, annual - NEW_REGIME.standardDeduction)).total
    else tax = (annual * flat.val()) / 100
    const net = Math.max(0, annual - tax - ded)
    const ratio = annual > 0 ? net / annual : 0
    hr.set({
      n: net / 12, fmt: m, label: 'Take-home per month', sub: `${m(annual / 12)} gross a month, ${fnum(annual > 0 ? (tax / annual) * 100 : 0, 1)}% of it goes to tax`,
      chips: [{ label: 'Take-home per year', value: m(net) }, { label: 'Tax per year', value: m(tax) }],
      bar: [{ label: 'Take-home', value: net, text: short(net, cur) }, { label: 'Tax', value: tax, text: short(tax, cur) }, ...(ded > 0 ? [{ label: 'Deductions', value: ded, text: short(ded, cur) }] : [])],
      copy: `Pay ${m(annual)} a year (${m(annual / 12)} a month). Estimated take-home ${m(net)} a year, ${m(net / 12)} a month`,
    })
    const mk = (p) => ({
      key: p, label: LABEL[p], n: pay[p], fmt: p === 'hour' || p === 'day' ? (v) => money(v, cur, 2) : m, tone: p === period ? 'violet' : 'indigo',
      icon: { hour: 'timer', day: 'sun', week: 'calendar-days', fortnight: 'calendar-range', month: 'calendar', year: 'calendar-check' }[p],
      hint: `Take-home ${p === 'hour' || p === 'day' ? money(annual > 0 ? (net * pay[p]) / annual : 0, cur, 2) : m(annual > 0 ? (net * pay[p]) / annual : 0)}`,
    })
    t.set(PERIODS.map(mk))
    for (const node of t.children) node.classList.toggle('sc-tile-cur', node.querySelector('.l').textContent === LABEL[period])
    split.render({
      type: 'doughnut', labels: ['Take-home', 'Tax', ...(ded > 0 ? ['Deductions'] : [])], datasets: [{ data: [net, tax, ...(ded > 0 ? [ded] : [])], colors: [3, 1, 2] }], format: m,
      center: { title: pct(ratio * 100, 0), caption: 'kept' },
    })
  }

  for (const f of [amount, hours, days, weeks, flat, deduct]) f.input.addEventListener('input', update)
  prefix()
  showTax()
  update()
  const inputs = card('Your pay', { icon: 'wallet', right: curSel },
    stack(h('div', { class: 'cm-grid2' }, amount, block('Per', periodSel)),
      block('Working pattern', h('div', { class: 'cm-grid3 keep' }, hours, days, weeks)),
      taxBox))
  shell(root, layout([inputs], [hr.el, card('Same pay, every way', { icon: 'repeat' }, t), note('Take-home is an estimate: it ignores allowances, bonuses, local levies and anything particular to your payslip.')], card('Where your pay goes', { icon: 'chart-pie' }, split)))
}
