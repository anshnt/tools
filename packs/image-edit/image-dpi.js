// Change image DPI: rewrites the density in JPG (JFIF and Exif) and PNG (pHYs) without touching a single pixel. Batch with ZIP.
import { number, progress } from '../../lib/ui.js'
import {
  shell, h, icon, button, busy, field, chips, section, note, hint, tiles, batchSlot, results, runBatch, readSource, previewCanvas, encode, outName,
  clear, toast, errorMessage, formatNumber,
} from './_kit.js'
import { setJpegDpi, setPngDpi, readDensity, sniff } from './_meta.js'

const PRESETS = [[72, '72', 'screen'], [96, '96', 'Windows'], [150, '150', 'draft print'], [200, '200'], [300, '300', 'photo print'], [600, '600', 'high-end']]

/** Pixel size to print size at a DPI: {in: [w, h], cm: [w, h]}. */
export function printSize(w, hh, dpi) {
  return { in: [w / dpi, hh / dpi], cm: [(w / dpi) * 2.54, (hh / dpi) * 2.54] }
}

export function mount(root, { signal }) {
  const o = { dpi: 300, other: 'png' }
  const dpiIn = number(300, { min: 1, max: 65535, step: 1, ariaLabel: 'DPI', onInput: (v) => { o.dpi = Math.round(v); presets.set(null); sync() } })
  const presets = chips(PRESETS.map(([v, l, s]) => [v, l, undefined, s]), 300, (v) => { o.dpi = v; dpiIn.value = v; sync() }, { label: 'DPI' })
  const other = chips([['png', 'PNG (lossless)'], ['jpg', 'JPG']], 'png', (v) => { o.other = v }, { label: 'Other formats' })
  const facts = h('div'), sizes = h('div')
  let cur = null

  async function inspect(file) {
    if (!file) { cur = null; clear(facts); clear(sizes); return }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const kind = sniff(bytes)
      const src = await readSource(file)
      cur = { file, kind, w: src.w, h: src.h, dens: readDensity(bytes) }
      sync()
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  function sync() {
    goBtn.disabled = !(o.dpi >= 1 && o.dpi <= 65535)
    if (!cur) return
    const { w, h: hh, kind, dens } = cur
    const ps = printSize(w, hh, o.dpi)
    const now = dens.dpi ? `${dens.dpi[0]}${dens.dpi[1] !== dens.dpi[0] ? ` x ${dens.dpi[1]}` : ''} DPI` : 'Not set'
    clear(facts, tiles([
      { label: 'Pixels', value: `${w} x ${hh}`, sub: 'These never change' },
      { label: 'DPI now', value: now, sub: kind === 'jpeg' || kind === 'png' ? `stored as ${dens.source || 'nothing'}` : `${(kind || 'this').toUpperCase()} cannot store DPI` },
      { label: `Prints at ${o.dpi} DPI`, value: `${formatNumber(ps.cm[0], 1)} x ${formatNumber(ps.cm[1], 1)} cm`, sub: `${formatNumber(ps.in[0], 1)} x ${formatNumber(ps.in[1], 1)} inches`, hot: true },
    ]))
    const dpiRows = [72, 150, 300].map((d) => { const p = printSize(w, hh, d); return h('div', { class: 'ie-note' }, h('b', `${d} DPI`), ` prints at ${formatNumber(p.cm[0], 1)} x ${formatNumber(p.cm[1], 1)} cm`) })
    clear(sizes, h('div', { class: 'stack tight' }, dpiRows))
  }

  const prog = progress()
  const res = results({ zipName: 'dpi-changed.zip', compare: false, noun: 'image' })
  const goBtn = button('Set DPI', { icon: 'printer', variant: 'primary', size: 'lg', block: true })
  const slot = batchSlot({ ic: 'printer', onChange: (fs) => { goBtn.querySelector('span').textContent = fs.length > 1 ? `Set ${fs.length} images to ${o.dpi} DPI` : 'Set DPI'; if (!fs.length) { inspect(null); work.hidden = true } else work.hidden = false }, onSelect: inspect })
  const retitle = () => { const n = slot.files.length; goBtn.querySelector('span').textContent = n > 1 ? `Set ${n} images to ${o.dpi} DPI` : `Set to ${o.dpi} DPI` }
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return
    const dpi = o.dpi
    await runBatch(files, async (file) => {
      let bytes = new Uint8Array(await file.arrayBuffer())
      const kind = sniff(bytes)
      let name = file.name, noteText = '', blob
      let w, hh
      if (kind === 'jpeg') blob = new Blob([setJpegDpi(bytes, dpi)], { type: 'image/jpeg' })
      else if (kind === 'png') blob = new Blob([setPngDpi(bytes, dpi)], { type: 'image/png' })
      else {
        const src = await readSource(file)
        const c = previewCanvas(src.img, 1e6)
        const enc = await encode(c, o.other, { quality: 0.95 })
        const out = new Uint8Array(await enc.arrayBuffer())
        blob = new Blob([o.other === 'png' ? setPngDpi(out, dpi) : setJpegDpi(out, dpi)], { type: enc.type })
        name = outName(file.name, '', o.other)
        noteText = `${(kind || 'image').toUpperCase()} cannot store DPI, so it was saved as ${o.other.toUpperCase()}`
      }
      const check = readDensity(new Uint8Array(await blob.arrayBuffer()))
      const src2 = await readSource(new File([blob], name, { type: blob.type }))
      w = src2.w; hh = src2.h
      const final = name === file.name ? outName(file.name, `${dpi}dpi`, kind === 'jpeg' ? 'jpg' : 'png') : outName(name, `${dpi}dpi`, o.other)
      return { name: final, blob, w, h: hh, inSize: file.size, badge: `${check.dpi ? check.dpi[0] : '?'} DPI`, badgeKind: check.dpi && check.dpi[0] === dpi ? 'good' : 'warn', note: noteText || 'pixels untouched' }
    }, { out: res, prog, signal, label: 'Writing DPI' })
  }, { label: 'Writing DPI', progress: prog }))
  for (const el of [presets, dpiIn]) el.addEventListener('input', retitle), el.addEventListener('click', retitle)

  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Target DPI', 'printer', presets, field('Custom DPI', dpiIn), note('DPI is only a note inside the file that tells printers how big to print. Your pixels stay exactly as they are.')),
    section('Other formats', 'file-type', other, note('WebP, GIF, AVIF and HEIC have no place to store DPI. They are converted first.')),
    h('div', { class: 'ie-foot' }, goBtn, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main' }, facts, h('div', { class: 'panel ie-glass' }, h('div', { class: 'ie-sec-title' }, icon('ruler'), h('span', 'Print sizes of this image')), sizes), hint('JPG and PNG are changed byte for byte, so there is no quality loss.', 'shield-check')), side)
  root.append(shell(slot.el, work, res.el))
  retitle()
}
