// PDF to Word. Text is regrouped into lines, paragraphs, headings (from font size and weight), lists and tables, then written with the
// docx library. Pictures are cropped from the page. Scanned pages can be read with OCR. Everything runs in the browser.
import { h, button, busy, progress, alert, segmented, toggle, field, select, clear, download, formatBytes } from '../../lib/ui.js'
import { renderPage } from '../../lib/pdf.js'
import { baseName } from '../../lib/files.js'
import { analyze, pageReader, attachImages } from './_layout.js'
import { blocksToDocx } from './_docx.js'
import { recognizePage, ocrToBlocks, OCR_LANGS, terminateOcr } from './_ocr.js'
import { useStyles, flow, step, options, pdfSource, pageSelector, done, note, plural, secs, checkAbort, canvasBytes } from './_shared.js'

const FONTS = [['match', 'Match the PDF (recommended)'], ['Calibri', 'Calibri'], ['Arial', 'Arial'], ['Times New Roman', 'Times New Roman'], ['Georgia', 'Georgia'], ['Cambria', 'Cambria']]

export function mount(root, { signal }) {
  useStyles()
  const S = { layout: 'flow', headings: true, lists: true, tables: true, pictures: true, removeHeaders: true, fonts: 'match', ocr: true, lang: 'eng' }
  const fl = flow('pdf', 'docx')
  const prog = progress()
  const result = h('div', { class: 'stack' })
  const reader = pageReader(() => src.doc)
  const ocrCache = new Map(), imgDone = new WeakSet()

  const src = pdfSource({
    onLoad: () => { reader.clear(); ocrCache.clear(); pages.reset(); s2.unlock(); s3.unlock(); clear(result); fl.state('idle'); ocrNote.hidden = true },
    onClear: () => { s2.lock(); s3.lock(); clear(result) },
  })
  src.onSniff = () => {
    ocrNote.hidden = src.hasText !== false
    if (src.hasText === false) { ocrTog.input.checked = true; S.ocr = true }
  }
  const pages = pageSelector(src, { thumbs: false })
  const tog = (key, label, hint) => toggle(label, S[key], (v) => { S[key] = v })
  const layoutSeg = segmented([['flow', 'Flowing text'], ['pages', 'Keep page breaks']], S.layout, (v) => { S.layout = v }, 'Layout')
  const fontSel = select(FONTS, S.fonts, (v) => { S.fonts = v })
  const ocrTog = toggle('Read scanned pages with OCR', S.ocr, (v) => { S.ocr = v; langField.hidden = !v })
  const langSel = select(OCR_LANGS.map(([c, n]) => [c, n]), S.lang, (v) => { S.lang = v })
  const langField = field('Language of the scan', langSel, 'The language data downloads once and is then cached by your browser.')
  const ocrNote = h('div', { class: 'cv-note', hidden: true }, h('span', 'No text layer found, so this looks like a scan. OCR is turned on.'))

  const convertBtn = button('Convert to Word', { icon: 'file-text', variant: 'primary', size: 'lg' })
  convertBtn.addEventListener('click', () => busy(convertBtn, run, { label: 'Converting', errorTo: result, progress: prog }))

  async function run() {
    const list = pages.pages()
    clear(result)
    fl.state('working')
    const t0 = performance.now()
    try {
      const doc = src.doc
      const data = await reader.pages(list, { signal, onProgress: (f, t) => prog.set(f * 0.3, t) })
      const prepared = []
      let ocrPages = 0, pictureCount = 0
      for (let i = 0; i < data.length; i++) {
        checkAbort(signal)
        const pd = data[i]
        const noText = pd.items.length === 0
        let copy = { ...pd, images: [], preBlocks: undefined }
        if (noText) {
          const key = `${pd.n}:${S.lang}:${S.ocr}`
          if (!ocrCache.has(key)) {
            const dpi = 250
            prog.set(0.3 + 0.6 * (i / data.length), `${S.ocr ? 'Reading' : 'Capturing'} scanned page ${pd.n}`)
            const canvas = await renderPage(doc, pd.n, { scale: dpi / 72 })
            if (S.ocr) {
              const res = await recognizePage(canvas, { lang: S.lang, onProgress: (f, t) => prog.set(0.3 + 0.6 * ((i + f) / data.length), `${t} on page ${pd.n}`) })
              ocrCache.set(key, ocrToBlocks(res, { bodyPt: 11 }))
            } else {
              const small = document.createElement('canvas')
              const k = Math.min(1, 1600 / canvas.width)
              small.width = Math.round(canvas.width * k); small.height = Math.round(canvas.height * k)
              small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
              ocrCache.set(key, [{ type: 'image', data: await canvasBytes(small), width: pd.width - 72, height: (pd.width - 72) * (pd.height / pd.width), px: small.width, py: small.height }])
            }
            canvas.width = canvas.height = 0
          }
          copy.preBlocks = ocrCache.get(key)
          if (S.ocr) ocrPages++
        } else if (S.pictures) {
          if (!imgDone.has(pd)) { prog.set(0.3 + 0.6 * (i / data.length), `Looking for pictures on page ${pd.n}`); await attachImages(doc, pd); imgDone.add(pd) }
          copy.images = pd.images || []
          pictureCount += copy.images.length
        }
        prepared.push(copy)
      }
      prog.set(0.93, 'Building the Word file')
      const a = analyze(prepared, { headings: S.headings, lists: S.lists, tables: S.tables, boldHeadings: S.headings, removeHeaders: S.removeHeaders, joinPages: S.layout === 'flow', columns: true })
      const all = a.pages.flatMap((p) => p.blocks)
      const bf = data.flatMap((p) => p.items).find((it) => it.font === a.bodyFont)
      const blob = await blocksToDocx({ pages: a.pages, body: a.body, bodyFont: a.bodyFont, bodySerif: !!bf?.serif, sizes: a.sizes, pageBreaks: S.layout === 'pages', fonts: S.fonts, title: baseName(src.file.name) })
      const name = `${baseName(src.file.name)}.docx`
      prog.hide()
      const stats = [plural(list.length, 'page'), `${all.filter((b) => b.type === 'heading').length} headings`, `${all.filter((b) => b.type === 'table').length} tables`, formatBytes(blob.size), secs(performance.now() - t0)]
      if (pictureCount) stats.splice(3, 0, plural(pictureCount, 'picture'))
      if (ocrPages) stats.splice(1, 0, `${ocrPages} scanned ${ocrPages === 1 ? 'page' : 'pages'} read`)
      done(result, {
        flowEl: fl, title: 'Your Word document is ready',
        text: S.layout === 'flow' ? 'Paragraphs are reflowed so you can edit freely. Choose "Keep page breaks" to follow the original pages.' : 'Each original page starts on a new page.',
        stats, actions: [button('Download .docx', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, name) })],
      })
      if (all.length === 0) result.append(alert('warn', 'No text or pictures were found in the selected pages.'))
    } catch (e) { fl.state('idle'); throw e }
  }

  const s1 = step(1, 'Choose your PDF', src.el)
  const s2 = step(2, 'Pages and layout', h('div', { class: 'stack' }, pages.el, options(
    h('div', { class: 'stack tight' }, field('Layout', layoutSeg), field('Fonts', fontSel)),
    h('div', { class: 'stack tight' }, tog('headings', 'Detect headings (from font size and weight)'), tog('lists', 'Detect bullet and numbered lists'), tog('tables', 'Detect tables'), tog('pictures', 'Keep pictures')),
    h('div', { class: 'stack tight' }, tog('removeHeaders', 'Remove repeating headers, footers and page numbers'), ocrTog, ocrNote, langField))), { locked: true })
  const s3 = step(3, 'Convert', h('div', { class: 'stack' }, h('div', { class: 'row' }, convertBtn, note('Layout is rebuilt from text positions, so complex designs are simplified. Runs on your device.', 'shield-check')), prog.el, result), { locked: true })
  root.append(h('div', { class: 'cv t-ptw' }, fl, s1, s2, s3))
  return () => { terminateOcr() }
}
