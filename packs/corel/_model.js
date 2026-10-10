// Shared vector model for the CorelDRAW tools (converter and CDR viewer). Plain objects, no DOM needed.
// Units are points (1/72 inch), y grows downward, origin is the top-left corner of the page.
//
//   Doc   { pages: [Page], warnings: [string] }
//   Page  { w, h, name?, items: [Item] }
//   Item  Path | Image | Text. Every item may carry clip: [{d, rule}] (all clips apply) and name.
//   Path  { t:'path', d, fill, fillOpacity, rule, stroke, strokeWidth, strokeOpacity, cap, join, miter, dash, dashOffset }
//         d is a list of absolute commands ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z'] (transforms are already flattened).
//         fill/stroke: '#rrggbb' | null. fill may also be a Gradient. rule 'nonzero'|'evenodd'. cap/join 0|1|2 (butt/round/square, miter/round/bevel).
//   Gradient { g:'linear'|'radial', x1,y1,x2,y2 | cx,cy,r,fx,fy, m:[a,b,c,d,e,f] (gradient space to page), stops:[{o,c,a}], spread:'pad'|'reflect'|'repeat' }
//   Image { t:'image', href:'data:...', w, h (pixels), m:[a,b,c,d,e,f] (unit square, top-left origin, to page), opacity }
//   Text  { t:'text', str, family, size, bold, italic, fill, opacity, m }  (m maps the baseline-left origin, in text units, to the page)

export const I = [1, 0, 0, 1, 0, 0]
/** m * n: apply n first, then m. */
export const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]]
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
export const translate = (x, y) => [1, 0, 0, 1, x, y]
export const scale = (x, y = x) => [x, 0, 0, y, 0, 0]
export const rotate = (rad) => [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]
export function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2]
  if (!det || !Number.isFinite(det)) return null
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}
export const meanScale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1

/** Format a number compactly (up to 4 decimals). */
export const n4 = (v) => { const s = (+v).toFixed(4); const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s; return t === '-0' ? '0' : t }

// ---------- Colors ----------
const h2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
export const hex = (r, g, b) => '#' + h2(r) + h2(g) + h2(b)
export const rgbOf = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const v = m ? parseInt(m[1], 16) : 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255] }
/** 'rgb(1,2,3)', 'rgba(...)', '#abc', '#aabbcc' -> {c:'#rrggbb', a} or null (none / transparent / unknown). */
export function parseColor(str) {
  str = String(str ?? '').trim().toLowerCase()
  if (!str || str === 'none' || str === 'transparent') return null
  let m = /^#([0-9a-f]{3,8})$/.exec(str)
  if (m) {
    let s = m[1]
    if (s.length === 3 || s.length === 4) s = [...s].map((x) => x + x).join('')
    if (s.length === 6 || s.length === 8) return { c: '#' + s.slice(0, 6), a: s.length === 8 ? parseInt(s.slice(6), 16) / 255 : 1 }
    return null
  }
  m = /^rgba?\(([^)]+)\)$/.exec(str)
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)))
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) return { c: hex(p[0], p[1], p[2]), a: p.length > 3 ? (str.includes('%', str.lastIndexOf(',')) ? p[3] / 255 : p[3]) : 1 }
  }
  return null
}
/** Blend a colour toward white by its alpha (for formats without transparency). */
export const onWhite = (c, a = 1) => { const [r, g, b] = rgbOf(c); const k = Math.max(0, Math.min(1, a)); return hex(r * k + 255 * (1 - k), g * k + 255 * (1 - k), b * k + 255 * (1 - k)) }
export const cmykToRgb = (c, m, y, k) => [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)]

// ---------- Path data ----------
export const mapPath = (d, m) => d.map((c) => {
  if (c[0] === 'Z') return ['Z']
  const out = [c[0]]
  for (let i = 1; i < c.length; i += 2) { const [x, y] = apply(m, c[i], c[i + 1]); out.push(x, y) }
  return out
})

const cubicExtrema = (p0, p1, p2, p3) => {
  // roots of the derivative of a 1D cubic bezier in (0,1)
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0
  const ts = []
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b) } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) { const s = Math.sqrt(disc); ts.push((-b + s) / (2 * a), (-b - s) / (2 * a)) }
  }
  return ts.filter((t) => t > 0 && t < 1).map((t) => { const u = 1 - t; return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3 })
}

/** Bounding box {x, y, w, h} of path commands (exact for curves), or null for an empty path. */
export function pathBBox(d) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0, sx = 0, sy = 0
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  for (const c of d) {
    if (c[0] === 'M') { cx = sx = c[1]; cy = sy = c[2]; add(cx, cy) }
    else if (c[0] === 'L') { cx = c[1]; cy = c[2]; add(cx, cy) }
    else if (c[0] === 'C') {
      for (const v of cubicExtrema(cx, c[1], c[3], c[5])) add(v, cy)
      for (const v of cubicExtrema(cy, c[2], c[4], c[6])) add(cx, v)
      add(c[5], c[6]); cx = c[5]; cy = c[6]
    } else if (c[0] === 'Z') { cx = sx; cy = sy }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export const unionBox = (a, b) => {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** Bounding box of an item in page space. */
export function itemBBox(it) {
  if (it.t === 'path') {
    const b = pathBBox(it.d)
    if (b && it.stroke && it.strokeWidth) { const s = it.strokeWidth / 2; return { x: b.x - s, y: b.y - s, w: b.w + 2 * s, h: b.h + 2 * s } }
    return b
  }
  if (it.t === 'image') return pathBBox(mapPath([['M', 0, 0], ['L', 1, 0], ['L', 1, 1], ['L', 0, 1], ['Z']], it.m))
  if (it.t === 'text') {
    const w = it.str.length * it.size * 0.55
    return pathBBox(mapPath([['M', 0, -it.size * 0.8], ['L', w, -it.size * 0.8], ['L', w, it.size * 0.25], ['L', 0, it.size * 0.25], ['Z']], it.m))
  }
  return null
}

const KAPPA = 0.5522847498307936
export const rectPath = (x, y, w, h, rx = 0, ry = rx) => {
  rx = Math.min(Math.abs(rx), Math.abs(w) / 2); ry = Math.min(Math.abs(ry), Math.abs(h) / 2)
  if (!rx || !ry) return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
  const kx = rx * KAPPA, ky = ry * KAPPA, r = x + w, b = y + h
  return [['M', x + rx, y], ['L', r - rx, y], ['C', r - rx + kx, y, r, y + ry - ky, r, y + ry], ['L', r, b - ry],
    ['C', r, b - ry + ky, r - rx + kx, b, r - rx, b], ['L', x + rx, b], ['C', x + rx - kx, b, x, b - ry + ky, x, b - ry], ['L', x, y + ry],
    ['C', x, y + ry - ky, x + rx - kx, y, x + rx, y], ['Z']]
}
export const ellipsePath = (cx, cy, rx, ry) => {
  const kx = rx * KAPPA, ky = ry * KAPPA
  return [['M', cx + rx, cy], ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry], ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry], ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy], ['Z']]
}

/** SVG elliptical arc from (x0,y0) to (x,y) as cubic bezier commands. */
export function arcToCubics(x0, y0, rx, ry, rotDeg, large, sweep, x, y) {
  if (x0 === x && y0 === y) return []
  rx = Math.abs(rx); ry = Math.abs(ry)
  if (!rx || !ry) return [['L', x, y]]
  const phi = (rotDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi)
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let co = den ? Math.sqrt(Math.max(0, num / den)) : 0
  if (!!large === !!sweep) co = -co
  const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx
  const cx = cp * cxp - sp * cyp + (x0 + x) / 2, cy = sp * cxp + cp * cyp + (y0 + y) / 2
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a }
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!sweep && dth > 0) dth -= 2 * Math.PI
  else if (sweep && dth < 0) dth += 2 * Math.PI
  const segs = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-9)), step = dth / segs
  const t = (4 / 3) * Math.tan(step / 4), out = []
  const pt = (a) => [cx + rx * Math.cos(a) * cp - ry * Math.sin(a) * sp, cy + rx * Math.cos(a) * sp + ry * Math.sin(a) * cp]
  const dv = (a) => [-rx * Math.sin(a) * cp - ry * Math.cos(a) * sp, -rx * Math.sin(a) * sp + ry * Math.cos(a) * cp]
  let a = th1
  for (let i = 0; i < segs; i++) {
    const b = a + step, p0 = pt(a), p3 = i === segs - 1 ? [x, y] : pt(b), d0 = dv(a), d3 = dv(b)
    out.push(['C', p0[0] + t * d0[0], p0[1] + t * d0[1], p3[0] - t * d3[0], p3[1] - t * d3[1], p3[0], p3[1]])
    a = b
  }
  return out
}

/** Parse SVG path data into absolute M/L/C/Z commands (H, V, Q, T, S, A, relative forms handled). */
export function parseD(str) {
  const toks = String(str || '').match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []
  const out = []
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = '', lc = null, lq = null
  const nx = () => parseFloat(toks[i++])
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++]
    else if (!cmd) break
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()
    const ox = rel ? cx : 0, oy = rel ? cy : 0
    let nlc = null, nlq = null
    if (C === 'Z') { out.push(['Z']); cx = sx; cy = sy; cmd = '' }
    else if (C === 'M') {
      const x = nx() + ox, y = nx() + oy
      if (!Number.isFinite(x + y)) break
      out.push(['M', x, y]); cx = sx = x; cy = sy = y; cmd = rel ? 'l' : 'L'
    } else if (C === 'L') { const x = nx() + ox, y = nx() + oy; out.push(['L', x, y]); cx = x; cy = y }
    else if (C === 'H') { const x = nx() + ox; out.push(['L', x, cy]); cx = x }
    else if (C === 'V') { const y = nx() + oy; out.push(['L', cx, y]); cy = y }
    else if (C === 'C') { const a = nx() + ox, b = nx() + oy, c = nx() + ox, d = nx() + oy, x = nx() + ox, y = nx() + oy; out.push(['C', a, b, c, d, x, y]); nlc = [c, d]; cx = x; cy = y }
    else if (C === 'S') {
      const [a, b] = lc ? [2 * cx - lc[0], 2 * cy - lc[1]] : [cx, cy]
      const c = nx() + ox, d = nx() + oy, x = nx() + ox, y = nx() + oy; out.push(['C', a, b, c, d, x, y]); nlc = [c, d]; cx = x; cy = y
    } else if (C === 'Q' || C === 'T') {
      let qx, qy
      if (C === 'Q') { qx = nx() + ox; qy = nx() + oy } else { [qx, qy] = lq ? [2 * cx - lq[0], 2 * cy - lq[1]] : [cx, cy] }
      const x = nx() + ox, y = nx() + oy
      out.push(['C', cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y]); nlq = [qx, qy]; cx = x; cy = y
    } else if (C === 'A') {
      const rx = nx(), ry = nx(), rot = nx(), la = nx(), sw = nx(), x = nx() + ox, y = nx() + oy
      out.push(...arcToCubics(cx, cy, rx, ry, rot, la, sw, x, y)); cx = x; cy = y
    } else break
    lc = nlc; lq = nlq
    if (!Number.isFinite(cx + cy)) break
  }
  return out
}

/** Points of a polyline/polygon attribute -> commands. */
export function pointsPath(str, close) {
  const n = (String(str || '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number)
  const d = []
  for (let i = 0; i + 1 < n.length; i += 2) d.push([i ? 'L' : 'M', n[i], n[i + 1]])
  if (close && d.length) d.push(['Z'])
  return d
}

/** Counts for the result panel. */
export function docStats(doc) {
  let paths = 0, nodes = 0, images = 0, texts = 0
  for (const p of doc.pages) for (const it of p.items) {
    if (it.t === 'path') { paths++; nodes += it.d.filter((c) => c[0] !== 'Z').length } else if (it.t === 'image') images++; else if (it.t === 'text') texts++
  }
  return { pages: doc.pages.length, paths, nodes, images, texts }
}

export const MM = 72 / 25.4
export const ptToMm = (v) => v / MM

/** Decode a data: URL to bytes and its MIME type. */
export function dataUrlBytes(url) {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url)
  if (!m) throw new Error('Not a data URL')
  const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3])
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return { mime: m[1] || 'application/octet-stream', bytes }
}
export function bytesToDataUrl(bytes, mime) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(s)}`
}

/** Decode an image item to RGBA pixels with the browser (needs a DOM). */
export async function imagePixels(it, maxSide = 4096) {
  const img = new Image()
  img.src = it.href
  await img.decode()
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k))
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  return { w, h, data: ctx.getImageData(0, 0, w, h).data }
}

// ---------- Standard fonts (EPS and PDF text without outlines) ----------
/** Map a CSS-like family and style to a standard PostScript font name. */
export function baseFont(family = '', bold = false, italic = false) {
  const f = String(family).toLowerCase()
  const kind = /mono|courier|consolas|menlo|code/.test(f) ? 'c' : /serif|times|georgia|garamond|palatino|cambria|book/.test(f) && !/sans/.test(f) ? 't' : 'h'
  if (kind === 'c') return 'Courier' + (bold || italic ? '-' + (bold ? 'Bold' : '') + (italic ? 'Oblique' : '') : '')
  if (kind === 't') return bold || italic ? 'Times-' + (bold ? 'Bold' : '') + (italic ? 'Italic' : '') : 'Times-Roman'
  return 'Helvetica' + (bold || italic ? '-' + (bold ? 'Bold' : '') + (italic ? 'Oblique' : '') : '')
}
const WIN = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f }
/** String -> WinAnsi (cp1252) bytes; characters outside it become '?'. */
export function winAnsi(str) {
  const out = []
  for (const ch of String(str)) {
    const c = ch.codePointAt(0)
    out.push(c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : WIN[c] ?? 63)
  }
  return Uint8Array.from(out)
}
