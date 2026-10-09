// Math equation OCR: a photo or screenshot of an equation becomes LaTeX (Claude vision, your own key), then edit it with a live KaTeX preview.
import { h, button, busy, dropzone, alert, clear, copyText, toast, field, preview, formatBytes, onCleanup } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, handoff, esc } from './_kit.js'
import { katexReady } from './_pages.js'

const CSS = `
.t-mocr .shot { max-width: 100%; max-height: 340px; border-radius: 12px; display: block; margin: 0 auto; object-fit: contain; background: #fff; }
.t-mocr .editor { width: 100%; min-height: 120px; font: 500 14.5px/1.6 var(--mono); resize: vertical; }
.t-mocr .mathbox { min-height: 120px; padding: 16px 10px; border-radius: 18px; border: 1px solid var(--border); background: #fff; color: #111; display: grid; place-items: center; overflow: auto; font-size: 26px; }
.t-mocr .mathbox .katex-display { margin: 0; }
.t-mocr .hist { display: grid; gap: 6px; }
.t-mocr .hist button { text-align: left; font: 500 12.5px var(--mono); padding: 8px 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-mocr .hist button:hover { border-color: var(--accent); color: var(--text); }
`

export const SYSTEM = 'You convert images of mathematics (typed, printed or handwritten) into accurate LaTeX. Transcribe exactly what is written; do not solve, simplify or correct it. Use standard LaTeX math commands that KaTeX supports (\\frac, \\sqrt, \\int, \\sum, \\begin{pmatrix}, \\begin{cases}, \\begin{aligned}). Do not include $ or $$ delimiters. If the image contains several equations, put them in one \\begin{aligned} ... \\end{aligned} block, one per line, separated by \\\\. Ignore text that is not mathematics unless it is part of an expression (use \\text{...}).'

export function mount(root) {
  toolStyle('mocr', CSS)
  root.append(ai.notice('Equation reading uses AI vision'))
  const hist = load('mocr:hist', [])
  const st = { file: null, latex: load('mocr:latex', '') }
  const out = h('div')
  const img = h('img', { class: 'shot', alt: 'Your equation', hidden: true })
  let url = null
  const setFile = (f) => {
    st.file = f
    if (url) URL.revokeObjectURL(url)
    url = URL.createObjectURL(f)
    img.src = url; img.hidden = false
    clear(out)
    convert.disabled = false
  }
  onCleanup(() => url && URL.revokeObjectURL(url))
  const dz = dropzone({ accept: 'image/*,.heic,.heif', label: 'Add a photo or screenshot of an equation', hint: 'JPG, PNG, WebP or HEIC. You can also paste a screenshot with Ctrl+V.', onFiles: ([f]) => setFile(f) })
  const hint = h('input', { class: 'input', type: 'text', placeholder: 'Optional hint, e.g. "handwritten matrix" or "chemistry subscripts"', 'aria-label': 'Hint for the reader' })
  const convert = button('Read the equation', { variant: 'primary', icon: 'scan-line', size: 'lg', disabled: true })
  const ta = h('textarea', { class: 'textarea editor', spellcheck: false, value: st.latex, 'aria-label': 'LaTeX', placeholder: 'LaTeX appears here. You can also type or paste your own and see it rendered.', oninput: () => { st.latex = ta.value; save('mocr:latex', st.latex); paint() } })
  const box = h('div', { class: 'mathbox' })
  const status = h('div')
  let kx = null
  async function paint() {
    kx ||= await katexReady()
    if (!ta.value.trim()) { clear(box, h('span', { class: 'muted', style: 'font-size:14px' }, 'The rendered equation shows here')); clear(status); return }
    try { box.innerHTML = kx.renderToString(ta.value, { displayMode: true, throwOnError: true, output: 'html', strict: 'ignore' }); clear(status) } catch (e) {
      clear(status, alert('warn', 'KaTeX could not render this yet: ' + String(e.message).replace(/^KaTeX parse error:\s*/, '').replace(/̲/g, '').replace(/\s+at position.*$/s, '') + '. Fix it in the box above.'))
    }
  }
  convert.addEventListener('click', () => busy(convert, async () => {
    if (!st.file) throw new Error('Add an image first.')
    if (!(await ai.ensureKey())) return
    clear(out)
    const res = await ai.ask({
      system: SYSTEM,
      prompt: `Transcribe the mathematics in this image into LaTeX.${hint.value.trim() ? ` Hint from the user: ${hint.value.trim()}` : ''}`,
      images: [st.file],
      json: { type: 'object', properties: { latex: { type: 'string' }, note: { type: 'string' } }, required: ['latex', 'note'], additionalProperties: false },
      effort: 'low', maxTokens: 4000,
    })
    const latex = String(res.latex || '').trim().replace(/^\$\$?|\$\$?$/g, '').trim()
    if (!latex) throw new Error('No equation was found in that image. Try a closer, sharper photo.')
    ta.value = latex; st.latex = latex; save('mocr:latex', latex)
    hist.unshift(latex); save('mocr:hist', [...new Set(hist)].slice(0, 6)); drawHist()
    paint()
    clear(out, alert('success', res.note ? `Done. ${res.note}` : 'Done. Check the rendered equation against your image and edit anything that is off.'))
  }, { label: 'Reading', errorTo: out }))

  const histBox = h('div', { class: 'hist' })
  function drawHist() {
    const list = load('mocr:hist', [])
    clear(histBox, list.map((l) => h('button', { type: 'button', title: l, onclick: () => { ta.value = l; st.latex = l; save('mocr:latex', l); paint() } }, l)))
    histTile.hidden = !list.length
  }
  const need = () => { if (!ta.value.trim()) { toast('Nothing to copy yet', 'error'); return false } return true }
  const histTile = tile({ tint: TINTS[5], title: 'Recent', icon: 'history' }, histBox)
  const left = h('div', { class: 'stack' }, tile({ tint: TINTS[0], title: 'Your image', icon: 'image' }, h('div', { class: 'stack' }, dz, img, hint, h('div', { class: 'row' }, convert))), out)
  const right = h('div', { class: 'stack' },
    tile({ tint: TINTS[4], title: 'LaTeX', icon: 'square-function' }, h('div', { class: 'stack' }, ta, box, status,
      h('div', { class: 'row' },
        button('Copy LaTeX', { variant: 'primary', icon: 'copy', onClick: () => need() && copyText(ta.value.trim()) }),
        button('Copy $$ block', { icon: 'braces', onClick: () => need() && copyText(`$$\n${ta.value.trim()}\n$$`) }),
        button('Copy MathML', { icon: 'code', onClick: async () => { if (!need()) return; kx ||= await katexReady(); try { copyText(/<math[\s\S]*<\/math>/.exec(kx.renderToString(ta.value, { displayMode: true, output: 'mathml', throwOnError: true, strict: 'ignore' }))[0]) } catch { toast('Fix the LaTeX first', 'error') } } }),
        button('Export as image or PDF', { icon: 'file-down', onClick: () => need() && handoff('latex-to-pdf', ta.value.trim()) })))),
    histTile)
  root.append(stage('t-mocr', h('div', { class: 'stu-bento' }, h('div', { class: 's5', style: 'min-width:0' }, left), h('div', { class: 's7', style: 'min-width:0' }, right))))
  drawHist(); paint()
}
