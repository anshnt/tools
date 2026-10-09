// Color contrast checker: WCAG 2.x contrast ratio for text and UI colors, with one-click accessible fixes.
import { h, panel, split, field, input, button, copyText, clear, toast } from '../../lib/ui.js'
import { addStyle, stage, tiles, contrast, rgbToHex, hexToRgb, rgbToHsl, hslToRgb, newCanvas, spot } from './_shared.js'

/** Parse any CSS color (hex, rgb(), hsl(), names). Returns [r,g,b] or null. Transparency is ignored. */
export function parseColor(str) {
  const s = String(str || '').trim()
  if (!s) return null
  const hex = hexToRgb(s)
  if (hex) return hex
  const g = parseColor.ctx ||= newCanvas(1, 1).getContext('2d', { willReadFrequently: true })
  const read = (base) => { g.fillStyle = base; g.fillStyle = s; return g.fillStyle }
  if (read('#000000') !== read('#ffffff')) return null
  g.clearRect(0, 0, 1, 1); g.fillStyle = s; g.fillRect(0, 0, 1, 1)
  const d = g.getImageData(0, 0, 1, 1).data
  return [d[0], d[1], d[2]]
}

/** Contrast ratio rounded down to 2 decimals (WCAG never rounds up). */
export const ratioOf = (a, b) => Math.floor(contrast(a, b) * 100) / 100

/** Nudge the lightness of `color` until it reaches `target` contrast on `other`. Returns [r,g,b] or null if impossible. */
export function fixColor(color, other, target) {
  if (contrast(color, other) >= target) return color
  const [hh, s, l] = rgbToHsl(color)
  const tryDir = (dir) => {
    let lo = l, hi = dir > 0 ? 100 : 0
    if (contrast(hslToRgb([hh, s, hi]), other) < target) return null
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (contrast(hslToRgb([hh, s, mid]), other) >= target) hi = mid; else lo = mid }
    return hslToRgb([hh, s, hi])
  }
  const darker = contrast([0, 0, 0], other) >= contrast([255, 255, 255], other)
  return (darker ? tryDir(-1) || tryDir(1) : tryDir(1) || tryDir(-1))
}

const CHECKS = [
  { id: 'aa', label: 'Text (AA)', min: 4.5, hint: 'Body text, level AA' },
  { id: 'aal', label: 'Large text (AA)', min: 3, hint: '18pt, or 14pt bold, and up' },
  { id: 'aaa', label: 'Text (AAA)', min: 7, hint: 'Enhanced contrast' },
  { id: 'aaal', label: 'Large text (AAA)', min: 4.5, hint: 'Large text, level AAA' },
  { id: 'ui', label: 'UI and graphics', min: 3, hint: 'Icons, borders, focus rings' },
]
const hslStr = (c) => { const [a, b, l] = rgbToHsl(c); return `hsl(${a}, ${b}%, ${l}%)` }
const PAIRS = [['#1f2937', '#ffffff'], ['#ffffff', '#6d5dfc'], ['#fde68a', '#1e1b4b'], ['#767676', '#ffffff'], ['#111111', '#ffe14a']]

export function mount(root) {
  addStyle('is-contrast', `
.t-con .pair { display: grid; grid-template-columns: 1fr; gap: 14px; }
.t-con .pick { display: grid; grid-template-columns: 52px 1fr; gap: 10px; align-items: end; }
.t-con .pick input[type=color] { width: 52px; height: 42px; padding: 3px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); cursor: pointer; }
.t-con .card { border-radius: 22px; padding: clamp(20px, 4vw, 34px); display: grid; gap: 14px; transition: background .3s, color .3s; box-shadow: inset 0 0 0 1px rgba(128, 128, 128, .25); }
.t-con .card h3 { font-size: clamp(24px, 5vw, 36px); letter-spacing: -.03em; line-height: 1.1; margin: 0; overflow-wrap: anywhere; }
.t-con .card p { margin: 0; font-size: 15px; line-height: 1.55; max-width: 52ch; overflow-wrap: anywhere; }
.t-con .card .fake { justify-self: start; padding: 9px 18px; border-radius: 12px; font-weight: 650; font-size: 14px; border: 2px solid currentColor; background: transparent; }
.t-con .checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 10px; }
.t-con .chk { position: relative; padding: 13px 14px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); display: grid; gap: 3px; animation: isPop .5s var(--spring) both; animation-delay: calc(var(--i) * 45ms); }
.t-con .chk b { display: flex; align-items: center; gap: 6px; font-size: 15px; }
.t-con .chk small { color: var(--muted); font-size: 12px; }
.t-con .chk .lab { font-size: 12.5px; font-weight: 600; color: var(--text-2); }
.t-con .chk.pass { border-color: color-mix(in srgb, var(--success) 40%, var(--border)); background: color-mix(in srgb, var(--success) 8%, var(--surface)); }
.t-con .chk.pass b { color: var(--success); }
.t-con .chk.fail { border-color: color-mix(in srgb, var(--danger) 35%, var(--border)); background: color-mix(in srgb, var(--danger) 7%, var(--surface)); }
.t-con .chk.fail b { color: var(--danger); }
.t-con .fixes { display: grid; gap: 8px; }
.t-con .fix { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); }
.t-con .fix .sw { width: 46px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; font-size: 14px; box-shadow: inset 0 0 0 1px rgba(128, 128, 128, .3); flex: none; }
.t-con .fix span { flex: 1; min-width: 150px; font-size: 13.5px; }
.t-con .fix span code { font-size: 12.5px; }
.t-con .quick { display: flex; gap: 8px; flex-wrap: wrap; }
.t-con .quick button { display: grid; place-items: center; width: 46px; height: 34px; border-radius: 10px; border: 1px solid var(--border); font-weight: 700; font-size: 14px; cursor: pointer; transition: transform .2s var(--spring); }
.t-con .quick button:hover { transform: translateY(-3px) rotate(-3deg); }
`)
  const s = { fg: [31, 41, 55], bg: [255, 255, 255], text: 'Readable words win', body: 'The quick brown fox jumps over the lazy dog. Good contrast keeps this sentence easy to read for everyone, in sunlight and on small screens.' }

  const fgText = input({ value: rgbToHex(s.fg), 'aria-label': 'Text color (hex, rgb or name)', mono: true, spellcheck: false, oninput: () => parseIn(fgText, 'fg') })
  const bgText = input({ value: rgbToHex(s.bg), 'aria-label': 'Background color (hex, rgb or name)', mono: true, spellcheck: false, oninput: () => parseIn(bgText, 'bg') })
  const fgPick = h('input', { type: 'color', value: rgbToHex(s.fg).toLowerCase(), 'aria-label': 'Pick text color', oninput: () => { set('fg', hexToRgb(fgPick.value)) } })
  const bgPick = h('input', { type: 'color', value: rgbToHex(s.bg).toLowerCase(), 'aria-label': 'Pick background color', oninput: () => { set('bg', hexToRgb(bgPick.value)) } })
  const sampleIn = input({ value: s.text, maxlength: 60, 'aria-label': 'Sample heading', oninput: () => { s.text = sampleIn.value || ' '; render() } })
  const swapBtn = button('Swap colors', { icon: 'arrow-left-right', variant: 'secondary', size: 'sm', onClick: () => { [s.fg, s.bg] = [s.bg, s.fg]; syncInputs(); render() } })
  const eyeBtns = 'EyeDropper' in window ? ['fg', 'bg'].map((k) => button(k === 'fg' ? 'Pick text from screen' : 'Pick background from screen', { icon: 'pipette', variant: 'ghost', size: 'sm', onClick: async () => {
    try { const r = await new window.EyeDropper().open(); set(k, hexToRgb(r.sRGBHex)) } catch { /* cancelled */ }
  } })) : []
  const quick = h('div', { class: 'quick', role: 'group', 'aria-label': 'Example pairs' }, PAIRS.map(([f, b]) => h('button', { type: 'button', style: `color:${f};background:${b}`, 'aria-label': `Example ${f} on ${b}`, onclick: () => { s.fg = hexToRgb(f); s.bg = hexToRgb(b); syncInputs(); render() } }, 'Aa')))

  const card = h('div', { class: 'card' }, h('h3'), h('p'), h('span', { class: 'fake' }, 'Button text'))
  const out = h('div', { class: 'stack' })
  const fixesBox = h('div', { class: 'stack tight' })

  function parseIn(el, key) {
    const c = parseColor(el.value)
    el.classList.toggle('invalid', !c)
    if (c) { s[key] = c; (key === 'fg' ? fgPick : bgPick).value = rgbToHex(c).toLowerCase(); render() }
  }
  function set(key, c) { s[key] = c; syncInputs(); render() }
  function syncInputs() {
    fgText.value = rgbToHex(s.fg); bgText.value = rgbToHex(s.bg)
    fgPick.value = rgbToHex(s.fg).toLowerCase(); bgPick.value = rgbToHex(s.bg).toLowerCase()
    fgText.classList.remove('invalid'); bgText.classList.remove('invalid')
  }

  function render() {
    const r = ratioOf(s.fg, s.bg)
    const fg = rgbToHex(s.fg), bg = rgbToHex(s.bg)
    card.style.background = bg; card.style.color = fg
    card.firstChild.textContent = s.text; card.children[1].textContent = s.body
    const verdict = r >= 7 ? 'Excellent: passes every level' : r >= 4.5 ? 'Good: passes AA for normal text' : r >= 3 ? 'Only for large text and UI parts' : 'Too low for reading'
    clear(out, tiles([
      { label: 'Contrast ratio', value: `${r.toFixed(2)}:1`, hint: verdict, hero: true, good: r >= 4.5, bad: r < 3, copy: `${r.toFixed(2)}:1` },
      { label: 'Text', value: fg, hint: hslStr(s.fg), copy: fg },
      { label: 'Background', value: bg, hint: hslStr(s.bg), copy: bg },
    ], { copy: copyText }),
    h('div', { class: 'checks' }, CHECKS.map((c, i) => {
      const ok = r >= c.min
      return h('div', { class: ['chk', ok ? 'pass' : 'fail'], style: { '--i': i } }, h('span', { class: 'lab' }, c.label), h('b', ok ? '✓ Pass' : '✕ Fail'), h('small', `${c.hint} (needs ${c.min}:1)`))
    })))
    // fixes
    const fixes = []
    for (const [target, name] of [[4.5, 'AA'], [7, 'AAA']]) {
      if (r >= target) continue
      const nf = fixColor(s.fg, s.bg, target), nb = fixColor(s.bg, s.fg, target)
      if (nf) fixes.push({ name, what: 'text', rgb: nf, apply: () => set('fg', nf), ratio: ratioOf(nf, s.bg), against: s.bg, on: nf })
      if (nb) fixes.push({ name, what: 'background', rgb: nb, apply: () => set('bg', nb), ratio: ratioOf(s.fg, nb), against: nb, on: s.fg })
    }
    clear(fixesBox, fixes.length ? [h('h3', { class: 'is-eyebrow' }, 'Closest accessible colors'), h('div', { class: 'fixes' }, fixes.map((f) => h('div', { class: 'fix' },
      h('div', { class: 'sw', style: { background: f.what === 'text' ? rgbToHex(s.bg) : rgbToHex(f.rgb), color: f.what === 'text' ? rgbToHex(f.rgb) : rgbToHex(s.fg) } }, 'Aa'),
      h('span', `Change the ${f.what} to `, h('code', rgbToHex(f.rgb)), ` for ${f.ratio.toFixed(2)}:1 (${f.name})`),
      button('Use it', { size: 'sm', onClick: f.apply }))))] : null)
  }

  const controls = panel(h('div', { class: 'stack' },
    h('div', { class: 'pair' },
      h('div', { class: 'pick' }, fgPick, field('Text color', fgText)), h('div', { class: 'pick' }, bgPick, field('Background color', bgText))),
    h('div', { class: 'row' }, swapBtn, ...eyeBtns),
    field('Sample heading', sampleIn),
    field('Try an example', quick),
    h('p', { class: 'small muted' }, 'Uses the WCAG 2.x formula. Type any CSS color: #1f2937, rgb(31 41 55), hsl(220 28% 17%) or a name like tomato. Transparent colors are treated as opaque.')))

  root.append(h('div', { class: 't-con' }, split(h('div', { class: 'stack' }, controls, fixesBox), h('div', { class: 'stack' }, spot(stage(card)), out), 'wide-right')))
  render()
}
