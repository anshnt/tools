// Fonts: a small catalog of open (OFL) families served by pinned @fontsource packages, loaded on demand as WOFF.
// The same bytes feed the canvas (FontFace) and the PDF export (embedded with fontkit), so layout matches the file.
export const FAMILIES = [
  { id: 'inter', name: 'Inter', kind: 'Sans', ver: '5.2.8', weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  { id: 'montserrat', name: 'Montserrat', kind: 'Sans', ver: '5.2.8', weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  { id: 'poppins', name: 'Poppins', kind: 'Sans', ver: '5.2.7', weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  { id: 'oswald', name: 'Oswald', kind: 'Condensed', ver: '5.2.8', weights: [300, 400, 500, 600, 700], italic: false },
  { id: 'bebas-neue', name: 'Bebas Neue', kind: 'Display', ver: '5.2.7', weights: [400], italic: false },
  { id: 'playfair-display', name: 'Playfair Display', kind: 'Serif', ver: '5.2.8', weights: [400, 500, 600, 700, 800, 900], italic: true },
  { id: 'merriweather', name: 'Merriweather', kind: 'Serif', ver: '5.2.11', weights: [300, 400, 500, 600, 700, 800, 900], italic: true },
  { id: 'lora', name: 'Lora', kind: 'Serif', ver: '5.2.8', weights: [400, 500, 600, 700], italic: true },
  { id: 'dm-serif-display', name: 'DM Serif Display', kind: 'Display', ver: '5.2.8', weights: [400], italic: true },
  { id: 'roboto-mono', name: 'Roboto Mono', kind: 'Mono', ver: '5.2.9', weights: [300, 400, 500, 600, 700], italic: true },
  { id: 'dancing-script', name: 'Dancing Script', kind: 'Script', ver: '5.2.8', weights: [400, 500, 600, 700], italic: false },
]
const BY_ID = new Map(FAMILIES.map((f) => [f.id, f]))
export const WEIGHT_NAMES = { 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }
export const familyOf = (id) => BY_ID.get(id) || FAMILIES[0]

/** Resolve a family/weight/italic request to a concrete face that exists in the catalog. */
export function face(familyId, weight = 400, italic = false) {
  const fam = familyOf(familyId)
  const w = fam.weights.reduce((best, x) => (Math.abs(x - weight) < Math.abs(best - weight) ? x : best), fam.weights[0])
  const it = !!italic && fam.italic
  return { fam, weight: w, italic: it, key: `${fam.id}|${w}|${it ? 1 : 0}`, css: `LS ${fam.name}` }
}
export const faceUrl = (f) => `https://cdn.jsdelivr.net/npm/@fontsource/${f.fam.id}@${f.fam.ver}/files/${f.fam.id}-latin-${f.weight}-${f.italic ? 'italic' : 'normal'}.woff`
export const cssFont = (f, size) => `${f.italic ? 'italic ' : ''}${f.weight} ${size}px "${f.css}", sans-serif`

const state = new Map() // key -> {status: 'loading'|'ok'|'fail', bytes, promise}
const listeners = new Set()
export const onFontsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

export const isReady = (f) => state.get(f.key)?.status === 'ok'
export const hasFailed = (f) => state.get(f.key)?.status === 'fail'
/** Plain TrueType/OpenType bytes of a loaded face (what the PDF embeds; fontkit cannot subset WOFF directly). */
export const faceBytes = (f) => state.get(f.key)?.sfnt

async function inflate(u8) {
  const ds = new DecompressionStream('deflate')
  const w = ds.writable.getWriter()
  w.write(u8)
  w.close()
  return new Uint8Array(await new Response(ds.readable).arrayBuffer())
}
/** Unpack a WOFF 1.0 file into an sfnt (TTF/OTF) byte array. */
export async function woffToSfnt(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0) !== 0x774f4646) return buf
  const flavor = dv.getUint32(4), n = dv.getUint16(12)
  const tables = []
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20
    tables.push({ tag: dv.getUint32(o), off: dv.getUint32(o + 4), comp: dv.getUint32(o + 8), orig: dv.getUint32(o + 12), sum: dv.getUint32(o + 16) })
  }
  tables.sort((a, b) => a.tag - b.tag)
  const datas = await Promise.all(tables.map((t) => { const raw = buf.subarray(t.off, t.off + t.comp); return t.comp < t.orig ? inflate(raw) : raw.slice() }))
  let pos = 12 + 16 * n
  const total = tables.reduce((a, t) => a + ((t.orig + 3) & ~3), pos)
  const out = new Uint8Array(total)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, flavor)
  ov.setUint16(4, n)
  const es = Math.floor(Math.log2(n)), sr = 2 ** es * 16
  ov.setUint16(6, sr); ov.setUint16(8, es); ov.setUint16(10, n * 16 - sr)
  tables.forEach((t, i) => {
    const o = 12 + 16 * i
    ov.setUint32(o, t.tag); ov.setUint32(o + 4, t.sum); ov.setUint32(o + 8, pos); ov.setUint32(o + 12, t.orig)
    out.set(datas[i], pos)
    pos += (t.orig + 3) & ~3
  })
  return out
}

/** Load a face (fetch + register). Resolves true/false, never throws. */
export function load(f) {
  let s = state.get(f.key)
  if (s) return s.promise
  s = { status: 'loading' }
  s.promise = (async () => {
    try {
      const res = await fetch(faceUrl(f))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const ff = new FontFace(f.css, bytes.slice(), { weight: String(f.weight), style: f.italic ? 'italic' : 'normal' })
      await ff.load()
      document.fonts.add(ff)
      s.sfnt = await woffToSfnt(bytes)
      s.status = 'ok'
      metricsCache.delete(f.key)
      widths.clear() // widths measured with the fallback font are wrong now
    } catch (e) {
      console.warn('Font failed to load', f.key, e)
      s.status = 'fail'
    }
    for (const fn of listeners) fn(f)
    return s.status === 'ok'
  })()
  state.set(f.key, s)
  return s.promise
}
export const loadAll = (faces) => Promise.all([...new Map(faces.map((f) => [f.key, f])).values()].map(load))

// ---------- Measuring ----------
let mctx = null
function ctx() {
  if (!mctx) {
    mctx = document.createElement('canvas').getContext('2d')
    mctx.fontKerning = 'none' // the PDF export positions glyphs by advance width, so measure the same way
    mctx.textRendering = 'optimizeSpeed'
  }
  return mctx
}
const widths = new Map()
export function measure(font, text) {
  const k = font + '\u0000' + text
  let w = widths.get(k)
  if (w === undefined) {
    const c = ctx()
    if (c.font !== font) c.font = font
    w = c.measureText(text).width
    if (widths.size > 60000) widths.clear()
    widths.set(k, w)
  }
  return w
}
const metricsCache = new Map()
/** Ascent and descent as fractions of the font size (content box of the font). */
export function metrics(f) {
  let m = metricsCache.get(f.key)
  if (!m || (isReady(f) && !m.ready)) {
    const c = ctx()
    c.font = cssFont(f, 100)
    const t = c.measureText('Hxgjp')
    m = { asc: (t.fontBoundingBoxAscent ?? 90) / 100, desc: (t.fontBoundingBoxDescent ?? 25) / 100, ready: isReady(f) }
    metricsCache.set(f.key, m)
  }
  return m
}
