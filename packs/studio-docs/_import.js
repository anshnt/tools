// Open files: DOCX (mammoth), Markdown (marked), HTML, plain text and this app's own project files.
import { mammoth, marked, jszip } from '../../lib/libs.js'
import { ext, baseName } from '../../lib/files.js'
import { htmlToDoc, jsonToDoc, schema } from './_schema.js'
import { PAPERS, TWIPS_PER_MM } from './_page.js'

export const OPEN_ACCEPT = '.docx,.md,.markdown,.html,.htm,.txt,.json,.docs.json'
const MAX_BYTES = 40 * 1024 * 1024
// Private-use characters carry paragraph and run formatting from mammoth's document model into its HTML output.
const MA = '', MB = '', MC = '', PA = '', PB = ''
const HIGHLIGHT = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080',
  darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000',
}
const STYLE_MAP = [
  "p[style-name='Title'] => p.dc-title:fresh",
  "p[style-name='Subtitle'] => p.dc-subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "u => u",
  "br[type='page'] => hr.dc-pb",
]

/** -> {title, doc, settings, notes}. Throws an Error with a plain-words message for unsupported files. */
export async function importFile(file) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 40 MB. Open a smaller file.`)
  const type = ext(file.name)
  const title = baseName(file.name).replace(/\.docs$/, '') || 'Untitled document'
  if (type === 'docx') return fromDocx(file, title)
  if (type === 'doc' || type === 'rtf' || type === 'odt' || type === 'pages') {
    throw new Error(`.${type} files are not supported. Save the file as .docx from your word processor and open that.`)
  }
  const text = await file.text()
  if (type === 'json') return fromProject(text, title)
  if (type === 'md' || type === 'markdown') return { title, doc: await markdownToDoc(text), settings: null, notes: [] }
  if (type === 'html' || type === 'htm') return fromHtmlFile(text, title)
  if (type === 'txt' || type === '') return { title, doc: textToDoc(text), settings: null, notes: [] }
  throw new Error(`Cannot open .${type} files. Use .docx, .md, .html or .txt.`)
}

// ---------- DOCX ----------
async function fromDocx(file, title) {
  const mm = await mammoth()
  const original = await file.arrayBuffer()
  const { buffer: arrayBuffer, colors } = await withColorStyles(original)
  const paragraphs = mm.transforms.paragraph((p) => {
    if (!p.children.length || p.numbering) return p
    const meta = []
    const a = { center: 'center', right: 'right', end: 'right', both: 'justify', justify: 'justify' }[p.alignment]
    if (a) meta.push(`a=${a}`)
    const start = parseInt(p.indent?.start, 10) || 0
    if (start >= 360) meta.push(`i=${Math.min(8, Math.round(start / 720))}`)
    if (!meta.length) return p
    return { ...p, children: [{ type: 'text', value: `${PA}${meta.join(';')}${PB}` }, ...p.children] }
  })
  const runs = mm.transforms.run((r) => {
    const meta = []
    if (r.fontSize) meta.push(`s=${r.fontSize}`)
    if (r.font) meta.push(`f=${encodeURIComponent(r.font)}`)
    if (r.highlight) meta.push(`h=${r.highlight}`)
    if (!meta.length) return r
    return { ...r, children: r.children.map((c) => (c.type === 'text' ? { ...c, value: `${MA}${meta.join(';')}${MB}${c.value}${MC}` } : c)) }
  })
  const styleMap = [...STYLE_MAP, ...colors.map((c) => `r[style-name='dcc${c}'] => span.dcc${c}`)]
  const res = await mm.convertToHtml({ arrayBuffer }, { styleMap, transformDocument: (d) => runs(paragraphs(d)) })
  const body = new window.DOMParser().parseFromString(res.value, 'text/html').body
  applyMarkers(body)
  const doc = htmlToDoc(body.innerHTML)
  const notes = []
  const warnings = res.messages.filter((m) => m.type === 'warning' && !/Unrecognised (paragraph|run) style/i.test(m.message))
  if (warnings.length) notes.push(`Word features that could not be converted were skipped (${warnings.length}). Text, headings, lists, tables and images were kept.`)
  return { title, doc, settings: await docxPageSettings(original), notes }
}

/**
 * mammoth does not read run colours. Before conversion, tag every coloured run with a synthetic character style
 * (dccRRGGBB) that the style map turns into a span, which applyMarkers turns back into a colour.
 */
async function withColorStyles(buffer) {
  try {
    const JSZip = await jszip()
    const zip = await JSZip.loadAsync(buffer)
    const docFile = zip.file('word/document.xml')
    const stylesFile = zip.file('word/styles.xml')
    if (!docFile || !stylesFile) return { buffer, colors: [] }
    const colors = new Set()
    const xml = (await docFile.async('string')).replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (m, inner) => {
      if (/<w:rStyle\b/.test(inner)) return m
      const c = inner.match(/<w:color\b[^>]*\bw:val="([0-9A-Fa-f]{6})"/)
      const hex = c?.[1].toUpperCase()
      if (!hex || hex === '000000') return m
      colors.add(hex)
      return `<w:rPr><w:rStyle w:val="dcc${hex}"/>${inner}</w:rPr>`
    })
    if (!colors.size) return { buffer, colors: [] }
    const defs = [...colors].map((c) => `<w:style w:type="character" w:styleId="dcc${c}"><w:name w:val="dcc${c}"/></w:style>`).join('')
    zip.file('word/document.xml', xml)
    zip.file('word/styles.xml', (await stylesFile.async('string')).replace('</w:styles>', `${defs}</w:styles>`))
    return { buffer: await zip.generateAsync({ type: 'arraybuffer' }), colors: [...colors] }
  } catch {
    return { buffer, colors: [] }
  }
}

function applyMarkers(body) {
  // the HTML parser splits <p><hr></p> into an empty paragraph, the break and another empty paragraph: drop the empty ones
  for (const br of body.querySelectorAll('hr.dc-pb')) {
    for (const sib of [br.previousElementSibling, br.nextElementSibling]) if (sib?.tagName === 'P' && !sib.firstChild) sib.remove()
  }
  for (const span of body.querySelectorAll('span[class^="dcc"]')) {
    span.style.color = `#${span.className.slice(3, 9)}`
    span.removeAttribute('class')
  }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  const texts = []
  while (walker.nextNode()) texts.push(walker.currentNode)
  const para = new RegExp(`${PA}([^${PB}]*)${PB}`)
  const run = new RegExp(`${MA}([^${MB}]*)${MB}([\\s\\S]*?)${MC}`, 'g')
  for (const t of texts) {
    let v = t.nodeValue
    if (!v.includes(MA) && !v.includes(PA)) continue
    v = v.replace(para, (_, meta) => {
      const host = t.parentElement?.closest('p,h1,h2,h3,h4,h5,h6')
      if (host) {
        const css = []
        for (const kv of meta.split(';')) {
          const [k, val] = kv.split('=')
          if (k === 'a') css.push(`text-align:${val}`)
          if (k === 'i') css.push(`margin-left:${+val * 36}pt`)
        }
        host.setAttribute('style', css.join(';'))
      }
      return ''
    })
    if (!v.includes(MA)) { t.nodeValue = v; continue }
    const frag = document.createDocumentFragment()
    let last = 0
    for (const m of v.matchAll(run)) {
      if (m.index > last) frag.append(v.slice(last, m.index))
      const css = []
      for (const kv of m[1].split(';')) {
        const [k, val] = kv.split('=')
        if (k === 's') css.push(`font-size:${val}pt`)
        if (k === 'f') css.push(`font-family:'${decodeURIComponent(val).replace(/['"]/g, '')}'`)
        if (k === 'h' && HIGHLIGHT[val]) css.push(`background-color:${HIGHLIGHT[val]}`)
      }
      const span = document.createElement('span')
      span.setAttribute('style', css.join(';'))
      span.textContent = m[2]
      frag.append(span)
      last = m.index + m[0].length
    }
    if (last < v.length) frag.append(v.slice(last))
    t.replaceWith(frag)
  }
}

/** Paper size, orientation and margins from the last section of word/document.xml. Null when they cannot be read. */
async function docxPageSettings(arrayBuffer) {
  try {
    const JSZip = await jszip()
    const zip = await JSZip.loadAsync(arrayBuffer)
    const xml = await zip.file('word/document.xml').async('string')
    const part = xml.slice(xml.lastIndexOf('<w:sectPr'))
    const attr = (tag, name) => { const m = tag?.match(new RegExp(`w:${name}="(-?\\d+)"`)); return m ? Number(m[1]) : NaN }
    const sz = part.match(/<w:pgSz\b[^>]*>/)?.[0]
    const mar = part.match(/<w:pgMar\b[^>]*>/)?.[0]
    const out = {}
    const w = attr(sz, 'w'), h = attr(sz, 'h')
    if (w > 0 && h > 0) {
      const wm = w / TWIPS_PER_MM, hm = h / TWIPS_PER_MM
      const [short, long] = wm < hm ? [wm, hm] : [hm, wm]
      const hit = Object.entries(PAPERS).find(([, p]) => Math.abs(p.w - short) < 3 && Math.abs(p.h - long) < 3)
      if (hit) out.paper = hit[0]
      out.orient = w > h ? 'landscape' : 'portrait'
    }
    const margins = {}
    for (const k of ['top', 'right', 'bottom', 'left']) {
      const v = attr(mar, k)
      if (v >= 0) margins[k] = Math.round((v / TWIPS_PER_MM) * 10) / 10
    }
    if (Object.keys(margins).length === 4) out.margins = margins
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

// ---------- Markdown, HTML, text, project ----------
export async function markdownToDoc(md) {
  const { marked: mk } = await marked()
  const html = mk.parse(md, { async: false, gfm: true, breaks: false })
  return htmlToDoc(tasksFromCheckboxes(html))
}

/** GFM task lists arrive as <li><input type=checkbox> text</li>: turn them into the editor's task items. */
function tasksFromCheckboxes(html) {
  const body = new window.DOMParser().parseFromString(html, 'text/html').body
  for (const box of body.querySelectorAll('li input[type="checkbox"]')) {
    const li = box.closest('li')
    li.setAttribute('data-task', '')
    li.setAttribute('data-checked', String(box.hasAttribute('checked')))
    li.parentElement?.setAttribute('data-task', '')
    box.remove()
  }
  return body.innerHTML
}

function fromHtmlFile(text, title) {
  const dom = new window.DOMParser().parseFromString(text, 'text/html')
  let removed = 0
  for (const img of dom.body.querySelectorAll('img')) {
    if (!/^data:image\//i.test(img.getAttribute('src') || '')) { img.remove(); removed++ } // never fetch remote images while opening a file
  }
  const notes = removed ? [`${removed} linked image${removed > 1 ? 's were' : ' was'} not loaded (only embedded images are kept).`] : []
  const t = dom.title?.trim()
  return { title: t || title, doc: htmlToDoc(tasksFromCheckboxes(dom.body.innerHTML)), settings: null, notes }
}

export function textToDoc(text) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const paras = blocks.map((b) => b.replace(/\n+$/, '')).filter((b) => b.length).map((b) => {
    const kids = []
    b.split('\n').forEach((line, i) => {
      if (i) kids.push(schema.nodes.hard_break.create())
      if (line) kids.push(schema.text(line))
    })
    return schema.nodes.paragraph.create(null, kids)
  })
  return schema.nodes.doc.create(null, paras.length ? paras : [schema.nodes.paragraph.create()])
}

function fromProject(text, title) {
  let data
  try { data = JSON.parse(text) } catch { throw new Error('That file is not valid JSON.') }
  if (data?.format !== 'docs-studio' || !data.doc) throw new Error('That JSON file is not a Docs project file.')
  return { title: data.title || title, doc: jsonToDoc(data.doc), settings: data.settings || null, notes: [] }
}
