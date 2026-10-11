// Edit text in an image, on your device. The OCR finds each line of text, you click one and type the new words, the old
// letters are erased with the on-device fill (instant, or the same AI models as "Remove objects") and the new text is drawn
// in a matching font, colour and size. Several edits per photo, undo and redo, before and after, same-format download.
import { h, icon, button, busy, alert, clear, segmented, rangeField, toggle, select as selectEl, field, toast, download, formatBytes, fileType } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { canvas as makeCanvas, canEncode } from '../../lib/image.js'
import { recognize, OCR_LANGS } from '../../lib/ocr.js'
import { load as getPref, save as setPref } from '../../lib/store.js'
import { loadWorking, canvasBlob, friendlyError, isReady, releaseSessions } from './_ml.js'
import { inpaint, MODELS } from './_inpaint.js'
import { wordsOf } from './image-to-text.js'
import { shell, steps, heroDrop, panelOf, section, stage, scanFx, optionCards, note, swatches, drag, burst } from './_ui.js'
import { FONTS, analyze, guessStyle, drawText, paddedCrop } from './_text.js'

const DISP_MAX = 2200
const ZOOMS = [['1', 'Fit'], ['1.6', '160%'], ['2.5', '250%'], ['4', '400%']]
const COLORS = ['#000000', '#ffffff', '#e11d48', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed']
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

const scaleBox = (b, k) => ({ x: b.x0 * k, y: b.y0 * k, w: (b.x1 - b.x0) * k, h: (b.y1 - b.y0) * k })

/** Text lines with boxes, a guessed alignment and slope from an OCR result. k = OCR pixels per image pixel. */
export function linesOf(data, k, W) {
  const out = []
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      const ls = (p.lines || []).filter((l) => l.text?.trim() && l.bbox && l.confidence >= 20)
      const pb = scaleBox(p.bbox, 1 / k)
      for (const l of ls) {
        const box = scaleBox(l.bbox, 1 / k)
        if (box.h < 5 || box.w < 5) continue
        let align = 'left'
        const cx = box.x + box.w / 2
        if (ls.length > 1) {
          const tol = pb.w * 0.04 + 3
          const L = Math.abs(box.x - pb.x) < tol, R = Math.abs(box.x + box.w - (pb.x + pb.w)) < tol, C = Math.abs(cx - (pb.x + pb.w / 2)) < tol
          align = L ? 'left' : R ? 'right' : C ? 'center' : 'left'
        } else if (Math.abs(cx - W / 2) < W * 0.03) align = 'center'
        const bl = l.baseline
        let rot = bl && bl.x1 > bl.x0 ? (Math.atan2(bl.y1 - bl.y0, bl.x1 - bl.x0) * 180) / Math.PI : 0
        rot = Math.abs(rot) >= 1 && Math.abs(rot) < 25 ? Math.round(rot * 2) / 2 : 0
        out.push({ text: l.text.trim(), box, align, rot })
      }
    }
  }
  return out
}

export function mount(root, { signal }) {
  const saved = getPref('image-ai:edit-text', {})
  const st = { tool: 'select', mode: 'lines', model: 'instant', zoom: 1, fmt: 'png', quality: 92, lang: OCR_LANGS.some(([c]) => c === saved.lang) ? saved.lang : 'eng', step: 1 }
  let work = null, orig = null, clean = null, refined = null, refinedSig = ''
  let W = 0, H = 0, dw = 0, dh = 0, name = 'image.png'
  let found = { lines: [], words: [] }
  let edits = [], sel = null, seq = 0
  const cache = new Map() // edit id -> {an, fills: {model: patches}}
  let hist = [], pos = 0, lastKey = '', lastT = 0
  let showOrig = false, busyRun = false, openSeq = 0
  let chain = Promise.resolve()
  let ctl = new AbortController()
  signal.addEventListener('abort', () => ctl.abort())

  injectStyle()
  const stepper = steps(['Add photo', 'Edit the text', 'Download'], 0)
  const view = document.createElement('canvas')
  view.setAttribute('role', 'img')
  view.setAttribute('aria-label', 'Your photo with the text edits')
  const boxLayer = h('div', { class: 'ia-et-boxes' })
  const rub = h('div', { class: 'ia-et-rub', hidden: true })
  const drawSurf = h('div', { class: 'ia-et-draw', hidden: true, 'aria-hidden': 'true' }, rub)
  const edTa = h('textarea', { class: 'textarea', rows: 1, 'aria-label': 'New text', placeholder: 'Type the new text', spellcheck: false })
  const ed = h('div', { class: 'ia-et-ed', hidden: true }, edTa)
  const inner = h('div', { class: 'ia-et-inner' }, view, boxLayer, drawSurf, ed)
  const scroll = h('div', { class: 'ia-et-scroll' }, inner)
  const stg = stage('on-plain')
  const scan = scanFx()
  const nameChip = h('div', { class: 'ia-chip bl' }, icon('image'), h('span', ''))
  const statusChip = h('div', { class: 'ia-chip br', hidden: true }, icon('scan-text'), h('span', ''))
  const holdBtn = button('Hold to compare', { icon: 'eye', variant: 'secondary', size: 'sm' })
  const hold = (on) => { if (showOrig === on) return; showOrig = on; ed.style.visibility = on ? 'hidden' : ''; boxLayer.style.visibility = on ? 'hidden' : ''; paint() }
  holdBtn.addEventListener('pointerdown', () => hold(true))
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) holdBtn.addEventListener(ev, () => hold(false))
  holdBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hold(true) } })
  holdBtn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') hold(false) })
  stg.append(scroll, nameChip, statusChip, h('div', { class: 'ia-tools' }, holdBtn), scan.el)
  stg.style.padding = '8px'
  const msgSlot = h('div')

  // ---------- panel: the selected text
  const emptyNote = note('mouse-pointer-click', 'Tap a highlighted line on the photo to change it. Nothing highlighted where the text is? Choose "Draw a box" and drag around it.')
  const origNote = h('div', { class: 'ia-et-orig muted small' })
  const famSel = selectEl(FONTS.map((f) => [f.key, f.label]), 'sans', (v) => change({ family: v }, 'family'))
  famSel.setAttribute('aria-label', 'Font')
  const boldT = toggle('Bold', false, (v) => change({ bold: v }, 'bold'))
  const italicT = toggle('Italic', false, (v) => change({ italic: v }, 'italic'))
  const sizeR = rangeField('Size', { min: 6, max: 400, step: 0.5, value: 40, format: (v) => `${v} px`, onInput: (v) => change({ size: v }, 'size') })
  const colorSw = swatches(COLORS, '#000000', (v) => change({ color: v }, 'color'))
  const alignSeg = segmented([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], 'left', (v) => change({ align: v }, 'align'), 'Alignment')
  const spaceR = rangeField('Letter spacing', { min: -5, max: 40, step: 0.5, value: 0, format: (v) => `${v} px`, onInput: (v) => change({ spacing: v }, 'spacing') })
  const rotR = rangeField('Rotation', { min: -180, max: 180, step: 0.5, value: 0, format: (v) => `${v}°`, onInput: (v) => change({ rot: v }, 'rot') })
  for (const [r, l] of [[sizeR, 'Size'], [spaceR, 'Letter spacing'], [rotR, 'Rotation']]) r.input.setAttribute('aria-label', l)
  const fitT = toggle('Keep inside the original width', true, (v) => change({ fit: v }, 'fit'))
  const stepSeg = segmented([['1', '1 px'], ['5', '5 px'], ['20', '20 px']], '1', (v) => { st.step = Number(v) }, 'Nudge step')
  const nudge = (dx, dy, label, ic) => button('', { icon: ic, size: 'sm', ariaLabel: label, onClick: () => { const e = cur(); if (e) change({ dx: e.dx + dx * st.step, dy: e.dy + dy * st.step }, 'nudge') } })
  const pad = h('div', { class: 'ia-et-pad' }, nudge(0, -1, 'Move text up', 'arrow-up'), nudge(-1, 0, 'Move text left', 'arrow-left'), nudge(1, 0, 'Move text right', 'arrow-right'), nudge(0, 1, 'Move text down', 'arrow-down'))
  const delBtn = button('Erase this text', { icon: 'eraser', variant: 'secondary', size: 'sm', onClick: () => { const e = cur(); if (e) change({ deleted: !e.deleted }, 'del') } })
  const resetBtn = button('Put the original back', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: dropEdit })
  const selBody = h('div', { class: 'stack tight', hidden: true },
    origNote,
    field('Font', famSel),
    h('div', { class: 'row' }, boldT, italicT),
    sizeR,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colour'), colorSw),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Alignment'), alignSeg),
    spaceR, rotR, fitT,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Nudge position'), h('div', { class: 'row' }, pad, stepSeg)),
    h('div', { class: 'row' }, delBtn, resetBtn))

  // ---------- panel: finding text, fill engine, view, download
  const langSel = selectEl(OCR_LANGS, st.lang, (v) => { st.lang = v; setPref('image-ai:edit-text', { lang: v }); if (work) detect() })
  langSel.setAttribute('aria-label', 'Language of the text')
  const modeSeg = segmented([['lines', 'Whole lines'], ['words', 'Single words']], st.mode, (v) => { st.mode = v; renderBoxes() }, 'Highlight')
  const modelOpts = () => Object.values(MODELS).map((m) => ({
    value: m.key, title: m.name, desc: m.desc, icon: m.key === 'fast' ? 'zap' : m.key === 'best' ? 'gem' : 'wand-sparkles',
    tags: [m.mb ? (isReady(m.id) ? { text: 'Ready', cls: 'ok' } : `${m.mb} MB`) : { text: 'No download', cls: 'ok' }, m.sub],
  }))
  const models = optionCards(modelOpts(), 'instant', (v) => { st.model = v; paint(); syncBar() }, { col: true, label: 'Fill engine' })
  const refineBtn = button('Refine the background with AI', { icon: 'sparkles', variant: 'secondary', size: 'sm', block: true, onClick: () => refine() })
  const zoomSeg = segmented(ZOOMS, '1', (v) => { st.zoom = Number(v); applyZoom() }, 'Zoom')
  const fmtSeg = segmented([['jpg', 'JPG'], ['png', 'PNG'], ...(canEncode('image/webp') ? [['webp', 'WebP']] : [])], st.fmt, (v) => { st.fmt = v; quality.hidden = v === 'png' }, 'File format')
  const quality = rangeField('Quality', { min: 50, max: 100, value: st.quality, format: (v) => `${v}%`, onInput: (v) => { st.quality = v } })
  quality.input.setAttribute('aria-label', 'Quality')
  quality.hidden = true
  const panel = panelOf(
    section('Edit the text', 'type', [emptyNote, selBody]),
    section('Find text', 'scan-text', [field('Language of the text', langSel), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Highlight'), modeSeg), note('shield-check', 'Reading happens on your device. Your photo and your words never leave it.')]),
    section('Fill engine', 'cpu', [models, refineBtn, note('shield-check', 'The old letters are filled in with the surrounding picture. AI models run on your device and download once.')], false),
    section('View', 'zoom-in', [zoomSeg], false),
    section('Download', 'download', [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Format'), fmtSeg), quality], false))

  // ---------- action bar and side buttons
  const undoBtn = button('Undo', { icon: 'undo-2', variant: 'secondary', size: 'sm', onClick: undo })
  const redoBtn = button('Redo', { icon: 'redo-2', variant: 'secondary', size: 'sm', onClick: doRedo })
  const toolSeg = segmented([['select', 'Select text'], ['draw', 'Draw a box']], 'select', (v) => setTool(v), 'Tool')
  const bar = h('div', { class: 'ia-sticky ia-actionbar' }, undoBtn, redoBtn, h('span', { class: 'grow' }), toolSeg)
  const dlBtn = button('Download photo', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  dlBtn.addEventListener('click', () => busy(dlBtn, exportPhoto, { label: 'Preparing file', errorTo: msgSlot }))
  const another = button('Use another photo', { icon: 'image-up', variant: 'ghost', block: true, onClick: () => hero.zone.open() })
  const side = h('div', { class: 'ia-side' }, panel, h('div', { class: 'stack tight' }, dlBtn, another))
  const studioEl = h('div', { class: 'ia-studio', hidden: true }, h('div', { class: 'ia-main' }, stg, bar, msgSlot), side)

  const hero = heroDrop({
    accept: 'image/*', label: 'Drop a photo with text to change',
    hint: 'Posters, signs, screenshots and cards. JPG, PNG, WebP, GIF, BMP, AVIF and HEIC work. Paste with Ctrl+V works too.',
    icons: ['type', 'scan-text', 'pencil-line', 'sparkles'], icon: 'type',
    features: [['shield-check', 'Stays on your device'], ['scan-text', 'Finds the text for you'], ['undo-2', 'Undo anything']],
    onFiles: ([f]) => openFile(f),
  })
  shell(root, stepper, hero, studioEl)

  const cur = () => edits.find((e) => e.id === sel)

  // ---------- opening a photo
  async function openFile(file) {
    const my = ++openSeq
    ctl.abort(); ctl = new AbortController()
    clear(msgSlot)
    hero.hidden = true; studioEl.hidden = false
    scan.onCancel = null
    scan.start('Opening your photo')
    let w
    try { w = await loadWorking(file, { maxSide: 6000 }) } catch (e) {
      scan.stop(); clear(msgSlot, alert('error', friendlyError(e).message))
      if (!work) { hero.hidden = false; studioEl.hidden = true }
      return
    }
    if (my !== openSeq) return
    work = w
    orig = w.canvas; W = w.width; H = w.height
    clean = makeCanvas(W, H); clean.getContext('2d').drawImage(orig, 0, 0)
    refined = null; refinedSig = ''
    name = file.name || 'image.png'
    const t = fileType(file)
    st.fmt = t === 'image/jpeg' ? 'jpg' : t === 'image/webp' && canEncode('image/webp') ? 'webp' : 'png'
    fmtSeg.set(st.fmt); quality.hidden = st.fmt === 'png'
    edits = []; sel = null; cache.clear(); found = { lines: [], words: [] }
    hist = [JSON.stringify({ edits, sel })]; pos = 0; lastKey = ''
    const k = Math.min(1, DISP_MAX / Math.max(W, H))
    dw = Math.max(1, Math.round(W * k)); dh = Math.max(1, Math.round(H * k))
    view.width = dw; view.height = dh
    inner.style.aspectRatio = `${W} / ${H}`
    nameChip.querySelector('span').textContent = `${name}  -  ${w.originalWidth} x ${w.originalHeight}`
    statusChip.hidden = true
    if (w.scale < 1) clear(msgSlot, alert('info', `This photo is very large, so it was scaled down to ${W} x ${H} for editing.`))
    applyZoom(); paint(); renderBoxes(); syncPanel(); syncBar()
    stepper.set(1)
    await detect(my)
  }

  function applyZoom() {
    scroll.classList.toggle('zoomed', st.zoom > 1)
    inner.style.width = st.zoom === 1 ? `min(100%, calc(70vh * ${W && H ? W / H : 1}))` : `${st.zoom * 100}%`
    placeEditor()
  }

  // ---------- finding text
  async function detect(my = openSeq) {
    if (!work) return
    scan.onCancel = null
    scan.start('Loading the text reader')
    try {
      const long = Math.max(W, H)
      const k = long < 1400 ? Math.min(3, 1400 / long) : Math.min(1, 3200 / long)
      let c = orig
      if (k !== 1) { c = makeCanvas(W * k, H * k); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(orig, 0, 0, c.width, c.height) }
      const res = await recognize(c, { lang: st.lang, onProgress: (f, l) => scan.update(f, l) })
      if (my !== openSeq) return
      found = {
        lines: linesOf(res.data, k, W),
        words: wordsOf(res.data).filter((w) => w.confidence >= 20).map((w) => ({ text: w.text.trim(), box: scaleBox(w.bbox, 1 / k), align: 'left', rot: 0 })).filter((w) => w.box.h >= 5 && w.box.w >= 3),
      }
      renderBoxes()
      const n = found.lines.length
      statusChip.hidden = false
      statusChip.querySelector('span').textContent = n ? `${n} line${n === 1 ? '' : 's'} of text found` : 'No text found'
      if (!n) clear(msgSlot, alert('info', 'We could not find any text. Try another language, or choose "Draw a box" and drag around the text yourself.'))
      else burst(stg, 8)
    } catch (e) {
      console.error(e)
      clear(msgSlot, alert('error', friendlyError(e).message))
    } finally { scan.stop() }
  }

  // ---------- boxes over the photo
  const pct = (b) => ({ left: `${(b.x / W) * 100}%`, top: `${(b.y / H) * 100}%`, width: `${(b.w / W) * 100}%`, height: `${(b.h / H) * 100}%` })
  const inside = (b, f) => { const cx = f.x + f.w / 2, cy = f.y + f.h / 2; return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h }
  function renderBoxes() {
    const shown = edits.filter((e) => e.touched || e.id === sel || e.manual)
    const list = (st.mode === 'words' ? found.words : found.lines).filter((f) => !shown.some((e) => inside(e.box, f.box) || inside(f.box, e.box)))
    clear(boxLayer, [
      ...list.map((f) => h('button', { type: 'button', class: 'ia-et-box', style: pct(f.box), 'aria-label': `Text: ${f.text.slice(0, 60)}. Press to edit.`, title: f.text, onclick: () => pick(f) })),
      ...shown.map((e) => h('button', { type: 'button', class: ['ia-et-box', e.id === sel ? 'sel' : e.touched ? 'done' : ''], style: pct(e.box), 'aria-label': `Edited text: ${e.text.slice(0, 60) || 'erased'}. Press to edit.`, title: e.orig, onclick: () => select(e.id) })),
    ])
    boxLayer.hidden = st.tool === 'draw'
  }

  function makeEdit(f, an = analyze(orig, f.box)) {
    const text = f.text || ''
    const g = guessStyle(an, text)
    const e = {
      id: ++seq, box: an.ink, orig: text, text, family: g.family, bold: g.bold, italic: g.italic, size: g.size, spacing: g.spacing, base: g.base,
      color: an.color, align: f.align || 'left', rot: f.rot || 0, dx: 0, dy: 0, fit: true, touched: false, deleted: false, manual: !!f.manual,
    }
    cache.set(e.id, { an, fills: {} })
    return e
  }
  function pick(f) {
    const ex = edits.find((e) => inside(e.box, f.box) || inside(f.box, e.box))
    if (ex) return select(ex.id)
    const e = makeEdit(f)
    edits.push(e)
    select(e.id)
  }
  function select(id) {
    sel = id
    renderBoxes(); syncPanel(); placeEditor()
    const e = cur()
    if (e) { edTa.value = e.text; if (!e.deleted) edTa.focus({ preventScroll: true }) }
  }

  // ---------- the inline editor
  function placeEditor() {
    const e = cur()
    if (!e || e.deleted || st.tool === 'draw' || !work) { ed.hidden = true; return }
    ed.hidden = false
    const iw = inner.clientWidth, ih = inner.clientHeight
    if (!iw) return
    const k = iw / W
    const bx = e.box.x * k, by = e.box.y * k, bw = e.box.w * k, bh = e.box.h * k
    const w = clamp(Math.max(bw + 24, 220), 140, Math.max(140, iw - 8))
    ed.style.width = `${w}px`
    const eh = ed.offsetHeight || 44
    let top = by + bh + 8
    if (top + eh > ih - 2) top = by - eh - 8
    top = clamp(top, 4, Math.max(4, ih - eh - 4))
    ed.style.left = `${clamp(bx, 4, Math.max(4, iw - w - 4))}px`
    ed.style.top = `${top}px`
  }
  edTa.addEventListener('input', () => {
    edTa.style.height = 'auto'
    edTa.style.height = `${Math.min(edTa.scrollHeight, 160)}px`
    change({ text: edTa.value }, 'text')
    placeEditor()
  })
  edTa.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); edTa.blur() }
    else if (e.key === 'Escape') { edTa.blur(); select(null) }
  })
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placeEditor()) : null
  ro?.observe(inner)

  // ---------- drawing a box for text the reader missed
  let rubFrom = null
  const toImg = (e) => { const r = drawSurf.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1) * W, clamp((e.clientY - r.top) / r.height, 0, 1) * H] }
  drag(drawSurf, (type, e) => {
    if (!work || busyRun) return
    const p = toImg(e)
    if (type === 'down') { rubFrom = p; rub.hidden = false }
    if (!rubFrom) return
    const b = { x: Math.min(rubFrom[0], p[0]), y: Math.min(rubFrom[1], p[1]), w: Math.abs(rubFrom[0] - p[0]), h: Math.abs(rubFrom[1] - p[1]) }
    Object.assign(rub.style, pct(b))
    if (type === 'up') {
      rub.hidden = true; rubFrom = null
      if (b.w >= 8 && b.h >= 8) addManual(b)
    }
  })
  async function addManual(box) {
    scan.onCancel = null
    scan.start('Reading the text in your box')
    try {
      const an = analyze(orig, box)
      let text = ''
      try {
        const ink = { x: an.ink.x - 2, y: an.ink.y - 2, w: an.ink.w + 4, h: an.ink.h + 4 }
        const crop = paddedCrop(orig, ink, an.bg, clamp(44 / Math.max(10, an.ink.h), 1, 4))
        text = (await recognize(crop, { lang: st.lang })).text.replace(/\n{2,}/g, '\n').trim()
      } catch (e) { console.warn(e) }
      const e = makeEdit({ box, text, manual: true }, an)
      edits.push(e)
      setTool('select')
      select(e.id)
      if (an.weak) toast('No clear letters in that box, so the whole box will be filled in.')
    } finally { scan.stop() }
  }
  function setTool(v) {
    st.tool = v
    toolSeg.set(v)
    drawSurf.hidden = v !== 'draw'
    inner.dataset.tool = v
    renderBoxes(); placeEditor()
  }

  // ---------- erasing the old letters
  async function computeFill(target, e, model, opts = {}) {
    const an = cache.get(e.id).an
    const ink = an.ink
    // A square window around the text, padded past the photo edges by repeating the border rows, so long lines on short
    // photos still get the full context the fill needs.
    const S = Math.min(4800, Math.max(640, Math.round(Math.max(ink.w, ink.h) * 1.8)))
    const x0 = Math.round(ink.x + ink.w / 2 - S / 2), y0 = Math.round(ink.y + ink.h / 2 - S / 2)
    const sub = makeCanvas(S, S)
    const sx = sub.getContext('2d')
    const ix0 = Math.max(0, x0), iy0 = Math.max(0, y0), iw = Math.min(W, x0 + S) - ix0, ih = Math.min(H, y0 + S) - iy0
    const ox = ix0 - x0, oy = iy0 - y0
    sx.drawImage(target, ix0, iy0, iw, ih, ox, oy, iw, ih)
    if (ox > 0) sx.drawImage(sub, ox, oy, 1, ih, 0, oy, ox, ih)
    if (ox + iw < S) sx.drawImage(sub, ox + iw - 1, oy, 1, ih, ox + iw, oy, S - ox - iw, ih)
    if (oy > 0) sx.drawImage(sub, 0, oy, S, 1, 0, 0, S, oy)
    if (oy + ih < S) sx.drawImage(sub, 0, oy + ih - 1, S, 1, 0, oy + ih, S, S - oy - ih)
    const mask = new Uint8Array(S * S)
    const r = an.reg
    for (let y = 0; y < r.h; y++) {
      const my = r.y + y - y0
      if (my < 0 || my >= S) continue
      for (let x = 0; x < r.w; x++) {
        const mx = r.x + x - x0
        if (an.mask[y * r.w + x] && mx >= 0 && mx < S) mask[my * S + mx] = 1
      }
    }
    const grow = (clamp(Math.round(ink.h * 0.1), 2, 10) * 1000) / S
    const patches = await inpaint(sub, mask, { model, grow, onProgress: opts.onProgress, signal: opts.signal })
    return patches.map((p) => ({ x: p.x + x0, y: p.y + y0, after: p.after }))
  }
  async function applyFill(target, e, model, opts) {
    const c = cache.get(e.id)
    if (!c) return
    if (!c.fills[model]) c.fills[model] = await computeFill(target, e, model, opts)
    const x = target.getContext('2d')
    for (const p of c.fills[model]) x.putImageData(p.after, p.x, p.y)
  }
  // Rebuild the quick-fill picture from the original (cached fills make this instant). Runs one at a time.
  const rebuildClean = () => (chain = chain.then(async () => {
    clean.getContext('2d').drawImage(orig, 0, 0)
    for (const e of edits) if (e.touched) await applyFill(clean, e, 'instant')
    paint(); syncBar()
  }).catch((err) => { console.error(err); clear(msgSlot, alert('error', 'Could not erase the old text there. Try drawing a box around it instead.')) }))

  const touched = () => edits.filter((e) => e.touched)
  const sigNow = () => `${st.model}|${touched().map((e) => e.id).join(',')}`
  const refinedOk = () => st.model !== 'instant' && !!refined && refinedSig === sigNow()

  async function refine() {
    if (!work || busyRun || st.model === 'instant') return true
    if (!touched().length) { toast('Change some text first, then refine the background.'); return false }
    clear(msgSlot)
    busyRun = true
    ctl = new AbortController()
    scan.onCancel = () => ctl.abort()
    scan.start('Loading the AI model', true)
    try {
      refined = refined || makeCanvas(W, H)
      refinedSig = ''
      refined.getContext('2d').drawImage(orig, 0, 0)
      for (const e of touched()) await applyFill(refined, e, st.model, { onProgress: (f, l) => scan.update(f, l), signal: ctl.signal })
      refinedSig = sigNow()
      models.refresh(modelOpts())
      paint()
      return true
    } catch (e) {
      if (e?.code === 'ABORT' || e?.name === 'AbortError') toast('Cancelled')
      else {
        console.error(e)
        clear(msgSlot, alert('error', friendlyError(e).message, ' ', button('Use Instant fill', { size: 'sm', onClick: () => { st.model = 'instant'; models.set('instant'); clear(msgSlot); paint(); syncBar() } })))
      }
      return false
    } finally { scan.stop(); busyRun = false; syncBar() }
  }

  // ---------- painting the preview
  function paint() {
    if (!work) return
    const c = view.getContext('2d')
    c.imageSmoothingQuality = 'high'
    c.clearRect(0, 0, dw, dh)
    if (showOrig) { c.drawImage(orig, 0, 0, dw, dh); return }
    c.drawImage(refinedOk() ? refined : clean, 0, 0, dw, dh)
    for (const e of edits) drawText(c, e, dw / W)
  }

  // ---------- changing an edit, with undo and redo
  function change(patch, key) {
    const e = cur()
    if (!e || busyRun) return
    Object.assign(e, patch)
    const first = !e.touched
    e.touched = true
    record(`${e.id}:${key}`)
    paint()
    if (first) { rebuildClean(); renderBoxes() }
    if (key !== 'text') syncPanel()
    placeEditor()
  }
  function dropEdit() {
    const e = cur()
    if (!e) return
    edits = edits.filter((x) => x !== e)
    sel = null
    record(`drop:${e.id}`)
    rebuildClean(); renderBoxes(); syncPanel(); placeEditor(); paint()
  }
  function record(key) {
    const snap = JSON.stringify({ edits, sel })
    const now = Date.now()
    if (key === lastKey && now - lastT < 1500 && pos > 0) hist[pos] = snap
    else { hist.length = pos + 1; hist.push(snap); pos = hist.length - 1 }
    lastKey = key; lastT = now
    syncBar()
  }
  function restore() {
    const d = JSON.parse(hist[pos])
    edits = d.edits
    sel = edits.some((e) => e.id === d.sel) ? d.sel : null
    lastKey = ''
    rebuildClean(); renderBoxes(); syncPanel(); placeEditor(); paint(); syncBar()
    const e = cur()
    if (e) edTa.value = e.text
  }
  function undo() { if (busyRun || pos <= 0) return; pos--; restore() }
  function doRedo() { if (busyRun || pos >= hist.length - 1) return; pos++; restore() }

  function syncPanel() {
    const e = cur()
    emptyNote.hidden = !!e; selBody.hidden = !e
    if (!e) return
    famSel.value = e.family
    boldT.input.checked = e.bold; italicT.input.checked = e.italic
    sizeR.input.max = String(Math.max(80, Math.round(Math.max(H * 0.5, e.size * 1.5))))
    sizeR.set(e.size); colorSw.set(e.color); alignSeg.set(e.align); spaceR.set(e.spacing); rotR.set(e.rot)
    fitT.input.checked = e.fit
    clear(delBtn, icon(e.deleted ? 'undo-2' : 'eraser'), h('span', e.deleted ? 'Bring the text back' : 'Erase this text'))
    origNote.textContent = e.orig ? `Original text: ${e.orig.replace(/\s+/g, ' ').slice(0, 80)}` : 'No original text was read in this box.'
    if (document.activeElement !== edTa && edTa.value !== e.text) edTa.value = e.text
  }
  function syncBar() {
    undoBtn.disabled = busyRun || pos <= 0
    redoBtn.disabled = busyRun || pos >= hist.length - 1
    refineBtn.hidden = st.model === 'instant'
    refineBtn.disabled = busyRun || !touched().length || refinedOk()
    const n = touched().length
    if (work) stepper.set(n ? 2 : 1)
  }

  // ---------- download
  async function exportPhoto() {
    if (!work) return
    if (st.model !== 'instant' && touched().length && !refinedOk() && !(await refine())) return
    const out = makeCanvas(W, H)
    const x = out.getContext('2d')
    if (st.fmt === 'jpg') { x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H) }
    x.drawImage(refinedOk() ? refined : clean, 0, 0)
    for (const e of edits) drawText(x, e, 1)
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[st.fmt]
    const blob = await canvasBlob(out, type, st.quality / 100)
    download(blob, suffixName(name, 'edited', st.fmt))
    toast(`Saved (${formatBytes(blob.size)})`, 'success')
  }

  const onKey = (e) => {
    if (studioEl.hidden || e.target.closest?.('input, textarea, select')) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo() }
  }
  document.addEventListener('keydown', onKey)
  // clicking empty photo area leaves the text you were editing
  view.addEventListener('click', () => { if (sel && st.tool === 'select') select(null) })
  syncBar()
  return () => { ctl.abort(); ro?.disconnect(); document.removeEventListener('keydown', onKey); releaseSessions() }
}

let styled = false
function injectStyle() {
  if (styled || document.getElementById('ia-et-style')) return
  styled = true
  document.head.append(h('style', { id: 'ia-et-style' }, `
.ia-et-scroll { width: 100%; max-height: 74vh; overflow: auto; display: grid; place-items: start center; border-radius: 12px; -webkit-overflow-scrolling: touch; }
.ia-et-scroll:not(.zoomed) { overflow: hidden; }
.ia-et-inner { position: relative; max-width: none; touch-action: pan-x pan-y pinch-zoom; user-select: none; -webkit-user-select: none; border-radius: 6px; box-shadow: 0 10px 30px -14px rgba(0, 0, 0, .4); }
.ia-et-scroll:not(.zoomed) .ia-et-inner { max-width: 100%; }
.ia-et-inner > canvas { position: absolute; inset: 0; width: 100% !important; height: 100% !important; max-height: none !important; border-radius: 6px !important; display: block; }
.ia-et-boxes { position: absolute; inset: 0; pointer-events: none; }
.ia-et-box { position: absolute; pointer-events: auto; padding: 0; margin: 0; cursor: pointer; border-radius: 3px; border: 1.5px dashed #fff; outline: 1px solid rgba(0, 0, 0, .5); background: color-mix(in srgb, var(--accent) 16%, transparent); min-width: 8px; min-height: 8px; }
.ia-et-box::after { content: ''; position: absolute; inset: -6px; }
.ia-et-box:hover { background: color-mix(in srgb, var(--accent) 30%, transparent); }
.ia-et-box:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
.ia-et-box.done { border: 1.5px solid var(--success); background: transparent; }
.ia-et-box.sel { border: 2px solid var(--accent); outline: 1px solid #fff; background: transparent; }
.ia-et-inner[data-tool="draw"] { touch-action: none; }
.ia-et-draw { position: absolute; inset: 0; z-index: 3; cursor: crosshair; touch-action: none; }
.ia-et-rub { position: absolute; border: 2px solid var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); pointer-events: none; }
.ia-et-ed { position: absolute; z-index: 5; box-shadow: var(--shadow-lg); border-radius: 12px; background: var(--surface); }
.ia-et-ed textarea { width: 100%; min-height: 40px; max-height: 160px; resize: none; display: block; overflow: auto; line-height: 1.3; }
.ia-et-pad { display: inline-flex; gap: 4px; }
.ia-et-orig { overflow-wrap: anywhere; }
`))
}
