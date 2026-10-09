// Remove duplicate rows: pick the columns that define a duplicate, keep the first or last, see what was removed.
import { h, clear, segmented, toggle, tabs, field, input } from '../../lib/ui.js'
import { dedupeRows, toCsv, plural, isEmpty } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, chipSelect, section, nameBase } from './_view.js'

export function mount(root) {
  let entry = null
  let res = null
  const o = { cols: [], keep: 'first', ignoreCase: true, trim: true, output: 'unique' }
  const statsHost = h('div'), barHost = h('div'), chipHost = h('div'), hint = h('div', { class: 'small muted' })
  const uniq = virtualTable({ height: 400 }), gone = virtualTable({ height: 400, cellClass: (ri, c) => (o.cols.includes(c) ? 'dt-hot' : '') })
  const tabHost = h('div')
  const f = toolFlow({
    titles: ['Add your data', 'Choose what counts as a duplicate', 'Review and download'],
    source: { sample: 'duplicates', excelOptions: false },
    onData: (e) => { entry = e; if (e) init() },
  })

  function init() {
    const t = entry.table
    // Prefer an email-like column when there is one: that is usually what people mean.
    const guess = t.headers.findIndex((x) => /e-?mail/i.test(x))
    o.cols = guess >= 0 ? [guess] : t.headers.map((_, i) => i)
    clear(chipHost, chipSelect({ items: t.headers.map((n, i) => ({ value: i, label: n })), value: o.cols, onChange: (v) => { o.cols = v; run() }, label: 'Columns that must match' }))
    run()
  }

  function run() {
    if (!entry) return
    const t = entry.table
    const cols = o.cols.length ? o.cols : t.headers.map((_, i) => i)
    hint.textContent = o.cols.length === 0 || o.cols.length === t.headers.length ? 'Rows count as duplicates only when every column matches.' : `Rows count as duplicates when ${o.cols.map((i) => t.headers[i]).join(', ')} match.`
    res = dedupeRows(t, { cols, keep: o.keep, ignoreCase: o.ignoreCase, trim: o.trim })
    uniq.setTable(res.table)
    gone.setTable({ headers: t.headers, rows: res.removed })
    const flagged = (() => {
      const gs = new Set(res.removed)
      return { headers: [...t.headers, 'duplicate'], rows: t.rows.map((r) => [...r, gs.has(r) ? 'duplicate' : 'unique']) }
    })
    clear(statsHost, statTiles([
      { label: 'Rows in', value: t.rows.length }, { label: 'Unique rows kept', value: res.table.rows.length, accent: true },
      { label: 'Duplicates removed', value: res.removed.length, danger: res.removed.length > 0, hint: res.groups ? `in ${plural(res.groups, 'group')}` : 'none found' },
    ]))
    clear(tabHost, tabs([
      { id: 'u', label: `Kept (${res.table.rows.length.toLocaleString()})`, render: () => uniq.el },
      { id: 'd', label: `Removed (${res.removed.length.toLocaleString()})`, render: () => (res.removed.length ? gone.el : h('div', { class: 'empty' }, 'No duplicates found with these settings.')) },
    ]))
    clear(barHost, exportBar({
      getTable: () => (o.output === 'flag' ? flagged() : o.output === 'dups' ? { headers: t.headers, rows: res.removed } : res.table),
      name: () => `${nameBase(entry)}-${o.output === 'dups' ? 'duplicates' : o.output === 'flag' ? 'flagged' : 'unique'}`,
      note: o.output === 'unique' ? 'Downloads the unique rows' : o.output === 'dups' ? 'Downloads only the removed rows' : 'Downloads every row with a duplicate column',
    }))
  }

  f.s2.body.append(h('div', { class: 'panel stack' },
    section('Match on these columns', 'columns-3', chipHost, hint),
    h('hr', { class: 'divider' }),
    h('div', { class: 'row' },
      field('Keep', segmented([['first', 'First occurrence'], ['last', 'Last occurrence']], 'first', (v) => { o.keep = v; run() }, 'Which duplicate to keep')),
      field('Download', segmented([['unique', 'Unique rows'], ['dups', 'Only the duplicates'], ['flag', 'All rows, flagged']], 'unique', (v) => { o.output = v; run() }, 'What to download'))),
    h('div', { class: 'row' }, toggle('Ignore upper / lower case', true, (v) => { o.ignoreCase = v; run() }), toggle('Ignore extra spaces', true, (v) => { o.trim = v; run() }))))
  f.s3.body.append(statsHost, tabHost, barHost)
  root.append(f.el)
}
