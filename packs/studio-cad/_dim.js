// Text metrics and dimension geometry for CAD Studio. Pure functions, no DOM.
import { TAU, pt, dist, sub, add, mul, dot, cross, len, unit, mid, perp, polar, angle, norm, angDiff, S, A } from './_vec.js'

// Helvetica advance widths (per 1000 em) for ASCII 32..126, so canvas, SVG, PDF and hit-testing agree.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const EXTRA = { 176: 400, 177: 584, 216: 778, 181: 556, 169: 737, 215: 584 }

export const charW = (ch) => { const c = ch.charCodeAt(0); return (c >= 32 && c <= 126 ? W[c - 32] : EXTRA[c] ?? 556) / 1000 }
export const lineWidth = (s, h) => { let w = 0; for (const ch of s) w += charW(ch); return w * h }
export const textLines = (s) => String(s ?? '').split(/\r?\n/)
export const LINE_GAP = 1.35

/** Width of the widest line in world units. */
export const textWidth = (s, h) => Math.max(0, ...textLines(s).map((l) => lineWidth(l, h)))

/** Four corners (CCW from bottom-left) of the oriented text box, plus its width/height. */
export function textCorners(x, y, h, str, rot = 0, align = 'l') {
  const lines = textLines(str)
  const w = textWidth(str, h)
  const x0 = align === 'c' ? -w / 2 : align === 'r' ? -w : 0
  const top = h * 0.78
  const bottom = -(lines.length - 1) * h * LINE_GAP - h * 0.24
  const co = Math.cos(rot), si = Math.sin(rot)
  const R = (px, py) => ({ x: x + px * co - py * si, y: y + px * si + py * co })
  return { pts: [R(x0, bottom), R(x0 + w, bottom), R(x0 + w, top), R(x0, top)], w, h: top - bottom }
}

export const fmtNum = (v, prec = 2) => {
  const s = Number(v).toFixed(Math.max(0, Math.min(8, prec)))
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s
}
export const fmtAngle = (rad, prec = 1) => fmtNum(norm(rad) * 180 / Math.PI, prec) + '°'

/** Text reading angle: keep the baseline direction readable (left to right, bottom to top). */
export function readable(a) {
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI
  if (a > Math.PI / 2 + 1e-9) a -= Math.PI
  else if (a <= -Math.PI / 2 + 1e-9) a += Math.PI
  return a
}

/** Where linear and aligned dimensions measure: returns the dimension line angle. */
export const dimLineAngle = (e) => (e.kind === 'aligned' ? angle(e.a, e.b) : e.ang || 0)

/** Measured value (distance, radius, diameter or angle in radians). */
export function dimValue(e) {
  switch (e.kind) {
    case 'linear': { const u = { x: Math.cos(e.ang || 0), y: Math.sin(e.ang || 0) }; return Math.abs(dot(sub(e.b, e.a), u)) }
    case 'aligned': return dist(e.a, e.b)
    case 'radius': return e.r
    case 'diameter': return 2 * e.r
    case 'angular': return dimGeom(e).value
    default: return 0
  }
}

/**
 * Everything needed to draw a dimension: { lines: [[p, q]], arrows: [{ tip, dir }], arcs: [{ c, r, a0, sw }],
 * texts: [{ x, y, rot, h, str, align }], value }. Entity fields: kind, th (text height), as (arrow size), pr (precision), tx (override).
 */
export function dimGeom(e) {
  const th = e.th || 2.5, as = e.as ?? th, pr = e.pr ?? 2
  const g = { lines: [], arrows: [], arcs: [], texts: [], value: 0 }
  const label = (v, pre = '', post = '') => (e.tx ? String(e.tx).replace('<>', pre + fmtNum(v, pr) + post) : pre + fmtNum(v, pr) + post)
  const gap = th * 0.6, over = th * 0.8

  if (e.kind === 'linear' || e.kind === 'aligned') {
    const ang = dimLineAngle(e)
    const u = { x: Math.cos(ang), y: Math.sin(ang) }, n = perp(u)
    const { a, b, loc } = e
    const da = dot(sub(loc, a), n), db = dot(sub(loc, b), n)
    const pa = add(a, mul(n, da)), pb = add(b, mul(n, db))
    const sa = da >= 0 ? 1 : -1, sb = db >= 0 ? 1 : -1
    if (Math.abs(da) > gap) g.lines.push([add(a, mul(n, sa * gap)), add(pa, mul(n, sa * over))])
    if (Math.abs(db) > gap) g.lines.push([add(b, mul(n, sb * gap)), add(pb, mul(n, sb * over))])
    const value = dist(pa, pb)
    g.value = value
    const str = label(value)
    const d = value > 1e-9 ? unit(sub(pb, pa)) : u
    const dirA = Math.atan2(d.y, d.x)
    const fits = value >= 2.2 * as + textWidth(str, th) * 0.6
    g.lines.push([pa, pb])
    if (fits) {
      g.arrows.push({ tip: pa, dir: dirA + Math.PI }, { tip: pb, dir: dirA })
    } else {
      g.arrows.push({ tip: pa, dir: dirA }, { tip: pb, dir: dirA + Math.PI })
      g.lines.push([add(pa, mul(d, -as * 1.8)), pa], [pb, add(pb, mul(d, as * 1.8))])
    }
    const rot = readable(dirA)
    const m = mid(pa, pb)
    const up = perp({ x: Math.cos(rot), y: Math.sin(rot) })
    g.texts.push({ x: m.x + up.x * th * 0.4, y: m.y + up.y * th * 0.4, rot, h: th, str, align: 'c' })
    return g
  }

  if (e.kind === 'radius' || e.kind === 'diameter') {
    const c = pt(e.cx, e.cy)
    const phi = dist(c, e.loc) < 1e-9 ? 0 : angle(c, e.loc)
    const P = polar(c, phi, e.r)
    const dia = e.kind === 'diameter'
    const str = label(dia ? e.r * 2 : e.r, dia ? 'Ø' : 'R')
    g.value = dia ? e.r * 2 : e.r
    const outside = dist(c, e.loc) > e.r
    const tw = textWidth(str, th)
    if (dia) {
      const Q = polar(c, phi + Math.PI, e.r)
      g.lines.push([Q, P])
      g.arrows.push({ tip: P, dir: phi }, { tip: Q, dir: phi + Math.PI })
    } else {
      const dir = dist(P, e.loc) < 1e-9 ? phi : angle(e.loc, P)
      g.arrows.push({ tip: P, dir })
    }
    if (outside) {
      if (dia) g.lines.push([P, e.loc])
      else g.lines.push([e.loc, P])
      const sgn = e.loc.x >= P.x ? 1 : -1
      const end = { x: e.loc.x + sgn * (tw + th * 0.5), y: e.loc.y }
      g.lines.push([e.loc, end])
      g.texts.push({ x: e.loc.x + sgn * (tw / 2 + th * 0.25), y: e.loc.y + th * 0.5, rot: 0, h: th, str, align: 'c' })
    } else {
      if (!dia) g.lines.push([e.loc, P])
      g.texts.push({ x: e.loc.x, y: e.loc.y - th * 0.35, rot: 0, h: th, str, align: 'c' })
    }
    return g
  }

  if (e.kind === 'angular') {
    const v = e.v
    const u1 = { x: Math.cos(e.a1), y: Math.sin(e.a1) }, u2 = { x: Math.cos(e.a2), y: Math.sin(e.a2) }
    const w = sub(e.loc, v)
    const det = cross(u1, u2)
    if (Math.abs(det) < 1e-9) return g
    const p = cross(w, u2) / det, q = cross(u1, w) / det
    const d1 = e.a1 + (p < 0 ? Math.PI : 0), d2 = e.a2 + (q < 0 ? Math.PI : 0)
    const sweep = angDiff(d2, d1)
    const R = Math.max(len(w), th)
    const a0 = sweep >= 0 ? d1 : d2
    const sw = Math.abs(sweep)
    g.value = sw
    g.arcs.push({ c: v, r: R, a0: norm(a0), sw })
    g.arrows.push({ tip: polar(v, a0, R), dir: a0 - Math.PI / 2 }, { tip: polar(v, a0 + sw, R), dir: a0 + sw + Math.PI / 2 })
    for (const [q0, dd] of [[e.q1, d1], [e.q2, d2]]) {
      if (!q0) continue
      const dirv = { x: Math.cos(dd), y: Math.sin(dd) }
      const dp = dot(sub(q0, v), dirv)
      if (dp > 0 && dp + gap < R) g.lines.push([add(v, mul(dirv, dp + gap)), add(v, mul(dirv, R + over))])
    }
    const am = a0 + sw / 2
    const str = label(sw * 180 / Math.PI, '', '°')
    const tp = polar(v, am, R + th * 1.1)
    g.texts.push({ x: tp.x, y: tp.y - th * 0.35, rot: 0, h: th, str, align: 'c' })
    return g
  }
  return g
}

/** Primitives of a dimension (for snapping and selection). */
export function dimPrims(e) {
  const g = dimGeom(e)
  return [...g.lines.map(([a, b]) => S(a, b)), ...g.arcs.map((a) => A(a.c, a.r, a.a0, a.sw))]
}

/** Default value text for a dimension kind, for the properties panel. */
export const dimLabel = (e) => dimGeom(e).texts[0]?.str ?? ''
