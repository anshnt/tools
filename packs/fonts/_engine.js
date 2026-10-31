// The WebAssembly engines behind the font tools: WOFF2 (Google woff2, via woff2-encoder, MIT) and subsetting (HarfBuzz hb-subset, via harfbuzzjs, MIT).
// DOM-free so it runs in a Web Worker (see _worker.js) or on the main thread. Libraries are pinned and loaded from the CDN on first use.
const URLS = {
  woff2: 'https://cdn.jsdelivr.net/npm/woff2-encoder@2.0.0/dist/index.js',
  woff2Decode: 'https://cdn.jsdelivr.net/npm/woff2-encoder@2.0.0/dist/decompress.js',
  hb: 'https://cdn.jsdelivr.net/npm/harfbuzzjs@1.6.3/dist/harfbuzz-subset.wasm',
  opentype: 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.module.js',
}
export const LIB_URLS = URLS

// Test hook: Node tests (which cannot import https URLs) can set globalThis.FONT_LIBS = { woff2, woff2Decode, opentype } to local modules.
const over = (k) => globalThis.FONT_LIBS?.[k]
const cache = new Map()
const once = (k, fn) => {
  if (!cache.has(k)) cache.set(k, fn().catch((e) => { cache.delete(k); throw Object.assign(new Error('Could not load the font engine. Check your connection and try again.'), { cause: e }) }))
  return cache.get(k)
}

export const loadOpentype = () => once('opentype', async () => (await import(over('opentype') || URLS.opentype)).default)

export async function woff2Compress(bytes) {
  const m = await once('woff2', () => import(over('woff2') || URLS.woff2))
  return m.compress(bytes)
}
export async function woff2Decompress(bytes) {
  const m = await once('woff2d', () => import(over('woff2Decode') || URLS.woff2Decode))
  return m.default(bytes)
}

// ---------- HarfBuzz subsetter ----------
const hbModule = () => once('hb', async () => {
  const src = over('hb')
  const buf = src ? src : await (await fetch(URLS.hb)).arrayBuffer()
  const { instance } = await WebAssembly.instantiate(buf, {})
  instance.exports._initialize?.()
  return instance.exports
})

const SUBSET_FLAGS = { NO_HINTING: 1, SET_OVERLAPS_FLAG: 16, NOTDEF_OUTLINE: 64 }

/**
 * Keep only `unicodes` (and the glyphs, layout rules and variations they need). Input and output are SFNT bytes (TTF or OTF).
 * opts: { noHinting, layout: 'default'|'all'|'none', pinAxes (variable fonts: freeze at the default instance) }
 */
export async function hbSubset(font, { unicodes, noHinting = false, layout = 'default', pinAxes = false }) {
  const x = await hbModule()
  const heap = () => new Uint8Array(x.memory.buffer)
  const ptr = x.malloc(font.length)
  heap().set(font, ptr)
  const blob = x.hb_blob_create(ptr, font.length, 0, 0, 0) // duplicate mode: hb keeps its own copy
  x.free(ptr)
  const face = x.hb_face_create(blob, 0)
  x.hb_blob_destroy(blob)
  const input = x.hb_subset_input_create_or_fail()
  if (!input) { x.hb_face_destroy(face); throw new Error('The subsetter could not start.') }
  let outFace = 0, outBlob = 0
  try {
    const set = x.hb_subset_input_unicode_set(input)
    for (const cp of unicodes) x.hb_set_add(set, cp)
    x.hb_subset_input_set_flags(input, SUBSET_FLAGS.NOTDEF_OUTLINE | (noHinting ? SUBSET_FLAGS.NO_HINTING : 0))
    if (layout !== 'default') {
      const feats = x.hb_subset_input_set(input, 6) // HB_SUBSET_SETS_LAYOUT_FEATURE_TAG
      x.hb_set_clear(feats)
      if (layout === 'all') x.hb_set_invert(feats)
    }
    if (pinAxes) x.hb_subset_input_pin_all_axes_to_default(input, face)
    outFace = x.hb_subset_or_fail(face, input)
    if (!outFace) throw new Error('Subsetting failed. The font may be damaged or use an unsupported feature.')
    outBlob = x.hb_face_reference_blob(outFace)
    const len = x.hb_blob_get_length(outBlob), p = x.hb_blob_get_data(outBlob, 0)
    if (!len) throw new Error('Subsetting produced an empty font.')
    return heap().slice(p, p + len)
  } finally {
    if (outBlob) x.hb_blob_destroy(outBlob)
    if (outFace) x.hb_face_destroy(outFace)
    x.hb_subset_input_destroy(input)
    x.hb_face_destroy(face)
  }
}
