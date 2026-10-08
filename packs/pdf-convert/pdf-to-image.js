// PDF to JPG / PNG / WebP. Pick pages, resolution (72-300 dpi), format and quality; get a masonry gallery of results,
// a ZIP of everything, or one long stitched image. Live preview shows the real encoded size before you convert.
import { h, button, busy, progress, alert, segmented, rangeField, field, toggle, split, formatBytes, formatNumber, debounce, clear, onCleanup, yieldToMain, download, icon } from '../../lib/ui.js'
import { renderPage, pageSize } from '../../lib/pdf.js'
import { toBlob, canEncode, MAX_PIXELS } from '../../lib/image.js'
import { zip, baseName } from '../../lib/files.js'
import { useStyles, flow, step, options, pdfSource, pageSelector, done, gallery, note, secs, plural, checkAbort } from './_shared.js'

const FORMATS = { jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' }, png: { mime: 'image/png', ext: 'png', label: 'PNG' }, webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' } }
const PRESETS = [[72, 'Screen'], [150, 'Standard'], [200, 'Sharp'], [300, 'Print']]

export function mount(root, { params, signal }) {
  useStyles({ id: 'pti', css: `.t-pti .cv-prev { display: flex; flex-direction: column; gap: 8px; } .t-pti .cv-prev .preview { min-height: 220px; }
    .t-pti .cv-prev img { max-height: 380px; width: auto; max-width: 100%; box-shadow: var(--shadow); } .t-pti .cv-dpi { display: flex; gap: 6px; flex-wrap: wrap; }
    .t-pti .cv-prev-meta { font-size: 12.5px; color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; font-variant-numeric: tabular-nums; }` })
  const defFmt = params.format && FORMATS[params.format] ? params.format : 'jpg'
  const S = { fmt: defFmt, dpi: 150, quality: 88, transparent: false, out: 'files' }
  const fl = flow('pdf', defFmt)
  const prog = progress()
  const result = h('div', { class: 'stack' })

  const src = pdfSource({
    onLoad: () => { pages.reset(); s2.unlock(); s3.unlock(); result.replaceChildren(); fl.state('idle'); refreshPreview() },
    onClear: () => { s2.lock(); s3.lock(); result.replaceChildren() },
  })
  const pages = pageSelector(src, { onChange: () => refreshPreview() })

  // ----- options
  const avail = Object.entries(FORMATS).filter(([, f]) => canEncode(f.mime))
  const fmtSeg = segmented(avail.map(([k, f]) => [k, f.label]), S.fmt, (v) => { S.fmt = v; fl.setTo(v); sync(); refreshPreview() }, 'Image format')
  const dpiRange = rangeField('Resolution', { min: 72, max: 300, step: 6, value: S.dpi, format: (v) => `${v} dpi`, onInput: (v) => { S.dpi = v; sync(); refreshPreview() } })
  const presets = h('div', { class: 'cv-dpi' }, PRESETS.map(([d, l]) => h('button', { type: 'button', class: 'cv-pill', onclick: () => { S.dpi = d; dpiRange.set(d); sync(); refreshPreview() } }, `${l} · ${d}`)))
  const qRange = rangeField('Quality', { min: 40, max: 100, step: 1, value: S.quality, format: (v) => `${v}%`, onInput: (v) => { S.quality = v; refreshPreview() } })
  const transp = toggle('Transparent background', false, (v) => { S.transparent = v; refreshPreview() })
  const outSeg = segmented([['files', 'Separate images'], ['long', 'One long image']], S.out, (v) => { S.out = v; sync() }, 'Output')
  const sizeNote = h('div', { class: 'cv-sub' })

  function sync() {
    const lossy = S.fmt !== 'png'
    qRange.hidden = !lossy
    transp.hidden = S.fmt === 'jpg'
    if (S.fmt === 'jpg') S.transparent = false
    sizeNote.textContent = ''
    convertBtn.querySelector('span').textContent = S.out === 'long' ? 'Create long image' : `Convert to ${FORMATS[S.fmt].label}`
  }

  // ----- live preview (real encode of the first picked page)
  const prevImg = h('img', { alt: 'Preview of the first selected page', hidden: true })
  const prevBox = h('div', { class: 'preview' }, h('div', { class: 'cv-sub' }, 'Choose a PDF to see a live preview'), prevImg)
  const prevMeta = h('div', { class: 'cv-prev-meta' })
  let prevUrl = null, prevToken = 0
  onCleanup(() => prevUrl && URL.revokeObjectURL(prevUrl))
  const refreshPreview = debounce(async () => {
    if (!src.doc || !pages.count) return
    const token = ++prevToken
    const p = pages.pages()[0]
    try {
      prevMeta.textContent = 'Rendering...'
      const t0 = performance.now()
      const c = await renderPage(src.doc, p, { scale: S.dpi / 72, background: S.transparent && S.fmt !== 'jpg' ? null : '#ffffff' })
      const blob = await toBlob(c, FORMATS[S.fmt].mime, S.quality / 100)
      if (token !== prevToken) return
      if (prevUrl) URL.revokeObjectURL(prevUrl)
      prevUrl = URL.createObjectURL(blob)
      prevImg.src = prevUrl
      prevImg.hidden = false
      prevBox.firstChild.hidden = true
      const { width, height } = await pageSize(src.doc, p)
      const reduced = c.width < Math.floor(width * S.dpi / 72) - 2
      const total = blob.size * pages.count
      clear(prevMeta, h('span', `${c.width} x ${c.height} px`), h('span', `${formatBytes(blob.size)} per page`),
        pages.count > 1 && h('span', `about ${formatBytes(total)} for ${pages.count} pages`), reduced && h('span', { style: 'color:var(--warning)' }, `Capped at ${formatNumber(MAX_PIXELS / 1e6, 0)} megapixels on this device`),
        h('span', `${secs(performance.now() - t0)}`))
      c.width = c.height = 0
    } catch (e) {
      if (token === prevToken) prevMeta.textContent = e.message
    }
  }, 280)

  const convertBtn = button('Convert', { icon: 'images', variant: 'primary', size: 'lg' })
  convertBtn.addEventListener('click', () => busy(convertBtn, run, { label: 'Converting', errorTo: result, progress: prog }))

  async function run() {
    const doc = src.doc
    const list = pages.pages()
    const fm = FORMATS[S.fmt]
    const bg = S.transparent && S.fmt !== 'jpg' ? null : '#ffffff'
    const t0 = performance.now()
    fl.state('working')
    clear(result)
    try {
      if (S.out === 'long') {
        const sizes = []
        for (const p of list) sizes.push(await pageSize(doc, p))
        const k = S.dpi / 72
        const w = Math.max(...sizes.map((s) => s.width))
        let total = sizes.reduce((a, s) => a + s.height, 0)
        let scale = k
        const area = w * k * total * k
        let capped = false
        if (area > MAX_PIXELS || total * k > 30000) { scale = Math.min(Math.sqrt(MAX_PIXELS / (w * total)) * 0.97, 30000 / total); capped = scale < k }
        const out = document.createElement('canvas')
        out.width = Math.ceil(w * scale); out.height = Math.ceil(total * scale)
        const ctx = out.getContext('2d')
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, out.width, out.height) }
        let y = 0
        for (let i = 0; i < list.length; i++) {
          checkAbort(signal)
          prog.set(i / list.length, `Page ${i + 1} of ${list.length}`)
          const c = await renderPage(doc, list[i], { scale, background: bg })
          ctx.drawImage(c, Math.round((out.width - c.width) / 2), y)
          y += c.height
          c.width = c.height = 0
          await yieldToMain()
        }
        prog.set(1, 'Saving')
        const blob = await toBlob(out, fm.mime, S.quality / 100)
        const name = `${baseName(src.file.name)}-long.${fm.ext}`
        done(result, {
          flowEl: fl, title: 'Long image ready', text: capped ? `Scaled to ${Math.round(scale * 72)} dpi so it fits on this device.` : undefined,
          stats: [`${out.width} x ${out.height} px`, formatBytes(blob.size), plural(list.length, 'page'), secs(performance.now() - t0)],
          actions: [button(`Download ${fm.label}`, { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, name) })],
        })
        result.append(gallery([{ blob, name, label: name }]))
        return
      }
      const pad = String(src.numPages).length
      const files = []
      for (let i = 0; i < list.length; i++) {
        checkAbort(signal)
        prog.set(i / list.length, `Page ${i + 1} of ${list.length}`)
        const c = await renderPage(doc, list[i], { scale: S.dpi / 72, background: bg })
        const blob = await toBlob(c, fm.mime, S.quality / 100)
        files.push({ blob, name: `${baseName(src.file.name)}-page-${String(list[i]).padStart(pad, '0')}.${fm.ext}`, label: `Page ${list[i]} · ${c.width}x${c.height} · ${formatBytes(blob.size)}` })
        c.width = c.height = 0
        await yieldToMain()
      }
      const bytes = files.reduce((a, f) => a + f.blob.size, 0)
      let zipBlob = null
      const zipName = `${baseName(src.file.name)}-${fm.ext}.zip`
      const actions = files.length === 1
        ? [button(`Download ${fm.label}`, { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(files[0].blob, files[0].name) })]
        : [button(`Download all (${files.length}) as ZIP`, { icon: 'folder-down', variant: 'primary', size: 'lg', onClick: (e) => busy(e.currentTarget, async () => { zipBlob ||= await zip(files.map((f) => ({ name: f.name, data: f.blob }))); download(zipBlob, zipName) }, { label: 'Zipping' }) })]
      done(result, {
        flowEl: fl, title: files.length === 1 ? 'Your image is ready' : `${files.length} images ready`,
        stats: [plural(files.length, 'image'), formatBytes(bytes), `${S.dpi} dpi`, secs(performance.now() - t0)], actions,
      })
      result.append(gallery(files))
    } catch (e) {
      fl.state('idle')
      throw e
    }
  }

  const s1 = step(1, 'Choose your PDF', src.el)
  const optPanel = h('div', { class: 'stack' },
    options(field('Format', fmtSeg), field('Output', outSeg)),
    options(h('div', { class: 'stack tight' }, dpiRange, presets), h('div', { class: 'stack tight' }, qRange, transp, sizeNote)))
  const s2 = step(2, 'Pages and quality', split(h('div', { class: 'stack' }, pages.el, optPanel), h('div', { class: 'cv-prev' }, prevBox, prevMeta), 'wide-left'), { locked: true })
  const s3 = step(3, 'Convert', h('div', { class: 'stack' }, h('div', { class: 'row' }, convertBtn, note('Everything happens on your device. Nothing is uploaded.', 'shield-check')), prog.el, result), { locked: true })
  sync()
  root.append(h('div', { class: 'cv t-pti' }, fl, s1, s2, s3))
  signal?.addEventListener('abort', () => prog.hide())
}
