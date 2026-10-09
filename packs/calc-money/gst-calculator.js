// GST calculator (also serves reverse-gst via params.mode = 'reverse'). Rates reflect GST 2.0, effective 22 September 2025.
import { h, icon } from '../../lib/ui.js'
import { shell, num, hero, card, layout, note, switcher, pills, slip, money, fnum, firstIssue, stack } from './_shared.js'

/** The slabs on offer: 0, the special 0.25% and 3% rates, the two main rates (5% and 18%) and the 40% rate for sin and luxury goods. */
export const GST_SLABS = [0, 0.25, 3, 5, 18, 40]
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * GST on an amount. mode 'add': amount excludes GST. mode 'remove': amount includes GST.
 * Intra-state supplies split the tax into equal CGST and SGST halves; inter-state supplies carry IGST.
 */
export function gst(amount, rate, mode = 'add', inter = false) {
  const base = mode === 'add' ? amount : round2(amount / (1 + rate / 100))
  const tax = mode === 'add' ? round2((amount * rate) / 100) : round2(amount - base)
  const total = mode === 'add' ? round2(amount + tax) : amount
  const cgst = inter ? 0 : round2(tax / 2)
  const sgst = inter ? 0 : round2(tax - cgst)
  return { base: mode === 'add' ? amount : base, tax, total, cgst, sgst, igst: inter ? tax : 0 }
}

const INFO = [
  ['0%', 'Basic foods like fresh produce and milk, many essentials, and individual life and health insurance premiums.'],
  ['0.25%', 'Rough diamonds and unworked precious and semi-precious stones.'],
  ['3%', 'Gold, silver and jewellery.'],
  ['5%', 'Essentials and many everyday goods, for example packaged foods, butter and ghee, many medicines, soap, hair oil and toothpaste.'],
  ['18%', 'The standard rate: most goods and services, electronics and appliances, cement.'],
  ['40%', 'Sin and luxury goods: tobacco and pan masala, aerated drinks, high-end cars and yachts, betting and casinos.'],
]

export function mount(root, { params }) {
  const reverse = params?.mode === 'reverse'
  let mode = reverse ? 'remove' : 'add'
  let inter = false
  const amount = num(reverse ? 'Amount including GST' : 'Amount', { value: reverse ? 11800 : 10000, min: 0, max: 1e13, prefix: '₹', hint: '' })
  const rate = num('GST rate', { value: 18, min: 0, max: 100, suffix: '%', hint: 'Pick a slab or type any rate' })
  const slabPills = pills(GST_SLABS.map((r) => [r, `${r}%`]), 18, (v) => { rate.set(v); update() }, 'GST slab')
  const modeSw = reverse ? null : switcher([['add', 'Add GST', 'plus'], ['remove', 'Remove GST', 'minus']], mode, (m) => { mode = m; amountLabel(); update() }, 'Add or remove GST')
  const supplySw = switcher([['intra', 'Same state'], ['inter', 'Another state']], 'intra', (v) => { inter = v === 'inter'; update() }, 'Place of supply')
  const hr = hero({ label: 'Total with GST', tone: 'mint', icon: 'receipt-indian-rupee' })
  const sl = slip()

  function amountLabel() {
    amount.setLabel(mode === 'add' ? 'Amount before GST' : 'Amount including GST')
  }
  if (!reverse) amountLabel()

  function update() {
    const r = rate.raw()
    slabPills.set(GST_SLABS.includes(r) ? r : null)
    const bad = firstIssue(amount, rate)
    if (bad) { hr.empty(bad); sl.replaceChildren(); return }
    const a = amount.val()
    const rt = rate.val()
    const g = gst(a, rt, mode, inter)
    const m = (n) => money(n, 'INR', 2)
    const half = fnum(rt / 2, 3)
    const rows = [
      { label: mode === 'add' ? 'Price before GST' : 'Price before GST (taxable value)', value: m(g.base), strong: true },
      ...(inter
        ? [{ label: `IGST @ ${fnum(rt, 3)}%`, value: m(g.igst) }]
        : [{ label: `CGST @ ${half}%`, value: m(g.cgst), sub: 'Central GST' }, { label: `SGST @ ${half}%`, value: m(g.sgst), sub: 'State GST' }]),
      { label: 'Total GST', value: m(g.tax), strong: true },
    ]
    sl.set({ title: inter ? 'Tax invoice (inter-state)' : 'Tax invoice (intra-state)', rows, total: { label: mode === 'add' ? 'Total payable' : 'Amount you paid', value: m(g.total) } })
    const share = g.total > 0 ? (g.tax / g.total) * 100 : 0
    hr.set({
      n: mode === 'add' ? g.total : g.base, fmt: m, label: mode === 'add' ? 'Total with GST' : 'Price before GST',
      sub: mode === 'add' ? `${m(a)} plus ${fnum(rt, 3)}% GST` : `${m(a)} includes ${fnum(rt, 3)}% GST`,
      chips: [{ label: 'GST amount', value: m(g.tax) }, { label: mode === 'add' ? 'Price before GST' : 'You paid', value: m(mode === 'add' ? g.base : g.total) }],
      bar: [{ label: 'Price', value: g.base, text: m(g.base) }, { label: 'GST', value: g.tax, text: `${m(g.tax)} (${fnum(share, 1)}%)` }],
      copy: mode === 'add' ? `Price ${m(g.base)} + GST ${m(g.tax)} @ ${fnum(rt, 3)}% = ${m(g.total)}` : `${m(g.total)} includes GST ${m(g.tax)} @ ${fnum(rt, 3)}%. Price before GST: ${m(g.base)}`,
    })
  }
  for (const f of [amount, rate]) f.input.addEventListener('input', update)

  const info = h('details', { class: 'cm-details' }, h('summary', icon('info'), 'What is taxed at which rate?'),
    h('div', { class: 'cm-details-body' }, INFO.map(([r, t]) => h('div', { class: 'cm-info-row' }, h('b', r), h('span', t))),
      h('p', { class: 'cm-hint' }, 'Examples only: the rate depends on the HSN or SAC code of the item, so check the official GST rate finder when in doubt. The old 12% and 28% slabs ended on 22 September 2025, but you can still type them as a custom rate for older invoices.')))

  update()
  shell(root, layout(
    [card(reverse ? 'Work back to the price before GST' : 'Amount and rate', { icon: 'calculator' }, stack(modeSw, amount, h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', 'GST slab')), slabPills), rate,
      h('div', { class: 'cm-field' }, h('span', { class: 'cm-label' }, h('span', 'Place of supply')), supplySw))), info],
    [hr.el, sl, note('This is an estimate to help you check an invoice. Rates are those in force from 22 September 2025 (GST 2.0). Special-case items can differ.')]))
}
