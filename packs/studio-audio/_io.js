// Getting audio in: decoding files (and the audio of videos), microphone capture, and the asset record the project refers to.
import { SR, buildPeaks, encodeWav } from './_dsp.js'
import { uid } from './_model.js'
import { ext, baseName } from '../../lib/files.js'
import { fileType } from '../../lib/ui.js'

export const ACCEPT = 'audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.wma,.aiff,.aif,.amr,.mp4,.m4v,.mov,.mkv,.webm,.avi,.3gp,.flv,.wmv'
export const MAX_BYTES = 400 * 1024 * 1024

/** Wrap a decoded AudioBuffer as the asset object the project and engine use. blob is what gets autosaved. */
export function makeAsset(name, buffer, blob, blobExt, id = uid('a')) {
  const chans = []
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c))
  return {
    id, name, buffer, chans, length: buffer.length, sampleRate: buffer.sampleRate, duration: buffer.duration, channels: buffer.numberOfChannels,
    peaks: buildPeaks(chans, buffer.length), blob, blobExt,
  }
}

const decodeBytes = (bytes) => new OfflineAudioContext(2, 1, SR).decodeAudioData(bytes)

/** Decode a File (audio, or the audio track of a video) into an asset. Falls back to ffmpeg.wasm for formats the browser cannot decode. */
export async function decodeFile(file, { onStatus, signal } = {}) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than ${MAX_BYTES / 1024 / 1024} MB. Trim it first or use a shorter file.`)
  const bytes = await file.arrayBuffer()
  let buf = null
  let viaWav = false
  try {
    buf = await decodeBytes(bytes.slice(0))
  } catch {
    onStatus?.('Reading this format with the built-in converter (downloads once, about 31 MB)', null)
    try {
      const { runFFmpeg } = await import('../../lib/ffmpeg.js')
      const e = ext(file.name) || 'bin'
      const wav = await runFFmpeg({
        inputs: [{ name: `in.${e}`, data: new Uint8Array(bytes) }],
        args: ['-i', `in.${e}`, '-vn', '-ac', '2', '-ar', String(SR), '-c:a', 'pcm_s16le', 'out.wav'],
        output: 'out.wav', signal, onProgress: (f, label) => onStatus?.(label, f),
      })
      buf = await decodeBytes(await wav.arrayBuffer())
      viaWav = true
    } catch (err) {
      if (err?.code === 'ABORT') throw err
      throw new Error(`Could not read audio from ${file.name}. It may not contain an audio track, or the format is not supported.`)
    }
  }
  if (!buf || !buf.length) throw new Error(`${file.name} has no audio.`)
  const isAudio = fileType(file).startsWith('audio/')
  const name = baseName(file.name) || 'Audio'
  if (!viaWav && isAudio) return makeAsset(name, buf, file, ext(file.name) || 'bin')
  // video or converted source: keep a compact WAV of just the audio so autosave does not store whole videos
  const chans = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  return makeAsset(name, buf, encodeWav(chans, buf.sampleRate, 16), 'wav')
}

/** Decode a stored Blob (autosave or project file) into an asset with a known id. */
export async function decodeStored({ id, name, blob }) {
  const buf = await decodeBytes(await blob.arrayBuffer())
  const e = ext(name) || (blob.type.includes('wav') ? 'wav' : 'bin')
  return makeAsset(name, buf, blob, blob.type === 'audio/wav' ? 'wav' : e, id)
}

// ---------- Microphone ----------
const WORKLET = `class Rec extends AudioWorkletProcessor {
  constructor() { super(); this.parts = []; this.n = 0; this.port.onmessage = (e) => { if (e.data === 'flush') { this.flush(); this.port.postMessage('done') } } }
  flush() { if (!this.n) return; const o = new Float32Array(this.n); let k = 0; for (const p of this.parts) { o.set(p, k); k += p.length } this.parts = []; this.n = 0; this.port.postMessage(o, [o.buffer]) }
  process(inputs) { const i = inputs[0]; if (i && i[0]) { this.parts.push(new Float32Array(i[0])); this.n += i[0].length; if (this.n >= 4096) this.flush() } return true }
}
registerProcessor('studio-rec', Rec)`
let workletUrl = null

const micError = (e) => new Error(
  e?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser address bar and try again.'
    : e?.name === 'NotFoundError' ? 'No microphone was found on this device.'
      : `Could not open the microphone: ${e?.message || e}`)

/**
 * Start capturing the microphone as raw PCM (AudioWorklet), falling back to MediaRecorder where worklets are missing.
 * onChunk(Float32Array) is called with fresh samples. stop() resolves with {samples: Float32Array, sampleRate}.
 */
export async function startCapture(ctx, onChunk) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Recording needs a secure page (HTTPS) and a browser with microphone support.')
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
  } catch (e) { throw micError(e) }
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop())
  try {
    if (!ctx.audioWorklet) throw new Error('no worklet')
    workletUrl ??= URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    if (!ctx._recReady) { await ctx.audioWorklet.addModule(workletUrl); ctx._recReady = true }
    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'studio-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' })
    const mute = ctx.createGain()
    mute.gain.value = 0
    const parts = []
    let done = null
    node.port.onmessage = (e) => {
      if (e.data instanceof Float32Array) { parts.push(e.data); onChunk?.(e.data) } else if (e.data === 'done') done?.()
    }
    src.connect(node)
    node.connect(mute)
    mute.connect(ctx.destination)
    return {
      async stop() {
        const flushed = new Promise((r) => { done = r; setTimeout(r, 600) })
        node.port.postMessage('flush')
        await flushed
        src.disconnect(); node.disconnect(); mute.disconnect(); stopTracks()
        let n = 0
        for (const p of parts) n += p.length
        const samples = new Float32Array(n)
        let k = 0
        for (const p of parts) { samples.set(p, k); k += p.length }
        return { samples, sampleRate: ctx.sampleRate }
      },
      cancel() { try { src.disconnect(); node.disconnect(); mute.disconnect() } catch { /* ignore */ } stopTracks() },
    }
  } catch {
    // Fallback: MediaRecorder (compressed), decoded when you stop.
    if (typeof MediaRecorder === 'undefined') { stopTracks(); throw new Error('This browser cannot record audio.') }
    const mr = new MediaRecorder(stream)
    const chunks = []
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    mr.start(250)
    return {
      async stop() {
        const ended = new Promise((r) => { mr.onstop = r })
        mr.stop()
        await ended
        stopTracks()
        const buf = await decodeBytes(await new Blob(chunks).arrayBuffer())
        return { samples: buf.getChannelData(0).slice(), sampleRate: buf.sampleRate }
      },
      cancel() { try { mr.stop() } catch { /* ignore */ } stopTracks() },
    }
  }
}

/** Turn captured samples into an asset (24-bit WAV blob for autosave). */
export function assetFromSamples(name, samples, sampleRate) {
  const buffer = new AudioBuffer({ numberOfChannels: 1, length: Math.max(1, samples.length), sampleRate })
  buffer.copyToChannel(samples.length ? samples : new Float32Array(1), 0)
  return makeAsset(name, buffer, encodeWav([buffer.getChannelData(0)], sampleRate, 24), 'wav')
}
