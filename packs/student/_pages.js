// Document rendering shared by the notes, formula sheet, LaTeX and quiz tools:
//  - renderMarkdown(): Markdown with $math$ -> sanitized HTML (KaTeX)
//  - htmlToPdf(): paginates rendered blocks onto A4/Letter pages and builds a PDF (page pictures at 2x)
//  - printDoc(): the browser's own print dialog (vector PDF with selectable text)
// DOC_CSS uses fixed colours (never theme variables) so printed and exported pages are always dark-on-white.
import { h } from '../../lib/ui.js'
import { marked as loadMarked, dompurify, katex, html2canvas, pdfLib } from '../../lib/libs.js'
import { printNode } from './_kit.js'

export const PAGE = { a4: { w: 794, h: 1123, pt: [595.28, 841.89], css: 'A4' }, letter: { w: 816, h: 1056, pt: [612, 792], css: 'Letter' } }

export const DOC_CSS = `
.pgdoc { font: 400 var(--pg-fs, 14px)/1.55 var(--pg-font, "Geist", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif); color: #14161f; background: #fff; word-wrap: break-word; overflow-wrap: anywhere; }
.pgdoc.serif { --pg-font: Georgia, "Times New Roman", "Noto Serif", serif; }
.pgdoc.mono { --pg-font: "Geist Mono", ui-monospace, Consolas, monospace; }
.pgdoc * { box-sizing: border-box; }
.pgdoc.flow { display: flex; flex-direction: column; }
.pgdoc > * { margin: 0 0 .85em; min-width: 0; }
.pgdoc h1, .pgdoc h2, .pgdoc h3, .pgdoc h4, .pgdoc h5, .pgdoc h6 { line-height: 1.22; font-weight: 680; letter-spacing: -.012em; color: var(--pg-h, #0f1222); margin: 1.1em 0 .45em; }
.pgdoc > :first-child { margin-top: 0; }
.pgdoc h1 { font-size: 2em; padding-bottom: .25em; border-bottom: 2px solid var(--pg-accent, #6366f1); }
.pgdoc h2 { font-size: 1.5em; padding-bottom: .15em; border-bottom: 1px solid #dfe2ea; }
.pgdoc h3 { font-size: 1.22em; } .pgdoc h4 { font-size: 1.05em; } .pgdoc h5, .pgdoc h6 { font-size: .95em; text-transform: uppercase; letter-spacing: .05em; color: #4b5167; }
.pgdoc p { margin-top: 0; }
.pgdoc ul, .pgdoc ol { padding-left: 1.6em; margin-top: 0; }
.pgdoc li { margin: .18em 0; } .pgdoc li > ul, .pgdoc li > ol { margin: .2em 0 .1em; }
.pgdoc li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.4em; } .pgdoc li > input[type=checkbox] { margin: 0 .5em 0 0; vertical-align: -.1em; }
.pgdoc blockquote { margin-left: 0; padding: .4em 1em; border-left: 4px solid var(--pg-accent, #6366f1); background: #f4f5fb; color: #3a4057; border-radius: 0 8px 8px 0; }
.pgdoc blockquote > :last-child { margin-bottom: 0; }
.pgdoc code { font: 500 .88em "Geist Mono", ui-monospace, Consolas, monospace; background: #eef0f6; padding: .12em .38em; border-radius: 5px; }
.pgdoc pre { background: #f4f5fa; border: 1px solid #e1e4ee; border-radius: 10px; padding: .8em 1em; overflow: hidden; white-space: pre-wrap; }
.pgdoc pre code { background: none; padding: 0; font-size: .86em; }
.pgdoc table { border-collapse: collapse; width: 100%; font-size: .95em; }
.pgdoc th, .pgdoc td { border: 1px solid #d5d9e6; padding: .4em .7em; text-align: left; vertical-align: top; }
.pgdoc th { background: #eef0f8; font-weight: 640; }
.pgdoc tr:nth-child(even) td { background: #fafbfe; }
.pgdoc hr { border: 0; border-top: 1px solid #d5d9e6; margin: 1.2em 0; }
.pgdoc img { max-width: 100%; height: auto; border-radius: 6px; }
.pgdoc a { color: #4f46e5; text-decoration: underline; }
.pgdoc mark { background: #fff2a8; padding: 0 .15em; border-radius: 3px; }
.pgdoc .katex-display { margin: .6em 0; overflow: hidden; }
.pgdoc .katex { font-size: 1.1em; }
.pgdoc.pg-foot { flex: none; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #7a8097; }
`

let cssDone = false
function ensureDocCss() {
  if (cssDone || document.getElementById('stu-style-pgdoc')) { cssDone = true; return }
  document.head.append(h('style', { id: 'stu-style-pgdoc' }, DOC_CSS))
  cssDone = true
}

/** KaTeX with its stylesheet and fonts ready (html2canvas needs the fonts loaded before it draws). */
export async function katexReady() {
  const k = await katex()
  const link = document.querySelector('link[data-katex]')
  if (link && !link.sheet) await new Promise((r) => { link.addEventListener('load', r, { once: true }); link.addEventListener('error', r, { once: true }); setTimeout(r, 6000) })
  try {
    await Promise.all(['16px KaTeX_Main', 'italic 16px KaTeX_Math', 'bold 16px KaTeX_Main', '16px KaTeX_AMS', '16px KaTeX_Size1', '16px KaTeX_Size2', '16px KaTeX_Caligraphic', '16px KaTeX_Script'].map((f) => document.fonts.load(f, 'x1+∑')))
  } catch { /* fonts are best effort */ }
  return k
}

/** Render TeX to an HTML string. Never throws; bad input is shown as red source text. */
export function tex(k, src, display = false) {
  try { return k.renderToString(src, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore', trust: false, maxExpand: 2000 }) } catch { return `<code>${src.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</code>` }
}

/** Pull $..$, $$..$$, \(..\), \[..\] out of Markdown (not inside code) so marked does not mangle them. */
function protectMath(md) {
  const math = []
  const stash = (src, display) => { math.push({ src, display }); return `⁣MATH${math.length - 1}⁣` }
  const parts = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g)
  const out = parts.map((p, i) => {
    if (i % 2) return p
    return p
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, s) => stash(s.trim(), true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, s) => stash(s.trim(), true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, s) => stash(s.trim(), false))
      .replace(/(?<![\\$\w])\$(?!\s|\$)((?:\\.|[^$\n\\])+?)(?<![\s\\])\$(?![\d$\w])/g, (_, s) => stash(s, false))
  })
  return { text: out.join(''), math }
}

/** Markdown (with math) -> sanitized HTML string. */
export async function renderMarkdown(md, { breaks = false } = {}) {
  const [{ marked }, purify, k] = await Promise.all([loadMarked(), dompurify(), katexReady()])
  const { text, math } = protectMath(String(md || ''))
  let html = marked.parse(text, { gfm: true, breaks, async: false })
  html = purify.sanitize(html, { ADD_ATTR: ['target'] })
  return html.replace(/⁣MATH(\d+)⁣/g, (_, i) => {
    const m = math[+i]
    return m ? tex(k, m.src, m.display) : ''
  })
}

/** Shrink any .fit element whose content is wider than its box (long formulas in narrow columns). Call while attached and laid out. */
export function fitOverflow(root) {
  const els = root.matches?.('.fit') ? [root, ...root.querySelectorAll('.fit')] : [...root.querySelectorAll('.fit')]
  for (const el of els) {
    el.style.fontSize = ''
    const inner = el.firstElementChild
    const need = Math.max(el.scrollWidth, inner ? inner.scrollWidth : 0), have = el.clientWidth
    if (have > 0 && need > have + 1) el.style.fontSize = Math.max(0.5, (have / need) * 0.97).toFixed(3) + 'em'
  }
}

const outerH = (el) => {
  const cs = getComputedStyle(el)
  return el.getBoundingClientRect().height + parseFloat(cs.marginTop || 0) + parseFloat(cs.marginBottom || 0)
}

/** Flatten top-level blocks so long lists and tables can break between items. */
function blocksOf(root) {
  const out = []
  for (const el of [...root.children]) {
    if ((el.tagName === 'UL' || el.tagName === 'OL') && el.children.length > 1) {
      let n = el.tagName === 'OL' ? (parseInt(el.getAttribute('start') || '1', 10) || 1) : 0
      ;[...el.children].forEach((li, i) => {
        const wrap = el.cloneNode(false)
        if (el.tagName === 'OL') wrap.setAttribute('start', n)
        n++
        wrap.append(li)
        wrap.style.marginBottom = i === el.children.length - 1 ? '' : '0'
        wrap.dataset.cont = i ? '1' : ''
        out.push(wrap)
      })
    } else if (el.tagName === 'TABLE' && el.rows.length > 4) {
      const head = el.tHead ? [...el.tHead.rows] : []
      const rows = [...(el.tBodies[0]?.rows || [])]
      for (let i = 0; i < rows.length; i += 3) {
        const t = el.cloneNode(false)
        if (head.length) t.append(h('thead', head.map((r) => r.cloneNode(true))))
        t.append(h('tbody', rows.slice(i, i + 3).map((r) => r.cloneNode(true))))
        t.style.marginBottom = i + 3 >= rows.length ? '' : '0'
        out.push(t)
      }
    } else out.push(el)
  }
  return out
}

/**
 * Lay blocks out on pages and return the page elements (detached). Never splits a block; headings stay with the next block.
 * opts: {size, margin, cls, fontSize, accent}
 */
export function layoutPages(blocks, { size = 'a4', margin = 56, cls = '', fontSize = 14, accent = '#6366f1', footer } = {}) {
  ensureDocCss()
  const P = PAGE[size] || PAGE.a4
  const innerH = P.h - margin * 2 - margin * 0.3
  const mk = (extra = '') => h('div', { class: ['pgdoc flow', cls, extra], style: { width: `${P.w - margin * 2}px`, '--pg-fs': `${fontSize}px`, '--pg-accent': accent } })
  const host = h('div', { style: 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none' })
  const probe = mk()
  host.append(probe)
  document.body.append(host)
  const flat = blocksOf(blocks)
  const measured = flat.map((el) => { probe.append(el); fitOverflow(el); return { el, ht: outerH(el) } })
  const pages = [[]]
  let used = 0
  measured.forEach((m, i) => {
    const isHead = /^H[1-6]$/.test(m.el.tagName)
    const next = measured[i + 1]
    const need = m.ht + (isHead && next ? Math.min(next.ht, 90) : 0)
    if (used + need > innerH && pages.at(-1).length) { pages.push([]); used = 0 }
    pages.at(-1).push(m.el)
    used += m.ht
  })
  const els = pages.map((blks, i) => {
    const body = mk()
    body.append(...blks)
    return h('div', { class: 'pgdoc-page', style: { display: 'flex', flexDirection: 'column', width: `${P.w}px`, height: `${P.h}px`, padding: `${margin}px ${margin}px ${footer ? 0 : margin}px`, background: '#fff', overflow: 'hidden' } },
      h('div', { style: 'flex:1 1 auto;min-height:0;overflow:hidden' }, body), footer ? h('div', { class: 'pgdoc pg-foot', style: { height: `${margin}px` } }, h('span', footer.left || ''), h('span', footer.right?.(i + 1, pages.length) || '')) : null)
  })
  host.remove()
  return els
}

/**
 * HTML string -> PDF Blob of page pictures. opts: {size, margin, cls, fontSize, accent, footer, scale, quality, onProgress, signal}
 * Text is not selectable in this output (use printDoc for that), but the layout is exactly what the preview shows.
 */
export async function htmlToPdf(html, opts = {}) {
  const { size = 'a4', scale = 2, quality = 0.92, onProgress, signal } = opts
  await katexReady()
  try { await document.fonts.ready } catch { /* ignore */ }
  const root = h('div', { html })
  const pages = layoutPages(root, opts)
  const host = h('div', { style: 'position:fixed;left:-100000px;top:0;pointer-events:none' }, ...pages)
  document.body.append(host)
  try {
    const [h2c, { PDFDocument }] = await Promise.all([html2canvas(), pdfLib()])
    const doc = await PDFDocument.create()
    const [pw, ph] = PAGE[size].pt
    for (let i = 0; i < pages.length; i++) {
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
      onProgress?.(i / pages.length, `Page ${i + 1} of ${pages.length}`)
      const canvas = await h2c(pages[i], { scale, backgroundColor: '#ffffff', useCORS: true, logging: false })
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
      const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()))
      doc.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph })
      canvas.width = canvas.height = 0
      await new Promise((r) => setTimeout(r, 0))
    }
    onProgress?.(1, 'Saving')
    doc.setCreator('Tools')
    return { blob: new Blob([await doc.save()], { type: 'application/pdf' }), pages: pages.length }
  } finally {
    host.remove()
  }
}

/** Open the print dialog for an HTML string, formatted like the pages (vector output with selectable text). */
export function printDoc(html, { size = 'a4', marginMm = 16, cls = '', fontSize = 14, accent = '#6366f1', title } = {}) {
  ensureDocCss()
  const style = h('style', `@media print { @page { size: ${PAGE[size].css}; margin: ${marginMm}mm; } .pgdoc.print-doc h1, .pgdoc.print-doc h2, .pgdoc.print-doc h3, .pgdoc.print-doc h4 { break-after: avoid; } .pgdoc.print-doc pre, .pgdoc.print-doc table, .pgdoc.print-doc blockquote, .pgdoc.print-doc li, .pgdoc.print-doc .katex-display, .pgdoc.print-doc .fs-item, .pgdoc.print-doc .q-item { break-inside: avoid; } }`)
  document.head.append(style)
  const node = h('div', { class: ['pgdoc print-doc', cls], style: { '--pg-fs': `${fontSize}px`, '--pg-accent': accent }, html })
  const host = h('div', { style: 'position:fixed;left:-100000px;top:0;visibility:hidden' })
  const prev = node.style.width
  node.style.width = `${Math.round(PAGE[size].w - marginMm * 3.78 * 2)}px`
  host.append(node)
  document.body.append(host)
  try { fitOverflow(node) } catch { /* best effort */ }
  node.style.width = prev
  host.remove()
  const done = printNode(node, title)
  setTimeout(() => style.remove(), 190_000)
  return done
}

/** Strip tags to plain text (for clipboard text/plain and TXT downloads). */
export function htmlToText(html) {
  const d = document.createElement('div')
  d.innerHTML = html
  return d.innerText || d.textContent || ''
}
