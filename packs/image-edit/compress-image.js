// Compress image: quality slider with a live before/after comparison, format choice, optional max size, batch + ZIP.
import { progress, debounce } from '../../lib/ui.js'
import { canEncode } from '../../lib/image.js'
import {
  displayURL, shell, h, icon, button, busy, chips, section, note, hint, tiles, compare, slider, batchSlot, results, runBatch, readSource, resample, objURL, revokeURL, colorField,
  sameFormat, outName, clear, toast, errorMessage, formatBytes, encode, canWrite, FORMATS, download,
} from './_kit.js'
import { encodeIndexedPng } from './_encode.js'

const MAX_DIMS = [[0, 'Original'], [3840, '3840'], [2560, '2560'], [1920, '1920'], [1280, '1280'], [1024, '1024']]

/** PNG cannot be lossy, so the quality slider controls how many colors it keeps (98% and up stays lossless). */
export const pngColors = (q) => Math.max(8, Math.min(256, Math.round(2 ** (3 + (q / 100) * 5))))

/** Encode one decoded source with the given options. Returns {blob, w, h}. */
export async function compressSource(src, { fmt, quality, maxDim = 0, bg = '#ffffff' }) {
  let w = src.w, hh = src.h
  if (maxDim && Math.max(w, hh) > maxDim) { const k = maxDim / Math.max(w, hh); w = Math.max(1, Math.round(w * k)); hh = Math.max(1, Math.round(hh * k)) }
  const c = resample(src.img, w, hh)
  if (fmt === 'png') {
    const blob = quality >= 98 ? await encode(c, 'png') : await encodeIndexedPng(c, pngColors(quality))
    return { blob, w, h: hh }
  }
  return { blob: await encode(c, fmt, { quality: quality / 100, background: bg }), w, h: hh }
}

export function mount(root, { signal }) {
  const o = { fmt: 'same', quality: 75, maxDim: 0, bg: '#ffffff' }
  let active = null // {file, src, url}
  let seq = 0
  let live = null // {blob, url}

  const afterImg = h('img', { alt: 'Compressed preview' }), beforeImg = h('img', { alt: 'Original' })
  const cmp = compare({ before: beforeImg, after: afterImg, labels: ['Original', 'Compressed'] })
  const tileHost = h('div')
  const note1 = h('div')
  const formatChips = chips([['same', 'Same format'], ['jpg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']].filter((c) => c[0] !== 'webp' || canWrite('webp')), 'same', (v) => { o.fmt = v; sync(); refresh() }, { label: 'Output format' })
  const q = slider('Quality', { min: 10, max: 100, value: 75, format: (v) => `${v}%`, onInput: (v) => { o.quality = v; sync(); refreshSoon() } })
  const qHint = h('div', { class: 'ie-note' })
  const dims = chips(MAX_DIMS.map(([v, l]) => [v, l]), 0, (v) => { o.maxDim = v; refresh() }, { label: 'Longest side' })
  const bg = colorField('Background for transparent areas', '#ffffff', (v) => { o.bg = v; refreshSoon() }, { swatches: ['#ffffff', '#000000'] })

  const resolveFmt = (src) => (o.fmt === 'same' ? sameFormat(src?.type, src?.name) : o.fmt)
  function sync() {
    const fmt = active ? resolveFmt(active.src) : o.fmt === 'same' ? 'jpg' : o.fmt
    qHint.textContent = fmt === 'png' ? (o.quality >= 98 ? 'PNG at 98% or more is lossless. Lower it to merge similar colors and shrink the file a lot.' : `PNG is lossless, so this reduces the image to ${pngColors(o.quality)} colors.`)
      : fmt === 'webp' ? 'WebP usually beats JPG at the same quality.' : 'Around 70 to 80 looks the same to most eyes and is far smaller.'
    bg.hidden = fmt !== 'jpg'
  }

  async function refresh() {
    if (!active) return
    const token = ++seq
    const { src, file } = active
    sync()
    cmp.classList.add('busy')
    try {
      const fmt = resolveFmt(src)
      if (fmt === 'png' && !canEncode('image/png')) throw new Error('This browser cannot save PNG images.')
      const r = await compressSource(src, { fmt, quality: o.quality, maxDim: o.maxDim, bg: o.bg })
      if (token !== seq) return
      if (live) revokeURL(live.url)
      live = { blob: r.blob, url: objURL(r.blob), fmt }
      afterImg.src = live.url
      cmp.setAspect(r.w, r.h)
      const saved = Math.round((1 - r.blob.size / file.size) * 100)
      clear(tileHost, tiles([
        { label: 'Original', value: formatBytes(file.size), sub: `${src.w} x ${src.h} px` },
        { label: 'Compressed', value: formatBytes(r.blob.size), sub: `${r.w} x ${r.h} px · ${FORMATS[fmt].label}`, hot: saved > 0 },
        { label: saved >= 0 ? 'You save' : 'Larger by', value: `${Math.abs(saved)}%`, sub: formatBytes(Math.abs(file.size - r.blob.size)), good: saved > 0, bad: saved < 0 },
      ]))
      clear(note1, saved <= 0 ? h('div', { class: 'ie-hint' }, icon('info'), h('span', 'This file is already well compressed. Lower the quality, pick WebP, or reduce the longest side to save more.')) : null)
    } catch (e) {
      if (token === seq) { console.error(e); clear(tileHost, h('div', { class: 'ie-note' }, errorMessage(e))) }
    } finally {
      if (token === seq) cmp.classList.remove('busy')
    }
  }
  const refreshSoon = debounce(refresh, 160)

  async function select(file) {
    if (!file) { active = null; work.hidden = true; return }
    try {
      const src = await readSource(file)
      if (active?.url) revokeURL(active.url)
      active = { file, src, url: await displayURL(src) }
      beforeImg.src = active.url
      work.hidden = false
      cmp.setAspect(src.w, src.h)
      cmp.setPos(50)
      refresh()
    } catch (e) { toast(errorMessage(e), 'error') }
  }

  const slot = batchSlot({
    onChange: (fs) => { goBtn.querySelector('span').textContent = fs.length > 1 ? `Compress ${fs.length} images` : 'Compress image'; if (!fs.length) select(null) },
    onSelect: (f) => select(f),
  })
  const prog = progress()
  const res = results({ zipName: 'compressed-images.zip', noun: 'image' })
  const goBtn = button('Compress image', { icon: 'minimize-2', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return
    await runBatch(files, async (file) => {
      const src = await readSource(file)
      const fmt = resolveFmt(src)
      const r = await compressSource(src, { fmt, quality: o.quality, maxDim: o.maxDim, bg: o.bg })
      const keepOriginal = fmt === sameFormat(src.type, src.name) && r.blob.size >= file.size && r.w === src.w && !/hei[cf]|svg|gif|bmp/.test(src.type)
      if (keepOriginal) return { name: file.name, blob: file, w: src.w, h: src.h, inSize: file.size, note: 'already optimized, kept as is' }
      return { name: outName(file.name, 'compressed', fmt), blob: r.blob, w: r.w, h: r.h, inSize: file.size, original: file }
    }, { out: res, prog, signal, label: 'Compressing' })
  }, { label: 'Compressing', progress: prog }))

  const dl = button('Download this one', { icon: 'download', variant: 'secondary', block: true, onClick: () => { if (live) download(live.blob, outName(active.file.name, 'compressed', live.fmt)) } })
  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Quality', 'sliders-horizontal', q, qHint),
    section('Format', 'file-type', formatChips, bg),
    section('Size limit', 'maximize', dims, note('Optional. Scales big photos down before compressing, which saves the most.')),
    h('div', { class: 'ie-foot' }, goBtn, dl, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin live' }, cmp, tileHost, note1), side)
  root.append(shell(slot.el, work, res.el))
  sync()
  return () => { if (live) revokeURL(live.url) }
}
