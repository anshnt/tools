// Voice recorder: live waveform and level meter, pause/resume, trim the start and end, then save as WAV (PCM encoded
// here), or compressed Opus in WebM or Ogg (WebCodecs). The microphone is captured as raw PCM so trimming is exact.
import { h, icon, button, alert, toast, formatBytes, panel, segmented, onCleanup, progress, busy, download, clear } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import * as K from './_kit.js'
import * as A from './_audio.js'
import { parseTime } from './_subs.js'

const WORKLET = `
class MCRec extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0 }
  process(inputs) {
    const inp = inputs[0]
    if (inp && inp.length) {
      for (let i = 0; i < inp[0].length; i++) {
        let v = 0
        for (let c = 0; c < inp.length; c++) v += inp[c][i]
        this.buf[this.n++] = v / inp.length
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0 }
      }
    }
    return true
  }
}
registerProcessor('mc-rec', MCRec)`

const MAX_SECONDS = 90 * 60
const PAGE = 65536
const WAV_RATES = [['48000', '48 kHz (as recorded)'], ['44100', '44.1 kHz (CD)'], ['22050', '22.05 kHz (smaller)'], ['16000', '16 kHz (speech, transcription)']]
const OPUS_RATES = [['32000', 'Voice - 32 kbps'], ['64000', 'Good - 64 kbps'], ['128000', 'Music - 128 kbps']]

/** Growing mono Int16 buffer made of fixed pages, so long recordings never need one giant reallocation. */
export class PcmStore {
  pages = []
  length = 0
  write(f32) {
    for (let i = 0; i < f32.length; i++) {
      const page = this.length >> 16
      if (!this.pages[page]) this.pages[page] = new Int16Array(PAGE)
      const s = Math.max(-1, Math.min(1, f32[i]))
      this.pages[page][this.length & (PAGE - 1)] = s < 0 ? s * 0x8000 : s * 0x7fff
      this.length++
    }
  }
  toInt16() {
    const out = new Int16Array(this.length)
    this.pages.forEach((p, i) => out.set(p.subarray(0, Math.min(PAGE, this.length - i * PAGE)), i * PAGE))
    return out
  }
}

const tenths = (sec) => {
  const t = Math.max(0, sec)
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}

export function mount(root, { signal }) {
  K.useStyle()
  const md = navigator.mediaDevices
  const canMic = !!md?.getUserMedia && typeof AudioContext !== 'undefined'
  const prefs = { denoise: true, agc: true, wavRate: '48000', opusRate: '64000', fmt: 'wav', normalize: false, ...load('mc:voice', {}) }
  const keep = () => save('mc:voice', prefs)

  let state = 'idle' // idle | rec | paused | review
  let s = null // live capture session
  let micId = ''
  let disposed = false
  let raf = 0
  let canOpus = false
  const bars = [] // recent peaks for the live waveform, one per ~43 ms
  let level = 0, hold = 0, holdAt = 0, clipAt = 0
  let review = null
  let takeNo = 0

  // ---- stage ----
  const canvas = h('canvas', { class: 'mc-wave', 'aria-hidden': 'true' })
  const timeEl = h('div', { class: 'mc-time', role: 'timer', 'aria-label': 'Recording time' }, '0:00', h('small', '.0'))
  const hint = h('div', { class: 'mc-idle-hint', style: 'color:rgba(255,255,255,.75);font-size:14px;min-height:22px' }, 'Tap the red button to start')
  const orb = h('button', { type: 'button', class: 'mc-orb', 'aria-label': 'Start recording', onclick: () => (state === 'idle' || state === 'review' ? start() : stop()) }, icon('mic'))
  const orbWrap = h('div', { class: 'mc-orb-wrap' }, h('span', { class: 'mc-ring' }), h('span', { class: 'mc-ring' }), h('span', { class: 'mc-ring' }), orb)
  const levelFill = h('i'), levelHold = h('b')
  const levelOut = h('output', '-60 dB')
  const levelRow = h('div', { class: 'mc-level', 'aria-hidden': 'true' }, icon('mic'), h('div', { class: 'mc-level-bar' }, levelFill, levelHold), levelOut)
  const pauseBtn = button('Pause', { icon: 'pause', size: 'sm', onClick: () => togglePause(), attrs: { class: 'btn btn-sm mc-ghost' } })
  const clipChip = h('span', { class: 'mc-chip', hidden: true, style: 'background:rgba(255,69,58,.25)' }, icon('triangle-alert'), 'Too loud')
  const stage = h('div', { class: 'mc-stage tall', 'data-state': 'idle' }, K.aurora(),
    h('div', { class: 'mc-hud' }, h('span', { class: 'grow' }), clipChip),
    h('div', { class: 'mc-voice' }, orbWrap, timeEl, hint, canvas, levelRow, h('div', { class: 'mc-voice-actions' }, pauseBtn)))
  pauseBtn.hidden = true
  const setState = (st) => { state = st; stage.dataset.state = st === 'rec' || st === 'paused' ? st : 'idle' }

  // ---- options ----
  const optMic = K.optSelect({ icon: 'mic', title: 'Microphone', options: [['', 'Default microphone']], value: '', onChange: (v) => { micId = v } })
  const optDenoise = K.optToggle({ icon: 'audio-waveform', title: 'Noise reduction', desc: 'Echo cancelling and background hiss', checked: prefs.denoise, onChange: (v) => { prefs.denoise = v; keep() } })
  const optAgc = K.optToggle({ icon: 'gauge', title: 'Auto level', desc: 'Evens out quiet and loud parts', checked: prefs.agc, onChange: (v) => { prefs.agc = v; keep() } })
  const options = h('div', { class: 'mc-opts' }, optMic, optDenoise, optAgc)

  // ---- drawing ----
  function sizeCanvas() {
    const r = canvas.getBoundingClientRect()
    const dpr = Math.min(2, devicePixelRatio || 1)
    const w = Math.max(10, Math.round(r.width * dpr)), hh = Math.max(10, Math.round(r.height * dpr))
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh }
    return [w, hh, dpr]
  }
  function drawWave() {
    const [w, hh, dpr] = sizeCanvas()
    const g = canvas.getContext('2d')
    g.clearRect(0, 0, w, hh)
    const step = 6 * dpr, bw = 3.2 * dpr
    const n = Math.floor(w / step)
    const grad = g.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, 'rgba(129,140,248,.15)'); grad.addColorStop(0.55, '#c084fc'); grad.addColorStop(1, '#fb7185')
    g.fillStyle = grad
    for (let i = 0; i < n; i++) {
      const v = bars[bars.length - n + i]
      const p = v == null ? 0.02 : Math.max(0.02, Math.min(1, Math.pow(v, 0.7)))
      const bh = Math.max(dpr * 2, p * hh * 0.92)
      g.globalAlpha = v == null ? 0.25 : 1
      g.beginPath()
      g.roundRect(i * step, (hh - bh) / 2, bw, bh, bw / 2)
      g.fill()
    }
    g.globalAlpha = 1
  }
  function frame() {
    raf = 0
    if (disposed) return
    // Level meter: fast attack, slow release, with a peak marker.
    levelFill.style.width = `${level * 100}%`
    const now = performance.now()
    if (level >= hold || now - holdAt > 900) { hold = Math.max(level, hold - 0.012); if (level >= hold) holdAt = now }
    levelHold.style.left = `calc(${hold * 100}% - 1px)`
    const db = level <= 0 ? -60 : level * 60 - 60
    levelOut.textContent = `${Math.round(db)} dB`
    orbWrap.style.setProperty('--lvl', state === 'rec' ? level.toFixed(3) : '0')
    clipChip.hidden = now - clipAt > 1500
    drawWave()
    if (s) raf = requestAnimationFrame(frame)
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame) }
  const waveRo = new ResizeObserver(() => drawWave())
  waveRo.observe(canvas)
  drawWave()

  // ---- capture ----
  async function start() {
    if (!canMic || s) return
    if (state === 'review') archive()
    orb.disabled = true
    try {
      const constraints = { audio: { ...(micId ? { deviceId: { exact: micId } } : {}), echoCancellation: prefs.denoise, noiseSuppression: prefs.denoise, autoGainControl: prefs.agc, channelCount: { ideal: 1 } } }
      let stream
      try { stream = await md.getUserMedia(constraints) } catch (e) {
        if (micId && (e?.name === 'OverconstrainedError' || e?.name === 'NotFoundError')) { micId = ''; stream = await md.getUserMedia({ audio: constraints.audio && { ...constraints.audio, deviceId: undefined } }) } else throw e
      }
      if (disposed) return K.stopStream(stream)
      let ctx
      try { ctx = new AudioContext({ sampleRate: 48000 }) } catch { ctx = new AudioContext() }
      await ctx.resume?.()
      const source = ctx.createMediaStreamSource(stream)
      const sink = ctx.createGain()
      sink.gain.value = 0 // keep the graph pulling without playing the microphone back
      let node
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
        await ctx.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)
        node = new AudioWorkletNode(ctx, 'mc-rec', { numberOfOutputs: 1, outputChannelCount: [1] })
        node.port.onmessage = (e) => onChunk(e.data)
      } catch {
        node = ctx.createScriptProcessor(4096, 1, 1)
        node.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i += 1024) onChunk(d.subarray(i, i + 1024)) }
      }
      source.connect(node)
      node.connect(sink)
      sink.connect(ctx.destination)
      const track = stream.getAudioTracks()[0]
      track.addEventListener('ended', () => { if (s && s.stream === stream) { toast('The microphone was disconnected.', 'info'); stop() } })
      s = { stream, ctx, node, source, sink, store: new PcmStore(), rate: ctx.sampleRate, paused: false, acc: 0, peak: 0, n: 0, label: track.label }
      bars.length = 0
      level = hold = 0
      setState('rec')
      orb.disabled = false
      orb.setAttribute('aria-label', 'Stop and save recording')
      orb.replaceChildren(h('span', { class: 'mc-square' }))
      hint.textContent = 'Recording... tap to stop'
      pauseBtn.hidden = false
      fillDevices()
      kick()
      tickTime()
    } catch (e) {
      orb.disabled = false
      toast(K.mediaError(e, 'microphone'), 'error', 8000)
      if (s) release()
    }
  }

  function onChunk(f32) {
    if (!s) return
    let sum = 0, pk = 0
    for (let i = 0; i < f32.length; i++) { const a = Math.abs(f32[i]); sum += a * a; if (a > pk) pk = a }
    const rms = Math.sqrt(sum / f32.length)
    const db = 20 * Math.log10(rms || 1e-6)
    const target = Math.max(0, Math.min(1, (db + 60) / 60))
    level = target > level ? target : level * 0.86 + target * 0.14
    if (pk >= 0.985) clipAt = performance.now()
    if (s.paused) return
    s.store.write(f32)
    s.peak = Math.max(s.peak, pk)
    if (++s.n % 2 === 0) { bars.push(s.peak); s.peak = 0; if (bars.length > 400) bars.splice(0, bars.length - 400) }
    if (s.store.length / s.rate >= MAX_SECONDS) { toast('Reached the 90 minute limit, so the recording was saved.', 'info', 8000); stop() }
  }

  function tickTime() {
    if (!s) return
    const sec = s.store.length / s.rate
    timeEl.firstChild.textContent = K.clock(sec).replace(/^0/, '')
    timeEl.lastChild.textContent = `.${Math.floor((sec % 1) * 10)}`
    setTimeout(tickTime, 100)
  }

  function togglePause() {
    if (!s) return
    s.paused = !s.paused
    setState(s.paused ? 'paused' : 'rec')
    pauseBtn.replaceChildren(icon(s.paused ? 'play' : 'pause'), h('span', s.paused ? 'Resume' : 'Pause'))
    hint.textContent = s.paused ? 'Paused. Tap the button to stop, or Resume to keep going' : 'Recording... tap to stop'
  }

  function release() {
    if (!s) return
    const x = s
    s = null
    try { x.node.port ? (x.node.port.onmessage = null) : (x.node.onaudioprocess = null); x.source.disconnect(); x.node.disconnect(); x.sink.disconnect() } catch { /* already disconnected */ }
    K.stopStream(x.stream)
    x.ctx.close().catch(() => {})
    return x
  }

  function stop() {
    if (!s) return
    const x = release()
    setState('review')
    orb.setAttribute('aria-label', 'Record again')
    orb.replaceChildren(icon('mic'))
    pauseBtn.hidden = true
    pauseBtn.replaceChildren(icon('pause'), h('span', 'Pause'))
    level = 0
    cancelAnimationFrame(raf); raf = 0
    frame()
    const pcm = x.store.toInt16()
    if (pcm.length < x.rate * 0.2) {
      setState('idle')
      hint.textContent = 'That was too short. Tap the red button to try again'
      timeEl.firstChild.textContent = '0:00'; timeEl.lastChild.textContent = '.0'
      return toast('Nothing to save: the recording was under a fifth of a second.', 'info')
    }
    hint.textContent = 'Done. Trim it below, or tap to record again'
    openReview(pcm, x.rate)
  }

  // ---- earlier takes ----
  const earlier = K.takeGrid({ title: 'Earlier recordings' })
  function archive() {
    if (!review) return
    const r = review
    const pcm = r.pcm
    const blob = A.encodeWav(pcm, r.rate)
    const url = URL.createObjectURL(blob)
    earlier.add(K.takeCard({
      media: h('audio', { controls: true, src: url, style: 'width:100%;display:block;padding:10px;box-sizing:border-box', 'aria-label': 'Earlier recording' }),
      blob, name: r.name, ext: 'wav', dispose: () => URL.revokeObjectURL(url),
      chips: [['clock', K.clock(pcm.length / r.rate)], K.sizeChip(blob.size), ['audio-lines', 'WAV']],
    }))
    r.el.remove(); r.dispose(); review = null
  }

  // ---- review: trim + export ----
  const reviewHost = h('div')
  function openReview(pcm, rate) {
    review?.dispose()
    const name = `voice-${K.stamp()}${++takeNo > 1 ? `-${takeNo}` : ''}`
    const dur = pcm.length / rate
    let a = 0, b = dur
    let playing = null
    const status = h('div', { class: 'small muted', role: 'status' })
    const prog = progress('Encoding')

    // trim area
    const cvs = h('canvas', { 'aria-hidden': 'true' })
    const shadeL = h('div', { class: 'mc-trim-shade', style: 'left:0;width:0' }), shadeR = h('div', { class: 'mc-trim-shade', style: 'right:0;width:0' })
    const playhead = h('div', { class: 'mc-playhead' })
    const mkHandle = (label, which) => h('div', {
      class: 'mc-handle', role: 'slider', tabindex: 0, 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': dur.toFixed(2),
      onpointerdown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag = which },
      onpointermove: (e) => { if (drag === which && e.currentTarget.hasPointerCapture(e.pointerId)) setFromX(e.clientX, which) },
      onpointerup: () => { drag = null },
      onlostpointercapture: () => { drag = null },
      onkeydown: (e) => {
        const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
        if (!d) return
        e.preventDefault()
        const step = (e.shiftKey ? 1 : 0.1) * d
        which === 'a' ? setRange(a + step, b, 'a') : setRange(a, b + step, 'b')
      },
    })
    let drag = null
    const hA = mkHandle('Trim start', 'a'), hB = mkHandle('Trim end', 'b')
    const trim = h('div', { class: 'mc-trim', onpointerdown: (e) => { if (e.target === trim || e.target === cvs) seekTo(e.clientX) } }, cvs, shadeL, shadeR, playhead, hA, hB)
    const setFromX = (x, which) => {
      const r = trim.getBoundingClientRect()
      const t = Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur
      which === 'a' ? setRange(t, b, 'a') : setRange(a, t, 'b')
    }
    const startIn = h('input', { class: 'input mono', 'aria-label': 'Start time', value: tenths(0), inputmode: 'decimal', onchange: () => { const t = parseTime(startIn.value); setRange(Number.isFinite(t) ? t : a, b, 'a'); startIn.value = tenths(a) } })
    const endIn = h('input', { class: 'input mono', 'aria-label': 'End time', value: tenths(dur), inputmode: 'decimal', onchange: () => { const t = parseTime(endIn.value); setRange(a, Number.isFinite(t) ? t : b, 'b'); endIn.value = tenths(b) } })
    const lenChip = h('span', { class: 'badge' })

    function setRange(na, nb, moved = 'a') {
      na = Math.max(0, Math.min(na, dur)); nb = Math.max(0, Math.min(nb, dur))
      if (nb - na < 0.05) { if (moved === 'a') na = Math.max(0, nb - 0.05); else nb = Math.min(dur, na + 0.05) }
      a = na; b = nb
      shadeL.style.width = `${(a / dur) * 100}%`
      shadeR.style.width = `${(1 - b / dur) * 100}%`
      hA.style.left = `${(a / dur) * 100}%`; hB.style.left = `${(b / dur) * 100}%`
      hA.setAttribute('aria-valuenow', a.toFixed(2)); hB.setAttribute('aria-valuenow', b.toFixed(2))
      hA.setAttribute('aria-valuetext', tenths(a)); hB.setAttribute('aria-valuetext', tenths(b))
      if (document.activeElement !== startIn) startIn.value = tenths(a)
      if (document.activeElement !== endIn) endIn.value = tenths(b)
      lenChip.replaceChildren(icon('scissors'), `${tenths(b - a)} selected`)
      updateSize()
    }
    const paint = () => {
      const r = trim.getBoundingClientRect()
      const dpr = Math.min(2, devicePixelRatio || 1)
      const w = Math.max(10, Math.round(r.width * dpr)), hh = Math.max(10, Math.round(r.height * dpr))
      cvs.width = w; cvs.height = hh
      const g = cvs.getContext('2d')
      const col = getComputedStyle(trim).getPropertyValue('--mc-c').trim() || '#8e4ec6'
      const pk = A.peaks(pcm, Math.floor(w / (3 * dpr)))
      const step = w / pk.length
      g.fillStyle = col
      for (let i = 0; i < pk.length; i++) {
        const bh = Math.max(2 * dpr, Math.pow(pk[i], 0.75) * hh * 0.9)
        g.beginPath(); g.roundRect(i * step + step * 0.15, (hh - bh) / 2, step * 0.7, bh, step * 0.35); g.fill()
      }
    }
    const ro = new ResizeObserver(paint)
    const mo = new MutationObserver(paint)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    // preview playback of the selection
    function stopPlay() {
      if (!playing) return
      const p = playing
      playing = null
      cancelAnimationFrame(p.raf)
      try { p.src.onended = null; p.src.stop() } catch { /* already ended */ }
      p.ctx.close().catch(() => {})
      playhead.classList.remove('on')
      playBtn.replaceChildren(icon('play'), h('span', 'Play selection'))
    }
    function playFrom(t0) {
      stopPlay()
      let ctx
      try { ctx = new AudioContext({ sampleRate: rate }) } catch { ctx = new AudioContext() }
      const clip = A.int16ToFloat(pcm, Math.floor(t0 * rate), Math.floor(b * rate))
      if (!clip.length) return ctx.close()
      const buf = ctx.createBuffer(1, clip.length, rate)
      buf.copyToChannel(clip, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      const p = { ctx, src, t0, at: ctx.currentTime, raf: 0 }
      playing = p
      src.onended = () => stopPlay()
      ctx.resume?.()
      src.start()
      playBtn.replaceChildren(icon('pause'), h('span', 'Stop'))
      playhead.classList.add('on')
      const loop = () => {
        if (playing !== p) return
        const t = p.t0 + (ctx.currentTime - p.at)
        playhead.style.left = `${(Math.min(t, dur) / dur) * 100}%`
        p.raf = requestAnimationFrame(loop)
      }
      loop()
    }
    const seekTo = (x) => {
      const r = trim.getBoundingClientRect()
      const t = Math.max(a, Math.min(b - 0.05, ((x - r.left) / r.width) * dur))
      playFrom(t)
    }
    const playBtn = button('Play selection', { icon: 'play', size: 'sm', onClick: () => (playing ? stopPlay() : playFrom(a)) })
    const autoBtn = button('Auto-trim silence', { icon: 'wand-sparkles', size: 'sm', variant: 'secondary', title: 'Move both handles to where the sound starts and ends', onClick: () => {
      const r = A.findSpeech(pcm, rate)
      if (!r) return toast('This recording looks silent, so there is nothing to trim to.', 'info')
      setRange(r.start / rate, r.end / rate)
      toast('Trimmed to the sound', 'success')
    } })
    const resetBtn = button('Reset', { icon: 'rotate-ccw', size: 'sm', variant: 'ghost', onClick: () => setRange(0, dur) })

    // export
    const fmt = segmented([['wav', 'WAV'], ['webm', 'WebM'], ['ogg', 'OGG']], prefs.fmt, (v) => { prefs.fmt = v; keep(); sync() }, 'Save as')
    const wavRate = K.optSelect({ icon: 'audio-lines', title: 'Sample rate', options: WAV_RATES, value: prefs.wavRate, onChange: (v) => { prefs.wavRate = v; keep(); updateSize() } })
    const opusRate = K.optSelect({ icon: 'gauge', title: 'Compression', options: OPUS_RATES, value: prefs.opusRate, onChange: (v) => { prefs.opusRate = v; keep(); updateSize() } })
    const norm = K.optToggle({ icon: 'volume-2', title: 'Normalize volume', desc: 'Raise a quiet recording to a healthy level', checked: prefs.normalize, onChange: (v) => { prefs.normalize = v; keep() } })
    const sizeNote = h('span', { class: 'small muted' })
    const saveBtn = button('Save recording', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => busy(saveBtn, exportClip, { label: 'Encoding', errorTo: status, progress: prog }) })

    function sync() {
      const wav = prefs.fmt === 'wav'
      wavRate.hidden = !wav
      opusRate.hidden = wav
      updateSize()
    }
    function updateSize() {
      const secs = b - a
      const bytes = prefs.fmt === 'wav' ? 44 + secs * +prefs.wavRate * 2 : (secs * +prefs.opusRate) / 8
      sizeNote.textContent = `About ${formatBytes(bytes)} as ${prefs.fmt === 'wav' ? 'WAV' : prefs.fmt === 'webm' ? 'WebM (Opus)' : 'OGG (Opus)'}`
    }

    async function exportClip() {
      stopPlay()
      clear(status)
      const kind = prefs.fmt
      let clip = A.prepareClip(pcm, Math.floor(a * rate), Math.floor(b * rate), { sampleRate: rate, normalize: prefs.normalize })
      let blob, ext
      if (kind === 'wav') {
        const to = +prefs.wavRate
        prog.set(null, 'Preparing')
        clip = await A.resample(clip, rate, to)
        blob = A.encodeWav(clip, to)
        ext = 'wav'
      } else {
        prog.set(0, 'Compressing')
        clip = await A.resample(clip, rate, 48000)
        const { packets, samples } = await A.encodeOpus(clip, { bitrate: +prefs.opusRate, onProgress: (f) => prog.set(f, 'Compressing'), signal })
        blob = kind === 'ogg' ? A.muxOgg({ packets, samples }) : A.muxWebm({ packets, samples })
        ext = kind === 'ogg' ? 'ogg' : 'webm'
      }
      download(blob, `${name}.${ext}`)
      status.replaceChildren(icon('circle-check'), ` Saved ${name}.${ext} (${formatBytes(blob.size)}, ${tenths(b - a)})`)
      status.style.color = 'var(--success)'
      toast('Recording saved', 'success')
    }

    if (!canOpus) { fmt.querySelectorAll('button').forEach((x, i) => { if (i > 0) x.hidden = true }); if (prefs.fmt !== 'wav') { prefs.fmt = 'wav'; fmt.set('wav') } }

    const el = panel(h('div', { class: 'stack' },
      h('div', { class: 'mc-head' }, h('h3', icon('scissors'), 'Trim and save'), lenChip),
      trim,
      h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Start'), startIn), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'End'), endIn)),
      h('div', { class: 'row' }, playBtn, autoBtn, resetBtn),
      h('div', { class: 'row' }, h('span', { class: 'field-label' }, 'Save as'), fmt),
      h('div', { class: 'mc-opts' }, wavRate, opusRate, norm),
      prog.el,
      h('div', { class: 'row' }, saveBtn, sizeNote),
      status))
    el.style.animation = 'mc-fade .5s var(--ease) both'
    reviewHost.replaceChildren(el)
    ro.observe(trim)
    paint()
    setRange(0, dur)
    sync()
    review = {
      el, pcm, rate, name,
      dispose() { stopPlay(); ro.disconnect(); mo.disconnect() },
    }
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  // ---- devices ----
  async function fillDevices() {
    try {
      const mics = (await md.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      const sel = optMic.select
      sel.replaceChildren(h('option', { value: '' }, 'Default microphone'), ...mics.map((d, i) => h('option', { value: d.deviceId }, d.label || `Microphone ${i + 1}`)))
      sel.value = [...sel.options].some((o) => o.value === micId) ? micId : ''
    } catch { /* labels are optional */ }
  }
  md?.addEventListener?.('devicechange', fillDevices)
  onCleanup(() => md?.removeEventListener?.('devicechange', fillDevices))
  if (md?.enumerateDevices) fillDevices()
  A.canEncodeOpus().then((v) => { canOpus = v })

  const cleanup = () => {
    disposed = true
    cancelAnimationFrame(raf)
    waveRo.disconnect()
    release()
    review?.dispose()
  }
  signal?.addEventListener('abort', cleanup, { once: true })

  root.append(h('div', { class: 'mc stack' },
    canMic ? null : alert('warn', h('strong', 'Microphone access is not available here. '), 'Open this page over HTTPS in Chrome, Edge, Firefox or Safari.'),
    stage,
    options,
    reviewHost,
    earlier.el,
    h('p', { class: 'small muted' }, icon('shield-check'), ' Audio is captured and encoded on your device. Nothing is uploaded, and the microphone is released as soon as you stop.')))
  return cleanup
}
