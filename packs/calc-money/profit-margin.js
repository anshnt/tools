// Profit margin calculator: cost, price, profit, margin and markup. Fill in any two and the rest follow.
// params.focus: 'margin' (default) or 'markup' decides which figure leads.
import { h, table } from '../../lib/ui.js'
import { shell, num, hero, tiles, card, layout, note, currencyPicker, money, fnum, pct, stack, style } from './_shared.js'
import { pricing } from './_math.js'

const KEYS = ['cost', 'price', 'profit', 'margin', 'markup']
const CSS = `
.pm-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pm-f { position: relative; transition: transform .3s var(--spring); }
.pm-f .cm-adorn { transition: background .3s, border-color .3s, box-shadow .2s; }
.pm-f.derived .cm-adorn { background: var(--surface-2); border-style: dashed; }
.pm-f.derived .cm-in { color: var(--text-2); }
.pm-f .tag { position: absolute; right: 0; top: 0; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.pm-f:not(.derived) .tag { color: var(--accent); }
.pm-help { font-size: 13px; color: var(--muted); }
.pm-cheat .table td, .pm-cheat .table th { padding: 8px 12px; }
@media (max-width: 720px) { .pm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } }
@media (max-width: 380px) { .pm-grid { grid-template-columns: minmax(0, 1fr); } }
`

export function mount(root, { params }) {
  style('pm-style', CSS)
  const focus = params?.focus === 'markup' ? 'markup' : 'margin'
  let cur = 'INR'
  const curSel = currencyPicker((c) => { cur = c; prefix(); update() })
  cur = curSel.get()
  const sym = () => money(0, cur).replace(/[\d.,\s]/g, '')
  const f = {
    cost: num('Cost price', { value: 80, min: -1e12, max: 1e12, hint: '' }),
    price: num('Selling price', { value: 100, min: -1e12, max: 1e12 }),
    profit: num('Profit', { value: '', min: -1e12, max: 1e12 }),
    margin: num('Margin', { value: '', min: -1e9, max: 99.999999, suffix: '%', hint: 'Profit as a share of the selling price' }),
    markup: num('Markup', { value: '', min: -99.999999, max: 1e9, suffix: '%', hint: 'Profit as a share of the cost' }),
  }
  const units = num('Units sold (optional)', { value: 1, min: 1, max: 1e9, int: true, optional: true, fallback: 1, hint: 'See the totals for a whole batch' })
  let touched = ['cost', 'price']
  const wrap = {}
  const cells = KEYS.map((k) => { const tag = h('span', { class: 'tag' }); const el = h('div', { class: 'pm-f', 'data-k': k }, f[k], tag); wrap[k] = { el, tag }; return el })
  const hr = hero({ label: focus === 'markup' ? 'Markup' : 'Profit margin', tone: 'gold', icon: 'trending-up' })
  const t = tiles()

  function prefix() { for (const k of ['cost', 'price', 'profit']) f[k].setPrefix(sym()) }
  function paintTags() {
    for (const k of KEYS) {
      const given = touched.includes(k)
      wrap[k].el.classList.toggle('derived', !given)
      wrap[k].tag.textContent = given ? 'You set' : 'Worked out'
    }
  }
  function onEdit(k) {
    touched = [...touched.filter((x) => x !== k), k].slice(-2)
    update()
  }
  function update() {
    const known = {}
    for (const k of touched) known[k] = f[k].val()
    const bad = touched.map((k) => f[k].issue()).find(Boolean)
    paintTags()
    if (touched.length < 2 || bad) {
      hr.empty(bad || 'Fill in any two of the five boxes')
      t.set([])
      return
    }
    const r = pricing(known)
    const m = (x) => money(x, cur, 2)
    if (![r.cost, r.price, r.profit, r.margin, r.markup].every(Number.isFinite)) { hr.empty('Those two values do not pin down the rest. Try cost with price, margin or markup.'); t.set([]); return }
    for (const k of KEYS) if (!touched.includes(k)) f[k].set(Math.round(r[k] * 1e6) / 1e6)
    const n = units.val() || 1
    const loss = r.profit < 0
    hr.setTone(loss ? 'rose' : 'gold')
    const lead = focus === 'markup' ? r.markup : r.margin
    hr.set({
      n: lead, fmt: (v) => `${fnum(v, 2)}%`, label: focus === 'markup' ? (loss ? 'Markup (a loss)' : 'Markup') : (loss ? 'Profit margin (a loss)' : 'Profit margin'),
      sub: `Cost ${m(r.cost)}, sold at ${m(r.price)}: ${loss ? 'a loss' : 'a profit'} of ${m(Math.abs(r.profit))} on each unit`,
      chips: focus === 'markup' ? [{ label: 'Margin', value: pct(r.margin, 2) }, { label: 'Profit per unit', value: m(r.profit) }] : [{ label: 'Markup', value: pct(r.markup, 2) }, { label: 'Profit per unit', value: m(r.profit) }],
      bar: r.price > 0 && r.cost >= 0 ? [{ label: 'Cost', value: Math.min(r.cost, r.price), text: m(r.cost) }, { label: 'Profit', value: Math.max(0, r.profit), text: m(Math.max(0, r.profit)) }] : [],
      copy: `Cost ${m(r.cost)}, price ${m(r.price)}, profit ${m(r.profit)}, margin ${fnum(r.margin, 2)}%, markup ${fnum(r.markup, 2)}%`,
    })
    const tl = [
      { label: 'Selling price', n: r.price, fmt: m, tone: 'indigo', icon: 'tag' },
      { label: 'Cost price', n: r.cost, fmt: m, tone: 'orange', icon: 'package' },
      { label: loss ? 'Loss per unit' : 'Profit per unit', n: Math.abs(r.profit), fmt: m, tone: loss ? 'red' : 'green', icon: 'coins' },
      { label: focus === 'markup' ? 'Margin' : 'Markup', value: pct(focus === 'markup' ? r.margin : r.markup, 2), tone: 'violet', icon: 'percent' },
    ]
    if (n > 1) tl.push({ key: 'rev', label: `Revenue for ${fnum(n, 0)} units`, n: r.price * n, fmt: m, tone: 'sky', icon: 'receipt' }, { key: 'prof', label: `${loss ? 'Loss' : 'Profit'} for ${fnum(n, 0)} units`, n: Math.abs(r.profit * n), fmt: m, tone: loss ? 'red' : 'green', icon: 'piggy-bank' })
    t.set(tl)
  }

  for (const k of KEYS) f[k].input.addEventListener('input', () => onEdit(k))
  units.input.addEventListener('input', update)
  prefix()
  update()
  const cheat = h('details', { class: 'cm-details' }, h('summary', 'Margin vs markup cheat sheet'), h('div', { class: 'cm-details-body pm-cheat cm-flat' },
    table({ columns: [{ label: 'Markup', num: true }, { label: 'Gives margin', num: true }, { label: 'Margin', num: true }, { label: 'Needs markup', num: true }],
      rows: [10, 20, 25, 30, 40, 50, 75, 100].map((x) => [`${x}%`, pct((x / (100 + x)) * 100, 2), `${x}%`, pct((x / (100 - x)) * 100, 2)]) }),
    h('p', { class: 'pm-help' }, 'Left: the margin you get from a markup. Right: the markup you need for a margin. A 25% markup is only a 20% margin.')))
  shell(root, layout(
    [card('Fill in any two', { icon: 'calculator', right: curSel }, stack(h('p', { class: 'pm-help' }, 'The two boxes you edit most recently are the ones the maths starts from. The dashed boxes are worked out for you. Edit one to change what you know.'), h('div', { class: 'pm-grid' }, cells), units)), cheat],
    [hr.el, t, note('Margin is profit divided by the selling price. Markup is profit divided by the cost. They are different numbers for the same deal.')]))
}
