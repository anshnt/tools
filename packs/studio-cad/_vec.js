// Pure 2D vector math and "primitives" (segment, arc, elliptical arc) for CAD Studio. No DOM.
// World space is Y-up. Angles are radians, counter-clockwise from +X.
//
// A primitive is one of:
//   { k: 's', a, b }                                 straight segment, parameter t in [0, 1]
//   { k: 'a', c, r, a0, sw }                         circular arc, CCW from a0 by sweep sw (TAU = full circle), parameter = angle offset in [0, sw]
//   { k: 'e', c, ax, ay, ratio, t0, sw }             elliptical arc, point(t) = c + ax cos t + ay sin t, parameter = t offset from t0 in [0, sw]
export const TAU = Math.PI * 2
export const D2R = Math.PI / 180
export const R2D = 180 / Math.PI
export const EPS = 1e-9

export const pt = (x, y) => ({ x, y })
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k })
export const dot = (a, b) => a.x * b.x + a.y * b.y
export const cross = (a, b) => a.x * b.y - a.y * b.x
export const len = (a) => Math.hypot(a.x, a.y)
export const unit = (a) => { const l = len(a); return l < EPS ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l } }
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
export const mid = (a, b) => lerp(a, b, 0.5)
export const perp = (a) => ({ x: -a.y, y: a.x })
export const polar = (c, ang, d) => ({ x: c.x + Math.cos(ang) * d, y: c.y + Math.sin(ang) * d })
/** Angle of the vector from a to b. */
export const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x)
/** Normalize to [0, TAU). */
export const norm = (a) => { a %= TAU; return a < 0 ? a + TAU : a }
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const same = (a, b, e = 1e-7) => Math.abs(a.x - b.x) <= e && Math.abs(a.y - b.y) <= e
/** Signed smallest difference a - b wrapped to (-PI, PI]. */
export const angDiff = (a, b) => { let d = norm(a - b); if (d > Math.PI) d -= TAU; return d }

export const emptyBox = () => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
export function growBox(b, p) {
  if (p.x < b.x0) b.x0 = p.x
  if (p.x > b.x1) b.x1 = p.x
  if (p.y < b.y0) b.y0 = p.y
  if (p.y > b.y1) b.y1 = p.y
  return b
}
export const unionBox = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })
export const boxValid = (b) => b && b.x0 <= b.x1 && b.y0 <= b.y1
export const boxHit = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0
export const boxInside = (inner, outer) => inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1
export const boxPad = (b, d) => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d })
export const boxHas = (b, p) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1

// ---------- Primitive constructors ----------
export const S = (a, b) => ({ k: 's', a, b })
export const A = (c, r, a0, sw) => ({ k: 'a', c, r, a0: norm(a0), sw })
export const E = (c, ax, ratio, t0, sw) => ({ k: 'e', c, ax, ay: mul(perp(ax), ratio), ratio, t0, sw })

export const primClosed = (p) => p.k !== 's' && p.sw >= TAU - 1e-9
export const primEnd = (p) => (p.k === 's' ? 1 : p.sw)

export function primPoint(p, s) {
  if (p.k === 's') return lerp(p.a, p.b, s)
  if (p.k === 'a') return polar(p.c, p.a0 + s, p.r)
  const t = p.t0 + s
  const co = Math.cos(t), si = Math.sin(t)
  return { x: p.c.x + p.ax.x * co + p.ay.x * si, y: p.c.y + p.ax.y * co + p.ay.y * si }
}
export const primEnds = (p) => [primPoint(p, 0), primPoint(p, primEnd(p))]
export const primMid = (p) => primPoint(p, primEnd(p) / 2)

export function primLength(p) {
  if (p.k === 's') return dist(p.a, p.b)
  if (p.k === 'a') return p.r * p.sw
  const pts = sample(p, 240)
  let l = 0
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i])
  return l
}

/** n+1 evenly spaced points along the primitive. */
export function sample(p, n) {
  const out = []
  const end = primEnd(p)
  for (let i = 0; i <= n; i++) out.push(primPoint(p, (end * i) / n))
  return out
}

/** Points for drawing or hit testing; adaptive for arcs. */
export function flattenPrim(p, tol = 0.02) {
  if (p.k === 's') return [p.a, p.b]
  const r = p.k === 'a' ? p.r : Math.max(len(p.ax), len(p.ay))
  const step = r > tol ? 2 * Math.acos(clamp(1 - tol / r, -1, 1)) : Math.PI / 2
  const n = clamp(Math.ceil(p.sw / Math.max(step, 0.02)), 4, 720)
  return sample(p, n)
}

export function primBBox(p) {
  const b = emptyBox()
  if (p.k === 's') { growBox(b, p.a); growBox(b, p.b); return b }
  if (p.k === 'a') {
    growBox(b, primPoint(p, 0)); growBox(b, primPoint(p, p.sw))
    for (let q = 0; q < 4; q++) {
      const s = norm(q * Math.PI / 2 - p.a0)
      if (s <= p.sw) growBox(b, primPoint(p, s))
    }
    return b
  }
  for (const q of sample(p, 96)) growBox(b, q)
  return b
}

/** Nearest point on a primitive: { pt, s, d } with s clamped to the primitive's domain. */
export function primNearest(p, q) {
  if (p.k === 's') {
    const ab = sub(p.b, p.a)
    const l2 = dot(ab, ab)
    const s = l2 < EPS ? 0 : clamp(dot(sub(q, p.a), ab) / l2, 0, 1)
    const r = lerp(p.a, p.b, s)
    return { pt: r, s, d: dist(r, q) }
  }
  if (p.k === 'a') {
    const ang = angle(p.c, q)
    let s = norm(ang - p.a0)
    if (s > p.sw) s = (s - p.sw < TAU - s) ? p.sw : 0
    const r = primPoint(p, s)
    return { pt: r, s, d: dist(r, q) }
  }
  const end = p.sw
  let bs = 0, bd = Infinity
  const N = 96
  for (let i = 0; i <= N; i++) {
    const s = (end * i) / N
    const d = dist(primPoint(p, s), q)
    if (d < bd) { bd = d; bs = s }
  }
  let lo = Math.max(0, bs - end / N), hi = Math.min(end, bs + end / N)
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
    if (dist(primPoint(p, m1), q) < dist(primPoint(p, m2), q)) hi = m2
    else lo = m1
  }
  const s = (lo + hi) / 2
  const r = primPoint(p, s)
  return { pt: r, s, d: dist(r, q) }
}

/** Is parameter s (as returned by intersectPrims) inside the primitive's own extent? */
export function onPrim(p, s, tol = 1e-7) {
  if (p.k === 's') return s >= -tol && s <= 1 + tol
  return s <= p.sw + tol || s >= TAU - tol
}

/** The sub-primitive covering parameters [s0, s1]. */
export function primSub(p, s0, s1) {
  if (p.k === 's') return S(lerp(p.a, p.b, s0), lerp(p.a, p.b, s1))
  if (p.k === 'a') return { ...p, a0: norm(p.a0 + s0), sw: s1 - s0 }
  return { ...p, t0: p.t0 + s0, sw: s1 - s0 }
}

// ---------- Intersections ----------
// Each result is { pt, sp, sq }. For segments the parameter is the unbounded t of the infinite line;
// for arcs and ellipses it is the offset angle in [0, TAU) of the full circle/ellipse. Check onPrim() to test the real extent.
export function intersectPrims(p, q) {
  if (p.k === 's' && q.k === 's') return segSeg(p, q)
  if (p.k === 's' && q.k === 'a') return segArc(p, q)
  if (p.k === 'a' && q.k === 's') return segArc(q, p).map((r) => ({ pt: r.pt, sp: r.sq, sq: r.sp }))
  if (p.k === 'a' && q.k === 'a') return arcArc(p, q)
  if (p.k === 's' && q.k === 'e') return segEll(p, q)
  if (p.k === 'e' && q.k === 's') return segEll(q, p).map((r) => ({ pt: r.pt, sp: r.sq, sq: r.sp }))
  return numeric(p, q)
}

function segSeg(p, q) {
  const r = sub(p.b, p.a), s = sub(q.b, q.a)
  const den = cross(r, s)
  const scale = len(r) * len(s)
  if (scale < EPS || Math.abs(den) < 1e-12 * scale) return []
  const qp = sub(q.a, p.a)
  const t = cross(qp, s) / den
  const u = cross(qp, r) / den
  return [{ pt: { x: p.a.x + r.x * t, y: p.a.y + r.y * t }, sp: t, sq: u }]
}

function segArc(sg, ar) {
  const d = sub(sg.b, sg.a)
  const f = sub(sg.a, ar.c)
  const a = dot(d, d)
  if (a < EPS) return []
  const b = 2 * dot(f, d)
  const c = dot(f, f) - ar.r * ar.r
  let disc = b * b - 4 * a * c
  const tolDisc = 1e-9 * (b * b + Math.abs(4 * a * c)) + 1e-12
  if (disc < -tolDisc) return []
  if (disc < 0) disc = 0
  const sq = Math.sqrt(disc)
  const ts = sq < 1e-9 ? [-b / (2 * a)] : [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]
  return ts.map((t) => {
    const point = { x: sg.a.x + d.x * t, y: sg.a.y + d.y * t }
    return { pt: point, sp: t, sq: norm(angle(ar.c, point) - ar.a0) }
  })
}

function arcArc(p, q) {
  const dv = sub(q.c, p.c)
  const d = len(dv)
  if (d < EPS) return []
  if (d > p.r + q.r + 1e-9 || d < Math.abs(p.r - q.r) - 1e-9) return []
  const a = (p.r * p.r - q.r * q.r + d * d) / (2 * d)
  let h2 = p.r * p.r - a * a
  if (h2 < 0) h2 = 0
  const h = Math.sqrt(h2)
  const u = { x: dv.x / d, y: dv.y / d }
  const base = { x: p.c.x + u.x * a, y: p.c.y + u.y * a }
  const pts = h < 1e-9 ? [base] : [{ x: base.x - u.y * h, y: base.y + u.x * h }, { x: base.x + u.y * h, y: base.y - u.x * h }]
  return pts.map((point) => ({ pt: point, sp: norm(angle(p.c, point) - p.a0), sq: norm(angle(q.c, point) - q.a0) }))
}

// Segment vs ellipse: map to the unit circle where the ellipse is exact.
function segEll(sg, el) {
  const ax2 = dot(el.ax, el.ax), ay2 = dot(el.ay, el.ay)
  if (ax2 < EPS || ay2 < EPS) return []
  const toLocal = (P) => { const d = sub(P, el.c); return { x: dot(d, el.ax) / ax2, y: dot(d, el.ay) / ay2 } }
  const A0 = toLocal(sg.a), B0 = toLocal(sg.b)
  const d = sub(B0, A0)
  const a = dot(d, d)
  if (a < EPS * EPS) return []
  const b = 2 * dot(A0, d)
  const c = dot(A0, A0) - 1
  let disc = b * b - 4 * a * c
  if (disc < -1e-12) return []
  if (disc < 0) disc = 0
  const sq = Math.sqrt(disc)
  const ts = sq < 1e-9 ? [-b / (2 * a)] : [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]
  return ts.map((t) => {
    const u = A0.x + d.x * t, v = A0.y + d.y * t
    return { pt: lerp(sg.a, sg.b, t), sp: t, sq: norm(Math.atan2(v, u) - el.t0) }
  })
}

// Fallback for ellipse vs arc/ellipse: sample, intersect polylines, then refine by alternating projections.
function offsetOf(p, x) {
  if (p.k === 'a') return norm(angle(p.c, x) - p.a0)
  const d = sub(x, p.c)
  return norm(Math.atan2(dot(d, p.ay) / dot(p.ay, p.ay), dot(d, p.ax) / dot(p.ax, p.ax)) - p.t0)
}
function numeric(p, q) {
  const fp = { ...p, sw: TAU }, fq = { ...q, sw: TAU }
  const pa = sample(fp, 180), pb = sample(fq, 180)
  const out = []
  for (let i = 0; i < pa.length - 1; i++) {
    for (let j = 0; j < pb.length - 1; j++) {
      const r = segSeg(S(pa[i], pa[i + 1]), S(pb[j], pb[j + 1]))[0]
      if (!r || r.sp < 0 || r.sp > 1 || r.sq < 0 || r.sq > 1) continue
      let x = r.pt
      for (let k = 0; k < 8; k++) x = mid(primNearest(fp, x).pt, primNearest(fq, x).pt)
      if (out.some((o) => dist(o, x) < 1e-6 * (1 + len(x)))) continue
      out.push(x)
    }
  }
  return out.map((x) => ({ pt: x, sp: offsetOf(p, x), sq: offsetOf(q, x) }))
}

// ---------- Transforms (similarity: move, rotate, uniform scale, mirror) ----------
const mk = (p, ang, s, flip) => ({ p, ang, s, flip })
export const Tf = {
  move: (dx, dy) => mk((q) => ({ x: q.x + dx, y: q.y + dy }), (a) => a, 1, false),
  rotate: (c, a) => {
    const co = Math.cos(a), si = Math.sin(a)
    return mk((q) => ({ x: c.x + (q.x - c.x) * co - (q.y - c.y) * si, y: c.y + (q.x - c.x) * si + (q.y - c.y) * co }), (x) => x + a, 1, false)
  },
  scale: (c, k) => mk((q) => ({ x: c.x + (q.x - c.x) * k, y: c.y + (q.y - c.y) * k }), (a) => a, k, false),
  /** Reflect across the line through a and b. */
  mirror: (a, b) => {
    const m = angle(a, b)
    const co = Math.cos(2 * m), si = Math.sin(2 * m)
    return mk((q) => {
      const dx = q.x - a.x, dy = q.y - a.y
      return { x: a.x + dx * co + dy * si, y: a.y + dx * si - dy * co }
    }, (x) => 2 * m - x, 1, true)
  },
}
/** Apply t1 first, then t2. */
Tf.compose = (t1, t2) => mk((q) => t2.p(t1.p(q)), (a) => t2.ang(t1.ang(a)), t1.s * t2.s, t1.flip !== t2.flip)
/** Transform a vector (direction and size, not a position). */
export const tfVec = (t, v) => { const o = t.p({ x: 0, y: 0 }); const q = t.p(v); return { x: q.x - o.x, y: q.y - o.y } }

// ---------- Polyline segments with bulge ----------
/** Geometry of the segment p1 -> p2 with bulge b: { c, r, a0, sw, ccw, theta } or null when straight. a0/sw describe the CCW arc. */
export function bulgeArc(p1, p2, b) {
  if (!b || Math.abs(b) < 1e-12) return null
  const chord = dist(p1, p2)
  if (chord < EPS) return null
  const theta = 4 * Math.atan(b)
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2))
  const m = mid(p1, p2)
  const n = perp(unit(sub(p2, p1)))
  const off = Math.sign(b) * r * Math.cos(Math.abs(theta) / 2)
  const c = { x: m.x + n.x * off, y: m.y + n.y * off }
  const aStart = angle(c, p1), aEnd = angle(c, p2)
  return b > 0
    ? { c, r, a0: norm(aStart), sw: Math.abs(theta), ccw: true, theta }
    : { c, r, a0: norm(aEnd), sw: Math.abs(theta), ccw: false, theta }
}
/** Bulge for an arc from p1 to p2 around centre c, going CCW (ccw true) or CW. */
export function bulgeFor(c, p1, p2, ccw) {
  const a1 = angle(c, p1), a2 = angle(c, p2)
  const sw = ccw ? norm(a2 - a1) : norm(a1 - a2)
  const b = Math.tan(sw / 4)
  return ccw ? b : -b
}

/** Signed area and perimeter of a closed run of { x, y, b } vertices (arcs included). */
export function loopArea(pts) {
  let a = 0, per = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n]
    a += cross(p1, p2) / 2
    const g = bulgeArc(p1, p2, p1.b)
    if (g) { a += (g.r * g.r / 2) * (g.theta - Math.sin(g.theta)); per += g.r * g.sw } else per += dist(p1, p2)
  }
  return { area: a, perimeter: per }
}

/** Polyline vertices to primitives (open runs have n-1 segments, closed have n). */
export function vertsToPrims(pts, closed) {
  const out = []
  const n = pts.length
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n]
    if (same(p1, p2, 1e-12)) continue
    const g = bulgeArc(p1, p2, p1.b)
    out.push(g ? A(g.c, g.r, g.a0, g.sw) : S({ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }))
  }
  return out
}

/** Even-odd point in polygon for flattened loops (arrays of points). */
export function inLoops(loops, p) {
  let inside = false
  for (const pts of loops) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j]
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    }
  }
  return inside
}

/** Do segment pq and rectangle r (x0..y1) touch? */
export function segHitsBox(p, q, r) {
  if (boxHas(r, p) || boxHas(r, q)) return true
  const edges = [[{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }], [{ x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }], [{ x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }], [{ x: r.x0, y: r.y1 }, { x: r.x0, y: r.y0 }]]
  return edges.some(([a, b]) => { const h = segSeg(S(p, q), S(a, b))[0]; return h && h.sp >= 0 && h.sp <= 1 && h.sq >= 0 && h.sq <= 1 })
}
