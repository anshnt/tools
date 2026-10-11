// Draw Studio: a desktop-vector-editor-style app in the browser. Opens CDR, AI, PDF, EPS, SVG and picture files, shows them faithfully,
// lets you edit them and (in later milestones) saves CDR or any format. This module is only the shell: it builds the page chrome and wires
// the store (immutable document, undo), renderer (SVG DOM of the current page), view (zoom and pan), tools, commands, menus and bars.
// The engine lives in the _ds-*.js helpers; readers and writers are loaded on demand with import().
import { h, icon, button, alert, modal, toast, errorMessage, isAbort } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { ensureStyle } from './_ds-css.js'
import { createStore } from './_ds-store.js'
import { LIMITS, newDoc } from './_ds-doc.js'
import { createAssets } from './_ds-assets.js'
import { createFonts } from './_ds-text.js'
import { createRenderer } from './_ds-render.js'
import { createView } from './_ds-view.js'
import { createTools } from './_ds-tools.js'
import { createCommands } from './_ds-cmd.js'
import { createMenus } from './_ds-ui-menu.js'
import { createToolbox, createStandardBar, createPageTabs, createStatusBar } from './_ds-ui-bars.js'
import { createPropBar } from './_ds-ui-prop.js'
import { createPalette, openColorDialog } from './_ds-ui-palette.js'
import { createDocks } from './_ds-ui-docks.js'
import { leavesOf } from './_ds-ops.js'
import { selectionStyle } from './_ds-sel.js'
import { rgbFromCmyk, rgbToHex } from './_ds-colors.js'
import { shortcutRows } from './_ds-keys.js'
import { ACCEPT, OpenError, assetIds, openBitmap, openFile } from './_ds-open.js'

const CONVERSIONS = { cdr: 'CDR', ai: 'AI', pdf: 'PDF', eps: 'EPS', svg: 'SVG', png: 'PNG', jpg: 'JPG' }

export async function mount(root, ctx = {}) {
  ensureStyle()
  const quick = ctx.params?.to && CONVERSIONS[ctx.params.to] ? ctx.params.to : null
  const store = createStore(newDoc({ title: 'Untitled', source: 'new' }), { prefs: { wheel: 'zoom' } })
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
  zone._take = (files) => openFiles(files)

  const renderer = createRenderer({ store, svgRoot: art, assets, faces: fonts })
  const boxOf = renderer.nodeBox
  const view = createView({ store, host, ov, renderer, boxOf })
  const tools = createTools({ store, view, boxOf, host, renderer })

  const app = {
    openPicker: () => input.click(),
    newDoc: () => newDrawing(),
    showNotes: () => showNotes(),
    showShortcuts: () => showShortcuts(),
    fullscreen: () => { if (document.fullscreenElement) document.exitFullscreen?.(); else root.requestFullscreen?.().catch(() => {}) },
    gotoPage: (i) => gotoPage(i),
    colorDialog: (kind) => colorDialog(kind),
    toggleDock: () => docks.toggle(),
    dockOpen: () => docks.isOpen(),
  }
  const commands = createCommands({ store, view, tools, boxOf, app })
  app.run = commands.run
  app.enabled = commands.enabled
  app.paint = commands.paint
  const menus = createMenus({ commands, focusBack: () => host.focus({ preventScroll: true }) })
  const toolbox = createToolbox({ store, tools })
  const std = createStandardBar({ commands, store, app, focusBack: () => host.focus({ preventScroll: true }) })
  const prop = createPropBar({ store, boxOf, commands })
  const palette = createPalette({ store, app })
  app.noteColor = palette.noteColor
  const docks = createDocks({ store, app, commands, focusBack: () => host.focus({ preventScroll: true }) })
  const pageTabs = createPageTabs({ store, app })
  const status = createStatusBar({ store, view, app })

  const panelsBtn = h('button', { type: 'button', class: 'ds-panelsbtn', 'aria-label': 'Panels', 'aria-haspopup': 'dialog', onclick: () => docks.toggle() }, icon('panel-bottom'), h('span', 'Panels'))
  const wrap = h('div', { class: 't-ds', 'aria-label': 'Draw Studio editor' },
    h('div', { class: 'ds-top' }, h('div', { class: 'ds-toprow' }, menus.menuButton, menus.bar, panelsBtn), std.el, prop.el),
    h('div', { class: 'ds-mid' }, toolbox.el, stage, docks.el, palette.el),
    pageTabs.el, status.el, menus.sheet, zone)
  if (quick) { wrap.dataset.quick = quick; wrap.classList.add('ds-dim') }
  root.append(wrap)
  docks.attach(wrap)

  // ---------- refresh ----------
  const refreshAll = () => { std.refresh(); prop.refresh(); pageTabs.refresh(); status.refresh(); toolbox.refresh(); palette.refresh() }
  let hasDoc = false
  const drawEmpty = () => {
    empty.hidden = hasDoc
    if (hasDoc) return
    emptyCard.replaceChildren(
      icon(quick ? 'file-output' : 'vector-square'),
      h('h3', quick ? `Drop a CDR, AI, PDF or SVG file to save it as ${CONVERSIONS[quick]}` : 'Open a drawing'),
      h('p', quick ? 'Your file is opened here in the browser and never uploaded.' : 'Drop a CDR, AI, PDF, EPS, SVG or picture file here, or start a new drawing. Your files stay on this device.'),
      h('div', { class: 'ds-empty-row' }, button('Choose a file', { icon: 'folder-open', variant: 'primary', onClick: () => input.click() }), quick ? null : button('New drawing', { icon: 'file-plus', variant: 'secondary', onClick: () => newDrawing() })))
  }
  drawEmpty()
  const offs = [
    store.on('doc', (e) => { if (e?.load && !hasDoc) { hasDoc = true; wrap.classList.remove('ds-dim'); drawEmpty() } refreshAll() }), store.on('sel', () => { status.clearTransient(); refreshAll() }), store.on('page', refreshAll), store.on('tool', refreshAll),
    store.on('status', (t) => status.say(typeof t === 'string' ? t : '')), store.on('view', () => { std.refresh(); status.refresh() }), store.on('cursor', status.cursor),
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
  function showShortcuts() {
    const rows = shortcutRows()
    dlg('Keyboard shortcuts', 'keyboard', [
      h('dl', { class: 'ds-keys' }, rows.flatMap((r) => [h('dt', r.label), h('dd', r.keys.join('  or  '))])),
      h('p', { class: 'small muted' }, 'Browsers keep Ctrl+N, Ctrl+T, Ctrl+W and Ctrl+Tab for themselves, so New is Alt+N.')])
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
  async function loadDocument(res) {
    const { doc, rest } = res
    await fonts.use(doc.fonts, doc.uid)
    store.load(doc)
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
  async function openFiles(files) {
    files = files.slice(0, LIMITS.files)
    const file = files[0]
    if (!file) return
    openCtl?.abort()
    const ctl = new AbortController()
    openCtl = ctl
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ctl.abort() }, LIMITS.openMs)
    showBusy(`Opening ${file.name}`, () => ctl.abort())
    setBusy(null, null)
    try {
      const res = await openFile(file, { assets, signal: ctl.signal, progress: (t, f) => setBusy(t, f), askPassword })
      if (ctl !== openCtl) return
      await loadDocument(res)
      hideBusy()
      const n = store.root.pages.length
      status.say(`Opened ${file.name}: ${n} page${n === 1 ? '' : 's'}`)
      if (files.length > 1) toast(`Opened ${file.name}. Open the other files one at a time.`)
    } catch (e) {
      hideBusy()
      if (ctl !== openCtl) return
      if (isAbort(e)) { if (timedOut) showOpenError(new OpenError('Opening this file took longer than two minutes, so it was stopped.', { code: 'TIMEOUT' }), file); return }
      showOpenError(e instanceof OpenError ? e : new OpenError(errorMessage(e), { code: 'FAILED' }), file)
    } finally { clearTimeout(timer); hideBusy() }
  }
  async function openBlobAsDrawing(blob, name) {
    openCtl?.abort()
    const ctl = new AbortController()
    openCtl = ctl
    showBusy('Opening the preview', () => ctl.abort())
    try { await loadDocument(await openBitmap(blob, name, { assets })) } catch (e) { showOpenError(new OpenError(errorMessage(e), { code: 'FAILED' }), { name }) } finally { hideBusy() }
  }
  async function newDrawing() {
    const go = async () => { openCtl?.abort(); await loadDocument({ doc: newDoc({ title: 'Untitled', source: 'new' }) }) }
    if (!hasDoc || !store.dirty) return go()
    const m = dlg('Start a new drawing?', 'file-plus', h('p', 'The drawing you are working on has changes that are not saved. They will be lost.'),
      [button('Cancel', { variant: 'secondary', onClick: () => m.close() }), button('New drawing', { variant: 'danger', onClick: () => { m.close(); go() } })])
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
    if (files.length) openFiles(files)
  })

  // ---------- test hook (no globals): root.__ds drives the editor from the harness ----------
  const api = { store, commands, assets, fonts, renderer, view, tools, docks, palette, prop, openFile: (file, opts) => openFiles([file], opts), openFiles, whenReady: () => store.whenReady() }
  root.__ds = api
  wrap.__ds = api
  host.focus({ preventScroll: true })

  return () => {
    openCtl?.abort()
    clearTimeout(busyTimer)
    cleanups.forEach((fn) => fn())
    menus.dispose(); docks.dispose(); view.dispose(); renderer.dispose(); fonts.dispose(); assets.dispose()
    delete root.__ds
    wrap.remove()
  }
}
