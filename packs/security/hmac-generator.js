// HMAC generator: HMAC-SHA1/256/384/512 with WebCrypto. Key as text, hex or Base64; output as hex or Base64; verify a signature.
import { h, icon, field, textarea, segmented, panel, input, toggle, alert, clear, debounce } from '../../lib/ui.js'
import { hashwasm } from '../../lib/libs.js'
import { useStyles, secretInput, copyBtn, utf8, fromHex, fromBase64, toHex, toBase64, toBase64Url, burst } from './_shared.js'

export const HMAC_ALGOS = [['SHA-256', 'SHA-256'], ['SHA-512', 'SHA-512'], ['SHA-384', 'SHA-384'], ['SHA-1', 'SHA-1']]
const HW = { 'SHA-1': 'createSHA1', 'SHA-256': 'createSHA256', 'SHA-384': 'createSHA384', 'SHA-512': 'createSHA512' }

/** HMAC of msg (Uint8Array) with key (Uint8Array). WebCrypto, with a hash-wasm fallback for the empty key WebCrypto refuses. */
export async function hmac(algo, key, msg) {
  if (!key.length) {
    const w = await hashwasm()
    const mac = await w.createHMAC(w[HW[algo]](), key)
    mac.init()
    mac.update(msg)
    return mac.digest('binary')
  }
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: algo }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, msg))
}

const OUT = [['hex', 'hex'], ['HEX', 'HEX'], ['base64', 'Base64'], ['base64url', 'Base64URL']]
const enc = (bytes, fmt) => (fmt === 'HEX' ? toHex(bytes).toUpperCase() : fmt === 'base64' ? toBase64(bytes) : fmt === 'base64url' ? toBase64Url(bytes) : toHex(bytes))
const PRESETS = [
  { label: 'GitHub webhook', set: { algo: 'SHA-256', fmt: 'hex', prefix: 'sha256=' }, tip: 'GitHub signs the raw request body and sends the result in the X-Hub-Signature-256 header.' },
  { label: 'Shopify webhook', set: { algo: 'SHA-256', fmt: 'base64', prefix: '' }, tip: 'Shopify signs the raw body and sends Base64 in the X-Shopify-Hmac-Sha256 header.' },
  { label: 'Stripe', set: { algo: 'SHA-256', fmt: 'hex', prefix: '' }, tip: 'Stripe signs "timestamp.payload". Enter the message as 1700000000.{"id":"evt_1"}; the v1 value in Stripe-Signature is the hex result.' },
  { label: 'Slack', set: { algo: 'SHA-256', fmt: 'hex', prefix: 'v0=' }, tip: 'Slack signs "v0:timestamp:body". Enter the message in that form; compare with X-Slack-Signature.' },
]

const CSS = `
.sx-mac{display:grid;gap:10px}
.sx-macrow{display:grid;grid-template-columns:96px 1fr auto;gap:12px;align-items:center;padding:10px 10px 10px 16px;border-radius:14px;border:1px solid var(--border);background:var(--surface);transition:background .25s,border-color .25s}
.sx-macrow.sel{border-color:color-mix(in srgb,var(--accent) 45%,var(--border));background:var(--accent-soft)}
.sx-macrow.match{background:var(--success-soft);border-color:color-mix(in srgb,var(--success) 45%,transparent)}
.sx-macrow b{font-size:13.5px}.sx-macrow code{font-family:var(--mono);font-size:13px;overflow-wrap:anywhere;word-break:break-all;user-select:all}
@media (max-width:640px){.sx-macrow{grid-template-columns:1fr auto}.sx-macrow b{grid-column:1/-1}}
`

export function mount(root) {
  useStyles('sx-hmac', CSS)
  const s = { algo: 'SHA-256', keyType: 'text', fmt: 'hex', prefix: '' }
  const message = textarea({ rows: 5, mono: true, placeholder: 'Message or request body to sign', 'aria-label': 'Message', oninput: () => run() })
  const key = secretInput({ placeholder: 'Secret key', ariaLabel: 'Secret key', onInput: () => run() })
  const keyType = segmented([['text', 'Text'], ['hex', 'Hex'], ['base64', 'Base64']], s.keyType, (v) => { s.keyType = v; run() }, 'Key format')
  const algo = segmented(HMAC_ALGOS, s.algo, (v) => { s.algo = v; run() }, 'Algorithm')
  const fmt = segmented(OUT, s.fmt, (v) => { s.fmt = v; run() }, 'Output format')
  const prefix = input({ mono: true, placeholder: 'e.g. sha256=', 'aria-label': 'Prefix', oninput: (e) => { s.prefix = e.target.value; run() } })
  const expected = input({ mono: true, placeholder: 'Paste a signature to check (with or without sha256=)', 'aria-label': 'Expected signature', oninput: () => run() })
  const lowerCase = toggle('Ignore upper/lower case when comparing hex', true, () => run())
  const out = h('div', { class: 'stack' })
  const status = h('div')
  const tip = h('div', { class: 'sx-hint' })
  let seq = 0
  let last = null

  const presets = h('div', { class: 'sx-presets', role: 'group', 'aria-label': 'Presets' }, PRESETS.map((p) => h('button', {
    type: 'button', class: 'sx-preset', onclick: () => { Object.assign(s, p.set); algo.set(s.algo); fmt.set(s.fmt); prefix.value = s.prefix; tip.textContent = p.tip; run() },
  }, p.label)))

  const run = debounce(async () => {
    const mine = ++seq
    let keyBytes
    try {
      const k = key.input.value
      keyBytes = s.keyType === 'text' ? utf8(k) : s.keyType === 'hex' ? fromHex(k) : fromBase64(k)
    } catch (e) { clear(status, alert('warn', e.message)); clear(out); return }
    clear(status)
    const msg = utf8(message.value)
    const rows = []
    for (const [a] of HMAC_ALGOS) rows.push([a, await hmac(a, keyBytes, msg)])
    if (mine !== seq) return
    last = Object.fromEntries(rows)
    const exp = expected.value.trim()
    const norm = (t) => t.replace(/^(?:sha\d+=|v\d+=)/i, '').trim()
    const matches = (bytes) => {
      if (!exp) return false
      const e = norm(exp)
      return e === toHex(bytes) || (lowerCase.input.checked && e.toLowerCase() === toHex(bytes)) || e === toBase64(bytes) || e.replace(/=+$/, '') === toBase64Url(bytes)
    }
    const hit = rows.find(([, b]) => matches(b))
    clear(out,
      h('div', { class: 'sx-hero' }, h('div', { class: 'lab' }, h('div', { class: 'sx-k' }, icon('key-square'), `HMAC-${s.algo}`), copyBtn(() => s.prefix + enc(last[s.algo], s.fmt), 'Copy signature')),
        h('div', { class: 'dig' }, s.prefix + enc(last[s.algo], s.fmt))),
      h('div', { class: 'sx-k' }, icon('layers'), 'All algorithms'),
      h('div', { class: 'sx-mac' }, rows.map(([a, b]) => h('div', { class: ['sx-macrow', a === s.algo && 'sel', hit && hit[0] === a && 'match'] }, h('b', `HMAC-${a}`), h('code', enc(b, s.fmt)), copyBtn(() => s.prefix + enc(b, s.fmt), '', { ariaLabel: `Copy HMAC-${a}`, variant: 'ghost' })))),
      exp ? h('div', { class: 'sx-cmp' }, hit ? h('span', { class: 'sx-stamp ok' }, icon('badge-check'), `Valid - matches HMAC-${hit[0]}`) : h('span', { class: 'sx-stamp bad' }, icon('circle-x'), 'Does not match'),
        hit ? null : h('span', { class: 'small muted' }, 'Check the key, the exact message bytes (no extra newline) and the algorithm.')) : null)
    if (hit) { const el = out.querySelector('.sx-stamp'); if (el && !el._b) { el._b = 1; burst(el) } }
  }, 100)

  // the shared hero styles live in hash-generator; define the minimum here so the tool stands alone
  root.append(h('div', { class: 'sx stack' },
    panel(h('div', { class: 'stack' },
      field('Message', message),
      h('div', { class: 'sx-cols' },
        h('div', { class: 'stack' }, field('Secret key', key), h('div', { class: 'row' }, h('span', { class: 'sx-hint' }, 'Key is'), keyType)),
        h('div', { class: 'stack' }, h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Algorithm'), algo), h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Output'), fmt))),
      h('div', { class: 'stack tight' }, h('div', { class: 'sx-k' }, icon('webhook'), 'Webhook presets'), presets, tip),
      field('Prefix (optional)', prefix))),
    status, out,
    panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('badge-check'), 'Verify a signature'), expected, lowerCase))))
  run()
}
