// Draw Studio path helpers over contract path commands (['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z']). Pure.
// Implemented: pathDistance. SKELETON (milestone E9 fills these in): dToSubs, subsToD, localPath, applyShape, shapeToCurves, simplifyFreehand and the node primitives.
const notYet = (name) => () => { throw new Error(`${name} is not built yet`) }

/** Distance from point p {x,y} to the outline of a path (curves are flattened into 16 segments). */
export function pathDistance(d, p) {
  let best = Infinity, cx = 0, cy = 0, sx = 0, sy = 0
  const seg = (x0, y0, x1, y1) => {
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / l2)) : 0
    const q = Math.hypot(p.x - (x0 + t * dx), p.y - (y0 + t * dy))
    if (q < best) best = q
  }
  for (const c of d) {
    if (c[0] === 'M') { cx = sx = c[1]; cy = sy = c[2] }
    else if (c[0] === 'L') { seg(cx, cy, c[1], c[2]); cx = c[1]; cy = c[2] }
    else if (c[0] === 'C') {
      let px = cx, py = cy
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t
        const x = u * u * u * cx + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t * c[5]
        const y = u * u * u * cy + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6]
        seg(px, py, x, y); px = x; py = y
      }
      cx = c[5]; cy = c[6]
    } else if (c[0] === 'Z') { seg(cx, cy, sx, sy); cx = sx; cy = sy }
  }
  return best
}
export const dToSubs = notYet('dToSubs')
export const subsToD = notYet('subsToD')
export const localPath = notYet('localPath')
export const applyShape = notYet('applyShape')
export const shapeToCurves = notYet('shapeToCurves')
export const simplifyFreehand = notYet('simplifyFreehand')
