// Add watermark to PDF: text or image, opacity, rotation, centred / positioned / tiled, page range, with a live preview.
import { h, icon, busy, progress, input, field, button, segmented, rangeField, select, toggle, dropzone, alert, formatBytes, toast, errorMessage } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { loadImage, toCanvas, toBlob, fitSize } from '../../lib/image.js'
import { pdfWorkspace, showResult, outName, css, heading, pageRange, plural, dock, pageGeom } from './_shared.js'
import { createStage, pageNav } from './_overlay.js'
import { stamper, sendToBack, tileCentres, anchorCentre, previewLayer, cssFont, FAMILIES } from './_stamp.js'

const CSS = `
.pe-pos { display: grid; grid-template-columns: repeat(3, 34px); gap: 5px; }
.pe-pos button { width: 34px; height: 34px; border-radius: 10px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; display: grid; place-items: center; transition: all .2s var(--spring); padding: 0; }
.pe-pos button::after { content: ""; width: 8px; height: 8px; border-radius: 3px; background: var(--border-strong); transition: all .2s; }
.pe-pos button:hover { border-color: var(--accent); transform: scale(1.08); }
.pe-pos button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.pe-pos button[aria-pressed="true"]::after { background: var(--accent); transform: scale(1.4); }
.pe-colorrow { display: flex; gap: 8px; align-items: center; }
.pe-prevwrap { display: flex; flex-direction: column; gap: 10px; align-items: center; min-width: 0; }
`

/** Where the watermark goes on a page of pw x ph points. Shared by the preview and the saved file. */
export function layout(pw, ph, bw, bh, o) {
  if (o.mode === 'tile') return tileCentres(pw, ph, bw, bh, { angle: o.angle, gapX: o.gap / 100, gapY: o.gap / 100 })
  return [anchorCentre(o.pos, pw, ph, bw, bh, 28)]
}

export function mount(root) {
  css('pe-watermark', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF to watermark',
    icon: 'stamp',
    onLoad(src, ws) {
      const total = src.numPages
      const result = h('div'), prog = progress()
      let kind = 'text', imgCanvas = null, pos = 'mc', page = 1
      const text = input({ value: 'CONFIDENTIAL', 'aria-label': 'Watermark text', oninput: () => redraw() })
      const family = select(Object.keys(FAMILIES), 'Helvetica', () => redraw())
      const bold = toggle('Bold', true, () => redraw()), italic = toggle('Italic', false, () => redraw())
      const size = rangeField('Size', { min: 12, max: 220, value: 72, format: (v) => `${v} pt`, onInput: () => redraw() })
      const color = h('input', { type: 'color', class: 'input', value: '#e5484d', 'aria-label': 'Colour', oninput: () => redraw() })
      const imgW = rangeField('Width on the page', { min: 10, max: 100, value: 50, format: (v) => `${v}%`, onInput: () => redraw() })
      const opacity = rangeField('Opacity', { min: 5, max: 100, value: 30, format: (v) => `${v}%`, onInput: () => redraw() })
      const angle = rangeField('Rotation', { min: -90, max: 90, value: 45, format: (v) => `${v}°`, onInput: () => redraw() })
      const gap = rangeField('Spacing', { min: 0, max: 300, value: 80, format: (v) => `${v}%`, onInput: () => redraw() })
      const mode = segmented([['single', 'One'], ['tile', 'Tiled']], 'single', () => { syncUi(); redraw() }, 'Layout')
      const behind = toggle('Put it behind the page content', false, undefined)
      const range = pageRange(total, { label: 'Pages', onChange: () => update() })
      const imgZone = dropzone({ accept: 'image/*,.heic,.heif', compact: true, paste: false, label: 'Choose a logo or image (PNG with transparency works best)', onFiles: async ([f]) => {
        try {
          const img = await loadImage(f)
          const s = fitSize(img.naturalWidth, img.naturalHeight, 1600, 1600)
          imgCanvas = toCanvas(img, s.width, s.height)
          imgName.textContent = f.name
          redraw(); update()
        } catch (e) { toast(errorMessage(e), 'error') }
      } })
      const imgName = h('small', { class: 'field-hint' })
      const posBtns = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'].map((p) => h('button', { type: 'button', 'aria-label': `Position ${p}`, 'aria-pressed': String(p === pos), onclick: () => { pos = p; posBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'][i] === pos))); redraw() } }))
      const posBox = field('Position', h('div', { class: 'pe-pos', role: 'group', 'aria-label': 'Position on the page' }, posBtns))
      const kindSeg = segmented([['text', 'Text'], ['image', 'Image']], 'text', (v) => { kind = v; if (v === 'image' && angle.input.valueAsNumber === 45) angle.set(0); if (v === 'text' && angle.input.valueAsNumber === 0) angle.set(45); syncUi(); redraw(); update() }, 'Watermark type')
      const textBox = h('div', { class: 'stack' }, field('Text', text), h('div', { class: 'grid-2' }, field('Font', family), field('Colour', h('div', { class: 'pe-colorrow' }, color))), h('div', { class: 'row' }, bold, italic), size)
      const imageBox = h('div', { class: 'stack' }, imgZone, imgName, imgW)
      const tileBox = gap
      const btn = button('Add watermark', { icon: 'stamp', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      const stage = createStage({ pdf: src.pdf, maxWidth: 520 })
      const nav = pageNav(total, async (n) => { page = n; await stage.show(n) })
      const read = () => ({
        kind, text: text.value, family: family.value, bold: bold.input.checked, italic: italic.input.checked, size: size.input.valueAsNumber, color: color.value,
        opacity: opacity.input.valueAsNumber / 100, angle: angle.input.valueAsNumber, mode: mode.value, gap: gap.input.valueAsNumber, pos, widthPct: imgW.input.valueAsNumber / 100,
      })
      const boxOf = (o, pw) => {
        if (o.kind === 'image' && imgCanvas) { const w = pw * o.widthPct; return { bw: w, bh: w * imgCanvas.height / imgCanvas.width } }
        return { bw: Math.max(8, preview.measure(o.text, o)), bh: o.size * 1.2 }
      }
      const preview = previewLayer(stage, (ctx, st) => {
        const o = read()
        if ((o.kind === 'text' && !o.text.trim()) || (o.kind === 'image' && !imgCanvas)) return
        const { bw, bh } = boxOf(o, st.pw)
        ctx.globalAlpha = o.opacity
        for (const { cx, cy } of layout(st.pw, st.ph, bw, bh, o)) {
          ctx.save(); ctx.translate(cx, cy); ctx.rotate((-o.angle * Math.PI) / 180)
          if (o.kind === 'image') ctx.drawImage(imgCanvas, -bw / 2, -bh / 2, bw, bh)
          else { ctx.font = cssFont(o, o.size); ctx.fillStyle = o.color; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(o.text.replace(/\n/g, ' '), 0, o.size * 0.3) }
          ctx.restore()
        }
      })
      const mctx = document.createElement('canvas').getContext('2d')
      preview.measure = (t, o) => { mctx.font = cssFont(o, 100); return mctx.measureText(t.replace(/\n/g, ' ')).width / 100 * o.size }
      const redraw = () => { preview.redraw(); update() }
      function syncUi() {
        textBox.hidden = kind !== 'text'; imageBox.hidden = kind !== 'image'
        const tile = mode.value === 'tile'
        posBox.hidden = tile; tileBox.hidden = !tile
      }
      function update() {
        const err = range.error()
        const miss = kind === 'text' ? (!text.value.trim() ? 'Type the watermark text.' : '') : (!imgCanvas ? 'Choose an image to use as the watermark.' : '')
        btn.disabled = !!(err || miss)
        let n = 0
        try { n = range.pages().length } catch { /* range control shows the error */ }
        bar.text(err || miss || h('span', 'Watermark will be added to ', h('b', plural(n, 'page')), '.'))
      }

      async function run() {
        const o = read()
        const targets = range.pages()
        await busy(btn, async () => {
          prog.set(0, 'Adding watermark')
          const doc = await src.edit()
          const st = await stamper(doc, o)
          const pages = doc.getPages()
          let emb = null
          if (o.kind === 'image') emb = await doc.embedPng(await (await toBlob(imgCanvas, 'image/png')).arrayBuffer())
          for (let i = 0; i < targets.length; i++) {
            const pg = pages[targets[i] - 1]
            const geom = pageGeom(pg)
            let bw, bh
            if (o.kind === 'image') { bw = geom.width * o.widthPct; bh = bw * imgCanvas.height / imgCanvas.width } else { bw = Math.max(8, st.width(o.text, o.size)); bh = o.size * 1.2 }
            for (const { cx, cy } of layout(geom.width, geom.height, bw, bh, o)) {
              if (o.kind === 'image') st.drawImage(pg, emb, { cx, cy, w: bw, h: bh, angle: o.angle, opacity: o.opacity })
              else await st.drawText(pg, o.text, { u: cx, v: cy - o.size / 2, size: o.size, align: 'center', angle: o.angle, opacity: o.opacity, color: o.color })
            }
            if (behind.input.checked) await sendToBack(pg)
            prog.set((i + 1) / targets.length, `Page ${targets[i]}`)
            if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0))
          }
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'watermarked'), title: 'Watermark added', lead: `${plural(targets.length, 'page')} stamped${o.kind === 'text' && st.isLatin(o.text) ? ', and the watermark text stays selectable' : ''}.`,
            facts: [{ label: 'Pages', value: targets.length }, { label: 'Layout', value: o.mode === 'tile' ? 'Tiled' : 'Single' }, { label: 'File size', value: formatBytes(blob.size) }],
            note: 'Anyone with a PDF editor can remove a watermark again. For permanent changes use Flatten PDF after stamping.', again: ws.reset,
          })
        }, { label: 'Stamping', errorTo: result, progress: prog })
      }

      stage.show(1).then(() => redraw())
      syncUi(); update()
      const left = h('div', { class: 'pe-prevwrap' }, nav, stage.el)
      const panel = h('section', { class: 'panel stack' }, heading('sliders-horizontal', 'Watermark'), kindSeg, textBox, imageBox, opacity, angle,
        h('div', { class: 'row' }, ...[0, 45, -45, 90].map((a) => button(`${a}°`, { variant: 'secondary', size: 'sm', onClick: () => { angle.set(a); redraw() } }))),
        field('Layout', mode), posBox, tileBox, behind, range)
      return [h('div', { class: 'tool-split wide-right' }, panel, left), prog.el, result, bar]
    },
  })
}
