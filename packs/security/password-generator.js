// Password generator: crypto.getRandomValues with rejection sampling. Random or pronounceable, bulk, entropy shown.
import { h, icon, field, input, toggle, segmented, panel, number, debounce } from '../../lib/ui.js'
import { useStyles, results, chip, randBelow, pick, shuffle, log2, metaLine, load, save } from './_shared.js'

export const LOWER = 'abcdefghijklmnopqrstuvwxyz'
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const DIGITS = '0123456789'
export const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{}:;,.?/~'
export const AMBIGUOUS = 'Il1O0o|'
const CONS = [...'bcdfghjklmnprstvwz']
const VOWS = [...'aeiou']

const uniq = (s) => [...new Set([...s])]

/** Random password. Returns { text, bits, poolSize }. Throws a readable Error when no character is available. */
export function generatePassword({ length, sets, exclude = '', requireEach = true }) {
  const ex = new Set([...exclude])
  const pools = sets.map((s) => uniq(s).filter((c) => !ex.has(c))).filter((p) => p.length)
  if (!pools.length) throw new Error('Pick at least one character set (and do not exclude all of it).')
  const all = uniq(pools.flat().join(''))
  const out = []
  if (requireEach) for (const p of pools.slice(0, length)) out.push(pick(p))
  while (out.length < length) out.push(pick(all))
  shuffle(out)
  return { text: out.join(''), bits: length * log2(all.length), poolSize: all.length }
}

/** Pronounceable password: consonant/vowel syllables, optional capitals, digits and one symbol. Entropy is counted exactly per choice. */
export function generatePronounceable({ length, upper = true, digits = true, symbols = false, symbolSet = DEFAULT_SYMBOLS, exclude = '' }) {
  const ex = new Set([...exclude])
  const cons = CONS.filter((c) => !ex.has(c))
  const vows = VOWS.filter((c) => !ex.has(c))
  const syms = uniq(symbolSet).filter((c) => !ex.has(c))
  if (!cons.length || !vows.length) throw new Error('Too many excluded letters to build pronounceable words.')
  const nDigits = digits ? Math.max(1, Math.min(4, Math.round(length * 0.18))) : 0
  const nSym = symbols && syms.length ? 1 : 0
  const nLetters = Math.max(2, length - nDigits - nSym)
  let bits = 0
  const out = []
  for (let i = 0; i < nLetters; i++) {
    const isCons = i % 2 === 0
    let ch = pick(isCons ? cons : vows)
    bits += log2(isCons ? cons.length : vows.length)
    if (upper && isCons) {
      bits += 1
      if (randBelow(2) === 1 && !ex.has(ch.toUpperCase())) ch = ch.toUpperCase()
    }
    out.push(ch)
  }
  if (nSym) {
    out.splice(1 + randBelow(nLetters - 1), 0, pick(syms))
    bits += log2(syms.length) + log2(nLetters - 1)
  }
  for (let i = 0; i < nDigits; i++) { out.push(String(randBelow(10))); bits += log2(10) }
  return { text: out.join(''), bits, poolSize: 0 }
}

const PRESETS = [
  { label: 'Strong (20)', set: { mode: 'random', length: 20, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false, requireEach: true } },
  { label: 'Maximum (64)', set: { mode: 'random', length: 64, lower: true, upper: true, digits: true, symbols: true, noAmbiguous: false, requireEach: true } },
  { label: 'Memorable', set: { mode: 'pronounceable', length: 16, lower: true, upper: true, digits: true, symbols: false } },
  { label: 'Wi-Fi (16, easy to read)', set: { mode: 'random', length: 16, lower: true, upper: true, digits: true, symbols: false, noAmbiguous: true, requireEach: true } },
  { label: 'PIN (6 digits)', set: { mode: 'random', length: 6, lower: false, upper: false, digits: true, symbols: false, noAmbiguous: false, requireEach: true } },
]

export function mount(root) {
  useStyles()
  const s = { length: 20, lower: true, upper: true, digits: true, symbols: true, symbolSet: DEFAULT_SYMBOLS, avoid: '', noAmbiguous: false, requireEach: true, mode: 'random', count: 1, ...load('password-generator:opts', {}) }
  s.length = Math.min(128, Math.max(4, Math.round(+s.length) || 20))
  s.count = Math.min(100, Math.max(1, Math.round(+s.count) || 1))

  const out = results({ label: 'Your password', ic: 'key-round', filename: 'passwords.txt', onRegenerate: () => run(true), emptyText: 'Pick at least one character set below.' })
  const note = h('div')

  const range = h('input', { type: 'range', min: 4, max: 128, step: 1, value: s.length, 'aria-label': 'Length', oninput: (e) => setLength(+e.target.value) })
  const lenInput = number(s.length, { min: 4, max: 128, step: 1, ariaLabel: 'Length in characters', onInput: (n) => Number.isFinite(n) && setLength(Math.round(n), true) })
  function setLength(n, fromInput) {
    s.length = Math.min(128, Math.max(4, n))
    if (fromInput) range.value = s.length
    else lenInput.value = s.length
    run(false)
  }

  const chips = {
    lower: chip('Lowercase', s.lower, (v) => { s.lower = v; run() }, { sample: 'abc' }),
    upper: chip('Uppercase', s.upper, (v) => { s.upper = v; run() }, { sample: 'ABC' }),
    digits: chip('Numbers', s.digits, (v) => { s.digits = v; run() }, { sample: '123' }),
    symbols: chip('Symbols', s.symbols, (v) => { s.symbols = v; syncUi(); run() }, { sample: '!@#' }),
  }
  const symInput = input({ mono: true, value: s.symbolSet, 'aria-label': 'Symbols to use', oninput: (e) => { s.symbolSet = e.target.value; run() } })
  const avoidInput = input({ mono: true, value: s.avoid, placeholder: 'e.g. {}[]', 'aria-label': 'Characters to avoid', oninput: (e) => { s.avoid = e.target.value; run() } })
  const ambiguous = toggle('Skip look-alikes (I, l, 1, O, 0, o, |)', s.noAmbiguous, (v) => { s.noAmbiguous = v; run() })
  const requireEach = toggle('Include at least one of every selected type', s.requireEach, (v) => { s.requireEach = v; run() })
  const mode = segmented([['random', 'Random'], ['pronounceable', 'Pronounceable']], s.mode, (v) => { s.mode = v; syncUi(); run(true) }, 'Password style')
  const countInput = number(s.count, { min: 1, max: 100, step: 1, ariaLabel: 'How many', onInput: (n) => { if (Number.isFinite(n)) { s.count = Math.min(100, Math.max(1, Math.round(n))); run(false) } } })
  const symField = field('Symbols to use', symInput)
  const hintPron = h('div', { class: 'sx-hint' }, 'Pronounceable passwords are easier to type and say out loud. They need a bit more length for the same strength.')

  function syncUi() {
    const pron = s.mode === 'pronounceable'
    symField.hidden = !s.symbols
    requireEach.hidden = pron
    chips.lower.input.disabled = pron
    if (pron) chips.lower.input.checked = true
    else chips.lower.input.checked = s.lower
    ambiguous.hidden = false
    hintPron.hidden = !pron
    mode.set(s.mode)
    chips.upper.input.checked = s.upper; chips.digits.input.checked = s.digits; chips.symbols.input.checked = s.symbols
    range.value = s.length
    lenInput.value = s.length
    countInput.value = s.count
    ambiguous.input.checked = s.noAmbiguous
    requireEach.input.checked = s.requireEach
  }

  const persist = debounce(() => save('password-generator:opts', s), 300)
  function run(animate = false) {
    persist()
    const exclude = (s.noAmbiguous ? AMBIGUOUS : '') + s.avoid
    const sets = [s.lower && LOWER, s.upper && UPPER, s.digits && DIGITS, s.symbols && s.symbolSet].filter(Boolean)
    note.replaceChildren()
    try {
      if (s.mode === 'random' && !sets.length) return out.show([])
      const make = () => (s.mode === 'pronounceable'
        ? generatePronounceable({ length: s.length, upper: s.upper, digits: s.digits, symbols: s.symbols, symbolSet: s.symbolSet, exclude })
        : generatePassword({ length: s.length, sets, exclude, requireEach: s.requireEach }))
      const list = Array.from({ length: s.count }, make)
      const bits = Math.min(...list.map((r) => r.bits))
      out.show(list.map((r) => r.text), { bits, text: `about ${Math.round(bits)} bits each`, nodes: metaLine(bits, s.mode === 'pronounceable' ? 'Easy to say' : `${list[0].poolSize} possible characters`) }, { animate })
    } catch (e) {
      out.show([])
      note.replaceChildren(h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', e.message)))
    }
  }

  const presetRow = h('div', { class: 'sx-presets', role: 'group', 'aria-label': 'Presets' }, PRESETS.map((p) => h('button', {
    type: 'button', class: 'sx-preset', onclick: () => { Object.assign(s, p.set); syncUi(); run(true) },
  }, p.label)))

  root.append(h('div', { class: 'sx stack' },
    out,
    note,
    h('div', { class: 'sx-k' }, icon('sparkles'), 'Quick presets'),
    presetRow,
    panel(h('div', { class: 'sx-cols' },
      h('div', { class: 'stack' },
        field('Length', h('div', { class: 'sx-lens' }, range, lenInput)),
        h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Characters'), h('div', { class: 'sx-chips' }, Object.values(chips))),
        symField,
        field('Characters to avoid', avoidInput, 'These are never used, in any set.')),
      h('div', { class: 'stack' },
        h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Style'), mode, hintPron),
        h('div', { class: 'stack tight' }, ambiguous, requireEach),
        field('How many', countInput, 'Up to 100 at once.'))))))
  syncUi()
  run(true)
}
