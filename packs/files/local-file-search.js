// Local file search: pick a folder, then search file names (plain text, glob or regex) and file contents (text files only, size limit,
// binaries skipped). Results show line snippets with highlighted matches and open in a preview. Nothing is uploaded or indexed.
import { h, icon, clear, button, alert, stats, field, input, select, toggle, segmented, progress, formatBytes, errorMessage, onCleanup, yieldToMain } from '../../lib/ui.js'
import { readRange, looksBinary, decodeText, fmtDateTime, throwIfAborted, DEFAULT_SKIP, extOf } from './_core.js'
import { useFx, folderZone, card, chip, chips, tile, openPreview, highlightNodes, injectStyle } from './_ui.js'

// ---------- Pure helpers (exported for tests) ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Glob to RegExp: * (not across /), ** (across /), ? , [abc], {a,b}. Anchored. */
export function globToRegExp(glob, flags = 'i') {
  let out = ''
  let inBrace = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') { if (glob[i + 1] === '*') { out += '.*'; i++; if (glob[i + 1] === '/') i++ } else out += '[^/]*' }
    else if (c === '?') out += '[^/]'
    else if (c === '[') { const j = glob.indexOf(']', i + 1); if (j > i) { out += `[${glob.slice(i + 1, j).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`; i = j } else out += '\\[' }
    else if (c === '{') { inBrace++; out += '(?:' }
    else if (c === '}' && inBrace) { inBrace--; out += ')' }
    else if (c === ',' && inBrace) out += '|'
    else out += esc(c)
  }
  while (inBrace-- > 0) out += ')'
  return new RegExp(`^${out}$`, flags)
}
export const hasGlob = (s) => /[*?[\]{}]/.test(s)

/** Build a content regex (global). opts: {regex, caseSensitive, wholeWord}. Throws SyntaxError for a bad pattern. */
export function contentRegExp(q, { regex = false, caseSensitive = false, wholeWord = false } = {}) {
  let src = regex ? q : esc(q)
  if (wholeWord) src = `\\b(?:${src})\\b`
  return new RegExp(src, caseSensitive ? 'g' : 'gi')
}

/** Build a name predicate: (entry) => boolean. */
export function nameMatcher(q, { regex = false, caseSensitive = false } = {}) {
  const target = (e) => (q.includes('/') ? e.path : e.name)
  if (regex) { const re = new RegExp(q, caseSensitive ? '' : 'i'); return (e) => re.test(target(e)) }
  if (hasGlob(q)) { const re = globToRegExp(q, caseSensitive ? '' : 'i'); return (e) => re.test(target(e)) }
  const needle = caseSensitive ? q : q.toLowerCase()
  return (e) => (caseSensitive ? target(e) : target(e).toLowerCase()).includes(needle)
}

/** "js, ts *.md" -> predicate on an entry, or null when empty. A bare word or .ext means that extension. */
export function typeFilter(text) {
  const parts = text.split(/[,\s;]+/).filter(Boolean)
  if (!parts.length) return null
  const exts = new Set(), globs = []
  for (const p of parts) { if (hasGlob(p)) globs.push(globToRegExp(p)); else exts.add(p.replace(/^\./, '').toLowerCase()) }
  return (e) => exts.has(extOf(e.name)) || globs.some((g) => g.test(e.name))
}

/** Find matches in text. Returns {matches: [{line, start, end, text}], total} with at most `limit` matches kept. */
export function searchText(text, re, limit = 200) {
  const matches = []
  let total = 0
  let starts = null
  const lineOf = (pos) => {
    if (!starts) { starts = [0]; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1) }
    let lo = 0, hi = starts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1 }
    return lo
  }
  re.lastIndex = 0
  for (let m; (m = re.exec(text)); ) {
    if (!m[0]) { re.lastIndex++; continue }
    total++
    if (matches.length < limit) {
      const li = lineOf(m.index)
      const ls = starts[li]
      let le = text.indexOf('\n', m.index)
      if (le < 0) le = text.length
      matches.push({ line: li + 1, text: text.slice(ls, le).replace(/\r$/, ''), col: m.index - ls, len: m[0].length })
    }
  }
  return { matches, total }
}

/** Trim a long line to a window around the match. */
export function snippet(text, col, len, max = 190) {
  if (text.length <= max) return { text, shift: 0 }
  const from = Math.max(0, Math.min(col - 60, text.length - max))
  return { text: (from > 0 ? '…' : '') + text.slice(from, from + max) + (from + max < text.length ? '…' : ''), shift: from > 0 ? from - 1 : 0 }
}

const CSS = `
.fx-sr { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.fx-sr-h { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 10px 12px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.fx-sr-h .p { flex: 1 1 220px; min-width: 0; text-align: left; border: 0; background: none; padding: 0; font: inherit; cursor: pointer; color: var(--text); overflow-wrap: anywhere; }
.fx-sr-h .p b { font-weight: 600; }
.fx-sr-h .p small { display: block; color: var(--muted); font-size: 12px; }
.fx-sr-h .p:hover b { color: var(--accent); }
.fx-sl { display: grid; grid-template-columns: 52px minmax(0, 1fr); width: 100%; text-align: left; border: 0; border-top: 1px solid var(--border); background: none; padding: 0; font: 12.5px/1.6 var(--mono); cursor: pointer; color: var(--text); }
.fx-sl:first-of-type { border-top: 0; }
.fx-sl:hover { background: var(--surface-2); }
.fx-sl > span:first-child { text-align: right; padding: 2px 10px 2px 6px; color: var(--muted); border-right: 1px solid var(--border); user-select: none; }
.fx-sl > span:last-child { padding: 2px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.fx-sl mark, .fx-sr-h mark { background: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.fx-sr-more { padding: 8px 12px; border-top: 1px solid var(--border); font-size: 12.5px; color: var(--muted); display: flex; gap: 10px; align-items: center; }
`

const LIMITS = { files: 400, matches: 5000 }

export function mount(root) {
  useFx()
  injectStyle('fx-search', CSS)
  const out = h('div', { class: 'stack' })
  let scan = null, ctl = null
  const zone = folderZone({ write: false, skip: DEFAULT_SKIP, label: 'Drop a folder here or click to choose one', hint: 'Skips .git and node_modules. Your files stay on this device.', onFolder: (res) => { scan = res; form.hidden = false; zone.classList.add('compact'); clear(out, h('div', { class: 'empty' }, icon('search'), h('div', `Ready to search ${res.entries.length.toLocaleString()} files in "${res.name}". Type something and press Search.`))); q.focus() } })

  const q = input({ placeholder: 'What are you looking for?', 'aria-label': 'Search for', onkeydown: (e) => { if (e.key === 'Enter') go() } })
  const mode = segmented([['plain', 'Text or glob'], ['regex', 'Regex']], 'plain', null, 'Match type')
  const inNames = toggle('File names', true)
  const inText = toggle('File contents', true)
  const caseBox = toggle('Match case', false)
  const wordBox = toggle('Whole word', false)
  const types = input({ placeholder: 'All files. Or e.g. js, ts, *.md', 'aria-label': 'Only these file types' })
  const maxSel = select([[1, 'up to 1 MB'], [5, 'up to 5 MB'], [25, 'up to 25 MB'], [100, 'up to 100 MB']], 25)
  const goBtn = button('Search', { icon: 'search', variant: 'primary', size: 'lg', onClick: () => go() })
  const stopBtn = button('Stop', { variant: 'ghost', onClick: () => ctl?.abort() })
  stopBtn.hidden = true
  const prog = progress('Searching')
  const form = card('Search', 'folder-search', '#3e63dd', h('div', { class: 'stack' },
    h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { style: 'flex:1;min-width:220px' }, field('Search for', q)), goBtn, stopBtn),
    h('div', { class: 'row' }, mode, inNames, inText),
    h('div', { class: 'row' }, caseBox, wordBox),
    h('div', { class: 'grid-2' }, field('Only these file types', types), field('Look inside text files', maxSel, 'Bigger files and binaries are skipped'))))
  form.hidden = true
  root.append(h('div', { class: 'stack fx' }, zone, form, prog.el, out))
  onCleanup(() => ctl?.abort())

  async function go() {
    if (!scan) return
    const query = q.value
    if (!query.trim()) { q.focus(); return clear(out, alert('info', 'Type something to search for.')) }
    ctl?.abort()
    const mine = (ctl = new AbortController())
    const regex = mode.value === 'regex'
    const o = { regex, caseSensitive: caseBox.input.checked, wholeWord: wordBox.input.checked }
    let nameTest, re, typeTest
    try {
      if (inNames.input.checked) nameTest = nameMatcher(query, o)
      if (inText.input.checked) re = contentRegExp(query, o)
      typeTest = typeFilter(types.value)
    } catch (e) { return clear(out, alert('error', `That is not a valid regular expression: ${e.message}`)) }
    if (!nameTest && !re) return clear(out, alert('info', 'Tick File names, File contents, or both.'))
    const maxBytes = +maxSel.value * 1024 * 1024
    goBtn.disabled = true; stopBtn.hidden = false
    const list = h('div', { class: 'stack' })
    const summary = h('div')
    clear(out, summary, list)
    const entries = typeTest ? scan.entries.filter(typeTest) : scan.entries
    let searched = 0, skippedBin = 0, skippedBig = 0, failed = 0, fileHits = 0, matchTotal = 0, nameHits = 0, capped = false
    const t0 = performance.now()
    const view = re ? new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g') : null
    try {
      for (let i = 0; i < entries.length; i++) {
        throwIfAborted(mine.signal)
        const e = entries[i]
        if (i % 8 === 0) { prog.set(i / entries.length, `Searching ${i.toLocaleString()} of ${entries.length.toLocaleString()} files`); await yieldToMain() }
        const nameHit = nameTest ? nameTest(e) : false
        let res = null
        if (re) {
          if (e.size === 0) { /* nothing inside */ } else if (e.size > maxBytes) skippedBig++
          else {
            try {
              const head = await readRange(e.file, 0, 8192)
              if (looksBinary(head)) skippedBin++
              else { res = searchText(decodeText(new Uint8Array(await e.file.arrayBuffer())), re, 200); searched++ }
            } catch { failed++ }
          }
        }
        const hasText = res && res.total > 0
        if (!nameHit && !hasText) continue
        if (nameHit) nameHits++
        if (hasText) { fileHits++; matchTotal += res.total }
        if (list.childElementCount < LIMITS.files) list.append(resultCard(e, nameHit, res, view, query, o))
        if (fileHits + nameHits >= LIMITS.files * 2 || matchTotal >= LIMITS.matches) { capped = true; break }
        renderSummary()
      }
      prog.set(1, 'Done')
    } catch (err) {
      if (err?.code !== 'ABORT') { console.error(err); clear(out, alert('error', errorMessage(err))) }
    } finally {
      if (ctl === mine) { goBtn.disabled = false; stopBtn.hidden = true; prog.hide() }
    }
    renderSummary(true, mine.signal.aborted)
    function renderSummary(final = false, stopped = false) {
      const secs = (performance.now() - t0) / 1000
      clear(summary, stats([
        { label: 'Files with matches', value: fileHits.toLocaleString(), accent: true, hint: re ? `${matchTotal.toLocaleString()} matching lines or spots` : '' },
        { label: 'Name matches', value: nameHits.toLocaleString() },
        { label: 'Files searched', value: searched.toLocaleString(), hint: `${secs < 10 ? secs.toFixed(1) : Math.round(secs)} s${stopped ? ', stopped early' : ''}` },
        { label: 'Skipped', value: (skippedBin + skippedBig + failed).toLocaleString(), hint: [skippedBin && `${skippedBin} binary`, skippedBig && `${skippedBig} too big`, failed && `${failed} unreadable`].filter(Boolean).join(', ') }]),
      final && !fileHits && !nameHits ? alert('info', h('strong', 'Nothing found. '), `No file name or text contains "${query}"${typeTest ? ' among the chosen file types' : ''}. Try fewer words, untick Match case, or raise the size limit.`) : null,
      capped ? alert('warn', 'There are a lot of results, so the search stopped early. Make your query more specific to see everything.') : null)
    }
  }

  function resultCard(e, nameHit, res, view, query, o) {
    const k = res?.matches || []
    let expanded = false
    const linesEl = h('div')
    const more = h('div', { class: 'fx-sr-more' })
    const drawLines = () => {
      const show = expanded ? k : k.slice(0, 6)
      clear(linesEl, show.map((m) => {
        const s = snippet(m.text, m.col, m.len)
        return h('button', { type: 'button', class: 'fx-sl', title: 'Open the file at this line', onclick: () => openPreview(e.file, { name: e.path, re: view, line: m.line }) },
          h('span', m.line), h('span', highlightNodes(s.text, new RegExp(view.source, view.flags))))
      }))
      clear(more, k.length > 6 && !expanded ? button(`Show ${k.length - 6} more${res.total > k.length ? ' of the first 200' : ''}`, { size: 'sm', onClick: () => { expanded = true; drawLines() } }) : null,
        res && res.total > k.length && expanded ? h('span', `${res.total - k.length} more matches in this file are not listed. Open it to see them.`) : null)
      more.hidden = !more.childElementCount
    }
    const head = h('div', { class: 'fx-sr-h' }, tile(e.name, { size: 'sm' }),
      h('button', { type: 'button', class: 'p', onclick: () => openPreview(e.file, { name: e.path, re: view }) }, h('b', nameHit && !o.regex && !hasGlob(query) ? highlightNodes(e.name, contentRegExp(query, o)) : e.name), h('small', `${e.dir || '(top folder)'} · ${formatBytes(e.size)} · ${fmtDateTime(e.mtime)}`)),
      chips(nameHit ? chip('Name match', 'accent', 'tag') : null, res?.total ? chip(`${res.total.toLocaleString()} match${res.total === 1 ? '' : 'es'}`, 'ok', 'text-search') : null))
    const el = h('section', { class: 'fx-sr fx-in' }, head, linesEl, more)
    if (k.length) drawLines(); else more.hidden = true
    return el
  }
}
