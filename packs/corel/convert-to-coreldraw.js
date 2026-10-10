// Convert to CorelDRAW format. CorelDRAW cannot be written by any free tool (the .cdr format is closed), so this writes the formats CorelDRAW
// opens as fully editable vectors: EPS, AI (PDF-compatible), PDF and SVG. Inputs: SVG, PDF, PNG, JPG, WebP and HEIC (traced into vectors).
import { h, dropzone, button, busy, alert, field, select, toggle, segmented, rangeField, number, stats, progress, downloadButton, download, formatBytes, debounce, yieldToMain, onCleanup, icon, fileType, toast, errorMessage, openToolWith } from '../../lib/ui.js'
import { loadImage } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { openPdf, renderPage, parseRanges, loadPdfLib, savePdf } from '../../lib/pdf.js'
import { baseName, zip, readDataURL } from '../../lib/files.js'
import { docStats, MM } from './_model.js'
import { svgToDoc } from './_svgin.js'
import { pdfToDoc } from './_pdfin.js'
import { traceImage, PRESETS } from './_trace.js'
import { outlineDoc } from './_text.js'
import { epsBlob } from './_eps.js'
import { toPdf } from './_pdfout.js'
import { pageToSvg } from './_svgout.js'

export const FORMATS = {
  eps: { label: 'EPS', ext: 'eps', desc: 'Vector PostScript. CorelDRAW opens it with editable curves, fills and outlines. The safest choice for logos.' },
  ai: { label: 'AI', ext: 'ai', desc: 'A PDF-compatible Illustrator-style file saved as .ai. CorelDRAW opens it as editable vectors.' },
  pdf: { label: 'PDF', ext: 'pdf', desc: 'Vector PDF. In CorelDRAW use File > Open: paths, colours and text come in editable.' },
  svg: { label: 'SVG', ext: 'svg', desc: 'Corel-friendly SVG: absolute size in millimetres, plain attributes, transforms flattened into the paths.' },
}
const ACCEPT = {
  svg: '.svg,image/svg+xml', pdf: '.pdf,application/pdf', image: '.png,.jpg,.jpeg,.webp,.heic,.heif,.gif,.bmp,.avif,image/*',
  all: '.svg,image/svg+xml,.pdf,application/pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.gif,.bmp,.avif,image/*',
}
const CSS = `
.t-cv [hidden] { display:none !important; }
.t-cv .cv-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.t-cv .cv-bar .name { font-weight:600; overflow-wrap:anywhere; min-width:0; }
.t-cv .cv-bar .meta { color:var(--muted); font-size:13px; }
.t-cv .cv-grid { display:grid; grid-template-columns:minmax(0,5fr) minmax(0,7fr); gap:16px; align-items:start; }
.t-cv .cv-opts { display:flex; flex-direction:column; gap:14px; }
.t-cv .cv-fmt-desc { font-size:13px; color:var(--text-2); margin-top:8px; }
.t-cv .cv-pair { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; }
.t-cv .cv-cap { font-size:12px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
.t-cv .cv-busy { position:relative; }
.t-cv .cv-busy::after { content:'Tracing...'; position:absolute; inset:0; display:grid; place-items:center; background:color-mix(in srgb, var(--surface) 70%, transparent); font-weight:600; border-radius:14px; }
.t-cv .cv-notes { margin:6px 0 0; padding-left:18px; font-size:13px; }
.t-cv .cv-steps { margin:0; padding-left:20px; display:grid; gap:4px; font-size:14px; }
.t-cv .cv-files { display:flex; flex-direction:column; gap:8px; }
.t-cv .cv-file { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.t-cv .cv-file .nm { flex:1 1 180px; min-width:0; overflow-wrap:anywhere; font-weight:550; }
@media (max-width: 860px) { .t-cv .cv-grid { grid-template-columns:minmax(0,1fr); } }
@media (max-width: 520px) { .t-cv .cv-pair { grid-template-columns:minmax(0,1fr); } }
`
let styled = false
function injectCss() {
  if (styled) return
  styled = true
  document.head.append(h('style', { 'data-corel-cv': '' }, CSS))
}

const kindOf = (f) => {
  const t = fileType(f), n = f.name.toLowerCase()
  if (t === 'image/svg+xml' || n.endsWith('.svg')) return 'svg'
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf'
  if (t.startsWith('image/') || /\.(heic|heif|png|jpe?g|webp|gif|bmp|avif)$/.test(n)) return 'image'
  return null
}
const svgUrl = (page) => URL.createObjectURL(new Blob([pageToSvg(page, { unit: 'pt', background: '#ffffff' })], { type: 'image/svg+xml' }))

export function mount(root, { params, signal }) {
  injectCss()
  const from = params.from || 'all'
  const st = { file: null, kind: null, doc: null, notes: [], img: null, imgUrl: null, pdfDoc: null, pdfBytes: null, password: '', numPages: 0, trace: null, token: 0,
    fmt: params.to || 'eps', outline: null, outlineTouched: false, mode: 'trace', preset: 'logo', opts: { ...PRESETS.logo }, widthMm: 0, keepPdf: true, pages: '', urls: [] }
  const toRevoke = []
  const track = (u) => { toRevoke.push(u); return u }
  onCleanup(() => { toRevoke.forEach((u) => URL.revokeObjectURL(u)); st.pdfDoc?.destroy?.() })

  const holder = h('div', { class: 'stack' })
  const dz = dropzone({ accept: ACCEPT[from] || ACCEPT.all, onFiles: ([f]) => load(f),
    label: from === 'svg' ? 'Drop an SVG here or click to browse' : from === 'pdf' ? 'Drop a PDF here or click to browse' : from === 'image' ? 'Drop a PNG, JPG or WebP here or click to browse' : 'Drop an SVG, PDF, PNG or JPG here or click to browse',
    hint: 'Your file never leaves this device.' })
  const bar = h('div', { class: 'panel cv-bar', hidden: true })
  const grid = h('div', { class: 'cv-grid', hidden: true })
  const resultBox = h('div', { class: 'stack' })
  const help = h('div', { class: 'panel' },
    h('h2', icon('info'), 'Opening the file in CorelDRAW'),
    h('ol', { class: 'cv-steps' },
      h('li', 'In CorelDRAW choose ', h('strong', 'File > Open'), ' (or ', h('strong', 'File > Import'), ' to add it to a drawing) and pick the file you downloaded.'),
      h('li', 'For EPS, leave "Import PostScript text as curves" off to keep text editable, or on to keep the exact look.'),
      h('li', 'Edit as you like, then use ', h('strong', 'File > Save As'), ' and choose ', h('strong', 'CDR'), ' to get a native CorelDRAW file.')),
    h('p', { class: 'small muted', style: 'margin:10px 0 0' }, 'The .cdr format is closed, so no free tool can write it directly. These formats are the ones CorelDRAW reads as fully editable vector art.'))
  root.append(h('div', { class: 't-cv stack' }, dz, bar, holder, grid, resultBox, help))

  // ---------- controls ----------
  const fmtSeg = segmented(Object.entries(FORMATS).map(([k, v]) => [k, v.label]), st.fmt, (v) => { st.fmt = v; refreshFmt() }, 'Output format')
  const fmtDesc = h('div', { class: 'cv-fmt-desc' })
  const outlineT = toggle('Convert text to outlines', false, (c) => { st.outline = c; st.outlineTouched = true })
  const outlineHint = h('small', { class: 'field-hint' }, 'Keeps the exact letter shapes using a bundled free font. Turn off to keep text editable (EPS and PDF then use standard fonts).')
  const keepT = toggle('Keep the original PDF for PDF and AI output', true, (c) => { st.keepPdf = c })
  const keepHint = h('small', { class: 'field-hint' }, 'Best fidelity: pages, fonts and images stay exactly as they are. Turn off to rebuild the page as editable paths.')
  const pagesIn = h('input', { class: 'input', type: 'text', placeholder: 'All pages, or e.g. 1-3, 5', 'aria-label': 'Pages', oninput: (e) => { st.pages = e.target.value } })
  const passIn = h('input', { class: 'input', type: 'password', placeholder: 'PDF password', 'aria-label': 'PDF password', oninput: (e) => { st.password = e.target.value } })
  const passField = field('Password', passIn, 'This PDF is protected. Enter its password.')
  passField.hidden = true
  const modeSeg = segmented([['trace', 'Trace into vectors'], ['embed', 'Embed the image']], st.mode, (v) => { st.mode = v; refreshRaster(); if (v === 'trace') retrace() })
  const presetSel = select(Object.entries(PRESETS).map(([k, v]) => [k, v.label]), st.preset, (v) => applyPreset(v))
  const presetHint = h('small', { class: 'field-hint' }, PRESETS.logo.hint)
  const colorsR = rangeField('Colours', { min: 2, max: 64, step: 1, value: st.opts.colors, onInput: (v) => { st.opts.colors = v; retrace() } })
  const detailR = rangeField('Detail', { min: 1, max: 10, step: 1, value: st.opts.detail, onInput: (v) => { st.opts.detail = v; retrace() }, format: (v) => `${v} of 10` })
  const smoothR = rangeField('Smoothing', { min: 0, max: 5, step: 1, value: st.opts.smooth, onInput: (v) => { st.opts.smooth = v; retrace() }, format: (v) => `${v} of 5` })
  const bgT = toggle('Remove the background', st.opts.removeBg, (c) => { st.opts.removeBg = c; retrace() })
  const widthIn = number(0, { min: 1, step: 1, ariaLabel: 'Output width in millimetres', onInput: (v) => { st.widthMm = v; retrace() } })
  const rasterBox = h('div', { class: 'cv-opts' }, field('Mode', modeSeg), h('div', { class: 'cv-opts', 'data-trace': '' }, field('Style', presetSel, null), presetHint, colorsR, detailR, smoothR, bgT, field('Output width (mm)', widthIn, 'Pixel size at 96 dpi by default. The vectors scale to any size afterwards.')))
  const pdfBox = h('div', { class: 'cv-opts' }, keepT, keepHint, field('Pages', pagesIn), passField)
  const svgBox = h('div', { class: 'cv-opts' })
  const textBox = h('div', { class: 'cv-opts' }, outlineT, outlineHint)
  const prog = progress('Converting')
  const goBtn = button('Convert', { icon: 'file-output', variant: 'primary', size: 'lg', onClick: () => busy(goBtn, convert, { label: 'Converting', errorTo: resultBox, progress: prog }) })
  const optsPanel = h('section', { class: 'panel cv-opts' }, h('h2', icon('settings-2'), 'Settings'), field('Output format', fmtSeg), fmtDesc, rasterBox, pdfBox, svgBox, textBox, h('div', { class: 'stack' }, goBtn, prog.el))
  const prevHost = h('div', { class: 'stack' })
  const prevPanel = h('section', { class: 'panel' }, h('h2', icon('eye'), 'Preview'), prevHost)
  grid.append(optsPanel, prevPanel)

  function refreshFmt() {
    fmtSeg.set(st.fmt)
    fmtDesc.textContent = FORMATS[st.fmt].desc
    if (!st.outlineTouched && st.kind) { st.outline = st.fmt !== 'svg'; outlineT.input.checked = st.outline }
    keepT.hidden = keepHint.hidden = !(st.kind === 'pdf' && (st.fmt === 'pdf' || st.fmt === 'ai'))
  }
  function refreshRaster() {
    rasterBox.hidden = st.kind !== 'image'
    rasterBox.querySelector('[data-trace]').hidden = st.mode !== 'trace'
    textBox.hidden = st.kind === 'image' || !(st.doc ? hasText(st.doc) : st.kind === 'pdf')
    pdfBox.hidden = st.kind !== 'pdf'
  }
  const hasText = (doc) => doc.pages.some((p) => p.items.some((i) => i.t === 'text'))
  function applyPreset(k) {
    st.preset = k
    st.opts = { ...PRESETS[k] }
    presetHint.textContent = PRESETS[k].hint
    colorsR.set(st.opts.colors); detailR.set(st.opts.detail); smoothR.set(st.opts.smooth); bgT.input.checked = st.opts.removeBg
    colorsR.input.disabled = st.opts.bw
    retrace()
  }

  // ---------- loading ----------
  async function load(file) {
    const kind = kindOf(file)
    if (!kind) return toast('Use an SVG, PDF, PNG, JPG or WebP file.', 'error')
    if (from !== 'all' && kind !== from) return toast(`This tool takes ${from === 'image' ? 'PNG, JPG or WebP' : from.toUpperCase()} files.`, 'error')
    resultBox.replaceChildren()
    st.token++
    st.file = file; st.kind = kind; st.doc = null; st.trace = null; st.dirty = false; st.notes = []; st.numPages = 0; st.pdfDoc = null; st.pdfBytes = null
    st.outlineTouched = false
    bar.hidden = false; grid.hidden = false
    prevHost.replaceChildren(h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), 'Reading your file...'))
    bar.replaceChildren(icon(kind === 'pdf' ? 'file-text' : kind === 'svg' ? 'file-code' : 'image'), h('span', { class: 'name' }, file.name), h('span', { class: 'meta' }, formatBytes(file.size)),
      h('span', { style: 'flex:1' }), button('Choose another', { icon: 'upload', size: 'sm', onClick: () => dz.open() }))
    try {
      if (kind === 'svg') {
        st.doc = await svgToDoc(await file.text())
        st.notes = st.doc.warnings
        const p = st.doc.pages[0]
        bar.querySelector('.meta').textContent += ` - ${(p.w / MM).toFixed(1)} x ${(p.h / MM).toFixed(1)} mm`
        showModel(st.doc)
      } else if (kind === 'pdf') {
        st.pdfBytes = new Uint8Array(await file.arrayBuffer())
        await openPdfFile()
      } else {
        st.img = await loadImage(file)
        const w = st.img.naturalWidth, hgt = st.img.naturalHeight
        bar.querySelector('.meta').textContent += ` - ${w} x ${hgt} px`
        st.widthMm = Math.round(((w * 25.4) / 96) * 10) / 10
        widthIn.value = st.widthMm
        st.imgUrl && URL.revokeObjectURL(st.imgUrl)
        st.imgUrl = URL.createObjectURL(file.type && file.type !== 'image/heic' ? file : await (await fetch(st.img.src)).blob())
        applyPreset(st.preset)
      }
    } catch (e) {
      console.error(e)
      prevHost.replaceChildren(alert('error', errorMessage(e)))
      return
    }
    if (st.outline == null || !st.outlineTouched) st.outline = st.fmt !== 'svg'
    outlineT.input.checked = !!st.outline
    refreshFmt(); refreshRaster()
  }

  async function openPdfFile(pwd) {
    passField.hidden = true
    try {
      st.pdfDoc?.destroy?.()
      st.pdfDoc = await openPdf(st.pdfBytes, { password: pwd ?? st.password })
    } catch (e) {
      if (e.code === 'PASSWORD') { passField.hidden = false; prevHost.replaceChildren(alert('warn', errorMessage(e))); return }
      throw e
    }
    st.numPages = st.pdfDoc.numPages
    bar.querySelector('.meta').textContent = `${formatBytes(st.file.size)} - ${st.numPages} page${st.numPages === 1 ? '' : 's'}`
    const c = await renderPage(st.pdfDoc, 1, { scale: 1.2 })
    prevHost.replaceChildren(h('div', { class: 'cv-cap' }, 'Page 1 of your PDF'), h('div', { class: 'preview' }, c))
    refreshRaster()
  }

  function showModel(doc) {
    const url = track(svgUrl(doc.pages[0]))
    prevHost.replaceChildren(h('div', { class: 'cv-cap' }, 'What will be written'), h('div', { class: 'preview' }, h('img', { src: url, alt: 'Preview of the converted drawing' })), statsBar(doc))
  }
  const statsBar = (doc) => {
    const s = docStats(doc)
    return stats([{ label: 'Paths', value: s.paths, accent: true }, { label: 'Nodes', value: s.nodes }, { label: 'Text', value: s.texts }, { label: 'Images', value: s.images }])
  }

  // ---------- tracing ----------
  const retrace = () => { st.dirty = true; retraceSoon() }
  const retraceSoon = debounce(async () => {
    if (st.kind !== 'image' || st.mode !== 'trace' || !st.img) { if (st.kind === 'image') showRaster(); return }
    const token = ++st.token
    const box = prevHost.querySelector('.cv-trace')
    box?.classList.add('cv-busy')
    try {
      await yieldToMain()
      const r = await traceImage(st.img, { ...st.opts, widthPt: (st.widthMm || 1) * MM })
      if (token !== st.token) return
      st.trace = r
      st.dirty = false
      st.doc = { pages: [r.page], warnings: [] }
      showRaster()
    } catch (e) {
      if (token === st.token) { console.error(e); prevHost.replaceChildren(alert('error', errorMessage(e))) }
    }
  }, 280)

  function showRaster() {
    const orig = h('div', null, h('div', { class: 'cv-cap' }, 'Your image'), h('div', { class: 'preview' }, h('img', { src: st.imgUrl, alt: 'Original image' })))
    if (st.mode === 'embed') {
      prevHost.replaceChildren(orig, alert('info', 'The image is placed in the file unchanged (pixels, not vectors). EPS, AI, PDF and SVG all carry it; CorelDRAW opens it as a bitmap you can trace there too.'))
      return
    }
    const r = st.trace
    if (!r) { prevHost.replaceChildren(orig, h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), 'Tracing...')); retrace(); return }
    const url = track(svgUrl(r.page))
    prevHost.replaceChildren(h('div', { class: 'cv-pair' }, orig, h('div', { class: 'cv-trace' }, h('div', { class: 'cv-cap' }, 'Traced vectors'), h('div', { class: 'preview' }, h('img', { src: url, alt: 'Traced vector preview' })))),
      stats([{ label: 'Paths', value: r.paths, accent: true }, { label: 'Nodes', value: r.nodes }, { label: 'Colours', value: r.colors }]))
  }

  // ---------- convert ----------
  async function rasterDoc() {
    const w = st.img.naturalWidth, hgt = st.img.naturalHeight
    const jpgOrPng = /^image\/(png|jpeg|webp)$/.test(st.file.type)
    let href
    if (jpgOrPng) href = await readDataURL(st.file)
    else { const c = document.createElement('canvas'); c.width = w; c.height = hgt; c.getContext('2d').drawImage(st.img, 0, 0); href = c.toDataURL('image/png') }
    const pw = ((st.widthMm || (w * 25.4) / 96) * MM), ph = (pw * hgt) / w
    return { pages: [{ w: pw, h: ph, items: [{ t: 'image', href, w, h: hgt, opacity: 1, m: [pw, 0, 0, ph, 0, 0] }] }], warnings: [] }
  }

  async function convert() {
    if (!st.file) throw new Error('Choose a file first.')
    resultBox.replaceChildren()
    const fmt = st.fmt, name = baseName(st.file.name)
    const notes = []
    let doc = null, files = []
    prog.set(null, 'Preparing')
    if (st.kind === 'pdf') {
      if (!st.pdfDoc) { await openPdfFile(); if (!st.pdfDoc) return }
      const pages = st.pages.trim() ? parseRanges(st.pages, st.numPages) : null
      if (st.keepPdf && (fmt === 'pdf' || fmt === 'ai')) {
        let blob = new Blob([st.pdfBytes], { type: 'application/pdf' })
        if (pages && pages.length !== st.numPages) {
          const src = await loadPdfLib(st.pdfBytes, { password: st.password })
          const { PDFDocument } = await pdfLib()
          const out = await PDFDocument.create()
          for (const p of await out.copyPages(src, pages.map((n) => n - 1))) out.addPage(p)
          blob = await savePdf(out)
        }
        files = [{ name: `${name}.${FORMATS[fmt].ext}`, blob }]
        notes.push('The original PDF was kept as it is, so fonts, images and layout are exactly as in your file.')
      } else {
        doc = await pdfToDoc(st.pdfBytes, { password: st.password, pages, onProgress: (f, t) => prog.set(f, t), signal })
        notes.push(...doc.warnings)
      }
    } else if (st.kind === 'svg') {
      doc = structuredClone(st.doc)
      notes.push(...doc.warnings)
    } else if (st.mode === 'embed') {
      doc = await rasterDoc()
    } else {
      if (st.dirty || !st.trace) { st.trace = await traceImage(st.img, { ...st.opts, widthPt: (st.widthMm || 1) * MM }); st.dirty = false }
      doc = { pages: [structuredClone(st.trace.page)], warnings: [] }
    }
    if (doc) {
      if (st.outline && hasText(doc)) {
        prog.set(null, 'Converting text to outlines')
        const r = await outlineDoc(doc)
        if (r.kept) notes.push(`${r.kept} text item(s) use characters the bundled fonts do not have and stay as live text.`)
      }
      prog.set(null, 'Writing the file')
      const multi = doc.pages.length > 1
      const suffix = (i) => (multi ? `-p${i + 1}` : '')
      if (fmt === 'eps') {
        for (let i = 0; i < doc.pages.length; i++) { const r = await epsBlob(doc, i, { title: name }); notes.push(...r.notes); files.push({ name: `${name}${suffix(i)}.eps`, blob: r.blob }); await yieldToMain() }
      } else if (fmt === 'svg') {
        for (let i = 0; i < doc.pages.length; i++) files.push({ name: `${name}${suffix(i)}.svg`, blob: new Blob([pageToSvg(doc.pages[i], { unit: 'mm', title: name })], { type: 'image/svg+xml' }) })
      } else {
        const r = await toPdf(doc, { title: name })
        notes.push(...r.notes)
        files = [{ name: `${name}.${FORMATS[fmt].ext}`, blob: r.blob }]
      }
      if (st.kind === 'pdf') showModel(doc)
    }
    const uniq = [...new Set(notes)]
    const total = files.reduce((a, f) => a + f.blob.size, 0)
    const s = doc ? docStats(doc) : null
    resultBox.replaceChildren(h('section', { class: 'panel stack' },
      alert('success', h('strong', files.length > 1 ? `${files.length} files are ready` : 'Your file is ready'), ` (${formatBytes(total)}). Open it in CorelDRAW with File > Open.`),
      s ? stats([{ label: 'Paths', value: s.paths, accent: true }, { label: 'Nodes', value: s.nodes }, { label: 'Text', value: s.texts }, { label: 'Images', value: s.images }]) : null,
      h('div', { class: 'cv-files' }, files.map((f) => h('div', { class: 'cv-file' }, icon('file'), h('span', { class: 'nm' }, f.name), h('span', { class: 'meta small muted' }, formatBytes(f.blob.size)),
        downloadButton(f.blob, f.name, 'Download', { size: 'sm' }),
        fmt === 'svg' ? button('Edit in Vector Studio', { icon: 'pen-tool', size: 'sm', onClick: () => openToolWith('vector-studio', [new File([f.blob], f.name, { type: 'image/svg+xml' })]) }) : null))),
      files.length > 1 ? button('Download all as ZIP', { icon: 'download', variant: 'primary', onClick: async () => download(await zip(files.map((f) => ({ name: f.name, data: f.blob }))), `${name}-${fmt}.zip`) }) : null,
      uniq.length ? alert('info', h('strong', 'Notes'), h('ul', { class: 'cv-notes' }, uniq.map((n) => h('li', n)))) : null))
    prog.hide()
  }

  refreshFmt(); refreshRaster()
  grid.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault() })
  void signal
}
