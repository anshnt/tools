// Docs: a browser word processor. Entry module. The editor engine is ProseMirror (vendored in ./vendor), everything else lives in
// the _*.js helpers next to this file: schema, commands, toolbar, panels, storage, import and export.
import { h, icon, toast, modal, button, dropzone, download, formatNumber, errorMessage, debounce } from '../../lib/ui.js'
import { pickFiles, safeName } from '../../lib/files.js'
import { state as PS } from './vendor/prosemirror.js'
import { schema, htmlToDoc, jsonToDoc, docText, wordCount, FONT_STACK } from './_schema.js'
import { injectStyles } from './_style.js'
import { createEditor } from './_editor.js'
import * as cmd from './_cmd.js'
import { createToolbar } from './_toolbar.js'
import { tbtn, createPopovers, menuItem, sep } from './_ui.js'
import { createDocsPanel, createOutline, createPagePanel, shortcutSheet } from './_panels.js'
import { defaultSettings, normSettings, pagePx, contentWidthPx } from './_page.js'
import { WELCOME, templateById } from './_templates.js'
import { importFile, OPEN_ACCEPT } from './_import.js'
import { buildHtml, printHtml, exportMarkdown, exportText, projectJson } from './_export.js'
import { setQuery, stepMatch, replaceCurrent, replaceAll, findState, selectMatch } from './_find.js'
import { fileToImageAttrs } from './_img.js'
import * as store from './_store.js'

const { TextSelection } = PS
const credit = () => h('div', { class: 'dc-credit' }, 'Prefer a native app? ',
  h('a', { href: 'https://github.com/storytold/wordcraft', target: '_blank', rel: 'noopener' }, 'WordCraft by ArtCraft'), ' is free and open source.')

export async function mount(root, { params = {}, signal } = {}) {
  injectStyles()
  const prefs = store.prefs
  const S = {
    id: null, title: 'Untitled document', created: 0, template: null, untouched: false, version: 0, savedVersion: 0,
    settings: defaultSettings(), view: null, zoom: 1, pages: 1, panel: null, docs: [], dead: false,
  }
  const timers = new Set()
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }

  // ---------- DOM ----------
  const t = h('div', { class: 't-docs', role: 'application', 'aria-label': 'Document editor' })
  root.append(t)
  const pop = createPopovers(t)

  const title = h('input', { class: 'dc-title', type: 'text', 'aria-label': 'Document title', maxlength: 120, spellcheck: 'false',
    oninput: () => { S.title = title.value; dirty() },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focus() } } })
  const savedIcon = h('span')
  const savedText = h('span', 'Saved')
  const saved = h('span', { class: 'dc-saved', role: 'status', 'aria-live': 'polite' }, savedIcon, savedText)
  const setSaved = (text, warn = false, ic = warn ? 'cloud-off' : 'cloud-check') => {
    savedText.textContent = text
    saved.classList.toggle('warn', warn)
    savedIcon.replaceChildren(icon(ic))
  }

  const menuBtn = tbtn('panel-left', { tip: 'Documents and pages', cls: 'dc-menu-btn', onClick: () => togglePanel(S.panel || 'docs') })
  const openBtn = tbtn('folder-open', { tip: 'Open a file (Ctrl+O)', label: 'Open', cls: 'hide-sm', onClick: () => pickOpen() })
  const newBtn = tbtn('file-plus', { tip: 'New blank document', label: 'New', cls: 'hide-sm', onClick: () => newDoc('blank') })
  const findBtn = tbtn('search', { tip: 'Find and replace (Ctrl+F)', onClick: () => openFind(false) })
  const exportBtn = h('button', { type: 'button', class: 'dc-btn primary', 'aria-haspopup': 'true', onclick: () => openExportMenu(), 'data-tip': 'Download or print' }, icon('download'), h('span', 'Download'))
  const top = h('div', { class: 'dc-top' }, menuBtn, title, saved,
    h('div', { class: 'dc-top-actions' }, openBtn, newBtn, findBtn, sep(), exportBtn))

  // toolbar is created once the editor exists (it needs app.run); placeholders keep the layout stable
  const toolsSlot = h('div')
  const ctxSlot = h('div', { style: 'display:contents' })

  // side panels
  const docsPanel = createDocsPanel({
    newDoc: (id) => newDoc(id), openDoc: (id) => openDoc(id), duplicateDoc: (id) => duplicateDoc(id), deleteDoc: (id) => deleteDoc(id),
    openFile: (f) => openFile(f), currentId: () => S.id,
  })
  const outline = createOutline({ gotoPos: (pos) => gotoPos(pos) })
  const pagePanel = createPagePanel({ settings: () => S.settings, setSettings: (p) => setSettings(p) })
  const panes = { docs: docsPanel.el, outline: outline.el, page: pagePanel.el }
  const PANEL_TITLES = { docs: 'Documents', outline: 'Outline', page: 'Page setup' }
  const sideTitle = h('h2', 'Documents')
  const seg = h('div', { class: 'dc-seg', role: 'group', 'aria-label': 'Panel' },
    Object.entries({ docs: 'Documents', outline: 'Outline', page: 'Page' }).map(([k, l]) => h('button', { type: 'button', 'data-k': k, 'aria-pressed': 'false', onclick: () => togglePanel(k, true) }, l)))
  const side = h('aside', { class: 'dc-side', hidden: true, 'aria-label': 'Side panel' },
    h('div', { class: 'dc-side-head' }, sideTitle, tbtn('x', { tip: 'Close panel', onClick: () => togglePanel(null) })),
    h('div', { style: 'padding:8px 10px 0' }, seg),
    ...Object.values(panes))
  for (const p of Object.values(panes)) p.hidden = true

  const rail = h('nav', { class: 'dc-rail', 'aria-label': 'Tools' },
    tbtn('files', { tip: 'Documents', tipPos: 'right', cls: 'rail', onClick: () => togglePanel('docs') }),
    tbtn('list-tree', { tip: 'Outline', tipPos: 'right', cls: 'rail', onClick: () => togglePanel('outline') }),
    tbtn('ruler', { tip: 'Page setup', tipPos: 'right', cls: 'rail', onClick: () => togglePanel('page') }),
    tbtn('search', { tip: 'Find and replace', tipPos: 'right', cls: 'rail', onClick: () => openFind(true) }),
    h('div', { class: 'dc-spacer' }),
    tbtn('keyboard', { tip: 'Keyboard shortcuts', tipPos: 'right', cls: 'rail', onClick: () => showShortcuts() }))
  const railBtns = [...rail.querySelectorAll('.dc-btn')]

  // find bar
  const findInput = h('input', { type: 'text', 'aria-label': 'Find', placeholder: 'Find', autocomplete: 'off', spellcheck: 'false',
    oninput: () => runFind(), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1) } else if (e.key === 'Escape') closeFind() } })
  const replInput = h('input', { type: 'text', 'aria-label': 'Replace with', placeholder: 'Replace with', autocomplete: 'off', spellcheck: 'false',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doReplace() } else if (e.key === 'Escape') closeFind() } })
  const findCount = h('span', { class: 'dc-find-count', 'aria-live': 'polite' }, '')
  const caseBtn = tbtn('case-sensitive', { tip: 'Match case', label: 'Match case', cls: 'txt', onClick: () => { caseBtn.setPressed(caseBtn.getAttribute('aria-pressed') !== 'true'); runFind() } })
  const wordBtn = tbtn('whole-word', { tip: 'Whole word', label: 'Whole word', cls: 'txt', onClick: () => { wordBtn.setPressed(wordBtn.getAttribute('aria-pressed') !== 'true'); runFind() } })
  caseBtn.setPressed(false); wordBtn.setPressed(false)
  const findBar = h('div', { class: 'dc-find-bar', hidden: true, role: 'search', 'aria-label': 'Find and replace', onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeFind() } } },
    h('div', { class: 'dc-find-row' }, findInput, findCount,
      tbtn('chevron-up', { tip: 'Previous (Shift+Enter)', onClick: () => stepFind(-1) }), tbtn('chevron-down', { tip: 'Next (Enter)', onClick: () => stepFind(1) }),
      tbtn('x', { tip: 'Close (Esc)', onClick: () => closeFind() })),
    h('div', { class: 'dc-find-row' }, replInput,
      h('button', { type: 'button', class: 'dc-btn label txt', onclick: () => doReplace() }, h('span', 'Replace')),
      h('button', { type: 'button', class: 'dc-btn label txt', onclick: () => doReplaceAll() }, h('span', 'All'))),
    h('div', { class: 'dc-find-row' }, caseBtn, wordBtn))

  // canvas
  const host = h('div')
  const guides = h('div', { class: 'dc-guides', 'aria-hidden': 'true' })
  const paper = h('div', { class: 'dc-paper' }, guides, host)
  const sheet = h('div', { class: 'dc-sheet' }, paper)
  const canvas = h('div', { class: 'dc-canvas', 'data-view': 'page' }, sheet)
  const work = h('div', { class: 'dc-work' }, findBar, canvas)

  // status bar
  const stat = h('span', { class: 'dc-stat', 'aria-live': 'polite' })
  const zoomVal = h('span', { class: 'dc-zoomval', title: 'Zoom' }, '100%')
  const viewBtn = tbtn('monitor', { tip: 'Switch between page view and reading view', tipPos: 'top', onClick: () => setView(S.view === 'page' ? 'web' : 'page') })
  const zoomOut = tbtn('zoom-out', { tip: 'Zoom out', tipPos: 'top', onClick: () => setZoom(S.zoom - 0.1) })
  const zoomIn = tbtn('zoom-in', { tip: 'Zoom in', tipPos: 'top', onClick: () => setZoom(S.zoom + 0.1) })
  const fitBtn = tbtn('scan-line', { tip: 'Fit page to width', tipPos: 'top', onClick: () => fitWidth() })
  const bar = h('div', { class: 'dc-bar' }, stat, h('span', { class: 'dc-grow' }), viewBtn, zoomOut, zoomVal, zoomIn, fitBtn)

  t.append(top, toolsSlot, ctxSlot, h('div', { class: 'dc-main' }, rail, side, work), bar, credit())

  // ---------- editor ----------
  const app = {
    run: (c) => ed.run(c),
    state: () => ed.state,
    pop, prefs, toast,
    settings: () => S.settings,
    openLink: () => openLinkDialog(),
    pickImage: () => pickImages(),
    imageFromUrl: () => imageFromUrl(),
    contentWidth: () => contentWidthPx(S.settings),
  }
  let toolbar
  const ed = createEditor(host, {
    doc: htmlToDoc('<p></p>'),
    getZoom: () => (S.view === 'page' ? S.zoom : 1),
    ctx: { addFiles: (files, pos) => addImages(files, pos), openFile: (f) => openFile(f) },
    onChange: (tr, next) => onChange(tr, next),
  })
  toolbar = createToolbar(app)
  toolsSlot.replaceWith(toolbar.tools)
  ctxSlot.replaceWith(toolbar.ctx)

  // ---------- status, layout, zoom ----------
  let rafTool = 0
  function onChange(tr, next) {
    const docChanged = !tr || tr.docChanged
    cancelAnimationFrame(rafTool)
    rafTool = requestAnimationFrame(() => { toolbar.update(ed.state); updateOutlineCursor() })
    if (docChanged) {
      if (tr) { S.untouched = false; dirty() }
      scheduleStats()
    } else scheduleStats()
    void next
  }
  const scheduleStats = debounce(() => { updateStatus(); updateOutline() }, 160)

  function updateStatus() {
    if (S.dead) return
    const st = ed.state
    const sel = st.selection
    const text = docText(st.doc)
    const words = wordCount(text)
    const chars = text.replace(/\n/g, '').length
    let s
    if (!sel.empty && sel.from !== sel.to) {
      const selWords = wordCount(st.doc.textBetween(sel.from, sel.to, ' ', ' '))
      s = `${formatNumber(selWords, 0)} of ${formatNumber(words, 0)} words selected`
    } else s = `${formatNumber(words, 0)} words`
    const pageNow = currentPage()
    stat.textContent = `${s} · ${formatNumber(chars, 0)} characters${S.view === 'page' ? ` · Page ${Math.min(pageNow, S.pages)} of ${S.pages}` : ''}`
  }

  function currentPage() {
    try {
      const head = ed.state.selection.head
      const c = ed.view.coordsAtPos(head)
      const r = paper.getBoundingClientRect()
      const z = S.view === 'page' ? S.zoom : 1
      return Math.max(1, Math.floor((c.top - r.top) / z / pagePx(S.settings).h) + 1)
    } catch { return 1 }
  }

  function layoutGuides() {
    if (S.dead) return
    const p = pagePx(S.settings)
    const z = S.view === 'page' ? S.zoom : 1
    if (S.view === 'page') {
      sheet.style.width = `${p.w * z}px`
      sheet.style.height = `${paper.offsetHeight * z}px`
      paper.style.transform = z === 1 ? '' : `scale(${z})`
      const pages = Math.max(1, Math.ceil((paper.offsetHeight - 2) / p.h))
      S.pages = pages
      const parts = []
      for (let i = 0; i < pages; i++) {
        if (i > 0) parts.push(h('div', { class: 'dc-seam', style: { top: `${i * p.h}px` } }, h('span', `Page ${i + 1}`)))
        if (S.settings.header) parts.push(h('div', { class: 'dc-hf', style: { top: `${i * p.h + p.mt * 0.4}px` } }, S.settings.header))
        if (S.settings.footer || S.settings.pageNumbers) {
          const label = [S.settings.footer, S.settings.pageNumbers ? String(i + 1) : ''].filter(Boolean).join('   ')
          parts.push(h('div', { class: 'dc-hf', style: { top: `${(i + 1) * p.h - p.mb * 0.62}px` } }, label))
        }
      }
      guides.replaceChildren(...parts)
    } else {
      sheet.style.width = ''
      sheet.style.height = ''
      paper.style.transform = ''
      guides.replaceChildren()
      S.pages = 1
    }
    updateStatus()
  }
  const scheduleLayout = (() => { let r = 0; return () => { cancelAnimationFrame(r); r = requestAnimationFrame(layoutGuides) } })()
  const ro = new ResizeObserver(() => scheduleLayout())
  ro.observe(paper)

  function applySettings() {
    const p = pagePx(S.settings)
    const st = paper.style
    st.setProperty('--pw', `${p.w}px`)
    st.setProperty('--ph', `${p.h}px`)
    st.setProperty('--mt', `${p.mt}px`)
    st.setProperty('--mr', `${p.mr}px`)
    st.setProperty('--mb', `${p.mb}px`)
    st.setProperty('--ml', `${p.ml}px`)
    st.setProperty('--doc-font', FONT_STACK[S.settings.font] || FONT_STACK.Calibri)
    st.setProperty('--doc-size', `${S.settings.fontSize}pt`)
    pagePanel.sync()
    scheduleLayout()
    toolbar?.update(ed.state)
  }
  function setSettings(patch) {
    S.settings = normSettings({ ...S.settings, ...patch })
    applySettings()
    S.untouched = false
    dirty()
  }

  function setZoom(z) {
    S.zoom = Math.min(2, Math.max(0.3, Math.round(z * 100) / 100))
    zoomVal.textContent = `${Math.round(S.zoom * 100)}%`
    prefs.update((p) => ({ ...p, zoom: S.zoom }))
    layoutGuides()
  }
  function fitWidth() {
    if (S.view !== 'page') return
    const avail = canvas.clientWidth - (canvas.clientWidth < 600 ? 20 : 48)
    setZoom(Math.min(1.5, avail / pagePx(S.settings).w))
  }
  function setView(v, persist = true) {
    S.view = v
    canvas.dataset.view = v
    viewBtn.setPressed(v === 'web')
    viewBtn.replaceChildren(icon(v === 'page' ? 'monitor' : 'smartphone'))
    for (const b of [zoomOut, zoomIn, fitBtn]) b.disabled = v !== 'page'
    zoomVal.style.opacity = v === 'page' ? '' : '.4'
    if (persist) prefs.update((p) => ({ ...p, view: v }))
    layoutGuides()
  }
  canvas.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || S.view !== 'page') return
    e.preventDefault()
    setZoom(S.zoom + (e.deltaY < 0 ? 0.1 : -0.1))
  }, { passive: false })
  paper.addEventListener('mousedown', (e) => {
    if (e.target.closest('.dc-prose')) return
    e.preventDefault()
    const end = ed.state.doc.content.size
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(end), -1)))
    ed.focus()
  })

  // ---------- panels ----------
  function togglePanel(name, force = false, persist = true) {
    if (name && S.panel === name && !force) name = null
    S.panel = name
    if (persist) prefs.update((p) => ({ ...p, panel: name || 'closed' }))
    side.hidden = !name
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== name
    for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.k === name))
    railBtns.forEach((b, i) => b.classList.toggle('on', ['docs', 'outline', 'page'][i] === name))
    if (name) sideTitle.textContent = PANEL_TITLES[name]
    if (name === 'docs') refreshDocs()
    if (name === 'outline') updateOutline()
    if (name === 'page') pagePanel.sync()
    later(layoutGuides, 30)
  }
  async function refreshDocs() {
    S.docs = await store.listDocs()
    docsPanel.set(S.docs)
  }
  function updateOutline() {
    if (S.panel !== 'outline') return
    const items = []
    ed.state.doc.descendants((node, pos) => {
      if (node.type === schema.nodes.heading) items.push({ level: node.attrs.level, text: node.textContent.trim().slice(0, 90), pos })
      return node.type.name === 'doc' || node.type.name === 'blockquote' || /_item$|_list$/.test(node.type.name)
    })
    outline.set(items, ed.state.selection.from)
  }
  const updateOutlineCursor = () => { if (S.panel === 'outline') updateOutline() }
  function gotoPos(pos) {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(pos + 1))))
    const dom = ed.view.nodeDOM(pos)
    dom?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    if (matchMedia('(max-width: 860px)').matches) togglePanel(null)
    ed.focus()
  }

  // ---------- documents ----------
  const blank = () => docText(ed.state.doc).trim().length === 0 && ed.state.doc.childCount <= 1

  function load(rec) {
    S.id = rec.id
    S.title = rec.title || 'Untitled document'
    S.created = rec.created || Date.now()
    S.template = rec.template || null
    S.untouched = !!rec.untouched
    S.settings = normSettings(rec.settings)
    title.value = S.title
    let doc
    try { doc = jsonToDoc(rec.json) } catch { doc = htmlToDoc('<p></p>') }
    ed.setDoc(doc)
    S.version++
    S.savedVersion = S.version
    store.setLast(S.id)
    applySettings()
    canvas.scrollTop = 0
    setSaved('Saved')
    updateStatus()
    updateOutline()
    toolbar.update(ed.state)
    if (S.panel === 'docs') refreshDocs()
  }

  async function flush() {
    if (S.id && S.version !== S.savedVersion) await saveNow()
  }

  async function saveNow() {
    if (!S.id || S.dead) return
    const v = S.version
    const doc = ed.state.doc
    const text = docText(doc)
    const rec = { id: S.id, title: S.title.trim() || 'Untitled document', json: doc.toJSON(), settings: S.settings, created: S.created, updated: Date.now(), template: S.template, untouched: S.untouched }
    const ok = await store.putDoc(rec, { words: wordCount(text), snippet: text.replace(/\s+/g, ' ').trim().slice(0, 90) })
    if (S.dead) return
    if (ok) {
      if (S.version === v) { S.savedVersion = v; setSaved('Saved') }
      if (S.panel === 'docs') refreshDocs()
    } else setSaved('Not saved: browser storage is off', true)
  }
  const autosave = debounce(() => saveNow(), 700)
  function dirty() {
    S.version++
    setSaved('Saving...', false, 'cloud-upload')
    autosave()
  }

  async function createDoc({ title: name, doc, settings, template = null, untouched = false, reuseCurrent = false }) {
    if (reuseCurrent && S.id) {
      // opening a file into a blank, never-edited document replaces it instead of piling up empty documents
      S.title = name
      S.template = template
      S.untouched = untouched
      S.settings = normSettings(settings)
      title.value = name
      ed.setDoc(doc)
      applySettings()
      dirty()
      await saveNow()
      return
    }
    await flush()
    const rec = { id: store.newId(), title: name, json: doc.toJSON(), settings: normSettings(settings), created: Date.now(), updated: Date.now(), template, untouched }
    load(rec)
    S.version++
    await saveNow()
    ed.focus()
  }

  async function newDoc(templateId) {
    const tpl = templateById(templateId)
    if (templateId === 'blank' && S.untouched && blank()) { ed.focus(); return }
    await createDoc({ title: tpl.title, doc: htmlToDoc(tpl.html), settings: { ...defaultSettings(), ...(tpl.settings || {}) }, template: tpl.id, untouched: true })
    if (matchMedia('(max-width: 860px)').matches) togglePanel(null)
  }
  async function openDoc(id) {
    if (id === S.id) { if (matchMedia('(max-width: 860px)').matches) togglePanel(null); return }
    await flush()
    const rec = await store.getDoc(id)
    if (!rec) { toast('That document could not be found.', 'error'); refreshDocs(); return }
    load(rec)
    if (matchMedia('(max-width: 860px)').matches) togglePanel(null)
  }
  async function duplicateDoc(id) {
    await flush()
    const rec = await store.getDoc(id)
    if (!rec) return
    const copy = { ...rec, id: store.newId(), title: `${rec.title} (copy)`, created: Date.now(), updated: Date.now(), untouched: false }
    await store.putDoc(copy, { words: S.docs.find((d) => d.id === id)?.words || 0, snippet: S.docs.find((d) => d.id === id)?.snippet || '' })
    toast('Duplicated', 'success')
    refreshDocs()
  }
  function deleteDoc(id) {
    const name = S.docs.find((d) => d.id === id)?.title || 'this document'
    const m = modal({
      title: 'Delete document?', icon: 'trash-2',
      body: h('p', `"${name}" will be removed from this device. This cannot be undone. Download a copy first if you might need it.`),
      actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
        button('Delete', { variant: 'danger', icon: 'trash-2', onClick: async () => {
          m.close()
          await store.removeDoc(id)
          if (id === S.id) {
            const rest = await store.listDocs()
            if (rest.length) load(await store.getDoc(rest[0].id))
            else { S.id = null; await createDoc({ title: 'Untitled document', doc: htmlToDoc('<p></p>'), settings: defaultSettings(), template: 'blank', untouched: true }) }
          }
          refreshDocs()
          toast('Document deleted')
        } })],
    })
  }

  async function pickOpen() {
    const files = await pickFiles({ accept: OPEN_ACCEPT })
    if (files[0]) openFile(files[0])
  }
  async function openFile(file) {
    setSaved(`Opening ${file.name}...`, false, 'loader')
    try {
      const res = await importFile(file)
      await createDoc({ title: res.title, doc: res.doc, settings: { ...defaultSettings(), ...(res.settings || {}) }, reuseCurrent: S.untouched && blank() })
      for (const n of res.notes) toast(n, 'info', 7000)
      toast(`Opened ${file.name}`, 'success')
    } catch (e) {
      console.error(e)
      toast(errorMessage(e), 'error')
    } finally {
      if (!S.dead) setSaved(S.version === S.savedVersion ? 'Saved' : 'Saving...')
    }
  }

  // ---------- images and links ----------
  async function addImages(files, pos) {
    for (const f of files) {
      try {
        const attrs = await fileToImageAttrs(f, Math.round(contentWidthPx(S.settings)))
        const st = ed.state
        let tr = st.tr
        if (pos != null) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))))
        tr = tr.replaceSelectionWith(schema.nodes.image.create(attrs)).scrollIntoView()
        ed.view.dispatch(tr)
        pos = null
      } catch (e) {
        toast(errorMessage(e), 'error')
      }
    }
    ed.focus()
  }
  async function pickImages() {
    const files = await pickFiles({ accept: 'image/*', multiple: true })
    if (files.length) addImages(files, null)
  }
  function imageFromUrl() {
    const url = h('input', { type: 'text', placeholder: 'https://example.com/picture.png', 'aria-label': 'Image address', inputmode: 'url' })
    const m = modal({
      title: 'Image from a web address', icon: 'image',
      body: h('form', { class: 'dc-modal-form', onsubmit: (e) => { e.preventDefault(); apply() } }, h('label', 'Address', url),
        h('p', { class: 'dc-note' }, 'The image stays linked. It needs internet to show and may be left out of Word files. Upload from your device to embed it.')),
      actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Insert', { variant: 'primary', onClick: () => apply() })],
    })
    setTimeout(() => url.focus(), 50)
    function apply() {
      const src = url.value.trim()
      if (!/^https?:\/\//i.test(src)) return toast('Enter an address that starts with https://', 'error')
      const img = new Image()
      img.onload = () => {
        const w = Math.min(img.naturalWidth || 400, Math.round(contentWidthPx(S.settings)))
        ed.run(cmd.insertImage({ src, alt: null, width: w, height: Math.round(w * (img.naturalHeight / (img.naturalWidth || 1))) }))
        m.close()
      }
      img.onerror = () => toast('That image could not be loaded.', 'error')
      img.src = src
    }
  }

  function openLinkDialog() {
    const st = ed.state
    const existing = cmd.linkAt(st)
    const range = cmd.linkRange(st)
    const needsText = !range || range.from === range.to
    const text = h('input', { type: 'text', placeholder: 'Text to show', 'aria-label': 'Link text' })
    const url = h('input', { type: 'text', placeholder: 'https://example.com', 'aria-label': 'Link address', inputmode: 'url', value: existing?.attrs.href || '' })
    const m = modal({
      title: existing ? 'Edit link' : 'Insert link', icon: 'link',
      body: h('form', { class: 'dc-modal-form', onsubmit: (e) => { e.preventDefault(); apply() } }, needsText && h('label', 'Text', text), h('label', 'Address', url)),
      actions: [
        existing && button('Remove link', { variant: 'danger', onClick: () => { m.close(); removeLink() } }),
        button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
        button('Apply', { variant: 'primary', onClick: () => apply() })],
    })
    setTimeout(() => (needsText && !existing ? text : url).focus(), 50)
    function normalize(v) {
      v = v.trim()
      if (!v) return ''
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
      return /^[a-z][a-z0-9+.-]*:|^#|^\//i.test(v) ? v : `https://${v}`
    }
    function removeLink() {
      const r = cmd.linkRange(ed.state)
      if (r) ed.view.dispatch(ed.state.tr.removeMark(r.from, r.to, schema.marks.link))
      ed.focus()
    }
    function apply() {
      const href = normalize(url.value)
      if (!href) { if (existing) { m.close(); removeLink() } return }
      let ok
      if (needsText) {
        const label = text.value.trim() || href.replace(/^mailto:/, '').replace(/^https?:\/\//, '')
        const r = ed.state.selection
        const node = schema.text(label, [schema.marks.link.create({ href })])
        ok = !!cmd.setLink(href) && (ed.view.dispatch(ed.state.tr.replaceWith(r.from, r.to, node).scrollIntoView()), true)
      } else {
        const r2 = cmd.linkRange(ed.state)
        ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, r2.from, r2.to)))
        ok = ed.run(cmd.setLink(href))
      }
      if (!ok) return toast('That address is not allowed. Use http, https or mailto links.', 'error')
      m.close()
      ed.focus()
    }
  }

  // ---------- find and replace ----------
  const qOf = () => ({ text: findInput.value, matchCase: caseBtn.getAttribute('aria-pressed') === 'true', whole: wordBtn.getAttribute('aria-pressed') === 'true' })
  function showCount() {
    const s = findState(ed.state)
    findCount.textContent = !findInput.value ? '' : s.matches.length ? `${s.current + 1} of ${s.matches.length}` : 'No results'
  }
  function runFind() { setQuery(ed.view, qOf()); showCount() }
  function stepFind(d) { if (!findState(ed.state).matches.length) runFind(); stepMatch(ed.view, d); showCount() }
  function openFind(focusReplace) {
    pop.close()
    findBar.hidden = false
    const sel = ed.state.selection
    if (!sel.empty) {
      const txt = ed.state.doc.textBetween(sel.from, sel.to, ' ')
      if (txt && txt.length < 80 && !txt.includes('\n')) findInput.value = txt
    }
    ;(focusReplace === 'replace' ? replInput : findInput).focus()
    findInput.select()
    runFind()
  }
  function closeFind() {
    findBar.hidden = true
    setQuery(ed.view, { text: '' })
    ed.focus()
  }
  function doReplace() {
    if (!findState(ed.state).matches.length) runFind()
    replaceCurrent(ed.view, replInput.value)
    showCount()
  }
  function doReplaceAll() {
    if (!findState(ed.state).matches.length) runFind()
    const n = replaceAll(ed.view, replInput.value)
    showCount()
    toast(n ? `Replaced ${n} ${n === 1 ? 'match' : 'matches'}` : 'Nothing to replace', n ? 'success' : 'info')
  }

  // ---------- export ----------
  const fileBase = () => safeName(S.title.trim() || 'document')
  async function task(label, fn) {
    setSaved(label, false, 'loader')
    try { return await fn() } catch (e) { console.error(e); toast(errorMessage(e), 'error') } finally { if (!S.dead) setSaved(S.version === S.savedVersion ? 'Saved' : 'Saving...') }
  }
  const exporters = {
    docx: () => task('Building Word file...', async () => {
      const { buildDocx } = await import('./_docx.js')
      const { blob, notes } = await buildDocx(ed.state.doc, S.settings, S.title)
      download(blob, `${fileBase()}.docx`)
      notes.forEach((n) => toast(n, 'info', 7000))
      toast('Downloaded Word document', 'success')
    }),
    pdf: () => task('Building PDF...', async () => {
      const { buildPdf } = await import('./_pdf.js')
      const { blob, notes } = await buildPdf(ed.state.doc, S.settings, S.title)
      download(blob, `${fileBase()}.pdf`)
      notes.forEach((n) => toast(n, 'info', 7000))
      toast('Downloaded PDF', 'success')
    }),
    print: () => task('Preparing print view...', () => printHtml(buildHtml(ed.state.doc, S.settings, S.title), t, () => ed.focus())),
    md: () => task('Building Markdown...', async () => { download(new Blob([await exportMarkdown(ed.state.doc)], { type: 'text/markdown' }), `${fileBase()}.md`); toast('Downloaded Markdown', 'success') }),
    html: () => task('Building HTML...', async () => { download(new Blob([buildHtml(ed.state.doc, S.settings, S.title)], { type: 'text/html' }), `${fileBase()}.html`); toast('Downloaded HTML', 'success') }),
    txt: () => task('Building text...', async () => { download(new Blob([exportText(ed.state.doc)], { type: 'text/plain' }), `${fileBase()}.txt`); toast('Downloaded text file', 'success') }),
    json: () => task('Saving project...', async () => { download(new Blob([projectJson(S.title, ed.state.doc, S.settings)], { type: 'application/json' }), `${fileBase()}.docs.json`); toast('Downloaded project file', 'success') }),
  }
  function openExportMenu() {
    const go = (k) => () => { pop.close(); exporters[k]() }
    pop.open(exportBtn, h('div', { style: 'min-width:270px' },
      h('div', { class: 'dc-pop-label' }, 'Download as'),
      menuItem('file-text', 'Word document', '.docx, opens in Word and Google Docs', go('docx')),
      menuItem('file-type', 'PDF', 'Text stays selectable', go('pdf')),
      menuItem('printer', 'Print...', 'Or choose Save as PDF in the print window', go('print')),
      menuItem('file-code', 'Markdown', '.md with tables and check lists', go('md')),
      menuItem('code-xml', 'Web page', '.html, one self-contained file', go('html')),
      menuItem('type', 'Plain text', '.txt', go('txt')),
      menuItem('file-json', 'Project file', 'Reopen later with all settings', go('json'))), { align: 'end' })
  }

  function showShortcuts() {
    modal({ title: 'Keyboard shortcuts', icon: 'keyboard', body: shortcutSheet() })
  }

  // ---------- keyboard (capture on root so the site's own Ctrl+K never fires) ----------
  const onKey = (e) => {
    const mod = e.ctrlKey || e.metaKey
    if (!mod || e.altKey) return
    const k = e.key.toLowerCase()
    const handled = () => { e.preventDefault(); e.stopPropagation() }
    if (k === 'k' && !e.shiftKey) { handled(); openLinkDialog() }
    else if (k === 'f' && !e.shiftKey) { handled(); openFind(false) }
    else if (k === 'h' && !e.shiftKey) { handled(); openFind('replace') }
    else if (k === 's' && !e.shiftKey) { handled(); autosave.cancel?.(); saveNow().then(() => toast('Saved on this device. Use Download for a Word file.', 'success')) }
    else if (k === 'p' && !e.shiftKey) { handled(); exporters.print() }
    else if (k === 'o' && !e.shiftKey) { handled(); pickOpen() }
    else if (k === '0' && !e.shiftKey) { handled(); setZoom(1) }
  }
  t.addEventListener('keydown', onKey, true)
  const onHide = () => { if (document.visibilityState === 'hidden') flush() }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', onHide)

  // ---------- boot ----------
  const stored = prefs.get()
  S.zoom = Math.min(2, Math.max(0.3, stored.zoom || 1))
  const narrow = root.clientWidth < 860
  setView(stored.view || (narrow ? 'web' : 'page'), false)
  zoomVal.textContent = `${Math.round(S.zoom * 100)}%`
  const wide = root.clientWidth >= 1180
  togglePanel(stored.panel === 'closed' ? null : stored.panel || (wide ? 'docs' : null), true, false)

  const idx = await store.listDocs()
  if (signal?.aborted) return () => {}
  S.docs = idx
  docsPanel.set(idx)
  let first = null
  if (params.template) {
    const tplId = params.template === 'meeting-notes' ? 'meeting' : params.template
    const keep = idx.find((d) => d.template === tplId && d.untouched)
    if (keep) first = await store.getDoc(keep.id)
    else {
      const tpl = templateById(tplId)
      await createDoc({ title: tpl.title, doc: htmlToDoc(tpl.html), settings: { ...defaultSettings(), ...(tpl.settings || {}) }, template: tpl.id, untouched: true })
    }
  } else {
    const lastId = store.getLast()
    const pick = idx.find((d) => d.id === lastId) || idx[0]
    if (pick) first = await store.getDoc(pick.id)
    else await createDoc({ title: WELCOME.title, doc: htmlToDoc(WELCOME.html), settings: defaultSettings(), template: WELCOME.id, untouched: true })
  }
  if (first) load(first)
  if (S.panel === 'docs') refreshDocs()
  if (!stored.zoom && S.view === 'page' && canvas.clientWidth < pagePx(S.settings).w + 44) fitWidth()
  layoutGuides()
  if (params.start === 'open') {
    const dz = h('div')
    const m = modal({ title: 'Open a Word file', icon: 'folder-open', body: dz })
    dz.append(dropzone({ accept: OPEN_ACCEPT, label: 'Drop a .docx, .md, .html or .txt file here', hint: 'Or click to choose. Your file stays on this device.', paste: false,
      onFiles: ([f]) => { m.close(); openFile(f) } }))
  }

  // ---------- cleanup ----------
  return () => {
    S.dead = true
    ro.disconnect()
    pop.close()
    for (const x of timers) clearTimeout(x)
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', onHide)
    cancelAnimationFrame(rafTool)
    // final save of whatever is pending, without touching the UI
    if (S.id && S.version !== S.savedVersion) {
      const doc = ed.state.doc
      const text = docText(doc)
      store.putDoc({ id: S.id, title: S.title.trim() || 'Untitled document', json: doc.toJSON(), settings: S.settings, created: S.created, updated: Date.now(), template: S.template, untouched: S.untouched },
        { words: wordCount(text), snippet: text.replace(/\s+/g, ' ').trim().slice(0, 90) })
    }
    ed.destroy()
    t.remove()
  }
}
