// Geometry helpers for Vector Studio: affine matrices, bezier paths, SVG path parsing, shape generators, simplification.
// A path point is {x, y, ix, iy, ox, oy}: the anchor plus its in and out handles as offsets from the anchor (0 = no handle).
// A sub-path is {pts: [point], closed: bool}; a path node holds several sub-paths (so holes and compound shapes work).

export const I = [1, 0, 0, 1, 0, 0]
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
export function inv(m) {
  const d = m[0] * m[3] - m[1] * m[2]
  if (!d) return I
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]
}
export const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
export const lin = (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y]
export const tr = (x, y) => [1, 0, 0, 1, x, y]
export const sc = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0]
export const rot = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0] }
/** Apply linear map m about the pivot (px, py). */
export const about = (m, px, py) => mul(tr(px, py), mul(m, tr(-px, -py)))
export const isIdent = (m) => !m || (Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[4]) < 1e-9 && Math.abs(m[5]) < 1e-9)
export const det = (m) => m[0] * m[3] - m[1] * m[2]
export const DEG = Math.PI / 180
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const round = (v, p = 1000) => Math.round(v * p) / p

export const P = (x, y, ix = 0, iy = 0, ox = 0, oy = 0) => ({ x, y, ix, iy, ox, oy })
export const hasIn = (p) => Math.abs(p.ix) > 1e-9 || Math.abs(p.iy) > 1e-9
export const hasOut = (p) => Math.abs(p.ox) > 1e-9 || Math.abs(p.oy) > 1e-9
export const cloneSubs = (subs) => subs.map((s) => ({ closed: s.closed, pts: s.pts.map((p) => ({ ...p })) }))

export function transformSubs(subs, m) {
  return subs.map((s) => ({
    closed: s.closed,
    pts: s.pts.map((p) => {
      const [x, y] = ap(m, p.x, p.y), [ix, iy] = lin(m, p.ix, p.iy), [ox, oy] = lin(m, p.ox, p.oy)
      return { x, y, ix, iy, ox, oy }
    }),
  }))
}

/** Segments of a sub-path as cubic control tuples [x0,y0,x1,y1,x2,y2,x3,y3]; line segments are returned as degenerate cubics. */
export function segments(sub) {
  const out = [], n = sub.pts.length
  const cnt = sub.closed ? n : n - 1
  for (let i = 0; i < cnt; i++) {
    const a = sub.pts[i], b = sub.pts[(i + 1) % n]
    out.push([a.x, a.y, a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y])
  }
  return out
}
export const segIsLine = (a, b) => !hasOut(a) && !hasIn(b)

const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d }
export const bezPoint = (s, t) => [bez(s[0], s[2], s[4], s[6], t), bez(s[1], s[3], s[5], s[7], t)]

function extrema(a, b, c, d) {
  const A = 3 * b - a - 3 * c + d, B = 2 * (a - 2 * b + c), C = b - a, out = []
  if (Math.abs(A) < 1e-12) { if (Math.abs(B) > 1e-12) out.push(-C / B) } else {
    const D = B * B - 4 * A * C
    if (D >= 0) { const q = Math.sqrt(D); out.push((-B + q) / (2 * A), (-B - q) / (2 * A)) }
  }
  return out.filter((t) => t > 0 && t < 1)
}

/** Tight bounding box of sub-paths: {x, y, w, h} or null when empty. */
export function subsBBox(subs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  for (const sub of subs) {
    for (const p of sub.pts) add(p.x, p.y)
    for (const s of segments(sub)) {
      for (const t of extrema(s[0], s[2], s[4], s[6])) add(bez(s[0], s[2], s[4], s[6], t), bez(s[1], s[3], s[5], s[7], t))
      for (const t of extrema(s[1], s[3], s[5], s[7])) add(bez(s[0], s[2], s[4], s[6], t), bez(s[1], s[3], s[5], s[7], t))
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// ---------- Path data ----------
const f = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r) }

export function subToD(sub) {
  const pts = sub.pts
  if (!pts.length) return ''
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`
  const n = pts.length, cnt = sub.closed ? n : n - 1
  for (let i = 0; i < cnt; i++) {
    const a = pts[i], b = pts[(i + 1) % n]
    if (segIsLine(a, b)) { if (!(sub.closed && i === n - 1)) d += `L${f(b.x)} ${f(b.y)}` } else d += `C${f(a.x + a.ox)} ${f(a.y + a.oy)} ${f(b.x + b.ix)} ${f(b.y + b.iy)} ${f(b.x)} ${f(b.y)}`
  }
  return d + (sub.closed ? 'Z' : '')
}
export const subsToD = (subs) => subs.map(subToD).join('')

function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (!rx || !ry) return null
  const phi = phiDeg * DEG, c = Math.cos(phi), s = Math.sin(phi)
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
  const x1p = c * dx + s * dy, y1p = -s * dx + c * dy
  rx = Math.abs(rx); ry = Math.abs(ry)
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  let co = Math.sqrt(Math.max(0, num / (den || 1)))
  if (fa === fs) co = -co
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx
  const cx = c * cxp - s * cyp + (x1 + x2) / 2, cy = s * cxp + c * cyp + (y1 + y2) / 2
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!fs && dth > 0) dth -= 2 * Math.PI
  else if (fs && dth < 0) dth += 2 * Math.PI
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9)), d = dth / segs, t = (4 / 3) * Math.tan(d / 4)
  const out = []
  let a = th1
  const map = (u, v) => [c * rx * u - s * ry * v + cx, s * rx * u + c * ry * v + cy]
  for (let k = 0; k < segs; k++) {
    const a2 = a + d
    const c1 = [Math.cos(a) - t * Math.sin(a), Math.sin(a) + t * Math.cos(a)]
    const c2 = [Math.cos(a2) + t * Math.sin(a2), Math.sin(a2) - t * Math.cos(a2)]
    out.push([...map(...c1), ...map(...c2), ...map(Math.cos(a2), Math.sin(a2))])
    a = a2
  }
  return out
}

/** Parse SVG path data into sub-paths with absolute coordinates (arcs and quadratics become cubics). */
export function parseD(str) {
  const s = String(str || ''), n = s.length
  const NUM = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y
  let i = 0
  const subs = []
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0, lastC = null, lastQ = null, cmd = ''
  const ws = () => { while (i < n && /[\s,]/.test(s[i])) i++ }
  const num = () => { ws(); NUM.lastIndex = i; const m = NUM.exec(s); if (!m) throw new Error('bad path'); i = NUM.lastIndex; return parseFloat(m[0]) }
  const flag = () => { ws(); const ch = s[i]; if (ch !== '0' && ch !== '1') throw new Error('bad path'); i++; return ch === '1' }
  const begin = () => { if (!cur) { cur = { pts: [P(cx, cy)], closed: false }; subs.push(cur) } }
  const lineTo = (x, y) => { begin(); cur.pts.push(P(x, y)); cx = x; cy = y }
  const curveTo = (x1, y1, x2, y2, x, y) => {
    begin()
    const prev = cur.pts[cur.pts.length - 1]
    prev.ox = x1 - prev.x; prev.oy = y1 - prev.y
    cur.pts.push(P(x, y, x2 - x, y2 - y))
    lastC = [x2, y2]; cx = x; cy = y
  }
  try {
    while (true) {
      ws()
      if (i >= n) break
      const ch = s[i]
      if (/[A-Za-z]/.test(ch)) { cmd = ch; i++ } else if (!cmd) break
      else if (cmd === 'M') cmd = 'L'
      else if (cmd === 'm') cmd = 'l'
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()
      const ox = rel ? cx : 0, oy = rel ? cy : 0
      const prevC = lastC, prevQ = lastQ
      lastC = null; lastQ = null
      if (C === 'Z') { if (cur) { cur.closed = true; const first = cur.pts[0], last = cur.pts[cur.pts.length - 1]; if (cur.pts.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) { first.ix = last.ix; first.iy = last.iy; cur.pts.pop() } } cur = null; cx = sx; cy = sy; continue }
      if (C === 'M') {
        const x = num() + ox, y = num() + oy
        cur = { pts: [P(x, y)], closed: false }; subs.push(cur); cx = sx = x; cy = sy = y
      } else if (C === 'L') lineTo(num() + ox, num() + oy)
      else if (C === 'H') lineTo(num() + ox, cy)
      else if (C === 'V') lineTo(cx, num() + oy)
      else if (C === 'C') { const a = num() + ox, b = num() + oy, c = num() + ox, d = num() + oy, x = num() + ox, y = num() + oy; curveTo(a, b, c, d, x, y) }
      else if (C === 'S') {
        const c = num() + ox, d = num() + oy, x = num() + ox, y = num() + oy
        const r = prevC ? [2 * cx - prevC[0], 2 * cy - prevC[1]] : [cx, cy]
        curveTo(r[0], r[1], c, d, x, y)
      } else if (C === 'Q' || C === 'T') {
        let qx, qy
        if (C === 'Q') { qx = num() + ox; qy = num() + oy } else if (prevQ) { qx = 2 * cx - prevQ[0]; qy = 2 * cy - prevQ[1] } else { qx = cx; qy = cy }
        const x = num() + ox, y = num() + oy
        curveTo(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y)
        lastQ = [qx, qy]; lastC = null
      } else if (C === 'A') {
        const rx = num(), ry = num(), phi = num(), fa = flag(), fs = flag(), x = num() + ox, y = num() + oy
        const cubics = arcToCubics(cx, cy, rx, ry, phi, fa, fs, x, y)
        if (!cubics) lineTo(x, y)
        else for (const c of cubics) curveTo(...c)
        lastC = null
      } else break
    }
  } catch { /* keep what parsed so far */ }
  return subs.filter((sub) => sub.pts.length > 1 || sub.closed)
}

// ---------- Shape generators (all return sub-paths) ----------
const K = 0.5522847498
export const ellipseSubs = (cx, cy, rx, ry) => [{ closed: true, pts: [
  P(cx, cy - ry, -K * rx, 0, K * rx, 0), P(cx + rx, cy, 0, -K * ry, 0, K * ry),
  P(cx, cy + ry, K * rx, 0, -K * rx, 0), P(cx - rx, cy, 0, K * ry, 0, -K * ry)] }]

export function rectSubs(x, y, w, h, rx = 0, ry = rx) {
  rx = Math.min(Math.abs(rx), Math.abs(w) / 2); ry = Math.min(Math.abs(ry), Math.abs(h) / 2)
  if (rx < 1e-9 || ry < 1e-9) return [{ closed: true, pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] }]
  return [{ closed: true, pts: [
    P(x + rx, y, -K * rx, 0), P(x + w - rx, y, 0, 0, K * rx, 0),
    P(x + w, y + ry, 0, -K * ry), P(x + w, y + h - ry, 0, 0, 0, K * ry),
    P(x + w - rx, y + h, K * rx, 0), P(x + rx, y + h, 0, 0, -K * rx, 0),
    P(x, y + h - ry, 0, K * ry), P(x, y + ry, 0, 0, 0, -K * ry)] }]
}

export function polygonSubs(cx, cy, r, n, rotation = -Math.PI / 2) {
  const pts = []
  for (let i = 0; i < n; i++) { const a = rotation + (i * 2 * Math.PI) / n; pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a))) }
  return [{ closed: true, pts }]
}
export function starSubs(cx, cy, r1, r2, n, rotation = -Math.PI / 2) {
  const pts = []
  for (let i = 0; i < n * 2; i++) { const a = rotation + (i * Math.PI) / n, r = i % 2 ? r2 : r1; pts.push(P(cx + r * Math.cos(a), cy + r * Math.sin(a))) }
  return [{ closed: true, pts }]
}
export const lineSubs = (x1, y1, x2, y2) => [{ closed: false, pts: [P(x1, y1), P(x2, y2)] }]

// ---------- Editing helpers ----------
const dseg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
  const t = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
export const distToSeg = dseg

/** Closest point on a sub-path: {seg, t, dist, x, y} (seg indexes the segment starting at anchor seg). */
export function nearestOnSub(sub, p) {
  let best = null
  segments(sub).forEach((s, i) => {
    let bt = 0, bd = Infinity
    for (let k = 0; k <= 48; k++) { const t = k / 48, [x, y] = bezPoint(s, t), d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; bt = t } }
    let lo = Math.max(0, bt - 1 / 48), hi = Math.min(1, bt + 1 / 48)
    for (let k = 0; k < 14; k++) {
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3
      const [x1, y1] = bezPoint(s, m1), [x2, y2] = bezPoint(s, m2)
      if (Math.hypot(x1 - p.x, y1 - p.y) < Math.hypot(x2 - p.x, y2 - p.y)) hi = m2; else lo = m1
    }
    const t = (lo + hi) / 2, [x, y] = bezPoint(s, t), d = Math.hypot(x - p.x, y - p.y)
    if (!best || d < best.dist) best = { seg: i, t, dist: d, x, y }
  })
  return best
}

/** Insert an anchor on segment `seg` at parameter t (de Casteljau). Returns the new anchor index. */
export function splitSegment(sub, seg, t) {
  const n = sub.pts.length, a = sub.pts[seg], bi = (seg + 1) % n, b = sub.pts[bi]
  const line = segIsLine(a, b)
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [a.x, a.y, a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y]
  const L = (p, q) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)]
  const A = L([x0, y0], [x1, y1]), B = L([x1, y1], [x2, y2]), C = L([x2, y2], [x3, y3]), AB = L(A, B), BC = L(B, C), M = L(AB, BC)
  const np = line ? P(M[0], M[1]) : P(M[0], M[1], AB[0] - M[0], AB[1] - M[1], BC[0] - M[0], BC[1] - M[1])
  if (!line) { a.ox = A[0] - a.x; a.oy = A[1] - a.y; b.ix = C[0] - b.x; b.iy = C[1] - b.y }
  const at = seg + 1
  sub.pts.splice(at, 0, np)
  return at
}

/** True when the anchor has two collinear opposite handles (a smooth point). */
export function isSmooth(p) {
  if (!hasIn(p) || !hasOut(p)) return false
  const li = Math.hypot(p.ix, p.iy), lo = Math.hypot(p.ox, p.oy)
  return Math.abs(p.ix * p.oy - p.iy * p.ox) / (li * lo) < 0.03 && p.ix * p.ox + p.iy * p.oy < 0
}

/** Make an anchor smooth: handles along the line between its neighbours, one third of the way to each. */
export function makeSmooth(sub, idx) {
  const n = sub.pts.length, p = sub.pts[idx]
  const prev = sub.pts[(idx - 1 + n) % n], next = sub.pts[(idx + 1) % n]
  const openStart = !sub.closed && idx === 0, openEnd = !sub.closed && idx === n - 1
  let tx = (openEnd ? p.x : next.x) - (openStart ? p.x : prev.x), ty = (openEnd ? p.y : next.y) - (openStart ? p.y : prev.y)
  const tl = Math.hypot(tx, ty) || 1
  tx /= tl; ty /= tl
  const lp = openStart ? 0 : Math.hypot(p.x - prev.x, p.y - prev.y) / 3
  const ln = openEnd ? 0 : Math.hypot(next.x - p.x, next.y - p.y) / 3
  p.ix = -tx * lp; p.iy = -ty * lp; p.ox = tx * ln; p.oy = ty * ln
}
export function makeCorner(p) { p.ix = p.iy = p.ox = p.oy = 0 }

// ---------- Freehand simplification ----------
export function rdp(pts, eps) {
  const n = pts.length
  if (n < 3) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let md = 0, mi = -1
    for (let i = a + 1; i < b; i++) { const d = dseg(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i } }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

/** Turn simplified points into a smooth bezier sub-path (corners are kept where the stroke turns sharply). */
export function fitSmooth(pts, closed = false) {
  const n = pts.length, out = pts.map((p) => P(p.x, p.y))
  if (n < 3) return { closed: false, pts: out }
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n]
    const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y)
    if (!l1 || !l2) continue
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2)
    if (cos < 0.45) continue // turn sharper than ~63 degrees: keep a corner
    let tx = v1x / l1 + v2x / l2, ty = v1y / l1 + v2y / l2
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl; ty /= tl
    out[i].ix = -tx * l1 / 3; out[i].iy = -ty * l1 / 3; out[i].ox = tx * l2 / 3; out[i].oy = ty * l2 / 3
  }
  return { closed, pts: out }
}

/** Reverse the direction of a sub-path. */
export function reverseSub(sub) {
  sub.pts.reverse()
  for (const p of sub.pts) { [p.ix, p.ox] = [p.ox, p.ix];[p.iy, p.oy] = [p.oy, p.iy] }
}
