// Archive writers. ZIP (levels, AES-256 or classic ZipCrypto passwords) comes from zip.js (BSD-3). TAR is written here (ustar, with PAX
// records for long or non-ASCII names and files over 8 GB). TAR.GZ uses the browser's gzip. 7z, TAR.XZ and TAR.BZ2 use the 'sz' engine.
// A "sink" takes files one at a time so big conversions never need every file listed twice: add(), dir(), then finish() gives a Blob.
import { create7z, abortError } from './_engine.js'

const ZIPJS = 'https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.8.26/index.min.js'
let zipMod = null
export const zipjs = () => (zipMod ||= import(ZIPJS).then((m) => { m.configure({ useWebWorkers: true, useCompressionStream: false }); return m }).catch((e) => { zipMod = null; throw Object.assign(new Error('Could not load the ZIP writer. Check your connection and try again.'), { cause: e }) }))

/** Reject with a cancel error as soon as the signal aborts, without waiting for the promise. */
export function abortable(promise, signal) {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export const FORMATS = {
  zip: { label: 'ZIP', ext: 'zip', mime: 'application/zip' },
  tar: { label: 'TAR', ext: 'tar', mime: 'application/x-tar' },
  'tar.gz': { label: 'TAR.GZ', ext: 'tar.gz', mime: 'application/gzip' },
  'tar.xz': { label: 'TAR.XZ', ext: 'tar.xz', mime: 'application/x-xz' },
  'tar.bz2': { label: 'TAR.BZ2', ext: 'tar.bz2', mime: 'application/x-bzip2' },
  '7z': { label: '7Z', ext: '7z', mime: 'application/x-7z-compressed' },
}
const PRECOMPRESSED = new Set('jpg jpeg png gif webp avif heic heif mp3 m4a aac ogg opus flac mp4 m4v mov mkv webm avi zip gz tgz bz2 xz 7z rar zst jar docx xlsx pptx odt ods odp epub woff woff2 pdf'.split(' '))
const extOf = (n) => (n.match(/\.([^./\\]+)$/)?.[1] || '').toLowerCase()

/** Remove drive letters, leading slashes and ".." so nothing can be written outside the archive root. */
export function cleanPath(p) {
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..')
  if (parts.length && /^[A-Za-z]:$/.test(parts[0])) parts.shift()
  return parts.join('/')
}

// ---------- TAR ----------
const enc = new TextEncoder()
const octal = (n, w) => Math.max(0, Math.floor(n)).toString(8).padStart(w - 1, '0') + '\0'
const MAX_OCT11 = 0o77777777777

function tarHeader({ name, size = 0, mtime = 0, type = '0', mode = 0o644, prefix = '' }) {
  const b = new Uint8Array(512)
  const put = (off, s, max) => b.set((typeof s === 'string' ? enc.encode(s) : s).subarray(0, max), off)
  put(0, name, 100); put(100, octal(mode, 8), 8); put(108, octal(0, 8), 8); put(116, octal(0, 8), 8)
  put(124, octal(size, 12), 12); put(136, octal(mtime, 12), 12)
  b.fill(0x20, 148, 156)
  b[156] = type.charCodeAt(0)
  put(257, 'ustar\0', 6); put(263, '00', 2)
  put(329, octal(0, 8), 8); put(337, octal(0, 8), 8); put(345, prefix, 155)
  let sum = 0
  for (const x of b) sum += x
  put(148, sum.toString(8).padStart(6, '0') + '\0 ', 8)
  return b
}
const pad = (n) => new Uint8Array((512 - (n % 512)) % 512)

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`
  let len = enc.encode(body).length
  let total = len + String(len).length
  if (String(total).length !== String(len).length) total = len + String(total).length
  return enc.encode(`${total}${body}`)
}

/** Header blocks for one entry (a PAX header first when needed). */
export function tarEntryHeaders(path, size, mtimeSec, isDir) {
  const nm = isDir ? path.replace(/\/?$/, '/') : path
  const nb = enc.encode(nm)
  let name = nm
  let prefix = ''
  const pax = {}
  if (/[^\x00-\x7f]/.test(nm)) pax.path = nm
  else if (nb.length > 100) {
    const cut = [...nm.matchAll(/\//g)].map((m) => m.index).find((i) => i <= 155 && nm.length - i - 1 <= 100 && nm.length - i - 1 > 0)
    if (cut != null) { prefix = nm.slice(0, cut); name = nm.slice(cut + 1) } else pax.path = nm
  }
  if (size > MAX_OCT11) pax.size = String(size)
  const out = []
  if (Object.keys(pax).length) {
    const data = new Uint8Array(Object.entries(pax).flatMap(([k, v]) => [...paxRecord(k, v)]))
    out.push(tarHeader({ name: 'PaxHeader/' + (pax.path ? 'entry' : name.slice(0, 80)), type: 'x', size: data.length, mtime: mtimeSec }), data, pad(data.length))
    if (pax.path) name = nm.slice(0, 90).replace(/[^\x20-\x7e]/g, '_')
  }
  out.push(tarHeader({ name, prefix, size: isDir ? 0 : Math.min(size, MAX_OCT11), mtime: mtimeSec, type: isDir ? '5' : '0', mode: isDir ? 0o755 : 0o644 }))
  return out
}

const toBlobish = (d) => (d instanceof Blob ? d : new Blob([d]))

export async function gzipBlob(blob, { onProgress, signal } = {}) {
  let seen = 0
  const count = new TransformStream({ transform(chunk, c) { seen += chunk.length; onProgress?.(Math.min(1, seen / (blob.size || 1))); c.enqueue(chunk) } })
  try {
    return await new Response(blob.stream().pipeThrough(count, { signal }).pipeThrough(new CompressionStream('gzip'), { signal })).blob()
  } catch (e) { if (signal?.aborted) throw abortError(); throw e }
}
export async function gunzipBlob(blob, { onProgress, signal } = {}) {
  let seen = 0
  const count = new TransformStream({ transform(chunk, c) { seen += chunk.length; onProgress?.(Math.min(1, seen / (blob.size || 1))); c.enqueue(chunk) } })
  try {
    return await new Response(blob.stream().pipeThrough(count, { signal }).pipeThrough(new DecompressionStream('gzip'), { signal })).blob()
  } catch (e) { if (signal?.aborted) throw abortError(); throw Object.assign(new Error('That does not look like a valid gzip file, or it is damaged.'), { cause: e }) }
}

// ---------- sinks ----------
/**
 * createSink(kind, opts) -> {add(path, data, {date, store}), dir(path), finish() -> Blob}
 * kind: zip | tar | tar.gz | tar.xz | tar.bz2 | 7z. opts: {level 0-9, password, zipCrypto, encryptNames, smart, signal, onProgress}
 */
export async function createSink(kind, opts = {}) {
  const { level = 6, password = '', zipCrypto = false, encryptNames = false, smart = true, signal, onProgress } = opts
  const used = new Set()
  const unique = (path) => {
    let p = cleanPath(path) || 'file'
    if (used.has(p)) {
      const dot = p.lastIndexOf('.') > p.lastIndexOf('/') ? p.lastIndexOf('.') : p.length
      let i = 2
      while (used.has(`${p.slice(0, dot)} (${i})${p.slice(dot)}`)) i++
      p = `${p.slice(0, dot)} (${i})${p.slice(dot)}`
    }
    used.add(p)
    return p
  }
  const dirs = new Set()
  const dirPath = (path) => { const p = cleanPath(path); if (p) dirs.add(p) }
  let total = 0
  let added = 0
  const tick = (n) => { added += n; onProgress?.(total ? Math.min(0.99, added / total) : null) }

  if (kind === 'zip') {
    const Z = await zipjs()
    const w = new Z.ZipWriter(new Z.BlobWriter('application/zip'), { password: password || undefined, encryptionStrength: 3, zipCrypto: !!(password && zipCrypto), level })
    const jobs = []
    return {
      setTotal: (n) => { total = n },
      add: (path, data, { date, store } = {}) => {
        const p = unique(path)
        const lvl = level === 0 || (smart && PRECOMPRESSED.has(extOf(p))) || store ? 0 : level
        const reader = data instanceof Blob ? new Z.BlobReader(data) : new Z.Uint8ArrayReader(data)
        const job = w.add(p, reader, { lastModDate: date ? new Date(date) : undefined, level: lvl, signal }).then(() => tick(data.size ?? data.length ?? 0))
        job.catch(() => {})
        jobs.push(job)
        return job
      },
      dir: (path) => { const p = cleanPath(path); if (p) jobs.push(w.add(p + '/', undefined, { directory: true })) },
      async finish() { await abortable(Promise.all(jobs), signal); return abortable(w.close(undefined, { signal }), signal) },
    }
  }

  if (kind.startsWith('tar')) {
    const parts = []
    let pending = Promise.resolve()
    return {
      setTotal: (n) => { total = n },
      add: (path, data, { date } = {}) => {
        const p = unique(path)
        const size = data.size ?? data.length ?? 0
        parts.push(...tarEntryHeaders(p, size, date ? date / 1000 : 0, false), data, pad(size))
        tick(size)
        return pending
      },
      dir: (path) => { const p = cleanPath(path); if (p) parts.push(...tarEntryHeaders(p, 0, 0, true)) },
      async finish() {
        parts.push(new Uint8Array(1024))
        const tar = new Blob(parts, { type: FORMATS.tar.mime })
        if (kind === 'tar') return tar
        if (kind === 'tar.gz') return gzipBlob(tar, { signal })
        const out = await create7z({ kind: kind === 'tar.xz' ? 'xz' : 'bzip2', files: [{ path: 'x.tar', file: tar }], level: Math.max(1, level) }, { signal })
        return new Blob([out], { type: FORMATS[kind].mime })
      },
    }
  }

  if (kind === '7z') {
    const files = []
    return {
      setTotal: (n) => { total = n },
      add: (path, data) => { const p = unique(path); files.push({ path: p, file: toBlobish(data) }); tick(data.size ?? data.length ?? 0); return Promise.resolve() },
      dir: (path) => dirPath(path),
      async finish() {
        const out = await create7z({ kind: '7z', files, dirs: [...dirs], level, password, encryptNames, solid: true }, { signal })
        return new Blob([out], { type: FORMATS['7z'].mime })
      },
    }
  }
  throw new Error(`Cannot create ${kind} archives.`)
}
