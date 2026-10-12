// Draw Studio Pick tool: select (click, Shift, Ctrl inside a group, Alt behind, marquee), move with snapping, scale with the eight handles,
// and a second click on a selected object switches to rotate and skew handles with a movable pivot.
// Every gesture previews through renderer.preview (a CSS transform on the selected objects) and commits ONE store.tx on release; Esc cancels
// for free because the store was never touched. Handles are drawn in the screen-space overlay so they keep a constant size.
import { collectTargets, hitByDistance, marquee, pickFromTarget, snapBox, snapPoint } from './_ds-hit.js'
import { HANDLE_IDS, DEG15, constrainMove, handlePoint, hitHandle, rotateFrom, scaleFromHandle, skewFromHandle } from './_ds-gesture.js'
import { boxQuad, transformIds } from './_ds-ops.js'
import { translate } from './_model.js'
import { editableIds, selectionBox, topIds } from './_ds-sel.js'
import { fmt } from './_ds-units.js'

const DRAG = 4 // px before a press becomes a drag
const OUT_SCALE = 3, OUT_ROT = 10 // how far the handle frame sits outside the selection box (screen px)
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }
const SKEW_CURSORS = { n: 'ew-resize', s: 'ew-resize', e: 'ns-resize', w: 'ns-resize' }
const CORNERS = ['nw', 'ne', 'se', 'sw'], EDGES = ['n', 'e', 's', 'w']
const rectOf = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })

export function createPick({ store, view, boxOf, renderer, host, info }) {
  let drag = null // {kind: 'pending'|'move'|'marquee'|'scale'|'rotate'|'skew'|'pivot', ...}
  let mode = 'scale' // 'scale' or 'rotate' (rotate and skew handles)
  let pivot = null // page point, null = centre of the selection
  let warned = false
  const snapOn = () => store.prefs.snap !== false
  const units = () => store.root.units

  // a changed selection starts over with the scale handles (undo and redo keep the mode when the same objects stay selected)
  const reset = () => { mode = 'scale'; pivot = null; warned = false }
  let lastSel = ''
  store.on('sel', () => { const k = store.sel.ids.join(','); if (k !== lastSel) { lastSel = k; reset() } })

  const viewportRect = () => { const s = view.size(), a = view.toPage(0, 0), b = view.toPage(s.w, s.h); return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } }
  const toScreenBox = (b, out) => { const a = view.toScreen(b.x, b.y), c = view.toScreen(b.x + b.w, b.y + b.h); return { x: a.x - out, y: a.y - out, w: c.x - a.x + 2 * out, h: c.y - a.y + 2 * out } }
  const curBox = () => (store.sel.ids.length ? selectionBox(store, boxOf) : null)
  const curPivot = (b) => pivot || { x: b.x + b.w / 2, y: b.y + b.h / 2 }

  /** The handles that exist for a screen box: tiny boxes get none, short sides lose their edge handles. */
  function handleIds(sb) {
    if (sb.w < 18 && sb.h < 18) return []
    const edges = EDGES.filter((id) => (id === 'n' || id === 's' ? sb.w >= 26 : sb.h >= 26))
    return [...CORNERS, ...edges]
  }
  function handleAt(ev) {
    const b = curBox()
    if (!b || !editableIds(store).length) return null
    const out = mode === 'rotate' ? OUT_ROT : OUT_SCALE
    const sb = toScreenBox(b, out)
    const r = ev.pointerType === 'touch' ? 16 : 8
    if (mode === 'rotate') {
      const pv = view.toScreen(curPivot(b).x, curPivot(b).y)
      if (Math.hypot(pv.x - ev.s.x, pv.y - ev.s.y) <= r) return 'pivot'
    }
    return hitHandle(sb, handleIds(sb), ev.s, r)
  }

  /** The object under the pointer: native target first (honours clips), then the tolerance pass. Alt picks the next one behind. */
  function objectAt(ev) {
    if (ev.mods.alt && ev.raw) {
      const seen = []
      for (const el of document.elementsFromPoint(ev.raw.clientX, ev.raw.clientY)) {
        const id = pickFromTarget(el, store, { deep: ev.mods.ctrl })
        if (id != null && !seen.includes(id)) seen.push(id)
      }
      if (seen.length) {
        const cur = store.sel.ids.length === 1 ? seen.indexOf(store.sel.ids[0]) : -1
        return seen[cur >= 0 ? (cur + 1) % seen.length : 0]
      }
    }
    let id = pickFromTarget(ev.target, store, { deep: ev.mods.ctrl })
    if (id == null) id = hitByDistance(store, boxOf, ev.p, 6 / store.view.z)
    return id
  }

  // ---------- starting gestures ----------
  function startTransform(kind, hid, ev) {
    const ids = topIds(store, editableIds(store))
    const box0 = selectionBox(store, boxOf, ids)
    if (!ids.length || !box0) return
    drag = { kind, hid, a: ev.p, sa: ev.s, ids, box0, M: null, moved: false, T: kind === 'scale' ? collectTargets(store, boxOf, new Set(store.sel.ids), viewportRect()) : null }
  }
  function startMove() {
    const ids = topIds(store, editableIds(store))
    const box0 = ids.length && selectionBox(store, boxOf, ids)
    if (!ids.length || !box0) {
      if (!warned) { warned = true; store.setStatus('Locked objects cannot be moved. Unlock them in the Objects docker.') }
      drag = null
      return
    }
    Object.assign(drag, { kind: 'move', ids, box0, M: null, moved: true, T: collectTargets(store, boxOf, new Set(store.sel.ids), viewportRect()), lines: { x: [], y: [] } })
  }

  const status = (t) => store.setStatus(t)
  const dims = (b) => `W ${fmt(b.w, units())}  H ${fmt(b.h, units())} ${units()}`

  function updateMove(ev) {
    const d = drag
    let dx = ev.p.x - d.a.x, dy = ev.p.y - d.a.y
    let lock = null
    if (ev.mods.ctrl) { const c = constrainMove(dx, dy); lock = c.dy === 0 ? 'y' : 'x'; dx = c.dx; dy = c.dy }
    const moved = { x: d.box0.x + dx, y: d.box0.y + dy, w: d.box0.w, h: d.box0.h }
    const s = snapBox(moved, d.T, 6 / store.view.z, ev.mods.alt || !snapOn())
    if (lock !== 'y') dx += s.dx
    if (lock !== 'x') dy += s.dy
    d.lines = { x: lock === 'y' ? [] : s.lines.x, y: lock === 'x' ? [] : s.lines.y }
    d.M = translate(dx, dy)
    renderer.preview(d.ids, d.M)
    status(`Move  X ${fmt(dx, units())}  Y ${fmt(-dy, units())} ${units()}`)
  }
  function updateScale(ev) {
    const d = drag
    let dv = { x: ev.p.x - d.a.x, y: ev.p.y - d.a.y }
    if (d.T && snapOn()) {
      const h0 = handlePoint(d.box0, d.hid)
      const sp = snapPoint({ x: h0.x + dv.x, y: h0.y + dv.y }, d.T, 6 / store.view.z)
      if (d.hid.includes('w') || d.hid.includes('e')) dv = { ...dv, x: sp.x - h0.x }
      if (d.hid.includes('n') || d.hid.includes('s')) dv = { ...dv, y: sp.y - h0.y }
      d.lines = sp.lines
    }
    const r = scaleFromHandle(d.box0, d.hid, dv, { shift: ev.mods.shift, alt: ev.mods.alt })
    d.M = r.M
    d.sx = r.sx; d.sy = r.sy
    renderer.preview(d.ids, d.M)
    status(`Scale  ${Math.round(Math.abs(r.sx) * 100)}% x ${Math.round(Math.abs(r.sy) * 100)}%   ${dims({ w: d.box0.w * Math.abs(r.sx), h: d.box0.h * Math.abs(r.sy) })}`)
  }
  function updateRotate(ev) {
    const d = drag
    const r = rotateFrom(curPivot(d.box0), d.a, ev.p, { step: ev.mods.ctrl ? DEG15 : 0 })
    d.M = r.M
    renderer.preview(d.ids, d.M)
    status(`Rotate  ${(((-r.angle * 180) / Math.PI) + 0).toFixed(1)} degrees`)
  }
  function updateSkew(ev) {
    const d = drag
    const r = skewFromHandle(d.box0, d.hid, curPivot(d.box0), { x: ev.p.x - d.a.x, y: ev.p.y - d.a.y })
    if (!r) return
    d.M = r.M
    renderer.preview(d.ids, d.M)
    status(`Skew  ${((Math.atan(r.k) * 180) / Math.PI).toFixed(1)} degrees`)
  }

  function commit() {
    const d = drag
    renderer.clearPreview()
    if (d.M) {
      const label = { move: 'Move', scale: 'Resize', rotate: 'Rotate', skew: 'Skew' }[d.kind]
      store.tx(label, (r) => transformIds(r, d.ids, d.M, { scaleStroke: !!store.prefs.scaleStroke }))
    }
  }
  function endGesture() { drag = null; store.setStatus(''); view.requestOverlay() }

  const tool = {
    ...info,
    get busy() { return !!drag && drag.kind !== 'pending' },
    pointerdown(ev) {
      if (ev.button !== 0) return
      drag = null
      const hid = handleAt(ev)
      if (hid === 'pivot') { drag = { kind: 'pivot', moved: false }; return }
      if (hid) { startTransform(mode === 'rotate' ? (CORNERS.includes(hid) ? 'rotate' : 'skew') : 'scale', hid, ev); return }
      const id = objectAt(ev)
      if (id != null) {
        const sel = store.sel.ids
        if (ev.mods.shift) { store.setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]); return }
        const was = sel.includes(id)
        if (!was) store.setSel([id])
        drag = { kind: 'pending', a: ev.p, sa: ev.s, was }
        return
      }
      drag = { kind: 'marquee', a: ev.p, b: ev.p, sa: ev.s, shift: ev.mods.shift, moved: false }
    },
    pointermove(ev) {
      if (!drag) {
        if (ev.pointerType === 'touch') return
        const hid = handleAt(ev)
        host.style.cursor = hid === 'pivot' ? 'move' : hid ? (mode === 'rotate' ? (CORNERS.includes(hid) ? 'alias' : SKEW_CURSORS[hid]) : CURSORS[hid]) : info.cursor || 'default'
        return
      }
      const far = Math.hypot(ev.s.x - drag.sa?.x, ev.s.y - drag.sa?.y) > DRAG
      if (drag.kind === 'pending') { if (far) { startMove(); if (drag) updateMove(ev) } }
      else if (drag.kind === 'move') updateMove(ev)
      else if (drag.kind === 'marquee') { drag.b = ev.p; if (!drag.moved && far) drag.moved = true; if (drag.moved) view.requestOverlay() }
      else if (drag.kind === 'pivot') { const b = curBox(); if (b) { pivot = { x: ev.p.x, y: ev.p.y }; drag.moved = true } }
      else if (far || drag.moved) {
        drag.moved = true
        if (drag.kind === 'scale') updateScale(ev)
        else if (drag.kind === 'rotate') updateRotate(ev)
        else if (drag.kind === 'skew') updateSkew(ev)
      }
      view.requestOverlay()
    },
    pointerup(ev) {
      const d = drag
      if (!d) return
      if (d.kind === 'pending') {
        if (d.was && !ev.mods.shift) { mode = mode === 'scale' ? 'rotate' : 'scale'; pivot = null }
      } else if (d.kind === 'marquee') {
        if (d.moved) store.setSel(d.shift ? [...new Set([...store.sel.ids, ...marquee(store, boxOf, rectOf(d.a, d.b), ev.mods.alt)])] : marquee(store, boxOf, rectOf(d.a, d.b), ev.mods.alt), 'marquee')
        else if (!d.shift) store.setSel([])
      } else if (d.kind === 'pivot') { /* the pivot stays where it was dropped */ } else if (d.moved) commit()
      else renderer.clearPreview()
      endGesture()
    },
    dblclick(ev) {
      const id = pickFromTarget(ev.target, store) ?? hitByDistance(store, boxOf, ev.p, 6 / store.view.z)
      const n = id != null && store.find(id)?.node
      if (n?.t === 'group') {
        store.ctx = n.id
        const inner = pickFromTarget(ev.target, store, { deep: true })
        store.setSel(inner != null && inner !== n.id ? [inner] : [])
        store.emit('status')
      } else if (n?.t === 'text') store.emit('edittext', n.id) // double-click on text edits it in place (E7)
    },
    cancel() { if (drag) { renderer.clearPreview(); drag = null; store.setStatus('') } view.requestOverlay() },
    deactivate() { host.style.cursor = info.cursor || 'default' },
    overlay(g, { toScreen, el }) {
      const d = drag
      if (d?.kind === 'marquee' && d.moved) {
        const a = toScreen(Math.min(d.a.x, d.b.x), Math.min(d.a.y, d.b.y)), b = toScreen(Math.max(d.a.x, d.b.x), Math.max(d.a.y, d.b.y))
        g.append(el('rect', { class: 'ds-marquee', x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }))
        return
      }
      const box = d?.box0 || curBox()
      if (!box) return
      if (d?.M && d.kind !== 'pivot') { // a gesture is running: the moving frame, snap lines and the pivot
        const pts = boxQuad(box, d.M).map(([x, y]) => toScreen(x, y))
        g.append(el('polygon', { class: 'ds-selbox', points: pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '), fill: 'none' }))
        const s = view.size()
        for (const x of d.lines?.x || []) { const p = toScreen(x, 0); g.append(el('line', { class: 'ds-snap', x1: p.x, y1: 0, x2: p.x, y2: s.h })) }
        for (const y of d.lines?.y || []) { const p = toScreen(0, y); g.append(el('line', { class: 'ds-snap', x1: 0, y1: p.y, x2: s.w, y2: p.y })) }
        return
      }
      const out = mode === 'rotate' ? OUT_ROT : OUT_SCALE
      const sb = toScreenBox(box, out)
      g.append(el('rect', { class: 'ds-selbox', x: sb.x, y: sb.y, width: Math.max(0, sb.w), height: Math.max(0, sb.h), fill: 'none' }))
      if (!editableIds(store).length) return
      for (const id of handleIds(sb)) {
        const p = handlePoint(sb, id)
        if (mode === 'scale') g.append(el('rect', { class: 'ds-h', 'data-h': id, x: p.x - 4, y: p.y - 4, width: 8, height: 8 }))
        else if (CORNERS.includes(id)) g.append(el('circle', { class: 'ds-hrot', 'data-h': id, cx: p.x, cy: p.y, r: 5 }))
        else g.append(el('polygon', { class: 'ds-hskew', 'data-h': id, points: id === 'n' || id === 's' ? `${p.x - 7},${p.y} ${p.x},${p.y - 4} ${p.x + 7},${p.y} ${p.x},${p.y + 4}` : `${p.x},${p.y - 7} ${p.x + 4},${p.y} ${p.x},${p.y + 7} ${p.x - 4},${p.y}` }))
      }
      if (mode === 'rotate') {
        const pv = curPivot(box), s = toScreen(pv.x, pv.y)
        g.append(el('circle', { class: 'ds-pivot', 'data-h': 'pivot', cx: s.x, cy: s.y, r: 5 }), el('path', { class: 'ds-pivot', d: `M${s.x - 9} ${s.y}H${s.x + 9}M${s.x} ${s.y - 9}V${s.y + 9}` }))
      }
    },
    /** For tests and the property bar: the current handle mode and pivot. */
    get state() { return { mode, pivot, handles: HANDLE_IDS } },
  }
  return tool
}
