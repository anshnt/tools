// Discount calculator: one discount, stacked discounts, and buy X get Y deals.
import { h } from '../../lib/ui.js'
import { shell, num, inline, hero, tiles, bars, card, layout, note, switcher, pills, pick, currencyPicker, money, pct, fnum, firstIssue, listEditor, stack, style } from './_shared.js'

/** Price after a percentage and/or a flat discount, then optional tax. */
export function singleDiscount(price, pctOff, flatOff = 0, taxPct = 0) {
  const pctAmount = (price * pctOff) / 100
  const discount = Math.min(price, pctAmount + flatOff)
  const after = price - discount
  const tax = (after * taxPct) / 100
  return { discount, after, tax, final: after + tax, effective: price > 0 ? (discount / price) * 100 : 0 }
}

/**
 * Buy X get Y: in every cycle of X+Y items the first X are full price and the next Y get `getOffPct` off (100 = free).
 * Returns what you pay for `items` units at `price` each.
 */
export function buyXGetY(price, buy, get, getOffPct, items) {
  let pay = 0
  for (let i = 0; i < items; i++) pay += i % (buy + get) < buy ? price : price * (1 - getOffPct / 100)
  const full = price * items
  return { pay, full, saved: full - pay, effective: items ? (pay / items) : 0, offPct: full > 0 ? ((full - pay) / full) * 100 : 0 }
}

const CSS = `
.dc-tag { position: relative; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 14px 16px; border-radius: 18px; background: var(--surface-2); border: 1px dashed var(--border-strong); }
.dc-tag .was { font-size: 15px; color: var(--muted); text-decoration: line-through; text-decoration-thickness: 2px; font-variant-numeric: tabular-nums; }
.dc-tag .off { font-size: 12.5px; font-weight: 700; padding: 4px 10px; border-radius: 99px; color: #fff; background: linear-gradient(120deg, #ea580c, #db2777); letter-spacing: .02em; }
.dc-row { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: 8px; align-items: center; }
.dc-row .select { height: 42px; border-radius: 12px; }
.dc-step { font-size: 12.5px; color: var(--muted); }
@media (max-width: 420px) { .dc-row { grid-template-columns: 112px minmax(0, 1fr); } }
`

export function mount(root) {
  style('dc-style', CSS)
  let cur = 'INR'
  let mode = 'single'
  const curSel = currencyPicker((c) => { cur = c; setPrefixes(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const hr = hero({ label: 'You pay', tone: 'sunset', icon: 'tag' })
  const t = tiles()
  const extra = h('div')
  const modeSw = switcher([['single', 'Single', 'tag'], ['stacked', 'Stacked', 'layers'], ['bogo', 'Buy X get Y', 'gift']], mode, (m) => { mode = m; showMode(); update() }, 'Discount type')

  // Single
  const price = num('Original price', { value: 2999, min: 0, max: 1e12, prefix: '', hint: '' })
  let kind = 'pct'
  const off = num('Discount', { value: 25, min: 0, max: 100, suffix: '%' })
  const kindSw = pills([['pct', 'Percent off'], ['flat', 'Flat amount off']], kind, (k) => { kind = k; off.setSuffix(k === 'pct' ? '%' : ''); off.setRange(0, k === 'pct' ? 100 : 1e12); setPrefixes(); update() }, 'Discount kind')
  const quick = pills([[10, '10%'], [20, '20%'], [25, '25%'], [30, '30%'], [50, '50%'], [70, '70%']], 25, (v) => { kind = 'pct'; kindSw.set('pct'); off.set(v); off.setSuffix('%'); setPrefixes(); update() }, 'Common discounts')
  const tax = num('Tax on the discounted price (optional)', { value: 0, min: 0, max: 100, suffix: '%', optional: true, hint: 'GST or sales tax, if the shelf price excludes it' })
  const singleBox = stack(price, kindSw, off, quick, tax)

  // Stacked
  const stackedPrice = num('Original price', { value: 5000, min: 0, max: 1e12 })
  const rows = [{ type: 'pct', value: 20 }, { type: 'pct', value: 10 }]
  const list = listEditor({
    items: rows, addLabel: 'Add a discount', max: 8, min: 1, onChange: update,
    newItem: () => ({ type: 'pct', value: 5 }),
    render: (it) => {
      const sel = pick([['pct', '% off'], ['flat', `Flat off`]], it.type, (v) => { it.type = v; field.setSuffix(v === 'pct' ? '%' : ''); update() }, 'Discount type')
      const field = inline('Discount value', { value: it.value, min: 0, max: 1e12, suffix: it.type === 'pct' ? '%' : '', onInput: () => { it.value = field.raw(); update() } })
      field.input.addEventListener('input', () => { it.value = field.raw() })
      return h('div', { class: 'dc-row' }, sel, field)
    },
  })
  const stackedBox = stack(stackedPrice, h('div', { class: 'cm-label' }, h('span', 'Discounts, applied in order')), list)
  const waterfall = bars()

  // Buy X get Y
  const bPrice = num('Price per item', { value: 499, min: 0, max: 1e12 })
  const buy = num('Buy', { value: 2, min: 1, max: 100, int: true, suffix: 'items' })
  const get = num('Get', { value: 1, min: 1, max: 100, int: true, suffix: 'items' })
  const getOff = num('Extra items are', { value: 100, min: 1, max: 100, suffix: '% off', hint: '100% off means free' })
  const items = num('How many items do you want?', { value: 3, min: 1, max: 10000, int: true })
  const bogoQuick = pills([['1-1-100', 'Buy 1 get 1'], ['2-1-100', 'Buy 2 get 1'], ['1-1-50', 'Buy 1 get 1 at 50%'], ['3-1-100', 'Buy 3 get 1']], '2-1-100', (v) => {
    const [b, g, o] = v.split('-').map(Number)
    buy.set(b); get.set(g); getOff.set(o); items.set(b + g); update()
  }, 'Common deals')
  const bogoBox = stack(bogoQuick, bPrice, h('div', { class: 'cm-grid2' }, buy, get), getOff, items)

  const body = h('div')
  function showMode() { body.replaceChildren(mode === 'single' ? singleBox : mode === 'stacked' ? stackedBox : bogoBox); extra.replaceChildren(mode === 'stacked' ? card('Price after each step', { icon: 'layers' }, waterfall) : '') }
  function setPrefixes() {
    const s = sym()
    for (const f of [price, stackedPrice, bPrice]) f.setPrefix(s)
    if (kind === 'flat') off.setPrefix(s); else off.setPrefix('')
  }

  function update() {
    const m = (n, d = 2) => money(n, cur, d)
    if (mode === 'single') {
      const bad = firstIssue(price, off, tax)
      if (bad) { hr.empty(bad); t.set([]); return }
      const p = price.val()
      const r = singleDiscount(p, kind === 'pct' ? off.val() : 0, kind === 'flat' ? off.val() : 0, tax.val())
      hr.set({
        n: r.final, fmt: (v) => m(v), label: tax.val() > 0 ? 'You pay (with tax)' : 'You pay',
        sub: `${fnum(r.effective, 2)}% off the original ${m(p)}`,
        chips: [{ label: 'You save', value: m(r.discount) }, { label: 'Original', value: m(p) }],
        copy: `Original ${m(p)}, discount ${m(r.discount)} (${fnum(r.effective, 2)}%), you pay ${m(r.final)}`,
      })
      t.set([
        { label: 'Discount amount', n: r.discount, fmt: m, tone: 'orange', icon: 'tag' },
        { label: 'Price after discount', n: r.after, fmt: m, tone: 'indigo', icon: 'receipt' },
        ...(tax.val() > 0 ? [{ label: 'Tax added', n: r.tax, fmt: m, tone: 'teal', icon: 'landmark' }] : []),
        { label: 'Effective discount', value: pct(r.effective, 2), tone: 'pink', icon: 'percent', hint: kind === 'flat' ? `${m(off.val())} off a ${m(p)} price` : undefined },
      ])
    } else if (mode === 'stacked') {
      const bad = firstIssue(stackedPrice, ...rows.map((r, i) => ({ issue: () => (Number.isFinite(r.value) && r.value >= 0 && (r.type === 'flat' || r.value <= 100) ? '' : `Discount ${i + 1}: enter a ${r.type === 'pct' ? 'percent from 0 to 100' : 'positive amount'}`) })))
      if (bad) { hr.empty(bad); t.set([]); waterfall.set([]); return }
      const p = stackedPrice.val()
      let cur_ = p
      const steps = rows.map((r) => {
        const amount = r.type === 'pct' ? (cur_ * r.value) / 100 : Math.min(r.value, cur_)
        cur_ -= amount
        return { r, amount, price: cur_ }
      })
      const saved = p - cur_
      const eff = p > 0 ? (saved / p) * 100 : 0
      const pctOnly = rows.every((r) => r.type === 'pct')
      const naive = rows.reduce((s, r) => s + (r.type === 'pct' ? r.value : 0), 0)
      hr.set({
        n: cur_, fmt: (v) => m(v), label: 'You pay',
        sub: pctOnly && rows.length > 1 ? `${rows.map((r) => `${fnum(r.value, 2)}%`).join(' + ')} stacked is ${fnum(eff, 2)}% off, not ${fnum(naive, 2)}%` : `${fnum(eff, 2)}% off the original ${m(p)}`,
        chips: [{ label: 'You save', value: m(saved) }, { label: 'Original', value: m(p) }],
        copy: `Original ${m(p)}; after ${rows.length} discount${rows.length > 1 ? 's' : ''} you pay ${m(cur_)} (saving ${m(saved)}, ${fnum(eff, 2)}%)`,
      })
      t.set([
        { label: 'Total saved', n: saved, fmt: m, tone: 'orange', icon: 'piggy-bank' },
        { label: 'Effective discount', value: pct(eff, 2), tone: 'pink', icon: 'percent', hint: pctOnly && rows.length > 1 ? `vs ${fnum(naive, 2)}% if you just added them` : undefined },
      ])
      waterfall.set([{ key: 'orig', label: 'Original', value: p, text: m(p), color: 'var(--border-strong)' },
        ...steps.map((s, i) => ({ key: `s${i}`, label: `After ${s.r.type === 'pct' ? `${fnum(s.r.value, 2)}% off` : `${m(s.r.value)} off`}`, value: s.price, text: m(s.price), color: i === steps.length - 1 ? '#16a34a' : undefined }))], p)
    } else {
      const bad = firstIssue(bPrice, buy, get, getOff, items)
      if (bad) { hr.empty(bad); t.set([]); return }
      const r = buyXGetY(bPrice.val(), buy.val(), get.val(), getOff.val(), items.val())
      hr.set({
        n: r.pay, fmt: (v) => m(v), label: `You pay for ${fnum(items.val(), 0)} item${items.val() === 1 ? '' : 's'}`,
        sub: `Buy ${buy.val()} get ${get.val()} ${getOff.val() === 100 ? 'free' : `at ${fnum(getOff.val(), 2)}% off`}: ${fnum(r.offPct, 2)}% off overall`,
        chips: [{ label: 'You save', value: m(r.saved) }, { label: 'Without the deal', value: m(r.full) }],
        copy: `Buy ${buy.val()} get ${get.val()} ${getOff.val() === 100 ? 'free' : `at ${fnum(getOff.val(), 2)}% off`}: ${fnum(items.val(), 0)} items cost ${m(r.pay)} instead of ${m(r.full)}`,
      })
      const cycle = buy.val() + get.val()
      t.set([
        { label: 'Effective price per item', n: r.effective, fmt: m, tone: 'indigo', icon: 'tag' },
        { label: 'Effective discount', value: pct(r.offPct, 2), tone: 'pink', icon: 'percent' },
        { label: 'Best use of the deal', value: `${fnum(cycle, 0)} items`, hint: `Buy in multiples of ${fnum(cycle, 0)} to get the full discount`, tone: 'amber', icon: 'gift' },
      ])
    }
  }

  for (const f of [price, off, tax, stackedPrice, bPrice, buy, get, getOff, items]) f.input.addEventListener('input', update)
  setPrefixes()
  showMode()
  update()
  const left = card('What are you buying?', { icon: 'shopping-bag', right: curSel }, stack(modeSw, body))
  shell(root, layout([left], [hr.el, t, note('Stacked percent discounts multiply: 20% then 10% is 28% off, not 30%.')], extra))
}
