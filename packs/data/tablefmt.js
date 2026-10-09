// CSV to table: Markdown, HTML, ASCII, box-drawing, LaTeX, Jira and plain aligned text.
import { h, clear, field, select, toggle, segmented, tabs, number, table as uiTable, copyButton, download, button, debounce, formatBytes } from '../../lib/ui.js'
import { str, isNumericType, inferTypes, plural } from './_table.js'
import { toolFlow, statTiles, nameBase, exportBar } from './_view.js'

const len = (s) => [...s].length
const pad = (s, w, a) => {
  const gap = Math.max(0, w - len(s))
  return a === 'right' ? ' '.repeat(gap) + s : a === 'center' ? ' '.repeat(Math.floor(gap / 2)) + s + ' '.repeat(Math.ceil(gap / 2)) : s + ' '.repeat(gap)
}
const flat = (v) => str(v).replace(/\s*[\r\n]+\s*/g, ' ')
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escTex = (s) => s.replace(/\\/g, '\\textbackslash{}').replace(/[&%$#_{}]/g, (c) => `\\${c}`).replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}')

export const FORMATS = [['markdown', 'Markdown'], ['html', 'HTML'], ['ascii', 'ASCII'], ['box', 'Box lines'], ['latex', 'LaTeX'], ['jira', 'Jira'], ['text', 'Plain text']]
const EXT = { markdown: 'md', html: 'html', ascii: 'txt', box: 'txt', latex: 'tex', jira: 'txt', text: 'txt' }

/** Column alignment: 'auto' right-aligns number columns. */
export function alignments(t, types, mode) {
  return t.headers.map((_, c) => (mode === 'auto' ? (isNumericType(types[c]) ? 'right' : 'left') : mode === 'keep' ? 'left' : mode))
}

/** Render a table as text in the given format. o: { align, pretty, indent, cls, style, caption, page, booktabs, rowLines, escape, header } */
export function renderTable(fmt, t, types, o = {}) {
  const align = alignments(t, types, o.align || 'auto')
  const head = o.header === false ? null : t.headers.map(flat)
  const body = t.rows.map((r) => t.headers.map((_, c) => flat(r[c])))
  const all = head ? [head, ...body] : body
  const widths = t.headers.map((_, c) => Math.max(1, ...all.map((r) => len(r[c]))))
  const nc = t.headers.length
  if (fmt === 'markdown') {
    const cell = (s) => s.replace(/\|/g, '\\|')
    const sepFor = (c) => { const w = o.pretty ? Math.max(3, widths[c]) : 3; return align[c] === 'right' ? `${'-'.repeat(w - 1)}:` : align[c] === 'center' ? `:${'-'.repeat(w - 2)}:` : `:${'-'.repeat(w - 1)}` }
    const row = (r) => `| ${r.map((s, c) => (o.pretty ? pad(cell(s), widths[c] + (cell(s).length - s.length), align[c]) : cell(s))).join(' | ')} |`
    const header = head || t.headers.map((_, c) => `Column ${c + 1}`)
    return [row(header.map((x) => x)), `| ${t.headers.map((_, c) => sepFor(c)).join(' | ')} |`, ...body.map(row)].join('\n')
  }
  if (fmt === 'html') {
    const ind = o.minify ? '' : o.tabs ? '\t' : '  '
    const nl = o.minify ? '' : '\n'
    const td = (s, tag, c) => {
      const style = o.style ? ` style="${tag === 'th' ? 'text-align:' + (align[c] === 'right' ? 'right' : 'left') + ';padding:8px 12px;border-bottom:2px solid #444;background:#f4f4f6' : `text-align:${align[c] === 'right' ? 'right' : 'left'};padding:8px 12px;border-bottom:1px solid #ddd`}"` : align[c] === 'right' ? ' style="text-align:right"' : ''
      const txt = (o.escape === false ? s : escHtml(s))
      return `${ind}${ind}${ind}<${tag}${style}>${txt}</${tag}>`
    }
    const tr = (cells, tag) => `${ind}${ind}<tr>${nl}${cells.map((s, c) => td(s, tag, c)).join(nl)}${nl}${ind}${ind}</tr>`
    const tableAttrs = `${o.cls ? ` class="${escHtml(o.cls)}"` : ''}${o.style ? ' style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px"' : ''}`
    const tableHtml = [`<table${tableAttrs}>`, o.caption ? `${ind}<caption>${escHtml(o.caption)}</caption>` : null,
      head ? `${ind}<thead>${nl}${tr(head, 'th')}${nl}${ind}</thead>` : null,
      `${ind}<tbody>`, ...body.map((r) => tr(r, 'td')), `${ind}</tbody>`, '</table>'].filter((x) => x != null).join(nl)
    if (!o.page) return tableHtml
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escHtml(o.caption || 'Table')}</title>\n</head>\n<body>\n${tableHtml}\n</body>\n</html>`
  }
  if (fmt === 'ascii' || fmt === 'box') {
    const box = fmt === 'box'
    const ch = box ? { h: '\u2500', v: '\u2502', tl: '\u250C', tm: '\u252C', tr: '\u2510', ml: '\u251C', mm: '\u253C', mr: '\u2524', bl: '\u2514', bm: '\u2534', br: '\u2518', hh: '\u2550' } : { h: '-', v: '|', tl: '+', tm: '+', tr: '+', ml: '+', mm: '+', mr: '+', bl: '+', bm: '+', br: '+', hh: '=' }
    const line = (l, m, r, fill = ch.h) => l + widths.map((w) => fill.repeat(w + 2)).join(m) + r
    const row = (r) => ch.v + r.map((s, c) => ` ${pad(s, widths[c], align[c])} `).join(ch.v) + ch.v
    const out = [line(ch.tl, ch.tm, ch.tr)]
    if (head) { out.push(row(head), line(ch.ml, ch.mm, ch.mr, !box && o.rowLines === 'none' ? '=' : ch.h)) }
    body.forEach((r, i) => { out.push(row(r)); if (o.rowLines === 'all' && i < body.length - 1) out.push(line(ch.ml, ch.mm, ch.mr)) })
    out.push(line(ch.bl, ch.bm, ch.br))
    return out.join('\n')
  }
  if (fmt === 'latex') {
    const colspec = align.map((a) => (a === 'right' ? 'r' : a === 'center' ? 'c' : 'l')).join(o.booktabs ? '' : '|')
    const row = (r) => `  ${r.map((s) => (o.escape === false ? s : escTex(s))).join(' & ')} \\\\`
    const rule = (k) => (o.booktabs ? ['\\toprule', '\\midrule', '\\bottomrule'][k] : '\\hline')
    return [`\\begin{tabular}{${o.booktabs ? colspec : `|${colspec}|`}}`, `  ${rule(0)}`, ...(head ? [row(head), `  ${rule(1)}`] : []), ...body.map((r) => (o.booktabs ? row(r) : `${row(r)}\n  \\hline`)), ...(o.booktabs ? [`  ${rule(2)}`] : []), '\\end{tabular}'].join('\n')
  }
  if (fmt === 'jira') {
    const cell = (s) => s.replace(/\|/g, '\\|') || ' '
    return [...(head ? [`||${head.map(cell).join('||')}||`] : []), ...body.map((r) => `|${r.map(cell).join('|')}|`)].join('\n')
  }
  // plain aligned text
  const sepw = '  '
  return [...(head ? [head.map((s, c) => pad(s, widths[c], align[c])).join(sepw).trimEnd(), widths.map((w) => '-'.repeat(w)).join(sepw)] : []), ...body.map((r) => r.map((s, c) => pad(s, widths[c], align[c])).join(sepw).trimEnd())].join('\n')
}

export function mount(root) {
  let entry = null, types = []
  const o = { fmt: 'markdown', align: 'auto', pretty: true, minify: false, tabs: false, cls: '', style: false, caption: '', page: false, booktabs: true, rowLines: 'header', escape: true, header: true, limit: 0 }
  const statsHost = h('div'), outHost = h('div'), optHost = h('div'), prevHost = h('div'), actHost = h('div')
  let text = ''
  const f = toolFlow({
    titles: ['Add your table data', 'Choose the table format', 'Copy or download it'],
    source: { sample: 'customers', hint: 'CSV, TSV, Excel or JSON. You can also paste rows straight from a spreadsheet.' },
    onData: (e) => { entry = e; if (e) { types = inferTypes(e.table); run() } },
  })
  const fmtSeg = segmented(FORMATS, o.fmt, (v) => { o.fmt = v; buildOpts(); run() }, 'Table format')

  function buildOpts() {
    const A = field('Align', select([['auto', 'Numbers right, text left'], ['left', 'All left'], ['right', 'All right'], ['center', 'All centered']], o.align, (v) => { o.align = v; run() }))
    const T = (label, key, v = o[key]) => toggle(label, v, (x) => { o[key] = x; run() })
    const by = {
      markdown: [A, T('Line up the columns (easier to read as text)', 'pretty')],
      html: [field('CSS class (optional)', h('input', { class: 'input', value: o.cls, placeholder: 'table table-striped', oninput: (e) => { o.cls = e.target.value; run() } })), field('Caption (optional)', h('input', { class: 'input', value: o.caption, oninput: (e) => { o.caption = e.target.value; run() } })), A,
        h('div', { class: 'stack tight' }, T('Add simple inline styling', 'style'), T('Wrap in a full HTML page', 'page'), T('Minify (one line)', 'minify'), T('Escape &, < and > in cells', 'escape'))],
      ascii: [A, field('Lines between rows', select([['header', 'Only under the header'], ['all', 'Between every row']], o.rowLines, (v) => { o.rowLines = v; run() }))],
      box: [A, field('Lines between rows', select([['header', 'Only under the header'], ['all', 'Between every row']], o.rowLines, (v) => { o.rowLines = v; run() }))],
      latex: [A, T('Use booktabs style rules', 'booktabs'), T('Escape special characters (& % $ # _)', 'escape')],
      jira: [],
      text: [A],
    }[o.fmt]
    clear(optHost, h('div', { class: 'dt-grid' }, by, field('Rows to include', number(o.limit || '', { min: 0, step: 1, placeholder: 'All rows', ariaLabel: 'Row limit', onInput: (v) => { o.limit = v > 0 ? Math.floor(v) : 0; run() } }), 'Leave empty for every row.'), T('Include the header row', 'header')))
  }

  const run = debounce(() => {
    if (!entry) return
    const t = o.limit ? { headers: entry.table.headers, rows: entry.table.rows.slice(0, o.limit) } : entry.table
    text = renderTable(o.fmt, t, types, o)
    clear(statsHost, statTiles([{ label: 'Rows', value: t.rows.length, accent: true }, { label: 'Columns', value: t.headers.length }, { label: 'Output size', value: formatBytes(new Blob([text]).size) }]))
    const code = h('pre', { class: 'dt-code', tabindex: 0 }, text.length > 400_000 ? `${text.slice(0, 400_000)}\n\n... cut off in the preview. Copy or download for everything.` : text)
    clear(outHost, tabs([
      { id: 'code', label: 'Code', render: () => code },
      { id: 'preview', label: 'Looks like', render: () => h('div', { class: 'stack' }, uiTable({ columns: t.headers.map((x, c) => ({ label: x, num: alignments(t, types, o.align)[c] === 'right' })), rows: t.rows, max: 100 })) },
    ], 'code'))
    const getText = () => text
    clear(actHost, h('div', { class: 'dt-actions sticky' }, button(`Download .${EXT[o.fmt]}`, { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(new Blob([text], { type: o.fmt === 'html' ? 'text/html' : 'text/plain' }), `${nameBase(entry)}-table.${EXT[o.fmt]}`) }), copyButton(getText, 'Copy code', { size: undefined, variant: 'secondary' })))
  }, 100)
  buildOpts()
  f.s2.body.append(h('div', { class: 'panel stack' }, fmtSeg, optHost))
  f.s3.body.append(statsHost, outHost, actHost)
  root.append(f.el)
}
