// Trim timeline: two draggable handles over the media's length, optional waveform (audio) or filmstrip (video),
// time fields, and play-the-selection preview. Used by trim-video, trim-audio and video-to-gif.
import { h, icon, button, field, input, onCleanup } from '../../lib/ui.js'
import { fmtTime, parseTime, MB } from './_media.js'
import { runFFmpeg } from '../../lib/ffmpeg.js'
import { inputName } from './_media.js'

const r2 = (n) => Math.round(n * 100) / 100
const clamp = (n, a, b) => Math.min(b, Math.max(a, n))

// ---------- Waveform ----------

async function decodeBlob(blob) {
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext
  const ctx = new AC(1, 1, 44100)
  return ctx.decodeAudioData(await blob.arrayBuffer())
}

/**
 * Peaks for drawing a waveform: {peaks: Float32Array (0..1), duration}. The browser decodes common formats directly;
 * anything else (and long files) goes through a small 8 kHz mono copy made by ffmpeg. Resolves null when it cannot.
 */
export async function computePeaks(file, { bars = 1200, signal } = {}) {
  let buf = null
  if (file.size < 80 * MB) { try { buf = await decodeBlob(file) } catch { buf = null } }
  if (!buf) {
    try {
      const name = inputName(file)
      const wav = await runFFmpeg({ inputs: [{ name, data: file }], args: ['-i', name, '-vn', '-ac', '1', '-ar', '8000', '-f', 'wav', 'w.wav'], output: 'w.wav', signal })
      buf = await decodeBlob(wav)
    } catch (e) {
      if (e?.code === 'ABORT') throw e
      return null
    }
  }
  const n = buf.length
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
  const peaks = new Float32Array(bars)
  const step = n / bars
  for (let i = 0; i < bars; i++) {
    const a = Math.floor(i * step)
    const b = Math.max(a + 1, Math.floor((i + 1) * step))
    let m = 0
    for (const d of chans) for (let j = a; j < b; j++) { const v = d[j] < 0 ? -d[j] : d[j]; if (v > m) m = v }
    peaks[i] = m
  }
  const top = peaks.reduce((x, y) => Math.max(x, y), 0) || 1
  for (let i = 0; i < bars; i++) peaks[i] /= top
  return { peaks, duration: buf.duration }
}

// ---------- Time field ----------

/** timeInput('Start', {value, max, onCommit(sec)}) -> {el, set(sec)}. Accepts 83.5, 1:23.5 or 1:02:03. */
export function timeInput(label, { value = 0, onCommit, readonly = false, cls = '' } = {}) {
  const inp = input({ value: fmtTime(value, 1), inputmode: 'decimal', 'aria-label': label, readonly, autocomplete: 'off', spellcheck: false })
  const el = field(label, inp)
  if (cls) el.classList.add(cls)
  let cur = value
  const commit = () => {
    const t = parseTime(inp.value)
    if (Number.isNaN(t)) { inp.classList.add('invalid'); return }
    inp.classList.remove('invalid')
    onCommit?.(t)
  }
  inp.addEventListener('change', commit)
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } })
  return { el, input: inp, set(sec) { cur = sec; inp.value = fmtTime(sec, 1); inp.classList.remove('invalid') }, get: () => cur }
}

// ---------- Trimmer ----------

/**
 * createTrimmer({media, duration, start, end, minLen, peaks, film, onChange(start, end)})
 *  media: stage media ({el, url, canPlay}); duration in seconds.
 * Returns {el, getRange(), setRange(s, e), setPeaks({peaks}), destroy()}
 */
export function createTrimmer({ media, duration, start = 0, end = duration, minLen = 0.2, maxLen = Infinity, film = false, onChange, tall = false }) {
  let s = clamp(start, 0, duration)
  let e = clamp(end, s + minLen, duration)
  let head = 0
  let peaks = null
  let selPlay = false
  let drag = null
  let raf = 0
  const el$ = media?.el
  const playable = () => !!el$ && media.canPlay

  const track = h('div', { class: ['mc-track', tall && 'tall'], role: 'group', 'aria-label': 'Timeline' })
  const canvas = h('canvas', { 'aria-hidden': 'true' })
  const filmEl = h('div', { class: 'mc-film', 'aria-hidden': 'true' })
  const shL = h('div', { class: 'mc-shade l' })
  const shR = h('div', { class: 'mc-shade r' })
  const sel = h('div', { class: 'mc-sel' })
  const headEl = h('div', { class: 'mc-head' })
  const mkHandle = (kind, label) => {
    const tip = h('span', { class: 'mc-tip' })
    const hd = h('div', { class: `mc-handle ${kind}`, role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': r2(duration) }, tip)
    hd._tip = tip
    return hd
  }
  const hs = mkHandle('s', 'Start time')
  const he = mkHandle('e', 'End time')
  track.append(filmEl, canvas, shL, shR, sel, headEl, hs, he)

  const ticks = h('div', { class: 'mc-ticks', 'aria-hidden': 'true' }, [0, 0.25, 0.5, 0.75, 1].map((p) => h('span', fmtTime(duration * p, duration < 20 ? 1 : 0))))

  const tStart = timeInput('Start', { value: s, onCommit: (t) => setRange(t, e) })
  const tEnd = timeInput('End', { value: e, onCommit: (t) => setRange(s, t) })
  const tLen = timeInput('Length', { value: e - s, readonly: true, cls: 'len' })
  const times = h('div', { class: 'mc-times' }, tStart.el, tEnd.el, tLen.el)

  const playBtn = button('Play selection', { icon: 'play', variant: 'secondary', size: 'sm', onClick: () => togglePlay() })
  const setS = button('Start here', { icon: 'arrow-left-to-line', variant: 'ghost', size: 'sm', title: 'Set the start to the current playback position', onClick: () => setRange(el$.currentTime, e) })
  const setE = button('End here', { icon: 'arrow-right-to-line', variant: 'ghost', size: 'sm', title: 'Set the end to the current playback position', onClick: () => setRange(s, el$.currentTime) })
  const resetBtn = button('Reset', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: () => setRange(0, Math.min(duration, maxLen)) })
  const actions = h('div', { class: 'mc-tl-actions' }, playable() ? [playBtn, setS, setE, resetBtn] : [resetBtn])

  const el = h('div', { class: 'mc-tl' }, track, ticks, times, actions)

  // ----- drawing -----
  const pct = (t) => `${(t / duration) * 100}%`
  function layout() {
    const a = (s / duration) * 100
    const b = (e / duration) * 100
    shL.style.width = `${a}%`
    shR.style.width = `${100 - b}%`
    sel.style.left = `${a}%`
    sel.style.width = `${b - a}%`
    hs.style.left = `${a}%`
    he.style.left = `${b}%`
    headEl.style.left = pct(clamp(head, 0, duration))
    hs.setAttribute('aria-valuenow', r2(s)); hs.setAttribute('aria-valuetext', fmtTime(s, 1)); hs._tip.textContent = fmtTime(s, 1)
    he.setAttribute('aria-valuenow', r2(e)); he.setAttribute('aria-valuetext', fmtTime(e, 1)); he._tip.textContent = fmtTime(e, 1)
    tStart.set(s); tEnd.set(e); tLen.set(e - s)
  }
  let drawQueued = false
  function draw() {
    if (drawQueued) return
    drawQueued = true
    requestAnimationFrame(() => {
      drawQueued = false
      paintWave()
    })
  }
  function paintWave() {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(track.clientWidth * dpr))
    const hh = Math.max(1, Math.round(track.clientHeight * dpr))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== hh) canvas.height = hh
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, w, hh)
    if (!peaks) return
    const cs = getComputedStyle(track)
    const accent = cs.getPropertyValue('--accent').trim() || '#6366f1'
    const muted = cs.getPropertyValue('--muted').trim() || '#888'
    const barW = 3 * dpr
    const n = Math.max(8, Math.floor(w / barW))
    const mid = hh / 2
    const xs = (s / duration) * w
    const xe = (e / duration) * w
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1.5, barW - 1.4 * dpr)
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * peaks.length)
      const b = Math.max(a + 1, Math.floor(((i + 1) / n) * peaks.length))
      let m = 0
      for (let j = a; j < b; j++) if (peaks[j] > m) m = peaks[j]
      const x = (i + 0.5) * (w / n)
      const half = Math.max(1.5 * dpr, m * (hh * 0.42))
      ctx.strokeStyle = x >= xs && x <= xe ? accent : muted
      ctx.globalAlpha = x >= xs && x <= xe ? 1 : 0.55
      ctx.beginPath()
      ctx.moveTo(x, mid - half)
      ctx.lineTo(x, mid + half)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }

  // ----- state changes -----
  function setRange(ns, ne, silent = false) {
    ns = clamp(Number.isFinite(ns) ? ns : s, 0, duration)
    ne = clamp(Number.isFinite(ne) ? ne : e, 0, duration)
    if (ne - ns < minLen) { if (ns !== s) ns = Math.max(0, ne - minLen); else ne = Math.min(duration, ns + minLen) }
    if (ne - ns > maxLen) { if (ns !== s) ne = ns + maxLen; else ns = ne - maxLen }
    s = r2(ns); e = r2(ne)
    layout()
    if (peaks) draw()
    if (!silent) onChange?.(s, e)
  }
  function setHead(t) { head = t; headEl.style.left = pct(clamp(t, 0, duration)) }

  // ----- pointer interaction -----
  const at = (clientX) => {
    const r = track.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1) * duration
  }
  let seekRaf = 0
  const previewAt = (t) => {
    if (!playable()) return
    cancelAnimationFrame(seekRaf)
    seekRaf = requestAnimationFrame(() => { try { el$.currentTime = t } catch { /* not seekable yet */ } })
  }
  function onDown(ev, which) {
    ev.preventDefault()
    ev.stopPropagation()
    drag = which
    ;(which === 's' ? hs : he).classList.add('drag')
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
  }
  const onMove = (ev) => {
    if (!drag) return
    const t = r2(at(ev.clientX))
    if (drag === 's') { setRange(t, e); previewAt(s) } else { setRange(s, t); previewAt(Math.max(0, e - 0.05)) }
  }
  const onUp = () => { hs.classList.remove('drag'); he.classList.remove('drag'); drag = null; scrub = false }
  hs.addEventListener('pointerdown', (ev) => onDown(ev, 's'))
  he.addEventListener('pointerdown', (ev) => onDown(ev, 'e'))
  let scrub = false
  track.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.mc-handle')) return
    scrub = true
    track.setPointerCapture?.(ev.pointerId)
    const t = at(ev.clientX)
    setHead(t); previewAt(t)
  })
  track.addEventListener('pointermove', (ev) => { if (scrub) { const t = at(ev.clientX); setHead(t); previewAt(t) } })
  for (const t of [hs, he, track]) { t.addEventListener('pointermove', onMove); t.addEventListener('pointerup', onUp); t.addEventListener('pointercancel', onUp) }
  for (const [hd, which] of [[hs, 's'], [he, 'e']]) {
    hd.addEventListener('keydown', (ev) => {
      const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[ev.key]
      if (!d) { if (ev.key === 'Home') { ev.preventDefault(); which === 's' ? setRange(0, e) : setRange(s, s + minLen) } else if (ev.key === 'End') { ev.preventDefault(); which === 's' ? setRange(e - minLen, e) : setRange(s, duration) } return }
      ev.preventDefault()
      const step = (ev.shiftKey ? 1 : ev.altKey ? 0.01 : 0.1) * d
      which === 's' ? setRange(s + step, e) : setRange(s, e + step)
      previewAt(which === 's' ? s : Math.max(0, e - 0.05))
    })
  }

  // ----- playback of the selection -----
  function tickPlay() {
    raf = 0
    if (!playable()) return
    setHead(el$.currentTime)
    if (selPlay && (el$.currentTime >= e - 0.03 || el$.ended)) { el$.pause(); selPlay = false; el$.currentTime = s; setHead(s) }
    if (!el$.paused) raf = requestAnimationFrame(tickPlay)
  }
  function togglePlay() {
    if (!playable()) return
    if (!el$.paused) { el$.pause(); selPlay = false; return }
    if (el$.currentTime < s || el$.currentTime >= e - 0.05) el$.currentTime = s
    selPlay = true
    el$.play().catch(() => { selPlay = false })
  }
  const onPlay = () => { playBtn.replaceChildren(icon('pause'), h('span', 'Pause')); if (!raf) raf = requestAnimationFrame(tickPlay) }
  const onPause = () => { playBtn.replaceChildren(icon('play'), h('span', 'Play selection')); setHead(el$.currentTime) }
  const onSeekHead = () => { if (!raf) setHead(el$.currentTime) }
  if (playable()) {
    el$.addEventListener('play', onPlay)
    el$.addEventListener('pause', onPause)
    el$.addEventListener('seeked', onSeekHead)
    // when the user plays the media on its own, do not stop at the selection end
    el$.addEventListener('pointerdown', () => { selPlay = false })
  }

  // ----- sizing and theme -----
  const ro = new ResizeObserver(() => { draw(); if (film && !filmDone) buildFilm() })
  ro.observe(track)
  const mo = new MutationObserver(() => draw())
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  // ----- filmstrip (video) -----
  let filmDone = false
  let dead = false
  async function buildFilm() {
    if (!playable() || track.clientWidth < 40) return
    filmDone = true
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.src = media.url
    await new Promise((res) => { v.onloadeddata = res; v.onerror = res; setTimeout(res, 4000) })
    const th = track.clientHeight
    const ar = (v.videoWidth || 16) / (v.videoHeight || 9)
    const n = clamp(Math.ceil(track.clientWidth / (th * ar)), 4, 16)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    for (let i = 0; i < n && !dead; i++) {
      const cv = h('canvas')
      cv.width = Math.round(th * ar * dpr); cv.height = Math.round(th * dpr)
      filmEl.append(cv)
      const t = ((i + 0.5) / n) * duration
      await new Promise((res) => { v.onseeked = res; v.onerror = res; setTimeout(res, 2500); try { v.currentTime = t } catch { res() } })
      try { cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height) } catch { /* frame not ready */ }
    }
    v.removeAttribute('src')
    v.load()
  }

  layout()
  const destroy = () => {
    dead = true
    cancelAnimationFrame(raf); cancelAnimationFrame(seekRaf)
    ro.disconnect(); mo.disconnect()
    if (playable()) { el$.removeEventListener('play', onPlay); el$.removeEventListener('pause', onPause); el$.removeEventListener('seeked', onSeekHead) }
  }
  onCleanup(destroy)

  return {
    el,
    getRange: () => ({ start: s, end: e }),
    setRange,
    setPeaks(p) { peaks = p?.peaks || null; draw() },
    destroy,
  }
}
