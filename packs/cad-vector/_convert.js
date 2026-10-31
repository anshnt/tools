// Routes of the CAD and vector pack for the File Converter hub, and the engine behind every tool in this pack.
// Everything is lazy: libraries load inside run(). Inputs read into the shared vector model (packs/corel/_model.js), outputs written from it.
import { withExt, baseName, ext as extOf } from '../../lib/files.js'

const PAPER_OPT = { key: 'paper', label: 'Paper (drawings to PDF or SVG)', type: 'select', choices: [['A4', 'A4'], ['A3', 'A3'], ['A2', 'A2'], ['A1', 'A1'], ['A0', 'A0'], ['Letter', 'Letter'], ['Tabloid', 'Tabloid'], ['drawing', 'Drawing size (1:1)']], default: 'A4' }
const PX_OPT = { key: 'px', label: 'PNG width in pixels', type: 'select', choices: [['1000', '1000'], ['2000', '2000'], ['4000', '4000'], ['8000', '8000']], default: '2000' }
const DPI_OPT = { key: 'dpi', label: 'PNG resolution', type: 'select', choices: [['96', '96 dpi'], ['150', '150 dpi'], ['300', '300 dpi']], default: '150' }
const CURVES_OPT = { key: 'curves', label: 'Curves in DXF', type: 'select', choices: [['spline', 'Splines (smooth)'], ['polyline', 'Straight segments (most compatible)']], default: 'spline' }
const FILLS_OPT = { key: 'fills', label: 'DXF: add solid hatches for filled shapes', type: 'toggle', default: false }
const PAGES_OPT = { key: 'pages', label: 'PDF pages (blank = all)', type: 'text', default: '' }
const OUTLINE_OPT = { key: 'outline', label: 'Convert text to outlines (EPS, PS)', type: 'toggle', default: true }
const TRANSP_OPT = { key: 'transparent', label: 'Transparent PNG background', type: 'toggle', default: false }

const VECTOR_OPTS = [DPI_OPT, TRANSP_OPT, CURVES_OPT, FILLS_OPT, OUTLINE_OPT]
export const CONVERTERS = [
  { from: ['dwg'], to: ['dxf', 'svg', 'pdf', 'png'], group: 'CAD', options: [PAPER_OPT, PX_OPT], run: (f, to, o, c) => runAs(f, to, o, c) },
  { from: ['dxf'], to: ['svg', 'pdf', 'png'], group: 'CAD', options: [PAPER_OPT, PX_OPT], run: (f, to, o, c) => runAs(f, to, o, c) },
  { from: ['svg'], to: ['dxf', 'emf', 'wmf', 'svgz', 'pdf', 'png', 'eps', 'ps'], group: 'Vector', options: VECTOR_OPTS, run: (f, to, o, c) => runAs(f, to, o, c) },
  { from: ['svgz'], to: ['svg', 'png', 'pdf', 'dxf', 'emf'], group: 'Vector', options: VECTOR_OPTS, run: (f, to, o, c) => runAs(f, to, o, c) },
  { from: ['emf', 'wmf', 'emz', 'wmz'], to: ['svg', 'png', 'pdf', 'dxf', 'eps', 'svgz', 'emf', 'wmf'], group: 'Windows metafiles', options: VECTOR_OPTS, run: (f, to, o, c) => runAs(f, to, o, c) },
  { from: ['pdf'], to: ['svg', 'dxf', 'eps', 'ps', 'emf'], group: 'Vector', options: [PAGES_OPT, ...VECTOR_OPTS], run: (f, to, o, c) => runAs(f, to, o, c) },
  { from: ['eps', 'ps', 'ai'], to: ['svg', 'png', 'pdf', 'dxf', 'emf'], group: 'Vector', options: VECTOR_OPTS, run: (f, to, o, c) => runAs(f, to, o, c) },
]
export const SNIFF = [
  { ext: 'emf', test: (b) => b.length > 44 && b[0] === 1 && b[1] === 0 && b[2] === 0 && b[3] === 0 && b[40] === 0x20 && b[41] === 0x45 && b[42] === 0x4d && b[43] === 0x46 },
  { ext: 'wmf', test: (b) => b[0] === 0xd7 && b[1] === 0xcd && b[2] === 0xc6 && b[3] === 0x9a },
  { ext: 'dwg', test: (b) => b[0] === 0x41 && b[1] === 0x43 && b[2] === 0x31 && b[3] === 0x30 },
]

const userErr = (m) => Object.assign(new Error(m), { userMessage: m })
const bytesOf = async (file) => new Uint8Array(await file.arrayBuffer())
const asciiHead = (b, n = 1024) => { let s = ''; for (let i = 0; i < Math.min(n, b.length); i++) s += String.fromCharCode(b[i]); return s }
const mimeOf = { svg: 'image/svg+xml', svgz: 'image/svg+xml', png: 'image/png', pdf: 'application/pdf', dxf: 'application/dxf', eps: 'application/postscript', ps: 'application/postscript', emf: 'image/emf', wmf: 'image/wmf' }

/** What a file is, from its bytes first and its name second: 'svg' | 'svgz' | 'emf' | 'wmf' | 'dwg' | 'dxf' | 'pdf' | 'eps' | 'ps' | 'ai' | null. */
export function kindOfFile(name, b) {
  const e = extOf(name)
  if (b) {
    if (b[0] === 0x1f && b[1] === 0x8b) return e === 'emz' ? 'emz' : e === 'wmz' ? 'wmz' : 'svgz'
    if (SNIFF[0].test(b)) return 'emf'
    if (SNIFF[1].test(b)) return 'wmf'
    if (/^AC10\d\d/.test(asciiHead(b, 6))) return 'dwg'
    if (asciiHead(b, 8).startsWith('%PDF-')) return e === 'ai' ? 'ai' : 'pdf'
    if (asciiHead(b, 4).startsWith('%!PS') || b[0] === 0xc5 && b[1] === 0xd0) return e === 'ai' ? 'ai' : e === 'ps' ? 'ps' : 'eps'
  }
  if (['svg', 'svgz', 'emf', 'wmf', 'emz', 'wmz', 'dwg', 'dxf', 'pdf', 'eps', 'ps', 'ai'].includes(e)) return e
  if (b && /<svg[\s>]/i.test(asciiHead(b, 2000))) return 'svg'
  if (b && /^\s*0\s+SECTION/.test(asciiHead(b, 200))) return 'dxf'
  return null
}

/** Read any vector input into the shared model. Returns {doc: {pages, warnings, fonts?}, notes}. */
export async function readVector(file, { pages = '', password, onProgress, signal } = {}) {
  const bytes = await bytesOf(file)
  let kind = kindOfFile(file.name, bytes)
  const notes = []
  const gz = async (b) => (b[0] === 0x1f && b[1] === 0x8b ? (await import('./_svgz.js')).gunzip(b) : b)
  let doc
  if (kind === 'svg' || kind === 'svgz') {
    const raw = await gz(bytes)
    const { svgToDoc } = await import('../corel/_svgin.js')
    doc = await svgToDoc(new TextDecoder().decode(raw))
  } else if (kind === 'emf' || kind === 'emz') {
    const { emfToDoc } = await import('./_emf.js')
    doc = await emfToDoc(await gz(bytes), { onProgress, signal })
  } else if (kind === 'wmf' || kind === 'wmz') {
    const { wmfToDoc } = await import('./_wmf.js')
    doc = await wmfToDoc(await gz(bytes), { onProgress, signal })
  } else if (kind === 'pdf' || (kind === 'ai' && asciiHead(bytes, 8).startsWith('%PDF-'))) {
    const { pdfToDoc } = await import('../corel/_pdfin.js')
    let list = null
    if (String(pages).trim()) {
      const { openPdf, parseRanges } = await import('../../lib/pdf.js')
      const d = await openPdf(bytes, { password })
      try { list = parseRanges(String(pages), d.numPages) } finally { d.destroy?.() }
    }
    doc = await pdfToDoc(bytes, { password, pages: list, onProgress: (f, t) => onProgress?.(f, t), signal })
  } else if (kind === 'eps' || kind === 'ps' || kind === 'ai') {
    const { psToDoc } = await import('../corel/_psin.js')
    doc = await psToDoc(bytes, { onProgress: (f) => onProgress?.(f), signal })
  } else throw userErr('This tool reads SVG, SVGZ, EMF, WMF, PDF, EPS, PS and AI files.')
  if (!doc.pages?.length) throw userErr('The file has no pages to convert.')
  notes.push(...(doc.warnings || []))
  return { doc, notes, kind }
}

const hasText = (doc) => doc.pages.some((p) => p.items.some((i) => i.t === 'text'))
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d)

/** Write a model into `to` ('svg' | 'svgz' | 'png' | 'pdf' | 'eps' | 'ps' | 'dxf' | 'emf' | 'wmf'). Returns {files: File[], notes}. */
export async function writeVector(doc, to, srcName, opts = {}, { onProgress } = {}) {
  const base = baseName(srcName) || 'drawing'
  const notes = []
  const out = []
  const multi = doc.pages.length > 1
  const nm = (i, e) => (multi ? `${base}-p${i + 1}.${e}` : `${base}.${e}`)
  const file = (name, blob) => new File([blob], name, { type: mimeOf[extOf(name)] || blob.type || 'application/octet-stream' })
  const step = (i) => onProgress?.((i + 1) / doc.pages.length)
  if (to === 'pdf') {
    const { toPdf } = await import('../corel/_pdfout.js')
    const r = await toPdf(doc, { title: base })
    notes.push(...r.notes)
    out.push(file(`${base}.pdf`, r.blob))
    return { files: out, notes }
  }
  if ((to === 'eps' || to === 'ps') && opts.outline !== false && hasText(doc)) {
    const { outlineDoc } = await import('../corel/_text.js')
    const r = await outlineDoc(doc)
    if (r.kept) notes.push(`${r.kept} text item(s) use characters the bundled fonts do not have and stay as live text.`)
  }
  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i]
    if (to === 'svg' || to === 'svgz') {
      const { pageToSvg } = await import('../corel/_svgout.js')
      const text = pageToSvg(page, { unit: 'mm', title: base, fonts: doc.fonts })
      if (to === 'svg') out.push(file(nm(i, 'svg'), new Blob([text], { type: 'image/svg+xml' })))
      else out.push(file(nm(i, 'svgz'), new Blob([await (await import('./_svgz.js')).gzip(new TextEncoder().encode(text))], { type: 'image/svg+xml' })))
    } else if (to === 'png') {
      const { pageToPng } = await import('./_raster.js')
      out.push(file(nm(i, 'png'), await pageToPng(page, { dpi: num(opts.dpi, 150), transparent: !!opts.transparent, fonts: doc.fonts })))
    } else if (to === 'eps' || to === 'ps') {
      const { epsBlob } = await import('../corel/_eps.js')
      const r = await epsBlob(doc, i, { title: base })
      notes.push(...r.notes)
      out.push(file(nm(i, to), r.blob))
    } else if (to === 'dxf') {
      const { pageToDxf } = await import('./_dxfout.js')
      const r = pageToDxf(page, { curves: opts.curves === 'polyline' ? 'polyline' : 'spline', fills: !!opts.fills })
      notes.push(...r.notes)
      out.push(file(nm(i, 'dxf'), r.blob))
    } else if (to === 'emf' || to === 'wmf') {
      const m = await import('./_emfout.js')
      const r = await (to === 'emf' ? m.pageToEmf : m.pageToWmf)(page, { title: base })
      notes.push(...r.notes)
      out.push(file(nm(i, to), r.blob))
    } else throw userErr(`Cannot write ${to.toUpperCase()} here.`)
    step(i)
  }
  return { files: out, notes }
}

/** DWG or DXF -> dxf, svg, pdf or png. */
async function cadRoute(file, bytes, kind, to, opts, { signal, onProgress }) {
  const base = baseName(file.name) || 'drawing'
  const notes = []
  let dxf = bytes
  if (kind === 'dwg') {
    onProgress?.(0.1, 'Reading the DWG')
    const r = await (await import('./_dwg.js')).dwgToDxf(bytes, { signal })
    dxf = r.dxf
    notes.push(`DWG ${r.version} read with LibreDWG.`)
    if (to === 'dxf') return { files: [new File([dxf], `${base}.dxf`, { type: 'application/dxf' })], notes }
  }
  onProgress?.(0.5, 'Drawing')
  const { dxfToCad, cadExport, skippedNote } = await import('./_cad.js')
  const { doc, res } = await dxfToCad(dxf, base)
  const s = skippedNote(res)
  if (s) notes.push(s)
  const blob = await cadExport(doc, to, { paper: opts.paper, px: num(opts.px, 2000), transparent: !!opts.transparent })
  return { files: [new File([blob], `${base}.${to}`, { type: mimeOf[to] })], notes }
}

/** The one entry point: file in, {files, notes} out. */
export async function convertWithNotes(file, to, opts = {}, ctx = {}) {
  const bytes = await bytesOf(file)
  const kind = kindOfFile(file.name, bytes)
  if (kind === 'dwg' || kind === 'dxf') {
    if (!['dxf', 'svg', 'pdf', 'png'].includes(to) || (kind === 'dxf' && to === 'dxf')) throw userErr(`Cannot convert ${kind.toUpperCase()} to ${to.toUpperCase()}.`)
    return cadRoute(file, bytes, kind, to, opts, ctx)
  }
  const { doc, notes } = await readVector(file, { pages: opts.pages, password: opts.password, onProgress: ctx.onProgress, signal: ctx.signal })
  const r = await writeVector(doc, to, file.name, opts, ctx)
  return { files: r.files, notes: [...new Set([...notes, ...r.notes])], doc }
}

async function runAs(file, to, opts, ctx) {
  const r = await convertWithNotes(file, to, opts || {}, ctx || {})
  const files = r.files
  files.notes = r.notes
  return files
}
void withExt
