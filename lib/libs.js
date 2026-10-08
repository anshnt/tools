// Pinned CDN loaders for the heavy libraries shared across tools. Each loader is lazy and cached:
// `const { PDFDocument } = await pdfLib()`. Packs may import other libraries directly, but must pin an exact version.
// To bump a version, change it here once and re-test the tools that use it.

const cache = new Map()
const once = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw libError(key, e) }))
  return cache.get(key)
}
const libError = (key, e) => Object.assign(new Error(`Could not load ${key}. Check your connection and try again.`), { cause: e })
const jsd = (path) => `https://cdn.jsdelivr.net/npm/${path}`

export const VERSIONS = {
  pdfjs: '6.3.289',
  pdfLib: '2.11.1', // @cantoo/pdf-lib: maintained pdf-lib fork, same API, adds encryption
  jszip: '3.10.2',
  xlsx: '0.20.3',
  papaparse: '5.7.0',
  docx: '9.7.1',
  mammoth: '1.12.3',
  marked: '18.0.13',
  turndown: '7.2.4',
  dompurify: '3.4.15',
  tesseract: '7.0.0',
  transformers: '4.3.0',
  chartjs: '4.5.1',
  jspdf: '4.2.1',
  html2canvas: '2.4.3', // html2canvas-pro (supports modern CSS colors)
  diff: '9.0.0',
  hashwasm: '4.12.0',
  katex: '0.18.7',
  pptxgenjs: '4.0.1',
  anthropic: '0.127.0',
}
const V = VERSIONS

/** pdf.js with its worker configured. */
export const pdfjs = () => once('pdf.js', async () => {
  const m = await import(jsd(`pdfjs-dist@${V.pdfjs}/build/pdf.min.mjs`))
  m.GlobalWorkerOptions.workerSrc = jsd(`pdfjs-dist@${V.pdfjs}/build/pdf.worker.min.mjs`)
  return m
})
/** Options to pass to pdfjs.getDocument for correct rendering of CJK / standard fonts. */
export const pdfjsDocOptions = () => ({
  cMapUrl: jsd(`pdfjs-dist@${V.pdfjs}/cmaps/`),
  cMapPacked: true,
  standardFontDataUrl: jsd(`pdfjs-dist@${V.pdfjs}/standard_fonts/`),
  wasmUrl: jsd(`pdfjs-dist@${V.pdfjs}/wasm/`),
})
export const pdfLib = () => once('pdf-lib', () => import(jsd(`@cantoo/pdf-lib@${V.pdfLib}/+esm`)))
export const jszip = () => once('JSZip', () => import(jsd(`jszip@${V.jszip}/+esm`)).then((m) => m.default || m))
/** SheetJS (xlsx/xls/ods/csv read+write). */
export const xlsx = () => once('SheetJS', () => import(`https://cdn.sheetjs.com/xlsx-${V.xlsx}/package/xlsx.mjs`))
export const papaparse = () => once('PapaParse', () => import(jsd(`papaparse@${V.papaparse}/+esm`)).then((m) => m.default || m))
/** docx: build .docx files (Document, Packer, Paragraph, TextRun, ...). */
export const docx = () => once('docx', () => import(jsd(`docx@${V.docx}/+esm`)))
/** mammoth: .docx -> HTML / raw text. */
export const mammoth = () => once('mammoth', () => script(jsd(`mammoth@${V.mammoth}/mammoth.browser.min.js`)).then(() => window.mammoth))
export const marked = () => once('marked', () => import(jsd(`marked@${V.marked}/+esm`)))
export const turndown = () => once('turndown', () => import(jsd(`turndown@${V.turndown}/+esm`)).then((m) => m.default || m))
export const dompurify = () => once('DOMPurify', () => import(jsd(`dompurify@${V.dompurify}/+esm`)).then((m) => m.default || m))
export const tesseract = () => once('Tesseract', () => import(jsd(`tesseract.js@${V.tesseract}/dist/tesseract.esm.min.js`)).then((m) => m.default || m))
/** transformers.js (on-device ML: Whisper, background removal, upscaling, summarization ...). */
export const transformers = () => once('transformers.js', () => import(jsd(`@huggingface/transformers@${V.transformers}/+esm`)))
export const chartjs = () => once('Chart.js', async () => {
  const m = await import(jsd(`chart.js@${V.chartjs}/auto/+esm`))
  return m.default || m.Chart
})
export const jspdf = () => once('jsPDF', () => import(jsd(`jspdf@${V.jspdf}/+esm`)).then((m) => m.jsPDF || m.default))
export const html2canvas = () => once('html2canvas', () => import(jsd(`html2canvas-pro@${V.html2canvas}/+esm`)).then((m) => m.default || m))
export const diff = () => once('jsdiff', () => import(jsd(`diff@${V.diff}/+esm`)))
/** hash-wasm: md5, sha1/256/512, sha3, blake2/3, crc32, xxhash, argon2, bcrypt ... */
export const hashwasm = () => once('hash-wasm', () => import(jsd(`hash-wasm@${V.hashwasm}/+esm`)))
export const katex = () => once('KaTeX', async () => {
  if (!document.querySelector('link[data-katex]')) {
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: jsd(`katex@${V.katex}/dist/katex.min.css`) })
    link.setAttribute('data-katex', '')
    document.head.append(link)
  }
  const m = await import(jsd(`katex@${V.katex}/+esm`))
  return m.default || m
})
export const pptxgen = () => once('PptxGenJS', () => import(jsd(`pptxgenjs@${V.pptxgenjs}/+esm`)).then((m) => m.default || m))
export const anthropic = () => once('Anthropic SDK', () => import(jsd(`@anthropic-ai/sdk@${V.anthropic}/+esm`)).then((m) => m.default || m.Anthropic))

/** Load a classic (UMD) script once. Resolves when loaded. */
export function script(src) {
  return once(src, () => new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.append(s)
  }))
}
