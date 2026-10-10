// Layout Studio: a page layout editor in the browser (text frames with threading, image frames, master pages, styles, PDF export).
// Entry module: mount(root, ctx) builds the app shell and returns a cleanup function.
import { h, icon, dropzone, modal, toast, download } from '../../lib/ui.js'
import { pickFiles, safeName } from '../../lib/files.js'
import { uid, newDoc, UNITS, normalizeDoc } from './_model.js'
import { Store, saveProject, loadProject, listProjects, deleteProject, getPointer, setPointer, LAST_KEY } from './_state.js'
import { Scene, renderToCanvas } from './_render.js'
import { Editor } from './_editor.js'
import { contextBar, designPanel } from './_inspector.js'
import { pagesPanel, layersPanel, stylesPanel } from './_sidebars.js'
import { makeTemplate } from './_templates.js'
import { templateGallery, customDocDialog, shortcutsDialog, openDialog, exportDialog } from './_dialogs.js'
import { saveProjectZip, openProjectZip, printDoc } from './_export.js'
import * as cmd from './_commands.js'
import { ibtn } from './_ui.js'
import { injectCss } from './_css.js'

const REPO = 'https://github.com/storytold/designcraft'

export async function mount(root, { tool, params = {}, signal } = {}) {
  injectCss()
  const urlParams = new URLSearchParams(location.hash.split('?')[1] || '')
  const templateParam = params.template || urlParams.get('template') || null
  const ptrKey = templateParam && params.template ? `layout-studio:last:${tool?.id}` : LAST_KEY

  const store = new Store(newDoc())
  let ed
  const scene = new Scene(store, (kind) => { if (kind === 'fonts') store.emit('fonts'); else { ed?.requestRender(); store.emit('view') } })
  ed = new Editor({ store, scene, toast })
  const ctx = { ed, store, scene, toast, pickImage: (id) => pickImage(id) }

  // ---------- Panels ----------
  const design = designPanel(ctx), pages = pagesPanel(ctx), layers = layersPanel(ctx), styles = stylesPanel(ctx)
  const bar = contextBar(ctx)
  const PANES = [['design', 'Design', 'sliders-horizontal', design], ['pages', 'Pages', 'files', pages], ['layers', 'Layers', 'layers', layers], ['styles', 'Styles', 'type', styles]]
  let activeTab = 'design'
  const tabBtns = PANES.map(([id, label, ic]) => h('button', { type: 'button', role: 'tab', class: 'ls-tab', id: `ls-tab-${id}`, 'aria-selected': String(id === activeTab), 'aria-controls': `ls-pane-${id}`, onclick: () => showTab(id) }, icon(ic), h('span', label)))
  const paneEls = PANES.map(([id, , , p]) => h('div', { role: 'tabpanel', id: `ls-pane-${id}`, 'aria-labelledby': `ls-tab-${id}`, hidden: id !== activeTab }, p.el))
  function showTab(id) {
    activeTab = id
    PANES.forEach(([pid, , , p], i) => { tabBtns[i].setAttribute('aria-selected', String(pid === id)); paneEls[i].hidden = pid !== id; if (pid === id) p.sync() })
    pages.scheduleThumbs()
  }

  // ---------- Toolbar ----------
  const docName = h('input', { class: 'ls-docname', value: store.doc.name, 'aria-label': 'Document name', oninput: (e) => cmd.setDocSetup(store, { name: e.target.value }) })
  const undoBtn = ibtn('undo-2', 'Undo (Ctrl+Z)', { cls: 'ls-top1', onClick: () => store.undo() })
  const redoBtn = ibtn('redo-2', 'Redo (Ctrl+Shift+Z)', { cls: 'ls-top1', onClick: () => store.redo() })
  const zoomSel = h('select', { class: 'ls-zoomval select ls-sm-hide', 'aria-label': 'Zoom', onchange: (e) => { const v = e.target.value; if (v === 'page') ed.fitPage(); else if (v === 'width') ed.fitWidth(); else ed.setZoom(+v / 100) } },
    [['page', 'Fit page'], ['width', 'Fit width'], ...[25, 50, 75, 100, 150, 200, 400].map((z) => [String(z), `${z}%`])].map(([v, l]) => h('option', { value: v }, l)))
  const zoomLbl = h('option', { value: 'cur', disabled: true }, '80%')
  zoomSel.prepend(zoomLbl)
  const saveState = h('span', { class: 'ls-save' }, icon('check'), h('span', 'Saved'))
  const panelBtn = ibtn('panel-right', 'Show or hide the panels', { cls: 'ls-panelbtn ls-top1', onClick: () => { wrap.classList.toggle('side-open') } })
  const top = h('div', { class: 'ls-top' },
    docName,
    h('span', { class: 'ls-sepv' }),
    ibtn('file-plus', 'New document (templates)', { onClick: () => showNew() }),
    ibtn('folder-open', 'Open a saved document', { onClick: () => showOpen() }),
    ibtn('save', 'Save project file (Ctrl+S)', { onClick: () => saveFile() }),
    ibtn('download', 'Export PDF or PNG (Ctrl+E)', { label: 'Export', onClick: () => showExport(), cls: 'primary' }),
    ibtn('printer', 'Print (Ctrl+P)', { onClick: () => printNow() }),
    h('span', { class: 'ls-sepv' }),
    undoBtn, redoBtn,
    h('span', { class: 'ls-sepv' }),
    ibtn('zoom-out', 'Zoom out (Ctrl+-)', { cls: 'ls-sm-hide', onClick: () => ed.zoomAt(0.8) }), zoomSel, ibtn('zoom-in', 'Zoom in (Ctrl++)', { cls: 'ls-sm-hide', onClick: () => ed.zoomAt(1.25) }),
    ibtn('scan', 'Fit the page (Ctrl+0)', { onClick: () => ed.fitPage() }),
    h('span', { class: 'ls-spacer' }), saveState,
    ibtn('keyboard', 'Keyboard shortcuts', { cls: 'ls-sm-hide', onClick: () => shortcutsDialog() }), panelBtn)

  // ---------- Tool rail ----------
  const TOOLS = [['select', 'mouse-pointer-2', 'Select (V)'], ['text', 'type', 'Text frame (T)'], ['image', 'image', 'Image frame (I)'], ['rect', 'square', 'Rectangle (R)'], ['ellipse', 'circle', 'Ellipse (O)'], ['line', 'minus', 'Line (L)'], ['hand', 'hand', 'Hand: pan the canvas (H or hold Space)']]
  const toolBtns = new Map(TOOLS.map(([id, ic, tip]) => [id, ibtn(ic, tip, { pos: 'r', pressed: id === 'select', onClick: () => ed.setTool(id) })]))
  const rail = h('div', { class: 'ls-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' }, [...toolBtns.values()],
    h('span', { class: 'ls-sepv', style: 'width:24px;height:1px;margin:4px 0;align-self:center' }),
    ibtn('link', 'Thread text: continue the selected text frame in another frame', { pos: 'r', onClick: () => { const it = ed.selItems().find((x) => x.type === 'text'); if (it) ed.armThread(it.id); else toast('Select a text frame first.', 'info') } }),
    ibtn('image-plus', 'Place an image or a text file', { pos: 'r', onClick: () => pickImage(null) }))

  // ---------- Stage, overlays ----------
  const fileInput = h('input', { type: 'file', class: 'ls-image-input', accept: 'image/*,.heic,.heif,.avif,.txt,.md,.markdown,text/plain', multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: -1 })
  let pendingFrame = null
  function pickImage(id) { pendingFrame = id; fileInput.click() }
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files]
    fileInput.value = ''
    if (!files.length) return
    if (pendingFrame && !isTextFile(files[0])) { const id = pendingFrame; pendingFrame = null; await ed.placeInto(id, files[0]); if (files.length > 1) await handleFiles(files.slice(1)) } else { pendingFrame = null; await handleFiles(files) }
  })
  const isTextFile = (f) => /\.(txt|md|markdown)$/i.test(f.name) || f.type === 'text/plain'
  const dz = dropzone({ accept: 'image/*,.heic,.heif,.zip,.txt,.md,.markdown', multiple: true, paste: false, compact: true, label: 'Drop images, text files or a project file', onFiles: (files) => handleFiles(files) })
  dz.hidden = true
  async function handleFiles(files) {
    const zipf = files.find((f) => /\.zip$/i.test(f.name))
    if (zipf) { try { app.load(await openProjectZip(zipf), true) } catch (e) { toast(e.message, 'error') } return }
    const texts = files.filter(isTextFile)
    if (texts.length) { try { await ed.placeText(texts[0]) } catch (e) { toast(e.message, 'error') } }
    const rest = files.filter((f) => !isTextFile(f))
    if (rest.length) await ed.addImages(rest)
  }

  const welcome = h('div', { class: 'ls-welcome', role: 'region', 'aria-label': 'Start a document' })
  const fab = h('div', { class: 'ls-fab' },
    ibtn('chevron-left', 'Previous page (PageUp)', { pos: 't', onClick: () => { const i = Math.max(0, ed.currentIndex() - 1); ed.gotoPage(store.doc.pages[i].id) } }),
    h('span', { class: 'ls-pageind', style: 'align-self:center;padding:0 4px;font-size:12px;color:var(--muted);min-width:64px;text-align:center' }, 'Page 1 of 1'),
    ibtn('chevron-right', 'Next page (PageDown)', { pos: 't', onClick: () => { const i = Math.min(store.doc.pages.length - 1, ed.currentIndex() + 1); ed.gotoPage(store.doc.pages[i].id) } }))
  ed.el.append(fab)
  const pageInd = fab.querySelector('.ls-pageind')

  const side = h('aside', { class: 'ls-side', 'aria-label': 'Properties' }, h('div', { class: 'ls-tabs', role: 'tablist', 'aria-label': 'Panels' }, tabBtns), h('div', { class: 'ls-panes' }, paneEls))
  const main = h('div', { class: 'ls-main' }, rail, ed.el, side)

  // ---------- Status bar ----------
  const tgl = (ic, tip, key) => { const b = ibtn(ic, tip, { pos: 't', pressed: store.doc.view[key], onClick: () => cmd.setDocSetup(store, { view: { [key]: !store.doc.view[key] } }) }); b._key = key; return b }
  const toggles = [tgl('magnet', 'Snap to guides and frames', 'snap'), tgl('box-select', 'Show frame edges', 'frames'), tgl('ruler', 'Show rulers', 'rulers'), tgl('square-dashed', 'Show margin and column guides', 'margins')]
  const unitSel = h('select', { class: 'select', 'aria-label': 'Units', onchange: (e) => cmd.setDocSetup(store, { unit: e.target.value }) }, Object.keys(UNITS).map((u) => h('option', { value: u }, u)))
  const status = h('div', { class: 'ls-status' }, h('span', { class: 'ls-stat-sel', 'aria-live': 'polite' }, 'Nothing selected'), h('span', { class: 'ls-spacer' }), ...toggles, unitSel)
  const statSel = status.querySelector('.ls-stat-sel')

  const wrap = h('div', { class: 't-ls' }, top, bar, main, status, fileInput, dz)
  root.append(wrap, h('p', { class: 'ls-credit' }, 'Prefer a native app? ', h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'DesignCraft by ArtCraft'), ' is free and open source.'))
  ed.mounted()
  ed.el.append(fileInput)
  ed.el.append(welcome)
  welcome.hidden = true

  // ---------- App actions ----------
  let saveTimer = 0, saving = Promise.resolve()
  const setSaveState = (s) => { saveState.replaceChildren(icon({ saving: 'loader', dirty: 'pencil', off: 'triangle-alert' }[s] || 'check'), h('span', { saving: 'Saving', dirty: 'Unsaved', off: 'Autosave unavailable' }[s] || 'Saved')) }
  function thumb() {
    try {
      const d = store.doc
      const c = renderToCanvas(scene, d.pages[0], { scale: 200 / d.w, index: 0 })
      return c.toDataURL('image/jpeg', 0.7)
    } catch { return null }
  }
  async function saveNow() {
    clearTimeout(saveTimer)
    if (!store.dirty && !store.unsavedAssets.size) return
    setSaveState('saving')
    store.dirty = false
    saving = saveProject(store, thumb()).then((ok) => { setSaveState(ok ? (store.dirty ? 'dirty' : 'saved') : 'off'); return ok && setPointer(store.doc.id, ptrKey) })
    await saving
  }
  const scheduleSave = () => { setSaveState('dirty'); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1200) }

  const app = {
    async load({ doc, assets }, fresh = false) {
      if (fresh) { doc = normalizeDoc(doc); doc.id = uid('d') }
      await saveNow()
      store.load(doc, assets instanceof Map ? assets : new Map((assets || []).map((a) => [a.id, a])))
      for (const id of store.assets.keys()) store.unsavedAssets.add(id)
      store.dirty = true
      welcome.hidden = true
      docName.value = store.doc.name
      scheduleSave()
      syncAll()
    },
  }
  function startFromTemplate(id) { app.load(makeTemplate(id), true) }
  function showNew() {
    listProjects().then((recents) => {
      let m
      const g = templateGallery({
        onPick: (id) => { m.close(); startFromTemplate(id) },
        onCustom: () => { m.close(); customDocDialog({ unit: store.doc.unit, onCreate: (r) => app.load(r, true) }) },
        onOpenFile: () => { m.close(); openFile() }, recents, onOpenRecent: (id) => { m.close(); openRecent(id) },
      })
      m = modal({ title: 'New document', icon: 'file-plus', body: g })
    })
  }
  async function openRecent(id) {
    const r = await loadProject(id)
    if (r) app.load(r)
    else toast('Could not open that document.', 'error')
  }
  async function showOpen() {
    const recents = await listProjects()
    openDialog({ recents, onOpen: openRecent, onDelete: (id) => deleteProject(id), onFile: openFile })
  }
  async function openFile() {
    const [file] = await pickFiles({ accept: '.zip,application/zip' })
    if (!file) return
    try { app.load(await openProjectZip(file), true) } catch (e) { toast(e.message, 'error') }
  }
  async function saveFile() {
    try { download(await saveProjectZip(store), `${safeName(store.doc.name)}.layout-studio.zip`); toast('Project saved as a ZIP with its images.', 'success') } catch (e) { toast(e.message, 'error') }
  }
  function showExport() { ed.endTextEdit(); exportDialog({ store, scene }) }
  async function printNow() { ed.endTextEdit(); try { await printDoc(scene, { dpi: 150 }); ed.view.focus({ preventScroll: true }) } catch (e) { toast(e.message, 'error') } }

  // ---------- Syncing ----------
  let raf = 0
  function syncAll() {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const doc = store.doc
      undoBtn.disabled = !store.canUndo
      redoBtn.disabled = !store.canRedo
      for (const [id, b] of toolBtns) b.setPressed(ed.tool === id)
      if (document.activeElement !== docName) docName.value = doc.name
      const z = Math.round(ed.zoom * 100)
      zoomLbl.textContent = `${z}%`
      if (document.activeElement !== zoomSel) zoomSel.value = 'cur'
      pageInd.textContent = ed.mode.kind === 'master' ? 'Master' : `Page ${ed.currentIndex() + 1} of ${doc.pages.length}`
      for (const b of toggles) b.setPressed(doc.view[b._key])
      if (document.activeElement !== unitSel) unitSel.value = doc.unit
      const items = ed.selItems()
      statSel.textContent = ed.textEdit ? 'Editing text. Esc to finish.' : items.length === 0 ? (ed.threading ? 'Threading text' : `${doc.pages.length} page${doc.pages.length > 1 ? 's' : ''}, ${Math.round(ed.zoom * 100)}%`)
        : items.length > 1 ? `${items.length} frames selected` : `${{ text: 'Text frame', image: 'Image frame', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' }[items[0].type]}${items[0].locked ? ' (locked)' : ''}`
      bar.sync()
      ;(PANES.find((p) => p[0] === activeTab)[3]).sync()
    })
  }
  const unsubStore = store.on((kind) => { syncAll(); if (kind !== 'view' && kind !== 'fonts' && kind !== 'load') scheduleSave() })
  ed.on((type, data) => {
    if (type === 'placeImage') pickImage(data)
    syncAll()
  })

  // ---------- Keyboard, clipboard ----------
  wrap.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 's') { e.preventDefault(); saveFile(); return }
    if (mod && k === 'e') { e.preventDefault(); showExport(); return }
    if (mod && k === 'p') { e.preventDefault(); printNow(); return }
    if (e.target.closest?.('input, textarea, select') && !e.target.classList.contains('ls-view')) return
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('button, summary, a, [role="tab"]')) return // keep keyboard activation of controls working
    if (ed.handleKey(e)) e.preventDefault()
  })
  wrap.addEventListener('keyup', (e) => ed.handleKeyUp(e))
  const inField = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"]')
  wrap.addEventListener('copy', (e) => { if (inField(e) || ed.textEdit) return; if (ed.copy()) e.preventDefault() })
  wrap.addEventListener('cut', (e) => { if (inField(e) || ed.textEdit) return; if (ed.sel.length) { ed.cut(); e.preventDefault() } })
  wrap.addEventListener('paste', (e) => {
    if (inField(e) || ed.textEdit) return
    const files = [...(e.clipboardData?.files || [])]
    if (files.length) { e.preventDefault(); ed.addImages(files); return }
    e.preventDefault()
    ed.paste()
  })
  wrap.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault() })
  wrap.addEventListener('drop', (e) => {
    if (e.defaultPrevented) return
    const files = [...(e.dataTransfer?.files || [])]
    if (files.length) { e.preventDefault(); e.stopPropagation(); handleFiles(files) }
  })
  // ---------- Context menu ----------
  let menuEl = null
  const onAway = (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu() }
  const onMenuKey = (e) => { if (e.key === 'Escape') { closeMenu(); ed.view.focus() } }
  function closeMenu() {
    menuEl?.remove()
    menuEl = null
    document.removeEventListener('pointerdown', onAway, true)
    document.removeEventListener('keydown', onMenuKey, true)
  }
  function openMenu({ x, y, onItem }) {
    closeMenu()
    const items = ed.selItems()
    const one = items[0]
    const locked = items.length && items.every((i) => i.locked)
    const mi = (label, ic, fn, kbd, disabled) => h('button', { type: 'button', role: 'menuitem', class: 'ls-mi', disabled, onclick: () => { closeMenu(); fn() } }, icon(ic), h('span', label), kbd ? h('kbd', kbd) : null)
    const sep = () => h('div', { class: 'ls-mi-sep', role: 'separator' })
    const list = onItem && items.length ? [
      one.type === 'text' && mi('Edit text', 'type', () => ed.startTextEdit(one.id), 'Enter'),
      one.type === 'text' && mi(one.next ? 'Go to next frame' : 'Thread text', 'link', () => (one.next ? ed.select([one.next]) : ed.armThread(one.id))),
      one.type === 'text' && one.next && mi('Break thread', 'unlink', () => cmd.breakThread(store, one.id)),
      one.type === 'image' && mi(one.asset ? 'Replace image' : 'Place image', 'image-plus', () => pickImage(one.id)),
      sep(),
      mi('Cut', 'scissors', () => ed.cut(), 'Ctrl X'), mi('Copy', 'copy', () => ed.copy(), 'Ctrl C'), mi('Paste', 'clipboard-paste', () => ed.paste(), 'Ctrl V'), mi('Duplicate', 'copy-plus', () => ed.duplicate(), 'Ctrl D'), mi('Delete', 'trash-2', () => ed.remove(), 'Del'),
      sep(),
      mi('Bring to front', 'chevrons-up', () => cmd.reorder(store, ed.unlockedIds(), 'front')), mi('Send to back', 'chevrons-down', () => cmd.reorder(store, ed.unlockedIds(), 'back')),
      items.length > 1 && mi('Group', 'group', () => cmd.groupItems(store, ed.unlockedIds()), 'Ctrl G'),
      items.some((i) => i.grp) && mi('Ungroup', 'ungroup', () => cmd.ungroupItems(store, ed.unlockedIds()), 'Ctrl Shift G'),
      mi(locked ? 'Unlock' : 'Lock position', locked ? 'lock-open' : 'lock', () => cmd.updateItems(store, ed.sel, { locked: !locked })),
    ] : [
      mi('Paste', 'clipboard-paste', () => ed.paste(), 'Ctrl V'), mi('Select all', 'square-dashed-mouse-pointer', () => ed.selectAll(), 'Ctrl A'),
      sep(), mi('Place an image or a text file', 'image-plus', () => pickImage(null)), mi('Fit page in view', 'scan', () => ed.fitPage(), 'Ctrl 0'),
    ]
    menuEl = h('div', { class: 'ls-menu', role: 'menu', 'aria-label': 'Frame actions' }, list.filter(Boolean))
    wrap.append(menuEl)
    const r = wrap.getBoundingClientRect()
    menuEl.style.left = `${Math.max(4, Math.min(x - r.left, r.width - menuEl.offsetWidth - 4))}px`
    menuEl.style.top = `${Math.max(4, Math.min(y - r.top, r.height - menuEl.offsetHeight - 4))}px`
    menuEl.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
    document.addEventListener('pointerdown', onAway, true)
    document.addEventListener('keydown', onMenuKey, true)
  }
  ed.on((type, d) => { if (type === 'menu') openMenu(d) })

  // keep the canvas focused for shortcuts after tool changes
  ed.on((t) => { if (t === 'tool') ed.view.focus({ preventScroll: true }) })

  // ---------- Initial document ----------
  const first = async () => {
    const ptr = await getPointer(ptrKey)
    let loaded = ptr ? await loadProject(ptr) : null
    if (loaded) { store.load(loaded.doc, loaded.assets); docName.value = store.doc.name; return }
    if (templateParam) { const t = makeTemplate(templateParam); store.load(t.doc, new Map(t.assets.map((a) => [a.id, a]))); for (const id of store.assets.keys()) store.unsavedAssets.add(id); store.dirty = true; docName.value = store.doc.name; scheduleSave(); return }
    welcome.hidden = false
    const recents = await listProjects()
    welcome.replaceChildren(h('div', { class: 'ls-welcome-in' },
      h('div', [h('h2', 'Lay out something beautiful'), h('p', 'Pick a starting point. Everything is built on pages with text and image frames, master pages and styles, and it exports to a PDF with real, selectable text. Your work is saved in this browser as you go.')]),
      templateGallery({
        onPick: (id) => startFromTemplate(id), onCustom: () => customDocDialog({ unit: store.doc.unit, onCreate: (r) => app.load(r, true) }),
        onOpenFile: openFile, recents, onOpenRecent: openRecent,
      })))
  }
  await first()
  syncAll()
  const ro = new ResizeObserver(() => ed.resize())
  ro.observe(ed.el)

  // ---------- Cleanup ----------
  const cleanup = () => {
    clearTimeout(saveTimer)
    closeMenu()
    ed.endTextEdit(true)
    saveNow()
    unsubStore()
    ro.disconnect()
    ed.destroy()
    cancelAnimationFrame(raf)
  }
  wrap._app = { store, ed, scene, app } // reachable from automated tests without adding a global
  signal?.addEventListener('abort', () => {}, { once: true })
  return cleanup
}
