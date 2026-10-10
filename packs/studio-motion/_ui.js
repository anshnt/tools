// Small UI helpers shared by the Motion Studio modules.
import { h, icon } from '../../lib/ui.js'

/** Attach a tooltip and an accessible name. css = true draws a styled tooltip (data-tip) for buttons outside scroll areas; otherwise the native title is used. */
export function tip(el, label, shortcut, css = false) {
  const text = shortcut ? `${label} (${shortcut})` : label
  if (css && el instanceof HTMLButtonElement) { el.setAttribute('data-tip', text); el.removeAttribute('title') } else el.title = text
  if (el instanceof HTMLButtonElement && (css || !el.getAttribute('aria-label'))) el.setAttribute('aria-label', label)
  return el
}

/** Icon button with tooltip: iconBtn('undo-2', 'Undo', onClick, {key: 'Ctrl Z', text, cls, pressed}) */
export function iconBtn(name, label, onClick, o = {}) {
  const b = h('button', { type: 'button', class: ['ms-btn', o.sm && 'sm', o.cls], onclick: onClick, disabled: o.disabled }, icon(name), o.text && h('span', o.text))
  if (o.pressed != null) b.setAttribute('aria-pressed', String(!!o.pressed))
  return tip(b, label, o.key, true)
}

/** Timecode mm:ss:ff */
export function timecode(t, fps) {
  const f = Math.round(t * fps), s = Math.floor(f / fps), ff = f - s * fps
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(s / 60))}:${p(s % 60)}:${p(ff)}`
}
export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d
export const fmtNum = (n) => (Number.isFinite(n) ? String(round(n, 2)) : '')

/** Number input with a draggable label: drag the label sideways to scrub the value (Shift = x10, Alt = x0.1). */
export function numField({ label, value, step = 1, min, max, onInput, ariaLabel, cls }) {
  const inp = h('input', { type: 'number', class: ['ms-num', cls], step: 'any', value: fmtNum(value), 'aria-label': ariaLabel || label })
  const set = (v) => {
    if (!Number.isFinite(v)) return
    if (min != null) v = Math.max(min, v)
    if (max != null) v = Math.min(max, v)
    onInput(v)
  }
  inp.addEventListener('input', () => set(inp.valueAsNumber))
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const m = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const v = (inp.valueAsNumber || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * m
    inp.value = fmtNum(v)
    set(v)
  })
  const lab = h('span', { class: 'ms-scrub', 'aria-hidden': 'true' }, label || '')
  let start = null
  lab.addEventListener('pointerdown', (e) => {
    lab.setPointerCapture(e.pointerId)
    start = { x: e.clientX, v: inp.valueAsNumber || 0 }
    e.preventDefault()
  })
  lab.addEventListener('pointermove', (e) => {
    if (!start) return
    const m = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    let v = start.v + (e.clientX - start.x) * step * m * 0.5
    v = Math.round(v * 1000) / 1000
    inp.value = fmtNum(v)
    set(v)
  })
  const stop = () => { start = null }
  lab.addEventListener('pointerup', stop)
  lab.addEventListener('pointercancel', stop)
  const el = h('label', { class: 'ms-numwrap' }, label ? lab : null, inp)
  el.input = inp
  el.setValue = (v) => { if (document.activeElement !== inp) inp.value = fmtNum(v) }
  return el
}

/** Collapsible inspector section. */
export function section(title, body, { open = true, actions } = {}) {
  const d = h('details', { class: 'ms-sec', open }, h('summary', h('span', icon('chevron-right'), title), actions || null), h('div', { class: 'ms-sec-body' }, body))
  return d
}
