// Inflation calculator: what something costs in the future, or what a future amount is worth today. Defaults to an India-style 6% a year.
import { h, table } from '../../lib/ui.js'
import { shell, num, slide, hero, tiles, card, layout, note, switcher, pills, currencyPicker, chartBox, money, short, fnum, pct, firstIssue, stack, block } from './_shared.js'

/** Cost after `years` of inflation at ratePct a year. */
export const futureCost = (amount, ratePct, years) => amount * (1 + ratePct / 100) ** years
/** What an amount received after `years` is worth in today's money. */
export const presentValue = (amount, ratePct, years) => amount / (1 + ratePct / 100) ** years
/** Real return after inflation (Fisher): (1 + nominal) / (1 + inflation) - 1, in percent. */
export const realReturn = (nominalPct, inflationPct) => ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100

export function mount(root) {
  let cur = 'INR'
  let mode = 'future'
  const curSel = currencyPicker((c) => { cur = c; prefix(); amount.set(c === 'INR' ? 100000 : 1000); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const modeSw = switcher([['future', 'Future cost of today’s money', 'trending-up'], ['present', 'Today’s worth of a future amount', 'trending-down']], mode, (v) => { mode = v; amount.setLabel(label()); update() }, 'What to work out')
  const label = () => (mode === 'future' ? 'Amount or price today' : 'Amount you will get in the future')
  const amount = num(label(), { value: 100000, min: 0, max: 1e15 })
  const rate = slide('Inflation per year', { min: 0, max: 15, step: 0.1, value: 6, hardMin: -50, hardMax: 200, suffix: '%', tickFormat: (v) => `${v}%`, onInput: () => update() })
  const presets = pills([[2, '2%'], [4, '4%'], [6, '6%'], [8, '8%'], [10, '10%']], 6, (v) => { rate.set(v); update() }, 'Common inflation rates')
  const years = slide('Number of years', { min: 1, max: 40, step: 1, value: 10, hardMin: 0.01, hardMax: 100, suffix: 'yr', tickFormat: (v) => `${v} yr`, onInput: () => update() })
  const invest = num('Your investment return (optional)', { value: 8, min: -100, max: 1000, optional: true, suffix: '%', hint: 'See what it is worth after inflation' })
  const hr = hero({ label: 'Future cost', tone: 'sunset', icon: 'trending-up' })
  const t = tiles()
  const chart = chartBox({ height: 270, ariaLabel: 'Prices and buying power over the years' })
  const tableHost = h('div')
  function prefix() { amount.setPrefix(sym()) }

  function update() {
    rate.setHint(rate.raw() === 6 ? 'roughly India’s long-run average' : '')
    presets.set([2, 4, 6, 8, 10].includes(rate.raw()) ? rate.raw() : null)
    const bad = firstIssue(amount, rate, years, invest)
    if (bad) { hr.empty(bad); t.set([]); tableHost.replaceChildren(); return }
    const m = (x) => money(x, cur)
    const a = amount.val()
    const r = rate.val()
    const y = years.val()
    const fv = futureCost(a, r, y)
    const pvv = presentValue(a, r, y)
    const rise = (futureCost(1, r, y) - 1) * 100
    const keep = (presentValue(1, r, y)) * 100
    if (mode === 'future') {
      hr.set({
        n: fv, fmt: m, label: `Cost in ${fnum(y, 2)} years`, sub: `Something that costs ${m(a)} today, with prices rising ${fnum(r, 2)}% a year`,
        chips: [{ label: 'Prices rise by', value: pct(rise, 1) }, { label: 'Today’s money buys', value: `${fnum(keep, 1)}% as much` }],
        copy: `At ${fnum(r, 2)}% inflation, ${m(a)} today is like ${m(fv)} in ${fnum(y, 2)} years (and ${m(a)} then buys what ${m(pvv)} buys today)`,
      })
    } else {
      hr.set({
        n: pvv, fmt: m, label: 'Worth in today’s money', sub: `${m(a)} received in ${fnum(y, 2)} years buys what this much buys today, at ${fnum(r, 2)}% inflation`,
        chips: [{ label: 'You lose', value: m(a - pvv) }, { label: 'Buying power kept', value: pct(keep, 1) }],
        copy: `${m(a)} in ${fnum(y, 2)} years is worth ${m(pvv)} in today’s money at ${fnum(r, 2)}% inflation`,
      })
    }
    const tl = mode === 'future'
      ? [
        { label: 'Price rise', value: pct(rise, 1), tone: 'orange', icon: 'trending-up', hint: `${m(fv - a)} more than today` },
        { label: 'Buying power of the same money', n: pvv, fmt: m, tone: 'red', icon: 'trending-down', hint: `${m(a)} in ${fnum(y, 2)} years buys what this buys now` },
        { label: 'Prices double in', value: r > 0 ? `${fnum(Math.log(2) / Math.log(1 + r / 100), 1)} yr` : '-', tone: 'violet', icon: 'timer' },
      ]
      : [
        { label: 'Value lost to inflation', n: a - pvv, fmt: m, tone: 'red', icon: 'trending-down', hint: `${fnum(100 - keep, 1)}% of the amount` },
        { label: 'Same buying power needs', n: fv, fmt: m, tone: 'orange', icon: 'trending-up', hint: `to match ${m(a)} of today` },
        { label: 'Prices double in', value: r > 0 ? `${fnum(Math.log(2) / Math.log(1 + r / 100), 1)} yr` : '-', tone: 'violet', icon: 'timer' },
      ]
    if (invest.val() && invest.val() !== 0) {
      const real = realReturn(invest.val(), r)
      tl.push({ label: 'Real return after inflation', value: pct(real, 2), tone: real >= 0 ? 'green' : 'red', icon: 'sprout', hint: `${fnum(invest.val(), 2)}% earned, ${fnum(r, 2)}% lost to prices` })
    }
    t.set(tl)
    const steps = Math.min(40, Math.max(1, Math.ceil(y)))
    const rows = []
    for (let i = 0; i <= steps; i++) { const yy = Math.min(i, y); rows.push({ year: i === steps ? y : yy, cost: futureCost(a, r, i === steps ? y : yy), worth: presentValue(a, r, i === steps ? y : yy) }) }
    chart.render({
      type: 'line', labels: rows.map((x) => (x.year === 0 ? 'Now' : `${fnum(x.year, 1)}y`)),
      datasets: mode === 'future'
        ? [{ label: 'What it costs', data: rows.map((x) => x.cost), color: 1 }, { label: 'Buying power of today’s money', data: rows.map((x) => x.worth), color: 0, fill: false }]
        : [{ label: 'Worth in today’s money', data: rows.map((x) => x.worth), color: 0 }, { label: 'Amount needed to match', data: rows.map((x) => x.cost), color: 1, fill: false }],
      format: m, axisFormat: (v) => short(v, cur), beginAtZero: false,
    })
    tableHost.replaceChildren(table({
      columns: ['Year', { label: mode === 'future' ? 'Cost' : 'Amount needed', num: true }, { label: 'Buying power of the amount', num: true }],
      rows: rows.slice(1).map((x) => [`Year ${fnum(x.year, 2)}`, m(x.cost), m(x.worth)]),
    }))
  }

  for (const f of [amount, invest]) f.input.addEventListener('input', update)
  prefix()
  update()
  shell(root, layout(
    [card('Inflation', { icon: 'sliders-horizontal', right: curSel }, stack(modeSw, amount, rate, block('Quick rates', presets), years, invest))],
    [hr.el, t, note('Inflation changes from year to year and differs for food, fuel, rent and education. Use the rate you expect for the thing you are planning for.')],
    stack(card('Year by year', { icon: 'chart-line' }, chart), card('The numbers', { icon: 'table' }, tableHost))))
}
