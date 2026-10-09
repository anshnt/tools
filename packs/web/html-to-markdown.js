// HTML to Markdown with GitHub-flavored tables, task lists and strikethrough (turndown). Runs locally.
import { h, button, field, select, toggle, alert, clear, copyButton, download, debounce, split, tabs, dropzone, toast } from '../../lib/ui.js'
import { turndown, marked, dompurify } from '../../lib/libs.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, note, pill } from './_shared.js'

const GFM_URL = 'https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/+esm'
let gfmPlugin
const loadGfm = () => (gfmPlugin ??= import(GFM_URL).then((m) => m.default && m.default.gfm ? m.default : m).catch((e) => { gfmPlugin = null; throw e }))

const OPTS = { heading: 'atx', bullet: '-', code: 'fenced', link: 'inlined', gfm: true, main: false, images: true, strip: true }
const EXAMPLE = `<article>
<h1>Weekly roundup</h1>
<p>Here is what shipped this week, with <strong>bold</strong> claims, <em>soft</em> edges and a <a href="https://example.com/changelog" title="Full changelog">changelog link</a>.</p>
<h2>Highlights</h2>
<ul><li>Faster search</li><li>Dark mode <del>beta</del> done<ul><li>Follows your system</li></ul></li></ul>
<ol><li>Update the app</li><li>Open settings</li></ol>
<table><thead><tr><th>Plan</th><th align="right">Price</th></tr></thead><tbody><tr><td>Free</td><td align="right">$0</td></tr><tr><td>Pro</td><td align="right">$12</td></tr></tbody></table>
<blockquote><p>Ship small, ship often.</p></blockquote>
<pre><code class="language-js">const sum = (a, b) => a + b</code></pre>
<p><img src="https://example.com/logo.png" alt="Logo"> Inline <code>code</code> works too.</p>
</article>`

/** Convert HTML to Markdown. Exported so it can be tested; needs the browser (DOMParser). */
export async function convert(html, o = {}) {
  const opts = { ...OPTS, ...o }
  const Turndown = await turndown()
  const td = new Turndown({ headingStyle: opts.heading, bulletListMarker: opts.bullet, codeBlockStyle: opts.code, fence: '```', emDelimiter: '*', strongDelimiter: '**', linkStyle: opts.link, linkReferenceStyle: 'full' })
  if (opts.gfm) {
    const g = await loadGfm()
    td.use(g.gfm || g)
  }
  td.addRule('listItem', { filter: 'li', replacement(content, node, options) {
    const text = content.replace(/^\n+/, '').replace(/\n+$/, '\n')
    const parent = node.parentNode
    let prefix = options.bulletListMarker + ' '
    if (parent.nodeName === 'OL') {
      const start = parent.getAttribute('start')
      prefix = `${(start ? Number(start) : 1) + Array.prototype.indexOf.call(parent.children, node)}. `
    }
    return prefix + text.replace(/\n/gm, '\n' + ' '.repeat(prefix.length)) + (node.nextSibling && !/\n$/.test(text) ? '\n' : '')
  } })
  if (opts.gfm) td.addRule('strike', { filter: ['del', 's', 'strike'], replacement: (c) => `~~${c}~~` })
  if (opts.strip) td.remove(['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas'])
  if (!opts.images) td.addRule('noimg', { filter: 'img', replacement: () => '' })
  let source = html
  if (opts.main) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const el = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role=main]')
    if (el) source = el.outerHTML
  }
  return td.turndown(source).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

const CSS = `
.t-h2m .pane { display: grid; gap: 10px; align-content: start; }
.t-h2m textarea { min-height: 360px; font-family: var(--mono); font-size: 13.5px; line-height: 1.55; }
.t-h2m .md-preview { padding: 16px 18px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); min-height: 360px; max-height: 560px; overflow: auto; }
.t-h2m .md-preview table { border-collapse: collapse; margin: 10px 0; } .t-h2m .md-preview th, .t-h2m .md-preview td { border: 1px solid var(--border); padding: 6px 10px; }
.t-h2m .md-preview pre { background: var(--surface-2); padding: 12px; border-radius: 10px; overflow: auto; } .t-h2m .md-preview img { max-width: 100%; }
.t-h2m .md-preview blockquote { margin: 10px 0; padding-left: 14px; border-left: 3px solid var(--border-strong); color: var(--text-2); }
.t-h2m .opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; }
`

export function mount(root) {
  ensureStyle()
  if (!document.getElementById('t-h2m-style')) document.head.append(h('style', { id: 't-h2m-style' }, CSS))
  const o = { ...OPTS, ...load('html2md:opts', {}) }
  let token = 0
  let md = ''
  const src = h('textarea', { class: 'textarea', 'aria-label': 'HTML', placeholder: 'Paste HTML here, drop a .html file, or use "Paste from clipboard" to convert copied web content.', spellcheck: false })
  const out = h('textarea', { class: 'textarea', readonly: true, 'aria-label': 'Markdown output', placeholder: 'Markdown appears here as you type.' })
  const previewEl = h('div', { class: 'md-preview prose' })
  const statusEl = h('div')
  const statsEl = h('div', { class: 'row small muted' })
  const outTabs = tabs([{ id: 'md', label: 'Markdown', render: () => out }, { id: 'preview', label: 'Preview', render: () => previewEl }], 'md', (id) => { if (id === 'preview') renderPreview() })

  async function run() {
    const my = ++token
    clear(statusEl)
    const html = src.value
    if (!html.trim()) { md = ''; out.value = ''; clear(statsEl); clear(previewEl); return }
    try {
      const result = await convert(html, o)
      if (my !== token) return
      md = result
      out.value = md
      const words = (md.match(/\S+/g) || []).length
      clear(statsEl, pill(`${md.length.toLocaleString()} characters`), pill(`${md.split('\n').length - 1} lines`), pill(`${words.toLocaleString()} words`))
      if (outTabs.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Preview') renderPreview()
    } catch (e) {
      if (my !== token) return
      statusEl.append(alert('error', e.message || 'Could not convert that HTML.'))
    }
  }
  const soon = debounce(run, 180)
  src.addEventListener('input', soon)

  async function renderPreview() {
    if (!md) return clear(previewEl, h('div', { class: 'muted' }, 'Nothing to preview yet.'))
    try {
      const [{ marked: mk, Marked }, purify] = await Promise.all([marked(), dompurify()])
      const html = (mk || new Marked()).parse(md, { gfm: true })
      previewEl.innerHTML = purify.sanitize(html)
      previewEl.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer' })
    } catch { clear(previewEl, h('div', { class: 'muted' }, 'Could not load the preview.')) }
  }

  const upd = (patch) => { Object.assign(o, patch); save('html2md:opts', o); run() }
  const options = h('div', { class: 'opts' },
    field('Headings', select([['atx', '# Hash style'], ['setext', 'Underlined (=== and ---)']], o.heading, (v) => upd({ heading: v }))),
    field('Bullet marker', select([['-', '- dash'], ['*', '* star'], ['+', '+ plus']], o.bullet, (v) => upd({ bullet: v }))),
    field('Code blocks', select([['fenced', 'Fenced (```)'], ['indented', 'Indented']], o.code, (v) => upd({ code: v }))),
    field('Links', select([['inlined', 'Inline [text](url)'], ['referenced', 'Reference [text][1]']], o.link, (v) => upd({ link: v }))),
    h('div', { class: 'stack', style: 'gap:8px' }, toggle('Tables, task lists, strikethrough (GitHub style)', o.gfm, (c) => upd({ gfm: c })), toggle('Keep images', o.images, (c) => upd({ images: c }))),
    h('div', { class: 'stack', style: 'gap:8px' }, toggle('Only the main article (<article> or <main>)', o.main, (c) => upd({ main: c })), toggle('Drop scripts, styles and embeds', o.strip, (c) => upd({ strip: c }))))

  const dz = dropzone({ accept: '.html,.htm,.xhtml,text/html', compact: true, label: 'Drop an .html file', hint: 'Or click to choose one', icon: 'file-code', paste: false, onFiles: async ([f]) => { src.value = await f.text(); run() } })
  const pasteBtn = button('Paste from clipboard', { icon: 'clipboard-paste', onClick: async () => {
    try {
      const items = await navigator.clipboard.read()
      for (const it of items) {
        if (it.types.includes('text/html')) { src.value = await (await it.getType('text/html')).text(); run(); return toast('Pasted rich content as HTML', 'success') }
      }
      for (const it of items) if (it.types.includes('text/plain')) { src.value = await (await it.getType('text/plain')).text(); run(); return toast('Pasted text', 'success') }
      toast('The clipboard has no text or HTML.', 'error')
    } catch { toast('Your browser blocked clipboard access. Press Ctrl+V inside the box instead.', 'error') }
  } })
  const left = h('div', { class: 'pane' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'wt-kicker' }, 'HTML'),
    h('div', { class: 'row' }, pasteBtn, button('Example', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: () => { src.value = EXAMPLE; run() } }), button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { src.value = ''; run(); src.focus() } }))), src, dz)
  const right = h('div', { class: 'pane' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'wt-kicker' }, 'Markdown'),
    h('div', { class: 'row' }, copyButton(() => md, 'Copy'), button('Download .md', { icon: 'download', size: 'sm', variant: 'primary', onClick: () => md && download(md, 'converted.md', 'text/markdown') }))), outTabs, statsEl)
  root.append(h('div', { class: 't-h2m stack' }, statusEl, split(left, right), h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center' }, 'Conversion options'), h('div', { style: 'margin-top:12px' }, options)),
    note('Pasted HTML is parsed in a sandboxed document, so scripts in it never run. Nothing leaves your browser.')))
  loadGfm().catch(() => {})
}
