// Clipboard text cleaner: smart quotes, line breaks, spaces, emojis, invisible characters, HTML, Markdown and PDF line wraps.
// clean(text, options) is pure and exported for tests; every step reports how many changes it made.
import { studio, createOptions, group, chips, chipButton, stripInvisible } from './_shared.js'

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '\u{a9}', reg: '\u{ae}', trade: '\u{2122}', hellip: '\u{2026}', mdash: '\u{2014}', ndash: '\u{2013}', lsquo: '\u{2018}', rsquo: '\u{2019}', ldquo: '\u{201c}', rdquo: '\u{201d}', bull: '\u{2022}', middot: '\u{b7}', euro: '\u{20ac}', pound: '\u{a3}', yen: '\u{a5}', cent: '\u{a2}', laquo: '\u{ab}', raquo: '\u{bb}', times: '\u{d7}', divide: '\u{f7}', deg: '\u{b0}', plusmn: '\u{b1}', rarr: '\u{2192}', larr: '\u{2190}' }
const EMOJI = /\p{Regional_Indicator}{2}|[#*0-9]\u{fe0f}?\u{20e3}|(?![\u{a9}\u{ae}\u{2122}\u{203c}\u{2049}\u{2139}\u{2190}-\u{21ff}])\p{Extended_Pictographic}(?:\u{fe0f}|\p{Emoji_Modifier})?(?:\u{200d}\p{Extended_Pictographic}(?:\u{fe0f}|\p{Emoji_Modifier})?)*|[\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/gu
const ODD_SPACE = /[\u{a0}\u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}]/gu
const LINE_BREAKS = /\r\n|\r|\u{2028}|\u{2029}|\u{85}|\u{b}|\u{c}/gu

function decodeEntities(t) {
  let n = 0
  const out = t.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    let r = null
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) r = String.fromCodePoint(cp)
    } else r = ENTITIES[e.toLowerCase()] ?? null
    if (r === null) return m
    n++
    return r
  })
  return [out, n]
}

function stripHtml(t) {
  let n = 0
  const sub = (re, to) => { n += (t.match(re) || []).length; t = t.replace(re, to) }
  sub(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  sub(/<!--[\s\S]*?-->/g, '')
  sub(/<\s*br\s*\/?\s*>|<\s*\/\s*(?:p|div|li|tr|h[1-6]|blockquote|section|article|ul|ol|table|pre)\s*>/gi, '\n')
  sub(/<\/?[a-zA-Z][^>]*>/g, '')
  const [dec, k] = decodeEntities(t)
  return [dec, n + k]
}

function stripMarkdown(t) {
  let n = 0
  const sub = (re, to) => { n += (t.match(re) || []).length; t = t.replace(re, to) }
  sub(/^ {0,3}(?:`{3,}|~{3,})[^\n]*\n?/gm, '')
  sub(/^ {0,3}#{1,6}[ \t]+/gm, '')
  sub(/^ {0,3}>[ \t]?/gm, '')
  sub(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
  sub(/\[([^\]\n]+)\]\([^)\n]*\)/g, '$1')
  sub(/\*\*(?=\S)(.+?)(?<=\S)\*\*|__(?=\S)(.+?)(?<=\S)__/g, (m, a, b) => a ?? b)
  sub(/(?<![\w*])\*(?=[^\s*])([^\n]+?)(?<=[^\s*])\*(?![\w*])/g, '$1')
  sub(/(?<![\w])_(?=[^\s_])([^\n]+?)(?<=[^\s_])_(?![\w])/g, '$1')
  sub(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
  sub(/`([^`\n]+)`/g, '$1')
  sub(/^ {0,3}([-*_])(?: ?\1){2,}[ \t]*$/gm, '')
  return [t, n]
}

const DEFAULTS = {
  html: false, markdown: false, breaks: true, invisible: true, odd: true, quotes: true, dashes: false, ellipsis: false, emoji: false,
  hyphen: false, unwrap: false, collapse: true, trim: true, blanks: 'one', ends: true,
}
export { DEFAULTS as CLEAN_DEFAULTS }

/** clean(text, options) -> {text, counts: {optionKey: n}} */
export function clean(text, o = DEFAULTS) {
  const counts = {}
  const step = (key, re, to) => { counts[key] = (text.match(re) || []).length; text = text.replace(re, to) }
  if (o.html) { const [t, n] = stripHtml(text); text = t; counts.html = n }
  if (o.markdown) { const [t, n] = stripMarkdown(text); text = t; counts.markdown = n }
  if (o.breaks) step('breaks', LINE_BREAKS, '\n')
  else text = text.replace(/\r\n|\r/g, '\n') // textareas always give \n anyway
  if (o.invisible) { const [t, n] = stripInvisible(text); text = t; counts.invisible = n }
  if (o.odd) step('odd', ODD_SPACE, ' ')
  if (o.quotes) step('quotes', /[\u{2018}\u{2019}\u{201a}\u{201b}\u{2032}\u{2035}]|[\u{201c}\u{201d}\u{201e}\u{201f}\u{2033}\u{2036}]/gu, (m) => ('\u{2018}\u{2019}\u{201a}\u{201b}\u{2032}\u{2035}'.includes(m) ? "'" : '"'))
  if (o.dashes) step('dashes', /[\u{2010}-\u{2015}\u{2212}]/gu, '-')
  if (o.ellipsis) step('ellipsis', /\u{2026}/gu, '...')
  if (o.emoji) step('emoji', EMOJI, '')
  if (o.hyphen) step('hyphen', /(\p{L})-[ \t]*\n[ \t]*(\p{Ll})/gu, '$1$2')
  if (o.trim) step('trim', /^[ \t]+|[ \t]+$/gm, '')
  if (o.unwrap) {
    step('unwrap', /(?<=\S)[ \t]*\n[ \t]*(?=[^\s\-*\u{2022}+\d>#])/gu, ' ')
  }
  if (o.collapse) step('collapse', /(?<=\S)[ \t]{2,}(?=\S)/g, ' ')
  if (o.blanks === 'one') step('blanks', /\n[ \t]*(?:\n[ \t]*){2,}/g, '\n\n')
  else if (o.blanks === 'none') step('blanks', /\n[ \t]*(?:\n[ \t]*)+/g, '\n')
  if (o.ends) { const t = text.trim(); counts.ends = t === text ? 0 : 1; text = t }
  return { text, counts }
}

const LABELS = { html: 'HTML tags and entities', markdown: 'Markdown marks', breaks: 'odd line breaks', invisible: 'invisible characters', odd: 'odd spaces', quotes: 'smart quotes', dashes: 'fancy dashes', ellipsis: 'ellipses', emoji: 'emojis', hyphen: 'hyphenated breaks', trim: 'line edges', unwrap: 'lines joined', collapse: 'repeated spaces', blanks: 'blank lines', ends: 'text edges' }

const PRESETS = {
  safe: ['Everyday cleanup', { html: false, markdown: false, breaks: true, invisible: true, odd: true, quotes: true, dashes: false, ellipsis: false, emoji: false, hyphen: false, unwrap: false, collapse: true, trim: true, blanks: 'one', ends: true }],
  pdf: ['From a PDF', { html: false, markdown: false, breaks: true, invisible: true, odd: true, quotes: false, dashes: false, ellipsis: false, emoji: false, hyphen: true, unwrap: true, collapse: true, trim: true, blanks: 'one', ends: true }],
  web: ['From a web page or Word', { html: true, markdown: false, breaks: true, invisible: true, odd: true, quotes: true, dashes: true, ellipsis: true, emoji: false, hyphen: false, unwrap: false, collapse: true, trim: true, blanks: 'one', ends: true }],
  chat: ['From an AI chat', { html: false, markdown: true, breaks: true, invisible: true, odd: true, quotes: true, dashes: true, ellipsis: false, emoji: true, hyphen: false, unwrap: false, collapse: true, trim: true, blanks: 'one', ends: true }],
  plain: ['Plain text only', { html: true, markdown: true, breaks: true, invisible: true, odd: true, quotes: true, dashes: true, ellipsis: true, emoji: true, hyphen: true, unwrap: false, collapse: true, trim: true, blanks: 'one', ends: true }],
}

const SAMPLE = '\u{201c}Smart quotes\u{201d} and \u{2018}single\u{2019} ones \u{2014} plus an ellipsis\u{2026} and an en\u{2013}dash.\nNon-breaking\u{a0}\u{a0}spaces here,    and\u{200b} zero-width\u{200d} characters.   \nEmoji time \u{1f389}\u{1f680} done \u{1f44d}\u{1f3fd}!\n\nThis is a hard-\nwrapped paragraph from a PDF that\nkeeps going on short lines.\n\n\n\n<p>Some <b>HTML</b> &amp; entities &quot;too&quot;</p>\n**Bold** text, a [link](https://example.com) and `code` pasted from a chat.'

export function mount(rootEl, { tool }) {
  const o = createOptions(tool.id, { ...DEFAULTS })
  const refs = {}
  const tog = (k, label, title) => { const c = o.bool(k, label, title); refs[k] = c; return c }
  const blanks = o.pills('blanks', [['keep', 'Keep all'], ['one', 'Max one in a row'], ['none', 'Remove all']], 'Blank lines')
  refs.blanks = { badge: () => {} }
  const presetBtns = Object.entries(PRESETS).map(([id, [label, patch]]) => chipButton(label, () => o.set(patch), id === 'safe' ? 'sparkles' : null))
  let st
  const run = (text) => {
    const { text: out, counts } = clean(text, o.v)
    let total = 0
    const parts = []
    for (const k of Object.keys(LABELS)) {
      const n = counts[k] || 0
      refs[k]?.badge?.(text ? n : 0)
      if (n) { total += n; parts.push({ label: LABELS[k], value: n }) }
    }
    return {
      text: out,
      badges: text ? [{ label: 'fixes', value: total, tone: total ? 'good' : '' }, ...parts.slice(0, 8)] : [],
      note: text && !total ? 'Nothing to fix with these settings.' : '',
    }
  }
  st = studio({
    id: tool.id, inputTitle: 'Messy text', outputTitle: 'Clean text', placeholder: 'Paste messy text from a PDF, web page, Word or a chat...', sample: SAMPLE,
    controls: [
      group('Quick presets', chips(...presetBtns)),
      group('Characters', chips(tog('quotes', 'Smart quotes to straight'), tog('dashes', 'Dashes to a hyphen'), tog('ellipsis', 'Ellipsis to three dots'), tog('emoji', 'Remove emojis'), tog('invisible', 'Remove zero-width characters', 'Zero-width spaces, soft hyphens, byte order marks'), tog('odd', 'Odd spaces to normal'))),
      group('Layout', chips(tog('breaks', 'Normalize line breaks'), tog('collapse', 'Collapse repeated spaces'), tog('trim', 'Trim each line'), tog('hyphen', 'Fix hyphenated line breaks', 'inter-\nnational becomes international'), tog('unwrap', 'Join broken lines', 'Turns hard-wrapped lines into flowing paragraphs'), tog('ends', 'Trim the whole text'))),
      group('Markup', chips(tog('html', 'Strip HTML'), tog('markdown', 'Strip Markdown'))),
      group('Blank lines', blanks),
    ],
    run, filename: 'clean-text.txt',
  })
  o.onChange = () => st.refresh()
  rootEl.append(st.el)
  st.input.focus({ preventScroll: true })
}
