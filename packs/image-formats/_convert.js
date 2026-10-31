// Routes this pack converts, for the File Converter hub and for the tools in this pack (one implementation, two front doors).
// Everything loads lazily inside run(), so importing this file is cheap.
import { OUTPUTS, MULTI } from './_encode.js'
import { MAGIC } from './_decode.js'
import { RAW_EXTS } from './_raw.js'

const baseName = (n = '') => n.replace(/\.[^.\/\\]+$/, '') || 'file'
const safe = (n) => n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'layer'
const cancelled = () => Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'ABORT' })

export const DEFAULTS = { quality: 90, maxWidth: 0, maxHeight: 0, grayscale: false, pages: 'all', exposure: 0, tonemap: 'reinhard', stretch: 'asinh', windowCenter: 0, windowWidth: 0, layers: false, rawMode: 'auto', rawHalf: false, preset: 'logo', still: false, sizes: 'all', tiffCompression: 'deflate' }

/** Convert one file. Returns an array of File objects (several for multi-page, layered or motion files). */
export async function convertImage(file, to, opts = {}, { signal, onProgress, onNote } = {}) {
  const o = { ...DEFAULTS, ...opts }
  for (const k of ['quality', 'maxWidth', 'maxHeight', 'exposure', 'windowCenter', 'windowWidth']) o[k] = Number.isFinite(+o[k]) ? +o[k] : DEFAULTS[k]
  const check = () => { if (signal?.aborted) throw cancelled() }
  const name = baseName(file.name)
  const mk = (blob, fname, type) => new File([blob], fname, { type: type || blob.type })
  const ext = (file.name.match(/\.([^.\/\\]+)$/)?.[1] || '').toLowerCase()
  onProgress?.(0)

  if (ext === 'livp') return fromLivp(file, to, o, { signal, onProgress, onNote, name, mk })
  if (to === 'mp4' || to === 'mov') return fromMotionPhoto(file, o, { name, mk })

  const { decodeFile } = await import('./_decode.js')
  const { encodeFrames } = await import('./_encode.js')
  const { limitSize, toGray, toCanvas } = await import('./_raster.js')
  const dec = await decodeFile(file, o, { signal })
  try {
    check(); onProgress?.(0.35)
    if (dec.note) onNote?.(dec.note)
    const prep = (r) => { let x = r; if (o.grayscale && to !== 'tiff') x = toGray(x); if (o.maxWidth > 0 || o.maxHeight > 0) x = limitSize(x, o.maxWidth, o.maxHeight); return x }
    // pages of a TIFF are decoded one at a time, when they are needed
    const frames = dec.frames.map((f) => ({ ...f, raster: undefined, load: async () => prep(f.raster || (await f.load())) }))

    if (to === 'svg') {
      const { traceImage, PRESETS } = await import('../corel/_trace.js')
      const { pageToSvg } = await import('../corel/_svgout.js')
      const r = await frames[0].load()
      const preset = PRESETS[o.preset] || PRESETS.logo
      const t = await traceImage(toCanvas(r), { ...preset, widthPt: r.width })
      onProgress?.(1)
      return [mk(new Blob([pageToSvg(t.page, { unit: 'pt' })], { type: 'image/svg+xml' }), `${name}.svg`)]
    }

    const out = []
    const iconLike = to === 'ico' || to === 'cur' || to === 'icns'
    if (frames.length > 1 && (MULTI.has(to) || iconLike)) {
      let use = frames
      if (iconLike) { // the biggest size is the best source for the other sizes
        const src = dec.frames.reduce((a2, f) => ((f.raster?.width || 0) > (a2.raster?.width || 0) ? f : a2), dec.frames[0])
        use = [frames[dec.frames.indexOf(src)]]
      }
      const { blob, ext: e, mime } = await encodeFrames(use, to, o)
      out.push(mk(blob, `${name}.${e}`, mime))
    } else {
      for (let i = 0; i < frames.length; i++) {
        check()
        const f = frames[i]
        const { blob, ext: e, mime } = await encodeFrames([f], to, o)
        const label = frames.length > 1 ? f.label || String(i + 1).padStart(String(frames.length).length, '0') : ''
        out.push(mk(blob, `${name}${label ? '-' + label : ''}.${e}`, mime))
        onProgress?.(0.35 + 0.6 * ((i + 1) / frames.length))
        if (frames.length > 8) await new Promise((r) => setTimeout(r, 0))
      }
    }
    if (dec.layers?.length) {
      const { zip } = await import('../../lib/files.js')
      const { canvasBlob } = await import('./_raster.js')
      const entries = []
      for (let i = 0; i < dec.layers.length; i++) {
        const l = dec.layers[i]
        entries.push({ name: `${String(i + 1).padStart(2, '0')}-${safe(l.name)}${l.hidden ? '-hidden' : ''}.png`, data: await canvasBlob(l.raster, 'image/png') })
        check()
      }
      out.push(mk(await zip(entries), `${name}-layers.zip`, 'application/zip'))
    }
    onProgress?.(1)
    return out
  } finally {
    dec.close?.()
  }
}

async function fromMotionPhoto(file, o, { name, mk }) {
  const { splitMotionPhoto } = await import('./_motion.js')
  const { video, still } = splitMotionPhoto(new Uint8Array(await file.arrayBuffer()))
  const out = [mk(new Blob([video], { type: 'video/mp4' }), `${name}.mp4`)]
  if (o.still) out.push(mk(new Blob([still], { type: 'image/jpeg' }), `${name}-still.jpg`))
  return out
}

async function fromLivp(file, to, o, { signal, onProgress, onNote, name, mk }) {
  const { readLivp } = await import('./_motion.js')
  const { still, video } = await readLivp(file)
  onProgress?.(0.2)
  if (to === 'mov') {
    if (!video) throw new Error('This Live Photo has no video inside.')
    return [mk(video.blob, `${name}.mov`, 'video/quicktime')]
  }
  if (to === 'mp4') {
    if (!video) throw new Error('This Live Photo has no video inside.')
    const { runFFmpeg } = await import('../../lib/ffmpeg.js')
    const blob = await runFFmpeg({
      inputs: [{ name: 'in.mov', data: video.blob }], args: ['-i', 'in.mov', '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', 'out.mp4'], output: 'out.mp4', signal,
      onProgress: (f) => onProgress?.(0.2 + 0.75 * (f ?? 0)),
    })
    return [mk(blob, `${name}.mp4`, 'video/mp4')]
  }
  if (!still) throw new Error('This Live Photo has no still picture inside.')
  if (/\.jpe?g$/i.test(still.name) && to === 'jpg' && !o.maxWidth && !o.maxHeight && !o.grayscale) return [mk(still.blob, `${name}.jpg`, 'image/jpeg')]
  return convertImage(new File([still.blob], still.name), to, o, { signal, onProgress, onNote }).then((fs) => fs.map((f) => new File([f], `${name}.${f.name.split('.').pop()}`, { type: f.type })))
}

// ---------------------------------------------------------------- route table
const RASTER_OUT = ['jpg', 'png', 'webp', 'avif', 'tiff', 'bmp', 'gif', 'ico', 'pdf', 'tga', 'ppm', 'pgm', 'pbm', 'pcx', 'qoi', 'cur', 'icns', 'jxl', 'apng']
const NEW_OUT = ['tiff', 'tga', 'ppm', 'pgm', 'pbm', 'pcx', 'qoi', 'cur', 'icns', 'jxl', 'apng']
const COMMON_IN = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'bmp', 'avif']
const EXOTIC_IN = ['tif', 'tiff', 'tga', 'icb', 'ppm', 'pgm', 'pbm', 'pnm', 'pam', 'pcx', 'qoi', 'dds', 'ico', 'cur', 'icns', 'mng', 'jxl', 'jp2', 'j2k', 'j2c', 'jpf', 'apng', 'heic', 'heif', 'xcf']

const COMMON = [
  { key: 'quality', label: 'Quality (JPG, WebP, AVIF, JPEG XL, PDF)', type: 'range', min: 1, max: 100, default: 90 },
  { key: 'maxWidth', label: 'Max width in pixels (0 keeps the original)', type: 'number', min: 0, default: 0 },
  { key: 'maxHeight', label: 'Max height in pixels (0 keeps the original)', type: 'number', min: 0, default: 0 },
  { key: 'grayscale', label: 'Make it black and white', type: 'toggle', default: false },
]
const PAGES = { key: 'pages', label: 'Pages, frames and sizes', type: 'select', choices: [['all', 'Every page, frame or size'], ['first', 'First only']], default: 'all' }

const route = (from, to, group, options, extra = {}) => ({
  from, to, group, options, lastOnly: ['pdf'], // a PDF of pictures is never a useful step towards text
  run: async (file, target, opts, ctx = {}) => {
    const files = await convertImage(file, target, { ...opts, ...extra }, ctx)
    return files.length === 1 ? files[0] : files
  },
})

export const CONVERTERS = [
  route(EXOTIC_IN, RASTER_OUT, 'Images', [...COMMON, PAGES]),
  route(COMMON_IN, NEW_OUT, 'Images', [...COMMON, PAGES]),
  route(['psd'], RASTER_OUT, 'Images', [...COMMON, { key: 'layers', label: 'Also save each layer as a PNG (ZIP)', type: 'toggle', default: false }]),
  route(RAW_EXTS, RASTER_OUT, 'Camera RAW', [...COMMON,
    { key: 'rawMode', label: 'RAW decoding', type: 'select', choices: [['auto', 'Full decode (embedded preview if that fails)'], ['full', 'Full decode only'], ['preview', 'Embedded preview only (fast)']], default: 'auto' },
    { key: 'rawHalf', label: 'Half size (much faster)', type: 'toggle', default: false }]),
  route(['dcm', 'dicom', 'dic'], RASTER_OUT, 'Medical images', [...COMMON, PAGES,
    { key: 'windowCenter', label: 'Window center (0 uses the file value)', type: 'number', default: 0 },
    { key: 'windowWidth', label: 'Window width (0 uses the file value)', type: 'number', min: 0, default: 0 }]),
  route(['exr', 'hdr'], RASTER_OUT, 'HDR images', [...COMMON,
    { key: 'exposure', label: 'Exposure (stops)', type: 'range', min: -6, max: 6, step: 0.1, default: 0 },
    { key: 'tonemap', label: 'Tone mapping', type: 'select', choices: [['reinhard', 'Soft (Reinhard)'], ['aces', 'Filmic (ACES)'], ['clip', 'Clip']], default: 'reinhard' }]),
  route(['fits', 'fts'], RASTER_OUT, 'Science images', [...COMMON,
    { key: 'stretch', label: 'Brightness stretch', type: 'select', choices: [['asinh', 'Auto (asinh)'], ['linear', 'Linear'], ['sqrt', 'Square root'], ['log', 'Logarithmic']], default: 'asinh' }]),
  route([...COMMON_IN, ...EXOTIC_IN, 'psd'], ['svg'], 'Vector', [
    { key: 'preset', label: 'Tracing style', type: 'select', choices: [['logo', 'Logo or clipart (color)'], ['lineart', 'Line art (black and white)'], ['poster', 'Poster or photo (many colors)']], default: 'logo' }]),
  { ...route(['jpg', 'jpeg'], ['mp4'], 'Motion photos (experimental)', [{ key: 'still', label: 'Also save the still photo', type: 'toggle', default: false }]), firstOnly: true },
  route(['livp'], ['jpg', 'png', 'mp4', 'mov'], 'Motion photos (experimental)', [{ key: 'quality', label: 'Quality (JPG)', type: 'range', min: 1, max: 100, default: 90 }]),
]

/** Magic numbers for files that arrive without a useful extension. */
export const SNIFF = ['qoi', 'dds', 'icns', 'psd', 'jxl', 'jp2', 'fits', 'hdr', 'exr', 'dcm', 'mng', 'xcf'].map((ext) => ({ ext, test: MAGIC[ext] }))

export { OUTPUTS }
