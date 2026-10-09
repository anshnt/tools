// Excel to PDF: lay a spreadsheet out as a clean, printable PDF table (jsPDF), with page breaks, repeating headers and page numbers.
import { h, icon, clear, field, input, select, toggle, segmented, alert, progress, button, debounce, formatBytes, toast, onCleanup, yieldToMain } from '../../lib/ui.js'
import { jspdf } from '../../lib/libs.js'
import { openPdf, renderPage } from '../../lib/pdf.js'
import { sheetToTable, inferTypes, isNumericType, str, plural } from './_table.js'
import { toolFlow, exportBar, statTiles, chipSelect, section, nameBase } from './_view.js'

const PAGES = { a4: [210, 297], letter: [215.9, 279.4], legal: [215.9, 355.6], a3: [297, 420] }
const MARGINS = { narrow: 8, normal: 14, wide: 22 }
const HEADER_COLORS = { indigo: [79, 70, 229], emerald: [5, 150, 105], slate: [51, 65, 85], rose: [225, 29, 72], amber: [180, 83, 9], ink: [17, 24, 39] }
const WIN = new Set([0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178])
const MAX_ROWS = 60000
const supported = (c) => c < 0x100 || WIN.has(c)

/** Replace characters the built-in PDF fonts cannot draw. Returns [text, replacedCount]. */
export function toWinAnsi(s) {
  let n = 0
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0)
    if (c === 0x09 || c === 0x0A || c === 0x0D) out += ' '
    else if (c < 0x20) { /* drop control characters */ }
    else if (supported(c)) out += ch
    else { out += '?'; n++ }
  }
  return [out, n]
}

/**
 * Draw sheets into a PDF. sheets: [{ name, table }]. o: { size, orient, margin, fontSize, fit, stretch, repeat, zebra, lines, color, title, footer, numbers }.
 * maxPages limits drawing for fast previews. Returns { doc, pages, rowsDrawn, replaced }.
 */
export async function drawPdf(sheets, o, { maxPages = Infinity, onProgress } = {}) {
  const JsPDF = await jspdf()
  const [bw, bh] = PAGES[o.size]
  const m = MARGINS[o.margin]
  const accent = HEADER_COLORS[o.color]
  let doc = null
  let replaced = 0
  const pageSheets = []
  let rowsDrawn = 0, totalRows = 0
  for (const s of sheets) totalRows += s.table.rows.length
  let done = 0
  let stopped = false
  const fix = (v) => { const [t, n] = toWinAnsi(str(v)); replaced += n; return t }

  for (let si = 0; si < sheets.length && !stopped; si++) {
    const { name, table } = sheets[si]
    const nc = table.headers.length
    const landscape = o.orient === 'landscape' || (o.orient === 'auto' && nc > 7)
    const pw = landscape ? bh : bw, ph = landscape ? bw : bh
    const orientation = landscape ? 'l' : 'p'
    if (!doc) doc = new JsPDF({ unit: 'mm', format: [bw, bh], orientation, compress: true })
    else doc.addPage([bw, bh], orientation)
    pageSheets.push(name)
    const types = inferTypes(table)
    const right = types.map((t) => o.numbers && isNumericType(t))
    const avail = pw - 2 * m
    const padX = 1.7, padY = 1.5
    let fs = o.fontSize
    const headers = table.headers.map(fix)
    const sample = table.rows.slice(0, 250)
    const measure = (fsz) => {
      doc.setFontSize(fsz)
      return headers.map((hd, c) => {
        doc.setFont('helvetica', 'bold')
        let w = doc.getTextWidth(hd) + 1
        doc.setFont('helvetica', 'normal')
        for (const r of sample) { const t = str(r[c]); if (t.length > 120) { w = Math.max(w, doc.getTextWidth(t.slice(0, 120))); continue } const x = doc.getTextWidth(t); if (x > w) w = x }
        return Math.min(w + 2 * padX, avail * 0.55)
      })
    }
    let widths = measure(fs)
    let total = widths.reduce((a, b) => a + b, 0)
    if (total > avail && o.fit === 'shrink') {
      const k = Math.max(0.62, avail / total)
      fs = Math.max(5.5, fs * k)
      widths = measure(fs)
      total = widths.reduce((a, b) => a + b, 0)
    }
    if (total > avail) widths = widths.map((w) => (w * avail) / total)
    else if (o.stretch) { const k = Math.min(avail / total, 1.7); widths = widths.map((w) => w * k) }
    const tableW = widths.reduce((a, b) => a + b, 0)
    const lh = fs * 0.3528 * 1.28
    const xs = widths.reduce((acc, w, i) => (acc.push(i ? acc[i - 1] + widths[i - 1] : m), acc), [])
    const footerH = o.footer ? 7 : 0
    const bottom = ph - m - footerH
    let y = m

    const wrap = (txt, w) => {
      doc.setFontSize(fs)
      if (doc.getTextWidth(txt) <= w - 2 * padX) return [txt]
      const lines = doc.splitTextToSize(txt, w - 2 * padX)
      return lines.length > 7 ? [...lines.slice(0, 6), `${lines[6].slice(0, -3)}...`] : lines
    }
    const drawHeader = () => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(fs)
      const lines = headers.map((t, c) => wrap(t, widths[c]))
      const hh = Math.max(...lines.map((l) => l.length)) * lh + 2 * padY
      doc.setFillColor(...accent); doc.rect(m, y, tableW, hh, 'F')
      doc.setTextColor(255, 255, 255)
      lines.forEach((l, c) => { l.forEach((ln, k) => doc.text(ln, right[c] ? xs[c] + widths[c] - padX : xs[c] + padX, y + padY + (k + 0.82) * lh, right[c] ? { align: 'right' } : undefined)) })
      y += hh
      doc.setTextColor(30, 30, 40)
      doc.setFont('helvetica', 'normal')
    }
    const newPage = () => {
      if (doc.getNumberOfPages() >= maxPages) { stopped = true; return false }
      doc.addPage([bw, bh], orientation); pageSheets.push(name); y = m
      return true
    }
    // title
    const title = o.title.trim() && sheets.length === 1 ? o.title.trim() : sheets.length > 1 || o.sheetTitles ? name : ''
    if (title) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(18, fs + 5)); doc.setTextColor(17, 17, 28)
      doc.text(fix(title), m, y + 5.5)
      y += 10
      doc.setFont('helvetica', 'normal')
    }
    doc.setFontSize(fs)
    drawHeader()
    doc.setFontSize(fs); doc.setFont('helvetica', 'normal')
    for (let ri = 0; ri < table.rows.length; ri++) {
      const row = table.rows[ri]
      const lines = []
      let maxLines = 1
      for (let c = 0; c < nc; c++) { const l = wrap(fix(row[c]), widths[c]); lines.push(l); if (l.length > maxLines) maxLines = l.length }
      const rh = maxLines * lh + 2 * padY
      if (y + rh > bottom) {
        if (!newPage()) break
        if (o.repeat) { drawHeader(); doc.setFontSize(fs) }
      }
      if (o.zebra && ri % 2 === 1) { doc.setFillColor(244, 245, 250); doc.rect(m, y, tableW, rh, 'F') }
      lines.forEach((l, c) => l.forEach((ln, k) => doc.text(ln, right[c] ? xs[c] + widths[c] - padX : xs[c] + padX, y + padY + (k + 0.82) * lh, right[c] ? { align: 'right' } : undefined)))
      if (o.lines !== 'none') {
        doc.setDrawColor(218, 220, 230); doc.setLineWidth(0.15)
        doc.line(m, y + rh, m + tableW, y + rh)
        if (o.lines === 'grid') { for (let c = 0; c <= nc; c++) { const x = c === nc ? m + tableW : xs[c]; doc.line(x, y, x, y + rh) } }
      }
      y += rh
      rowsDrawn++
      if (ri % 400 === 399) { onProgress?.((done + ri) / Math.max(totalRows, 1)); await yieldToMain() }
    }
    done += table.rows.length
    if (o.lines === 'grid' && !stopped) { /* left edge drawn per row */ }
  }
  const pages = doc.getNumberOfPages()
  if (o.footer) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 135)
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p)
      const w = doc.internal.pageSize.getWidth(), hgt = doc.internal.pageSize.getHeight()
      doc.text(fix(pageSheets[p - 1] || ''), m, hgt - m + 1)
      doc.text(`Page ${p}${maxPages === Infinity ? ` of ${pages}` : ''}`, w - m, hgt - m + 1, { align: 'right' })
    }
  }
  return { doc, pages, rowsDrawn, totalRows, replaced, stopped }
}

/** Print-friendly HTML (keeps every language) opened through the browser's own print dialog. */
export function printHtml(sheets, o) {
  const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const color = `rgb(${HEADER_COLORS[o.color].join(',')})`
  const body = sheets.map(({ name, table }) => {
    const types = inferTypes(table)
    return `<section><h2>${esc(name)}</h2><table><thead><tr>${table.headers.map((x) => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((r) => `<tr>${table.headers.map((_, c) => `<td${isNumericType(types[c]) && o.numbers ? ' class="n"' : ''}>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sheets[0]?.name || 'Spreadsheet')}</title><style>
@page { size: ${o.size === 'letter' ? 'letter' : o.size === 'legal' ? 'legal' : o.size === 'a3' ? 'A3' : 'A4'} ${o.orient === 'auto' ? 'landscape' : o.orient}; margin: ${MARGINS[o.margin]}mm; }
body { font: ${o.fontSize}pt/1.3 system-ui, "Segoe UI", Arial, sans-serif; color: #1a1a24; }
h2 { font-size: 14pt; margin: 0 0 8px; } section { page-break-after: always; } section:last-child { page-break-after: auto; }
table { border-collapse: collapse; width: 100%; } th { background: ${color}; color: #fff; text-align: left; padding: 4px 6px; }
td { padding: 3px 6px; border-bottom: 1px solid #dcdde6; ${o.lines === 'grid' ? 'border: 1px solid #dcdde6;' : ''} vertical-align: top; } td.n { text-align: right; }
${o.zebra ? 'tbody tr:nth-child(even) td { background: #f4f5fa; }' : ''} thead { display: table-header-group; } tr { page-break-inside: avoid; }
</style></head><body>${body}</body></html>`
}

export async function mount(root) {
  let entry = null, sheetNames = [], picked = []
  const o = { size: 'a4', orient: 'auto', margin: 'normal', fontSize: 9, fit: 'shrink', stretch: true, repeat: true, zebra: true, lines: 'rows', color: 'indigo', title: '', footer: true, numbers: true }
  const statsHost = h('div'), prevHost = h('div', { class: 'dt-pdfprev' }), warnHost = h('div'), barHost = h('div'), sheetHost = h('div')
  const prog = progress('Building PDF')
  let token = 0
  const f = toolFlow({
    titles: ['Add your spreadsheet', 'Set up the pages', 'Preview and download'],
    source: { sample: 'workbook', formatted: true, excelOptions: true, hint: 'Excel (.xlsx, .xls, .ods) or CSV. Cell values appear as Excel shows them.' },
    onData: (e) => { entry = e; if (e) init() },
  })

  function init() {
    sheetNames = entry.kind === 'excel' ? entry.sheets : [entry.name]
    picked = entry.kind === 'excel' ? [entry.sheet] : [entry.name]
    clear(sheetHost, entry.kind === 'excel' && sheetNames.length > 1 ? field('Sheets to include', chipSelect({ items: sheetNames.map((n) => ({ value: n, label: n })), value: picked, onChange: (v) => { picked = v; refresh() }, label: 'Sheets' })) : null)
    refresh()
  }
  const getSheets = () => {
    if (!entry) return []
    if (entry.kind !== 'excel') return [{ name: nameBase(entry), table: entry.table }]
    return sheetNames.filter((n) => picked.includes(n)).map((n) => ({ name: n, table: n === entry.sheet ? entry.table : sheetToTable(entry.book, n, { header: entry.opts.header ?? 'auto', formatted: entry.opts.formatted, fillMerged: entry.opts.fillMerged }) }))
  }

  const skeleton = () => clear(prevHost, h('div', { class: 'dt-skel', style: 'height:260px;width:min(420px,80vw)' }))
  const refresh = () => { if (entry) { skeleton(); build() } }
  const build = debounce(async () => {
    if (!entry) return
    const my = ++token
    const sheets = getSheets()
    if (!sheets.length) { clear(prevHost, h('div', { class: 'empty' }, 'Pick at least one sheet.')); clear(barHost); return }
    const rows = sheets.reduce((a, s) => a + s.table.rows.length, 0)
    if (rows > MAX_ROWS) { clear(warnHost, alert('error', `${rows.toLocaleString()} rows is too many for one PDF here (limit ${MAX_ROWS.toLocaleString()}). Split the file first, or use "Print or save as PDF".`)) } else clear(warnHost)
    try {
      const r = await drawPdf(sheets, o, { maxPages: 2 })
      if (my !== token) return
      const blob = r.doc.output('blob')
      const pdf = await openPdf(blob)
      const cvs = []
      for (let p = 1; p <= Math.min(2, pdf.numPages); p++) cvs.push(await renderPage(pdf, p, { scale: 1.25 }))
      pdf.destroy?.()
      if (my !== token) return
      const est = r.stopped ? Math.max(r.pages, Math.ceil((r.totalRows / Math.max(1, r.rowsDrawn)) * r.pages)) : r.pages
      clear(prevHost, cvs.map((c, i) => h('figure', { class: 'dt-pg', style: { '--i': i } }, c, h('figcaption', `Page ${i + 1}`))))
      clear(statsHost, statTiles([{ label: r.stopped ? 'Pages (about)' : 'Pages', value: est, accent: true }, { label: 'Rows', value: rows }, { label: 'Sheets', value: sheets.length }, { label: 'Paper', value: `${o.size.toUpperCase()} ${r.doc.internal.pageSize.getWidth() > r.doc.internal.pageSize.getHeight() ? 'landscape' : 'portrait'}` }]))
      if (r.replaced) clear(warnHost, alert('warn', `${r.replaced.toLocaleString()} character${r.replaced > 1 ? 's' : ''} (such as emoji, Hindi, Chinese or Arabic letters) cannot be drawn with the built-in PDF font and show as "?". Use "Print or save as PDF" below to keep them.`))
    } catch (err) {
      if (my !== token) return
      console.error(err)
      clear(prevHost, alert('error', `Could not build the preview: ${err.message}`))
    }
  }, 300)

  function buildBar() {
    clear(barHost, exportBar({
      copy: false,
      items: [
        { label: 'Download PDF', icon: 'file-down', primary: true, make: async () => {
          const sheets = getSheets()
          if (!sheets.length) throw new Error('Pick at least one sheet.')
          const rows = sheets.reduce((a, s) => a + s.table.rows.length, 0)
          if (rows > MAX_ROWS) throw new Error(`Too many rows for one PDF (${rows.toLocaleString()}). Split the file first.`)
          const r = await drawPdf(sheets, o, { onProgress: (p) => prog.set(p, 'Drawing pages') })
          prog.hide()
          toast(`${plural(r.pages, 'page')} created`, 'success')
          return { blob: r.doc.output('blob'), name: `${nameBase(entry)}.pdf` }
        } },
        { label: 'Print or save as PDF', icon: 'printer', make: async () => {
          const frame = h('iframe', { style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0', 'aria-hidden': 'true' })
          document.body.append(frame)
          frame.srcdoc = printHtml(getSheets(), o)
          await new Promise((res) => { frame.onload = res })
          frame.contentWindow.focus(); frame.contentWindow.print()
          setTimeout(() => frame.remove(), 60_000)
          return null
        } },
      ],
      note: 'The browser print dialog keeps every language and font',
    }))
  }
  const T = (label, key) => toggle(label, o[key], (v) => { o[key] = v; refresh() })
  const S = (label, key, opts, hint) => field(label, select(opts, o[key], (v) => { o[key] = key === 'fontSize' ? +v : v; refresh() }), hint)
  f.s2.body.append(h('div', { class: 'panel stack' }, sheetHost,
    h('div', { class: 'dt-grid' },
      S('Paper', 'size', [['a4', 'A4'], ['letter', 'US Letter'], ['legal', 'US Legal'], ['a3', 'A3']]),
      S('Orientation', 'orient', [['auto', 'Automatic (landscape for wide tables)'], ['portrait', 'Portrait'], ['landscape', 'Landscape']]),
      S('Margins', 'margin', [['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']]),
      S('Text size', 'fontSize', [[7, '7 pt (small)'], [8, '8 pt'], [9, '9 pt'], [10, '10 pt'], [11, '11 pt'], [12, '12 pt (large)']]),
      S('If columns do not fit', 'fit', [['shrink', 'Shrink the text a little, then wrap'], ['wrap', 'Keep the size and wrap text']]),
      S('Table lines', 'lines', [['rows', 'Between rows'], ['grid', 'Full grid'], ['none', 'None']]),
      S('Header color', 'color', Object.keys(HEADER_COLORS).map((k) => [k, k[0].toUpperCase() + k.slice(1)])),
      field('Title (single sheet)', input({ placeholder: 'Optional, shown above the table', oninput: (e) => { o.title = e.target.value; refresh() } }))),
    h('div', { class: 'row' }, T('Repeat the header on every page', 'repeat'), T('Striped rows', 'zebra'), T('Page numbers', 'footer'), T('Right-align numbers', 'numbers'), T('Fill the page width', 'stretch'))))
  f.s3.body.append(statsHost, warnHost, h('div', { class: 'dt-pdfwrap' }, prevHost), prog.el, barHost)
  buildBar()
  root.append(h('style', {}, `
.dt-pdfwrap { overflow-x: auto; padding: 4px 2px 10px; border-radius: var(--radius-lg); background: var(--surface-2); border: 1px solid var(--border); }
.dt-pdfprev { display: flex; gap: 18px; padding: 14px; min-height: 120px; align-items: flex-start; width: max-content; min-width: 100%; }
.dt-pg { margin: 0; animation: dtIn .5s calc(var(--i, 0) * 90ms) var(--ease) both; }
.dt-pg canvas { display: block; max-width: none; height: auto; max-height: 520px; width: auto; background: #fff; border-radius: 6px; box-shadow: 0 18px 40px -18px rgba(20, 20, 50, .45), 0 0 0 1px rgba(20, 20, 50, .08); }
.dt-pg figcaption { text-align: center; font-size: 12px; color: var(--muted); margin-top: 8px; }
`), f.el)
}
