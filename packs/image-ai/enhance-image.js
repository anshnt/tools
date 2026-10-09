// Photo quality enhancer: one-tap Auto fix (levels, white balance, exposure, shadows, color, noise, sharpness) with
// manual sliders and a live before/after slider. Everything runs locally; batch export as a ZIP.
import { h, icon, button, busy, alert, clear, segmented, rangeField, toast, download, progress, debounce, fileType, formatBytes } from '../../lib/ui.js'
import { suffixName, zip } from '../../lib/files.js'
import { canvas as makeCanvas, canEncode } from '../../lib/image.js'
import { loadWorking, fitCanvas, thumbOf, canvasBlob, friendlyError, handoff } from './_ml.js'
import { analyze, autoParams, enhance, DEFAULTS, PRESETS } from './_enhance.js'
import { shell, steps, heroDrop, panelOf, section, stage, compare, strip, note, burst, doneCard, scanFx } from './_ui.js'

const PROXY_MAX = 1400
const MAX_FILES = 30
const SLIDERS = {
  Light: [
    ['autoLevels', 'Auto contrast stretch', 0, 100, 1, (v) => (v ? `${v}%` : 'Off')],
    ['exposure', 'Exposure', -1.5, 1.5, 0.05, (v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))],
    ['contrast', 'Contrast', -60, 60, 1, (v) => (v > 0 ? `+${v}` : `${v}`)],
    ['highlights', 'Recover highlights', 0, 100, 1, (v) => `${v}`],
    ['shadows', 'Lift shadows', 0, 100, 1, (v) => `${v}`],
  ],
  Color: [
    ['autoWB', 'Auto white balance', 0, 100, 1, (v) => (v ? `${v}%` : 'Off')],
    ['warmth', 'Warmth', -100, 100, 1, (v) => (v > 0 ? `+${v}` : `${v}`)],
    ['vibrance', 'Vibrance', 0, 100, 1, (v) => `${v}`],
    ['saturation', 'Saturation', -100, 60, 1, (v) => (v > 0 ? `+${v}` : `${v}`)],
  ],
  Detail: [
    ['sharpen', 'Sharpen', 0, 200, 1, (v) => `${v}%`],
    ['denoise', 'Reduce noise', 0, 100, 1, (v) => `${v}`],
  ],
}
const CHIPS = [['auto', 'Auto fix', 'wand-sparkles'], ['vivid', 'Vivid', 'palette'], ['crisp', 'Crisp', 'focus'], ['lowlight', 'Low light', 'moon'], ['soft', 'Soft', 'feather'], ['document', 'Document', 'file-text'], ['none', 'Original', 'undo-2']]

export function mount(root, { signal }) {
  const items = []
  let active = null
  let seq = 0
  const out = { fmt: 'jpg', quality: 92 }
  const ctl = new AbortController()
  signal.addEventListener('abort', () => ctl.abort())

  const stepper = steps(['Add photos', 'Tune', 'Download'], 0)
  const beforeCv = document.createElement('canvas')
  const afterCv = document.createElement('canvas')
  const cmp = compare(beforeCv, afterCv, { beforeLabel: 'Before', afterLabel: 'After', start: 0.5 })
  const stg = stage('on-plain')
  const scan = scanFx()
  const nameChip = h('div', { class: 'ia-chip bl' }, icon('image'), h('span', ''))
  const statChip = h('div', { class: 'ia-chip br' }, icon('activity'), h('span', ''))
  stg.append(cmp, nameChip, statChip, scan.el)
  const msgSlot = h('div')
  const doneSlot = h('div')
  const thumbs = strip({ onSelect: (i) => select(items[i]), onRemove: (i) => removeItem(items[i]), onAdd: () => hero.zone.open() })

  // ---------- controls
  const chipBar = h('div', { class: 'ia-ei-chips', role: 'group', 'aria-label': 'Presets' })
  const chipBtns = new Map()
  for (const [id, label, ic] of CHIPS) {
    const b = h('button', { type: 'button', class: 'ia-ei-chip', 'aria-pressed': 'false', onclick: () => applyPreset(id) }, icon(ic), label)
    chipBtns.set(id, b)
    chipBar.append(b)
  }
  const fields = {}
  const groups = Object.entries(SLIDERS).map(([title, list], gi) => section(title, ['sun', 'palette', 'focus'][gi], list.map(([key, label, min, max, step, fmt]) => {
    const f = rangeField(label, { min, max, step, value: 0, format: fmt, onInput: (v) => { if (!active) return; active.p[key] = v; active.chip = null; markChip(null); redraw() } })
    fields[key] = f
    return f
  })))
  const resetBtn = button('Reset all', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: () => applyPreset('none') })
  const allBtn = button('Use these settings on every photo', { icon: 'copy', variant: 'secondary', size: 'sm', onClick: () => { for (const it of items) if (it !== active) { it.p = { ...active.p }; it.chip = active.chip } toast(`Applied to ${items.length - 1} other photo${items.length === 2 ? '' : 's'}`, 'success') } })
  allBtn.hidden = true
  const fmtSeg = segmented([['jpg', 'JPG'], ['png', 'PNG'], ...(canEncode('image/webp') ? [['webp', 'WebP']] : [])], out.fmt, (v) => { out.fmt = v; quality.hidden = v === 'png' }, 'File format')
  const quality = rangeField('Quality', { min: 60, max: 100, value: out.quality, format: (v) => `${v}%`, onInput: (v) => { out.quality = v } })
  const panel = panelOf(
    section('Quick looks', 'wand-sparkles', [chipBar, h('div', { class: 'row' }, resetBtn, allBtn)]),
    ...groups,
    section('Download', 'download', [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Format'), fmtSeg), quality, note('shield-check', 'Everything happens in your browser. Photos are never uploaded.')], false))

  const dlBtn = button('Download photo', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  dlBtn.addEventListener('click', () => busy(dlBtn, async () => {
    if (!active) return
    const r = await exportItem(active)
    download(r.blob, r.name)
    toast(`Saved (${formatBytes(r.blob.size)})`, 'success')
  }, { label: 'Preparing file', errorTo: msgSlot }))
  const zipBtn = button('Download all as ZIP', { icon: 'archive', variant: 'secondary', block: true })
  const zipProg = progress('Enhancing')
  zipBtn.addEventListener('click', () => busy(zipBtn, async () => {
    const files = []
    for (let i = 0; i < items.length; i++) {
      zipProg.set(i / items.length, `Enhancing ${items[i].name} (${i + 1} of ${items.length})`)
      const r = await exportItem(items[i])
      files.push({ name: r.name, data: r.blob })
    }
    zipProg.set(1, 'Zipping')
    download(await zip(files), 'enhanced-photos.zip')
    toast(`Saved ${files.length} photos`, 'success')
  }, { label: 'Working', progress: zipProg }))
  zipBtn.hidden = true
  const side = h('div', { class: 'ia-side' }, panel, h('div', { class: 'stack tight' }, dlBtn, zipBtn, zipProg.el, button('Start over', { icon: 'rotate-ccw', variant: 'ghost', block: true, onClick: reset })))
  const studioEl = h('div', { class: 'ia-studio', hidden: true }, h('div', { class: 'ia-main' }, thumbs.el, stg, msgSlot, doneSlot), side)

  const hero = heroDrop({
    accept: 'image/*', multiple: true, label: 'Drop photos to fix',
    hint: 'Dull, dark, hazy, noisy or soft? We analyse each photo and suggest the fix. Paste with Ctrl+V works too.',
    icons: ['sparkles', 'sun', 'palette', 'focus'],
    features: [['shield-check', 'Stays on your device'], ['wand-sparkles', 'One-tap Auto fix'], ['columns-2', 'Live before and after']],
    onFiles: addFiles,
  })
  injectStyle()
  shell(root, stepper, hero, studioEl)

  const held = handoff.take()
  if (held) addFiles([held.file])

  // ---------- items
  async function addFiles(files) {
    files = files.slice(0, MAX_FILES - items.length)
    if (!files.length) return toast(`That is the limit for one batch (${MAX_FILES} photos).`)
    for (const f of files) {
      const it = { id: ++seq, file: f, name: f.name, thumb: null, status: '', p: { ...DEFAULTS }, chip: 'auto' }
      if (/^image\/(jpeg|png|webp|gif|avif|bmp)/.test(fileType(f))) it.thumb = URL.createObjectURL(f)
      items.push(it)
    }
    hero.hidden = true; studioEl.hidden = false
    if (!active) await select(items[items.length - files.length])
    else renderThumbs()
    zipBtn.hidden = items.length < 2
    allBtn.hidden = items.length < 2
  }

  function removeItem(it) {
    items.splice(items.indexOf(it), 1)
    if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb)
    if (!items.length) return reset()
    if (it === active) select(items[0]); else renderThumbs()
    zipBtn.hidden = items.length < 2; allBtn.hidden = items.length < 2
  }

  function reset() {
    for (const it of items) if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb)
    items.length = 0; active = null
    studioEl.hidden = true; hero.hidden = false
    clear(msgSlot); clear(doneSlot); stepper.set(0)
  }

  function renderThumbs() {
    thumbs.render(items.map((it) => ({ name: it.name, thumb: it.thumb, status: it.status })), items.indexOf(active))
  }

  async function prepare(it) {
    if (it.proxy) return it
    const work = await loadWorking(it.file, { maxSide: 5000 })
    const pc = fitCanvas(work.canvas, PROXY_MAX)
    const px = pc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, pc.width, pc.height)
    it.dims = [work.originalWidth, work.originalHeight]
    it.proxy = { canvas: pc, img: px }
    it.a = analyze(px)
    it.auto = autoParams(it.a)
    it.p = { ...it.auto }
    it.thumb = it.thumb || await thumbOf(work.canvas)
    it.status = 'done'
    return it
  }

  async function select(it) {
    active = it
    renderThumbs(); clear(msgSlot); clear(doneSlot)
    scan.start('Looking at your photo')
    try { await prepare(it) } catch (e) { scan.stop(); clear(msgSlot, alert('error', friendlyError(e).message)); return }
    scan.stop()
    if (active !== it) return
    beforeCv.width = it.proxy.canvas.width; beforeCv.height = it.proxy.canvas.height
    beforeCv.getContext('2d').drawImage(it.proxy.canvas, 0, 0)
    cmp.setAspect(beforeCv.width, beforeCv.height)
    nameChip.querySelector('span').textContent = `${it.name}  -  ${it.dims[0]} x ${it.dims[1]}`
    syncFields()
    markChip(it.chip)
    redraw.now()
    renderThumbs()
    stepper.set(2)
    cmp.sweep()
    burst(stg, 8)
    const a = it.a
    const notes = []
    if (a.mean < 0.33) notes.push('a bit dark')
    if (a.sd < 0.17) notes.push('flat contrast')
    if (Math.max(...a.grayWorld.map((v) => Math.abs(v - 1))) > 0.1) notes.push('a color cast')
    if (a.noise > 3.5) notes.push('visible noise')
    if (a.blur < 0.03) notes.push('on the soft side')
    clear(doneSlot, doneCard({ title: notes.length ? `Fixed: ${notes.join(', ')}` : 'Looks good already, we gave it a light polish', sub: 'Drag the slider to compare, or tweak the controls on the right.', actions: [] }))
  }

  function syncFields() {
    for (const [k, f] of Object.entries(fields)) f.set(active.p[k])
  }

  function markChip(id) {
    for (const [k, b] of chipBtns) b.setAttribute('aria-pressed', String(k === id))
  }

  function applyPreset(id) {
    if (!active) return
    active.p = id === 'auto' ? { ...active.auto } : id === 'none' ? { ...DEFAULTS } : { ...PRESETS[id] }
    active.chip = id
    syncFields(); markChip(id); redraw.now()
  }

  // ---------- rendering
  const render = () => {
    const it = active
    if (!it?.proxy) return
    const t0 = performance.now()
    const data = enhance(it.proxy.img, it.p, it.a, { fast: true })
    afterCv.width = it.proxy.img.width; afterCv.height = it.proxy.img.height
    afterCv.getContext('2d').putImageData(new ImageData(data, it.proxy.img.width, it.proxy.img.height), 0, 0)
    const b = analyze({ data, width: it.proxy.img.width, height: it.proxy.img.height })
    statChip.querySelector('span').textContent = `Brightness ${Math.round(it.a.mean * 100)} to ${Math.round(b.mean * 100)}  -  Contrast ${Math.round(it.a.sd * 100)} to ${Math.round(b.sd * 100)}`
    void t0
  }
  const redraw = debounce(render, 40)
  redraw.now = render

  async function exportItem(it) {
    await prepare(it)
    const work = await loadWorking(it.file, { maxSide: 5000 })
    const id = work.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, work.width, work.height)
    const data = enhance(id, it.p, it.a)
    const c = makeCanvas(work.width, work.height)
    c.getContext('2d').putImageData(new ImageData(data, work.width, work.height), 0, 0)
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[out.fmt]
    return { blob: await canvasBlob(c, type, out.quality / 100), name: suffixName(it.name, 'enhanced', out.fmt) }
  }

  return () => { ctl.abort(); for (const it of items) if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb) }
}

let styled = false
function injectStyle() {
  if (styled || document.getElementById('ia-ei-style')) return
  styled = true
  document.head.append(h('style', { id: 'ia-ei-style' }, `
.ia-ei-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ia-ei-chip { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 13px; font-weight: 550; cursor: pointer; transition: all .2s var(--ease); }
.ia-ei-chip .icon { width: 14px; height: 14px; color: var(--muted); transition: color .2s, transform .3s var(--spring); }
.ia-ei-chip:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.ia-ei-chip[aria-pressed="true"] { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); color: var(--accent-text); border-color: transparent; box-shadow: 0 8px 18px -10px var(--accent); }
.ia-ei-chip[aria-pressed="true"] .icon { color: inherit; transform: rotate(-10deg) scale(1.1); }
`))
}
