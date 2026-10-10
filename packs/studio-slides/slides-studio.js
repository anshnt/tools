// Slides Studio: a browser slide deck editor. This file wires the modules together and owns keyboard, clipboard,
// file open/drop, export and the mobile pane switcher.
import { h, icon, toast, download, progress, errorMessage, isAbort } from '../../lib/ui.js'
import { safeName } from '../../lib/files.js'
import { Store } from './_state.js'
import { buildTemplate, colorOf } from './_themes.js'
import { textEl } from './_model.js'
import { ensureStyles } from './_styles.js'
import { createStage } from './_stage.js'
import { createActions } from './_actions.js'
import { createFormat } from './_format.js'
import { createPresenter } from './_present.js'
import { buildTopbar, buildRibbon, buildRail, buildStatus, shortcutsDialog, outlineDialog, pickProjectFiles, MOD } from './_chrome.js'
import { buildSorter, buildInspector, buildNotes } from './_panels.js'
import { menu, mountTips, closePopover } from './_ui.js'

class Bus {
  constructor() { this.m = new Map() }
  on(t, f) { if (!this.m.has(t)) this.m.set(t, new Set()); this.m.get(t).add(f); return () => this.m.get(t)?.delete(f) }
  emit(t, d) { this.m.get(t)?.forEach((f) => f(d)) }
}

const MARK = 'slides-studio:clip:'
const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif)$/i

export async function mount(root, { tool, params = {}, signal } = {}) {
  ensureStyles()
  const store = new Store(params.ns || 'main')
  const restored = await store.restore()
  if (!restored) store.load(buildTemplate(params.template || 'blank'))
  if (signal?.aborted) { store.dispose(); return }

  const disposers = []
  const shell = h('div', { class: 'ss', tabindex: -1, 'data-pane': 'canvas', role: 'application', 'aria-label': 'Slides Studio editor' })
  const app = {
    root: shell, store, bus: new Bus(), tool: 'select', shapeKind: 'rect', presenting: false, clip: null,
    onDispose: (fn) => { disposers.push(fn); return fn },
    color: (v) => colorOf(store.deck, v),
  }
  app.stage = createStage(app)
  const actions = (app.actions = createActions(app))
  app.format = createFormat(app)
  app.presenter = createPresenter(app)
  Object.assign(app, {
    addElement: actions.addElement, pickImage: actions.pickImage, insertImages: actions.insertImages, insertTable: actions.insertTable,
    setProps: (label, fn) => store.edit(label, () => store.selected.forEach(fn)),
  })

  // ---------- tools ----------
  app.setTool = (t, kind) => {
    if (app.stage.editing) app.stage.endEdit(true)
    app.tool = t
    if (kind) app.shapeKind = kind
    app.stage.el.dataset.tool = t
    app.stage.el.style.cursor = t === 'select' ? '' : 'crosshair'
    if (t !== 'select') store.select([])
    app.bus.emit('tool')
  }

  // ---------- busy overlay, files, export ----------
  app.run = async (label, fn) => {
    const prog = progress(label)
    prog.set(null, label)
    const ov = h('div', { class: 'ss-busy', role: 'alertdialog', 'aria-label': label }, h('div', { class: 'ss-busy-card' }, h('span', label), prog.el))
    shell.append(ov)
    try { return await fn((f, t) => prog.set(f, t)) } catch (err) {
      if (!isAbort(err)) { console.error(err); toast(errorMessage(err), 'error') }
    } finally { ov.remove() }
  }
  app.replaceDeck = (deck, assets, label) => { app.stage.endEdit(true); store.replace(deck, assets, label); app.setTool('select'); toast(`${label} done. Undo brings the previous deck back.`) }
  app.saveProject = () => app.run('Saving project', async () => {
    app.stage.endEdit(true)
    download(await store.exportProject(), `${safeName(store.deck.title)}.slides.zip`)
  })
  app.exportAs = (kind) => app.run({ pptx: 'Building PowerPoint file', pdf: 'Building PDF', png: 'Rendering slide', 'png-all': 'Rendering slides' }[kind], async (set) => {
    app.stage.endEdit(true)
    const m = await import('./_export.js')
    const r = kind === 'pptx' ? await m.exportPptx(store, { onProgress: set })
      : kind === 'pdf' ? await m.exportPdf(store, { onProgress: set })
        : await m.exportPngs(store, kind === 'png' ? 'current' : 'all', { onProgress: set })
    download(r.blob, r.name)
    toast(`Saved ${r.name}`, 'success')
  })
  app.openFile = async (file) => {
    const name = file.name.toLowerCase()
    if (/\.pptx?$/.test(name)) {
      return app.run('Importing presentation', async () => {
        const { importPptx } = await import('./_import.js')
        const r = await importPptx(file)
        app.replaceDeck(r.deck, r.assets, 'Import')
        const w = r.warnings
        if (w.skipped || w.images) toast(`Imported ${r.deck.slides.length} slides. ${w.skipped + w.images} objects (charts, SmartArt, video or unsupported pictures) were skipped.`)
      })
    }
    if (/\.(zip|json)$/.test(name)) {
      return app.run('Opening project', async () => {
        if (name.endsWith('.json')) {
          let doc
          try { doc = JSON.parse(await file.text()) } catch { throw new Error('That JSON file could not be read.') }
          const d = doc.deck || doc
          if (!Array.isArray(d.slides)) throw new Error('That JSON file has no slides in it.')
          return app.replaceDeck(d, [], 'Open')
        }
        const r = await store.importProject(file)
        app.replaceDeck(r.deck, r.assets, 'Open')
      })
    }
    if (IMAGE_RE.test(name) || /^image\//.test(file.type)) return actions.insertImages([file])
    toast(`${file.name} is not a deck or an image. Open a .pptx, a Slides Studio .zip, or drop pictures.`, 'error')
  }
  app.openFiles = async (files) => {
    files ||= await pickProjectFiles()
    const imgs = files.filter((f) => IMAGE_RE.test(f.name) || /^image\//.test(f.type))
    if (imgs.length === files.length) return actions.insertImages(files)
    await app.openFile(files.find((f) => !imgs.includes(f)))
  }

  // ---------- context menu ----------
  app.contextMenu = (x, y, onEl) => {
    const anchor = h('div', { class: 'ss-anchor', style: { left: `${x}px`, top: `${y}px` } })
    document.body.append(anchor)
    const has = store.sel.length > 0
    menu(shell, anchor, onEl && has ? [
      { label: 'Cut', icon: 'scissors', key: `${MOD}+X`, run: () => actions.cut() },
      { label: 'Copy', icon: 'copy', key: `${MOD}+C`, run: () => actions.copy() },
      { label: 'Paste', icon: 'clipboard-paste', key: `${MOD}+V`, disabled: !app.clip, run: () => actions.paste() },
      { label: 'Duplicate', icon: 'copy-plus', key: `${MOD}+D`, run: () => actions.duplicate() },
      '-',
      { label: 'Bring to front', icon: 'bring-to-front', run: () => actions.order('front') },
      { label: 'Send to back', icon: 'send-to-back', run: () => actions.order('back') },
      '-',
      { label: 'Delete', icon: 'trash-2', danger: true, key: 'Del', run: () => actions.deleteSelected() },
    ] : [
      { label: 'Paste', icon: 'clipboard-paste', key: `${MOD}+V`, disabled: !app.clip, run: () => actions.paste() },
      { label: 'Select all', key: `${MOD}+A`, run: () => actions.selectAll() },
      { label: 'New slide', icon: 'plus', key: `${MOD}+M`, run: () => store.addSlide(store.slide?.layout === 'title' ? 'title-content' : store.slide?.layout || 'title-content') },
    ])
    setTimeout(() => anchor.remove(), 0)
  }

  // ---------- build the UI ----------
  const top = buildTopbar(app)
  const ribbon = buildRibbon(app)
  const rail = buildRail(app)
  const sorter = buildSorter(app)
  const insp = buildInspector(app)
  const notes = buildNotes(app)
  const status = buildStatus(app)
  const drop = h('div', { class: 'ss-drop' }, 'Drop a picture, a .pptx or a project file')
  const hiddenZone = h('div', { class: 'dropzone', hidden: true })
  hiddenZone._accept = '.pptx,.ppt,.zip,.json,image/*'
  hiddenZone._take = (files) => app.openFiles([...files])
  const setPane = (p) => { shell.dataset.pane = p; for (const b of mtabs.children) b.setAttribute('aria-selected', String(b.dataset.pane === p)) }
  const mtabs = h('div', { class: 'ss-mtabs', role: 'tablist' },
    ...[['slides', 'Slides', 'layout-template'], ['canvas', 'Edit', 'presentation'], ['format', 'Format', 'palette']].map(([id, label, ic]) =>
      h('button', { type: 'button', class: 'ss-mtab', role: 'tab', dataset: { pane: id }, 'aria-selected': String(id === 'canvas'), onclick: () => setPane(id) }, icon(ic), h('span', label))))
  const phone = matchMedia('(max-width: 820px)')
  app.onDispose(store.on((t) => { if (t === 'slide' && phone.matches && shell.dataset.pane === 'slides') setPane('canvas') }))

  shell.append(top.el, ribbon.el,
    h('div', { class: 'ss-main' }, sorter.el, h('div', { class: 'ss-work' }, rail.el, app.stage.el, notes.el), insp.el),
    mtabs, status.el, drop, hiddenZone)
  const hideTip = mountTips(shell)
  const note = h('p', { class: 'small muted ss-note' }, 'Your slides stay in this browser; nothing is uploaded.')
  root.append(shell, note)
  app.stage.render()
  requestAnimationFrame(() => app.stage.setZoom('fit'))

  // ---------- keyboard ----------
  const typingTarget = (t) => t.closest?.('input, textarea, select, [contenteditable="true"]')
  const nudgeBy = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  // Listen on the document (capture) so shortcuts keep working after a popover closes and focus drops to the page,
  // and so they run before the site's own shortcuts. Only act when focus is inside the editor or on the bare page.
  const mine = (e) => shell.isConnected && (shell.contains(e.target) || e.target === document.body || e.target === document.documentElement) && !document.querySelector('dialog[open]')
  const onKeyDown = (e) => {
    if (app.presenting || e.defaultPrevented || !e.key || !mine(e)) return
    const mod = e.ctrlKey || e.metaKey, k = e.key, lk = k.toLowerCase()
    if (mod && lk === 's') { e.preventDefault(); e.stopPropagation(); app.saveProject(); return }
    if (app.stage.editing) return
    if (typingTarget(e.target)) return
    const global = (mod && (lk === 'z' || lk === 'y')) || k === 'F5'
    // menus, the slide list and busy overlays own their keys; buttons own Enter and Space
    if (!global && e.target.closest?.('.ss-pop, .ss-slist, .ss-busy')) return
    if ((k === 'Enter' || k === ' ') && e.target.closest?.('button, a, [role=tab], [role=menuitem]')) return
    const stop = () => { e.preventDefault(); e.stopPropagation() }
    if (k === 'F5' && shell.contains(e.target)) { stop(); app.presenter.start({ from: e.shiftKey ? 'current' : 'start' }); return }
    if (k === '?') { stop(); shortcutsDialog(); return }
    if (mod && (lk === 'z' || lk === 'y')) { stop(); if (lk === 'y' || e.shiftKey) store.redoStep(); else store.undoStep(); return }
    if (mod && lk === 'c') { if (actions.copy()) { syncClip(); stop() } return }
    if (mod && lk === 'x') { if (store.sel.length) { actions.cut(); syncClip(); stop() } return }
    if (mod && lk === 'v') return // handled by the paste event
    if (mod && lk === 'd') { stop(); actions.duplicate(); return }
    if (mod && lk === 'a') { stop(); actions.selectAll(); return }
    if (mod && lk === 'm') { stop(); store.addSlide(store.slide?.layout === 'title' ? 'title-content' : store.slide?.layout || 'title-content'); return }
    if (mod && (k === ']' || k === '[')) { stop(); actions.order(e.shiftKey ? (k === ']' ? 'front' : 'back') : k === ']' ? 'forward' : 'backward'); return }
    if (mod && (k === '0')) { stop(); app.stage.setZoom('fit'); return }
    if (mod && (k === '=' || k === '+')) { stop(); app.stage.setZoom(app.stage.zoom * 1.2); return }
    if (mod && k === '-') { stop(); app.stage.setZoom(app.stage.zoom / 1.2); return }
    if (mod && ['b', 'i', 'u'].includes(lk) && store.selected.some((x) => x.tx)) { stop(); app.format.toggle(lk); return }
    if (mod) return
    if (k === 'Delete' || k === 'Backspace') { if (actions.deleteSelected()) stop(); return }
    if (nudgeBy[k] && store.sel.length) { stop(); const [dx, dy] = nudgeBy[k]; const s = e.shiftKey ? 10 : 1; actions.nudge(dx * s, dy * s); return }
    if (k === 'Escape') { stop(); if (app.tool !== 'select') app.setTool('select'); else if (store.sel.length) store.select([]); closePopover(); return }
    if ((k === 'Enter' || k === 'F2') && store.selected.length === 1) {
      const el = store.selected[0]
      if (el.tx || el.type === 'table') { stop(); app.stage.startEdit(el.id) } else if (el.type === 'image') { stop(); actions.pickImage(el.id) }
      return
    }
    if (k === 'PageDown') { stop(); store.goto(store.cur + 1); return }
    if (k === 'PageUp') { stop(); store.goto(store.cur - 1); return }
    if (k === 'Tab' && (e.target === shell || e.target === app.stage.el)) {
      const els = store.slide.elements
      if (!els.length) return
      stop()
      const i = els.findIndex((x) => x.id === store.sel[0])
      store.select([els[(i + (e.shiftKey ? els.length - 1 : 1)) % els.length].id])
      return
    }
    // typing with a text box or shape selected starts editing it (like PowerPoint); tool hotkeys only apply otherwise
    if (k.length === 1 && !e.altKey && store.selected.length === 1 && store.selected[0].tx) {
      stop()
      app.stage.startEdit(store.selected[0].id)
      document.execCommand('insertText', false, k)
      return
    }
    const tools = { v: ['select'], t: ['text'], r: ['shape', 'rect'], o: ['shape', 'ellipse'], l: ['line'] }
    if (tools[lk] && !e.altKey) { stop(); app.setTool(...tools[lk]); return }
    if (lk === 'i') { stop(); actions.pickImage() }
  }
  document.addEventListener('keydown', onKeyDown, true)

  // ---------- clipboard ----------
  function syncClip() {
    if (!app.clip) return
    app.clip.synced = false
    navigator.clipboard?.writeText(MARK + Date.now()).then(() => { if (app.clip) { app.clip.synced = true; app.clip.mark = true } }, () => {})
  }
  const onPaste = async (e) => {
    if (app.stage.editing || typingTarget(e.target) || app.presenting || !mine(e)) return
    const cd = e.clipboardData
    const files = [...(cd?.files || [])].filter((f) => /^image\//.test(f.type))
    const text = cd?.getData('text/plain') || ''
    e.preventDefault()
    if (files.length) return actions.insertImages(files)
    if (app.clip && (text.startsWith(MARK) || !text || !app.clip.synced)) return actions.paste()
    if (text.trim()) {
      const t = textEl({ x: 80, y: 90, w: Math.min(640, store.deck.w - 160), h: 60 })
      t.tx.paras = text.split(/\r?\n/).map((l) => ({ runs: [{ t: l }] }))
      t.tx.auto = true
      t.h = Math.max(48, t.tx.paras.length * t.tx.size * 1.2 + 16)
      actions.addElement(t, 'Paste text')
    }
  }
  document.addEventListener('paste', onPaste)

  // ---------- drag and drop ----------
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files')
  let depth = 0
  shell.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; shell.classList.add('dropping') } })
  shell.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; shell.classList.remove('dropping') } })
  shell.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } })
  shell.addEventListener('drop', async (e) => {
    depth = 0
    shell.classList.remove('dropping')
    if (!hasFiles(e)) return
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    const onStage = e.target.closest?.('.ss-stage')
    const at = onStage ? app.stage.toSlide(e) : undefined
    const imgs = files.filter((f) => IMAGE_RE.test(f.name) || /^image\//.test(f.type))
    if (imgs.length === files.length) return actions.insertImages(files, { at })
    await app.openFile(files.find((f) => !imgs.includes(f)))
  })

  // ---------- persistence and cleanup ----------
  const onHide = () => { if (document.hidden) store.save() }
  document.addEventListener('visibilitychange', onHide)
  addEventListener('pagehide', onHide)

  if (params.start === 'outline' && !restored) setTimeout(() => outlineDialog(app), 200)

  return () => {
    hideTip()
    closePopover()
    app.presenter.stop()
    app.stage.dispose()
    document.removeEventListener('visibilitychange', onHide)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('paste', onPaste)
    removeEventListener('pagehide', onHide)
    for (const fn of disposers) { try { fn() } catch (e) { console.error(e) } }
    store.save()
    store.dispose()
  }
}

