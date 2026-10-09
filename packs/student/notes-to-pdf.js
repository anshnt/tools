// Notes to PDF: typed Markdown notes (headings, lists, tables, KaTeX math) or photos of handwritten notes become a tidy PDF.
import { h, button, busy, dropzone, fileList, field, select, segmented, toggle, progress, alert, clear, debounce, formatBytes, download, rangeField, toast } from '../../lib/ui.js'
import { toCanvas, loadImage, fitSize, toBlob } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { load, save } from '../../lib/store.js'
import { baseName, safeName } from '../../lib/files.js'
import { stage, tile, toolStyle, emptyState, TINTS, confetti, acceptTextFiles } from './_kit.js'
import { renderMarkdown, htmlToPdf, printDoc, layoutPages, katexReady, PAGE, DOC_CSS } from './_pages.js'

const SAMPLE = `# Photosynthesis - revision notes

*Biology, unit 4. Keep this next to your textbook.*

## The big idea
Plants turn **light energy** into **chemical energy** stored in glucose.

$$6CO_2 + 6H_2O \\xrightarrow{\\text{light}} C_6H_{12}O_6 + 6O_2$$

## Two stages
1. **Light-dependent reactions** (thylakoid membranes)
   - water is split, oxygen is released
   - ATP and NADPH are made
2. **Calvin cycle** (stroma)
   - carbon dioxide is fixed into sugar
   - uses ATP and NADPH from stage 1

## Quick facts
| Part | Job | Where |
|------|-----|-------|
| Chlorophyll | absorbs red and blue light | thylakoid |
| Stomata | let CO2 in and O2 out | leaf surface |
| Rubisco | fixes carbon dioxide | stroma |

> Rate of photosynthesis rises with light, CO2 and temperature until another factor limits it.

## Worked example
If a leaf fixes $n$ moles of $CO_2$, it makes $\\frac{n}{6}$ moles of glucose.

\`\`\`
glucose = CO2 fixed / 6
\`\`\`

- [x] Learn the equation
- [ ] Draw the chloroplast
`

const CSS = `
.t-n2p .tools-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.t-n2p .editor { width: 100%; min-height: 420px; font: 500 13.5px/1.6 var(--mono); resize: vertical; tab-size: 2; }
.t-n2p .paper { background: #fff; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 18px 40px -22px rgba(20,22,40,.5); padding: 28px 30px; max-height: 640px; overflow: auto; border: 1px solid var(--border); }
.t-n2p .paper .pgdoc { max-width: 100%; }
.t-n2p .opt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.t-n2p .swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.t-n2p .sw { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; transition: transform .2s var(--pop, ease); background: var(--sw); padding: 0; }
.t-n2p .sw:hover { transform: scale(1.12); }
.t-n2p .sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--text); }
.t-n2p .ba { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-n2p .ba figure { margin: 0; text-align: center; font-size: 12px; color: var(--muted); }
.t-n2p .ba canvas { width: 100%; height: auto; max-height: 360px; object-fit: contain; border-radius: 10px; border: 1px solid var(--border); background: #fff; display: block; margin-bottom: 4px; }
.t-n2p .done-card { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; animation: stu-pop .5s var(--ease) both; }
`

const ACCENTS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#334155']
const MARGINS = { narrow: 36, normal: 56, wide: 76 }

/** Clean up a photographed page. mode: 'original' | 'clean' | 'bw' | 'gray'. strength 0..100. Works in place on a canvas. */
export function scanFilter(canvas, mode = 'clean', strength = 50) {
  if (mode === 'original') return canvas
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { width: w, height: hh } = canvas
  const img = ctx.getImageData(0, 0, w, hh)
  const d = img.data
  const n = w * hh
  const lum = new Float32Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const l = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]
    lum[i] = l
    hist[l | 0]++
  }
  // auto levels from the 1st and 99th percentile
  let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break } }
  if (hi - lo < 30) { lo = Math.max(0, lo - 15); hi = Math.min(255, hi + 15) }
  const s = strength / 100
  if (mode === 'bw') {
    // adaptive threshold: compare each pixel with the local mean (integral image), so shadows and uneven light vanish
    const iw = w + 1
    const integ = new Float64Array(iw * (hh + 1))
    for (let y = 0; y < hh; y++) {
      let row = 0
      for (let x = 0; x < w; x++) { row += lum[y * w + x]; integ[(y + 1) * iw + x + 1] = integ[y * iw + x + 1] + row }
    }
    const r = Math.max(8, Math.round(Math.min(w, hh) / 24))
    const bias = 0.06 + s * 0.22
    for (let y = 0; y < hh; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(hh, y + r + 1)
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1)
        const sum = integ[y1 * iw + x1] - integ[y0 * iw + x1] - integ[y1 * iw + x0] + integ[y0 * iw + x0]
        const mean = sum / ((x1 - x0) * (y1 - y0))
        const v = lum[y * w + x] < mean * (1 - bias) ? 0 : 255
        const p = (y * w + x) * 4
        d[p] = d[p + 1] = d[p + 2] = v
      }
    }
  } else {
    const gamma = 1 - s * 0.35
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / (hi - lo))), gamma)
    for (let p = 0; p < d.length; p += 4) {
      if (mode === 'gray') {
        const v = lut[lum[p >> 2] | 0]
        d[p] = d[p + 1] = d[p + 2] = v
      } else {
        // clean colour: stretch each channel with the same levels so inks keep their colour
        d[p] = lut[d[p]]; d[p + 1] = lut[d[p + 1]]; d[p + 2] = lut[d[p + 2]]
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** Photos -> PDF Blob. opts: {mode, strength, size: 'a4'|'letter'|'photo', rotate, onProgress, signal} */
export async function photosToPdf(files, { mode = 'bw', strength = 50, size = 'a4', rotate = 0, onProgress, signal } = {}) {
  const { PDFDocument } = await pdfLib()
  const doc = await PDFDocument.create()
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    onProgress?.(i / files.length, `Cleaning photo ${i + 1} of ${files.length}`)
    const c = await prepared(files[i], { mode, strength, rotate })
    const bw = mode === 'bw'
    const blob = await toBlob(c, bw ? 'image/png' : 'image/jpeg', 0.9)
    const emb = bw ? await doc.embedPng(await blob.arrayBuffer()) : await doc.embedJpg(await blob.arrayBuffer())
    let pw, ph, x, y, w, hgt
    if (size === 'photo') {
      pw = c.width * 0.48; ph = c.height * 0.48; x = 0; y = 0; w = pw; hgt = ph
    } else {
      ;[pw, ph] = PAGE[size].pt
      const landscape = c.width > c.height * 1.15
      if (landscape) [pw, ph] = [ph, pw]
      const m = 18
      const k = Math.min((pw - m * 2) / c.width, (ph - m * 2) / c.height)
      w = c.width * k; hgt = c.height * k; x = (pw - w) / 2; y = (ph - hgt) / 2
    }
    doc.addPage([pw, ph]).drawImage(emb, { x, y, width: w, height: hgt })
    c.width = c.height = 0
    await new Promise((r) => setTimeout(r, 0))
  }
  onProgress?.(1, 'Saving')
  return new Blob([await doc.save()], { type: 'application/pdf' })
}

async function prepared(file, { mode, strength, rotate, max = 2400 }) {
  const img = await loadImage(file)
  const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, max, max)
  let c = toCanvas(img, width, height, { background: '#fff' })
  if (rotate) {
    const r = document.createElement('canvas')
    const swap = rotate % 180 !== 0
    r.width = swap ? c.height : c.width; r.height = swap ? c.width : c.height
    const g = r.getContext('2d')
    g.translate(r.width / 2, r.height / 2); g.rotate((rotate * Math.PI) / 180); g.drawImage(c, -c.width / 2, -c.height / 2)
    c = r
  }
  return scanFilter(c, mode, strength)
}

export function mount(root) {
  toolStyle('n2p', CSS)
  toolStyle('pgdoc', DOC_CSS)
  const state = { tab: 'typed', ...load('n2p:state', {}) }
  const persist = () => save('n2p:state', { tab: state.tab, md: state.md, size: state.size, margin: state.margin, font: state.font, fs: state.fs, accent: state.accent, footer: state.footer, title: state.title })
  state.md ??= ''
  state.size ??= 'a4'; state.margin ??= 'normal'; state.font ??= 'sans'; state.fs ??= 14; state.accent ??= ACCENTS[0]; state.footer ??= true; state.title ??= ''
  const wrap = stage('t-n2p')
  const tabBar = segmented([['typed', 'Typed notes'], ['photos', 'Photos of notes']], state.tab, (v) => { state.tab = v; persist(); typed.hidden = v !== 'typed'; photos.hidden = v !== 'photos' }, 'Source')

  // ---------------- Typed notes ----------------
  const editor = h('textarea', { class: 'textarea editor', spellcheck: true, placeholder: 'Type or paste notes in Markdown.\n\n# Heading\n- bullet\n**bold**, *italic*\n$x^2 + y^2 = z^2$ for math', 'aria-label': 'Notes in Markdown', value: state.md })
  const paper = h('div', { class: 'paper' })
  const pageCount = h('span', { class: 'stu-hint' })
  const result = h('div')
  const prog = progress('Building PDF')
  let html = ''
  const cls = () => [state.font === 'serif' ? 'serif' : ''].join(' ')
  const wrapSel = (a, b = a, ph = 'text') => {
    const s = editor.selectionStart, e = editor.selectionEnd
    const sel = editor.value.slice(s, e) || ph
    editor.setRangeText(a + sel + b, s, e, 'select')
    editor.focus(); editor.setSelectionRange(s + a.length, s + a.length + sel.length)
    editor.dispatchEvent(new Event('input'))
  }
  const linePrefix = (p) => {
    const s = editor.selectionStart, e = editor.selectionEnd
    const from = editor.value.lastIndexOf('\n', s - 1) + 1
    const seg = editor.value.slice(from, e)
    editor.setRangeText(seg.split('\n').map((l, i) => (p === '1. ' ? `${i + 1}. ` : p) + l).join('\n'), from, e, 'end')
    editor.focus(); editor.dispatchEvent(new Event('input'))
  }
  const toolbar = h('div', { class: 'tools-row' },
    [['H1', () => linePrefix('# ')], ['H2', () => linePrefix('## ')], ['Bold', () => wrapSel('**')], ['Italic', () => wrapSel('*')], ['List', () => linePrefix('- ')], ['Numbered', () => linePrefix('1. ')], ['Math', () => wrapSel('$', '$', 'x^2')],
      ['Table', () => wrapSel('\n| Term | Meaning |\n|------|---------|\n| ', ' | |\n', 'a')], ['Code', () => wrapSel('`')]].map(([l, f]) => button(l, { size: 'sm', variant: 'ghost', onClick: f })))
  const paint = debounce(async () => {
    state.md = editor.value; persist()
    if (!editor.value.trim()) { clear(paper, emptyState('notebook', 'Your formatted notes appear here', 'Start typing on the left, or load the sample to see headings, math and tables.', button('Load sample', { variant: 'primary', icon: 'wand-sparkles', onClick: () => { editor.value = SAMPLE; paint() } }))); html = ''; pageCount.textContent = ''; return }
    html = await renderMarkdown(editor.value)
    clear(paper, h('div', { class: ['pgdoc', cls()], style: { '--pg-fs': `${state.fs}px`, '--pg-accent': state.accent }, html }))
    try {
      const pages = layoutPages(h('div', { html }), { size: state.size, margin: MARGINS[state.margin], cls: cls(), fontSize: state.fs })
      pageCount.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} on ${state.size === 'a4' ? 'A4' : 'Letter'}`
    } catch { pageCount.textContent = '' }
  }, 220)
  editor.addEventListener('input', paint)
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); wrapSel('**') }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); wrapSel('*') }
  })
  acceptTextFiles(editor, (t) => { editor.value = t; paint() })
  const docTitle = () => state.title.trim() || html.match(/<h1[^>]*>(.*?)<\/h1>/i)?.[1].replace(/<[^>]+>/g, '') || 'notes'
  const opts = () => ({ size: state.size, margin: MARGINS[state.margin], cls: cls(), fontSize: state.fs, accent: state.accent,
    footer: state.footer ? { left: docTitle(), right: (i, n) => `Page ${i} of ${n}` } : null })

  const dl = button('Download PDF', { variant: 'primary', icon: 'download', size: 'lg' })
  dl.addEventListener('click', () => busy(dl, async () => {
    if (!html) throw new Error('Type some notes first.')
    clear(result)
    const { blob, pages } = await htmlToPdf(html, { ...opts(), onProgress: (f, t) => prog.set(f, t), signal: undefined })
    download(blob, `${safeName(docTitle())}.pdf`)
    clear(result, alert('success', `Saved ${pages} page${pages === 1 ? '' : 's'} (${formatBytes(blob.size)}). Pages are pictures of your notes; use Print for selectable text.`))
    confetti(dl, { count: 50 })
  }, { label: 'Building PDF', errorTo: result, progress: prog }))
  const pr = button('Print or save as PDF', { icon: 'printer', variant: 'secondary', onClick: () => { if (!html) return toast('Type some notes first', 'error'); printDoc(html, { size: state.size, marginMm: Math.round(MARGINS[state.margin] * 0.2646), cls: cls(), fontSize: state.fs, accent: state.accent, title: docTitle() }) } })

  const swatches = h('div', { class: 'swatches' }, ACCENTS.map((c) => h('button', { type: 'button', class: 'sw', style: { '--sw': c }, 'aria-label': `Accent ${c}`, 'aria-pressed': String(c === state.accent), onclick: (e) => { state.accent = c; for (const b of swatches.children) b.setAttribute('aria-pressed', 'false'); e.currentTarget.setAttribute('aria-pressed', 'true'); paint() } })))
  const sizeSel = select([['a4', 'A4'], ['letter', 'US Letter']], state.size, (v) => { state.size = v; paint() })
  const marginSel = select([['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide']], state.margin, (v) => { state.margin = v; paint() })
  const fontSel = select([['sans', 'Clean sans'], ['serif', 'Classic serif']], state.font, (v) => { state.font = v; paint() })
  const fsRange = rangeField('Text size', { min: 11, max: 18, step: 1, value: state.fs, format: (v) => v + ' px', onInput: (v) => { state.fs = v; paint() } })
  const titleIn = h('input', { class: 'input', type: 'text', value: state.title, placeholder: 'From the first heading', 'aria-label': 'File and footer title', oninput: (e) => { state.title = e.target.value; persist() } })
  const typed = h('div', { class: 'stack', hidden: state.tab !== 'typed' },
    h('div', { class: 'tool-split wide-left' },
      tile({ tint: TINTS[0], title: 'Your notes', icon: 'pen-line', actions: button('Sample', { size: 'sm', variant: 'ghost', icon: 'wand-sparkles', onClick: () => { editor.value = SAMPLE; paint() } }) },
        toolbar, editor, h('div', { class: 'stu-hint', style: 'margin-top:6px' }, 'Markdown with $math$ and tables. Drop a .md or .txt file here to load it.')),
      tile({ tint: TINTS[4], title: 'Preview', icon: 'eye', actions: pageCount }, paper)),
    tile({ tint: TINTS[2], title: 'Page setup', icon: 'sliders-horizontal' },
      h('div', { class: 'opt-grid' }, field('Paper', sizeSel), field('Margins', marginSel), field('Font', fontSel), fsRange, field('Title for file and footer', titleIn), field('Accent colour', swatches)),
      h('div', { style: 'margin-top:12px' }, toggle('Footer with title and page numbers (PDF download)', state.footer, (v) => { state.footer = v; persist() }))),
    h('div', { class: 'row' }, dl, pr), prog.el, result)

  // ---------------- Photos ----------------
  const ps = { mode: 'bw', strength: 50, size: 'a4', rotate: 0 }
  const list = fileList({ onChange: () => { updatePhotoBtn(); drawPreview() } })
  const dz = dropzone({ accept: 'image/*,.heic,.heif', multiple: true, label: 'Add photos of your notes', hint: 'JPG, PNG, WebP or HEIC. Drag to reorder pages after adding.', onFiles: (fs) => list.add(fs) })
  const before = h('canvas'), after = h('canvas')
  const baBox = h('div', { class: 'ba', hidden: true }, h('figure', before, h('figcaption', 'Original')), h('figure', after, h('figcaption', 'Cleaned')))
  const photoResult = h('div')
  const photoProg = progress('Creating PDF')
  const makeBtn = button('Create PDF', { variant: 'primary', icon: 'file-down', size: 'lg', disabled: true })
  const updatePhotoBtn = () => { makeBtn.disabled = !list.files.length }
  let pvToken = 0
  const drawPreview = debounce(async () => {
    const f = list.files[0]
    baBox.hidden = !f
    if (!f) return
    const tok = ++pvToken
    try {
      const o = await prepared(f, { mode: 'original', strength: 0, rotate: ps.rotate, max: 700 })
      const c = await prepared(f, { mode: ps.mode, strength: ps.strength, rotate: ps.rotate, max: 700 })
      if (tok !== pvToken) return
      for (const [dst, src] of [[before, o], [after, c]]) { dst.width = src.width; dst.height = src.height; dst.getContext('2d').drawImage(src, 0, 0) }
    } catch (e) { if (tok === pvToken) clear(photoResult, alert('error', 'Could not read that photo.')) }
  }, 150)
  const modeSeg = segmented([['bw', 'Scan (black and white)'], ['clean', 'Clean colour'], ['gray', 'Grayscale'], ['original', 'Original']], ps.mode, (v) => { ps.mode = v; drawPreview() }, 'Filter')
  const strengthR = rangeField('Strength', { min: 0, max: 100, step: 5, value: ps.strength, format: (v) => v + '%', onInput: (v) => { ps.strength = v; drawPreview() }, hint: 'Higher removes more shadow and paper texture.' })
  const psize = select([['a4', 'A4 pages'], ['letter', 'US Letter pages'], ['photo', 'Same shape as each photo']], ps.size, (v) => { ps.size = v })
  const prot = select([[0, 'No rotation'], [90, 'Rotate 90 clockwise'], [180, 'Rotate 180'], [270, 'Rotate 90 anticlockwise']], 0, (v) => { ps.rotate = +v; drawPreview() })
  makeBtn.addEventListener('click', () => busy(makeBtn, async () => {
    const files = [...list.files]
    clear(photoResult)
    list.setDisabled(true)
    try {
      const blob = await photosToPdf(files, { ...ps, onProgress: (f, t) => photoProg.set(f, t) })
      const name = `${safeName(baseName(files[0].name))}-notes.pdf`
      clear(photoResult, h('div', { class: 'stu-tile done-card', style: '--tint:#10b981' },
        alert('success', `${files.length} page${files.length === 1 ? '' : 's'}, ${formatBytes(blob.size)}`),
        button('Download PDF', { variant: 'primary', icon: 'download', onClick: () => download(blob, name) })))
      download(blob, name)
      confetti(makeBtn, { count: 60 })
    } finally { list.setDisabled(false) }
  }, { label: 'Creating PDF', errorTo: photoResult, progress: photoProg }))
  const photos = h('div', { class: 'stack', hidden: state.tab !== 'photos' },
    tile({ tint: TINTS[1], title: 'Your photos', icon: 'images' }, dz, h('div', { style: 'margin-top:10px' }, list.el)),
    tile({ tint: TINTS[3], title: 'Make it look scanned', icon: 'scan-line' },
      h('div', { class: 'stack' }, field('Filter', modeSeg), h('div', { class: 'opt-grid' }, strengthR, field('Page', psize), field('Rotate', prot)), baBox)),
    h('div', { class: 'row' }, makeBtn), photoProg.el, photoResult)

  wrap.append(h('div', { class: 'stack' }, h('div', { class: 'row' }, tabBar), typed, photos))
  root.append(wrap)
  if (!editor.value) { /* show the empty state but keep the editor empty */ }
  paint()
  updatePhotoBtn()
  katexReady().catch(() => {})
}
