// Small text transforms that share one page layout: remove accents, upside-down text, spelling alphabets (NATO and friends),
// fast-read text (bold word starts), hard wrap / unwrap and sentence splitting. params.kind picks the tool.
// Pure helpers are exported for tests.
import { h, button, copyText, toast, rangeField } from '../../lib/ui.js'
import {
  studio, root, dock, group, chips, ribbon, pane, area, createOptions, copyBtn, inputActions, acceptFiles, flash, plural, injectStyle, tokenCard, burst, tooBig,
} from './_shared.js'
import { removeAccents } from './_translit.js'
import { flipText } from './fancy-text.js'

/// ---------- wrap and unwrap ----------
/** Reflow or wrap text at `width` characters. mode 'reflow' joins each paragraph first, 'lines' wraps every line on its own, 'unwrap' joins hard-wrapped lines. */
export function wrapText(text, o) {
  const width = Math.max(10, Math.floor(o.width) || 80)
  const len = (s) => [...s].length
  const indent = ' '.repeat(Math.max(0, Math.floor(o.indent) || 0))
  const wrapParagraph = (para) => {
    const lines = []
    let cur = ''
    for (let w of para.split(/\s+/).filter(Boolean)) {
      // a word longer than the room on its line is cut into pieces when breakLong is on
      while (o.breakLong) {
        const ind = lines.length || cur ? len(indent) : 0
        if (len(w) <= width - ind) break
        if (cur) { lines.push(cur); cur = '' }
        const take = Math.max(1, width - (lines.length ? len(indent) : 0))
        lines.push((lines.length ? indent : '') + [...w].slice(0, take).join(''))
        w = [...w].slice(take).join('')
      }
      if (!w) continue
      if (!cur) cur = (lines.length ? indent : '') + w
      else if (len(cur) + 1 + len(w) <= width) cur += ` ${w}`
      else { lines.push(cur); cur = indent + w }
    }
    if (cur) lines.push(cur)
    return lines.join('\n')
  }
  if (o.mode === 'unwrap') return text.split(/\n[ \t]*\n/).map((p) => p.split(/\s*\n\s*/).map((l) => l.trim()).filter(Boolean).join(' ')).join('\n\n')
  if (o.mode === 'lines') return text.split('\n').map((line) => (line.trim() ? wrapParagraph(line) : '')).join('\n')
  return text.split(/\n[ \t]*\n/).map((p) => (p.trim() ? wrapParagraph(p) : '')).join('\n\n')
}

// ---------- sentences ----------
const ABBR = new Set('mr mrs ms dr prof sr jr st vs v e.g i.e cf fig figs no nos vol vols approx dept est ca viz mt ft gen col lt capt sgt rev hon pp al rs a.m p.m'.split(' '))
/** Split text into sentences, keeping Dr., e.g., initials and decimals together. Newlines inside a paragraph count as spaces. Paragraph gaps come back as null. */
export function splitSentences(text) {
  const out = []
  for (const para of text.split(/\n[ \t]*\n/)) {
    const flat = para.replace(/\s*\n\s*/g, ' ').trim()
    if (!flat) { out.push(null); continue }
    let start = 0
    const re = /([.!?\u{2026}\u{964}]+)(["'\u{201d}\u{2019})\]]*)(\s+|$)/gu
    let m
    while ((m = re.exec(flat))) {
      const endIdx = m.index + m[1].length + m[2].length
      const rest = flat.slice(endIdx + m[3].length)
      if (!rest) break
      const before = flat.slice(start, m.index)
      const prevTok = (before.match(/[\p{L}\p{N}.]+$/u) || [''])[0].toLowerCase().replace(/^\.+|\.+$/g, '')
      if (/[.\u{2026}]/u.test(m[1])) {
        if (m[1] === '.' && ABBR.has(prevTok)) continue
        if (m[1] === '.' && /(^|[\s(])\p{Lu}$/u.test(before)) continue
        if (/^\p{Ll}/u.test(rest)) continue
      }
      out.push(flat.slice(start, endIdx).trim())
      start = endIdx + m[3].length
    }
    if (start < flat.length) out.push(flat.slice(start).trim())
    out.push(null)
  }
  while (out.length && out[out.length - 1] === null) out.pop()
  return out
}

// ---------- spelling alphabets ----------
const NATO = 'Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey X-ray Yankee Zulu'.split(' ')
const ALPHAS = {
  nato: NATO,
  simple: 'Apple Ball Cat Dog Elephant Fish Goat Hat Igloo Jug Kite Lion Monkey Nest Orange Parrot Queen Rabbit Sun Tiger Umbrella Van Watch X-ray Yak Zebra'.split(' '),
  apco: 'Adam Boy Charles David Edward Frank George Henry Ida John King Lincoln Mary Nora Ocean Paul Queen Robert Sam Tom Union Victor William X-ray Young Zebra'.split(' '),
}
const DIGITS = 'Zero One Two Three Four Five Six Seven Eight Nine'.split(' ')
const RADIO_DIGITS = 'Zero Wun Too Tree Fower Fife Six Seven Ait Niner'.split(' ')
/** spell(text, {alphabet, radio, official}) -> {words: [[char, word]...per original word], skipped} */
export function spell(text, o) {
  const list = [...(ALPHAS[o.alphabet] || NATO)]
  if (o.alphabet === 'nato' && !o.official) { list[0] = 'Alpha'; list[9] = 'Juliet' }
  const digits = o.alphabet === 'nato' && o.radio ? RADIO_DIGITS : DIGITS
  const skipped = new Set()
  const words = text.split(/\s+/).filter(Boolean).map((w) => {
    const pairs = []
    for (const ch of w.normalize('NFD').replace(/[\u{300}-\u{36f}]/gu, '')) {
      const up = ch.toUpperCase()
      if (up >= 'A' && up <= 'Z' && up.length === 1) pairs.push([up, list[up.charCodeAt(0) - 65]])
      else if (ch >= '0' && ch <= '9') pairs.push([ch, digits[Number(ch)]])
      else skipped.add(ch)
    }
    return pairs
  }).filter((p) => p.length)
  return { words, skipped: [...skipped] }
}

// ---------- fast-read text ----------
/** Split every word into a bold start and a plain end. Returns lines of parts [{t, b}]. */
export function fastRead(text, o) {
  const ratio = { light: 0.3, medium: 0.5, strong: 0.7 }[o.strength] ?? 0.5
  return text.split('\n').map((line) => {
    const parts = []
    let last = 0
    for (const m of line.matchAll(/[\p{L}\p{M}\p{N}]+(?:['\u{2019}][\p{L}\p{M}\p{N}]+)*/gu)) {
      if (m.index > last) parts.push({ t: line.slice(last, m.index), b: false })
      const chars = [...m[0]]
      const k = chars.length <= (o.skipShort ? 2 : 1) ? (o.skipShort ? 0 : chars.length) : Math.max(1, Math.round(chars.length * ratio))
      if (k > 0) parts.push({ t: chars.slice(0, k).join(''), b: true })
      if (chars.length > k) parts.push({ t: chars.slice(k).join(''), b: false })
      last = m.index + m[0].length
    }
    if (last < line.length) parts.push({ t: line.slice(last), b: false })
    return parts
  })
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const fastReadHtml = (lines) => lines.map((l) => l.map((p) => (p.b ? `<b>${esc(p.t)}</b>` : esc(p.t))).join('')).join('<br>\n')
export const fastReadMd = (lines) => lines.map((l) => l.map((p) => (p.b ? `**${p.t}**` : p.t)).join('')).join('\n')

// ---------- UI per kind ----------
const CSS = `
.tu-spell { display: flex; flex-wrap: wrap; gap: 8px; margin-inline: -6px; padding-inline: 6px; overflow-x: clip; }
.tu-sp { display: flex; flex-direction: column; align-items: center; min-width: 74px; padding: 9px 10px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); animation: tu-pop .4s var(--spring) both; animation-delay: calc(var(--i, 0) * 25ms); }
.tu-sp b { font-size: 20px; color: var(--accent); line-height: 1.1; }
.tu-sp span { font-size: 12.5px; }
.tu-bionic { padding: 6px 18px 18px; min-height: 260px; max-height: 560px; overflow: auto; overflow-wrap: anywhere; white-space: pre-wrap; outline: none; }
.tu-bionic b { font-weight: 800; color: var(--text); }
.tu-bionic.serif { font-family: Georgia, "Times New Roman", serif; }
.tu-bionic.mono { font-family: var(--mono); }
.tu-area.ruler { white-space: pre; overflow-x: auto; background-attachment: local; background-image: linear-gradient(to right, transparent calc(16px + var(--cols, 80) * 1ch), color-mix(in srgb, var(--accent) 55%, transparent) calc(16px + var(--cols, 80) * 1ch), color-mix(in srgb, var(--accent) 55%, transparent) calc(17px + var(--cols, 80) * 1ch), transparent calc(17px + var(--cols, 80) * 1ch)); }
.tu-long { color: var(--warning); }
`

const CONFIG = {
  accents: {
    inTitle: 'Text with accents', outTitle: 'Plain letters', file: 'no-accents.txt', mono: false,
    placeholder: 'Type or paste text like Caf\u{e9} cr\u{e8}me, Stra\u{df}e, \u{141}\u{f3}d\u{17a}, ni\u{f1}o...',
    sample: 'Caf\u{e9} cr\u{e8}me br\u{fb}l\u{e9}e, Stra\u{df}e, \u{141}\u{f3}d\u{17a}, \u{c5}ngstr\u{f6}m, ni\u{f1}o, \u{158}ezn\u{ed}\u{10d}ek.\n\u{928}\u{92e}\u{938}\u{94d}\u{924}\u{947} stays the same.',
    defaults: { special: true },
  },
  flip: {
    inTitle: 'Your text', outTitle: 'Upside-down text', file: 'upside-down.txt', mono: false, placeholder: 'Type something to flip...', sample: 'Hello, World! 123',
    defaults: { reverse: true },
  },
  nato: {
    inTitle: 'Letters, names or codes', outTitle: 'Spelled out', file: 'spelling.txt', mono: false, placeholder: 'Type a name, plate number or code to spell out...', sample: 'Anil K 4509',
    defaults: { alphabet: 'nato', radio: true, official: true, layout: 'row' },
  },
  wrap: {
    inTitle: 'Your text', outTitle: 'Wrapped text', file: 'wrapped.txt', mono: true, placeholder: 'Paste a long paragraph, a commit message or a README...',
    sample: 'Hard wrapping breaks long lines at a fixed column so text fits terminals, emails and code comments. This sample is one long line that will be folded at the width you choose, while words are never split in the middle.\n\nA second paragraph stays separate, so blank lines are kept exactly where they are.',
    defaults: { mode: 'reflow', width: 60, indent: 0, breakLong: true },
  },
  sentences: {
    inTitle: 'Your text', outTitle: 'One sentence per line', file: 'sentences.txt', mono: false, placeholder: 'Paste a paragraph...',
    sample: 'Dr. Mehta arrived at 9.30 a.m. on Monday. She met J. K. Rao, who runs Acme Inc. The budget was Rs. 4.5 lakh! Was that enough? Nobody knew... Then the meeting ended.\n\n\u{92d}\u{93e}\u{930}\u{924} \u{90f}\u{915} \u{926}\u{947}\u{936} \u{939}\u{948}\u{964} \u{92f}\u{939} \u{92c}\u{939}\u{941}\u{924} \u{92c}\u{921}\u{93c}\u{93e} \u{939}\u{948}\u{964}',
    defaults: { numbered: false, blank: false, trim: true },
  },
}

function accentsRun(text, o) {
  const r = removeAccents(text, o.special)
  const total = [...r.changed.values()].reduce((a, b) => a + b.count, 0)
  const tokens = [...r.changed.entries()].sort((a, b) => b[1].count - a[1].count).map(([from, v]) => [`${from} \u{2192} ${v.to}`, v.count])
  return { text: r.text, badges: text ? [{ label: 'letters changed', value: total, tone: total ? 'good' : '' }, { label: 'different characters', value: r.changed.size }] : [], note: text && !total ? 'No accents found in this text.' : '', extra: tokenCard('What changed', tokens, { max: 30 }) }
}

function spellRun(text, o) {
  const r = spell(text, o)
  const flat = r.words.flat()
  let out
  if (o.layout === 'list') out = r.words.map((w) => w.map(([c, word]) => `${c} - ${word}`).join('\n')).join('\n\n')
  else if (o.layout === 'for') out = r.words.map((w) => w.map(([c, word]) => `${c} for ${word}`).join(', ')).join('\n')
  else out = r.words.map((w) => w.map(([, word]) => word).join(' ')).join(' / ')
  const tiles = h('section', { class: 'tu-card' }, h('h3', 'Say it like this', flat.length > 40 ? h('span', { class: 'tu-hint' }, 'First 40') : null),
    h('div', { class: 'tu-spell' }, flat.slice(0, 40).map(([c, word], i) => h('div', { class: 'tu-sp', style: { '--i': i } }, h('b', c), h('span', word)))))
  return { text: out, badges: text ? [{ label: 'letters and digits spelled', value: flat.length, tone: 'accent' }] : [], note: r.skipped.length ? `Skipped (no code word): ${r.skipped.slice(0, 12).join(' ')}` : '', extra: flat.length ? tiles : null }
}

function wrapRun(text, o, ctx) {
  const out = wrapText(text, o)
  ctx?.ruler(o.mode === 'unwrap' ? 0 : o.width)
  const lines = out ? out.split('\n') : []
  const longest = Math.max(0, ...lines.map((l) => [...l].length))
  return { text: out, badges: text ? [{ label: o.mode === 'unwrap' ? 'lines after joining' : 'lines', value: lines.length, tone: 'accent' }, { label: 'longest line', value: longest }] : [], note: o.mode !== 'unwrap' && longest > o.width ? 'Some words are longer than the width. Turn on "Break very long words" to split them.' : '' }
}

function sentenceRun(text, o) {
  const parts = splitSentences(text)
  let n = 0
  const lines = []
  for (const p of parts) {
    if (p === null) { if (lines.length && lines[lines.length - 1] !== '') lines.push(''); continue }
    n++
    lines.push((o.numbered ? `${n}. ` : '') + p)
    if (o.blank) lines.push('')
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const sentences = parts.filter(Boolean)
  const wc = sentences.map((s) => (s.match(/\S+/g) || []).length)
  const long = wc.filter((w) => w > 25).length
  const avg = sentences.length ? Math.round((wc.reduce((a, b) => a + b, 0) / sentences.length) * 10) / 10 : 0
  return { text: lines.join('\n'), badges: text ? [{ label: sentences.length === 1 ? 'sentence' : 'sentences', value: sentences.length, tone: 'accent' }, { label: 'words per sentence', value: avg }, ...(long ? [{ label: 'sentences over 25 words', value: long, tone: 'warn' }] : [])] : [] }
}

function controlsFor(kind, o) {
  const bool = (k, l, t) => o.bool(k, l, t)
  switch (kind) {
    case 'accents': return [group('Options', chips(bool('special', 'Also spell out special letters', 'ss for \u{df}, ae for \u{e6}, o for \u{f8}, l for \u{142}, d for \u{111}...')))]
    case 'flip': return [group('Options', chips(bool('reverse', 'Reverse the order too', 'Needed so the text reads correctly when you turn the screen upside down')))]
    case 'nato': {
      const radio = bool('radio', 'Radio digits (Tree, Fife, Niner)')
      const off = bool('official', 'Official spelling (Alfa, Juliett)')
      o.show(radio, () => o.v.alphabet === 'nato'); o.show(off, () => o.v.alphabet === 'nato')
      return [
        group('Alphabet', o.pills('alphabet', [['nato', 'NATO / ICAO'], ['simple', 'A for Apple'], ['apco', 'Police (Adam, Boy)']], 'Spelling alphabet')),
        group('Layout', o.pills('layout', [['row', 'Words in a row'], ['for', 'A for Alfa'], ['list', 'One per line']], 'Layout')),
        group('Options', chips(radio, off)),
      ]
    }
    case 'wrap': {
      const width = group('Width (characters)', o.num('width', { min: 10, max: 400, cls: 'narrow' }), h('div', { class: 'tu-quick' }, [40, 72, 80, 100, 120].map((n) => h('button', { type: 'button', onclick: () => o.set({ width: n }) }, String(n)))))
      const indent = group('Indent wrapped lines', o.num('indent', { min: 0, max: 20, cls: 'narrow' }))
      const bl = group('Options', chips(bool('breakLong', 'Break very long words')))
      ;[width, indent, bl].forEach((g) => o.show(g, () => o.v.mode !== 'unwrap'))
      return [group('Mode', o.pills('mode', [['reflow', 'Reflow paragraphs'], ['lines', 'Wrap each line'], ['unwrap', 'Join lines back']], 'Mode')), width, indent, bl]
    }
    case 'sentences': return [group('Options', chips(bool('numbered', 'Number them'), bool('blank', 'Blank line between')))]
    default: return []
  }
}

export function mount(rootEl, { tool, params }) {
  const kind = params.kind
  injectStyle()
  if (!document.getElementById('tu-tt-style')) document.head.append(h('style', { id: 'tu-tt-style' }, CSS))
  if (kind === 'fastread') return mountFastRead(rootEl, tool)
  const cfg = CONFIG[kind]
  if (!cfg) throw new Error(`Unknown text tool "${kind}"`)
  const o = createOptions(tool.id, cfg.defaults)
  let st
  const ctx = { ruler: (cols) => { if (!st) return; st.output.classList.toggle('ruler', cols > 0); st.output.style.setProperty('--cols', String(cols)) } }
  const run = (text) => {
    if (!text) { ctx.ruler(0); return { text: '', badges: [] } }
    if (kind === 'accents') return accentsRun(text, o.v)
    if (kind === 'flip') { const t = flipText(text, o.v.reverse); return { text: t, badges: [{ label: 'characters flipped', value: [...text].length, tone: 'accent' }] } }
    if (kind === 'nato') return spellRun(text, o.v)
    if (kind === 'wrap') return wrapRun(text, o.v, ctx)
    return sentenceRun(text, o.v)
  }
  st = studio({ id: tool.id, inputTitle: cfg.inTitle, outputTitle: cfg.outTitle, placeholder: cfg.placeholder, sample: cfg.sample, controls: controlsFor(kind, o), run, filename: cfg.file, mono: cfg.mono })
  o.onChange = () => st.refresh()
  if (kind === 'wrap') st.refresh()
  rootEl.append(st.el)
  st.input.focus({ preventScroll: true })
}

function mountFastRead(rootEl, tool) {
  const o = createOptions(tool.id, { strength: 'medium', skipShort: false, font: 'sans', size: 17 })
  const input = area({ placeholder: 'Paste an article, a report or an email you need to read fast...', 'aria-label': 'Text to format' })
  const view = h('div', { class: 'tu-bionic', tabindex: 0, 'aria-label': 'Formatted text' })
  const rib = ribbon()
  const inFoot = h('div', { class: 'tu-foot' }, h('span', 'Nothing yet'), h('span'))
  const outFoot = h('div', { class: 'tu-foot' }, h('span', 'Click a copy button to take it with you'), h('span'))
  let lines = []
  const richCopy = button('Copy formatted', { icon: 'copy', variant: 'secondary', size: 'sm', onClick: async () => {
    if (!lines.length) return toast('Nothing to copy yet')
    try {
      const html = `<div>${fastReadHtml(lines)}</div>`
      const plain = lines.map((l) => l.map((p) => p.t).join('')).join('\n')
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })])
      toast('Copied with the bold kept. Paste it into Docs, Word or an email.', 'success'); burst(richCopy, 8)
    } catch { copyText(fastReadMd(lines)) }
  } })
  const inPane = pane({ title: 'Your text', body: input, foot: inFoot, actions: inputActions({ ta: input, sample: 'Reading long text on a screen is tiring. When the first part of each word stands out, your eyes can glide from word to word and your brain fills in the rest. Try it on this paragraph, then paste your own report, article or email.', onChange: () => refresh() }) })
  const outPane = pane({ title: 'Fast-read version', out: true, body: view, foot: outFoot, actions: [richCopy, copyBtn(() => fastReadMd(lines), 'Markdown'), copyBtn(() => fastReadHtml(lines), 'HTML')] })
  acceptFiles(inPane, (t) => { input.value = t; refresh() })
  const size = rangeField('Reading size', { min: 14, max: 30, step: 1, value: o.v.size, format: (v) => `${v}px`, onInput: (v) => { o.v.size = v; o.commit() } })
  const controls = dock(
    group('Bold how much', o.pills('strength', [['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']], 'How much of each word is bold')),
    group('Options', chips(o.bool('skipShort', 'Leave short words alone'))),
    group('Font', o.pills('font', [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']], 'Preview font')),
    group('', size))
  function refresh() {
    const text = input.value
    if (tooBig(text)) { lines = []; view.replaceChildren(h('span', { class: 'tu-hint' }, tooBig(text))); rib.set([{ label: 'too much text', value: '!', tone: 'bad' }]); return }
    lines = text ? fastRead(text, o.v) : []
    view.className = `tu-bionic ${o.v.font}`
    view.style.fontSize = `${o.v.size}px`
    view.style.lineHeight = '1.75'
    view.replaceChildren(...lines.flatMap((l, i) => [...l.map((p) => (p.b ? h('b', p.t) : document.createTextNode(p.t))), ...(i < lines.length - 1 ? [document.createTextNode('\n')] : [])]))
    if (!text) view.append(h('span', { class: 'tu-hint' }, 'Your fast-read text shows up here.'))
    const words = (text.match(/\S+/g) || []).length
    inFoot.firstChild.textContent = text ? plural(words, 'word') : 'Nothing yet'
    rib.set(text ? [{ label: 'words formatted', value: words, tone: 'accent' }] : [], '')
    flash(outPane)
  }
  o.onChange = refresh
  input.addEventListener('input', refresh)
  rootEl.append(root(controls, rib.el, h('div', { class: 'tu-panes' }, inPane, outPane)))
  refresh()
  input.focus({ preventScroll: true })
}
