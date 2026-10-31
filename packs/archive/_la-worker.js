// Module worker around libarchive (WebAssembly build from libarchive.js, MIT). It reads ZIP, 7z, RAR 4/5, TAR, GZ, BZ2, XZ, Z, ISO, CAB, LZH,
// CPIO, AR/DEB, XAR, RPM and more. The whole archive is copied into the wasm heap once, then entries are walked one at a time so a big
// archive never has to be held as many JS copies. Messages: {id, op, ...} in, {id, ok, result | error} or {id, entry} out.
import { getWasmModule } from 'https://cdn.jsdelivr.net/npm/libarchive.js@2.0.2/src/webworker/wasm-module.js'

const noise = []
console.error = (...a) => { noise.push(a.join(' ')); if (noise.length > 20) noise.shift() } // the wasm build prints its own diagnostics here
const TYPES = { 32768: 'file', 16384: 'dir', 40960: 'link', 49152: 'other', 8192: 'other', 24576: 'other', 4096: 'other' }
const CHUNK = 32 * 1024 * 1024
let M = null
let rc = null
let ptr = 0
let len = 0
let pass = null
let readyP = null

const ready = () => (readyP ||= new Promise((res) => getWasmModule((m) => { M = m; rc = m.runCode; res() })))
const post = (msg, transfer) => self.postMessage(msg, transfer || [])

function release() {
  if (ptr) { try { rc.free(ptr) } catch { /* ignore */ } }
  ptr = 0
  len = 0
}

async function open({ file, password }) {
  await ready()
  release()
  pass = password || null
  len = file.size
  ptr = rc.malloc(len || 1)
  if (!ptr) throw Object.assign(new Error('This archive is too big for the in-browser engine. Try a smaller one.'), { code: 'TOOBIG' })
  for (let o = 0; o < len; o += CHUNK) M.HEAPU8.set(new Uint8Array(await file.slice(o, o + CHUNK).arrayBuffer()), ptr + o)
  return true
}

/** Walk the archive. visit(entry, a) runs for each entry and returns after it has consumed or skipped the data. */
function walk(visit) {
  const a = rc.openArchive(ptr, len, pass, 'en_US.UTF-8')
  if (!a) throw new Error('Could not open this archive. It may be damaged or in an unsupported format.')
  try {
    let n = 0
    for (;;) {
      const e = rc.getNextEntry(a)
      if (e === 0) break
      const path = rc.getEntryName(e)
      const info = { path, size: rc.getEntrySize(e), type: TYPES[rc.getEntryType(e)] || 'other', encrypted: rc.entryIsEncrypted(e) > 0, index: n++ }
      if (visit(info, a) === false) break
    }
    return n
  } finally { rc.closeArchive(a) }
}

const errText = (a) => { try { return rc.getError(a) || 'Could not read this entry.' } catch { return 'Could not read this entry.' } }

function list() {
  const out = []
  walk((info, a) => { out.push(info); rc.skipEntry(a) })
  return out
}

/** Extract entries. wanted: array of paths (null = everything). Each file is posted as it is read. */
function extract(id, { wanted, test }) {
  const want = wanted ? new Set(wanted) : null
  let done = 0
  const bad = []
  walk((info, a) => {
    if (info.type !== 'file' || (want && !want.has(info.path))) { rc.skipEntry(a); return }
    const p = rc.getFileData(a, info.size)
    if (p < 0) {
      const msg = errText(a)
      if (test) { bad.push({ path: info.path, error: msg }); return }
      throw Object.assign(new Error(info.encrypted || /passphrase|password|decrypt/i.test(msg) ? 'Wrong password, or the entry is encrypted.' : `${info.path}: ${msg}`), { code: info.encrypted ? 'BADPW' : 'READ' })
    }
    done++
    if (test) { rc.free(p); post({ id, tick: { path: info.path, size: info.size } }); return }
    const data = M.HEAPU8.slice(p, p + info.size)
    rc.free(p)
    post({ id, entry: { ...info, data } }, [data.buffer])
    if (want && done >= want.size) return false
  })
  return { count: done, bad }
}

self.onmessage = async (ev) => {
  const { id, op, ...args } = ev.data
  try {
    let result
    if (op === 'open') result = await open(args)
    else if (op === 'list') result = list()
    else if (op === 'extract') result = extract(id, args)
    else if (op === 'close') { release(); result = true }
    post({ id, ok: true, result })
  } catch (e) {
    post({ id, ok: false, error: { message: typeof e?.message === 'string' && e.message ? e.message : noise.at(-1) || 'Could not read this archive. It may be damaged or in an unsupported format.', code: e?.code } })
  }
}
