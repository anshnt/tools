// Screenshot & annotate: capture one screen frame (or open/paste an image), then crop, draw, redact and export.
import { h, icon, button, busy, toast, alert, segmented, rangeField, toggle, field, download, clear } from '../../lib/ui.js'
import { toBlob, canvas as makeCanvas } from '../../lib/image.js'
import { withExt, baseName } from '../../lib/files.js'
import { baseCss, injectCss, dock, sourceHero, sourceActions, listen, isTyping, clamp, readableOn, hexToRgb } from './_shared.js'

const COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#111827', '#ffffff']
const FRAMES = [
  ['Aurora', ['#6366f1', '#a855f7', '#ec4899']], ['Sunset', ['#f97316', '#f43f5e', '#facc15']], ['Ocean', ['#06b6d4', '#3b82f6', '#6366f1']],
  ['Mint', ['#10b981', '#84cc16', '#06b6d4']], ['Night', ['#0f172a', '#312e81', '#1e293b']], ['Paper', ['#f8fafc', '#e2e8f0', '#f1f5f9']],
]
const TOOL_DEFS = [
  { id: 'select', label: 'Select and move', icon: 'mouse-pointer-2', key: 'V', hint: 'Click an annotation to select it, drag to move it, press Delete to remove it. Double-click text to edit.' },
  { id: 'crop', label: 'Crop', icon: 'crop', key: 'C', hint: 'Drag to choose the area to keep, adjust the handles, then press Enter or Apply.' },
  { id: 'arrow', label: 'Arrow', icon: 'move-up-right', key: 'A', hint: 'Drag to draw an arrow. Hold Shift to snap to 45 degrees.' },
  { id: 'rect', label: 'Rectangle', icon: 'square', key: 'R', hint: 'Drag to draw a rectangle. Hold Shift for a square. Turn on Fill for a solid box.' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle', key: 'E', hint: 'Drag to draw an ellipse. Hold Shift for a circle.' },
  { id: 'pen', label: 'Pen', icon: 'pencil', key: 'P', hint: 'Draw freehand.' },
  { id: 'highlight', label: 'Highlighter', icon: 'highlighter', key: 'H', hint: 'Paint a translucent highlight over text.' },
  { id: 'text', label: 'Text', icon: 'type', key: 'T', hint: 'Click where the text should go, type, then press Enter. Shift+Enter adds a line. Fill adds a background.' },
  { id: 'step', label: 'Numbered step', icon: 'list-ordered', key: 'N', hint: 'Click to drop numbered markers 1, 2, 3 on the picture.' },
  { id: 'blur', label: 'Blur region', icon: 'droplets', key: 'B', hint: 'Drag over anything private to blur it. Strength follows the size slider.' },
  { id: 'pixel', label: 'Pixelate region', icon: 'grid-3x3', key: 'X', hint: 'Drag over anything private to pixelate it. Block size follows the size slider.' },
]
const SIZE_LABEL = { text: 'Font size', blur: 'Blur strength', pixel: 'Pixel size', step: 'Marker size', highlight: 'Highlighter width' }

// ---------- Pure drawing helpers (exported for tests) ----------
const measureCtx = document.createElement('canvas').getContext('2d')
export const fontSize = (a) => 12 + a.size * 3
const fontOf = (a) => `600 ${fontSize(a)}px Geist, ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`
export const boxOf = (a) => ({ x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) })

export function textMetrics(a) {
  measureCtx.font = fontOf(a)
  const lines = String(a.text).split('\n')
  const fs = fontSize(a)
  const w = Math.max(...lines.map((l) => measureCtx.measureText(l || ' ').width))
  return { lines, fs, lh: fs * 1.25, w, h: lines.length * fs * 1.25 }
}

/** In-place box blur of RGBA ImageData (3 passes, edge clamped). */
export function boxBlur(img, radius) {
  const { width: w, height: hh, data } = img
  const r = Math.max(1, Math.round(radius))
  const tmp = new Uint8ClampedArray(data.length)
  const pass = (src, dst, horizontal) => {
    const len = horizontal ? w : hh, lines = horizontal ? hh : w
    const step = horizontal ? 4 : w * 4, lineStep = horizontal ? w * 4 : 4
    const div = 2 * r + 1
    for (let l = 0; l < lines; l++) {
      const o = l * lineStep
      for (let c = 0; c < 4; c++) {
        let sum = 0
        for (let i = -r; i <= r; i++) sum += src[o + clamp(i, 0, len - 1) * step + c]
        for (let i = 0; i < len; i++) {
          dst[o + i * step + c] = sum / div
          sum += src[o + Math.min(len - 1, i + r + 1) * step + c] - src[o + Math.max(0, i - r) * step + c]
        }
      }
    }
  }
  for (let i = 0; i < 3; i++) { pass(data, tmp, true); pass(tmp, data, false) }
  return img
}

/** In-place pixelation of RGBA ImageData: every block becomes its average color. */
export function pixelate(img, block) {
  const { width: w, height: hh, data } = img
  const b = Math.max(2, Math.round(block))
  for (let by = 0; by < hh; by += b) {
    for (let bx = 0; bx < w; bx += b) {
      let r = 0, g = 0, bl = 0, n = 0
      const ye = Math.min(hh, by + b), xe = Math.min(w, bx + b)
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++ }
      r = Math.round(r / n); g = Math.round(g / n); bl = Math.round(bl / n)
      for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = bl }
    }
  }
  return img
}

function shadow(ctx, a, on = true) {
  if (!on) return
  ctx.shadowColor = 'rgba(0,0,0,.32)'
  ctx.shadowBlur = Math.max(3, a.size * 1.4)
  ctx.shadowOffsetY = Math.max(1, a.size * 0.35)
}

/** Draw one annotation. For blur and pixel the pixels underneath are read from ctx itself. */
export function drawAnn(ctx, a) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = a.color
  ctx.fillStyle = a.color
  switch (a.type) {
    case 'arrow': {
      const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy)
      if (len < 1) break
      const ang = Math.atan2(dy, dx)
      const hl = Math.min(Math.max(14, a.size * 4.4), len * 0.85)
      const bx = a.x2 - Math.cos(ang) * hl * 0.75, by = a.y2 - Math.sin(ang) * hl * 0.75
      shadow(ctx, a)
      ctx.lineWidth = a.size
      ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(bx, by); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(a.x2, a.y2)
      ctx.lineTo(a.x2 - hl * Math.cos(ang - 0.42), a.y2 - hl * Math.sin(ang - 0.42))
      ctx.lineTo(a.x2 - hl * Math.cos(ang + 0.42), a.y2 - hl * Math.sin(ang + 0.42))
      ctx.closePath(); ctx.fill()
      break
    }
    case 'rect': {
      const { x, y, w, h: hh } = boxOf(a)
      shadow(ctx, a)
      if (a.fill) ctx.fillRect(x, y, w, hh)
      else { ctx.lineWidth = a.size; ctx.strokeRect(x, y, w, hh) }
      break
    }
    case 'ellipse': {
      const { x, y, w, h: hh } = boxOf(a)
      shadow(ctx, a)
      ctx.beginPath(); ctx.ellipse(x + w / 2, y + hh / 2, Math.max(0.5, w / 2), Math.max(0.5, hh / 2), 0, 0, Math.PI * 2)
      if (a.fill) ctx.fill()
      else { ctx.lineWidth = a.size; ctx.stroke() }
      break
    }
    case 'pen':
    case 'highlight': {
      const p = a.pts
      if (!p.length) break
      const hi = a.type === 'highlight'
      if (hi) { ctx.globalAlpha = 0.4; ctx.lineCap = 'butt'; ctx.lineJoin = 'round' } else shadow(ctx, a)
      const lw = hi ? a.size * 4 : a.size
      if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0].x, p[0].y, lw / 2, 0, Math.PI * 2); ctx.fill(); break }
      ctx.lineWidth = lw
      ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y)
      for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2)
      ctx.lineTo(p.at(-1).x, p.at(-1).y)
      ctx.stroke()
      break
    }
    case 'text': {
      const m = textMetrics(a)
      ctx.font = fontOf(a)
      ctx.textBaseline = 'top'
      const off = (m.lh - m.fs) / 2
      if (a.fill) {
        ctx.fillStyle = a.color
        const pad = m.fs * 0.35
        ctx.beginPath(); ctx.roundRect(a.x - pad, a.y - pad * 0.6, m.w + pad * 2, m.h + pad * 1.2, m.fs * 0.3); ctx.fill()
        ctx.fillStyle = readableOn(hexToRgb(a.color) || [0, 0, 0])
        m.lines.forEach((l, i) => ctx.fillText(l, a.x, a.y + i * m.lh + off))
      } else {
        const light = readableOn(hexToRgb(a.color) || [0, 0, 0]) === '#ffffff'
        ctx.lineWidth = m.fs / 5
        ctx.strokeStyle = light ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.75)'
        ctx.lineJoin = 'round'
        m.lines.forEach((l, i) => ctx.strokeText(l, a.x, a.y + i * m.lh + off))
        ctx.fillStyle = a.color
        m.lines.forEach((l, i) => ctx.fillText(l, a.x, a.y + i * m.lh + off))
      }
      break
    }
    case 'step': {
      const r = 11 + a.size * 1.6
      shadow(ctx, a)
      ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.fillStyle = readableOn(hexToRgb(a.color) || [0, 0, 0])
      ctx.font = `700 ${Math.round(r * 1.1)}px Geist, ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(a.n), a.x, a.y + r * 0.05)
      break
    }
    case 'blur':
    case 'pixel': {
      const b = boxOf(a)
      const x = Math.max(0, Math.floor(b.x)), y = Math.max(0, Math.floor(b.y))
      const w = Math.min(ctx.canvas.width, Math.ceil(b.x + b.w)) - x, hh = Math.min(ctx.canvas.height, Math.ceil(b.y + b.h)) - y
      if (w < 2 || hh < 2) break
      const img = ctx.getImageData(x, y, w, hh)
      if (a.type === 'blur') boxBlur(img, a.size * 1.5 + 3)
      else pixelate(img, a.size * 2 + 4)
      ctx.putImageData(img, x, y)
      break
    }
  }
  ctx.restore()
}

export function boundsOf(a) {
  switch (a.type) {
    case 'arrow': case 'rect': case 'ellipse': case 'blur': case 'pixel': { const b = boxOf(a); const p = a.size / 2 + 2; return { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 } }
    case 'pen': case 'highlight': {
      const xs = a.pts.map((p) => p.x), ys = a.pts.map((p) => p.y), p = (a.type === 'highlight' ? a.size * 2 : a.size / 2) + 2
      return { x: Math.min(...xs) - p, y: Math.min(...ys) - p, w: Math.max(...xs) - Math.min(...xs) + p * 2, h: Math.max(...ys) - Math.min(...ys) + p * 2 }
    }
    case 'text': { const m = textMetrics(a); const p = m.fs * 0.4; return { x: a.x - p, y: a.y - p, w: m.w + p * 2, h: m.h + p * 2 } }
    case 'step': { const r = 11 + a.size * 1.6; return { x: a.x - r, y: a.y - r, w: r * 2, h: r * 2 } }
  }
  return { x: 0, y: 0, w: 0, h: 0 }
}

const segDist = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy
  const t = l2 ? clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1) : 0
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function hitTest(a, x, y, tol) {
  switch (a.type) {
    case 'arrow': return segDist(x, y, a.x1, a.y1, a.x2, a.y2) <= tol + a.size / 2 + 4
    case 'pen': case 'highlight': {
      const w = (a.type === 'highlight' ? a.size * 2 : a.size / 2) + tol
      if (a.pts.length === 1) return Math.hypot(x - a.pts[0].x, y - a.pts[0].y) <= w
      return a.pts.some((p, i) => i && segDist(x, y, a.pts[i - 1].x, a.pts[i - 1].y, p.x, p.y) <= w)
    }
    case 'rect': {
      const b = boxOf(a)
      if (a.fill) return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol
      const t = tol + a.size / 2
      const inside = x >= b.x - t && x <= b.x + b.w + t && y >= b.y - t && y <= b.y + b.h + t
      const core = x > b.x + t && x < b.x + b.w - t && y > b.y + t && y < b.y + b.h - t
      return inside && !core
    }
    case 'ellipse': {
      const b = boxOf(a)
      const rx = Math.max(1, b.w / 2), ry = Math.max(1, b.h / 2)
      const d = Math.hypot((x - b.x - rx) / rx, (y - b.y - ry) / ry)
      if (a.fill) return d <= 1 + tol / Math.min(rx, ry)
      return Math.abs(d - 1) <= (tol + a.size / 2) / Math.min(rx, ry)
    }
    default: { const b = boundsOf(a); return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h }
  }
}

function moveAnn(a, dx, dy) {
  if (a.pts) a.pts.forEach((p) => { p.x += dx; p.y += dy })
  else if ('x1' in a) { a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy } else { a.x += dx; a.y += dy }
}

const CSS = `
.t-shot .bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.t-shot .bar .grow{flex:1;min-width:0}
.t-shot .opts{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;padding:10px 14px;border-radius:18px}
.t-shot .swatches{display:flex;flex-wrap:wrap;gap:7px;align-items:center}
.t-shot .sw{position:relative;width:26px;height:26px;border-radius:50%;border:2px solid var(--surface);background:var(--sw);cursor:pointer;box-shadow:0 0 0 1px var(--border-strong);transition:transform .25s var(--spring),box-shadow .2s;padding:0}
.t-shot .sw:hover{transform:scale(1.15)}
.t-shot .sw[aria-pressed="true"]{transform:scale(1.18);box-shadow:0 0 0 2px var(--accent),0 6px 14px -4px var(--sw)}
.t-shot .sw-custom{background:conic-gradient(#ef4444,#facc15,#22c55e,#06b6d4,#8b5cf6,#ef4444);overflow:hidden}
.t-shot .sw-custom input{position:absolute;inset:-6px;opacity:0;width:44px;height:44px;cursor:pointer}
.t-shot .size{display:flex;align-items:center;gap:10px;min-width:170px;flex:1 1 170px;max-width:260px}
.t-shot .size .field{flex:1}
.t-shot .stagewrap{position:relative}
.t-shot .stage{position:relative;border-radius:var(--radius-xl);border:1px solid var(--border);padding:clamp(10px,2.5vw,26px);overflow:auto;display:grid;place-items:center;min-height:300px;
  background:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--text) 15%,transparent) 1px,transparent 0) 0 0/18px 18px,var(--surface-2)}
.t-shot .frame{position:relative;line-height:0;border-radius:4px;box-shadow:0 30px 60px -28px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.1);animation:sc-pop .55s var(--spring);max-width:100%}
.t-shot canvas.view{display:block;max-width:100%;height:auto;touch-action:none;cursor:crosshair;border-radius:4px}
.t-shot canvas.view.fit{width:100%}
.t-shot canvas.view[data-tool="select"]{touch-action:pan-x pan-y pinch-zoom;cursor:default}
.t-shot canvas.view[data-tool="text"]{cursor:text}
.t-shot .texted{position:absolute;margin:0;padding:0;border:0;outline:2px dashed var(--accent);outline-offset:4px;background:rgba(255,255,255,.06);resize:none;overflow:hidden;font-family:Geist,ui-sans-serif,system-ui,sans-serif;font-weight:600;line-height:1.25;white-space:pre;min-width:3ch;z-index:3}
.t-shot .cropbar{position:absolute;left:50%;top:12px;transform:translateX(-50%);width:max-content;z-index:4;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;padding:8px 10px;border-radius:18px;max-width:calc(100% - 20px);animation:sc-fade .3s var(--ease)}
.t-shot .hint{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;min-height:22px}
.t-shot .hint .icon{width:15px;height:15px;color:var(--accent)}
.t-shot .side{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px}
.t-shot .frames{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px}
.t-shot .fr{aspect-ratio:1;border-radius:12px;border:2px solid var(--surface);cursor:pointer;background:var(--g);box-shadow:0 0 0 1px var(--border-strong);transition:transform .25s var(--spring),box-shadow .2s;padding:0}
.t-shot .fr:hover{transform:translateY(-3px)}
.t-shot .fr[aria-pressed="true"]{box-shadow:0 0 0 2px var(--accent)}
.t-shot .fr-none{background:var(--checker)}
.t-shot .prev{border-radius:14px;border:1px solid var(--border);background:var(--checker);display:grid;place-items:center;overflow:hidden;min-height:110px;padding:10px}
.t-shot .prev canvas{max-width:100%;max-height:180px;height:auto;border-radius:6px;box-shadow:0 10px 24px -12px rgba(0,0,0,.4)}
.t-shot .done{animation:sc-pop .4s var(--spring)}
@media (max-width:560px){.t-shot .frames{grid-template-columns:repeat(4,minmax(0,1fr))}.t-shot .opts{padding:10px}}
`

export function mount(root, { signal }) {
  baseCss()
  injectCss('shot', CSS)

  // ----- state -----
  let basec = null, anns = [], undo = [], redo = [], name = 'screenshot', stepN = 1
  let tool = 'arrow', sel = -1, drag = null, draft = null, crop = null, textEd = null
  const style = { color: COLORS[0], size: 4, fill: false }
  const frame = { on: false, bg: 0, pad: 64, radius: 14, shadow: true }
  let format = 'png', quality = 0.92, zoom = 'fit'
  let layer = null, lctx = null, dirty = true, raf = 0

  const view = h('canvas', { class: 'view fit', role: 'img', 'aria-label': 'Screenshot being edited', 'data-tool': tool })
  const vctx = view.getContext('2d')
  const frameEl = h('div', { class: 'frame' }, view)
  const stage = h('div', { class: 'stage' }, frameEl)
  const stageWrap = h('div', { class: 'stagewrap' }, stage)
  const hintIcon = icon('info')
  const hintText = h('span')
  const dimsText = h('span', { class: 'sc-mono muted small' })
  const editor = h('div', { class: 'stack', hidden: true })
  const heroHost = h('div')
  const exportMsg = h('div')

  // ----- history -----
  const snap = () => ({ base: basec, anns: structuredClone(anns), stepN })
  const restore = (s) => { setBase(s.base); anns = s.anns; stepN = s.stepN; sel = -1; dirty = true; crop = null; refreshUi(); schedule() }
  const pushHistory = () => { undo.push(snap()); if (undo.length > 80) undo.shift(); redo = []; refreshUi() }
  const doUndo = () => { if (!undo.length) return; redo.push(snap()); restore(undo.pop()) }
  const doRedo = () => { if (!redo.length) return; undo.push(snap()); restore(redo.pop()) }

  function setBase(c) {
    basec = c
    view.width = c.width
    view.height = c.height
    layer = document.createElement('canvas')
    layer.width = c.width
    layer.height = c.height
    lctx = layer.getContext('2d', { willReadFrequently: true })
    applyZoom()
    dimsText.textContent = `${c.width} × ${c.height} px`
  }

  function applyZoom() {
    if (!basec) return
    view.classList.toggle('fit', zoom === 'fit')
    view.style.width = zoom === 'fit' ? '' : `${basec.width * Number(zoom)}px`
    view.style.maxWidth = zoom === 'fit' ? '' : 'none'
    frameEl.style.maxWidth = zoom === 'fit' ? '100%' : 'none'
  }

  function load(c, info = {}) {
    name = info.name ? baseName(info.name) : `screenshot-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`
    undo = []; redo = []; anns = []; stepN = 1; sel = -1; crop = null; draft = null; drag = null
    closeText(false)
    setBase(c)
    dirty = true
    heroHost.hidden = true
    editor.hidden = false
    setTool(tool === 'crop' || tool === 'select' ? 'arrow' : tool)
    refreshUi()
    schedule()
    frameEl.style.animation = 'none'
    void frameEl.offsetWidth
    frameEl.style.animation = ''
    stageWrap.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  // ----- rendering -----
  const k = () => (view.clientWidth ? view.width / view.clientWidth : 1) // image px per CSS px

  function renderLayer() {
    lctx.clearRect(0, 0, layer.width, layer.height)
    lctx.drawImage(basec, 0, 0)
    for (const a of anns) if (!a._hidden) drawAnn(lctx, a)
    dirty = false
  }

  function paint() {
    raf = 0
    if (!basec) return
    if (dirty) renderLayer()
    vctx.clearRect(0, 0, view.width, view.height)
    vctx.drawImage(layer, 0, 0)
    if (draft) drawAnn(vctx, draft)
    const kk = k()
    if (sel >= 0 && anns[sel] && tool === 'select') {
      const b = boundsOf(anns[sel])
      vctx.save()
      vctx.strokeStyle = '#8b7dff'
      vctx.lineWidth = 1.5 * kk
      vctx.setLineDash([6 * kk, 4 * kk])
      vctx.strokeRect(b.x, b.y, b.w, b.h)
      vctx.restore()
    }
    if (tool === 'crop' && crop) paintCrop(kk)
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint) }

  function paintCrop(kk) {
    const c = crop
    vctx.save()
    vctx.fillStyle = 'rgba(8,8,14,.62)'
    vctx.beginPath()
    vctx.rect(0, 0, view.width, view.height)
    vctx.rect(c.x, c.y, c.w, c.h)
    vctx.fill('evenodd')
    vctx.strokeStyle = '#fff'
    vctx.lineWidth = 2 * kk
    vctx.strokeRect(c.x, c.y, c.w, c.h)
    vctx.lineWidth = kk
    vctx.strokeStyle = 'rgba(255,255,255,.45)'
    vctx.beginPath()
    for (let i = 1; i < 3; i++) {
      vctx.moveTo(c.x + (c.w * i) / 3, c.y); vctx.lineTo(c.x + (c.w * i) / 3, c.y + c.h)
      vctx.moveTo(c.x, c.y + (c.h * i) / 3); vctx.lineTo(c.x + c.w, c.y + (c.h * i) / 3)
    }
    vctx.stroke()
    vctx.fillStyle = '#fff'
    vctx.strokeStyle = '#6a5cf0'
    vctx.lineWidth = 2 * kk
    for (const [hx, hy] of handles(c)) { vctx.beginPath(); vctx.arc(hx, hy, 6 * kk, 0, Math.PI * 2); vctx.fill(); vctx.stroke() }
    vctx.restore()
    cropInfo.textContent = `${Math.round(c.w)} × ${Math.round(c.h)}`
  }
  const handles = (c) => [[c.x, c.y], [c.x + c.w / 2, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h / 2], [c.x + c.w, c.y + c.h], [c.x + c.w / 2, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y + c.h / 2]]
  const HANDLE_DIRS = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]

  // ----- pointer interaction -----
  const pt = (e) => {
    const r = view.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * view.width, y: ((e.clientY - r.top) / r.height) * view.height }
  }

  view.addEventListener('pointerdown', (e) => {
    if (!basec || e.button > 0) return
    if (textEd) { commitText(); return }
    const p = pt(e)
    const kk = k()
    if (tool === 'select' && e.pointerType === 'touch') return
    view.setPointerCapture(e.pointerId)
    if (tool === 'select') {
      sel = -1
      for (let i = anns.length - 1; i >= 0; i--) if (hitTest(anns[i], p.x, p.y, 6 * kk)) { sel = i; break }
      if (sel >= 0) { drag = { kind: 'move', last: p, moved: false }; syncStyleFromSel() }
      refreshUi(); schedule()
      return
    }
    if (tool === 'crop') {
      if (crop) {
        const hi = handles(crop).findIndex(([hx, hy]) => Math.hypot(hx - p.x, hy - p.y) <= 12 * kk)
        if (hi >= 0) { drag = { kind: 'handle', dir: HANDLE_DIRS[hi], start: { ...crop } }; return }
        if (p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h) { drag = { kind: 'cmove', last: p }; return }
      }
      drag = { kind: 'cnew', start: p }
      crop = { x: p.x, y: p.y, w: 0, h: 0 }
      refreshUi()
      return
    }
    if (tool === 'text') { openText(p.x, p.y); return }
    if (tool === 'step') {
      pushHistory()
      anns.push({ type: 'step', x: p.x, y: p.y, n: stepN++, color: style.color, size: style.size })
      dirty = true; schedule(); refreshUi()
      return
    }
    const base = { type: tool, color: style.color, size: style.size, fill: style.fill }
    if (tool === 'pen' || tool === 'highlight') draft = { ...base, pts: [{ x: p.x, y: p.y }] }
    else draft = { ...base, x1: p.x, y1: p.y, x2: p.x, y2: p.y }
    drag = { kind: 'draw' }
    schedule()
  })

  view.addEventListener('pointermove', (e) => {
    if (!drag) return
    const p = pt(e)
    if (drag.kind === 'draw') {
      if (draft.pts) {
        const last = draft.pts.at(-1)
        if (Math.hypot(p.x - last.x, p.y - last.y) > 1.2 * k()) draft.pts.push({ x: p.x, y: p.y })
      } else {
        let { x1, y1 } = draft
        let x2 = p.x, y2 = p.y
        if (e.shiftKey) {
          if (draft.type === 'arrow') {
            const ang = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x2 - x1, y2 - y1)
            x2 = x1 + Math.cos(ang) * len; y2 = y1 + Math.sin(ang) * len
          } else if (draft.type === 'rect' || draft.type === 'ellipse' || draft.type === 'blur' || draft.type === 'pixel') {
            const s = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
            x2 = x1 + Math.sign(x2 - x1 || 1) * s; y2 = y1 + Math.sign(y2 - y1 || 1) * s
          }
        }
        draft.x2 = clamp(x2, -200, view.width + 200); draft.y2 = clamp(y2, -200, view.height + 200)
      }
      schedule()
    } else if (drag.kind === 'move') {
      const a = anns[sel]
      if (!a) return
      if (!drag.moved) { pushHistory(); drag.moved = true }
      moveAnn(a, p.x - drag.last.x, p.y - drag.last.y)
      drag.last = p
      dirty = true; schedule()
    } else if (drag.kind === 'cnew') {
      crop = normRect(drag.start.x, drag.start.y, clamp(p.x, 0, view.width), clamp(p.y, 0, view.height))
      schedule()
    } else if (drag.kind === 'cmove') {
      crop.x = clamp(crop.x + p.x - drag.last.x, 0, view.width - crop.w)
      crop.y = clamp(crop.y + p.y - drag.last.y, 0, view.height - crop.h)
      drag.last = p
      schedule()
    } else if (drag.kind === 'handle') {
      const s = drag.start, [dx, dy] = drag.dir
      let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h
      const px = clamp(p.x, 0, view.width), py = clamp(p.y, 0, view.height)
      if (dx < 0) x1 = px; else if (dx > 0) x2 = px
      if (dy < 0) y1 = py; else if (dy > 0) y2 = py
      crop = normRect(x1, y1, x2, y2)
      schedule()
    }
  })

  const normRect = (x1, y1, x2, y2) => ({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) })

  const endDrag = () => {
    if (!drag) return
    const d = drag
    drag = null
    if (d.kind === 'draw' && draft) {
      const a = draft
      draft = null
      const tiny = a.pts ? false : Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 4 * k()
      if (!tiny) {
        pushHistory()
        anns.push(a)
        dirty = true
      }
    } else if (d.kind === 'cnew' && crop && (crop.w < 8 || crop.h < 8)) crop = null
    refreshUi(); schedule()
  }
  view.addEventListener('pointerup', endDrag)
  view.addEventListener('pointercancel', endDrag)

  view.addEventListener('dblclick', (e) => {
    if (tool !== 'select') return
    const p = pt(e)
    const i = anns.findLastIndex((a) => a.type === 'text' && hitTest(a, p.x, p.y, 6 * k()))
    if (i >= 0) openText(anns[i].x, anns[i].y, i)
  })

  // ----- text editing -----
  function openText(x, y, index = -1) {
    closeText(false)
    const existing = index >= 0 ? anns[index] : null
    const a = existing || { type: 'text', x, y, text: '', color: style.color, size: style.size, fill: style.fill }
    const kk = k()
    const fs = fontSize(a) / kk
    const ta = h('textarea', { class: 'texted', rows: 1, 'aria-label': 'Annotation text', spellcheck: false, style: { left: `${a.x / kk}px`, top: `${a.y / kk}px`, fontSize: `${fs}px`, color: a.color, textShadow: '0 1px 2px rgba(0,0,0,.35)' } })
    ta.value = a.text
    const fit = () => { ta.style.height = 'auto'; ta.rows = Math.max(1, ta.value.split('\n').length); ta.style.height = `${ta.scrollHeight}px`; ta.style.width = `${Math.max(4, ...ta.value.split('\n').map((l) => l.length + 1))}ch` }
    ta.addEventListener('input', fit)
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText() }
      else if (e.key === 'Escape') { e.preventDefault(); closeText(false) }
    })
    ta.addEventListener('blur', () => setTimeout(() => { if (textEd?.ta === ta) commitText() }, 120))
    frameEl.append(ta)
    textEd = { ta, a, index }
    if (existing) { existing._hidden = true; dirty = true; schedule() }
    fit()
    ta.focus()
  }
  function commitText() {
    if (!textEd) return
    const { ta, a, index } = textEd
    const text = ta.value.replace(/\s+$/, '')
    textEd = null
    ta.remove()
    if (a._hidden) delete a._hidden
    if (text) {
      pushHistory()
      if (index >= 0) { anns[index].text = text; anns[index].color = a.color } else anns.push({ ...a, text })
    } else if (index >= 0) { /* keep original when emptied */ }
    dirty = true; schedule(); refreshUi()
  }
  function closeText(commit) {
    if (!textEd) return
    if (commit) return commitText()
    const { ta, a } = textEd
    textEd = null
    ta.remove()
    if (a._hidden) { delete a._hidden; dirty = true; schedule() }
  }

  // ----- crop -----
  const cropInfo = h('span', { class: 'sc-mono small' })
  const cropBar = h('div', { class: 'cropbar sc-glass', hidden: true },
    cropInfo,
    ...[['Free', 0], ['1:1', 1], ['16:9', 16 / 9], ['4:3', 4 / 3], ['3:2', 1.5]].map(([l, r]) => button(l, { size: 'sm', variant: 'ghost', onClick: () => setCropRatio(r) })),
    button('Cancel', { size: 'sm', variant: 'ghost', onClick: () => { crop = null; refreshUi(); schedule() } }),
    button('Apply crop', { size: 'sm', variant: 'primary', icon: 'check', onClick: () => applyCrop() }))
  stageWrap.append(cropBar)
  function setCropRatio(r) {
    const W = view.width, H = view.height
    if (!r) { crop = { x: 0, y: 0, w: W, h: H } } else {
      let w = W, hh = W / r
      if (hh > H) { hh = H; w = H * r }
      crop = { x: (W - w) / 2, y: (H - hh) / 2, w, h: hh }
    }
    refreshUi(); schedule()
  }
  function applyCrop() {
    if (!crop || crop.w < 2 || crop.h < 2) return
    const x = Math.round(crop.x), y = Math.round(crop.y), w = Math.max(1, Math.round(crop.w)), hh = Math.max(1, Math.round(crop.h))
    pushHistory()
    const c = makeCanvas(w, hh)
    c.getContext('2d').drawImage(basec, x, y, w, hh, 0, 0, w, hh)
    for (const a of anns) moveAnn(a, -x, -y)
    setBase(c)
    crop = null
    dirty = true
    refreshUi(); schedule()
    toast(`Cropped to ${w} × ${hh}`, 'success')
  }

  // ----- tool + style controls -----
  const toolDock = dock(TOOL_DEFS.map((t) => ({ ...t, title: `${t.label} (${t.key})` })), tool, (id) => setTool(id), { iconsOnly: true, ariaLabel: 'Tools' })
  function setTool(id) {
    if (textEd) commitText()
    tool = id
    toolDock.set(id)
    view.dataset.tool = id
    if (id !== 'select') sel = -1
    if (id !== 'crop') crop = null
    sizeField.querySelector('.field-label span').textContent = SIZE_LABEL[id] || 'Stroke width'
    const def = TOOL_DEFS.find((t) => t.id === id)
    hintText.textContent = def.hint
    fillToggle.hidden = !['rect', 'ellipse', 'text'].includes(id)
    refreshUi(); schedule()
  }

  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Color' })
  const customInput = h('input', { type: 'color', value: '#ef4444', 'aria-label': 'Custom color', oninput: (e) => setColor(e.target.value) })
  const customSw = h('span', { class: 'sw sw-custom', title: 'Custom color' }, customInput)
  function drawSwatches() {
    clear(swatches, COLORS.map((c) => h('button', { type: 'button', class: 'sw', style: { '--sw': c }, title: c, 'aria-label': `Color ${c}`, 'aria-pressed': String(style.color.toLowerCase() === c), onclick: () => setColor(c) })), customSw)
  }
  function setColor(c) {
    style.color = c
    if (sel >= 0 && anns[sel] && tool === 'select') { pushHistory(); anns[sel].color = c; dirty = true; schedule() }
    drawSwatches()
  }
  const sizeRange = rangeField('Stroke width', { min: 1, max: 24, step: 1, value: style.size, onInput: (v) => {
    style.size = v
    if (sel >= 0 && anns[sel] && tool === 'select') { if (!sizeRange._pushed) { pushHistory(); sizeRange._pushed = true } anns[sel].size = v; dirty = true; schedule() }
  } })
  sizeRange.input.addEventListener('change', () => { sizeRange._pushed = false })
  const sizeField = sizeRange
  const fillToggle = toggle('Fill', false, (v) => { style.fill = v; if (sel >= 0 && anns[sel] && 'fill' in anns[sel]) { pushHistory(); anns[sel].fill = v; dirty = true; schedule() } })
  function syncStyleFromSel() {
    const a = anns[sel]
    if (!a) return
    style.color = a.color; style.size = a.size
    sizeRange.set(a.size)
    if ('fill' in a) { style.fill = !!a.fill; fillToggle.input.checked = !!a.fill }
    drawSwatches()
  }

  const undoBtn = button('', { icon: 'undo-2', variant: 'ghost', ariaLabel: 'Undo (Ctrl+Z)', onClick: doUndo })
  const redoBtn = button('', { icon: 'redo-2', variant: 'ghost', ariaLabel: 'Redo (Ctrl+Shift+Z)', onClick: doRedo })
  const delBtn = button('', { icon: 'trash-2', variant: 'ghost', ariaLabel: 'Delete selected (Delete)', onClick: () => deleteSel() })
  function deleteSel() {
    if (sel < 0 || !anns[sel]) return
    pushHistory(); anns.splice(sel, 1); sel = -1; dirty = true; refreshUi(); schedule()
  }
  const clearBtn = button('Clear marks', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { if (!anns.length) return; pushHistory(); anns = []; stepN = 1; sel = -1; dirty = true; refreshUi(); schedule() } })

  function refreshUi() {
    undoBtn.disabled = !undo.length
    redoBtn.disabled = !redo.length
    delBtn.hidden = !(tool === 'select' && sel >= 0)
    clearBtn.disabled = !anns.length
    cropBar.hidden = !(tool === 'crop' && crop)
    if (tool === 'crop' && crop) cropInfo.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)}`
    if (basec) updateFramePreview()
  }

  // ----- export -----
  function composite() {
    const c = makeCanvas(basec.width, basec.height)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(basec, 0, 0)
    for (const a of anns) drawAnn(ctx, a)
    return frame.on ? framed(c) : c
  }

  function framed(src, pad = frame.pad, radius = frame.radius) {
    const w = src.width, hh = src.height
    const c = makeCanvas(w + pad * 2, hh + pad * 2)
    const ctx = c.getContext('2d')
    if (frame.bg >= 0) {
      const cols = FRAMES[frame.bg][1]
      const g = ctx.createLinearGradient(0, 0, c.width, c.height)
      cols.forEach((col, i) => g.addColorStop(i / (cols.length - 1), col))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, c.width, c.height)
    }
    const r = Math.min(radius, w / 2, hh / 2)
    ctx.save()
    if (frame.shadow && pad > 0) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = Math.max(8, pad * 0.55); ctx.shadowOffsetY = Math.max(4, pad * 0.22) }
    ctx.beginPath(); ctx.roundRect(pad, pad, w, hh, r); ctx.fillStyle = '#000'; ctx.fill()
    ctx.restore()
    ctx.save()
    ctx.beginPath(); ctx.roundRect(pad, pad, w, hh, r); ctx.clip()
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, pad, pad, w, hh)
    ctx.restore()
    return c
  }

  const framePreview = h('div', { class: 'prev' })
  let prevTimer = 0
  function updateFramePreview() {
    clearTimeout(prevTimer)
    prevTimer = setTimeout(() => {
      if (!basec) return
      try {
        const small = makeCanvas(Math.min(520, basec.width), Math.max(1, Math.round(basec.height * Math.min(1, 520 / basec.width))))
        const sctx = small.getContext('2d')
        sctx.drawImage(layer || basec, 0, 0, small.width, small.height)
        let out = small
        if (frame.on) {
          const sc = small.width / basec.width
          out = framed(small, frame.pad * sc, frame.radius * sc)
        }
        clear(framePreview, out)
      } catch { /* preview is optional */ }
    }, 60)
  }

  const frameSwatches = h('div', { class: 'frames' })
  function drawFrameSwatches() {
    clear(frameSwatches,
      h('button', { type: 'button', class: 'fr fr-none', title: 'No frame', 'aria-label': 'No frame', 'aria-pressed': String(!frame.on), onclick: () => { frame.on = false; drawFrameSwatches(); updateFramePreview() } }),
      FRAMES.map(([n, cols], i) => h('button', { type: 'button', class: 'fr', title: n, 'aria-label': `${n} frame`, style: { '--g': `linear-gradient(135deg,${cols.join(',')})` }, 'aria-pressed': String(frame.on && frame.bg === i), onclick: () => { frame.on = true; frame.bg = i; drawFrameSwatches(); updateFramePreview() } })))
  }

  const fmt = segmented([['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']], format, (v) => { format = v; qualityField.hidden = v === 'png' }, 'Format')
  const qualityField = rangeField('Quality', { min: 40, max: 100, step: 1, value: quality * 100, format: (v) => `${v}%`, onInput: (v) => { quality = v / 100 } })
  qualityField.hidden = true

  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
  async function renderBlob() {
    const c = composite()
    let src = c
    if (format === 'jpg') { // flatten onto white for JPEG
      src = makeCanvas(c.width, c.height)
      const x = src.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0)
    }
    return toBlob(src, MIME[format], format === 'png' ? undefined : quality)
  }

  const copyBtn = button('Copy image', { icon: 'copy', variant: 'secondary' })
  const dlBtn = button('Download', { icon: 'download', variant: 'primary' })
  copyBtn.addEventListener('click', () => busy(copyBtn, async () => {
    if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error('Your browser cannot copy images to the clipboard. Use Download instead.')
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': (async () => { const c = composite(); return toBlob(c, 'image/png') })() })])
    } catch (e) {
      throw new Error(e?.name === 'NotAllowedError' ? 'The browser blocked clipboard access. Click the page once and try again, or use Download.' : (e.message || 'Could not copy the image.'))
    }
    toast('Image copied. Paste it anywhere with Ctrl+V.', 'success')
  }, { label: 'Copying' }))
  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    const blob = await renderBlob()
    download(blob, withExt(name, format === 'jpg' ? 'jpg' : format))
    clear(exportMsg, h('div', { class: 'done' }, alert('success', h('strong', 'Saved. '), `${withExt(name, format)} · ${Math.round(blob.size / 1024).toLocaleString()} KB`)))
  }, { label: 'Saving' }))

  const zoomSel = segmented([['fit', 'Fit'], ['1', '100%'], ['2', '200%']], zoom, (v) => { zoom = v; applyZoom(); schedule() }, 'Zoom')

  const actions = sourceActions({ onCanvas: (c, info) => load(c, info) })

  // ----- layout -----
  const toolbar = h('div', { class: 'bar' },
    toolDock,
    h('div', { class: 'grow' }),
    undoBtn, redoBtn, delBtn)
  const opts = h('div', { class: 'opts sc-glass' }, swatches,
    h('div', { class: 'size' }, sizeField), fillToggle, clearBtn)
  editor.append(
    toolbar, opts,
    h('div', { class: 'hint', 'aria-live': 'polite' }, hintIcon, hintText, h('span', { style: 'margin-left:auto' }, dimsText)),
    stageWrap,
    h('div', { class: 'bar' }, actions, h('div', { class: 'grow' }), zoomSel),
    h('div', { class: 'side' },
      h('section', { class: 'panel stack' }, h('h2', 'Export'),
        fmt, qualityField,
        h('div', { class: 'row' }, dlBtn, copyBtn),
        exportMsg,
        h('p', { class: 'small muted' }, 'Everything happens in your browser. Nothing is uploaded.')),
      h('section', { class: 'panel stack' }, h('h2', 'Presentation frame'),
        frameSwatches,
        h('div', { class: 'grid-2' },
          rangeField('Padding', { min: 0, max: 160, step: 4, value: frame.pad, format: (v) => `${v}px`, onInput: (v) => { frame.pad = v; updateFramePreview() } }),
          rangeField('Corners', { min: 0, max: 48, step: 2, value: frame.radius, format: (v) => `${v}px`, onInput: (v) => { frame.radius = v; updateFramePreview() } })),
        toggle('Soft shadow', true, (v) => { frame.shadow = v; updateFramePreview() }),
        framePreview)))

  heroHost.append(sourceHero({
    title: 'Capture, mark up, share',
    text: 'Grab a window, tab or your whole screen, then crop, add arrows and text, blur private details and copy or download the result.',
    onCanvas: (c, info) => load(c, info),
  }))
  root.append(h('div', { class: 't-shot stack' }, heroHost, editor))

  drawSwatches()
  drawFrameSwatches()
  setTool(tool)
  refreshUi()

  // ----- keyboard -----
  listen(document, 'keydown', (e) => {
    if (!basec || editor.hidden || isTyping(e)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return }
    if (mod) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && tool === 'select') { e.preventDefault(); deleteSel(); return }
    if (e.key === 'Enter' && tool === 'crop' && crop) { e.preventDefault(); applyCrop(); return }
    if (e.key === 'Escape') { if (tool === 'crop' && crop) { crop = null; refreshUi(); schedule() } else if (sel >= 0) { sel = -1; refreshUi(); schedule() } return }
    if (e.altKey || e.shiftKey && e.key.length > 1) return
    const def = TOOL_DEFS.find((t) => t.key.toLowerCase() === e.key.toLowerCase())
    if (def) { e.preventDefault(); setTool(def.id) }
  })
  listen(window, 'resize', () => schedule())

  return () => { cancelAnimationFrame(raf); clearTimeout(prevTimer) }
}
