// Chemical equation balancer: type an unbalanced equation, get the smallest whole-number coefficients and an atom-by-atom check.
import { h, button, alert, clear, copyText, table } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS } from './_kit.js'
import { balance } from './_chem.js'

const CSS = `
.t-ceb .finput { font: 600 20px var(--mono); height: 56px; }
.t-ceb .eq { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: clamp(20px, 4.2vw, 30px); font-weight: 600; letter-spacing: -.02em; line-height: 1.5; }
.t-ceb .eq .sp { display: inline-flex; align-items: baseline; gap: 3px; animation: stu-pop .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 70ms); }
.t-ceb .eq .co { display: inline-grid; place-items: center; min-width: 1.5em; padding: 0 .3em; border-radius: 10px; background: color-mix(in srgb, var(--accent) 16%, var(--surface)); color: var(--accent); font-weight: 700; }
.t-ceb .eq .co.one { background: transparent; color: var(--muted); font-weight: 500; }
.t-ceb .eq .op { color: var(--muted); font-weight: 500; }
.t-ceb .eq sub { font-size: .65em; }
.t-ceb .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.t-ceb .tick { color: var(--success); font-weight: 700; }
.t-ceb .lead { color: var(--text-2); font-size: 13.5px; }
`
const EXAMPLES = ['H2 + O2 -> H2O', 'Fe + O2 -> Fe2O3', 'C3H8 + O2 -> CO2 + H2O', 'Al + H2SO4 -> Al2(SO4)3 + H2', 'KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2', 'C6H12O6 + O2 -> CO2 + H2O', 'Ca(OH)2 + H3PO4 -> Ca3(PO4)2 + H2O', 'NH3 + O2 -> NO + H2O']
const sub = (f) => String(f).replace(/[<>&]/g, '').replace(/([A-Za-z)\]}])(\d+)/g, '$1<sub>$2</sub>')
const latexOf = (r) => { const sp = (s) => `${s.coeff === 1 ? '' : s.coeff}\\mathrm{${s.formula.replace(/(\d+)/g, '_{$1}')}}`; return `${r.left.map(sp).join(' + ')} \\longrightarrow ${r.right.map(sp).join(' + ')}` }

export function mount(root) {
  toolStyle('ceb', CSS)
  let text = load('ceb:text', 'C3H8 + O2 -> CO2 + H2O')
  const input = h('input', { class: 'input finput', type: 'text', value: text, spellcheck: false, autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Unbalanced chemical equation', placeholder: 'H2 + O2 -> H2O', oninput: (e) => { text = e.target.value; save('ceb:text', text); paint() } })
  const status = h('div')
  const out = h('div', { class: 'stack' })

  function paint() {
    clear(status)
    if (!text.trim()) { clear(out, emptyState('scale', 'Type an equation', 'Use "->" or "=" between reactants and products. Coefficients you already typed are ignored.')); return }
    let r
    try { r = balance(text.replace(/\((?:s|l|g|aq)\)/g, '')) } catch (e) { clear(out); clear(status, alert('error', e.message)); return }
    const eqNode = (sides) => sides.flatMap((s, i) => [i ? h('span', { class: 'op' }, '+') : null, h('span', { class: 'sp', style: { '--i': i } }, h('span', { class: ['co', s.coeff === 1 && 'one'] }, s.coeff), h('span', { html: sub(s.formula) }))])
    const els = Object.entries(r.counts)
    const fine = els.every(([, [a, b]]) => a === b)
    clear(out,
      tile({ tint: TINTS[3], title: 'Balanced equation', icon: 'scale', actions: pill(fine ? 'Balanced' : 'Check', fine ? 'ok' : 'bad', fine ? 'circle-check' : 'triangle-alert') },
        h('div', { class: 'stack' },
          h('div', { class: 'eq', role: 'math', 'aria-label': r.text }, ...eqNode(r.left), h('span', { class: 'op' }, '→'), ...eqNode(r.right)),
          r.independent > 1 ? alert('info', 'This equation can be balanced in several independent ways. The smallest solution is shown.') : null,
          h('div', { class: 'row' },
            button('Copy equation', { variant: 'primary', icon: 'copy', size: 'sm', onClick: () => copyText(r.text) }),
            button('Copy LaTeX', { icon: 'copy', size: 'sm', onClick: () => copyText(latexOf(r)) })))),
      tile({ tint: TINTS[4], title: 'Atom check', icon: 'atom' }, table({
        columns: ['Element', { label: 'Reactants', num: true }, { label: 'Products', num: true }, { label: '', num: false }],
        rows: els.map(([el, [a, b]]) => [el, a, b, h('span', { class: a === b ? 'tick' : '', 'aria-label': a === b ? 'equal' : 'not equal' }, a === b ? '✓' : '✗')]),
      })))
  }
  const chips = h('div', { class: 'chips' }, EXAMPLES.map((e) => h('button', { type: 'button', class: 'stu-chip-btn', onclick: () => { input.value = e; text = e; save('ceb:text', e); paint() }, html: sub(e).replace('-&gt;', '→').replace('->', '→') })))
  root.append(stage('t-ceb', h('div', { class: 'stu-bento' },
    h('div', { class: 's5', style: 'min-width:0' }, tile({ tint: TINTS[5], title: 'Your equation', icon: 'flask-conical' }, h('div', { class: 'stack' }, input, status,
      h('div', { class: 'lead' }, 'Separate compounds with "+" and sides with "->" or "=". State symbols such as (aq) are ignored. Charged ions and half-reactions are not supported.'),
      h('div', { class: 'stu-hint' }, 'Try an example:'), chips))),
    h('div', { class: 's7', style: 'min-width:0' }, out))))
  paint()
}
