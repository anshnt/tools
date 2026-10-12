// Draw Studio operations: pure functions over immutable roots, each (root, ids, ...) -> root. No DOM, no lib imports, so Node tests cover them.
// Every operation builds a new root by path copying (untouched nodes keep their identity) and returns the SAME root when nothing changed, so
// store.tx records no history step for a no-op. Operations that create nodes take a newId() callback and may report new ids through `out`.
// transformItem(item, M, opts) is the single place that knows how each item type transforms (see PLAN 5.7).
import { I, mul, apply, translate, scale, rotate, meanScale, mapPath } from './_model.js'
import { LIMITS, mapItems, mapList, newLayer, removeIds, replaceLayer, replacePage } from './_ds-doc.js'
import { normalizeText } from './_ds-text-model.js'

export const DEFAULT_OUTLINE = 0.75 // points, used when a colour or a width is set on an object that had no outline
const finite = (m) => Array.isArray(m) && m.length === 6 && m.every((v) => Number.isFinite(v))

// ---------- matrices ----------
/** M applied about the point (cx, cy): translate(c) * M * translate(-c). */
export const about = (M, cx, cy) => mul(translate(cx, cy), mul(M, translate(-cx, -cy)))
export const scaleAbout = (sx, sy, cx, cy) => about(scale(sx, sy), cx, cy)
export const rotateAbout = (rad, cx, cy) => about(rotate(rad), cx, cy)
/** Horizontal shear x' = x + k (y - py) about the line y = py. */
export const skewXAbout = (k, py) => [1, 0, k, 1, -k * py, 0]
/** Vertical shear y' = y + k (x - px) about the line x = px. */
export const skewYAbout = (k, px) => [1, k, 0, 1, 0, -k * px]
export const isIdentity = (M) => M.every((v, i) => Math.abs(v - I[i]) < 1e-12)
/** Corner points of a box {x,y,w,h} mapped through M: the (possibly rotated) quad, as [[x,y] x4]. */
export const boxQuad = (b, M) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => apply(M, x, y))

// ---------- transforming items ----------
/** Informational angle (degrees, counter-clockwise positive, as the property bar shows it) after applying M: the item's own x axis is mapped through M. */
function nextRot(rot, M) {
  const th = ((rot || 0) * Math.PI) / 180
  const c = Math.cos(th), s = -Math.sin(th) // page y runs down, so counter-clockwise is minus
  const vx = M[0] * c + M[2] * s, vy = M[1] * c + M[3] * s
  if (!(Math.hypot(vx, vy) > 1e-12)) return rot
  let a = (Math.atan2(-vy, vx) * 180) / Math.PI
  a = Math.round(a * 1e6) / 1e6
  if (a <= -180) a += 360
  if (Math.abs(a) < 1e-9) a = 0
  return a
}

/**
 * Transform one node by the page-space matrix M (a new node; the input is never touched).
 * opts: {scaleStroke: false (outline width scales only when asked), memo: Map shared across one operation so that items sharing a clip or a
 * gradient keep sharing the mapped copy (otherwise moving 5k clipped items would make 5k separate clipPath defs)}.
 */
export function transformItem(n, M, opts = {}) {
  const memo = opts.memo || new Map()
  const once = (key, make) => { let r = memo.get(key); if (r === undefined) { r = make(); memo.set(key, r) } return r }
  const clips = (c) => (c ? c.map((k) => once(k, () => ({ ...k, d: mapPath(k.d, M) }))) : c)
  const rot = nextRot(n.rot, M)
  const withRot = (o) => { if (rot !== n.rot && (n.rot != null || Math.abs(rot) > 1e-9)) o.rot = rot; return o }
  if (n.t === 'group') return withRot({ ...n, items: n.items.map((k) => transformItem(k, M, { ...opts, memo })) })
  if (n.t === 'path') {
    const o = { ...n, d: mapPath(n.d, M) }
    if (n.fill && typeof n.fill === 'object') o.fill = once(n.fill, () => ({ ...n.fill, m: mul(M, n.fill.m || I) }))
    if (n.sm) o.sm = mul(M, n.sm)
    if (n.clip) o.clip = clips(n.clip)
    if (opts.scaleStroke && n.stroke && n.strokeWidth > 0) {
      const k = meanScale(M)
      o.strokeWidth = n.strokeWidth * k
      if (n.dash?.length) { o.dash = n.dash.map((v) => v * k); o.dashOffset = (n.dashOffset || 0) * k }
    }
    return withRot(o)
  }
  if (n.t === 'image') {
    const o = { ...n, m: mul(M, n.m) }
    if (n.clip) o.clip = clips(n.clip)
    return withRot(o)
  }
  if (n.t === 'text') {
    const o = { ...n, m: mul(M, n.m) }
    if (n.clip) o.clip = clips(n.clip)
    return withRot(normalizeText(o))
  }
  return n
}

/** Transform the nodes `ids` by M. A node inside a selected group is moved with the group (never twice). */
export function transformIds(root, ids, M, opts = {}) {
  if (!finite(M) || isIdentity(M) || !ids.length) return root
  const memo = new Map()
  return mapItems(root, new Set(ids), (n) => transformItem(n, M, { ...opts, memo }))
}
/** Mirror about the centre of `box` (axis 'h' = left and right swap, 'v' = top and bottom swap). */
export function mirror(root, ids, axis, box) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  return transformIds(root, ids, axis === 'h' ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy])
}
/** Rotate 90 degrees about the centre of `box`; cw true = clockwise on screen. */
export function rotate90(root, ids, cw, box) {
  return transformIds(root, ids, rotateAbout(cw ? Math.PI / 2 : -Math.PI / 2, box.x + box.w / 2, box.y + box.h / 2))
}

// ---------- reading the tree ----------
/** Selected nodes in z order (back to front) with the chain of groups above each: [{node, chain, layer, page}]. A selected node's selected descendants are not listed. */
export function collect(root, idSet) {
  const out = []
  root.pages.forEach((page) => page.layers.forEach((layer) => {
    const rec = (items, chain) => {
      for (const n of items) {
        if (idSet.has(n.id)) out.push({ node: n, chain, layer, page })
        else if (n.t === 'group') rec(n.items, [...chain, n])
      }
    }
    rec(layer.items, [])
  }))
  return out
}
/** Every leaf under the given nodes (the nodes themselves when they are leaves). */
export function leavesOf(nodes) {
  const out = []
  const rec = (n) => { if (n.t === 'group') n.items.forEach(rec); else out.push(n) }
  nodes.forEach(rec)
  return out
}

// ---------- structure ----------
export function deleteIds(root, ids) { return ids.length ? removeIds(root, new Set(ids)) : root }

const cloneNode = (n, newId) => {
  const { src, ...rest } = n
  const o = { ...rest, id: newId() }
  if (n.t === 'group') o.items = n.items.map((k) => cloneNode(k, newId))
  return o
}
/** Copy the selected nodes (fresh ids) just above the originals, moved by (dx, dy). out.ids receives the new ids. */
export function duplicate(root, ids, newId, { dx = 0, dy = 0, out } = {}) {
  const set = new Set(ids)
  const M = translate(dx, dy)
  const memo = new Map()
  const made = []
  const r = mapItems(root, set, (n) => {
    const c = cloneNode(n, newId)
    made.push(c.id)
    return [n, dx || dy ? transformItem(c, M, { memo }) : c]
  })
  if (out) out.ids = made
  return r
}

/** Group the selected nodes (two or more) into one group at the position of the top-most one. out.id receives the group id. */
export function group(root, ids, newId, { name = 'Group', out } = {}) {
  const found = collect(root, new Set(ids))
  if (found.length < 2) return root
  const top = found[found.length - 1].node
  const g = { id: newId(), t: 'group', name, items: found.map((f) => f.node) }
  if (out) out.id = g.id
  const rest = new Set(found.map((f) => f.node.id))
  rest.delete(top.id)
  return mapItems(removeIds(root, rest), new Set([top.id]), () => g)
}
/** Replace the selected groups by their children, in place. all = keep going into nested groups. out.ids receives the freed children. */
export function ungroup(root, ids, { all = false, out } = {}) {
  const freed = []
  const open = (n) => (n.t === 'group' ? (all ? n.items.flatMap(open) : n.items) : [n])
  const r = mapItems(root, new Set(ids), (n) => {
    if (n.t !== 'group') return n
    const kids = open(n)
    for (const k of kids) freed.push(k.id)
    return kids
  })
  if (out) out.ids = freed
  return r
}

/** Reorder the selected nodes inside their own lists: 'front' | 'back' | 'forward' | 'backward' | 'reverse'. */
export function arrange(root, ids, mode) {
  const set = new Set(ids)
  const reorder = (items) => {
    const sel = items.map((n) => set.has(n.id))
    if (!sel.some(Boolean)) return items
    let out = items.slice()
    if (mode === 'front') out = [...items.filter((n) => !set.has(n.id)), ...items.filter((n) => set.has(n.id))]
    else if (mode === 'back') out = [...items.filter((n) => set.has(n.id)), ...items.filter((n) => !set.has(n.id))]
    else if (mode === 'forward') { for (let i = out.length - 2; i >= 0; i--) if (set.has(out[i].id) && !set.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]] }
    else if (mode === 'backward') { for (let i = 1; i < out.length; i++) if (set.has(out[i].id) && !set.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]] }
    else if (mode === 'reverse') { const pos = items.map((n, i) => (set.has(n.id) ? i : -1)).filter((i) => i >= 0); const picked = pos.map((i) => items[i]).reverse(); pos.forEach((p, k) => { out[p] = picked[k] }) }
    return out.every((n, i) => n === items[i]) ? items : out
  }
  const rec = (items) => {
    let changed = false
    const next = items.map((n) => {
      if (n.t === 'group' && !set.has(n.id)) { const sub = rec(n.items); if (sub !== n.items) { changed = true; return { ...n, items: sub } } }
      return n
    })
    const base = changed ? next : items
    const re = reorder(base)
    return re === base ? base : re
  }
  return mapLayers(root, (l) => rec(l.items))
}

/**
 * Move nodes to a new place. dest: {into: layerId | groupId} (on top of that list), {above: id} or {below: id} (next to that node, in z order).
 * Refuses to move a group into itself. Groups left empty are removed. Returns the same root when the move is not allowed or changes nothing.
 */
export function moveNodes(root, ids, dest) {
  const found = collect(root, new Set(ids))
  if (!found.length) return root
  const nodes = found.map((f) => f.node)
  const moving = new Set(nodes.map((n) => n.id))
  const inside = new Set()
  const rec = (n) => { inside.add(n.id); if (n.t === 'group') n.items.forEach(rec) }
  nodes.forEach(rec)
  const anchorId = dest.above ?? dest.below ?? dest.into
  if (anchorId == null || inside.has(anchorId)) return root
  const insertInto = (items, atEnd) => {
    if (atEnd) return [...items, ...nodes]
    const i = items.findIndex((n) => n.id === anchorId)
    if (i < 0) return null
    const at = dest.above != null ? i + 1 : i
    return [...items.slice(0, at), ...nodes, ...items.slice(at)]
  }
  // remove first without pruning, insert, then prune the groups that were emptied
  const strip = (items) => {
    let out = null
    items.forEach((n, i) => {
      let r = n
      if (moving.has(n.id)) r = null
      else if (n.t === 'group') { const sub = strip(n.items); if (sub !== n.items) r = { ...n, items: sub } }
      if (r !== n && !out) out = items.slice(0, i)
      if (out && r) out.push(r)
    })
    return out || items
  }
  let done = false
  const put = (items, layerId) => {
    // a new list with the nodes inserted where dest says, searching nested groups too
    if (layerId != null && dest.into === layerId) { done = true; return insertInto(items, true) }
    if (dest.above != null || dest.below != null) {
      const i = items.findIndex((n) => n.id === anchorId)
      if (i >= 0) { done = true; return insertInto(items, false) }
    }
    let out = items
    items.forEach((n, i) => {
      if (n.t !== 'group') return
      let sub
      if (dest.into === n.id) { done = true; sub = insertInto(n.items, true) } else sub = put(n.items, null)
      if (sub !== n.items) { if (out === items) out = items.slice(); out[i] = { ...n, items: sub } }
    })
    return out
  }
  const prune = (items) => {
    let out = null
    items.forEach((n, i) => {
      let r = n
      if (n.t === 'group') { const sub = prune(n.items); r = sub.length ? (sub === n.items ? n : { ...n, items: sub }) : null }
      if (r !== n && !out) out = items.slice(0, i)
      if (out && r) out.push(r)
    })
    return out || items
  }
  const next = mapLayers(root, (l) => prune(put(strip(l.items), l.id)))
  return done ? next : root
}

/** New root where every layer's items list is replaced by fn(layer); layers (and pages) whose list comes back identical keep their identity. */
function mapLayers(root, fn) {
  let pages = null
  root.pages.forEach((p, pi) => {
    let layers = null
    p.layers.forEach((l, li) => { const items = fn(l); if (items !== l.items) { layers ??= p.layers.slice(); layers[li] = { ...l, items } } })
    if (layers) { pages ??= root.pages.slice(); pages[pi] = { ...p, layers } }
  })
  return pages ? { ...root, pages } : root
}

// ---------- flags and names ----------
/** Set hidden or locked on nodes (the key is removed when false, so unflagged nodes stay lean). */
export function setFlag(root, ids, key, on) {
  return mapItems(root, new Set(ids), (n) => {
    if (!!n[key] === !!on) return n
    const { [key]: _drop, ...rest } = n
    return on ? { ...rest, [key]: true } : rest
  })
}
/** Rename a node (an empty name removes the name, so the default description shows again). */
export function renameNode(root, id, name) {
  name = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200).trim()
  return mapItems(root, new Set([id]), (n) => {
    if ((n.name || '') === name) return n
    if (!name) { const { name: _n, ...rest } = n; return rest }
    return { ...n, name }
  })
}
export function renamePage(root, pageId, name) {
  name = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200).trim()
  return name ? replacePage(root, pageId, (p) => (p.pending || p.name === name ? p : { ...p, name })) : root // a pending PDF page is a shared placeholder: never copied
}

// ---------- pages ----------
// A page that is still being read (page.pending) is one object shared by every history snapshot and filled in place once, so it is never
// copied, renamed, resized or deleted here (the operations return the same root and the command says to wait).
const pidx = (root, id) => root.pages.findIndex((p) => p.id === id)
/** The first unused "Page N" name. */
export function nextPageName(root) {
  const names = new Set(root.pages.map((p) => p.name))
  let k = root.pages.length + 1
  while (names.has(`Page ${k}`)) k++
  return `Page ${k}`
}
/** Add a blank page after `afterId` or before `beforeId` (default: at the end) with that page's size unless w and h are given. out.id receives the page id. */
export function addPage(root, newId, { afterId, beforeId, w, h, name, out } = {}) {
  if (root.pages.length >= LIMITS.pages) return root
  const ref = root.pages.find((p) => p.id === (beforeId ?? afterId)) || root.pages[root.pages.length - 1]
  const id = newId(), lid = newId()
  const size = (v, d) => (Number.isFinite(v) ? Math.min(LIMITS.pageSize, Math.max(1, v)) : d)
  const page = { id, name: String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200).trim() || nextPageName(root), w: size(w, ref.w), h: size(h, ref.h), layers: [newLayer(lid)], guides: [] }
  if (out) out.id = id
  const pages = root.pages.slice()
  pages.splice(pidx(root, ref.id) + (beforeId != null ? 0 : 1), 0, page)
  return { ...root, pages }
}
/** Copy a page (fresh ids; pictures share their assets) right after it, named "<name> copy". out.id receives the new page id. */
export function duplicatePage(root, pageId, newId, { out } = {}) {
  const i = pidx(root, pageId), p = root.pages[i]
  if (!p || p.pending || root.pages.length >= LIMITS.pages) return root
  const id = newId()
  const layers = p.layers.map((l) => ({ ...l, id: newId(), items: l.items.map((n) => cloneNode(n, newId)) }))
  const copy = { ...p, id, name: `${p.name} copy`.slice(0, 200), layers, guides: p.guides.map((g) => ({ ...g, id: newId() })) }
  if (out) out.id = id
  const pages = root.pages.slice()
  pages.splice(i + 1, 0, copy)
  return { ...root, pages }
}
/** Delete a page. The last page cannot be deleted. */
export function deletePage(root, pageId) {
  const p = root.pages.find((x) => x.id === pageId)
  return !p || p.pending || root.pages.length < 2 ? root : { ...root, pages: root.pages.filter((x) => x !== p) }
}
/** Move a page to index `to` (clamped). */
export function movePage(root, pageId, to) {
  const i = pidx(root, pageId)
  const j = Math.max(0, Math.min(root.pages.length - 1, Math.round(to)))
  if (i < 0 || i === j || !Number.isFinite(to)) return root
  const pages = root.pages.slice()
  const [p] = pages.splice(i, 1)
  pages.splice(j, 0, p)
  return { ...root, pages }
}
/**
 * Resize pages (ids = page ids, or null for every page). Objects keep their distance from the BOTTOM edge, because the editor measures Y up
 * from the bottom-left corner: a taller page leaves the numbers in the Y field unchanged. Horizontal guides move with the objects.
 */
export function setPageSize(root, ids, w, h) {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return root
  w = Math.min(LIMITS.pageSize, Math.max(1, w)); h = Math.min(LIMITS.pageSize, Math.max(1, h))
  const set = ids ? new Set(ids) : null
  let changed = false
  const pages = root.pages.map((p) => {
    if ((set && !set.has(p.id)) || p.pending || (Math.abs(p.w - w) < 1e-6 && Math.abs(p.h - h) < 1e-6)) return p
    changed = true
    const dy = h - p.h
    if (Math.abs(dy) < 1e-9) return { ...p, w, h }
    const M = translate(0, dy), memo = new Map()
    return { ...p, w, h, layers: p.layers.map((l) => ({ ...l, items: l.items.map((n) => transformItem(n, M, { memo })) })), guides: p.guides.map((g) => (g.axis === 'h' ? { ...g, pos: g.pos + dy } : g)) }
  })
  return changed ? { ...root, pages } : root
}

// ---------- layers ----------
/** Add a layer to a page, above `aboveId` when given (else on top). out.id receives the new layer id. */
export function addLayer(root, pageId, newId, { name, aboveId, out } = {}) {
  const page = root.pages.find((p) => p.id === pageId)
  if (!page) return root
  const id = newId()
  if (out) out.id = id
  let k = page.layers.length + 1
  const names = new Set(page.layers.map((l) => l.name))
  while (!name && names.has(`Layer ${k}`)) k++
  const layer = { id, name: name || `Layer ${k}`, hidden: false, locked: false, printable: true, items: [] }
  return replacePage(root, pageId, (p) => {
    const i = aboveId == null ? p.layers.length - 1 : p.layers.findIndex((l) => l.id === aboveId)
    const layers = p.layers.slice()
    layers.splice((i < 0 ? p.layers.length - 1 : i) + 1, 0, layer)
    return { ...p, layers }
  })
}
/** Delete a layer and everything on it. The last layer of a page cannot be deleted. */
export function deleteLayer(root, layerId) {
  for (const p of root.pages) {
    if (!p.layers.some((l) => l.id === layerId)) continue
    if (p.layers.length < 2) return root
    return replacePage(root, p.id, (pg) => ({ ...pg, layers: pg.layers.filter((l) => l.id !== layerId) }))
  }
  return root
}
export function renameLayer(root, layerId, name) {
  name = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200).trim()
  return name ? replaceLayer(root, layerId, (l) => (l.name === name ? l : { ...l, name })) : root
}
/** key: 'hidden' | 'locked' | 'printable'. */
export const setLayerFlag = (root, layerId, key, on) => replaceLayer(root, layerId, (l) => (!!l[key] === !!on ? l : { ...l, [key]: !!on }))
/** Move a layer by `delta` positions (positive = towards the front). */
export function moveLayer(root, layerId, delta) {
  for (const p of root.pages) {
    const i = p.layers.findIndex((l) => l.id === layerId)
    if (i < 0) continue
    const j = Math.max(0, Math.min(p.layers.length - 1, i + delta))
    if (j === i) return root
    return replacePage(root, p.id, (pg) => { const layers = pg.layers.slice(); const [l] = layers.splice(i, 1); layers.splice(j, 0, l); return { ...pg, layers } })
  }
  return root
}

// ---------- style ----------
const PATH_KEYS = ['fill', 'fillOpacity', 'rule', 'stroke', 'strokeWidth', 'strokeOpacity', 'cap', 'join', 'miter', 'dash', 'dashOffset', 'fillK', 'strokeK']
const TEXT_KEYS = ['fill']
/**
 * Apply a style patch to every leaf under the selected nodes (groups included). Paths take any style key, text takes a fill colour only
 * (never none or a gradient), pictures take nothing yet. A null fillK or strokeK removes that display hint. Setting an outline colour on
 * an object with no outline gives it a thin one, and a width on one with no colour makes the outline black.
 */
export function setStyle(root, ids, patch) {
  const leaf = (n) => {
    const keys = n.t === 'path' ? PATH_KEYS : n.t === 'text' ? TEXT_KEYS : []
    const o = { ...n }
    let changed = false
    const put = (k, v) => { if (v === undefined) return; if (v === null && (k === 'fillK' || k === 'strokeK')) { if (k in o) { delete o[k]; changed = true } return } if (o[k] !== v) { o[k] = v; changed = true } }
    for (const k of keys) {
      if (!(k in patch)) continue
      if (n.t === 'text' && (patch[k] == null || typeof patch[k] === 'object')) continue
      put(k, patch[k])
    }
    if (n.t === 'path') {
      if ('stroke' in patch && patch.stroke && !(n.strokeWidth > 0) && !('strokeWidth' in patch)) put('strokeWidth', DEFAULT_OUTLINE)
      if ('strokeWidth' in patch && patch.strokeWidth > 0 && !o.stroke && !('stroke' in patch)) put('stroke', '#000000')
      if ('fill' in patch && !('fillK' in patch)) put('fillK', null)
      if ('stroke' in patch && !('strokeK' in patch)) put('strokeK', null)
    }
    return changed ? o : n
  }
  const rec = (n) => {
    if (n.t !== 'group') return leaf(n)
    let items = null
    n.items.forEach((k, i) => { const r = rec(k); if (r !== k) { items ??= n.items.slice(); items[i] = r } })
    return items ? { ...n, items } : n
  }
  return mapItems(root, new Set(ids), rec)
}

// ---------- text ----------
const ALIGN_LEFT = { left: 0, center: -0.5, right: -1 }
/**
 * Set text properties on every text leaf under the nodes `ids`. patch: {size (pt), bold, italic, align, lh, family, font (a key of root.fonts, or null)}.
 * Glyph positions (exact PDF text) are kept when only the size changes (they scale with it) and dropped when the letter shapes may change.
 * widthOf(node) -> width of the widest line in text units (from the DOM); it lets an alignment change keep the text where it is.
 */
export function setTextProps(root, ids, patch, { widthOf } = {}) {
  const leaf = (n) => {
    if (n.t !== 'text') return n
    const o = { ...n }
    let changed = false
    const put = (k, v) => { if (o[k] !== v) { o[k] = v; changed = true } }
    const dropGlyphs = () => { if (o.glyphs) { delete o.glyphs; changed = true } }
    if (Number.isFinite(patch.size) && patch.size > 0 && Math.min(LIMITS.size, patch.size) !== n.size) {
      const size = Math.min(LIMITS.size, patch.size), k = size / n.size
      put('size', size)
      if (o.glyphs) o.glyphs = o.glyphs.map((g) => ({ c: g.c, x: g.x * k }))
    }
    if ('bold' in patch && !!patch.bold !== !!n.bold) { put('bold', !!patch.bold); dropGlyphs() }
    if ('italic' in patch && !!patch.italic !== !!n.italic) { put('italic', !!patch.italic); dropGlyphs() }
    if (typeof patch.family === 'string' && patch.family) {
      const font = patch.font ?? undefined
      if (patch.family !== n.family || font !== n.font) {
        put('family', patch.family)
        if (font != null) put('font', font); else if ('font' in o) { delete o.font; changed = true }
        dropGlyphs()
      }
    }
    if (Number.isFinite(patch.lh)) put('lh', Math.min(10, Math.max(0.5, patch.lh)))
    if (patch.align && ALIGN_LEFT[patch.align] != null && patch.align !== (n.align || 'left')) {
      const w = widthOf?.(n)
      if (w > 0) { o.m = mul(n.m, translate((ALIGN_LEFT[n.align || 'left'] - ALIGN_LEFT[patch.align]) * w, 0)); changed = true }
      put('align', patch.align)
    }
    return changed ? o : n
  }
  const rec = (n) => {
    if (n.t !== 'group') return leaf(n)
    let items = null
    n.items.forEach((k, i) => { const r = rec(k); if (r !== k) { items ??= n.items.slice(); items[i] = r } })
    return items ? { ...n, items } : n
  }
  return mapItems(root, new Set(ids), rec)
}
/** Replace leaves by id: map id -> a node, an array of nodes, or null (delete). Groups left empty go away. */
export const replaceLeaves = (root, map) => (map.size ? mapItems(root, new Set(map.keys()), (n) => (map.has(n.id) ? map.get(n.id) : n)) : root)

/**
 * What the given nodes look like, for the status bar swatches: {fill, stroke, width} where fill and stroke are
 * {kind: 'none'|'color'|'gradient'|'mixed'|'empty', hex?, stops?} and width is the outline width in points (null when mixed or nothing).
 */
export function styleSummary(nodes) {
  const leaves = leavesOf(nodes).filter((l) => l.t === 'path' || l.t === 'text')
  const same = (a, b) => a.kind === b.kind && a.hex === b.hex && a.id === b.id
  const paint = (read) => {
    let cur = null
    for (const l of leaves) {
      const v = read(l)
      if (v == null) continue
      if (!cur) cur = v
      else if (!same(cur, v)) return { kind: 'mixed' }
    }
    return cur || { kind: 'empty' }
  }
  const fill = paint((l) => (l.fill && typeof l.fill === 'object' ? { kind: 'gradient', id: l.fill, stops: l.fill.stops.map((s) => s.c) } : l.fill ? { kind: 'color', hex: l.fill } : l.t === 'path' ? { kind: 'none' } : null))
  const stroke = paint((l) => (l.t !== 'path' ? null : l.stroke && l.strokeWidth > 0 ? { kind: 'color', hex: l.stroke } : { kind: 'none' }))
  let width = null, mixed = false
  for (const l of leaves) if (l.t === 'path' && l.stroke && l.strokeWidth > 0) { if (width == null) width = l.strokeWidth; else if (Math.abs(width - l.strokeWidth) > 1e-6) mixed = true }
  return { fill, stroke, width: mixed ? null : width }
}

/** Per-path outline width: sets strokeWidth on the selected paths (see setStyle for the colour rule). */
export const setOutlineWidth = (root, ids, w) => setStyle(root, ids, { strokeWidth: Math.max(0, w) })

export { mapList, replaceLayer, replacePage }
