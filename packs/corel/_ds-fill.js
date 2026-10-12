// Draw Studio fill, outline and transparency helpers. Pure (no DOM): gradient geometry for the Interactive fill handles, operations over roots
// (fill type, one gradient, opacity, copying attributes) and the dash presets of the Outline pen. Like _ds-ops.js every op returns the SAME root
// when nothing changes, so store.tx records no step.
//
// A Gradient is {g:'linear', x1, y1, x2, y2 | g:'radial', cx, cy, r, fx, fy, m, stops:[{o, c, a}], spread}; its numbers live in gradient space and
// m maps gradient space to the page (rotating or scaling an object composes into m, so the handles are always apply(m, point)).
import { I, apply, invert, pathBBox } from './_model.js'
import { mapItems } from './_ds-doc.js'
import { hexToRgb, rgbToHex } from './_ds-colors.js'

export const DEFAULT_FILL = '#b9c7ff'
const HEX = /^#[0-9a-f]{6}$/
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const sortStops = (stops) => stops.map((s, i) => [s, i]).sort((a, b) => a[0].o - b[0].o || a[1] - b[1]).map(([s]) => s)

// ---------- gradient geometry ----------
/** Stops of a fill as [{o, c, a}]: a gradient's own, or a flat colour fading to `to`. */
export function stopsOf(fill, to = '#ffffff') {
  if (fill && typeof fill === 'object') return fill.stops.map((s) => ({ ...s }))
  const c = HEX.test(fill || '') ? fill : DEFAULT_FILL
  return [{ o: 0, c, a: 1 }, { o: 1, c: to === c ? '#000000' : to, a: 1 }]
}
/** A fresh gradient over the box {x, y, w, h}: linear left to right through the middle, or radial from the centre to the longer side. */
export function makeGradient(kind, box, stops) {
  const o = { m: I.slice(), stops, spread: 'pad' }
  if (kind === 'radial') { const cx = box.x + box.w / 2, cy = box.y + box.h / 2; return { g: 'radial', cx, cy, r: Math.max(box.w, box.h, 1) / 2, fx: cx, fy: cy, ...o } }
  const cy = box.y + box.h / 2
  return { g: 'linear', x1: box.x, y1: cy, x2: box.x + Math.max(box.w, 1), y2: cy, ...o }
}
/**
 * The handles of a gradient in PAGE space: {kind, a, b, stops: [{o, x, y}]}. a is the start (linear) or the centre (radial), b the end or the point on
 * the edge of the circle; the stop markers sit on the segment a to b at their offsets.
 */
export function gradientHandles(g) {
  const m = g.m || I
  const [ax, ay] = apply(m, g.g === 'radial' ? g.cx : g.x1, g.g === 'radial' ? g.cy : g.y1)
  const [bx, by] = g.g === 'radial' ? apply(m, g.cx + g.r, g.cy) : apply(m, g.x2, g.y2)
  return { kind: g.g, a: { x: ax, y: ay }, b: { x: bx, y: by }, stops: g.stops.map((s) => ({ o: s.o, x: ax + (bx - ax) * s.o, y: ay + (by - ay) * s.o })) }
}
const local = (g, p) => { const inv = invert(g.m || I); return inv ? apply(inv, p.x, p.y) : [p.x, p.y] }
/** Move the start (linear) or the centre (radial) to a page point. */
export function moveStart(g, p) {
  const [x, y] = local(g, p)
  return g.g === 'radial' ? { ...g, cx: x, cy: y, fx: x, fy: y } : { ...g, x1: x, y1: y }
}
/** Move the end (linear) or set the radius (radial: the distance from the centre in gradient space) from a page point. */
export function moveEnd(g, p) {
  const [x, y] = local(g, p)
  if (g.g === 'radial') return { ...g, r: Math.max(0.01, Math.hypot(x - g.cx, y - g.cy)) }
  return { ...g, x2: x, y2: y }
}
/** The stop offset (0 to 1, clamped) whose marker is closest to a page point: the projection on the line (linear) or the relative distance (radial). */
export function offsetAt(g, p) {
  const h = gradientHandles(g)
  const dx = h.b.x - h.a.x, dy = h.b.y - h.a.y, len2 = dx * dx + dy * dy
  if (!(len2 > 1e-12)) return 0
  return clamp01(((p.x - h.a.x) * dx + (p.y - h.a.y) * dy) / len2)
}
/** Distance in page units from a page point to the segment a-b of the handles. */
export function distToLine(g, p) {
  const { a, b } = gradientHandles(g)
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy
  const t = len2 > 1e-12 ? clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}
/** Colour and opacity of a stop list at offset o (linear blend between the neighbours). */
export function colorAt(stops, o) {
  const s = sortStops(stops)
  if (o <= s[0].o) return { c: s[0].c, a: s[0].a }
  if (o >= s[s.length - 1].o) return { c: s[s.length - 1].c, a: s[s.length - 1].a }
  let i = 1
  while (s[i].o < o) i++
  const p = s[i - 1], q = s[i], k = q.o === p.o ? 0 : (o - p.o) / (q.o - p.o)
  const A = hexToRgb(p.c), B = hexToRgb(q.c)
  return { c: rgbToHex(...A.map((v, j) => Math.round(v + (B[j] - v) * k))), a: p.a + (q.a - p.a) * k }
}
/** Add a stop at offset o with the colour the gradient has there. Returns {g, index} (stops stay sorted by offset). */
export function addStop(g, o) {
  o = clamp01(o)
  const { c, a } = colorAt(g.stops, o)
  const stop = { o, c, a }
  const stops = sortStops([...g.stops, stop])
  return { g: { ...g, stops }, index: stops.indexOf(stop) }
}
/** Change a stop's colour (c), opacity (a) or offset (o). Returns {g, index} after re-sorting. */
export function setStop(g, i, patch) {
  const cur = g.stops[i]
  if (!cur) return { g, index: i }
  const next = { ...cur }
  if (typeof patch.c === 'string' && HEX.test(patch.c)) next.c = patch.c
  if (Number.isFinite(patch.a)) next.a = clamp01(patch.a)
  if (Number.isFinite(patch.o)) next.o = clamp01(patch.o)
  const stops = g.stops.slice(); stops[i] = next
  const sorted = sortStops(stops)
  return { g: { ...g, stops: sorted }, index: sorted.indexOf(next) }
}
/** Remove a stop (a gradient keeps at least two). */
export function removeStop(g, i) {
  if (g.stops.length <= 2 || !g.stops[i]) return g
  return { ...g, stops: g.stops.filter((_, k) => k !== i) }
}
/** Swap the colours end to end. */
export const reverseStops = (g) => ({ ...g, stops: sortStops(g.stops.map((s) => ({ ...s, o: 1 - s.o }))) })

// ---------- operations over roots ----------
const isPath = (n) => n.t === 'path'
/** fn applied to every leaf under the nodes `ids` (groups are rebuilt only when a leaf changed). */
export function mapLeaves(root, ids, fn) {
  const rec = (n) => {
    if (n.t !== 'group') return fn(n)
    let items = null
    n.items.forEach((k, i) => { const r = rec(k); if (r !== k) { items ??= n.items.slice(); items[i] = r } })
    return items ? { ...n, items } : n
  }
  return mapItems(root, new Set(ids), rec)
}
/** 'none' | 'uniform' | 'linear' | 'radial' for a leaf. */
export const fillKind = (n) => (!n.fill ? 'none' : typeof n.fill === 'object' ? n.fill.g : 'uniform')
/** The first flat colour of a fill (a gradient's first stop), or null. */
export const flatOf = (fill) => (fill && typeof fill === 'object' ? fill.stops[0]?.c : HEX.test(fill || '') ? fill : null)

/**
 * Make every shape under `ids` have the given fill type: 'none', 'uniform' (keeps the colour, or the first stop of a gradient), 'linear' or
 * 'radial' (a gradient over the shape's own box from its colour to white). Text only keeps or loses a colour, pictures are skipped.
 */
export function setFillType(root, ids, kind) {
  return mapLeaves(root, ids, (n) => {
    if (n.t === 'text') return n
    if (!isPath(n)) return n
    const cur = n.fill
    let fill
    if (kind === 'none') fill = null
    else if (kind === 'uniform') fill = flatOf(cur) || DEFAULT_FILL
    else if (cur && typeof cur === 'object' && cur.g === kind) return n
    else {
      const b = pathBBox(n.d)
      if (!b) return n
      fill = makeGradient(kind, b, cur && typeof cur === 'object' ? cur.stops.map((s) => ({ ...s })) : stopsOf(cur))
    }
    if (fill === cur) return n
    const { fillK: _k, ...rest } = n
    return { ...rest, fill }
  })
}
const stripK = (n) => { if (!('fillK' in n)) return n; const { fillK: _k, ...rest } = n; return rest }
/** Replace the fill of one path (id) by a gradient (a gradient has no CMYK display hint). */
export function setGradient(root, id, g) {
  return mapLeaves(root, [id], (n) => (isPath(n) && n.fill !== g ? { ...stripK(n), fill: g } : n))
}

/** Opacity 0 to 1 on every leaf: paths take it as fill and outline opacity, pictures and text as their opacity. */
export function setOpacity(root, ids, a) {
  a = clamp01(a)
  return mapLeaves(root, ids, (n) => {
    if (isPath(n)) return n.fillOpacity === a && n.strokeOpacity === a ? n : { ...n, fillOpacity: a, strokeOpacity: a }
    if (n.t === 'image' || n.t === 'text') return n.opacity === a ? n : { ...n, opacity: a }
    return n
  })
}
/** The common opacity of the leaves under `nodes` (0 to 1), or null when they differ or there are none. */
export function opacityOf(nodes) {
  let cur
  const see = (v) => { if (cur === undefined) cur = v; else if (Math.abs(cur - v) > 1e-6) cur = null }
  const rec = (n) => {
    if (n.t === 'group') n.items.forEach(rec)
    else if (isPath(n)) see(n.fillOpacity ?? 1)
    else if (n.t === 'image' || n.t === 'text') see(n.opacity ?? 1)
  }
  nodes.forEach(rec)
  return cur ?? null
}

/** The look of one leaf as a style patch for setStyle (what the eyedropper copies), or null for pictures and groups. */
export function attrsOf(n) {
  if (n.t === 'path') return { fill: n.fill, fillOpacity: n.fillOpacity, stroke: n.stroke, strokeWidth: n.strokeWidth, strokeOpacity: n.strokeOpacity, cap: n.cap, join: n.join, miter: n.miter, dash: n.dash, dashOffset: n.dashOffset, fillK: n.fillK ?? null, strokeK: n.strokeK ?? null }
  if (n.t === 'text') return { fill: n.fill }
  return null
}

// ---------- outline pen ----------
export const DASH_KINDS = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['dashdot', 'Dash and dot']]
/** Dash array for a preset at an outline width in points (lengths scale with the width, never below 1 pt so hairlines still show). */
export function dashFor(kind, width) {
  const u = Math.max(1, width || 1)
  if (kind === 'dashed') return [4 * u, 3 * u]
  if (kind === 'dotted') return [u, 2 * u]
  if (kind === 'dashdot') return [4 * u, 2 * u, u, 2 * u]
  return null
}
/** Which preset a dash array is, or 'custom'. */
export function dashKind(dash, width) {
  if (!dash?.length) return 'solid'
  for (const [k] of DASH_KINDS) { const d = dashFor(k, width); if (d && d.length === dash.length && d.every((v, i) => Math.abs(v - dash[i]) < 1e-6)) return k }
  return 'custom'
}
/** Ready-made outline widths in points for the dialog's list. */
export const PEN_WIDTHS = [0.1, 0.25, 0.5, 0.75, 1, 2, 4, 8, 12]
