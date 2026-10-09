// Fill PDF form: every AcroForm field with the right control, a live preview of the filled page, optional flatten.
import { h, icon, busy, progress, input, textarea, field, button, toggle, select, alert, empty, formatBytes, debounce } from '../../lib/ui.js'
import { openPdf, savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, plural, dock, destroyPdf } from './_shared.js'
import { createStage, pageNav } from './_overlay.js'

const CSS = `
.pe-fields { display: grid; gap: 12px; }
.pe-fgroup { display: grid; gap: 10px; }
.pe-fgroup > h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); font-weight: 600; margin-top: 4px; }
.pe-frow { padding: 12px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); display: grid; gap: 8px; transition: border-color .2s, box-shadow .2s; }
.pe-frow.is-focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.pe-frow .pe-fname { font-size: 13px; font-weight: 600; color: var(--text-2); display: flex; align-items: center; gap: 8px; overflow-wrap: anywhere; }
.pe-frow .pe-ftype { font-size: 11px; font-weight: 500; color: var(--muted); border: 1px solid var(--border); border-radius: 99px; padding: 0 7px; margin-left: auto; white-space: nowrap; }
.pe-opts { display: flex; flex-wrap: wrap; gap: 6px; }
.pe-opts label { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px 6px 9px; border-radius: 99px; border: 1.5px solid var(--border); cursor: pointer; font-size: 13.5px; transition: all .2s var(--ease); }
.pe-opts label:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.pe-fbox { position: absolute; border: 1.5px solid color-mix(in srgb, var(--accent) 65%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 3px; cursor: pointer; transition: background .2s, box-shadow .2s; }
.pe-fbox:hover, .pe-fbox.is-focus { background: color-mix(in srgb, var(--accent) 28%, transparent); box-shadow: 0 0 0 3px var(--ring); }
.pe-fillstage { display: flex; flex-direction: column; gap: 10px; align-items: center; min-width: 0; }
@media (min-width: 901px) { .pe-fillstage.pe-sticky { position: sticky; top: calc(var(--header-h) + 16px); } }
`
const pretty = (n) => n.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()

export function mount(root) {
  css('pe-fill', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF form to fill in',
    icon: 'text-cursor-input',
    async onLoad(src, ws) {
      const lib = await pdfLib()
      const { PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFButton, PDFSignature } = lib
      const result = h('div'), prog = progress()
      const work = await src.edit()
      const form = work.getForm()
      const all = form.getFields()
      if (!all.length) return [alert('info', h('strong', 'This PDF has no form fields. '), 'Use "Sign PDF" to place a signature, or "Add watermark" to stamp text on it.'), button('Choose another file', { icon: 'refresh-cw', variant: 'secondary', onClick: ws.reset })]

      // which page is each field on?
      const pageRefs = new Map()
      work.getPages().forEach((p, i) => { const a = p.node.Annots(); if (a) for (let k = 0; k < a.size(); k++) pageRefs.set(a.get(k), i + 1) })
      const pageOf = (f) => { for (const w of f.acroField.getWidgets()) { const r = work.context.getObjectRef(w.dict); if (r && pageRefs.has(r)) return pageRefs.get(r) } return 1 }

      const rows = []
      const fillable = []
      const skipped = []
      for (const f of all) {
        const kind = f instanceof PDFTextField ? 'text' : f instanceof PDFCheckBox ? 'check' : f instanceof PDFRadioGroup ? 'radio' : f instanceof PDFDropdown ? 'drop' : f instanceof PDFOptionList ? 'list' : null
        if (!kind) { skipped.push([f, f instanceof PDFSignature ? 'signature' : f instanceof PDFButton ? 'button' : 'field']); continue }
        const name = f.getName()
        let ctl, get, set, reset
        const readonly = f.isReadOnly()
        const onEdit = () => preview()
        if (kind === 'text') {
          const multi = f.isMultiline()
          const max = f.getMaxLength()
          ctl = multi ? textarea({ rows: 3, 'aria-label': pretty(name) }) : input({ 'aria-label': pretty(name) })
          if (max) ctl.maxLength = max
          ctl.value = f.getText() ?? ''
          ctl.readOnly = readonly
          ctl.addEventListener('input', onEdit)
          get = () => ctl.value; set = (v) => { ctl.value = v }; reset = () => { ctl.value = '' }
        } else if (kind === 'check') {
          const sw = toggle('Checked', f.isChecked(), onEdit)
          sw.input.disabled = readonly
          ctl = sw
          get = () => sw.input.checked; set = (v) => { sw.input.checked = !!v }; reset = () => { sw.input.checked = false }
        } else if (kind === 'radio' || kind === 'list') {
          const opts = f.getOptions()
          const multi = kind === 'list' && f.isMultiselect()
          const sel = new Set(kind === 'radio' ? [f.getSelected()].filter(Boolean) : f.getSelected())
          const inputs = opts.map((o) => h('input', { type: multi ? 'checkbox' : 'radio', name: `r-${name}`, value: o, checked: sel.has(o), disabled: readonly, onchange: onEdit }))
          ctl = h('div', { class: 'pe-opts', role: multi ? 'group' : 'radiogroup', 'aria-label': pretty(name) }, opts.map((o, i) => h('label', inputs[i], o)),
            kind === 'radio' ? h('label', { style: 'border-style:dashed' }, h('input', { type: 'radio', name: `r-${name}`, value: '', checked: !sel.size, onchange: onEdit }), 'None') : null)
          get = () => (multi ? inputs.filter((i) => i.checked).map((i) => i.value) : (ctl.querySelector('input:checked')?.value || ''))
          set = (v) => { const vs = new Set([v].flat()); for (const i of ctl.querySelectorAll('input')) i.checked = vs.has(i.value) }
          reset = () => { for (const i of ctl.querySelectorAll('input')) i.checked = i.value === '' }
        } else {
          const opts = f.getOptions()
          ctl = select([['', '(none)'], ...opts.map((o) => [o, o])], f.getSelected()[0] ?? '', onEdit)
          ctl.disabled = readonly
          get = () => ctl.value; set = (v) => { ctl.value = v }; reset = () => { ctl.value = '' }
        }
        const page = pageOf(f)
        const row = h('div', { class: 'pe-frow', 'data-name': name }, h('div', { class: 'pe-fname' }, pretty(name), h('span', { class: 'pe-ftype' }, { text: 'Text', check: 'Check box', radio: 'Choice', drop: 'Dropdown', list: 'List' }[kind] + (readonly ? ', read only' : ''))), ctl)
        row.addEventListener('focusin', () => focusField(name, page))
        rows.push({ f, kind, name, page, row, ctl, get, set, reset, readonly })
        fillable.push(rows.at(-1))
      }

      // ---- live preview: fill a working copy, save, render with pdf.js ----
      let current = null
      const proxy = { numPages: src.numPages, getPage: (n) => (current || src.pdf).getPage(n) }
      const stage = createStage({ pdf: proxy, maxWidth: 560 })
      let page = 1, flatErrors = []
      const nav = pageNav(src.numPages, (n) => go(n))
      const boxLayer = h('div', { style: 'position:absolute;inset:0' })
      stage.layer.append(boxLayer)

      function apply(doc) {
        const fm = doc.getForm()
        const errs = []
        for (const r of fillable) {
          if (r.readonly) continue
          const f = fm.getField(r.name)
          try {
            if (r.kind === 'text') f.setText(r.get() || undefined)
            else if (r.kind === 'check') r.get() ? f.check() : f.uncheck()
            else if (r.kind === 'radio') { const v = r.get(); v ? f.select(v) : f.clear() }
            else if (r.kind === 'drop') { const v = r.get(); v ? f.select(v) : f.clear() }
            else { const v = r.get(); v.length ? f.select(v) : f.clear() }
          } catch (e) { errs.push(`${pretty(r.name)}: ${/encode|WinAnsi/i.test(e.message) ? 'this form font cannot show some of the characters you typed' : e.message}`) }
        }
        try { fm.updateFieldAppearances() } catch (e) { errs.push(e.message) }
        return errs
      }
      const preview = debounce(async () => {
        try {
          flatErrors = apply(work)
          const bytes = await work.save()
          const next = await openPdf(bytes)
          const old = current
          current = next
          await stage.show(page)
          destroyPdf(old)
          warn()
        } catch (e) { console.error(e) }
      }, 450)
      src.dispose(() => destroyPdf(current))
      const warnBox = h('div')
      const warn = () => warnBox.replaceChildren(...(flatErrors.length ? [alert('warn', h('strong', 'Check these fields. '), flatErrors.join(' '))] : []))

      async function widgetBoxes() {
        boxLayer.replaceChildren()
        const pg = await (current || src.pdf).getPage(page)
        const vp = pg.getViewport({ scale: 1 })
        const ann = await pg.getAnnotations()
        for (const a of ann) {
          if (a.subtype !== 'Widget' || !a.rect) continue
          const r = rows.find((x) => x.name === a.fieldName)
          if (!r) continue
          const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]), [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3])
          const b = h('div', { class: 'pe-fbox', 'data-name': a.fieldName, title: pretty(a.fieldName), onclick: () => { const c = r.row.querySelector('input,select,textarea'); c?.focus(); r.row.scrollIntoView({ behavior: 'smooth', block: 'center' }) } })
          b._r = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]
          boxLayer.append(b)
        }
        layoutBoxes()
      }
      function layoutBoxes() { for (const b of boxLayer.children) { const k = stage.scale, [x, y, w, hh] = b._r; Object.assign(b.style, { left: `${x * k}px`, top: `${y * k}px`, width: `${w * k}px`, height: `${hh * k}px` }) } }
      stage.onRender(() => { widgetBoxes(); })
      function focusField(name, p) {
        for (const r of rows) r.row.classList.toggle('is-focus', r.name === name)
        for (const b of boxLayer.children) b.classList.toggle('is-focus', b.dataset.name === name)
        if (p !== page) go(p)
      }
      async function go(n) { page = n; nav.set(n); await stage.show(n) }

      // ---- controls and output ----
      const flat = toggle('Flatten after filling (turn the fields into plain page content)', false)
      const btn = button('Save filled PDF', { icon: 'text-cursor-input', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })
      const pages = [...new Set(rows.map((r) => r.page))].sort((a, b) => a - b)
      const groups = pages.map((p) => h('div', { class: 'pe-fgroup' }, pages.length > 1 ? h('h3', `Page ${p}`) : null, rows.filter((r) => r.page === p).map((r) => r.row)))
      const clearAll = button('Clear all', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { for (const r of rows) if (!r.readonly) r.reset(); preview() } })
      const count = () => rows.filter((r) => { const v = r.get(); return Array.isArray(v) ? v.length : r.kind === 'check' ? v : !!v }).length
      bar.text(h('span', h('b', plural(fillable.length, 'field')), ' to fill. Click a highlighted box on the page or a field here.'))

      async function run() {
        await busy(btn, async () => {
          prog.set(null, 'Filling')
          const doc = await src.edit()
          const errs = apply(doc)
          if (flat.input.checked) doc.getForm().flatten()
          const blob = await savePdf(doc)
          await showResult(result, {
            blob, name: outName(src.file, flat.input.checked ? 'filled-flat' : 'filled'), title: 'Form filled', lead: flat.input.checked ? 'The fields are now part of the page and can no longer be edited.' : 'The fields stay editable, so you can fill the rest later.',
            facts: [{ label: 'Fields filled', value: count() }, { label: 'Fields', value: fillable.length }, { label: 'File size', value: formatBytes(blob.size) }],
            note: errs.length ? `Some fields could not be set: ${errs.join(' ')}` : skipped.length ? `${plural(skipped.length, 'signature or button field')} left as they were. Use Sign PDF for signatures.` : undefined, again: ws.reset,
          })
        }, { label: 'Saving', errorTo: result, progress: prog })
      }

      stage.show(1).then(() => widgetBoxes())
      const panel = h('section', { class: 'panel stack' }, h('h2', h('span', { style: 'display:flex;gap:8px;align-items:center' }, icon('list-checks'), `${plural(fillable.length, 'field')}`), clearAll), warnBox, h('div', { class: 'pe-fields' }, groups), flat,
        skipped.length ? h('small', { class: 'field-hint' }, `Not shown: ${skipped.map(([f, k]) => `${pretty(f.getName())} (${k})`).join(', ')}.`) : null)
      return [h('div', { class: 'tool-split wide-right' }, panel, h('div', { class: 'pe-fillstage pe-sticky' }, nav, stage.el)), prog.el, result, bar]
    },
  })
}
