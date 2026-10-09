// Meme generator: classic Impact-style captions (Anton), outline, auto-fit, drag to move, extra text layers.
import { h, panel, split, field, textarea, button, busy, clear, download, toast, formatBytes, rangeField, toggle, select, onCleanup } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, heroDrop, stage, pills, newCanvas, capSize, encode, formatPicker, done, scaled, stem, clamp, IMG_ACCEPT, sampleCanvas } from './_shared.js'

const FONTS = [
  ['Anton', '"Anton", Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif', 'Anton (classic)'],
  ['Impact', 'Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif', 'Impact (system)'],
  ['Arial Black', '"Arial Black", "Arial Bold", Gadget, sans-serif', 'Arial Black'],
  ['Comic', '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive', 'Comic'],
  ['Serif', 'Georgia, "Times New Roman", serif', 'Serif bold'],
]
const FILLS = [['#ffffff', 'White'], ['#ffe14a', 'Yellow'], ['#111111', 'Black'], ['#ff4d6d', 'Pink']]
const OUTLINES = [['#000000', 'Black'], ['#ffffff', 'White'], ['#2b1d6b', 'Navy']]
const BLANKS = [['Square', 1080, 1080], ['Wide', 1280, 720], ['Tall', 1080, 1350]]
const BLANK_COLORS = ['#6d5dfc', '#ff7a59', '#22c55e', '#0ea5e9', '#111111', '#f6efe0']

let sheet = null
/** Load Anton from Google Fonts. Resolves (never rejects) so a blocked font falls back to Impact. Pass the text to also load its glyph subset. */
export function ensureFont(text = 'MEME') {
  if (!sheet) {
    sheet = new Promise((resolve) => {
      let link = document.getElementById('is-anton')
      if (link) return resolve()
      link = h('link', { id: 'is-anton', rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Anton&display=swap' })
      link.onload = () => resolve()
      link.onerror = () => resolve()
      setTimeout(resolve, 5000)
      document.head.append(link)
    })
  }
  return sheet.then(() => Promise.race([document.fonts.load('64px Anton', text || 'MEME').then(() => true).catch(() => false), new Promise((r) => setTimeout(() => r(false), 4000))]))
}

/** Wrap text into lines that fit maxW at the current ctx font. */
export function wrapLines(g, text, maxW) {
  const out = []
  for (const para of text.split(/\r?\n/)) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word
      if (g.measureText(t).width <= maxW || !line) line = t
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

export function mount(root) {
  addStyle('is-meme', `
.t-meme .cvwrap { position: relative; width: fit-content; max-width: 100%; margin: 0 auto; line-height: 0; }
.t-meme canvas.cv { display: block; max-width: 100%; max-height: 640px; width: auto; height: auto; border-radius: 6px; cursor: grab; touch-action: none; box-shadow: 0 24px 48px -26px rgba(10, 10, 30, .55), 0 0 0 1px rgba(0, 0, 0, .1); outline: none; }
.t-meme canvas.cv:focus-visible { box-shadow: 0 0 0 3px var(--accent); }
.t-meme canvas.cv.drag { cursor: grabbing; }
.t-meme .layers { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.t-meme .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-meme .swatches { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.t-meme .swatches button { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--border); cursor: pointer; padding: 0; transition: transform .2s var(--spring), box-shadow .2s; }
.t-meme .swatches button:hover { transform: scale(1.12); }
.t-meme .swatches button[aria-pressed="true"] { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--accent); }
.t-meme .swatches input[type=color] { width: 30px; height: 30px; padding: 0; border: 2px solid var(--border); border-radius: 50%; background: none; cursor: pointer; overflow: hidden; }
.t-meme .blank { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.t-meme .blank i { width: 26px; height: 26px; border-radius: 8px; border: 2px solid var(--border); cursor: pointer; display: inline-block; transition: transform .2s var(--spring); }
.t-meme .blank i:hover { transform: scale(1.15); }
`)
  let base = null // {canvas | img, w, h, name}
  let layers = []
  let sel = 0
  let nextId = 1
  const mkLayer = (text, y, extra = {}) => ({ id: nextId++, text, x: 0.5, y, size: 11, fit: true, font: 0, fill: '#ffffff', stroke: '#000000', sw: 12, upper: true, rot: 0, ...extra })

  const drop = heroDrop({ accept: IMG_ACCEPT, sample: 0, label: 'Drop a picture to make a meme', onFiles: ([f]) => load(f) })
  const sampleBtn = button('Try a sample picture', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: () => startBlank(null, sampleCanvas(3, 1200, 800), 'sample') })
  const blankBox = h('div', { class: 'blank' })
  const blankSize = { i: 0 }
  function drawBlank() {
    clear(blankBox, h('span', { class: 'small muted' }, 'Or start with a color:'),
      BLANK_COLORS.map((c) => h('i', { style: `background:${c}`, role: 'button', tabindex: 0, 'aria-label': `Blank canvas ${c}`, onclick: () => startBlank(c), onkeydown: (e) => { if (e.key === 'Enter') startBlank(c) } })),
      pills(BLANKS.map((b, i) => [i, b[0]]), blankSize.i, (v) => { blankSize.i = v }, 'Blank canvas shape'))
  }
  drawBlank()

  const work = h('div', { class: 'stack', hidden: true })
  const cv = h('canvas', { class: 'cv', tabindex: 0, role: 'img', 'aria-label': 'Meme. Drag the text to move it, or use the arrow keys.' })
  const wrap = h('div', { class: 'cvwrap' }, cv)
  const caption = h('div', { class: 'is-cap' }, h('span', 'Drag the text on the picture to move it'))
  const result = h('div')
  const layerBar = h('div', { class: 'layers' })
  const editor = h('div', { class: 'stack' })

  const fmt = formatPicker({ value: 'image/png' })
  const dlBtn = button('Download meme', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  const copyBtn = button('Copy to clipboard', { icon: 'clipboard-copy', block: true })
  const controls = panel(h('div', { class: 'stack' }, layerBar, editor, fmt.el, dlBtn, copyBtn, result))

  const allText = () => layers.map((l) => l.text).join(' ')
  let fontTimer = 0
  const refont = () => { clearTimeout(fontTimer); fontTimer = setTimeout(() => ensureFont(allText()).then(() => render()), 250) }
  onCleanup(() => clearTimeout(fontTimer))

  // ---------- drawing ----------
  function drawLayer(g, L, W, H, ui) {
    const font = FONTS[L.font][1]
    const text = L.upper ? L.text.toUpperCase() : L.text
    if (!text.trim()) return null
    const maxW = W * 0.94
    let px = (L.size / 100) * W
    let lines
    g.lineJoin = 'round'; g.miterLimit = 2; g.textAlign = 'center'; g.textBaseline = 'middle'
    const setFont = (p) => { g.font = `${p}px ${font}` }
    if (L.fit) {
      // shrink on a single line first, then wrap
      const min = px * 0.55
      let p = px
      setFont(p)
      const single = text.replace(/\s*\n\s*/g, ' ')
      while (p > min && g.measureText(single).width > maxW) { p *= 0.97; setFont(p) }
      if (g.measureText(single).width <= maxW && !text.includes('\n')) { lines = [single]; px = p }
      else {
        p = Math.min(px, min * 1.25)
        setFont(p)
        lines = wrapLines(g, text, maxW)
        while (lines.length > 4 && p > px * 0.3) { p *= 0.94; setFont(p); lines = wrapLines(g, text, maxW) }
        px = p
      }
    } else { setFont(px); lines = wrapLines(g, text, maxW) }
    setFont(px)
    const lh = px * 1.08, bh = lines.length * lh
    const bw = Math.max(...lines.map((l) => g.measureText(l).width))
    const cx = clamp(L.x, 0, 1) * W
    // keep multi-line captions inside the picture
    const cy = bh < H ? clamp(clamp(L.y, 0, 1) * H, bh / 2 + px * 0.12, H - bh / 2 - px * 0.12) : H / 2
    L._drawY = cy / H
    g.save()
    g.translate(cx, cy)
    g.rotate((L.rot * Math.PI) / 180)
    lines.forEach((l, i) => {
      const y = (i - (lines.length - 1) / 2) * lh
      if (L.sw > 0) { g.strokeStyle = L.stroke; g.lineWidth = Math.max(1, (px * L.sw) / 100 * 1.6); g.strokeText(l, 0, y) }
      g.fillStyle = L.fill; g.fillText(l, 0, y)
    })
    if (ui) { g.strokeStyle = '#6d5dfc'; g.lineWidth = Math.max(2, W / 400); g.setLineDash([W / 100, W / 160]); g.strokeRect(-bw / 2 - px * 0.12, -bh / 2 - px * 0.08, bw + px * 0.24, bh + px * 0.16); g.setLineDash([]) }
    g.restore()
    // axis-aligned bounds for hit testing
    const rad = (L.rot * Math.PI) / 180, hw = bw / 2 + px * 0.2, hh = bh / 2 + px * 0.15
    const ex = Math.abs(hw * Math.cos(rad)) + Math.abs(hh * Math.sin(rad)), ey = Math.abs(hw * Math.sin(rad)) + Math.abs(hh * Math.cos(rad))
    return { x: cx - ex, y: cy - ey, w: ex * 2, h: ey * 2 }
  }

  function paint(g, W, H, ui) {
    g.clearRect(0, 0, W, H)
    if (base.canvas) g.drawImage(base.canvas, 0, 0, W, H)
    else { g.imageSmoothingQuality = 'high'; g.drawImage(base.img, 0, 0, W, H) }
    layers.forEach((L, i) => { L._box = drawLayer(g, L, W, H, ui && i === sel) })
  }

  function previewSize() {
    const k = Math.min(1, 1100 / Math.max(base.w, base.h))
    return [Math.round(base.w * k), Math.round(base.h * k)]
  }
  function render() {
    if (!base) return
    const [W, H] = previewSize()
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    paint(cv.getContext('2d'), W, H, true)
  }

  // ---------- editor ----------
  const swatchRow = (colors, value, onPick, label) => {
    const inp = h('input', { type: 'color', value, 'aria-label': `${label} custom`, oninput: () => onPick(inp.value) })
    return h('div', { class: 'swatches', role: 'group', 'aria-label': label }, colors.map(([c, n]) => h('button', { type: 'button', style: `background:${c}`, title: n, 'aria-label': n, 'aria-pressed': String(c === value), onclick: () => onPick(c) })), inp)
  }
  function renderBar() {
    clear(layerBar, layers.map((L, i) => h('button', { type: 'button', class: 'is-chip', 'aria-pressed': String(i === sel), onclick: () => { sel = i; renderBar(); renderEditor(); render() } }, i === 0 ? 'Top' : i === 1 ? 'Bottom' : `Text ${i + 1}`)),
      button('Add text', { icon: 'plus', size: 'sm', onClick: () => { layers.push(mkLayer('NEW TEXT', 0.5, { fit: true })); sel = layers.length - 1; renderBar(); renderEditor(); render() } }))
  }
  function renderEditor() {
    const L = layers[sel]
    if (!L) return clear(editor)
    const text = textarea({ rows: 2, value: L.text, placeholder: 'Type your caption', 'aria-label': 'Caption text', oninput: () => { L.text = text.value; render(); refont() } })
    const size = rangeField('Size', { min: 3, max: 30, step: 0.5, value: L.size, format: (v) => `${v}%`, onInput: (v) => { L.size = v; render() } })
    const sw = rangeField('Outline', { min: 0, max: 30, value: L.sw, format: (v) => `${v}%`, onInput: (v) => { L.sw = v; render() } })
    const rot = rangeField('Tilt', { min: -30, max: 30, value: L.rot, format: (v) => `${v} deg`, onInput: (v) => { L.rot = v; render() } })
    const fontSel = select(FONTS.map((f, i) => [i, f[2]]), L.font, (v) => { L.font = +v; render() })
    clear(editor, field('Caption', text), h('div', { class: 'row2' }, field('Font', fontSel), h('div', { class: 'stack tight', style: 'padding-top:22px' }, toggle('ALL CAPS', L.upper, (v) => { L.upper = v; render() }), toggle('Shrink to fit', L.fit, (v) => { L.fit = v; render() }))),
      size, sw, rot, field('Text color', swatchRow(FILLS, L.fill, (c) => { L.fill = c; renderEditor(); render() }, 'Text color')), field('Outline color', swatchRow(OUTLINES, L.stroke, (c) => { L.stroke = c; renderEditor(); render() }, 'Outline color')),
      h('div', { class: 'row' }, button('Center it', { icon: 'align-center-horizontal', size: 'sm', onClick: () => { L.x = 0.5; render() } }), layers.length > 1 ? button('Delete this text', { icon: 'trash-2', variant: 'danger', size: 'sm', onClick: () => { layers.splice(sel, 1); sel = Math.max(0, sel - 1); renderBar(); renderEditor(); render() } }) : null))
  }

  // ---------- dragging ----------
  let drag = null
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height] }
  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = pt(e)
    let hit = -1
    for (let i = layers.length - 1; i >= 0; i--) { const b = layers[i]._box; if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { hit = i; break } }
    if (hit < 0) return
    cv.setPointerCapture(e.pointerId)
    if (hit !== sel) { sel = hit; renderBar(); renderEditor() }
    const L = layers[sel]
    if (L._drawY != null) L.y = L._drawY
    drag = { dx: x - L.x * cv.width, dy: y - L.y * cv.height }
    cv.classList.add('drag')
    render()
  })
  cv.addEventListener('pointermove', (e) => {
    if (!drag) return
    const [x, y] = pt(e), L = layers[sel]
    L.x = clamp((x - drag.dx) / cv.width, 0, 1); L.y = clamp((y - drag.dy) / cv.height, 0, 1)
    render()
  })
  const end = () => { drag = null; cv.classList.remove('drag') }
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end)
  cv.addEventListener('keydown', (e) => {
    const L = layers[sel], d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (!L || !d) return
    e.preventDefault()
    const step = e.shiftKey ? 0.05 : 0.01
    L.x = clamp(L.x + d[0] * step, 0, 1); L.y = clamp(L.y + d[1] * step, 0, 1)
    render()
  })

  // ---------- export ----------
  async function exportCanvas() {
    const cap = capSize(Math.min(base.w, 4096), Math.round((Math.min(base.w, 4096) / base.w) * base.h))
    const c = newCanvas(cap.w, cap.h)
    paint(c.getContext('2d'), cap.w, cap.h, false)
    return c
  }
  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    await ensureFont(allText())
    const c = await exportCanvas()
    const blob = await encode(c, fmt.type, fmt.quality, '#ffffff')
    download(blob, `${stem(base.name)}-meme.${fmt.ext}`)
    clear(result, done('Meme saved', `${c.width} x ${c.height} px, ${formatBytes(blob.size)}`))
  }, { label: 'Rendering', errorTo: result }))
  copyBtn.addEventListener('click', () => busy(copyBtn, async () => {
    const blob = await encode(await exportCanvas(), 'image/png')
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Meme copied. Paste it into a chat.', 'success') } catch { toast('This browser blocked copying images. Use Download instead.', 'error') }
  }, { errorTo: result }))

  // ---------- loading ----------
  function start(b) {
    base = b
    layers = [mkLayer('TOP TEXT', 0.1), mkLayer('BOTTOM TEXT', 0.9)]
    sel = 0
    drop.setCompact(true); sampleBtn.hidden = true; blankBox.hidden = true
    work.hidden = false
    clear(result)
    renderBar(); renderEditor()
    ensureFont(allText()).then(() => render())
    render()
  }
  async function load(file) {
    try {
      const img = await loadImage(file)
      const canvas = img.naturalWidth * img.naturalHeight > 40_000_000 ? scaled(img, 6000) : null
      start({ img, canvas, w: canvas ? canvas.width : img.naturalWidth, h: canvas ? canvas.height : img.naturalHeight, name: file.name })
    } catch (e) { toast(e.message, 'error') }
  }
  function startBlank(color, canvas, name = 'blank') {
    let c = canvas
    if (!c) { const [, w, hh] = BLANKS[blankSize.i]; c = newCanvas(w, hh); const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, hh) }
    start({ canvas: c, w: c.width, h: c.height, name })
  }

  work.append(split(stage(wrap, caption), controls, 'wide-left'))
  root.append(h('div', { class: 't-meme stack' }, drop, h('div', { class: 'row' }, sampleBtn), blankBox, work))
}
