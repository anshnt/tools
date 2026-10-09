// Signature maker: draw (smooth, pressure aware), type (handwriting fonts) or upload (white background removed).
// signatureCreator({onUse(canvas)}) -> element. The canvas handed to onUse has a transparent background, trimmed to the ink.
import { h, icon, button, input, field, tabs, rangeField, dropzone, toggle, toast, errorMessage } from '../../lib/ui.js'
import { loadImage, toCanvas, fitSize } from '../../lib/image.js'
import { css } from './_shared.js'

const CSS = `
.pe-pad-wrap { position: relative; border-radius: 18px; border: 1.5px dashed var(--border-strong); background: repeating-linear-gradient(0deg, transparent 0 39px, #e6e6ec 39px 40px), #fff; overflow: hidden; transition: border-color .2s; }
.pe-pad-wrap:hover, .pe-pad-wrap:focus-within { border-color: var(--accent); }
.pe-pad { display: block; width: 100%; aspect-ratio: 10 / 3.4; touch-action: none; cursor: crosshair; }
.pe-pad-hint { position: absolute; inset: 0; display: grid; place-items: center; color: #676774; font-size: 14px; pointer-events: none; transition: opacity .25s; text-align: center; padding: 0 12px; }
.pe-pad-hint.is-hidden { opacity: 0; }
.pe-ink { display: flex; gap: 8px; align-items: center; }
.pe-ink button { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1.5px var(--border-strong); cursor: pointer; transition: transform .25s var(--spring), box-shadow .2s; padding: 0; }
.pe-ink button:hover { transform: scale(1.12); }
.pe-ink button[aria-pressed="true"] { box-shadow: 0 0 0 2.5px var(--accent); transform: scale(1.1); }
.pe-fonts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 8px; }
.pe-font { height: 64px; border-radius: 14px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; font-size: 26px; line-height: 1; padding: 0 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; transition: all .2s var(--spring); }
.pe-font:hover { border-color: var(--border-strong); transform: translateY(-2px); }
.pe-font[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 3px var(--ring); }
.pe-sigprev { display: grid; place-items: center; min-height: 100px; border-radius: 16px; border: 1px solid var(--border); background: #fff; color: #676774; }
.pe-sigprev canvas { max-width: 100%; max-height: 120px; }
`

export const INKS = [['#111827', 'Black'], ['#1d3a8a', 'Blue'], ['#7f1d1d', 'Dark red']]
export const SIG_FONTS = [['Dancing Script', 700], ['Caveat', 600], ['Great Vibes', 400], ['Sacramento', 400], ['Mrs Saint Delafield', 400], ['Homemade Apple', 400]]
let fontsLoading
/** Load the handwriting fonts from Google Fonts once. Resolves even when offline (the preview falls back to cursive). */
export function loadSignatureFonts() {
  if (!fontsLoading) {
    fontsLoading = new Promise((resolve) => {
      const fams = SIG_FONTS.map(([f, w]) => `family=${f.replace(/ /g, '+')}${w !== 400 ? `:wght@${w}` : ''}`).join('&')
      const link = h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${fams}&display=swap` })
      link.onload = () => Promise.allSettled(SIG_FONTS.map(([f, w]) => document.fonts.load(`${w} 40px "${f}"`, 'Abc'))).then(() => resolve(true))
      link.onerror = () => resolve(false)
      document.head.append(link)
      setTimeout(() => resolve(false), 6000)
    })
  }
  return fontsLoading
}

/** Crop a canvas to its non-transparent pixels with a little padding. Returns null when it is empty. */
export function trimCanvas(src, pad = 8) {
  const { width: w, height: hh } = src
  const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, hh).data
  let x0 = w, y0 = hh, x1 = -1, y1 = -1
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  if (x1 < 0) return null
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hh - 1, y1 + pad)
  const c = document.createElement('canvas')
  c.width = x1 - x0 + 1; c.height = y1 - y0 + 1
  c.getContext('2d').drawImage(src, x0, y0, c.width, c.height, 0, 0, c.width, c.height)
  return c
}

/** Make near-white pixels transparent (soft edge) so a photographed signature can sit on any page. */
export function removeWhite(canvas, cut = 238) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data, lo = Math.max(60, cut - 70)
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const a = lum >= cut ? 0 : lum <= lo ? 255 : Math.round(255 * (cut - lum) / (cut - lo))
    d[i + 3] = Math.min(d[i + 3], a)
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

function drawPad(getInk, getWidth, onDirty) {
  const canvas = h('canvas', { class: 'pe-pad', width: 1500, height: 510, 'aria-label': 'Signature pad. Draw with a mouse, finger or pen.', role: 'img' })
  const hint = h('div', { class: 'pe-pad-hint' }, h('span', 'Sign here with your mouse, finger or pen'))
  const ctx = canvas.getContext('2d')
  const strokes = []
  let cur = null
  const point = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height, p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5, t: e.timeStamp } }
  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    for (const s of strokes) {
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color
      const pts = s.pts
      if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, s.w * 0.6, 0, Math.PI * 2); ctx.fill(); continue }
      let wPrev = s.w
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1] || p1
        const v = Math.hypot(p1.x - p0.x, p1.y - p0.y) / Math.max(1, p1.t - p0.t)
        const target = s.w * (0.55 + 0.9 * p1.p) * Math.max(0.45, 1.25 - Math.min(v, 3) * 0.28)
        wPrev = wPrev * 0.7 + target * 0.3
        ctx.lineWidth = wPrev
        ctx.beginPath()
        ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2)
        ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2)
        ctx.stroke()
      }
    }
    hint.classList.toggle('is-hidden', strokes.length > 0 || !!cur)
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    cur = { color: getInk(), w: getWidth() * 3.2, pts: [point(e)] }
    strokes.push(cur)
    render()
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return
    for (const ev of (e.getCoalescedEvents?.() || [e])) cur.pts.push(point(ev))
    render()
  })
  const end = () => { if (cur) { cur = null; render(); onDirty() } }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  return {
    el: h('div', { class: 'pe-pad-wrap' }, canvas, hint),
    undo() { strokes.pop(); render(); onDirty() },
    clear() { strokes.length = 0; render(); onDirty() },
    isEmpty: () => !strokes.length,
    recolor(c) { for (const s of strokes) s.color = c; render() },
    toCanvas() { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; c.getContext('2d').drawImage(canvas, 0, 0); return trimCanvas(c, 12) },
  }
}

export function signatureCreator({ onUse }) {
  css('pe-signpad', CSS)
  let ink = INKS[0][0]
  const inkRow = h('div', { class: 'pe-ink', role: 'group', 'aria-label': 'Ink colour' }, INKS.map(([c, name]) => h('button', { type: 'button', style: { background: c }, title: name, 'aria-label': name, 'aria-pressed': String(c === ink), onclick: () => { ink = c; for (const b of inkRow.children) b.setAttribute('aria-pressed', String(b.title === name)); pad.recolor(c); renderTyped() } })))
  const widthSlider = rangeField('Pen thickness', { min: 2, max: 10, value: 5, format: (v) => `${v}` })
  const pad = drawPad(() => ink, () => widthSlider.input.valueAsNumber, () => { useDraw.disabled = pad.isEmpty() })
  const useDraw = button('Use this signature', { icon: 'check', variant: 'primary', disabled: true, onClick: () => { const c = pad.toCanvas(); if (c) onUse(c, 'drawn') } })
  const drawTab = h('div', { class: 'stack' }, pad.el, h('div', { class: 'row between' }, inkRow, h('div', { class: 'row' }, button('Undo', { icon: 'undo-2', variant: 'ghost', size: 'sm', onClick: () => pad.undo() }), button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => pad.clear() }))), widthSlider, useDraw)

  // type
  let fontIdx = 0
  const name = input({ placeholder: 'Type your name', 'aria-label': 'Name to sign', value: '', oninput: () => renderTyped() })
  const fontBtns = SIG_FONTS.map(([f, w], i) => h('button', { type: 'button', class: 'pe-font', style: { fontFamily: `"${f}", cursive`, fontWeight: w }, 'aria-pressed': String(i === 0), onclick: () => { fontIdx = i; fontBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i))); renderTyped() } }, 'Your name'))
  const typedPrev = h('div', { class: 'pe-sigprev' }, h('span', { class: 'muted small' }, 'Your signature appears here'))
  const useType = button('Use this signature', { icon: 'check', variant: 'primary', disabled: true, onClick: () => { const c = typedCanvas(); if (c) onUse(c, 'typed') } })
  function typedCanvas() {
    const text = name.value.trim()
    if (!text) return null
    const [f, w] = SIG_FONTS[fontIdx]
    const size = 140
    const m = document.createElement('canvas').getContext('2d')
    m.font = `${w} ${size}px "${f}", cursive`
    const c = document.createElement('canvas')
    c.width = Math.ceil(m.measureText(text).width + 80); c.height = Math.ceil(size * 1.9)
    const ctx = c.getContext('2d')
    ctx.font = `${w} ${size}px "${f}", cursive`; ctx.fillStyle = ink; ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, 40, size * 1.3)
    return trimCanvas(c, 10)
  }
  function renderTyped() {
    for (const b of fontBtns) b.textContent = name.value.trim() || 'Your name'
    const c = typedCanvas()
    useType.disabled = !c
    typedPrev.replaceChildren(c || h('span', { class: 'muted small' }, 'Your signature appears here'))
  }
  const typeTab = h('div', { class: 'stack' }, field('Your name', name), h('div', { class: 'pe-fonts' }, fontBtns), typedPrev, useType)

  // upload
  let uploaded = null
  const clean = toggle('Make the white background transparent', true, () => renderUpload())
  const upPrev = h('div', { class: 'pe-sigprev' }, h('span', { class: 'muted small' }, 'Your upload appears here'))
  const useUp = button('Use this signature', { icon: 'check', variant: 'primary', disabled: true, onClick: () => { const c = uploadedCanvas(); if (c) onUse(c, 'uploaded') } })
  function uploadedCanvas() {
    if (!uploaded) return null
    const c = toCanvas(uploaded, uploaded.width, uploaded.height)
    if (clean.input.checked) removeWhite(c)
    return trimCanvas(c, 6)
  }
  function renderUpload() { const c = uploadedCanvas(); useUp.disabled = !c; upPrev.replaceChildren(c || h('span', { class: 'muted small' }, 'Your upload appears here')) }
  const upTab = h('div', { class: 'stack' }, dropzone({ accept: 'image/*,.heic,.heif', compact: true, paste: false, label: 'Choose a photo or scan of your signature', hint: 'Sign on white paper, take a photo, upload it here.', onFiles: async ([f]) => {
    try { const img = await loadImage(f); const s = fitSize(img.naturalWidth, img.naturalHeight, 1600, 1000); uploaded = toCanvas(img, s.width, s.height); renderUpload() } catch (e) { toast(errorMessage(e), 'error') }
  } }), clean, upPrev, useUp)

  const el = tabs([{ id: 'draw', label: 'Draw', render: () => drawTab }, { id: 'type', label: 'Type', render: () => { loadSignatureFonts().then(() => renderTyped()); return typeTab } }, { id: 'upload', label: 'Upload', render: () => upTab }], 'draw')
  return el
}
