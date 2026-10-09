// Find & replace: plain or regex, case, whole word, match count, an inline before/after preview and a regex timeout guard.
// compile(), scan(), buildResult() and expand() are pure and exported for tests. Regex scans run in a worker so a runaway pattern
// (catastrophic backtracking) cannot freeze the tab; it is stopped after two seconds.
import { h, button, debounce } from '../../lib/ui.js'
import {
  root, dock, group, chips, ribbon, pane, area, createOptions, copyBtn, saveBtn, inputActions, acceptFiles, chipButton, flash, plural, injectStyle, tooBig,
} from './_shared.js'

const CAP = 200000
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORD = '[\\p{L}\\p{N}_]'

/** Build a RegExp from the options, or return {error}. */
export function compile(o) {
  if (!o.find) return { re: null }
  let src = o.regex ? o.find : escapeRe(o.find)
  if (o.whole) src = `(?<!${WORD})(?:${src})(?!${WORD})`
  const base = `g${o.matchCase ? '' : 'i'}${o.regex && o.lineMode ? 'm' : ''}${o.regex && o.dotAll ? 's' : ''}`
  let first
  for (const flags of [`${base}u`, base]) {
    try { return { re: new RegExp(src, flags), source: src, flags } } catch (e) { first ||= e }
  }
  return { error: String(first.message || first).replace(/^Invalid regular expression: /, '') }
}

/** All matches of a global regex, capped. Self-contained so it can also run inside a worker. */
export function scan(re, text, cap) {
  const matches = []
  let capped = false
  for (const m of text.matchAll(re)) {
    if (matches.length >= cap) { capped = true; break }
    matches.push({ i: m.index, t: m[0], g: m.slice(1), named: m.groups ? { ...m.groups } : null })
  }
  return { matches, capped }
}

/** Expand $1, $&, $<name>, $$ and friends (regex mode only) after the optional \n \t escapes. */
export function expand(tpl, m, text) {
  return tpl.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]*>)/g, (all, k) => {
    if (k === '$') return '$'
    if (k === '&') return m.t
    if (k === '`') return text.slice(0, m.i)
    if (k === "'") return text.slice(m.i + m.t.length)
    if (k[0] === '<') { const v = m.named?.[k.slice(1, -1)]; return v === undefined ? all : v ?? '' }
    let num = Number(k)
    let tail = ''
    if (k.length === 2 && num > m.g.length) { tail = k[1]; num = Number(k[0]) }
    return num >= 1 && num <= m.g.length ? (m.g[num - 1] ?? '') + tail : all
  })
}

const unescape = (s) => s.replace(/\\([nrt\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\' }[c]))

/** Replacement text for each match plus the final string. */
export function buildResult(text, matches, o) {
  const tpl = o.escapes ? unescape(o.replace) : o.replace
  let out = ''
  let pos = 0
  const reps = matches.map((m) => (o.regex ? expand(tpl, m, text) : tpl))
  matches.forEach((m, k) => { out += text.slice(pos, m.i) + reps[k]; pos = m.i + m.t.length })
  return { text: out + text.slice(pos), reps }
}

const lineCount = (text, matches) => {
  const seen = new Set()
  let line = 0, at = 0
  for (const m of matches) {
    for (let i = text.indexOf('\n', at); i !== -1 && i < m.i; i = text.indexOf('\n', at)) { line++; at = i + 1 }
    seen.add(line)
  }
  return seen.size
}

const WORKER_SRC = `const scan = ${scan.toString()}
self.onmessage = (e) => {
  const { text, source, flags, cap } = e.data
  try { self.postMessage({ ok: true, ...scan(new RegExp(source, flags), text, cap) }) } catch (err) { self.postMessage({ ok: false, error: String(err && err.message || err) }) }
}`

const CSS = `
.tu-fr-fields { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; align-items: end; width: 100%; }
.tu-fr-fields .tu-group { width: 100%; }
.tu-fr-fields .input { width: 100%; }
.tu-fr-fields .input.invalid { border-color: var(--danger); box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 16%, transparent); }
.tu-fr-fields .btn { margin-bottom: 2px; }
.tu-doc { position: relative; }
.tu-prev-empty { color: var(--muted); padding: 30px 16px; text-align: center; }
@media (max-width: 720px) { .tu-fr-fields { grid-template-columns: minmax(0, 1fr); } .tu-fr-fields .btn { justify-self: start; margin: 0; } }
`

const PRESETS = [
  ['Extra spaces', { find: ' {2,}', replace: ' ', regex: true }],
  ['Trailing spaces', { find: '[ \\t]+$', replace: '', regex: true, lineMode: true }],
  ['Blank lines', { find: '^\\s*\\n', replace: '', regex: true, lineMode: true }],
  ['Digits', { find: '\\d+', replace: '#', regex: true }],
  ['HTML tags', { find: '<[^>]*>', replace: '', regex: true }],
  ['Swap "a, b"', { find: '(\\w+), (\\w+)', replace: '$2, $1', regex: true }],
]

const SAMPLE = 'Order 1042 shipped to Mumbai on 12/03/2024.\nOrder 1043 shipped to Pune on 14/03/2024.\nThe order was late, so order 1044 gets a discount.\nCall 98765 43210 for the Order status.'

export function mount(rootEl, { tool }) {
  injectStyle()
  if (!document.getElementById('tu-fr-style')) document.head.append(h('style', { id: 'tu-fr-style' }, CSS))
  const o = createOptions(tool.id, { find: '', replace: '', matchCase: false, whole: false, regex: false, lineMode: false, dotAll: false, escapes: true, view: 'preview' })
  const input = area({ placeholder: 'Type or paste your text here...', mono: true, 'aria-label': 'Text to search' })
  const prevBox = h('div', { class: 'tu-doc', 'aria-label': 'Preview of the changes' })
  const output = area({ readonly: true, mono: true, 'aria-label': 'Result' })
  const rib = ribbon()
  const inFoot = h('div', { class: 'tu-foot' }, h('span', 'Nothing yet'), h('span'))
  const outFoot = h('div', { class: 'tu-foot' }, h('span'), h('span'))
  const err = h('div', { class: 'tu-err', role: 'alert', hidden: true })
  let latest = ''
  let worker = null
  let seq = 0
  let pending = false

  const findIn = o.text('find', { placeholder: 'Find...', cls: 'wide', ariaLabel: 'Find' })
  const repIn = o.text('replace', { placeholder: 'Replace with...', cls: 'wide', ariaLabel: 'Replace with' })
  const swap = button('', { icon: 'arrow-left-right', variant: 'secondary', size: 'sm', ariaLabel: 'Swap find and replace', onClick: () => o.set({ find: o.v.replace, replace: o.v.find }) })
  const regexOnly = [o.bool('lineMode', '^ and $ match each line'), o.bool('dotAll', 'Dot matches new lines')]
  const regexOpts = group('Regex options', chips(...regexOnly))
  o.show(regexOpts, () => o.v.regex)

  const viewBtns = h('div', { class: 'tu-tabs', role: 'group', 'aria-label': 'View' })
  const vPrev = h('button', { type: 'button', onclick: () => o.set({ view: 'preview' }) }, 'Preview')
  const vRes = h('button', { type: 'button', onclick: () => o.set({ view: 'result' }) }, 'Result')
  viewBtns.append(vPrev, vRes)

  const inPane = pane({ title: 'Your text', body: input, foot: inFoot, actions: inputActions({ ta: input, sample: () => { if (!o.v.find) o.set({ find: 'order', replace: 'ticket' }); return SAMPLE }, onChange: () => refresh() }) })
  const outPane = pane({
    title: 'After replacing', out: true, body: [prevBox, output], foot: outFoot,
    actions: [viewBtns, button('', { icon: 'corner-up-left', variant: 'ghost', size: 'sm', ariaLabel: 'Use the result as input', onClick: () => { if (latest) { input.value = latest; refresh() } } }), saveBtn(() => latest, 'replaced.txt'), copyBtn(() => latest, 'Copy')],
  })
  acceptFiles(inPane, (t) => { input.value = t; refresh() })

  const presets = chips(...PRESETS.map(([label, p]) => chipButton(label, () => o.set({ matchCase: false, whole: false, lineMode: false, dotAll: false, ...p }))))
  const controls = dock(
    h('div', { class: 'tu-fr-fields' }, group('Find', findIn), swap, group('Replace with', repIn)),
    group('Options', chips(o.bool('matchCase', 'Match case'), o.bool('whole', 'Whole word'), o.bool('regex', 'Regular expression'), o.bool('escapes', '\\n and \\t in Replace', 'Type \\n for a new line and \\t for a tab'))),
    regexOpts,
    group('Try a pattern', presets),
    err)

  function showView() {
    const prev = o.v.view === 'preview'
    vPrev.setAttribute('aria-pressed', String(prev)); vRes.setAttribute('aria-pressed', String(!prev))
    prevBox.hidden = !prev; output.hidden = prev
  }

  function draw(text, matches, capped, built) {
    latest = built.text
    output.value = latest
    // inline preview
    prevBox.replaceChildren()
    if (!matches.length) prevBox.append(h('div', { class: 'tu-prev-empty' }, o.v.find ? 'No matches. The text is unchanged.' : 'Type something in Find to see matches and replacements here.'))
    else {
      const LIM = 400, TXT = 80000
      let pos = 0
      const kids = []
      matches.slice(0, LIM).forEach((m, k) => {
        if (m.i > TXT) return
        kids.push(text.slice(pos, m.i), h('del', m.t || '∅'))
        if (built.reps[k] !== '') kids.push(h('ins', built.reps[k]))
        pos = m.i + m.t.length
      })
      kids.push(text.slice(pos, Math.min(text.length, Math.max(pos, TXT))))
      prevBox.append(...kids)
      if (matches.length > LIM || text.length > TXT) prevBox.append(h('div', { class: 'tu-hint', style: 'margin-top:10px' }, `Preview shows the first ${LIM} matches. The Result tab has everything.`))
    }
    flash(outPane)
    const lines = lineCount(text, matches)
    const delta = latest.length - text.length
    rib.set(text && o.v.find ? [
      { label: matches.length === 1 ? 'match' : 'matches', value: capped ? `${CAP.toLocaleString()}+` : matches.length, tone: matches.length ? 'accent' : 'warn' },
      ...(matches.length ? [{ label: lines === 1 ? 'line changed' : 'lines changed', value: lines }, { label: 'characters', value: `${delta >= 0 ? '+' : ''}${delta.toLocaleString()}`, tone: delta ? 'good' : '' }] : []),
    ] : [], capped ? 'Too many matches to show everything. Narrow the search.' : (!o.v.find && text ? 'Type something in Find to start.' : ''))
    outFoot.firstChild.textContent = latest ? `${[...latest].length.toLocaleString()} chars` : ''
  }

  function setError(message) {
    err.hidden = !message
    err.replaceChildren(...(message ? [h('span', message)] : []))
    findIn.classList.toggle('invalid', !!message)
  }

  function ensureWorker() {
    if (worker) return worker
    try {
      worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })))
    } catch { worker = null }
    return worker
  }

  function refresh() {
    const text = input.value
    if (tooBig(text)) { seq++; setError(tooBig(text)); rib.set([{ label: 'too much text', value: '!', tone: 'bad' }]); return }
    inFoot.firstChild.textContent = text ? `${[...text].length.toLocaleString()} chars · ${plural(text.split('\n').length, 'line')}` : 'Nothing yet'
    showView()
    const c = compile(o.v)
    setError(c.error ? `This pattern is not valid: ${c.error}` : '')
    const mine = ++seq
    if (c.error || !c.re) {
      latest = text; output.value = text
      prevBox.replaceChildren(h('div', { class: 'tu-prev-empty' }, c.error ? 'Fix the pattern to see matches.' : 'Type something in Find to see matches and replacements here.'))
      rib.set(c.error ? [{ label: 'invalid pattern', value: '!', tone: 'bad' }] : [], text && !c.error ? 'Type something in Find to start.' : '')
      outFoot.firstChild.textContent = ''
      return
    }
    const finish = (r) => { if (mine === seq) draw(text, r.matches, r.capped, buildResult(text, r.matches, o.v)) }
    if (!o.v.regex) return finish(scan(c.re, text, CAP))
    if (pending) { worker?.terminate(); worker = null }
    const w = ensureWorker()
    if (!w) {
      try { return finish(scan(c.re, text, CAP)) } catch (e) { return setError(String(e.message || e)) }
    }
    pending = true
    const timer = setTimeout(() => {
      if (mine !== seq) return
      pending = false
      w.terminate(); worker = null
      setError('This pattern took too long on your text. Check for nested repeats like (a+)+ and try a simpler one.')
      rib.set([{ label: 'pattern too slow', value: '!', tone: 'bad' }])
    }, 2000)
    w.onmessage = (e) => {
      clearTimeout(timer)
      if (mine !== seq) return
      pending = false
      if (!e.data.ok) { setError(e.data.error); return }
      finish(e.data)
    }
    w.postMessage({ text, source: c.source, flags: c.flags, cap: CAP })
  }

  const slow = debounce(refresh, 140)
  o.onChange = () => (o.v.regex ? slow() : refresh())
  input.addEventListener('input', () => (input.value.length > 30000 || o.v.regex ? slow() : refresh()))
  rootEl.append(root(controls, rib.el, h('div', { class: 'tu-panes' }, inPane, outPane)))
  refresh()
  input.focus({ preventScroll: true })
  return () => { seq++; worker?.terminate(); worker = null }
}
