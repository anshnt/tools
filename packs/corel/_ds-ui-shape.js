// Draw Studio property bar sections for drawing and arranging: Shape settings (corner radius, ellipse arc and pie, polygon sides, star points and
// sharpness, freehand smoothing), the Shape tool's node buttons, and the arrange buttons for several selected objects.
// Each is added with propBar.add({el, refresh(sel)}); every button runs a command and every value goes through commands, so each change is one undo step.
import { h, icon } from '../../lib/ui.js'
import { commandById } from './_ds-keys.js'
import { leavesOf } from './_ds-ops.js'
import { shapePrefs } from './_ds-tools-draw.js'
import { starSharpness } from './_ds-path.js'
import { fromUnit, toUnit } from './_ds-units.js'
import { meanScale } from './_model.js'
import { editableIds } from './_ds-sel.js'
import { NODE_OPS } from './_ds-cmd-obj.js'

const tip = (label, keys) => (keys?.length ? `${label} (${keys[0]})` : label)
/** Icon button for a command; refresh() keeps its disabled state. */
function cmdBtn(app, id, label) {
  const c = commandById(id)
  const b = h('button', { type: 'button', class: 'ds-btn', 'data-cmd': id, 'aria-label': label || c.label, title: tip(label || c.label, c.keys), onclick: () => app.run(id) }, icon(c.icon))
  b.refresh = () => { b.disabled = !app.enabled(id) }
  return b
}
const sep = () => h('span', { class: 'ds-sep', role: 'separator' })
const numField = (label, aria, attrs = {}) => {
  const input = h('input', { type: 'number', step: 'any', class: 'input ds-num', 'aria-label': aria, ...attrs })
  return { input, el: h('label', { class: 'ds-pf' }, h('span', label), input) }
}
const KIND_OF_TOOL = { rect: 'rect', ellipse: 'ellipse', polygon: 'poly', star: 'star' }

/** Shape settings. env: {store, app (shapeProps(kind, patch))} */
export function createShapeSection({ store, app }) {
  const radius = numField('Radius', 'Corner radius', { min: 0 })
  const mode = h('select', { class: 'select ds-selsm', 'aria-label': 'Ellipse, pie or arc' }, h('option', { value: 'ellipse' }, 'Ellipse'), h('option', { value: 'pie' }, 'Pie'), h('option', { value: 'arc' }, 'Arc'))
  const a1 = numField('Start', 'Start angle in degrees', { min: -360, max: 360 }), a2 = numField('End', 'End angle in degrees', { min: -360, max: 360 })
  const sides = numField('Sides', 'Number of sides', { min: 3, max: 500, step: 1 })
  const pts = numField('Points', 'Number of points', { min: 3, max: 500, step: 1 })
  const sharp = numField('Sharpness', 'Sharpness of the star points, 1 to 99', { min: 1, max: 99, step: 1 })
  const smooth = numField('Smoothing', 'Freehand smoothing in screen pixels', { min: 0, max: 20, step: 1 })
  const groups = { rect: [radius.el], ellipse: [mode, a1.el, a2.el], poly: [sides.el], star: [pts.el, sharp.el], free: [smooth.el] }
  const label = h('span', { class: 'ds-prop-t' }, 'Shape')
  const el = h('div', { class: 'ds-extra ds-shapebar', hidden: true }, label, ...Object.values(groups).flat())
  let kind = null
  const units = () => store.root.units
  const num = (f, lo, hi) => { const v = f.input.valueAsNumber; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null }
  const bad = () => refresh(null, true)
  radius.input.addEventListener('change', () => { const v = num(radius, 0, 1e5); if (v == null) return bad(); app.shapeProps('rect', { rx: fromUnit(v, units()) }); refresh(null, true) })
  const ell = () => { const m = mode.value, s = num(a1, -360, 360) ?? 0, e = num(a2, -360, 360) ?? 270; app.shapeProps('ellipse', { ellipse: m, a1: s, a2: e }); refresh(null, true) }
  mode.addEventListener('change', ell); a1.input.addEventListener('change', ell); a2.input.addEventListener('change', ell)
  sides.input.addEventListener('change', () => { const v = num(sides, 3, 500); if (v == null) return bad(); app.shapeProps('poly', { n: Math.round(v) }); refresh(null, true) })
  pts.input.addEventListener('change', () => { const v = num(pts, 3, 500); if (v == null) return bad(); app.shapeProps('star', { sn: Math.round(v) }); refresh(null, true) })
  sharp.input.addEventListener('change', () => { const v = num(sharp, 1, 99); if (v == null) return bad(); app.shapeProps('star', { sharp: v }); refresh(null, true) })
  smooth.input.addEventListener('change', () => { const v = num(smooth, 0, 20); if (v == null) return bad(); store.setPref('shape', { ...shapePrefs(store), smooth: v }); refresh(null, true) })

  const put = (f, v, force) => { if (force || document.activeElement !== f.input) f.input.value = String(v) }
  function refresh(_sel, force = false) {
    const leaves = leavesOf(editableIds(store).map((id) => store.find(id)?.node).filter(Boolean)).filter((n) => n.t === 'path')
    const shaped = leaves.filter((n) => n.shape && n.sm)
    const selKind = shaped.length && shaped.every((n) => n.shape.k === shaped[0].shape.k) ? shaped[0].shape.k : null
    kind = KIND_OF_TOOL[store.tool] || (store.tool === 'free' ? 'free' : store.tool === 'shape' || store.tool === 'text' ? null : selKind)
    el.hidden = !kind
    if (!kind) return
    for (const [k, list] of Object.entries(groups)) for (const c of list) c.hidden = k !== kind
    const sp = shapePrefs(store)
    const node = shaped.find((n) => n.shape.k === kind)
    const sh = node?.shape
    const u = units()
    label.textContent = { rect: 'Rectangle', ellipse: 'Ellipse', poly: 'Polygon', star: 'Star', free: 'Freehand' }[kind]
    if (kind === 'rect') put(radius, +toUnit((sh ? (sh.rx || 0) * meanScale(node.sm) : sp.rx), u).toFixed(3), force)
    else if (kind === 'ellipse') {
      const m = sh ? (sh.a1 != null ? (sh.pie ? 'pie' : 'arc') : 'ellipse') : sp.ellipse
      mode.value = m
      put(a1, sh && sh.a1 != null ? sh.a1 : sp.a1, force); put(a2, sh && sh.a2 != null ? sh.a2 : sp.a2, force)
    } else if (kind === 'poly') put(sides, sh ? sh.n : sp.n, force)
    else if (kind === 'star') { put(pts, sh ? sh.n : sp.sn, force); put(sharp, sh ? starSharpness(sh) : sp.sharp, force) }
    else if (kind === 'free') put(smooth, sp.smooth, force)
    const can = !shaped.length || editableIds(store).length > 0
    for (const i of el.querySelectorAll('input, select')) i.disabled = !can
    if (kind === 'ellipse' && can) a1.input.disabled = a2.input.disabled = mode.value === 'ellipse'
  }
  store.on('prefs', () => refresh(null, false))
  return { el, refresh: (sel) => refresh(sel, false) }
}

/** The node buttons of the Shape tool. env: {store, app} */
export function createNodeSection({ store, app }) {
  const labels = { add: 'Add node', delete: 'Delete nodes', toLine: 'Make segment straight', toCurve: 'Make segment a curve', cusp: 'Cusp node', smooth: 'Smooth node', symmetrical: 'Symmetrical node', break: 'Break curve', join: 'Join two end nodes', close: 'Close curve', reverse: 'Reverse direction' }
  const btns = NODE_OPS.map((op) => cmdBtn(app, `node.${op}`, labels[op]))
  const info = h('span', { class: 'ds-prop-t ds-nodeinfo', 'aria-live': 'polite' })
  const el = h('div', { class: 'ds-extra ds-nodebar', hidden: true }, info, ...btns.slice(0, 2), sep(), ...btns.slice(2, 4), sep(), ...btns.slice(4, 7), sep(), ...btns.slice(7))
  function refresh() {
    el.hidden = store.tool !== 'shape'
    if (el.hidden) return
    for (const b of btns) b.refresh()
    const st = app.shapeState?.()
    info.textContent = st?.target != null ? `${st.picked.length} of ${st.nodes} nodes picked` : 'No curve selected'
  }
  store.on('shapepick', refresh)
  return { el, refresh }
}

/** Arrange buttons (align, combine, break apart, lock) for the property bar. env: {store, app} */
export function createArrangeSection({ store, app }) {
  const ids = ['align.left', 'align.right', 'align.top', 'align.bottom', 'align.centerH', 'align.centerV', 'align.page']
  const labels = { 'align.left': 'Align left (L)', 'align.right': 'Align right (R)', 'align.top': 'Align top (T)', 'align.bottom': 'Align bottom (B)', 'align.centerH': 'Centre horizontally (E)', 'align.centerV': 'Centre vertically (C)', 'align.page': 'Centre on page (P)' }
  const aligns = ids.map((id) => { const b = cmdBtn(app, id, labels[id]); b.title = labels[id]; return b })
  const more = ['arrange.combine', 'arrange.breakApart', 'arrange.lock'].map((id) => cmdBtn(app, id))
  const lockBtn = more[2]
  const el = h('div', { class: 'ds-extra ds-arrangebar', hidden: true }, ...aligns, sep(), ...more)
  function refresh(sel) {
    el.hidden = !sel || sel.ids.length < 2 || store.tool === 'shape' || store.tool === 'text'
    if (el.hidden) return
    for (const b of [...aligns, ...more]) b.refresh()
    const lbl = app.label?.('arrange.lock') || 'Lock'
    lockBtn.setAttribute('aria-label', lbl); lockBtn.title = `${lbl} (Ctrl+Shift+L)`
  }
  return { el, refresh }
}
