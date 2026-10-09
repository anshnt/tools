// List compare: two lists in, a Venn diagram and the differences out. params.op = diff | intersect | union | subtract.
// compare(a, b, options) is pure and exported for tests.
import { h, svg, button } from '../../lib/ui.js'
import {
  root, dock, group, chips, ribbon, pane, area, createOptions, copyBtn, saveBtn, inputActions, acceptFiles, chipButton, countTo, flash, formatList,
  OUT_FORMATS, saveText, plural, injectStyle, tooBig,
} from './_shared.js'

const SPLIT = { lines: /\r\n|\r|\n/, commas: /[,\n\r]+/, any: /[,;\t\n\r]+/ }

/** Split a list into items (blank items dropped). */
export function items(text, split = 'lines', trim = true) {
  return text.split(SPLIT[split]).map((s) => (trim ? s.trim() : s)).filter((s) => s !== '')
}

/** compare(textA, textB, {split, ignoreCase, trim, sort}) -> sets and counts. */
export function compare(textA, textB, o) {
  const fold = (s) => (o.ignoreCase ? s.toLowerCase() : s)
  const a = items(textA, o.split, o.trim)
  const b = items(textB, o.split, o.trim)
  const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = fold(x); if (seen.has(k)) return false; seen.add(k); return true }) }
  const ua = uniq(a), ub = uniq(b)
  const ka = new Set(ua.map(fold)), kb = new Set(ub.map(fold))
  const order = (arr) => {
    if (o.sort === 'az') return [...arr].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }))
    if (o.sort === 'za') return [...arr].sort((x, y) => y.localeCompare(x, undefined, { numeric: true, sensitivity: 'base' }))
    return arr
  }
  const onlyA = order(ua.filter((x) => !kb.has(fold(x))))
  const onlyB = order(ub.filter((x) => !ka.has(fold(x))))
  const both = order(ua.filter((x) => kb.has(fold(x))))
  const union = o.sort === 'none' ? [...ua, ...onlyB] : order([...ua, ...onlyB])
  return { onlyA, onlyB, both, union, aTotal: a.length, bTotal: b.length, aUnique: ua.length, bUnique: ub.length }
}

const OPS = {
  diff: { highlight: ['a', 'ab', 'b'], file: 'list-differences.txt' },
  intersect: { highlight: ['ab'], file: 'in-both-lists.txt' },
  union: { highlight: ['a', 'ab', 'b'], file: 'combined-list.txt' },
  subtract: { highlight: ['a'], file: 'list-a-minus-b.txt' },
}
const SAMPLE_A = 'apple\nbanana\ncherry\ndate\nelderberry\nBanana'
const SAMPLE_B = 'banana\ncherry\nfig\ngrape\nDATE'

let uid = 0
function venn(highlight) {
  const id = `tuv${++uid}`
  const A = { cx: 92, cy: 76, r: 60 }, B = { cx: 148, cy: 76, r: 60 }
  const circ = (c, extra = {}) => svg('circle', { cx: c.cx, cy: c.cy, r: c.r, ...extra })
  const num = (x, cls) => svg('text', { x, y: 82, 'text-anchor': 'middle', class: `tu-vn ${cls}` }, '0')
  const nums = { a: num(60, 'a'), ab: num(120, 'ab'), b: num(180, 'b') }
  const el = svg('svg', { viewBox: '0 0 240 152', class: 'tu-venn', role: 'img', 'aria-label': 'Venn diagram of list A and list B' },
    svg('defs', null,
      svg('clipPath', { id: `${id}cb` }, circ(B)),
      svg('mask', { id: `${id}nb` }, svg('rect', { width: 240, height: 152, fill: '#fff' }), circ(B, { fill: '#000' })),
      svg('mask', { id: `${id}na` }, svg('rect', { width: 240, height: 152, fill: '#fff' }), circ(A, { fill: '#000' }))),
    circ(A, { class: 'tu-vc a' }), circ(B, { class: 'tu-vc b' }),
    circ(A, { class: 'tu-vr a', mask: `url(#${id}nb)`, 'data-r': 'a' }),
    circ(B, { class: 'tu-vr b', mask: `url(#${id}na)`, 'data-r': 'b' }),
    circ(A, { class: 'tu-vr ab', 'clip-path': `url(#${id}cb)`, 'data-r': 'ab' }),
    svg('text', { x: 38, y: 16, class: 'tu-vl' }, 'A'), svg('text', { x: 202, y: 16, class: 'tu-vl', 'text-anchor': 'end' }, 'B'),
    nums.a, nums.ab, nums.b)
  for (const r of el.querySelectorAll('[data-r]')) r.classList.toggle('on', highlight.includes(r.dataset.r))
  return { el, set: (a, ab, b) => { countTo(nums.a, a); countTo(nums.ab, ab); countTo(nums.b, b) } }
}

const CSS = `
.tu-res { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 14px; align-items: start; }
.tu-venn { width: 100%; height: auto; display: block; }
.tu-vc { fill: none; stroke-width: 1.6; }
.tu-vc.a { stroke: var(--accent); } .tu-vc.b { stroke: var(--accent-2); }
.tu-vr { opacity: 0; transition: opacity .5s var(--ease); }
.tu-vr.on { opacity: .34; }
.tu-vr.a { fill: var(--accent); } .tu-vr.b { fill: var(--accent-2); } .tu-vr.ab { fill: color-mix(in srgb, var(--accent) 50%, var(--accent-2)); }
.tu-vr.ab.on { opacity: .62; }
.tu-vn { font: 650 19px var(--font); fill: var(--text); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.tu-vl { font: 650 12px var(--font); fill: var(--muted); }
.tu-venn-card { display: flex; flex-direction: column; gap: 10px; }
.tu-result-set { display: grid; gap: 14px; min-width: 0; }
.tu-result-set.thirds { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.tu-result-set .tu-area { min-height: 190px; }
.tu-sub { font-size: 12.5px; color: var(--muted); padding: 0 16px; }
@media (max-width: 1100px) { .tu-result-set.thirds { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 900px) { .tu-res { grid-template-columns: minmax(0, 1fr); } .tu-venn-card { max-width: 340px; } }
`

export function mount(rootEl, { tool, params }) {
  const op = params.op
  const cfg = OPS[op]
  if (!cfg) throw new Error(`Unknown list tool "${op}"`)
  injectStyle()
  if (!document.getElementById('tu-lc-style')) document.head.append(h('style', { id: 'tu-lc-style' }, CSS))
  const o = createOptions(tool.id, { split: 'lines', ignoreCase: true, trim: true, sort: 'none', out: 'lines' })
  const rib = ribbon()
  const mk = (title, placeholder) => {
    const ta = area({ mono: true, short: true, placeholder, 'aria-label': title })
    const foot = h('div', { class: 'tu-foot' }, h('span', 'Nothing yet'), h('span'))
    return { ta, foot }
  }
  const A = mk('List A', 'List A: one item per line...')
  const B = mk('List B', 'List B: one item per line...')
  const setBoth = () => { A.ta.value = SAMPLE_A; B.ta.value = SAMPLE_B; refresh() }
  const paneA = pane({ title: 'List A', body: A.ta, foot: A.foot, actions: inputActions({ ta: A.ta, sample: null, onChange: () => refresh() }) })
  const paneB = pane({ title: 'List B', body: B.ta, foot: B.foot, actions: inputActions({ ta: B.ta, sample: null, onChange: () => refresh() }) })
  paneA.querySelector('.tu-acts').prepend(button('', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', ariaLabel: 'Try an example in both lists', onClick: setBoth }))
  acceptFiles(paneA, (t) => { A.ta.value = t; refresh() })
  acceptFiles(paneB, (t) => { B.ta.value = t; refresh() })

  const swap = chipButton('Swap A and B', () => { const t = A.ta.value; A.ta.value = B.ta.value; B.ta.value = t; refresh() }, 'arrow-left-right')
  const controls = dock(
    group('Split items on', o.pills('split', [['lines', 'New lines'], ['commas', 'Commas'], ['any', 'Commas, semicolons, tabs']], 'How to split items')),
    group('Compare', chips(o.bool('ignoreCase', 'Ignore capitals'), o.bool('trim', 'Ignore spaces at the ends'))),
    group('Order', o.pills('sort', [['none', 'As typed'], ['az', 'A to Z'], ['za', 'Z to A']], 'Order of results')),
    group('Copy as', o.select('out', OUT_FORMATS, 'Copy format')),
    group('', swap))

  const v = venn(cfg.highlight)
  const outputs = {}
  const mkOut = (key, title, tone) => {
    const ta = area({ readonly: true, mono: true, 'aria-label': title })
    const foot = h('div', { class: 'tu-foot' }, h('span'), h('span'))
    const p = pane({ title, out: true, body: ta, foot, actions: [saveBtn(() => ta.value, `${key}.txt`), copyBtn(() => ta.value, 'Copy')] })
    outputs[key] = { ta, foot, pane: p, last: '' }
    return p
  }
  let resultSet
  if (op === 'diff') resultSet = h('div', { class: 'tu-result-set thirds' }, mkOut('only-in-a', 'Only in A'), mkOut('in-both', 'In both'), mkOut('only-in-b', 'Only in B'))
  else resultSet = h('div', { class: 'tu-result-set' }, mkOut('result', { intersect: 'In both lists', union: 'All items, no duplicates', subtract: 'In A but not in B' }[op]))

  const csvBtn = op === 'diff' ? button('Download CSV', { icon: 'table-2', variant: 'secondary', size: 'sm', onClick: () => {
    const r = last
    if (!r) return
    const q = (s) => `"${(s || '').replace(/"/g, '""')}"`
    const rows = [['Only in A', 'In both', 'Only in B'].map(q).join(',')]
    for (let i = 0; i < Math.max(r.onlyA.length, r.both.length, r.onlyB.length); i++) rows.push([r.onlyA[i], r.both[i], r.onlyB[i]].map(q).join(','))
    saveText(rows.join('\r\n'), 'list-comparison.csv', 'text/csv;charset=utf-8')
  } }) : null
  const vennCard = h('section', { class: 'tu-card tu-venn-card' }, h('h3', 'Overlap'), v.el, csvBtn)

  let last = null
  const setOut = (key, list, noun) => {
    const out = outputs[key]
    const text = formatList(list, o.v.out)
    if (text !== out.ta.value) { out.ta.value = text; flash(out.pane) }
    out.foot.firstChild.textContent = plural(list.length, noun || 'item')
  }
  function refresh() {
    const big = tooBig(A.ta.value) || tooBig(B.ta.value)
    if (big) { rib.set([{ label: big, value: '!', tone: 'bad' }]); return }
    const r = compare(A.ta.value, B.ta.value, o.v)
    last = r
    const dupNote = (name, total, uniq) => (total > uniq ? `${name} has ${plural(total - uniq, 'repeated item')} (counted once).` : '')
    A.foot.firstChild.textContent = A.ta.value.trim() ? `${plural(r.aUnique, 'item')}${r.aTotal !== r.aUnique ? ` (${r.aTotal} with repeats)` : ''}` : 'Nothing yet'
    B.foot.firstChild.textContent = B.ta.value.trim() ? `${plural(r.bUnique, 'item')}${r.bTotal !== r.bUnique ? ` (${r.bTotal} with repeats)` : ''}` : 'Nothing yet'
    v.set(r.onlyA.length, r.both.length, r.onlyB.length)
    if (op === 'diff') { setOut('only-in-a', r.onlyA); setOut('in-both', r.both); setOut('only-in-b', r.onlyB) }
    else setOut('result', { intersect: r.both, union: r.union, subtract: r.onlyA }[op])
    const have = A.ta.value.trim() || B.ta.value.trim()
    const badges = !have ? [] : {
      diff: [{ label: 'only in A', value: r.onlyA.length, tone: 'accent' }, { label: 'in both', value: r.both.length, tone: 'good' }, { label: 'only in B', value: r.onlyB.length, tone: 'accent' }],
      intersect: [{ label: 'items in both', value: r.both.length, tone: 'good' }, { label: 'unique in A', value: r.aUnique }, { label: 'unique in B', value: r.bUnique }],
      union: [{ label: 'items in total', value: r.union.length, tone: 'accent' }, { label: 'from A', value: r.aUnique }, { label: 'new from B', value: r.onlyB.length }],
      subtract: [{ label: 'left in A', value: r.onlyA.length, tone: 'accent' }, { label: 'removed', value: r.both.length, tone: r.both.length ? 'good' : '' }],
    }[op]
    rib.set(badges, have ? [dupNote('List A', r.aTotal, r.aUnique), dupNote('List B', r.bTotal, r.bUnique)].filter(Boolean).join(' ') : 'Paste two lists, or hit the wand to see an example.')
  }
  o.onChange = refresh
  A.ta.addEventListener('input', refresh)
  B.ta.addEventListener('input', refresh)

  rootEl.append(root(controls, rib.el, h('div', { class: 'tu-panes' }, paneA, paneB), h('div', { class: 'tu-res' }, vennCard, resultSet)))
  refresh()
  A.ta.focus({ preventScroll: true })
}
