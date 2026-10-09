// Percentage calculator. params.mode: 'basic' (four quick forms), 'change' (percentage change) or 'reverse' (find the original value).
import { h, icon } from '../../lib/ui.js'
import { shell, num, inline, hero, tiles, bars, card, layout, note, switcher, fnum, pct, firstIssue, style, tween, stack } from './_shared.js'

/** p% of y */
export const percentOf = (p, y) => (p / 100) * y
/** x is what percent of y */
export const whatPercent = (x, y) => (x / y) * 100
/** x is p% of what number */
export const wholeFrom = (x, p) => x / (p / 100)
/** percentage change from a to b (relative to |a|) */
export const percentChange = (a, b) => ((b - a) / Math.abs(a)) * 100
/** percent difference between a and b, relative to their average */
export const percentDifference = (a, b) => (Math.abs(a - b) / ((Math.abs(a) + Math.abs(b)) / 2)) * 100
/** Original value before a discount ('off') or an increase ('on') of p percent that left `final`. */
export const originalValue = (final, p, kind) => (kind === 'off' ? final / (1 - p / 100) : final / (1 + p / 100))

const CSS = `
.pc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.pc-card { display: flex; flex-direction: column; gap: 16px; }
.pc-card .cm-card-head { margin-bottom: 0; }
.pc-sentence { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-size: 16px; font-weight: 550; color: var(--text-2); }
.pc-sentence .cm-adorn { width: 128px; flex: none; }
.pc-res { position: relative; border-radius: 20px; padding: 16px 18px; background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 11%, var(--surface)), color-mix(in srgb, var(--accent-2) 8%, var(--surface))); border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border)); }
.pc-big { font-size: clamp(30px, 6vw, 40px); font-weight: 650; letter-spacing: -.045em; font-variant-numeric: tabular-nums; line-height: 1.1; overflow-wrap: anywhere; background: linear-gradient(110deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pc-cap { margin-top: 6px; font-size: 13.5px; color: var(--muted); overflow-wrap: anywhere; min-height: 20px; }
.pc-res .cm-bar-track { margin-top: 12px; height: 8px; }
.pc-res .cm-bar-track i { background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.pc-more { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 14px; color: var(--muted); }
.pc-more a { color: var(--accent); font-weight: 600; display: inline-flex; align-items: center; gap: 5px; min-height: 32px; }
.pc-more a:hover { text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 900px) { .pc-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 420px) { .pc-sentence .cm-adorn { width: 112px; } }
`

function formCard({ title, ic, parts, fields, compute }) {
  const big = h('div', { class: 'pc-big' }, '-')
  const cap = h('div', { class: 'pc-cap' })
  const fill = h('i')
  const el = h('section', { class: 'panel cm-card pc-card' },
    h('div', { class: 'cm-card-head' }, h('h2', {}, icon(ic), title)),
    h('div', { class: 'pc-sentence' }, parts),
    h('div', { class: 'pc-res', 'aria-live': 'polite' }, big, cap, h('div', { class: 'cm-bar-track', 'aria-hidden': 'true' }, fill)))
  function update() {
    const bad = firstIssue(...fields)
    const r = bad ? null : compute(...fields.map((f) => f.val()))
    if (!r || !Number.isFinite(r.n)) {
      cancelAnimationFrame(big._raf)
      big._v = null
      big.textContent = '-'
      cap.textContent = bad || (r?.error ?? 'Enter the numbers above')
      fill.style.width = '0%'
      return
    }
    tween(big, r.n, r.fmt)
    cap.textContent = r.caption
    fill.style.width = `${Math.max(0, Math.min(100, r.bar))}%`
  }
  for (const f of fields) f.input.addEventListener('input', update)
  update()
  return el
}

function basic() {
  const f = (label, value, o = {}) => inline(label, { value, ...o })
  const a1 = f('Percent', 15, { suffix: '%' }), b1 = f('Number', 200)
  const a2 = f('Part', 25), b2 = f('Whole', 80)
  const a3 = f('Amount', 30), b3 = f('Percent', 12, { suffix: '%' })
  const a4 = f('Percent', 12, { suffix: '%' }), b4 = f('Number', 500)
  const t1 = formCard({
    title: 'Percent of a number', ic: 'percent', fields: [a1, b1], parts: ['What is', a1, 'of', b1, '?'],
    compute: (p, y) => { const n = percentOf(p, y); return { n, fmt: (v) => fnum(v, 4), caption: `${fnum(p, 4)}% of ${fnum(y, 4)} is ${fnum(n, 4)}`, bar: p } },
  })
  const t2 = formCard({
    title: 'What percent is it?', ic: 'divide', fields: [a2, b2], parts: [a2, 'is what % of', b2, '?'],
    compute: (x, y) => (y === 0 ? { error: 'The whole cannot be zero' } : { n: whatPercent(x, y), fmt: (v) => `${fnum(v, 4)}%`, caption: `${fnum(x, 4)} out of ${fnum(y, 4)} is ${fnum(whatPercent(x, y), 4)}%`, bar: whatPercent(x, y) }),
  })
  const t3 = formCard({
    title: 'Find the whole', ic: 'undo-2', fields: [a3, b3], parts: [a3, 'is', b3, 'of what number?'],
    compute: (x, p) => (p === 0 ? { error: 'The percent cannot be zero' } : { n: wholeFrom(x, p), fmt: (v) => fnum(v, 4), caption: `${fnum(x, 4)} is ${fnum(p, 4)}% of ${fnum(wholeFrom(x, p), 4)}`, bar: p }),
  })
  const t4 = formCard({
    title: 'Increase or decrease', ic: 'trending-up', fields: [a4, b4], parts: ['Add', a4, 'to', b4, '?'],
    compute: (p, y) => ({ n: y * (1 + p / 100), fmt: (v) => fnum(v, 4), caption: `${fnum(y, 4)} + ${fnum(p, 4)}% = ${fnum(y * (1 + p / 100), 4)}. Subtract instead: ${fnum(y * (1 - p / 100), 4)}`, bar: p }),
  })
  return stack(
    h('div', { class: 'pc-grid' }, t1, t2, t3, t4),
    h('div', { class: 'pc-more' }, h('span', 'Need something else?'),
      h('a', { href: '#/percentage-change' }, icon('trending-up'), 'Percentage change'), h('a', { href: '#/reverse-percentage' }, icon('undo-2'), 'Reverse percentage')))
}

function change() {
  const from = num('From (old value)', { value: 80, min: -1e12, max: 1e12 })
  const to = num('To (new value)', { value: 100, min: -1e12, max: 1e12 })
  const hr = hero({ label: 'Percentage change', tone: 'violet', icon: 'trending-up' })
  const t = tiles()
  const b = bars()
  function update() {
    const bad = firstIssue(from, to)
    if (bad) { hr.empty(bad); t.set([]); b.set([]); return }
    const a = from.val()
    const c = to.val()
    if (a === 0) { hr.empty('A change from zero is undefined. Try a different starting value.'); t.set([]); b.set([]); return }
    const p = percentChange(a, c)
    const up = c > a
    hr.set({
      n: p, fmt: (v) => `${v > 0 ? '+' : ''}${fnum(v, 2)}%`,
      sub: c === a ? 'No change' : `${up ? 'An increase' : 'A decrease'} of ${fnum(Math.abs(c - a), 4)}, from ${fnum(a, 4)} to ${fnum(c, 4)}`,
      chips: [{ label: 'Difference', value: `${c - a > 0 ? '+' : ''}${fnum(c - a, 4)}` }, { label: 'Ratio', value: `${fnum(c / a, 4)}x` }],
      copy: `Change from ${fnum(a, 4)} to ${fnum(c, 4)}: ${p > 0 ? '+' : ''}${fnum(p, 2)}%`,
    })
    t.set([
      { label: 'Percent difference', value: pct(percentDifference(a, c), 2), hint: 'relative to the average of both', tone: 'violet', icon: 'git-compare-arrows' },
      { label: up ? 'New is larger by' : c < a ? 'New is smaller by' : 'Same value', value: pct(Math.abs(p), 2), hint: `of the old value`, tone: up ? 'green' : 'red', icon: up ? 'trending-up' : 'trending-down' },
    ])
    b.set([{ key: 'o', label: 'Old value', value: Math.abs(a), text: fnum(a, 4), color: 'var(--border-strong)' }, { key: 'n', label: 'New value', value: Math.abs(c), text: fnum(c, 4), color: up ? '#16a34a' : '#dc2626' }])
  }
  for (const f of [from, to]) f.input.addEventListener('input', update)
  update()
  return layout([card('Compare two numbers', { icon: 'git-compare-arrows' }, stack(from, to)), card('Side by side', {}, b)], [hr.el, t, note('Formula: (new - old) / |old| x 100.')])
}

function reverse() {
  const final = num('Final value', { value: 800, min: -1e12, max: 1e12, hint: 'The price or number you have now' })
  const p = num('Percent', { value: 20, min: 0, max: 1000, suffix: '%' })
  let kind = 'off'
  const kindSw = switcher([['off', 'After a discount', 'tag'], ['on', 'After an increase', 'trending-up']], kind, (v) => { kind = v; update() }, 'What happened to the original value')
  const hr = hero({ label: 'Original value', tone: 'sunset', icon: 'undo-2' })
  const t = tiles()
  function update() {
    const bad = firstIssue(final, p)
    if (bad) { hr.empty(bad); t.set([]); return }
    const f = final.val()
    const r = p.val()
    if (kind === 'off' && r >= 100) { hr.empty('A discount of 100% or more leaves nothing to work back from.'); t.set([]); return }
    if (kind === 'on' && r <= -100) { hr.empty('Use a percent above -100.'); t.set([]); return }
    const o = originalValue(f, r, kind)
    hr.set({
      n: o, fmt: (v) => fnum(v, 2),
      sub: kind === 'off' ? `${fnum(f, 4)} is what is left after ${fnum(r, 4)}% off` : `${fnum(f, 4)} is the result of adding ${fnum(r, 4)}% to the original`,
      chips: [{ label: kind === 'off' ? 'Amount taken off' : 'Amount added', value: fnum(Math.abs(f - o), 2) }],
      copy: `Original value: ${fnum(o, 2)} (${fnum(f, 4)} after ${fnum(r, 4)}% ${kind === 'off' ? 'off' : 'added'})`,
    })
    t.set([
      { label: kind === 'off' ? 'You pay' : 'Final value', value: fnum(f, 2), tone: 'indigo', icon: 'wallet' },
      { label: 'Share of the original', value: pct((f / o) * 100, 2), hint: kind === 'off' ? `${fnum(100 - r, 4)}% of the original remains` : `${fnum(100 + r, 4)}% of the original`, tone: 'orange', icon: 'percent' },
    ])
  }
  for (const f of [final, p]) f.input.addEventListener('input', update)
  update()
  return layout(
    [card('What do you know?', { icon: 'search' }, stack(kindSw, final, p))],
    [hr.el, t, note(kind === 'off' ? 'Formula: original = final / (1 - percent / 100).' : 'Formula: original = final / (1 + percent / 100).')])
}

export function mount(root, { params }) {
  style('pc-style', CSS)
  const mode = params?.mode || 'basic'
  shell(root, mode === 'change' ? change() : mode === 'reverse' ? reverse() : basic())
}
