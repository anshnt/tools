// DWG -> DXF with LibreDWG compiled to WebAssembly (@mlightcad/libredwg-web, GPL-3.0, loaded from the CDN at runtime as a separate program).
// Runs in a worker so a big drawing does not freeze the page. LibreDWG reads DWG R13 to 2018 (newer files keep the 2018 format).
const VER = '0.8.0'
const BASE = `https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@${VER}`

const WORKER = `
let lib
self.onmessage = async (e) => {
  const { id, bytes, base } = e.data
  try {
    if (!lib) { const m = await import(base + '/dist/libredwg-web.js'); lib = await m.LibreDwg.create(base + '/wasm') }
    const out = lib.dwg_write_dxf(bytes)
    self.postMessage({ id, out })
  } catch (err) { lib = null; self.postMessage({ id, error: String((err && err.message) || err) }) }
}`

export const DWG_VERSIONS = { AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018 or newer' }
/** 'AC1027' style tag of a DWG, or null. */
export const dwgTag = (b) => { if (b.length < 6) return null; const s = String.fromCharCode(...b.subarray(0, 6)); return /^AC10\d\d$/.test(s) ? s : null }
export const isDwg = (b) => !!dwgTag(b)
const userErr = (m) => Object.assign(new Error(m), { userMessage: m })

let worker = null, seq = 0
const pending = new Map()
function getWorker() {
  if (worker) return worker
  const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }))
  worker = new Worker(url, { type: 'module' })
  worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.out) } }
  worker.onerror = (e) => { for (const p of pending.values()) p.rej(new Error('Could not start the DWG reader.')); pending.clear(); worker.terminate(); worker = null; e.preventDefault?.() }
  return worker
}
async function viaMain(buf) {
  const m = await import(`${BASE}/dist/libredwg-web.js`)
  const lib = await m.LibreDwg.create(`${BASE}/wasm`)
  return lib.dwg_write_dxf(buf)
}

/** DWG bytes -> {dxf: Uint8Array, version}. */
export async function dwgToDxf(bytes, { signal } = {}) {
  const tag = dwgTag(bytes)
  if (!tag) throw userErr('This does not look like a DWG file.')
  if (!DWG_VERSIONS[tag]) throw userErr(tag < 'AC1012' ? 'DWG files older than R13 (R12 and before) cannot be read here. Save it as a newer DWG or as DXF.' : 'This DWG version is not supported yet.')
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  let out
  try {
    out = await new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, { res, rej })
      signal?.addEventListener('abort', () => { pending.delete(id); rej(Object.assign(new Error('Cancelled'), { code: 'ABORT' })) }, { once: true })
      getWorker().postMessage({ id, bytes: buf, base: BASE })
    })
  } catch (e) {
    if (e.code === 'ABORT') throw e
    try { out = await viaMain(buf.slice(0)) } catch (e2) { throw userErr('Could not read this DWG. It may be damaged, or the DWG reader could not be loaded. Check your connection and try again.') }
  }
  if (!out || !out.length) throw userErr('This DWG could not be converted. It may be damaged or use features the reader does not know.')
  return { dxf: out instanceof Uint8Array ? out : new Uint8Array(out), version: DWG_VERSIONS[tag] }
}
