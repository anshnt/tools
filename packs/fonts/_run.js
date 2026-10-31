// Runs the wasm engines in a Web Worker so big fonts never freeze the tab; falls back to the main thread where workers are unavailable.
import * as engine from './_engine.js'

let worker = null, idle = 0, nextId = 1
const pending = new Map()

function stop(reason) {
  clearTimeout(idle)
  worker?.terminate()
  worker = null
  for (const p of pending.values()) p.reject(reason)
  pending.clear()
}

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./_worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id)
    if (!p) return
    pending.delete(data.id)
    data.ok ? p.resolve(data.out) : p.reject(new Error(data.error))
  }
  worker.onerror = (e) => stop(new Error(e.message || 'The font engine stopped unexpectedly.'))
  return worker
}

/** call('woff2Compress', [bytes]) / call('subset', [bytes, opts]) -> Uint8Array. Pass {signal} to cancel. */
export async function call(op, args, { signal } = {}) {
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
  const copy = args[0].slice() // the original stays usable; the copy is transferred to the worker
  const rest = args.slice(1)
  if (typeof Worker === 'undefined') return engine[{ woff2Compress: 'woff2Compress', woff2Decompress: 'woff2Decompress', subset: 'hbSubset' }[op]](copy, ...rest)
  const w = getWorker()
  clearTimeout(idle)
  const id = nextId++
  const result = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const onAbort = () => stop(Object.assign(new Error('Cancelled'), { code: 'ABORT' }))
    signal?.addEventListener('abort', onAbort, { once: true })
    w.postMessage({ id, op, args: [copy, ...rest] }, [copy.buffer])
  })
  try {
    return await result
  } finally {
    if (!pending.size) idle = setTimeout(() => stop(new Error('idle')), 30000)
  }
}
