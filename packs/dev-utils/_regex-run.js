// Runs a regular expression against text off the main thread, so catastrophic backtracking can be stopped.
// execute() is pure (also used inline as a fallback and by tests); createRunner() wraps it in a Web Worker with a timeout.

/** Self-contained on purpose: its source text is shipped to the worker. */
export function execute(req) {
  const { pattern, flags = '', text, replace = null, limit = 2000 } = req
  const t0 = performance.now()
  const re = new RegExp(pattern, flags.includes('d') ? flags : flags + 'd')
  const matches = []
  let truncated = false
  const pack = (m) => ({
    index: m.index,
    text: m[0],
    groups: Array.from({ length: m.length - 1 }, (_, i) => m[i + 1] ?? null),
    spans: m.indices ? m.indices.slice(1).map((s) => s || null) : [],
    named: m.groups ? Object.fromEntries(Object.entries(m.groups).map(([k, v]) => [k, v ?? null])) : null,
    namedSpans: m.indices?.groups ? Object.fromEntries(Object.entries(m.indices.groups).map(([k, v]) => [k, v || null])) : null,
  })
  if (re.global || re.sticky) {
    let m
    while ((m = re.exec(text))) {
      matches.push(pack(m))
      if (m[0] === '') {
        const cp = text.codePointAt(re.lastIndex)
        re.lastIndex += (re.unicode || re.unicodeSets) && cp > 0xffff ? 2 : 1
      }
      if (matches.length >= limit) { truncated = true; break }
    }
  } else {
    const m = re.exec(text)
    if (m) matches.push(pack(m))
  }
  const replaced = replace == null ? null : text.replace(new RegExp(pattern, flags), replace)
  return { matches, truncated, replaced, ms: performance.now() - t0 }
}

const WORKER_SRC = `const execute = ${execute.toString()}
self.onmessage = (e) => {
  const { id, req } = e.data
  try { self.postMessage({ id, result: execute(req) }) } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }) }
}`

/**
 * createRunner(2000) -> { run(req) -> Promise<result>, dispose() }
 * Rejects with err.code = 'TIMEOUT' (worker stopped), 'SUPERSEDED' (a newer run replaced this one) or 'SYNTAX' (invalid pattern).
 */
export function createRunner(timeoutMs = 2000) {
  let worker = null
  let url = null
  let seq = 0
  let pending = null
  const kill = () => { worker?.terminate(); worker = null }
  const spawn = () => {
    if (worker) return worker
    try {
      url = url || URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
      worker = new Worker(url)
      worker.onmessage = (e) => {
        if (!pending || e.data.id !== pending.id) return
        const p = pending
        pending = null
        clearTimeout(p.timer)
        if (e.data.error) p.reject(Object.assign(new SyntaxError(e.data.error), { code: 'SYNTAX' }))
        else p.resolve(e.data.result)
      }
      worker.onerror = () => {}
    } catch { worker = null }
    return worker
  }
  return {
    run(req) {
      if (pending) {
        clearTimeout(pending.timer)
        pending.reject(Object.assign(new Error('superseded'), { code: 'SUPERSEDED' }))
        pending = null
        kill() // the old job may be stuck; start fresh
      }
      return new Promise((resolve, reject) => {
        const w = spawn()
        if (!w) {
          try { resolve(execute(req)) } catch (e) { reject(Object.assign(e, { code: 'SYNTAX' })) }
          return
        }
        const id = ++seq
        const timer = setTimeout(() => {
          if (pending?.id !== id) return
          pending = null
          kill()
          reject(Object.assign(new Error('Stopped: this pattern took too long on this text.'), { code: 'TIMEOUT' }))
        }, timeoutMs)
        pending = { id, resolve, reject, timer }
        w.postMessage({ id, req })
      })
    },
    dispose() {
      if (pending) { clearTimeout(pending.timer); pending = null }
      kill()
      if (url) { URL.revokeObjectURL(url); url = null }
    },
  }
}
