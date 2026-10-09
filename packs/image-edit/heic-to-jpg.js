// HEIC to JPG: convert iPhone HEIC/HEIF photos to JPG or PNG in the browser (heic-to, decoded locally), batch with ZIP.
import { progress } from '../../lib/ui.js'
import { heicToBlob, loadImage } from '../../lib/image.js'
import {
  shell, h, icon, button, busy, chips, section, note, slider, batchSlot, results, runBatch, resample, encode, outName,
} from './_kit.js'

const SIZES = [[0, 'Original size'], [4032, '4032'], [2048, '2048'], [1600, '1600'], [1080, '1080']]

export function mount(root, { signal }) {
  const o = { fmt: 'jpg', quality: 92, maxSide: 0 }
  const fmt = chips([['jpg', 'JPG'], ['png', 'PNG']], 'jpg', (v) => { o.fmt = v; q.hidden = v !== 'jpg' }, { label: 'Convert to' })
  const q = slider('JPG quality', { min: 50, max: 100, value: 92, format: (v) => `${v}%`, onInput: (v) => { o.quality = v } })
  const size = chips(SIZES, 0, (v) => { o.maxSide = v }, { label: 'Longest side' })
  const prog = progress()
  const res = results({ zipName: 'heic-converted.zip', compare: false, noun: 'photo' })
  const goBtn = button('Convert to JPG', { icon: 'smartphone', variant: 'primary', size: 'lg', block: true })
  const retitle = () => { const n = slot.files.length; goBtn.querySelector('span').textContent = `Convert ${n > 1 ? `${n} photos` : 'photo'} to ${o.fmt.toUpperCase()}` }
  fmt.addEventListener('click', retitle)
  const slot = batchSlot({
    accept: '.heic,.heif,image/heic,image/heif', ic: 'smartphone', label: 'Drop iPhone photos here or click to choose', formats: ['HEIC', 'HEIF'],
    onChange: (fs) => { retitle(); work.hidden = !fs.length },
  })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return
    await runBatch(files, async (file) => {
      const type = o.fmt === 'png' ? 'image/png' : 'image/jpeg'
      let blob = await heicToBlob(file, type, o.quality / 100)
      let dims = null
      if (o.maxSide) {
        const img = await loadImage(blob)
        const w = img.naturalWidth, hh = img.naturalHeight
        if (Math.max(w, hh) > o.maxSide) {
          const k = o.maxSide / Math.max(w, hh)
          const c = resample(img, Math.round(w * k), Math.round(hh * k))
          blob = await encode(c, o.fmt, { quality: o.quality / 100 })
          dims = [c.width, c.height]
        }
      }
      if (!dims) { const bmp = await createImageBitmap(blob); dims = [bmp.width, bmp.height]; bmp.close() }
      return { name: outName(file.name, '', o.fmt), blob, w: dims[0], h: dims[1], inSize: file.size, badge: o.fmt.toUpperCase() }
    }, { out: res, prog, signal, label: 'Converting' })
  }, { label: 'Converting', progress: prog }))

  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Format', 'file-type', fmt, q),
    section('Size', 'maximize', size, note('Phone photos are big. Shrinking the longest side makes files much smaller.')),
    h('div', { class: 'ie-foot' }, goBtn, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main' },
    h('div', { class: 'panel ie-glass stack' }, h('div', { class: 'ie-sec-title' }, icon('info'), h('span', 'Good to know')),
      note('HEIC is the format iPhones use. Many websites, Windows apps and printers cannot open it, so convert to JPG before sharing.'),
      note('The decoder (about 2 MB) downloads the first time you convert. Photos never leave your device.'),
      note('Live Photos and burst frames convert their main picture only.'))), side)
  root.append(shell(slot.el, work, res.el))
  retitle()
}
