// Draw Studio bars: toolbox, standard bar, property bar, page tabs and status bar. All text goes through textContent (never innerHTML).
import { h, icon } from '../../lib/ui.js'
import { describeNode } from './_ds-doc.js'
import { fmt } from './_ds-units.js'
import { zoomPercent } from './_ds-view.js'
import { commandById } from './_ds-keys.js'
import { selectionStyle } from './_ds-sel.js'
import { movePage, renamePage } from './_ds-ops.js'
import { safeHex } from './_ds-ui-palette.js'

const tip = (label, keys) => (keys?.length ? `${label} (${keys[0]})` : label)

/** Icon button wired to a command: refreshes its disabled state through refresh(). */
function cmdButton(commands, id, { label, text, focusBack } = {}) {
  const c = commandById(id)
  const btn = h('button', { type: 'button', class: 'ds-btn', 'aria-label': label || c.label.replace('...', ''), title: tip(label || c.label.replace('...', ''), c.keys), onclick: (e) => { commands.run(id); if (e.detail > 0) focusBack?.() } }, // a mouse click leaves the keyboard on the canvas (a disabled button would drop focus to the page)
    icon(c.icon), text ? h('span', { class: 'ds-btn-t' }, text) : null)
  btn.refresh = () => { const on = commands.enabled(id); btn.disabled = !on }
  return btn
}

export function createToolbox({ store, tools }) {
  const el = h('div', { class: 'ds-tools', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' })
  const btns = tools.list.map((t) => {
    const b = h('button', { type: 'button', class: 'ds-tool', 'aria-label': t.label, title: `${tip(t.label, t.keys)}. ${t.tip || ''}`.trim(), 'aria-pressed': 'false', 'data-tool': t.id, onclick: () => tools.set(t.id) }, icon(t.icon))
    return b
  })
  el.append(...btns)
  const refresh = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === store.tool)))
  el.addEventListener('keydown', (e) => { // arrows move between tools (roving focus)
    const i = btns.indexOf(document.activeElement)
    const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    if (i < 0 || !d) return
    e.preventDefault(); e.stopPropagation()
    btns[(i + d + btns.length) % btns.length].focus()
  })
  refresh()
  return { el, refresh }
}

export function createStandardBar({ commands, store, app, focusBack }) {
  const zoomBtn = h('button', { type: 'button', class: 'ds-btn ds-zoomval', 'aria-label': 'Zoom level, click to fit the page', title: 'Zoom (click to fit the page)', onclick: () => commands.run('view.zoomPage') }, '100%')
  const bs = ['file.new', 'file.open', 'file.save'].map((id) => cmdButton(commands, id, { focusBack }))
  const undo = cmdButton(commands, 'edit.undo', { focusBack }), redo = cmdButton(commands, 'edit.redo', { focusBack })
  const zo = cmdButton(commands, 'view.zoomOut', { label: 'Zoom out', focusBack }), zi = cmdButton(commands, 'view.zoomIn', { label: 'Zoom in', focusBack })
  const fit = cmdButton(commands, 'view.zoomPage', { label: 'Zoom to page', focusBack })
  const fs = cmdButton(commands, 'view.fullscreen', { label: 'Full screen', focusBack })
  const dockBtn = cmdButton(commands, 'win.objects', { label: 'Show or hide the Objects docker', focusBack })
  dockBtn.classList.add('ds-dockbtn')
  const sep = () => h('span', { class: 'ds-sep', role: 'separator' })
  const all = [...bs, undo, redo, zo, zi, fit, fs, dockBtn]
  const name = h('span', { class: 'ds-docname', title: '' }, 'Untitled')
  // snap chips: guides, objects, page and grid each switch on their own (Alt+Z switches all snapping off and on)
  const SNAP = [['view.snapGuides', 'Guides'], ['view.snapObjects', 'Objects'], ['view.snapPage', 'Page'], ['view.snapGrid', 'Grid']]
  const chips = SNAP.map(([id, label]) => h('button', { type: 'button', class: 'ds-schip', 'data-cmd': id, 'aria-pressed': 'false', title: `Snap to ${label.toLowerCase()}`, 'aria-label': `Snap to ${label.toLowerCase()}`, onclick: (e) => { commands.run(id); if (e.detail > 0) focusBack?.() } }, label))
  const snapBox = h('span', { class: 'ds-snapchips', role: 'group', 'aria-label': 'Snap to' }, icon('magnet'), ...chips)
  const el = h('div', { class: 'ds-std', role: 'toolbar', 'aria-label': 'Standard' }, ...bs, sep(), undo, redo, sep(), zo, zoomBtn, zi, fit, sep(), snapBox, h('span', { class: 'ds-grow' }), name, dockBtn, fs)
  const refresh = () => {
    all.forEach((b) => b.refresh())
    undo.title = tip(commands.label('edit.undo'), commandById('edit.undo').keys)
    redo.title = tip(commands.label('edit.redo'), commandById('edit.redo').keys)
    zoomBtn.textContent = `${zoomPercent(store.view.z)}%`
    for (const c of chips) c.setAttribute('aria-pressed', String(commands.checked(c.dataset.cmd)))
    snapBox.classList.toggle('ds-snap-off', store.prefs.snap === false)
    dockBtn.setAttribute('aria-pressed', String(commands.checked('win.objects')))
    name.textContent = store.root.title + (store.dirty ? ' *' : '')
    name.title = store.root.meta?.name || ''
  }
  return { el, refresh }
}

/**
 * Page tabs: click to switch, double-click to rename, drag a tab to reorder, plus buttons to add, delete and move the current page.
 * env: {store, app (run, enabled, gotoPage)}. -> {el, refresh, rename(index)}
 */
export function createPageTabs({ store, app }) {
  const strip = h('div', { class: 'ds-tabstrip', role: 'tablist', 'aria-label': 'Pages' })
  const mk = (id, ic, label) => { const b = h('button', { type: 'button', class: 'ds-btn', 'aria-label': label, title: label, onclick: () => app.run(id) }, icon(ic)); b.refresh = () => { b.disabled = !app.enabled(id) }; return b }
  const prev = mk('page.prev', 'chevron-left', 'Previous page'), next = mk('page.next', 'chevron-right', 'Next page')
  const add = mk('page.insertAfter', 'plus', 'Add a page after this one'), del = mk('page.delete', 'trash-2', 'Delete this page')
  const left = mk('page.moveLeft', 'arrow-left-to-line', 'Move this page left'), right = mk('page.moveRight', 'arrow-right-to-line', 'Move this page right')
  const el = h('div', { class: 'ds-pages' }, prev, strip, next, h('span', { class: 'ds-sep', role: 'separator' }), add, left, right, del)
  let key = '', renaming = false, dragId = null
  const tabFor = (p, i) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'ds-tab', 'data-page': String(p.id), draggable: p.pending ? 'false' : 'true', onclick: () => app.gotoPage(i), ondblclick: () => rename(i) },
      p.pending ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, h('span', { class: 'ds-tab-name' }, p.name))
    if (p.pending) b.title = 'Still being read'
    b.addEventListener('dragstart', (e) => { dragId = p.id; e.dataTransfer?.setData('text/plain', `ds-page:${p.id}`); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move' })
    b.addEventListener('dragend', () => { dragId = null; for (const t of strip.children) t.classList.remove('ds-drop-before', 'ds-drop-after') })
    b.addEventListener('dragover', (e) => {
      if (dragId == null || dragId === p.id) return
      e.preventDefault()
      const r = b.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2
      b.classList.toggle('ds-drop-before', !after); b.classList.toggle('ds-drop-after', after)
    })
    b.addEventListener('dragleave', () => b.classList.remove('ds-drop-before', 'ds-drop-after'))
    b.addEventListener('drop', (e) => {
      if (dragId == null || dragId === p.id) return
      e.preventDefault()
      const r = b.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2
      const from = store.root.pages.findIndex((x) => x.id === dragId)
      let to = i + (after ? 1 : 0)
      if (from < to) to--
      const id = dragId
      dragId = null
      for (const t of strip.children) t.classList.remove('ds-drop-before', 'ds-drop-after')
      if (from >= 0 && to !== from) store.tx('Move page', (r2) => movePage(r2, id, to))
    })
    return b
  }
  /** Swap the tab label for a text field; Enter or leaving the field keeps the name, Esc keeps the old one. */
  function rename(i) {
    const p = store.root.pages[i]
    const tab = strip.children[i]
    if (!p || !tab || renaming) return
    if (p.pending) { store.setStatus('This page is still being read. Try again in a moment.'); return }
    renaming = true
    const label = tab.querySelector('.ds-tab-name')
    const input = h('input', { type: 'text', class: 'input ds-tab-input', 'aria-label': 'Page name', maxlength: 200, value: p.name })
    label.replaceWith(input)
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      renaming = false
      const v = input.value
      if (ok && v.trim()) store.tx('Rename page', (r) => renamePage(r, p.id, v))
      key = ''
      refresh()
      strip.children[store.root.pages.findIndex((x) => x.id === p.id)]?.focus()
    }
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') { e.preventDefault(); finish(false) } })
    input.addEventListener('blur', () => finish(true))
    input.addEventListener('click', (e) => e.stopPropagation())
    input.addEventListener('dblclick', (e) => e.stopPropagation())
    input.focus(); input.select()
  }
  const refresh = () => {
    const pages = store.root.pages
    const k = pages.map((p) => `${p.id}:${p.name}:${p.pending ? 1 : 0}`).join('|')
    if (k !== key && !renaming) { // the page list changed: rebuild, and keep focus on the tab strip when it was there
      const had = strip.contains(document.activeElement)
      key = k
      strip.replaceChildren(...pages.map(tabFor))
      if (had) strip.children[store.pageIndex]?.focus()
    }
    [...strip.children].forEach((b, i) => { const on = i === store.pageIndex; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1 })
    strip.children[store.pageIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    for (const b of [prev, next, add, del, left, right]) b.refresh()
  }
  strip.addEventListener('keydown', (e) => {
    const tabs = [...strip.children]
    const i = tabs.indexOf(document.activeElement)
    if (i < 0) return
    if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); rename(i); return }
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
    if (!d) return
    e.preventDefault(); e.stopPropagation()
    const j = Math.max(0, Math.min(tabs.length - 1, i + d))
    tabs[j].focus()
  })
  return { el, refresh, rename }
}

export function createStatusBar({ store, view, app }) {
  const msg = h('span', { class: 'ds-st-msg', 'aria-hidden': 'true' })
  const live = h('span', { class: 'ds-sr', 'aria-live': 'polite', role: 'status' })
  const notes = h('button', { type: 'button', class: 'ds-st-notes', hidden: true, onclick: () => app.run('file.notes') })
  const pos = h('span', { class: 'ds-st-pos' })
  const zoom = h('span', { class: 'ds-st-zoom' })
  // fill and outline swatches of the selection: double-click (or Enter, or a tap) opens the colour dialog
  const mkSw = (kind, word) => h('button', { type: 'button', class: 'ds-st-sw', 'data-kind': kind, 'aria-label': `${word} colour of the selection. Double-click to change`, title: `${word} (double-click to change)`,
    ondblclick: () => app.run(kind === 'fill' ? 'effects.fillColor' : 'effects.outlineColor'),
    onclick: (e) => { if (e.detail === 0 || e.pointerType === 'touch') app.run(kind === 'fill' ? 'effects.fillColor' : 'effects.outlineColor') } })
  const fillSw = mkSw('fill', 'Fill'), strokeSw = mkSw('stroke', 'Outline')
  const width = h('span', { class: 'ds-st-w' })
  const paintSw = h('span', { class: 'ds-st-paint' }, fillSw, strokeSw, width)
  const el = h('div', { class: 'ds-status' }, msg, live, h('span', { class: 'ds-grow' }), notes, paintSw, pos, zoom)
  const showPaint = (b, p) => {
    b.className = 'ds-st-sw'; b.style.background = ''
    if (!p || p.kind === 'empty') { b.classList.add('empty'); return }
    if (p.kind === 'none') b.classList.add('none')
    else if (p.kind === 'mixed') b.classList.add('mixed')
    else if (p.kind === 'gradient') { const c = p.stops.map(safeHex).filter(Boolean); if (c.length > 1) b.style.background = `linear-gradient(90deg, ${c.join(', ')})`; else b.classList.add('mixed') }
    else if (safeHex(p.hex)) b.style.background = p.hex
  }
  let transient = ''
  const selText = () => {
    const ids = store.sel.ids
    if (!ids.length) return store.ctx != null ? `Inside ${store.find(store.ctx)?.node?.name || 'group'}` : 'Nothing selected'
    if (ids.length > 1) return `${ids.length} objects selected`
    const f = store.find(ids[0])
    if (!f?.node) return ''
    const crumb = store.ctx != null && store.ctx !== ids[0] ? `${store.find(store.ctx)?.node?.name || 'Group'} > ` : ''
    return `${crumb}${describeNode(f.node)} on ${f.layer.name}`
  }
  const refresh = () => {
    const t = transient || selText()
    if (msg.textContent !== t) { msg.textContent = t; live.textContent = t }
    zoom.textContent = `${zoomPercent(store.view.z)}%`
    const st = selectionStyle(store)
    paintSw.hidden = !st
    if (st) { showPaint(fillSw, st.fill); showPaint(strokeSw, st.stroke); width.textContent = st.width != null ? `${fmt(st.width, store.root.units)} ${store.root.units}` : '' }
    const n = store.root.warnings.length
    notes.hidden = !n
    notes.textContent = `${n} note${n === 1 ? '' : 's'}`
  }
  const cursor = (p) => {
    const page = store.page(), u = store.root.units
    if (!page || !p) { pos.textContent = ''; return }
    pos.textContent = `X ${fmt(p.x, u)}  Y ${fmt(page.h - p.y, u)} ${u}`
  }
  /** Show a message until the next selection change (empty text clears it). */
  const say = (t) => { transient = t || ''; refresh() }
  return { el, refresh, cursor, say, clearTransient: () => say('') }
}
