// Runnable self-check for the pure parts of Vector Studio (no browser needed):  node packs/studio-vector/_selfcheck.mjs
import assert from 'node:assert/strict'
import * as g from './_geom.js'
import { newDoc, mk, applyMatrix, bboxOf, toSubs, solid } from './_model.js'
import { exportSvg } from './_svg.js'

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`)

// path data: arcs, relative commands, smooth curves and glued arc flags all parse; output re-parses to the same shape
const subs = g.parseD('M10 10 L50 10 A20 20 0 0 1 70 30 Q90 30 90 50 T70 70 H20 V40 z M100 100 c10 0 10 10 0 10 s-10 10-10 0 M10 10a5 5 0 1010 0')
assert.equal(subs.length, 3)
assert.equal(subs[0].closed, true)
const again = g.parseD(g.subsToD(subs))
assert.deepEqual(again.map((s) => s.pts.length), subs.map((s) => s.pts.length))

// bounds: exact for curves (an ellipse), and rounded rectangles stay inside their box
const e = g.subsBBox(g.ellipseSubs(50, 50, 20, 10))
assert.deepEqual([e.x, e.y, e.w, e.h].map(Math.round), [30, 40, 40, 20])
const rr = g.subsBBox(g.rectSubs(0, 0, 100, 50, 10))
assert.deepEqual([rr.x, rr.y, rr.w, rr.h].map(Math.round), [0, 0, 100, 50])

// matrices: inverse round trip, rotation about a pivot
const m = g.about(g.rot(Math.PI / 2), 50, 50)
const [rx, ry] = g.ap(m, 100, 50)
close(rx, 50); close(ry, 100)
const [bx, by] = g.ap(g.inv(m), ...g.ap(m, 12, 34))
close(bx, 12); close(by, 34)

// splitting a curve keeps the shape: the new anchor sits on the original curve and the bounds do not grow
const circle = g.ellipseSubs(0, 0, 10, 10)[0]
const before = g.subsBBox([circle])
const at = g.splitSegment(circle, 0, 0.5)
close(Math.hypot(circle.pts[at].x, circle.pts[at].y), 10, 0.05)
close(g.subsBBox([circle]).w, before.w, 0.01)

// freehand: a noisy straight line simplifies to few points
const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i % 2 ? 0.2 : 0 }))
assert.ok(g.rdp(line, 1).length <= 3)

// document model: uniform scale bakes into a rectangle (no leftover matrix), rotation keeps one
const doc = newDoc(200, 200)
const rect = mk(doc, 'rect', { x: 10, y: 10, w: 20, h: 10, rx: 2, ry: 2 })
applyMatrix(rect, g.about(g.sc(2), 10, 10))
assert.equal(rect.t, undefined)
assert.deepEqual([rect.x, rect.y, rect.w, rect.h, rect.rx], [10, 10, 40, 20, 4])
applyMatrix(rect, g.rot(0.3))
assert.ok(rect.t, 'rotation stays as a transform')
const box = bboxOf(rect)
assert.ok(box.w > 40 && box.h > 20)
assert.ok(toSubs(rect)[0].pts.length >= 4)

// groups never carry a matrix: it is pushed down to the children
const group = mk(doc, 'group', { kids: [mk(doc, 'ellipse', { cx: 5, cy: 5, rx: 5, ry: 5 }), mk(doc, 'rect', { x: 0, y: 0, w: 4, h: 4, rx: 0, ry: 0 })] })
applyMatrix(group, g.tr(100, 50))
assert.equal(group.t, undefined)
assert.deepEqual([group.kids[0].cx, group.kids[0].cy], [105, 55])

// export: clean, escaped, one gradient def per use, hidden objects skipped, clip groups become <clipPath>
doc.nodes = [
  mk(doc, 'rect', { x: 0, y: 0, w: 10, h: 10, rx: 0, ry: 0 }, { fill: { t: 'linear', stops: [{ o: 0, c: '#000000', a: 1 }, { o: 1, c: '#ffffff', a: 1 }], x1: 0, y1: 0, x2: 1, y2: 0 }, stroke: null, sw: 0 }),
  mk(doc, 'text', { x: 5, y: 5, text: 'a < b & "c"', ff: 'Arial', fs: 12, fw: 400, fi: false, ta: 'start', lh: 1.2, ls: 0 }, { fill: solid('#112233'), stroke: null, sw: 0 }),
  Object.assign(mk(doc, 'rect', { x: 0, y: 0, w: 1, h: 1, rx: 0, ry: 0 }), { vis: false }),
  mk(doc, 'group', { clip: true, kids: [mk(doc, 'rect', { x: 0, y: 0, w: 50, h: 50, rx: 0, ry: 0 }), mk(doc, 'ellipse', { cx: 10, cy: 10, rx: 5, ry: 5 }, { fill: null, stroke: null, sw: 0 })] }),
]
const svg = exportSvg(doc)
assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">'))
assert.equal((svg.match(/<linearGradient/g) || []).length, 1)
assert.ok(svg.includes('a &lt; b &amp; &quot;c&quot;'))
assert.equal((svg.match(/<rect /g) || []).length, 3, 'background, gradient rect and the clipped rect (the hidden one is skipped)')
assert.ok(svg.includes('<clipPath id="clip1"') && svg.includes('clip-path="url(#clip1)"'))
assert.ok(!svg.includes('data-id'), 'editor attributes never reach the file')

console.log('vector-studio self-check ok')
