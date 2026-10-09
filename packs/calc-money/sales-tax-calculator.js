// Sales tax / VAT calculator (also serves vat-calculator via params.kind = 'vat').
import { shell, num, hero, card, layout, note, switcher, pills, slip, currencyPicker, money, fnum, firstIssue, stack, tiles, block } from './_shared.js'
import { toggle } from '../../lib/ui.js'

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Tax on an amount for one or two rates (rates are added, not compounded).
 * mode 'add': amount is before tax. mode 'remove': amount already includes the tax.
 */
export function salesTax(amount, rates, mode = 'add') {
  const total = rates.reduce((s, r) => s + r, 0)
  const base = mode === 'add' ? amount : round2(amount / (1 + total / 100))
  const parts = rates.map((r) => round2((base * r) / 100))
  const tax = mode === 'add' ? parts.reduce((s, x) => s + x, 0) : round2(amount - base)
  return { base, parts, tax, total: mode === 'add' ? round2(base + tax) : amount }
}

const VAT_REGIONS = [
  ['UK VAT 20%', 20, 'GBP'], ['Germany VAT 19%', 19, 'EUR'], ['France VAT 20%', 20, 'EUR'], ['Italy VAT 22%', 22, 'EUR'], ['Spain VAT 21%', 21, 'EUR'],
  ['Netherlands VAT 21%', 21, 'EUR'], ['Ireland VAT 23%', 23, 'EUR'], ['UAE VAT 5%', 5, 'AED'],
]
const REGIONS = [
  ['UK VAT 20%', 20, 'GBP'], ['Germany VAT 19%', 19, 'EUR'], ['France VAT 20%', 20, 'EUR'], ['Canada GST 5%', 5, 'CAD'],
  ['Australia GST 10%', 10, 'AUD'], ['UAE VAT 5%', 5, 'AED'], ['Singapore GST 9%', 9, 'SGD'], ['India GST 18%', 18, 'INR'],
]

export function mount(root, { params }) {
  const vat = params?.kind === 'vat'
  const word = vat ? 'VAT' : 'Sales tax'
  let cur = 'USD'
  let mode = 'add'
  const curSel = currencyPicker((c) => { cur = c; prefix(); update() }, { fallback: vat ? 'GBP' : 'USD' })
  cur = curSel.get()
  const amount = num('Amount', { value: 100, min: 0, max: 1e13 })
  const rate = num(`${word} rate`, { value: vat ? 20 : 8, min: 0, max: 100, suffix: '%', hint: vat ? 'Type your local VAT rate or pick an example' : 'Type your local rate, for example your state and city combined' })
  const second = toggle('Add a second tax (for example provincial or local)', false, () => { rate2.hidden = !second.input.checked; update() })
  const rate2 = num('Second tax rate', { value: 0, min: 0, max: 100, suffix: '%', optional: true, hint: 'Added to the first rate on the same price' })
  rate2.hidden = true
  const regions = vat ? VAT_REGIONS : REGIONS
  const regionPills = pills(regions.map(([l]) => [l, l]), null, (l) => {
    const [, r, c] = regions.find((x) => x[0] === l)
    rate.set(r); curSel.value = c; cur = c
    prefix(); update()
  }, 'Region examples')
  const modeSw = switcher([['add', `Add ${word}`, 'plus'], ['remove', `Remove ${word}`, 'minus']], mode, (m) => { mode = m; update() }, `Add or remove ${word}`)
  const hr = hero({ label: `Total with ${word}`, tone: 'ocean', icon: 'receipt' })
  const sl = slip()
  const t = tiles()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const prefix = () => amount.setPrefix(sym())

  function update() {
    regionPills.set(null)
    const rr = [rate.val(), second.input.checked ? rate2.val() : null].filter((x) => x != null)
    const bad = firstIssue(amount, rate, second.input.checked ? rate2 : null)
    if (bad) { hr.empty(bad); sl.replaceChildren(); t.set([]); return }
    const a = amount.val()
    const r = salesTax(a, rr, mode)
    const m = (n) => money(n, cur, 2)
    const totalRate = rr.reduce((s, x) => s + x, 0)
    const rows = [
      { label: `Price before ${word}`, value: m(r.base), strong: true },
      ...rr.map((x, i) => ({ label: rr.length > 1 ? `${i ? 'Second tax' : word} @ ${fnum(x, 3)}%` : `${word} @ ${fnum(x, 3)}%`, value: m(r.parts[i]) })),
      ...(rr.length > 1 ? [{ label: 'Total tax', value: m(r.tax), strong: true }] : []),
    ]
    sl.set({ title: `${word} receipt`, rows, total: { label: mode === 'add' ? 'Total to pay' : 'Amount you paid', value: m(r.total) } })
    hr.set({
      n: mode === 'add' ? r.total : r.base, fmt: m, label: mode === 'add' ? `Total with ${word}` : `Price before ${word}`,
      sub: mode === 'add' ? `${m(a)} plus ${fnum(totalRate, 3)}% ${word}` : `${m(a)} includes ${fnum(totalRate, 3)}% ${word}`,
      chips: [{ label: `${word} amount`, value: m(r.tax) }, { label: mode === 'add' ? 'Price before tax' : 'You paid', value: m(mode === 'add' ? r.base : r.total) }],
      bar: [{ label: 'Price', value: r.base, text: m(r.base) }, { label: word, value: r.tax, text: m(r.tax) }],
      copy: mode === 'add' ? `${m(r.base)} + ${word} ${m(r.tax)} (${fnum(totalRate, 3)}%) = ${m(r.total)}` : `${m(r.total)} includes ${word} ${m(r.tax)} (${fnum(totalRate, 3)}%). Price before tax: ${m(r.base)}`,
    })
    t.set([
      { label: `${word} share of the total`, value: r.total > 0 ? `${fnum((r.tax / r.total) * 100, 2)}%` : '-', tone: 'sky', icon: 'percent', hint: mode === 'add' ? 'of what you pay' : 'of the price you paid' },
      ...(rr.length > 1 ? [{ label: 'Combined rate', value: `${fnum(totalRate, 3)}%`, tone: 'teal', icon: 'layers', hint: 'both taxes together' }] : []),
    ])
  }
  for (const f of [amount, rate, rate2]) f.input.addEventListener('input', update)
  prefix()
  update()
  shell(root, layout(
    [card('Amount and rate', { icon: 'calculator', right: curSel }, stack(modeSw, amount, rate, block('Region examples', regionPills), second, rate2))],
    [hr.el, sl, t, note(`${word} rules differ by place and product. Use this as a quick check and confirm the rate with your tax authority.`)]))
}
