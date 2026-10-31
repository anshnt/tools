// Markup converter between Markdown, HTML, reStructuredText, AsciiDoc, Org, LaTeX, MediaWiki, Textile, DocBook, Jupyter notebooks, OPML and man pages.
// Engine: pandoc compiled to WebAssembly (GPL-2.0-or-later, loaded at run time from a CDN as a separate program; about 60 MB the first time, then cached by
// the browser). AsciiDoc input goes through asciidoctor.js (MIT) first. Markdown <-> HTML and Jupyter notebooks use small built-in paths with no download.
import { marked as markedLib, script } from '../../lib/libs.js'
import { fail, esc } from './_util.js'

const PANDOC_VER = '1.1.0'
const CORE_URL = `https://cdn.jsdelivr.net/npm/pandoc-wasm@${PANDOC_VER}/src/core.js/+esm`
const WASM_URL = `https://unpkg.com/pandoc-wasm@${PANDOC_VER}/src/pandoc.wasm`
const ASCIIDOCTOR_URL = 'https://cdn.jsdelivr.net/npm/@asciidoctor/core@3.0.4/dist/browser/asciidoctor.min.js'

export const FORMATS = [
  { id: 'markdown', label: 'Markdown', ext: 'md', exts: ['md', 'markdown', 'mdown', 'mkd'], read: 'gfm', write: 'gfm' },
  { id: 'html', label: 'HTML', ext: 'html', exts: ['html', 'htm', 'xhtml'], read: 'html', write: 'html' },
  { id: 'rst', label: 'reStructuredText', ext: 'rst', exts: ['rst', 'rest'], read: 'rst', write: 'rst' },
  { id: 'asciidoc', label: 'AsciiDoc', ext: 'adoc', exts: ['adoc', 'asciidoc', 'asc'], read: null, write: 'asciidoc' },
  { id: 'org', label: 'Org mode', ext: 'org', exts: ['org'], read: 'org', write: 'org' },
  { id: 'latex', label: 'LaTeX', ext: 'tex', exts: ['tex', 'latex'], read: 'latex', write: 'latex' },
  { id: 'mediawiki', label: 'MediaWiki', ext: 'wiki', exts: ['wiki', 'mediawiki', 'mw'], read: 'mediawiki', write: 'mediawiki' },
  { id: 'textile', label: 'Textile', ext: 'textile', exts: ['textile'], read: 'textile', write: 'textile' },
  { id: 'docbook', label: 'DocBook', ext: 'dbk', exts: ['dbk', 'docbook'], read: 'docbook', write: 'docbook5' },
  { id: 'ipynb', label: 'Jupyter notebook', ext: 'ipynb', exts: ['ipynb'], read: 'ipynb', write: 'ipynb' },
  { id: 'opml', label: 'OPML outline', ext: 'opml', exts: ['opml'], read: 'opml', write: 'opml' },
  { id: 'man', label: 'man page', ext: '1', exts: ['man', '1', '2', '3', '4', '5', '6', '7', '8'], read: 'man', write: 'man' },
  { id: 'plain', label: 'Plain text', ext: 'txt', exts: ['txt'], read: null, write: 'plain' },
]
export const formatByExt = (e) => FORMATS.find((f) => f.exts.includes(String(e).toLowerCase()))
export const formatById = (id) => FORMATS.find((f) => f.id === id)
export const readable = () => FORMATS.filter((f) => f.read || f.id === 'asciidoc')
export const writable = () => FORMATS.filter((f) => f.write)

let pandocP = null
/** Load pandoc once. onProgress(0..1, text) reports the download. */
export function loadPandoc(onProgress) {
  if (!pandocP) {
    pandocP = (async () => {
      onProgress?.(0.01, 'Loading the converter engine')
      const core = await import(CORE_URL)
      const res = await fetch(WASM_URL)
      if (!res.ok) throw fail('Could not download the converter engine. Check your connection and try again.')
      const total = Number(res.headers.get('content-length')) || 58580800
      const reader = res.body.getReader()
      const chunks = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value); got += value.length
        onProgress?.(Math.min(0.9, (got / total) * 0.9), `Downloading the converter engine (${Math.round(got / 1048576)} MB, first time only)`)
      }
      const wasm = new Uint8Array(got)
      let o = 0
      for (const c of chunks) { wasm.set(c, o); o += c.length }
      onProgress?.(0.92, 'Starting the converter engine')
      return core.createPandocInstance(wasm.buffer)
    })().catch((e) => { pandocP = null; throw e.message?.startsWith('Could not') ? e : Object.assign(new Error('Could not start the converter engine. Check your connection and try again.'), { cause: e }) })
  }
  return pandocP
}

async function asciidocToHtml(text) {
  await script(ASCIIDOCTOR_URL)
  const factory = window.Asciidoctor || window.Asciidoctor$$module$build$asciidoctor_browser || window.module$build$asciidoctor_browser?.default
  if (typeof factory !== 'function') throw fail('Could not start the AsciiDoc reader.')
  const ad = factory()
  return ad.convert(text, { safe: 'secure', standalone: false, attributes: { showtitle: true } })
}

/**
 * Convert text between two format ids. -> string
 * opts: {onProgress, standalone (HTML / LaTeX / DocBook complete documents), title}
 */
export async function convertMarkup(text, from, to, { onProgress, standalone = true, title = '' } = {}) {
  const f = formatById(from), t = formatById(to)
  if (!f || !t) throw fail('Pick a format to convert from and to.')
  if (!text.trim()) throw fail('There is nothing to convert: the input is empty.')
  if (from === to) return text
  const marked = await markedLib()
  // built-in fast paths (no engine download)
  if (from === 'markdown' && to === 'html') {
    const body = marked.parse(text)
    if (!standalone) return body
    const { wrapDoc } = await import('./_html.js')
    return wrapDoc(body, { title })
  }
  if (from === 'html' && to === 'markdown') {
    const { htmlToBlocks, astToMarkdown } = await import('./_ast.js')
    return astToMarkdown((await htmlToBlocks(text)).blocks, { images: 'none' }).text
  }
  if (from === 'ipynb' && (to === 'html' || to === 'markdown')) {
    const nbm = await import('./_ipynb.js')
    const nb = nbm.parseNotebook(text)
    return to === 'html' ? nbm.notebookToHtml(nb, { title }) : nbm.notebookToMarkdown(nb).text
  }
  let source = text, readFrom = f.read
  if (from === 'asciidoc') {
    const html = await asciidocToHtml(text)
    if (to === 'html') {
      if (!standalone) return html
      const { wrapDoc } = await import('./_html.js')
      return wrapDoc(html, { title })
    }
    source = html; readFrom = 'html-native_divs-native_spans'
  }
  if (!readFrom) throw fail(`Reading ${f.label} is not supported.`)
  const pandoc = await loadPandoc(onProgress)
  onProgress?.(0.95, 'Converting')
  const opts = { from: readFrom, to: t.write, wrap: 'none' }
  if (standalone && ['html', 'latex', 'docbook'].includes(to)) { opts.standalone = true; opts.metadata = { title: title || 'Document', pagetitle: title || 'Document' } }
  if (to === 'markdown') opts.to = from === 'asciidoc' || from === 'html' ? 'gfm-raw_html' : 'gfm'
  let r
  try { r = await pandoc.convert(opts, source, {}) } catch (e) { throw fail(`The ${f.label} input could not be converted: ${String(e?.message || e).slice(0, 200)}`, e) }
  const out = r.stdout ?? ''
  if (!out.trim() && /error/i.test(r.stderr || '')) throw fail(`The ${f.label} input could not be converted: ${(r.stderr || '').split('\n')[0].slice(0, 200)}`)
  return out
}
void esc
