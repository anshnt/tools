// HTML helpers: a clean standalone page around converted content, and HTML -> PDF through the pack-shared paginator (pdf-convert).
import { esc } from './_util.js'

export const FONT_STACK = `"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, "Noto Sans", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", "Hiragino Sans", "Microsoft YaHei", sans-serif`
export const DOC_CSS = `
html { -webkit-text-size-adjust: 100%; }
body { font: 11pt/1.55 ${FONT_STACK}; color: #1b1b22; margin: 0 auto; max-width: 52rem; padding: 2rem 1.25rem; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.3em 0 .45em; } h1 { font-size: 1.9em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; } h4 { font-size: 1.1em; }
p { margin: 0 0 .75em; } ul, ol { margin: 0 0 .75em; padding-left: 1.7em; } li { margin: .15em 0; }
table { border-collapse: collapse; margin: 0 0 1em; max-width: 100%; } td, th { border: 1px solid #c9c9d3; padding: .3em .55em; vertical-align: top; } th { background: #f1f1f5; text-align: left; }
table[border="0"] td, table[border="0"] th { border: 0; }
img { max-width: 100%; height: auto; } pre, code { font-family: Consolas, "Cascadia Mono", "Courier New", monospace; } pre { background: #f4f4f7; padding: .6em .8em; border-radius: 4px; white-space: pre-wrap; margin: 0 0 .9em; }
code { font-size: .92em; } blockquote { margin: 0 0 .8em; padding-left: .9em; border-left: 3px solid #b8b8c4; color: #55555f; }
hr { border: 0; border-top: 1px solid #bbb; margin: 1.2em 0; } a { color: #0b5cd5; }
`

/** Wrap body HTML in a standalone document. */
export function wrapDoc(body, { title = '', css = DOC_CSS, lang = '' } = {}) {
  return `<!doctype html>\n<html${lang ? ` lang="${esc(lang)}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>\n`
}

/** Text -> HTML paragraphs (keeps line breaks, links stay plain text). */
export const textToHtml = (text) => text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')

/**
 * Render a full HTML document to a paginated PDF (A4 / Letter ...). The HTML is laid out in a hidden sandboxed iframe, so scripts never run.
 * Text stays searchable for Latin, Greek, Cyrillic and Indic scripts; other scripts (Korean, Chinese, Japanese) are drawn as page images.
 * -> Uint8Array
 */
export async function htmlToPdf(html, { size = 'A4', orient = 'portrait', marginPt = 48, scale = 2, title = '', pageNumbers = false, onProgress, signal } = {}) {
  const { makeFrame, paginate, PX } = await import('../pdf-convert/_paginate.js')
  const { PAGE_SIZES } = await import('../../lib/pdf.js')
  let [W] = PAGE_SIZES[size] || PAGE_SIZES.A4
  if (orient === 'landscape') W = (PAGE_SIZES[size] || PAGE_SIZES.A4)[1]
  const pxW = Math.ceil((W - 2 * marginPt) * PX)
  const frame = await makeFrame(html, pxW)
  try {
    const r = await paginate(frame.doc.documentElement, { size, orient, margin: { t: marginPt, r: marginPt, b: marginPt, l: marginPt }, scale, layoutPx: pxW, pageNumbers, title, onProgress, signal })
    return r.bytes
  } finally { frame.destroy() }
}

/** Plain text to PDF with a monospace font and optional line numbers, through the shared text layout. -> Uint8Array */
export async function textToPdf(text, o = {}) {
  const { buildTextPdf } = await import('../pdf-convert/text-to-pdf.js')
  const r = await buildTextPdf(text, { page: 'A4', orient: 'portrait', margin: 15, font: 'mono', size: 9.5, spacing: 1.35, tab: 4, wrap: true, lineNumbers: false, pageNumbers: true, title: '', ...o })
  return r.pdfBytes || r.bytes
}
