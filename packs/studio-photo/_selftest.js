// Browser self-check for the pure logic behind Photo Studio (selections, adjustments, document geometry, undo).
// Run it from the dev tools console on the tool page:  (await import('/packs/studio-photo/_selftest.js')).run()
import { floodMask, growMask, blurArray, polyMask, makeSel, invertMask } from './_select.js'
import { curveLut, applyAdjust, adjustDefaults, ADJUSTMENTS } from './_adjust.js'
import { Doc, rasterLayer, adjustLayer } from './_doc.js'
import { renderDoc } from './_render.js'
import { rctx } from './_util.js'

const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'mismatch'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`) }
const ok = (v, msg) => { if (!v) throw new Error(msg || 'assertion failed') }

const px = (doc, x, y) => [...rctx(renderDoc(doc, { rect: { x, y, w: 1, h: 1 } })).getImageData(0, 0, 1, 1).data]
function paint(doc, layer, color, x, y, w, h) {
  const c = rctx(layer.canvas)
  c.fillStyle = color
  c.fillRect(x - layer.x, y - layer.y, w, h)
}

const TESTS = {
  'curve LUT is the identity for a straight line and hits its control points'() {
    const id = curveLut([[0, 0], [255, 255]])
    ok(id.every((v, i) => Math.abs(v - i) <= 1), 'identity')
    const c = curveLut([[0, 0], [128, 200], [255, 255]])
    ok(Math.abs(c[128] - 200) <= 1, 'passes through (128, 200)')
    for (let i = 1; i < 256; i++) ok(c[i] >= c[i - 1], 'monotone')
  },
  'blur keeps a flat image flat and spreads a spike without losing energy'() {
    const flat = new Uint8Array(30 * 20).fill(90)
    ok(blurArray(flat, 30, 20, 3).every((v) => v === 90), 'flat')
    const spike = new Uint8Array(41 * 41); spike[20 * 41 + 20] = 255
    const out = blurArray(spike, 41, 41, 2)
    const sum = out.reduce((a, b) => a + b, 0)
    ok(Math.abs(sum - 255) < 40, `energy ${sum}`)
    ok(out[20 * 41 + 20] < 255 && out[20 * 41 + 21] > 0, 'spread')
  },
  'flood select honors tolerance and contiguity'() {
    const d = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const i = (y * 4 + x) * 4; d[i + 3] = 255; if (x < 2) d[i] = 255; else d[i + 2] = 255 }
    d[(3 * 4 + 3) * 4] = 255; d[(3 * 4 + 3) * 4 + 2] = 0 // an isolated red pixel on the blue side
    eq(floodMask(d, 4, 4, 0, 0, 10, true).filter(Boolean).length, 8, 'contiguous red')
    eq(floodMask(d, 4, 4, 0, 0, 10, false).filter(Boolean).length, 9, 'all red')
  },
  'grow and shrink are inverse on a rectangle'() {
    const m = new Uint8Array(10 * 10)
    for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) m[y * 10 + x] = 255
    const big = makeSel(growMask(m, 10, 10, 1), 10, 10), small = makeSel(growMask(m, 10, 10, -1), 10, 10)
    eq([big.w, big.h], [6, 6], 'grow'); eq([small.w, small.h], [2, 2], 'shrink')
    eq(makeSel(invertMask(invertMask(m)), 10, 10).w, 4, 'double invert')
  },
  'polygon masks cover the expected area'() {
    const sel = makeSel(polyMask(20, 20, [{ x: 2, y: 2 }, { x: 18, y: 2 }, { x: 18, y: 18 }, { x: 2, y: 18 }]), 20, 20)
    eq([sel.x, sel.y, sel.w, sel.h], [2, 2, 16, 16])
  },
  'adjustments: invert twice is identity, defaults change nothing'() {
    const src = Uint8ClampedArray.from([10, 120, 250, 255, 0, 0, 0, 255])
    for (const k of Object.keys(ADJUSTMENTS)) {
      if (k === 'invert' || k === 'bw' || k === 'gradmap') continue
      const d = new Uint8ClampedArray(src); applyAdjust(d, k, adjustDefaults(k))
      ok(d.every((v, i) => Math.abs(v - src[i]) <= 2), `${k} defaults`)
    }
    const d = new Uint8ClampedArray(src); applyAdjust(d, 'invert', {}); applyAdjust(d, 'invert', {})
    eq([...d], [...src], 'invert twice')
  },
  'rotate, flip, crop and undo keep layers and pixels consistent'() {
    const doc = new Doc(6, 4)
    const L = rasterLayer(6, 4, 'Background', { bg: true }); doc.layers = [L]; doc.activeId = L.id
    paint(doc, L, '#ff0000', 0, 0, 1, 1) // top-left red
    doc.transform('cw')
    eq([doc.w, doc.h], [4, 6], 'size after rotate')
    eq(px(doc, 3, 0).slice(0, 3), [255, 0, 0], 'top-left moved to top-right')
    doc.transform('fh')
    eq(px(doc, 0, 0).slice(0, 3), [255, 0, 0], 'flip brings it back to top-left')
    doc.crop({ x: 0, y: 0, w: 2, h: 2 })
    eq([doc.w, doc.h], [2, 2], 'cropped')
    doc.hist.undo(); doc.hist.undo(); doc.hist.undo()
    eq([doc.w, doc.h, doc.layers.length], [6, 4, 1], 'all undone')
    eq(px(doc, 0, 0).slice(0, 3), [255, 0, 0], 'pixel restored')
    doc.hist.redo(); eq([doc.w, doc.h], [4, 6], 'redo works')
  },
  'pixel patches undo and redo, and adjustment layers apply through masks'() {
    const doc = new Doc(8, 8)
    const L = rasterLayer(8, 8, 'Background'); doc.layers = [L]; doc.activeId = L.id
    paint(doc, L, '#00ff00', 0, 0, 8, 8)
    doc.editPixels(L, 'layer', { x: 2, y: 2, w: 3, h: 3 }, 'test', (ctx, r) => { ctx.fillStyle = '#0000ff'; ctx.fillRect(r.x, r.y, r.w, r.h) })
    eq(px(doc, 3, 3).slice(0, 3), [0, 0, 255], 'edited')
    doc.hist.undo(); eq(px(doc, 3, 3).slice(0, 3), [0, 255, 0], 'undone')
    doc.hist.redo(); eq(px(doc, 3, 3).slice(0, 3), [0, 0, 255], 'redone')
    const A = adjustLayer('invert'); doc.addLayer(A)
    doc.addMask(A.id, 'hide')
    eq(px(doc, 3, 3).slice(0, 3), [0, 0, 255], 'hidden mask: no effect')
    doc.editPixels(A, 'mask', { x: 0, y: 0, w: 4, h: 8 }, 'mask paint', (ctx, r) => { ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h) })
    eq(px(doc, 3, 3).slice(0, 3), [255, 255, 0], 'revealed half is inverted')
    eq(px(doc, 6, 3).slice(0, 3), [0, 255, 0], 'other half untouched')
  },
}

export async function run() {
  const failed = []
  for (const [name, fn] of Object.entries(TESTS)) {
    try { await fn() } catch (e) { failed.push(`${name}: ${e.message}`) }
  }
  const total = Object.keys(TESTS).length
  console[failed.length ? 'error' : 'log'](failed.length ? `Photo Studio self-check: ${failed.length}/${total} failed\n${failed.join('\n')}` : `Photo Studio self-check: ${total}/${total} passed`)
  return { total, failed }
}
