// Small UI builders shared by the toolbar, rail and inspector panels.
import { h, icon } from '../../lib/ui.js'
import { toUnit, fromUnit } from './_model.js'

/** Icon button with a CSS tooltip. opts: {pressed, onClick, pos: 'b'|'r'|'l'|'t', label, size, disabled} */
export function ibtn(iconName, tip, opts = {}) {
  const { onClick, pressed, pos = 'b', label, cls, disabled } = opts
  const b = h('button', {
    type: 'button', class: ['ls-btn', cls, label && 'has-label'], 'data-tip': tip, 'data-pos': pos, 'aria-label': tip.replace(/\s*\(.*\)$/, ''),
    'aria-pressed': pressed === undefined ? null : String(!!pressed), disabled,
    onclick: onClick,
    onmousedown: (e) => e.preventDefault(), // keep focus (and the text selection) where it was
  }, iconName && icon(iconName), label && h('span', label))
  b.setPressed = (v) => b.setAttribute('aria-pressed', String(!!v))
  return b
}

/** Collapsible inspector section. */
export function sec(title, children, open = true) {
  const d = h('details', { class: 'ls-sec', open }, h('summary', title), h('div', { class: 'ls-sec-body' }, children))
  return d
}

let nid = 0
/** Labelled control row: <label> + control. */
export function row(label, control, cls = '') {
  const id = `ls-f${++nid}`
  if (control instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) control.id = id
  return h('div', { class: ['ls-row', cls] }, label && h('label', { for: id, class: 'ls-lbl' }, label), control)
}

/**
 * Numeric input bound to the document. get() -> value in storage units, set(v) with storage units.
 * opts: {unit: 'mm'|... (converts from points), min, max, step, int}
 */
export function numInput(label, get, set, opts = {}) {
  const { min, max, step = 'any', suffix } = opts
  const U = () => (typeof opts.unit === 'function' ? opts.unit() : opts.unit)
  const dec = opts.dec ?? 2
  const fmt = (v) => (v == null || Number.isNaN(v) ? '' : String(U() ? toUnit(v, U()) : Math.round(v * 10 ** dec) / 10 ** dec))
  const el = h('input', {
    class: 'input ls-num', type: 'number', step, min: opts.unit ? null : min ?? null, max: opts.unit ? null : max ?? null,
    'aria-label': label, inputmode: 'decimal',
    oninput: (e) => {
      const v = e.target.valueAsNumber
      if (!Number.isFinite(v)) return
      set(U() ? fromUnit(v, U()) : v)
    },
  })
  const sync = () => { if (document.activeElement !== el) el.value = fmt(get()) }
  const wrap = h('label', { class: 'ls-numwrap' }, h('span', { class: 'ls-numlbl' }, label), el, suffix && h('span', { class: 'ls-suffix' }, suffix))
  sync()
  wrap.sync = sync
  wrap.input = el
  return wrap
}

/** Color input with an optional "none" state. get() -> '#rrggbb' | null. */
export function colorInput(label, get, set, { none = true, swatches = [] } = {}) {
  const inp = h('input', { type: 'color', class: 'ls-color', 'aria-label': label, oninput: (e) => set(e.target.value) })
  const off = none ? h('button', { type: 'button', class: 'ls-btn ls-none', 'data-tip': `No ${label.toLowerCase()}`, 'data-pos': 't', 'aria-label': `No ${label.toLowerCase()}`, onclick: () => set(null) }, icon('ban')) : null
  const sw = swatches.length ? h('div', { class: 'ls-swatches' }, swatches.map((c) => h('button', { type: 'button', class: 'ls-sw', style: { background: c }, 'aria-label': `${label} ${c}`, title: c, onclick: () => set(c) }))) : null
  const el = h('div', { class: 'ls-colorrow' }, inp, off, sw)
  el.sync = () => { const v = get(); inp.value = /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000'; inp.classList.toggle('is-none', !v); if (off) off.setAttribute('aria-pressed', String(!v)) }
  el.sync()
  return el
}

export function selectInput(label, options, get, set) {
  const el = h('select', { class: 'select ls-sel', 'aria-label': label, onchange: (e) => set(e.target.value) },
    options.map(([v, l]) => h('option', { value: v }, l)))
  el.sync = () => { const v = String(get() ?? ''); if (document.activeElement !== el) el.value = v; if (el.value !== v && ![...el.options].some((o) => o.value === v)) el.value = el.options[0]?.value }
  el.sync()
  return el
}

export function segButtons(items, get, set, label) {
  const el = h('div', { class: 'ls-seg', role: 'group', 'aria-label': label })
  const btns = items.map(([v, ic, tip, text]) => {
    const b = ibtn(ic, tip, { pressed: false, onClick: () => set(v), pos: 't', label: text })
    b._v = v
    return b
  })
  el.append(...btns)
  el.sync = () => { const cur = get(); for (const b of btns) b.setPressed(b._v === cur) }
  el.sync()
  return el
}

/** Select whose options can change (styles, layers). getOptions() -> [[value, label]]. */
export function dynSelect(label, getOptions, get, set, cls = '') {
  let sig = ''
  const el = h('select', { class: ['select ls-sel', cls], 'aria-label': label, onchange: (e) => set(e.target.value) })
  el.sync = () => {
    const opts = getOptions()
    const s = JSON.stringify(opts)
    if (s !== sig) { sig = s; el.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l))) }
    if (document.activeElement !== el) el.value = String(get() ?? '')
  }
  el.sync()
  return el
}
