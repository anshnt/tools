// Number to words: international (million, billion) and Indian (lakh, crore) systems, currency with paise/cents, cheque style.
// Amounts are handled as digit strings and BigInt, so nothing is rounded by floating point.
import { h, icon, button, field, input, segmented, select, toggle, clear, copyText, alert } from '../../lib/ui.js'
import { useStyles, addStyles, settleOnce } from './_kit.js'
import { load, save } from '../../lib/store.js'
import { fmtDate, today } from './_dates.js'

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion', 'sextillion', 'septillion', 'octillion', 'nonillion', 'decillion']
export const MAX_DIGITS = 36

export const CURRENCIES = {
  INR: { name: 'Indian rupee', sym: '₹', major: ['rupee', 'rupees'], minor: ['paisa', 'paise'], system: 'in', locale: 'en-IN' },
  USD: { name: 'US dollar', sym: '$', major: ['dollar', 'dollars'], minor: ['cent', 'cents'], system: 'intl', locale: 'en-US' },
  EUR: { name: 'Euro', sym: '€', major: ['euro', 'euros'], minor: ['cent', 'cents'], system: 'intl', locale: 'en-IE' },
  GBP: { name: 'British pound', sym: '£', major: ['pound', 'pounds'], minor: ['penny', 'pence'], system: 'intl', locale: 'en-GB' },
  AED: { name: 'UAE dirham', sym: 'AED ', major: ['dirham', 'dirhams'], minor: ['fils', 'fils'], system: 'intl', locale: 'en-AE' },
  SGD: { name: 'Singapore dollar', sym: 'S$', major: ['dollar', 'dollars'], minor: ['cent', 'cents'], system: 'intl', locale: 'en-SG' },
  CAD: { name: 'Canadian dollar', sym: 'C$', major: ['dollar', 'dollars'], minor: ['cent', 'cents'], system: 'intl', locale: 'en-CA' },
  AUD: { name: 'Australian dollar', sym: 'A$', major: ['dollar', 'dollars'], minor: ['cent', 'cents'], system: 'intl', locale: 'en-AU' },
  JPY: { name: 'Japanese yen', sym: '¥', major: ['yen', 'yen'], minor: null, system: 'intl', locale: 'ja-JP' },
}

/** 0..99 in words. */
function below100(n, hyphen) {
  if (n < 20) return ONES[n]
  const t = TENS[Math.floor(n / 10)], o = n % 10
  return o ? `${t}${hyphen ? '-' : ' '}${ONES[o]}` : t
}
/** 1..999 in words. `and` adds "and" after the hundreds (British style). */
function below1000(n, { and, hyphen }) {
  const hh = Math.floor(n / 100), r = n % 100
  const parts = []
  if (hh) parts.push(`${ONES[hh]} hundred`)
  if (r) parts.push((hh && and ? 'and ' : '') + below100(r, hyphen))
  return parts.join(' ')
}

/** A non-negative BigInt in words. system: 'intl' (thousand, million...) or 'in' (thousand, lakh, crore). */
export function intWords(n, system = 'intl', opts = {}) {
  const o = { and: false, hyphen: true, ...opts }
  if (n === 0n) return 'zero'
  if (system === 'in') {
    const crore = n / 10_000_000n, rest = Number(n % 10_000_000n)
    const parts = []
    if (crore) parts.push(`${intWords(crore, 'in', o)} crore`)
    const lakh = Math.floor(rest / 100_000), thou = Math.floor((rest % 100_000) / 1000), low = rest % 1000
    if (lakh) parts.push(`${below100(lakh, o.hyphen)} lakh`)
    if (thou) parts.push(`${below100(thou, o.hyphen)} thousand`)
    if (low) parts.push((o.and && parts.length && low < 100 ? 'and ' : '') + below1000(low, o))
    return parts.join(' ')
  }
  const groups = []
  for (let x = n; x > 0n; x /= 1000n) groups.push(Number(x % 1000n))
  const out = []
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue
    const w = below1000(groups[i], { ...o, and: o.and })
    out.push(SCALES[i] ? `${w} ${SCALES[i]}` : (o.and && out.length && groups[i] < 100 ? `and ${w}` : w))
  }
  return out.join(' ')
}

const SUFFIX = { k: 3, thousand: 3, lakh: 5, lac: 5, lakhs: 5, lacs: 5, crore: 7, crores: 7, cr: 7, m: 6, mn: 6, million: 6, b: 9, bn: 9, billion: 9 }
/**
 * Read what someone typed: "1,23,456.78", "-45", "2.5 lakh", "3 crore", "1.2m". Returns {neg, int, frac, notes} or {error}.
 * int and frac are digit strings with the multiplier already applied.
 */
export function parseAmount(text) {
  let s = String(text ?? '').trim().toLowerCase().replace(/(?<=\d)[ 	]+(?=\d)/g, '').replace(/[₹$€£,_\s]/g, (c) => (c === ' ' ? ' ' : '')).replace(/rs\.?/g, '')
  if (!s) return { empty: true }
  let neg = false
  if (s[0] === '-' || s[0] === '−') { neg = true; s = s.slice(1) } else if (s[0] === '+') s = s.slice(1)
  const m = /^(\d*)(?:\.(\d*))?\s*([a-z]*)$/.exec(s.trim())
  if (!m || (!m[1] && !m[2])) return { error: 'Type digits only, like 1234.50 (commas are fine), or 2.5 lakh.' }
  let [, int, frac = '', suf] = m
  let shift = 0
  if (suf) {
    if (!(suf in SUFFIX)) return { error: `"${suf}" is not a size word I know. Try lakh, crore, thousand, million or billion.` }
    shift = SUFFIX[suf]
  }
  if (shift) { frac = frac.padEnd(shift, '0'); int += frac.slice(0, shift); frac = frac.slice(shift) }
  int = int.replace(/^0+(?=\d)/, '') || '0'
  frac = frac.replace(/0+$/, '')
  if (int.length > MAX_DIGITS) return { error: `That has ${int.length} digits. The limit is ${MAX_DIGITS}.` }
  return { neg, int, frac }
}

/** Group digits: system 'in' -> 12,34,56,789 ; 'intl' -> 123,456,789. */
export function groupDigits(int, system) {
  const last3 = int.slice(-3), rest = int.slice(0, -3)
  if (int.length <= 3) return int
  return (system === 'in' ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') : rest.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) + ',' + last3
}

const cap = (w) => w.replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
function applyCase(text, mode) {
  if (mode === 'upper') return text.toUpperCase()
  if (mode === 'lower') return text
  if (mode === 'title') return cap(text).replace(/ And /g, ' and ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Everything the tool shows: { words, groups, formatted, notes, error }.
 * opts: system 'in'|'intl', mode 'plain'|'currency', currency 'INR'..., cheque boolean, and, hyphen, casing 'sentence'|'title'|'upper'|'lower'.
 */
export function toWords(text, opts = {}) {
  const o = { system: 'intl', mode: 'plain', currency: 'INR', cheque: false, and: false, hyphen: true, casing: 'sentence', ...opts }
  const p = parseAmount(text)
  if (p.empty) return { empty: true }
  if (p.error) return { error: p.error }
  const notes = []
  const sys = o.system
  const wo = { and: o.and, hyphen: o.hyphen }
  let words, formattedInt = groupDigits(p.int, sys), frac = p.frac
  if (o.mode === 'currency') {
    const C = CURRENCIES[o.currency]
    if (p.neg) return { error: 'A cheque or invoice amount cannot be negative.' }
    let major = BigInt(p.int), minor = 0n
    if (C.minor) {
      let cents = BigInt(p.int) * 100n + BigInt((p.frac + '00').slice(0, 2))
      if (p.frac.length > 2) { if (p.frac[2] >= '5') cents += 1n; notes.push(`Rounded to 2 decimal places (${p.int}.${p.frac}).`) }
      major = cents / 100n; minor = cents % 100n
      frac = String(minor).padStart(2, '0')
      formattedInt = groupDigits(String(major), sys)
    } else if (p.frac) { if (p.frac[0] >= '5') major += 1n; notes.push(`${C.name}s have no minor unit, so the amount was rounded to a whole number.`); frac = ''; formattedInt = groupDigits(String(major), sys) }
    const mw = intWords(major, sys, wo)
    const mu = C.major[major === 1n ? 0 : 1]
    let text2
    if (o.cheque) {
      text2 = `${C.major[1]} ${mw}`
      if (minor) text2 += ` and ${C.minor[1]} ${intWords(minor, sys, wo)}`
      text2 += ' only'
    } else {
      const parts = []
      if (major > 0n || !minor) parts.push(`${mw} ${mu}`)
      if (minor) parts.push(`${intWords(minor, sys, wo)} ${C.minor[minor === 1n ? 0 : 1]}`)
      text2 = parts.join(' and ')
    }
    words = text2
  } else {
    words = (p.neg ? 'minus ' : '') + intWords(BigInt(p.int), sys, wo)
    if (frac) words += ` point ${[...frac].map((d) => ONES[+d]).join(' ')}`
  }
  const digits = p.int === '0' ? [] : p.int
  const gl = sys === 'in' ? ['', 'thousand', 'lakh', 'crore', 'lakh crore', 'crore crore'] : SCALES
  const groups = []
  const gstr = groupDigits(p.int, sys).split(',')
  for (let i = 0; i < gstr.length; i++) groups.push({ digits: gstr[i], name: gl[gstr.length - 1 - i] || '' })
  return { words: applyCase(words, o.casing), groups: digits.length ? groups : [{ digits: '0', name: '' }], formatted: `${p.neg ? '-' : ''}${formattedInt}${frac ? '.' + frac : ''}`, notes, neg: p.neg }
}

const CSS = `
.ct-ntw-out { font-size: clamp(22px, 4.2vw, 34px); font-weight: 650; letter-spacing: -.03em; line-height: 1.22; margin-top: 8px; overflow-wrap: anywhere; text-wrap: balance; }
.ct-ntw-in { height: 64px !important; font-size: clamp(22px, 4vw, 32px); font-weight: 600; letter-spacing: -.02em; font-variant-numeric: tabular-nums; border-radius: 18px; }
.ct-grp { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.ct-grp .g { display: flex; flex-direction: column; align-items: center; gap: 4px; animation: ctPop .45s var(--spring) both; animation-delay: calc(var(--i, 0) * 45ms); }
.ct-grp .g b { font-family: var(--mono); font-size: clamp(17px, 3vw, 24px); font-weight: 600; padding: 6px 12px; border-radius: 12px; background: color-mix(in srgb, var(--c) 12%, var(--surface)); border: 1px solid color-mix(in srgb, var(--c) 25%, var(--border)); letter-spacing: .02em; }
.ct-grp .g span { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; min-height: 14px; }
.ct-cheque { position: relative; overflow: hidden; border-radius: 16px; padding: 18px 20px 16px; color: #1f2937; border: 1px solid #b6d4c9;
  background: repeating-linear-gradient(115deg, rgba(23, 128, 96, .05) 0 2px, transparent 2px 9px), linear-gradient(135deg, #e9f7f1, #dff0f7 55%, #eef6e9); box-shadow: 0 18px 36px -22px rgba(23, 128, 96, .55); }
.ct-cheque .row1 { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: #3f6659; letter-spacing: .08em; text-transform: uppercase; font-weight: 700; flex-wrap: wrap; }
.ct-cheque .pay { margin-top: 14px; display: flex; gap: 8px; align-items: baseline; font-size: 13px; color: #3f6659; }
.ct-cheque .pay i { flex: 1; border-bottom: 1px dashed #7aa596; height: 1px; transform: translateY(-3px); }
.ct-cheque .words { margin-top: 12px; min-height: 52px; font-family: "Brush Script MT", "Segoe Script", cursive, serif; font-size: clamp(17px, 2.6vw, 22px); line-height: 1.35; color: #14343f; border-bottom: 1px solid #7aa596; padding-bottom: 6px; overflow-wrap: anywhere; }
.ct-cheque .low { margin-top: 12px; display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.ct-cheque .box { font-family: var(--mono); font-weight: 700; font-size: clamp(15px, 2.4vw, 20px); padding: 6px 14px; border: 2px solid #3f6659; border-radius: 6px; background: rgba(255, 255, 255, .6); overflow-wrap: anywhere; }
.ct-cheque .sig { font-size: 11px; color: #3f6659; border-top: 1px solid #7aa596; padding-top: 3px; min-width: 120px; text-align: center; }
`

export function mount(root) {
  useStyles()
  addStyles('ct-ntw', CSS)
  const o = load('ntw:opts', { system: 'intl', mode: 'plain', currency: 'INR', cheque: true, and: false, hyphen: true, casing: 'sentence' })
  const inp = input({ class: 'ct-ntw-in', placeholder: 'Type a number, like 1,23,456.78 or 2.5 lakh', value: load('ntw:text', '125000.50'), inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Number or amount' })
  inp.addEventListener('input', () => render())

  const sysSeg = segmented([['intl', 'International'], ['in', 'Indian (lakh, crore)']], o.system, (v) => { o.system = v; render() }, 'Numbering system')
  const modeSeg = segmented([['plain', 'Plain number'], ['currency', 'Currency']], o.mode, (v) => { o.mode = v; if (v === 'currency') { o.system = CURRENCIES[o.currency].system; sysSeg.set(o.system) } render() }, 'Mode')
  const curSel = select(Object.entries(CURRENCIES).map(([k, c]) => [k, `${k} - ${c.name}`]), o.currency, (v) => { o.currency = v; o.system = CURRENCIES[v].system; sysSeg.set(o.system); render() })
  const styleSeg = segmented([['cheque', 'Cheque style'], ['plain', 'Sentence']], o.cheque ? 'cheque' : 'plain', (v) => { o.cheque = v === 'cheque'; render() }, 'Currency wording')
  const caseSel = select([['sentence', 'Sentence case'], ['title', 'Title Case'], ['upper', 'UPPER CASE'], ['lower', 'lower case']], o.casing, (v) => { o.casing = v; render() })
  const andT = toggle('Say "and" (one hundred and five)', o.and, (v) => { o.and = v; render() })
  const hyT = toggle('Hyphenate (twenty-one)', o.hyphen, (v) => { o.hyphen = v; render() })
  const currencyBox = h('div', { class: 'ct-fields' }, field('Currency', curSel), field('Wording', styleSeg))

  const kicker = h('div', { class: 'ct-kicker' })
  const out = h('div', { class: 'ct-ntw-out', 'aria-live': 'polite' })
  const num = h('div', { class: 'ct-lede', style: 'font-variant-numeric:tabular-nums' })
  let current = ''
  const copyBtn = button('Copy words', { icon: 'copy', size: 'sm', onClick: () => copyText(current) })
  const copyNum = button('Copy number', { icon: 'hash', size: 'sm', onClick: () => copyText(num.dataset.v || '') })
  const hero = h('section', { class: 'ct-hero' }, h('i', { class: 'ct-dots' }), kicker, out, num, h('div', { class: 'ct-actions' }, copyBtn, copyNum))
  const grp = h('div', { class: 'ct-grp' })
  const grpPanel = h('section', { class: 'panel stack' }, h('div', { class: 'ct-h' }, icon('blocks'), 'Digit groups'), grp)
  const chequeWords = h('div', { class: 'words' }), chequeBox = h('div', { class: 'box' }), chequeDate = h('span')
  const cheque = h('section', { class: 'ct-cheque', 'aria-hidden': 'true' }, h('div', { class: 'row1' }, h('span', 'Sample cheque'), chequeDate), h('div', { class: 'pay' }, 'Pay', h('i'), 'or bearer'),
    chequeWords, h('div', { class: 'low' }, chequeBox, h('div', { class: 'sig' }, 'Authorised signature')))
  const warn = h('div')
  const notes = h('div')
  const results = h('div', { class: 'ct' }, hero, notes, grpPanel, cheque)

  function render() {
    save('ntw:text', inp.value.length < 200 ? inp.value : ''); save('ntw:opts', o)
    currencyBox.hidden = o.mode !== 'currency'
    const r = toWords(inp.value, o)
    if (r.empty) { results.hidden = true; clear(warn, alert('info', 'Type a number to see it in words. Try 1250000 or 2.5 lakh.')); return }
    if (r.error) { results.hidden = true; clear(warn, alert('warn', r.error)); return }
    clear(warn); results.hidden = false; settleOnce(results)
    const C = CURRENCIES[o.currency]
    current = r.words
    kicker.textContent = o.mode === 'currency' ? `${C.name} in words` : o.system === 'in' ? 'In words (Indian system)' : 'In words (international system)'
    out.textContent = r.words
    const shown = o.mode === 'currency' ? `${C.sym}${r.formatted}` : r.formatted
    num.textContent = shown
    num.dataset.v = r.formatted
    clear(notes, r.notes.map((n) => alert('info', n)))
    clear(grp, r.groups.map((g, i) => h('div', { class: 'g', style: { '--i': i } }, h('b', g.digits), h('span', g.name))))
    cheque.hidden = !(o.mode === 'currency' && o.cheque)
    chequeWords.textContent = applyCase(r.words, 'title')
    chequeBox.textContent = `${C.sym.trim()} ${r.formatted}/-`
    chequeDate.textContent = fmtDate(today(), { day: 'numeric', month: 'short', year: 'numeric' })
  }

  root.append(h('div', { class: 'ct' },
    h('section', { class: 'panel stack' },
      field('Number or amount', inp, 'Commas, rupee and dollar signs are fine. Shortcuts: 2.5 lakh, 3 crore, 1.2 million.'),
      h('div', { class: 'ct-fields' }, field('Mode', modeSeg), field('Numbering', sysSeg), field('Letters', caseSel)),
      currencyBox,
      h('div', { class: 'row' }, andT, hyT)),
    warn, results))
  curSel.value = o.currency
  currencyBox.hidden = o.mode !== 'currency'
  render()
}
