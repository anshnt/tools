// Electricity bill estimator: appliances (watts x hours x days) or plain units, priced with an editable slab tariff.
import { h, button } from '../../lib/ui.js'
import { shell, num, inline, hero, tiles, bars, card, layout, note, switcher, currencyPicker, chartBox, listEditor, money, fnum, firstIssue, stack, style } from './_shared.js'
import { slabBill } from './_math.js'
import { load, save } from '../../lib/store.js'

/** Units (kWh) for one appliance row in a month. */
export const monthlyKwh = (a) => ((a.watts || 0) * (a.qty || 0) * (a.hours || 0) * (a.days || 0)) / 1000

const PRESETS = [
  ['Ceiling fan', 75, 1, 8, 30], ['LED bulb', 9, 1, 5, 30], ['Tube light', 20, 1, 5, 30], ['Refrigerator (average)', 70, 1, 24, 30], ['TV', 100, 1, 4, 30],
  ['AC 1.5 ton (inverter, average)', 1200, 1, 6, 30], ['Geyser', 2000, 1, 0.5, 30], ['Washing machine', 500, 1, 1, 12], ['Laptop', 60, 1, 6, 30], ['Wi-Fi router', 10, 1, 24, 30],
  ['Mixer grinder', 500, 1, 0.25, 30], ['Microwave', 1200, 1, 0.3, 20], ['Water pump', 750, 1, 1, 30], ['Iron', 1000, 1, 0.5, 20], ['Induction cooktop', 1800, 1, 1, 30],
]
const DEFAULT_APPLIANCES = [
  { name: 'Ceiling fan', watts: 75, qty: 3, hours: 8, days: 30 }, { name: 'LED bulb', watts: 9, qty: 6, hours: 5, days: 30 }, { name: 'Refrigerator (average)', watts: 70, qty: 1, hours: 24, days: 30 },
  { name: 'TV', watts: 100, qty: 1, hours: 4, days: 30 }, { name: 'Wi-Fi router', watts: 10, qty: 1, hours: 24, days: 30 },
]
// A sample slab tariff. Replace it with the rates printed on your own bill.
const SAMPLE_TARIFF = { slabs: [{ upTo: 100, rate: 3.5 }, { upTo: 200, rate: 5 }, { upTo: 400, rate: 6.5 }, { upTo: Infinity, rate: 8 }], fixed: 120, tax: 5 }
const KEY = 'cm:eb'

const CSS = `
.eb-presets { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 8px; margin: 0 -2px; scrollbar-width: thin; }
.eb-presets button { flex: none; height: 34px; padding: 0 12px; border-radius: 999px; border: 1px dashed var(--border-strong); background: var(--surface); color: var(--text-2); font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: transform .2s var(--spring), border-color .2s, background .2s; }
.eb-presets button:hover { border-color: var(--accent); background: var(--accent-soft); transform: translateY(-1px); }
.eb-presets button .icon { width: 14px; height: 14px; }
.eb-app { display: grid; grid-template-columns: minmax(0, 1.5fr) repeat(4, minmax(0, 1fr)); gap: 8px; align-items: end; }
.eb-f { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.eb-cap { font-size: 11.5px; color: var(--muted); font-weight: 600; }
.eb-kwh { grid-column: 1 / -1; font-size: 12.5px; color: var(--muted); }
.eb-kwh b { color: var(--text); font-variant-numeric: tabular-nums; }
.eb-app .input { height: 42px; border-radius: 12px; font-weight: 600; }
.eb-slab { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; align-items: end; }
@media (max-width: 720px) { .eb-app { grid-template-columns: repeat(2, minmax(0, 1fr)); } .eb-app > .eb-f:first-child { grid-column: 1 / -1; } }
`

export function mount(root) {
  style('eb-style', CSS)
  const saved = load(KEY, null)
  let cur = 'INR'
  let mode = 'appliances'
  const curSel = currencyPicker((c) => { cur = c; prefix(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const appliances = (saved?.appliances || DEFAULT_APPLIANCES).map((a) => ({ ...a }))
  const slabs = (saved?.slabs || SAMPLE_TARIFF.slabs).map((s) => ({ upTo: s.upTo == null ? Infinity : s.upTo, rate: s.rate }))
  const modeSw = switcher([['appliances', 'From my appliances', 'plug-zap'], ['units', 'From units used', 'gauge']], mode, (v) => { mode = v; showMode(); update() }, 'How to find the units')
  const units = num('Units used this month', { value: 220, min: 0, max: 1e6, suffix: 'kWh', hint: 'The kWh figure printed on your last bill' })
  const fixed = num('Fixed charge per month', { value: saved?.fixed ?? SAMPLE_TARIFF.fixed, min: 0, max: 1e7, optional: true })
  const tax = num('Duty and taxes on the bill', { value: saved?.tax ?? SAMPLE_TARIFF.tax, min: 0, max: 100, optional: true, suffix: '%', hint: 'Electricity duty, fuel surcharge and similar, as a share of the bill' })

  const appList = listEditor({
    items: appliances, addLabel: 'Add an appliance', max: 40, min: 0, onChange: () => update(), newItem: () => ({ name: '', watts: 100, qty: 1, hours: 4, days: 30 }),
    render: (a) => {
      const name = h('input', { class: 'input', type: 'text', placeholder: 'Appliance', 'aria-label': 'Appliance name', value: a.name, oninput: (e) => { a.name = e.target.value; update() } })
      const mk = (cap, key, o) => { const f = inline(`${cap} for ${a.name || 'appliance'}`, { value: a[key], min: 0, max: o.max, optional: true, onInput: () => {} }); f.input.addEventListener('input', () => { a[key] = f.val(); kw.querySelector('b').textContent = fnum(monthlyKwh(a), 2); update() }); return h('div', { class: 'eb-f' }, h('span', { class: 'eb-cap' }, cap), f) }
      const kw = h('div', { class: 'eb-kwh' }, 'Uses ', h('b', fnum(monthlyKwh(a), 2)), ' units a month')
      return h('div', { class: 'eb-app' }, h('div', { class: 'eb-f' }, h('span', { class: 'eb-cap' }, 'Appliance'), name), mk('Watts', 'watts', { max: 100000 }), mk('How many', 'qty', { max: 1000 }), mk('Hours a day', 'hours', { max: 24 }), mk('Days a month', 'days', { max: 31 }), kw)
    },
  })
  const presetRow = h('div', { class: 'eb-presets', role: 'group', 'aria-label': 'Quick add' }, PRESETS.map(([name, watts, qty, hours, days]) => button(name, { icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => { appliances.push({ name, watts, qty, hours, days }); appList.redraw(); update() } })))

  const slabList = listEditor({
    items: slabs, addLabel: 'Add a slab', max: 8, min: 1, onChange: () => { fixLast(); slabList.redraw(); update() },
    add: () => { const prev = slabs.length > 1 ? slabs[slabs.length - 2].upTo : 0; const last = slabs.pop(); slabs.push({ upTo: prev + 100, rate: last.rate }, last) },
    render: (s, i) => {
      const lastRow = i === slabs.length - 1
      const upTo = lastRow ? h('div', { class: 'eb-f' }, h('span', { class: 'eb-cap' }, 'Units'), h('div', { class: 'cm-adorn sm' }, h('span', { class: 'pre' }, `Above ${fnum(i > 0 ? slabs[i - 1].upTo : 0, 0)}`))) : (() => { const f = inline('Up to units', { value: s.upTo, min: 1, max: 1e7 }); f.input.addEventListener('input', () => { s.upTo = f.val(); update() }); return h('div', { class: 'eb-f' }, h('span', { class: 'eb-cap' }, 'Up to (units)'), f) })()
      const rate = inline('Rate per unit', { value: s.rate, min: 0, max: 1e4 })
      rate.input.addEventListener('input', () => { s.rate = rate.val(); update() })
      return h('div', { class: 'eb-slab' }, upTo, h('div', { class: 'eb-f' }, h('span', { class: 'eb-cap' }, 'Rate per unit'), rate))
    },
  })
  const resetTariff = button('Use the sample tariff', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: () => { slabs.splice(0, slabs.length, ...SAMPLE_TARIFF.slabs.map((s) => ({ ...s }))); fixed.set(SAMPLE_TARIFF.fixed); tax.set(SAMPLE_TARIFF.tax); slabList.redraw(); update() } })

  const hr = hero({ label: 'Estimated bill', tone: 'gold', icon: 'zap' })
  const t = tiles()
  const slabBars = bars()
  const useBars = bars()
  const donut = chartBox({ height: 250, ariaLabel: 'Which appliances use the most power' })
  const appBox = h('div')
  const body = h('div', { class: 'cm-stack' })

  function showMode() { body.replaceChildren(mode === 'units' ? units : h('div', { class: 'cm-stack' }, presetRow, appList)); appBox.hidden = mode === 'units' }
  function prefix() { fixed.setPrefix(sym()) }
  function fixLast() { slabs[slabs.length - 1].upTo = Infinity }

  function update() {
    const m = (x) => money(x, cur, 2)
    fixLast()
    let issue = firstIssue(fixed, tax, ...(mode === 'units' ? [units] : []))
    for (let i = 0; i < slabs.length && !issue; i++) {
      const s = slabs[i]
      if (!(s.rate >= 0)) issue = `Tariff slab ${i + 1}: enter a rate per unit`
      else if (i < slabs.length - 1 && !(s.upTo > (i ? slabs[i - 1].upTo : 0))) issue = `Tariff slab ${i + 1}: the upper limit must be higher than the one before it`
    }
    if (!issue && mode === 'appliances' && appliances.some((a) => !(a.watts >= 0) || !(a.qty >= 0) || !(a.hours >= 0) || !(a.days >= 0))) issue = 'One of the appliances has an invalid number'
    if (issue) { hr.empty(issue); t.set([]); slabBars.set([]); useBars.set([]); return }
    const kwh = mode === 'units' ? units.val() : appliances.reduce((s, a) => s + monthlyKwh(a), 0)
    const { energy, parts } = slabBill(kwh, slabs)
    const fixedC = fixed.val()
    const taxC = ((energy + fixedC) * tax.val()) / 100
    const total = energy + fixedC + taxC
    hr.set({
      n: total, fmt: m, label: 'Estimated bill (per month)',
      sub: `${fnum(kwh, 1)} units at your tariff, ${fnum(kwh > 0 ? total / kwh : 0, 2)} per unit all in`,
      chips: [{ label: 'Units used', value: `${fnum(kwh, 1)} kWh` }, { label: 'Energy charge', value: m(energy) }],
      bar: [{ label: 'Energy', value: energy, text: m(energy) }, { label: 'Fixed', value: fixedC, text: m(fixedC) }, { label: 'Taxes', value: taxC, text: m(taxC) }],
      copy: `Estimated electricity bill ${m(total)} for ${fnum(kwh, 1)} units (energy ${m(energy)}, fixed ${m(fixedC)}, taxes ${m(taxC)})`,
    })
    t.set([
      { label: 'Energy charge', n: energy, fmt: m, tone: 'amber', icon: 'zap' },
      { label: 'Fixed and taxes', n: fixedC + taxC, fmt: m, tone: 'orange', icon: 'receipt', hint: `${m(fixedC)} fixed + ${m(taxC)} taxes` },
      { label: 'Per day', n: total / 30, fmt: m, tone: 'pink', icon: 'sun' },
      { label: 'Per year at this use', n: total * 12, fmt: m, tone: 'indigo', icon: 'calendar-check' },
    ])
    slabBars.set(parts.map((p, i) => ({ key: `s${i}`, label: `${fnum(p.from, 0)} to ${fnum(p.to, 0)} units at ${fnum(p.rate, 2)}`, value: p.cost, text: `${fnum(p.units, 1)} units = ${m(p.cost)}` })))
    if (mode === 'appliances') {
      const sorted = appliances.map((a) => ({ name: a.name || 'Appliance', kwh: monthlyKwh(a) })).filter((a) => a.kwh > 0).sort((a, b) => b.kwh - a.kwh)
      useBars.set(sorted.slice(0, 8).map((a, i) => ({ key: `${a.name}${i}`, label: a.name, value: a.kwh, text: `${fnum(a.kwh, 1)} units, about ${m(kwh > 0 ? (a.kwh / kwh) * energy : 0)}` })), sorted[0]?.kwh)
      const top = sorted.slice(0, 7)
      const rest = sorted.slice(7).reduce((s, a) => s + a.kwh, 0)
      donut.render({ type: 'doughnut', labels: [...top.map((a) => a.name), ...(rest > 0 ? ['Others'] : [])], datasets: [{ data: [...top.map((a) => a.kwh), ...(rest > 0 ? [rest] : [])], colors: [...top.map((_, i) => i), 7] }], format: (v) => `${fnum(v, 1)} units`, center: { title: fnum(kwh, 0), caption: 'units a month' } })
    }
    save(KEY, { appliances, slabs: slabs.map((s) => ({ upTo: Number.isFinite(s.upTo) ? s.upTo : null, rate: s.rate })), fixed: fixed.val(), tax: tax.val() })
  }

  for (const f of [units, fixed, tax]) f.input.addEventListener('input', update)
  prefix()
  showMode()
  update()
  const tariff = card('Your tariff', { icon: 'receipt', right: resetTariff }, stack(
    note('A sample slab tariff is filled in. Replace it with the rates on your own bill.'), slabList, h('div', { class: 'cm-grid2' }, fixed, tax)))
  appBox.append(card('Who uses the most', { icon: 'chart-pie' }, donut, h('div', { style: { marginTop: '16px' } }, useBars)))
  shell(root, layout(
    [card('Your usage', { icon: 'plug-zap', right: curSel }, stack(modeSw, body)), tariff],
    [hr.el, t, card('Bill by slab', { icon: 'layers' }, slabBars), appBox, note('The split by appliance shares the energy charge in proportion to units. If your board bills every two months, enter two months of units and double the slab limits.')]))
}
