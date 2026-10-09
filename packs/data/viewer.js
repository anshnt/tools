// CSV & Excel viewer: fast virtual table with search, sort and per-column insights.
import { h, icon, clear, field, input, select, toggle, modal, button, debounce, formatNumber, yieldToMain, onCleanup, alert } from '../../lib/ui.js'
import { inferTypes, sortIndices, columnProfile, isNumericType, isEmpty, parseDate, dateMillis, fmtDate, plural } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, typeBadge, nameBase } from './_view.js'

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const fmt = (n) => (Number.isFinite(n) ? (Math.abs(n) >= 1e7 || (Math.abs(n) < 1e-3 && n !== 0) ? n.toExponential(3) : formatNumber(n, 4)) : '-')

export function mount(root) {
  let entry = null
  let types = []
  let order = null // indexes of the visible rows, or null for all
  let current = null
  let sort = null
  let token = 0
  const q = { text: '', col: -1, regex: false, matchCase: false, only: true }
  const status = h('div')
  const table = virtualTable({
    height: 560,
    onHeader: (c) => {
      sort = !sort || sort.col !== c ? { col: c, dir: 'asc' } : sort.dir === 'asc' ? { col: c, dir: 'desc' } : null
      apply(false)
    },
    label: 'Data table. Click a column header to sort.',
  })
  const searchBox = input({ type: 'search', placeholder: 'Search every cell...', 'aria-label': 'Search', autocomplete: 'off', oninput: debounce((e) => { q.text = e.target.value; apply(true) }, 180) })
  const colPick = select([['-1', 'All columns']], '-1', (v) => { q.col = +v; apply(true) })
  const cards = h('div', { class: 'dt-grid', style: 'align-items:stretch' })
  const barHost = h('div'), statsHost = h('div')

  const f = toolFlow({
    titles: ['Open a file', 'Browse, search and sort', 'Column insights'],
    source: { sample: 'sales', excelOptions: true, hint: 'CSV, TSV, Excel (.xlsx, .xls, .ods) or JSON. Big files are fine, only the visible rows are drawn.' },
    onData: (e) => { entry = e; sort = null; q.text = ''; searchBox.value = ''; if (e) load() },
  })

  function load() {
    types = inferTypes(entry.table)
    clear(colPick, [h('option', { value: '-1' }, 'All columns'), ...entry.table.headers.map((n, i) => h('option', { value: String(i) }, n))])
    q.col = -1
    colPick.value = '-1'
    table.setTable(entry.table, { types })
    order = null
    stats()
    buildBar()
    buildCards()
  }

  function matcher() {
    const t = q.text
    if (!t) return null
    if (q.regex) {
      try { return new RegExp(t, q.matchCase ? 'g' : 'gi') } catch { return 'bad' }
    }
    return new RegExp(escapeRe(t), q.matchCase ? 'g' : 'gi')
  }

  function apply(refilter) {
    if (!entry) return
    const t = entry.table
    const re = matcher()
    clear(status)
    if (re === 'bad') clear(status, alert('warn', 'That regular expression is not valid yet.'))
    if (refilter || order === undefined) {
      if (!re || re === 'bad') order = null
      else {
        const test = (v) => { if (v == null || v === '') return false; re.lastIndex = 0; return re.test(typeof v === 'string' ? v : String(v)) }
        const hits = []
        const cols = q.col >= 0 ? [q.col] : t.headers.map((_, i) => i)
        for (let i = 0; i < t.rows.length; i++) {
          const r = t.rows[i]
          for (const c of cols) if (test(r[c])) { hits.push(i); break }
        }
        order = q.only ? hits : null
      }
    }
    let view = order
    if (sort) view = sortIndices(t, [sort], { types, base: view || undefined })
    table.setSort(sort)
    table.setHighlight(re && re !== 'bad' ? new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g') : null)
    table.setOrder(view)
    const shown = view ? view.length : t.rows.length
    table.setFoot(re && re !== 'bad' ? (q.only ? `${plural(shown, 'match', 'matches')}` : 'highlighting matches') : sort ? `sorted by ${t.headers[sort.col]} (${sort.dir === 'asc' ? 'A to Z' : 'Z to A'})` : '')
    current = view
    buildBar()
  }

  function stats() {
    const t = entry.table
    let empty = 0, total = t.rows.length * t.headers.length
    for (const r of t.rows) for (const v of r) if (isEmpty(v)) empty++
    clear(status)
    clear(statsHost, statTiles([
      { label: 'Rows', value: t.rows.length, accent: true }, { label: 'Columns', value: t.headers.length },
      { label: 'Empty cells', value: empty, hint: total ? `${((empty / total) * 100).toFixed(1)}% of all cells` : undefined, danger: total > 0 && empty / total > 0.25 },
      { label: 'Number columns', value: types.filter(isNumericType).length },
    ]))
  }

  function buildBar() {
    if (!entry) return
    clear(barHost, exportBar({
      getTable: () => {
        const t = entry.table
        const idx = current || t.rows.map((_, i) => i)
        return { headers: t.headers, rows: idx.map((i) => t.rows[i]) }
      },
      name: () => `${nameBase(entry)}${current || sort ? '-view' : ''}`, formats: ['csv', 'xlsx', 'json'],
      note: current ? `Downloads the ${plural(current.length, 'visible row')}` : sort ? 'Downloads the sorted rows' : undefined,
    }))
  }

  async function buildCards() {
    const my = ++token
    const t = entry.table
    clear(cards)
    for (let c = 0; c < t.headers.length; c++) {
      if (my !== token) return
      const vals = t.rows.map((r) => r[c])
      let filled = 0
      const seen = new Set()
      for (const v of vals) { if (!isEmpty(v)) { filled++; if (seen.size < 100000) seen.add(v) } }
      const pct = t.rows.length ? filled / t.rows.length : 0
      const card = h('button', { type: 'button', class: 'dt-glow dt-colcard', onclick: () => detail(c), style: { '--i': Math.min(c, 12) } },
        h('div', { class: 'dt-cc-top' }, h('span', { class: 'dt-cc-name', title: t.headers[c] }, t.headers[c]), typeBadge(types[c])),
        h('div', { class: 'dt-cc-bar', title: `${(pct * 100).toFixed(1)}% filled` }, h('i', { style: `width:${(pct * 100).toFixed(1)}%` })),
        h('div', { class: 'dt-cc-meta' }, h('span', `${(pct * 100).toFixed(pct === 1 || pct === 0 ? 0 : 1)}% filled`), h('span', `${seen.size >= 100000 ? '100,000+' : seen.size.toLocaleString()} unique`)))
      cards.append(card)
      if (c % 6 === 5) await yieldToMain()
    }
  }

  function detail(c) {
    const t = entry.table
    const p = columnProfile(t, c, types[c])
    const rows = []
    const add = (k, v) => rows.push(h('div', { class: 'dt-kv' }, h('span', k), h('b', v)))
    add('Rows', p.count.toLocaleString()); add('Filled', `${p.filled.toLocaleString()} (${p.count ? ((p.filled / p.count) * 100).toFixed(1) : 0}%)`)
    add('Empty', p.empty.toLocaleString()); add('Unique values', p.unique.toLocaleString())
    if (p.numeric && p.numeric.count) {
      const n = p.numeric
      add('Sum', fmt(n.sum)); add('Mean', fmt(n.mean)); add('Median', fmt(n.median)); add('Min', fmt(n.min)); add('Max', fmt(n.max)); add('Std deviation', fmt(n.stdSample))
    } else if (types[c] === 'date' || types[c] === 'datetime') {
      const ms = t.rows.map((r) => (typeof r[c] === 'string' ? parseDate(r[c]) : null)).filter(Boolean).map(dateMillis)
      if (ms.length) {
        const lo = ms.reduce((a, b) => (b < a ? b : a)), hi = ms.reduce((a, b) => (b > a ? b : a))
        const day = (x) => { const d = new Date(x); return fmtDate({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds() }, types[c] === 'datetime') }
        add('Earliest', day(lo)); add('Latest', day(hi)); add('Span', `${Math.round((hi - lo) / 864e5).toLocaleString()} days`)
      }
    } else if (p.minLen != null) { add('Shortest', `${p.minLen} characters`); add('Longest', `${p.maxLen} characters`) }
    const max = p.top[0]?.[1] || 1
    const top = h('div', { class: 'dt-top' }, p.top.length ? p.top.map(([v, n]) => h('div', { class: 'dt-top-row' }, h('span', { class: 'dt-top-v', title: v }, v || '(blank)'), h('span', { class: 'dt-top-bar' }, h('i', { style: `width:${(n / max) * 100}%` })), h('span', { class: 'dt-top-n' }, n.toLocaleString()))) : h('div', { class: 'muted small' }, 'No values'))
    modal({ title: t.headers[c], icon: 'chart-no-axes-column', body: [h('div', { class: 'dt-kvs' }, rows), h('h3', { style: 'font-size:13px;color:var(--muted)' }, 'Most common values'), top], actions: [
      button('Sort A-Z', { icon: 'arrow-up-a-z', variant: 'secondary', onClick: () => { sort = { col: c, dir: 'asc' }; apply(false); document.querySelector('dialog[open]')?.close() } }),
      button('Sort Z-A', { icon: 'arrow-down-z-a', variant: 'secondary', onClick: () => { sort = { col: c, dir: 'desc' }; apply(false); document.querySelector('dialog[open]')?.close() } })] })
  }

  onCleanup(() => { token++ })
  const toolbar = h('div', { class: 'dt-toolbar' },
    h('div', { class: 'dt-search' }, icon('search'), searchBox),
    field('In', colPick),
    toggle('Only matching rows', true, (v) => { q.only = v; apply(true) }),
    toggle('Match case', false, (v) => { q.matchCase = v; apply(true) }),
    toggle('Regex', false, (v) => { q.regex = v; apply(true) }))
  f.s2.body.append(statsHost, toolbar, status, table.el, barHost)
  f.s3.body.append(h('p', { class: 'small muted' }, 'Click a column to see its numbers, most common values and gaps.'), cards)
  root.append(h('style', { id: 'dt-viewer-css' }, VIEWER_CSS), f.el)
}

const VIEWER_CSS = `
.dt-toolbar { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: flex-end; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-sm); }
.dt-search { position: relative; flex: 1 1 260px; min-width: 0; }
.dt-search .icon { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.dt-search .input { padding-left: 38px; }
.dt-toolbar .field { min-width: 150px; }
.dt-colcard { text-align: left; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); cursor: pointer; font: inherit; color: inherit; box-shadow: var(--shadow-sm); transition: transform .3s var(--ease), box-shadow .3s, border-color .3s; animation: dtIn .5s calc(var(--i, 0) * 45ms) var(--ease) both; min-width: 0; }
.dt-colcard:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.dt-cc-top { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dt-cc-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dt-cc-bar { height: 6px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
.dt-cc-bar > i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-2)); animation: dtGrow .8s var(--ease) both; transform-origin: left; }
@keyframes dtGrow { from { transform: scaleX(0); } }
.dt-cc-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.dt-kvs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.dt-kv { display: flex; justify-content: space-between; gap: 10px; padding: 9px 12px; border-radius: 11px; background: var(--surface-2); border: 1px solid var(--border); font-size: 13.5px; }
.dt-kv span { color: var(--muted); }
.dt-kv b { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; text-align: right; }
.dt-top { display: flex; flex-direction: column; gap: 7px; }
.dt-top-row { display: grid; grid-template-columns: minmax(70px, 1.2fr) minmax(0, 2fr) auto; gap: 10px; align-items: center; font-size: 13px; }
.dt-top-v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-top-bar { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
.dt-top-bar > i { display: block; height: 100%; border-radius: inherit; background: var(--accent); animation: dtGrow .7s var(--ease) both; transform-origin: left; }
.dt-top-n { color: var(--muted); font-variant-numeric: tabular-nums; }
@media (max-width: 520px) { .dt-kvs { grid-template-columns: minmax(0, 1fr); } }
`
