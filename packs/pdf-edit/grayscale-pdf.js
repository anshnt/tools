// Grayscale PDF: black and white for printing. Pages are redrawn as images (so text stops being selectable), with a before/after slider.
import { h, icon, busy, progress, field, button, segmented, select, rangeField, alert, formatBytes, yieldToMain } from '../../lib/ui.js'
import { renderPage, pageSize, savePdf } from '../../lib/pdf.js'
import { toBlob } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, pageRange, plural, dock, copyInfo } from './_shared.js'
import { pageNav } from './_overlay.js'

const CSS = `
.pe-compare { position: relative; width: 100%; max-width: 520px; margin: 0 auto; border-radius: 6px; overflow: hidden; background: #fff; box-shadow: 0 24px 60px -28px rgba(16, 16, 40, .55), 0 0 0 1px var(--border); user-select: none; touch-action: pan-y; }
.pe-compare canvas { display: block; width: 100%; height: auto; }
.pe-compare .pe-after { position: absolute; inset: 0; clip-path: inset(0 0 0 var(--p, 50%)); }
.pe-compare .pe-after canvas { height: 100%; }
.pe-compare .pe-split { position: absolute; top: 0; bottom: 0; left: var(--p, 50%); width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.25), 0 0 14px rgba(0,0,0,.35); pointer-events: none; }
.pe-compare .pe-split::after { content: "\\2194"; position: absolute; top: 50%; left: 50%; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; display: grid; place-items: center; background: var(--accent); color: #fff; font-size: 18px; box-shadow: 0 8px 18px -6px var(--accent); }
.pe-compare input[type=range] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: ew-resize; margin: 0; }
.pe-compare .pe-tag { position: absolute; top: 10px; padding: 3px 9px; border-radius: 99px; font-size: 11.5px; font-weight: 600; background: rgba(0,0,0,.6); color: #fff; pointer-events: none; }
.pe-compare .pe-tag.l { left: 10px; } .pe-compare .pe-tag.r { right: 10px; }
.pe-gwrap { display: flex; flex-direction: column; gap: 10px; align-items: center; min-width: 0; }
@media (min-width: 901px) { .pe-gwrap.pe-sticky { position: sticky; top: calc(var(--header-h) + 16px); } }
`

/** In place: turn RGBA pixels into gray (luma), or pure black and white around `threshold` (0-255) when set. */
export function grayPixels(data, threshold) {
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const v = threshold == null ? l : l < threshold ? 0 : 255
    data[i] = data[i + 1] = data[i + 2] = v
  }
}
export function toGray(canvas, threshold) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  grayPixels(img.data, threshold)
  ctx.putImageData(img, 0, 0)
  return canvas
}
const copyCanvas = (c) => { const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; o.getContext('2d').drawImage(c, 0, 0); return o }

export function mount(root) {
  css('pe-gray', CSS)
  pdfWorkspace(root, {
    label: 'Drop a color PDF to convert',
    icon: 'contrast',
    onLoad(src, ws) {
      const total = src.numPages
      const result = h('div'), prog = progress()
      let page = 1, color = null
      const mode = segmented([['gray', 'Grayscale'], ['bw', 'Black and white']], 'gray', () => { sync(); drawAfter() }, 'Mode')
      const dpi = select([['72', '72 dpi, smallest'], ['100', '100 dpi'], ['150', '150 dpi, standard'], ['200', '200 dpi, sharp'], ['300', '300 dpi, print']], '150')
      const quality = rangeField('Image quality', { min: 40, max: 95, value: 78, format: (v) => `${v}%` })
      const thr = rangeField('Black and white threshold', { min: 60, max: 220, value: 160, format: (v) => v, hint: 'Higher makes more of the page black.', onInput: () => drawAfter() })
      const range = pageRange(total, { label: 'Pages to convert', onChange: () => update() })
      const btn = button('Convert to grayscale', { icon: 'contrast', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      const nav = pageNav(total, (n) => { page = n; loadPreview() })
      const before = h('canvas'), after = h('canvas')
      const slider = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Compare color and converted page', oninput: () => cmp.style.setProperty('--p', `${slider.value}%`) })
      const cmp = h('div', { class: 'pe-compare' }, before, h('div', { class: 'pe-after' }, after), h('span', { class: 'pe-split' }), h('span', { class: 'pe-tag l' }, 'Original'), h('span', { class: 'pe-tag r' }, 'Converted'), slider)

      async function loadPreview() {
        cmp.style.opacity = '.6'
        try {
          color = await renderPage(src.pdf, page, { scale: 1.1 })
          before.width = after.width = color.width; before.height = after.height = color.height
          before.getContext('2d').drawImage(color, 0, 0)
          drawAfter()
        } finally { cmp.style.opacity = '' }
      }
      function drawAfter() {
        if (!color) return
        const c = copyCanvas(color)
        toGray(c, mode.value === 'bw' ? thr.input.valueAsNumber : null)
        after.getContext('2d').drawImage(c, 0, 0)
      }
      function sync() { thr.hidden = mode.value !== 'bw'; quality.hidden = mode.value === 'bw'; btn.querySelector('span').textContent = mode.value === 'bw' ? 'Convert to black and white' : 'Convert to grayscale' }
      function update() {
        const err = range.error()
        btn.disabled = !!err
        let n = 0
        try { n = range.pages().length } catch { /* shown by the control */ }
        bar.text(err || h('span', h('b', plural(n, 'page')), ' will be redrawn at ', h('b', `${dpi.value} dpi`), '. Text becomes part of the picture.'))
      }
      dpi.addEventListener('change', update)

      async function run() {
        const targets = new Set(range.pages())
        const bw = mode.value === 'bw'
        await busy(btn, async () => {
          const { PDFDocument } = await pdfLib()
          const base = await src.edit()
          const out = await PDFDocument.create()
          const scale = +dpi.value / 72
          let n = 0
          for (let p = 1; p <= total; p++) {
            prog.set((p - 1) / total, `Page ${p} of ${total}`)
            if (!targets.has(p)) { const [pg] = await out.copyPages(base, [p - 1]); out.addPage(pg); continue }
            const { width, height } = await pageSize(src.pdf, p)
            const c = await renderPage(src.pdf, p, { scale })
            toGray(c, bw ? thr.input.valueAsNumber : null)
            const jpg = await out.embedJpg(await (await toBlob(c, 'image/jpeg', bw ? 0.9 : quality.input.valueAsNumber / 100)).arrayBuffer())
            out.addPage([width, height]).drawImage(jpg, { x: 0, y: 0, width, height })
            c.width = c.height = 0
            n++
            await yieldToMain()
          }
          copyInfo(base, out)
          const blob = await savePdf(out)
          await showResult(result, {
            blob, name: outName(src.file, bw ? 'black-white' : 'grayscale'), title: bw ? 'Black and white PDF ready' : 'Grayscale PDF ready', lead: `${plural(n, 'page')} converted at ${dpi.value} dpi.`,
            facts: [{ label: 'Pages converted', value: n }, { label: 'Before', value: formatBytes(src.size) }, { label: 'After', value: formatBytes(blob.size), tone: blob.size < src.size ? 'good' : undefined }],
            note: 'The pages are now pictures, so the text can no longer be selected or searched. Run the OCR tool on the result if you need searchable text.', again: ws.reset,
          })
        }, { label: 'Converting', errorTo: result, progress: prog })
      }

      sync(); update(); loadPreview()
      const panel = h('section', { class: 'panel stack' }, heading('contrast', 'Convert'), mode, field('Resolution', dpi, 'Higher is sharper but makes a bigger file.'), quality, thr, range,
        alert('info', 'Pages are redrawn as images. Text will not be selectable afterwards.'))
      return [h('div', { class: 'tool-split wide-right' }, panel, h('div', { class: 'pe-gwrap pe-sticky' }, nav, cmp)), prog.el, result, bar]
    },
  })
}
