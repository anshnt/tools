// Word counter (also serves character-counter and line-counter via params.focus). Reference text tool.
import { h, textarea, stats, clear, copyButton, button, row, debounce } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'

/** Counts like Word/Docs: whitespace-separated tokens that contain a letter or digit ("1,000", "me@x.com" and URLs count once). */
export function count(text) {
  const words = (text.match(/\S+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w))
  const lines = text ? text.split(/\r\n|\r|\n/) : []
  const sentences = text.split(/[.!?।]+(?:\s|$)/u).filter((s) => /[\p{L}\p{N}]/u.test(s)).length
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

export function mount(root, { params }) {
  const focus = params.focus || 'words'
  const input = textarea({ rows: 12, placeholder: 'Type or paste your text here...', value: load('word-counter:text', ''), 'aria-label': 'Text to count' })
  const out = h('div')
  const render = () => {
    const c = count(input.value)
    if (input.value.length < MAX_SAVE) save('word-counter:text', input.value)
    const primary = {
      words: [{ label: 'Words', value: c.words.toLocaleString(), accent: true }, { label: 'Characters', value: c.chars.toLocaleString() }],
      chars: [{ label: 'Characters', value: c.chars.toLocaleString(), accent: true }, { label: 'Without spaces', value: c.charsNoSpaces.toLocaleString() }],
      lines: [{ label: 'Lines', value: c.lines.toLocaleString(), accent: true }, { label: 'Non-empty lines', value: c.nonEmptyLines.toLocaleString() }, { label: 'Unique lines', value: c.uniqueLines.toLocaleString() }],
    }[focus]
    const limits = focus === 'chars' ? [
      limit('X / Twitter (280)', 280, c.chars),
      { label: 'SMS (160)', value: `${Math.max(1, Math.ceil(c.chars / 160))}`, hint: 'message parts' },
      limit('Meta description (160)', 160, c.chars),
    ] : []
    clear(out, stats([
      ...primary,
      ...(focus !== 'words' ? [{ label: 'Words', value: c.words.toLocaleString() }] : []),
      ...(focus !== 'chars' ? [{ label: 'No spaces', value: c.charsNoSpaces.toLocaleString() }] : []),
      { label: 'Sentences', value: c.sentences.toLocaleString() },
      { label: 'Paragraphs', value: c.paragraphs.toLocaleString() },
      ...(focus !== 'lines' ? [{ label: 'Lines', value: c.lines.toLocaleString() }] : []),
      { label: 'Unique words', value: c.uniqueWords.toLocaleString() },
      { label: 'Reading time', value: mins(c.readingMin) },
      { label: 'Speaking time', value: mins(c.speakingMin) },
      ...limits,
    ]))
  }
  const slow = debounce(render, 150)
  input.addEventListener('input', () => (input.value.length > 50_000 ? slow() : render()))
  render()
  root.append(h('div', { class: 'stack' },
    input,
    row(copyButton(() => input.value, 'Copy text'), button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { input.value = ''; render(); input.focus() } })),
    out))
  input.focus({ preventScroll: true })
}
