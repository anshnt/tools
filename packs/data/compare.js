// Compare two CSV or Excel files: rows added, removed and changed, matched by a key column or by position.
import { h, clear, button, field, toggle, number, alert, download } from '../../lib/ui.js'
import { str, num } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, chipSelect, section, tableBlob } from './_view.js'

const norm = (s) => str(s).trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Compare table a (old) with table b (new) on their shared columns.
 * o: { keys: [header names] (empty = by position), ignoreCase, trim, tol }
 */
export function compareTables(a, b, o) {
  const map = new Map(b.headers.map((x, i) => [norm(x), i]))
  const shared = a.headers.map((x, i) => ({ name: x, ia: i, ib: map.get(norm(x)) })).filter((c) => c.ib != null)
  const onlyA = a.headers.filter((x) => !map.has(norm(x)))
  const bn = new Set(a.headers.map(norm))
  const onlyB = b.headers.filter((x) => !bn.has(norm(x)))
  const keyCols = o.keys.map((k) => shared.find((c) => norm(c.name) === norm(k))).filter(Boolean)
  const cv = (v) => { let s = str(v); if (o.trim) s = s.trim().replace(/\s+/g, ' '); return o.ignoreCase ? s.toLowerCase() : s }
  const same = (x, y) => {
    if (cv(x) === cv(y)) return true
    const nx = num(x), ny = num(y)
    return nx != null && ny != null && Math.abs(nx - ny) <= (o.tol || 0)
  }
  const keyOf = (row, side, i) => (keyCols.length ? keyCols.map((c) => cv(row[side === 'a' ? c.ia : c.ib])).join('\u0001') : String(i))
  const seen = new Map()
  const idx = new Map()
  const occ = (k, m) => { const n = (m.get(k) || 0) + 1; m.set(k, n); return n > 1 ? `${k}\u0002${n}` : k }
  const bMap = new Map()
  const bSeen = new Map()
  b.rows.forEach((r, i) => bMap.set(occ(keyOf(r, 'b', i), bSeen), i))
  const used = new Set()
  const removed = [], changed = [], addedIdx = []
  let unchanged = 0
  const aSeen = new Map()
  a.rows.forEach((r, i) => {
    const k = occ(keyOf(r, 'a', i), aSeen)
    const j = bMap.get(k)
    if (j == null) { removed.push(i); return }
    used.add(j)
    const cells = []
    for (const c of shared) { const x = r[c.ia], y = b.rows[j][c.ib]; if (!same(x, y)) cells.push({ col: c.name, from: x, to: y }) }
    if (cells.length) changed.push({ ia: i, ib: j, cells })
    else unchanged++
  })
  b.rows.forEach((_, j) => { if (!used.has(j)) addedIdx.push(j) })
  return { shared, onlyA, onlyB, keyCols, removed, added: addedIdx, changed, unchanged }
}

const ARROW = ' → '

export function mount(root) {
  let files = []
  const o = { keys: [], ignoreCase: false, trim: true, tol: 0, show: ['added', 'removed', 'changed'], swap: false }
  let res = null, view = null
  const statsHost = h('div'), keyHost = h('div'), noteHost = h('div'), barHost = h('div'), chipHost = h('div')
  const preview = virtualTable({
    height: 440,
    cellClass: (ri, c) => {
      if (!view) return ''
      const m = view.meta[ri]
      if (c === 0) return m.status === 'Added' ? 'dt-good' : m.status === 'Removed' ? 'dt-bad' : m.status === 'Changed' ? 'dt-hot' : ''
      return m.cells?.has(c) ? 'dt-hot' : ''
    },
    rowClass: (ri) => (view?.meta[ri]?.status === 'Removed' ? 'dt-rowx' : ''),
  })
  const f = toolFlow({
    titles: ['Add the old file and the new file', 'Say how rows match up', 'See what changed'],
    source: { multiple: true, sample: ['sales', 'salesnew'], hint: 'Drop two files: the older one first, then the newer one. CSV, Excel or JSON.' },
    onData: (list) => { files = list; init() },
    lockText: 'Add two files first',
  })

  function pair() {
    const [a, b] = files.slice(0, 2)
    return o.swap ? [b, a] : [a, b]
  }
  function init() {
    clear(noteHost)
    if (files.length < 2) { f.s2.setState('locked'); f.s3.setState('locked'); if (files.length === 1) clear(noteHost, alert('info', 'Add one more file to compare.')); return }
    if (files.length > 2) clear(noteHost, alert('info', 'More than two files were added. Only the first two are compared.'))
    const [a, b] = pair()
    const bn = new Set(b.table.headers.map(norm))
    const common = a.table.headers.filter((x) => bn.has(norm(x)))
    const guess = common.find((x) => /(^|_| )id$|^id$|key|code|sku|email/i.test(x)) ?? ''
    o.keys = guess ? [guess] : []
    clear(keyHost, chipSelect({ items: common.map((x) => ({ value: x, label: x })), value: o.keys, bulk: false, label: 'Key columns', onChange: (v) => { o.keys = v; run() } }))
    run()
  }
  function run() {
    if (files.length < 2) return
    const [A, B] = pair()
    const a = A.table, b = B.table
    res = compareTables(a, b, o)
    const cols = res.shared
    const headers = ['Status', ...cols.map((c) => c.name)]
    const rows = [], meta = []
    const pick = (row, side, c) => row[side === 'a' ? c.ia : c.ib]
    const want = new Set(o.show)
    if (want.has('removed')) for (const i of res.removed) { rows.push(['Removed', ...cols.map((c) => pick(a.rows[i], 'a', c))]); meta.push({ status: 'Removed' }) }
    if (want.has('added')) for (const j of res.added) { rows.push(['Added', ...cols.map((c) => pick(b.rows[j], 'b', c))]); meta.push({ status: 'Added' }) }
    if (want.has('changed')) {
      for (const ch of res.changed) {
        const set = new Set()
        const row = ['Changed', ...cols.map((c, k) => { const cell = ch.cells.find((x) => x.col === c.name); if (cell) { set.add(k + 1); return `${str(cell.from)}${ARROW}${str(cell.to)}` } return pick(b.rows[ch.ib], 'b', c) })]
        rows.push(row); meta.push({ status: 'Changed', cells: set })
      }
    }
    if (want.has('same')) {
      const skip = new Set([...res.changed.map((x) => x.ia)])
      const removedSet = new Set(res.removed)
      a.rows.forEach((r, i) => { if (!skip.has(i) && !removedSet.has(i)) { rows.push(['Same', ...cols.map((c) => pick(r, 'a', c))]); meta.push({ status: 'Same' }) } })
    }
    view = { table: { headers, rows }, meta }
    preview.setTable(view.table, { types: headers.map((_, i) => 'text') })
    const total = res.removed.length + res.added.length + res.changed.length
    clear(statsHost, statTiles([
      { label: 'Added', value: res.added.length, hint: `only in ${B.name}`, accent: res.added.length > 0 }, { label: 'Removed', value: res.removed.length, hint: `only in ${A.name}`, danger: res.removed.length > 0 },
      { label: 'Changed', value: res.changed.length, hint: `${res.changed.reduce((x, y) => x + y.cells.length, 0)} cells` }, { label: 'Unchanged', value: res.unchanged },
    ]))
    const notes = []
    if (!o.keys.length) notes.push(alert('info', 'No key column is chosen, so rows are matched by position (row 1 with row 1). If rows can move around, pick a column that identifies each row, such as an ID.'))
    if (res.onlyA.length || res.onlyB.length) notes.push(alert('warn', `Columns that are not in both files are skipped.${res.onlyA.length ? ` Only in the old file: ${res.onlyA.join(', ')}.` : ''}${res.onlyB.length ? ` Only in the new file: ${res.onlyB.join(', ')}.` : ''}`))
    if (!total) notes.push(alert('success', 'No differences found. The files match on every shared column.'))
    clear(noteHost, notes)
    const log = () => {
      const lh = ['Status', ...res.keyCols.map((c) => c.name), 'Column', 'Before', 'After']
      const lr = []
      const keyVals = (row, side) => res.keyCols.map((c) => pick(row, side, c))
      for (const i of res.removed) lr.push(['Removed', ...keyVals(a.rows[i], 'a'), '(whole row)', cols.map((c) => str(pick(a.rows[i], 'a', c))).join(' | '), ''])
      for (const j of res.added) lr.push(['Added', ...keyVals(b.rows[j], 'b'), '(whole row)', '', cols.map((c) => str(pick(b.rows[j], 'b', c))).join(' | ')])
      for (const ch of res.changed) for (const cell of ch.cells) lr.push(['Changed', ...keyVals(b.rows[ch.ib], 'b'), cell.col, cell.from, cell.to])
      return { headers: lh, rows: lr }
    }
    clear(barHost, exportBar({
      items: [], formats: ['csv', 'xlsx'], getTable: () => view.table, name: () => 'comparison', copy: false,
      extra: [button('Download change log', { icon: 'list-checks', variant: 'secondary', onClick: async () => download(await tableBlob(log(), 'csv'), 'change-log.csv') })],
      note: 'The change log lists one line per changed cell',
    }))
  }

  const swapBtn = button('Swap old and new', { icon: 'arrow-left-right', variant: 'ghost', size: 'sm', onClick: () => { o.swap = !o.swap; init() } })
  f.s2.body.append(h('div', { class: 'panel stack' },
    section('Match rows by', 'key-round', keyHost, h('p', { class: 'small muted' }, 'Pick the column (or columns) that identify a row. Leave all unselected to match by position.')),
    h('hr', { class: 'divider' }),
    h('div', { class: 'row' }, toggle('Ignore upper / lower case', false, (v) => { o.ignoreCase = v; run() }), toggle('Ignore extra spaces', true, (v) => { o.trim = v; run() }),
      h('div', { style: 'min-width:200px' }, field('Treat numbers as equal within', number(0, { min: 0, step: 'any', ariaLabel: 'Tolerance', onInput: (v) => { o.tol = v > 0 ? v : 0; run() } }), 'For example 0.01 ignores rounding noise.')), swapBtn)), noteHost)
  f.s3.body.append(statsHost, h('div', { class: 'stack tight' }, h('span', { class: 'small muted' }, 'Show'), chipSelect({ items: [{ value: 'added', label: 'Added' }, { value: 'removed', label: 'Removed' }, { value: 'changed', label: 'Changed' }, { value: 'same', label: 'Unchanged' }], value: o.show, bulk: false, label: 'Which rows to show', onChange: (v) => { o.show = v; run() } })), preview.el, barHost)
  root.append(f.el)
}
