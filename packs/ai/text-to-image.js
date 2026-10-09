// Text to image (SVG art): Claude draws an editable vector illustration from a description. Honest about what it is:
// SVG illustrations, icons and logos, not photographs. Iterate with follow-up edits, export SVG or PNG at a chosen size.
import { h, button, field, select, toggle, textarea, alert, clear, panel, split, row, download, copyButton, busy, icon, onCleanup } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { dompurify } from '../../lib/libs.js'
import { loadImage } from '../../lib/image.js'
import { injectStyle, runner, UNTRUSTED } from './_shared.js'

const STYLES = [
  ['flat', 'Flat illustration', 'flat vector illustration with clean shapes, soft gradients and a cohesive palette'],
  ['icon', 'App icon', 'simple bold app icon: one clear symbol, rounded geometry, subtle gradient, centered with generous padding'],
  ['line', 'Line art', 'monoline line art with consistent stroke width, no fills except white'],
  ['iso', 'Isometric', 'isometric 3D-style illustration built from shaded polygons'],
  ['logo', 'Minimal logo', 'minimal logo mark with a strong silhouette and at most 3 colors'],
  ['cartoon', 'Cartoon', 'friendly cartoon with bold outlines, expressive shapes and bright colors'],
  ['pixel', 'Pixel art', 'pixel art made of square rects on a 32x32 grid scaled up, limited palette'],
  ['poster', 'Poster / landscape scene', 'layered scenic poster with overlapping hills, sky gradient, sun or moon and depth through atmospheric color'],
  ['pattern', 'Seamless-style pattern', 'repeating decorative pattern made of simple geometric motifs'],
]
const ASPECTS = [['1024 1024', 'Square (1:1)'], ['1024 768', 'Landscape (4:3)'], ['1280 720', 'Wide (16:9)'], ['768 1024', 'Portrait (3:4)']]
const EXAMPLES = ['A cozy cabin in a snowy pine forest at dusk', 'A friendly robot watering a plant', 'A rocket launching over a calm blue sea', 'A coffee cup with steam, minimal logo']
const CSS = `
.ai-art { border: 1px solid var(--border); border-radius: 14px; background: var(--checker); min-height: 280px; display: grid; place-items: center; overflow: hidden; padding: 10px; }
.ai-art img { display: block; width: 100%; max-width: 640px; max-height: 62vh; height: auto; object-fit: contain; }
.ai-art .ai-wait { background: var(--surface); padding: 18px; text-align: center; color: var(--muted); border-radius: 12px; font-size: 14px; display: grid; gap: 8px; place-items: center; }
.ai-vers { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 6px; }
.ai-ver { flex: none; width: 64px; height: 64px; border-radius: 10px; border: 2px solid var(--border); background: var(--checker); padding: 0; cursor: pointer; overflow: hidden; }
.ai-ver[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.ai-ver img { width: 100%; height: 100%; object-fit: contain; display: block; }
`

const NS = 'http://www.w3.org/2000/svg'
/** Pull the <svg>...</svg> document out of a reply (drops fences and chatter). Exported for tests. */
export function extractSvg(text) {
  const m = text.match(/<svg[\s\S]*<\/svg>/i)
  return m ? m[0] : ''
}

let purify
/** Sanitize SVG markup: no scripts, no foreign content, no external references. Returns '' if nothing usable remains. */
export async function cleanSvg(raw) {
  purify ??= await dompurify()
  let s = purify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['image', 'foreignObject', 'script', 'iframe', 'a'], FORBID_ATTR: ['onload', 'onclick', 'href', 'xlink:href'] })
  s = s.replace(/@import[^;}]*[;}]/gi, '').replace(/url\(\s*['"]?\s*(?:https?:|\/\/|data:)[^)]*\)/gi, 'none')
  if (!/<svg[\s>]/i.test(s)) return ''
  const doc = new DOMParser().parseFromString(s, 'text/html')
  const el = doc.body.querySelector('svg')
  if (!el) return ''
  el.setAttribute('xmlns', NS)
  if (!el.getAttribute('viewBox')) {
    const w = parseFloat(el.getAttribute('width')) || 1024
    const hh = parseFloat(el.getAttribute('height')) || 1024
    el.setAttribute('viewBox', `0 0 ${w} ${hh}`)
  }
  el.removeAttribute('width'); el.removeAttribute('height')
  return el.outerHTML
}

/** Rasterize SVG markup to a PNG Blob `width` pixels wide (height follows the viewBox). */
export async function svgToPng(svg, width) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const el = doc.documentElement
  const vb = el.getAttribute('viewBox').split(/[\s,]+/).map(Number)
  const w = Math.max(16, Math.min(8192, Math.round(width)))
  const hh = Math.round(w * (vb[3] / vb[2]))
  el.setAttribute('width', w); el.setAttribute('height', hh)
  const img = await loadImage(new Blob([new XMLSerializer().serializeToString(el)], { type: 'image/svg+xml' }))
  const c = document.createElement('canvas'); c.width = w; c.height = hh
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, w, hh)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the PNG.'))), 'image/png'))
}

export function buildSystem({ style, aspect, palette, transparent }) {
  const [w, hh] = aspect.split(' ')
  const st = STYLES.find((s) => s[0] === style)?.[2] || STYLES[0][2]
  return `You are an expert SVG illustrator. Reply with exactly ONE self-contained SVG document and nothing else: no Markdown fences, no explanation.
Requirements: root <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hh}"> with no width or height attributes. Use only vector elements: path, rect, circle, ellipse, polygon, line, g, defs, linearGradient, radialGradient, clipPath, mask, filter (feGaussianBlur, feDropShadow are fine), and <text> only when the user asks for words (font-family sans-serif). No <script>, no <image>, no <foreignObject>, no external links or fonts, no CSS animation.
Art direction: ${st}. Compose with a clear focal point and 5 percent margins; add depth with gradients, layering and soft shadows; keep shapes tidy and symmetrical where natural; give elements ids. ${transparent ? 'The background must be transparent: do not draw a background rectangle.' : 'Include a pleasing full-bleed background.'}${palette ? ` Use this color palette: ${palette}.` : ''}
Keep it under about 9000 tokens: favor fewer, well-chosen shapes over many tiny ones. ${UNTRUSTED}`
}

export function mount(root, { signal }) {
  injectStyle()
  if (!document.getElementById('ai-art-style')) document.head.append(h('style', { id: 'ai-art-style' }, CSS))
  const versions = [] // {svg, prompt}
  let current = -1
  let msgs = [] // conversation for edits
  const urls = new Set()
  const status = h('div')
  const stage = h('div', { class: 'ai-art', 'aria-live': 'polite' })
  const vers = h('div', { class: 'ai-vers' })
  const prompt = textarea({ rows: 4, placeholder: 'Describe the picture, e.g. "A fox sitting on a hill under a crescent moon".', 'aria-label': 'Describe the picture', maxlength: 3000 })
  const edit = textarea({ rows: 2, placeholder: 'Ask for a change, e.g. "make the sky purple and add stars".', 'aria-label': 'Edit instruction', maxlength: 1500 })
  const style = select(STYLES.map((s) => [s[0], s[1]]), 'flat')
  const aspect = select(ASPECTS, '1024 1024')
  const palette = h('input', { class: 'input', placeholder: 'e.g. teal, coral, cream (optional)', 'aria-label': 'Colors', maxlength: 120 })
  const transparent = toggle('Transparent background', false)
  const go = button('Draw', { icon: 'image-plus', variant: 'primary', size: 'lg' })
  const apply = button('Apply change', { icon: 'wand-sparkles', variant: 'primary' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Drawing' })
  const run2 = runner({ btn: apply, errorTo: status, signal, label: 'Editing' })
  const size = select([['512', '512 px wide'], ['1024', '1024 px wide'], ['2048', '2048 px wide'], ['4096', '4096 px wide']], '1024')
  const codeArea = textarea({ rows: 8, mono: true, spellcheck: false, 'aria-label': 'SVG code' })
  const result = h('div', { class: 'stack', hidden: true })

  const urlFor = (svg) => { const u = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); urls.add(u); return u }
  onCleanup(() => { for (const u of urls) URL.revokeObjectURL(u) })
  const placeholder = () => clear(stage, h('div', { class: 'ai-wait' }, icon('image-plus'), h('strong', { style: 'color:var(--text-2)' }, 'Your illustration appears here'), h('span', 'Describe a picture and press Draw.')))
  const wait = (msg) => { const t = h('span', msg); clear(stage, h('div', { class: 'ai-wait' }, h('span', { class: 'spinner' }), t)); return t }

  function show(i) {
    current = i
    const v = versions[i]
    clear(stage, h('img', { src: urlFor(v.svg), alt: v.prompt.slice(0, 120) }))
    codeArea.value = v.svg
    clear(vers, versions.map((x, k) => h('button', { type: 'button', class: 'ai-ver', 'aria-pressed': String(k === i), 'aria-label': `Version ${k + 1}`, title: `Version ${k + 1}`, onclick: () => show(k) }, h('img', { src: urlFor(x.svg), alt: '' }))))
    vers.hidden = versions.length < 2
    result.hidden = false
  }

  async function draw(sig, messages, label) {
    const note = wait('Drawing...')
    const text = await ai.ask({
      system: buildSystem({ style: style.value, aspect: aspect.value, palette: palette.value.trim(), transparent: transparent.input.checked }),
      messages, effort: 'low', maxTokens: 24000, signal: sig, onText: (t) => { note.textContent = `Drawing... ${t.length.toLocaleString()} characters of SVG so far` },
    })
    const raw = extractSvg(text)
    const svg = raw ? await cleanSvg(raw) : ''
    if (!svg) throw new Error('The AI did not return a usable SVG. Try again, or describe the picture a bit differently.')
    msgs = [...messages, { role: 'assistant', content: raw }]
    versions.push({ svg, prompt: label })
    show(versions.length - 1)
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    const p = prompt.value.trim()
    if (p.length < 3) throw new Error('Describe the picture first.')
    versions.length = 0
    try { await draw(sig, [{ role: 'user', content: `Draw: ${p}` }], p) } catch (e) { if (!versions.length) { result.hidden = true; placeholder() } else show(current); throw e }
  }, { label: 'Drawing' }))

  apply.addEventListener('click', () => run2.go(async (sig) => {
    const p = edit.value.trim()
    if (!p) throw new Error('Say what to change first.')
    if (!msgs.length || current < 0) throw new Error('Draw a picture first.')
    // continue from the version on screen, so edits can branch from an earlier version
    const base = [{ role: 'user', content: `Draw: ${versions[0].prompt}` }, { role: 'assistant', content: versions[current].svg }]
    try { await draw(sig, [...base, { role: 'user', content: `Change it as follows and return the full updated SVG: ${p}` }], p); edit.value = '' } catch (e) { show(current); throw e }
  }, { label: 'Editing' }))

  codeArea.addEventListener('change', async () => {
    const svg = await cleanSvg(extractSvg(codeArea.value))
    if (!svg) return clear(status, alert('error', 'That SVG code could not be used.'))
    clear(status)
    versions.push({ svg, prompt: 'Edited code' }); show(versions.length - 1)
  })

  const dlSvg = button('SVG', { icon: 'download', size: 'sm', onClick: () => download(versions[current].svg, 'illustration.svg', 'image/svg+xml') })
  const dlPng = button('PNG', { icon: 'download', size: 'sm', onClick: (e) => busy(e.currentTarget, async () => download(await svgToPng(versions[current].svg, +size.value), `illustration-${size.value}.png`), 'PNG') })
  const actions = h('div', { class: 'row', style: 'gap:8px' }, dlSvg, dlPng, size, copyButton(() => versions[current].svg, 'Copy SVG code'))

  result.append(vers, actions,
    panel(h('div', { class: 'stack' }, field('Change it', edit), row(apply, run2.stop))),
    h('details', { class: 'panel', style: 'padding:12px 16px' }, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'SVG code (editable)'), h('div', { style: 'margin-top:10px' }, codeArea)))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    alert('info', h('strong', 'Vector art, not photos. '), 'AI writes SVG code, so you get crisp illustrations, icons, logos and scenes that you can edit and scale. It cannot make photographs or realistic faces.'),
    split(
      panel(h('div', { class: 'stack' },
        field('What should it draw?', prompt),
        h('div', { class: 'ai-chips' }, EXAMPLES.map((ex) => h('button', { type: 'button', class: 'ai-chip', onclick: () => { prompt.value = ex; prompt.focus() } }, icon('sparkles'), h('span', ex)))),
        h('div', { class: 'grid-auto' }, field('Style', style), field('Shape', aspect)),
        field('Colors', palette), transparent,
        row(go, run.stop), status)),
      h('div', { class: 'stack' }, stage, result), 'wide-right')))
  placeholder()
}
