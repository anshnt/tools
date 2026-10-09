// QR code and barcode scanner: live camera (with torch and camera switch) or an image. Built-in BarcodeDetector when the browser has it,
// otherwise zxing-wasm (MIT) loaded from the CDN, with jsQR (Apache-2.0) as a last resort for QR codes.
import { h, icon, button, dropzone, toggle, segmented, alert, clear, copyText, download, toast, onCleanup, formatDuration } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { loadImage, MAX_PIXELS } from '../../lib/image.js'
import { ensureStyle, pill, note, ago, wait } from './_shared.js'

const ZX_URL = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.4/reader/+esm'
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm'

const FORMAT_NAMES = {
  qr_code: 'QR code', QRCode: 'QR code', MicroQRCode: 'Micro QR', rMQRCode: 'rMQR', ean_13: 'EAN-13', 'EAN-13': 'EAN-13', ean_8: 'EAN-8', 'EAN-8': 'EAN-8',
  upc_a: 'UPC-A', 'UPC-A': 'UPC-A', upc_e: 'UPC-E', 'UPC-E': 'UPC-E', code_128: 'Code 128', Code128: 'Code 128', code_39: 'Code 39', Code39: 'Code 39',
  code_93: 'Code 93', Code93: 'Code 93', itf: 'ITF', ITF: 'ITF', codabar: 'Codabar', Codabar: 'Codabar', data_matrix: 'Data Matrix', DataMatrix: 'Data Matrix',
  aztec: 'Aztec', Aztec: 'Aztec', pdf417: 'PDF417', PDF417: 'PDF417', DataBar: 'GS1 DataBar', DataBarExpanded: 'GS1 DataBar Expanded', DataBarLimited: 'GS1 DataBar Limited',
  EAN13: 'EAN-13', EAN8: 'EAN-8', UPCA: 'UPC-A', UPCE: 'UPC-E', MaxiCode: 'MaxiCode', DXFilmEdge: 'DX film edge',
}
export const niceFormat = (f) => FORMAT_NAMES[f] || String(f || 'Code')
const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|v\.gd|is\.gd|cutt\.ly|rb\.gy|ow\.ly|buff\.ly|tiny\.cc|shorturl\.at|lnkd\.in|wa\.me)$/i

// ---------- Payload parsing (pure, exported for tests) ----------
function splitUnescaped(s, sep) {
  const out = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i++ } else if (s[i] === sep) { out.push(cur); cur = '' } else cur += s[i]
  }
  out.push(cur)
  return out
}
const unesc = (s) => s.replace(/\\([\\;,:"])/g, '$1')

export function parseWifi(text) {
  const body = text.replace(/^WIFI:/i, '')
  const f = {}
  for (const part of splitUnescaped(body, ';')) {
    const i = part.indexOf(':')
    if (i < 1) continue
    f[part.slice(0, i).toUpperCase()] = unesc(part.slice(i + 1))
  }
  return { ssid: f.S || '', password: f.P || '', security: f.T || 'nopass', hidden: /^true$/i.test(f.H || '') }
}

function parseVCard(text) {
  const get = (re) => (text.match(re)?.[1] || '').trim().replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
  const all = (re) => [...text.matchAll(re)].map((m) => m[1].trim())
  const n = get(/^N[;:][^\r\n:]*:?([^\r\n]*)/im)
  return {
    name: get(/^FN[^:\r\n]*:([^\r\n]*)/im) || n.split(';').filter(Boolean).reverse().join(' '),
    org: get(/^ORG[^:\r\n]*:([^\r\n]*)/im).replace(/;/g, ', '), title: get(/^TITLE[^:\r\n]*:([^\r\n]*)/im),
    phones: all(/^TEL[^:\r\n]*:([^\r\n]*)/gim), emails: all(/^EMAIL[^:\r\n]*:([^\r\n]*)/gim), urls: all(/^URL[^:\r\n]*:([^\r\n]*)/gim),
    address: get(/^ADR[^:\r\n]*:([^\r\n]*)/im).split(';').filter(Boolean).join(', '),
  }
}

function params(q) { return Object.fromEntries(new URLSearchParams(q)) }

/** Work out what a scanned string is and what can be done with it. */
export function parsePayload(text, format = '') {
  const t = String(text).trim()
  if (/^WIFI:/i.test(t)) return { kind: 'wifi', label: 'Wi-Fi network', icon: 'wifi', data: parseWifi(t) }
  if (/^BEGIN:VCARD/i.test(t)) return { kind: 'vcard', label: 'Contact card', icon: 'contact', data: parseVCard(t) }
  if (/^BEGIN:VCALENDAR|^BEGIN:VEVENT/i.test(t)) {
    const g = (k) => t.match(new RegExp(`^${k}[^:\\r\\n]*:([^\\r\\n]*)`, 'im'))?.[1]?.trim() || ''
    return { kind: 'event', label: 'Calendar event', icon: 'calendar-plus', data: { title: g('SUMMARY'), start: g('DTSTART'), end: g('DTEND'), location: g('LOCATION'), description: g('DESCRIPTION') } }
  }
  if (/^upi:\/\//i.test(t)) {
    const q = params(t.split('?')[1] || '')
    return { kind: 'upi', label: 'UPI payment', icon: 'indian-rupee', data: { pa: q.pa || '', pn: q.pn || '', am: q.am || '', tn: q.tn || '', cu: q.cu || 'INR' } }
  }
  if (/^otpauth:\/\//i.test(t)) {
    try {
      const u = new URL(t)
      return { kind: 'otp', label: 'Authenticator key', icon: 'key-round', data: { type: u.hostname, account: decodeURIComponent(u.pathname.slice(1)), issuer: u.searchParams.get('issuer') || '', secret: u.searchParams.get('secret') || '' } }
    } catch { /* fall through to text */ }
  }
  if (/^mailto:/i.test(t)) {
    const [to, q = ''] = t.slice(7).split('?')
    const p = params(q)
    return { kind: 'email', label: 'Email', icon: 'mail', data: { to: decodeURIComponent(to), subject: p.subject || '', body: p.body || '' } }
  }
  if (/^MATMSG:/i.test(t)) {
    const g = (k) => t.match(new RegExp(`${k}:([^;]*)`, 'i'))?.[1] || ''
    return { kind: 'email', label: 'Email', icon: 'mail', data: { to: g('TO'), subject: g('SUB'), body: g('BODY') } }
  }
  if (/^tel:/i.test(t)) return { kind: 'tel', label: 'Phone number', icon: 'phone', data: { number: t.slice(4) } }
  if (/^(sms|smsto|mms|mmsto):/i.test(t)) {
    const rest = t.replace(/^[a-z]+:/i, '')
    const [num, ...msg] = rest.includes('?') ? [rest.split('?')[0], params(rest.split('?')[1]).body || ''] : rest.split(':')
    return { kind: 'sms', label: 'SMS', icon: 'message-square', data: { number: num, message: msg.join(':') } }
  }
  if (/^geo:/i.test(t)) {
    const [lat, lng] = t.slice(4).split('?')[0].split(',')
    return { kind: 'geo', label: 'Location', icon: 'map-pin', data: { lat, lng } }
  }
  if (/^https?:\/\//i.test(t) && !/\s/.test(t)) {
    try {
      const u = new URL(t)
      const warns = []
      if (u.protocol === 'http:') warns.push('Not encrypted (http).')
      if (/^xn--|\.xn--/.test(u.hostname)) warns.push('The domain uses look-alike (punycode) characters. Check it carefully.')
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || /^\[/.test(u.hostname)) warns.push('The link goes to a raw IP address.')
      if (SHORTENERS.test(u.hostname)) warns.push('A short link hides the real destination.')
      if (u.username || u.password) warns.push('The link contains a username or password, a common phishing trick.')
      return { kind: 'url', label: /(^|\.)wa\.me$/.test(u.hostname) ? 'WhatsApp chat' : 'Link', icon: /(^|\.)wa\.me$/.test(u.hostname) ? 'message-circle' : 'link', data: { href: u.href, host: u.hostname, rest: u.href.slice(u.href.indexOf(u.host) + u.host.length), https: u.protocol === 'https:' }, warns }
    } catch { /* fall through */ }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && /^(javascript|data|vbscript|file):/i.test(t)) return { kind: 'unsafe', label: 'Unsafe link', icon: 'shield-alert', data: { scheme: t.split(':')[0] } }
  if (/^\d{8,14}$/.test(t) && /ean|upc|itf/i.test(format)) return { kind: 'product', label: 'Product code', icon: 'package', data: { code: t } }
  return { kind: 'text', label: 'Text', icon: 'text', data: { text: t } }
}

// ---------- Detection backends ----------
let backendP
function toImageData(src, maxSide = 1100) {
  if (src instanceof ImageData) return { id: src, scale: 1 }
  const w0 = src.videoWidth || src.naturalWidth || src.width, h0 = src.videoHeight || src.naturalHeight || src.height
  const s = Math.min(1, maxSide / Math.max(w0, h0))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w0 * s)); c.height = Math.max(1, Math.round(h0 * s))
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return { id: ctx.getImageData(0, 0, c.width, c.height), scale: 1 / s }
}
const scalePts = (pts, k) => pts.map((p) => ({ x: p.x * k, y: p.y * k }))

function backend() {
  backendP ??= (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats()
        if (formats.length) {
          const det = new window.BarcodeDetector({ formats })
          return { name: 'Built-in detector', detect: async (src) => (await det.detect(src)).filter((b) => b.rawValue).map((b) => ({ text: b.rawValue, format: b.format, points: b.cornerPoints })) }
        }
      } catch { /* try the next backend */ }
    }
    try {
      const zx = await import(ZX_URL)
      return {
        name: 'zxing',
        async detect(src, { maxSide } = {}) {
          const { id, scale } = toImageData(src, maxSide)
          const found = await zx.readBarcodes(id, { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 5 })
          return found.filter((r) => r.isValid && r.text).map((r) => ({ text: r.text, format: r.format, points: scalePts([r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft], scale) }))
        },
      }
    } catch (e) { console.warn('zxing-wasm unavailable, falling back to jsQR', e) }
    const jsQR = (await import(JSQR_URL)).default
    return {
      name: 'jsQR (QR codes only)',
      async detect(src, { maxSide } = {}) {
        const { id, scale } = toImageData(src, maxSide)
        const r = jsQR(id.data, id.width, id.height, { inversionAttempts: 'attemptBoth' })
        if (!r) return []
        const l = r.location
        return [{ text: r.data, format: 'qr_code', points: scalePts([l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner], scale) }]
      },
    }
  })().catch((e) => { backendP = null; throw Object.assign(new Error('Could not load the code reader. Check your connection and try again.'), { cause: e }) })
  return backendP
}

/** Decode a File/Blob/Image/Canvas. Returns [{text, format, points}]. Tries a few sizes before giving up. */
export async function decodeImageSource(src) {
  const b = await backend()
  const w = src.naturalWidth || src.width, hgt = src.naturalHeight || src.height
  for (const maxSide of [1600, 900, 2600]) {
    if (maxSide > Math.max(w, hgt) * 1.1 && maxSide !== 1600) continue
    const r = await b.detect(src, { maxSide })
    if (r.length) return r
  }
  return []
}

// ---------- UI ----------
const CSS = `
.t-qs .view { position: relative; aspect-ratio: 4 / 3; max-height: min(72vh, 620px); width: 100%; border-radius: 28px; overflow: hidden; isolation: isolate; background: radial-gradient(120% 90% at 20% 0%, #26264a 0%, #0b0b14 60%); box-shadow: var(--shadow-lg); margin: 0 auto; }
.t-qs .view video, .t-qs .view .snap { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
.t-qs .view .snap { z-index: 1; }
.t-qs .frame { position: absolute; z-index: 2; inset: 16% 22%; pointer-events: none; border-radius: 22px; box-shadow: 0 0 0 100vmax rgba(5, 5, 12, .42); transition: inset .5s var(--ease); }
.t-qs .frame i { position: absolute; width: 34px; height: 34px; border: 0 solid #fff; filter: drop-shadow(0 2px 6px rgba(0,0,0,.4)); transition: border-color .25s, transform .4s var(--spring); }
.t-qs .frame i:nth-child(1) { top: -3px; left: -3px; border-top-width: 5px; border-left-width: 5px; border-top-left-radius: 22px; }
.t-qs .frame i:nth-child(2) { top: -3px; right: -3px; border-top-width: 5px; border-right-width: 5px; border-top-right-radius: 22px; }
.t-qs .frame i:nth-child(3) { bottom: -3px; left: -3px; border-bottom-width: 5px; border-left-width: 5px; border-bottom-left-radius: 22px; }
.t-qs .frame i:nth-child(4) { bottom: -3px; right: -3px; border-bottom-width: 5px; border-right-width: 5px; border-bottom-right-radius: 22px; }
.t-qs .frame .line { position: absolute; left: 6%; right: 6%; top: 4%; height: 3px; border-radius: 3px; background: linear-gradient(90deg, transparent, #a78bfa 25%, #f472b6 75%, transparent); box-shadow: 0 0 22px 5px rgba(167, 139, 250, .55); animation: qs-sweep 2.1s ease-in-out infinite alternate; }
@keyframes qs-sweep { to { top: 94%; } }
.t-qs .view.found .frame i, .t-qs .view.hit .frame i { border-color: #4ade80; transform: scale(1.12); }
.t-qs .view.found .frame .line { opacity: 0; }
.t-qs .view.idle .frame, .t-qs .view.idle video { opacity: .0; }
.t-qs .hint { position: absolute; z-index: 3; left: 0; right: 0; bottom: 14px; text-align: center; font-size: 13px; color: rgba(255,255,255,.85); text-shadow: 0 1px 6px rgba(0,0,0,.6); padding: 0 16px; }
.t-qs .cta { position: absolute; inset: 0; z-index: 4; display: grid; place-content: center; justify-items: center; gap: 14px; text-align: center; padding: 22px; color: #fff; }
.t-qs .cta .ball { width: 84px; height: 84px; border-radius: 28px; display: grid; place-items: center; background: linear-gradient(135deg, #6366f1, #a855f7 55%, #ec4899); box-shadow: 0 22px 50px -14px rgba(168, 85, 247, .8); animation: qs-float 3.4s ease-in-out infinite; }
.t-qs .cta .ball .icon { width: 38px; height: 38px; }
@keyframes qs-float { 50% { transform: translateY(-8px) rotate(-3deg); } }
.t-qs .cta p { margin: 0; max-width: 34ch; color: rgba(255,255,255,.78); font-size: 14px; }
.t-qs .flash { position: absolute; inset: 0; z-index: 5; background: #4ade80; opacity: 0; pointer-events: none; }
.t-qs .view.hit .flash, .t-qs .view.found .flash { animation: qs-flash .55s ease-out; }
@keyframes qs-flash { 0% { opacity: .55; } 100% { opacity: 0; } }
.t-qs .result { border-radius: 22px; border: 1px solid var(--border); background: var(--surface); padding: 16px; display: grid; gap: 12px; box-shadow: var(--shadow-sm); animation: rise .5s var(--ease) both; min-width: 0; }
.t-qs .result.fresh { border-color: color-mix(in srgb, var(--success) 50%, var(--border)); box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 14%, transparent), var(--shadow); }
.t-qs .result .top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.t-qs .result .top .when { margin-left: auto; font-size: 12px; color: var(--muted); }
.t-qs .result .big { font-size: 17px; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
.t-qs .result .big .host { color: var(--accent); }
.t-qs .result .raw { font-family: var(--mono); font-size: 12.5px; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; overflow-wrap: anywhere; white-space: pre-wrap; max-height: 150px; overflow: auto; }
.t-qs .result .acts { display: flex; gap: 8px; flex-wrap: wrap; }
.t-qs .result .acts a.btn { text-decoration: none; }
.t-qs .hist { display: grid; gap: 8px; }
.t-qs .hist-item { display: flex; gap: 10px; align-items: center; padding: 8px 8px 8px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); min-width: 0; }
.t-qs .hist-item .txt { flex: 1; min-width: 0; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.t-qs .hist-item .txt small { display: block; color: var(--muted); font-size: 12px; }
.t-qs .snapbox { position: relative; border-radius: 18px; overflow: hidden; border: 1px solid var(--border); background: var(--checker); }
.t-qs .snapbox canvas { display: block; width: 100%; height: auto; max-height: 460px; object-fit: contain; }
@media (max-width: 520px) { .t-qs .view { aspect-ratio: 3 / 4; border-radius: 22px; } .t-qs .frame { inset: 22% 12%; } }
@media (prefers-reduced-motion: reduce) { .t-qs .frame .line, .t-qs .cta .ball { animation: none; } }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-qs-style')) document.head.append(h('style', { id: 't-qs-style' }, CSS))
  const history = persisted('web:scan-history', [])
  let stream = null, track = null, timer = 0, scanning = false, keep = false, facing = 'environment', lastText = '', lastAt = 0, started = 0
  let alive = true

  const video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Camera preview' })
  video.muted = true
  const snap = h('canvas', { class: 'snap', hidden: true, 'aria-hidden': 'true' })
  const frame = h('div', { class: 'frame', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('span', { class: 'line' }))
  const hint = h('div', { class: 'hint', 'aria-live': 'polite' }, 'Point the camera at a QR code or barcode')
  const startBtn = button('Start camera', { icon: 'camera', variant: 'primary', size: 'lg', onClick: () => startCamera() })
  const cta = h('div', { class: 'cta' }, h('div', { class: 'ball' }, icon('scan-qr-code')), h('div', h('h3', { style: 'margin:0 0 6px;font-size:20px' }, 'Scan with your camera'), h('p', 'Nothing is recorded or uploaded. Frames are read on your device and discarded.')), startBtn)
  const view = h('div', { class: 'view idle' }, video, snap, frame, hint, cta, h('div', { class: 'flash' }))
  const camErr = h('div')
  const stopBtn = button('Stop', { icon: 'square', onClick: () => stopCamera(true) })
  const flipBtn = button('Switch camera', { icon: 'switch-camera', onClick: () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera() } })
  const torchBtn = button('Torch', { icon: 'flashlight', onClick: toggleTorch })
  let torchOn = false
  const keepToggle = toggle('Keep scanning', false, (c) => { keep = c })
  const controls = h('div', { class: 'row', hidden: true }, stopBtn, flipBtn, torchBtn, keepToggle)

  const results = h('div', { class: 'stack' })
  const histBox = h('section', { class: 'panel', hidden: true })
  const engineNote = h('div')

  const againBtn = button('Scan another', { icon: 'scan-qr-code', variant: 'primary', onClick: () => startCamera() })
  const liveBtns = [stopBtn, flipBtn, torchBtn, keepToggle]
  controls.append(againBtn)
  function setState(st) {
    view.classList.toggle('idle', st === 'idle')
    view.classList.toggle('found', st === 'found')
    cta.hidden = st !== 'idle'
    snap.hidden = st !== 'found'
    hint.hidden = st === 'idle'
    controls.hidden = st === 'idle'
    for (const b of liveBtns) b.hidden = st !== 'live'
    againBtn.hidden = st !== 'found'
    if (st === 'live') { flipBtn.hidden = false; torchBtn.hidden = !torchOk }
  }
  let torchOk = false

  async function startCamera() {
    stopCamera(false)
    clear(camErr)
    if (!navigator.mediaDevices?.getUserMedia) {
      clear(camErr, alert('error', 'This browser cannot open the camera here. Camera access needs a secure (https) page. You can still scan from an image below.'))
      return
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); stream = null; return }
      track = stream.getVideoTracks()[0]
      video.srcObject = stream
      await video.play().catch(() => {})
      const caps = track.getCapabilities?.() || {}
      torchOk = !!caps.torch
      torchOn = false
      setState('live')
      hint.textContent = 'Point the camera at a QR code or barcode'
      scanning = true
      started = performance.now()
      tick()
    } catch (e) {
      stopCamera(false)
      const name = e?.name
      clear(camErr, alert('error', name === 'NotAllowedError' || name === 'SecurityError' ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then try again. You can also scan from an image.'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'No camera was found on this device. You can scan from an image instead.'
          : name === 'NotReadableError' ? 'The camera is busy in another app. Close it and try again.' : `Could not start the camera. ${e?.message || ''}`))
    }
  }

  function stopCamera(showIdle) {
    scanning = false
    clearTimeout(timer)
    if (stream) stream.getTracks().forEach((t) => t.stop())
    stream = null
    track = null
    video.srcObject = null
    torchOn = false
    if (showIdle) setState('idle')
  }

  async function toggleTorch() {
    if (!track) return
    try {
      torchOn = !torchOn
      await track.applyConstraints({ advanced: [{ torch: torchOn }] })
      torchBtn.setAttribute('aria-pressed', String(torchOn))
      torchBtn.style.borderColor = torchOn ? 'var(--accent)' : ''
    } catch { torchOn = false; toast('This camera does not support the torch.', 'error') }
  }

  async function tick() {
    if (!scanning || !alive) return
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        const b = await backend()
        if (!engineNote.firstChild) clear(engineNote, note('Reader: ', b.name))
        const found = await b.detect(video, { maxSide: 960 })
        if (found.length && scanning) {
          const hit = found[0]
          if (keep && hit.text === lastText && Date.now() - lastAt < 3500) { /* same code still in view */ } else {
            lastText = hit.text; lastAt = Date.now()
            onFound(found, 'camera')
            if (!keep) {
              drawSnapshot(video, found)
              stopCamera(false)
              setState('found')
              hint.textContent = 'Got it. Scan another when you are ready.'
              return
            }
            view.classList.remove('hit'); void view.offsetWidth; view.classList.add('hit')
            navigator.vibrate?.(40)
          }
        }
      } else if (performance.now() - started > 8000 && !video.videoWidth) {
        clear(camErr, alert('warn', 'The camera is on but sending no picture. Try Switch camera or reload the page.'))
      }
    } catch (e) {
      console.error(e)
      clear(camErr, alert('error', e.message))
      stopCamera(true)
      return
    }
    if (scanning) timer = setTimeout(tick, 110)
  }

  function drawSnapshot(src, found) {
    const w = src.videoWidth || src.naturalWidth || src.width, hh = src.videoHeight || src.naturalHeight || src.height
    snap.width = w; snap.height = hh
    const ctx = snap.getContext('2d')
    ctx.drawImage(src, 0, 0, w, hh)
    outline(ctx, found, w)
    navigator.vibrate?.(40)
  }

  function outline(ctx, found, w) {
    ctx.lineWidth = Math.max(4, w / 160)
    ctx.lineJoin = 'round'
    for (const f of found) {
      if (!f.points?.length) continue
      ctx.strokeStyle = '#4ade80'
      ctx.fillStyle = 'rgba(74, 222, 128, .22)'
      ctx.beginPath()
      f.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }

  // ----- Results -----
  function onFound(found, source) {
    results.querySelector(':scope > .empty')?.remove()
    const seen = new Set()
    for (const f of found.slice().reverse()) {
      if (seen.has(f.text)) continue
      seen.add(f.text)
      const entry = { text: f.text, format: f.format, ts: Date.now() }
      history.update((l) => [entry, ...l.filter((x) => x.text !== f.text)].slice(0, 30))
      results.prepend(resultCard(entry, true))
    }
    while (results.children.length > 6) results.lastChild.remove()
    renderHistory()
  }

  function act(label, ic, o = {}) {
    if (o.href) return h('a', { class: ['btn', o.primary ? 'btn-primary' : 'btn-secondary', 'btn-sm'], href: o.href, target: o.external === false ? null : '_blank', rel: 'noopener noreferrer' }, icon(ic), h('span', label))
    return button(label, { icon: ic, variant: o.primary ? 'primary' : 'secondary', size: 'sm', onClick: o.onClick })
  }

  function resultCard(entry, fresh = false) {
    const p = parsePayload(entry.text, entry.format)
    const d = p.data
    const body = h('div', { class: 'stack tight' })
    const acts = h('div', { class: 'acts' })
    const raw = entry.text
    const kv = (rows) => h('div', { class: 'stack tight' }, rows.filter((r) => r[1]).map(([k, v]) => h('div', h('span', { class: 'small muted' }, `${k}: `), h('span', { style: 'overflow-wrap:anywhere' }, v))))
    switch (p.kind) {
      case 'url':
        body.append(h('div', { class: 'big' }, d.https ? icon('lock') : icon('lock-open'), ' ', h('span', { class: 'host' }, d.host), h('span', { class: 'small muted' }, d.rest.length > 60 ? `${d.rest.slice(0, 60)}...` : d.rest)))
        for (const w of p.warns) body.append(alert('warn', w))
        acts.append(act('Open link', 'external-link', { href: d.href, primary: true }), act('Copy link', 'copy', { onClick: () => copyText(d.href) }))
        break
      case 'wifi': {
        const pw = h('span', { class: 'mono' }, d.password ? '•'.repeat(Math.min(12, d.password.length)) : '(none)')
        body.append(h('div', { class: 'big' }, d.ssid || '(no name)'), kv([['Security', d.security === 'nopass' ? 'Open network' : d.security], ['Hidden', d.hidden ? 'Yes' : '']]),
          d.password && h('div', h('span', { class: 'small muted' }, 'Password: '), pw))
        if (d.password) {
          let shown = false
          acts.append(act('Show password', 'eye', { onClick: (e) => { shown = !shown; pw.textContent = shown ? d.password : '•'.repeat(Math.min(12, d.password.length)); e?.currentTarget?.querySelector('span') && (e.currentTarget.querySelector('span').textContent = shown ? 'Hide password' : 'Show password') } }),
            act('Copy password', 'copy', { primary: true, onClick: () => copyText(d.password) }))
        }
        acts.append(act('Copy network name', 'copy', { onClick: () => copyText(d.ssid) }))
        body.append(note('Browsers cannot join Wi-Fi for you. Copy the password and pick the network in your device settings.'))
        break
      }
      case 'vcard':
        body.append(h('div', { class: 'big' }, d.name || '(no name)'), kv([['Company', d.org], ['Title', d.title], ['Phone', d.phones.join(', ')], ['Email', d.emails.join(', ')], ['Website', d.urls.join(', ')], ['Address', d.address]]))
        acts.append(act('Save contact (.vcf)', 'download', { primary: true, onClick: () => download(raw, `${(d.name || 'contact').replace(/[^\w ]+/g, '').trim() || 'contact'}.vcf`, 'text/vcard') }))
        if (d.phones[0]) acts.append(act('Call', 'phone', { href: `tel:${d.phones[0].replace(/[^\d+]/g, '')}`, external: false }))
        if (d.emails[0]) acts.append(act('Email', 'mail', { href: `mailto:${d.emails[0]}`, external: false }))
        break
      case 'event':
        body.append(h('div', { class: 'big' }, d.title || '(untitled event)'), kv([['Starts', d.start], ['Ends', d.end], ['Where', d.location], ['Details', d.description]]))
        acts.append(act('Save event (.ics)', 'download', { primary: true, onClick: () => download(/BEGIN:VCALENDAR/i.test(raw) ? raw : `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${raw}\r\nEND:VCALENDAR`, 'event.ics', 'text/calendar') }))
        break
      case 'upi':
        body.append(h('div', { class: 'big' }, d.pn || d.pa), kv([['UPI ID', d.pa], ['Amount', d.am ? `${d.cu} ${d.am}` : 'Payer enters it'], ['Note', d.tn]]))
        acts.append(act('Open in UPI app', 'indian-rupee', { href: raw, primary: true, external: false }), act('Copy UPI ID', 'copy', { onClick: () => copyText(d.pa) }))
        body.append(alert('warn', 'Check the name and UPI ID before paying. Never pay a code you were sent unexpectedly.'))
        break
      case 'otp':
        body.append(h('div', { class: 'big' }, d.issuer || d.account), kv([['Account', d.account], ['Type', d.type.toUpperCase()]]), alert('warn', 'This code contains a secret key for two-factor login. Keep it private.'))
        acts.append(act('Copy secret key', 'copy', { primary: true, onClick: () => copyText(d.secret) }))
        break
      case 'email':
        body.append(h('div', { class: 'big' }, d.to), kv([['Subject', d.subject], ['Message', d.body]]))
        acts.append(act('Write email', 'mail', { href: `mailto:${d.to}${d.subject || d.body ? `?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}` : ''}`, primary: true, external: false }), act('Copy address', 'copy', { onClick: () => copyText(d.to) }))
        break
      case 'tel':
        body.append(h('div', { class: 'big' }, d.number))
        acts.append(act('Call', 'phone', { href: `tel:${d.number}`, primary: true, external: false }), act('Copy number', 'copy', { onClick: () => copyText(d.number) }))
        break
      case 'sms':
        body.append(h('div', { class: 'big' }, d.number), kv([['Message', d.message]]))
        acts.append(act('Send SMS', 'message-square', { href: `sms:${d.number}${d.message ? `?body=${encodeURIComponent(d.message)}` : ''}`, primary: true, external: false }), act('Copy number', 'copy', { onClick: () => copyText(d.number) }))
        break
      case 'geo':
        body.append(h('div', { class: 'big' }, `${d.lat}, ${d.lng}`))
        acts.append(act('Open map', 'map', { href: `https://www.openstreetmap.org/?mlat=${encodeURIComponent(d.lat)}&mlon=${encodeURIComponent(d.lng)}#map=16/${encodeURIComponent(d.lat)}/${encodeURIComponent(d.lng)}`, primary: true }), act('Copy coordinates', 'copy', { onClick: () => copyText(`${d.lat}, ${d.lng}`) }))
        break
      case 'product':
        body.append(h('div', { class: 'big mono' }, d.code))
        acts.append(act('Search the web', 'search', { href: `https://www.google.com/search?q=${encodeURIComponent(d.code)}`, primary: true }), act('Copy code', 'copy', { onClick: () => copyText(d.code) }))
        break
      case 'unsafe':
        body.append(alert('error', `This code contains a "${d.scheme}:" address, which can run code or hide content. It was not turned into a link.`))
        acts.append(act('Copy text', 'copy', { onClick: () => copyText(raw) }))
        break
      default:
        body.append(h('div', { class: 'big', style: 'font-weight:500' }, raw.length > 280 ? `${raw.slice(0, 280)}...` : raw))
        acts.append(act('Copy text', 'copy', { primary: true, onClick: () => copyText(raw) }))
        if (/^\d{6,}$/.test(raw)) acts.append(act('Search the web', 'search', { href: `https://www.google.com/search?q=${encodeURIComponent(raw)}` }))
    }
    const card = h('article', { class: ['result', fresh && 'fresh'] },
      h('div', { class: 'top' }, pill(p.label, 'accent', p.icon), pill(niceFormat(entry.format)), h('span', { class: 'when' }, ago(entry.ts))),
      body, acts,
      p.kind !== 'text' && h('details', h('summary', { class: 'small muted', style: 'cursor:pointer;min-height:28px;display:flex;align-items:center' }, 'Raw text'), h('div', { class: 'raw' }, raw)))
    if (fresh) setTimeout(() => card.classList.remove('fresh'), 2500)
    return card
  }

  function renderHistory() {
    const list = history.get()
    histBox.hidden = !list.length
    if (!list.length) return
    clear(histBox, h('h2', h('span', 'Recent scans'), button('Clear', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { history.set([]); renderHistory() } })),
      h('div', { class: 'hist' }, list.slice(0, 10).map((e) => {
        const p = parsePayload(e.text, e.format)
        return h('div', { class: 'hist-item' }, icon(p.icon), h('div', { class: 'txt', title: e.text, onclick: () => { results.prepend(resultCard(e)); results.firstChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } }, e.text.replace(/\s+/g, ' '), h('small', `${p.label} · ${ago(e.ts)}`)),
          button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: 'Copy', onClick: () => copyText(e.text) }),
          button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove from history', onClick: () => { history.update((l) => l.filter((x) => x.ts !== e.ts)); renderHistory() } }))
      })),
      h('div', { class: 'small muted', style: 'margin-top:10px' }, 'Saved only in this browser. Clear it any time.'))
  }

  // ----- Image mode -----
  const imgOut = h('div', { class: 'stack' })
  async function scanFiles(files) {
    clear(imgOut)
    for (const file of files.slice(0, 4)) {
      const slot = h('div', { class: 'stack tight' }, h('div', { class: 'wt-skel', style: 'height:120px' }))
      imgOut.append(slot)
      try {
        const img = await loadImage(file)
        const w = img.naturalWidth, hh = img.naturalHeight
        if (w * hh > MAX_PIXELS) throw new Error('That image is too large to scan here. Try a smaller version.')
        const found = await decodeImageSource(img)
        const c = document.createElement('canvas')
        c.width = w; c.height = hh
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        outline(ctx, found, w)
        clear(slot, h('div', { class: 'snapbox' }, c), found.length ? null : alert('warn', h('div', h('strong', 'No QR code or barcode found. '), 'Crop closer to the code, make sure it is sharp and well lit, and avoid glare.')))
        if (found.length) { onFound(found, 'image'); navigator.vibrate?.(30) }
      } catch (e) { clear(slot, alert('error', e.message)) }
    }
  }
  const zone = dropzone({ accept: 'image/*', multiple: true, label: 'Drop an image with a QR code or barcode', hint: 'Screenshots, photos or pasted images (Ctrl+V). Read on your device.', icon: 'image-up', onFiles: scanFiles })
  imgOut.hidden = false

  const modeBox = h('div')
  const camBox = h('div', { class: 'stack' }, view, controls, camErr, engineNote)
  const imgBox = h('div', { class: 'stack' }, zone, imgOut)
  const seg = segmented([['camera', 'Camera'], ['image', 'From image']], 'camera', (m) => {
    camBox.hidden = m !== 'camera'
    imgBox.hidden = m !== 'image'
    if (m !== 'camera') stopCamera(true)
  }, 'Scan source')
  imgBox.hidden = true
  clear(modeBox, h('div', { class: 'row' }, seg, h('span', { class: 'small muted' }, 'Everything is decoded on your device.')))

  root.append(h('div', { class: 't-qs stack' }, modeBox, h('div', { class: 'tool-split wide-left', style: 'align-items:start' },
    h('div', { class: 'stack' }, camBox, imgBox), h('div', { class: 'stack' }, results, histBox))))
  setState('idle')
  renderHistory()
  if (!history.get().length) results.append(h('div', { class: 'empty' }, icon('scan-search'), h('div', 'Scanned codes show up here, with smart actions like Open link, Copy Wi-Fi password or Save contact.')))

  const stopAll = () => { alive = false; stopCamera(false) }
  onCleanup(stopAll)
  signal?.addEventListener('abort', stopAll)
  document.addEventListener('visibilitychange', onVis)
  function onVis() { if (document.hidden && stream) stopCamera(true) }
  onCleanup(() => document.removeEventListener('visibilitychange', onVis))
  return stopAll
}
