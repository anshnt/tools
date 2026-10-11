// Node tests for the PostScript reader (_psin.js). No browser, no network, no downloads: every fixture is generated here.
//   node packs/corel/tests/psin.test.mjs [dir with extra sample files: tiny.eps multi.eps legacy.ai bad-truncated.eps]
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync, deflateSync } from 'node:zlib'
import { psToDoc, isPostScript } from '../_psin.js'
import { toEps } from '../_eps.js'
import { rectPath, ellipsePath, pathBBox, itemBBox } from '../_model.js'

const tests = []
const test = (name, fn) => tests.push([name, fn])
const bytes = (s) => Uint8Array.from(Buffer.from(s, 'latin1'))
const COLOR = /^#[0-9a-f]{6}$/
const fin = (v, what) => assert.ok(Number.isFinite(v), `${what} must be a finite number, got ${v}`)
const ARITY = { M: 3, L: 3, C: 7, Z: 1 }
/** The contract the editor validates against (PLAN section 11.2), checked on everything this reader returns. */
function validate(doc) {
  assert.ok(Array.isArray(doc.pages) && doc.pages.length >= 1 && Array.isArray(doc.warnings))
  assert.ok(doc.warnings.every((w) => typeof w === 'string' && w.length > 5 && !w.includes(String.fromCharCode(0x2014))))
  assert.equal(doc.fonts, undefined, 'no fonts are embedded')
  for (const p of doc.pages) {
    fin(p.w); fin(p.h); assert.ok(p.w >= 1 && p.w <= 20000 && p.h >= 1 && p.h <= 20000)
    for (const it of p.items) {
      for (const c of it.clip || []) { assert.ok(it.clip.length <= 16); assert.ok(['nonzero', 'evenodd'].includes(c.rule)); for (const cmd of c.d) { assert.equal(cmd.length, ARITY[cmd[0]]); cmd.slice(1).forEach((v) => fin(v, 'clip')) } }
      if (it.t === 'path') {
        assert.ok(it.d.length > 0 && it.d[0][0] === 'M', 'a path starts with a move')
        for (const cmd of it.d) { assert.equal(cmd.length, ARITY[cmd[0]], cmd[0]); cmd.slice(1).forEach((v) => fin(v, 'path')) }
        assert.ok(it.fill === null || COLOR.test(it.fill)); assert.ok(it.stroke === null || COLOR.test(it.stroke)); assert.ok(it.fill || it.stroke)
        assert.ok(['nonzero', 'evenodd'].includes(it.rule)); fin(it.strokeWidth)
        if (it.stroke) { assert.ok(it.strokeWidth > 0); assert.ok([0, 1, 2].includes(it.cap) && [0, 1, 2].includes(it.join)); assert.ok(it.miter >= 1); assert.ok(it.dash.length % 2 === 0 && it.dash.every((v) => v >= 0 && Number.isFinite(v))); fin(it.dashOffset) }
      } else if (it.t === 'text') {
        assert.ok(typeof it.str === 'string' && it.str.length > 0 && it.size > 0 && COLOR.test(it.fill) && it.m.length === 6); it.m.forEach((v) => fin(v, 'text m'))
      } else {
        assert.equal(it.t, 'image'); assert.match(it.href, /^data:image\/(png|jpeg);base64,/); assert.ok(Number.isInteger(it.w) && Number.isInteger(it.h) && it.w > 0 && it.h > 0); assert.equal(it.m.length, 6); it.m.forEach((v) => fin(v, 'image m'))
      }
    }
  }
}
const read = async (s, opts) => { const r = await psToDoc(bytes(s), opts); validate(r); return r }
const near = (a, b, tol = 0.51, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`)
const boxNear = (a, b, tol = 0.51, msg = '') => { for (const k of ['x', 'y', 'w', 'h']) near(a[k], b[k], tol, `${msg}.${k}`) }
const head = (w, h, extra = '') => `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${w} ${h}\n%%EndComments\n${extra}\n`
const a85 = (b) => {
  let out = ''
  for (let i = 0; i < b.length; i += 4) {
    const n = Math.min(4, b.length - i)
    let v = 0
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? b[i + k] : 0)
    if (n === 4 && v === 0) { out += 'z'; continue }
    const ch = []
    for (let k = 4; k >= 0; k--) { ch[k] = String.fromCharCode(33 + (v % 85)); v = Math.floor(v / 85) }
    out += ch.slice(0, n + 1).join('')
  }
  return out + '~>'
}
const hexOf = (b) => Buffer.from(b).toString('hex') + '>'
/** Decode a PNG data URL (filter 0 or None only, 8-bit RGB/RGBA) to {w, h, ch, px}. */
function decodePng(href) {
  assert.match(href, /^data:image\/png;base64,/)
  const b = Buffer.from(href.split(',')[1], 'base64')
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  let o = 8, w = 0, h = 0, ct = 0
  const idat = []
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    if (type === 'IDAT') idat.push(data)
    o += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat)), ch = ct === 6 ? 4 : 3, px = Buffer.alloc(w * h * ch)
  for (let y = 0; y < h; y++) { assert.equal(raw[y * (w * ch + 1)], 0, 'filter byte'); raw.copy(px, y * w * ch, y * (w * ch + 1) + 1, (y + 1) * (w * ch + 1)) }
  return { w, h, ch, px }
}
const paths = (doc, i = 0) => doc.pages[i].items.filter((x) => x.t === 'path')

// ---------- isPostScript ----------
test('isPostScript: text, DOS header, BOM, printer-job prefix, and what it must refuse', () => {
  assert.equal(isPostScript(bytes('%!PS-Adobe-3.0\n')), true)
  assert.equal(isPostScript(bytes('%!PS-Adobe-3.0 EPSF-3.0\n')), true)
  assert.equal(isPostScript(bytes('\n\n  %!PS\n')), true)
  assert.equal(isPostScript(bytes('\xef\xbb\xbf%!PS\n')), true)
  assert.equal(isPostScript(Uint8Array.of(0xc5, 0xd0, 0xd3, 0xc6, 30, 0, 0, 0)), true)
  assert.equal(isPostScript(bytes('\x1b%-12345X@PJL\n%!PS-Adobe\n')), true)
  assert.equal(isPostScript(bytes('%PDF-1.5\n')), false)
  assert.equal(isPostScript(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')), false)
  assert.equal(isPostScript(bytes('')), false)
  assert.equal(isPostScript(null), false)
  assert.equal(isPostScript(new Uint8Array(100000).fill(0x20)), false)
  assert.equal(isPostScript(bytes('%!PS\n').buffer), true)
})

// ---------- writer round trip ----------
const pageDoc = () => ({ pages: [{ w: 200, h: 150, items: [
  { t: 'path', d: rectPath(10, 10, 80, 50), fill: '#336699', fillOpacity: 1, rule: 'nonzero', stroke: null, strokeWidth: 0 },
  { t: 'path', d: ellipsePath(140, 40, 30, 20), fill: '#ff8800', fillOpacity: 1, rule: 'nonzero', stroke: '#000000', strokeWidth: 3, strokeOpacity: 1, cap: 1, join: 2, miter: 6, dash: [4, 2], dashOffset: 1 },
  { t: 'path', d: [...rectPath(20, 80, 100, 50), ...rectPath(40, 90, 30, 20)], fill: '#00aa00', fillOpacity: 1, rule: 'evenodd', stroke: null, strokeWidth: 0 },
  { t: 'path', d: rectPath(130, 90, 60, 40), fill: '#aa0000', fillOpacity: 1, rule: 'nonzero', stroke: null, strokeWidth: 0, clip: [{ d: ellipsePath(160, 110, 25, 25), rule: 'nonzero' }] },
  { t: 'path', d: [['M', 5, 140], ['L', 60, 148], ['C', 80, 140, 90, 148, 100, 142]], fill: null, rule: 'nonzero', stroke: '#2244ff', strokeWidth: 1.5, strokeOpacity: 1, cap: 0, join: 0, miter: 4 },
  { t: 'text', str: 'Hello World', family: 'Helvetica', size: 14, bold: true, italic: false, fill: '#222222', opacity: 1, m: [1, 0, 0, 1, 12, 75] },
  { t: 'text', str: 'Tilted', family: 'Times', size: 10, bold: false, italic: true, fill: '#880000', opacity: 1, m: [0.866, 0.5, -0.5, 0.866, 140, 70] },
] }], warnings: [] })

test('round trip of the repo EPS writer: page size, item count, boxes, paint, clip, text', async () => {
  const doc = pageDoc()
  const { text } = await toEps(doc, 0, { title: 'x' })
  const r = await read(text)
  assert.equal(r.pages.length, 1)
  assert.deepEqual([r.pages[0].w, r.pages[0].h], [200, 150])
  const src = doc.pages[0].items, got = r.pages[0].items
  assert.equal(got.length, src.length, 'fill and stroke of one path read back as one object')
  src.forEach((it, i) => {
    const g = got[i]
    assert.equal(g.t, it.t, `item ${i} type`)
    if (it.t === 'path') {
      boxNear(itemBBox(g), itemBBox(it), 0.51, `item ${i} box`)
      assert.equal(g.fill, it.fill, `item ${i} fill`)
      assert.equal(g.stroke || null, it.stroke || null, `item ${i} stroke`)
      if (it.fill) assert.equal(g.rule, it.rule, `item ${i} rule`)
      if (it.stroke) {
        near(g.strokeWidth, it.strokeWidth, 0.01); assert.equal(g.cap, it.cap || 0); assert.equal(g.join, it.join || 0); near(g.miter, it.miter || 4, 0.01)
        assert.deepEqual(g.dash, it.dash || []); near(g.dashOffset, it.dashOffset || 0, 0.01)
      }
      if (it.clip) { assert.equal(g.clip.length, 1); boxNear(pathBBox(g.clip[0].d), pathBBox(it.clip[0].d), 0.51, 'clip box') } else assert.equal(g.clip, undefined, 'the page clip is not an object clip')
    } else {
      assert.equal(g.str, it.str); assert.equal(g.family, it.family); near(g.size, it.size, 0.01); assert.equal(g.bold, it.bold); assert.equal(g.italic, it.italic); assert.equal(g.fill, it.fill)
      g.m.forEach((v, k) => near(v, it.m[k], 0.01, `text m[${k}]`))
    }
  })
})
test('round trip is stable: read, write, read again gives the same objects', async () => {
  const a = await read((await toEps(pageDoc(), 0)).text)
  const b = await read((await toEps(a, 0)).text)
  assert.equal(b.pages[0].items.length, a.pages[0].items.length)
  a.pages[0].items.forEach((it, i) => {
    const o = b.pages[0].items[i]
    assert.equal(o.t, it.t)
    if (it.t === 'path') boxNear(itemBBox(o), itemBBox(it), 0.02, `item ${i}`)
  })
})
test('round trip: page size and a rotated or scaled page position', async () => {
  const doc = { pages: [{ w: 333.5, h: 120.25, items: [{ t: 'path', d: rectPath(0, 0, 333.5, 120.25), fill: '#112233', rule: 'nonzero', stroke: null, strokeWidth: 0 }] }], warnings: [] }
  const r = await read((await toEps(doc, 0)).text)
  near(r.pages[0].w, 333.5, 0.01); near(r.pages[0].h, 120.25, 0.01)
  boxNear(pathBBox(r.pages[0].items[0].d), { x: 0, y: 0, w: 333.5, h: 120.25 }, 0.01)
  assert.equal(r.pages[0].items[0].clip, undefined)
})

// ---------- sample files (outside the repo; skipped when absent) ----------
const samples = process.argv[2] || 'C:/Projects/tools-packs/draw-studio-tests'
test('sample files: tiny.eps, multi.eps, legacy.ai, bad-truncated.eps', async () => {
  if (!existsSync(join(samples, 'tiny.eps'))) { console.log('  (sample files not found, skipped)'); return }
  const f = (n) => readFileSync(join(samples, n))
  let r = await psToDoc(f('tiny.eps'))
  assert.deepEqual([r.pages.length, r.pages[0].w, r.pages[0].h], [1, 100, 100])
  assert.equal(r.pages[0].items.length, 2)
  boxNear(pathBBox(r.pages[0].items[0].d), { x: 10, y: 10, w: 80, h: 80 }, 0.01)
  boxNear(pathBBox(r.pages[0].items[1].d), { x: 20, y: 20, w: 60, h: 60 }, 0.01)
  assert.equal(r.pages[0].items[0].fill, '#e63333'); assert.equal(r.pages[0].items[1].stroke, '#0066cc')
  r = await psToDoc(f('multi.eps'))
  assert.equal(r.pages.length, 2); assert.equal(r.pages[0].items.length, 1); assert.equal(r.pages[1].items[0].fill, '#800080')
  r = await psToDoc(f('legacy.ai'))
  assert.deepEqual([r.pages[0].w, r.pages[0].h, r.pages[0].items.length], [300, 200, 3])
  assert.deepEqual(r.pages[0].items[2].dash, [6, 3]); assert.equal(r.pages[0].items[2].cap, 1); assert.equal(r.pages[0].items[2].join, 1)
  await assert.rejects(psToDoc(f('bad-truncated.eps')), /cut short/)
})

// ---------- language ----------
test('procedures, bind, loops, exit, stopped, dictionaries', async () => {
  const r = await read(head(200, 100, `
/box { /h exch def /w exch def /y exch def /x exch def newpath x y moveto w 0 rlineto 0 h rlineto w neg 0 rlineto closepath } bind def
0 1 4 { /i exch def i 0.2 mul 0.5 0.5 setrgbcolor i 40 mul 10 30 30 box fill } for
3 { 0 0 1 setrgbcolor 5 5 10 10 box fill } repeat
/n 0 def { /n n 1 add def n 5 gt { exit } if } loop
n 6 eq { 1 0 0 setrgbcolor 150 50 20 20 box fill } if
{ undefinedthing } stopped { 0 1 0 setrgbcolor 170 50 20 20 box fill } if
/d 3 dict def d /a 1 put d /b 2 put d /c 4 put
0 d { exch pop add } forall 7 eq { 0 setgray 100 60 5 5 box fill } if
showpage`))
  const p = paths(r)
  assert.equal(p.length, 5 + 3 + 1 + 1 + 1)
  boxNear(pathBBox(p[0].d), { x: 0, y: 60, w: 30, h: 30 }, 0.01)
  boxNear(pathBBox(p[4].d), { x: 160, y: 60, w: 30, h: 30 }, 0.01)
  assert.equal(p[5].fill, '#0000ff')
  boxNear(pathBBox(p[8].d), { x: 150, y: 30, w: 20, h: 20 }, 0.01); assert.equal(p[8].fill, '#ff0000')
  assert.equal(p[9].fill, '#00ff00')
  assert.equal(p[10].fill, '#000000')
  assert.deepEqual(r.warnings, [])
})
test('arithmetic, stack, string and array operators give the right numbers', async () => {
  const cases = [
    ['7 3 idiv', 2], ['-7 3 idiv', -2], ['7 3 mod', 1], ['-7 3 mod', -1], ['2 10 exp', 1024], ['16 sqrt', 4], ['3 4 atan', 36.87], ['1.5 round', 2], ['-1.5 round', -1],
    ['2.7 truncate', 2], ['-2.7 ceiling', -2], ['5 2 div', 2.5], ['1 2 3 3 1 roll pop pop', 3], ['1 2 3 4 4 2 roll pop pop pop', 3], ['(abc) length', 3], ['[1 2 3] 1 get', 2],
    ['(hello) 1 get', 101], ['/a 5 def a 2 mul', 10], ['true {7} {8} ifelse', 7], ['1 2 3 add add', 6], ['5 dup mul', 25], ['3 4 exch sub', 1], ['10 3 {1 sub} repeat', 7],
    ['0 1 1 5 {add} for', 15], ['(12) cvi', 12], ['(3.5) cvr', 3.5], ['[4 5 6] aload pop add add', 15], ['/s 5 string def s 0 65 put s 0 get', 65], ['3 array length', 3],
    ['<< /a 5 >> /a get', 5], ['1 dict dup /k 9 put /k get', 9], ['/x 3 def /x load 4 mul', 12], ['16#FF', 255], ['2#101', 5], ['1e2', 100], ['.5 2 mul', 1], ['-.5 -2 mul', 1],
    ['1 4 bitshift', 16], ['255 -4 bitshift', 15], ['5 3 and', 1], ['5 3 or', 7], ['5 3 xor', 6], ['true false or {1}{0} ifelse', 1], ['/sq {dup mul} def 7 sq', 49],
    ['/fact {dup 1 le {pop 1} {dup 1 sub fact mul} ifelse} def 5 fact', 120], ['{1 0 div} stopped {5}{6} ifelse', 5], ['(abcd) 1 2 getinterval length', 2],
    ['0 1 1 10 {dup 4 gt {pop exit} if add} for', 10], ['mark 1 2 3 counttomark exch pop exch pop exch pop exch pop', 3], ['(a) (b) eq {1}{0} ifelse', 0], ['/n (n) cvn eq {1}{0} ifelse', 1],
    ['5 -3 abs add', 8], ['[1 2 3] dup 0 9 put 0 get', 9], ['(%stdin) length', 6], ['1 2 3 4 3 index', 1], ['1 2 3 3 copy add add add add add', 12], ['12 string 255 12 string cvs length', 3],
  ]
  const body = cases.map(([e]) => `${e} t`).join('\n')
  const r = await read(head(2000, 100, `/t { 0 moveto 0 5 rlineto stroke } def\n${body}\nshowpage`))
  const p = paths(r)
  assert.equal(p.length, cases.length, r.warnings.join('; '))
  cases.forEach(([e, v], i) => near(p[i].d[0][1], v, 0.0011, e))
})
test('matrices, rotate, scale, translate, concat, setmatrix, transform operators', async () => {
  const r = await read(head(200, 100, `
gsave 100 50 translate 30 rotate 0 0 20 10 rectfill grestore
gsave [2 0 0 3 5 5] concat 1 1 10 10 rectfill grestore
gsave 3 4 scale 0 0 1 1 rectfill grestore
/m matrix def gsave 10 20 translate 2 2 scale m currentmatrix pop m 4 get m 5 get gsave 0 0 moveto 1 1 rlineto stroke grestore grestore
10 20 transform 2 copy pop pop pop pop
showpage`))
  const p = paths(r)
  const c30 = Math.cos(Math.PI / 6), s30 = Math.sin(Math.PI / 6)
  const pt = (x, y) => [100 + c30 * x - s30 * y, 100 - (50 + s30 * x + c30 * y)]
  const corners = [pt(0, 0), pt(20, 0), pt(20, 10), pt(0, 10)]
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1])
  boxNear(pathBBox(p[0].d), { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, 0.01)
  boxNear(pathBBox(p[1].d), { x: 7, y: 62, w: 20, h: 30 }, 0.01)
  boxNear(pathBBox(p[2].d), { x: 0, y: 96, w: 3, h: 4 }, 0.01)
  near(p[3].strokeWidth, 2, 0.001)
})
test('arc, arcn, arcto, curve and relative operators', async () => {
  const r = await read(head(200, 200, `
newpath 100 100 50 0 90 arc stroke
newpath 100 100 40 90 0 arcn stroke
newpath 10 10 moveto 100 10 100 100 20 arcto 4 {pop} repeat 100 100 lineto stroke
newpath 20 150 moveto 10 0 20 20 30 0 rcurveto 0 -20 rlineto closepath fill
showpage`))
  const p = paths(r)
  assert.equal(p.length, 4)
  boxNear(pathBBox(p[0].d), { x: 100, y: 50, w: 50, h: 50 }, 0.01) // quarter arc ccw from 0 to 90 degrees: right and up in PS, up on the page
  boxNear(pathBBox(p[1].d), { x: 100, y: 60, w: 40, h: 40 }, 0.01)
  assert.ok(p[2].d.some((c) => c[0] === 'C'), 'arcto draws a curve')
  assert.deepEqual(p[3].d.at(-1), ['Z'])
})
test('clipping: clip, eoclip, rectclip, nested clips, the page-sized clip is dropped', async () => {
  const r = await read(head(100, 100, `
gsave 10 10 50 50 rectclip 0 0 100 100 rectfill grestore
gsave newpath 0 0 moveto 100 0 lineto 100 100 lineto 0 100 lineto closepath clip newpath 0 setgray 5 5 5 5 rectfill grestore
gsave newpath 20 20 moveto 80 20 lineto 80 80 lineto 20 80 lineto closepath 40 40 moveto 60 40 lineto 60 60 lineto 40 60 lineto closepath eoclip newpath
  gsave 30 30 40 40 rectclip 1 0 0 setrgbcolor 0 0 100 100 rectfill grestore grestore
0 0 10 10 rectfill`))
  const p = paths(r)
  assert.equal(p[0].clip.length, 1); boxNear(pathBBox(p[0].clip[0].d), { x: 10, y: 40, w: 50, h: 50 }, 0.01)
  assert.equal(p[1].clip, undefined)
  assert.equal(p[2].clip.length, 2); assert.equal(p[2].clip[0].rule, 'evenodd')
  assert.equal(p[3].clip, undefined)
})
test('colour spaces: gray, rgb, cmyk, hsb, indexed, separation, setcolor', async () => {
  const r = await read(head(100, 100, `
0.5 setgray 0 0 1 1 rectfill 1 0.5 0 setrgbcolor 0 0 1 1 rectfill 0 1 1 0 setcmykcolor 0 0 1 1 rectfill 0 1 1 sethsbcolor 0 0 1 1 rectfill
[/Indexed /DeviceRGB 1 <FF0000 0000FF>] setcolorspace 1 setcolor 0 0 1 1 rectfill
[/Separation /Spot /DeviceCMYK {0 exch 0 exch 0 exch pop 1 exch pop 0 0 0 4 -1 roll}] setcolorspace 0.5 setcolor 0 0 1 1 rectfill
/DeviceRGB setcolorspace 0 1 0 setcolor 0 0 1 1 rectfill`))
  const f = paths(r).map((x) => x.fill)
  assert.equal(f[0], '#808080'); assert.equal(f[1], '#ff8000'); assert.equal(f[2], '#ff0000'); assert.equal(f[3], '#ff0000'); assert.equal(f[4], '#0000ff'); assert.equal(f[6], '#00ff00')
  assert.match(f[5], /^#[0-9a-f]{6}$/)
})
test('save, restore, gsave, grestore keep state apart; initgraphics and showpage reset', async () => {
  const r = await read(head(100, 100, `
1 0 0 setrgbcolor save 0 1 0 setrgbcolor 5 setlinewidth restore 0 0 1 1 rectstroke 0 0 1 1 rectfill
gsave 0 0 1 setrgbcolor gsave 2 2 scale grestore 0 0 1 1 rectfill grestore 0 0 1 1 rectfill
showpage 0 0 1 1 rectfill`))
  const p = paths(r)
  assert.equal(r.pages.length, 2)
  assert.equal(p[0].stroke, '#ff0000'); near(p[0].strokeWidth, 1, 0.001); assert.equal(p[1].fill, '#ff0000')
  assert.equal(p[2].fill, '#0000ff'); assert.equal(p[3].fill, '#ff0000')
  assert.equal(r.pages[1].items[0].fill, '#000000', 'showpage resets colour')
})
test('fill then stroke of the same path is one object; stroke then fill is two', async () => {
  const r = await read(head(100, 100, `
newpath 10 10 moveto 50 10 lineto 50 50 lineto closepath 1 0 0 setrgbcolor gsave fill grestore 0 0 1 setrgbcolor 3 setlinewidth stroke
newpath 60 10 moveto 90 10 lineto 90 50 lineto closepath 0 0 1 setrgbcolor stroke 1 0 0 setrgbcolor newpath 60 10 moveto 90 10 lineto 90 50 lineto closepath fill`))
  assert.equal(r.pages[0].items.length, 3)
  const a = r.pages[0].items[0]
  assert.equal(a.fill, '#ff0000'); assert.equal(a.stroke, '#0000ff'); near(a.strokeWidth, 3, 0.001)
})
test('dash: odd arrays are doubled, scaled by the CTM; zero width is a hairline', async () => {
  const r = await read(head(100, 100, `
gsave 2 2 scale [3] 1 setdash 1 setlinewidth 0 0 moveto 10 0 lineto stroke grestore
0 setlinewidth 0 5 moveto 10 5 lineto stroke [0 0] 0 setdash 0 10 moveto 10 10 lineto stroke`))
  const p = paths(r)
  assert.deepEqual(p[0].dash, [6, 6]); near(p[0].dashOffset, 2, 0.001); near(p[0].strokeWidth, 2, 0.001)
  assert.ok(p[1].strokeWidth > 0 && p[1].strokeWidth <= 1)
  assert.deepEqual(p[2].dash, [])
})
test('text: standard fonts, ISO re-encoding idiom, rotation, advance of the current point', async () => {
  const r = await read(head(300, 100, `
/Helvetica findfont 12 scalefont setfont 0 0 1 setrgbcolor 20 80 moveto (Hello) show ( there) show
/RE {findfont dup length dict begin {1 index /FID ne {def} {pop pop} ifelse} forall /Encoding ISOLatin1Encoding def currentdict end definefont pop} bind def
/Times-Roman-ISO /Times-Roman RE /Times-Roman-ISO findfont 18 scalefont setfont gsave 100 50 translate 90 rotate 0 0 moveto (Up \\351) show grestore
/Courier-BoldOblique 10 selectfont 10 10 moveto (mono) show
/Symbol findfont 12 scalefont setfont 10 30 moveto (abc) show
/Garamond-BoldItalic findfont 12 scalefont setfont 10 40 moveto (stand in) show
(abc) stringwidth pop 0 gt { 1 0 0 setrgbcolor 0 0 1 1 rectfill } if`))
  const t = r.pages[0].items.filter((x) => x.t === 'text')
  assert.deepEqual(t.map((x) => x.str), ['Hello', ' there', 'Up \u00e9', 'mono', 'stand in'])
  assert.equal(t[0].family, 'Helvetica'); near(t[0].size, 12, 0.001); assert.deepEqual(t[0].m.slice(0, 4), [1, 0, 0, 1]); assert.deepEqual(t[0].m.slice(4), [20, 20]); assert.equal(t[0].fill, '#0000ff')
  assert.ok(t[1].m[4] > 20 + 20 && t[1].m[4] < 20 + 40, `advance ${t[1].m[4]}`)
  assert.equal(t[2].family, 'Times'); near(t[2].size, 18, 0.001); near(t[2].m[0], 0, 1e-4); near(t[2].m[1], -1, 1e-4); assert.deepEqual(t[2].m.slice(4), [100, 50])
  assert.equal(t[3].family, 'Courier'); assert.equal(t[3].bold, true); assert.equal(t[3].italic, true)
  assert.equal(t[4].family, 'Garamond'); assert.equal(t[4].bold, true)
  assert.ok(r.warnings.some((w) => /symbol/i.test(w)), r.warnings.join('|'))
  assert.ok(r.warnings.some((w) => /Garamond/.test(w) && /stand-in/.test(w)))
  assert.equal(paths(r).length, 1)
})
test('embedded font programs are skipped by name, and their text is left out with a warning', async () => {
  const r = await read(head(100, 100, `
%%BeginResource: font MyFont
%!PS-AdobeFont-1.0: MyFont 1.0
/FontName /MyFont def { unbalanced ( [ << currentfile eexec
%%EndResource
/MyFont findfont 12 scalefont setfont 10 10 moveto (secret) show
/Helvetica findfont 12 scalefont setfont 10 30 moveto (shown) show`))
  assert.deepEqual(r.pages[0].items.map((x) => x.str), ['shown'])
  assert.ok(r.warnings.some((w) => /MyFont/.test(w) && /embedded/.test(w)), r.warnings.join('|'))
})

// ---------- images ----------
test('colorimage with inline hex data: pixels and placement', async () => {
  const r = await read(head(100, 100, `
gsave 10 10 translate 40 20 scale
2 2 8 [2 0 0 -2 0 2] currentfile /ASCIIHexDecode filter false 3 colorimage
FF0000 00FF00
0000FF FFFF00>
grestore
0 0 1 1 rectfill showpage`))
  const img = r.pages[0].items[0]
  assert.equal(img.t, 'image'); assert.deepEqual([img.w, img.h], [2, 2]); assert.equal(img.opacity, 1)
  img.m.forEach((v, i) => near(v, [40, 0, 0, 20, 10, 70][i], 1e-4))
  const d = decodePng(img.href)
  assert.deepEqual([...d.px], [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0])
  assert.equal(r.pages[0].items.length, 2, 'data was consumed, so no stray objects follow')
  assert.deepEqual(r.warnings, [])
})
test('gray image from a procedure data source using readhexstring', async () => {
  const r = await read(head(100, 100, `
/pic 4 string def 4 1 8 [4 0 0 1 0 0] {currentfile pic readhexstring pop} image
00 55 AA FF
0 0 1 1 rectfill`))
  const img = r.pages[0].items[0]
  assert.deepEqual([...decodePng(img.href).px], [0, 0, 0, 85, 85, 85, 170, 170, 170, 255, 255, 255])
  assert.equal(r.pages[0].items.length, 2)
})
test('ASCII85, RunLength, Flate and LZW data, and a literal <~ ~> string', async () => {
  const px = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9])
  const expect = [...px]
  const img = (src, data = '') => `2 2 8 [2 0 0 -2 0 2] ${src} false 3 colorimage\n${data}\nshowpage`
  const check = async (text) => { const r = await read(head(100, 100, text)); assert.deepEqual([...decodePng(r.pages[0].items[0].href).px], expect); assert.deepEqual(r.warnings, []); return r }
  await check(img('currentfile /ASCII85Decode filter', a85(px)))
  await check(img(`<~${a85(px)}`))
  await check(img('currentfile /ASCIIHexDecode filter /RunLengthDecode filter', hexOf(Uint8Array.from([11, ...px, 128]))))
  await check(img('currentfile /ASCII85Decode filter /FlateDecode filter', a85(deflateSync(px))))
  // LZW: clear (256), 12 literals, EOD (257), 9-bit codes packed MSB first
  let acc = 0, nb = 0
  const out = []
  for (const c of [256, ...px, 257]) { acc = (acc << 9) | c; nb += 9; while (nb >= 8) { out.push((acc >> (nb - 8)) & 255); nb -= 8; acc &= (1 << nb) - 1 } }
  if (nb) out.push((acc << (8 - nb)) & 255)
  await check(img('currentfile /ASCIIHexDecode filter /LZWDecode filter', hexOf(out)))
  const r = await check(img('currentfile /ASCIIHexDecode filter', hexOf(px)) + '\n0 0 1 1 rectfill')
  assert.equal(r.pages[0].items.length, 1, 'program text after the data is not mistaken for data')
})
test('imagemask paints the current colour where the bits say, indexed images use the palette, decode arrays work', async () => {
  const r = await read(head(100, 100, `
1 0 0 setrgbcolor 8 8 true [8 0 0 -8 0 8] {<F0F0F0F00F0F0F0F>} imagemask
[/Indexed /DeviceRGB 1 <FF0000 0000FF>] setcolorspace 2 1 8 [2 0 0 1 0 0] <0001> image
/DeviceGray setcolorspace << /ImageType 1 /Width 2 /Height 1 /BitsPerComponent 8 /ImageMatrix [2 0 0 1 0 0] /Decode [1 0] /DataSource <00FF> >> image`))
  const [m, idx, dec] = r.pages[0].items
  const d = decodePng(m.href)
  assert.equal(d.ch, 4)
  const alpha = (x, y) => d.px[(y * 8 + x) * 4 + 3]
  assert.equal(alpha(0, 0), 255); assert.equal(alpha(4, 0), 0); assert.equal(alpha(0, 5), 0); assert.equal(alpha(7, 5), 255)
  assert.deepEqual([...d.px.subarray(0, 3)], [255, 0, 0])
  assert.deepEqual([...decodePng(idx.href).px], [255, 0, 0, 0, 0, 255])
  assert.deepEqual([...decodePng(dec.href).px], [255, 255, 255, 0, 0, 0])
})
test('DCT data becomes a JPEG image; CMYK JPEG and oversize pictures are skipped with a warning', async () => {
  const jpeg = (comps) => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 8 + 3 * comps, 8, 0, 6, 0, 10, comps, ...Array(3 * comps).fill(1), 0xff, 0xd9])
  let r = await read(head(100, 100, `10 10 scale 10 6 8 [10 0 0 6 0 0] currentfile /ASCIIHexDecode filter /DCTDecode filter false 3 colorimage\n${hexOf(jpeg(3))}\n`))
  assert.equal(r.pages[0].items[0].href.startsWith('data:image/jpeg;base64,'), true); assert.deepEqual([r.pages[0].items[0].w, r.pages[0].items[0].h], [10, 6])
  r = await read(head(100, 100, `10 6 8 [10 0 0 6 0 0] currentfile /ASCIIHexDecode filter /DCTDecode filter false 4 colorimage\n${hexOf(jpeg(4))}\n0 0 1 1 rectfill`))
  assert.equal(r.pages[0].items.length, 1); assert.ok(r.warnings.some((w) => /CMYK/.test(w)))
  r = await read(head(100, 100, `100000 100000 8 [1 0 0 1 0 0] <00> image 0 0 1 1 rectfill`))
  assert.equal(r.pages[0].items.length, 1); assert.ok(r.warnings.some((w) => /too large/.test(w)))
})

// ---------- legacy AI ----------
const AI_TAG = ['Adobe', 'Illustrator', 'AI'].join('_')
const ai = (body, bbox = '0 0 300 200') => `%!PS-Adobe-3.0\n%%Creator: legacy vector editor 8.0\n%%BoundingBox: ${bbox}\n%%HiResBoundingBox: 0.5 0.5 299.5 199.5\n%%EndComments\n%%BeginProlog\n%%BeginProcSet: ${AI_TAG}5 1.0 0\n/${AI_TAG}5_vars 20 dict def\n/m { this prolog is not valid { PostScript ( } def\n%%EndProcSet\n%%EndProlog\n%%BeginSetup\n${AI_TAG}5_vars ${AI_TAG}5 begin\n${AI_TAG}5 /initialize get exec\n%%EndSetup\n${body}\n%%Trailer\n${AI_TAG}5 /terminate get exec\n%%EOF\n`
test('legacy AI: the AI prolog is skipped, layers, groups, paint operators, colours, compound paths, clip groups', async () => {
  const r = await read(ai(`
%AI5_BeginLayer
1 1 1 1 0 0 0 79 128 255 Lb
(Layer 1) Ln
u
0 0 0 1 k
20 20 m 100 20 l 100 100 l 20 100 l h f
1 0 0 0 K 2 w 0 J 0 j 4 M [] 0 d
20 120 m 60 180 100 180 120 120 c S
0 0 1 0 (Spot Blue) 0.5 x
130 20 m 190 20 l 190 80 l 130 80 l 130 20 l b
0.5 g 0.25 G
140 100 m 160 160 180 160 190 100 c 150 100 v 140 100 y s
U
*u
0 1 1 0 k
200 20 m 280 20 l 280 100 l 200 100 l h f
220 40 m 260 40 l 260 80 l 220 80 l h f
*U
q
20 20 m 140 20 l 140 80 l 20 80 l h W n
0.2 0.4 0.6 0 k 0 0 m 300 0 l 300 200 l 0 200 l h f
Q
0 0 m 5 5 l N
%AI5_EndLayer--
LB`))
  assert.deepEqual([r.pages[0].w, r.pages[0].h], [299, 199], 'HiResBoundingBox is used')
  const p = paths(r)
  assert.equal(p.length, 6, r.warnings.join('|'))
  assert.equal(p[0].fill, '#000000'); boxNear(pathBBox(p[0].d), { x: 19.5, y: 99.5, w: 80, h: 80 }, 0.01)
  assert.equal(p[1].stroke, '#00ffff'); assert.equal(p[1].fill, null); near(p[1].strokeWidth, 2, 0.001)
  assert.ok(p[2].fill && p[2].stroke, 'b = fill and stroke'); assert.notEqual(p[2].fill, '#000000'); assert.equal(p[2].stroke, '#00ffff')
  assert.equal(p[3].fill, null); assert.equal(p[3].stroke, '#404040')
  assert.equal(p[4].fill, '#ff0000', 'compound path in one object'); assert.equal(p[4].d.filter((c) => c[0] === 'M').length, 2)
  assert.equal(p[5].clip.length, 1); boxNear(pathBBox(p[5].clip[0].d), { x: 19.5, y: 199.5 - 80, w: 120, h: 60 }, 0.01); assert.equal(p[5].fill, '#cc6633'.replace('#cc6633', p[5].fill))
  assert.equal(paths(r).length, 6, 'N paints nothing')
})
test('legacy AI text blocks become Text objects', async () => {
  const r = await read(ai(`
To
0 Tr
1 0 0 1 20 100 Tm
/_Helvetica-Bold 24 Tf
0 0 0 1 k
(Title) Tx
(more) Tx
TO
To
1 0 0 1 20 50 Tm
/_Times-Italic 12 Tf
(Body text) Tx
TO`))
  const t = r.pages[0].items.filter((x) => x.t === 'text')
  assert.deepEqual(t.map((x) => x.str), ['Title', 'more', 'Body text'])
  assert.equal(t[0].family, 'Helvetica'); assert.equal(t[0].bold, true); near(t[0].size, 24, 0.001); assert.deepEqual(t[0].m.slice(4), [19.5, 99.5])
  assert.ok(t[1].m[4] > t[0].m[4] + 30, 'the matrix origin moves along after each string')
  assert.equal(t[2].family, 'Times'); assert.equal(t[2].italic, true)
})

// ---------- containers ----------
test('DOS EPS binary header: the PostScript section is used, the preview after it is ignored', async () => {
  const ps = bytes(head(120, 60, '0 0 1 setrgbcolor 10 10 50 20 rectfill showpage\n%%EOF\n'))
  const preview = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) & 255)
  const hdr = new Uint8Array(30), dv = new DataView(hdr.buffer)
  hdr.set([0xc5, 0xd0, 0xd3, 0xc6]); dv.setUint32(4, 30, true); dv.setUint32(8, ps.length, true); dv.setUint32(20, 30 + ps.length, true); dv.setUint32(24, preview.length, true); dv.setUint16(28, 0xffff, true)
  const file = new Uint8Array(30 + ps.length + preview.length)
  file.set(hdr); file.set(ps, 30); file.set(preview, 30 + ps.length)
  assert.equal(isPostScript(file), true)
  const r = await psToDoc(file)
  assert.deepEqual([r.pages[0].w, r.pages[0].h, r.pages[0].items.length], [120, 60, 1])
  boxNear(pathBBox(r.pages[0].items[0].d), { x: 10, y: 30, w: 50, h: 20 }, 0.01)
  const bad = file.slice(); dv.setUint32(8, 999999, true); new DataView(bad.buffer).setUint32(8, 999999, true)
  assert.equal((await psToDoc(bad)).pages[0].items.length, 1, 'a bad length is clamped to the file')
})
test('(atend) bounding box, no bounding box, PageBoundingBox per page, setpagedevice size', async () => {
  let r = await read('%!PS-Adobe-3.0\n%%BoundingBox: (atend)\n%%EndComments\n0 0 10 10 rectfill\nshowpage\n%%Trailer\n%%BoundingBox: 0 0 50 40\n%%EOF\n')
  assert.deepEqual([r.pages[0].w, r.pages[0].h], [50, 40])
  r = await read('%!PS\n0 0 10 10 rectfill\nshowpage\n%%EOF\n')
  assert.deepEqual([r.pages[0].w, r.pages[0].h], [612, 792]); assert.ok(r.warnings.some((w) => /BoundingBox/.test(w)))
  r = await read('%!PS\n<< /PageSize [300 200] >> setpagedevice 0 0 10 10 rectfill showpage\n%%EOF\n')
  assert.deepEqual([r.pages[0].w, r.pages[0].h], [300, 200])
  r = await read('%!PS-Adobe-3.0\n%%BoundingBox: 0 0 100 100\n%%EndComments\n%%Page: 1 1\n%%PageBoundingBox: 0 0 100 50\n0 0 10 10 rectfill\nshowpage\n%%Page: 2 2\n%%PageBoundingBox: 0 0 80 80\n0 0 10 10 rectfill\nshowpage\n%%EOF\n')
  assert.deepEqual(r.pages.map((p) => [p.w, p.h]), [[100, 50], [80, 80]])
  r = await read('%!PS-Adobe-3.0\n%%BoundingBox: 10 20 110 120\n%%EndComments\n10 20 100 100 rectfill\nshowpage\n%%EOF\n')
  boxNear(pathBBox(r.pages[0].items[0].d), { x: 0, y: 0, w: 100, h: 100 }, 0.01)
  r = await read('%!PS-Adobe-3.0\n%%BoundingBox: 0 0 100 100\n%%EndComments\n%%BeginDocument: inner.eps\n%%BoundingBox: 0 0 7 7\n%%EndDocument\n0 0 10 10 rectfill\n%%EOF\n')
  assert.equal(r.pages[0].w, 100, 'a nested document keeps its own bounding box')
})
test('PDF-based and non-PostScript input is refused with a readable message', async () => {
  await assert.rejects(read('%PDF-1.7\n1 0 obj\n'), /PDF/)
  await assert.rejects(read('hello world'), /PostScript/)
  await assert.rejects(psToDoc(42), /PostScript/)
  const r = await read(head(10, 10, 'showpage\n%%EOF'))
  assert.equal(r.pages.length, 1); assert.equal(r.pages[0].items.length, 0); assert.ok(r.warnings.some((w) => /Nothing was drawn/.test(w)))
})

// ---------- limits and hostile files ----------
test('infinite loops stop at the wall clock; recursion and growth stop at their limits', async () => {
  await assert.rejects(read(head(10, 10, '{} loop'), { limits: { ms: 150 } }), /too long/)
  await assert.rejects(read(head(10, 10, '/f {f} def f'), { limits: { ms: 150 } }), /too long/)
  await assert.rejects(read(head(10, 10, '/f {f 1} def f')), /too deeply/)
  await assert.rejects(read(head(10, 10, '{1} loop')), /piles up/)
  await assert.rejects(read(head(10, 10, '1000000000 {} repeat'), { limits: { ops: 200000 } }), /too many operations/)
  await assert.rejects(read(head(10, 10, '/a {{{{ ' .repeat(100) + '1 ' + '} } } }'.repeat(100))), /Error|deeply|nests/)
  await assert.rejects(read(head(10, 10, '0 1 100000000 {pop 0 0 moveto 1 1 lineto stroke} for'), { limits: { items: 1000, ms: 5000 } }).then(() => { throw new Error('no limit') }), /no limit|too many objects/)
  const r = await read(head(10, 10, '/a 5 def a a a ' + 'bogus '.repeat(300) + ' 0 0 1 1 rectfill'), { limits: { errors: 1000 } })
  assert.ok(r.warnings.length <= 41)
  await assert.rejects(read(head(10, 10, 'bogus '.repeat(1000))), /too many errors/)
})
test('abort signal is honoured, and progress is reported', async () => {
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 40)
  await assert.rejects(read(head(10, 10, '{} loop'), { signal: ac.signal }), (e) => e.code === 'ABORT' && e.message === 'Cancelled')
  const pre = new AbortController(); pre.abort()
  await assert.rejects(read(head(10, 10, '1 1 add pop showpage'), { signal: pre.signal }), (e) => e.code === 'ABORT')
  const seen = []
  await read(head(10, 10, '0 1 3000000 {pop} for showpage'), { onProgress: (f, t) => seen.push([f, t]), limits: { ms: 20000 } })
  assert.ok(seen.length >= 1 && seen.at(-1)[0] === 1)
})
test('truncated and malformed programs never hang and give either a doc or a readable Error', async () => {
  const good = head(100, 100, '0 0 1 setrgbcolor 10 10 moveto 50 50 lineto stroke showpage\n%%EOF\n')
  const bad = ['(unterminated string', '{ unterminated proc', '} stray', '<0g1> ', '<~ zzz', '1 2 3 4 5 6 curveto', 'pop pop pop', '[ ] [ ]', '/ /', '//undefined', 'dup', '1 0 div', '-1 sqrt',
    '99999999999999999999 string', '-5 array', '1 2 3 roll', 'currentpoint', '(a) (b) 3 getinterval', '5 dict begin end end end end', 'gsave grestore grestore grestore', '0 0 0 0 0 arc fill',
    '1e400 1e400 moveto 0 0 lineto stroke', 'NaN Infinity moveto']
  for (const s of bad) {
    const out = await read(head(100, 100, s)).then((r) => r, (e) => e)
    assert.ok(out instanceof Error ? out.message.length > 10 : Array.isArray(out.pages), s)
  }
  for (const cut of [10, 40, 77, 120, good.length - 20]) {
    const out = await read(good.slice(0, cut)).then((r) => r, (e) => e)
    assert.ok(out instanceof Error ? /\w+ \w+ \w+/.test(out.message) : Array.isArray(out.pages))
  }
})
test('fuzz: random and mutated programs finish quickly and fail only with Errors', async () => {
  let s = 987654321
  const rnd = (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n }
  const words = ['moveto', 'lineto', 'curveto', 'fill', 'stroke', 'gsave', 'grestore', '{', '}', '[', ']', '<<', '>>', 'def', 'exch', 'dup', 'pop', 'roll', 'index', 'copy', 'if', 'ifelse', 'for', 'repeat', 'loop', 'exit', 'forall',
    'show', 'image', 'colorimage', 'clip', 'arc', 'concat', 'translate', 'scale', 'rotate', '(str)', '<4142>', '/name', '1', '2.5', '-3', '0', '100', 'true', 'false', 'null', 'mark', 'array', 'string', 'dict', 'begin', 'end', 'get', 'put',
    'cvx', 'exec', 'stopped', 'currentfile', 'filter', 'readhexstring', 'save', 'restore', 'findfont', 'scalefont', 'setfont', 'k', 'm', 'l', 'c', 'h', 'f', 'S', 'q', 'Q', 'W', 'n', '*u', '*U', 'Tx', 'Tf', 'To', 'TO']
  const seeds = [head(100, 100, ''), '%!PS\n', ai('0 0 m 10 10 l S')]
  const t0 = Date.now()
  const ok = (out, label) => {
    assert.ok(out instanceof Error || (Array.isArray(out.pages) && Array.isArray(out.warnings)), label)
    if (out instanceof Error) assert.ok(out.message && !/^(Type|Range|Reference|Syntax)Error$/.test(out.name), `${label} crashed with ${out.name}: ${out.message}`)
  }
  for (let i = 0; i < 400; i++) {
    let text = seeds[i % seeds.length]
    for (let k = rnd(60); k > 0; k--) text += words[rnd(words.length)] + (rnd(5) ? ' ' : '\n')
    if (i % 4 === 0) { const b = bytes(text); for (let k = 0; k < 5; k++) b[rnd(b.length)] = rnd(256); text = Buffer.from(b).toString('latin1') }
    ok(await read(text, { limits: { ms: 1500, ops: 300000, items: 5000, execDepth: 300 } }).then((r) => r, (e) => e), `case ${i}: ${JSON.stringify(text)}`)
  }
  assert.ok(Date.now() - t0 < 60000, 'fuzz run is fast')
  for (const f of ['tiny.eps', 'multi.eps', 'legacy.ai']) {
    if (!existsSync(join(samples, f))) continue
    const orig = readFileSync(join(samples, f))
    for (let i = 0; i < 40; i++) {
      const b = Uint8Array.from(orig)
      for (let k = 0; k < 1 + rnd(6); k++) b[rnd(b.length)] = rnd(256)
      ok(await psToDoc(b, { limits: { ms: 1500, ops: 300000 } }).then((r) => r, (e) => e), f)
    }
  }
})

test('each object gets its own clip array; fill and stroke under one clip still merge; Blob input works', async () => {
  const r = await read(head(100, 100, `
gsave 10 10 50 50 rectclip
1 0 0 setrgbcolor 0 0 100 100 rectfill 0 0 1 setrgbcolor 3 setlinewidth 0 0 100 100 rectstroke
0 1 0 setrgbcolor 20 20 10 10 rectfill
grestore`))
  const [a, b] = r.pages[0].items
  assert.equal(r.pages[0].items.length, 2, 'rectfill + rectstroke under one clip is one object')
  assert.ok(a.fill && a.stroke); assert.notEqual(a.clip, b.clip, 'separate arrays'); assert.deepEqual(a.clip, b.clip)
  a.clip.push({ d: [], rule: 'nonzero' }); assert.equal(b.clip.length, 1)
  const blob = new Blob([bytes(head(10, 10, '0 0 5 5 rectfill showpage'))])
  assert.equal((await psToDoc(blob)).pages[0].items.length, 1)
})

// ---------- shapes of file other tools write ----------
const libStyle = (body) => `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: a vector library (PostScript level 2 writer)
%%Pages: 1
%%DocumentData: Clean7Bit
%%LanguageLevel: 2
%%BoundingBox: 0 -1 100 100
%%EndComments
%%BeginProlog
save
50 dict begin
/q { gsave } bind def
/Q { grestore } bind def
/cm { 6 array astore concat } bind def
/w { setlinewidth } bind def
/J { setlinecap } bind def
/j { setlinejoin } bind def
/M { setmiterlimit } bind def
/d { setdash } bind def
/m { moveto } bind def
/l { lineto } bind def
/c { curveto } bind def
/h { closepath } bind def
/re { exch dup neg 3 1 roll 5 3 roll moveto 0 rlineto
      0 exch rlineto 0 rlineto closepath } bind def
/S { stroke } bind def
/f { fill } bind def
/f* { eofill } bind def
/n { newpath } bind def
/W { clip } bind def
/W* { eoclip } bind def
/BT { } bind def
/ET { } bind def
/pdfmark where { pop globaldict /?pdfmark /exec load put }
    { globaldict begin /?pdfmark /pop load def /pdfmark
    /cleartomark load def end } ifelse
/BDC { mark 3 1 roll /BDC pdfmark } bind def
/EMC { mark /EMC pdfmark } bind def
/lib_store_point { /lib_point_y exch def /lib_point_x exch def } def
/Tj { show currentpoint lib_store_point } bind def
/lib_selectfont { lib_font_matrix aload pop pop pop 0 0 6 array astore
    lib_font exch selectfont lib_point_x lib_point_y moveto } bind def
/Tf { pop /lib_font exch def /lib_font_matrix where
      { pop lib_selectfont } if } bind def
/Td { matrix translate lib_font_matrix matrix concatmatrix dup
      /lib_font_matrix exch def dup 4 get exch 5 get lib_store_point
      /lib_font where { pop lib_selectfont } if } bind def
/Tm { 2 copy 8 2 roll 6 array astore /lib_font_matrix exch def
      lib_store_point /lib_font where { pop lib_selectfont } if } bind def
/g { setgray } bind def
/rg { setrgbcolor } bind def
%%EndProlog
%%BeginSetup
%%EndSetup
%%Page: 1 1
%%BeginPageSetup
%%PageBoundingBox: 0 -1 100 100
%%EndPageSetup
q 0 -1 100 101 rectclip q
${body}
Q Q
showpage
end restore
%%Trailer
%%EOF
`
test('PostScript written by a common vector library: procedure prolog, rectangles, text matrices, pdfmark shims', async () => {
  const r = await read(libStyle(`
1 0 0 -1 0 100 cm
BT 0 0 1 rg 10 10 40 20 re f* ET
/Artifact << /MCID 0 >> BDC 1 0.5 0 rg 60 10 30 30 re f EMC
q 2 w 1 j 0.2 g 10 50 m 50 50 l 50 90 l h S Q
q 20 60 m 30 60 40 70 40 80 c W n 0 0 100 100 re f Q
/Helvetica 12 Tf 12 0 0 -12 12 95 Tm 0 g (Library text) Tj`))
  assert.deepEqual([r.pages[0].w, r.pages[0].h], [100, 101])
  const p = paths(r), t = r.pages[0].items.filter((x) => x.t === 'text')
  assert.equal(p.length, 4, r.warnings.join('|'))
  boxNear(pathBBox(p[0].d), { x: 10, y: 10, w: 40, h: 20 }, 0.01)
  assert.equal(p[0].fill, '#0000ff'); assert.equal(p[1].fill, '#ff8000')
  assert.equal(p[2].stroke, '#333333'); near(p[2].strokeWidth, 2, 0.001); assert.equal(p[2].join, 1)
  assert.equal(p[3].clip.length, 1)
  assert.equal(t.length, 1); assert.equal(t[0].str, 'Library text'); near(t[0].size, 12, 0.001); near(t[0].m[4], 12, 0.001)
  assert.deepEqual(r.warnings, [])
})
test('level 3 style picture: dictionary image, ASCII85 + Flate data, /DeviceRGB colour space, image matrix flip', async () => {
  const px = Uint8Array.from({ length: 4 * 3 * 3 }, (_, i) => (i * 21) & 255)
  const r = await read(head(100, 100, `
gsave 10 20 translate 40 30 scale
/DeviceRGB setcolorspace
<< /ImageType 1 /Width 4 /Height 3 /BitsPerComponent 8 /Decode [0 1 0 1 0 1] /ImageMatrix [4 0 0 -3 0 3]
   /DataSource currentfile /ASCII85Decode filter /FlateDecode filter /Interpolate true >> image
${a85(deflateSync(px))}
grestore
showpage`))
  const img = r.pages[0].items[0]
  assert.deepEqual([img.w, img.h], [4, 3]); img.m.forEach((v, i) => near(v, [40, 0, 0, 30, 10, 50][i], 1e-4))
  assert.deepEqual([...decodePng(img.href).px], [...px]); assert.deepEqual(r.warnings, [])
})
test('legacy AI written by a modern editor: whole procset prolog skipped, unsupported gradient operators warn but the rest is read', async () => {
  const r = await read(ai(`
0 0 0 1 k
10 10 m 50 10 l 50 50 l 10 50 l h f
Bb
0 0 0 0 1 0 0 0 0 0 Bg
60 60 m 90 60 l 90 90 l 60 90 l h f
BB
%AI5_BeginRaster
(not a program ( at all
%AI5_EndRaster
1 0 0 0 K 70 10 m 90 30 l S`))
  assert.equal(paths(r).length, 3)
  assert.ok(r.warnings.some((w) => /Bg|Bb|BB/.test(w)), r.warnings.join('|'))
  assert.ok(r.warnings.some((w) => /picture embedded in this legacy AI/.test(w)))
})
test('number parsing and string syntax: radix, exponents, escapes, nested parentheses, hex and ASCII85 strings', async () => {
  const r = await read(head(2000, 100, `
/t { 0 moveto 0 5 rlineto stroke } def
16#1F t 8#17 t 36#Z t -1.5e1 t +7 t 1.e2 t (a\\(b\\)c) length t (a(b)c) length t (\\101\\102) 1 get t (line\\
break) length t <4 1 42 4> length t <~${a85(bytes('Hello'))} length t (\\n\\t) 0 get t
/n1 /name1 def n1 length t (x) cvn length t 100000000000 t`))
  const x = paths(r).map((p) => p.d[0][1])
  assert.deepEqual(x, [31, 15, 35, -15, 7, 100, 5, 5, 66, 9, 3, 5, 10, 5, 1, 1e8])
})

// ---------- run ----------
let failed = 0
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok - ${name}`) } catch (e) { failed++; console.log(`not ok - ${name}\n  ${(e.stack || e).toString().split('\n').slice(0, 6).join('\n  ')}`) }
}
console.log(failed ? `\n${failed} of ${tests.length} failed` : `\nall ${tests.length} passed`)
process.exitCode = failed ? 1 : 0
