// Shared helpers for the screen pack: scoped CSS, glider dock, screen capture, color math, loupe and floating windows.
// Files starting with "_" are never tool modules. Everything here is local, nothing is uploaded.
import { h, icon, button, busy, toast, dropzone, onCleanup } from '../../lib/ui.js'
import { loadImage, canvas as makeCanvas } from '../../lib/image.js'

// ---------- CSS ----------
export function injectCss(id, css) {
  if (document.getElementById(`sc-css-${id}`)) return
  const s = document.createElement('style')
  s.id = `sc-css-${id}`
  s.textContent = css
  document.head.append(s)
}

const BASE_CSS = `
.sc-glass{background:color-mix(in srgb,var(--surface) 74%,transparent);-webkit-backdrop-filter:blur(16px) saturate(170%);backdrop-filter:blur(16px) saturate(170%);border:1px solid color-mix(in srgb,var(--border-strong) 55%,transparent);box-shadow:var(--shadow)}
.sc-dock{position:relative;display:inline-flex;align-items:center;gap:2px;padding:5px;border-radius:20px;max-width:100%;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.sc-dock::-webkit-scrollbar{display:none}
.sc-dock-btn{position:relative;z-index:1;flex:none;display:inline-flex;align-items:center;gap:7px;height:38px;min-width:38px;justify-content:center;padding:0 12px;border:0;background:transparent;border-radius:15px;color:var(--text-2);font-size:13.5px;font-weight:550;cursor:pointer;white-space:nowrap;transition:color .25s,transform .2s var(--spring)}
.sc-dock-btn:hover{color:var(--text)}
.sc-dock-btn:active{transform:scale(.92)}
.sc-dock-btn[aria-pressed="true"]{color:var(--accent-text)}
.sc-dock-btn .icon{width:17px;height:17px}
.sc-dock-btn:disabled{opacity:.4;cursor:not-allowed}
.sc-glider{position:absolute;z-index:0;left:0;top:0;width:0;height:0;border-radius:15px;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,var(--accent-2)));box-shadow:0 8px 18px -8px var(--accent);transition:transform .4s var(--spring),width .4s var(--spring),height .4s var(--spring);pointer-events:none}
.sc-dock.sc-icons .sc-dock-btn{padding:0}
.sc-aurora{position:relative;isolation:isolate;overflow:hidden;border-radius:var(--radius-xl);background:var(--surface);border:1px solid var(--border)}
.sc-aurora::before,.sc-aurora::after{content:"";position:absolute;z-index:-1;width:62%;aspect-ratio:1;border-radius:50%;filter:blur(70px);opacity:.45;animation:sc-drift 18s ease-in-out infinite alternate;pointer-events:none}
.sc-aurora::before{left:-12%;top:-35%;background:radial-gradient(circle,var(--c,#7c66dc),transparent 65%)}
.sc-aurora::after{right:-16%;bottom:-45%;background:radial-gradient(circle,#ec4899,transparent 65%);animation-delay:-7s}
@keyframes sc-drift{from{transform:translate(0,0) scale(1)}to{transform:translate(8%,10%) scale(1.15)}}
.sc-hero{display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px;padding:44px 20px 28px}
.sc-hero h2{font-size:clamp(22px,4vw,32px);letter-spacing:-.035em}
.sc-hero p{color:var(--muted);max-width:520px}
.sc-hero-art{position:relative;width:96px;height:96px;display:grid;place-items:center;border-radius:30px;color:#fff;background:var(--brand);background-size:200% 200%;animation:sc-grad 7s ease infinite,sc-float 5s ease-in-out infinite;box-shadow:0 24px 50px -20px var(--accent)}
.sc-hero-art .icon{width:42px;height:42px}
.sc-hero-art::before,.sc-hero-art::after{content:"";position:absolute;inset:-10px;border-radius:38px;border:2px solid var(--accent);opacity:0;animation:sc-ping 2.8s var(--ease) infinite}
.sc-hero-art::after{animation-delay:1.4s}
@keyframes sc-ping{0%{transform:scale(.9);opacity:.55}100%{transform:scale(1.35);opacity:0}}
@keyframes sc-grad{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
@keyframes sc-float{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-8px) rotate(3deg)}}
@keyframes sc-pop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}
@keyframes sc-fade{from{opacity:0;transform:translateY(8px)}}
.sc-cta{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:12px;height:58px;padding:0 30px;border-radius:999px;border:0;color:#fff;font-weight:600;font-size:16px;cursor:pointer;background:linear-gradient(110deg,#6366f1,#a855f7,#ec4899,#6366f1);background-size:250% 100%;animation:sc-grad 6s ease infinite;box-shadow:0 18px 36px -14px #8b5cf6,inset 0 1px 0 rgba(255,255,255,.35);transition:transform .25s var(--spring),box-shadow .25s}
.sc-cta:hover{transform:translateY(-2px) scale(1.03);box-shadow:0 24px 44px -14px #8b5cf6,inset 0 1px 0 rgba(255,255,255,.35)}
.sc-cta:active{transform:scale(.97)}
.sc-cta .icon{width:22px;height:22px}
.sc-cta[aria-busy="true"]{pointer-events:none;opacity:.85}
.sc-hero .dropzone{width:100%;max-width:520px;min-height:0}
.sc-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;font-size:12.5px;font-weight:550;background:color-mix(in srgb,var(--c,var(--accent)) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--c,var(--accent)) 28%,var(--border));color:var(--text-2);white-space:nowrap}
.sc-chip .icon{width:13px;height:13px;color:var(--c,var(--accent))}
.sc-mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.sc-pip{margin:0;padding:12px;min-height:100vh;background:var(--bg);color:var(--text)}
.sc-pip::before{display:none}
.sc-notice{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:var(--radius);background:var(--warning-soft);border:1px solid color-mix(in srgb,var(--warning) 30%,transparent);font-size:14px}
.sc-notice .icon{color:var(--warning);margin-top:2px}
@media (prefers-reduced-motion:reduce){.sc-glider{transition:none}}
`

/** Inject the pack's shared CSS once. Call at the top of every mount(). */
export function baseCss() { injectCss('base', BASE_CSS) }

// ---------- Small utilities ----------
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const isTyping = (e) => !!e.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')

export function relTime(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const hr = Math.round(m / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

/** Attach a listener that is removed when the tool page is left. */
export function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts)
  const off = () => target.removeEventListener(type, fn, opts)
  onCleanup(off)
  return off
}

/** Friendly "not supported" notice. */
export function unsupported(what, detail) {
  return h('div', { class: 'sc-notice', role: 'status' }, icon('triangle-alert'),
    h('div', h('strong', `${what} is not supported in this browser. `), detail || 'Try a recent Chrome or Edge on a desktop computer.'))
}

// ---------- Glider dock ----------
/**
 * dock([{id, label, icon, key, title}], active, onChange, {ariaLabel, iconsOnly}) -> element with .set(id), .value.
 * A pill toolbar whose highlight slides to the active button.
 */
export function dock(items, active, onChange, opts = {}) {
  const glider = h('span', { class: 'sc-glider', 'aria-hidden': 'true' })
  const el = h('div', { class: ['sc-dock', 'sc-glass', opts.iconsOnly && 'sc-icons', opts.class], role: 'group', 'aria-label': opts.ariaLabel || null }, glider)
  const btns = new Map()
  for (const it of items) {
    const b = h('button', {
      type: 'button', class: 'sc-dock-btn', 'aria-pressed': 'false', 'aria-label': opts.iconsOnly ? it.label : null,
      title: it.title || (it.key ? `${it.label} (${it.key})` : it.label),
      onclick: () => { if (el.value !== it.id) { el.set(it.id); onChange?.(it.id) } },
    }, it.icon && icon(it.icon), !opts.iconsOnly && h('span', it.label))
    btns.set(it.id, b)
    el.append(b)
  }
  const place = () => {
    const b = btns.get(el.value)
    if (!b || !b.offsetWidth) return
    glider.style.width = `${b.offsetWidth}px`
    glider.style.height = `${b.offsetHeight}px`
    glider.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`
    b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
  el.value = active
  el.set = (id) => {
    el.value = id
    for (const [k, b] of btns) b.setAttribute('aria-pressed', String(k === id))
    place()
  }
  el.button = (id) => btns.get(id)
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(place).observe(el)
  el.set(active)
  return el
}

// ---------- Image acquisition (screen capture, upload, paste) ----------
export const canCapture = () => !!navigator.mediaDevices?.getDisplayMedia

/** Canvas for pixel reads (getImageData stays fast) from any image source. */
export function toReadable(source, w = source.naturalWidth || source.videoWidth || source.width, hh = source.naturalHeight || source.videoHeight || source.height) {
  const c = makeCanvas(w, hh)
  c.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, c.width, c.height)
  return c
}

export async function fileToCanvas(file) {
  const img = await loadImage(file)
  return toReadable(img)
}

/**
 * Ask for a screen/window/tab, grab ONE frame into a canvas and stop the stream immediately.
 * Resolves null when the visitor cancels the picker.
 */
export async function grabScreen() {
  if (!canCapture()) throw new Error('Screen capture is not supported in this browser. Upload or paste an image instead.')
  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return null
    throw new Error(`Could not start screen capture (${e?.message || e}).`)
  }
  try {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.srcObject = stream
    await v.play()
    await Promise.race([
      new Promise((res) => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(() => res()) : setTimeout(res, 300))),
      sleep(1500),
    ])
    await sleep(160) // let the browser's share picker finish fading out of the frame
    if (!v.videoWidth || !v.videoHeight) throw new Error('No picture was received from the screen share. Try again.')
    const c = toReadable(v, v.videoWidth, v.videoHeight)
    v.srcObject = null
    return c
  } finally {
    stream.getTracks().forEach((t) => t.stop())
  }
}

/** Paste an image anywhere on the page (Ctrl+V). Removed automatically when leaving the tool. */
export function onPasteImage(handler) {
  listen(document, 'paste', (e) => {
    if (e.defaultPrevented || isTyping(e)) return
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'))
    if (!f) return
    e.preventDefault()
    handler(f)
  })
}

/**
 * sourceHero({title, text, onCanvas, cta}) -> element. Capture button + image dropzone. onCanvas(canvas, {source, name}).
 * Also wires Ctrl+V paste for images.
 */
export function sourceHero({ title, text, onCanvas, cta = 'Capture screen', iconName = 'monitor-up', art = 'camera' }) {
  baseCss()
  const take = async (file) => {
    try {
      onCanvas(await fileToCanvas(file), { source: 'file', name: file.name })
    } catch (e) {
      toast(e.message || 'Could not open that image', 'error')
    }
  }
  const btn = button(cta, { icon: iconName, attrs: { class: 'sc-cta' } })
  btn.className = 'sc-cta'
  btn.disabled = !canCapture()
  btn.addEventListener('click', () => busy(btn, async () => {
    const c = await grabScreen()
    if (c) onCanvas(c, { source: 'screen' })
    else toast('Capture cancelled')
  }, { label: 'Pick a screen to share' }))
  const zone = dropzone({ accept: 'image/*', paste: false, compact: true, icon: 'image-up', label: 'Or drop, choose or paste an image', hint: 'JPG, PNG, WebP, GIF, AVIF, HEIC',
    onFiles: ([f]) => take(f) })
  onPasteImage(take)
  return h('div', { class: 'sc-aurora' }, h('div', { class: 'sc-hero' },
    h('div', { class: 'sc-hero-art' }, icon(art)),
    h('h2', title), h('p', text),
    btn,
    !canCapture() && unsupported('Screen capture', 'Mobile browsers and some desktop browsers cannot share the screen. You can still drop or paste an image below.'),
    zone))
}

/** Small row of "New capture" and "Open image" buttons for tools that already have an image loaded. */
export function sourceActions({ onCanvas, size = 'sm' }) {
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]
    e.target.value = ''
    if (!f) return
    try { onCanvas(await fileToCanvas(f), { source: 'file', name: f.name }) } catch (err) { toast(err.message || 'Could not open that image', 'error') }
  } })
  const cap = button('New capture', { icon: 'camera', size, disabled: !canCapture(), title: canCapture() ? 'Capture the screen again' : 'Screen capture is not supported in this browser' })
  cap.addEventListener('click', () => busy(cap, async () => {
    const c = await grabScreen()
    if (c) onCanvas(c, { source: 'screen' })
    else toast('Capture cancelled')
  }, { label: 'Waiting' }))
  const open = button('Open image', { icon: 'image-up', size, onClick: () => fileInput.click() })
  onPasteImage(async (f) => { try { onCanvas(await fileToCanvas(f), { source: 'file', name: f.name }) } catch (err) { toast(err.message, 'error') } })
  return h('div', { class: 'row' }, cap, open, fileInput)
}

/** Pointer position in image pixels for a canvas displayed at any CSS size. */
export function pointerToImage(e, el, w, hh) {
  const r = el.getBoundingClientRect()
  return {
    x: clamp(Math.floor(((e.clientX - r.left) / r.width) * w), 0, w - 1),
    y: clamp(Math.floor(((e.clientY - r.top) / r.height) * hh), 0, hh - 1),
    fx: ((e.clientX - r.left) / r.width) * w,
    fy: ((e.clientY - r.top) / r.height) * hh,
    inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
  }
}

// ---------- Loupe ----------
/**
 * loupe({size, cells}) -> {el, update(srcCanvas, x, y, {grid}) -> [r,g,b], size}. A pixel-magnifier canvas centred on (x, y).
 * `cells` odd so the centre pixel is exact. Out-of-image cells draw as a muted checker.
 */
export function loupe({ size = 132, cells = 11, round = true } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const c = document.createElement('canvas')
  c.width = c.height = Math.round(size * dpr)
  c.style.cssText = `width:${size}px;height:${size}px;display:block;${round ? 'border-radius:50%;' : ''}`
  c.setAttribute('aria-hidden', 'true')
  const ctx = c.getContext('2d')
  const api = { el: c, size, cells }
  api.update = (src, x, y, { grid = true, cellsOverride } = {}) => {
    const n = cellsOverride || api.cells
    const half = (n - 1) / 2
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#8884'
    ctx.fillRect(0, 0, c.width, c.height)
    const sx = x - half, sy = y - half
    // draw only the in-bounds part so edges stay crisp
    const ix0 = Math.max(0, sx), iy0 = Math.max(0, sy)
    const ix1 = Math.min(src.width, sx + n), iy1 = Math.min(src.height, sy + n)
    const k = c.width / n
    if (ix1 > ix0 && iy1 > iy0) ctx.drawImage(src, ix0, iy0, ix1 - ix0, iy1 - iy0, (ix0 - sx) * k, (iy0 - sy) * k, (ix1 - ix0) * k, (iy1 - iy0) * k)
    if (grid && k >= 6) {
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(0,0,0,.28)'
      ctx.beginPath()
      for (let i = 1; i < n; i++) { ctx.moveTo(i * k + .5, 0); ctx.lineTo(i * k + .5, c.height); ctx.moveTo(0, i * k + .5); ctx.lineTo(c.width, i * k + .5) }
      ctx.stroke()
    }
    const m = half * k
    ctx.lineWidth = Math.max(2, dpr * 1.5)
    ctx.strokeStyle = '#000'
    ctx.strokeRect(m + 1, m + 1, k - 2, k - 2)
    ctx.lineWidth = Math.max(1, dpr)
    ctx.strokeStyle = '#fff'
    ctx.strokeRect(m + 1, m + 1, k - 2, k - 2)
    return pixelAt(src, x, y)
  }
  return api
}

const pxCache = new WeakMap()
/** [r,g,b,a] of a pixel in a canvas, or null when outside. */
export function pixelAt(src, x, y) {
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) return null
  let ctx = pxCache.get(src)
  if (!ctx) { ctx = src.getContext('2d', { willReadFrequently: true }); pxCache.set(src, ctx) }
  const d = ctx.getImageData(x, y, 1, 1).data
  return [d[0], d[1], d[2], d[3]]
}

// ---------- Color math ----------
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()

export function hexToRgb(hex) {
  let s = String(hex).trim().replace(/^#/, '')
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = [...s].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return null
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16))
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2
  let hh = 0, s = 0
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) hh = ((g - b) / d + 6) % 6
    else if (max === g) hh = (b - r) / d + 2
    else hh = (r - g) / d + 4
    hh *= 60
  }
  return [hh, s * 100, l * 100]
}

export function hslToRgb([hh, s, l]) {
  hh = ((hh % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100
  const k = (n) => (n + hh / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255))
}

const toLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const fromLin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055)

export function rgbToOklch([r, g, b]) {
  const lr = toLin(r), lg = toLin(g), lb = toLin(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(a, bb)
  const hue = C < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
  return [L, C, hue]
}

export function oklchToRgb([L, C, hue]) {
  const a = C * Math.cos((hue * Math.PI) / 180), b = C * Math.sin((hue * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    .map((v) => clamp(Math.round(fromLin(clamp(v, 0, 1))), 0, 255))
}

let parseCtx
/** Parse any CSS color the browser understands (hex, rgb(), hsl(), oklch(), names). Returns [r,g,b] or null. */
export function parseColor(text) {
  const s = String(text).trim()
  if (!s) return null
  const hx = hexToRgb(s)
  if (hx) return hx
  const num = '(-?[\\d.]+)(%?)'
  let m = s.match(new RegExp(`^rgba?\\(\\s*${num}[\\s,]+${num}[\\s,]+${num}`, 'i'))
  if (m) return [1, 3, 5].map((i) => clamp(Math.round(m[i + 1] ? parseFloat(m[i]) * 2.55 : parseFloat(m[i])), 0, 255))
  m = s.match(/^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/i)
  if (m) return hslToRgb([+m[1], +m[2], +m[3]])
  m = s.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+(-?[\d.]+)/i)
  if (m) return oklchToRgb([m[2] ? +m[1] / 100 : +m[1], +m[3], +m[4]])
  if (!/^[a-z]+$/i.test(s)) return null
  parseCtx ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
  parseCtx.clearRect(0, 0, 1, 1)
  parseCtx.fillStyle = '#010203'
  parseCtx.fillStyle = s.toLowerCase()
  parseCtx.fillRect(0, 0, 1, 1)
  const d = parseCtx.getImageData(0, 0, 1, 1).data
  // unknown names leave the sentinel color in place
  if (d[0] === 1 && d[1] === 2 && d[2] === 3 && s.toLowerCase() !== 'transparent') return null
  return [d[0], d[1], d[2]]
}

export const luminance = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b)
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** '#000' or '#fff', whichever reads better on the color. */
export const readableOn = (rgb) => (contrastRatio(rgb, [0, 0, 0]) >= contrastRatio(rgb, [255, 255, 255]) ? '#000000' : '#ffffff')

export const fmt = {
  hex: (rgb) => rgbToHex(rgb),
  rgb: (rgb) => `rgb(${rgb.join(', ')})`,
  hsl: (rgb) => { const [a, b, c] = rgbToHsl(rgb); return `hsl(${Math.round(a)}, ${Math.round(b)}%, ${Math.round(c)}%)` },
  oklch: (rgb) => { const [L, C, hh] = rgbToOklch(rgb); return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${hh.toFixed(1)})` },
}

// ---------- Floating windows (Document Picture-in-Picture, with a pop-up fallback) ----------
export const pipSupported = () => 'documentPictureInPicture' in window && typeof window.documentPictureInPicture?.requestWindow === 'function'

function copyStyles(win) {
  const doc = win.document
  doc.head.append(Object.assign(doc.createElement('base'), { href: document.baseURI }))
  for (const sheet of document.styleSheets) {
    try {
      const style = doc.createElement('style')
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n')
      doc.head.append(style)
    } catch {
      if (sheet.href) doc.head.append(Object.assign(doc.createElement('link'), { rel: 'stylesheet', href: sheet.href }))
    }
  }
  // scoped styles injected by tools are <style> elements in <head> and are already covered by document.styleSheets
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light'
  doc.documentElement.lang = document.documentElement.lang || 'en'
}

/**
 * floater({node, title, width, height, onClose}) -> {open(), close(), isOpen, mode}.
 * Moves `node` into an always-on-top Document Picture-in-Picture window (Chromium 116+), or a plain pop-up window elsewhere,
 * and moves it back when that window closes.
 */
export function floater({ node, title, width = 360, height = 460, onOpen, onClose }) {
  let win = null
  const api = {
    mode: pipSupported() ? 'pip' : 'popup',
    get win() { return win },
    get isOpen() { return !!win && !win.closed },
    async open() {
      if (api.isOpen) { win.focus?.(); return win }
      if (api.mode === 'pip') {
        win = await window.documentPictureInPicture.requestWindow({ width, height })
      } else {
        win = window.open('', '_blank', `popup=yes,width=${width},height=${height}`)
        if (!win) throw new Error('The pop-up window was blocked. Allow pop-ups for this site and try again.')
      }
      const w = win
      copyStyles(w)
      w.document.title = title
      w.document.body.classList.add('sc-pip')
      w.document.body.append(node)
      w.addEventListener('pagehide', () => { if (win === w) { win = null; onClose?.(node) } })
      onOpen?.(w)
      return w
    },
    close() {
      const w = win
      if (!w) return
      win = null
      try { w.close() } catch { /* already closed */ }
      onClose?.(node)
    },
  }
  onCleanup(() => { if (api.isOpen) try { win.close() } catch { /* ignore */ } })
  return api
}
