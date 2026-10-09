// Split CSV: by number of rows, into equal parts, or by the values of a column. Outputs a ZIP of CSV or Excel files.
import { h, clear, segmented, toggle, field, number, select, table as uiTable, progress, alert } from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import { toCsv, str, plural, isEmpty } from './_table.js'
import { toolFlow, exportBar, statTiles, colSelect, nameBase } from './_view.js'

const MAX_VALUES = 1000
const safe = (s) => str(s).replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'blank'

/** Plan the parts: [{ label, rows }]. by: 'rows' | 'parts' | 'column'. */
export function planSplit(t, { by, size = 1000, parts = 3, col = 0 }) {
  const n = t.rows.length
  if (by === 'column') {
    const m = new Map()
    for (const r of t.rows) { const k = isEmpty(r[col]) ? '(blank)' : str(r[col]).trim(); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
    return { parts: [...m].map(([label, rows]) => ({ label, rows })), tooMany: m.size > MAX_VALUES }
  }
  const per = by === 'parts' ? Math.max(1, Math.ceil(n / Math.max(1, parts))) : Math.max(1, Math.floor(size))
  const out = []
  for (let i = 0; i < n; i += per) out.push({ label: String(out.length + 1), rows: t.rows.slice(i, i + per) })
  return { parts: out, tooMany: false }
}

export function mount(root) {
  let entry = null
  const o = { by: 'rows', size: 1000, parts: 3, col: 0, format: 'csv', header: true }
  const prog = progress('Writing files')
  const statsHost = h('div'), listHost = h('div'), barHost = h('div'), notes = h('div')
  const f = toolFlow({
    titles: ['Add the big file', 'Decide how to split it', 'Check the files and download'],
    source: { sample: 'sales' },
    onData: (e) => { entry = e; if (e) init() },
  })
  const colSel = colSelect({ headers: [], onChange: (c) => { o.col = c; run() } })
  const sizeInput = number(1000, { min: 1, step: 1, ariaLabel: 'Rows per file', onInput: (v) => { if (v >= 1) { o.size = v; run() } } })
  const partsInput = number(3, { min: 1, step: 1, ariaLabel: 'Number of files', onInput: (v) => { if (v >= 1) { o.parts = v; run() } } })
  const sizeField = field('Rows in each file', sizeInput), partsField = field('Number of files', partsInput), colField = field('Split by column', colSel, 'One file for each different value.')

  function init() {
    const n = entry.table.rows.length
    colSel.setHeaders(entry.table.headers, false)
    o.col = 0
    o.size = Math.max(1, n > 40 ? Math.ceil(n / 4 / 10) * 10 : Math.ceil(n / 3))
    sizeInput.value = o.size
    run()
  }
  const fileName = (p, i, ext) => `${nameBase(entry)}-${o.by === 'column' ? safe(p.label) : `part-${String(i + 1).padStart(String(plan.parts.length).length, '0')}`}.${ext}`
  let plan = { parts: [] }
  function run() {
    if (!entry) return
    sizeField.hidden = o.by !== 'rows'; partsField.hidden = o.by !== 'parts'; colField.hidden = o.by !== 'column'
    plan = planSplit(entry.table, o)
    clear(notes, plan.tooMany ? alert('warn', `That column has more than ${MAX_VALUES.toLocaleString()} different values. Pick a column with fewer groups, or split by row count.`) : null)
    const ext = o.format
    clear(statsHost, statTiles([{ label: 'Files', value: plan.parts.length, accent: true }, { label: 'Rows in total', value: entry.table.rows.length },
      { label: 'Largest file', value: plan.parts.reduce((a, p) => Math.max(a, p.rows.length), 0), hint: 'rows' }, { label: 'Smallest file', value: plan.parts.length ? plan.parts.reduce((a, p) => Math.min(a, p.rows.length), Infinity) : 0, hint: 'rows' }]))
    clear(listHost, plan.parts.length ? uiTable({ columns: ['File', { label: 'Rows', num: true }, ...(o.by === 'column' ? [entry.table.headers[o.col]] : [])], rows: plan.parts.map((p, i) => [fileName(p, i, ext), p.rows.length.toLocaleString(), ...(o.by === 'column' ? [p.label] : [])]), max: 300 }) : null)
    clear(barHost, exportBar({
      items: [{
        label: plan.parts.length === 1 ? `Download ${ext.toUpperCase()}` : `Download ZIP (${plan.parts.length} files)`, icon: 'archive', primary: true,
        make: async () => {
          if (plan.tooMany) throw new Error(`Too many groups (more than ${MAX_VALUES}). Choose another column.`)
          if (!plan.parts.length) throw new Error('There are no rows to split.')
          const t = entry.table
          const files = []
          const { buildXlsx } = ext === 'xlsx' ? await import('./_xlsx.js') : {}
          for (let i = 0; i < plan.parts.length; i++) {
            prog.set(i / plan.parts.length, `Writing file ${i + 1} of ${plan.parts.length}`)
            const p = plan.parts[i]
            const data = ext === 'xlsx' ? await buildXlsx([{ name: safe(p.label), headers: t.headers, rows: p.rows }]) : new Blob([toCsv({ headers: t.headers, rows: p.rows }, { header: o.header })], { type: 'text/csv' })
            files.push({ name: fileName(p, i, ext), data })
          }
          prog.hide()
          if (files.length === 1) return { blob: files[0].data, name: files[0].name }
          return { blob: await zip(files, (x) => prog.set(x, 'Zipping')), name: `${nameBase(entry)}-split.zip` }
        },
      }], copy: false, note: o.by === 'column' ? `One file per ${entry.table.headers[o.col]}` : undefined,
    }))
  }

  f.s2.body.append(h('div', { class: 'panel stack' },
    segmented([['rows', 'By number of rows'], ['parts', 'Into equal parts'], ['column', 'By a column value']], 'rows', (v) => { o.by = v; run() }, 'Split method'),
    h('div', { class: 'dt-grid' }, sizeField, partsField, colField, field('File type', select([['csv', 'CSV'], ['xlsx', 'Excel (.xlsx)']], 'csv', (v) => { o.format = v; run() }))),
    toggle('Repeat the header row in every file', true, (v) => { o.header = v; run() })), notes)
  f.s3.body.append(statsHost, listHost, prog.el, barHost)
  root.append(f.el)
}
