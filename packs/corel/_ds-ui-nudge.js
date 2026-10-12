// Draw Studio nudge pad. A phone has no arrow keys, so the property bar gets a Nudge button that opens a small pad of four arrow buttons and three step
// sizes (0.1, 1 and 10 mm; the arrow keys use the same steps). Every press runs the same command as the keyboard (object.nudge*), so snapping,
// locks, undo merging and the nudge preference behave exactly the same. The pad lives inside the app root (the property bar scrolls and would clip it).
import { h, icon } from '../../lib/ui.js'

const STEPS = [[0.1, '0.1 mm'], [1, '1 mm'], [10, '10 mm']]
const ARROWS = [['object.nudgeUp', 'chevron-up', 'Nudge up', 'up'], ['object.nudgeLeft', 'chevron-left', 'Nudge left', 'left'], ['object.nudgeRight', 'chevron-right', 'Nudge right', 'right'], ['object.nudgeDown', 'chevron-down', 'Nudge down', 'down']]

/** env: {store, commands, wrap (the .t-ds root), focusBack()} -> {el (the button for the property bar), refresh(sel), close, dispose} */
export function createNudge({ store, commands, wrap, focusBack }) {
  let step = 1
  const stepBtns = STEPS.map(([v, label]) => h('button', { type: 'button', class: 'ds-xchip ds-nudge-step', 'aria-pressed': String(v === step), onclick: () => { step = v; paint() } }, label))
  const arrows = ARROWS.map(([id, ic, label, pos]) => h('button', { type: 'button', class: `ds-btn ds-nudge-b ds-nudge-${pos}`, 'data-cmd': id, 'aria-label': label, title: label, onclick: () => commands.run(id, { step }) }, icon(ic)))
  const mid = h('span', { class: 'ds-nudge-mid', 'aria-hidden': 'true' }, icon('move'))
  const pad = h('div', { class: 'ds-nudge', role: 'group', 'aria-label': 'Nudge the selection', hidden: true },
    h('div', { class: 'ds-nudge-grid' }, arrows[0], arrows[1], mid, arrows[2], arrows[3]),
    h('div', { class: 'ds-nudge-steps', role: 'group', 'aria-label': 'Step size' }, ...stepBtns),
    h('button', { type: 'button', class: 'ds-btn ds-nudge-done', 'aria-label': 'Close the nudge pad', onclick: () => close(true) }, icon('check'), h('span', 'Done')))
  wrap.append(pad)
  const btn = h('button', { type: 'button', class: 'ds-btn ds-nudgebtn', 'aria-label': 'Nudge', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Move the selection with arrow buttons', onclick: () => (pad.hidden ? open() : close(true)) }, icon('move'), h('span', 'Nudge'))
  function paint() { for (const [i, b] of stepBtns.entries()) b.setAttribute('aria-pressed', String(STEPS[i][0] === step)) }
  function open() {
    pad.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    const w = wrap.getBoundingClientRect(), b = btn.getBoundingClientRect()
    const left = Math.max(6, Math.min(b.left - w.left, w.width - pad.offsetWidth - 6))
    pad.style.left = `${left}px`
    pad.style.top = `${Math.min(b.bottom - w.top + 4, w.height - pad.offsetHeight - 6)}px`
    arrows[3].focus({ preventScroll: true })
  }
  function close(back) {
    if (pad.hidden) return
    pad.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    if (back) btn.focus({ preventScroll: true })
  }
  pad.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) } })
  const onDown = (e) => { if (!pad.hidden && !pad.contains(e.target) && !btn.contains(e.target)) close(false) }
  document.addEventListener('pointerdown', onDown, true)
  return {
    el: btn,
    refresh(sel) { btn.hidden = !sel; if (!sel) close(false); for (const b of arrows) b.disabled = !commands.enabled(b.dataset.cmd) },
    close,
    dispose() { document.removeEventListener('pointerdown', onDown, true); pad.remove() },
  }
}
