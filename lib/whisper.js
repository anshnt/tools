// On-device speech-to-text with Whisper (transformers.js). The model downloads once (~40-250 MB) and is cached.
import { transformers } from './libs.js'

export const WHISPER_MODELS = [
  ['onnx-community/whisper-tiny', 'Tiny - fastest (~40 MB)'],
  ['onnx-community/whisper-base', 'Base - balanced (~80 MB)'],
  ['onnx-community/whisper-small', 'Small - most accurate (~250 MB)'],
]
export const WHISPER_LANGS = [
  ['', 'Auto-detect'], ['english', 'English'], ['hindi', 'Hindi'], ['marathi', 'Marathi'], ['gujarati', 'Gujarati'], ['bengali', 'Bengali'],
  ['tamil', 'Tamil'], ['telugu', 'Telugu'], ['kannada', 'Kannada'], ['malayalam', 'Malayalam'], ['punjabi', 'Punjabi'], ['urdu', 'Urdu'],
  ['spanish', 'Spanish'], ['french', 'French'], ['german', 'German'], ['portuguese', 'Portuguese'], ['italian', 'Italian'], ['japanese', 'Japanese'],
  ['korean', 'Korean'], ['chinese', 'Chinese'], ['arabic', 'Arabic'], ['russian', 'Russian'],
]

/** Decode any audio/video file the browser can play into 16 kHz mono Float32Array. */
export async function decodeAudio(blob, sampleRate = 16000) {
  const buf = await blob.arrayBuffer()
  const AC = window.AudioContext || window.webkitAudioContext
  const ctx = new AC()
  let decoded
  try {
    decoded = await ctx.decodeAudioData(buf)
  } catch {
    throw new Error('Could not read audio from this file. Try MP3, WAV, M4A, MP4 or WebM.')
  } finally {
    ctx.close()
  }
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return { audio: rendered.getChannelData(0), duration: decoded.duration }
}

const pipes = new Map()
async function asr(model, onProgress) {
  if (!pipes.has(model)) {
    const { pipeline } = await transformers()
    const device = navigator.gpu ? 'webgpu' : 'wasm'
    pipes.set(model, pipeline('automatic-speech-recognition', model, {
      device,
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) onProgress?.(p.loaded / p.total, `Downloading model (${p.file})`)
      },
    }).catch((e) => { pipes.delete(model); throw e }))
  }
  return pipes.get(model)
}

/**
 * transcribe(fileOrBlob, {model, language, task: 'transcribe'|'translate', timestamps: true, onProgress(fraction, label)})
 * -> {text, chunks: [{timestamp: [start, end], text}], duration}
 */
export async function transcribe(blob, opts = {}) {
  const { model = WHISPER_MODELS[1][0], language = '', task = 'transcribe', timestamps = true, onProgress } = opts
  onProgress?.(null, 'Reading audio')
  const { audio, duration } = await decodeAudio(blob)
  const pipe = await asr(model, onProgress)
  onProgress?.(null, `Transcribing ${Math.round(duration)}s of audio`)
  const out = await pipe(audio, {
    chunk_length_s: 30, stride_length_s: 5, return_timestamps: timestamps, task,
    ...(language ? { language } : {}),
  })
  return { text: (out.text || '').trim(), chunks: out.chunks || [], duration }
}

const ts = (s, sep) => {
  const ms = Math.max(0, Math.round((s || 0) * 1000))
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`
}
/** Whisper chunks -> SRT text */
export const toSRT = (chunks) => chunks.map((c, i) => `${i + 1}\n${ts(c.timestamp[0], ',')} --> ${ts(c.timestamp[1] ?? c.timestamp[0] + 2, ',')}\n${c.text.trim()}\n`).join('\n')
/** Whisper chunks -> WebVTT text */
export const toVTT = (chunks) => 'WEBVTT\n\n' + chunks.map((c) => `${ts(c.timestamp[0], '.')} --> ${ts(c.timestamp[1] ?? c.timestamp[0] + 2, '.')}\n${c.text.trim()}\n`).join('\n')
