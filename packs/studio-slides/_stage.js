// The canvas editor: zoomable stage, selection overlay with handles, move/resize/rotate, snapping guides,
// drawing tools, marquee select and in-place rich text and table editing.
import { h, icon } from '../../lib/ui.js'
import { renderSlide, elementNode, parseParas } from './_render.js'
import { clamp, rotatePoint, linePoints, lineFromPoints, textEl, shapeEl, lineEl, isTextual, bboxOf, isEmptyEl } from './_model.js'

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN = 10

export function createStage(app) {
  const { store } = app
  const stage = h('div', { class: 'ss-stage' })
  const wrap = h('div', { class: 'ss-stage-wrap' }, stage)
  const canvas = h('div', { class: 'ss-canvas', tabindex: -1 }, wrap)
  const overlay = h('div', { class: 'ss-overlay' })
  let slideEl = null
  let zoom = 1
  let zoomMode = 'fit'
  let editing = null // { id, kind: 'text' | 'table', tc, node, before, range }
  let g = null // active pointer gesture
  const api = { el: canvas, get zoom() { return zoom }, get editing() { return editing }, get zoomMode() { return zoomMode } }

  const deck = () => store.deck
  const slide = () => store.slide
  const elemById = (id) => slide()?.elements.find((e) => e.id === id)
  const nodeOf = (id) => slideEl?.querySelector(`.ss-el[data-id="${id}"]`)
  const toSlide = (e) => { const r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom } }
  const renderOpts = () => ({ mode: 'edit', url: (id) => store.assetUrl(id) })

  // ---------- Zoom ----------
  function layout() {
    const { w, h: hh } = deck()
    stage.style.width = `${w}px`
    stage.style.height = `${hh}px`
    stage.style.transform = `scale(${zoom})`
    stage.style.setProperty('--iz', String(1 / zoom))
    wrap.style.width = `${Math.round(w * zoom)}px`
    wrap.style.height = `${Math.round(hh * zoom)}px`
  }
  function fitZoom() {
    const pad = canvas.clientWidth < 600 ? 16 : 56
    const aw = canvas.clientWidth - pad, ah = canvas.clientHeight - pad
    if (aw < 50 || ah < 50) return zoom
    return clamp(Math.min(aw / deck().w, ah / deck().h), 0.1, 4)
  }
  api.setZoom = (z) => {
    if (z === 'fit') { zoomMode = 'fit'; zoom = fitZoom() } else { zoomMode = 'manual'; zoom = clamp(+z, 0.1, 4) }
    layout()
    drawOverlay()
    app.bus.emit('zoom')
  }
  const ro = new ResizeObserver(() => { if (zoomMode === 'fit') { const z = fitZoom(); if (Math.abs(z - zoom) > 0.002) { zoom = z; layout(); drawOverlay(); app.bus.emit('zoom') } } })
  ro.observe(canvas)
  canvas.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    api.setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
  }, { passive: false })

  // ---------- Rendering ----------
  api.render = () => {
    if (editing) discardEdit()
    const s = slide()
    if (!s) return
    slideEl = renderSlide(deck(), s, renderOpts())
    stage.replaceChildren(slideEl, overlay)
    if (zoomMode === 'fit') zoom = fitZoom()
    layout()
    drawOverlay()
  }
  function rerenderElement(e) {
    const old = nodeOf(e.id)
    if (!old) return
    const neu = elementNode(deck(), e, renderOpts())
    old.replaceWith(neu)
    return neu
  }

  // ---------- Overlay ----------
  function drawOverlay() {
    overlay.replaceChildren()
    const els = store.selected
    if (!els.length || app.presenting) return
    const box = (e, cls) => h('div', { class: ['ss-sel', cls], style: { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${e.h}px`, transform: e.rot ? `rotate(${e.rot}deg)` : null } })
    if (editing) { overlay.append(box(elemById(editing.id) || els[0], 'editing')); return }
    if (els.length > 1) {
      for (const e of els) overlay.append(box(e, 'multi'))
      const b = bboxOf(els)
      overlay.append(h('div', { class: 'ss-sel group', style: { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` } }))
      return
    }
    const e = els[0]
    if (e.type === 'line') {
      const pts = linePoints(e)
      overlay.append(h('div', { class: 'ss-sel line', style: { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${e.h}px` } }))
      pts.forEach(([x, y], i) => overlay.append(h('div', { class: 'ss-h pt', dataset: { h: `p${i}` }, style: { left: `${x}px`, top: `${y}px` } })))
      return
    }
    const sel = box(e)
    const small = Math.min(e.w, e.h) * zoom < 46
    for (const k of HANDLES) if (!(small && k.length === 1)) sel.append(h('div', { class: ['ss-h', k.length === 2 && 'corner'], dataset: { h: k } }))
    sel.append(h('div', { class: 'ss-h rot', dataset: { h: 'rot' } }, icon('rotate-cw')))
    overlay.append(sel)
  }
  api.drawOverlay = drawOverlay
  const guide = (v, x) => h('div', { class: ['ss-guide', v ? 'v' : 'hz'], style: v ? { left: `${x}px` } : { top: `${x}px` } })

  // ---------- Pointer gestures ----------
  const listen = (fnMove, fnUp) => {
    const mv = (e) => fnMove(e)
    const up = (e) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); fnUp(e) }
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    app.root.focus({ preventScroll: true })
    const hitEl = e.target.closest?.('.ss-el:not(.ss-decor)')
    const hitId = hitEl?.dataset.id
    const handle = e.target.closest?.('.ss-h')
    if (editing) {
      if (editing.node.contains(e.target)) return // native caret placement
      endEdit(true)
    }
    if (handle) return startHandle(e, handle.dataset.h)
    if (app.tool !== 'select') return startCreate(e)
    if (hitId) {
      const el = elemById(hitId)
      if (!el) return
      if (e.target.closest('.ss-imgph')) { e.preventDefault(); app.pickImage(hitId); return }
      const additive = e.shiftKey || e.ctrlKey || e.metaKey
      const wasSole = store.sel.length === 1 && store.sel[0] === hitId
      if (additive) store.select(store.sel.includes(hitId) ? store.sel.filter((x) => x !== hitId) : [...store.sel, hitId])
      else if (!store.sel.includes(hitId)) store.select([hitId])
      if (!store.sel.includes(hitId)) return
      startMove(e, wasSole && !additive && (isTextual(el) && el.type !== 'line'))
    } else {
      startMarquee(e)
    }
  })

  stage.addEventListener('dblclick', (e) => {
    if (editing || app.tool !== 'select') return
    // pointer capture retargets click events to the stage, so find the element under the pointer instead
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.ss-el:not(.ss-decor)')
    if (!hit) return
    const el = elemById(hit.dataset.id)
    if (!el) return
    if (el.type === 'image') return app.pickImage(el.id)
    store.select([el.id])
    startEdit(el.id, { x: e.clientX, y: e.clientY })
  })

  stage.addEventListener('contextmenu', (e) => {
    const hit = e.target.closest?.('.ss-el:not(.ss-decor)')
    if (hit && !store.sel.includes(hit.dataset.id)) store.select([hit.dataset.id])
    if (editing) return
    e.preventDefault()
    app.contextMenu(e.clientX, e.clientY, !!hit)
  })

  function startMove(e, maybeEdit) {
    const els = store.selected.filter((x) => !x.locked)
    if (!els.length) return
    const p0 = toSlide(e)
    g = { type: 'move', before: store.begin(), moved: false, ids: els.map((x) => x.id), orig: new Map(els.map((x) => [x.id, { x: x.x, y: x.y }])), bbox: bboxOf(els) }
    stage.setPointerCapture?.(e.pointerId)
    listen((ev) => {
      const p = toSlide(ev)
      let dx = p.x - p0.x, dy = p.y - p0.y
      if (!g.moved && Math.hypot(dx, dy) * zoom < 4) return
      g.moved = true
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      const snapped = snap(g.bbox, g.ids, dx, dy)
      dx = snapped.dx; dy = snapped.dy
      for (const id of g.ids) {
        const o = g.orig.get(id), el = elemById(id), n = nodeOf(id)
        el.x = o.x + dx; el.y = o.y + dy
        if (n) { n.style.left = `${el.x}px`; n.style.top = `${el.y}px` }
      }
      drawOverlay()
      for (const gd of snapped.guides) overlay.append(guide(gd.v, gd.at))
      app.bus.emit('geom')
    }, () => {
      const moved = g?.moved
      const before = g?.before
      g = null
      overlay.querySelectorAll('.ss-guide').forEach((n) => n.remove())
      if (moved) { for (const el of store.selected) { el.x = Math.round(el.x * 10) / 10; el.y = Math.round(el.y * 10) / 10 } store.end(before, 'Move', 'slide') }
      else if (maybeEdit) startEdit(store.sel[0])
    })
  }

  function snap(bbox, ids, dx, dy) {
    const thr = 6 / zoom, W = deck().w, H = deck().h
    const xs = [0, W / 2, W], ys = [0, H / 2, H]
    for (const o of slide().elements) if (!ids.includes(o.id)) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h) }
    const pick = (mine, lines) => {
      let best = null
      for (const m of mine) for (const l of lines) { const d = l - m; if (Math.abs(d) <= thr && (best === null || Math.abs(d) < Math.abs(best))) best = d }
      return best
    }
    const mx = [bbox.x + dx, bbox.x + bbox.w / 2 + dx, bbox.x + bbox.w + dx], my = [bbox.y + dy, bbox.y + bbox.h / 2 + dy, bbox.y + bbox.h + dy]
    const sx = pick(mx, xs), sy = pick(my, ys)
    if (sx !== null) dx += sx
    if (sy !== null) dy += sy
    const guides = []
    const fx = [bbox.x + dx, bbox.x + bbox.w / 2 + dx, bbox.x + bbox.w + dx], fy = [bbox.y + dy, bbox.y + bbox.h / 2 + dy, bbox.y + bbox.h + dy]
    for (const l of new Set(xs)) if (fx.some((m) => Math.abs(m - l) < 0.5)) guides.push({ v: true, at: l })
    for (const l of new Set(ys)) if (fy.some((m) => Math.abs(m - l) < 0.5)) guides.push({ v: false, at: l })
    return { dx, dy, guides }
  }

  function startHandle(e, which) {
    const el = store.selected[0]
    if (!el || store.selected.length !== 1) return
    e.preventDefault()
    const before = store.begin()
    stage.setPointerCapture?.(e.pointerId)
    if (which === 'rot') {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2
      listen((ev) => {
        const p = toSlide(ev)
        let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90
        a = ((a % 360) + 360) % 360
        if (ev.shiftKey) a = Math.round(a / 15) * 15
        else for (const k of [0, 90, 180, 270, 360]) if (Math.abs(a - k) < 3) a = k % 360
        el.rot = Math.round(a * 10) / 10
        const n = nodeOf(el.id)
        if (n) n.style.transform = el.rot ? `rotate(${el.rot}deg)` : ''
        drawOverlay()
        app.bus.emit('geom')
      }, () => store.end(before, 'Rotate', 'slide'))
      return
    }
    if (which === 'p0' || which === 'p1') {
      const i = which === 'p0' ? 0 : 1
      listen((ev) => {
        const p = toSlide(ev)
        const pts = linePoints(el)
        let [x, y] = [p.x, p.y]
        if (ev.shiftKey) { const o = pts[1 - i], dx = x - o[0], dy = y - o[1], a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), r = Math.hypot(dx, dy); x = o[0] + Math.cos(a) * r; y = o[1] + Math.sin(a) * r }
        pts[i] = [x, y]
        lineFromPoints(el, pts[0], pts[1])
        rerenderElement(el)
        drawOverlay()
        app.bus.emit('geom')
      }, () => store.end(before, 'Edit line', 'slide'))
      return
    }
    // resize in the element's own (rotated) frame so the opposite side stays put
    const o = { x: el.x, y: el.y, w: el.w, h: el.h }
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, rot = el.rot || 0
    const ratio = o.w / Math.max(1, o.h)
    const keep = el.type === 'image' && which.length === 2
    const p0 = toSlide(e)
    listen((ev) => {
      const p = toSlide(ev)
      const [lx, ly] = rotatePoint(p.x, p.y, p0.x, p0.y, -rot).map((v, i) => v - (i ? p0.y : p0.x))
      let w = o.w, hh = o.h
      if (which.includes('e')) w = o.w + lx
      if (which.includes('w')) w = o.w - lx
      if (which.includes('s')) hh = o.h + ly
      if (which.includes('n')) hh = o.h - ly
      w = Math.max(MIN, w); hh = Math.max(MIN, hh)
      if ((keep && !ev.altKey) || (which.length === 2 && ev.shiftKey)) {
        if (w / o.w > hh / o.h) hh = w / ratio; else w = hh * ratio
      }
      const sx = which.includes('e') ? 1 : which.includes('w') ? -1 : 0, sy = which.includes('s') ? 1 : which.includes('n') ? -1 : 0
      const [ncx, ncy] = rotatePoint(cx + (sx * (w - o.w)) / 2, cy + (sy * (hh - o.h)) / 2, cx, cy, rot)
      el.w = Math.round(w * 10) / 10; el.h = Math.round(hh * 10) / 10
      el.x = Math.round((ncx - el.w / 2) * 10) / 10; el.y = Math.round((ncy - el.h / 2) * 10) / 10
      if (el.type === 'text') el.tx.auto = false
      if (el.type === 'table') el.h = Math.max(el.h, el.cells.length * 24)
      rerenderElement(el)
      drawOverlay()
      app.bus.emit('geom')
    }, () => store.end(before, 'Resize', 'slide'))
  }

  function startMarquee(e) {
    const p0 = toSlide(e)
    const base = e.shiftKey ? [...store.sel] : []
    if (!e.shiftKey) store.select([])
    const rect = h('div', { class: 'ss-marquee' })
    overlay.append(rect)
    g = { type: 'marquee' }
    listen((ev) => {
      const p = toSlide(ev)
      const x = Math.min(p.x, p0.x), y = Math.min(p.y, p0.y), w = Math.abs(p.x - p0.x), hh = Math.abs(p.y - p0.y)
      Object.assign(rect.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` })
      if (w * zoom < 3 && hh * zoom < 3) return
      const ids = slide().elements.filter((el) => el.x < x + w && el.x + el.w > x && el.y < y + hh && el.y + el.h > y).map((el) => el.id)
      store.select([...new Set([...base, ...ids])])
      rect.remove(); overlay.append(rect)
    }, () => { g = null; rect.remove() })
  }

  function startCreate(e) {
    const p0 = toSlide(e)
    const tool = app.tool
    const draw = h('div', { class: ['ss-draw', tool === 'shape' && app.shapeKind === 'ellipse' && 'round'] })
    overlay.replaceChildren(draw)
    let box = null
    g = { type: 'create' }
    stage.setPointerCapture?.(e.pointerId)
    listen((ev) => {
      const p = toSlide(ev)
      let x1 = p0.x, y1 = p0.y, x2 = p.x, y2 = p.y
      if (ev.shiftKey && tool !== 'text') {
        if (tool === 'line') { const a = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 12)) * (Math.PI / 12), r = Math.hypot(x2 - x1, y2 - y1); x2 = x1 + Math.cos(a) * r; y2 = y1 + Math.sin(a) * r } else { const s = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)); x2 = x1 + Math.sign(x2 - x1 || 1) * s; y2 = y1 + Math.sign(y2 - y1 || 1) * s }
      }
      box = { x1, y1, x2, y2 }
      if (tool === 'line') {
        Object.assign(draw.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` })
        draw.classList.add('line')
      } else Object.assign(draw.style, { left: `${Math.min(x1, x2)}px`, top: `${Math.min(y1, y2)}px`, width: `${Math.abs(x2 - x1)}px`, height: `${Math.abs(y2 - y1)}px` })
    }, () => {
      g = null
      const b = box || { x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y }
      const x = Math.min(b.x1, b.x2), y = Math.min(b.y1, b.y2), w = Math.abs(b.x2 - b.x1), hh = Math.abs(b.y2 - b.y1)
      const tiny = w < 8 && hh < 8
      let el
      if (tool === 'text') el = textEl(tiny ? { x: p0.x, y: p0.y - 20, w: 360, h: 48 } : { x, y, w: Math.max(w, 60), h: Math.max(hh, 36) })
      else if (tool === 'shape') el = shapeEl(app.shapeKind, tiny ? { x: p0.x - 110, y: p0.y - 70 } : { x, y, w: Math.max(w, 12), h: Math.max(hh, 12) })
      else el = lineEl(tiny ? { x: p0.x, y: p0.y, w: 240, h: 0 } : { x, y, w, h: hh, fh: b.x1 > b.x2, fv: b.y1 > b.y2 })
      if (tool === 'text') el.tx.auto = true
      el.x = clamp(el.x, -el.w + 20, deck().w - 20); el.y = clamp(el.y, -el.h + 20, deck().h - 20)
      app.setTool('select')
      app.addElement(el, tool === 'text' ? 'Add text box' : tool === 'shape' ? 'Add shape' : 'Add line')
      if (tool === 'text') startEdit(el.id)
    })
  }

  // ---------- Text editing ----------
  function caretAt(x, y) {
    let r = null
    if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true) } }
    else if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y)
    return r
  }
  function startEdit(id, pt) {
    const e = elemById(id)
    if (!e || app.presenting) return
    if (editing) endEdit(true)
    const node = nodeOf(id)
    if (!node) return
    store.select([id])
    if (e.type === 'table') return startTableEdit(e, node, pt)
    if (!isTextual(e) || !e.tx) return
    const tc = node.querySelector('.ss-tc')
    if (!tc) return
    for (const p of tc.querySelectorAll('.ss-p[data-hint]')) { p.removeAttribute('data-hint'); if (!p.firstChild) p.append(document.createElement('br')) }
    tc.contentEditable = 'true'
    tc.spellcheck = true
    node.classList.add('editing')
    editing = { id, kind: 'text', tc, node, before: store.begin(), range: null }
    tc.focus({ preventScroll: true })
    const sel = getSelection()
    let r = pt ? caretAt(pt.x, pt.y) : null
    if (!r || !tc.contains(r.startContainer)) {
      r = document.createRange()
      const last = tc.lastElementChild || tc
      const onlyBr = last.childNodes.length === 1 && last.firstChild.nodeName === 'BR'
      r.selectNodeContents(last)
      if (onlyBr) r.setStart(last, 0)
      r.collapse(onlyBr)
    }
    sel.removeAllRanges(); sel.addRange(r)
    editing.range = r.cloneRange()
    document.execCommand('styleWithCSS', false, true)
    tc.addEventListener('input', onInput)
    tc.addEventListener('keydown', onEditKey)
    tc.addEventListener('paste', onPastePlain)
    tc.addEventListener('focusout', onFocusOut)
    document.addEventListener('selectionchange', onSelChange)
    drawOverlay()
    app.bus.emit('edit')
  }
  function startTableEdit(e, node, pt) {
    const tbl = node.querySelector('table')
    const cells = [...tbl.querySelectorAll('td')]
    cells.forEach((c) => { c.contentEditable = 'true'; c.spellcheck = true })
    node.classList.add('editing')
    editing = { id: e.id, kind: 'table', tc: tbl, node, before: store.begin(), range: null }
    let target = pt && document.elementFromPoint(pt.x, pt.y)?.closest?.('td')
    target ||= cells[0]
    target.focus({ preventScroll: true })
    const r = caretAt(pt?.x ?? 0, pt?.y ?? 0)
    const sel = getSelection()
    if (r && target.contains(r.startContainer) && pt) { sel.removeAllRanges(); sel.addRange(r) } else { const rg = document.createRange(); rg.selectNodeContents(target); sel.removeAllRanges(); sel.addRange(rg) }
    tbl.addEventListener('keydown', onTableKey)
    tbl.addEventListener('paste', onPastePlain)
    tbl.addEventListener('focusout', onFocusOut)
    drawOverlay()
    app.bus.emit('edit')
  }
  function onInput() {
    const e = elemById(editing.id)
    if (e.type === 'text' && e.tx.auto) {
      const hh = Math.max(24, Math.round(editing.tc.offsetHeight + (e.tx.pad ?? 8) * 2))
      if (Math.abs(hh - e.h) > 0.5) { e.h = hh; editing.node.style.height = `${hh}px`; drawOverlay() }
    }
    app.bus.emit('geom')
  }
  function onSelChange() {
    if (!editing || editing.kind !== 'text') return
    const s = getSelection()
    if (s.rangeCount && editing.tc.contains(s.anchorNode)) { editing.range = s.getRangeAt(0).cloneRange(); app.bus.emit('fmt') }
  }
  function onFocusOut(ev) {
    const to = ev.relatedTarget
    if (!to) return // clicking toolbar buttons never moves focus; window blur keeps the edit open
    if (editing?.node.contains(to) || to.closest?.('.ss-ribbon, .ss-pop')) return
    endEdit(true)
  }
  function onEditKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); endEdit(true); return }
    if (ev.key === 'Tab') {
      ev.preventDefault()
      app.format.indent(ev.shiftKey ? -1 : 1)
      return
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'b') { ev.preventDefault(); app.format.toggle('b') }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'i') { ev.preventDefault(); app.format.toggle('i') }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'u') { ev.preventDefault(); app.format.toggle('u') }
  }
  function onTableKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); endEdit(true); return }
    if (ev.key === 'Tab') {
      ev.preventDefault()
      const cells = [...editing.tc.querySelectorAll('td')], i = cells.indexOf(ev.target.closest('td'))
      const next = cells[i + (ev.shiftKey ? -1 : 1)]
      if (next) { next.focus(); const r = document.createRange(); r.selectNodeContents(next); getSelection().removeAllRanges(); getSelection().addRange(r) }
    }
  }
  function onPastePlain(ev) {
    ev.preventDefault()
    const t = ev.clipboardData?.getData('text/plain') || ''
    if (t) document.execCommand('insertText', false, t)
  }
  function cleanupEdit() {
    const ed = editing
    editing = null
    ed.tc.removeEventListener('input', onInput)
    ed.tc.removeEventListener('keydown', onEditKey)
    ed.tc.removeEventListener('keydown', onTableKey)
    ed.tc.removeEventListener('paste', onPastePlain)
    ed.tc.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('selectionchange', onSelChange)
    getSelection()?.removeAllRanges()
    return ed
  }
  function discardEdit() { cleanupEdit() }
  /** Leave text editing; commit writes the typed text into the model as one undo step. */
  function endEdit(commit = true) {
    if (!editing) return
    const ed = cleanupEdit()
    const e = elemById(ed.id)
    if (commit && e) {
      if (ed.kind === 'table') {
        const tbl = ed.tc
        e.cells = [...tbl.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\n+$/, '')))
        e.h = Math.max(e.h, Math.round(tbl.offsetHeight))
      } else {
        e.tx.paras = parseParas(ed.tc, deck(), e.tx)
        if (e.type === 'text' && e.tx.auto) e.h = Math.max(24, Math.round(ed.tc.offsetHeight + (e.tx.pad ?? 8) * 2))
        if (e.type === 'text' && !e.ph && isEmptyEl(e)) slide().elements = slide().elements.filter((x) => x.id !== e.id)
      }
      store.end(ed.before, ed.kind === 'table' ? 'Edit table' : 'Edit text', 'slide')
    }
    api.render()
    app.bus.emit('edit')
  }
  api.startEdit = startEdit
  api.afterEdit = () => { if (editing?.kind === 'text') onInput() }
  api.endEdit = endEdit
  api.nodeOf = nodeOf
  api.rerenderElement = rerenderElement
  api.toSlide = toSlide
  api.insertSize = (w, h2) => { const k = Math.min(1, (deck().w * 0.7) / w, (deck().h * 0.7) / h2); return { w: Math.round(w * k), h: Math.round(h2 * k) } }

  // ---------- Store events ----------
  const off = store.on((type, d) => {
    if (type === 'change' || type === 'slide') api.render()
    else if (type === 'sel') { if (editing && !store.sel.includes(editing.id)) endEdit(true); drawOverlay() }
  })
  api.dispose = () => { off(); ro.disconnect(); if (editing) discardEdit() }
  return api
}

