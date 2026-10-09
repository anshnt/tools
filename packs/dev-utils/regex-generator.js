// Regex generator: a library of tested patterns, a block-based builder, and optional AI generation.
import { h, icon, input, select, number, textarea, toggle, tabs, button, alert, empty, clear, copyText, onCleanup, debounce } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { useKit, css, chips, eyebrow, pill, outBox, hashParams } from './_kit.js'
import { createRunner } from './_regex-run.js'
import { parseRegex, explain } from './_regex-parse.js'
import { CATS, PATTERNS, asCode, usesBacktracking } from './_regex-lib.js'

const STYLE = `
.t-rg .rg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 10px; }
.t-rg .rg-card { text-align: left; display: grid; gap: 5px; align-content: start; padding: 12px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); color: inherit; cursor: pointer; min-width: 0;
  transition: border-color .2s, transform .25s var(--spring), box-shadow .2s; animation: dv-rise .4s var(--ease) both; animation-delay: calc(var(--i, 0) * 12ms); }
.t-rg .rg-card:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); transform: translateY(-2px); box-shadow: var(--shadow); }
.t-rg .rg-card[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.t-rg .rg-card b { font-size: 14px; font-weight: 600; }
.t-rg .rg-card span { font-size: 12.5px; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.t-rg .rg-card code { font-family: var(--mono); font-size: 11.5px; color: var(--accent); background: var(--accent-soft); padding: 3px 7px; border-radius: 7px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; display: block; }
.t-rg .rg-pat { font-family: var(--mono); font-size: 14.5px; line-height: 1.55; padding: 14px 16px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); overflow-wrap: anywhere; position: relative; }
.t-rg .rg-pat .sl { color: var(--muted); }
.t-rg .rg-pat .fl { color: var(--accent); font-weight: 650; }
.t-rg .rg-ex { display: flex; flex-wrap: wrap; gap: 6px; }
.t-rg .rg-ex button { font-family: var(--mono); font-size: 12px; display: inline-flex; gap: 6px; align-items: center; min-height: 30px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; max-width: 100%; transition: transform .2s var(--spring), border-color .2s; }
.t-rg .rg-ex button:hover { transform: translateY(-1px); }
.t-rg .rg-ex button .icon { width: 13px; height: 13px; flex: none; }
.t-rg .rg-ex button.ok { border-color: color-mix(in srgb, var(--success) 40%, var(--border)); }
.t-rg .rg-ex button.ok .icon { color: var(--success); }
.t-rg .rg-ex button.no { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.t-rg .rg-ex button.no .icon { color: var(--danger); }
.t-rg .rg-ex button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-rg .rg-res { min-height: 30px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.t-rg .rg-hl { font-family: var(--mono); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); max-height: 180px; overflow: auto; }
.t-rg .rg-hl mark { background: color-mix(in srgb, var(--accent) 28%, transparent); color: inherit; border-radius: 4px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent); }
.t-rg .rg-step { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); animation: dv-rise .35s var(--ease) both; }
.t-rg .rg-step .n { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-size: 12.5px; font-weight: 650; background: var(--brand); color: #fff; }
.t-rg .rg-step .f { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 8px; align-items: end; }
.t-rg .rg-step .acts { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; grid-column: 2; }
.t-rg .rg-expl { display: grid; gap: 4px; padding: 0; margin: 0; list-style: none; font-size: 13px; }
.t-rg .rg-expl li { display: grid; grid-template-columns: minmax(60px, 32%) minmax(0, 1fr); gap: 12px; padding: 5px 8px; border-radius: 8px; }
.t-rg .rg-expl li:hover { background: var(--surface-2); }
.t-rg .rg-expl code { font-family: var(--mono); font-size: 12.5px; color: var(--accent); background: var(--accent-soft); padding: 1px 7px; border-radius: 7px; justify-self: start; overflow-wrap: anywhere; }
.t-rg .rg-expl ul { grid-column: 1 / -1; margin: 2px 0 0 12px; padding-left: 12px; border-left: 2px solid var(--border); list-style: none; display: grid; gap: 4px; }
@media (max-width: 520px) { .t-rg .rg-expl li { grid-template-columns: 1fr; gap: 2px; } }
`

const LANGS = [['js', 'JavaScript'], ['jsnew', 'new RegExp'], ['python', 'Python'], ['php', 'PHP'], ['java', 'Java'], ['go', 'Go'], ['csharp', 'C#']]
const tester = (p, flags, text) => `#/regex-tester?${new URLSearchParams({ p, f: flags || 'g', t: text || '' })}`

// ---------- Builder ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const escSet = (s) => s.replace(/[\]\\^-]/g, '\\$&')
export const STEP_KINDS = [
  ['text', 'Exact text'], ['digit', 'Digit (0-9)'], ['letter', 'Letter (A-Z, a-z)'], ['alnum', 'Letter or digit'], ['word', 'Word character'],
  ['space', 'Whitespace'], ['any', 'Any character'], ['oneof', 'One of these characters'], ['noneof', 'Any except these characters'], ['words', 'One of these words (comma separated)'],
]
const QUANTS = [['1', 'Exactly once'], ['?', 'Optional'], ['+', 'One or more'], ['*', 'Zero or more'], ['n', 'Exactly N times'], ['n+', 'N or more times'], ['nm', 'Between N and M times']]

/** Turn builder steps into a pattern. step: {kind, value, q, n, m, capture, name} */
export function buildPattern(steps, { whole = false } = {}) {
  const body = steps.map((s) => {
    let atom, multi = false
    switch (s.kind) {
      case 'text': atom = esc(s.value || ''); multi = (s.value || '').length > 1; break
      case 'digit': atom = '\\d'; break
      case 'letter': atom = '[A-Za-z]'; break
      case 'alnum': atom = '[A-Za-z0-9]'; break
      case 'word': atom = '\\w'; break
      case 'space': atom = '\\s'; break
      case 'any': atom = '.'; break
      case 'oneof': atom = `[${escSet(s.value || '')}]`; break
      case 'noneof': atom = `[^${escSet(s.value || '')}]`; break
      case 'words': atom = `(?:${(s.value || '').split(',').map((w) => esc(w.trim())).filter(Boolean).join('|')})`; break
      default: atom = ''
    }
    if (!atom || atom === '[]' || atom === '(?:)') return ''
    const n = Math.max(0, Math.round(+s.n) || 0)
    const m = Math.max(n, Math.round(+s.m) || n)
    const quant = { 1: '', '?': '?', '+': '+', '*': '*', n: `{${n}}`, 'n+': `{${n},}`, nm: `{${n},${m}}` }[s.q || '1']
    if (quant && multi) atom = `(?:${atom})`
    let out = atom + quant
    if (s.capture) out = `(${s.name && /^[A-Za-z_]\w*$/.test(s.name) ? `?<${s.name}>` : ''}${out})`
    return out
  }).join('')
  return whole ? `^${body}$` : body
}

export function mount(root) {
  useKit()
  css('t-rg-css', STYLE)
  const runner = createRunner(1500)
  onCleanup(() => runner.dispose())
  const q = hashParams()

  // ======== Library ========
  let cat = 'all'
  let query = ''
  let sel = PATTERNS.find((p) => p.id === q.get('id')) || PATTERNS[0]
  const search = input({ type: 'search', placeholder: `Search ${PATTERNS.length} patterns: email, PAN, IPv6, UUID...`, 'aria-label': 'Search patterns', oninput: (e) => { query = e.target.value.trim().toLowerCase(); renderGrid() } })
  const catChips = chips([['all', 'All'], ...CATS.map((c) => [c.id, c.name])], { value: 'all', ariaLabel: 'Category', onChange: (v) => { cat = v; renderGrid() } })
  const grid = h('div', { class: 'rg-grid' })
  const detail = h('div', { class: 'panel stack' })
  const lang = chips(LANGS, { value: 'js', ariaLabel: 'Code language', onChange: () => renderDetailCode() })
  const codeOut = outBox('Use in code', { placeholder: '' })
  const testBox = textarea({ rows: 3, mono: true, spellcheck: false, 'aria-label': 'Text to test', placeholder: 'Type or paste text to test...' })
  const testRes = h('div', { class: 'rg-res', 'aria-live': 'polite' })
  const exWrap = h('div', { class: 'stack tight' })
  const explWrap = h('div')

  const code = () => asCode(sel.pattern, sel.flags, lang.value)
  function renderDetailCode() {
    codeOut.set(code(), { quiet: true })
    if (lang.value === 'go' && usesBacktracking(sel.pattern)) codeOut.body.append('\n// Note: Go (RE2) has no lookarounds or backreferences, so this pattern needs a different approach there.')
  }

  const sync = (p, text) => { try { return new RegExp(p.pattern, p.flags.replace('g', '')).test(text) } catch { return false } }

  async function liveTest() {
    const text = testBox.value
    if (!text) { clear(testRes, h('span', { class: 'small muted' }, 'Type something to see how it matches.')); return }
    try {
      const flags = sel.kind === 'validate' ? sel.flags.replace('g', '') : sel.flags.includes('g') ? sel.flags : sel.flags + 'g'
      const r = await runner.run({ pattern: sel.pattern, flags, text })
      if (sel.kind === 'validate') {
        const ok = r.matches.length > 0
        clear(testRes, pill(ok ? 'ok' : 'bad', ok ? 'check' : 'x', ok ? 'Valid: the whole text matches' : 'No match'))
      } else {
        const n = r.matches.length
        clear(testRes, pill(n ? 'ok' : 'warn', n ? 'check' : 'search-x', n ? `${n} match${n === 1 ? '' : 'es'}${r.truncated ? '+' : ''}` : 'No matches'))
        if (n) {
          const frag = []
          let pos = 0
          for (const m of r.matches) { if (m.index < pos || !m.text) continue; frag.push(text.slice(pos, m.index), h('mark', m.text)); pos = m.index + m.text.length }
          frag.push(text.slice(pos))
          testRes.append(h('div', { class: 'rg-hl', style: 'flex-basis:100%' }, frag))
        }
      }
    } catch (e) {
      if (e.code === 'SUPERSEDED') return
      clear(testRes, pill('bad', 'timer-off', e.code === 'TIMEOUT' ? 'Too slow on this text, stopped' : 'Invalid pattern'))
    }
  }
  testBox.addEventListener('input', debounce(liveTest, 80))

  function renderExplain() {
    clear(explWrap)
    let rows
    try { rows = explain(parseRegex(sel.pattern, sel.flags)) } catch { return }
    const render = (list) => h('ul', { class: 'rg-expl' }, list.map((r) => h('li', h('code', r.src || '(empty)'), h('span', r.text), r.children?.length ? render(r.children) : null)))
    explWrap.append(h('details', h('summary', { style: 'cursor:pointer;font-weight:600;font-size:13.5px;min-height:32px;display:flex;align-items:center' }, 'How this pattern works'), h('div', { style: 'padding-top:8px' }, render(rows))))
  }

  function pick(p, { scroll = false } = {}) {
    sel = p
    for (const c of grid.children) c.setAttribute('aria-pressed', String(c.dataset.id === p.id))
    const cname = CATS.find((c) => c.id === p.cat)?.name
    const first = p.kind === 'validate' ? p.valid[0] : p.text
    testBox.value = first || ''
    clear(detail,
      h('div', { class: 'row between' },
        h('div', { class: 'stack tight' }, h('div', { class: 'row' }, h('h2', { style: 'font-size:19px;margin:0' }, p.name), pill('info', null, cname), pill('', p.kind === 'validate' ? 'shield-check' : 'scan-search', p.kind === 'validate' ? 'Validates a whole value' : 'Finds matches inside text')),
          h('div', { class: 'small muted' }, p.desc)),
        h('div', { class: 'row', style: 'gap:6px' },
          button('Copy pattern', { icon: 'copy', size: 'sm', onClick: () => copyText(p.pattern) }),
          h('a', { class: 'btn btn-secondary btn-sm', href: tester(p.pattern, p.flags, first) }, icon('flask-conical'), h('span', 'Open in tester')),
          h('a', { class: 'btn btn-ghost btn-sm', href: `#/regex-visualizer?${new URLSearchParams({ p: p.pattern, f: p.flags })}` }, icon('git-branch'), h('span', 'Diagram')))),
      h('div', { class: 'rg-pat', tabindex: 0, 'aria-label': 'Pattern' }, h('span', { class: 'sl' }, '/'), p.pattern, h('span', { class: 'sl' }, '/'), h('span', { class: 'fl' }, p.flags)),
      h('div', { class: 'stack tight' }, eyebrow('flask-conical', 'Try it'), testBox, testRes),
      exWrap,
      explWrap,
      h('div', { class: 'stack tight' }, eyebrow('code', 'Use in code'), lang, codeOut.el))
    clear(exWrap)
    const chipFor = (text, ok) => h('button', { type: 'button', class: ok ? 'ok' : 'no', title: ok ? 'Should match. Click to test it.' : 'Should not match. Click to test it.', onclick: () => { testBox.value = text; liveTest() } }, icon(ok ? 'check' : 'x'), h('span', text === '' ? '(empty)' : text.replace(/\n/g, '↵')))
    if (p.kind === 'validate') {
      exWrap.append(eyebrow('list-checks', 'Examples'),
        h('div', { class: 'rg-ex' }, p.valid.map((t) => chipFor(t, true)), p.invalid.map((t) => chipFor(t, false))))
    } else {
      exWrap.append(eyebrow('list-checks', 'Sample text and what it finds'),
        h('div', { class: 'rg-ex' }, p.matches.map((t) => chipFor(t, true))))
    }
    renderDetailCode()
    renderExplain()
    liveTest()
    if (scroll) detail.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  function renderGrid() {
    const list = PATTERNS.filter((p) => (cat === 'all' || p.cat === cat)
      && (!query || `${p.name} ${p.desc} ${p.id} ${CATS.find((c) => c.id === p.cat)?.name}`.toLowerCase().includes(query)))
    clear(grid, list.length ? list.map((p, i) => h('button', { type: 'button', class: 'rg-card', dataset: { id: p.id }, 'aria-pressed': String(p.id === sel.id), style: { '--i': Math.min(i, 20) }, onclick: () => pick(p, { scroll: true }) },
      h('b', p.name), h('span', p.desc), h('code', p.pattern))) : [h('div', { style: 'grid-column:1/-1' }, empty('No pattern matches that search. Try the builder or describe it in words.', 'search-x'))])
  }

  const libraryView = h('div', { class: 'stack' }, detail,
    h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, eyebrow('library', `Pattern library (${PATTERNS.length})`)), search, catChips), grid)

  // ======== Builder ========
  const startSteps = () => [
    { kind: 'text', value: 'INV-', q: '1' },
    { kind: 'digit', q: 'nm', n: 4, m: 6, capture: true, name: 'number' },
  ]
  let steps = startSteps()
  const stepsEl = h('div', { class: 'stack tight' })
  const whole = toggle('Match the whole text (^ ... $)', false, () => buildRender())
  const flagI = toggle('Ignore case', false, () => buildRender())
  const flagG = toggle('Find all matches', true, () => buildRender())
  const flagM = toggle('Line by line (m)', false, () => buildRender())
  const bPattern = h('div', { class: 'rg-pat', 'aria-live': 'polite' })
  const bTest = textarea({ rows: 3, mono: true, spellcheck: false, value: 'Invoices INV-2041, INV-17 and INV-880123 were paid.', 'aria-label': 'Text to test the builder pattern', placeholder: 'Text to test...' })
  const bRes = h('div', { class: 'rg-res' })
  const bLang = chips(LANGS, { value: 'js', ariaLabel: 'Code language', onChange: () => buildRender() })
  const bCode = outBox('Use in code')
  const bExpl = h('div')

  function stepEl(s, i) {
    const kind = select(STEP_KINDS, s.kind, (v) => { s.kind = v; buildRender(true) })
    const valueNeeded = ['text', 'oneof', 'noneof', 'words'].includes(s.kind)
    const val = input({ mono: true, value: s.value || '', placeholder: s.kind === 'words' ? 'cat, dog, bird' : s.kind === 'text' ? 'e.g. INV-' : 'e.g. abc-_', 'aria-label': `Step ${i + 1} value`, oninput: (e) => { s.value = e.target.value; buildRender() } })
    const quant = select(QUANTS, s.q || '1', (v) => { s.q = v; if (v === 'nm' && !(s.m >= s.n)) s.m = (s.n || 1) + 2; buildRender(true) })
    const needN = ['n', 'n+', 'nm'].includes(s.q)
    return h('div', { class: 'rg-step' }, h('div', { class: 'n' }, i + 1),
      h('div', { class: 'f' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Match'), kind),
        valueNeeded ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, s.kind === 'text' ? 'Text' : 'Characters / words'), val) : null,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'How many'), quant),
        needN ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, s.q === 'nm' ? 'From N' : 'N'), number(s.n ?? 1, { min: 0, step: 1, ariaLabel: `Step ${i + 1} N`, onInput: (v) => { s.n = Number.isFinite(v) ? v : 0; buildRender() } })) : null,
        s.q === 'nm' ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'To M'), number(s.m ?? 3, { min: 0, step: 1, ariaLabel: `Step ${i + 1} M`, onInput: (v) => { s.m = Number.isFinite(v) ? v : 0; buildRender() } })) : null),
      h('div', { class: 'acts' },
        toggle('Capture', !!s.capture, (v) => { s.capture = v; buildRender(true) }),
        s.capture ? input({ mono: true, value: s.name || '', placeholder: 'group name (optional)', 'aria-label': `Step ${i + 1} group name`, style: 'width:190px;height:34px', oninput: (e) => { s.name = e.target.value.trim(); buildRender() } }) : null,
        h('span', { style: 'flex:1' }),
        button('', { icon: 'chevron-up', variant: 'ghost', size: 'sm', ariaLabel: 'Move step up', disabled: i === 0, onClick: () => { steps.splice(i - 1, 0, steps.splice(i, 1)[0]); buildRender(true) } }),
        button('', { icon: 'chevron-down', variant: 'ghost', size: 'sm', ariaLabel: 'Move step down', disabled: i === steps.length - 1, onClick: () => { steps.splice(i + 1, 0, steps.splice(i, 1)[0]); buildRender(true) } }),
        button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Remove step', onClick: () => { steps.splice(i, 1); buildRender(true) } })))
  }

  let bFlags = 'g'
  let bP = ''
  async function bTestRun() {
    const text = bTest.value
    if (!bP) { clear(bRes, h('span', { class: 'small muted' }, 'Add a step to build a pattern.')); return }
    if (!text) { clear(bRes, h('span', { class: 'small muted' }, 'Add some text to test.')); return }
    try {
      const r = await runner.run({ pattern: bP, flags: bFlags, text })
      const n = r.matches.length
      clear(bRes, pill(n ? 'ok' : 'warn', n ? 'check' : 'search-x', n ? `${n} match${n === 1 ? '' : 'es'}` : 'No matches'))
      if (n) {
        const frag = []
        let pos = 0
        for (const m of r.matches) { if (m.index < pos || !m.text) continue; frag.push(text.slice(pos, m.index), h('mark', m.text)); pos = m.index + m.text.length }
        frag.push(text.slice(pos))
        bRes.append(h('div', { class: 'rg-hl', style: 'flex-basis:100%' }, frag))
      }
    } catch (e) { if (e.code !== 'SUPERSEDED') clear(bRes, pill('bad', 'circle-alert', e.code === 'TIMEOUT' ? 'Too slow on this text' : 'Invalid pattern')) }
  }
  bTest.addEventListener('input', debounce(bTestRun, 80))

  function buildRender(rebuildSteps = false) {
    if (rebuildSteps) clear(stepsEl, steps.length ? steps.map(stepEl) : [empty('No steps yet. Add the first piece of your pattern.', 'blocks')])
    bP = buildPattern(steps, { whole: whole.input.checked })
    bFlags = (flagG.input.checked ? 'g' : '') + (flagI.input.checked ? 'i' : '') + (flagM.input.checked ? 'm' : '')
    clear(bPattern, h('span', { class: 'sl' }, '/'), bP || h('span', { class: 'muted' }, '(empty)'), h('span', { class: 'sl' }, '/'), h('span', { class: 'fl' }, bFlags))
    bCode.set(bP ? asCode(bP, bFlags, bLang.value) : '', { quiet: true })
    clear(bExpl)
    if (bP) {
      try {
        const rows = explain(parseRegex(bP, bFlags))
        const render = (list) => h('ul', { class: 'rg-expl' }, list.map((r) => h('li', h('code', r.src || '(empty)'), h('span', r.text), r.children?.length ? render(r.children) : null)))
        bExpl.append(render(rows))
      } catch { /* the builder only emits valid patterns */ }
    }
    bTestRun()
  }
  const addStep = () => { steps.push({ kind: 'digit', q: '+' }); buildRender(true); stepsEl.lastElementChild?.querySelector('select')?.focus() }
  const builderView = h('div', { class: 'stack' },
    h('div', { class: 'panel stack' },
      h('div', { class: 'row between' }, eyebrow('blocks', 'Build it step by step'),
        h('div', { class: 'row', style: 'gap:6px' }, button('Start over', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: () => { steps = startSteps(); buildRender(true) } }), button('Add step', { icon: 'plus', size: 'sm', variant: 'primary', onClick: addStep }))),
      stepsEl,
      h('div', { class: 'row' }, whole, flagI, flagG, flagM)),
    h('div', { class: 'panel stack' }, eyebrow('sparkles', 'Your pattern'), bPattern,
      h('div', { class: 'row' }, button('Copy pattern', { icon: 'copy', size: 'sm', onClick: () => bP && copyText(bP) }),
        button('Open in tester', { icon: 'flask-conical', size: 'sm', onClick: () => { location.hash = tester(bP, bFlags, bTest.value) } })),
      h('details', h('summary', { style: 'cursor:pointer;font-weight:600;font-size:13.5px;min-height:32px;display:flex;align-items:center' }, 'How this pattern works'), h('div', { style: 'padding-top:8px' }, bExpl)),
      eyebrow('flask-conical', 'Try it'), bTest, bRes, eyebrow('code', 'Use in code'), bLang, bCode.el))

  // ======== AI ========
  const aiDesc = textarea({ rows: 4, placeholder: 'Describe what to match, e.g. "an Indian mobile number with optional +91 or 0 prefix" or "dates like 14 Mar 2026"', 'aria-label': 'Describe the pattern' })
  const aiSample = textarea({ rows: 3, mono: true, spellcheck: false, placeholder: 'Optional: paste a few example lines that should match (and some that should not)', 'aria-label': 'Examples' })
  const aiOut = h('div', { class: 'stack' })
  const aiBtn = button('Generate with Claude', { icon: 'wand-sparkles', variant: 'primary' })
  aiBtn.addEventListener('click', async () => {
    if (!aiDesc.value.trim()) return clear(aiOut, alert('warn', 'Describe what the pattern should match first.'))
    if (!(await ai.ensureKey())) return
    aiBtn.disabled = true
    clear(aiOut, h('div', { class: 'row small muted' }, h('span', { class: 'spinner' }), 'Writing a pattern...'))
    try {
      const r = await ai.ask({
        system: 'You write JavaScript regular expressions. Reply only with the JSON requested. The pattern must be valid for `new RegExp(pattern, flags)` in a modern browser, without surrounding slashes. Prefer simple, readable, non-backtracking-heavy patterns. Flags may only contain g, i, m, s, u. Give 3 strings that match and 3 that do not.',
        prompt: `Write a regular expression for: ${aiDesc.value.trim()}${aiSample.value.trim() ? `\n\nExample text:\n${aiSample.value.trim()}` : ''}`,
        json: { type: 'object', properties: { pattern: { type: 'string' }, flags: { type: 'string' }, explanation: { type: 'string' }, matches: { type: 'array', items: { type: 'string' } }, nonMatches: { type: 'array', items: { type: 'string' } } }, required: ['pattern', 'flags', 'explanation', 'matches', 'nonMatches'], additionalProperties: false },
        effort: 'low', maxTokens: 1500,
      })
      const flags = String(r.flags || '').replace(/[^gimsu]/g, '')
      let re
      try { re = new RegExp(r.pattern, flags) } catch (e) { return clear(aiOut, alert('error', `Claude returned a pattern this browser cannot compile (${e.message}). Try rephrasing.`)) }
      const check = (list, want) => list.map((t) => { re.lastIndex = 0; return [t, re.test(t) === want] })
      const good = check(r.matches || [], true)
      const bad = check(r.nonMatches || [], false)
      clear(aiOut,
        h('div', { class: 'rg-pat' }, h('span', { class: 'sl' }, '/'), r.pattern, h('span', { class: 'sl' }, '/'), h('span', { class: 'fl' }, flags)),
        h('p', { class: 'small' }, r.explanation),
        h('div', { class: 'small muted' }, 'Self-check: green means the pattern behaves as intended on the example.'),
        h('div', { class: 'rg-ex' },
          good.map(([t, ok]) => h('button', { type: 'button', class: ok ? 'ok' : 'no', title: ok ? 'Should match, and does' : 'Should match, but does not' }, icon(ok ? 'check' : 'x'), h('span', t))),
          bad.map(([t, ok]) => h('button', { type: 'button', class: ok ? 'ok' : 'no', title: ok ? 'Should not match, and does not' : 'Should not match, but does' }, icon(ok ? 'check' : 'x'), h('span', 'not: ' + t)))),
        h('div', { class: 'row' }, button('Copy pattern', { icon: 'copy', size: 'sm', onClick: () => copyText(r.pattern) }),
          h('a', { class: 'btn btn-secondary btn-sm', href: tester(r.pattern, flags || 'g', (r.matches || []).join('\n')) }, icon('flask-conical'), h('span', 'Open in tester')),
          h('a', { class: 'btn btn-ghost btn-sm', href: `#/regex-visualizer?${new URLSearchParams({ p: r.pattern, f: flags })}` }, icon('git-branch'), h('span', 'Diagram'))),
        h('p', { class: 'small muted' }, 'AI can be wrong. The green and red chips show how this pattern really behaves on the examples; always test it on your own data.'))
    } catch (e) {
      if (e.code === 'ABORT') return clear(aiOut)
      clear(aiOut, alert('error', e.userMessage || e.message))
    } finally { aiBtn.disabled = false }
  })
  const aiView = h('div', { class: 'panel stack' }, ai.notice('Optional: describe a pattern in words and Claude writes it (uses your own Anthropic API key).'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'What should it match?'), aiDesc),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Examples (optional)'), aiSample),
    h('div', { class: 'row' }, aiBtn), aiOut)

  const main = tabs([
    { id: 'library', label: 'Pattern library', render: () => libraryView },
    { id: 'builder', label: 'Builder', render: () => builderView },
    { id: 'ai', label: 'Describe it (AI)', render: () => aiView },
  ], q.get('tab') || 'library', (id) => { if (id === 'builder' && !stepsEl.childElementCount) buildRender(true) })

  root.append(h('div', { class: 'dv t-rg stack' }, main,
    h('p', { class: 'small muted' }, `Every library pattern is tested against its own examples. Patterns use JavaScript syntax; the code snippets adapt the quoting and flags for other languages, but check lookarounds and Unicode classes in your engine.`)))
  renderGrid()
  pick(sel)
}
