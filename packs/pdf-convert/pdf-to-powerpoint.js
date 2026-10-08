// PDF to PowerPoint. Every page becomes a slide: a sharp page image on a slide that matches the page (or 16:9 / 4:3), with optional
// hidden searchable text and the page text in the speaker notes. Built with pptxgenjs in the browser.
import { h, button, busy, progress, alert, segmented, rangeField, toggle, field, split, clear, download, debounce, onCleanup, formatBytes, yieldToMain, formatNumber } from '../../lib/ui.js'
import { pptxgen } from '../../lib/libs.js'
import { renderPage } from '../../lib/pdf.js'
import { toBlob } from '../../lib/image.js'
import { baseName, blobToBase64 } from '../../lib/files.js'
import { buildLines, pageReader, analyze, blocksToText } from './_layout.js'
import { useStyles, flow, step, options, pdfSource, pageSelector, done, note, plural, secs, checkAbort } from './_shared.js'

const CSS = `
.t-ptp .frame { position: relative; margin: 0 auto; max-width: 100%; border-radius: 10px; background: #fff; box-shadow: var(--shadow); overflow: hidden; border: 1px solid var(--border); }
.t-ptp .frame canvas { position: absolute; inset: 0; margin: auto; max-width: 100%; max-height: 100%; width: auto; height: auto; }
.t-ptp .stage { background: linear-gradient(145deg, var(--surface-2), var(--surface-3)); border-radius: var(--radius-lg); padding: 22px; display: grid; place-items: center; min-height: 260px; border: 1px solid var(--border); }
.t-ptp .cap { text-align: center; margin-top: 8px; }
`
const SIZES = { page: 'Match the PDF page', '16:9': 'Widescreen 16:9', '4:3': 'Standard 4:3' }

export function mount(root, { signal }) {
  useStyles({ id: 'ptp', css: CSS })
  const S = { size: 'page', dpi: 144, format: 'jpg', notes: false, text: true }
  const fl = flow('pdf', 'pptx')
  const prog = progress()
  const result = h('div', { class: 'stack' })
  const reader = pageReader(() => src.doc)
  let first = null

  const src = pdfSource({
    onLoad: async () => { reader.clear(); pages.reset(); s2.unlock(); s3.unlock(); clear(result); fl.state('idle'); const p = await src.doc.getPage(1); const vp = p.getViewport({ scale: 1 }); first = { w: vp.width, h: vp.height }; drawPreview() },
    onClear: () => { s2.lock(); s3.lock(); clear(result); first = null },
  })
  const pages = pageSelector(src, { onChange: () => drawPreview() })
  const sizeSeg = segmented(Object.entries(SIZES), S.size, (v) => { S.size = v; drawPreview() }, 'Slide size')
  const dpiR = rangeField('Image sharpness', { min: 72, max: 220, step: 4, value: S.dpi, format: (v) => `${v} dpi`, onInput: (v) => { S.dpi = v }, hint: 'Higher is sharper but makes a bigger file. 144 suits screens.' })
  const fmtSeg = segmented([['jpg', 'JPG (smaller)'], ['png', 'PNG (sharpest)']], S.format, (v) => { S.format = v }, 'Image format')
  const textTog = toggle('Hidden searchable text on every slide', S.text, (v) => { S.text = v })
  const notesTog = toggle('Add the page text to the speaker notes', S.notes, (v) => { S.notes = v })

  // ----- live slide preview
  const frame = h('div', { class: 'frame' })
  const stage = h('div', { class: 'stage' }, frame)
  const cap = h('div', { class: 'cv-sub cap' })
  let pvToken = 0
  const slideDims = () => {
    if (S.size === '16:9') return { w: 13.333, h: 7.5 }
    if (S.size === '4:3') return { w: 10, h: 7.5 }
    return { w: first.w / 72, h: first.h / 72 }
  }
  const drawPreview = debounce(async () => {
    if (!first || !src.doc || !pages.count) return
    const token = ++pvToken
    const d = slideDims()
    frame.style.aspectRatio = `${d.w} / ${d.h}`
    frame.style.width = `${Math.min(520, Math.round(300 * (d.w / d.h)))}px`
    cap.textContent = `${d.w.toFixed(2)} x ${d.h.toFixed(2)} in · page ${pages.pages()[0]} of ${src.numPages}`
    const c = await renderPage(src.doc, pages.pages()[0], { scale: 1.2 })
    if (token !== pvToken) return
    clear(frame, c)
  }, 200)

  const convertBtn = button('Create PowerPoint', { icon: 'presentation', variant: 'primary', size: 'lg' })
  convertBtn.addEventListener('click', () => busy(convertBtn, run, { label: 'Building slides', errorTo: result, progress: prog }))

  async function run() {
    const list = pages.pages()
    clear(result)
    fl.state('working')
    const t0 = performance.now()
    try {
      const Pptx = await pptxgen()
      const pres = new Pptx()
      const d = slideDims()
      pres.defineLayout({ name: 'FROM_PDF', width: d.w, height: d.h })
      pres.layout = 'FROM_PDF'
      pres.title = baseName(src.file.name)
      pres.author = 'Tools'
      const mime = S.format === 'png' ? 'image/png' : 'image/jpeg'
      const data = S.text || S.notes ? await reader.pages(list, { signal, onProgress: (f, t) => prog.set(f * 0.25, t) }) : []
      const notesByPage = S.notes ? analyze(data, { removeHeaders: false, joinPages: false }).pages.map((p) => blocksToText([p])) : []
      for (let i = 0; i < list.length; i++) {
        checkAbort(signal)
        prog.set(0.25 + 0.7 * (i / list.length), `Slide ${i + 1} of ${list.length}`)
        const c = await renderPage(src.doc, list[i], { scale: S.dpi / 72 })
        const blob = await toBlob(c, mime, 0.9)
        const b64 = await blobToBase64(blob)
        // fit the page inside the slide, centred
        const pw = c.width, ph = c.height
        const k = Math.min(d.w / pw, d.h / ph)
        const w = pw * k, hh = ph * k, x = (d.w - w) / 2, y = (d.h - hh) / 2
        const slide = pres.addSlide()
        slide.background = { color: 'FFFFFF' }
        slide.addImage({ data: `${mime};base64,${b64}`, x, y, w, h: hh })
        if (S.text && data[i]) {
          const pdata = data[i]
          const sc = w / pdata.width
          for (const l of buildLines(pdata.items)) {
            if (!l.text.trim()) continue
            slide.addText(l.text, { x: x + l.x0 * sc, y: y + l.top * sc, w: Math.max(0.1, (l.x1 - l.x0) * sc), h: Math.max(0.1, (l.bottom - l.top) * sc), fontSize: Math.max(4, Math.min(72, l.fs * sc * 0.9)), color: 'FFFFFF', transparency: 100, margin: 0, valign: 'top', wrap: false, fit: 'none' })
          }
        }
        if (S.notes && notesByPage[i]) slide.addNotes(notesByPage[i])
        c.width = c.height = 0
        await yieldToMain()
      }
      prog.set(0.97, 'Saving')
      const out = await pres.write({ outputType: 'blob' })
      const blob = out instanceof Blob ? out : new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
      prog.hide()
      const name = `${baseName(src.file.name)}.pptx`
      done(result, {
        flowEl: fl, title: 'Your presentation is ready', text: S.text ? 'The slides are page images. Searching in PowerPoint also finds the hidden text.' : 'The slides are page images, so the text is not editable.',
        stats: [plural(list.length, 'slide'), `${d.w.toFixed(1)} x ${d.h.toFixed(1)} in`, formatBytes(blob.size), secs(performance.now() - t0)],
        actions: [button('Download .pptx', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, name) })],
      })
    } catch (e) { fl.state('idle'); prog.hide(); throw e }
  }

  const s1 = step(1, 'Choose your PDF', src.el)
  const s2 = step(2, 'Pages and slide style', split(h('div', { class: 'stack' }, pages.el, options(field('Slide size', sizeSeg), field('Image format', fmtSeg), dpiR, h('div', { class: 'stack tight' }, textTog, notesTog))), h('div', stage, cap)), { locked: true })
  const s3 = step(3, 'Create the presentation', h('div', { class: 'stack' }, h('div', { class: 'row' }, convertBtn, note('Pages become images, so layout is exact. Use PDF to Word if you need editable text. Runs on your device.', 'shield-check')), prog.el, result), { locked: true })
  root.append(h('div', { class: 'cv t-ptp' }, fl, s1, s2, s3))
}
