// Unicode character lookup: search by name, character or code point; inspect any text; emoji picker; browse blocks.
// Names come from the unicode-name package (Unicode 18) and emoji groups from unicode-emoji-json, both pinned on jsDelivr and loaded on first use.
import { h, button, input, textarea, tabs, select, table, empty, alert, clear, copyText, debounce, formatNumber } from '../../lib/ui.js'
import { useKit, css, chips, eyebrow, pill, copyRow, outBox, hashParams } from './_kit.js'
import * as U from './_unicode.js'

const NAMES_BASE = 'https://cdn.jsdelivr.net/npm/unicode-name@1.2.1/src/'
const EMOJI_URL = 'https://cdn.jsdelivr.net/npm/unicode-emoji-json@0.9.0/data-by-group.json'

let namesPromise = null
/** Loads the name tables once. Resolves {name(str), entries:[[cp, NAME]]}. */
function loadNames() {
  namesPromise ||= (async () => {
    const [api, data] = await Promise.all([import(NAMES_BASE + 'index.js'), import(NAMES_BASE + 'name.js')])
    const { NAMES, COMMON_WORDS, REPLACE_BASE } = data.default
    const decode = (raw) => [...raw].map((c) => { const cp = c.codePointAt(0); return cp < REPLACE_BASE ? c : `${COMMON_WORDS[cp - REPLACE_BASE]} ` }).join('').trim()
    const entries = []
    for (const [ch, raw] of Object.entries(NAMES)) {
      if (ch.length > 2 || [...ch].length !== 1) continue
      entries.push([ch.codePointAt(0), decode(raw)])
    }
    entries.sort((a, b) => a[0] - b[0])
    return { name: (s) => { try { return api.unicodeName(s) } catch { return undefined } }, entries }
  })().catch((e) => { namesPromise = null; throw e })
  return namesPromise
}
let emojiPromise = null
const loadEmoji = () => (emojiPromise ||= fetch(EMOJI_URL).then((r) => { if (!r.ok) throw new Error('Could not load the emoji list.'); return r.json() }).catch((e) => { emojiPromise = null; throw e }))

const PLANES = ['Basic Multilingual Plane', 'Supplementary Multilingual Plane', 'Supplementary Ideographic Plane', 'Tertiary Ideographic Plane', 'Plane 4', 'Plane 5', 'Plane 6', 'Plane 7', 'Plane 8', 'Plane 9', 'Plane 10', 'Plane 11', 'Plane 12', 'Plane 13', 'Supplementary Special-purpose Plane', 'Private Use Plane 15', 'Private Use Plane 16']
const blockOf = (cp) => U.BLOCKS.find(([, a, b]) => cp >= a && cp <= b)?.[0]
const str = (cp) => String.fromCodePoint(cp)

const STYLE = `
.t-ul .ul-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 8px; }
.t-ul .ul-card { display: grid; justify-items: center; gap: 3px; padding: 10px 6px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); color: inherit; cursor: pointer; min-width: 0; text-align: center;
  transition: border-color .2s, transform .2s var(--spring), box-shadow .2s; animation: dv-fade .3s var(--ease) both; }
.t-ul .ul-card:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); transform: translateY(-2px); box-shadow: var(--shadow); }
.t-ul .ul-card[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.t-ul .ul-card .g { font-size: 34px; line-height: 1.2; min-height: 42px; display: grid; place-items: center; font-family: var(--font), "Noto Sans Symbols 2", "Segoe UI Symbol", "Segoe UI Emoji", sans-serif; }
.t-ul .ul-card .u { font-family: var(--mono); font-size: 11.5px; color: var(--accent); }
.t-ul .ul-card .n { font-size: 11.5px; color: var(--muted); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; width: 100%; min-height: 2.6em; line-height: 1.3; }
.t-ul .ul-emoji { display: grid; grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)); gap: 4px; }
.t-ul .ul-emoji button { font-size: 28px; line-height: 1; min-height: 46px; border-radius: 12px; border: 1px solid transparent; background: transparent; cursor: pointer; transition: background .15s, transform .15s var(--spring); }
.t-ul .ul-emoji button:hover { background: var(--surface-2); transform: scale(1.18); }
.t-ul .ul-emoji button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.t-ul .ul-glyph { font-size: clamp(60px, 14vw, 104px); line-height: 1.1; min-width: 1.4em; text-align: center; font-family: var(--font), "Noto Sans Symbols 2", "Segoe UI Symbol", "Segoe UI Emoji", sans-serif; }
.t-ul .ul-head { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; align-items: center; }
@media (max-width: 520px) { .t-ul .ul-head { grid-template-columns: 1fr; justify-items: center; text-align: center; } }
.t-ul .ul-rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 900px) { .t-ul .ul-rows { grid-template-columns: 1fr; } }
.t-ul .ul-rows .dv-copy .k { min-width: 74px; }
.t-ul .ul-name { font-size: clamp(18px, 3vw, 24px); font-weight: 650; letter-spacing: -.01em; overflow-wrap: anywhere; }
.t-ul .ul-cell { font-size: 22px; line-height: 1.2; }
`

const SAMPLES = [['snowman', 'snowman'], ['arrow', 'arrow right'], ['©', '©'], ['U+1F600', 'U+1F600'], ['alpha', 'greek alpha'], ['check', 'check mark'], ['&euro;', '&euro;'], ['zero width', 'zero width']]

export function mount(root) {
  useKit()
  css('t-ul-css', STYLE)
  const q = hashParams()
  let data = null
  let current = ''
  const loading = h('div', { class: 'small muted', 'aria-live': 'polite' })
  const detail = h('div', { class: 'panel stack' })
  const nameOf = (s) => (data ? data.name(s) : undefined)
  const PAGE = 120

  // ----- detail -----
  function show(s, scroll = false) {
    current = s
    const list = U.cps(s)
    const single = list.length === 1
    const cp = list[0]
    const gc = single ? U.categoryOf(cp) : null
    const name = nameOf(s)
    const script = single ? U.scriptOf(cp) : null
    const block = single ? blockOf(cp) : null
    const row = (k, v) => copyRow(k, v, { initial: v })
    const rows = []
    rows.push(row(single ? 'U+' : 'Code pts', list.map(U.label).join(' ')))
    if (single) rows.push(row('Decimal', String(cp)), row('Hex', `0x${U.hexUp(cp, 1)}`))
    rows.push(row('UTF-8', U.utf8Hex(s)), row('UTF-16', U.utf16Hex(s)), row('UTF-32', U.utf32Hex(s)), row('URL', U.percent(s)),
      row('HTML', U.escapeText(s, 'html')),
      row('HTML hex', U.escapeText(s, 'htmlx')))
    if (single && U.entityFor(cp)) rows.push(row('Entity', `&${U.entityFor(cp)};`))
    rows.push(row('CSS', U.escapeText(s, 'css').trim()), row('JavaScript', U.escapeText(s, 'jsu')), row('JS (old)', U.escapeText(s, 'js')), row('Python', U.escapeText(s, 'python')), row('Java', U.escapeText(s, 'java')), row('Rust', U.escapeText(s, 'rust')))
    const info = []
    if (single) {
      info.push(['Category', `${gc} ${U.GC[gc]}`])
      if (script) info.push(['Script', script])
      if (block) info.push(['Block', block])
      info.push(['Plane', `${cp >> 16}: ${PLANES[cp >> 16] || ''}`])
      const up = s.toUpperCase(), lo = s.toLowerCase()
      if (up !== s) info.push(['Uppercase', `${up}  (${U.cps(up).map(U.label).join(' ')})`])
      if (lo !== s) info.push(['Lowercase', `${lo}  (${U.cps(lo).map(U.label).join(' ')})`])
      for (const f of ['NFC', 'NFD', 'NFKC', 'NFKD']) { const n = s.normalize(f); if (n !== s) info.push([f, `${n}  (${U.cps(n).map(U.label).join(' ')})`]) }
    } else {
      info.push(['Characters', `${U.graphemes(s).length} visible, ${list.length} code points, ${s.length} UTF-16 units, ${U.utf8(s).length} UTF-8 bytes`])
    }
    clear(detail,
      h('div', { class: 'ul-head' },
        h('div', { class: 'ul-glyph', 'aria-hidden': 'true' }, single && ['Mn', 'Me', 'Mc', 'Cc', 'Cf', 'Zs', 'Cs', 'Co', 'Cn', 'Zl', 'Zp'].includes(gc) ? U.glyphFor(cp, gc) : s),
        h('div', { class: 'stack tight' },
          h('div', { class: 'ul-name' }, name || (data ? '(no name)' : 'Loading name...')),
          h('div', { class: 'row', style: 'gap:6px' }, single ? [pill('info', null, `${U.label(cp)}`), pill('', null, U.GC[gc]), script ? pill('', 'languages', script) : null] : [pill('info', null, `${list.length} code points`)]),
          h('div', { class: 'row', style: 'gap:6px' }, button('Copy character', { icon: 'copy', variant: 'primary', size: 'sm', onClick: () => copyText(s) }), button('Copy name', { icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => name && copyText(name) })))),
      h('div', { class: 'ul-rows' }, rows),
      h('dl', { class: 'dv-kv' }, info.flatMap(([k, v]) => [h('dt', k), h('dd', v)])),
      !single ? table({ columns: ['', 'Code point', 'Name', 'UTF-8'], rows: list.map((c) => [h('span', { class: 'ul-cell' }, U.glyphFor(c)), U.label(c), nameOf(str(c)) || '', U.utf8Hex(str(c))]) }) : null)
    if (scroll) detail.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  }

  const card = (s, name) => {
    const cp = U.cps(s)[0]
    const single = U.cps(s).length === 1
    return h('button', { type: 'button', class: 'ul-card', 'aria-pressed': String(s === current), title: name || '', onclick: () => { show(s, true); markPressed() } },
      h('div', { class: 'g', 'aria-hidden': 'true' }, single ? U.glyphFor(cp) : s), h('div', { class: 'u' }, single ? U.label(cp) : `${U.cps(s).length} cps`), h('div', { class: 'n' }, name || ''))
  }
  const markPressed = () => { for (const b of root.querySelectorAll('.ul-card')) b.setAttribute('aria-pressed', String(b.dataset.s === current)) }

  // ----- search tab -----
  let results = []
  let shown = PAGE
  const sIn = input({ type: 'search', placeholder: 'A name (snowman, arrow), a character (é, →), a code point (U+1F600, 0x41, &#128512;) or a range (U+2190-21FF)', 'aria-label': 'Search characters', autocomplete: 'off', spellcheck: false })
  const sGrid = h('div', { class: 'ul-grid' })
  const sMore = h('div', { class: 'row', style: 'justify-content:center' })
  const sNote = h('div', { class: 'small muted', 'aria-live': 'polite' })
  const ex = h('div', { class: 'dv-chips' }, SAMPLES.map(([label, v]) => h('button', { type: 'button', class: 'dv-chip', onclick: () => { sIn.value = v; runSearch() } }, label)))

  async function emojiMatches(words) {
    try {
      const groups = await loadEmoji()
      const out = []
      for (const g of groups) for (const e of g.emojis) {
        if (U.cps(e.emoji.replace(/️/g, '')).length < 2) continue
        const n = e.name.toLowerCase()
        if (words.every((w) => n.includes(w))) out.push([e.emoji, e.name])
      }
      return out
    } catch { return [] }
  }

  async function runSearch() {
    const raw = sIn.value
    const pq = U.parseQuery(raw)
    shown = PAGE
    const myRaw = raw
    if (pq.type === 'empty') { results = []; clear(sGrid, h('div', { style: 'grid-column:1/-1' }, empty('Search by name, paste a character, or type a code point like U+2603.', 'languages'))); clear(sMore); sNote.textContent = ''; return }
    if (pq.type === 'cps') results = pq.list.map((c) => [str(c), nameOf(str(c))])
    else if (pq.type === 'chars') results = pq.list.map((c) => [str(c), nameOf(str(c))])
    else if (pq.type === 'range') { results = []; for (let c = pq.from; c <= pq.to; c++) { const n = nameOf(str(c)); if (n && !n.startsWith('<')) results.push([str(c), n]) } }
    else {
      if (!data) { sNote.textContent = 'Loading the Unicode name tables (about 1.7 MB, cached after the first visit)...'; try { await ensure() } catch { return clear(sGrid, h('div', { style: 'grid-column:1/-1' }, alert('error', 'The name tables could not be loaded. Check your connection and try again. You can still search by character or code point.'))) } if (raw !== sIn.value) return }
      const words = pq.q.toLowerCase().split(/\s+/).filter(Boolean)
      const full = pq.q.toLowerCase().trim()
      const scored = []
      for (const [cp, name] of data.entries) {
        const n = name.toLowerCase()
        if (!words.every((w) => n.includes(w))) continue
        const wordList = n.split(/[\s-]+/)
        const r = n === full ? 0 : n.startsWith(full) ? 1 : words.every((w) => wordList.includes(w)) ? 2 : words.every((w) => wordList.some((x) => x.startsWith(w))) ? 3 : 4
        scored.push([r, cp, name])
      }
      scored.sort((a, b) => a[0] - b[0] || a[2].length - b[2].length || a[1] - b[1])
      results = scored.map(([, cp, name]) => [str(cp), name])
      const em = await emojiMatches(words)
      if (myRaw !== sIn.value) return
      results.push(...em.filter(([s]) => !results.some(([t]) => t === s)))
    }
    renderResults(pq)
  }
  function renderResults(pq) {
    sNote.textContent = results.length ? `${formatNumber(results.length, 0)} result${results.length === 1 ? '' : 's'}${pq?.clipped ? ' (range limited to 1,024 code points)' : ''}` : ''
    clear(sGrid, ...(results.length ? results.slice(0, shown).map(([s, n]) => { const c = card(s, n); c.dataset.s = s; return c }) : [h('div', { style: 'grid-column:1/-1' }, empty('No character matches that. Try fewer words, or search by code point (U+...).', 'search-x'))]))
    clear(sMore, results.length > shown ? button(`Show ${Math.min(PAGE, results.length - shown)} more`, { icon: 'chevrons-down', onClick: () => { shown += PAGE; renderResults(pq) } }) : null)
  }
  sIn.addEventListener('input', debounce(runSearch, 160))

  // ----- inspect tab -----
  const tIn = textarea({ rows: 4, mono: true, spellcheck: false, placeholder: 'Paste any text to see every code point: é́ \u{1F468}‍\u{1F469}‍\u{1F467} \u{1F1EE}\u{1F1F3}', 'aria-label': 'Text to inspect' })
  const tStats = h('div', { class: 'row', style: 'gap:6px' })
  const tTable = h('div')
  const tFmt = chips(U.ESCAPES, { value: 'js', ariaLabel: 'Output format', onChange: () => inspect() })
  const tOut = outBox('Escaped text', { placeholder: '' })
  function inspect() {
    const s = tIn.value
    clear(tStats); clear(tTable)
    if (!s) { tOut.set(''); tStats.append(h('span', { class: 'small muted' }, 'Type or paste text to inspect it.')); return }
    const list = U.cps(s)
    tStats.append(pill('info', 'type', `${U.graphemes(s).length} visible character${U.graphemes(s).length === 1 ? '' : 's'}`), pill('', null, `${list.length} code points`), pill('', null, `${s.length} UTF-16 units`), pill('', null, `${U.utf8(s).length} UTF-8 bytes`))
    tOut.set(U.escapeText(s, tFmt.value), { quiet: true })
    const rows = list.slice(0, 300).map((c) => [h('span', { class: 'ul-cell' }, U.glyphFor(c)), U.label(c), nameOf(str(c)) || '', U.categoryOf(c), U.utf8Hex(str(c)),
      button('', { icon: 'eye', size: 'sm', variant: 'ghost', ariaLabel: `Details for ${U.label(c)}`, onClick: () => show(str(c), true) })])
    tTable.append(table({ columns: ['', 'Code point', 'Name', 'Cat.', 'UTF-8', ''], rows }), list.length > 300 ? h('div', { class: 'small muted' }, 'Showing the first 300 code points.') : null)
  }
  tIn.addEventListener('input', debounce(inspect, 120))
  const normBtns = ['NFC', 'NFD', 'NFKC', 'NFKD'].map((f) => button(f, { size: 'sm', variant: 'ghost', title: `Normalize the text to ${f}`, onClick: () => { tIn.value = tIn.value.normalize(f); inspect() } }))
  const inspectView = h('div', { class: 'stack' }, tIn,
    h('div', { class: 'row' }, button('Decode escapes', { icon: 'wand-sparkles', size: 'sm', title: 'Turn \\u00e9, &#233;, &copy;, U+1F600 and %C3%A9 into characters', onClick: () => { tIn.value = U.unescapeText(tIn.value); inspect() } }), h('span', { class: 'small muted' }, 'Normalize:'), ...normBtns, button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { tIn.value = ''; inspect(); tIn.focus() } }), button('Example', { icon: 'sparkles', size: 'sm', variant: 'ghost', onClick: () => { tIn.value = 'café é́ \u{1F468}‍\u{1F469}‍\u{1F467} \u{1F1EE}\u{1F1F3} 中文'; inspect() } })),
    tStats, h('div', { class: 'stack tight' }, eyebrow('code', 'Escape or encode the text'), tFmt, tOut.el), tTable)

  // ----- emoji tab -----
  let emojiGroups = null
  let eGroup = 'all'
  const eIn = input({ type: 'search', placeholder: 'Search emoji by name: heart, flag, cat...', 'aria-label': 'Search emoji', oninput: () => renderEmoji() })
  const eChips = h('div')
  const eGrid = h('div', { class: 'ul-emoji' })
  const eNote = h('div', { class: 'small muted' })
  async function initEmoji() {
    clear(eGrid, h('div', { class: 'small muted', style: 'grid-column:1/-1' }, 'Loading emoji...'))
    try { emojiGroups = await loadEmoji() } catch (e) { clear(eGrid, h('div', { style: 'grid-column:1/-1' }, alert('error', e.message))); return }
    clear(eChips, chips([['all', 'All'], ...emojiGroups.map((g) => [g.name, g.name.replace(' & ', ' and ')])], { value: 'all', ariaLabel: 'Emoji group', onChange: (v) => { eGroup = v; renderEmoji() } }))
    renderEmoji()
  }
  function renderEmoji() {
    if (!emojiGroups) return
    const words = eIn.value.toLowerCase().split(/\s+/).filter(Boolean)
    const list = emojiGroups.filter((g) => eGroup === 'all' || g.name === eGroup).flatMap((g) => g.emojis).filter((e) => words.every((w) => e.name.toLowerCase().includes(w)))
    eNote.textContent = `${formatNumber(list.length, 0)} emoji`
    clear(eGrid, ...(list.length ? list.slice(0, 600).map((e) => h('button', { type: 'button', title: e.name, 'aria-label': e.name, 'aria-pressed': String(e.emoji === current), onclick: () => { show(e.emoji, true); for (const b of eGrid.children) b.setAttribute('aria-pressed', String(b.title === e.name)) }, ondblclick: () => copyText(e.emoji) }, e.emoji)) : [h('div', { style: 'grid-column:1/-1' }, empty('No emoji matches that.', 'search-x'))]))
  }
  const emojiView = h('div', { class: 'stack' }, eIn, eChips, eNote, eGrid, h('div', { class: 'small muted' }, 'Click an emoji to see its code points and escapes; double-click to copy it.'))

  // ----- blocks tab -----
  let bIdx = U.BLOCKS.findIndex(([n]) => n === 'Arrows')
  let bShown = 256
  const bSel = select(U.BLOCKS.map(([n, a, b], i) => [i, `${n}  (U+${U.hexUp(a)}-${U.hexUp(b)})`]), bIdx, (v) => { bIdx = +v; bShown = 256; renderBlock() })
  bSel.setAttribute('aria-label', 'Unicode block')
  const bGrid = h('div', { class: 'ul-grid' })
  const bMore = h('div', { class: 'row', style: 'justify-content:center' })
  const bNote = h('div', { class: 'small muted' })
  function renderBlock() {
    const [, a, b] = U.BLOCKS[bIdx]
    const items = []
    for (let c = a; c <= b; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue
      const n = nameOf(str(c))
      if (data && (!n || n.startsWith('<'))) continue
      if (!data && U.categoryOf(c) === 'Cn') continue
      items.push([str(c), n])
    }
    bNote.textContent = `${formatNumber(items.length, 0)} assigned characters in this block`
    clear(bGrid, ...items.slice(0, bShown).map(([s, n]) => { const c = card(s, n); c.dataset.s = s; return c }))
    clear(bMore, items.length > bShown ? button(`Show ${Math.min(256, items.length - bShown)} more`, { icon: 'chevrons-down', onClick: () => { bShown += 256; renderBlock() } }) : null)
  }
  const blocksView = h('div', { class: 'stack' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Block'), bSel), bNote, bGrid, bMore)

  const main = tabs([
    { id: 'search', label: 'Search', render: () => h('div', { class: 'stack' }, sIn, ex, sNote, sGrid, sMore) },
    { id: 'inspect', label: 'Inspect text', render: () => inspectView },
    { id: 'emoji', label: 'Emoji', render: () => { initEmoji(); return emojiView } },
    { id: 'blocks', label: 'Browse blocks', render: () => { renderBlock(); return blocksView } },
  ], q.get('tab') || 'search')

  async function ensure() {
    if (data) return data
    data = await loadNames()
    return data
  }

  root.append(h('div', { class: 'dv t-ul stack' }, detail, loading, h('div', { class: 'panel' }, main),
    h('p', { class: 'small muted' }, 'Names and properties follow the Unicode Standard (names from the unicode-name package, emoji lists from unicode-emoji-json). The data downloads once from jsDelivr and is then cached by your browser; everything else runs locally.')))

  // Start with a useful selection, then fill in names once the tables arrive.
  const start = q.get('c') ? (U.parseQuery(q.get('c')).list ? U.parseQuery(q.get('c')).list.map((c) => str(c)).join('') : q.get('c')) : '€'
  show(start)
  loading.textContent = 'Loading Unicode names...'
  ensure().then(() => {
    loading.textContent = ''
    show(current)
    markPressed()
    if (sIn.value) runSearch()
    if (bGrid.isConnected) renderBlock()
  }).catch(() => { loading.textContent = ''; clear(loading, alert('warn', 'The Unicode name tables could not be loaded, so names are unavailable. Code points, encodings and escapes still work.')) })
  inspect()
  runSearch()
}
