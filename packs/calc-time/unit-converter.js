// Unit converter (also serves the focused converters through params.kind; params.india = Indian land units only).
import { h, icon, button, field, segmented, select as uiSelect, clear, copyText, table, input } from '../../lib/ui.js'
import { useStyles, addStyles, settleOnce, hashParams } from './_kit.js'
import { load, save } from '../../lib/store.js'
import { KINDS, BIGHA_STATES, INGREDIENTS, unitsFor, toBase, fromBase, fmtVal, parseNum, mixedText } from './_units.js'

const CSS = `
.ct-kinds { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 6px; scrollbar-width: thin; }
.ct-kinds .ct-chip { flex: none; min-height: 38px; padding: 0 14px; }
.ct-uc { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 12px; align-items: stretch; }
.ct-ucs { position: relative; isolation: isolate; overflow: hidden; border-radius: 24px; padding: 16px 18px 18px; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow-sm); display: flex; flex-direction: column; gap: 8px; min-width: 0;
  transition: border-color .25s, box-shadow .25s; }
.ct-ucs::before { content: ""; position: absolute; z-index: -1; inset: 0; opacity: 0; transition: opacity .35s; background: radial-gradient(360px circle at 20% 0%, color-mix(in srgb, var(--c, var(--accent)) 16%, transparent), transparent 65%); }
.ct-ucs:focus-within { border-color: color-mix(in srgb, var(--c, var(--accent)) 55%, var(--border)); box-shadow: 0 18px 40px -24px var(--c, var(--accent)); }
.ct-ucs:focus-within::before { opacity: 1; }
.ct-ucs.to { background: linear-gradient(150deg, color-mix(in srgb, var(--c, var(--accent)) 10%, var(--surface)), var(--surface) 70%); }
.ct-ucs .tag { font-size: 11.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
.ct-ucs .num { width: 100%; min-width: 0; height: 62px; border: 0; background: transparent; outline: none; padding: 0; font: inherit; font-size: clamp(28px, 5vw, 42px); font-weight: 650; letter-spacing: -.035em; font-variant-numeric: tabular-nums; color: var(--text); }
.ct-ucs .num::placeholder { color: var(--border-strong); }
.ct-ucs select { height: 42px; border-radius: 999px; padding-left: 16px; font-weight: 550; }
.ct-swap { align-self: center; width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--c, var(--accent)); display: grid; place-items: center; cursor: pointer; box-shadow: var(--shadow); transition: transform .5s var(--spring), background .2s; z-index: 1; }
.ct-swap:hover { background: var(--surface-2); }
.ct-swap:active { transform: scale(.9); }
.ct-swap.spin { transform: rotate(180deg); }
.ct-eq { font-size: clamp(16px, 2.6vw, 20px); font-weight: 600; letter-spacing: -.02em; overflow-wrap: anywhere; }
.ct-eq small { display: block; margin-top: 4px; font-size: 13px; font-weight: 400; color: var(--muted); letter-spacing: 0; }
.ct-mixed { display: flex; flex-wrap: wrap; gap: 6px 10px; font-size: 13px; color: var(--text-2); }
.ct-mixed span { padding: 3px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); font-variant-numeric: tabular-nums; }
.ct-uts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 190px), 1fr)); gap: 10px; }
.ct-ut { position: relative; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); transition: transform .25s var(--ease), border-color .2s, box-shadow .25s; animation: ctPop .45s var(--spring) both; animation-delay: calc(var(--i, 0) * 18ms); }
.ct-ut:hover { transform: translateY(-2px); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--c) 40%, var(--border)); }
.ct-ut.on { border-color: color-mix(in srgb, var(--c) 60%, var(--border)); background: linear-gradient(145deg, color-mix(in srgb, var(--c) 12%, var(--surface)), var(--surface)); }
.ct-ut .sel { display: block; width: 100%; text-align: left; border: 0; background: none; cursor: pointer; padding: 11px 38px 11px 13px; border-radius: 16px; font: inherit; color: inherit; }
.ct-ut .n { display: block; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ct-ut .v { display: block; margin-top: 2px; font-size: 17px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ct-ut .s { font-size: 12px; color: var(--muted); }
.ct-ut .cp { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 9px; border: 0; background: none; color: var(--muted); display: grid; place-items: center; cursor: pointer; opacity: .7; }
.ct-ut .cp:hover { background: var(--surface-2); color: var(--text); opacity: 1; }
.ct-ut .cp .icon { width: 14px; height: 14px; }
.ct-ut-group { grid-column: 1 / -1; font-size: 11.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-top: 6px; }
@media (max-width: 720px) {
  .ct-uc { grid-template-columns: minmax(0, 1fr); }
  .ct-swap { margin: -22px 0; justify-self: center; transform: rotate(90deg); }
  .ct-swap.spin { transform: rotate(270deg); }
}
`

export function mount(root, { params }) {
  useStyles()
  addStyles('ct-units', CSS)
  const locked = params?.kind
  const india = !!params?.india
  const q = hashParams()
  let kind = KINDS[locked] ? locked : KINDS[q.get('k')] ? q.get('k') : KINDS[load('uc:kind', '')] ? load('uc:kind') : 'length'
  let prec = load('uc:prec', 'auto')
  let bighaState = load('uc:state', 'up')
  let ingredient = load('uc:ing', 'flour')
  let view = load('uc:view', 'cards')
  let units = [], fromId, toId, base = NaN, last = 'from', filter = ''

  const ctx = () => ({ bigha: BIGHA_STATES.find((s) => s[0] === bighaState)?.[2], grams: INGREDIENTS.find((s) => s[0] === ingredient)?.[2], india })
  const U = (id) => units.find((u) => u.id === id) || units[0]

  const unitSelect = (onChange) => {
    const el = h('select', { class: 'select', onchange: (e) => onChange(e.target.value) })
    el.setUnits = (list, value) => {
      el.replaceChildren()
      const groups = [...new Set(list.map((u) => u.group))]
      for (const g of groups) {
        const og = groups.length > 1 ? h('optgroup', { label: g }) : el
        for (const u of list.filter((x) => x.group === g)) og.append(h('option', { value: u.id }, `${u.name} (${u.sym})`))
        if (og !== el) el.append(og)
      }
      el.value = value
    }
    return el
  }
  const fromIn = h('input', { class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', 'aria-label': 'Value to convert', oninput: () => onFrom() })
  const toIn = h('input', { class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', 'aria-label': 'Converted value', oninput: () => onTo() })
  const fromSel = unitSelect((id) => { fromId = id; saveUnits(); onFrom() })
  const toSel = unitSelect((id) => { toId = id; saveUnits(); showTo(); renderAll() })
  const swapBtn = h('button', { type: 'button', class: 'ct-swap', 'aria-label': 'Swap the two units', title: 'Swap', onclick: () => {
    swapBtn.classList.toggle('spin')
    ;[fromId, toId] = [toId, fromId]
    ;[fromIn.value, toIn.value] = [toIn.value, fromIn.value]
    fromSel.value = fromId; toSel.value = toId
    last = last === 'from' ? 'to' : 'from'
    saveUnits(); renderAll()
  } }, icon('arrow-left-right'))
  const precSel = uiSelect([['auto', 'Auto'], ...[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => [String(n), `${n} decimal${n === 1 ? '' : 's'}`])], prec, (v) => { prec = v; save('uc:prec', v); if (last === 'from') showTo(); else showFrom(); renderAll() })
  const stateSel = uiSelect(BIGHA_STATES.map((s) => [s[0], s[1]]), bighaState, (v) => { bighaState = v; save('uc:state', v); rebuildUnits(); onFrom() })
  const ingSel = uiSelect(INGREDIENTS.map((s) => [s[0], s[1]]), ingredient, (v) => { ingredient = v; save('uc:ing', v); rebuildUnits(); onFrom() })
  const kindBar = h('div', { class: 'ct-kinds', role: 'group', 'aria-label': 'What to convert' })
  const extras = h('div', { class: 'ct-fields' })
  const eq = h('div', { class: 'ct-eq', 'aria-live': 'polite' })
  const mixed = h('div', { class: 'ct-mixed' })
  const presets = h('div', { class: 'ct-chips' })
  const compound = h('div', { class: 'ct-fields', style: 'grid-template-columns:repeat(auto-fit,minmax(min(100%,110px),1fr))' })
  const allHost = h('div', { class: 'stack' })
  const hint = h('div', { class: 'small muted' })
  const viewSeg = segmented([['cards', 'Cards'], ['table', 'Table']], view, (v) => { view = v; save('uc:view', v); renderAll() }, 'Show all units as')
  const filterIn = input({ placeholder: 'Filter units', 'aria-label': 'Filter units', oninput: () => { filter = filterIn.value.trim().toLowerCase(); renderAll() } })

  function saveUnits() { save(`uc:u:${kind}`, [fromId, toId]) }
  function rebuildUnits() { units = unitsFor(kind, ctx()) }
  function setKind(k, keepValue) {
    kind = k
    if (!locked) save('uc:kind', k)
    rebuildUnits()
    const saved = load(`uc:u:${kind}`, null)
    const K = KINDS[kind]
    const ok = (id) => units.some((u) => u.id === id)
    fromId = ok(saved?.[0]) ? saved[0] : ok(K.from) ? K.from : units[0].id
    toId = ok(saved?.[1]) ? saved[1] : ok(K.to) ? K.to : units[1].id
    if (india && !saved) { fromId = 'bigha'; toId = 'sqft' }
    fromSel.setUnits(units, fromId); toSel.setUnits(units, toId)
    if (!keepValue) fromIn.value = '1'
    clear(kindBar, locked ? null : Object.entries(KINDS).map(([id, c]) => h('button', { type: 'button', class: 'ct-chip', 'aria-pressed': String(id === kind), onclick: () => { setKind(id); onFrom() } }, icon(c.icon), c.name)))
    clear(extras,
      kind === 'area' ? field('Bigha and biswa follow this state', stateSel, 'The size differs between states and even districts. Check your land record.') : null,
      kind === 'cooking' ? field('Ingredient', ingSel, 'Grams per cup are approximate and vary with brand and how you scoop.') : null,
      field('Precision', precSel))
    clear(presets, KINDS[kind].presets.map(([label, v, id]) => h('button', { type: 'button', class: 'ct-chip', onclick: () => { fromId = id; if (toId === id) toId = units.find((u) => u.id !== id).id; fromSel.value = fromId; toSel.value = toId; fromIn.value = String(v); saveUnits(); onFrom() } }, label)))
    const cp = KINDS[kind].compound
    clear(compound, cp ? cp.map(([id, label], i) => field(`Or in ${label}`, h('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-label': `${label} part`, dataset: { i }, oninput: () => fromCompound(cp) }))) : null)
    compound.hidden = !cp
    hint.textContent = KINDS[kind].hint
  }
  function fromCompound(cp) {
    const parts = [...compound.querySelectorAll('input')].map((i) => parseNum(i.value) || 0)
    const b = cp.reduce((s, [id], i) => s + toBase(U(id), parts[i]), 0)
    fromId = cp[0][0]; fromSel.value = fromId
    fromIn.value = fmtVal(fromBase(U(fromId), b), prec)
    last = 'from'; base = b // the exact sum, not the rounded text above
    saveUnits(); showTo(); renderAll()
  }
  function showTo() { toIn.value = Number.isFinite(base) ? fmtVal(fromBase(U(toId), base), prec) : '' }
  function showFrom() { fromIn.value = Number.isFinite(base) ? fmtVal(fromBase(U(fromId), base), prec) : '' }
  function onFrom() {
    last = 'from'
    base = toBase(U(fromId), parseNum(fromIn.value))
    for (const i of compound.querySelectorAll('input')) i.value = ''
    showTo(); renderAll()
  }
  function onTo() { last = 'to'; base = toBase(U(toId), parseNum(toIn.value)); showFrom(); renderAll() }

  const sentence = () => {
    const a = U(fromId), b = U(toId), v = parseNum(fromIn.value), w = parseNum(toIn.value)
    return `${fmtVal(v, prec, { group: true })} ${a.sym} = ${fmtVal(w, prec, { group: true })} ${b.sym}`
  }
  const FORMULA = { 'c-f': '°F = °C × 9/5 + 32', 'f-c': '°C = (°F - 32) × 5/9', 'c-k': 'K = °C + 273.15', 'k-c': '°C = K - 273.15', 'f-k': 'K = (°F - 32) × 5/9 + 273.15', 'k-f': '°F = (K - 273.15) × 9/5 + 32' }

  function renderAll() {
    const a = U(fromId), b = U(toId)
    const ok = Number.isFinite(base)
    eq.replaceChildren(ok ? sentence() : 'Type a number to convert.',
      ok && KINDS[kind].formula && FORMULA[`${a.id}-${b.id}`] ? h('small', FORMULA[`${a.id}-${b.id}`]) : ok && !a.to && !b.to ? h('small', `1 ${a.sym} = ${fmtVal(fromBase(b, toBase(a, 1)), prec === 'auto' ? 'auto' : prec, { group: true })} ${b.sym}`) : '')
    const mx = KINDS[kind].mixed
    clear(mixed, ok && mx ? mx.map((ids) => ids.map((id) => U(id))).filter((us) => us.every(Boolean)).map((us) => h('span', mixedText(us, base))) : null)
    mixed.hidden = !ok || !mx
    const list = units.filter((u) => !filter || `${u.name} ${u.sym}`.toLowerCase().includes(filter))
    clear(allHost, h('div', { class: 'row between' }, h('div', { class: 'ct-h' }, icon('layout-grid'), `All ${KINDS[kind].name.toLowerCase()} units`), viewSeg), h('div', { style: 'max-width:320px' }, filterIn),
      view === 'table'
        ? table({ columns: ['Unit', 'Symbol', { label: 'Value', num: true }, ''], rows: list.map((u) => [u.name, u.sym, ok ? fmtVal(fromBase(u, base), prec, { group: true }) : '-', button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${u.name}`, onClick: () => copyText(fmtVal(fromBase(u, base), prec)) })]), max: 200 })
        : h('div', { class: 'ct-uts', role: 'list' }, groupBy(list).flatMap(([g, items], gi) => [groups(list) > 1 ? h('div', { class: 'ct-ut-group' }, g) : null, ...items.map((u, i) => {
          const val = ok ? fmtVal(fromBase(u, base), prec, { group: true }) : '-'
          return h('div', { class: ['ct-ut', u.id === toId && 'on'], role: 'listitem', style: { '--i': Math.min(i + gi * 3, 24) } },
            h('button', { type: 'button', class: 'sel', title: `Use ${u.name} as the target`, onclick: () => { toId = u.id; toSel.value = toId; saveUnits(); showTo(); renderAll() } }, h('span', { class: 'n' }, u.name), h('span', { class: 'v' }, val, ' ', h('span', { class: 's' }, u.sym))),
            h('button', { type: 'button', class: 'cp', 'aria-label': `Copy ${val} ${u.sym}`, title: 'Copy the number', onclick: () => ok && copyText(fmtVal(fromBase(u, base), prec)) }, icon('copy')))
        })]).filter(Boolean)))
    settleOnce(grid)
  }
  const groupBy = (list) => { const m = new Map(); for (const u of list) { if (!m.has(u.group)) m.set(u.group, []); m.get(u.group).push(u) } return [...m] }
  const groups = (list) => new Set(list.map((u) => u.group)).size

  const grid = h('div', { class: 'ct' },
    kindBar,
    h('div', { class: 'ct-uc' },
      h('div', { class: 'ct-ucs' }, h('span', { class: 'tag' }, 'From'), fromIn, fromSel),
      swapBtn,
      h('div', { class: 'ct-ucs to' }, h('span', { class: 'tag' }, 'To'), toIn, toSel)),
    h('section', { class: 'panel stack' }, eq, mixed, compound, presets, extras, hint),
    allHost)
  root.append(grid)
  setKind(kind)
  const seed = q.get('v')
  if (seed && Number.isFinite(parseNum(seed))) fromIn.value = seed
  onFrom()
  if (!india && !locked) kindBar.scrollLeft = 0
}
