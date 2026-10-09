// Redact PDF: draw black boxes (or find words), and burn them into the page picture so the text underneath is really gone.
import { h, icon, busy, progress, input, field, button, select, alert, formatBytes, toast, yieldToMain } from '../../lib/ui.js'
import { renderPage, pageSize, savePdf } from '../../lib/pdf.js'
import { toBlob } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, plural, dock, copyInfo } from './_shared.js'
import { createStage, pageNav, movable } from './_overlay.js'

const CSS = `
.pe-redbox { background: rgba(0, 0, 0, .84); border-radius: 1px; }
.pe-redbox.is-active { background: rgba(0, 0, 0, .7); }
.pe-rstage { display: flex; flex-direction: column; gap: 10px; align-items: center; min-width: 0; }
.pe-rstage .pe-layer { cursor: crosshair; }
.pe-rubber { position: absolute; border: 1.5px dashed #fff; background: rgba(0, 0, 0, .35); outline: 1px solid rgba(0, 0, 0, .6); pointer-events: none; }
.pe-rlist { display: flex; flex-wrap: wrap; gap: 6px; }
.pe-rlist button { height: 32px; padding: 0 12px; border-radius: 99px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; font-size: 13px; transition: all .2s; }
.pe-rlist button:hover { border-color: var(--accent); color: var(--accent); }
@media (min-width: 901px) { .pe-rstage.pe-sticky { position: sticky; top: calc(var(--header-h) + 16px); } }
`
let seq = 0

/** Bounding box (displayed points) of the part of a pdf.js text item that matches, estimated by character position. */
export function matchBox(item, vp, start, len) {
  const [a, b, c, d, e, f] = item.transform
  const n = item.str.length || 1
  const wl = Math.hypot(a, b) || 1, hl = Math.hypot(c, d) || 1
  const ux = a / wl, uy = b / wl, vx = c / hl, vy = d / hl
  const w0 = (start / n) * item.width, w1 = ((start + len) / n) * item.width
  const down = hl * 0.22, up = hl * 1.02
  const pt = (w, v) => vp.convertToViewportPoint(e + ux * w + vx * v, f + uy * w + vy * v)
  const q = [pt(w0, -down), pt(w1, -down), pt(w1, up), pt(w0, up)]
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1])
  // glyph widths vary, so cover a little more than the estimate on each side
  const padX = 2 + Math.abs((w1 - w0)) * 0.07, padY = 1.5
  return { x: Math.min(...xs) - padX, y: Math.min(...ys) - padY, w: Math.max(...xs) - Math.min(...xs) + 2 * padX, h: Math.max(...ys) - Math.min(...ys) + 2 * padY }
}

export function mount(root) {
  css('pe-redact', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF to redact',
    icon: 'rectangle-horizontal',
    onLoad(src, ws) {
      const total = src.numPages
      const result = h('div'), prog = progress()
      const stage = createStage({ pdf: src.pdf, maxWidth: 560 })
      const items = []
      const boxes = new Map()
      let current = 1
      const nav = pageNav(total, (n) => go(n))
      const dpi = select([['150', '150 dpi'], ['200', '200 dpi, standard'], ['300', '300 dpi, sharp']], '200')
      const find = input({ placeholder: 'A name, number or phrase to find on every page', 'aria-label': 'Text to find', onkeydown: (e) => { if (e.key === 'Enter') findAll() } })
      const found = h('small', { class: 'field-hint', 'aria-live': 'polite' })
      const clearBtn = button('Clear all boxes', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { items.length = 0; renderBoxes(); updateUi() } })
      const btn = button('Redact and save', { icon: 'rectangle-horizontal', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      function addItem(it) { it.id = ++seq; items.push(it); return it }
      function remove(it) { items.splice(items.indexOf(it), 1); renderBoxes(); updateUi() }
      function renderBoxes() {
        for (const b of boxes.values()) b.destroy()
        boxes.clear()
        for (const it of items.filter((x) => x.page === current)) {
          const b = movable(stage, { x: it.x, y: it.y, w: it.w, h: it.h, handles: 'all', min: 4, className: 'pe-redbox', label: 'Redaction box', onChange: (api) => { Object.assign(it, api.rect()) }, onRemove: () => remove(it) })
          boxes.set(it.id, b)
        }
      }
      async function go(n) { current = n; nav.set(n); await stage.show(n); renderBoxes() }
      function updateUi() {
        const pages = new Set(items.map((x) => x.page)).size
        btn.disabled = !items.length
        bar.text(items.length ? h('span', h('b', plural(items.length, 'box', 'boxes')), ` on ${plural(pages, 'page')}. Those pages will be redrawn as images.`) : 'Drag on the page to draw a box over what you want to hide.')
      }

      // rubber-band drawing on the empty page
      stage.layer.addEventListener('pointerdown', (e) => {
        if (e.target !== stage.layer || e.button !== 0) return
        e.preventDefault()
        const r = stage.layer.getBoundingClientRect()
        const sx = e.clientX - r.left, sy = e.clientY - r.top
        const rub = h('div', { class: 'pe-rubber' })
        stage.layer.append(rub)
        stage.layer.setPointerCapture(e.pointerId)
        const move = (ev) => {
          const x = Math.min(sx, ev.clientX - r.left), y = Math.min(sy, ev.clientY - r.top)
          Object.assign(rub.style, { left: `${x}px`, top: `${y}px`, width: `${Math.abs(ev.clientX - r.left - sx)}px`, height: `${Math.abs(ev.clientY - r.top - sy)}px` })
        }
        const up = (ev) => {
          stage.layer.removeEventListener('pointermove', move); stage.layer.removeEventListener('pointerup', up); stage.layer.removeEventListener('pointercancel', up)
          rub.remove()
          const k = stage.scale
          const x = Math.min(sx, ev.clientX - r.left) / k, y = Math.min(sy, ev.clientY - r.top) / k, w = Math.abs(ev.clientX - r.left - sx) / k, hh = Math.abs(ev.clientY - r.top - sy) / k
          if (w > 5 && hh > 5) { addItem({ page: current, x, y, w, h: hh }); renderBoxes(); updateUi() }
        }
        stage.layer.addEventListener('pointermove', move); stage.layer.addEventListener('pointerup', up); stage.layer.addEventListener('pointercancel', up)
      })

      async function findAll() {
        const needle = find.value.trim().toLowerCase()
        if (needle.length < 2) { found.textContent = 'Type at least 2 characters.'; return }
        found.textContent = 'Searching...'
        let n = 0
        for (let p = 1; p <= total; p++) {
          const pg = await src.pdf.getPage(p)
          const vp = pg.getViewport({ scale: 1 })
          const tc = await pg.getTextContent()
          for (const it of tc.items) {
            if (!('str' in it) || !it.str) continue
            const low = it.str.toLowerCase()
            let i = low.indexOf(needle)
            while (i >= 0) { addItem({ page: p, ...matchBox(it, vp, i, needle.length) }); n++; i = low.indexOf(needle, i + needle.length) }
          }
          if (p % 5 === 0) await yieldToMain()
        }
        found.textContent = n ? `Marked ${plural(n, 'match', 'matches')}. Check each box, then redact.` : 'No matches in the page text. If the page is a scan, draw boxes by hand.'
        renderBoxes(); updateUi()
      }

      async function run() {
        const byPage = new Map()
        for (const it of items) { if (!byPage.has(it.page)) byPage.set(it.page, []); byPage.get(it.page).push(it) }
        await busy(btn, async () => {
          const { PDFDocument } = await pdfLib()
          const base = await src.edit()
          const out = await PDFDocument.create()
          const scale = +dpi.value / 72
          let done = 0
          for (let p = 1; p <= total; p++) {
            prog.set((p - 1) / total, `Page ${p} of ${total}`)
            const boxesOn = byPage.get(p)
            if (!boxesOn) { const [pg] = await out.copyPages(base, [p - 1]); out.addPage(pg); continue }
            const { width, height } = await pageSize(src.pdf, p)
            const c = await renderPage(src.pdf, p, { scale })
            const ctx = c.getContext('2d')
            const k = c.width / width
            ctx.fillStyle = '#000'
            for (const b of boxesOn) ctx.fillRect(Math.floor(b.x * k), Math.floor(b.y * k), Math.ceil(b.w * k) + 1, Math.ceil(b.h * k) + 1)
            const jpg = await out.embedJpg(await (await toBlob(c, 'image/jpeg', 0.9)).arrayBuffer())
            out.addPage([width, height]).drawImage(jpg, { x: 0, y: 0, width, height })
            c.width = c.height = 0
            done++
            await yieldToMain()
          }
          copyInfo(base, out)
          const blob = await savePdf(out)
          await showResult(result, {
            blob, name: outName(src.file, 'redacted'), title: 'Redacted for real', lead: `${plural(items.length, 'box', 'boxes')} burned into ${plural(done, 'page')}. The text underneath no longer exists in this file.`,
            facts: [{ label: 'Boxes', value: items.length }, { label: 'Pages redrawn', value: done }, { label: 'File size', value: formatBytes(blob.size) }],
            note: 'Redacted pages are now pictures, so their text is not selectable. Your original file still contains everything: keep it private.', again: ws.reset,
          })
        }, { label: 'Redacting', errorTo: result, progress: prog })
      }

      stage.show(1).then(() => renderBoxes())
      updateUi()
      const panel = h('section', { class: 'panel stack' }, heading('rectangle-horizontal', 'Redact'),
        alert('info', 'Drag on the page to draw a black box. Drag a box to move it, its corners to resize it.'),
        field('Find and mark text', h('div', { class: 'row', style: 'flex-wrap:nowrap' }, find, button('Find', { icon: 'search', variant: 'secondary', onClick: findAll })), 'Marks every match on every page for you to check.'), found,
        field('Quality of redacted pages', dpi), h('div', { class: 'row' }, clearBtn))
      return [h('div', { class: 'tool-split wide-right' }, panel, h('div', { class: 'pe-rstage pe-sticky' }, nav, stage.el)), prog.el, result, bar]
    },
  })
}
