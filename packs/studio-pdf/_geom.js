// Small geometry, colour and id helpers shared by the PDF Studio modules.
// Coordinate model: every annotation lives in "base space" = the page as pdf.js shows it at scale 1 with the file's own
// /Rotate applied, origin top-left, y down, units = PDF points. A page the user rotated is drawn by transforming base space.

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const uid = (p = 'a') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3)
export const num = (v, d = 2) => +(+v).toFixed(d)

/** base -> display (scale 1) for a user rotation of 0/90/180/270 degrees clockwise. w, h are the base page size. */
export function toDisp(rot, w, h, x, y) {
  switch (rot) {
    case 90: return [h - y, x]
    case 180: return [w - x, h - y]
    case 270: return [y, w - x]
    default: return [x, y]
  }
}
/** display -> base (inverse of toDisp). */
export function toBase(rot, w, h, x, y) {
  switch (rot) {
    case 90: return [y, h - x]
    case 180: return [w - x, h - y]
    case 270: return [w - y, x]
    default: return [x, y]
  }
}
export const dispSize = (rot, w, h) => (rot % 180 ? [h, w] : [w, h])
/** CSS matrix() that maps a base-space layer to display pixels at zoom z. */
export function cssMatrix(rot, w, h, z) {
  const m = { 0: [1, 0, 0, 1, 0, 0], 90: [0, 1, -1, 0, h, 0], 180: [-1, 0, 0, -1, w, h], 270: [0, -1, 1, 0, 0, w] }[rot] || [1, 0, 0, 1, 0, 0]
  return `matrix(${m[0] * z},${m[1] * z},${m[2] * z},${m[3] * z},${m[4] * z},${m[5] * z})`
}

/** 2x3 matrix product with pdf.js convention: result applies m2 first, then m1. */
export const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
]
export function invert(m) {
  const d = m[0] * m[3] - m[1] * m[2] || 1e-12
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]
}
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export function bbox(points) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const [x, y] of points) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y) }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
export const rectPts = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]
export const inside = (r, x, y, tol = 0) => x >= r.x - tol && x <= r.x + r.w + tol && y >= r.y - tol && y <= r.y + r.h + tol
export const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d })
export const normRect = (x1, y1, x2, y2) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) })

export function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const l = dx * dx + dy * dy
  const t = l ? clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return [0, 0, 0]
  let s = m[1]
  if (s.length === 3) s = [...s].map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255)
}

/** Quadratic-midpoint smoothing as cubic segments (shared by the SVG preview and the PDF output). */
export function smoothSegs(pts) {
  const n = pts.length
  if (!n) return []
  const segs = [['M', pts[0][0], pts[0][1]]]
  if (n === 1) { segs.push(['L', pts[0][0] + 0.01, pts[0][1]]); return segs }
  if (n === 2) { segs.push(['L', pts[1][0], pts[1][1]]); return segs }
  let [px, py] = pts[0]
  for (let i = 1; i < n - 1; i++) {
    const [cx, cy] = pts[i]
    const mx = (cx + pts[i + 1][0]) / 2, my = (cy + pts[i + 1][1]) / 2
    segs.push(['C', px + (2 / 3) * (cx - px), py + (2 / 3) * (cy - py), mx + (2 / 3) * (cx - mx), my + (2 / 3) * (cy - my), mx, my])
    px = mx; py = my
  }
  segs.push(['L', pts[n - 1][0], pts[n - 1][1]])
  return segs
}
export const segsToD = (segs) => segs.map((s) => s[0] + s.slice(1).map((v) => num(v, 2)).join(' ')).join('')

/** Drop points closer than minDist to the previous one (keeps the last point). */
export function decimate(pts, minDist = 0.8) {
  if (pts.length < 3) return pts
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) if (Math.hypot(pts[i][0] - out.at(-1)[0], pts[i][1] - out.at(-1)[1]) >= minDist) out.push(pts[i])
  out.push(pts.at(-1))
  return out
}

export const timeAgo = (t) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000))
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}
