// Sort & filter data (also serves sort-csv via params.focus = 'sort'): multi-level sort, filter rules and a column picker.
import { h, icon, clear, button, field, input, select, toggle, segmented } from '../../lib/ui.js'
import { inferTypes, isNumericType, sortIndices, compileFilter, FILTER_OPS, opNeedsValue, plural } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, chipSelect, section, colSelect, nameBase } from './_view.js'

const AS = [['auto', 'Detect'], ['text', 'Text'], ['number', 'Number'], ['date', 'Date']]

export function mount(root, { params }) {
  const focusSort = params.focus === 'sort'
  let entry = null, types = [], out = null
  const o = { sorts: [], rules: [], match: 'all', cs: false, cols: [] }
  const sortHost = h('div', { class: 'stack tight' }), ruleHost = h('div', { class: 'stack tight' }), colHost = h('div')
  const statsHost = h('div'), barHost = h('div')
  const preview = virtualTable({ height: 440 })
  const f = toolFlow({
    titles: [focusSort ? 'Add the file to sort' : 'Add your data', focusSort ? 'Choose how to sort' : 'Sort, filter and pick columns', 'Preview and download'],
    source: { sample: 'sales' },
    onData: (e) => { entry = e; if (e) init() },
  })

  function init() {
    const t = entry.table
    types = inferTypes(t)
    const firstNum = types.findIndex(isNumericType)
    o.sorts = [firstNum >= 0 ? { col: firstNum, dir: 'desc', as: 'auto' } : { col: 0, dir: 'asc', as: 'auto' }]
    o.rules = []
    o.cols = t.headers.map((_, i) => i)
    clear(colHost, chipSelect({ items: t.headers.map((n, i) => ({ value: i, label: n, type: types[i] })), value: o.cols, onChange: (v) => { o.cols = [...v].sort((a, b) => a - b); run() }, label: 'Columns to keep' }))
    renderSorts(); renderRules(); run()
  }

  const dirLabels = (c) => (isNumericType(types[c]) ? ['Low to high', 'High to low'] : types[c] === 'date' || types[c] === 'datetime' ? ['Oldest first', 'Newest first'] : ['A to Z', 'Z to A'])
  function renderSorts() {
    const t = entry.table
    clear(sortHost, o.sorts.map((s, i) => {
      const [asc, desc] = dirLabels(s.col)
      return h('div', { class: 'dt-rule' },
        h('span', { class: 'dt-rule-n' }, i === 0 ? 'Sort by' : 'Then by'),
        colSelect({ headers: t.headers, value: s.col, onChange: (c) => { s.col = c; renderSorts(); run() } }),
        segmented([['asc', asc], ['desc', desc]], s.dir, (v) => { s.dir = v; run() }, 'Direction'),
        select(AS, s.as, (v) => { s.as = v; run() }),
        button('', { icon: 'chevron-up', variant: 'ghost', size: 'sm', ariaLabel: 'Move up', disabled: i === 0, onClick: () => { [o.sorts[i - 1], o.sorts[i]] = [o.sorts[i], o.sorts[i - 1]]; renderSorts(); run() } }),
        button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove this sort', onClick: () => { o.sorts.splice(i, 1); renderSorts(); run() } }))
    }), button('Add another sort level', { icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => { o.sorts.push({ col: Math.min(o.sorts.length, entry.table.headers.length - 1), dir: 'asc', as: 'auto' }); renderSorts(); run() } }))
  }
  function renderRules() {
    const t = entry.table
    clear(ruleHost, o.rules.map((r, i) => {
      const v1 = input({ value: r.value ?? '', placeholder: r.op === 'in' ? 'a, b, c' : 'Value', 'aria-label': 'Filter value', oninput: (e) => { r.value = e.target.value; run() } })
      const v2 = input({ value: r.value2 ?? '', placeholder: 'and', 'aria-label': 'Second value', oninput: (e) => { r.value2 = e.target.value; run() } })
      return h('div', { class: 'dt-rule' },
        h('span', { class: 'dt-rule-n' }, i === 0 ? 'Where' : o.match === 'all' ? 'And' : 'Or'),
        colSelect({ headers: t.headers, value: r.col, onChange: (c) => { r.col = c; run() } }),
        select(FILTER_OPS, r.op, (v) => { r.op = v; renderRules(); run() }),
        opNeedsValue(r.op) ? v1 : null, r.op === 'between' ? v2 : null,
        button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove this filter', onClick: () => { o.rules.splice(i, 1); renderRules(); run() } }))
    }), h('div', { class: 'row' }, button('Add a filter', { icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => { o.rules.push({ col: 0, op: 'contains', value: '', value2: '' }); renderRules(); run() } }),
      o.rules.length > 1 ? segmented([['all', 'Match all rules'], ['any', 'Match any rule']], o.match, (v) => { o.match = v; renderRules(); run() }, 'Rule logic') : null))
  }

  function run() {
    if (!entry) return
    const t = entry.table
    const test = compileFilter(t, o.rules, { match: o.match, caseSensitive: o.cs })
    let idx = []
    for (let i = 0; i < t.rows.length; i++) if (test(t.rows[i])) idx.push(i)
    const specs = o.sorts.filter((s) => s.col >= 0)
    if (specs.length) idx = sortIndices(t, specs, { types, base: idx })
    const cols = o.cols.length ? o.cols : t.headers.map((_, i) => i)
    out = { headers: cols.map((c) => t.headers[c]), rows: idx.map((i) => cols.map((c) => t.rows[i][c])) }
    preview.setTable(out, { types: cols.map((c) => types[c]), sort: specs.length ? { col: cols.indexOf(specs[0].col), dir: specs[0].dir } : null })
    clear(statsHost, statTiles([
      { label: 'Rows shown', value: out.rows.length, accent: true, hint: `of ${t.rows.length.toLocaleString()}` }, { label: 'Rows filtered out', value: t.rows.length - out.rows.length },
      { label: 'Columns', value: out.headers.length, hint: `of ${t.headers.length}` }, { label: 'Sort levels', value: specs.length },
    ]))
    clear(barHost, exportBar({ getTable: () => out, name: () => `${nameBase(entry)}-${o.rules.length ? 'filtered' : 'sorted'}` }))
  }

  const sortSec = section('Sort', 'arrow-down-up', sortHost)
  const filterSec = section('Filter rows', 'filter', ruleHost, toggle('Match upper and lower case exactly', false, (v) => { o.cs = v; run() }))
  const colSec = section('Columns', 'columns-3', colHost)
  const box = focusSort
    ? h('div', { class: 'stack' }, h('div', { class: 'panel stack' }, sortSec),
      h('details', { class: 'dt-det' }, h('summary', icon('filter'), 'Also filter rows or pick columns'), h('div', { class: 'dt-det-body stack' }, filterSec, h('hr', { class: 'divider' }), colSec)))
    : h('div', { class: 'stack' }, h('div', { class: 'panel stack' }, sortSec, h('hr', { class: 'divider' }), filterSec, h('hr', { class: 'divider' }), colSec))
  f.s2.body.append(box)
  f.s3.body.append(statsHost, preview.el, barHost)
  root.append(h('style', {}, `
.dt-rule { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); animation: dtIn .35s var(--ease) both; }
.dt-rule > .select, .dt-rule > .input { flex: 1 1 150px; min-width: 0; width: auto; height: 38px; }
.dt-rule-n { font-size: 12.5px; font-weight: 600; color: var(--muted); min-width: 56px; }
`), f.el)
}
