// Remove objects from a photo: paint over what you want gone (brush or box), then fill it in with MI-GAN or LaMa
// (on-device AI) or an instant smooth fill. Undo and redo cover both the painting and each removal.
// Also serves remove-text-from-image via params.focus = 'text'.
import { h, icon, button, busy, alert, clear, segmented, rangeField, toast, download, formatBytes } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { canvas as makeCanvas, canEncode } from '../../lib/image.js'
import { loadWorking, canvasBlob, friendlyError, isReady, releaseSessions } from './_ml.js'
import { inpaint, MODELS } from './_inpaint.js'
import { shell, steps, heroDrop, panelOf, section, stage, scanFx, optionCards, note, drag, burst } from './_ui.js'

const DISP_MAX = 2200
const ZOOMS = [['1', 'Fit'], ['1.6', '160%'], ['2.5', '250%'], ['4', '400%']]

export function mount(root, { params, signal }) {
  const textMode = params.focus === 'text'
  const st = { tool: textMode ? 'rect' : 'brush', size: 36, grow: textMode ? 7 : 5, model: 'fast', zoom: 1, fmt: 'jpg', quality: 92 }
  let work = null, base = null, orig = null, dw = 0, dh = 0
  let strokes = [], ops = [], redo = []
  let showOrig = false, busyRun = false, name = ''
  let ctl = new AbortController()
  signal.addEventListener('abort', () => ctl.abort())

  injectStyle()
  const stepper = steps(['Add photo', 'Paint over it', 'Download'], 0)
  const imgCv = document.createElement('canvas')
  const maskCv = document.createElement('canvas')
  maskCv.className = 'ia-ro-mask'
  const cursor = h('div', { class: 'ia-ro-cursor', hidden: true })
  const inner = h('div', { class: 'ia-ro-inner' }, imgCv, maskCv, cursor)
  const scroll = h('div', { class: 'ia-ro-scroll' }, inner)
  const stg = stage('on-plain')
  const scan = scanFx()
  const nameChip = h('div', { class: 'ia-chip bl' }, icon('image'), h('span', ''))
  const statusChip = h('div', { class: 'ia-chip br', hidden: true }, icon('check'), h('span', ''))
  const holdBtn = button('Hold to compare', { icon: 'eye', variant: 'secondary', size: 'sm' })
  const hold = (on) => { showOrig = on; refreshImg(); maskCv.style.visibility = on ? 'hidden' : '' }
  holdBtn.addEventListener('pointerdown', () => hold(true))
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) holdBtn.addEventListener(ev, () => hold(false))
  stg.append(scroll, nameChip, statusChip, h('div', { class: 'ia-tools' }, holdBtn), scan.el)
  stg.style.padding = '8px'
  const msgSlot = h('div')

  // ---------- controls
  const toolSeg = segmented([['brush', 'Brush'], ['rect', 'Box'], ['erase', 'Un-paint'], ['pan', 'Move']], st.tool, (v) => setTool(v), 'Tool')
  const sizeR = rangeField('Brush size', { min: 6, max: 160, value: st.size, format: (v) => `${v}`, onInput: (v) => { st.size = v; sizeCursor() } })
  const growR = rangeField('Cover edges and shadows', { min: 0, max: 20, value: st.grow, format: (v) => `${v}`, hint: 'Grows your painting a little so no outline is left behind.', onInput: (v) => { st.grow = v } })
  const modelOpts = () => Object.values(MODELS).map((m) => ({
    value: m.key, title: m.name, desc: m.desc, icon: m.key === 'fast' ? 'zap' : m.key === 'best' ? 'gem' : 'wand-sparkles',
    tags: [m.mb ? (isReady(m.id) ? { text: 'Ready', cls: 'ok' } : `${m.mb} MB`) : { text: 'No download', cls: 'ok' }, m.sub],
  }))
  const models = optionCards(modelOpts(), st.model, (v) => { st.model = v }, { col: true, label: 'Fill engine' })
  const zoomSeg = segmented(ZOOMS, '1', (v) => { st.zoom = Number(v); applyZoom() }, 'Zoom')
  const fmtSeg = segmented([['jpg', 'JPG'], ['png', 'PNG'], ...(canEncode('image/webp') ? [['webp', 'WebP']] : [])], st.fmt, (v) => { st.fmt = v; quality.hidden = v === 'png' }, 'File format')
  const quality = rangeField('Quality', { min: 50, max: 100, value: st.quality, format: (v) => `${v}%`, onInput: (v) => { st.quality = v } })
  const panel = panelOf(
    section('Select what to remove', 'brush', [toolSeg, sizeR, growR, note('keyboard', 'Shortcuts: [ and ] change the brush size, Ctrl+Z undo, Ctrl+Y redo.')]),
    section('Fill engine', 'cpu', [models, note('shield-check', 'Models run on your device and download once. Your photo is never uploaded.')]),
    section('View', 'zoom-in', [zoomSeg], false),
    section('Download', 'download', [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Format'), fmtSeg), quality], false))

  const undoBtn = button('Undo', { icon: 'undo-2', variant: 'secondary', size: 'sm', onClick: undo })
  const redoBtn = button('Redo', { icon: 'redo-2', variant: 'secondary', size: 'sm', onClick: doRedo })
  const clearBtn = button('Clear painting', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { strokes = []; redo = []; repaintMask(); sync() } })
  const runBtn = button(textMode ? 'Remove the text' : 'Remove it', { icon: 'wand-sparkles', variant: 'primary', size: 'lg' })
  runBtn.addEventListener('click', () => busy(runBtn, runErase, { label: 'Removing', errorTo: msgSlot }))
  const bar = h('div', { class: 'ia-sticky ia-actionbar' }, undoBtn, redoBtn, clearBtn, h('span', { class: 'grow' }), runBtn)

  const dlBtn = button('Download photo', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    if (!base) return
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[st.fmt]
    const blob = await canvasBlob(base, type, st.quality / 100)
    download(blob, suffixName(name, 'cleaned', st.fmt))
    toast(`Saved (${formatBytes(blob.size)})`, 'success')
  }, { label: 'Preparing file', errorTo: msgSlot }))
  const resetBtn = button('Reset to original', { icon: 'rotate-ccw', variant: 'secondary', block: true, onClick: () => { if (!orig) return; ops = []; redo = []; strokes = []; base.getContext('2d').drawImage(orig, 0, 0); repaintMask(); refreshImg(); sync(); statusChip.hidden = true } })
  const another = button('Use another photo', { icon: 'image-up', variant: 'ghost', block: true, onClick: () => { hero.zone.open() } })
  const side = h('div', { class: 'ia-side' }, panel, h('div', { class: 'stack tight' }, dlBtn, resetBtn, another))
  const studioEl = h('div', { class: 'ia-studio', hidden: true }, h('div', { class: 'ia-main' }, stg, bar, msgSlot), side)

  const hero = heroDrop({
    accept: 'image/*', label: textMode ? 'Drop a photo with text or a watermark' : 'Drop a photo to clean up',
    hint: textMode ? 'Paint over the caption, date stamp or watermark and it is filled in with the surrounding picture.' : 'Remove tourists, wires, signs, spots and clutter. Paste with Ctrl+V works too.',
    icons: ['wand-sparkles', 'eraser', 'brush', 'sparkles'],
    features: [['shield-check', 'Stays on your device'], ['brush', 'Brush or box'], ['undo-2', 'Undo anything']],
    onFiles: ([f]) => openFile(f),
  })
  shell(root, stepper, hero, studioEl)

  // ---------- image state
  async function openFile(file) {
    ctl.abort(); ctl = new AbortController()
    clear(msgSlot)
    hero.hidden = true; studioEl.hidden = false
    scan.start('Opening your photo')
    try {
      work = await loadWorking(file, { maxSide: 4096 })
    } catch (e) { scan.stop(); clear(msgSlot, alert('error', friendlyError(e).message)); hero.hidden = false; studioEl.hidden = true; return }
    scan.stop()
    name = file.name
    base = makeCanvas(work.width, work.height); base.getContext('2d').drawImage(work.canvas, 0, 0)
    orig = work.canvas
    const k = Math.min(1, DISP_MAX / Math.max(work.width, work.height))
    dw = Math.max(1, Math.round(work.width * k)); dh = Math.max(1, Math.round(work.height * k))
    imgCv.width = dw; imgCv.height = dh; maskCv.width = dw; maskCv.height = dh
    inner.style.aspectRatio = `${work.width} / ${work.height}`
    ops = []; redo = []; strokes = []
    nameChip.querySelector('span').textContent = `${name}  -  ${work.originalWidth} x ${work.originalHeight}`
    statusChip.hidden = true
    applyZoom()
    refreshImg()
    sync()
    stepper.set(1)
  }

  function applyZoom() {
    inner.style.width = st.zoom === 1 ? '100%' : `${st.zoom * 100}%`
    inner.style.maxHeight = ''
    scroll.classList.toggle('zoomed', st.zoom > 1)
    // In fit mode the image is limited by height so it never needs scrolling
    if (st.zoom === 1) inner.style.width = `min(100%, calc(70vh * ${work ? work.width / work.height : 1}))`
  }

  function refreshImg() {
    if (!base) return
    const c = imgCv.getContext('2d')
    c.imageSmoothingQuality = 'high'
    c.drawImage(showOrig ? orig : base, 0, 0, dw, dh)
  }

  // ---------- painting
  const strokeColor = '#ff3b6b'
  function drawStroke(c, s, from = 0) {
    c.save()
    c.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over'
    c.strokeStyle = c.fillStyle = strokeColor
    c.lineCap = c.lineJoin = 'round'
    if (s.tool === 'rect') {
      const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]]
      c.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))
    } else {
      c.lineWidth = s.size
      c.beginPath()
      const p0 = s.pts[Math.max(0, from - 1)]
      c.moveTo(p0[0], p0[1])
      if (s.pts.length === 1) c.lineTo(p0[0] + 0.01, p0[1])
      for (let i = Math.max(1, from); i < s.pts.length; i++) c.lineTo(s.pts[i][0], s.pts[i][1])
      c.stroke()
    }
    c.restore()
  }
  function repaintMask() {
    const c = maskCv.getContext('2d')
    c.clearRect(0, 0, dw, dh)
    for (const s of strokes) drawStroke(c, s)
  }

  const toCanvasXY = (e) => {
    const r = maskCv.getBoundingClientRect()
    return [(e.clientX - r.left) * (dw / r.width), (e.clientY - r.top) * (dh / r.height)]
  }
  const canvasPerCss = () => dw / (maskCv.getBoundingClientRect().width || dw)

  let cur = null
  drag(inner, (type, e) => {
    if (!base || busyRun) return
    if (st.tool === 'pan') {
      if (type === 'down') cur = { x: e.clientX, y: e.clientY, sl: scroll.scrollLeft, st: scroll.scrollTop }
      else if (type === 'move' && cur) { scroll.scrollLeft = cur.sl - (e.clientX - cur.x); scroll.scrollTop = cur.st - (e.clientY - cur.y) }
      else cur = null
      return
    }
    const p = toCanvasXY(e)
    const c = maskCv.getContext('2d')
    if (type === 'down') {
      cur = { tool: st.tool, size: st.size * canvasPerCss(), pts: [p] }
      if (cur.tool !== 'rect') drawStroke(c, cur, 0)
    } else if (type === 'move' && cur) {
      cur.pts.push(p)
      if (cur.tool === 'rect') { repaintMask(); drawStroke(c, cur) } else drawStroke(c, cur, cur.pts.length - 1)
    } else if (type === 'up' && cur) {
      if (cur.tool === 'rect' && (Math.abs(cur.pts[0][0] - p[0]) < 3 || Math.abs(cur.pts[0][1] - p[1]) < 3)) { cur = null; repaintMask(); return }
      strokes.push(cur); redo = []
      cur = null
      sync()
    }
  })

  // brush cursor
  inner.addEventListener('pointermove', (e) => {
    if (!base || st.tool === 'pan' || st.tool === 'rect') { cursor.hidden = true; return }
    const r = inner.getBoundingClientRect()
    cursor.hidden = false
    cursor.style.left = `${e.clientX - r.left}px`; cursor.style.top = `${e.clientY - r.top}px`
    sizeCursor()
  })
  inner.addEventListener('pointerleave', () => { cursor.hidden = true })
  function sizeCursor() { cursor.style.width = cursor.style.height = `${st.size}px` }
  function setTool(v) {
    st.tool = v
    toolSeg.set(v)
    inner.dataset.tool = v
    sizeR.hidden = v === 'rect' || v === 'pan'
  }
  setTool(st.tool)

  // ---------- undo / redo
  function undo() {
    if (busyRun) return
    const last = ops[ops.length - 1]
    if (strokes.length) { redo.push({ type: 'stroke', stroke: strokes.pop() }); repaintMask() }
    else if (last) {
      ops.pop()
      const c = base.getContext('2d')
      for (const p of [...last.patches].reverse()) c.putImageData(p.before, p.x, p.y)
      strokes = last.strokes
      redo.push({ type: 'erase', op: last })
      repaintMask(); refreshImg()
    }
    sync()
  }
  function doRedo() {
    if (busyRun) return
    const r = redo.pop()
    if (!r) return
    if (r.type === 'stroke') strokes.push(r.stroke), repaintMask()
    else {
      const c = base.getContext('2d')
      for (const p of r.op.patches) c.putImageData(p.after, p.x, p.y)
      ops.push(r.op); strokes = []
      repaintMask(); refreshImg()
    }
    sync()
  }
  function sync() {
    undoBtn.disabled = !strokes.length && !ops.length
    redoBtn.disabled = !redo.length
    clearBtn.disabled = !strokes.length
    runBtn.disabled = !strokes.some((s) => s.tool !== 'erase')
    stepper.set(!base ? 0 : ops.length ? 2 : 1)
  }

  // ---------- remove
  async function runErase() {
    if (!base || !strokes.length) return
    clear(msgSlot)
    // painted pixels at display resolution -> full resolution mask
    const full = makeCanvas(work.width, work.height)
    const fx = full.getContext('2d', { willReadFrequently: true })
    fx.imageSmoothingQuality = 'high'
    fx.drawImage(maskCv, 0, 0, work.width, work.height)
    const d = fx.getImageData(0, 0, work.width, work.height).data
    const mask = new Uint8Array(work.width * work.height)
    let any = false
    for (let i = 0; i < mask.length; i++) if (d[i * 4 + 3] > 40) { mask[i] = 1; any = true }
    if (!any) { toast('Paint over the thing you want to remove first.'); return }
    busyRun = true
    ctl = new AbortController()
    scan.onCancel = () => ctl.abort()
    scan.start(st.model === 'instant' ? 'Filling it in' : 'Loading the AI model', true)
    const t0 = performance.now()
    try {
      const patches = await inpaint(base, mask, {
        model: st.model, grow: st.grow, signal: ctl.signal,
        onProgress: (f, l) => scan.update(f, l),
      })
      ops.push({ patches, strokes })
      strokes = []; redo = []
      repaintMask(); refreshImg()
      models.refresh(modelOpts())
      statusChip.hidden = false
      statusChip.querySelector('span').textContent = `Removed in ${((performance.now() - t0) / 1000).toFixed(1)} s`
      burst(stg, 10)
    } catch (e) {
      if (e?.code === 'ABORT' || e?.name === 'AbortError') toast('Cancelled')
      else {
        console.error(e)
        const m = friendlyError(e).message
        clear(msgSlot, alert('error', m, ' ', st.model !== 'instant' ? button('Use Instant fill', { size: 'sm', onClick: () => { st.model = 'instant'; models.set('instant'); clear(msgSlot) } }) : null))
      }
    } finally {
      scan.stop(); busyRun = false; sync()
    }
  }

  const onKey = (e) => {
    if (studioEl.hidden || e.target.closest?.('input, textarea, select')) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo() }
    else if (e.key === '[') { st.size = Math.max(6, st.size - 6); sizeR.set(st.size); sizeCursor() }
    else if (e.key === ']') { st.size = Math.min(160, st.size + 6); sizeR.set(st.size); sizeCursor() }
  }
  document.addEventListener('keydown', onKey)
  sync()
  return () => { ctl.abort(); document.removeEventListener('keydown', onKey); releaseSessions() }
}

let styled = false
function injectStyle() {
  if (styled || document.getElementById('ia-ro-style')) return
  styled = true
  document.head.append(h('style', { id: 'ia-ro-style' }, `
.ia-ro-scroll { width: 100%; max-height: 74vh; overflow: auto; display: grid; place-items: start center; border-radius: 12px; -webkit-overflow-scrolling: touch; }
.ia-ro-scroll:not(.zoomed) { overflow: hidden; }
.ia-ro-inner { position: relative; max-width: none; touch-action: none; cursor: none; user-select: none; -webkit-user-select: none; border-radius: 6px; overflow: hidden; box-shadow: 0 10px 30px -14px rgba(0, 0, 0, .4); }
.ia-ro-inner[data-tool="rect"] { cursor: crosshair; }
.ia-ro-inner[data-tool="pan"] { cursor: grab; }
.ia-ro-scroll:not(.zoomed) .ia-ro-inner { max-width: 100%; }
.ia-ro-inner canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; max-height: none !important; border-radius: 0 !important; display: block; }
.ia-ro-inner canvas.ia-ro-mask { opacity: .55; mix-blend-mode: normal; }
.ia-ro-cursor { position: absolute; z-index: 4; pointer-events: none; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .55), inset 0 0 0 1px rgba(0, 0, 0, .35); background: rgba(255, 59, 107, .22); transform: translate(-50%, -50%); }
`))
}
