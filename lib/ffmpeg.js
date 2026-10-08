// ffmpeg.wasm for video/audio tools. Uses the single-thread core, so it works on GitHub Pages without
// COOP/COEP headers (no SharedArrayBuffer needed). The small MIT wrapper is vendored in lib/vendor/ffmpeg
// (same-origin module worker); the ~31 MB core downloads from jsDelivr once and the browser caches it.
//
//   import { runFFmpeg } from '../../lib/ffmpeg.js'
//   const mp3 = await runFFmpeg({ inputs: [{ name: 'in.mp4', data: file }], args: ['-i', 'in.mp4', '-vn', '-b:a', '192k', 'out.mp3'],
//                                 output: 'out.mp3', onProgress: (f, label) => prog.set(f, label), signal })
//
// Limits: single-threaded (x264 encodes run ~0.3-1x realtime on a laptop), and inputs + outputs must fit in
// wasm memory, so keep files under ~500 MB (warn above ~200 MB). Prefer -c copy (stream copy) when no re-encode is needed.
import { FFmpeg } from './vendor/ffmpeg/index.js'

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
export const MAX_INPUT_BYTES = 500 * 1024 * 1024

let loading = null
let queue = Promise.resolve()

async function blobURL(url, type, onProgress) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const total = +res.headers.get('content-length') || 0
  if (!res.body || !total || !onProgress) return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }))
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onProgress(got / total)
  }
  return URL.createObjectURL(new Blob(chunks, { type }))
}

/** Load (once) and return the FFmpeg instance. onProgress(fraction, label) reports the core download. */
export function loadFFmpeg({ onProgress } = {}) {
  loading ??= (async () => {
    const ff = new FFmpeg()
    onProgress?.(null, 'Loading video engine')
    const coreURL = await blobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript')
    const wasmURL = await blobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm', (p) => onProgress?.(p, 'Downloading video engine (about 31 MB, once)'))
    await ff.load({ coreURL, wasmURL })
    return ff
  })().catch((e) => {
    loading = null
    throw Object.assign(new Error('Could not load the video engine. Check your connection and try again.'), { cause: e })
  })
  return loading
}

/** Stop any running job and free the engine's memory. */
export function terminateFFmpeg() {
  const p = loading
  loading = null
  p?.then((ff) => ff.terminate()).catch(() => {})
}

const typeFor = (name) => ({
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', gif: 'image/gif',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  png: 'image/png', jpg: 'image/jpeg', srt: 'application/x-subrip', vtt: 'text/vtt',
})[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream'

/**
 * runFFmpeg({inputs: [{name, data: File|Blob|Uint8Array}], args: [...], output: 'out.mp4' | ['a.png', ...], onProgress, onLog, signal})
 * -> Blob (or Blob[] when output is an array). Jobs run one at a time. Throws with the tail of ffmpeg's log on failure;
 * aborting the signal terminates the engine (err.code = 'ABORT').
 */
export function runFFmpeg(job) {
  const run = queue.then(() => exec(job))
  queue = run.catch(() => {})
  return run
}

async function exec({ inputs = [], args, output, onProgress, onLog, signal }) {
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
  for (const i of inputs) {
    if ((i.data?.size || i.data?.length || 0) > MAX_INPUT_BYTES) throw new Error(`${i.name} is too large for in-browser processing (max ${MAX_INPUT_BYTES / 1024 / 1024} MB).`)
  }
  const ff = await loadFFmpeg({ onProgress })
  const logs = []
  const onP = ({ progress }) => onProgress?.(Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : null, 'Processing')
  const onL = ({ message }) => { logs.push(message); if (logs.length > 200) logs.shift(); onLog?.(message) }
  let aborted = false
  const onAbort = () => { aborted = true; terminateFFmpeg() }
  signal?.addEventListener('abort', onAbort, { once: true })
  ff.on('progress', onP)
  ff.on('log', onL)
  const outs = [output].flat()
  try {
    for (const i of inputs) await ff.writeFile(i.name, i.data instanceof Uint8Array ? i.data : new Uint8Array(await i.data.arrayBuffer()))
    onProgress?.(0, 'Processing')
    const code = await ff.exec(args)
    if (code !== 0) {
      const tail = logs.filter((l) => /error|invalid|unknown|not|could|failed/i.test(l)).slice(-3).join(' ') || logs.slice(-3).join(' ')
      throw new Error(`Processing failed: ${tail || `ffmpeg exited with code ${code}`}`)
    }
    const blobs = []
    for (const name of outs) {
      const data = await ff.readFile(name)
      blobs.push(new Blob([data], { type: typeFor(name) }))
    }
    return Array.isArray(output) ? blobs : blobs[0]
  } catch (e) {
    if (aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!aborted) {
      ff.off('progress', onP)
      ff.off('log', onL)
      for (const n of [...inputs.map((i) => i.name), ...outs]) await ff.deleteFile(n).catch(() => {})
    }
  }
}

/** Probe duration (seconds) and stream info by parsing ffmpeg's log for a file. */
export async function probe(file, name = 'probe.' + (file.name?.split('.').pop() || 'bin')) {
  const ff = await loadFFmpeg()
  const logs = []
  const onL = ({ message }) => logs.push(message)
  ff.on('log', onL)
  try {
    await ff.writeFile(name, new Uint8Array(await file.arrayBuffer()))
    await ff.exec(['-hide_banner', '-i', name])
  } finally {
    ff.off('log', onL)
    await ff.deleteFile(name).catch(() => {})
  }
  const text = logs.join('\n')
  const d = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null,
    video: /Stream #.*Video:/.test(text),
    audio: /Stream #.*Audio:/.test(text),
    size: text.match(/Video:.*?(\d{2,5})x(\d{2,5})/)?.slice(1).map(Number) || null,
    fps: +(text.match(/([\d.]+) fps/)?.[1] || 0) || null,
    log: text,
  }
}
