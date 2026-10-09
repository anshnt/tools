// Trip cost calculator: fuel, tolls, parking, stay, food and extras, with the total and each person's share.
import { h, toggle } from '../../lib/ui.js'
import { shell, num, hero, tiles, card, layout, note, pills, pick, stepper, currencyPicker, chartBox, bars, listEditor, inline, money, short, fnum, firstIssue, stack, block, style } from './_shared.js'
import { fuelTrip, US_GALLON_L, UK_GALLON_L } from './_math.js'
import { EXAMPLE_PRICE } from './fuel-cost-calculator.js'

const EFF = [['kml', 'km per litre'], ['l100', 'litres per 100 km'], ['mpg', 'miles per US gallon'], ['mpguk', 'miles per UK gallon']]
const EFF_DEFAULT = { kml: 18, l100: 5.6, mpg: 42, mpguk: 50 }
const EFF_SUFFIX = { kml: 'km/l', l100: 'L/100km', mpg: 'mpg', mpguk: 'mpg UK' }
const PRICE_PER = { kml: 'litre', l100: 'litre', mpg: 'US gallon', mpguk: 'UK gallon' }
const BASE = { INR: { room: 2500, food: 600, toll: 400, park: 200 }, default: { room: 90, food: 30, toll: 15, park: 10 } }

const CSS = `
.tc-row { display: grid; grid-template-columns: minmax(0, 1fr) 130px; gap: 8px; }
.tc-row .cm-adorn { min-width: 0; }
@media (max-width: 420px) { .tc-row { grid-template-columns: minmax(0, 1fr) 112px; } }
`

export function mount(root) {
  style('tc-style', CSS)
  let cur = 'INR'
  let dist = 'km'
  let eff = 'kml'
  const curSel = currencyPicker((c) => { cur = c; defaults(); prefix(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const base = () => BASE[cur] || BASE.default
  const examplePrice = () => +((EXAMPLE_PRICE[cur] || 1) * (eff === 'mpg' ? US_GALLON_L : eff === 'mpguk' ? UK_GALLON_L : 1)).toFixed(2)

  const people = stepper('Travellers', { value: 4, min: 1, max: 30, onInput: () => update() })
  const nights = stepper('Nights away', { value: 2, min: 0, max: 60, onInput: () => { foodDays.set(nights.val() + 1); update() } })
  const distance = num('Distance (one way)', { value: 320, min: 0, max: 1e6, optional: true, suffix: 'km' })
  const distSel = pills([['km', 'Kilometres'], ['mi', 'Miles']], dist, (v) => { dist = v; distance.setSuffix(v); update() }, 'Distance unit')
  const round = toggle('Round trip', true, () => update())
  const effSel = pick(EFF, eff, (v) => { eff = v; effField.set(EFF_DEFAULT[v]); effField.setSuffix(EFF_SUFFIX[v]); price.set(examplePrice()); price.setLabel(`Fuel price per ${PRICE_PER[v]}`); update() }, 'Mileage unit')
  const effField = num('Mileage', { value: 18, min: 0.1, max: 1000, suffix: 'km/l' })
  const price = num('Fuel price per litre', { value: examplePrice(), min: 0, max: 1e6, optional: true, hint: 'An example value: type today’s price' })
  const tolls = num('Tolls (total for the trip)', { value: base().toll * 2, min: 0, max: 1e9, optional: true })
  const parking = num('Parking (total)', { value: base().park, min: 0, max: 1e9, optional: true })
  const room = num('Room price per night', { value: base().room, min: 0, max: 1e9, optional: true })
  const rooms = stepper('Rooms', { value: 2, min: 1, max: 20, onInput: () => update() })
  const foodDays = stepper('Days of meals', { value: 3, min: 0, max: 61, onInput: () => update() })
  const food = num('Food per person per day', { value: base().food, min: 0, max: 1e9, optional: true })
  const extras = [{ name: 'Tickets and activities', amount: 0 }]
  const extraList = listEditor({
    items: extras, addLabel: 'Add an expense', max: 10, min: 0, onChange: () => update(), newItem: () => ({ name: '', amount: 0 }),
    render: (it) => {
      const name = h('input', { class: 'input', type: 'text', placeholder: 'What for?', 'aria-label': 'Expense name', value: it.name, oninput: (e) => { it.name = e.target.value; update() } })
      const amt = inline('Expense amount', { value: it.amount, min: 0, max: 1e10, optional: true, prefix: sym(), onInput: () => { it.amount = amt.val(); update() } })
      amt.input.addEventListener('input', () => { it.amount = amt.val() })
      return h('div', { class: 'tc-row' }, name, amt)
    },
  })
  const buffer = pills([[0, 'None'], [5, '5%'], [10, '10%'], [15, '15%']], 0, () => update(), 'Buffer for surprises')

  const hr = hero({ label: 'Total trip cost', tone: 'ocean', icon: 'car' })
  const t = tiles()
  const donut = chartBox({ height: 250, ariaLabel: 'Trip cost by category' })
  const catBars = bars()

  function defaults() {
    const b = base()
    tolls.set(b.toll * 2); parking.set(b.park); room.set(b.room); food.set(b.food); price.set(examplePrice())
  }
  function prefix() { for (const f of [price, tolls, parking, room, food]) f.setPrefix(sym()) }

  function update() {
    const bad = firstIssue(distance, effField, price, tolls, parking, room, food) || (extras.find((e) => !(e.amount >= 0)) ? 'One of the extra expenses is not a valid amount' : '')
    if (bad) { hr.empty(bad); t.set([]); catBars.set([]); return }
    const m = (x) => money(x, cur)
    const n = people.val()
    const fuel = fuelTrip({ distance: distance.val(), distanceUnit: dist, efficiency: effField.val(), efficiencyUnit: eff, pricePerUnit: price.val(), roundTrip: round.input.checked })
    const stay = nights.val() * rooms.val() * room.val()
    const meals = food.val() * n * foodDays.val()
    const other = extras.reduce((s, e) => s + (e.amount || 0), 0)
    const cats = [['Fuel', fuel.cost, 1], ['Tolls', tolls.val(), 2], ['Parking', parking.val(), 4], ['Stay', stay, 0], ['Food', meals, 3], ['Other', other, 5]].filter((c) => c[1] > 0)
    const sub = cats.reduce((s, c) => s + c[1], 0)
    const bufAmt = (sub * buffer.value) / 100
    const total = sub + bufAmt
    const days = Math.max(1, nights.val() + 1)
    hr.set({
      n: total, fmt: m, label: 'Total trip cost',
      sub: `${fnum(n, 0)} traveller${n === 1 ? '' : 's'}, ${fnum(nights.val(), 0)} night${nights.val() === 1 ? '' : 's'}${bufAmt > 0 ? `, includes a ${buffer.value}% buffer` : ''}`,
      chips: [{ label: 'Per person', value: m(total / n) }, { label: 'Per day', value: m(total / days) }],
      bar: cats.map((c) => ({ label: c[0], value: c[1], text: short(c[1], cur) })),
      copy: `Trip total ${m(total)} for ${n} (${m(total / n)} each): ${cats.map((c) => `${c[0]} ${m(c[1])}`).join(', ')}${bufAmt > 0 ? `, buffer ${m(bufAmt)}` : ''}`,
    })
    t.set([
      { label: 'Each person pays', n: total / n, fmt: m, tone: 'indigo', icon: 'users' },
      { label: 'Fuel', n: fuel.cost, fmt: m, tone: 'orange', icon: 'fuel', hint: `${fnum(fuel.litres, 1)} L for ${fnum(fuel.km, 0)} km` },
      { label: 'Stay', n: stay, fmt: m, tone: 'violet', icon: 'bed-double', hint: `${nights.val()} night${nights.val() === 1 ? '' : 's'} x ${rooms.val()} room${rooms.val() === 1 ? '' : 's'}` },
      { label: 'Food', n: meals, fmt: m, tone: 'teal', icon: 'utensils', hint: `${n} x ${foodDays.val()} day${foodDays.val() === 1 ? '' : 's'}` },
    ])
    const all = [...cats.map((c) => [c[0], c[1], c[2]]), ...(bufAmt > 0 ? [['Buffer', bufAmt, 6]] : [])]
    donut.render({ type: 'doughnut', labels: all.map((c) => c[0]), datasets: [{ data: all.map((c) => c[1]), colors: all.map((c) => c[2]) }], format: m, center: { title: short(total, cur), caption: 'in total' } })
    catBars.set(all.map((c) => ({ key: c[0], label: c[0], value: c[1], text: `${m(c[1])} (${fnum(total > 0 ? (c[1] / total) * 100 : 0, 0)}%)`, color: undefined })), total)
  }

  for (const f of [distance, effField, price, tolls, parking, room, food]) f.input.addEventListener('input', update)
  prefix()
  update()
  const left = [
    card('Who and how long', { icon: 'users', right: curSel }, stack(h('div', { class: 'cm-grid2' }, people, nights))),
    card('Fuel', { icon: 'fuel' }, stack(block('Distance unit', distSel), distance, round, h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', 'Mileage unit')), effSel), effField, price)),
    card('Tolls, stay and food', { icon: 'bed-double' }, stack(h('div', { class: 'cm-grid2' }, tolls, parking), h('div', { class: 'cm-grid2' }, room, rooms), h('div', { class: 'cm-grid2' }, food, foodDays))),
    card('Anything else', { icon: 'ticket' }, stack(extraList, block('Buffer for surprises', buffer))),
  ]
  shell(root, layout(left, [hr.el, t, card('Where the money goes', { icon: 'chart-pie' }, donut, h('div', { style: { marginTop: '16px' } }, catBars)), note('Estimates only. Tolls, room rates and meal costs vary, so edit each line to match your plan.')]))
}
