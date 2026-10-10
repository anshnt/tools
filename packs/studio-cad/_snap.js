// Object snaps, ortho and polar constraints for CAD Studio. Pure functions, no DOM.
import { dist, sub, dot, angle, norm, polar, boxHit, boxPad, primNearest, intersectPrims, onPrim, D2R } from './_vec.js'
import { prims, bbox, snapPoints } from './_ent.js'

export const SNAP_KINDS = [['end', 'Endpoint'], ['mid', 'Midpoint'], ['cen', 'Centre'], ['quad', 'Quadrant'], ['int', 'Intersection'], ['per', 'Perpendicular'], ['nea', 'Nearest']]
const PRIORITY = { end: 0, int: 1, mid: 2, cen: 3, quad: 4, per: 5, nea: 6 }

/**
 * Best object snap near world point p. modes = { end, mid, cen, quad, int, per, nea } booleans.
 * Returns { pt, kind, ent } or null. `base` (the previous point) enables perpendicular.
 */
export function findSnap(doc, p, scale, modes, base, aperturePx = 14) {
  const ap = aperturePx / scale
  const box = { x0: p.x - ap, y0: p.y - ap, x1: p.x + ap, y1: p.y + ap }
  let cand = doc.visible().filter((e) => boxHit(bbox(e), box))
  if (cand.length > 40) {
    const near = (e) => { let d = Infinity; for (const p of prims(e)) d = Math.min(d, primNearest(p, p0).d); return d }
    const p0 = p
    cand = cand.map((e) => [near(e), e]).sort((a, b) => a[0] - b[0]).slice(0, 40).map((x) => x[1])
  }
  if (!cand.length) return null
  let best = null
  const consider = (pt, kind, ent) => {
    const d = dist(pt, p)
    if (d > ap) return
    if (!best || d < best.d - 1e-9 * (1 + ap) || (Math.abs(d - best.d) <= 1e-9 * (1 + ap) && PRIORITY[kind] < PRIORITY[best.kind])) best = { pt, kind, ent, d }
  }
  for (const e of cand) {
    const sp = snapPoints(e)
    for (const k of ['end', 'mid', 'cen', 'quad']) if (modes[k]) for (const q of sp[k]) consider(q, k, e)
  }
  if (modes.int) {
    for (let i = 0; i < cand.length; i++) {
      for (let j = i + 1; j < cand.length; j++) {
        if (!boxHit(bbox(cand[i]), boxPad(bbox(cand[j]), 1e-6))) continue
        for (const a of prims(cand[i])) for (const b of prims(cand[j])) for (const r of intersectPrims(a, b)) if (onPrim(a, r.sp) && onPrim(b, r.sq)) consider(r.pt, 'int', cand[i])
      }
    }
  }
  if (best) return { pt: best.pt, kind: best.kind, ent: best.ent }
  if (modes.per && base) {
    for (const e of cand) {
      for (const pr of prims(e)) {
        if (primNearest(pr, p).d > ap) continue
        let foot = null
        if (pr.k === 's') {
          const ab = sub(pr.b, pr.a)
          const l2 = dot(ab, ab)
          if (l2 > 1e-18) { const t = dot(sub(base, pr.a), ab) / l2; if (t >= -1e-9 && t <= 1 + 1e-9) foot = { x: pr.a.x + ab.x * t, y: pr.a.y + ab.y * t } }
        } else if (pr.k === 'a') {
          const a0 = angle(pr.c, base)
          for (const a of [a0, a0 + Math.PI]) if (norm(a - pr.a0) <= pr.sw + 1e-9) { const q = polar(pr.c, a, pr.r); if (!foot || dist(q, p) < dist(foot, p)) foot = q }
        } else foot = primNearest(pr, base).pt
        if (foot) { best = { pt: foot, kind: 'per', ent: e }; break }
      }
      if (best) break
    }
    if (best) return best
  }
  if (modes.nea) {
    let bn = null
    for (const e of cand) for (const pr of prims(e)) { const r = primNearest(pr, p); if (r.d <= ap && (!bn || r.d < bn.d)) bn = { pt: r.pt, kind: 'nea', ent: e, d: r.d } }
    if (bn) return bn
  }
  return null
}

/** Apply ortho/polar constraints relative to base. Returns { pt, track } where track is a label when a polar ray is active. */
export function constrain(raw, base, o) {
  if (!base) return { pt: raw }
  const dx = raw.x - base.x, dy = raw.y - base.y
  const d = Math.hypot(dx, dy)
  if (d < 1e-12) return { pt: raw }
  if (o.ortho) return Math.abs(dx) >= Math.abs(dy) ? { pt: { x: raw.x, y: base.y } } : { pt: { x: base.x, y: raw.y } }
  if (o.polar) {
    const inc = (o.polarInc || 45) * D2R
    const a = Math.atan2(dy, dx)
    const k = Math.round(a / inc)
    const snapA = k * inc
    const off = Math.abs(Math.sin(a - snapA)) * d // perpendicular distance in world units
    if (off * o.scale < 10) {
      const proj = d * Math.cos(a - snapA)
      const deg = ((((snapA * 180) / Math.PI) % 360) + 360) % 360
      return { pt: { x: base.x + Math.cos(snapA) * proj, y: base.y + Math.sin(snapA) * proj }, track: `${fmt(proj)} < ${+deg.toFixed(2)}°` }
    }
  }
  return { pt: raw }
}
const fmt = (v) => +v.toFixed(3)

export const snapToGrid = (p, step) => ({ x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step })
