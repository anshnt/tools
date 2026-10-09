// SVG to PNG: rasterise SVG files (or pasted code) at any scale or exact width, with background and format choice.
import { progress, number, textarea } from '../../lib/ui.js'
import { MAX_PIXELS } from '../../lib/image.js'
import {
  shell, h, button, busy, field, chips, section, note, tiles, stage, colorField, outputPicker, encodeWith, batchSlot, results, runBatch, rasterSvg,
  svgSize, resample, outName, clear, toast, errorMessage, FORMATS,
} from './_kit.js'

export function mount(root, { signal }) {
  const o = { mode: 'scale', scale: 2, width: 1024, height: 1024, bg: 'transparent' }
  const modeChips = chips([['scale', 'Scale', 'maximize-2'], ['width', 'Width', 'move-horizontal'], ['height', 'Height', 'move-vertical']], 'scale', (v) => { o.mode = v; syncMode(); draw() }, { label: 'Size by' })
  const scaleChips = chips([[1, '1x'], [2, '2x'], [3, '3x'], [4, '4x'], [8, '8x']], 2, (v) => { o.scale = v; scaleIn.value = v; draw() }, { label: 'Scale' })
  const scaleIn = number(2, { min: 0.1, max: 32, step: 0.1, ariaLabel: 'Scale factor', onInput: (v) => { o.scale = v; scaleChips.set(null); draw() } })
  const wIn = number(1024, { min: 1, max: 16000, step: 1, ariaLabel: 'Width in pixels', onInput: (v) => { o.width = v; draw() } })
  const hIn = number(1024, { min: 1, max: 16000, step: 1, ariaLabel: 'Height in pixels', onInput: (v) => { o.height = v; draw() } })
  const widthPresets = chips([[16, '16'], [32, '32'], [64, '64'], [128, '128'], [256, '256'], [512, '512'], [1024, '1024'], [2048, '2048']], null, (v) => { if (o.mode === 'width') { o.width = v; wIn.value = v } else { o.height = v; hIn.value = v } draw() })
  const scaleBox = h('div', { class: 'stack' }, scaleChips, field('Custom scale', scaleIn))
  const widthBox = h('div', { class: 'stack' }, widthPresets, field('Width (px)', wIn))
  const heightBox = h('div', { class: 'stack' }, field('Height (px)', hIn))
  const bg = colorField('Background', 'transparent', (v) => { o.bg = v; draw() }, { swatches: ['#ffffff', '#000000', '#f3f4f6'], none: true })
  const out = outputPicker({ formats: ['png', 'jpg', 'webp'], value: 'png', same: false, showBg: false })
  const paste = textarea({ rows: 8, mono: true, placeholder: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">...</svg>', 'aria-label': 'SVG code', oninput: () => drawPasted() })

  function syncMode() { scaleBox.hidden = o.mode !== 'scale'; widthBox.hidden = o.mode !== 'width'; heightBox.hidden = o.mode !== 'height'; widthPresets.hidden = o.mode === 'scale' }

  const host = stage(h('div', { class: 'ie-note ie-center' }, 'Add an SVG to see it rendered here.'))
  const info = h('div')
  let cur = null // {text, info, name}
  const sizeFor = (s) => {
    const k = o.mode === 'scale' ? o.scale : o.mode === 'width' ? o.width / s.w : o.height / s.h
    return { w: Math.max(1, Math.round(s.w * k)), h: Math.max(1, Math.round(s.h * k)) }
  }
  async function draw() {
    if (!cur) return
    const t = sizeFor(cur.info)
    const over = t.w * t.h > MAX_PIXELS
    goBtn.disabled = over || !(t.w > 0)
    const pk = Math.min(1, 900 / Math.max(t.w, t.h))
    try {
      const img = await rasterSvg(cur.text, Math.max(1, Math.round(t.w * pk)), Math.max(1, Math.round(t.h * pk)), cur.info)
      const c = resample(img, img.naturalWidth || t.w * pk, img.naturalHeight || t.h * pk, { background: o.bg === 'transparent' ? undefined : o.bg })
      host.replaceChildren(c)
    } catch (e) { host.replaceChildren(h('div', { class: 'ie-note' }, errorMessage(e))) }
    clear(info, tiles([
      { label: 'SVG size', value: `${Math.round(cur.info.w)} x ${Math.round(cur.info.h)}`, sub: cur.info.guessed ? 'No size inside the file, assumed 300 x 150' : 'from the file' },
      { label: 'PNG size', value: `${t.w} x ${t.h}`, hot: !over, bad: over, sub: over ? 'Too large for this device' : `${((t.w * t.h) / 1e6).toFixed(2)} megapixels` },
    ]))
  }
  async function select(file) {
    if (!file) { cur = null; work.hidden = tab.value === 'file'; return }
    try {
      const text = await file.text()
      cur = { text, info: svgSize(text), name: file.name }
      work.hidden = false
      draw()
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  function drawPasted() {
    const text = paste.value.trim()
    if (!text) { cur = null; host.replaceChildren(h('div', { class: 'ie-note ie-center' }, 'Paste SVG code to see it rendered here.')); clear(info); return }
    try { cur = { text, info: svgSize(text), name: 'pasted.svg' }; draw() } catch (e) { cur = null; host.replaceChildren(h('div', { class: 'ie-note' }, errorMessage(e))) }
  }

  const slot = batchSlot({ accept: '.svg,image/svg+xml', ic: 'pen-tool', label: 'Drop SVG files here or click to choose', formats: ['SVG'],
    onChange: (fs) => { retitle(); if (!fs.length && tab.value === 'file') { work.hidden = true; cur = null } else if (fs.length) work.hidden = false }, onSelect: select })
  const tab = chips([['file', 'Upload files', 'upload'], ['code', 'Paste code', 'code']], 'file', (v) => {
    slot.el.hidden = v !== 'file'; pasteBox.hidden = v !== 'code'
    if (v === 'code') { work.hidden = false; drawPasted() } else if (slot.files.length) select(slot.active || slot.files[0]); else { work.hidden = true; cur = null }
    retitle()
  }, { label: 'Input' })
  const pasteBox = h('div', { class: 'ie-sec', hidden: true }, field('SVG code', paste))
  const retitle = () => { const n = slot.files.length; goBtn.querySelector('span').textContent = tab.value === 'code' || n < 2 ? 'Convert to PNG' : `Convert ${n} SVGs` }

  const prog = progress()
  const res = results({ zipName: 'svg-to-png.zip', compare: false, noun: 'image' })
  const goBtn = button('Convert to PNG', { icon: 'pen-tool', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = tab.value === 'code' ? [new File([paste.value.trim()], 'pasted.svg', { type: 'image/svg+xml' })] : [...slot.files]
    if (!files.length || (tab.value === 'code' && !paste.value.trim())) return toast('Add an SVG first.', 'error')
    const pick = out.get()
    await runBatch(files, async (file) => {
      const text = await file.text()
      const inf = svgSize(text)
      const t = sizeFor({ w: inf.w, h: inf.h })
      if (t.w * t.h > MAX_PIXELS) throw new Error(`${t.w} x ${t.h} is too large to render here. Use a smaller size.`)
      const img = await rasterSvg(text, t.w, t.h, inf)
      const c = resample(img, t.w, t.h, { background: o.bg === 'transparent' ? undefined : o.bg })
      const blob = await encodeWith(c, { fmt: pick.fmt, quality: pick.quality, bg: o.bg === 'transparent' ? pick.bg : o.bg })
      const tag = o.mode === 'scale' ? `${o.scale}x` : `${t.w}x${t.h}`
      return { name: outName(file.name, tag, pick.fmt), blob, w: t.w, h: t.h, inSize: file.size, badge: FORMATS[pick.fmt].label }
    }, { out: res, prog, signal, label: 'Rendering' })
  }, { label: 'Rendering', progress: prog }))

  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Size', 'maximize-2', modeChips, scaleBox, widthBox, heightBox, note('SVG is vector, so any size stays perfectly sharp.')),
    section('Background', 'paint-bucket', bg),
    out.el,
    h('div', { class: 'ie-foot' }, goBtn, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin' }, host, info), side)
  root.append(shell(h('div', { class: 'row' }, tab), slot.el, pasteBox, work, res.el))
  syncMode(); retitle()
}
