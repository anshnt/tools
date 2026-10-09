// Minimal EXIF reader for JPEG files: camera, lens, exposure settings and capture time.
// Only the first 256 KB are read. Any problem returns null, so a strange file never blocks an import.

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

function readIfd(v, base, le, ptr) {
  const out = {}
  const u16 = (o) => v.getUint16(base + o, le), u32 = (o) => v.getUint32(base + o, le)
  const n = u16(ptr)
  for (let i = 0; i < n && i < 200; i++) {
    const e = ptr + 2 + i * 12
    if (base + e + 12 > v.byteLength) break
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4)
    const size = (TYPE_SIZE[type] || 1) * count
    const at = size <= 4 ? e + 8 : u32(e + 8)
    if (base + at + Math.min(size, 256) > v.byteLength) continue
    if (type === 2) {
      let s = ''
      for (let k = 0; k < count && k < 128; k++) { const c = v.getUint8(base + at + k); if (!c) break; s += String.fromCharCode(c) }
      out[tag] = s.trim()
    } else if (type === 3) out[tag] = v.getUint16(base + at, le)
    else if (type === 4) out[tag] = v.getUint32(base + at, le)
    else if (type === 5 || type === 10) out[tag] = [type === 5 ? v.getUint32(base + at, le) : v.getInt32(base + at, le), type === 5 ? v.getUint32(base + at + 4, le) : v.getInt32(base + at + 4, le)]
  }
  return out
}

const ratio = (r) => (Array.isArray(r) && r[1] ? r[0] / r[1] : null)

/** Returns {camera, lens, shutter, aperture, iso, focal, taken} (strings, taken in ms) or null. */
export async function readExif(blob) {
  try {
    const v = new DataView(await blob.slice(0, 262144).arrayBuffer())
    if (v.byteLength < 12 || v.getUint16(0) !== 0xffd8) return null
    let off = 2
    while (off + 10 < v.byteLength) {
      const marker = v.getUint16(off)
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break
      const len = v.getUint16(off + 2)
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
        const base = off + 10
        const le = v.getUint16(base) === 0x4949
        const first = readIfd(v, base, le, v.getUint32(base + 4, le))
        const sub = first[0x8769] ? readIfd(v, base, le, first[0x8769]) : {}
        const t = ratio(sub[0x829a]), f = ratio(sub[0x829d]), fl = ratio(sub[0x920a])
        const camera = [first[0x010f], first[0x0110]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
        const when = String(sub[0x9003] || first[0x0132] || '').match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/)
        const out = {
          camera: camera.slice(0, 80), lens: String(sub[0xa434] || '').slice(0, 80),
          shutter: t ? (t >= 1 ? `${+t.toFixed(1)} s` : `1/${Math.round(1 / t)} s`) : '',
          aperture: f ? `f/${+f.toFixed(1)}` : '', iso: sub[0x8827] ? `ISO ${sub[0x8827]}` : '', focal: fl ? `${Math.round(fl)} mm` : '',
          taken: when ? new Date(+when[1], +when[2] - 1, +when[3], +when[4], +when[5], +when[6]).getTime() : 0,
        }
        return Object.values(out).some(Boolean) ? out : null
      }
      off += 2 + len
    }
  } catch { /* unreadable EXIF is fine */ }
  return null
}
