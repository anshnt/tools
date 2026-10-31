// DICOM viewer: open a medical image, adjust window and level, step through frames, save a PNG or JPG. Everything stays on the device.
import {
  h, dropzone, button, busy, select, toggle, rangeField, field, panel, alert, table, formatBytes, download, errorMessage, onCleanup,
} from '../../lib/ui.js'
import { openDicom } from './_decode.js'
import { renderDicomFrame, autoWindow, valueRange } from './_sci.js'
import { toCanvas, canvasBlob } from './_raster.js'

const PRESETS = [
  ['file', 'From the file'], ['auto', 'Automatic'], ['soft', 'Soft tissue (40 / 400)'], ['brain', 'Brain (40 / 80)'], ['lung', 'Lung (-600 / 1500)'], ['bone', 'Bone (400 / 1800)'], ['liver', 'Liver (60 / 160)'],
]
const WL = { soft: [40, 400], brain: [40, 80], lung: [-600, 1500], bone: [400, 1800], liver: [60, 160] }

export function mount(root, { params = {} }) {
  let dc = null, frame = 0, data = null, win = { center: 0, width: 1 }, range = [0, 1], invert = false, fileName = 'dicom'
  const canvas = h('canvas', { class: 'dv-canvas', width: 256, height: 256, role: 'img', 'aria-label': 'DICOM image preview' })
  const stage = h('div', { class: 'dv-stage' }, canvas)
  const info = h('div', { class: 'stack' })
  const status = h('div')

  const center = rangeField('Window center (level)', { min: -1000, max: 1000, step: 1, value: 0, format: (v) => String(Math.round(v)), onInput: (v) => { win.center = v; draw() } })
  const width = rangeField('Window width', { min: 1, max: 4000, step: 1, value: 400, format: (v) => String(Math.round(v)), onInput: (v) => { win.width = v; draw() } })
  const presetSel = select(PRESETS, 'file', (v) => applyPreset(v))
  const inv = toggle('Invert', false, (v) => { invert = v; draw() })
  const frameField = rangeField('Frame', { min: 1, max: 1, step: 1, value: 1, format: (v) => `${Math.round(v)}`, onInput: (v) => { setFrame(Math.round(v) - 1) } })
  const controls = panel(h('h2', 'Window and level'),
    field('Preset', presetSel), center, width, inv, frameField,
    h('p', { class: 'muted small' }, 'Tip: drag on the image. Left and right changes the width, up and down changes the level.'),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      button('Save PNG', { icon: 'download', variant: 'primary', onClick: (e) => save(e.currentTarget, 'png') }),
      button('Save JPG', { icon: 'download', onClick: (e) => save(e.currentTarget, 'jpg') })))
  controls.hidden = true

  const dz = dropzone({ accept: '.dcm,.dicom,.dic', multiple: false, label: 'Drop a DICOM file here or click to choose', hint: 'DCM files from CT, MR, X-ray and ultrasound', onFiles: ([f]) => load(f) })

  async function load(file) {
    fileName = file.name.replace(/\.[^.]+$/, '') || 'dicom'
    status.replaceChildren(alert('info', 'Reading the file'))
    try {
      dc = await openDicom(file)
      frame = 0
      frameField.input.max = dc.frameCount
      frameField.input.value = 1
      frameField.set(1)
      frameField.hidden = dc.frameCount < 2
      await setFrame(0, true)
      status.replaceChildren()
      controls.hidden = false
      showInfo(file)
    } catch (e) {
      console.error(e)
      status.replaceChildren(alert('error', errorMessage(e)))
    }
  }

  async function setFrame(i, first = false) {
    frame = Math.max(0, Math.min(dc.frameCount - 1, i))
    data = await dc.frameData(frame)
    const gray = !data.rgb
    center.hidden = width.hidden = presetSel.parentElement.hidden = inv.hidden = !gray
    if (gray) {
      range = valueRange(data, dc.info)
      const span = Math.max(1, range[1] - range[0])
      width.input.max = Math.ceil(span * 1.2); width.input.min = 1
      center.input.min = Math.floor(range[0] - span * 0.1); center.input.max = Math.ceil(range[1] + span * 0.1)
      if (first) applyPreset('file', true)
    }
    draw()
  }

  function applyPreset(name, silent) {
    const fileWin = autoWindow(data, dc.info)
    let c, w
    if (name === 'file' || name === 'auto') {
      if (name === 'auto') { const a = autoWindow(data, { ...dc.info, windowWidth: null, windowCenter: null }); c = a.center; w = a.width } else { c = fileWin.center; w = fileWin.width }
    } else [c, w] = WL[name]
    win = { center: c, width: w }
    center.input.value = c; width.input.value = w
    center.set(c); width.set(w)
    presetSel.value = name
    if (!silent) draw()
  }

  function draw() {
    if (!data) return
    const r = renderDicomFrame(data, dc.info, { center: win.center, width: win.width, invert })
    canvas.width = r.width; canvas.height = r.height
    canvas.getContext('2d').putImageData(new ImageData(r.data, r.width, r.height), 0, 0)
  }

  // drag to adjust the window: horizontal = width, vertical = level
  let drag = null
  canvas.addEventListener('pointerdown', (e) => { if (!data || data.rgb) return; drag = { x: e.clientX, y: e.clientY, c: win.center, w: win.width }; canvas.setPointerCapture(e.pointerId) })
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return
    const span = Math.max(1, range[1] - range[0]) / Math.max(200, canvas.clientWidth)
    win.width = Math.max(1, drag.w + (e.clientX - drag.x) * span * 2)
    win.center = drag.c + (e.clientY - drag.y) * span * 2
    center.set(win.center); width.set(win.width); center.input.value = win.center; width.input.value = win.width
    draw()
  })
  canvas.addEventListener('pointerup', () => { drag = null })
  canvas.addEventListener('pointercancel', () => { drag = null })

  function save(btn, type) {
    return busy(btn, async () => {
      const r = renderDicomFrame(data, dc.info, { center: win.center, width: win.width, invert })
      const blob = await canvasBlob(toCanvas(r), type === 'png' ? 'image/png' : 'image/jpeg', 0.92)
      download(blob, `${fileName}${dc.frameCount > 1 ? `-frame-${frame + 1}` : ''}.${type}`)
    }, { label: 'Saving' })
  }

  function showInfo(file) {
    const i = dc.info
    const rows = [
      ['Modality', i.modality || '-'], ['Size', `${i.width} x ${i.height} pixels${i.frames > 1 ? `, ${i.frames} frames` : ''}`], ['Bits', `${i.bitsStored} stored, ${i.bitsAllocated} allocated`],
      ['Photometric', i.photometric], ['Compression', i.transferSyntax], ['Pixel spacing', i.pixelSpacing ? `${i.pixelSpacing.join(' x ')} mm` : '-'],
      ['Window in file', i.windowWidth ? `${i.windowCenter} / ${i.windowWidth}` : 'none'], ['Study date', i.studyDate || '-'], ['Study', i.studyDescription || '-'], ['Series', i.seriesDescription || '-'],
      ['Patient', i.patientName || '-'], ['Patient ID', i.patientId || '-'], ['File size', formatBytes(file.size)],
    ]
    info.replaceChildren(h('div', { class: 'panel' }, h('h2', 'Details'), table({ columns: ['Field', 'Value'], rows }),
      h('p', { class: 'muted small' }, 'Saved images contain pixels only. No patient details are written into them.')))
  }

  const style = h('style', `
.t-dv{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:start}
.t-dv .table-wrap{max-height:none;margin-bottom:10px}
.dv-stage{background:#000;border-radius:12px;display:grid;place-items:center;min-height:200px;padding:6px}
.dv-canvas{max-width:100%;max-height:70vh;width:auto;height:auto;touch-action:none;cursor:crosshair;image-rendering:auto}
@media (max-width:760px){.t-dv{grid-template-columns:1fr}}`)
  const view = h('div', { class: 't-dv' }, h('div', { class: 'stack' }, stage), h('div', { class: 'stack' }, controls, info))
  view.hidden = true
  const obs = new MutationObserver(() => { view.hidden = controls.hidden })
  obs.observe(controls, { attributes: true, attributeFilter: ['hidden'] })
  onCleanup(() => obs.disconnect())
  root.append(h('div', { class: 'stack' }, style, dz, status, view, h('p', { class: 'muted small' }, 'For viewing and converting only, not for diagnosis. Everything runs on your device and nothing is uploaded.')))
}
