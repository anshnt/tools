// Dialogs and the start gallery: new document, open, export, shortcuts.
import { h, icon, button, modal, alert, progress, busy, segmented, toggle, field, select, input, download, formatBytes, toast, empty } from '../../lib/ui.js'
import { PAGE_PRESETS, UNITS, newDoc, toUnit } from './_model.js'
import { TEMPLATES } from './_templates.js'
import { Store } from './_state.js'
import { Scene, renderToCanvas } from './_render.js'
import { exportPdf, exportRasterPdf, exportPngs, zipPngs, printDoc, pageList } from './_export.js'
import { safeName } from '../../lib/files.js'

const thumbCache = new Map()

/** Render page 1 of a template into a canvas (cached). */
async function templateThumb(id, width) {
  if (thumbCache.has(id)) return thumbCache.get(id)
  const t = TEMPLATES.find((x) => x.id === id)
  const { doc, assets } = t.make()
  const store = new Store(doc)
  for (const a of assets) store.assets.set(a.id, a)
  const scene = new Scene(store, () => {})
  await scene.preload()
  const c = renderToCanvas(scene, doc.pages[0], { scale: (width * 2) / doc.w, index: 0 })
  thumbCache.set(id, c)
  return c
}

/** Gallery of templates plus a blank custom document form. */
export function templateGallery({ onPick, onCustom, onOpenFile, recents = [], onOpenRecent }) {
  const grid = h('div', { class: 'ls-gallery' })
  for (const t of TEMPLATES) {
    const slot = h('div', { class: 'ls-thumb' }, h('div', { class: 'ls-thumb-ph' }, icon('layout-template')))
    const card = h('button', { type: 'button', class: 'ls-card', 'data-template': t.id, onclick: () => onPick(t.id) }, slot, h('strong', t.name), h('span', t.size), h('small', t.desc))
    grid.append(card)
  }
  ;(async () => {
    for (const t of TEMPLATES) {
      try {
        const c = await templateThumb(t.id, 220)
        const slot = grid.querySelector(`[data-template="${t.id}"] .ls-thumb`)
        if (!slot) return
        const copy = h('canvas', { width: c.width, height: c.height, 'aria-hidden': 'true' })
        copy.getContext('2d').drawImage(c, 0, 0)
        slot.replaceChildren(copy)
      } catch { /* thumbnails are optional */ }
    }
  })()
  return h('div', { class: 'ls-start' },
    h('h3', 'Start from a template'), grid,
    h('div', { class: 'ls-rowbar' }, button('Custom document', { icon: 'ruler', onClick: onCustom }), button('Open project file', { icon: 'folder-open', variant: 'ghost', onClick: onOpenFile })),
    recents.length ? h('div', [h('h3', 'Recent'), h('div', { class: 'ls-recent' }, recents.slice(0, 4).map((r) => h('button', { type: 'button', class: 'ls-card compact', onclick: () => onOpenRecent(r.id) }, r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('div', { class: 'ls-thumb-ph' }, icon('file-text')), h('strong', r.name), h('small', `${r.pages} page${r.pages > 1 ? 's' : ''}`))))]) : null)
}

export function customDocDialog({ onCreate, unit = 'mm' }) {
  const st = { preset: 'A4', land: false, w: 210, h: 297, margin: 15, cols: 1, gutter: 5, bleed: 0, pages: 1, unit, name: 'Untitled layout' }
  const setPreset = (id) => {
    const p = PAGE_PRESETS.find((x) => x[0] === id)
    st.preset = id
    if (!p) return
    const [w, h2] = st.land ? [p[3], p[2]] : [p[2], p[3]]
    st.w = toUnit(w, st.unit); st.h = toUnit(h2, st.unit)
    sync()
  }
  const num = (key, label, min = 0, step = 'any') => {
    const i = h('input', { class: 'input', type: 'number', min, step, value: st[key], 'aria-label': label, oninput: (e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) { st[key] = v; if (key === 'w' || key === 'h') { st.preset = 'Custom'; preset.value = 'Custom' } } } })
    ;(num.refs ||= {})[key] = i
    return field(label, i)
  }
  const sync = () => { for (const [k, i] of Object.entries(num.refs || {})) if (document.activeElement !== i) i.value = st[k] }
  const preset = select([...PAGE_PRESETS.map((p) => [p[0], p[1]]), ['Custom', 'Custom size']], st.preset, setPreset)
  const unitSel = select(Object.keys(UNITS), st.unit, (u) => {
    const f = UNITS[st.unit].f, g = UNITS[u].f
    for (const k of ['w', 'h', 'margin', 'gutter', 'bleed']) st[k] = Math.round(((st[k] * f) / g) * 1000) / 1000
    st.unit = u
    sync()
  })
  const orient = segmented([['portrait', 'Portrait'], ['landscape', 'Landscape']], 'portrait', (v) => { const land = v === 'landscape'; if (land !== st.land) { st.land = land; [st.w, st.h] = [st.h, st.w]; sync() } }, 'Orientation')
  const body = h('div', { class: 'stack' },
    field('Name', input({ value: st.name, oninput: (e) => { st.name = e.target.value } })),
    h('div', { class: 'ls-grid2' }, field('Page size', preset), field('Units', unitSel)), orient,
    h('div', { class: 'ls-grid2' }, num('w', 'Width', 1), num('h', 'Height', 1)),
    h('div', { class: 'ls-grid2' }, num('margin', 'Margins'), num('bleed', 'Bleed')),
    h('div', { class: 'ls-grid2' }, num('cols', 'Columns', 1, 1), num('gutter', 'Column gutter')),
    num('pages', 'Number of pages', 1, 1))
  const m = modal({
    title: 'Custom document', icon: 'ruler', body,
    actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Create document', {
      variant: 'primary', icon: 'check',
      onClick: () => {
        const f = UNITS[st.unit].f
        if (!(st.w > 0 && st.h > 0)) return toast('Enter a width and height.', 'error')
        const doc = newDoc({ w: st.w * f, h: st.h * f, bleed: Math.max(0, st.bleed) * f, margin: Math.max(0, st.margin) * f, cols: Math.min(12, Math.max(1, Math.round(st.cols))), gutter: Math.max(0, st.gutter) * f, pages: Math.min(200, Math.max(1, Math.round(st.pages))), name: st.name || 'Untitled layout', unit: st.unit })
        m.close()
        onCreate({ doc, assets: [] })
      },
    })],
  })
  return m
}

export function shortcutsDialog() {
  const k = (...keys) => h('span', keys.map((x, i) => [i ? ' ' : '', h('kbd', x)]))
  const rows = [
    ['Tools', ''], [k('V'), 'Select'], [k('T'), 'Text frame'], [k('I'), 'Image frame'], [k('R'), 'Rectangle'], [k('O'), 'Ellipse'], [k('L'), 'Line'], [k('H'), 'Hand (or hold Space)'],
    ['Editing', ''], [k('Ctrl', 'Z'), 'Undo'], [k('Ctrl', 'Shift', 'Z'), 'Redo'], [k('Ctrl', 'C') , 'Copy, then Ctrl V to paste, Ctrl D to duplicate'], [k('Delete'), 'Delete the selection'], [k('Arrows'), 'Nudge (Shift for 10)'],
    [k('Enter'), 'Edit text in the selected frame'], [k('Esc'), 'Leave text, cancel threading, deselect'], [k('Alt', 'drag'), 'Duplicate while moving'], [k('Shift', 'drag'), 'Keep proportions, constrain angle or axis'],
    [k('Ctrl', ']'), 'Bring forward (add Shift for front)'], [k('Ctrl', '['), 'Send backward (add Shift for back)'],
    ['View', ''], [k('Ctrl', '0'), 'Fit page'], [k('Ctrl', '1'), '100%'], [k('Ctrl', '+'), 'Zoom in'], [k('Ctrl', '-'), 'Zoom out'], [k('Ctrl', 'wheel'), 'Zoom at the pointer'], [k('PageUp'), 'Previous page'], [k('PageDown'), 'Next page'],
    ['File', ''], [k('Ctrl', 'S'), 'Save project file'], [k('Ctrl', 'E'), 'Export'], [k('Ctrl', 'O'), 'Open'], [k('Ctrl', 'N'), 'New document'],
    ['Text', ''], [k('Ctrl', 'B'), 'Bold'], [k('Ctrl', 'I'), 'Italic'], [k('Ctrl', 'U'), 'Underline'],
  ]
  return modal({
    title: 'Keyboard shortcuts', icon: 'keyboard',
    body: h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('tbody', rows.map(([a, b]) => (b === '' ? h('tr', h('th', { colspan: 2, scope: 'colgroup' }, a)) : h('tr', h('td', a), h('td', b))))))),
  })
}

export function openDialog({ recents, onOpen, onDelete, onFile }) {
  const list = h('div', { class: 'ls-recentlist' })
  const draw = () => {
    list.replaceChildren(...(recents.length ? recents.map((r) => h('div', { class: 'ls-recentrow' },
      r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('div', { class: 'ls-thumb-ph' }, icon('file-text')),
      h('div', { class: 'meta' }, h('strong', r.name), h('small', `${r.pages} page${r.pages > 1 ? 's' : ''}, saved ${new Date(r.updated).toLocaleString()}`)),
      button('Open', { size: 'sm', variant: 'primary', onClick: () => { m.close(); onOpen(r.id) } }),
      button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Delete ${r.name}`, onClick: async () => { await onDelete(r.id); recents.splice(recents.indexOf(r), 1); draw() } }))) : [empty('No saved documents yet. Everything you make is saved in this browser automatically.', 'folder-open')]))
  }
  draw()
  const m = modal({ title: 'Open', icon: 'folder-open', body: h('div', { class: 'stack' }, list, button('Open a project file (.zip)', { icon: 'upload', onClick: () => { m.close(); onFile() } })) })
  return m
}

/** Export dialog: vector PDF, image PDF, PNG pages, print. */
export function exportDialog({ store, scene }) {
  const doc = store.doc
  const o = { kind: 'pdf', pages: '', bleed: false, marks: false, dpi: 300 }
  const prog = progress()
  const result = h('div')
  const kind = segmented([['pdf', 'PDF (selectable text)'], ['rpdf', 'PDF (images)'], ['png', 'PNG pages']], 'pdf', (v) => { o.kind = v; refresh() }, 'Export format')
  const pages = input({ placeholder: `All ${doc.pages.length} page${doc.pages.length > 1 ? 's' : ''}, or e.g. 1-3, 5`, 'aria-label': 'Pages to export', oninput: (e) => { o.pages = e.target.value } })
  const bleed = toggle(`Include bleed (${toUnit(doc.bleed, doc.unit)} ${doc.unit})`, false, (v) => { o.bleed = v; refresh() })
  if (!(doc.bleed > 0)) { bleed.input.disabled = true }
  const marks = toggle('Crop marks (needs bleed)', false, (v) => { o.marks = v })
  const dpi = select([['150', '150 dpi (screen and office printers)'], ['300', '300 dpi (print)'], ['600', '600 dpi (fine print, large files)']], '300', (v) => { o.dpi = +v })
  const note = h('p', { class: 'small muted' })
  const dpiField = field('Resolution', dpi)
  const btn = button('Export', { variant: 'primary', icon: 'download', size: 'lg' })
  const printBtn = button('Print', { icon: 'printer', variant: 'secondary', size: 'lg' })
  function refresh() {
    marks.hidden = o.kind !== 'pdf'
    dpiField.hidden = o.kind === 'pdf'
    marks.input.disabled = !o.bleed
    if (!o.bleed) { marks.input.checked = false; o.marks = false }
    note.textContent = o.kind === 'pdf' ? 'Real text and vector shapes, with the fonts embedded. Text stays selectable and searchable, and the file is small.'
      : o.kind === 'rpdf' ? 'Every page is rendered as one picture. Text is not selectable, but it looks identical everywhere. Use it if a font or viewer misbehaves.'
        : 'One PNG per page. Several pages are delivered as a ZIP.'
  }
  const run = (mode) => async () => {
    result.replaceChildren()
    pageList(o.pages, store.doc.pages.length) // validates the range early
    const base = safeName(store.doc.name)
    const popts = { bleed: o.bleed, marks: o.marks, pages: o.pages, onProgress: (f, t) => prog.set(f, t) }
    prog.set(null, 'Preparing')
    if (mode === 'print') { await printDoc(scene, { dpi: 150, bleed: o.bleed }); result.replaceChildren(alert('success', 'Opened the print dialog. Choose "Save as PDF" there if you want a file.')); return }
    if (o.kind === 'png') {
      const files = await exportPngs(scene, { dpi: o.dpi, bleed: o.bleed, pages: o.pages, onProgress: popts.onProgress })
      if (files.length === 1) download(files[0].blob, files[0].name)
      else download(await zipPngs(files), `${base}-pages.zip`)
      result.replaceChildren(alert('success', h('strong', 'Done. '), `${files.length} PNG file${files.length > 1 ? 's' : ''} at ${o.dpi} dpi.`))
      return
    }
    let blob
    if (o.kind === 'pdf') {
      try { blob = await exportPdf(scene, popts) } catch (e) {
        if (e.code !== 'FONTS') throw e
        const retry = button('Export as an image PDF instead', { size: 'sm', variant: 'primary', onClick: async () => { kind.set('rpdf'); o.kind = 'rpdf'; refresh(); btn.click() } })
        result.replaceChildren(alert('warn', e.message, h('div', { style: 'margin-top:8px' }, retry)))
        return
      }
    } else blob = await exportRasterPdf(scene, { dpi: o.dpi, ...popts })
    download(blob, `${base}.pdf`)
    result.replaceChildren(alert('success', h('strong', 'Done. '), `${o.pages ? pageList(o.pages, store.doc.pages.length).length : store.doc.pages.length} page(s), ${formatBytes(blob.size)}. ${o.kind === 'pdf' ? 'Text is selectable.' : 'Pages are images.'}`))
    if (blob.replaced) result.append(alert('warn', `${blob.replaced} character${blob.replaced > 1 ? 's were' : ' was'} not in the bundled Latin fonts and show as ? in the PDF. Use the image PDF to keep every character exactly as it looks on screen.`))
  }
  btn.addEventListener('click', () => busy(btn, run('export'), { label: 'Exporting', errorTo: result, progress: prog }))
  printBtn.addEventListener('click', () => busy(printBtn, run('print'), { label: 'Preparing', errorTo: result, progress: prog }))
  refresh()
  const m = modal({
    title: 'Export', icon: 'download',
    body: h('div', { class: 'stack' }, kind, field('Pages', pages), bleed, marks, dpiField, note, h('div', { class: 'row' }, btn, printBtn), prog.el, result),
  })
  return m
}
