// Secure random strings, tokens and API-key-like values from crypto.getRandomValues.
import { h, icon, field, input, select, number, panel, debounce, segmented } from '../../lib/ui.js'
import { useStyles, results, chip, pick, randBelow, randomBytes, toHex, toBase64, toBase64Url, log2, metaLine, load, save } from './_shared.js'

export const ALPHABETS = {
  hex: { label: 'Hex', chars: '0123456789abcdef', sample: '9f3a' },
  HEX: { label: 'HEX', chars: '0123456789ABCDEF', sample: '9F3A' },
  base62: { label: 'Base62', chars: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', sample: 'aZ9' },
  base64url: { label: 'Base64URL', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', sample: 'aZ9-_' },
  base58: { label: 'Base58', chars: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', sample: 'no 0OIl' },
  base32: { label: 'Base32', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', sample: 'A-Z 2-7' },
  digits: { label: 'Digits', chars: '0123456789', sample: '0-9' },
  letters: { label: 'Letters', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', sample: 'aZ' },
  custom: { label: 'Custom', chars: '', sample: '...' },
}
export const FORMATS = [['string', 'String'], ['bytes', 'Random bytes'], ['uuid', 'UUID v4'], ['key', 'License key']]

/** n characters drawn uniformly from the alphabet (code points). */
export function randomString(chars, n) {
  const a = [...new Set([...chars])]
  if (a.length < 2) throw new Error('The alphabet needs at least 2 different characters.')
  let out = ''
  for (let i = 0; i < n; i++) out += a[randBelow(a.length)]
  return out
}
/** RFC 4122 version 4 UUID. */
export function uuid4() {
  const b = randomBytes(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const x = toHex(b)
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}
/** Insert `sep` every `size` characters. */
export const group = (str, size, sep) => (size > 0 && sep ? str.match(new RegExp(`.{1,${size}}`, 'gu')).join(sep) : str)

const ENCODERS = { hex: toHex, base64: toBase64, base64url: toBase64Url }

export function mount(root) {
  useStyles()
  const s = { format: 'string', alphabet: 'base62', custom: 'ABCDEF0123456789!@#', length: 32, bytes: 32, encoding: 'hex', count: 1, prefix: '', group: 0, groupSep: '-', keyGroups: 5, keySize: 5, ...load('random-string:opts', {}) }
  s.count = Math.min(1000, Math.max(1, +s.count || 1))
  s.length = Math.min(512, Math.max(1, +s.length || 32))
  s.bytes = Math.min(256, Math.max(1, +s.bytes || 32))

  const out = results({ label: 'Random value', ic: 'shuffle', filename: 'random-strings.txt', onRegenerate: () => run(true), emptyText: 'Nothing to show yet' })
  const warn = h('div')

  const fmt = segmented(FORMATS, s.format, (v) => { s.format = v; sync(); run(true) }, 'Format')
  const alphaChips = h('div', { class: 'sx-chips', role: 'group', 'aria-label': 'Alphabet' })
  const alphaBtns = Object.entries(ALPHABETS).map(([id, a]) => h('button', { type: 'button', class: 'sx-preset', 'aria-pressed': String(id === s.alphabet), onclick: () => { s.alphabet = id; sync(); run(true) } }, a.label))
  alphaChips.append(...alphaBtns)
  const customInput = input({ mono: true, value: s.custom, 'aria-label': 'Custom alphabet', placeholder: 'Characters to draw from', oninput: (e) => { s.custom = e.target.value; run(false) } })
  const lenRange = h('input', { type: 'range', min: 1, max: 128, step: 1, value: Math.min(128, s.length), 'aria-label': 'Length', oninput: (e) => { s.length = +e.target.value; lenNum.value = s.length; run(false) } })
  const lenNum = number(s.length, { min: 1, max: 512, step: 1, ariaLabel: 'Length in characters', onInput: (n) => { if (n >= 1) { s.length = Math.min(512, Math.round(n)); lenRange.value = Math.min(128, s.length); run(false) } } })
  const bytesNum = number(s.bytes, { min: 1, max: 256, step: 1, ariaLabel: 'Number of bytes', onInput: (n) => { if (n >= 1) { s.bytes = Math.min(256, Math.round(n)); run(false) } } })
  const enc = select([['hex', 'Hex'], ['base64', 'Base64'], ['base64url', 'Base64URL']], s.encoding, (v) => { s.encoding = v; run(false) })
  const count = number(s.count, { min: 1, max: 1000, step: 1, ariaLabel: 'How many', onInput: (n) => { if (n >= 1) { s.count = Math.min(1000, Math.round(n)); run(false) } } })
  const prefix = input({ mono: true, value: s.prefix, placeholder: 'e.g. sk_live_', 'aria-label': 'Prefix', oninput: (e) => { s.prefix = e.target.value; run(false) } })
  const groupNum = number(s.group || '', { min: 0, max: 64, step: 1, placeholder: '0 = off', ariaLabel: 'Group size', onInput: (n) => { s.group = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; run(false) } })
  const groupSep = input({ mono: true, value: s.groupSep, maxLength: 3, 'aria-label': 'Group separator', oninput: (e) => { s.groupSep = e.target.value; run(false) } })
  const keyGroups = number(s.keyGroups, { min: 2, max: 10, step: 1, ariaLabel: 'Number of groups', onInput: (n) => { if (n >= 2) { s.keyGroups = Math.min(10, Math.round(n)); run(false) } } })
  const keySize = number(s.keySize, { min: 3, max: 10, step: 1, ariaLabel: 'Characters per group', onInput: (n) => { if (n >= 3) { s.keySize = Math.min(10, Math.round(n)); run(false) } } })

  const sections = {
    alphabet: h('div', { class: 'stack' }, h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Alphabet'), alphaChips), field('Custom alphabet', customInput),
      field('Length', h('div', { class: 'sx-lens' }, lenRange, lenNum)), field('Insert a separator every N characters', h('div', { class: 'row' }, h('div', { style: 'width:120px' }, groupNum), h('div', { style: 'width:80px' }, groupSep)))),
    bytes: h('div', { class: 'stack' }, field('Bytes of randomness', bytesNum, 'Hex gives 2 characters per byte. 16 bytes = 128 bits, 32 bytes = 256 bits.'), field('Encoding', enc)),
    uuid: h('div', { class: 'sx-hint' }, 'Random (version 4) UUID with 122 random bits, in the usual 8-4-4-4-12 form.'),
    key: h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('Groups', keyGroups), field('Characters per group', keySize)), h('div', { class: 'sx-hint' }, 'License-key style such as ABCDE-F2G3H-J4K5L, from an alphabet without look-alike characters (no 0, O, 1, I, L).')),
  }
  function sync() {
    fmt.set(s.format)
    sections.alphabet.hidden = s.format !== 'string'
    sections.bytes.hidden = s.format !== 'bytes'
    sections.uuid.hidden = s.format !== 'uuid'
    sections.key.hidden = s.format !== 'key'
    customInput.closest('.field').hidden = s.alphabet !== 'custom'
    alphaBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(Object.keys(ALPHABETS)[i] === s.alphabet)))
    prefixField.hidden = s.format === 'uuid'
  }
  const prefixField = field('Prefix (optional)', prefix, 'Handy for API-key style tokens, such as sk_live_ or ghp_.')

  const persist = debounce(() => save('random-string:opts', s), 300)
  function run(animate) {
    persist()
    warn.replaceChildren()
    try {
      let make, bits
      if (s.format === 'string') {
        const chars = s.alphabet === 'custom' ? s.custom : ALPHABETS[s.alphabet].chars
        const n = new Set([...chars]).size
        if (n < 2) throw new Error('Add at least 2 different characters to your custom alphabet.')
        bits = s.length * log2(n)
        make = () => group(randomString(chars, s.length), s.group, s.groupSep)
      } else if (s.format === 'bytes') {
        bits = s.bytes * 8
        make = () => ENCODERS[s.encoding](randomBytes(s.bytes))
      } else if (s.format === 'uuid') {
        bits = 122
        make = uuid4
      } else {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
        bits = s.keyGroups * s.keySize * log2(chars.length)
        make = () => Array.from({ length: s.keyGroups }, () => randomString(chars, s.keySize)).join('-')
      }
      const pre = s.format === 'uuid' ? '' : s.prefix
      const list = Array.from({ length: s.count }, () => pre + make())
      out.show(list, { bits, text: `${Math.round(bits)} bits each`, nodes: metaLine(bits, list[0].length + ' characters') }, { animate })
    } catch (e) {
      out.show([])
      warn.replaceChildren(h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', e.message)))
    }
  }

  root.append(h('div', { class: 'sx stack' },
    out, warn,
    panel(h('div', { class: 'sx-cols' },
      h('div', { class: 'stack' }, h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Format'), fmt), sections.alphabet, sections.bytes, sections.uuid, sections.key),
      h('div', { class: 'stack' }, prefixField, field('How many', count, 'Up to 1,000 at once; they are listed below and can be copied or downloaded.')))),
    h('div', { class: 'sx-hint' }, 'Values come from crypto.getRandomValues, never Math.random. Characters are picked with rejection sampling, so every character is equally likely.')))
  sync()
  run(true)
}
