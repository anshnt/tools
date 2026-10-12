// Draw Studio guides: pure operations over roots, like _ds-ops.js. A guide is {id, axis: 'v' | 'h', pos} in page points from the TOP-LEFT corner
// ('v' is a vertical line at x = pos, 'h' a horizontal line at y = pos), kept in Page.guides. Every op returns the SAME root when nothing changes.
// A page that is still being read (page.pending) is a shared placeholder, so it is never touched.
import { LIMITS, replacePage } from './_ds-doc.js'

const clampPos = (v) => Math.max(-1e6, Math.min(1e6, v))
const live = (root, pageId) => { const p = root.pages.find((x) => x.id === pageId); return p && !p.pending ? p : null }

/** Add a guide. out.id receives its id. */
export function addGuide(root, pageId, axis, pos, newId, { out } = {}) {
  const p = live(root, pageId)
  if (!p || (axis !== 'h' && axis !== 'v') || !Number.isFinite(pos) || (p.guides || []).length >= LIMITS.guides) return root
  const g = { id: newId(), axis, pos: clampPos(pos) }
  if (out) out.id = g.id
  return replacePage(root, pageId, (pg) => ({ ...pg, guides: [...(pg.guides || []), g] }))
}
export function moveGuide(root, pageId, id, pos) {
  const p = live(root, pageId)
  if (!p || !Number.isFinite(pos)) return root
  const at = (p.guides || []).findIndex((g) => g.id === id)
  if (at < 0 || p.guides[at].pos === clampPos(pos)) return root
  return replacePage(root, pageId, (pg) => ({ ...pg, guides: pg.guides.map((g) => (g.id === id ? { ...g, pos: clampPos(pos) } : g)) }))
}
export function deleteGuide(root, pageId, id) {
  const p = live(root, pageId)
  if (!p || !(p.guides || []).some((g) => g.id === id)) return root
  return replacePage(root, pageId, (pg) => ({ ...pg, guides: pg.guides.filter((g) => g.id !== id) }))
}
export function clearGuides(root, pageId) {
  const p = live(root, pageId)
  return p && (p.guides || []).length ? replacePage(root, pageId, (pg) => ({ ...pg, guides: [] })) : root
}
/** The guide within `tolPx` screen pixels of the screen point (sx, sy), nearest first, or null. toScreen(x, y) -> {x, y}. */
export function guideAt(guides, toScreen, sx, sy, tolPx = 4) {
  let best = null, bd = tolPx + 1e-9
  for (const g of guides || []) {
    const d = Math.abs(g.axis === 'v' ? toScreen(g.pos, 0).x - sx : toScreen(0, g.pos).y - sy)
    if (d <= bd) { bd = d; best = g }
  }
  return best
}
