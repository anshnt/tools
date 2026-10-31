// E-book and comic converter. One module serves the all-in-one tool and the focused EPUB to PDF, MOBI to EPUB, CBR to CBZ ... entries
// (params.accept limits what can be dropped, params.to fixes the target). It calls the same functions as the File Converter hub.
import { h, icon, dropzone, fileList, button, busy, progress, alert, panel, field, select, rangeField, number, toggle, segmented, downloadButton, clear, formatBytes, errorMessage, download } from '../../lib/ui.js'
import { ext, zip } from '../../lib/files.js'
import { BOOK_IN, COMIC_IN, BOOK_OUT, COMIC_OUT, convertBook, pdfToCbz } from './_convert.js'

const ALL_ACCEPT = [...BOOK_IN, ...COMIC_IN, 'pdf', 'zip'].map((e) => `.${e}`).join(',')
const LABEL = { epub: 'EPUB', kepub: 'KEPUB', pdf: 'PDF', docx: 'DOCX', txt: 'TXT', html: 'HTML', md: 'Markdown', cbz: 'CBZ' }
const CSS = `
.t-ebook .eb-route{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.t-ebook .eb-tag{font-weight:700;letter-spacing:.02em;padding:6px 14px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2)}
.t-ebook .eb-tag.to{background:var(--accent);border-color:transparent;color:var(--accent-text,#fff)}
.t-ebook .eb-res{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.t-ebook .eb-res .meta{flex:1;min-width:180px}
.t-ebook .eb-res .name{font-weight:600;overflow-wrap:anywhere}
.t-ebook .eb-note{font-size:13px;color:var(--muted)}
.t-ebook .eb-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
`
let styled = false

/** What a file is, by name: 'book' | 'comic' | 'pdf' | null (a plain .zip is checked by its content). */
async function kindOf(f) {
  const e = ext(f.name)
  if (BOOK_IN.includes(e)) return 'book'
  if (COMIC_IN.includes(e)) return 'comic'
  if (e === 'pdf') return 'pdf'
  if (e === 'zip') {
    const { sniffFormat } = await import('./_read.js')
    try { const s = await sniffFormat(f); return s === 'comic' ? 'comic' : s ? 'book' : null } catch { return null }
  }
  return null
}
const targetsFor = (kind) => (kind === 'book' ? BOOK_OUT : kind === 'comic' ? COMIC_OUT : kind === 'pdf' ? [['cbz', 'CBZ (comic)']] : [])

export function mount(root, { params = {}, signal }) {
  if (!styled) { document.head.append(h('style', CSS)); styled = true }
  const accept = params.accept || ALL_ACCEPT
  const fixedTo = params.to || null
  const o = { to: fixedTo || 'epub', pageSize: 'A5', fontSize: 11, font: 'serif', comicPage: 'fit', comicImages: 'smart', wrap: 0, mdImages: false, dpi: 150 }
  let items = [] // { file, kind }

  const list = fileList({ sortable: false, onChange: (fs) => { items = items.filter((i) => fs.includes(i.file)); refresh() } })
  const zone = dropzone({
    accept, multiple: true,
    label: params.label || 'Drop e-books or comics here, or click to choose',
    hint: params.hint || 'EPUB, KEPUB, MOBI, AZW3, FB2, HTMLZ, TXTZ, PDB, CBZ, CBR, CB7. Files stay on your device.',
    onFiles: async (fs) => {
      for (const f of fs) {
        if (items.some((i) => i.file === f)) continue
        items.push({ file: f, kind: await kindOf(f) })
      }
      list.set(items.map((i) => i.file))
    },
  })
  const targetHost = h('div')
  const optHost = h('div', { class: 'eb-row' })
  const result = h('div', { class: 'stack' })
  const prog = progress()
  const goBtn = button('Convert', { icon: 'repeat-2', variant: 'primary', size: 'lg' })
  const banner = params.from && fixedTo ? h('div', { class: 'eb-route' }, h('span', { class: 'eb-tag' }, params.from), icon('arrow-right'), h('span', { class: 'eb-tag to' }, LABEL[fixedTo] || fixedTo.toUpperCase())) : null

  function validTargets() {
    const kinds = [...new Set(items.map((i) => i.kind))]
    if (!kinds.length) return { list: fixedTo ? [[fixedTo, LABEL[fixedTo]]] : [], mixed: false }
    if (kinds.includes(null)) return { list: [], mixed: false, bad: true }
    let list = targetsFor(kinds[0])
    for (const k of kinds.slice(1)) { const t = targetsFor(k).map((x) => x[0]); list = list.filter((x) => t.includes(x[0])) }
    if (fixedTo) list = list.filter((x) => x[0] === fixedTo)
    return { list, mixed: kinds.length > 1 && !list.length }
  }

  function refresh() {
    zone.classList.toggle('compact', items.length > 0)
    const { list: targets, mixed, bad } = validTargets()
    clear(targetHost)
    if (bad) clear(targetHost, alert('warn', 'One of these files is not a supported e-book or comic. Remove it to continue.'))
    else if (mixed) clear(targetHost, alert('warn', 'E-books, comics and PDFs cannot be converted in one go. Convert them separately.'))
    else if (items.length && !targets.length) clear(targetHost, alert('warn', fixedTo ? `These files cannot be saved as ${LABEL[fixedTo]}.` : 'These files cannot be converted to a common format.'))
    else if (!fixedTo && targets.length) {
      if (!targets.some((x) => x[0] === o.to)) o.to = targets[0][0]
      clear(targetHost, field('Convert to', segmented(targets, o.to, (v) => { o.to = v; drawOptions() }, 'Target format')))
    }
    if (fixedTo && items.length && targets.length) o.to = fixedTo
    drawOptions()
    goBtn.disabled = !items.length || !targets.length
    const n = items.length
    goBtn.querySelector('span').textContent = n > 1 ? `Convert ${n} files` : 'Convert'
  }

  function drawOptions() {
    clear(optHost)
    const kinds = new Set(items.map((i) => i.kind))
    const comic = kinds.has('comic'), pdfIn = kinds.has('pdf')
    const to = o.to
    if (to === 'pdf' && !comic && !pdfIn) {
      optHost.append(
        field('Page size', select([['A5', 'A5 (book)'], ['A6', 'A6 (pocket)'], ['A4', 'A4'], ['Letter', 'Letter']], o.pageSize, (v) => { o.pageSize = v })),
        rangeField('Font size', { min: 8, max: 18, step: 1, value: o.fontSize, format: (v) => `${v} pt`, onInput: (v) => { o.fontSize = v } }),
        field('Font', select([['serif', 'Serif'], ['sans', 'Sans']], o.font, (v) => { o.font = v })))
    } else if (to === 'pdf' && comic) {
      optHost.append(
        field('Page size', select([['fit', 'Fit each picture'], ['A4', 'A4'], ['A5', 'A5'], ['Letter', 'Letter']], o.comicPage, (v) => { o.comicPage = v })),
        field('Pictures', select([['smart', 'Keep as they are'], ['jpeg', 'Smaller file (JPEG)']], o.comicImages, (v) => { o.comicImages = v })))
    } else if (to === 'txt') {
      optHost.append(field('Wrap lines at', number(o.wrap, { min: 0, max: 200, step: 1, onInput: (n) => { o.wrap = Number.isFinite(n) ? n : 0 } }), '0 keeps each paragraph on one line.'))
    } else if (to === 'md') {
      optHost.append(toggle('Include pictures (saved as a ZIP)', o.mdImages, (v) => { o.mdImages = v }))
    } else if (pdfIn && to === 'cbz') {
      optHost.append(rangeField('Resolution', { min: 72, max: 300, step: 6, value: o.dpi, format: (v) => `${v} dpi`, onInput: (v) => { o.dpi = v } }))
    }
    optHost.hidden = !optHost.childElementCount
  }

  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const run = [...items]
    clear(result)
    list.setDisabled(true)
    const outs = []
    try {
      for (let i = 0; i < run.length; i++) {
        if (signal?.aborted) return
        const { file, kind } = run[i]
        const base = i / run.length
        const span = 1 / run.length
        const onProgress = (p, t) => prog.set(p == null ? null : base + p * span, `${run.length > 1 ? `${i + 1}/${run.length} ` : ''}${t || 'Converting'}: ${file.name}`)
        onProgress(0)
        try {
          let files
          if (kind === 'pdf') files = [await pdfToCbz(file, { dpi: o.dpi }, onProgress)]
          else {
            const opts = o.to === 'pdf' ? (kind === 'comic' ? { pageSize: o.comicPage, images: o.comicImages } : { pageSize: o.pageSize, fontSize: o.fontSize, font: o.font }) : o.to === 'txt' ? { wrap: o.wrap } : o.to === 'md' ? { images: o.mdImages } : {}
            files = await convertBook(file, o.to, opts, { onProgress })
          }
          outs.push({ src: file, files })
        } catch (e) {
          console.error(e)
          outs.push({ src: file, error: errorMessage(e), drm: e?.code === 'DRM' })
        }
        result.replaceChildren(...render(outs))
      }
    } finally {
      list.setDisabled(false)
    }
  }, { label: 'Converting', progress: prog, errorTo: result }))

  function render(outs) {
    const ok = outs.flatMap((r) => r.files || [])
    const rows = outs.map((r) => {
      if (r.error) return alert('error', h('strong', `${r.src.name}: `), r.error)
      return r.files.map((f) => h('div', { class: 'eb-res' },
        icon('file-check'),
        h('div', { class: 'meta' }, h('div', { class: 'name' }, f.name), h('div', { class: 'eb-note' }, `${formatBytes(r.src.size)} to ${formatBytes(f.size)}`), ...(f.notes || []).map((n) => h('div', { class: 'eb-note' }, n))),
        downloadButton(f, f.name, 'Download', { size: 'sm' })))
    })
    const all = ok.length > 1 ? h('div', { class: 'row' }, (() => {
      const b = button('Download all (ZIP)', { icon: 'file-archive', variant: 'secondary' })
      b.addEventListener('click', () => busy(b, async () => download(await zip(ok.map((f) => ({ name: f.name, data: f }))), 'converted-books.zip'), 'Zipping'))
      return b
    })()) : null
    return [...rows.flat(), all].filter(Boolean)
  }

  root.append(h('div', { class: 't-ebook stack' },
    banner, zone, list.el,
    panel(h('div', { class: 'stack' }, targetHost, optHost, h('div', { class: 'row' }, goBtn, h('span', { class: 'small muted' }, 'Converted on your device. Copy-protected (DRM) books cannot be converted.')))),
    prog.el, result))
  refresh()
}
