// Crop overlay: drag the edges, corners or the inside of the frame over the straightened image.
// Works in pixels of the oriented image; a straightened crop must stay inside the image, so moves stick at the border.
import { h } from '../../lib/ui.js'
import { cropInside, constrainCrop } from './_model.js'

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN = 24 // smallest side in oriented pixels

/**
 * createCrop({ pane, get(): {crop, angle, Wo, Ho, ratio}, onChange(crop, final) })
 * ratio is w/h in pixels, or null for a free crop. refresh() redraws after outside changes.
 */
export function createCrop({ pane, get, onChange }) {
  const frame = h('div', { class: 'pd-crop', 'aria-label': 'Crop frame' },
    h('div', { class: 'pd-crop-grid' }),
    HANDLES.map((k) => h('div', { class: `pd-handle h-${k}`, dataset: { h: k } })))
  pane.append(frame)

  const place = () => {
    const { crop } = get()
    frame.style.left = `${crop.x * 100}%`
    frame.style.top = `${crop.y * 100}%`
    frame.style.width = `${crop.w * 100}%`
    frame.style.height = `${crop.h * 100}%`
  }
  let drag = null

  function candidate(handle, start, dx, dy, st) {
    const { Wo, Ho, ratio } = st
    // work in pixels of the oriented image
    let l = start.x * Wo, t = start.y * Ho, r = (start.x + start.w) * Wo, b = (start.y + start.h) * Ho
    if (handle === 'move') { l += dx; r += dx; t += dy; b += dy }
    else {
      const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s')
      if (west) l += dx
      if (east) r += dx
      if (north) t += dy
      if (south) b += dy
      if (r - l < MIN) { if (west) l = r - MIN; else r = l + MIN }
      if (b - t < MIN) { if (north) t = b - MIN; else b = t + MIN }
      if (ratio) {
        const cx = (start.x + start.w / 2) * Wo, cy = (start.y + start.h / 2) * Ho
        let w = r - l, hh = b - t
        const corner = handle.length === 2
        if (corner) {
          if (w / ratio > hh) hh = w / ratio; else w = hh * ratio
          if (west) l = r - w; else r = l + w
          if (north) t = b - hh; else b = t + hh
        } else if (west || east) {
          hh = w / ratio
          t = cy - hh / 2; b = cy + hh / 2
        } else {
          w = hh * ratio
          l = cx - w / 2; r = cx + w / 2
        }
      }
    }
    return { x: l / Wo, y: t / Ho, w: (r - l) / Wo, h: (b - t) / Ho }
  }

  /** Largest step from `from` toward `to` that stays inside the image. */
  function reach(from, to, angle, Wo, Ho) {
    if (cropInside(to, angle, Wo, Ho)) return to
    let lo = 0, hi = 1
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2
      const c = { x: from.x + (to.x - from.x) * m, y: from.y + (to.y - from.y) * m, w: from.w + (to.w - from.w) * m, h: from.h + (to.h - from.h) * m }
      if (cropInside(c, angle, Wo, Ho)) lo = m; else hi = m
    }
    return { x: from.x + (to.x - from.x) * lo, y: from.y + (to.y - from.y) * lo, w: from.w + (to.w - from.w) * lo, h: from.h + (to.h - from.h) * lo }
  }

  frame.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return
    const handle = e.target.dataset?.h || 'move'
    const st = get()
    drag = { handle, x0: e.clientX, y0: e.clientY, start: { ...st.crop }, last: { ...st.crop } }
    frame.setPointerCapture(e.pointerId)
    frame.classList.add('dragging')
    e.preventDefault()
    e.stopPropagation()
  })
  frame.addEventListener('pointermove', (e) => {
    if (!drag) return
    const st = get()
    const pr = pane.getBoundingClientRect()
    const dx = ((e.clientX - drag.x0) / pr.width) * st.Wo, dy = ((e.clientY - drag.y0) / pr.height) * st.Ho
    let c = candidate(drag.handle, drag.start, dx, dy, st)
    if (c.w <= 0 || c.h <= 0) return
    c = reach(drag.last, c, st.angle, st.Wo, st.Ho)
    if (c.x < 0 || c.y < 0 || c.x + c.w > 1 + 1e-9 || c.y + c.h > 1 + 1e-9) {
      // outside the frame (unrotated case): slide back in for moves, shrink for resizes
      if (drag.handle === 'move') c = { ...c, x: Math.min(1 - c.w, Math.max(0, c.x)), y: Math.min(1 - c.h, Math.max(0, c.y)) }
      else c = reach(drag.last, { x: Math.max(0, c.x), y: Math.max(0, c.y), w: Math.min(c.w, 1 - Math.max(0, c.x)), h: Math.min(c.h, 1 - Math.max(0, c.y)) }, st.angle, st.Wo, st.Ho)
    }
    drag.last = c
    onChange(c, false)
    place()
  })
  const end = () => {
    if (!drag) return
    drag = null
    frame.classList.remove('dragging')
    onChange(get().crop, true)
  }
  frame.addEventListener('pointerup', end)
  frame.addEventListener('pointercancel', end)
  frame.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const st = get()
    const c = { ...st.crop, x: st.crop.x + d[0] / st.Wo, y: st.crop.y + d[1] / st.Ho }
    onChange(constrainCrop(c, st.angle, st.Wo, st.Ho), true)
    place()
  })
  frame.tabIndex = 0
  place()
  return { el: frame, refresh: place, destroy: () => frame.remove() }
}
