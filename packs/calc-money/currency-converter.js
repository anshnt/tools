// Currency converter: live rates from the European Central Bank (Frankfurter) with open.er-api.com as a fallback and for extra currencies.
// Rates are cached in this browser for an hour. Only the amount you type stays on your device; the services get plain GET requests with no keys.
import { h, icon, button, alert } from '../../lib/ui.js'
import { shell, num, hero, card, layout, note, chartBox, money, fnum, firstIssue, stack, block, style } from './_shared.js'
import { load, save } from '../../lib/store.js'

const FRANKFURTER = 'https://api.frankfurter.dev/v1/latest?base=USD'
const ER_API = 'https://open.er-api.com/v6/latest/USD'
const CACHE_KEY = 'cm:fx'
const MAX_AGE = 60 * 60 * 1000
const POPULAR = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED', 'CHF', 'CNY', 'NZD', 'ZAR', 'SAR', 'HKD']
const ZERO = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF', 'UGX', 'XOF', 'XAF'])

/** Convert amount between two currencies given rates quoted against one base (rates[code] = units of code per 1 base). */
export const convert = (amount, from, to, rates) => (amount / rates[from]) * rates[to]

/** Fetch rates: ECB via Frankfurter first, open.er-api.com for the rest (or everything if Frankfurter is down). */
export async function fetchRates(signal, fetcher = fetch) {
  const get = async (url) => { const r = await fetcher(url, { signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }
  const [fr, er] = await Promise.allSettled([get(FRANKFURTER), get(ER_API)])
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  const rates = {}
  const from = {}
  let date = null
  let source = ''
  if (er.status === 'fulfilled' && er.value?.result === 'success' && er.value.rates) {
    for (const [c, r] of Object.entries(er.value.rates)) { rates[c] = r; from[c] = 'er' }
    date = new Date(er.value.time_last_update_unix * 1000).toISOString().slice(0, 10)
    source = 'open.er-api.com'
  }
  if (fr.status === 'fulfilled' && fr.value?.rates) {
    rates.USD = 1
    for (const [c, r] of Object.entries(fr.value.rates)) { rates[c] = r; from[c] = 'ecb' }
    from.USD = 'ecb'
    date = fr.value.date
    source = er.status === 'fulfilled' ? 'European Central Bank via Frankfurter (extra currencies from open.er-api.com)' : 'European Central Bank via Frankfurter'
  }
  if (!Object.keys(rates).length) throw new Error('Could not reach either exchange rate service.')
  return { rates, from, date, source, ts: Date.now() }
}

const CSS = `
.fx-swap { width: 46px; height: 46px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); color: var(--accent); cursor: pointer; display: grid; place-items: center; box-shadow: var(--shadow-sm); transition: transform .5s var(--spring), background .2s, border-color .2s; }
.fx-swap:hover { background: var(--accent-soft); border-color: var(--accent); }
.fx-swap .icon { transition: transform .5s var(--spring); }
.fx-swap.spin .icon { transform: rotate(180deg); }
.fx-pair { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; }
.fx-pair .cm-field { grid-column: 1; }
.fx-pair .fx-swap { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
.fx-row { display: grid; grid-template-columns: 146px minmax(0, 1fr); gap: 10px; align-items: center; }
.fx-row .select { height: 46px; border-radius: 14px; font-weight: 700; }
.fx-val { min-width: 0; }
.fx-val b { display: block; font-size: 19px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.fx-val span { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.fx-src { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); }
.fx-src .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 0 rgba(34, 197, 94, .6); animation: pulse 2s infinite; flex: none; }
.fx-src .dot.stale { background: #f59e0b; animation: none; }
@media (max-width: 420px) { .fx-row { grid-template-columns: 124px minmax(0, 1fr); } }
`

export async function mount(root, { signal }) {
  style('fx-style', CSS)
  const sel = load('cm:fx:sel', null)
  let from = sel?.from || 'USD'
  let targets = sel?.targets?.length ? [...sel.targets] : ['INR', 'EUR', 'GBP']
  let data = null
  let stale = false
  let loading = false

  const amount = num('Amount', { value: 100, min: 0, max: 1e15 })
  const fromSel = h('select', { class: 'select cm-sel', 'aria-label': 'From currency', onchange: () => { from = fromSel.value; saveSel(); update(); trend() } })
  const swap = h('button', { type: 'button', class: 'fx-swap', 'aria-label': 'Swap the two currencies', title: 'Swap', onclick: () => {
    const t0 = targets[0]
    targets[0] = from
    from = t0
    swap.classList.toggle('spin')
    fillSelects(); saveSel(); update(); trend()
  } }, icon('arrow-up-down'))
  const rowsHost = h('div', { class: 'cm-stack' })
  const addBtn = button('Add a currency', { icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => { const used = new Set([from, ...targets]); const next = ['EUR', 'USD', 'GBP', 'INR', 'JPY', 'AUD', 'CAD'].find((c) => !used.has(c) && data?.rates[c]) || Object.keys(data.rates).find((c) => !used.has(c)); targets.push(next); fillSelects(); saveSel(); update() } })
  const refresh = button('Refresh rates', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', onClick: () => load_(true) })
  const srcLine = h('div', { class: 'fx-src' })
  const status = h('div')
  const hr = hero({ label: 'Converted', tone: 'ocean', icon: 'coins' })
  const trendChart = chartBox({ height: 240, ariaLabel: 'Exchange rate over the last 30 days' })
  const trendCard = card('Last 30 days', { icon: 'chart-line' }, trendChart)
  trendCard.hidden = true

  const names = (() => { try { return new Intl.DisplayNames(['en'], { type: 'currency' }) } catch { return null } })()
  const valid = (() => { try { return new Set(Intl.supportedValuesOf('currency')) } catch { return null } })()
  const nameOf = (c) => { try { return names?.of(c) || c } catch { return c } }
  const dgt = (c) => (ZERO.has(c) ? 0 : 2)

  function codes() {
    if (!data) return []
    return Object.keys(data.rates).filter((c) => /^[A-Z]{3}$/.test(c) && (!valid || valid.has(c)) && Number.isFinite(data.rates[c]) && data.rates[c] > 0)
  }
  function selectOptions(current) {
    const all = codes()
    const pop = POPULAR.filter((c) => all.includes(c))
    const rest = all.filter((c) => !pop.includes(c)).sort()
    const opt = (c) => h('option', { value: c, selected: c === current }, `${c} - ${nameOf(c)}`)
    return [h('optgroup', { label: 'Popular' }, pop.map(opt)), h('optgroup', { label: 'All currencies' }, rest.map(opt))]
  }
  function fillSelects() {
    if (!data) return
    const all = codes()
    if (!all.includes(from)) from = 'USD'
    targets = targets.map((c) => (all.includes(c) ? c : 'EUR'))
    fromSel.replaceChildren(...selectOptions(from))
    fromSel.value = from
    rowsHost.replaceChildren(...targets.map((c, i) => {
      const s = h('select', { class: 'select cm-sel', 'aria-label': `To currency ${i + 1}`, onchange: () => { targets[i] = s.value; saveSel(); update(); if (i === 0) trend() } }, selectOptions(c))
      s.value = c
      const val = h('div', { class: 'fx-val' }, h('b'), h('span'))
      const rm = targets.length > 1 ? button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${c}`, onClick: () => { targets.splice(i, 1); fillSelects(); saveSel(); update(); if (i === 0) trend() } }) : null
      return h('div', { class: 'fx-row', 'data-i': i }, s, h('div', { class: 'row', style: { flexWrap: 'nowrap', justifyContent: 'space-between' } }, val, rm))
    }))
    addBtn.hidden = targets.length >= 8
  }
  const saveSel = () => save('cm:fx:sel', { from, targets })

  function update() {
    if (!data) return
    const bad = firstIssue(amount)
    srcLine.replaceChildren(h('span', { class: ['dot', stale && 'stale'] }), h('span', `Rates dated ${data.date}. Source: ${data.source}. Fetched ${ago(data.ts)}${stale ? ' (saved copy, could not refresh)' : ''}.`))
    if (bad) { hr.empty(bad); return }
    const a = amount.val()
    const top = targets[0]
    const r = (x) => convert(1, from, x, data.rates)
    const main = convert(a, from, top, data.rates)
    hr.set({
      n: main, fmt: (v) => money(v, top, dgt(top)), label: `${fnum(a, 4)} ${from} is`,
      sub: `1 ${from} = ${fnum(r(top), 4)} ${top}   |   1 ${top} = ${fnum(1 / r(top), 4)} ${from}`,
      chips: [{ label: 'Rate date', value: data.date }, { label: 'Source', value: data.from[from] === 'er' || data.from[top] === 'er' ? 'open.er-api.com' : 'ECB' }],
      copy: `${money(a, from, dgt(from))} = ${money(main, top, dgt(top))} (1 ${from} = ${fnum(r(top), 4)} ${top}, rates of ${data.date})`,
    })
    ;[...rowsHost.querySelectorAll('.fx-row')].forEach((row, i) => {
      const c = targets[i]
      row.querySelector('b').textContent = money(convert(a, from, c, data.rates), c, dgt(c))
      row.querySelector('.fx-val span').textContent = `1 ${from} = ${fnum(r(c), 4)} ${c}`
    })
  }

  const ago = (ts) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }

  async function load_(force) {
    if (loading) return
    const cached = load(CACHE_KEY, null)
    if (!force && cached && Date.now() - cached.ts < MAX_AGE && cached.rates) { data = cached; stale = false; ready(); return }
    loading = true
    refresh.disabled = true
    status.replaceChildren(h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), 'Getting the latest rates...'))
    try {
      data = await fetchRates(signal)
      stale = false
      save(CACHE_KEY, data)
      status.replaceChildren()
      ready()
    } catch (e) {
      if (signal.aborted) return
      if (cached?.rates) { data = cached; stale = true; status.replaceChildren(alert('warn', 'Could not refresh the rates. Showing the last saved ones.')); ready() } else {
        status.replaceChildren(alert('error', h('strong', 'No exchange rates available. '), 'Check your connection and try again. ', button('Try again', { size: 'sm', variant: 'secondary', onClick: () => load_(true) })))
      }
    } finally { loading = false; refresh.disabled = false }
  }
  function ready() { status.replaceChildren(...(stale ? [alert('warn', 'Could not refresh the rates. Showing the last saved ones.')] : [])); fillSelects(); update(); trend() }

  const history = new Map()
  let trendToken = 0
  async function trend() {
    const mine = ++trendToken
    const to = targets[0]
    if (!data || data.from[from] !== 'ecb' || data.from[to] !== 'ecb' || from === to) { trendCard.hidden = true; return }
    const key = `${from}>${to}`
    try {
      let rows = history.get(key)
      if (!rows) {
        const end = new Date()
        const start = new Date(Date.now() - 35 * 86400000)
        const iso = (d) => d.toISOString().slice(0, 10)
        const r = await fetch(`https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}?base=${from}&symbols=${to}`, { signal })
        if (!r.ok) throw new Error('no history')
        const j = await r.json()
        rows = Object.entries(j.rates).map(([d, v]) => [d, v[to]]).filter((x) => Number.isFinite(x[1])).sort()
        history.set(key, rows)
      }
      if (mine !== trendToken || signal.aborted || rows.length < 2) { if (rows.length < 2) trendCard.hidden = true; return }
      trendCard.hidden = false
      const change = ((rows.at(-1)[1] - rows[0][1]) / rows[0][1]) * 100
      trendCard.querySelector('h2').lastChild.textContent = `${from} to ${to}, last 30 days (${change >= 0 ? '+' : ''}${fnum(change, 2)}%)`
      trendChart.render({ type: 'line', labels: rows.map((x) => x[0].slice(5)), datasets: [{ label: `1 ${from} in ${to}`, data: rows.map((x) => x[1]), color: 0 }], legend: false, format: (v) => `${fnum(v, 4)} ${to}`, axisFormat: (v) => fnum(v, 2), beginAtZero: false })
    } catch { if (mine === trendToken) trendCard.hidden = true }
  }

  amount.input.addEventListener('input', update)
  const inputs = card('Convert', { icon: 'coins', right: refresh }, stack(
    h('div', { class: 'fx-pair' }, amount, block('From', fromSel), swap),
    block('To', rowsHost), h('div', { class: 'row' }, addBtn), srcLine))
  shell(root, status, layout([inputs], [hr.el, note('Rates are reference rates from the European Central Bank, not what a bank or card will charge: those add a margin and fees. Rates for the extra currencies come from open.er-api.com.')], trendCard))
  await load_(false)
}
