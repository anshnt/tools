// Photo Develop: a Lightroom-style photo editor in the browser. Library, non-destructive develop (WebGL), presets and batch export.
// Clean-room take on the same category as the open-source LightCraft by ArtCraft (https://github.com/storytold/lightcraft).
import { h, icon, button, modal, toast, dropzone, onCleanup, errorMessage, download, formatBytes } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import * as lstore from '../../lib/store.js'
import { injectCss } from './_css.js'
import { createApp } from './_app.js'
import { createStage } from './_stage.js'
import { createInspector } from './_panels.js'
import { createSidebar } from './_sidebar.js'
import { createGrid, createFilterBar } from './_library.js'
import { iconBtn, stars } from './_controls.js'
import { openExportDialog } from './_export.js'
import { makeSample, SAMPLE_KINDS } from './_sample.js'
import { createThumbs } from './_thumbs.js'
import { exportCatalog, importCatalog, ACCEPT, clearLibrary } from './_store.js'
import { BUILTIN } from './_presets.js'
import { GROUPS, GROUP_LABELS, LOOK_GROUPS, clone, pick } from './_model.js'

const SHORTCUTS = [
  ['Views', [['G', 'Library grid'], ['D / Enter', 'Open the photo in Develop'], ['Left / Right', 'Previous or next photo'], ['Ctrl+A', 'Select all photos']]],
  ['Rating and flags', [['1 to 5', 'Star rating (0 clears)'], ['P / X / U', 'Pick, reject, unflag']]],
  ['Editing', [['Ctrl+Z', 'Undo'], ['Ctrl+Shift+Z or Ctrl+Y', 'Redo'], ['Ctrl+U', 'Auto tone'], ['Double-click a slider', 'Reset it'], ['C', 'Crop tool (Enter to apply, Esc to cancel)'],
    ['Ctrl+Shift+C or Alt+C', 'Copy settings'], ['Ctrl+Shift+V or Alt+V', 'Paste settings to the selected photos']]],
  ['View', [['\\', 'Before / after'], ['Y', 'Split before / after'], ['J', 'Show clipped highlights and shadows'], ['Z', 'Toggle fit and 100% zoom'], ['Ctrl+0 / Ctrl+1', 'Fit / 100%'],
    ['Ctrl + wheel', 'Zoom at the pointer'], ['Space + drag', 'Pan']]],
  ['Files', [['Ctrl+E', 'Export'], ['Delete', 'Remove selected photos from the library'], ['?', 'This list']]],
]

export async function mount(root, { tool, params = {} }) {
  injectCss()
  const app = createApp()
  const thumbs = createThumbs(app)
  let disposed = false

  // ---------- skeleton ----------
  const zone = dropzone({ accept: ACCEPT, multiple: true, label: 'Drop photos here or click to browse', hint: 'JPG, PNG, WebP, AVIF and HEIC. Photos stay on this device.', onFiles: (f) => importFiles(f), icon: 'images' })
  const busyBar = h('i')
  const busyBox = h('div', { class: 'pd-busybar', hidden: true }, busyBar)
  const busyText = h('div', { class: 'pd-busytext', hidden: true })
  const viewBtns = {
    library: h('button', { type: 'button', 'aria-pressed': 'true', onclick: () => app.setView('library'), 'data-tip': 'Library grid (G)' }, icon('layout-grid'), h('span', 'Library')),
    develop: h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => app.setView('develop'), 'data-tip': 'Develop (D)' }, icon('sliders-horizontal'), h('span', 'Develop')),
  }
  const title = h('div', { class: 'pd-title' })
  const undoBtn = iconBtn({ icon: 'undo-2', tip: 'Undo (Ctrl+Z)', onClick: () => app.undo(), disabled: true })
  const redoBtn = iconBtn({ icon: 'redo-2', tip: 'Redo (Ctrl+Shift+Z)', onClick: () => app.redo(), disabled: true })
  const copyBtn = iconBtn({ icon: 'copy', tip: 'Copy settings (Ctrl+Shift+C)', text: 'Copy', onClick: () => openCopyDialog() })
  const pasteBtn = iconBtn({ icon: 'clipboard-paste', tip: 'Paste settings (Ctrl+Shift+V)', text: 'Paste', onClick: () => pasteSettings(), disabled: true })
  const addBtn = iconBtn({ icon: 'plus', tip: 'Add photos', text: 'Add', onClick: async () => { const f = await pickFiles({ accept: ACCEPT, multiple: true }); if (f.length) importFiles(f) } })
  const exportBtn = iconBtn({ icon: 'download', tip: 'Export photos (Ctrl+E)', text: 'Export', cls: 'primary', onClick: () => doExport() })
  for (const b of [copyBtn, pasteBtn, addBtn, exportBtn]) b.querySelector('span')?.classList.add('lbl')
  const moreBtn = iconBtn({ icon: 'ellipsis', tip: 'More', onClick: () => openMenu(moreBtn) })
  const toolbar = h('div', { class: 'pd-toolbar' },
    h('div', { class: 'pd-brand' }, h('div', { class: 'logo' }, icon('aperture')), h('span', 'Develop')),
    h('div', { class: 'pd-views', role: 'group', 'aria-label': 'View' }, viewBtns.library, viewBtns.develop),
    h('div', { class: 'grow' }, h('span', { class: 'pd-sep pd-hide-s' }), undoBtn, redoBtn, title),
    h('div', { class: 'end' }, copyBtn, pasteBtn, h('span', { class: 'pd-sep pd-hide-s' }), addBtn, exportBtn, moreBtn))

  // library view
  const libGrid = createGrid(app, { mode: 'grid', onOpen: (id) => app.open(id) })
  const filters = createFilterBar(app, libGrid)
  const selLabel = h('span', { class: 'label' })
  const selRating = stars(0, (n) => app.setRating(app.selectedIds(), n), 'md')
  selRating.classList.add('pd-hide-s')
  const selbar = h('div', { class: 'pd-selbar', hidden: true }, selLabel,
    button('Copy settings', { size: 'sm', icon: 'copy', onClick: () => openCopyDialog() }),
    button('Paste', { size: 'sm', icon: 'clipboard-paste', onClick: () => pasteSettings() }),
    selRating,
    iconBtn({ icon: 'flag', tip: 'Pick (P)', onClick: () => app.setFlag(app.selectedIds(), 'pick') }),
    iconBtn({ icon: 'circle-x', tip: 'Reject (X)', onClick: () => app.setFlag(app.selectedIds(), 'reject') }),
    iconBtn({ icon: 'flag-off', tip: 'Clear flag (U)', onClick: () => app.setFlag(app.selectedIds(), '') }),
    h('span', { class: 'grow', style: 'flex:1' }),
    button('Export', { size: 'sm', icon: 'download', onClick: () => doExport() }),
    button('Remove', { size: 'sm', icon: 'trash-2', variant: 'danger', onClick: () => confirmRemove(app.selectedIds()) }))
  const sampleBtns = SAMPLE_KINDS.map((k) => button({ dusk: 'Dusk lake', harbour: 'Harbour', meadow: 'Meadow' }[k], { size: 'sm', icon: 'image-plus', onClick: () => addSamples([k]) }))
  const emptyCard = h('div', { class: 'pd-empty' }, h('div', { class: 'pd-empty-card' },
    h('div', null, h('h3', 'Develop your photos'), h('p', 'Import photos to rate, edit non-destructively and export in batches. Everything runs in your browser.')),
    zone,
    h('div', { class: 'pd-samples' }, h('span', { class: 'muted small' }, 'No photo handy? Try a sample scene:'), ...sampleBtns),
    h('div', { class: 'pd-points' },
      h('div', h('b', 'Real-time edits'), 'Exposure, tone, color, curves, HSL, grading, detail and effects on the GPU.'),
      h('div', h('b', 'Non-destructive'), 'Originals are never changed. Edits are saved with each photo on this device.'),
      h('div', h('b', 'Batch export'), 'Copy settings between photos, then export many to a ZIP at any size.'))))
  const libBody = h('div', { class: 'pd-libbody' }, libGrid.el, emptyCard)
  const libraryView = h('div', { class: 'pd-view pd-library on' }, filters.el, selbar, libBody)

  // develop view
  const stage = createStage(app)
  const inspector = createInspector(app, stage)
  const sidebar = createSidebar(app, stage)
  const film = createGrid(app, { mode: 'strip', onOpen: () => {} })
  film.el.classList.add('pd-film')
  const nameEl = h('div', { class: 'name' })
  const barStars = stars(0, (n) => app.activeId && app.setRating([app.activeId], n), 'md')
  const pickBtn = iconBtn({ icon: 'flag', tip: 'Pick (P)', cls: 'pd-flagbtn pick', pressed: false, onClick: () => toggleFlag('pick') })
  const rejectBtn = iconBtn({ icon: 'circle-x', tip: 'Reject (X)', cls: 'pd-flagbtn reject', pressed: false, onClick: () => toggleFlag('reject') })
  const zoomLabel = h('span', { class: 'pd-zoomlabel' }, '')
  const bar = h('div', { class: 'pd-bar' }, barStars, pickBtn, rejectBtn, nameEl,
    iconBtn({ icon: 'minimize', tip: 'Fit to screen (Ctrl+0)', onClick: () => stage.fit() }),
    iconBtn({ icon: 'scan', tip: 'Zoom to 100% (Ctrl+1)', onClick: () => stage.zoom100() }),
    iconBtn({ icon: 'zoom-out', tip: 'Zoom out (Ctrl+-)', onClick: () => stage.zoomBy(1 / 1.25) }),
    iconBtn({ icon: 'zoom-in', tip: 'Zoom in (Ctrl++)', onClick: () => stage.zoomBy(1.25) }), zoomLabel)
  const cropDone = button('Done', { size: 'sm', variant: 'primary', icon: 'check', onClick: () => finishCrop(true) })
  const cropCancel = button('Cancel', { size: 'sm', onClick: () => finishCrop(false) })
  const cropbar = h('div', { class: 'pd-cropbar', hidden: true }, h('span', { class: 'small muted' }, 'Drag the corners to crop'), cropCancel, cropDone)
  stage.el.append(cropbar)
  const center = h('div', { class: 'pd-center' }, stage.el, bar, film.el)

  const compareBtn = iconBtn({ icon: 'columns-2', tip: 'Before / after split (Y)', pressed: false, onClick: () => app.toggleCompare('split') })
  const beforeBtn = iconBtn({ icon: 'eye', tip: 'Before only (\\)', pressed: false, onClick: () => app.toggleCompare('before') })
  const clipBtn = iconBtn({ icon: 'zap', tip: 'Clipping warning (J)', pressed: false, onClick: () => app.setClip(!app.clip) })
  const cropBtn = iconBtn({ icon: 'crop', tip: 'Crop and straighten (C)', pressed: false, onClick: () => app.setCropMode(!app.cropMode) })
  const leftBtn = iconBtn({ icon: 'panel-left', tip: 'Presets and history', pressed: true, cls: 'pd-hide-s', onClick: () => { const on = develop.dataset.left !== '1'; develop.dataset.left = on ? '1' : '0'; leftBtn.setPressed(on); stage.layout(); if (on) sidebar.refresh() } })
  const rail = h('div', { class: 'pd-rail' },
    cropBtn, h('span', { class: 'pd-sep' }), compareBtn, beforeBtn, clipBtn, h('span', { class: 'pd-sep' }),
    iconBtn({ icon: 'wand-sparkles', tip: 'Auto tone (Ctrl+U)', onClick: () => inspector && app.autoTone?.() }),
    iconBtn({ icon: 'rotate-ccw', tip: 'Reset all edits', onClick: () => app.activeId && app.resetAll() }), h('span', { class: 'pd-sep pd-hide-s' }), leftBtn)
  const inspectorWrap = h('div', { class: 'pd-inspector-wrap' }, inspector.el)
  const tabs = h('div', { class: 'pd-tabs', role: 'tablist' },
    ...[['presets', 'Presets', 'wand-sparkles'], ['edit', 'Edit', 'sliders-horizontal']].map(([k, l, ic]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === 'edit'), dataset: { tab: k }, onclick: () => setTab(k) }, icon(ic), l)))
  const develop = h('div', { class: 'pd-view pd-develop', dataset: { left: window.innerWidth > 1180 ? '1' : '0', tab: 'edit' } }, rail, sidebar.el, center, inspectorWrap, tabs)
  const setTab = (k) => { develop.dataset.tab = k; tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === k))); if (k === 'presets') sidebar.refresh() }
  if (window.innerWidth <= 1180) leftBtn.setPressed(false)

  const pd = h('div', { class: 'pd', role: 'region', 'aria-label': 'Photo Develop' }, toolbar, busyBox, busyText, h('div', { class: 'pd-main' }, libraryView, develop),
    h('div', { class: 'small muted', style: 'padding:6px 12px;border-top:1px solid var(--border)' },
      'Prefer a native app? ', h('a', { class: 'link', href: 'https://github.com/storytold/lightcraft', target: '_blank', rel: 'noopener' }, 'LightCraft by ArtCraft'), ' is free and open source.'))
  root.append(pd)

  // ---------- actions ----------
  async function importFiles(files) {
    const had = app.order.length
    const ids = await app.import(files)
    if (!ids.length) return
    navigator.storage?.persist?.().catch(() => {}) // ask the browser not to evict the library under storage pressure
    if (params.look) { const p = BUILTIN.find((x) => x.id === params.look); if (p) app.applyPreset(p.s, `Preset: ${p.name}`, ids, true) }
    if (ids.length === 1 && !had) app.open(ids[0])
    else if (ids.length === 1) app.select(ids[0])
  }
  async function addSamples(kinds) {
    const files = await Promise.all(kinds.map((k) => makeSample(k)))
    await importFiles(files)
  }
  function toggleFlag(f) {
    const m = app.active()
    if (m) app.setFlag(app.selectedIds(), m.flag === f ? '' : f)
  }
  function confirmRemove(ids) {
    if (!ids.length) return
    const m = modal({
      title: `Remove ${ids.length} photo${ids.length > 1 ? 's' : ''}?`, icon: 'trash-2',
      body: h('p', 'They will be removed from this library along with their edits. Your original files on disk are not touched.'),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Remove', { variant: 'danger', icon: 'trash-2', onClick: async () => { m.close(); await app.remove(ids); toast('Removed', 'success') } })],
    })
  }
  function openCopyDialog() {
    if (!app.activeId) return toast('Open or select a photo first.')
    const have = app.clipboard?.groups || LOOK_GROUPS
    const checks = Object.keys(GROUPS).map((g) => {
      const cb = h('input', { type: 'checkbox', checked: have.includes(g), id: `pdc-${g}` })
      return { g, cb, el: h('label', { class: 'pd-check', for: `pdc-${g}` }, cb, h('span', GROUP_LABELS[g])) }
    })
    const m = modal({
      title: 'Copy settings', icon: 'copy',
      body: h('div', { class: 'stack' }, h('p', { class: 'muted small' }, `From ${app.active().name}. Paste them onto any selected photos.`), h('div', { class: 'pd-checks' }, checks.map((c) => c.el))),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Copy', { variant: 'primary', icon: 'copy', onClick: () => {
        const groups = checks.filter((c) => c.cb.checked).map((c) => c.g)
        if (!groups.length) return toast('Choose at least one group.', 'error')
        app.copy(groups); m.close(); toast('Settings copied. Select photos and paste.', 'success')
      } })],
    })
  }
  function pasteSettings() {
    if (!app.clipboard) return toast('Copy settings from a photo first.')
    const ids = app.selectedIds().filter((id) => id !== undefined)
    const n = app.paste(ids)
    toast(n ? `Pasted settings to ${n} photo${n > 1 ? 's' : ''}` : 'Nothing to paste to', n ? 'success' : 'info')
  }
  function doExport() {
    const sel = app.selectedIds()
    const picks = app.order.filter((id) => app.get(id)?.flag === 'pick')
    openExportDialog(app, [
      { id: 'sel', label: sel.length > 1 ? 'Selected photos' : 'This photo', ids: sel },
      { id: 'vis', label: 'Photos shown in the library', ids: app.visible() },
      { id: 'pick', label: 'Picked photos', ids: picks },
      { id: 'all', label: 'All photos', ids: [...app.order] },
    ])
  }
  function finishCrop(apply) {
    if (!apply && cropSnap) app.update('Cancel crop', (s) => ({ ...s, ...clone(pick(cropSnap, ['geometry'])) }), { coalesce: false })
    app.setCropMode(false)
  }
  let cropSnap = null

  // ---------- popover menu ----------
  let menuEl = null
  const closeMenu = () => { menuEl?.remove(); menuEl = null }
  function openMenu(anchor) {
    if (menuEl) return closeMenu()
    const item = (ic, label, fn, kbd, cls) => h('button', { type: 'button', role: 'menuitem', class: cls, onclick: () => { closeMenu(); fn() } }, icon(ic), h('span', label), kbd && h('kbd', kbd))
    const usage = h('div', { class: 'small muted', style: 'padding:6px 10px' }, `${app.order.length} photo${app.order.length === 1 ? '' : 's'} in this library`)
    navigator.storage?.estimate?.().then((e) => { if (e?.usage) usage.textContent = `${app.order.length} photo${app.order.length === 1 ? '' : 's'}, ${formatBytes(e.usage)} stored on this device` }).catch(() => {})
    menuEl = h('div', { class: 'pd-menu', role: 'menu' },
      usage, h('hr'),
      item('plus', 'Add photos...', () => addBtn.click()),
      item('image-plus', 'Add a sample photo', () => addSamples([SAMPLE_KINDS[Math.floor(Math.random() * SAMPLE_KINDS.length)]])),
      item('check-check', 'Select all photos', () => app.selectAll(), 'Ctrl+A'),
      h('hr'),
      item('archive', 'Back up library (ZIP)', backup),
      item('archive-restore', 'Restore from backup...', restore),
      h('hr'),
      item('keyboard', 'Keyboard shortcuts', showShortcuts, '?'),
      h('hr'),
      item('trash-2', 'Remove selected photos', () => confirmRemove(app.selectedIds()), 'Del', 'danger'),
      item('trash', 'Clear the whole library...', clearAll, '', 'danger'))
    const r = anchor.getBoundingClientRect(), pr = pd.getBoundingClientRect()
    menuEl.style.top = `${r.bottom - pr.top + 6}px`
    menuEl.style.right = `${pr.right - r.right}px`
    pd.append(menuEl)
    menuEl.querySelector('button')?.focus()
    setTimeout(() => document.addEventListener('pointerdown', outside, true))
  }
  function outside(e) {
    if (menuEl && !menuEl.contains(e.target)) { closeMenu() }
    document.removeEventListener('pointerdown', outside, true)
  }
  async function backup() {
    if (!app.order.length) return toast('The library is empty.')
    app.busy = { label: 'Backing up', fraction: 0 }; app.emit('busy', app.busy)
    try {
      const blob = await exportCatalog(app.order.map((id) => app.get(id)), app.presets, (f) => { app.busy = { label: 'Backing up', fraction: f }; app.emit('busy', app.busy) })
      download(blob, `photo-develop-library-${new Date().toLocaleDateString('sv')}.zip`)
      toast('Backup saved', 'success')
    } catch (e) { toast(errorMessage(e), 'error') } finally { app.busy = null; app.emit('busy', null) }
  }
  async function restore() {
    const [f] = await pickFiles({ accept: '.zip,application/zip' })
    if (!f) return
    app.busy = { label: 'Restoring', fraction: 0 }; app.emit('busy', app.busy)
    try {
      const r = await importCatalog(f, new Set(app.order), (p) => { app.busy = { label: 'Restoring', fraction: p }; app.emit('busy', app.busy) })
      await app.adopt(r.added, r.presets)
      toast(`Restored ${r.added.length} photo${r.added.length === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} already in the library` : ''}`, 'success')
    } catch (e) { toast(errorMessage(e), 'error') } finally { app.busy = null; app.emit('busy', null) }
  }
  function clearAll() {
    if (!app.order.length) return
    const m = modal({
      title: 'Clear the library?', icon: 'trash',
      body: h('p', `This removes all ${app.order.length} photos and their edits from this device. Back up first if you may need them. Your original files on disk are not touched.`),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Clear library', { variant: 'danger', onClick: async () => { m.close(); const ids = [...app.order]; await app.remove(ids); await clearLibrary([]); toast('Library cleared') } })],
    })
  }
  function showShortcuts() {
    modal({
      title: 'Keyboard shortcuts', icon: 'keyboard',
      body: h('div', { class: 'stack' }, SHORTCUTS.map(([g, rows]) => h('div', null, h('div', { class: 'pd-sub' }, h('span', g)),
        h('dl', { class: 'pd-info', style: 'margin-top:6px' }, rows.flatMap(([k, d]) => [h('dt', { style: 'font-family:var(--mono)' }, k), h('dd', d)]))))),
    })
  }

  const phone = matchMedia('(max-width: 900px)')
  const onPhone = () => syncMeta()
  phone.addEventListener('change', onPhone)

  // ---------- view and state sync ----------
  const syncView = () => {
    const dev = app.view === 'develop'
    libraryView.classList.toggle('on', !dev)
    develop.classList.toggle('on', dev)
    viewBtns.library.setAttribute('aria-pressed', String(!dev))
    viewBtns.develop.setAttribute('aria-pressed', String(dev))
    viewBtns.develop.disabled = !app.activeId
    if (dev) { stage.layout(); film.update(); setTimeout(() => film.scrollToActive(), 0) } else libGrid.update()
    syncMeta()
  }
  function syncMeta() {
    const m = app.active()
    const n = app.order.length
    emptyCard.hidden = n > 0
    libGrid.el.hidden = n === 0
    filters.el.hidden = n === 0
    zone.classList.toggle('compact', n > 0)
    if (n > 0 && zone.parentElement !== libraryView) libraryView.insertBefore(zone, filters.el)
    if (n === 0 && zone.parentElement !== emptyCard.firstChild) emptyCard.firstChild.insertBefore(zone, emptyCard.firstChild.children[1] || null)
    title.textContent = app.view === 'develop' && m ? m.name : ''
    nameEl.textContent = m ? m.name : ''
    barStars.set(m?.rating || 0)
    pickBtn.setPressed(m?.flag === 'pick'); rejectBtn.setPressed(m?.flag === 'reject')
    const sel = app.selection.size
    selbar.hidden = !(n > 0 && sel > (phone.matches ? 1 : 0))
    selLabel.textContent = `${sel} selected`
    selRating.set(sel === 1 && m ? m.rating : 0)
    viewBtns.develop.disabled = !app.activeId
    undoBtn.disabled = !app.canUndo(); redoBtn.disabled = !app.canRedo()
    pasteBtn.disabled = !app.clipboard
    pasteBtn.setAttribute('data-tip', app.clipboard ? `Paste settings from ${app.clipboard.from} (Ctrl+Shift+V)` : 'Paste settings (Ctrl+Shift+V)')
    exportBtn.disabled = n === 0
    copyBtn.disabled = !m
  }
  const offs = [
    app.on('view', syncView), app.on('library', syncMeta), app.on('selection', syncMeta), app.on('meta', syncMeta), app.on('active', syncMeta),
    app.on('history', syncMeta), app.on('edit', syncMeta), app.on('clipboard', syncMeta),
    app.on('edit', (e) => thumbs.queue([e.id])),
    app.on('library', (e) => { if (e?.added?.length) thumbs.queue(e.added.filter((id) => app.isEdited(id)), 400) }),
    app.on('compare', (m) => { compareBtn.setPressed(m === 'split'); beforeBtn.setPressed(m === 'before') }),
    app.on('clip', (on) => clipBtn.setPressed(on)),
    app.on('crop', (on) => {
      cropBtn.setPressed(on); cropbar.hidden = !on
      if (on) { cropSnap = clone(app.settings()); app.setCompare('off') }
      compareBtn.disabled = beforeBtn.disabled = on
    }),
    app.on('zoom', ({ pct }) => { zoomLabel.textContent = `${pct}%` }),
    app.on('busy', (b) => {
      busyBox.hidden = busyText.hidden = !b
      if (b) { busyBar.style.width = `${Math.round((b.fraction || 0) * 100)}%`; busyText.textContent = b.label }
    }),
  ]

  // ---------- keyboard ----------
  const onKey = (e) => {
    if (disposed || !pd.isConnected) return
    if (document.querySelector('dialog[open]')) return
    const t = e.target
    const typing = t.closest?.('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]:not([contenteditable="false"])')
    if (e.key === 'Escape' && menuEl) { closeMenu(); return }
    if (typing) { if (e.key === 'Escape') t.blur?.(); return }
    const k = e.key, ctrl = e.ctrlKey || e.metaKey
    const dev = app.view === 'develop'
    const inRange = t.matches?.('input[type=range]')
    if (ctrl && !e.shiftKey && !e.altKey && k.toLowerCase() === 'z') { e.preventDefault(); app.undo(); return }
    if (ctrl && ((e.shiftKey && k.toLowerCase() === 'z') || k.toLowerCase() === 'y')) { e.preventDefault(); app.redo(); return }
    if ((ctrl && e.shiftKey && k.toLowerCase() === 'c') || (e.altKey && !ctrl && k.toLowerCase() === 'c')) { e.preventDefault(); if (app.copy(app.clipboard?.groups || LOOK_GROUPS)) toast('Settings copied', 'success'); return }
    if ((ctrl && e.shiftKey && k.toLowerCase() === 'v') || (e.altKey && !ctrl && k.toLowerCase() === 'v')) { e.preventDefault(); pasteSettings(); return }
    if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); doExport(); return }
    if (ctrl && k.toLowerCase() === 'a' && !dev) { e.preventDefault(); app.selectAll(); return }
    if (ctrl && k.toLowerCase() === 'u' && dev) { e.preventDefault(); app.autoTone?.(); return }
    if (ctrl && dev && (k === '0')) { e.preventDefault(); stage.fit(); return }
    if (ctrl && dev && (k === '1')) { e.preventDefault(); stage.zoom100(); return }
    if (ctrl && dev && (k === '+' || k === '=')) { e.preventDefault(); stage.zoomBy(1.25); return }
    if (ctrl && dev && (k === '-')) { e.preventDefault(); stage.zoomBy(1 / 1.25); return }
    if (ctrl || e.altKey) return
    if (app.cropMode) {
      if (k === 'Enter') { e.preventDefault(); finishCrop(true) } else if (k === 'Escape') { e.preventDefault(); finishCrop(false) } else if (k.toLowerCase() === 'c') finishCrop(true)
      return
    }
    switch (k) {
      case 'g': case 'G': app.setView('library'); break
      case 'd': case 'D': app.setView('develop'); break
      case 'Enter': if (!dev && app.activeId && !t.closest?.('button')) app.setView('develop'); break
      case 'ArrowLeft': if (dev && !inRange) { e.preventDefault(); app.step(-1) } break
      case 'ArrowRight': if (dev && !inRange) { e.preventDefault(); app.step(1) } break
      case '0': case '1': case '2': case '3': case '4': case '5': if (app.activeId) app.setRating(app.selectedIds(), Number(k)); break
      case 'p': case 'P': if (app.activeId) app.setFlag(app.selectedIds(), 'pick'); break
      case 'x': case 'X': if (app.activeId) app.setFlag(app.selectedIds(), 'reject'); break
      case 'u': case 'U': if (app.activeId) app.setFlag(app.selectedIds(), ''); break
      case 'c': case 'C': if (dev) app.setCropMode(true); break
      case '\\': if (dev) { e.preventDefault(); app.toggleCompare('before') } break
      case 'y': case 'Y': if (dev) app.toggleCompare('split'); break
      case 'j': case 'J': if (dev) app.setClip(!app.clip); break
      case 'z': case 'Z': if (dev) stage.toggleZoom(); break
      case 'Delete': case 'Backspace': if (app.activeId && !dev) confirmRemove(app.selectedIds()); break
      case '?': showShortcuts(); break
      default: return
    }
  }
  document.addEventListener('keydown', onKey)

  // ---------- start ----------
  await app.load()
  if (disposed) return () => {}
  const last = lstore.load('pdev:last', {})
  app.activeId = app.photos.has(last.id) ? last.id : app.order[0] || null
  if (app.activeId) { app.selection = new Set([app.activeId]); app.anchor = app.activeId; app.emit('active', app.activeId) } // panels were built before the library loaded, so tell them which photo is active
  libGrid.update(); filters.update()
  thumbs.backfill()
  syncView()
  if ((params.view || last.view) === 'develop' && app.activeId) app.setView('develop')
  const remember = () => lstore.save('pdev:last', { id: app.activeId, view: app.view })
  offs.push(app.on('view', remember), app.on('active', remember))
  if (params.section) inspector.openSection(params.section)
  if (params.start === 'batch') toast('Add photos, edit one, copy its settings and paste them onto the rest, then Export.', 'info', 7000)
  const dz = new ResizeObserver(() => { pd.style.setProperty('--tb', `${toolbar.offsetHeight}px`); stage.layout() }) // the phone layout pins the toolbar, so the rows below need its real height
  dz.observe(pd); dz.observe(toolbar)

  // ---------- cleanup ----------
  const cleanup = () => {
    if (disposed) return
    disposed = true
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('pointerdown', outside, true)
    phone.removeEventListener('change', onPhone)
    dz.disconnect()
    offs.forEach((o) => o())
    closeMenu()
    stage.dispose(); sidebar.dispose(); libGrid.dispose(); film.dispose(); filters.dispose(); thumbs.dispose()
    app.dispose()
  }
  onCleanup(cleanup)
  return cleanup
}
