// Markdown to PDF. Write or upload Markdown, pick a theme, and watch the page build live. GitHub-style tables, task lists, code with
// syntax highlighting, quotes and images, set in Noto fonts (Latin, Cyrillic, Greek and Indic scripts) and paginated without cutting lines.
import { h, button, busy, progress, alert, segmented, select, rangeField, toggle, field, textarea, input, dropzone, split, clear, download, debounce, onCleanup, formatBytes, icon } from '../../lib/ui.js'
import { marked as markedLib, dompurify, script } from '../../lib/libs.js'
import { baseName } from '../../lib/files.js'
import { load, save } from '../../lib/store.js'
import { PAGE_SIZES } from '../../lib/pdf.js'
import { scan, inlineFontCss } from './_fonts.js'
import { useStyles, flow, step, options, done, note, plural, secs, readTextFile } from './_shared.js'
import { makeFrame, paginate, printFrame, MM, PX } from './_paginate.js'

const HLJS = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js'
const INDIC = { devanagari: 'noto-sans-devanagari', bengali: 'noto-sans-bengali', gurmukhi: 'noto-sans-gurmukhi', gujarati: 'noto-sans-gujarati', tamil: 'noto-sans-tamil', telugu: 'noto-sans-telugu', kannada: 'noto-sans-kannada', malayalam: 'noto-sans-malayalam' }

const CSS = `
.t-mdp .editor { min-height: 360px; font-size: 13px; }
.t-mdp .themes { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 10px; }
.t-mdp .theme { border: 1.5px solid var(--border); border-radius: 14px; background: var(--surface); padding: 10px 8px 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; font: inherit; color: var(--text-2); font-size: 12px; transition: transform .3s var(--spring), border-color .2s, box-shadow .25s; }
.t-mdp .theme:hover { transform: translateY(-3px); border-color: var(--border-strong); }
.t-mdp .theme[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 10px 22px -12px var(--accent); color: var(--accent); font-weight: 600; }
.t-mdp .tmini { width: 100%; max-width: 72px; aspect-ratio: 3 / 4; background: #fff; border-radius: 4px; box-shadow: 0 0 0 1px var(--border); padding: 7px 6px; display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
.t-mdp .tmini i { display: block; height: 3px; border-radius: 2px; background: #d6d9df; } .t-mdp .tmini i.h { height: 6px; background: #1c2430; width: 70%; margin-bottom: 2px; }
.t-mdp .tmini i.c { height: 10px; background: #0f172a; border-radius: 2px; } .t-mdp .tmini i.s { width: 80%; }
.t-mdp .pvwrap { position: relative; border: 1px solid var(--border); border-radius: var(--radius-lg); background: #fff; overflow: hidden; box-shadow: var(--shadow-sm); }
.t-mdp .pvwrap iframe { display: block; border: 0; background: #fff; transform-origin: 0 0; pointer-events: none; }
.t-mdp .pvbar { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin-bottom: 8px; flex-wrap: wrap; } .t-mdp .pvbar b { color: var(--text-2); }
`

export const SAMPLE = `# Project handbook

A short guide written in **Markdown**, exported as a clean PDF. Edit this text on the left and the page updates on the right.

## Why Markdown

- Plain text that stays readable
- *Emphasis*, **strong text**, ~~strikethrough~~ and \`inline code\`
- [Links](https://example.com) that stay clickable in the PDF

> Good documentation is a gift to your future self.

## A small table

| Quarter | Revenue | Margin |
| --- | ---: | ---: |
| Q1 | 1,020,500 | 19.6% |
| Q2 | 1,085,250 | 20.3% |
| Q3 | 1,040,000 | 16.3% |

## Code that looks right

\`\`\`js
function margin(revenue, costs) {
  // returns a ratio between 0 and 1
  return (revenue - costs) / revenue
}
console.log(margin(4200500, 3391200).toFixed(3))
\`\`\`

### To do

- [x] Write the handbook
- [x] Pick a theme
- [ ] Share the PDF

---

Made with a browser tab. Nothing was uploaded.
`

const THEMES = [
  { id: 'clean', name: 'Clean', serif: false, dark: true },
  { id: 'book', name: 'Book', serif: true, dark: false },
  { id: 'github', name: 'GitHub', serif: false, dark: false },
  { id: 'compact', name: 'Compact', serif: false, dark: false },
]

function themeCss(theme, sizePt, breakH1) {
  const t = THEMES.find((x) => x.id === theme) || THEMES[0]
  const sans = `'Noto Sans','Noto Sans Devanagari','Noto Sans Bengali','Noto Sans Gurmukhi','Noto Sans Gujarati','Noto Sans Tamil','Noto Sans Telugu','Noto Sans Kannada','Noto Sans Malayalam',system-ui,sans-serif`
  const serif = `'Noto Serif','Noto Sans Devanagari','Noto Sans Bengali','Noto Sans Gurmukhi','Noto Sans Gujarati','Noto Sans Tamil','Noto Sans Telugu','Noto Sans Kannada','Noto Sans Malayalam',Georgia,serif`
  const size = theme === 'compact' ? sizePt - 1.5 : sizePt
  const dark = t.dark
  return `
html,body{margin:0;background:#fff}
.md{--ink:#1c2430;--muted:#5b6472;--accent:#4f46e5;--line:#e3e6eb;--soft:#f5f6f8;font-family:${t.serif ? serif : sans};font-size:${size}pt;line-height:${theme === 'compact' ? 1.42 : t.serif ? 1.65 : 1.58};color:var(--ink);overflow-wrap:break-word;${t.serif ? 'text-align:justify;hyphens:auto;' : ''}}
.md>*:first-child{margin-top:0}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{font-weight:700;line-height:1.25;margin:1.5em 0 .5em;break-after:avoid;text-align:left}
.md h1{font-size:2em;margin-top:0;${theme === 'clean' ? 'border-bottom:3px solid var(--accent);padding-bottom:.25em;' : theme === 'github' ? 'border-bottom:1px solid var(--line);padding-bottom:.3em;' : theme === 'book' ? 'text-align:center;font-size:2.2em;' : 'font-size:1.7em;'}${breakH1 ? 'break-before:page;' : ''}}
.md h2{font-size:1.45em;${theme === 'github' ? 'border-bottom:1px solid var(--line);padding-bottom:.25em;' : theme === 'clean' ? 'color:var(--accent);' : ''}}
.md h3{font-size:1.2em}.md h4{font-size:1.05em}.md h5,.md h6{font-size:1em;color:var(--muted)}
.md p,.md ul,.md ol,.md pre,.md table,.md blockquote,.md dl{margin:0 0 ${theme === 'compact' ? .6 : .95}em}
.md ul,.md ol{padding-left:1.6em}.md li{margin:.22em 0}.md li>p{margin:.2em 0}.md li>ul,.md li>ol{margin:.2em 0}
.md a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.md strong{font-weight:700}.md em{font-style:italic}.md del{color:var(--muted)}
.md code{font-family:'Noto Sans Mono',ui-monospace,Menlo,Consolas,monospace;font-size:.86em;background:${theme === 'github' ? 'rgba(175,184,193,.22)' : 'var(--soft)'};padding:.14em .36em;border-radius:5px}
.md pre{background:${dark ? '#0f172a' : theme === 'github' ? '#f6f8fa' : 'var(--soft)'};color:${dark ? '#e2e8f0' : '#1f2328'};padding:12px 14px;border-radius:9px;white-space:pre-wrap;word-break:break-word;text-align:left;${dark ? '' : 'border:1px solid var(--line);'}line-height:1.5}
.md pre code{background:none;padding:0;color:inherit;font-size:.8em;border-radius:0}
.md blockquote{margin-left:0;padding:.35em 1em;border-left:4px solid ${theme === 'book' ? '#a8a29e' : 'var(--accent)'};color:var(--muted);background:${theme === 'clean' ? 'var(--soft)' : 'transparent'};border-radius:0 8px 8px 0}
.md blockquote>:last-child{margin-bottom:0}
.md table{border-collapse:collapse;width:100%;font-size:.93em;text-align:left;break-inside:auto}
.md th,.md td{border:1px solid var(--line);padding:${theme === 'compact' ? '3px 7px' : '6px 11px'}}.md th{background:var(--soft);font-weight:700}
.md tr:nth-child(even) td{background:${theme === 'clean' || theme === 'github' ? '#fafbfc' : 'transparent'}}
.md img{max-width:100%;height:auto;border-radius:4px}
.md hr{border:0;border-top:1px solid var(--line);margin:1.8em 0}
.md input[type=checkbox]{margin:0 .5em 0 -1.4em;vertical-align:middle}.md li:has(>input[type=checkbox]){list-style:none}
.md .toc{border:1px solid var(--line);border-radius:10px;padding:10px 18px;margin:0 0 1.4em;background:var(--soft);break-inside:avoid}
.md .toc h2{font-size:1em;margin:.2em 0 .4em;border:0;padding:0;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.md .toc ul{list-style:none;padding-left:0;margin:0}.md .toc li{margin:.15em 0}.md .toc li.l2{padding-left:1.2em}.md .toc li.l3{padding-left:2.4em;color:var(--muted)}.md .toc a{color:inherit;text-decoration:none}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-section,.hljs-doctag,.hljs-name{color:${dark ? '#c4b5fd' : '#cf222e'}}
.hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute,.hljs-meta .hljs-string{color:${dark ? '#86efac' : '#0a3069'}}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-variable.constant_{color:${dark ? '#fdba74' : '#0550ae'}}
.hljs-comment,.hljs-quote,.hljs-deletion{color:${dark ? '#94a3b8' : '#6e7781'};font-style:italic}
.hljs-title,.hljs-title.function_,.hljs-title.class_{color:${dark ? '#7dd3fc' : '#8250df'}}
.hljs-built_in,.hljs-type,.hljs-class .hljs-title{color:${dark ? '#f9a8d4' : '#953800'}}
.hljs-attr,.hljs-property,.hljs-variable,.hljs-template-variable{color:${dark ? '#93c5fd' : '#0550ae'}}
.hljs-tag,.hljs-meta,.hljs-params{color:${dark ? '#cbd5e1' : '#24292f'}}`
}

/** Markdown text -> sanitized HTML body (with optional highlighting and a table of contents). */
export async function renderBody(text, { highlight = true, toc = false } = {}) {
  const [{ marked }, DOMPurify] = await Promise.all([markedLib(), dompurify()])
  const html = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: false }), { ADD_ATTR: ['target'] })
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const root = tpl.content
  if (highlight && root.querySelector('pre code[class*="language-"]')) {
    try {
      await script(HLJS)
      for (const code of root.querySelectorAll('pre code[class*="language-"]')) {
        const lang = /language-([\w+#-]+)/.exec(code.className)?.[1]
        if (lang && window.hljs.getLanguage(lang)) { code.innerHTML = window.hljs.highlight(code.textContent, { language: lang, ignoreIllegals: true }).value; code.classList.add('hljs') }
      }
    } catch { /* highlighting is optional */ }
  }
  const heads = [...root.querySelectorAll('h1,h2,h3')]
  let n = 0
  for (const hd of heads) hd.id ||= `s${++n}`
  if (toc && heads.length > 2) {
    const nav = document.createElement('nav')
    nav.className = 'toc'
    nav.innerHTML = `<h2>Contents</h2><ul>${heads.map((hd) => `<li class="l${hd.tagName[1]}"><a href="#${hd.id}">${hd.textContent.replace(/[<>&]/g, '')}</a></li>`).join('')}</ul>`
    const first = root.firstElementChild
    if (first && first.tagName === 'H1') first.after(nav)
    else root.prepend(nav)
  }
  const wrap = document.createElement('div')
  wrap.append(root)
  for (const a of wrap.querySelectorAll('a[href^="http"]')) { a.target = '_blank'; a.rel = 'noopener noreferrer' }
  return { html: wrap.innerHTML, title: heads.find((x) => x.tagName === 'H1')?.textContent || '' }
}

export async function docHtml(body, { theme = 'clean', size = 11, text = '', breakH1 = false } = {}) {
  const t = THEMES.find((x) => x.id === theme) || THEMES[0]
  const { need } = scan(text)
  const main = t.serif ? 'noto-serif' : 'noto-sans'
  const specs = [[main, '400'], [main, '700'], [main, '400-italic'], [main, '700-italic'], ['noto-sans-mono', '400'], ['noto-sans-mono', '700'],
    ...Object.entries(INDIC).filter(([k]) => need.has(k)).flatMap(([, pkg]) => [[pkg, '400'], [pkg, '700']])]
  let fonts = ''
  try { fonts = await inlineFontCss(specs, `${text} ${body.replace(/<[^>]+>/g, ' ')}`) } catch { /* offline: system fonts are used */ }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}${themeCss(theme, size, breakH1)}</style></head><body><main class="md">${body}</main></body></html>`
}

export function mount(root, { signal }) {
  useStyles({ id: 'mdp', css: CSS })
  const S = { theme: 'clean', size: 11, page: 'A4', orient: 'portrait', margin: 18, highlight: true, toc: false, numbers: true, breakH1: false, scale: 2 }
  const fl = flow('md', 'pdf')
  const prog = progress()
  const result = h('div', { class: 'stack' })
  let fileName = 'document'

  const ta = textarea({ class: 'editor', mono: true, rows: 16, value: load('markdown-to-pdf:text', SAMPLE), placeholder: '# Title\n\nWrite Markdown here...', 'aria-label': 'Markdown source', spellcheck: false })
  const zone = dropzone({ accept: '.md,.markdown,.mdown,.txt,text/markdown,text/plain', compact: true, label: 'Or drop a .md file here', hint: 'Markdown or plain text', onFiles: async ([f]) => { ta.value = await readTextFile(f); fileName = baseName(f.name); onChange() } })
  const sampleBtn = button('Load the example', { icon: 'wand-sparkles', size: 'sm', onClick: () => { ta.value = SAMPLE; fileName = 'handbook'; onChange() } })
  const clearBtn = button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { ta.value = ''; onChange(); ta.focus() } })

  const themeBtns = THEMES.map((t) => {
    const mini = h('div', { class: 'tmini', style: { fontFamily: t.serif ? 'Georgia, serif' : 'inherit' } }, h('i', { class: 'h', style: t.id === 'book' ? 'margin-inline:auto' : t.id === 'clean' ? 'background:#4f46e5' : null }), h('i'), h('i', { class: 's' }), h('i'), t.id === 'github' ? h('i', { style: 'background:#eef0f3;height:8px' }) : h('i', { class: 'c', style: t.dark ? null : 'background:#e9ecf0' }), h('i', { class: 's' }))
    const b = h('button', { type: 'button', class: 'theme', 'aria-pressed': String(t.id === S.theme), onclick: () => { S.theme = t.id; themeBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); updatePreview() } }, mini, t.name)
    return b
  })
  const sizeR = rangeField('Font size', { min: 9, max: 14, step: 0.5, value: S.size, format: (v) => `${v} pt`, onInput: (v) => { S.size = v; updatePreview() } })
  const pageSel = select([['A4', 'A4'], ['Letter', 'US Letter'], ['Legal', 'US Legal'], ['A5', 'A5'], ['A3', 'A3']], S.page, (v) => { S.page = v; updatePreview() })
  const orientSeg = segmented([['portrait', 'Portrait'], ['landscape', 'Landscape']], S.orient, (v) => { S.orient = v; updatePreview() }, 'Orientation')
  const marginR = rangeField('Margins', { min: 8, max: 35, step: 1, value: S.margin, format: (v) => `${v} mm`, onInput: (v) => { S.margin = v; updatePreview() } })
  const qualSeg = segmented([[2, 'Standard'], [3, 'Sharp']], S.scale, (v) => { S.scale = +v }, 'Quality')
  const tog = (key, label) => toggle(label, S[key], (v) => { S[key] = v; updatePreview() })

  // ----- live preview
  const prevFrame = h('iframe', { sandbox: 'allow-same-origin', title: 'Document preview', tabindex: -1 })
  const wrap = h('div', { class: 'pvwrap' }, prevFrame)
  const pvInfo = h('div', { class: 'pvbar' })
  const dims = () => {
    const [bw, bh] = PAGE_SIZES[S.page]
    const [W, H] = S.orient === 'landscape' ? [bh, bw] : [bw, bh]
    const m = S.margin * MM
    return { W, H, m, L: Math.ceil((W - 2 * m) * PX) }
  }
  let pvToken = 0
  const updatePreview = debounce(async () => {
    const t = ++pvToken
    const d = dims()
    const w = wrap.clientWidth || 600
    const k = Math.min(1.4, w / (d.L + 2 * d.m * PX))
    const h2 = Math.round((d.H * PX - 2 * d.m * PX) * 0.8)
    prevFrame.style.width = `${d.L}px`
    prevFrame.style.height = `${h2}px`
    prevFrame.style.transform = `scale(${k})`
    const pad = Math.round(d.m * PX * k)
    wrap.style.padding = `${pad}px`
    wrap.style.height = `${Math.round(h2 * k) + 2 * pad}px`
    const { html } = await renderBody(ta.value, { highlight: S.highlight, toc: S.toc })
    if (t !== pvToken) return
    prevFrame.srcdoc = await docHtml(html, { theme: S.theme, size: S.size, text: ta.value, breakH1: S.breakH1 })
    clear(pvInfo, h('b', 'Live preview'), `top of the first page · ${S.page} ${S.orient}`)
  }, 250)
  const onChange = () => { save('markdown-to-pdf:text', ta.value.length < 300_000 ? ta.value : ''); downloadBtn.disabled = printBtn.disabled = !ta.value.trim(); updatePreview() }
  ta.addEventListener('input', onChange)
  addEventListener('resize', updatePreview)
  onCleanup(() => removeEventListener('resize', updatePreview))

  const downloadBtn = button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg' })
  const printBtn = button('Print or save with the browser', { icon: 'printer', size: 'lg' })
  downloadBtn.addEventListener('click', () => busy(downloadBtn, convert, { label: 'Building PDF', errorTo: result, progress: prog }))
  printBtn.addEventListener('click', async () => {
    const d = dims()
    const { html } = await renderBody(ta.value, { highlight: S.highlight, toc: S.toc })
    const frame = await makeFrame(await docHtml(html, { theme: S.theme, size: S.size, text: ta.value, breakH1: S.breakH1 }), d.L)
    printFrame(frame, { size: S.page, orient: S.orient, marginMm: S.margin })
    frame.win.addEventListener('afterprint', () => frame.destroy(), { once: true })
    setTimeout(() => frame.destroy(), 120_000)
  })

  async function convert() {
    clear(result)
    fl.state('working')
    const t0 = performance.now()
    const d = dims()
    const { html, title } = await renderBody(ta.value, { highlight: S.highlight, toc: S.toc })
    const frame = await makeFrame(await docHtml(html, { theme: S.theme, size: S.size, text: ta.value, breakH1: S.breakH1 }), d.L)
    try {
      const r = await paginate(frame.doc.querySelector('.md'), { size: S.page, orient: S.orient, margin: { t: d.m, r: d.m, b: d.m, l: d.m }, scale: S.scale, layoutPx: d.L, pageNumbers: S.numbers, title: title || fileName, onProgress: (f, t) => prog.set(f, t), signal })
      const blob = new Blob([r.bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      onCleanup(() => URL.revokeObjectURL(url))
      done(result, {
        flowEl: fl, title: 'Your PDF is ready', text: 'Pages are sharp images with an invisible text layer, so text can be searched and selected and links work.',
        stats: [plural(r.pages, 'page'), `${r.words.toLocaleString()} words searchable`, r.links ? plural(r.links, 'link') : null, formatBytes(blob.size), secs(performance.now() - t0)].filter(Boolean),
        actions: [button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, `${fileName}.pdf`) }), button('Preview', { icon: 'external-link', onClick: () => window.open(url, '_blank', 'noopener') })],
      })
    } catch (e) { fl.state('idle'); throw e } finally { frame.destroy() }
  }

  const s1 = step(1, 'Your Markdown', h('div', { class: 'stack' }, ta, h('div', { class: 'row between' }, h('div', { class: 'row' }, sampleBtn, clearBtn), h('span', { class: 'cv-sub' }, 'Saved in this browser only')), zone))
  const s2 = step(2, 'Theme and page', split(h('div', { class: 'stack' }, field('Theme', h('div', { class: 'themes' }, themeBtns)), options(sizeR, field('Page size', pageSel), field('Orientation', orientSeg), marginR, field('Quality', qualSeg, 'Sharp makes bigger files with crisper text.')),
    h('div', { class: 'stack tight' }, tog('highlight', 'Highlight code'), tog('toc', 'Table of contents'), tog('numbers', 'Page numbers'), tog('breakH1', 'Start each top-level heading on a new page'))), h('div', pvInfo, wrap), 'wide-left'))
  const s3 = step(3, 'Create the PDF', h('div', { class: 'stack' }, h('div', { class: 'row' }, downloadBtn, printBtn), note('Runs on your device. Pictures that link to other websites are fetched from those sites and may be blocked, so embedded images are the safest.', 'shield-check'), prog.el, result))
  root.append(h('div', { class: 'cv t-mdp' }, fl, s1, s2, s3))
  onChange()
}
