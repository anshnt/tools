// Runs conversions: a chain of steps per file, several files at once, converters marked exclusive (ffmpeg) one at a time,
// per-file progress, cancel and retry. No page UI in here, so the watch folder and the tests use it too.
import { ext as extOf, baseName, safeName } from '../../lib/files.js'
import { findRoute, optionsOf, routeExclusive } from './_registry.js'
import { outExt } from './_formats.js'

const abortErr = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })
export const isAbort = (e) => e?.code === 'ABORT' || e?.name === 'AbortError'
export const defaultConcurrency = () => Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))

// ---------- named locks (one ffmpeg at a time) ----------
const locks = new Map()
async function withLock(key, signal, fn) {
  const prev = locks.get(key) || Promise.resolve()
  let release
  const gate = new Promise((r) => { release = r })
  locks.set(key, prev.then(() => gate))
  await prev
  try {
    if (signal?.aborted) throw abortErr()
    return await fn()
  } finally { release() }
}

// ---------- options ----------
/** Option values for a chain: each option's default, then `values` on top, coerced to the option's type. */
export function resolveOptions(path, values = {}) {
  const out = {}
  for (const o of optionsOf(path)) {
    let v = o.key in values ? values[o.key] : o.default
    if (o.type === 'range' || o.type === 'number') v = v === '' || v == null ? o.default : Number(v)
    else if (o.type === 'toggle') v = !!v
    else if (o.type === 'select') { const hit = (o.choices || []).find(([c]) => String(c) === String(v)); v = hit ? hit[0] : o.default }
    out[o.key] = v
  }
  // keys the chain does not declare but the caller gave (shared presets) are passed through unchanged
  for (const [k, v] of Object.entries(values)) if (!(k in out)) out[k] = v
  return out
}

/** Run a chain on one file. Steps that return several files feed each of them to the next step. */
export async function convertFile(file, path, opts, { signal, onProgress } = {}) {
  let current = [file]
  for (let i = 0; i < path.length; i++) {
    const step = path[i]
    const next = []
    for (let j = 0; j < current.length; j++) {
      if (signal?.aborted) throw abortErr()
      const run = () => step.conv.run(current[j], step.to, opts, { signal, onProgress: (p) => onProgress?.((i + (j + (p || 0)) / current.length) / path.length) })
      const res = step.conv.exclusive ? await withLock(step.conv.exclusive, signal, run) : await run()
      for (const f of [].concat(res)) if (f) next.push(f)
    }
    if (!next.length) throw new Error('The conversion produced no file.')
    current = next
  }
  onProgress?.(1)
  return current
}

// ---------- output names ----------
const pad2 = (n) => String(n).padStart(2, '0')
export const today = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
export const DEFAULT_PATTERN = '{name}'

/**
 * Apply the name pattern to an output. {name} is the source name without extension, {ext} the source extension, {date} today, {n} the
 * file's number in the batch. Anything the converter added after the source name (like "-page-02") is kept.
 */
export function outputName(pattern, source, out, n = 1) {
  const srcBase = baseName(source.name), outBase = baseName(out.name)
  const suffix = outBase.startsWith(srcBase) ? outBase.slice(srcBase.length) : outBase === srcBase ? '' : `-${outBase}`
  const stem = (pattern || DEFAULT_PATTERN)
    .replaceAll('{name}', srcBase).replaceAll('{ext}', extOf(source.name) || 'file').replaceAll('{date}', today()).replaceAll('{n}', String(n))
  return `${safeName(stem) || 'file'}${suffix}.${extOf(out.name) || 'bin'}`
}
export const renamed = (file, name) => (file.name === name ? file : new File([file], name, { type: file.type, lastModified: file.lastModified }))

// ---------- jobs and the queue ----------
let jobId = 0
/**
 * A job turns one input (or, for combine routes, a list of inputs) into output files.
 * { label, input (File | File[]), size, run(ctx) -> File[], exclusive: [keys], source: File }
 */
export function makeJob({ label, input, run, exclusive = [], n = 1, meta = {} }) {
  const files = [].concat(input)
  return { id: ++jobId, label, files, source: files[0], size: files.reduce((a, f) => a + f.size, 0), run, exclusive, n, meta, status: 'queued', progress: 0, outputs: [], error: null, ctl: null }
}

/** Job for one file through the route to `target`, with an optional pre-step (crop) that makes a new input file first. */
export function convertJob({ file, ext, target, values, n, pre, label }) {
  const path = pre ? findRoute('png', target) || (target === 'png' ? [] : null) : findRoute(ext, target) // a crop step hands on a PNG
  if (!path) throw new Error(`No way to convert ${ext.toUpperCase()} to ${target.toUpperCase()}.`)
  const opts = resolveOptions(path, values)
  return makeJob({
    label: label || file.name, input: file, n, exclusive: routeExclusive(path), meta: { target, ext, via: path.slice(0, -1).map((s) => s.to) },
    run: async (ctx) => convertFile(pre ? await pre(file) : file, path, opts, ctx),
  })
}

/** Job for a combine route: all files go into one run. */
export function combineJob({ conv, files, target, values, label }) {
  const path = [{ conv, from: conv.from[0], to: target }]
  const opts = resolveOptions(path, values)
  return makeJob({
    label, input: files, exclusive: conv.exclusive ? [conv.exclusive] : [], meta: { target, ext: 'many', via: [] },
    run: async (ctx) => {
      const run = () => conv.run(files, target, opts, ctx)
      const res = conv.exclusive ? await withLock(conv.exclusive, ctx.signal, run) : await run()
      return [].concat(res)
    },
  })
}

/**
 * createQueue({concurrency, onUpdate(job)}) -> {add(jobs), cancel(job), cancelAll(), retry(job), idle(), jobs}
 * At most `concurrency` jobs run at once; a job that needs an exclusive converter waits while another job holds it.
 */
export function createQueue({ concurrency = defaultConcurrency(), onUpdate, onDone } = {}) {
  const jobs = []
  let running = 0
  let waiters = []
  const heldKeys = () => new Set(jobs.filter((j) => j.status === 'running').flatMap((j) => j.exclusive))
  const set = (job, patch) => { Object.assign(job, patch); onUpdate?.(job) }

  async function start(job) {
    job.ctl = new AbortController()
    running++
    set(job, { status: 'running', progress: 0, error: null })
    try {
      const out = await job.run({ signal: job.ctl.signal, onProgress: (p) => { if (job.status === 'running') set(job, { progress: Math.max(job.progress, Math.min(1, p || 0)) }) } })
      if (job.ctl.signal.aborted) throw abortErr()
      set(job, { status: 'done', progress: 1, outputs: out })
      onDone?.(job)
    } catch (e) {
      if (isAbort(e) || job.ctl.signal.aborted) set(job, { status: 'cancelled', error: null })
      else { console.error(e); set(job, { status: 'error', error: e?.userMessage || e?.message || 'Something went wrong' }) }
    } finally {
      running--
      pump()
    }
  }
  function pump() {
    const held = heldKeys()
    for (const job of jobs) {
      if (running >= concurrency) break
      if (job.status !== 'queued') continue
      if (job.exclusive.some((k) => held.has(k))) continue
      job.exclusive.forEach((k) => held.add(k))
      start(job)
    }
    if (!running && !jobs.some((j) => j.status === 'queued')) { for (const w of waiters) w(); waiters = [] }
  }
  return {
    jobs,
    add(list) { for (const j of list) { jobs.push(j); onUpdate?.(j) }; pump() },
    cancel(job) { if (job.status === 'queued') set(job, { status: 'cancelled' }); else if (job.status === 'running') job.ctl?.abort() },
    cancelAll() { for (const j of jobs) this.cancel(j) },
    retry(job) { if (job.status === 'error' || job.status === 'cancelled') { set(job, { status: 'queued', error: null, progress: 0, outputs: [], final: null }); pump() } },
    idle: () => (running || jobs.some((j) => j.status === 'queued') ? new Promise((r) => waiters.push(r)) : Promise.resolve()),
    clear() { jobs.splice(0, jobs.length) },
    get concurrency() { return concurrency },
  }
}

export { outExt }
