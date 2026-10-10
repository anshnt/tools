// Self-check for the CAD Studio geometry, command parsing and file writers. No browser needed:
//   node packs/studio-cad/_selftest.mjs
import assert from 'node:assert/strict'
import * as V from './_vec.js'
import * as E from './_ent.js'
import * as D from './_edit.js'
import * as M from './_dim.js'
import { Doc, blankState } from './_doc.js'
import { exportDxf, parseHatches, decodeDxfText, stripMText } from './_dxf.js'
import { toPdf, toSvg, layout } from './_export.js'
import { parseCoord } from './_cmds.js'
import { platePart, floorPlan } from './_templates.js'

let n = 0
const pending = []
const fail = (name, e) => { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1 }
const test = (name, fn) => {
  try {
    const r = fn()
    if (r?.then) pending.push(r.then(() => { n++ }, (e) => fail(name, e)))
    else n++
  } catch (e) { fail(name, e) }
}
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not near ${b}`)
const line = (x1, y1, x2, y2) => ({ type: 'line', id: Math.random(), layer: '0', x1, y1, x2, y2 })

test('intersections', () => {
  const r = V.intersectPrims(V.S({ x: 0, y: 0 }, { x: 10, y: 10 }), V.S({ x: 0, y: 10 }, { x: 10, y: 0 }))[0]
  near(r.pt.x, 5); near(r.pt.y, 5)
  const c = V.intersectPrims(V.S({ x: -10, y: 0 }, { x: 10, y: 0 }), V.A({ x: 0, y: 0 }, 5, 0, V.TAU))
  assert.equal(c.length, 2)
  assert.equal(V.intersectPrims(V.A({ x: 0, y: 0 }, 5, 0, V.TAU), V.A({ x: 8, y: 0 }, 5, 0, V.TAU)).length, 2)
  const el = V.E({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.5, 0, V.TAU)
  const hits = V.intersectPrims(V.S({ x: -20, y: 0 }, { x: 20, y: 0 }), el)
  assert.equal(hits.length, 2); near(Math.abs(hits[0].pt.x), 10)
})

test('trim, extend', () => {
  const base = line(0, 0, 100, 0)
  const t = D.trimEntity(base, { x: 50, y: 0 }, [line(30, -10, 30, 10), line(70, -10, 70, 10)])
  assert.equal(t.length, 2); near(t[0].x2, 30); near(t[1].x1, 70)
  const arc = { type: 'arc', id: 1, layer: '0', cx: 0, cy: 0, r: 10, a0: 0, a1: Math.PI }
  const ta = D.trimEntity(arc, { x: 7, y: 7 }, [line(0, -1, 0, 20)])
  near(ta[0].a0, Math.PI / 2)
  const circle = D.trimEntity({ type: 'circle', id: 2, layer: '0', cx: 0, cy: 0, r: 10 }, { x: 10, y: 0 }, [line(5, -20, 5, 20), line(-5, -20, -5, 20)])
  assert.equal(circle[0].type, 'arc')
  near(D.extendEntity(line(0, 0, 10, 0), { x: 9, y: 0 }, [line(20, -5, 20, 5)]).x2, 20)
})

test('offset', () => {
  near(D.offsetEntity(line(0, 0, 10, 0), 2, { x: 5, y: 5 }).y1, 2)
  near(D.offsetEntity({ type: 'circle', cx: 0, cy: 0, r: 5 }, 2, { x: 0, y: 0 }).r, 3)
  const rect = { type: 'polyline', closed: true, pts: [{ x: 0, y: 0, b: 0 }, { x: 10, y: 0, b: 0 }, { x: 10, y: 6, b: 0 }, { x: 0, y: 6, b: 0 }] }
  const inner = D.offsetEntity(rect, 1, { x: 5, y: 3 })
  near(inner.pts[0].x, 1); near(inner.pts[2].y, 5)
  const slot = { type: 'polyline', closed: true, pts: [{ x: 0, y: 0, b: 0 }, { x: 10, y: 0, b: 1 }, { x: 10, y: 4, b: 0 }, { x: 0, y: 4, b: 1 }] }
  near(D.offsetEntity(slot, 1, { x: 5, y: 2 }).pts[1].y, 1)
  assert.throws(() => D.offsetEntity({ type: 'circle', cx: 0, cy: 0, r: 1 }, 5, { x: 0, y: 0 }))
})

test('fillet, chamfer', () => {
  const f = D.cornerLines(line(0, 0, 10, 0), { x: 8, y: 0 }, line(0, 0, 0, 10), { x: 0, y: 8 }, { r: 2 })
  near(f.l1.x2, 2); near(f.extra.cx, 2); near(f.extra.r, 2)
  const rect = { type: 'polyline', closed: true, pts: [{ x: 0, y: 0, b: 0 }, { x: 20, y: 0, b: 0 }, { x: 20, y: 10, b: 0 }, { x: 0, y: 10, b: 0 }] }
  near(V.loopArea(D.filletPolyline(rect, 2).entity.pts).area, 200 - (4 - Math.PI) * 4)
  const c = D.cornerLines(line(0, 0, 10, 0), { x: 8, y: 0 }, line(0, 0, 0, 10), { x: 0, y: 8 }, { chamfer: true, d1: 2, d2: 3 })
  near(c.l1.x2, 2); near(c.l2.y2, 3)
})

test('transforms', () => {
  const m = E.transform({ type: 'arc', cx: 0, cy: 0, r: 5, a0: 0, a1: Math.PI / 2 }, V.Tf.mirror({ x: 0, y: 0 }, { x: 0, y: 1 }))
  near(m.a0, Math.PI / 2); near(m.a1, Math.PI)
  const el = E.transform({ type: 'ellipse', cx: 0, cy: 0, mx: 10, my: 0, ratio: 0.5, t0: 0, t1: Math.PI / 2 }, V.Tf.mirror({ x: 0, y: 0 }, { x: 1, y: 0 }))
  const p = E.prims(el)[0]
  near(V.primPoint(p, 0).y, -5); near(V.primPoint(p, p.sw).x, 10)
})

test('hatch boundary with island', () => {
  const ents = [{ type: 'polyline', closed: true, pts: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], id: 1 }, { type: 'circle', cx: 10, cy: 10, r: 3, id: 2 }]
  assert.equal(D.hatchBoundaryAt({ x: 2, y: 2 }, ents).length, 2)
  assert.equal(D.hatchBoundaryAt({ x: 10, y: 10 }, ents).length, 1)
  assert.equal(D.hatchBoundaryAt({ x: 50, y: 50 }, ents), null)
})

test('dimensions and text', () => {
  const g = M.dimGeom({ type: 'dim', kind: 'linear', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, loc: { x: 50, y: 20 }, ang: 0, th: 2.5, as: 2.5, pr: 2 })
  assert.equal(g.texts[0].str, '100.00'); near(g.value, 100)
  assert.equal(M.dimGeom({ type: 'dim', kind: 'angular', v: { x: 0, y: 0 }, a1: 0, a2: Math.PI / 2, loc: { x: 10, y: 10 }, th: 2.5, as: 2.5, pr: 1 }).texts[0].str, '90.0°')
  assert.equal(M.dimGeom({ type: 'dim', kind: 'radius', cx: 0, cy: 0, r: 5, loc: { x: 10, y: 10 }, th: 2.5, as: 2.5, pr: 2 }).texts[0].str, 'R5.00')
  near(M.textWidth('iii', 10), 0.222 * 30)
})

test('typed coordinates', () => {
  const o = { x: 0, y: 0 }
  assert.deepEqual(parseCoord('10,20', o, null), { x: 10, y: 20 })
  assert.deepEqual(parseCoord('@5,3', { x: 1, y: 1 }, null), { x: 6, y: 4 })
  const p = parseCoord('@10<90', o, null); near(p.x, 0, 1e-9); near(p.y, 10)
  assert.equal(parseCoord('abc', o, null), null)
  const d = parseCoord('5', { x: 0, y: 0 }, { x: 10, y: 0 }); near(d.x, 5)
  assert.equal(parseCoord('5', o, null), null)
})

test('document history', () => {
  const doc = new Doc(blankState('mm'))
  doc.commit('a', (tx) => tx.add({ type: 'line', layer: '0', x1: 0, y1: 0, x2: 1, y2: 1 }))
  doc.commit('b', (tx) => tx.add({ type: 'circle', layer: '0', cx: 0, cy: 0, r: 1 }))
  assert.equal(doc.ents.length, 2)
  doc.undo(); assert.equal(doc.ents.length, 1)
  doc.redo(); assert.equal(doc.ents.length, 2)
  doc.commit('c', (tx) => tx.remove(doc.ents[0].id))
  assert.equal(doc.ents.length, 1)
})

test('dxf text codes', () => {
  assert.equal(decodeDxfText('%%c10 %%d \\U+00E9'), 'Ø10 ° é')
  assert.equal(stripMText('{\\fArial|b1;Hello}\\Pworld'), 'Hello\nworld')
})

test('dxf export structure', () => {
  const doc = new Doc(platePart())
  const dxf = exportDxf(doc)
  assert.ok(dxf.startsWith('0\r\nSECTION'))
  assert.ok(dxf.trimEnd().endsWith('EOF'))
  const lines = dxf.split('\r\n')
  const handles = []
  for (let i = 0; i + 1 < lines.length; i += 2) if (lines[i] === '5') handles.push(lines[i + 1])
  assert.equal(new Set(handles).size, handles.length, 'handles are unique')
  assert.ok(lines.includes('LWPOLYLINE') && lines.includes('CIRCLE') && lines.includes('TEXT'))
})

test('dxf hatch parser', () => {
  const g = (...a) => a.join('\n')
  const txt = g('0', 'SECTION', '2', 'ENTITIES', '0', 'HATCH', '8', 'L1', '62', '1', '2', 'ANSI31', '70', '0', '91', '1', '92', '3', '72', '0', '73', '1', '93', '4',
    '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '10', '10', '0', '20', '10', '97', '0', '75', '0', '76', '1', '52', '30', '41', '2', '0', 'ENDSEC', '0', 'EOF')
  const h = parseHatches(txt)
  assert.equal(h.length, 1); assert.equal(h[0].layer, 'L1'); assert.equal(h[0].loops[0].length, 4); near(h[0].angle, 30); near(h[0].scale, 2); assert.equal(h[0].color, '#ff0000')
})

test('pdf and svg output', async () => {
  const doc = new Doc(floorPlan())
  const blob = await toPdf(doc, { paper: 'A3', scale: 'fit' })
  const head = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 8))
  assert.equal(head, '%PDF-1.4')
  const L = layout(doc, { paper: 'A3', scale: 'fit' })
  near(L.pw, 420)
  assert.ok(toSvg(doc, { paper: 'A4' }).includes('<svg'))
})

await Promise.all(pending)
console.log(process.exitCode ? 'self-test FAILED' : `self-test ok (${n} groups)`)
