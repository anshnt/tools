// Draw Studio document model: factories, immutable tree helpers and the whitelist validator. Pure (no DOM, no lib imports).
// Every edit builds a new root by path copying, so untouched subtrees keep their identity and history is cheap.
//
//   EditorDoc { v:1, uid, title, units, nextId, pages:[Page], fonts:{key:{name,family,bold,italic,data}}, warnings:[string], palette:[hex], meta }
//   Page      { id, name, w, h, layers:[Layer], guides:[{id,axis,pos}], bg?, pending? }   (points, y down, origin top-left)
//   Layer     { id, name, hidden, locked, printable, items:[Node] }                        (index 0 is the back layer)
//   Node      Group {t:'group', items} | Path | Image {asset} | Text   every node: id, name?, hidden?, locked?
// Images keep an `asset` id (Blob store in _ds-assets.js), never a data URL. Readers hand over `href`, which _ds-open.js turns into assets.

export const LIMITS = {
  fileBytes: 250 * 1024 * 1024, files: 20, pages: 300, layers: 200, nodes: 300000, nodesWarn: 40000, depth: 40,
  cmdsPath: 500000, cmdsDoc: 3000000, clips: 16, cmdsClip: 100000, stops: 64, str: 20000, family: 160, name: 200, glyphs: 20000, size: 10000,
  images: 500, imageBytes: 400 * 1024 * 1024, imageDim: 65535, fontBytes: 20 * 1024 * 1024, fontsBytes: 64 * 1024 * 1024, pageSize: 20000, guides: 1000, palette: 200,
  openMs: 120000,
}

/** Paper sizes in points, portrait (the same values as lib/pdf.js PAGE_SIZES, repeated here so this module stays pure). */
export const PAGE_SIZES = { A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224] }

/** Which paper preset a page size is (either orientation, within 0.6 pt), as {name, landscape}, or null for a custom size. */
export function pagePreset(w, h) {
  const near = (a, b) => Math.abs(a - b) <= 0.6
  for (const [name, [pw, ph]] of Object.entries(PAGE_SIZES)) {
    if (near(w, pw) && near(h, ph)) return { name, landscape: false }
    if (near(w, ph) && near(h, pw)) return { name, landscape: true }
  }
  return null
}
/** [w, h] in points of a paper preset in the given orientation (portrait when landscape is false), or null for an unknown name. */
export function presetSize(name, landscape = false) {
  const s = PAGE_SIZES[name]
  return s ? (landscape ? [s[1], s[0]] : [s[0], s[1]]) : null
}

export const UNITS = ['mm', 'in', 'pt', 'px']
export const SOURCES = ['cdr', 'pdf', 'ai', 'ps', 'eps', 'svg', 'bitmap', 'new', 'import']
const I6 = [1, 0, 0, 1, 0, 0]

export const makeUid = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')

// ---------- factories ----------
export const newLayer = (id, name = 'Layer 1') => ({ id, name, hidden: false, locked: false, printable: true, items: [] })
export const newPage = (id, layerId, { w = PAGE_SIZES.A4[0], h = PAGE_SIZES.A4[1], name = 'Page 1' } = {}) => ({ id, name, w, h, layers: [newLayer(layerId)], guides: [] })
export const newGroup = (id, items, name = 'Group') => ({ id, t: 'group', name, items })
export function newDoc({ title = 'Untitled', w, h, units = 'mm', uid = makeUid(), source = 'new' } = {}) {
  return { v: 1, uid, title, units, nextId: 3, pages: [newPage(1, 2, { w, h })], fonts: {}, warnings: [], palette: [], meta: { source, name: title } }
}

// ---------- reading ----------
export const itemsOf = (node) => (node.t === 'group' ? node.items : null)
/** fn(node, ctx) for every node (groups and leaves), back to front. ctx = {page, pageIndex, layer, layerIndex, parent, index, depth}. Return false to skip a group's children. */
export function walkNodes(root, fn) {
  const rec = (items, ctx) => {
    for (let i = 0; i < items.length; i++) {
      const n = items[i]
      const r = fn(n, { ...ctx, index: i })
      if (n.t === 'group' && r !== false) rec(n.items, { ...ctx, parent: n, depth: ctx.depth + 1 })
    }
  }
  root.pages.forEach((page, pageIndex) => page.layers.forEach((layer, layerIndex) => rec(layer.items, { page, pageIndex, layer, layerIndex, parent: null, depth: 0 })))
}

/** {node, parent, layer, page, index, pageIndex, layerIndex} of a node id (also finds layers and pages as {layer, page} entries), or null. Linear: use store.find in hot paths. */
export function findNode(root, id) {
  let hit = null
  walkNodes(root, (n, ctx) => { if (n.id === id) { hit = { node: n, ...ctx }; return false } return hit ? false : undefined })
  return hit
}

/** Rough memory cost of a node in bytes (about 400 per node and 80 per path command), recursive for groups. */
export function cost(node) {
  let c = 400
  if (node.t === 'path') c += 80 * node.d.length + (node.clip ? 80 * node.clip.reduce((s, k) => s + k.d.length, 0) : 0)
  else if (node.t === 'text' && node.glyphs) c += 24 * node.glyphs.length
  else if (node.t === 'group') for (const k of node.items) c += cost(k)
  return c
}
/** Cost of the nodes in list `b` that are not (by identity) in list `a`: what a history entry newly allocated. */
export function diffCost(a, b) {
  if (a === b) return 0
  const old = new Set(a)
  let oldGroups = null
  let c = 0
  for (const n of b) {
    if (old.has(n)) continue
    if (n.t === 'group') {
      oldGroups ??= new Map(a.filter((x) => x.t === 'group').map((x) => [x.id, x]))
      c += 400 + diffCost(oldGroups.get(n.id)?.items || [], n.items)
    } else c += cost(n)
  }
  return c
}

// ---------- immutable updates ----------
/** Replace nodes of `items` whose id is in `set` by fn(node) (a node, an array of nodes, or null to delete). Returns the same array when nothing changed. Recurses into groups that are not themselves matched. */
export function mapList(items, set, fn) {
  let out = null
  for (let i = 0; i < items.length; i++) {
    const n = items[i]
    let r = n
    if (set.has(n.id)) r = fn(n)
    else if (n.t === 'group') {
      const sub = mapList(n.items, set, fn)
      if (sub !== n.items) r = sub.length ? { ...n, items: sub } : null
    }
    if (r !== n && !out) out = items.slice(0, i)
    if (out) { if (Array.isArray(r)) out.push(...r); else if (r) out.push(r) }
  }
  return out || items
}
const sameLayers = (a, b) => a.length === b.length && a.every((l, i) => l === b[i])
/** New root with fn(node) applied to every node id in `set` (see mapList). Only the ancestors of changed nodes are copied. */
export function mapItems(root, set, fn) {
  const ids = set instanceof Set ? set : new Set(set)
  let pages = null
  root.pages.forEach((p, pi) => {
    const layers = p.layers.map((l) => { const items = mapList(l.items, ids, fn); return items === l.items ? l : { ...l, items } })
    if (!sameLayers(layers, p.layers)) { pages ??= root.pages.slice(); pages[pi] = { ...p, layers } }
  })
  return pages ? { ...root, pages } : root
}
export const removeIds = (root, set) => mapItems(root, set, () => null)
/** Replace the page with id `pageId` by fn(page). */
export function replacePage(root, pageId, fn) {
  const i = root.pages.findIndex((p) => p.id === pageId)
  if (i < 0) return root
  const p = fn(root.pages[i])
  if (p === root.pages[i]) return root
  const pages = root.pages.slice()
  pages[i] = p
  return { ...root, pages }
}
/** Replace the layer with id `layerId` by fn(layer). */
export function replaceLayer(root, layerId, fn) {
  for (const p of root.pages) {
    const i = p.layers.findIndex((l) => l.id === layerId)
    if (i < 0) continue
    return replacePage(root, p.id, (pg) => {
      const l = fn(pg.layers[i])
      if (l === pg.layers[i]) return pg
      const layers = pg.layers.slice()
      layers[i] = l
      return { ...pg, layers }
    })
  }
  return root
}
/** Insert `nodes` into layer `layerId` at `index` (default: on top). */
export function insertAt(root, layerId, index, nodes) {
  return replaceLayer(root, layerId, (l) => {
    const at = index == null || index > l.items.length ? l.items.length : Math.max(0, index)
    return { ...l, items: [...l.items.slice(0, at), ...nodes, ...l.items.slice(at)] }
  })
}

export function describeNode(n) {
  if (!n) return ''
  if (n.t === 'group') return `Group of ${n.items.length} object${n.items.length === 1 ? '' : 's'}`
  if (n.t === 'image') return 'Bitmap'
  if (n.t === 'text') return 'Artistic text'
  const k = n.shape?.k
  return k === 'rect' ? 'Rectangle' : k === 'ellipse' ? 'Ellipse' : k === 'poly' ? 'Polygon' : k === 'star' ? 'Star' : 'Curve'
}

/** Count nodes (groups and leaves) of a node list. */
export function countNodes(items) {
  let c = 0
  for (const n of items) { c++; if (n.t === 'group') c += countNodes(n.items) }
  return c
}
export function maxId(root) {
  let m = 0
  for (const p of root.pages) {
    m = Math.max(m, p.id | 0, ...(p.guides || []).map((g) => g.id | 0))
    for (const l of p.layers) m = Math.max(m, l.id | 0)
  }
  walkNodes(root, (n) => { if (Number.isInteger(n.id) && n.id > m) m = n.id })
  return m
}

// ---------- validation: whitelist deep copy of untrusted JSON ----------
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const num = (v, d = 0, lo = -1e9, hi = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)
const color = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null)
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '')
const mat = (m) => (Array.isArray(m) && m.length === 6 && m.every((x) => typeof x === 'number' && Number.isFinite(x)) ? m.map((x) => Math.min(1e9, Math.max(-1e9, x))) : null)
const bool = (v) => v === true
const ARITY = { M: 3, L: 3, C: 7, Z: 1 }
const HREF = /^(data:image\/(png|jpeg|webp|gif|bmp);base64,|blob:|ds-asset:)/i

/** Clean path commands: every command has the right arity and finite numbers. Returns {d, dropped}. */
export function cleanPath(d, max = LIMITS.cmdsPath) {
  const out = []
  let dropped = 0
  if (!Array.isArray(d)) return { d: out, dropped: 0 }
  for (const c of d) {
    if (out.length >= max) { dropped++; continue }
    if (!Array.isArray(c) || ARITY[c[0]] !== c.length) { dropped++; continue }
    let ok = true
    for (let i = 1; i < c.length; i++) if (typeof c[i] !== 'number' || !Number.isFinite(c[i])) { ok = false; break }
    if (!ok) { dropped++; continue }
    if (c[0] === 'Z') out.push(['Z'])
    else out.push([c[0], ...c.slice(1).map((v) => Math.min(1e9, Math.max(-1e9, v)))])
  }
  return { d: out, dropped }
}

function cleanGradient(g) {
  if (!g || typeof g !== 'object' || (g.g !== 'linear' && g.g !== 'radial')) return null
  const stops = Array.isArray(g.stops) ? g.stops.slice(0, LIMITS.stops).map((s) => ({ o: num(s?.o, 0, 0, 1), c: color(s?.c) || '#000000', a: num(s?.a, 1, 0, 1) })) : []
  if (!stops.length) return null
  const out = { g: g.g, m: mat(g.m) || I6.slice(), stops, spread: g.spread === 'reflect' || g.spread === 'repeat' ? g.spread : 'pad' }
  if (g.g === 'linear') Object.assign(out, { x1: num(g.x1), y1: num(g.y1), x2: num(g.x2), y2: num(g.y2) })
  else Object.assign(out, { cx: num(g.cx), cy: num(g.cy), r: num(g.r, 1, 0), fx: num(g.fx, num(g.cx)), fy: num(g.fy, num(g.cy)) })
  return out
}
const cleanFill = (f) => (f && typeof f === 'object' ? cleanGradient(f) : color(f))

function cleanShape(s) {
  if (!s || typeof s !== 'object') return null
  const k = s.k
  if (k === 'rect') return { k, w: num(s.w, 0, 0), h: num(s.h, 0, 0), rx: num(s.rx, 0, 0), ry: num(s.ry, 0, 0) }
  if (k === 'ellipse') { const o = { k, rx: num(s.rx, 0, 0), ry: num(s.ry, 0, 0) }; if (s.a1 != null) o.a1 = num(s.a1); if (s.a2 != null) o.a2 = num(s.a2); if (s.pie) o.pie = true; return o }
  if (k === 'poly') return { k, n: Math.round(num(s.n, 5, 3, 500)), r: num(s.r, 1, 0), rot: num(s.rot) }
  if (k === 'star') return { k, n: Math.round(num(s.n, 5, 3, 500)), r1: num(s.r1, 1, 0), r2: num(s.r2, 1, 0), rot: num(s.rot) }
  return null
}

/**
 * Whitelist deep copy of an untrusted EditorDoc (autosave restore) or of a tree built from reader output.
 * Returns {doc, notes}. Throws a readable Error only when the document must be refused (too many nodes or pages unreadable).
 * opts: {freshIds: true, or a function returning the next id: assign new ids to everything (reader results), assets: {has(id)} to check image assets,
 *   assetMap: Map(stored asset id -> id in the asset store), used by an autosave restore whose pictures were given new ids}
 */
export function validateDoc(raw, opts = {}) {
  const notes = []
  const note = (s) => { if (notes.length < 60 && !notes.includes(s)) notes.push(s) }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages)) throw new Error('This document could not be read.')
  const totals = { nodes: 0, cmds: 0, images: 0, dropped: 0 }
  const toFix = []
  const hasAsset = opts.assets ? (a) => (typeof opts.assets.has === 'function' ? opts.assets.has(a) : false) : null

  // fonts
  const fonts = {}
  let fontBytes = 0
  if (raw.fonts && typeof raw.fonts === 'object') {
    for (const key of Object.keys(raw.fonts)) {
      if (BAD_KEYS.has(key) || !/^[\w.:-]{1,64}$/.test(key)) { note('A font with an unusable name was ignored.'); continue }
      const f = raw.fonts[key]
      if (!f || typeof f !== 'object') continue
      let data = f.data
      if (data instanceof ArrayBuffer) data = new Uint8Array(data)
      if (!(data instanceof Uint8Array)) data = null
      if (data && (data.length > LIMITS.fontBytes || fontBytes + data.length > LIMITS.fontsBytes)) { data = null; note('A very large embedded font was not loaded.') }
      if (data) fontBytes += data.length
      fonts[key] = { name: clean(f.name, LIMITS.name), family: clean(f.family, LIMITS.family).replace(/[<>{};"\\]/g, ''), bold: bool(f.bold), italic: bool(f.italic), data }
    }
  }

  const withCommon = (src, o) => {
    o.id = Number.isInteger(src.id) && src.id > 0 ? src.id : 0
    if (src.name != null && src.name !== '') o.name = clean(src.name, LIMITS.name)
    if (src.hidden === true) o.hidden = true
    if (src.locked === true) o.locked = true
    if (src.src != null) o.src = typeof src.src === 'number' ? src.src : clean(String(src.src), 40)
    if (typeof src.rot === 'number' && Number.isFinite(src.rot)) o.rot = src.rot
    toFix.push(o)
    return o
  }
  const cleanClip = (clip) => {
    if (!Array.isArray(clip)) return undefined
    const out = []
    for (const k of clip.slice(0, LIMITS.clips)) {
      const { d, dropped } = cleanPath(k?.d, LIMITS.cmdsClip)
      totals.cmds += d.length
      if (dropped) totals.dropped++
      if (d.length) out.push({ d, rule: k.rule === 'evenodd' ? 'evenodd' : 'nonzero' })
    }
    return out.length ? out : undefined
  }

  const cleanNode = (n, depth) => {
    if (!n || typeof n !== 'object') return null
    if (++totals.nodes > LIMITS.nodes) throw new Error(`This drawing has more than ${LIMITS.nodes.toLocaleString('en-US')} objects, which is too many to open here.`)
    if (n.t === 'group') {
      if (depth >= LIMITS.depth) { note('Groups nested more than 40 levels deep were flattened.'); return { flat: (Array.isArray(n.items) ? n.items : []).map((k) => cleanNode(k, depth)).filter(Boolean) } }
      const items = []
      for (const k of Array.isArray(n.items) ? n.items : []) {
        const c = cleanNode(k, depth + 1)
        if (!c) continue
        if (c.flat) items.push(...c.flat); else items.push(c)
      }
      const g = withCommon(n, { t: 'group' })
      g.items = items
      return g
    }
    if (n.t === 'path') {
      const { d, dropped } = cleanPath(n.d)
      totals.cmds += d.length
      if (dropped) totals.dropped++
      if (totals.cmds > LIMITS.cmdsDoc) throw new Error('This drawing has too many path points to open here.')
      if (!d.length) { totals.dropped++; return null }
      const o = withCommon(n, { t: 'path' })
      o.d = d
      o.fill = cleanFill(n.fill)
      o.fillOpacity = num(n.fillOpacity, 1, 0, 1)
      o.rule = n.rule === 'evenodd' ? 'evenodd' : 'nonzero'
      o.stroke = color(n.stroke)
      o.strokeWidth = num(n.strokeWidth, 0, 0, 1e5)
      o.strokeOpacity = num(n.strokeOpacity, 1, 0, 1)
      o.cap = Math.round(num(n.cap, 0, 0, 2))
      o.join = Math.round(num(n.join, 0, 0, 2))
      o.miter = num(n.miter, 4, 1, 100)
      o.dash = Array.isArray(n.dash) && n.dash.length ? n.dash.slice(0, 32).map((v) => num(v, 0, 0, 1e5)) : null
      o.dashOffset = num(n.dashOffset, 0, -1e6, 1e6)
      const clip = cleanClip(n.clip)
      if (clip) o.clip = clip
      const shape = cleanShape(n.shape)
      if (shape && mat(n.sm)) { o.shape = shape; o.sm = mat(n.sm) }
      if (Array.isArray(n.nt)) o.nt = n.nt.slice(0, 5000).map((s) => (Array.isArray(s) ? s.slice(0, 100000).map((c) => (c === 's' || c === 'y' ? c : 'c')) : []))
      for (const k of ['fillK', 'strokeK']) if (Array.isArray(n[k]) && n[k].length === 4) o[k] = n[k].map((v) => num(v, 0, 0, 1))
      return o
    }
    if (n.t === 'image') {
      const o = withCommon(n, { t: 'image' })
      if (typeof n.asset === 'string' && /^[\w.-]{1,64}$/.test(n.asset) && !BAD_KEYS.has(n.asset)) o.asset = opts.assetMap?.get(n.asset) ?? n.asset
      else if (typeof n.href === 'string' && HREF.test(n.href.slice(0, 40))) o.href = n.href
      else { totals.dropped++; return null }
      if (o.asset && hasAsset && !hasAsset(o.asset)) { totals.dropped++; note('Some pictures were missing from the saved data and were skipped.'); return null }
      if (++totals.images > LIMITS.images) { note('Only the first 500 pictures were kept.'); return null }
      o.w = Math.round(num(n.w, 1, 1, LIMITS.imageDim)); o.h = Math.round(num(n.h, 1, 1, LIMITS.imageDim))
      o.m = mat(n.m) || I6.slice()
      o.opacity = num(n.opacity, 1, 0, 1)
      const clip = cleanClip(n.clip)
      if (clip) o.clip = clip
      return o
    }
    if (n.t === 'text') {
      const str = clean(typeof n.str === 'string' ? n.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') : '', LIMITS.str)
      if (typeof n.str === 'string' && n.str.length > LIMITS.str) note('Very long text was shortened.')
      const o = withCommon(n, { t: 'text' })
      o.str = typeof n.str === 'string' ? n.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, LIMITS.str) : str
      o.family = clean(n.family, LIMITS.family).replace(/[<>{};"\\]/g, '') || 'sans-serif'
      o.size = num(n.size, 12, 0.01, LIMITS.size)
      o.bold = bool(n.bold); o.italic = bool(n.italic)
      o.fill = color(n.fill) || '#000000'
      o.opacity = num(n.opacity, 1, 0, 1)
      o.m = mat(n.m) || I6.slice()
      o.lh = num(n.lh, 1.2, 0.5, 10)
      o.align = n.align === 'center' || n.align === 'right' ? n.align : 'left'
      if (typeof n.font === 'string' && Object.hasOwn(fonts, n.font)) {
        o.font = n.font
        if (Array.isArray(n.glyphs) && !o.str.includes('\n') && n.glyphs.length <= LIMITS.glyphs) {
          const gl = []
          for (const g of n.glyphs) {
            if (typeof g?.c !== 'string' || [...g.c].length !== 1 || typeof g.x !== 'number' || !Number.isFinite(g.x)) { gl.length = 0; break }
            gl.push({ c: g.c, x: Math.min(1e7, Math.max(-1e7, g.x)) })
          }
          if (gl.length) o.glyphs = gl
        }
      }
      if (n.fontName != null) o.fontName = clean(n.fontName, LIMITS.name)
      const clip = cleanClip(n.clip)
      if (clip) o.clip = clip
      return o
    }
    totals.dropped++
    return null
  }

  const pages = []
  for (const rp of raw.pages.slice(0, LIMITS.pages)) {
    if (!rp || typeof rp !== 'object') continue
    const page = { id: Number.isInteger(rp.id) && rp.id > 0 ? rp.id : 0, name: clean(rp.name, LIMITS.name) || `Page ${pages.length + 1}`,
      w: num(rp.w, PAGE_SIZES.A4[0], 1, LIMITS.pageSize), h: num(rp.h, PAGE_SIZES.A4[1], 1, LIMITS.pageSize), layers: [], guides: [] }
    toFix.push(page)
    const layerSrc = Array.isArray(rp.layers) ? rp.layers : [{ name: 'Layer 1', items: rp.items }]
    for (const rl of layerSrc.slice(0, LIMITS.layers)) {
      if (!rl || typeof rl !== 'object') continue
      const layer = { id: Number.isInteger(rl.id) && rl.id > 0 ? rl.id : 0, name: clean(rl.name, LIMITS.name) || `Layer ${page.layers.length + 1}`,
        hidden: bool(rl.hidden), locked: bool(rl.locked), printable: rl.printable !== false, items: [] }
      toFix.push(layer)
      for (const it of Array.isArray(rl.items) ? rl.items : []) {
        const c = cleanNode(it, 0)
        if (!c) continue
        if (c.flat) layer.items.push(...c.flat); else layer.items.push(c)
      }
      page.layers.push(layer)
    }
    if (!page.layers.length) { const l = { id: 0, name: 'Layer 1', hidden: false, locked: false, printable: true, items: [] }; toFix.push(l); page.layers.push(l) }
    if (Array.isArray(rp.guides)) for (const g of rp.guides.slice(0, LIMITS.guides)) if (g && (g.axis === 'h' || g.axis === 'v') && typeof g.pos === 'number' && Number.isFinite(g.pos)) { const o = { id: Number.isInteger(g.id) && g.id > 0 ? g.id : 0, axis: g.axis, pos: g.pos }; toFix.push(o); page.guides.push(o) }
    if (rp.bg != null && color(rp.bg)) page.bg = color(rp.bg)
    pages.push(page)
  }
  if (!pages.length) throw new Error('This document has no pages.')
  if (raw.pages.length > LIMITS.pages) note(`Only the first ${LIMITS.pages} pages were kept.`)
  if (totals.dropped) note(`${totals.dropped} item${totals.dropped === 1 ? '' : 's'} could not be read and ${totals.dropped === 1 ? 'was' : 'were'} skipped.`)

  // unique positive integer ids
  let next = 1
  if (opts.freshIds) {
    const fresh = typeof opts.freshIds === 'function' ? opts.freshIds : () => next++
    for (const o of toFix) { if (o.t && o.id && o.src == null) o.src = o.id; o.id = fresh() }
  } else {
    const seen = new Set()
    let top = 0
    for (const o of toFix) if (o.id > top) top = o.id
    next = top + 1
    for (const o of toFix) { if (!o.id || seen.has(o.id)) o.id = next++; seen.add(o.id) }
  }
  const doc = {
    v: 1, uid: typeof raw.uid === 'string' && /^[a-z0-9]{4,16}$/.test(raw.uid) ? raw.uid : makeUid(),
    title: clean(raw.title, LIMITS.name) || 'Untitled', units: UNITS.includes(raw.units) ? raw.units : 'mm', nextId: next,
    pages, fonts,
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).filter((s) => typeof s === 'string').slice(0, 200).map((s) => clean(s, 500)),
    palette: (Array.isArray(raw.palette) ? raw.palette : []).map(color).filter(Boolean).slice(0, LIMITS.palette),
    meta: { source: SOURCES.includes(raw.meta?.source) ? raw.meta.source : 'import', name: clean(raw.meta?.name, LIMITS.name), ...(typeof raw.meta?.ver === 'number' ? { ver: raw.meta.ver } : {}) },
  }
  return { doc, notes }
}
