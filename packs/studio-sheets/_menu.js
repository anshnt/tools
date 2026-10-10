// Popup menus, color pickers and small dialogs used by the toolbar, context menus and panels.
import { h, icon } from '../../lib/ui.js'

let current = null
export function closePopup() { current?.close(); current = null }

/** Show an element as a popup anchored to a button or a point {x, y}. host: element to append to (keeps fullscreen working). */
export function popup(host, anchor, content, opts = {}) {
  closePopup()
  const el = h('div', { class: ['sx-pop', opts.class], role: opts.role || 'dialog', tabindex: -1 }, content)
  host.append(el)
  const a = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y, width: 0, height: 0 }
  const pr = el.getBoundingClientRect()
  const vw = window.innerWidth, vh = window.innerHeight
  let left = opts.align === 'end' ? a.right - pr.width : a.left
  let top = a.bottom + 4
  if (left + pr.width > vw - 8) left = Math.max(8, vw - pr.width - 8)
  if (left < 8) left = 8
  if (top + pr.height > vh - 8) top = a.top - pr.height - 4 >= 8 ? a.top - pr.height - 4 : Math.max(8, vh - pr.height - 8)
  el.style.left = left + 'px'
  el.style.top = top + 'px'
  el.style.maxHeight = vh - 16 + 'px'
  const close = () => {
    if (current !== api) return
    current = null
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', close)
    el.remove()
    opts.onClose?.()
    if (opts.restoreFocus && anchor instanceof Element) anchor.focus?.({ preventScroll: true })
  }
  const onDown = (e) => { if (!el.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) close() }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && el.getAttribute('role') === 'menu') {
      e.preventDefault()
      const items = [...el.querySelectorAll('button.sx-mi:not(:disabled)')]
      const i = items.indexOf(document.activeElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
  }
  setTimeout(() => { document.addEventListener('pointerdown', onDown, true) }, 0)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', close)
  const api = { el, close }
  current = api
  if (opts.focus !== false) (el.querySelector('button.sx-mi:not(:disabled), input, button') || el).focus({ preventScroll: true })
  return api
}

/** items: [{label, icon, kbd, onClick, disabled, checked}] or '-' for a separator, or {heading}. */
export function menu(host, anchor, items, opts = {}) {
  const body = items.filter(Boolean).map((it) => {
    if (it === '-') return h('div', { class: 'sx-msep', role: 'separator' })
    if (it.heading) return h('div', { class: 'sx-mh' }, it.heading)
    return h('button', {
      type: 'button', class: ['sx-mi', it.checked && 'on', it.danger && 'danger'], role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': it.checked !== undefined ? String(!!it.checked) : null, disabled: it.disabled,
      onclick: () => { closePopup(); it.onClick?.() },
    }, it.icon ? icon(it.icon) : h('span', { class: 'sx-mi-i' }), h('span', { class: 'sx-mi-l' }, it.label), it.kbd && h('kbd', it.kbd), it.checked ? icon('check') : null)
  })
  return popup(host, anchor, body, { role: 'menu', class: 'sx-menu', restoreFocus: true, ...opts })
}

const GRAYS = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff']
const HUES = ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff']
function shade(hex, t) {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return '#' + n.map((c) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')).join('')
}
const dark = (hex, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('')
export const PALETTE_ROWS = [GRAYS, HUES, ...[0.8, 0.6, 0.4].map((t) => HUES.map((c) => shade(c, t))), HUES.map((c) => dark(c, 0.3))]

/** Color picker popup: palette, recent colors and a custom color input. */
export function colorPicker(host, anchor, { current, onPick, noneLabel = 'No color', recent = [] }) {
  const pick = (c) => { closePopup(); onPick(c) }
  const swatch = (c) => h('button', { type: 'button', class: ['sx-sw', c && c.toLowerCase() === (current || '').toLowerCase() && 'on'], style: { background: c }, title: c, 'aria-label': c, onclick: () => pick(c) })
  const custom = h('input', { type: 'color', class: 'sx-colorin', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#5b4cf0', 'aria-label': 'Custom color' })
  custom.addEventListener('change', () => pick(custom.value))
  return popup(host, anchor, [
    h('button', { type: 'button', class: 'sx-mi sx-none', onclick: () => pick(null) }, icon('ban'), h('span', { class: 'sx-mi-l' }, noneLabel)),
    h('div', { class: 'sx-palette' }, PALETTE_ROWS.map((row) => h('div', { class: 'sx-prow' }, row.map(swatch)))),
    recent.length ? h('div', { class: 'sx-mh' }, 'Recent') : null,
    recent.length ? h('div', { class: 'sx-prow' }, recent.map(swatch)) : null,
    h('label', { class: 'sx-custom' }, h('span', 'Custom'), custom),
  ], { class: 'sx-colorpop' })
}
