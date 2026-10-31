// Parquet viewer: open a .parquet file and see its schema, row groups, compression, column statistics and the first rows.
// The file is read in place with DuckDB-WASM on this device; nothing is uploaded.
import { h, icon, clear, button, alert, dropzone, select, progress, stats, table, tabs, formatBytes, formatNumber, openToolWith, onCleanup } from '../../lib/ui.js'
import { loadEngine, onEngineProgress, hold, releaseEngine, registerFile, sqlStr, ident, uid, cleanErr, DataError } from './_engine.js'

const num = (v) => (typeof v === 'bigint' ? Number(v) : v)
const NULL = () => h('span', { class: 'muted' }, 'NULL')

export function mount(root) {
  const prog = progress('Loading the SQL engine')
  const out = h('div', { class: 'stack' })
  const err = h('div')
  const drop = dropzone({
    accept: '.parquet,.pq,.parq', label: 'Drop a Parquet file here, or click to choose',
    hint: 'The file is read in place on this device. The SQL engine (about 36 MB) downloads once.',
    onFiles: ([f]) => open(f),
  })
  root.append(h('div', { class: 'stack' }, drop, prog.el, err, out))
  const off = onEngineProgress((f, t) => { prog.set(f, t); if (f === 1) setTimeout(() => prog.hide(), 400) })
  let conn = null, eng = null, release = null, vname = null, gen = 0
  async function cleanup() {
    const c = conn, e = eng, r = release, v = vname
    conn = eng = release = vname = null
    try { if (v && e) await e.db.dropFile(v) } catch { /* gone */ }
    try { await c?.close() } catch { /* ignore */ }
    r?.()
  }
  onCleanup(() => { off(); cleanup().then(() => releaseEngine()) })

  async function open(file) {
    const my = ++gen
    clear(err); clear(out)
    await cleanup()
    try {
      eng = await loadEngine()
      release = hold()
      conn = await eng.db.connect()
      vname = uid('pq') + '.parquet'
      await registerFile(eng, file, vname)
      const q = async (sql) => (await conn.query(sql)).toArray().map((r) => r.toJSON())
      let meta
      try {
        meta = (await q(`SELECT * FROM parquet_file_metadata(${sqlStr(vname)})`))[0]
        if (!meta) throw new Error('no metadata')
      } catch (e) { throw new DataError(`${file.name}: this does not look like a valid Parquet file. ${cleanErr(e)}`) }
      const [schema, chunks, kv] = await Promise.all([
        q(`SELECT * FROM parquet_schema(${sqlStr(vname)})`),
        q(`SELECT * FROM parquet_metadata(${sqlStr(vname)})`),
        q(`SELECT decode(key) AS k, decode(value) AS v FROM parquet_kv_metadata(${sqlStr(vname)})`).catch(() => []),
      ])
      if (my !== gen) return
      const top = schema.filter((_, i) => i > 0)
      const topCount = Number(schema[0]?.num_children ?? top.length)
      const rows = num(meta.num_rows)
      const groups = new Set(chunks.map((c) => String(c.row_group_id))).size
      const comps = [...new Set(chunks.map((c) => c.compression))]
      const compressed = chunks.reduce((s, c) => s + num(c.total_compressed_size), 0)
      const uncompressed = chunks.reduce((s, c) => s + num(c.total_uncompressed_size), 0)

      const colStats = new Map() // top-level column -> SUMMARIZE row
      const statsHost = h('div', { class: 'stack' })
      async function computeStats() {
        const s = await q(`SELECT * FROM (SUMMARIZE SELECT * FROM read_parquet(${sqlStr(vname)}))`)
        for (const r of s) colStats.set(r.column_name, r)
        drawColumns()
      }
      const drawColumns = () => {
        const byPath = new Map()
        for (const c of chunks) {
          const k = c.path_in_schema
          const e = byPath.get(k) || { path: k, type: c.type, comp: new Set(), enc: new Set(), cs: 0, us: 0, nulls: 0, values: 0 }
          e.comp.add(c.compression)
          String(c.encodings || '').split(', ').filter(Boolean).forEach((x) => e.enc.add(x))
          e.cs += num(c.total_compressed_size); e.us += num(c.total_uncompressed_size); e.nulls += num(c.stats_null_count ?? 0); e.values += num(c.num_values)
          byPath.set(k, e)
        }
        const trs = [...byPath.values()].map((e) => {
          const s = colStats.get(e.path)
          return [e.path, e.type, [...e.comp].join(', '), formatBytes(e.cs), formatBytes(e.us), e.us ? `${(e.us / Math.max(e.cs, 1)).toFixed(1)}x` : '-', formatNumber(e.nulls, 0), s ? String(s.min ?? '') : '-', s ? String(s.max ?? '') : '-', s ? String(s.approx_unique ?? '') : '-', [...e.enc].join(', ')]
        })
        clear(statsHost,
          colStats.size ? null : (rows * topCount > 40e6 ? button('Compute min, max and distinct counts', { icon: 'sigma', onClick: (ev) => { ev.currentTarget.disabled = true; computeStats().catch((e) => clear(statsHost, alert('error', cleanErr(e)))) } }) : null),
          table({ columns: ['Column', 'Type', 'Compression', 'Compressed', 'Uncompressed', 'Ratio', 'Nulls', 'Min', 'Max', 'Distinct (approx.)', 'Encodings'], rows: trs, max: 500 }),
          h('p', { class: 'small muted' }, 'Min, max and distinct counts come from reading the data (top-level columns). Nested columns show their sizes only.'))
      }
      drawColumns()
      if (rows * topCount <= 40e6) computeStats().catch(() => {})

      // schema tab with nesting
      const srows = []
      const stack = []
      for (const r of schema.slice(1)) {
        while (stack.length && stack.at(-1) === 0) stack.pop()
        if (stack.length) stack[stack.length - 1]--
        srows.push([h('span', { style: `padding-left:${stack.length * 16}px;font-family:var(--mono)` }, r.name), r.type || (num(r.num_children) ? 'group' : ''), r.logical_type || r.converted_type || '', r.duckdb_type || '', String(r.repetition_type || '').toLowerCase(),
          [r.precision != null ? `precision ${r.precision}` : '', r.scale != null ? `scale ${r.scale}` : '', r.type_length != null ? `length ${r.type_length}` : ''].filter(Boolean).join(', ')])
        if (num(r.num_children)) stack.push(num(r.num_children))
      }

      // row groups tab
      const rgs = new Map()
      for (const c of chunks) { const e = rgs.get(String(c.row_group_id)) || { id: c.row_group_id, rows: num(c.row_group_num_rows), cs: 0, us: 0, cols: [] }; e.cs += num(c.total_compressed_size); e.us += num(c.total_uncompressed_size); e.cols.push(c); rgs.set(String(c.row_group_id), e) }
      const rgBox = h('div', { class: 'stack' }, [...rgs.values()].slice(0, 200).map((g) => h('details', { class: 'panel' },
        h('summary', { style: 'cursor:pointer;font-weight:600' }, `Row group ${g.id}: ${formatNumber(g.rows, 0)} rows, ${formatBytes(g.cs)} compressed, ${formatBytes(g.us)} uncompressed`),
        h('div', { style: 'margin-top:10px' }, table({ columns: ['Column', 'Compression', 'Compressed', 'Uncompressed', 'Nulls', 'Min', 'Max'], rows: g.cols.map((c) => [c.path_in_schema, c.compression, formatBytes(num(c.total_compressed_size)), formatBytes(num(c.total_uncompressed_size)), c.stats_null_count == null ? '-' : formatNumber(num(c.stats_null_count), 0), String(c.stats_min_value ?? c.stats_min ?? '-'), String(c.stats_max_value ?? c.stats_max ?? '-')]) })))))
      if (rgs.size > 200) rgBox.append(h('p', { class: 'small muted' }, `Showing the first 200 of ${rgs.size} row groups.`))

      // data tab
      const dataHost = h('div', { class: 'stack' })
      let limit = 50
      const cols = top.length ? await q(`DESCRIBE SELECT * FROM read_parquet(${sqlStr(vname)})`) : []
      async function drawData() {
        const t = await conn.query(`SELECT ${cols.map((c) => `CAST(${ident(c.column_name)} AS VARCHAR) AS ${ident(c.column_name)}`).join(', ')} FROM read_parquet(${sqlStr(vname)}) LIMIT ${limit}`)
        const vecs = cols.map((_, i) => t.getChildAt(i))
        const trs = Array.from({ length: t.numRows }, (_, i) => vecs.map((v) => { const x = v.get(i); return x == null ? NULL() : x.length > 160 ? `${x.slice(0, 160)}...` : x }))
        clear(dataHost, h('div', { class: 'row' }, h('label', { class: 'small' }, 'Show the first '), select([[20, '20 rows'], [50, '50 rows'], [200, '200 rows'], [1000, '1,000 rows']], limit, (v) => { limit = +v; drawData() })),
          table({ columns: cols.map((c) => ({ label: c.column_name, num: /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|FLOAT|DOUBLE|DECIMAL)/i.test(c.column_type) })), rows: trs, max: 1000 }))
      }

      const kvRows = kv.map((x) => [String(x.k), h('code', { style: 'white-space:pre-wrap;word-break:break-all' }, String(x.v).length > 700 ? `${String(x.v).slice(0, 700)}...` : String(x.v))])
      const summary = h('div', { class: 'stack' },
        stats([
          { label: 'Rows', value: formatNumber(rows, 0), accent: true }, { label: 'Columns', value: topCount }, { label: 'Row groups', value: groups },
          { label: 'File size', value: formatBytes(file.size) }, { label: 'Compression', value: comps.join(', ') || '-' }, { label: 'Format version', value: String(meta.format_version ?? '-') },
        ]),
        h('p', { class: 'small muted' }, `Created by ${meta.created_by || 'unknown'}. Uncompressed the column data is about ${formatBytes(uncompressed)}, stored in ${formatBytes(compressed)}${compressed ? ` (${(uncompressed / compressed).toFixed(1)}x smaller)` : ''}.${meta.encryption_algorithm ? ' This file is encrypted.' : ''}`),
        h('div', { class: 'row' },
          button('Query it with SQL', { icon: 'database', variant: 'primary', onClick: () => openToolWith('sql-on-files', [file]) }),
          button('To CSV', { icon: 'file-spreadsheet', onClick: () => openToolWith('parquet-to-csv', [file]) }),
          button('To JSON', { icon: 'braces', onClick: () => openToolWith('parquet-to-json', [file]) }),
          button('To Excel', { icon: 'sheet', onClick: () => openToolWith('parquet-to-excel', [file]) })),
        kvRows.length ? h('div', { class: 'stack' }, h('h3', { style: 'font-size:15px' }, 'Key-value metadata'), table({ columns: ['Key', 'Value'], rows: kvRows, max: 50 })) : null)

      const t = tabs([
        { id: 'summary', label: 'Summary', render: () => summary },
        { id: 'schema', label: `Schema (${top.length})`, render: () => table({ columns: ['Name', 'Parquet type', 'Logical type', 'As SQL', 'Repetition', 'Details'], rows: srows, max: 2000 }) },
        { id: 'groups', label: `Row groups (${groups})`, render: () => rgBox },
        { id: 'columns', label: 'Columns', render: () => statsHost },
        { id: 'data', label: 'Data', render: () => { drawData().catch((e) => clear(dataHost, alert('error', cleanErr(e)))); return dataHost } },
      ])
      clear(out, h('div', { class: 'panel stack' }, h('div', { class: 'row' }, icon('file'), h('strong', file.name), h('span', { class: 'muted small' }, formatBytes(file.size))), t))
    } catch (e) {
      if (my !== gen) return
      console.error(e)
      prog.hide()
      clear(err, alert('error', e.userMessage || e.message || String(e)))
    }
  }
}
