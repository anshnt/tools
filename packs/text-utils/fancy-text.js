// Fancy text generator: Unicode "fonts" (bold, italic, script, gothic, double-struck, monospace, circled, squared, small caps, upside down...)
// as a Pinterest-style wall of live cards. Click a card to copy it. Everything is plain Unicode, so it pastes anywhere.
// style(id, text) and STYLES are pure and exported for tests (and reused by the upside-down text tool).
import { h, icon, copyText } from '../../lib/ui.js'
import { root, ribbon, pane, area, createOptions, group, dock, inputActions, burst, injectStyle, pills } from './_shared.js'

const cp = (n) => String.fromCodePoint(n)
const A_UP = 65, A_LOW = 97, D0 = 48

/** Map A-Z, a-z and 0-9 onto a Unicode block. Missing letters (holes in the math blocks) are filled from `holes`. */
function mathMap(up, low, digit, holes = {}) {
  return (ch) => {
    if (holes[ch]) return holes[ch]
    const c = ch.codePointAt(0)
    if (c >= 65 && c <= 90 && up) return cp(up + c - A_UP)
    if (c >= 97 && c <= 122 && low) return cp(low + c - A_LOW)
    if (c >= 48 && c <= 57 && digit) return cp(digit + c - D0)
    return ch
  }
}
const table = (from, to) => {
  const m = new Map()
  const a = [...from], b = [...to]
  a.forEach((c, i) => m.set(c, b[i]))
  return (ch) => m.get(ch) ?? ch
}
const combine = (mark) => (text) => [...text].map((c) => (c === '\n' ? c : c + mark)).join('')
const wrap = (l, r) => (text) => `${l}${text}${r}`

const SCRIPT_HOLES = { B: '\u{212c}', E: '\u{2130}', F: '\u{2131}', H: '\u{210b}', I: '\u{2110}', L: '\u{2112}', M: '\u{2133}', R: '\u{211b}', e: '\u{212f}', g: '\u{210a}', o: '\u{2134}' }
const FRAKTUR_HOLES = { C: '\u{212d}', H: '\u{210c}', I: '\u{2111}', R: '\u{211c}', Z: '\u{2128}' }
const DOUBLE_HOLES = { C: '\u{2102}', H: '\u{210d}', N: '\u{2115}', P: '\u{2119}', Q: '\u{211a}', R: '\u{211d}', Z: '\u{2124}' }

const FLIP_LOW = 'ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz'
const FLIP_UP = '∀ᗺƆᗡƎℲ⅁HIſ⋊⅂WNOԀΌᴚS⊥∩ΛMX⅄Z'
const FLIP_DIG = '0ƖᘔƐㄣϛ9ㄥ86'
const FLIP_PUNCT = [['.', '˙'], [',', "'"], ["'", ','], ['"', '„'], ['?', '¿'], ['!', '¡'], ['(', ')'], [')', '('], ['[', ']'], [']', '['], ['{', '}'], ['}', '{'], ['<', '>'], ['>', '<'], ['&', '⅋'], ['_', '‾'], [';', '؛']]
const flipTable = new Map(FLIP_PUNCT)
;[...'abcdefghijklmnopqrstuvwxyz'].forEach((c, i) => flipTable.set(c, [...FLIP_LOW][i]))
;[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].forEach((c, i) => flipTable.set(c, [...FLIP_UP][i]))
;[...'0123456789'].forEach((c, i) => flipTable.set(c, [...FLIP_DIG][i]))
const flipChar = (ch) => flipTable.get(ch) ?? ch
/** Upside-down text: every letter flipped and the order reversed. */
export const flipText = (text, reverse = true) => text.split('\n').map((line) => { const cs = [...line].map(flipChar); return (reverse ? cs.reverse() : cs).join('') }).join('\n')

const SMALL_CAPS = table('abcdefghijklmnopqrstuvwxyz', 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ')
const SUPER = table('abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVW0123456789+-=()', 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾')
const CIRCLED = (ch) => {
  const c = ch.codePointAt(0)
  if (c >= 65 && c <= 90) return cp(0x24b6 + c - 65)
  if (c >= 97 && c <= 122) return cp(0x24d0 + c - 97)
  if (c >= 49 && c <= 57) return cp(0x2460 + c - 49)
  if (c === 48) return '\u{24ea}'
  return ch
}
const NEG_CIRCLED = (ch) => {
  const c = ch.toUpperCase().codePointAt(0)
  if (c >= 65 && c <= 90) return cp(0x1f150 + c - 65)
  if (c >= 49 && c <= 57) return cp(0x278a + c - 49)
  if (c === 48) return '\u{24ff}'
  return ch
}
const SQUARED = (ch) => { const c = ch.toUpperCase().codePointAt(0); return c >= 65 && c <= 90 ? cp(0x1f130 + c - 65) : ch }
const NEG_SQUARED = (ch) => { const c = ch.toUpperCase().codePointAt(0); return c >= 65 && c <= 90 ? cp(0x1f170 + c - 65) : ch }
const PAREN = (ch) => {
  const c = ch.toLowerCase().codePointAt(0)
  if (c >= 97 && c <= 122) return cp(0x249c + c - 97)
  if (c >= 49 && c <= 57) return cp(0x2474 + c - 49)
  return ch
}
const FULLWIDTH = (ch) => { const c = ch.codePointAt(0); return c === 32 ? '\u{3000}' : c >= 33 && c <= 126 ? cp(c + 0xfee0) : ch }
const perChar = (fn) => (text) => [...text].map(fn).join('')

function zalgo(text) {
  let seed = 7
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const up = [0x300, 0x301, 0x302, 0x303, 0x304, 0x306, 0x307, 0x308, 0x30a, 0x30b, 0x30c, 0x30d, 0x30e, 0x310, 0x311, 0x312, 0x313, 0x314, 0x33d, 0x33e, 0x340, 0x341, 0x342, 0x343, 0x344, 0x346, 0x34a, 0x34b, 0x34c, 0x350, 0x351, 0x352, 0x357, 0x35b, 0x363, 0x364, 0x365, 0x366]
  const down = [0x316, 0x317, 0x318, 0x319, 0x31c, 0x31d, 0x31e, 0x31f, 0x320, 0x324, 0x325, 0x326, 0x329, 0x32a, 0x32b, 0x32c, 0x32d, 0x32e, 0x32f, 0x330, 0x331, 0x332, 0x333, 0x339, 0x33a, 0x33b, 0x33c, 0x345, 0x347, 0x348, 0x349, 0x34d, 0x34e, 0x353, 0x354, 0x355, 0x356, 0x359, 0x35a]
  const pick = (a) => cp(a[Math.floor(rnd() * a.length)])
  return [...text].map((c) => (/\s/.test(c) ? c : c + pick(up) + pick(up) + pick(down) + (rnd() < 0.5 ? pick(up) : pick(down)))).join('')
}

/** All styles. cat: group for the filter pills. */
export const STYLES = [
  { id: 'bold', name: 'Bold', cat: 'bold', fn: perChar(mathMap(0x1d400, 0x1d41a, 0x1d7ce)) },
  { id: 'italic', name: 'Italic', cat: 'bold', fn: perChar(mathMap(0x1d434, 0x1d44e, 0, { h: '\u{210e}' })) },
  { id: 'bolditalic', name: 'Bold italic', cat: 'bold', fn: perChar(mathMap(0x1d468, 0x1d482, 0x1d7ce)) },
  { id: 'sans', name: 'Sans', cat: 'bold', fn: perChar(mathMap(0x1d5a0, 0x1d5ba, 0x1d7e2)) },
  { id: 'sansbold', name: 'Sans bold', cat: 'bold', fn: perChar(mathMap(0x1d5d4, 0x1d5ee, 0x1d7ec)) },
  { id: 'sansitalic', name: 'Sans italic', cat: 'bold', fn: perChar(mathMap(0x1d608, 0x1d622, 0x1d7e2)) },
  { id: 'sansbolditalic', name: 'Sans bold italic', cat: 'bold', fn: perChar(mathMap(0x1d63c, 0x1d656, 0x1d7ec)) },
  { id: 'mono', name: 'Monospace', cat: 'bold', fn: perChar(mathMap(0x1d670, 0x1d68a, 0x1d7f6)) },
  { id: 'script', name: 'Script', cat: 'script', fn: perChar(mathMap(0x1d49c, 0x1d4b6, 0, SCRIPT_HOLES)) },
  { id: 'boldscript', name: 'Bold script', cat: 'script', fn: perChar(mathMap(0x1d4d0, 0x1d4ea, 0x1d7ce)) },
  { id: 'fraktur', name: 'Gothic', cat: 'script', fn: perChar(mathMap(0x1d504, 0x1d51e, 0, FRAKTUR_HOLES)) },
  { id: 'boldfraktur', name: 'Bold gothic', cat: 'script', fn: perChar(mathMap(0x1d56c, 0x1d586, 0x1d7ce)) },
  { id: 'double', name: 'Double-struck', cat: 'script', fn: perChar(mathMap(0x1d538, 0x1d552, 0x1d7d8, DOUBLE_HOLES)) },
  { id: 'circled', name: 'Bubble', cat: 'boxed', fn: perChar(CIRCLED) },
  { id: 'negcircled', name: 'Dark bubble', cat: 'boxed', fn: perChar(NEG_CIRCLED) },
  { id: 'squared', name: 'Square', cat: 'boxed', fn: perChar(SQUARED) },
  { id: 'negsquared', name: 'Dark square', cat: 'boxed', fn: perChar(NEG_SQUARED) },
  { id: 'paren', name: 'Parentheses', cat: 'boxed', fn: perChar(PAREN) },
  { id: 'fullwidth', name: 'Wide', cat: 'small', fn: perChar(FULLWIDTH) },
  { id: 'smallcaps', name: 'Small caps', cat: 'small', fn: perChar(SMALL_CAPS) },
  { id: 'super', name: 'Tiny up', cat: 'small', fn: perChar(SUPER) },
  { id: 'spaced', name: 'Spaced out', cat: 'small', fn: (t) => t.split('\n').map((l) => [...l].join(' ')).join('\n') },
  { id: 'strike', name: 'Strikethrough', cat: 'lines', fn: combine('\u{336}') },
  { id: 'under', name: 'Underline', cat: 'lines', fn: combine('\u{332}') },
  { id: 'dunder', name: 'Double underline', cat: 'lines', fn: combine('\u{333}') },
  { id: 'over', name: 'Overline', cat: 'lines', fn: combine('\u{305}') },
  { id: 'slash', name: 'Slashed', cat: 'lines', fn: combine('\u{338}') },
  { id: 'wavy', name: 'Wavy', cat: 'lines', fn: combine('\u{330}') },
  { id: 'zalgo', name: 'Glitchy', cat: 'lines', fn: zalgo },
  { id: 'flip', name: 'Upside down', cat: 'flip', fn: flipText },
  { id: 'mirror', name: 'Backwards', cat: 'flip', fn: (t) => t.split('\n').map((l) => [...l].reverse().join('')).join('\n') },
  { id: 'd-star', name: 'Stars', cat: 'decor', fn: wrap('★ ', ' ★') },
  { id: 'd-spark', name: 'Sparkles', cat: 'decor', fn: wrap('✦ ', ' ✦') },
  { id: 'd-wing', name: 'Wings', cat: 'decor', fn: wrap('꧁ ', ' ꧂') },
  { id: 'd-bracket', name: 'Brackets', cat: 'decor', fn: wrap('『 ', ' 』') },
  { id: 'd-ornate', name: 'Ornate', cat: 'decor', fn: wrap('༺ ', ' ༻') },
  { id: 'd-dream', name: 'Dreamy', cat: 'decor', fn: wrap('⋆｡°✩ ', ' ✩°｡⋆') },
  { id: 'd-heart', name: 'Hearts', cat: 'decor', fn: wrap('♥ ', ' ♥') },
  { id: 'd-flower', name: 'Flowers', cat: 'decor', fn: wrap('✿ ', ' ✿') },
  { id: 'd-block', name: 'Blocks', cat: 'decor', fn: wrap('▀▄▀▄ ', ' ▄▀▄▀') },
  { id: 'd-quote', name: 'Quotes', cat: 'decor', fn: wrap('❝ ', ' ❞') },
]
export const style = (id, text) => STYLES.find((s) => s.id === id).fn(text)

const CATS = [['all', 'All'], ['bold', 'Bold & italic'], ['script', 'Script & gothic'], ['boxed', 'Boxed'], ['small', 'Small & wide'], ['lines', 'Lines'], ['flip', 'Flip'], ['decor', 'Decorations']]

const CSS = `
.tu-wall { column-width: 260px; column-gap: 12px; margin-inline: -6px; padding-inline: 6px; overflow-x: clip; }
.tu-fancy { break-inside: avoid; display: block; width: 100%; margin: 0 0 12px; text-align: left; position: relative; padding: 14px 16px 15px; border-radius: 20px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font: inherit; color: inherit;
  box-shadow: var(--shadow-sm); transition: transform .3s var(--spring), box-shadow .3s, border-color .2s; animation: tu-pop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 28ms); }
.tu-fancy:hover { transform: translateY(-4px) rotate(-.4deg); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.tu-fancy:active { transform: scale(.985); }
.tu-fancy .nm { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.tu-fancy .nm .icon { width: 15px; height: 15px; opacity: 0; transform: scale(.6); transition: opacity .2s, transform .3s var(--spring); }
.tu-fancy:hover .nm .icon, .tu-fancy:focus-visible .nm .icon { opacity: 1; transform: none; }
.tu-fancy .tx { font-size: 21px; line-height: 1.35; overflow-wrap: anywhere; white-space: pre-wrap; }
.tu-fancy.ghost .tx { opacity: .5; }
.tu-fancy.done { border-color: var(--success); box-shadow: 0 14px 30px -18px var(--success); }
.tu-fancy.done .nm { color: var(--success); }
.tu-fancy.done .nm .icon { opacity: 1; transform: none; color: var(--success); }
.tu-note { font-size: 12.5px; color: var(--muted); text-align: center; padding: 6px 0 0; }
@media (max-width: 720px) { .tu-wall { column-width: 100%; } }
`

const DEFAULT = 'Fancy text'
const MAX_SHOW = 240

export function mount(rootEl, { tool }) {
  injectStyle()
  if (!document.getElementById('tu-ft-style')) document.head.append(h('style', { id: 'tu-ft-style' }, CSS))
  const o = createOptions(tool.id, { cat: 'all' })
  const input = area({ short: true, placeholder: 'Type your name, bio or caption...', 'aria-label': 'Your text', maxlength: 2000 })
  const rib = ribbon()
  const foot = h('div', { class: 'tu-foot' }, h('span', 'Only A-Z, a-z and 0-9 get restyled. Other letters stay as they are.'), h('span'))
  const wall = h('section', { class: 'tu-wall', 'aria-label': 'Styled text' })
  const inPane = pane({ title: 'Your text', body: input, foot, actions: inputActions({ ta: input, sample: 'Hello World 2025', onChange: () => render() }) })
  const catPills = pills(CATS, o.v.cat, (v) => o.set({ cat: v }), 'Style groups')
  const controls = dock(group('Show', catPills))
  const cards = new Map()

  function render(animate = false) {
    const text = input.value
    const shown = text.trim() ? text : DEFAULT
    const list = STYLES.filter((s) => o.v.cat === 'all' || s.cat === o.v.cat)
    const cut = (t) => ([...t].length > MAX_SHOW ? [...t].slice(0, MAX_SHOW).join('') + '...' : t)
    const frag = []
    list.forEach((s, i) => {
      let c = cards.get(s.id)
      if (!c) {
        const tx = h('div', { class: 'tx' })
        const nm = h('div', { class: 'nm' }, h('span', s.name), icon('copy'))
        const el = h('button', { type: 'button', class: 'tu-fancy', title: `Copy ${s.name}`, onclick: async () => {
          const full = s.fn(input.value.trim() ? input.value : DEFAULT)
          if (await copyText(full)) {
            el.classList.add('done'); nm.lastChild.replaceWith(icon('check')); burst(el, 8)
            setTimeout(() => { el.classList.remove('done'); nm.lastChild.replaceWith(icon('copy')) }, 1400)
          }
        } }, nm, tx)
        c = { el, tx }
        cards.set(s.id, c)
      }
      c.tx.textContent = cut(s.fn(shown))
      c.el.classList.toggle('ghost', !text.trim())
      if (animate) { c.el.style.setProperty('--i', i); c.el.style.animation = 'none'; void c.el.offsetWidth; c.el.style.animation = '' }
      frag.push(c.el)
    })
    wall.replaceChildren(...frag)
    rib.set(text.trim() ? [{ label: 'styles ready, click one to copy', value: list.length, tone: 'accent' }] : [], text.trim() ? '' : 'Type something above. These cards preview "Fancy text" until you do.')
  }
  o.onChange = () => render(true)
  input.addEventListener('input', () => render())
  rootEl.append(root(inPane, rib.el, controls, wall, h('p', { class: 'tu-note' }, 'These are Unicode symbols, not real fonts, so they paste almost anywhere. Screen readers may read them letter by letter, so use them sparingly for important text.')))
  render(true)
  input.focus({ preventScroll: true })
}
