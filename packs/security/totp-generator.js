// 2FA code generator: RFC 6238 TOTP (SHA-1/256/512, 6-8 digits, any period) from a Base32 secret, an otpauth:// URI, a Google Authenticator export or a QR image.
// Secrets stay in memory unless the visitor opts in to saving them on this device (optionally encrypted with a password).
import { h, svg, icon, field, input, panel, button, segmented, toggle, alert, clear, dropzone, toast, copyText, number, busy, onCleanup } from '../../lib/ui.js'
import { script } from '../../lib/libs.js'
import { loadImage, toCanvas } from '../../lib/image.js'
import { remove } from '../../lib/store.js'
import { useStyles, copyBtn, secretInput, fromBase32, toBase32, fromBase64, sealText, openText, burst, load, save } from './_shared.js'

const JSQR = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
const STORE_KEY = 'totp-generator:vault'
const ALGOS = [['SHA-1', 'SHA-1'], ['SHA-256', 'SHA-256'], ['SHA-512', 'SHA-512']]

// ---------- Core maths (exported for tests) ----------
/** RFC 6238 code for the 30-second (or `period`) window containing `time` (ms). secret is raw bytes. */
export async function totp({ secret, algo = 'SHA-1', digits = 6, period = 30, time = Date.now() }) {
  if (!secret?.length) throw new Error('The secret is empty.')
  const msg = new Uint8Array(8)
  new DataView(msg.buffer).setBigUint64(0, BigInt(Math.floor(time / 1000 / period)))
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: algo }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))
  const o = mac[mac.length - 1] & 15
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}
const ALGO_NAMES = { SHA1: 'SHA-1', 'SHA-1': 'SHA-1', SHA256: 'SHA-256', 'SHA-256': 'SHA-256', SHA512: 'SHA-512', 'SHA-512': 'SHA-512' }

/** Parse otpauth://totp/Issuer:name?secret=...&issuer=...&algorithm=...&digits=...&period=... */
export function parseOtpauth(uri) {
  const m = /^otpauth:\/\/(\w+)\/([^?]*)\??(.*)$/i.exec(uri.trim())
  if (!m) throw new Error('That is not an otpauth:// link.')
  if (m[1].toLowerCase() === 'hotp') throw new Error('This is a counter-based (HOTP) code. Only time-based (TOTP) codes are supported.')
  if (m[1].toLowerCase() !== 'totp') throw new Error(`Unsupported 2FA type "${m[1]}".`)
  const q = new URLSearchParams(m[3])
  let label = ''
  try { label = decodeURIComponent(m[2]) } catch { label = m[2] }
  let issuer = q.get('issuer') || ''
  const colon = label.indexOf(':')
  if (colon > -1) { issuer ||= label.slice(0, colon).trim(); label = label.slice(colon + 1).trim() }
  const secret = (q.get('secret') || '').replace(/\s+/g, '')
  if (!secret) throw new Error('The link has no secret in it.')
  const algo = ALGO_NAMES[(q.get('algorithm') || 'SHA1').toUpperCase()]
  if (!algo) throw new Error(`Unsupported algorithm "${q.get('algorithm')}". Use SHA-1, SHA-256 or SHA-512.`)
  const digits = +(q.get('digits') || 6)
  const period = +(q.get('period') || 30)
  return { label, issuer, secret, algo, digits: digits >= 6 && digits <= 10 ? digits : 6, period: period >= 5 && period <= 300 ? period : 30 }
}

/** Minimal protobuf reader: returns [fieldNumber, varint | Uint8Array] pairs. */
function pbRead(buf) {
  const out = []
  let p = 0
  const varint = () => {
    let v = 0, s = 0, b
    do { if (p >= buf.length) throw new Error('That export data is damaged.'); b = buf[p++]; v += (b & 0x7f) * 2 ** s; s += 7 } while (b & 0x80)
    return v
  }
  while (p < buf.length) {
    const tag = varint(), wire = tag & 7, f = Math.floor(tag / 8)
    if (wire === 0) out.push([f, varint()])
    else if (wire === 2) { const len = varint(); out.push([f, buf.subarray(p, p + len)]); p += len }
    else if (wire === 1) p += 8
    else if (wire === 5) p += 4
    else throw new Error('That export data is damaged.')
  }
  return out
}

/** Google Authenticator "Export accounts" QR: otpauth-migration://offline?data=<base64 protobuf>. Returns an array of accounts. */
export function parseMigration(uri) {
  const m = /[?&]data=([^&\s]+)/.exec(uri)
  if (!m) throw new Error('That export link has no data in it.')
  const dec = new TextDecoder()
  const out = []
  for (const [f, v] of pbRead(fromBase64(decodeURIComponent(m[1])))) {
    if (f !== 1 || typeof v === 'number') continue
    const acc = { secret: '', label: '', issuer: '', algo: 'SHA-1', digits: 6, period: 30, type: 2 }
    for (const [fi, x] of pbRead(v)) {
      if (fi === 1 && typeof x !== 'number') acc.secret = toBase32(x)
      else if (fi === 2 && typeof x !== 'number') acc.label = dec.decode(x)
      else if (fi === 3 && typeof x !== 'number') acc.issuer = dec.decode(x)
      else if (fi === 4) acc.algo = { 1: 'SHA-1', 2: 'SHA-256', 3: 'SHA-512' }[x] || 'unsupported'
      else if (fi === 5) acc.digits = x === 2 ? 8 : 6
      else if (fi === 6) acc.type = x
    }
    out.push(acc)
  }
  const usable = out.filter((a) => a.secret && a.type === 2 && a.algo !== 'unsupported')
  if (!usable.length) throw new Error(out.length ? 'None of the exported accounts are time-based (TOTP) with SHA-1/256/512.' : 'No accounts found in that export.')
  return usable.map(({ type, ...a }) => a)
}

/** Decode the first QR code in an image file. Returns its text. */
export async function readQr(file) {
  await script(JSQR)
  const img = await loadImage(file)
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height
  for (const scale of [Math.min(1, 1600 / Math.max(w0, h0)), 0.6, 0.35, 1]) {
    const c = toCanvas(img, Math.max(40, w0 * scale), Math.max(40, h0 * scale), { background: '#ffffff' })
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height)
    const r = window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' })
    if (r?.data) return r.data
  }
  throw new Error('No QR code found in that image. Try a sharper, larger screenshot with the whole code visible.')
}

const group = (code) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code.length === 7 ? `${code.slice(0, 3)} ${code.slice(3)}` : code)
const cleanSecret = (s) => s.replace(/[\s-]+/g, '').toUpperCase()

const CSS = `
.sx-tp-hero{display:grid;grid-template-columns:auto 1fr auto;gap:22px;align-items:center;position:relative;overflow:hidden;border-radius:24px;padding:22px 26px;border:1.5px solid transparent;
  background:linear-gradient(var(--surface),var(--surface)) padding-box,var(--brand) border-box;box-shadow:var(--shadow)}
.sx-tp-hero::before{content:"";position:absolute;z-index:0;right:-10%;top:-60%;width:55%;height:160%;pointer-events:none;background:radial-gradient(closest-side,color-mix(in srgb,var(--accent) 15%,transparent),transparent)}
.sx-tp-hero>*{position:relative;z-index:1}
.sx-tring{position:relative;width:96px;height:96px;flex:none}
.sx-tring svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
.sx-tring .bg{fill:none;stroke:var(--surface-3);stroke-width:7}
.sx-tring .fg{fill:none;stroke:var(--tc,var(--accent));stroke-width:7;stroke-linecap:round;stroke-dasharray:276.46;transition:stroke .3s;filter:drop-shadow(0 0 6px color-mix(in srgb,var(--tc,var(--accent)) 50%,transparent))}
.sx-tring b{position:absolute;inset:0;display:grid;place-items:center;font-size:26px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.sx-tring.low{--tc:#f59e0b}.sx-tring.crit{--tc:#ef4444}
.sx-tring.crit b{animation:sx-pulse 1s ease-in-out infinite}
@keyframes sx-pulse{50%{transform:scale(1.12)}}
.sx-code{font-family:var(--mono);font-size:clamp(34px,7vw,56px);font-weight:600;letter-spacing:.06em;line-height:1.05;font-variant-numeric:tabular-nums;user-select:all;cursor:pointer;white-space:nowrap}
.sx-code.dim{color:var(--muted);opacity:.55;user-select:none;cursor:default}
.sx-code.tick{animation:sx-pop .45s var(--spring)}
.sx-tp-meta{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.sx-tp-meta b{color:var(--text-2);font-family:var(--mono);font-weight:560}
.sx-tp-actions{display:flex;flex-direction:column;gap:8px;align-items:stretch}
.sx-acc{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;padding:12px 14px 12px 16px;border-radius:18px;border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-sm);animation:sx-in .4s var(--ease) both}
.sx-acc .sx-tring{width:52px;height:52px}.sx-acc .sx-tring b{font-size:15px}.sx-acc .sx-tring .bg,.sx-acc .sx-tring .fg{stroke-width:9}
.sx-acc .sx-code{font-size:clamp(24px,5vw,32px)}
.sx-acc .nm{font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sx-acc .nm small{font-weight:400;color:var(--muted);margin-left:6px}
.sx-acc .mt{min-width:0}
.sx-acc .ops{display:flex;gap:4px}
.sx-accs{display:grid;gap:10px}
.sx-drop-mini .dropzone{padding:14px 16px}
@media (max-width:640px){.sx-tp-hero{grid-template-columns:auto 1fr;padding:18px;gap:16px}.sx-tp-actions{grid-column:1/-1;flex-direction:row}.sx-tp-actions .btn{flex:1}.sx-tring{width:78px;height:78px}.sx-tring b{font-size:22px}}
@media (max-width:420px){.sx-acc{grid-template-columns:auto 1fr;}.sx-acc .ops{grid-column:1/-1;justify-content:flex-end}}
@media (prefers-reduced-motion:reduce){.sx-tring.crit b{animation:none}}
`

export function mount(root, { signal }) {
  useStyles('sx-totp', CSS)
  /** @type {{id:string,label:string,issuer:string,secret:string,algo:string,digits:number,period:number}[]} */
  let accounts = []
  let remember = false
  let vaultPw = ''
  let nextId = 1
  const draft = { secret: '', label: '', algo: 'SHA-1', digits: 6, period: 30 }

  // ---------- code rendering, shared by the hero and the account rows ----------
  const CIRC = 276.46
  /** A live code view bound to a getter that returns the account-like object (or null). */
  function liveCode(getAcc, { withNext } = {}) {
    const fg = svg('circle', { class: 'fg', cx: 50, cy: 50, r: 44, 'stroke-dashoffset': CIRC })
    const secs = h('b', '-')
    const ringEl = h('div', { class: 'sx-tring', role: 'img', 'aria-label': 'Time left for this code' }, svg('svg', { viewBox: '0 0 100 100' }, svg('circle', { class: 'bg', cx: 50, cy: 50, r: 44 }), fg), secs)
    const codeEl = h('div', { class: 'sx-code dim', title: 'Click to copy', 'aria-live': 'off' }, '------')
    const nextEl = h('b', '------')
    let counter = null, key = '', code = '', nextCode = '', busyCalc = false
    const view = { ringEl, codeEl, nextEl, get code() { return code } }
    view.update = async (now = Date.now()) => {
      const a = getAcc()
      if (!a) {
        if (key !== '') { code = ''; nextCode = ''; key = ''; counter = null; codeEl.textContent = '------'; codeEl.classList.add('dim'); secs.textContent = '-'; fg.setAttribute('stroke-dashoffset', CIRC); ringEl.className = 'sx-tring'; nextEl.textContent = '------' }
        return
      }
      const t = now / 1000
      const rem = a.period - (t % a.period)
      const c = Math.floor(t / a.period)
      const k = `${a.secret}|${a.algo}|${a.digits}|${a.period}`
      secs.textContent = String(Math.ceil(rem))
      fg.setAttribute('stroke-dashoffset', String(CIRC * (1 - rem / a.period)))
      ringEl.className = `sx-tring${rem <= 5 ? (rem <= 3 ? ' crit' : ' low') : ''}`
      if ((c !== counter || k !== key) && !busyCalc) {
        busyCalc = true
        try {
          const bytes = fromBase32(a.secret)
          const [now1, next1] = await Promise.all([totp({ secret: bytes, algo: a.algo, digits: a.digits, period: a.period, time: now }), totp({ secret: bytes, algo: a.algo, digits: a.digits, period: a.period, time: now + a.period * 1000 })])
          const changed = key === k && counter !== null
          counter = c; key = k; code = now1; nextCode = next1
          codeEl.textContent = group(now1)
          codeEl.classList.remove('dim')
          if (changed) { codeEl.classList.remove('tick'); void codeEl.offsetWidth; codeEl.classList.add('tick') }
          nextEl.textContent = group(next1)
        } catch { code = ''; codeEl.textContent = '------'; codeEl.classList.add('dim') } finally { busyCalc = false }
      }
    }
    codeEl.addEventListener('click', () => { if (code) copyText(code) })
    return view
  }

  // ---------- hero (the secret being typed) ----------
  const status = h('div', { 'aria-live': 'polite' })
  const draftAcc = () => {
    const secret = cleanSecret(draft.secret)
    if (!secret) return null
    try { if (!fromBase32(secret).length) return null } catch { return null }
    return { secret, algo: draft.algo, digits: draft.digits, period: draft.period }
  }
  const hero = liveCode(draftAcc)
  const copyHero = copyBtn(() => hero.code, 'Copy code')
  const addBtn = button('Add to list', { icon: 'plus', variant: 'primary' })
  const heroLabel = h('div', { class: 'sx-k' }, icon('smartphone'), 'Your 2FA code')
  const specEl = h('span', 'SHA-1 - 6 digits - 30 s')
  const heroEl = h('div', { class: 'sx-tp-hero' }, hero.ringEl,
    h('div', heroLabel, hero.codeEl, h('div', { class: 'sx-tp-meta' }, h('span', 'Next: ', hero.nextEl), specEl)),
    h('div', { class: 'sx-tp-actions' }, copyHero, addBtn))

  // ---------- input panel ----------
  const secretBox = secretInput({ placeholder: 'Base32 secret (JBSW Y3DP ...) or otpauth:// link', ariaLabel: 'Secret key or otpauth link', onInput: (v) => onSecretText(v) })
  secretBox.input.autocomplete = 'off'
  const nameIn = input({ placeholder: 'e.g. GitHub (optional)', 'aria-label': 'Account name', oninput: (e) => { draft.label = e.target.value } })
  const algoSeg = segmented(ALGOS, draft.algo, (v) => { draft.algo = v; refreshSpec(); tick() }, 'Algorithm')
  const digitsSeg = segmented([[6, '6'], [7, '7'], [8, '8']], draft.digits, (v) => { draft.digits = v; refreshSpec(); tick() }, 'Digits')
  const periodNum = number(draft.period, { min: 5, max: 300, step: 1, ariaLabel: 'Period in seconds', onInput: (n) => { if (Number.isFinite(n) && n >= 5 && n <= 300) { draft.period = Math.round(n); refreshSpec(); tick() } } })
  const periodSeg = segmented([[30, '30 s'], [60, '60 s']], draft.period, (v) => { draft.period = v; periodNum.value = v; refreshSpec(); tick() }, 'Period')

  function refreshSpec() { specEl.textContent = `${draft.algo} - ${draft.digits} digits - ${draft.period} s`; periodSeg.set(draft.period) }
  function applyAccount(a) {
    secretBox.input.value = a.secret
    nameIn.value = [a.issuer, a.label].filter(Boolean).join(' - ')
    draft.secret = a.secret; draft.label = nameIn.value
    draft.algo = a.algo; draft.digits = a.digits; draft.period = a.period
    algoSeg.set(a.algo); digitsSeg.set(a.digits); periodNum.value = a.period
    refreshSpec(); tick()
  }
  function onSecretText(v) {
    clear(status)
    const t = v.trim()
    if (/^otpauth-migration:\/\//i.test(t)) { importMigration(t); return }
    if (/^otpauth:\/\//i.test(t)) {
      try { applyAccount(parseOtpauth(t)); toast('Link read. The secret is filled in below.', 'success') } catch (e) { clear(status, alert('warn', e.message)) }
      return
    }
    draft.secret = v
    const s = cleanSecret(v)
    if (s) { try { fromBase32(s) } catch (e) { clear(status, alert('warn', e.message)) } }
    tick()
  }
  function importMigration(text) {
    try {
      const list = parseMigration(text)
      for (const a of list) accounts.push({ id: 'a' + nextId++, ...a })
      secretBox.input.value = ''; draft.secret = ''
      afterAccountsChanged()
      tick()
      toast(`Imported ${list.length} account${list.length === 1 ? '' : 's'} from the export`, 'success')
    } catch (e) { clear(status, alert('error', e.message)) }
  }

  async function onQr(file) {
    clear(status)
    try {
      const text = await readQr(file)
      if (/^otpauth-migration:/i.test(text)) importMigration(text)
      else if (/^otpauth:/i.test(text)) { applyAccount(parseOtpauth(text)); toast('QR code read. The secret is filled in below.', 'success') }
      else throw new Error('That QR code is not a 2FA setup code (it does not start with otpauth://).')
    } catch (e) { clear(status, alert('error', e.message)) }
  }
  const zone = dropzone({ accept: 'image/*', multiple: false, compact: true, icon: 'qr-code', label: 'Scan a QR code image', hint: 'Drop, choose or paste a screenshot of the setup QR code', onFiles: ([f]) => onQr(f) })

  const advanced = h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Advanced: algorithm, digits and period'),
    h('div', { class: 'sx-grid', style: 'margin-top:14px' },
      h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Algorithm'), algoSeg),
      h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Digits'), digitsSeg),
      h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Period'), periodSeg, field('Custom seconds', periodNum))),
    h('div', { class: 'sx-hint', style: 'margin-top:10px' }, 'Almost every service uses SHA-1, 6 digits and 30 seconds. Change these only if the service told you to.'))

  addBtn.addEventListener('click', () => {
    const a = draftAcc()
    if (!a) return toast('Enter a valid secret first', 'error')
    accounts.push({ id: 'a' + nextId++, label: nameIn.value.trim() || `Account ${accounts.length + 1}`, issuer: '', ...a })
    secretBox.input.value = ''; nameIn.value = ''; draft.secret = ''; draft.label = ''
    afterAccountsChanged()
    tick()
    burst(addBtn)
    toast('Added to your list', 'success')
  })

  // ---------- accounts list ----------
  const listHost = h('div', { class: 'sx-accs' })
  const listPanel = h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('list'), 'My accounts'), listHost)
  const rowViews = new Map()
  function renderList() {
    rowViews.clear()
    listPanel.hidden = !accounts.length
    clear(listHost, accounts.map((a, i) => {
      const v = liveCode(() => a)
      rowViews.set(a.id, v)
      const lab = [a.issuer, a.label].filter(Boolean).join(' - ') || 'Account'
      v.update()
      return h('div', { class: 'sx-acc', style: { '--i': i } }, v.ringEl,
        h('div', { class: 'mt' }, h('div', { class: 'nm', title: lab }, lab, h('small', `${a.digits} digits - ${a.period}s`)), v.codeEl),
        h('div', { class: 'ops' }, copyBtn(() => v.code, '', { ariaLabel: `Copy code for ${lab}`, variant: 'ghost' }),
          button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${lab}`, onClick: () => { accounts = accounts.filter((x) => x.id !== a.id); afterAccountsChanged() } })))
    }))
  }

  // ---------- saving on this device (opt in) ----------
  const warn = alert('warn', h('strong', 'Saved secrets can be read by anyone who uses this browser. '), 'They are kept only on this device and never uploaded, but plain local storage is not a vault. Set a password to encrypt them, and keep high-value accounts in a dedicated authenticator or hardware key.')
  const vaultPwIn = secretInput({ placeholder: 'Password to encrypt saved accounts (recommended)', ariaLabel: 'Password to encrypt saved accounts', onInput: (v) => { vaultPw = v; persist() } })
  const wipe = button('Delete saved data', { icon: 'trash-2', variant: 'danger', size: 'sm', onClick: () => { remove(STORE_KEY); remember = false; vaultPw = ''; vaultPwIn.input.value = ''; rememberToggle.input.checked = false; syncRemember(); toast('Saved data deleted from this device', 'success') } })
  const rememberToggle = toggle('Remember my accounts on this device', false, (v) => { remember = v; syncRemember(); persist() })
  const rememberBox = h('div', { class: 'stack' }, warn, field('Encryption password', vaultPwIn, 'Optional. If you forget it, the saved accounts cannot be recovered (the secrets still work in your real apps).'), h('div', { class: 'row' }, wipe))
  function syncRemember() { rememberBox.hidden = !remember }
  let persistT
  function persist() {
    clearTimeout(persistT)
    persistT = setTimeout(async () => {
      if (!remember) { remove(STORE_KEY); return }
      try {
        const payload = JSON.stringify(accounts)
        if (vaultPw) save(STORE_KEY, { v: 1, enc: true, blob: await sealText(payload, vaultPw) })
        else save(STORE_KEY, { v: 1, enc: false, accounts })
      } catch { toast('Could not save on this device', 'error') }
    }, 350)
  }
  function afterAccountsChanged() { renderList(); persist() }
  onCleanup(() => clearTimeout(persistT))

  // ---------- timer ----------
  const tick = () => {
    const now = Date.now()
    hero.update(now)
    for (const v of rowViews.values()) v.update(now)
  }
  const timer = setInterval(tick, 250)
  const stop = () => clearInterval(timer)
  onCleanup(stop)
  signal?.addEventListener('abort', stop)

  // ---------- locked vault ----------
  const lockedHost = h('div')
  const stored = load(STORE_KEY, null)
  if (stored?.enc && stored.blob) {
    remember = true
    const pwIn = secretInput({ placeholder: 'Password', ariaLabel: 'Password to unlock saved accounts' })
    const unlock = button('Unlock', { icon: 'lock-open', variant: 'primary' })
    const msg = h('div')
    const go = () => busy(unlock, async () => {
      clear(msg)
      accounts = JSON.parse(await openText(stored.blob, pwIn.input.value))
      vaultPw = pwIn.input.value
      nextId = accounts.length + 1
      vaultPwIn.input.value = vaultPw
      rememberToggle.input.checked = true
      lockedHost.remove()
      syncRemember(); renderList(); tick()
    }, { label: 'Unlocking', errorTo: msg })
    unlock.addEventListener('click', go)
    pwIn.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    lockedHost.append(panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('lock'), 'Saved accounts are locked'), field('Password', pwIn), h('div', { class: 'row' }, unlock,
      button('Delete saved data', { icon: 'trash-2', variant: 'ghost', onClick: () => { remove(STORE_KEY); remember = false; lockedHost.remove(); toast('Saved data deleted', 'success') } })), msg)))
  } else if (stored?.accounts) {
    remember = true
    accounts = stored.accounts
    nextId = accounts.length + 1
    rememberToggle.input.checked = true
  }
  syncRemember()

  root.append(h('div', { class: 'sx stack' },
    lockedHost,
    heroEl,
    panel(h('div', { class: 'stack' },
      field('Secret key', secretBox, 'Paste the Base32 secret from the service, an otpauth:// link, or a Google Authenticator export link. Spaces are fine.'),
      status,
      field('Account name (for your list)', nameIn),
      h('div', { class: 'sx-drop-mini' }, zone),
      advanced)),
    listPanel,
    panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('hard-drive'), 'Storage'), rememberToggle, h('div', { class: 'sx-hint' }, 'By default nothing is saved: close this tab and everything is gone.'), rememberBox)),
    h('div', { class: 'sx-hint' }, 'Codes are computed in your browser with the Web Crypto API (RFC 6238). Your secret is never sent anywhere.')))
  renderList()
  refreshSpec()
  tick()
}
