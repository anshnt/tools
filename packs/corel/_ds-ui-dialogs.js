// Draw Studio dialogs: New drawing, Page setup and Export (also the quick export mode). Built with modal() from lib/ui.js; bodies are wrapped in
// div.t-ds-dlg. Everything shown comes from the document through textContent (never innerHTML).
import { h, alert, button, download, errorMessage, field, formatBytes, isAbort, modal, progress, rangeField, segmented, select, toast, toggle } from '../../lib/ui.js'
import { PAGE_SIZES, UNITS, pagePreset, presetSize } from './_ds-doc.js'
import { UNITS_LIST, fmt, fromUnit } from './_ds-units.js'
import { setPageSize } from './_ds-ops.js'
import { FORMATS, defaultsFor, exportDoc } from './_ds-save.js'

const shown = (pt, u) => fmt(pt, u)
const PRESETS = ['Custom', ...Object.keys(PAGE_SIZES)]
const sizeOptions = () => PRESETS.map((p) => [p, p])

/** A paper size editor shared by the New and Page setup dialogs: preset, orientation, width, height, units. Returns {el, get(), set(w, h)}. */
function sizeFields({ w, h: hh, units, onChange }) {
  const st = { w, h: hh, units }
  const num = (aria) => h('input', { type: 'number', step: 'any', min: 0.1, class: 'input', 'aria-label': aria })
  const fw = num('Width'), fh = num('Height')
  const presetSel = select(sizeOptions(), 'Custom', (v) => { const s = presetSize(v, st.w > st.h); if (s) { st.w = s[0]; st.h = s[1]; sync() } })
  presetSel.setAttribute('aria-label', 'Paper size')
  const orient = segmented([['p', 'Portrait'], ['l', 'Landscape']], 'p', (v) => { const lo = Math.min(st.w, st.h), hi = Math.max(st.w, st.h); st.w = v === 'l' ? hi : lo; st.h = v === 'l' ? lo : hi; sync() }, 'Orientation')
  const unitSel = select(UNITS_LIST, units, (v) => { st.units = v; sync() })
  unitSel.setAttribute('aria-label', 'Units')
  const read = () => { const w = fromUnit(fw.valueAsNumber, st.units), hh2 = fromUnit(fh.valueAsNumber, st.units); if (w > 0 && hh2 > 0) { st.w = w; st.h = hh2 } sync(false) }
  fw.addEventListener('input', read); fh.addEventListener('input', read)
  function sync(writeFields = true) {
    const pr = pagePreset(st.w, st.h)
    presetSel.value = pr ? pr.name : 'Custom'
    orient.set(st.w > st.h ? 'l' : 'p')
    if (writeFields) { fw.value = shown(st.w, st.units); fh.value = shown(st.h, st.units) }
    onChange?.(st)
  }
  sync()
  const el = h('div', { class: 'ds-form' },
    h('div', { class: 'ds-form-row' }, field('Paper size', presetSel), field('Orientation', orient)),
    h('div', { class: 'ds-form-row three' }, field('Width', fw), field('Height', fh), field('Units', unitSel)))
  return { el, get: () => ({ ...st }) }
}

/** env: {store, app, assets, fonts, boxOf, persist} -> {openNew, openPageSetup, openExport, runExport} */
export function createDialogs({ store, app, assets, fonts, boxOf, persist }) {
  // ---------- New drawing ----------
  function openNew({ dirty, onCreate }) {
    const title = h('input', { type: 'text', class: 'input', value: 'Untitled', maxlength: 100, 'aria-label': 'Name' })
    const [w0, h0] = PAGE_SIZES.A4
    const size = sizeFields({ w: w0, h: h0, units: store.root.units || 'mm' })
    let m
    const go = () => { const s = size.get(); m.close(); onCreate({ title: title.value.trim() || 'Untitled', w: s.w, h: s.h, units: UNITS.includes(s.units) ? s.units : 'mm' }) }
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go() } })
    m = modal({
      title: 'New drawing', icon: 'file-plus',
      body: h('div', { class: 't-ds-dlg' },
        dirty ? alert('warn', 'The drawing you are working on has changes that are not saved. They will be lost.') : null,
        field('Name', title), size.el),
      actions: [button('Cancel', { variant: 'secondary', onClick: () => m.close() }), button('Create', { variant: 'primary', onClick: go })],
    })
    title.focus(); title.select()
    return m
  }

  // ---------- Page setup ----------
  function openPageSetup() {
    const p = store.page()
    if (!p) return null
    if (p.pending) { store.setStatus('This page is still being read. Try again in a moment.'); return null }
    const size = sizeFields({ w: p.w, h: p.h, units: store.root.units })
    const scope = segmented([['this', 'This page'], ['all', 'All pages']], 'this', null, 'Apply to')
    let m
    const apply = () => {
      const s = size.get()
      m.close()
      store.tx('Page setup', (r) => {
        const r1 = setPageSize(r, scope.value === 'all' ? null : [p.id], s.w, s.h)
        return r1.units === s.units ? r1 : { ...r1, units: s.units }
      })
      const waiting = scope.value === 'all' ? store.root.pages.filter((x) => x.pending).length : 0
      if (waiting) toast(`${waiting} page${waiting === 1 ? ' is' : 's are'} still being read and kept ${waiting === 1 ? 'its' : 'their'} own size.`)
    }
    m = modal({
      title: 'Page setup', icon: 'ruler',
      body: h('div', { class: 't-ds-dlg' }, size.el, field('Apply to', scope, store.root.pages.length > 1 ? 'Objects keep their distance from the bottom edge of the page.' : null)),
      actions: [button('Cancel', { variant: 'secondary', onClick: () => m.close() }), button('Apply', { variant: 'primary', onClick: apply })],
    })
    return m
  }

  // ---------- running an export ----------
  /** Export, download the file(s), remember the notes. A CDR of the whole drawing counts as saving it. */
  async function runExport(fmt, opts, { signal, onProgress } = {}) {
    app.commitEdits?.()
    const res = await exportDoc(fmt, opts, { store, assets, fonts, boxOf, signal, onProgress })
    for (const f of res.files) download(f.blob, f.name)
    app.noteExport?.(res)
    if (fmt === 'cdr' && opts.pages !== 'current') { store.markSaved(); persist?.saved() }
    return res
  }

  // ---------- Export dialog ----------
  /** o: {format, selection (start with the selection only), quick (quick export mode: the primary button says Save as X and Edit in Draw Studio closes the dialog)} */
  function openExport({ format = 'cdr', selection = false, quick = false } = {}) {
    app.commitEdits?.()
    const st = { fmt: FORMATS[format] ? format : 'cdr', pages: selection ? 'selection' : 'all', ...defaultsFor(format) }
    const nPages = store.root.pages.length
    const fmtSel = select(Object.entries(FORMATS).map(([k, v]) => [k, v.label]), st.fmt, (v) => { st.fmt = v; Object.assign(st, defaultsFor(v)); if (!allowSel(v) && st.pages === 'selection') st.pages = 'all'; draw() })
    fmtSel.setAttribute('aria-label', 'Format')
    const desc = h('p', { class: 'small muted ds-fmt-desc' })
    const pagesBox = h('div'), optsBox = h('div', { class: 'ds-form' }), info = h('div', { class: 'ds-form' })
    const prog = progress('Saving')
    const result = h('div', { class: 'ds-form' })
    const allowSel = (f) => ['png', 'jpg', 'svg'].includes(f)
    const ctl = { c: null }
    let m, goBtn, closeBtn, busy = false
    const pageOpts = () => (st.pages === 'current' ? 'current' : 'all')

    function draw() {
      const F = FORMATS[st.fmt]
      fmtSel.value = st.fmt
      desc.textContent = F.text
      goBtn.querySelector('span').textContent = quick ? `Save as ${F.label}` : st.fmt === 'cdr' ? 'Save as CDR' : `Save as ${F.label}`
      // pages
      const opts = [['all', nPages > 1 ? 'All pages' : 'The page'], ...(nPages > 1 ? [['current', 'This page']] : []), ...(allowSel(st.fmt) ? [['selection', 'Selection']] : [])]
      if (!opts.some(([v]) => v === st.pages)) st.pages = 'all'
      const seg = segmented(opts, st.pages, (v) => { st.pages = v; draw() }, 'What to save')
      pagesBox.replaceChildren(field('What to save', seg, st.pages === 'selection' && !store.sel.ids.length ? 'Select something on the page first.' : null))
      // format options
      const rows = []
      if (F.raster) {
        const dpi = h('input', { type: 'number', min: 10, max: 1200, step: 1, class: 'input', value: st.dpi, 'aria-label': 'Resolution in dots per inch', oninput: (e) => { const v = e.target.valueAsNumber; if (v >= 10 && v <= 1200) { st.dpi = v; px() } } })
        const preset = select([72, 96, 150, 300, 600].map((v) => [v, `${v} dpi`]), [72, 96, 150, 300, 600].includes(st.dpi) ? st.dpi : '', (v) => { st.dpi = +v; dpi.value = v; px() })
        preset.setAttribute('aria-label', 'Resolution preset')
        const size = h('small', { class: 'field-hint ds-px' })
        const px = () => { const p = store.page(); size.textContent = p ? `A page is ${Math.round(p.w * st.dpi / 72)} x ${Math.round(p.h * st.dpi / 72)} pixels.` : '' }
        rows.push(h('div', { class: 'ds-form-row' }, field('Resolution', preset), field('Dots per inch', dpi)), size)
        px()
        if (st.fmt === 'png') rows.push(toggle('Transparent background', st.transparent, (c) => { st.transparent = c }))
        else { const q = rangeField('Quality', { min: 40, max: 100, step: 1, value: Math.round(st.quality * 100), format: (v) => `${v}%`, onInput: (v) => { st.quality = v / 100 } }); rows.push(q) }
        rows.push(h('p', { class: 'small muted' }, 'Text is turned into curves for pictures, so the letters look the same everywhere.'))
      } else {
        const t = toggle('Convert text to curves', st.outline, (c) => { st.outline = c })
        rows.push(t, h('p', { class: 'small muted' }, st.fmt === 'svg' ? 'Off keeps text as text, with the fonts of the drawing inside the file.' : st.fmt === 'cdr' ? 'On keeps the exact letter shapes. Off saves live text that uses the fonts you have installed.' : 'On keeps the exact letter shapes. Off uses standard fonts only.'))
        if ((st.fmt === 'pdf' || st.fmt === 'ai') && nPages > 1) rows.push(toggle('One file per page (a ZIP)', st.split, (c) => { st.split = c }))
        if (st.fmt === 'cdr') rows.push(toggle('Smaller file (compress the drawing data)', st.compress, (c) => { st.compress = c }), toggle('Keep transparency in pictures (experimental)', st.bitmapAlpha === 'rgba', (c) => { st.bitmapAlpha = c ? 'rgba' : 'flatten' }))
      }
      optsBox.replaceChildren(...rows)
      const parts = nPages > 1 && st.pages === 'all' && F.perPage ? `${F.label} saves one file per page. They come in one ZIP.` : ''
      info.replaceChildren(...(parts ? [h('p', { class: 'small muted' }, parts)] : []), ...(st.fmt === 'cdr' ? [h('p', { class: 'small muted' }, 'CDR was written from public format notes and has not been opened in the desktop application from here. AI, PDF, EPS and SVG are one click away if you need a copy that is certain to open.')] : []))
    }

    async function go() {
      if (busy) return
      busy = true
      result.replaceChildren()
      goBtn.disabled = true
      ctl.c = new AbortController()
      closeBtn.querySelector('span').textContent = 'Cancel'
      prog.set(null, 'Preparing')
      try {
        const res = await runExport(st.fmt, { ...st, pages: pageOpts(), selection: st.pages === 'selection' }, { signal: ctl.c.signal, onProgress: (f, t) => prog.set(f, t) })
        const f = res.files[0]
        result.replaceChildren(alert('success', h('strong', `Saved ${f.name}`), ` (${formatBytes(f.blob.size)}). Your browser keeps it in the downloads folder.`),
          res.notes.length ? h('div', h('strong', { class: 'small' }, 'Notes'), h('ul', { class: 'ds-list' }, res.notes.map((n) => h('li', n)))) : h('p', { class: 'small muted' }, 'No notes. Nothing was approximated.'))
      } catch (e) {
        if (isAbort(e)) result.replaceChildren(alert('info', 'Cancelled.'))
        else { console.error(e); result.replaceChildren(alert('error', errorMessage(e))) }
      } finally { busy = false; goBtn.disabled = false; prog.hide(); closeBtn.querySelector('span').textContent = quick ? 'Edit in Draw Studio' : 'Close'; ctl.c = null }
    }

    closeBtn = button(quick ? 'Edit in Draw Studio' : 'Close', { variant: 'secondary', onClick: () => { if (busy) ctl.c?.abort(); else m.close() } })
    goBtn = button('Save', { variant: 'primary', icon: 'download', onClick: go })
    m = modal({
      title: quick ? `Save as ${FORMATS[st.fmt].label}` : 'Save or export', icon: 'file-output',
      body: h('div', { class: 't-ds-dlg ds-export' }, field('Format', fmtSel), desc, pagesBox, optsBox, info, prog.el, result),
      actions: [closeBtn, goBtn],
      onClose: () => ctl.c?.abort(),
    })
    draw()
    return m
  }

  return { openNew, openPageSetup, openExport, runExport }
}
