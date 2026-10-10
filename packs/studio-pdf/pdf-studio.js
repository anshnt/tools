// PDF Studio: a full PDF editor in the browser. Entry module; the work is split over the _*.js files in this folder.
//   _store (state + undo)  _doc (open files)  _viewer (pages, zoom, text layer)  _tools (pointer + keyboard)
//   _annots (annotation model + SVG)  _text (text index, search)  _forms (AcroForm)  _sign (signature, stamps, images)
//   _panels (thumbnails, inspector, comments, search)  _export (pdf-lib writer)  _css (styles)
import { h, icon, button, modal, input, field, toggle, select, alert, progress, toast, download, formatBytes, errorMessage, dropzone, busy, clear } from '../../lib/ui.js'
import * as idb from '../../lib/idb.js'
import * as kv from '../../lib/store.js'
import { pickFiles, suffixName } from '../../lib/files.js'
import { createStore } from './_store.js'
import { injectCss } from './_css.js'
import { loadDoc, blankPdfBytes } from './_doc.js'
import { createViewer } from './_viewer.js'
import { createForms } from './_forms.js'
import { createSign } from './_sign.js'
import { createTools, TOOL_LIST } from './_tools.js'
import { createThumbs, createProps, createComments, createDocInfo, createSearch, ibtn } from './_panels.js'
import { buildPdf, summarize } from './_export.js'
import { DEFAULTS } from './_annots.js'
import { timeAgo } from './_geom.js'

const SESSION = 'pdf-studio:session'
const CREDIT = 'https://github.com/storytold/pdfcraft'
const START = {
  sign: { tool: 'signature', title: 'Sign a PDF', text: 'Open a PDF, then draw, type or upload your signature and place it on the page.' },
  redact: { tool: 'redact', title: 'Redact a PDF', text: 'Mark text or areas to remove for good. Saved files have the covered content really gone.' },
  organize: { panel: 'left', title: 'Organize PDF pages', text: 'Rotate, delete, reorder and insert pages from the thumbnails.' },
  forms: { right: 'doc', title: 'Fill a PDF form', text: 'Click the fields to type, tick boxes and choose options, then save.' },
}

export async function mount(root, { params = {}, signal } = {}) {
  injectCss()
  const phone = matchMedia('(max-width: 860px)').matches
  const store = createStore()
  const app = { store, assets: new Map(), styles: {}, search: { byPid: new Map(), list: [], cur: -1, q: '' }, doc: null, busy: false, params }
  app.author = () => kv.load('pdf-studio:author', '')
  app.setAuthor = (v) => kv.save('pdf-studio:author', v)
  app.styleOf = (t) => ({ ...DEFAULTS[t], ...app.styles[t] })
  const start = START[params.start] || null

  // ---------- skeleton ----------
  const rootEl = h('div', { class: 'pdfs', dataset: { tool: 'select', doc: 'off', left: phone ? 'off' : 'on', right: phone || innerWidth < 1100 ? 'off' : 'on', ff: 'on', search: 'off' } })
  app.root = rootEl
  rootEl.__app = app // handy for debugging in the console
  const viewer = createViewer(app); app.viewer = viewer
  app.forms = createForms(app)
  app.sign = createSign(app)
  app.tools = createTools(app)
  const thumbs = createThumbs(app)
  const props = createProps(app)
  const comments = createComments(app)
  const docInfo = createDocInfo(app)
  const search = createSearch(app)

  // ---------- toolbar ----------
  const nameEl = h('div', { class: 'doc-name', title: '' }, 'No file')
  const pageIn = h('input', { type: 'number', min: 1, value: 1, 'aria-label': 'Page number', onchange: (e) => viewer.goto((+e.target.value || 1) - 1) })
  const pageTotal = h('span', '/ 0')
  const zoomSel = select([['width', 'Fit width'], ['page', 'Fit page'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%']], 'width', (v) => viewer.setZoom(v === 'width' || v === 'page' ? v : +v))
  zoomSel.classList.add('zoom-sel')
  zoomSel.setAttribute('aria-label', 'Zoom')
  const undoBtn = ibtn('undo-2', 'Undo', () => store.undo()), redoBtn = ibtn('redo-2', 'Redo', () => store.redo())
  const searchBtn = ibtn('search', 'Search (Ctrl+F)', () => (rootEl.dataset.search === 'on' ? search.close() : search.open()), { class: 'tog' })
  const leftBtn = ibtn('panel-left', 'Page thumbnails', () => togglePanel('left'), { class: 'tog' })
  const rightBtn = ibtn('panel-right', 'Properties and comments', () => togglePanel('right'), { class: 'tog' })
  const saveBtn = button('Save PDF', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => saveDialog(), disabled: true, attrs: { 'data-tip': 'Save a copy (Ctrl+S)' } })
  const openBtn = button('Open', { icon: 'folder-open', size: 'sm', onClick: () => openDialog(), attrs: { 'data-tip': 'Open a PDF (Ctrl+O)' } })
  const newBtn = button('', { icon: 'file-plus', size: 'sm', ariaLabel: 'New blank PDF', onClick: () => newBlank(), attrs: { 'data-tip': 'New blank PDF' } })
  const top = h('div', { class: 'pdfs-top', role: 'toolbar', 'aria-label': 'Document' },
    h('div', { class: 'grp' }, openBtn, newBtn), nameEl, h('span', { class: 'sep' }),
    h('div', { class: 'grp' }, undoBtn, redoBtn), h('span', { class: 'sep' }),
    h('div', { class: 'pg-nav' }, ibtn('chevron-up', 'Previous page', () => viewer.goto(viewer.current - 1), { class: 'hide-sm' }), pageIn, pageTotal, ibtn('chevron-down', 'Next page', () => viewer.goto(viewer.current + 1), { class: 'hide-sm' })), h('span', { class: 'sep' }),
    h('div', { class: 'grp' }, ibtn('zoom-out', 'Zoom out (-)', () => viewer.zoomBy(-1), { class: 'hide-sm' }), zoomSel, ibtn('zoom-in', 'Zoom in (+)', () => viewer.zoomBy(1), { class: 'hide-sm' })), h('span', { class: 'sep' }),
    h('div', { class: 'grp tgl' }, searchBtn, leftBtn, rightBtn), h('span', { class: 'grow' }), saveBtn)

  // ---------- rail ----------
  const toolBtns = new Map()
  const rail = h('div', { class: 'pdfs-rail', role: 'toolbar', 'aria-orientation': 'vertical', 'aria-label': 'Tools' },
    TOOL_LIST.map((t) => {
      if (t.sep) return h('div', { class: 'rsep', 'aria-hidden': 'true' })
      const b = h('button', { type: 'button', class: 'tool-btn', 'aria-label': `${t.name} (${t.key})`, 'aria-pressed': String(t.id === 'select'), 'data-tip': t.tip ? `${t.name}: ${t.tip}` : t.name, 'data-key': t.key, onclick: () => { if (app.doc) store.setTool(t.id) } }, icon(t.icon))
      toolBtns.set(t.id, b)
      return b
    }))

  // ---------- right panel ----------
  const tabsDef = [['props', 'Properties', props.el], ['comments', 'Comments', comments.el], ['doc', 'Document', docInfo.el]]
  const tabBtns = new Map(), tabBodies = new Map()
  const rtabs = h('div', { class: 'rtabs', role: 'tablist' }, tabsDef.map(([id, label]) => {
    const b = h('button', { type: 'button', class: 'rtab', role: 'tab', 'aria-selected': String(id === 'props'), onclick: () => showRight(id) }, label, id === 'comments' ? h('span', { class: 'badge-n', hidden: true }) : null)
    tabBtns.set(id, b)
    return b
  }))
  const rbody = h('div', { class: 'rbody' }, tabsDef.map(([id, , el]) => { const w = h('div', { role: 'tabpanel', hidden: id !== 'props' }, el); tabBodies.set(id, w); return w }))
  function showRight(id) {
    for (const [k, b] of tabBtns) b.setAttribute('aria-selected', String(k === id))
    for (const [k, w] of tabBodies) w.hidden = k !== id
    if (rootEl.dataset.right === 'off') togglePanel('right', true)
  }
  app.showRight = showRight
  app.setBadge = (id, n) => { const b = tabBtns.get(id)?.querySelector('.badge-n'); if (b) { b.hidden = !n; b.textContent = n } }
  app.panels = { focusComment: (id) => comments.focus(id), refresh: () => { props.refresh(); comments.refresh() }, docRefresh: () => docInfo.refresh() }
  function togglePanel(side, on) {
    const cur = rootEl.dataset[side] === 'on'
    const next = on ?? !cur
    rootEl.dataset[side] = next ? 'on' : 'off'
    if (next && matchMedia('(max-width: 860px)').matches) rootEl.dataset[side === 'left' ? 'right' : 'left'] = 'off'
    leftBtn.setAttribute('aria-pressed', String(rootEl.dataset.left === 'on')); rightBtn.setAttribute('aria-pressed', String(rootEl.dataset.right === 'on'))
  }
  leftBtn.setAttribute('aria-pressed', String(!phone)); rightBtn.setAttribute('aria-pressed', String(rootEl.dataset.right === 'on'))

  // ---------- empty / loading state ----------
  // The card (with its dropzone) stays in the DOM while a document is open, so files dropped on the page still reach it.
  const emptyEl = h('div', { class: 'pdfs-empty' })
  const resumeBox = h('div')
  const zone = dropzone({ accept: '.pdf,application/pdf', label: 'Drop a PDF here or click to choose', hint: 'Opens right here in your browser. Nothing is uploaded.', onFiles: ([f]) => openFile(f) })
  const loadingText = h('strong', 'Opening')
  const loadingCard = h('div', { class: 'empty-card', hidden: true }, h('div', { class: 'row' }, h('span', { class: 'spinner' }), loadingText))
  const title = start?.title || 'Open a PDF to start editing'
  const emptyCard = h('div', { class: 'empty-card' },
    h('div', h('h2', title), h('p', start?.text || 'Annotate, highlight, comment, fill forms, sign, redact and organize pages. Everything runs on your device.')),
    zone, resumeBox,
    h('div', { class: 'empty-actions' }, button('Choose a PDF', { icon: 'folder-open', variant: 'primary', onClick: () => openDialog() }), button('Start with a blank page', { icon: 'file-plus', onClick: () => newBlank() })),
    h('ul', { class: 'empty-feats' }, ...[['highlighter', 'Highlight, underline, strike'], ['message-square-plus', 'Notes and comments'], ['signature', 'Signatures and stamps'], ['eye-off', 'True redaction'], ['text-cursor-input', 'Fill forms'], ['layout-grid', 'Organize pages']].map(([ic, t]) => h('li', icon(ic), t))))
  emptyEl.append(emptyCard, loadingCard)
  function showEmpty() { emptyCard.hidden = false; loadingCard.hidden = true; emptyEl.hidden = false }
  function showLoading(text) { loadingText.textContent = text; emptyCard.hidden = true; loadingCard.hidden = false; emptyEl.hidden = false }

  // ---------- status ----------
  const statusEl = h('span', 'Ready')
  const savedEl = h('span', { class: 'hide-sm' })
  const foot = h('div', { class: 'pdfs-foot' }, h('div', { class: 'row tight' }, statusEl, savedEl),
    h('span', { class: 'credit' }, 'Prefer a native app? ', h('a', { href: CREDIT, target: '_blank', rel: 'noopener' }, 'PDFCraft by ArtCraft'), ' is free and open source.'))
  function updateStatus() {
    if (!app.doc) { statusEl.textContent = 'Ready'; return }
    const n = store.state.annots.length
    statusEl.textContent = `Page ${viewer.current + 1} of ${store.state.pages.length} · ${Math.round(viewer.zoom * 100)}% · ${n} annotation${n === 1 ? '' : 's'}${store.dirty ? ' · unsaved changes' : ''}`
    nameEl.replaceChildren(...(store.dirty ? [h('span', { class: 'dot', title: 'Unsaved changes' })] : []), app.doc.name)
    nameEl.title = app.doc.name
    pageTotal.textContent = `/ ${store.state.pages.length}`
    pageIn.max = store.state.pages.length
  }
  function updateUndo() {
    undoBtn.disabled = !store.undoStack.length; redoBtn.disabled = !store.redoStack.length
    undoBtn.dataset.tip = store.undoStack.length ? `Undo ${store.undoStack.at(-1).label} (Ctrl+Z)` : 'Undo (Ctrl+Z)'
    redoBtn.dataset.tip = store.redoStack.length ? `Redo ${store.redoStack.at(-1).label} (Ctrl+Y)` : 'Redo (Ctrl+Y)'
  }
  viewer.onPage = (i) => { pageIn.value = i + 1; thumbs.syncSel(); updateStatus() }
  viewer.onZoom = (z, mode) => {
    const preset = mode === 'custom' ? [...zoomSel.options].find((o) => o.value !== 'width' && o.value !== 'page' && !o.dataset.custom && Math.abs(+o.value - z) < 0.01)?.value : mode
    zoomSel.querySelector('[data-custom]')?.remove()
    if (preset) zoomSel.value = preset
    else { const o = h('option', { value: String(z), dataset: { custom: '1' } }, `${Math.round(z * 100)}%`); zoomSel.append(o); zoomSel.value = String(z) }
    updateStatus()
  }
  store.on((type, d) => {
    if (type === 'tool') {
      rootEl.dataset.tool = d.tool
      for (const [id, b] of toolBtns) b.setAttribute('aria-pressed', String(id === d.tool))
    }
    if (type === 'change') { updateUndo(); updateStatus(); schedulePersist() }
    if (type === 'sel' && store.sel && rootEl.dataset.right === 'on' && !tabBodies.get('doc').hidden) showRight('props')
  })
  updateUndo()

  // ---------- assemble ----------
  const view = h('div', { class: 'pdfs-view' }, viewer.el, emptyEl)
  const left = h('aside', { class: 'pdfs-side left', 'aria-label': 'Pages' }, thumbs.el)
  const right = h('aside', { class: 'pdfs-side right', 'aria-label': 'Inspector' }, rtabs, rbody)
  rootEl.append(top, search.bar, h('div', { class: 'pdfs-main' }, rail, left, view, right), foot)
  root.append(rootEl)

  // ---------- tooltips ----------
  const tip = h('div', { class: 'pdfs-tip', role: 'tooltip' })
  rootEl.append(tip)
  let tipFor = null
  const showTip = (t) => {
    if (!t?.dataset.tip) return
    tipFor = t
    tip.replaceChildren(t.dataset.tip, ...(t.dataset.key ? [h('kbd', t.dataset.key)] : []))
    const r = t.getBoundingClientRect(), box = rootEl.getBoundingClientRect(), side = t.classList.contains('tool-btn') && !matchMedia('(max-width: 860px)').matches
    tip.classList.add('on')
    const tw = tip.offsetWidth, th = tip.offsetHeight
    const x = side ? r.right + 10 - box.left : Math.min(Math.max(8, r.left + r.width / 2 - tw / 2 - box.left), box.width - tw - 8)
    const y = (side ? r.top + r.height / 2 - th / 2 : r.bottom + 8) - box.top
    tip.style.left = `${x}px`; tip.style.top = `${Math.min(Math.max(4, y), box.height - th - 4)}px`
  }
  const hideTip = () => { tipFor = null; tip.classList.remove('on') }
  rootEl.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') { const t = e.target.closest?.('[data-tip]'); t ? showTip(t) : hideTip() } })
  rootEl.addEventListener('pointerleave', hideTip)
  rootEl.addEventListener('pointerdown', hideTip)
  rootEl.addEventListener('focusin', (e) => { if (e.target.matches?.(':focus-visible') && e.target.dataset?.tip) showTip(e.target) })
  rootEl.addEventListener('focusout', hideTip)

  // ---------- dialogs ----------
  const ask = (title, text, ok = 'Continue') => new Promise((resolve) => {
    let v = false
    const m = modal({ title, body: h('p', text), actions: [button('Cancel', { onClick: () => m.close() }), button(ok, { variant: 'primary', onClick: () => { v = true; m.close() } })], onClose: () => resolve(v) })
  })
  const askPassword = (name, wrong) => new Promise((resolve) => {
    let v = null
    const pw = input({ type: 'password', autocomplete: 'off', placeholder: 'Password', 'aria-label': 'PDF password' })
    const go = () => { v = pw.value; m.close() }
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go() } })
    const m = modal({
      title: 'Password needed', icon: 'lock-keyhole',
      body: h('div', { class: 'stack' }, h('p', `${name} is protected.${wrong ? ' That password did not work.' : ''} Enter its password to open it. The file stays on your device.`), field('Password', pw)),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Open', { variant: 'primary', onClick: go })], onClose: () => resolve(v),
    })
    setTimeout(() => pw.focus(), 50)
  })

  // ---------- open / new ----------
  async function guardDiscard() {
    if (!app.doc || !store.dirty) return true
    return ask('Discard unsaved changes?', 'You have edits that have not been saved to a PDF. Opening another file replaces them.', 'Discard and continue')
  }
  async function openDialog() {
    const [f] = await pickFiles({ accept: '.pdf,application/pdf' })
    if (f) openFile(f)
  }
  async function openFile(file) {
    if (!file) return
    if (file.size > 300 * 1024 * 1024) return toast('That file is over 300 MB, which is too large to edit comfortably in a browser.', 'error')
    if (!(await guardDiscard())) return
    await openBytes(new Uint8Array(await file.arrayBuffer()), file.name || 'document.pdf')
  }
  async function newBlank() {
    if (!(await guardDiscard())) return
    await openBytes(await blankPdfBytes(), 'Untitled.pdf')
  }
  async function openBytes(bytes, name, { state, assets } = {}) {
    app.busy = true
    showLoading(`Opening ${name}`)
    try {
      let password, res
      for (;;) {
        try { res = await loadDoc(bytes, name, { password }); break } catch (e) {
          if (e.code !== 'PASSWORD') throw e
          password = await askPassword(name, password != null)
          if (password == null) { app.busy = false; if (app.doc) emptyEl.hidden = true; else showEmpty(); return }
        }
      }
      app.doc?.destroy()
      for (const a of app.assets.values()) URL.revokeObjectURL(a.url)
      app.assets.clear()
      for (const a of assets || []) app.assets.set(a.id, { ...a, url: URL.createObjectURL(new Blob([a.bytes], { type: a.mime })) })
      app.doc = res.doc
      app.search.byPid = new Map(); app.search.list = []; app.search.cur = -1
      app.tools.cancel()
      store.setTool('select')
      store.reset(state ? JSON.parse(state) : { pages: res.pages, annots: [], fields: {} })
      rootEl.dataset.doc = 'on'
      saveBtn.disabled = false
      document.body.classList.add('pdfs-open')
      emptyEl.hidden = true
      thumbs.reset(); props.refresh(); comments.refresh(true); docInfo.refresh(); updateStatus(); updateUndo()
      viewer.el.scrollTop = 0
      if (matchMedia('(max-width: 860px)').matches) rootEl.scrollIntoView({ block: 'start' })
      idb.set(`${SESSION}:file`, { name, bytes: res.doc.bytes })
      if (!state) {
        app.forms.scan()
        if (start?.tool) store.setTool(start.tool)
        if (start?.panel) togglePanel(start.panel, true)
        if (start?.right) showRight(start.right)
      }
    } catch (e) {
      console.error(e)
      toast(errorMessage(e), 'error')
      if (app.doc) emptyEl.hidden = true; else showEmpty()
    } finally {
      app.busy = false
    }
  }
  app.open = openDialog

  // ---------- autosave and restore ----------
  let persistT
  const persist = async () => {
      clearTimeout(persistT)
      if (!app.doc || app.doc.bytes.length > 80e6) return
      const ok = await idb.set(`${SESSION}:state`, { name: app.doc.name, state: store.snap(), assets: [...app.assets.values()].map(({ id, mime, bytes, w, h: hh }) => ({ id, mime, bytes, w, h: hh })), t: Date.now() })
      if (ok) savedEl.textContent = `Autosaved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
  const schedulePersist = () => { clearTimeout(persistT); persistT = setTimeout(persist, 800) }
  const onHide = () => { if (document.visibilityState === 'hidden' && store.dirty) persist() }
  document.addEventListener('visibilitychange', onHide)
  ;(async () => {
    const [file, st] = await Promise.all([idb.get(`${SESSION}:file`), idb.get(`${SESSION}:state`)])
    if (signal?.aborted || !file || !st || app.doc || file.name !== st.name) return
    const n = JSON.parse(st.state).annots.length
    clear(resumeBox, h('div', { class: 'resume' }, h('span', h('strong', st.name), ` · ${n} annotation${n === 1 ? '' : 's'} · ${timeAgo(st.t)}`),
      h('div', { class: 'row tight' }, button('Resume', { size: 'sm', variant: 'primary', icon: 'history', onClick: () => openBytes(file.bytes, file.name, { state: st.state, assets: st.assets }) }),
        button('Discard', { size: 'sm', variant: 'ghost', onClick: async () => { await idb.del(`${SESSION}:file`); await idb.del(`${SESSION}:state`); clear(resumeBox) } }))))
  })()

  // ---------- save ----------
  function saveDialog() {
    if (!app.doc || app.busy) return
    const sum = summarize(store)
    const name = input({ value: suffixName(app.doc.name, 'edited', 'pdf'), 'aria-label': 'File name' })
    const flatten = toggle('Flatten annotations into the page (cannot be edited later)', false)
    const flattenForms = app.doc.fieldCount ? toggle('Flatten form fields (make the filled values permanent)', false) : null
    const dpi = sum.redactions ? select([['150', '150 dpi (smaller file)'], ['200', '200 dpi (recommended)'], ['300', '300 dpi (sharper)']], '200') : null
    const prog = progress('Saving')
    const result = h('div')
    const lines = [
      `${sum.pages} page${sum.pages === 1 ? '' : 's'}`, `${sum.annots} annotation${sum.annots === 1 ? '' : 's'}`,
      ...(sum.fields ? [`${sum.fields} form value${sum.fields === 1 ? '' : 's'}`] : []),
    ]
    const go = button('Save PDF', { variant: 'primary', icon: 'download' })
    go.addEventListener('click', () => busy(go, async () => {
      clear(result)
      app.busy = true
      try {
        const res = await buildPdf(app, { flatten: flatten.input.checked, flattenForms: flattenForms?.input.checked, redactDpi: dpi ? +dpi.value : 200, onProgress: (f, t) => prog.set(f, t) })
        const fname = (name.value.trim() || 'edited.pdf').replace(/(\.pdf)?$/i, '.pdf')
        store.dirty = false
        download(res.blob, fname)
        updateStatus()
        clear(result, alert('success', h('strong', 'Saved. '), `${fname}, ${formatBytes(res.blob.size)}, ${res.stats.pages} pages${res.stats.annotations ? `, ${res.stats.annotations} annotations kept editable` : ''}${res.stats.flattened ? `, ${res.stats.flattened} flattened` : ''}${res.stats.redactedPages ? `, ${res.stats.redactedPages} page${res.stats.redactedPages === 1 ? '' : 's'} redacted` : ''}.`,
          ...res.notes.map((n) => h('div', { class: 'small' }, n))))
      } finally { app.busy = false }
    }, { label: 'Saving', errorTo: result, progress: prog }))
    modal({
      title: 'Save PDF', icon: 'download',
      body: h('div', { class: 'stack' },
        h('div', { class: 'small muted' }, lines.join(' · ')),
        field('File name', name), flatten, flattenForms, app.doc.password ? alert('info', 'The original is password-protected. The saved copy is not.') : null,
        sum.redactions ? h('div', { class: 'stack' }, alert('warn', h('strong', `${sum.redactions} redaction${sum.redactions === 1 ? '' : 's'} on ${sum.redactedPages} page${sum.redactedPages === 1 ? '' : 's'}. `), 'Those pages are rebuilt as images so the covered text is really removed. Their text is no longer selectable or searchable, and bookmarks and links are dropped.'), field('Redacted page quality', dpi)) : null,
        h('div', { class: 'small muted' }, 'Highlights, notes, shapes, text and images are written as standard PDF annotations that other PDF apps can still edit. White-outs are always flattened.'),
        prog.el, result),
      actions: [go],
    })
  }
  app.save = saveDialog

  // ---------- global handlers ----------
  const onDragOver = (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault() }
  const onDrop = (e) => {
    const f = [...(e.dataTransfer?.files || [])].find((x) => /pdf/i.test(x.type) || /\.pdf$/i.test(x.name))
    if (!f) return
    e.preventDefault(); e.stopPropagation()
    openFile(f)
  }
  rootEl.addEventListener('dragover', onDragOver)
  rootEl.addEventListener('drop', onDrop)
  const onBeforeUnload = (e) => { if (store.dirty) { e.preventDefault(); e.returnValue = '' } }
  window.addEventListener('beforeunload', onBeforeUnload)

  return () => {
    clearTimeout(persistT)
    window.removeEventListener('beforeunload', onBeforeUnload)
    document.removeEventListener('visibilitychange', onHide)
    document.body.classList.remove('pdfs-open')
    app.tools.destroy(); thumbs.destroy(); props.destroy(); comments.destroy(); docInfo.destroy(); search.destroy(); viewer.destroy()
    app.doc?.destroy()
    for (const a of app.assets.values()) URL.revokeObjectURL(a.url)
    rootEl.remove()
  }
}
