// Layout Studio document model: units, presets, factories and geometry helpers. Everything is plain JSON (points).
export const uid = (p = 'i') => p + Math.random().toString(36).slice(2, 9)
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f }

/** Display units. Everything is stored in points; f = points per unit. */
export const UNITS = { mm: { f: 72 / 25.4, d: 2 }, pt: { f: 1, d: 1 }, in: { f: 72, d: 3 }, px: { f: 0.75, d: 1 } }
export const toUnit = (pt, u) => round(pt / UNITS[u].f, UNITS[u].d)
export const fromUnit = (v, u) => v * UNITS[u].f

/** Page size presets in points (portrait). */
export const PAGE_PRESETS = [
  ['A3', 'A3', 841.89, 1190.55], ['A4', 'A4', 595.28, 841.89], ['A5', 'A5', 419.53, 595.28], ['A6', 'A6', 297.64, 419.53],
  ['Letter', 'US Letter', 612, 792], ['Legal', 'US Legal', 612, 1008], ['Tabloid', 'Tabloid 11 x 17 in', 792, 1224],
  ['Poster', 'Poster 18 x 24 in', 1296, 1728], ['Card', 'Business card 3.5 x 2 in', 252, 144], ['CardEU', 'Business card 85 x 55 mm', 240.94, 155.91],
  ['Square', 'Square 8 in', 576, 576],
]
export const presetSize = (id) => { const p = PAGE_PRESETS.find((x) => x[0] === id); return p ? [p[2], p[3]] : null }
export const matchPreset = (w, h) => {
  const p = PAGE_PRESETS.find((x) => (Math.abs(x[2] - w) < 0.6 && Math.abs(x[3] - h) < 0.6) || (Math.abs(x[2] - h) < 0.6 && Math.abs(x[3] - w) < 0.6))
  return p ? p[0] : 'Custom'
}

export const PALETTE = ['#111827', '#ffffff', '#5b4cf0', '#c026d3', '#ef4444', '#f59e0b', '#10b981', '#0ea5e9', '#f3f4f6', '#fde68a']

export function defaultStyles() {
  const base = { font: 'inter', size: 10, lh: 1.5, weight: 400, italic: false, color: '#222733', align: 'left', before: 0, after: 6, indent: 0, left: 0, tracking: 0, caps: false, list: 'none' }
  return {
    para: [
      { ...base, id: 'body', name: 'Body' },
      { ...base, id: 'title', name: 'Title', font: 'playfair-display', size: 44, lh: 1.05, weight: 800, color: '#111827', after: 10 },
      { ...base, id: 'h1', name: 'Heading 1', size: 24, lh: 1.15, weight: 700, color: '#111827', before: 8, after: 6 },
      { ...base, id: 'h2', name: 'Heading 2', size: 14, lh: 1.25, weight: 600, color: '#111827', before: 6, after: 4 },
      { ...base, id: 'lead', name: 'Lead', size: 13, lh: 1.45, color: '#394150', after: 8 },
      { ...base, id: 'caption', name: 'Caption', size: 8, lh: 1.35, color: '#667085', after: 2 },
      { ...base, id: 'quote', name: 'Pull quote', font: 'playfair-display', size: 18, lh: 1.3, weight: 500, italic: true, color: '#5b4cf0', after: 8 },
      { ...base, id: 'bullets', name: 'Bullets', list: 'bullet', left: 14, after: 3 },
    ],
    char: [
      { id: 'strong', name: 'Strong', weight: 700 },
      { id: 'emph', name: 'Emphasis', italic: true },
      { id: 'accent', name: 'Accent', color: '#5b4cf0', weight: 700 },
      { id: 'mono', name: 'Code', font: 'roboto-mono' },
      { id: 'label', name: 'Small label', caps: true, tracking: 90, size: 8, weight: 600 },
    ],
  }
}

export function newDoc({ w = 595.28, h = 841.89, bleed = 0, margin = 36, cols = 1, gutter = 14, pages = 1, name = 'Untitled layout', unit = 'mm' } = {}) {
  const layer = { id: uid('l'), name: 'Layer 1', visible: true, locked: false }
  const doc = {
    v: 1, id: uid('d'), name, w, h, bleed, unit,
    margins: { t: margin, r: margin, b: margin, l: margin }, cols, gutter,
    grid: { size: 18, baseline: 12, showGrid: false, showBaseline: false },
    view: { guides: true, margins: true, frames: true, rulers: true, snap: true, snapGrid: false, bleed: true },
    layers: [layer], styles: defaultStyles(), swatches: [...PALETTE], stories: {},
    masters: [{ id: uid('m'), name: 'A-Master', items: [] }], pages: [],
  }
  for (let i = 0; i < pages; i++) doc.pages.push(newPage(doc))
  return doc
}
export const newPage = (doc, master = doc.masters[0]?.id || null) => ({ id: uid('p'), master, items: [], guides: { v: [], h: [] } })

/** Fill in anything a stored or imported document lacks so the editor can rely on the shape. */
export function normalizeDoc(d) {
  const base = newDoc({ w: d.w, h: d.h })
  const doc = { ...base, ...d }
  doc.margins = { ...base.margins, ...d.margins }
  doc.grid = { ...base.grid, ...d.grid }
  doc.view = { ...base.view, ...d.view }
  doc.styles = { para: d.styles?.para?.length ? d.styles.para : base.styles.para, char: d.styles?.char || base.styles.char }
  doc.layers = d.layers?.length ? d.layers : base.layers
  doc.swatches = d.swatches?.length ? d.swatches : base.swatches
  doc.stories = d.stories || {}
  doc.masters = d.masters?.length ? d.masters : [{ id: uid('m'), name: 'A-Master', items: [] }]
  doc.pages = d.pages?.length ? d.pages : [newPage(doc)]
  for (const p of doc.pages) { p.items ||= []; p.guides ||= { v: [], h: [] } }
  for (const m of doc.masters) m.items ||= []
  return doc
}

// ---------- Containers (pages and masters) and items ----------
export const containers = (doc) => [...doc.pages.map((p) => ({ kind: 'page', c: p })), ...doc.masters.map((m) => ({ kind: 'master', c: m }))]
export function findItem(doc, id) {
  for (const { kind, c } of containers(doc)) {
    const i = c.items.findIndex((it) => it.id === id)
    if (i >= 0) return { item: c.items[i], container: c, kind, index: i }
  }
  return null
}
export const getPage = (doc, id) => doc.pages.find((p) => p.id === id)
export const getMaster = (doc, id) => doc.masters.find((m) => m.id === id)
export const layerIndex = (doc, id) => Math.max(0, doc.layers.findIndex((l) => l.id === id))
export const layerById = (doc, id) => doc.layers.find((l) => l.id === id)
/** Items of a container in paint order (bottom to top): by layer, then array order. */
export function paintOrder(doc, container) {
  return container.items.map((it, i) => [it, i]).sort((a, b) => layerIndex(doc, a[0].layer) - layerIndex(doc, b[0].layer) || a[1] - b[1]).map((x) => x[0])
}
export const isLayerVisible = (doc, item) => layerById(doc, item.layer)?.visible !== false
export const isLocked = (doc, item) => !!item.locked || layerById(doc, item.layer)?.locked === true

export function paraStyle(doc, id) { return doc.styles.para.find((s) => s.id === id) || doc.styles.para[0] }
export const charStyle = (doc, id) => doc.styles.char.find((s) => s.id === id)

// ---------- Item factories ----------
const ITEM_DEFAULTS = {
  text: { fill: null, stroke: null, sw: 0, cols: 1, gap: 12, inset: 0, valign: 'top', radius: 0 },
  image: { asset: null, fit: 'fill', zoom: 1, ox: 0, oy: 0, fill: null, stroke: null, sw: 0, radius: 0 },
  rect: { fill: '#5b4cf0', stroke: null, sw: 0, radius: 0, dash: 0 },
  ellipse: { fill: '#5b4cf0', stroke: null, sw: 0, dash: 0 },
  line: { stroke: '#111827', sw: 2, dash: 0 },
}
export function newItem(doc, type, geo, props = {}, layer) {
  return { id: uid('f'), type, x: 0, y: 0, w: 100, h: 100, rot: 0, opacity: 1, locked: false, layer: layer || doc.layers[0].id, ...ITEM_DEFAULTS[type], ...geo, ...props }
}

/** Paragraph model: {ps, o: overrides, runs: [{t, b, i, u, c, cs}]}. Plain text helpers: */
export const para = (text, ps = 'body', extra = {}) => ({ ps, o: {}, runs: [{ t: text, ...extra }] })
export const storyText = (st) => st.paras.map((p) => p.runs.map((r) => r.t).join('')).join('\n')
export function storyFromText(text, ps = 'body') { return { paras: String(text).split('\n').map((l) => para(l, ps)) } }

/** Create a text frame with its own story. paras: strings or paragraph objects. */
export function addText(doc, container, geo, paras, props = {}) {
  const sid = uid('s')
  doc.stories[sid] = { paras: paras.map((p) => (typeof p === 'string' ? para(p) : p)) }
  const it = newItem(doc, 'text', geo, { story: sid, next: null, ...props })
  container.items.push(it)
  return it
}
export function addShape(doc, container, type, geo, props = {}) {
  const it = newItem(doc, type, geo, props)
  container.items.push(it)
  return it
}

// ---------- Geometry ----------
export const rad = (d) => (d * Math.PI) / 180
export const center = (it) => ({ x: it.x + it.w / 2, y: it.y + it.h / 2 })
export function rotateAround(p, c, deg) {
  const a = rad(deg), s = Math.sin(a), co = Math.cos(a)
  const dx = p.x - c.x, dy = p.y - c.y
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co }
}
export function corners(it) {
  const c = center(it)
  return [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]].map(([x, y]) => (it.rot ? rotateAround({ x, y }, c, it.rot) : { x, y }))
}
export function aabb(it) {
  const pts = corners(it)
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}
export function unionBox(items) {
  if (!items.length) return null
  const bs = items.map(aabb)
  const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y))
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y }
}
/** Point (container coordinates) inside the item? tol widens thin things like lines. */
export function hit(it, p, tol = 0) {
  const c = center(it)
  const q = it.rot ? rotateAround(p, c, -it.rot) : p
  if (it.type === 'line') {
    const t = Math.max(tol, it.sw / 2 + 2)
    return q.x >= it.x - t && q.x <= it.x + it.w + t && Math.abs(q.y - (it.y + it.h / 2)) <= t
  }
  if (it.type === 'ellipse') {
    const rx = it.w / 2 + tol, ry = it.h / 2 + tol
    return ((q.x - c.x) / rx) ** 2 + ((q.y - c.y) / ry) ** 2 <= 1
  }
  return q.x >= it.x - tol && q.x <= it.x + it.w + tol && q.y >= it.y - tol && q.y <= it.y + it.h + tol
}

// ---------- Text chains ----------
/** Ordered frame chains per story across all pages and masters: Map(storyId -> [items]). Cycles are cut. */
export function storyChains(doc) {
  const byStory = new Map()
  for (const { c } of containers(doc)) for (const it of c.items) if (it.type === 'text') (byStory.get(it.story) || byStory.set(it.story, []).get(it.story)).push(it)
  const chains = new Map()
  for (const [sid, frames] of byStory) {
    const byId = new Map(frames.map((f) => [f.id, f]))
    const hasPrev = new Set(frames.map((f) => f.next).filter(Boolean))
    const head = frames.find((f) => !hasPrev.has(f.id)) || frames[0]
    const chain = []
    for (let f = head, n = 0; f && n < 500; f = byId.get(f.next), n++) { if (chain.includes(f)) break; chain.push(f) }
    chains.set(sid, chain)
  }
  return chains
}

/** Page-level snap/guide lines (x list, y list) for a page: edges, margins, columns, ruler guides. */
export function guideLines(doc, page) {
  const m = doc.margins
  const xs = [0, doc.w, m.l, doc.w - m.r], ys = [0, doc.h, m.t, doc.h - m.b]
  if (doc.cols > 1) {
    const cw = columnWidth(doc)
    for (let i = 0; i < doc.cols; i++) { const x = m.l + i * (cw + doc.gutter); xs.push(x, x + cw) }
  }
  const g = page?.guides
  if (g) { xs.push(...g.v); ys.push(...g.h) }
  return { xs, ys }
}
export const columnWidth = (doc) => (doc.w - doc.margins.l - doc.margins.r - doc.gutter * (doc.cols - 1)) / doc.cols

/** Copy an item (text frames get their own copy of the story, unthreaded). Pass `stories` as the source map for cross-document paste. */
export function cloneItem(doc, it, dx = 0, dy = 0, stories = doc.stories) {
  const c = JSON.parse(JSON.stringify(it))
  c.id = uid('f'); c.x += dx; c.y += dy
  if (c.type === 'text') {
    c.next = null
    const sid = uid('s')
    doc.stories[sid] = JSON.parse(JSON.stringify(stories[it.story] || { paras: [para('')] }))
    c.story = sid
  }
  return c
}

/** Copy several items at once, keeping their groups together (each copy of a group gets a fresh group id). */
export function cloneMany(doc, items, dx = 0, dy = 0, stories = doc.stories) {
  const groups = new Map()
  return items.map((it) => {
    const c = cloneItem(doc, it, dx, dy, stories)
    if (c.grp) { if (!groups.has(c.grp)) groups.set(c.grp, uid('g')); c.grp = groups.get(c.grp) }
    return c
  })
}
/** All items that move together with `ids`: whole groups, within the same page or master. */
export function expandGroups(doc, ids) {
  const out = new Set(ids)
  for (const { c } of containers(doc)) {
    const groups = new Set(c.items.filter((i) => out.has(i.id) && i.grp).map((i) => i.grp))
    if (groups.size) for (const i of c.items) if (groups.has(i.grp)) out.add(i.id)
  }
  return [...out]
}
