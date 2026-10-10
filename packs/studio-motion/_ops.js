// Layer commands shared by the toolbar, timeline, canvas and keyboard. Each one is a single undo step.
import { toast } from '../../lib/ui.js'
import { uid, valueAt, isAnimated } from './_anim.js'
import { makeLayer, findLayer, cloneLayer, allLayers, walk } from './_model.js'

/** Where a new layer goes: just above the selected layer, else on top of the stack. */
function insertAbove(doc, L, anchorId) {
  const hit = anchorId && findLayer(doc, anchorId)
  if (hit) hit.list.splice(hit.index, 0, L)
  else doc.layers.unshift(L)
}

export function addLayer(store, type, o = {}) {
  let L
  store.edit(`Add ${type} layer`, (doc) => {
    L = makeLayer(doc, type, o)
    if (o.mutate) o.mutate(L, doc)
    insertAbove(doc, L, store.sel[0])
  })
  store.select([L.id])
  return L
}

export function deleteLayers(store, ids = store.sel) {
  if (!ids.length) return
  store.edit('Delete layers', (doc) => {
    for (const id of ids) {
      const hit = findLayer(doc, id)
      if (hit) hit.list.splice(hit.index, 1)
    }
  })
  store.select([])
}

export function duplicateLayers(store, ids = store.sel) {
  const fresh = []
  store.edit('Duplicate layers', (doc) => {
    for (const id of ids) {
      const hit = findLayer(doc, id)
      if (!hit) continue
      const c = cloneLayer(hit.layer)
      c.name = `${hit.layer.name} copy`
      hit.list.splice(hit.index, 0, c)
      fresh.push(c.id)
    }
  })
  store.select(fresh)
}

export const copyLayers = (store) => {
  store.clip = store.selected.map((l) => JSON.parse(JSON.stringify(l)))
  if (store.clip.length) toast(`Copied ${store.clip.length} layer${store.clip.length > 1 ? 's' : ''}`)
}
export function pasteLayers(store) {
  if (!store.clip.length) return
  const fresh = []
  store.edit('Paste layers', (doc) => {
    for (const src of [...store.clip].reverse()) {
      const c = cloneLayer(src)
      if (!isAnimated(c.props.position)) c.props.position.v = c.props.position.v.map((n) => n + 24)
      insertAbove(doc, c, store.sel[0])
      fresh.push(c.id)
    }
  })
  store.select(fresh)
}

/** Move a layer within its stack: 'up' | 'down' | 'top' | 'bottom'. */
export function moveLayer(store, id, dir) {
  store.edit('Reorder layer', (doc) => {
    const hit = findLayer(doc, id)
    if (!hit) return
    const { list, index } = hit
    const to = dir === 'up' ? index - 1 : dir === 'down' ? index + 1 : dir === 'top' ? 0 : list.length - 1
    if (to < 0 || to >= list.length || to === index) return
    list.splice(to, 0, ...list.splice(index, 1))
  })
}

/** Wrap the selected layers (which must share one stack) in a group. */
export function groupLayers(store, ids = store.sel) {
  if (!ids.length) return toast('Select one or more layers to group.')
  let gid = null
  store.edit('Group layers', (doc) => {
    const hits = ids.map((id) => findLayer(doc, id)).filter(Boolean)
    if (!hits.length) return
    const list = hits[0].list
    if (hits.some((h) => h.list !== list)) { toast('Select layers from the same level to group them.', 'error'); return }
    hits.sort((a, b) => a.index - b.index)
    const g = makeLayer(doc, 'group')
    g.children = hits.map((h) => h.layer)
    const at = hits[0].index
    for (const h of [...hits].reverse()) list.splice(h.index, 1)
    list.splice(at, 0, g)
    gid = g.id
  })
  if (gid) store.select([gid])
}

const isIdentity = (L) => !Object.values(L.props).some(isAnimated) && L.props.position.v.every((n) => !n) && L.props.anchor.v.every((n) => !n) &&
  L.props.rotation.v === 0 && L.props.scale.v.every((n) => n === 100) && L.props.opacity.v === 100
export function ungroupLayer(store, id = store.sel[0]) {
  const hit = id && findLayer(store.doc, id)
  if (!hit || hit.layer.type !== 'group') return toast('Select a group to ungroup.')
  if (!isIdentity(hit.layer)) return toast('Reset the group\'s transform (position 0, scale 100, rotation 0, no keyframes) before ungrouping.', 'error')
  let ids = []
  store.edit('Ungroup', (doc) => {
    const h = findLayer(doc, id)
    ids = h.layer.children.map((c) => c.id)
    h.list.splice(h.index, 1, ...h.layer.children)
  })
  store.select(ids)
}

export function nudge(store, dx, dy) {
  const t = store.time
  const layers = store.selected.filter((l) => !l.locked)
  if (!layers.length) return
  store.edit('Nudge', (doc) => {
    for (const L of layers) {
      const d = findLayer(doc, L.id).layer, p = d.props.position
      const v = valueAt(p, t)
      const nv = [v[0] + dx, v[1] + dy]
      if (isAnimated(p)) {
        const k = p.k.find((x) => Math.abs(x.t - t) < 1e-4)
        if (k) k.v = nv
        else { p.k.push({ id: uid('k'), t, v: nv, e: [0.42, 0, 0.58, 1] }); p.k.sort((a, b) => a.t - b.t) }
      } else p.v = nv
    }
  }, `nudge`)
}

/** Set a layer's in or out point (seconds). */
export function setRange(store, id, inPoint, outPoint) {
  store.edit('Set layer time', (doc) => {
    const L = findLayer(doc, id)?.layer
    if (!L) return
    const d = doc.comp.duration, step = 1 / doc.comp.fps
    if (inPoint != null) L.inPoint = Math.min(Math.max(0, inPoint), L.outPoint - step)
    if (outPoint != null) L.outPoint = Math.max(Math.min(d, outPoint), L.inPoint + step)
  }, `range:${id}`)
}

export { allLayers, walk }
