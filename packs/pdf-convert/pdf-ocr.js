// OCR PDF. Scanned pages are read with Tesseract on your device. The result is a searchable PDF (the original pages are kept untouched and an
// invisible text layer is added), plain text and a Word document. A confidence view shows which words the engine was unsure about.
import { h, button, busy, progress, alert, segmented, select, toggle, field, textarea, tabs, clear, download, onCleanup, formatBytes, formatNumber, yieldToMain } from '../../lib/ui.js'
import { copyText } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { renderPage, loadPdfLib, savePdf, pageSize } from '../../lib/pdf.js'
import { toBlob } from '../../lib/image.js'
import { baseName } from '../../lib/files.js'
import { recognizePage, ocrToBlocks, OCR_LANGS, terminateOcr } from './_ocr.js'
import { blocksToDocx } from './_docx.js'
import { useStyles, flow, step, options, pdfSource, pageSelector, done, chip, note, plural, secs, checkAbort } from './_shared.js'

const CSS = `
.t-ocr .insp { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.t-ocr .pagebox { position: relative; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; background: #fff; box-shadow: var(--shadow-sm); }
.t-ocr .pagebox canvas { display: block; width: 100%; height: auto; }
.t-ocr .legend { display: flex; gap: 12px; font-size: 12px; color: var(--muted); flex-wrap: wrap; } .t-ocr .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
.t-ocr .pgs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.t-ocr .textarea { min-height: 320px; font-size: 14px; }
@media (max-width: 900px) { .t-ocr .insp { grid-template-columns: minmax(0, 1fr); } }
`
const QUALITY = [[150, 'Fast', '150 dpi'], [200, 'Balanced', '200 dpi'], [300, 'Accurate', '300 dpi']]

export function mount(root, { signal }) {
  useStyles({ id: 'ocr', css: CSS })
  const S = { lang: 'eng', lang2: '', dpi: 200, skip: true }
  const fl = flow('pdf', 'ocr')
  const prog = progress()
  const result = h('div', { class: 'stack' })
  let results = []
  const src = pdfSource({
    onLoad: () => { pages.reset(); s2.unlock(); s3.unlock(); clear(result); results = []; fl.state('idle') },
    onClear: () => { s2.lock(); s3.lock(); clear(result); results = [] },
  })
  src.onSniff = () => { if (src.hasText === true) hint.hidden = false }
  const pages = pageSelector(src)
  const langSel = select(OCR_LANGS, S.lang, (v) => { S.lang = v })
  const lang2Sel = select([['', 'None'], ...OCR_LANGS], S.lang2, (v) => { S.lang2 = v })
  const qualSeg = segmented(QUALITY.map(([v, l, d]) => [v, `${l} · ${d}`]), S.dpi, (v) => { S.dpi = +v }, 'Quality')
  const skipTog = toggle('Skip pages that already have text', S.skip, (v) => { S.skip = v })
  const hint = h('div', { class: 'cv-note', hidden: true }, h('span', 'This PDF already has a text layer. Pages with text are skipped unless you turn the option below off.'))

  const runBtn = button('Recognise text', { icon: 'scan-text', variant: 'primary', size: 'lg' })
  runBtn.addEventListener('click', () => busy(runBtn, run, { label: 'Reading pages', errorTo: result, progress: prog }))

  async function run() {
    const list = pages.pages()
    clear(result)
    fl.state('working')
    results = []
    const t0 = performance.now()
    const lang = S.lang2 && S.lang2 !== S.lang ? `${S.lang}+${S.lang2}` : S.lang
    try {
      for (let i = 0; i < list.length; i++) {
        checkAbort(signal)
        const n = list[i]
        prog.set(i / list.length, `Preparing page ${n} (${i + 1} of ${list.length})`)
        let hasText = false
        if (S.skip) {
          const tc = await (await src.doc.getPage(n)).getTextContent()
          hasText = tc.items.reduce((a, it) => a + (it.str || '').trim().length, 0) > 25
        }
        if (hasText) { results.push({ n, skipped: true, text: (await extractExisting(n)), conf: null, words: [] }); continue }
        const canvas = await renderPage(src.doc, n, { scale: S.dpi / 72 })
        const data = await recognizePage(canvas, { lang, pdf: true, onProgress: (f, t) => prog.set((i + f) / list.length, `${t} on page ${n} (${i + 1} of ${list.length})`) })
        const words = (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((p) => (p.lines || []).flatMap((l) => (l.words || []).map((w) => ({ text: w.text, conf: w.confidence, b: w.bbox })))))
        results.push({ n, text: (data.text || '').trim(), conf: data.confidence, words, pdf: data.pdf, cw: canvas.width, ch: canvas.height, blocks: ocrToBlocks(data, { bodyPt: 11 }) })
        canvas.width = canvas.height = 0
        await yieldToMain()
      }
      prog.hide()
      await finish(performance.now() - t0)
    } catch (e) { fl.state('idle'); prog.hide(); throw e }
  }
  async function extractExisting(n) {
    const tc = await (await src.doc.getPage(n)).getTextContent()
    return tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').trim()
  }

  async function buildPdf() {
    const lib = await pdfLib()
    const out = await loadPdfLib(await src.bytes(), { password: src.password })
    for (const r of results) {
      if (r.skipped || !r.pdf) continue
      const page = out.getPage(r.n - 1)
      const textDoc = await lib.PDFDocument.load(r.pdf)
      const [emb] = await out.embedPdf(textDoc)
      if (page.getRotation().angle === 0) {
        const cb = page.getCropBox()
        page.drawPage(emb, { x: cb.x, y: cb.y, width: cb.width, height: cb.height })
      } else {
        // rotated pages: rebuild the page as displayed (rendered image + text layer)
        const { width, height } = await pageSize(src.doc, r.n)
        const canvas = await renderPage(src.doc, r.n, { scale: 2 })
        const jpg = await out.embedJpg(await (await toBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer())
        const np = out.insertPage(r.n - 1, [width, height])
        np.drawImage(jpg, { x: 0, y: 0, width, height })
        np.drawPage(emb, { x: 0, y: 0, width, height })
        out.removePage(r.n)
        canvas.width = canvas.height = 0
      }
    }
    return savePdf(out)
  }

  async function finish(ms) {
    const ocred = results.filter((r) => !r.skipped)
    const name = baseName(src.file.name)
    const full = () => results.map((r) => (results.length > 1 ? `--- Page ${r.n} ---\n\n${r.text}` : r.text)).join('\n\n')
    const words = results.reduce((a, r) => a + (r.text.match(/\S+/g) || []).length, 0)
    const avg = ocred.length ? Math.round(ocred.reduce((a, r) => a + r.conf, 0) / ocred.length) : null
    if (!words) {
      fl.state('idle')
      clear(result, alert('warn', 'No text was recognised. Try the Accurate quality, check the language, or make sure the pages are upright and sharp.'))
      return
    }
    let pdfBlob = null, docxBlob = null
    const actions = [
      button('Searchable PDF', { icon: 'file-down', variant: 'primary', size: 'lg', onClick: (e) => busy(e.currentTarget, async () => { pdfBlob ||= await buildPdf(); download(pdfBlob, `${name}-searchable.pdf`) }, { label: 'Building PDF', errorTo: result }) }),
      button('Text (.txt)', { icon: 'file-text', onClick: () => download(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), `${name}.txt`) }),
      button('Word (.docx)', { icon: 'file-type', onClick: (e) => busy(e.currentTarget, async () => {
        docxBlob ||= await (async () => {
          const pgs = []
          for (const r of results) { const sz = await pageSize(src.doc, r.n); pgs.push({ width: sz.width, height: sz.height, bounds: null, blocks: r.skipped ? [{ type: 'p', runs: [{ text: r.text, fs: 11, bold: false, italic: false }], align: 'left' }] : r.blocks }) }
          return blocksToDocx({ pages: pgs, body: 11, pageBreaks: true, title: name })
        })()
        download(docxBlob, `${name}.docx`)
      }, { label: 'Building Word file', errorTo: result }) }),
      button('Copy text', { icon: 'copy', onClick: () => copyText(ta.value) }),
    ]
    const ta = textarea({ value: full(), 'aria-label': 'Recognised text' })
    // inspect tab
    const insp = h('div')
    const pickBar = h('div', { class: 'pgs' })
    let cur = ocred[0]?.n
    async function showPage(n) {
      cur = n
      const r = results.find((x) => x.n === n)
      for (const b of pickBar.children) b.setAttribute('aria-pressed', String(+b.dataset.n === n))
      const c = await renderPage(src.doc, n, { scale: 1.4 })
      const g = c.getContext('2d')
      if (r && r.words.length) {
        const k = c.width / r.cw
        for (const w of r.words) {
          const col = w.conf >= 85 ? '34,197,94' : w.conf >= 60 ? '245,158,11' : '239,68,68'
          g.fillStyle = `rgba(${col},${w.conf >= 85 ? 0.14 : 0.3})`
          g.strokeStyle = `rgba(${col},.75)`
          g.lineWidth = 1
          g.fillRect(w.b.x0 * k, w.b.y0 * k, (w.b.x1 - w.b.x0) * k, (w.b.y1 - w.b.y0) * k)
          if (w.conf < 85) g.strokeRect(w.b.x0 * k, w.b.y0 * k, (w.b.x1 - w.b.x0) * k, (w.b.y1 - w.b.y0) * k)
        }
      }
      clear(insp, h('div', { class: 'insp' }, h('div', h('div', { class: 'pagebox' }, c), h('div', { class: 'legend', style: 'margin-top:8px' }, h('span', h('i', { style: 'background:#22c55e' }), 'Confident'), h('span', h('i', { style: 'background:#f59e0b' }), 'Unsure'), h('span', h('i', { style: 'background:#ef4444' }), 'Doubtful'))),
        h('div', h('div', { class: 'cv-chips', style: 'margin-bottom:10px' }, r?.skipped ? chip('Already had text', '', 'text-cursor') : chip(`${Math.round(r?.conf ?? 0)}% confidence`, (r?.conf ?? 0) >= 85 ? 'good' : 'warn', 'gauge'), chip(`${(r?.text.match(/\S+/g) || []).length} words`, '', 'text')),
          h('pre', { class: 'code-out', style: 'max-height:420px' }, r?.text || ''))))
    }
    for (const r of results) pickBar.append(h('button', { type: 'button', class: 'cv-pill', 'data-n': r.n, 'aria-pressed': 'false', onclick: () => showPage(r.n) }, `Page ${r.n}${r.skipped ? ' (text)' : ''}`))
    const tabEl = tabs([{ id: 'text', label: 'Text', render: () => h('div', { class: 'stack' }, ta) }, { id: 'inspect', label: 'Check the result', render: () => { showPage(cur || results[0].n); return h('div', pickBar, insp) } }], 'text')
    done(result, {
      flowEl: fl, title: 'Text recognised',
      text: ocred.length ? 'The searchable PDF keeps your original pages and adds an invisible text layer.' : 'These pages already had text, so nothing needed OCR.',
      stats: [plural(results.length, 'page'), ocred.length ? `${ocred.length} read with OCR` : null, `${formatNumber(words, 0)} words`, avg != null ? `${avg}% confidence` : null, secs(ms)].filter(Boolean), actions,
    })
    result.append(tabEl)
  }

  const s1 = step(1, 'Choose your scanned PDF', src.el)
  const s2 = step(2, 'Language and pages', h('div', { class: 'stack' }, pages.el, options(field('Language', langSel, 'The language data (about 2 to 15 MB) downloads once and is cached by your browser.'), field('Second language', lang2Sel, 'Optional, for documents that mix two languages.'), field('Quality', qualSeg, 'Higher quality reads small print better but takes longer.')), hint, skipTog), { locked: true })
  const s3 = step(3, 'Recognise and download', h('div', { class: 'stack' }, h('div', { class: 'row' }, runBtn, note('Reading happens on your device with Tesseract. Nothing is uploaded.', 'shield-check')), prog.el, result), { locked: true })
  root.append(h('div', { class: 'cv t-ocr' }, fl, s1, s2, s3))
  return () => { terminateOcr() }
}
