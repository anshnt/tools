// Budget tracker: income and expenses by category, monthly view, category doughnut and monthly bar charts (Chart.js),
// budgets per category with progress, CSV import and export. INR by default with a currency selector. Data stays in this browser.
import { h, icon, button, input, field, select, segmented, toast, clear, modal, download, debounce } from '../../lib/ui.js'
import { app, css, makeStore, uid, today, ymd, parseYmd, fmtDate, monthKey, money, moneyShort, CURRENCIES, stat, emptyState, ib, chip, bar, dataBar, confirmBox, plural, num, makeChart, chartColors, PALETTE, sum, pad } from './_shared.js'
import { papaparse } from '../../lib/libs.js'

export const EXPENSE_CATS = ['Food & dining', 'Groceries', 'Rent & housing', 'Transport', 'Bills & utilities', 'Shopping', 'Health', 'Entertainment', 'Travel', 'Education', 'Subscriptions', 'Other']
export const INCOME_CATS = ['Salary', 'Freelance', 'Business', 'Investments', 'Gift', 'Other']
export const catColor = (name) => PALETTE[[...name].reduce((s, c) => s + c.charCodeAt(0) * 31, 7) % PALETTE.length]

// ---------------------------------------------------------------- pure logic
export const inMonth = (tx, m) => tx.filter((t) => t.date.startsWith(m))
export function totals(list) {
  const income = sum(list.filter((t) => t.type === 'income'), (t) => t.amount)
  const expense = sum(list.filter((t) => t.type === 'expense'), (t) => t.amount)
  return { income, expense, net: income - expense, rate: income > 0 ? (income - expense) / income : null }
}
export function byCategory(list, type = 'expense') {
  const m = new Map()
  for (const t of list) if (t.type === type) m.set(t.cat, (m.get(t.cat) || 0) + t.amount)
  return [...m].sort((a, b) => b[1] - a[1])
}
export const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}` }
export const monthLabel = (m, long = true) => parseYmd(m + '-01').toLocaleDateString(undefined, { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' })

/** Accepts 2026-03-05, 05/03/2026, 5-3-26, 05.03.2026, "5 Mar 2026", "Mar 5, 2026". Day-first for ambiguous slashes (India). Returns YYYY-MM-DD or ''. */
export function parseDateLoose(s) {
  s = String(s ?? '').trim()
  if (!s) return ''
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s.*)?$/)
  if (m) {
    let [, a, b, y] = m.map(Number)
    if (y < 100) y += 2000
    return b > 12 && a <= 12 ? valid(y, a, b) : valid(y, b, a)
  }
  const t = Date.parse(s)
  if (!Number.isNaN(t)) { const d = new Date(t); return valid(d.getFullYear(), d.getMonth() + 1, d.getDate()) }
  return ''
}
function valid(y, mo, d) { const t = new Date(y, mo - 1, d); return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : '' }
/** "1,23,456.50", "Rs. 500", "(250)", "-12.5", "1.234,56"(european) -> number or NaN. */
export function parseAmount(v) {
  if (typeof v === 'number') return v
  let s = String(v ?? '').trim()
  if (!s) return NaN
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (/cr\b/i.test(s) && !/dr\b/i.test(s)) s = s.replace(/cr/i, '')
  if (/dr\b/i.test(s)) { neg = true; s = s.replace(/dr/i, '') }
  s = s.replace(/\b(?:rs|inr|usd|eur|gbp|aed|cad|aud|sgd|jpy)\b\.?/gi, '').replace(/[^\d.,-]/g, '')
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1) }
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.')
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (lc >= 0) s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? (neg ? -n : n) : NaN
}
/** Map parsed CSV rows (objects keyed by header) to transactions. Supports amount+type, signed amount, or Debit/Credit columns. */
export function rowsToTransactions(rows, makeId = uid) {
  const out = [], skipped = []
  if (!rows.length) return { out, skipped }
  const keys = Object.keys(rows[0])
  const pick = (re) => keys.find((k) => re.test(k.trim().toLowerCase()))
  const kDate = pick(/^(date|txn date|transaction date|value date|posted|booking date)/) || pick(/date/)
  const kAmt = pick(/^(amount|amt|value|sum)\b/) || pick(/amount/)
  const kDebit = pick(/debit|withdraw|paid out|money out|dr$/)
  const kCredit = pick(/credit|deposit|paid in|money in|cr$/)
  const kType = pick(/^(type|kind|direction|dr\/cr|cr\/dr)/)
  const kCat = pick(/categor/)
  const kNote = pick(/^(note|notes|description|narration|details|particulars|memo|payee|merchant|remarks?)/) || pick(/desc|narrat|detail|particular/)
  if (!kDate) return { out, skipped: [{ row: 1, why: 'No date column found (expected a header like "Date").' }], missing: 'date' }
  if (!kAmt && !(kDebit || kCredit)) return { out, skipped: [{ row: 1, why: 'No amount column found (expected "Amount", or "Debit" and "Credit").' }], missing: 'amount' }
  // a signed Amount column (some negatives) means negative = expense, positive = income; all-positive files are treated as expenses
  const signed = !kType && !!kAmt && !(kDebit || kCredit) && rows.some((r) => parseAmount(r[kAmt]) < 0)
  rows.forEach((r, i) => {
    const date = parseDateLoose(r[kDate])
    if (!date) { skipped.push({ row: i + 2, why: `Unreadable date "${r[kDate] ?? ''}"` }); return }
    let amount, type
    if (kDebit || kCredit) {
      const d = parseAmount(r[kDebit]), c = parseAmount(r[kCredit])
      if (Number.isFinite(d) && d !== 0 && !(Number.isFinite(c) && c !== 0)) { amount = Math.abs(d); type = 'expense' }
      else if (Number.isFinite(c) && c !== 0 && !(Number.isFinite(d) && d !== 0)) { amount = Math.abs(c); type = 'income' }
      else if (kAmt && Number.isFinite(parseAmount(r[kAmt]))) { const a = parseAmount(r[kAmt]); amount = Math.abs(a); type = a < 0 ? 'expense' : 'income' }
      else { skipped.push({ row: i + 2, why: 'No amount' }); return }
    } else {
      const a = parseAmount(r[kAmt])
      if (!Number.isFinite(a) || a === 0) { skipped.push({ row: i + 2, why: `Unreadable amount "${r[kAmt] ?? ''}"` }); return }
      amount = Math.abs(a)
      const t = String(r[kType] ?? '').trim().toLowerCase()
      type = /^(income|credit|cr\b|deposit|in\b|received|\+)/.test(t) ? 'income' : /^(expense|debit|dr\b|withdrawal|out\b|paid|spent|-)/.test(t) ? 'expense' : signed ? (a < 0 ? 'expense' : 'income') : 'expense'
    }
    out.push({ id: makeId(), type, amount: Math.round(amount * 100) / 100, cat: String(r[kCat] ?? '').trim() || 'Other', date, note: String(r[kNote] ?? '').trim().slice(0, 120) })
  })
  return { out, skipped }
}
export const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const toCsv = (tx) => 'date,type,category,amount,note\n' + [...tx].sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t.type, t.cat, t.amount, t.note].map(csvCell).join(',')).join('\n') + '\n'

const CSS = `
.t-budget .mnav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.t-budget .mnav h2{margin:0;font-size:clamp(19px,4.4vw,26px);letter-spacing:-.03em;flex:1;min-width:0;white-space:nowrap}
.t-budget .addf{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.t-budget .addf .wide{grid-column:1/-1}
.t-budget .tx{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:4px 10px;align-items:center;padding:10px 2px;border-bottom:1px solid var(--border)}
.t-budget .tx:last-child{border-bottom:0}
.t-budget .tx .dot{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--cc) 16%,var(--surface));color:var(--cc);font-weight:700;font-size:14px}
.t-budget .tx b{font-size:14.5px;display:block;overflow-wrap:anywhere}
.t-budget .tx small{color:var(--muted);font-size:12.5px;display:block;overflow-wrap:anywhere}
.t-budget .tx .a{font-weight:650;font-variant-numeric:tabular-nums;white-space:nowrap}
.t-budget .tx .a.inc{color:var(--success)}
.t-budget .chartbox{position:relative;height:240px}
.t-budget .brow{display:grid;gap:6px;padding:10px 0;border-bottom:1px solid var(--border)}
.t-budget .brow:last-child{border-bottom:0}
.t-budget .brow .top{display:flex;align-items:center;gap:8px;justify-content:space-between;min-width:0}
.t-budget .brow .top .nm{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;font-weight:550;overflow-wrap:anywhere}
.t-budget .brow .top .nm i{width:10px;height:10px;border-radius:50%;background:var(--cc);flex:none}
.t-budget .brow input{width:104px;height:34px;text-align:right}
.t-budget .brow .cap{display:flex;justify-content:space-between;font-size:12.5px;color:var(--muted);gap:8px;flex-wrap:wrap}
.t-budget .filters{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.t-budget .filters>:first-child{grid-column:1/-1}
.t-budget .mnav .select{width:auto;max-width:100%}
.t-budget .imp{display:flex;gap:10px;flex-wrap:wrap}
`

const blank = () => ({ tx: [], budgets: {}, currency: 'INR', month: monthKey(today()) })

export function mount(root) {
  const el = app(root, 'budget', '#0ea5e9')
  css('t-budget', CSS)
  const store = makeStore('budget', blank(), (d) => { d.tx ||= []; d.budgets ||= {}; d.currency ||= 'INR'; d.month ||= monthKey(today()) })
  const S = () => store.get()
  const $ = (n) => money(n, S().currency)
  const st = { q: '', cat: '', type: 'all', all: false, form: 'expense' }
  let charts = {}

  const navHost = h('div'), statsHost = h('div'), formHost = h('div'), listHost = h('div'), budgetHost = h('div'), toolsHost = h('div'), dataHost = h('div')
  const catCanvas = h('canvas', { role: 'img', 'aria-label': 'Spending by category' })
  const monthCanvas = h('canvas', { role: 'img', 'aria-label': 'Income and expenses by month' })
  const catEmpty = h('div'), catBox = h('div', { class: 'chartbox' }, catCanvas)
  const chartCards = h('div', { class: 'stack' },
    h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('chart-pie'), 'Spending by category'), catBox, catEmpty),
    h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('chart-column'), 'Last 6 months'), h('div', { class: 'chartbox' }, monthCanvas)))
  el.append(navHost, statsHost, h('div', { class: 'pz-cols wide-r' }, h('div', { class: 'stack' }, formHost, listHost), h('div', { class: 'stack' }, chartCards, budgetHost)), toolsHost, dataHost)

  const monthTx = () => inMonth(S().tx, S().month)
  const catsFor = (type) => [...new Set([...(type === 'income' ? INCOME_CATS : EXPENSE_CATS), ...S().tx.filter((t) => t.type === type).map((t) => t.cat)])]

  // ---------- month navigation
  function renderNav() {
    const m = S().month
    const mi = input({ type: 'month', value: m, 'aria-label': 'Pick a month', style: 'width:auto', onchange: () => { if (mi.value) { S().month = mi.value; store.save(); renderAll() } } })
    clear(navHost, h('div', { class: 'pz-card' }, h('div', { class: 'mnav' }, h('h2', monthLabel(m)), ib('chevron-left', 'Previous month', () => { S().month = shiftMonth(m, -1); store.save(); renderAll() }),
      button('This month', { size: 'sm', onClick: () => { S().month = monthKey(today()); store.save(); renderAll() } }), ib('chevron-right', 'Next month', () => { S().month = shiftMonth(m, 1); store.save(); renderAll() }), mi,
      h('span', { class: 'pz-note' }, 'Currency'), select(CURRENCIES, S().currency, (v) => { S().currency = v; store.save(); renderAll() }))))
  }
  function renderStats() {
    const t = totals(monthTx())
    clear(statsHost, h('div', { class: 'pz-bento' },
      stat({ label: 'Income', value: $(t.income), icon: 'arrow-down-left', tone: 'ok' }),
      stat({ label: 'Expenses', value: $(t.expense), icon: 'arrow-up-right', tone: 'bad' }),
      stat({ label: 'Balance', value: $(t.net), hint: t.net >= 0 ? 'left this month' : 'overspent', icon: 'wallet', hero: true, tone: t.net >= 0 ? 'info' : 'bad' }),
      stat({ label: 'Savings rate', value: t.rate == null ? '-' : `${Math.round(t.rate * 100)}%`, hint: t.rate == null ? 'add income to see it' : 'of income kept', icon: 'piggy-bank', tone: t.rate != null && t.rate >= 0.2 ? 'ok' : 'warn' })))
  }

  // ---------- add / edit
  function txForm(t, onSave, onCancel) {
    const m = t ? { ...t } : { id: uid(), type: st.form, amount: '', cat: '', date: S().month === monthKey(today()) ? today() : `${S().month}-01`, note: '' }
    const seg = segmented([['expense', 'Expense'], ['income', 'Income']], m.type, (v) => { m.type = v; if (!t) st.form = v; list.replaceChildren(...catsFor(v).map((c) => h('option', { value: c }))); cat.placeholder = v === 'income' ? 'e.g. Salary' : 'e.g. Groceries' }, 'Type')
    const amt = input({ type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: m.amount, placeholder: '0.00', 'aria-label': 'Amount' })
    const listId = 'bc' + uid()
    const list = h('datalist', { id: listId }, catsFor(m.type).map((c) => h('option', { value: c })))
    const cat = input({ value: m.cat, list: listId, placeholder: m.type === 'income' ? 'e.g. Salary' : 'e.g. Groceries', 'aria-label': 'Category', autocomplete: 'off', maxlength: 40 })
    const date = input({ type: 'date', value: m.date, 'aria-label': 'Date' })
    const note = input({ value: m.note, placeholder: 'Note (optional)', 'aria-label': 'Note', maxlength: 120 })
    const go = () => {
      const a = amt.valueAsNumber
      if (!(a > 0)) { amt.focus(); toast('Enter an amount above zero', 'error'); return }
      if (!date.value) { toast('Pick a date', 'error'); return }
      onSave({ id: m.id, type: m.type, amount: Math.round(a * 100) / 100, cat: cat.value.trim() || 'Other', date: date.value, note: note.value.trim() })
    }
    for (const i of [amt, cat, note]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go() } })
    const body = h('div', { class: 'addf' }, h('div', { class: 'wide' }, seg), field(`Amount (${S().currency})`, amt), field('Date', date), field('Category', cat), field('Note', note), list)
    return { body, go, amt, onCancel }
  }
  function renderForm() {
    const f = txForm(null, (rec) => {
      S().tx.push(rec); const mk = monthKey(rec.date); if (mk !== S().month) { S().month = mk; toast(`Added to ${monthLabel(mk)}`) } else toast('Added', 'success')
      store.save(); renderAll(); document.querySelector('.t-budget input[aria-label="Amount"]')?.focus()
    })
    clear(formHost, h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('circle-plus'), 'Add a transaction'), h('div', { class: 'stack' }, f.body, h('div', { class: 'pz-row' }, button('Add', { icon: 'plus', variant: 'primary', onClick: f.go })))))
  }
  function editTx(t) {
    const f = txForm(t, (rec) => { Object.assign(S().tx.find((x) => x.id === t.id), rec); store.save(); dlg.close(); renderAll() })
    const dlg = modal({ title: 'Edit transaction', icon: 'pencil', body: f.body, actions: [button('Delete', { icon: 'trash-2', variant: 'danger', onClick: () => { S().tx = S().tx.filter((x) => x.id !== t.id); store.save(); dlg.close(); renderAll() } }), button('Cancel', { onClick: () => dlg.close() }), button('Save', { variant: 'primary', onClick: f.go })] })
  }

  // ---------- list
  function renderList() {
    const src = st.all ? S().tx : monthTx()
    const cats = [...new Set(src.map((t) => t.cat))].sort()
    const search = input({ type: 'search', placeholder: 'Search notes and categories', value: st.q, 'aria-label': 'Search transactions', oninput: debounce(() => { st.q = search.value; renderRows() }, 150) })
    const catSel = select([['', 'All categories'], ...cats], st.cat, (v) => { st.cat = v; renderRows() }); catSel.setAttribute('aria-label', 'Filter by category')
    const typeSel = select([['all', 'Income and expenses'], ['expense', 'Expenses'], ['income', 'Income']], st.type, (v) => { st.type = v; renderRows() }); typeSel.setAttribute('aria-label', 'Filter by type')
    const rowsHost = h('div')
    const renderRows = () => {
      const q2 = st.q.toLowerCase()
      const rs = src.filter((t) => (st.type === 'all' || t.type === st.type) && (!st.cat || t.cat === st.cat) && (!q2 || `${t.cat} ${t.note} ${t.amount}`.toLowerCase().includes(q2))).sort((a, b) => b.date.localeCompare(a.date))
      clear(rowsHost, rs.length ? [rs.slice(0, 200).map((t) => h('div', { class: 'tx', style: { '--cc': catColor(t.cat) } }, h('span', { class: 'dot' }, t.cat[0].toUpperCase()), h('div', h('b', t.cat), h('small', [fmtDate(t.date, { day: 'numeric', month: 'short', year: st.all ? 'numeric' : undefined }), t.note].filter(Boolean).join(' - '))),
        h('span', { class: ['a', t.type === 'income' && 'inc'] }, (t.type === 'income' ? '+' : '-') + $(t.amount)), ib('pencil', `Edit ${t.cat} ${t.date}`, () => editTx(t)))), rs.length > 200 ? h('p', { class: 'pz-note' }, `Showing 200 of ${rs.length}. Narrow the filters.`) : null]
        : emptyState(src.length ? 'No matches' : 'No transactions this month', src.length ? 'Try clearing the filters.' : 'Add your first one above, or import a CSV file.', 'receipt'))
    }
    clear(listHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('list'), h('span', { class: 'grow' }, st.all ? `All transactions (${S().tx.length})` : `Transactions (${src.length})`), chip(st.all ? 'Show this month' : 'Show all time', { onClick: () => { st.all = !st.all; st.cat = ''; renderList() } })),
      h('div', { class: 'stack' }, h('div', { class: 'filters' }, search, catSel, typeSel), rowsHost)))
    renderRows()
  }

  // ---------- charts
  const catBuild = (c) => {
    const rows = byCategory(monthTx())
    return { type: 'doughnut', data: { labels: rows.map((r) => r[0]), datasets: [{ data: rows.map((r) => r[1]), backgroundColor: rows.map((r) => catColor(r[0])), borderColor: c.surface, borderWidth: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, color: c.text } }, tooltip: { callbacks: { label: (x) => ` ${x.label}: ${$(x.parsed)} (${Math.round((x.parsed / sum(x.dataset.data)) * 100)}%)` } } } } }
  }
  const monthBuild = (c) => {
    const ms = Array.from({ length: 6 }, (_, i) => shiftMonth(S().month, i - 5))
    const tt = ms.map((m) => totals(inMonth(S().tx, m)))
    return { type: 'bar', data: { labels: ms.map((m) => monthLabel(m, false)), datasets: [{ label: 'Income', data: tt.map((x) => x.income), backgroundColor: c.success, borderRadius: 6, maxBarThickness: 28 }, { label: 'Expenses', data: tt.map((x) => x.expense), backgroundColor: c.danger, borderRadius: 6, maxBarThickness: 28 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { usePointStyle: true, boxWidth: 8, color: c.text } }, tooltip: { callbacks: { label: (x) => ` ${x.dataset.label}: ${$(x.parsed.y)}` } } }, scales: { x: { grid: { display: false }, ticks: { color: c.muted } }, y: { beginAtZero: true, suggestedMax: 1000, grid: { color: c.grid }, ticks: { color: c.muted, callback: (v) => moneyShort(v, S().currency) } } } } }
  }
  function renderCharts() {
    const has = byCategory(monthTx()).length > 0
    catBox.hidden = !has
    clear(catEmpty, has ? null : emptyState('No spending this month', 'Expenses appear here by category.', 'chart-pie'))
    charts.cat?.refresh(catBuild); charts.month?.refresh(monthBuild)
  }
  makeChart(catCanvas, catBuild).then((c) => { charts.cat = c }).catch(() => {})
  makeChart(monthCanvas, monthBuild).then((c) => { charts.month = c }).catch(() => { monthCanvas.replaceWith(h('p', { class: 'pz-note' }, 'Charts need an internet connection to load once.')) })

  // ---------- budgets
  function renderBudgets() {
    const B = S().budgets
    const spend = new Map(byCategory(monthTx()))
    const cats = [...new Set([...Object.keys(B), ...spend.keys()])].sort((a, b) => (B[b] ? 1 : 0) - (B[a] ? 1 : 0) || (spend.get(b) || 0) - (spend.get(a) || 0))
    const totalB = sum(Object.values(B)), totalS = sum(Object.keys(B), (k) => spend.get(k) || 0)
    const free = catsFor('expense').filter((c) => !(c in B))
    const addSel = select([['', 'Add a budget for...'], ...free], '', (v) => { if (v) { B[v] = Math.max(1, Math.round((spend.get(v) || 1000) / 100) * 100); store.save(); renderBudgets() } }); addSel.setAttribute('aria-label', 'Add a budget for a category')
    clear(budgetHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('target'), h('span', { class: 'grow' }, 'Budgets'), totalB ? h('span', { class: 'pz-note' }, `${$(totalS)} of ${$(totalB)}`) : null),
      cats.length ? cats.map((c) => {
        const b = B[c] || 0, s = spend.get(c) || 0, f = b ? s / b : 0
        const bb = bar(f, f > 1 ? 'var(--danger)' : f >= 0.8 ? 'var(--warning)' : 'var(--success)')
        const bi = input({ type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: b || '', placeholder: 'Budget', 'aria-label': `Monthly budget for ${c}`, onchange: () => { const v = bi.valueAsNumber; if (v > 0) B[c] = v; else delete B[c]; store.save(); renderBudgets() } })
        return h('div', { class: 'brow', style: { '--cc': catColor(c) } }, h('div', { class: 'top' }, h('span', { class: 'nm' }, h('i'), c), h('span', { class: 'pz-row nowrap' }, h('span', { class: 'pz-note' }, $(s)), bi, b ? ib('x', `Remove budget for ${c}`, () => { delete B[c]; store.save(); renderBudgets() }, 'danger') : null)),
          b ? [bb, h('div', { class: 'cap' }, h('span', `${Math.round(f * 100)}% used`), h('span', { style: f > 1 ? 'color:var(--danger);font-weight:600' : '' }, f > 1 ? `${$(s - b)} over` : `${$(b - s)} left`))] : null)
      }) : h('p', { class: 'pz-note' }, 'Set a monthly limit per category and watch the bars fill as you spend.'),
      h('div', { style: 'margin-top:10px' }, addSel)))
  }

  // ---------- CSV
  function renderTools() {
    const file = h('input', { type: 'file', accept: '.csv,text/csv,.txt', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = ''
      if (!f) return
      try {
        const P = await papaparse()
        const res = P.parse((await f.text()).replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (x) => x.trim() })
        const r = rowsToTransactions(res.data)
        if (r.missing) { toast(r.skipped[0].why, 'error'); return }
        if (!r.out.length) { toast('No usable rows found in that file', 'error'); return }
        const keyOf = (t) => `${t.date}|${t.type}|${t.amount}|${t.cat}|${t.note}`
        const have = new Set(S().tx.map(keyOf))
        const add = r.out.filter((t) => !have.has(keyOf(t)))
        S().tx.push(...add)
        const last = add.map((t) => t.date).sort().at(-1)
        if (last) S().month = monthKey(last)
        store.save(); renderAll()
        toast(`Imported ${plural(add.length, 'transaction')}${r.out.length > add.length ? `, ${r.out.length - add.length} duplicates skipped` : ''}${r.skipped.length ? `, ${r.skipped.length} rows could not be read` : ''}`, r.skipped.length ? 'info' : 'success')
      } catch (err) { toast(`Could not read that CSV: ${err.message}`, 'error') }
    } })
    clear(toolsHost, h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('file-spreadsheet'), 'CSV'),
      h('div', { class: 'imp' }, button('Import CSV', { icon: 'upload', onClick: () => file.click() }), file,
        button('Export all (CSV)', { icon: 'download', onClick: () => { if (!S().tx.length) { toast('Nothing to export yet', 'error'); return } download(toCsv(S().tx), 'budget-all.csv', 'text/csv') } }),
        button(`Export ${monthLabel(S().month, false)}`, { icon: 'download', onClick: () => { const l = monthTx(); if (!l.length) { toast('No transactions this month', 'error'); return } download(toCsv(l), `budget-${S().month}.csv`, 'text/csv') } })),
      h('p', { class: 'pz-note', style: 'margin:10px 0 0' }, 'Import reads headers like Date, Amount, Type, Category, Note, or bank-statement Debit and Credit columns. Dates are read day first (05/03/2026 is 5 March). Duplicates are skipped.')))
  }

  function renderAll() { renderNav(); renderStats(); renderForm(); renderList(); renderCharts(); renderBudgets(); renderTools() }
  clear(dataHost, dataBar({ kind: 'budget', get: () => S(), set: (d) => { store.set({ ...blank(), ...d }); renderAll() }, reset: () => { store.set(blank()); renderAll() } }))
  renderAll()
}
