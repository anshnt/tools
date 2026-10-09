// Small UI helpers shared by the Video Studio panels: tooltip buttons, a pop-up menu and the shared UI state.
import { h, icon, button } from '../../lib/ui.js'

/** Icon button with a tooltip (data-tip, shown by the stylesheet) and an aria-label. pos: b (below), t, l, r. */
export function iconBtn(name, label, { onClick, pos = 'b', shortcut, variant = 'ghost', size = 'sm', text, cls } = {}) {
  const b = button(text || '', { icon: name, variant, size, ariaLabel: label, onClick })
  b.removeAttribute('title')
  b.dataset.tip = shortcut ? `${label} (${shortcut})` : label
  b.dataset.tipPos = pos
  if (cls) b.classList.add(cls)
  return b
}

export function setTip(el, label, shortcut) { el.dataset.tip = shortcut ? `${label} (${shortcut})` : label; el.setAttribute('aria-label', label) }
export function setOn(btn, on) { btn.classList.toggle('on', !!on); btn.setAttribute('aria-pressed', String(!!on)) }

/** Floating menu next to an element. items: [{label, icon, onClick}]. Closes on outside click, Escape or choice. */
export function popMenu(anchor, items) {
  document.querySelectorAll('.vs-menu').forEach((m) => m.remove())
  const menu = h('div', { class: 'vs-menu', role: 'menu' })
  const close = () => { menu.remove(); document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc, true) }
  const away = (e) => { if (!menu.contains(e.target)) close() }
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  for (const it of items) menu.append(h('button', { type: 'button', role: 'menuitem', onclick: () => { close(); it.onClick() } }, it.icon && icon(it.icon), it.label))
  ;(anchor.closest('.vs') || document.body).append(menu) // inside the app so it stays visible in full screen
  const r = anchor.getBoundingClientRect()
  const mw = menu.offsetWidth, mh = menu.offsetHeight
  menu.style.left = `${Math.max(8, Math.min(innerWidth - mw - 8, r.left))}px`
  menu.style.top = `${r.bottom + 6 + mh > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`
  setTimeout(() => { document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', esc, true) })
  menu.querySelector('button')?.focus()
  return close
}

/** Shared editor state (selection, zoom, tools) with a tiny subscribe API. */
export class UiState {
  constructor() {
    this.sel = new Set()
    this.pps = 70
    this.snap = true
    this.ripple = true
    this.tool = 'select'
    this.subs = new Set()
  }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn) }
  set(patch) { Object.assign(this, patch); for (const f of [...this.subs]) f(patch) }
  select(ids) { this.set({ sel: new Set(ids) }) }
}

export const pad2 = (n) => String(n).padStart(2, '0')
export function fmtClock(t, frac = 0) {
  t = Math.max(0, t)
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, hh = Math.floor(t / 3600)
  const f = frac ? '.' + String(Math.floor((t % 1) * 10 ** frac)).padStart(frac, '0') : ''
  return `${hh ? hh + ':' + pad2(m) : m}:${pad2(s)}${f}`
}
