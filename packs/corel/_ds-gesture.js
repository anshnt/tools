// Pointer gesture maths for the Pick tool: handles, scale, rotate and skew matrices. Pure (no DOM), so Node tests cover it.
// Boxes are {x, y, w, h} in page points (y down). A handle id is one of the eight compass points: nw n ne e se s sw w.
import { about, scaleAbout, rotateAbout, skewXAbout, skewYAbout } from './_ds-ops.js'

export const HANDLE_IDS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN_SCALE = 1e-3
export const DEG15 = Math.PI / 12

/** Where a handle sits on the box (page points). */
export function handlePoint(box, id) {
  const x = id.includes('w') ? box.x : id.includes('e') ? box.x + box.w : box.x + box.w / 2
  const y = id.includes('n') ? box.y : id.includes('s') ? box.y + box.h : box.y + box.h / 2
  return { x, y }
}
const sgn = (v) => (v < 0 ? -1 : 1)
const clampScale = (s) => (Math.abs(s) < MIN_SCALE ? sgn(s) * MIN_SCALE : s)

/**
 * Scale by dragging a handle by d = {x, y} (page points since the press).
 * opts: {shift: keep the ratio, alt: scale about the centre}. Returns {M, sx, sy, anchor}. Dragging past the opposite side mirrors.
 */
export function scaleFromHandle(box, id, d, { shift = false, alt = false } = {}) {
  const h = handlePoint(box, id)
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  const moveX = id.includes('w') || id.includes('e'), moveY = id.includes('n') || id.includes('s')
  const ax = alt || !moveX ? cx : id.includes('w') ? box.x + box.w : box.x
  const ay = alt || !moveY ? cy : id.includes('n') ? box.y + box.h : box.y
  const ratio = (v, a, hv) => (Math.abs(hv - a) < 1e-9 ? 1 : (hv + v - a) / (hv - a))
  let sx = moveX ? ratio(d.x, ax, h.x) : 1
  let sy = moveY ? ratio(d.y, ay, h.y) : 1
  if (shift) {
    if (moveX && moveY) { const m = Math.max(Math.abs(sx), Math.abs(sy)); sx = sgn(sx) * m; sy = sgn(sy) * m }
    else if (moveX) sy = Math.abs(sx)
    else sx = Math.abs(sy)
  }
  sx = clampScale(sx); sy = clampScale(sy)
  return { M: scaleAbout(sx, sy, ax, ay), sx, sy, anchor: { x: ax, y: ay } }
}

/** Rotation about `pivot` that carries the pointer from p0 to p1; step (radians) rounds the total angle. Returns {M, angle}. */
export function rotateFrom(pivot, p0, p1, { step = 0 } = {}) {
  let a = Math.atan2(p1.y - pivot.y, p1.x - pivot.x) - Math.atan2(p0.y - pivot.y, p0.x - pivot.x)
  if (a > Math.PI) a -= 2 * Math.PI
  if (a < -Math.PI) a += 2 * Math.PI
  if (step) a = Math.round(a / step) * step
  return { M: rotateAbout(a, pivot.x, pivot.y), angle: a }
}

/** Skew by dragging an edge handle ('n' 's' skew horizontally, 'e' 'w' vertically) by d about `pivot`. Returns {M, k} or null when the pivot sits on the handle's line. */
export function skewFromHandle(box, id, pivot, d) {
  const h = handlePoint(box, id)
  const MAXK = 11.43 // tan 85 degrees
  if (id === 'n' || id === 's') {
    const dist = h.y - pivot.y
    if (Math.abs(dist) < 1e-9) return null
    const k = Math.max(-MAXK, Math.min(MAXK, d.x / dist))
    return { M: skewXAbout(k, pivot.y), k }
  }
  if (id === 'e' || id === 'w') {
    const dist = h.x - pivot.x
    if (Math.abs(dist) < 1e-9) return null
    const k = Math.max(-MAXK, Math.min(MAXK, d.y / dist))
    return { M: skewYAbout(k, pivot.x), k }
  }
  return null
}

/** Constrain a move to the dominant axis. */
export const constrainMove = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy })

/** The handle (if any) within `r` screen px of the screen point s, given the box in screen px. ids: which handles exist. */
export function hitHandle(screenBox, ids, s, r) {
  let best = null, bd = Infinity
  for (const id of ids) {
    const p = handlePoint(screenBox, id)
    const d = Math.hypot(p.x - s.x, p.y - s.y)
    if (d <= r && d < bd) { best = id; bd = d }
  }
  return best
}
export { about }
