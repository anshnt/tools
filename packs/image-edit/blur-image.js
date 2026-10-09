// Blur sensitive info: drag boxes (or ovals) over faces, numbers and private details, then blur, pixelate or cover them. Undo, redo, resize.
import { canvas } from '../../lib/image.js'
import {
  shell, h, icon, button, busy, chips, section, note, hint, stage, slider, colorField, imageSlot, previewCanvas, outputPicker, encodeWith, outName,
  toast, download,
} from './_kit.js'
import { boxBlur } from './image-filters.js'

const MODES = [['blur', 'Blur', 'droplet'], ['pixelate', 'Pixelate', 'grid-3x3'], ['solid', 'Cover', 'square']]

/** Draw the effect for one region (fractions of W/H) from `src` onto ctx. */
export function applyRegion(ctx, src, W, H, r) {
  const x = Math.max(0, Math.floor(r.x * W)), y = Math.max(0, Math.floor(r.y * H))
  const w = Math.min(W - x, Math.ceil(r.w * W)), hh = Math.min(H - y, Math.ceil(r.h * H))
  if (w < 1 || hh < 1) return
  const fx = canvas(w, hh)
  const fctx = fx.getContext('2d', { willReadFrequently: true })
  if (r.mode === 'solid') { fctx.fillStyle = r.color || '#000000'; fctx.fillRect(0, 0, w, hh) }
  else if (r.mode === 'pixelate') {
    const block = Math.max(2, (r.strength * W) / 400)
    const small = canvas(Math.max(1, Math.ceil(w / block)), Math.max(1, Math.ceil(hh / block)))
    const sctx = small.getContext('2d')
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(src, x, y, w, hh, 0, 0, small.width, small.height)
    fctx.imageSmoothingEnabled = false
    fctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, w, hh)
  } else {
    // Blur a padded area so the edges blend with their surroundings, then crop it back.
    const rad = Math.max(1, Math.round((r.strength * W) / 700))
    const pad = rad * 3
    const px = Math.max(0, x - pad), py = Math.max(0, y - pad)
    const pw = Math.min(W, x + w + pad) - px, ph = Math.min(H, y + hh + pad) - py
    const area = canvas(pw, ph)
    const actx = area.getContext('2d', { willReadFrequently: true })
    actx.drawImage(src, px, py, pw, ph, 0, 0, pw, ph)
    const id = actx.getImageData(0, 0, pw, ph)
    id.data.set(boxBlur(id.data, pw, ph, rad, 3))
    actx.putImageData(id, 0, 0)
    fctx.drawImage(area, x - px, y - py, w, hh, 0, 0, w, hh)
  }
  ctx.save()
  ctx.beginPath()
  if (r.shape === 'ellipse') ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2)
  else ctx.rect(x, y, w, hh)
  ctx.clip()
  ctx.drawImage(fx, x, y)
  ctx.restore()
}

const inRegion = (r, fx, fy) => (r.shape === 'ellipse'
  ? ((fx - (r.x + r.w / 2)) / (r.w / 2)) ** 2 + ((fy - (r.y + r.h / 2)) / (r.h / 2)) ** 2 <= 1
  : fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h)

export function mount(root, { params }) {
  const o = { mode: params.mode === 'pixelate' ? 'pixelate' : 'blur', shape: 'rect', strength: 14, color: '#000000' }
  let regions = [], sel = -1
  let undoStack = [], redoStack = []
  let src = null, base = null, srcCanvas = null

  const snap = () => JSON.stringify(regions)
  const push = () => { undoStack.push(snap()); if (undoStack.length > 100) undoStack.shift(); redoStack = []; syncBtns() }
  const restore = (json) => { regions = JSON.parse(json); sel = Math.min(sel, regions.length - 1); syncBtns(); draw() }
  const undo = () => { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()) }
  const redo = () => { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()) }
  const undoBtn = button('Undo', { icon: 'undo-2', size: 'sm', onClick: undo }), redoBtn = button('Redo', { icon: 'redo-2', size: 'sm', onClick: redo })
  const delBtn = button('Delete', { icon: 'trash-2', size: 'sm', variant: 'danger', onClick: () => { if (sel >= 0) { push(); regions.splice(sel, 1); sel = -1; draw(); syncBtns() } } })
  const clearBtn = button('Clear all', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { if (regions.length) { push(); regions = []; sel = -1; draw(); syncBtns() } } })
  const syncBtns = () => { undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length; delBtn.disabled = sel < 0; clearBtn.disabled = !regions.length; count.textContent = regions.length ? `${regions.length} area${regions.length === 1 ? '' : 's'} hidden` : 'Drag on the picture to hide something.' }
  const count = h('div', { class: 'ie-note' })

  const mode = chips(MODES, o.mode, (v) => { o.mode = v; if (sel >= 0) { push(); regions[sel].mode = v; draw() } syncMode() }, { label: 'Effect' })
  const shape = chips([['rect', 'Rectangle', 'square'], ['ellipse', 'Oval', 'circle']], 'rect', (v) => { o.shape = v; if (sel >= 0) { push(); regions[sel].shape = v; draw() } }, { label: 'Shape' })
  const strength = slider('Strength', { min: 2, max: 40, value: o.strength, format: (v) => `${v}`, onInput: (v) => { o.strength = v; if (sel >= 0) { regions[sel].strength = v; draw() } } })
  const cover = colorField('Cover color', '#000000', (v) => { o.color = v; if (sel >= 0) { regions[sel].color = v; draw() } }, { swatches: ['#000000', '#ffffff', '#ef4444'] })
  const syncMode = () => { strength.hidden = o.mode === 'solid'; cover.hidden = o.mode !== 'solid' }
  const out = outputPicker({ formats: ['png', 'jpg', 'webp'], value: 'same' })

  const view = h('canvas', { class: 'ie-blurcanvas', tabindex: 0, 'aria-label': 'Image. Drag to hide an area. Delete removes the selected area.' })
  const host = stage(view)

  function paintAll(ctx, source, W, H) {
    for (const r of regions) applyRegion(ctx, source, W, H, r)
  }
  let raf = 0
  function draw() {
    if (!base) return
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const W = view.width, H = view.height, ctx = view.getContext('2d')
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(base, 0, 0)
      paintAll(ctx, base, W, H)
      regions.forEach((r, i) => {
        ctx.save()
        ctx.lineWidth = Math.max(2, W / 500); ctx.setLineDash(i === sel ? [] : [W / 150, W / 200])
        ctx.strokeStyle = i === sel ? '#5b4cf0' : 'rgba(255,255,255,.9)'; ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 3
        ctx.beginPath()
        if (r.shape === 'ellipse') ctx.ellipse((r.x + r.w / 2) * W, (r.y + r.h / 2) * H, (r.w / 2) * W, (r.h / 2) * H, 0, 0, Math.PI * 2)
        else ctx.rect(r.x * W, r.y * H, r.w * W, r.h * H)
        ctx.stroke()
        if (i === sel) {
          ctx.shadowBlur = 0; ctx.setLineDash([]); ctx.fillStyle = '#fff'
          const hr = Math.max(6, W / 130)
          for (const [cx, cy] of corners(r)) { ctx.beginPath(); ctx.arc(cx * W, cy * H, hr, 0, Math.PI * 2); ctx.fill(); ctx.stroke() }
        }
        ctx.restore()
      })
    })
  }
  const corners = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]
  const toFrac = (e) => { const b = view.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)), y: Math.max(0, Math.min(1, (e.clientY - b.top) / b.height)) } }

  let drag = null
  view.addEventListener('pointerdown', (e) => {
    if (!base) return
    const p = toFrac(e)
    const b = view.getBoundingClientRect()
    const tolX = 16 / b.width, tolY = 16 / b.height
    if (sel >= 0) {
      const r = regions[sel]
      const ci = corners(r).findIndex(([cx, cy]) => Math.abs(p.x - cx) < tolX && Math.abs(p.y - cy) < tolY)
      if (ci >= 0) {
        const opp = corners(r)[3 - ci]
        drag = { kind: 'resize', i: sel, ax: opp[0], ay: opp[1], id: e.pointerId, pushed: false }
        view.setPointerCapture(e.pointerId); e.preventDefault(); return
      }
    }
    for (let i = regions.length - 1; i >= 0; i--) {
      if (inRegion(regions[i], p.x, p.y)) {
        sel = i; syncFromSel()
        drag = { kind: 'move', i, ox: p.x - regions[i].x, oy: p.y - regions[i].y, id: e.pointerId, pushed: false }
        view.setPointerCapture(e.pointerId); view.classList.add('grabbing'); draw(); syncBtns(); e.preventDefault(); return
      }
    }
    sel = -1
    drag = { kind: 'new', x0: p.x, y0: p.y, id: e.pointerId, pushed: false }
    view.setPointerCapture(e.pointerId); syncBtns(); draw(); e.preventDefault()
  })
  view.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const p = toFrac(e)
    if (drag.kind === 'new') {
      if (Math.abs(p.x - drag.x0) < 0.004 && Math.abs(p.y - drag.y0) < 0.004 && !drag.pushed) return
      if (!drag.pushed) { push(); regions.push({ x: drag.x0, y: drag.y0, w: 0.001, h: 0.001, mode: o.mode, shape: o.shape, strength: o.strength, color: o.color }); sel = regions.length - 1; drag.pushed = true; drag.i = sel }
      const r = regions[drag.i]
      r.x = Math.min(p.x, drag.x0); r.y = Math.min(p.y, drag.y0); r.w = Math.abs(p.x - drag.x0); r.h = Math.abs(p.y - drag.y0)
    } else if (drag.kind === 'move') {
      if (!drag.pushed) { push(); drag.pushed = true }
      const r = regions[drag.i]
      r.x = Math.max(0, Math.min(1 - r.w, p.x - drag.ox)); r.y = Math.max(0, Math.min(1 - r.h, p.y - drag.oy))
    } else {
      if (!drag.pushed) { push(); drag.pushed = true }
      const r = regions[drag.i]
      r.x = Math.min(p.x, drag.ax); r.y = Math.min(p.y, drag.ay); r.w = Math.max(0.01, Math.abs(p.x - drag.ax)); r.h = Math.max(0.01, Math.abs(p.y - drag.ay))
    }
    draw()
  })
  const end = () => {
    if (drag?.kind === 'new' && drag.pushed) { const r = regions[drag.i]; if (r.w < 0.01 || r.h < 0.01) { regions.splice(drag.i, 1); sel = -1; undoStack.pop() } }
    drag = null; view.classList.remove('grabbing'); syncBtns(); draw()
  }
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end)
  view.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { e.preventDefault(); delBtn.click() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
  })
  function syncFromSel() {
    const r = regions[sel]
    if (!r) return
    o.mode = r.mode; mode.set(r.mode); o.shape = r.shape; shape.set(r.shape); o.strength = r.strength; strength.set(r.strength); o.color = r.color; cover.set(r.color); syncMode()
  }

  const goBtn = button('Download image', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    if (!regions.length) return toast('Draw over something to hide first.', 'error')
    const c = canvas(src.w, src.h)
    const ctx = c.getContext('2d')
    ctx.drawImage(srcCanvas, 0, 0)
    paintAll(ctx, srcCanvas, c.width, c.height)
    const pick = out.resolve(src)
    download(await encodeWith(c, pick), outName(src.name, 'blurred', pick.fmt))
  }, { label: 'Rendering' }))

  const slot = imageSlot({
    ic: 'eye-off',
    onImage: async (s) => {
      src = s
      srcCanvas = canvas(s.w, s.h); srcCanvas.getContext('2d').drawImage(s.img, 0, 0, s.w, s.h)
      base = previewCanvas(s.img, 1400)
      view.width = base.width; view.height = base.height
      regions = []; sel = -1; undoStack = []; redoStack = []
      work.hidden = false; syncBtns(); draw()
    },
    onClear: () => { src = base = srcCanvas = null; work.hidden = true },
  })
  const style = h('style', '.ie-blurcanvas{cursor:crosshair;touch-action:none;outline:none}.ie-blurcanvas.grabbing{cursor:grabbing}.ie-blurcanvas:focus-visible{box-shadow:0 0 0 4px var(--ring)}')
  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Hide with', 'eye-off', mode, shape, strength, cover, note('Blur is gentle. For passwords, card numbers or IDs use Pixelate with a high strength, or Cover, which cannot be undone.')),
    section('Areas', 'layers', count, h('div', { class: 'ie-chips' }, undoBtn, redoBtn, delBtn, clearBtn)),
    out.el, h('div', { class: 'ie-foot' }, goBtn))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin' }, host, hint('Drag on the picture to draw an area. Click an area to move it, drag its dots to resize.', 'move')), side)
  root.append(shell(style, slot.el, work))
  syncMode(); syncBtns()
}
