// Passport and ID photo data and helpers: size presets for 30+ countries, print sheet layout and 300 DPI metadata.
// Specs are the commonly published requirements. They differ slightly between sources, so the UI always tells people to
// confirm with the issuing authority.

const IN = 25.4

/**
 * w, h in mm. head: [min, max] chin-to-crown height in mm. bg: background color. Order within a group is display order.
 * group: 'passport' | 'id'
 */
export const PRESETS = [
  { id: 'us', cc: 'US', name: 'United States', kind: 'Passport & visa', w: 50.8, h: 50.8, head: [25, 35], bg: '#ffffff', group: 'passport', note: '2 x 2 in square, plain white or off-white background.' },
  { id: 'in-passport', cc: 'IN', name: 'India - Passport', kind: '35 x 45 mm', w: 35, h: 45, head: [25, 35], bg: '#ffffff', group: 'passport', note: 'Passport Seva photo on a plain white background. Online uploads are 630 x 810 px.' },
  { id: 'in-2x2', cc: 'IN', name: 'India - 2 x 2 in', kind: 'OCI, visa, abroad', w: 50.8, h: 50.8, head: [25, 35], bg: '#ffffff', group: 'passport', note: 'Square format used for OCI and for Indian passports applied for abroad.' },
  { id: 'gb', cc: 'GB', name: 'United Kingdom', kind: 'Passport', w: 35, h: 45, head: [29, 34], bg: '#e9e9e9', group: 'passport', note: 'Plain light grey or cream background, no shadows.' },
  { id: 'schengen', cc: 'EU', name: 'Schengen visa', kind: '35 x 45 mm', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'ICAO format used for Schengen visas and most EU passports.' },
  { id: 'de', cc: 'DE', name: 'Germany', kind: 'Passport & ID', w: 35, h: 45, head: [32, 36], bg: '#eeeeee', group: 'passport', note: 'Neutral light background.' },
  { id: 'fr', cc: 'FR', name: 'France', kind: 'Passport & ID', w: 35, h: 45, head: [32, 36], bg: '#e8eef3', group: 'passport', note: 'Plain light grey or light blue background.' },
  { id: 'it', cc: 'IT', name: 'Italy', kind: 'Passport & ID', w: 35, h: 45, head: [32, 36], bg: '#f2f2f2', group: 'passport', note: 'Plain light background.' },
  { id: 'nl', cc: 'NL', name: 'Netherlands', kind: 'Passport & ID', w: 35, h: 45, head: [32, 36], bg: '#f0f0f0', group: 'passport', note: 'Plain light grey background.' },
  { id: 'ie', cc: 'IE', name: 'Ireland', kind: 'Passport', w: 35, h: 45, head: [29, 34], bg: '#eeeeee', group: 'passport', note: 'Plain light background.' },
  { id: 'ca', cc: 'CA', name: 'Canada', kind: 'Passport', w: 50, h: 70, head: [31, 36], bg: '#ffffff', group: 'passport', note: '50 x 70 mm, plain white or light background.' },
  { id: 'au', cc: 'AU', name: 'Australia', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'Plain white or light grey background.' },
  { id: 'nz', cc: 'NZ', name: 'New Zealand', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'Plain light background.' },
  { id: 'cn', cc: 'CN', name: 'China', kind: 'Passport & visa', w: 33, h: 48, head: [28, 33], bg: '#ffffff', group: 'passport', note: '33 x 48 mm, white background, color photo.' },
  { id: 'jp', cc: 'JP', name: 'Japan', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'Plain white or pale background, no smile.' },
  { id: 'kr', cc: 'KR', name: 'South Korea', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'White background.' },
  { id: 'tw', cc: 'TW', name: 'Taiwan', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'White background.' },
  { id: 'sg', cc: 'SG', name: 'Singapore', kind: 'Passport', w: 35, h: 45, head: [31.5, 36], bg: '#ffffff', group: 'passport', note: 'Plain white background, face 70 to 80% of the photo.' },
  { id: 'my', cc: 'MY', name: 'Malaysia', kind: 'Passport', w: 35, h: 50, head: [32, 38], bg: '#ffffff', group: 'passport', note: '35 x 50 mm, white background.' },
  { id: 'ae', cc: 'AE', name: 'United Arab Emirates', kind: 'Visa', w: 43, h: 55, head: [38.5, 44], bg: '#ffffff', group: 'passport', note: 'White background, face 70 to 80% of the photo.' },
  { id: 'sa', cc: 'SA', name: 'Saudi Arabia', kind: 'Visa', w: 40, h: 60, head: [42, 48], bg: '#ffffff', group: 'passport', note: '40 x 60 mm, white background.' },
  { id: 'pk', cc: 'PK', name: 'Pakistan', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'White background.' },
  { id: 'lk', cc: 'LK', name: 'Sri Lanka', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'White background.' },
  { id: 'ph', cc: 'PH', name: 'Philippines', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'White background.' },
  { id: 'th', cc: 'TH', name: 'Thailand', kind: 'Passport & visa', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'White background.' },
  { id: 'vn', cc: 'VN', name: 'Vietnam', kind: 'Passport & visa', w: 40, h: 60, head: [36, 48], bg: '#ffffff', group: 'passport', note: '4 x 6 cm, white background.' },
  { id: 'za', cc: 'ZA', name: 'South Africa', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'White background.' },
  { id: 'br', cc: 'BR', name: 'Brazil', kind: 'Passport', w: 50, h: 70, head: [31, 36], bg: '#ffffff', group: 'passport', note: '5 x 7 cm, white background.' },
  { id: 'mx', cc: 'MX', name: 'Mexico', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'White background.' },
  { id: 'tr', cc: 'TR', name: 'Turkey', kind: 'Passport (biometric)', w: 50, h: 60, head: [36, 42], bg: '#ffffff', group: 'passport', note: '50 x 60 mm, plain light background.' },
  { id: 'ru', cc: 'RU', name: 'Russia', kind: 'Passport', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'Plain light background.' },
  { id: 'icao', cc: '**', name: 'Standard 35 x 45 mm', kind: 'ICAO generic', w: 35, h: 45, head: [32, 36], bg: '#ffffff', group: 'passport', note: 'The size most countries use when they do not list their own.' },
  { id: 'visa-4x6', cc: '**', name: 'Visa 4 x 6 cm', kind: 'Generic visa', w: 40, h: 60, head: [36, 48], bg: '#ffffff', group: 'passport', note: 'A common visa size.' },

  { id: 'in-pan', cc: 'IN', name: 'India - PAN card', kind: '25 x 35 mm', w: 25, h: 35, head: [18, 25], bg: '#ffffff', group: 'id', note: 'PAN application photo on a white background.' },
  { id: 'stamp', cc: '**', name: 'Stamp size', kind: '20 x 25 mm', w: 20, h: 25, head: [14, 19], bg: '#ffffff', group: 'id', note: 'Small photo for forms and applications.' },
  { id: 'id-25x30', cc: '**', name: 'Small ID', kind: '25 x 30 mm', w: 25, h: 30, head: [17, 23], bg: '#ffffff', group: 'id', note: 'Compact ID card and badge photo.' },
  { id: 'id-30x40', cc: '**', name: 'Student ID', kind: '30 x 40 mm', w: 30, h: 40, head: [22, 30], bg: '#ffffff', group: 'id', note: 'Student ID and library card photo.' },
  { id: 'form-35x45', cc: '**', name: 'Form photo', kind: '35 x 45 mm', w: 35, h: 45, head: [26, 34], bg: '#ffffff', group: 'id', note: 'Job, exam and application forms (3.5 x 4.5 cm).' },
  { id: 'dl-35x35', cc: '**', name: 'Licence square', kind: '35 x 35 mm', w: 35, h: 35, head: [22, 28], bg: '#ffffff', group: 'id', note: 'Square photo used by many licence offices.' },
  { id: 'id-40x50', cc: '**', name: 'Resume photo', kind: '40 x 50 mm', w: 40, h: 50, head: [28, 36], bg: '#ffffff', group: 'id', note: 'Resume, ID and office photo (4 x 5 cm).' },
  { id: 'us-2x2', cc: 'US', name: 'Square 2 x 2 in', kind: '2 x 2 in', w: 50.8, h: 50.8, head: [30, 40], bg: '#ffffff', group: 'id', note: 'Square ID photo.' },
]

export const byPresetId = new Map(PRESETS.map((p) => [p.id, p]))

/** Custom size preset from millimetres. */
export const customPreset = (w, h, headPct = 70, bg = '#ffffff') => ({
  id: 'custom', cc: '**', name: 'Custom size', kind: `${trim(w)} x ${trim(h)} mm`, w, h, head: [h * (headPct - 6) / 100, h * (headPct + 6) / 100], bg, group: 'custom', note: 'Your own size.',
})
export const trim = (n) => String(Math.round(n * 100) / 100)
/** '35 x 45 mm' or '2 x 2 in' for exact inch sizes. */
export function sizeText(p) {
  const wi = p.w / IN, hi = p.h / IN
  const inch = Math.abs(wi - Math.round(wi)) < 0.01 && Math.abs(hi - Math.round(hi)) < 0.01
  return inch ? `${Math.round(wi)} x ${Math.round(hi)} in` : `${trim(p.w)} x ${trim(p.h)} mm`
}

export const mmToPx = (mm, dpi = 300) => Math.max(1, Math.round((mm / IN) * dpi))
/** Target head height as a fraction of the photo height (middle of the allowed range). */
export const headTarget = (p) => (p.head[0] + p.head[1]) / 2 / p.h

/** Sheets: size in mm. */
export const SHEETS = [
  { id: '4x6', name: '4 x 6 in (10 x 15 cm)', w: 4 * IN, h: 6 * IN },
  { id: '5x7', name: '5 x 7 in (13 x 18 cm)', w: 5 * IN, h: 7 * IN },
  { id: 'a6', name: 'A6 (10.5 x 14.8 cm)', w: 105, h: 148 },
  { id: 'a4', name: 'A4 (21 x 29.7 cm)', w: 210, h: 297 },
  { id: 'letter', name: 'Letter (8.5 x 11 in)', w: 8.5 * IN, h: 11 * IN },
]

/**
 * How many photos of pw x ph mm fit on a sheet (all mm). Tries both sheet orientations and a rotated photo.
 * -> {cols, rows, count, landscape (sheet), rotated (photo), sw, sh, pw, ph, margin, gap, x0, y0}
 */
export function layoutSheet(sheet, pw, ph, margin = 3, gap = 1.5) {
  let best = null
  // Upright photos first: a rotated layout only wins when it fits strictly more.
  for (const rotated of [false, true]) {
    for (const landscape of [false, true]) {
      const sw = landscape ? sheet.h : sheet.w
      const sh = landscape ? sheet.w : sheet.h
      const w = rotated ? ph : pw
      const h = rotated ? pw : ph
      const cols = Math.floor((sw - 2 * margin + gap + 1e-6) / (w + gap))
      const rows = Math.floor((sh - 2 * margin + gap + 1e-6) / (h + gap))
      if (cols < 1 || rows < 1) continue
      const count = cols * rows
      if (!best || count > best.count) {
        const totalW = cols * w + (cols - 1) * gap, totalH = rows * h + (rows - 1) * gap
        best = { cols, rows, count, landscape, rotated, sw, sh, pw: w, ph: h, margin, gap, x0: (sw - totalW) / 2, y0: (sh - totalH) / 2 }
      }
    }
  }
  return best
}

/** Most photos that fit, trying generous to tight spacing. */
export function bestLayout(sheet, pw, ph) {
  let best = null
  // Photo-lab sheets can print to the edge; office paper needs a margin.
  const tries = sheet.w >= 200 ? [[6, 2], [5, 1.5], [4, 1]] : [[3, 2], [2, 1], [1, 0.5], [0, 0]]
  for (const [m, g] of tries) {
    const l = layoutSheet(sheet, pw, ph, m, g)
    if (l && (!best || l.count > best.count)) best = l
  }
  return best
}

// ---------------------------------------------------------------- DPI metadata

/** Write the pixel density into a JPEG (JFIF APP0). Returns a new Uint8Array. */
export function jpegSetDpi(bytes, dpi) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const hi = (dpi >> 8) & 255, lo = dpi & 255
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46) {
    const out = bytes.slice()
    out[13] = 1; out[14] = hi; out[15] = lo; out[16] = hi; out[17] = lo
    return out
  }
  const jfif = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, hi, lo, hi, lo, 0, 0]
  const out = new Uint8Array(bytes.length + jfif.length)
  out.set(bytes.subarray(0, 2), 0)
  out.set(jfif, 2)
  out.set(bytes.subarray(2), 2 + jfif.length)
  return out
}

let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Write the pixel density into a PNG (pHYs chunk). Returns a new Uint8Array. */
export function pngSetDpi(bytes, dpi) {
  const sig = 8
  const ppm = Math.round(dpi / 0.0254)
  const data = new Uint8Array(13)
  const dv = new DataView(data.buffer)
  data.set([0x70, 0x48, 0x59, 0x73], 0)          // 'pHYs'
  dv.setUint32(4, ppm); dv.setUint32(8, ppm); data[12] = 1
  const chunk = new Uint8Array(4 + 13 + 4)
  new DataView(chunk.buffer).setUint32(0, 9)
  chunk.set(data, 4)
  new DataView(chunk.buffer).setUint32(17, crc32(data))
  // Insert after IHDR (8 byte signature + 25 byte IHDR chunk), dropping any existing pHYs
  const out = []
  out.push(bytes.subarray(0, sig + 25), chunk)
  let p = sig + 25
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (p < bytes.length) {
    const len = view.getUint32(p)
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    if (type !== 'pHYs') out.push(bytes.subarray(p, p + 12 + len))
    p += 12 + len
  }
  const total = out.reduce((s, a) => s + a.length, 0)
  const res = new Uint8Array(total)
  let o = 0
  for (const a of out) { res.set(a, o); o += a.length }
  return res
}
