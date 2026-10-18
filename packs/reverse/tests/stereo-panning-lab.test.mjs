// Node tests for the pure parts of the stereo panning lab.   node packs/reverse/tests/stereo-panning-lab.test.mjs
import assert from 'node:assert/strict'
import {
  equalPowerGains, linearGains, stereoPannerOutput, toDb, levels, distanceGain, azimuth, directionWord, lfo, msPoint, pinkNoise,
  beepSequence, sliderToFreq, freqToSlider,
} from '../stereo-panning-lab.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error(`FAIL ${name}`); throw e } }
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

t('equal-power law: ends, center and constant power', () => {
  let g = equalPowerGains(-1); near(g.l, 1); near(g.r, 0)
  g = equalPowerGains(1); near(g.l, 0); near(g.r, 1)
  g = equalPowerGains(0); near(g.l, Math.SQRT1_2); near(g.r, Math.SQRT1_2)
  near(toDb(g.l), -3.0103, 1e-3)
  for (let p = -1; p <= 1; p += 0.05) { const x = equalPowerGains(p); near(x.l * x.l + x.r * x.r, 1, 1e-12) }
  // out of range clamps like the AudioParam
  assert.deepEqual(equalPowerGains(5), equalPowerGains(1))
})
t('linear law dips to -6 dB at center', () => {
  const g = linearGains(0); near(g.l, 0.5); near(toDb(g.l), -6.0206, 1e-3)
  near(linearGains(-1).l, 1); near(linearGains(0.5).r, 0.75)
})
t('StereoPannerNode spec: mono and stereo inputs', () => {
  const m = stereoPannerOutput(0, 1); near(m.l, Math.SQRT1_2); near(m.r, Math.SQRT1_2)
  // stereo, centered: unchanged
  let s = stereoPannerOutput(0, 0.3, 0.6); near(s.l, 0.3); near(s.r, 0.6)
  // stereo, hard left: right folds fully into left
  s = stereoPannerOutput(-1, 0.3, 0.6); near(s.l, 0.9); near(s.r, 0)
  // stereo, hard right
  s = stereoPannerOutput(1, 0.3, 0.6); near(s.l, 0); near(s.r, 0.9)
})
t('levels: RMS and peak in dBFS', () => {
  const sine = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 100 * i) / 48000))
  const lv = levels(sine)
  near(lv.rms, -3.0103, 0.01); near(lv.peak, 0, 0.01)
  assert.deepEqual(levels(new Float32Array(64)), { rms: -100, peak: -100 })
})
t('distance models follow the spec', () => {
  near(distanceGain('inverse', 1, 1, 100, 1), 1)
  near(distanceGain('inverse', 2, 1, 100, 1), 0.5)
  near(distanceGain('inverse', 0.2, 1, 100, 1), 1) // inside ref distance
  near(distanceGain('linear', 55.5, 1, 100, 1), 1 - 54.5 / 99)
  near(distanceGain('linear', 500, 1, 100, 1), 0)
  near(distanceGain('linear', 500, 1, 100, 3), 0) // rolloff clamps to 1
  near(distanceGain('exponential', 4, 1, 100, 2), 1 / 16)
})
t('azimuth and direction words', () => {
  near(azimuth(0, -3), 0); near(azimuth(3, 0), 90); near(azimuth(-3, 0), -90); near(Math.abs(azimuth(0, 3)), 180)
  assert.equal(directionWord(0), 'in front'); assert.equal(directionWord(90), 'hard right'); assert.equal(directionWord(-45), 'front left'); assert.equal(directionWord(179), 'behind')
})
t('lfo and goniometer mapping', () => {
  near(lfo(0.25, 1, 0.8), 0.8); near(lfo(0, 3, 1), 0)
  let p = msPoint(1, 1); near(p.x, 0); near(p.y, Math.SQRT2) // mono: vertical
  p = msPoint(1, 0); assert.ok(p.x < 0 && p.y > 0) // left only leans left
  p = msPoint(1, -1); near(p.y, 0) // out of phase: horizontal
})
t('pink noise is normalized and tilts toward the low end', () => {
  let seed = 9
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
  const x = pinkNoise(48000, rand, 0.5)
  near(Math.max(...x.map(Math.abs)), 0.5, 1e-6)
  // pink noise has positive correlation between neighbours (white noise has about zero)
  let c = 0, e = 0
  for (let i = 1; i < x.length; i++) { c += x[i] * x[i - 1]; e += x[i] * x[i] }
  assert.ok(c / e > 0.5, `lag-1 correlation ${c / e}`)
})
t('beep sequence and frequency slider', () => {
  const b = beepSequence(8000)
  assert.equal(b.length, 16000)
  assert.ok(Math.max(...b) <= 0.46 && Math.max(...b) > 0.3)
  assert.equal(b[Math.round(1.9 * 8000)], 0) // gap before the loop restarts
  assert.equal(sliderToFreq(0), 50); assert.equal(sliderToFreq(100), 5000); assert.equal(sliderToFreq(freqToSlider(440)), 440)
})

console.log(`ok - ${n} stereo panning tests`)
