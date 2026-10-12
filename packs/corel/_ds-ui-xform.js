// Draw Studio dockers for arranging: "Align and distribute" (with the Shaping buttons) and "Transform" (position, rotate, scale, size, skew,
// with a nine-point reference, Apply and Apply to duplicate). Both are sections of the dock (docks.addSection). Every button runs a command or
// one store.tx, so each is one undo step.
import { h, icon } from '../../lib/ui.js'
import { commandById } from './_ds-keys.js'
import { duplicate, transformIds } from './_ds-ops.js'
import { editableIds, selectionBox, topIds } from './_ds-sel.js'
import { REFS, refPoint, transformMatrix } from './_ds-xform.js'
import { fromUnit, toUnit } from './_ds-units.js'

/** A docker button for a command: a short caption (the full command name is the tooltip and the accessible name). */
const textBtn = (app, id, short) => {
  const c = commandById(id)
  const b = h('button', { type: 'button', class: 'ds-xbtn', 'data-cmd': id, title: c.label, 'aria-label': c.label, onclick: () => app.run(id) }, icon(c.icon), h('span', short || c.label))
  b.refresh = () => { b.disabled = !app.enabled(id) }
  return b
}
const radio = (name, options, value, onChange) => {
  const el = h('div', { class: 'ds-xradio', role: 'group', 'aria-label': name })
  const btns = options.map(([v, l]) => h('button', { type: 'button', class: 'ds-xchip', 'aria-pressed': String(v === value), onclick: () => { set(v); onChange(v) } }, l))
  const set = (v) => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v)))
  el.append(...btns)
  el.set = set
  return el
}
const SHAPING = [['weld', 'Weld'], ['trim', 'Trim'], ['intersect', 'Intersect']]
const LEAVE_DEFAULTS = { weld: [false, false], trim: [true, false], intersect: [false, false] }

/** Align and distribute. env: {store, app} -> {el, refresh} */
export function createAlignSection({ store, app }) {
  const alignTo = radio('Align to', [['selection', 'Selection'], ['page', 'Page'], ['active', 'Active object']], store.prefs.alignTo || 'selection', (v) => store.setPref('alignTo', v))
  const distTo = radio('Distribute to', [['selection', 'Selection'], ['page', 'Page']], store.prefs.distTo || 'selection', (v) => store.setPref('distTo', v))
  const aligns = [['align.left', 'Left'], ['align.right', 'Right'], ['align.top', 'Top'], ['align.bottom', 'Bottom'], ['align.centerH', 'Centre H'], ['align.centerV', 'Centre V'], ['align.page', 'Centre on page']].map(([id, c]) => textBtn(app, id, c))
  const dists = [['distribute.left', 'Left edges'], ['distribute.centerH', 'Centres H'], ['distribute.right', 'Right edges'], ['distribute.spaceH', 'Spacing H'], ['distribute.top', 'Top edges'], ['distribute.centerV', 'Centres V'], ['distribute.bottom', 'Bottom edges'], ['distribute.spaceV', 'Spacing V']].map(([id, c]) => textBtn(app, id, c))
  const shapes = [['shape.weld', 'Weld'], ['shape.trim', 'Trim'], ['shape.intersect', 'Intersect'], ['shape.simplify', 'Simplify'], ['shape.frontMinusBack', 'Front - back'], ['shape.backMinusFront', 'Back - front']].map(([id, c]) => textBtn(app, id, c))
  const leave = SHAPING.map(([op, name]) => {
    const cur = () => store.prefs.shapeLeave?.[op] ?? LEAVE_DEFAULTS[op]
    const box = (i, label) => {
      const input = h('input', { type: 'checkbox', 'aria-label': `${name}: ${label}`, checked: cur()[i], onchange: () => { const c = [...cur()]; c[i] = input.checked; store.setPref('shapeLeave', { ...store.prefs.shapeLeave, [op]: c }) } })
      return h('label', { class: 'ds-xcheck' }, input, h('span', label))
    }
    return h('div', { class: 'ds-xrow' }, h('span', { class: 'ds-xname' }, name), box(0, 'Leave source'), box(1, 'Leave target'))
  })
  const el = h('div', { class: 'ds-xpanel' },
    h('div', { class: 'ds-xhead' }, 'Align to'), alignTo, h('div', { class: 'ds-xgrid' }, ...aligns),
    h('div', { class: 'ds-xhead' }, 'Distribute to'), distTo, h('div', { class: 'ds-xgrid' }, ...dists),
    h('div', { class: 'ds-xhead' }, 'Shaping'), h('div', { class: 'ds-xgrid' }, ...shapes), h('div', { class: 'ds-xleave' }, ...leave),
    h('p', { class: 'ds-xnote' }, 'The target is the object you selected last, or the bottom one after a rubber-band selection.'))
  function refresh() {
    alignTo.set(store.prefs.alignTo || 'selection'); distTo.set(store.prefs.distTo || 'selection')
    for (const b of [...aligns, ...dists, ...shapes]) b.refresh()
  }
  store.on('sel', refresh); store.on('prefs', refresh); store.on('doc', refresh)
  return { el, refresh }
}

/** Transform docker. env: {store, app, boxOf} -> {el, refresh, setTab(tab)} */
export function createTransformSection({ store, app, boxOf }) {
  let tab = 'position', ref = 'c', changed = 'w'
  const f = (aria, attrs = {}) => h('input', { type: 'number', step: 'any', class: 'input ds-num', 'aria-label': aria, ...attrs })
  const field = (label, input) => h('label', { class: 'ds-pf' }, h('span', label), input)
  const fx = f('Transform X position'), fy = f('Transform Y position'), rel = h('input', { type: 'checkbox', 'aria-label': 'Transform relative position' })
  const fa = f('Transform rotation angle in degrees, counter-clockwise')
  const sx = f('Transform horizontal scale in percent'), sy = f('Transform vertical scale in percent'), sprop = h('input', { type: 'checkbox', 'aria-label': 'Transform keep proportions when scaling' })
  const fw = f('Transform width'), fh = f('Transform height'), zprop = h('input', { type: 'checkbox', 'aria-label': 'Transform keep proportions when sizing' })
  const kx = f('Transform horizontal skew in degrees'), ky = f('Transform vertical skew in degrees')
  const check = (input, text) => h('label', { class: 'ds-xcheck' }, input, h('span', text))
  const panels = {
    position: h('div', { class: 'ds-xfields' }, field('X', fx), field('Y', fy), check(rel, 'Relative position')),
    rotate: h('div', { class: 'ds-xfields' }, field('Angle', fa)),
    scale: h('div', { class: 'ds-xfields' }, field('Horizontal %', sx), field('Vertical %', sy), check(sprop, 'Proportional')),
    size: h('div', { class: 'ds-xfields' }, field('W', fw), field('H', fh), check(zprop, 'Proportional')),
    skew: h('div', { class: 'ds-xfields' }, field('Horizontal', kx), field('Vertical', ky)),
  }
  const tabBtns = Object.keys(panels).map((t) => h('button', { type: 'button', role: 'tab', class: 'ds-xchip', 'data-tab': t, 'aria-selected': String(t === tab), onclick: () => setTab(t) }, t[0].toUpperCase() + t.slice(1)))
  const refBtns = REFS.map((r) => h('button', { type: 'button', class: 'ds-xref', 'data-ref': r, role: 'radio', 'aria-checked': String(r === ref), 'aria-label': `Reference point ${r === 'c' ? 'centre' : r}`, onclick: () => { ref = r; for (const b of refBtns) b.setAttribute('aria-checked', String(b.dataset.ref === ref)); fill(true) } }))
  const apply = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => run(false) }, 'Apply')
  const applyDup = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => run(true) }, 'Apply to duplicate')
  const el = h('div', { class: 'ds-xpanel' }, h('div', { class: 'ds-xtabs', role: 'tablist', 'aria-label': 'Transform' }, ...tabBtns),
    h('div', { class: 'ds-xmain' }, h('div', { class: 'ds-xrefs', role: 'radiogroup', 'aria-label': 'Reference point' }, ...refBtns), h('div', { class: 'ds-xpanels' }, ...Object.values(panels))),
    h('div', { class: 'ds-xapply' }, apply, applyDup))

  function setTab(t) {
    tab = t
    for (const b of tabBtns) b.setAttribute('aria-selected', String(b.dataset.tab === t))
    for (const [k, p] of Object.entries(panels)) p.hidden = k !== t
    fill(true)
  }
  const units = () => store.root.units
  const ids = () => topIds(store, editableIds(store))
  const boxNow = () => { const i = ids(); return i.length ? selectionBox(store, boxOf, i) : null }
  const show = (input, v, force) => { if (force || document.activeElement !== input) input.value = String(+v.toFixed(3)) }
  /** Put the current numbers of the selection into the fields (not into a field being typed in). */
  function fill(force = false) {
    const b = boxNow()
    const dis = !b
    el.querySelectorAll('input, button.btn').forEach((i) => { i.disabled = dis })
    if (!b) return
    const u = units(), p = refPoint(b, ref), page = store.page()
    if (rel.checked) { show(fx, 0, force); show(fy, 0, force) } else { show(fx, toUnit(p.x, u), force); show(fy, toUnit(page.h - p.y, u), force) }
    show(fa, 0, force); show(sx, 100, force); show(sy, 100, force)
    show(fw, toUnit(b.w, u), force); show(fh, toUnit(b.h, u), force)
    show(kx, 0, force); show(ky, 0, force)
  }
  rel.addEventListener('change', () => fill(true))
  fw.addEventListener('input', () => { changed = 'w' }); fh.addEventListener('input', () => { changed = 'h' })
  sx.addEventListener('input', () => { if (sprop.checked) sy.value = sx.value }); sy.addEventListener('input', () => { if (sprop.checked) sx.value = sy.value })
  const val = (i) => i.valueAsNumber
  function run(dup) {
    app.commitEdits?.()
    const i = ids(), b = boxNow()
    if (!i.length || !b) { store.setStatus('Select an object first.'); return }
    const u = units(), page = store.page()
    let v
    if (tab === 'position') v = rel.checked ? { relative: true, dx: fromUnit(val(fx), u), dy: -fromUnit(val(fy), u) } : { x: fromUnit(val(fx), u), y: page.h - fromUnit(val(fy), u) }
    else if (tab === 'rotate') v = { angle: val(fa) }
    else if (tab === 'scale') v = { sx: val(sx) / 100, sy: (sprop.checked ? val(sx) : val(sy)) / 100 }
    else if (tab === 'size') v = { w: fromUnit(val(fw), u), h: fromUnit(val(fh), u), prop: zprop.checked, changed }
    else v = { kx: val(kx), ky: val(ky) }
    const M = transformMatrix(tab, v, b, ref)
    if (!M) { store.setStatus('Nothing to change. Check the numbers.'); return }
    const o = { scaleStroke: !!store.prefs.scaleStroke }
    if (dup) {
      const out = { ids: [] }
      store.tx('Apply to duplicate', (r) => { const r2 = duplicate(r, i, store.newId, { out }); return transformIds(r2, out.ids, M, o) }, { get sel() { return out.ids } })
    } else store.tx(`Transform ${tab}`, (r) => transformIds(r, i, M, o))
    fill(true)
  }
  store.on('sel', () => fill(true)); store.on('doc', () => fill(false))
  setTab('position')
  return { el, refresh: () => fill(false), setTab, get tab() { return tab } }
}
