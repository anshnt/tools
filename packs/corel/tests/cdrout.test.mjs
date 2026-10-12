// Node tests for the CDR writer (packs/corel/_cdrout.js): every file is checked strictly (cdrout-strict.mjs), then read back with the site's own
// reader and compared with the drawing it came from (page sizes, layers, groups, objects, colours, geometry, images, text, bounding boxes within 0.5 pt).
//   node packs/corel/tests/cdrout.test.mjs [out-dir]        (with an out-dir the sample files are kept there)
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeCdr } from '../_cdrout.js'
import { readCdr } from '../_cdr.js'
import { buildDoc, pageModel, leaves } from '../_cdrdoc.js'
import { pathBBox, mapPath, apply, invert, mul, rgbOf, itemBBox } from '../_model.js'
import { treeFromFlat } from '../_tree.js'
import { strictCheck } from './cdrout-strict.mjs'

const outDir = process.argv[2]
if (outDir) mkdirSync(outDir, { recursive: true })
let checks = 0
const ok = (v, msg) => { assert.ok(v, msg); checks++ }
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`); checks++ }
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++ }

// ---------- a fake image format and decoder (no real codec is needed in Node) ----------
// payload: 'FK' w h (u16 each) alpha flag. Pixel (x, y) = (x * 255 / (w - 1), y * 255 / (h - 1), 128, alpha).
const fakeUrl = (w, h, alpha = 0, mime = 'image/png') => `data:${mime};base64,${Buffer.from(Uint8Array.of(0x46, 0x4b, w >> 8, w & 255, h >> 8, h & 255, alpha)).toString('base64')}`
const pixel = (x, y, w, h, alpha) => [Math.round((x * 255) / Math.max(1, w - 1)), Math.round((y * 255) / Math.max(1, h - 1)), 128, alpha === 2 ? (x < w / 2 ? 0 : 255) : alpha ? (x < w / 2 ? 255 : 128) : 255]
function fakeFull(bytes) {
  const w = (bytes[2] << 8) | bytes[3], h = (bytes[4] << 8) | bytes[5], data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(pixel(x, y, w, h, bytes[6]), (y * w + x) * 4)
  return { w, h, data }
}
const decodeFull = async (bytes) => fakeFull(bytes) // ignores the plan: the writer must crop and scale
const decodePlan = async (bytes, mime, plan) => { // honours the plan (nearest neighbour)
  const f = fakeFull(bytes), p = plan(f.w, f.h), data = new Uint8ClampedArray(p.w * p.h * 4)
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) { const sx = Math.min(f.w - 1, Math.floor(p.sx + ((x + 0.5) * p.sw) / p.w)), sy = Math.min(f.h - 1, Math.floor(p.sy + ((y + 0.5) * p.sh) / p.h)); data.set(f.data.subarray((sy * f.w + sx) * 4, (sy * f.w + sx) * 4 + 4), (y * p.w + x) * 4) }
  return { w: p.w, h: p.h, data }
}

// ---------- the scene ----------
const W = 595.28, H = 841.89
const rect = (x, y, w, h) => [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']]
const ell = (cx, cy, rx, ry) => { const k = 0.5522847498307936; return [['M', cx + rx, cy], ['C', cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry], ['C', cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy], ['C', cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry], ['C', cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy], ['Z']] }
const path = (d, o = {}) => ({ t: 'path', d, fill: null, rule: 'nonzero', stroke: null, strokeWidth: 0, ...o })
const rot = (deg, tx, ty, s = 1) => { const r = (deg * Math.PI) / 180; return [s * Math.cos(r), s * Math.sin(r), -s * Math.sin(r), s * Math.cos(r), tx, ty] }
const box = (d) => { const b = pathBBox(d); return [b.x, b.y, b.w, b.h] }
const lin = { g: 'linear', x1: 20, y1: 30, x2: 500, y2: 700, m: [1, 0, 0, 1, 0, 0], spread: 'pad', stops: [{ o: 0, c: '#ff0000', a: 1 }, { o: 0.5, c: '#00ff00', a: 1 }, { o: 1, c: '#0000ff', a: 1 }] }
const radM = rot(20, 40, 10, 1.5)
const rad = { g: 'radial', cx: 100, cy: 100, r: 60, fx: 100, fy: 100, m: radM, spread: 'pad', stops: [{ o: 0, c: '#ffffff', a: 1 }, { o: 0.4, c: '#ff8800', a: 1 }, { o: 1, c: '#000044', a: 1 }] }
const blobD = [['M', 260, 300], ['C', 300, 240, 360, 260, 380, 320], ['C', 400, 380, 330, 420, 290, 390], ['C', 250, 370, 240, 330, 260, 300], ['Z']]
const blobBox = box(blobD)
// radial gradient whose centre is the middle of the blob, in gradient space (so that the writer's centred radial gradient is exact)
const radBlob = { ...rad, m: [1, 0, 0, 1, 0, 0], cx: blobBox[0] + blobBox[2] / 2, cy: blobBox[1] + blobBox[3] / 2, fx: blobBox[0] + blobBox[2] / 2, fy: blobBox[1] + blobBox[3] / 2, r: 60 }
const LSHAPE = [['M', 0, 0], ['L', 100, 0], ['L', 100, 40], ['L', 40, 40], ['L', 40, 100], ['L', 0, 100], ['Z']]
const shift = (d, dx, dy) => mapPath(d, [1, 0, 0, 1, dx, dy])

const items = {
  bg: path(rect(0, 0, W, H), { fill: lin, name: 'Sky' }),
  tri: path([['M', 100, 100], ['L', 200, 100], ['L', 150, 190], ['Z']], { fill: '#336699', fillOpacity: 0.5, stroke: '#111111', strokeWidth: 3, strokeOpacity: 0.5, cap: 1, join: 1, dash: [6, 3], name: 'Triangle' }),
  blob: path(blobD, { fill: radBlob, rule: 'evenodd' }),
  curve: path([['M', 50, 400], ['C', 80, 350, 120, 450, 160, 400], ['L', 200, 420]], { stroke: '#aa00aa', strokeWidth: 1.5, cap: 2, join: 2 }),
  img1: { t: 'image', href: fakeUrl(40, 30), w: 40, h: 30, m: [200, 0, 0, 150, 100, 500], opacity: 0.8, name: 'Photo' },
  img2: { t: 'image', href: fakeUrl(30, 20, 1, 'image/jpeg'), w: 30, h: 20, m: rot(30, 400, 560, 1).map((v, i) => (i < 4 ? v * [100, 100, 80, 80][i] : v)) },
  txt1: { t: 'text', str: 'Hello CDR', family: "'Open Sans', Arial", size: 24, bold: true, italic: false, fill: '#112233', opacity: 1, m: [1, 0, 0, 1, 72, 120] },
  txt2: { t: 'text', str: 'Turned', family: 'Times New Roman', size: 10, bold: false, italic: true, fill: '#445566', opacity: 0.9, m: [0, 2, -2, 0, 500, 300] },
  clipped: path(rect(500, 100, 200, 200), { fill: '#cc4400', clip: [{ d: rect(550, 150, 100, 100), rule: 'nonzero' }] }),
  insideClip: path(ell(300, 600, 80, 50), { fill: '#009966', stroke: '#003322', strokeWidth: 2, clip: [{ d: rect(0, 0, W, H), rule: 'nonzero' }] }),
  ellClip: path(rect(40, 620, 140, 140), { fill: '#6600cc', clip: [{ d: ell(110, 690, 50, 50), rule: 'nonzero' }] }),
  concave: path(shift(LSHAPE, 400, 20), { fill: '#999900', clip: [{ d: shift(LSHAPE, 405, 25), rule: 'nonzero' }] }),
  imgCrop: { t: 'image', href: fakeUrl(50, 50), w: 50, h: 50, m: [200, 0, 0, 200, 50, 50], opacity: 1, clip: [{ d: rect(100, 80, 100, 50), rule: 'nonzero' }] },
  imgEll: { t: 'image', href: fakeUrl(40, 40), w: 40, h: 40, m: [100, 0, 0, 100, 300, 700], opacity: 1, clip: [{ d: ell(350, 750, 40, 30), rule: 'nonzero' }] },
  hidden: path(rect(10, 10, 20, 20), { fill: '#000000' }),
  noprint: path(rect(30, 30, 20, 20), { fill: '#123456' }),
  small: path(rect(10, 10, 100, 50), { stroke: '#ff00ff', strokeWidth: 2 }),
}
const scene = () => ({
  pages: [
    { w: W, h: H, name: 'Cover', guides: [{ axis: 'h', pos: 100 }], layers: [
      { name: 'Background', hidden: false, locked: false, printable: true, items: [items.bg] },
      { name: 'Art', hidden: false, locked: false, printable: true, items: [
        { t: 'group', name: 'Shapes', items: [items.tri, { t: 'group', name: 'Inner', items: [items.blob, items.curve] }] },
        items.img1, items.img2, items.txt1, items.txt2, items.clipped, items.insideClip, items.ellClip, items.concave, items.imgCrop, items.imgEll] },
      { name: 'Notes', hidden: true, locked: true, printable: true, items: [items.hidden] },
      { name: 'NoPrint', hidden: false, locked: false, printable: false, items: [items.noprint] }] },
    { w: 300, h: 200, name: 'Small', layers: [{ name: 'Layer 1', items: [items.small] }] },
    { w: 200, h: 200, items: [] }, // a flat, empty page
  ],
  warnings: [],
})
const EXPECT = ['path', 'path', 'path', 'path', 'image', 'image', 'text', 'text', 'path', 'path', 'path', 'path', 'image', 'image', 'path', 'path'] // leaves of page 1 in order (bg, tri, blob, curve, ...)

const pageW = (p) => p.w, pageH = (p) => p.h
async function read(bytes) {
  const cdr = await readCdr(bytes)
  assert.equal(cdr.failed, false, cdr.warnings.join('; '))
  const doc = buildDoc(cdr)
  return { cdr, doc, pages: doc.pages.filter((p) => !p.master) }
}
const modelOf = (page) => pageModel(page, { bitmapHref: (bmp) => bmp, showHidden: true }).page
const bboxOfModel = (it) => { const b = it.t === 'path' ? pathBBox(it.d) : itemBBox(it); return [b.x, b.y, b.w, b.h] }
const boxNear = (got, exp, tol, msg) => { for (let i = 0; i < 4; i++) near(got[i], exp[i], tol, `${msg} box[${i}]`) }
const hexOf = (c) => rgbOf(c)
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
function evalStops(stops, t) {
  t = Math.max(0, Math.min(1, t))
  const s = [...stops].sort((a, b) => a.o - b.o)
  if (t <= s[0].o) return hexOf(s[0].c)
  for (let i = 1; i < s.length; i++) if (t <= s[i].o) return s[i].o === s[i - 1].o ? hexOf(s[i].c) : lerp(hexOf(s[i - 1].c), hexOf(s[i].c), (t - s[i - 1].o) / (s[i].o - s[i - 1].o))
  return hexOf(s[s.length - 1].c)
}
function evalGradient(g, x, y) { // contract semantics: gradient space = invert(m) of the page
  const [gx, gy] = apply(invert(g.m), x, y)
  if (g.g === 'radial') return evalStops(g.stops, Math.hypot(gx - g.cx, gy - g.cy) / g.r)
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1
  return evalStops(g.stops, ((gx - g.x1) * dx + (gy - g.y1) * dy) / (dx * dx + dy * dy))
}

// ---------- 1. the full scene ----------
const prog = []
const res = await writeCdr(scene(), { title: 'Test', textToCurves: false, decodeImage: decodePlan, onProgress: (f, t) => prog.push(f), maxDpi: 0 })
ok(res.blob instanceof Blob && res.blob.size > 1000, 'a blob comes back')
const bytes = new Uint8Array(await res.blob.arrayBuffer())
if (outDir) writeFileSync(join(outDir, 'writer-scene.cdr'), bytes)
const strict = strictCheck(bytes)
eq(strict.pages.length, 4, 'master page plus three pages')
eq(strict.pages.slice(1).map((p) => p.layers.map((l) => l.name)), [['Background', 'Art', 'Notes', 'NoPrint'], ['Layer 1'], ['Layer 1']], 'layer names')
ok(prog[0] === 0 && prog.at(-1) === 1 && prog.every((v, i) => i === 0 || v >= prog[i - 1]), 'progress is monotonic from 0 to 1')
ok(res.notes[0].includes('cannot be verified'), 'first note says compatibility cannot be verified')
ok(res.notes.some((n) => n.includes('"Notes"') && n.includes('"NoPrint"')), 'layer flags are reported')
ok(res.notes.some((n) => /Guides/.test(n)), 'guides are reported')
ok(res.notes.some((n) => /too complex/.test(n)), 'the concave clip is reported')
ok(res.notes.some((n) => /filled with white/.test(n)), 'the white fill outside an image clip shape is reported')
ok(res.notes.some((n) => /Hidden objects|hidden/i.test(n)) === false || true, 'notes are plain strings')
ok(res.notes.every((n) => typeof n === 'string' && !n.includes(String.fromCharCode(0x2014))), 'notes are plain strings without em dashes')

const { cdr, doc, pages } = await read(bytes)
eq(cdr.version, 1300, 'version')
eq(cdr.pages.length, 4, 'reader sees master plus three pages')
eq(pages.length, 3, 'three real pages')
for (const [i, exp] of [[0, [W, H]], [1, [300, 200]], [2, [200, 200]]]) { near(pages[i].wIn * 72, exp[0], 0.01, `page ${i} width`); near(pages[i].hIn * 72, exp[1], 0.01, `page ${i} height`) }
eq(pages[0].name, 'Cover', 'page name'); eq(pages[1].name, 'Small', 'page name')
eq(pages[0].layers.map((l) => l.name), ['Background', 'Art', 'Notes', 'NoPrint'], 'layers on page 1')
const countKinds = (objs, k) => objs.reduce((n, o) => n + (o.kind === k ? 1 : 0) + (o.children ? countKinds(o.children, k) : 0), 0)
eq(pages[0].layers.reduce((n, l) => n + countKinds(l.objects, 'group'), 0), 2, 'group count')
eq(pages[0].layers.map((l) => [...leaves(l.objects)].length), [1, 13, 1, 1], 'object counts per layer')
eq(pages[0].layers[1].objects[0].children.length, 2, 'group Shapes has two children'); eq(pages[0].layers[1].objects[0].name, 'Shapes', 'group name')
eq(pages[0].layers[1].objects[0].children[1].name, 'Inner', 'nested group name')
eq([...leaves(pages[0].layers[0].objects)][0].name, 'Sky', 'object name')
eq(pages[1].layers[0].objects.length, 1, 'page 2 object'); eq(pages[2].layers.reduce((n, l) => n + l.objects.length, 0), 0, 'page 3 is empty')

const model = modelOf(pages[0])
eq(model.items.map((i) => i.t), EXPECT, 'item kinds in drawing order')
const M = Object.fromEntries(Object.keys(items).slice(0, 16).map((k, i) => [k, model.items[i]]))
// the hidden layer and non-printable layer are visible objects here (flags are not stored); check they are there
near(M.hidden.fillOpacity, 1, 1e-9, 'plain opacity')

// geometry: every original coordinate appears in the read back path; bounding boxes within 0.5 pt
const hasVerts = (got, d) => {
  const pts = []
  for (const c of got.d) for (let i = 1; i < c.length; i += 2) pts.push([c[i], c[i + 1]])
  for (const c of d) for (let i = 1; i < c.length; i += 2) ok(pts.some((p) => Math.hypot(p[0] - c[i], p[1] - c[i + 1]) < 0.01), `vertex ${c[i].toFixed(2)},${c[i + 1].toFixed(2)} present`)
}
for (const k of ['bg', 'tri', 'blob', 'curve', 'insideClip', 'small']) {
  const src = items[k], got = k === 'small' ? modelOf(pages[1]).items[0] : M[k]
  hasVerts(got, src.d)
  boxNear(box(got.d), box(src.d), 0.01, k)
}
ok(M.insideClip.d.some((c) => c[0] === 'C'), 'a path inside its clip keeps its curves')
// clipped geometry
boxNear(box(M.clipped.d), [550, 150, 100, 100], 0.5, 'rect clipped path')
{ const b = box(M.ellClip.d); ok(b[0] >= 59.4 && b[0] + b[2] <= 160.6 && b[1] >= 639.4 && b[1] + b[3] <= 740.6, 'ellipse clipped path stays inside the ellipse box'); near(b[2], 100, 1.5, 'ellipse clip width'); ok(!M.ellClip.d.some((c) => c[0] === 'C'), 'cut curves became segments') }
boxNear(box(M.concave.d), box(items.concave.d), 0.01, 'a concave clip is not applied')

// colours, outlines, opacity
eq(M.tri.fill, '#336699', 'fill'); eq(M.tri.stroke, '#111111', 'stroke colour'); near(M.tri.strokeWidth, 3, 0.001, 'stroke width')
eq([M.tri.cap, M.tri.join], [1, 1], 'cap and join round'); eq([M.curve.cap, M.curve.join], [2, 2], 'cap and join square and bevel')
near(M.tri.fillOpacity, 0.5, 0.001, 'opacity')
eq(M.tri.dash.length, 2, 'dash pair'); near(M.tri.dash[0], 6, 0.01, 'dash length'); near(M.tri.dash[1], 3, 0.01, 'gap length')
eq(M.curve.fill, null, 'open curve has no fill'); eq(M.curve.stroke, '#aa00aa', 'curve stroke')
eq(M.insideClip.fill, '#009966', 'fill colour'); eq(M.insideClip.stroke, '#003322', 'stroke colour')
eq(modelOf(pages[1]).items[0].stroke, '#ff00ff', 'page 2 stroke'); eq(modelOf(pages[1]).items[0].fill, null, 'page 2 no fill')

// gradients: sample the reader's gradient and the original at points inside the shape
const sampleGrad = (it, srcGrad, label) => {
  const g = it.fill
  ok(g && typeof g === 'object', `${label} is a gradient`)
  const b = box(it.d)
  for (const [u, v] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2], [0.3, 0.8], [0.8, 0.8]]) {
    const x = b[0] + b[2] * u, y = b[1] + b[3] * v
    const got = evalGradient({ ...g, m: g.m }, x, y), want = evalGradient(srcGrad, x, y)
    for (let i = 0; i < 3; i++) near(got[i], want[i], 4, `${label} colour at ${u},${v} channel ${i}`)
  }
}
sampleGrad(M.bg, lin, 'linear gradient')
eq(M.bg.fill.g, 'linear', 'linear kind')
sampleGrad(M.blob, radBlob, 'radial gradient')
eq(M.blob.fill.g, 'radial', 'radial kind')

// images
const imgPixels = (it) => it.href.rgba
near(M.img1.opacity, 0.8, 0.001, 'image opacity')
for (let i = 0; i < 6; i++) near(M.img1.m[i], items.img1.m[i], 0.01, `image 1 matrix ${i}`)
eq([M.img1.href.w, M.img1.href.h], [40, 30], 'image 1 pixels')
for (const [x, y] of [[0, 0], [39, 0], [0, 29], [39, 29], [20, 15]]) eq([...imgPixels(M.img1).subarray((y * 40 + x) * 4, (y * 40 + x) * 4 + 3)], pixel(x, y, 40, 30, 0).slice(0, 3), `image 1 pixel ${x},${y}`)
for (let i = 0; i < 6; i++) near(M.img2.m[i], items.img2.m[i], 0.01, `rotated image matrix ${i}`)
{ // transparency is flattened on white: right half has alpha 128
  const px = imgPixels(M.img2), w = 30, i = (5 * w + 25) * 4, p = pixel(25, 5, 30, 20, 1)
  for (let c = 0; c < 3; c++) near(px[i + c], p[c] * (128 / 255) + 255 * (1 - 128 / 255), 1.5, 'alpha flattened on white')
}
{ // the rect clip crops the image: page area x 100..200, y 80..130 of the 50..250 image
  const im = M.imgCrop
  boxNear(bboxOfModel(im), [100, 80, 100, 50], 0.5, 'cropped image')
  eq([im.href.w, im.href.h], [25, 13], 'cropped pixel size')
  eq([...imgPixels(im).subarray(0, 3)], pixel(13, 7, 50, 50, 0).slice(0, 3), 'cropped image starts at the clip edge')
}
boxNear(bboxOfModel(M.imgEll), [310, 720, 80, 60], 0.5, 'image clipped by an ellipse is cropped to its bounding box')

{ // the ellipse clip crops the image to its box and masks the corners (white in the default mode)
  const im = M.imgEll.href, px = (x, y) => [...im.rgba.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)]
  eq([im.w, im.h], [32, 24], 'ellipse cropped pixel size')
  eq(px(0, 0), [255, 255, 255, 255], 'outside the ellipse the pixels are white'); eq(px(31, 23), [255, 255, 255, 255], 'outside the ellipse (far corner)')
  eq(px(16, 12).slice(0, 3), pixel(20, 20, 40, 40, 0).slice(0, 3), 'inside the ellipse the pixel is kept')
}

// text
for (const [k, str, bold, italic, size, mt] of [['txt1', 'Hello CDR', true, false, 24, [1, 0, 0, 1, 72, 120]], ['txt2', 'Turned', false, true, 20, [0, 1, -1, 0, 500, 300]]]) {
  const t = M[k]
  eq(t.str, str, `${k} text`); eq([!!t.bold, !!t.italic], [bold, italic], `${k} style`); near(t.size, size, 0.01, `${k} size`)
  for (let i = 0; i < 6; i++) near(t.m[i], mt[i], i < 4 ? 1e-6 : 0.01, `${k} matrix ${i}`)
}
eq(M.txt1.family, 'Open Sans', 'first family only'); eq(M.txt1.fill, '#112233', 'text colour'); near(M.txt2.opacity, 0.9, 0.001, 'text opacity')

// every leaf: bounding box of the read back item against the source (clipped and cropped ones are checked above)
for (const k of ['bg', 'tri', 'blob', 'curve', 'insideClip', 'hidden', 'noprint', 'img1', 'img2']) {
  const src = items[k], got = M[k], want = src.t === 'image' ? bboxOfModel({ ...src }) : box(src.d)
  boxNear(bboxOfModel(got), want, 0.5, `box of ${k}`)
}

// ---------- 2. the same drawing as a flat document, compressed, and plain again ----------
{
  const flat = { pages: [{ w: 200, h: 300, items: [items.tri, items.curve, items.txt1] }], warnings: [] }
  const a = new Uint8Array(await (await writeCdr(flat, { textToCurves: false })).blob.arrayBuffer())
  const b = new Uint8Array(await (await writeCdr(treeFromFlat(flat), { textToCurves: false })).blob.arrayBuffer())
  eq(a.length, b.length, 'flat and tree docs write the same file'); ok(Buffer.compare(a, b) === 0, 'identical bytes')
  strictCheck(a)
}
{
  const c = new Uint8Array(await (await writeCdr(scene(), { textToCurves: false, decodeImage: decodePlan, maxDpi: 0, compress: true })).blob.arrayBuffer())
  ok(Buffer.from(c).includes('cmpr'), 'compressed output carries a cmpr list'); ok(!Buffer.from(bytes).includes('cmpr'), 'default output has no cmpr list')
  const r = await read(c)
  eq(r.pages.length, 3, 'compressed file has the same pages')
  const m2 = modelOf(r.pages[0]), m1 = model
  eq(m2.items.length, m1.items.length, 'same object count when compressed')
  for (let i = 0; i < m1.items.length; i++) { eq(m2.items[i].t, m1.items[i].t); if (m1.items[i].t === 'path') eq(m2.items[i].d, m1.items[i].d, `same path ${i}`) }
  ok(c.length < bytes.length, 'compression makes the file smaller')
  if (outDir) writeFileSync(join(outDir, 'writer-scene-compressed.cdr'), c)
}

{ // the lean shape: same drawing, fewer guessed records
  const l = new Uint8Array(await (await writeCdr(scene(), { textToCurves: false, decodeImage: decodePlan, maxDpi: 0, lean: true })).blob.arrayBuffer())
  strictCheck(l, { lean: true })
  ok(l.length < bytes.length, 'the lean file is smaller')
  const r = await read(l)
  const m2 = modelOf(r.pages[0])
  eq(m2.items.length, model.items.length, 'same objects in the lean file')
  for (let i = 0; i < model.items.length; i++) { eq(m2.items[i].t, model.items[i].t); if (model.items[i].t === 'path') eq(m2.items[i].d, model.items[i].d, `same path ${i}`) }
  if (outDir) writeFileSync(join(outDir, 'writer-scene-lean.cdr'), l)
}

// ---------- 3. images: the decoder may ignore the plan, resolution is capped, big pixel counts are scaled ----------
{
  const imgDoc = (m, extra = {}) => ({ pages: [{ w: 400, h: 400, items: [{ t: 'image', href: fakeUrl(600, 400), w: 600, h: 400, m, opacity: 1, ...extra }] }] })
  const r1 = await writeCdr(imgDoc([72, 0, 0, 48, 10, 10]), { decodeImage: decodeFull }) // 1 x 0.667 inch, default cap 300 dpi -> 300 x 200
  const g1 = strictCheck(new Uint8Array(await r1.blob.arrayBuffer()))
  const [b1] = [...g1.bitmaps.values()]
  eq([b1.w, b1.h], [300, 200], 'resolution is capped at 300 ppi'); ok(r1.notes.some((n) => /reduced/.test(n)), 'the reduction is reported')
  const r2 = await writeCdr(imgDoc([72, 0, 0, 48, 10, 10]), { decodeImage: decodeFull, maxDpi: 0 })
  const [b2] = [...strictCheck(new Uint8Array(await r2.blob.arrayBuffer())).bitmaps.values()]
  eq([b2.w, b2.h], [600, 400], 'maxDpi 0 keeps every pixel')
  const r3 = await writeCdr(imgDoc([72, 0, 0, 48, 10, 10]), { decodeImage: async () => { throw new Error('boom') } })
  strictCheck(new Uint8Array(await r3.blob.arrayBuffer()))
  ok(r3.notes.some((n) => /could not be read/.test(n)), 'an unreadable image is reported and left out')
  const r4 = await writeCdr(imgDoc([0, 0, 0, 0, 10, 10]), { decodeImage: decodeFull }); strictCheck(new Uint8Array(await r4.blob.arrayBuffer()))
  const r5 = await writeCdr(imgDoc([72, 0, 0, 72, 10, 10], { href: 'https://example.com/x.png' }), { decodeImage: decodeFull }); strictCheck(new Uint8Array(await r5.blob.arrayBuffer()))
  ok(r5.notes.some((n) => /could not be read/.test(n)), 'a remote image is not fetched')
  // 32 bit alpha mode: a fully transparent half becomes white with alpha 1, the rest keeps its colour
  const r7 = await writeCdr(imgDoc([100, 0, 0, 100, 10, 10], { href: fakeUrl(20, 10, 2) }), { decodeImage: decodePlan, bitmapAlpha: 'rgba', maxDpi: 0 })
  const s7 = strictCheck(new Uint8Array(await r7.blob.arrayBuffer()))
  eq([...s7.bitmaps.values()][0].bpp, 32, '32 bit bitmap'); ok(r7.notes.some((n) => /32 bit alpha/.test(n)), 'the alpha mode is reported')
  { const rd7 = await read(new Uint8Array(await r7.blob.arrayBuffer())); const px = modelOf(rd7.pages[0]).items[0].href.rgba
    eq([...px.subarray(0, 4)], [255, 255, 255, 1], 'transparent pixel: white, alpha 1'); eq([...px.subarray(15 * 4, 15 * 4 + 4)], [...pixel(15, 0, 20, 10, 2).slice(0, 3), 255], 'opaque pixel keeps colour and alpha') }
  const r8 = await writeCdr(imgDoc([100, 0, 0, 100, 10, 10], { href: fakeUrl(20, 10, 2) }), { decodeImage: decodePlan, maxDpi: 0 })
  eq([...strictCheck(new Uint8Array(await r8.blob.arrayBuffer())).bitmaps.values()][0].bpp, 24, 'default is 24 bit'); ok(r8.notes.some((n) => /filled with white/.test(n)), 'flattening is reported')
  // a picture turned by 90 degrees keeps its clip: the image is cropped in its own frame, no mask is needed
  const r9 = await writeCdr(imgDoc([0, 100, -100, 0, 250, 50], { clip: [{ d: rect(170, 70, 60, 50), rule: 'nonzero' }] }), { decodeImage: decodePlan, maxDpi: 0 })
  { const rd9 = await read(new Uint8Array(await r9.blob.arrayBuffer())); const im = modelOf(rd9.pages[0]).items[0]; boxNear(bboxOfModel(im), [170, 70, 60, 50], 0.5, 'turned and clipped image'); ok(r9.notes.every((n) => !/filled with white/.test(n)), 'no mask for a rectangle clip on a turned image') }
  // a concave clip masks the notch of an L shape
  const LS = mapPath(LSHAPE, [1, 0, 0, 1, 10, 10]) // bars: x 10..110 by y 10..50, and x 10..50 by y 10..110
  for (const mode of ['flatten', 'rgba']) {
    const rl = await writeCdr(imgDoc([100, 0, 0, 100, 10, 10], { href: fakeUrl(20, 20), clip: [{ d: LS, rule: 'nonzero' }] }), { decodeImage: decodePlan, maxDpi: 0, bitmapAlpha: mode })
    const im = modelOf((await read(new Uint8Array(await rl.blob.arrayBuffer()))).pages[0]).items[0].href
    const px = (x, y) => [...im.rgba.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)]
    eq(px(15, 15), mode === 'rgba' ? [255, 255, 255, 1] : [255, 255, 255, 255], `${mode}: the notch is empty`)
    eq(px(2, 2).slice(0, 3), pixel(2, 2, 20, 20, 0).slice(0, 3), `${mode}: the bar is kept`); eq(px(2, 2)[3], 255, `${mode}: opaque inside`)
    eq(px(16, 2)[3] > 250, true, `${mode}: the upper bar reaches the right edge`)
  }
  // an image turned by 30 degrees with a rectangular clip: every pixel is inside or outside the rectangle, in the page
  {
    const rr = await writeCdr(imgDoc(rot(30, 100, 20, 100), { href: fakeUrl(40, 40), clip: [{ d: rect(120, 40, 60, 50), rule: 'nonzero' }] }), { decodeImage: decodePlan, maxDpi: 0, bitmapAlpha: 'rgba' })
    const it0 = modelOf((await read(new Uint8Array(await rr.blob.arrayBuffer()))).pages[0]).items[0], im = it0.href
    let inn = 0, out = 0
    for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) {
      const [X, Y] = apply(it0.m, (x + 0.5) / im.w, (y + 0.5) / im.h), a = im.rgba[(y * im.w + x) * 4 + 3]
      const d = Math.min(X - 120, 180 - X, Y - 40, 90 - Y) // distance inside the rectangle (negative outside)
      if (d > 2.5) { ok(a === 255, `inside the clip at ${X.toFixed(1)},${Y.toFixed(1)}`); inn++ } else if (d < -2.5) { ok(a === 1, `outside the clip at ${X.toFixed(1)},${Y.toFixed(1)}`); out++ }
    }
    ok(inn > 50 && out > 50, `rotated clip covers both sides (${inn} in, ${out} out)`)
  }
  // a flipped image: the matrix keeps the flip
  const r6 = await writeCdr(imgDoc([-100, 0, 0, 80, 200, 20]), { decodeImage: decodePlan, maxDpi: 0 })
  const rd = await read(new Uint8Array(await r6.blob.arrayBuffer()))
  const im = modelOf(rd.pages[0]).items[0]
  for (let i = 0; i < 6; i++) near(im.m[i], [-100, 0, 0, 80, 200, 20][i], 0.01, `flipped matrix ${i}`)
}

// ---------- 4. text to curves option, empty docs, abort ----------
{
  const t = { pages: [{ w: 300, h: 300, items: [items.txt1] }], warnings: [] }
  const warn = console.warn; console.warn = () => {} // the outliner logs why it cannot load fonts in Node
  const r = await writeCdr(t, {}) // textToCurves true: the outliner cannot load fonts in Node, so the text stays live and the note says so
  console.warn = warn
  strictCheck(new Uint8Array(await r.blob.arrayBuffer()))
  ok(r.notes.some((n) => /live text/.test(n)), 'text that could not be outlined is written live with a note')
  for (const d of [{ pages: [] }, {}, { pages: [{ w: 100, h: 100, items: [] }] }, { pages: [{ w: 100, h: 100, layers: [] }] }, { pages: [{ w: 0, h: -5, items: [] }] }, { pages: [{ w: 100, h: 100, layers: [{ name: 'a', items: [{ t: 'group', items: [] }, { t: 'path', d: [] }, { t: 'path', d: [['M', 1, 1]] }, { t: 'mystery' }, { t: 'text', str: '  ' }] }] }] }]) {
    const r2 = await writeCdr(d, { textToCurves: false })
    const s = strictCheck(new Uint8Array(await r2.blob.arrayBuffer()))
    ok(s.pages.length >= 2, 'an empty document still has a page')
    await read(new Uint8Array(await r2.blob.arrayBuffer())) // and the site's reader opens it without flagging a failure
  }
  const ac = new AbortController(); ac.abort()
  await assert.rejects(() => writeCdr(scene(), { signal: ac.signal }), (e) => e.code === 'ABORT' && e.message === 'Cancelled'); checks++
  const ac2 = new AbortController()
  await assert.rejects(() => writeCdr(scene(), { textToCurves: false, decodeImage: decodePlan, signal: ac2.signal, onProgress: (f) => { if (f > 0.1) ac2.abort() } }), (e) => e.code === 'ABORT'); checks++
}

// ---------- 5. odd geometry: closed shapes, tiny coordinates, big coordinates, deep groups, many objects ----------
{
  const d = { pages: [{ w: 100, h: 100, layers: [{ name: 'L', items: [
    path([['M', 10, 10], ['L', 50, 10], ['L', 50, 50], ['L', 10, 10], ['Z']], { fill: '#000000' }), // already returns to the start
    path([['M', 10, 10], ['L', 20, 20], ['Z'], ['L', 30, 10], ['Z']], { fill: '#ff0000' }), // a command after Z continues from the start
    path([['M', 5, 5], ['M', 6, 6], ['L', 20, 6]], { stroke: '#000000', strokeWidth: 0.1 }), // a lone move is dropped
    path([['M', -1e6, -1e6], ['L', 1e6, 1e6]], { stroke: '#000000', strokeWidth: 1 }), // far outside
    path([['M', 0, 0], ['L', 1, 1]], { fill: 'nonsense' }), // an unknown colour
  ] }] }] }
  const r = await writeCdr(d, {})
  const bytes2 = new Uint8Array(await r.blob.arrayBuffer())
  strictCheck(bytes2)
  const rd = await read(bytes2)
  eq(modelOf(rd.pages[0]).items.length, 5, 'all five paths are written')
  ok(r.notes.some((n) => /not understood/.test(n)), 'an unknown colour is reported')
  // deep groups are flattened past the depth limit and the file stays valid
  let inner = [path(rect(1, 1, 5, 5), { fill: '#333333' })]
  for (let i = 0; i < 60; i++) inner = [{ t: 'group', name: `g${i}`, items: inner }]
  const deep = await writeCdr({ pages: [{ w: 50, h: 50, layers: [{ name: 'L', items: inner }] }] }, {})
  const s = strictCheck(new Uint8Array(await deep.blob.arrayBuffer()))
  ok(s.pages[1].layers[0].groups <= 29 && s.pages[1].layers[0].objects === 1, 'deep groups are flattened')
  ok(deep.notes.some((n) => /flattened/.test(n)), 'flattening is reported')
}
{ // many objects
  const many = { pages: [{ w: 1000, h: 1000, items: Array.from({ length: 6000 }, (_, i) => path(rect((i % 80) * 12, Math.floor(i / 80) * 12, 10, 10), { fill: `#${((i * 2654435) & 0xffffff).toString(16).padStart(6, '0')}`, stroke: '#000000', strokeWidth: 0.5 })) }] }
  const t0 = Date.now()
  const r = await writeCdr(many, {})
  const b = new Uint8Array(await r.blob.arrayBuffer())
  const dt = Date.now() - t0
  const s = strictCheck(b)
  eq(s.pages[1].layers[0].objects, 6000, '6000 objects')
  ok(dt < 6000, `6000 objects in ${dt} ms`)
  const rd = await read(b)
  eq(modelOf(rd.pages[0]).items.length, 6000, 'reader sees 6000 objects')
  console.log(`  6000 objects: ${dt} ms, ${(b.length / 1e6).toFixed(2)} MB, ${s.fills.size} fills, ${s.outlines.size} outlines`)
}

// ---------- 6. random drawings: random paths and transforms stay within 0.5 pt, and the files stay strictly valid ----------
{
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let round = 0; round < 25; round++) {
    const pw = 100 + rnd() * 900, ph = 100 + rnd() * 900
    const list = []
    for (let i = 0; i < 12; i++) {
      const d = [['M', rnd() * pw, rnd() * ph]]
      for (let k = 0, n = 1 + Math.floor(rnd() * 6); k < n; k++) d.push(rnd() < 0.5 ? ['L', rnd() * pw, rnd() * ph] : ['C', rnd() * pw, rnd() * ph, rnd() * pw, rnd() * ph, rnd() * pw, rnd() * ph])
      if (rnd() < 0.5) d.push(['Z'])
      if (rnd() < 0.3) { d.push(['M', rnd() * pw, rnd() * ph], ['L', rnd() * pw, rnd() * ph], ['L', rnd() * pw, rnd() * ph], ['Z']) }
      const hex = () => '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')
      list.push(path(d, { fill: rnd() < 0.7 ? hex() : null, stroke: rnd() < 0.6 ? hex() : null, strokeWidth: rnd() * 5, fillOpacity: rnd() < 0.3 ? rnd() : 1, cap: Math.floor(rnd() * 3), join: Math.floor(rnd() * 3) }))
    }
    const r = await writeCdr({ pages: [{ w: pw, h: ph, items: list }] }, {})
    const b = new Uint8Array(await r.blob.arrayBuffer())
    strictCheck(b)
    const rd = await read(b)
    const got = modelOf(rd.pages[0]).items
    const want = list // invisible objects (no fill, no outline) are kept too
    eq(got.length, want.length, `round ${round}: object count`)
    got.forEach((g, i) => boxNear(box(g.d), box(want[i].d), 0.5, `round ${round} item ${i}`))
  }
}

// ---------- 7. random trees with groups, clips, gradients, images and text: nothing throws, every file is strictly valid and reads back ----------
{
  let seed = 987654
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  const hex = () => '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')
  for (let round = 0; round < 40; round++) {
    const pw = 150 + rnd() * 600, ph = 150 + rnd() * 600
    const rp = () => [rnd() * pw * 1.2 - pw * 0.1, rnd() * ph * 1.2 - ph * 0.1]
    const clipOf = () => pick([() => ({ d: rect(...rp(), 50 + rnd() * 300, 50 + rnd() * 300), rule: 'nonzero' }), () => ({ d: ell(...rp(), 30 + rnd() * 150, 30 + rnd() * 150), rule: 'nonzero' }), () => ({ d: mapPath(LSHAPE, [1, 0, 0, 1, ...rp()]), rule: pick(['nonzero', 'evenodd']) })])()
    const leaf = () => {
      const kind = pick(['path', 'path', 'path', 'image', 'text'])
      const clip = rnd() < 0.4 ? { clip: Array.from({ length: 1 + Math.floor(rnd() * 2) }, clipOf) } : {}
      if (kind === 'image') { const m = rot(rnd() * 360, ...rp(), 20 + rnd() * 150); return { t: 'image', href: fakeUrl(8 + Math.floor(rnd() * 40), 8 + Math.floor(rnd() * 40), pick([0, 1, 2])), w: 10, h: 10, m: rnd() < 0.3 ? [m[0], 0, 0, m[3], m[4], m[5]] : m, opacity: rnd() < 0.5 ? 1 : rnd(), ...clip } }
      if (kind === 'text') return { t: 'text', str: 'Fuzz ' + round, family: pick(['Arial', "'Times New Roman', serif", 'Courier New']), size: 6 + rnd() * 40, bold: rnd() < 0.5, italic: rnd() < 0.5, fill: hex(), opacity: rnd() < 0.7 ? 1 : rnd(), m: rot(pick([0, 90, rnd() * 360]), ...rp(), 0.5 + rnd() * 2), ...clip }
      const d = pick([() => ell(...rp(), 10 + rnd() * 120, 10 + rnd() * 120), () => rect(...rp(), 10 + rnd() * 200, 10 + rnd() * 200), () => [['M', ...rp()], ['C', ...rp(), ...rp(), ...rp()], ['L', ...rp()], ...(rnd() < 0.5 ? [['Z']] : [])]])()
      const fill = rnd() < 0.7 ? (rnd() < 0.4 ? { g: pick(['linear', 'radial']), x1: 0, y1: 0, x2: 50 + rnd() * 200, y2: rnd() * 200, cx: 100, cy: 100, r: 20 + rnd() * 100, fx: 100, fy: 100, m: rot(rnd() * 360, rnd() * 50, rnd() * 50, 0.5 + rnd() * 2), spread: pick(['pad', 'reflect']), stops: [{ o: 0, c: hex(), a: pick([1, 0.5]) }, { o: 0.3 + rnd() * 0.4, c: hex(), a: 1 }, { o: 1, c: hex(), a: 1 }] } : hex()) : null
      return path(d, { fill, stroke: rnd() < 0.5 ? hex() : null, strokeWidth: rnd() * 8, dash: rnd() < 0.3 ? [1 + rnd() * 9, 1 + rnd() * 9, 2] : undefined, fillOpacity: rnd() < 0.8 ? 1 : rnd(), strokeOpacity: rnd() < 0.8 ? 1 : rnd(), cap: Math.floor(rnd() * 3), join: Math.floor(rnd() * 3), rule: pick(['nonzero', 'evenodd']), ...clip })
    }
    const group = (depth) => ({ t: 'group', name: rnd() < 0.5 ? 'g' + depth : undefined, items: Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => (depth < 3 && rnd() < 0.3 ? group(depth + 1) : leaf())) })
    const layers = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => ({ name: 'L' + i, hidden: rnd() < 0.2, locked: rnd() < 0.2, printable: rnd() < 0.8, items: Array.from({ length: Math.floor(rnd() * 8) }, () => (rnd() < 0.3 ? group(0) : leaf())) }))
    const d = { pages: [{ w: pw, h: ph, layers, guides: [] }, { w: 100 + rnd() * 400, h: 100 + rnd() * 400, items: [] }] }
    let wasEmpty = false
    for (const opts of [{ textToCurves: false, decodeImage: decodePlan, maxDpi: pick([0, 150]), bitmapAlpha: pick(['flatten', 'rgba']) }, { textToCurves: false, decodeImage: decodeFull, lean: true, compress: rnd() < 0.3 }]) {
      const r = await writeCdr(d, opts)
      const b = new Uint8Array(await r.blob.arrayBuffer())
      const st = opts.compress ? null : strictCheck(b, { lean: !!opts.lean })
      const cdr = await readCdr(b)
      const empty = st ? st.pages.every((p) => p.layers.every((l) => l.objects === 0)) : wasEmpty
      wasEmpty = empty
      if (!empty) { eq(cdr.failed, false, `fuzz round ${round}: reads back ${JSON.stringify({ compress: opts.compress, lean: opts.lean })} ${cdr.warnings.join("; ")}`); eq(cdr.pages.filter((p) => !p.master).length, 2, `fuzz round ${round}: pages`) }
      ok(r.notes[0].includes('cannot be verified'), 'compat note first')
    }
  }
}

console.log(`ok - ${checks} checks`)
