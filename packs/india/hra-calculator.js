// HRA exemption calculator (old tax regime, section 10(13A)): the least of three amounts.
import { h, card, split, stack, segmented, alert, clear } from '../../lib/ui.js'
import { inr, hraExemption, hraRate, HRA_METROS, HRA_NEW_METROS, TAX_YEARS } from './_calc.js'
import { useStyles, liveHero, statTiles, numField, selectField, hero, kv, note, link } from './_shared.js'

const CITIES = [...HRA_METROS, ...HRA_NEW_METROS, 'Any other city']

export function mount(root) {
  useStyles()
  const per = segmented([['m', 'Monthly amounts'], ['y', 'Yearly amounts']], 'm', () => { relabel(); render() }, 'Amounts are per')
  const fy = selectField('Tax year', Object.entries(TAX_YEARS).map(([k, v]) => [k, v.label]), '2026-27', () => render())
  const basic = numField('Basic salary + DA (₹)', 50000, { min: 0, max: 1e9, step: 1000, money: true, hint: 'DA only if it counts for retirement benefits' })
  const hra = numField('HRA you get (₹)', 20000, { min: 0, max: 1e9, step: 500, money: true })
  const rent = numField('Rent you pay (₹)', 22000, { min: 0, max: 1e9, step: 500, money: true })
  const city = selectField('City you live in', CITIES, 'Bengaluru', () => render())
  const months = numField('Months rent paid this year', 12, { min: 1, max: 12, step: 1, integer: true, hint: 'Use less than 12 if you moved or changed jobs' })
  const slab = selectField('Your tax slab (old regime)', [['0', 'No tax'], ['5', '5%'], ['20', '20%'], ['30', '30%']], '30', () => render(), 'To estimate the tax you save')
  const top = hero('Tax-free HRA'), tiles = h('div'), rules = h('div'), msg = h('div'), tip = h('div')

  function relabel() {
    const m = per.value === 'm'
    months.el.hidden = !m
    for (const [f, base] of [[basic, 'Basic salary + DA'], [hra, 'HRA you get'], [rent, 'Rent you pay']]) f.el.querySelector('.field-label span').textContent = `${base} (₹ ${m ? 'a month' : 'a year'})`
  }

  function render() {
    const bad = [basic, hra, rent, months].map((x) => x.issue()).find(Boolean)
    clear(msg, bad ? alert('info', bad) : null)
    if (bad) { clear(tiles); clear(rules); return top.set('Tax-free HRA', '-', bad) }
    const k = per.value === 'm' ? months.get() : 1 // per-year inputs already cover the whole period
    const salary = basic.get() * k, got = hra.get() * k, paid = rent.get() * k
    const rate = hraRate(city.get(), fy.get())
    const r = hraExemption({ salary, hra: got, rent: paid, ratePct: rate })
    const metro = rate === 50
    const label = per.value === 'm' ? 'a month' : 'a year'
    const div = per.value === 'm' ? k : 1
    top.set('Tax-free HRA', inr(r.exempt), `${r.exempt ? `${inr(r.exempt / div)} ${label}. ` : ''}${r.taxable ? `${inr(r.taxable)} of your HRA is taxable.` : 'Your whole HRA is tax-free.'}`)
    clear(tiles, statTiles([
      { label: 'Exempt HRA', value: inr(r.exempt), accent: true, hint: per.value === 'm' ? `for ${k} months` : 'for the year' },
      { label: 'Taxable HRA', value: inr(r.taxable), hint: 'added to your income' },
      { label: 'City limit used', value: `${rate}%`, hint: metro ? 'metro rate' : 'non-metro rate' },
      { label: 'Tax saved (est.)', value: inr(r.exempt * (+slab.get() / 100) * 1.04), hint: `at ${slab.get()}% plus cess` },
    ]))
    const mark = (key) => (r.rule === key ? ' (least, so this applies)' : '')
    clear(rules, kv([
      { label: `1. HRA you actually get${mark('actual')}`, value: inr(r.actual), strong: r.rule === 'actual' },
      { label: `2. Rent paid minus 10% of salary${mark('rent')}`, value: inr(r.rentExcess), note: `${inr(paid)} - ${inr(salary * 0.1)}`, strong: r.rule === 'rent' },
      { label: `3. ${rate}% of salary${mark('city')}`, value: inr(r.cityLimit), note: `${rate}% for ${city.get()}`, strong: r.rule === 'city' },
      { label: 'Exempt HRA = the least of the three', value: inr(r.exempt), strong: true },
    ]))
    const out = []
    if (fy.get() === '2025-26' && HRA_NEW_METROS.includes(city.get())) out.push(alert('info', `${city.get()} is counted at 40% for FY 2025-26. From FY 2026-27 it gets the 50% metro rate.`))
    if (paid > 100000) out.push(alert('warn', 'Annual rent above ₹1,00,000: give your landlord\'s PAN to your employer, and say if the landlord is a relative.'))
    if (!paid) out.push(alert('info', 'No rent entered: HRA is fully taxable if you pay no rent.'))
    clear(tip, out)
  }
  for (const x of [basic, hra, rent, months]) x.input.addEventListener('input', render)

  root.append(split(
    card('Salary and rent', h('div', { class: 'stack' }, per, h('div', { class: 'grid-2' }, basic.el, hra.el, rent.el, months.el, city.el, fy.el), slab.el, msg,
      note('HRA exemption is for the old tax regime only; the new regime does not allow it. Rule: section 10(13A) of the old Act (renumbered in the Income-tax Act 2025). The 50% metro list grew from four cities to eight from FY 2026-27 under the new Income-tax Rules. See ', link('https://www.incometax.gov.in/', 'incometax.gov.in'), '. Check with your employer\'s payroll before relying on this.'))),
    stack(top, tiles, rules, tip), 'wide-left'))
  liveHero(top)
  relabel()
  render()
}
