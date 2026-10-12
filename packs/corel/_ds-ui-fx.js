// Draw Studio property bar sections for effects (Interactive fill, Transparency, Eyedropper, Bitmap) and the Properties docker section
// (object details, fill, outline, transparency). Every control runs a command or app.fx call, so each change is one undo step.
import { h, icon } from '../../lib/ui.js'
import { describeNode } from './_ds-doc.js'
import { fillKind, flatOf, opacityOf } from './_ds-fill.js'
import { leavesOf } from './_ds-ops.js'
import { editableIds } from './_ds-sel.js'
import { fmt, fromUnit, toUnit } from './_ds-units.js'
import { safeHex } from './_ds-ui-palette.js'

const KINDS = [['none', 'None'], ['uniform', 'Uniform'], ['linear', 'Linear'], ['radial', 'Radial']]
const nodesOfSel = (store) => store.sel.ids.map((id) => store.find(id)?.node).filter(Boolean)
const pathLeaves = (store) => leavesOf(editableIds(store).map((id) => store.find(id)?.node).filter(Boolean)).filter((l) => l.t === 'path')
const sep = () => h('span', { class: 'ds-sep', role: 'separator' })
const colorValue = (v) => safeHex(v) || '#000000'

/** The four fill type buttons. get() -> the current kind; pick(kind) applies one. */
function kindChips(pick, aria = 'Fill type') {
  const btns = KINDS.map(([k, label]) => h('button', { type: 'button', class: 'ds-btn ds-kindbtn', 'data-kind': k, 'aria-pressed': 'false', 'aria-label': `Fill: ${label.toLowerCase()}`, title: `${label} fill`, onclick: () => pick(k) }, h('span', { class: 'ds-btn-t' }, label)))
  const el = h('div', { class: 'ds-kinds', role: 'group', 'aria-label': aria }, ...btns)
  return { el, set(kind, enabled = true) { for (const b of btns) { b.setAttribute('aria-pressed', String(b.dataset.kind === kind)); b.disabled = !enabled } } }
}

/** Interactive fill bar. env: {store, app (fx, fillTool(), paint)} */
export function createFillSection({ store, app }) {
  const chips = kindChips((k) => app.fx.fillType(k))
  const color = h('input', { type: 'color', class: 'ds-colorin', 'aria-label': 'Colour of the fill or of the selected colour stop', value: '#000000' })
  const pos = h('input', { type: 'number', min: 0, max: 100, step: 1, class: 'input ds-num', 'aria-label': 'Position of the selected colour stop in percent' })
  const btn = (label, ic, onclick, aria) => h('button', { type: 'button', class: 'ds-btn', 'aria-label': aria || label, title: aria || label, onclick }, icon(ic), h('span', { class: 'ds-btn-t' }, label))
  const add = btn('Add colour', 'plus', () => app.fillTool().addStopMiddle(), 'Add a colour stop'), del = btn('Remove', 'minus', () => app.fillTool().removeStop(), 'Remove the selected colour stop'), rev = btn('Reverse', 'arrow-left-right', () => app.fillTool().reverse(), 'Reverse the colours')
  const stopBox = h('span', { class: 'ds-extra', hidden: true }, sep(), h('label', { class: 'ds-pf' }, h('span', 'Stop %'), pos), add, del, rev)
  const el = h('div', { class: 'ds-extra ds-fillbar', hidden: true }, h('span', { class: 'ds-prop-t' }, 'Fill'), chips.el, color, stopBox)
  color.addEventListener('change', () => {
    if (!safeHex(color.value)) return
    const f = app.fillTool()
    if (f.state.stop != null) f.setStopColor(color.value); else app.paint('fill', color.value)
  })
  pos.addEventListener('change', () => { const v = pos.valueAsNumber; if (Number.isFinite(v)) app.fillTool().setStopOffset(v / 100); else refresh() })
  function refresh() {
    el.hidden = store.tool !== 'fill'
    if (el.hidden) return
    const leaves = pathLeaves(store), n = leaves[leaves.length - 1]
    const kind = n ? fillKind(n) : null
    chips.set(kind, !!n)
    const f = app.fillTool(), st = f.state
    const grad = kind === 'linear' || kind === 'radial'
    stopBox.hidden = !grad
    color.disabled = !n || kind === 'none' || (grad && st.stop == null)
    color.title = grad ? (st.stop == null ? 'Click a colour stop on the canvas first' : 'Colour of the selected colour stop') : 'Fill colour'
    if (n && kind !== 'none') color.value = grad ? colorValue(st.stop != null ? st.g.stops[st.stop].c : flatOf(n.fill)) : colorValue(n.fill)
    if (grad) {
      pos.disabled = st.stop == null
      if (document.activeElement !== pos) pos.value = st.stop == null ? '' : String(Math.round(st.g.stops[st.stop].o * 100))
      del.disabled = st.stop == null || st.count <= 2
    }
  }
  return { el, refresh }
}

/** Transparency bar: one slider that sets fill, outline, picture and text opacity together. env: {store, app (fx)} */
export function createTranspSection({ store, app }) {
  const range = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Transparency in percent, 0 is solid', class: 'ds-range' })
  const out = h('output', { class: 'ds-rangeout' }, '0%')
  const clear = h('button', { type: 'button', class: 'ds-btn', 'aria-label': 'Clear transparency', title: 'Clear transparency', onclick: () => app.run('effects.clearTransp') }, icon('circle-slash'), h('span', { class: 'ds-btn-t' }, 'Clear'))
  const hint = h('span', { class: 'ds-prop-t' }, 'Select an object to set its transparency.')
  const el = h('div', { class: 'ds-extra ds-transpbar', hidden: true }, h('span', { class: 'ds-prop-t' }, 'Transparency'), range, out, clear, hint)
  range.addEventListener('input', () => { out.textContent = `${range.value}%`; app.fx.opacity(1 - range.valueAsNumber / 100) })
  function refresh() {
    el.hidden = store.tool !== 'transp'
    if (el.hidden) return
    const nodes = nodesOfSel(store), can = editableIds(store).length > 0
    hint.hidden = nodes.length > 0
    range.disabled = clear.disabled = !can
    const o = opacityOf(nodes)
    if (document.activeElement !== range) { range.value = String(o == null ? 0 : Math.round((1 - o) * 100)); out.textContent = o == null && nodes.length ? 'mixed' : `${range.value}%` }
  }
  return { el, refresh }
}

/** Eyedropper bar: says what the next click does. env: {store, app (eyedrop tool)} */
export function createEyedropSection({ store, app }) {
  const text = h('span', { class: 'ds-prop-t', 'aria-live': 'polite' })
  const el = h('div', { class: 'ds-extra ds-eyebar', hidden: true }, text)
  function refresh() {
    el.hidden = store.tool !== 'eyedrop'
    if (el.hidden) return
    text.textContent = app.eyedropTool().held ? 'Copied. Click another object to apply the fill and outline.' : store.sel.ids.length ? 'Click an object to copy its fill and outline onto the selection.' : 'Click an object to copy its fill and outline, then click another to apply them.'
  }
  return { el, refresh }
}

/** Bitmap bar: Trace bitmap and Save original, shown while a picture is selected. env: {store, app (fx, run)} */
export function createBitmapSection({ store, app }) {
  const mk = (id, ic, label) => { const b = h('button', { type: 'button', class: 'ds-btn', 'data-cmd': id, 'aria-label': label, title: label, onclick: () => app.run(id) }, icon(ic), h('span', { class: 'ds-btn-t' }, label)); return b }
  const el = h('div', { class: 'ds-extra ds-bitmapbar', hidden: true }, h('span', { class: 'ds-prop-t' }, 'Bitmap'), mk('bitmap.traceLogo', 'wand-sparkles', 'Trace bitmap'), mk('bitmap.saveOriginal', 'download', 'Save original'))
  return { el, refresh() { el.hidden = !app.fx.imageTarget() || store.tool === 'fill' || store.tool === 'transp' || store.tool === 'shape' } }
}

/** The Properties docker section: what the selection is, its fill, outline and transparency. env: {store, app (fx, run, paint, fillTool), boxOf} -> {el, refresh} */
export function createPropertiesSection({ store, app, boxOf }) {
  const summary = h('p', { class: 'ds-pr-sum' })
  const chips = kindChips((k) => app.fx.fillType(k))
  const fillColor = h('input', { type: 'color', class: 'ds-colorin', 'aria-label': 'Properties: fill colour', value: '#000000' })
  const editFill = h('button', { type: 'button', class: 'ds-xbtn', onclick: () => app.run('tool.fill') }, icon('paint-bucket'), h('span', 'Edit with Interactive fill'))
  const width = h('input', { type: 'number', step: 'any', min: 0, class: 'input ds-num', 'aria-label': 'Properties: outline width' })
  const strokeColor = h('input', { type: 'color', class: 'ds-colorin', 'aria-label': 'Properties: outline colour', value: '#000000' })
  const pen = h('button', { type: 'button', class: 'ds-xbtn', onclick: () => app.run('effects.outlinePen') }, icon('pen-line'), h('span', 'Outline pen...'))
  const range = h('input', { type: 'range', min: 0, max: 100, step: 1, value: 0, 'aria-label': 'Properties: transparency in percent', class: 'ds-range' })
  const out = h('output', { class: 'ds-rangeout' }, '0%')
  const row = (label, ...kids) => h('div', { class: 'ds-xrow' }, h('span', { class: 'ds-xname' }, label), ...kids)
  const el = h('div', { class: 'ds-xpanel ds-props' }, summary,
    h('div', { class: 'ds-xhead' }, 'Fill'), row('Type', chips.el), row('Colour', fillColor), editFill,
    h('div', { class: 'ds-xhead' }, 'Outline'), row('Width', width, strokeColor), pen,
    h('div', { class: 'ds-xhead' }, 'Transparency'), row('Amount', range, out))
  fillColor.addEventListener('change', () => { if (safeHex(fillColor.value)) app.paint('fill', fillColor.value) })
  strokeColor.addEventListener('change', () => { if (safeHex(strokeColor.value)) app.paint('stroke', strokeColor.value) })
  width.addEventListener('change', () => { const v = width.valueAsNumber, pt = fromUnit(v, store.root.units); if (Number.isFinite(v) && v >= 0) app.fx.outline(pt > 0 ? { strokeWidth: pt } : { strokeWidth: 0, stroke: null }, 'Outline width', 'prop-outline'); else refresh() })
  range.addEventListener('input', () => { out.textContent = `${range.value}%`; app.fx.opacity(1 - range.valueAsNumber / 100) })
  function refresh() {
    const nodes = nodesOfSel(store)
    const can = editableIds(store).length > 0
    const paths = pathLeaves(store)
    const u = store.root.units
    if (!nodes.length) summary.textContent = 'Nothing selected. Select an object to see and change its look.'
    else if (nodes.length > 1) summary.textContent = `${nodes.length} objects selected`
    else {
      const n = nodes[0], b = boxOf(n)
      const nc = n.t === 'path' ? n.d.filter((c) => c[0] !== 'Z').length : 0
      summary.textContent = `${describeNode(n)}${b ? `, ${fmt(b.w, u)} x ${fmt(b.h, u)} ${u}` : ''}${nc ? `, ${nc} node${nc === 1 ? '' : 's'}` : ''}`
    }
    const last = paths[paths.length - 1]
    chips.set(last ? fillKind(last) : null, can && !!last)
    fillColor.disabled = !can || !last || fillKind(last) === 'none'
    if (last && fillKind(last) !== 'none') fillColor.value = colorValue(flatOf(last.fill))
    editFill.disabled = !can || !last
    const w = paths.find((p) => p.stroke && p.strokeWidth > 0)
    width.disabled = strokeColor.disabled = pen.disabled = !can || !paths.length
    if (document.activeElement !== width) width.value = w ? String(+toUnit(w.strokeWidth, u).toFixed(3)) : '0'
    if (w) strokeColor.value = colorValue(w.stroke)
    const o = opacityOf(nodes)
    range.disabled = !can
    if (document.activeElement !== range) { range.value = String(o == null ? 0 : Math.round((1 - o) * 100)); out.textContent = o == null && nodes.length ? 'mixed' : `${range.value}%` }
  }
  store.on('sel', refresh); store.on('doc', refresh)
  refresh()
  return { el, refresh }
}
