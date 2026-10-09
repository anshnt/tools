// Sign PDF: draw, type or upload a signature, drop it on any page, drag and resize, add a date. Everything stays on this device.
import { h, icon, busy, progress, input, field, button, select, toggle, alert, formatBytes, toast } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { toBlob } from '../../lib/image.js'
import { load, save } from '../../lib/store.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, plural, dock, pageGeom, placeRect } from './_shared.js'
import { createStage, pageNav, movable, clickAwayDeselect } from './_overlay.js'
import { signatureCreator, INKS } from './_signpad.js'
import { stamper, canvasWidth } from './_stamp.js'

const CSS = `
.pe-saved { display: flex; flex-wrap: wrap; gap: 8px; }
.pe-sv { position: relative; width: 112px; height: 62px; border-radius: 14px; border: 1.5px solid var(--border); background: #fff; cursor: pointer; display: grid; place-items: center; padding: 4px; transition: all .25s var(--spring); }
.pe-sv:hover { border-color: var(--accent); transform: translateY(-3px) rotate(-1.5deg); box-shadow: var(--shadow); }
.pe-sv img { max-width: 100%; max-height: 100%; display: block; }
.pe-sv .pe-x { position: absolute; top: -10px; right: -10px; width: 32px; height: 32px; border-radius: 50%; border: 0; background: var(--text); color: var(--bg); display: grid; place-items: center; cursor: pointer; opacity: 0; transition: opacity .2s; padding: 0; }
.pe-sv:hover .pe-x, .pe-sv:focus-within .pe-x { opacity: 1; }
@media (hover: none) { .pe-sv .pe-x { opacity: 1; } }
.pe-sv .pe-x .icon { width: 12px; height: 12px; }
.pe-txt { display: flex; align-items: center; white-space: nowrap; color: #111827; font-family: Helvetica, Arial, sans-serif; padding: 0 .2em; width: 100%; height: 100%; }
.pe-signstage { display: flex; flex-direction: column; gap: 10px; align-items: center; min-width: 0; }
.pe-tools { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
@media (min-width: 901px) { .pe-signstage.pe-sticky { position: sticky; top: calc(var(--header-h) + 16px); } }
`
const DATE_FORMATS = {
  medium: (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
  long: (d) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  dmy: (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
  iso: (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
}
const KEY = 'pdf-edit:signatures'
let seq = 0

export function mount(root) {
  css('pe-sign', CSS)
  pdfWorkspace(root, {
    label: 'Drop the PDF you need to sign',
    icon: 'signature',
    onLoad(src, ws) {
      const total = src.numPages
      const result = h('div'), prog = progress()
      const stage = createStage({ pdf: src.pdf, maxWidth: 560 })
      clickAwayDeselect(stage)
      const items = []
      const boxes = new Map()
      let current = 1, active = null
      const sigs = []

      const nav = pageNav(total, (n) => go(n))
      const remember = toggle('Remember my signatures on this device', false, () => persist())
      const withDate = toggle('Add today\'s date under each new signature', false)
      const dateFmt = select([['medium', '9 Oct 2026'], ['long', 'October 9, 2026'], ['dmy', '09/10/2026'], ['iso', '2026-10-09']], 'medium')
      const savedBox = h('div', { class: 'pe-saved', 'aria-label': 'Your signatures' })
      const hint = h('div', { class: 'small muted' }, 'Make a signature, then click it to place it on the page.')
      const btn = button('Save signed PDF', { icon: 'signature', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })
      const copyAll = button('Copy to every page', { icon: 'copy', variant: 'secondary', size: 'sm', disabled: true, onClick: () => copyTo((p) => p !== active.page) })
      const copyLast = button('Copy to last page', { icon: 'copy', variant: 'secondary', size: 'sm', disabled: true, onClick: () => copyTo((p) => p === total && p !== active.page) })
      const textIn = input({ placeholder: 'Text to add, for example your initials', 'aria-label': 'Text to add', onkeydown: (e) => { if (e.key === 'Enter') addText() } })

      // ---- persistence of saved signatures (opt-in) ----
      for (const s of load(KEY, [])) sigs.push({ url: s, canvasP: loadCanvas(s) })
      if (sigs.length) remember.input.checked = true
      function loadCanvas(url) { return new Promise((res) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0); res(c) }; i.src = url }) }
      function persist() { if (remember.input.checked) save(KEY, sigs.slice(-4).map((s) => s.url)); else save(KEY, []) }
      function paintSaved() {
        savedBox.replaceChildren(...sigs.map((s, i) => h('div', { class: 'pe-sv', tabindex: 0, role: 'button', 'aria-label': `Place signature ${i + 1} on the page`, onclick: () => place(s), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); place(s) } } },
          h('img', { src: s.url, alt: '' }), button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove this signature', attrs: { class: 'pe-x' }, onClick: (e) => { e.stopPropagation(); sigs.splice(i, 1); paintSaved(); persist() } }))))
        savedBox.hidden = !sigs.length
      }
      async function addSig(canvas) {
        const s = { url: canvas.toDataURL('image/png'), canvasP: Promise.resolve(canvas) }
        sigs.push(s)
        if (sigs.length > 6) sigs.shift()
        paintSaved(); persist()
        await place(s)
      }

      // ---- items on pages ----
      async function place(s) {
        const canvas = await s.canvasP
        const w = Math.min(stage.pw * 0.34, 190), hh = w * canvas.height / canvas.width
        const it = { id: ++seq, page: current, kind: 'image', canvas, url: s.url, x: (stage.pw - w) / 2, y: Math.min(stage.ph - hh - 40, stage.ph * 0.72), w, h: hh }
        items.push(it)
        if (withDate.input.checked) addDate(it)
        renderBoxes(); setActive(it)
        stage.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
      function textItem(text, x, y, fs) {
        const w = canvasWidth(text, { family: 'Helvetica', size: fs }) + fs * 0.4
        return { id: ++seq, page: current, kind: 'text', text, x, y, w, h: fs * 1.3, fs }
      }
      function addDate(under) {
        const fs = 11, t = DATE_FORMATS[dateFmt.value](new Date())
        const w = canvasWidth(t, { family: 'Helvetica', size: fs }) + fs * 0.4
        const it = under ? textItem(t, Math.min(stage.pw - w - 4, under.x), Math.min(stage.ph - fs * 1.3 - 4, under.y + under.h + 2), fs) : textItem(t, (stage.pw - w) / 2, stage.ph * 0.8, fs)
        items.push(it)
        if (!under) { renderBoxes(); setActive(it) }
      }
      function addText() {
        const t = textIn.value.trim()
        if (!t) return
        const it = textItem(t, stage.pw * 0.3, stage.ph * 0.5, 14)
        items.push(it); textIn.value = ''
        renderBoxes(); setActive(it)
      }
      function remove(it) { items.splice(items.indexOf(it), 1); if (active === it) active = null; renderBoxes(); updateUi() }
      function setActive(it) { active = it; updateUi(); boxes.get(it.id)?.el.classList.add('is-active') }
      function copyTo(pred) {
        if (!active) return
        let n = 0
        for (let p = 1; p <= total; p++) if (pred(p)) { items.push({ ...active, id: ++seq, page: p }); n++ }
        toast(`Copied to ${plural(n, 'page')}`, 'success')
        updateUi()
      }
      function renderBoxes() {
        for (const b of boxes.values()) b.destroy()
        boxes.clear()
        for (const it of items.filter((x) => x.page === current)) {
          const isImg = it.kind === 'image'
          const content = isImg ? h('img', { src: it.url, alt: 'Signature', draggable: false }) : h('div', { class: 'pe-txt' }, it.text)
          const fit = () => { if (!isImg) content.style.fontSize = `${(it.h / 1.3) * stage.scale}px` }
          const b = movable(stage, { x: it.x, y: it.y, w: it.w, h: it.h, aspect: it.w / it.h, content, label: isImg ? 'Signature' : 'Text', min: 14, className: 'pe-sig',
            onChange: (api) => { Object.assign(it, api.rect()); if (!isImg) it.fs = it.h / 1.3; fit(); updateUi() }, onSelect: () => { active = it; updateUi() }, onRemove: () => remove(it) })
          const off = stage.onRender(fit)
          const destroy = b.destroy
          b.destroy = () => { off(); destroy() }
          fit()
          boxes.set(it.id, b)
        }
      }
      async function go(n) { current = n; nav.set(n); await stage.show(n); renderBoxes(); updateUi() }
      function updateUi() {
        const n = items.filter((x) => x.kind === 'image').length
        const pages = new Set(items.map((x) => x.page)).size
        btn.disabled = !items.length
        copyAll.disabled = copyLast.disabled = !active || total < 2
        bar.text(items.length ? h('span', h('b', plural(items.length, 'item')), ` on ${plural(pages, 'page')}${n ? '' : ' (no signature yet)'}.`) : 'Create a signature, then place it on the page.')
        hint.textContent = items.length ? 'Drag to move, drag a corner to resize. Arrow keys nudge, Delete removes.' : 'Make a signature, then click it to place it on the page.'
      }

      async function run() {
        await busy(btn, async () => {
          prog.set(0, 'Signing')
          const { degrees } = await pdfLib()
          const doc = await src.edit()
          const pages = doc.getPages()
          const st = await stamper(doc, { family: 'Helvetica' })
          const emb = new Map()
          for (let i = 0; i < items.length; i++) {
            const it = items[i], pg = pages[it.page - 1], g = pageGeom(pg)
            if (it.kind === 'image') {
              if (!emb.has(it.canvas)) emb.set(it.canvas, await doc.embedPng(await (await toBlob(it.canvas, 'image/png')).arrayBuffer()))
              const p = placeRect(g, it.x, it.y, it.w, it.h)
              pg.drawImage(emb.get(it.canvas), { x: p.x, y: p.y, width: it.w, height: it.h, rotate: degrees(p.rotate) })
            } else await st.drawText(pg, it.text, { u: it.x + it.fs * 0.2, v: it.y + (it.h - it.fs) / 2, size: it.fs, align: 'left', color: INKS[0][0] })
            prog.set((i + 1) / items.length)
          }
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, 'signed'), title: 'Signed', lead: `${plural(items.length, 'item')} placed on ${plural(new Set(items.map((x) => x.page)).size, 'page')}.`,
            facts: [{ label: 'Signatures', value: items.filter((x) => x.kind === 'image').length }, { label: 'Pages', value: total }, { label: 'File size', value: formatBytes(blob.size) }],
            note: 'This adds a visible signature to the page. It is not a certificate-based digital signature.', again: ws.reset,
          })
        }, { label: 'Signing', errorTo: result, progress: prog })
      }

      paintSaved(); updateUi()
      stage.show(1).then(() => renderBoxes())
      const creator = signatureCreator({ onUse: (canvas) => addSig(canvas) })
      const panel = h('section', { class: 'panel stack' }, heading('pen-line', 'Your signature'), creator,
        h('div', { class: 'pe-sub-h' }, 'My signatures'), savedBox, remember,
        h('div', { class: 'pe-sub-h' }, 'Extras'), withDate, field('Date style', dateFmt),
        h('div', { class: 'row' }, textIn, button('Add text', { icon: 'type', variant: 'secondary', size: 'sm', onClick: addText })))
      const right = h('div', { class: 'pe-signstage pe-sticky' }, nav, stage.el, hint, h('div', { class: 'pe-tools' }, button('Add date', { icon: 'calendar', variant: 'secondary', size: 'sm', onClick: () => addDate(null) }), copyAll, copyLast))
      return [h('div', { class: 'tool-split' }, panel, right), prog.el, result, bar]
    },
  })
}
