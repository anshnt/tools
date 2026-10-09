// Edit columns: rename, reorder, delete, add computed columns (join, split, row number, math, fixed value) and find and replace.
import { h, icon, clear, button, field, select, toggle, input, number, tabs, alert, debounce } from '../../lib/ui.js'
import { inferTypes, num, str, isEmpty, uniqueHeaders, plural } from './_table.js'
import { toolFlow, virtualTable, exportBar, statTiles, section, nameBase, typeBadge, colSelect } from './_view.js'

let uid = 0

/** Value of a template like "{First} {Last}" for one row. names: header -> column index. */
export function fillTemplate(tpl, row, names) {
  return tpl.replace(/\{([^{}]+)\}/g, (m, n) => { const i = names.get(n.trim().toLowerCase()); return i == null ? m : str(row[i]) })
}

export function mount(root) {
  let entry = null, types = []
  let cols = []
  let rules = []
  const o = { trim: false }
  const listHost = h('div', { class: 'stack tight' }), rulesHost = h('div', { class: 'stack tight' }), statsHost = h('div'), barHost = h('div'), addHost = h('div')
  const preview = virtualTable({ height: 420 })
  const f = toolFlow({
    titles: ['Add your table', 'Edit the columns', 'Check the result and download'],
    source: { sample: 'customers' },
    onData: (e) => { entry = e; if (e) init() },
  })

  function init() {
    const t = entry.table
    types = inferTypes(t)
    cols = t.headers.map((n, i) => ({ id: ++uid, name: n, kind: 'orig', i, keep: true }))
    rules = []
    drawAdd(); drawList(); drawRules(); run()
  }
  const origNames = () => new Map(entry.table.headers.map((n, i) => [n.toLowerCase(), i]))

  function drawList() {
    clear(listHost, cols.map((c, k) => h('div', { class: ['dt-colrow', !c.keep && 'off'] },
      h('div', { class: 'dt-colrow-move' }, button('', { icon: 'chevron-up', variant: 'ghost', size: 'sm', ariaLabel: `Move ${c.name} up`, disabled: k === 0, onClick: () => { [cols[k - 1], cols[k]] = [cols[k], cols[k - 1]]; drawList(); run() } }),
        button('', { icon: 'chevron-down', variant: 'ghost', size: 'sm', ariaLabel: `Move ${c.name} down`, disabled: k === cols.length - 1, onClick: () => { [cols[k + 1], cols[k]] = [cols[k], cols[k + 1]]; drawList(); run() } })),
      input({ value: c.name, 'aria-label': `Name of column ${k + 1}`, oninput: (e) => { c.name = e.target.value; run() } }),
      c.kind === 'orig' ? typeBadge(types[c.i]) : h('span', { class: 'dt-pill accent' }, 'new'),
      button('', { icon: c.keep ? 'trash-2' : 'undo-2', variant: 'ghost', size: 'sm', ariaLabel: c.keep ? `Delete ${c.name}` : `Bring back ${c.name}`, title: c.keep ? 'Delete this column' : 'Bring it back', onClick: () => { if (c.kind === 'calc' && c.keep) cols = cols.filter((x) => x !== c); else c.keep = !c.keep; drawList(); run() } }))))
  }

  function drawAdd() {
    const t = entry.table
    const kind = select([['join', 'Join columns with text'], ['split', 'Take a piece of a column'], ['math', 'Do math with columns'], ['row', 'Number the rows'], ['fixed', 'Fixed value']], 'join', (v) => { sub(v) })
    const name = input({ placeholder: 'New column name', 'aria-label': 'New column name' })
    const body = h('div', { class: 'stack' })
    const state = { tpl: t.headers.slice(0, 2).map((x) => `{${x}}`).join(' '), src: 0, delim: ',', part: '1', a: 0, op: '+', b: 'col', bcol: Math.min(1, t.headers.length - 1), bconst: '1', start: 1, fixed: '' }
    function sub(k) {
      if (k === 'join') clear(body, field('Template', input({ value: state.tpl, 'aria-label': 'Template', oninput: (e) => { state.tpl = e.target.value } }), 'Write {Column name} wherever a value should go.'),
        h('div', { class: 'dt-feat' }, t.headers.map((x) => h('button', { type: 'button', class: 'dt-chip', onclick: (e) => { const el = body.querySelector('input'); el.value += `{${x}}`; state.tpl = el.value } }, h('span', x)))))
      if (k === 'split') clear(body, h('div', { class: 'dt-grid' }, field('Column', colSelect({ headers: t.headers, value: state.src, label: 'Source column', onChange: (v) => { state.src = v } })), field('Split at', input({ value: state.delim, 'aria-label': 'Delimiter', oninput: (e) => { state.delim = e.target.value } })), field('Take piece', select([['1', '1st'], ['2', '2nd'], ['3', '3rd'], ['4', '4th'], ['last', 'Last']], state.part, (v) => { state.part = v }))))
      if (k === 'math') clear(body, h('div', { class: 'dt-grid' }, field('First column', colSelect({ headers: t.headers, value: state.a, label: 'First column', onChange: (v) => { state.a = v } })), field('Operation', select([['+', 'plus'], ['-', 'minus'], ['*', 'times'], ['/', 'divided by']], state.op, (v) => { state.op = v })),
        field('With', select([['col', 'another column'], ['const', 'a number']], state.b, (v) => { state.b = v; sub('math') })), state.b === 'col' ? field('Second column', colSelect({ headers: t.headers, value: state.bcol, label: 'Second column', onChange: (v) => { state.bcol = v } })) : field('Number', input({ value: state.bconst, 'aria-label': 'Number', oninput: (e) => { state.bconst = e.target.value } }))))
      if (k === 'row') clear(body, field('Start at', number(1, { step: 1, ariaLabel: 'Start at', onInput: (v) => { state.start = Number.isFinite(v) ? v : 1 } })))
      if (k === 'fixed') clear(body, field('Value for every row', input({ value: state.fixed, 'aria-label': 'Fixed value', oninput: (e) => { state.fixed = e.target.value } })))
    }
    sub('join')
    const add = button('Add column', { icon: 'plus', variant: 'primary', onClick: () => {
      const k = kind.value
      const names = origNames()
      let make
      let label = name.value.trim()
      if (k === 'join') { const tpl = state.tpl; make = (r) => fillTemplate(tpl, r, names); label ||= 'joined' }
      else if (k === 'split') { const { src, delim, part } = state; make = (r) => { const p = str(r[src]).split(delim || ','); const v = part === 'last' ? p.at(-1) : p[+part - 1]; return (v ?? '').trim() }; label ||= `${t.headers[src]}_part`; }
      else if (k === 'math') { const { a, op, b, bcol, bconst } = { ...state }; const cst = Number(bconst); make = (r) => { const x = num(r[a]), y = b === 'col' ? num(r[bcol]) : cst; if (x == null || y == null || !Number.isFinite(y)) return ''; const v = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : y === 0 ? NaN : x / y; return Number.isFinite(v) ? String(+v.toPrecision(12)) : '' }; label ||= 'result' }
      else if (k === 'row') { const s = state.start; make = (r, i) => String(s + i); label ||= 'row_number' }
      else { const v = state.fixed; make = () => v; label ||= 'new_column' }
      cols.push({ id: ++uid, name: label, kind: 'calc', make, keep: true })
      name.value = ''
      drawList(); run()
    } })
    clear(addHost, h('div', { class: 'stack' }, h('div', { class: 'dt-grid' }, field('Kind of column', kind), field('Name', name)), body, h('div', { class: 'row' }, add)))
  }

  function drawRules() {
    clear(rulesHost, rules.map((r, i) => h('div', { class: 'dt-rule' },
      h('span', { class: 'dt-rule-n' }, i === 0 ? 'Replace' : 'Then'),
      h('select', { class: 'select', 'aria-label': 'In column', onchange: (e) => { r.col = e.target.value; run() } }, h('option', { value: 'all', selected: r.col === 'all' }, 'in all columns'), cols.filter((c) => c.keep).map((c) => h('option', { value: String(c.id), selected: String(c.id) === r.col }, `in ${c.name}`))),
      input({ value: r.find, placeholder: r.regex ? 'Pattern' : 'Find', 'aria-label': 'Find', oninput: (e) => { r.find = e.target.value; run() } }),
      input({ value: r.repl, placeholder: 'Replace with', 'aria-label': 'Replace with', oninput: (e) => { r.repl = e.target.value; run() } }),
      toggle('Regex', r.regex, (v) => { r.regex = v; drawRules(); run() }), toggle('Match case', r.cs, (v) => { r.cs = v; run() }),
      button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove this rule', onClick: () => { rules.splice(i, 1); drawRules(); run() } }))),
    button('Add a find and replace rule', { icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => { rules.push({ col: 'all', find: '', repl: '', regex: false, cs: false }); drawRules() } }))
  }

  let warn = ''
  function build() {
    const t = entry.table
    const keep = cols.filter((c) => c.keep)
    const compiled = rules.filter((r) => r.find !== '').map((r) => {
      try { return { col: r.col, re: new RegExp(r.regex ? r.find : r.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), r.cs ? 'g' : 'gi'), repl: r.repl } } catch { warn = 'One of the find patterns is not a valid regular expression.'; return null }
    }).filter(Boolean)
    const headers = uniqueHeaders(keep.map((c) => c.name))
    const rows = t.rows.map((r, ri) => keep.map((c) => {
      let v = c.kind === 'orig' ? r[c.i] : c.make(r, ri)
      if (typeof v === 'string' || compiled.length) {
        let s = str(v)
        if (o.trim) s = s.trim().replace(/[ \t]+/g, ' ')
        for (const k of compiled) if (k.col === 'all' || k.col === String(c.id)) s = s.replace(k.re, k.repl)
        v = s
      }
      return v
    }))
    return { headers, rows }
  }
  const run = debounce(() => {
    if (!entry) return
    warn = ''
    const out = build()
    preview.setTable(out)
    const kept = cols.filter((c) => c.keep)
    clear(statsHost, statTiles([{ label: 'Columns', value: out.headers.length, accent: true, hint: `was ${entry.table.headers.length}` }, { label: 'New columns', value: kept.filter((c) => c.kind === 'calc').length }, { label: 'Deleted', value: cols.filter((c) => c.kind === 'orig' && !c.keep).length }, { label: 'Rows', value: out.rows.length }]), warn ? alert('warn', warn) : null)
    clear(barHost, exportBar({ getTable: () => build(), name: () => `${nameBase(entry)}-edited` }))
  }, 100)

  f.s2.body.append(h('div', { class: 'dt-cols2' },
    h('div', { class: 'panel stack' }, section('Your columns', 'columns-3', h('p', { class: 'small muted' }, 'Rename a column by typing, move it with the arrows, delete it with the bin.'), listHost, toggle('Trim spaces in every cell', false, (v) => { o.trim = v; run() })),
    h('div', { class: 'panel stack' }, section('Find and replace', 'replace', rulesHost))),
    h('div', { class: 'panel stack' }, section('Add a column', 'columns-2', addHost))))
  f.s3.body.append(statsHost, preview.el, barHost)
  root.append(h('style', {}, `
.dt-cols2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; } .dt-cols2 > .panel:first-child { grid-row: span 1; }
@media (max-width: 900px) { .dt-cols2 { grid-template-columns: minmax(0, 1fr); } }
.dt-colrow { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); animation: dtIn .3s var(--ease) both; }
.dt-colrow.off { opacity: .5; } .dt-colrow.off .input { text-decoration: line-through; }
.dt-colrow .input { height: 36px; flex: 1; min-width: 0; }
.dt-colrow-move { display: flex; flex-direction: column; } .dt-colrow-move .btn-sm { height: 18px; width: 30px; padding: 0; }
.dt-rule { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); }
.dt-rule > .select, .dt-rule > .input { flex: 1 1 130px; min-width: 0; width: auto; height: 38px; }
.dt-rule-n { font-size: 12.5px; font-weight: 600; color: var(--muted); min-width: 56px; }
`), f.el)
}
