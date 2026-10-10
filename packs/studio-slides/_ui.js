// Small widgets for the editor chrome: tooltip buttons, popovers, menus, colour picker, compact fields.
import { h, icon } from '../../lib/ui.js'
import { cssToHex } from './_model.js'

/** Toolbar button. Keeps the text selection in the editor (no focus steal). opts: { tip, key, active, text, cls, disabled } */
export function tbtn(label, ic, onClick, opts = {}) {
  const b = h('button', {
    type: 'button', class: ['ss-btn', opts.text && 'has-text', opts.cls], 'aria-label': label,
    'aria-pressed': opts.active === undefined ? null : String(!!opts.active), disabled: opts.disabled,
    onmousedown: (e) => { if (!opts.focus) e.preventDefault() },
    onclick: (e) => onClick?.(e, b),
  }, ic && icon(ic), opts.text && h('span', opts.text))
  b.dataset.tip = opts.key ? `${label}  ${opts.key}` : label
  return b
}
export const setActive = (btn, on) => btn.setAttribute('aria-pressed', String(!!on))
export const sep = () => h('span', { class: 'ss-sep', role: 'separator' })

/** One global tooltip for every [data-tip] inside root. */
export function mountTips(root) {
  const tip = h('div', { class: 'ss-tip', role: 'tooltip', hidden: true })
  root.append(tip)
  let t
  const hide = () => { clearTimeout(t); tip.hidden = true }
  root.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-tip]')
    clearTimeout(t)
    if (!el || el.disabled) return hide()
    t = setTimeout(() => {
      tip.textContent = el.dataset.tip
      tip.hidden = false
      const r = el.getBoundingClientRect(), rr = root.getBoundingClientRect(), tr = tip.getBoundingClientRect()
      let x = r.left - rr.left + r.width / 2 - tr.width / 2
      x = Math.max(6, Math.min(rr.width - tr.width - 6, x))
      let y = r.bottom - rr.top + 8
      if (y + tr.height > rr.height - 6) y = r.top - rr.top - tr.height - 8
      tip.style.left = `${x}px`
      tip.style.top = `${y}px`
    }, 350)
  })
  root.addEventListener('mouseout', (e) => { if (!e.relatedTarget || !e.relatedTarget.closest?.('[data-tip]')) hide() })
  root.addEventListener('pointerdown', hide, true)
  return hide
}

// ---------- Popovers ----------
let current = null
export function closePopover() { current?.close() }

/** Show content in a floating panel anchored to a button, inside `root` (so it also works in full screen). */
export function popover(root, anchor, content, o = {}) {
  closePopover()
  const pop = h('div', { class: ['ss-pop', o.cls], role: 'dialog', 'aria-label': o.label || 'Options' }, content)
  root.append(pop)
  const place = () => {
    const r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect(), pr = pop.getBoundingClientRect()
    let x = (o.align === 'right' ? r.right - pr.width : r.left) - rr.left
    x = Math.max(6, Math.min(rr.width - pr.width - 6, x))
    let y = r.bottom - rr.top + 6
    if (y + pr.height > rr.height - 6) y = Math.max(6, r.top - rr.top - pr.height - 6)
    pop.style.left = `${x}px`
    pop.style.top = `${y}px`
  }
  place()
  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close() }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  const close = () => {
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
    pop.remove()
    if (!root.contains(document.activeElement) || document.activeElement === document.body) root.focus({ preventScroll: true })
    if (current?.pop === pop) current = null
    o.onClose?.()
  }
  setTimeout(() => document.addEventListener('pointerdown', onDown, true))
  document.addEventListener('keydown', onKey, true)
  current = { close, pop }
  anchor.setAttribute('aria-expanded', 'true')
  const prevClose = o.onClose
  o.onClose = () => { anchor.removeAttribute('aria-expanded'); prevClose?.() }
  return { close, el: pop, place }
}

/** items: [{ label, icon, run, key, disabled, danger } | '-' | { head: 'Section' }] */
export function menu(root, anchor, items, o = {}) {
  const list = h('div', { class: 'ss-menu', role: 'menu' }, items.map((it) => {
    if (it === '-') return h('hr')
    if (it.head) return h('div', { class: 'ss-menu-head' }, it.head)
    return h('button', {
      type: 'button', role: 'menuitem', class: ['ss-menu-item', it.danger && 'danger'], disabled: it.disabled,
      onclick: () => { p.close(); it.run?.() },
    }, it.icon ? icon(it.icon) : h('span', { class: 'ss-menu-gap' }), h('span', { class: 'ss-menu-label' }, it.label), it.key && h('kbd', it.key))
  }))
  const p = popover(root, anchor, list, { label: 'Menu', ...o })
  list.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
  return p
}

// ---------- Colour picker ----------
const STANDARD = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#efefef', '#ffffff',
  '#b91c1c', '#ea580c', '#ca8a04', '#15803d', '#0e7490', '#1d4ed8', '#7e22ce', '#be185d',
  '#fca5a5', '#fdba74', '#fde047', '#86efac', '#67e8f9', '#93c5fd', '#d8b4fe', '#f9a8d4',
]
const TOKENS = ['text', 'muted', 'bg', 'surface', 'accent', 'accent2', 'onAccent']
/** colorPicker(root, anchor, { value, deck colours, onPick(value), none }) - value is '#hex' or '@token' */
export function colorPicker(root, anchor, { value, colors, onPick, none = false, label = 'Colour', recent = [] }) {
  const sw = (v, hex, title) => h('button', {
    type: 'button', class: ['ss-sw', (v === value || (v[0] !== '@' && hex.toLowerCase() === String(value).toLowerCase())) && 'on', hex === '#ffffff' && 'light'],
    style: { background: hex }, title, 'aria-label': title || hex,
    onmousedown: (e) => e.preventDefault(), onclick: () => { onPick(v); p.close() },
  })
  const hex = h('input', { class: 'ss-hex', type: 'text', maxlength: 7, placeholder: '#rrggbb', 'aria-label': 'Hex colour', value: value && value[0] !== '@' ? value : '',
    onkeydown: (e) => { if (e.key === 'Enter') { const x = cssToHex(hex.value.trim().startsWith('#') ? hex.value.trim() : `#${hex.value.trim()}`); if (x) { onPick(x); p.close() } } } })
  const native = h('input', { type: 'color', class: 'ss-native-color', 'aria-label': 'Pick any colour', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#5b4cf0',
    oninput: () => { hex.value = native.value }, onchange: () => { onPick(native.value); p.close() } })
  const body = h('div', { class: 'ss-colors' },
    h('div', { class: 'ss-pop-title' }, label),
    h('div', { class: 'ss-sw-row' }, TOKENS.map((k) => sw(`@${k}`, colors[k], `Theme: ${k}`))),
    h('div', { class: 'ss-sw-grid' }, STANDARD.map((c) => sw(c, c))),
    recent.length ? h('div', { class: 'ss-sw-row' }, recent.map((c) => sw(c, c))) : null,
    h('div', { class: 'ss-hex-row' }, hex, native, h('button', { type: 'button', class: 'ss-link', onmousedown: (e) => e.preventDefault(), onclick: () => { const x = cssToHex(hex.value.trim().startsWith('#') ? hex.value.trim() : `#${hex.value.trim()}`); if (x) { onPick(x); p.close() } } }, 'Apply')),
    none ? h('button', { type: 'button', class: 'ss-menu-item', onmousedown: (e) => e.preventDefault(), onclick: () => { onPick(''); p.close() } }, icon('slash'), h('span', 'No colour')) : null)
  const p = popover(root, anchor, body, { cls: 'ss-pop-colors', label })
  return p
}

// ---------- Compact fields for the inspector ----------
export function numField(label, value, onChange, o = {}) {
  const inp = h('input', {
    class: 'ss-num', type: 'number', value: Number.isFinite(value) ? +(+value).toFixed(o.dec ?? 1) : '', min: o.min, max: o.max, step: o.step ?? 1, 'aria-label': label, disabled: o.disabled,
    onchange: () => { const v = inp.valueAsNumber; if (Number.isFinite(v)) onChange(o.max != null ? Math.min(o.max, v) : v, inp); else inp.value = value },
    onkeydown: (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation() },
  })
  return h('label', { class: 'ss-field' }, h('span', label), inp, o.unit && h('em', o.unit))
}
export function selField(label, options, value, onChange, o = {}) {
  const sel = h('select', { class: 'ss-select', 'aria-label': label, onchange: () => onChange(sel.value, sel), disabled: o.disabled },
    options.map((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; return h('option', { value: v, selected: String(v) === String(value) }, l) }))
  return o.bare ? sel : h('label', { class: 'ss-field wide' }, h('span', label), sel)
}
export function segField(label, options, value, onChange) {
  const g = h('div', { class: 'ss-seg', role: 'group', 'aria-label': label }, options.map(([v, l, ic]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value), 'aria-label': l, title: l, onmousedown: (e) => e.preventDefault(), onclick: () => { for (const x of g.children) x.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); onChange(v) } }, ic ? icon(ic) : l)
    return b
  }))
  return h('div', { class: 'ss-field wide' }, h('span', label), g)
}
export const section = (title, ...kids) => h('section', { class: 'ss-section' }, title && h('h3', title), kids)
export const swatchBtn = (label, color, onClick, o = {}) => {
  const b = h('button', { type: 'button', class: 'ss-colorbtn', 'aria-label': label, onmousedown: (e) => { if (!o.focus) e.preventDefault() }, onclick: (e) => onClick(e, b) },
    h('span', { class: ['ss-chip', !color && 'none'], style: { background: color || null } }), o.text && h('span', o.text))
  b.dataset.tip = label
  b.setChip = (c) => { const chip = b.querySelector('.ss-chip'); chip.style.background = c || ''; chip.classList.toggle('none', !c) }
  return b
}
