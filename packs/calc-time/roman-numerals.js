// Roman numerals: numbers to Roman and back, validation, optional overline notation up to 3,999,999.
import { h, icon, button, field, input, toggle, clear, copyText, alert } from '../../lib/ui.js'
import { useStyles, addStyles, settleOnce } from './_kit.js'
import { load, save } from '../../lib/store.js'
import { today, ymd } from './_dates.js'

const OL = String.fromCharCode(0x305) // combining overline
const TABLE = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
const VAL = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
export const SYMBOLS = [['I', 1], ['V', 5], ['X', 10], ['L', 50], ['C', 100], ['D', 500], ['M', 1000]]

/** 1..3999 -> 'MMXXVI'. Anything else gives ''. */
export function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return ''
  let out = ''
  for (const [v, s] of TABLE) while (n >= v) { out += s; n -= v }
  return out
}
/** Parts of a numeral for display: thousands (under an overline, for 4000 and up) and the rest. */
export function romanParts(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3_999_999) return null
  return n < 4000 ? { over: '', rest: toRoman(n) } : { over: toRoman(Math.floor(n / 1000)), rest: toRoman(n % 1000) }
}
/** Plain text with combining overlines (for copying) or the (IV) form. */
export const romanText = (p, style = 'overline') => (style === 'paren' && p.over ? `(${p.over})${p.rest}` : [...p.over].map((c) => c + OL).join('') + p.rest)

/** Left to right with the subtractive rule; NaN for an empty string or a letter that is not a numeral. */
export function looseValue(s) {
  if (!s || /[^IVXLCDM]/.test(s)) return NaN
  let total = 0
  for (let i = 0; i < s.length; i++) { const v = VAL[s[i]], next = VAL[s[i + 1]] || 0; total += v < next ? -v : v }
  return total
}

/**
 * Read a Roman numeral. Accepts upper or lower case, (IV)CM form and combining overlines for thousands.
 * Returns {value, standard (boolean), canonical (text), parts, error, note}.
 */
export function parseRoman(text, allowOverline = true) {
  let s = String(text ?? '').toUpperCase().replace(/\s+/g, '')
  if (!s) return { empty: true }
  let over = '', rest = s
  const paren = /^\(([IVXLCDM]+)\)(.*)$/.exec(s)
  if (paren) { over = paren[1]; rest = paren[2] } else {
    const m = new RegExp(`^((?:[IVXLCDM]${OL})+)(.*)$`).exec(s)
    if (m) { over = m[1].split(OL).join(''); rest = m[2] }
  }
  const bad = [...new Set([...(over + rest).replace(new RegExp(OL, 'g'), '')].filter((c) => !(c in VAL)))]
  if (bad.length) return { error: `${bad.map((c) => `"${c}"`).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not Roman numeral letters. Use I, V, X, L, C, D and M.` }
  if (over && !allowOverline) return { error: 'Turn on "Overline notation" to read numerals above 3999.' }
  const a = over ? looseValue(over) : 0, b = rest ? looseValue(rest) : 0
  const value = a * 1000 + b
  if (!Number.isFinite(value) || value < 1) return { error: 'That does not make a number. Try something like XIV.' }
  if (!allowOverline && value > 3999) return { error: 'Standard numerals stop at 3999. Turn on overline notation for bigger numbers.' }
  const parts = romanParts(value)
  if (!parts) return { error: 'That is above 3,999,999, the largest number Roman numerals can write with an overline.' }
  const canonical = romanText(parts)
  const standard = (over + rest) === parts.over + parts.rest && !!over === !!parts.over
  let note = ''
  if (!standard) note = `${text.trim()} reads as ${value.toLocaleString()}, but the standard way to write it is ${parts.over ? romanText(parts, 'paren') : parts.rest}.`
  return { value, standard, canonical, parts, note }
}

/** Greedy breakdown: 1999 -> [[M,1000],[CM,900],[XC,90],[IX,9]]. */
export function breakdown(n) {
  const out = []
  for (const [v, s] of TABLE) while (n >= v) { out.push([s, v]); n -= v }
  return out
}

const CSS = `
.ct-rn-big { display: flex; flex-wrap: wrap; gap: clamp(6px, 1.4vw, 12px); margin-top: 14px; }
.ct-rn-big .t { min-width: clamp(44px, 9vw, 74px); height: clamp(58px, 11vw, 92px); padding: 0 8px; display: grid; place-items: center; border-radius: clamp(14px, 2.4vw, 22px); font-family: "Cormorant Garamond", "Palatino Linotype", Georgia, "Times New Roman", serif; font-size: clamp(34px, 7.5vw, 62px); font-weight: 700;
  color: var(--text); background: linear-gradient(160deg, color-mix(in srgb, var(--c) 18%, var(--surface)), var(--surface)); border: 1px solid color-mix(in srgb, var(--c) 35%, var(--border)); box-shadow: 0 14px 28px -18px var(--c), inset 0 1px 0 rgba(255, 255, 255, .5);
  animation: ctPop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 55ms); }
.ct-rn-big .t.ol { text-decoration: overline; text-decoration-thickness: 3px; text-underline-offset: 6px; }
.ct-rn-in { text-transform: uppercase; font-family: Georgia, "Times New Roman", serif; font-size: 20px; letter-spacing: .06em; }
.ct-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; padding: 4px 11px; border-radius: 999px; }
.ct-pill.ok { color: var(--success); background: var(--success-soft); }
.ct-pill.warn { color: var(--warning); background: var(--warning-soft); }
.ct-pill .icon { width: 14px; height: 14px; }
.ct-bd { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 14px; font-size: 14px; }
.ct-bd span.c { display: inline-flex; gap: 6px; align-items: baseline; padding: 5px 11px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); font-variant-numeric: tabular-nums; }
.ct-bd span.c b { font-family: Georgia, serif; font-size: 16px; }
.ct-bd .p { color: var(--muted); }
.ct-sym { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
.ct-sym div { text-align: center; padding: 12px 4px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); transition: transform .25s var(--spring); }
.ct-sym div:hover { transform: translateY(-3px) rotate(-1.5deg); }
.ct-sym b { display: block; font-family: Georgia, serif; font-size: 26px; }
.ct-sym span { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.ct-chart { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 84px), 1fr)); gap: 6px; }
.ct-chart button { display: flex; flex-direction: column; gap: 1px; align-items: center; padding: 6px 2px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font: inherit; color: inherit; transition: transform .2s var(--spring), border-color .2s; }
.ct-chart button:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--c) 50%, var(--border)); }
.ct-chart button b { font-size: 12px; color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.ct-chart button span { font-family: Georgia, serif; font-size: 13.5px; font-weight: 700; overflow-wrap: anywhere; text-align: center; }
@media (max-width: 720px) { .ct-sym { gap: 5px; } .ct-sym b { font-size: 21px; } }
`

export function mount(root) {
  useStyles()
  addStyles('ct-roman', CSS)
  let over = load('rn:over', false)
  const numIn = input({ placeholder: 'Number (1 to 3999)', inputmode: 'numeric', value: load('rn:n', '2026'), 'aria-label': 'Number', autocomplete: 'off', oninput: () => fromNum() })
  const romIn = input({ class: 'ct-rn-in', placeholder: 'Roman numeral, like MMXXVI', 'aria-label': 'Roman numeral', autocomplete: 'off', spellcheck: false, oninput: () => fromRoman() })
  const overT = toggle('Overline notation (thousands up to 3,999,999)', over, (v) => { over = v; save('rn:over', v); numIn.placeholder = v ? 'Number (1 to 3,999,999)' : 'Number (1 to 3999)'; fromNum() })
  const kicker = h('div', { class: 'ct-kicker' }), tiles = h('div', { class: 'ct-rn-big', 'aria-live': 'polite' }), status = h('div', { style: 'margin-top:12px' }), bd = h('div', { class: 'ct-bd' })
  let copyVal = '', copyParen = ''
  const copyBtn = button('Copy numeral', { icon: 'copy', size: 'sm', onClick: () => copyVal && copyText(copyVal) })
  const parenBtn = button('Copy as (IV)', { icon: 'brackets', size: 'sm', variant: 'ghost', onClick: () => copyParen && copyText(copyParen) })
  const hero = h('section', { class: 'ct-hero' }, h('i', { class: 'ct-dots' }), kicker, tiles, status, bd, h('div', { class: 'ct-actions' }, copyBtn, parenBtn))
  const warn = h('div')
  const results = h('div', { class: 'ct' }, hero)
  const y = ymd(today())
  const todayRoman = [y.d, y.m].map((n) => toRoman(n)).join('.') + '.' + toRoman(y.y)

  function show(n, p, standard, note) {
    results.hidden = false; settleOnce(results)
    const text = romanText(p), paren = romanText(p, 'paren')
    copyVal = text; copyParen = paren
    parenBtn.hidden = !p.over
    kicker.textContent = `${n.toLocaleString()} in Roman numerals`
    clear(tiles, [...[...p.over].map((c) => ({ c, ol: true })), ...[...p.rest].map((c) => ({ c }))].map((t, i) => h('span', { class: ['t', t.ol && 'ol'], style: { '--i': i } }, t.c)))
    clear(status, h('span', { class: ['ct-pill', standard ? 'ok' : 'warn'] }, icon(standard ? 'badge-check' : 'triangle-alert'), standard ? 'Standard form' : 'Not the standard form'), note ? h('div', { class: 'small muted', style: 'margin-top:8px' }, note) : null)
    const parts = p.over ? [...breakdown(Math.floor(n / 1000)).map(([s, v]) => [s, v * 1000, true]), ...breakdown(n % 1000)] : breakdown(n)
    clear(bd, parts.flatMap(([s, v, o], i) => [i ? h('span', { class: 'p' }, '+') : null, h('span', { class: 'c' }, h('b', { style: o ? 'text-decoration:overline' : '' }, s), v.toLocaleString())]).filter(Boolean))
  }

  function fromNum() {
    const t = numIn.value.replace(/[,\s]/g, '')
    save('rn:n', numIn.value)
    if (!t) { results.hidden = true; clear(warn, alert('info', 'Type a number, or a Roman numeral on the right.')); return }
    const n = Number(t)
    const max = over ? 3_999_999 : 3999
    if (!/^\d+$/.test(t)) { results.hidden = true; clear(warn, alert('warn', 'Whole numbers only. Romans had no zero, decimals or negatives.')); return }
    if (n < 1) { results.hidden = true; clear(warn, alert('warn', 'Roman numerals start at 1 (there was no zero).')); return }
    if (n > max) { results.hidden = true; clear(warn, alert('warn', over ? 'The most Roman numerals can write is 3,999,999.' : 'Standard numerals stop at 3999. Turn on overline notation for bigger numbers.')); return }
    clear(warn)
    const p = romanParts(n)
    romIn.value = p.over ? romanText(p, 'paren') : p.rest
    show(n, p, true, '')
  }
  function fromRoman() {
    const r = parseRoman(romIn.value, over)
    if (r.empty) { results.hidden = true; clear(warn, alert('info', 'Type a Roman numeral, or a number on the left.')); return }
    if (r.error) { results.hidden = true; clear(warn, alert('warn', r.error)); return }
    clear(warn)
    numIn.value = String(r.value)
    save('rn:n', numIn.value)
    show(r.value, r.parts, r.standard, r.note)
  }

  const symbols = h('div', { class: 'ct-sym' }, SYMBOLS.map(([s, v]) => h('div', h('b', s), h('span', v.toLocaleString()))))
  const chart = h('div', { class: 'ct-chart' }, Array.from({ length: 100 }, (_, i) => i + 1).map((n) => h('button', { type: 'button', 'aria-label': `${n} is ${toRoman(n)}`, onclick: () => { numIn.value = String(n); fromNum(); window.scrollTo({ top: 0, behavior: 'smooth' }) } }, h('b', String(n)), h('span', toRoman(n)))))
  const quick = h('div', { class: 'ct-chips' },
    h('button', { type: 'button', class: 'ct-chip', onclick: () => { numIn.value = String(y.y); fromNum() } }, icon('calendar'), `This year: ${toRoman(y.y)}`),
    h('button', { type: 'button', class: 'ct-chip', onclick: () => copyText(todayRoman) }, icon('copy'), `Today: ${todayRoman}`),
    ...[4, 9, 14, 40, 90, 400, 1994, 2024].map((n) => h('button', { type: 'button', class: 'ct-chip', onclick: () => { numIn.value = String(n); fromNum() } }, `${n} = ${toRoman(n)}`)))

  root.append(h('div', { class: 'ct' },
    h('section', { class: 'panel stack' }, h('div', { class: 'ct-fields' }, field('Number', numIn), field('Roman numeral', romIn)), overT, quick),
    warn, results,
    h('section', { class: 'panel stack' }, h('div', { class: 'ct-h' }, icon('book-open'), 'The seven letters'), symbols,
      h('div', { class: 'small muted' }, 'A smaller letter before a larger one is subtracted (IV is 4, IX is 9, XL is 40, XC is 90, CD is 400, CM is 900). Never more than three of the same letter in a row.')),
    h('section', { class: 'panel stack' }, h('div', { class: 'ct-h' }, icon('table'), '1 to 100'), chart)))
  fromNum()
}
