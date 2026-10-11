// Draw Studio hit testing, boxes, marquee and snapping. Pure except pickFromTarget (it reads DOM attributes from the event target).
import { pathBBox, mapPath, unionBox } from './_model.js'
import { pathDistance } from './_ds-path.js'

const UNIT_SQUARE = [['M', 0, 0], ['L', 1, 0], ['L', 1, 1], ['L', 0, 1], ['Z']]
/** boxOf(node) with a WeakMap cache (nodes are immutable). Text boxes come from the DOM through textBox(node); epoch() changes when fonts load. */
export function createBoxer(textBox, epoch = () => 0) {
  let cache = new WeakMap(), seen = epoch()
  const boxOf = (n) => {
    if (epoch() !== seen) { cache = new WeakMap(); seen = epoch() }
    if (n.t === 'text') return textBox(n)
    let b = cache.get(n)
    if (b !== undefined) return b
    if (n.t === 'path') b = pathBBox(n.d)
    else if (n.t === 'image') b = pathBBox(mapPath(UNIT_SQUARE, n.m))
    else if (n.t === 'group') { b = null; for (const k of n.items) if (!k.hidden) b = unionBox(b, boxOf(k)) }
    else b = null
    cache.set(n, b)
    return b
  }
  return boxOf
}
export const boxUnion = (boxes) => boxes.reduce((u, b) => (b ? unionBox(u, b) : u), null)
const inside = (b, r) => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h
const touches = (b, r) => b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y

/** Pickable objects on the current page: top-level items of visible unlocked layers, or the children of the entered group (store.ctx). Back to front. */
export function pickables(store) {
  const out = []
  const ctxNode = store.ctx != null ? store.find(store.ctx)?.node : null
  if (ctxNode?.t === 'group') {
    if (!ctxNode.locked) for (const n of ctxNode.items) if (!n.hidden && !n.locked) out.push(n)
    return out
  }
  for (const layer of store.page()?.layers || []) {
    if (layer.hidden || layer.locked) continue
    for (const n of layer.items) if (!n.hidden && !n.locked) out.push(n)
  }
  return out
}

/** Resolve a DOM event target to the object id the user means: the top-most ancestor that is a layer child, or a child of the entered group. deep = the exact leaf (Ctrl+click). */
export function pickFromTarget(target, store, { deep = false } = {}) {
  const el = target?.closest?.('[data-id]')
  if (!el || !el.closest('.ds-page')) return null
  const chain = [el]
  for (let p = el.parentElement?.closest('[data-id]'); p; p = p.parentElement?.closest('[data-id]')) chain.push(p)
  if (deep) return +chain[0].dataset.id
  if (store.ctx != null) {
    const i = chain.findIndex((e) => +e.dataset.id === store.ctx)
    if (i > 0) return +chain[i - 1].dataset.id
  }
  return +chain[chain.length - 1].dataset.id
}

function hitGroup(g, p, tol, boxOf) {
  for (const k of g.items) {
    if (k.hidden) continue
    const b = boxOf(k)
    if (!b || p.x < b.x - tol || p.x > b.x + b.w + tol || p.y < b.y - tol || p.y > b.y + b.h + tol) continue
    if (k.t === 'group' ? hitGroup(k, p, tol, boxOf) : k.t === 'path' ? pathDistance(k.d, p) <= tol : true) return true
  }
  return false
}
/** Tolerance pass for fill-less shapes and hairlines: the topmost pickable whose outline is within tol points of p (closed shapes without fill hit on their outline only). */
export function hitByDistance(store, boxOf, p, tol) {
  const list = pickables(store)
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i]
    const b = boxOf(n)
    if (!b || p.x < b.x - tol || p.x > b.x + b.w + tol || p.y < b.y - tol || p.y > b.y + b.h + tol) continue
    if (n.t === 'image' || n.t === 'text') { if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return n.id; continue }
    if (n.t === 'group') { if (hitGroup(n, p, tol, boxOf)) return n.id; continue }
    if (pathDistance(n.d, p) <= tol) return n.id
  }
  return null
}

/** Marquee: ids of pickable objects fully inside rect {x,y,w,h} (page points), or touching it when touching is true. */
export function marquee(store, boxOf, rect, touching = false) {
  const ids = []
  for (const n of pickables(store)) { const b = boxOf(n); if (b && (touching ? touches(b, rect) : inside(b, rect))) ids.push(n.id) }
  return ids
}

/** Snap target lines: page edges and centre, guides, edges and centres of visible unlocked objects in the viewport rect (nearest 3000), the grid when on. */
export function collectTargets(store, boxOf, exclude = new Set(), viewport = null, { grid = 0 } = {}) {
  const page = store.page()
  const xs = [0, page.w / 2, page.w], ys = [0, page.h / 2, page.h]
  for (const g of page.guides || []) (g.axis === 'v' ? xs : ys).push(g.pos)
  const near = []
  for (const n of pickables(store)) {
    if (exclude.has(n.id)) continue
    const b = boxOf(n)
    if (!b || (viewport && !touches(b, viewport))) continue
    near.push(b)
  }
  if (viewport && near.length > 3000) {
    const cx = viewport.x + viewport.w / 2, cy = viewport.y + viewport.h / 2
    near.sort((a, b) => Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) - Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy))
    near.length = 3000
  }
  for (const b of near) { xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h) }
  return { xs, ys, grid }
}
const best = (vals, targets, thr) => {
  let hit = null
  for (const v of vals) for (const t of targets) { const d = t - v; if (Math.abs(d) <= thr && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, at: t } }
  return hit
}
/** Offset {dx, dy} that snaps a moving box's left, centre, right and top, middle, bottom to targets (tolerance thr in points, i.e. 6 px / zoom). lines lists the snapped lines for the overlay. */
export function snapBox(box, T, thr, off = false) {
  if (off || !T) return { dx: 0, dy: 0, lines: { x: [], y: [] } }
  let bx = best([box.x, box.x + box.w / 2, box.x + box.w], T.xs, thr), by = best([box.y, box.y + box.h / 2, box.y + box.h], T.ys, thr)
  if (!bx && T.grid) { const g = Math.round(box.x / T.grid) * T.grid - box.x; if (Math.abs(g) <= thr) bx = { d: g, at: null } }
  if (!by && T.grid) { const g = Math.round(box.y / T.grid) * T.grid - box.y; if (Math.abs(g) <= thr) by = { d: g, at: null } }
  return { dx: bx?.d || 0, dy: by?.d || 0, lines: { x: bx?.at != null ? [bx.at] : [], y: by?.at != null ? [by.at] : [] } }
}
/** Snap one point (a node or a drawing point). Returns {x, y, lines}. */
export function snapPoint(p, T, thr, off = false) {
  if (off || !T) return { x: p.x, y: p.y, lines: { x: [], y: [] } }
  const bx = best([p.x], T.xs, thr), by = best([p.y], T.ys, thr)
  let x = bx ? p.x + bx.d : p.x, y = by ? p.y + by.d : p.y
  if (!bx && T.grid) { const g = Math.round(p.x / T.grid) * T.grid; if (Math.abs(g - p.x) <= thr) x = g }
  if (!by && T.grid) { const g = Math.round(p.y / T.grid) * T.grid; if (Math.abs(g - p.y) <= thr) y = g }
  return { x, y, lines: { x: bx ? [bx.at] : [], y: by ? [by.at] : [] } }
}
