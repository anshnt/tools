// Self-check for the pure logic (no DOM needed). Run: node packs/studio-motion/_selftest.js
import assert from 'node:assert/strict'
import { bezier, valueAt, setKey, removeKey, enableAnim, disableAnim, normalizeKeys, setValue, isAnimated, EASE } from './_anim.js'
import { makeDoc, makeLayer, sanitizeDoc, makeEffect, propList, resolveProp, findLayer } from './_model.js'
import { selAmount } from './_render.js'
import { PRESETS, TEMPLATES, buildTemplate, applyPreset } from './_presets.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} is not near ${b}`)

// easing curves
const lin = bezier(0, 0, 1, 1), ease = bezier(...EASE.easeInOut)
near(lin(0.3), 0.3); near(ease(0), 0); near(ease(1), 1); near(ease(0.5), 0.5, 1e-3)
assert.ok(ease(0.2) < 0.2 && ease(0.8) > 0.8, 'ease in/out is slow at both ends')
assert.ok(bezier(...EASE.overshoot)(0.6) > 1, 'overshoot goes past 1')

// keyframes: interpolate, hold, 2D values, add/remove, stopwatch
const p = { v: 0 }
enableAnim(p, 0); setKey(p, 2, 100, null)
near(valueAt(p, 1), 50); near(valueAt(p, -1), 0); near(valueAt(p, 5), 100)
p.k[0].e = 'hold'; near(valueAt(p, 1.9), 0)
const q = { v: [0, 0] }
setValue(q, 0, [0, 0]); enableAnim(q, 0); setKey(q, 1, [10, 20], null); q.k[0].e = undefined
assert.deepEqual(valueAt(q, 0.5), [5, 10])
setKey(p, 2, 50, null); assert.equal(p.k.length, 2, 'same time updates the key')
removeKey(p, p.k[0].id); removeKey(p, p.k[0].id); assert.ok(!isAnimated(p), 'removing the last key keeps a static value'); assert.equal(p.v, 50)
enableAnim(p, 0); setKey(p, 1, 80); disableAnim(p, 1); near(p.v, 80)
const m = { v: 0, k: [{ id: 'a', t: 1, v: 1 }, { id: 'b', t: 1.00001, v: 2 }, { id: 'c', t: 3, v: 3 }] }
normalizeKeys(m); assert.equal(m.k.length, 2, 'keys on the same time merge')

// text animator selection: the typewriter reveals one character at a time
const visible = (start, n) => Array.from({ length: n }, (_, i) => 1 - selAmount('square', (i + 0.5) / n * 100, start, 100))
assert.deepEqual(visible(0, 4), [0, 0, 0, 0]); assert.deepEqual(visible(50, 4), [1, 1, 0, 0]); assert.deepEqual(visible(100, 4), [1, 1, 1, 1])
near(selAmount('ramp', 50, 0, 100), 0.5); near(selAmount('smooth', 50, 0, 100), 1); near(selAmount('smooth', 100, 0, 100), 0)

// documents: every template survives sanitising and has valid layers; presets add keyframes inside the comp
for (const [id] of TEMPLATES) {
  const doc = buildTemplate(id)
  const clean = sanitizeDoc(JSON.parse(JSON.stringify(doc)))
  assert.equal(JSON.stringify(clean.comp), JSON.stringify(doc.comp), `${id}: comp is stable`)
  assert.equal(clean.layers.length, doc.layers.length, `${id}: layers survive`)
}
assert.throws(() => sanitizeDoc({ nope: 1 }), /not a Motion Studio project/)
const doc = makeDoc()
const text = makeLayer(doc, 'text'), shape = makeLayer(doc, 'shape')
doc.layers.push(text, shape)
for (const preset of PRESETS) {
  const n = applyPreset(preset, [text, shape], doc, 1)
  assert.ok(n >= 1, `${preset.id} applies to a layer`)
}
for (const L of [text, shape]) for (const { key } of propList(L)) {
  const pr = resolveProp(L, key)
  for (const k of pr.k || []) assert.ok(Number.isFinite(k.t) && k.t >= 0 && k.v !== undefined, `${L.type}.${key} keyframe is valid`)
}
shape.effects.push(makeEffect('glow'))
assert.ok(propList(shape).some((d) => d.key.startsWith('fx:')), 'effect params are animatable')
assert.equal(findLayer(doc, shape.id).index, 1)
console.log('motion studio self-check: ok')
