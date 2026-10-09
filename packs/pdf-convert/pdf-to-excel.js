// PDF to Excel (and PDF to CSV with params.format = 'csv'). Text items are grouped into rows by baseline and into columns by x gaps and
// alignment. The detected tables are highlighted on the page and previewed as a grid before export with SheetJS.
import { h, button, busy, progress, alert, segmented, rangeField, toggle, field, table as tableKit, clear, download, debounce, onCleanup, empty, formatBytes, icon } from '../../lib/ui.js'
import { xlsx as xlsxLib } from '../../lib/libs.js'
import { renderPage } from '../../lib/pdf.js'
import { baseName } from '../../lib/files.js'
import { zip } from '../../lib/files.js'
import { buildLines, detectTables, pageReader } from './_layout.js'
import { useStyles, flow, step, options, pdfSource, pageSelector, done, chip, note, plural, secs, checkAbort } from './_shared.js'

const CSS = `
.t-pte .tabs-row { display: flex; gap: 8px; flex-wrap: wrap; }
.t-pte .tb { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 8px; border: 1px solid var(--border); border-radius: 99px; background: var(--surface); cursor: pointer; font-size: 13px; transition: transform .2s var(--spring), border-color .2s, background .2s; }
.t-pte .tb:hover { transform: translateY(-2px); border-color: var(--border-strong); }
.t-pte .tb[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.t-pte .tb input { width: 17px; height: 17px; accent-color: var(--accent); margin: 0; cursor: pointer; }
.t-pte .tb.off { opacity: .55; }
.t-pte .pagebox { position: relative; border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; background: #fff; box-shadow: var(--shadow-sm); }
.t-pte .pagebox canvas { display: block; width: 100%; height: auto; }
.t-pte .grid-wrap .table th:first-child, .t-pte .grid-wrap .table td:first-child { color: var(--muted); background: var(--surface-2); font-size: 12px; text-align: center; position: sticky; left: 0; }
.t-pte .grid-wrap .table td { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.t-pte .grid-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; font-weight: 600; flex-wrap: wrap; }
`

const colName = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const NUM = /^\(?[-+]?\s*[$€£₹¥]?\s*[-+]?(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})*,\d{3}|\d+)(\.\d+)?\s*%?\)?$/

/** "1,234.50" -> {v: 1234.5, z: '#,##0.00'}; "(12)" -> -12; "19.6%" -> 0.196. Returns null for text (leading zeros and long IDs stay text). */
export function parseNumber(s) {
  const t = String(s).trim()
  if (!t || !NUM.test(t)) return null
  const neg = /^\(.*\)$/.test(t) || /^-|^\(?\s*[$€£₹¥]?\s*-/.test(t)
  const pct = /%$/.test(t)
  const digits = t.replace(/[^\d.]/g, '')
  if (/^0\d/.test(digits) && !digits.includes('.')) return null
  if (digits.replace('.', '').length > 15) return null
  let v = parseFloat(digits)
  if (!Number.isFinite(v)) return null
  if (neg) v = -v
  if (pct) return { v: parseFloat((v / 100).toFixed(10)), z: digits.includes('.') ? '0.00%' : '0%' }
  const dec = (digits.split('.')[1] || '').length
  return { v, z: t.includes(',') ? (dec ? `#,##0.${'0'.repeat(dec)}` : '#,##0') : dec ? `0.${'0'.repeat(dec)}` : undefined }
}

export function mount(root, { params, signal }) {
  const csvMode = params.format === 'csv'
  useStyles({ id: 'pte', css: CSS })
  const S = { gap: 1.0, minRows: 2, convert: true, text: false, merge: true, layout: 'table' }
  const fl = flow('pdf', csvMode ? 'csv' : 'xlsx')
  const prog = progress()
  const review = h('div', { class: 'stack' })
  const result = h('div', { class: 'stack' })
  const reader = pageReader(() => src.doc)
  let tables = [], pageLines = new Map(), sel = 0, nums = [], pageData = [], detectToken = 0

  const src = pdfSource({
    onLoad: () => { reader.clear(); pageData = []; tables = []; pages.reset(); s2.unlock(); s3.unlock(); clear(review); clear(result); fl.state('idle'); if (src.numPages <= 30) run() },
    onClear: () => { s2.lock(); s3.lock(); clear(review); clear(result); tables = [] },
  })
  const pages = pageSelector(src, { onChange: () => { if (src.doc && (pageData.length || src.numPages <= 30)) auto() } })
  const auto = debounce(() => run(), 400)
  const redetect = debounce(() => { if (pageData.length) { detect(); renderReview() } }, 200)

  const gapR = rangeField('Column spacing', { min: 0.4, max: 3, step: 0.1, value: S.gap, format: (v) => (v <= 0.7 ? `${v.toFixed(1)} (more columns)` : v >= 2 ? `${v.toFixed(1)} (fewer columns)` : v.toFixed(1)), onInput: (v) => { S.gap = v; redetect() }, hint: 'How wide a gap between words must be to start a new column, in font heights.' })
  const rowsR = rangeField('Minimum rows', { min: 2, max: 6, step: 1, value: S.minRows, format: (v) => `${v} rows`, onInput: (v) => { S.minRows = v; redetect() }, hint: 'Aligned text with fewer rows is treated as plain text.' })
  const tog = (key, label, after) => toggle(label, S[key], (v) => { S[key] = v; (after || redetect)() })
  const layoutSeg = segmented([['table', 'Sheet per table'], ['page', 'Sheet per page'], ['one', 'One sheet']], S.layout, (v) => { S.layout = v; renderExport() }, 'Sheet layout')

  const runBtn = button('Find tables', { icon: 'scan-search', variant: 'primary', size: 'lg' })
  runBtn.addEventListener('click', () => busy(runBtn, run, { label: 'Reading', errorTo: review, progress: prog }))

  async function run() {
    let list
    try { list = pages.pages() } catch (e) { return clear(review, alert('warn', e.message)) }
    fl.state('working')
    try {
      pageData = await reader.pages(list, { signal, onProgress: (f, t) => prog.set(f, t) })
      nums = list
      prog.hide()
      detect()
      sel = 0
      await renderReview()
      fl.state(tables.length ? 'done' : 'idle')
    } catch (e) { fl.state('idle'); prog.hide(); throw e }
  }

  function detect() {
    pageLines = new Map()
    tables = []
    let id = 0
    for (const pd of pageData) {
      const lines = buildLines(pd.items)
      const found = detectTables(lines, { cellGap: S.gap, minRows: S.minRows })
      const rest = lines.filter((l) => !found.used.has(l))
      pageLines.set(pd.n, { lines: rest, w: pd.width, h: pd.height })
      for (const t of found.tables) tables.push({ id: id++, page: pd.n, rows: t.rows.map((r) => [...r]), merges: [...t.merges], cols: t.cols, bbox: { x0: t.x0, x1: t.x1, y0: t.y0, y1: t.y1 }, include: true, x0: t.x0, pageH: pd.height })
    }
    if (S.merge) {
      const merged = []
      const byPage = new Map()
      for (const t of tables) byPage.set(t.page, [...(byPage.get(t.page) || []), t])
      for (const t of tables) {
        const prev = merged[merged.length - 1]
        const firstOnPage = byPage.get(t.page)[0] === t
        const lastOnPrev = prev && byPage.get(prev.pages.at(-1)).at(-1).bbox.y1 === prev.bboxes.at(-1).y1
        const sameHeader = prev && prev.rows[0].join('|') === t.rows[0].join('|')
        const cont = prev && firstOnPage && lastOnPrev && t.page === prev.pages.at(-1) + 1 && prev.cols === t.cols && Math.abs(prev.x0 - t.x0) < 12
          && (sameHeader || (prev.bboxes.at(-1).y1 > prev.pageH * 0.7 && t.bbox.y0 < t.pageH * 0.25))
        if (cont) {
          prev.rows.push(...(sameHeader ? t.rows.slice(1) : t.rows))
          prev.pages.push(t.page)
          prev.bboxes.push({ page: t.page, ...t.bbox })
        } else merged.push({ ...t, rows: t.rows.map((r) => [...r]), pages: [t.page], bboxes: [{ page: t.page, ...t.bbox }] })
      }
      tables = merged.map((t, i) => ({ ...t, id: i }))
    } else tables = tables.map((t, i) => ({ ...t, id: i, pages: [t.page], bboxes: [{ page: t.page, ...t.bbox }] }))
  }

  async function renderReview() {
    if (!tables.length) {
      const textOnly = [...pageLines.values()].reduce((n, p) => n + p.lines.length, 0)
      clear(review, empty(textOnly ? 'No tables found. Try a smaller column spacing, or fewer minimum rows, then export the text lines.' : 'No selectable text found on these pages. This PDF may be scanned: run OCR PDF first.', 'table-2'),
        h('div', { class: 'row' }, textOnly ? button('Export text lines instead', { icon: 'list', onClick: () => { S.text = true; S.layout = 'page'; layoutSeg.set('page'); textTog.input.checked = true; renderExport() } }) : null, h('a', { class: 'btn btn-secondary', href: '#/pdf-ocr' }, icon('scan-text'), h('span', 'Open OCR PDF'))))
      renderExport()
      return
    }
    sel = Math.min(sel, tables.length - 1)
    const t = tables[sel]
    const tabsRow = h('div', { class: 'tabs-row', role: 'group', 'aria-label': 'Detected tables' }, tables.map((tb, i) => {
      const cb = h('input', { type: 'checkbox', checked: tb.include, 'aria-label': `Include table ${i + 1}`, onclick: (e) => e.stopPropagation(), onchange: (e) => { tb.include = e.target.checked; btn.classList.toggle('off', !tb.include); renderExport() } })
      const btn = h('button', { type: 'button', class: ['tb', !tb.include && 'off'], 'aria-pressed': String(i === sel), onclick: () => { sel = i; renderReview() } }, cb,
        h('span', `Table ${i + 1}`), h('span', { class: 'cv-sub' }, `p${tb.pages.length > 1 ? `${tb.pages[0]}-${tb.pages.at(-1)}` : tb.pages[0]} · ${tb.rows.length} x ${tb.cols}`))
      return btn
    }))
    const pageBox = h('div', { class: 'pagebox' })
    const colsNum = Array.from({ length: t.cols }, (_, c) => t.rows.filter((r) => r[c]).length && t.rows.filter((r) => r[c] && parseNumber(r[c])).length / t.rows.filter((r) => r[c]).length > 0.6)
    const grid = tableKit({ columns: ['', ...Array.from({ length: t.cols }, (_, c) => ({ label: colName(c), num: colsNum[c] }))], rows: t.rows.map((r, i) => [String(i + 1), ...r]), max: 300 })
    clear(review, h('div', { class: 'cv-chips' }, chip(plural(tables.length, 'table'), 'good', 'table-2'), chip(plural(nums.length, 'page'), '', 'layers'), chip(`${tables.reduce((n, x) => n + x.rows.length, 0)} rows`, '', 'rows-3')), tabsRow,
      h('div', { class: 'tool-split wide-right', style: 'align-items:start' },
        h('div', h('div', { class: 'grid-title' }, icon('scan-search'), `Table ${sel + 1} on page${t.pages.length > 1 ? 's' : ''} ${t.pages.join(', ')}`), pageBox),
        h('div', h('div', { class: 'grid-title' }, icon('table-2'), 'Preview', h('span', { class: 'cv-sub' }, `${t.rows.length} rows, ${t.cols} columns`)), h('div', { class: 'grid-wrap' }, grid))),
      h('div', { id: 'export-slot' }))
    // page image with the detected regions highlighted
    const pn = t.pages[0]
    const c = await renderPage(src.doc, pn, { scale: 1.4 })
    const k = c.width / (pageLines.get(pn)?.w || c.width)
    const g = c.getContext('2d')
    tables.forEach((tb, i) => {
      for (const b of tb.bboxes.filter((x) => x.page === pn)) {
        const on = i === sel
        g.fillStyle = on ? 'rgba(91,76,240,.16)' : 'rgba(120,120,140,.10)'
        g.strokeStyle = on ? '#5b4cf0' : 'rgba(120,120,140,.7)'
        g.lineWidth = on ? 3 : 1.5
        const x = (b.x0 - 4) * k, y = (b.y0 - 3) * k, w = (b.x1 - b.x0 + 8) * k, hh = (b.y1 - b.y0 + 6) * k
        g.fillRect(x, y, w, hh); g.strokeRect(x, y, w, hh)
        g.fillStyle = on ? '#5b4cf0' : '#6b6b80'
        g.beginPath(); g.arc(x + 4, y + 4, 11, 0, Math.PI * 2); g.fill()
        g.fillStyle = '#fff'; g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x + 4, y + 4.5)
      }
    })
    pageBox.append(c)
    renderExport()
  }

  const textTog = toggle('Also export text outside tables', S.text, (v) => { S.text = v; renderExport() })

  /** Build the sheets for the current layout: [{name, rows, merges}] */
  function sheets() {
    const inc = tables.filter((t) => t.include)
    const used = new Set()
    const uniq = (n) => { let base = n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Sheet', k = base, i = 2; while (used.has(k.toLowerCase())) k = `${base.slice(0, 26)} ${i++}`; used.add(k.toLowerCase()); return k }
    const textRows = (n) => (pageLines.get(n)?.lines || []).map((l) => ({ y: l.y, row: [l.text.trim()] })).filter((r) => r.row[0])
    if (S.layout === 'table') {
      const out = inc.map((t, i) => ({ name: uniq(`Table ${t.id + 1} p${t.pages[0]}`), rows: t.rows, merges: t.merges }))
      if (S.text) { const rows = nums.flatMap((n) => textRows(n).map((r) => r.row)); if (rows.length) out.push({ name: uniq('Text'), rows, merges: [] }) }
      return out
    }
    const byPage = (n) => {
      const parts = []
      for (const t of inc) for (const b of t.bboxes) if (b.page === n) parts.push({ y: b.y0, rows: t.pages[0] === n ? t.rows : [], merges: t.pages[0] === n ? t.merges : [] })
      if (S.text) parts.push(...textRows(n).map((r) => ({ y: r.y, rows: [r.row], merges: [] })))
      parts.sort((a, b) => a.y - b.y)
      return parts
    }
    const build = (ns) => {
      const rows = [], merges = []
      for (const n of ns) for (const p of byPage(n)) { for (const m of p.merges) merges.push({ ...m, r: m.r + rows.length }); rows.push(...p.rows) }
      return { rows, merges }
    }
    if (S.layout === 'one') { const b = build(nums); return b.rows.length ? [{ name: uniq('Sheet1'), ...b }] : [] }
    return nums.map((n) => ({ name: uniq(`Page ${n}`), ...build([n]) })).filter((s) => s.rows.length)
  }

  async function workbook(list) {
    const X = await xlsxLib()
    const wb = X.utils.book_new()
    for (const s of list) {
      const width = Math.max(1, ...s.rows.map((r) => r.length))
      const ws = {}
      let maxLen = new Array(width).fill(6)
      s.rows.forEach((r, ri) => {
        r.forEach((val, ci) => {
          if (val === '' || val == null) return
          const addr = X.utils.encode_cell({ r: ri, c: ci })
          const num = S.convert ? parseNumber(val) : null
          ws[addr] = num ? { t: 'n', v: num.v, z: num.z } : { t: 's', v: String(val) }
          maxLen[ci] = Math.min(60, Math.max(maxLen[ci], String(val).length + 2))
        })
      })
      ws['!ref'] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, s.rows.length - 1), c: width - 1 } })
      ws['!cols'] = maxLen.map((w) => ({ wch: w }))
      if (s.merges.length) ws['!merges'] = s.merges.map((m) => ({ s: { r: m.r, c: m.c }, e: { r: m.r, c: m.c + m.span - 1 } }))
      X.utils.book_append_sheet(wb, ws, s.name)
    }
    return { X, wb }
  }

  const csvCell = (v) => (/[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const toCsv = (rows) => `﻿${rows.map((r) => r.map((c) => csvCell(c ?? '')).join(',')).join('\r\n')}\r\n`

  function renderExport() {
    const slot = review.querySelector('#export-slot') || review
    const list = sheets()
    const totalRows = list.reduce((n, s) => n + s.rows.length, 0)
    const name = baseName(src.file.name)
    const xlsxBtn = button('Download .xlsx', { icon: 'sheet', variant: csvMode ? 'secondary' : 'primary', size: 'lg', disabled: !list.length })
    const csvBtn = button(list.length > 1 ? 'Download CSVs (ZIP)' : 'Download .csv', { icon: 'file-spreadsheet', variant: csvMode ? 'primary' : 'secondary', size: csvMode ? 'lg' : 'md', disabled: !list.length })
    xlsxBtn.addEventListener('click', () => busy(xlsxBtn, async () => {
      const { X, wb } = await workbook(list)
      const out = X.write(wb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      download(blob, `${name}.xlsx`)
      done(result, { flowEl: fl, title: 'Spreadsheet saved', stats: [plural(list.length, 'sheet'), plural(totalRows, 'row'), formatBytes(blob.size)] })
    }, { label: 'Building', errorTo: result }))
    csvBtn.addEventListener('click', () => busy(csvBtn, async () => {
      if (list.length === 1) { const b = new Blob([toCsv(list[0].rows)], { type: 'text/csv;charset=utf-8' }); download(b, `${name}.csv`); done(result, { flowEl: fl, title: 'CSV saved', stats: [plural(totalRows, 'row'), formatBytes(b.size)] }); return }
      const z = await zip(list.map((s) => ({ name: `${name}-${s.name.replace(/\s+/g, '-')}.csv`, data: toCsv(s.rows) })))
      download(z, `${name}-csv.zip`)
      done(result, { flowEl: fl, title: 'CSV files saved', stats: [plural(list.length, 'file'), plural(totalRows, 'row'), formatBytes(z.size)] })
    }, { label: 'Building', errorTo: result }))
    const bar = h('div', { class: 'stack' }, h('div', { class: 'cv-opts' }, h('div', { class: 'stack tight' }, field('Sheet layout', layoutSeg), h('div', { class: 'cv-sub' }, list.length ? `${plural(list.length, 'sheet')}, ${plural(totalRows, 'row')} will be exported.` : 'Nothing to export yet.')),
      h('div', { class: 'stack tight' }, textTog)), h('div', { class: 'row' }, csvMode ? [csvBtn, xlsxBtn] : [xlsxBtn, csvBtn]))
    clear(slot, bar)
  }

  const s1 = step(1, 'Choose your PDF', src.el)
  const s2 = step(2, 'Pages and detection', h('div', { class: 'stack' }, pages.el, options(h('div', { class: 'stack tight' }, gapR, rowsR), h('div', { class: 'stack tight' }, tog('convert', 'Convert numbers, percentages and currency to real numbers', () => renderExport()), tog('merge', 'Join tables that continue on the next page')))), { locked: true })
  const s3 = step(3, 'Review and export', h('div', { class: 'stack' }, h('div', { class: 'row' }, runBtn, note('Tables are found from text positions. Ruled lines are not used, so check the preview.', 'shield-check')), prog.el, review, result), { locked: true })
  root.append(h('div', { class: 'cv t-pte' }, fl, s1, s2, s3))
}
