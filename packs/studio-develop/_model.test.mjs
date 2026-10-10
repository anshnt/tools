// Self-check for the pure logic of Photo Develop (settings, curves, crop geometry, export math, EXIF).
// Run: node packs/studio-develop/_model.test.mjs
import assert from 'node:assert/strict'
import * as M from './_model.js'
import { applyLook, cleanLook } from './_presets.js'
import { readExif } from './_exif.js'

const d = M.defaults()

// settings
assert.deepEqual(M.normalize(d), d)
assert.ok(M.isDefault(d))
assert.equal(M.normalize({ exposure: 99, rot: 5, crop: { x: 2, y: 2, w: 5, h: 5 } }).exposure, 5)
assert.equal(M.normalize({ rot: 5 }).rot, 1)
assert.ok(M.normalize({ crop: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } }).crop.x <= 0.5)

// tone curve: identity, monotone, passes through its points
assert.equal(M.curveTable([[0, 0], [255, 255]])[100], 100)
const t = M.curveTable([[0, 0], [64, 40], [192, 220], [255, 255]])
assert.equal(t[64], 40)
for (let i = 1; i < 256; i++) assert.ok(t[i] >= t[i - 1])

// geometry: rotating 90 degrees clockwise puts the raw bottom-left at the oriented top-left
let g = M.geometry({ ...d, rot: 1 }, 200, 100)
assert.deepEqual(g.p0.map((x) => +x.toFixed(6)), [0, 1])
assert.deepEqual(M.geometry({ ...d, flipH: true }, 200, 100).p0, [1, 0])

// crop stays inside a straightened image
const c = M.constrainCrop({ x: 0, y: 0, w: 1, h: 1 }, 10, 300, 200)
assert.ok(M.cropInside(c, 10, 300, 200) && c.w < 1)
const sq = M.aspectCrop(1, 0, 300, 200)
assert.ok(Math.abs(sq.w * 300 - sq.h * 200) < 1e-6)
assert.deepEqual(M.cropPixels({ ...d, crop: { x: 0, y: 0, w: 0.5, h: 1 } }, 300, 200), [150, 200])

// export sizing and names
assert.deepEqual(M.exportSize(6000, 4000, { mode: 'long', value: 1500 }), [1500, 1000])
assert.deepEqual(M.exportSize(600, 400, { mode: 'long', value: 1500 }), [600, 400])
assert.deepEqual(M.exportSize(600, 400, { mode: 'long', value: 1500, upscale: true }), [1500, 1000])
assert.equal(M.renderName('{name}-{nnn}', { name: 'IMG', n: 7 }), 'IMG-007')
assert.equal(M.renderName('a/b:{n}', { name: 'x', n: 1 }), 'a_b_1')

// presets: built-in looks replace the look but keep the crop; partial presets only touch their keys
const cropped = { ...d, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, contrast: 20, vibrance: 40 }
const replaced = applyLook(cropped, { exposure: 1 }, true)
assert.equal(replaced.exposure, 1); assert.equal(replaced.contrast, 0); assert.equal(replaced.crop.w, 0.5)
const merged = applyLook(cropped, { exposure: 1 }, false)
assert.equal(merged.exposure, 1); assert.equal(merged.contrast, 20)
assert.deepEqual(cleanLook({ exposure: 50, crop: { w: 0.1 }, nonsense: 1 }), { exposure: 5 })
const half = M.lerpSettings(d, { ...d, exposure: 2 }, 0.5)
assert.equal(half.exposure, 1)

// EXIF: a tiny big-endian segment with Make, ExposureTime (1/250) and ISO
function exifBlob() {
  const b = new Uint8Array(200); const v = new DataView(b.buffer)
  v.setUint16(0, 0xffd8); v.setUint16(2, 0xffe1); v.setUint16(4, 190)
  b.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6)
  const t = 12 // TIFF header start
  v.setUint16(t, 0x4d4d); v.setUint16(t + 2, 42); v.setUint32(t + 4, 8)
  // IFD0 at 8: Make (ascii, 5 bytes at offset 60) and ExifIFD pointer (to offset 80)
  v.setUint16(t + 8, 2)
  v.setUint16(t + 10, 0x010f); v.setUint16(t + 12, 2); v.setUint32(t + 14, 5); v.setUint32(t + 18, 60)
  v.setUint16(t + 22, 0x8769); v.setUint16(t + 24, 4); v.setUint32(t + 26, 1); v.setUint32(t + 30, 80)
  b.set([0x4e, 0x69, 0x6b, 0x6f, 0], t + 60) // "Niko"
  // ExifIFD at 80: ExposureTime rational at 120, ISO short
  v.setUint16(t + 80, 2)
  v.setUint16(t + 82, 0x829a); v.setUint16(t + 84, 5); v.setUint32(t + 86, 1); v.setUint32(t + 90, 120)
  v.setUint16(t + 94, 0x8827); v.setUint16(t + 96, 3); v.setUint32(t + 98, 1); v.setUint16(t + 102, 400)
  v.setUint32(t + 120, 1); v.setUint32(t + 124, 250)
  return new Blob([b])
}
const ex = await readExif(exifBlob())
assert.equal(ex.camera, 'Niko'); assert.equal(ex.shutter, '1/250 s'); assert.equal(ex.iso, 'ISO 400')
assert.equal(await readExif(new Blob([new Uint8Array(20)])), null)

console.log('photo-develop model ok')
