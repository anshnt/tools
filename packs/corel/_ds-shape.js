// Draw Studio Shape tool (F10): node editing. The tool never touches the store while you drag: it works on a DRAFT {subs, nt} built from the
// selected curve, shows it with renderer.previewPath, and one pointer-up makes ONE store.tx. Rectangles, ellipses, polygons and stars turn into
// plain curves on the first edit (the same undo step). Node commands (add, delete, to line, to curve, cusp, smooth, symmetrical, break,
// join, close, reverse) are one store.tx each and are reached through commands (node.*), the property bar and the menus.
import { collectTargets, pickFromTarget, snapPoint } from './_ds-hit.js'
import { segIsLine } from '../studio-vector/_geom.js'
import { addNodes, breakAt, cloneDraft, closeSub, deleteNodes, joinEnds, makeDraft, moveHandle, moveNode, reverseSub, setNodeType, subsToD, toCurve, toLine, addNode } from './_ds-path.js'
import { deleteIds, replaceLeaves } from './_ds-ops.js'
import { editableIds } from './_ds-sel.js'
import { nearestOnSub } from '../studio-vector/_geom.js'
import { toast } from '../../lib/ui.js'
import { fmt, fromUnit } from './_ds-units.js'

const DRAG = 4
const k = (s, i) => `${s}|${i}`
const unk = (key) => key.split('|').map(Number)

/** The node with the draft applied: a plain curve (shape and sm dropped) whose node types are remembered. */
export function withDraft(node, dr) {
  const { shape: _s, sm: _m, ...rest } = node
  return { ...rest, d: subsToD(dr.subs), nt: dr.nt.map((r) => r.slice()) }
}

/** env: {store, view, boxOf, renderer, host, info} */
export function createShapeTool({ store, view, boxOf, renderer, host, info }) {
  let target = null, loaded = null // node id and the node object the draft was built from
  let dr = null
  let picked = new Set()
  let drag = null
  let warnedFor = null
  const viewportRect = () => { const s = view.size(), a = view.toPage(0, 0), b = view.toPage(s.w, s.h); return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } }
  const radius = (ev) => (ev.pointerType === 'touch' ? 16 : 8)
  const notify = () => store.emit('shapepick', { target, count: picked.size })
  const pickList = () => [...picked].map(unk)
  const node = () => (target != null ? store.find(target)?.node : null)
  const shapeLike = (n) => !!(n?.shape || n?.sm)

  // ---------- which curve is being edited ----------
  function pickTarget() {
    const ids = editableIds(store)
    let id = null
    for (let i = ids.length - 1; i >= 0 && id == null; i--) if (store.find(ids[i])?.node?.t === 'path') id = ids[i]
    return id
  }
  function reload() {
    if (store.tool !== 'shape' || (drag && drag.kind !== 'pending')) return
    const id = pickTarget()
    const n = id != null ? store.find(id).node : null
    if (!n) {
      if (target != null || dr) { target = null; loaded = null; dr = null; picked = new Set(); notify() }
      const sel = store.sel.ids
      if (sel.length && store.tool === 'shape') {
        const f = store.find(sel[sel.length - 1])?.node
        store.setStatus(f?.t === 'text' ? 'Convert the text to curves (Ctrl+Q) to edit its nodes.' : f?.t === 'image' ? 'Pictures have no nodes.' : f?.t === 'group' ? 'Ctrl+click a shape inside the group to edit its nodes.' : 'Select a curve to edit its nodes.')
      }
      return
    }
    if (n === loaded && id === target) return
    const fresh = makeDraft(n)
    const same = dr && id === target && fresh.subs.length === dr.subs.length && fresh.subs.every((s, i) => s.pts.length === dr.subs[i].pts.length)
    target = id; loaded = n; dr = fresh
    if (!same) picked = new Set()
    notify()
    view.requestOverlay()
  }
  store.on('sel', reload)
  store.on('doc', reload)

  // ---------- geometry of what is drawn ----------
  /** Handles that are shown: those of picked nodes and the facing handles of their neighbours. [{s, i, which, x, y}] */
  function handleList() {
    if (!dr) return []
    const out = [], seen = new Set()
    const add = (s, i, which) => {
      const sub = dr.subs[s], p = sub?.pts[i]
      if (!p) return
      const kk = `${s}|${i}|${which}`
      if (seen.has(kk)) return
      const dx = which === 'in' ? p.ix : p.ox, dy = which === 'in' ? p.iy : p.oy
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
      seen.add(kk)
      out.push({ s, i, which, x: p.x + dx, y: p.y + dy })
    }
    for (const [s, i] of pickList()) {
      const sub = dr.subs[s]
      if (!sub) continue
      const n = sub.pts.length
      add(s, i, 'in'); add(s, i, 'out')
      if (sub.closed || i > 0) add(s, (i - 1 + n) % n, 'out')
      if (sub.closed || i < n - 1) add(s, (i + 1) % n, 'in')
    }
    return out
  }
  function nodeAt(ev) {
    if (!dr) return null
    const r = radius(ev)
    let best = null, bd = Infinity
    dr.subs.forEach((sub, s) => sub.pts.forEach((p, i) => {
      const sp = view.toScreen(p.x, p.y), d = Math.hypot(sp.x - ev.s.x, sp.y - ev.s.y)
      if (d <= r && d < bd) { best = [s, i]; bd = d }
    }))
    return best
  }
  function handleAt(ev) {
    const r = radius(ev)
    let best = null, bd = Infinity
    for (const h of handleList()) {
      const sp = view.toScreen(h.x, h.y), d = Math.hypot(sp.x - ev.s.x, sp.y - ev.s.y)
      if (d <= r && d < bd) { best = h; bd = d }
    }
    return best
  }
  function segmentAt(ev) {
    if (!dr) return null
    let best = null
    dr.subs.forEach((sub, s) => {
      const h = nearestOnSub(sub, ev.p)
      if (h && h.dist * store.view.z <= radius(ev) && (!best || h.dist < best.dist)) best = { s, seg: h.seg, t: h.t, dist: h.dist }
    })
    return best
  }

  // ---------- committing ----------
  function commit(label, next, o = {}) {
    const n = node()
    if (!n) return false
    const edited = withDraft(n, next)
    const wasShape = shapeLike(n)
    const ok = store.tx(label, (r) => replaceLeaves(r, new Map([[n.id, edited]])), { sel: [n.id], ...o })
    if (ok && wasShape && warnedFor !== n.id) { warnedFor = n.id; toast('This shape was turned into a plain curve so its nodes can be edited. Undo brings the shape back.') }
    return ok
  }
  function cancelDrag() {
    if (!drag) return
    const n = node()
    drag = null
    if (n) { dr = makeDraft(n); renderer.previewPath(n.id, n.d) }
    view.requestOverlay()
  }

  /** Run one node command on the picked points. Returns true when something changed. */
  function op(name) {
    const n = node()
    if (!n || !dr) { store.setStatus('Select a curve first, then pick its nodes.'); return false }
    const work = cloneDraft(dr)
    const picks = pickList()
    const need = (cnt, text) => { if (picks.length < cnt) { store.setStatus(text); return false } return true }
    let label = '', next = null
    if (name === 'add') {
      if (!need(1, 'Pick a node first. A new node is added after it, or between two picked neighbours.')) return false
      const np = addNodes(work, picks)
      if (!np.length) { store.setStatus('There is no segment to add a node to.'); return false }
      label = 'Add node'; next = np
    } else if (name === 'delete') {
      if (!need(1, 'Pick the nodes to delete.')) return false
      deleteNodes(work, picks)
      if (!work.subs.length) { store.tx('Delete', (r) => deleteIds(r, [n.id]), { sel: [] }); return true }
      label = 'Delete nodes'; next = []
    } else if (name === 'toLine') { if (!need(1, 'Pick a node, or two neighbours, to make a segment straight.')) return false; if (!toLine(work, picks)) { store.setStatus('That segment is already straight.'); return false } label = 'To line'; next = picks }
    else if (name === 'toCurve') { if (!need(1, 'Pick a node, or two neighbours, to make a segment a curve.')) return false; if (!toCurve(work, picks)) { store.setStatus('That segment is already a curve.'); return false } label = 'To curve'; next = picks }
    else if (name === 'cusp' || name === 'smooth' || name === 'symmetrical') {
      if (!need(1, 'Pick the nodes to change.')) return false
      setNodeType(work, picks, name === 'cusp' ? 'c' : name === 'smooth' ? 's' : 'y')
      label = name === 'cusp' ? 'Cusp node' : name === 'smooth' ? 'Smooth node' : 'Symmetrical node'; next = picks
    } else if (name === 'break') {
      if (!need(1, 'Pick the node to break at.')) return false
      const np = breakAt(work, picks)
      if (!np.length) { store.setStatus('The end of a curve cannot be broken. Pick a node in the middle.'); return false }
      label = 'Break curve'; next = np
    } else if (name === 'join') {
      const np = joinEnds(work, picks)
      if (!np) { store.setStatus('Pick two end nodes of open curves to join them.'); return false }
      label = 'Join nodes'; next = [np]
    } else if (name === 'close') {
      if (!closeSub(work, picks)) { store.setStatus('There is no open curve to close. Pick a node of an open curve.'); return false }
      label = 'Close curve'; next = picks
    } else if (name === 'reverse') {
      next = reverseSub(work, picks.length ? picks : work.subs.map((_, s) => [s, 0]))
      label = 'Reverse direction'
    } else return false
    if (!commit(label, work)) return false
    dr = work
    picked = new Set(next.filter(([s, i]) => work.subs[s]?.pts[i]).map(([s, i]) => k(s, i)))
    loaded = node()
    notify()
    view.requestOverlay()
    return true
  }
  /** Whether a node command makes sense now (for menus and the property bar). */
  function can(name) {
    if (!dr) return false
    const c = picked.size
    if (name === 'join') return c === 2
    if (name === 'close' || name === 'reverse') return true
    return c > 0
  }

  function nudgeNodes(dx, dy) {
    if (!dr || !picked.size) return false
    const work = cloneDraft(dr)
    for (const [s, i] of pickList()) moveNode(work, s, i, dx, dy)
    if (commit('Move nodes', work, { merge: 'nodenudge' })) { dr = work; loaded = node(); view.requestOverlay() }
    return true
  }

  // ---------- the tool ----------
  const targetsFor = () => {
    const T = collectTargets(store, boxOf, new Set(target != null ? [target] : []), viewportRect())
    if (dr) dr.subs.forEach((sub, s) => sub.pts.forEach((p, i) => { if (!picked.has(k(s, i))) { T.xs.push(p.x); T.ys.push(p.y) } }))
    return T
  }
  const snapOn = () => store.prefs.snap !== false

  const tool = {
    ...info,
    get busy() { return !!drag && drag.kind !== 'pending' },
    get state() { return { target, picked: pickList(), nodes: dr ? dr.subs.reduce((a, s) => a + s.pts.length, 0) : 0 } },
    op, can,
    activate() { reload(); if (!dr && !store.sel.ids.length) store.setStatus('Click a curve or shape to edit its nodes.') },
    deactivate() { cancelDrag(); host.style.cursor = info.cursor || 'default' },
    pointerdown(ev) {
      if (ev.button !== 0) return
      drag = null
      if (dr) {
        const h = handleAt(ev)
        if (h) { drag = { kind: 'handle', h, orig: cloneDraft(dr), a: ev.p, sa: ev.s, moved: false, T: targetsFor() }; return }
        const nd = nodeAt(ev)
        if (!nd) {
          const seg = segmentAt(ev)
          if (seg) { drag = { kind: 'segment', seg, orig: cloneDraft(dr), a: ev.p, sa: ev.s, moved: false, T: targetsFor() }; return }
        }
        if (nd) {
          const key = k(nd[0], nd[1])
          if (ev.mods.shift) { if (picked.has(key)) picked.delete(key); else picked.add(key); notify(); view.requestOverlay(); drag = { kind: 'pending', moved: false }; return }
          const was = picked.has(key)
          if (!was) { picked = new Set([key]); notify() }
          drag = { kind: 'node', nd, was, orig: cloneDraft(dr), a: ev.p, sa: ev.s, moved: false, T: targetsFor() }
          view.requestOverlay()
          return
        }
      }
      // another object under the pointer becomes the one being edited; empty space starts a marquee over the nodes
      const id = pickFromTarget(ev.target, store, { deep: true })
      if (id != null && id !== target) { store.setSel([id]); drag = { kind: 'pending', moved: false }; return }
      if (id != null && id === target && !ev.mods.shift) { drag = { kind: 'pending', moved: false }; return }
      drag = { kind: 'marquee', a: ev.p, b: ev.p, sa: ev.s, shift: ev.mods.shift, moved: false }
    },
    pointermove(ev) {
      const d = drag
      if (!d) {
        if (ev.pointerType === 'touch') return
        host.style.cursor = dr && (handleAt(ev) || nodeAt(ev)) ? 'crosshair' : info.cursor || 'default'
        return
      }
      const far = d.sa && Math.hypot(ev.s.x - d.sa.x, ev.s.y - d.sa.y) > DRAG
      if (d.kind === 'marquee') { d.b = ev.p; if (!d.moved && far) d.moved = true; if (d.moved) view.requestOverlay(); return }
      if (d.kind === 'pending') return
      if (!d.moved && !far) return
      d.moved = true
      const nodeId = target
      const work = cloneDraft(d.orig)
      const thr = 6 / store.view.z, off = ev.mods.alt || !snapOn()
      if (d.kind === 'segment') {
        // moving the point under the pointer: both handles of the segment move by the same share, so the curve follows (a straight segment becomes a curve first)
        const { s, seg, t } = d.seg
        const n = work.subs[s].pts.length, a = work.subs[s].pts[seg], b = work.subs[s].pts[(seg + 1) % n]
        if (segIsLine(a, b)) { a.ox = (b.x - a.x) / 3; a.oy = (b.y - a.y) / 3; b.ix = (a.x - b.x) / 3; b.iy = (a.y - b.y) / 3 }
        const tt = Math.min(0.9, Math.max(0.1, t)), w = 1 / (3 * tt * (1 - tt))
        const dx = (ev.p.x - d.a.x) * w, dy = (ev.p.y - d.a.y) * w
        moveHandle(work, s, seg, 'out', a.x + a.ox + dx, a.y + a.oy + dy)
        moveHandle(work, s, (seg + 1) % n, 'in', b.x + b.ix + dx, b.y + b.iy + dy)
        d.lines = null
      } else if (d.kind === 'node') {
        const [s0, i0] = d.nd
        const p0 = d.orig.subs[s0].pts[i0]
        let want = { x: p0.x + ev.p.x - d.a.x, y: p0.y + ev.p.y - d.a.y }
        if (ev.mods.ctrl) { if (Math.abs(want.x - p0.x) >= Math.abs(want.y - p0.y)) want.y = p0.y; else want.x = p0.x }
        const sp = snapPoint(want, d.T, thr, off)
        const dx = (ev.mods.ctrl ? want.x : sp.x) - p0.x, dy = (ev.mods.ctrl ? want.y : sp.y) - p0.y
        for (const [s, i] of pickList()) moveNode(work, s, i, dx, dy)
        d.lines = sp.lines
        const u = store.root.units
        store.setStatus(`Move node  X ${fmt(dx, u)}  Y ${fmt(-dy, u)} ${u}`)
      } else {
        const sp = snapPoint(ev.p, d.T, thr, off)
        moveHandle(work, d.h.s, d.h.i, d.h.which, sp.x, sp.y)
        d.lines = sp.lines
      }
      dr = work
      renderer.previewPath(nodeId, subsToD(work.subs))
      view.requestOverlay()
    },
    pointerup(ev) {
      const d = drag
      drag = null
      store.setStatus('')
      if (!d) return
      if (d.kind === 'marquee') {
        if (d.moved && dr) {
          const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y)
          const hit = new Set(d.shift ? picked : [])
          dr.subs.forEach((sub, s) => sub.pts.forEach((p, i) => { if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) hit.add(k(s, i)) }))
          picked = hit
        } else if (!d.shift) { picked = new Set(); if (!dr) store.setSel([]) }
        notify(); view.requestOverlay()
        return
      }
      if (d.kind === 'segment' && !d.moved) { const n = dr.subs[d.seg.s].pts.length; picked = new Set([k(d.seg.s, d.seg.seg), k(d.seg.s, (d.seg.seg + 1) % n)]); notify(); view.requestOverlay(); return }
      if (d.kind === 'node' && !d.moved) { if (d.was && !ev.mods.shift) { picked = new Set([k(d.nd[0], d.nd[1])]); notify() } view.requestOverlay(); return }
      if ((d.kind === 'node' || d.kind === 'handle' || d.kind === 'segment') && d.moved) {
        const work = dr
        const before = node()
        if (before && !commit(d.kind === 'node' ? 'Move nodes' : d.kind === 'segment' ? 'Reshape segment' : 'Move handle', work)) { dr = d.orig; renderer.previewPath(before.id, before.d) }
        loaded = node()
      }
      view.requestOverlay()
    },
    dblclick(ev) {
      if (!dr) return
      const nd = nodeAt(ev)
      if (nd) {
        const work = cloneDraft(dr)
        const cusp = work.nt[nd[0]][nd[1]] === 'c'
        setNodeType(work, [nd], cusp ? 's' : 'c')
        if (commit(cusp ? 'Smooth node' : 'Cusp node', work)) { dr = work; picked = new Set([k(nd[0], nd[1])]); loaded = node(); notify() }
        return
      }
      const seg = segmentAt(ev)
      if (seg) {
        const work = cloneDraft(dr)
        const at = addNode(work, seg.s, seg.seg, seg.t)
        if (commit('Add node', work)) { dr = work; picked = new Set([k(seg.s, at)]); loaded = node(); notify() }
      }
    },
    key(key) {
      if (drag && key === 'Esc') { cancelDrag(); return true }
      if (!dr) return false
      if ((key === 'Delete' || key === 'Backspace') && picked.size) { op('delete'); return true }
      if (key === 'Esc' && picked.size) { picked = new Set(); notify(); view.requestOverlay(); return true }
      if (key === 'Ctrl+A') { picked = new Set(dr.subs.flatMap((sub, s) => sub.pts.map((_, i) => k(s, i)))); notify(); view.requestOverlay(); return true }
      const m = /^(Ctrl\+|Shift\+)?(Left|Right|Up|Down)$/.exec(key)
      if (m && picked.size) {
        const step = fromUnit(m[1] === 'Shift+' ? 10 : m[1] === 'Ctrl+' ? 0.1 : 1, 'mm')
        return nudgeNodes(m[2] === 'Left' ? -step : m[2] === 'Right' ? step : 0, m[2] === 'Up' ? -step : m[2] === 'Down' ? step : 0)
      }
      return false
    },
    cancel() { cancelDrag() },
    overlay(g, { toScreen, el }) {
      if (drag?.kind === 'marquee' && drag.moved) {
        const a = toScreen(Math.min(drag.a.x, drag.b.x), Math.min(drag.a.y, drag.b.y)), b = toScreen(Math.max(drag.a.x, drag.b.x), Math.max(drag.a.y, drag.b.y))
        g.append(el('rect', { class: 'ds-marquee', x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }))
      }
      if (!dr) return
      const s = view.size()
      let shown = 0
      dr.subs.forEach((sub, si) => sub.pts.forEach((p, i) => {
        const sp = toScreen(p.x, p.y)
        if (sp.x < -10 || sp.y < -10 || sp.x > s.w + 10 || sp.y > s.h + 10) return
        const on = picked.has(k(si, i))
        if (!on && shown > 4000) return
        shown++
        const t = dr.nt[si]?.[i] || 'c'
        const cls = `ds-node${t === 's' ? ' ds-ns' : t === 'y' ? ' ds-ny' : ''}${on ? ' ds-picked' : ''}`
        g.append(t === 'c' ? el('rect', { class: cls, 'data-n': `${si}|${i}`, x: sp.x - 4, y: sp.y - 4, width: 8, height: 8 }) : t === 's' ? el('circle', { class: cls, 'data-n': `${si}|${i}`, cx: sp.x, cy: sp.y, r: 4.5 }) : el('polygon', { class: cls, 'data-n': `${si}|${i}`, points: `${sp.x},${sp.y - 5.5} ${sp.x + 5.5},${sp.y} ${sp.x},${sp.y + 5.5} ${sp.x - 5.5},${sp.y}` }))
      }))
      for (const h of handleList()) {
        const sp = toScreen(h.x, h.y), a = toScreen(dr.subs[h.s].pts[h.i].x, dr.subs[h.s].pts[h.i].y)
        g.append(el('path', { class: 'ds-hline', d: `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${sp.x.toFixed(1)} ${sp.y.toFixed(1)}` }), el('circle', { class: 'ds-hdl', 'data-hd': `${h.s}|${h.i}|${h.which}`, cx: sp.x, cy: sp.y, r: 3.5 }))
      }
      if (drag?.lines) {
        for (const x of drag.lines.x) { const p = toScreen(x, 0); g.append(el('line', { class: 'ds-snap', x1: p.x, y1: 0, x2: p.x, y2: s.h })) }
        for (const y of drag.lines.y) { const p = toScreen(0, y); g.append(el('line', { class: 'ds-snap', x1: 0, y1: p.y, x2: s.w, y2: p.y })) }
      }
    },
  }
  return tool
}
