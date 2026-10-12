// Draw Studio property bar context sections: Page (nothing selected) and Text (a text object is selected or the Text tool is active).
// Both are added with propBar.add({el, refresh(sel)}); every change is one store.tx through a command or op (typing in a field merges into one step).
import { h, icon } from '../../lib/ui.js'
import { PAGE_SIZES, pagePreset, presetSize } from './_ds-doc.js'
import { fmt, fromUnit } from './_ds-units.js'
import { leavesOf, setPageSize } from './_ds-ops.js'
import { fontList } from './_ds-text-model.js'
import { editableIds } from './_ds-sel.js'
import { TEXT_DEFAULTS } from './_ds-text-edit.js'

const show = (pt, unit) => fmt(pt, unit)

/** Page section: paper preset, orientation, width and height of the current page, and the Page setup dialog. env: {store, app (pageSetup)} */
export function createPageSection({ store, app }) {
  const preset = h('select', { class: 'select ds-selsm ds-preset', 'aria-label': 'Paper size' }, h('option', { value: 'Custom' }, 'Custom'), Object.keys(PAGE_SIZES).map((n) => h('option', { value: n }, n)))
  const num = (aria) => h('input', { type: 'number', step: 'any', min: 0.1, class: 'input ds-num', 'aria-label': aria })
  const fw = num('Page width'), fh = num('Page height')
  const ob = (landscape, label, ic) => h('button', { type: 'button', class: 'ds-btn', 'aria-label': label, title: label, 'aria-pressed': 'false', onclick: () => setOrientation(landscape) }, icon(ic))
  const portrait = ob(false, 'Portrait', 'rectangle-vertical'), land = ob(true, 'Landscape', 'rectangle-horizontal')
  const setup = h('button', { type: 'button', class: 'ds-btn', 'aria-label': 'Page setup', title: 'Page setup (all pages, units)', onclick: () => app.pageSetup() }, icon('ruler'), h('span', { class: 'ds-btn-t' }, 'Page setup'))
  const label = h('span', { class: 'ds-prop-t' }, 'Page')
  const el = h('div', { class: 'ds-extra ds-pagebar' }, label, preset, h('label', { class: 'ds-pf' }, h('span', 'W'), fw), h('label', { class: 'ds-pf' }, h('span', 'H'), fh), portrait, land, setup)
  const page = () => store.page()
  const apply = (w, hh, merge) => { const p = page(); if (p && !p.pending) store.tx('Page size', (r) => setPageSize(r, [p.id], w, hh), merge ? { merge: 'page-size' } : {}); refresh(null, true) }
  function setOrientation(landscape) { const p = page(); if (!p) return; const [a, b] = [Math.min(p.w, p.h), Math.max(p.w, p.h)]; apply(landscape ? b : a, landscape ? a : b) }
  preset.addEventListener('change', () => {
    const p = page()
    const s = presetSize(preset.value, p && p.w > p.h)
    if (s && p) apply(s[0], s[1]); else refresh(null, true)
  })
  const onSize = () => { const u = store.root.units; const w = fw.valueAsNumber, hh = fh.valueAsNumber; if (w > 0 && hh > 0) apply(fromUnit(w, u), fromUnit(hh, u), true); else refresh(null, true) }
  fw.addEventListener('change', onSize); fh.addEventListener('change', onSize)
  function refresh(sel, force) {
    el.hidden = !!sel || store.tool === 'text'
    const p = page()
    if (el.hidden || !p) return
    const u = store.root.units, pr = pagePreset(p.w, p.h)
    preset.value = pr ? pr.name : 'Custom'
    if (force || document.activeElement !== fw) fw.value = show(p.w, u)
    if (force || document.activeElement !== fh) fh.value = show(p.h, u)
    const l = p.w > p.h
    portrait.setAttribute('aria-pressed', String(!l)); land.setAttribute('aria-pressed', String(l))
    const dis = !!p.pending
    for (const c of [preset, fw, fh, portrait, land]) c.disabled = dis
    label.textContent = `Page (${u})`
  }
  return { el, page: true, refresh: (sel) => refresh(sel, false) }
}

/** Text section. env: {store, app (textProps(patch), fontChosen(family), addFont())} */
export function createTextSection({ store, app }) {
  const fam = h('select', { class: 'select ds-selsm ds-fam', 'aria-label': 'Font', onchange: (e) => app.fontChosen(e.target.value) })
  const size = h('input', { type: 'number', step: 'any', min: 1, max: 10000, class: 'input ds-num', 'aria-label': 'Font size in points', title: 'Font size (pt)' })
  const lh = h('input', { type: 'number', step: 0.05, min: 0.5, max: 10, class: 'input ds-num', 'aria-label': 'Line spacing, as a multiple of the font size', title: 'Line spacing' })
  const toggle = (key, label, ic) => {
    const b = h('button', { type: 'button', class: 'ds-btn', 'aria-label': label, title: label, 'aria-pressed': 'false', onclick: () => app.textProps({ [key]: b.getAttribute('aria-pressed') !== 'true' }) }, icon(ic))
    return b
  }
  const bold = toggle('bold', 'Bold', 'bold'), italic = toggle('italic', 'Italic', 'italic')
  const al = (v, label, ic) => h('button', { type: 'button', class: 'ds-btn', 'aria-label': label, title: label, 'aria-pressed': 'false', 'data-align': v, onclick: () => app.textProps({ align: v }) }, icon(ic))
  const aligns = [al('left', 'Align left', 'align-left'), al('center', 'Align centre', 'align-center'), al('right', 'Align right', 'align-right')]
  const addFont = h('button', { type: 'button', class: 'ds-btn', 'aria-label': 'Add font file', title: 'Add a font file (TTF, OTF, WOFF)', onclick: () => app.addFont() }, icon('file-up'))
  const sep = () => h('span', { class: 'ds-sep', role: 'separator' })
  const el = h('div', { class: 'ds-extra ds-textbar', hidden: true }, fam, h('label', { class: 'ds-pf' }, h('span', 'Size'), size), bold, italic, sep(), ...aligns, sep(), h('label', { class: 'ds-pf' }, h('span', 'Lines'), lh), addFont)
  size.addEventListener('change', () => { const v = size.valueAsNumber; if (v > 0) app.textProps({ size: v }); else refresh(true) })
  lh.addEventListener('change', () => { const v = lh.valueAsNumber; if (v > 0) app.textProps({ lh: v }); else refresh(true) })
  let famKey = ''
  function buildFamilies(current) {
    const list = fontList(store.root.fonts)
    const key = `${list.map((f) => f.family).join('|')}#${current}`
    if (key === famKey) return
    famKey = key
    fam.replaceChildren()
    const groups = new Map()
    if (current && !list.some((f) => f.family === current)) list.unshift({ family: current, group: 'In this drawing' })
    if (!current) fam.append(h('option', { value: '' }, 'Mixed fonts'))
    for (const f of list) { if (!groups.has(f.group)) groups.set(f.group, h('optgroup', { label: f.group })); groups.get(f.group).append(h('option', { value: f.family }, f.family)) }
    fam.append(...groups.values())
  }
  function refresh(force) {
    const leaves = leavesOf(store.sel.ids.map((id) => store.find(id)?.node).filter(Boolean)).filter((n) => n.t === 'text')
    const on = leaves.length > 0 || store.tool === 'text'
    el.hidden = !on
    if (!on) return
    const d = { ...TEXT_DEFAULTS, ...store.prefs.text }
    const first = leaves[0] || d
    const same = (k) => leaves.every((n) => (n[k] ?? null) === (leaves[0][k] ?? null))
    const family = leaves.length ? (same('family') ? first.family : '') : (first.family || 'Inter')
    buildFamilies(family)
    fam.value = family
    if (force || document.activeElement !== size) size.value = leaves.length ? (same('size') ? String(+first.size.toFixed(2)) : '') : String(first.size ?? 24)
    if (force || document.activeElement !== lh) lh.value = String(+(first.lh ?? 1.2).toFixed(2))
    bold.setAttribute('aria-pressed', String(!!first.bold)); italic.setAttribute('aria-pressed', String(!!first.italic))
    for (const a of aligns) a.setAttribute('aria-pressed', String((first.align || 'left') === a.dataset.align))
    const can = !leaves.length || editableIds(store).length > 0
    for (const c of [fam, size, lh, bold, italic, ...aligns]) c.disabled = !can
  }
  return { el, refresh: () => refresh(false) }
}
