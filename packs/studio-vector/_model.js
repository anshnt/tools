// Document model for Vector Studio: nodes, tree helpers, bounding boxes and transforms.
// The document is plain JSON: {v, seq, ab: {w, h, bg, transparent}, nodes: [node]} (nodes are listed back to front).
// Node types: group {kids}, rect, ellipse, path {subs}, text, image. Groups never carry a transform: moving or scaling
// a group pushes the matrix down to its children, so geometry always stays editable.
import { I, mul, ap, lin, isIdent, subsBBox, ellipseSubs, rectSubs, transformSubs, cloneSubs } from './_geom.js'

export const FONTS = [
  ['Inter, "Segoe UI", system-ui, sans-serif', 'Sans serif'], ['Georgia, "Times New Roman", serif', 'Serif'], ['"Courier New", ui-monospace, monospace', 'Monospace'],
  ['Arial, Helvetica, sans-serif', 'Arial'], ['Verdana, Geneva, sans-serif', 'Verdana'], ['"Trebuchet MS", sans-serif', 'Trebuchet'],
  ['"Times New Roman", Times, serif', 'Times New Roman'], ['Impact, "Arial Black", sans-serif', 'Impact'], ['"Brush Script MT", cursive', 'Script'],
]
export const solid = (c, a = 1) => ({ t: 'solid', c, a })
export const DEFAULT_STYLE = { fill: solid('#6c5ce7'), stroke: solid('#1b1b2f'), sw: 2, dash: '', cap: 'butt', join: 'miter', ml: 4, rule: 'nonzero', op: 1 }
const STYLE_KEYS = ['fill', 'stroke', 'sw', 'dash', 'cap', 'join', 'ml', 'rule']
export const NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', path: 'Path', text: 'Text', group: 'Group', image: 'Image' }

export function newDoc(w = 1200, h = 800) {
  return { v: 1, seq: 0, ab: { w, h, bg: '#ffffff', transparent: false }, nodes: [] }
}

/** Create a node with a fresh id. Style comes from `style` (a style object); geometry from props. */
export function mk(doc, type, props = {}, style = null) {
  const n = { id: 'n' + ++doc.seq, type, name: '', vis: true, lock: false, op: 1 }
  if (type === 'group') n.kids = []
  else if (type !== 'image') Object.assign(n, pickStyle(style || DEFAULT_STYLE))
  return Object.assign(n, props)
}
export const pickStyle = (s) => { const o = {}; for (const k of STYLE_KEYS) o[k] = s[k] == null ? null : structuredClone(s[k]); return o }
export const label = (n) => n.name || (n.type === 'text' ? (n.text.split('\n')[0] || 'Text').slice(0, 24) : NAMES[n.type] || n.type)

// ---------- Tree ----------
export function walk(nodes, fn, parent = null) {
  for (const n of nodes) {
    if (fn(n, parent) === false) continue
    if (n.kids) walk(n.kids, fn, n)
  }
}
export function find(doc, id, nodes = doc.nodes, parent = null) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.id === id) return { node: n, list: nodes, index: i, parent }
    if (n.kids) { const r = find(doc, id, n.kids, n); if (r) return r }
  }
  return null
}
export const get = (doc, id) => find(doc, id)?.node || null
export const isLeaf = (n) => n.type !== 'group'
export function leaves(n, out = []) {
  if (n.type === 'group') for (const k of n.kids) leaves(k, out)
  else out.push(n)
  return out
}
/** Path from the root list to the node: [topmost ancestor, ..., node]. */
export function lineage(doc, id) {
  const chain = []
  const rec = (nodes, trail) => {
    for (const n of nodes) {
      const t = [...trail, n]
      if (n.id === id) { chain.push(...t); return true }
      if (n.kids && rec(n.kids, t)) return true
    }
    return false
  }
  rec(doc.nodes, [])
  return chain
}
export function cloneNode(doc, n) {
  const c = structuredClone(n)
  const reid = (x) => { x.id = 'n' + ++doc.seq; x.kids?.forEach(reid) }
  reid(c)
  return c
}
/** Selected nodes that are not inside another selected node. */
export function topSelected(doc, ids) {
  const set = new Set(ids)
  return ids.map((id) => get(doc, id)).filter((n) => n && !lineage(doc, n.id).slice(0, -1).some((a) => set.has(a.id)))
}

// ---------- Geometry in document space ----------
let measureSvg = null
const measureCache = new Map()
/** Text bounding box in the text's own coordinates (before its transform), measured by the browser. */
export function measureText(n) {
  const key = [n.text, n.ff, n.fs, n.fw, n.fi, n.ls, n.lh, n.ta].join('|')
  let r = measureCache.get(key)
  if (!r) {
    const lines = n.text.split('\n')
    try {
      if (!measureSvg || !measureSvg.isConnected) {
        measureSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        measureSvg.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:10px;height:10px;visibility:hidden;pointer-events:none')
        document.body.append(measureSvg)
      }
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.setAttribute('font-family', n.ff); t.setAttribute('font-size', n.fs); t.setAttribute('font-weight', n.fw)
      if (n.fi) t.setAttribute('font-style', 'italic')
      if (n.ls) t.setAttribute('letter-spacing', n.ls)
      t.setAttribute('text-anchor', n.ta); t.setAttribute('xml:space', 'preserve')
      lines.forEach((ln, i) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'tspan'); s.setAttribute('x', 0); s.setAttribute('y', i * n.fs * n.lh); s.textContent = ln || ' '; t.append(s) })
      measureSvg.append(t)
      const b = t.getBBox()
      t.remove()
      r = { x: b.x, y: b.y, w: b.width, h: b.height }
    } catch { r = null }
    if (!r || !(r.w > 0)) r = { x: n.ta === 'middle' ? -lines[0].length * n.fs * 0.28 : n.ta === 'end' ? -lines[0].length * n.fs * 0.56 : 0, y: -n.fs * 0.9, w: Math.max(...lines.map((l) => l.length), 1) * n.fs * 0.56, h: lines.length * n.fs * n.lh }
    if (measureCache.size > 400) measureCache.clear()
    measureCache.set(key, r)
  }
  return { x: n.x + r.x, y: n.y + r.y, w: r.w, h: r.h }
}

/** Geometry of a leaf in its own coordinates (before node.t): {x, y, w, h}. */
export function localBBox(n) {
  switch (n.type) {
    case 'rect': case 'image': return { x: n.x, y: n.y, w: n.w, h: n.h }
    case 'ellipse': return { x: n.cx - n.rx, y: n.cy - n.ry, w: n.rx * 2, h: n.ry * 2 }
    case 'path': return subsBBox(n.subs)
    case 'text': return measureText(n)
    default: return null
  }
}
const cornersOf = (b, t) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => (t ? ap(t, x, y) : [x, y]))
const boxOf = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
export const unionBox = (a, b) => {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
/** World-space bounding box of a node (groups: union of visible children), or null. */
export function bboxOf(n, includeHidden = false) {
  if (n.type === 'group') return n.kids.reduce((acc, k) => (k.vis || includeHidden ? unionBox(acc, bboxOf(k, includeHidden)) : acc), null)
  if (n.type === 'ellipse' && n.t) return subsBBox(transformSubs(ellipseSubs(n.cx, n.cy, n.rx, n.ry), n.t))
  const b = localBBox(n)
  if (!b) return null
  return n.t ? boxOf(cornersOf(b, n.t)) : b
}
export const bboxOfAll = (nodes) => nodes.reduce((acc, n) => unionBox(acc, bboxOf(n)), null)

/** World-space sub-paths for any shape (text and images are not convertible). */
export function toSubs(n) {
  let subs
  if (n.type === 'path') return cloneSubs(n.subs)
  if (n.type === 'rect') subs = rectSubs(n.x, n.y, n.w, n.h, n.rx, n.ry ?? n.rx)
  else if (n.type === 'ellipse') subs = ellipseSubs(n.cx, n.cy, n.rx, n.ry)
  else return null
  return n.t ? transformSubs(subs, n.t) : subs
}

// ---------- Transforms ----------
const near = (a, b = 0) => Math.abs(a - b) < 1e-9
/** Apply a world-space matrix to a node in place. Paths bake it into their points; rects, ellipses and text bake it when it is a plain scale/move. */
export function applyMatrix(n, M) {
  if (n.type === 'group') { for (const k of n.kids) applyMatrix(k, M); return }
  if (n.type === 'path') { n.subs = transformSubs(n.subs, M); return }
  const t = mul(M, n.t || I)
  const axis = near(t[1]) && near(t[2])
  if (axis && (n.type === 'rect' || n.type === 'image')) {
    const x0 = t[0] * n.x + t[4], x1 = t[0] * (n.x + n.w) + t[4], y0 = t[3] * n.y + t[5], y1 = t[3] * (n.y + n.h) + t[5]
    n.x = Math.min(x0, x1); n.y = Math.min(y0, y1); n.w = Math.abs(x1 - x0); n.h = Math.abs(y1 - y0)
    if (n.type === 'rect') { const rx = n.rx || 0, ry = n.ry ?? rx; n.rx = rx * Math.abs(t[0]); n.ry = ry * Math.abs(t[3]) }
    delete n.t
  } else if (axis && n.type === 'ellipse') {
    n.cx = t[0] * n.cx + t[4]; n.cy = t[3] * n.cy + t[5]; n.rx *= Math.abs(t[0]); n.ry *= Math.abs(t[3])
    delete n.t
  } else if (n.type === 'text' && axis && near(t[0], t[3]) && t[0] > 0) {
    n.x = t[0] * n.x + t[4]; n.y = t[0] * n.y + t[5]; n.fs *= t[0]; n.ls = (n.ls || 0) * t[0]
    delete n.t
  } else if (isIdent(t)) delete n.t
  else n.t = t
}

/** Replace a node's contents in place with a snapshot (keeps the object identity so the tree stays valid). */
export function restoreNode(n, snap) {
  for (const k of Object.keys(n)) delete n[k]
  Object.assign(n, structuredClone(snap))
}

/** Convert a rect or ellipse to an editable path node in place. */
export function convertToPath(n) {
  if (n.type !== 'rect' && n.type !== 'ellipse') return false
  const subs = toSubs(n)
  for (const k of ['x', 'y', 'w', 'h', 'rx', 'ry', 'cx', 'cy', 't']) delete n[k]
  n.type = 'path'; n.subs = subs
  return true
}

// ---------- Styles ----------
export function applyStyle(n, patch) {
  if (n.type === 'group') { for (const k of n.kids) applyStyle(k, patch); return }
  if (n.type === 'image') { if ('op' in patch) n.op = patch.op; return }
  for (const [k, v] of Object.entries(patch)) if (k !== 'op') n[k] = v == null ? null : structuredClone(v)
}
export function styleOf(nodes) {
  const first = nodes.flatMap((n) => leaves(n)).find((n) => n.type !== 'image')
  return first ? { ...pickStyle(first), op: nodes[0].op } : null
}
export const hasStroke = (n) => n.type !== 'group' && n.type !== 'image' && n.stroke && n.sw > 0
