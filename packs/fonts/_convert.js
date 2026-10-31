// Font conversion routes, importable without any UI (the File Converter hub uses CONVERTERS). Engines load lazily on first use.
import { baseName, withExt } from '../../lib/files.js'
import { readFont, writeSfnt, writeWoff, writeEot, sniff } from './_sfnt.js'
import { call } from './_run.js'

export const FONT_MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', eot: 'application/vnd.ms-fontobject' }
export const FONT_LABEL = { ttf: 'TTF', otf: 'OTF', woff: 'WOFF', woff2: 'WOFF2', eot: 'EOT' }
const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }
const aborted = (signal) => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' }) }

/** Convert font bytes to another font format. Returns {bytes, note}. opts.accuracy: curve error in font units for CFF -> TrueType (default 1). */
export async function convertBytes(bytes, to, opts = {}, { signal, onProgress } = {}) {
  if (!FONT_MIME[to]) fail(`Cannot write ${to}.`)
  const font = await readFont(bytes)
  aborted(signal)
  let { tables, flavor } = font
  let note = ''
  const needTrueType = to === 'ttf' || to === 'eot'
  if (needTrueType && flavor === 'otf') {
    const { cffToTrueType } = await import('./_outline.js')
    tables = await cffToTrueType(tables, { tolerance: Number(opts.accuracy) || 1, signal, onProgress: (f) => onProgress?.(f * 0.8) })
    note = 'CFF outlines converted to TrueType'
  } else if (to === 'otf' && flavor === 'ttf') {
    const { trueTypeToCff } = await import('./_outline.js')
    tables = await trueTypeToCff(tables, { signal, onProgress: (f) => onProgress?.(f * 0.8) })
    note = 'TrueType outlines converted to CFF'
  }
  aborted(signal)
  onProgress?.(0.85)
  let out
  if (to === 'ttf' || to === 'otf') out = writeSfnt(tables)
  else if (to === 'woff') out = await writeWoff(tables)
  else if (to === 'eot') out = writeEot(tables)
  else out = await call('woff2Compress', [writeSfnt(tables)], { signal }).catch((e) => (e.code === 'ABORT' ? Promise.reject(e) : fail(`WOFF2 encoding failed: ${e.message}`)))
  onProgress?.(1)
  return { bytes: out, note }
}

/** File -> File. */
export async function convertFont(file, to, opts = {}, ctx = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { bytes: out } = await convertBytes(bytes, to, opts, ctx)
  return new File([out], withExt(file.name, to), { type: FONT_MIME[to] })
}

/** .fon / .fnt -> one TrueType file per size. */
export async function convertBitmapFont(file, { signal, onProgress } = {}) {
  const { readFonFile, fntToTtf } = await import('./_fon.js')
  const { fonts } = readFonFile(new Uint8Array(await file.arrayBuffer()))
  const used = new Set()
  const out = []
  for (let i = 0; i < fonts.length; i++) {
    aborted(signal)
    const f = fonts[i]
    let name = `${baseName(file.name)}-${f.fixed ? `${f.pixWidth}x${f.pixHeight}` : `${f.pixHeight}px`}`
    for (let n = 2; used.has(name); n++) name = `${baseName(file.name)}-${f.pixHeight}px-${n}`
    used.add(name)
    out.push(new File([fntToTtf(f)], `${name}.ttf`, { type: FONT_MIME.ttf }))
    onProgress?.((i + 1) / fonts.length)
  }
  return out
}

const ALL = ['ttf', 'otf', 'woff', 'woff2', 'eot']
export const CONVERTERS = [
  {
    from: ALL,
    to: ALL,
    group: 'Fonts',
    options: [{ key: 'accuracy', label: 'Curve accuracy (OTF to TTF)', type: 'select', choices: [['1', 'Standard'], ['0.3', 'High, bigger file']], default: '1' }],
    run: (file, to, opts, ctx) => convertFont(file, to, opts, ctx),
  },
  {
    from: ['fon', 'fnt'],
    to: ['ttf'],
    group: 'Fonts',
    run: (file, to, opts, ctx) => convertBitmapFont(file, ctx),
  },
]

export const SNIFF = ['woff2', 'woff', 'otf', 'ttf', 'eot', 'fon', 'fnt'].map((ext) => ({ ext, test: (b) => sniff(b) === ext }))
