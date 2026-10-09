// FD and RD calculator: maturity with quarterly compounding (as Indian banks do), payout options and a TDS heads-up.
import { h, card, panel, split, stack, table, segmented, toggle, button, alert, clear } from '../../lib/ui.js'
import { inr, lakhCrore, fdMaturity, fdPayout, fdYearly, rdMaturity, rdYearly, pct } from './_calc.js'
import { useStyles, liveHero, statTiles, numField, selectField, hero, stackedChart, SERIES_COLORS, note, downloadCsv } from './_shared.js'

const COMP = [['4', 'Quarterly (most banks)'], ['12', 'Monthly'], ['2', 'Half-yearly'], ['1', 'Yearly'], ['0', 'Simple interest at maturity']]
const PAYOUT = [['0', 'Cumulative (interest added to the deposit)'], ['1', 'Interest paid every month'], ['3', 'Interest paid every quarter'], ['6', 'Interest paid every 6 months'], ['12', 'Interest paid every year']]

function tenureField(label, years, months) {
  const y = numField('Years', years, { min: 0, max: 30, step: 1, integer: true })
  const m = numField('Months', months, { min: 0, max: 11, step: 1, integer: true })
  return {
    el: h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', label)), h('div', { class: 'grid-2' }, y.el, m.el)),
    inputs: [y.input, m.input],
    months: () => Math.round(y.val(0) * 12 + m.val(0)),
    issue: () => (y.issue() || m.issue() || (y.val(0) * 12 + m.val(0) < 1 ? 'Tenure must be at least one month' : '')),
  }
}

export function mount(root) {
  useStyles()
  const mode = segmented([['fd', 'Fixed deposit (FD)'], ['rd', 'Recurring deposit (RD)']], 'fd', () => switchMode(), 'Deposit type')

  // ----- FD -----
  const fd = {
    principal: numField('Deposit amount (₹)', 500000, { min: 1000, max: 1e10, step: 10000, money: true }),
    rate: numField('Interest rate (% a year)', 7, { min: 0.1, max: 20, step: 0.05 }),
    tenure: tenureField('Tenure', 3, 0),
    comp: selectField('Compounding', COMP, '4'),
    payout: selectField('Interest', PAYOUT, '0'),
  }
  // ----- RD -----
  const rd = {
    monthly: numField('Monthly deposit (₹)', 10000, { min: 100, max: 1e8, step: 500, money: true }),
    rate: numField('Interest rate (% a year)', 6.75, { min: 0.1, max: 20, step: 0.05 }),
    tenure: tenureField('Tenure', 3, 0),
  }
  const senior = toggle('Senior citizen (60 or above)', false, () => render())
  const noPan = toggle('No PAN given to the bank (TDS at 20%)', false, () => render())

  const fdForm = h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, fd.principal.el, fd.rate.el), fd.tenure.el, h('div', { class: 'grid-2' }, fd.comp.el, fd.payout.el))
  const rdForm = h('div', { class: 'stack', hidden: true }, h('div', { class: 'grid-2' }, rd.monthly.el, rd.rate.el), rd.tenure.el)
  const top = hero('Maturity amount')
  const tiles = h('div'), tdsBox = h('div'), msg = h('div'), tableBox = h('div'), tableTitle = h('h2', { style: 'margin:0' }, 'Year-by-year')
  const chart = stackedChart({ series: [{ label: 'Deposited', fill: SERIES_COLORS[0] }, { label: 'Interest', fill: SERIES_COLORS[1] }], ariaLabel: 'Deposit and interest earned each year' })
  const csvBtn = button('Download CSV', { icon: 'download', size: 'sm' })
  let csvRows = []

  const switchMode = () => { fdForm.hidden = mode.value !== 'fd'; rdForm.hidden = mode.value !== 'rd'; render() }

  function tds(rows, interestOf) {
    const limit = senior.input.checked ? 100000 : 40000
    const rate = noPan.input.checked ? 20 : 10
    const hits = rows.filter((r) => interestOf(r) > limit)
    if (!hits.length) return h('p', { class: 'in-note' }, `Interest each year stays under ₹${limit.toLocaleString('en-IN')}, so banks usually do not deduct TDS (Form 15G/15H not needed).`)
    const amount = hits.reduce((a, r) => a + interestOf(r) * (rate / 100), 0)
    return alert('warn', h('strong', 'TDS likely. '), `Interest passes ₹${limit.toLocaleString('en-IN')} in ${hits.length} of ${rows.length} year(s), so about ${inr(amount)} may be deducted at ${rate}%. It is only an advance: you pay tax on interest at your slab, and can claim a refund if your income is below the taxable limit.`)
  }

  function renderFd() {
    const bad = [fd.principal, fd.rate, fd.tenure].map((x) => x.issue()).find(Boolean)
    clear(msg, bad ? alert('info', bad) : null)
    if (bad) return top.set('Maturity amount', '-', 'Fill in all the fields')
    const P = fd.principal.get(), r = fd.rate.get(), months = fd.tenure.months(), comp = +fd.comp.get(), every = +fd.payout.get()
    const rows = fdYearly(P, r, months, comp)
    const yrs = months / 12
    tableTitle.textContent = 'Year-by-year'
    if (every === 0) {
      const maturity = fdMaturity(P, r, months, comp), interest = maturity - P
      const apy = (Math.pow(maturity / P, 1 / yrs) - 1) * 100
      top.set('Maturity amount', inr(maturity), `${lakhCrore(maturity)} after ${fd.tenure.months() >= 12 ? `${Math.floor(months / 12)} yr ${months % 12 ? months % 12 + ' mo' : ''}`.trim() : months + ' months'}. Effective yield ${pct(apy)} a year.`)
      clear(tiles, statTiles([{ label: 'Deposit', value: inr(P) }, { label: 'Interest earned', value: inr(interest), accent: true, hint: lakhCrore(interest) }, { label: 'Maturity', value: inr(maturity) }, { label: 'Effective yield', value: pct(apy), hint: 'per year' }]))
      chart.update(rows.map((x) => ({ label: `Year ${x.year}`, short: String(x.year), parts: [P, x.close - P] })))
      clear(tableBox, table({ columns: ['Year', { label: 'Opening', num: true }, { label: 'Interest', num: true }, { label: 'Closing', num: true }], rows: rows.map((x) => [x.year, inr(x.open), inr(x.interest), inr(x.close)]) }))
      csvRows = [['Year', 'Opening', 'Interest', 'Closing'], ...rows.map((x) => [x.year, Math.round(x.open), Math.round(x.interest), Math.round(x.close)])]
      clear(tdsBox, tds(rows, (x) => x.interest))
    } else {
      const p = fdPayout(P, r, months, every)
      const name = { 1: 'month', 3: 'quarter', 6: '6 months', 12: 'year' }[every]
      top.set(`Interest every ${name}`, inr(p.per), `${p.count % 1 ? p.count.toFixed(1) : p.count} payouts, ${inr(p.total)} in total. Your ${inr(P)} comes back at the end.`)
      clear(tiles, statTiles([{ label: 'Deposit', value: inr(P) }, { label: 'Total interest', value: inr(p.total), accent: true }, { label: `Each ${name}`, value: inr(p.per) }, { label: 'Principal back', value: inr(P), hint: 'at maturity' }]))
      const yearly = rows.map((x, i) => ({ year: x.year, interest: (P * r / 100) * (Math.min(12, months - i * 12) / 12) }))
      chart.update(yearly.map((x) => ({ label: `Year ${x.year}`, short: String(x.year), parts: [P, x.interest] })))
      clear(tableBox, table({ columns: ['Year', { label: 'Interest paid out', num: true }], rows: yearly.map((x) => [x.year, inr(x.interest)]) }))
      csvRows = [['Year', 'Interest paid'], ...yearly.map((x) => [x.year, Math.round(x.interest)])]
      clear(tdsBox, tds(yearly, (x) => x.interest))
    }
  }

  function renderRd() {
    const bad = [rd.monthly, rd.rate, rd.tenure].map((x) => x.issue()).find(Boolean)
    clear(msg, bad ? alert('info', bad) : null)
    if (bad) return top.set('Maturity amount', '-', 'Fill in all the fields')
    const R = rd.monthly.get(), r = rd.rate.get(), months = rd.tenure.months()
    const maturity = rdMaturity(R, r, months), dep = R * months, interest = maturity - dep
    const rows = rdYearly(R, r, months)
    top.set('Maturity amount', inr(maturity), `${lakhCrore(maturity)} on ${inr(dep)} deposited over ${months} months. Interest compounds quarterly.`)
    clear(tiles, statTiles([{ label: 'You deposit', value: inr(dep), hint: `${inr(R)} x ${months}` }, { label: 'Interest earned', value: inr(interest), accent: true, hint: lakhCrore(interest) }, { label: 'Maturity', value: inr(maturity) }, { label: 'Interest share', value: pct((interest / maturity) * 100, 1), hint: 'of maturity' }]))
    chart.update(rows.map((x) => ({ label: `Year ${x.year}`, short: String(x.year), parts: [x.deposited, x.interest] })))
    tableTitle.textContent = 'Year-by-year'
    clear(tableBox, table({ columns: ['Year', { label: 'Deposited', num: true }, { label: 'Interest', num: true }, { label: 'Value', num: true }], rows: rows.map((x) => [x.year, inr(x.deposited), inr(x.interest), inr(x.value)]) }))
    csvRows = [['Year', 'Deposited', 'Interest', 'Value'], ...rows.map((x) => [x.year, Math.round(x.deposited), Math.round(x.interest), Math.round(x.value)])]
    // RD interest is spread over the whole term; this is a per-year approximation for the TDS check.
    const perYear = rows.map((x, i) => ({ interest: x.interest - (rows[i - 1]?.interest || 0) }))
    clear(tdsBox, tds(perYear, (x) => x.interest))
  }

  const render = () => (mode.value === 'fd' ? renderFd() : renderRd())
  for (const x of [fd.principal, fd.rate, rd.monthly, rd.rate]) x.input.addEventListener('input', render)
  for (const i of [...fd.tenure.inputs, ...rd.tenure.inputs]) i.addEventListener('input', render)
  for (const s of [fd.comp, fd.payout]) s.select.addEventListener('change', render)
  csvBtn.addEventListener('click', () => csvRows.length && downloadCsv(csvRows, `${mode.value}-schedule.csv`))

  root.append(stack(
    mode,
    split(
      card('Deposit details', h('div', { class: 'stack' }, fdForm, rdForm, h('div', { class: 'stack', style: 'gap:8px' }, senior, noPan), msg,
        note('Banks compound FD interest quarterly and compute RD on the same basis. Rates differ by bank and tenure; use your bank\'s rate. Results are estimates, not a bank statement.'))),
      stack(top, tiles, tdsBox), 'wide-left'),
    card('Growth', chart.el),
    panel(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, tableTitle, csvBtn), tableBox),
    note('TDS thresholds from Budget 2025: ₹40,000 a year per bank for most people and ₹1,00,000 for senior citizens, 10% with PAN. Check ', h('a', { href: 'https://www.incometax.gov.in/', target: '_blank', rel: 'noopener noreferrer' }, 'incometax.gov.in'), ' for the current rules.')))
  liveHero(top)
  render()
}
