// Pinned CDN loaders for the decoders and encoders this pack uses. Each one loads on first use and is cached.
import { jszip, pdfLib, script } from '../../lib/libs.js'

export { jszip, pdfLib }
export const VERSIONS = {
  utif: '3.1.0', // TIFF reader (MIT), loaded by _tiff-worker.js
  upng: '2.1.0', // PNG and animated PNG reader and writer (MIT)
  agpsd: '31.0.2', // PSD reader (MIT)
  jxl: '1.3.0', // JPEG XL decoder and encoder, wasm (Apache-2.0)
  openjpeg: '1.3.6', // JPEG 2000 decoder, wasm (MIT, OpenJPEG is BSD-2-Clause)
  libraw: '1.6.0', // camera RAW decoder, wasm (ISC wrapper, LibRaw is LGPL-2.1 or CDDL-1.0)
  gifenc: '1.0.3', // GIF writer (MIT)
  gifuct: '2.1.2', // GIF reader (MIT)
  exr: '1.0.2', // OpenEXR reader (MIT)
}
const V = VERSIONS
const jsd = (path) => `https://cdn.jsdelivr.net/npm/${path}`
const cache = new Map()
const once = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw Object.assign(new Error(`Could not load the ${key} decoder. Check your connection and try again.`), { cause: e }) }))
  return cache.get(key)
}

export const upng = () => once('PNG', () => import(jsd(`upng-js@${V.upng}/+esm`)).then((m) => m.default || m))
export const agPsd = () => once('PSD', () => import(jsd(`ag-psd@${V.agpsd}/+esm`)))
export const gifenc = () => once('GIF', () => import(jsd(`gifenc@${V.gifenc}/+esm`)))
export const gifuct = () => once('GIF reader', () => import(jsd(`gifuct-js@${V.gifuct}/+esm`)))
export const parseExr = () => once('OpenEXR', () => import(jsd(`parse-exr@${V.exr}/+esm`)).then((m) => m.default || m))

/** JPEG XL decode(arrayBuffer) -> ImageData. Loaded straight from the package (it finds its own wasm file next to it). */
export const jxlDecode = () => once('JPEG XL', () => import(jsd(`@jsquash/jxl@${V.jxl}/decode.js`)).then((m) => m.default))
/** JPEG XL encoder module (single-threaded build): { encode(data, width, height, options) -> Uint8Array view }. */
export const jxlEncoder = () => once('JPEG XL encoder', async () => {
  const m = await import(jsd(`@jsquash/jxl@${V.jxl}/codec/enc/jxl_enc.js`))
  return m.default({ noInitialRun: true })
})

/** OpenJPEG (JPEG 2000) wasm module with the J2KDecoder class. */
export const openjpeg = () => once('JPEG 2000', async () => {
  const base = jsd(`@cornerstonejs/codec-openjpeg@${V.openjpeg}/dist/`)
  await script(`${base}openjpegwasm_decode.js`)
  return globalThis.OpenJPEGWASM({ locateFile: (f) => base + f })
})

/** LibRaw in a Web Worker. The worker script lives on the CDN, so it is started from a same-origin blob with its own address filled in. */
export const libraw = () => once('camera RAW', async () => {
  const base = jsd(`libraw-wasm@${V.libraw}/dist/`)
  const res = await fetch(`${base}worker.js`)
  if (!res.ok) throw new Error('worker')
  const src = (await res.text()).replaceAll('import.meta.url', JSON.stringify(`${base}worker.js`))
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  const worker = new Worker(url, { type: 'module' })
  const pending = new Map()
  let next = 0
  worker.onmessage = ({ data }) => {
    const p = pending.get(data?.id)
    if (!p) return
    pending.delete(data.id)
    data.error ? p.reject(new Error(data.error)) : p.resolve(data.out)
  }
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'The RAW decoder crashed.')); pending.clear() }
  const call = (fn, ...args) => new Promise((resolve, reject) => {
    const id = next++
    pending.set(id, { resolve, reject })
    worker.postMessage({ id, fn, args }, args.filter((a) => a?.buffer instanceof ArrayBuffer).map((a) => a.buffer))
  })
  return { call, close: () => { worker.terminate(); URL.revokeObjectURL(url); cache.delete('camera RAW') } }
})
