// Small UI building blocks for the Docs studio: icon buttons with tooltips, popovers, colour palettes and menus.
import { h, icon } from '../../lib/ui.js'

/** Toolbar button. The editor keeps focus (and its selection) when you click it with the mouse. */
export function tbtn(ic, { tip, onClick, label, cls = '', pressed, disabled, tipPos, ariaLabel } = {}) {
  const el = h('button', {
    type: 'button', class: ['dc-btn', label && 'label', cls], 'aria-label': ariaLabel || tip || label, 'data-tip': tip || null, 'data-tip-pos': tipPos || null,
    'aria-pressed': pressed == null ? null : String(!!pressed), disabled,
    onmousedown: (e) => e.preventDefault(),
    onclick: onClick,
  }, ic && icon(ic), label && h('span', label))
  el.setPressed = (v) => el.setAttribute('aria-pressed', String(!!v))
  return el
}

export const sep = () => h('span', { class: 'dc-sep', role: 'separator' })
export const group = (name, ...kids) => h('div', { class: 'dc-group', role: 'group', 'data-g': name }, kids)

/** One popover at a time, placed under its anchor inside root. Closes on outside click or Escape. */
export function createPopovers(root) {
  let cur = null
  const onDown = (e) => { if (cur && !cur.el.contains(e.target) && !cur.anchor?.contains(e.target)) close() }
  const onKey = (e) => { if (e.key === 'Escape' && cur) { e.stopPropagation(); const a = cur.anchor; close(); a?.focus?.() } }
  function close() {
    if (!cur) return
    cur.el.remove()
    cur.anchor?.removeAttribute('aria-expanded')
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
    cur = null
  }
  function open(anchor, content, { align = 'start' } = {}) {
    if (cur && cur.anchor === anchor) { close(); return null }
    close()
    const el = h('div', { class: 'dc-pop', role: 'dialog', onmousedown: (e) => { if (!e.target.closest('input, select, textarea')) e.preventDefault() } }, content)
    el.setAttribute('aria-label', anchor.getAttribute('aria-label') || anchor.textContent.trim() || 'Options')
    el.style.visibility = 'hidden'
    root.append(el)
    const a = anchor.getBoundingClientRect(), r = root.getBoundingClientRect()
    const w = el.offsetWidth, hh = el.offsetHeight
    let left = a.left - r.left - root.clientLeft + (align === 'end' ? a.width - w : 0)
    left = Math.max(8, Math.min(left, r.width - w - 8))
    let top = a.bottom - r.top - root.clientTop + 6
    if (top + hh > r.height - 8) top = Math.max(8, a.top - r.top - root.clientTop - hh - 6)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = ''
    anchor.setAttribute('aria-expanded', 'true')
    cur = { el, anchor }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    el.querySelector('button, input, select')?.focus?.({ preventScroll: true })
    return el
  }
  return { open, close, get isOpen() { return !!cur } }
}

export function menuItem(ic, label, desc, onClick) {
  return h('button', { type: 'button', class: 'dc-item', onclick: onClick }, icon(ic), h('span', { class: 'dc-item-text' }, label, desc && h('small', desc)))
}

// ---------- colours ----------
const mix = (hexColor, to, t) => {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
  const a = p(hexColor), b = p(to)
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
const VIVID = ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff']
export const TEXT_COLORS = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  VIVID,
  ...[0.8, 0.6, 0.4].map((t) => VIVID.map((c) => mix(c, '#ffffff', t))),
  ...[0.3, 0.55].map((t) => VIVID.map((c) => mix(c, '#000000', t))),
]
export const HIGHLIGHTS = ['#fff176', '#b9f6ca', '#a5f3fc', '#fbcfe8', '#ffd8a8', '#e0c3fc', '#e5e7eb', '#fecaca', '#ffff00', '#00ff00']

export function palette({ title, colors, noneLabel, onPick, recent = [], rows }) {
  const sw = (c) => h('button', { type: 'button', class: 'dc-sw', style: { background: c }, title: c, 'aria-label': c, onclick: () => onPick(c) })
  const custom = h('input', { type: 'color', 'aria-label': 'Custom colour', value: '#5b4cf0', style: 'width:34px;height:28px;border:0;background:none;padding:0;cursor:pointer', onchange: (e) => onPick(e.target.value) })
  return h('div', { style: 'display:grid;gap:6px' },
    h('div', { class: 'dc-pop-label' }, title),
    noneLabel && h('button', { type: 'button', class: 'dc-item', onclick: () => onPick(null) }, icon('eraser'), h('span', { class: 'dc-item-text' }, noneLabel)),
    rows ? rows.map((row) => h('div', { class: 'dc-swatches' }, row.map(sw))) : h('div', { class: 'dc-swatches' }, colors.map(sw)),
    recent.length ? [h('div', { class: 'dc-pop-label' }, 'Recent'), h('div', { class: 'dc-swatches' }, recent.map(sw))] : null,
    h('label', { style: 'display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2);padding:2px' }, custom, 'Custom colour'))
}

/** Table size picker: hover a grid or type the numbers. */
export function gridPicker(onPick, max = { r: 8, c: 10 }) {
  const label = h('div', { class: 'dc-grid-label' }, '3 x 3 table')
  const cells = []
  const paint = (r, c) => { cells.forEach((x) => x.el.classList.toggle('on', x.r <= r && x.c <= c)); label.textContent = `${r} x ${c} table` }
  const grid = h('div', { class: 'dc-grid', role: 'grid', 'aria-label': 'Table size' })
  for (let r = 1; r <= max.r; r++) {
    for (let c = 1; c <= max.c; c++) {
      const el = h('button', { type: 'button', class: 'dc-gcell', 'aria-label': `${r} rows, ${c} columns`, onpointerenter: () => paint(r, c), onfocus: () => paint(r, c), onclick: () => onPick(r, c) })
      cells.push({ el, r, c })
      grid.append(el)
    }
  }
  paint(3, 3)
  const rows = h('input', { type: 'number', min: 1, max: 50, value: 3, 'aria-label': 'Rows', style: 'width:64px' })
  const cols = h('input', { type: 'number', min: 1, max: 20, value: 3, 'aria-label': 'Columns', style: 'width:64px' })
  const clamp = (v, hi) => Math.min(hi, Math.max(1, Math.round(+v) || 1))
  return h('div', { style: 'display:grid;gap:6px' }, grid, label,
    h('div', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted)' }, rows, 'x', cols,
      h('button', { type: 'button', class: 'dc-btn label', style: 'margin-left:auto;background:var(--accent);color:var(--accent-text)', onclick: () => onPick(clamp(rows.value, 50), clamp(cols.value, 20)) }, h('span', 'Insert'))))
}
