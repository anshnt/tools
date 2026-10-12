// Draw Studio tool framework and the first tools. A Tool is {id, label, icon, keys, cursor, activate(), deactivate(), pointerdown(ev), pointermove(ev),
// pointerup(ev), dblclick(ev), cancel(), overlay(g, h)}; ev = {p (page pt), s (screen px), mods, button, buttons, pointerType, target, detail}.
// Rule for every tool: preview without touching the store, commit once with store.tx. Pick lives in _ds-pick.js.
import { createPick } from './_ds-pick.js'
import { createDrawTools } from './_ds-tools-draw.js'
import { createShapeTool } from './_ds-shape.js'
import { selectionBox } from './_ds-sel.js'

/** Toolbox table: later milestones append their tools here (the toolbox, key table and menus are built from it). */
export const TOOL_INFO = [
  { id: 'pick', label: 'Pick', icon: 'mouse-pointer-2', keys: ['V'], cursor: 'default', tip: 'Select objects. Shift adds to the selection, Ctrl selects inside a group.' },
  { id: 'shape', label: 'Shape', icon: 'spline-pointer', keys: ['F10'], cursor: 'default', tip: 'Edit the nodes of a curve: drag nodes and handles, double-click a segment to add a node.' },
  { id: 'zoom', label: 'Zoom', icon: 'zoom-in', keys: ['Z', 'F2'], cursor: 'zoom-in', tip: 'Click to zoom in, Alt or right-click to zoom out, drag a box to zoom to it.' },
  { id: 'pan', label: 'Pan', icon: 'hand', keys: ['H'], cursor: 'grab', tip: 'Drag to move the view. Holding Space does the same from any tool.' },
  { id: 'free', label: 'Freehand', icon: 'pencil', keys: ['F5'], cursor: 'crosshair', tip: 'Drag to draw a smooth line. Click points for a polyline, double-click or Enter to finish.' },
  { id: 'pen', label: 'Bezier', icon: 'pen-tool', keys: ['Shift+P', 'Shift+F5'], cursor: 'crosshair', tip: 'Click for corner points, drag for smooth ones, click the first point to close. Enter finishes.' },
  { id: 'rect', label: 'Rectangle', icon: 'square', keys: ['F6'], cursor: 'crosshair', tip: 'Drag a rectangle. Ctrl makes a square, Shift draws from the centre. Set the corner radius in the property bar.' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle', keys: ['F7'], cursor: 'crosshair', tip: 'Drag an ellipse. Ctrl makes a circle, Shift draws from the centre. Pie and arc angles are in the property bar.' },
  { id: 'polygon', label: 'Polygon', icon: 'hexagon', keys: ['Y'], cursor: 'crosshair', tip: 'Drag from the centre outwards. Set the number of sides in the property bar.' },
  { id: 'star', label: 'Star', icon: 'star', keys: ['Shift+Y'], cursor: 'crosshair', tip: 'Drag from the centre outwards. Set the points and sharpness in the property bar.' },
  { id: 'text', label: 'Text', icon: 'type', keys: ['F8'], cursor: 'text', tip: 'Click to type text. Click existing text to edit it in place.' },
]
const infoOf = (id) => TOOL_INFO.find((t) => t.id === id)

const DRAG = 4 // px before a press becomes a drag

/** extra: tools built elsewhere because they need more of the app (the Text tool needs the in-place editor): {id: tool}. */
export function createTools({ store, view, boxOf, host, renderer, extra = {} }) {
  const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
  let drag = null // zoom tool: {a, b, sa, out, moved}

  const pick = createPick({ store, view, boxOf, renderer, host, info: infoOf('pick') })
  const shape = createShapeTool({ store, view, boxOf, renderer, host, info: infoOf('shape') })
  const draw = createDrawTools({ store, view, boxOf, host, info: TOOL_INFO })

  const zoom = {
    ...infoOf('zoom'),
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
    overlay(g, { toScreen, el }) {
      const b = store.sel.ids.length && selectionBox(store, boxOf)
      if (b) { const a = toScreen(b.x, b.y), c = toScreen(b.x + b.w, b.y + b.h); g.append(el('rect', { class: 'ds-selbox', x: a.x - 3, y: a.y - 3, width: Math.max(0, c.x - a.x) + 6, height: Math.max(0, c.y - a.y) + 6, fill: 'none' })) }
      if (drag?.moved) {
        const a = toScreen(Math.min(drag.a.x, drag.b.x), Math.min(drag.a.y, drag.b.y)), c = toScreen(Math.max(drag.a.x, drag.b.x), Math.max(drag.a.y, drag.b.y))
        g.append(el('rect', { class: 'ds-marquee', x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y }))
      }
    },
  }
  // Pan is handled by the view's pointer router (store.tool === 'pan'), the tool object only supplies the cursor.
  const pan = { ...infoOf('pan') }

  const tools = { pick, shape, zoom, pan, ...draw, ...extra }
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
  store.on('shapetool', () => set('shape')) // double-click on a curve with the Pick tool
  set('pick')
  /** Esc: abandon a gesture in progress (a drag preview). Returns true when there was one. */
  function cancelGesture() {
    if (!(current?.busy || (current === zoom && drag))) return false
    current.cancel()
    return true
  }
  return { tools, list: TOOL_INFO, set, cancelGesture, get current() { return current } }
}
