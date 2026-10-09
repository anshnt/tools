// Markdown editor with live preview (params.output === 'html' focuses it on converting Markdown to HTML).
// marked renders GitHub-flavoured Markdown, highlight.js colours code blocks, and DOMPurify cleans the result before it is shown or exported.
import { editor, codeView, seg, toggle, button, h, icon, chip, aurora, focusOnDesktop, injectStyles, hljs, esc, copyBtn, spacer, loadOnce } from './_shared.js'
import { marked as loadMarked, dompurify as loadPurify } from '../../lib/libs.js'
import { load as loadStore, save as saveStore } from '../../lib/store.js'
import { download, debounce, toast, formatNumber, onCleanup, copyText } from '../../lib/ui.js'

const WELCOME = `# Welcome to the Markdown editor

Write on the left, see the result on the right. Everything stays in your browser and is **saved automatically** on this device.

## What works

- **Bold**, *italic*, ~~strikethrough~~ and \`inline code\`
- [Links](https://example.com) and images
- Lists, task lists and nested items
  - like this one

### A task list

- [x] Write some Markdown
- [x] Watch the preview update
- [ ] Export it as HTML or PDF

### A table

| Tool | Does what | Local |
| --- | --- | :---: |
| Editor | Writes Markdown | yes |
| Preview | Renders it live | yes |

### Code

\`\`\`js
// highlighted with highlight.js
const greet = (name) => \`Hello, \${name}!\`
console.log(greet('world'))
\`\`\`

> Tip: select text and press Ctrl+B for bold, Ctrl+I for italic, or Ctrl+K for a link.

---

Happy writing!
`

const DOC_CSS = `:root{color-scheme:light dark;--fg:#1f2430;--muted:#5b6478;--bg:#fff;--soft:#f4f5f9;--line:#e2e5ee;--accent:#4f46e5}
@media(prefers-color-scheme:dark){:root{--fg:#e6e8f0;--muted:#9aa3b8;--bg:#14151b;--soft:#1e2029;--line:#2b2e3b;--accent:#a5b4fc}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:46rem;margin:0 auto;padding:2.5rem 1.25rem 4rem}
h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .5em}h1{font-size:2rem;border-bottom:1px solid var(--line);padding-bottom:.3em}h2{font-size:1.5rem;border-bottom:1px solid var(--line);padding-bottom:.25em}
a{color:var(--accent)}img{max-width:100%}hr{border:0;border-top:1px solid var(--line);margin:2rem 0}
code{font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:.1em .35em}
pre{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:1rem;overflow:auto;line-height:1.55}pre code{background:none;border:0;padding:0}
blockquote{margin:1rem 0;padding:.4rem 1rem;border-left:4px solid var(--accent);background:var(--soft);color:var(--muted)}
table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:.45rem .8rem}th{background:var(--soft)}
.hljs-keyword,.hljs-selector-tag,.hljs-literal{color:#7c3aed}.hljs-string,.hljs-attr{color:#0b7f57}.hljs-number{color:#c2410c}.hljs-comment{color:#858596;font-style:italic}.hljs-title,.hljs-built_in{color:#0369a1}
@media print{body{background:#fff;color:#000}main{padding:0;max-width:none}pre,blockquote{break-inside:avoid}}`

let purifyReady = false
async function engines() {
  const [m, DOMPurify, hl] = await Promise.all([loadOnce('marked', loadMarked), loadOnce('DOMPurify', loadPurify), hljs().catch(() => null)])
  if (!purifyReady) {
    purifyReady = true
    DOMPurify.addHook('afterSanitizeAttributes', (node) => { if (node.tagName === 'A' && node.getAttribute('href')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer') } })
  }
  return { Marked: m.Marked, DOMPurify, hl }
}
const slug = (t) => t.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')

/** Markdown text to clean HTML. o: {breaks, sanitize}. Exported for tests. */
export async function renderMarkdown(text, o = {}) {
  const { Marked, DOMPurify, hl } = await engines()
  const md = new Marked({ gfm: true, breaks: !!o.breaks })
  md.use({ renderer: {
    code({ text: src, lang }) {
      const l = (lang || '').trim().split(/\s+/)[0]
      if (l && hl && hl.getLanguage(l)) return `<pre><code class="hljs language-${esc(l)}">${hl.highlight(src, { language: l, ignoreIllegals: true }).value}</code></pre>\n`
      return `<pre><code${l ? ` class="language-${esc(l)}"` : ''}>${esc(src)}\n</code></pre>\n`
    },
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens)
      const id = slug(inner)
      return `<h${depth}${id ? ` id="${esc(id)}"` : ''}>${inner}</h${depth}>\n`
    },
  } })
  const html = md.parse(text)
  return o.sanitize === false ? html : DOMPurify.sanitize(html, { ADD_ATTR: ['target'] })
}

/** A complete, standalone HTML page for the rendered body. */
export function pageHtml(body, title = 'Document') {
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>\n${DOC_CSS}\n</style>\n</head>\n<body>\n<main>\n${body.trim()}\n</main>\n</body>\n</html>\n`
}
const titleOf = (text) => (text.match(/^#\s+(.+)$/m)?.[1] || 'Document').replace(/[*_`[\]]/g, '').trim()

/** Edit helpers: wrap or prefix the textarea selection the way a rich editor would, keeping the browser's undo history. */
function replaceRange(ta, start, end, text, selStart, selEnd) {
  ta.focus()
  ta.setSelectionRange(start, end)
  let ok = false
  try { ok = document.execCommand('insertText', false, text) } catch { /* fall back below */ }
  if (!ok) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })) }
  ta.setSelectionRange(selStart, selEnd)
}
export function wrapSelection(ta, before, after = before, placeholder = 'text') {
  const { selectionStart: s, selectionEnd: e, value: v } = ta
  const sel = v.slice(s, e)
  if (sel && v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) { // already wrapped: unwrap
    replaceRange(ta, s - before.length, e + after.length, sel, s - before.length, s - before.length + sel.length)
    return
  }
  const inner = sel || placeholder
  replaceRange(ta, s, e, before + inner + after, s + before.length, s + before.length + inner.length)
}
export function prefixLines(ta, prefix, numbered = false) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta
  const a = v.lastIndexOf('\n', s - 1) + 1
  let z = v.indexOf('\n', e > s && v[e - 1] === '\n' ? e - 1 : e)
  if (z === -1) z = v.length
  const lines = v.slice(a, z).split('\n')
  const has = (l, i) => (numbered ? /^\d+\.\s/.test(l) : l.startsWith(prefix))
  const all = lines.every(has)
  const out = lines.map((l, i) => (all ? (numbered ? l.replace(/^\d+\.\s/, '') : l.slice(prefix.length)) : `${numbered ? `${i + 1}. ` : prefix}${l}`)).join('\n')
  replaceRange(ta, a, z, out, a, a + out.length)
}
function insertBlock(ta, text) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta
  const lead = s > 0 && v[s - 1] !== '\n' ? '\n\n' : s > 1 && v[s - 2] !== '\n' ? '\n' : ''
  const trail = v[e] === '\n' || e >= v.length ? '\n' : '\n\n'
  replaceRange(ta, s, e, lead + text + trail, s + lead.length, s + lead.length + text.length)
}

export function mount(root, { params }) {
  injectStyles()
  const htmlMode = params.output === 'html'
  const KEY = htmlMode ? 'md-to-html-doc' : 'md-editor-doc'
  const narrow = matchMedia('(max-width: 900px)').matches
  const state = { view: narrow ? 'write' : 'split', right: htmlMode ? 'html' : 'preview', breaks: false, sanitize: true, page: false }
  let html = '', seq = 0, token = 0

  const preview = h('div', { class: 'df-md', tabindex: 0, 'aria-label': 'Rendered preview', style: 'flex:1;min-width:0' })
  const src = codeView({ title: 'HTML source', ic: 'code', mime: 'text/html', filename: () => 'document.html', empty: ['code', 'The HTML appears here'] })
  src.el.hidden = true
  const stat = h('b', '')
  const saved = h('span', { class: 'df-fr' })

  const ed = editor({ title: 'Markdown', ic: 'file-pen', placeholder: 'Write Markdown here...', accept: '.md,.markdown,.mdx,.txt,text/markdown,text/plain', actions: ['upload', 'paste', 'clear'], autoIndent: true, indent: () => '  ', maxBytes: 5_000_000, onInput: () => { schedule(); persist() }, onRun: () => render() })
  const persist = debounce(() => { if (saveStore(KEY, ed.value)) { saved.textContent = 'Saved on this device'; setTimeout(() => { saved.textContent = '' }, 1800) } }, 600)
  const initial = loadStore(KEY, null)
  ed.set(typeof initial === 'string' ? initial : WELCOME)

  // formatting toolbar sits between the editor header and its text area
  const T = (label, ic, fn, key) => button('', { icon: ic, variant: 'ghost', size: 'sm', ariaLabel: key ? `${label} (${key})` : label, title: key ? `${label} (${key})` : label, onClick: () => { fn(); ed.focus() } })
  const ta = ed.ta
  const tools = h('div', { class: 'df-md-tools', role: 'toolbar', 'aria-label': 'Formatting' },
    T('Heading', 'heading', () => prefixLines(ta, '## ')), T('Bold', 'bold', () => wrapSelection(ta, '**'), 'Ctrl+B'), T('Italic', 'italic', () => wrapSelection(ta, '*'), 'Ctrl+I'), T('Strikethrough', 'strikethrough', () => wrapSelection(ta, '~~')),
    h('span', { class: 'sep' }), T('Link', 'link', link, 'Ctrl+K'), T('Inline code', 'code', () => wrapSelection(ta, '`', '`', 'code')), T('Code block', 'square-code', () => insertBlock(ta, '```js\ncode\n```')),
    h('span', { class: 'sep' }), T('Quote', 'quote', () => prefixLines(ta, '> ')), T('Bulleted list', 'list', () => prefixLines(ta, '- ')), T('Numbered list', 'list-ordered', () => prefixLines(ta, '', true)), T('Task list', 'list-checks', () => prefixLines(ta, '- [ ] ')),
    h('span', { class: 'sep' }), T('Table', 'table', () => insertBlock(ta, '| Column | Column |\n| --- | --- |\n| Cell | Cell |')), T('Horizontal rule', 'minus', () => insertBlock(ta, '---')))
  ed.el.insertBefore(tools, ed.el.querySelector('.df-body'))
  function link() {
    const { selectionStart: s, selectionEnd: e, value: v } = ta
    const sel = v.slice(s, e) || 'link text'
    replaceRange(ta, s, e, `[${sel}](https://)`, s + sel.length + 3, s + sel.length + 11)
  }
  ta.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); wrapSelection(ta, '**') } else if (k === 'i') { e.preventDefault(); wrapSelection(ta, '*') } else if (k === 'k') { e.preventDefault(); link() }
  })

  // ---------- render ----------
  const delay = () => (ed.value.length > 200_000 ? 500 : 120)
  const schedule = () => { clearTimeout(schedule.t); schedule.t = setTimeout(render, delay()) }
  async function render() {
    clearTimeout(schedule.t)
    const my = ++seq
    const text = ed.value
    try {
      html = await renderMarkdown(text, { breaks: state.breaks, sanitize: state.sanitize })
    } catch (e) {
      if (my === seq) toast(e.message || 'Could not render the Markdown.', 'error')
      return
    }
    if (my !== seq) return
    preview.innerHTML = html || '<p style="color:var(--muted)">The preview appears here as you type.</p>'
    for (const a of preview.querySelectorAll('a[href^="#"]')) { a.removeAttribute('target'); a.addEventListener('click', (ev) => { ev.preventDefault(); preview.querySelector(`[id="${CSS.escape(a.getAttribute('href').slice(1))}"]`)?.scrollIntoView({ block: 'start' }) }) }
    const words = (text.match(/\S+/g) || []).length
    stat.textContent = text.trim() ? `${formatNumber(words, 0)} words · ${formatNumber(text.length, 0)} characters · ${Math.max(1, Math.round(words / 220))} min read` : 'empty'
    updateSource()
  }
  const fullHtml = () => (state.page ? pageHtml(html, titleOf(ed.value)) : html)
  function updateSource() { if (state.right === 'html') src.set(fullHtml(), 'html') }

  // ---------- panes ----------
  const rightSeg = seg([['preview', 'Preview'], ['html', 'HTML']], state.right, (v) => { state.right = v; applyView(); updateSource() }, 'Right pane')
  const previewFrame = h('section', { class: 'df-frame', 'aria-label': 'Preview' },
    h('div', { class: 'df-head' }, h('div', { class: 'df-title' }, icon('eye'), h('span', 'Result'), rightSeg), h('div', { class: 'df-actions' },
      copyBtn(() => fullHtml(), 'Copy HTML', { ariaLabel: 'Copy the HTML' }),
      button('Print / PDF', { icon: 'printer', variant: 'ghost', size: 'sm', ariaLabel: 'Print or save as PDF', onClick: printDoc }))),
    h('div', { class: 'df-body' }, preview), h('div', { class: 'df-foot' }, stat))
  // the HTML source view reuses a code view; it replaces the preview body
  previewFrame.insertBefore(src.el, previewFrame.querySelector('.df-foot'))
  src.el.querySelector('.df-head').remove()
  src.el.style.cssText = 'border:0;border-radius:0;box-shadow:none;background:transparent'
  const grid = h('div', { class: 'df-grid', style: '--df-h: clamp(380px, 64vh, 780px)' }, ed.el, previewFrame)
  function applyView() {
    const v = state.view
    ed.el.hidden = v === 'preview'
    previewFrame.hidden = v === 'write'
    grid.style.gridTemplateColumns = v === 'split' ? '' : 'minmax(0, 1fr)'
    previewFrame.querySelector('.df-body').hidden = state.right === 'html'
    src.el.hidden = state.right !== 'html'
    src.el.querySelector('.df-foot').style.display = 'none'
  }

  // print: a hidden iframe with the standalone page, so only the document prints
  function printDoc() {
    const frame = h('iframe', { title: 'Print preview', style: 'position:fixed;width:0;height:0;border:0;right:0;bottom:0', srcdoc: pageHtml(html, titleOf(ed.value)) })
    frame.addEventListener('load', () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print() } catch { toast('Printing was blocked by the browser.', 'error') }
      setTimeout(() => frame.remove(), 60_000)
    })
    document.body.append(frame)
    toast('In the print dialog, choose "Save as PDF" as the destination.', 'info')
  }
  onCleanup(() => document.querySelectorAll('iframe[title="Print preview"]').forEach((f) => f.remove()))

  const viewSeg = seg([['split', 'Split'], ['write', 'Write'], ['preview', 'Preview']], state.view, (v) => { state.view = v; applyView() }, 'Layout')
  const bar = h('div', { class: ['df-bar', 'df-sticky'] },
    h('div', { class: 'df-opt' }, h('span', { class: 'df-ol' }, 'View'), viewSeg),
    toggle('Line breaks', false, (v) => { state.breaks = v; render() }),
    toggle('Clean HTML', true, (v) => { state.sanitize = v; render() }),
    ...(htmlMode ? [toggle('Full page', false, (v) => { state.page = v; updateSource() })] : []),
    spacer(), saved,
    button('Download .md', { icon: 'download', size: 'sm', variant: 'secondary', onClick: () => download(ed.value, `${slug(titleOf(ed.value)) || 'document'}.md`, 'text/markdown') }),
    button('Download .html', { icon: 'file-down', size: 'sm', variant: htmlMode ? 'primary' : 'secondary', onClick: () => download(pageHtml(html, titleOf(ed.value)), `${slug(titleOf(ed.value)) || 'document'}.html`, 'text/html') }))

  // keep the preview roughly in step with the cursor area
  ta.addEventListener('scroll', () => { if (state.view !== 'split' || state.right !== 'preview') return; const r = ta.scrollTop / Math.max(1, ta.scrollHeight - ta.clientHeight); preview.scrollTop = r * (preview.scrollHeight - preview.clientHeight) })

  root.append(h('div', { class: 't-df' }, aurora(), bar, grid))
  applyView()
  render()
  focusOnDesktop(ed)
}
