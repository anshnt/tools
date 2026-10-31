// The format picker: the most common targets as big chips on the front, every other format on the flip side.
// Keyboard: arrows move, Enter picks, Tab flips to the other side (Shift+Tab flips back), Escape goes back to the front.
// With the picker focused the mouse wheel flips it too. A button does the same for mouse and touch.
import { h, icon, input } from '../../lib/ui.js'

let styled = false
function styles() {
  if (styled) return
  styled = true
  document.head.append(h('style', `
.fc-picker { position: relative; }
.fc-face { display: flex; flex-wrap: wrap; gap: 8px; }
.fc-face[hidden], .fc-chip[hidden], .fc-back-group[hidden] { display: none; }
.fc-face.flip-in { animation: fc-flip .28s var(--ease, ease) both; }
@keyframes fc-flip { from { opacity: 0; transform: perspective(600px) rotateX(-35deg) scale(.97); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .fc-face.flip-in { animation: none; } }
.fc-chip { display: inline-flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px; min-height: 48px; min-width: 76px; padding: 6px 14px; border-radius: 14px; font: inherit; cursor: pointer; text-align: left;
  border: 1px solid var(--border); background: var(--surface); color: var(--text); transition: border-color .15s, background .15s, transform .15s; }
.fc-chip b { font-size: 15px; font-weight: 650; }
.fc-chip small { font-size: 11.5px; color: var(--muted); max-width: 190px; }
.fc-chip:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); transform: translateY(-1px); }
.fc-chip[aria-selected="true"], .fc-chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.fc-chip[aria-selected="true"] small, .fc-chip[aria-pressed="true"] small { color: inherit; opacity: .85; }
.fc-back { display: grid; gap: 10px; width: 100%; }
.fc-back[hidden] { display: none; }
.fc-back-list { display: grid; gap: 10px; max-height: 280px; overflow: auto; padding-right: 4px; }
.fc-back-group h4 { margin: 0 0 6px; font-size: 12px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
.fc-back-group .fc-face { gap: 6px; }
.fc-back .fc-chip { min-height: 36px; min-width: 0; padding: 4px 11px; border-radius: 10px; flex-direction: row; align-items: center; gap: 6px; }
.fc-back .fc-chip b { font-size: 13.5px; font-weight: 600; }
.fc-back .fc-chip small { font-size: 11px; }
.fc-flipbar { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.fc-flipbar .muted { font-size: 12px; }
`))
}

/**
 * formatPicker({front: [{id, label, hint}], back: [{title, items: [{id, label, hint}]}], value, onPick(id), ariaLabel})
 * -> element with .set(id) to change the selection and .flip(toBack?) to turn it.
 */
export function formatPicker({ front, back, value, onPick, ariaLabel = 'Convert to' }) {
  styles()
  let current = value ?? null
  let isBack = false
  const chipEl = new Map()
  const mk = (it) => {
    const b = h('button', { type: 'button', class: 'fc-chip', role: 'option', 'aria-selected': String(it.id === current), tabindex: -1, dataset: { id: it.id }, onclick: () => pick(it.id) },
      h('b', it.label), it.hint && h('small', it.hint))
    ;(chipEl.get(it.id) || chipEl.set(it.id, []).get(it.id)).push(b)
    return b
  }
  const frontFace = h('div', { class: 'fc-face', role: 'listbox', 'aria-label': ariaLabel }, front.map(mk))
  const filter = input({ type: 'search', placeholder: 'Find a format', 'aria-label': 'Find a format', oninput: () => applyFilter() })
  const backList = h('div', { class: 'fc-back-list' }, back.map((g) => h('div', { class: 'fc-back-group', dataset: { title: g.title } }, h('h4', g.title), h('div', { class: 'fc-face', role: 'listbox', 'aria-label': g.title }, g.items.map(mk)))))
  const backFace = h('div', { class: 'fc-back', hidden: true }, filter, backList)
  const flipBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => flip(!isBack) }, icon('refresh-cw'), h('span', 'More formats'))
  const hasBack = back.some((g) => g.items.length)
  const hint = h('span', { class: 'muted' }, 'Tab or the mouse wheel turns the card')
  const el = h('div', { class: 'fc-picker', dataset: { side: 'front' } }, frontFace, backFace, hasBack ? h('div', { class: 'fc-flipbar' }, flipBtn, hint) : null)

  function applyFilter() {
    const q = filter.value.trim().toLowerCase()
    for (const g of backList.children) {
      let any = false
      for (const b of g.querySelectorAll('.fc-chip')) { const hit = !q || b.textContent.toLowerCase().includes(q) || b.dataset.id.includes(q); b.hidden = !hit; any ||= hit }
      g.hidden = !any
    }
  }
  const visibleChips = () => [...(isBack ? backFace : frontFace).querySelectorAll('.fc-chip')].filter((b) => !b.hidden && !b.closest('[hidden]'))
  function rove(target) {
    for (const bs of chipEl.values()) for (const b of bs) b.tabIndex = -1
    if (target) { target.tabIndex = 0; target.focus() }
  }
  function settle() {
    // exactly one chip per side is in the tab order: the selected one, else the first
    const chips = visibleChips()
    for (const bs of chipEl.values()) for (const b of bs) b.tabIndex = -1
    const sel = chips.find((b) => b.getAttribute('aria-selected') === 'true') || chips[0]
    if (sel) sel.tabIndex = 0
  }
  function flip(toBack, keepFocus = false) {
    if (toBack === isBack || (toBack && !hasBack)) return
    isBack = toBack
    el.dataset.side = isBack ? 'back' : 'front'
    frontFace.hidden = isBack
    backFace.hidden = !isBack
    ;(isBack ? backFace : frontFace).classList.add('flip-in')
    setTimeout(() => (isBack ? backFace : frontFace).classList.remove('flip-in'), 320)
    flipBtn.lastChild.textContent = isBack ? 'Common formats' : 'More formats'
    settle()
    if (keepFocus) { const c = visibleChips(); rove(c.find((b) => b.getAttribute('aria-selected') === 'true') || c[0]) }
  }
  function pick(id) {
    current = id
    for (const [k, bs] of chipEl) for (const b of bs) b.setAttribute('aria-selected', String(k === id))
    settle()
    onPick?.(id)
  }
  el.addEventListener('keydown', (e) => {
    if (e.target === filter) {
      if (e.key === 'ArrowDown') { e.preventDefault(); rove(visibleChips()[0]) }
      else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); flip(false, true) }
      else if (e.key === 'Escape') { e.preventDefault(); flip(false, true) }
      return
    }
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains('fc-chip')) return
    const chips = visibleChips()
    const i = chips.indexOf(e.target)
    const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (move) { e.preventDefault(); rove(chips[(i + move + chips.length) % chips.length]) }
    else if (e.key === 'Home') { e.preventDefault(); rove(chips[0]) }
    else if (e.key === 'End') { e.preventDefault(); rove(chips.at(-1)) }
    else if (e.key === 'Tab' && hasBack && !e.shiftKey && !isBack) { e.preventDefault(); flip(true, true) }
    else if (e.key === 'Tab' && e.shiftKey && isBack) { e.preventDefault(); flip(false, true) }
    else if (e.key === 'Escape' && isBack) { e.preventDefault(); flip(false, true) }
  })
  el.addEventListener('wheel', (e) => {
    if (!hasBack || !el.contains(document.activeElement) || Math.abs(e.deltaY) < 4) return
    e.preventDefault()
    flip(e.deltaY > 0, true)
  }, { passive: false })

  el.set = (id) => { current = id; for (const [k, bs] of chipEl) for (const b of bs) b.setAttribute('aria-selected', String(k === id)); settle() }
  el.flip = flip
  settle()
  return el
}
