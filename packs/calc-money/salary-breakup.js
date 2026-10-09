// Salary breakup: Indian CTC to monthly in-hand, with PF, gratuity, professional tax and an estimate of income tax under the new regime.
import { h, table, toggle } from '../../lib/ui.js'
import { shell, num, slide, hero, tiles, card, layout, note, pills, pick, chartBox, money, short, fnum, pct, firstIssue, stack, block, style } from './_shared.js'
import { ctcBreakup, PT_STATES, NEW_REGIME } from './_math.js'

const CSS = `
.sb-sec { font-size: 11.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.sb-tot { font-weight: 700; color: var(--text); }
.sb-table .table td, .sb-table .table th { padding: 10px 14px; }
.sb-est { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .06em; padding: 2px 9px; border-radius: 99px; background: rgba(255, 255, 255, .18); border: 1px solid rgba(255, 255, 255, .3); }
`

export function mount(root) {
  style('sb-style', CSS)
  const rupee = '₹'
  let hraPct = 50
  let pfCap = true
  const ctc = num('Annual CTC', { value: 1200000, min: 1, max: 1e10, prefix: rupee })
  const basic = slide('Basic salary (share of CTC)', { min: 20, max: 60, step: 1, value: 40, suffix: '%', tickFormat: (v) => `${v}%`, onInput: () => update() })
  const hra = pills([[50, 'Metro: 50% of basic'], [40, 'Other: 40% of basic'], [0, 'No HRA']], hraPct, (v) => { hraPct = v; update() }, 'HRA')
  const pfTog = toggle('Employer PF (12%) is inside my CTC', true, () => update())
  const pfWage = pills([[true, 'PF on a capped wage (15,000 a month)'], [false, 'PF on my full basic']], pfCap, (v) => { pfCap = v; update() }, 'PF wage')
  const gratTog = toggle('Gratuity is inside my CTC', true, () => update())
  const insurance = num('Employer-paid insurance (per year)', { value: 0, min: 0, max: 1e9, optional: true, prefix: rupee, hint: 'Group health or life cover that is part of CTC' })
  const ptSel = pick([...Object.entries(PT_STATES).map(([k, v]) => [k, v.label]), ['custom', 'Another state (enter yearly amount)']], 'none', () => { ptCustom.hidden = ptSel.value !== 'custom'; update() }, 'State for professional tax')
  const ptCustom = num('Professional tax per year', { value: 2400, min: 0, max: 2500, prefix: rupee, hint: 'The most any state can charge is 2,500 a year' })
  ptCustom.hidden = true

  const hr = hero({ label: 'Monthly in-hand', tone: 'mint', icon: 'wallet' })
  const t = tiles()
  const donut = chartBox({ height: 280, ariaLabel: 'Where your CTC goes' })
  const tableHost = h('div', { class: 'sb-table cm-flat' })
  const warn = h('div')

  function update() {
    ctc.setHint(Number.isFinite(ctc.val()) ? short(ctc.val(), 'INR') : '')
    const bad = firstIssue(ctc, insurance, ...(ptSel.value === 'custom' ? [ptCustom] : []))
    if (bad) return fail(bad)
    const r = ctcBreakup({
      ctc: ctc.val(), basicPct: basic.val(), hraPct, pfCap, employerPf: pfTog.input.checked, gratuity: gratTog.input.checked, insurance: insurance.val(),
      ptState: ptSel.value, ptCustom: ptCustom.val(),
    })
    const m = (x) => money(x, 'INR')
    if (r.negativeSpecial) return fail('Basic and HRA add up to more than the fixed pay after PF and gratuity. Lower the Basic percentage or HRA.')
    const monthly = (x) => x / 12
    hr.set({
      n: monthly(r.net), fmt: m, label: 'Monthly in-hand (estimate)',
      sub: `On a CTC of ${m(r.ctc)} (${short(r.ctc, 'INR')}) a year, after PF, professional tax and income tax`,
      chips: [{ label: 'Gross salary per month', value: m(monthly(r.gross)) }, { label: 'Income tax per month (TDS)', value: m(monthly(r.tax.total)) }],
      copy: `CTC ${m(r.ctc)}: estimated monthly in-hand ${m(monthly(r.net))} (gross ${m(monthly(r.gross))}, tax ${m(monthly(r.tax.total))}, PF ${m(monthly(r.employeePf))})`,
    })
    warn.replaceChildren()
    t.set([
      { label: 'In-hand per year', n: r.net, fmt: m, tone: 'green', icon: 'wallet', hint: `${fnum((r.net / r.ctc) * 100, 1)}% of your CTC` },
      { label: 'Income tax per year', n: r.tax.total, fmt: m, tone: 'orange', icon: 'landmark', hint: r.tax.total === 0 ? 'Nil after the 87A rebate' : `${fnum(r.taxable > 0 ? (r.tax.total / r.taxable) * 100 : 0, 1)}% of taxable income` },
      { label: 'Taxable income', n: r.taxable, fmt: m, tone: 'indigo', icon: 'receipt', hint: `after the ${m(NEW_REGIME.standardDeduction)} standard deduction` },
    ])
    const rows = [
      [h('span', { class: 'sb-sec' }, 'Earnings'), '', ''],
      ['Basic salary', m(monthly(r.basic)), m(r.basic)],
      ['House rent allowance (HRA)', m(monthly(r.hra)), m(r.hra)],
      ['Special allowance', m(monthly(r.special)), m(r.special)],
      [h('b', { class: 'sb-tot' }, 'Gross salary'), h('b', { class: 'sb-tot' }, m(monthly(r.gross))), h('b', { class: 'sb-tot' }, m(r.gross))],
      [h('span', { class: 'sb-sec' }, 'Paid by your employer, inside CTC'), '', ''],
      ...(r.employerPf > 0 ? [['Employer PF', m(monthly(r.employerPf)), m(r.employerPf)]] : []),
      ...(r.gratuity > 0 ? [['Gratuity (accrued)', m(monthly(r.gratuity)), m(r.gratuity)]] : []),
      ...(r.insurance > 0 ? [['Insurance', m(monthly(r.insurance)), m(r.insurance)]] : []),
      [h('b', { class: 'sb-tot' }, 'Total CTC'), h('b', { class: 'sb-tot' }, m(monthly(r.ctc))), h('b', { class: 'sb-tot' }, m(r.ctc))],
      [h('span', { class: 'sb-sec' }, 'Deducted from your pay'), '', ''],
      ...(r.employeePf > 0 ? [['Employee PF', `-${m(monthly(r.employeePf))}`, `-${m(r.employeePf)}`]] : []),
      ['Professional tax', `-${m(monthly(r.professionalTax))}`, `-${m(r.professionalTax)}`],
      ['Income tax (estimated TDS)', `-${m(monthly(r.tax.total))}`, `-${m(r.tax.total)}`],
      [h('b', { class: 'sb-tot' }, 'In-hand salary'), h('b', { class: 'sb-tot' }, m(monthly(r.net))), h('b', { class: 'sb-tot' }, m(r.net))],
    ]
    tableHost.replaceChildren(table({ columns: ['Component', { label: 'Per month', num: true }, { label: 'Per year', num: true }], rows }))
    const parts = [['In-hand', r.net, 3], ['Income tax', r.tax.total, 1], ['Employee PF', r.employeePf, 0], ['Professional tax', r.professionalTax, 4], ['Employer PF', r.employerPf, 2], ['Gratuity', r.gratuity, 5], ['Insurance', r.insurance, 6]].filter((p) => p[1] > 0)
    donut.render({
      type: 'doughnut', labels: parts.map((p) => p[0]), datasets: [{ data: parts.map((p) => p[1]), colors: parts.map((p) => p[2]) }], format: m,
      center: { title: pct((r.net / r.ctc) * 100, 0), caption: 'of CTC in hand' },
    })
  }
  function fail(msg) { hr.empty(msg); t.set([]); tableHost.replaceChildren(); warn.replaceChildren() }

  ctc.input.addEventListener('input', update)
  insurance.input.addEventListener('input', update)
  ptCustom.input.addEventListener('input', update)
  update()
  const inputs = card('Your offer', { icon: 'briefcase' },
    stack(ctc, basic, block('HRA', hra), block('Provident fund', stack(pfTog, pfWage)), gratTog, insurance, block('Professional tax', stack(ptSel, ptCustom))))
  shell(root, layout([inputs],
    [hr.el, t, warn, note('This is an estimate to compare offers, not payroll. It uses the new tax regime for FY 2026-27 (standard deduction, 87A rebate and 4% cess) and ignores HRA exemption, NPS, bonuses, arrears and employer-specific rules. Your actual payslip will differ.')],
    stack(card('Component by component', { icon: 'table' }, tableHost), card('Where your CTC goes', { icon: 'chart-pie' }, donut))))
}
