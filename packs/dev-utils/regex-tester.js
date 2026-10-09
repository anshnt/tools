// Regex tester: live highlighting, match list with groups, replace preview, plain-English explanation.
// Matching runs in a Web Worker with a timeout so catastrophic backtracking cannot freeze the page.
import { h, icon, button, input, select, textarea, tabs, split, empty, alert, clear, copyText, onCleanup, formatNumber } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { useKit, css, chips, eyebrow, pill, outBox, hashParams } from './_kit.js'
import { createRunner } from './_regex-run.js'
import { parseRegex, explain } from './_regex-parse.js'
import { asCode } from './_regex-lib.js'

const FLAGS = [
  ['g', 'g', 'global: find all matches'], ['i', 'i', 'ignore case'], ['m', 'm', 'multiline: ^ and $ match at every line'],
  ['s', 's', 'dotAll: . also matches line breaks'], ['u', 'u', 'unicode: code points, \\p{...} and \\u{...}'], ['y', 'y', 'sticky: match only at lastIndex'],
]

const EXAMPLES = [
  { name: 'Emails', pattern: String.raw`(?<user>[\w.+-]+)@(?<domain>[\w-]+(?:\.[\w-]+)+)`, flags: 'g', text: 'Write to asha@example.com or sales.team+india@mail.example.co.in.\nNot an email: user@, @host.com, plain text.', replace: '$<user> at $<domain>' },
  { name: 'Dates', pattern: String.raw`\b(\d{4})-(\d{2})-(\d{2})\b`, flags: 'g', text: 'Released 2026-03-14, patched 2026-04-02, planned 2026-12-31.\nInvalid-looking: 26-3-14.', replace: '$3/$2/$1' },
  { name: 'Hex colors', pattern: String.raw`#(?:[0-9a-f]{3}){1,2}\b`, flags: 'gi', text: 'primary: #5B4CF0; accent: #c026d3; short: #FFF; bad: #12345; text: #0b0b10', replace: '<$&>' },
  { name: 'Log lines', pattern: String.raw`^(\d\d:\d\d:\d\d) (INFO|WARN|ERROR) (.*)$`, flags: 'gm', text: '12:00:01 INFO server started\n12:00:07 WARN disk at 91%\n12:01:15 ERROR payment failed: timeout\nnot a log line', replace: '[$2] $3' },
  { name: 'Prices', pattern: String.raw`(?<=[$\u20B9])\d[\d,]*(?:\.\d{2})?`, flags: 'gu', text: 'Plan A costs $1,299.50 and plan B costs \u20B9499. Free tier: 0.', replace: '<$&>' },
  { name: 'Repeated words', pattern: String.raw`\b(\w+)\s+\1\b`, flags: 'gi', text: 'This is is a test of the the repeated word finder. No dup here.', replace: '$1' },
]

const TOKENS = [
  ['Characters', [['\\d', 'digit'], ['\\w', 'word char'], ['\\s', 'space'], ['\\D', 'not digit'], ['\\W', 'not word'], ['\\S', 'not space'], ['.', 'any char'], ['[a-z]', 'range'], ['[^|]', 'not in set'], ['\\p{L}', 'any letter (flag u)']]],
  ['Anchors', [['^', 'start'], ['$', 'end'], ['\\b', 'word edge'], ['\\B', 'not edge']]],
  ['Groups', [['(|)', 'capture'], ['(?<name>|)', 'named'], ['(?:|)', 'non-capture'], ['a|b', 'either'], ['\\1', 'backref'], ['(?=|)', 'lookahead'], ['(?!|)', 'not ahead'], ['(?<=|)', 'lookbehind'], ['(?<!|)', 'not behind']]],
  ['Repeat', [['*', '0 or more'], ['+', '1 or more'], ['?', 'optional'], ['{n,m}', 'n to m'], ['*?', 'lazy'], ['+?', 'lazy 1+']]],
]

const STYLE = `
.t-rx .rx-pat { display: flex; align-items: center; gap: 8px; }
.t-rx .rx-pat .sl { font-family: var(--mono); font-size: 22px; color: var(--muted); line-height: 1; }
.t-rx .rx-pat .input { flex: 1; min-width: 0; font-size: 15px; height: 46px; }
.t-rx .rx-pat .fl { font-family: var(--mono); font-size: 16px; color: var(--accent); min-width: 22px; font-weight: 650; }
.t-rx .rx-ed { position: relative; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); transition: border-color .2s, box-shadow .2s; }
.t-rx .rx-ed:hover { border-color: var(--border-strong); }
.t-rx .rx-ed:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px var(--ring); }
.t-rx .rx-back, .t-rx .rx-ta { font: 13px/1.65 var(--mono); padding: 12px 13px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; margin: 0; border: 0; width: 100%; box-sizing: border-box; tab-size: 4; letter-spacing: 0; text-align: left; }
.t-rx .rx-back { position: absolute; inset: 0; color: transparent; pointer-events: none; overflow: hidden; border-radius: 14px; }
.t-rx .rx-ta { position: relative; display: block; background: transparent; color: var(--text); resize: none; overflow: hidden; min-height: 170px; outline: none; }
.t-rx mark { color: transparent; border-radius: 4px; background: color-mix(in srgb, var(--accent) 26%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
.t-rx mark.m1 { background: color-mix(in srgb, var(--accent-2) 24%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-2) 45%, transparent); }
.t-rx mark.hot { background: color-mix(in srgb, var(--warning) 45%, transparent); box-shadow: 0 0 0 2px var(--warning); }
.t-rx mark .g { border-bottom: 2px solid var(--text); }
.t-rx .rx-m { border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; background: var(--surface); display: grid; gap: 6px; cursor: default; transition: border-color .2s, transform .2s var(--spring); }
.t-rx .rx-m:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); transform: translateY(-1px); }
.t-rx .rx-m .top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.t-rx .rx-m .val { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; white-space: pre-wrap; }
.t-rx .rx-m .val.nil { color: var(--muted); font-style: italic; }
.t-rx .rx-g { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 10px; font-size: 12.5px; padding-top: 6px; border-top: 1px dashed var(--border); }
.t-rx .rx-g dt { color: var(--muted); font-family: var(--mono); }
.t-rx .rx-g dd { margin: 0; font-family: var(--mono); overflow-wrap: anywhere; }
.t-rx .rx-list { display: grid; gap: 8px; max-height: 520px; overflow: auto; padding: 2px; }
.t-rx .rx-ex { display: grid; gap: 4px; padding: 0; margin: 0; list-style: none; }
.t-rx .rx-ex li { display: grid; grid-template-columns: minmax(70px, 34%) minmax(0, 1fr); gap: 12px; align-items: start; padding: 7px 10px; border-radius: 10px; font-size: 13px; }
.t-rx .rx-ex li:hover { background: var(--surface-2); }
.t-rx .rx-ex code { font-family: var(--mono); font-size: 12.5px; background: var(--accent-soft); color: var(--accent); padding: 1px 7px; border-radius: 7px; overflow-wrap: anywhere; justify-self: start; }
.t-rx .rx-ex ul { grid-column: 1 / -1; margin: 2px 0 0 14px; padding-left: 12px; border-left: 2px solid var(--border); list-style: none; display: grid; gap: 4px; }
.t-rx .rx-ex ul li { padding: 4px 8px; }
.t-rx .tok { display: flex; flex-wrap: wrap; gap: 6px; }
.t-rx .tok .dv-chip { font-family: var(--mono); font-size: 12.5px; }
.t-rx .tok .dv-chip small { font-family: var(--font); font-size: 11.5px; color: var(--muted); }
`

export const MAX_SHOWN = 100

/** Build highlight segments for the backdrop: [{text, m (match index or -1), g (inside a group)}] */
export function segments(text, matches) {
  const segs = []
  let pos = 0
  matches.forEach((m, mi) => {
    if (m.text === '' ) return
    const start = m.index
    const end = start + m.text.length
    if (start < pos) return
    if (start > pos) segs.push({ text: text.slice(pos, start), m: -1 })
    const spans = [...m.spans, ...Object.values(m.namedSpans || {})].filter((s) => s && s[1] > s[0])
    const cuts = [...new Set([start, end, ...spans.flatMap((s) => [s[0], s[1]])])].filter((c) => c >= start && c <= end).sort((a, b) => a - b)
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = cuts[i + 1]
      segs.push({ text: text.slice(a, b), m: mi, g: spans.some((s) => s[0] <= a && b <= s[1]) })
    }
    pos = end
  })
  if (pos < text.length) segs.push({ text: text.slice(pos), m: -1 })
  return segs
}

export function mount(root) {
  useKit()
  css('t-rx-css', STYLE)
  const runner = createRunner(2000)
  onCleanup(() => runner.dispose())
  const q = hashParams()
  const saved = load('regex-tester', null)
  const start = q.get('p') != null
    ? { pattern: q.get('p'), flags: q.get('f') ?? 'g', text: q.get('t') ?? '', replace: q.get('r') ?? '' }
    : saved && typeof saved.pattern === 'string' ? saved : EXAMPLES[0]

  const pattern = input({ mono: true, value: start.pattern, placeholder: 'Type a pattern, e.g. \\d+', 'aria-label': 'Regular expression', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off' })
  const flagBox = h('span', { class: 'fl', 'aria-label': 'Active flags' })
  const flagChips = chips(FLAGS, { multi: true, value: [...start.flags].filter((f) => 'gimsuy'.includes(f)), ariaLabel: 'Flags', mono: true, onChange: () => run() })
  const status = h('div', { class: 'row', style: 'min-height:28px' })

  const back = h('div', { class: 'rx-back', 'aria-hidden': 'true' })
  const ta = h('textarea', { class: 'rx-ta', spellcheck: false, 'aria-label': 'Test string', placeholder: 'Paste the text you want to test here...', value: start.text })
  const editor = h('div', { class: 'rx-ed' }, back, ta)
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.max(170, ta.scrollHeight) + 'px' }

  const matchList = h('div', { class: 'rx-list' })
  const matchHead = h('div', { class: 'row between' })
  const matchesView = h('div', { class: 'stack tight' }, matchHead, matchList)
  const replaceIn = input({ mono: true, value: start.replace || '', placeholder: 'Replace with... ($1, $<name>, $&)', 'aria-label': 'Replacement', spellcheck: false })
  const replaceOut = outBox('Result', { placeholder: 'Type a replacement to preview the result.' })
  const replaceNote = h('div', { class: 'small muted' })
  const replaceView = h('div', { class: 'stack tight' }, replaceIn, replaceNote, replaceOut.el)
  const explainView = h('div')

  let last = null // last successful result
  let hot = -1
  let reqId = 0

  const flags = () => [...'gimsuy'].filter((f) => flagChips.value.has(f)).join('')

  function paintBack() {
    const text = ta.value
    const frag = document.createDocumentFragment()
    if (last && last.text === text && last.matches.length) {
      for (const s of segments(text, last.matches)) {
        if (s.m < 0) frag.append(s.text)
        else {
          const inner = s.g ? h('span', { class: 'g' }, s.text) : s.text
          frag.append(h('mark', { class: [s.m % 2 ? 'm1' : '', s.m === hot && 'hot'], dataset: { i: s.m } }, inner))
        }
      }
    } else frag.append(text)
    frag.append('\u200b') // keeps a trailing newline visible
    back.replaceChildren(frag)
  }

  function renderMatches(res, text) {
    clear(matchList)
    const n = res.matches.length
    clear(matchHead,
      h('span', { class: 'small muted' }, n ? `${formatNumber(n, 0)}${res.truncated ? '+' : ''} match${n === 1 ? '' : 'es'}${n > MAX_SHOWN ? `, showing the first ${MAX_SHOWN}` : ''}` : 'No matches'),
      n ? h('div', { class: 'row', style: 'gap:6px' },
        button('Copy matches', { size: 'sm', icon: 'copy', onClick: () => copyText(res.matches.map((m) => m.text).join('\n')) }),
        button('JSON', { size: 'sm', icon: 'braces', variant: 'ghost', title: 'Copy matches with groups as JSON', onClick: () => copyText(JSON.stringify(res.matches.map(({ index, text: t, groups, named }) => ({ index, match: t, groups, ...(named ? { named } : {}) })), null, 2)) })) : null)
    if (!n) {
      matchList.append(empty(text ? 'Nothing matches yet. Try loosening the pattern or check the flags.' : 'Add some text to test against.', 'search-x'))
      return
    }
    res.matches.slice(0, MAX_SHOWN).forEach((m, i) => {
      const names = m.named ? Object.keys(m.named) : []
      const nameOf = (gi) => names.find((k) => m.namedSpans?.[k] && m.spans[gi] && m.namedSpans[k][0] === m.spans[gi][0] && m.namedSpans[k][1] === m.spans[gi][1] && m.named[k] === m.groups[gi])
      const card = h('div', { class: 'rx-m', onmouseenter: () => setHot(i), onmouseleave: () => setHot(-1) },
        h('div', { class: 'top' }, pill(i % 2 ? '' : 'info', null, `Match ${i + 1}`), h('span', `at ${m.index}${m.text.length ? `-${m.index + m.text.length}` : ''}`), h('span', `${[...m.text].length} char${[...m.text].length === 1 ? '' : 's'}`)),
        h('div', { class: ['val', !m.text && 'nil'] }, m.text || '(empty match)'),
        m.groups.length ? h('dl', { class: 'rx-g' }, m.groups.map((g, gi) => [h('dt', nameOf(gi) ? `${gi + 1} ${nameOf(gi)}` : `Group ${gi + 1}`), h('dd', g == null ? h('span', { class: 'muted' }, 'undefined') : g === '' ? h('span', { class: 'muted' }, '(empty)') : g)])) : null)
      matchList.append(card)
    })
  }

  function setHot(i) {
    hot = i
    for (const mk of back.querySelectorAll('mark')) mk.classList.toggle('hot', +mk.dataset.i === i)
  }

  function renderExplain(p, f) {
    clear(explainView)
    if (!p) { explainView.append(empty('Type a pattern to see it explained in plain English.', 'text-search')); return }
    let rows
    try { rows = explain(parseRegex(p, f)) } catch (e) { explainView.append(alert('info', 'No explanation available: ' + e.message)); return }
    const render = (list) => h('ul', { class: 'rx-ex' }, list.map((r) => h('li', h('code', r.src || '(empty)'), h('span', r.text), r.children?.length ? render(r.children) : null)))
    explainView.append(render(rows))
  }

  function renderReplace(res) {
    if (!replaceIn.value) { replaceOut.set(''); replaceNote.textContent = 'Uses JavaScript replace(): $1 and $<name> insert groups, $& the whole match.'; return }
    replaceOut.set(res.replaced ?? '')
    replaceNote.textContent = `${res.matches.length}${res.truncated ? '+' : ''} replacement${res.matches.length === 1 ? '' : 's'}${flagChips.value.has('g') ? '' : ' (the g flag is off, so only the first match is replaced)'}`
  }

  function persist() { save('regex-tester', { pattern: pattern.value, flags: flags(), text: ta.value.length < 50_000 ? ta.value : '', replace: replaceIn.value }) }

  async function run() {
    const f = flags()
    flagBox.textContent = f
    persist()
    grow()
    const p = pattern.value
    const text = ta.value
    renderExplain(p, f)
    if (!p) {
      last = null
      paintBack()
      clear(status, pill('', 'info', 'Enter a pattern to start'))
      renderMatches({ matches: [] }, text)
      matchHead.replaceChildren()
      renderReplace({ matches: [], replaced: '' })
      return
    }
    const id = ++reqId
    paintBack() // plain text immediately, marks follow once the worker answers
    try {
      const res = await runner.run({ pattern: p, flags: f, text, replace: replaceIn.value || null })
      if (id !== reqId) return
      last = { ...res, text }
      pattern.classList.remove('invalid')
      const n = res.matches.length
      clear(status, n ? pill('ok', 'check', `${formatNumber(n, 0)}${res.truncated ? '+' : ''} match${n === 1 ? '' : 'es'}`) : pill('warn', 'search-x', 'No match'),
        h('span', { class: 'small muted' }, res.ms < 1 ? '< 1 ms' : `${Math.round(res.ms)} ms`),
        res.truncated ? pill('warn', 'triangle-alert', 'Stopped at 2,000 matches') : null)
      paintBack()
      renderMatches(res, text)
      renderReplace(res)
    } catch (e) {
      if (e.code === 'SUPERSEDED' || id !== reqId) return
      last = null
      paintBack()
      renderMatches({ matches: [] }, text)
      matchHead.replaceChildren()
      if (e.code === 'TIMEOUT') {
        pattern.classList.remove('invalid')
        clear(status, pill('bad', 'timer-off', 'Stopped: too slow'))
        matchList.replaceChildren(alert('warn', h('div', h('strong', 'This pattern took more than 2 seconds on this text. '), 'It was stopped so the page stays responsive. Nested or overlapping repeats such as (a+)+ can backtrack catastrophically: make them more specific or use atomic-style lookaheads.')))
        replaceOut.set('')
      } else {
        pattern.classList.add('invalid')
        clear(status, pill('bad', 'circle-alert', 'Invalid pattern'), h('span', { class: 'small', style: 'color:var(--danger)' }, e.message.replace(/^Invalid regular expression: /, '')))
        replaceOut.set('')
      }
    }
  }

  pattern.addEventListener('input', run)
  replaceIn.addEventListener('input', run)
  ta.addEventListener('input', run)
  ta.addEventListener('scroll', () => { back.scrollTop = ta.scrollTop })
  const ro = new ResizeObserver(() => grow())
  ro.observe(editor)
  onCleanup(() => ro.disconnect())

  function insert(token) {
    const caret = token.indexOf('|')
    const text = token.replace('|', '')
    const a = pattern.selectionStart ?? pattern.value.length
    const b = pattern.selectionEnd ?? a
    const sel = pattern.value.slice(a, b)
    const ins = caret >= 0 && sel ? token.slice(0, caret) + sel + token.slice(caret + 1) : text
    pattern.setRangeText(ins, a, b, 'end')
    if (caret >= 0 && !sel) pattern.setSelectionRange(a + caret, a + caret)
    pattern.focus()
    run()
  }

  function loadExample(ex) {
    pattern.value = ex.pattern
    flagChips.set([...ex.flags])
    ta.value = ex.text
    replaceIn.value = ex.replace || ''
    run()
  }

  const copyAs = select([['js', 'JavaScript'], ['jsnew', 'new RegExp()'], ['python', 'Python'], ['php', 'PHP'], ['java', 'Java'], ['go', 'Go'], ['csharp', 'C#']], 'js')
  copyAs.style.cssText = 'width:auto;min-width:130px;height:34px;font-size:13px'
  copyAs.setAttribute('aria-label', 'Language for copying code')

  const shareLink = () => {
    const u = new URLSearchParams({ p: pattern.value, f: flags(), t: ta.value.slice(0, 1500) })
    if (replaceIn.value) u.set('r', replaceIn.value)
    return `${location.origin}${location.pathname}#/regex-tester?${u}`
  }

  const cheat = h('div', { class: 'stack tight' }, TOKENS.map(([title, list]) => h('div', { class: 'stack tight' },
    h('div', { class: 'small muted' }, title),
    h('div', { class: 'tok' }, list.map(([tok, label]) => h('button', { type: 'button', class: 'dv-chip', title: `Insert ${tok.replace('|', '')}`, onclick: () => insert(tok) }, tok.replace('|', ''), ' ', h('small', label)))))))

  const rightTabs = tabs([
    { id: 'matches', label: 'Matches', render: () => matchesView },
    { id: 'replace', label: 'Replace', render: () => replaceView },
    { id: 'explain', label: 'Explain', render: () => explainView },
    { id: 'insert', label: 'Tokens', render: () => cheat },
  ], 'matches')

  root.append(h('div', { class: 'dv t-rx stack' },
    h('div', { class: 'panel stack' },
      h('div', { class: 'row between' }, eyebrow('regex', 'Regular expression'),
        h('div', { class: 'row', style: 'gap:6px' },
          button('Share', { size: 'sm', variant: 'ghost', icon: 'link', title: 'Copy a link that restores this pattern and text', onClick: () => copyText(shareLink()) }),
          copyAs,
          button('Copy code', { size: 'sm', icon: 'copy', onClick: () => pattern.value && copyText(asCode(pattern.value, flags(), copyAs.value)) }))),
      h('div', { class: 'rx-pat' }, h('span', { class: 'sl', 'aria-hidden': 'true' }, '/'), pattern, h('span', { class: 'sl', 'aria-hidden': 'true' }, '/'), flagBox),
      flagChips,
      status,
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Examples:'), h('div', { class: 'dv-chips' }, EXAMPLES.map((e) => h('button', { type: 'button', class: 'dv-chip', onclick: () => loadExample(e) }, e.name))))),
    split(
      h('div', { class: 'panel stack tight' }, eyebrow('text-cursor-input', 'Test string'), editor,
        h('div', { class: 'row' }, button('Clear', { size: 'sm', variant: 'ghost', icon: 'eraser', onClick: () => { ta.value = ''; run(); ta.focus() } }), h('span', { class: 'small muted' }, 'Matches are highlighted as you type. Underlined text is inside a capture group.'))),
      h('div', { class: 'panel' }, rightTabs), 'wide-left'),
    h('p', { class: 'small muted' }, 'Uses your browser\'s own JavaScript regex engine, run in a background worker that is stopped after 2 seconds. Nothing leaves this page. Need a ready-made pattern? Try the Regex generator.')))
  run()
}
