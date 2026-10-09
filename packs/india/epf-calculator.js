// EPF calculator: balance at retirement from salary, contributions, EPFO interest and yearly raises.
import { h, card, panel, split, stack, table, button, alert, clear } from '../../lib/ui.js'
import { inr, lakhCrore, epfProject, EPF_RATE, EPF_WAGE_CEILING } from './_calc.js'
import { useStyles, statTiles, numField, selectField, hero, stackedChart, SERIES_COLORS, note, link, downloadCsv } from './_shared.js'

export function mount(root) {
  useStyles()
  const f = {
    age: numField('Your age', 30, { min: 18, max: 70, step: 1, integer: true }),
    retire: numField('Retirement age', 58, { min: 19, max: 75, step: 1, integer: true, hint: 'EPF pension (EPS) starts at 58' }),
    basic: numField('Monthly basic + DA (₹)', 40000, { min: 1000, max: 10_000_000, step: 1000, money: true }),
    balance: numField('Current EPF balance (₹)', 0, { min: 0, max: 1e10, step: 10000, money: true, hint: 'From your passbook at epfindia.gov.in' }),
    vpf: numField('Extra VPF (% of basic)', 0, { min: 0, max: 88, step: 1, hint: 'Voluntary PF on top of the 12%, earns the same interest' }),
    growth: numField('Yearly salary rise (%)', 6, { min: 0, max: 50, step: 0.5 }),
    rate: numField('EPF interest rate (% a year)', EPF_RATE, { min: 0, max: 15, step: 0.05, hint: '8.25% for 2025-26 (EPFO). 2026-27 rate not yet announced.' }),
  }
  const pct = selectField('Your contribution', [['12', '12% of basic (standard)'], ['10', '10% of basic (some employers)']], '12')
  const wage = selectField('PF is calculated on', [['actual', 'Actual basic + DA'], ['ceiling', 'Wage ceiling of ₹15,000 only']], 'actual', null, 'Many employers cap PF at ₹15,000 of wages, giving ₹1,800 a month each side')
  const top = hero('Estimated EPF balance')
  const tiles = h('div'), msg = h('div'), tableBox = h('div'), pension = h('div')
  const chart = stackedChart({ series: [{ label: 'Your contributions', fill: SERIES_COLORS[0] }, { label: 'Employer (EPF part)', fill: SERIES_COLORS[2] }, { label: 'Interest', fill: SERIES_COLORS[1] }], ariaLabel: 'EPF balance growth: your contributions, employer contributions and interest' })
  const csvBtn = button('Download CSV', { icon: 'download', size: 'sm' })
  let last

  function render() {
    const bad = Object.values(f).map((x) => x.issue()).find(Boolean) || (f.retire.get() <= f.age.get() ? 'Retirement age must be above your age' : '')
    clear(msg, bad ? alert('info', bad) : null)
    if (bad) return top.set('Estimated EPF balance', '-', 'Fix the highlighted field')
    const r = epfProject({
      age: f.age.get(), retireAge: f.retire.get(), basic: f.basic.get(), balance: f.balance.get(), employeePct: +pct.get(),
      vpfPct: f.vpf.get(), growth: f.growth.get(), rate: f.rate.get(), onCeiling: wage.get() === 'ceiling',
    })
    last = r
    top.set(`Estimated balance at ${f.retire.get()}`, inr(r.balance), `${lakhCrore(r.balance)} after ${r.years} years. Interest alone adds ${inr(r.interest)}.`)
    clear(tiles, statTiles([
      { label: 'Your contributions', value: inr(r.employee + r.opening), hint: r.opening ? 'including today\'s balance' : lakhCrore(r.employee) },
      { label: 'Employer (EPF part)', value: inr(r.employer), hint: '3.67% of wages, the rest goes to EPS' },
      { label: 'Interest earned', value: inr(r.interest), accent: true, hint: lakhCrore(r.interest) },
      { label: 'Sent to EPS pension', value: inr(r.eps), hint: '8.33% of up to ₹15,000 wages' },
    ]))
    clear(pension, r.pension ? alert('info', h('strong', 'Pension estimate. '), `With ${r.years} years of service, EPS pays about ${inr(r.pension)} a month from age 58 (wage capped at ₹15,000, formula: wage x service / 70).`)
      : alert('info', 'EPS pension needs at least 10 years of service.'))
    chart.update(r.rows.map((x) => ({ label: `Age ${x.age}`, short: String(x.age), parts: [x.cumEmployee, x.cumEmployer, x.cumInterest] })))
    clear(tableBox, table({
      columns: ['Age', { label: 'Basic a month', num: true }, { label: 'You', num: true }, { label: 'Employer', num: true }, { label: 'Interest', num: true }, { label: 'Balance', num: true }],
      rows: r.rows.map((x) => [x.age, inr(x.basic), inr(x.employee), inr(x.employer), inr(x.interest), inr(x.close)]),
    }))
  }
  for (const x of Object.values(f)) x.input.addEventListener('input', render)
  pct.select.addEventListener('change', render)
  wage.select.addEventListener('change', render)
  csvBtn.addEventListener('click', () => last && downloadCsv([['Age', 'Basic per month', 'Employee', 'Employer EPF', 'EPS', 'Interest', 'Closing balance'], ...last.rows.map((x) => [x.age, Math.round(x.basic), Math.round(x.employee), Math.round(x.employer), Math.round(x.eps), Math.round(x.interest), Math.round(x.close)])], 'epf-projection.csv'))

  root.append(stack(
    split(
      card('Your details', h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, f.age.el, f.retire.el, f.basic.el, f.balance.el, pct.el, f.vpf.el, f.growth.el, f.rate.el), wage.el, msg,
        note('You pay 12% of basic + DA. Your employer pays 12%, of which 8.33% (on up to ₹', EPF_WAGE_CEILING.toLocaleString('en-IN'), ' of wages) goes to the EPS pension and the rest, 3.67% when wages are at the ceiling, to your EPF. Interest is worked out monthly on the running balance and credited yearly, as EPFO does. Rate: EPFO board decision of March 2026, ratified by the government. See ', link('https://www.epfindia.gov.in/', 'epfindia.gov.in'), '. Interest on your own yearly contribution above ₹2.5 lakh is taxable.'))),
      stack(top, tiles, pension), 'wide-left'),
    card('Balance over the years', chart.el),
    panel(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Year-by-year'), csvBtn), tableBox)))
  render()
}
