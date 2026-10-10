// Annotation model: defaults, geometry (bounds, hit test, move, resize), text layout and the SVG renderer used on screen.
// The PDF writer (_export.js) uses the same geometry and layoutText() so what you see is what gets saved.
import { svg } from '../../lib/ui.js'
import { uid, inside, grow, distToSeg, smoothSegs, segsToD, bbox, num } from './_geom.js'

export const PALETTE = ['#fde047', '#86efac', '#7dd3fc', '#f9a8d4', '#fdba74', '#ef4444', '#2563eb', '#16a34a', '#7c3aed', '#111827', '#ffffff']
export const FONTS = {
  helv: { label: 'Sans', css: 'Helvetica, Arial, "Liberation Sans", sans-serif' },
  times: { label: 'Serif', css: '"Times New Roman", Times, "Liberation Serif", serif' },
  cour: { label: 'Mono', css: '"Courier New", Courier, "Liberation Mono", monospace' },
}
export const LABELS = {
  highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', ink: 'Drawing', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow',
  note: 'Note', text: 'Text box', image: 'Image', whiteout: 'White-out', redact: 'Redaction',
}
export const MARKUP = new Set(['highlight', 'underline', 'strike'])
export const RECTLIKE = new Set(['rect', 'ellipse', 'text', 'image', 'whiteout', 'redact'])
export const NOTE_SIZE = 22

export const DEFAULTS = {
  highlight: { color: '#fde047', opacity: 0.45 },
  underline: { color: '#ef4444', opacity: 1 },
  strike: { color: '#ef4444', opacity: 1 },
  ink: { color: '#2563eb', width: 2.5, opacity: 1 },
  rect: { stroke: '#ef4444', fill: null, width: 2, opacity: 1 },
  ellipse: { stroke: '#ef4444', fill: null, width: 2, opacity: 1 },
  line: { stroke: '#ef4444', width: 2, opacity: 1 },
  arrow: { stroke: '#ef4444', width: 2, opacity: 1 },
  note: { color: '#fbbf24' },
  text: { color: '#111827', size: 14, font: 'helv', bold: false, italic: false, fill: null, border: null, align: 'left' },
  image: {},
  whiteout: {},
  redact: {},
}

export function makeAnnot(type, pid, props, author = '') {
  return { id: uid('a'), type, pid, ...structuredClone(DEFAULTS[type] || {}), ...props, author, date: new Date().toISOString() }
}

// ---------- text layout (shared with the exporter) ----------
let mctx
export function fontString(a) {
  return `${a.italic ? 'italic ' : ''}${a.bold ? '700 ' : '400 '}${a.size}px ${(FONTS[a.font] || FONTS.helv).css}`
}
export function measurer(a) {
  mctx ??= document.createElement('canvas').getContext('2d')
  mctx.font = fontString(a)
  return (s) => mctx.measureText(s).width
}
const PAD = 3
/** Word-wrap a text annotation: {lines: [{text, x, y, w}], h} with y = baseline. */
export function layoutText(a) {
  const m = measurer(a)
  const lh = a.size * 1.2
  const maxW = Math.max(a.size, a.w - PAD * 2)
  const raw = []
  for (const para of String(a.text || '').split('\n')) {
    if (!para) { raw.push(''); continue }
    let cur = ''
    for (const word of para.split(' ')) {
      const test = cur ? `${cur} ${word}` : word
      if (!cur || m(test) <= maxW) { cur = test; continue }
      raw.push(cur)
      cur = word
    }
    // break a single very long word by characters
    while (m(cur) > maxW && cur.length > 1) {
      let i = cur.length - 1
      while (i > 1 && m(cur.slice(0, i)) > maxW) i--
      raw.push(cur.slice(0, i))
      cur = cur.slice(i)
    }
    raw.push(cur)
  }
  const lines = raw.map((text, i) => {
    const w = m(text)
    const x = a.align === 'center' ? a.x + (a.w - w) / 2 : a.align === 'right' ? a.x + a.w - PAD - w : a.x + PAD
    return { text, w, x, y: a.y + PAD + i * lh + (lh - a.size) / 2 + a.size * 0.82 }
  })
  return { lines, h: raw.length * lh + PAD * 2, lh }
}

// ---------- geometry ----------
export function bounds(a) {
  switch (a.type) {
    case 'highlight': case 'underline': case 'strike': {
      const r = a.rects
      const x1 = Math.min(...r.map((q) => q[0])), y1 = Math.min(...r.map((q) => q[1]))
      return { x: x1, y: y1, w: Math.max(...r.map((q) => q[0] + q[2])) - x1, h: Math.max(...r.map((q) => q[1] + q[3])) - y1 }
    }
    case 'ink': return grow(bbox(a.paths.flat()), a.width / 2)
    case 'line': case 'arrow': return grow(bbox([[a.x1, a.y1], [a.x2, a.y2]]), a.width / 2 + (a.type === 'arrow' ? headLen(a) / 2 : 0))
    case 'note': return { x: a.x, y: a.y, w: NOTE_SIZE, h: NOTE_SIZE }
    case 'text': return { x: a.x, y: a.y, w: a.w, h: Math.max(a.h, layoutText(a).h) }
    default: return { x: a.x, y: a.y, w: a.w, h: a.h }
  }
}

export function hit(a, x, y, tol) {
  switch (a.type) {
    case 'highlight': case 'underline': case 'strike': return a.rects.some((r) => inside({ x: r[0], y: r[1], w: r[2], h: r[3] }, x, y, tol / 2))
    case 'ink': return a.paths.some((p) => p.some((pt, i) => distToSeg(x, y, pt[0], pt[1], (p[i + 1] || pt)[0], (p[i + 1] || pt)[1]) <= a.width / 2 + tol))
    case 'line': case 'arrow': return distToSeg(x, y, a.x1, a.y1, a.x2, a.y2) <= a.width / 2 + tol
    case 'rect': {
      const r = { x: a.x, y: a.y, w: a.w, h: a.h }
      if (a.fill) return inside(r, x, y, tol)
      const d = a.width / 2 + tol
      return inside(grow(r, d), x, y) && !inside(grow(r, -d), x, y)
    }
    case 'ellipse': {
      const rx = a.w / 2, ry = a.h / 2
      if (rx <= 0 || ry <= 0) return false
      const r = Math.hypot((x - a.x - rx) / rx, (y - a.y - ry) / ry)
      return a.fill ? r <= 1 + tol / Math.min(rx, ry) : Math.abs(r - 1) * Math.min(rx, ry) <= a.width / 2 + tol
    }
    default: return inside(bounds(a), x, y, tol)
  }
}

/** Shift an annotation by (dx, dy) in base units. */
export function translate(a, dx, dy) {
  switch (a.type) {
    case 'highlight': case 'underline': case 'strike': for (const r of a.rects) { r[0] += dx; r[1] += dy } break
    case 'ink': for (const p of a.paths) for (const pt of p) { pt[0] += dx; pt[1] += dy } break
    case 'line': case 'arrow': a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; break
    default: a.x += dx; a.y += dy
  }
}

export const MIN_SIZE = 8
/** Resize a rect-like annotation from `orig` {x,y,w,h} by dragging a handle (n, ne, e, se, s, sw, w, nw) to pt. */
export function resizeRect(a, orig, handle, pt, keepAspect) {
  let left = orig.x, right = orig.x + orig.w, top = orig.y, bottom = orig.y + orig.h
  if (handle.includes('w')) left = Math.min(pt.x, right - MIN_SIZE)
  if (handle.includes('e')) right = Math.max(pt.x, left + MIN_SIZE)
  if (handle.includes('n')) top = Math.min(pt.y, bottom - MIN_SIZE)
  if (handle.includes('s')) bottom = Math.max(pt.y, top + MIN_SIZE)
  if (keepAspect && handle.length === 2) {
    const ratio = orig.w / (orig.h || 1)
    const w = right - left, h = Math.max(MIN_SIZE, w / ratio)
    if (handle.includes('n')) top = bottom - h
    else bottom = top + h
  }
  a.x = left; a.y = top; a.w = right - left; a.h = bottom - top
}

export const handleCursor = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse' }
export const headLen = (a) => Math.max(9, a.width * 4.5)
export function arrowHead(a) {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = headLen(a), sp = 0.46
  return [[a.x2, a.y2], [a.x2 - L * Math.cos(ang - sp), a.y2 - L * Math.sin(ang - sp)], [a.x2 - L * Math.cos(ang + sp), a.y2 - L * Math.sin(ang + sp)]]
}
export const noteShape = (x, y) => [[0, 0], [22, 0], [22, 16], [11, 16], [5, 22], [5, 16], [0, 16]].map(([px, py]) => [x + px, y + py])

// ---------- SVG rendering ----------
const stroke = (a, c) => ({ stroke: c, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-opacity': a.opacity ?? 1 })

/** Render one annotation to an SVG element in base units. env: {assets: Map, editing: id|null}. */
export function renderAnnot(a, env = {}) {
  const g = svg('g', { 'data-id': a.id, class: `an an-${a.type}` })
  if (env.editing === a.id) return g
  const add = (...k) => g.append(...k)
  switch (a.type) {
    case 'highlight':
      g.style.mixBlendMode = 'multiply'
      for (const r of a.rects) add(svg('rect', { x: r[0], y: r[1], width: r[2], height: r[3], fill: a.color, 'fill-opacity': a.opacity }))
      break
    case 'underline': case 'strike':
      for (const r of a.rects) {
        const y = a.type === 'underline' ? r[1] + r[3] - 1.2 : r[1] + r[3] * 0.52
        add(svg('line', { x1: r[0], y1: y, x2: r[0] + r[2], y2: y, stroke: a.color, 'stroke-width': Math.max(1, r[3] * 0.075), 'stroke-opacity': a.opacity ?? 1 }))
      }
      break
    case 'ink':
      for (const p of a.paths) add(svg('path', { d: segsToD(smoothSegs(p)), fill: 'none', ...stroke(a, a.color) }))
      break
    case 'rect': add(svg('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.fill || 'none', 'fill-opacity': a.opacity, ...stroke(a, a.stroke) })); break
    case 'ellipse': add(svg('ellipse', { cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: a.w / 2, ry: a.h / 2, fill: a.fill || 'none', 'fill-opacity': a.opacity, ...stroke(a, a.stroke) })); break
    case 'line': add(svg('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...stroke(a, a.stroke) })); break
    case 'arrow':
      add(svg('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...stroke(a, a.stroke) }),
        svg('polygon', { points: arrowHead(a).map((p) => p.map((v) => num(v)).join(',')).join(' '), fill: a.stroke, 'fill-opacity': a.opacity, 'stroke-linejoin': 'round' }))
      break
    case 'note':
      add(svg('polygon', { points: noteShape(a.x, a.y).map((p) => p.join(',')).join(' '), fill: a.color, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 1, 'stroke-linejoin': 'round' }),
        ...[5, 9, 13].map((o) => svg('line', { x1: a.x + 4, y1: a.y + o - 0.5, x2: a.x + 18, y2: a.y + o - 0.5, stroke: 'rgba(0,0,0,.5)', 'stroke-width': 1.2 })))
      if (a.text) add(svg('title', a.text))
      break
    case 'text': {
      const L = layoutText(a)
      const h = Math.max(a.h, L.h)
      if (a.fill || a.border) add(svg('rect', { x: a.x, y: a.y, width: a.w, height: h, fill: a.fill || 'none', stroke: a.border || 'none', 'stroke-width': 1 }))
      const t = svg('text', { fill: a.color, 'font-size': a.size, 'font-family': (FONTS[a.font] || FONTS.helv).css, 'font-weight': a.bold ? 700 : 400, 'font-style': a.italic ? 'italic' : 'normal', style: 'white-space:pre' })
      for (const l of L.lines) t.append(svg('tspan', { x: l.x, y: l.y }, l.text))
      add(t)
      break
    }
    case 'image': {
      const asset = env.assets?.get(a.asset)
      if (asset) add(svg('image', { href: asset.url, x: a.x, y: a.y, width: a.w, height: a.h, preserveAspectRatio: 'none' }))
      else add(svg('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'rgba(128,128,128,.2)' }))
      break
    }
    case 'whiteout': add(svg('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: '#fff', stroke: 'rgba(0,0,0,.18)', 'stroke-width': 0.5 })); break
    case 'redact':
      add(svg('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'rgba(220,38,38,.2)', stroke: '#dc2626', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }))
      if (a.w > 46 && a.h > 12) add(svg('text', { x: a.x + 4, y: a.y + Math.min(a.h - 3, 11), fill: '#b91c1c', 'font-size': 8.5, 'font-weight': 700, 'font-family': 'Helvetica, Arial, sans-serif' }, 'REDACT'))
      break
  }
  return g
}

/** Selection box + handles for the selected annotation. zoom keeps handles a constant on-screen size. */
export function renderSelection(a, zoom, bnds = bounds(a)) {
  const g = svg('g', { class: 'sel' })
  const k = 1 / zoom
  const hs = 9 * k
  const frame = svg('rect', { x: bnds.x, y: bnds.y, width: bnds.w, height: bnds.h, fill: 'none', stroke: '#5b4cf0', 'stroke-width': 1.5 * k, 'stroke-dasharray': `${5 * k} ${3 * k}` })
  g.append(frame)
  const handle = (name, x, y, cursor) => g.append(svg('rect', {
    x: x - hs / 2, y: y - hs / 2, width: hs, height: hs, rx: 2 * k, fill: '#fff', stroke: '#5b4cf0', 'stroke-width': 1.5 * k, 'data-h': name, style: `pointer-events:all;cursor:${cursor}-resize`,
  }))
  if (a.type === 'line' || a.type === 'arrow') {
    handle('p1', a.x1, a.y1, 'move'); handle('p2', a.x2, a.y2, 'move')
  } else if (RECTLIKE.has(a.type)) {
    const { x, y, w, h } = bnds
    const pts = { nw: [x, y], ne: [x + w, y], se: [x + w, y + h], sw: [x, y + h], n: [x + w / 2, y], s: [x + w / 2, y + h], e: [x + w, y + h / 2], w: [x, y + h / 2] }
    for (const [name, [px, py]] of Object.entries(pts)) {
      if (a.type === 'image' && name.length === 1) continue
      handle(name, px, py, handleCursor[name])
    }
  }
  return g
}

export const hasComment = (a) => a.type !== 'redact' && a.type !== 'whiteout' && a.type !== 'image'
export const clampToPage = (a, pw, ph) => {
  const b = bounds(a)
  const dx = b.x + b.w < 12 ? 12 - (b.x + b.w) : b.x > pw - 12 ? pw - 12 - b.x : 0
  const dy = b.y + b.h < 12 ? 12 - (b.y + b.h) : b.y > ph - 12 ? ph - 12 - b.y : 0
  if (dx || dy) translate(a, dx, dy)
}
