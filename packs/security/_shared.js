// Shared helpers for the security pack: secure randomness, encodings, AES-GCM, entropy maths and the "vault" look.
// Everything here runs on the device. Nothing is sent anywhere.
import { h, icon, button, copyText, toast, formatNumber } from '../../lib/ui.js'
import { bytesToBase64, base64ToBytes } from '../../lib/files.js'

// ---------- Secure randomness (crypto.getRandomValues, rejection sampling, no modulo bias) ----------
let pool = new Uint32Array(2048)
let poolAt = pool.length
const u32 = () => {
  if (poolAt >= pool.length) { crypto.getRandomValues(pool); poolAt = 0 }
  return pool[poolAt++]
}
/** Uniform integer in [0, n) for 1 <= n <= 2^53. */
export function randBelow(n) {
  if (!(n >= 1) || n > 2 ** 53 || !Number.isInteger(n)) throw new RangeError('Range is out of bounds')
  if (n === 1) return 0
  if (n <= 2 ** 32) {
    const limit = 2 ** 32 - (2 ** 32 % n)
    let x
    do { x = u32() } while (x >= limit)
    return x % n
  }
  const limit = 2 ** 53 - (2 ** 53 % n)
  let x
  do { x = (u32() >>> 11) * 2 ** 32 + u32() } while (x >= limit)
  return x % n
}
/** Uniform float in [0, 1) with 53 random bits. */
export const randFloat = () => ((u32() >>> 11) * 2 ** 32 + u32()) / 2 ** 53
export const pick = (arr) => arr[randBelow(arr.length)]
/** In-place Fisher-Yates shuffle. */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randBelow(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n))

// ---------- Encodings ----------
const HEX = '0123456789abcdef'
export function toHex(bytes) {
  let s = ''
  for (const b of bytes) s += HEX[b >> 4] + HEX[b & 15]
  return s
}
export function fromHex(str) {
  const s = str.replace(/^0x/i, '').replace(/[\s:-]+/g, '')
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('That is not valid hex. Use pairs of 0-9 and a-f.')
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
export const toBase64 = (bytes) => bytesToBase64(bytes)
export const toBase64Url = (bytes) => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export function fromBase64(str) {
  const s = str.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')
  if (/[^A-Za-z0-9+/=]/.test(s)) throw new Error('That is not valid Base64.')
  try { return base64ToBytes(s.padEnd(Math.ceil(s.length / 4) * 4, '=')) } catch { throw new Error('That is not valid Base64.') }
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function fromBase32(str) {
  const s = str.toUpperCase().replace(/[\s-]+/g, '').replace(/=+$/, '')
  if (!s) throw new Error('The secret is empty.')
  let bits = 0, value = 0
  const out = []
  for (const ch of s) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error(`"${ch}" is not a valid Base32 character. Base32 uses A-Z and 2-7.`)
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Uint8Array.from(out)
}
export function toBase32(bytes) {
  let bits = 0, value = 0, s = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) { s += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits) s += B32[(value << (5 - bits)) & 31]
  return s
}
const enc = new TextEncoder()
const dec = new TextDecoder()
export const utf8 = (s) => enc.encode(s)
export const fromUtf8 = (b) => dec.decode(b)

// ---------- Entropy and crack-time maths ----------
export const log2 = Math.log2
export const bitsFor = (poolSize, length) => (poolSize > 1 && length > 0 ? length * Math.log2(poolSize) : 0)

const N = (x, unit) => { const r = Math.max(1, Math.round(x)); return `${r.toLocaleString()} ${unit}${r === 1 ? '' : 's'}` }
const BIG = [[1e33, 'decillion'], [1e30, 'nonillion'], [1e27, 'octillion'], [1e24, 'septillion'], [1e21, 'sextillion'], [1e18, 'quintillion'],
  [1e15, 'quadrillion'], [1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]
/** Human readable duration for a number of seconds ("3 hours", "4.2 billion years"). */
export function humanTime(sec) {
  if (!(sec >= 0)) return '-'
  if (sec < 1) return 'instantly'
  if (sec < 60) return N(sec, 'second')
  if (sec < 3600) return N(sec / 60, 'minute')
  if (sec < 86400) return N(sec / 3600, 'hour')
  if (sec < 2629800) return N(sec / 86400, 'day')
  if (sec < 31557600) return N(sec / 2629800, 'month')
  const years = sec / 31557600
  if (years < 1000) return N(years, 'year')
  for (const [v, name] of BIG) if (years >= v) return `${formatNumber(years / v, years / v < 10 ? 1 : 0)} ${name} years`
  return `${years.toExponential(1).replace('e+', ' x 10^')} years`
}
/** Average time to find a secret with `bits` of entropy at `perSecond` guesses per second (half the space on average). */
export const crackSeconds = (bits, perSecond = 1e10) => 2 ** (bits - 1) / perSecond
export const CRACK_RATES = [
  { id: 'online', label: 'Online, throttled', rate: 100 / 3600, note: '100 guesses per hour (a typical login page)' },
  { id: 'online-fast', label: 'Online, no limit', rate: 10, note: '10 guesses per second' },
  { id: 'slow', label: 'Offline, slow hash', rate: 1e4, note: 'bcrypt, scrypt or Argon2 on a stolen database' },
  { id: 'fast', label: 'Offline, fast hash', rate: 1e10, note: 'a GPU rig against MD5, SHA-1 or SHA-256' },
]
/** 0..4 rating for a number of random bits. */
export function ratingOf(bits) {
  if (bits < 28) return { level: 0, label: 'Very weak' }
  if (bits < 40) return { level: 1, label: 'Weak' }
  if (bits < 64) return { level: 2, label: 'Fair' }
  if (bits < 90) return { level: 3, label: 'Strong' }
  return { level: 4, label: 'Excellent' }
}
export const formatBits = (b) => (b >= 100 ? Math.round(b) : Math.round(b * 10) / 10).toLocaleString() + ' bits'

// ---------- AES-256-GCM with PBKDF2-SHA256 (versioned container) ----------
// Binary layout (v1): [version=1][iterations u32 big-endian][salt 16][iv 12][ciphertext + 16-byte tag]. AAD = the first 5 bytes.
// Text form: "v1." + Base64(binary). The password is Unicode NFC-normalised then UTF-8 encoded.
export const PBKDF2_ITERATIONS = 600_000
const HEAD = 5
async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', utf8(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function encryptBytes(data, password, iterations = PBKDF2_ITERATIONS) {
  if (!password) throw new Error('Enter a password first.')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const head = new Uint8Array(HEAD)
  head[0] = 1
  new DataView(head.buffer).setUint32(1, iterations)
  const key = await deriveKey(password, salt, iterations)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, key, data))
  const out = new Uint8Array(HEAD + 28 + ct.length)
  out.set(head)
  out.set(salt, HEAD)
  out.set(iv, HEAD + 16)
  out.set(ct, HEAD + 28)
  return out
}
export async function decryptBytes(blob, password) {
  if (blob.length < HEAD + 28 + 16 || blob[0] !== 1) throw new Error('This does not look like data encrypted with this tool (unknown format or version).')
  if (!password) throw new Error('Enter the password first.')
  const iterations = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(1)
  if (iterations < 100_000 || iterations > 5_000_000) throw new Error('The encrypted data has an unsupported iteration count.')
  const head = blob.slice(0, HEAD)
  const key = await deriveKey(password, blob.slice(HEAD, HEAD + 16), iterations)
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(HEAD + 16, HEAD + 28), additionalData: head }, key, blob.slice(HEAD + 28)))
  } catch {
    throw new Error('Wrong password, or the data was changed after it was encrypted.')
  }
}
export const sealText = async (text, password) => 'v1.' + toBase64(await encryptBytes(utf8(text), password))
export async function openText(sealed, password) {
  const s = sealed.trim().replace(/^v1\./, '')
  let bytes
  try { bytes = fromBase64(s) } catch { throw new Error('That is not valid encrypted text. Paste the whole string, starting with v1.') }
  return fromUtf8(await decryptBytes(bytes, password))
}

// ---------- Look and feel ----------
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const CSS = `
.sx{--sx-digit:#2563eb;--sx-sym:#db2777;--sx-hue:var(--accent)}
:root[data-theme="dark"] .sx{--sx-digit:#7db1ff;--sx-sym:#ff8cc6}
.sx input::-ms-reveal,.sx input::-ms-clear{display:none}
.sx .seg{align-self:flex-start}
.sx-k{font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:650;display:flex;align-items:center;gap:7px}
.sx-k .icon{width:14px;height:14px;color:var(--sx-hue)}
.sx-d{color:var(--sx-digit)}.sx-s{color:var(--sx-sym)}
.sx-vault{position:relative;isolation:isolate;overflow:hidden;border-radius:24px;padding:20px 22px 18px;border:1.5px solid transparent;
  background:linear-gradient(var(--surface),var(--surface)) padding-box,var(--brand) border-box;background-size:100% 100%,220% 220%;box-shadow:var(--shadow);animation:sx-hue 12s linear infinite}
.sx-vault::before{content:"";position:absolute;z-index:-1;right:-12%;top:-55%;width:62%;height:150%;pointer-events:none;
  background:radial-gradient(closest-side,color-mix(in srgb,var(--accent) 17%,transparent),transparent);animation:sx-drift 9s ease-in-out infinite alternate}
.sx-vault::after{content:"";position:absolute;z-index:-1;left:-10%;bottom:-70%;width:50%;height:120%;pointer-events:none;
  background:radial-gradient(closest-side,color-mix(in srgb,var(--accent-2) 12%,transparent),transparent);animation:sx-drift 12s ease-in-out infinite alternate-reverse}
@keyframes sx-hue{to{background-position:0 0,100% 100%}}
@keyframes sx-drift{to{transform:translate(-14%,10%) scale(1.18)}}
.sx-vault-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.sx-vault-actions{display:flex;gap:8px;align-items:center}
.sx-pass{font-family:var(--mono);font-size:clamp(19px,3.3vw,30px);line-height:1.5;letter-spacing:.02em;overflow-wrap:anywhere;word-break:break-all;min-height:1.5em;font-weight:500;user-select:all;color:var(--text)}
.sx-pass.sx-empty{color:var(--muted);font-family:var(--font);font-size:16px;user-select:none}
.sx-pass.sx-pop{animation:sx-pop .45s var(--spring)}
@keyframes sx-pop{from{opacity:.4;transform:translateY(6px) scale(.985)}}
.sx-vault-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:16px}
.sx-meter{display:flex;align-items:center;gap:12px;flex:1;min-width:200px}
.sx-meter-bar{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;flex:1;min-width:120px}
.sx-meter-bar i{height:7px;border-radius:99px;background:var(--surface-3);transition:background-color .45s var(--ease),transform .45s var(--spring)}
.sx-meter-bar i.on{background:var(--mc);transform:scaleY(1.35);box-shadow:0 0 14px -2px color-mix(in srgb,var(--mc) 70%,transparent)}
.sx-meter[data-level="0"]{--mc:#ef4444}.sx-meter[data-level="1"]{--mc:#f97316}.sx-meter[data-level="2"]{--mc:#eab308}.sx-meter[data-level="3"]{--mc:#22c55e}.sx-meter[data-level="4"]{--mc:#10b981}
.sx-meter-label{font-weight:650;font-size:13.5px;color:var(--mc);min-width:74px;white-space:nowrap}
.sx-meta-text{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;display:flex;flex-wrap:wrap;gap:4px 16px}
.sx-meta-text b{color:var(--text);font-weight:600}
.sx-rows{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:18px;background:var(--surface);overflow:hidden;box-shadow:var(--shadow-sm)}
.sx-rows-top{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:10px 12px 10px 16px;background:var(--surface-2);border-bottom:1px solid var(--border)}
.sx-rows-body{max-height:440px;overflow:auto}
.sx-row{display:flex;gap:10px;align-items:center;padding:9px 10px 9px 16px;border-bottom:1px solid var(--border);animation:sx-in .38s var(--ease) both;animation-delay:calc(min(var(--i,0),24)*16ms);transition:background .15s}
.sx-row:last-child{border-bottom:0}.sx-row:hover{background:var(--surface-2)}
.sx-row code{flex:1;min-width:0;font-family:var(--mono);font-size:14.5px;overflow-wrap:anywhere;word-break:break-all;user-select:all}
.sx-row .sx-n{font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:22px}
@keyframes sx-in{from{opacity:0;transform:translateY(8px)}}
.sx-chip{position:relative;display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 14px 0 12px;border-radius:999px;border:1px solid var(--border);background:var(--surface);cursor:pointer;
  font-size:13.5px;font-weight:550;user-select:none;transition:background .2s,border-color .2s,color .2s,transform .2s var(--spring),box-shadow .2s}
.sx-chip:hover{border-color:var(--border-strong);transform:translateY(-1px)}
.sx-chip input{position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0;cursor:pointer}
.sx-chip .icon{width:0;height:14px;opacity:0;transition:width .2s var(--ease),opacity .2s;margin-right:-4px}
.sx-chip .sx-sample{font-family:var(--mono);font-size:12px;opacity:.65;font-weight:500}
.sx-chip:has(input:checked){background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 55%,var(--border));color:var(--accent);box-shadow:0 6px 16px -10px var(--accent)}
.sx-chip:has(input:checked) .icon{width:14px;opacity:1;margin-right:0}
.sx-chip:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.sx-chip:has(input:disabled){opacity:.45;cursor:not-allowed}.sx-chip input:disabled{cursor:not-allowed}
.sx-chips{display:flex;flex-wrap:wrap;gap:8px}
.sx-presets{display:flex;gap:8px;flex-wrap:wrap}
.sx-preset{height:34px;padding:0 13px;border-radius:999px;border:1px dashed var(--border-strong);background:transparent;color:var(--text-2);font-size:13px;font-weight:550;cursor:pointer;transition:all .2s var(--ease)}
.sx-preset:hover{border-style:solid;border-color:var(--accent);color:var(--accent);background:var(--accent-soft);transform:translateY(-1px)}
.sx-preset[aria-pressed="true"]{border-style:solid;border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.sx-spin{animation:sx-spin .55s var(--ease)}@keyframes sx-spin{to{transform:rotate(360deg)}}
.sx-copied{background:var(--success-soft)!important;color:var(--success)!important;border-color:color-mix(in srgb,var(--success) 40%,transparent)!important}
.sx-burst{position:fixed;z-index:500;width:0;height:0;pointer-events:none}
.sx-burst i{position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:var(--c);animation:sx-burst .72s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes sx-burst{from{transform:translate(0,0) scale(1.2);opacity:1}to{transform:translate(var(--dx),var(--dy)) scale(.15);opacity:0}}
.sx-hero{position:relative;overflow:hidden;border-radius:22px;padding:18px 20px;border:1.5px solid transparent;
  background:linear-gradient(var(--surface),var(--surface)) padding-box,var(--brand) border-box;box-shadow:var(--shadow)}
.sx-hero .lab{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.sx-hero .dig{font-family:var(--mono);font-size:clamp(14px,2vw,19px);line-height:1.55;overflow-wrap:anywhere;word-break:break-all;user-select:all}
.sx-hero .dig span{animation:sx-type .5s var(--ease) both;animation-delay:calc(var(--i)*14ms);display:inline-block}
@keyframes sx-type{from{opacity:0;transform:translateY(5px);filter:blur(3px)}}
.sx-hero .note{margin-top:10px;font-size:12.5px;color:var(--muted)}
.sx-cmp{display:flex;gap:12px;align-items:center;flex-wrap:wrap;min-height:34px}
.sx-file{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:16px;border:1px solid var(--border);background:var(--surface)}
.sx-file .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
.sx-file .meta{min-width:0;flex:1}.sx-file .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sx-file .size{font-size:12.5px;color:var(--muted)}
.sx-seclabel{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.sx-hint{font-size:12.5px;color:var(--muted)}
.sx-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr))}
.sx-lens{display:flex;align-items:center;gap:10px}.sx-lens .input{max-width:92px;text-align:center;font-variant-numeric:tabular-nums}.sx-lens input[type=range]{flex:1}
.sx-sub{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--muted)}
.sx-sub .icon{width:14px;height:14px}
.sx-stamp{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;font-weight:650;font-size:14px;animation:sx-stamp .55s var(--spring) both}
.sx-stamp .icon{width:18px;height:18px}
.sx-stamp.ok{background:var(--success-soft);color:var(--success);border:1px solid color-mix(in srgb,var(--success) 40%,transparent)}
.sx-stamp.bad{background:var(--danger-soft);color:var(--danger);border:1px solid color-mix(in srgb,var(--danger) 40%,transparent)}
@keyframes sx-stamp{from{opacity:0;transform:scale(1.8) rotate(-6deg)}60%{transform:scale(.96) rotate(1deg)}}
.sx-skel{height:22px;border-radius:8px;background:linear-gradient(90deg,var(--surface-2),var(--surface-3),var(--surface-2));background-size:200% 100%;animation:sx-shim 1.2s linear infinite}
@keyframes sx-shim{to{background-position:-200% 0}}
.sx-mono{font-family:var(--mono);overflow-wrap:anywhere;word-break:break-all}
.sx-cols{display:grid;gap:16px;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
@media (max-width:900px){.sx-cols{grid-template-columns:minmax(0,1fr)}}
@media (max-width:720px){.sx-vault{padding:16px 16px 14px;border-radius:20px}.sx-chip{min-height:40px}.sx-row code{font-size:13.5px}}
@media (prefers-reduced-motion:reduce){.sx-vault,.sx-vault::before,.sx-vault::after{animation:none}}
`
let styled = false
/** Injects the shared stylesheet once. Every selector starts with .sx so nothing leaks into the rest of the site. */
export function useStyles(extraId, extraCss) {
  if (!styled && !document.getElementById('sx-shared')) {
    document.head.append(Object.assign(document.createElement('style'), { id: 'sx-shared', textContent: CSS }))
  }
  styled = true
  if (extraId && !document.getElementById(extraId)) document.head.append(Object.assign(document.createElement('style'), { id: extraId, textContent: extraCss }))
}

/** Colour digits and symbols differently so a password is easier to read and read out. */
export function paint(el, text) {
  const frag = document.createDocumentFragment()
  let buf = ''
  const flush = () => { if (buf) { frag.append(buf); buf = '' } }
  for (const ch of text) {
    if (/\d/.test(ch)) { flush(); frag.append(h('span', { class: 'sx-d' }, ch)) }
    else if (/[^\p{L}\p{N}\s]/u.test(ch)) { flush(); frag.append(h('span', { class: 'sx-s' }, ch)) }
    else buf += ch
  }
  flush()
  el.replaceChildren(frag)
}

const GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*?'
/** Decrypt-style reveal: characters settle left to right. Cosmetic only (not used for secrets). */
export function scramble(el, text, { ms = 460, onDone = (t) => { el.textContent = t } } = {}) {
  clearInterval(el._sx)
  const chars = [...text]
  if (reducedMotion() || chars.length < 2) { onDone(text); return }
  const start = performance.now()
  el._sx = setInterval(() => {
    const t = (performance.now() - start) / ms
    if (t >= 1) { clearInterval(el._sx); onDone(text); return }
    const settled = Math.floor(t * chars.length)
    el.textContent = chars.map((c, i) => (i < settled || c === ' ' ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join('')
  }, 34)
}

/** Little confetti burst at an element (fixed, so button overflow never clips it). */
export function burst(el, colors = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#22c55e', '#0ea5e9']) {
  if (reducedMotion() || !el?.isConnected) return
  const r = el.getBoundingClientRect()
  const host = h('span', { class: 'sx-burst', 'aria-hidden': 'true', style: { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` } })
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.random() * 0.5
    const d = 30 + Math.random() * 26
    host.append(h('i', { style: { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d}px`, '--c': colors[i % colors.length] } }))
  }
  document.body.append(host)
  setTimeout(() => host.remove(), 800)
}

/** Count a number up to `to` (cosmetic). fmt turns the number into text. */
export function countUp(el, to, fmt = (n) => Math.round(n).toLocaleString(), ms = 500) {
  cancelAnimationFrame(el._cu)
  const from = el._cuv ?? 0
  el._cuv = to
  if (reducedMotion() || from === to) { el.textContent = fmt(to); return }
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms)
    el.textContent = fmt(from + (to - from) * (1 - (1 - t) ** 3))
    if (t < 1) el._cu = requestAnimationFrame(step)
  }
  el._cu = requestAnimationFrame(step)
}

/** Copy button that flashes green with a little burst. getText may return '' (shows a hint instead). */
export function copyBtn(getText, label = 'Copy', opts = {}) {
  const btn = button(label, { icon: 'copy', size: 'sm', ...opts })
  const original = [...btn.childNodes]
  let timer
  btn.addEventListener('click', async () => {
    const text = typeof getText === 'function' ? getText() : getText
    if (text == null || text === '') return toast('Nothing to copy yet', 'info')
    if (!(await copyText(text))) return
    clearTimeout(timer)
    btn.classList.add('sx-copied')
    btn.replaceChildren(icon('check'), ...(label ? [h('span', 'Copied')] : []))
    burst(btn)
    timer = setTimeout(() => { btn.classList.remove('sx-copied'); btn.replaceChildren(...original) }, 1400)
  })
  return btn
}

/** Pill checkbox. Returns the label; .input is the checkbox. */
export function chip(label, checked, onChange, { sample, title, disabled } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, onchange: (e) => onChange?.(e.target.checked, e) })
  const el = h('label', { class: 'sx-chip', title: title || null }, input, icon('check'), h('span', label), sample ? h('span', { class: 'sx-sample' }, sample) : null)
  el.input = input
  return el
}

/** 5-segment strength meter. set(bits) or set({level, label}). */
export function meter() {
  const segs = Array.from({ length: 5 }, () => h('i'))
  const label = h('span', { class: 'sx-meter-label' }, '-')
  const el = h('div', { class: 'sx-meter', 'data-level': '0', role: 'img', 'aria-label': 'Strength meter' }, h('div', { class: 'sx-meter-bar' }, segs), label)
  el.set = (rating) => {
    const r = typeof rating === 'number' ? ratingOf(rating) : rating
    el.dataset.level = r.level
    segs.forEach((s, i) => s.classList.toggle('on', i <= r.level))
    label.textContent = r.label
    el.setAttribute('aria-label', `Strength: ${r.label}`)
  }
  el.clear = () => { segs.forEach((s) => s.classList.remove('on')); label.textContent = '-' }
  return el
}

/** Password field with a show/hide button. el.input is the <input>. */
export function secretInput({ placeholder = '', onInput, value = '', ariaLabel = 'Password', autocomplete = 'off' } = {}) {
  const input = h('input', { class: 'input mono', type: 'password', placeholder, value, autocomplete, spellcheck: false, autocapitalize: 'off', 'aria-label': ariaLabel, oninput: (e) => onInput?.(e.target.value, e) })
  const eye = button('', { icon: 'eye', variant: 'secondary', ariaLabel: 'Show password', title: 'Show or hide' })
  eye.addEventListener('click', () => {
    const show = input.type === 'password'
    input.type = show ? 'text' : 'password'
    eye.replaceChildren(icon(show ? 'eye-off' : 'eye'))
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password')
  })
  const el = h('div', { class: 'input-group' }, input, eye)
  el.input = input
  return el
}

/**
 * The hero output used by the generators. One value -> a glowing "vault" card; several -> a scrollable list with Copy all and Download.
 * paintValue(el, text) customises how a single value is drawn (default colours digits and symbols).
 */
export function results({ label = 'Result', ic = 'key-round', onRegenerate, paintValue = paint, emptyText = 'Choose at least one option', filename = 'values.txt', showMeter = true } = {}) {
  const pass = h('div', { class: 'sx-pass sx-empty', 'aria-live': 'polite' }, emptyText)
  const regen = onRegenerate ? button('', { icon: 'refresh-cw', variant: 'secondary', size: 'sm', ariaLabel: 'Generate again', title: 'Generate again' }) : null
  let current = []
  const copy = copyBtn(() => current[0], 'Copy')
  const m = meter()
  const metaText = h('div', { class: 'sx-meta-text' })
  const vault = h('div', { class: 'sx-vault' },
    h('div', { class: 'sx-vault-top' }, h('div', { class: 'sx-k' }, icon(ic), label), h('div', { class: 'sx-vault-actions' }, regen, copy)),
    pass,
    showMeter ? h('div', { class: 'sx-vault-meta' }, m, metaText) : metaText)
  const list = h('div', { class: 'sx-rows-body' })
  const listTitle = h('div', { class: 'sx-k' }, icon(ic), label)
  const listMeta = h('span', { class: 'sx-hint' })
  const rows = h('div', { class: 'sx-rows' },
    h('div', { class: 'sx-rows-top' }, h('div', { class: 'row', style: 'gap:12px' }, listTitle, listMeta),
      h('div', { class: 'row', style: 'gap:8px' }, copyBtn(() => current.join('\n'), 'Copy all'),
        button('Download', { icon: 'download', size: 'sm', onClick: () => download(current.join('\n') + '\n', filename) }))),
    list)
  const el = h('div', { class: 'stack' }, vault, rows)
  rows.hidden = true
  if (regen) regen.addEventListener('click', () => { regen.firstChild?.classList.remove('sx-spin'); void regen.offsetWidth; regen.firstChild?.classList.add('sx-spin'); onRegenerate() })
  return Object.assign(el, {
    /** values: string[]; meta: {bits, text} (bits drives the meter) */
    show(values, meta = {}, { animate = true } = {}) {
      current = values
      const many = values.length > 1
      vault.hidden = many
      rows.hidden = !many || !values.length
      if (!values.length) { pass.className = 'sx-pass sx-empty'; pass.textContent = emptyText; m.clear(); metaText.textContent = ''; return }
      if (many) {
        listMeta.textContent = `${values.length.toLocaleString()} values${meta.text ? ' - ' + meta.text : ''}`
        list.replaceChildren(...values.slice(0, 250).map((v, i) => {
          const code = h('code')
          paintValue(code, v)
          return h('div', { class: 'sx-row', style: { '--i': i } }, h('span', { class: 'sx-n' }, i + 1), code, copyBtn(() => v, '', { ariaLabel: `Copy value ${i + 1}`, variant: 'ghost' }))
        }))
        if (values.length > 250) list.append(h('div', { class: 'sx-hint', style: 'padding:10px 16px' }, `Showing the first 250. Copy all or Download includes all ${values.length.toLocaleString()}.`))
        return
      }
      pass.className = 'sx-pass'
      const draw = (t) => paintValue(pass, t)
      if (animate) {
        scramble(pass, values[0], { onDone: (t) => { draw(t); pass.classList.remove('sx-pop'); void pass.offsetWidth; pass.classList.add('sx-pop') } })
      } else { clearInterval(pass._sx); draw(values[0]) }
      if (meta.bits != null) m.set(meta.bits)
      metaText.replaceChildren(...(meta.nodes || []))
    },
  })
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  const a = h('a', { href: url, download: name, style: 'display:none' })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
export const downloadText = download

/** Readable stat line for a vault: "<b>96 bits</b> of entropy - crack time". */
export function metaLine(bits, extra) {
  const r = CRACK_RATES[3]
  return [
    h('span', h('b', formatBits(bits)), ' of entropy'),
    h('span', { title: r.note }, 'Offline GPU attack: ', h('b', humanTime(crackSeconds(bits, r.rate)))),
    extra ? h('span', extra) : null,
  ].filter(Boolean)
}

/** Persist simple option objects (never secrets) in localStorage via lib/store. */
export { load, save } from '../../lib/store.js'
