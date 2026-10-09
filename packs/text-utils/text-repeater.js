// Text repeater: repeat a word, line or paragraph N times with any separator, optionally numbered.
// repeat(text, options) is pure and exported for tests.
import { h } from '../../lib/ui.js'
import { studio, createOptions, group, chips } from './_shared.js'

export const MAX_CHARS = 5_000_000
const SEPS = { none: '', space: ' ', newline: '\n', blank: '\n\n', comma: ',', commaSpace: ', ', pipe: ' | ' }

/** repeat(text, {count, sep, custom, numbered, trailing}) -> {text, error?, chars} */
export function repeat(text, o) {
  const count = Math.max(1, Math.floor(o.count) || 1)
  const sep = o.sep === 'custom' ? o.custom : SEPS[o.sep] ?? ''
  const unit = o.numbered ? (i) => `${i + 1}. ${text}` : () => text
  const perCopy = [...unit(count - 1)].length + [...sep].length
  const chars = perCopy * count
  if (chars > MAX_CHARS) return { text: '', chars, error: `That would be about ${chars.toLocaleString()} characters. The limit is ${MAX_CHARS.toLocaleString()}. Lower the number of copies or use shorter text.` }
  const parts = new Array(count)
  for (let i = 0; i < count; i++) parts[i] = unit(i)
  let out = parts.join(sep)
  if (o.trailing && sep) out += sep
  return { text: out, chars: [...out].length }
}

const SHOW = 200_000

export function mount(rootEl, { tool }) {
  const o = createOptions(tool.id, { count: 5, sep: 'newline', custom: ' - ', numbered: false, trailing: false })
  let st
  const run = (text) => {
    if (!text) return { text: '', badges: [] }
    const r = repeat(text, o.v)
    if (r.error) return { error: r.error }
    const bytes = new TextEncoder().encode(r.text).length
    const words = (r.text.match(/\S+/g) || []).length
    return {
      text: r.text,
      display: r.text.length > SHOW ? r.text.slice(0, SHOW) : undefined,
      badges: [{ label: o.v.count === 1 ? 'copy' : 'copies', value: Math.floor(o.v.count), tone: 'accent' }, { label: 'characters', value: r.chars }, { label: 'words', value: words }, { label: 'size', value: bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB` }],
      note: r.text.length > SHOW ? `The box shows the first ${SHOW.toLocaleString()} characters to stay fast. Copy and Download use all of it.` : '',
    }
  }
  const customIn = o.text('custom', { placeholder: ' - ', cls: 'narrow' })
  const customG = group('Your separator', customIn)
  o.show(customG, () => o.v.sep === 'custom')
  st = studio({
    id: tool.id, inputTitle: 'Text to repeat', outputTitle: 'Repeated text', placeholder: 'Type a word, a line or a whole paragraph...', sample: 'Hello!', mono: false,
    controls: [
      group('Repeat', o.num('count', { min: 1, max: 1000000, cls: 'mid', ariaLabel: 'Number of copies' }), h('div', { class: 'tu-quick' }, [2, 5, 10, 50, 100, 1000].map((n) => h('button', { type: 'button', onclick: () => o.set({ count: n }) }, String(n))))),
      group('Separator', o.select('sep', [['newline', 'New line'], ['space', 'Space'], ['comma', 'Comma'], ['commaSpace', 'Comma + space'], ['pipe', 'Pipe |'], ['blank', 'Blank line'], ['none', 'Nothing'], ['custom', 'Custom...']], 'Separator')),
      customG,
      group('Options', chips(o.bool('numbered', 'Number each copy'), o.bool('trailing', 'Add a separator at the end'))),
    ],
    run, filename: 'repeated-text.txt', emptyText: 'Type something to repeat it',
  })
  o.onChange = () => st.refresh()
  rootEl.append(st.el)
  st.input.focus({ preventScroll: true })
}
