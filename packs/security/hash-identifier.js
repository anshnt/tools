// Hash identifier: guess which algorithm produced a hash (from its length, alphabet and prefix) and say whether it is fit for passwords. Optional check against a guess.
import { h, icon, field, textarea, input, panel, alert, debounce } from '../../lib/ui.js'
import { useStyles, copyBtn, fromBase64, toHex } from './_shared.js'
import { hashBytes, matchChecksum } from './_hash.js'

// level: pw = built for passwords, ok = good general hash (too fast for passwords), weak = avoid, broken = do not rely on it, sum = checksum only
const L = {
  pw: { label: 'Built for passwords', icon: 'shield-check' },
  ok: { label: 'Good general hash', icon: 'check' },
  weak: { label: 'Weak, avoid', icon: 'triangle-alert' },
  broken: { label: 'Broken', icon: 'circle-x' },
  sum: { label: 'Checksum only', icon: 'info' },
}
const FAST_NOTE = 'A fast hash: great for files and signatures, but too quick to store passwords with. Use bcrypt, scrypt or Argon2 for passwords.'

/** Prefix formats: [regex, name, level, note, expected total length or 0]. */
const MODULAR = [
  [/^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}$/, 'bcrypt', 'pw', 'Adaptive and salted. The number after the second $ is the cost factor.'],
  [/^\$argon2(id|i|d)\$/, 'Argon2', 'pw', 'The current password hashing recommendation (Argon2id). Memory-hard and salted.'],
  [/^\$scrypt\$|^\$7\$/, 'scrypt', 'pw', 'Memory-hard and salted. A solid password hash.'],
  [/^\$y\$/, 'yescrypt', 'pw', 'Modern Linux shadow format. Memory-hard and salted.'],
  [/^\$pbkdf2(-sha\d+)?\$|^pbkdf2_sha\d+\$/i, 'PBKDF2', 'pw', 'Salted and iterated. Fine with enough iterations (600,000 or more for SHA-256).'],
  [/^\$6\$/, 'SHA-512 crypt', 'ok', 'Linux shadow format. Salted and iterated, but not memory-hard.'],
  [/^\$5\$/, 'SHA-256 crypt', 'ok', 'Linux shadow format. Salted and iterated, but not memory-hard.'],
  [/^\$1\$/, 'MD5 crypt', 'broken', 'Old Unix format based on MD5. Migrate to bcrypt or Argon2.'],
  [/^\$apr1\$/, 'Apache MD5 (apr1)', 'broken', 'Apache htpasswd MD5 variant. Migrate to bcrypt.'],
  [/^\$[PH]\$/, 'phpass (WordPress, Joomla)', 'weak', 'Iterated MD5. Better than plain MD5 but dated.'],
  [/^\{SSHA\}/i, 'LDAP salted SHA-1 (SSHA)', 'weak', 'Salted SHA-1 in LDAP. Dated; prefer a modern password hash.'],
  [/^\{SHA\}/i, 'LDAP SHA-1', 'broken', 'Unsalted SHA-1 in Base64.'],
  [/^\*[0-9A-F]{40}$/, 'MySQL 4.1+ (double SHA-1)', 'weak', 'MySQL native password format. Unsalted.'],
  [/^sha1\$[^$]+\$[0-9a-f]{40}$/, 'Django SHA-1', 'weak', 'Salted SHA-1.'],
  [/^md5\$[^$]+\$[0-9a-f]{32}$/, 'Django MD5', 'broken', 'Salted MD5.'],
]
const BY_BITS = {
  32: [['CRC-32', 'sum', 'Detects accidental errors only; anyone can forge it.'], ['Adler-32', 'sum', 'Checksum used in zlib.'], ['xxHash32', 'sum', 'Fast non-cryptographic hash.']],
  64: [['xxHash64 / XXH3', 'sum', 'Fast non-cryptographic hash.'], ['MySQL OLD_PASSWORD', 'broken', 'Pre-4.1 MySQL password hash.']],
  128: [['MD5', 'broken', 'Collisions are easy to produce. Fine only for spotting accidental corruption.'], ['NTLM', 'broken', 'Windows password hash. Unsalted and very fast to crack.'], ['MD4', 'broken', 'Obsolete.'], ['XXH128', 'sum', 'Fast non-cryptographic hash.']],
  160: [['SHA-1', 'weak', 'Practical collision attacks exist. Use SHA-256 or better.'], ['RIPEMD-160', 'ok', FAST_NOTE]],
  224: [['SHA-224', 'ok', FAST_NOTE], ['SHA3-224', 'ok', FAST_NOTE]],
  256: [['SHA-256', 'ok', FAST_NOTE], ['SHA3-256', 'ok', FAST_NOTE], ['BLAKE2s-256', 'ok', FAST_NOTE], ['BLAKE3', 'ok', FAST_NOTE], ['RIPEMD-256', 'ok', FAST_NOTE]],
  384: [['SHA-384', 'ok', FAST_NOTE], ['SHA3-384', 'ok', FAST_NOTE]],
  512: [['SHA-512', 'ok', FAST_NOTE], ['SHA3-512', 'ok', FAST_NOTE], ['BLAKE2b-512', 'ok', FAST_NOTE], ['Whirlpool', 'ok', FAST_NOTE]],
}

/** Identify one hash string. Returns { format, bytes, candidates: [{name, level, note}], salted } or null when it is not recognisable. */
export function identify(raw) {
  const s = raw.trim()
  if (!s) return null
  for (const [re, name, level, note] of MODULAR) if (re.test(s)) return { format: 'prefixed', candidates: [{ name, level, note }] }
  let salted = false
  let body = s
  const sp = /^([0-9a-fA-F]{16,128})[:$]([^\s]{1,})$/.exec(s)
  if (sp && !/^[0-9a-fA-F]{16,128}$/.test(s)) { body = sp[1]; salted = true }
  if (/^(?:0x)?[0-9a-fA-F]+$/.test(body) && (body.replace(/^0x/i, '').length % 2 === 0)) {
    const hex = body.replace(/^0x/i, '')
    const bits = hex.length * 4
    const c = BY_BITS[bits]
    if (c) return { format: 'hex', bits, hex, salted, candidates: c.map(([name, level, note]) => ({ name, level, note })) }
    return { format: 'hex', bits, hex, salted, candidates: [], unknown: `${hex.length} hex characters (${bits} bits) does not match a common hash size.` }
  }
  if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(body)) {
    try {
      const bytes = fromBase64(body)
      const c = BY_BITS[bytes.length * 8]
      if (c && bytes.length >= 16) return { format: 'base64', bits: bytes.length * 8, hex: toHex(bytes), salted, candidates: c.map(([name, level, note]) => ({ name, level, note })) }
    } catch { /* not base64 */ }
  }
  return null
}

const CSS = `
.sx-hid{display:flex;flex-direction:column;gap:12px;padding:16px 18px;border-radius:20px;border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-sm);border-left:5px solid var(--lc,var(--border-strong));animation:sx-in .4s var(--ease) both}
.sx-hid code.src{font-family:var(--mono);font-size:13px;overflow-wrap:anywhere;word-break:break-all;color:var(--text-2)}
.sx-hid-list{display:grid;gap:8px}
.sx-hid-c{display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;padding:9px 12px;border-radius:14px;background:var(--surface-2)}
.sx-hid-c .lv{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;white-space:nowrap;color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent)}
.sx-hid-c .lv .icon{width:13px;height:13px}
.sx-hid-c b{display:block;font-size:14.5px}.sx-hid-c small{color:var(--muted);font-size:12.5px;line-height:1.45}
.sx-hid-c.hit{outline:2px solid var(--success);background:var(--success-soft)}
.lv-pw{--c:#10b981}.lv-ok{--c:#2563eb}.lv-sum{--c:#6b7280}.lv-weak{--c:#d97706}.lv-broken{--c:#dc2626}
@media (max-width:560px){.sx-hid-c{grid-template-columns:1fr}}
`
const COLORS = { pw: '#10b981', ok: '#2563eb', sum: '#6b7280', weak: '#d97706', broken: '#dc2626' }
const IDS = { 'SHA-256': 'sha256', 'SHA-512': 'sha512', 'SHA-384': 'sha384', 'SHA-224': 'sha224', 'SHA3-256': 'sha3-256', 'SHA3-512': 'sha3-512', 'SHA3-384': 'sha3-384', 'SHA3-224': 'sha3-224', BLAKE3: 'blake3', 'BLAKE2b-512': 'blake2b', 'BLAKE2s-256': 'blake2s', MD5: 'md5', 'SHA-1': 'sha1', 'RIPEMD-160': 'ripemd160', 'CRC-32': 'crc32', xxHash32: 'xxh32', 'xxHash64 / XXH3': 'xxh64', XXH128: 'xxh128' }

export function mount(root) {
  useStyles('sx-hashid', CSS)
  const area = textarea({ rows: 5, mono: true, placeholder: 'Paste one or more hashes, one per line\ne.g. 5f4dcc3b5aa765d61d8327deb882cf99', 'aria-label': 'Hashes to identify', oninput: () => run() })
  const guess = input({ mono: true, placeholder: 'Optional: a password you think it is', 'aria-label': 'Password guess', autocomplete: 'off', oninput: () => run() })
  const out = h('div', { class: 'stack' })
  let seq = 0
  const run = debounce(async () => {
    const mine = ++seq
    const lines = area.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 40)
    if (!lines.length) return out.replaceChildren(alert('info', 'Paste a hash above. This reads its length, alphabet and prefix to name the likely algorithms. Nothing is sent anywhere.'))
    const cards = []
    let known = 0
    for (const line of lines) {
      const r = identify(line)
      let hit = new Set()
      if (r && guess.value && r.hex && !r.salted && r.format !== 'prefixed') {
        const ids = [...new Set(r.candidates.map((c) => IDS[c.name]).filter(Boolean))]
        if (ids.length) {
          const digests = await hashBytes(new TextEncoder().encode(guess.value), ids)
          hit = new Set(Object.entries(IDS).filter(([, id]) => matchChecksum(r.hex, { [id]: digests[id] || new Uint8Array() }).length).map(([n]) => n))
        }
      }
      if (r?.candidates.length) known++
      const worst = r?.candidates.length ? (r.candidates.some((c) => c.level === 'pw') ? 'pw' : r.candidates.every((c) => c.level === 'broken') ? 'broken' : r.candidates[0].level) : 'sum'
      cards.push(h('div', { class: 'sx-hid', style: { '--lc': r?.candidates.length ? COLORS[worst] : 'var(--border-strong)' } },
        h('div', { class: 'row', style: 'justify-content:space-between;align-items:flex-start;gap:10px' }, h('code', { class: 'src' }, line.length > 160 ? line.slice(0, 160) + '...' : line), copyBtn(() => line, '', { ariaLabel: 'Copy hash', variant: 'ghost' })),
        !r ? alert('warn', 'Not recognised. It is not a hash format this tool knows (hex, Base64 or a $prefixed password hash).')
          : r.unknown ? alert('warn', r.unknown, r.salted ? ' It looks like "hash:salt".' : '')
            : h('div', { class: 'stack tight' },
              h('div', { class: 'sx-hint' }, r.format === 'prefixed' ? 'Identified from its prefix.' : `${r.bits}-bit ${r.format === 'base64' ? 'Base64' : 'hex'} digest${r.salted ? ', looks like "hash:salt"' : ''}. ${r.candidates.length > 1 ? 'The length alone cannot tell these apart:' : ''}`),
              h('div', { class: 'sx-hid-list' }, r.candidates.map((c) => h('div', { class: ['sx-hid-c', hit.has(c.name) && 'hit'] },
                h('span', { class: ['lv', `lv-${c.level}`] }, icon(L[c.level].icon), L[c.level].label), h('div', h('b', c.name, hit.has(c.name) ? `  matches "${guess.value}"` : ''), h('small', c.note))))))))
    }
    if (mine !== seq) return
    out.replaceChildren(...cards)
  }, 120)

  root.append(h('div', { class: 'sx stack' },
    panel(h('div', { class: 'stack' }, field('Hashes', area), field('Check a guess (optional)', guess, 'For unsalted hashes only: shows which algorithm turns this text into the hash.'))),
    out,
    h('div', { class: 'sx-hint' }, 'Identification is a best guess: many algorithms share a length. Salted or keyed hashes cannot be checked against a guess here.')))
  run()
}
