// Excel formula generator: describe the job and Claude writes the formula; a searchable library of 90 formulas works with no key.
import { h, icon, clear, button, field, select, input, tabs, alert, copyButton, copyText, busy, debounce } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { FORMULAS, GROUPS } from './_formulas.js'
import { injectStyles, section } from './_view.js'
import { parseFormula, describe, lint } from './_formula.js'

const IDEAS = [
  'Total sales for the North region in 2024',
  'Find the price of a product ID in another sheet',
  'Count how many orders are over 500 and still unpaid',
  'Combine first and last name, with proper capitalization',
  'Days left until a deadline, ignoring weekends',
  'Show Pass, Merit or Fail from a mark',
]
const DIALECTS = [['Microsoft Excel 365 (dynamic arrays allowed)', 'Excel 365'], ['Excel 2016 / 2019 (no dynamic array functions)', 'Excel 2016-2019'], ['Google Sheets', 'Google Sheets'], ['LibreOffice Calc', 'LibreOffice Calc']]
const SCHEMA = {
  type: 'object',
  properties: {
    formula: { type: 'string', description: 'The formula, starting with =' },
    explanation: { type: 'string', description: 'Two or three plain sentences on what it does' },
    steps: { type: 'array', items: { type: 'string' }, description: 'How the formula works, one short step per item' },
    example: { type: 'string', description: 'A tiny example with sample values and the result' },
    alternatives: { type: 'array', items: { type: 'object', properties: { formula: { type: 'string' }, note: { type: 'string' } }, required: ['formula', 'note'], additionalProperties: false } },
    notes: { type: 'array', items: { type: 'string' }, description: 'Assumptions about the data or things to change' },
  },
  required: ['formula', 'explanation', 'steps', 'example', 'alternatives', 'notes'],
  additionalProperties: false,
}

const STOP = new Set(['the', 'for', 'and', 'with', 'from', 'that', 'this', 'are', 'all', 'each', 'every', 'into', 'out', 'how', 'can', 'get', 'make', 'want', 'need', 'cell', 'cells', 'column', 'columns', 'row', 'rows', 'formula', 'excel', 'sheet', 'when', 'where', 'which', 'what', 'than', 'over', 'under', 'only', 'any', 'one', 'two', 'show', 'give', 'use'])
const SYN = { sales: ['sum'], revenue: ['sum'], total: ['sum'], totals: ['sum'], add: ['sum'], combine: ['join', 'textjoin'], merge: ['join'], price: ['lookup'], find: ['lookup', 'search'], match: ['lookup'], average: ['averageif', 'mean'], mean: ['average'], remove: ['trim', 'substitute', 'unique'], duplicates: ['unique', 'countif'], duplicate: ['unique', 'countif'], split: ['textsplit', 'left'], deadline: ['workday'], weekends: ['workday', 'networkdays'], grade: ['ifs', 'lookup'], pass: ['if'], fail: ['if'], unpaid: ['countifs'], orders: ['count'], many: ['count'], older: ['datedif'], age: ['datedif'], tax: ['gst', 'vat'], percent: ['percentage'], uppercase: ['upper'], lowercase: ['lower'], capitalize: ['proper'], blank: ['isblank', 'countblank'], empty: ['countblank'], year: ['date'], month: ['date'], days: ['date'] }

/** Rank library formulas for a free-text query. */
export function searchFormulas(query, group = 'all') {
  const words = [...new Set(query.toLowerCase().split(/[^a-z0-9$%]+/).filter((w) => w.length > 1 && !STOP.has(w)).flatMap((w) => [w, ...(SYN[w] || [])]))]
  const pool = FORMULAS.map((f, i) => ({ f, i })).filter(({ f }) => group === 'all' || f[1] === group)
  if (!words.length) return pool.map((x) => x.f)
  const scored = pool.map(({ f }) => {
    const hay = { title: f[0].toLowerCase(), key: f[5].toLowerCase(), formula: f[2].toLowerCase(), desc: f[3].toLowerCase() }
    let s = 0
    for (const w of words) {
      if (hay.title.includes(w)) s += 4
      if (hay.key.split(' ').some((k) => k === w || k.startsWith(w))) s += 5
      else if (hay.key.includes(w)) s += 2
      if (hay.formula.includes(w)) s += 2
      if (hay.desc.includes(w)) s += 1
    }
    return { f, s }
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
  return scored.map((x) => x.f)
}

const explainHref = (f) => `#/excel-formula-explainer?f=${encodeURIComponent(f)}`
const code = (text) => h('code', { class: 'dt-fcode' }, text)

function libraryCard(f, i = 0) {
  return h('article', { class: 'dt-lib dt-glow', style: { '--i': Math.min(i, 12) } },
    h('div', { class: 'dt-lib-top' }, h('h3', f[0]), h('span', { class: 'dt-pill' }, GROUPS[f[1]])),
    h('div', { class: 'dt-lib-formula' }, code(f[2]), copyButton(() => f[2], '', { ariaLabel: `Copy formula for ${f[0]}`, title: 'Copy formula' })),
    h('p', f[3]),
    h('div', { class: 'dt-lib-foot' }, h('span', { class: 'small muted' }, `Example: ${f[4]}`), h('a', { class: 'link small', href: explainHref(f[2]) }, 'Explain it')))
}

export function mount(root) {
  injectStyles()
  let controller = null
  const promptEl = h('textarea', { class: 'textarea', rows: 4, placeholder: 'Example: add up column C for rows where column A is "North" and the date in column B is in 2024', 'aria-label': 'What should the formula do?' })
  const dataEl = input({ placeholder: 'Optional: where is your data? e.g. names in A2:A100, sales in C2:C100, header in row 1', 'aria-label': 'About your data' })
  const dialect = select(DIALECTS.map(([l, v]) => [v, l]), 'Excel 365')
  const sep = select([[',', 'Commas (US, UK, India)'], [';', 'Semicolons (much of Europe)']], ',')
  const result = h('div', { class: 'dt-gen-out', 'aria-live': 'polite' })
  const hints = h('div', { class: 'dt-hints' })
  const goBtn = button('Create formula', { icon: 'sparkles', variant: 'primary', size: 'lg' })

  function showHints() {
    const q = promptEl.value.trim()
    const found = q.length > 3 ? searchFormulas(q).slice(0, 3) : []
    clear(hints, found.length ? [h('div', { class: 'small muted', style: 'margin-bottom:6px' }, 'Ready-made formulas that look related (no AI needed):'), h('div', { class: 'stack tight' }, found.map((f) => h('div', { class: 'dt-hint' }, h('div', { style: 'min-width:0' }, h('b', f[0]), code(f[2])), copyButton(() => f[2], 'Copy'))))] : null)
  }
  promptEl.addEventListener('input', debounce(showHints, 200))

  async function generate() {
    const need = promptEl.value.trim()
    if (!need) { clear(result, alert('info', 'Describe what you want the formula to do first.')); promptEl.focus(); return }
    if (!(await ai.ensureKey())) return
    controller?.abort()
    controller = new AbortController()
    clear(result, h('div', { class: 'dt-skel', style: 'height:140px' }))
    await busy(goBtn, async () => {
      const r = await ai.ask({
        system: 'You are an expert spreadsheet author. Write one correct, readable formula for the request. Rules: use only functions that exist in the chosen application; use the cell addresses the user gives, otherwise realistic placeholders such as A2:A100 and say what they mean in the notes; prefer exact ranges over whole columns; handle blanks and errors sensibly; the formula string must start with =. Use the chosen argument separator. Give at most two alternatives, only when they are meaningfully different (for example an older-Excel version). Keep explanations short and friendly. Do not use em dashes.',
        prompt: `Application: ${dialect.value}\nArgument separator: ${sep.value === ';' ? 'semicolon' : 'comma'}\n${dataEl.value.trim() ? `My data: ${dataEl.value.trim()}\n` : ''}What I need: ${need}`,
        json: SCHEMA, effort: 'low', signal: controller.signal,
      })
      draw(r)
    }, { label: 'Writing your formula', errorTo: result })
  }
  function draw(r) {
    const f = String(r.formula || '').trim()
    const parsed = parseFormula(f)
    const problems = lint(parsed).filter((x) => x.level === 'error')
    clear(result, h('div', { class: 'dt-gen-card' },
      h('div', { class: 'dt-gen-formula' }, code(f)),
      h('div', { class: 'row' }, copyButton(() => f, 'Copy formula'), h('a', { class: 'btn btn-secondary btn-sm', href: explainHref(f) }, icon('circle-help'), h('span', 'Explain it step by step'))),
      problems.length ? alert('warn', 'The formula did not pass the built-in syntax check, so test it before relying on it: ', problems[0].msg) : null,
      h('p', { class: 'dt-gen-exp' }, r.explanation),
      r.steps?.length ? section('How it works', 'list-ordered', h('ol', { class: 'dt-gen-steps' }, r.steps.map((s) => h('li', s)))) : null,
      r.example ? h('div', { class: 'dt-gen-ex' }, icon('flask-conical'), h('span', r.example)) : null,
      r.alternatives?.length ? section('Other ways', 'git-fork', r.alternatives.map((a) => h('div', { class: 'dt-hint' }, h('div', { style: 'min-width:0' }, code(a.formula), h('div', { class: 'small muted' }, a.note)), copyButton(() => a.formula, 'Copy')))) : null,
      r.notes?.length ? alert('info', h('div', r.notes.map((n) => h('div', n)))) : null))
  }
  goBtn.addEventListener('click', generate)
  promptEl.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate() })

  // ----- library
  let group = 'all'
  const search = input({ type: 'search', placeholder: 'Search formulas: vlookup, age, remove duplicates, quarter...', 'aria-label': 'Search formulas', autocomplete: 'off' })
  const grid = h('div', { class: 'dt-lib-grid' })
  const chips = h('div', { class: 'dt-chips', role: 'group', 'aria-label': 'Category' }, [['all', 'All'], ...Object.entries(GROUPS)].map(([k, l]) => h('button', { type: 'button', class: 'dt-chip', 'data-k': k, 'aria-pressed': String(k === group), onclick: () => { group = k; for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.k === k)); paint() } }, h('span', l))))
  const count = h('div', { class: 'small muted' })
  function paint() {
    const list = searchFormulas(search.value, group)
    clear(grid, list.length ? list.map(libraryCard) : h('div', { class: 'empty' }, icon('search-x'), 'No ready-made formula matches that. Try the AI tab and describe it in your own words.'))
    count.textContent = `${list.length} of ${FORMULAS.length} formulas. Change the cell ranges to match your sheet.`
  }
  search.addEventListener('input', debounce(paint, 120))
  paint()

  const aiTab = () => h('div', { class: 'stack' },
    ai.notice('Writes formulas with Claude'),
    field('What should the formula do?', promptEl),
    h('div', { class: 'dt-feat' }, IDEAS.map((t) => h('button', { type: 'button', class: 'dt-chip', onclick: () => { promptEl.value = t; showHints(); promptEl.focus() } }, h('span', t)))),
    field('About your data', dataEl),
    h('div', { class: 'dt-grid' }, field('Spreadsheet app', dialect), field('Argument separator', sep, 'Use semicolons if your Excel shows ; between arguments.')),
    h('div', { class: 'row' }, goBtn, h('span', { class: 'small muted' }, 'Ctrl + Enter also works')),
    hints, result)
  const libTab = () => h('div', { class: 'stack' }, search, chips, count, grid)
  root.append(h('style', {}, CSS), h('div', { class: 'panel' }, tabs([{ id: 'ai', label: 'Describe it (AI)', render: aiTab }, { id: 'lib', label: `Formula library (${FORMULAS.length})`, render: libTab }], 'ai')))
  return () => controller?.abort()
}

const CSS = `
.dt-fcode { font-family: var(--mono); font-size: 13px; color: var(--accent); overflow-wrap: anywhere; white-space: pre-wrap; }
.dt-lib-grid { columns: 3 300px; column-gap: 12px; }
.dt-lib-grid > .empty { column-span: all; }
.dt-lib { break-inside: avoid; margin: 0 0 12px; display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); min-width: 0; animation: dtIn .45s calc(var(--i, 0) * 35ms) var(--ease) both; transition: transform .3s var(--ease), box-shadow .3s, border-color .3s; }
.dt-lib:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
.dt-lib-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.dt-lib-top h3 { font-size: 14.5px; letter-spacing: -.01em; }
.dt-lib-formula { display: flex; gap: 6px; align-items: flex-start; justify-content: space-between; padding: 8px 8px 8px 10px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
.dt-lib p { font-size: 13.5px; color: var(--text-2); }
.dt-lib-foot { display: flex; justify-content: space-between; gap: 8px; align-items: flex-end; margin-top: auto; }
.dt-hint { display: flex; gap: 10px; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); animation: dtIn .35s var(--ease) both; }
.dt-hint b { display: block; font-size: 13.5px; }
.dt-gen-card { display: flex; flex-direction: column; gap: 14px; padding: 18px; border-radius: var(--radius-lg); border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border)); background: linear-gradient(145deg, color-mix(in srgb, var(--accent) 6%, var(--surface)), var(--surface)); animation: dtIn .5s var(--ease) both; }
.dt-gen-formula { padding: 14px 16px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); }
.dt-gen-formula .dt-fcode { font-size: 16px; }
.dt-gen-exp { font-size: 15px; }
.dt-gen-steps { margin: 0; padding-left: 20px; display: grid; gap: 4px; font-size: 14px; color: var(--text-2); }
.dt-gen-ex { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; background: var(--info-soft); font-size: 14px; }
.dt-gen-ex .icon { color: var(--info); margin-top: 2px; }
`
