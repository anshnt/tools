// The picture format converter. One module serves the all-in-one tool and the focused entries (params: from, to, lock, targets, mode, blurb).
import {
  h, icon, dropzone, fileList, button, busy, progress, select, toggle, rangeField, number, field, panel, alert, downloadButton, download, formatBytes, onCleanup, isAbort, errorMessage,
} from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import { canEncode } from '../../lib/image.js'
import { convertImage, DEFAULTS } from './_convert.js'
import { OUTPUTS } from './_encode.js'
import { INPUT_EXTS, extOf } from './_decode.js'
import { RAW_EXTS } from './_raw.js'

const GENERAL = ['jpg', 'png', 'webp', 'avif', 'tiff', 'bmp', 'gif', 'ico', 'pdf', 'tga', 'ppm', 'pgm', 'pbm', 'pcx', 'qoi', 'cur', 'icns', 'jxl', 'apng', 'svg']
const LABELS = { ...Object.fromEntries(Object.entries(OUTPUTS).map(([k, v]) => [k, v.label])), svg: 'SVG (traced vector)', mp4: 'MP4 video', mov: 'MOV video', tiff: 'TIFF', apng: 'APNG (animated PNG)' }
const HINTS = {
  jpg: 'Small photos that open everywhere. Transparency turns white.', png: 'Sharp and lossless, keeps transparency.', webp: 'Modern and small, keeps transparency.', avif: 'Smallest files. Chrome and Edge can save it.',
  tiff: 'Lossless, for print and archives. Several pages stay in one file.', bmp: 'Plain uncompressed bitmap.', gif: 'Up to 256 colors. Several frames make an animation.', ico: 'Windows icon with several sizes inside.',
  pdf: 'One page per picture or page.', tga: 'Game and 3D texture format.', ppm: 'Plain color pixmap.', pgm: 'Plain grayscale map.', pbm: 'Plain black and white map.', pcx: 'Old paint format.',
  qoi: 'Fast lossless format, smaller than PNG to write.', cur: 'Windows mouse cursor, with a click point.', icns: 'Mac app icon with every size from 16 to 1024.', jxl: 'JPEG XL: small files, near-lossless quality.',
  apng: 'Animated PNG, full color and transparency.', svg: 'Traces the picture into scalable vector shapes. Best for logos and drawings.', mp4: 'The short video inside the photo.', mov: 'The video as saved by the iPhone.',
}
const MULTI_IN = new Set(['tif', 'tiff', 'gif', 'apng', 'png', 'ico', 'cur', 'icns', 'dcm', 'dicom', 'dic', 'webp'])
const LOSSY = new Set(['jpg', 'webp', 'avif', 'jxl', 'pdf'])
const ACCEPT_ALL = [...INPUT_EXTS, 'livp'].map((e) => `.${e}`).join(',')

export function mount(root, { params = {}, signal }) {
  const mode = params.mode || ''
  const fromList = (params.from ? [params.from].flat() : mode === 'motion' ? ['jpg', 'jpeg'] : mode === 'livp' ? ['livp'] : null)
  const accept = fromList ? fromList.map((e) => `.${e}`).join(',') : ACCEPT_ALL
  const o = { ...DEFAULTS, quality: 90, sizes: ['16', '32', '48', '256'], hotX: 0, hotY: 0, cursorSize: '32', jxlLossless: false, tgaRle: true }
  let to = params.to || 'png'
  let files = []
  let lastResults = []
  const urls = []
  onCleanup(() => { for (const u of urls) URL.revokeObjectURL(u) })

  const targets = () => {
    let list = params.targets || (mode === 'motion' ? ['mp4'] : files.length && files.every((f) => extOf(f.name) === 'livp') ? ['jpg', 'png', 'mp4', 'mov'] : GENERAL)
    list = list.filter((t) => !(t === 'avif' && !canEncode('image/avif')) && !(t === 'webp' && !canEncode('image/webp')))
    return list
  }
  const kinds = () => new Set(files.map((f) => extOf(f.name)))
  const hasAny = (list) => [...kinds()].some((k) => list.includes(k))

  // ---- controls
  const toSel = select(targets().map((t) => [t, LABELS[t] || t.toUpperCase()]), to, (v) => { to = v; refresh() })
  const toHint = h('small', { class: 'field-hint' })
  const toField = field('Convert to', toSel, null)
  toField.append(toHint)
  const quality = rangeField('Quality', { min: 1, max: 100, value: o.quality, format: (v) => (v >= 100 ? 'Lossless' : `${v}%`), onInput: (v) => { o.quality = v } })
  const jxlNote = h('small', { class: 'field-hint' }, 'At 100% JPEG XL is lossless.')
  const maxW = number(0, { min: 0, placeholder: 'Original', ariaLabel: 'Maximum width in pixels', onInput: (n) => { o.maxWidth = n || 0 } })
  const maxH = number(0, { min: 0, placeholder: 'Original', ariaLabel: 'Maximum height in pixels', onInput: (n) => { o.maxHeight = n || 0 } })
  const resize = h('div', { class: 'grid-2' }, field('Max width (px)', maxW), field('Max height (px)', maxH))
  const gray = toggle('Make it black and white', false, (v) => { o.grayscale = v })
  const pages = field('Pages, frames and sizes', select([['all', 'Every page, frame or size'], ['first', 'First one only']], 'all', (v) => { o.pages = v }))
  const tiffComp = field('TIFF compression', select([['deflate', 'Deflate (smaller)'], ['none', 'None (most compatible)']], 'deflate', (v) => { o.tiffCompression = v }))
  const icoChips = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px' })
  const icoSet = new Set(o.sizes)
  for (const s of ['16', '24', '32', '48', '64', '128', '256']) icoChips.append(toggle(`${s}`, icoSet.has(s), (v) => { v ? icoSet.add(s) : icoSet.delete(s); o.sizes = [...icoSet] }))
  const icoField = field('Icon sizes (px)', icoChips)
  const curField = h('div', { class: 'grid-3' },
    field('Cursor size', select([['16', '16 px'], ['24', '24 px'], ['32', '32 px'], ['48', '48 px'], ['64', '64 px']], '32', (v) => { o.cursorSize = v })),
    field('Click point X', number(0, { min: 0, ariaLabel: 'Click point X', onInput: (n) => { o.hotX = n || 0 } })),
    field('Click point Y', number(0, { min: 0, ariaLabel: 'Click point Y', onInput: (n) => { o.hotY = n || 0 } })))
  const rawMode = field('RAW decoding', select([['auto', 'Full decode (preview if that fails)'], ['full', 'Full decode only'], ['preview', 'Embedded preview only (fast)']], 'auto', (v) => { o.rawMode = v }))
  const rawHalf = toggle('Half size (much faster)', false, (v) => { o.rawHalf = v })
  const dicomWin = h('div', { class: 'grid-2' },
    field('Window center', number('', { placeholder: 'From file', ariaLabel: 'Window center', onInput: (n) => { o.windowCenter = Number.isFinite(n) ? n : 0 } })),
    field('Window width', number('', { min: 0, placeholder: 'From file', ariaLabel: 'Window width', onInput: (n) => { o.windowWidth = Number.isFinite(n) ? n : 0 } })))
  const exposure = rangeField('Exposure', { min: -6, max: 6, step: 0.1, value: 0, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} stops`, onInput: (v) => { o.exposure = v } })
  const tonemap = field('Tone mapping', select([['reinhard', 'Soft (Reinhard)'], ['aces', 'Filmic (ACES)'], ['clip', 'Clip']], 'reinhard', (v) => { o.tonemap = v }))
  const stretch = field('Brightness stretch', select([['asinh', 'Auto (asinh)'], ['linear', 'Linear'], ['sqrt', 'Square root'], ['log', 'Logarithmic']], 'asinh', (v) => { o.stretch = v }))
  const layers = toggle('Also save every layer as a PNG (ZIP)', false, (v) => { o.layers = v })
  const preset = field('Tracing style', select([['logo', 'Logo or clipart (color)'], ['lineart', 'Line art (black and white)'], ['poster', 'Poster or photo (many colors)']], 'logo', (v) => { o.preset = v }))
  const still = toggle('Also save the still photo', false, (v) => { o.still = v })
  const optionBlocks = [
    [quality, () => LOSSY.has(to)], [jxlNote, () => to === 'jxl'], [resize, () => to !== 'mp4' && to !== 'mov'], [gray, () => to !== 'mp4' && to !== 'mov'],
    [pages, () => hasAny([...MULTI_IN]) && !['mp4', 'mov'].includes(to)], [tiffComp, () => to === 'tiff'], [icoField, () => to === 'ico'], [curField, () => to === 'cur'],
    [rawMode, () => hasAny(RAW_EXTS)], [rawHalf, () => hasAny(RAW_EXTS)], [dicomWin, () => hasAny(['dcm', 'dicom', 'dic'])], [exposure, () => hasAny(['exr', 'hdr'])], [tonemap, () => hasAny(['exr', 'hdr'])],
    [stretch, () => hasAny(['fits', 'fit', 'fts'])], [layers, () => hasAny(['psd'])], [preset, () => to === 'svg'], [still, () => to === 'mp4' && mode === 'motion'],
  ]
  const optionsHost = h('div', { class: 'stack t-fmt-opts' }, optionBlocks.map(([el]) => el))
  const optionsPanel = panel(h('h2', 'Options'), optionsHost)

  const prog = progress('Converting')
  const results = h('div', { class: 't-fmt-results stack', 'aria-live': 'polite' })
  const goBtn = button('Convert', { icon: 'repeat-2', variant: 'primary', size: 'lg', block: true, onClick: convert })
  const list = fileList({ sortable: false, onChange: (f) => { files = f; refresh() } })
  const dz = dropzone({
    accept, multiple: true, paste: true, label: params.dropLabel,
    hint: params.dropHint || (fromList ? `${fromList.map((e) => e.toUpperCase()).join(', ')} files` : 'TIFF, RAW, PSD, JPEG XL, DDS, TGA, DICOM, EXR, ICO, ICNS and many more'),
    onFiles: (fs) => { files = [...files, ...fs]; list.set(files); refresh() },
  })

  function refresh() {
    const tl = targets()
    if (!tl.includes(to)) to = tl.includes(params.to) ? params.to : tl[0]
    if (!params.lock) {
      toSel.replaceChildren(...tl.map((t) => h('option', { value: t, selected: t === to }, LABELS[t] || t.toUpperCase())))
      toSel.value = to
    }
    toHint.textContent = HINTS[to] || ''
    for (const [el, show] of optionBlocks) el.hidden = !show()
    optionsPanel.hidden = !files.length
    goBtn.hidden = !files.length
    list.el.hidden = !files.length
    const label = goBtn.querySelector('span:not(.spinner)')
    if (label && !goBtn.hasAttribute('aria-busy')) label.textContent = files.length > 1 ? `Convert ${files.length} files to ${LABELS[to] || to.toUpperCase()}` : `Convert to ${LABELS[to] || to.toUpperCase()}`
  }

  const bannerText = params.lock ? `${(fromList || ['any picture']).map((e) => e.toUpperCase()).join(' / ')} to ${LABELS[to]}` : null

  async function convert() {
    const batch = [...files]
    if (!batch.length) return
    list.setDisabled(true)
    results.replaceChildren()
    for (const u of urls.splice(0)) URL.revokeObjectURL(u)
    lastResults = []
    const failures = []
    await busy(goBtn, async () => {
      for (let i = 0; i < batch.length; i++) {
        const f = batch[i]
        const note = []
        try {
          const opts = { ...o, sizes: to === 'cur' ? [o.cursorSize] : o.sizes }
          const out = await convertImage(f, to, opts, {
            signal, onNote: (n) => note.push(n),
            onProgress: (p) => prog.set((i + (p ?? 0)) / batch.length, batch.length > 1 ? `Converting ${i + 1} of ${batch.length}: ${f.name}` : `Converting ${f.name}`),
          })
          lastResults.push(...out)
          results.append(resultCard(f, out, note))
        } catch (e) {
          if (isAbort(e)) return
          console.error(e)
          failures.push(f.name)
          results.append(alert('error', h('strong', `${f.name}: `), errorMessage(e)))
        }
        await new Promise((r) => setTimeout(r, 0))
      }
    }, { label: 'Converting', progress: prog })
    list.setDisabled(false)
    if (lastResults.length > 1) results.append(zipButton())
    if (lastResults.length && !failures.length) results.prepend(alert('success', `Done. ${lastResults.length} file${lastResults.length > 1 ? 's' : ''} ready. Nothing left your device.`))
  }

  function resultCard(src, out, notes) {
    const total = out.reduce((n, f) => n + f.size, 0)
    const rows = out.map((f) => {
      let thumb = h('div', { class: 't-fmt-thumb' }, icon('file-image'))
      if (/^image\/(png|jpeg|webp|gif|avif|bmp|svg\+xml|apng)/.test(f.type)) {
        const url = URL.createObjectURL(f); urls.push(url)
        thumb = h('img', { class: 't-fmt-thumb', src: url, alt: '', loading: 'lazy' })
      } else if (f.type.startsWith('video/')) thumb = h('div', { class: 't-fmt-thumb' }, icon('file-video'))
      return h('li', { class: 't-fmt-row' }, thumb,
        h('div', { class: 'meta' }, h('div', { class: 'name', title: f.name }, f.name), h('div', { class: 'size' }, formatBytes(f.size))),
        downloadButton(f, f.name, 'Download', { size: 'sm' }))
    })
    return h('section', { class: 'panel t-fmt-card' },
      h('div', { class: 'row', style: 'justify-content:space-between;gap:8px;flex-wrap:wrap' }, h('strong', { class: 't-fmt-src' }, src.name), h('span', { class: 'muted small' }, `${formatBytes(src.size)} to ${formatBytes(total)}${out.length > 1 ? ` in ${out.length} files` : ''}`)),
      notes.length ? h('p', { class: 'muted small' }, notes.join('. ')) : null,
      h('ul', { class: 'file-list' }, rows))
  }
  function zipButton() {
    const btn = button('Download all (ZIP)', { icon: 'archive', variant: 'secondary' })
    btn.addEventListener('click', () => busy(btn, async () => {
      const blob = await zip(lastResults.map((f) => ({ name: f.name, data: f })))
      download(blob, 'converted-images.zip')
    }, { label: 'Zipping' }))
    return btn
  }

  const style = h('style', `
.t-fmt-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px;border:1px solid var(--border);border-radius:var(--radius,14px);background:var(--surface-2)}
.t-fmt-banner strong{font-size:15px}
.t-fmt-row{display:flex;align-items:center;gap:12px;padding:8px 0;flex-wrap:wrap}
.t-fmt-row .meta{flex:1 1 140px;min-width:0}
.t-fmt-thumb{width:44px;height:44px;border-radius:8px;object-fit:contain;background:repeating-conic-gradient(var(--surface-2) 0 25%,var(--surface) 0 50%) 0 0/12px 12px;display:grid;place-items:center;flex:none;color:var(--muted)}
.t-fmt-src{overflow-wrap:anywhere}
.t-fmt-opts>*{margin:0}
.t-fmt .grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (max-width:420px){.t-fmt .grid-3{grid-template-columns:1fr 1fr}}`)

  root.append(h('div', { class: 'stack t-fmt' }, style,
    params.blurb ? h('p', { class: 'muted' }, params.blurb) : null,
    bannerText ? h('div', { class: 't-fmt-banner' }, icon('repeat-2'), h('strong', bannerText)) : null,
    dz, list.el,
    h('div', { class: 'stack' }, params.lock ? null : toField, optionsPanel, goBtn, prog.el),
    results,
    h('p', { class: 'muted small' }, 'Everything is converted on your device. Nothing is uploaded.')))
  refresh()
}
