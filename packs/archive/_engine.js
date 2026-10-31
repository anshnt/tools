// Archive engine: one small API over two WebAssembly decoders that run in module workers.
//  - engine 'la' (libarchive.js, MIT): the default. Reads ZIP, 7z, RAR 4/5, TAR (+ gz/bz2/xz/Z), ISO, CAB, LZH, CPIO, AR/DEB, XAR, RPM and more.
//  - engine 'sz' (7z-wasm, LGPL, loaded at runtime): password-protected archives, WIM, ARJ, very large archives, writing 7z/XZ/BZIP2.
// Zstandard (.zst, .tar.zst) is decoded with fzstd. Everything runs on this device; nothing is uploaded.
import { yieldToMain } from '../../lib/ui.js'
import { readZipEntries } from '../files/_core.js'

const FZSTD = 'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/esm/index.mjs'
const WORKERS = { la: new URL('./_la-worker.js', import.meta.url), sz: new URL('./_sz-worker.js', import.meta.url) }
export const LA_LIMIT = 1.5 * 1024 ** 3 // bytes the 'la' engine can hold in its WebAssembly heap

export const abortError = () => Object.assign(new Error('Cancelled'), { code: 'ABORT', name: 'AbortError' })
const err = (message, code) => Object.assign(new Error(message), { code })

// ---------- worker RPC ----------
export class Rpc {
  constructor(kind) { this.kind = kind; this.w = null; this.seq = 0; this.pending = new Map() }
  start() {
    if (this.w) return
    const w = (this.w = new Worker(WORKERS[this.kind], { type: 'module' }))
    w.onmessage = (ev) => {
      const m = ev.data
      const p = this.pending.get(m.id)
      if (!p) return
      if (m.entry) return p.onEntry?.(m.entry)
      if (m.tick) return p.onTick?.(m.tick)
      this.pending.delete(m.id)
      p.cleanup()
      if (m.ok) p.resolve(m.result)
      else p.reject(err(m.error.message, m.error.code))
    }
    w.onerror = (ev) => {
      ev.preventDefault?.()
      this.failAll(err('The archive engine could not start. Check your connection and try again.', 'ENGINE'))
    }
  }
  failAll(e) {
    for (const p of this.pending.values()) { p.cleanup(); p.reject(e) }
    this.pending.clear()
    this.stop()
  }
  stop() { this.w?.terminate(); this.w = null }
  get alive() { return !!this.w }
  call(op, args = {}, { onEntry, onTick, signal } = {}) {
    if (signal?.aborted) return Promise.reject(abortError())
    this.start()
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const onAbort = () => { this.failAll(abortError()) }
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { resolve, reject, onEntry, onTick, cleanup })
      this.w.postMessage({ id, op, ...args })
    })
  }
}

// ---------- format sniffing ----------
const bytesOf = (parts) => parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [p]))
const at = (b, off, ...parts) => { const s = bytesOf(parts); return off + s.length <= b.length && s.every((v, i) => b[off + i] === v) }
export async function readHead(file, n = 40000) { return new Uint8Array(await file.slice(0, n).arrayBuffer()) }
/** Name the container format from magic bytes (falls back to ''). */
export function sniffFormat(b) {
  if (at(b, 0, 0x50, 0x4b, 3, 4) || at(b, 0, 0x50, 0x4b, 5, 6) || at(b, 0, 0x50, 0x4b, 7, 8)) return 'zip'
  if (at(b, 0, 0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)) return '7z'
  if (at(b, 0, 'Rar!', 0x1a, 7, 1)) return 'rar5'
  if (at(b, 0, 'Rar!', 0x1a, 7, 0)) return 'rar'
  if (at(b, 0, 0x1f, 0x8b)) return 'gz'
  if (at(b, 0, 'BZh')) return 'bz2'
  if (at(b, 0, 0xfd, '7zXZ', 0)) return 'xz'
  if (at(b, 0, 0x28, 0xb5, 0x2f, 0xfd)) return 'zst'
  if (at(b, 0, 0x1f, 0x9d)) return 'z'
  if (at(b, 0, 'MSCF')) return 'cab'
  if (at(b, 0, 'MSWIM', 0, 0, 0)) return 'wim'
  if (at(b, 0, '!<arch>', 10)) return 'ar'
  if (at(b, 0, 'xar!')) return 'xar'
  if (at(b, 0, 0xed, 0xab, 0xee, 0xdb)) return 'rpm'
  if (at(b, 0, '070701') || at(b, 0, '070707') || at(b, 0, '070702')) return 'cpio'
  if (at(b, 0, 0x60, 0xea)) return 'arj'
  if (at(b, 0, 'koly')) return 'dmg'
  if (at(b, 257, 'ustar')) return 'tar'
  if (at(b, 2, '-lh') || at(b, 2, '-lz')) return 'lzh'
  if (at(b, 32769, 'CD001')) return 'iso'
  if (at(b, 0, 'ALZ', 1)) return 'alz'
  if (at(b, 0, 'EGGA')) return 'egg'
  return ''
}
const nameExt = (name) => {
  const n = name.toLowerCase()
  for (const e of ['tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst', 'tar.z', 'tar.lz', 'tar.lzma']) if (n.endsWith('.' + e)) return e
  return n.match(/\.([^./\\]+)$/)?.[1] || ''
}
export { nameExt }
const SZ_FIRST = new Set(['wim', 'swm', 'esd', 'dmg', 'arj', 'vhd', 'vhdx', 'vmdk', 'squashfs', 'udf', 'hfs', 'ntfs', 'fat', 'apfs'])
/** Extensions and formats the picker offers (the engine also tries anything else it is given). */
export const READABLE = ['zip', 'zipx', 'jar', 'war', 'apk', 'aab', 'xpi', 'wbpz', 'epub', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', '7z', 'rar', 'r00', 'tar', 'tgz', 'tbz2', 'tbz', 'txz', 'tzst', 'tar.gz', 'tar.bz2', 'tar.xz', 'tar.zst', 'gz', 'bz2', 'xz', 'z', 'zst', 'iso', 'cab', 'lzh', 'lha', 'cpio', 'ar', 'a', 'deb', 'udeb', 'rpm', 'xar', 'pkg', 'wim', 'arj']
export const ACCEPT = READABLE.filter((e) => !e.includes('.')).map((e) => '.' + e).join(',')

// ---------- one open archive on one engine ----------
class Session {
  constructor(kind, file, password) { this.kind = kind; this.file = file; this.password = password || ''; this.rpc = new Rpc(kind); this.format = ''; this.entries = [] }
  /** Load the archive into the worker (and list it on the 'sz' engine). */
  async load(signal) {
    this.rpc.start()
    if (this.kind === 'la') {
      if (this.file.size > LA_LIMIT) throw err('This archive is too big for the main engine, so the other engine will be used.', 'TOOBIG')
      await this.rpc.call('open', { file: this.file, password: this.password }, { signal })
      return null
    }
    return this.rpc.call('open', { file: this.file, password: this.password }, { signal })
  }
  async open(signal) {
    const r = await this.load(signal)
    if (this.kind === 'la') this.entries = (await this.rpc.call('list', {}, { signal })).map((e) => ({ ...e, date: null }))
    else { this.format = r.format; this.entries = r.entries; this.meta = r }
    return this
  }
  /** After a cancel the worker is gone: bring it back without touching the entry list. */
  async ensure(signal) { if (!this.rpc.alive) await this.load(signal) }
  async extract(paths, onEntry, { signal, test } = {}) {
    await this.ensure(signal)
    const onTick = (t) => onEntry?.(null, null, t)
    const args = this.kind === 'la' ? { wanted: paths, test } : { paths, all: paths ? null : this.entries, test }
    return this.rpc.call('extract', args, { signal, onEntry: (e) => onEntry?.(e, e.data), onTick })
  }
  close() { this.rpc.stop() }
}

// ---------- zstd ----------
async function unzstd(file, { onProgress, signal } = {}) {
  const { Decompress } = await import(FZSTD)
  if (file.size > 512 * 1024 * 1024) throw err('Zstandard files over 512 MB cannot be unpacked in the browser.', 'TOOBIG')
  const parts = []
  const d = new Decompress((chunk, final) => { parts.push(chunk.slice()) })
  const step = 1 << 20
  for (let o = 0; o < file.size; o += step) {
    if (signal?.aborted) throw abortError()
    d.push(new Uint8Array(await file.slice(o, o + step).arrayBuffer()), o + step >= file.size)
    onProgress?.(Math.min(1, (o + step) / file.size), 'Unpacking Zstandard')
    await yieldToMain()
  }
  return new Blob(parts)
}

// ---------- public API ----------
/**
 * Open an archive. Returns an Archive: {name, format, engine, entries, encrypted, extract(paths|null, onEntry, opts), test(opts), close()}.
 * entries: [{path, size, type: 'file'|'dir'|'link'|'other', date (ms)|null, encrypted, index}]
 * Throws Error with code NEEDPW (password needed), BADPW (wrong password), ABORT or READ.
 */
export async function openArchive(file, { password = '', signal } = {}) {
  let src = file
  let name = file.name
  let label = ''
  const head = await readHead(file)
  let fmt = sniffFormat(head)
  const e0 = nameExt(file.name)
  if (fmt === 'zst' || (!fmt && /(^|\.)(zst|tzst)$/.test(e0))) {
    src = await unzstd(file, { signal })
    name = file.name.replace(/\.(zst|tzst)$/i, e0 === 'tzst' ? '.tar' : '')
    label = 'zstd'
    fmt = sniffFormat(await readHead(src))
    if (!fmt) { // a single zstd-compressed file
      const entry = { path: name, size: src.size, type: 'file', date: file.lastModified || null, encrypted: false, index: 0 }
      return virtual(file.name, 'zst', [entry], new Map([[name, src]]))
    }
  }
  if (fmt === 'alz' || fmt === 'egg' || /\.(alz|egg)$/i.test(file.name)) throw err('ALZ and EGG are Korean archive formats that no browser-based decoder supports yet. Use the desktop app that made them, then try again.', 'UNSUPPORTED')
  const ext = nameExt(name)
  const order = SZ_FIRST.has(ext) || SZ_FIRST.has(fmt) ? ['sz', 'la'] : ['la', 'sz']
  let first = null
  let session = null
  for (const kind of order) {
    const s = new Session(kind, src, password)
    try {
      await s.open(signal)
      if (!s.entries.length && kind === 'la') { s.close(); first ||= err('This does not look like an archive, or it is empty.', 'READ'); continue }
      session = s
      break
    } catch (e) {
      s.close()
      if (e.code === 'ABORT') throw e
      if (!first || e.code === 'NEEDPW' || e.code === 'BADPW') first = e
    }
  }
  if (!session) throw first || err('This file is not an archive this tool can open.', 'READ')
  if (session.kind === 'la' && fmt === 'zip') await zipDates(session, src)
  return new Archive(session, { file: src, source: file, name: file.name, password, fmt, label, ext })
}

/** The 'la' engine does not report modification times, so ZIP dates come from the ZIP directory itself. */
async function zipDates(session, file) {
  try {
    const z = await readZipEntries(file)
    const byName = new Map(z.map((e) => [e.name.replace(/\/$/, ''), e]))
    for (const e of session.entries) {
      const m = byName.get(e.path.replace(/\/$/, ''))
      if (m) { e.date = m.date ? m.date.getTime() : null; e.packed = m.csize }
    }
  } catch { /* dates are optional */ }
}

function virtual(name, format, entries, blobs) {
  return {
    name, format, engine: 'zstd', entries, encrypted: false, needsPassword: false, files: () => entries,
    async extract(paths, onEntry) { for (const e of entries) if (!paths || paths.includes(e.path)) { const b = blobs.get(e.path); onEntry(e, new Uint8Array(await b.arrayBuffer())) } },
    async test() { return { checked: entries.length, problems: [] } },
    setPassword() {}, close() {},
  }
}

class Archive {
  constructor(session, { file, source, name, password, fmt, label, ext }) {
    this.s = session
    this.file = file
    this.source = source
    this.name = name
    this.password = password
    this.fmt = fmt
    this.ext = ext
    this.sniffed = fmt
  }
  get engine() { return this.s.kind === 'la' ? 'main' : 'extra' }
  get entries() { return this.s.entries }
  get format() { return this.s.format || this.fmt || this.ext }
  get encrypted() { return this.s.entries.some((e) => e.encrypted) }
  get needsPassword() { return this.encrypted && !this.password }
  files() { return this.entries.filter((e) => e.type === 'file') }

  /**
   * Set the password and verify it by unpacking the smallest encrypted file. Throws BADPW if it is wrong.
   * Encrypted data always goes through the 'sz' engine: it reliably tells a wrong password from a right one.
   */
  async setPassword(pw, signal) {
    this.password = pw
    if (this.s.kind === 'la') await this.#switch(signal)
    else await this.#reopen(signal)
    const probe = this.files().filter((e) => e.encrypted && e.size > 0).sort((a, b) => a.size - b.size)[0]
    if (probe) await this.extract([probe.path], () => {}, { signal, noRetry: true })
  }
  async #reopen(signal) {
    const old = this.s
    const s = new Session(old.kind, this.file, this.password)
    await s.load(signal)
    s.entries = old.entries
    s.format = old.format
    s.meta = old.meta
    old.close()
    this.s = s
  }
  async #switch(signal) {
    const kind = this.s.kind === 'la' ? 'sz' : 'la'
    const s = new Session(kind, this.file, this.password)
    await s.open(signal)
    this.s.close()
    this.s = s
  }

  /**
   * Unpack files. paths: array of entry paths, or null for everything. onEntry(entry, bytes) is called per file (bytes: Uint8Array).
   * onProgress(0..1, text). If the first engine fails the other one is tried once.
   */
  async extract(paths, onEntry, { signal, onProgress, noRetry } = {}) {
    const total = (paths ? this.entries.filter((e) => paths.includes(e.path)) : this.files()).reduce((s, e) => s + e.size, 0) || 1
    let done = 0
    const run = () => {
      done = 0
      return this.s.extract(paths, (e, data, tick) => {
        if (!e) return
        done += e.size
        onProgress?.(Math.min(0.99, done / total), e.path.split('/').pop())
        return onEntry(e, data)
      }, { signal })
    }
    try {
      return await run()
    } catch (e) {
      if (e.code === 'ABORT' || noRetry) throw e
      if (e.code === 'BADPW' && this.s.kind === 'sz') throw e
      const was = this.s.kind
      try { await this.#switch(signal) } catch (e2) { if (e2.code === 'ABORT') throw e2; throw e.code === 'BADPW' || e.code === 'NEEDPW' ? e : e }
      try {
        return await run()
      } catch (e3) {
        if (e3.code === 'ABORT') throw e3
        throw was === 'la' ? e3 : e
      }
    }
  }

  /** Read one entry fully. */
  async read(path, opts) {
    let out = null
    await this.extract([path], (e, data) => { out = data }, opts)
    if (!out) throw err('That file could not be read from the archive.', 'READ')
    return out
  }

  /** Check every file. Returns {checked, problems: [{path, error}]}. */
  async test({ signal, onProgress } = {}) {
    const files = this.files()
    let n = 0
    const r = await this.s.extract(null, (e, data, tick) => { if (tick) { n++; onProgress?.(Math.min(0.99, n / (files.length || 1)), tick.path) } }, { signal, test: true })
    return { checked: files.length, problems: r.bad || [] }
  }
  close() { this.s.close() }
}

/** Build a 7z, zip, tar, gz, bz2 or xz with the 'sz' engine. files: [{path, file}]. Returns Uint8Array. */
export async function create7z(opts, { signal } = {}) {
  const s = new Rpc('sz')
  try { return await s.call('create', opts, { signal }) } finally { s.stop() }
}
