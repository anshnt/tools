// Draw Studio Interactive fill, Transparency and Eyedropper tools.
// Interactive fill edits ONE gradient (the last selected editable shape): drag the start and end handles (centre and edge for a radial fill), click the
// line to add a colour stop, drag a stop along the line, Delete removes the selected stop. A drag previews through renderer.previewFill and commits ONE
// store.tx on release. Transparency only selects (its slider is in the property bar). The Eyedropper copies a shape's fill and outline (vector
// attributes, not pixels) onto the selection, or onto the next object you click.
import { apply } from './_model.js'
import { addStop, attrsOf, gradientHandles, moveEnd, moveStart, offsetAt, distToLine, removeStop, reverseStops, setGradient, setStop } from './_ds-fill.js'
import { editableIds, selectionBox } from './_ds-sel.js'
import { leavesOf, setStyle } from './_ds-ops.js'
import { safeHex } from './_ds-ui-palette.js'

const EPS = 1e-6
const interior = (s) => s.o > EPS && s.o < 1 - EPS

/** env: {store, view, boxOf, renderer, host, pick (the Pick tool: objectAt, selectAt), info(id) -> toolbox entry} -> {fill, transp, eyedrop} */
export function createFillTools({ store, view, boxOf, renderer, host, pick, info }) {
  const say = (t) => store.setStatus(t)
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const sc = (p) => view.toScreen(p.x, p.y)

  function selBoxOverlay(g, { toScreen, el }) {
    const b = store.sel.ids.length && selectionBox(store, boxOf)
    if (!b) return
    const a = toScreen(b.x, b.y), c = toScreen(b.x + b.w, b.y + b.h)
    g.append(el('rect', { class: 'ds-selbox', x: a.x - 3, y: a.y - 3, width: Math.max(0, c.x - a.x) + 6, height: Math.max(0, c.y - a.y) + 6, fill: 'none' }))
  }

  // ---------- Interactive fill ----------
  let stop = null // selected stop index
  let drag = null // {kind: 'start'|'end'|'stop'|'add', id, base, g, index, sa, moved}
  const target = () => leavesOf(editableIds(store).map((id) => store.find(id)?.node).filter(Boolean)).filter((n) => n.t === 'path').pop() || null
  const gradientOf = (n) => (n?.fill && typeof n.fill === 'object' ? n.fill : null)
  const notify = () => store.emit('fillsel')
  const setStop_ = (i) => { if (stop !== i) { stop = i; notify() } }
  let selKey = ''
  store.on('sel', () => { const k = store.sel.ids.join(','); if (k !== selKey) { selKey = k; if (stop != null) { stop = null; notify() } } }) // undo and redo keep the stop

  /** What is under a screen point: {kind: 'stop', index} | {kind: 'start'} | {kind: 'end'} | {kind: 'line', o} | null. */
  function hitTest(ev) {
    const n = target(), g = gradientOf(n)
    if (!g) return null
    const H = gradientHandles(g), r = ev.pointerType === 'touch' ? 16 : 8
    let best = null
    H.stops.forEach((s, i) => { if (interior(g.stops[i])) { const d = dist(sc(s), ev.s); if (d <= r && (!best || d < best.d)) best = { kind: 'stop', index: i, d } } })
    if (best) return best
    if (dist(sc(H.b), ev.s) <= r) return { kind: 'end' }
    if (dist(sc(H.a), ev.s) <= r) return { kind: 'start' }
    const A = sc(H.a), B = sc(H.b)
    const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy
    if (len2 > 1) { const t = Math.max(0, Math.min(1, ((ev.s.x - A.x) * dx + (ev.s.y - A.y) * dy) / len2)); if (Math.hypot(ev.s.x - (A.x + dx * t), ev.s.y - (A.y + dy * t)) <= 6) return { kind: 'line' } }
    return null
  }
  const endIndex = (g, last) => (last ? g.stops.length - 1 : 0)

  function commit(label, g, merge) {
    const n = target()
    if (!n || !g) return false
    return store.tx(label, (r) => setGradient(r, n.id, g), merge ? { merge } : {})
  }

  const fill = {
    ...info('fill'),
    get busy() { return !!drag },
    /** For the property bar and tests. */
    get state() { const n = target(), g = gradientOf(n); return { id: n?.id ?? null, g, stop: g && stop != null && g.stops[stop] ? stop : null, count: g?.stops.length || 0 } },
    activate() { say('Interactive fill: choose Linear or Radial in the property bar, then drag the handles. Click the line to add a colour.') },
    pointerdown(ev) {
      if (ev.button !== 0) return
      const n = target(), g = gradientOf(n)
      const h = g && hitTest(ev)
      if (!h) { setStop_(null); pick.selectAt(ev); return }
      drag = { kind: h.kind, id: n.id, base: g, g, index: null, sa: ev.s, moved: false }
      if (h.kind === 'stop') { drag.index = h.index; setStop_(h.index) }
      else if (h.kind === 'start') setStop_(endIndex(g, false))
      else if (h.kind === 'end') setStop_(endIndex(g, true))
      else {
        const r = addStop(g, offsetAt(g, ev.p))
        drag = { ...drag, kind: 'add', base: r.g, g: r.g, index: r.index, moved: true }
        setStop_(r.index)
        renderer.previewFill(n.id, r.g)
      }
      view.requestOverlay()
    },
    pointermove(ev) {
      if (!drag) {
        if (ev.pointerType !== 'touch') { const h = target() && hitTest(ev); host.style.cursor = h ? (h.kind === 'line' ? 'copy' : 'pointer') : info('fill').cursor }
        return
      }
      if (!drag.moved && Math.hypot(ev.s.x - drag.sa.x, ev.s.y - drag.sa.y) > 4) drag.moved = true
      if (!drag.moved) return
      let g = drag.base
      if (drag.kind === 'start') g = moveStart(g, ev.p)
      else if (drag.kind === 'end') g = moveEnd(g, ev.p)
      else { const r = setStop(drag.base, drag.index, { o: offsetAt(drag.base, ev.p) }); g = r.g; drag.index = r.index; stop = r.index }
      drag.g = g
      renderer.previewFill(drag.id, g)
      view.requestOverlay()
    },
    pointerup() {
      const d = drag
      drag = null
      if (!d) return
      renderer.previewFill(d.id, null)
      if (d.moved || d.kind === 'add') commit({ start: 'Move gradient start', end: 'Move gradient end', stop: 'Move colour stop', add: 'Add colour stop' }[d.kind], d.g)
      notify()
      view.requestOverlay()
    },
    cancel() { if (drag) { renderer.previewFill(drag.id, null); drag = null } view.requestOverlay() },
    deactivate() { if (drag) renderer.previewFill(drag.id, null); drag = null; stop = null },
    key(k) {
      if (k !== 'Delete' && k !== 'Backspace') return false
      const g = gradientOf(target())
      if (!g || stop == null || !g.stops[stop]) return false
      fill.removeStop()
      return true
    },
    // ---- the property bar and the palette call these ----
    removeStop() {
      const g = gradientOf(target())
      if (!g || stop == null) return false
      if (g.stops.length <= 2) { say('A gradient needs at least two colours.'); return false }
      const ok = commit('Remove colour stop', removeStop(g, stop))
      stop = null; notify()
      return ok
    },
    addStopMiddle() {
      const g = gradientOf(target())
      if (!g) return false
      // the widest gap between neighbours gets the new colour
      let at = 0.5, gap = -1
      const s = g.stops
      for (let i = 1; i < s.length; i++) if (s[i].o - s[i - 1].o > gap) { gap = s[i].o - s[i - 1].o; at = (s[i].o + s[i - 1].o) / 2 }
      const r = addStop(g, at)
      const ok = commit('Add colour stop', r.g)
      stop = r.index; notify()
      return ok
    },
    setStopColor(hex) {
      const g = gradientOf(target())
      if (!g || stop == null || !safeHex(hex)) return false
      return commit('Colour stop colour', setStop(g, stop, { c: hex }).g, 'stopcolor')
    },
    setStopOffset(o) {
      const g = gradientOf(target())
      if (!g || stop == null || !Number.isFinite(o)) return false
      const r = setStop(g, stop, { o })
      stop = r.index
      const ok = commit('Move colour stop', r.g, 'stopoffset')
      notify()
      return ok
    },
    reverse() { const g = gradientOf(target()); if (!g) return false; stop = stop == null ? null : g.stops.length - 1 - stop; return commit('Reverse gradient', reverseStops(g)) },
    /** Palette click while a stop is selected recolours that stop instead of replacing the fill. */
    paintStop(hex) { return stop != null && !!gradientOf(target()) && fill.setStopColor(hex) },
    overlay(g, h) {
      selBoxOverlay(g, h)
      const n = target(), gr = drag ? drag.g : gradientOf(n)
      if (!gr || !n) return
      const { el } = h
      const H = gradientHandles(gr), A = sc(H.a), B = sc(H.b)
      if (gr.g === 'radial') {
        const pts = []
        for (let i = 0; i < 48; i++) {
          const t = (i / 48) * Math.PI * 2, [x, y] = apply(gr.m, gr.cx + gr.r * Math.cos(t), gr.cy + gr.r * Math.sin(t)), p = sc({ x, y })
          pts.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        }
        g.append(el('polygon', { class: 'ds-hline ds-fillring', points: pts.join(' ') }))
      }
      g.append(el('line', { class: 'ds-hline ds-fillline', x1: A.x, y1: A.y, x2: B.x, y2: B.y }))
      g.append(el('rect', { class: 'ds-h ds-fillh', 'data-h': 'fill-start', x: A.x - 5, y: A.y - 5, width: 10, height: 10 }))
      g.append(el('circle', { class: 'ds-hdl ds-fillh', 'data-h': 'fill-end', cx: B.x, cy: B.y, r: 6 }))
      H.stops.forEach((s, i) => {
        const st = gr.stops[i]
        if (!interior(st) && i !== stop) return
        const p = sc(s)
        const c = el('circle', { class: `ds-stopm${i === stop ? ' ds-picked' : ''}`, 'data-stop': i, cx: p.x, cy: p.y, r: 6 })
        const hex = safeHex(st.c)
        if (hex) c.setAttribute('fill', hex)
        g.append(c)
      })
    },
  }

  // ---------- Transparency ----------
  const transp = {
    ...info('transp'),
    pointerdown(ev) { if (ev.button === 0) pick.selectAt(ev) },
    activate() { say('Transparency: select an object, then use the slider in the property bar.') },
    overlay: selBoxOverlay,
  }

  // ---------- Eyedropper ----------
  let held = null
  const firstLook = (id) => { const n = store.find(id)?.node; return n ? leavesOf([n]).find((l) => l.t === 'path' || l.t === 'text') : null }
  const eyedrop = {
    ...info('eyedrop'),
    get held() { return held },
    activate() { held = null; say(store.sel.ids.length ? 'Eyedropper: click an object to copy its fill and outline onto the selection.' : 'Eyedropper: click an object to copy its fill and outline, then click another to apply them.'); store.emit('fillsel') },
    deactivate() { held = null },
    cancel() { held = null; store.emit('fillsel') },
    pointerdown(ev) {
      if (ev.button !== 0) return
      const id = pick.objectAt(ev)
      if (id == null) { say('Click an object to copy its fill and outline.'); return }
      const src = firstLook(id)
      const a = src && attrsOf(src)
      if (!a) { say('Pictures and empty groups have no fill or outline to copy.'); return }
      const sel = store.sel.ids
      if (sel.length && !sel.includes(id)) {
        const ids = editableIds(store)
        if (!ids.length) { say('Locked objects cannot be changed. Unlock them in the Objects docker.'); return }
        store.tx('Copy attributes', (r) => setStyle(r, ids, a))
        say('Copied the fill and outline onto the selection. This is the look of the shape, not a pixel colour.')
      } else if (held && !sel.length) {
        store.tx('Copy attributes', (r) => setStyle(r, [id], held), { sel: [id] })
        held = null
        say('Applied.')
      } else {
        held = a
        say('Copied the fill and outline. Click another object to apply them.')
      }
      store.emit('fillsel')
    },
    overlay: selBoxOverlay,
  }
  return { fill, transp, eyedrop }
}
