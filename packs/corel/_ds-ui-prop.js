// Draw Studio property bar: context-sensitive fields above the canvas. With nothing selected it shows the page size; with a selection it shows
// X, Y, W, H (the geometric box without outline, X and Y are the centre, Y measured up from the page bottom), lock ratio, angle, mirror
// buttons and the outline width. Every field applies ONE store.tx (typing in the same field within 600 ms merges into one undo step).
// Later milestones add context sections through add({el, refresh(sel)}); the units choice always sits at the right end.
import { h, icon } from '../../lib/ui.js'
import { UNITS_LIST, fmt, fromUnit, toUnit } from './_ds-units.js'
import { leavesOf, rotateAbout, scaleAbout, setStyle, transformIds } from './_ds-ops.js'
import { editableIds, selectionBox, selectionStyle, topIds } from './_ds-sel.js'
import { translate } from './_model.js'
import { commandById } from './_ds-keys.js'

const show = (pt, unit) => String(+toUnit(pt, unit).toFixed(3))

export function createPropBar({ store, boxOf, commands }) {
  const text = h('span', { class: 'ds-prop-t', 'aria-live': 'polite' })
  const num = (label, aria, extra = {}) => {
    const input = h('input', { type: 'number', step: 'any', class: 'input ds-num', 'aria-label': aria, ...extra })
    return { input, el: h('label', { class: 'ds-pf' }, h('span', label), input) }
  }
  const fx = num('X', 'X position of the centre'), fy = num('Y', 'Y position of the centre'), fw = num('W', 'Width'), fh = num('H', 'Height'), fa = num('Angle', 'Angle in degrees', { min: -360, max: 360 })
  const fo = num('Outline', 'Outline width', { min: 0 })
  const lock = h('button', { type: 'button', class: 'ds-btn', 'aria-pressed': 'false', 'aria-label': 'Keep the width and height in proportion', title: 'Keep proportions when changing W or H', onclick: () => { store.prefs.lockRatio = !store.prefs.lockRatio; refresh(true) } }, icon('unlink'))
  const cmd = (id, label) => { const c = commandById(id); const b = h('button', { type: 'button', class: 'ds-btn', 'aria-label': label, title: label, onclick: () => commands.run(id) }, icon(c.icon)); b.refresh = () => { b.disabled = !commands.enabled(id) }; return b }
  const mh = cmd('object.mirrorH', 'Mirror horizontally'), mv = cmd('object.mirrorV', 'Mirror vertically')
  const sepOutline = h('span', { class: 'ds-sep', role: 'separator' })
  const fields = h('div', { class: 'ds-selfields' }, fx.el, fy.el, fw.el, lock, fh.el, h('span', { class: 'ds-sep', role: 'separator' }), fa.el, mh, mv, sepOutline, fo.el)
  const extra = h('div', { class: 'ds-extra' })
  const units = h('select', { class: 'select ds-units', 'aria-label': 'Units', onchange: (e) => { const u = e.target.value; store.tx('Change units', (r) => (r.units === u ? r : { ...r, units: u })) } },
    UNITS_LIST.map((u) => h('option', { value: u }, u)))
  const el = h('div', { class: 'ds-prop', role: 'toolbar', 'aria-label': 'Properties' }, text, fields, extra, h('span', { class: 'ds-grow' }), h('label', { class: 'ds-unitlbl' }, h('span', 'Units'), units))
  const sections = []
  let cur = null // {ids, box, angle}

  function apply(kind, v) {
    const ids = topIds(store, editableIds(store))
    const b = ids.length && selectionBox(store, boxOf, ids)
    const u = store.root.units
    if (!b || !Number.isFinite(v)) { refresh(true); return }
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    let M = null
    if (kind === 'x') M = translate(fromUnit(v, u) - cx, 0)
    else if (kind === 'y') M = translate(0, store.page().h - fromUnit(v, u) - cy)
    else if (kind === 'w' || kind === 'h') {
      const size = kind === 'w' ? b.w : b.h
      const want = fromUnit(v, u)
      if (!(want > 0) || size < 1e-9) { store.setStatus(size < 1e-9 ? 'This object has no width or height to change.' : 'Size must be above zero.'); refresh(true); return }
      const s = want / size
      M = kind === 'w' ? scaleAbout(s, store.prefs.lockRatio ? s : 1, cx, cy) : scaleAbout(store.prefs.lockRatio ? s : 1, s, cx, cy)
    } else if (kind === 'angle') M = rotateAbout((-(v - (cur?.angle || 0)) * Math.PI) / 180, cx, cy)
    if (M) store.tx(`Change ${kind === 'angle' ? 'angle' : kind === 'w' || kind === 'h' ? 'size' : 'position'}`, (r) => transformIds(r, ids, M, { scaleStroke: !!store.prefs.scaleStroke }), { merge: `prop-${kind}` })
    refresh(true)
  }
  const bind = (f, kind) => { f.input.addEventListener('change', () => apply(kind, f.input.valueAsNumber)) }
  bind(fx, 'x'); bind(fy, 'y'); bind(fw, 'w'); bind(fh, 'h'); bind(fa, 'angle')
  fo.input.addEventListener('change', () => {
    const ids = editableIds(store), w = fo.input.valueAsNumber
    if (!ids.length || !Number.isFinite(w) || w < 0) { refresh(true); return }
    const pt = fromUnit(w, store.root.units)
    store.tx('Outline width', (r) => setStyle(r, ids, pt > 0 ? { strokeWidth: pt } : { strokeWidth: 0, stroke: null }), { merge: 'prop-outline' })
    refresh(true)
  })

  const put = (f, v, force) => { if (force || document.activeElement !== f.input) f.input.value = v }
  function refresh(force = false) {
    const u = store.root.units
    units.value = u
    const page = store.page()
    const ids = store.sel.ids.filter((id) => store.find(id)?.node)
    const nodes = ids.map((id) => store.find(id).node)
    fields.hidden = !nodes.length || store.tool === 'shape' // the Shape tool shows its node buttons instead
    if (!nodes.length) { cur = null; text.hidden = sections.some((s) => s.page); text.textContent = page ? `Page size ${fmt(page.w, u)} x ${fmt(page.h, u)} ${u}` : '' } // the Page section (E6) replaces this text
    else {
      text.hidden = true
      const b = selectionBox(store, boxOf, ids)
      const can = editableIds(store).length > 0
      cur = { ids, box: b, angle: nodes.length === 1 ? nodes[0].rot || 0 : 0 }
      if (b) {
        put(fx, show(b.x + b.w / 2, u), force); put(fy, show(page.h - (b.y + b.h / 2), u), force)
        put(fw, show(b.w, u), force); put(fh, show(b.h, u), force)
      }
      put(fa, String(+cur.angle.toFixed(3)), force)
      const w = selectionStyle(store)?.width
      const paths = leavesOf(nodes).some((l) => l.t === 'path') // text and pictures have no outline, so the field would only crowd the text controls
      fo.el.hidden = sepOutline.hidden = !paths
      put(fo, w == null ? '' : show(w, u), force)
      fo.input.placeholder = w == null ? '-' : ''
      for (const f of [fx, fy, fw, fh, fa, fo]) f.input.disabled = !can
      lock.disabled = !can
      lock.setAttribute('aria-pressed', String(!!store.prefs.lockRatio))
      lock.replaceChildren(icon(store.prefs.lockRatio ? 'link' : 'unlink'))
      mh.refresh(); mv.refresh()
    }
    for (const s of sections) s.refresh?.(cur)
  }
  return {
    el, refresh,
    /** Add a context section: {el, refresh(sel)}. Called with {ids, box, angle} or null when nothing is selected. */
    add(section) { sections.push(section); extra.append(section.el); refresh(true) },
  }
}
