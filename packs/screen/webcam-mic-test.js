// Webcam and microphone test: camera preview with resolution and real FPS, mic level meter, 5 second record and playback, speaker tones.
import { h, icon, button, busy, toast, alert, select, toggle, rangeField, stats, clear, download, formatNumber } from '../../lib/ui.js'
import { toBlob } from '../../lib/image.js'
import { baseCss, injectCss, unsupported, clamp } from './_shared.js'

const RES = [['auto', 'Automatic (HD if possible)'], ['640x480', '640 × 480 (VGA)'], ['1280x720', '1280 × 720 (HD)'], ['1920x1080', '1920 × 1080 (Full HD)'], ['3840x2160', '3840 × 2160 (4K)']]
const FREQS = [['100', '100 Hz (bass)'], ['440', '440 Hz (A note)'], ['1000', '1 kHz'], ['5000', '5 kHz (treble)'], ['12000', '12 kHz (high)']]
const REC_SECONDS = 5

/** dBFS of a sample block (RMS) and its peak. -Infinity is clamped to -90. */
export function levels(samples) {
  let sum = 0, peak = 0
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); sum += samples[i] * samples[i]; if (a > peak) peak = a }
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  const db = (v) => (v > 1e-5 ? 20 * Math.log10(v) : -90)
  return { rms: db(rms), peak: db(peak) }
}
export function verdict(peakDb) {
  if (peakDb < -55) return ['warn', 'Almost silent. Say something, and check the mic is not muted or the wrong device.']
  if (peakDb < -30) return ['warn', 'A bit quiet. Move closer to the mic or raise the input volume.']
  if (peakDb < -3) return ['success', 'Good level. People will hear you clearly.']
  return ['warn', 'Very loud and may distort. Move back or lower the input volume.']
}
export function friendlyMediaError(e, what) {
  const n = e?.name
  if (n === 'NotAllowedError' || n === 'SecurityError') return `Access to the ${what} was blocked. Click the camera icon in the address bar, allow it, and try again.`
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return `No ${what} was found. Plug one in or check it is enabled in your system settings.`
  if (n === 'NotReadableError' || n === 'TrackStartError') return `The ${what} is busy or blocked. Close other apps that use it (video calls, recorders) and try again.`
  if (n === 'OverconstrainedError') return `This ${what} cannot do that setting. Choose Automatic.`
  return `Could not start the ${what} (${e?.message || e}).`
}

const CSS = `
.t-wm .cols{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px;align-items:start}
.t-wm .video{position:relative;border-radius:var(--radius-xl);overflow:hidden;background:#000;aspect-ratio:16/9;display:grid;place-items:center;box-shadow:var(--shadow-lg)}
.t-wm .video video{width:100%;height:100%;object-fit:contain;display:block;background:#000}
.t-wm .video video.mirror{transform:scaleX(-1)}
.t-wm .video .ph{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:10px;color:#cbd0e0;text-align:center;padding:20px;background:radial-gradient(circle at 30% 20%,#2a2150,#0b0b12 70%)}
.t-wm .video .ph .icon{width:44px;height:44px;opacity:.8}
.t-wm .video .live{position:absolute;top:12px;left:12px;display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:rgba(0,0,0,.55);backdrop-filter:blur(8px);color:#fff;font:600 12px var(--font)}
.t-wm .video .live i{width:8px;height:8px;border-radius:50%;background:#ef4444;animation:wm-pulse 1.4s ease-in-out infinite}
.t-wm .video .live.bad i{background:#fbbf24;animation:none}
@keyframes wm-pulse{50%{opacity:.3}}
.t-wm .chips{display:flex;gap:6px;flex-wrap:wrap}
.t-wm .chip{font:600 12px var(--mono);padding:3px 9px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border)}
.t-wm .chip.ok{background:var(--success-soft);border-color:color-mix(in srgb,var(--success) 35%,transparent);color:var(--success)}
.t-wm .chip.no{opacity:.55;text-decoration:line-through}
.t-wm .meter{position:relative;height:30px;border-radius:12px;background:var(--surface-3);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.12)}
.t-wm .meter .bar{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#22c55e 0%,#84cc16 55%,#facc15 75%,#ef4444 100%);background-size:calc(100% * 1) 100%;border-radius:12px 0 0 12px;transition:width .06s linear}
.t-wm .meter .peak{position:absolute;top:3px;bottom:3px;width:3px;border-radius:2px;background:var(--text);left:0;opacity:.8;transition:left .08s linear}
.t-wm .meter .ticks{position:absolute;inset:0;display:flex;justify-content:space-between;align-items:flex-end;padding:0 8px 2px;font:500 10px var(--mono);color:color-mix(in srgb,var(--text) 55%,transparent);pointer-events:none}
.t-wm .db{font:600 22px var(--mono);letter-spacing:-.02em}
.t-wm .ring{position:relative;width:56px;height:56px;flex:none}
.t-wm .ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.t-wm .ring circle{fill:none;stroke-width:5}
.t-wm .ring .bg{stroke:var(--surface-3)}
.t-wm .ring .fg{stroke:var(--accent);stroke-linecap:round;stroke-dasharray:138.2;stroke-dashoffset:138.2}
.t-wm .ring span{position:absolute;inset:0;display:grid;place-items:center;font:600 15px var(--mono)}
.t-wm .wave{display:block;width:100%;height:64px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border)}
.t-wm audio{width:100%;height:40px}
.t-wm .spk{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.t-wm .stat-note{font-size:13px;color:var(--muted)}
@media (max-width:860px){.t-wm .cols{grid-template-columns:minmax(0,1fr)}}
`

export function mount(root, { signal }) {
  baseCss()
  injectCss('wm', CSS)
  const mdev = navigator.mediaDevices
  const dead = new AbortController()
  signal?.addEventListener('abort', () => dead.abort())
  let camStream = null, micStream = null, micCtx = null, micTimer = 0, spCtx = null, fpsTimer = 0, rvfc = 0, recTimer = 0, recorder = null
  let recUrl = null, spkTimers = []

  // ----- devices -----
  const camSel = select([['', 'Default camera']], '', () => { if (camStream) startCam() })
  const micSel = select([['', 'Default microphone']], '', () => { if (micStream) startMic() })
  const outSel = select([['', 'Default speakers']], '', async (v) => { try { await spCtx?.setSinkId?.(v) } catch { toast('Could not switch the speakers', 'error') } })
  const outField = h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Speakers or headphones'), outSel)
  async function refreshDevices() {
    if (!mdev?.enumerateDevices) return
    const list = await mdev.enumerateDevices()
    const fill = (sel, kind, label) => {
      const cur = sel.value
      const items = list.filter((d) => d.kind === kind)
      sel.replaceChildren(h('option', { value: '' }, label), ...items.map((d, i) => h('option', { value: d.deviceId }, d.label || `${label.replace('Default ', '')} ${i + 1}`)))
      if (items.some((d) => d.deviceId === cur)) sel.value = cur
    }
    fill(camSel, 'videoinput', 'Default camera'); fill(micSel, 'audioinput', 'Default microphone'); fill(outSel, 'audiooutput', 'Default speakers')
    const canSink = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype
    outField.hidden = !canSink || list.filter((d) => d.kind === 'audiooutput').length < 2
  }
  mdev?.addEventListener?.('devicechange', refreshDevices)

  // ----- camera -----
  const video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Camera preview' })
  video.muted = true
  const ph = h('div', { class: 'ph' }, icon('video'), h('div', 'Your camera preview appears here'), h('small', 'Nothing is recorded or uploaded.'))
  const live = h('div', { class: 'live', hidden: true }, h('i'), h('span', 'Live'))
  const frame = h('div', { class: 'video' }, video, ph, live)
  const camStats = h('div')
  const camMsg = h('div')
  const resSel = select(RES, 'auto', () => { if (camStream) startCam() })
  const mirror = toggle('Mirror preview', true, (v) => video.classList.toggle('mirror', v))
  video.classList.add('mirror')
  // busy() puts the original children back when it finishes, so the icon and label live in stable nodes that we update in place
  const dynBtn = (label, iconName, opts) => {
    const b = button(label, opts)
    const wrap = h('span', { style: 'display:contents' }, icon(iconName))
    b.prepend(wrap)
    const labelEl = b.lastChild
    b.set = (ic, text) => { wrap.replaceChildren(icon(ic)); labelEl.textContent = text }
    return b
  }
  const camBtn = dynBtn('Start camera', 'video', { variant: 'primary' })
  const snapBtn = button('Take a photo', { icon: 'camera', disabled: true })
  const checkBtn = button('Check supported sizes', { icon: 'scan-search', size: 'sm' })
  const sizes = h('div')

  function stopCam() {
    camStream?.getTracks().forEach((t) => t.stop())
    camStream = null
    clearInterval(fpsTimer)
    if (rvfc && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(rvfc)
    rvfc = 0
    video.srcObject = null
    ph.hidden = false; live.hidden = true
    camBtn.set('video', 'Start camera')
    snapBtn.disabled = true
    clear(camStats)
  }
  const constraintsFor = (res, id, exact) => {
    const v = {}
    if (id) v.deviceId = { exact: id }
    const [w, hh] = (res === 'auto' ? '1280x720' : res).split('x').map(Number) // browsers default to 640 x 480 unless asked
    v.width = exact ? { exact: w } : { ideal: w }
    v.height = exact ? { exact: hh } : { ideal: hh }
    return { video: v, audio: false }
  }
  async function startCam() {
    if (!mdev?.getUserMedia) throw new Error('This browser cannot access the camera.')
    stopCam()
    clear(camMsg)
    try {
      camStream = await mdev.getUserMedia(constraintsFor(resSel.value, camSel.value, false))
    } catch (e) { camStream = null; clear(camMsg, alert('error', friendlyMediaError(e, 'camera'))); return }
    video.srcObject = camStream
    try { await video.play() } catch { /* autoplay is allowed because of the click */ }
    ph.hidden = true; live.hidden = false
    camBtn.set('video-off', 'Stop camera')
    snapBtn.disabled = false
    await refreshDevices()
    const tr = camStream.getVideoTracks()[0]
    const cur = tr.getSettings().deviceId
    if (cur && [...camSel.options].some((o) => o.value === cur)) camSel.value = cur
    tr.addEventListener('ended', () => { stopCam(); clear(camMsg, alert('warn', 'The camera was disconnected.')) })
    measureFps()
    paintCamStats(0)
  }
  function paintCamStats(measured) {
    const tr = camStream?.getVideoTracks()[0]
    if (!tr) return
    const s = tr.getSettings(), w = video.videoWidth || s.width, hh = video.videoHeight || s.height
    const caps = tr.getCapabilities?.() || {}
    clear(camStats, stats([
      { label: 'Resolution', value: w && hh ? `${w} × ${hh}` : '-', hint: w && hh ? `${formatNumber((w * hh) / 1e6, 1)} megapixels` : '', accent: true },
      { label: 'Frame rate', value: measured ? `${formatNumber(measured, 1)} fps` : 'Measuring...', hint: s.frameRate ? `driver says ${formatNumber(s.frameRate, 0)} fps` : '' },
      { label: 'Camera', value: tr.label || 'Camera', hint: caps.width?.max ? `up to ${caps.width.max} × ${caps.height.max}` : (s.facingMode ? `${s.facingMode} facing` : '') },
    ]))
  }
  function measureFps() {
    let frames = 0, t0 = performance.now(), lastQ = video.getVideoPlaybackQuality?.().totalVideoFrames || 0
    if (video.requestVideoFrameCallback) {
      const tick = () => { frames++; rvfc = video.requestVideoFrameCallback(tick) }
      rvfc = video.requestVideoFrameCallback(tick)
    }
    fpsTimer = setInterval(() => {
      const now = performance.now()
      let n = frames
      if (!video.requestVideoFrameCallback) { const q = video.getVideoPlaybackQuality?.().totalVideoFrames || 0; n = q - lastQ; lastQ = q }
      paintCamStats((n * 1000) / (now - t0))
      frames = 0; t0 = now
    }, 1000)
  }
  camBtn.addEventListener('click', () => busy(camBtn, async () => { if (camStream) stopCam(); else await startCam() }, { label: 'Starting' }))
  snapBtn.addEventListener('click', async () => {
    if (!video.videoWidth) return
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight
    const x = c.getContext('2d')
    if (mirror.input.checked) { x.translate(c.width, 0); x.scale(-1, 1) }
    x.drawImage(video, 0, 0)
    download(await toBlob(c, 'image/png'), `camera-test-${Date.now()}.png`)
  })
  checkBtn.addEventListener('click', () => busy(checkBtn, async () => {
    const wasOn = !!camStream
    stopCam()
    const out = []
    for (const [res, label] of RES.slice(1)) {
      let ok = false, got = ''
      try {
        const s = await mdev.getUserMedia(constraintsFor(res, camSel.value, true))
        const st = s.getVideoTracks()[0].getSettings(); got = `${st.width}×${st.height}`; ok = true
        s.getTracks().forEach((t) => t.stop())
      } catch (e) { if (e?.name === 'NotAllowedError' || e?.name === 'NotFoundError' || e?.name === 'NotReadableError') throw new Error(friendlyMediaError(e, 'camera')) }
      out.push(h('span', { class: ['chip', ok ? 'ok' : 'no'], title: ok ? `Works: ${got}` : 'Not supported by this camera' }, `${ok ? '✓' : '×'} ${label.split(' (')[0]}`))
      clear(sizes, h('div', { class: 'chips' }, out))
    }
    await refreshDevices()
    if (wasOn) await startCam()
  }, { label: 'Testing sizes', errorTo: camMsg }))

  // ----- microphone -----
  const meterBar = h('div', { class: 'bar' }), meterPeak = h('div', { class: 'peak' })
  const meter = h('div', { class: 'meter', role: 'meter', 'aria-label': 'Microphone level', 'aria-valuemin': -60, 'aria-valuemax': 0 }, meterBar, meterPeak,
    h('div', { class: 'ticks' }, ['-60', '-45', '-30', '-15', '0 dB'].map((t) => h('span', t))))
  const dbText = h('div', { class: 'db' }, '-- dB')
  const micMsg = h('div'), micVerdict = h('div')
  const echo = toggle('Echo cancellation', true), noise = toggle('Noise suppression', true), agc = toggle('Automatic gain', true)
  const monitor = toggle('Hear myself (use headphones)', false, (v) => { if (monGain) monGain.gain.value = v ? 1 : 0 })
  const micBtn = dynBtn('Start microphone', 'mic', { variant: 'primary' })
  let monGain = null, peakHold = -90, peakAt = 0, recentPeak = [], lastShown = 0
  const dbToPct = (db) => clamp(((db + 60) / 60) * 100, 0, 100)

  function stopMic() {
    clearInterval(micTimer); micTimer = 0
    micStream?.getTracks().forEach((t) => t.stop()); micStream = null
    micCtx?.close().catch(() => {}); micCtx = null; monGain = null
    meterBar.style.width = '0'; meterPeak.style.left = '0'
    dbText.textContent = '-- dB'
    clear(micVerdict)
    micBtn.set('mic', 'Start microphone')
  }
  async function startMic() {
    if (!mdev?.getUserMedia) throw new Error('This browser cannot access the microphone.')
    stopMic(); clear(micMsg)
    try {
      micStream = await mdev.getUserMedia({ audio: { deviceId: micSel.value ? { exact: micSel.value } : undefined, echoCancellation: echo.input.checked, noiseSuppression: noise.input.checked, autoGainControl: agc.input.checked }, video: false })
    } catch (e) { micStream = null; clear(micMsg, alert('error', friendlyMediaError(e, 'microphone'))); return false }
    micCtx = new (window.AudioContext || window.webkitAudioContext)()
    await micCtx.resume?.()
    const src = micCtx.createMediaStreamSource(micStream)
    const an = micCtx.createAnalyser(); an.fftSize = 2048
    src.connect(an)
    monGain = micCtx.createGain(); monGain.gain.value = monitor.input.checked ? 1 : 0
    src.connect(monGain); monGain.connect(micCtx.destination)
    const buf = new Float32Array(an.fftSize)
    micBtn.set('mic-off', 'Stop microphone')
    micStream.getAudioTracks()[0].addEventListener('ended', () => { stopMic(); clear(micMsg, alert('warn', 'The microphone was disconnected.')) })
    micTimer = setInterval(() => {
      an.getFloatTimeDomainData(buf)
      const { rms, peak } = levels(buf)
      const now = performance.now()
      meterBar.style.width = `${dbToPct(rms)}%`
      if (peak > peakHold || now - peakAt > 900) { peakHold = peak; peakAt = now }
      meterPeak.style.left = `calc(${dbToPct(peakHold)}% - 3px)`
      dbText.textContent = `${Math.round(Math.max(-90, rms))} dB`
      meter.setAttribute('aria-valuenow', Math.round(rms))
      recentPeak.push([now, peak]); recentPeak = recentPeak.filter(([t]) => now - t < 2000)
      if (now - lastShown > 400) {
        lastShown = now
        const [kind, text] = verdict(Math.max(...recentPeak.map((p) => p[1])))
        clear(micVerdict, alert(kind === 'success' ? 'success' : 'info', text))
      }
    }, 50)
    await refreshDevices()
    const cur = micStream.getAudioTracks()[0].getSettings().deviceId
    if (cur && [...micSel.options].some((o) => o.value === cur)) micSel.value = cur
    return true
  }
  micBtn.addEventListener('click', () => busy(micBtn, async () => { if (micStream) stopMic(); else await startMic() }, { label: 'Starting' }))
  for (const t of [echo, noise, agc]) t.input.addEventListener('change', () => { if (micStream) startMic() })

  // ----- record and play back -----
  const recBtn = button(`Record ${REC_SECONDS} seconds`, { icon: 'circle-dot', variant: 'secondary' })
  const ringFg = h('circle', { class: 'fg', cx: 28, cy: 28, r: 22 })
  const ringTxt = h('span', String(REC_SECONDS))
  const ring = h('div', { class: 'ring', hidden: true }, h('svg', { viewBox: '0 0 56 56', 'aria-hidden': 'true' }, h('circle', { class: 'bg', cx: 28, cy: 28, r: 22 }), ringFg), ringTxt)
  const playHost = h('div', { class: 'stack tight' })
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || ''
  recBtn.addEventListener('click', () => busy(recBtn, async () => {
    if (!window.MediaRecorder) throw new Error('This browser cannot record audio. The level meter still works.')
    if (!micStream && !(await startMic())) return
    clear(playHost)
    const chunks = []
    recorder = new MediaRecorder(micStream, mimeType ? { mimeType } : undefined)
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise((res) => { recorder.onstop = res })
    recorder.start()
    ring.hidden = false
    const t0 = performance.now()
    await new Promise((res) => {
      recTimer = setInterval(() => {
        const el = (performance.now() - t0) / 1000
        ringFg.style.strokeDashoffset = String(138.2 * (1 - Math.min(1, el / REC_SECONDS)))
        ringTxt.textContent = String(Math.max(0, Math.ceil(REC_SECONDS - el)))
        if (el >= REC_SECONDS) { clearInterval(recTimer); res() }
      }, 100)
    })
    recorder.stop(); await done
    ring.hidden = true
    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' })
    if (recUrl) URL.revokeObjectURL(recUrl)
    recUrl = URL.createObjectURL(blob)
    const audio = h('audio', { controls: true, src: recUrl, 'aria-label': 'Your recording' })
    const wave = h('canvas', { class: 'wave', width: 600, height: 64, 'aria-hidden': 'true' })
    clear(playHost, h('div', { class: 'field-label' }, 'Your recording'), wave, audio,
      h('div', { class: 'row' }, button('Download', { icon: 'download', size: 'sm', onClick: () => download(blob, `mic-test.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`) }), h('span', { class: 'small muted' }, `${(blob.size / 1024).toFixed(0)} KB, stays on this device`)))
    audio.play().catch(() => {})
    drawWave(wave, blob)
  }, { label: 'Recording', errorTo: micMsg }))
  async function drawWave(canvas, blob) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)()
      const buf = await ac.decodeAudioData(await blob.arrayBuffer())
      ac.close()
      const d = buf.getChannelData(0), W = canvas.width, H = canvas.height, step = Math.ceil(d.length / W), x = canvas.getContext('2d')
      x.clearRect(0, 0, W, H)
      x.fillStyle = getComputedStyle(root).getPropertyValue('--accent') || '#6a5cf0'
      for (let i = 0; i < W; i++) {
        let min = 1, max = -1
        for (let j = 0; j < step; j++) { const v = d[i * step + j] || 0; if (v < min) min = v; if (v > max) max = v }
        const y1 = ((1 + min) / 2) * H, y2 = ((1 + max) / 2) * H
        x.fillRect(i, y1, 1, Math.max(1, y2 - y1))
      }
    } catch { canvas.hidden = true }
  }

  // ----- speakers -----
  const freqSel = select(FREQS, '440')
  const vol = rangeField('Volume', { min: 1, max: 60, step: 1, value: 15, format: (v) => `${v}%`, hint: 'Start low, then turn it up.' })
  const spkNow = h('div', { class: 'stat-note', 'aria-live': 'polite' }, 'Pick a channel to play a short tone.')
  function tone(pan, ms = 1100, delay = 0) {
    spCtx ??= new (window.AudioContext || window.webkitAudioContext)()
    spCtx.resume?.()
    if (outSel.value) spCtx.setSinkId?.(outSel.value).catch(() => {})
    const t = spCtx.currentTime + delay / 1000
    const osc = spCtx.createOscillator(), g = spCtx.createGain()
    osc.type = 'sine'; osc.frequency.value = Number(freqSel.value)
    const lvl = (vol.input.valueAsNumber / 100) ** 2
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + 0.04); g.gain.setValueAtTime(lvl, t + ms / 1000 - 0.08); g.gain.linearRampToValueAtTime(0, t + ms / 1000)
    let last = g
    if (spCtx.createStereoPanner) { const p = spCtx.createStereoPanner(); p.pan.value = pan; g.connect(p); last = p }
    osc.connect(g); last.connect(spCtx.destination)
    osc.start(t); osc.stop(t + ms / 1000 + 0.05)
    return ms
  }
  const label = (pan) => (pan < 0 ? 'Left speaker' : pan > 0 ? 'Right speaker' : 'Both speakers')
  function play(pan) {
    spkTimers.forEach(clearTimeout); spkTimers = []
    spkNow.textContent = `Playing: ${label(pan)} at ${freqSel.value} Hz`
    tone(pan)
    spkTimers.push(setTimeout(() => { spkNow.textContent = 'You should have heard the tone only from the highlighted side.' }, 1200))
  }
  function sequence() {
    spkTimers.forEach(clearTimeout); spkTimers = []
    spkNow.textContent = 'Left...'
    tone(-1, 900, 0); tone(1, 900, 1100); tone(0, 900, 2200)
    spkTimers.push(setTimeout(() => { spkNow.textContent = 'Right...' }, 1100), setTimeout(() => { spkNow.textContent = 'Both...' }, 2200), setTimeout(() => { spkNow.textContent = 'Done. Left, then right, then both. If the sides were swapped, check your cables or the balance setting.' }, 3300))
  }

  // ----- layout -----
  const unsup = !mdev?.getUserMedia ? unsupported('Camera and microphone access', 'This page must be opened over HTTPS in a recent browser. Chrome, Edge, Firefox and Safari all work.') : null
  root.append(h('div', { class: 't-wm stack' }, unsup,
    h('div', { class: 'cols' },
      h('section', { class: 'panel stack' }, h('h2', h('span', { class: 'row', style: 'gap:8px' }, icon('video'), 'Camera')),
        frame, camMsg, camStats,
        h('div', { class: 'row' }, camBtn, snapBtn, mirror),
        h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Camera'), camSel), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Size'), resSel)),
        h('div', { class: 'row' }, checkBtn, h('span', { class: 'small muted' }, 'Tries each size to see what your camera really supports.')), sizes),
      h('div', { class: 'stack' },
        h('section', { class: 'panel stack' }, h('h2', h('span', { class: 'row', style: 'gap:8px' }, icon('mic'), 'Microphone')),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Microphone'), micSel),
          meter, h('div', { class: 'row between' }, dbText, micBtn), micMsg, micVerdict,
          h('div', { class: 'stack tight' }, echo, noise, agc, monitor),
          h('div', { class: 'row' }, recBtn, ring), playHost),
        h('section', { class: 'panel stack' }, h('h2', h('span', { class: 'row', style: 'gap:8px' }, icon('volume-2'), 'Speakers')),
          h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tone'), freqSel), vol),
          outField,
          h('div', { class: 'spk' }, button('Left', { icon: 'arrow-left', onClick: () => play(-1) }), button('Both', { icon: 'volume-2', onClick: () => play(0) }), button('Right', { icon: 'arrow-right', onClick: () => play(1) })),
          button('Left, then right, then both', { icon: 'play', variant: 'ghost', size: 'sm', onClick: sequence }), spkNow))),
    h('p', { class: 'small muted' }, 'Privacy: the camera and microphone run only while you have them switched on, only inside this page, and nothing is uploaded. Your 5 second recording stays in memory until you leave.')))

  // Device names stay hidden until the browser has granted access once, so show the generic list first.
  refreshDevices().catch(() => {})
  return () => {
    dead.abort()
    stopCam(); stopMic()
    clearInterval(recTimer)
    try { if (recorder?.state === 'recording') recorder.stop() } catch { /* already stopped */ }
    spkTimers.forEach(clearTimeout)
    spCtx?.close().catch(() => {}); spCtx = null
    if (recUrl) URL.revokeObjectURL(recUrl)
    mdev?.removeEventListener?.('devicechange', refreshDevices)
  }
}
