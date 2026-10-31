// RAR and 7z (comic books: CBR, CB7) through a WebAssembly build of libarchive (libarchive.js 2.0.2, MIT; libarchive is BSD).
// The library's worker is loaded from the CDN as text and started from a Blob URL (browsers refuse cross-origin workers), with the wasm path made absolute.
import { fail } from './_book.js'

const VERSION = '2.0.2'
const BASE = `https://cdn.jsdelivr.net/npm/libarchive.js@${VERSION}/dist/`
let ready

async function load() {
  const [mod, src] = await Promise.all([import(`${BASE}libarchive.js`), fetch(`${BASE}worker-bundle.js`).then((r) => { if (!r.ok) throw new Error('worker'); return r.text() })])
  const patched = src.replace('new URL("libarchive.wasm",import.meta.url).href', JSON.stringify(`${BASE}libarchive.wasm`))
  if (patched === src) throw new Error('unexpected archive worker')
  const url = URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }))
  mod.Archive.init({ getWorker: () => new Worker(url, { type: 'module' }) })
  return mod.Archive
}
const archive = () => (ready ||= load().catch((e) => { ready = null; throw Object.assign(new Error('Could not load the RAR and 7z reader. Check your connection and try again.'), { cause: e }) }))

/** Extract every file of a RAR, 7z (or any libarchive format). Returns [{name, data: Uint8Array}] with full paths; folders are skipped. */
export async function extractArchive(file) {
  const Archive = await archive()
  let a
  try {
    a = await Archive.open(file)
  } catch (e) {
    throw fail('This archive could not be opened. It may be damaged.', 'BAD')
  }
  try {
    let enc = null
    try { enc = await a.hasEncryptedData() } catch { /* unknown */ }
    if (enc) throw fail('This archive is password-protected, so it cannot be converted.', 'DRM')
    await a.extractFiles()
    const list = await a.getFilesArray()
    const out = []
    for (const { file: f, path } of list) {
      if (!(f instanceof Blob)) continue
      out.push({ name: `${path || ''}${f.name}`, data: new Uint8Array(await f.arrayBuffer()) })
    }
    return out
  } catch (e) {
    if (e?.code) throw e
    throw fail('This archive could not be read. It may be damaged, encrypted or use an unsupported method.', 'BAD')
  } finally {
    try { await a.close() } catch { /* already closed */ }
  }
}
