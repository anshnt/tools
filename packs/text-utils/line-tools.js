// Line tools: one module, thirteen focused tools. params.op picks which one (dedupe, sort, number, ...).
// Every op is a pure function (text, options) -> {text, badges, note, extra}, so the logic is testable without a DOM.
import { h, copyText } from '../../lib/ui.js'
import { studio, createOptions, group, chips, chipButton, quick, splitLines, joinLines, plural, stripInvisible } from './_shared.js'

// ---------- helpers ----------
const isBlank = (l) => l.trim() === ''
const cmpCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const fold = (s) => s.toLowerCase()

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
export function toRoman(n) {
  let s = ''
  for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v }
  return s
}
const ROMAN_RE = /^(?=[MDCLXVI])M*(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/
export const isRoman = (s) => ROMAN_RE.test(s.toUpperCase())
/** 1 -> a, 26 -> z, 27 -> aa */
export function toAlpha(n) {
  let s = ''
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) }
  return s
}

let segmenter
function graphemes(s) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    segmenter ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return [...segmenter.segment(s)].map((x) => x.segment)
  }
  return [...s]
}
export const reverseChars = (s) => graphemes(s).reverse().join('')

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export function shuffle(arr, seed) {
  const rnd = mulberry32(seed)
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}


// ---------- the ops ----------
export const OPS = {
  dedupe: {
    title: ['Your lines', 'Unique lines'], file: 'unique-lines.txt', mono: true,
    placeholder: 'Paste your list here, one item per line...',
    sample: 'apple\nbanana\nApple\ncherry\nbanana\n  cherry  \ndate\napple\nelderberry\nDate',
    defaults: { ignoreCase: true, trim: true, keepEmpty: false, mode: 'first' },
    run(text, o) {
      const { lines, final } = splitLines(text)
      const keyOf = (l) => { let k = o.trim ? l.trim() : l; if (o.ignoreCase) k = fold(k); return k }
      const skip = (l) => o.keepEmpty && isBlank(l)
      const counts = new Map()
      for (const l of lines) if (!skip(l)) counts.set(keyOf(l), (counts.get(keyOf(l)) || 0) + 1)
      let kept = []
      if (o.mode === 'first' || o.mode === 'last') {
        const seen = new Set()
        const order = o.mode === 'last' ? [...lines].reverse() : lines
        for (const l of order) {
          if (skip(l)) { kept.push(l); continue }
          const k = keyOf(l)
          if (!seen.has(k)) { seen.add(k); kept.push(l) }
        }
        if (o.mode === 'last') kept.reverse()
      } else if (o.mode === 'unique') {
        kept = lines.filter((l) => skip(l) || counts.get(keyOf(l)) === 1)
      } else {
        const seen = new Set()
        for (const l of lines) {
          if (skip(l)) continue
          const k = keyOf(l)
          if (counts.get(k) > 1 && !seen.has(k)) { seen.add(k); kept.push(l) }
        }
      }
      const removed = lines.length - kept.length
      const dupGroups = [...counts.values()].filter((c) => c > 1).length
      const repeated = []
      const shown = new Set()
      for (const l of lines) {
        if (skip(l)) continue
        const k = keyOf(l)
        const c = counts.get(k)
        if (c > 1 && !shown.has(k)) { shown.add(k); repeated.push([o.trim ? l.trim() : l, c]) }
      }
      repeated.sort((a, b) => b[1] - a[1])
      const badges = o.mode === 'dupes'
        ? [{ label: 'lines checked', value: lines.length }, { label: dupGroups === 1 ? 'line repeats' : 'lines repeat', value: dupGroups, tone: dupGroups ? 'warn' : 'good' }]
        : [{ label: 'lines in', value: lines.length }, { label: 'lines kept', value: kept.length, tone: 'accent' }, { label: 'removed', value: removed, tone: removed ? 'good' : '' }]
      return {
        text: joinLines(kept, final), badges, repeated,
        note: !removed && o.mode !== 'dupes' && lines.length ? 'No duplicates found. Your list was already unique.' : '',
        extra: repeated.length ? { title: 'Most repeated lines', tokens: repeated.slice(0, 16) } : null,
      }
    },
  },

  'remove-empty': {
    title: ['Your text', 'Without empty lines'], file: 'no-empty-lines.txt', mono: false,
    sample: 'Dear team,\n\n\n\nThe launch is on Friday.\n   \nPlease review the notes.\n\n\nThanks,\nAsha\n',
    defaults: { mode: 'all', whitespace: true },
    run(text, o) {
      const { lines, final } = splitLines(text)
      const empty = (l) => (o.whitespace ? isBlank(l) : l === '')
      let out
      if (o.mode === 'all') out = lines.filter((l) => !empty(l))
      else if (o.mode === 'collapse') { out = []; for (const l of lines) if (!(empty(l) && out.length && empty(out[out.length - 1]))) out.push(l) }
      else { let a = 0, b = lines.length; while (a < b && empty(lines[a])) a++; while (b > a && empty(lines[b - 1])) b--; out = lines.slice(a, b) }
      const removed = lines.length - out.length
      return { text: joinLines(out, final), badges: [{ label: 'lines in', value: lines.length }, { label: 'empty lines removed', value: removed, tone: removed ? 'good' : '' }, { label: 'lines left', value: out.length, tone: 'accent' }] }
    },
  },

  sort: {
    title: ['Your lines', 'Sorted lines'], file: 'sorted-lines.txt', mono: true,
    sample: 'banana\nCherry\napple\nitem 10\nitem 2\nDate\nitem 1\n42 apples\n7 plums\nelderberry',
    defaults: { method: 'az', dir: 'asc', caseSensitive: false, trim: false, dropEmpty: false, unique: false, seed: 1 },
    run(text, o) {
      let { lines, final } = splitLines(text)
      const inN = lines.length
      if (o.trim) lines = lines.map((l) => l.trim())
      let emptyRemoved = 0
      if (o.dropEmpty) { const n = lines.length; lines = lines.filter((l) => !isBlank(l)); emptyRemoved = n - lines.length }
      let dupRemoved = 0
      if (o.unique) {
        const seen = new Set(); const n = lines.length
        lines = lines.filter((l) => { const k = o.caseSensitive ? l : fold(l); if (seen.has(k)) return false; seen.add(k); return true })
        dupRemoved = n - lines.length
      }
      const alpha = o.caseSensitive ? cmpCode : new Intl.Collator(undefined, { sensitivity: 'accent' }).compare
      const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: o.caseSensitive ? 'variant' : 'accent' }).compare
      let out
      let note = ''
      const dirSign = o.dir === 'desc' ? -1 : 1
      const stable = (arr, cmp) => arr.map((v, i) => [v, i]).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map((x) => x[0])
      if (o.method === 'az') out = stable(lines, alpha)
      else if (o.method === 'za') out = stable(lines, (a, b) => alpha(b, a))
      else if (o.method === 'natural') out = stable(lines, (a, b) => dirSign * natural(a, b))
      else if (o.method === 'length') out = stable(lines, (a, b) => dirSign * ([...a].length - [...b].length))
      else if (o.method === 'numeric') {
        const num = (l) => { const m = l.match(/[-+]?\d[\d,]*(?:\.\d+)?|[-+]?\.\d+/); return m ? Number(m[0].replace(/,/g, '')) : null }
        const withNum = [], without = []
        for (const l of lines) { const k = num(l); if (k === null) without.push(l); else withNum.push({ l, k }) }
        withNum.sort((a, b) => dirSign * (a.k - b.k)) // Array.prototype.sort is stable
        out = [...withNum.map((x) => x.l), ...without]
        if (without.length && withNum.length) note = `${plural(without.length, 'line has', 'lines have')} no number, so they were put last.`
        else if (!withNum.length && lines.length) note = 'No numbers found in these lines, so nothing could be sorted numerically.'
      } else out = shuffle(lines, o.seed)
      const moved = out.reduce((n, l, i) => n + (l !== lines[i] ? 1 : 0), 0)
      const badges = [{ label: 'lines sorted', value: out.length, tone: 'accent' }, { label: 'moved', value: moved }]
      if (emptyRemoved) badges.push({ label: 'empty lines dropped', value: emptyRemoved, tone: 'good' })
      if (dupRemoved) badges.push({ label: 'duplicates removed', value: dupRemoved, tone: 'good' })
      if (inN === out.length && !moved && out.length > 1 && o.method !== 'random') note ||= 'Already in order.'
      return { text: joinLines(out, final), badges, note }
    },
  },

  reverse: {
    title: ['Your text', 'Reversed text'], file: 'reversed.txt', mono: false,
    sample: 'Hello, world!\nThe quick brown fox\njumps over the lazy dog',
    defaults: { mode: 'whole' },
    run(text, o) {
      const { lines, final } = splitLines(text)
      let out
      if (o.mode === 'whole') return { text: reverseChars(text), badges: [{ label: 'characters flipped', value: graphemes(text).length, tone: 'accent' }] }
      if (o.mode === 'each') out = lines.map(reverseChars)
      else if (o.mode === 'words') out = lines.map((l) => l.replace(/\S+/g, reverseChars))
      else if (o.mode === 'order') out = lines.map((l) => { const m = l.match(/^\s*/)[0]; return m + l.trim().split(/\s+/).filter(Boolean).reverse().join(' ') })
      else out = [...lines].reverse()
      const wordsN = (text.match(/\S+/g) || []).length
      return { text: joinLines(out, final), badges: o.mode === 'lines' ? [{ label: 'lines reversed', value: lines.length, tone: 'accent' }] : [{ label: 'lines', value: lines.length }, { label: 'words', value: wordsN, tone: 'accent' }] }
    },
  },

  prefix: {
    title: ['Your lines', 'Lines with prefix'], file: 'prefixed-lines.txt', mono: true,
    sample: 'Buy milk\nCall the bank\nBook flights\n\nSend the invoice',
    defaults: { text: '- ', skipEmpty: true, keepIndent: false },
    run(text, o) {
      const { lines, final } = splitLines(text)
      let changed = 0; let n = 0
      const out = lines.map((l) => {
        if (o.skipEmpty && isBlank(l)) return l
        changed++; n++
        const p = o.text.replace(/\{n\}/g, String(n))
        if (o.keepIndent) { const ind = l.match(/^\s*/)[0]; return ind + p + l.slice(ind.length) }
        return p + l
      })
      return { text: joinLines(out, final), badges: [{ label: 'lines', value: lines.length }, { label: 'prefixed', value: changed, tone: 'accent' }], note: o.text ? '' : 'Type a prefix above to see it applied.' }
    },
  },

  suffix: {
    title: ['Your lines', 'Lines with suffix'], file: 'suffixed-lines.txt', mono: true,
    sample: "'red',\n'green'\n'blue'\n\n'yellow'",
    defaults: { text: ',', skipEmpty: true, skipLast: false },
    run(text, o) {
      const { lines, final } = splitLines(text)
      let last = -1
      lines.forEach((l, i) => { if (!(o.skipEmpty && isBlank(l))) last = i })
      let changed = 0; let n = 0
      const out = lines.map((l, i) => {
        if (o.skipEmpty && isBlank(l)) return l
        n++
        if (o.skipLast && i === last) return l
        changed++
        return l + o.text.replace(/\{n\}/g, String(n))
      })
      return { text: joinLines(out, final), badges: [{ label: 'lines', value: lines.length }, { label: 'suffixed', value: changed, tone: 'accent' }], note: o.text ? '' : 'Type a suffix above to see it applied.' }
    },
  },

  number: {
    title: ['Your lines', 'Numbered lines'], file: 'numbered-lines.txt', mono: true,
    sample: 'Preheat the oven\nMix the flour and sugar\nAdd eggs and milk\n\nBake for 25 minutes\nLet it cool',
    defaults: { style: 'arabic', fmt: '{n}. ', custom: 'Step {n}: ', start: 1, step: 1, pad: 'none', skipEmpty: true },
    run(text, o) {
      const { lines, final } = splitLines(text)
      const list = []
      let cur = o.start
      for (const l of lines) { if (o.skipEmpty && isBlank(l)) list.push(null); else { list.push(cur); cur += o.step } }
      const nums = list.filter((x) => x !== null)
      const width = o.pad === 'auto' ? Math.max(0, ...nums.map((n) => String(Math.abs(n)).length)) : o.pad === 'none' ? 0 : Number(o.pad)
      const tpl = o.fmt === 'custom' ? (o.custom.includes('{n}') ? o.custom : `${o.custom}{n} `) : o.fmt
      const mark = (n) => {
        if (o.style === 'alpha' || o.style === 'ALPHA') { if (n < 1) return String(n); const s = toAlpha(n); return o.style === 'ALPHA' ? s.toUpperCase() : s }
        if (o.style === 'roman' || o.style === 'ROMAN') { if (n < 1 || n > 3999) return String(n); const s = toRoman(n); return o.style === 'roman' ? s.toLowerCase() : s }
        const sign = n < 0 ? '-' : ''
        return sign + String(Math.abs(n)).padStart(width, '0')
      }
      const out = lines.map((l, i) => (list[i] === null ? l : tpl.replace(/\{n\}/g, () => mark(list[i])) + l))
      return {
        text: joinLines(out, final),
        badges: [{ label: 'lines numbered', value: nums.length, tone: 'accent' }, ...(nums.length ? [{ label: 'last number', value: mark(nums[nums.length - 1]) }] : [])],
        note: o.fmt === 'custom' && !o.custom.includes('{n}') ? 'Add {n} to your custom format to choose where the number goes.' : '',
      }
    },
  },

  unnumber: {
    title: ['Numbered or bulleted lines', 'Clean lines'], file: 'clean-lines.txt', mono: true,
    sample: '1. Apples\n2) Bananas\n(3) Cherries\n[4] Dates\n#5 Figs\n- Grapes\n* Honeydew\n\u{2022} Kiwi\n- [x] Lemons\n10 - Mangoes',
    defaults: { numbers: true, bullets: true, checkboxes: true, quotes: false, letters: false, roman: false, indent: true },
    run(text, o) {
      const { lines, final } = splitLines(text)
      let changed = 0
      const bulletRe = /^[-*+\u{2022}\u{2023}\u{25e6}\u{25aa}\u{25ab}\u{25cf}\u{25cb}\u{25a0}\u{25a1}\u{27a4}\u{27a2}\u{2192}\u{2013}\u{2014}\u{b7}]\s+/u
      const out = lines.map((line) => {
        const ind = line.match(/^\s*/)[0]
        let r = line.slice(ind.length)
        const before = r
        if (o.quotes) r = r.replace(/^(?:>\s?)+/, '')
        if (o.bullets) r = r.replace(bulletRe, '')
        if (o.numbers) r = r.replace(/^(?:\(\d+\)|\[\d+\]|#\d+[.):]?|\d+(?:\.\d+)*[.):\]]|\d+(?:\.\d+){2,}|\d+\s+[-\u{2013}\u{2014}])(?=\s|$)\s*/u, '')
        if (o.letters) r = r.replace(/^(?:\([A-Za-z]\)|[A-Za-z][.)])(?=\s)\s*/, '')
        if (o.roman) r = r.replace(/^(?:\(([ivxlcdm]+)\)|([ivxlcdm]+)[.)])(?=\s)\s*/i, (m, a, b) => (isRoman(a || b) ? '' : m))
        if (o.checkboxes) r = r.replace(/^\[[ xX]?\]\s*/, '')
        if (r !== before) changed++
        return (o.indent ? ind : '') + r
      })
      return { text: joinLines(out, final), badges: [{ label: 'lines', value: lines.length }, { label: 'markers removed', value: changed, tone: changed ? 'good' : '' }], note: !changed && lines.length ? 'No markers found. Turn on more options above (letters, roman numerals, quotes).' : '' }
    },
  },

  join: {
    title: ['Your text', 'Result'], file: 'joined.txt', mono: true,
    sample: 'red\ngreen\nblue\n\nyellow',
    defaults: { mode: 'join', sep: ', ', customSep: '', wrap: 'none', brackets: 'none', trim: true, skipEmpty: true, unique: false, delim: ',', customDelim: '', unquote: true },
    run(text, o) {
      const WRAP = { none: ['', ''], dq: ['"', '"'], sq: ["'", "'"], bt: ['`', '`'] }
      const BR = { none: ['', ''], sq: ['[', ']'], rd: ['(', ')'], cu: ['{', '}'] }
      if (o.mode === 'join') {
        const { lines } = splitLines(text)
        let items = lines.map((l) => (o.trim ? l.trim() : l))
        if (o.skipEmpty) items = items.filter((l) => l !== '')
        const dup = items.length
        if (o.unique) items = [...new Set(items)]
        const [wa, wb] = WRAP[o.wrap]
        const [ba, bb] = BR[o.brackets]
        const sep = o.sep === 'custom' ? o.customSep : o.sep === '\\n' ? '\n' : o.sep === '\\t' ? '\t' : o.sep
        return { text: ba + items.map((x) => wa + x + wb).join(sep) + bb, badges: [{ label: 'lines joined into one', value: items.length, tone: 'accent' }, ...(o.unique && dup > items.length ? [{ label: 'duplicates dropped', value: dup - items.length, tone: 'good' }] : [])] }
      }
      const d = o.delim === 'custom' ? o.customDelim : o.delim === '\\t' ? '\t' : o.delim
      if (!d) return { text: '', badges: [], note: 'Enter a delimiter to split on.' }
      let items = text.split(d).flatMap((s) => s.split(/\r\n|\r|\n/))
      if (o.trim) items = items.map((s) => s.trim())
      if (o.unquote) items = items.map((s) => s.replace(/^(["'`])(.*)\1$/, '$2'))
      if (o.skipEmpty) items = items.filter((s) => s !== '')
      if (o.unique) items = [...new Set(items)]
      return { text: items.join('\n'), badges: [{ label: 'items', value: items.length, tone: 'accent' }] }
    },
  },

  'spaces-to-tabs': {
    title: ['Text with spaces', 'Text with tabs'], file: 'tabs.txt', mono: true,
    sample: 'function hello() {\n    if (ready) {\n        run()\n    }\n}\n\nName      Age   City\nAsha      31    Pune',
    defaults: { mode: 'indent', size: 4, minRun: 2 },
    run(text, o) {
      let n = 0
      const size = Math.max(1, o.size)
      const { lines, final } = splitLines(text)
      const out = lines.map((l) => {
        if (o.mode === 'indent') {
          const ind = l.match(/^[ \t]*/)[0]
          const visual = ind.replace(/\t/g, ' '.repeat(size))
          const tabs = Math.floor(visual.length / size)
          const rest = visual.length % size
          const next = '\t'.repeat(tabs) + ' '.repeat(rest)
          if (next !== ind) n += tabs - (ind.match(/\t/g) || []).length
          return next + l.slice(ind.length)
        }
        const re = new RegExp(`(?<=\\S) {${Math.max(1, o.minRun)},}(?=\\S)`, 'g')
        return l.replace(re, () => { n++; return '\t' })
      })
      return { text: joinLines(out, final), badges: [{ label: 'tabs inserted', value: Math.max(0, n), tone: n > 0 ? 'good' : '' }], note: !n && lines.length ? 'No runs of spaces matched. Try a smaller number.' : '' }
    },
  },

  'tabs-to-spaces': {
    title: ['Text with tabs', 'Text with spaces'], file: 'spaces.txt', mono: true,
    sample: 'function hello() {\n\tif (ready) {\n\t\trun()\n\t}\n}\n\nName\tAge\tCity\nAsha\t31\tPune',
    defaults: { size: 4, stops: false, leading: false },
    run(text, o) {
      const size = Math.max(1, o.size)
      let n = 0
      const { lines, final } = splitLines(text)
      const out = lines.map((l) => {
        if (!l.includes('\t')) return l
        if (o.leading) { const ind = l.match(/^[ \t]*/)[0]; n += (ind.match(/\t/g) || []).length; return ind.replace(/\t/g, ' '.repeat(size)) + l.slice(ind.length) }
        if (!o.stops) { n += (l.match(/\t/g) || []).length; return l.replace(/\t/g, ' '.repeat(size)) }
        let col = 0; let res = ''
        for (const ch of l) {
          if (ch === '\t') { const w = size - (col % size); res += ' '.repeat(w); col += w; n++ } else { res += ch; col++ }
        }
        return res
      })
      return { text: joinLines(out, final), badges: [{ label: 'tabs replaced', value: n, tone: n ? 'good' : '' }], note: !n && text ? 'No tab characters found in this text.' : '' }
    },
  },

  'remove-whitespace': {
    title: ['Your text', 'Cleaned text'], file: 'no-whitespace.txt', mono: false,
    sample: '   Hello,    world!   \n\n\n  This   text  has   messy\t\tspacing.  \n   And extra   blank lines.   ',
    defaults: { trimStart: true, trimEnd: true, collapse: true, removeSpaces: false, blank: false, oneLine: false, joinWith: 'space' },
    run(text, o) {
      const before = (text.match(/\s/g) || []).length
      let { lines, final } = splitLines(text)
      if (o.trimStart) lines = lines.map((l) => l.replace(/^[^\S\n]+/, ''))
      if (o.trimEnd) lines = lines.map((l) => l.replace(/[^\S\n]+$/, ''))
      if (o.collapse) lines = lines.map((l) => l.replace(/[ \t]{2,}/g, ' '))
      if (o.removeSpaces) lines = lines.map((l) => l.replace(/[^\S\n]+/g, ''))
      if (o.blank) lines = lines.filter((l) => !isBlank(l))
      let out
      if (o.oneLine) out = lines.filter((l) => !isBlank(l)).join(o.joinWith === 'space' ? ' ' : '')
      else out = joinLines(lines, final)
      const after = (out.match(/\s/g) || []).length
      return { text: out, badges: [{ label: 'whitespace characters', value: before }, { label: 'removed', value: Math.max(0, before - after), tone: before > after ? 'good' : '' }, { label: 'left', value: after, tone: 'accent' }] }
    },
  },

  normalize: {
    title: ['Messy text', 'Normalized text'], file: 'normalized.txt', mono: false,
    sample: 'Hello\u{a0}\u{a0}world,  this   has\u{200b} hidden\u{200d} characters.\r\n\r\n\r\n\r\nToo many blank lines above.   \r\nAnd a \u{2003} wide space.',
    defaults: { breaks: true, spaces: true, invisible: true, odd: true, trim: true, blank: true, nfc: false },
    run(text, o) {
      const stats = {}
      const sub = (key, re, to) => { text = text.replace(re, (...m) => { stats[key] = (stats[key] || 0) + 1; return typeof to === 'function' ? to(...m) : to }) }
      if (o.breaks) sub('line breaks fixed', /\r\n|\r|\u{2028}|\u{2029}|\u0085/gu, (m) => (m === '\r\n' ? '\n' : '\n'))
      if (o.invisible) { const [t, n] = stripInvisible(text); text = t; if (n) stats['invisible characters'] = n }
      if (o.odd) sub('odd spaces', /[\u{a0}\u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}]/gu, ' ')
      if (o.spaces) sub('repeated spaces', / {2,}/g, ' ')
      if (o.trim) sub('line ends trimmed', /[ \t]+$/gm, '')
      if (o.blank) sub('blank-line runs', /\n{3,}/g, '\n\n')
      if (o.nfc && text.normalize('NFC') !== text) { stats['accents recomposed'] = 1; text = text.normalize('NFC') }
      const total = Object.values(stats).reduce((a, b) => a + b, 0)
      const badges = [{ label: 'fixes', value: total, tone: total ? 'good' : '' }, ...Object.entries(stats).map(([label, value]) => ({ label, value }))]
      return { text, badges, note: !total ? 'Nothing to fix. This text is already clean.' : '' }
    },
  },
}

/** Run an op with default options merged in (used by tests). */
export const transform = (op, text, opts = {}) => OPS[op].run(text, { ...OPS[op].defaults, ...opts })

// ---------- UI ----------
const SEPS = [[', ', 'Comma + space'], [',', 'Comma'], [' ', 'Space'], [' | ', 'Pipe'], ['; ', 'Semicolon'], ['\\t', 'Tab'], ['', 'Nothing'], ['\\n', 'New line'], ['custom', 'Custom']]
const DELIMS = [[',', 'Comma'], [';', 'Semicolon'], ['|', 'Pipe'], ['\\t', 'Tab'], [' ', 'Space'], ['custom', 'Custom']]

function controlsFor(op, o, ui) {
  const bool = (k, label, title) => o.bool(k, label, title)
  switch (op) {
    case 'dedupe':
      return [
        group('Keep', o.pills('mode', [['first', 'First of each'], ['last', 'Last of each'], ['unique', 'Only never-repeated'], ['dupes', 'Show repeated only']], 'What to keep')),
        group('Compare', chips(bool('ignoreCase', 'Ignore capitals'), bool('trim', 'Ignore spaces at the ends'), bool('keepEmpty', 'Keep empty lines'))),
      ]
    case 'remove-empty':
      return [
        group('Mode', o.pills('mode', [['all', 'Remove all'], ['collapse', 'Keep one between paragraphs'], ['edges', 'Only at start and end']], 'Mode')),
        group('Options', chips(bool('whitespace', 'Treat spaces-only lines as empty'))),
      ]
    case 'sort': {
      const dir = group('Direction', o.pills('dir', [['asc', 'Ascending'], ['desc', 'Descending']], 'Direction'))
      const reroll = group('Random', chipButton('Shuffle again', () => { o.set({ seed: (Math.random() * 2 ** 31) | 0 }) }, 'shuffle'))
      o.show(dir, () => ['natural', 'numeric', 'length'].includes(o.v.method))
      o.show(reroll, () => o.v.method === 'random')
      return [
        group('Sort by', o.pills('method', [['az', 'A to Z'], ['za', 'Z to A'], ['natural', 'Natural'], ['numeric', 'Numeric'], ['length', 'Length'], ['random', 'Random']], 'Sort by')),
        dir, reroll,
        group('Options', chips(bool('caseSensitive', 'Case sensitive', 'Capitals sort before lowercase when on'), bool('trim', 'Trim lines'), bool('dropEmpty', 'Drop empty lines'), bool('unique', 'Remove duplicates'))),
      ]
    }
    case 'reverse':
      return [group('Reverse', o.pills('mode', [['whole', 'Whole text'], ['each', 'Each line'], ['words', 'Letters in each word'], ['order', 'Word order'], ['lines', 'Line order']], 'What to reverse'))]
    case 'prefix': {
      const t = o.text('text', { placeholder: 'Text to add at the start', cls: 'wide' })
      return [
        group('Prefix', t, quick([['- ', '- dash'], ['* ', '* star'], ['\u{2022} ', '\u{2022} bullet'], ['> ', '> quote'], ['// ', '// comment'], ['# ', '# hash'], ['\t', 'tab'], ['    ', '4 spaces'], ['{n}. ', '{n}. number']], (v) => { o.set({ text: v }); t.focus() })),
        group('Options', chips(bool('skipEmpty', 'Skip empty lines'), bool('keepIndent', 'Keep indentation', 'Add the prefix after the leading spaces'))),
        h('span', { class: 'tu-hint' }, 'Tip: {n} becomes the line number.'),
      ]
    }
    case 'suffix': {
      const t = o.text('text', { placeholder: 'Text to add at the end', cls: 'wide' })
      return [
        group('Suffix', t, quick([[',', ', comma'], [';', '; semicolon'], ['.', '. period'], ['<br>', '<br>'], ['  ', '2 spaces'], [' \\', '\\ continue'], ['",', '",'], ['\t', 'tab']], (v) => { o.set({ text: v }); t.focus() })),
        group('Options', chips(bool('skipEmpty', 'Skip empty lines'), bool('skipLast', 'Leave the last line alone'))),
      ]
    }
    case 'number': {
      const custom = group('Custom format', o.text('custom', { placeholder: 'Step {n}: ', cls: 'mid' }))
      o.show(custom, () => o.v.fmt === 'custom')
      return [
        group('Format', o.select('fmt', [['{n}. ', '1.'], ['{n}) ', '1)'], ['({n}) ', '(1)'], ['[{n}] ', '[1]'], ['{n}: ', '1:'], ['{n} - ', '1 -'], ['#{n} ', '#1'], ['{n} ', '1 (plain)'], ['custom', 'Custom...']], 'Number format')),
        custom,
        group('Style', o.pills('style', [['arabic', '1 2 3'], ['alpha', 'a b c'], ['ALPHA', 'A B C'], ['roman', 'i ii iii'], ['ROMAN', 'I II III']], 'Numbering style')),
        group('Start at', o.num('start', { min: -9999, max: 999999 })),
        group('Step', o.num('step', { min: -999, max: 999 })),
        group('Zero padding', o.select('pad', [['none', 'None'], ['auto', 'Match the biggest'], ['2', '2 digits'], ['3', '3 digits'], ['4', '4 digits']], 'Zero padding')),
        group('Options', chips(bool('skipEmpty', 'Skip empty lines'))),
      ]
    }
    case 'unnumber':
      return [
        group('Remove', chips(bool('numbers', '1.  1)  (1)  [1]  #1'), bool('bullets', '- * \u{2022} bullets'), bool('checkboxes', '[ ] checkboxes'), bool('letters', 'a.  b)  letters'), bool('roman', 'i.  ii.  roman'), bool('quotes', '> quote marks'))),
        group('Options', chips(bool('indent', 'Keep indentation'))),
      ]
    case 'join': {
      const joinOnly = [
        group('Separator', o.select('sep', SEPS, 'Separator')),
        group('Wrap each item', o.pills('wrap', [['none', 'None'], ['dq', '" "'], ['sq', "' '"], ['bt', '` `']], 'Wrap each item')),
        group('Around everything', o.pills('brackets', [['none', 'None'], ['sq', '[ ]'], ['rd', '( )'], ['cu', '{ }']], 'Brackets')),
      ]
      const customSep = group('Custom separator', o.text('customSep', { placeholder: ' and ', cls: 'mid' }))
      o.show(customSep, () => o.v.mode === 'join' && o.v.sep === 'custom')
      joinOnly.forEach((g) => o.show(g, () => o.v.mode === 'join'))
      const splitOnly = group('Split on', o.select('delim', DELIMS, 'Delimiter'))
      o.show(splitOnly, () => o.v.mode === 'split')
      const customDelim = group('Custom delimiter', o.text('customDelim', { placeholder: 'e.g. ->', cls: 'mid' }))
      o.show(customDelim, () => o.v.mode === 'split' && o.v.delim === 'custom')
      const unq = bool('unquote', 'Remove surrounding quotes')
      o.show(unq, () => o.v.mode === 'split')
      const presets = group('Presets', chips(
        chipButton('CSV row', () => o.set({ mode: 'join', sep: ',', wrap: 'none', brackets: 'none' })),
        chipButton('SQL IN list', () => o.set({ mode: 'join', sep: ', ', wrap: 'sq', brackets: 'rd' })),
        chipButton('JSON array', () => o.set({ mode: 'join', sep: ', ', wrap: 'dq', brackets: 'sq' })),
        chipButton('One per line', () => o.set({ mode: 'split', delim: ',' }))))
      return [
        group('Mode', o.pills('mode', [['join', 'Join lines into one'], ['split', 'Split into lines']], 'Mode')),
        ...joinOnly, customSep, splitOnly, customDelim,
        group('Options', chips(bool('trim', 'Trim each item'), bool('skipEmpty', 'Skip empty items'), bool('unique', 'Remove duplicates'), unq)),
        presets,
      ]
    }
    case 'spaces-to-tabs': {
      const size = group('Spaces per tab', o.num('size', { min: 1, max: 16 }))
      const run = group('Shortest run of spaces', o.num('minRun', { min: 2, max: 32 }))
      o.show(size, () => o.v.mode === 'indent')
      o.show(run, () => o.v.mode === 'runs')
      return [group('Convert', o.pills('mode', [['indent', 'Indentation'], ['runs', 'Every run of spaces']], 'What to convert')), size, run]
    }
    case 'tabs-to-spaces':
      return [
        group('Spaces per tab', o.pills('size', [[2, '2'], [4, '4'], [8, '8']], 'Spaces per tab'), o.num('size', { min: 1, max: 16 })),
        group('Options', chips(bool('leading', 'Only leading tabs (indentation)'), bool('stops', 'Align to tab stops like an editor'))),
      ]
    case 'remove-whitespace': {
      const preset = (patch) => () => o.set({ trimStart: false, trimEnd: false, collapse: false, removeSpaces: false, blank: false, oneLine: false, joinWith: 'space', ...patch })
      const jw = group('Line breaks become', o.pills('joinWith', [['space', 'A space'], ['none', 'Nothing']], 'Replace line breaks with'))
      o.show(jw, () => o.v.oneLine)
      return [
        group('Quick presets', chips(
          chipButton('Trim lines', preset({ trimStart: true, trimEnd: true })),
          chipButton('Collapse spaces', preset({ collapse: true })),
          chipButton('No spaces at all', preset({ removeSpaces: true })),
          chipButton('Single line', preset({ trimStart: true, trimEnd: true, collapse: true, oneLine: true })),
          chipButton('Strip everything', preset({ removeSpaces: true, oneLine: true, joinWith: 'none' })))),
        group('Remove', chips(bool('trimStart', 'Spaces at line start'), bool('trimEnd', 'Spaces at line end'), bool('collapse', 'Repeated spaces'), bool('removeSpaces', 'All spaces and tabs'), bool('blank', 'Blank lines'), bool('oneLine', 'Line breaks'))),
        jw,
      ]
    }
    case 'normalize':
      return [group('Fix', chips(
        bool('breaks', 'Line breaks'), bool('spaces', 'Repeated spaces'), bool('invisible', 'Invisible characters', 'Zero-width spaces, soft hyphens, byte order marks'),
        bool('odd', 'Odd spaces', 'Non-breaking and wide spaces become normal spaces'), bool('trim', 'Trailing spaces'), bool('blank', 'Blank-line runs', 'Three or more blank lines become one'),
        bool('nfc', 'Recompose accents', 'Unicode NFC: e + combining accent becomes one character')))]
    default:
      return []
  }
}

export function mount(root, { tool, params }) {
  const op = params.op
  const cfg = OPS[op]
  if (!cfg) throw new Error(`Unknown line tool "${op}"`)
  const o = createOptions(tool.id, cfg.defaults)
  if (op === 'sort') o.v.seed = (Math.random() * 2 ** 31) | 0
  let st
  const run = (text) => {
    const r = cfg.run(text, o.v)
    if (r.extra?.tokens) {
      r.extra = h('section', { class: 'tu-card' }, h('h3', r.extra.title),
        h('div', { class: 'tu-tokens' }, r.extra.tokens.map(([line, n]) => h('button', { type: 'button', class: 'tu-token', title: 'Click to copy this line', onclick: () => copyText(line) }, line || '(empty)', h('small', `\u{d7}${n}`)))))
    }
    return r
  }
  st = studio({
    id: tool.id, inputTitle: cfg.title[0], outputTitle: cfg.title[1], placeholder: cfg.placeholder || 'Type or paste your text here...',
    sample: cfg.sample, controls: controlsFor(op, o), run, filename: cfg.file, mono: cfg.mono,
  })
  o.onChange = () => st.refresh()
  root.append(st.el)
  st.input.focus({ preventScroll: true })
  return () => {}
}
