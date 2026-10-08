// Word to Markdown: .docx -> HTML (mammoth) -> Markdown (turndown) with GFM tables, footnotes and optional images in a ZIP.
import { h, dropzone, button, alert, empty, segmented, toggle, field, textarea, stats, progress, copyButton, download, formatBytes, formatNumber, clear, toast, onCleanup } from '../../lib/ui.js'
import { mammoth as loadMammoth, turndown as loadTurndown, marked as loadMarked, dompurify as loadPurify } from '../../lib/libs.js'
import { withExt, baseName, zip, base64ToBytes } from '../../lib/files.js'
import { toolRoot, kicker, note, celebrate, addStyle } from './_shared.js'

const STYLE_MAP = [
  "p[style-name='Title'] => h1.doc-title:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Code'] => pre:separator('\\n')",
  "p[style-name='Source Code'] => pre:separator('\\n')",
  "p[style-name='HTML Preformatted'] => pre:separator('\\n')",
  "r[style-name='Code Char'] => code",
  "r[style-name='HTML Code'] => code",
  'strike => del',
]

/** Build a configured TurndownService. Cells are converted with a second service so tables can nest inline Markdown. */
export function makeService(Turndown, { bullet = '-' } = {}) {
  const base = () => {
    const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: bullet, emDelimiter: '*', strongDelimiter: '**', hr: '---', linkStyle: 'inlined' })
    td.addRule('strikethrough', { filter: ['del', 's', 'strike'], replacement: (c) => `~~${c}~~` })
    td.keep(['sub', 'sup'])
    // one space after the marker and two-or-three space continuation indents, like most Markdown editors write it
    td.addRule('listItem', {
      filter: 'li',
      replacement(content, node, options) {
        content = content.replace(/^\n+/, '').replace(/\n+$/, '\n')
        let prefix = `${options.bulletListMarker} `
        const parent = node.parentNode
        if (parent.nodeName === 'OL') {
          const start = parent.getAttribute('start')
          prefix = `${(start ? Number(start) : 1) + [...parent.children].indexOf(node)}. `
        }
        content = content.replace(/\n/gm, `\n${' '.repeat(prefix.length)}`)
        return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '')
      },
    })
    return td
  }
  const cellService = base()
  const td = base()
  const cellText = (c) => cellService.turndown(c.innerHTML).trim().replace(/\n{2,}/g, '<br>').replace(/\n/g, '<br>').replace(/\|/g, '\\|')
  td.addRule('gfmTable', {
    filter: 'table',
    replacement(_content, node) {
      const rows = [...node.querySelectorAll('tr')].filter((tr) => tr.closest('table') === node)
      if (!rows.length) return ''
      const grid = rows.map((tr) => {
        const cells = []
        for (const c of tr.children) {
          cells.push(cellText(c))
          for (let i = 1; i < (Number(c.getAttribute('colspan')) || 1); i++) cells.push('')
        }
        return cells
      })
      const cols = Math.max(...grid.map((r) => r.length))
      const line = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ')} |`
      return `\n\n${[line(grid[0]), line(Array(cols).fill('---')), ...grid.slice(1).map(line)].join('\n')}\n\n`
    },
  })
  return td
}

/** HTML string or DOM -> Markdown. Also converts mammoth footnotes into [^n] references. */
export function htmlToMarkdown(Turndown, html, opts = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const defs = []
  // A Title paragraph is the document H1, so real Heading 1..5 move down one level instead of competing with it.
  if (doc.querySelector('h1.doc-title') && doc.querySelector('h1:not(.doc-title), h2, h3, h4, h5')) {
    for (const hd of [...doc.querySelectorAll('h1:not(.doc-title), h2, h3, h4, h5')].reverse()) {
      const n = doc.createElement(`h${Math.min(6, Number(hd.tagName[1]) + 1)}`)
      n.innerHTML = hd.innerHTML
      hd.replaceWith(n)
    }
  }
  for (const sup of [...doc.querySelectorAll('sup')]) {
    const a = sup.querySelector('a[id^="footnote-ref-"]')
    if (a) sup.replaceWith(`[^${a.id.replace('footnote-ref-', '')}]`)
  }
  for (const li of [...doc.querySelectorAll('li[id^="footnote-"]')]) {
    const n = li.id.replace('footnote-', '')
    li.querySelectorAll('a[href^="#footnote-ref-"]').forEach((a) => a.remove())
    defs.push(`[^${n}]: ${li.textContent.replace(/\s+/g, ' ').trim()}`)
    const list = li.parentElement
    li.remove()
    if (list && !list.children.length) list.remove()
  }
  let md = makeService(Turndown, opts).turndown(doc.body).replace(/\n{3,}/g, '\n\n').replace(/^(#{1,6} \d+)\\\./gm, '$1.').trim()
  if (defs.length) md += `\n\n${defs.join('\n')}`
  return md + '\n'
}

const CSS = `
.tw-w2md .tw-md { font-family: var(--mono); font-size: 13px; line-height: 1.6; }
.tw-w2md .tw-pv { padding: 16px 18px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); max-height: 520px; overflow: auto; font-size: 14.5px; line-height: 1.65; }
.tw-w2md .tw-pv img { max-width: 100%; height: auto; border-radius: 8px; }
.tw-w2md .tw-pv blockquote { margin: 0 0 .8em; padding: 2px 14px; border-left: 3px solid var(--accent); color: var(--muted); }
.tw-w2md .tw-pv code { font-family: var(--mono); font-size: .9em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
.tw-w2md .tw-pv h1 { font-size: 1.7em; } .tw-w2md .tw-pv h2 { font-size: 1.35em; } .tw-w2md .tw-pv h3 { font-size: 1.12em; }
`

export function mount(root) {
  addStyle('tw-w2md-css', CSS)
  const st = { file: null, buf: null, md: '', images: [], counts: null, imageMode: 'zip', bullet: '-' }
  const urls = []
  onCleanup(() => urls.forEach((u) => URL.revokeObjectURL(u)))
  const prog = progress('Converting')
  const out = h('div')
  const imgSeg = segmented([['zip', 'Images in a ZIP folder'], ['embed', 'Embed in Markdown'], ['skip', 'Skip images']], st.imageMode, (v) => { st.imageMode = v; run() }, 'Images')
  const bulletSeg = segmented([['-', 'Dash  -'], ['*', 'Star  *']], st.bullet, (v) => { st.bullet = v; run() }, 'Bullet style')
  const options = h('section', { class: 'tw-stage', hidden: true }, h('div', { class: 'row' }, field('Images', imgSeg), field('Bullets', bulletSeg)))
  const zone = dropzone({ accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Drop a Word file here or click to browse', hint: '.docx · tables, lists, headings and links are kept', onFiles: ([f]) => load(f) })

  async function load(file) {
    st.file = file
    st.buf = await file.arrayBuffer()
    await run(true)
  }

  async function run(first) {
    if (!st.buf) return
    prog.set(null, 'Converting')
    try {
      const [mammoth, Turndown] = await Promise.all([loadMammoth(), loadTurndown()])
      const images = []
      const mode = st.imageMode
      const convertImage = mammoth.images.imgElement(async (img) => {
        const b64 = await img.read('base64')
        if (mode === 'skip') return { src: '' }
        if (mode === 'embed') return { src: `data:${img.contentType};base64,${b64}` }
        const n = images.length + 1
        const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/bmp': 'bmp' })[img.contentType] || 'png'
        images.push({ name: `images/image-${n}.${ext}`, data: base64ToBytes(b64), type: img.contentType })
        return { src: `images/image-${n}.${ext}` }
      })
      const res = await mammoth.convertToHtml({ arrayBuffer: st.buf }, { styleMap: STYLE_MAP, convertImage })
      const doc = new DOMParser().parseFromString(res.value, 'text/html')
      let imgN = 0
      doc.querySelectorAll('img').forEach((im) => { imgN++; if (!im.getAttribute('src')) im.remove(); else if (!im.alt) im.alt = `image ${imgN}` })
      st.md = htmlToMarkdown(Turndown, doc.body.innerHTML, { bullet: st.bullet })
      st.images = images
      st.warnings = res.messages.length
      st.counts = {
        headings: doc.querySelectorAll('h1,h2,h3,h4,h5,h6').length, lists: doc.querySelectorAll('ul,ol').length,
        tables: doc.querySelectorAll('table').length, images: imgN, links: doc.querySelectorAll('a[href]:not([href^="#"])').length,
      }
      st.error = null
    } catch (e) {
      st.error = /zip|central directory|end of/i.test(e.message || '') ? 'This does not look like a .docx file. Old .doc files must be re-saved as .docx in Word first.' : e.message
    } finally {
      prog.hide()
    }
    await render(first)
  }

  async function preview() {
    const [{ marked }, purify] = await Promise.all([loadMarked(), loadPurify()])
    let html = purify.sanitize(marked.parse(st.md), { ADD_ATTR: ['target'] })
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u))
    for (const im of st.images) {
      const u = URL.createObjectURL(new Blob([im.data], { type: im.type }))
      urls.push(u)
      html = html.split(`src="${im.name}"`).join(`src="${u}"`)
    }
    return html
  }

  async function render(first) {
    options.hidden = !st.buf
    zone.classList.toggle('compact', !!st.buf)
    if (st.error) { clear(out, alert('error', h('strong', st.file?.name || 'File'), h('div', st.error))); return }
    const html = await preview()
    const asZip = st.images.length > 0
    const md = st.md
    const box = textarea({ readonly: true, rows: 18, value: md, mono: true, class: 'tw-md', 'aria-label': 'Markdown output' })
    const pv = h('div', { class: ['tw-pv', 'prose'], html })
    pv.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer' })
    const dl = button(asZip ? 'Download .zip' : 'Download .md', { icon: 'download', variant: 'primary', size: 'sm', onClick: async () => {
      if (asZip) download(await zip([{ name: withExt(st.file.name, 'md'), data: md }, ...st.images.map((i) => ({ name: i.name, data: i.data }))]), `${baseName(st.file.name)}-markdown.zip`)
      else download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), withExt(st.file.name, 'md'))
    } })
    const c = st.counts
    const host = h('div', { class: 'tw-result-in stack', style: 'position:relative' },
      stats([{ label: 'Headings', value: formatNumber(c.headings, 0), accent: true }, { label: 'Lists', value: formatNumber(c.lists, 0) }, { label: 'Tables', value: formatNumber(c.tables, 0) },
        { label: 'Images', value: formatNumber(c.images, 0), hint: st.imageMode === 'skip' ? 'skipped' : '' }, { label: 'Links', value: formatNumber(c.links, 0) }, { label: 'Markdown size', value: formatBytes(new Blob([md]).size) }]),
      h('div', { class: ['tool-split'] },
        h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, h('div', { class: 'tw-head' }, kicker('Markdown', 'file-code-2'), h('div', { class: 'row' }, copyButton(() => md, 'Copy'), dl)), box)),
        h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Preview', 'eye'), pv))),
      asZip ? note(`${st.images.length} image${st.images.length > 1 ? 's' : ''} saved in an images/ folder inside the ZIP, linked from the Markdown.`, 'images') : null,
      st.warnings ? note(`${st.warnings} formatting detail(s) in the document were simplified.`, 'triangle-alert') : null)
    clear(out, host)
    if (first) celebrate(host)
  }

  clear(out, empty('Your Markdown and a live preview will appear here.', 'file-code-2'))
  root.append(toolRoot('w2md', zone, prog.el, options, out, note('Conversion runs in your browser, nothing is uploaded. Headings, bold, italic, links, lists, tables, footnotes and images are converted; page layout is not.', 'shield-check')))
}
