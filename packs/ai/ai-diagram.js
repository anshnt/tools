// Text to diagram: Claude writes Mermaid code, rendered live with mermaid (MIT). Edit the code by hand or with follow-up
// instructions, fix errors with AI, and export SVG or PNG.
import { h, button, field, select, segmented, toggle, textarea, clear, panel, split, row, download, copyButton, debounce, busy, icon } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { loadImage } from '../../lib/image.js'
import { injectStyle, runner, UNTRUSTED } from './_shared.js'

const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.esm.min.mjs'
let mermaidP
const loadMermaid = () => (mermaidP ??= import(MERMAID).then((m) => m.default).catch((e) => { mermaidP = null; throw new Error('Could not load the diagram engine. Check your connection and try again.', { cause: e }) }))

const TYPES = [['auto', 'Choose the best type'], ['flowchart', 'Flowchart'], ['sequenceDiagram', 'Sequence diagram'], ['classDiagram', 'Class diagram'], ['stateDiagram-v2', 'State diagram'], ['erDiagram', 'ER diagram'], ['gantt', 'Gantt chart'], ['mindmap', 'Mind map'], ['timeline', 'Timeline'], ['journey', 'User journey'], ['pie', 'Pie chart'], ['gitGraph', 'Git graph'], ['quadrantChart', 'Quadrant chart']]
const THEMES = [['default', 'Default'], ['neutral', 'Neutral (grey)'], ['forest', 'Forest'], ['dark', 'Dark']]
const EXAMPLES = ['User login flow with password reset', 'Sequence of a browser, API and database when placing an order', 'ER diagram for a library with books, members and loans', 'Gantt chart for a 4 week website launch', 'Mind map of effective study techniques']
const CSS = `
.ai-dia { background: #fff; border: 1px solid var(--border); border-radius: 14px; min-height: 260px; padding: 12px; overflow: auto; display: grid; place-items: center; }
.ai-dia svg { max-width: 100%; height: auto; display: block; }
.ai-dia .ai-err { color: #b42318; font-size: 13px; white-space: pre-wrap; align-self: start; justify-self: start; }
.ai-dia-empty { color: #667085; text-align: center; font-size: 14px; display: grid; gap: 8px; place-items: center; }
`

/** Strip Markdown fences and chatter around Mermaid code. Exported for tests. */
export function extractMermaid(text) {
  const fenced = text.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).replace(/^\s*mermaid\s*\n/i, '').trim()
}

/** SVG markup -> PNG Blob at `scale` times its natural (viewBox) size, on a white or transparent background. */
export async function svgToPng(svgText, { scale = 2, background = '#ffffff' } = {}) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const el = doc.documentElement
  const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
  const w = vb.length === 4 ? vb[2] : parseFloat(el.getAttribute('width')) || 800
  const hh = vb.length === 4 ? vb[3] : parseFloat(el.getAttribute('height')) || 600
  const outW = Math.min(8000, Math.round(w * scale)), outH = Math.round(outW * (hh / w))
  el.setAttribute('width', outW); el.setAttribute('height', outH); el.style.maxWidth = 'none'
  if (!el.getAttribute('xmlns')) el.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const blob = new Blob([new XMLSerializer().serializeToString(el)], { type: 'image/svg+xml' })
  const img = await loadImage(blob)
  const c = document.createElement('canvas'); c.width = outW; c.height = outH
  const ctx = c.getContext('2d')
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, outW, outH) }
  ctx.drawImage(img, 0, 0, outW, outH)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the PNG.'))), 'image/png'))
}

export function mount(root, { signal }) {
  injectStyle()
  if (!document.getElementById('ai-dia-style')) document.head.append(h('style', { id: 'ai-dia-style' }, CSS))
  let svgText = ''
  let renderSeq = 0
  const status = h('div')
  const stage = h('div', { class: 'ai-dia', 'aria-live': 'polite' })
  const empty = () => clear(stage, h('div', { class: 'ai-dia-empty' }, icon('workflow'), h('strong', 'Your diagram appears here'), h('span', 'Describe a process, then press Draw diagram.')))
  const prompt = textarea({ rows: 4, placeholder: 'Describe what to draw, e.g. "Customer places an order, payment is checked, then it is shipped or refunded".', 'aria-label': 'Describe the diagram', maxlength: 4000 })
  const type = select(TYPES, 'auto')
  const dir = segmented([['TD', 'Top to bottom'], ['LR', 'Left to right']], 'TD', null, 'Direction')
  const theme = select(THEMES, 'default', () => render())
  const code = textarea({ rows: 12, mono: true, spellcheck: false, 'aria-label': 'Mermaid code', placeholder: 'Mermaid code appears here. You can edit it and the diagram updates.' })
  const editMode = toggle('Edit the current diagram instead of starting over', true)
  const go = button('Draw diagram', { icon: 'workflow', variant: 'primary', size: 'lg' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Drawing' })
  const fixBtn = button('Fix with AI', { icon: 'wrench', size: 'sm' })
  fixBtn.hidden = true
  const png = select([['2', 'PNG 2x'], ['1', 'PNG 1x'], ['4', 'PNG 4x']], '2')
  const bg = select([['#ffffff', 'White'], ['', 'Transparent']], '#ffffff')
  const dlSvg = button('SVG', { icon: 'download', size: 'sm', onClick: () => svgText && download(svgText, 'diagram.svg', 'image/svg+xml') })
  const dlPng = button('PNG', { icon: 'download', size: 'sm', onClick: (e) => svgText && busy(e.currentTarget, async () => download(await svgToPng(svgText, { scale: +png.value, background: bg.value }), 'diagram.png'), 'PNG') })
  const tools = h('div', { class: 'row', style: 'gap:8px', hidden: true }, dlSvg, dlPng, png, bg, copyButton(() => code.value, 'Copy code'))
  let lastError = ''

  async function render() {
    const src = code.value.trim()
    const mine = ++renderSeq
    fixBtn.hidden = true; lastError = ''
    if (!src) { svgText = ''; tools.hidden = true; empty(); return }
    try {
      const m = await loadMermaid()
      m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme.value, htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true }, fontFamily: 'Arial, Helvetica, sans-serif' })
      const id = `aid${Date.now().toString(36)}${mine}`
      let out
      try { out = await m.render(id, src) } finally { document.getElementById(`d${id}`)?.remove(); document.getElementById(id)?.remove() }
      if (mine !== renderSeq) return
      svgText = out.svg
      stage.innerHTML = out.svg
      tools.hidden = false
    } catch (e) {
      if (mine !== renderSeq) return
      svgText = ''; tools.hidden = true
      lastError = (e?.message || String(e)).split('\n').slice(0, 6).join('\n')
      clear(stage, h('div', { class: 'ai-err' }, h('strong', 'The diagram code has an error'), '\n', lastError))
      fixBtn.hidden = false
    }
  }
  const renderSoon = debounce(render, 350)
  code.addEventListener('input', renderSoon)

  const system = () => `You write Mermaid diagrams. ${UNTRUSTED} Reply with ONLY the Mermaid code: no Markdown fences, no explanation. The code must be valid for Mermaid 11: simple node ids (A, B1, step2), short labels, quote any label that contains parentheses, brackets, colons or punctuation, never use the word "end" as a bare label, and keep it readable (at most about 25 nodes unless asked for more).`

  async function ask(content, sig) {
    const text = await ai.ask({ system: system(), messages: [{ role: 'user', content: [ai.textBlock(content)] }], effort: 'low', signal: sig, onText: (t) => { code.value = extractMermaid(t) } })
    code.value = extractMermaid(text)
    await render()
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    const p = prompt.value.trim()
    if (!p) throw new Error('Describe the diagram first.')
    const existing = code.value.trim()
    const t = type.value === 'auto' ? 'Choose the diagram type that fits best.' : `Use diagram type ${type.value}.`
    const d = (type.value === 'auto' || type.value === 'flowchart') ? ` For flowcharts use direction ${dir.value}.` : ''
    if (existing && editMode.input.checked) await ask(`Here is the current Mermaid diagram:\n\n${existing}\n\nChange it as follows and return the full updated code: ${p}`, sig)
    else await ask(`Draw a diagram of: ${p}\n${t}${d}`, sig)
  }, { label: 'Drawing' }))

  fixBtn.addEventListener('click', () => run.go(async (sig) => { await ask(`This Mermaid code fails to render.\n\nError: ${lastError}\n\nCode:\n${code.value}\n\nReturn the corrected full code.`, sig) }, { label: 'Fixing' }))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' },
        field('What should the diagram show?', prompt),
        h('div', { class: 'ai-chips' }, EXAMPLES.map((ex) => h('button', { type: 'button', class: 'ai-chip', onclick: () => { prompt.value = ex; editMode.input.checked = false; prompt.focus() } }, icon('sparkles'), h('span', ex)))),
        h('div', { class: 'grid-auto' }, field('Diagram type', type), field('Style', theme)),
        field('Direction (flowcharts)', dir),
        editMode,
        row(go, run.stop, fixBtn), status,
        field('Mermaid code', code, 'Edit it directly: the diagram redraws as you type.'))),
      h('div', { class: 'stack' }, stage, tools), 'wide-right')))
  empty()
}
