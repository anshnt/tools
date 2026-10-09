// Shared pieces for the recorders: styling hooks, stage parts, option tiles, stopwatch, MediaRecorder helpers,
// a canvas compositor (webcam bubble, mirrored recording) and the take cards.
import { h, svg, icon, button, toast, formatBytes, onCleanup, download } from '../../lib/ui.js'
import { safeName } from '../../lib/files.js'
import { CSS } from './_style.js'
import { fixWebmDuration } from './_audio.js'

export { fixWebmDuration }

/** Inject the pack stylesheet once. */
export function useStyle() {
  if (!document.getElementById('mc-style')) document.head.append(h('style', { id: 'mc-style' }, CSS))
}

export const stopStream = (stream) => { try { stream?.getTracks().forEach((t) => t.stop()) } catch { /* already stopped */ } }
export const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
/** 83 -> "1:23", 3725 -> "1:02:05". Floors, so it never runs ahead of the real time. */
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export class Stopwatch {
  acc = 0
  t0 = 0
  running = false
  start() { this.acc = 0; this.t0 = performance.now(); this.running = true }
  pause() { if (this.running) { this.acc += performance.now() - this.t0; this.running = false } }
  resume() { if (!this.running) { this.t0 = performance.now(); this.running = true } }
  stop() { this.pause(); return this.acc / 1000 }
  get seconds() { return (this.acc + (this.running ? performance.now() - this.t0 : 0)) / 1000 }
}

/** Plain-words message for getUserMedia / getDisplayMedia failures. */
export function mediaError(err, what = 'device') {
  const n = err?.name
  if (n === 'NotAllowedError' || n === 'SecurityError') return `Access to the ${what} was blocked. Allow it from the icon in your browser's address bar, then try again.`
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return `No ${what} was found. Plug one in or pick another device.`
  if (n === 'NotReadableError' || n === 'AbortError') return `The ${what} could not be started. Another app may be using it.`
  return err?.message || `Could not start the ${what}.`
}

// ---------- Stage parts ----------

export const aurora = () => h('div', { class: 'mc-aurora', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))

/** The idle card on a stage: icon bubble, heading, text, optional badges and buttons. */
export function idleCard({ icon: ic, title, text, badges = [], actions = [] }) {
  return h('div', { class: 'mc-idle' },
    h('div', { class: 'mc-bubble' }, icon(ic)),
    h('h2', title),
    h('p', text),
    badges.length ? h('div', { class: 'mc-badge-row' }, badges.map(([i, t]) => h('span', icon(i), t))) : null,
    actions.length ? h('div', { class: 'row', style: 'justify-content:center' }, actions) : null)
}

/** Glass chip for the HUD. */
export const chip = (...kids) => h('span', { class: 'mc-chip' }, kids)

/** Round dock button. opts: icon, label (aria + tooltip), pressed (adds aria-pressed), variant: 'stop' | 'danger' | 'rec'. */
export function dockButton({ icon: ic, label, onClick, pressed, variant = '' }) {
  const b = h('button', { type: 'button', class: ['mc-dbtn', variant && (variant === 'rec' ? 'mc-rec-btn' : variant)], 'aria-label': label, title: label, onclick: onClick },
    variant === 'rec' ? h('span', { class: 'mc-rec-core' }) : variant === 'stop' ? h('span', { class: 'mc-square' }) : icon(ic))
  if (pressed != null) b.setAttribute('aria-pressed', String(pressed))
  return b
}

/** A tiny five-bar level meter; call .level(0..1). */
export function levelBars(n = 7) {
  const bars = Array.from({ length: n }, (_, i) => h('i', { style: { height: `${30 + (i / (n - 1)) * 70}%` } }))
  const el = h('span', { class: 'mc-meter', 'aria-hidden': 'true' }, bars)
  el.level = (v) => bars.forEach((b, i) => {
    const on = v * n > i + 0.2
    b.className = on ? (i >= n - 1 ? 'clip' : i >= n - 3 ? 'hot' : 'on') : ''
  })
  return el
}

/** Full-stage countdown. Returns { promise (true when it ran out, false when cancelled), cancel() }. */
export function countdown(host, seconds) {
  let n = seconds
  let timer
  let done
  const promise = new Promise((r) => { done = r })
  const grad = svg('defs', svg('linearGradient', { id: 'mc-grad', x1: 0, y1: 0, x2: 1, y2: 1 }, svg('stop', { offset: 0, 'stop-color': '#818cf8' }), svg('stop', { offset: 0.5, 'stop-color': '#e879f9' }), svg('stop', { offset: 1, 'stop-color': '#fb923c' })))
  const wrap = h('div', { class: 'mc-count-wrap' })
  const el = h('div', { class: 'mc-count', role: 'status', 'aria-live': 'assertive' }, wrap)
  const draw = () => wrap.replaceChildren(
    svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' }, grad.cloneNode(true), svg('circle', { cx: 50, cy: 50, r: 46 }), svg('circle', { cx: 50, cy: 50, r: 46 })),
    h('b', String(n)))
  const finish = (ok) => { clearInterval(timer); el.remove(); done(ok) }
  draw()
  host.append(el)
  timer = setInterval(() => { n--; if (n <= 0) finish(true); else draw() }, 1000)
  return { promise, cancel: () => finish(false) }
}

// ---------- Option tiles ----------

/** Toggle tile: { icon, title, desc, checked, onChange, disabled } -> element with .input. */
export function optToggle({ icon: ic, title, desc, checked = false, onChange, disabled = false }) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, disabled, onchange: (e) => onChange?.(e.target.checked) })
  const el = h('label', { class: ['mc-opt', disabled && 'off'] }, input, h('span', { class: 'mc-opt-ic' }, icon(ic)),
    h('span', { class: 'mc-opt-t' }, h('b', title), desc && h('span', desc)), h('span', { class: 'mc-opt-sw', 'aria-hidden': 'true' }))
  el.input = input
  return el
}

/** Select tile: { icon, title, desc, options: [[value, label]], value, onChange } -> element with .select. */
export function optSelect({ icon: ic, title, desc, options, value, onChange, disabled = false }) {
  const sel = h('select', { class: 'select', disabled, onchange: (e) => onChange?.(e.target.value) },
    options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)))
  const el = h('label', { class: ['mc-opt', 'sel', disabled && 'off'] }, h('span', { class: 'mc-opt-ic' }, icon(ic)),
    h('span', { class: 'mc-opt-t' }, h('b', title), desc && h('span', desc)), sel)
  el.select = sel
  return el
}

/** Radio card for a group: { name, value, icon, title, desc, checked, onSelect, bars: 0..3 } -> element with .input. */
export function optRadio({ name, value, icon: ic, title, desc, checked, onSelect, bars }) {
  const input = h('input', { type: 'radio', name, value, checked, onchange: () => onSelect?.(value) })
  const el = h('label', { class: 'mc-opt radio' }, input, h('span', { class: 'mc-opt-ic' }, icon(ic)),
    h('span', { class: 'mc-opt-t' }, h('b', title), desc && h('span', desc)), h('span', { class: 'mc-opt-sw', 'aria-hidden': 'true' }),
    bars != null ? h('span', { class: 'mc-speed', 'aria-hidden': 'true' }, [1, 2, 3].map((i) => h('i', { class: i <= bars ? 'on' : '' }))) : null)
  el.input = input
  return el
}

// ---------- MediaRecorder ----------

const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=av1,opus', 'video/webm']
const MP4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
const supported = (list) => list.find((m) => { try { return MediaRecorder.isTypeSupported(m) } catch { return false } })

/** Recording formats this browser can produce: [{ id: 'webm'|'mp4', label, mime, ext }]. */
export function videoFormats() {
  if (typeof MediaRecorder === 'undefined') return []
  const out = []
  const w = supported(WEBM), m = supported(MP4)
  if (w) out.push({ id: 'webm', label: `WebM (${/vp9/.test(w) ? 'VP9' : /av1/.test(w) ? 'AV1' : 'VP8'})`, mime: w, ext: 'webm' })
  if (m) out.push({ id: 'mp4', label: 'MP4 (H.264)', mime: m, ext: 'mp4' })
  return out
}

/** Thin MediaRecorder wrapper: counts bytes, tracks pauses, resolves stop() with the finished blob. */
export class Rec {
  chunks = []
  bytes = 0
  constructor(stream, { mime, videoBps, audioBps = 128000, maxBytes = 1.8 * 1024 ** 3, onBytes, onLimit, onError }) {
    this.type = mime.split(';')[0]
    this.rec = new MediaRecorder(stream, { mimeType: mime, ...(videoBps ? { videoBitsPerSecond: videoBps } : {}), audioBitsPerSecond: audioBps })
    this.done = new Promise((resolve, reject) => {
      this.rec.onstop = () => resolve(new Blob(this.chunks, { type: this.type }))
      this.rec.onerror = (e) => { onError?.(e.error); reject(e.error || new Error('Recording failed')) }
    })
    this.done.catch(() => {})
    this.rec.ondataavailable = (e) => {
      if (!e.data?.size) return
      this.chunks.push(e.data)
      this.bytes += e.data.size
      onBytes?.(this.bytes)
      if (this.bytes > maxBytes) onLimit?.()
    }
  }
  start() { this.rec.start(1000) }
  pause() { if (this.rec.state === 'recording') this.rec.pause() }
  resume() { if (this.rec.state === 'paused') this.rec.resume() }
  get state() { return this.rec.state }
  stop() {
    if (this.rec.state !== 'inactive') this.rec.stop()
    return this.done
  }
}

/** Bits per second for a given frame size and rate: about 0.07 bits per pixel at 'standard', doubled for 'high'. */
export function bitrateFor(width, height, fps, level = 'standard') {
  const k = { standard: 0.07, high: 0.14, max: 0.28 }[level] || 0.07
  return Math.round(Math.min(40e6, Math.max(1.2e6, width * height * fps * k)))
}

// ---------- Compositing ----------

/**
 * Draw video tracks onto a canvas and give back a stream of the result. Used for the webcam bubble on a screen recording
 * and for saving a mirrored webcam video. Frames are pulled with MediaStreamTrackProcessor when available (it keeps running
 * while the tab is in the background, which a requestAnimationFrame loop does not).
 * opts: base (video track), overlay (video track or null), flip (mirror the base), mirrorOverlay, maxEdge (longest side in px), fps.
 * Returns { stream, canvas, stop() }.
 */
export function composeVideo({ base, overlay = null, flip = false, mirrorOverlay = true, maxEdge = 1920, fps = 30 }) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })
  const stream = canvas.captureStream(0)
  const out = stream.getVideoTracks()[0]
  const frames = { base: null, ov: null }
  const readers = []
  const videos = []
  let stopped = false, last = 0, raf = 0
  const close = (f) => { try { f?.close?.() } catch { /* not a VideoFrame */ } }
  const sizeOf = (f) => [f.displayWidth || f.videoWidth || 0, f.displayHeight || f.videoHeight || 0]

  function draw() {
    const b = frames.base
    if (!b || stopped) return
    const [bw, bh] = sizeOf(b)
    if (!bw || !bh) return
    const k = Math.min(1, maxEdge / Math.max(bw, bh))
    const w = Math.max(2, Math.round(bw * k / 2) * 2), hh = Math.max(2, Math.round(bh * k / 2) * 2)
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh }
    ctx.save()
    if (flip) { ctx.translate(w, 0); ctx.scale(-1, 1) }
    ctx.drawImage(b, 0, 0, w, hh)
    ctx.restore()
    const o = frames.ov
    if (o) {
      const [ow, oh] = sizeOf(o)
      if (ow && oh) {
        const d = Math.round(Math.min(w, hh) * 0.28), m = Math.round(d * 0.16), x = m, y = hh - d - m, side = Math.min(ow, oh)
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = d * 0.12; ctx.shadowOffsetY = d * 0.03
        ctx.fillStyle = '#000'
        ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.fill()
        ctx.restore()
        ctx.save()
        ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2); ctx.clip()
        if (mirrorOverlay) { ctx.translate(x + d, y); ctx.scale(-1, 1); ctx.drawImage(o, (ow - side) / 2, (oh - side) / 2, side, side, 0, 0, d, d) }
        else ctx.drawImage(o, (ow - side) / 2, (oh - side) / 2, side, side, x, y, d, d)
        ctx.restore()
        ctx.lineWidth = Math.max(3, d * 0.035); ctx.strokeStyle = 'rgba(255,255,255,.95)'
        ctx.beginPath(); ctx.arc(x + d / 2, y + d / 2, d / 2 - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke()
      }
    }
    out.requestFrame?.()
  }
  const tick = () => { const now = performance.now(); if (now - last < 1000 / fps - 3) return; last = now; draw() }

  async function pump(track, slot) {
    try {
      const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
      readers.push(reader)
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        if (stopped) { close(value); break }
        close(frames[slot])
        frames[slot] = value
        tick()
      }
    } catch { /* track ended or the reader was cancelled */ }
  }
  if (typeof MediaStreamTrackProcessor === 'function') {
    pump(base, 'base')
    if (overlay) pump(overlay, 'ov')
  } else {
    // Fallback: hidden video elements and a requestAnimationFrame loop (pauses when the tab is hidden).
    const play = (t) => { const v = h('video', { muted: true, playsInline: true }); v.srcObject = new MediaStream([t]); v.play().catch(() => {}); videos.push(v); return v }
    frames.base = play(base)
    if (overlay) frames.ov = play(overlay)
    const loop = () => { if (stopped) return; draw(); raf = requestAnimationFrame(loop) }
    loop()
  }
  return {
    stream, canvas,
    stop() {
      stopped = true
      cancelAnimationFrame(raf)
      for (const r of readers) r.cancel().catch(() => {})
      close(frames.base); close(frames.ov)
      for (const v of videos) { v.pause(); v.srcObject = null }
      out.stop()
    },
  }
}

// ---------- Takes ----------

/** Card for one recording or photo. media: element to show; actions: extra buttons. Returns the card (call .dispose() when removing). */
export function takeCard({ media, name, ext, blob, chips = [], actions = [], dispose, onDelete }) {
  const nameInput = h('input', { class: 'mc-take-name', value: name, 'aria-label': 'File name', spellcheck: false, maxlength: 80 })
  const fileName = () => `${safeName(nameInput.value.trim() || name)}.${ext}`
  const card = h('article', { class: ['mc-take', 'fresh'] },
    media,
    h('div', { class: 'mc-take-body' },
      nameInput,
      h('div', { class: 'mc-meta' }, chips.filter(Boolean).map(([ic, t]) => h('span', { class: 'badge' }, icon(ic), t))),
      h('div', { class: 'mc-act' },
        button('Download', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(blob, fileName()) }),
        ...actions,
        h('span', { class: 'grow' }),
        button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Delete this take', onClick: () => { card.dispose(); onDelete?.(card) } }))))
  card.dispose = () => { card.remove(); dispose?.() }
  setTimeout(() => card.classList.remove('fresh'), 2200)
  return card
}

/** Masonry holder for take cards with a count and a clear button. Hidden until the first card is added. */
export function takeGrid({ title = 'Your takes', cls = 'mc-takes' } = {}) {
  const grid = h('div', { class: cls })
  const count = h('span', { class: 'count' }, '0')
  const cards = new Set()
  const sync = () => { count.textContent = String(cards.size); el.hidden = cards.size === 0 }
  const el = h('section', { class: 'stack', hidden: true, 'aria-label': title },
    h('div', { class: 'mc-head' }, h('h3', title, count),
      button('Clear all', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { for (const c of [...cards]) c.dispose() } })),
    grid)
  onCleanup(() => { for (const c of [...cards]) c.dispose?.() })
  return {
    el,
    add(card) {
      cards.add(card)
      const orig = card.dispose
      card.dispose = () => { cards.delete(card); orig(); sync() }
      grid.prepend(card)
      sync()
      grid.parentElement?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    },
    get size() { return cards.size },
  }
}

export const sizeChip = (bytes) => ['hard-drive', formatBytes(bytes)]
export { toast }
