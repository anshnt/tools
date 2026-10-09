// Income tax calculator (India): new vs old regime side by side, with rebate, marginal relief, surcharge and cess.
// Rules: Income-tax Act 2025 (from 1 April 2026) and Budget 2026, which kept the slabs, the 75,000 standard deduction and the 60,000 rebate (income up to 12 lakh).
// Official source: https://www.incometax.gov.in/ . Special-rate income (capital gains, lottery) and non-residents are not covered.
import { h, panel, stack, toggle, alert, table, copyButton, clear } from '../../lib/ui.js'
import { inr, pct, computeRegime, hraExemption, hraRate, TAX_YEARS, HRA_METROS, HRA_NEW_METROS } from './_calc.js'
import { useStyles, liveBar, numField, selectField, details, kv, note, link, statTiles } from './_shared.js'

const AGES = [['under60', 'Below 60'], ['senior', '60 to 79 (senior)'], ['super', '80 or above']]
const CITIES = [...HRA_METROS, ...HRA_NEW_METROS, 'Any other city']

export function mount(root) {
  useStyles()
  const fy = selectField('Tax year', Object.entries(TAX_YEARS).map(([k, v]) => [k, v.label]), '2026-27', () => render())
  const age = selectField('Age', AGES, 'under60', () => render())
  const salaried = toggle('Salaried or pensioner (standard deduction)', true, () => render())
  const govt = toggle('Central or state government employee', false, () => render())
  const f = {
    salary: numField('Gross salary a year (₹)', 1500000, { money: true, step: 50000, max: 1e10 }),
    basic: numField('Basic + DA a year (₹)', 750000, { money: true, step: 10000, max: 1e10, hint: 'For the employer NPS limit and HRA' }),
    other: numField('Other income a year (₹)', 0, { money: true, step: 5000, max: 1e10, hint: 'Interest, rent after 30%, business profit' }),
    nps: numField('Employer NPS contribution a year (₹)', 0, { money: true, step: 5000, max: 1e10, hint: 'Counts in both regimes: up to 14% (new) or 10% (old) of basic' }),
    c80: numField('80C a year (₹)', 150000, { money: true, step: 5000, max: 1e8, hint: 'PF, ELSS, LIC, PPF, tuition. Limit ₹1.5 lakh' }),
    nps1b: numField('NPS self, 80CCD(1B) (₹)', 0, { money: true, step: 5000, max: 1e8, hint: 'Limit ₹50,000' }),
    d80self: numField('Health insurance, self + family (₹)', 25000, { money: true, step: 1000, max: 1e8, hint: 'Limit ₹25,000 (₹50,000 if 60+)' }),
    d80parents: numField('Health insurance, parents (₹)', 0, { money: true, step: 1000, max: 1e8, hint: 'Limit ₹25,000 (₹50,000 if they are 60+)' }),
    homeLoan: numField('Home loan interest (₹)', 0, { money: true, step: 5000, max: 1e8, hint: 'Self-occupied, limit ₹2 lakh' }),
    e80: numField('Education loan interest, 80E (₹)', 0, { money: true, step: 1000, max: 1e8 }),
    otherDed: numField('Other deductions (₹)', 0, { money: true, step: 1000, max: 1e8, hint: '80TTA/TTB, 80G donations, 80U ...' }),
    lta: numField('LTA exemption (₹)', 0, { money: true, step: 1000, max: 1e8, hint: 'Actual travel cost within the rules' }),
    profTax: numField('Professional tax (₹)', 2400, { money: true, step: 100, max: 2500 }),
    hra: numField('HRA you get a year (₹)', 0, { money: true, step: 5000, max: 1e9 }),
    rent: numField('Rent you pay a year (₹)', 0, { money: true, step: 5000, max: 1e9 }),
  }
  const parentsSenior = toggle('My parents are 60 or above', false, () => render())
  const city = selectField('City for HRA', CITIES, 'Bengaluru', () => render())
  const hraOut = h('small', { class: 'field-hint' })
  const compare = h('div', { class: 'stack' })
  let summaryText = ''
  let live = null
  const copy = copyButton(() => summaryText, 'Copy summary')

  const issues = () => (Number.isFinite(f.salary.get()) ? '' : 'Enter your gross salary (0 is fine if you have none)')

  function inputs() {
    const v = (x) => f[x].val(0)
    const exempt = hraExemption({ salary: v('basic'), hra: v('hra'), rent: v('rent'), ratePct: hraRate(city.get(), fy.get()) }).exempt
    hraOut.textContent = v('hra') || v('rent') ? `HRA exemption worked out: ${inr(exempt)} (${hraRate(city.get(), fy.get())}% city limit)` : 'Fill HRA and rent to claim HRA'
    return {
      fy: fy.get(), age: age.get(), salaried: salaried.input.checked, govt: govt.input.checked, salary: v('salary'), other: v('other'), basic: v('basic'),
      hra: exempt, lta: v('lta'), profTax: v('profTax'), employerNps: v('nps'), c80: v('c80'), d80self: v('d80self'), d80parents: v('d80parents'),
      parentsSenior: parentsSenior.input.checked, nps1b: v('nps1b'), homeLoan: v('homeLoan'), e80: v('e80'), otherDed: v('otherDed'),
    }
  }

  function regimeCard(r, best) {
    const kvRows = [
      ...r.lines.map((l) => ({ label: l.label, value: inr(l.value), note: l.note, strong: l.strong, neg: l.value < 0 })),
      { label: 'Tax on slabs', value: inr(r.taxBefore) },
      ...(r.rebate ? [{ label: 'Rebate (section 87A, now 156)', value: inr(-r.rebate), neg: true }] : []),
      ...(r.relief ? [{ label: 'Marginal relief on the rebate', value: inr(-r.relief), neg: true, note: 'Tax is limited to the income above ₹12 lakh' }] : []),
      ...(r.surcharge ? [{ label: 'Surcharge', value: inr(r.surcharge), note: r.regime === 'new' ? 'Capped at 25% in the new regime' : 'With marginal relief' }] : []),
      { label: 'Health and education cess (4%)', value: inr(r.cess) },
      { label: 'Total tax', value: inr(r.total), strong: true },
    ]
    const slabRows = r.slabs.filter((s) => s.amount > 0).map((s) => [`${inr(s.from)} to ${Number.isFinite(s.to) ? inr(s.to) : 'above'}`, pct(s.rate * 100, 0), inr(s.amount), inr(s.tax)])
    return panel(h('div', { class: 'stack' },
      h('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start' },
        h('div', h('h2', { style: 'margin:0' }, r.regime === 'new' ? 'New regime' : 'Old regime'), h('div', { class: 'small muted' }, r.regime === 'new' ? 'Section 202, default regime' : 'With deductions and exemptions')),
        best ? h('span', { class: 'badge', style: 'background:var(--success-soft);color:var(--success);padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600' }, 'Lower tax') : null),
      statTiles([{ label: 'Total tax', value: inr(r.total), accent: best, hint: `${pct(r.effective, 1)} of gross income` }, { label: 'Monthly TDS (approx.)', value: inr(r.monthly), hint: 'a month' }]),
      kv(kvRows),
      slabRows.length ? details('Slab-wise tax', table({ columns: ['Slab', { label: 'Rate', num: true }, { label: 'Income in slab', num: true }, { label: 'Tax', num: true }], rows: slabRows })) : null))
  }

  function render() {
    const bad = issues()
    if (bad) { clear(compare, alert('info', bad)); return }
    const i = inputs()
    const rn = computeRegime('new', i), ro = computeRegime('old', i)
    const diff = Math.abs(ro.total - rn.total)
    const winner = rn.total === ro.total ? 'tie' : rn.total < ro.total ? 'new' : 'old'
    const banner = winner === 'tie'
      ? alert('info', h('strong', 'Both regimes give the same tax: '), inr(rn.total))
      : alert('success', h('strong', `${winner === 'new' ? 'New' : 'Old'} regime saves you ${inr(diff)} a year. `),
        `${winner === 'new' ? 'New' : 'Old'} regime tax is ${inr(Math.min(rn.total, ro.total))} against ${inr(Math.max(rn.total, ro.total))}.`)
    live = winner === 'tie' ? { label: 'Tax in either regime', value: inr(rn.total) } : { label: `${winner === 'new' ? 'New' : 'Old'} regime saves you`, value: inr(diff) }
    clear(compare, banner, h('div', { class: 'grid-2' }, regimeCard(rn, winner === 'new'), regimeCard(ro, winner === 'old')))
    summaryText = [`Income tax, ${TAX_YEARS[fy.get()].label}`, `Gross salary ${inr(i.salary)}, other income ${inr(i.other)}`, `New regime: taxable ${inr(rn.taxable)}, tax ${inr(rn.total)}`, `Old regime: taxable ${inr(ro.taxable)}, tax ${inr(ro.total)}`, winner === 'tie' ? 'Same tax in both.' : `${winner === 'new' ? 'New' : 'Old'} regime saves ${inr(diff)}.`].join('\n')
  }
  for (const x of Object.values(f)) x.input.addEventListener('input', render)

  root.append(stack(
    panel(h('div', { class: 'stack' },
      h('h2', { style: 'margin:0' }, 'Your income'),
      h('div', { class: 'grid-2' }, fy.el, age.el),
      h('div', { class: 'stack', style: 'gap:8px' }, salaried, govt),
      h('div', { class: 'grid-2' }, f.salary.el, f.basic.el, f.other.el, f.nps.el),
      details('Old regime: deductions and exemptions', [
        h('div', { class: 'grid-2' }, f.c80.el, f.nps1b.el, f.d80self.el, f.d80parents.el, f.homeLoan.el, f.e80.el, f.otherDed.el, f.lta.el, f.profTax.el),
        parentsSenior,
        h('div', { class: 'grid-2' }, f.hra.el, f.rent.el, city.el),
        hraOut,
      ]),
      h('div', { class: 'row' }, copy))),
    compare,
    note('Rules used: slabs of ₹4, 8, 12, 16, 20 and 24 lakh at 5% to 30% in the new regime, standard deduction ₹75,000, rebate up to ₹60,000 when taxable income is ₹12 lakh or less with marginal relief just above it, surcharge from ₹50 lakh with marginal relief, 4% cess. Old regime: ₹2.5 / 5 / 10 lakh slabs (higher exemption for senior citizens), ₹50,000 standard deduction, rebate up to ₹12,500 when taxable income is ₹5 lakh or less. Budget 2026 left these unchanged and the Income-tax Act 2025 applies from 1 April 2026 with new section numbers. Source: ', link('https://www.incometax.gov.in/', 'incometax.gov.in'), '. Assumes a resident individual; capital gains taxed at special rates and non-resident rules are not included. This is an estimate, not tax advice.')))
  liveBar(compare, () => live)
  render()
}
