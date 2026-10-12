// Draw Studio path helpers over contract path commands (['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z']). Pure (no DOM), so Node tests cover it.
//   sub-paths   [{closed, pts: [{x, y, ix, iy, ox, oy}]}]  anchor plus in and out handles as OFFSETS from the anchor (0 = no handle)
//   draft       {subs, nt}  what the Shape tool edits: nt[s][i] is 'c' cusp, 's' smooth or 'y' symmetrical for point i of sub-path s
// Node primitives mutate the draft they are given (the tool clones first with cloneDraft) and return what the tool needs (new picks or a count).
import { arcToCubics, ellipsePath, mapPath, rectPath } from './_model.js'
import { P, cloneSubs, fitSmooth, hasIn, hasOut, makeSmooth, polygonSubs, rdp, reverseSub as geomReverse, segIsLine, splitSegment, starSubs } from '../studio-vector/_geom.js'

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

// ---------- contract commands <-> sub-paths ----------
const EPS = 1e-6
const same = (a, b) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS
/** Path commands -> sub-paths. A closing curve back to the start is folded into the first point's in handle; open one-point sub-paths are dropped. */
export function dToSubs(d) {
  const subs = []
  let cur = null, sx = 0, sy = 0
  const need = () => { if (!cur) { cur = { closed: false, pts: [P(sx, sy)] }; subs.push(cur) } return cur }
  for (const c of d || []) {
    if (c[0] === 'M') { cur = { closed: false, pts: [P(c[1], c[2])] }; subs.push(cur); sx = c[1]; sy = c[2] }
    else if (c[0] === 'L') need().pts.push(P(c[1], c[2]))
    else if (c[0] === 'C') {
      const s = need(), prev = s.pts[s.pts.length - 1]
      prev.ox = c[1] - prev.x; prev.oy = c[2] - prev.y
      s.pts.push(P(c[5], c[6], c[3] - c[5], c[4] - c[6]))
    } else if (c[0] === 'Z' && cur) {
      cur.closed = true
      const f = cur.pts[0], l = cur.pts[cur.pts.length - 1]
      if (cur.pts.length > 1 && same(f, l)) { f.ix = l.ix; f.iy = l.iy; cur.pts.pop() }
      cur = null
    }
  }
  return subs.filter((s) => s.pts.length > 1 || (s.closed && s.pts.length > 0))
}
/** Sub-paths -> path commands. A straight segment (no handles at either end) is an L; a closing curve is written out before the Z. */
export function subsToD(subs) {
  const out = []
  for (const sub of subs) {
    const pts = sub.pts, n = pts.length
    if (!n) continue
    out.push(['M', pts[0].x, pts[0].y])
    const cnt = sub.closed ? n : n - 1
    for (let i = 0; i < cnt; i++) {
      const a = pts[i], b = pts[(i + 1) % n]
      const closing = sub.closed && i === n - 1
      if (segIsLine(a, b)) { if (!closing) out.push(['L', b.x, b.y]) } else out.push(['C', a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y])
    }
    if (sub.closed) out.push(['Z'])
  }
  return out
}
export { cloneSubs }

// ---------- node types ----------
/** Node type letter inferred from the handles: 'y' collinear and equal length, 's' collinear, else 'c'. */
export function inferType(p) {
  if (!hasIn(p) || !hasOut(p)) return 'c'
  const li = Math.hypot(p.ix, p.iy), lo = Math.hypot(p.ox, p.oy)
  if (Math.abs(p.ix * p.oy - p.iy * p.ox) / (li * lo) > 0.03 || p.ix * p.ox + p.iy * p.oy >= 0) return 'c'
  return Math.abs(li - lo) <= 0.01 * Math.max(li, lo) ? 'y' : 's'
}
const validNt = (nt, subs) => Array.isArray(nt) && nt.length === subs.length && nt.every((row, s) => Array.isArray(row) && row.length === subs[s].pts.length)
/** A draft {subs, nt} for a path node: stored node types when they still fit the points, else inferred from the handles. */
export function makeDraft(node) {
  const subs = dToSubs(node.d)
  const nt = validNt(node.nt, subs) ? node.nt.map((r) => r.slice()) : subs.map((s) => s.pts.map(inferType))
  return { subs, nt }
}
export const cloneDraft = (dr) => ({ subs: cloneSubs(dr.subs), nt: dr.nt.map((r) => r.slice()) })

// ---------- parametric shapes ----------
const DEG = Math.PI / 180
const FULL = 359.999
/** Path commands of a shape in its local, unrotated frame (rect from 0,0; ellipse, polygon and star centred on 0,0). Angles of an ellipse arc run counter-clockwise on screen. */
export function localPath(s) {
  if (s.k === 'rect') return rectPath(0, 0, s.w, s.h, s.rx || 0, s.ry ?? s.rx ?? 0)
  if (s.k === 'ellipse') {
    const sweep = s.a1 != null && s.a2 != null ? (((s.a2 - s.a1) % 360) + 360) % 360 : 0
    if (!sweep || sweep > FULL) return ellipsePath(0, 0, s.rx, s.ry)
    const at = (a) => [s.rx * Math.cos(a * DEG), -s.ry * Math.sin(a * DEG)]
    const [x0, y0] = at(s.a1), [x1, y1] = at(s.a1 + sweep)
    const d = [s.pie ? ['M', 0, 0] : ['M', x0, y0]]
    if (s.pie) d.push(['L', x0, y0])
    d.push(...arcToCubics(x0, y0, s.rx, s.ry, 0, sweep > 180 ? 1 : 0, 0, x1, y1))
    if (s.pie) d.push(['Z'])
    return d
  }
  if (s.k === 'poly') return subsToD(polygonSubs(0, 0, s.r, s.n, s.rot ?? -Math.PI / 2))
  if (s.k === 'star') return subsToD(starSubs(0, 0, s.r1, s.r2, s.n, s.rot ?? -Math.PI / 2))
  return []
}
/** The page-space path of a shape: its local path mapped through sm. */
export const shapeD = (shape, sm) => mapPath(localPath(shape), sm)
/** The node with its parametric description changed (the path is rebuilt through sm; node types are dropped). */
export function applyShape(node, shape = node.shape) {
  const { nt: _nt, ...rest } = node
  return { ...rest, shape, d: shapeD(shape, node.sm) }
}
/** The node as a plain curve: the parametric description is dropped, the path stays as it is. */
export function shapeToCurves(node) {
  if (!node.shape && !node.sm) return node
  const { shape: _s, sm: _m, ...rest } = node
  return rest
}
/** The sharpness of a star as the UI shows it, 0 to 100 (how far the inner radius sits below the outer one). */
export const starSharpness = (s) => Math.round((1 - s.r2 / s.r1) * 100)

// ---------- freehand ----------
/** A hand-drawn stroke (points {x, y}) as path commands: Douglas-Peucker with tolerance eps, then smooth curves through the kept points. */
export function simplifyFreehand(points, eps = 2, closed = false) {
  const keep = rdp(points, eps)
  if (keep.length < 2) return []
  const sub = keep.length < 3 ? { closed: false, pts: keep.map((p) => P(p.x, p.y)) } : fitSmooth(keep, closed)
  sub.closed = !!closed && keep.length > 2
  return subsToD([sub])
}

// ---------- node primitives ----------
// picks are [[s, i], ...] (sub-path index, point index). Every primitive mutates the draft.
const isEnd = (sub, i) => !sub.closed && (i === 0 || i === sub.pts.length - 1)
/** A segment starts at point i of the sub-path (an open path has none after its last point). */
const hasSeg = (sub, i) => i >= 0 && i < (sub.closed ? sub.pts.length : sub.pts.length - 1)
const key = (s, i) => `${s}|${i}`

/** Segments (as [s, i]: from point i to the next one) an operation acts on: between two picked neighbours, else after a single picked point. */
export function pickedSegments(dr, picks) {
  const set = new Set(picks.map(([s, i]) => key(s, i)))
  const out = []
  for (const [s, i] of picks) {
    const sub = dr.subs[s]
    if (!sub || !hasSeg(sub, i)) continue
    if (set.has(key(s, (i + 1) % sub.pts.length))) out.push([s, i])
  }
  if (!out.length && picks.length === 1) {
    const [s, i] = picks[0], sub = dr.subs[s]
    if (sub && hasSeg(sub, i)) out.push([s, i]); else if (sub && hasSeg(sub, i - 1)) out.push([s, i - 1])
  }
  return out
}

/** Insert a node on segment `seg` of sub-path s at parameter t. Returns the new point index. */
export function addNode(dr, s, seg, t = 0.5) {
  const sub = dr.subs[s]
  const line = segIsLine(sub.pts[seg], sub.pts[(seg + 1) % sub.pts.length])
  const at = splitSegment(sub, seg, t)
  dr.nt[s].splice(at, 0, line ? 'c' : 's')
  return at
}
/** Add a node in the middle of every segment between picked neighbours (or after a single picked point). Returns the new picks. */
export function addNodes(dr, picks) {
  const out = []
  const bySub = new Map()
  for (const [s, i] of pickedSegments(dr, picks)) bySub.set(s, [...(bySub.get(s) || []), i])
  for (const [s, list] of bySub) {
    list.sort((a, b) => a - b)
    list.forEach((seg, k) => { out.push([s, addNode(dr, s, seg + k, 0.5)]) })
  }
  return out
}
/** Delete the picked points. Sub-paths left with fewer than two points disappear. Returns the number of points removed. */
export function deleteNodes(dr, picks) {
  const bySub = new Map()
  for (const [s, i] of picks) bySub.set(s, [...new Set([...(bySub.get(s) || []), i])])
  let n = 0
  for (const [s, list] of bySub) {
    list.sort((a, b) => b - a)
    for (const i of list) if (dr.subs[s]?.pts[i]) { dr.subs[s].pts.splice(i, 1); dr.nt[s].splice(i, 1); n++ }
  }
  for (let s = dr.subs.length - 1; s >= 0; s--) if (dr.subs[s].pts.length < 2) { dr.subs.splice(s, 1); dr.nt.splice(s, 1) }
  return n
}
/** Make the picked segments straight. Returns how many segments were curves. */
export function toLine(dr, picks) {
  let n = 0
  for (const [s, i] of pickedSegments(dr, picks)) {
    const sub = dr.subs[s], j = (i + 1) % sub.pts.length
    const a = sub.pts[i], b = sub.pts[j]
    if (segIsLine(a, b)) continue
    a.ox = a.oy = 0; b.ix = b.iy = 0
    dr.nt[s][i] = 'c'; dr.nt[s][j] = 'c'
    n++
  }
  return n
}
/** Make the picked straight segments curves (handles a third of the way along). Returns how many segments were straight. */
export function toCurve(dr, picks) {
  let n = 0
  for (const [s, i] of pickedSegments(dr, picks)) {
    const sub = dr.subs[s], a = sub.pts[i], b = sub.pts[(i + 1) % sub.pts.length]
    if (!segIsLine(a, b)) continue
    a.ox = (b.x - a.x) / 3; a.oy = (b.y - a.y) / 3
    b.ix = (a.x - b.x) / 3; b.iy = (a.y - b.y) / 3
    n++
  }
  return n
}
const unit = (x, y) => { const l = Math.hypot(x, y); return l < EPS ? null : [x / l, y / l] }
/** Cusp ('c'), smooth ('s') or symmetrical ('y') for the picked points: smooth keeps the two handles on one line, symmetrical also gives them equal length. */
export function setNodeType(dr, picks, type) {
  let n = 0
  for (const [s, i] of picks) {
    const sub = dr.subs[s], p = sub?.pts[i]
    if (!p) continue
    dr.nt[s][i] = type
    n++
    if (type === 'c') continue
    if (!hasIn(p) && !hasOut(p)) { if (sub.pts.length > 2) makeSmooth(sub, i); if (!hasIn(p) && !hasOut(p)) continue }
    const li = Math.hypot(p.ix, p.iy), lo = Math.hypot(p.ox, p.oy)
    const dout = unit(p.ox, p.oy), din = unit(-p.ix, -p.iy)
    const t = dout && din ? unit(dout[0] + din[0], dout[1] + din[1]) || dout : dout || din
    const L = type === 'y' ? (li && lo ? (li + lo) / 2 : Math.max(li, lo)) : null
    if (lo || type === 'y') { const k = L ?? lo; p.ox = t[0] * k; p.oy = t[1] * k }
    if (li || type === 'y') { const k = L ?? li; p.ix = -t[0] * k; p.iy = -t[1] * k }
  }
  return n
}
/** Break the path at each picked point (end points cannot be broken). Returns the new picks: both halves of every break. */
export function breakAt(dr, picks) {
  const list = [...new Map(picks.map(([s, i]) => [key(s, i), [s, i]])).values()].sort((a, b) => b[0] - a[0] || b[1] - a[1])
  const out = []
  while (list.length) {
    const [s, i] = list.shift()
    const sub = dr.subs[s], n = sub?.pts.length
    if (!sub || isEnd(sub, i)) continue
    const row = dr.nt[s]
    if (sub.closed) {
      const rot = [...sub.pts.slice(i), ...sub.pts.slice(0, i)].map((q) => ({ ...q }))
      const rowRot = [...row.slice(i), ...row.slice(0, i)]
      const first = rot[0], last = { ...first }
      first.ix = first.iy = 0
      last.ox = last.oy = 0
      rot.push(last); rowRot.push('c'); rowRot[0] = 'c'
      sub.pts = rot; sub.closed = false; dr.nt[s] = rowRot
      for (const q of list) if (q[0] === s) q[1] = (q[1] - i + n) % n // the remaining picks of this sub moved with the rotation
      out.push([s, 0], [s, rot.length - 1])
    } else {
      const a = sub.pts.slice(0, i + 1).map((q) => ({ ...q })), b = sub.pts.slice(i).map((q) => ({ ...q }))
      a[a.length - 1].ox = a[a.length - 1].oy = 0
      b[0].ix = b[0].iy = 0
      const ra = row.slice(0, i + 1), rb = row.slice(i)
      ra[ra.length - 1] = 'c'; rb[0] = 'c'
      dr.subs.splice(s, 1, { closed: false, pts: a }, { closed: false, pts: b })
      dr.nt.splice(s, 1, ra, rb)
      for (const o of out) { if (o[0] > s) o[0]++; else if (o[0] === s) { o[0] = s + 1; o[1] -= i } } // halves made earlier now live in the second part
      out.push([s, i], [s + 1, 0])
    }
  }
  return out
}
/** Join two picked end points of open sub-paths (or the two ends of one): they meet in the middle. Returns the new pick, or null when the picks cannot be joined. */
export function joinEnds(dr, picks) {
  if (picks.length !== 2) return null
  const [[sa, ia], [sb, ib]] = picks
  const A = dr.subs[sa], B = dr.subs[sb]
  if (!A || !B || A.closed || B.closed || !isEnd(A, ia) || !isEnd(B, ib)) return null
  const merge = (last, first) => ({ x: (last.x + first.x) / 2, y: (last.y + first.y) / 2, ix: last.ix, iy: last.iy, ox: first.ox, oy: first.oy })
  if (sa === sb) {
    if (ia === ib || A.pts.length < 2) return null
    const m = merge(A.pts[A.pts.length - 1], A.pts[0])
    A.pts.pop(); A.pts[0] = m
    dr.nt[sa].pop(); dr.nt[sa][0] = 'c'
    A.closed = true
    return [sa, 0]
  }
  // orient the two: A ends at the join, B starts at it
  const orient = (sub, row, atStart, wantStart) => { if (atStart !== wantStart) { geomReverse(sub); row.reverse() } }
  orient(A, dr.nt[sa], ia === 0, false)
  orient(B, dr.nt[sb], ib === 0, true)
  const m = merge(A.pts[A.pts.length - 1], B.pts[0])
  const at = A.pts.length - 1
  A.pts = [...A.pts.slice(0, -1), m, ...B.pts.slice(1)]
  dr.nt[sa] = [...dr.nt[sa].slice(0, -1), 'c', ...dr.nt[sb].slice(1)]
  dr.subs.splice(sb, 1); dr.nt.splice(sb, 1)
  return [sb < sa ? sa - 1 : sa, at]
}
/** Close every open sub-path that has a picked point (every open one when nothing is picked). Returns how many were closed. */
export function closeSub(dr, picks = []) {
  const want = picks.length ? new Set(picks.map(([s]) => s)) : null
  let n = 0
  dr.subs.forEach((sub, s) => {
    if (sub.closed || sub.pts.length < 2 || (want && !want.has(s))) return
    sub.closed = true
    const f = sub.pts[0], l = sub.pts[sub.pts.length - 1]
    if (sub.pts.length > 2 && same(f, l)) { f.ix = l.ix; f.iy = l.iy; sub.pts.pop(); dr.nt[s].pop() }
    n++
  })
  return n
}
/** Reverse the direction of every sub-path that has a picked point. Returns the picks mapped to the new order. */
export function reverseSub(dr, picks) {
  for (const s of new Set(picks.map(([s]) => s))) { if (!dr.subs[s]) continue; geomReverse(dr.subs[s]); dr.nt[s].reverse() }
  return picks.map(([s, i]) => [s, dr.subs[s] ? dr.subs[s].pts.length - 1 - i : i])
}
/** One sub-path as commands (used by Break apart). */
export const extractSub = (subs, s) => (subs[s] ? subsToD([subs[s]]) : [])
/** Move the anchor of point i (its handles are offsets, so they come along). */
export function moveNode(dr, s, i, dx, dy) { const p = dr.subs[s].pts[i]; p.x += dx; p.y += dy }
/** Put a handle ('in' or 'out') of point i at the page point (x, y). A smooth node keeps the other handle on the same line (its length stays), a symmetrical one mirrors it. */
export function moveHandle(dr, s, i, which, x, y) {
  const p = dr.subs[s].pts[i]
  const [kx, ky, ox, oy] = which === 'in' ? ['ix', 'iy', 'ox', 'oy'] : ['ox', 'oy', 'ix', 'iy']
  p[kx] = x - p.x; p[ky] = y - p.y
  const type = dr.nt[s][i]
  const len = Math.hypot(p[kx], p[ky])
  if (type === 'y') { p[ox] = -p[kx]; p[oy] = -p[ky] }
  else if (type === 's' && len > EPS) {
    const keep = Math.hypot(p[ox], p[oy])
    if (keep > EPS) { p[ox] = (-p[kx] / len) * keep; p[oy] = (-p[ky] / len) * keep }
  }
}
export { hasIn, hasOut }
