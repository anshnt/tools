// Entity-level geometry for CAD Studio: primitives, bounding boxes, hit tests, transforms, snap points, explode. No DOM.
// Entities are plain objects and are treated as immutable once they are in a document, so results are cached in WeakMaps.
//
//   line     { x1, y1, x2, y2 }
//   circle   { cx, cy, r }
//   arc      { cx, cy, r, a0, a1 }            CCW from a0 to a1
//   ellipse  { cx, cy, mx, my, ratio, t0, t1 } (mx, my) is the major-axis vector
//   polyline { pts: [{ x, y, b }], closed }   b is the bulge of the segment that starts at this vertex
//   text     { x, y, h, text, rot, align }    (x, y) is the baseline start (or centre / end for align c / r)
//   dim      { kind, a, b, loc, ang | cx, cy, r, loc | v, a1, a2, q1, q2, loc, th, as, pr, tx }
//   hatch    { loops: [[{ x, y, b }]], pattern, scale, angle }
// Every entity also has id, type, layer (name) and optionally color (hex), ltype and lw (mm) overrides.
import {
  TAU, pt, dist, sub, add, mul, mid, perp, angle, norm, emptyBox, growBox, unionBox, boxHit, boxInside, boxHas, S, A, E, primPoint, primEnds, primMid, primBBox, primNearest, primLength, flattenPrim, bulgeArc, loopArea, vertsToPrims, inLoops, segHitsBox, tfVec,
} from './_vec.js'
import { dimGeom, dimPrims, textCorners } from './_dim.js'

const primCache = new WeakMap(), boxCache = new WeakMap()

export function prims(e) {
  let r = primCache.get(e)
  if (!r) { r = computePrims(e); primCache.set(e, r) }
  return r
}
function computePrims(e) {
  switch (e.type) {
    case 'line': return [S(pt(e.x1, e.y1), pt(e.x2, e.y2))]
    case 'circle': return [A(pt(e.cx, e.cy), e.r, 0, TAU)]
    case 'arc': { let sw = norm(e.a1 - e.a0); if (sw < 1e-9) sw = TAU; return [A(pt(e.cx, e.cy), e.r, e.a0, sw)] }
    case 'ellipse': { let sw = norm(e.t1 - e.t0); if (sw < 1e-9) sw = TAU; return [E(pt(e.cx, e.cy), pt(e.mx, e.my), e.ratio, e.t0, sw)] }
    case 'polyline': return vertsToPrims(e.pts, e.closed)
    case 'dim': return dimPrims(e)
    case 'hatch': return e.loops.flatMap((l) => vertsToPrims(l, true))
    default: return []
  }
}

export function textBox(e) { return textCorners(e.x, e.y, e.h, e.text, e.rot || 0, e.align || 'l') }

export function bbox(e) {
  let b = boxCache.get(e)
  if (b) return b
  b = emptyBox()
  if (e.type === 'text') for (const p of textBox(e).pts) growBox(b, p)
  else {
    for (const p of prims(e)) b = unionBox(b, primBBox(p))
    if (e.type === 'dim') {
      const g = dimGeom(e)
      for (const t of g.texts) for (const p of textCorners(t.x, t.y, t.h, t.str, t.rot, t.align).pts) growBox(b, p)
      for (const a of g.arrows) growBox(b, a.tip)
    }
  }
  boxCache.set(e, b)
  return b
}

const rectDist = (c, p) => {
  const l = [0, 1, 2, 3].map((i) => primNearest(S(c[i], c[(i + 1) % 4]), p).d)
  return Math.min(...l)
}
const inQuad = (c, p) => inLoops([c], p)

/** Distance from p to the visible outline of e (0 inside text). */
export function distTo(e, p) {
  if (e.type === 'text') { const c = textBox(e).pts; return inQuad(c, p) ? 0 : rectDist(c, p) }
  let d = Infinity
  for (const pr of prims(e)) d = Math.min(d, primNearest(pr, p).d)
  if (e.type === 'dim') for (const t of dimGeom(e).texts) { const c = textCorners(t.x, t.y, t.h, t.str, t.rot, t.align).pts; d = Math.min(d, inQuad(c, p) ? 0 : rectDist(c, p)) }
  return d
}

/** Hit distance for picking: filled hatches count as hit anywhere inside. */
export function hitDist(e, p, tol) {
  const d = distTo(e, p)
  if (e.type === 'hatch' && d > tol && inLoops(flatLoops(e.loops), p)) return tol * 0.98
  return d
}

/** Selection rectangle test: window needs the whole object inside, crossing needs any contact. */
export function inRect(e, r, crossing) {
  const b = bbox(e)
  if (!crossing) return boxInside(b, r)
  if (!boxHit(b, r)) return false
  if (boxInside(b, r) || e.type === 'text' || e.type === 'hatch') return true
  const check = (list) => list.some((pr) => { const f = flattenPrim(pr, Math.max(1e-6, Math.max(b.x1 - b.x0, b.y1 - b.y0) / 400)); for (let i = 1; i < f.length; i++) if (segHitsBox(f[i - 1], f[i], r)) return true; return false })
  if (check(prims(e))) return true
  if (e.type === 'dim') return dimGeom(e).texts.some((t) => textCorners(t.x, t.y, t.h, t.str, t.rot, t.align).pts.some((c) => boxHas(r, c)))
  return false
}

export const flatLoops = (loops) => loops.map((l) => vertsToPrims(l, true).flatMap((p) => flattenPrim(p, 0.02).slice(0, -1)))

/** Snap points by kind: { end, mid, cen, quad } (arrays of points). */
export function snapPoints(e) {
  const out = { end: [], mid: [], cen: [], quad: [] }
  const ps = prims(e)
  if (e.type === 'text') { out.end.push(pt(e.x, e.y)); return out }
  if (e.type === 'hatch') return out
  if (e.type === 'dim') { if (e.a) out.end.push(e.a, e.b); return out }
  for (const p of ps) {
    if (p.k === 's') { out.end.push(p.a, p.b); out.mid.push(mid(p.a, p.b)); continue }
    const closed = p.sw >= TAU - 1e-9
    if (!closed) { const [a, b] = primEnds(p); out.end.push(a, b); out.mid.push(primMid(p)) }
    out.cen.push(p.c)
    if (e.type !== 'polyline') {
      if (p.k === 'a') for (let q = 0; q < 4; q++) { const s = norm(q * Math.PI / 2 - p.a0); if (s <= p.sw) out.quad.push(primPoint(p, s)) }
      else for (let q = 0; q < 4; q++) out.quad.push(primPoint({ ...p, t0: 0 }, q * Math.PI / 2))
    }
  }
  if (e.type === 'polyline') out.cen.length = 0
  if (e.type === 'polyline') for (const v of e.pts) out.end.push(pt(v.x, v.y))
  return out
}

/** { length, area? } of an entity, or null when it has neither (text, hatch). */
export function measure(e) {
  if (e.type === 'text' || e.type === 'dim') return null
  if (e.type === 'hatch') { let a = 0; e.loops.forEach((l, i) => { const x = Math.abs(loopArea(l).area); a += i === 0 ? x : -x }); return { area: Math.max(0, a) } }
  const length = prims(e).reduce((s, p) => s + primLength(p), 0)
  const r = { length }
  if (e.type === 'circle') r.area = Math.PI * e.r * e.r
  else if (e.type === 'ellipse' && prims(e)[0].sw >= TAU - 1e-9) r.area = Math.PI * Math.hypot(e.mx, e.my) * Math.hypot(e.mx, e.my) * e.ratio
  else if (e.type === 'polyline' && e.closed) r.area = Math.abs(loopArea(e.pts).area)
  return r
}

export function isClosed(e) {
  return e.type === 'circle' || (e.type === 'polyline' && e.closed) || (e.type === 'ellipse' && prims(e)[0].sw >= TAU - 1e-9)
}

/** Loops ({x,y,b} vertices) describing a closed entity, for hatching. */
export function entityLoops(e) {
  if (e.type === 'circle') return [{ x: e.cx + e.r, y: e.cy, b: 1 }, { x: e.cx - e.r, y: e.cy, b: 1 }]
  if (e.type === 'polyline' && e.closed) return e.pts.map((v) => ({ x: v.x, y: v.y, b: v.b || 0 }))
  if (e.type === 'ellipse' && prims(e)[0].sw >= TAU - 1e-9) return flattenPrim(prims(e)[0], 0.01).slice(0, -1).map((p) => ({ x: p.x, y: p.y, b: 0 }))
  return null
}

// ---------- Transform ----------
export function transform(e, t) {
  const P = (x, y) => t.p({ x, y })
  switch (e.type) {
    case 'line': { const a = P(e.x1, e.y1), b = P(e.x2, e.y2); return { ...e, x1: a.x, y1: a.y, x2: b.x, y2: b.y } }
    case 'circle': { const c = P(e.cx, e.cy); return { ...e, cx: c.x, cy: c.y, r: e.r * t.s } }
    case 'arc': {
      const c = P(e.cx, e.cy)
      const a0 = t.flip ? t.ang(e.a1) : t.ang(e.a0), a1 = t.flip ? t.ang(e.a0) : t.ang(e.a1)
      return { ...e, cx: c.x, cy: c.y, r: e.r * t.s, a0: norm(a0), a1: norm(a1) }
    }
    case 'ellipse': {
      const c = P(e.cx, e.cy), m = tfVec(t, { x: e.mx, y: e.my })
      return t.flip ? { ...e, cx: c.x, cy: c.y, mx: m.x, my: m.y, t0: -e.t1, t1: -e.t0 } : { ...e, cx: c.x, cy: c.y, mx: m.x, my: m.y }
    }
    case 'polyline': return { ...e, pts: e.pts.map((v) => { const q = P(v.x, v.y); return { x: q.x, y: q.y, b: t.flip ? -(v.b || 0) : v.b || 0 } }) }
    case 'text': { const q = P(e.x, e.y); return { ...e, x: q.x, y: q.y, h: e.h * t.s, rot: t.flip ? e.rot || 0 : t.ang(e.rot || 0) } }
    case 'hatch': {
      const ang = t.ang(e.angle * Math.PI / 180) * 180 / Math.PI
      return { ...e, scale: e.scale * t.s, angle: ang, loops: e.loops.map((l) => l.map((v) => { const q = P(v.x, v.y); return { x: q.x, y: q.y, b: t.flip ? -(v.b || 0) : v.b || 0 } })) }
    }
    case 'dim': {
      const T = (p) => t.p(p)
      const base = { ...e, th: e.th * t.s, as: (e.as ?? e.th) * t.s, loc: T(e.loc) }
      if (e.kind === 'linear' || e.kind === 'aligned') return { ...base, a: T(e.a), b: T(e.b), ang: t.ang(e.ang || 0) }
      if (e.kind === 'angular') return { ...base, v: T(e.v), a1: t.ang(e.a1), a2: t.ang(e.a2), q1: e.q1 && T(e.q1), q2: e.q2 && T(e.q2) }
      const c = P(e.cx, e.cy)
      return { ...base, cx: c.x, cy: c.y, r: e.r * t.s }
    }
    default: return e
  }
}

// ---------- Explode ----------
export const arrowPts = (tip, dir, L) => {
  const u = { x: Math.cos(dir), y: Math.sin(dir) }, n = perp(u)
  const base = sub(tip, mul(u, L))
  return [tip, add(base, mul(n, L / 6)), sub(base, mul(n, L / 6))]
}

/** Break a polyline into lines/arcs, or a dimension into lines, arcs, text and solid arrowheads. Returns new entities without ids. */
export function explode(e) {
  const keep = { layer: e.layer, color: e.color, ltype: e.ltype, lw: e.lw }
  const strip = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o }
  if (e.type === 'polyline') {
    const out = []
    const n = e.pts.length, last = e.closed ? n : n - 1
    for (let i = 0; i < last; i++) {
      const p1 = e.pts[i], p2 = e.pts[(i + 1) % n]
      const g = bulgeArc(p1, p2, p1.b)
      if (g) out.push(strip({ type: 'arc', ...keep, cx: g.c.x, cy: g.c.y, r: g.r, a0: g.a0, a1: norm(g.a0 + g.sw) }))
      else if (dist(p1, p2) > 1e-12) out.push(strip({ type: 'line', ...keep, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }))
    }
    return out
  }
  if (e.type === 'dim') {
    const g = dimGeom(e)
    const out = []
    for (const [a, b] of g.lines) out.push(strip({ type: 'line', ...keep, x1: a.x, y1: a.y, x2: b.x, y2: b.y }))
    for (const a of g.arcs) out.push(strip({ type: 'arc', ...keep, cx: a.c.x, cy: a.c.y, r: a.r, a0: a.a0, a1: norm(a.a0 + a.sw) }))
    for (const t of g.texts) out.push(strip({ type: 'text', ...keep, x: t.x, y: t.y, h: t.h, text: t.str, rot: t.rot, align: t.align }))
    for (const a of g.arrows) out.push(strip({ type: 'hatch', ...keep, pattern: 'solid', scale: 1, angle: 0, loops: [arrowPts(a.tip, a.dir, e.as ?? e.th).map((p) => ({ x: p.x, y: p.y, b: 0 }))] }))
    return out
  }
  return [e]
}

