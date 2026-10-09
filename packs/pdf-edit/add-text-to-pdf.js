// Type on PDF: click anywhere on a page to add text, ticks or a date. For forms that are just flat pages.
import { h, icon, busy, progress, input, field, button, toggle, rangeField, alert, formatBytes, toast } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfWorkspace, showResult, outName, css, heading, plural, dock } from './_shared.js'
import { createStage, pageNav, movable, clickAwayDeselect } from './_overlay.js'
import { stamper, canvasWidth } from './_stamp.js'

const CSS = `
.pe-ttxt { display: flex; align-items: center; white-space: nowrap; font-family: Helvetica, Arial, sans-serif; padding: 0 .2em; width: 100%; height: 100%; }
.pe-tstage { display: flex; flex-direction: column; gap: 10px; align-items: center; min-width: 0; }
.pe-tstage .pe-layer { cursor: text; }
.pe-quick { display: flex; flex-wrap: wrap; gap: 8px; }
.pe-sw { display: flex; gap: 8px; align-items: center; }
.pe-sw button { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1.5px var(--border-strong); cursor: pointer; padding: 0; transition: transform .25s var(--spring); }
.pe-sw button[aria-pressed="true"] { box-shadow: 0 0 0 2.5px var(--accent); transform: scale(1.12); }
@media (min-width: 901px) { .pe-tstage.pe-sticky { position: sticky; top: calc(var(--header-h) + 16px); } }
`
const COLORS = ['#111827', '#1d3a8a', '#b91c1c', '#15803d']
const date = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
let seq = 0

export function mount(root) {
  css('pe-addtext', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF to type on',
    icon: 'type',
    onLoad(src, ws) {
      const total = src.numPages
      const result = h('div'), prog = progress()
      const stage = createStage({ pdf: src.pdf, maxWidth: 560 })
      clickAwayDeselect(stage)
      const items = []
      const boxes = new Map()
      let current = 1, sel = null, color = COLORS[0]
      const nav = pageNav(total, (n) => go(n))
      const text = input({ placeholder: 'Select a text box, or click the page to add one', 'aria-label': 'Text of the selected box', disabled: true, oninput: () => edit() })
      const size = rangeField('Size', { min: 6, max: 72, value: 14, format: (v) => `${v} pt`, onInput: () => edit() })
      const bold = toggle('Bold', false, () => edit())
      const sw = h('div', { class: 'pe-sw', role: 'group', 'aria-label': 'Colour' }, COLORS.map((c) => h('button', { type: 'button', style: { background: c }, 'aria-label': c, 'aria-pressed': String(c === color), onclick: () => { color = c; for (const b of sw.children) b.setAttribute('aria-pressed', String(b.getAttribute('aria-label') === c)); edit() } })))
      const del = button('Delete this box', { icon: 'trash-2', variant: 'danger', size: 'sm', disabled: true, onClick: () => sel && remove(sel) })
      const btn = button('Save PDF', { icon: 'type', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      const measure = (it) => canvasWidth(it.text || ' ', { family: 'Helvetica', bold: it.bold, size: it.fs }) + it.fs * 0.4
      function add(t, x, y, fs = +size.input.valueAsNumber || 14) {
        const it = { id: ++seq, page: current, text: t, fs, bold: bold.input.checked, color, x: 0, y: 0, w: 0, h: 0 }
        it.w = measure(it); it.h = fs * 1.3
        it.x = Math.max(0, Math.min(stage.pw - it.w, x)); it.y = Math.max(0, Math.min(stage.ph - it.h, y))
        items.push(it)
        renderBoxes(); select(it, true)
        return it
      }
      function remove(it) { items.splice(items.indexOf(it), 1); if (sel === it) select(null); renderBoxes(); updateUi() }
      function select(it, focusText) {
        sel = it
        text.disabled = !it; del.disabled = !it
        if (it) { text.value = it.text; size.set(Math.round(it.fs)); bold.input.checked = it.bold; color = it.color; for (const b of sw.children) b.setAttribute('aria-pressed', String(b.getAttribute('aria-label') === color)); boxes.get(it.id)?.el.classList.add('is-active'); if (focusText) { text.focus(); text.select() } } else text.value = ''
        updateUi()
      }
      function edit() {
        if (!sel) return
        sel.text = text.value; sel.fs = size.input.valueAsNumber || sel.fs; sel.bold = bold.input.checked; sel.color = color
        const b = boxes.get(sel.id)
        sel.w = measure(sel); sel.h = sel.fs * 1.3
        b?.set({ w: sel.w, h: sel.h })
        paint(sel)
      }
      function paint(it) { const c = boxes.get(it.id)?.content; if (c) { c.textContent = it.text; c.style.fontSize = `${it.fs * stage.scale}px`; c.style.fontWeight = it.bold ? '700' : '400'; c.style.color = it.color } }
      function renderBoxes() {
        for (const b of boxes.values()) b.destroy()
        boxes.clear()
        for (const it of items.filter((x) => x.page === current)) {
          const content = h('div', { class: 'pe-ttxt' })
          const b = movable(stage, { x: it.x, y: it.y, w: it.w, h: it.h, aspect: () => it.w / it.h, content, label: 'Text box', min: 8, className: 'pe-sig',
            onChange: (api) => { const r = api.rect(); const grew = Math.abs(r.h - it.h) > 0.5; Object.assign(it, r); if (grew) { it.fs = it.h / 1.3; size.set(Math.round(it.fs)) } paint(it); updateUi() }, onSelect: () => select(it), onRemove: () => remove(it) })
          b.content = content
          const off = stage.onRender(() => paint(it))
          const d = b.destroy
          b.destroy = () => { off(); d() }
          boxes.set(it.id, b)
          paint(it)
        }
      }
      async function go(n) { current = n; nav.set(n); await stage.show(n); renderBoxes(); select(null) }
      function updateUi() {
        btn.disabled = !items.length
        bar.text(items.length ? h('span', h('b', plural(items.length, 'text box', 'text boxes')), ` on ${plural(new Set(items.map((x) => x.page)).size, 'page')}.`) : 'Click the page to add text. Drag to move, drag a corner to resize.')
      }

      // click on empty page = new text box
      let down = null
      stage.layer.addEventListener('pointerdown', (e) => { if (e.target === stage.layer) down = { x: e.clientX, y: e.clientY } })
      stage.layer.addEventListener('pointerup', (e) => {
        if (!down || e.target !== stage.layer) { down = null; return }
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5
        down = null
        if (moved) return
        const r = stage.layer.getBoundingClientRect()
        add('Text', (e.clientX - r.left) / stage.scale - 6, (e.clientY - r.top) / stage.scale - 10)
      })

      async function run() {
        await busy(btn, async () => {
          prog.set(0, 'Adding text')
          const doc = await src.edit()
          const pages = doc.getPages()
          const sts = {}
          for (let i = 0; i < items.length; i++) {
            const it = items[i]
            const st = (sts[it.bold] ??= await stamper(doc, { family: 'Helvetica', bold: it.bold }))
            await st.drawText(pages[it.page - 1], it.text, { u: it.x + it.fs * 0.2, v: it.y + (it.h - it.fs) / 2, size: it.fs, align: 'left', color: it.color })
            prog.set((i + 1) / items.length)
          }
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'typed'), title: 'Text added', lead: `${plural(items.length, 'text box', 'text boxes')} placed. It is real, selectable text.`,
            facts: [{ label: 'Text boxes', value: items.length }, { label: 'Pages', value: total }, { label: 'File size', value: formatBytes(blob.size) }], again: ws.reset,
          })
        }, { label: 'Saving', errorTo: result, progress: prog })
      }

      stage.show(1).then(() => renderBoxes())
      updateUi()
      const quick = h('div', { class: 'pe-quick' },
        button('Text', { icon: 'type', variant: 'secondary', size: 'sm', onClick: () => add('Text', stage.pw * 0.3, stage.ph * 0.4) }),
        button('Tick', { icon: 'check', variant: 'secondary', size: 'sm', onClick: () => add('✓', stage.pw * 0.3, stage.ph * 0.4, 18) }),
        button('Cross', { icon: 'x', variant: 'secondary', size: 'sm', onClick: () => add('✗', stage.pw * 0.3, stage.ph * 0.4, 18) }),
        button('Today', { icon: 'calendar', variant: 'secondary', size: 'sm', onClick: () => add(date(), stage.pw * 0.3, stage.ph * 0.4, 12) }))
      const panel = h('section', { class: 'panel stack' }, heading('type', 'Text'), quick, field('Text', text), size, h('div', { class: 'row' }, bold, sw), del,
        alert('info', 'Click the page to drop a text box. Tick and cross marks use your device font and are saved as small pictures.'))
      return [h('div', { class: 'tool-split wide-right' }, panel, h('div', { class: 'pe-tstage pe-sticky' }, nav, stage.el)), prog.el, result, bar]
    },
  })
}
