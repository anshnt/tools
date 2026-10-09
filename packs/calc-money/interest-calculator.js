// Interest calculator: simple and compound interest with any compounding frequency and regular contributions.
// params.mode ('simple' | 'compound') sets the starting mode and, for the dedicated entries, hides the switch.
import { h, table } from '../../lib/ui.js'
import { shell, num, slide, hero, tiles, card, layout, note, switcher, pills, pick, currencyPicker, chartBox, money, short, fnum, pct, firstIssue, stack, block } from './_shared.js'
import { compound, simpleInterest } from './_math.js'

const FREQ_OPTIONS = [['365', 'Daily'], ['52', 'Weekly'], ['12', 'Monthly'], ['4', 'Quarterly'], ['2', 'Half-yearly'], ['1', 'Yearly'], ['0', 'Continuously']]
const FREQ_NAME = Object.fromEntries(FREQ_OPTIONS)
const fromKey = (k) => (k === '0' ? Infinity : Number(k))

export function mount(root, { params }) {
  const only = params?.mode
  let mode = only || 'compound'
  let cur = 'INR'
  let every = 1
  let atStart = false
  const curSel = currencyPicker((c) => { cur = c; prefix(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const modeSw = only ? null : switcher([['simple', 'Simple interest', 'minus'], ['compound', 'Compound interest', 'trending-up']], mode, (m) => { mode = m; showMode(); update() }, 'Interest type')
  const principal = num('Principal (amount you start with)', { value: cur === 'INR' ? 100000 : 10000, min: 0, max: 1e12, hint: '' })
  const rate = slide('Interest rate (per year)', { min: 0, max: 20, step: 0.05, value: 7, hardMin: 0, hardMax: 100, suffix: '%', tickFormat: (v) => `${v}%`, onInput: () => update() })
  const years = num('Years', { value: 10, min: 0, max: 100, int: true, optional: true, suffix: 'yr' })
  const months = num('Months', { value: 0, min: 0, max: 1200, int: true, optional: true, suffix: 'mo' })
  const days = num('Days', { value: 0, min: 0, max: 36500, int: true, optional: true, suffix: 'd' })
  const freq = pick(FREQ_OPTIONS, '1', () => update(), 'Compounding frequency')
  const contrib = num('Regular deposit (optional)', { value: 0, min: 0, max: 1e12, optional: true, hint: 'Added again and again over the period' })
  const every_ = pills([[1, 'Monthly'], [3, 'Quarterly'], [12, 'Yearly']], every, (v) => { every = v; update() }, 'Deposit frequency')
  const timing = pills([[false, 'End of each period'], [true, 'Start of each period']], atStart, (v) => { atStart = v; update() }, 'Deposit timing')
  const compoundBox = h('div', { class: 'cm-stack' },
    block('Compounding', freq), contrib, block('How often do you deposit?', every_), block('When in the period?', timing))
  const body = h('div', { class: 'cm-stack' })
  const hr = hero({ label: 'Total amount', tone: 'gold', icon: 'piggy-bank' })
  const t = tiles()
  const growthChart = chartBox({ height: 280, ariaLabel: 'Growth over time' })
  const tableHost = h('div')
  const chartCard = card('Growth over time', { icon: 'chart-column' }, growthChart)
  const tableCard = card('Year by year', { icon: 'table' }, tableHost)
  const below = stack(chartCard, tableCard)

  function prefix() { for (const f of [principal, contrib]) f.setPrefix(sym()) }
  function showMode() {
    body.replaceChildren(principal, rate, block('Time period', h('div', { class: 'cm-grid3 keep' }, years, months, days)), ...(mode === 'compound' ? [compoundBox] : []))
  }
  const totalYears = () => (years.val() || 0) + (months.val() || 0) / 12 + (days.val() || 0) / 365

  function update() {
    const bad = firstIssue(principal, rate, years, months, days, ...(mode === 'compound' ? [contrib] : []))
    if (Number.isFinite(principal.val())) principal.setHint(cur === 'INR' ? short(principal.val(), cur) : '')
    if (bad) { hr.empty(bad); t.set([]); tableHost.replaceChildren(); return }
    const P = principal.val()
    const r = rate.val()
    const Y = totalYears()
    if (!(Y > 0)) { hr.empty('Time period: enter at least one day'); t.set([]); tableHost.replaceChildren(); return }
    const m = (x) => money(x, cur)
    const label = `${[years.val() ? `${years.val()} yr` : '', months.val() ? `${months.val()} mo` : '', days.val() ? `${days.val()} d` : ''].filter(Boolean).join(' ')}`
    if (mode === 'simple') {
      const I = simpleInterest(P, r, Y)
      const yearlyEq = compound({ principal: P, ratePct: r, years: Y, m: 1 })
      hr.set({
        n: P + I, fmt: m, label: 'Total amount (simple interest)', sub: `${m(P)} at ${fnum(r, 2)}% a year for ${label}`,
        chips: [{ label: 'Interest earned', value: m(I) }, { label: 'Interest every year', value: m((P * r) / 100) }],
        bar: [{ label: 'Principal', value: P, text: m(P) }, { label: 'Interest', value: I, text: m(I) }],
        copy: `Simple interest on ${m(P)} at ${fnum(r, 2)}% for ${label}: interest ${m(I)}, total ${m(P + I)}`,
      })
      t.set([
        { label: 'Interest earned', n: I, fmt: m, tone: 'amber', icon: 'percent' },
        { label: 'Interest as % of principal', value: pct(P > 0 ? (I / P) * 100 : 0, 2), tone: 'orange', icon: 'percent' },
        { label: 'If it compounded yearly', n: yearlyEq.balance, fmt: m, tone: 'teal', icon: 'trending-up', hint: `${m(yearlyEq.balance - (P + I))} more than simple interest` },
      ])
      const rows = []
      const steps = Math.max(1, Math.ceil(Y))
      for (let y = 1; y <= steps; y++) { const yy = Math.min(y, Y); rows.push({ year: y, interest: simpleInterest(P, r, yy), simple: P + simpleInterest(P, r, yy), comp: compound({ principal: P, ratePct: r, years: yy, m: 1 }).balance }) }
      growthChart.render({
        type: 'line', labels: ['Start', ...rows.map((x) => `Y${x.year}`)],
        datasets: [{ label: 'Simple interest', data: [P, ...rows.map((x) => x.simple)], color: 0 }, { label: 'Compounded yearly', data: [P, ...rows.map((x) => x.comp)], color: 1, fill: false }],
        format: m, axisFormat: (v) => short(v, cur), beginAtZero: false,
      })
      tableHost.replaceChildren(table({
        columns: ['Year', { label: 'Interest to date', num: true }, { label: 'Balance', num: true }],
        rows: rows.map((x) => [`Year ${x.year}`, m(x.interest), m(x.simple)]),
      }))
      return
    }

    const mFreq = fromKey(freq.value)
    const res = compound({ principal: P, ratePct: r, years: Y, m: mFreq, contrib: contrib.val(), every, atStart })
    const contribTotal = res.invested - P
    hr.set({
      n: res.balance, fmt: m, label: 'Future value',
      sub: `${m(P)}${contribTotal > 0 ? ` plus deposits of ${m(contrib.val())} ${every === 1 ? 'a month' : every === 3 ? 'a quarter' : 'a year'}` : ''} at ${fnum(r, 2)}%, compounded ${FREQ_NAME[freq.value].toLowerCase()}, for ${label}`,
      chips: [{ label: 'Interest earned', value: m(res.interest) }, { label: 'Total put in', value: m(res.invested) }],
      bar: [{ label: 'Principal', value: P, text: short(P, cur) }, ...(contribTotal > 0 ? [{ label: 'Deposits', value: contribTotal, text: short(contribTotal, cur) }] : []), { label: 'Interest', value: res.interest, text: short(res.interest, cur) }],
      copy: `${m(P)} at ${fnum(r, 2)}% compounded ${FREQ_NAME[freq.value].toLowerCase()} for ${label}${contribTotal > 0 ? ` with ${m(contrib.val())} deposits` : ''}: ${m(res.balance)} (interest ${m(res.interest)})`,
    })
    const double = res.ear > 0 ? Math.log(2) / Math.log(1 + res.ear / 100) : Infinity
    t.set([
      { label: 'Interest earned', n: res.interest, fmt: m, tone: 'amber', icon: 'percent', hint: `${fnum(res.invested > 0 ? (res.interest / res.invested) * 100 : 0, 1)}% on what you put in` },
      { label: 'Effective annual rate', value: pct(res.ear, 3), tone: 'teal', icon: 'trending-up', hint: mFreq === 1 ? 'same as the stated rate' : `vs ${fnum(r, 2)}% stated` },
      { label: 'Money doubles in', value: Number.isFinite(double) ? `${fnum(double, 1)} yr` : '-', tone: 'violet', icon: 'timer', hint: 'at this effective rate' },
    ])
    growthChart.render({
      type: 'bar', stacked: true, labels: res.rows.map((x) => `Y${x.year}`),
      datasets: [{ label: 'Money put in', data: res.rows.map((x) => x.invested), color: 0 }, { label: 'Interest earned', data: res.rows.map((x) => x.balance - x.invested), color: 1 }],
      format: m, axisFormat: (v) => short(v, cur),
    })
    tableHost.replaceChildren(table({
      columns: ['Year', { label: 'Deposits', num: true }, { label: 'Interest', num: true }, { label: 'Balance', num: true }],
      rows: res.rows.map((x) => [`Year ${x.year}`, m(x.deposits), m(x.interest), m(x.balance)]),
    }))
  }

  for (const f of [principal, years, months, days, contrib]) f.input.addEventListener('input', update)
  prefix()
  showMode()
  update()
  shell(root, layout(
    [card(only === 'simple' ? 'Simple interest' : only === 'compound' ? 'Compound interest' : 'Interest details', { icon: 'sliders-horizontal', right: curSel }, stack(modeSw, body))],
    [hr.el, t, note('Deposits are assumed to start earning from the day they are added, at the same effective rate. Real accounts may credit interest on set dates, so treat the result as a close estimate.')],
    below))
}
