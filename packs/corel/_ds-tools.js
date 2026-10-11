// Draw Studio tool framework and the first tools. A Tool is {id, label, icon, keys, cursor, activate(), deactivate(), pointerdown(ev), pointermove(ev),
// pointerup(ev), dblclick(ev), cancel(), overlay(g, h)}; ev = {p (page pt), s (screen px), mods, button, buttons, pointerType, target, detail}.
// Rule for every tool: preview without touching the store, commit once with store.tx. Milestone E3 adds move, scale, rotate and skew to Pick.
import { boxUnion, hitByDistance, marquee, pickFromTarget } from './_ds-hit.js'

/** Toolbox table: later milestones append their tools here (the toolbox, key table and menus are built from it). */
export const TOOL_INFO = [
  { id: 'pick', label: 'Pick', icon: 'mouse-pointer-2', keys: ['V'], cursor: 'default', tip: 'Select objects. Shift adds to the selection, Ctrl selects inside a group.' },
  { id: 'zoom', label: 'Zoom', icon: 'zoom-in', keys: ['Z', 'F2'], cursor: 'zoom-in', tip: 'Click to zoom in, Alt or right-click to zoom out, drag a box to zoom to it.' },
  { id: 'pan', label: 'Pan', icon: 'hand', keys: ['H'], cursor: 'grab', tip: 'Drag to move the view. Holding Space does the same from any tool.' },
]

const DRAG = 4 // px before a press becomes a drag

export function createTools({ store, view, boxOf, host }) {
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
  let drag = null // {a, b, shift, moved, kind}

  const pick = {
    ...TOOL_INFO[0],
    pointerdown(ev) {
      if (ev.button !== 0) return
      let id = pickFromTarget(ev.target, store, { deep: ev.mods.ctrl })
      if (id == null) id = hitByDistance(store, boxOf, ev.p, 6 / store.view.z)
      if (id != null) {
        const sel = store.sel.ids
        if (ev.mods.shift) store.setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
        else if (!sel.includes(id)) store.setSel([id])
        drag = null
        return
      }
      drag = { a: ev.p, b: ev.p, sa: ev.s, shift: ev.mods.shift, moved: false, kind: 'marquee' }
    },
    pointermove(ev) {
      if (!drag) return
      drag.b = ev.p
      if (!drag.moved && Math.hypot(ev.s.x - drag.sa.x, ev.s.y - drag.sa.y) > DRAG) drag.moved = true
      if (drag.moved) view.requestOverlay()
    },
    pointerup(ev) {
      if (!drag) return
      const d = drag
      drag = null
      if (d.moved) {
        const ids = marquee(store, boxOf, rectOf(d.a, d.b), ev.mods.alt)
        store.setSel(d.shift ? [...new Set([...store.sel.ids, ...ids])] : ids, 'marquee')
      } else if (!d.shift) store.setSel([])
      view.requestOverlay()
    },
    dblclick(ev) {
      const id = pickFromTarget(ev.target, store)
      const n = id != null && store.find(id)?.node
      if (n?.t === 'group') {
        store.ctx = n.id
        const inner = pickFromTarget(ev.target, store, { deep: true })
        store.setSel(inner != null && inner !== n.id ? [inner] : [])
        store.emit('status')
      }
    },
    cancel() { drag = null; view.requestOverlay() },
    overlay(g, { toScreen, el }) {
      const boxes = store.sel.ids.map((id) => store.find(id)?.node).filter(Boolean).map((n) => boxOf(n))
      const u = boxUnion(boxes)
      if (u) {
        const a = toScreen(u.x, u.y), b = toScreen(u.x + u.w, u.y + u.h)
        g.append(el('rect', { class: 'ds-selbox', x: a.x - 3, y: a.y - 3, width: Math.max(0, b.x - a.x) + 6, height: Math.max(0, b.y - a.y) + 6, fill: 'none' }))
      }
      if (drag?.moved) {
        const a = toScreen(Math.min(drag.a.x, drag.b.x), Math.min(drag.a.y, drag.b.y)), b = toScreen(Math.max(drag.a.x, drag.b.x), Math.max(drag.a.y, drag.b.y))
        g.append(el('rect', { class: 'ds-marquee', x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }))
      }
    },
  }

  const zoom = {
    ...TOOL_INFO[1],
    pointerdown(ev) { drag = { a: ev.p, b: ev.p, sa: ev.s, out: ev.mods.alt || ev.button === 2, moved: false, kind: 'zoom' } },
    pointermove(ev) {
      if (!drag) return
      drag.b = ev.p
      if (!drag.moved && Math.hypot(ev.s.x - drag.sa.x, ev.s.y - drag.sa.y) > DRAG) drag.moved = true
      if (drag.moved) view.requestOverlay()
    },
    pointerup(ev) {
      const d = drag
      drag = null
      if (!d) return
      if (d.moved && !d.out) view.fitBox(rectOf(d.a, d.b), 12)
      else view.zoomAt(d.out ? 1 / 1.5 : 1.5, ev.s.x, ev.s.y)
      view.requestOverlay()
    },
    cancel() { drag = null; view.requestOverlay() },
    overlay: pick.overlay,
  }
  // Pan is handled by the view's pointer router (store.tool === 'pan'), the tool object only supplies the cursor.
  const pan = { ...TOOL_INFO[2] }

  const tools = { pick, zoom, pan }
  let current = null
  function set(id) {
    const next = tools[id]
    if (!next) return false
    if (current === next) return true
    current?.cancel?.()
    current?.deactivate?.()
    current = next
    drag = null
    store.setTool(id)
    view.setTool(next)
    host.style.cursor = next.cursor || 'default'
    next.activate?.()
    view.requestOverlay()
    return true
  }
  view.addOverlay((g, h) => current?.overlay?.(g, h))
  set('pick')
  return { tools, list: TOOL_INFO, set, get current() { return current } }
}
