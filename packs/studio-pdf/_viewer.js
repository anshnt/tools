// Continuous page viewer: lazy canvas rendering, zoom and fit modes, selectable text layer, and the per-page overlays
// (annotations, search hits, selection handles, form fields) drawn in base space.
import { h, svg } from '../../lib/ui.js'
import { MAX_PIXELS } from '../../lib/image.js'
import { toBase, toDisp, dispSize, cssMatrix, clamp } from './_geom.js'
import { renderAnnot, renderSelection } from './_annots.js'
import { loadItems, buildTextLayer } from './_text.js'

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const PAD_X = 20, PAD_Y = 16

export function createViewer(app) {
  const { store } = app
  const scroller = h('div', { class: 'pdfs-scroll', tabindex: 0, role: 'region', 'aria-label': 'Document pages' })
  const pagesEl = h('div', { class: 'pdfs-pages' })
  scroller.append(pagesEl)

  const views = new Map()
  let zoom = 1, mode = 'width', cur = 0, lastSig = '', destroyed = false
  const queue = new Set()
  let running = 0
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2)

  const api = { el: scroller, pagesEl, views, onPage: null, onZoom: null }
  Object.defineProperties(api, { zoom: { get: () => zoom }, mode: { get: () => mode }, current: { get: () => cur } })

  const entry = (pid) => store.page(pid)
  const order = () => store.state.pages.map((p) => views.get(p.id)).filter(Boolean)

  // ---------- page views ----------
  function makeView(p) {
    const el = h('div', { class: 'pg', role: 'group', dataset: { pid: p.id } })
    const paper = h('div', { class: 'pg-paper' })
    const textEl = h('div', { class: 'textlayer' })
    const svgEl = svg('svg', { class: 'layer-svg', width: p.w, height: p.h })
    const gHits = svg('g', { class: 'hits' }), gAnnots = svg('g', { class: 'annots' }), gTmp = svg('g', { class: 'tmp' }), gSel = svg('g', { class: 'selg' })
    svgEl.append(gHits, gAnnots, gTmp, gSel)
    const htmlEl = h('div', { class: 'layer-html', style: { width: `${p.w}px`, height: `${p.h}px` } })
    el.append(paper, textEl, svgEl, htmlEl)
    const pv = { pid: p.id, el, paper, textEl, svg: svgEl, html: htmlEl, gHits, gAnnots, gTmp, gSel, items: null, near: false, key: null, drawn: false, task: null, farSince: 0, token: 0 }
    io.observe(el)
    views.set(p.id, pv)
    return pv
  }

  function layout(pv) {
    const e = entry(pv.pid)
    if (!e) return
    const [dw, dh] = dispSize(e.rot, e.w, e.h)
    pv.el.style.width = `${dw * zoom}px`
    pv.el.style.height = `${dh * zoom}px`
    const m = cssMatrix(e.rot, e.w, e.h, zoom)
    pv.svg.style.transform = m
    pv.html.style.transform = m
    pv.svg.setAttribute('width', e.w); pv.svg.setAttribute('height', e.h)
    pv.html.style.width = `${e.w}px`; pv.html.style.height = `${e.h}px`
  }

  function syncPages() {
    const pages = store.state.pages
    const keep = new Set(pages.map((p) => p.id))
    for (const [pid, pv] of views) {
      if (keep.has(pid)) continue
      io.unobserve(pv.el); pv.task?.cancel(); queue.delete(pv); pv.el.remove(); views.delete(pid)
    }
    const els = []
    for (const [i, p] of pages.entries()) {
      let pv = views.get(p.id)
      if (!pv) pv = makeView(p)
      pv.el.setAttribute('aria-label', `Page ${i + 1}`)
      if (pv.rot !== p.rot) { pv.rot = p.rot; pv.key = null; pv.drawn = false }
      layout(pv)
      els.push(pv.el)
    }
    // reorder only when needed
    const have = [...pagesEl.children]
    if (have.length !== els.length || have.some((n, i) => n !== els[i])) pagesEl.replaceChildren(...els)
    lastSig = pages.map((p) => `${p.id}:${p.rot}`).join('|')
    for (const pv of views.values()) if (pv.near) schedule(pv)
    updateCurrent()
  }

  // ---------- drawing overlays ----------
  function draw(pv) {
    if (!pv || !pv.near && !pv.drawn) return
    pv.drawn = true
    const env = { assets: app.assets, editing: store.editing }
    pv.gAnnots.replaceChildren(...store.annotsOf(pv.pid).map((a) => renderAnnot(a, env)))
    drawSel(pv)
    drawHits(pv)
  }
  function drawSel(pv) {
    pv.gSel.replaceChildren()
    const a = store.sel && store.annot(store.sel)
    if (a && a.pid === pv.pid && store.tool === 'select') pv.gSel.append(renderSelection(a, zoom))
  }
  function drawHits(pv) {
    pv.gHits.replaceChildren()
    const list = app.search.byPid.get(pv.pid)
    if (!list) return
    for (const hit of list) for (const r of hit.rects) pv.gHits.append(svg('rect', { class: hit.idx === app.search.cur ? 'hit cur' : 'hit', x: r[0], y: r[1], width: r[2], height: r[3], rx: 1.5 }))
  }
  api.draw = (pid) => draw(views.get(pid))
  api.drawAll = () => { for (const pv of views.values()) draw(pv) }
  api.drawSel = () => { for (const pv of views.values()) if (pv.drawn) drawSel(pv) }
  api.drawHits = () => { for (const pv of views.values()) if (pv.drawn) drawHits(pv) }
  api.drawTmp = (pv, el) => { pv?.gTmp.replaceChildren(...(el ? [el] : [])) }

  // ---------- rendering ----------
  const key = (pv) => `${zoom.toFixed(3)}|${entry(pv.pid)?.rot}|${dpr()}`
  function schedule(pv) {
    if (!pv.near || destroyed) return
    if (pv.key === key(pv)) return
    queue.add(pv)
    pump()
  }
  function pump() {
    while (running < 2 && queue.size && !destroyed) {
      const mid = scroller.scrollTop + scroller.clientHeight / 2
      let best = null, bestD = Infinity
      for (const pv of queue) {
        const d = Math.abs(pv.el.offsetTop + pv.el.offsetHeight / 2 - mid)
        if (d < bestD) { best = pv; bestD = d }
      }
      queue.delete(best)
      running++
      renderView(best).catch((e) => console.error(e)).finally(() => { running--; pump() })
    }
  }
  async function renderView(pv) {
    const e = entry(pv.pid)
    if (!e || !pv.near) return
    const k = key(pv)
    const token = ++pv.token
    draw(pv)
    if (e.src == null) { // blank page: nothing to rasterize
      pv.paper.replaceChildren(); pv.textEl.replaceChildren(); pv.items = []
      pv.key = k
      app.forms?.mount(pv)
      return
    }
    const done = app.doc.hold(e.src)
    try { await paintPage(pv, e, k, token) } finally { done() }
  }
  async function paintPage(pv, e, k, token) {
    const page = await app.doc.page(e.src)
    if (token !== pv.token) return
    const rotation = (page.rotate + e.rot) % 360
    // Never render below 1.25x: small rotated text can lose glyphs in the browser's canvas at low scales, and the CSS downscale looks crisper anyway.
    let scale = Math.max(zoom * dpr(), 1.25)
    let vp = page.getViewport({ scale, rotation })
    if (vp.width * vp.height > MAX_PIXELS * 0.5) { scale *= Math.sqrt((MAX_PIXELS * 0.5) / (vp.width * vp.height)); vp = page.getViewport({ scale, rotation }) }
    const canvas = h('canvas', { class: 'pg-canvas' })
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    pv.task?.cancel()
    const task = page.render({ canvasContext: ctx, canvas, viewport: vp })
    pv.task = task
    try { await task.promise } catch (err) { if (err?.name === 'RenderingCancelledException') return; throw err }
    if (token !== pv.token || !views.has(pv.pid)) return
    pv.paper.replaceChildren(canvas)
    const t = await loadItems(app.doc, e.src)
    if (token !== pv.token) return
    pv.items = t.items
    buildTextLayer(pv.textEl, t.items, { rot: e.rot, w: e.w, h: e.h, zoom })
    pv.key = k
    app.forms?.mount(pv)
  }
  function release(pv) {
    pv.token++
    pv.task?.cancel()
    queue.delete(pv)
    pv.paper.replaceChildren(); pv.textEl.replaceChildren(); pv.html.replaceChildren()
    pv.key = null; pv.items = null
  }

  const io = new IntersectionObserver((list) => {
    for (const en of list) {
      const pv = views.get(en.target.dataset.pid)
      if (!pv) continue
      pv.near = en.isIntersecting
      if (pv.near) { pv.farSince = 0; if (!pv.drawn) draw(pv); schedule(pv) } else pv.farSince = Date.now()
    }
  }, { root: scroller, rootMargin: '120% 0px' })
  const sweep = setInterval(() => { for (const pv of views.values()) if (!pv.near && pv.farSince && Date.now() - pv.farSince > 4000 && pv.key) release(pv) }, 2500)

  // ---------- zoom, fit, navigation ----------
  function fitZoom(m) {
    const p = store.state.pages[cur] || store.state.pages[0]
    if (!p) return 1
    const [dw, dh] = dispSize(p.rot, p.w, p.h)
    const aw = Math.max(120, scroller.clientWidth - PAD_X * 2), ah = Math.max(120, scroller.clientHeight - PAD_Y * 2)
    return clamp(m === 'page' ? Math.min(aw / dw, ah / dh) : aw / dw, 0.2, 6)
  }
  api.setZoom = (z, anchor) => {
    if (z === 'width' || z === 'page') { mode = z; z = fitZoom(z) } else mode = 'custom'
    z = clamp(+z || 1, 0.2, 6)
    if (Math.abs(z - zoom) < 0.0005) { api.onZoom?.(zoom, mode); return }
    const f = z / zoom
    const ax = anchor?.x ?? scroller.clientWidth / 2, ay = anchor?.y ?? scroller.clientHeight / 2
    const sl = (scroller.scrollLeft + ax) * f - ax, st = (scroller.scrollTop + ay) * f - ay
    zoom = z
    for (const pv of views.values()) { layout(pv); pv.key = null }
    scroller.scrollLeft = sl; scroller.scrollTop = st
    for (const pv of views.values()) { if (pv.drawn) drawSel(pv); if (pv.near) schedule(pv) }
    api.onZoom?.(zoom, mode)
    updateCurrent()
  }
  api.zoomBy = (dir, anchor) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > zoom + 0.01) : [...ZOOMS].reverse().find((z) => z < zoom - 0.01)
    api.setZoom(next ?? (dir > 0 ? 5 : 0.25), anchor)
  }
  function updateCurrent() {
    const ord = order()
    if (!ord.length) return
    const probe = scroller.scrollTop + scroller.clientHeight * 0.3 - pagesEl.offsetTop
    let lo = 0, hi = ord.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (ord[mid].el.offsetTop <= probe) lo = mid; else hi = mid - 1
    }
    if (lo !== cur) { cur = lo; api.onPage?.(cur) } else api.onPage?.(cur, true)
  }
  api.goto = (i, { smooth = false } = {}) => {
    const pv = order()[clamp(i, 0, store.state.pages.length - 1)]
    if (!pv) return
    scroller.scrollTo({ top: pv.el.offsetTop + pagesEl.offsetTop - PAD_Y / 2, behavior: smooth ? 'smooth' : 'auto' })
  }
  api.gotoPid = (pid, o) => api.goto(store.pageIndex(pid), o)
  api.scrollToRect = (pid, r) => {
    const pv = views.get(pid), e = entry(pid)
    if (!pv || !e) return
    const [x1, y1] = toDisp(e.rot, e.w, e.h, r.x, r.y), [x2, y2] = toDisp(e.rot, e.w, e.h, r.x + r.w, r.y + r.h)
    const cy = pv.el.offsetTop + pagesEl.offsetTop + ((y1 + y2) / 2) * zoom, cx = pv.el.offsetLeft + pagesEl.offsetLeft + ((x1 + x2) / 2) * zoom
    if (cy < scroller.scrollTop + 60 || cy > scroller.scrollTop + scroller.clientHeight - 60) scroller.scrollTo({ top: cy - scroller.clientHeight / 2 })
    if (cx < scroller.scrollLeft + 40 || cx > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollTo({ left: cx - scroller.clientWidth / 2 })
  }
  /** Client coordinates -> base-space point on a page view. */
  api.toBase = (pv, cx, cy) => {
    const r = pv.el.getBoundingClientRect(), e = entry(pv.pid)
    const [x, y] = toBase(e.rot, e.w, e.h, (cx - r.left) / zoom, (cy - r.top) / zoom)
    return { x, y }
  }
  api.pageFromEvent = (ev) => {
    const pg = ev.target?.closest?.('.pg')
    return pg ? views.get(pg.dataset.pid) : null
  }
  api.nearestView = (cx, cy) => {
    let best = null, bd = Infinity
    for (const pv of views.values()) {
      const r = pv.el.getBoundingClientRect()
      const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0
      if (d < bd) { bd = d; best = pv }
    }
    return best
  }
  api.refresh = () => { for (const pv of views.values()) { pv.key = null; if (pv.near) schedule(pv) } }
  api.rebuild = () => { syncPages(); if (mode !== 'custom') api.setZoom(mode) }

  // ---------- events ----------
  let raf = 0
  scroller.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateCurrent) }, { passive: true })
  scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const r = scroller.getBoundingClientRect()
    api.setZoom(zoom * Math.exp(-e.deltaY * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top })
  }, { passive: false })
  const ro = new ResizeObserver(() => { if (mode !== 'custom') api.setZoom(mode); else updateCurrent() })
  ro.observe(scroller)

  const off = store.on((type, d) => {
    if (type === 'change') {
      const sig = store.state.pages.map((p) => `${p.id}:${p.rot}`).join('|')
      if (sig !== lastSig || d.reset) {
        syncPages()
        if (d.reset) { cur = 0; scroller.scrollTo(0, 0); if (mode !== 'custom') api.setZoom(mode) }
      }
      if (d.pids) d.pids.forEach((pid) => api.draw(pid)); else api.drawAll()
      app.forms?.syncAll()
    } else if (type === 'sel') {
      for (const pid of [store.annot(d.old)?.pid, store.annot(d.id)?.pid]) if (pid) { const pv = views.get(pid); if (pv) drawSel(pv) }
      api.drawSel()
    } else if (type === 'tool') api.drawSel()
  })

  api.destroy = () => {
    destroyed = true
    off(); io.disconnect(); ro.disconnect(); clearInterval(sweep); cancelAnimationFrame(raf)
    for (const pv of views.values()) pv.task?.cancel()
    views.clear()
  }
  return api
}
