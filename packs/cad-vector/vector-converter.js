// Vector and CAD converter. One module serves the all-in-one tool and the focused entries (params.from, params.to, params.only).
// DWG and DXF drawings, SVG and SVGZ, EMF and WMF metafiles, PDF, EPS, PS and AI. Everything runs in the browser; nothing is uploaded.
import { h, icon, dropzone, fileList, button, busy, field, select, toggle, segmented, panel, alert, progress, downloadButton, download, formatBytes, openToolWith, errorMessage, onCleanup, isAbort } from '../../lib/ui.js'
import { zip, baseName } from '../../lib/files.js'
import { CONVERTERS, convertWithNotes, kindOfFile } from './_convert.js'

const LABEL = { dwg: 'DWG', dxf: 'DXF', svg: 'SVG', svgz: 'SVGZ', emf: 'EMF', wmf: 'WMF', emz: 'EMZ', wmz: 'WMZ', pdf: 'PDF', eps: 'EPS', ps: 'PS', ai: 'AI', png: 'PNG' }
const BLURB = {
  dxf: 'An open CAD file with real lines, circles and text, in millimetres, with the page flipped so it is not upside down. Opens in any CAD program.',
  svg: 'Clean scalable vector graphics for the web and design apps.',
  svgz: 'SVG compressed with gzip, much smaller for big drawings.',
  png: 'A picture of the drawing. Pick a resolution below.',
  pdf: 'A vector PDF that prints sharply at any size.',
  eps: 'PostScript for print shops and older design programs. Text becomes outlines so it looks the same everywhere.',
  ps: 'PostScript, written as the same vector program as EPS.',
  emf: 'Windows enhanced metafile that Windows programs and office documents can place.',
  wmf: 'Classic Windows metafile. It has no curves or clipping, so curves are drawn as short straight segments.',
}
const ACCEPT_EXT = ['dwg', 'dxf', 'svg', 'svgz', 'emf', 'wmf', 'emz', 'wmz', 'pdf', 'eps', 'ps', 'ai']
// metafile and CAD files get odd picture types from some systems; a plain type keeps the file list from trying to show them as images
const plain = (f) => (/\.(svg|png)$/i.test(f.name) ? f : new File([f], f.name, { type: 'application/octet-stream' }))
const accOf = (list) => list.map((e) => `.${e}`).join(',')

const CSS = `
.t-vc .vc-hint { font-size:13px; color:var(--text-2); margin:0; }
.t-vc .vc-pair { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
.t-vc .vc-tag { font-weight:700; padding:6px 12px; border-radius:12px; background:var(--surface-2); border:1px solid var(--border); }
.t-vc .vc-tag.to { background:var(--accent); color:var(--accent-text,#fff); border-color:transparent; }
.t-vc .vc-opts { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }
.t-vc .vc-res { display:flex; flex-direction:column; gap:10px; }
.t-vc .vc-item { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:10px; border:1px solid var(--border); border-radius:12px; background:var(--surface); }
.t-vc .vc-item img { width:72px; height:54px; object-fit:contain; background:#fff; border:1px solid var(--border); border-radius:8px; }
.t-vc .vc-item .vc-ic { width:72px; height:54px; display:grid; place-items:center; color:var(--muted); background:var(--surface-2); border-radius:8px; }
.t-vc .vc-item .nm { flex:1 1 160px; min-width:0; overflow-wrap:anywhere; font-weight:550; }
.t-vc .vc-item .sz { color:var(--muted); font-size:12px; }
.t-vc .vc-notes { margin:6px 0 0; padding-left:18px; font-size:13px; }
.t-vc [hidden] { display:none !important; }
`
let styled = false

/** Output formats offered for an input extension (from the same routes the File Converter hub uses). */
export function targetsFor(ext, only) {
  const out = []
  for (const r of CONVERTERS) if (r.from.includes(ext)) for (const t of r.to) if (t !== ext && !out.includes(t) && (!only || only.includes(t))) out.push(t)
  return out
}

export function mount(root, { params = {}, signal }) {
  if (!styled) { styled = true; document.head.append(h('style', { 'data-vc': '' }, CSS)) }
  const fromList = params.from ? String(params.from).split(',') : ACCEPT_EXT
  const only = params.only ? String(params.only).split(',') : null
  const fixedTo = params.to || null
  const st = { to: fixedTo, opts: { paper: 'A4', px: '2000', dpi: '150', transparent: false, curves: 'spline', fills: false, outline: true, pages: '', password: '' }, results: [], urls: [] }
  onCleanup(() => st.urls.forEach((u) => URL.revokeObjectURL(u)))

  const dz = dropzone({ accept: accOf(fromList), multiple: true, onFiles: (fs) => { list.add(fs.map(plain)); refresh() }, label: fixedTo ? `Drop ${fromList.map((e) => LABEL[e] || e).join(' or ')} files here or click to browse` : undefined, hint: 'Your files never leave this device.' })
  const list = fileList({ onChange: () => refresh() })
  const listWrap = h('div', { hidden: true }, list.el)
  const pair = h('div', { class: 'vc-pair' })
  const seg = h('div')
  const blurb = h('p', { class: 'vc-hint' })
  const optsBox = h('div', { class: 'vc-opts' })
  const pwIn = h('input', { class: 'input', type: 'password', placeholder: 'PDF password', 'aria-label': 'PDF password', oninput: (e) => { st.opts.password = e.target.value } })
  const pwField = field('Password', pwIn, 'This PDF is protected. Enter its password and convert again.')
  pwField.hidden = true
  const prog = progress('Converting')
  const resultBox = h('div', { class: 'stack' })
  const goBtn = button('Convert', { icon: 'repeat-2', variant: 'primary', size: 'lg', onClick: () => busy(goBtn, run, { label: 'Converting', errorTo: resultBox, progress: prog }) })
  const settings = panel(h('div', { class: 'stack' }, pair, field(fixedTo ? null : 'Convert to', seg), blurb, optsBox, pwField, h('div', { class: 'stack' }, goBtn, prog.el)))
  settings.hidden = true
  root.append(h('div', { class: 't-vc stack' }, dz, listWrap, settings, resultBox))

  const kinds = () => [...new Set(list.files.map((f) => kindOfFile(f.name, null)).filter(Boolean))]
  const common = () => {
    const ks = kinds()
    if (!ks.length) return []
    return ks.map((k) => targetsFor(k, only)).reduce((a, b) => a.filter((x) => b.includes(x)))
  }

  function buildOpts(to) {
    const ks = kinds()
    const cad = ks.some((k) => k === 'dwg' || k === 'dxf'), pdfIn = ks.includes('pdf')
    const o = st.opts
    const items = []
    if (cad && (to === 'pdf' || to === 'svg')) items.push(field('Paper', select([['A4', 'A4'], ['A3', 'A3'], ['A2', 'A2'], ['A1', 'A1'], ['A0', 'A0'], ['Letter', 'Letter'], ['Tabloid', 'Tabloid'], ['drawing', 'Drawing size (1:1)']], o.paper, (v) => { o.paper = v }), 'The drawing is scaled to fit the page.'))
    if (to === 'png') {
      if (cad) items.push(field('Width', select([['1000', '1000 px'], ['2000', '2000 px'], ['4000', '4000 px'], ['8000', '8000 px']], o.px, (v) => { o.px = v })))
      else items.push(field('Resolution', select([['96', '96 dpi (screen)'], ['150', '150 dpi'], ['300', '300 dpi (print)']], o.dpi, (v) => { o.dpi = v })))
      items.push(toggle('Transparent background', o.transparent, (c) => { o.transparent = c }))
    }
    if (to === 'dxf' && !cad) {
      items.push(field('Curves', select([['spline', 'Splines (smooth)'], ['polyline', 'Straight segments (most compatible)']], o.curves, (v) => { o.curves = v })))
      items.push(toggle('Solid hatches for filled shapes', o.fills, (c) => { o.fills = c }))
    }
    if ((to === 'eps' || to === 'ps') && !cad) items.push(toggle('Convert text to outlines', o.outline, (c) => { o.outline = c }))
    if (pdfIn) items.push(field('Pages', h('input', { class: 'input', type: 'text', placeholder: 'All pages, or e.g. 1-3, 5', 'aria-label': 'Pages', value: o.pages, oninput: (e) => { o.pages = e.target.value } })))
    optsBox.replaceChildren(...items)
    optsBox.hidden = !items.length
  }

  function refresh() {
    const has = list.files.length > 0
    listWrap.hidden = !has
    settings.hidden = !has
    if (!has) { resultBox.replaceChildren(); return }
    const ts = common()
    if (!ts.length) {
      seg.replaceChildren(h('p', { class: 'vc-hint' }, 'These files need different output formats. Convert them one kind at a time.'))
      goBtn.disabled = true; pair.replaceChildren(); blurb.textContent = ''; optsBox.hidden = true
      return
    }
    goBtn.disabled = false
    if (fixedTo && ts.includes(fixedTo)) st.to = fixedTo
    else if (!ts.includes(st.to)) st.to = ts[0]
    if (!fixedTo) {
      const s = segmented(ts.map((t) => [t, LABEL[t] || t.toUpperCase()]), st.to, (v) => { st.to = v; refresh() }, 'Output format')
      seg.replaceChildren(s)
    } else seg.replaceChildren()
    const ks = kinds()
    pair.replaceChildren(h('span', { class: 'vc-tag' }, ks.map((k) => LABEL[k] || k).join(' / ')), icon('arrow-right'), h('span', { class: 'vc-tag to' }, LABEL[st.to] || st.to))
    blurb.textContent = BLURB[st.to] || ''
    buildOpts(st.to)
    goBtn.querySelector('span').textContent = list.files.length > 1 ? `Convert ${list.files.length} files to ${LABEL[st.to]}` : `Convert to ${LABEL[st.to]}`
  }

  async function run() {
    const files = [...list.files]
    if (!files.length) return
    list.setDisabled(true)
    pwField.hidden = true
    resultBox.replaceChildren()
    st.urls.forEach((u) => URL.revokeObjectURL(u)); st.urls = []
    const out = []
    const failures = []
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        prog.set(i / files.length, files.length > 1 ? `File ${i + 1} of ${files.length}` : 'Converting')
        try {
          const r = await convertWithNotes(f, st.to, st.opts, { signal, onProgress: (fr, t) => prog.set((i + (fr ?? 0)) / files.length, t || (files.length > 1 ? `File ${i + 1} of ${files.length}` : 'Converting')) })
          out.push({ src: f, files: r.files, notes: r.notes })
        } catch (e) {
          if (isAbort(e)) throw e
          if (e.code === 'PASSWORD') pwField.hidden = false
          failures.push({ src: f, msg: errorMessage(e) })
        }
      }
    } finally { list.setDisabled(false) }
    prog.hide()
    show(out, failures)
  }

  function show(out, failures) {
    const all = out.flatMap((o) => o.files)
    const items = out.flatMap((o) => o.files.map((f) => {
      const thumb = /\.(png|svg)$/i.test(f.name) ? (() => { const u = URL.createObjectURL(f); st.urls.push(u); return h('img', { src: u, alt: `Preview of ${f.name}` }) })() : h('div', { class: 'vc-ic' }, icon('file'))
      return h('div', { class: 'vc-item' }, thumb, h('div', { class: 'nm' }, f.name, h('div', { class: 'sz' }, `${formatBytes(o.src.size)} to ${formatBytes(f.size)}`)),
        downloadButton(f, f.name, 'Download', { size: 'sm' }),
        /\.dxf$/i.test(f.name) ? button('Open in CAD Studio', { icon: 'drafting-compass', size: 'sm', onClick: () => openToolWith('cad-studio', [f]) }) : null,
        /\.svg$/i.test(f.name) ? button('Edit in Vector Studio', { icon: 'pen-tool', size: 'sm', onClick: () => openToolWith('vector-studio', [f]) }) : null)
    }))
    const notes = [...new Set(out.flatMap((o) => o.notes))]
    const kids = []
    if (all.length) kids.push(alert('success', h('strong', all.length > 1 ? `${all.length} files are ready` : 'Your file is ready'), ` (${formatBytes(all.reduce((a, f) => a + f.size, 0))}).`))
    if (failures.length) kids.push(alert('error', h('strong', 'Some files could not be converted'), h('ul', { class: 'vc-notes' }, failures.map((x) => h('li', `${x.src.name}: ${x.msg}`)))))
    if (items.length) kids.push(h('div', { class: 'vc-res' }, items))
    if (all.length > 1) kids.push(button('Download all (ZIP)', { icon: 'download', variant: 'primary', onClick: async () => download(await zip(all.map((f) => ({ name: f.name, data: f }))), `${baseName(all[0].name)}-${st.to}.zip`) }))
    if (notes.length) kids.push(alert('info', h('strong', 'Notes'), h('ul', { class: 'vc-notes' }, notes.map((n) => h('li', n)))))
    resultBox.replaceChildren(h('section', { class: 'panel stack' }, ...kids))
  }
}
