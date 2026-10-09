// Case converter: UPPER, lower, Title (with small-word rules), Sentence, camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE and more.
// convert(kind, text, options) is pure and exported for tests. The UI shows every style at once as live cards; click one to use it.
import { h, icon, button, copyText } from '../../lib/ui.js'
import { studio, createOptions, group, chips, burst, injectStyle } from './_shared.js'

const SMALL = new Set('a an and as at but by en for if in nor of on or per so the to up via vs v yet'.split(' '))
const LETTER = /\p{L}/u

/** Split into words for identifier styles: camelCase, ACRONYMWord, snake_case and spaces all count as boundaries. */
export function words(s) {
  return s
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
}
const cap = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)
const perLine = (text, fn) => text.split('\n').map(fn).join('\n')

/** Upper-case the first letter that follows any leading punctuation (quotes, brackets). */
function upFirst(tok) {
  const m = tok.match(/^([^\p{L}\p{N}]*)(.*)$/su)
  return m[1] + (m[2] ? m[2].charAt(0).toUpperCase() + m[2].slice(1) : '')
}
const isAcronym = (w) => w.length > 1 && /^[\p{Lu}\p{N}]+$/u.test(w) && /\p{Lu}/u.test(w)
/** True when the text has lowercase letters and ALL CAPS words are the minority, so they are probably acronyms and not shouting. */
function mostlyLower(text) {
  const toks = text.match(/[\p{L}\p{N}]{2,}/gu) || []
  if (!toks.length || !/\p{Ll}/u.test(text)) return false
  return toks.filter(isAcronym).length / toks.length < 0.4
}

function titleCase(text, o, smallWords) {
  const mixed = mostlyLower(text)
  const keep = o.keepCaps && mixed
  return perLine(text, (line) => {
    const parts = line.split(/(\s+)/)
    const idx = parts.map((p, i) => (/\S/.test(p) ? i : -1)).filter((i) => i >= 0)
    let after = true // start of line or after a colon / period: always capitalise
    return parts.map((p, i) => {
      if (!/\S/.test(p)) return p
      const bare = p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      const first = i === idx[0], last = i === idx[idx.length - 1]
      let out
      if (keep && isAcronym(bare)) out = p
      else {
        const lower = p.toLowerCase()
        const small = smallWords && SMALL.has(bare.toLowerCase()) && !first && !last && !after
        out = small ? lower : lower.split('-').map((seg, k) => {
          const sb = seg.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
          return k > 0 && smallWords && SMALL.has(sb) ? seg : upFirst(seg)
        }).join('-')
      }
      after = /[:.!?]["')\]]*$/.test(p)
      return out
    }).join('')
  })
}

function sentenceCase(text, o) {
  const mixed = mostlyLower(text)
  const keep = o.keepCaps && mixed
  const lowered = text.replace(/\S+/gu, (t) => {
    const bare = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (keep && isAcronym(bare)) return t
    if (/^i(?:['\u{2019}](?:m|ll|ve|d))?$/iu.test(bare)) return t.toLowerCase().replace(/\bi\b/g, 'I')
    return t.toLowerCase()
  })
  let out = ''
  let start = true
  for (const ch of lowered) {
    if (start && LETTER.test(ch)) { out += ch.toUpperCase(); start = false; continue }
    out += ch
    if (/[.!?\u{964}\n]/u.test(ch)) start = true
    else if (/[\p{L}\p{N}]/u.test(ch)) start = false
  }
  return out
}

function alternate(text) {
  let i = 0
  let out = ''
  for (const ch of text) {
    if (LETTER.test(ch)) out += i++ % 2 ? ch.toUpperCase() : ch.toLowerCase()
    else out += ch
  }
  return out
}
function inverse(text) {
  let out = ''
  for (const ch of text) {
    const u = ch.toUpperCase(), l = ch.toLowerCase()
    out += ch === u && ch !== l ? l : ch === l && ch !== u ? u : ch
  }
  return out
}

export const CASES = [
  { id: 'upper', name: 'UPPERCASE', sample: 'THE QUICK FOX' },
  { id: 'lower', name: 'lowercase', sample: 'the quick fox' },
  { id: 'title', name: 'Title Case', sample: 'The Quick Fox of the Hills' },
  { id: 'sentence', name: 'Sentence case', sample: 'The quick fox. It ran.' },
  { id: 'capitalize', name: 'Capitalize Each Word', sample: 'The Quick Fox' },
  { id: 'camel', name: 'camelCase', sample: 'theQuickFox' },
  { id: 'pascal', name: 'PascalCase', sample: 'TheQuickFox' },
  { id: 'snake', name: 'snake_case', sample: 'the_quick_fox' },
  { id: 'kebab', name: 'kebab-case', sample: 'the-quick-fox' },
  { id: 'constant', name: 'CONSTANT_CASE', sample: 'THE_QUICK_FOX' },
  { id: 'dot', name: 'dot.case', sample: 'the.quick.fox' },
  { id: 'alternate', name: 'aLtErNaTe cAsE', sample: 'tHe qUiCk fOx' },
  { id: 'inverse', name: 'iNVERSE cASE', sample: 'tHE QUICK FOX' },
]

export function convert(kind, text, o = { smallWords: true, keepCaps: true }) {
  switch (kind) {
    case 'upper': return text.toUpperCase()
    case 'lower': return text.toLowerCase()
    case 'title': return titleCase(text, o, o.smallWords)
    case 'capitalize': return titleCase(text, o, false)
    case 'sentence': return sentenceCase(text, o)
    case 'camel': return perLine(text, (l) => words(l).map((w, i) => (i ? cap(w) : w.toLowerCase())).join(''))
    case 'pascal': return perLine(text, (l) => words(l).map(cap).join(''))
    case 'snake': return perLine(text, (l) => words(l).map((w) => w.toLowerCase()).join('_'))
    case 'kebab': return perLine(text, (l) => words(l).map((w) => w.toLowerCase()).join('-'))
    case 'constant': return perLine(text, (l) => words(l).map((w) => w.toUpperCase()).join('_'))
    case 'dot': return perLine(text, (l) => words(l).map((w) => w.toLowerCase()).join('.'))
    case 'alternate': return alternate(text)
    case 'inverse': return inverse(text)
    default: return text
  }
}

const CSS = `
.tu-cases { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 10px; margin-inline: -6px; padding: 0 6px 4px; overflow-x: clip; }
.tu-case { position: relative; display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 13px 14px 40px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; min-width: 0; font: inherit; color: inherit;
  transition: transform .3s var(--spring), border-color .2s, box-shadow .3s, background .3s; animation: tu-pop .45s var(--spring) both; animation-delay: calc(var(--i, 0) * 30ms); box-shadow: var(--shadow-sm); }
.tu-case:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); box-shadow: var(--shadow); }
.tu-case:active { transform: scale(.98); }
.tu-case[aria-pressed="true"] { border-color: var(--accent); background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--surface)); box-shadow: 0 16px 34px -20px var(--accent); }
.tu-case .nm { font-size: 12px; font-weight: 650; letter-spacing: .02em; color: var(--muted); display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-right: 30px; }
.tu-case[aria-pressed="true"] .nm { color: var(--accent); }
.tu-case .pv { font: 14px/1.45 var(--mono); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.9em; }
.tu-case .pv.ghost { color: var(--muted); opacity: .8; }
.tu-case .tick { position: absolute; right: 12px; top: 12px; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: var(--accent-text); transform: scale(0); transition: transform .35s var(--spring); }
.tu-case .tick .icon { width: 12px; height: 12px; stroke-width: 3; }
.tu-case[aria-pressed="true"] .tick { transform: scale(1); }
.tu-case-copy { position: absolute; right: 8px; bottom: 8px; }
`

export function mount(rootEl, { tool }) {
  injectStyle()
  if (!document.getElementById('tu-cc-style')) document.head.append(h('style', { id: 'tu-cc-style' }, CSS))
  const o = createOptions(tool.id, { kind: 'title', smallWords: true, keepCaps: true })
  let st
  const cards = new Map()
  const pv = (id, text) => {
    const c = cards.get(id)
    const first = text.split('\n').find((l) => l.trim()) || ''
    const short = [...first].length > 120 ? [...first].slice(0, 120).join('') + '...' : first
    c.pv.textContent = short || CASES.find((x) => x.id === id).sample
    c.pv.classList.toggle('ghost', !short)
  }
  CASES.forEach((c, i) => {
    const pvEl = h('div', { class: 'pv ghost' }, c.sample)
    const sel = h('button', { type: 'button', class: 'tu-case', style: { '--i': i }, 'aria-pressed': String(o.v.kind === c.id), onclick: () => { o.set({ kind: c.id }) } },
      h('span', { class: 'nm' }, c.name), pvEl, h('span', { class: 'tick' }, icon('check')))
    const cp = button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${c.name}`, onClick: async (e) => {
      e.stopPropagation()
      const t = convert(c.id, st.input.value, o.v)
      if (!t) return
      if (await copyText(t)) burst(cp, 6)
    } })
    cp.classList.add('tu-case-copy')
    const wrap = h('div', { style: 'position:relative' }, sel, cp)
    cards.set(c.id, { sel, pv: pvEl, wrap })
  })
  const grid = h('section', { class: 'tu-cases', 'aria-label': 'All case styles' }, [...cards.values()].map((c) => c.wrap))

  const run = (text) => {
    for (const c of CASES) {
      pv(c.id, text ? convert(c.id, text, o.v) : '')
      cards.get(c.id).sel.setAttribute('aria-pressed', String(o.v.kind === c.id))
    }
    const name = CASES.find((c) => c.id === o.v.kind).name
    const out = convert(o.v.kind, text, o.v)
    const letters = (text.match(/\p{L}/gu) || []).length
    return { text: out, badges: text ? [{ label: name, value: '✓', tone: 'accent' }, { label: 'letters', value: letters }] : [] }
  }
  st = studio({
    id: tool.id, inputTitle: 'Your text', outputTitle: 'Converted text', placeholder: 'Type or paste your text here...',
    sample: 'the quick brown fox jumps over the lazy dog. NASA launches a new rocket: what it means for you',
    controls: [group('Title and sentence case', chips(o.bool('smallWords', 'Small words stay lowercase', 'a, an, the, and, of, to... except at the start and end'), o.bool('keepCaps', 'Keep ALL CAPS words', 'Acronyms like NASA stay as they are when the rest of the text has lowercase letters')))],
    run, filename: 'converted-text.txt', after: grid, short: true,
  })
  o.onChange = () => st.refresh()
  rootEl.append(st.el)
  st.input.focus({ preventScroll: true })
}
