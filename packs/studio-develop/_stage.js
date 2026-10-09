// The canvas area: loads the active photo, renders it with WebGL, zoom and pan, before/after, the crop overlay and the histogram.
import { h, icon, onCleanup } from '../../lib/ui.js'
import { createRenderer } from './_gl.js'
import { loadSource } from './_store.js'
import { cropPixels, defaults, orientedSize, pick } from './_model.js'
import { histogramOf } from './_controls.js'
import { createCrop } from './_crop.js'

const MAX_ZOOM = 4 // device pixels per image pixel

export function createStage(app) {
  let gl = h('canvas', { class: 'pd-gl' })
  const before = h('canvas', { class: 'pd-before' })
  const tagBefore = h('span', { class: 'pd-tag left' }, 'Before')
  const tagAfter = h('span', { class: 'pd-tag right' }, 'After')
  const handle = h('div', { class: 'pd-split', role: 'slider', tabindex: 0, 'aria-label': 'Before and after divider', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 50 }, h('i'))
  const pane = h('div', { class: 'pd-pane' }, gl, before)
  const loading = h('div', { class: 'pd-loading', hidden: true }, h('span', { class: 'spinner' }), h('span', 'Loading photo'))
  const note = h('div', { class: 'pd-note', hidden: true })
  const hud = h('div', { class: 'pd-hud' })
  const viewport = h('div', { class: 'pd-viewport', tabindex: -1 }, pane, tagBefore, tagAfter, handle, hud, loading, note)
  const el = h('div', { class: 'pd-stage' }, viewport)

  let renderer = null
  let cur = null // {id, srcW, srcH, fullW, fullH, small}
  let token = 0
  const view = { fit: true, scale: 1, cx: 0.5, cy: 0.5 }
  let split = 0.5
  let cropUi = null
  let lastKey = ''
  let raf = 0, timer = 0, histTimer = 0, disposed = false
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2.5)

  function fail(msg) {
    note.hidden = false
    note.replaceChildren(icon('triangle-alert'), h('span', msg))
  }
  try {
    renderer = createRenderer(gl)
  } catch (e) {
    fail(e.message)
  }
  /** The browser can reset the GPU context (driver reset, too many contexts). A canvas cannot reuse a lost context, so start a new one and reload the photo. */
  function recover() {
    const id = cur?.id
    const next = h('canvas', { class: 'pd-gl' })
    gl.replaceWith(next)
    gl = next
    try { renderer = createRenderer(gl); api.renderer = renderer } catch (e) { renderer = null; fail(e.message); return }
    cur = null
    if (id) load(id)
  }

  // ---------- geometry of what is shown ----------
  const settings = () => app.settings()
  /** Settings used for display: in crop mode the whole straightened frame is shown so the crop can be adjusted. */
  function frameSettings() {
    const s = settings()
    return app.cropMode ? { ...s, crop: { x: 0, y: 0, w: 1, h: 1 } } : s
  }
  /** Full-resolution pixel size of the displayed frame. */
  function fullSize(s) {
    return cropPixels(s, cur.fullW, cur.fullH)
  }
  const vp = () => ({ w: viewport.clientWidth, h: viewport.clientHeight })
  function fitScale(s) {
    const [fw, fh] = fullSize(s), v = vp()
    return Math.min((v.w - 24) / fw, (v.h - 24) / fh)
  }

  function layout() {
    if (!cur || !settings()) return
    const s = frameSettings(), [fw, fh] = fullSize(s), v = vp()
    if (v.w < 10 || v.h < 10) return
    const fs = fitScale(s)
    if (view.fit || app.cropMode) view.scale = fs
    view.scale = Math.min(Math.max(view.scale, fs), Math.max(MAX_ZOOM / dpr(), fs))
    const dw = fw * view.scale, dh = fh * view.scale
    const cxMin = Math.min(0.5, v.w / 2 / dw), cyMin = Math.min(0.5, v.h / 2 / dh)
    if (view.fit || app.cropMode) { view.cx = 0.5; view.cy = 0.5 }
    view.cx = Math.min(1 - cxMin, Math.max(cxMin, view.cx)); view.cy = Math.min(1 - cyMin, Math.max(cyMin, view.cy))
    pane.style.width = `${dw}px`; pane.style.height = `${dh}px`
    pane.style.left = `${v.w / 2 - view.cx * dw}px`; pane.style.top = `${v.h / 2 - view.cy * dh}px`
    const pct = Math.round(view.scale * dpr() * 100)
    hud.textContent = view.fit ? `Fit  ${pct}%` : `${pct}%`
    viewport.classList.toggle('zoomed', !view.fit && !app.cropMode)
    app.emit('zoom', { fit: view.fit, pct })
    cropUi?.refresh()
    positionSplit()
  }

  function procSize(s) {
    const [fw, fh] = fullSize(s)
    const px = cur.srcW / cur.fullW // proxy resolution relative to the original
    const want = Math.max(fw, fh) * view.scale * dpr()
    const have = Math.max(fw, fh) * px
    const long = Math.max(64, Math.min(want, have, 3072))
    const k = long / Math.max(fw, fh)
    return [Math.max(1, Math.round(fw * k)), Math.max(1, Math.round(fh * k))]
  }

  function beforeSettings(s) {
    return { ...defaults(), ...pick(s, ['geometry']), crop: s.crop }
  }

  // ---------- rendering ----------
  function renderNow() {
    raf = 0
    if (disposed || !renderer || !cur || !settings()) return
    if (renderer.lost) { recover(); return }
    if (vp().w < 10) return
    const s = frameSettings()
    const [pw, ph] = procSize(s)
    const compare = app.compare !== 'off' && !app.cropMode
    try {
      if (compare) {
        renderer.render(beforeSettings(s), pw, ph, { opaque: true })
        before.width = pw; before.height = ph
        before.getContext('2d').drawImage(gl, 0, 0)
      }
      renderer.render(s, pw, ph, { opaque: !app.cropMode, clip: app.clip && !compare })
    } catch (e) {
      console.error(e)
      fail('Could not draw this photo with WebGL.')
      return
    }
    before.hidden = !compare
    tagBefore.hidden = !compare || (app.compare === 'split' && split < 0.12)
    tagAfter.hidden = !compare || app.compare === 'before' || (app.compare === 'split' && split > 0.88)
    handle.hidden = !(compare && app.compare === 'split')
    positionSplit()
    scheduleHistogram()
  }
  function scheduleRender() {
    if (raf) return
    raf = requestAnimationFrame(renderNow)
    clearTimeout(timer)
    timer = setTimeout(() => { if (raf) { cancelAnimationFrame(raf); renderNow() } }, 120) // rAF is paused in background tabs
  }
  function scheduleHistogram() {
    if (histTimer) return
    histTimer = setTimeout(() => {
      histTimer = 0
      if (disposed || !cur || gl.width < 2) return
      try { app.emit('histogram', histogramOf(gl)) } catch { /* canvas not readable */ }
    }, 90)
  }
  function positionSplit() {
    const split100 = Math.round(split * 100)
    before.style.clipPath = app.compare === 'split' ? `inset(0 ${100 - split100}% 0 0)` : 'none'
    const r = pane.getBoundingClientRect(), v = viewport.getBoundingClientRect()
    const x = r.left - v.left + r.width * split
    handle.style.left = `${x}px`
    handle.style.top = `${r.top - v.top}px`; handle.style.height = `${r.height}px`
    handle.setAttribute('aria-valuenow', String(split100))
    tagBefore.style.left = `${Math.max(r.left - v.left, 0) + 10}px`; tagBefore.style.top = `${Math.max(r.top - v.top, 0) + 10}px`
    tagAfter.style.right = `${Math.max(v.right - r.right, 0) + 10}px`; tagAfter.style.top = `${Math.max(r.top - v.top, 0) + 10}px`
  }

  // ---------- loading ----------
  async function load(id) {
    const my = ++token
    if (!renderer) return
    loading.hidden = false
    try {
      const src = await loadSource(id)
      if (my !== token || disposed) return
      renderer.setSource(src.canvas, src.width, src.height)
      const small = document.createElement('canvas')
      const k = 300 / Math.max(src.width, src.height)
      small.width = Math.max(1, Math.round(src.width * Math.min(1, k))); small.height = Math.max(1, Math.round(src.height * Math.min(1, k)))
      const sc = small.getContext('2d')
      sc.imageSmoothingQuality = 'high'
      sc.drawImage(src.canvas, 0, 0, small.width, small.height)
      cur = { id, srcW: src.width, srcH: src.height, fullW: src.fullWidth, fullH: src.fullHeight, small }
      src.canvas.width = src.canvas.height = 1 // free the CPU copy, the GPU holds it now
      view.fit = true
      note.hidden = true
      lastKey = ''
      layout(); renderNow()
      app.emit('source', { id, small })
    } catch (e) {
      if (my !== token) return
      console.error(e)
      cur = null
      fail(e.message || 'Could not open this photo.')
    } finally {
      if (my === token) loading.hidden = true
    }
  }

  // ---------- zoom and pan ----------
  function zoomTo(scale, around) {
    if (!cur) return
    const s = frameSettings(), fs = fitScale(s)
    const [fw, fh] = fullSize(s), v = vp()
    const old = view.scale
    const next = Math.min(Math.max(scale, fs), Math.max(MAX_ZOOM / dpr(), fs))
    if (around) {
      const r = pane.getBoundingClientRect(), vr = viewport.getBoundingClientRect()
      const px = (around.x - r.left) / (fw * old), py = (around.y - r.top) / (fh * old) // image point under the cursor
      view.cx = px - (around.x - vr.left - v.w / 2) / (fw * next)
      view.cy = py - (around.y - vr.top - v.h / 2) / (fh * next)
    }
    view.scale = next
    view.fit = next <= fs * 1.001
    layout()
    scheduleRender()
  }
  const api = {
    el, renderer,
    fit() { view.fit = true; layout(); scheduleRender() },
    zoom100() { zoomTo(1 / dpr()) },
    zoomBy(f, around) { zoomTo(view.scale * f, around) },
    toggleZoom(around) { view.fit ? zoomTo(1 / dpr(), around) : api.fit() },
    get zoomPct() { return Math.round(view.scale * dpr() * 100) },
    render: scheduleRender,
    layout,
    get loaded() { return !!cur },
    get source() { return cur },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf); clearTimeout(timer); clearTimeout(histTimer)
      ro.disconnect()
      cropUi?.destroy()
      renderer?.dispose()
    },
  }

  // pointer: pan (drag), pinch zoom, wheel zoom, double click
  const pointers = new Map()
  let pan = null, pinch = null, spaceDown = false
  const onKey = (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName || '')) { spaceDown = e.type === 'keydown'; viewport.classList.toggle('grab', spaceDown); if (spaceDown && app.view === 'develop') e.preventDefault() } }
  document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKey)
  onCleanup(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKey) })

  viewport.addEventListener('pointerdown', (e) => {
    if (app.cropMode || e.target.closest('.pd-split')) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    viewport.setPointerCapture(e.pointerId)
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale }
      pan = null
    } else if (!view.fit || spaceDown || e.button === 1) pan = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy }
    if (pan) viewport.classList.add('panning')
  })
  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      zoomTo(pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    } else if (pan && cur) {
      const [fw, fh] = fullSize(frameSettings())
      view.cx = pan.cx - (e.clientX - pan.x) / (fw * view.scale)
      view.cy = pan.cy - (e.clientY - pan.y) / (fh * view.scale)
      layout()
    }
  })
  const up = (e) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    if (!pointers.size) { pan = null; viewport.classList.remove('panning'); if (!view.fit) scheduleRender() }
  }
  viewport.addEventListener('pointerup', up); viewport.addEventListener('pointercancel', up)
  viewport.addEventListener('wheel', (e) => {
    if (!cur || app.cropMode) return
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      zoomTo(view.scale * Math.exp(-e.deltaY * 0.0022), { x: e.clientX, y: e.clientY })
    } else if (!view.fit) {
      e.preventDefault()
      const [fw, fh] = fullSize(frameSettings())
      view.cx += e.deltaX / (fw * view.scale); view.cy += e.deltaY / (fh * view.scale)
      layout()
    }
  }, { passive: false })
  viewport.addEventListener('dblclick', (e) => { if (!app.cropMode && cur && !e.target.closest('.pd-split')) api.toggleZoom({ x: e.clientX, y: e.clientY }) })

  // before/after divider
  let dragSplit = false
  const moveSplit = (e) => {
    const r = pane.getBoundingClientRect()
    split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    positionSplit()
    tagBefore.hidden = split < 0.12; tagAfter.hidden = split > 0.88
  }
  handle.addEventListener('pointerdown', (e) => { dragSplit = true; handle.setPointerCapture(e.pointerId); e.preventDefault() })
  handle.addEventListener('pointermove', (e) => { if (dragSplit) moveSplit(e) })
  handle.addEventListener('pointerup', () => { dragSplit = false })
  handle.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -0.05, ArrowRight: 0.05 }[e.key]
    if (d === undefined) return
    e.preventDefault(); split = Math.min(1, Math.max(0, split + d)); positionSplit()
  })

  // ---------- crop overlay ----------
  function cropState() {
    const s = settings(), [Wo, Ho] = orientedSize(cur.srcW, cur.srcH, s.rot)
    return { crop: s.crop, angle: s.angle, Wo, Ho, ratio: cropRatio }
  }
  let cropRatio = null
  api.setCropRatio = (r) => { cropRatio = r }
  function enterCrop() {
    if (!cur) return
    cropUi?.destroy()
    cropUi = createCrop({
      pane, get: cropState,
      onChange: (crop, final) => app.update('Crop', (s) => ({ ...s, crop: { x: crop.x, y: crop.y, w: crop.w, h: crop.h } }), { coalesce: !final }),
    })
    viewport.classList.add('cropping')
    layout(); scheduleRender()
  }
  function leaveCrop() {
    cropUi?.destroy(); cropUi = null
    viewport.classList.remove('cropping')
    view.fit = true
    layout(); scheduleRender()
  }

  // ---------- wiring ----------
  const ro = new ResizeObserver(() => { layout(); scheduleRender() })
  ro.observe(viewport)
  const offs = [
    app.on('active', (id) => { if (app.view === 'develop' || cur) load(id) }),
    app.on('view', (v) => { if (v === 'develop') { if (!cur || cur.id !== app.activeId) load(app.activeId); else { layout(); scheduleRender() } } }),
    app.on('edit', (ev) => {
      if (ev.id !== app.activeId || !cur) return
      cropUi?.refresh()
      const s = settings()
      const key = JSON.stringify(app.cropMode ? { ...s, crop: 0 } : s)
      if (key === lastKey) return
      const geom = JSON.stringify(pick(s, ['geometry']))
      const geomChanged = geom !== api._geom
      lastKey = key; api._geom = geom
      if (geomChanged) layout()
      scheduleRender()
    }),
    app.on('compare', () => scheduleRender()),
    app.on('clip', () => scheduleRender()),
    app.on('crop', (on) => { lastKey = ''; on ? enterCrop() : leaveCrop() }),
  ]
  api.dispose = ((orig) => () => { offs.forEach((o) => o()); orig() })(api.dispose)
  return api
}
