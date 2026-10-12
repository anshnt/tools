// Draw Studio rulers, guides and grid. Two canvas rulers sit along the top and left of the view in the document's units, with the origin at the page's
// bottom-left corner (y up). Dragging out of a ruler makes a guide (it snaps while dragging, a release over the view commits one undo step, a release
// over the ruler cancels). The Pick tool grabs a guide within 4 px (move = one step, release over a ruler = delete, double-click = position dialog).
// Guides and the grid are drawn into the view's overlay. All numbers in the overlay and on the rulers are screen pixels computed here, never file data.
import { h } from '../../lib/ui.js'
import { PT_PER, defaultGrid, fmt, niceStep } from './_ds-units.js'
import { collectTargets, snapPoint } from './_ds-hit.js'
import { addGuide, deleteGuide, guideAt, moveGuide } from './_ds-guides.js'

export const RULER = 20 // thickness in px
const DRAG = 4

/** env: {store, view, stage, host, boxOf, getTool() -> the active tool, app: {guideDialog(id)}} -> {el, refresh, shown(), grabbing} */
export function createRulers({ store, view, stage, host, boxOf, getTool, app }) {
  const rh = h('canvas', { class: 'ds-ruler ds-ruler-h', 'aria-hidden': 'true', title: 'Drag down to make a horizontal guide' })
  const rv = h('canvas', { class: 'ds-ruler ds-ruler-v', 'aria-hidden': 'true', title: 'Drag right to make a vertical guide' })
  const corner = h('div', { class: 'ds-corner', 'aria-hidden': 'true' })
  stage.append(corner, rh, rv)
  const phone = window.matchMedia('(max-width: 860px)')
  const shown = () => store.prefs.rulers ?? !phone.matches
  const guidesOn = () => store.prefs.showGuides !== false
  let pre = null // a guide being dragged: {id (null for a new one), axis, pos}
  let cursorAt = null, raf = 0, tmo = 0

  // ---------- drawing the rulers ----------
  const colors = () => {
    const cs = getComputedStyle(rh), g = (n, d) => cs.getPropertyValue(n).trim() || d
    return { bg: g('--surface-2', '#f4f4f8'), fg: g('--text-2', '#555'), line: g('--border-strong', '#aaa'), hot: g('--accent', '#2563eb') }
  }
  function sized(c) {
    const r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(r.width)), hh = Math.max(1, Math.round(r.height))
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr) }
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { ctx, w, h: hh }
  }
  /** Tick positions for the unit values between lo and hi: [{v, major, label?}]. Labelled ticks are at least 50 px apart. */
  function ticks(lo, hi, step, pxPerUnit) {
    const out = []
    const mant = step / 10 ** Math.floor(Math.log10(step))
    const n = Math.abs(mant - 2) < 1e-9 ? 4 : 5
    const sub = step * pxPerUnit / n >= 4
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
    for (let k = Math.floor(lo / step) - 1; k <= Math.ceil(hi / step) + 1; k++) {
      out.push({ v: k * step, major: true, label: (Math.round(k * step * 10 ** dec) / 10 ** dec).toFixed(dec) })
      if (sub) for (let j = 1; j < n; j++) out.push({ v: (k + j / n) * step, major: false, mid: n % 2 === 0 && j === n / 2 })
    }
    return out
  }
  /** The ticks of both rulers in screen pixels: {unit, h: [{v, x, major, label?, mid?}], v: [{v, y, ...}]}. v is the value in the document's units (0 at the page bottom-left, y up). */
  function scan(w, hh) {
    const page = store.page(), z = store.view.z, unit = store.root.units, ppu = PT_PER[unit] || 1
    const step = niceStep(z, unit), pxPerUnit = z * ppu
    const hx = ticks(view.toPage(0, 0).x / ppu, view.toPage(w, 0).x / ppu, step, pxPerUnit).map((t) => ({ ...t, x: view.toScreen(t.v * ppu, 0).x }))
    const vy = ticks((page.h - view.toPage(0, hh).y) / ppu, (page.h - view.toPage(0, 0).y) / ppu, step, pxPerUnit).map((t) => ({ ...t, y: view.toScreen(0, page.h - t.v * ppu).y }))
    return { unit, step, h: hx, v: vy }
  }
  function draw() {
    raf = 0; clearTimeout(tmo)
    if (!shown()) return
    const page = store.page()
    if (!page) return
    const c = colors()
    corner.textContent = store.root.units
    // top ruler: x
    {
      const { ctx, w, h: hh } = sized(rh)
      const sc = scan(w, view.size().h)
      ctx.clearRect(0, 0, w, hh); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, hh)
      const p0 = view.toScreen(0, 0).x, p1 = view.toScreen(page.w, 0).x
      ctx.globalAlpha = 0.12; ctx.fillStyle = c.hot; ctx.fillRect(p0, 0, p1 - p0, hh); ctx.globalAlpha = 1
      ctx.strokeStyle = c.line; ctx.fillStyle = c.fg; ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.lineWidth = 1
      ctx.beginPath()
      for (const t of sc.h) {
        const x = Math.round(t.x) + 0.5
        if (x < -40 || x > w + 40) continue
        ctx.moveTo(x, hh); ctx.lineTo(x, hh - (t.major ? RULER - 2 : t.mid ? 8 : 5))
        if (t.label != null) ctx.fillText(t.label, x + 3, 2)
      }
      ctx.moveTo(0, hh - 0.5); ctx.lineTo(w, hh - 0.5)
      ctx.stroke()
      if (cursorAt) { const x = Math.round(view.toScreen(cursorAt.x, 0).x) + 0.5; ctx.strokeStyle = c.hot; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hh); ctx.stroke() }
    }
    // left ruler: y measured up from the page bottom
    {
      const { ctx, w, h: hh } = sized(rv)
      const sc = scan(view.size().w, hh)
      ctx.clearRect(0, 0, w, hh); ctx.fillStyle = c.bg; ctx.fillRect(0, 0, w, hh)
      const q0 = view.toScreen(0, page.h).y, q1 = view.toScreen(0, 0).y
      ctx.globalAlpha = 0.12; ctx.fillStyle = c.hot; ctx.fillRect(0, q0, w, q1 - q0); ctx.globalAlpha = 1
      ctx.strokeStyle = c.line; ctx.fillStyle = c.fg; ctx.font = '10px system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.lineWidth = 1
      ctx.beginPath()
      for (const t of sc.v) {
        const y = Math.round(t.y) + 0.5
        if (y < -40 || y > hh + 40) continue
        ctx.moveTo(w, y); ctx.lineTo(w - (t.major ? RULER - 2 : t.mid ? 8 : 5), y)
        if (t.label != null) { ctx.save(); ctx.translate(2, y - 3); ctx.rotate(-Math.PI / 2); ctx.fillText(t.label, 0, 0); ctx.restore() }
      }
      ctx.moveTo(w - 0.5, 0); ctx.lineTo(w - 0.5, hh)
      ctx.stroke()
      if (cursorAt) { const y = Math.round(view.toScreen(0, cursorAt.y).y) + 0.5; ctx.strokeStyle = c.hot; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
    }
  }
  function schedule() {
    if (raf || !shown()) return
    raf = requestAnimationFrame(draw)
    tmo = setTimeout(() => { if (raf) { cancelAnimationFrame(raf); draw() } }, 80)
  }
  function applyVisible() {
    const on = shown()
    stage.classList.toggle('ds-rulers', on)
    for (const e of [rh, rv, corner]) e.hidden = !on
    schedule()
    view.requestOverlay()
  }

  // ---------- the overlay: grid, guides, a guide being dragged ----------
  const gridStep = () => store.prefs.gridStep || defaultGrid(store.root.units)
  function drawGrid(g, { toScreen, el }) {
    const page = store.page(), step = gridStep(), z = store.view.z
    if (step * z < 6) return
    const s = view.size()
    const x0 = Math.max(0, Math.floor(view.toPage(0, 0).x / step) * step), x1 = Math.min(page.w, view.toPage(s.w, 0).x)
    const yTop = Math.max(0, view.toPage(0, 0).y), yBot = Math.min(page.h, view.toPage(0, s.h).y)
    const a = toScreen(0, 0), b = toScreen(page.w, page.h)
    let d = ''
    let n = 0
    for (let x = x0; x <= x1 + 1e-6 && n < 600; x += step, n++) { const sx = toScreen(x, 0).x; d += `M${sx.toFixed(1)} ${Math.max(a.y, 0).toFixed(1)}V${Math.min(b.y, s.h).toFixed(1)}` }
    n = 0
    for (let k = Math.max(0, Math.floor((page.h - yBot) / step)); n < 600; k++, n++) {
      const y = page.h - k * step
      if (y < yTop - 1e-6) break
      const sy = toScreen(0, y).y
      d += `M${Math.max(a.x, 0).toFixed(1)} ${sy.toFixed(1)}H${Math.min(b.x, s.w).toFixed(1)}`
    }
    if (d) g.append(el('path', { class: 'ds-grid', d }))
  }
  view.addOverlay((g, helpers) => {
    const page = store.page()
    if (!page || page.pending) return
    const s = view.size()
    if (store.prefs.showGrid) drawGrid(g, helpers)
    if (!guidesOn() && !pre) return
    const line = (axis, pos, cls) => {
      const p = helpers.toScreen(axis === 'v' ? pos : 0, axis === 'h' ? pos : 0)
      if (axis === 'v') { if (p.x >= -1 && p.x <= s.w + 1) g.append(helpers.el('line', { class: cls, x1: p.x, y1: 0, x2: p.x, y2: s.h })) } else if (p.y >= -1 && p.y <= s.h + 1) g.append(helpers.el('line', { class: cls, x1: 0, y1: p.y, x2: s.w, y2: p.y }))
    }
    if (guidesOn()) for (const gd of page.guides || []) if (!pre || pre.id !== gd.id) line(gd.axis, gd.pos, `ds-guide${store.guideSel === gd.id ? ' ds-guide-sel' : ''}`)
    if (pre && pre.pos != null) line(pre.axis, pre.pos, `ds-guide ds-guide-sel${pre.out ? ' ds-guide-out' : ''}`)
  })

  // ---------- helpers for drags ----------
  const local = (e) => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const inside = (s) => { const z = view.size(); return s.x >= 0 && s.y >= 0 && s.x <= z.w && s.y <= z.h }
  const viewportRect = () => { const s = view.size(), a = view.toPage(0, 0), b = view.toPage(s.w, s.h); return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } }
  const say = (axis, pos) => { const page = store.page(), u = store.root.units; store.setStatus(axis === 'v' ? `Vertical guide  X ${fmt(pos, u)} ${u}` : `Horizontal guide  Y ${fmt(page.h - pos, u)} ${u}`) }
  /** Snapped guide position along its axis for a page point. */
  const snapPos = (axis, p, T, off) => { const sp = snapPoint(p, T, 6 / store.view.z, off || store.prefs.snap === false); return axis === 'v' ? sp.x : sp.y }

  // ---------- drag out of a ruler ----------
  function railDown(axis) {
    return (e) => {
      if (e.button !== 0) return
      const page = store.page()
      if (!page || page.pending) return
      e.preventDefault()
      const el = e.currentTarget
      try { el.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
      const T = collectTargets(store, boxOf, new Set(), viewportRect())
      pre = { id: null, axis, pos: null }
      const move = (m) => {
        const s = local(m)
        pre.pos = snapPos(axis, view.toPage(s.x, s.y), T, m.altKey)
        pre.out = !inside(s)
        say(axis, pre.pos)
        view.requestOverlay()
      }
      const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel); document.removeEventListener('keydown', esc, true); pre = null; store.setStatus(''); view.requestOverlay() }
      const up = (m) => {
        const s = local(m), pos = pre?.pos
        end()
        if (pos != null && inside(s)) {
          const out = {}
          store.tx('Add guide', (r) => addGuide(r, page.id, axis, pos, store.newId, { out }))
          if (out.id != null) { store.guideSel = out.id; store.emit('guides') }
          view.requestOverlay()
        }
      }
      const cancel = () => end()
      const esc = (k) => { if (k.key === 'Escape') { k.stopPropagation(); end() } }
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancel); document.addEventListener('keydown', esc, true)
      move(e)
    }
  }
  rh.addEventListener('pointerdown', railDown('h'))
  rv.addEventListener('pointerdown', railDown('v'))

  // ---------- the Pick tool grabbing an existing guide ----------
  const hit = (s, touch = false) => (guidesOn() && !store.prefs.lockGuides && store.page() && !store.page().pending ? guideAt(store.page().guides, view.toScreen, s.x, s.y, touch ? 12 : 4) : null)
  view.addGrab((ev, tool) => {
    if (tool?.id !== 'pick' || tool.handleAt?.(ev)) return null
    const gd = hit(ev.s, ev.pointerType === 'touch')
    if (!gd) return null
    const page = store.page()
    store.setSel([])
    store.guideSel = gd.id
    store.emit('guides')
    const T = collectTargets(store, boxOf, new Set(), viewportRect(), { skipGuide: gd.id })
    let moved = false
    const finish = () => { pre = null; store.setStatus(''); view.requestOverlay() }
    view.requestOverlay()
    return {
      move(e) {
        if (!moved && Math.hypot(e.s.x - ev.s.x, e.s.y - ev.s.y) <= DRAG) return
        moved = true
        pre = { id: gd.id, axis: gd.axis, pos: snapPos(gd.axis, e.p, T, e.mods.alt), out: !inside(e.s) }
        say(gd.axis, pre.pos)
        view.requestOverlay()
      },
      up(e) {
        const pos = pre?.pos
        finish()
        if (!moved) return
        if (!inside(e.s)) { store.tx('Delete guide', (r) => deleteGuide(r, page.id, gd.id)); store.guideSel = null; store.emit('guides') } else if (pos != null) store.tx('Move guide', (r) => moveGuide(r, page.id, gd.id, pos))
      },
      cancel: finish,
    }
  })
  host.addEventListener('dblclick', (e) => {
    if (getTool()?.id !== 'pick') return
    const gd = hit(view.fromClient(e).s)
    if (!gd) return
    e.stopImmediatePropagation()
    app.guideDialog(gd.id)
  }, true)

  // ---------- wiring ----------
  const ro = new ResizeObserver(schedule)
  ro.observe(stage)
  const mo = new MutationObserver(schedule)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
  const offs = [store.on('view', schedule), store.on('doc', schedule), store.on('page', schedule), store.on('cursor', (p) => { cursorAt = p; schedule() }), store.on('guides', () => view.requestOverlay()),
    store.on('prefs', () => { applyVisible(); view.requestOverlay() })]
  const onPhone = () => applyVisible()
  phone.addEventListener?.('change', onPhone)
  applyVisible()
  return {
    el: [corner, rh, rv], refresh: schedule, shown, hit, draw,
    /** For tests: the labelled ticks of both rulers in screen pixels relative to the view. */
    marks() { if (!store.page()) return null; const sc = scan(rh.clientWidth, rv.clientHeight); return { unit: sc.unit, step: sc.step, h: sc.h.filter((t) => t.major).map((t) => ({ v: t.v, x: t.x, label: t.label })), v: sc.v.filter((t) => t.major).map((t) => ({ v: t.v, y: t.y, label: t.label })) } },
    dispose() { offs.forEach((f) => f()); ro.disconnect(); mo.disconnect(); phone.removeEventListener?.('change', onPhone); cancelAnimationFrame(raf); clearTimeout(tmo) },
  }
}
