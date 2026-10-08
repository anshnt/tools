// Text, binary and hex converter: text <-> binary, hex, octal, decimal, Base32 and Base64, UTF-8 aware, with a byte-by-byte visual.
// encode() and decode() are pure and exported for tests.
import { h } from '../../lib/ui.js'
import { studio, createOptions, group, chips, chipButton, plural } from './_shared.js'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const SEPS = { space: ' ', none: '', comma: ',', commaSpace: ', ', newline: '\n' }
const NAMES = { binary: 'binary', hex: 'hex', octal: 'octal', decimal: 'decimal', base32: 'Base32', base64: 'Base64' }

export const textToBytes = (s) => new TextEncoder().encode(s)
/** Decode UTF-8; if the bytes are not valid UTF-8, fall back to replacement characters and say so. */
export function bytesToText(bytes) {
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), lossy: false } } catch { return { text: new TextDecoder('utf-8').decode(bytes), lossy: true } }
}

function toBase32(bytes, pad) {
  let bits = 0, val = 0, out = ''
  for (const b of bytes) {
    val = (val << 8) | b
    bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
    val &= (1 << bits) - 1
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  if (pad) while (out.length % 8) out += '='
  return out
}
function fromBase32(str) {
  const clean = str.replace(/[\s=-]+/g, '').toUpperCase()
  const bad = clean.search(/[^A-Z2-7]/)
  if (bad >= 0) throw new Error(`"${clean[bad]}" is not a Base32 character (use A-Z and 2-7).`)
  const out = []
  let bits = 0, val = 0
  for (const ch of clean) {
    val = (val << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1 }
  }
  return Uint8Array.from(out)
}
function toBase64(bytes, urlSafe, pad) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  let b = btoa(s)
  if (urlSafe) b = b.replace(/\+/g, '-').replace(/\//g, '_')
  return pad ? b : b.replace(/=+$/, '')
}
function fromBase64(str) {
  let clean = str.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const bad = clean.replace(/=+$/, '').search(/[^A-Za-z0-9+/]/)
  if (bad >= 0) throw new Error(`"${clean[bad]}" is not a Base64 character.`)
  clean = clean.replace(/=+$/, '')
  if (clean.length % 4 === 1) throw new Error('That is not valid Base64 (the length does not work out).')
  clean += '='.repeat((4 - (clean.length % 4)) % 4)
  const bin = atob(clean)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** bytes -> string in the chosen format. */
export function encode(bytes, fmt, o) {
  if (fmt === 'base32') return toBase32(bytes, o.pad)
  if (fmt === 'base64') return toBase64(bytes, o.urlSafe, o.pad)
  const pre = o.prefix ? { binary: '0b', hex: '0x', octal: '0o', decimal: '' }[fmt] : ''
  const word = (b) => pre + (fmt === 'binary' ? b.toString(2).padStart(8, '0') : fmt === 'hex' ? (o.upper ? b.toString(16).toUpperCase() : b.toString(16)).padStart(2, '0') : fmt === 'octal' ? b.toString(8).padStart(3, '0') : String(b))
  const words = Array.from(bytes, word)
  const sep = SEPS[o.sep] ?? ' '
  const per = Math.max(0, Math.floor(o.perLine || 0))
  if (!per) return words.join(sep)
  const lines = []
  for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per).join(sep))
  return lines.join('\n')
}

const tokens = (s) => s.split(/[\s,;:|]+/).filter(Boolean)
const firstBad = (s, re) => { const m = s.match(re); return m ? m[0] : null }

/** string in the chosen format -> {text, notes[]}. Throws Error with a plain-words message. */
export function decode(input, fmt) {
  const notes = []
  const src = input.trim()
  if (!src) return { text: '', notes }
  let bytes
  if (fmt === 'base32') bytes = fromBase32(src)
  else if (fmt === 'base64') bytes = fromBase64(src)
  else if (fmt === 'binary') {
    const toks = tokens(src.replace(/0b/gi, ' '))
    const out = []
    for (const t of toks) {
      const bad = firstBad(t, /[^01]/)
      if (bad) throw new Error(`"${bad}" is not a binary digit. Binary only uses 0 and 1.`)
      if (toks.length > 1 && t.length <= 8) out.push(parseInt(t, 2))
      else if (t.length % 8 === 0) for (let i = 0; i < t.length; i += 8) out.push(parseInt(t.slice(i, i + 8), 2))
      else throw new Error(toks.length > 1 ? `The group "${t}" has ${t.length} bits. Use groups of up to 8 bits, or multiples of 8.` : `That is ${t.length} bits. Binary text needs 8 bits per character (a multiple of 8).`)
    }
    bytes = Uint8Array.from(out)
  } else if (fmt === 'hex') {
    const toks = tokens(src.replace(/\\x|0x|&#x|%|U\+/gi, ' ').replace(/;/g, ' '))
    for (const t of toks) { const bad = firstBad(t, /[^0-9a-f]/i); if (bad) throw new Error(`"${bad}" is not a hex digit. Hex uses 0-9 and A-F.`) }
    const out = []
    if (toks.every((t) => t.length <= 2)) for (const t of toks) out.push(parseInt(t, 16))
    else {
      const all = toks.join('')
      if (all.length % 2) throw new Error(`Hex needs an even number of digits (found ${all.length}).`)
      for (let i = 0; i < all.length; i += 2) out.push(parseInt(all.slice(i, i + 2), 16))
    }
    bytes = Uint8Array.from(out)
  } else if (fmt === 'octal') {
    const toks = tokens(src.replace(/0o/gi, ' ').replace(/\\/g, ' '))
    const out = []
    const push = (t) => { const v = parseInt(t, 8); if (v > 255) throw new Error(`Octal ${t} is more than 377 (255), which is too big for one byte.`); out.push(v) }
    for (const t of toks) {
      const bad = firstBad(t, /[^0-7]/)
      if (bad) throw new Error(`"${bad}" is not an octal digit. Octal uses 0-7.`)
      if (toks.length > 1 && t.length <= 3) push(t)
      else if (t.length % 3 === 0) for (let i = 0; i < t.length; i += 3) push(t.slice(i, i + 3))
      else throw new Error(`"${t}" has ${t.length} digits. Octal bytes are written with 3 digits each.`)
    }
    bytes = Uint8Array.from(out)
  } else {
    const toks = tokens(src)
    const nums = []
    for (const t of toks) {
      if (!/^\d+$/.test(t)) throw new Error(`"${t}" is not a whole number. Decimal codes are separated by spaces or commas.`)
      nums.push(Number(t))
    }
    if (nums.some((n) => n > 255)) {
      if (nums.some((n) => n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff))) throw new Error('One of the numbers is not a valid Unicode character code.')
      notes.push('Some numbers are above 255, so every number was read as a Unicode character code.')
      return { text: String.fromCodePoint(...nums), notes }
    }
    bytes = Uint8Array.from(nums)
  }
  const { text, lossy } = bytesToText(bytes)
  if (lossy) notes.push('These bytes are not valid UTF-8, so some characters show as \u{fffd}.')
  return { text, notes, bytes: bytes.length }
}

const SAMPLE = 'Hello, World! \u{928}\u{92e}\u{938}\u{94d}\u{924}\u{947} \u{1f30d}'
const GLYPH = { ' ': '\u{2423}', '\n': '\u{21b5}', '\t': '\u{21e5}' }

const CSS = `
.tu-bytes { display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px 10px; scrollbar-width: thin; }
.tu-tile { flex: none; min-width: 92px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 10px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--border); animation: tu-pop .45s var(--spring) both; animation-delay: calc(var(--i, 0) * 45ms); }
.tu-tile .g { font-size: 26px; line-height: 1.1; min-height: 30px; }
.tu-tile .cp { font: 11px var(--mono); color: var(--muted); }
.tu-tile .hx { font: 600 12px var(--mono); color: var(--accent); }
.tu-bits { display: grid; grid-template-columns: repeat(8, 7px); gap: 2px; }
.tu-bits i { width: 7px; height: 7px; border-radius: 2px; background: var(--surface-3); }
.tu-bits i.on { background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
`

function tiles(text) {
  const chars = Array.from(text).slice(0, 14)
  if (!chars.length) return null
  return h('section', { class: 'tu-card' },
    h('h3', 'Byte by byte', h('span', { class: 'tu-hint' }, Array.from(text).length > 14 ? 'First 14 characters' : plural(chars.length, 'character'))),
    h('div', { class: 'tu-bytes' }, chars.map((ch, i) => {
      const bytes = textToBytes(ch)
      return h('div', { class: 'tu-tile', style: { '--i': i }, title: `${bytes.length} byte${bytes.length > 1 ? 's' : ''} in UTF-8` },
        h('div', { class: 'g' }, GLYPH[ch] || ch),
        h('div', { class: 'cp' }, `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`),
        h('div', { class: 'hx' }, [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')),
        [...bytes].map((b) => h('div', { class: 'tu-bits' }, b.toString(2).padStart(8, '0').split('').map((bit) => h('i', { class: bit === '1' ? 'on' : '' })))))
    })))
}

export function mount(rootEl, { tool }) {
  if (!document.getElementById('tu-bh-style')) document.head.append(h('style', { id: 'tu-bh-style' }, CSS))
  const o = createOptions(tool.id, { dir: 'encode', fmt: 'binary', sep: 'space', prefix: false, upper: true, perLine: 0, pad: true, urlSafe: false })
  let st
  const sampleFor = () => (o.v.dir === 'encode' ? SAMPLE : encode(textToBytes(SAMPLE), o.v.fmt, o.v))
  const run = (text) => {
    if (!text) return { text: '', badges: [] }
    const fmt = o.v.fmt
    if (o.v.dir === 'encode') {
      const bytes = textToBytes(text)
      return {
        text: encode(bytes, fmt, o.v),
        badges: [{ label: 'characters', value: [...text].length }, { label: 'UTF-8 bytes', value: bytes.length, tone: 'accent' }],
        note: bytes.length > [...text].length ? 'Some characters take more than one byte in UTF-8.' : '', extra: tiles(text),
      }
    }
    const r = decode(text, fmt)
    return { text: r.text, badges: [{ label: 'characters', value: [...r.text].length, tone: 'accent' }, ...(r.bytes ? [{ label: 'bytes read', value: r.bytes }] : [])], note: r.notes.join(' '), extra: tiles(r.text) }
  }
  const flipBtn = chipButton('Flip direction', () => {
    const next = o.v.dir === 'encode' ? 'decode' : 'encode'
    const keep = st.latest
    o.set({ dir: next })
    if (keep) st.setInput(keep)
  }, 'arrow-left-right', 'Use the result as the input and flip the direction')
  const hexOnly = o.bool('upper', 'Uppercase hex')
  const preBox = o.bool('prefix', 'Prefix (0x, 0b, 0o)')
  const b32Pad = o.bool('pad', 'Padding (=)')
  const urlSafe = o.bool('urlSafe', 'URL-safe')
  const sepG = group('Separator', o.select('sep', [['space', 'Space'], ['comma', 'Comma'], ['commaSpace', 'Comma + space'], ['newline', 'New line'], ['none', 'Nothing']], 'Separator'))
  const perG = group('Per line', o.num('perLine', { min: 0, max: 256, cls: 'narrow' }))
  const plain = (fmt) => ['binary', 'hex', 'octal', 'decimal'].includes(fmt)
  o.show(hexOnly, () => o.v.dir === 'encode' && o.v.fmt === 'hex')
  o.show(preBox, () => o.v.dir === 'encode' && ['binary', 'hex', 'octal'].includes(o.v.fmt))
  o.show(b32Pad, () => o.v.dir === 'encode' && (o.v.fmt === 'base32' || o.v.fmt === 'base64'))
  o.show(urlSafe, () => o.v.dir === 'encode' && o.v.fmt === 'base64')
  o.show(sepG, () => o.v.dir === 'encode' && plain(o.v.fmt))
  o.show(perG, () => o.v.dir === 'encode' && plain(o.v.fmt))
  st = studio({
    id: tool.id, inputTitle: 'Text', outputTitle: 'Binary', placeholder: 'Type or paste text...', sample: sampleFor, mono: true,
    controls: [
      group('Direction', o.pills('dir', [['encode', 'Text to code'], ['decode', 'Code to text']], 'Direction')),
      group('Format', o.pills('fmt', Object.entries(NAMES), 'Format')),
      sepG, perG,
      group('Options', chips(hexOnly, preBox, b32Pad, urlSafe)),
      group('', flipBtn),
    ],
    run, filename: 'converted.txt', emptyText: 'Type something to see it as bytes',
  })
  const titles = st.el.querySelectorAll('.tu-title span')
  const label = () => {
    const enc = o.v.dir === 'encode'
    const f = NAMES[o.v.fmt]
    titles[0].textContent = enc ? 'Text' : `${f} to decode`
    titles[1].textContent = enc ? f : 'Text'
    st.input.placeholder = enc ? 'Type or paste text...' : `Paste ${f} here...`
    st.input.classList.toggle('mono', !enc)
    st.output.classList.toggle('mono', enc)
  }
  o.onChange = () => { label(); st.refresh() }
  label()
  rootEl.append(st.el)
  st.input.focus({ preventScroll: true })
}
