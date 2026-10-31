// High-level archive jobs shared by the tools and by the File Converter hub. No DOM needed.
import { openArchive, abortError } from './_engine.js'
import { createSink, cleanPath, FORMATS, gzipBlob, gunzipBlob, abortable } from './_write.js'
import { yieldToMain } from '../../lib/ui.js'

export const needPassword = () => Object.assign(new Error('This archive is password protected. Type the password and try again.'), { code: 'NEEDPW' })

/** Open and unlock (when a password is given). Throws NEEDPW / BADPW with plain messages. */
export async function openUnlocked(file, { password = '', signal } = {}) {
  const arc = await openArchive(file, { password, signal })
  if (arc.needsPassword) { arc.close(); throw needPassword() }
  if (password && arc.encrypted && arc.setPassword) await arc.setPassword(password, signal)
  return arc
}

/** Make a File from extracted bytes (name flattened if flat is true). */
export const fileFrom = (path, data, date) => new File([data], path.split('/').pop() || 'file', { lastModified: date || Date.now() })

/** Extract every file. Returns [{path, file}] with the folder structure kept in path. */
export async function extractFiles(file, { password, signal, onProgress, only } = {}) {
  const arc = await openUnlocked(file, { password, signal })
  try {
    const out = []
    await arc.extract(only || null, (e, data) => { out.push({ path: cleanPath(e.path), file: fileFrom(e.path, data, e.date), date: e.date }) }, { signal, onProgress })
    return out
  } finally { arc.close() }
}

/** Convert an archive into another archive format. Returns a Blob. */
export async function repack(file, kind, { password = '', outPassword = '', level = 6, zipCrypto = false, encryptNames = false, signal, onProgress } = {}) {
  const arc = await openUnlocked(file, { password, signal })
  try {
    const sink = await createSink(kind, { level, password: outPassword, zipCrypto, encryptNames, signal })
    const files = arc.files()
    const total = files.reduce((s, e) => s + e.size, 0)
    sink.setTotal?.(total)
    for (const d of arc.entries.filter((e) => e.type === 'dir')) sink.dir(d.path)
    let chain = Promise.resolve()
    let n = 0
    await arc.extract(null, (e, data) => {
      chain = chain.then(() => sink.add(cleanPath(e.path) || e.path, data, { date: e.date }))
      chain.catch(() => {})
      n++
      return chain
    }, { signal, onProgress: (f, t) => onProgress?.(f * 0.85, t) })
    await abortable(chain, signal)
    if (!n) throw new Error('There are no files inside this archive to convert.')
    onProgress?.(0.9, 'Packing')
    const blob = await abortable(sink.finish(), signal)
    onProgress?.(1)
    return blob
  } finally { arc.close() }
}

/** Build an archive from picked files. items: [{path, file, mtime}] */
export async function createArchive(items, kind, { level = 6, password = '', zipCrypto = false, encryptNames = false, folders = [], smart = true, signal, onProgress } = {}) {
  const sink = await createSink(kind, { level, password, zipCrypto, encryptNames, smart, signal })
  sink.setTotal?.(items.reduce((s, i) => s + i.file.size, 0))
  for (const f of folders) sink.dir(f)
  let k = 0
  for (const it of items) {
    if (signal?.aborted) throw abortError()
    await sink.add(it.path, it.file, { date: it.mtime })
    if (++k % 20 === 0) await yieldToMain()
    onProgress?.(0.9 * (k / items.length), it.path.split('/').pop())
  }
  onProgress?.(0.92, 'Finishing')
  const blob = await abortable(sink.finish(), signal)
  onProgress?.(1)
  return blob
}

export const outName = (file, kind) => `${file.name.replace(/\.(tar\.(gz|bz2|xz|zst|z)|tgz|tbz2?|txz|tzst|[^./\\]+)$/i, '') || 'archive'}.${FORMATS[kind].ext}`

/** gzip any file, or unpack gz / bz2 / xz / Z / zst. Returns a Blob and the name to save it as. */
export async function gzipFile(file, { signal, onProgress } = {}) {
  return { blob: await gzipBlob(file, { signal, onProgress }), name: `${file.name}.gz` }
}
export async function gunzipFile(file, { signal, onProgress, password } = {}) {
  const name = file.name
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const blob = await gunzipBlob(file, { signal, onProgress })
    return { blob, name: /\.gz$/i.test(name) ? name.replace(/\.gz$/i, '') : /\.tgz$/i.test(name) ? name.replace(/\.tgz$/i, '.tar') : `${name}.out` }
  }
  const files = await extractFiles(file, { signal, onProgress, password })
  if (files.length !== 1) throw new Error('This file holds several files. Use the archive extractor to open it.')
  return { blob: files[0].file, name: files[0].path.split('/').pop() }
}
