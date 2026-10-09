// Loan calculator: find the payment, how much you can borrow, or how long it takes to pay off - with extra payments and savings.
// params.find sets the starting mode: 'payment' (default), 'amount' (loan-affordability) or 'term'.
import { h, table } from '../../lib/ui.js'
import { shell, num, slide, hero, tiles, card, layout, note, switcher, pills, currencyPicker, chartBox, money, short, fnum, pct, firstIssue, stack, grid2, monthsLabel, style } from './_shared.js'
import { amortize, yearly, loanFromPayment, periodsToPayOff } from './_math.js'

const FREQ = { 12: ['Monthly', 'month', 'Monthly payment'], 26: ['Bi-weekly', 'two weeks', 'Bi-weekly payment'], 52: ['Weekly', 'week', 'Weekly payment'] }

const CSS = `
.ln-yearly .table-wrap { max-height: 360px; }
`

export function mount(root, { params }) {
  style('ln-style', CSS)
  const locked = !!params?.find
  let find = params?.find || 'payment'
  let ppy = 12
  let cur = 'INR'
  const curSel = currencyPicker((c) => { cur = c; prefix(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')

  const findSw = switcher([['payment', 'Payment', 'banknote'], ['amount', 'How much can I borrow', 'wallet'], ['term', 'Time to pay off', 'timer']], find, (v) => { find = v; showFind(); update() }, 'What to find')
  const amount = num('Loan amount', { value: cur === 'INR' ? 1000000 : 20000, min: 1, max: 1e11 })
  const afford = num('Payment you can afford', { value: cur === 'INR' ? 15000 : 400, min: 1, max: 1e10, hint: 'Per payment, in the frequency chosen below' })
  const rate = slide('Interest rate (per year)', { min: 0.5, max: 30, step: 0.05, value: 9, hardMin: 0, hardMax: 100, suffix: '%', tickFormat: (v) => `${v}%`, onInput: () => update() })
  const years = num('Years', { value: 5, min: 0, max: 50, int: true, optional: true, suffix: 'yr' })
  const months = num('Months', { value: 0, min: 0, max: 600, int: true, optional: true, suffix: 'mo' })
  const termBox = grid2(years, months)
  const freq = pills(Object.entries(FREQ).map(([k, v]) => [Number(k), v[0]]), ppy, (v) => { ppy = v; update() }, 'Payment frequency')
  const fee = num('Upfront fee (optional)', { value: 0, min: 0, max: 50, suffix: '%', optional: true, hint: 'Processing or origination fee as a share of the loan' })
  const extra = num('Extra with every payment', { value: 0, min: 0, max: 1e10, optional: true, hint: 'Paid on top of the regular payment' })
  const lump = num('One-time extra payment', { value: 0, min: 0, max: 1e11, optional: true })
  const lumpAt = num('Paid with payment number', { value: 1, min: 1, max: 5000, int: true })
  const extraBox = h('details', { class: 'cm-details' }, h('summary', 'Extra payments (optional)'), h('div', { class: 'cm-details-body' }, stack(extra, grid2(lump, lumpAt))))

  const hr = hero({ label: 'Payment', tone: 'ocean', icon: 'banknote' })
  const t = tiles()
  const donut = chartBox({ height: 240, ariaLabel: 'Where the money goes' })
  const balance = chartBox({ height: 240, ariaLabel: 'Balance over time' })
  const yearlyHost = h('div', { class: 'ln-yearly' })
  const left = stack()
  function showFind() {
    left.replaceChildren(...[locked ? null : findSw, find === 'amount' ? afford : amount, rate, find === 'term' ? afford : null, find === 'term' ? null : block2('Loan term', termBox), block2('Payment frequency', freq), find === 'payment' ? fee : null].filter(Boolean))
    extraBox.hidden = find !== 'payment'
    const lbl = find === 'term' ? 'Payment you will make' : 'Payment you can afford'
    afford.setLabel(lbl)
  }
  function block2(label, node) { return h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', label)), node) }
  function prefix() { for (const f of [amount, afford, extra, lump]) f.setPrefix(sym()) }

  function update() {
    const m = (x) => money(x, cur)
    const [fname, unit, pname] = FREQ[ppy]
    const fields = find === 'payment' ? [amount, rate, fee, extra, lump, lumpAt] : find === 'amount' ? [afford, rate] : [amount, rate, afford]
    const bad = firstIssue(...fields)
    const nPeriods = Math.round(((years.val() || 0) + (months.val() || 0) / 12) * ppy)
    if (bad) return fail(bad)
    if (find !== 'term' && !(nPeriods >= 1)) return fail('Loan term: enter at least one month')
    const r = rate.val()

    if (find === 'amount') {
      const P = loanFromPayment(afford.val(), r, nPeriods, ppy)
      const totalPaid = afford.val() * nPeriods
      hr.set({
        n: P, fmt: m, label: 'You can borrow', sub: `${m(afford.val())} per ${unit} for ${monthsLabel((nPeriods / ppy) * 12)} at ${fnum(r, 2)}%`,
        chips: [{ label: 'Total interest', value: m(totalPaid - P) }, { label: 'Total you repay', value: m(totalPaid) }],
        bar: [{ label: 'Loan', value: P, text: short(P, cur) }, { label: 'Interest', value: totalPaid - P, text: short(totalPaid - P, cur) }],
        copy: `A payment of ${m(afford.val())} per ${unit} for ${monthsLabel((nPeriods / ppy) * 12)} at ${fnum(r, 2)}% supports a loan of ${m(P)}`,
      })
      t.set([
        { label: 'Loan amount', n: P, fmt: m, tone: 'indigo', icon: 'wallet' },
        { label: 'Total interest', n: totalPaid - P, fmt: m, tone: 'orange', icon: 'percent' },
        { label: 'Number of payments', value: fnum(nPeriods, 0), tone: 'teal', icon: 'calendar-check', hint: `one every ${unit}` },
      ])
      donut.render({ type: 'doughnut', labels: ['Loan', 'Interest'], datasets: [{ data: [P, totalPaid - P], colors: [0, 1] }], format: m, center: { title: pct((totalPaid - P) / totalPaid * 100, 1), caption: 'is interest' } })
      const res = amortize({ principal: P, ratePct: r, n: nPeriods, ppy })
      return charts(res, null, P, ppy)
    }

    if (find === 'term') {
      const P = amount.val()
      const pay = afford.val()
      const cnt = periodsToPayOff(P, r, pay, ppy)
      if (!Number.isFinite(cnt)) return fail(`A payment of ${m(pay)} does not even cover the interest (${m((P * r) / 100 / ppy)} per ${unit}). Raise the payment or lower the rate.`)
      const res = amortize({ principal: P, ratePct: r, n: Math.ceil(cnt), payment: pay, ppy })
      const mo = (res.periods / ppy) * 12
      hr.set({
        n: mo, fmt: (v) => monthsLabel(v), label: 'Time to pay off', sub: `${fnum(res.periods, 0)} payments of ${m(pay)} (the last one is a little smaller)`,
        chips: [{ label: 'Total interest', value: m(res.totalInterest) }, { label: 'Total you repay', value: m(res.totalPaid) }],
        bar: [{ label: 'Loan', value: P, text: short(P, cur) }, { label: 'Interest', value: res.totalInterest, text: short(res.totalInterest, cur) }],
        copy: `Paying ${m(pay)} per ${unit} clears ${m(P)} at ${fnum(r, 2)}% in ${monthsLabel(mo)}, with ${m(res.totalInterest)} interest`,
      })
      t.set([
        { label: 'Loan amount', n: P, fmt: m, tone: 'indigo', icon: 'wallet' },
        { label: 'Total interest', n: res.totalInterest, fmt: m, tone: 'orange', icon: 'percent' },
        { label: 'Total you repay', n: res.totalPaid, fmt: m, tone: 'pink', icon: 'receipt' },
        { label: 'Number of payments', value: fnum(res.periods, 0), tone: 'teal', icon: 'calendar-check' },
      ])
      donut.render({ type: 'doughnut', labels: ['Loan', 'Interest'], datasets: [{ data: [P, res.totalInterest], colors: [0, 1] }], format: m, center: { title: pct((res.totalInterest / res.totalPaid) * 100, 1), caption: 'is interest' } })
      return charts(res, null, P, ppy)
    }

    // find the payment
    const P = amount.val()
    const feeAbs = (P * fee.val()) / 100
    const base = amortize({ principal: P, ratePct: r, n: nPeriods, ppy })
    const hasExtra = extra.val() > 0 || lump.val() > 0
    if (lump.val() > 0 && lumpAt.val() > nPeriods) return fail(`The one-time payment must be within payment numbers 1 to ${nPeriods}`)
    const withExtra = hasExtra ? amortize({ principal: P, ratePct: r, n: nPeriods, ppy, extra: extra.val(), lump: lump.val(), lumpAt: lumpAt.val() }) : base
    const cost = withExtra.totalInterest + feeAbs
    hr.set({
      n: base.emi, fmt: m, label: pname,
      sub: `${m(P)} at ${fnum(r, 2)}% for ${monthsLabel((nPeriods / ppy) * 12)}`,
      chips: [{ label: 'Total interest', value: m(base.totalInterest) }, { label: 'Total you repay', value: m(base.totalPaid + feeAbs) }],
      bar: [{ label: 'Loan', value: P, text: short(P, cur) }, { label: 'Interest', value: base.totalInterest, text: short(base.totalInterest, cur) }, ...(feeAbs > 0 ? [{ label: 'Fee', value: feeAbs, text: short(feeAbs, cur) }] : [])],
      copy: `${pname}: ${m(base.emi)} for ${m(P)} at ${fnum(r, 2)}% over ${monthsLabel((nPeriods / ppy) * 12)}. Total interest ${m(base.totalInterest)}`,
    })
    const tl = [
      { label: 'Loan amount', n: P, fmt: m, tone: 'indigo', icon: 'wallet' },
      { label: 'Total interest', n: base.totalInterest, fmt: m, tone: 'orange', icon: 'percent' },
      { label: 'Total you repay', n: base.totalPaid + feeAbs, fmt: m, tone: 'pink', icon: 'receipt', hint: feeAbs > 0 ? `includes a ${m(feeAbs)} fee` : undefined },
      { label: 'Number of payments', value: fnum(base.periods, 0), tone: 'teal', icon: 'calendar-check' },
    ]
    if (hasExtra) {
      const saved = base.totalInterest - withExtra.totalInterest
      tl.splice(0, tl.length,
        { label: 'Interest saved', n: saved, fmt: m, tone: 'green', icon: 'piggy-bank', hint: `${fnum(base.totalInterest > 0 ? (saved / base.totalInterest) * 100 : 0, 1)}% less interest` },
        { label: 'Paid off sooner by', value: monthsLabel(((base.periods - withExtra.periods) / ppy) * 12) || '0 mo', tone: 'green', icon: 'timer', hint: `${fnum(withExtra.periods, 0)} payments instead of ${fnum(base.periods, 0)}` },
        { label: 'Total cost with extras', n: cost, fmt: m, tone: 'pink', icon: 'receipt', hint: `interest${feeAbs > 0 ? ' and fee' : ''}` },
        { label: 'Total interest now', n: withExtra.totalInterest, fmt: m, tone: 'orange', icon: 'percent', hint: `was ${m(base.totalInterest)}` })
    }
    t.set(tl)
    donut.render({
      type: 'doughnut', labels: ['Loan', 'Interest', ...(feeAbs > 0 ? ['Fee'] : [])], datasets: [{ data: [P, withExtra.totalInterest, ...(feeAbs > 0 ? [feeAbs] : [])], colors: [0, 1, 2] }], format: m,
      center: { title: pct((cost / (P + cost)) * 100, 1), caption: 'is cost' },
    })
    charts(withExtra, hasExtra ? base : null, P, ppy)
  }

  function charts(res, baseline, P, perYear) {
    const m = (x) => money(x, cur)
    const total = baseline ? Math.max(baseline.periods, res.periods) : res.periods
    const step = Math.max(1, Math.round(total / 24))
    const pts = []
    for (let k = 0; k <= total; k += step) pts.push(k)
    if (pts.at(-1) !== total) pts.push(total)
    const bal = (rr, k) => (k === 0 ? P : rr.rows[k - 1] ? rr.rows[k - 1].balance : 0)
    const label = (k) => (k === 0 ? 'Start' : perYear === 12 ? `M${k}` : `P${k}`)
    balance.render({
      type: 'line', labels: pts.map((k) => (k !== 0 && k % perYear === 0 ? `Yr ${k / perYear}` : label(k))),
      datasets: [{ label: baseline ? 'With extra payments' : 'Balance', data: pts.map((k) => bal(res, k)), color: 0 }, ...(baseline ? [{ label: 'Without extras', data: pts.map((k) => bal(baseline, k)), color: 1, fill: false }] : [])],
      format: m, axisFormat: (v) => short(v, cur),
    })
    const yrs = yearly(res.rows, perYear)
    yearlyHost.replaceChildren(table({
      columns: ['Year', { label: 'Paid', num: true }, { label: 'Principal', num: true }, { label: 'Interest', num: true }, { label: 'Balance', num: true }],
      rows: yrs.map((y) => [`Year ${y.year}`, m(y.payment + y.prepay), m(y.principal + y.prepay), m(y.interest), m(y.balance)]),
    }))
  }

  function fail(msg) { hr.empty(msg); t.set([]); yearlyHost.replaceChildren() }

  for (const f of [amount, afford, years, months, fee, extra, lump, lumpAt]) f.input.addEventListener('input', update)
  prefix()
  showFind()
  update()
  const inputs = card('Loan details', { icon: 'sliders-horizontal', right: curSel }, left)
  shell(root, layout([inputs, extraBox], [hr.el, t, note('Interest is worked out on the reducing balance, the way most lenders do. Fees, insurance and late charges set by your lender are not included unless you enter them.')],
    stack(grid2(card('Where the money goes', { icon: 'chart-pie' }, donut), card('Balance over time', { icon: 'chart-line' }, balance)), card('Year by year', { icon: 'table' }, yearlyHost))))
}
