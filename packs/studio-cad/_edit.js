// Modify operations for CAD Studio: trim, extend, offset, fillet, chamfer and hatch helpers. Pure functions, no DOM.
// They take entities and return new entities (without ids); the caller commits them to the document.
import {
  TAU, pt, dist, sub, add, mul, dot, cross, len, unit, perp, angle, norm, clamp, mid, primEnd, primClosed, primPoint, primNearest, onPrim, intersectPrims, bulgeArc, bulgeFor, S,
} from './_vec.js'
import { prims, isClosed, entityLoops, flatLoops, measure } from './_ent.js'

const err = (m) => Object.assign(new Error(m), { userMessage: m })

// ---------- Trim ----------
/** Trim e at the cutting edges near pick point q. Returns the replacement entities (possibly none), or null when nothing was cut. */
export function trimEntity(e, q, cutters) {
  if (!['line', 'arc', 'circle', 'ellipse'].includes(e.type)) return null
  const p = prims(e)[0]
  const closed = primClosed(p)
  const end = primEnd(p)
  let cuts = []
  for (const c of cutters) {
    if (c === e || c.id === e.id) continue
    for (const pc of prims(c)) {
      for (const r of intersectPrims(p, pc)) {
        if (!onPrim(pc, r.sq)) continue
        let s = r.sp
        if (p.k === 's') { if (s < -1e-9 || s > 1 + 1e-9) continue; s = clamp(s, 0, 1) }
        else if (!closed) { if (!onPrim(p, s)) continue; if (s >= TAU - 1e-7) s = 0; if (s > p.sw) s = p.sw }
        cuts.push(s)
      }
    }
  }
  cuts.sort((a, b) => a - b)
  const eps = 1e-9 * Math.max(1, end)
  cuts = cuts.filter((s, i) => i === 0 || s - cuts[i - 1] > eps)
  const sq = primNearest(p, q).s
  if (!closed) {
    let lo = null, hi = null
    for (const s of cuts) { if (s < sq) lo = s; else if (hi === null) hi = s }
    if (lo === null && hi === null) return null
    const pieces = []
    if (lo !== null && lo > eps) pieces.push([0, lo])
    if (hi !== null && hi < end - eps) pieces.push([hi, end])
    return pieces.map(([s0, s1]) => piece(e, p, s0, s1))
  }
  if (cuts.length < 2) return null
  let lo = null, hi = null
  for (const s of cuts) { if (s < sq) lo = s; else if (hi === null) hi = s }
  if (lo === null) lo = cuts[cuts.length - 1]
  if (hi === null) hi = cuts[0]
  if (e.type === 'ellipse') return [{ ...e, t0: e.t0 + hi, t1: e.t0 + lo }]
  return [{ ...e, type: 'arc', cx: e.cx, cy: e.cy, r: e.r, a0: norm(hi), a1: norm(lo) }]
}

function piece(e, p, s0, s1) {
  if (e.type === 'line') { const a = primPoint(p, s0), b = primPoint(p, s1); return { ...e, x1: a.x, y1: a.y, x2: b.x, y2: b.y } }
  if (e.type === 'arc') return { ...e, a0: norm(p.a0 + s0), a1: norm(p.a0 + s1) }
  return { ...e, t0: e.t0 + s0, t1: e.t0 + s1 }
}

// ---------- Extend ----------
/** Extend the end of e nearest q to the next boundary. Returns the new entity, or null when no boundary is in the way. */
export function extendEntity(e, q, bounds) {
  if (e.type === 'polyline') return extendPolyline(e, q, bounds)
  if (!['line', 'arc', 'ellipse'].includes(e.type)) return null
  const p = prims(e)[0]
  if (primClosed(p)) return null
  const end = primEnd(p)
  const atEnd = primNearest(p, q).s > end / 2
  let best = null
  for (const c of bounds) {
    if (c === e || c.id === e.id) continue
    for (const pc of prims(c)) {
      for (const r of intersectPrims(p, pc)) {
        if (!onPrim(pc, r.sq)) continue
        let d
        if (p.k === 's') { if (atEnd ? r.sp <= 1 + 1e-7 : r.sp >= -1e-7) continue; d = atEnd ? r.sp - 1 : -r.sp }
        else { if (r.sp <= p.sw + 1e-7) continue; d = atEnd ? r.sp - p.sw : TAU - r.sp }
        if (!best || d < best.d) best = { d, pt: r.pt }
      }
    }
  }
  if (!best) return null
  if (e.type === 'line') return atEnd ? { ...e, x2: best.pt.x, y2: best.pt.y } : { ...e, x1: best.pt.x, y1: best.pt.y }
  if (p.sw + best.d >= TAU) return null
  if (e.type === 'arc') return atEnd ? { ...e, a1: norm(p.a0 + p.sw + best.d) } : { ...e, a0: norm(p.a0 - best.d) }
  return atEnd ? { ...e, t1: e.t0 + p.sw + best.d } : { ...e, t0: e.t0 - best.d }
}

function extendPolyline(e, q, bounds) {
  if (e.closed || e.pts.length < 2) return null
  const n = e.pts.length
  const first = dist(q, e.pts[0]) < dist(q, e.pts[n - 1])
  const i = first ? 0 : n - 1, j = first ? 1 : n - 2
  const a = e.pts[j], b = e.pts[i]
  if ((first ? e.pts[0].b : e.pts[n - 2].b)) return null
  const ln = { type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y }
  const out = extendEntity(ln, b, bounds)
  if (!out) return null
  const pts = e.pts.map((v) => ({ ...v }))
  pts[i] = { ...pts[i], x: out.x2, y: out.y2 }
  return { ...e, pts }
}

// ---------- Offset ----------
/** Offset e by distance d toward the side of sidePt. Returns one new entity. Throws a readable error when it cannot. */
export function offsetEntity(e, d, sidePt) {
  if (!(d > 0)) throw err('Offset distance must be greater than zero.')
  if (e.type === 'line') {
    const a = pt(e.x1, e.y1), b = pt(e.x2, e.y2)
    const n = perp(unit(sub(b, a)))
    const s = dot(sub(sidePt, a), n) >= 0 ? 1 : -1
    return { ...e, x1: a.x + n.x * d * s, y1: a.y + n.y * d * s, x2: b.x + n.x * d * s, y2: b.y + n.y * d * s }
  }
  if (e.type === 'circle' || e.type === 'arc') {
    const outside = dist(pt(e.cx, e.cy), sidePt) > e.r
    const r = outside ? e.r + d : e.r - d
    if (r <= 1e-9) throw err('That offset distance would collapse the object. Use a smaller distance.')
    return { ...e, r }
  }
  if (e.type === 'polyline') return offsetPolyline(e, d, sidePt)
  throw err(e.type === 'ellipse' ? 'Offset does not work on ellipses. Draw a second ellipse instead.' : 'Only lines, arcs, circles and polylines can be offset.')
}

function offsetPolyline(e, d, sidePt) {
  const n = e.pts.length, m = e.closed ? n : n - 1
  if (m < 1) throw err('This polyline has no segments to offset.')
  const segs = []
  for (let i = 0; i < m; i++) {
    const p1 = e.pts[i], p2 = e.pts[(i + 1) % n]
    segs.push({ p1, p2, g: bulgeArc(p1, p2, p1.b) })
  }
  // which side is the pick on, relative to the direction of travel
  let best = null
  for (const s of segs) {
    const pr = s.g ? { k: 'a', c: s.g.c, r: s.g.r, a0: s.g.a0, sw: s.g.sw } : S(s.p1, s.p2)
    const nr = primNearest(pr, sidePt)
    if (!best || nr.d < best.d) best = { d: nr.d, s, nr }
  }
  const sg = best.s
  let left
  if (sg.g) left = sg.g.ccw ? dist(sg.g.c, sidePt) < sg.g.r : dist(sg.g.c, sidePt) > sg.g.r
  else left = cross(sub(sg.p2, sg.p1), sub(sidePt, sg.p1)) > 0
  const ds = left ? d : -d
  const offs = segs.map((s) => {
    if (!s.g) {
      const nv = perp(unit(sub(s.p2, s.p1)))
      const q1 = add(s.p1, mul(nv, ds)), q2 = add(s.p2, mul(nv, ds))
      return { q1, q2, prim: S(q1, q2), g: null }
    }
    const r2 = s.g.ccw ? s.g.r - ds : s.g.r + ds
    if (r2 <= 1e-9) throw err('That offset distance would collapse an arc segment. Use a smaller distance.')
    const k = r2 / s.g.r
    const q1 = add(s.g.c, mul(sub(s.p1, s.g.c), k)), q2 = add(s.g.c, mul(sub(s.p2, s.g.c), k))
    return { q1, q2, prim: { k: 'a', c: s.g.c, r: r2, a0: 0, sw: TAU }, g: s.g }
  })
  const join = (A, B) => {
    const ref = mid(A.q2, B.q1)
    if (dist(A.q2, B.q1) < 1e-9 * (1 + len(ref))) return A.q2
    const hits = intersectPrims(A.prim, B.prim)
    if (!hits.length) return ref
    return hits.reduce((bst, h) => (dist(h.pt, ref) < dist(bst.pt, ref) ? h : bst)).pt
  }
  const V = []
  for (let i = 0; i < n; i++) {
    if (!e.closed && i === 0) V.push(offs[0].q1)
    else if (!e.closed && i === n - 1) V.push(offs[m - 1].q2)
    else V.push(join(offs[(i - 1 + m) % m], offs[i % m]))
  }
  const pts = V.map((v, i) => {
    const sgm = i < m ? segs[i] : null
    let b = 0
    if (sgm && sgm.g) b = bulgeFor(sgm.g.c, v, V[(i + 1) % n], sgm.g.ccw)
    return { x: v.x, y: v.y, b }
  })
  return { ...e, pts }
}

// ---------- Fillet and chamfer ----------
/** Fillet (radius r) or chamfer ({ d1, d2 }) two lines. Returns { l1, l2, arc | cut }. */
export function cornerLines(e1, q1, e2, q2, opts) {
  const A = { a: pt(e1.x1, e1.y1), b: pt(e1.x2, e1.y2) }, B = { a: pt(e2.x1, e2.y1), b: pt(e2.x2, e2.y2) }
  const hit = intersectPrims(S(A.a, A.b), S(B.a, B.b))[0]
  if (!hit) throw err('Those lines are parallel, so they have no corner to round.')
  const X = hit.pt
  const side = (L, q) => {
    const u = unit(sub(L.b, L.a))
    const sgn = dot(sub(q, X), u) >= 0 ? 1 : -1
    const dir = mul(u, sgn)
    const F = dot(sub(L.a, X), dir) > dot(sub(L.b, X), dir) ? L.a : L.b
    return { dir, F, room: dot(sub(F, X), dir) }
  }
  const s1 = side(A, q1), s2 = side(B, q2)
  const cosT = dot(s1.dir, s2.dir)
  if (Math.abs(cosT) > 1 - 1e-9) throw err('Those lines run along each other, so they have no corner to round.')
  const theta = Math.acos(clamp(cosT, -1, 1))
  let d1, d2
  if (opts.chamfer) { d1 = opts.d1; d2 = opts.d2 } else d1 = d2 = opts.r === 0 ? 0 : opts.r / Math.tan(theta / 2)
  if (d1 > s1.room + 1e-9 || d2 > s2.room + 1e-9) throw err(opts.chamfer ? 'The chamfer distance is longer than the line.' : 'The radius is too large for these lines. Use a smaller radius.')
  const T1 = add(X, mul(s1.dir, d1)), T2 = add(X, mul(s2.dir, d2))
  const l1 = { ...e1, x1: s1.F.x, y1: s1.F.y, x2: T1.x, y2: T1.y }
  const l2 = { ...e2, x1: s2.F.x, y1: s2.F.y, x2: T2.x, y2: T2.y }
  const keep = { layer: e1.layer, color: e1.color, ltype: e1.ltype, lw: e1.lw }
  if (opts.chamfer) return { l1, l2, extra: d1 + d2 > 0 ? { type: 'line', ...keep, x1: T1.x, y1: T1.y, x2: T2.x, y2: T2.y } : null }
  if (opts.r === 0) return { l1, l2, extra: null }
  const C = add(X, mul(unit(add(s1.dir, s2.dir)), opts.r / Math.sin(theta / 2)))
  const ccw = cross(sub(T1, C), sub(T2, C)) > 0
  const a0 = ccw ? angle(C, T1) : angle(C, T2), a1 = ccw ? angle(C, T2) : angle(C, T1)
  return { l1, l2, extra: { type: 'arc', ...keep, cx: C.x, cy: C.y, r: opts.r, a0: norm(a0), a1: norm(a1) } }
}

/** Round every sharp corner of a polyline with radius r. Returns { entity, skipped }. */
export function filletPolyline(e, r) {
  const n = e.pts.length
  const pts = e.pts
  const lenOf = (i) => dist(pts[i], pts[(i + 1) % n])
  const cap = pts.map((_, i) => lenOf(i))
  const out = []
  let skipped = 0
  for (let i = 0; i < n; i++) {
    const v = pts[i]
    const interior = e.closed || (i > 0 && i < n - 1)
    const pi = (i - 1 + n) % n
    const straight = !pts[pi].b && !v.b
    if (!interior || !straight || r <= 0) { out.push({ x: v.x, y: v.y, b: v.b || 0 }); continue }
    const prev = pts[pi], next = pts[(i + 1) % n]
    const u1 = unit(sub(prev, v)), u2 = unit(sub(next, v))
    const cosT = dot(u1, u2)
    if (Math.abs(cosT) > 1 - 1e-9) { out.push({ x: v.x, y: v.y, b: v.b || 0 }); continue }
    const theta = Math.acos(clamp(cosT, -1, 1))
    const d = r / Math.tan(theta / 2)
    if (d > cap[pi] + 1e-9 || d > cap[i] + 1e-9) { skipped++; out.push({ x: v.x, y: v.y, b: v.b || 0 }); continue }
    cap[pi] -= d; cap[i] -= d
    const t1 = add(v, mul(u1, d)), t2 = add(v, mul(u2, d))
    const left = cross(sub(v, prev), sub(next, v)) > 0
    const b = Math.tan((Math.PI - theta) / 4) * (left ? 1 : -1)
    out.push({ x: t1.x, y: t1.y, b }, { x: t2.x, y: t2.y, b: 0 })
  }
  return { entity: { ...e, pts: out }, skipped }
}

// ---------- Hatch ----------
export const HATCH_PATTERNS = {
  solid: { name: 'Solid', lines: [] },
  ansi31: { name: 'Lines 45 (ANSI31)', lines: [{ ang: 45, step: 3 }] },
  ansi37: { name: 'Crosshatch 45 (ANSI37)', lines: [{ ang: 45, step: 3 }, { ang: 135, step: 3 }] },
  cross: { name: 'Grid (CROSS)', lines: [{ ang: 0, step: 3 }, { ang: 90, step: 3 }] },
  horiz: { name: 'Horizontal lines', lines: [{ ang: 0, step: 3 }] },
  vert: { name: 'Vertical lines', lines: [{ ang: 90, step: 3 }] },
}

/** The closed outline containing p (and the closed shapes inside it as islands), as loops for a hatch; null when p is not enclosed. */
export function hatchBoundaryAt(p, ents) {
  const closed = ents.filter(isClosed)
  const inside = (e, q) => { const f = flatLoops([entityLoops(e)]); let c = false; for (let i = 0, j = f[0].length - 1; i < f[0].length; j = i++) { const a = f[0][i], b = f[0][j]; if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c } return c }
  const containing = closed.filter((e) => inside(e, p))
  if (!containing.length) return null
  const area = (e) => measure(e)?.area ?? Infinity
  const outer = containing.reduce((a, b) => (area(b) < area(a) ? b : a))
  const islands = closed.filter((e) => e !== outer && !containing.includes(e) && inside(outer, primPoint(prims(e)[0], 0)))
  return [entityLoops(outer), ...islands.map(entityLoops)]
}

/** Unclipped hatch line segments covering the loops' bounding box (clip them to the loops when drawing). Returns null for solid fills. */
export function hatchSegments(h, box) {
  const pat = HATCH_PATTERNS[h.pattern] || HATCH_PATTERNS.ansi31
  if (!pat.lines.length) return null
  const out = []
  const corners = [pt(box.x0, box.y0), pt(box.x1, box.y0), pt(box.x1, box.y1), pt(box.x0, box.y1)]
  for (const L of pat.lines) {
    const th = ((L.ang + (h.angle || 0)) * Math.PI) / 180
    const u = { x: Math.cos(th), y: Math.sin(th) }, n = perp(u)
    let step = Math.max(1e-6, L.step * (h.scale || 1))
    const no = corners.map((c) => dot(c, n)), uo = corners.map((c) => dot(c, u))
    const n0 = Math.min(...no), n1 = Math.max(...no), u0 = Math.min(...uo) - 1, u1 = Math.max(...uo) + 1
    if ((n1 - n0) / step > 3000) step = (n1 - n0) / 3000
    for (let k = Math.ceil(n0 / step); k * step <= n1; k++) {
      const o = k * step
      out.push([add(mul(n, o), mul(u, u0)), add(mul(n, o), mul(u, u1))])
    }
  }
  return out
}


// ---------- Grips ----------
/** Edit handles for a selected entity: [{ x, y, mid, apply(q) -> new entity }]. Dragging a handle calls apply with the new point. */
export function gripsOf(e) {
  const g = []
  const G = (x, y, apply, isMid) => g.push({ x, y, apply, mid: !!isMid })
  const moveBy = (q, from) => ({ x: q.x - from.x, y: q.y - from.y })
  switch (e.type) {
    case 'line': {
      G(e.x1, e.y1, (q) => ({ ...e, x1: q.x, y1: q.y }))
      G(e.x2, e.y2, (q) => ({ ...e, x2: q.x, y2: q.y }))
      const m = pt((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2)
      G(m.x, m.y, (q) => { const d = moveBy(q, m); return { ...e, x1: e.x1 + d.x, y1: e.y1 + d.y, x2: e.x2 + d.x, y2: e.y2 + d.y } }, true)
      break
    }
    case 'circle': {
      const c = pt(e.cx, e.cy)
      G(c.x, c.y, (q) => ({ ...e, cx: q.x, cy: q.y }), true)
      for (let k = 0; k < 4; k++) G(e.cx + Math.cos(k * Math.PI / 2) * e.r, e.cy + Math.sin(k * Math.PI / 2) * e.r, (q) => ({ ...e, r: Math.max(1e-9, dist(c, q)) }))
      break
    }
    case 'arc': {
      const c = pt(e.cx, e.cy)
      G(c.x, c.y, (q) => ({ ...e, cx: q.x, cy: q.y }), true)
      G(e.cx + Math.cos(e.a0) * e.r, e.cy + Math.sin(e.a0) * e.r, (q) => ({ ...e, a0: norm(angle(c, q)) }))
      G(e.cx + Math.cos(e.a1) * e.r, e.cy + Math.sin(e.a1) * e.r, (q) => ({ ...e, a1: norm(angle(c, q)) }))
      const am = e.a0 + norm(e.a1 - e.a0) / 2
      G(e.cx + Math.cos(am) * e.r, e.cy + Math.sin(am) * e.r, (q) => ({ ...e, r: Math.max(1e-9, dist(c, q)) }), true)
      break
    }
    case 'ellipse': {
      const c = pt(e.cx, e.cy), m = pt(e.mx, e.my)
      G(c.x, c.y, (q) => ({ ...e, cx: q.x, cy: q.y }), true)
      G(c.x + m.x, c.y + m.y, (q) => ({ ...e, mx: q.x - c.x, my: q.y - c.y }))
      const n = perp(m)
      G(c.x + n.x * e.ratio, c.y + n.y * e.ratio, (q) => ({ ...e, ratio: clamp(dist(c, q) / Math.max(len(m), 1e-9), 0.001, 1) }))
      break
    }
    case 'polyline':
      e.pts.forEach((v, i) => G(v.x, v.y, (q) => ({ ...e, pts: e.pts.map((p, k) => (k === i ? { ...p, x: q.x, y: q.y } : p)) })))
      break
    case 'text': G(e.x, e.y, (q) => ({ ...e, x: q.x, y: q.y }), true); break
    case 'dim':
      if (e.kind === 'linear' || e.kind === 'aligned') {
        G(e.a.x, e.a.y, (q) => ({ ...e, a: pt(q.x, q.y) }))
        G(e.b.x, e.b.y, (q) => ({ ...e, b: pt(q.x, q.y) }))
      }
      G(e.loc.x, e.loc.y, (q) => ({ ...e, loc: pt(q.x, q.y) }), true)
      break
    default: break
  }
  return g
}
