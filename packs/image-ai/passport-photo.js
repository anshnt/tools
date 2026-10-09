// Passport and ID photo maker (also serves id-photo-maker via params.preset = 'id').
// Finds the face, straightens and sizes the head to the official ratio, swaps the background, exports at 300 DPI
// and lays copies out on a print sheet (4 x 6 in and more) as JPG or true-size PDF.
import { h, icon, button, busy, alert, clear, segmented, rangeField, toggle, input, number, select, field, download, toast, formatBytes, debounce } from '../../lib/ui.js'
import { canvas as makeCanvas, toBlob, compressToTarget } from '../../lib/image.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { load as getPref, save as setPref } from '../../lib/store.js'
import {
  loadWorking, matte, imageDataOf, guidedRefine, tightenAlpha, finalizeAlpha, makeCutout, getCachedMatte, putCachedMatte, friendlyError, checkAbort,
} from './_ml.js'
import { faceMesh, detectFaces } from './_face.js'
import { PRESETS, byPresetId, customPreset, headTarget, mmToPx, SHEETS, layoutSheet, bestLayout, jpegSetDpi, pngSetDpi, trim, sizeText } from './_passport.js'
import { shell, steps, heroDrop, panelOf, section, stage, scanFx, swatches, note, drag, burst } from './_ui.js'

const BG_SWATCHES = ['#ffffff', '#f1f1f1', '#e9e9e9', '#dbe8f5', '#bcd7f2', '#3b6fb6']
const DPI = 300

/** Where the head sits for a given photo size. All lengths in output pixels. Pure, so it can be tested. */
export function placement({ outW, outH, ratio, dCrown, dChin, zoom = 1, dx = 0, dy = 0 }) {
  const H = dCrown + dChin
  const s0 = (ratio * outH) / H
  const topMargin = (1 - ratio) * outH * 0.3
  return {
    s: s0 * zoom,
    q0x: outW / 2 + dx * outW,
    q0y: topMargin + dCrown * s0 + dy * outH,
    head: H * s0 * zoom,
    crownY: topMargin + dy * outH + dCrown * s0 - dCrown * s0 * zoom,
  }
}

/** Topmost mask pixel in a band around the face (in the head's own, straightened frame). Returns distance above the eyes. */
export function findCrown(alpha, w, h, eyeMid, tilt, bandHalf) {
  const sn = Math.sin(tilt), cs = Math.cos(tilt)
  let best = 0
  const x0 = Math.max(0, Math.floor(eyeMid.x - bandHalf * 1.6)), x1 = Math.min(w - 1, Math.ceil(eyeMid.x + bandHalf * 1.6))
  const yEnd = Math.min(h - 1, Math.ceil(eyeMid.y))
  for (let y = 0; y <= yEnd; y++) {
    const o = y * w
    for (let x = x0; x <= x1; x++) {
      if (alpha[o + x] < 128) continue
      const dxp = x - eyeMid.x, dyp = y - eyeMid.y
      const u = dxp * cs + dyp * sn
      if (Math.abs(u) > bandHalf) continue
      const v = -dxp * sn + dyp * cs
      if (-v > best) best = -v
    }
  }
  return best
}

export function mount(root, { params, signal }) {
  const idMode = params.preset === 'id'
  const saved = getPref('image-ai:passport', {})
  const state = {
    group: idMode ? 'id' : 'passport',
    presetId: idMode ? (saved.idPreset || 'form-35x45') : (saved.preset || 'in-passport'),
    custom: { w: 35, h: 45, head: 72 },
    bg: null, replaceBg: true, straighten: true, guides: true, model: 'portrait',
    adj: { zoom: 1, dx: 0, dy: 0 },
    sheet: { id: '4x6', auto: true, margin: 3, gap: 1.5, copies: 0, lines: true },
    out: { fmt: 'jpg', mode: 'print', onlineW: 630, kb: 250 },
    file: null, work: null, mesh: null, cutout: null, alpha: null, geo: null, busy: false, faces: 0,
  }
  let ctl = new AbortController()
  signal.addEventListener('abort', () => ctl.abort())

  const preset = () => (state.presetId === 'custom' ? customPreset(state.custom.w, state.custom.h, state.custom.head, state.bg || '#ffffff') : byPresetId.get(state.presetId))
  const bgColor = () => state.bg || preset().bg

  // ---------- stage
  const stepper = steps(['Add photo', 'Fit to size', 'Download'], 0)
  const previewCv = document.createElement('canvas')
  previewCv.style.cssText = 'display:block;width:100%;height:100%;border-radius:6px;box-shadow:0 10px 30px -12px rgba(0,0,0,.35);background:#fff'
  const guidesSvg = h('svg', { class: 'ia-pp-guides', 'aria-hidden': 'true' })
  const frame = h('div', { class: 'ia-pp-frame' }, previewCv, guidesSvg)
  const stg = stage('on-plain')
  const scan = scanFx()
  stg.append(frame, scan.el)
  const sizeChip = h('div', { class: 'ia-chip bl' }, icon('ruler'), h('span', ''))
  stg.append(sizeChip)
  const checks = h('div', { class: 'ia-pp-checks', 'aria-live': 'polite' })
  const errSlot = h('div')
  const sheetCv = document.createElement('canvas')
  sheetCv.className = 'ia-pp-sheetcv'
  const sheetInfo = h('div', { class: 'ia-pp-sheetinfo' })

  injectStyle()

  // ---------- presets list
  const search = input({ placeholder: 'Search country or size', 'aria-label': 'Search sizes', oninput: () => renderPresets() })
  const list = h('div', { class: 'ia-pp-list', role: 'listbox', 'aria-label': 'Photo sizes' })
  const groupSeg = segmented([['passport', 'Passport & visa'], ['id', 'ID & forms'], ['custom', 'Custom']], state.group, (v) => {
    state.group = v
    if (v === 'custom') { state.presetId = 'custom' } else if (preset().group !== v) { state.presetId = PRESETS.find((p) => p.group === v).id }
    renderPresets(); presetChanged()
  }, 'Photo type')
  const customW = number(state.custom.w, { min: 10, max: 200, onInput: (v) => { if (v > 0) { state.custom.w = v; presetChanged() } }, ariaLabel: 'Width in millimetres' })
  const customH = number(state.custom.h, { min: 10, max: 300, onInput: (v) => { if (v > 0) { state.custom.h = v; presetChanged() } }, ariaLabel: 'Height in millimetres' })
  const customHead = rangeField('Head size in the photo', { min: 40, max: 90, value: state.custom.head, format: (v) => `${v}%`, onInput: (v) => { state.custom.head = v; presetChanged() } })
  const customBox = h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('Width (mm)', customW), field('Height (mm)', customH)), customHead)
  const presetNote = h('div')

  function renderPresets() {
    const q = search.value.trim().toLowerCase()
    const items = PRESETS.filter((p) => p.group === state.group && (!q || `${p.name} ${p.cc} ${p.kind} ${p.w}x${p.h} ${p.w} x ${p.h}`.toLowerCase().includes(q)))
    clear(list, items.length ? items.map((p) => h('button', {
      type: 'button', class: 'ia-pp-item', role: 'option', 'aria-selected': String(p.id === state.presetId), onclick: () => { state.presetId = p.id; state.bg = null; bgSw.set(p.bg); renderPresets(); presetChanged() },
    }, h('span', { class: 'cc' }, p.cc === '**' ? '#' : p.cc), h('span', { class: 'nm' }, h('b', p.name), h('small', p.kind)), h('span', { class: 'sz' }, sizeText(p)))) : h('div', { class: 'small muted', style: 'padding:12px' }, 'No match. Try the Custom tab for your own size.'))
    search.parentElement?.toggleAttribute('hidden', state.group === 'custom')
    list.toggleAttribute('hidden', state.group === 'custom')
    customBox.toggleAttribute('hidden', state.group !== 'custom')
  }

  // ---------- controls
  const bgSw = swatches(BG_SWATCHES, preset().bg, (v) => { state.bg = v; redraw() })
  const replaceT = toggle('Replace the background', true, (v) => { state.replaceBg = v; redraw() })
  const modelSeg = segmented([['portrait', 'Fast (people)'], ['balanced', 'More detail']], state.model, (v) => { state.model = v; if (state.file) analyze(state.file, { keepFace: true }) }, 'Cutout model')
  const zoom = rangeField('Zoom', { min: 70, max: 140, value: 100, format: (v) => `${v}%`, onInput: (v) => { state.adj.zoom = v / 100; redraw() } })
  const shiftX = rangeField('Move left or right', { min: -20, max: 20, value: 0, format: (v) => `${v}%`, onInput: (v) => { state.adj.dx = v / 100; redraw() } })
  const shiftY = rangeField('Move up or down', { min: -20, max: 20, value: 0, format: (v) => `${v}%`, onInput: (v) => { state.adj.dy = v / 100; redraw() } })
  const straightenT = toggle('Straighten a tilted head', true, (v) => { state.straighten = v; computeGeo(); redraw() })
  const guidesT = toggle('Show guide lines', true, (v) => { state.guides = v; drawGuides() })
  const resetAdj = button('Reset position', { icon: 'rotate-ccw', variant: 'secondary', size: 'sm', onClick: () => { state.adj = { zoom: 1, dx: 0, dy: 0 }; zoom.set(100); shiftX.set(0); shiftY.set(0); redraw() } })

  const sheetSel = select(SHEETS.map((s) => [s.id, s.name]), state.sheet.id, (v) => { state.sheet.id = v; redrawSheet() })
  const autoT = toggle('Fit as many photos as possible', true, (v) => { state.sheet.auto = v; spacing.hidden = v; redrawSheet() })
  const marginR = rangeField('Page margin', { min: 0, max: 10, step: 0.5, value: state.sheet.margin, format: (v) => `${v} mm`, onInput: (v) => { state.sheet.margin = v; redrawSheet() } })
  const gapR = rangeField('Gap between photos', { min: 0, max: 6, step: 0.5, value: state.sheet.gap, format: (v) => `${v} mm`, onInput: (v) => { state.sheet.gap = v; redrawSheet() } })
  const spacing = h('div', { class: 'stack', hidden: true }, marginR, gapR)
  const copies = number('', { min: 1, max: 60, step: 1, placeholder: 'All', onInput: (v) => { state.sheet.copies = Number.isFinite(v) ? Math.max(1, Math.round(v)) : 0; redrawSheet() }, ariaLabel: 'Number of copies' })
  const linesT = toggle('Cut guide lines', true, (v) => { state.sheet.lines = v; redrawSheet() })

  const fmtSeg = segmented([['jpg', 'JPG'], ['png', 'PNG']], state.out.fmt, (v) => { state.out.fmt = v })
  const modeSeg = segmented([['print', 'Print (300 DPI)'], ['online', 'Online upload']], state.out.mode, (v) => { state.out.mode = v; onlineBox.hidden = v !== 'online'; updateSizeChip() })
  const onlineW = number(state.out.onlineW, { min: 100, max: 4000, step: 1, onInput: (v) => { if (v > 0) state.out.onlineW = v; updateSizeChip() }, ariaLabel: 'Width in pixels' })
  const onlineKb = number(state.out.kb, { min: 5, max: 5000, step: 1, onInput: (v) => { state.out.kb = Number.isFinite(v) ? v : 0 }, ariaLabel: 'Maximum size in kilobytes' })
  const onlineBox = h('div', { class: 'grid-2', hidden: true }, field('Width (px)', onlineW, 'Height follows the photo shape.'), field('Max size (KB)', onlineKb, 'Leave empty for no limit.'))

  const panel = panelOf(
    section('Photo size', 'ruler', [groupSeg, h('div', { class: 'ia-pp-searchwrap' }, search), list, customBox, presetNote]),
    section('Background', 'palette', [bgSw, replaceT, field('Cutout model', modelSeg)]),
    section('Position', 'move', [zoom, shiftX, shiftY, straightenT, guidesT, resetAdj], false),
    section('Print sheet', 'layout-grid', [field('Paper', sheetSel), autoT, spacing, field('Copies', copies, 'Leave empty to fill the page.'), linesT], false),
    section('File', 'file-image', [field('Photo for', modeSeg), onlineBox, field('Format', fmtSeg)], false))

  // ---------- actions
  const dlPhoto = button('Download photo', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  dlPhoto.addEventListener('click', () => busy(dlPhoto, async () => { const r = await exportPhoto(); download(r.blob, r.name); toast(`Saved ${r.note}`, 'success') }, { label: 'Preparing', errorTo: errSlot }))
  const dlSheet = button('Download print sheet', { icon: 'layout-grid', variant: 'secondary', block: true })
  dlSheet.addEventListener('click', () => busy(dlSheet, async () => { const r = await exportSheet('jpg'); download(r.blob, r.name) }, { label: 'Preparing', errorTo: errSlot }))
  const dlPdf = button('Sheet as PDF (true size)', { icon: 'file-text', variant: 'secondary', block: true })
  dlPdf.addEventListener('click', () => busy(dlPdf, async () => { const r = await exportSheet('pdf'); download(r.blob, r.name) }, { label: 'Preparing', errorTo: errSlot }))
  const startOver = button('Use another photo', { icon: 'rotate-ccw', variant: 'ghost', block: true, onClick: reset })
  const actions = h('div', { class: 'stack tight' }, dlPhoto, dlSheet, dlPdf, startOver)

  const sheetCard = h('div', { class: 'ia-panel ia-pp-sheetcard' },
    h('div', { class: 'ia-pp-sheethead' }, icon('layout-grid'), h('b', 'Print sheet'), sheetInfo),
    h('div', { class: 'ia-pp-sheetbox' }, sheetCv))
  const studioEl = h('div', { class: 'ia-studio', hidden: true },
    h('div', { class: 'ia-main' }, stg, errSlot, checks, sheetCard),
    h('div', { class: 'ia-side' }, panel, actions))

  const hero = heroDrop({
    accept: 'image/*', label: idMode ? 'Drop a clear, front-facing photo' : 'Drop a front-facing photo',
    hint: 'A selfie against any wall works. We find the face, fit the size and swap the background.',
    icons: ['contact-round', 'ruler', 'sparkles', 'printer'],
    features: [['shield-check', 'Photo never leaves your device'], ['ruler', '35+ official sizes'], ['printer', '300 DPI print sheets']],
    onFiles: ([f]) => analyze(f),
  })
  const intro = h('div', { class: 'ia-pp-intro' }, note('info', 'Stand about an arm away, face the camera, keep a neutral expression and good even light. We take care of the rest.'))
  shell(root, stepper, hero, intro, studioEl)
  renderPresets()
  presetChanged(true)

  // ---------- analysis
  async function analyze(file, { keepFace = false } = {}) {
    ctl.abort()
    ctl = new AbortController()
    state.file = file
    hero.hidden = true; intro.hidden = true; studioEl.hidden = false
    clear(errSlot)
    stepper.set(1)
    scan.onCancel = () => ctl.abort()
    scan.start('Reading your photo')
    try {
      if (!keepFace || !state.work) {
        state.work = await loadWorking(file, { maxSide: 3000 })
        scan.update(null, 'Finding your face')
        let mesh = null
        try { mesh = await faceMesh(state.work.canvas, { signal: ctl.signal }) } catch (e) { if (e?.code === 'ABORT') throw e; console.warn(e) }
        state.mesh = mesh
        state.faces = mesh?.count || 0
        if (!mesh) {
          // The detector can still place a box when the landmark model is unsure.
          const boxes = await detectFaces(state.work.canvas, { minScore: 0.4, thorough: true, signal: ctl.signal }).catch(() => [])
          const b = boxes.sort((a, c) => c.w * c.h - a.w * a.h)[0]
          if (b) {
            state.faces = boxes.length
            state.mesh = { fallback: true, box: b, eyeL: { x: b.x + b.w * 0.7, y: b.y + b.h * 0.38 }, eyeR: { x: b.x + b.w * 0.3, y: b.y + b.h * 0.38 }, chin: { x: b.x + b.w / 2, y: b.y + b.h * 1.04 }, tilt: 0, count: boxes.length }
          }
        }
        // Preview the photo right away while the cutout is computed.
        computeGeo()
        redraw()
      }
      const w = state.work
      let res = getCachedMatte(file, state.model)
      if (!res) {
        res = await matte(state.model, w.canvas, { signal: ctl.signal, onProgress: (f, l) => scan.update(f, l) })
        putCachedMatte(file, state.model, res)
      }
      checkAbort(ctl.signal)
      scan.update(null, 'Polishing the edges')
      const base = tightenAlpha(guidedRefine(imageDataOf(w.canvas), res.alpha, w.width, w.height))
      state.alpha = finalizeAlpha(base, w.width, w.height, { feather: 0.8 })
      state.cutout = makeCutout(w.canvas, state.alpha, { defringe: true })
      state.device = res.device
      computeGeo()
      redraw()
      scan.stop()
      stepper.set(2)
      burst(stg)
    } catch (e) {
      scan.stop()
      if (e?.code === 'ABORT' || e?.name === 'AbortError') return
      clear(errSlot, alert('error', friendlyError(e).message, ' ', button('Try again', { size: 'sm', icon: 'refresh-cw', onClick: () => analyze(file) })))
      // Still allow manual positioning on the plain photo
      if (state.work) { computeGeo(); redraw() }
    }
  }

  function computeGeo() {
    const w = state.work
    if (!w) return
    const m = state.mesh
    if (!m) {
      // No face found: center the photo so it can still be placed by hand.
      state.geo = { eyeMid: { x: w.width / 2, y: w.height * 0.4 }, tilt: 0, dCrown: w.height * 0.2, dChin: w.height * 0.2, manual: true }
      return
    }
    const tilt = state.straighten ? m.tilt : 0
    const eyeMid = { x: (m.eyeL.x + m.eyeR.x) / 2, y: (m.eyeL.y + m.eyeR.y) / 2 }
    const sn = Math.sin(tilt), cs = Math.cos(tilt)
    const dChin = (m.chin.x - eyeMid.x) * -sn + (m.chin.y - eyeMid.y) * cs
    const e = Math.hypot(m.eyeL.x - m.eyeR.x, m.eyeL.y - m.eyeR.y)
    let dCrown = 0
    if (state.alpha) dCrown = findCrown(state.alpha, w.width, w.height, eyeMid, tilt, e * 1.1)
    // Without a usable mask, estimate the crown from the face proportions (eyes sit near the middle of the head).
    if (!(dCrown > dChin * 0.6)) dCrown = dChin * 1.02
    state.geo = { eyeMid, tilt, dCrown, dChin, estimated: !state.alpha || !(dCrown > dChin * 0.6) }
  }

  // ---------- drawing
  function currentPlacement(outW, outH) {
    const g = state.geo
    return { g, ...placement({ outW, outH, ratio: headTarget(preset()), dCrown: g.dCrown, dChin: g.dChin, zoom: state.adj.zoom, dx: state.adj.dx, dy: state.adj.dy }) }
  }

  function render(outW, outH, { smooth = true } = {}) {
    const c = makeCanvas(outW, outH)
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = smooth ? 'high' : 'low'
    ctx.fillStyle = bgColor()
    ctx.fillRect(0, 0, outW, outH)
    if (!state.work || !state.geo) return c
    const { g, s, q0x, q0y } = currentPlacement(outW, outH)
    const layer = state.replaceBg && state.cutout ? state.cutout : state.work.canvas
    ctx.save()
    ctx.translate(q0x, q0y)
    ctx.rotate(-g.tilt)
    ctx.scale(s, s)
    ctx.translate(-g.eyeMid.x, -g.eyeMid.y)
    ctx.drawImage(layer, 0, 0)
    ctx.restore()
    return c
  }

  function previewSize() {
    const p = preset()
    const maxH = 560
    const k = Math.min(maxH / p.h, 440 / p.w)
    return [Math.round(p.w * k), Math.round(p.h * k)]
  }

  const redraw = debounce(() => {
    if (!state.work) return
    const [w, hh] = previewSize()
    const c = render(w, hh)
    previewCv.width = w; previewCv.height = hh
    previewCv.getContext('2d').drawImage(c, 0, 0)
    frame.style.setProperty('--ar', String(w / hh))
    frame.style.width = `min(100%, ${w}px)`
    drawGuides()
    updateChecks()
    updateSizeChip()
    redrawSheet()
  }, 20)

  function drawGuides() {
    const [w, hh] = previewSize()
    guidesSvg.setAttribute('viewBox', `0 0 ${w} ${hh}`)
    clear(guidesSvg)
    if (!state.guides || !state.geo || !state.work) return
    const p = preset()
    const { g, q0x, q0y, s } = currentPlacement(w, hh)
    const crownY = q0y - g.dCrown * s
    const chinY = q0y + g.dChin * s
    const mm = hh / p.h
    const lo = chinY - p.head[1] * mm, hi = chinY - p.head[0] * mm
    const el = (tag, attrs) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); guidesSvg.append(n); return n }
    el('rect', { x: 0, y: lo, width: w, height: Math.max(1, hi - lo), fill: 'rgba(34,197,94,.20)' })
    el('line', { x1: 0, x2: w, y1: lo, y2: lo, stroke: 'rgba(34,197,94,.9)', 'stroke-width': 1, 'stroke-dasharray': '4 3' })
    el('line', { x1: 0, x2: w, y1: hi, y2: hi, stroke: 'rgba(34,197,94,.9)', 'stroke-width': 1, 'stroke-dasharray': '4 3' })
    el('line', { x1: w / 2, x2: w / 2, y1: 0, y2: hh, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1 })
    const ln = (y, c2, label) => {
      el('line', { x1: 0, x2: w, y1: y, y2: y, stroke: c2, 'stroke-width': 1.5 })
      const tw = label.length * 6.4 + 12
      el('rect', { x: w - tw - 6, y: y - 17, width: tw, height: 15, rx: 7.5, fill: 'rgba(10,10,20,.7)' })
      const t = el('text', { x: w - tw / 2 - 6, y: y - 6, fill: '#fff', 'font-size': 10.5, 'font-weight': 600, 'text-anchor': 'middle' })
      t.textContent = label
      el('circle', { cx: w - tw - 6, cy: y - 9.5, r: 3.2, fill: c2 })
    }
    ln(crownY, '#fbbf24', 'Crown')
    ln(q0y, '#38bdf8', 'Eyes')
    ln(chinY, '#f472b6', 'Chin')
  }

  function updateSizeChip() {
    const p = preset()
    const [pw, ph] = outPixels()
    sizeChip.querySelector('span').textContent = `${sizeText(p)}  -  ${pw} x ${ph} px${state.out.mode === 'print' ? ` at ${DPI} DPI` : ''}`
  }

  function outPixels() {
    const p = preset()
    if (state.out.mode === 'online') { const w = Math.max(50, Math.round(state.out.onlineW || 600)); return [w, Math.round((w * p.h) / p.w)] }
    return [mmToPx(p.w, DPI), mmToPx(p.h, DPI)]
  }

  function updateChecks() {
    const p = preset()
    const g = state.geo
    clear(checks)
    if (!state.work || !g) return
    const [w, hh] = previewSize()
    const pl = currentPlacement(w, hh)
    const mmPer = p.h / hh
    const headMm = pl.head * mmPer
    const crown = pl.q0y - g.dCrown * pl.s, chin = pl.q0y + g.dChin * pl.s
    const items = []
    const add = (ok, text, detail) => items.push(h('div', { class: ['ia-pp-check', ok === true ? 'ok' : ok === false ? 'warn' : 'info'] }, icon(ok === true ? 'circle-check' : ok === false ? 'triangle-alert' : 'info'), h('div', h('b', text), detail ? h('small', detail) : null)))
    if (!state.mesh) add(false, 'No face found', 'Drag the photo and use Zoom to place the head inside the green band.')
    else if (state.faces > 1) add(false, `${state.faces} faces in the photo`, 'We used the biggest one. A passport photo should have only you in it.')
    else add(true, 'One face found')
    if (state.mesh) {
      const inRange = headMm >= p.head[0] - 0.3 && headMm <= p.head[1] + 0.3
      add(inRange, `Head size ${trim(Math.round(headMm * 10) / 10)} mm`, inRange ? `Within the ${trim(p.head[0])} to ${trim(p.head[1])} mm range` : `Needs ${trim(p.head[0])} to ${trim(p.head[1])} mm. Adjust Zoom.`)
      add(crown >= 0 && chin <= hh, crown >= 0 && chin <= hh ? 'Whole head in frame' : 'Head is cut off', crown >= 0 && chin <= hh ? 'Space above the head and below the chin' : 'Move the photo or zoom out.')
      const tiltDeg = Math.abs(state.mesh.tilt * 180 / Math.PI)
      add(tiltDeg < 2.5 || state.straighten, tiltDeg < 0.8 ? 'Head is level' : state.straighten ? `Straightened by ${trim(Math.round(tiltDeg * 10) / 10)} degrees` : `Head tilted ${trim(Math.round(tiltDeg * 10) / 10)} degrees`)
      if (g.estimated) add(null, 'Crown estimated', 'The cutout is unavailable, so the top of the head is estimated.')
    }
    add(state.replaceBg && !!state.cutout ? true : null, state.replaceBg && state.cutout ? 'Plain background' : 'Original background kept', state.replaceBg && state.cutout ? `Filled with ${bgColor()}` : 'Turn on Replace the background for a clean backdrop.')
    checks.append(...items)
    clear(presetNote, note('info', `${preset().note} Requirements change, so confirm with the issuing authority before printing.`))
  }

  // ---------- sheet
  function sheetLayout() {
    const p = preset()
    const sheet = SHEETS.find((s) => s.id === state.sheet.id)
    return state.sheet.auto ? bestLayout(sheet, p.w, p.h) : layoutSheet(sheet, p.w, p.h, state.sheet.margin, state.sheet.gap)
  }

  function drawSheet(lay, photo, scalePxPerMm, lines) {
    const W = Math.round(lay.sw * scalePxPerMm), H = Math.round(lay.sh * scalePxPerMm)
    const c = makeCanvas(W, H)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    ctx.imageSmoothingQuality = 'high'
    const n = state.sheet.copies > 0 ? Math.min(state.sheet.copies, lay.count) : lay.count
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / lay.cols), col = i % lay.cols
      const x = (lay.x0 + col * (lay.pw + lay.gap)) * scalePxPerMm, y = (lay.y0 + r * (lay.ph + lay.gap)) * scalePxPerMm
      const w = lay.pw * scalePxPerMm, hh = lay.ph * scalePxPerMm
      if (lay.rotated) {
        ctx.save(); ctx.translate(x + w / 2, y + hh / 2); ctx.rotate(Math.PI / 2); ctx.drawImage(photo, -hh / 2, -w / 2, hh, w); ctx.restore()
      } else ctx.drawImage(photo, x, y, w, hh)
      if (lines) { ctx.strokeStyle = 'rgba(120,120,130,.55)'; ctx.lineWidth = Math.max(1, scalePxPerMm * 0.12); ctx.strokeRect(x, y, w, hh) }
    }
    return { canvas: c, n }
  }

  const redrawSheet = debounce(() => {
    if (!state.work) return
    const lay = sheetLayout()
    clear(sheetInfo)
    if (!lay) { sheetCv.width = 10; sheetCv.height = 10; sheetInfo.textContent = 'This photo is bigger than the paper.'; return }
    const p = preset()
    const photo = render(Math.round(p.w * 8), Math.round(p.h * 8))
    const { canvas: c, n } = drawSheet(lay, photo, 3, state.sheet.lines)
    sheetCv.width = c.width; sheetCv.height = c.height
    sheetCv.getContext('2d').drawImage(c, 0, 0)
    sheetCv.style.aspectRatio = `${c.width} / ${c.height}`
    sheetCv.style.width = `min(100%, ${lay.landscape ? 460 : 300}px)`
    const sheet = SHEETS.find((s) => s.id === state.sheet.id)
    sheetInfo.textContent = `${n} photo${n === 1 ? '' : 's'} on ${sheet.name.split(' (')[0]}${lay.landscape ? ' (landscape)' : ''}`
    copies.placeholder = `All (${lay.count})`
  }, 30)

  // ---------- export
  async function exportPhoto() {
    if (!state.work || !state.geo) throw new Error('Add a photo first.')
    const p = preset()
    const [w, hh] = outPixels()
    const c = render(w, hh)
    const base = `${p.id}-${w}x${hh}`
    if (state.out.mode === 'online') {
      const maxBytes = state.out.kb > 0 ? state.out.kb * 1024 : Infinity
      if (state.out.fmt === 'png') {
        const blob = await toBlob(c, 'image/png')
        return { blob, name: `passport-photo-${base}.png`, note: `${w} x ${hh} px PNG (${formatBytes(blob.size)})` }
      }
      const r = Number.isFinite(maxBytes)
        ? await compressToTarget(c, { maxBytes, type: 'image/jpeg', allowResize: false, minQuality: 0.3 })
        : { blob: await toBlob(c, 'image/jpeg', 0.95), quality: 0.95, width: w, height: hh, hit: true }
      if (!r.hit && Number.isFinite(maxBytes)) toast(`Could not get under ${state.out.kb} KB at this size. Try a smaller width.`, 'error')
      return { blob: r.blob, name: `passport-photo-${base}.jpg`, note: `${w} x ${hh} px JPG (${formatBytes(r.blob.size)})` }
    }
    if (state.out.fmt === 'png') {
      const bytes = pngSetDpi(new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer()), DPI)
      return { blob: new Blob([bytes], { type: 'image/png' }), name: `passport-photo-${base}.png`, note: `${w} x ${hh} px at ${DPI} DPI` }
    }
    const bytes = jpegSetDpi(new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.97)).arrayBuffer()), DPI)
    return { blob: new Blob([bytes], { type: 'image/jpeg' }), name: `passport-photo-${base}.jpg`, note: `${w} x ${hh} px at ${DPI} DPI` }
  }

  async function exportSheet(kind) {
    if (!state.work || !state.geo) throw new Error('Add a photo first.')
    const p = preset()
    const lay = sheetLayout()
    if (!lay) throw new Error('This photo is bigger than the paper. Choose a larger sheet.')
    const photo = render(mmToPx(p.w, DPI), mmToPx(p.h, DPI))
    const { canvas: c, n } = drawSheet(lay, photo, DPI / 25.4, state.sheet.lines)
    const jpg = jpegSetDpi(new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.95)).arrayBuffer()), DPI)
    const sheet = SHEETS.find((s) => s.id === state.sheet.id)
    const name = `${p.id}-sheet-${sheet.id}-${n}x`
    if (kind === 'jpg') return { blob: new Blob([jpg], { type: 'image/jpeg' }), name: `${name}.jpg`, n }
    const { PDFDocument } = await pdfLib()
    const doc = await PDFDocument.create()
    const img = await doc.embedJpg(jpg)
    const wpt = (lay.sw / 25.4) * 72, hpt = (lay.sh / 25.4) * 72
    const page = doc.addPage([wpt, hpt])
    page.drawImage(img, { x: 0, y: 0, width: wpt, height: hpt })
    return { blob: await savePdf(doc), name: `${name}.pdf`, n, size: [wpt, hpt] }
  }

  function presetChanged(initial = false) {
    const p = preset()
    if (state.presetId !== 'custom') setPref('image-ai:passport', { ...getPref('image-ai:passport', {}), [idMode ? 'idPreset' : 'preset']: state.presetId })
    if (!state.bg) bgSw.set(p.bg)
    if (!initial) { redraw(); }
    clear(presetNote, note('info', `${p.note} Requirements change, so confirm with the issuing authority before printing.`))
    updateSizeChip()
  }

  function reset() {
    ctl.abort()
    state.file = null; state.work = null; state.mesh = null; state.cutout = null; state.alpha = null; state.geo = null
    state.adj = { zoom: 1, dx: 0, dy: 0 }
    zoom.set(100); shiftX.set(0); shiftY.set(0)
    studioEl.hidden = true; hero.hidden = false; intro.hidden = false
    clear(errSlot); scan.stop(); stepper.set(0)
  }

  // Drag the photo inside the frame
  drag(frame, (type, e) => {
    if (!state.work || !state.geo) return
    if (type === 'down') frame._s = { x: e.clientX, y: e.clientY, dx: state.adj.dx, dy: state.adj.dy }
    else if (type === 'move' && frame._s) {
      const r = frame.getBoundingClientRect()
      state.adj.dx = Math.max(-0.4, Math.min(0.4, frame._s.dx + (e.clientX - frame._s.x) / r.width))
      state.adj.dy = Math.max(-0.4, Math.min(0.4, frame._s.dy + (e.clientY - frame._s.y) / r.height))
      shiftX.set(Math.round(state.adj.dx * 100)); shiftY.set(Math.round(state.adj.dy * 100))
      redraw()
    } else if (type === 'up') frame._s = null
  })

  return () => ctl.abort()
}

let styled = false
function injectStyle() {
  if (styled || document.getElementById('ia-pp-style')) return
  styled = true
  document.head.append(h('style', { id: 'ia-pp-style' }, `
.ia-pp-frame { position: relative; margin: 0 auto; aspect-ratio: var(--ar, .78); touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; max-width: 100%; }
.ia-pp-frame:active { cursor: grabbing; }
.ia-pp-guides { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.ia-pp-checks { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 8px; }
.ia-pp-check { display: flex; gap: 9px; align-items: flex-start; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); animation: ia-rise .35s var(--ease) both; }
.ia-pp-check .icon { margin-top: 2px; }
.ia-pp-check b { display: block; font-size: 13.5px; font-weight: 600; }
.ia-pp-check small { display: block; color: var(--muted); font-size: 12px; line-height: 1.35; margin-top: 1px; }
.ia-pp-check.ok .icon { color: var(--success); } .ia-pp-check.ok { border-color: color-mix(in srgb, var(--success) 25%, var(--border)); }
.ia-pp-check.warn .icon { color: var(--warning); } .ia-pp-check.warn { background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 30%, var(--border)); }
.ia-pp-check.info .icon { color: var(--info); }
.ia-pp-list { display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow: auto; margin: 0 -6px; padding: 2px 6px; }
.ia-pp-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px; border-radius: 12px; border: 1px solid transparent; background: transparent; cursor: pointer; color: var(--text); transition: background .15s, border-color .15s, transform .2s var(--spring); }
.ia-pp-item:hover { background: var(--surface-2); }
.ia-pp-item[aria-selected="true"] { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.ia-pp-item .cc { flex: none; width: 34px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: 11px; font-weight: 700; letter-spacing: .04em; background: var(--surface-3); color: var(--text-2); }
.ia-pp-item[aria-selected="true"] .cc { background: var(--accent); color: var(--accent-text); }
.ia-pp-item .nm { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.ia-pp-item .nm b { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ia-pp-item .nm small { font-size: 11.5px; color: var(--muted); }
.ia-pp-item .sz { flex: none; font-size: 11.5px; color: var(--muted); font-family: var(--mono); }
.ia-pp-sheetcard { padding: 14px 16px; }
.ia-pp-sheethead { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; flex-wrap: wrap; }
.ia-pp-sheethead .icon { color: var(--accent); }
.ia-pp-sheetinfo { color: var(--muted); font-size: 13px; margin-left: auto; }
.ia-pp-sheetbox { display: grid; place-items: center; padding: 14px; border-radius: 16px; background: var(--surface-2); }
.ia-pp-sheetcv { display: block; background: #fff; border-radius: 4px; box-shadow: 0 14px 34px -16px rgba(0, 0, 0, .45); height: auto; }
.ia-pp-searchwrap { display: block; }
`))
}
