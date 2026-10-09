// SIP calculator: future value of a monthly SIP with an optional yearly step-up, in today's money too.
import { h, card, panel, split, stack, table, button, alert, clear } from '../../lib/ui.js'
import { inr, lakhCrore, sipProject } from './_calc.js'
import { useStyles, statTiles, numField, hero, stackedChart, SERIES_COLORS, note, downloadCsv } from './_shared.js'

export function mount(root) {
  useStyles()
  const f = {
    monthly: numField('Monthly SIP (₹)', 10000, { min: 100, max: 10_000_000, step: 500, money: true }),
    rate: numField('Expected return (% a year)', 12, { min: 1, max: 40, step: 0.5, hint: 'Equity funds have returned about 10 to 14% over long periods, with no guarantee' }),
    years: numField('Time period (years)', 15, { min: 1, max: 50, step: 1, integer: true }),
    step: numField('Yearly step-up (%)', 0, { min: 0, max: 100, step: 1, hint: 'Raise your SIP by this much every year' }),
    lump: numField('Starting corpus (₹, optional)', 0, { min: 0, max: 1e10, step: 10000, money: true }),
    inflation: numField('Inflation (% a year)', 6, { min: 0, max: 20, step: 0.5, hint: 'Used for the value in today\'s money' }),
  }
  const top = hero('Estimated value')
  const tiles = h('div')
  const chart = stackedChart({ series: [{ label: 'You invest', fill: SERIES_COLORS[0] }, { label: 'Returns', fill: SERIES_COLORS[1] }], ariaLabel: 'Yearly growth of the SIP: amount invested and returns' })
  const tableBox = h('div')
  const msg = h('div')
  const csvBtn = button('Download CSV', { icon: 'download', size: 'sm' })
  let last

  function render() {
    const bad = Object.values(f).map((x) => x.issue()).find(Boolean)
    clear(msg, bad ? alert('info', bad) : null)
    if (bad) { top.set('Estimated value', '-', 'Fill in all the fields'); return }
    const r = sipProject({ monthly: f.monthly.get(), rate: f.rate.get(), years: f.years.get(), step: f.step.get(), lump: f.lump.get(), inflation: f.inflation.get() })
    last = r
    top.set('Estimated value', inr(r.value), `${lakhCrore(r.value)} after ${f.years.get()} years. About ${inr(r.real)} in today's money at ${f.inflation.get()}% inflation.`)
    clear(tiles, statTiles([
      { label: 'You invest', value: inr(r.invested), hint: lakhCrore(r.invested) },
      { label: 'Estimated returns', value: inr(r.gains), hint: lakhCrore(r.gains), accent: true },
      { label: 'Money multiplier', value: `${(r.value / Math.max(1, r.invested)).toFixed(2)}x`, hint: 'value / invested' },
      { label: "Value in today's money", value: inr(r.real), hint: `${f.inflation.get()}% inflation` },
    ]))
    chart.update(r.rows.map((row) => ({ label: `Year ${row.year}`, short: String(row.year), parts: [row.invested, row.gains] })))
    clear(tableBox, table({
      columns: ['Year', { label: 'SIP a month', num: true }, { label: 'Invested', num: true }, { label: 'Returns', num: true }, { label: 'Value', num: true }],
      rows: r.rows.map((x) => [x.year, inr(x.sip), inr(x.invested), inr(x.gains), inr(x.value)]),
    }))
  }
  for (const x of Object.values(f)) x.input.addEventListener('input', render)
  csvBtn.addEventListener('click', () => last && downloadCsv([['Year', 'SIP per month', 'Invested', 'Returns', 'Value'], ...last.rows.map((x) => [x.year, Math.round(x.sip), Math.round(x.invested), Math.round(x.gains), Math.round(x.value)])], 'sip-projection.csv'))

  root.append(stack(
    split(
      card('Your SIP', h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, f.monthly.el, f.years.el, f.rate.el, f.step.el, f.lump.el, f.inflation.el), msg,
        note('Returns are compounded monthly at the yearly rate divided by 12, with each SIP going in at the start of the month. Mutual fund returns are market-linked and not guaranteed.'))),
      stack(top, tiles), 'wide-left'),
    card('Growth year by year', chart.el),
    panel(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Year-by-year table'), csvBtn), tableBox)))
  render()
}
