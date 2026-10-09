// Tip calculator: tip, total and each person's share, with optional rounding and tip on the pre-tax amount.
import { h, toggle } from '../../lib/ui.js'
import { shell, num, slide, stepper, hero, tiles, slip, card, layout, note, pills, currencyPicker, money, fnum, pct, firstIssue, stack, block } from './_shared.js'

/**
 * Tip maths. tax is the tax already included in the bill; with preTax the tip is worked out on bill minus tax.
 * round: 'none' | 'total' (round the total up to a whole unit) | 'person' (round each person's share up).
 */
export function tipOut({ bill, tax = 0, tipPct, people = 1, round = 'none', preTax = false }) {
  const base = preTax ? Math.max(0, bill - tax) : bill
  let tip = (base * tipPct) / 100
  let total = bill + tip
  if (round === 'total') { const t = Math.ceil(total - 1e-9); tip += t - total; total = t }
  if (round === 'person') { const per = Math.ceil(total / people - 1e-9); const t = per * people; tip += t - total; total = t }
  return { base, tip, total, perPerson: total / people, tipPerPerson: tip / people, effective: base > 0 ? (tip / base) * 100 : 0 }
}

const START = { INR: 1850, JPY: 8000, default: 85 }

export function mount(root) {
  let cur = 'INR'
  let round = 'none'
  const curSel = currencyPicker((c) => { cur = c; prefix(); bill.set(START[c] || START.default); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const bill = num('Bill amount', { value: START[cur] || START.default, min: 0, max: 1e10 })
  const tax = num('Tax included in the bill (optional)', { value: 0, min: 0, max: 1e10, optional: true })
  const preTax = toggle('Tip on the amount before tax', false, () => update())
  const quick = pills([[0, 'None'], [5, '5%', 'frown'], [10, '10%', 'meh'], [15, '15%', 'smile'], [20, '20%', 'laugh'], [25, '25%', 'party-popper']], 15, (v) => { tipPct.set(v); update() }, 'How was the service')
  const tipPct = slide('Tip', { min: 0, max: 40, step: 0.5, value: 15, hardMin: 0, hardMax: 100, suffix: '%', tickFormat: (v) => `${v}%`, onInput: () => update() })
  const people = stepper('Split between', { value: 2, min: 1, max: 50, onInput: () => update() })
  const rounding = pills([['none', 'Exact'], ['total', 'Round the total up'], ['person', 'Round each share up']], round, (v) => { round = v; update() }, 'Rounding')
  const hr = hero({ label: 'Each person pays', tone: 'sunset', icon: 'hand-coins' })
  const t = tiles()
  const sl = slip()
  function prefix() { for (const f of [bill, tax]) f.setPrefix(sym()) }

  function update() {
    quick.set([0, 5, 10, 15, 20, 25].includes(tipPct.raw()) ? tipPct.raw() : null)
    const bad = firstIssue(bill, tipPct, tax)
    if (bad) { hr.empty(bad); t.set([]); sl.replaceChildren(); return }
    if (tax.val() > bill.val()) { hr.empty('Tax cannot be more than the bill'); t.set([]); sl.replaceChildren(); return }
    const m = (x) => money(x, cur, 2)
    const n = people.val()
    const r = tipOut({ bill: bill.val(), tax: tax.val(), tipPct: tipPct.val(), people: n, round, preTax: preTax.input.checked })
    hr.set({
      n: r.perPerson, fmt: m, label: n > 1 ? 'Each person pays' : 'Total to pay',
      sub: n > 1 ? `${m(r.total)} in total for ${n} people, with a ${fnum(r.effective, 1)}% tip` : `${m(bill.val())} bill plus a ${fnum(r.effective, 1)}% tip`,
      chips: [{ label: 'Tip', value: m(r.tip) }, { label: 'Total bill', value: m(r.total) }],
      copy: `Bill ${m(bill.val())}, tip ${m(r.tip)} (${fnum(r.effective, 1)}%), total ${m(r.total)}${n > 1 ? `, ${m(r.perPerson)} each for ${n} people` : ''}`,
    })
    t.set([
      { label: 'Tip amount', n: r.tip, fmt: m, tone: 'orange', icon: 'hand-coins' },
      ...(n > 1 ? [{ label: 'Tip per person', n: r.tipPerPerson, fmt: m, tone: 'pink', icon: 'users' }] : []),
      { label: 'Tip as share of bill', value: pct(r.effective, 1), tone: 'violet', icon: 'percent', hint: round !== 'none' ? 'after rounding' : undefined },
    ])
    sl.set({
      title: 'Bill', rows: [{ label: 'Bill', value: m(bill.val()) }, ...(tax.val() > 0 ? [{ label: 'of which tax', value: m(tax.val()), sub: preTax.input.checked ? 'tip ignores this' : 'tip includes this' }] : []), { label: `Tip @ ${fnum(r.effective, 1)}%`, value: m(r.tip), strong: true }],
      total: { label: 'Total', value: m(r.total) }, foot: n > 1 ? `${n} people x ${m(r.perPerson)}` : undefined,
    })
  }
  for (const f of [bill, tax]) f.input.addEventListener('input', update)
  prefix()
  update()
  shell(root, layout(
    [card('The bill', { icon: 'receipt', right: curSel }, stack(bill, block('How was the service?', quick), tipPct, people, block('Rounding', rounding), tax, h('div', {}, preTax)))],
    [hr.el, t, sl, note('Tipping customs vary. In some places a service charge is already on the bill, so check before adding more.')]))
}
