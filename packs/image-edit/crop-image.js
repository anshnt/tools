// Crop image: drag, resize and nudge a crop box (mouse, touch, keyboard), lock a ratio or type exact numbers.
import { number } from '../../lib/ui.js'
import { canvas } from '../../lib/image.js'
import {
  displayURL, shell, h, icon, button, busy, field, chips, section, note, hint, imageSlot, outputPicker, encodeWith, outName, objURL, revokeURL, clear, download,
  formatBytes, stage,
} from './_kit.js'

const RATIOS = [['free', 'Free'], ['orig', 'Original'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:4', '3:4'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['9:16', '9:16'], ['35:45', 'Passport 35x45']]
const MIN = 8

export const parseRatio = (id, iw, ih) => (id === 'free' ? null : id === 'orig' ? iw / ih : (([a, b]) => a / b)(id.split(':').map(Number)))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Largest box with `ratio` that fits inside `box`, centered on it. */
export function fitRatio(box, ratio, iw, ih) {
  let w = box.w, hh = box.h
  if (w / hh > ratio) w = hh * ratio; else hh = w / ratio
  w = Math.max(MIN, Math.min(w, iw)); hh = Math.max(MIN, Math.min(hh, ih))
  return { x: clamp(box.x + (box.w - w) / 2, 0, iw - w), y: clamp(box.y + (box.h - hh) / 2, 0, ih - hh), w, h: hh }
}

/** New crop box after dragging `handle` (n, s, e, w, ne, nw, se, sw, or move) by (dx, dy) image pixels. ratio is w/h or null. */
export function dragBox(start, handle, dx, dy, ratio, iw, ih) {
  if (handle === 'move') return { ...start, x: clamp(start.x + dx, 0, iw - start.w), y: clamp(start.y + dy, 0, ih - start.h) }
  const west = handle.includes('w'), east = handle.includes('e'), north = handle.includes('n'), south = handle.includes('s')
  let l = start.x, t = start.y, r = start.x + start.w, b = start.y + start.h
  if (west) l = clamp(start.x + dx, 0, r - MIN)
  if (east) r = clamp(start.x + start.w + dx, l + MIN, iw)
  if (north) t = clamp(start.y + dy, 0, b - MIN)
  if (south) b = clamp(start.y + start.h + dy, t + MIN, ih)
  if (!ratio) return { x: l, y: t, w: r - l, h: b - t }
  const corner = (west || east) && (north || south)
  if (corner) {
    const ax = west ? r : l, ay = north ? b : t // fixed corner
    const px = west ? l : r, py = north ? t : b // dragged corner
    let w = Math.abs(px - ax), hh = Math.abs(py - ay)
    if (w / hh > ratio) hh = w / ratio; else w = hh * ratio
    const maxW = west ? ax : iw - ax, maxH = north ? ay : ih - ay
    if (w > maxW) { w = maxW; hh = w / ratio }
    if (hh > maxH) { hh = maxH; w = hh * ratio }
    w = Math.max(w, MIN); hh = Math.max(hh, MIN / ratio)
    return { x: west ? ax - w : ax, y: north ? ay - hh : ay, w, h: hh }
  }
  if (west || east) {
    let w = r - l
    const cy = start.y + start.h / 2
    const maxH = 2 * Math.min(cy, ih - cy)
    let hh = w / ratio
    if (hh > maxH) { hh = maxH; w = hh * ratio }
    const x = west ? r - w : l
    return { x, y: cy - hh / 2, w, h: hh }
  }
  let hh = b - t
  const cx = start.x + start.w / 2
  const maxW = 2 * Math.min(cx, iw - cx)
  let w = hh * ratio
  if (w > maxW) { w = maxW; hh = w / ratio }
  const y = north ? b - hh : t
  return { x: cx - w / 2, y, w, h: hh }
}

export function mount(root) {
  let src = null, imgUrl = null
  const st = { box: { x: 0, y: 0, w: 1, h: 1 }, ratio: 'free', portrait: false }
  const img = h('img', { alt: 'Image to crop', draggable: false })
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => h('i', { class: `ie-h ie-h-${d}`, 'data-h': d }))
  const box = h('div', { class: 'ie-cropbox', tabindex: 0, role: 'group', 'aria-label': 'Crop area. Drag to move, use arrow keys to nudge, plus and minus to resize.', 'data-h': 'move' }, h('span', { class: 'ie-grid' }), handles)
  const badge = h('div', { class: 'ie-cropdims' })
  const dim = h('div', { class: 'ie-dim' })
  const wrap = h('div', { class: 'ie-cropwrap' }, img, h('div', { class: 'ie-clip' }, dim), box, badge)
  const stg = h('div', { class: 'ie-stage bare ie-cropstage' }, wrap)
  const preview = h('div', { class: 'ie-croppreview' })

  const num = (label, key) => {
    const el = number('', { min: 0, step: 1, ariaLabel: label, onInput: (v) => { if (Number.isFinite(v)) setField(key, Math.round(v)) } })
    return el
  }
  const nx = num('X position in pixels', 'x'), ny = num('Y position in pixels', 'y'), nw = num('Width in pixels', 'w'), nh = num('Height in pixels', 'h')
  const ratioChips = chips(RATIOS, 'free', (v) => { st.ratio = v; applyRatio() }, { label: 'Aspect ratio' })
  const swap = button('Swap portrait / landscape', { icon: 'rotate-cw', size: 'sm', onClick: () => { st.portrait = !st.portrait; applyRatio() } })
  const out = outputPicker({ formats: ['png', 'jpg', 'webp'], value: 'same' })

  const curRatio = () => {
    if (!src) return null
    let r = parseRatio(st.ratio, src.w, src.h)
    if (r && st.portrait && st.ratio !== 'orig') r = 1 / r
    return r
  }
  function setBox(b, fromInputs) {
    const iw = src.w, ih = src.h
    const w = clamp(b.w, 1, iw), hh = clamp(b.h, 1, ih)
    st.box = { x: clamp(b.x, 0, iw - w), y: clamp(b.y, 0, ih - hh), w, h: hh }
    paint(fromInputs)
  }
  function applyRatio() {
    if (!src) return
    const r = curRatio()
    if (r) setBox(fitRatio(st.box, r, src.w, src.h)); else paint()
    swap.hidden = !r || st.ratio === 'orig' || r === 1
  }
  function setField(key, v) {
    const b = { ...st.box }
    const r = curRatio()
    b[key] = v
    if (r && key === 'w') b.h = b.w / r
    else if (r && key === 'h') b.w = b.h * r
    if (r) { const fit = fitRatio({ ...b }, r, src.w, src.h); if (key === 'x' || key === 'y') { b.w = st.box.w; b.h = st.box.h } else { b.w = fit.w; b.h = fit.h } }
    setBox(b, true)
  }
  let raf = 0
  function paint(fromInputs) {
    const { x, y, w, h: hh } = st.box
    for (const el of [box, dim]) {
      el.style.left = `${(x / src.w) * 100}%`; el.style.top = `${(y / src.h) * 100}%`
      el.style.width = `${(w / src.w) * 100}%`; el.style.height = `${(hh / src.h) * 100}%`
    }
    badge.textContent = `${Math.round(w)} x ${Math.round(hh)}`
    if (!fromInputs) { nx.value = Math.round(x); ny.value = Math.round(y); nw.value = Math.round(w); nh.value = Math.round(hh) }
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(drawPreview)
  }
  function drawPreview() {
    if (!src) return
    const { x, y, w, h: hh } = st.box
    const k = Math.min(1, 240 / Math.max(w, hh))
    const c = canvas(Math.max(1, w * k), Math.max(1, hh * k))
    c.getContext('2d').drawImage(src.img, x, y, w, hh, 0, 0, c.width, c.height)
    c.setAttribute('aria-label', 'Crop preview')
    clear(preview, c, h('div', { class: 'ie-note' }, `${Math.round(w)} x ${Math.round(hh)} px · ${((w * hh) / 1e6).toFixed(2)} MP`))
  }

  // ----- pointer handling
  let drag = null
  stg.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('[data-h]')
    if (!target || !src) return
    e.preventDefault()
    const rect = wrap.getBoundingClientRect()
    drag = { handle: target.dataset.h, x: e.clientX, y: e.clientY, start: { ...st.box }, kx: src.w / rect.width, ky: src.h / rect.height, id: e.pointerId }
    target.setPointerCapture?.(e.pointerId)
    wrap.classList.add('active')
  })
  stg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    setBox(dragBox(drag.start, drag.handle, (e.clientX - drag.x) * drag.kx, (e.clientY - drag.y) * drag.ky, curRatio(), src.w, src.h))
  })
  const end = () => { drag = null; wrap.classList.remove('active') }
  stg.addEventListener('pointerup', end); stg.addEventListener('pointercancel', end)
  box.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (d) { e.preventDefault(); setBox(dragBox(st.box, 'move', d[0], d[1], null, src.w, src.h)) }
    else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault()
      const f = e.key === '-' ? 0.95 : 1.05
      const w = st.box.w * f, hh = st.box.h * f
      setBox({ x: st.box.x + (st.box.w - w) / 2, y: st.box.y + (st.box.h - hh) / 2, w, h: hh })
    }
  })

  // ----- output
  const goBtn = button('Crop image', { icon: 'crop', variant: 'primary', size: 'lg', block: true })
  const result = h('div')
  let resUrl = null
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const { x, y, w, h: hh } = st.box
    const cw = Math.round(w), ch = Math.round(hh)
    const c = canvas(cw, ch)
    c.getContext('2d').drawImage(src.img, Math.round(x), Math.round(y), cw, ch, 0, 0, cw, ch)
    const pick = out.resolve(src)
    const blob = await encodeWith(c, pick)
    const name = outName(src.name, `crop-${cw}x${ch}`, pick.fmt)
    if (resUrl) revokeURL(resUrl)
    resUrl = objURL(blob)
    clear(result, h('div', { class: 'panel ie-glass stack' },
      h('div', { class: 'row' }, h('img', { src: resUrl, alt: 'Cropped result', style: 'max-height:120px;max-width:200px;border-radius:12px;background:var(--checker)' }),
        h('div', { class: 'grow' }, h('strong', name), h('div', { class: 'ie-note' }, `${cw} x ${ch} px · ${formatBytes(blob.size)}`))),
      button('Download', { icon: 'download', variant: 'primary', onClick: () => download(blob, name) })))
    download(blob, name)
  }, { label: 'Cropping' }))

  const slot = imageSlot({
    ic: 'crop',
    onImage: async (s) => {
      src = s
      if (imgUrl) revokeURL(imgUrl)
      imgUrl = await displayURL(s)
      img.src = imgUrl
      try { await img.decode() } catch { /* the preview still shows once loaded */ }
      st.ratio = 'free'; st.portrait = false; ratioChips.set('free')
      const m = Math.round(Math.min(s.w, s.h) * 0.1)
      st.box = { x: m, y: m, w: s.w - 2 * m, h: s.h - 2 * m }
      work.hidden = false
      clear(result)
      swap.hidden = true
      paint()
    },
    onClear: () => { src = null; work.hidden = true },
  })

  const style = h('style', `
.ie-cropstage { padding: 14px; background: var(--surface-2); }
.ie-cropwrap { position: relative; display: inline-block; line-height: 0; max-width: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
.ie-cropwrap > img { display: block; max-width: 100%; max-height: min(68vh, calc(100vh - var(--header-h) - 190px)); width: auto; height: auto; background: var(--checker); pointer-events: none; border-radius: 10px; }
.ie-clip { position: absolute; inset: 0; overflow: hidden; border-radius: 10px; pointer-events: none; }
.ie-dim { position: absolute; box-shadow: 0 0 0 9999px rgba(8, 8, 20, .58); transition: box-shadow .2s; }
.ie-cropwrap.active .ie-dim { box-shadow: 0 0 0 9999px rgba(8, 8, 20, .7); }
.ie-cropbox { position: absolute; cursor: move; outline: 2px solid #fff; outline-offset: -1px; touch-action: none; }
.ie-cropbox:focus-visible { outline: 3px solid var(--accent); }
.ie-grid { position: absolute; inset: 0; pointer-events: none; opacity: .75; background:
  linear-gradient(#fff, #fff) 33.33% 0 / 1px 100% no-repeat, linear-gradient(#fff, #fff) 66.66% 0 / 1px 100% no-repeat,
  linear-gradient(#fff, #fff) 0 33.33% / 100% 1px no-repeat, linear-gradient(#fff, #fff) 0 66.66% / 100% 1px no-repeat; mix-blend-mode: difference; }
.ie-h { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; background: #fff; border: 2px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,.4); touch-action: none; }
.ie-h::before { content: ""; position: absolute; inset: -12px; }
.ie-h-nw { left: 0; top: 0; cursor: nwse-resize; } .ie-h-n { left: 50%; top: 0; cursor: ns-resize; } .ie-h-ne { left: 100%; top: 0; cursor: nesw-resize; }
.ie-h-e { left: 100%; top: 50%; cursor: ew-resize; } .ie-h-se { left: 100%; top: 100%; cursor: nwse-resize; } .ie-h-s { left: 50%; top: 100%; cursor: ns-resize; }
.ie-h-sw { left: 0; top: 100%; cursor: nesw-resize; } .ie-h-w { left: 0; top: 50%; cursor: ew-resize; }
.ie-cropdims { position: absolute; left: 10px; bottom: 10px; padding: 4px 10px; border-radius: 999px; font: 600 12px/1.4 var(--mono); color: #fff; background: rgba(12,12,24,.6); backdrop-filter: blur(6px); pointer-events: none; line-height: 1.4; }
.ie-croppreview { display: flex; flex-direction: column; gap: 8px; align-items: center; padding: 12px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--border); }
.ie-croppreview canvas { max-width: 100%; max-height: 180px; border-radius: 8px; background: var(--checker); box-shadow: var(--shadow); }
@media (pointer: coarse) { .ie-h { width: 24px; height: 24px; margin: -12px 0 0 -12px; } }
`)
  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Shape', 'ratio', ratioChips, swap),
    section('Exact values (pixels)', 'ruler', h('div', { class: 'ie-row2' }, field('Left (X)', nx), field('Top (Y)', ny), field('Width', nw), field('Height', nh))),
    section('Preview', 'eye', preview),
    out.el,
    h('div', { class: 'ie-foot' }, goBtn))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin' }, stg, hint('Drag the box to move it, drag the dots to resize. Arrow keys nudge, + and - resize.', 'move'), result), side)
  root.append(shell(style, slot.el, work))
  return () => { if (imgUrl) revokeURL(imgUrl); if (resUrl) revokeURL(resUrl) }
}
