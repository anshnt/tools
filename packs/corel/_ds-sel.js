// Selection helpers shared by the Pick tool, the commands and the bars. Pure (read the store, never the DOM).
import { boxUnion } from './_ds-hit.js'
import { styleSummary } from './_ds-ops.js'

/** True when the node, its layer or any group above it is locked (such objects are not edited from the canvas, nudged or recoloured). */
export function isLocked(store, id) {
  const f = store.find(id)
  if (!f?.node) return false
  if (f.node.locked || f.layer?.locked) return true
  for (let p = f.parent; p; p = store.find(p.id)?.parent) if (p.locked) return true
  return false
}
/** Selected ids that may be edited (not locked). */
export const editableIds = (store, ids = store.sel.ids) => ids.filter((id) => store.find(id)?.node && !isLocked(store, id))
/** Ids without a selected ancestor (the nodes a gesture previews, since a group moves its children). */
export function topIds(store, ids = store.sel.ids) {
  const set = new Set(ids)
  return ids.filter((id) => {
    for (let p = store.find(id)?.parent; p; p = store.find(p.id)?.parent) if (set.has(p.id)) return false
    return true
  })
}
/** Union box of the nodes with these ids, or null. */
export function selectionBox(store, boxOf, ids = store.sel.ids) {
  return boxUnion(ids.map((id) => store.find(id)?.node).filter(Boolean).map((n) => boxOf(n)))
}
/** Every object on the current page that Tab can visit, in z order: top-level objects of visible unlocked layers (or the children of the entered group). */
export function tabOrder(store) {
  const out = []
  const ctx = store.ctx != null ? store.find(store.ctx)?.node : null
  if (ctx?.t === 'group') { for (const n of ctx.items) if (!n.hidden && !n.locked) out.push(n.id); return out }
  for (const l of store.page()?.layers || []) if (!l.hidden && !l.locked) for (const n of l.items) if (!n.hidden && !n.locked) out.push(n.id)
  return out
}

let memo = null
/** styleSummary of the current selection, cached per document root and selection (the bars ask on every refresh). */
export function selectionStyle(store) {
  const ids = store.sel.ids
  if (memo && memo.root === store.root && memo.ids === ids) return memo.val
  const val = ids.length ? styleSummary(ids.map((id) => store.find(id)?.node).filter(Boolean)) : null
  memo = { root: store.root, ids, val }
  return val
}
