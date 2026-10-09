// Molar mass calculator: any chemical formula (brackets and hydrates included) -> molar mass, mass percent per element,
// and a grams / moles / particles / gas volume converter. A list mode handles many compounds at once.
import { h, button, field, segmented, alert, clear, copyText, table, formatNumber, toast, debounce } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, countUp } from './_kit.js'
import { molarMass, hillFormula } from './_chem.js'

const CSS = `
.t-mm .big { font-size: clamp(38px, 8vw, 62px); font-weight: 700; letter-spacing: -.05em; line-height: 1; font-variant-numeric: tabular-nums; }
.t-mm .big small { font-size: .38em; color: var(--muted); font-weight: 560; letter-spacing: -.01em; margin-left: 6px; }
.t-mm .finput { font: 600 22px var(--mono); height: 56px; letter-spacing: .02em; }
.t-mm .sub-f sub { font-size: .7em; }
.t-mm .stackbar { display: flex; height: 22px; border-radius: 99px; overflow: hidden; background: var(--surface-3); }
.t-mm .stackbar i { display: block; height: 100%; width: 0; background: var(--c); transition: width .9s var(--ease); }
.t-mm .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--text-2); }
.t-mm .legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--c); margin-right: 6px; }
.t-mm .conv { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
.t-mm .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.t-mm .two { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 12px; align-items: start; }
@media (max-width: 900px) { .t-mm .two { grid-template-columns: minmax(0, 1fr); } }
`
const COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#a855f7', '#ef4444', '#14b8a6', '#84cc16', '#f97316']
const COMMON = ['H2O', 'NaCl', 'CO2', 'C6H12O6', 'H2SO4', 'CaCO3', 'Ca(OH)2', 'NH3', 'C2H5OH', 'CuSO4.5H2O', 'KMnO4', 'Al2(SO4)3']
const AVOGADRO = 6.02214076e23
const MOLAR_VOLUME = 22.414 // L/mol at STP (0 C, 1 atm)

export const subscripts = (f) => String(f).replace(/[<>&]/g, '').replace(/([A-Za-z)\]}])(\d+)/g, '$1<sub>$2</sub>')

export function mount(root) {
  toolStyle('mm', CSS)
  const st = { mode: 'single', f: load('mm:f', 'Ca(OH)2'), list: load('mm:list', 'H2O\nNaCl\nC6H12O6\nCuSO4.5H2O\nAl2(SO4)3'), ...{} }
  const input = h('input', { class: 'input finput', type: 'text', value: st.f, spellcheck: false, autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Chemical formula', placeholder: 'e.g. Ca(OH)2 or CuSO4.5H2O', oninput: (e) => { st.f = e.target.value; save('mm:f', st.f); paint() } })
  const status = h('div')
  const resBox = h('div', { class: 'stack' })
  const mode = segmented([['single', 'One compound'], ['list', 'List of compounds']], st.mode, (v) => { st.mode = v; singleView.hidden = v !== 'single'; listView.hidden = v !== 'list'; v === 'list' ? paintList() : paint() }, 'Mode')
  let cancelCount = () => {}

  function paint() {
    cancelCount()
    clear(status)
    let r
    if (!st.f.trim()) { clear(resBox, emptyState('flask-conical', 'Type a formula', 'Brackets and hydrates work: Ca(OH)2, Al2(SO4)3, CuSO4.5H2O. Element symbols are case sensitive (Co is cobalt, CO is carbon monoxide).')); return }
    try { r = molarMass(st.f) } catch (e) {
      clear(status, alert('error', e.message)); clear(resBox); return
    }
    const mass = h('span', '0')
    cancelCount = countUp(mass, r.mass, { fmt: (n) => n.toFixed(3), dur: 600 })
    const bars = r.rows.map((x, i) => h('i', { style: { '--c': COLORS[i % COLORS.length] }, title: `${x.symbol} ${x.percent.toFixed(2)}%` }))
    setTimeout(() => bars.forEach((b, i) => { b.style.width = r.rows[i].percent + '%' }), 60)
    const atoms = r.rows.reduce((t, x) => t + x.count, 0)
    const conv = converter(r.mass)
    clear(resBox,
      tile({ tint: TINTS[0], title: 'Molar mass', icon: 'scale', actions: button('Copy', { size: 'sm', variant: 'ghost', icon: 'copy', onClick: () => copyText(`${r.mass.toFixed(3)} g/mol`) }) },
        h('div', { class: 'stack' },
          h('div', { class: 'row', style: 'align-items:baseline' }, h('div', { class: 'big' }, mass, h('small', 'g/mol')), h('span', { class: 'sub-f', style: 'font-size:20px;font-weight:600', html: subscripts(hillFormula(r.counts)) })),
          h('div', { class: 'row' }, pill(`${atoms} atoms`, '', 'atom'), pill(`${r.rows.length} element${r.rows.length === 1 ? '' : 's'}`, '', 'layers')),
          h('div', { class: 'stackbar', role: 'img', 'aria-label': 'Mass percent of each element' }, bars),
          h('div', { class: 'legend' }, r.rows.map((x, i) => h('span', { style: { '--c': COLORS[i % COLORS.length] } }, `${x.symbol} ${x.percent.toFixed(2)}%`))))),
      tile({ tint: TINTS[4], title: 'Composition', icon: 'list' }, table({
        columns: ['Element', { label: 'Atoms', num: true }, { label: 'Atomic mass', num: true }, { label: 'Subtotal (g/mol)', num: true }, { label: 'Mass %', num: true }],
        rows: r.rows.map((x) => [`${x.name} (${x.symbol})`, x.count, x.atomic.toFixed(3), x.subtotal.toFixed(3), x.percent.toFixed(2) + '%']).concat([['Total', atoms, '', r.mass.toFixed(3), '100%']]),
      })),
      tile({ tint: TINTS[3], title: 'Grams, moles and particles', icon: 'arrow-left-right' }, conv))
  }

  /** Four linked fields: editing one fills in the others. */
  function converter(M) {
    const mk = (label, unit) => { const inp = h('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': `${label} (${unit})` }); return inp }
    const g = mk('Mass', 'g'), mol = mk('Amount', 'mol'), n = mk('Particles', 'particles'), v = mk('Gas volume at STP', 'L')
    const set = (src, moles) => {
      const f = (x, d = 6) => (Number.isFinite(x) ? String(+x.toPrecision(d)) : '')
      if (src !== g) g.value = f(moles * M)
      if (src !== mol) mol.value = f(moles)
      if (src !== n) n.value = Number.isFinite(moles) ? (moles * AVOGADRO).toExponential(4) : ''
      if (src !== v) v.value = f(moles * MOLAR_VOLUME)
    }
    const hook = (inp, toMoles) => inp.addEventListener('input', () => { const x = parseFloat(inp.value); set(inp, Number.isFinite(x) && x >= 0 ? toMoles(x) : NaN) })
    hook(g, (x) => x / M); hook(mol, (x) => x); hook(n, (x) => x / AVOGADRO); hook(v, (x) => x / MOLAR_VOLUME)
    return h('div', { class: 'stack' }, h('div', { class: 'conv' }, field('Mass (g)', g), field('Amount (mol)', mol), field('Particles', n), field('Gas volume at STP (L)', v)),
      h('div', { class: 'stu-hint' }, `Type in any box. Uses ${M.toFixed(3)} g/mol, Avogadro's number 6.022 x 10^23 and 22.414 L/mol (0 C, 1 atm). The volume only applies to gases.`))
  }

  const common = h('div', { class: 'chips' }, COMMON.map((f) => h('button', { type: 'button', class: 'stu-chip-btn', onclick: () => { input.value = f; st.f = f; save('mm:f', f); paint() }, html: subscripts(f) })))
  const singleView = h('div', { class: 'two', hidden: st.mode !== 'single' },
    h('div', { class: 'stack' }, tile({ tint: TINTS[5], title: 'Formula', icon: 'flask-conical' }, h('div', { class: 'stack' }, input, status, h('div', { class: 'stu-hint' }, 'Try one of these:'), common))),
    resBox)

  // ---------- list ----------
  const ta = h('textarea', { class: 'textarea', rows: 8, value: st.list, spellcheck: false, 'aria-label': 'Formulas, one per line', placeholder: 'One formula per line', oninput: debounce(() => { st.list = ta.value; save('mm:list', st.list); paintList() }, 150) })
  const listOut = h('div')
  function paintList() {
    const lines = ta.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (!lines.length) { clear(listOut, emptyState('list', 'Add some formulas', 'One per line.')); return }
    const rows = lines.map((l) => { try { const r = molarMass(l); return [h('span', { class: 'sub-f', html: subscripts(l) }), r.mass.toFixed(3)] } catch (e) { return [l, h('span', { style: 'color:var(--danger)' }, e.message)] } })
    clear(listOut, table({ columns: ['Formula', { label: 'Molar mass (g/mol)', num: true }], rows }),
      h('div', { class: 'row', style: 'margin-top:10px' }, button('Copy as table', { size: 'sm', icon: 'copy', onClick: () => copyText(lines.map((l, i) => { try { return `${l}\t${molarMass(l).mass.toFixed(3)}` } catch { return `${l}\terror` } }).join('\n')) })))
  }
  const listView = h('div', { hidden: st.mode !== 'list' }, tile({ tint: TINTS[1], title: 'Many compounds at once', icon: 'list' }, h('div', { class: 'stack' }, ta, listOut)))

  root.append(stage('t-mm', h('div', { class: 'stack' }, h('div', { class: 'row' }, mode), singleView, listView)))
  paint(); paintList()
  return () => cancelCount()
}
