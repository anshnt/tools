// SQL formatter and SQL minifier (one module, params.minify switches to the minifier).
// Formatting uses sql-formatter 15.x (pinned, loaded on first use). Minifying uses our own quote-aware scanner so
// strings, quoted identifiers, dollar-quoted bodies and optimizer hints are never touched.
import { studio, opt, seg, toggle, select, loadOnce, jsd, DevError, INDENTS, focusOnDesktop } from './_shared.js'
import { baseName } from '../../lib/files.js'
import { formatBytes, formatNumber } from '../../lib/ui.js'

const lib = () => loadOnce('the SQL formatter', () => import(jsd('sql-formatter@15.8.0/+esm')))

export const DIALECTS = [
  ['sql', 'Standard SQL'], ['mysql', 'MySQL'], ['mariadb', 'MariaDB'], ['postgresql', 'PostgreSQL'], ['transactsql', 'SQL Server (T-SQL)'], ['sqlite', 'SQLite'],
  ['bigquery', 'BigQuery'], ['snowflake', 'Snowflake'], ['plsql', 'Oracle PL/SQL'], ['redshift', 'Amazon Redshift'], ['spark', 'Spark SQL'], ['hive', 'Hive'], ['trino', 'Trino'], ['duckdb', 'DuckDB'],
]
const BACKSLASH = new Set(['mysql', 'mariadb', 'bigquery', 'spark', 'hive', 'singlestoredb', 'tidb'])
const HASH_COMMENT = new Set(['mysql', 'mariadb', 'bigquery', 'singlestoredb', 'tidb'])
const DASH_NEEDS_SPACE = new Set(['mysql', 'mariadb', 'singlestoredb', 'tidb']) // in MySQL, -- only starts a comment when a space follows
const BRACKET_IDENT = new Set(['transactsql', 'sqlite'])

/**
 * Split SQL into pieces: {t: 'code' | 'quoted' | 'hint' | 'space' | 'comment', s}. Quoted pieces (strings, quoted identifiers,
 * dollar-quoted bodies) and hints are returned verbatim; comments and whitespace are separate so callers can drop or keep them.
 */
export function scanSql(sql, dialect = 'sql') {
  const out = []
  const n = sql.length
  let i = 0, code = ''
  const flush = () => { if (code) { out.push({ t: 'code', s: code }); code = '' } }
  const push = (t, s) => { flush(); out.push({ t, s }) }
  const quoted = (q, esc) => {
    let j = i + 1
    while (j < n) {
      const c = sql[j]
      if (esc && c === '\\') { j += 2; continue }
      if (c === q) { if (sql[j + 1] === q) { j += 2; continue } j++; break }
      j++
    }
    return Math.min(j, n)
  }
  while (i < n) {
    const c = sql[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f') {
      let j = i + 1
      while (j < n && ' \t\n\r\f'.includes(sql[j])) j++
      push('space', sql.slice(i, j)); i = j
    } else if (c === "'" || c === '"' || c === '`') {
      // E'..' (Postgres) lets a backslash escape the next character; the E itself stays in the code piece
      const eStr = c === "'" && dialect === 'postgresql' && /(^|[^\w$])[eE]$/.test(code)
      const j = quoted(c, BACKSLASH.has(dialect) || eStr)
      push('quoted', sql.slice(i, j)); i = j
    } else if (c === '[' && BRACKET_IDENT.has(dialect)) {
      let j = sql.indexOf(']', i + 1)
      while (j !== -1 && sql[j + 1] === ']') j = sql.indexOf(']', j + 2)
      j = j === -1 ? n : j + 1
      push('quoted', sql.slice(i, j)); i = j
    } else if (c === '$' && (dialect === 'postgresql' || dialect === 'redshift')) {
      const m = /^\$([A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/.exec(sql.slice(i, i + 80))
      if (m && !/[\w$]$/.test(code)) {
        const end = sql.indexOf(m[0], i + m[0].length)
        const j = end === -1 ? n : end + m[0].length
        push('quoted', sql.slice(i, j)); i = j
      } else { code += c; i++ }
    } else if (c === '-' && sql[i + 1] === '-' && (!DASH_NEEDS_SPACE.has(dialect) || /\s/.test(sql[i + 2] ?? ' '))) {
      let j = sql.indexOf('\n', i)
      j = j === -1 ? n : j
      push('comment', sql.slice(i, j)); i = j
    } else if (c === '#' && HASH_COMMENT.has(dialect)) {
      let j = sql.indexOf('\n', i)
      j = j === -1 ? n : j
      push('comment', sql.slice(i, j)); i = j
    } else if (c === '/' && sql[i + 1] === '*') {
      let j = i + 2
      if (dialect === 'postgresql') {
        let depth = 1
        while (j < n && depth) {
          if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2 } else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2 } else j++
        }
      } else {
        const e = sql.indexOf('*/', j)
        j = e === -1 ? n : e + 2
      }
      const s = sql.slice(i, j)
      push(/^\/\*[+!]/.test(s) ? 'hint' : 'comment', s); i = j
    } else { code += c; i++ }
  }
  flush()
  return out
}

/** Minify SQL: drop comments, collapse whitespace, tighten commas, brackets and semicolons. Returns {out, statements}. */
export function minifySql(sql, { dialect = 'sql', keepHints = true } = {}) {
  let out = '', pending = false, statements = 0, sawCode = false
  const add = (s) => {
    if (!s) return
    if (pending && out) {
      const last = out[out.length - 1], first = s[0]
      if (!(',('.includes(last) || ',);'.includes(first))) out += ' '
    }
    pending = false
    out += s
  }
  for (const p of scanSql(sql, dialect)) {
    if (p.t === 'space' || p.t === 'comment') pending = true
    else if (p.t === 'hint') { if (keepHints) add(p.s); else pending = true } else {
      if (p.t === 'code') { statements += (p.s.match(/;/g) || []).length; if (/[^\s;]/.test(p.s)) sawCode = true } else sawCode = true
      add(p.t === 'code' ? p.s.replace(/\s+/g, ' ') : p.s)
    }
  }
  if (sawCode && !/;\s*$/.test(out)) statements++
  return { out: out.trim(), statements }
}

/** Format SQL with sql-formatter. o: {dialect, keywordCase, indent, style, logical, width, between, dense}. Throws DevError. */
export async function formatSql(sql, o = {}) {
  const { format } = await lib()
  try {
    return format(sql, {
      language: o.dialect || 'sql', keywordCase: o.keywordCase || 'upper', tabWidth: o.indent === 'tab' ? 2 : Number(o.indent) || 2, useTabs: o.indent === 'tab',
      indentStyle: o.style || 'standard', logicalOperatorNewline: o.logical || 'before', expressionWidth: Number(o.width) || 50,
      linesBetweenQueries: Number(o.between ?? 1), denseOperators: !!o.dense,
    })
  } catch (e) {
    const msg = String(e.message || e)
    const m = msg.match(/line (\d+) column (\d+)/i)
    const first = msg.split('\n')[0].replace(/^Parse error:\s*/i, '').replace(/\s*at line \d+ column \d+\.?\s*$/i, '').trim()
    throw new DevError(`Cannot read this SQL: ${first}.`, { line: m ? +m[1] : undefined, col: m ? +m[2] : undefined, hint: 'Check the quotes and brackets near the marked spot. If the syntax is specific to one database, pick that dialect above.' })
  }
}

const SAMPLES = [
  { label: 'Report query', icon: 'chart-column', dialect: 'postgresql', text: `with monthly as (select date_trunc('month', o.created_at) as month, c.country, sum(o.total) as revenue, count(*) as orders from orders o join customers c on c.id=o.customer_id where o.status in ('paid','shipped') and o.created_at >= now() - interval '12 months' group by 1,2) select month, country, revenue, orders, rank() over (partition by month order by revenue desc) as rnk, round(revenue/nullif(orders,0),2) avg_order from monthly where revenue>1000 order by month desc, rnk limit 50;` },
  { label: 'Insert and update', icon: 'pencil', dialect: 'mysql', text: `insert into users (name,email,created_at) values ('Asha','asha@example.com',now()),('Liam','liam@example.com',now()) on duplicate key update name=values(name);update orders set status='shipped',shipped_at=now() where id in (select order_id from shipments where carrier='DHL' and delivered=0);delete from sessions where expires_at<now();` },
  { label: 'Create table', icon: 'table', dialect: 'sql', text: `create table invoices(id integer primary key,customer_id integer not null references customers(id) on delete cascade,amount numeric(12,2) not null default 0,status varchar(20) check (status in ('draft','sent','paid')),issued_on date,created_at timestamp default current_timestamp);create index idx_invoices_customer on invoices(customer_id,issued_on);` },
  { label: 'T-SQL procedure', icon: 'server', dialect: 'transactsql', text: `CREATE PROCEDURE dbo.GetTopOrders @Min money = 100 AS BEGIN SET NOCOUNT ON; SELECT TOP (10) o.OrderID, c.[Company Name], SUM(d.UnitPrice*d.Quantity) AS Total FROM dbo.Orders o JOIN dbo.Customers c ON c.CustomerID=o.CustomerID JOIN dbo.OrderDetails d ON d.OrderID=o.OrderID GROUP BY o.OrderID, c.[Company Name] HAVING SUM(d.UnitPrice*d.Quantity)>@Min ORDER BY Total DESC; END` },
  { label: 'With comments', icon: 'message-square', dialect: 'sql', text: `-- active customers in the last 90 days\nSELECT   c.id,   c.name,\n         /* keep the raw email out of reports */\n         lower(c.email)   AS email   -- normalised\nFROM   customers c\nWHERE  c.last_seen > current_date - 90   AND c.note <> 'a -- b; c'\nORDER  BY c.name ;` },
]

const MIN_SAMPLES = [
  { label: 'Formatted report', icon: 'chart-column', dialect: 'postgresql', text: `-- monthly revenue per country\nWITH monthly AS (\n    SELECT\n        date_trunc('month', o.created_at) AS month,\n        c.country,\n        SUM(o.total)                      AS revenue\n    FROM orders o\n    JOIN customers c\n        ON c.id = o.customer_id\n    WHERE o.status IN ('paid', 'shipped')\n    GROUP BY 1, 2\n)\nSELECT\n    month,\n    country,\n    revenue /* in USD */\nFROM monthly\nWHERE revenue > 1000\nORDER BY month DESC;\n` },
  { label: 'Migration script', icon: 'git-branch', dialect: 'mysql', text: `-- 2025_06_add_orders.sql\nCREATE TABLE orders (\n    id          BIGINT PRIMARY KEY AUTO_INCREMENT,\n    customer_id BIGINT NOT NULL,\n    note        VARCHAR(255) DEFAULT 'rush -- call first',  # keep the dashes\n    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE INDEX idx_orders_customer\n    ON orders (customer_id);\n\nINSERT INTO orders (customer_id, note)\nVALUES (1, 'first'),\n       (2, 'it''s   spaced');\n` },
  SAMPLES[4],
]

export function mount(root, { params }) {
  const minify = !!params.minify
  const state = { dialect: 'sql', kw: 'upper', indent: '2', style: 'standard', logical: 'before', width: '50', between: '1', dense: false, hints: true }
  const rerun = () => s.run(true)
  const dialect = select(DIALECTS, 'sql', (v) => { state.dialect = v; rerun() })
  const fmtOpts = [
    opt('Keywords', seg([['upper', 'UPPER'], ['lower', 'lower'], ['preserve', 'Keep']], 'upper', (v) => { state.kw = v; rerun() }, 'Keyword case')),
    opt('Indent', seg(INDENTS, '2', (v) => { state.indent = v; rerun() }, 'Indentation')),
    opt('', select([['standard', 'Standard layout'], ['tabularLeft', 'Aligned keywords (left)'], ['tabularRight', 'Aligned keywords (right)']], 'standard', (v) => { state.style = v; rerun() })),
    opt('', select([['before', 'AND / OR start the line'], ['after', 'AND / OR end the line']], 'before', (v) => { state.logical = v; rerun() })),
    opt('', select([['50', 'Wrap brackets at 50'], ['80', 'Wrap brackets at 80'], ['120', 'Wrap brackets at 120']], '50', (v) => { state.width = v; rerun() })),
    toggle('Dense operators', false, (v) => { state.dense = v; rerun() }),
  ]
  const minOpts = [toggle('Keep optimizer hints', true, (v) => { state.hints = v; rerun() })]

  const s = studio({
    inputTitle: 'SQL input', outputTitle: minify ? 'Minified SQL' : 'Formatted SQL', inputIcon: 'database', outputIcon: 'sparkles',
    runLabel: minify ? 'Minify' : 'Format', runIcon: minify ? 'minimize' : 'wand-sparkles',
    accept: '.sql,.ddl,.txt,text/plain,application/sql', placeholder: minify ? 'Paste SQL with comments and line breaks, drop a .sql file, or pick an example below...' : 'Paste SQL here, drop a .sql file, or pick an example below...',
    empty: ['database', minify ? 'Your one-line SQL shows up here' : 'Your formatted SQL shows up here'], mime: 'application/sql', outLang: 'sql',
    filename: (name) => (name ? `${baseName(name)}${minify ? '.min' : '.formatted'}.sql` : minify ? 'query.min.sql' : 'formatted.sql'),
    indent: () => (state.indent === 'tab' ? '\t' : ' '.repeat(Number(state.indent))),
    samples: minify ? MIN_SAMPLES : SAMPLES, onSample: (smp) => { state.dialect = smp.dialect; dialect.value = smp.dialect },
    options: [opt('Dialect', dialect), ...(minify ? minOpts : fmtOpts)],
    async process(text) {
      const before = new Blob([text]).size
      let out, statements
      if (minify) {
        ({ out, statements } = minifySql(text, { dialect: state.dialect, keepHints: state.hints }))
      } else {
        out = await formatSql(text, state)
        statements = minifySql(text, { dialect: state.dialect }).statements
      }
      const after = new Blob([out]).size
      const saved = before ? (1 - after / before) * 100 : 0
      const lines = out.trimEnd().split('\n').length
      return {
        output: minify ? out : `${out.trimEnd()}\n`, chip: minify ? `${formatNumber(Math.max(0, saved), 0)}% smaller` : 'Formatted',
        stats: minify
          ? [{ label: 'Minified size', value: formatBytes(after), accent: true, hint: `${formatBytes(before)} before` }, { label: 'Saved', value: `${formatNumber(Math.abs(saved), 1)}%`, hint: saved >= 0 ? 'smaller' : 'larger' }, { label: 'Statements', value: statements }]
          : [{ label: 'Statements', value: statements, accent: true }, { label: 'Lines', value: lines, hint: `${formatNumber(text.trimEnd().split('\n').length, 0)} before` }, { label: 'Size', value: formatBytes(after), hint: `${formatBytes(before)} before` }],
      }
    },
  })
  root.append(s.el)
  focusOnDesktop(s.ed)
}
