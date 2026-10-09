// Text to PDF. Real vector text (selectable and searchable) with embedded Noto fonts, so Hindi, Tamil, Cyrillic, Greek and accented
// Latin all work. Font, size, spacing, page size, margins, line numbers and page numbers, with a live preview of the finished PDF.
import { h, button, busy, progress, alert, segmented, select, rangeField, toggle, field, textarea, input, dropzone, split, clear, download, debounce, onCleanup, formatBytes, formatNumber, icon, yieldToMain } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { PAGE_SIZES, openPdf, renderPage } from '../../lib/pdf.js'
import { baseName } from '../../lib/files.js'
import { load, save } from '../../lib/store.js'
import { createFontSet, drawRuns } from './_fonts.js'
import { useStyles, flow, step, options, done, chip, note, plural, secs, readTextFile } from './_shared.js'

const CSS = `
.t-ttp .editor { min-height: 300px; font-size: 14px; }
.t-ttp .pv { display: flex; flex-direction: column; gap: 10px; align-items: center; position: sticky; top: 76px; }
.t-ttp .sheet { position: relative; width: 100%; max-width: 420px; border-radius: 6px; background: #fff; box-shadow: var(--shadow-lg); overflow: hidden; border: 1px solid var(--border); }
.t-ttp .sheet canvas { display: block; width: 100%; height: auto; }
.t-ttp .sheet .busy-veil { position: absolute; inset: 0; background: rgba(255,255,255,.6); display: grid; place-items: center; opacity: 0; pointer-events: none; transition: opacity .2s; }
.t-ttp .sheet.updating .busy-veil { opacity: 1; }
.t-ttp .pager { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.t-ttp .left { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
@media (max-width: 900px) { .t-ttp .pv { position: static; } }
`

const FONTS = [['sans', 'Sans serif (Noto Sans)'], ['serif', 'Serif (Noto Serif)'], ['mono', 'Monospace (Noto Mono)'], ['helv', 'Helvetica (built in, Latin only)'], ['times', 'Times (built in, Latin only)'], ['cour', 'Courier (built in, Latin only)']]
const MM = 72 / 25.4

/** Lay out and draw the text. Returns {pdfBytes, pages, missing, scripts}. Exported so it can be tested. */
export async function buildTextPdf(text, o) {
  const { PDFDocument, rgb, StandardFonts } = await pdfLib()
  const doc = await PDFDocument.create()
  doc.setTitle(o.title || 'Text')
  doc.setProducer('Tools (browser)')
  let [W, H] = PAGE_SIZES[o.page]
  if (o.orient === 'landscape') [W, H] = [H, W]
  const m = o.margin * MM
  const size = o.size, lead = size * o.spacing
  const std = { helv: StandardFonts.Helvetica, times: StandardFonts.TimesRoman, cour: StandardFonts.Courier }[o.font]
  let api
  if (std) {
    const f = await doc.embedFont(std)
    const set = new Set(f.getCharacterSet())
    api = {
      runs: (s) => { let out = ''; for (const ch of s) out += set.has(ch.codePointAt(0)) ? ch : '?'; return [{ text: out, font: f }] },
      width: (s, sz) => f.widthOfTextAtSize(s.replace(/[^\x20-\x7e -ÿ]/g, '?'), sz), unsupported: new Set(), scripts: new Set(['latin']), missing: new Set(),
    }
  } else api = await createFontSet(doc, { family: o.font, text: text + (o.title || '') })
  const gutter = o.lineNumbers ? api.width(String(text.split('\n').length) + '  ', size * 0.85) : 0
  const x0 = m + gutter, maxW = W - m - x0
  const top = H - m - (o.title ? size * 1.9 : 0)
  const bottom = m + (o.pageNumbers ? 18 : 0)
  const perPage = Math.max(1, Math.floor((top - bottom) / lead))

  const tab = ' '.repeat(o.tab)
  const sp = api.width(' ', size)
  const rows = [] // {text, n}
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li].replace(/\t/g, tab)
    const lead = raw.match(/^ */)[0].length
    if (!raw.trim()) { rows.push({ text: '', n: li + 1 }); continue }
    if (!o.wrap) { rows.push({ text: raw, n: li + 1, lead }); continue }
    // greedy word wrap, keeping the indentation of the line on wrapped rows
    const words = raw.slice(lead).split(/( +)/)
    let cur = ' '.repeat(lead), curW = lead * sp, first = true
    const flush = () => { rows.push({ text: cur.replace(/ +$/, ''), n: first ? li + 1 : null }); first = false; cur = ' '.repeat(lead); curW = lead * sp }
    for (const w of words) {
      if (!w) continue
      const ww = api.width(w, size)
      if (curW + ww > maxW && cur.trim()) { if (/^ +$/.test(w)) continue; flush() }
      if (ww > maxW) {
        // a single word wider than the line: break by characters
        for (const ch of w) { const cw = api.width(ch, size); if (curW + cw > maxW && cur.trim()) flush(); cur += ch; curW += cw }
        continue
      }
      cur += w; curW += ww
    }
    if (cur.trim() || first) flush()
  }
  const pages = []
  for (let i = 0; i < rows.length; i += perPage) pages.push(rows.slice(i, i + perPage))
  if (!pages.length) pages.push([])
  const ink = rgb(0.07, 0.07, 0.1), grey = rgb(0.55, 0.55, 0.6)
  for (let p = 0; p < pages.length; p++) {
    const page = doc.addPage([W, H])
    if (o.title && p === 0) await drawRuns(doc, page, api.runs(o.title, { bold: true }), { x: m, y: H - m - size * 1.2, size: size * 1.5, color: ink, bold: true })
    let y = top - size * 0.95
    for (const row of pages[p]) {
      if (row.n && o.lineNumbers) {
        const label = String(row.n)
        await drawRuns(doc, page, api.runs(label), { x: x0 - 6 - api.width(label, size * 0.85), y: y + size * 0.05, size: size * 0.85, color: grey, rgbCss: '#8c8c99' })
      }
      if (row.text) await drawRuns(doc, page, api.runs(row.text), { x: x0, y, size, color: ink })
      y -= lead
    }
    if (o.pageNumbers) {
      const label = `${p + 1} / ${pages.length}`
      const wl = api.width(label, 9)
      await drawRuns(doc, page, api.runs(label), { x: o.numAlign === 'center' ? (W - wl) / 2 : W - m - wl, y: m * 0.55, size: 9, color: grey, rgbCss: '#8c8c99' })
    }
    if (p % 5 === 4) await yieldToMain()
  }
  const pdfBytes = await doc.save({ useObjectStreams: true })
  return { pdfBytes, pages: pages.length, missing: api.missing || new Set(), unsupported: api.unsupported || new Set(), scripts: api.scripts }
}

export function mount(root, { signal }) {
  useStyles({ id: 'ttp', css: CSS })
  const S = { font: 'sans', size: 11, spacing: 1.45, page: 'A4', orient: 'portrait', margin: 20, tab: 4, wrap: true, lineNumbers: false, pageNumbers: true, numAlign: 'center', title: '' }
  const fl = flow('txt', 'pdf')
  const result = h('div', { class: 'stack' })
  let fileName = 'text'
  let lastPdf = null, pdfDoc = null, pageNo = 1, token = 0

  const ta = textarea({ class: 'editor', rows: 14, placeholder: 'Type or paste your text here. Hindi, Tamil, Cyrillic, Greek and accented letters work too.', value: load('text-to-pdf:text', ''), 'aria-label': 'Text to convert' })
  const zone = dropzone({ accept: '.txt,.text,.md,.log,.csv,.json,.xml,.yml,.yaml,.ini,.srt,.vtt,text/*', compact: true, label: 'Or drop a text file here', hint: 'TXT, MD, LOG, CSV, JSON and other plain text', onFiles: async ([f]) => { ta.value = await readTextFile(f); fileName = baseName(f.name); onChange() } })
  const count = h('span', { class: 'cv-sub' })
  const clearBtn = button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { ta.value = ''; onChange(); ta.focus() } })

  const fontSel = select(FONTS, S.font, (v) => { S.font = v; onChange() })
  const sizeR = rangeField('Font size', { min: 7, max: 28, step: 0.5, value: S.size, format: (v) => `${v} pt`, onInput: (v) => { S.size = v; onChange() } })
  const spaceR = rangeField('Line spacing', { min: 1, max: 2.2, step: 0.05, value: S.spacing, format: (v) => `${v.toFixed(2)}x`, onInput: (v) => { S.spacing = v; onChange() } })
  const pageSel = select([['A4', 'A4'], ['Letter', 'US Letter'], ['Legal', 'US Legal'], ['A5', 'A5'], ['A3', 'A3']], S.page, (v) => { S.page = v; onChange() })
  const orientSeg = segmented([['portrait', 'Portrait'], ['landscape', 'Landscape']], S.orient, (v) => { S.orient = v; onChange() }, 'Orientation')
  const marginR = rangeField('Margins', { min: 8, max: 40, step: 1, value: S.margin, format: (v) => `${v} mm`, onInput: (v) => { S.margin = v; onChange() } })
  const tabSeg = segmented([[2, '2'], [4, '4'], [8, '8']], S.tab, (v) => { S.tab = +v; onChange() }, 'Tab width')
  const titleIn = input({ placeholder: 'Optional title at the top', 'aria-label': 'Title', oninput: (e) => { S.title = e.target.value; onChange() } })
  const tog = (key, label) => toggle(label, S[key], (v) => { S[key] = v; onChange() })

  // ----- preview
  const sheet = h('div', { class: 'sheet' }, h('div', { class: 'cv-sub', style: 'padding:90px 20px;text-align:center' }, 'Your PDF preview appears here'), h('div', { class: 'busy-veil' }, h('span', { class: 'spinner' })))
  const pager = h('div', { class: 'pager' })
  const warn = h('div')
  const onChange = () => { count.textContent = ta.value ? `${formatNumber(ta.value.length, 0)} characters` : ''; if (ta.value.length < 1e6) save('text-to-pdf:text', ta.value.length < 200_000 ? ta.value : ''); refresh() }
  ta.addEventListener('input', onChange)

  const refresh = debounce(async () => {
    const t = ++token
    if (!ta.value.trim()) { lastPdf = null; clear(sheet, h('div', { class: 'cv-sub', style: 'padding:90px 20px;text-align:center' }, 'Your PDF preview appears here'), h('div', { class: 'busy-veil' }, h('span', { class: 'spinner' }))); clear(pager); clear(warn); downloadBtn.disabled = true; return }
    sheet.classList.add('updating')
    try {
      const r = await buildTextPdf(ta.value, S)
      if (t !== token) return
      lastPdf = r
      downloadBtn.disabled = false
      pdfDoc?.destroy?.()
      pdfDoc = await openPdf(r.pdfBytes)
      pageNo = Math.min(pageNo, pdfDoc.numPages)
      await drawPage(t)
      clear(warn, r.unsupported.size ? alert('warn', `Some characters cannot be drawn and are shown as "?": ${[...r.unsupported].slice(0, 12).join(' ')}. Arabic, Hebrew, Thai, Chinese, Japanese, Korean and emoji are not supported yet.`) : null)
    } catch (e) { if (t === token) clear(warn, alert('error', e.message)) } finally { if (t === token) sheet.classList.remove('updating') }
  }, 350)

  async function drawPage(t) {
    const c = await renderPage(pdfDoc, pageNo, { scale: 1.3 })
    if (t != null && t !== token) return
    const veil = sheet.querySelector('.busy-veil') || h('div', { class: 'busy-veil' }, h('span', { class: 'spinner' }))
    clear(sheet, c, veil)
    const n = pdfDoc.numPages
    clear(pager, button('', { icon: 'chevron-left', variant: 'ghost', size: 'sm', ariaLabel: 'Previous page', disabled: pageNo <= 1, onClick: () => { pageNo--; drawPage() } }), `Page ${pageNo} of ${n}`,
      button('', { icon: 'chevron-right', variant: 'ghost', size: 'sm', ariaLabel: 'Next page', disabled: pageNo >= n, onClick: () => { pageNo++; drawPage() } }))
  }
  onCleanup(() => { pdfDoc?.destroy?.() })

  const downloadBtn = button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg', disabled: true })
  downloadBtn.addEventListener('click', () => busy(downloadBtn, async () => {
    const t0 = performance.now()
    const r = await buildTextPdf(ta.value, S)
    const blob = new Blob([r.pdfBytes], { type: 'application/pdf' })
    download(blob, `${fileName || 'text'}.pdf`)
    done(result, { flowEl: fl, title: 'PDF saved', stats: [plural(r.pages, 'page'), formatBytes(blob.size), secs(performance.now() - t0)], celebrate: true })
  }, { label: 'Building', errorTo: result }))

  const s1 = step(1, 'Your text', h('div', { class: 'stack' }, ta, h('div', { class: 'row between' }, count, clearBtn), zone))
  const s2 = step(2, 'Look and feel', split(h('div', { class: 'stack' }, options(field('Font', fontSel), sizeR, spaceR, field('Page size', pageSel), field('Orientation', orientSeg), marginR, field('Tab width', tabSeg), field('Title', titleIn)),
    h('div', { class: 'stack tight' }, tog('wrap', 'Wrap long lines'), tog('lineNumbers', 'Line numbers'), tog('pageNumbers', 'Page numbers'))), h('div', { class: 'stack' }, warn, h('div', { class: 'pv' }, sheet, pager)), 'wide-left'))
  const s3 = step(3, 'Download', h('div', { class: 'stack' }, h('div', { class: 'row' }, downloadBtn, note('The text is embedded as real text, so it stays selectable and searchable. Nothing is uploaded.', 'shield-check')), result))
  root.append(h('div', { class: 'cv t-ttp' }, fl, s1, s2, s3))
  onChange()
}
