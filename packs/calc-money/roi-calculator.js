// ROI and CAGR calculator: return on investment, compound annual growth rate over dates or years, and what keeping that pace would do next.
// params.focus: 'roi' (default) or 'cagr' decides which figure leads.
import { h } from '../../lib/ui.js'
import { shell, num, dateField, hero, tiles, card, layout, note, pills, currencyPicker, chartBox, money, short, fnum, firstIssue, stack, block, monthsLabel } from './_shared.js'
import { cagr, roi, yearsBetween } from './_math.js'

/** ROI and CAGR for a cost basis (investment plus costs), a final value and a period in years. */
export function returns({ invested, costs = 0, final, years }) {
  const basis = invested + costs
  const gain = final - basis
  return { basis, gain, roi: roi(basis, final), cagr: cagr(basis, final, years), multiple: basis > 0 ? final / basis : NaN }
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function mount(root, { params }) {
  const focus = params?.focus === 'cagr' ? 'cagr' : 'roi'
  let cur = 'INR'
  let useDates = true
  const curSel = currencyPicker((c) => { cur = c; prefix(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const today = new Date()
  const start = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate())
  const invested = num('Amount invested', { value: cur === 'INR' ? 500000 : 10000, min: 0.000001, max: 1e13 })
  const final = num('Value now (or when sold)', { value: cur === 'INR' ? 900000 : 18000, min: 0, max: 1e13 })
  const costs = num('Extra costs (optional)', { value: 0, min: 0, max: 1e12, optional: true, hint: 'Fees, brokerage or taxes you paid on top' })
  const startF = dateField('Start date', { type: 'date', value: iso(start), max: iso(today), onInput: () => update() })
  const endF = dateField('End date', { type: 'date', value: iso(today), onInput: () => update() })
  const yearsF = num('Number of years', { value: 5, min: 0.01, max: 200, suffix: 'yr' })
  const timeMode = pills([[true, 'Use dates'], [false, 'Use years']], useDates, (v) => { useDates = v; showTime(); update() }, 'How to measure the period')
  const timeBox = h('div', { class: 'cm-stack' })
  const hr = hero({ label: focus === 'cagr' ? 'CAGR' : 'Return on investment', tone: 'gold', icon: focus === 'cagr' ? 'chart-line' : 'trending-up' })
  const t = tiles()
  const chart = chartBox({ height: 280, ariaLabel: 'Growth of the investment' })
  function prefix() { for (const f of [invested, final, costs]) f.setPrefix(sym()) }
  function showTime() { timeBox.replaceChildren(block('How long?', timeMode), ...(useDates ? [h('div', { class: 'cm-grid2' }, startF, endF)] : [yearsF])) }
  function period() {
    if (!useDates) return { years: yearsF.val(), issue: yearsF.issue() }
    const a = startF.date()
    const b = endF.date()
    if (!a || !b) return { years: NaN, issue: 'Pick both dates' }
    if (b <= a) return { years: NaN, issue: 'The end date must be after the start date' }
    return { years: yearsBetween(a, b), days: Math.round((b - a) / 86400000) }
  }

  function update() {
    const p = period()
    const bad = firstIssue(invested, final, costs) || p.issue
    if (bad) { hr.empty(bad); t.set([]); return }
    const m = (x) => money(x, cur)
    const r = returns({ invested: invested.val(), costs: costs.val(), final: final.val(), years: p.years })
    const loss = r.gain < 0
    hr.setTone(loss ? 'rose' : 'gold')
    const cagrTxt = Number.isFinite(r.cagr) ? `${fnum(r.cagr, 2)}%` : 'n/a'
    const roiTxt = `${fnum(r.roi, 2)}%`
    const lead = focus === 'cagr' ? r.cagr : r.roi
    if (focus === 'cagr' && !Number.isFinite(r.cagr)) { hr.empty('CAGR needs a final value above zero.'); t.set([]); return }
    hr.set({
      n: lead, fmt: (v) => `${v > 0 && focus === 'roi' ? '+' : ''}${fnum(v, 2)}%`, label: focus === 'cagr' ? 'CAGR (per year)' : 'Return on investment',
      sub: `${m(r.basis)} became ${m(final.val())} in ${monthsLabel(p.years * 12)}${p.days ? ` (${fnum(p.days, 0)} days)` : ''}`,
      chips: focus === 'cagr' ? [{ label: 'Total ROI', value: roiTxt }, { label: loss ? 'Loss' : 'Gain', value: m(Math.abs(r.gain)) }] : [{ label: 'CAGR', value: `${cagrTxt} a year` }, { label: loss ? 'Loss' : 'Gain', value: m(Math.abs(r.gain)) }],
      copy: `Invested ${m(r.basis)}, now ${m(final.val())} after ${monthsLabel(p.years * 12)}: ROI ${roiTxt}, CAGR ${cagrTxt} a year, ${loss ? 'loss' : 'gain'} ${m(Math.abs(r.gain))}`,
    })
    const ahead = Number.isFinite(r.cagr) ? final.val() * (1 + r.cagr / 100) ** 5 : NaN
    const double = Number.isFinite(r.cagr) && r.cagr > 0 ? Math.log(2) / Math.log(1 + r.cagr / 100) : NaN
    t.set([
      { label: loss ? 'Net loss' : 'Net gain', n: Math.abs(r.gain), fmt: m, tone: loss ? 'red' : 'green', icon: loss ? 'trending-down' : 'piggy-bank' },
      { label: focus === 'cagr' ? 'Total return (ROI)' : 'CAGR a year', value: focus === 'cagr' ? roiTxt : cagrTxt, tone: 'amber', icon: 'chart-line', hint: 'compounded, per year' },
      { label: 'Money multiple', value: `${fnum(r.multiple, 2)}x`, tone: 'violet', icon: 'x', hint: 'value now divided by what you put in' },
      { label: 'Holding period', value: monthsLabel(p.years * 12), tone: 'sky', icon: 'calendar-days', hint: `${fnum(p.years, 2)} years` },
      ...(Number.isFinite(ahead) ? [{ label: '5 more years at this pace', n: ahead, fmt: m, tone: 'teal', icon: 'rocket', hint: 'if the same CAGR continued' }] : []),
      ...(Number.isFinite(double) ? [{ label: 'Doubles every', value: `${fnum(double, 1)} yr`, tone: 'pink', icon: 'timer' }] : []),
    ])
    const rate = Number.isFinite(r.cagr) ? r.cagr / 100 : 0
    const steps = Math.min(40, Math.max(6, Math.ceil(p.years)))
    const labels = []
    const grown = []
    const proj = []
    for (let i = 0; i <= steps; i++) {
      const yv = (p.years * i) / steps
      labels.push(`${fnum(yv, yv < 10 ? 1 : 0)}y`)
      grown.push(r.basis * (1 + rate) ** yv)
    }
    const futureSteps = Math.min(10, Math.max(3, Math.ceil(p.years / 2)))
    for (let i = 1; i <= futureSteps; i++) { const yv = p.years + (p.years * i) / steps; labels.push(`${fnum(yv, yv < 10 ? 1 : 0)}y`); proj.push(r.basis * (1 + rate) ** yv) }
    chart.render({
      type: 'line', labels,
      datasets: [{ label: 'Growth to now', data: [...grown, ...proj.map(() => null)], color: 0 }, ...(proj.length && rate > -1 ? [{ label: 'If it kept going', data: [...grown.map((_, i) => (i === grown.length - 1 ? grown[i] : null)), ...proj], color: 1, fill: false }] : [])],
      format: m, axisFormat: (v) => short(v, cur), beginAtZero: false,
    })
  }

  for (const f of [invested, final, costs, yearsF]) f.input.addEventListener('input', update)
  prefix()
  showTime()
  update()
  shell(root, layout(
    [card('Your investment', { icon: 'wallet', right: curSel }, stack(invested, final, costs, timeBox))],
    [hr.el, t, note('CAGR is the steady yearly rate that would turn the amount you put in into the final value. Years are counted as days divided by 365.25. Past returns do not predict future ones.')],
    card('How it grew', { icon: 'chart-line' }, chart)))
}
