// Fuel cost calculator: distance, mileage and fuel price in metric or imperial units, with round trip and cost sharing.
import { h, toggle } from '../../lib/ui.js'
import { shell, num, hero, tiles, card, layout, note, pills, pick, stepper, currencyPicker, money, fnum, firstIssue, stack, block, style } from './_shared.js'
import { fuelTrip, US_GALLON_L, UK_GALLON_L } from './_math.js'

// Example petrol prices per litre by currency. Only a starting point: type today's price.
export const EXAMPLE_PRICE = { INR: 100, USD: 1, EUR: 1.8, GBP: 1.5, AUD: 1.9, CAD: 1.6, SGD: 2.8, AED: 2.7, CHF: 1.8, JPY: 175, NZD: 2.7, ZAR: 24 }

const EFF = [['kml', 'km per litre'], ['l100', 'litres per 100 km'], ['mpg', 'miles per US gallon'], ['mpguk', 'miles per UK gallon']]
const EFF_DEFAULT = { kml: 18, l100: 5.6, mpg: 42, mpguk: 50 }
const EFF_SUFFIX = { kml: 'km/l', l100: 'L/100km', mpg: 'mpg', mpguk: 'mpg UK' }
const PRICE_PER = { kml: 'litre', l100: 'litre', mpg: 'US gallon', mpguk: 'UK gallon' }

const CSS = `
.fc-ref { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
.fc-ref div { padding: 10px 12px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); }
.fc-ref b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
.fc-ref span { font-size: 12px; color: var(--muted); }
`

export function mount(root) {
  style('fc-style', CSS)
  let cur = 'INR'
  let eff = 'kml'
  let dist = 'km'
  let priceDirty = false
  const curSel = currencyPicker((c) => { cur = c; prefix(); if (!priceDirty) price.set(examplePrice()); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const examplePrice = () => +((EXAMPLE_PRICE[cur] || 1) * (eff === 'mpg' ? US_GALLON_L : eff === 'mpguk' ? UK_GALLON_L : 1)).toFixed(2)
  const distance = num('Distance', { value: 350, min: 0.1, max: 1e6, suffix: 'km' })
  const distSel = pills([['km', 'Kilometres'], ['mi', 'Miles']], dist, (v) => { dist = v; distance.setSuffix(v === 'mi' ? 'mi' : 'km'); update() }, 'Distance unit')
  const effSel = pick(EFF, eff, (v) => { eff = v; effField.set(EFF_DEFAULT[v]); effField.setSuffix(EFF_SUFFIX[v]); price.setLabel(priceLabel()); if (!priceDirty) price.set(examplePrice()); update() }, 'Mileage unit')
  const effField = num('Mileage', { value: EFF_DEFAULT.kml, min: 0.1, max: 1000, suffix: EFF_SUFFIX.kml })
  const priceLabel = () => `Fuel price per ${PRICE_PER[eff]}`
  const price = num(priceLabel(), { value: examplePrice(), min: 0, max: 1e6, hint: 'An example value: type today’s price at your pump' })
  const round = toggle('Round trip (double the distance)', false, () => update())
  const people = stepper('Sharing the cost between', { value: 1, min: 1, max: 20, onInput: () => update() })
  const tank = num('Tank size (optional)', { value: 40, min: 0, max: 1000, optional: true, suffix: 'L', hint: 'Shows how many tank-fulls the trip needs' })
  const hr = hero({ label: 'Fuel cost', tone: 'sunset', icon: 'fuel' })
  const t = tiles()
  const refHost = h('div', { class: 'fc-ref' })

  function prefix() { price.setPrefix(sym()) }

  function update() {
    price.setLabel(priceLabel())
    const bad = firstIssue(distance, effField, price, tank)
    if (bad) { hr.empty(bad); t.set([]); refHost.replaceChildren(); return }
    const m = (x, d = 2) => money(x, cur, d)
    const r = fuelTrip({ distance: distance.val(), distanceUnit: dist, efficiency: effField.val(), efficiencyUnit: eff, pricePerUnit: price.val(), roundTrip: round.input.checked })
    const n = people.val() || 1
    const showMi = dist === 'mi'
    const fuelUnit = eff === 'mpg' ? 'US gal' : eff === 'mpguk' ? 'UK gal' : 'L'
    const fuelAmt = eff === 'mpg' ? r.litres / US_GALLON_L : eff === 'mpguk' ? r.litres / UK_GALLON_L : r.litres
    const totalDist = showMi ? r.km / 1.609344 : r.km
    hr.set({
      n: r.cost, fmt: m, label: 'Fuel cost',
      sub: `${fnum(totalDist, 1)} ${showMi ? 'miles' : 'km'}${round.input.checked ? ' (round trip)' : ''} at ${fnum(effField.val(), 2)} ${EFF.find((e) => e[0] === eff)[1]}`,
      chips: [{ label: 'Fuel needed', value: `${fnum(fuelAmt, 2)} ${fuelUnit}` }, { label: `Cost per ${showMi ? 'mile' : 'km'}`, value: m(showMi ? r.perKm * 1.609344 : r.perKm, 3) }],
      copy: `Fuel for ${fnum(totalDist, 1)} ${showMi ? 'miles' : 'km'}: ${fnum(fuelAmt, 2)} ${fuelUnit}, costing ${m(r.cost)}${n > 1 ? ` (${m(r.cost / n)} each for ${n} people)` : ''}`,
    })
    const tl = [
      { label: 'Fuel needed', value: `${fnum(fuelAmt, 2)} ${fuelUnit}`, tone: 'orange', icon: 'fuel' },
      { label: `Cost per ${showMi ? 'mile' : 'km'}`, n: showMi ? r.perKm * 1.609344 : r.perKm, fmt: (v) => m(v, 3), tone: 'pink', icon: 'route' },
      ...(n > 1 ? [{ label: 'Each person pays', n: r.cost / n, fmt: m, tone: 'indigo', icon: 'users', hint: `${n} people sharing` }] : []),
      ...(tank.val() > 0 ? [{ label: 'Tank-fulls', value: fnum(r.litres / tank.val(), 2), tone: 'teal', icon: 'gauge', hint: `of a ${fnum(tank.val(), 0)} L tank` }] : []),
    ]
    t.set(tl)
    const steps = showMi ? [10, 50, 100, 250, 500] : [10, 50, 100, 250, 500]
    refHost.replaceChildren(...steps.map((d) => { const x = fuelTrip({ distance: d, distanceUnit: dist, efficiency: effField.val(), efficiencyUnit: eff, pricePerUnit: price.val() }); return h('div', h('b', m(x.cost)), h('span', `${d} ${showMi ? 'mi' : 'km'}`)) }))
  }

  for (const f of [distance, effField, price, tank]) f.input.addEventListener('input', update)
  price.input.addEventListener('input', () => { priceDirty = true })
  prefix()
  update()
  shell(root, layout(
    [card('Your trip', { icon: 'route', right: curSel }, stack(block('Distance unit', distSel), distance, h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', 'Mileage unit')), effSel), effField, price, round, people, tank))],
    [hr.el, t, card('Quick reference', { icon: 'list' }, refHost), note('Real mileage changes with traffic, load, speed and air conditioning. Use your own recent average for the best estimate.')]))
}
