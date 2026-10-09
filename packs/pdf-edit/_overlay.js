// Page stage: a rendered PDF page with an overlay layer, plus draggable / resizable boxes (signatures, crop box, redactions, text).
// All positions are in displayed PDF points (origin top-left, rotation applied) so they survive resizing.
import { h, icon, button, input, clear, onCleanup } from '../../lib/ui.js'
import { renderPage } from '../../lib/pdf.js'
import { css, ensureStyles, clamp } from './_shared.js'

const CSS = `
.pe-stage { position: relative; width: 100%; max-width: var(--pe-stage-w, 680px); margin: 0 auto; border-radius: 4px; background: #fff; touch-action: pan-y;
  box-shadow: 0 24px 60px -28px rgba(16, 16, 40, .55), 0 0 0 1px var(--border); }
.pe-stage > canvas { display: block; width: 100%; height: auto; border-radius: 4px; animation: pe-pop .3s var(--ease) both; }
.pe-stage.is-loading::after { content: ""; position: absolute; inset: 0; border-radius: 4px; pointer-events: none; background: linear-gradient(100deg, transparent 20%, rgba(180, 180, 200, .25) 50%, transparent 80%) 0 0 / 200% 100%; animation: pe-shimmer 1.2s linear infinite; }
.pe-layer { position: absolute; inset: 0; overflow: hidden; border-radius: 4px; }
.pe-layer.pe-dim { cursor: crosshair; }
.pe-box { position: absolute; touch-action: none; cursor: move; outline: none; user-select: none; -webkit-user-select: none; box-sizing: border-box; }
.pe-box:focus-visible, .pe-box.is-active { outline: 2px solid var(--accent); outline-offset: 1px; }
.pe-box.is-active { box-shadow: 0 0 0 4px var(--ring); }
.pe-box > .pe-fill { position: absolute; inset: 0; display: block; pointer-events: none; }
.pe-box > .pe-fill > img, .pe-box > .pe-fill > canvas, .pe-box > .pe-fill > svg { width: 100%; height: 100%; display: block; object-fit: fill; }
.pe-hd { position: absolute; width: 30px; height: 30px; z-index: 3; touch-action: none; display: none; }
.pe-hd::after { content: ""; position: absolute; left: 50%; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 4px; background: #fff; border: 2px solid var(--accent); box-shadow: 0 2px 6px rgba(16, 16, 40, .3); }
.pe-box:focus .pe-hd, .pe-box.is-active .pe-hd { display: block; }
.pe-hd[data-h="nw"] { left: -15px; top: -15px; cursor: nwse-resize; } .pe-hd[data-h="ne"] { right: -15px; top: -15px; cursor: nesw-resize; }
.pe-hd[data-h="sw"] { left: -15px; bottom: -15px; cursor: nesw-resize; } .pe-hd[data-h="se"] { right: -15px; bottom: -15px; cursor: nwse-resize; }
.pe-hd[data-h="n"] { left: 50%; top: -15px; margin-left: -15px; cursor: ns-resize; } .pe-hd[data-h="s"] { left: 50%; bottom: -15px; margin-left: -15px; cursor: ns-resize; }
.pe-hd[data-h="w"] { top: 50%; left: -15px; margin-top: -15px; cursor: ew-resize; } .pe-hd[data-h="e"] { top: 50%; right: -15px; margin-top: -15px; cursor: ew-resize; }
.pe-del { position: absolute; z-index: 4; right: -14px; top: -40px; width: 34px; height: 34px; border-radius: 99px; border: 0; display: none; place-items: center; cursor: pointer; color: #fff; background: var(--danger); box-shadow: 0 6px 14px -4px var(--danger); }
.pe-del .icon { width: 14px; height: 14px; }
.pe-box:focus .pe-del, .pe-box.is-active .pe-del { display: grid; }
.pe-nav { display: inline-flex; align-items: center; gap: 6px; padding: 4px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); }
.pe-nav .input { width: 64px; height: 34px; text-align: center; padding: 0 6px; border-radius: 10px; }
.pe-nav span { font-size: 13px; color: var(--muted); padding-right: 6px; white-space: nowrap; }
`

/**
 * createStage({pdf, maxWidth}) -> {el, layer, show(n), page, pw, ph, scale, onRender(fn)}
 * pw / ph are the displayed page size in points; scale is CSS px per point (updates when the container resizes).
 */
export function createStage({ pdf, maxWidth = 680 }) {
  ensureStyles()
  css('pe-overlay', CSS)
  const layer = h('div', { class: 'pe-layer' })
  const el = h('div', { class: 'pe-stage', style: { '--pe-stage-w': `${maxWidth}px` } }, layer)
  const stage = { el, layer, pdf, page: 0, pw: 612, ph: 792, scale: 1, canvas: null }
  const listeners = new Set()
  let token = 0, renderedW = 0
  stage.onRender = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
  const measure = () => { stage.scale = (el.clientWidth || maxWidth) / stage.pw }
  async function draw(n, force) {
    const mine = ++token
    const pg = await pdf.getPage(n)
    const vp = pg.getViewport({ scale: 1 })
    stage.pw = vp.width; stage.ph = vp.height; stage.page = n
    el.style.aspectRatio = `${vp.width} / ${vp.height}`
    measure()
    const cssW = el.clientWidth || maxWidth
    if (!force && cssW <= renderedW && stage.canvas) { for (const f of listeners) f(stage); return }
    el.classList.add('is-loading')
    const c = await renderPage(pdf, n, { scale: stage.scale * Math.min(2, window.devicePixelRatio || 1) })
    if (mine !== token) return
    renderedW = cssW
    stage.canvas?.remove()
    stage.canvas = c
    el.prepend(c)
    el.classList.remove('is-loading')
    for (const f of listeners) f(stage)
  }
  stage.show = (n) => draw(n, true)
  if (typeof ResizeObserver !== 'undefined') {
    let last = 0
    const ro = new ResizeObserver(() => { const w = el.clientWidth; if (w && Math.abs(w - last) > 1 && stage.page) { last = w; draw(stage.page, false) } })
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  }
  return stage
}

/** Page navigator: prev / number / next. onGo(n) is called with a valid 1-based page. Returns el with .set(n). */
export function pageNav(total, onGo, start = 1) {
  ensureStyles()
  css('pe-overlay', CSS)
  let cur = start
  const box = input({ type: 'number', value: cur, min: 1, max: total, 'aria-label': 'Page number', onchange: () => go(box.valueAsNumber) })
  const prev = button('', { icon: 'chevron-left', variant: 'ghost', size: 'sm', ariaLabel: 'Previous page', onClick: () => go(cur - 1) })
  const next = button('', { icon: 'chevron-right', variant: 'ghost', size: 'sm', ariaLabel: 'Next page', onClick: () => go(cur + 1) })
  const el = h('div', { class: 'pe-nav' }, prev, box, h('span', `of ${total}`), next)
  function go(n) {
    if (!Number.isFinite(n)) { box.value = cur; return }
    n = clamp(Math.round(n), 1, total)
    if (n !== cur) { cur = n; onGo(n) }
    box.value = cur
    prev.disabled = cur <= 1
    next.disabled = cur >= total
  }
  el.set = (n) => { cur = n; box.value = n; prev.disabled = n <= 1; next.disabled = n >= total }
  el.set(start)
  return el
}

/**
 * movable(stage, {x, y, w, h, aspect, min, handles, content, remove, onChange, className}) -> {el, rect(), set(rect), layout(), destroy()}
 * Drag to move, drag handles to resize (corners keep `aspect` when given), arrow keys nudge (Shift = 10), Delete removes.
 */
export function movable(stage, o) {
  const { aspect: aspectOpt = null, min = 12, handles = 'corners', content, onChange, onRemove, onSelect, className = '', label = 'Box' } = o
  let r = { x: o.x, y: o.y, w: o.w, h: o.h }
  const aspectNow = () => (typeof aspectOpt === 'function' ? aspectOpt() : aspectOpt)
  const fill = h('span', { class: 'pe-fill' }, content || null)
  const hs = (handles === 'all' ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] : handles === 'none' ? [] : ['nw', 'ne', 'se', 'sw']).map((k) => h('span', { class: 'pe-hd', 'data-h': k }))
  const del = onRemove ? h('button', { type: 'button', class: 'pe-del', 'aria-label': `Remove ${label.toLowerCase()}`, onclick: (e) => { e.stopPropagation(); onRemove() } }, icon('trash-2')) : null
  const el = h('div', { class: ['pe-box', className], tabindex: 0, role: 'group', 'aria-label': `${label}. Drag to move, arrow keys to nudge.`, onpointerdown, onkeydown }, fill, ...hs, del)
  const bounds = () => ({ w: stage.pw, h: stage.ph })
  function layout() {
    const k = stage.scale
    Object.assign(el.style, { left: `${r.x * k}px`, top: `${r.y * k}px`, width: `${r.w * k}px`, height: `${r.h * k}px` })
  }
  function constrain(next) {
    const b = bounds()
    next.w = clamp(next.w, min, b.w); next.h = clamp(next.h, min, b.h)
    next.x = clamp(next.x, 0, b.w - next.w); next.y = clamp(next.y, 0, b.h - next.h)
    return next
  }
  function onpointerdown(e) {
    if (e.button !== 0 || e.target.closest('.pe-del')) return
    e.preventDefault(); e.stopPropagation()
    for (const b of stage.layer.querySelectorAll('.pe-box.is-active')) b.classList.remove('is-active')
    el.classList.add('is-active')
    el.focus({ preventScroll: true })
    onSelect?.(api)
    const handle = e.target.closest('.pe-hd')?.dataset.h
    const start = { px: e.clientX, py: e.clientY, r: { ...r } }
    el.setPointerCapture(e.pointerId)
    const move = (ev) => {
      const k = stage.scale
      const dx = (ev.clientX - start.px) / k, dy = (ev.clientY - start.py) / k
      let n = { ...start.r }
      if (!handle) { n.x += dx; n.y += dy }
      else {
        if (handle.includes('e')) n.w = start.r.w + dx
        if (handle.includes('s')) n.h = start.r.h + dy
        if (handle.includes('w')) { n.w = start.r.w - dx; n.x = start.r.x + dx }
        if (handle.includes('n')) { n.h = start.r.h - dy; n.y = start.r.y + dy }
        if (aspectNow() && handle.length === 2) {
          n.h = n.w / aspectNow()
          if (handle.includes('n')) n.y = start.r.y + start.r.h - n.h
        }
        if (n.w < min) { if (handle.includes('w')) n.x -= min - n.w; n.w = min }
        if (n.h < min) { if (handle.includes('n')) n.y -= min - n.h; n.h = min }
      }
      r = constrain(n)
      layout()
    }
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); onChange?.(api) }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  function onkeydown(e) {
    const step = e.shiftKey ? 10 : 1
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (d) { e.preventDefault(); r = constrain({ ...r, x: r.x + d[0], y: r.y + d[1] }); layout(); onChange?.(api) }
    else if ((e.key === '+' || e.key === '=' || e.key === '-') && !e.ctrlKey) {
      e.preventDefault()
      const f = e.key === '-' ? 0.92 : 1.08
      const w = r.w * f, hh = aspectNow() ? w / aspectNow() : r.h * f
      r = constrain({ x: r.x - (w - r.w) / 2, y: r.y - (hh - r.h) / 2, w, h: hh }); layout(); onChange?.(api)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && onRemove) { e.preventDefault(); onRemove() }
  }
  const api = {
    el,
    rect: () => ({ ...r }),
    set(next) { r = constrain({ ...r, ...next }); layout(); onChange?.(api) },
    setContent(node) { clear(fill, node) },
    layout,
    destroy() { off(); el.remove() },
  }
  const off = stage.onRender(layout)
  stage.layer.append(el)
  layout()
  return api
}

/** Click on empty space in the layer deselects boxes. */
export function clickAwayDeselect(stage) {
  stage.layer.addEventListener('pointerdown', (e) => { if (e.target === stage.layer) for (const b of stage.layer.querySelectorAll('.pe-box.is-active')) b.classList.remove('is-active') })
}
