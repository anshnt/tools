// Exporters: WebM (MediaRecorder), MP4 (WebCodecs + mp4-muxer), GIF (gifenc), PNG sequence (ZIP) and single frames. All run locally.
import { zip } from '../../lib/files.js'
import { yieldToMain } from '../../lib/ui.js'
import { renderFrame } from './_render.js'

const MP4_MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs'
const GIFENC = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm'
const loaders = {}
const lib = (key, url, what) => (loaders[key] ||= import(url).catch((e) => { delete loaders[key]; throw Object.assign(new Error(`Could not load the ${what}. Check your connection and try again.`), { cause: e }) }))

export const CAN = {
  webm: typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream,
  mp4: typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined',
}
export const MAX_PIXELS_EXPORT = 8_912_896 // 4K UHD
const cancelled = () => Object.assign(new Error('Export cancelled'), { code: 'ABORT' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export const frameCount = (doc, fps) => Math.max(1, Math.round(doc.comp.duration * fps))
/** Output size for a scale factor; even = true rounds down to even numbers (needed for H.264). */
export function outSize(doc, scale, even = false) {
  let w = Math.max(2, Math.round(doc.comp.width * scale)), h = Math.max(2, Math.round(doc.comp.height * scale))
  if (even) { w -= w % 2; h -= h % 2 }
  return { w, h }
}
function target(w, h, read = false) {
  if (w * h > MAX_PIXELS_EXPORT) throw new Error(`${w} x ${h} is too large to export in a browser. Lower the scale or the composition size.`)
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  return { cv, ctx: cv.getContext('2d', read ? { willReadFrequently: true } : {}) }
}
const check = (signal) => { if (signal?.aborted) throw cancelled() }
const defaultBitrate = (w, h, fps) => Math.round(clampN(w * h * fps * 0.12, 1_500_000, 40_000_000))
const clampN = (v, a, b) => Math.min(b, Math.max(a, v))

export async function exportFrame(doc, assets, t, scale = 1) {
  const { w, h } = outSize(doc, scale)
  const { cv, ctx } = target(w, h)
  renderFrame(ctx, doc, t, { assets })
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the PNG.'))), 'image/png'))
}

export async function exportWebM(doc, assets, { scale = 1, fps = doc.comp.fps, bitrate } = {}, { onProgress, signal } = {}) {
  if (!CAN.webm) throw new Error('This browser cannot record WebM from a canvas. Try Chrome, Edge or Firefox, or export a GIF or PNG sequence.')
  const { w, h } = outSize(doc, scale, true)
  const { cv, ctx } = target(w, h)
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
  if (!mime) throw new Error('This browser has no WebM encoder.')
  const probe = cv.captureStream(0), manual = typeof probe.getVideoTracks()[0]?.requestFrame === 'function'
  const stream = manual ? probe : cv.captureStream(fps), track = stream.getVideoTracks()[0]
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate || defaultBitrate(w, h, fps) })
  const chunks = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  const stopped = new Promise((res) => { rec.onstop = res })
  const N = frameCount(doc, fps)
  try {
    renderFrame(ctx, doc, 0, { assets, flatten: doc.comp.bg })
    rec.start(250)
    const t0 = performance.now()
    for (let i = 0; i < N; i++) {
      check(signal)
      renderFrame(ctx, doc, i / fps, { assets, flatten: doc.comp.bg })
      if (manual) track.requestFrame()
      onProgress?.(i / N, `Recording frame ${i + 1} of ${N}`)
      const wait = t0 + ((i + 1) * 1000) / fps - performance.now()
      await sleep(Math.max(0, wait))
    }
  } finally {
    if (rec.state !== 'inactive') rec.stop()
    await stopped
    for (const t of stream.getTracks()) t.stop()
  }
  check(signal)
  return new Blob(chunks, { type: 'video/webm' })
}

async function pickH264(w, h, fps, bitrate) {
  const level = w * h <= 921_600 ? '1f' : w * h <= 2_097_152 ? '28' : '33'
  for (const profile of ['6400', '4d00', '4200']) {
    const codec = `avc1.${profile}${level}`
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps })
      if (r.supported) return codec
    } catch { /* try the next profile */ }
  }
  return null
}

export async function exportMP4(doc, assets, { scale = 1, fps = doc.comp.fps, bitrate } = {}, { onProgress, signal } = {}) {
  if (!CAN.mp4) throw new Error('This browser cannot encode MP4 (it needs WebCodecs). Use Chrome or Edge, or export WebM or GIF instead.')
  const { w, h } = outSize(doc, scale, true)
  const br = bitrate || defaultBitrate(w, h, fps)
  const codec = await pickH264(w, h, fps, br)
  if (!codec) throw new Error('This browser has no H.264 encoder for that size. Try a lower scale, or export WebM instead.')
  const { Muxer, ArrayBufferTarget } = await lib('mp4', MP4_MUXER, 'MP4 muxer')
  const { cv, ctx } = target(w, h)
  const out = new ArrayBufferTarget()
  const muxer = new Muxer({ target: out, video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' })
  let failure = null
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e } })
  enc.configure({ codec, width: w, height: h, bitrate: br, framerate: fps })
  const N = frameCount(doc, fps)
  try {
    for (let i = 0; i < N; i++) {
      check(signal)
      if (failure) throw new Error(`The video encoder stopped: ${failure.message}`)
      renderFrame(ctx, doc, i / fps, { assets, flatten: doc.comp.bg })
      const frame = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) })
      enc.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 })
      frame.close()
      while (enc.encodeQueueSize > 8) await sleep(2)
      onProgress?.(i / N, `Encoding frame ${i + 1} of ${N}`)
      if (i % 4 === 3) await yieldToMain()
    }
    await enc.flush()
    if (failure) throw new Error(`The video encoder stopped: ${failure.message}`)
  } finally {
    if (enc.state !== 'closed') enc.close()
  }
  muxer.finalize()
  return new Blob([out.buffer], { type: 'video/mp4' })
}

export async function exportGIF(doc, assets, { scale = 1, fps = 15, colors = 256, loop = true } = {}, { onProgress, signal } = {}) {
  const { GIFEncoder, quantize, applyPalette } = await lib('gif', GIFENC, 'GIF encoder')
  const { w, h } = outSize(doc, scale)
  const { cv, ctx } = target(w, h, true)
  const alpha = !!doc.comp.transparent
  const fmt = alpha ? 'rgba4444' : 'rgb565', qopts = alpha ? { format: 'rgba4444', oneBitAlpha: true } : { format: 'rgb565' }
  const gif = GIFEncoder()
  const delay = Math.max(20, Math.round(100 / fps) * 10)
  const N = frameCount(doc, fps)
  for (let i = 0; i < N; i++) {
    check(signal)
    renderFrame(ctx, doc, i / fps, { assets })
    const data = ctx.getImageData(0, 0, w, h).data
    const palette = quantize(data, colors, qopts)
    const index = applyPalette(data, palette, fmt)
    const o = { palette, delay, repeat: loop ? 0 : -1 }
    if (alpha) { o.transparent = true; o.transparentIndex = Math.max(0, palette.findIndex((c) => c[3] === 0)); o.dispose = 2 }
    gif.writeFrame(index, w, h, o)
    onProgress?.(i / N, `Encoding frame ${i + 1} of ${N}`)
    if (i % 2) await yieldToMain()
  }
  gif.finish()
  return new Blob([gif.bytes()], { type: 'image/gif' })
}

export async function exportPNGSequence(doc, assets, { scale = 1, fps = doc.comp.fps, name = 'frame' } = {}, { onProgress, signal } = {}) {
  const { w, h } = outSize(doc, scale)
  const { cv, ctx } = target(w, h)
  const N = frameCount(doc, fps)
  const pad = Math.max(4, String(N).length)
  const entries = []
  for (let i = 0; i < N; i++) {
    check(signal)
    renderFrame(ctx, doc, i / fps, { assets })
    const blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode a PNG frame.'))), 'image/png'))
    entries.push({ name: `${name}_${String(i + 1).padStart(pad, '0')}.png`, data: blob })
    onProgress?.((i / N) * 0.9, `Rendering frame ${i + 1} of ${N}`)
    if (i % 3 === 2) await yieldToMain()
  }
  onProgress?.(0.92, 'Zipping frames')
  return zip(entries, (p) => onProgress?.(0.92 + p * 0.08, 'Zipping frames'))
}
