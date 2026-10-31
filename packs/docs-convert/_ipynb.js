// Jupyter notebooks (.ipynb) -> standalone HTML or Markdown. Markdown cells are rendered with marked, code cells keep their source, and outputs
// (text streams, tracebacks, HTML, SVG, PNG / JPEG pictures, LaTeX / plain text) are kept in order.
import { marked as markedLib, dompurify } from '../../lib/libs.js'
import { esc, fail, decodeText, base64ToBytes } from './_util.js'
import { DOC_CSS, wrapDoc } from './_html.js'

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g
const src = (s) => (Array.isArray(s) ? s.join('') : s || '')
const CSS = `${DOC_CSS}
body { max-width: 60rem; }
.nb-cell { margin: 0 0 1em; } .nb-row { display: flex; gap: .6em; align-items: flex-start; } .nb-prompt { flex: none; width: 5.2em; text-align: right; font: .78em/1.6 Consolas, monospace; color: #6a6a76; padding-top: .35em; user-select: none; }
.nb-in .nb-prompt { color: #3057c4; } .nb-out .nb-prompt { color: #b44a1a; } .nb-body { flex: 1; min-width: 0; }
.nb-code { background: #f6f6f9; border: 1px solid #dedee6; border-radius: 4px; padding: .5em .7em; margin: 0; font-size: .88em; white-space: pre-wrap; overflow-wrap: anywhere; }
.nb-stream { margin: 0; font-size: .86em; white-space: pre-wrap; overflow-wrap: anywhere; background: none; padding: .2em 0; } .nb-stderr { color: #b3261e; background: #fdf0ee; padding: .3em .5em; }
.nb-err { margin: 0; font-size: .86em; white-space: pre-wrap; background: #fdf0ee; color: #8c1d18; padding: .4em .6em; border-radius: 4px; }
.nb-out img { max-width: 100%; height: auto; } .nb-md { padding: 0; } .nb-raw { white-space: pre-wrap; font: .88em Consolas, monospace; color: #55555f; }
`

/** Parse and validate notebook JSON text. */
export function parseNotebook(text) {
  let nb
  try { nb = JSON.parse(text.replace(/^﻿/, '')) } catch { throw fail('This is not valid notebook JSON. Is it really an .ipynb file?') }
  if (!nb || !Array.isArray(nb.cells || nb.worksheets?.[0]?.cells)) throw fail('This notebook has no cells (is it an .ipynb file?).')
  if (!nb.cells) nb.cells = nb.worksheets[0].cells.map((c) => ({ ...c, cell_type: c.cell_type === 'heading' ? 'markdown' : c.cell_type, source: c.cell_type === 'heading' ? `${'#'.repeat(c.level || 1)} ${src(c.source)}` : c.source ?? c.input }))
  return nb
}
const language = (nb) => nb.metadata?.kernelspec?.language || nb.metadata?.language_info?.name || 'python'

const dataOf = (d, mime) => { const v = d[mime]; return v == null ? null : Array.isArray(v) ? v.join('') : v }

/** Notebook -> HTML. opts: {title, code: show code cells (default true), prompts} */
export async function notebookToHtml(nb, { title = '', code = true, prompts = true } = {}) {
  const marked = await markedLib()
  const purify = await dompurify()
  const lang = language(nb)
  const safe = (html) => purify.sanitize(html, { FORBID_TAGS: ['form', 'input', 'button', 'iframe', 'object', 'embed', 'script', 'link', 'meta'], ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/|#)/i })
  const parts = []
  let heading = ''
  for (const cell of nb.cells) {
    const text = src(cell.source)
    if (cell.cell_type === 'markdown') {
      let md = text
      for (const [name, v] of Object.entries(cell.attachments || {})) { const mime = Object.keys(v)[0]; if (mime) md = md.split(`attachment:${name}`).join(`data:${mime};base64,${dataOf(v, mime).replace(/\s+/g, '')}`) }
      const html = safe(marked.parse(md))
      if (!heading) heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '') || ''
      parts.push(`<div class="nb-cell nb-row nb-md">${prompts ? '<div class="nb-prompt"></div>' : ''}<div class="nb-body">${html}</div></div>`)
    } else if (cell.cell_type === 'code') {
      if (code && text.trim()) parts.push(`<div class="nb-cell nb-row nb-in">${prompts ? `<div class="nb-prompt">In [${cell.execution_count ?? ' '}]:</div>` : ''}<div class="nb-body"><pre class="nb-code" data-lang="${esc(lang)}">${esc(text.replace(/\n$/, ''))}</pre></div></div>`)
      for (const o of cell.outputs || []) {
        let body = ''
        if (o.output_type === 'stream') body = `<pre class="nb-stream${o.name === 'stderr' ? ' nb-stderr' : ''}">${esc(src(o.text).replace(ANSI, ''))}</pre>`
        else if (o.output_type === 'error') body = `<pre class="nb-err">${esc((o.traceback || [`${o.ename}: ${o.evalue}`]).join('\n').replace(ANSI, ''))}</pre>`
        else if (o.data || o.output_type === 'pyout') {
          const d = o.data || { 'text/plain': o.text }
          const png = dataOf(d, 'image/png'), jpg = dataOf(d, 'image/jpeg'), svg = dataOf(d, 'image/svg+xml'), htm = dataOf(d, 'text/html'), md = dataOf(d, 'text/markdown'), tex = dataOf(d, 'text/latex'), plain = dataOf(d, 'text/plain')
          if (png) body = `<img alt="output" src="data:image/png;base64,${png.replace(/\s+/g, '')}">`
          else if (jpg) body = `<img alt="output" src="data:image/jpeg;base64,${jpg.replace(/\s+/g, '')}">`
          else if (svg) body = `<img alt="output" src="data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}">`
          else if (htm) body = safe(htm)
          else if (md) body = safe(marked.parse(md))
          else if (tex) body = `<pre class="nb-stream">${esc(tex)}</pre>`
          else if (plain != null) body = `<pre class="nb-stream">${esc(plain.replace(ANSI, ''))}</pre>`
        }
        if (body) parts.push(`<div class="nb-cell nb-row nb-out">${prompts ? `<div class="nb-prompt">${o.output_type === 'execute_result' || o.output_type === 'pyout' ? `Out [${o.execution_count ?? cell.execution_count ?? ' '}]:` : ''}</div>` : ''}<div class="nb-body">${body}</div></div>`)
      }
    } else if (cell.cell_type === 'raw' && text.trim()) parts.push(`<div class="nb-cell nb-row">${prompts ? '<div class="nb-prompt"></div>' : ''}<div class="nb-body"><pre class="nb-raw">${esc(text)}</pre></div></div>`)
  }
  return wrapDoc(parts.join('\n'), { title: title || nb.metadata?.title || heading || 'Notebook', css: CSS })
}

/** Notebook -> Markdown. -> {text, images: [{name, bytes, mime}]} (pictures are saved as files next to the Markdown). */
export function notebookToMarkdown(nb, { code = true, outputs = true } = {}) {
  const lang = language(nb)
  const images = []
  const out = []
  const fence = (s, l = '') => { const f = /```/.test(s) ? '````' : '```'; return `${f}${l}\n${s.replace(/\n$/, '')}\n${f}` }
  for (const cell of nb.cells) {
    const text = src(cell.source)
    if (cell.cell_type === 'markdown') {
      let md = text
      for (const [name, v] of Object.entries(cell.attachments || {})) {
        const mime = Object.keys(v)[0]
        if (!mime) continue
        const ext = mime.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg')
        const fname = `images/attachment-${images.length + 1}.${ext}`
        images.push({ name: fname, bytes: base64ToBytes(dataOf(v, mime).replace(/\s+/g, '')), mime })
        md = md.split(`attachment:${name}`).join(fname)
      }
      out.push(md.trim())
    } else if (cell.cell_type === 'code') {
      if (code && text.trim()) out.push(fence(text, lang))
      if (!outputs) continue
      for (const o of cell.outputs || []) {
        if (o.output_type === 'stream') out.push(fence(src(o.text).replace(ANSI, ''), 'text'))
        else if (o.output_type === 'error') out.push(fence((o.traceback || [`${o.ename}: ${o.evalue}`]).join('\n').replace(ANSI, ''), 'text'))
        else if (o.data) {
          const d = o.data
          const png = dataOf(d, 'image/png'), jpg = dataOf(d, 'image/jpeg'), svg = dataOf(d, 'image/svg+xml'), md = dataOf(d, 'text/markdown'), plain = dataOf(d, 'text/plain')
          const img = (bytes, ext, mime) => { const name = `images/output-${images.length + 1}.${ext}`; images.push({ name, bytes, mime }); return `![output](${name})` }
          if (png) out.push(img(base64ToBytes(png.replace(/\s+/g, '')), 'png', 'image/png'))
          else if (jpg) out.push(img(base64ToBytes(jpg.replace(/\s+/g, '')), 'jpg', 'image/jpeg'))
          else if (svg) out.push(img(new TextEncoder().encode(svg), 'svg', 'image/svg+xml'))
          else if (md) out.push(md.trim())
          else if (plain != null) out.push(fence(plain.replace(ANSI, ''), 'text'))
        }
      }
    } else if (cell.cell_type === 'raw' && text.trim()) out.push(fence(text))
  }
  return { text: out.join('\n\n') + '\n', images }
}
void decodeText
