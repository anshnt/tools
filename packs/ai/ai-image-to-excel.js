// Table image to Excel: Claude vision reads tables from a photo, screenshot or scanned PDF into editable grids,
// which export as .xlsx (one sheet per table), CSV or tab-separated text for pasting straight into Excel or Sheets.
import { h, button, field, toggle, dropzone, alert, clear, panel, row, busy, download, icon, copyButton, input } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { baseName } from '../../lib/files.js'
import { xlsx } from '../../lib/libs.js'
import { injectStyle, runner, readSource, fileChips, UNTRUSTED } from './_shared.js'

const SCHEMA = {
  type: 'object',
  properties: {
    tables: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, columns: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }, required: ['title', 'columns', 'rows'], additionalProperties: false } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['tables', 'warnings'],
  additionalProperties: false,
}
const CSS = `
.ai-sheet td, .ai-sheet th { white-space: nowrap; } .ai-sheet input { border: 1px solid transparent; background: transparent; color: var(--text); font: inherit; font-size: 13px; padding: 5px 6px; min-width: 90px; width: 100%; border-radius: 6px; }
.ai-sheet th input { font-weight: 650; } .ai-sheet input:hover { border-color: var(--border); } .ai-sheet input:focus { border-color: var(--accent); background: var(--surface); outline: 0; }
`

const NUMERIC = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/
/** "1,234.50" -> 1234.5 when numbers are on; everything else stays text. Exported for tests. */
export const cellValue = (v, convert) => (convert && NUMERIC.test(String(v).trim()) ? +String(v).trim().replace(/,/g, '') : v)

/** Make every row exactly as wide as the widest row or header, naming extra columns. Exported for tests. */
export function normalizeTable(t) {
  const width = Math.max(t.columns.length, ...t.rows.map((r) => r.length), 1)
  const columns = Array.from({ length: width }, (_, i) => (t.columns[i] ?? '').trim() || `Column ${i + 1}`)
  return { title: t.title || 'Table', columns, rows: t.rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')) }
}

export function mount(root, { signal }) {
  injectStyle()
  if (!document.getElementById('ai-sheet-style')) document.head.append(h('style', { id: 'ai-sheet-style' }, CSS))
  let source = null
  let file = null
  let tables = []
  const status = h('div')
  const out = h('div', { class: 'stack' })
  const chips = h('div')
  const zone = dropzone({ accept: 'image/*,.heic,.heif,.pdf,application/pdf', label: 'Drop a photo, screenshot or scanned table', icon: 'table', hint: 'JPG, PNG, WebP, HEIC or PDF · or paste with Ctrl+V',
    onFiles: async ([f]) => { clear(status); try { source = await readSource(f, { allow: ['pdf', 'image'] }); file = f; clear(chips, fileChips([source], () => { source = null; clear(chips); go.disabled = true })); go.disabled = false; zone.classList.add('compact') } catch (e) { source = null; go.disabled = true; clear(status, alert('error', e.message)) } } })
  const convert = toggle('Turn numbers into real numbers (1,234.50 becomes 1234.5)', true)
  const hint = input({ placeholder: 'Optional: what to extract, e.g. "only the second table" or "skip the totals row"', maxlength: 200, 'aria-label': 'Extraction hint' })
  const go = button('Extract table', { icon: 'table', variant: 'primary', size: 'lg', disabled: true })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Reading the table' })

  const tsv = (t) => [t.columns, ...t.rows].map((r) => r.join('\t')).join('\n')
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = (t) => [t.columns, ...t.rows].map((r) => r.map(csvCell).join(',')).join('\n')
  const sheetName = (t, i) => (t.title.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || `Table ${i + 1}`)

  function render(warnings) {
    clear(out,
      warnings.length ? alert('warn', h('strong', 'Check these: '), warnings.join(' ')) : null,
      row(button('Excel (.xlsx)', { icon: 'download', variant: 'primary', size: 'sm', onClick: (e) => busy(e.currentTarget, async () => {
        const X = await xlsx()
        const wb = X.utils.book_new()
        const used = new Set()
        tables.forEach((t, i) => {
          let name = sheetName(t, i), k = 2
          while (used.has(name.toLowerCase())) name = `${sheetName(t, i).slice(0, 25)} ${k++}`
          used.add(name.toLowerCase())
          X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([t.columns, ...t.rows.map((r) => r.map((c) => cellValue(c, convert.input.checked)))]), name)
        })
        download(new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${baseName(file.name)}.xlsx`)
      }, 'Excel') })),
      ...tables.map(tablePanel))
  }

  function gridOf(t) {
    const head = h('tr', t.columns.map((c, ci) => h('th', h('input', { value: c, 'aria-label': `Column ${ci + 1} name`, oninput: (e) => { t.columns[ci] = e.target.value } }))))
    const body = t.rows.map((r, ri) => h('tr', r.map((c, ci) => h('td', h('input', { value: c, 'aria-label': `Row ${ri + 1}, ${t.columns[ci]}`, oninput: (e) => { r[ci] = e.target.value } })))))
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table ai-sheet' }, h('thead', head), h('tbody', body)))
  }

  function tablePanel(t, ti) {
    const csvBtn = button('CSV', { icon: 'download', size: 'sm', onClick: () => download(csv(t), `${baseName(file.name)}${tables.length > 1 ? `-${ti + 1}` : ''}.csv`, 'text/csv') })
    return panel(h('div', { class: 'stack' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0' }, t.title), h('div', { class: 'row' }, copyButton(() => tsv(t), 'Copy for Excel'), csvBtn)),
      h('p', { class: 'small muted', style: 'margin:0' }, `${t.rows.length} rows, ${t.columns.length} columns. Click any cell to correct it.`),
      gridOf(t)))
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    clear(out)
    const system = `You read tables from images and documents. ${UNTRUSTED} Reproduce each table exactly as shown: every row and column, in order, with the header names as columns. Merged cells: repeat the value or leave the cell empty, whichever matches how a spreadsheet would hold it. Keep cell text exactly as printed (numbers with their separators, dates as shown, no calculations, no currency conversion). Use an empty string for blank cells and put a short title on each table (its caption or what it contains). If a table has no header row, invent neutral names like "Column 1". Mention anything illegible or uncertain in warnings.`
    const res = await ai.ask({ system, json: SCHEMA, effort: 'low', signal: sig, messages: [{ role: 'user', content: [...await source.blocks(), ai.textBlock(`Extract every table.${hint.value.trim() ? ` Hint: ${hint.value.trim()}.` : ''}`)] }] })
    tables = (res.tables || []).filter((t) => t?.columns?.length || t?.rows?.length).map(normalizeTable)
    if (!tables.length) throw new Error('No table was found in that file. Try a sharper or closer photo.')
    render(res.warnings || [])
  }, { label: 'Reading the table' }))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    panel(h('div', { class: 'stack' }, zone, chips, field('Hint (optional)', hint), convert, row(go, run.stop), status,
      h('p', { class: 'small muted' }, 'Works on printed tables, screenshots and neat handwritten tables. Check the numbers in the grid before you export.'))),
    out))
  clear(out, h('div', { class: 'empty' }, icon('table'), h('strong', { style: 'color:var(--text-2)' }, 'Your table appears here as an editable grid'), h('div', 'Add a picture of a table, then press Extract table. Export to Excel or CSV, or copy it into a sheet.')))
}
