// Export: MP4 with WebCodecs + mp4-muxer (fast, frame exact), WebM via MediaRecorder (real time), and MP4 through
// lib/ffmpeg.js for browsers without H.264 encoding. All local; nothing is uploaded.
import { h, busy, alert, progress, modal, downloadButton, button, field, select, toast, formatBytes, formatDuration, clear } from '../../lib/ui.js'
import { safeName } from '../../lib/files.js'
import { projectDuration, layersAt } from './_model.js'
import { FrameRenderer, Player, ensureFonts } from './_player.js'
import { renderMix, audioClips } from './_audio.js'

const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs'
const abortError = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
const unsupported = (msg) => Object.assign(new Error(msg), { code: 'UNSUPPORTED' })
// MessageChannel yields are not throttled in background tabs (timers are), so long exports keep their speed.
const tick = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0) })

export const canWebCodecs = () => typeof VideoEncoder === 'function' && typeof VideoFrame === 'function'
const even = (n) => Math.max(2, Math.round(n / 2) * 2)
const BPP = { draft: 0.05, standard: 0.09, high: 0.16 }

export function outSize(project, short) {
  const r = project.width / project.height
  return r >= 1 ? [even(short * r), even(short)] : [even(short), even(short / r)]
}
export const bitrateFor = (W, H, fps, quality) => Math.max(600_000, Math.round(W * H * fps * (BPP[quality] || BPP.standard)))

async function pickVideoCodec(W, H, fps, bitrate) {
  const big = W * H * fps > 1920 * 1088 * 30
  const tries = [['avc', big ? 'avc1.640034' : 'avc1.640028'], ['avc', 'avc1.4d0034'], ['avc', 'avc1.42003e'], ['vp9', 'vp09.00.51.08'], ['av1', 'av01.0.08M.08']]
  for (const [mux, codec] of tries) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: fps })
      if (r.supported) return { mux, codec }
    } catch { /* try the next codec */ }
  }
  return null
}

async function pickAudioCodec() {
  if (typeof AudioEncoder !== 'function' || typeof AudioData !== 'function') return null
  for (const [mux, codec] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
    try {
      const r = await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })
      if (r.supported) return { mux, codec }
    } catch { /* try the next codec */ }
  }
  return null
}

async function audioBuffers(project, media) {
  const ids = [...new Set(project.clips.filter((c) => c.kind === 'audio' || c.kind === 'video').map((c) => c.mediaId))]
  const map = new Map()
  await Promise.all(ids.map(async (id) => { const b = await media.ensureAudio(id); if (b) map.set(id, b) }))
  return map
}

/** Frame-exact MP4: render each frame, encode with WebCodecs, mix audio offline, mux in memory. */
export async function renderMp4({ doc, media, W, H, fps, quality, signal, onProgress }) {
  if (!canWebCodecs()) throw unsupported('This browser cannot encode video directly.')
  const p = structuredClone(doc.p)
  const dur = projectDuration(p)
  const bitrate = bitrateFor(W, H, fps, quality)
  const vcfg = await pickVideoCodec(W, H, fps, bitrate)
  if (!vcfg) throw unsupported('No video encoder is available in this browser.')
  onProgress(0, 'Preparing audio')
  await ensureFonts(p)
  const buffers = await audioBuffers(p, media)
  const hasAudio = audioClips(p, buffers).length > 0
  const acfg = hasAudio ? await pickAudioCodec() : null
  if (hasAudio && !acfg) throw unsupported('No audio encoder is available in this browser.')

  const { Muxer, ArrayBufferTarget } = await import(MUXER)
  const target = new ArrayBufferTarget()
  const muxer = new Muxer({
    target, fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: vcfg.mux, width: W, height: H, frameRate: fps },
    ...(hasAudio ? { audio: { codec: acfg.mux, numberOfChannels: 2, sampleRate: 48000 } } : {}),
  })
  let encError = null
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encError = e } })
  venc.configure({ codec: vcfg.codec, width: W, height: H, bitrate, framerate: fps })
  let aenc = null
  let mix = null
  let nextSeg = null
  if (hasAudio) {
    aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { encError = e } })
    aenc.configure({ codec: acfg.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })
    mix = renderMix(p, buffers, { seg: 2, signal })
    nextSeg = await mix.next()
  }
  const feedAudio = async (upTo) => {
    while (nextSeg && !nextSeg.done && nextSeg.value.start <= upTo) {
      const { start, buffer } = nextSeg.value
      const L = buffer.getChannelData(0), R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L
      for (let o = 0; o < buffer.length; o += 48000) {
        const len = Math.min(48000, buffer.length - o)
        const data = new Float32Array(len * 2)
        data.set(L.subarray(o, o + len), 0)
        data.set(R.subarray(o, o + len), len)
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round(((start * 48000 + o) / 48000) * 1e6), data })
        aenc.encode(ad)
        ad.close()
      }
      nextSeg = await mix.next()
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  const fr = new FrameRenderer(media, { max: 10, fast: true })
  const N = Math.max(1, Math.round(dur * fps))
  try {
    for (let i = 0; i < N; i++) {
      if (signal?.aborted) throw abortError()
      const t = Math.min(i / fps, dur - 1e-4)
      if (aenc) await feedAudio(t)
      const layers = layersAt(p, t)
      fr.begin(layers)
      await fr.seekAll(layers, fps)
      fr.draw(g, W, H, p, layers)
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) })
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 })
      frame.close()
      if (encError) throw encError
      while (venc.encodeQueueSize > 6) {
        await new Promise((r) => { venc.addEventListener('dequeue', r, { once: true }); setTimeout(r, 1500) })
        if (encError) throw encError
      }
      if (i % 4 === 0) { onProgress(i / N, `Rendering frame ${i + 1} of ${N}`); await tick() }
    }
    if (aenc) await feedAudio(Infinity)
    onProgress(0.98, 'Finishing')
    await venc.flush()
    if (aenc) await aenc.flush()
    if (encError) throw encError
    muxer.finalize()
    return new Blob([target.buffer], { type: 'video/mp4' })
  } finally {
    fr.dispose()
    try { venc.close() } catch { /* already closed */ }
    try { aenc?.close() } catch { /* already closed */ }
    mix?.return?.()
  }
}

/** Real-time capture of the preview (video + mixed audio) with MediaRecorder. Keep the tab in front while it runs. */
export async function recordWebM({ doc, media, W, H, fps, quality, signal, onProgress }) {
  if (typeof MediaRecorder !== 'function') throw new Error('This browser cannot record video.')
  const dur = projectDuration(doc.p)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const player = new Player({ doc, media, canvas, monitor: false })
  let stream = null
  try {
    await ensureFonts(doc.p)
    await player.ensureContext()
    const dest = player.ac.createMediaStreamDestination()
    player.master.connect(dest)
    stream = canvas.captureStream(fps)
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bitrateFor(W, H, fps, quality), audioBitsPerSecond: 192000 })
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const stopped = new Promise((res) => { rec.onstop = res })
    const ended = new Promise((res) => { player.onEnd = res })
    const cancelled = new Promise((res) => signal?.addEventListener('abort', res, { once: true }))
    player.onTime = (t) => onProgress(t / dur, `Recording ${formatDuration(t)} of ${formatDuration(dur)}`)
    player.seek(0)
    player.onStarted = () => rec.start(500) // begin recording when the clock actually starts, so sound and picture line up
    await player.play()
    await Promise.race([ended, cancelled])
    player.pause()
    await new Promise((r) => setTimeout(r, 250))
    if (rec.state !== 'inactive') rec.stop()
    else stopped.then(() => {})
    await Promise.race([stopped, new Promise((r) => setTimeout(r, 1500))])
    if (signal?.aborted) throw abortError()
    return new Blob(chunks, { type: 'video/webm' })
  } finally {
    stream?.getTracks().forEach((t) => t.stop())
    player.destroy()
    canvas.width = canvas.height = 1
  }
}

/** Convert a WebM recording to a widely compatible MP4 with the in-browser engine. */
export async function webmToMp4(blob, { fps, onProgress, signal }) {
  const { runFFmpeg } = await import('../../lib/ffmpeg.js')
  return runFFmpeg({
    inputs: [{ name: 'in.webm', data: blob }],
    args: ['-i', 'in.webm', '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'out.mp4'],
    output: 'out.mp4', onProgress: (f, label) => onProgress(f == null ? null : f, label), signal,
  })
}

export function openExport({ doc, media, player, signal }) {
  const p = doc.p
  const dur = projectDuration(p)
  if (dur <= 0) return toast('Add something to the timeline first.', 'error')
  player.pause()
  const wc = canWebCodecs()
  const short = Math.min(p.width, p.height)
  const sizes = [...new Set([short, 720, 480].filter((s) => s <= short))]
  let ctrl = null
  let url = null
  let running = false

  const fmt = select([...(wc ? [['mp4', 'MP4 (H.264 and AAC), fastest']] : []), ['webm', 'WebM, recorded in real time'], ['mp4-convert', 'MP4 converted from a recording']], wc ? 'mp4' : 'webm')
  const size = select(sizes.map((s) => { const [w, hh] = outSize(p, s); return [s, `${w} x ${hh}${s === short ? ' (project size)' : ''}`] }), short)
  const fpsSel = select([[24, '24 fps'], [25, '25 fps'], [30, '30 fps'], [60, '60 fps']], p.fps)
  const quality = select([['draft', 'Draft (small)'], ['standard', 'Standard'], ['high', 'High']], 'standard')
  const estimate = h('small', { class: 'field-hint' })
  const note = h('p', { class: 'small muted' })
  const prog = progress()
  const result = h('div', { class: 'stack' })
  const update = () => {
    const [W, H] = outSize(p, +size.value)
    const bytes = ((bitrateFor(W, H, +fpsSel.value, quality.value) + 192000) * dur) / 8
    estimate.textContent = `About ${formatBytes(bytes)} for ${formatDuration(dur)}.`
    note.textContent = fmt.value === 'mp4' ? 'Renders every frame, so the result is exact. Speed depends on the clips: long videos with sparse keyframes take longer.'
      : fmt.value === 'webm' ? 'Plays the timeline once in real time and records it. Keep this tab in front until it finishes.'
        : 'Records in real time, then converts with the built-in video engine (about 31 MB, downloaded once).'
  }
  for (const s of [fmt, size, fpsSel, quality]) s.addEventListener('change', update)
  update()

  const exportBtn = button('Export', { icon: 'download', variant: 'primary' })
  const closeBtn = button('Close', { variant: 'secondary' })
  const dlg = modal({
    title: 'Export video', icon: 'download',
    body: h('div', { class: 'stack vs-exp' },
      h('div', { class: 'grid-2' }, field('Format', fmt), field('Size', size), field('Frame rate', fpsSel), field('Quality', quality)),
      estimate, note, prog.el, result),
    actions: [closeBtn, exportBtn],
    onClose: () => { ctrl?.abort(); if (url) URL.revokeObjectURL(url) },
  })
  closeBtn.addEventListener('click', () => (running ? ctrl?.abort() : dlg.close()))
  signal?.addEventListener('abort', () => dlg.el.isConnected && dlg.close(), { once: true })

  exportBtn.addEventListener('click', () => busy(exportBtn, async () => {
    ctrl = new AbortController()
    const sig = ctrl.signal
    running = true
    closeBtn.querySelector('span').textContent = 'Cancel'
    clear(result)
    if (url) { URL.revokeObjectURL(url); url = null }
    const [W, H] = outSize(p, +size.value)
    const fps = +fpsSel.value
    const t0 = performance.now()
    const onP = (f, label) => {
      const eta = f > 0.03 ? ` (about ${formatDuration((((performance.now() - t0) / 1000) / f) * (1 - f))} left)` : ''
      prog.set(f, `${label}${eta}`)
    }
    const args = { doc, media, W, H, fps, quality: quality.value, signal: sig, onProgress: onP }
    let kind = fmt.value
    let blob
    try {
      if (kind === 'mp4') {
        try { blob = await renderMp4(args) } catch (e) {
          if (e.code !== 'UNSUPPORTED') throw e
          result.append(alert('warn', `${e.message} Recording in real time instead.`))
          kind = 'mp4-convert'
        }
      }
      if (!blob) {
        prog.set(0, 'Recording')
        const rec = await recordWebM(args)
        blob = kind === 'webm' ? rec : await webmToMp4(rec, { fps, onProgress: onP, signal: sig })
      }
    } finally {
      running = false
      closeBtn.querySelector('span').textContent = 'Close'
    }
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
    const name = `${safeName(p.name)}.${ext}`
    url = URL.createObjectURL(blob)
    prog.hide()
    result.append(
      alert('success', h('strong', 'Done. '), `${W} x ${H}, ${formatDuration(dur)}, ${formatBytes(blob.size)} in ${formatDuration((performance.now() - t0) / 1000)}.`),
      h('div', { class: 'row' }, downloadButton(blob, name, `Download ${ext.toUpperCase()}`, { size: 'lg' })),
      h('video', { src: url, controls: true, playsinline: true }))
  }, { label: 'Exporting', errorTo: result, progress: prog }))
  return dlg
}

