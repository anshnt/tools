// PDF for government portals: merge scans, photos and PDFs into one PDF that fits a size limit (100 KB to 2 MB), on A4 and in grayscale if wanted.
import { h, dropzone, fileList, button, busy, progress, alert, panel, stack, field, select, number, toggle, segmented, clear, downloadButton, formatBytes, stats, yieldToMain } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { openPdf, renderPage, pageSize, loadPdfLib, savePdf, thumbnail, PAGE_SIZES } from '../../lib/pdf.js'
import { loadImage, toBlob, canvas as newCanvas } from '../../lib/image.js'
import { baseName } from '../../lib/files.js'
import { style, note } from './_shared.js'

const TARGETS = [['100', '100 KB'], ['200', '200 KB'], ['300', '300 KB'], ['500', '500 KB'], ['1000', '1 MB'], ['2000', '2 MB'], ['custom', 'Custom size']]
// scale 1 = 72 dpi; quality is JPEG quality. Ordered from best to smallest, so the first one that fits is the best looking.
const LADDER = [[2.2, 0.82], [1.8, 0.75], [1.5, 0.7], [1.25, 0.62], [1.0, 0.55], [0.85, 0.5], [0.7, 0.45], [0.58, 0.4], [0.48, 0.35], [0.4, 0.3]]
const MAX_PAGES = 300
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)

/** A4 box (points) for a page shape: landscape when the page is clearly wider than tall. */
export function a4Box(w, h) {
  const [pw, ph] = PAGE_SIZES.A4
  return w / h > 1.1 ? { w: ph, h: pw } : { w: pw, h: ph }
}

async function collect(files, onProgress) {
  const pages = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    onProgress?.(i / files.length, `Reading ${f.name}`)
    if (isPdf(f)) {
      let doc
      try { doc = await openPdf(f) } catch (e) {
        throw new Error(e.code === 'PASSWORD' ? `${f.name} is password-protected. Unlock it first with Remove PDF password, then add it here.` : `${f.name}: ${e.message}`)
      }
      for (let n = 1; n <= doc.numPages; n++) { const s = await pageSize(doc, n); pages.push({ kind: 'pdf', doc, n, w: s.width, h: s.height, file: f }) }
    } else {
      const img = await loadImage(f)
      // a photo or scan: 150 dpi is its natural size, but never bigger than an A4 sheet
      const w = (img.naturalWidth * 72) / 150, h = (img.naturalHeight * 72) / 150
      const box = a4Box(w, h), k = Math.min(1, box.w / w, box.h / h)
      pages.push({ kind: 'img', img, w: w * k, h: h * k, file: f })
    }
    if (pages.length > MAX_PAGES) throw new Error(`That is more than ${MAX_PAGES} pages. Split the job into smaller PDFs.`)
    await yieldToMain()
  }
  return pages
}

function toGray(c) {
  const ctx = c.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = g }
  ctx.putImageData(img, 0, 0)
}

async function renderTo(page, box, s) {
  const out = newCanvas(Math.max(1, box.w * s), Math.max(1, box.h * s))
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingQuality = 'high'
  const fit = Math.min(box.w / page.w, box.h / page.h)
  const dw = page.w * fit * s, dh = page.h * fit * s
  if (page.kind === 'pdf') {
    const c = await renderPage(page.doc, page.n, { scale: s * fit })
    ctx.drawImage(c, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh)
    c.width = c.height = 0
  } else ctx.drawImage(page.img, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh)
  return out
}

/** Build the PDF from page images at one ladder step. */
async function buildRaster(pages, { a4, gray, scale, quality, onPage, signal }) {
  const { PDFDocument } = await pdfLib()
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    const p = pages[i]
    const box = a4 ? a4Box(p.w, p.h) : { w: p.w, h: p.h }
    const c = await renderTo(p, box, scale)
    if (gray) toGray(c)
    const jpg = await doc.embedJpg(await (await toBlob(c, 'image/jpeg', quality)).arrayBuffer())
    doc.addPage([box.w, box.h]).drawImage(jpg, { x: 0, y: 0, width: box.w, height: box.h })
    c.width = c.height = 0
    onPage?.(i + 1)
    await yieldToMain()
  }
  return savePdf(doc)
}

/** Lossless merge when every input is a PDF: keeps text selectable. */
async function mergeLossless(files) {
  const { PDFDocument } = await pdfLib()
  const out = await PDFDocument.create()
  for (const f of files) {
    const src = await loadPdfLib(f)
    for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg)
  }
  return savePdf(out)
}

/** Find the best-looking ladder step whose output is at most maxBytes. Sizes shrink down the ladder, so binary search it. */
export async function fitPdf(pages, files, { maxBytes, a4, gray, onStatus, signal }) {
  if (!a4 && !gray && files.every(isPdf)) {
    onStatus?.(0, 'Merging without losing quality')
    const blob = await mergeLossless(files)
    if (blob.size <= maxBytes) return { blob, rasterized: false, hit: true }
  }
  let tries = 0
  const total = 6
  const attempt = async (idx) => {
    const [scale, quality] = LADDER[idx]
    tries++
    const blob = await buildRaster(pages, { a4, gray, scale, quality, signal, onPage: (n) => onStatus?.((tries - 1 + n / pages.length) / total, `Trying about ${Math.round(scale * 72)} dpi (page ${n} of ${pages.length})`) })
    return { blob, rasterized: true, scale, quality, dpi: Math.round(scale * 72), hit: blob.size <= maxBytes }
  }
  const first = await attempt(0)
  if (first.hit) return first
  let lo = 1, hi = LADDER.length - 1
  let best = await attempt(hi)
  if (!best.hit) return best // even the smallest step is too big
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const r = await attempt(mid)
    if (r.hit) { best = r; hi = mid } else lo = mid + 1
  }
  return best
}

export function mount(root, { signal }) {
  style('in-pgp', '.in-pgp-thumb{display:grid;place-items:center;padding:10px}.in-pgp-thumb canvas{max-width:100%;height:auto;max-height:340px;box-shadow:var(--shadow)}')
  const prog = progress()
  const result = h('div', { class: 'stack' })
  const list = fileList({ onChange: () => update() })
  const zone = dropzone({ accept: 'application/pdf,.pdf,image/*,.heic,.heif', multiple: true, label: 'Drop PDFs, scans or photos here', hint: 'PDF, JPG, PNG, WebP or iPhone HEIC. They are joined in the order shown.', onFiles: (f) => list.add(f), icon: 'files' })
  const target = select(TARGETS, '200', () => syncTarget())
  const custom = number(150, { min: 10, max: 20000, step: 10, ariaLabel: 'Custom size limit in KB' })
  const customBox = h('div', { hidden: true }, field('Limit in KB', custom))
  const pageMode = segmented([['keep', 'Keep page sizes'], ['a4', 'Make every page A4']], 'keep', null, 'Page size')
  const gray = toggle('Grayscale (smaller files for black and white documents)', false)
  const go = button('Make the PDF', { icon: 'file-down', variant: 'primary', size: 'lg', disabled: true })
  const syncTarget = () => { customBox.hidden = target.value !== 'custom' }

  function update() {
    go.disabled = !list.files.length
    zone.classList.toggle('compact', list.files.length > 0)
  }

  go.addEventListener('click', () => busy(go, async () => {
    const files = [...list.files]
    clear(result)
    list.setDisabled(true)
    try {
      const kb = target.value === 'custom' ? custom.valueAsNumber : +target.value
      if (!Number.isFinite(kb) || kb < 10) throw new Error('Enter a size limit of at least 10 KB.')
      const maxBytes = Math.floor(kb * 1000)
      prog.set(null, 'Reading your files')
      const pages = await collect(files, (f, t) => prog.set(f * 0.2, t))
      const a4 = pageMode.value === 'a4', g = gray.input.checked
      const res = await fitPdf(pages, files, { maxBytes, a4, gray: g, signal, onStatus: (f, t) => prog.set(0.2 + f * 0.8, t) })
      const inBytes = files.reduce((n, f) => n + f.size, 0)
      const name = `${files.length === 1 ? baseName(files[0].name) : 'merged'}-${kb >= 1000 ? kb / 1000 + 'mb' : kb + 'kb'}.pdf`
      const thumbBox = h('div', { class: 'preview in-pgp-thumb' })
      const out = [
        res.hit ? alert('success', h('strong', 'Under the limit. '), `${formatBytes(res.blob.size)} for ${pages.length} page${pages.length > 1 ? 's' : ''} (limit ${kb >= 1000 ? kb / 1000 + ' MB' : kb + ' KB'}).`)
          : alert('warn', h('strong', 'Could not reach the limit. '), `The smallest file is ${formatBytes(res.blob.size)}, above ${kb >= 1000 ? kb / 1000 + ' MB' : kb + ' KB'}. Remove pages, choose grayscale, or raise the limit.`),
        stats([
          { label: 'Result', value: formatBytes(res.blob.size), accent: res.hit, danger: !res.hit, hint: res.hit ? 'fits the limit' : 'over the limit' },
          { label: 'Pages', value: String(pages.length), hint: a4 ? 'all A4' : 'original sizes' },
          { label: 'Was', value: formatBytes(inBytes), hint: `${files.length} file${files.length > 1 ? 's' : ''}` },
          { label: 'Quality', value: res.rasterized ? `${res.dpi} dpi` : 'Original', hint: res.rasterized ? 'pages saved as images' : 'text stays selectable' },
        ]),
        res.rasterized && res.dpi < 100 ? alert('warn', 'The pages were squeezed hard to fit. Check that small print is still readable before you upload.') : null,
        res.rasterized ? h('p', { class: 'small muted', style: 'margin:0' }, 'Pages are saved as images to make the file small, so the text in the PDF can no longer be selected.') : null,
        thumbBox,
        h('div', { class: 'row' }, downloadButton(res.blob, name, 'Download PDF', { size: 'lg' })),
      ]
      clear(result, out)
      try {
        const doc = await openPdf(res.blob)
        thumbBox.append(await thumbnail(doc, 1, 420))
      } catch { thumbBox.remove() }
    } finally {
      list.setDisabled(false)
    }
  }, { label: 'Working', errorTo: result, progress: prog }))

  update()
  root.append(stack(
    zone, list.el,
    panel(h('div', { class: 'stack' },
      h('div', { class: 'grid-2' }, field('Make it smaller than', target), customBox),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', 'Pages')), pageMode),
      gray,
      h('div', { class: 'row' }, go, h('span', { class: 'small muted' }, 'Everything stays on your device.')))),
    prog.el, result,
    note('Several files are joined into one PDF first. If every file is a PDF and no other option is chosen, the PDF is merged without losing quality when that already fits. Otherwise each page is saved as an image at the best quality that fits, picking up from about 160 dpi down to about 30 dpi, and the limit is measured in 1000-byte KB so it passes on any portal.')))
}
