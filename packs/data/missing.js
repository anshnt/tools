// Find missing values: per-column gap report with highlights, then fill (value, mean, median, mode, previous, next) or drop.
import { h, icon, clear, field, input, select, toggle, tabs, number } from '../../lib/ui.js'
import { inferTypes, isNumericType, isEmpty, isNullish, num, mean, median, str, plural } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, section, typeBadge, nameBase } from './_view.js'

const STRATEGIES = [['keep', 'Leave empty'], ['value', 'Fill with my value'], ['zero', 'Fill with 0'], ['mean', 'Average (mean)'], ['median', 'Median'], ['mode', 'Most common value'], ['prev', 'Previous value above'], ['next', 'Next value below'], ['drop', 'Drop the whole row']]
const NUMERIC_ONLY = new Set(['zero', 'mean', 'median'])
const roundNice = (n) => String(+n.toPrecision(12))

/** Per column: indexes of missing cells. */
export function findGaps(t, placeholders) {
  const miss = (v) => isEmpty(v) || (placeholders && isNullish(v))
  return t.headers.map((_, c) => { const idx = []; for (let i = 0; i < t.rows.length; i++) if (miss(t.rows[i][c])) idx.push(i); return idx })
}

/**
 * Apply fill and drop rules. strategy[c] is a STRATEGIES key; fillValue is used by 'value'.
 * Returns { table, filled: Map(outRow -> Set(col)), droppedRows, droppedCols, filledCells }.
 */
export function fixGaps(t, gaps, { strategy, fillValue = '', dropRowPct = 0, dropColPct = 0, types }) {
  const nc = t.headers.length, n = t.rows.length
  const missing = gaps.map((idx) => { const s = new Set(idx); return s })
  const rows = t.rows.map((r) => [...r])
  const filledSet = new Set()
  const dropRow = new Uint8Array(n)
  let filledCells = 0
  const fillCell = (i, c, v) => { rows[i][c] = v; filledSet.add(i * nc + c); filledCells++ }
  for (let c = 0; c < nc; c++) {
    const s = strategy[c] || 'keep'
    if (s === 'keep' || !gaps[c].length) continue
    if (s === 'drop') { for (const i of gaps[c]) dropRow[i] = 1; continue }
    if (s === 'value') { for (const i of gaps[c]) fillCell(i, c, fillValue); continue }
    if (s === 'zero') { for (const i of gaps[c]) fillCell(i, c, '0'); continue }
    if (s === 'prev') { let last = null; for (let i = 0; i < n; i++) { if (missing[c].has(i)) { if (last != null) fillCell(i, c, last) } else last = rows[i][c] } continue }
    if (s === 'next') { let nxt = null; for (let i = n - 1; i >= 0; i--) { if (missing[c].has(i)) { if (nxt != null) fillCell(i, c, nxt) } else nxt = rows[i][c] } continue }
    const present = []
    for (let i = 0; i < n; i++) if (!missing[c].has(i)) present.push(t.rows[i][c])
    let v = ''
    if (s === 'mean' || s === 'median') {
      const nums = present.map(num).filter((x) => x != null)
      if (!nums.length) continue
      v = roundNice(s === 'mean' ? mean(nums) : median(nums.sort((a, b) => a - b)))
    } else if (s === 'mode') {
      const f = new Map()
      for (const x of present) { const k = str(x); f.set(k, (f.get(k) || 0) + 1) }
      let best = null, bc = 0
      for (const [k, cnt] of f) if (cnt > bc) { best = k; bc = cnt }
      if (best == null) continue
      v = best
    }
    for (const i of gaps[c]) fillCell(i, c, v)
  }
  if (dropRowPct > 0) {
    for (let i = 0; i < n; i++) { let m = 0; for (let c = 0; c < nc; c++) if (missing[c].has(i)) m++; if (nc && (m / nc) * 100 > dropRowPct) dropRow[i] = 1 }
  }
  const keepCols = []
  for (let c = 0; c < nc; c++) if (!(dropColPct > 0 && n && (gaps[c].length / n) * 100 > dropColPct)) keepCols.push(c)
  const outRows = [], filled = new Map()
  let droppedRows = 0
  for (let i = 0; i < n; i++) {
    if (dropRow[i]) { droppedRows++; continue }
    const k = outRows.length
    outRows.push(keepCols.map((c) => rows[i][c]))
    keepCols.forEach((c, j) => { if (filledSet.has(i * nc + c)) { if (!filled.has(k)) filled.set(k, new Set()); filled.get(k).add(j) } })
  }
  return { table: { headers: keepCols.map((c) => t.headers[c]), rows: outRows }, filled, droppedRows, droppedCols: nc - keepCols.length, filledCells, keepCols }
}

export function mount(root) {
  let entry = null, types = [], gaps = [], res = null
  const o = { placeholders: true, fillValue: 'Unknown', dropRowPct: 0, dropColPct: 0, onlyGaps: false }
  let strategy = []
  const statsHost = h('div'), colsHost = h('div', { class: 'stack tight' }), barHost = h('div'), tabHost = h('div')
  const before = virtualTable({ height: 420, cellClass: (ri, c) => (missSet.has(ri * 1e4 + c) ? 'dt-hot' : '') })
  const after = virtualTable({ height: 420, cellClass: (ri, c) => (res?.filled.get(ri)?.has(c) ? 'dt-good' : '') })
  let missSet = new Set()
  const f = toolFlow({
    titles: ['Add your data', 'Find the gaps', 'Fill or drop them, then download'],
    source: { sample: 'missing' },
    onData: (e) => { entry = e; if (e) init() },
  })

  function init() {
    types = inferTypes(entry.table)
    strategy = entry.table.headers.map(() => 'keep')
    scan()
    fix()
  }
  function scan() {
    const t = entry.table
    gaps = findGaps(t, o.placeholders)
    missSet = new Set()
    const nc = t.headers.length
    if (nc < 10000) for (let c = 0; c < nc; c++) for (const i of gaps[c]) missSet.add(i * 1e4 + c)
    const total = gaps.reduce((a, g) => a + g.length, 0)
    const cells = t.rows.length * nc
    const rowsWith = new Set(gaps.flat()).size
    clear(statsHost, statTiles([
      { label: 'Missing cells', value: total, accent: true, hint: cells ? `${((total / cells) * 100).toFixed(1)}% of all cells` : undefined, danger: cells > 0 && total / cells > 0.2 },
      { label: 'Rows with gaps', value: rowsWith, hint: `of ${t.rows.length.toLocaleString()}` }, { label: 'Complete rows', value: t.rows.length - rowsWith },
      { label: 'Columns with gaps', value: gaps.filter((g) => g.length).length, hint: `of ${nc}` },
    ]))
    clear(colsHost, t.headers.map((name, c) => {
      const pct = t.rows.length ? (gaps[c].length / t.rows.length) * 100 : 0
      const numericOk = isNumericType(types[c])
      const opts = STRATEGIES.filter(([k]) => numericOk || !NUMERIC_ONLY.has(k))
      return h('div', { class: ['dt-miss', gaps[c].length === 0 && 'ok'] },
        h('div', { class: 'dt-miss-name' }, h('b', { title: name }, name), typeBadge(types[c])),
        h('div', { class: 'dt-miss-bar', title: `${pct.toFixed(1)}% missing` }, h('i', { style: `width:${Math.max(pct, gaps[c].length ? 1.5 : 0)}%` })),
        h('div', { class: 'dt-miss-n' }, gaps[c].length ? `${gaps[c].length.toLocaleString()} missing (${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%)` : icon('check')),
        gaps[c].length ? select(opts, strategy[c], (v) => { strategy[c] = v; fix() }) : h('span', { class: 'small muted' }, 'Complete'))
    }))
    before.setTable(t, { types })
  }
  function fix() {
    if (!entry) return
    const t = entry.table
    res = fixGaps(t, gaps, { strategy, fillValue: o.fillValue, dropRowPct: o.dropRowPct, dropColPct: o.dropColPct, types })
    after.setTable(res.table, { types: res.keepCols.map((c) => types[c]) })
    const remaining = findGaps(res.table, o.placeholders).reduce((a, g) => a + g.length, 0)
    clear(tabHost, tabs([
      { id: 'b', label: 'Original, gaps highlighted', render: () => before.el },
      { id: 'a', label: 'After fixing', render: () => after.el },
    ], res.filledCells || res.droppedRows || res.droppedCols ? 'a' : 'b'))
    clear(barHost, h('div', { class: 'stack' }, statTiles([
      { label: 'Cells filled', value: res.filledCells, accent: true }, { label: 'Rows dropped', value: res.droppedRows }, { label: 'Columns dropped', value: res.droppedCols }, { label: 'Gaps left', value: remaining },
    ]), exportBar({ getTable: () => res.table, name: () => `${nameBase(entry)}-filled`, note: res.filledCells ? 'Filled cells are green in the preview' : undefined })))
  }
  const applyAll = (v) => { strategy = entry.table.headers.map((_, c) => (!gaps[c].length ? 'keep' : NUMERIC_ONLY.has(v) && !isNumericType(types[c]) ? 'keep' : v)); scan(); fix() }

  f.s2.body.append(h('div', { class: 'panel stack' }, toggle('Count placeholders like N/A, null, - and none as missing', true, (v) => { o.placeholders = v; scan(); fix() })), statsHost, tabHost)
  f.s3.body.append(h('div', { class: 'panel stack' },
    section('Fix column by column', 'wand-sparkles',
      h('div', { class: 'dt-grid' },
        field('Set every column with gaps to', select([['', 'Choose...'], ...STRATEGIES.filter(([k]) => k !== 'drop')], '', (v) => { if (v) applyAll(v) })),
        field('Text for "Fill with my value"', input({ value: o.fillValue, oninput: (e) => { o.fillValue = e.target.value; fix() } }))),
      colsHost),
    h('hr', { class: 'divider' }),
    section('Or drop the worst offenders', 'trash-2', h('div', { class: 'dt-grid' },
      field('Drop rows with more than this % missing', number(0, { min: 0, max: 100, step: 5, placeholder: '0 = off', ariaLabel: 'Row threshold', onInput: (v) => { o.dropRowPct = v > 0 ? v : 0; fix() } }), '0 keeps every row. 50 drops rows that are more than half empty.'),
      field('Drop columns with more than this % missing', number(0, { min: 0, max: 100, step: 5, placeholder: '0 = off', ariaLabel: 'Column threshold', onInput: (v) => { o.dropColPct = v > 0 ? v : 0; fix() } }), '0 keeps every column.')))), barHost)
  root.append(h('style', {}, `
.dt-miss { display: grid; grid-template-columns: minmax(130px, 1.3fr) minmax(80px, 1.6fr) minmax(110px, auto) minmax(150px, 1fr); gap: 12px; align-items: center; padding: 8px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); }
.dt-miss.ok { opacity: .7; }
.dt-miss-name { display: flex; flex-direction: column; min-width: 0; }
.dt-miss-name b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13.5px; }
.dt-miss-bar { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--success) 35%, var(--surface-3)); overflow: hidden; }
.dt-miss-bar > i { display: block; height: 100%; background: var(--warning); border-radius: inherit; animation: dtGrow .7s var(--ease) both; transform-origin: left; }
.dt-miss-n { font-size: 12.5px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.dt-miss-n .icon { color: var(--success); }
.dt-miss .select { height: 36px; font-size: 13.5px; }
@keyframes dtGrow { from { transform: scaleX(0); } }
@media (max-width: 720px) { .dt-miss { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .dt-miss-bar { grid-column: 1 / -1; order: 3; } }
`), f.el)
}
