// Contact sheet generator: thumbnails with captions on printable pages, as a PDF or PNG pages.
import { h, panel, split, field, input, button, busy, clear, download, toast, formatBytes, rangeField, toggle, fileList, progress, yieldToMain } from '../../lib/ui.js'
import { zip, pickFolder } from '../../lib/files.js'
import { loadImage } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { savePdf, PAGE_SIZES } from '../../lib/pdf.js'
import { addStyle, heroDrop, stage, pills, chipPicker, numField, newCanvas, encode, done, scaled, drawCover, drawContain, clamp, readImages, isImage, IMG_ACCEPT, frame } from './_shared.js'

const MM = 25.4
const PAPERS = [['A4', ...PAGE_SIZES.A4.map((p) => (p / 72) * MM)], ['A3', ...PAGE_SIZES.A3.map((p) => (p / 72) * MM)], ['Letter', 215.9, 279.4], ['Legal', 215.9, 355.6]]
const SHAPES = [['1:1', 1], ['4:3', 3 / 4], ['3:2', 2 / 3], ['16:9', 9 / 16]]
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** Grid geometry in mm. Returns {cols, rows, per, cellW, thumbH, cellH, x0, y0}. */
export function sheetLayout({ pageW, pageH, margin, gap, cols, shape, captionH, headerH, footerH }) {
  const aw = pageW - margin * 2, ah = pageH - margin * 2 - headerH - footerH
  const cellW = (aw - (cols - 1) * gap) / cols
  const thumbH = cellW * shape
  const cellH = thumbH + captionH
  const rows = Math.max(0, Math.floor((ah + gap + 1e-6) / (cellH + gap)))
  return { cols, rows, per: cols * rows, cellW, thumbH, cellH, x0: margin, y0: margin + headerH, aw, ah }
}

const SORTS = {
  added: null,
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
  date: (a, b) => a.modified - b.modified,
  size: (a, b) => a.size - b.size,
}

function ellipsize(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 3 && g.measureText(`${t}...`).width > maxW) t = t.slice(0, -1)
  return `${t}...`
}

export function mount(root, { signal }) {
  addStyle('is-contact', `
.t-contact .pg { display: block; margin: 0 auto; max-width: 100%; height: auto; max-height: 720px; width: auto; box-shadow: 0 24px 48px -22px rgba(10, 10, 30, .55), 0 0 0 1px rgba(0, 0, 0, .1); border-radius: 3px; }
.t-contact .pager { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 12px; font-size: 13px; color: var(--muted); }
.t-contact .list { max-height: 280px; overflow: auto; padding-right: 4px; }
.t-contact .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
`)
  const s = { paper: 'A4', orient: 'portrait', cols: 4, shape: 3 / 4, margin: 12, gap: 4, title: 'Contact sheet', date: true, pageNo: true, nameC: true, details: true, numbers: false, font: 8, fit: 'contain', dark: false, border: true, sort: 'added', dpi: 200, page: 0 }
  let items = [] // {file, name, w, h, size, modified, thumb}
  const byFile = new Map()
  const toggleReverse = { on: false }

  const drop = heroDrop({ accept: IMG_ACCEPT, multiple: true, sample: 6, label: 'Drop photos or screenshots here', hint: 'Many images at once, or a whole folder', onFiles: (f) => addFiles(f) })
  const folderBtn = button('Choose a folder', { icon: 'folder-open', size: 'sm', onClick: async () => { const files = (await pickFolder()).filter(isImage); if (files.length) addFiles(files); else toast('No images found in that folder.') } })
  const work = h('div', { class: 'stack', hidden: true })
  const list = fileList({ onChange: (files) => { items = files.map((f) => byFile.get(f)).filter(Boolean); s.page = 0; update() } })
  const pvHost = h('div'); const caption = h('div', { class: 'is-cap' }); const pager = h('div', { class: 'pager' })
  const result = h('div'); const prog = progress()

  const paperChips = chipPicker(PAPERS.map(([n]) => [n, n]), s.paper, (v) => { s.paper = v; update() }, 'Paper size')
  const orientSeg = pills([['portrait', 'Portrait'], ['landscape', 'Landscape']], s.orient, (v) => { s.orient = v; update() }, 'Orientation')
  const colsF = rangeField('Columns', { min: 1, max: 10, value: s.cols, format: (v) => `${v}`, onInput: (v) => { s.cols = v; soon() } })
  const shapeChips = chipPicker(SHAPES.map(([l]) => [l, l]), '4:3', (l) => { s.shape = SHAPES.find((x) => x[0] === l)[1]; update() }, 'Thumbnail shape')
  const fitSeg = pills([['contain', 'Fit whole picture'], ['cover', 'Fill and crop']], s.fit, (v) => { s.fit = v; update() }, 'Thumbnail fit')
  const marginF = rangeField('Page margin', { min: 4, max: 30, value: s.margin, format: (v) => `${v} mm`, onInput: (v) => { s.margin = v; soon() } })
  const gapF = rangeField('Gap', { min: 0, max: 12, value: s.gap, format: (v) => `${v} mm`, onInput: (v) => { s.gap = v; soon() } })
  const fontF = rangeField('Caption size', { min: 6, max: 14, value: s.font, format: (v) => `${v} pt`, onInput: (v) => { s.font = v; soon() } })
  const titleIn = input({ value: s.title, maxlength: 80, 'aria-label': 'Sheet title', oninput: () => { s.title = titleIn.value; soon() } })
  const sortSeg = pills([['added', 'As added'], ['name', 'Name'], ['date', 'Date'], ['size', 'Size']], s.sort, (v) => { s.sort = v; applySort() }, 'Sort')
  const dpiSeg = pills([['150', '150 DPI'], ['200', '200 DPI'], ['300', '300 DPI']], String(s.dpi), (v) => { s.dpi = +v }, 'Quality')
  const pdfBtn = button('Download PDF', { icon: 'file-down', variant: 'primary', size: 'lg', block: true })
  const pngBtn = button('Download PNG pages', { icon: 'images', variant: 'secondary', block: true })

  const toggles = [['Show the date', 'date'], ['Page numbers', 'pageNo'], ['File names', 'nameC'], ['Size and dimensions', 'details'], ['Number the pictures', 'numbers'], ['Dark page', 'dark'], ['Thin frame around thumbnails', 'border']]
    .map(([label, key]) => toggle(label, s[key], (v) => { s[key] = v; update() }))

  const controls = panel(h('div', { class: 'stack' },
    field('Paper', paperChips), field('Orientation', orientSeg), field('Title', titleIn), colsF, field('Thumbnail shape', shapeChips), field('Thumbnails', fitSeg),
    h('div', { class: 'row2' }, marginF, gapF), fontF, h('div', { class: 'stack tight' }, ...toggles), field('Order', sortSeg), field('Output quality', dpiSeg),
    pdfBtn, pngBtn, prog.el, result,
    h('p', { class: 'small muted' }, 'Pages are rendered as images, so file names in the PDF are not selectable text.')))
  const soon = frame(() => update())

  function geom() {
    const base = PAPERS.find((p) => p[0] === s.paper)
    const [pageW, pageH] = s.orient === 'portrait' ? [base[1], base[2]] : [base[2], base[1]]
    const fontMm = (s.font * MM) / 72
    const lines = (s.nameC ? 1 : 0) + (s.details ? 1 : 0)
    const captionH = lines ? lines * fontMm * 1.3 + 2 : 0
    const headerH = s.title || s.date ? 12 : 0
    const footerH = s.pageNo ? 8 : 0
    return { pageW, pageH, fontMm, captionH, headerH, footerH, ...sheetLayout({ pageW, pageH, margin: s.margin, gap: s.gap, cols: s.cols, shape: s.shape, captionH, headerH, footerH }) }
  }

  const sizeText = (it) => `${it.w} x ${it.h}  ${formatBytes(it.size)}`

  /** Draw page p at k px/mm. getSource(item, needPx) may return a thumb or a promise of a higher resolution source. */
  async function drawPage(G, p, k, getSource) {
    const c = newCanvas(Math.round(G.pageW * k), Math.round(G.pageH * k)), g = c.getContext('2d')
    const bg = s.dark ? '#121218' : '#ffffff', fg = s.dark ? '#f2f2f7' : '#1c1c24', mute = s.dark ? '#a0a0ae' : '#6b6b78'
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height)
    const pages = Math.max(1, Math.ceil(items.length / G.per))
    g.textBaseline = 'top'
    if (G.headerH) {
      g.fillStyle = fg; g.font = `700 ${5.2 * k}px ${FONT}`
      if (s.title) g.fillText(ellipsize(g, s.title, (G.pageW - s.margin * 2) * k), s.margin * k, s.margin * k)
      g.fillStyle = mute; g.font = `${3 * k}px ${FONT}`
      const info = `${items.length} picture${items.length === 1 ? '' : 's'}${s.date ? `  -  ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}`
      g.fillText(info, s.margin * k, (s.margin + 6.6) * k)
    }
    const fpx = G.fontMm * k
    for (let j = 0; j < G.per; j++) {
      const i = p * G.per + j
      if (i >= items.length) break
      const it = items[i], col = j % G.cols, row = Math.floor(j / G.cols)
      const x = (G.x0 + col * (G.cellW + s.gap)) * k, y = (G.y0 + row * (G.cellH + s.gap)) * k, w = G.cellW * k, th = G.thumbH * k
      g.save()
      g.fillStyle = s.dark ? '#1d1d26' : '#f3f3f6'; g.fillRect(x, y, w, th)
      g.beginPath(); g.rect(x, y, w, th); g.clip(); g.imageSmoothingQuality = 'high'
      const src = await getSource(it, Math.max(w, th))
      const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height
      if (s.fit === 'cover') drawCover(g, src, sw, sh, x, y, w, th)
      else drawContain(g, src, sw, sh, x, y, w, th)
      g.restore()
      if (s.border) { g.strokeStyle = s.dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.14)'; g.lineWidth = Math.max(1, 0.2 * k); g.strokeRect(x, y, w, th) }
      let ty = y + th + 1 * k
      if (s.nameC) {
        g.fillStyle = fg; g.font = `600 ${fpx}px ${FONT}`
        const label = `${s.numbers ? `${i + 1}. ` : ''}${it.name}`
        g.fillText(ellipsize(g, label, w), x, ty); ty += fpx * 1.3
      } else if (s.numbers) { g.fillStyle = fg; g.font = `600 ${fpx}px ${FONT}`; g.fillText(`${i + 1}`, x, ty); ty += fpx * 1.3 }
      if (s.details) { g.fillStyle = mute; g.font = `${fpx * 0.92}px ${FONT}`; g.fillText(ellipsize(g, sizeText(it), w), x, ty) }
    }
    if (G.footerH) { g.fillStyle = mute; g.font = `${3 * k}px ${FONT}`; g.textAlign = 'center'; g.fillText(`Page ${p + 1} of ${pages}`, (G.pageW / 2) * k, (G.pageH - s.margin) * k); g.textAlign = 'left' }
    return c
  }

  const thumbSource = (it) => it.thumb

  async function update() {
    if (!items.length) { work.hidden = true; return }
    work.hidden = false
    paperChips.set(s.paper); orientSeg.set(s.orient); fitSeg.set(s.fit); sortSeg.set(s.sort); dpiSeg.set(String(s.dpi))
    shapeChips.set(SHAPES.find((x) => Math.abs(x[1] - s.shape) < 1e-6)?.[0] || null)
    clear(result)
    const G = geom()
    if (!G.rows || G.cellW < 6) {
      clear(pvHost, h('p', { class: 'muted', style: 'text-align:center;padding:40px 0' }, 'Nothing fits with these settings. Use fewer columns, a smaller margin or smaller captions.')); clear(caption); clear(pager); pdfBtn.disabled = pngBtn.disabled = true; return
    }
    pdfBtn.disabled = pngBtn.disabled = false
    const pages = Math.ceil(items.length / G.per)
    s.page = clamp(s.page, 0, pages - 1)
    const token = (update.token = (update.token || 0) + 1)
    const c = await drawPage(G, s.page, Math.min(5, 760 / G.pageW), thumbSource)
    if (token !== update.token) return
    c.className = 'pg'
    clear(pvHost, c)
    clear(caption, h('span', h('b', items.length), ' pictures'), h('span', `${G.cols} x ${G.rows} per page`), h('span', h('b', pages), ` page${pages === 1 ? '' : 's'}`))
    clear(pager, pages > 1 ? [button('', { icon: 'chevron-left', variant: 'ghost', size: 'sm', ariaLabel: 'Previous page', disabled: s.page === 0, onClick: () => { s.page--; update() } }), `Page ${s.page + 1} of ${pages}`,
      button('', { icon: 'chevron-right', variant: 'ghost', size: 'sm', ariaLabel: 'Next page', disabled: s.page === pages - 1, onClick: () => { s.page++; update() } })] : null)
  }

  function applySort() {
    const fn = SORTS[s.sort]
    if (fn) { items = [...items].sort(fn); list.set(items.map((i) => i.file)) } else update()
  }

  /** Re-open the original for crisp output when the thumbnail is too small for the cell. */
  const exportSource = async (it, need) => {
    if (Math.max(it.thumb.width, it.thumb.height) >= need * 0.95) return it.thumb
    try { return await loadImage(it.file) } catch { return it.thumb }
  }

  async function render(kind) {
    const G = geom(), pages = Math.ceil(items.length / G.per), k = s.dpi / MM
    const out = []
    for (let p = 0; p < pages; p++) {
      if (signal.aborted) return null
      prog.set(p / pages, `Page ${p + 1} of ${pages}`)
      const c = await drawPage(G, p, k, exportSource)
      out.push(kind === 'png' ? await encode(c, 'image/png') : await encode(c, 'image/jpeg', 0.9))
      await yieldToMain()
    }
    return { out, G, pages }
  }

  pdfBtn.addEventListener('click', () => busy(pdfBtn, async () => {
    const r = await render('pdf')
    if (!r) return
    const { PDFDocument } = await pdfLib()
    const doc = await PDFDocument.create()
    const pt = 72 / MM
    for (const blob of r.out) {
      const img = await doc.embedJpg(await blob.arrayBuffer())
      doc.addPage([r.G.pageW * pt, r.G.pageH * pt]).drawImage(img, { x: 0, y: 0, width: r.G.pageW * pt, height: r.G.pageH * pt })
    }
    const pdf = await savePdf(doc)
    download(pdf, 'contact-sheet.pdf')
    clear(result, done('PDF saved', `${items.length} pictures on ${r.pages} page${r.pages === 1 ? '' : 's'}, ${formatBytes(pdf.size)}`))
  }, { label: 'Building', errorTo: result, progress: prog }))

  pngBtn.addEventListener('click', () => busy(pngBtn, async () => {
    const r = await render('png')
    if (!r) return
    if (r.out.length === 1) { download(r.out[0], 'contact-sheet.png'); clear(result, done('PNG saved', formatBytes(r.out[0].size))) }
    else {
      const blob = await zip(r.out.map((b, i) => ({ name: `contact-sheet-${String(i + 1).padStart(2, '0')}.png`, data: b })))
      download(blob, 'contact-sheet-pages.zip')
      clear(result, done('Pages saved', `${r.pages} PNG pages in a ZIP (${formatBytes(blob.size)})`))
    }
  }, { label: 'Rendering', errorTo: result, progress: prog }))

  async function addFiles(files) {
    if (items.length + files.length > 400) { toast('A sheet can hold up to 400 pictures.', 'error'); files = files.slice(0, Math.max(0, 400 - items.length)) }
    const loaded = await readImages(files, { signal })
    const added = []
    for (const l of loaded) {
      const it = { file: l.file, name: l.name, w: l.w, h: l.h, size: l.file.size, modified: l.file.lastModified || 0, thumb: scaled(l.img, items.length + loaded.length > 100 ? 520 : 800) }
      byFile.set(l.file, it); added.push(l.file)
    }
    if (!added.length) return
    drop.setCompact(true)
    list.add(added)
  }

  work.append(split(h('div', { class: 'stack' }, stage(pvHost, pager, caption)), h('div', { class: 'stack' }, controls, panel(h('div', { class: 'panel-title' }, h('span', 'Pictures (drag to reorder)')), h('div', { class: 'list' }, list.el))), 'wide-left'))
  root.append(h('div', { class: 't-contact stack' }, drop, h('div', { class: 'row' }, folderBtn), work))
}
