// Node tests for the pure parts of the bullet pattern designer.   node packs/reverse/tests/bullet-pattern-designer.test.mjs
import assert from 'node:assert/strict'
import {
  WORLD, MAX_BULLETS, FIXED_DT, TYPES, LIMITS, PRESETS, defaultEmitter, normalizeEmitter, normalizePattern, encodePattern, decodePattern,
  makeRng, spawnBullets, createState, syncState, step, simulate,
} from '../bullet-pattern-designer.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error(`FAIL ${name}`); throw e } }
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)
const DEG = Math.PI / 180
const O = { x: 400, y: 300 }

t('ring spreads bullets evenly around the circle', () => {
  const e = { ...defaultEmitter('ring'), count: 8, angle: 0, spin: 0 }
  const b = spawnBullets(e, 0, { origin: O })
  assert.equal(b.length, 8)
  b.forEach((x, i) => { near(x.dir, (i * Math.PI * 2) / 8); assert.equal(x.x, 400); assert.equal(x.speed, e.speed) })
})
t('spin rotates the base angle with time', () => {
  const e = { ...defaultEmitter('spiral'), count: 1, angle: 10, spin: 90 }
  near(spawnBullets(e, 0, { origin: O })[0].dir, 10 * DEG)
  near(spawnBullets(e, 2, { origin: O })[0].dir, 190 * DEG)
})
t('fan covers the spread symmetrically, ends included', () => {
  const e = { ...defaultEmitter('fan'), count: 5, spread: 60, angle: 90, spin: 0 }
  const d = spawnBullets(e, 0, { origin: O }).map((b) => b.dir / DEG)
  ;[60, 75, 90, 105, 120].forEach((v, i) => near(d[i], v, 1e-9))
  const one = spawnBullets({ ...e, count: 1 }, 0, { origin: O })
  near(one[0].dir, 90 * DEG)
  // a full-circle fan must not double the first bullet
  const full = spawnBullets({ ...e, count: 4, spread: 360 }, 0, { origin: O }).map((b) => Math.round(b.dir / DEG))
  assert.deepEqual(full, [90, 180, 270, 360])
})
t('wave sweeps its aim by half the spread at the wave frequency', () => {
  const e = { ...defaultEmitter('wave'), count: 1, spread: 80, waveFreq: 0.25, angle: 90, spin: 0 }
  near(spawnBullets(e, 0, { origin: O })[0].dir, 90 * DEG)
  near(spawnBullets(e, 1, { origin: O })[0].dir, 130 * DEG) // sin(2 PI * 0.25 * 1) = 1
  near(spawnBullets(e, 3, { origin: O })[0].dir, 50 * DEG)
})
t('aimed fires at the target plus the angle offset', () => {
  const e = { ...defaultEmitter('aimed'), count: 1, angle: 0, spread: 0 }
  near(spawnBullets(e, 0, { origin: { x: 0, y: 0 }, target: { x: 100, y: 100 } })[0].dir, 45 * DEG)
  near(spawnBullets({ ...e, angle: 10 }, 0, { origin: { x: 0, y: 0 }, target: { x: 0, y: -50 } })[0].dir, -80 * DEG)
})
t('burst stays inside the spread and speed range, and is deterministic with a seed', () => {
  const e = { ...defaultEmitter('burst'), count: 200, spread: 90, angle: 0, speed: 100, spin: 0 }
  const a = spawnBullets(e, 0, { origin: O, rand: makeRng(5) })
  const b = spawnBullets(e, 0, { origin: O, rand: makeRng(5) })
  assert.deepEqual(a, b)
  for (const x of a) { assert.ok(Math.abs(x.dir) <= 45 * DEG + 1e-9); assert.ok(x.speed >= 60 && x.speed <= 140) }
})
t('normalize clamps bad values and rejects non-patterns', () => {
  const e = normalizeEmitter({ type: 'nope', count: 9999, speed: 'fast', color: 'plaid', rate: -4 })
  assert.equal(e.type, 'ring'); assert.equal(e.count, LIMITS.count[1]); assert.equal(e.rate, LIMITS.rate[0])
  assert.equal(e.speed, defaultEmitter('ring').speed); assert.equal(e.color, defaultEmitter('ring').color)
  assert.throws(() => normalizePattern(null), /not a pattern/)
  assert.throws(() => normalizePattern({ emitters: [] }), /no emitters/)
  const p = normalizePattern({ emitters: new Array(20).fill({ type: 'fan' }), origin: { x: 5, y: -1 } })
  assert.equal(p.emitters.length, 8); assert.deepEqual(p.origin, { x: 1, y: 0 })
})
t('share link round trip (base64url, unicode name)', () => {
  const p = normalizePattern({ ...PRESETS[2], name: 'Galáxia ✦' })
  const s = encodePattern(p)
  assert.match(s, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(decodePattern(s), p)
  assert.throws(() => decodePattern('%%%'), /damaged/)
})
t('step fires at the fire rate and moves bullets at their speed', () => {
  const p = normalizePattern({ origin: { x: 0.5, y: 0.5 }, emitters: [{ type: 'ring', count: 4, rate: 2, speed: 100, accel: 0, spin: 0, curve: 0, waveAmp: 0, life: 10, angle: 0 }] })
  const s = createState(p)
  simulate(s, 0.99) // shots at t = 0 and 0.5
  assert.equal(s.spawned, 8)
  // the first ring has travelled about 1 s * 100 px/s to the right
  const right = [...s.pool.slice(0, s.n)].filter((b) => Math.abs(b.dir) < 1e-9).sort((a, b) => b.x - a.x)[0]
  near(right.x, 400 + 100 * s.time, 1e-6)
  step(s, 0.5)
  assert.equal(s.spawned, 12)
})
t('acceleration, curve and lifetime', () => {
  const p = normalizePattern({ origin: { x: 0.5, y: 0.5 }, emitters: [{ type: 'ring', count: 1, rate: 0.2, speed: 50, accel: 20, curve: 90, life: 2, angle: 0, spin: 0 }] })
  const s = createState(p)
  step(s, 1)
  const b = s.pool[0]
  near(b.speed, 70); near(b.dir, 90 * DEG)
  step(s, 1.01)
  assert.equal(s.n, 0, 'bullet dies after its lifetime')
})
t('wave amplitude offsets sideways, and negative flips the phase', () => {
  const mk = (amp) => { const s = createState(normalizePattern({ origin: { x: 0.5, y: 0.5 }, emitters: [{ type: 'ring', count: 1, rate: 0.2, speed: 100, angle: 0, spin: 0, waveAmp: amp, waveFreq: 0.25, life: 10 }] })); step(s, 1); return s.pool[0] }
  const a = mk(30), b = mk(-30)
  near(a.y - 300, 30, 1e-6); near(b.y - 300, -30, 1e-6); near(a.x, b.x)
})
t('bullet cap holds and counts dropped bullets', () => {
  const p = normalizePattern({ emitters: [{ type: 'ring', count: 64, rate: 30, speed: 10, life: 12 }] })
  const s = createState(p, { cap: 500 })
  simulate(s, 1)
  assert.equal(s.n, 500); assert.ok(s.dropped > 0)
})
t('off-screen bullets are culled and the pool is reused', () => {
  const p = normalizePattern({ emitters: [{ type: 'ring', count: 32, rate: 10, speed: 600, life: 12 }] })
  const s = createState(p)
  simulate(s, 4)
  assert.ok(s.n < 32 * 10 * 1.5, `${s.n} alive`)
  assert.ok(s.pool.length <= MAX_BULLETS)
  for (let i = 0; i < s.n; i++) { const b = s.pool[i]; assert.ok(b.x > -60 && b.x < WORLD.w + 60 && b.y > -60 && b.y < WORLD.h + 60) }
})
t('syncState handles added emitters and faster rates', () => {
  const p = normalizePattern({ emitters: [{ type: 'ring', rate: 0.2 }] })
  const s = createState(p)
  step(s, 1)
  assert.ok(s.next[0] > 4)
  p.emitters[0].rate = 10
  p.emitters.push(defaultEmitter('fan'))
  syncState(s)
  assert.equal(s.next.length, 2)
  assert.ok(s.next[0] <= s.time + 0.1 + 1e-9)
  assert.equal(s.next[1], s.time)
})
t('every preset is valid, runs and stays under the cap at 60 s', () => {
  assert.ok(PRESETS.length >= 6)
  for (const pr of PRESETS) {
    assert.deepEqual(normalizePattern(pr), pr)
    const s = createState(pr)
    simulate(s, 8)
    assert.ok(s.n > 20, `${pr.name} shows bullets (${s.n})`)
    assert.ok(s.n <= MAX_BULLETS)
  }
  assert.equal(new Set(TYPES.map(([k]) => k)).size, 6)
})

console.log(`ok - ${n} bullet pattern tests`)
