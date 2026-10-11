// Draw Studio view: zoom and pan (store.view = {x, y, z}, screen = page * z + (x, y)), wheel, pinch, space and middle-button pan, the pointer
// router that forwards everything else to the active tool, and the screen-space overlay layer tools draw handles and previews into.
// Zoom range 0.02 to 64. Rulers, guides and snapping lines arrive with milestone E11 (they hook into the overlay and the 'view' event).
import { unionBox } from './_model.js'

const NS = 'http://www.w3.org/2000/svg'
const Z_MIN = 0.02, Z_MAX = 64
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
/** Overlay element helper: number-only attributes, fixed class names (never file data). */
export function ovEl(tag, attrs) {
  const el = document.createElementNS(NS, tag)
  for (const k in attrs) el.setAttribute(k, attrs[k])
  return el
}

export const zoomPercent = (z) => Math.round((z * 72) / 96 * 100)

export function createView({ store, host, ov, renderer, boxOf }) {
  const ovG = document.createElementNS(NS, 'g')
  ov.append(ovG)
  let tool = null, spaceDown = false, panning = null, pinch = null, fitNext = true
  const pointers = new Map()
  const overlays = new Set()
  const pageViews = new Map() // page id -> last view (so switching pages keeps each page's zoom)
  let rafId = 0, tmo = 0

  const size = () => { const r = host.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top } }
  const local = (e) => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const toPage = (sx, sy) => { const v = store.view; return { x: (sx - v.x) / v.z, y: (sy - v.y) / v.z } }
  const toScreen = (x, y) => { const v = store.view; return { x: x * v.z + v.x, y: y * v.z + v.y } }
  const fromClient = (e) => { const s = local(e); return { s, p: toPage(s.x, s.y) } }

  function commit(v) {
    const view = { x: v.x, y: v.y, z: clamp(v.z, Z_MIN, Z_MAX) }
    if (![view.x, view.y, view.z].every(Number.isFinite)) return
    renderer.applyView(view)
    store.setView(view)
    const pid = store.page()?.id
    if (pid != null) pageViews.set(pid, { ...view })
    requestOverlay()
  }
  const setView = (v) => commit({ ...store.view, ...v })
  function zoomAt(f, sx, sy) {
    const v = store.view
    const z = clamp(v.z * f, Z_MIN, Z_MAX)
    const k = z / v.z
    commit({ z, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k })
  }
  function setZoom(z) { const s = size(); zoomAt(z / store.view.z, s.w / 2, s.h / 2) }
  const panBy = (dx, dy) => commit({ ...store.view, x: store.view.x + dx, y: store.view.y + dy })
  /** Fit a page-space box into the view with a margin (px). */
  function fitBox(b, margin = 24) {
    const s = size()
    if (!b || s.w < 20 || s.h < 20) return false
    const m = s.w < 500 ? 10 : margin
    const z = clamp(Math.min((s.w - 2 * m) / Math.max(b.w, 1e-6), (s.h - 2 * m) / Math.max(b.h, 1e-6)), Z_MIN, Z_MAX)
    commit({ z, x: (s.w - b.w * z) / 2 - b.x * z, y: (s.h - b.h * z) / 2 - b.y * z })
    return true
  }
  const pageBox = () => { const p = store.page(); return p ? { x: 0, y: 0, w: p.w, h: p.h } : null }
  function zoomPage() { fitNext = !fitBox(pageBox()) }
  function contentBox(ids) {
    let b = null
    const p = store.page()
    const take = (n) => { if (!n.hidden) b = unionBox(b, boxOf(n)) }
    if (ids) for (const id of ids) { const n = store.find(id)?.node; if (n) take(n) }
    else for (const l of p?.layers || []) if (!l.hidden) for (const n of l.items) take(n)
    return b
  }
  const zoomAll = () => { if (!fitBox(contentBox() || pageBox())) fitNext = true }
  const zoomSel = () => { const b = store.sel.ids.length && contentBox(store.sel.ids); if (b) fitBox(b); else zoomAll() }
  // the zoom label is percent of real size at 96 dpi: 100 percent = 4/3 screen pixels per point
  const PX_PER_PT = 96 / 72
  const zoom100 = () => setZoom(PX_PER_PT)
  const setLabelledZoom = (pct) => setZoom((pct / 100) * PX_PER_PT)

  // ---------- overlay ----------
  function drawOverlay() {
    rafId = 0; clearTimeout(tmo)
    ovG.replaceChildren()
    for (const fn of overlays) { try { fn(ovG, { toScreen, view: store.view, el: ovEl }) } catch (e) { console.error(e) } }
  }
  /** Redraws are coalesced with requestAnimationFrame plus a timeout fallback (rAF does not run in background tabs). */
  function requestOverlay() {
    if (rafId) return
    rafId = requestAnimationFrame(drawOverlay)
    clearTimeout(tmo)
    tmo = setTimeout(() => { if (rafId) { cancelAnimationFrame(rafId); drawOverlay() } }, 80)
  }
  const addOverlay = (fn) => { overlays.add(fn); requestOverlay(); return () => { overlays.delete(fn); requestOverlay() } }

  // ---------- pointer router ----------
  const mkEv = (e) => {
    const { s, p } = fromClient(e)
    return { p, s, mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, meta: e.metaKey }, button: e.button, buttons: e.buttons, pointerType: e.pointerType, pressure: e.pressure, target: e.target, detail: e.detail, raw: e }
  }
  const startPan = (e) => { const s = local(e); panning = { sx: s.x, sy: s.y, vx: store.view.x, vy: store.view.y, id: e.pointerId }; host.classList.add('ds-panning') }
  function pinchState() {
    const [a, b] = [...pointers.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
  }
  function onDown(e) {
    if (e.target.closest?.('.ds-textedit')) return
    host.focus({ preventScroll: true })
    const s = local(e)
    pointers.set(e.pointerId, s)
    try { host.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    if (pointers.size === 2) { tool?.cancel?.(); panning = null; const st = pinchState(); pinch = { ...st, z: store.view.z, vx: store.view.x, vy: store.view.y }; return }
    if (pointers.size > 2) return
    const wantPan = e.button === 1 || (e.button === 0 && (spaceDown || store.tool === 'pan'))
    if (wantPan) { e.preventDefault(); startPan(e); return }
    tool?.pointerdown?.(mkEv(e))
  }
  function onMove(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, local(e))
    if (pinch && pointers.size >= 2) {
      const st = pinchState()
      const z = clamp(pinch.z * (st.d / pinch.d), Z_MIN, Z_MAX), k = z / pinch.z
      // zoom about the starting centre, then follow the centre as it moves (two-finger pan)
      commit({ z, x: st.cx - (pinch.cx - pinch.vx) * k, y: st.cy - (pinch.cy - pinch.vy) * k })
      return
    }
    if (panning && e.pointerId === panning.id) { const s = local(e); commit({ ...store.view, x: panning.vx + s.x - panning.sx, y: panning.vy + s.y - panning.sy }); return }
    const ev = mkEv(e)
    store.emit('cursor', ev.p)
    tool?.pointermove?.(ev)
  }
  function onUp(e) {
    const had = pointers.delete(e.pointerId)
    try { host.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (pinch) { if (pointers.size < 2) pinch = null; return }
    if (panning && e.pointerId === panning.id) { panning = null; host.classList.remove('ds-panning'); return }
    if (had && e.type === 'pointerup') tool?.pointerup?.(mkEv(e))
    else if (had) tool?.cancel?.()
  }
  // wheel: Ctrl or Cmd always zooms at the cursor (pinch gestures arrive that way); a mouse wheel zooms; a trackpad pans; Shift pans sideways
  const isMouseWheel = (e) => e.deltaMode === 1 || (e.deltaMode === 0 && e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))
  function onWheel(e) {
    e.preventDefault()
    const s = local(e)
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    if (e.ctrlKey || e.metaKey) return zoomAt(Math.pow(1.0025, -e.deltaY * unit * (isMouseWheel(e) ? 1 : 3)), s.x, s.y)
    if (e.shiftKey) return panBy(-(e.deltaX || e.deltaY) * unit, 0)
    if (isMouseWheel(e) && store.prefs.wheel !== 'scroll') return zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, s.x, s.y)
    panBy(-e.deltaX * unit, -e.deltaY * unit)
  }
  const onDbl = (e) => tool?.dblclick?.(mkEv(e))
  host.addEventListener('pointerdown', onDown)
  host.addEventListener('pointermove', onMove)
  host.addEventListener('pointerup', onUp)
  host.addEventListener('pointercancel', onUp)
  host.addEventListener('wheel', onWheel, { passive: false })
  host.addEventListener('dblclick', onDbl)
  host.addEventListener('contextmenu', (e) => e.preventDefault())

  // keep the page fitted until the user zooms, and remember each page's view
  const ro = new ResizeObserver(() => { if (fitNext) zoomPage(); requestOverlay() })
  ro.observe(host)
  const offPage = store.on('page', (p) => {
    const saved = p && pageViews.get(p.id)
    if (saved) { commit(saved); fitNext = false } else zoomPage()
  })
  const offDoc = store.on('doc', (e) => { if (e?.load) { pageViews.clear(); fitNext = true } })
  const offSel = store.on('sel', requestOverlay)
  const offDocRedraw = store.on('doc', requestOverlay)

  return {
    toPage, toScreen, fromClient, size, setView, setZoom, setLabelledZoom, zoomAt, panBy, zoomPage, zoomAll, zoomSel, zoom100, fitBox, requestOverlay, addOverlay, ovG,
    setTool(t) { tool = t },
    setSpace(on) { spaceDown = !!on; host.classList.toggle('ds-space', spaceDown) },
    get pinching() { return !!pinch },
    dispose() { ro.disconnect(); offPage(); offDoc(); offSel(); offDocRedraw(); cancelAnimationFrame(rafId); clearTimeout(tmo); host.removeEventListener('wheel', onWheel); ovG.remove() },
  }
}
