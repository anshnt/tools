// Web Worker for the slow font engines (WOFF2 compression can take many seconds on big fonts). Messages: {id, op, args}.
import { woff2Compress, woff2Decompress, hbSubset } from './_engine.js'

const OPS = {
  woff2Compress: (bytes) => woff2Compress(bytes),
  woff2Decompress: (bytes) => woff2Decompress(bytes),
  subset: (bytes, opts) => hbSubset(bytes, opts),
}
self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    const out = await OPS[op](...args)
    self.postMessage({ id, ok: true, out }, [out.buffer])
  } catch (e) {
    self.postMessage({ id, ok: false, error: e?.message || String(e) })
  }
}
