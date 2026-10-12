// Draw Studio: a desktop-vector-editor-style app in the browser. Opens CDR, AI, PDF, EPS, SVG and picture files, shows them faithfully,
// lets you edit them and (in later milestones) saves CDR or any format. This module is only the shell: it builds the page chrome and wires
// the store (immutable document, undo), renderer (SVG DOM of the current page), view (zoom and pan), tools, commands, menus and bars.
// The engine lives in the _ds-*.js helpers; readers and writers are loaded on demand with import().
import { h, icon, button, alert, modal, toast, errorMessage, isAbort } from '../../lib/ui.js'
import { baseName, pickFiles } from '../../lib/files.js'
import { load, save as keep } from '../../lib/store.js'
import { ensureStyle } from './_ds-css.js'
import { createStore } from './_ds-store.js'
import { LIMITS, newDoc } from './_ds-doc.js'
import { createAssets } from './_ds-assets.js'
import { createFonts } from './_ds-text.js'
import { createRenderer } from './_ds-render.js'
import { createView } from './_ds-view.js'
import { TOOL_INFO, createTools } from './_ds-tools.js'
import { createTextEditor, createTextTool } from './_ds-text-edit.js'
import { createCommands } from './_ds-cmd.js'
import { createContextMenu, createMenus } from './_ds-ui-menu.js'
import { createToolbox, createStandardBar, createPageTabs, createStatusBar } from './_ds-ui-bars.js'
import { createPropBar } from './_ds-ui-prop.js'
import { createPalette, openColorDialog } from './_ds-ui-palette.js'
import { createDocks } from './_ds-ui-docks.js'
import { createArrangeSection, createNodeSection, createShapeSection } from './_ds-ui-shape.js'
import { createAlignSection, createTransformSection } from './_ds-ui-xform.js'
import { createClipboard } from './_ds-clip.js'
import { createPageSection, createTextSection } from './_ds-ui-ctx.js'
import { createDialogs } from './_ds-ui-dialogs.js'
import { createMoreDialogs } from './_ds-ui-dlg.js'
import { createBitmapSection, createEyedropSection, createFillSection, createPropertiesSection, createTranspSection } from './_ds-ui-fx.js'
import { createRulers } from './_ds-rulers.js'
import { createImporter } from './_ds-import.js'
import { PREF_KEY, cleanPrefs } from './_ds-prefs.js'
import { hitByDistance, pickFromTarget } from './_ds-hit.js'
import { createPersist } from './_ds-persist.js'
import { leavesOf } from './_ds-ops.js'
import { selectionStyle } from './_ds-sel.js'
import { rgbFromCmyk, rgbToHex } from './_ds-colors.js'
import { ACCEPT, OpenError, assetIds, openBitmap, openFile } from './_ds-open.js'

const CONVERSIONS = { cdr: 'CDR', ai: 'AI', pdf: 'PDF', eps: 'EPS', svg: 'SVG', png: 'PNG', jpg: 'JPG' }

export async function mount(root, ctx = {}) {
  ensureStyle()
  const quick = ctx.params?.to && CONVERSIONS[ctx.params.to] ? ctx.params.to : null
  const store = createStore(newDoc({ title: 'Untitled', source: 'new' }), { prefs: { wheel: 'zoom', ...cleanPrefs(load(PREF_KEY, {})) } })
  const assets = createAssets()
  const fonts = createFonts({ store })
  const cleanups = []
  const on = (target, ev, fn, opts) => { target.addEventListener(ev, fn, opts); cleanups.push(() => target.removeEventListener(ev, fn, opts)) }

  // ---------- DOM ----------
  const art = h('svg', { class: 'ds-art', 'aria-hidden': 'true' })
  const ov = h('svg', { class: 'ds-ov', 'aria-hidden': 'true' })
  const host = h('div', { class: 'ds-view', tabindex: 0, role: 'application', 'aria-label': 'Drawing canvas. Arrow keys nudge the selection, plus and minus zoom, H or Space pans, Esc clears the selection.' }, art, ov)
  const emptyCard = h('div', { class: 'ds-empty-card' })
  const empty = h('div', { class: 'ds-empty' }, emptyCard)
  const busy = h('div', { class: 'ds-busy', hidden: true })
  const stage = h('div', { class: 'ds-stage' }, host, empty, busy, h('div', { class: 'ds-dropnote', 'aria-hidden': 'true' }, 'Drop to open'))
  const input = h('input', { type: 'file', accept: ACCEPT, multiple: true, tabindex: -1, 'aria-hidden': 'true', hidden: true, onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) openFiles(f) } })
  const zone = h('div', { class: 'dropzone', hidden: true, 'aria-hidden': 'true' }, input)
  zone._accept = ACCEPT
  zone._take = (files) => openFiles(files, 'drop')

  const renderer = createRenderer({ store, svgRoot: art, assets, faces: fonts })
  const boxOf = renderer.nodeBox
  const view = createView({ store, host, ov, renderer, boxOf })
  let tools = null
  const rulers = createRulers({ store, view, stage, host, boxOf, getTool: () => tools?.current, app: { guideDialog: (id) => app.guideDialog(id) } })
  const textEditor = createTextEditor({ store, view, renderer, host, stage, fonts, setTool: (id) => tools.set(id) })
  const textTool = createTextTool({ store, boxOf, editor: textEditor, info: TOOL_INFO.find((t) => t.id === 'text') })
  tools = createTools({ store, view, boxOf, host, renderer, extra: { text: textTool } })
  const persist = createPersist({ store, assets })

  const app = {
    openPicker: () => input.click(),
    newDoc: () => newDrawing(),
    showNotes: () => showNotes(),
    showShortcuts: () => dlg2.openFinder(),
    fullscreen: () => { if (document.fullscreenElement) document.exitFullscreen?.(); else root.requestFullscreen?.().catch(() => {}) },
    gotoPage: (i) => gotoPage(i),
    colorDialog: (kind) => colorDialog(kind),
    toggleDock: () => docks.toggle(),
    dockOpen: () => docks.isOpen(),
    hasDoc: () => hasDoc,
    commitEdits: () => textEditor.commit(),
    pageSetup: () => dialogs.openPageSetup(),
    renamePage: (i) => pageTabs.rename(i),
    save: () => save(),
    saveAs: (format, o = {}) => dialogs.openExport({ format, ...o }),
    restore: () => restoreDrawing(),
    exportNotes: () => showExportNotes(),
    hasExportNotes: () => !!lastExport,
    noteExport: (res) => { lastExport = { notes: res.notes, name: res.files[0]?.name || '' } },
    textProps: (p) => commands.doc.textProps(p),
    fontChosen: (f) => commands.doc.fontChosen(f),
    addFont: () => commands.doc.addFont(),
    shapeProps: (kind, patch) => commands.obj.shapeProps(kind, patch),
    shapeState: () => tools.tools.shape.state,
    label: (id) => commands.label(id),
    showDock: (id, tab) => { if (tab) xform.setTab(tab); docks.openSection(id) },
    keepPref: (k, v) => { store.setPref(k, v); keep(PREF_KEY, cleanPrefs(store.prefs)) }, // a choice the user made: remembered on this device
    rulersShown: () => rulers.shown(),
    guideDialog: (id, axis) => dlg2.openGuide(id, axis),
    outlineDialog: () => dlg2.openOutlinePen(),
    traceDialog: (preset) => dlg2.openTrace(preset),
    optionsDialog: () => dlg2.openOptions(),
    docProps: () => dlg2.openDocProps(),
    moveToLayerDialog: () => dlg2.openMoveToLayer(),
    showConversions: () => dlg2.showConversions(),
    showFormats: () => dlg2.showFormats(),
    showAbout: () => dlg2.showAbout(),
    importFiles: () => importPicker(),
    placeBitmap: async () => { const [f] = await pickFiles({ accept: 'image/*,.heic,.heif' }); if (f) importFiles([f]) },
    fillTool: () => tools.tools.fill,
    eyedropTool: () => tools.tools.eyedrop,
    panelShown: (which) => !wrap.classList.contains(`ds-hide-${which}`),
    togglePanel: (which) => { wrap.classList.toggle(`ds-hide-${which}`); store.emit('prefs', {}) },
    resetLayout: () => { for (const w of ['palette', 'toolbox']) wrap.classList.remove(`ds-hide-${w}`); docks.set(true); app.keepPref('rulers', undefined); store.emit('prefs', {}); status.say('The layout is back to the default.') },
    confirm: (title, text, ok = 'OK') => new Promise((resolve) => {
      let done = false
      const finish = (v) => { if (done) return; done = true; resolve(v); m.close() }
      const m = modal({ title, icon: 'circle-help', body: h('div', { class: 't-ds-dlg' }, h('p', text)), actions: [button('Cancel', { variant: 'secondary', onClick: () => finish(false) }), button(ok, { variant: 'primary', onClick: () => finish(true) })], onClose: () => { if (!done) { done = true; resolve(false) } } })
    }),
  }
  let lastExport = null
  const commands = createCommands({ store, view, tools, boxOf, app, fonts, renderer, assets })
  app.run = commands.run
  app.fx = commands.fx
  app.enabled = commands.enabled
  app.paint = commands.paint
  const menus = createMenus({ commands, focusBack: () => host.focus({ preventScroll: true }) })
  const dlg2 = createMoreDialogs({ store, app, assets })
  const toolbox = createToolbox({ store, tools })
  const std = createStandardBar({ commands, store, app, focusBack: () => host.focus({ preventScroll: true }) })
  const prop = createPropBar({ store, boxOf, commands })
  const palette = createPalette({ store, app })
  app.noteColor = palette.noteColor
  const docks = createDocks({ store, app, commands, focusBack: () => host.focus({ preventScroll: true }) })
  const pageTabs = createPageTabs({ store, app })
  const status = createStatusBar({ store, view, app })
  const dialogs = createDialogs({ store, app, assets, fonts, boxOf, persist })
  prop.add(createPageSection({ store, app }))
  prop.add(createTextSection({ store, app }))
  prop.add(createShapeSection({ store, app }))
  prop.add(createNodeSection({ store, app }))
  prop.add(createArrangeSection({ store, app }))
  for (const sec of [createFillSection, createTranspSection, createEyedropSection, createBitmapSection]) prop.add(sec({ store, app }))
  const propsSec = createPropertiesSection({ store, app, boxOf })
  docks.addSection({ id: 'properties', title: 'Properties', el: propsSec.el, refresh: propsSec.refresh, open: false })
  const alignSec = createAlignSection({ store, app })
  docks.addSection({ id: 'align', title: 'Align and distribute', el: alignSec.el, refresh: alignSec.refresh, open: false })
  const xform = createTransformSection({ store, app, boxOf })
  docks.addSection({ id: 'transform', title: 'Transform', el: xform.el, refresh: xform.refresh, open: false })

  const panelsBtn = h('button', { type: 'button', class: 'ds-panelsbtn', 'aria-label': 'Panels', 'aria-haspopup': 'dialog', onclick: () => docks.toggle() }, icon('panel-bottom'), h('span', 'Panels'))
  const wrap = h('div', { class: 't-ds', 'aria-label': 'Draw Studio editor' },
    h('div', { class: 'ds-top' }, h('div', { class: 'ds-toprow' }, menus.menuButton, menus.bar, panelsBtn), std.el, prop.el),
    h('div', { class: 'ds-mid' }, toolbox.el, stage, docks.el, palette.el),
    pageTabs.el, status.el, menus.sheet, zone)
  if (quick) { wrap.dataset.quick = quick; wrap.classList.add('ds-dim') }
  root.append(wrap)
  docks.attach(wrap)
  app.clip = createClipboard({ store, boxOf, assets, fonts, view, wrap, host })
  const ctxMenu = createContextMenu({ commands, wrap, focusBack: () => host.focus({ preventScroll: true }) })
  const importer = createImporter({ store, assets, fonts, boxOf, dialogs: dlg2 })

  // ---------- refresh ----------
  const refreshAll = () => { std.refresh(); prop.refresh(); pageTabs.refresh(); status.refresh(); toolbox.refresh(); palette.refresh() }
  let hasDoc = false
  let restoreInfo = null // {title, savedAt, pages} of an autosaved drawing the user may bring back
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'just now' : m < 60 ? `${m} minute${m === 1 ? '' : 's'} ago` : m < 1440 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'} ago` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'} ago` }
  const drawEmpty = () => {
    empty.hidden = hasDoc
    if (hasDoc) return
    emptyCard.replaceChildren(
      icon(quick ? 'file-output' : 'vector-square'),
      h('h3', quick ? `Drop a CDR, AI, PDF or SVG file to save it as ${CONVERSIONS[quick]}` : 'Open a drawing'),
      h('p', quick ? 'Your file is opened here in the browser and never uploaded.' : 'Drop a CDR, AI, PDF, EPS, SVG or picture file here, or start a new drawing. Your files stay on this device.'),
      h('div', { class: 'ds-empty-row' }, button('Choose a file', { icon: 'folder-open', variant: 'primary', onClick: () => input.click() }), quick ? null : button('New drawing', { icon: 'file-plus', variant: 'secondary', onClick: () => newDrawing() })),
      restoreInfo && !quick ? h('div', { class: 'ds-restore', role: 'region', 'aria-label': 'Restore your last drawing' },
        h('p', h('strong', 'Restore your last drawing?'), ` "${restoreInfo.title}" (${restoreInfo.pages} page${restoreInfo.pages === 1 ? '' : 's'}) was saved automatically ${ago(restoreInfo.savedAt)}.`),
        h('div', { class: 'ds-empty-row' }, button('Restore', { icon: 'history', variant: 'primary', onClick: () => restoreDrawing() }), button('Discard', { variant: 'secondary', onClick: () => { restoreInfo = null; persist.clear(); drawEmpty() } }))) : null)
  }
  drawEmpty()
  const offs = [
    store.on('doc', (e) => { if (e?.load && !hasDoc) { hasDoc = true; wrap.classList.remove('ds-dim'); drawEmpty() } refreshAll() }), store.on('sel', () => { status.clearTransient(); refreshAll() }), store.on('page', refreshAll), store.on('tool', refreshAll), store.on('fonts', refreshAll),
    store.on('prefs', () => { renderer.setWire(!!store.prefs.wire); refreshAll() }), store.on('fillsel', refreshAll), store.on('guides', refreshAll),
    store.on('status', (t) => { status.say(typeof t === 'string' ? t : ''); if (typeof t !== 'string') std.refresh() }), store.on('view', () => { std.refresh(); status.refresh() }), store.on('cursor', status.cursor),
  ]
  cleanups.push(...offs)
  refreshAll()

  // ---------- keyboard: ONE listener on the app root (the site's own document-level handlers would win a document listener) ----------
  on(wrap, 'keydown', (e) => {
    if (e.key === ' ' && e.target === host && !e.repeat) { e.preventDefault(); view.setSpace(true); return }
    commands.onKeydown(e)
  })
  on(wrap, 'keyup', (e) => { if (e.key === ' ') view.setSpace(false) })
  on(window, 'blur', () => view.setSpace(false))

  // ---------- pages ----------
  const waiting = new Map() // page -> [resolve]
  async function gotoPage(i) {
    const p = store.root.pages[i]
    if (!p) return
    if (p.pending) {
      status.say(`Reading ${p.name}`)
      await new Promise((res) => { const list = waiting.get(p) || []; list.push(res); waiting.set(p, list) })
      status.clearTransient()
    }
    store.setPage(i)
  }
  const releasePages = (pages) => { for (const p of pages) for (const res of waiting.get(p) || []) res(); for (const p of pages) waiting.delete(p) }

  // ---------- busy overlay ----------
  let busyTimer = 0
  const bar = h('i'), busyText = h('span', 'Opening'), barBox = h('div', { class: 'ds-busy-bar ind', role: 'progressbar', 'aria-label': 'Progress' }, bar)
  let cancelFn = null
  busy.append(h('div', { class: 'ds-busy-card', role: 'status' }, h('div', { class: 'ds-busy-t' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), busyText), barBox,
    h('div', { class: 'ds-empty-row' }, button('Cancel', { variant: 'secondary', size: 'sm', onClick: () => cancelFn?.() }))))
  const showBusy = (text, cancel) => { cancelFn = cancel; busyText.textContent = text; clearTimeout(busyTimer); busyTimer = setTimeout(() => { busy.hidden = false }, 200) }
  const setBusy = (text, frac) => {
    if (text) busyText.textContent = text
    const ind = frac == null || !Number.isFinite(frac)
    barBox.classList.toggle('ind', ind)
    bar.style.width = ind ? '' : `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`
    if (ind) barBox.removeAttribute('aria-valuenow'); else barBox.setAttribute('aria-valuenow', String(Math.round(frac * 100)))
  }
  const hideBusy = () => { clearTimeout(busyTimer); busy.hidden = true }

  // ---------- colour dialog ----------
  /** The CMYK numbers the dialog should show again: the first selected shape whose stored hint still equals the colour. */
  function cmykHint(kind, hex) {
    const key = kind === 'fill' ? 'fillK' : 'strokeK'
    for (const l of leavesOf(store.sel.ids.map((id) => store.find(id)?.node).filter(Boolean))) {
      const k = l[key]
      if (k && rgbToHex(...rgbFromCmyk(...k)) === hex) return k
    }
    return null
  }
  function colorDialog(kind) {
    if (!store.sel.ids.length) { status.say('Select an object first.'); return }
    const cur = selectionStyle(store)?.[kind]
    const hex = cur?.kind === 'color' ? cur.hex : '#000000'
    openColorDialog({
      kind, hex, K: cmykHint(kind, hex),
      onApply: (hx, k) => commands.paint(kind, hx, k),
      onAddToPalette: (hx) => { if (store.tx('Add colour to palette', (r) => ((r.palette || []).includes(hx) ? r : { ...r, palette: [...(r.palette || []), hx].slice(-200) }))) status.say(`Added ${hx} to this document's palette`) },
    })
  }

  // ---------- dialogs ----------
  const dlg = (title, ic, body, actions) => modal({ title, icon: ic, body: h('div', { class: 't-ds-dlg' }, body), actions })
  function showNotes() {
    const notes = store.root.warnings
    dlg('Notes about this file', 'info', notes.length
      ? [h('p', 'These are things the reader approximated or could not show:'), h('ul', { class: 'ds-list' }, notes.map((n) => h('li', n)))]
      : h('p', 'No notes. This file opened without any approximations.'))
  }
  function askPassword(message) {
    return new Promise((resolve) => {
      let done = false
      const pw = h('input', { type: 'password', class: 'input', autocomplete: 'off', 'aria-label': 'PDF password' })
      const finish = (v) => { if (done) return; done = true; resolve(v); m.close() }
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(pw.value) })
      const m = modal({ title: 'Password needed', icon: 'lock', body: h('div', { class: 't-ds-dlg' }, h('p', message), pw), actions: [button('Cancel', { variant: 'secondary', onClick: () => finish(null) }), button('Open', { variant: 'primary', onClick: () => finish(pw.value) })], onClose: () => { if (!done) { done = true; resolve(null) } } })
      pw.focus()
    })
  }
  function showOpenError(e, file) {
    const warnings = e.warnings?.length ? e.warnings : []
    const actions = []
    let m
    if (e.preview) actions.push(button('Open the preview image only', { icon: 'image', variant: 'primary', onClick: () => { m.close(); openBlobAsDrawing(new Blob([e.preview.bytes], { type: e.preview.mime }), `${baseName(file.name)}-preview.${e.preview.mime.includes('png') ? 'png' : e.preview.mime.includes('jpeg') ? 'jpg' : 'bmp'}`) } }))
    actions.push(button('Close', { variant: 'secondary', onClick: () => m.close() }))
    m = dlg(e.code === 'UNREADABLE' ? 'This drawing could not be opened' : 'Could not open this file', 'circle-alert', [
      alert('error', h('strong', e.message), warnings.length ? h('ul', { class: 'ds-list' }, warnings.map((w) => h('li', w))) : null),
      e.code === 'UNREADABLE' && e.preview ? h('p', { class: 'small muted' }, 'The small preview picture stored inside the file can be opened instead. It is only a picture, not your editable drawing.') : null,
      e.code === 'UNREADABLE' ? h('p', { class: 'small muted' }, 'The reader was written from public format notes and handles CDR 7 to X3 and the ZIP containers of X4 and newer. Saving the drawing as an older version, or as PDF or SVG, can help.') : null,
    ], actions)
  }

  // ---------- opening and loading ----------
  let openCtl = null
  async function loadDocument(res, meta = {}) {
    const { doc, rest } = res
    await fonts.use(doc.fonts, doc.uid)
    store.load(doc, meta)
    restoreInfo = null
    assets.prune(assetIds(doc))
    hasDoc = true
    wrap.classList.remove('ds-dim')
    drawEmpty()
    status.clearTransient()
    view.zoomPage()
    host.focus({ preventScroll: true })
    if (rest) {
      const ctl = openCtl
      const pending = doc.pages.filter((p) => p.pending)
      store.track(rest({ store, fonts, signal: ctl?.signal, onPage: (p) => { releasePages([p]); refreshAll() } }).catch((e) => {
        if (isAbort(e)) return
        console.error(e)
        for (const p of pending) { delete p.pending }
        releasePages(pending)
        toast(`Some pages could not be read: ${errorMessage(e)}`, 'error')
        refreshAll()
      }))
    }
  }
  const hasContent = () => store.root.pages.some((p) => p.pending || p.layers.some((l) => l.items.length))
  /** Open files. via: 'picker' (File > Open, an explicit choice) | 'drop' (dropped on the canvas or handed over by another tool). A drop onto a drawing that has content asks first. */
  async function openFiles(files, via = 'picker') {
    files = files.slice(0, LIMITS.files)
    if (!files.length) return
    if (hasDoc && !quick && hasContent() && (via !== 'picker' || files.length > 1)) {
      const choice = await dlg2.openOrImport(files)
      if (!choice) return
      if (choice === 'import') { await importFiles(files); return }
    }
    const opened = await openOne(files[0])
    if (!opened || files.length < 2) return
    if (quick) { toast(`Opened ${files[0].name}. Open the other files one at a time.`); return }
    await addPagesFrom(files.slice(1))
  }
  async function openOne(file) {
    openCtl?.abort()
    const ctl = new AbortController()
    openCtl = ctl
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctl.abort() }, LIMITS.openMs)
    showBusy(`Opening ${file.name}`, () => ctl.abort())
    setBusy(null, null)
    try {
      const res = await openFile(file, { assets, signal: ctl.signal, progress: (t, f) => setBusy(t, f), askPassword })
      if (ctl !== openCtl) return false
      await loadDocument(res)
      hideBusy()
      const n = store.root.pages.length
      status.say(`Opened ${file.name}: ${n} page${n === 1 ? '' : 's'}`)
      if (quick) dialogs.openExport({ format: quick, quick: true })
      return true
    } catch (e) {
      hideBusy()
      if (ctl !== openCtl) return false
      if (isAbort(e)) { if (timedOut) showOpenError(new OpenError('Opening this file took longer than two minutes, so it was stopped.', { code: 'TIMEOUT' }), file); return false }
      showOpenError(e instanceof OpenError ? e : new OpenError(errorMessage(e), { code: 'FAILED' }), file)
      return false
    } finally { clearTimeout(timer); hideBusy() }
  }
  /** Run one import-like job per file with the busy overlay; failures are shown per file and the rest go on. */
  async function eachFile(files, label, job) {
    let done = 0
    for (const file of files) {
      const ctl = new AbortController()
      showBusy(`${label} ${file.name}`, () => ctl.abort())
      setBusy(null, null)
      try { done += (await job(file, { signal: ctl.signal, progress: (t, f) => setBusy(t, f), askPassword })) ? 1 : 0 } catch (e) {
        hideBusy()
        if (isAbort(e)) break
        showOpenError(e instanceof OpenError ? e : new OpenError(errorMessage(e), { code: 'FAILED' }), file)
      } finally { hideBusy() }
    }
    return done
  }
  /** Import files onto the current page, each as a group (one undo step each). */
  async function importFiles(files) {
    files = files.slice(0, LIMITS.files)
    if (!files.length) return
    if (!hasDoc) { await openFiles(files); return }
    const done = await eachFile(files, 'Importing', (f, env) => importer.importFile(f, env))
    if (done > 1) toast(`Imported ${done} files onto this page.`)
  }
  /** The other files of a multi-file open become new pages. */
  async function addPagesFrom(files) {
    let pages = 0
    const done = await eachFile(files, 'Adding pages from', async (f, env) => { const n = await importer.appendPages(f, env); pages += n; return n })
    if (done) { status.say(`Added ${pages} page${pages === 1 ? '' : 's'} from ${done} more file${done === 1 ? '' : 's'}`); refreshAll() }
  }
  async function importPicker() {
    const files = await pickFiles({ accept: ACCEPT, multiple: true })
    if (files.length) importFiles(files)
  }
  async function openBlobAsDrawing(blob, name) {
    openCtl?.abort()
    const ctl = new AbortController()
    openCtl = ctl
    showBusy('Opening the preview', () => ctl.abort())
    try { await loadDocument(await openBitmap(blob, name, { assets })) } catch (e) { showOpenError(new OpenError(errorMessage(e), { code: 'FAILED' }), { name }) } finally { hideBusy() }
  }
  function newDrawing() {
    dialogs.openNew({ dirty: hasDoc && store.dirty, onCreate: async (o) => {
      openCtl?.abort()
      await loadDocument({ doc: newDoc({ title: o.title, w: o.w, h: o.h, units: o.units, source: 'new' }) })
    } })
  }

  // ---------- save, restore, export notes ----------
  let saving = false
  async function save() {
    if (!hasDoc || saving) return
    saving = true
    const ctl = new AbortController()
    showBusy('Saving CDR', () => ctl.abort())
    setBusy('Preparing', null)
    try {
      const res = await dialogs.runExport('cdr', {}, { signal: ctl.signal, onProgress: (f, t) => setBusy(t, f) })
      hideBusy()
      const n = res.notes.length
      toast(`Saved ${res.files[0].name}${n ? `. ${n} note${n === 1 ? '' : 's'}: see File > Notes about the last save or export.` : ''}`, 'success')
      status.say(`Saved ${res.files[0].name}`)
      refreshAll()
    } catch (e) {
      hideBusy()
      if (!isAbort(e)) { console.error(e); toast(errorMessage(e), 'error') }
    } finally { saving = false; hideBusy() }
  }
  function showExportNotes() {
    if (!lastExport) return
    dlg('Notes about the last save or export', 'info', lastExport.notes.length
      ? [h('p', `${lastExport.name}: these things were approximated or left out.`), h('ul', { class: 'ds-list' }, lastExport.notes.map((n) => h('li', n)))]
      : h('p', `${lastExport.name}: nothing was approximated.`))
  }
  async function restoreDrawing() {
    const info = await persist.peek()
    if (!info || info.bad) { toast(info?.bad ? 'The autosaved drawing is damaged, so it was discarded.' : 'There is no autosaved drawing to restore.', info?.bad ? 'error' : 'info'); if (info?.bad) await persist.clear(); restoreInfo = null; drawEmpty(); return }
    const go = async () => {
      showBusy('Restoring your drawing', null)
      setBusy('Restoring your drawing', null)
      try {
        const { doc, notes } = await persist.restore()
        openCtl?.abort()
        await loadDocument({ doc }, { dirty: true })
        restoreInfo = null
        status.say(`Restored ${doc.title}${notes.length ? `. ${notes[0]}` : ''}`)
        if (notes.length) toast(`Restored with changes: ${notes.join(' ')}`)
      } catch (e) {
        console.error(e)
        toast(`${errorMessage(e)}`, 'error')
        await persist.clear()
        restoreInfo = null
        drawEmpty()
      } finally { hideBusy() }
    }
    if (hasDoc && store.dirty) {
      const m = dlg('Restore the autosaved drawing?', 'history', h('p', 'The drawing you are working on has changes that are not saved. They will be replaced.'),
        [button('Cancel', { variant: 'secondary', onClick: () => m.close() }), button('Restore', { variant: 'danger', onClick: () => { m.close(); go() } })])
    } else go()
  }

  // ---------- drag and drop on the canvas ----------
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files')
  on(stage, 'dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); stage.classList.add('ds-drag'); emptyCard.classList.add('drag') } })
  on(stage, 'dragleave', (e) => { if (!stage.contains(e.relatedTarget)) { stage.classList.remove('ds-drag'); emptyCard.classList.remove('drag') } })
  on(stage, 'drop', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    stage.classList.remove('ds-drag'); emptyCard.classList.remove('drag')
    const files = [...e.dataTransfer.files]
    if (files.length) openFiles(files, 'drop')
  })

  // ---------- context menu ----------
  const NODE_IDS = ['node.add', 'node.delete', 'node.toLine', 'node.toCurve', 'node.cusp', 'node.smooth', 'node.symmetrical', 'node.break', 'node.join', 'node.close', 'node.reverse']
  on(host, 'contextmenu', (e) => {
    e.preventDefault()
    if (!hasDoc || !['pick', 'shape', 'fill', 'transp', 'eyedrop'].includes(store.tool)) return
    const { s, p } = view.fromClient(e)
    const gd = rulers.hit(s)
    let ids
    if (gd) { store.setSel([]); store.guideSel = gd.id; store.emit('guides'); ids = ['layout.editGuide', 'layout.deleteGuide', 'layout.clearGuides', '-', 'layout.lockGuides', 'view.guides'] } else {
      const id = pickFromTarget(e.target, store) ?? hitByDistance(store, boxOf, p, 6 / store.view.z)
      if (id != null && !store.sel.ids.includes(id)) store.setSel([id])
      else if (id == null && store.tool !== 'shape') store.setSel([])
      const nodes = store.sel.ids.map((x) => store.find(x)?.node).filter(Boolean)
      if (!nodes.length) ids = ['edit.paste', 'edit.pasteInPlace', '-', 'edit.selectAll', 'edit.invertSelection', '-', 'view.zoomPage', 'view.zoomAll', 'view.zoom100', '-', 'layout.guideH', 'layout.guideV', 'page.setup', '-', 'win.properties']
      else {
        ids = [...(store.tool === 'shape' ? [...NODE_IDS, '-'] : []), 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', '-', 'arrange.group', 'arrange.ungroup', 'arrange.combine', 'arrange.breakApart', '-', 'arrange.front', 'arrange.back', '-', 'arrange.lock', 'object.toCurves',
          ...(nodes.some((n) => n.t === 'text') ? ['text.edit'] : []), ...(commands.fx.imageTarget() ? ['-', 'bitmap.traceLogo', 'bitmap.saveOriginal'] : []), '-', 'win.properties']
      }
    }
    ctxMenu.open(e.clientX, e.clientY, ids)
  })

  // ---------- test hook (no globals): root.__ds drives the editor from the harness ----------
  const api = { store, commands, assets, fonts, renderer, view, tools, docks, palette, prop, persist, dialogs, dlg2, rulers, ctxMenu, importer, textEditor, pageTabs, clip: app.clip, xform, openFile: (file) => openFiles([file]), openFiles, importFiles, whenReady: () => store.whenReady() }
  root.__ds = api
  wrap.__ds = api
  host.focus({ preventScroll: true })
  if (!quick) {
    persist.start()
    persist.peek().then(async (info) => {
      if (!info || hasDoc) return
      if (info.bad) { await persist.clear(); toast('The autosaved drawing was damaged, so it was discarded.', 'error'); return }
      restoreInfo = info
      drawEmpty()
    }).catch(() => {})
  }

  return () => {
    openCtl?.abort()
    clearTimeout(busyTimer)
    cleanups.forEach((fn) => fn())
    app.clip.dispose(); ctxMenu.dispose(); rulers.dispose(); textEditor.dispose(); persist.dispose(); menus.dispose(); docks.dispose(); view.dispose(); renderer.dispose(); fonts.dispose(); assets.dispose()
    delete root.__ds
    wrap.remove()
  }
}
