// Number base converter: bases 2-36 with BigInt (no size limit), two's complement views for fixed widths, and a clickable bit grid.
import { h, input, select, toggle, segmented, alert, clear, table, stats, formatNumber } from '../../lib/ui.js'
import { useKit, css, chips, eyebrow, pill, copyRow, hashParams } from './_kit.js'

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Parse digits in `base` (2-36). Prefixes 0x/0b/0o override the base. Underscores, commas and spaces are ignored. Throws a readable Error. */
export function parseBig(text, base = 10) {
  let t = text.trim().replace(/[_\s,]/g, '')
  if (!t) return null
  let neg = false
  if (t[0] === '-' || t[0] === '+') { neg = t[0] === '-'; t = t.slice(1) }
  let usedBase = base
  const m = /^0([xbo])(?=[0-9a-z])/i.exec(t)
  const fromPrefix = !!m && DIGITS.indexOf(m[1].toLowerCase()) >= base // 0b1 in base 16 is just the hex number 0xB1
  if (fromPrefix) { usedBase = { x: 16, b: 2, o: 8 }[m[1].toLowerCase()]; t = t.slice(2) }
  if (!t) throw new Error('Enter some digits after the sign or prefix.')
  const lower = t.toLowerCase()
  let n = 0n
  const B = BigInt(usedBase)
  // chunked accumulation keeps very long inputs fast
  for (let i = 0; i < lower.length; i++) {
    const d = DIGITS.indexOf(lower[i])
    if (d < 0 || d >= usedBase) {
      const ch = t[i]
      throw new Error(/[0-9a-z]/i.test(ch) ? `"${ch}" is not a valid digit in base ${usedBase} (allowed: ${DIGITS.slice(0, usedBase).toUpperCase().replace(/(.).*(.)/, '$1 to $2')}).` : `"${ch}" is not allowed in a number.`)
    }
    n = n * B + BigInt(d)
  }
  return { value: neg ? -n : n, base: usedBase, fromPrefix }
}

export const toBase = (n, base, upper = false) => { const s = n.toString(base); return upper ? s.toUpperCase() : s }
export const bitLength = (n) => (n === 0n ? 0 : (n < 0n ? -n : n).toString(2).length)
export const popcount = (n) => [...(n < 0n ? -n : n).toString(2)].filter((c) => c === '1').length

/** Unsigned bit pattern of n in `bits` bits (two's complement for negatives), or null when it does not fit. */
export function twosPattern(n, bits) {
  const b = BigInt(bits)
  if (n >= 0n) return n < 1n << b ? n : null
  return n >= -(1n << (b - 1n)) ? (1n << b) + n : null
}
export const fromTwos = (pattern, bits) => { const b = BigInt(bits); return pattern >= 1n << (b - 1n) ? pattern - (1n << b) : pattern }
const fitsSigned = (n, bits) => n >= -(1n << BigInt(bits - 1)) && n < 1n << BigInt(bits - 1)
const fitsUnsigned = (n, bits) => n >= 0n && n < 1n << BigInt(bits)

const group = (s, n, sep = ' ') => { const out = []; for (let i = s.length; i > 0; i -= n) out.unshift(s.slice(Math.max(0, i - n), i)); return out.join(sep) }

const STYLE = `
.t-nb .nb-big { font-family: var(--mono); font-size: clamp(22px, 4.4vw, 34px); font-weight: 650; letter-spacing: -.02em; overflow-wrap: anywhere; line-height: 1.2; }
.t-nb .nb-bits { display: grid; gap: 10px; }
.t-nb .nb-byte { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 4px; }
.t-nb .nb-bytes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 12px; }
.t-nb .nb-bit { display: grid; justify-items: center; gap: 2px; padding: 0; border: 0; background: none; cursor: pointer; color: var(--text); min-width: 0; }
.t-nb .nb-bit b { width: 100%; min-height: 36px; display: grid; place-items: center; border-radius: 9px; font-family: var(--mono); font-size: 15px; font-weight: 600; border: 1px solid var(--border); background: var(--surface-2); transition: background .15s, color .15s, transform .2s var(--spring), border-color .15s; }
.t-nb .nb-bit:hover b { border-color: var(--accent); transform: translateY(-1px); }
.t-nb .nb-bit[aria-pressed="true"] b { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.t-nb .nb-bit i { font-style: normal; font-size: 10px; color: var(--muted); font-family: var(--mono); }
.t-nb .nb-bit:focus-visible b { outline: 2px solid var(--accent); outline-offset: 2px; }
.t-nb .nb-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: 8px; }
`

const COMMON = [[10, 'Decimal'], [16, 'Hex'], [2, 'Binary'], [8, 'Octal']]
const EXAMPLES = [['255', 10], ['0xDEADBEEF', 16], ['-42', 10], ['11111111', 2], ['zz', 36], ['340282366920938463463374607431768211455', 10]]

export function mount(root) {
  useKit()
  css('t-nb-css', STYLE)
  const q = hashParams()
  let base = [2, 8, 10, 16].includes(+q.get('base')) || (+q.get('base') >= 2 && +q.get('base') <= 36) ? +q.get('base') : 10
  let width = 32
  let parsed = null

  const inp = input({ mono: true, value: q.get('v') || '255', placeholder: 'Enter a number, e.g. 255, 0xFF or -42', 'aria-label': 'Number to convert', spellcheck: false, autocomplete: 'off', autocapitalize: 'off', oninput: () => run() })
  inp.style.cssText = 'font-size:18px;height:52px'
  const baseChips = chips([...COMMON.map(([b, l]) => [b, `${l} (${b})`]), ['other', 'Other...']], { value: [2, 8, 10, 16].includes(base) ? base : 'other', ariaLabel: 'Input base', onChange: (v) => { if (v === 'other') { otherSel.hidden = false; base = +otherSel.value } else { otherSel.hidden = true; base = v } run() } })
  const otherSel = select(Array.from({ length: 35 }, (_, i) => [i + 2, `Base ${i + 2}`]), base, (v) => { base = +v; run() })
  otherSel.hidden = [2, 8, 10, 16].includes(base)
  otherSel.style.cssText = 'width:auto;min-width:130px;height:34px'
  otherSel.setAttribute('aria-label', 'Custom input base')
  const upper = toggle('UPPERCASE digits', true, () => run())
  const grp = toggle('Group digits', true, () => run())
  const pre = toggle('Show 0x / 0b / 0o prefix', false, () => run())
  const status = h('div', { class: 'row', style: 'min-height:28px' })
  const err = h('div')
  const rows = h('div', { class: 'nb-row' })
  const custom = select(Array.from({ length: 35 }, (_, i) => [i + 2, `Base ${i + 2}`]), 32, () => run())
  custom.setAttribute('aria-label', 'Extra output base')
  custom.style.cssText = 'width:auto;min-width:130px;height:34px'
  const rowPlain = {}
  const extraRow = copyRow('BASE 32', () => rowPlain.extra, { initial: '' })
  const infoEl = h('div')
  const widthSeg = segmented([[8, '8'], [16, '16'], [32, '32'], [64, '64'], [128, '128']], width, (v) => { width = v; run() }, 'Bit width')
  const widthTable = h('div')
  const bitsEl = h('div', { class: 'nb-bits' })
  const bitNote = h('div', { class: 'small muted' })

  const rowRefs = {}
  const mk = (key, label) => (rowRefs[key] = copyRow(label, () => rowPlain[key], { initial: '' }))
  const rBin = mk(2, 'BIN'), rOct = mk(8, 'OCT'), rDec = mk(10, 'DEC'), rHex = mk(16, 'HEX')

  function fmt(n, b) {
    const neg = n < 0n
    const abs = neg ? -n : n
    let s = toBase(abs, b, upper.input.checked)
    if (grp.input.checked) s = group(s, b === 2 ? 4 : b === 16 ? 4 : b === 10 ? 3 : b === 8 ? 3 : 4, b === 10 ? ',' : ' ')
    const p = pre.input.checked ? { 2: '0b', 8: '0o', 16: '0x' }[b] || '' : ''
    return `${neg ? '-' : ''}${p}${s}`
  }
  // plain (no spaces) copy value
  const plain = (n, b) => `${n < 0n ? '-' : ''}${pre.input.checked ? { 2: '0b', 8: '0o', 16: '0x' }[b] || '' : ''}${toBase(n < 0n ? -n : n, b, upper.input.checked)}`
  const setRow = (r, n, b) => { r.set(fmt(n, b)); rowPlain[b] = plain(n, b) }

  function run() {
    clear(status); clear(err)
    const text = inp.value
    inp.classList.remove('invalid')
    if (!text.trim()) { parsed = null; for (const r of [rBin, rOct, rDec, rHex, extraRow]) r.set(''); clear(infoEl); clear(widthTable); clear(bitsEl); bitNote.textContent = ''; clear(status, pill('', 'info', 'Type a number to convert')); return }
    try { parsed = parseBig(text, base) } catch (e) {
      parsed = null
      inp.classList.add('invalid')
      for (const r of [rBin, rOct, rDec, rHex, extraRow]) r.set('')
      clear(infoEl); clear(widthTable); clear(bitsEl)
      clear(status, pill('bad', 'circle-alert', 'Cannot read this number'))
      clear(err, alert('error', e.message))
      return
    }
    const n = parsed.value
    clear(status, pill('ok', 'check', `Read as base ${parsed.base}`), parsed.fromPrefix ? pill('info', 'wand-sparkles', 'Base taken from the prefix') : null)
    setRow(rBin, n, 2); setRow(rOct, n, 8); setRow(rDec, n, 10); setRow(rHex, n, 16)
    const cb = +custom.value
    rowPlain.extra = `${n < 0n ? '-' : ''}${toBase(n < 0n ? -n : n, cb, upper.input.checked)}`
    extraRow.set(rowPlain.extra)
    extraRow.querySelector('.k').textContent = `BASE ${cb}`
    const bl = bitLength(n)
    clear(infoEl, stats([
      { label: 'Bit length', value: formatNumber(bl, 0), hint: n < 0n ? 'of the magnitude' : 'bits needed', accent: true },
      { label: 'Bytes', value: formatNumber(Math.max(1, Math.ceil(bl / 8)), 0), hint: 'unsigned size' },
      { label: 'Ones', value: formatNumber(popcount(n), 0), hint: 'set bits' },
      { label: 'Decimal digits', value: formatNumber(n.toString().replace('-', '').length, 0) },
      { label: 'Power of two', value: n > 0n && (n & (n - 1n)) === 0n ? `2^${bl - 1}` : 'No' },
      { label: 'Parity', value: n % 2n === 0n ? 'Even' : 'Odd' },
    ]))
    renderWidths(n)
    renderBits(n)
  }

  function renderWidths(n) {
    const widths = [8, 16, 32, 64, 128]
    clear(widthTable, table({ columns: ['Width', 'Signed (two’s complement)', 'Unsigned', 'Hex pattern'], rows: widths.map((w) => {
      const fs = fitsSigned(n, w), fu = fitsUnsigned(n, w)
      const pat = twosPattern(n, w)
      return [`${w}-bit`, fs ? n.toString() : h('span', { class: 'muted' }, 'does not fit'), fu ? n.toString() : n < 0n && pat != null ? pat.toString() : h('span', { class: 'muted' }, 'does not fit'),
        pat != null ? `0x${pat.toString(16).toUpperCase().padStart(w / 4, '0')}` : h('span', { class: 'muted' }, '-')]
    }) }), h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Negative numbers are stored as two’s complement: invert every bit and add one. For example -1 is all ones.'))
  }

  function renderBits(n) {
    const pat = twosPattern(n, width)
    if (pat == null) {
      clear(bitsEl, alert('warn', `${n.toString()} needs more than ${width} bits${n < 0n ? ' (as a signed value)' : ''}. Pick a wider size to see its bits.`))
      bitNote.textContent = ''
      return
    }
    const bin = pat.toString(2).padStart(width, '0')
    const bytes = []
    for (let i = 0; i < width; i += 8) bytes.push(bin.slice(i, i + 8))
    clear(bitsEl, h('div', { class: 'nb-bytes' }, bytes.map((byte, bi) => h('div', { class: 'stack tight' },
      h('div', { class: 'small muted' }, `Byte ${bytes.length - bi - 1}  ${'0x' + parseInt(byte, 2).toString(16).toUpperCase().padStart(2, '0')}`),
      h('div', { class: 'nb-byte' }, [...byte].map((bit, k) => {
        const idx = width - 1 - (bi * 8 + k)
        return h('button', { type: 'button', class: 'nb-bit', 'aria-pressed': String(bit === '1'), 'aria-label': `Bit ${idx}, ${bit}`, onclick: () => flip(idx, pat) }, h('b', bit), h('i', idx))
      }))))))
    bitNote.textContent = n < 0n || pat >= 1n << BigInt(width - 1) ? `Shown as a ${width}-bit pattern. Read as signed it is ${fromTwos(pat, width)}, as unsigned ${pat}.` : `Shown as a ${width}-bit pattern.`
  }
  function flip(idx, pat) {
    const np = pat ^ (1n << BigInt(idx))
    // keep the sign the user had: negative numbers stay signed
    const signed = parsed.value < 0n
    const v = signed ? fromTwos(np, width) : np
    inp.value = v.toString()
    base = 10
    baseChips.set(10)
    otherSel.hidden = true
    run()
  }

  const examples = h('div', { class: 'dv-chips' }, EXAMPLES.map(([v, b]) => h('button', { type: 'button', class: 'dv-chip mono', onclick: () => { inp.value = v; base = b; if ([2, 8, 10, 16].includes(b)) { baseChips.set(b); otherSel.hidden = true } else { baseChips.set('other'); otherSel.hidden = false; otherSel.value = b } run() } }, v.length > 16 ? v.slice(0, 14) + '...' : v)))

  root.append(h('div', { class: 'dv t-nb stack' },
    h('div', { class: 'panel stack' }, eyebrow('binary', 'Number'), inp, h('div', { class: 'row' }, baseChips, otherSel), status, err, h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Try:'), examples)),
    h('div', { class: 'panel stack' }, h('div', { class: 'row between' }, eyebrow('arrow-right-left', 'Result'), h('div', { class: 'row' }, upper, grp, pre)),
      h('div', { class: 'nb-row' }, rDec, rHex, rBin, rOct), h('div', { class: 'row' }, extraRow, custom), infoEl),
    h('div', { class: 'panel stack' }, h('div', { class: 'row between' }, eyebrow('table-2', 'Fixed-width views'), h('span', { class: 'small muted' }, 'two’s complement')), widthTable),
    h('div', { class: 'panel stack' }, h('div', { class: 'row between' }, eyebrow('toggle-left', 'Bit view (click a bit to flip it)'), h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Width'), widthSeg)), bitsEl, bitNote),
    h('p', { class: 'small muted' }, 'Numbers can be as long as you like: conversion uses arbitrary-precision integers. Prefixes 0x, 0b and 0o are recognised, and underscores, spaces and commas are ignored.')))
  run()
}
