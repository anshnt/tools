// EMI calculator. Also serves amortization-schedule (params.view = 'schedule') and loan-prepayment-calculator (params.focus = 'prepay').
import { h, icon, button, table } from '../../lib/ui.js'
import { shell, slide, num, hero, tiles, card, layout, note, switcher, pills, dateField, currencyPicker, chartBox, money, short, fnum, pct, firstIssue, stack, grid2, monthName, monthsLabel, downloadCSV, style } from './_shared.js'
import { amortize, yearly } from './_math.js'

export const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1)

const RANGE = { INR: [50_000, 50_000_000], JPY: [100_000, 200_000_000], default: [1_000, 2_000_000] }
const DEFAULT_AMOUNT = { INR: 2_500_000, JPY: 20_000_000, default: 250_000 }

const CSS = `
.emi-table .table-wrap { max-height: 480px; }
.emi-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.emi-toolbar .cm-switch { min-width: min(100%, 260px); }
.emi-summary { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; color: var(--muted); margin-top: 10px; }
.emi-summary b { color: var(--text); font-variant-numeric: tabular-nums; }
`

export function mount(root, { params }) {
  style('emi-style', CSS)
  const view = params?.view || 'emi'
  const focus = params?.focus || ''
  let cur = 'INR'
  let unit = 'y'
  let lumpMode = 'tenure'
  let tableMode = view === 'schedule' ? 'monthly' : 'yearly'
  let last = null

  const curSel = currencyPicker((c) => { cur = c; applyCurrency(true); update() })
  cur = curSel.get()
  const rng = () => RANGE[cur] || RANGE.default
  const amount = slide('Loan amount', { min: rng()[0], max: rng()[1], log: true, value: DEFAULT_AMOUNT[cur] || DEFAULT_AMOUNT.default, hardMin: 1, hardMax: 1e11, tickFormat: (v) => short(v, cur), onInput: () => update() })
  const rate = slide('Interest rate (per year)', { min: 1, max: 30, step: 0.05, value: 8.5, hardMin: 0, hardMax: 100, suffix: '%', tickFormat: (v) => `${v}%`, onInput: () => update() })
  const tenure = slide('Loan tenure', { min: 1, max: 30, step: 1, value: 20, hardMin: 1 / 12, hardMax: 40, suffix: 'yr', tickFormat: (v) => `${v} yr`, onInput: () => update() })
  const unitSw = switcher([['y', 'Years'], ['m', 'Months']], unit, (u) => {
    const months = tenureMonths()
    unit = u
    if (u === 'm') { tenure.setBounds(6, 360, 1, 480); tenure.setSuffix('mo'); tenure.set(Number.isFinite(months) ? months : 240) }
    else { tenure.setBounds(1, 30, 1 / 12, 40); tenure.setSuffix('yr'); tenure.set(Number.isFinite(months) ? Math.round((months / 12) * 100) / 100 : 20) }
    update()
  }, 'Tenure unit')
  const tenureMonths = () => { const v = tenure.val(); return Number.isFinite(v) ? Math.round(unit === 'y' ? v * 12 : v) : NaN }
  const startNext = addMonths(new Date(), 1)
  const startField = dateField('First EMI month', { type: 'month', value: `${startNext.getFullYear()}-${String(startNext.getMonth() + 1).padStart(2, '0')}`, hint: 'Used to label the schedule', onInput: () => update() })

  // Prepayment
  const extra = num('Extra payment every month', { value: 0, min: 0, max: 1e11, optional: true, hint: 'Added on top of each EMI' })
  const lump = num('One-time prepayment', { value: focus === 'prepay' ? 200000 : 0, min: 0, max: 1e11, optional: true })
  const lumpAtF = num('Paid along with EMI number', { value: 12, min: 1, max: 480, int: true, hint: 'For example 12 is the end of the first year' })
  const effect = pills([['tenure', 'Shorten the tenure'], ['emi', 'Lower the EMI']], lumpMode, (v) => { lumpMode = v; update() }, 'What the one-time prepayment does')
  const preBody = stack(grid2(extra, lump), lumpAtF, h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', 'After the one-time prepayment')), effect))
  const preBox = h('details', { class: 'cm-details', open: focus === 'prepay' || undefined },
    h('summary', icon('piggy-bank'), 'Prepayment (optional)'), h('div', { class: 'cm-details-body' }, preBody))

  const hr = hero({ label: 'Monthly EMI', tone: focus === 'prepay' ? 'mint' : 'violet', icon: 'landmark' })
  const t = tiles()
  const donut = chartBox({ height: 250, ariaLabel: 'Principal versus interest' })
  const balance = chartBox({ height: 250, ariaLabel: 'Loan balance over time' })
  const yearBars = chartBox({ height: 260, ariaLabel: 'Principal and interest paid each year' })
  const tableHost = h('div', { class: 'emi-table' })
  const csvBtn = button('Download CSV', { icon: 'download', variant: view === 'schedule' ? 'primary' : 'secondary', size: 'sm', onClick: () => csv() })
  const scheduleSw = switcher([['monthly', 'Monthly'], ['yearly', 'Yearly']], tableMode, (m) => { tableMode = m; paintTable() }, 'Schedule view')
  const summary = h('div', { class: 'emi-summary' })
  const results = h('div')

  function applyCurrency(changed) {
    const [lo, hi] = rng()
    amount.setBounds(lo, hi, 1, 1e11)
    amount.setPrefix(money(0, cur).replace(/[\d.,\s]/g, ''))
    for (const f of [extra, lump]) f.setPrefix(money(0, cur).replace(/[\d.,\s]/g, ''))
    if (changed) amount.set(DEFAULT_AMOUNT[cur] || DEFAULT_AMOUNT.default)
  }

  function update() {
    const bad = firstIssue(amount, rate, tenure, extra, lump, lumpAtF) || (Number.isFinite(tenureMonths()) && tenureMonths() < 1 ? 'Loan tenure: use at least one month' : '')
    amount.setHint(Number.isFinite(amount.val()) && cur === 'INR' ? short(amount.val(), cur) : '')
    if (bad) { hr.empty(bad); t.set([]); results.replaceChildren(); last = null; return }
    const P = amount.val()
    const r = rate.val()
    const n = tenureMonths()
    if (lumpAtF.val() > n && lump.val() > 0) { hr.empty(`The one-time prepayment must be within the ${n} EMIs (EMI number 1 to ${n})`); t.set([]); results.replaceChildren(); last = null; return }
    const m = (x) => money(x, cur)
    const base = amortize({ principal: P, ratePct: r, n })
    const hasPre = extra.val() > 0 || lump.val() > 0
    const pre = hasPre ? amortize({ principal: P, ratePct: r, n, extra: extra.val(), lump: lump.val(), lumpAt: lumpAtF.val(), lumpMode }) : base
    const start = startField.date()
    const endLabel = (res) => (start ? monthName(addMonths(start, res.periods - 1)) : `after ${monthsLabel(res.periods)}`)
    last = { base, pre, hasPre, P, r, n, start }
    const interestShare = (base.totalInterest / (P + base.totalInterest)) * 100
    const saved = base.totalInterest - pre.totalInterest

    if (focus === 'prepay' && hasPre) {
      hr.set({
        n: saved, fmt: m, label: 'Interest you save',
        sub: `${monthsLabel(base.periods - pre.periods)} sooner: loan ends ${endLabel(pre)} instead of ${endLabel(base)}`,
        chips: [{ label: 'New total interest', value: m(pre.totalInterest) }, { label: 'Normal EMI', value: m(base.emi) }],
        copy: `Prepayment saves ${m(saved)} in interest and ${monthsLabel(base.periods - pre.periods)} of EMIs on a ${m(P)} loan at ${fnum(r, 2)}% for ${monthsLabel(n)}`,
      })
    } else {
      hr.set({
        n: base.emi, fmt: m, label: 'Monthly EMI',
        sub: `${fnum(r, 2)}% p.a. for ${monthsLabel(n)} (${fnum(n, 0)} EMIs)`,
        chips: [{ label: 'Total interest', value: m(base.totalInterest) }, { label: 'Total payment', value: m(P + base.totalInterest) }],
        bar: [{ label: 'Principal', value: P, text: short(P, cur) }, { label: 'Interest', value: base.totalInterest, text: short(base.totalInterest, cur) }],
        copy: `EMI ${m(base.emi)} per month on ${m(P)} at ${fnum(r, 2)}% for ${monthsLabel(n)}. Total interest ${m(base.totalInterest)}, total payment ${m(P + base.totalInterest)}`,
      })
    }
    const tl = [
      { label: 'Principal amount', n: P, fmt: m, tone: 'indigo', icon: 'wallet' },
      { label: 'Total interest', n: base.totalInterest, fmt: m, tone: 'orange', icon: 'percent', hint: `${fnum(interestShare, 1)}% of everything you pay` },
      { label: 'Total payment', n: P + base.totalInterest, fmt: m, tone: 'pink', icon: 'receipt' },
      { label: 'Last EMI', value: endLabel(base), tone: 'teal', icon: 'calendar-check' },
    ]
    if (hasPre) {
      tl.splice(0, tl.length,
        { label: 'Interest saved', n: saved, fmt: m, tone: 'green', icon: 'piggy-bank', hint: `${fnum(base.totalInterest > 0 ? (saved / base.totalInterest) * 100 : 0, 1)}% less interest` },
        { label: 'Time saved', value: base.periods - pre.periods > 0 ? monthsLabel(base.periods - pre.periods) : 'Same tenure', tone: 'green', icon: 'timer', hint: lumpMode === 'emi' && lump.val() > 0 && !(extra.val() > 0) ? 'EMI is lowered instead' : undefined },
        { label: 'New tenure', value: monthsLabel(pre.periods), tone: 'teal', icon: 'calendar-check', hint: `ends ${endLabel(pre)}` },
        { label: 'Total interest now', n: pre.totalInterest, fmt: m, tone: 'orange', icon: 'percent', hint: `was ${m(base.totalInterest)}` },
        ...(lumpMode === 'emi' && lump.val() > 0 && pre.rows.length > lumpAtF.val() ? [{ label: 'EMI after prepayment', n: pre.rows[Math.min(pre.rows.length - 1, lumpAtF.val())].payment, fmt: m, tone: 'indigo', icon: 'landmark', hint: `was ${m(base.emi)}` }] : []),
        { label: 'Total payment', n: pre.totalPaid, fmt: m, tone: 'pink', icon: 'receipt' })
    }
    t.set(tl)

    // Charts
    donut.render({
      type: 'doughnut', labels: ['Principal', 'Interest'], datasets: [{ data: [P, base.totalInterest], colors: [0, 1] }], format: m,
      center: { title: pct(interestShare, 1), caption: 'is interest' },
    })
    const step = base.periods <= 36 ? 1 : 12
    const pts = []
    for (let k = 0; k <= base.periods; k += step) pts.push(k)
    if (pts.at(-1) !== base.periods) pts.push(base.periods)
    const bal = (res, k) => (k === 0 ? P : res.rows[k - 1] ? res.rows[k - 1].balance : 0)
    balance.render({
      type: 'line', labels: pts.map((k) => (k === 0 ? 'Start' : step === 12 ? `Yr ${k / 12}` : `M${k}`)),
      datasets: [{ label: hasPre ? 'With prepayment' : 'Balance', data: pts.map((k) => bal(pre, k)), color: 0 }, ...(hasPre ? [{ label: 'Without prepayment', data: pts.map((k) => bal(base, k)), color: 1, fill: false }] : [])],
      format: m, axisFormat: (v) => short(v, cur),
    })
    const yrs = yearly(pre.rows, 12)
    yearBars.render({
      type: 'bar', stacked: true, labels: yrs.map((y) => `Y${y.year}`),
      datasets: [{ label: 'Principal', data: yrs.map((y) => y.principal), color: 0 }, ...(hasPre ? [{ label: 'Prepaid', data: yrs.map((y) => y.prepay), color: 3 }] : []), { label: 'Interest', data: yrs.map((y) => y.interest), color: 1 }],
      format: m, axisFormat: (v) => short(v, cur),
    })
    paintTable()
  }

  function paintTable() {
    if (!last) return
    const { pre, hasPre, start } = last
    const m = (x) => money(x, cur)
    const cols = (first) => [{ label: first }, ...(tableMode === 'monthly' ? [{ label: 'Month' }] : []), { label: tableMode === 'monthly' ? 'EMI' : 'Paid', num: true }, { label: 'Principal', num: true }, { label: 'Interest', num: true }, ...(hasPre ? [{ label: 'Prepaid', num: true }] : []), { label: 'Balance', num: true }]
    let rows
    if (tableMode === 'monthly') {
      rows = pre.rows.map((r) => [r.k, start ? monthName(addMonths(start, r.k - 1)) : `Month ${r.k}`, m(r.payment), m(r.principal), m(r.interest), ...(hasPre ? [m(r.prepay)] : []), m(r.balance)])
    } else {
      rows = yearly(pre.rows, 12).map((y) => [`Year ${y.year}`, m(y.payment + y.prepay), m(y.principal + y.prepay), m(y.interest), ...(hasPre ? [m(y.prepay)] : []), m(y.balance)])
    }
    tableHost.replaceChildren(table({ columns: cols(tableMode === 'monthly' ? '#' : 'Year'), rows, max: 1000 }))
    summary.replaceChildren(
      h('span', 'Payments ', h('b', fnum(pre.periods, 0))), h('span', 'Total interest ', h('b', m(pre.totalInterest))), h('span', 'Total paid ', h('b', m(pre.totalPaid))))
  }

  function csv() {
    if (!last) return
    const { pre, start } = last
    const rows = [['No', 'Month', 'EMI', 'Principal', 'Interest', 'Prepayment', 'Balance'],
      ...pre.rows.map((r) => [r.k, start ? monthName(addMonths(start, r.k - 1)) : `Month ${r.k}`, r.payment.toFixed(2), r.principal.toFixed(2), r.interest.toFixed(2), r.prepay.toFixed(2), r.balance.toFixed(2)]),
      ['Total', '', pre.rows.reduce((s, r) => s + r.payment, 0).toFixed(2), pre.rows.reduce((s, r) => s + r.principal, 0).toFixed(2), pre.totalInterest.toFixed(2), pre.totalPrepaid.toFixed(2), '']]
    downloadCSV(rows, `amortization-schedule-${last.n}-months.csv`)
  }

  const scheduleCard = card('Repayment schedule', { icon: 'table', right: csvBtn },
    h('div', { class: 'emi-toolbar' }, scheduleSw), tableHost, summary)
  const chartsRow = grid2(card('Principal vs interest', { icon: 'chart-pie' }, donut), card('Balance over time', { icon: 'chart-line' }, balance))
  const barsCard = card('Principal and interest each year', { icon: 'chart-column' }, yearBars)

  const inputs = card('Loan details', { icon: 'sliders-horizontal', right: curSel },
    stack(amount, rate, h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', 'Tenure unit')), unitSw), tenure, startField))
  applyCurrency(false)
  amount.set(DEFAULT_AMOUNT[cur] || DEFAULT_AMOUNT.default)
  for (const f of [extra, lump, lumpAtF]) f.input.addEventListener('input', update)
  startField.input.addEventListener('input', update)
  update()

  const left = [inputs, preBox]
  const right = [hr.el, t, note('Figures use the standard reducing-balance EMI formula. Lenders usually round the EMI to a whole unit, so your lender may differ by a small amount.')]
  const below = view === 'schedule' ? [scheduleCard, chartsRow, barsCard] : [chartsRow, barsCard, scheduleCard]
  shell(root, layout(left, right, stack(...below)))
}
