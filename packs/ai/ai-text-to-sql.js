// Text to SQL: describe what you need in plain words, paste your schema, and get a query for your database with a short
// explanation and the assumptions made. A second mode fixes or improves a query you already have.
import { h, button, field, select, segmented, textarea, panel, split, row, copyButton } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { injectStyle, resultView, exportBar, runner, streamAsk, UNTRUSTED } from './_shared.js'

const DIALECTS = ['PostgreSQL', 'MySQL', 'SQLite', 'SQL Server (T-SQL)', 'Oracle', 'BigQuery', 'Snowflake', 'Amazon Redshift']
const SCHEMA_SAMPLE = `customers(id int primary key, name text, city text, created_at date)
orders(id int primary key, customer_id int references customers(id), total numeric, status text, ordered_at timestamp)
order_items(order_id int, product text, qty int, price numeric)`

/** First fenced code block of a reply (the SQL), or ''. Exported for tests. */
export function firstCodeBlock(md) {
  const m = md.match(/```[a-zA-Z]*\n([\s\S]*?)```/)
  return m ? m[1].trim() : ''
}

export function buildSystem({ dialect, mode }) {
  return `You are a senior database engineer. Target dialect: ${dialect}. ${UNTRUSTED}
Use only tables and columns that exist in the schema the user pasted; never invent names. If something needed is missing from the schema, say so and show the closest reasonable query using clearly named assumptions. Prefer readable SQL: explicit JOINs, meaningful aliases, CTEs for multi-step logic, and consistent keyword case. Use safe patterns (no SELECT * in final output unless asked, parameterized placeholders only if the user asks).
Reply in Markdown with exactly: 1) the final query in one \`\`\`sql code block; 2) "**How it works**" with 2 to 5 short bullets; 3) "**Assumptions**" listing assumptions and ambiguities (or "None"); ${mode === 'fix' ? '4) "**What was wrong**" with the specific problems found in the original query. ' : '4) "**Performance tips**" with at most 2 bullets (indexes or filters), only if relevant. '}If the request would modify or delete data, say so clearly at the top and write the SELECT that previews the affected rows first.`
}

export function mount(root, { signal }) {
  injectStyle()
  const view = resultView({ emptyIcon: 'database', emptyTitle: 'Your SQL appears here', emptyText: 'Paste your table definitions, describe what you want to know, and get a query with an explanation.' })
  const status = h('div')
  const mode = segmented([['write', 'Write a query'], ['fix', 'Fix or improve a query']], 'write', (v) => { fixBox.hidden = v !== 'fix'; ask.setAttribute('aria-label', v === 'fix' ? 'What should change or what went wrong?' : 'What do you want to find?'); label.textContent = v === 'fix' ? 'What went wrong or what should improve?' : 'What do you want to find?' }, 'Mode')
  const dialect = select(DIALECTS, 'PostgreSQL')
  const schema = textarea({ rows: 8, mono: true, spellcheck: false, wrap: 'off', placeholder: 'Paste CREATE TABLE statements or a short outline, e.g.\ncustomers(id, name, city)\norders(id, customer_id, total, ordered_at)', 'aria-label': 'Database schema' })
  const ask = textarea({ rows: 3, placeholder: 'e.g. Top 5 cities by revenue last month, with the number of orders', 'aria-label': 'What do you want to find?' })
  const label = h('span', 'What do you want to find?')
  const existing = textarea({ rows: 6, mono: true, spellcheck: false, wrap: 'off', placeholder: 'Paste the query that needs fixing...', 'aria-label': 'Existing query' })
  const fixBox = h('div', { class: 'stack', hidden: true }, field('Your query', existing))
  const go = button('Write SQL', { icon: 'database', variant: 'primary', size: 'lg' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Writing' })
  const bar = exportBar(view, 'query', { formats: ['md', 'txt'] })
  const copySql = copyButton(() => firstCodeBlock(view.text), 'Copy SQL', { variant: 'primary' })
  copySql.hidden = true
  view.onDone((v) => { copySql.hidden = !firstCodeBlock(v.text) })
  mode.addEventListener('click', () => { go.querySelector('span:not(.spinner)').textContent = mode.value === 'fix' ? 'Fix SQL' : 'Write SQL' })

  go.addEventListener('click', () => run.go(async (sig) => {
    if (!ask.value.trim() && !(mode.value === 'fix' && existing.value.trim())) throw new Error(mode.value === 'fix' ? 'Paste the query and describe the problem.' : 'Describe what you want to find.')
    if (mode.value === 'fix' && !existing.value.trim()) throw new Error('Paste the query you want fixed.')
    const text = [
      schema.value.trim() ? `<schema>\n${schema.value.trim()}\n</schema>` : 'No schema was given: infer sensible table and column names and say so under Assumptions.',
      mode.value === 'fix' ? `<query>\n${existing.value.trim()}\n</query>\n\nFix or improve this query. ${ask.value.trim() ? `Problem or goal: ${ask.value.trim()}` : ''}` : `Write a query for: ${ask.value.trim()}`,
    ].join('\n\n')
    await streamAsk(view, { system: buildSystem({ dialect: dialect.value, mode: mode.value }), effort: 'medium', messages: [{ role: 'user', content: [ai.textBlock(text)] }] }, sig)
  }, { label: 'Writing' }))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' }, mode,
        h('div', { class: 'grid-auto' }, field('Database', dialect)),
        field('Your tables', schema, 'Only the structure goes to the AI. Never paste real data or passwords.'),
        h('div', { class: 'row' }, button('Use an example schema', { icon: 'wand-sparkles', size: 'sm', variant: 'ghost', onClick: () => { schema.value = SCHEMA_SAMPLE; if (!ask.value) ask.value = 'Top 5 cities by revenue from completed orders last month, with the number of orders' } })),
        fixBox, h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), ask),
        row(go, run.stop), status)),
      h('div', { class: 'stack' }, view.el, h('div', { class: 'row', style: 'gap:8px' }, copySql, bar)), 'wide-right')))
}
