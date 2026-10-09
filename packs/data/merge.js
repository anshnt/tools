// Merge CSV files: stack them with column matching, or join them on a key (inner, left, right, full).
import { h, icon, clear, segmented, toggle, field, select, tabs, alert } from '../../lib/ui.js'
import { uniqueHeaders, isEmpty, str, plural, baseOf } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, section, colSelect } from './_view.js'

const norm = (s) => str(s).trim().toLowerCase().replace(/\s+/g, ' ')

/** Stack tables on top of each other, matching columns by name (case and spacing ignored). */
export function stackTables(files, { source = false, onlyCommon = false, byPosition = false } = {}) {
  const names = []
  const cols = [] // per file: Map(normalized name -> index)
  files.forEach((f) => {
    const m = new Map()
    f.table.headers.forEach((hd, i) => { const k = byPosition ? String(i) : norm(hd); if (!m.has(k)) m.set(k, i) })
    cols.push(m)
    for (const [k, i] of m) if (!names.some((n) => n.k === k)) names.push({ k, label: byPosition ? `Column ${Number(k) + 1}` : f.table.headers[i] })
  })
  let use = names
  if (onlyCommon) use = names.filter((n) => cols.every((m) => m.has(n.k)))
  const headers = uniqueHeaders([...(source ? ['source_file'] : []), ...use.map((n) => n.label)])
  const rows = []
  files.forEach((f, fi) => {
    const idx = use.map((n) => cols[fi].get(n.k))
    for (const r of f.table.rows) rows.push([...(source ? [f.name] : []), ...idx.map((i) => (i == null ? '' : r[i]))])
  })
  return { table: { headers, rows }, matrix: use.map((n) => ({ label: n.label, present: cols.map((m) => m.has(n.k)) })), dropped: names.length - use.length }
}

/** Join b onto a. type: inner | left | right | full. Returns the table plus match diagnostics. */
export function joinTables(a, b, ka, kb, { type = 'left', ignoreCase = true, bName = 'b' } = {}) {
  const key = (v) => { const s = str(v).trim(); return ignoreCase ? s.toLowerCase() : s }
  const map = new Map()
  b.rows.forEach((r, i) => { const k = key(r[kb]); if (k === '') return; if (!map.has(k)) map.set(k, []); map.get(k).push(i) })
  const bKeep = b.headers.map((_, i) => i).filter((i) => i !== kb)
  const headers = uniqueHeaders([...a.headers, ...bKeep.map((i) => b.headers[i])])
  const blanksB = bKeep.map(() => '')
  const rows = []
  const usedB = new Set()
  let unmatchedA = 0
  for (const r of a.rows) {
    const k = key(r[ka])
    const hits = k === '' ? undefined : map.get(k)
    if (hits) for (const i of hits) { usedB.add(i); rows.push([...r, ...bKeep.map((c) => b.rows[i][c])]) }
    else { unmatchedA++; if (type === 'left' || type === 'full') rows.push([...r, ...blanksB]) }
  }
  let unmatchedB = 0
  b.rows.forEach((r, i) => {
    if (usedB.has(i)) return
    unmatchedB++
    if (type === 'right' || type === 'full') {
      const out = a.headers.map(() => '')
      out[ka] = r[kb]
      rows.push([...out, ...bKeep.map((c) => r[c])])
    }
  })
  return { table: { headers, rows }, unmatchedA, unmatchedB, matched: usedB.size }
}

export function mount(root) {
  let entries = []
  let out = null
  let modeSeg
  const o = { mode: 'stack', source: false, onlyCommon: false, byPosition: false, type: 'left', ignoreCase: true }
  let keys = []
  const statsHost = h('div'), barHost = h('div'), notes = h('div'), stackOpts = h('div'), joinOpts = h('div'), keyHost = h('div'), matrixHost = h('div')
  const preview = virtualTable({ height: 420 })
  const f = toolFlow({
    titles: ['Add two or more files', 'Stack them or join them', 'Check the result and download'],
    source: { multiple: true, sample: ['sales', 'customers'], hint: 'Drop two or more CSV or Excel files. Their order here is the order of the result.' },
    onData: (list) => { entries = list; if (list.length) init() },
  })

  function init() {
    keys = entries.map((e, i) => {
      const guess = e.table.headers.findIndex((x) => /(^|_| )id$/i.test(x) || /customer|key|email/i.test(x))
      return keys[i] >= 0 && keys[i] < e.table.headers.length ? keys[i] : Math.max(0, guess)
    })
    // Join on a column name the first two files share when there is one.
    if (entries.length > 1) {
      const names = entries[0].table.headers.map(norm)
      entries.forEach((e, i) => { if (i === 0) return; const j = e.table.headers.findIndex((x) => names.includes(norm(x)) && /id|key|code|email/i.test(x)); if (j >= 0) { keys[i] = j; keys[0] = names.indexOf(norm(e.table.headers[j])) } })
    }
    // Files that mostly share column names are meant to be stacked; files that share only a key column are meant to be joined.
    if (entries.length > 1) {
      const a = new Set(entries[0].table.headers.map(norm))
      const shared = entries.slice(1).map((e) => e.table.headers.filter((x) => a.has(norm(x))).length)
      const ratio = Math.min(...shared) / Math.max(1, Math.min(entries[0].table.headers.length, ...entries.slice(1).map((e) => e.table.headers.length)))
      o.mode = ratio >= 0.6 ? 'stack' : Math.min(...shared) >= 1 ? 'join' : 'stack'
      modeSeg.set(o.mode)
    }
    buildKeys()
    run()
  }
  function buildKeys() {
    clear(keyHost, entries.map((e, i) => field(i === 0 ? `Key column in ${e.name} (the main file)` : `Matching column in ${e.name}`, colSelect({ headers: e.table.headers, value: keys[i], onChange: (c) => { keys[i] = c; run() } }))))
  }

  function run() {
    if (!entries.length) return
    clear(notes)
    stackOpts.hidden = o.mode !== 'stack'
    joinOpts.hidden = o.mode !== 'join'
    clear(matrixHost)
    if (entries.length < 2) clear(notes, alert('info', 'Add at least one more file to merge.'))
    if (o.mode === 'stack') {
      const r = stackTables(entries, o)
      out = r.table
      const files = entries.map((e) => e.name)
      clear(matrixHost, h('div', { class: 'table-wrap', style: 'max-height:320px' }, h('table', { class: 'table dt-matrix' },
        h('thead', h('tr', h('th', 'Column in result'), files.map((n) => h('th', { title: n }, n.length > 18 ? `${n.slice(0, 16)}...` : n)))),
        h('tbody', r.matrix.map((m) => h('tr', h('td', m.label), m.present.map((p) => h('td', { class: p ? 'dt-good' : 'dt-bad', style: 'text-align:center' }, p ? icon('check') : '-'))))))))
      clear(statsHost, statTiles([{ label: 'Rows', value: out.rows.length, accent: true }, { label: 'Columns', value: out.headers.length }, { label: 'Files stacked', value: entries.length }, { label: 'Columns left out', value: r.dropped, hint: o.onlyCommon ? 'not in every file' : undefined }]))
      if (r.matrix.some((m) => !m.present.every(Boolean)) && !o.onlyCommon) clear(notes, alert('info', 'Some columns are missing from some files. Those cells are left empty.'))
    } else {
      let acc = { headers: entries[0].table.headers, rows: entries[0].table.rows }
      const ka = keys[0]
      let um = 0, ub = 0, matched = 0
      for (let i = 1; i < entries.length; i++) {
        const r = joinTables(acc, entries[i].table, ka, keys[i], { type: o.type, ignoreCase: o.ignoreCase, bName: baseOf(entries[i].name) })
        acc = r.table; um += r.unmatchedA; ub += r.unmatchedB; matched += r.matched
      }
      out = acc
      clear(statsHost, statTiles([{ label: 'Rows', value: out.rows.length, accent: true }, { label: 'Columns', value: out.headers.length }, { label: 'Main rows with no match', value: um, danger: um > 0 && o.type === 'inner' }, { label: 'Rows only in the other file', value: ub }]))
      if (entries.length > 1 && !matched) clear(notes, alert('warn', 'No rows matched. Check that you picked the right columns, and that the values are written the same way in both files.'))
    }
    preview.setTable(out)
    clear(barHost, exportBar({ getTable: () => out, name: () => (o.mode === 'join' ? 'joined' : 'merged') }))
  }

  modeSeg = segmented([['stack', 'Stack (add rows below)'], ['join', 'Join (match on a key column)']], 'stack', (v) => { o.mode = v; run() }, 'Merge mode')
  stackOpts.append(h('div', { class: 'stack' },
    h('div', { class: 'row' }, toggle('Add a "source_file" column', false, (v) => { o.source = v; run() }), toggle('Keep only columns found in every file', false, (v) => { o.onlyCommon = v; run() }), toggle('Match columns by position, not name', false, (v) => { o.byPosition = v; run() })),
    matrixHost))
  joinOpts.append(h('div', { class: 'stack' },
    field('Keep', select([['left', 'All rows of the main file (left join)'], ['inner', 'Only rows that match (inner join)'], ['right', 'All rows of the other file (right join)'], ['full', 'Every row from both (full join)']], 'left', (v) => { o.type = v; run() })),
    h('div', { class: 'dt-grid' }, keyHost),
    toggle('Ignore upper / lower case and extra spaces in keys', true, (v) => { o.ignoreCase = v; run() })))
  joinOpts.hidden = true
  f.s2.body.append(h('div', { class: 'panel stack' }, modeSeg, stackOpts, joinOpts), notes)
  f.s3.body.append(statsHost, preview.el, barHost)
  root.append(h('style', {}, `.dt-matrix td.dt-good { background: color-mix(in srgb, var(--success) 14%, var(--surface)); color: var(--success); } .dt-matrix td.dt-bad { background: color-mix(in srgb, var(--warning) 12%, var(--surface)); color: var(--muted); } .dt-matrix .icon { width: 15px; height: 15px; }`), f.el)
}
