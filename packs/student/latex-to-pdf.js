// LaTeX to PDF: equations with KaTeX (live render, copy LaTeX or MathML, export PNG, SVG or PDF) and simple LaTeX documents with latex.js
// (HTML preview, print or save as PDF). latex.js is MIT licensed and covers core LaTeX only; the limits are listed in the tool.
import { h, button, busy, field, segmented, toggle, alert, clear, debounce, download, toast, rangeField, copyText, select } from '../../lib/ui.js'
import { script, VERSIONS, html2canvas, pdfLib } from '../../lib/libs.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, emptyState, TINTS, confetti, takeHandoff } from './_kit.js'
import { katexReady, PAGE } from './_pages.js'

const LATEXJS = 'https://cdn.jsdelivr.net/npm/latex.js@0.12.6/dist/'
const KATEX_CSS = `https://cdn.jsdelivr.net/npm/katex@${VERSIONS.katex}/dist/katex.min.css`

const CSS = `
.t-tex .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.t-tex .editor { width: 100%; min-height: 150px; font: 500 14px/1.6 var(--mono); resize: vertical; tab-size: 2; }
.t-tex .doc-editor { min-height: 460px; }
.t-tex .mathbox { min-height: 150px; padding: 18px 12px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); display: grid; place-items: center; overflow: auto; }
.t-tex .mathbox.checker { background: repeating-conic-gradient(var(--surface-2) 0 25%, var(--surface) 0 50%) 50% / 18px 18px; }
.t-tex .mathbox .katex-display { margin: 0; }
.t-tex .palette { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 5px; max-height: 190px; overflow: auto; padding: 2px; }
.t-tex .sym { height: 38px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font-size: 15px; display: grid; place-items: center; transition: all .15s; padding: 0; overflow: hidden; }
.t-tex .sym:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); transform: translateY(-1px); }
.t-tex .sym .katex { font-size: 1em; }
.t-tex .frame { width: 100%; border: 1px solid var(--border); border-radius: 12px; background: #fff; min-height: 520px; display: block; }
.t-tex .opt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; align-items: end; }
.t-tex input[type=color] { width: 44px; height: 36px; padding: 2px; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; }
.t-tex details { font-size: 13.5px; color: var(--text-2); } .t-tex details summary { cursor: pointer; font-weight: 600; color: var(--text); }
.t-tex details ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 3px; }
`

const EXAMPLES = [
  ['Quadratic formula', 'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}'],
  ['Euler identity', 'e^{i\\pi} + 1 = 0'],
  ['Integral', '\\int_{0}^{\\infty} e^{-x^{2}}\\,dx = \\frac{\\sqrt{\\pi}}{2}'],
  ['Series', '\\sum_{n=1}^{\\infty} \\frac{1}{n^{2}} = \\frac{\\pi^{2}}{6}'],
  ['Matrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}^{-1} = \\frac{1}{ad-bc}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}'],
  ['Aligned steps', '\\begin{aligned} (x+1)^{2} &= x^{2} + 2x + 1 \\\\ &= 0 \\end{aligned}'],
  ['Piecewise', '|x| = \\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}'],
  ['Maxwell', '\\nabla \\times \\vec{B} = \\mu_0 \\vec{J} + \\mu_0\\varepsilon_0 \\frac{\\partial \\vec{E}}{\\partial t}'],
]

const PALETTE = {
  Greek: ['\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\varepsilon', '\\zeta', '\\eta', '\\theta', '\\lambda', '\\mu', '\\nu', '\\xi', '\\pi', '\\rho', '\\sigma', '\\tau', '\\phi', '\\varphi', '\\chi', '\\psi', '\\omega', '\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Pi', '\\Sigma', '\\Phi', '\\Psi', '\\Omega'],
  Operators: ['\\pm', '\\mp', '\\times', '\\div', '\\cdot', '\\ast', '\\circ', '\\oplus', '\\otimes', '\\cup', '\\cap', '\\setminus', '\\wedge', '\\vee', '\\neg', '\\forall', '\\exists', '\\nabla', '\\partial', '\\infty', '\\emptyset', '\\in', '\\notin', '\\subset', '\\subseteq', '\\therefore', '\\because'],
  Relations: ['\\le', '\\ge', '\\ne', '\\approx', '\\equiv', '\\sim', '\\simeq', '\\propto', '\\ll', '\\gg', '\\perp', '\\parallel', '\\cong', '\\neq'],
  Arrows: ['\\to', '\\leftarrow', '\\rightarrow', '\\leftrightarrow', '\\Rightarrow', '\\Leftarrow', '\\Leftrightarrow', '\\mapsto', '\\uparrow', '\\downarrow', '\\rightleftharpoons', '\\implies', '\\iff'],
  Templates: ['\\frac{a}{b}', '\\sqrt{x}', '\\sqrt[n]{x}', 'x^{n}', 'x_{i}', '\\sum_{i=1}^{n}', '\\prod_{i=1}^{n}', '\\int_{a}^{b}', '\\lim_{x \\to 0}', '\\binom{n}{k}', '\\vec{v}', '\\hat{x}', '\\bar{x}', '\\dot{x}', '\\overline{AB}', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '\\begin{cases} a & x>0 \\\\ b & x\\le0 \\end{cases}', '\\left( \\right)', '\\text{text}', '\\mathbb{R}'],
}

const DOC_SAMPLE = `\\documentclass{article}
\\title{Notes on Limits}
\\author{A. Student}
\\date{\\today}
\\begin{document}
\\maketitle

\\begin{abstract}
A short note about limits, written in plain LaTeX and previewed in your browser.
\\end{abstract}

\\section{Definition}
The limit of $f(x)$ as $x \\to a$ is $L$, written $\\lim_{x\\to a} f(x) = L$. For every $\\varepsilon > 0$ there is a $\\delta > 0$ such that
\\[ 0 < |x-a| < \\delta \\implies |f(x)-L| < \\varepsilon. \\]

\\subsection{Examples}
\\begin{itemize}
  \\item $\\lim_{x\\to 0} \\frac{\\sin x}{x} = 1$
  \\item \\textbf{Bold}, \\emph{emphasis} and \\texttt{code} all work.
\\end{itemize}

\\begin{enumerate}
  \\item Check the left-hand limit.
  \\item Check the right-hand limit.
\\end{enumerate}

\\begin{align}
a^2 + b^2 &= c^2 \\\\
e^{i\\pi} + 1 &= 0
\\end{align}

\\begin{tabular}{l|c|r}
Left & Centre & Right \\\\ \\hline
1 & 2 & 3 \\\\
\\end{tabular}

\\end{document}
`

// ---------- helpers (exported for tests) ----------
/** Make an amsmath-flavoured document friendlier to latex.js without changing the number of lines. -> {src, notes} */
export function prepareLatex(src) {
  const notes = []
  let tables = false
  let out = String(src).replace(/\\usepackage(\[[^\]]*\])?\{([^}]*)\}/g, (_, __, names) => {
    const list = names.split(',').map((s) => s.trim()).filter(Boolean)
    const math = list.filter((n) => /^(amsmath|amssymb|amsfonts|mathtools|bm|physics)$/.test(n))
    const other = list.filter((n) => !math.includes(n))
    if (math.length) notes.push(`${math.join(', ')}: math is typeset by KaTeX, which already includes the common amsmath commands.`)
    if (other.length) notes.push(`Ignored package${other.length > 1 ? 's' : ''} ${other.join(', ')} (packages cannot be loaded in the browser).`)
    return ''
  })
  // latex.js has no tabular: typeset tables as a KaTeX array with text cells (rows and cells keep working, borders too)
  out = out.replace(/\\begin\{tabular\}\{([^}]*)\}([\s\S]*?)\\end\{tabular\}/g, (m, spec, body) => {
    const cols = spec.replace(/@\{[^}]*\}/g, '').replace(/[pmb]\{[^}]*\}/g, 'l').replace(/[^lcr|]/g, '')
    const rows = body.split(/\\\\(?![a-zA-Z])/).map((row) => {
      let rules = ''
      const cells = row.split(/(?<!\\)&/).map((c, i) => {
        const t = c.replace(/\\hline/g, () => { if (i === 0) rules += '\\hline '; return '' }).trim()
        return t ? `\\text{${t}}` : ''
      })
      return rules + cells.join(' & ')
    }).filter((r, i, a) => r.trim() || i < a.length - 1)
    const made = `\\[\\begin{array}{${cols || 'l'}}${rows.join(' \\\\ ')}\\end{array}\\]`
    tables = true
    return made + '\n'.repeat(Math.max(0, (m.match(/\n/g) || []).length))
  })
  const aligned = (env, inner) => `\\[\\begin{${inner}}`
  out = out.replace(/\\begin\{(align|flalign|alignat)\*?\}(\{\d+\})?/g, () => aligned('align', 'aligned')).replace(/\\end\{(align|flalign|alignat)\*?\}/g, '\\end{aligned}\\]')
    .replace(/\\begin\{(gather|multline|eqnarray)\*?\}/g, '\\[\\begin{gathered}').replace(/\\end\{(gather|multline|eqnarray)\*?\}/g, '\\end{gathered}\\]')
    .replace(/\\begin\{equation\*?\}/g, '\\[').replace(/\\end\{equation\*?\}/g, '\\]')
    .replace(/\\(label|nonumber|notag)(\{[^}]*\})?/g, (m, name) => (name === 'label' && /\\section|\\subsection|\\caption/.test(m) ? m : ''))
  if (tables) notes.push('Tables are drawn with the math engine, so keep cell text simple.')
  if (out !== src && /\\begin\{(align|gather|equation|multline|eqnarray|flalign|alignat)/.test(src)) notes.push('Equation environments (align, equation, gather) are shown unnumbered.')
  return { src: out, notes }
}

/** "KaTeX parse error: Undefined control sequence: \foo at position 3: \̲f̲o̲o̲" -> "Undefined control sequence: \foo (position 3)" */
export const friendlyTexError = (msg) => String(msg).replace(/^KaTeX parse error:\s*/, '').replace(/[̲]/g, '').replace(/\s+at position (\d+):.*$/s, ' (character $1)')

function mathml(k, src, display) {
  const s = k.renderToString(src, { displayMode: display, output: 'mathml', throwOnError: true, strict: 'ignore' })
  return /<math[\s\S]*<\/math>/.exec(s)?.[0] || s
}

let cssCache = null
async function katexInlineCss(usedFonts) {
  const css = (cssCache ||= await (await fetch(KATEX_CSS)).text())
  const base = KATEX_CSS.replace(/katex\.min\.css$/, '')
  const faces = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0])
  const rules = css.replace(/@font-face\s*\{[^}]*\}/g, '')
  const keep = []
  for (const f of faces) {
    const fam = /font-family:\s*["']?([^;"']+)/.exec(f)?.[1]?.trim()
    const wt = /font-weight:\s*([^;}]+)/.exec(f)?.[1]?.trim() || 'normal'
    const stl = /font-style:\s*([^;}]+)/.exec(f)?.[1]?.trim() || 'normal'
    const norm = (w) => (w === '400' ? 'normal' : w === '700' ? 'bold' : w)
    if (!usedFonts.some((u) => u.family === fam && norm(u.weight) === norm(wt) && u.style === stl)) continue
    const url = /url\(([^)]+\.woff2)\)/.exec(f)?.[1]?.replace(/["']/g, '')
    if (!url) continue
    const buf = await (await fetch(new URL(url, base))).arrayBuffer()
    let bin = ''
    const b = new Uint8Array(buf)
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
    keep.push(`@font-face{font-family:${fam};font-weight:${wt};font-style:${stl};src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2")}`)
  }
  return keep.join('') + rules
}

/** Render TeX to a standalone SVG (HTML in a foreignObject with the needed fonts embedded). -> {svg, width, height} */
export async function texToSvg(src, { display = true, size = 28, color = '#111111', padding = 14 } = {}) {
  const k = await katexReady()
  const html = k.renderToString(src, { displayMode: display, throwOnError: true, output: 'html', strict: 'ignore' })
  const host = h('div', { style: `position:fixed;left:-100000px;top:0;display:inline-block;font-size:${size}px;padding:${padding}px;color:${color};line-height:1.2`, html })
  document.body.append(host)
  host.querySelector('.katex-display')?.style.setProperty('margin', '0')
  try { await document.fonts.ready } catch { /* ignore */ }
  const r = host.getBoundingClientRect()
  const used = [...document.fonts].filter((f) => f.status === 'loaded' && /KaTeX/.test(f.family)).map((f) => ({ family: f.family.replace(/["']/g, ''), weight: f.weight, style: f.style }))
  const w = Math.ceil(r.width), hgt = Math.ceil(r.height)
  const inner = new XMLSerializer().serializeToString(host.firstChild?.nodeType === 1 ? host.firstElementChild : host)
  host.remove()
  const css = await katexInlineCss(used)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${size}px;padding:${padding}px;color:${color};line-height:1.2;display:inline-block"><style>${css.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</style>${inner}</div></foreignObject></svg>`
  return { svg, width: w, height: hgt }
}

async function svgToCanvas(svg, w, hgt, scale, bg) {
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale); c.height = Math.round(hgt * scale)
  const g = c.getContext('2d')
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height) }
  g.drawImage(img, 0, 0, c.width, c.height)
  return c
}

/** Cut a tall canvas into page slices, preferring blank rows so lines of text are not cut in half. */
export function sliceCanvas(canvas, pageH) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const out = []
  let y = 0
  const blank = (row) => { const d = ctx.getImageData(0, row, canvas.width, 1).data; for (let i = 0; i < d.length; i += 16) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return false; return true }
  while (y < canvas.height - 2) {
    let end = Math.min(canvas.height, y + pageH)
    if (end < canvas.height) {
      for (let r = end; r > end - pageH * 0.18 && r > y + 40; r--) if (blank(r)) { end = r; break }
    }
    out.push([y, end])
    y = end
    while (y < canvas.height && blank(y) && out.length < 400) y++
  }
  return out
}

export function mount(root) {
  toolStyle('tex', CSS)
  const st = { mode: 'eq', display: true, size: 30, color: '#111111', bg: 'transparent', paper: 'a4', ...load('tex:state', {}) }
  st.eq ??= EXAMPLES[0][1]; st.doc ??= DOC_SAMPLE
  const incoming = takeHandoff('latex-to-pdf')
  if (typeof incoming === 'string' && incoming) { st.mode = 'eq'; st.eq = incoming }
  const persist = () => save('tex:state', { mode: st.mode, display: st.display, size: st.size, color: st.color, bg: st.bg, paper: st.paper, eq: st.eq, doc: st.doc })

  const modeSeg = segmented([['eq', 'Equations'], ['doc', 'Document']], st.mode, (v) => { st.mode = v; persist(); eqView.hidden = v !== 'eq'; docView.hidden = v !== 'doc'; if (v === 'doc') renderDoc() }, 'Mode')

  // ================= equations =================
  const eqIn = h('textarea', { class: 'textarea editor', spellcheck: false, value: st.eq, 'aria-label': 'LaTeX math', placeholder: 'Type LaTeX math, e.g. \\frac{a}{b}', oninput: (e) => { st.eq = e.target.value; persist(); paintEq() } })
  const mathbox = h('div', { class: 'mathbox' })
  const eqStatus = h('div')
  const eqOut = h('div')
  let kx = null
  const insert = (snippet) => {
    const s = eqIn.selectionStart, e = eqIn.selectionEnd
    eqIn.setRangeText(/^\\[a-zA-Z]+$/.test(snippet) ? snippet + ' ' : snippet, s, e, 'end')
    eqIn.focus(); eqIn.dispatchEvent(new Event('input'))
  }
  const palTabs = Object.keys(PALETTE)
  let palTab = 'Greek'
  const palBox = h('div', { class: 'palette' })
  const palSeg = segmented(palTabs.map((t) => [t, t]), palTab, (v) => { palTab = v; drawPalette() }, 'Symbol group')
  async function drawPalette() {
    kx ||= await katexReady()
    clear(palBox, PALETTE[palTab].map((s) => h('button', { type: 'button', class: 'sym', title: s, 'aria-label': `Insert ${s}`, html: kx.renderToString(s.length > 24 ? s.replace(/begin\{.*?\}.*end\{.*?\}/s, 'ddots') : s, { throwOnError: false, output: 'html', strict: 'ignore' }), onclick: () => insert(s) })))
  }
  async function paintEq() {
    kx ||= await katexReady()
    const src = eqIn.value
    if (!src.trim()) { clear(mathbox, emptyState('sigma', 'Type some LaTeX', 'Pick an example below or use the symbol buttons. The result updates as you type.')); clear(eqStatus); return }
    try {
      const html = kx.renderToString(src, { displayMode: st.display, throwOnError: true, output: 'html', strict: 'ignore' })
      mathbox.style.color = st.color
      mathbox.style.fontSize = `${st.size}px`
      mathbox.classList.toggle('checker', st.bg === 'transparent')
      mathbox.style.background = st.bg === 'transparent' ? '' : '#ffffff'
      mathbox.innerHTML = html
      clear(eqStatus)
    } catch (e) {
      clear(eqStatus, alert('error', friendlyTexError(e.message)))
    }
  }
  const need = (fn) => async () => {
    if (!eqIn.value.trim()) return toast('Type some LaTeX first', 'error')
    kx ||= await katexReady()
    try { kx.renderToString(eqIn.value, { throwOnError: true, strict: 'ignore' }) } catch (e) { return toast(friendlyTexError(e.message), 'error') }
    return fn()
  }
  const slug = () => 'equation'
  const opts = () => ({ display: st.display, size: st.size, color: st.color })
  const mkExport = (label, ic, fn) => { const b = button(label, { icon: ic, variant: 'secondary', onClick: need(() => busy(b, fn, 'Rendering')) }); return b }
  const btnPng = mkExport('PNG', 'image', async () => {
    const { svg, width, height } = await texToSvg(eqIn.value, opts())
    let canvas
    try { canvas = await svgToCanvas(svg, width, height, 3, st.bg === 'transparent' ? null : '#ffffff') } catch {
      const host = h('div', { style: `position:fixed;left:-100000px;top:0;display:inline-block;font-size:${st.size}px;padding:14px;color:${st.color}`, html: kx.renderToString(eqIn.value, { displayMode: st.display, throwOnError: false, output: 'html' }) })
      document.body.append(host); canvas = await (await html2canvas())(host, { scale: 3, backgroundColor: st.bg === 'transparent' ? null : '#fff' }); host.remove()
    }
    download(await new Promise((r) => canvas.toBlob(r, 'image/png')), `${slug()}.png`)
  })
  const btnSvg = mkExport('SVG', 'file-code', async () => {
    const { svg } = await texToSvg(eqIn.value, opts())
    download(svg, `${slug()}.svg`, 'image/svg+xml')
  })
  const btnPdf = mkExport('PDF', 'file-down', async () => {
    const { svg, width, height } = await texToSvg(eqIn.value, { ...opts(), padding: 28 })
    const c = await svgToCanvas(svg, width, height, 3, '#ffffff')
    const png = await new Promise((r) => c.toBlob(r, 'image/png'))
    const { PDFDocument } = await pdfLib()
    const doc = await PDFDocument.create()
    const img = await doc.embedPng(await png.arrayBuffer())
    const pw = Math.max(width * 0.75, 120), ph = height * 0.75
    doc.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph })
    download(new Blob([await doc.save()], { type: 'application/pdf' }), `${slug()}.pdf`)
  })
  const eqView = h('div', { class: 'stack', hidden: st.mode !== 'eq' },
    h('div', { class: 'tool-split' },
      tile({ tint: TINTS[0], title: 'LaTeX math', icon: 'square-function' }, h('div', { class: 'stack' }, eqIn, h('div', { class: 'stu-hint' }, 'Write the formula only, without $ signs. Press a symbol to insert it at the cursor.'), palSeg, palBox)),
      tile({ tint: TINTS[4], title: 'Result', icon: 'eye' }, h('div', { class: 'stack' }, mathbox, eqStatus,
        h('div', { class: 'opt-grid' },
          rangeField('Size', { min: 14, max: 72, step: 2, value: st.size, format: (v) => v + ' px', onInput: (v) => { st.size = v; persist(); paintEq() } }),
          field('Text colour', h('input', { type: 'color', value: st.color, 'aria-label': 'Text colour', oninput: (e) => { st.color = e.target.value; persist(); paintEq() } })),
          field('Background', segmented([['transparent', 'Transparent'], ['white', 'White']], st.bg, (v) => { st.bg = v; persist(); paintEq() }, 'Background'))),
        toggle('Display style (large, centred)', st.display, (v) => { st.display = v; persist(); paintEq() })))),
    tile({ tint: TINTS[3], title: 'Copy and export', icon: 'share-2' }, h('div', { class: 'stack' },
      h('div', { class: 'row' },
        button('Copy LaTeX', { icon: 'copy', variant: 'primary', onClick: () => copyText(eqIn.value) }),
        button('Copy MathML', { icon: 'code', onClick: need(async () => copyText(mathml(kx, eqIn.value, st.display))) }),
        button('Copy $$ block', { icon: 'braces', onClick: () => copyText(`$$\n${eqIn.value.trim()}\n$$`) })),
      h('div', { class: 'row' }, btnPng, btnSvg, btnPdf),
      h('div', { class: 'stu-hint' }, 'MathML pastes into Word and many web editors as an editable equation. PNG is rendered at 3x for crisp slides.'),
      h('div', { class: 'stu-hint', style: 'margin-top:2px' }, 'Try an example'),
      h('div', { class: 'chips' }, EXAMPLES.map(([n, t]) => h('button', { type: 'button', class: 'stu-chip-btn', onclick: () => { eqIn.value = t; st.eq = t; persist(); paintEq() } }, n))))))

  // ================= document =================
  const docIn = h('textarea', { class: 'textarea editor doc-editor', spellcheck: false, value: st.doc, 'aria-label': 'LaTeX document', oninput: (e) => { st.doc = e.target.value; persist(); renderDocSoon() } })
  const frame = h('iframe', { class: 'frame', title: 'Document preview', sandbox: 'allow-same-origin' })
  const docStatus = h('div')
  const docOut = h('div')
  const docProg = h('div')
  let lastHtml = ''
  let renderTok = 0
  async function renderDoc() {
    const tok = ++renderTok
    const raw = docIn.value
    if (!raw.trim()) { clear(docStatus, alert('info', 'Paste a LaTeX document, or load the sample.')); return }
    try {
      await script(`${LATEXJS}latex.js`)
      const L = window.latexjs
      const { src, notes } = prepareLatex(raw)
      const body = /\\begin\{document\}/.test(src) ? src : `\\documentclass{article}\n\\begin{document}\n${src}\n\\end{document}`
      const gen = new L.HtmlGenerator({ hyphenate: false })
      L.parse(body, { generator: gen })
      if (tok !== renderTok) return
      const doc = gen.htmlDocument(LATEXJS)
      const style = doc.createElement('style')
      style.textContent = `html,body{background:#fff}body{margin:0}@media print{@page{size:${PAGE[st.paper].css};margin:18mm}.body{width:auto!important;max-width:none!important;margin:0!important}}`
      doc.head.append(style)
      doc.querySelectorAll('script').forEach((el) => el.remove())
      lastHtml = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
      const fit = () => { try { frame.style.height = `${Math.max(520, frame.contentDocument.documentElement.scrollHeight + 8)}px` } catch { /* ignore */ } }
      frame.onload = () => { fit(); frame.contentDocument.fonts?.ready.then(fit); setTimeout(fit, 700) }
      frame.srcdoc = lastHtml
      clear(docStatus, notes.length ? alert('info', h('div', notes.map((n) => h('div', n)))) : null)
    } catch (e) {
      const line = e?.location?.start?.line
      clear(docStatus, alert('error', h('div', h('b', line ? `Line ${line}: ` : ''), String(e?.message || e).replace(/^.*?:\s*(?=unknown)/, '')), h('div', { class: 'small', style: 'margin-top:4px' }, 'latex.js covers core LaTeX only. Open "What is supported" below for the list.')))
    }
  }
  const renderDocSoon = debounce(renderDoc, 500)
  const printBtn = button('Print or save as PDF', { icon: 'printer', variant: 'primary', size: 'lg', onClick: () => {
    if (!lastHtml) return toast('Nothing to print yet', 'error')
    try { frame.contentWindow.focus(); frame.contentWindow.print() } catch { toast('Printing is blocked here. Use Download PDF instead.', 'error') }
  } })
  const pdfBtn = button('Download PDF', { icon: 'download', variant: 'secondary', size: 'lg' })
  pdfBtn.addEventListener('click', () => busy(pdfBtn, async () => {
    if (!lastHtml) throw new Error('Nothing to export yet. Fix the error above first.')
    const [pw, ph] = PAGE[st.paper].pt
    // render the document in a hidden frame as wide as the paper, then cut it into pages
    const tmp = h('iframe', { sandbox: 'allow-same-origin', title: 'Export', style: `position:fixed;left:-100000px;top:0;border:0;width:${PAGE[st.paper].w}px;height:1200px` })
    document.body.append(tmp)
    let canvas
    try {
      await new Promise((r) => { tmp.onload = r; tmp.srcdoc = lastHtml })
      const d = tmp.contentDocument
      try { await d.fonts.ready } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 400))
      tmp.style.height = `${d.documentElement.scrollHeight + 20}px`
      const box = (d.querySelector('.body') || d.body).getBoundingClientRect()
      const x = Math.max(0, Math.floor(box.left - 28)), w = Math.min(d.documentElement.clientWidth - x, Math.ceil(box.width + 56))
      canvas = await (await html2canvas())(d.body, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, x, y: 0, width: w, height: Math.ceil(box.bottom + 24), windowWidth: d.documentElement.clientWidth })
    } finally { tmp.remove() }
    const { PDFDocument } = await pdfLib()
    const m = 64
    const wpt = Math.min((canvas.width / 2) * 0.75, pw - 2 * m) // real size, like a LaTeX text block
    const pagePx = Math.floor(((ph - 2 * m) / wpt) * canvas.width)
    const pdf = await PDFDocument.create()
    for (const [y0, y1] of sliceCanvas(canvas, pagePx)) {
      const slice = document.createElement('canvas')
      slice.width = canvas.width; slice.height = y1 - y0
      const g = slice.getContext('2d')
      g.fillStyle = '#fff'; g.fillRect(0, 0, slice.width, slice.height)
      g.drawImage(canvas, 0, y0, canvas.width, y1 - y0, 0, 0, canvas.width, y1 - y0)
      const jpg = await pdf.embedJpg(await (await new Promise((r) => slice.toBlob(r, 'image/jpeg', 0.92))).arrayBuffer())
      const hpt = ((y1 - y0) / canvas.width) * wpt
      pdf.addPage([pw, ph]).drawImage(jpg, { x: (pw - wpt) / 2, y: ph - m - hpt, width: wpt, height: hpt })
    }
    download(new Blob([await pdf.save()], { type: 'application/pdf' }), 'document.pdf')
    clear(docOut, alert('success', `Saved ${pdf.getPageCount()} page${pdf.getPageCount() === 1 ? '' : 's'} as pictures. Use Print for a vector PDF with selectable text.`))
    confetti(pdfBtn, { count: 40 })
  }, { label: 'Building PDF', errorTo: docOut }))
  const htmlBtn = button('Download HTML', { icon: 'file-code', variant: 'ghost', onClick: () => { if (lastHtml) download(lastHtml, 'document.html', 'text/html') } })
  const paperSel = select([['a4', 'A4'], ['letter', 'US Letter']], st.paper, (v) => { st.paper = v; persist(); renderDoc() })
  const docView = h('div', { class: 'stack', hidden: st.mode !== 'doc' },
    h('div', { class: 'tool-split' },
      tile({ tint: TINTS[0], title: 'LaTeX source', icon: 'file-code', actions: button('Sample', { size: 'sm', variant: 'ghost', icon: 'wand-sparkles', onClick: () => { docIn.value = DOC_SAMPLE; st.doc = DOC_SAMPLE; persist(); renderDoc() } }) }, h('div', { class: 'stack' }, docIn, docStatus)),
      tile({ tint: TINTS[4], title: 'Preview', icon: 'eye' }, frame)),
    h('div', { class: 'row' }, printBtn, pdfBtn, htmlBtn, h('div', { style: 'min-width:130px' }, paperSel)), docOut,
    tile({ tint: TINTS[2], title: 'What is supported', icon: 'info' }, h('details', null, h('summary', 'Honest limits of the browser LaTeX engine'),
      h('ul', null,
        h('li', h('b', 'Works: '), 'sections, title and abstract, text styles (bold, italic, typewriter, sizes), itemize, enumerate, description, quote, center, simple tables (tabular), footnotes, \\newcommand, and all math through KaTeX.'),
        h('li', h('b', 'Converted: '), 'align, equation, gather and similar amsmath environments are shown unnumbered. \\label inside math is ignored.'),
        h('li', h('b', 'Not supported: '), 'packages (tikz, pgfplots, biblatex, beamer, listings, amsthm and most others), BibTeX citations, \\includegraphics from your computer, custom fonts and page-level layout such as geometry margins.'),
        h('li', h('b', 'Need full LaTeX? '), 'Use a complete engine such as Overleaf or a local TeX Live for documents that rely on packages.')))))

  root.append(stage('t-tex', h('div', { class: 'stack' }, h('div', { class: 'row' }, modeSeg), eqView, docView)))
  drawPalette(); paintEq()
  if (st.mode === 'doc') renderDoc()
}
