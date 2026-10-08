// Engine helpers on top of lib/ffmpeg.js: shared engine status (so every tool shows the one-time download),
// serialized probing, log-only analysis passes, fonts for libass, friendly errors and media duration checks.
import { loadFFmpeg, runFFmpeg, probe, terminateFFmpeg } from '../../lib/ffmpeg.js'
import { parseInfo } from './_media.js'
import { ext } from '../../lib/files.js'

// ---------- Engine status (shared by every tool on the page) ----------

export const engine = { state: 'idle', frac: null, label: '' }
const listeners = new Set()
const emit = () => { for (const fn of [...listeners]) fn(engine) }
let warming = null

/** Subscribe to engine status changes. Calls fn immediately. Returns an unsubscribe function. */
export function onEngine(fn) {
  listeners.add(fn)
  fn(engine)
  return () => listeners.delete(fn)
}

/** Start (or join) the one-time engine download. Resolves when the engine is ready. */
export function warm() {
  if (engine.state === 'ready') return Promise.resolve()
  if (warming) return warming
  engine.state = 'loading'
  engine.frac = null
  emit()
  warming = loadFFmpeg({ onProgress: (f, label) => { engine.frac = f; engine.label = label; emit() } })
    .then(() => { engine.state = 'ready'; engine.frac = 1; emit() })
    .catch((e) => { engine.state = 'error'; emit(); throw e })
    .finally(() => { warming = null })
  return warming
}

/** Stop whatever is running and drop the engine (the browser keeps the download cached). */
export function resetEngine() {
  terminateFFmpeg()
  warming = null
  engine.state = 'idle'
  engine.frac = null
  emit()
}

/** True when the browser asked us to save data or is on a slow link: do not prefetch the engine. */
export const saveData = () => !!(navigator.connection?.saveData || /2g|3g/.test(navigator.connection?.effectiveType || ''))

// ---------- Probing ----------

let chain = Promise.resolve()
/** Read duration, streams and codecs. Calls are serialized because probing shares one engine. */
export function inspect(file) {
  const run = chain.then(async () => {
    await warm()
    const e = (ext(file.name) || 'bin').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
    const p = await probe(file, `probe.${e}`)
    return Object.assign(parseInfo(p.log), { log: p.log })
  })
  chain = run.catch(() => {})
  return run
}

// ---------- Running ----------

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null)
const abortError = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })

/**
 * Run ffmpeg only to read its log (loudnorm, volumedetect ...). Nothing is written. Resolves with the log text.
 * Writes inputs once, runs `args` (use `-f null -` as the output) and removes the inputs again.
 */
export async function analyze({ inputs, args, signal, onProgress }) {
  if (signal?.aborted) throw abortError()
  await warm()
  const ff = await loadFFmpeg()
  const logs = []
  const onL = ({ message }) => logs.push(message)
  const onP = ({ progress }) => onProgress?.(clamp01(progress))
  let aborted = false
  const onAbort = () => { aborted = true; resetEngine() }
  signal?.addEventListener('abort', onAbort, { once: true })
  ff.on('log', onL)
  ff.on('progress', onP)
  try {
    for (const i of inputs) await ff.writeFile(i.name, new Uint8Array(await i.data.arrayBuffer()))
    const code = await ff.exec(args)
    if (code !== 0) throw new Error('Could not analyze this file.')
    return logs.join('\n')
  } catch (e) {
    if (aborted) throw abortError()
    throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!aborted) {
      ff.off('log', onL)
      ff.off('progress', onP)
      for (const i of inputs) await ff.deleteFile(i.name).catch(() => {})
    }
  }
}

/** Put font files into /fonts of the ffmpeg file system (for the libass subtitles filter). fonts: [{name, data: Uint8Array}] */
export async function putFonts(fonts) {
  await warm()
  const ff = await loadFFmpeg()
  await ff.createDir('/fonts').catch(() => {})
  for (const f of fonts) await ff.writeFile(`/fonts/${f.name}`, f.data.slice())
}

/** Run one ffmpeg job. Thin wrapper so tools share the abort and progress plumbing. */
export const run = (spec) => runFFmpeg(spec)

/** Map low-level failures to plain-language messages. */
export function friendlyError(err) {
  const msg = String(err?.message || err || '')
  if (/memory|allocation|out of bounds|Aborted|RangeError|too large/i.test(msg)) {
    return /too large for in-browser/i.test(msg) ? msg : 'The browser ran out of memory on this file. Try a shorter or smaller file, or close other tabs and try again.'
  }
  if (/Invalid data found|moov atom not found|could not find codec|Invalid argument/i.test(msg)) {
    return 'This file could not be read. It may be damaged, cut off, or in a format the engine does not support.'
  }
  if (/Could not load the video engine/i.test(msg)) return msg
  if (/Failed to fetch|NetworkError|Download failed/i.test(msg)) return 'A download failed. Check your connection and try again.'
  return msg || 'Something went wrong.'
}

/** Whether an error means the wasm instance may be unusable (so the next run should start a fresh engine). */
export const needsReset = (err) => /memory|Aborted|out of bounds|RangeError|unreachable/i.test(String(err?.message || err))

// ---------- Output inspection ----------

/** Duration (seconds) of a produced file, read by the browser. Resolves null when the browser cannot play it. */
export function mediaDuration(blob, kind = 'video', timeout = 5000) {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video')
    const url = URL.createObjectURL(blob)
    const done = (v) => { clearTimeout(t); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); resolve(v) }
    const t = setTimeout(() => done(null), timeout)
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => done(null)
    el.src = url
  })
}

/** Fetch bytes of a URL once and keep them for the session (fonts). */
const fetched = new Map()
export function fetchBytes(url, signal) {
  if (!fetched.has(url)) {
    fetched.set(url, fetch(url, { signal }).then(async (r) => {
      if (!r.ok) throw new Error(`Download failed (${r.status})`)
      return new Uint8Array(await r.arrayBuffer())
    }).catch((e) => { fetched.delete(url); throw e }))
  }
  return fetched.get(url)
}
