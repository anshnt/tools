// Bcrypt hash and verify with hash-wasm. The slow part runs in a worker so the page stays responsive, with a main-thread fallback.
import { h, icon, field, segmented, panel, button, alert, clear, busy, input, rangeField, formatNumber } from '../../lib/ui.js'
import { VERSIONS, hashwasm } from '../../lib/libs.js'
import { useStyles, secretInput, copyBtn, burst, utf8 } from './_shared.js'

const HW_URL = `https://cdn.jsdelivr.net/npm/hash-wasm@${VERSIONS.hashwasm}/+esm`
const WORKER_SRC = `import * as hw from '${HW_URL}'
self.onmessage = async (e) => {
  const { id, op, password, cost, hash } = e.data
  try {
    if (op === 'hash') {
      const t = performance.now()
      const out = await hw.bcrypt({ password, salt: crypto.getRandomValues(new Uint8Array(16)), costFactor: cost, outputType: 'encoded' })
      postMessage({ id, out, ms: performance.now() - t })
    } else {
      const t = performance.now()
      postMessage({ id, ok: await hw.bcryptVerify({ password, hash }), ms: performance.now() - t })
    }
  } catch (err) { postMessage({ id, error: err.message || String(err) }) }
}`

const HASH_RE = /^\$(2[abxy]?)\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/
export const parseHash = (s) => {
  const m = HASH_RE.exec(s.trim())
  return m ? { version: m[1], cost: +m[2], salt: m[3], digest: m[4] } : null
}
export const byteLength = (s) => utf8(s).length

let worker = null
let seq = 0
const pending = new Map()
function ensureWorker() {
  if (worker) return worker
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
  const w = new Worker(url, { type: 'module' })
  w.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data) } }
  w.onerror = (e) => {
    e.preventDefault?.()
    for (const p of pending.values()) p.reject(Object.assign(new Error('worker'), { workerFailed: true }))
    pending.clear()
    w.terminate()
    if (worker === w) worker = false
  }
  worker = w
  return w
}
const abortErr = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
/** Run a bcrypt job in the worker; falls back to the main thread if workers are unavailable. */
async function job(op, data) {
  if (worker !== false) {
    try {
      const w = ensureWorker()
      return await new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); w.postMessage({ id, op, ...data }) })
    } catch (e) {
      if (!e.workerFailed) throw e
      worker = false
    }
  }
  const hw = await hashwasm()
  const t = performance.now()
  if (op === 'hash') return { out: await hw.bcrypt({ password: data.password, salt: crypto.getRandomValues(new Uint8Array(16)), costFactor: data.cost, outputType: 'encoded' }), ms: performance.now() - t }
  return { ok: await hw.bcryptVerify({ password: data.password, hash: data.hash }), ms: performance.now() - t }
}
function cancelJobs() {
  if (!worker) return
  worker.terminate()
  worker = null
  for (const p of pending.values()) p.reject(abortErr())
  pending.clear()
}

const CSS = `
.sx-bc-parts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.sx-bc-part{display:flex;flex-direction:column;gap:2px;padding:7px 12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border);min-width:0}
.sx-bc-part small{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.sx-bc-part code{font-family:var(--mono);font-size:13px;overflow-wrap:anywhere;word-break:break-all}
.sx-bench{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,120px),1fr));gap:10px}
.sx-bench>div{padding:11px 13px;border-radius:14px;border:1px solid var(--border);background:var(--surface);animation:sx-in .4s var(--ease) both}
.sx-bench b{display:block;font-size:19px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.sx-bench small{color:var(--muted);font-size:12px}
.sx-bench .best{border-color:var(--accent);background:var(--accent-soft)}
.sx-bc-bytes{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.sx-bc-bytes.over{color:var(--danger);font-weight:600}
`

export function mount(root, { signal }) {
  useStyles('sx-bcrypt', CSS)
  signal?.addEventListener('abort', cancelJobs)
  const s = { cost: 12, version: '2b' }

  // ---------- shared bits ----------
  const bytesNote = (getValue) => {
    const el = h('div', { class: 'sx-bc-bytes', 'aria-live': 'polite' })
    el.update = () => {
      const n = byteLength(getValue())
      el.textContent = n ? `${n} of 72 bytes` : ''
      el.classList.toggle('over', n > 72)
    }
    return el
  }
  const breakdown = (p) => h('div', { class: 'sx-bc-parts' }, [['Version', `$${p.version}$`], ['Cost', `${p.cost} (${formatNumber(2 ** p.cost, 0)} rounds)`], ['Salt', p.salt], ['Hash', p.digest]]
    .map(([k, v]) => h('div', { class: 'sx-bc-part' }, h('small', k), h('code', v))))

  // ---------- Hash ----------
  const pw1 = secretInput({ placeholder: 'Password to hash', ariaLabel: 'Password to hash', onInput: () => { bytes1.update(); clear(hashOut) } })
  const bytes1 = bytesNote(() => pw1.input.value)
  const costField = rangeField('Cost factor', { min: 4, max: 16, step: 1, value: s.cost, format: (v) => `${v} (${formatNumber(2 ** v, 0)} rounds)`, onInput: (v) => { s.cost = v; costHint() }, hint: ' ' })
  const costHintEl = costField.querySelector('.field-hint')
  const costHint = () => {
    costHintEl.textContent = s.cost < 10 ? 'Below 10 is too fast for real passwords. Use it for tests only.' : s.cost <= 12 ? 'A good default. Each +1 doubles the work for you and for an attacker.' : s.cost <= 14 ? 'Strong, and noticeably slower on every login. Check the benchmark below.' : 'Very slow. Each hash can take several seconds on a phone.'
  }
  costHint()
  const ver = segmented([['2a', '$2a$'], ['2b', '$2b$'], ['2y', '$2y$']], s.version, (v) => { s.version = v; if (lastHash) showHash(lastHash.replace(/^\$2[aby]\$/, `$${v}$`), lastMs, false) }, 'Hash prefix')
  const hashBtn = button('Hash password', { icon: 'hash', variant: 'primary', size: 'lg' })
  const cancelBtn = button('Cancel', { icon: 'x', variant: 'secondary', size: 'lg' })
  cancelBtn.hidden = true
  cancelBtn.addEventListener('click', cancelJobs)
  const hashOut = h('div')
  let lastHash = ''
  let lastMs = 0

  function showHash(hash, ms, animate = true) {
    lastHash = hash
    lastMs = ms
    const p = parseHash(hash)
    const hero = h('div', { class: 'sx-hero' },
      h('div', { class: 'lab' }, h('div', { class: 'sx-k' }, icon('hash'), 'Bcrypt hash'), h('div', { class: 'row' }, copyBtn(() => lastHash, 'Copy hash'),
        button('Verify it', { icon: 'badge-check', size: 'sm', onClick: () => { mode.set('verify'); sync(); hashIn.value = lastHash; pw2.input.value = pw1.input.value; bytes2.update(); pw2.input.focus() } }))),
      h('div', { class: 'dig', style: 'font-size:clamp(13px,2.2vw,18px)' }, hash),
      h('div', { class: 'note' }, `Computed on this device in ${formatNumber(ms, 0)} ms. A new random salt is used every time, so hashing the same password again gives a different string.`),
      p ? breakdown(p) : null)
    clear(hashOut, hero)
    if (animate) burst(hashBtn)
  }
  hashBtn.addEventListener('click', () => busy(hashBtn, async () => {
    clear(hashOut)
    const pw = pw1.input.value
    if (!pw) throw new Error('Type a password first.')
    if (byteLength(pw) > 72) throw new Error('Bcrypt only uses the first 72 bytes of a password, so longer ones are not accepted here. Shorten it, or hash it first with SHA-256 if you control the app.')
    cancelBtn.hidden = false
    try {
      const r = await job('hash', { password: pw, cost: s.cost })
      showHash(r.out.replace(/^\$2[aby]\$/, `$${s.version}$`), r.ms)
    } finally { cancelBtn.hidden = true }
  }, { label: 'Hashing', errorTo: hashOut }))
  pw1.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') hashBtn.click() })

  // ---------- Benchmark ----------
  const benchOut = h('div')
  const benchBtn = button('Benchmark this device', { icon: 'gauge', size: 'sm' })
  benchBtn.addEventListener('click', () => busy(benchBtn, async () => {
    const rows = []
    clear(benchOut, h('div', { class: 'sx-hint' }, 'Timing a few costs. Slow costs are skipped once one takes over 1.5 seconds.'))
    for (let c = 8; c <= 15; c++) {
      const r = await job('hash', { password: 'benchmark', cost: c })
      rows.push([c, r.ms])
      draw()
      if (r.ms > 1500) break
    }
    function draw() {
      const best = rows.reduce((a, b) => (Math.abs(b[1] - 250) < Math.abs(a[1] - 250) ? b : a))
      clear(benchOut, h('div', { class: 'sx-bench' }, rows.map(([c, ms], i) => h('div', { class: c === best[0] && rows.length > 2 ? 'best' : '', style: { '--i': i } }, h('b', `${formatNumber(ms, 0)} ms`), h('small', `cost ${c}${c === best[0] && rows.length > 2 ? ' - closest to 250 ms' : ''}`)))),
        h('div', { class: 'sx-hint', style: 'margin-top:8px' }, 'A common target is 250 ms or more per hash on your production hardware. Servers are usually faster than this browser.'))
    }
  }, { label: 'Timing', errorTo: benchOut }))

  const hashView = h('div', { class: 'stack' },
    panel(h('div', { class: 'stack' },
      field('Password', h('div', { class: 'stack tight' }, pw1, bytes1)),
      costField,
      h('div', { class: 'stack tight' }, h('div', { class: 'field-label' }, 'Prefix'), ver,
        h('div', { class: 'sx-hint' }, '$2a$, $2b$ and $2y$ are the same algorithm for passwords up to 72 bytes. PHP writes $2y$, most other libraries $2b$.')),
      h('div', { class: 'row' }, hashBtn, cancelBtn))),
    hashOut,
    panel(h('div', { class: 'stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'sx-k' }, icon('gauge'), 'How slow is each cost?'), benchBtn), benchOut)))

  // ---------- Verify ----------
  const pw2 = secretInput({ placeholder: 'Password to check', ariaLabel: 'Password to check', onInput: () => { bytes2.update(); clear(verifyOut) } })
  const bytes2 = bytesNote(() => pw2.input.value)
  const hashIn = input({ mono: true, placeholder: '$2b$12$...', 'aria-label': 'Bcrypt hash', spellcheck: false, autocomplete: 'off', oninput: () => { info(); clear(verifyOut) } })
  const hashInfo = h('div')
  const verifyOut = h('div')
  const verifyBtn = button('Check password', { icon: 'badge-check', variant: 'primary', size: 'lg' })
  function info() {
    const v = hashIn.value.trim()
    if (!v) return clear(hashInfo)
    const p = parseHash(v)
    clear(hashInfo, p ? breakdown(p) : alert('warn', 'That does not look like a bcrypt hash. It should be 60 characters starting with $2a$, $2b$ or $2y$.'))
  }
  verifyBtn.addEventListener('click', () => busy(verifyBtn, async () => {
    clear(verifyOut)
    const pw = pw2.input.value
    const hash = hashIn.value.trim()
    if (!hash) throw new Error('Paste a bcrypt hash first.')
    const p = parseHash(hash)
    if (!p) throw new Error('That is not a valid bcrypt hash. It should be 60 characters starting with $2a$, $2b$ or $2y$.')
    if (p.version === '2x') throw new Error('$2x$ hashes come from a buggy old PHP version and cannot be checked here.')
    if (!pw) throw new Error('Type the password to check.')
    if (byteLength(pw) > 72) throw new Error('Bcrypt only uses the first 72 bytes, so a password this long cannot match a standard hash.')
    const r = await job('verify', { password: pw, hash: hash.replace(/^\$2[ay]?\$/, '$2b$') })
    const stamp = r.ok ? h('span', { class: 'sx-stamp ok' }, icon('badge-check'), 'Match - this is the password') : h('span', { class: 'sx-stamp bad' }, icon('circle-x'), 'No match')
    clear(verifyOut, h('div', { class: 'sx-cmp' }, stamp, h('span', { class: 'small muted' }, `Checked in ${formatNumber(r.ms, 0)} ms at cost ${p.cost}.`)))
    if (r.ok) burst(stamp)
  }, { label: 'Checking', errorTo: verifyOut }))
  pw2.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyBtn.click() })
  const verifyView = panel(h('div', { class: 'stack' },
    field('Bcrypt hash', hashIn),
    hashInfo,
    field('Password', h('div', { class: 'stack tight' }, pw2, bytes2)),
    h('div', { class: 'row' }, verifyBtn),
    verifyOut))

  const mode = segmented([['hash', 'Create a hash'], ['verify', 'Verify a password']], 'hash', () => sync(), 'Mode')
  function sync() { hashView.hidden = mode.value !== 'hash'; verifyView.hidden = mode.value !== 'verify' }
  sync()
  root.append(h('div', { class: 'sx stack' }, mode, hashView, verifyView,
    h('div', { class: 'sx-hint' }, 'Everything runs in this tab with hash-wasm. Your password and hash are never sent anywhere.')))
}
