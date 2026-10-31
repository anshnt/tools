// The crop step: pictures open one by one with a draggable frame. Skip, apply, or apply the same frame to all the rest.
// The result is a map from picture id to a frame in fractions of the picture (x, y, w, h from 0 to 1), or null for "keep whole".
import { h, button, modal, segmented, icon, formatBytes } from '../../lib/ui.js'
import { loadImage, canvas as makeCanvas, toBlob, toCanvas } from '../../lib/image.js'
import { baseName } from '../../lib/files.js'

export const RATIOS = [['free', 'Free'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['9:16', '9:16'], ['a4', 'A4']]
const RATIO_VALUE = { '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16, a4: 210 / 297 }
const MIN = 24
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

let styled = false
function styles() {
  if (styled) return
  styled = true
  document.head.append(h('style', `
.fc-crop { display: grid; gap: 12px; }
.fc-crop-stage { position: relative; margin: 0 auto; touch-action: none; user-select: none; max-width: 100%; border-radius: 8px; overflow: hidden; background: repeating-conic-gradient(var(--surface-3) 0 25%, var(--surface-2) 0 50%) 0 0 / 16px 16px; }
.fc-crop-stage canvas { display: block; max-width: 100%; }
.fc-crop-frame { position: absolute; border: 2px solid #fff; outline: 1px solid rgba(0, 0, 0, .6); box-shadow: 0 0 0 9999px rgba(0, 0, 0, .5); cursor: move; box-sizing: border-box; }
.fc-crop-frame:focus-visible { outline: 3px solid var(--accent); }
.fc-crop-frame::before, .fc-crop-frame::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(#fff6, #fff6) 33.3% 0 / 1px 100% no-repeat, linear-gradient(#fff6, #fff6) 66.6% 0 / 1px 100% no-repeat, linear-gradient(#fff6, #fff6) 0 33.3% / 100% 1px no-repeat, linear-gradient(#fff6, #fff6) 0 66.6% / 100% 1px no-repeat; }
.fc-crop-frame i { position: absolute; width: 22px; height: 22px; background: #fff; border: 2px solid var(--accent); border-radius: 50%; box-sizing: border-box; touch-action: none; }
.fc-crop-frame i[data-h="nw"] { left: -11px; top: -11px; cursor: nwse-resize; } .fc-crop-frame i[data-h="ne"] { right: -11px; top: -11px; cursor: nesw-resize; }
.fc-crop-frame i[data-h="sw"] { left: -11px; bottom: -11px; cursor: nesw-resize; } .fc-crop-frame i[data-h="se"] { right: -11px; bottom: -11px; cursor: nwse-resize; }
.fc-crop-frame i[data-h="n"] { left: calc(50% - 11px); top: -11px; cursor: ns-resize; } .fc-crop-frame i[data-h="s"] { left: calc(50% - 11px); bottom: -11px; cursor: ns-resize; }
.fc-crop-frame i[data-h="w"] { top: calc(50% - 11px); left: -11px; cursor: ew-resize; } .fc-crop-frame i[data-h="e"] { top: calc(50% - 11px); right: -11px; cursor: ew-resize; }
.fc-crop-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.fc-crop .seg { flex-wrap: wrap; }
`))
}

/** Crop a picture to a frame (fractions of the picture) and return a lossless PNG file with the same base name. */
export async function cropFile(file, r) {
  const img = await loadImage(file)
  let w = img.naturalWidth, hh = img.naturalHeight
  let k = 1
  if (/\.svg$/i.test(file.name) || !w || !hh) { w = w || 300; hh = hh || 150; k = Math.max(1, 1024 / Math.max(w, hh)); w = Math.round(w * k); hh = Math.round(hh * k) }
  const sx = Math.round(r.x * w), sy = Math.round(r.y * hh)
  let sw = Math.max(1, Math.min(w - sx, Math.round(r.w * w))), sh = Math.max(1, Math.min(hh - sy, Math.round(r.h * hh)))
  if (r.ratio) { sh = Math.max(1, Math.min(hh - sy, Math.round(sw / r.ratio))); sw = Math.max(1, Math.min(sw, Math.round(sh * r.ratio))) } // a locked shape stays exact to the pixel
  const c = makeCanvas(sw, sh)
  const src = k > 1 ? toCanvas(img, w, hh) : img // vector pictures are drawn at the larger size first so the crop stays sharp
  c.getContext('2d').drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
  if (src !== img) src.width = src.height = 0
  const blob = await toBlob(c, 'image/png')
  c.width = c.height = 0
  return new File([blob], `${baseName(file.name)}.png`, { type: 'image/png' })
}

/**
 * cropSession([{id, file}]) -> Promise<Map<id, rect | null> | null>  (null when the person closes the window: do not convert)
 */
export function cropSession(items) {
  styles()
  return new Promise((resolve) => {
    const result = new Map()
    let idx = 0, finished = false
    let ratioKey = 'free', frame = null, W = 0, H = 0, last = null
    const title = h('div', { class: 'muted small', 'aria-live': 'polite' })
    const stage = h('div', { class: 'fc-crop-stage' })
    const ratioSeg = segmented(RATIOS, 'free', (v) => { ratioKey = v; fitRatio() }, 'Shape of the frame')
    const skip = button('Keep whole picture', { icon: 'skip-forward', onClick: () => finish(null) })
    const apply = button('Apply', { icon: 'check', variant: 'primary', onClick: () => finish(fractions()) })
    const applyAll = button('Apply to all the rest', { icon: 'copy-check', onClick: () => { const f = fractions(); for (let i = idx; i < items.length; i++) result.set(items[i].id, f); done() } })
    const body = h('div', { class: 'fc-crop' }, title, h('div', { class: 'row' }, ratioSeg), stage, h('div', { class: 'fc-crop-actions' }, skip, apply, applyAll))
    const m = modal({ title: 'Crop before converting', icon: 'crop', body, onClose: () => { if (!finished) { finished = true; resolve(null) } } })
    m.el.style.maxWidth = 'min(720px, 100vw - 16px)'

    const done = () => { finished = true; m.close(); resolve(result) }
    const finish = (rect) => { result.set(items[idx].id, rect); if (rect) last = rect; idx++; if (idx >= items.length) done(); else show() }
    const fractions = () => ({ x: frame.x / W, y: frame.y / H, w: frame.w / W, h: frame.h / H, ratio: ratio() })

    const el = h('div', { class: 'fc-crop-frame', tabindex: 0, role: 'group', 'aria-label': 'Crop frame. Arrow keys move it, plus and minus resize it.' },
      ...['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((p) => h('i', { dataset: { h: p } })))
    const paint = () => { Object.assign(el.style, { left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.w}px`, height: `${frame.h}px` }) }
    const ratio = () => RATIO_VALUE[ratioKey] || null

    /** Largest frame of the chosen shape, centred on the current frame (or the picture when free). */
    function fitRatio() {
      const r = ratio()
      if (!r) { if (!frame) frame = { x: W * 0.08, y: H * 0.08, w: W * 0.84, h: H * 0.84 }; paint(); return }
      let w = Math.min(W, H * r), hh = w / r
      w *= 0.9; hh *= 0.9
      const cx = frame ? frame.x + frame.w / 2 : W / 2, cy = frame ? frame.y + frame.h / 2 : H / 2
      frame = { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - hh / 2, 0, H - hh), w, h: hh }
      paint()
    }

    let drag = null
    el.addEventListener('pointerdown', (e) => {
      const hd = e.target.dataset?.h || null
      drag = { hd, x0: e.clientX, y0: e.clientY, r0: { ...frame } }
      el.setPointerCapture(e.pointerId)
      e.preventDefault()
      el.focus()
    })
    el.addEventListener('pointermove', (e) => {
      if (!drag) return
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0, r0 = drag.r0
      if (!drag.hd) { frame = { ...r0, x: clamp(r0.x + dx, 0, W - r0.w), y: clamp(r0.y + dy, 0, H - r0.h) }; paint(); return }
      let { x, y, w, h: hh } = r0
      const p = drag.hd
      if (p.includes('w')) { x = r0.x + dx; w = r0.w - dx }
      if (p.includes('e')) w = r0.w + dx
      if (p.includes('n')) { y = r0.y + dy; hh = r0.h - dy }
      if (p.includes('s')) hh = r0.h + dy
      const r = ratio()
      if (r) {
        if (p === 'n' || p === 's') w = hh * r; else hh = w / r
        w = Math.max(MIN, w); hh = w / r
        const k = Math.min(1, W / w, H / hh)
        w *= k; hh *= k
        x = p.includes('w') ? r0.x + r0.w - w : p === 'n' || p === 's' ? r0.x + (r0.w - w) / 2 : r0.x
        y = p.includes('n') ? r0.y + r0.h - hh : p === 'e' || p === 'w' ? r0.y + (r0.h - hh) / 2 : r0.y
      } else {
        if (w < MIN) { if (p.includes('w')) x -= MIN - w; w = MIN }
        if (hh < MIN) { if (p.includes('n')) y -= MIN - hh; hh = MIN }
      }
      frame = { x: clamp(x, 0, Math.max(0, W - w)), y: clamp(y, 0, Math.max(0, H - hh)), w: Math.min(w, W), h: Math.min(hh, H) }
      paint()
    })
    const end = () => { drag = null }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 20 : 4
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
      if (mv) { frame.x = clamp(frame.x + mv[0], 0, W - frame.w); frame.y = clamp(frame.y + mv[1], 0, H - frame.h); paint(); e.preventDefault(); return }
      const grow = { '+': 1.05, '=': 1.05, '-': 1 / 1.05, _: 1 / 1.05 }[e.key]
      if (grow) {
        const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2
        const k = Math.min(grow, W / frame.w, H / frame.h)
        const w = Math.max(MIN, frame.w * k), hh = Math.max(MIN, frame.h * k)
        frame = { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - hh / 2, 0, H - hh), w, h: hh }
        paint(); e.preventDefault()
      }
      if (e.key === 'Enter') { e.preventDefault(); finish(fractions()) }
    })

    async function show() {
      const it = items[idx]
      title.textContent = `Picture ${idx + 1} of ${items.length}: ${it.file.name} (${formatBytes(it.file.size)})`
      stage.replaceChildren(h('div', { class: 'row', style: 'padding:40px;justify-content:center' }, h('span', { class: 'spinner' }), 'Opening the picture'))
      for (const b of [skip, apply, applyAll]) b.disabled = true
      try {
        const img = await loadImage(it.file)
        const nw = img.naturalWidth || 300, nh = img.naturalHeight || 150
        const maxW = Math.min(640, Math.max(220, (m.el.clientWidth || 600) - 48)), maxH = Math.min(440, Math.max(200, innerHeight - 330))
        const k = Math.min(maxW / nw, maxH / nh)
        W = Math.max(40, Math.round(nw * k)); H = Math.max(40, Math.round(nh * k))
        stage.replaceChildren(toCanvas(img, W, H), el)
        frame = last && ratioKey === 'free' ? { x: last.x * W, y: last.y * H, w: last.w * W, h: last.h * H } : null
        fitRatio()
        for (const b of [skip, apply, applyAll]) b.disabled = false
        applyAll.hidden = items.length - idx < 2
        el.focus({ preventScroll: true })
      } catch (e) {
        stage.replaceChildren(h('div', { class: 'alert error', role: 'alert' }, icon('circle-alert'), h('div', e.message || 'Could not open this picture.')))
        skip.disabled = false
        skip.textContent = 'Skip this picture'
      }
    }
    show()
  })
}
