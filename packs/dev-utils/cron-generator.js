// Cron expression generator (params.mode 'generate') and calculator (params.mode 'explain'): visual builder, plain-English description
// (cronstrue 3.27.0), next run times in any time zone, validation, and snippets for crontab, GitHub Actions, Kubernetes, Spring and AWS.
import { h, icon, button, input, number, select, segmented, toggle, table, alert, clear, copyText } from '../../lib/ui.js'
import { script } from '../../lib/libs.js'
import { useKit, css, chips, eyebrow, pill, outBox, hashParams } from './_kit.js'
import { DIALECTS, FIELD_LABEL, MONTHS, DOWS, splitCron, parseField, validateCron, nextRuns, expandField } from './_cron.js'
import { relative, zoneList, canonicalZone } from './timestamp-converter.js'

const CRONSTRUE = 'https://cdn.jsdelivr.net/npm/cronstrue@3.27.0/dist/cronstrue.min.js'
let csFailedAt = 0
const loadCronstrue = () => {
  if (globalThis.cronstrue) return Promise.resolve(globalThis.cronstrue)
  if (Date.now() - csFailedAt < 20000) return Promise.resolve(null)
  return script(CRONSTRUE).then(() => globalThis.cronstrue).catch(() => { csFailedAt = Date.now(); return null })
}

const DEFS = {
  sec: { lo: 0, hi: 59, unit: 'second' }, min: { lo: 0, hi: 59, unit: 'minute' }, hour: { lo: 0, hi: 23, unit: 'hour' },
  dom: { lo: 1, hi: 31, unit: 'day' }, mon: { lo: 1, hi: 12, unit: 'month' }, dow: { lo: 0, hi: 6, unit: 'weekday' }, year: { lo: 2026, hi: 2060, unit: 'year' },
}
const ALL_KEYS = ['sec', 'min', 'hour', 'dom', 'mon', 'dow', 'year']
const nameOf = (key, v) => (key === 'mon' ? MONTHS[v - 1] : key === 'dow' ? DOWS[v] : String(v))
const labelOf = (key, v) => (key === 'mon' ? MONTHS[v - 1][0] + MONTHS[v - 1].slice(1).toLowerCase() : key === 'dow' ? DOWS[v][0] + DOWS[v].slice(1).toLowerCase() : String(v))
const tokVal = (key, tok) => {
  const u = tok.toUpperCase()
  if (key === 'mon') { const i = MONTHS.indexOf(u); if (i >= 0) return i + 1 }
  if (key === 'dow') { const i = DOWS.indexOf(u); if (i >= 0) return i }
  return /^\d+$/.test(tok) ? +tok : NaN
}

const PRESETS = {
  std: [['* * * * *', 'Every minute'], ['*/5 * * * *', 'Every 5 minutes'], ['*/15 * * * *', 'Every 15 minutes'], ['0 * * * *', 'Every hour'], ['0 9 * * *', 'Daily at 9:00'], ['0 9 * * 1-5', 'Weekdays at 9:00'],
    ['*/10 9-17 * * 1-5', 'Every 10 min, office hours'], ['30 18 * * 5', 'Fridays at 18:30'], ['0 0 * * 0', 'Sunday midnight'], ['0 0 1,15 * *', '1st and 15th'], ['0 0 1 * *', 'Monthly, 1st'], ['0 0 1 1 *', 'Yearly, 1 Jan']],
  sec: [['* * * * * *', 'Every second'], ['*/10 * * * * *', 'Every 10 seconds'], ['0 */5 * * * *', 'Every 5 minutes'], ['0 0 * * * *', 'Every hour'], ['30 0 9 * * *', 'Daily at 9:00:30'], ['0 0 9 * * 1-5', 'Weekdays at 9:00']],
  quartz: [['0 0/5 * * * ?', 'Every 5 minutes'], ['0 15 10 ? * MON-FRI', 'Weekdays at 10:15'], ['0 0 12 L * ?', 'Last day, noon'], ['0 0 9 LW * ?', 'Last weekday, 9:00'], ['0 0 12 ? * 6#3', 'Third Friday, noon'], ['0 0 8 15W * ?', 'Nearest weekday to 15th'], ['0 0 0 1 1 ? *', 'New Year, every year']],
}

const STYLE = `
.t-cr .cr-expr { font-family: var(--mono); font-size: clamp(18px, 3.4vw, 26px); height: 58px; letter-spacing: .02em; }
.t-cr .cr-tokens { display: flex; flex-wrap: wrap; gap: 8px; }
.t-cr .cr-tok { display: grid; gap: 2px; justify-items: center; min-width: 64px; padding: 8px 10px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); transition: border-color .2s, background .2s; }
.t-cr .cr-tok b { font-family: var(--mono); font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.t-cr .cr-tok span { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.t-cr .cr-tok.bad { border-color: var(--danger); background: var(--danger-soft); }
.t-cr .cr-desc { font-size: clamp(19px, 3.2vw, 28px); font-weight: 650; letter-spacing: -.02em; line-height: 1.25; }
.t-cr .cr-desc.err { color: var(--danger); }
.t-cr .cr-ed { padding: 14px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); display: grid; gap: 10px; align-content: start; min-width: 0; }
.t-cr .cr-ed > b { font-size: 13.5px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.t-cr .cr-ed > b code { font-family: var(--mono); font-size: 12px; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 8px; font-weight: 500; }
.t-cr .cr-ed .seg { width: 100%; display: grid; grid-template-columns: repeat(5, 1fr); }
.t-cr .cr-ed .seg button { padding: 0 4px; font-size: 12.5px; min-width: 0; }
.t-cr .cr-picks { display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap: 5px; max-height: 190px; overflow: auto; padding: 2px; }
.t-cr .cr-picks.wide { grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); }
.t-cr .cr-picks button { min-height: 32px; border-radius: 9px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font-size: 12.5px; font-family: var(--mono); transition: background .15s, color .15s, transform .15s var(--spring); }
.t-cr .cr-picks button:hover { border-color: var(--accent); }
.t-cr .cr-picks button[aria-pressed="true"] { background: var(--accent); color: var(--accent-text); border-color: var(--accent); transform: scale(1.04); }
.t-cr .cr-eds { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 12px; }
.t-cr .cr-eds [hidden] { display: none; }
.t-cr .cr-in { color: var(--muted); font-size: 12.5px; }
`

export async function mount(root, { params = {} } = {}) {
  useKit()
  css('t-cr-css', STYLE)
  const explain = params.mode === 'explain'
  const q = hashParams()
  let dialect = ['std', 'sec', 'quartz'].includes(q.get('d')) ? q.get('d') : 'std'
  let dialectChoice = explain ? 'auto' : dialect
  let tz = canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  let use24 = false
  let runCount = 10
  const F = { sec: '0', min: '0', hour: '9', dom: '*', mon: '*', dow: '1-5', year: '*' }
  const editors = {}
  let syncing = false

  const expr = input({ class: 'cr-expr', mono: true, placeholder: '*/5 * * * *', 'aria-label': 'Cron expression', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' })
  expr.style.cssText = 'height:58px;font-size:clamp(18px,3.4vw,26px);letter-spacing:.02em'
  const tokens = h('div', { class: 'cr-tokens', 'aria-hidden': 'true' })
  const status = h('div', { class: 'row', style: 'min-height:28px' })
  const desc = h('div', { class: 'cr-desc', 'aria-live': 'polite' })
  const descSub = h('div', { class: 'small muted' })
  const runsEl = h('div')
  const breakdown = h('div')
  const presetsEl = h('div', { class: 'dv-chips' })
  const editorsEl = h('div', { class: 'cr-eds' })

  const tzList = zoneList()
  const tzSel = select([[tz, `Your zone (${tz})`], ...(tz === 'UTC' ? [] : [['UTC', 'UTC']]), ...tzList.filter((z) => z !== tz && z !== 'UTC').map((z) => [z, z.replace(/_/g, ' ')])], tz, (v) => { tz = v; runCount = 10; refresh() })
  tzSel.setAttribute('aria-label', 'Time zone for upcoming runs')
  const h24 = toggle('24-hour clock', false, (v) => { use24 = v; refresh() })

  const keys = () => DIALECTS[dialect].keys
  const compose = () => keys().map((k) => F[k]).join(' ')

  // ---------- dialect conversion ----------
  function convert(from, to) {
    if (from === to) return
    if (to === 'quartz') {
      // Quartz needs "?" in one of the two day fields; keep whichever one carries the restriction
      if (F.dom !== '?' && F.dow !== '?') { if (F.dow === '*') F.dow = '?'; else F.dom = '?' }
    } else if (from === 'quartz') {
      if (F.dom === '?') F.dom = '*'
      if (F.dow === '?') F.dow = '*'
    }
  }

  // ---------- visual editors ----------
  function makeEditor(key) {
    const { lo, hi, unit } = DEFS[key]
    const names = key === 'mon' || key === 'dow'
    const canStep = key !== 'dow' && key !== 'year'
    let kind = 'every'
    let stepN = 5
    let start = lo
    let picks = new Set()
    let from = lo
    let to = hi
    let raw = '*'
    const vals = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
    const kinds = [['every', 'Every'], ['step', 'Step'], ['pick', 'Pick'], ['range', 'Range'], ['raw', 'Custom']]
    const seg = segmented(kinds.filter(([k]) => canStep || k !== 'step'), kind, (k) => { if (k === 'pick') picks = valuesOf(text()); kind = k; paint(); emit() }, `${FIELD_LABEL[key]} mode`)
    if (!canStep) seg.style.gridTemplateColumns = 'repeat(4, 1fr)'
    const body = h('div', { class: 'stack tight' })
    const code = h('code')
    const title = h('b', FIELD_LABEL[key], code)
    const el = h('div', { class: 'cr-ed', dataset: { key } }, title, seg, body)
    const valuesOf = (t) => { try { const p = parseField(key, t, 'std'); return p.any ? new Set() : new Set([...p.values].filter((v) => v >= lo && v <= hi)) } catch { return new Set() } }
    const text = () => {
      if (kind === 'every') return '*'
      if (kind === 'step') return `${start === lo ? '*' : start}/${Math.max(1, stepN)}`
      if (kind === 'pick') return picks.size ? [...picks].sort((a, b) => a - b).map((v) => nameOf(key, v)).join(',') : '*'
      if (kind === 'range') return `${nameOf(key, from)}-${nameOf(key, to)}`
      return raw
    }
    const api = { el, key, text, onChange: null }
    const emit = () => { code.textContent = text(); api.onChange?.(text()) }
    function paint() {
      seg.set(kind)
      clear(body)
      if (kind === 'every') body.append(h('div', { class: 'small muted' }, key === 'year' ? 'Every year.' : `Runs every ${unit}.`))
      else if (kind === 'step') {
        const n = number(stepN, { min: 1, max: hi, step: 1, ariaLabel: `${FIELD_LABEL[key]} step`, onInput: (v) => { stepN = Number.isFinite(v) && v > 0 ? Math.round(v) : 1; emit() } })
        const st = select(vals.map((v) => [v, labelOf(key, v)]), start, (v) => { start = +v; emit() })
        st.setAttribute('aria-label', `${FIELD_LABEL[key]} start`)
        body.append(h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, `Every N ${unit}s`), n), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Starting at'), st)))
      } else if (kind === 'pick') {
        const grid = h('div', { class: ['cr-picks', names && 'wide'], role: 'group', 'aria-label': `Pick ${FIELD_LABEL[key].toLowerCase()} values` }, vals.map((v) => h('button', {
          type: 'button', 'aria-pressed': String(picks.has(v)),
          onclick: (e) => { picks.has(v) ? picks.delete(v) : picks.add(v); e.currentTarget.setAttribute('aria-pressed', String(picks.has(v))); emit() },
        }, labelOf(key, v))))
        body.append(grid, h('div', { class: 'small muted' }, picks.size ? `${picks.size} selected` : 'Select one or more values.'))
      } else if (kind === 'range') {
        const a = select(vals.map((v) => [v, labelOf(key, v)]), from, (v) => { from = +v; emit() })
        const b = select(vals.map((v) => [v, labelOf(key, v)]), to, (v) => { to = +v; emit() })
        a.setAttribute('aria-label', `${FIELD_LABEL[key]} from`); b.setAttribute('aria-label', `${FIELD_LABEL[key]} to`)
        body.append(h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'From'), a), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Through'), b)))
      } else {
        const inp = input({ mono: true, value: raw, 'aria-label': `${FIELD_LABEL[key]} expression`, spellcheck: false, oninput: (e) => { raw = e.target.value.trim() || '*'; emit() } })
        const extras = key === 'dom' ? ['?', 'L', 'LW', '15W', 'L-3'] : key === 'dow' ? ['?', '6L', '6#3', '2#1'] : []
        body.append(inp, extras.length && dialect === 'quartz' ? h('div', { class: 'dv-chips' }, extras.map((x) => h('button', { type: 'button', class: 'dv-chip mono', onclick: () => { raw = x; inp.value = x; emit() } }, x))) : null,
          h('div', { class: 'small muted' }, 'Any valid cron syntax for this field: lists (1,15), ranges (1-5), steps (*/10)' + (key === 'dom' || key === 'dow' ? ', and Quartz symbols' : '') + '.'))
      }
      code.textContent = text()
    }
    api.set = (t) => {
      raw = t
      let m
      if (t === '*') kind = 'every'
      else if (canStep && (m = /^\*\/(\d+)$/.exec(t))) { kind = 'step'; stepN = +m[1]; start = lo }
      else if (canStep && (m = /^(\d+)\/(\d+)$/.exec(t)) && +m[1] >= lo && +m[1] <= hi) { kind = 'step'; start = +m[1]; stepN = +m[2] }
      else if ((m = /^(\w+)-(\w+)$/.exec(t)) && !Number.isNaN(tokVal(key, m[1])) && !Number.isNaN(tokVal(key, m[2])) && tokVal(key, m[1]) >= lo && tokVal(key, m[2]) <= hi) { kind = 'range'; from = tokVal(key, m[1]); to = tokVal(key, m[2]) }
      else if (/^\w+(,\w+)*$/.test(t) && t.split(',').every((x) => tokVal(key, x) >= lo && tokVal(key, x) <= hi)) { kind = 'pick'; picks = new Set(t.split(',').map((x) => tokVal(key, x))) }
      else kind = 'raw'
      if (key === 'dow' && /^\d/.test(t) && dialect === 'quartz' && kind !== 'raw') kind = 'raw' // Quartz weekday numbers are 1-7, keep them as written
      paint()
    }
    paint()
    return api
  }
  for (const k of ALL_KEYS) {
    editors[k] = makeEditor(k)
    editors[k].onChange = (t) => { F[k] = t; syncing = true; expr.value = compose(); syncing = false; refresh() }
  }
  editorsEl.append(...ALL_KEYS.map((k) => editors[k].el))

  // ---------- dialect control ----------
  const dialectSeg = segmented(explain ? [['auto', 'Auto-detect'], ['std', '5 fields'], ['sec', '6 + seconds'], ['quartz', 'Quartz']] : [['std', 'Standard (5)'], ['sec', 'Seconds (6)'], ['quartz', 'Quartz (6-7)']], dialectChoice, (v) => {
    dialectChoice = v
    if (v === 'auto') { fromExpr(expr.value); return }
    const prev = dialect
    dialect = v
    if (explain) { try { fromExpr(expr.value, true) } catch { /* keep text */ } ; refresh(); return }
    convert(prev, v)
    syncing = true; expr.value = compose(); syncing = false
    for (const k of ALL_KEYS) editors[k].set(F[k])
    refresh()
  }, 'Cron syntax')

  function fromExpr(text, quiet) {
    let parts
    try { parts = splitCron(text, dialectChoice === 'auto' ? 'auto' : dialectChoice) } catch { refresh(); return }
    dialect = parts.dialect
    for (const f of parts.fields) { F[f.key] = f.text; editors[f.key].set(f.text) }
    if (dialect === 'quartz' && !parts.fields.some((f) => f.key === 'year')) { F.year = '*'; editors.year.set('*') }
    if (!quiet) refresh()
  }
  expr.addEventListener('input', () => { if (!syncing) fromExpr(expr.value) })

  // ---------- rendering ----------
  let seq = 0
  async function refresh() {
    const id = ++seq
    const text = expr.value
    for (const k of ALL_KEYS) editors[k].el.hidden = !keys().includes(k)
    clear(presetsEl, ...PRESETS[dialect].map(([e, l]) => h('button', { type: 'button', class: 'dv-chip', title: e, onclick: () => { expr.value = e; fromExpr(e); expr.focus() } }, l)))
    dialectSeg.set(dialectChoice)
    const v = validateCron(text, dialectChoice === 'auto' ? 'auto' : dialect)
    // tokens
    let parts = null
    try { parts = splitCron(text, dialectChoice === 'auto' ? 'auto' : dialect) } catch { /* shown as error below */ }
    clear(tokens, ...(parts ? parts.fields.map((f) => h('div', { class: ['cr-tok', v.field === f.key && 'bad'] }, h('b', f.text), h('span', FIELD_LABEL[f.key]))) : []))
    if (!v.ok) {
      clear(status, pill('bad', 'circle-alert', 'Invalid expression'))
      clear(desc, text.trim() ? h('span', { class: 'err' }, v.error) : h('span', { class: 'muted' }, 'Type or build a cron expression to see what it does.'))
      desc.classList.toggle('err', !!text.trim())
      clear(descSub); clear(runsEl); clear(breakdown)
      return
    }
    desc.classList.remove('err')
    const spec = v.spec
    dialect = spec.dialect
    clear(status, pill('ok', 'check', 'Valid'), pill('info', 'terminal', DIALECTS[dialect].label), h('span', { class: 'small muted' }, spec.raw.map((f) => f.text).join(' ')))
    // description (cronstrue, loaded on first use)
    const norm = spec.raw.map((f) => f.text).join(' ')
    const cs = await loadCronstrue()
    if (id !== seq) return
    let sentence = ''
    try { sentence = cs ? cs.toString(norm, { use24HourTimeFormat: use24, dayOfWeekStartIndexZero: dialect !== 'quartz', throwExceptionOnParseError: true }) : '' } catch { sentence = '' }
    desc.textContent = sentence || 'This schedule is valid. See the field breakdown below.'
    descSub.textContent = cs ? '' : 'The plain-English summary needs a network connection to load its library; the run times below work offline.'
    // upcoming runs
    const showSec = !!spec.fields.sec
    const runs = nextRuns(spec, { tz, count: runCount })
    if (!runs.length) clear(runsEl, alert('warn', 'This schedule never runs in the next 45 years (for example 31 February). Check the day and month fields.'))
    else {
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: showSec ? '2-digit' : undefined, hour12: use24 ? false : true })
      const utc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: showSec ? '2-digit' : undefined, hourCycle: 'h23' })
      const now = Date.now()
      clear(runsEl, table({ columns: ['#', `When (${tz.replace(/_/g, ' ')})`, ...(tz === 'UTC' ? [] : ['UTC']), 'In'], rows: runs.map((t, i) => [String(i + 1), fmt.format(t), ...(tz === 'UTC' ? [] : [utc.format(t)]), relative(t, now)]) }),
        h('div', { class: 'row', style: 'margin-top:10px' },
          runCount < 100 ? button('Show 10 more', { icon: 'plus', size: 'sm', onClick: () => { runCount += 10; refresh() } }) : null,
          button('Copy times', { icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => copyText(runs.map((t) => new Date(t).toISOString()).join('\n')) })))
    }
    clear(breakdown, table({ columns: ['Field', 'Expression', 'Runs when it is'], rows: spec.raw.map((f) => [FIELD_LABEL[f.key], h('code', { style: 'font-family:var(--mono)' }, f.text), summarize(spec.fields[f.key])]) }))
    renderSnippets()
  }
  const summarize = (f) => {
    const t = expandField(f)
    return t.length > 140 ? t.slice(0, 137) + '...' : t
  }

  // ---------- snippets ----------
  const snipKind = chips([['crontab', 'crontab'], ['gha', 'GitHub Actions'], ['k8s', 'Kubernetes'], ['spring', 'Spring'], ['node', 'node-cron'], ['aws', 'AWS EventBridge']], { value: 'crontab', ariaLabel: 'Snippet type', onChange: () => renderSnippets() })
  const snip = outBox('Use it', { placeholder: '' })
  const snipNote = h('div', { class: 'small muted' })
  function renderSnippets() {
    const v = validateCron(expr.value, dialectChoice === 'auto' ? 'auto' : dialect)
    if (!v.ok) { snip.set(''); snipNote.textContent = ''; return }
    const spec = v.spec
    const f = Object.fromEntries(spec.raw.map((x) => [x.key, x.text]))
    const five = [f.min, f.hour, f.dom === '?' ? '*' : f.dom, f.mon, f.dow === '?' ? '*' : f.dow].join(' ')
    const hasSec = !!f.sec
    const plain = spec.dialect === 'std'
    const k = snipKind.value
    let text = ''
    let note = ''
    if (k === 'crontab') { text = `${five} /path/to/command >> /var/log/job.log 2>&1`; note = hasSec ? 'Classic crontab has no seconds field, so the seconds value is dropped.' : '' }
    else if (k === 'gha') { text = `on:\n  schedule:\n    - cron: '${five}'`; note = 'GitHub Actions always uses UTC and runs scheduled workflows at most every 5 minutes.' }
    else if (k === 'k8s') { text = `apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: my-job\nspec:\n  schedule: "${five}"${tz !== 'UTC' ? `\n  timeZone: "${tz}"` : ''}\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          restartPolicy: OnFailure\n          containers:\n            - name: job\n              image: busybox\n              command: ["sh", "-c", "echo hello"]`; note = 'Kubernetes CronJobs use 5 fields; spec.timeZone needs Kubernetes 1.27 or newer.' }
    else if (k === 'spring') {
      const sixRaw = [f.sec ?? '0', f.min, f.hour, f.dom, f.mon, f.dow]
      text = `@Scheduled(cron = "${sixRaw.join(' ')}"${tz !== 'UTC' ? `, zone = "${tz}"` : ''})\npublic void run() {\n    // ...\n}`
      note = plain || spec.dialect === 'sec' ? 'Spring cron has 6 fields: second first, then the usual five.' : 'Spring supports Quartz-style ? L W # in the day fields. A year field is not supported.'
    } else if (k === 'node') { text = `import cron from 'node-cron'\n\ncron.schedule('${hasSec ? [f.sec, five].join(' ') : five}', () => {\n  console.log('running')\n}${tz !== 'UTC' ? `, { timezone: '${tz}' }` : ''})`; note = 'node-cron accepts an optional leading seconds field.' }
    else {
      let dom = f.dom, dow = f.dow
      if (dom !== '?' && dow !== '?') { if (dow === '*') dow = '?'; else if (dom === '*') dom = '?'; else note = 'AWS requires one of day-of-month or day-of-week to be "?". This schedule restricts both, which AWS cannot express in one rule.' }
      text = `cron(${[f.min, f.hour, dom, f.mon, dow, f.year ?? '*'].join(' ')})`
      note = note || 'EventBridge cron has 6 fields (minute to year) and runs in UTC unless you pick a time zone on a schedule.'
    }
    snip.set(text, { quiet: true })
    snipNote.textContent = note
  }

  // ---------- layout ----------
  const exprPanel = h('div', { class: 'panel stack' },
    h('div', { class: 'row between' }, eyebrow('calendar-clock', explain ? 'Paste a cron expression' : 'Cron expression'), dialectSeg),
    expr, tokens, status, h('div', { class: 'row' }, h('span', { class: 'small muted' }, explain ? 'Examples:' : 'Presets:'), presetsEl))
  const hero = h('div', { class: 'dv-hero stack tight' }, eyebrow('sparkles', 'In plain English'), desc, descSub,
    h('div', { class: 'row' }, h('label', { class: 'field', style: 'min-width:200px;flex:1;max-width:360px' }, h('span', { class: 'field-label' }, 'Time zone'), tzSel), h24,
      button('Copy expression', { icon: 'copy', size: 'sm', onClick: () => expr.value && copyText(expr.value) })))
  const builder = explain
    ? h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center;gap:8px' }, icon('sliders-horizontal'), 'Edit visually'), h('div', { style: 'padding-top:14px' }, editorsEl))
    : h('div', { class: 'panel stack' }, eyebrow('sliders-horizontal', 'Build it visually'), editorsEl)

  const stackEls = explain
    ? [exprPanel, hero, h('div', { class: 'panel stack tight' }, eyebrow('calendar-range', 'Next runs'), runsEl), h('div', { class: 'panel stack tight' }, eyebrow('table-2', 'Field by field'), breakdown), builder]
    : [exprPanel, builder, hero, h('div', { class: 'panel stack tight' }, eyebrow('calendar-range', 'Next runs'), runsEl), h('div', { class: 'panel stack tight' }, eyebrow('table-2', 'Field by field'), breakdown)]
  root.append(h('div', { class: 'dv t-cr stack' }, ...stackEls,
    h('div', { class: 'panel stack tight' }, eyebrow('code', 'Use it in your stack'), snipKind, snip.el, snipNote),
    h('p', { class: 'small muted' }, 'Cron times follow the clock of the machine that runs the job. Where both day-of-month and day-of-week are restricted, classic cron runs when either matches. Descriptions come from the cronstrue library; run times are calculated in your browser.')))

  const initial = q.get('e') || (explain ? '*/15 9-17 * * 1-5' : '0 9 * * 1-5')
  expr.value = initial
  fromExpr(initial)
}
