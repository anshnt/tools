// UUID / ULID / NanoID generator: v4, v7, v1-style, v5, ULID, NanoID in bulk, with formats and a UUID inspector.
import { h, button, input, number, select, toggle, split, alert, clear, stats, copyText } from '../../lib/ui.js'
import { useKit, css, chips, eyebrow, outBox, scramble, hex, hashParams } from './_kit.js'

const rnd = (n) => crypto.getRandomValues(new Uint8Array(n))
const toUuid = (b) => { const s = hex(b); return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}` }
const parseBytes = (u) => Uint8Array.from(u.replace(/[{}\-\s]|^urn:uuid:/gi, '').match(/../g) || [], (x) => parseInt(x, 16))

// ---------- generators ----------
export function uuid4() {
  const b = rnd(16)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  return toUuid(b)
}

/** v7 (RFC 9562): 48-bit unix ms, 12-bit counter, 62 random bits. Ids from one generator always sort in creation order. */
export function makeV7() {
  let lastMs = -1
  let counter = 0
  return (now = Date.now()) => {
    let ms = Math.max(now, lastMs)
    if (ms === lastMs) { counter++; if (counter > 0xfff) { ms++; counter = 0 } } else { const r = rnd(2); counter = (r[0] | (r[1] << 8)) & 0x7ff }
    lastMs = ms
    const b = rnd(16)
    const t = BigInt(ms)
    for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn)
    b[6] = 0x70 | ((counter >> 8) & 0x0f)
    b[7] = counter & 0xff
    b[8] = (b[8] & 0x3f) | 0x80
    return toUuid(b)
  }
}

/** Time-based v1 layout with a random node id (multicast bit set, as RFC 4122 allows) so no MAC address is exposed. */
export function makeV1() {
  const node = rnd(6)
  node[0] |= 0x01
  const clock = (rnd(2)[0] << 8 | rnd(2)[1]) & 0x3fff
  let last = 0n
  return (now = Date.now()) => {
    let t = (BigInt(now) + 12219292800000n) * 10000n
    if (t <= last) t = last + 1n
    last = t
    const b = new Uint8Array(16)
    const low = t & 0xffffffffn, mid = (t >> 32n) & 0xffffn, hi = ((t >> 48n) & 0x0fffn) | 0x1000n
    for (let i = 0; i < 4; i++) b[i] = Number((low >> BigInt(8 * (3 - i))) & 0xffn)
    b[4] = Number(mid >> 8n); b[5] = Number(mid & 0xffn)
    b[6] = Number(hi >> 8n); b[7] = Number(hi & 0xffn)
    b[8] = 0x80 | (clock >> 8); b[9] = clock & 0xff
    b.set(node, 10)
    return toUuid(b)
  }
}

export const NAMESPACES = {
  dns: ['DNS', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'], url: ['URL', '6ba7b811-9dad-11d1-80b4-00c04fd430c8'],
  oid: ['OID', '6ba7b812-9dad-11d1-80b4-00c04fd430c8'], x500: ['X.500', '6ba7b814-9dad-11d1-80b4-00c04fd430c8'],
}
/** Name-based v5 (SHA-1). Same namespace and name always give the same UUID. */
export async function uuid5(namespace, name) {
  const ns = parseBytes(namespace)
  if (ns.length !== 16) throw new Error('The namespace must be a valid UUID.')
  const data = new Uint8Array([...ns, ...new TextEncoder().encode(name)])
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16)
  d[6] = (d[6] & 0x0f) | 0x50
  d[8] = (d[8] & 0x3f) | 0x80
  return toUuid(d)
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** ULID: 48-bit time + 80 random bits in Crockford Base32. Monotonic within one generator. */
export function makeUlid() {
  let lastMs = -1
  let rand = 0n
  return (now = Date.now()) => {
    let ms = now
    if (ms <= lastMs) { ms = lastMs; rand = (rand + 1n) & ((1n << 80n) - 1n) } else { lastMs = ms; rand = BigInt('0x' + hex(rnd(10))) }
    let t = ''
    let n = BigInt(ms)
    for (let i = 0; i < 10; i++) { t = CROCKFORD[Number(n & 31n)] + t; n >>= 5n }
    let r = ''
    let x = rand
    for (let i = 0; i < 16; i++) { r = CROCKFORD[Number(x & 31n)] + r; x >>= 5n }
    return t + r
  }
}

export const ALPHABETS = {
  url: ['URL-safe (A-Z a-z 0-9 _ -)', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'],
  alnum: ['Letters and digits', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'],
  lower: ['Lowercase and digits', '0123456789abcdefghijklmnopqrstuvwxyz'],
  digits: ['Digits only', '0123456789'],
  hex: ['Hex', '0123456789abcdef'],
  nolook: ['No look-alikes (no 0 O 1 l I)', '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'],
  custom: ['Custom...', ''],
}
/** Unbiased random string (rejection sampling). */
export function nanoid(size = 21, alphabet = ALPHABETS.url[1]) {
  const chars = [...new Set([...alphabet])]
  if (chars.length < 2 || chars.length > 256) throw new Error('The alphabet needs between 2 and 256 distinct characters.')
  const mask = (2 << (31 - Math.clz32((chars.length - 1) | 1))) - 1
  const step = Math.ceil((1.6 * mask * size) / chars.length)
  let id = ''
  while (id.length < size) {
    for (const b of rnd(step)) {
      const c = chars[b & mask]
      if (c !== undefined) { id += c; if (id.length === size) break }
    }
  }
  return id
}

// ---------- formatting and inspection ----------
export function formatId(id, { upper = false, hyphens = true, wrap = '' } = {}) {
  let s = hyphens ? id : id.replace(/-/g, '')
  s = upper ? s.toUpperCase() : s.toLowerCase()
  return { '': s, '{}': `{${s}}`, '"': `"${s}"`, "'": `'${s}'`, urn: `urn:uuid:${s}` }[wrap] ?? s
}
export function joinIds(list, sep) {
  if (sep === 'json') return JSON.stringify(list, null, 2)
  return list.join({ nl: '\n', comma: ',', 'comma-nl': ',\n', space: ' ' }[sep] ?? '\n')
}

const GREG = 12219292800000n
export function inspectUuid(text) {
  const t = text.trim()
  const m = /^(?:urn:uuid:)?\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$/i.exec(t)
  if (!m) return null
  const id = m.slice(1).join('-').toLowerCase()
  const b = parseBytes(id)
  const version = b[6] >> 4
  const v = b[8] >> 4
  const variant = v < 8 ? 'NCS (reserved)' : v < 12 ? 'RFC 9562 (standard)' : v < 14 ? 'Microsoft (reserved)' : 'Future (reserved)'
  const out = { id, version, variant, nil: /^0+$/.test(id.replace(/-/g, '')), max: /^f+$/.test(id.replace(/-/g, '')), time: null }
  if (version === 1) {
    const hexT = id.slice(15, 18) + id.slice(9, 13) + id.slice(0, 8)
    const ms = BigInt('0x' + hexT) / 10000n - GREG
    out.time = new Date(Number(ms))
  } else if (version === 7) out.time = new Date(parseInt(id.slice(0, 8) + id.slice(9, 13), 16))
  const names = { 1: 'Time-based', 2: 'DCE security', 3: 'Name-based (MD5)', 4: 'Random', 5: 'Name-based (SHA-1)', 6: 'Reordered time', 7: 'Unix time + random', 8: 'Custom' }
  out.kind = names[version] || 'Unknown'
  if (out.time && isNaN(out.time)) out.time = null
  return out
}
export function inspectUlid(text) {
  const t = text.trim().toUpperCase()
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(t) || t[0] > '7') return null
  let n = 0n
  for (const c of t.slice(0, 10)) n = n * 32n + BigInt(CROCKFORD.indexOf(c))
  return { time: new Date(Number(n)) }
}

const TYPES = [
  ['v4', 'UUID v4', 'Random. The everyday default for unique ids: 122 random bits.'],
  ['v7', 'UUID v7', 'Unix time first, then random. Sorts by creation time, great for database keys.'],
  ['v1', 'UUID v1', 'Time-based layout with a random node id (no MAC address is used).'],
  ['v5', 'UUID v5', 'Name-based (SHA-1). The same namespace and name always give the same UUID.'],
  ['ulid', 'ULID', '26 characters, sortable, URL-safe: 48-bit time plus 80 random bits.'],
  ['nanoid', 'NanoID', 'Short, URL-friendly random ids with a custom length and alphabet.'],
]

const STYLE = `
.t-uu .uu-hero { padding: 26px 22px; text-align: center; }
.t-uu .uu-id { font-family: var(--mono); font-size: clamp(17px, 3.6vw, 30px); font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; line-height: 1.3; min-height: 1.3em; }
.t-uu .uu-sub { margin-top: 8px; font-size: 13px; color: var(--muted); }
.t-uu .uu-types { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 120px), 1fr)); gap: 8px; }
.t-uu .uu-type { text-align: left; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-weight: 600; font-size: 13.5px; color: var(--text); min-height: 44px;
  transition: transform .2s var(--spring), border-color .2s, background .2s; }
.t-uu .uu-type:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.t-uu .uu-type[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.t-uu .uu-insp { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; font-size: 13.5px; }
.t-uu .uu-insp dt { color: var(--muted); }
.t-uu .uu-insp dd { margin: 0; font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
`

export function mount(root) {
  useKit()
  css('t-uu-css', STYLE)
  const gen = { v7: makeV7(), v1: makeV1(), ulid: makeUlid() }
  const q = hashParams()
  let type = TYPES.some((t) => t[0] === q.get('type')) ? q.get('type') : 'v4'
  let ids = []

  const typeBtns = TYPES.map(([id, label]) => h('button', { type: 'button', class: 'uu-type', 'aria-pressed': String(id === type), onclick: () => { type = id; for (const b of typeBtns) b.setAttribute('aria-pressed', String(b.dataset.t === id)); update(true) }, dataset: { t: id } }, label))
  const typeDesc = h('div', { class: 'small muted', style: 'min-height:20px' })
  const count = number(5, { min: 1, max: 1000, step: 1, ariaLabel: 'How many', onInput: () => generate() })
  const countChips = chips([[1, '1'], [5, '5'], [10, '10'], [50, '50'], [100, '100'], [1000, '1000']], { value: 5, ariaLabel: 'Quick counts', onChange: (v) => { count.value = v; generate() } })
  const upper = toggle('UPPERCASE', false, () => render())
  const hyph = toggle('Hyphens', true, () => render())
  const wrap = select([['', 'No wrapping'], ['{}', '{ braces }'], ['"', '"double quotes"'], ["'", "'single quotes'"], ['urn', 'urn:uuid: prefix']], '', () => render())
  const sep = select([['nl', 'One per line'], ['comma', 'Comma separated'], ['comma-nl', 'Comma + new line'], ['space', 'Space separated'], ['json', 'JSON array']], 'nl', () => render())
  const fmtBox = h('div', { class: 'stack tight' }, h('div', { class: 'row' }, upper, hyph), h('div', { class: 'grid-2' }, wrap, sep))
  const nsSel = select([...Object.entries(NAMESPACES).map(([k, [l]]) => [k, l]), ['custom', 'Custom UUID...']], 'dns', () => { nsCustom.hidden = nsSel.value !== 'custom'; generate() })
  const nsCustom = input({ mono: true, placeholder: 'namespace UUID', 'aria-label': 'Custom namespace UUID', oninput: () => generate() })
  nsCustom.hidden = true
  const nameIn = input({ mono: true, value: 'example.com', 'aria-label': 'Name', oninput: () => generate() })
  const v5Box = h('div', { class: 'stack tight' }, h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Namespace'), nsSel), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), nameIn)), nsCustom,
    h('div', { class: 'small muted' }, 'Deterministic: the same namespace and name always produce the same UUID, so the count is ignored.'))
  const size = number(21, { min: 4, max: 256, step: 1, ariaLabel: 'Length', onInput: () => generate() })
  const alpha = select(Object.entries(ALPHABETS).map(([k, [l]]) => [k, l]), 'url', () => { custom.hidden = alpha.value !== 'custom'; generate() })
  const custom = input({ mono: true, placeholder: 'characters to use, e.g. ABC123', 'aria-label': 'Custom alphabet', oninput: () => generate() })
  custom.hidden = true
  const nanoBox = h('div', { class: 'stack tight' }, h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Length'), size), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Alphabet'), alpha)), custom,
    h('div', { class: 'small muted', id: 'uu-entropy' }))
  const lowerUlid = toggle('lowercase ULID', false, () => render())

  const heroId = h('div', { class: 'uu-id', 'aria-live': 'polite' })
  const heroSub = h('div', { class: 'uu-sub' })
  const heroCopy = button('Copy', { icon: 'copy', onClick: () => ids[0] != null && copyText(formatOne(ids[0])) })
  const out = outBox('All ids', { placeholder: 'Generated ids appear here.', dl: { name: 'ids.txt' } })
  const statsEl = h('div')
  const err = h('div')

  const isUuid = () => ['v4', 'v7', 'v1', 'v5'].includes(type)
  const formatOne = (id) => (isUuid() ? formatId(id, { upper: upper.input.checked, hyphens: hyph.input.checked, wrap: wrap.value }) : type === 'ulid' ? (lowerUlid.input.checked ? id.toLowerCase() : id) : id)

  async function generate(animate = false) {
    clear(err)
    const n = Math.min(1000, Math.max(1, Math.round(count.valueAsNumber) || 1))
    try {
      if (type === 'v5') {
        const ns = nsSel.value === 'custom' ? nsCustom.value.trim() : NAMESPACES[nsSel.value][1]
        ids = [await uuid5(ns, nameIn.value)]
      } else if (type === 'nanoid') {
        const a = alpha.value === 'custom' ? custom.value : ALPHABETS[alpha.value][1]
        const len = Math.min(256, Math.max(4, Math.round(size.valueAsNumber) || 21))
        ids = Array.from({ length: n }, () => nanoid(len, a))
        const bits = len * Math.log2(new Set([...a]).size)
        nanoBox.querySelector('#uu-entropy').textContent = `About ${Math.round(bits)} bits of randomness per id${bits < 64 ? '. Fine for short-lived ids, too small for global uniqueness.' : '.'}`
      } else {
        const f = { v4: uuid4, v7: gen.v7, v1: gen.v1, ulid: gen.ulid }[type]
        ids = Array.from({ length: n }, () => f())
      }
    } catch (e) {
      ids = []
      clear(err, alert('error', e.message))
    }
    render(animate)
  }

  let shown = ''
  function render(animate = false) {
    const list = ids.map(formatOne)
    const text = joinIds(list, sep.value)
    out.set(text, { quiet: !animate && text === shown })
    shown = text
    const first = list[0] || ''
    if (animate) scramble(heroId, first)
    else heroId.textContent = first
    heroSub.textContent = ids.length > 1 ? `and ${ids.length - 1} more below` : TYPES.find((t) => t[0] === type)[2]
    clear(statsEl, ids.length ? stats([
      { label: 'Generated', value: String(ids.length), accent: true },
      { label: 'Length', value: `${first.length} chars` },
      { label: 'Type', value: TYPES.find((t) => t[0] === type)[1] },
    ]) : h('span'))
  }

  function update(animate) {
    typeDesc.textContent = TYPES.find((t) => t[0] === type)[2]
    v5Box.hidden = type !== 'v5'
    nanoBox.hidden = type !== 'nanoid'
    upper.hidden = hyph.hidden = wrap.hidden = !isUuid()
    lowerUlid.hidden = type !== 'ulid'
    count.closest('.field').hidden = type === 'v5'
    countChips.hidden = type === 'v5'
    generate(animate)
  }

  const regen = button('Generate', { icon: 'refresh-cw', variant: 'primary', onClick: () => generate(true) })

  // ---------- inspector ----------
  const inspIn = input({ mono: true, placeholder: 'Paste a UUID or ULID to inspect it', 'aria-label': 'UUID or ULID to inspect', spellcheck: false, oninput: () => inspect() })
  const inspOut = h('div')
  function inspect() {
    const t = inspIn.value.trim()
    if (!t) return clear(inspOut)
    const u = inspectUuid(t)
    if (u) {
      return clear(inspOut, h('dl', { class: 'uu-insp' },
        h('dt', 'Valid'), h('dd', u.nil ? 'Yes, the nil UUID (all zeros)' : u.max ? 'Yes, the max UUID (all ones)' : 'Yes'),
        h('dt', 'Version'), h('dd', `${u.version}: ${u.kind}`),
        h('dt', 'Variant'), h('dd', u.variant),
        u.time ? [h('dt', 'Created'), h('dd', `${u.time.toISOString()} (${u.time.toLocaleString()})`)] : null,
        h('dt', 'Normalised'), h('dd', u.id)))
    }
    const l = inspectUlid(t)
    if (l) return clear(inspOut, h('dl', { class: 'uu-insp' }, h('dt', 'Valid'), h('dd', 'Yes, a ULID'), h('dt', 'Created'), h('dd', `${l.time.toISOString()} (${l.time.toLocaleString()})`)))
    clear(inspOut, alert('warn', 'That is not a valid UUID (8-4-4-4-12 hex digits) or ULID (26 characters).'))
  }

  root.append(h('div', { class: 'dv t-uu stack' },
    h('div', { class: 'dv-hero uu-hero' }, heroId, heroSub, h('div', { class: 'row', style: 'justify-content:center;margin-top:16px' }, regen, heroCopy)),
    split(
      h('div', { class: 'panel stack' }, eyebrow('sliders-horizontal', 'Type'), h('div', { class: 'uu-types', role: 'group', 'aria-label': 'Id type' }, typeBtns), typeDesc,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'How many (1 to 1000)'), count), countChips, v5Box, nanoBox, h('div', { class: 'stack tight' }, eyebrow('type', 'Format'), fmtBox, lowerUlid), err),
      h('div', { class: 'stack' }, out.el, statsEl)),
    h('div', { class: 'panel stack' }, eyebrow('scan-search', 'Inspect an id'), inspIn, inspOut),
    h('p', { class: 'small muted' }, 'Ids are made with your browser\'s cryptographic random number generator (crypto.getRandomValues). Nothing is sent anywhere.')))
  update(false)
}
