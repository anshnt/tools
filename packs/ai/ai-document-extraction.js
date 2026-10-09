// AI document data extraction: invoices, receipts, bank statements, ID cards, business cards or custom fields.
// A template becomes a JSON schema (structured output), several files can be processed in a batch, results are editable
// in a table with simple consistency checks, and export as CSV, JSON or Excel.
import { h, button, field, textarea, input, dropzone, fileList, alert, clear, panel, row, progress, busy, download, icon, isAbort, errorMessage, segmented } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import {  } from '../../lib/files.js'
import { xlsx } from '../../lib/libs.js'
import { injectStyle, runner, readSource, UNTRUSTED } from './_shared.js'

// field: [key, label, type]  (type: 's' text, 'n' number)
export const TEMPLATES = {
  invoice: {
    label: 'Invoice', icon: 'receipt-text',
    fields: [['vendor_name', 'Vendor', 's'], ['vendor_address', 'Vendor address', 's'], ['vendor_tax_id', 'Vendor tax ID (GSTIN/VAT)', 's'], ['bill_to', 'Billed to', 's'], ['invoice_number', 'Invoice number', 's'], ['invoice_date', 'Invoice date (YYYY-MM-DD)', 's'], ['due_date', 'Due date (YYYY-MM-DD)', 's'], ['currency', 'Currency (ISO code)', 's'], ['subtotal', 'Subtotal', 'n'], ['tax', 'Tax total', 'n'], ['total', 'Total', 'n']],
    items: [['description', 'Description', 's'], ['quantity', 'Qty', 'n'], ['unit_price', 'Unit price', 'n'], ['amount', 'Amount', 'n']],
  },
  receipt: {
    label: 'Receipt', icon: 'receipt',
    fields: [['merchant', 'Merchant', 's'], ['merchant_address', 'Address', 's'], ['date', 'Date (YYYY-MM-DD)', 's'], ['time', 'Time', 's'], ['payment_method', 'Payment method', 's'], ['currency', 'Currency (ISO code)', 's'], ['subtotal', 'Subtotal', 'n'], ['tax', 'Tax', 'n'], ['tip', 'Tip', 'n'], ['total', 'Total', 'n']],
    items: [['description', 'Item', 's'], ['quantity', 'Qty', 'n'], ['amount', 'Price', 'n']],
  },
  bank: {
    label: 'Bank statement', icon: 'landmark', sensitive: true,
    fields: [['bank_name', 'Bank', 's'], ['account_holder', 'Account holder', 's'], ['account_last4', 'Account number (last 4 digits only)', 's'], ['period_start', 'Period start (YYYY-MM-DD)', 's'], ['period_end', 'Period end (YYYY-MM-DD)', 's'], ['currency', 'Currency (ISO code)', 's'], ['opening_balance', 'Opening balance', 'n'], ['closing_balance', 'Closing balance', 'n']],
    items: [['date', 'Date (YYYY-MM-DD)', 's'], ['description', 'Description', 's'], ['debit', 'Debit', 'n'], ['credit', 'Credit', 'n'], ['balance', 'Balance', 'n']],
  },
  id: {
    label: 'ID card', icon: 'id-card', sensitive: true,
    fields: [['document_type', 'Document type', 's'], ['full_name', 'Full name', 's'], ['id_number', 'ID number', 's'], ['date_of_birth', 'Date of birth (YYYY-MM-DD)', 's'], ['gender', 'Gender', 's'], ['nationality', 'Nationality', 's'], ['address', 'Address', 's'], ['issue_date', 'Issue date (YYYY-MM-DD)', 's'], ['expiry_date', 'Expiry date (YYYY-MM-DD)', 's'], ['issuing_authority', 'Issuing authority', 's']],
  },
  card: {
    label: 'Business card', icon: 'contact',
    fields: [['name', 'Name', 's'], ['job_title', 'Job title', 's'], ['company', 'Company', 's'], ['email', 'Email', 's'], ['phone', 'Phone', 's'], ['website', 'Website', 's'], ['address', 'Address', 's'], ['linkedin', 'LinkedIn / social', 's']],
  },
  custom: { label: 'Custom fields', icon: 'list-plus', fields: [] },
}

const snake = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field'
const NUM = { anyOf: [{ type: 'number' }, { type: 'null' }] }
const typeOf = (t) => (t === 'n' ? NUM : { type: 'string' })

/** Template (+ custom field lists) -> {fields, items, schema}. Exported for tests. */
export function buildTemplate(id, custom = { fields: '', columns: '' }) {
  let { fields, items } = TEMPLATES[id]
  if (id === 'custom') {
    const names = custom.fields.split(/\n|,/).map((s) => s.trim()).filter(Boolean)
    const seen = new Set()
    const uniq = (n) => { let k = snake(n), i = 2; while (seen.has(k)) k = `${snake(n)}_${i++}`; seen.add(k); return k }
    fields = names.map((n) => [uniq(n), n, 's'])
    const cols = custom.columns.split(/\n|,/).map((s) => s.trim()).filter(Boolean)
    items = cols.length ? cols.map((n) => [snake(n), n, 's']) : undefined
  }
  const props = {}
  for (const [k, label, t] of fields) props[k] = { ...typeOf(t), description: label }
  if (items) props.line_items = { type: 'array', description: 'Repeating rows', items: { type: 'object', properties: Object.fromEntries(items.map(([k, label, t]) => [k, { ...typeOf(t), description: label }])), required: items.map((i) => i[0]), additionalProperties: false } }
  props.notes = { type: 'string', description: 'Anything unclear, illegible or ambiguous (empty if none)' }
  return { fields, items, schema: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false } }
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** Consistency checks on extracted invoice/receipt numbers. Returns human-readable problems. Exported for tests. */
export function checks(id, d) {
  const out = []
  if (id !== 'invoice' && id !== 'receipt') return out
  const items = d.line_items || []
  const sum = items.reduce((s, i) => s + (n(i.amount) ?? (n(i.quantity) != null && n(i.unit_price) != null ? i.quantity * i.unit_price : 0)), 0)
  const near = (a, b) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.005)
  const sub = n(d.subtotal), tax = n(d.tax) ?? 0, tip = n(d.tip) ?? 0, tot = n(d.total)
  if (items.length && sub != null && !near(sum, sub)) out.push(`Line items add up to ${sum.toFixed(2)} but the subtotal is ${sub}`)
  if (sub != null && tot != null && !near(sub + tax + tip, tot)) out.push(`Subtotal + tax${id === 'receipt' ? ' + tip' : ''} is ${(sub + tax + tip).toFixed(2)} but the total is ${tot}`)
  if (!items.length && sub == null && tot == null) out.push('No amounts found')
  return out
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const toCsv = (columns, rows) => [columns.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','))].join('\n')

const CSS = `
.ai-grid td, .ai-grid th { white-space: nowrap; } .ai-grid input { border: 1px solid transparent; background: transparent; color: var(--text); font: inherit; font-size: 13px; padding: 5px 6px; min-width: 90px; width: 100%; border-radius: 6px; }
.ai-grid input:hover { border-color: var(--border); } .ai-grid input:focus { border-color: var(--accent); background: var(--surface); outline: 0; }
.ai-grid input.num { text-align: right; font-variant-numeric: tabular-nums; min-width: 70px; }
.ai-state { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; }
`

export function mount(root, { signal }) {
  injectStyle()
  if (!document.getElementById('ai-ext-style')) document.head.append(h('style', { id: 'ai-ext-style' }, CSS))
  let tplId = 'invoice'
  let results = [] // {file, status, data, error}
  const list = fileList({ sortable: false, onChange: () => update() })
  const status = h('div')
  const out = h('div', { class: 'stack' })
  const prog = progress()
  const zone = dropzone({ accept: 'image/*,.heic,.heif,.pdf,application/pdf', multiple: true, label: 'Drop invoices, receipts, cards or scans', icon: 'file-scan', hint: 'PDF or photos · several at once · or paste with Ctrl+V', onFiles: (f) => list.add(f.filter((x) => !list.files.some((y) => y.name === x.name && y.size === x.size))) })
  const tpl = segmented(Object.entries(TEMPLATES).map(([k, t]) => [k, t.label]), 'invoice', (v) => { tplId = v; sync() }, 'Document type')
  const customFields = textarea({ rows: 4, placeholder: 'One field per line, e.g.\nPatient name\nDate of birth\nDiagnosis', 'aria-label': 'Fields to extract' })
  const customCols = input({ placeholder: 'Optional table columns, e.g. Medicine, Dose, Days', 'aria-label': 'Table columns' })
  const customBox = h('div', { class: 'stack', hidden: true }, field('Fields to extract', customFields), field('Repeating rows (optional)', customCols))
  const warn = h('div')
  const go = button('Extract data', { icon: 'file-scan', variant: 'primary', size: 'lg', disabled: true })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Extracting' })

  function sync() {
    customBox.hidden = tplId !== 'custom'
    clear(warn, TEMPLATES[tplId].sensitive ? alert('warn', h('strong', 'Sensitive document. '), 'The file is sent to the AI provider you chose. Crop or cover anything you do not need, and delete the results when you are done.') : null)
  }
  function update() { go.disabled = !list.files.length; zone.classList.toggle('compact', list.files.length > 0) }

  const tableOf = (cols, rows, withFile, onEdit) => h('div', { class: 'table-wrap' }, h('table', { class: 'table ai-grid' },
    h('thead', h('tr', withFile && h('th', 'File'), cols.map((c) => h('th', { class: c.num && 'num' }, c.label)))),
    h('tbody', rows.map((r) => h('tr', withFile && h('td', { title: r.file }, r.file),
      cols.map((c) => h('td', { class: c.num && 'num' }, h('input', { class: c.num ? 'num' : '', value: r.row[c.key] ?? '', 'aria-label': `${c.label} (${r.file})`,
        oninput: (e) => { const v = e.target.value; r.row[c.key] = c.num ? (v.trim() === '' ? null : Number.isFinite(+v.replace(/,/g, '')) ? +v.replace(/,/g, '') : v) : v; onEdit?.(r) } }))))))))

  function renderResults(t) {
    const done = results.filter((r) => r.status === 'done')
    const cols = [...t.fields.map(([key, label, ty]) => ({ key, label: label.replace(/ \(.*\)$/, ''), num: ty === 'n' })), { key: 'notes', label: 'Notes' }]
    const itemCols = t.items?.map(([key, label, ty]) => ({ key, label, num: ty === 'n' }))
    const docRows = done.map((r) => ({ file: r.file.name, row: r.data }))
    const itemRows = done.flatMap((r) => (r.data.line_items || []).map((it) => ({ file: r.file.name, row: it })))
    const flag = (r) => { const c = checks(tplId, r.data); return c.length ? h('span', { class: 'ai-state', style: 'color:var(--warning)', title: c.join('\n') }, icon('triangle-alert'), `${c.length} to check`) : h('span', { class: 'ai-state', style: 'color:var(--success)' }, icon('circle-check'), 'OK') }
    const statusLine = h('div', { class: 'stack', style: 'gap:6px' }, results.map((r) => h('div', { class: 'row', style: 'justify-content:space-between;font-size:13.5px' },
      h('span', { style: 'overflow-wrap:anywhere' }, r.file.name),
      r.status === 'error' ? h('span', { class: 'ai-state', style: 'color:var(--danger)', title: r.error }, icon('circle-alert'), `Failed: ${r.error.slice(0, 90)}`)
        : r.status === 'done' ? flag(r) : h('span', { class: 'ai-state muted' }, r.status === 'running' ? 'Reading...' : 'Waiting'))))
    const exportBtns = h('div', { class: 'row', style: 'gap:8px' },
      button('CSV', { icon: 'download', size: 'sm', onClick: () => download(toCsv([{ key: 'file', label: 'File' }, ...cols], docRows.map((r) => ({ file: r.file, ...r.row }))), 'extracted-data.csv', 'text/csv') }),
      itemCols && button('Line items CSV', { icon: 'download', size: 'sm', onClick: () => download(toCsv([{ key: 'file', label: 'File' }, ...itemCols], itemRows.map((r) => ({ file: r.file, ...r.row }))), 'extracted-line-items.csv', 'text/csv') }),
      button('JSON', { icon: 'download', size: 'sm', onClick: () => download(JSON.stringify(done.map((r) => ({ file: r.file.name, ...r.data })), null, 2), 'extracted-data.json', 'application/json') }),
      button('Excel', { icon: 'download', size: 'sm', onClick: (e) => busy(e.currentTarget, async () => {
        const X = await xlsx()
        const wb = X.utils.book_new()
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet(docRows.map((r) => ({ File: r.file, ...Object.fromEntries(cols.map((c) => [c.label, r.row[c.key] ?? null])) }))), 'Documents')
        if (itemCols && itemRows.length) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(itemRows.map((r) => ({ File: r.file, ...Object.fromEntries(itemCols.map((c) => [c.label, r.row[c.key] ?? null])) }))), 'Line items')
        download(new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'extracted-data.xlsx')
      }, 'Excel') }))
    clear(out, panel(h('div', { class: 'stack' }, h('h2', 'Results'), statusLine)),
      done.length ? h('div', { class: 'stack' },
        exportBtns,
        panel(h('div', { class: 'stack' }, h('h2', 'Documents'), h('p', { class: 'small muted', style: 'margin:0' }, 'Click any cell to correct it before exporting.'), tableOf(cols, docRows, true))),
        itemCols && itemRows.length ? panel(h('div', { class: 'stack' }, h('h2', 'Line items'), tableOf(itemCols, itemRows, true))) : null) : null)
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    const files = [...list.files]
    if (tplId === 'custom' && !customFields.value.trim()) throw new Error('List the fields you want extracted, one per line.')
    const t = buildTemplate(tplId, { fields: customFields.value, columns: customCols.value })
    results = files.map((file) => ({ file, status: 'queued', data: null, error: '' }))
    list.setDisabled(true)
    renderResults(t)
    const system = `You extract structured data from business documents (${TEMPLATES[tplId].label.toLowerCase()}). ${UNTRUSTED}
Copy exactly what is printed: never guess or calculate missing values; use an empty string or null when something is absent. Write dates as YYYY-MM-DD, amounts as plain numbers (no currency symbols or thousands separators; use a dot for decimals), currency as an ISO code, and keep the original language and spelling of names and descriptions. List line items in the order shown. Put anything unclear or illegible in notes. If the file is not a ${TEMPLATES[tplId].label.toLowerCase()}, still fill what you can and say so in notes.`
    try {
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        prog.set(i / results.length, `Reading ${r.file.name} (${i + 1} of ${results.length})`)
        r.status = 'running'; renderResults(t)
        try {
          const src = await readSource(r.file, { allow: ['pdf', 'image'] })
          const data = await ai.ask({ system, json: t.schema, effort: 'low', signal: sig, messages: [{ role: 'user', content: [...await src.blocks(), ai.textBlock('Extract the data from this document.')] }] })
          r.data = data; r.status = 'done'
        } catch (e) {
          if (isAbort(e)) { r.status = 'error'; r.error = 'Stopped'; throw e }
          r.status = 'error'; r.error = errorMessage(e)
        }
        renderResults(t)
      }
    } finally { list.setDisabled(false); renderResults(t) }
  }, { label: 'Extracting', progress: prog }))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    panel(h('div', { class: 'stack' }, zone, list.el, field('Document type', tpl), customBox, warn, row(go, run.stop), prog.el, status,
      h('p', { class: 'small muted' }, 'AI reads the layout, so photos, scans and different formats all work. Always check the numbers: the table flags totals that do not add up.'))),
    out))
  sync()
  clear(out, h('div', { class: 'empty' }, icon('file-scan'), h('strong', { style: 'color:var(--text-2)' }, 'Extracted data appears here'), h('div', 'Add files, pick the document type and press Extract data. Export to CSV, JSON or Excel.')))
}
