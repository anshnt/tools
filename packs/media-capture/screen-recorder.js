// Screen recorder: getDisplayMedia (screen, window or tab) + optional microphone mixed with system audio through WebAudio,
// an optional webcam bubble composited on a canvas, countdown, pause/resume, timer, then preview and download.
import { h, icon, button, alert, toast, formatBytes } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import * as K from './_kit.js'

const FPS = [['15', '15 fps'], ['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps']]
const QUALITY = [['standard', 'Standard'], ['high', 'High'], ['max', 'Maximum']]
const COUNT = [['0', 'No countdown'], ['3', '3 seconds'], ['5', '5 seconds'], ['10', '10 seconds']]

export function mount(root, { signal }) {
  K.useStyle()
  const formats = K.videoFormats()
  const canCapture = !!navigator.mediaDevices?.getDisplayMedia && formats.length > 0
  const prefs = { sys: true, mic: false, cam: false, count: '3', fps: '30', quality: 'standard', fmt: formats[0]?.id, ...load('mc:screen', {}) }
  if (!formats.some((f) => f.id === prefs.fmt)) prefs.fmt = formats[0]?.id
  const keep = () => save('mc:screen', prefs)

  // ---- state ----
  let state = 'idle' // idle | countdown | rec | paused | saving
  let session = null // everything that must be released when recording ends
  let tick = 0
  let disposed = false
  const sw = new K.Stopwatch()

  // ---- stage ----
  const startBtn = button('Start recording', { icon: 'circle-dot', variant: 'primary', size: 'lg', disabled: !canCapture, onClick: () => start() })
  const idle = K.idleCard({
    icon: 'monitor-play', title: 'Record your screen',
    text: 'Pick a screen, a window or a browser tab. Add your voice, system sound and a webcam bubble if you like.',
    badges: [['shield-check', 'Stays on your device'], ['sparkles', 'No watermark'], ['zap', 'No sign-up']],
    actions: [startBtn],
  })
  const stage = h('div', { class: 'mc-stage', 'data-state': 'idle' }, K.aurora(), idle)
  const setState = (s) => { state = s; stage.dataset.state = s === 'countdown' || s === 'saving' ? 'idle' : s }

  // ---- options ----
  const optSys = K.optToggle({ icon: 'volume-2', title: 'System audio', desc: 'Sound from the screen or tab you share', checked: prefs.sys, onChange: (v) => { prefs.sys = v; keep() } })
  const optMic = K.optToggle({ icon: 'mic', title: 'Microphone', desc: 'Your voice, mixed with the sound', checked: prefs.mic, onChange: (v) => { prefs.mic = v; keep() } })
  const optCam = K.optToggle({ icon: 'webcam', title: 'Webcam bubble', desc: 'Your face in the corner', checked: prefs.cam, onChange: (v) => { prefs.cam = v; keep() } })
  const optCount = K.optSelect({ icon: 'timer', title: 'Countdown', options: COUNT, value: prefs.count, onChange: (v) => { prefs.count = v; keep() } })
  const optFps = K.optSelect({ icon: 'gauge', title: 'Frame rate', options: FPS, value: prefs.fps, onChange: (v) => { prefs.fps = v; keep() } })
  const optQuality = K.optSelect({ icon: 'sliders-horizontal', title: 'Quality', options: QUALITY, value: prefs.quality, onChange: (v) => { prefs.quality = v; keep() } })
  const optFmt = K.optSelect({
    icon: 'file-video', title: 'Format', options: formats.map((f) => [f.id, f.label]), value: prefs.fmt, disabled: formats.length < 2,
    onChange: (v) => { prefs.fmt = v; keep() },
  })
  const options = h('div', { class: 'mc-opts' }, optSys, optMic, optCam, optCount, optFps, optQuality, optFmt)

  // ---- takes ----
  const takes = K.takeGrid({ title: 'Your recordings' })

  // ---- recording ----
  async function start() {
    if (state !== 'idle' || !canCapture) return
    setState('countdown')
    startBtn.disabled = true
    const s = (session = { streams: [], timers: [], reasons: [] })
    try {
      let display
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: +prefs.fps, max: +prefs.fps } },
          audio: prefs.sys ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
          systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
        })
      } catch (e) {
        toast(e?.name === 'NotAllowedError' ? 'No screen was selected, so nothing started.' : K.mediaError(e, 'screen'), e?.name === 'NotAllowedError' ? 'info' : 'error')
        return reset()
      }
      s.streams.push(display)
      if (disposed) return release()
      const vTrack = display.getVideoTracks()[0]
      const sysTrack = display.getAudioTracks()[0]
      vTrack.addEventListener('ended', () => { if (state === 'rec' || state === 'paused') stop(); else if (state === 'countdown') cancelStart() })
      if (prefs.sys && !sysTrack) toast('No system sound was shared. Tick "Share audio" in the picker next time.', 'info', 6000)

      let mic = null, cam = null
      if (prefs.mic) {
        try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); s.streams.push(mic) } catch (e) { toast(`${K.mediaError(e, 'microphone')} Recording without it.`, 'error') }
      }
      if (prefs.cam) {
        try { cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } }); s.streams.push(cam) } catch (e) { toast(`${K.mediaError(e, 'camera')} Recording without the bubble.`, 'error') }
      }
      if (disposed || state !== 'countdown') return cancelStart()

      // Sound: system and mic are mixed through WebAudio so both land on one track; a lone system track is used as it is.
      let audioTrack = sysTrack || null
      if (mic) {
        try {
          const ctx = new AudioContext()
          ctx.resume?.()
          s.ctx = ctx
          const dest = ctx.createMediaStreamDestination()
          if (sysTrack) ctx.createMediaStreamSource(new MediaStream([sysTrack])).connect(dest)
          s.micGain = ctx.createGain()
          s.analyser = ctx.createAnalyser()
          s.analyser.fftSize = 1024
          ctx.createMediaStreamSource(mic).connect(s.micGain)
          s.micGain.connect(dest)
          s.micGain.connect(s.analyser)
          audioTrack = dest.stream.getAudioTracks()[0]
        } catch (e) {
          console.error(e)
          audioTrack = sysTrack || mic.getAudioTracks()[0]
          s.micGain = s.analyser = null
        }
      }

      // Picture: the raw screen track, or a canvas composite when a webcam bubble is on.
      const settings = vTrack.getSettings()
      let outTrack = vTrack
      let width = settings.width || 1920, height = settings.height || 1080
      if (cam) {
        const maxEdge = prefs.quality === 'standard' ? 1920 : 3840
        s.comp = K.composeVideo({ base: vTrack, overlay: cam.getVideoTracks()[0], maxEdge, fps: +prefs.fps })
        outTrack = s.comp.stream.getVideoTracks()[0]
        const k = Math.min(1, maxEdge / Math.max(width, height))
        width = Math.round(width * k); height = Math.round(height * k)
      }
      const fps = Math.round(settings.frameRate || +prefs.fps)
      const fmt = formats.find((f) => f.id === prefs.fmt) || formats[0]
      s.recStream = new MediaStream([outTrack, ...(audioTrack ? [audioTrack] : [])])
      s.info = { width, height, fps, fmt, audio: [sysTrack && 'System audio', mic && 'Mic'].filter(Boolean), cam: !!cam }

      // Live preview in the stage.
      const video = h('video', { class: 'mc-live', muted: true, autoplay: true, playsInline: true, 'aria-label': 'Live preview of your recording' })
      video.srcObject = s.comp ? s.comp.stream : display
      video.play().catch(() => {})
      stage.replaceChildren(K.aurora(), video)
      s.video = video

      const seconds = +prefs.count
      if (seconds > 0) {
        const cancelBtn = K.dockButton({ icon: 'x', label: 'Cancel', onClick: () => s.count?.cancel() })
        const dock = h('div', { class: 'mc-dock' }, cancelBtn)
        stage.append(dock)
        s.count = K.countdown(stage, seconds)
        const ok = await s.count.promise
        dock.remove()
        if (!ok || disposed || state !== 'countdown') return cancelStart()
      }
      beginRecording(s, fmt)
    } catch (e) {
      console.error(e)
      toast(e?.message || 'Could not start recording.', 'error')
      reset()
    }
  }

  function beginRecording(s, fmt) {
    const { width, height, fps } = s.info
    const sizeChip = h('span', '0 B')
    const timer = h('span', { class: 'timer' }, '00:00')
    const label = h('b', 'REC')
    const meter = s.analyser ? K.levelBars() : null
    const hud = h('div', { class: 'mc-hud' },
      h('span', { class: 'mc-chip mono' }, h('span', { class: 'mc-dot' }), label, timer),
      h('span', { class: 'mc-chip' }, icon('hard-drive'), sizeChip),
      h('span', { class: 'grow' }),
      meter ? h('span', { class: 'mc-chip' }, icon('mic'), meter) : null,
      h('span', { class: 'mc-chip' }, icon('monitor'), `${width}x${height} · ${fps} fps`))
    const pauseBtn = K.dockButton({ icon: 'pause', label: 'Pause recording', onClick: () => togglePause() })
    const muteBtn = s.micGain ? K.dockButton({ icon: 'mic', label: 'Mute microphone', pressed: false, variant: 'danger', onClick: () => muteMic() }) : null
    const stopBtn = K.dockButton({ label: 'Stop and save', variant: 'stop', onClick: () => stop() })
    s.ui = { pauseBtn, muteBtn, label }
    stage.append(hud, h('div', { class: 'mc-dock' }, muteBtn, pauseBtn, stopBtn))

    try {
      s.rec = new K.Rec(s.recStream, {
        mime: fmt.mime, videoBps: K.bitrateFor(width, height, fps, prefs.quality),
        onBytes: (b) => { sizeChip.textContent = formatBytes(b) },
        onLimit: () => { toast('Reached the 1.8 GB limit, so the recording was saved.', 'info', 8000); stop() },
        onError: (e) => { toast(`Recording stopped: ${e?.message || 'the recorder reported an error'}`, 'error'); stop() },
      })
      s.rec.start()
    } catch (e) {
      console.error(e)
      toast(`Your browser could not start recording as ${fmt.label}. Try another format.`, 'error')
      return reset()
    }
    sw.start()
    setState('rec')
    stopBtn.focus({ preventScroll: true })
    const buf = new Float32Array(1024)
    s.timers.push(setInterval(() => {
      timer.textContent = K.clock(sw.seconds)
      if (meter && s.analyser) {
        s.analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const x of buf) sum += x * x
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6)
        meter.level(state === 'rec' && !s.muted ? Math.max(0, Math.min(1, (db + 56) / 50)) : 0)
      }
    }, 100))
  }

  function togglePause() {
    const s = session
    if (!s?.rec) return
    const pausing = state === 'rec'
    if (pausing) { s.rec.pause(); sw.pause(); setState('paused') } else { s.rec.resume(); sw.resume(); setState('rec') }
    s.ui.label.textContent = pausing ? 'PAUSED' : 'REC'
    const b = s.ui.pauseBtn
    b.replaceChildren(icon(pausing ? 'play' : 'pause'))
    b.setAttribute('aria-label', pausing ? 'Resume recording' : 'Pause recording')
    b.title = pausing ? 'Resume recording' : 'Pause recording'
  }

  function muteMic() {
    const s = session
    s.muted = !s.muted
    s.micGain.gain.value = s.muted ? 0 : 1
    const b = s.ui.muteBtn
    b.setAttribute('aria-pressed', String(s.muted))
    b.replaceChildren(icon(s.muted ? 'mic-off' : 'mic'))
    b.setAttribute('aria-label', s.muted ? 'Unmute microphone' : 'Mute microphone')
    b.title = b.getAttribute('aria-label')
  }

  async function stop() {
    const s = session
    if (!s?.rec || (state !== 'rec' && state !== 'paused')) return
    setState('saving')
    const seconds = sw.stop()
    let blob
    try { blob = await s.rec.stop() } catch (e) { console.error(e); blob = new Blob(s.rec.chunks, { type: s.rec.type }) }
    const info = s.info
    release()
    reset()
    if (!blob.size) return toast('Nothing was recorded.', 'error')
    const done = await K.fixWebmDuration(blob, seconds)
    if (disposed) return
    addTake(done, seconds, info)
  }

  function addTake(blob, seconds, info) {
    const url = URL.createObjectURL(blob)
    const media = h('video', { class: 'mc-take-media', controls: true, preload: 'metadata', playsInline: true, src: `${url}#t=0.1`, 'aria-label': 'Recording preview' })
    const card = K.takeCard({
      media, blob, name: `screen-recording-${K.stamp()}`, ext: info.fmt.ext, dispose: () => URL.revokeObjectURL(url),
      chips: [['clock', K.clock(seconds)], K.sizeChip(blob.size), ['monitor', `${info.width}x${info.height}`], ['file-video', info.fmt.ext.toUpperCase()],
        info.audio.length ? ['volume-2', info.audio.join(' + ')] : ['volume-x', 'No sound'], info.cam ? ['webcam', 'Webcam bubble'] : null],
      actions: info.fmt.ext === 'webm' ? [h('a', { class: 'btn btn-secondary btn-sm', href: '#/video-to-mp4', target: '_blank', rel: 'noopener', title: 'Opens Video to MP4 in a new tab. Download this recording first, then drop it there.' }, icon('repeat-2'), h('span', 'Convert to MP4'))] : [],
    })
    takes.add(card)
    toast(`Saved: ${K.clock(seconds)}, ${formatBytes(blob.size)}`, 'success')
  }

  // Release every stream, timer and node of the current session.
  function release() {
    const s = session
    if (!s) return
    s.count?.cancel()
    for (const t of s.timers) clearInterval(t)
    s.timers.length = 0
    s.comp?.stop()
    for (const st of s.streams) K.stopStream(st)
    s.recStream && K.stopStream(s.recStream)
    s.ctx?.close().catch(() => {})
    if (s.video) { s.video.pause(); s.video.srcObject = null }
    session = null
  }

  function cancelStart() { release(); reset() }

  function reset() {
    setState('idle')
    session && release()
    startBtn.disabled = !canCapture
    stage.replaceChildren(K.aurora(), idle)
    clearInterval(tick)
  }

  const cleanup = () => {
    disposed = true
    if (session?.rec && session.rec.state !== 'inactive') { try { session.rec.rec.stop() } catch { /* already stopped */ } }
    release()
  }
  signal?.addEventListener('abort', cleanup, { once: true })

  root.append(h('div', { class: 'mc stack' },
    canCapture ? null : alert('warn', h('strong', 'Screen recording is not available here. '), 'Phones and some browsers cannot capture the screen. Open this page in Chrome, Edge or Firefox on a computer.'),
    stage,
    options,
    h('p', { class: 'small muted' }, icon('info'), ' Tip: pick a Chrome tab and tick "Share tab audio" to capture the sound of a video call or a song. On Windows, "Entire screen" can share system sound too. Files are made on your device and never uploaded.'),
    takes.el,
    h('p', { class: 'small muted' }, 'WebM plays in browsers and most editors. For WhatsApp, iPhone or Premiere, convert it with ', h('a', { class: 'link', href: '#/video-to-mp4', target: '_blank', rel: 'noopener' }, 'Video to MP4'), '.')))
  return cleanup
}
