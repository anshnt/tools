// Draw Studio arrange operations: align, distribute, combine, break apart, lock, clip to container and the shape (parametric) edits. Pure: every
// operation takes a root and returns a new root (the SAME root when nothing changes, so store.tx records no step). Boxes come from an injected
// boxOf(node) because text boxes live in the DOM. Operations that create nodes take newId and report through `out`.
import { collect, leavesOf, replaceLeaves, transformItem } from './_ds-ops.js'
import { mapItems, replacePage } from './_ds-doc.js'
import { subsToD, dToSubs, applyShape } from './_ds-path.js'
import { boxUnion } from './_ds-hit.js'

const STRIP = ['shape', 'sm', 'nt', 'rot', 'src']
const plain = (n) => { const o = { ...n }; for (const k of STRIP) delete o[k]; return o }

// ---------- moving each object by its own offset ----------
/** Translate nodes by their own (dx, dy): deltas is a Map(id -> [dx, dy]). Objects that share a clip keep sharing it for equal offsets. */
export function moveEach(root, deltas) {
  const memos = new Map()
  const live = new Map([...deltas].filter(([, [dx, dy]]) => Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9))
  if (!live.size) return root
  return mapItems(root, new Set(live.keys()), (n) => {
    const [dx, dy] = live.get(n.id), k = `${dx}|${dy}`
    if (!memos.has(k)) memos.set(k, new Map())
    return transformItem(n, [1, 0, 0, 1, dx, dy], { memo: memos.get(k) })
  })
}
const nodesOf = (root, ids) => collect(root, new Set(ids)).map((f) => f.node)

// ---------- align ----------
export const ALIGN_MODES = ['left', 'right', 'top', 'bottom', 'centerH', 'centerV', 'center']
/**
 * Align the selected objects to the box `ref` {x, y, w, h}. 'left', 'right', 'top', 'bottom' move each object's own edge onto the reference
 * edge, 'centerH' puts each centre on the reference's vertical centre line, 'centerV' on its horizontal centre line, and 'center' moves the
 * selection as ONE block so its centre sits on the reference centre (centre on page).
 */
export function align(root, ids, mode, ref, boxOf) {
  const nodes = nodesOf(root, ids)
  const boxes = new Map(nodes.map((n) => [n.id, boxOf(n)]).filter(([, b]) => b))
  if (!boxes.size || !ref) return root
  const d = new Map()
  if (mode === 'center') {
    const u = boxUnion([...boxes.values()])
    const dx = ref.x + ref.w / 2 - (u.x + u.w / 2), dy = ref.y + ref.h / 2 - (u.y + u.h / 2)
    for (const id of boxes.keys()) d.set(id, [dx, dy])
    return moveEach(root, d)
  }
  for (const [id, b] of boxes) {
    let dx = 0, dy = 0
    if (mode === 'left') dx = ref.x - b.x
    else if (mode === 'right') dx = ref.x + ref.w - (b.x + b.w)
    else if (mode === 'top') dy = ref.y - b.y
    else if (mode === 'bottom') dy = ref.y + ref.h - (b.y + b.h)
    else if (mode === 'centerH') dx = ref.x + ref.w / 2 - (b.x + b.w / 2)
    else if (mode === 'centerV') dy = ref.y + ref.h / 2 - (b.y + b.h / 2)
    d.set(id, [dx, dy])
  }
  return moveEach(root, d)
}

// ---------- distribute ----------
export const DISTRIBUTE_MODES = ['left', 'centerH', 'right', 'spaceH', 'top', 'centerV', 'bottom', 'spaceV']
/**
 * Spread the selected objects evenly along one axis. Edge and centre modes space the chosen coordinate evenly; the space modes make the gaps
 * between neighbouring objects equal. extent: the box to spread over, or null for the selection's own box (the two outer objects stay put).
 */
export function distribute(root, ids, mode, boxOf, extent = null) {
  const nodes = nodesOf(root, ids)
  const items = nodes.map((n) => ({ id: n.id, b: boxOf(n) })).filter((o) => o.b)
  if (items.length < (extent ? 2 : 3)) return root
  const horiz = ['left', 'centerH', 'right', 'spaceH'].includes(mode)
  const lo = (b) => (horiz ? b.x : b.y), size = (b) => (horiz ? b.w : b.h)
  const sel = boxUnion(items.map((o) => o.b))
  const ext = extent || sel
  const start = horiz ? ext.x : ext.y, len = horiz ? ext.w : ext.h
  const d = new Map()
  const shift = (o, delta) => d.set(o.id, horiz ? [delta, 0] : [0, delta])
  if (mode === 'spaceH' || mode === 'spaceV') {
    items.sort((a, b) => lo(a.b) - lo(b.b))
    const gap = (len - items.reduce((s, o) => s + size(o.b), 0)) / (items.length - 1)
    let at = start
    for (const o of items) { shift(o, at - lo(o.b)); at += size(o.b) + gap }
    return moveEach(root, d)
  }
  const kind = mode === 'left' || mode === 'top' ? 0 : mode === 'right' || mode === 'bottom' ? 2 : 1
  const key = (b) => lo(b) + (kind * size(b)) / 2
  items.sort((a, b) => key(a.b) - key(b.b))
  const first = items[0], last = items[items.length - 1]
  const k0 = extent ? start + (kind * size(first.b)) / 2 : key(first.b)
  const k1 = extent ? start + len - ((2 - kind) * size(last.b)) / 2 : key(last.b)
  items.forEach((o, i) => shift(o, k0 + ((k1 - k0) * i) / (items.length - 1) - key(o.b)))
  return moveEach(root, d)
}

// ---------- combine and break apart ----------
/** Why these leaves cannot be combined, or '' (only drawn shapes can). */
export const combineBlocker = (leaves) => (leaves.some((l) => l.t === 'text') ? 'Convert text to curves first (Ctrl+Q).' : leaves.some((l) => l.t === 'image') ? 'Pictures cannot be combined with shapes.' : '')
/**
 * Merge the selected shapes (groups give their shapes) into ONE curve with several sub-paths, filled with the even-odd rule so overlaps become
 * holes. It takes the look of the top-most shape and sits at its place. out.id receives the new id. Returns the same root for fewer than two shapes.
 */
export function combine(root, ids, newId, { out } = {}) {
  const found = collect(root, new Set(ids))
  const leaves = leavesOf(found.map((f) => f.node))
  if (leaves.length < 2 || leaves.some((l) => l.t !== 'path')) return root
  const top = leaves[leaves.length - 1]
  const sameClip = leaves.every((l) => l.clip === top.clip)
  const node = { ...plain(top), id: newId(), d: leaves.flatMap((l) => l.d), rule: 'evenodd' }
  delete node.name
  if (!sameClip) delete node.clip
  if (out) { out.id = node.id; out.clipDropped = !sameClip && leaves.some((l) => l.clip) }
  const topId = found[found.length - 1].node.id
  const r = mapItems(root, new Set([topId]), () => node)
  return mapItems(r, new Set(found.slice(0, -1).map((f) => f.node.id)), () => null)
}
/** Split every selected curve that has several sub-paths into separate objects (the first keeps its id). out.ids receives every resulting id. */
export function breakApart(root, ids, newId, { out } = {}) {
  const made = []
  const r = mapItems(root, new Set(ids), (n) => {
    if (n.t !== 'path') return n
    const subs = dToSubs(n.d)
    if (subs.length < 2) { made.push(n.id); return n }
    const pieces = subs.map((s, i) => { const o = { ...plain(n), id: i ? newId() : n.id, d: subsToD([s]) }; if (i && o.name) o.name = `${o.name} ${i + 1}`; return o })
    for (const p of pieces) made.push(p.id)
    return pieces
  })
  if (out) out.ids = made
  return r
}

// ---------- lock ----------
/** Unlock every object of a page (layers keep their own lock). */
export function unlockAll(root, pageId) {
  const rec = (items) => {
    let out = null
    items.forEach((n, i) => {
      let r = n
      if (n.t === 'group') { const sub = rec(n.items); if (sub !== n.items) r = { ...n, items: sub } }
      if (r.locked) { const { locked: _l, ...rest } = r; r = rest }
      if (r !== n && !out) out = items.slice(0, i)
      if (out) out.push(r)
    })
    return out || items
  }
  return replacePage(root, pageId, (p) => {
    let changed = false
    const layers = p.layers.map((l) => { const items = rec(l.items); if (items === l.items) return l; changed = true; return { ...l, items } })
    return changed ? { ...p, layers } : p
  })
}
/** Number of locked objects (not layers) on a page. */
export function countLocked(page) {
  let n = 0
  const rec = (items) => { for (const k of items) { if (k.locked) n++; if (k.t === 'group') rec(k.items) } }
  for (const l of page.layers) rec(l.items)
  return n
}

// ---------- clip to container ----------
/** Clip the contents (every leaf under ids) to the outline of the container curve; the container stays where it is. Returns the same root when nothing can be clipped. */
export function clipInside(root, ids, container) {
  if (!container || container.t !== 'path') return root
  const clip = { d: container.d.map((c) => c.slice()), rule: container.rule === 'evenodd' ? 'evenodd' : 'nonzero' }
  const leaf = (n) => ({ ...n, clip: [...(n.clip || []), clip] })
  const rec = (n) => (n.t === 'group' ? { ...n, items: n.items.map(rec) } : leaf(n))
  const set = new Set(ids.filter((id) => id !== container.id))
  return set.size ? mapItems(root, set, rec) : root
}
/** Take the clip off every leaf under the nodes. */
export function releaseClip(root, ids) {
  const rec = (n) => {
    if (n.t === 'group') { let items = null; n.items.forEach((k, i) => { const r = rec(k); if (r !== k) { items ??= n.items.slice(); items[i] = r } }); return items ? { ...n, items } : n }
    if (!n.clip) return n
    const { clip: _c, ...rest } = n
    return rest
  }
  return mapItems(root, new Set(ids), rec)
}
export const hasClip = (nodes) => leavesOf(nodes).some((l) => l.clip?.length)

// ---------- parametric shapes ----------
/** Change the parametric description of the shape nodes under ids (patch, or patch(shape, sm) -> patch, merges into node.shape; a key set to undefined is removed; kinds must match). The path is rebuilt through sm. */
export function setShape(root, ids, kind, patchOrFn) {
  const rec = (n) => {
    if (n.t === 'group') { let items = null; n.items.forEach((k, i) => { const r = rec(k); if (r !== k) { items ??= n.items.slice(); items[i] = r } }); return items ? { ...n, items } : n }
    if (n.t !== 'path' || n.shape?.k !== kind || !n.sm) return n
    const patch = typeof patchOrFn === 'function' ? patchOrFn(n.shape, n.sm) : patchOrFn
    const shape = { ...n.shape, ...patch }
    for (const k of Object.keys(shape)) if (shape[k] === undefined) delete shape[k]
    const keys = new Set([...Object.keys(shape), ...Object.keys(n.shape)])
    if ([...keys].every((k) => shape[k] === n.shape[k])) return n
    return applyShape(n, shape)
  }
  return mapItems(root, new Set(ids), rec)
}
export { replaceLeaves }
