// Grammar checker and spell checker (params.spelling) on the public LanguageTool API. Underlines issues inside the text,
// explains each one, applies fixes with a click (undo works), and chunks long text to respect the free rate limits.
import { h, button, busy, alert, field, select, toggle, clear, toast, icon, debounce, onCleanup, empty } from '../../lib/ui.js'
import { toolRoot, addStyle, textInput, chip, kicker, note } from './_shared.js'
import { load, save } from '../../lib/store.js'

const API = 'https://api.languagetool.org/v2'
const MAX_CHUNK = 12000 // the free API accepts up to 20,000 characters per request
const MAX_TOTAL = 60000
const PER_MINUTE = 18 // the free API allows about 20 requests per minute per IP

export const TYPES = {
  spelling: { label: 'Spelling', color: '#e5484d', icon: 'spell-check' },
  grammar: { label: 'Grammar', color: '#e08700', icon: 'text-cursor-input' },
  punctuation: { label: 'Punctuation', color: '#3e63dd', icon: 'pilcrow' },
  style: { label: 'Style', color: '#8e4ec6', icon: 'wand-sparkles' },
  wording: { label: 'Wording', color: '#12a594', icon: 'text-quote' },
}
const LANGS = [
  ['auto', 'Auto-detect'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'], ['en-NZ', 'English (New Zealand)'], ['en-ZA', 'English (South Africa)'],
  ['de-DE', 'German'], ['de-AT', 'German (Austria)'], ['de-CH', 'German (Switzerland)'], ['fr', 'French'], ['es', 'Spanish'], ['pt-PT', 'Portuguese (Portugal)'], ['pt-BR', 'Portuguese (Brazil)'],
  ['it', 'Italian'], ['nl', 'Dutch'], ['pl-PL', 'Polish'], ['ru-RU', 'Russian'], ['uk-UA', 'Ukrainian'], ['sv', 'Swedish'], ['da-DK', 'Danish'], ['ca-ES', 'Catalan'], ['ar', 'Arabic'],
  ['zh-CN', 'Chinese'], ['ja-JP', 'Japanese'], ['el-GR', 'Greek'], ['ro-RO', 'Romanian'], ['sk-SK', 'Slovak'], ['sl-SI', 'Slovenian'], ['ga-IE', 'Irish'], ['ta-IN', 'Tamil'], ['fa', 'Persian'],
]

/** Map a LanguageTool match to one of our five issue types. */
export function classify(m) {
  const cat = m.rule?.category?.id || '', it = m.rule?.issueType || ''
  if (it === 'misspelling' || cat === 'TYPOS') return 'spelling'
  if (cat === 'GRAMMAR' || it === 'grammar' || /AGREEMENT|VERB_FORM/.test(m.rule?.id || '')) return 'grammar'
  if (/^(PUNCTUATION|TYPOGRAPHY|CASING|WHITESPACE)/.test(cat) || ['typographical', 'whitespace'].includes(it)) return 'punctuation'
  if (/^(STYLE|REDUNDANCY|PLAIN_ENGLISH|WIKIPEDIA|READABILITY|TONE)/.test(cat) || it === 'style') return 'style'
  return 'wording'
}

/** Split text into pieces of at most `max` characters on paragraph, then sentence, then space boundaries. Returns [{start, text}]. */
export function chunkForCheck(text, max = MAX_CHUNK) {
  const out = []
  let p = 0
  while (p < text.length) {
    let end = Math.min(p + max, text.length)
    if (end < text.length) {
      const win = text.slice(p, end)
      let cut = win.lastIndexOf('\n\n')
      if (cut < max * 0.4) cut = Math.max(win.lastIndexOf('\n'), win.search(/[.!?]\s[^.!?]*$/) + 1)
      if (cut < max * 0.4) cut = win.lastIndexOf(' ')
      end = p + (cut > 0 ? cut + 1 : win.length)
    }
    out.push({ start: p, text: text.slice(p, end) })
    p = end
  }
  return out
}

/** Keep issue positions correct after an edit: shift the ones after it, drop the ones it touched. */
export function rebase(issues, oldText, newText) {
  if (oldText === newText) return issues
  let pre = 0
  const minLen = Math.min(oldText.length, newText.length)
  while (pre < minLen && oldText[pre] === newText[pre]) pre++
  let suf = 0
  while (suf < minLen - pre && oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]) suf++
  const delta = newText.length - oldText.length
  const oldEditEnd = oldText.length - suf
  return issues.flatMap((i) => (i.end <= pre ? [i] : i.start >= oldEditEnd ? [{ ...i, start: i.start + delta, end: i.end + delta }] : []))
}

const requestLog = []
async function post(text, language, picky, signal) {
  const now = Date.now()
  while (requestLog.length && now - requestLog[0] > 60000) requestLog.shift()
  if (requestLog.length >= PER_MINUTE) {
    const wait = Math.ceil((60000 - (now - requestLog[0])) / 1000)
    throw new Error(`The free grammar service allows about 20 checks a minute. Please wait ${wait} seconds and check again.`)
  }
  requestLog.push(now)
  let res
  try {
    res = await fetch(`${API}/check`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ text, language, ...(picky ? { level: 'picky' } : {}), enabledOnly: 'false' }),
    })
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    throw new Error('Could not reach the LanguageTool service. Check your internet connection and try again.')
  }
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after'))
    throw new Error(`The free grammar service is rate limited right now. ${retry ? `Try again in ${retry} seconds.` : 'Please wait a minute and try again.'}`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(res.status === 413 || /too long|maximum/i.test(body) ? 'That text is too long for the free service. Check it in smaller parts.' : `The grammar service returned an error (${res.status}). ${body.slice(0, 120)}`)
  }
  return res.json()
}

/** Check text; returns {issues: [{start, end, type, message, short, replacements, rule, word}], language, requests}. */
export async function checkText(text, { language = 'auto', picky = false, spellingOnly = false, signal, onProgress } = {}) {
  const chunks = chunkForCheck(text)
  const issues = []
  let lang = language, detected = ''
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i / chunks.length, chunks.length > 1 ? `Checking part ${i + 1} of ${chunks.length}` : 'Checking')
    const json = await post(chunks[i].text, lang, picky, signal)
    if (lang === 'auto') { // keep the detected language for the remaining parts so every part is judged the same way
      detected = json.language?.detectedLanguage?.name || json.language?.name || ''
      lang = json.language?.detectedLanguage?.code || json.language?.code || 'auto'
    } else detected = json.language?.name || detected
    for (const m of json.matches || []) {
      const type = classify(m)
      if (spellingOnly && type !== 'spelling') continue
      const start = chunks[i].start + m.offset
      issues.push({ start, end: start + m.length, type, message: m.message, short: m.shortMessage || '', replacements: (m.replacements || []).slice(0, 6).map((r) => r.value), rule: m.rule?.id || '', word: chunks[i].text.substr(m.offset, m.length) })
    }
  }
  onProgress?.(1, 'Done')
  return { issues: issues.sort((a, b) => a.start - b.start), language: detected, requests: chunks.length }
}

const CSS = `
.tw-gc .tw-ed { position: relative; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); transition: border-color .2s, box-shadow .2s; }
.tw-gc .tw-ed:focus-within { border-color: var(--accent); box-shadow: 0 0 0 4px var(--ring); }
.tw-gc .tw-mirror, .tw-gc .tw-ed textarea { margin: 0; padding: 14px 16px; border: 0; font: 400 16px/1.75 var(--font); letter-spacing: normal; white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; tab-size: 4; width: 100%; box-sizing: border-box; min-height: 260px; }
.tw-gc .tw-ed textarea, .tw-gc .tw-ed textarea:focus, .tw-gc .tw-ed textarea:hover { box-shadow: none; border: 0; background: transparent; }
.tw-gc .tw-mirror { position: absolute; inset: 0; color: transparent; pointer-events: none; overflow: hidden; }
.tw-gc .tw-ed textarea { position: relative; display: block; background: transparent; color: var(--text); resize: none; overflow: hidden; outline: none; border-radius: 14px; }
.tw-gc .tw-mirror .m { border-radius: 3px; background: color-mix(in srgb, var(--k) 14%, transparent); text-decoration: underline wavy var(--k) 1.5px; text-underline-offset: 4px; text-decoration-skip-ink: none; transition: background .2s; }
.tw-gc .tw-mirror .m.act { background: color-mix(in srgb, var(--k) 34%, transparent); }
.tw-gc .tw-pop { position: absolute; z-index: 5; width: min(320px, calc(100% - 16px)); padding: 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow-lg); animation: tw-rise .2s var(--ease) both; }
.tw-gc .tw-pop p { margin: 0 0 8px; font-size: 13.5px; color: var(--text-2); }
.tw-gc .tw-iss { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--border); border-left: 4px solid var(--k); background: var(--surface); transition: box-shadow .2s, transform .2s var(--ease); cursor: pointer; text-align: left; }
.tw-gc .tw-iss:hover { box-shadow: var(--shadow); }
.tw-gc .tw-iss.act { box-shadow: 0 0 0 3px color-mix(in srgb, var(--k) 25%, transparent); }
.tw-gc .tw-iss .t { display: flex; align-items: center; gap: 7px; font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .08em; color: var(--k); }
.tw-gc .tw-iss .t .icon { width: 14px; height: 14px; }
.tw-gc .tw-iss .w { font-size: 14.5px; }
.tw-gc .tw-iss .w s { color: var(--muted); }
.tw-gc .tw-iss .msg { font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.tw-gc .tw-sug { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--k) 40%, var(--border)); background: color-mix(in srgb, var(--k) 8%, var(--surface)); color: var(--text); font: inherit; font-size: 13.5px; font-weight: 550; cursor: pointer; transition: transform .2s var(--spring), background .2s; }
.tw-gc .tw-sug:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--k) 18%, var(--surface)); }
.tw-gc .tw-list { display: flex; flex-direction: column; gap: 10px; max-height: 640px; overflow: auto; padding: 2px; }
.tw-gc .tw-clean { text-align: center; padding: 28px 12px; color: var(--muted); display: grid; gap: 8px; place-items: center; }
.tw-gc .tw-clean .icon { width: 40px; height: 40px; color: var(--success); animation: tw-rise .5s var(--spring) both; }
`

export function mount(root, { params, signal }) {
  addStyle('tw-gc-css', CSS)
  const spelling = !!params?.spelling
  const prefs = { language: 'auto', picky: false, live: false, ...load('grammar', {}) }
  const dict = new Set(load('grammar-dict', []))
  const st = { issues: [], ignored: new Set(), filter: 'all', active: -1, prev: '', lastChecked: null, busy: false, abort: null }
  const prog = { el: h('div', { class: 'tw-sub', hidden: true }) }
  const result = h('div')
  const list = h('div', { class: 'tw-list' })
  const filters = h('div', { class: 'tw-chips' })
  const summary = h('div', { class: 'tw-sub', 'aria-live': 'polite' })
  const mirror = h('div', { class: 'tw-mirror', 'aria-hidden': 'true' })
  const pop = h('div', { class: 'tw-pop', hidden: true, role: 'dialog' })

  const inp = textInput({
    rows: 10, label: spelling ? 'Text to spell check' : 'Text to check', placeholder: spelling ? 'Paste or type your text, then press Check spelling...' : 'Paste or type your text, then press Check grammar...',
    sample: spelling ? 'Teh quick brwon fox jumpd over the lazy dog. I recieve alot of emails everyday, and definately cant answer them all.'
      : 'Their going to the store tomorow, but me and him doesn\'t know what to buy. Its a long list of things that has to be bought, and we was hoping you could of helped us. Please let us know weather you are comming.',
    onInput: (v) => onEdit(v),
  })
  const ta = inp.ta
  ta.rows = 10
  const ed = h('div', { class: 'tw-ed' }, mirror, ta, pop)
  inp.el.prepend(ed) // the textarea moved into the editor frame above

  const langSel = select(LANGS, prefs.language, (v) => { prefs.language = v; save('grammar', prefs) })
  const pickyTog = toggle('Picky mode: also flag style and wording', prefs.picky, (v) => { prefs.picky = v; save('grammar', prefs) })
  const liveTog = toggle('Re-check automatically while I type', prefs.live, (v) => { prefs.live = v; save('grammar', prefs) })
  const go = button(spelling ? 'Check spelling' : 'Check grammar', { icon: spelling ? 'spell-check' : 'spell-check-2', variant: 'primary', size: 'lg' })
  const fixAll = button('Apply first suggestions', { icon: 'check-check', size: 'sm', variant: 'secondary', onClick: () => applyAll() })
  const undoBtn = button('Undo all fixes', { icon: 'undo-2', size: 'sm', variant: 'ghost', hidden: true, onClick: () => undoAll() })
  let beforeFix = null

  // ---- editor plumbing
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.max(ta.scrollHeight, 260)}px` }
  const visible = () => st.issues.filter((i) => !st.ignored.has(key(i)) && (st.filter === 'all' || i.type === st.filter) && !dict.has((i.word || '').toLowerCase()))
  const key = (i) => `${i.rule}|${i.word}|${i.start}`

  function drawMirror() {
    const text = ta.value
    const vis = visible().filter((i) => i.end <= text.length)
    mirror.replaceChildren()
    let pos = 0
    for (const i of vis) {
      if (i.start < pos) continue
      if (i.start > pos) mirror.append(text.slice(pos, i.start))
      const m = h('span', { class: ['m', st.active >= 0 && st.issues[st.active] === i && 'act'], style: { '--k': TYPES[i.type].color } }, text.slice(i.start, i.end))
      m._i = i
      mirror.append(m)
      pos = i.end
    }
    mirror.append(text.slice(pos), '​')
  }

  function onEdit(v) {
    st.issues = rebase(st.issues, st.prev, v)
    st.prev = v
    st.active = -1
    hidePop()
    grow()
    drawMirror()
    drawList()
    clear(result)
    if (prefs.live && v.trim().length > 3) liveCheck()
  }
  const liveCheck = debounce(() => { if (!st.busy && prefs.live) runCheck(true).catch(() => {}) }, 1600)

  function replaceRange(start, end, rep) {
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(start, end)
    let ok = false
    try { ok = document.execCommand('insertText', false, rep) } catch { /* fall through */ }
    if (!ok || ta.value.slice(start, start + rep.length) !== rep) { ta.setRangeText(rep, start, end, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })) }
  }
  function applyFix(issue, rep) {
    const before = ta.value
    replaceRange(issue.start, issue.end, rep)
    if (ta.value === before) return
    toast('Fixed', 'success', 1400)
  }
  function applyAll() {
    const todo = visible().filter((i) => i.replacements.length).sort((a, b) => b.start - a.start)
    if (!todo.length) return toast('Nothing to apply', 'info')
    beforeFix = ta.value
    let text = ta.value
    for (const i of todo) text = text.slice(0, i.start) + i.replacements[0] + text.slice(i.end)
    ta.focus({ preventScroll: true })
    ta.select()
    let ok = false
    try { ok = document.execCommand('insertText', false, text) } catch { /* fall through */ }
    if (!ok || ta.value !== text) { ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })) }
    st.issues = []
    st.prev = ta.value
    undoBtn.hidden = false
    onEdit(ta.value)
    toast(`Applied ${todo.length} fix${todo.length === 1 ? '' : 'es'}`, 'success')
  }
  function undoAll() {
    if (beforeFix == null) return
    ta.value = beforeFix
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    beforeFix = null
    undoBtn.hidden = true
  }

  // ---- popover and list
  function hidePop() { pop.hidden = true }
  function showPop(issue) {
    const span = [...mirror.querySelectorAll('.m')].find((s) => s._i === issue)
    if (!span) return hidePop()
    const k = TYPES[issue.type]
    clear(pop, h('div', { class: 'tw-iss', style: { '--k': k.color, cursor: 'default', border: '0', padding: '0' } },
      h('div', { class: 't' }, icon(k.icon), k.label), h('p', issue.message || issue.short),
      h('div', { class: 'tw-chips' }, issue.replacements.slice(0, 3).map((r) => h('button', { type: 'button', class: 'tw-sug', onclick: () => applyFix(issue, r) }, r || '(remove)')),
        h('button', { type: 'button', class: 'tw-sug', style: { '--k': 'var(--muted)' }, onclick: () => { st.ignored.add(key(issue)); hidePop(); drawMirror(); drawList() } }, 'Ignore'))))
    pop.hidden = false
    const top = span.offsetTop + span.offsetHeight + 8
    pop.style.top = `${top}px`
    pop.style.left = `${Math.max(8, Math.min(span.offsetLeft, ed.clientWidth - pop.offsetWidth - 8))}px`
  }
  function setActive(issue, { scroll = false } = {}) {
    st.active = issue ? st.issues.indexOf(issue) : -1
    drawMirror()
    for (const c of list.children) c.classList.toggle('act', !!issue && c._i === issue)
    if (issue && scroll) {
      const span = [...mirror.querySelectorAll('.m')].find((s) => s._i === issue)
      span?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  function drawFilters() {
    const counts = {}
    for (const i of st.issues) if (!st.ignored.has(key(i)) && !dict.has((i.word || '').toLowerCase())) counts[i.type] = (counts[i.type] || 0) + 1
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    clear(filters)
    if (!st.lastChecked) return
    const mk = (id, label, n, color) => {
      const b = chip(`${label}${n != null ? ` ${n}` : ''}`, { pressed: st.filter === id, onClick: () => { st.filter = id; drawFilters(); drawMirror(); drawList() } })
      if (color) b.style.setProperty('--tw-accent', color)
      return b
    }
    filters.append(mk('all', 'All', total))
    for (const [id, k] of Object.entries(TYPES)) if (counts[id]) filters.append(mk(id, k.label, counts[id], k.color))
  }

  function drawList() {
    drawFilters()
    const vis = visible()
    clear(list)
    fixAll.hidden = !vis.some((i) => i.replacements.length)
    if (!st.lastChecked) {
      clear(summary)
      list.append(empty(spelling ? 'Misspelled words will be listed here with suggestions.' : 'Issues will be listed here with explanations and one-click fixes.', spelling ? 'spell-check' : 'spell-check-2'))
      return
    }
    clear(summary, `${st.lastChecked.requests > 1 ? `${st.lastChecked.requests} parts checked` : 'Checked'}${st.lastChecked.language ? ` as ${st.lastChecked.language}` : ''} · ${vis.length} issue${vis.length === 1 ? '' : 's'} shown`)
    if (!vis.length) {
      list.append(h('div', { class: 'tw-clean' }, icon('circle-check'), h('b', { style: 'color:var(--text); font-size:16px' }, st.issues.length ? 'Nothing left to show' : spelling ? 'No spelling mistakes found' : 'Looks good, no issues found'),
        h('span', st.issues.length ? 'Everything in this view is fixed or ignored.' : 'This is an automatic check, so a quick read-through is still worth it.')))
      return
    }
    for (const i of vis) {
      const k = TYPES[i.type]
      const card = h('div', { class: ['tw-iss', st.active >= 0 && st.issues[st.active] === i && 'act'], style: { '--k': k.color }, tabindex: 0, role: 'button', 'aria-label': `${k.label}: ${i.word}`,
        onclick: (e) => { if (e.target.closest('button')) return; setActive(i, { scroll: true }); ta.focus({ preventScroll: true }); ta.setSelectionRange(i.start, i.end) },
        onkeydown: (e) => { if (e.key === 'Enter' && e.target === card) card.click() } },
      h('div', { class: 't' }, icon(k.icon), k.label),
      h('div', { class: 'w' }, h('s', i.word.length > 40 ? `${i.word.slice(0, 40)}...` : i.word), i.replacements[0] != null ? ' → ' : '', i.replacements[0] != null ? h('b', i.replacements[0] || '(remove)') : null),
      h('div', { class: 'msg' }, i.message || i.short),
      h('div', { class: 'tw-chips' },
        i.replacements.slice(0, 5).map((r) => h('button', { type: 'button', class: 'tw-sug', onclick: () => applyFix(i, r) }, r || '(remove)')),
        h('button', { type: 'button', class: 'tw-sug', style: { '--k': 'var(--muted)' }, onclick: () => { st.ignored.add(key(i)); drawMirror(); drawList() } }, 'Ignore'),
        i.type === 'spelling' ? h('button', { type: 'button', class: 'tw-sug', style: { '--k': 'var(--muted)' }, title: 'Never flag this word again on this device', onclick: () => { dict.add(i.word.toLowerCase()); save('grammar-dict', [...dict]); drawMirror(); drawList(); toast(`Added "${i.word}" to your dictionary`) } }, 'Add to dictionary') : null))
      card._i = i
      list.append(card)
    }
  }

  // clicking inside the text finds the issue under the caret
  const caretIssue = () => visible().find((i) => ta.selectionStart >= i.start && ta.selectionStart <= i.end && ta.selectionStart === ta.selectionEnd)
  const onCaret = () => {
    const i = caretIssue()
    if (i) { setActive(i); showPop(i) } else if (st.active >= 0) { setActive(null); hidePop() }
  }
  ta.addEventListener('click', onCaret)
  ta.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) onCaret(); if (e.key === 'Escape') hidePop() })
  ta.addEventListener('blur', () => setTimeout(() => { if (!pop.contains(document.activeElement)) hidePop() }, 150))
  window.addEventListener('resize', grow)
  onCleanup(() => window.removeEventListener('resize', grow))

  // ---- running a check
  async function runCheck(quiet = false) {
    const text = ta.value
    if (!text.trim()) throw new Error('Type or paste some text first.')
    if (text.length > MAX_TOTAL) throw new Error(`That is ${text.length.toLocaleString()} characters. The free service is meant for up to ${MAX_TOTAL.toLocaleString()} at a time, so check it in parts.`)
    st.busy = true
    st.abort?.abort()
    st.abort = new AbortController()
    try {
      if (!quiet) { prog.el.hidden = false; prog.el.textContent = 'Checking...' }
      const r = await checkText(text, { language: prefs.language, picky: prefs.picky, spellingOnly: spelling, signal: st.abort.signal, onProgress: (f, t) => { if (!quiet) prog.el.textContent = t } })
      if (ta.value !== text) return // edited meanwhile: positions would be wrong
      st.issues = r.issues
      st.ignored = new Set()
      st.prev = text
      st.lastChecked = r
      st.active = -1
      if (spelling) st.filter = 'all'
      hidePop()
      drawMirror()
      drawList()
      clear(result)
    } finally {
      st.busy = false
      prog.el.hidden = true
    }
  }
  go.addEventListener('click', () => busy(go, () => runCheck(false), { label: 'Checking', errorTo: result }))
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go.click() } })
  signal?.addEventListener('abort', () => st.abort?.abort())
  onCleanup(() => st.abort?.abort())

  st.prev = ta.value
  grow()
  drawMirror()
  drawList()
  const controls = h('div', { class: 'stack' },
    h('div', { class: 'tw-bar' }, h('div', { style: 'min-width:200px; flex:1' }, field('Language', langSel)), spelling ? null : pickyTog),
    liveTog)
  root.append(toolRoot('gc',
    h('div', { class: ['tool-split', 'wide-left'] },
      h('div', { class: 'stack' }, h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Your text', 'type'), inp.el)),
        h('div', { class: 'tw-bar' }, go, prog.el, h('span', { class: 'grow' }), h('span', { class: 'tw-sub' }, 'Ctrl+Enter to check')), result, h('section', { class: 'tw-stage' }, controls)),
      h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, h('div', { class: 'tw-head' }, kicker(spelling ? 'Spelling' : 'Suggestions', 'list-checks'), h('div', { class: 'row' }, fixAll, undoBtn)), summary, filters, list))),
    note('Uses the free LanguageTool service (api.languagetool.org). Only the text you check is sent, so avoid confidential text. The free limit is about 20 checks a minute.', 'cloud')))
}
