// Word counter (also serves character-counter and line-counter via params.focus). Reference text tool.
import { h, debounce } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { root, pane, area, inputActions, acceptFiles, copyBtn, countTo, injectStyle } from './_shared.js'

/** Counts like Word/Docs: whitespace-separated tokens that contain a letter or digit ("1,000", "me@x.com" and URLs count once). */
export function count(text) {
  const words = (text.match(/\S+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w))
  const lines = text ? text.split(/\r\n|\r|\n/) : []
  const sentences = text.split(/[.!?\u{964}]+(?:\s|$)/u).filter((s) => /[\p{L}\p{N}]/u.test(s)).length
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length
  return {
    words: words.length,
    chars: [...text].length,
    charsNoSpaces: [...text.replace(/\s/g, '')].length,
    sentences,
    paragraphs,
    lines: lines.length,
    nonEmptyLines: lines.filter((l) => l.trim()).length,
    uniqueLines: new Set(lines.map((l) => l.trim()).filter(Boolean)).size,
    uniqueWords: new Set(words.map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))).size,
    readingMin: words.length / 238,
    speakingMin: words.length / 140,
  }
}

const mins = (m) => (m < 1 ? `${Math.max(m ? 1 : 0, Math.round(m * 60))} sec` : `${Math.round(m)} min`)
const limit = (label, max, used, unit = 'characters') => (used <= max
  ? { label, value: (max - used).toLocaleString(), hint: `${unit} left` }
  : { label, value: `${(used - max).toLocaleString()} over`, hint: `over the ${max} limit`, danger: true })
const MAX_SAVE = 200_000

const num = (label, key, accent) => ({ label, accent, get: (c) => c[key] })
const TILES = {
  words: [num('Words', 'words', true), num('Characters', 'chars'), num('No spaces', 'charsNoSpaces'), num('Sentences', 'sentences'), num('Paragraphs', 'paragraphs'), num('Lines', 'lines'), num('Unique words', 'uniqueWords'),
    { label: 'Reading time', get: (c) => mins(c.readingMin) }, { label: 'Speaking time', get: (c) => mins(c.speakingMin) }],
  chars: [num('Characters', 'chars', true), num('Without spaces', 'charsNoSpaces'), num('Words', 'words'), num('Sentences', 'sentences'), num('Paragraphs', 'paragraphs'), num('Lines', 'lines'), num('Unique words', 'uniqueWords'),
    { label: 'Reading time', get: (c) => mins(c.readingMin) }, { label: 'Speaking time', get: (c) => mins(c.speakingMin) },
    { label: 'X / Twitter (280)', limit: (c) => limit('X / Twitter (280)', 280, c.chars) },
    { label: 'SMS (160)', get: (c) => `${Math.max(1, Math.ceil(c.chars / 160))}`, hint: 'message parts' },
    { label: 'Meta description (160)', limit: (c) => limit('Meta description (160)', 160, c.chars) }],
  lines: [num('Lines', 'lines', true), num('Non-empty lines', 'nonEmptyLines'), num('Unique lines', 'uniqueLines'), num('Words', 'words'), num('No spaces', 'charsNoSpaces'), num('Sentences', 'sentences'), num('Paragraphs', 'paragraphs'), num('Unique words', 'uniqueWords'),
    { label: 'Reading time', get: (c) => mins(c.readingMin) }, { label: 'Speaking time', get: (c) => mins(c.speakingMin) }],
}

export function mount(rootEl, { params }) {
  injectStyle()
  const focus = TILES[params.focus] ? params.focus : 'words'
  const input = area({ placeholder: 'Type or paste your text here...', value: load('word-counter:text', ''), 'aria-label': 'Text to count' })
  const foot = h('div', { class: 'tu-foot' }, h('span', 'Your text stays on this device'), h('span'))
  const grid = h('div', { class: 'stats', 'aria-live': 'polite' })
  const tiles = TILES[focus].map((t) => {
    const value = h('div', { class: 'value' })
    const hint = h('div', { class: 'hint' })
    const el = h('div', { class: ['stat', t.accent && 'accent'] }, h('div', { class: 'label' }, t.label), value, hint)
    grid.append(el)
    return { t, el, value, hint }
  })
  const render = () => {
    const text = input.value
    const c = count(text)
    if (text.length < MAX_SAVE) save('word-counter:text', text)
    for (const { t, el, value, hint } of tiles) {
      if (t.limit) {
        const r = t.limit(c)
        value.textContent = r.value; hint.textContent = r.hint || ''
        el.classList.toggle('danger', !!r.danger)
      } else {
        const v = t.get(c)
        if (typeof v === 'number') countTo(value, v)
        else value.textContent = v
        hint.textContent = t.hint || ''
      }
    }
  }
  const slow = debounce(render, 150)
  input.addEventListener('input', () => (input.value.length > 50_000 ? slow() : render()))
  const inPane = pane({
    title: 'Your text', body: input, foot,
    actions: [...inputActions({ ta: input, sample: 'Counting words is easy: paste a paragraph, an essay or a tweet, and every number below updates as you type. Try editing this sentence!', onChange: render, onClear: () => {} })],
  })
  acceptFiles(inPane, (t) => { input.value = t; render() })
  inPane.querySelector('.tu-acts').append(copyBtn(() => input.value, 'Copy text'))
  rootEl.append(root(inPane, grid))
  render()
  input.focus({ preventScroll: true })
}
