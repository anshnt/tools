// Draw Studio Transform docker maths: the matrix for each tab (position, rotate, scale, size, skew) from numbers typed in the docker. Pure.
// Everything is in page points (y down); the docker converts its numbers (units, y up, counter-clockwise degrees) before calling.
import { mul } from './_model.js'
import { rotateAbout, scaleAbout, skewXAbout, skewYAbout, isIdentity } from './_ds-ops.js'

/** The nine reference points of a box, row by row: nw n ne / w c e / sw s se. */
export const REFS = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']
export function refPoint(box, ref = 'c') {
  const x = ref.includes('w') ? box.x : ref.includes('e') ? box.x + box.w : box.x + box.w / 2
  const y = ref.includes('n') ? box.y : ref.includes('s') ? box.y + box.h : box.y + box.h / 2
  return { x, y }
}
const DEG = Math.PI / 180

/**
 * tab 'position': {x, y} the page point the reference point should land on, or {dx, dy, relative: true} a move.
 * tab 'rotate':   {angle} degrees, counter-clockwise on screen, about the reference point.
 * tab 'scale':    {sx, sy} factors (1 = unchanged), about the reference point.
 * tab 'size':     {w, h} new size in points; with prop the other side follows the one named by `changed` ('w' or 'h').
 * tab 'skew':     {kx, ky} degrees of horizontal and vertical shear about the reference point.
 * Returns the 6-matrix, or null when it does nothing or the numbers are unusable.
 */
export function transformMatrix(tab, v, box, ref = 'c') {
  if (!box) return null
  const p = refPoint(box, ref)
  const fin = (...a) => a.every((n) => Number.isFinite(n))
  let M = null
  if (tab === 'position') {
    if (v.relative) { if (!fin(v.dx, v.dy)) return null; M = [1, 0, 0, 1, v.dx, v.dy] } else { if (!fin(v.x, v.y)) return null; M = [1, 0, 0, 1, v.x - p.x, v.y - p.y] }
  } else if (tab === 'rotate') {
    if (!fin(v.angle)) return null
    M = rotateAbout(-v.angle * DEG, p.x, p.y)
  } else if (tab === 'scale') {
    if (!fin(v.sx, v.sy) || !v.sx || !v.sy) return null
    M = scaleAbout(v.sx, v.sy, p.x, p.y)
  } else if (tab === 'size') {
    if (!fin(v.w, v.h) || v.w <= 0 || v.h <= 0 || box.w < 1e-9 || box.h < 1e-9) return null
    let sx = v.w / box.w, sy = v.h / box.h
    if (v.prop) { if (v.changed === 'h') sx = sy; else sy = sx }
    M = scaleAbout(sx, sy, p.x, p.y)
  } else if (tab === 'skew') {
    if (!fin(v.kx, v.ky) || Math.abs(v.kx) >= 89 || Math.abs(v.ky) >= 89) return null
    M = mul(skewYAbout(Math.tan(v.ky * DEG), p.x), skewXAbout(Math.tan(v.kx * DEG), p.y))
    // skewXAbout and skewYAbout are each about their own line through p, which is p itself for both
  }
  return M && !isIdentity(M) ? M : null
}
