// PPF calculator: 15-year maturity, optional 5-year extensions, with or without continued deposits.
import { h, card, panel, split, stack, table, segmented, toggle, button, alert, clear } from '../../lib/ui.js'
import { inr, lakhCrore, ppfProject, PPF_RATE, PPF_MAX, PPF_MIN } from './_calc.js'
import { useStyles, liveHero, statTiles, numField, selectField, hero, stackedChart, SERIES_COLORS, note, link, downloadCsv } from './_shared.js'

const MODES = [['lump', 'Whole year by 5 April (best)'], ['monthly', 'Monthly, by the 5th of each month'], ['end', 'Whole year on 31 March (worst)']]

export function mount(root) {
  useStyles()
  const yearly = numField('Yearly deposit (₹)', 150000, { min: PPF_MIN, max: PPF_MAX, step: 5000, money: true, hint: `Between ₹${PPF_MIN} and ₹1,50,000 a year` })
  const rate = numField('Interest rate (% a year)', PPF_RATE, { min: 1, max: 15, step: 0.1, hint: '7.1% for Oct-Dec 2026. The government resets it every quarter.' })
  const timing = selectField('When you deposit', MODES, 'lump', () => render(), 'Interest is paid on the lowest balance between the 5th and month end, so earlier is better')
  const ext = segmented([['0', '15 years'], ['1', '+5 years'], ['2', '+10 years'], ['3', '+15 years']], '0', () => render(), 'Extension')
  const extDeposit = toggle('Keep depositing during extensions', true, () => render())
  const top = hero('Maturity value')
  const tiles = h('div'), msg = h('div'), tableBox = h('div')
  const chart = stackedChart({ series: [{ label: 'You deposit', fill: SERIES_COLORS[0] }, { label: 'Interest', fill: SERIES_COLORS[1] }], ariaLabel: 'PPF balance each year: deposits and interest' })
  const csvBtn = button('Download CSV', { icon: 'download', size: 'sm' })
  let last

  function render() {
    const bad = yearly.issue() || rate.issue()
    clear(msg, bad ? alert('info', bad) : null)
    if (bad) return top.set('Maturity value', '-', 'Fix the highlighted field')
    const e = +ext.value
    const r = ppfProject({ yearly: yearly.get(), rate: rate.get(), mode: timing.get(), extension: e, extContribute: extDeposit.input.checked })
    last = r
    const n = 15 + e * 5
    top.set(`Maturity value after ${n} years`, inr(r.balance), `${lakhCrore(r.balance)}. All of it is tax-free: deposits, interest and maturity (EEE).`)
    clear(tiles, statTiles([{ label: 'You deposit', value: inr(r.invested), hint: lakhCrore(r.invested) }, { label: 'Interest earned', value: inr(r.interest), accent: true, hint: lakhCrore(r.interest) }, { label: 'Interest share', value: `${((r.interest / r.balance) * 100).toFixed(1)}%`, hint: 'of the maturity value' }, { label: 'Balance at year 15', value: inr(r.rows[14].close), hint: 'first maturity' }]))
    chart.update(r.rows.map((x) => ({ label: `Year ${x.year}`, short: String(x.year), parts: [x.invested, x.gains] })))
    clear(tableBox, table({ columns: ['Year', { label: 'Opening', num: true }, { label: 'Deposit', num: true }, { label: 'Interest', num: true }, { label: 'Closing', num: true }], rows: r.rows.map((x) => [x.year, inr(x.open), inr(x.deposit), inr(x.interest), inr(x.close)]) }))
  }
  yearly.input.addEventListener('input', render)
  rate.input.addEventListener('input', render)
  csvBtn.addEventListener('click', () => last && downloadCsv([['Year', 'Opening', 'Deposit', 'Interest', 'Closing'], ...last.rows.map((x) => [x.year, Math.round(x.open), Math.round(x.deposit), Math.round(x.interest), Math.round(x.close)])], 'ppf-schedule.csv'))

  root.append(stack(
    split(
      card('Your PPF', h('div', { class: 'stack' }, yearly.el, rate.el, timing.el, h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', 'Tenure')), ext), extDeposit, msg,
        note('Assumes today\'s rate stays the same for the whole term. In practice it changes quarterly, so treat the result as an estimate. Interest is added at the end of each financial year. Rate source: ', link('https://www.nsiindia.gov.in/', 'National Savings Institute'), ' and the Finance Ministry quarterly notice.'))),
      stack(top, tiles), 'wide-left'),
    card('Balance over the years', chart.el),
    panel(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Year-by-year'), csvBtn), tableBox)))
  liveHero(top)
  render()
}
