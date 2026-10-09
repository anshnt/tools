// Passphrase generator: EFF large wordlist (7,776 words) from a pinned npm package, picked with crypto.getRandomValues.
import { h, icon, field, input, select, panel, number, segmented, alert, button, debounce } from '../../lib/ui.js'
import { useStyles, results, randBelow, log2, metaLine, load, save } from './_shared.js'

const WORDLIST_URL = 'https://cdn.jsdelivr.net/npm/eff-diceware-passphrase@3.0.0/wordlist.json'
let wordsPromise
function loadWords(signal) {
  wordsPromise ??= fetch(WORDLIST_URL, { signal }).then(async (r) => {
    if (!r.ok) throw new Error(`Could not load the word list (HTTP ${r.status}).`)
    const list = await r.json()
    if (!Array.isArray(list) || list.length !== 7776) throw new Error('The word list looks wrong. Reload the page and try again.')
    return list
  }).catch((e) => { wordsPromise = null; throw e })
  return wordsPromise
}

export const SEPARATORS = [['-', 'Hyphen  -'], [' ', 'Space'], ['.', 'Period  .'], [',', 'Comma  ,'], ['_', 'Underscore  _'], ['', 'None'], ['random', 'Random symbol']]
const SYMBOLS = [...'-.,_+=!@#$%&*?:;']
/** Dice roll (1-6 per die) for a word index: the EFF list is ordered like five dice read as a base-6 number. */
export const diceCode = (idx) => idx.toString(6).padStart(5, '0').replace(/./g, (c) => +c + 1)

/** Build passphrases from a word array. Returns { text, parts, bits }; parts is [{type: 'word'|'sep'|'num', text, idx?}]. */
export function generatePassphrase(list, { count = 6, separator = '-', capital = 'first', digits = 0 } = {}) {
  const idx = Array.from({ length: count }, () => randBelow(list.length))
  let bits = count * log2(list.length)
  const parts = []
  idx.forEach((wi, i) => {
    let w = list[wi]
    if (capital === 'first') w = w[0].toUpperCase() + w.slice(1)
    else if (capital === 'upper') w = w.toUpperCase()
    else if (capital === 'random') { bits += 1; if (randBelow(2)) w = w[0].toUpperCase() + w.slice(1) }
    parts.push({ type: 'word', text: w, idx: wi })
    if (i < count - 1) {
      if (separator === 'random') { parts.push({ type: 'sep', text: SYMBOLS[randBelow(SYMBOLS.length)] }); bits += log2(SYMBOLS.length) }
      else if (separator) parts.push({ type: 'sep', text: separator })
    }
  })
  if (digits) {
    let n = ''
    for (let i = 0; i < digits; i++) n += randBelow(10)
    if (separator && separator !== 'random') parts.push({ type: 'sep', text: separator })
    parts.push({ type: 'num', text: n })
    bits += digits * log2(10)
  }
  return { text: parts.map((p) => p.text).join(''), parts, bits }
}

const CSS = `
.sx-words{display:flex;flex-wrap:wrap;align-items:center;gap:10px 6px;perspective:700px;min-height:64px}
.sx-word{display:inline-flex;flex-direction:column;align-items:flex-start;padding:9px 16px 8px;border-radius:16px;background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 10%,var(--surface)),var(--surface));
  border:1px solid color-mix(in srgb,var(--accent) 22%,var(--border));box-shadow:var(--shadow-sm);transform-origin:50% 100%;animation:sx-flip .6s var(--spring) both;animation-delay:calc(var(--i)*70ms)}
.sx-word b{font-family:var(--mono);font-weight:560;font-size:clamp(17px,2.6vw,24px);letter-spacing:.01em;line-height:1.25}
.sx-word small{font-family:var(--mono);font-size:10.5px;letter-spacing:.18em;color:var(--muted);margin-top:1px}
.sx-sep{font-family:var(--mono);font-size:clamp(17px,2.6vw,24px);color:var(--sx-sym);font-weight:600;min-width:6px;text-align:center}
.sx-sep.sx-num{color:var(--sx-digit);padding-left:2px}
@keyframes sx-flip{from{opacity:0;transform:rotateX(-80deg) translateY(10px)}}
`

export function mount(root, { signal }) {
  useStyles('sx-passphrase', CSS)
  const s = { words: 6, separator: '-', capital: 'first', digits: 0, count: 1, ...load('passphrase-generator:opts', {}) }
  s.words = Math.min(12, Math.max(3, +s.words || 6))
  s.count = Math.min(50, Math.max(1, +s.count || 1))
  let list = null

  const out = results({ label: 'Your passphrase', ic: 'key', filename: 'passphrases.txt', onRegenerate: () => run(true), paintValue: (el, text) => el.replaceChildren(text), emptyText: 'Loading the word list...' })
  const wordsHost = h('div', { class: 'sx-words' })
  const status = h('div')
  const single = out.querySelector('.sx-pass')
  single.after(wordsHost)

  const wordsOut = h('b', { class: 'mono' }, s.words)
  const wordsRange = h('input', { type: 'range', min: 3, max: 12, step: 1, value: s.words, 'aria-label': 'Number of words', oninput: (e) => { s.words = +e.target.value; wordsOut.textContent = s.words; run(false) } })
  const sep = select(SEPARATORS, s.separator, (v) => { s.separator = v; run(false) })
  const cap = segmented([['none', 'abc'], ['first', 'Abc'], ['upper', 'ABC'], ['random', 'aBc']], s.capital, (v) => { s.capital = v; run(false) }, 'Capitalisation')
  const dig = segmented([[0, 'None'], [1, '1 digit'], [2, '2 digits'], [3, '3 digits'], [4, '4 digits']], s.digits, (v) => { s.digits = v; run(false) }, 'Digits at the end')
  const count = number(s.count, { min: 1, max: 50, step: 1, ariaLabel: 'How many', onInput: (n) => { if (Number.isFinite(n)) { s.count = Math.min(50, Math.max(1, Math.round(n))); run(false) } } })

  const persist = debounce(() => save('passphrase-generator:opts', s), 300)
  function run(animate) {
    persist()
    if (!list) return
    const made = Array.from({ length: s.count }, () => generatePassphrase(list, { count: s.words, separator: s.separator, capital: s.capital, digits: s.digits }))
    const bits = made[0].bits
    out.show(made.map((m) => m.text), { bits, text: `${Math.round(bits)} bits each`, nodes: metaLine(bits, `${s.words} words from 7,776`) }, { animate: false })
    const one = made.length === 1
    single.hidden = one
    wordsHost.hidden = !one
    if (!one) return
    let wi = 0
    wordsHost.replaceChildren(h('span', { class: 'sr-only' }, made[0].text), ...made[0].parts.map((p) => (p.type === 'word'
      ? h('div', { class: 'sx-word', 'aria-hidden': 'true', style: { '--i': animate ? wi++ : 0, animation: animate ? null : 'none' } }, h('b', p.text), h('small', diceCode(p.idx)))
      : h('span', { class: ['sx-sep', p.type === 'num' && 'sx-num'], 'aria-hidden': 'true' }, p.text === ' ' ? '·' : p.text))))
  }

  root.append(h('div', { class: 'sx stack' },
    out,
    status,
    h('div', { class: 'sx-hint' }, 'Each word is picked with crypto.getRandomValues from the EFF large wordlist (7,776 words, about 12.9 bits per word). The small numbers under each word are the five dice rolls it stands for.'),
    panel(h('div', { class: 'sx-cols' },
      h('div', { class: 'stack' },
        field('Words', h('div', { class: 'sx-lens' }, wordsRange, wordsOut)),
        field('Separator', sep),
        field('Numbers at the end', dig)),
      h('div', { class: 'stack' },
        field('Capitalisation', cap),
        field('How many', count, 'Up to 50 passphrases at once.'))))))

  const load1 = () => {
    status.replaceChildren(h('div', { class: 'sx-skel', style: 'width:60%' }))
    loadWords(signal).then((l) => { list = l; status.replaceChildren(); run(true) }).catch((e) => {
      if (e.name === 'AbortError') return
      status.replaceChildren(alert('error', h('strong', 'Could not load the word list. '), e.message || 'Check your connection.', ' ', button('Try again', { size: 'sm', onClick: load1 })))
    })
  }
  load1()
}
