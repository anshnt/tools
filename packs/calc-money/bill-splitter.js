// Bill splitter: split a bill evenly or by items. Tax and tip are shared in proportion to what each person ordered.
import { h, icon, table } from '../../lib/ui.js'
import { shell, num, inline, hero, bars, card, layout, note, switcher, pick, currencyPicker, listEditor, money, firstIssue, stack, block, style } from './_shared.js'

const cents = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** Round shares to cents so that they add up to exactly `total` (the largest share absorbs the rounding difference). */
export function roundShares(shares, total) {
  const rounded = shares.map(cents)
  const diff = cents(total - rounded.reduce((s, x) => s + x, 0))
  if (diff !== 0 && rounded.length) {
    let big = 0
    rounded.forEach((x, i) => { if (x > rounded[big]) big = i })
    rounded[big] = cents(rounded[big] + diff)
  }
  return rounded
}

/**
 * Split a bill.
 *  people: [{id}] items: [{price, by: [ids]}] (by-items mode) or bill (even mode)
 *  taxPct/taxAmount and tipPct/tipAmount: pass either form; tax and tip are shared in proportion to each person's subtotal
 * Returns { subtotal, tax, tip, total, rows: [{id, subtotal, tax, tip, total}] }
 */
export function splitBill({ people, items, bill = 0, mode, tax = { kind: 'pct', value: 0 }, tip = { kind: 'pct', value: 0 } }) {
  let subs
  let subtotal
  if (mode === 'even') {
    subtotal = bill
    subs = people.map(() => bill / people.length)
  } else {
    subs = people.map((p) => items.reduce((s, it) => s + (it.by.includes(p.id) ? it.price / it.by.length : 0), 0))
    subtotal = items.reduce((s, it) => s + it.price, 0)
  }
  const taxTotal = tax.kind === 'pct' ? (subtotal * tax.value) / 100 : tax.value
  const tipTotal = tip.kind === 'pct' ? (subtotal * tip.value) / 100 : tip.value
  const total = cents(subtotal + taxTotal + tipTotal)
  const weights = subs.map((s) => (subtotal > 0 ? s / subtotal : 1 / people.length))
  const totals = roundShares(weights.map((w) => w * (subtotal + taxTotal + tipTotal)), total)
  return {
    subtotal, tax: taxTotal, tip: tipTotal, total,
    rows: people.map((p, i) => ({ id: p.id, subtotal: subs[i], tax: weights[i] * taxTotal, tip: weights[i] * tipTotal, total: totals[i] })),
  }
}

const CSS = `
.bs-person { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; }
.bs-avatar { width: 34px; height: 34px; border-radius: 12px; display: grid; place-items: center; font-weight: 700; font-size: 13px; color: #fff; background: var(--k); }
.bs-item { display: flex; flex-direction: column; gap: 8px; }
.bs-item-top { display: grid; grid-template-columns: minmax(0, 1fr) 130px; gap: 8px; }
.bs-by { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.bs-by .cap { font-size: 12px; color: var(--muted); margin-right: 2px; }
.bs-chip { height: 30px; padding: 0 11px; border-radius: 99px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 12.5px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: transform .2s var(--spring), background .2s, color .2s, border-color .2s; }
.bs-chip:active { transform: scale(.93); }
.bs-chip[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
.bs-chip .icon { width: 12px; height: 12px; }
.bs-fee { display: grid; grid-template-columns: minmax(0, 1fr) 118px; gap: 8px; align-items: end; }
.bs-fee .select { height: 50px; border-radius: 15px; font-size: 13.5px; }
.bs-pay { display: flex; flex-direction: column; gap: 14px; }
@media (max-width: 420px) { .bs-item-top { grid-template-columns: minmax(0, 1fr) 112px; } }
`
const TONES = ['#5b4cf0', '#f97316', '#ec4899', '#0d9488', '#ca8a04', '#0284c7', '#9333ea', '#65a30d', '#e11d48', '#0891b2', '#7c3aed', '#16a34a']

export function mount(root) {
  style('bs-style', CSS)
  let cur = 'INR'
  let mode = 'items'
  let nextId = 4
  const curSel = currencyPicker((c) => { cur = c; prefix(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const people = [{ id: 1, name: 'Asha' }, { id: 2, name: 'Ben' }, { id: 3, name: 'Chen' }]
  const items = [
    { name: 'Pizza', price: 640, by: [1, 2, 3] }, { name: 'Pasta', price: 420, by: [1] }, { name: 'Burger', price: 380, by: [2] }, { name: 'Dessert', price: 300, by: [2, 3] },
  ]
  const modeSw = switcher([['items', 'By items', 'list-checks'], ['even', 'Split evenly', 'equal']], mode, (v) => { mode = v; showMode(); update() }, 'How to split')
  const bill = num('Bill amount (before tax and tip)', { value: 1800, min: 0, max: 1e10 })
  const taxKind = pick([['pct', '% of bill'], ['amount', 'Amount']], 'pct', () => update(), 'Tax type')
  const tax = num('Tax', { value: 5, min: 0, max: 1e10, optional: true })
  const tipKind = pick([['pct', '% of bill'], ['amount', 'Amount']], 'pct', () => update(), 'Tip type')
  const tip = num('Tip', { value: 10, min: 0, max: 1e10, optional: true })

  const peopleList = listEditor({
    items: people, addLabel: 'Add a person', max: 12, min: 2, onChange: () => { cleanItems(); itemList.redraw(); update() }, newItem: () => ({ id: nextId++, name: '' }),
    render: (p, i) => {
      const av = h('span', { class: 'bs-avatar' }, (p.name || String(i + 1)).slice(0, 1).toUpperCase())
      const nameIn = h('input', { class: 'input', type: 'text', placeholder: `Person ${i + 1}`, 'aria-label': `Name of person ${i + 1}`, value: p.name, oninput: (e) => { p.name = e.target.value; av.textContent = (p.name.trim() || String(i + 1)).slice(0, 1).toUpperCase(); itemList.redraw(); update() } })
      return h('div', { class: 'bs-person', style: { '--k': TONES[i % TONES.length] } }, av, nameIn)
    },
  })
  function cleanItems() { const ids = new Set(people.map((p) => p.id)); for (const it of items) it.by = it.by.filter((id) => ids.has(id)) }
  const label = (p, i) => p.name.trim() || `Person ${i + 1}`
  const itemList = listEditor({
    items, addLabel: 'Add an item', max: 40, min: 1, onChange: () => update(), newItem: () => ({ name: '', price: 0, by: people.map((p) => p.id) }),
    render: (it) => {
      const name = h('input', { class: 'input', type: 'text', placeholder: 'Item', 'aria-label': 'Item name', value: it.name, oninput: (e) => { it.name = e.target.value; update() } })
      const price = inline('Item price', { value: it.price, min: 0, max: 1e10, prefix: sym(), onInput: () => {} })
      price.input.addEventListener('input', () => { it.price = price.val(); update() })
      const chips = people.map((p, i) => h('button', { type: 'button', class: 'bs-chip', 'aria-pressed': String(it.by.includes(p.id)), onclick: (e) => {
        it.by = it.by.includes(p.id) ? it.by.filter((x) => x !== p.id) : [...it.by, p.id]
        e.currentTarget.setAttribute('aria-pressed', String(it.by.includes(p.id)))
        update()
      } }, label(p, i)))
      const all = h('button', { type: 'button', class: 'bs-chip', onclick: () => { it.by = people.map((p) => p.id); chips.forEach((c) => c.setAttribute('aria-pressed', 'true')); update() } }, icon('users'), 'Everyone')
      return h('div', { class: 'bs-item' }, h('div', { class: 'bs-item-top' }, name, price), h('div', { class: 'bs-by' }, h('span', { class: 'cap' }, 'Shared by'), all, chips))
    },
  })

  const hr = hero({ label: 'Total bill', tone: 'rose', icon: 'split' })
  const payBars = bars()
  const payBox = h('div', { class: 'bs-pay' })
  const itemsBox = h('div', { class: 'cm-stack' })
  function prefix() { for (const f of [bill, tax, tip]) f.setPrefix(sym()); tax.setSuffix(taxKind.value === 'pct' ? '%' : ''); tip.setSuffix(tipKind.value === 'pct' ? '%' : '') }
  function showMode() { itemsBox.replaceChildren(mode === 'items' ? stack(block('Items', itemList)) : bill); }

  function update() {
    tax.setPrefix(taxKind.value === 'amount' ? sym() : ''); tax.setSuffix(taxKind.value === 'pct' ? '%' : '')
    tip.setPrefix(tipKind.value === 'amount' ? sym() : ''); tip.setSuffix(tipKind.value === 'pct' ? '%' : '')
    tax.setRange(0, taxKind.value === 'pct' ? 100 : 1e10); tip.setRange(0, tipKind.value === 'pct' ? 100 : 1e10)
    let bad = firstIssue(tax, tip, ...(mode === 'even' ? [bill] : []))
    if (!bad && mode === 'items') {
      const bi = items.findIndex((it) => !(it.price >= 0))
      const un = items.findIndex((it) => it.price > 0 && it.by.length === 0)
      if (bi >= 0) bad = `Item ${bi + 1}: enter a price`
      else if (un >= 0) bad = `${items[un].name || `Item ${un + 1}`}: choose at least one person who shares it`
      else if (!(items.reduce((s, it) => s + it.price, 0) > 0)) bad = 'Add the prices of what you ordered'
    }
    if (bad) { hr.empty(bad); payBars.set([]); return }
    const m = (x) => money(x, cur, 2)
    const r = splitBill({ people, items, bill: bill.val(), mode, tax: { kind: taxKind.value, value: tax.val() }, tip: { kind: tipKind.value, value: tip.val() } })
    const names = people.map(label)
    const each = r.total / people.length
    hr.set({
      n: r.total, fmt: m, label: 'Total bill',
      sub: mode === 'even' ? `${m(each)} each for ${people.length} people` : `Split between ${people.length} people by what each ordered`,
      chips: [{ label: 'Subtotal', value: m(r.subtotal) }, { label: 'Tax', value: m(r.tax) }, { label: 'Tip', value: m(r.tip) }],
      copy: `Bill ${m(r.total)} (subtotal ${m(r.subtotal)}, tax ${m(r.tax)}, tip ${m(r.tip)}):\n${r.rows.map((x, i) => `${names[i]}: ${m(x.total)}`).join('\n')}`,
    })
    payBars.set(r.rows.map((x, i) => ({ key: `p${x.id}`, label: names[i], value: x.total, text: m(x.total), color: TONES[i % TONES.length] })), Math.max(...r.rows.map((x) => x.total)))
    payBox.replaceChildren(payBars, ...(mode === 'items' ? [table({ columns: ['Person', { label: 'Items', num: true }, { label: 'Tax', num: true }, { label: 'Tip', num: true }, { label: 'Total', num: true }], rows: r.rows.map((x, i) => [names[i], m(x.subtotal), m(x.tax), m(x.tip), h('b', m(x.total))]) })] : []))
  }

  for (const f of [bill, tax, tip]) f.input.addEventListener('input', update)
  prefix()
  showMode()
  update()
  shell(root, layout(
    [card('The bill', { icon: 'receipt', right: curSel }, stack(modeSw, itemsBox, h('div', { class: 'bs-fee' }, tax, taxKind), h('div', { class: 'bs-fee' }, tip, tipKind))),
      card('Who is eating?', { icon: 'users' }, peopleList)],
    [hr.el, card('Who pays what', { icon: 'wallet' }, payBox), note('Tax and tip are shared in proportion to what each person ordered. Shared items are split equally between the people ticked. Amounts are rounded to cents and add up to the total.')]))
}
