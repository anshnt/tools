// Writes a ladder of small CDR files from the writer, from an empty page up to everything at once, so they can be opened one by one in the
// desktop application (the only thing that can really tell whether it accepts the files). If one of them fails, the one before it is the last
// feature known to be fine. The "lean" files hold the same drawings without the records that are only guessed to belong in a file.
//   node packs/corel/tests/cdrout_samples.mjs [out-dir]        (default ./cdrout-samples)
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeCdr } from '../_cdrout.js'
import { strictCheck } from './cdrout-strict.mjs'

const out = process.argv[2] || 'cdrout-samples'
mkdirSync(out, { recursive: true })
const W = 595.28, H = 841.89 // A4 in points
const rect = (x, y, w, h) => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
const k = 0.5522847498307936
const ell = (cx, cy, rx, ry) => [['M', cx + rx, cy], ['C', cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry], ['C', cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy], ['C', cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry], ['C', cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy], ['Z']]
const path = (d, o = {}) => ({ t: 'path', d, fill: null, rule: 'evenodd', stroke: null, strokeWidth: 0, ...o })
const page = (items, extra = {}) => ({ w: W, h: H, layers: [{ name: 'Layer 1', hidden: false, locked: false, printable: true, items }], ...extra })
const doc = (...pages) => ({ pages, warnings: [] })
const stops = (a, b) => [{ o: 0, c: a, a: 1 }, { o: 1, c: b, a: 1 }]

// a recognisable 64 x 64 picture without any image codec: a colour ramp with a dark frame and a transparent circle in the middle (alpha mode)
const pic = (alpha) => async () => {
  const w = 64, h = 64, data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x < 3 || y < 3 || x > w - 4 || y > h - 4, hole = alpha && Math.hypot(x - 31.5, y - 31.5) < 12
    data.set(edge ? [20, 20, 20, 255] : [x * 4, y * 4, 160, hole ? 0 : 255], (y * w + x) * 4)
  }
  return { w, h, data }
}
const photo = { t: 'image', href: 'data:image/png;base64,AAAA', w: 64, h: 64, m: [200, 0, 0, 200, 197, 321], opacity: 1 }

const samples = {
  '01-empty-page': doc(page([])),
  '02-red-square': doc(page([path(rect(247, 371, 100, 100), { fill: '#e02020' })])),
  '03-outline-and-fill': doc(page([path(rect(197, 321, 200, 200), { fill: '#ffe066', stroke: '#1a4fd6', strokeWidth: 6, dash: [12, 6], cap: 1, join: 1 })])),
  '04-curves': doc(page([
    path([['M', 150, 200], ['C', 150, 120, 300, 120, 300, 200], ['C', 300, 300, 150, 300, 150, 200], ['Z']], { fill: '#2e9e5b' }),
    path([['M', 100, 500], ['C', 200, 400, 300, 600, 400, 500]], { stroke: '#8a2be2', strokeWidth: 4, cap: 1 }),
    path([...ell(300, 700, 80, 80), ...ell(300, 700, 40, 40)], { fill: '#f08a24' })])),
  '05-gradients': doc(page([
    path(rect(97, 150, 400, 150), { fill: { g: 'linear', x1: 97, y1: 0, x2: 497, y2: 0, m: [1, 0, 0, 1, 0, 0], spread: 'pad', stops: stops('#e02020', '#2040e0') } }),
    path(ell(297, 560, 140, 140), { fill: { g: 'radial', cx: 297, cy: 560, r: 140, fx: 297, fy: 560, m: [1, 0, 0, 1, 0, 0], spread: 'pad', stops: stops('#ffffff', '#7a1fa2') } })])),
  '06-text': doc(page([
    { t: 'text', str: 'Hello CDR', family: 'Arial', size: 48, bold: false, italic: false, fill: '#202020', opacity: 1, m: [1, 0, 0, 1, 100, 200] },
    { t: 'text', str: 'Bold and italic', family: 'Times New Roman', size: 32, bold: true, italic: true, fill: '#c0392b', opacity: 1, m: [1, 0, 0, 1, 100, 300] }])),
  '07-layers-and-groups': doc(page([], { layers: [
    { name: 'Back', hidden: false, locked: false, printable: true, items: [path(rect(100, 100, 395, 200), { fill: '#cfe8ff', name: 'Sky' })] },
    { name: 'Front', hidden: false, locked: false, printable: true, items: [{ t: 'group', name: 'Pair', items: [path(rect(150, 150, 100, 100), { fill: '#e02020', name: 'Red' }), path(rect(300, 150, 100, 100), { fill: '#2040e0', name: 'Blue' })] }] }] })),
  '08-bitmap': { doc: doc(page([photo])), opts: { decodeImage: pic(false), maxDpi: 0 } },
  '09-bitmap-with-alpha': { doc: doc(page([photo])), opts: { decodeImage: pic(true), maxDpi: 0, bitmapAlpha: 'rgba' } },
  '10-two-pages': doc(page([path(rect(100, 100, 200, 200), { fill: '#e02020' })]), { w: 300, h: 200, layers: [{ name: 'Layer 1', items: [path(ell(150, 100, 100, 60), { fill: '#2040e0' })] }] }),
  '11-compressed': { doc: doc(page([], { layers: [{ name: 'Back', items: [path(rect(100, 100, 395, 200), { fill: '#cfe8ff' })] }, { name: 'Front', items: [{ t: 'group', name: 'Pair', items: [path(rect(150, 150, 100, 100), { fill: '#e02020' }), path(rect(300, 150, 100, 100), { fill: '#2040e0' })] }] }] })), opts: { compress: true } },
  '12-everything': { doc: doc(page([
    path(rect(0, 0, W, 300), { fill: { g: 'linear', x1: 0, y1: 0, x2: 0, y2: 300, m: [1, 0, 0, 1, 0, 0], spread: 'pad', stops: stops('#fff3c4', '#ffb347') } }),
    { t: 'group', name: 'Badge', items: [path(ell(300, 150, 90, 90), { fill: '#2e9e5b', stroke: '#0b3d20', strokeWidth: 5, dash: [10, 5] }), { t: 'text', str: 'CDR', family: 'Arial', size: 60, bold: true, italic: false, fill: '#ffffff', opacity: 1, m: [1, 0, 0, 1, 235, 170] }] },
    { ...photo, m: [180, 0, 0, 180, 60, 450] },
    path(rect(300, 450, 200, 180), { fill: '#8a2be2', fillOpacity: 0.5, stroke: '#4b0082', strokeWidth: 3 })])), opts: { decodeImage: pic(false), maxDpi: 0 } },
}
// the same drawings without the guessed records
for (const n of ['02-red-square', '07-layers-and-groups', '12-everything']) { const s = samples[n]; samples[n + '-lean'] = { doc: s.doc || s, opts: { ...(s.opts || {}), lean: true } } }

for (const [name, s] of Object.entries(samples)) {
  const d = s.doc || s, opts = { textToCurves: false, ...(s.opts || {}) }
  const r = await writeCdr(d, opts)
  const bytes = new Uint8Array(await r.blob.arrayBuffer())
  if (!opts.compress) strictCheck(bytes, { lean: !!opts.lean })
  writeFileSync(join(out, `${name}.cdr`), bytes)
  console.log(`${name}.cdr  ${bytes.length} bytes`)
}
