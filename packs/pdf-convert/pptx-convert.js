// PowerPoint to PDF and PowerPoint to images (params.mode: 'pdf' | 'images'). The .pptx is drawn slide by slide on a canvas by a small renderer
// (shapes, text, tables, pictures, charts) and saved as a PDF with a searchable text layer, or as PNG / JPG / WebP images. Layout is approximated.
import { h, button, busy, progress, alert, segmented, rangeField, toggle, field, split, clear, download, debounce, onCleanup, formatBytes, formatNumber, yieldToMain, icon } from '../../lib/ui.js'
import { toBlob, canEncode } from '../../lib/image.js'
import { zip, baseName } from '../../lib/files.js'
import { openPptx } from './_pptx.js'
import { createPdfBuilder, canvasSlice } from './_paginate.js'
import { useStyles, flow, step, options, pageSelector, done, chip, note, plural, secs, checkAbort, gallery } from './_shared.js'
import { dropzone as dz } from '../../lib/ui.js'

const CSS = `
.t-pxc .stage { background: linear-gradient(145deg, var(--surface-2), var(--surface-3)); border-radius: var(--radius-lg); padding: 16px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; align-items: center; }
.t-pxc .stage canvas { display: block; width: 100%; height: auto; border-radius: 6px; box-shadow: var(--shadow); background: #fff; }
.t-pxc .nav { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.t-pxc .fcard { display: flex; align-items: center; gap: 14px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: linear-gradient(150deg, color-mix(in srgb, #e8710a 9%, var(--surface)), var(--surface)); animation: rise .45s var(--ease) both; flex-wrap: wrap; }
.t-pxc .fcard .doc { width: 56px; height: 42px; flex: none; border-radius: 8px; background: #e8710a; color: #fff; display: grid; place-items: end start; padding: 6px 7px; font: 700 10px var(--mono); box-shadow: 0 10px 18px -10px #e8710a; }
.t-pxc .fcard .grow { flex: 1; min-width: 160px; } .t-pxc .fcard .name { font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

const DPIS = [[96, 'Draft'], [150, 'Standard'], [220, 'Sharp']]
const WIDTHS = [[1280, '1280 px'], [1920, 'Full HD 1920'], [2560, '2560 px'], [3840, '4K 3840']]

export function mount(root, { params, signal }) {
  const imagesMode = params.mode === 'images'
  useStyles({ id: 'pxc', css: CSS })
  const S = { dpi: 150, width: 1920, format: 'png', quality: 90, hidden: false }
  const fl = flow('pptx', imagesMode ? 'png' : 'pdf')
  const prog = progress()
  const result = h('div', { class: 'stack' })
  let pp = null, file = null, infos = [], warnings = new Set(), cur = 0, pvToken = 0

  // the page selector expects a "source": slides stand in for pages
  const src = { numPages: 0, thumb: null, aspect: 16 / 9, unit: 'Slide', doc: null }
  const slides = pageSelector(src, { onChange: () => preview() })
  const holder = h('div', { class: 'stack' })
  const zone = dz({ accept: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'Drop a PowerPoint file here or click to choose', hint: '.pptx files (save older .ppt files as .pptx first)', onFiles: ([f]) => loadFile(f) })
  clear(holder, zone)

  const dpiSeg = segmented(DPIS.map(([v, l]) => [v, `${l} ${v} dpi`]), S.dpi, (v) => { S.dpi = +v }, 'Resolution')
  const widthSeg = segmented(WIDTHS, S.width, (v) => { S.width = +v }, 'Image width')
  const fmts = [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']].filter(([k]) => canEncode(k === 'jpg' ? 'image/jpeg' : `image/${k}`))
  const fmtSeg = segmented(fmts, S.format, (v) => { S.format = v; qual.hidden = v === 'png' }, 'Format')
  const qual = rangeField('Quality', { min: 50, max: 100, value: S.quality, format: (v) => `${v}%`, onInput: (v) => { S.quality = v } })
  qual.hidden = true
  const hiddenTog = toggle('Include hidden slides', S.hidden, (v) => { S.hidden = v })

  // ----- preview
  const stageCanvas = h('div', { style: 'width:100%' })
  const caption = h('div', { class: 'nav' })
  const warnBox = h('div')
  const stage = h('div', { class: 'stage' }, stageCanvas, caption)
  async function preview(step2) {
    if (!pp || !slides.count) return
    const list = slides.pages()
    if (step2 != null) cur = Math.max(0, Math.min(list.length - 1, cur + step2))
    else cur = 0
    const idx = list[cur] - 1
    const t = ++pvToken
    const r = await pp.render(idx, { widthPx: 960 })
    if (t !== pvToken) return
    clear(stageCanvas, r.canvas)
    for (const w of r.warnings) warnings.add(w)
    clear(caption, button('', { icon: 'chevron-left', variant: 'ghost', size: 'sm', ariaLabel: 'Previous slide', disabled: cur <= 0, onClick: () => preview(-1) }), `Slide ${list[cur]} of ${pp.count}${infos[idx]?.hidden ? ' (hidden)' : ''}`,
      button('', { icon: 'chevron-right', variant: 'ghost', size: 'sm', ariaLabel: 'Next slide', disabled: cur >= list.length - 1, onClick: () => preview(1) }))
    clear(warnBox, r.warnings.length ? alert('warn', r.warnings.join('. ') + '.') : null)
  }

  async function loadFile(f) {
    clear(result); fl.state('idle')
    clear(holder, h('div', { class: 'fcard' }, h('div', { class: 'doc' }, 'PPTX'), h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name), h('div', { class: 'cv-sub' }, 'Reading the presentation...'))))
    try {
      pp?.close()
      const buf = await f.arrayBuffer()
      if (!(new Uint8Array(buf.slice(0, 2))[0] === 0x50)) throw new Error(/\.ppt$/i.test(f.name) ? 'This is an old .ppt file. Open it in PowerPoint, choose Save As, pick .pptx, and use that file here.' : 'This does not look like a .pptx file.')
      pp = await openPptx(buf)
      if (!pp.count) throw new Error('This presentation has no slides.')
      file = f
      infos = await Promise.all(Array.from({ length: pp.count }, (_, i) => pp.info(i).catch(() => ({ hidden: false, title: '' }))))
      src.numPages = pp.count
      src.aspect = pp.width / pp.height
      src.thumb = async (n) => (await pp.render(n - 1, { widthPx: 260 })).canvas
      slides.reset()
      const nHidden = infos.filter((x) => x.hidden).length
      zone.hidden = true
      clear(holder, h('div', { class: 'fcard' }, h('div', { class: 'doc' }, 'PPTX'), h('div', { class: 'grow' }, h('div', { class: 'name', title: f.name }, f.name),
        h('div', { class: 'cv-chips', style: 'margin-top:6px' }, chip(plural(pp.count, 'slide'), 'good', 'layers'), chip(formatBytes(f.size), '', 'hard-drive'), chip(`${(pp.width / 914400).toFixed(1)} x ${(pp.height / 914400).toFixed(1)} in`, '', 'ruler'), nHidden ? chip(`${nHidden} hidden`, 'warn', 'eye-off') : null)),
      button('Change', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', onClick: () => zone.open() })), zone)
      s2.unlock(); s3.unlock()
      cur = 0
      warnings = new Set()
      await preview()
    } catch (e) {
      zone.hidden = false
      clear(holder, alert('error', e.message), zone)
      s2.lock(); s3.lock()
    }
  }

  const runBtn = button(imagesMode ? 'Export images' : 'Create PDF', { icon: imagesMode ? 'images' : 'file-down', variant: 'primary', size: 'lg' })
  runBtn.addEventListener('click', () => busy(runBtn, run, { label: 'Converting', errorTo: result, progress: prog }))

  async function run() {
    let list = slides.pages()
    if (!S.hidden) list = list.filter((n) => !infos[n - 1]?.hidden)
    if (!list.length) throw new Error('All of the chosen slides are hidden. Turn on "Include hidden slides" or pick other slides.')
    clear(result)
    fl.state('working')
    const t0 = performance.now()
    const allWarn = new Set()
    try {
      if (imagesMode) {
        const mime = S.format === 'jpg' ? 'image/jpeg' : `image/${S.format}`
        const files = []
        const pad = String(pp.count).length
        for (let i = 0; i < list.length; i++) {
          checkAbort(signal)
          prog.set(i / list.length, `Slide ${i + 1} of ${list.length}`)
          const r = await pp.render(list[i] - 1, { widthPx: S.width })
          r.warnings.forEach((w) => allWarn.add(w))
          const blob = await toBlob(r.canvas, mime, S.quality / 100)
          const ext = S.format
          files.push({ blob, name: `${baseName(file.name)}-slide-${String(list[i]).padStart(pad, '0')}.${ext}`, label: `Slide ${list[i]} · ${r.canvas.width}x${r.canvas.height} · ${formatBytes(blob.size)}` })
          r.canvas.width = r.canvas.height = 0
          await yieldToMain()
        }
        let zipBlob = null
        const zname = `${baseName(file.name)}-slides.zip`
        const actions = files.length === 1 ? [button(`Download ${S.format.toUpperCase()}`, { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(files[0].blob, files[0].name) })]
          : [button(`Download all (${files.length}) as ZIP`, { icon: 'folder-down', variant: 'primary', size: 'lg', onClick: (e) => busy(e.currentTarget, async () => { zipBlob ||= await zip(files.map((f) => ({ name: f.name, data: f.blob }))); download(zipBlob, zname) }, { label: 'Zipping' }) })]
        done(result, { flowEl: fl, title: files.length === 1 ? 'Your image is ready' : `${files.length} slide images ready`, stats: [plural(files.length, 'image'), formatBytes(files.reduce((a, f) => a + f.blob.size, 0)), secs(performance.now() - t0)], actions })
        if (allWarn.size) result.append(alert('warn', [...allWarn].join('. ') + '.'))
        result.append(gallery(files))
        return
      }
      const builder = await createPdfBuilder({ title: baseName(file.name), allText: 'x', textLayer: true })
      const Wpt = pp.width / 12700, Hpt = pp.height / 12700
      const widthPx = Math.round((Wpt * S.dpi) / 72)
      let words = 0
      for (let i = 0; i < list.length; i++) {
        checkAbort(signal)
        prog.set(i / list.length, `Slide ${i + 1} of ${list.length}`)
        const r = await pp.render(list[i] - 1, { widthPx })
        r.warnings.forEach((w) => allWarn.add(w))
        const k = Wpt / r.canvas.width
        const image = await canvasSlice(r.canvas, 0, r.canvas.height, { jpeg: r.hasPictures })
        await builder.addPage({
          W: Wpt, H: Hpt, image, x: 0, y: 0, w: Wpt, h: Hpt,
          words: r.items.filter((it) => /^[\x20-\x7e -ÿ]+$/.test(it.text)).map((it) => ({ text: it.text, x: it.x * k, y: it.y * k, size: Math.max(2, it.size * k), w: it.w * k })),
        })
        r.canvas.width = r.canvas.height = 0
        await yieldToMain()
      }
      prog.set(0.97, 'Saving')
      const bytes = await builder.save()
      words = builder.stats().words
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      onCleanup(() => URL.revokeObjectURL(url))
      done(result, {
        flowEl: fl, title: 'Your PDF is ready', text: 'Each slide is one page the size of the slide, with an invisible text layer so the text can be searched.',
        stats: [plural(list.length, 'page'), `${words.toLocaleString()} words searchable`, formatBytes(blob.size), secs(performance.now() - t0)],
        actions: [button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, `${baseName(file.name)}.pdf`) }), button('Preview', { icon: 'external-link', onClick: () => window.open(url, '_blank', 'noopener') })],
      })
      if (allWarn.size) result.append(alert('warn', [...allWarn].join('. ') + '.'))
    } catch (e) { fl.state('idle'); throw e }
  }

  const s1 = step(1, 'Choose your presentation', holder)
  const s2 = step(2, imagesMode ? 'Slides and image size' : 'Slides and quality', split(h('div', { class: 'stack' }, slides.el,
    imagesMode ? options(field('Format', fmtSeg), field('Image width', widthSeg), qual, hiddenTog) : options(field('Resolution', dpiSeg, 'Higher is sharper and makes a bigger PDF.'), hiddenTog)),
  h('div', { class: 'stack' }, stage, warnBox, note('Layout is approximated: standard shapes, text, tables, pictures and charts are drawn, while animations, video and some effects are not.', 'info')), 'wide-left'), { locked: true })
  const s3 = step(3, imagesMode ? 'Export' : 'Create the PDF', h('div', { class: 'stack' }, h('div', { class: 'row' }, runBtn, note('Runs on your device. The file is never uploaded.', 'shield-check')), prog.el, result), { locked: true })
  root.append(h('div', { class: 'cv t-pxc' }, fl, s1, s2, s3))
  onCleanup(() => pp?.close())
}
