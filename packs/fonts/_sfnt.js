// Font containers: read TTF, OTF, WOFF, WOFF2 and EOT into a table map, and write them back. DOM-free (uses CompressionStream and the wasm engines).
import { dv, parseName, pickName } from './_info.js'
import { call } from './_run.js'

export const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2', 'eot']
const tagOf = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }

/** 'ttf' | 'otf' (by magic number only) | 'woff' | 'woff2' | 'eot' | 'ttc' | 'fon' | 'fnt' | null */
export function sniff(b) {
  if (b.length < 12) return null
  const m = tagOf(b, 0)
  if (m === 'wOFF') return 'woff'
  if (m === 'wOF2') return 'woff2'
  if (m === 'OTTO') return 'otf'
  if (m === 'ttcf') return 'ttc'
  if (m === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'ttf'
  if (b.length > 36 && b[34] === 0x4c && b[35] === 0x50) return 'eot'
  if (b[0] === 0x4d && b[1] === 0x5a) return 'fon'
  if (b.length >= 118 && b[0] === 0 && (b[1] === 2 || b[1] === 3) && dv(b).getUint32(2, true) <= b.length + 4) return 'fnt'
  return null
}

const flavorOf = (tables) => (tables.has('CFF ') || tables.has('CFF2') ? 'otf' : 'ttf')

function parseSfnt(b) {
  const v = dv(b)
  const n = v.getUint16(4)
  if (!n || 12 + n * 16 > b.length) fail('This does not look like a valid font file.')
  const tables = new Map()
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16
    const off = v.getUint32(r + 8), len = v.getUint32(r + 12)
    if (off + len > b.length) fail('The font file is cut off (a table runs past the end of the file).')
    tables.set(tagOf(b, r), b.slice(off, off + len))
  }
  return tables
}

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}
async function deflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}

async function parseWoff(b) {
  const v = dv(b)
  const n = v.getUint16(12)
  const tables = new Map()
  for (let i = 0; i < n; i++) {
    const r = 44 + i * 20
    if (r + 20 > b.length) fail('The WOFF file is cut off.')
    const off = v.getUint32(r + 4), comp = v.getUint32(r + 8), orig = v.getUint32(r + 12)
    if (off + comp > b.length) fail('The WOFF file is cut off (a table runs past the end of the file).')
    let data = b.subarray(off, off + comp)
    if (comp < orig) {
      data = await inflate(data)
      if (data.length !== orig) fail('A table in this WOFF file did not decompress correctly.')
    } else data = data.slice()
    tables.set(tagOf(b, r), data)
  }
  return tables
}

/** EOT: header, then the font data at the end. Plain and XOR-obfuscated data work; MicroType Express compression does not. */
function parseEot(b) {
  const v = dv(b)
  const size = v.getUint32(0, true), dataSize = v.getUint32(4, true), flags = v.getUint32(12, true)
  if (flags & 0x4) fail('This EOT file uses MicroType Express compression, which is not supported here. Export it again without compression, or convert it with the tool that made it.')
  const end = size <= b.length && size >= dataSize ? size : b.length
  if (dataSize === 0 || end - dataSize < 82) fail('This EOT file is damaged.')
  const data = b.slice(end - dataSize, end)
  if (flags & 0x10000000) for (let i = 0; i < data.length; i++) data[i] ^= 0x50
  return data
}

/**
 * Read any supported font into {tables: Map(tag -> Uint8Array), flavor: 'ttf'|'otf', source}. Tables are copies you may change.
 */
export async function readFont(bytes) {
  const source = sniff(bytes)
  let tables
  if (source === 'ttf' || source === 'otf') tables = parseSfnt(bytes)
  else if (source === 'woff') tables = await parseWoff(bytes)
  else if (source === 'woff2') tables = parseSfnt(await call('woff2Decompress', [bytes]).catch(() => fail('This WOFF2 file could not be decoded. It may be damaged.')))
  else if (source === 'eot') tables = parseSfnt(parseEot(bytes))
  else if (source === 'ttc') fail('This is a font collection (.ttc). Collections are not supported yet, so extract one font from it first.')
  else fail('This does not look like a TTF, OTF, WOFF, WOFF2 or EOT font.')
  for (const t of ['head', 'hhea', 'maxp']) if (!tables.has(t)) fail(`The font has no "${t}" table, so it cannot be read.`)
  return { tables, flavor: flavorOf(tables), source }
}

const sum32 = (b, from, len) => {
  const v = dv(b)
  let s = 0
  for (let i = 0; i < len; i += 4) s = (s + v.getUint32(from + i)) >>> 0
  return s
}

/** Build SFNT bytes from a table map (sorted directory, 4-byte alignment, checksums, head.checkSumAdjustment). */
export function writeSfnt(tables) {
  const tags = [...tables.keys()].sort()
  const n = tags.length
  const dirLen = 12 + n * 16
  const sizes = tags.map((t) => (tables.get(t).length + 3) & ~3)
  const out = new Uint8Array(dirLen + sizes.reduce((a, b) => a + b, 0))
  const v = dv(out)
  v.setUint32(0, flavorOf(tables) === 'otf' ? 0x4f54544f : 0x00010000)
  v.setUint16(4, n)
  const pow = 2 ** Math.floor(Math.log2(n))
  v.setUint16(6, pow * 16); v.setUint16(8, Math.log2(pow)); v.setUint16(10, n * 16 - pow * 16)
  let off = dirLen, headOff = -1
  tags.forEach((t, i) => {
    const data = tables.get(t)
    out.set(data, off)
    if (t === 'head') { headOff = off; v.setUint32(off + 8, 0) }
    const r = 12 + i * 16
    for (let k = 0; k < 4; k++) out[r + k] = t.charCodeAt(k)
    v.setUint32(r + 4, sum32(out, off, sizes[i]))
    v.setUint32(r + 8, off)
    v.setUint32(r + 12, data.length)
    off += sizes[i]
  })
  if (headOff >= 0) v.setUint32(headOff + 8, (0xb1b0afba - sum32(out, 0, out.length)) >>> 0)
  return out
}

/** WOFF 1.0: each table zlib-compressed when that makes it smaller. */
export async function writeWoff(tables, onProgress) {
  const sfnt = writeSfnt(tables) // gives the exact table checksums and sizes
  const sv = dv(sfnt)
  const n = sv.getUint16(4)
  const recs = []
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16
    const off = sv.getUint32(r + 8), len = sv.getUint32(r + 12)
    const orig = sfnt.subarray(off, off + len)
    let comp = await deflate(orig)
    if (comp.length >= orig.length) comp = orig
    recs.push({ tag: tagOf(sfnt, r), checksum: sv.getUint32(r + 4), orig: len, data: comp })
    onProgress?.((i + 1) / n)
  }
  const dirLen = 44 + n * 20
  const total = dirLen + recs.reduce((a, r) => a + ((r.data.length + 3) & ~3), 0)
  const out = new Uint8Array(total)
  const v = dv(out)
  v.setUint32(0, 0x774f4646)
  v.setUint32(4, sv.getUint32(0))
  v.setUint32(8, total)
  v.setUint16(12, n)
  v.setUint32(16, 12 + n * 16 + recs.reduce((a, r) => a + ((r.orig + 3) & ~3), 0))
  const head = tables.get('head')
  if (head && head.length >= 8) { const hv = dv(head); v.setUint16(20, hv.getUint16(4)); v.setUint16(22, hv.getUint16(6)) }
  let off = dirLen
  recs.forEach((r, i) => {
    const d = 44 + i * 20
    for (let k = 0; k < 4; k++) out[d + k] = r.tag.charCodeAt(k)
    v.setUint32(d + 4, off); v.setUint32(d + 8, r.data.length); v.setUint32(d + 12, r.orig); v.setUint32(d + 16, r.checksum)
    out.set(r.data, off)
    off += (r.data.length + 3) & ~3
  })
  return out
}

/** EOT (version 0x00020001) wrapping an uncompressed TrueType font. */
export function writeEot(tables) {
  if (flavorOf(tables) !== 'ttf') fail('EOT can only hold TrueType outlines.')
  const font = writeSfnt(tables)
  const names = parseName(tables.get('name'))
  const strs = [pickName(names, 1), pickName(names, 2), pickName(names, 5), pickName(names, 4)].map((s) => {
    const b = new Uint8Array(s.length * 2)
    for (let i = 0; i < s.length; i++) { b[i * 2] = s.charCodeAt(i) & 255; b[i * 2 + 1] = s.charCodeAt(i) >> 8 }
    return b
  })
  const os2 = tables.get('OS/2')
  const o = os2 ? dv(os2) : null
  const hdr = 82 + strs.reduce((a, s) => a + s.length + 4, 0) + 2 // 82 fixed bytes, four names (size, text, padding), then the empty root string
  const total = hdr + font.length
  const out = new Uint8Array(total)
  const v = dv(out)
  v.setUint32(0, total, true); v.setUint32(4, font.length, true); v.setUint32(8, 0x00020001, true); v.setUint32(12, 0, true)
  if (os2 && os2.length >= 42) out.set(os2.subarray(32, 42), 16)
  out[26] = 1 // DEFAULT_CHARSET
  out[27] = o && (o.getUint16(62) & 1) ? 1 : 0
  v.setUint32(28, o ? o.getUint16(4) : 400, true)
  v.setUint16(32, o ? o.getUint16(8) : 0, true)
  v.setUint16(34, 0x504c, true)
  if (os2 && os2.length >= 58) for (let i = 0; i < 4; i++) v.setUint32(36 + i * 4, o.getUint32(42 + i * 4), true)
  if (os2 && os2.length >= 86 && o.getUint16(0) >= 1) { v.setUint32(52, o.getUint32(78), true); v.setUint32(56, o.getUint32(82), true) }
  const fv = dv(font)
  for (let i = 0; i < fv.getUint16(4); i++) if (tagOf(font, 12 + i * 16) === 'head') v.setUint32(60, fv.getUint32(fv.getUint32(12 + i * 16 + 8) + 8), true) // checkSumAdjustment of the final font
  let p = 80 // reserved1-4 are zero (64..79); padding1 sits at 80
  v.setUint16(p, 0, true); p += 2
  for (const s of strs) {
    v.setUint16(p, s.length, true); p += 2
    out.set(s, p); p += s.length
    v.setUint16(p, 0, true); p += 2 // padding before the next field
  }
  v.setUint16(p, 0, true); p += 2 // root string size 0
  if (p !== hdr) fail('Internal EOT layout error.')
  out.set(font, hdr)
  return out
}
