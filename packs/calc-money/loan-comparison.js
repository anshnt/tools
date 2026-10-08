// Loan comparison: 2 to 4 loans side by side, including processing fees and the effective rate.
import { h, button, icon, table, toggle } from '../../lib/ui.js'
import { shell, num, pick, hero, card, layout, note, currencyPicker, chartBox, money, short, fnum, pct, monthsLabel, stack, style, chartColor } from './_shared.js'
import { pmt, effectiveApr } from './_math.js'

/** Everything you pay for one loan. feeKind: 'pct' (percent of the loan) or 'flat'. */
export function loanCost({ amount, rate, years, fee = 0, feeKind = 'pct' }) {
  const n = Math.round(years * 12)
  const emi = pmt(amount, rate, n, 12)
  const feeAbs = feeKind === 'pct' ? (amount * fee) / 100 : fee
  const interest = emi * n - amount
  return { n, emi, interest, feeAbs, total: interest + feeAbs, repay: emi * n, apr: effectiveApr(amount, feeAbs, emi, n, 12) }
}

const NAMES = ['A', 'B', 'C', 'D']
const CSS = `
.lc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr)); gap: 12px; }
.lc-loan { position: relative; display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: 22px; background: var(--surface); border: 1px solid var(--border); animation: cm-pop .5s var(--spring) both; }
.lc-loan::before { content: ""; position: absolute; left: 16px; right: 16px; top: 0; height: 3px; border-radius: 0 0 6px 6px; background: var(--k); }
.lc-loan.best { border-color: color-mix(in srgb, var(--success) 45%, var(--border)); box-shadow: 0 16px 34px -22px var(--success); }
.lc-head { display: flex; align-items: center; gap: 10px; }
.lc-badge { width: 32px; height: 32px; border-radius: 11px; display: grid; place-items: center; color: #fff; font-weight: 700; background: var(--k); flex: none; }
.lc-head b { flex: 1; font-size: 15px; }
.lc-tag { font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 99px; color: var(--success); background: var(--success-soft); border: 1px solid color-mix(in srgb, var(--success) 30%, transparent); display: inline-flex; gap: 4px; align-items: center; }
.lc-tag .icon { width: 12px; height: 12px; }
.lc-fee { display: grid; grid-template-columns: minmax(0, 1fr) 118px; gap: 8px; align-items: end; }
.lc-fee .select { height: 50px; border-radius: 15px; font-size: 13.5px; }
.lc-best-cell { color: var(--success); font-weight: 700; }
.lc-cmp .table th, .lc-cmp .table td { white-space: normal; }
`

export function mount(root) {
  style('lc-style', CSS)
  let cur = 'INR'
  let linked = true
  const curSel = currencyPicker((c) => { cur = c; for (const l of loans) l.amount.setPrefix(sym()); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const grid = h('div', { class: 'lc-grid' })
  const addBtn = button('Add a loan', { icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => { addLoan(); update() } })
  const linkTog = toggle('Use the same loan amount for all', true, (c) => { linked = c; if (c) syncAmounts(loans[0].amount.raw()); update() })
  const hr = hero({ label: 'Cheapest overall', tone: 'mint', icon: 'scale' })
  const cmpHost = h('div', { class: 'lc-cmp cm-flat' })
  const bars = chartBox({ height: 280, ariaLabel: 'Total cost of each loan' })
  const loans = []

  function syncAmounts(v) { for (const l of loans) if (l.amount.raw() !== v) l.amount.set(v) }
  function addLoan(init) {
    const i = loans.length
    const d = init || { amount: loans[0] ? loans[0].amount.raw() : (cur === 'INR' ? 2500000 : 250000), rate: 8.5 + i * 0.25, years: 20, fee: i === 0 ? 0.5 : 1 }
    const l = { id: i }
    l.amount = num('Loan amount', { value: d.amount, min: 1, max: 1e11, prefix: sym(), onInput: (v) => { if (linked && Number.isFinite(v)) syncAmounts(v); update() } })
    l.rate = num('Interest rate', { value: d.rate, min: 0, max: 100, suffix: '%', onInput: update })
    l.years = num('Tenure', { value: d.years, min: 0.5, max: 40, suffix: 'yr', onInput: update })
    l.fee = num('Processing fee', { value: d.fee, min: 0, max: 1e11, optional: true, onInput: update })
    l.kind = pick([['pct', '% of loan'], ['flat', 'Flat amount']], 'pct', update, 'Fee type')
    l.card = null
    loans.push(l)
    render()
  }
  function removeLoan(idx) { loans.splice(idx, 1); render(); update() }
  function render() {
    grid.replaceChildren(...loans.map((l, i) => {
      l.id = i
      l.card = h('div', { class: 'lc-loan', style: { '--k': chartColor(i) } },
        h('div', { class: 'lc-head' }, h('span', { class: 'lc-badge' }, NAMES[i]), h('b', `Loan ${NAMES[i]}`), h('span', { class: 'lc-tag', hidden: true }, icon('check'), 'Cheapest'),
          loans.length > 2 ? button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove loan ${NAMES[i]}`, onClick: () => removeLoan(i) }) : null),
        l.amount, h('div', { class: 'cm-grid2' }, l.rate, l.years), h('div', { class: 'lc-fee' }, l.fee, l.kind))
      return l.card
    }))
    addBtn.hidden = loans.length >= 4
  }

  function update() {
    const m = (x) => money(x, cur)
    const bad = loans.map((l, i) => {
      const msg = [l.amount, l.rate, l.years, l.fee].map((f) => f.issue()).find(Boolean) || (l.kind.value === 'pct' && l.fee.val() > 100 ? 'Processing fee: use at most 100%' : '')
      return msg && `Loan ${NAMES[i]} - ${msg}`
    }).find(Boolean)
    if (bad) { hr.empty(bad); cmpHost.replaceChildren(); return }
    const res = loans.map((l) => loanCost({ amount: l.amount.val(), rate: l.rate.val(), years: l.years.val(), fee: l.fee.val(), feeKind: l.kind.value }))
    const best = (key, dir = 1) => { let bi = 0; res.forEach((r, i) => { if (r[key] * dir < res[bi][key] * dir) bi = i }); return bi }
    const bestTotal = best('total')
    const worst = res.reduce((a, r, i) => (r.total > res[a].total ? i : a), 0)
    const diff = res[worst].total - res[bestTotal].total
    loans.forEach((l, i) => {
      l.card.classList.toggle('best', i === bestTotal && loans.length > 1 && diff > 0.5)
      l.card.querySelector('.lc-tag').hidden = !(i === bestTotal && diff > 0.5)
    })
    if (diff <= 0.5) hr.set({ text: 'All equal', label: 'Cheapest overall', sub: 'These loans cost the same in total.', chips: [{ label: 'Total cost', value: m(res[0].total) }] })
    else hr.set({
      text: `Loan ${NAMES[bestTotal]}`, label: 'Cheapest overall', sub: `Saves ${m(diff)} over Loan ${NAMES[worst]} across the full tenure (interest plus fees)`,
      chips: [{ label: 'Lowest total cost', value: m(res[bestTotal].total) }, { label: 'Lowest EMI', value: `${NAMES[best('emi')]}: ${m(res[best('emi')].emi)}` }],
      copy: `Loan ${NAMES[bestTotal]} is cheapest: total cost (interest and fees) ${m(res[bestTotal].total)}, saving ${m(diff)} against Loan ${NAMES[worst]}`,
    })
    const rows = [
      ['Loan amount', (r, i) => m(loans[i].amount.val()), null],
      ['Rate and tenure', (r, i) => `${fnum(loans[i].rate.val(), 2)}% for ${monthsLabel(r.n)}`, null],
      ['Monthly EMI', (r) => m(r.emi), 'emi'],
      ['Total interest', (r) => m(r.interest), 'interest'],
      ['Processing fee', (r) => m(r.feeAbs), 'feeAbs'],
      ['Total cost (interest + fee)', (r) => m(r.total), 'total'],
      ['Total you pay back', (r) => m(r.repay + r.feeAbs), null],
      ['Effective rate (APR)', (r) => pct(r.apr, 3), 'apr'],
      ['Extra cost vs cheapest', (r) => (r.total - res[bestTotal].total < 0.5 ? '-' : `+${m(r.total - res[bestTotal].total)}`), null],
    ]
    cmpHost.replaceChildren(table({
      columns: [{ label: '' }, ...loans.map((_, i) => ({ label: `Loan ${NAMES[i]}`, num: true }))],
      rows: rows.map(([label, f, key]) => {
        const bi = key ? best(key) : -1
        const allSame = key && res.every((r) => Math.abs(r[key] - res[0][key]) < 0.0005)
        return [label, ...res.map((r, i) => (i === bi && !allSame ? h('span', { class: 'lc-best-cell' }, f(r, i)) : f(r, i)))]
      }),
    }))
    bars.render({
      type: 'bar', stacked: true, labels: loans.map((_, i) => `Loan ${NAMES[i]}`),
      datasets: [{ label: 'Principal', data: loans.map((l) => l.amount.val()), color: 0 }, { label: 'Interest', data: res.map((r) => r.interest), color: 1 }, { label: 'Fees', data: res.map((r) => r.feeAbs), color: 2 }],
      format: m, axisFormat: (v) => short(v, cur),
    })
  }

  addLoan({ amount: cur === 'INR' ? 2500000 : 250000, rate: 8.5, years: 20, fee: 0.5 })
  addLoan({ amount: cur === 'INR' ? 2500000 : 250000, rate: 8.35, years: 20, fee: 1 })
  update()
  shell(root, stack(
    card('The loans', { icon: 'scale', right: curSel }, stack(linkTog, grid, h('div', { class: 'row' }, addBtn))),
    layout([hr.el, note('The effective rate (APR) turns the up-front fee into an annual rate, so a lower headline rate with a high fee can still lose. Only the fees you type in are counted: insurance and other add-ons are not included.')],
      [card('Total cost of each loan', { icon: 'chart-column' }, bars)]),
    card('Side by side', { icon: 'table' }, cmpHost)))
}
