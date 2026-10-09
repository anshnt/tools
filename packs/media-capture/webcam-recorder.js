// Webcam recorder and photo booth (params.mode === 'photo'): device picker, resolution, mirror, snapshot, self-timer,
// pause/resume recording with optional microphone, and download. All streams stop when you leave or turn the camera off.
import { h, icon, button, alert, toast, formatBytes, onCleanup, download } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { zip } from '../../lib/files.js'
import * as K from './_kit.js'

const RES = { 360: [640, 360], 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] }
const RES_OPTS = [['360', '360p (640x360)'], ['720', 'HD 720p'], ['1080', 'Full HD 1080p'], ['2160', '4K (if the camera has it)']]
const TIMER = [['0', 'Off'], ['3', '3 seconds'], ['5', '5 seconds'], ['10', '10 seconds']]
const LOOKS = [['none', 'Natural'], ['grayscale(1) contrast(1.1)', 'Black and white'], ['sepia(.75) contrast(1.05)', 'Warm sepia'], ['saturate(1.6) contrast(1.08)', 'Vivid'], ['contrast(1.15) brightness(1.06) saturate(.85)', 'Soft fade']]
const PHOTO_TYPES = [['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP']]
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const canFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype

export function mount(root, { params, signal }) {
  K.useStyle()
  const photoMode = params?.mode === 'photo'
  const formats = K.videoFormats()
  const md = navigator.mediaDevices
  const canCamera = !!md?.getUserMedia
  const canRecord = canCamera && formats.length > 0
  const KEY = photoMode ? 'mc:photo' : 'mc:webcam'
  const prefs = { res: '720', mirror: true, saveMirror: false, timer: '0', fmt: formats[0]?.id, mic: false, look: 'none', photoType: 'image/jpeg', ...load(KEY, {}) }
  if (!formats.some((f) => f.id === prefs.fmt)) prefs.fmt = formats[0]?.id
  const keep = () => save(KEY, prefs)

  let state = 'off' // off | on | countdown | rec | paused | saving
  let stream = null
  let ctx = null // audio context for the mic meter
  let analyser = null
  let rec = null
  let comp = null
  let counter = null
  let timers = []
  let disposed = false
  let camId = '', micId = ''
  let shots = 0
  const sw = new K.Stopwatch()
  const setState = (s) => { state = s; stage.dataset.state = s === 'rec' || s === 'paused' ? s : 'idle' }

  // ---- stage ----
  const startBtn = button('Turn on camera', { icon: 'video', variant: 'primary', size: 'lg', disabled: !canCamera, onClick: () => openCamera() })
  const idle = K.idleCard({
    icon: photoMode ? 'camera' : 'webcam', title: photoMode ? 'Say cheese' : 'Record yourself',
    text: photoMode ? 'Turn on your camera, pick a look and take as many photos as you like. They stay on your device.' : 'Turn on your camera to see a live preview, then record a video or snap a photo.',
    badges: [['shield-check', 'Never uploaded'], ['flip-horizontal', 'Mirror toggle'], photoMode ? ['timer', 'Self-timer'] : ['mic', 'Optional mic']],
    actions: [startBtn],
  })
  const stage = h('div', { class: 'mc-stage', 'data-state': 'idle' }, K.aurora(), idle)
  const flashEl = h('div', { class: 'mc-flash', 'aria-hidden': 'true' })
  let video = null

  // ---- options ----
  const optCam = K.optSelect({ icon: 'webcam', title: 'Camera', options: [['', 'Default camera']], value: '', onChange: (v) => { camId = v; if (state === 'on') openCamera() } })
  const optRes = K.optSelect({ icon: 'maximize', title: 'Resolution', options: RES_OPTS, value: prefs.res, onChange: (v) => { prefs.res = v; keep(); if (state === 'on') openCamera() } })
  const optMic = K.optSelect({ icon: 'mic', title: 'Microphone', options: [['off', 'No microphone'], ['', 'Default microphone']], value: prefs.mic ? '' : 'off', onChange: (v) => { prefs.mic = v !== 'off'; micId = v === 'off' ? '' : v; keep(); if (state === 'on') openCamera() } })
  const optMirror = K.optToggle({ icon: 'flip-horizontal', title: 'Mirror preview', desc: 'Like a selfie view', checked: prefs.mirror, onChange: (v) => { prefs.mirror = v; keep(); applyMirror() } })
  const optSave = K.optToggle({ icon: 'flip-horizontal-2', title: 'Save mirrored', desc: photoMode ? 'Photos match the preview' : 'Videos and photos match the preview', checked: prefs.saveMirror, onChange: (v) => { prefs.saveMirror = v; keep() } })
  const optTimer = K.optSelect({ icon: 'timer', title: 'Self-timer', desc: photoMode ? 'Delay before the photo' : 'Delay before photo or recording', options: TIMER, value: prefs.timer, onChange: (v) => { prefs.timer = v; keep() } })
  const optFmt = K.optSelect({ icon: 'file-video', title: 'Video format', options: formats.map((f) => [f.id, f.label]), value: prefs.fmt, disabled: formats.length < 2, onChange: (v) => { prefs.fmt = v; keep() } })
  const optLook = K.optSelect({ icon: 'wand-sparkles', title: 'Look', options: LOOKS, value: prefs.look, disabled: !canFilter, onChange: (v) => { prefs.look = v; keep(); applyMirror() } })
  const optType = K.optSelect({ icon: 'image', title: 'Photo format', options: PHOTO_TYPES, value: prefs.photoType, onChange: (v) => { prefs.photoType = v; keep() } })
  const options = h('div', { class: 'mc-opts' }, optCam, optRes, photoMode ? optLook : optMic, optMirror, optSave, optTimer, photoMode ? optType : optFmt)

  // ---- results ----
  const takes = K.takeGrid({ title: 'Your videos' })
  const shotGrid = h('div', { class: 'mc-shots' })
  const shotCount = h('span', { class: 'count' }, '0')
  const shotList = []
  const shotsEl = h('section', { class: 'stack', hidden: true, 'aria-label': 'Photos' },
    h('div', { class: 'mc-head' }, h('h3', 'Your photos', shotCount),
      h('div', { class: 'row' },
        button('Download all', { icon: 'archive', variant: 'secondary', size: 'sm', onClick: (e) => zipAll(e.currentTarget) }),
        button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { for (const s of [...shotList]) s.dispose() } }))),
    shotGrid)
  onCleanup(() => { for (const s of [...shotList]) s.dispose() })

  const syncShots = () => { shotCount.textContent = String(shotList.length); shotsEl.hidden = shotList.length === 0 }

  function applyMirror() {
    if (!video) return
    video.classList.toggle('mirror', prefs.mirror)
    video.style.filter = !photoMode || prefs.look === 'none' ? '' : prefs.look
  }

  // ---- camera ----
  const constraintsFor = (withIds, withMic) => ({
    video: { ...(withIds && camId ? { deviceId: { exact: camId } } : {}), width: { ideal: RES[prefs.res][0] }, height: { ideal: RES[prefs.res][1] }, frameRate: { ideal: 30 } },
    audio: withMic ? { ...(withIds && micId ? { deviceId: { exact: micId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
  })

  async function getStream() {
    const wantMic = prefs.mic && canRecord && !photoMode
    const attempts = [[true, wantMic]]
    if (camId || micId) attempts.push([false, wantMic]) // a remembered device may be gone: retry with the defaults
    if (wantMic) attempts.push([false, false])
    let lastErr
    for (const [ids, mic] of attempts) {
      try {
        const s = await md.getUserMedia(constraintsFor(ids, mic))
        if (wantMic && !mic) toast('The microphone could not be started, so this is video only.', 'info', 5000)
        return s
      } catch (e) {
        lastErr = e
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') break
      }
    }
    throw lastErr
  }

  async function openCamera() {
    if (state === 'rec' || state === 'paused' || state === 'saving') return
    startBtn.disabled = true
    closeCamera(true)
    let s
    try {
      s = await getStream()
    } catch (e) {
      startBtn.disabled = !canCamera
      toast(K.mediaError(e, 'camera'), 'error', 8000)
      return setOff()
    }
    if (disposed) return K.stopStream(s)
    stream = s
    setState('on')
    const vt = s.getVideoTracks()[0]
    vt.addEventListener('ended', () => { if (stream === s) { toast('The camera was disconnected.', 'info'); stopAll(); setOff() } })
    const st = vt.getSettings()
    camId = st.deviceId || camId

    video = h('video', { class: ['mc-live', 'soft'], muted: true, autoplay: true, playsInline: true, 'aria-label': 'Live camera preview' })
    video.srcObject = s
    video.play().catch(() => {})
    applyMirror()
    drawIdleUi(st)
    fillDevices()
  }

  let hud = null
  function drawIdleUi(st) {
    const fps = Math.round(st.frameRate || 30)
    const meter = stream.getAudioTracks().length ? K.levelBars() : null
    if (meter) {
      try {
        ctx = new AudioContext()
        analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser)
        const buf = new Float32Array(1024)
        timers.push(setInterval(() => {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (const x of buf) sum += x * x
          meter.level(Math.max(0, Math.min(1, (20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6) + 56) / 50)))
        }, 100))
      } catch (e) { console.error(e) }
    }
    const info = h('span', { class: 'mc-chip' }, icon('webcam'), `${st.width || '?'}x${st.height || '?'} · ${fps} fps`)
    hud = { el: h('div', { class: 'mc-hud' }), info, meterChip: meter ? h('span', { class: 'mc-chip' }, icon('mic'), meter) : null }
    hud.el.replaceChildren(info, h('span', { class: 'grow' }), ...(hud.meterChip ? [hud.meterChip] : []))
    buildDock()
    stage.replaceChildren(K.aurora(), video, flashEl, hud.el, dock)
  }

  let dock = null
  const mirrorBtn = () => K.dockButton({ icon: 'flip-horizontal', label: 'Mirror the preview', pressed: prefs.mirror, onClick: (e) => { prefs.mirror = !prefs.mirror; optMirror.input.checked = prefs.mirror; keep(); e.currentTarget.setAttribute('aria-pressed', String(prefs.mirror)); applyMirror() } })
  function buildDock() {
    const off = K.dockButton({ icon: 'video-off', label: 'Turn the camera off', onClick: () => { stopAll(); setOff() } })
    const photo = K.dockButton({ icon: 'camera', label: 'Take a photo', onClick: () => takePhoto() })
    let kids
    if (photoMode) {
      const shutter = K.dockButton({ label: 'Take a photo', variant: 'rec', onClick: () => takePhoto() })
      shutter.classList.add('shutter')
      kids = [mirrorBtn(), shutter, off]
    } else if (canRecord) {
      kids = [photo, K.dockButton({ label: 'Start recording', variant: 'rec', pressed: false, onClick: () => beginRecord() }), off]
    } else kids = [photo, off]
    dock = h('div', { class: 'mc-dock' }, kids)
  }

  function stopAll() {
    comp?.stop(); comp = null
    counter?.cancel(); counter = null
    for (const t of timers) clearInterval(t)
    timers = []
    ctx?.close().catch(() => {}); ctx = analyser = null
    K.stopStream(stream); stream = null
    if (video) { video.pause(); video.srcObject = null }
    video = null
  }
  function closeCamera() { stopAll() }
  function setOff() { setState('off'); startBtn.disabled = !canCamera; stage.replaceChildren(K.aurora(), idle) }

  async function fillDevices() {
    try {
      const list = await md.enumerateDevices()
      const cams = list.filter((d) => d.kind === 'videoinput')
      const mics = list.filter((d) => d.kind === 'audioinput')
      const fill = (sel, items, first, current) => {
        sel.replaceChildren(...first.map(([v, l]) => h('option', { value: v }, l)), ...items.map((d, i) => h('option', { value: d.deviceId }, d.label || `${d.kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}`)))
        sel.value = [...sel.options].some((o) => o.value === current) ? current : sel.options[0].value
      }
      fill(optCam.select, cams, [], camId)
      fill(optMic.select, mics.filter((d) => d.deviceId !== 'default'), [['off', 'No microphone'], ['', 'Default microphone']], prefs.mic ? micId : 'off')
    } catch { /* labels are a nicety */ }
  }
  md?.addEventListener?.('devicechange', fillDevices)
  onCleanup(() => md?.removeEventListener?.('devicechange', fillDevices))

  // ---- photos ----
  async function takePhoto() {
    if (!video || !video.videoWidth || (state !== 'on' && state !== 'rec' && state !== 'paused')) return
    const secs = +prefs.timer
    if (secs > 0 && state === 'on') {
      counter = K.countdown(stage, secs)
      setState('countdown')
      const ok = await counter.promise
      counter = null
      if (!ok || disposed || !video) { if (state === 'countdown' && stream) setState('on'); return }
      setState('on')
    }
    await snap()
  }

  async function snap() {
    if (!video?.videoWidth) return
    const w = video.videoWidth, hh = video.videoHeight
    const c = document.createElement('canvas')
    c.width = w; c.height = hh
    const g = c.getContext('2d')
    if (canFilter && photoMode && prefs.look !== 'none') g.filter = prefs.look
    if (prefs.mirror && prefs.saveMirror) { g.translate(w, 0); g.scale(-1, 1) }
    g.drawImage(video, 0, 0, w, hh)
    flashEl.classList.remove('go')
    void flashEl.offsetWidth
    flashEl.classList.add('go')
    const type = prefs.photoType
    const blob = await new Promise((r) => c.toBlob(r, type, 0.92))
    if (!blob) return toast('Could not save that photo. Try another photo format.', 'error')
    addShot(blob, w, hh, type)
  }

  function addShot(blob, w, hh, type) {
    const url = URL.createObjectURL(blob)
    const name = `photo-${K.stamp()}-${++shots}.${EXT[type] || 'jpg'}`
    const img = h('img', { src: url, alt: `Photo ${shots}`, width: w, height: hh })
    const fig = h('figure', { class: 'mc-shot', style: { margin: 0 } }, img, h('div', { class: 'mc-shot-act' },
      button('', { icon: 'download', variant: 'primary', size: 'sm', ariaLabel: `Download photo ${shots}`, onClick: () => dl(blob, name) }),
      button('', { icon: 'trash-2', variant: 'secondary', size: 'sm', ariaLabel: `Delete photo ${shots}`, onClick: () => fig.dispose() })))
    fig.blob = blob; fig.fileName = name
    fig.dispose = () => { const i = shotList.indexOf(fig); if (i >= 0) shotList.splice(i, 1); fig.remove(); URL.revokeObjectURL(url); syncShots() }
    shotList.push(fig)
    shotGrid.prepend(fig)
    syncShots()
  }
  const dl = download
  async function zipAll(btn) {
    if (!shotList.length) return
    btn.disabled = true
    try {
      const z = await zip(shotList.map((f) => ({ name: f.fileName, data: f.blob })))
      await dl(z, `photos-${K.stamp()}.zip`)
    } catch (e) { toast(e.message || 'Could not make the zip.', 'error') } finally { btn.disabled = false }
  }

  // ---- recording ----
  async function beginRecord() {
    if (state !== 'on' || !stream) return
    const secs = +prefs.timer
    if (secs > 0) {
      counter = K.countdown(stage, secs)
      setState('countdown')
      const ok = await counter.promise
      counter = null
      if (!ok || disposed || !stream) { if (stream && state === 'countdown') setState('on'); return }
    }
    const vt = stream.getVideoTracks()[0]
    const st = vt.getSettings()
    const width = st.width || video.videoWidth || 1280, height = st.height || video.videoHeight || 720, fps = Math.round(st.frameRate || 30)
    const fmt = formats.find((f) => f.id === prefs.fmt) || formats[0]
    let outTracks = [vt]
    if (prefs.mirror && prefs.saveMirror) {
      comp = K.composeVideo({ base: vt, flip: true, maxEdge: Math.max(width, height), fps })
      outTracks = [comp.stream.getVideoTracks()[0]]
    }
    const recStream = new MediaStream([...outTracks, ...stream.getAudioTracks()])
    try {
      rec = new K.Rec(recStream, {
        mime: fmt.mime, videoBps: K.bitrateFor(width, height, fps, 'high'),
        onBytes: (b) => { if (hud?.size) hud.size.textContent = formatBytes(b) },
        onLimit: () => { toast('Reached the 1.8 GB limit, so the recording was saved.', 'info', 8000); stopRecord() },
        onError: (e) => { toast(`Recording stopped: ${e?.message || 'the recorder reported an error'}`, 'error'); stopRecord() },
      })
      rec.start()
    } catch (e) {
      console.error(e)
      comp?.stop(); comp = null
      toast(`Your browser could not start recording as ${fmt.label}. Try another format.`, 'error')
      return setState('on')
    }
    rec.info = { width, height, fps, fmt, mic: stream.getAudioTracks().length > 0, mirrored: !!comp }
    sw.start()
    setState('rec')
    const timer = h('span', '00:00')
    const label = h('b', 'REC')
    hud.size = h('span', '0 B')
    hud.el.replaceChildren(h('span', { class: 'mc-chip mono' }, h('span', { class: 'mc-dot' }), label, timer), h('span', { class: 'mc-chip' }, icon('hard-drive'), hud.size), h('span', { class: 'grow' }), ...(hud.meterChip ? [hud.meterChip] : []), hud.info)
    const pause = K.dockButton({ icon: 'pause', label: 'Pause recording', onClick: () => {
      const pausing = state === 'rec'
      if (pausing) { rec.pause(); sw.pause(); setState('paused') } else { rec.resume(); sw.resume(); setState('rec') }
      label.textContent = pausing ? 'PAUSED' : 'REC'
      pause.replaceChildren(icon(pausing ? 'play' : 'pause'))
      pause.setAttribute('aria-label', pausing ? 'Resume recording' : 'Pause recording')
      pause.title = pause.getAttribute('aria-label')
    } })
    const photo = K.dockButton({ icon: 'camera', label: 'Take a photo', onClick: () => snap() })
    const stopBtn = K.dockButton({ label: 'Stop and save', variant: 'stop', onClick: () => stopRecord() })
    dock.replaceChildren(photo, pause, stopBtn)
    stopBtn.focus({ preventScroll: true })
    timers.push(setInterval(() => { timer.textContent = K.clock(sw.seconds) }, 200))
  }

  async function stopRecord() {
    if (!rec || (state !== 'rec' && state !== 'paused')) return
    setState('saving')
    const seconds = sw.stop()
    const r = rec
    rec = null
    let blob
    try { blob = await r.stop() } catch (e) { console.error(e); blob = new Blob(r.chunks, { type: r.type }) }
    comp?.stop(); comp = null
    if (!disposed && stream) { setState('on'); buildDock(); stage.replaceChildren(K.aurora(), video, flashEl, hud.el, dock); hud.el.replaceChildren(hud.info, h('span', { class: 'grow' }), ...(hud.meterChip ? [hud.meterChip] : [])) }
    if (!blob.size) return toast('Nothing was recorded.', 'error')
    const done = await K.fixWebmDuration(blob, seconds)
    if (disposed) return
    const url = URL.createObjectURL(done)
    const media = h('video', { class: 'mc-take-media', controls: true, preload: 'metadata', playsInline: true, src: `${url}#t=0.1`, 'aria-label': 'Recording preview' })
    const info = r.info
    takes.add(K.takeCard({
      media, blob: done, name: `webcam-${K.stamp()}`, ext: info.fmt.ext, dispose: () => URL.revokeObjectURL(url),
      chips: [['clock', K.clock(seconds)], K.sizeChip(done.size), ['webcam', `${info.width}x${info.height}`], ['file-video', info.fmt.ext.toUpperCase()], info.mic ? ['mic', 'With sound'] : ['mic-off', 'No sound'], info.mirrored ? ['flip-horizontal', 'Mirrored'] : null],
      actions: info.fmt.ext === 'webm' ? [h('a', { class: 'btn btn-secondary btn-sm', href: '#/video-to-mp4', target: '_blank', rel: 'noopener', title: 'Opens Video to MP4 in a new tab. Download this recording first, then drop it there.' }, icon('repeat-2'), h('span', 'Convert to MP4'))] : [],
    }))
    toast(`Saved: ${K.clock(seconds)}, ${formatBytes(done.size)}`, 'success')
  }

  const cleanup = () => {
    disposed = true
    try { if (rec && rec.state !== 'inactive') rec.rec.stop() } catch { /* already stopped */ }
    stopAll()
  }
  signal?.addEventListener('abort', cleanup, { once: true })

  root.append(h('div', { class: 'mc stack' },
    canCamera ? null : alert('warn', h('strong', 'No camera access here. '), 'This browser cannot reach a camera from this page. Try Chrome, Edge, Firefox or Safari over HTTPS.'),
    canCamera && !photoMode && !canRecord ? alert('info', 'Your browser cannot record video, but you can still take photos.') : null,
    stage,
    options,
    shotsEl,
    photoMode ? null : takes.el,
    h('p', { class: 'small muted' }, icon('shield-check'), ' Your camera stays on this device. Nothing is uploaded, and the camera light goes off as soon as you turn it off or leave the page.')))
  return cleanup
}
