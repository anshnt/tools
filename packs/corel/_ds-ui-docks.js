// Draw Studio dockers (right side on desktop, a bottom sheet on phones). This file holds the dock shell and the Objects docker: a tree of
// pages > layers > objects with select, rename, hide, lock, reorder (buttons and drag), new and delete layer, move to layer.
// Later milestones add sections (Properties, Align and distribute, Transform) with dock.addSection({id, title, el, refresh}).
// Names always go through textContent. Long lists show 120 rows and a "Show more" row instead of rendering everything.
import { h, icon } from '../../lib/ui.js'
import { describeNode } from './_ds-doc.js'
import { deleteLayer, moveLayer, moveNodes, renameLayer, renameNode, renamePage, setFlag, setLayerFlag } from './_ds-ops.js'
import { topIds } from './_ds-sel.js'

const SHOW = 120
const PHONE = '(max-width: 860px)'

/** Scroll el into view inside its scrolling parents up to the app root, never the page itself (scrollIntoView also moves the window, which jumps the whole page on a phone). */
export function scrollInside(el) {
  const stop = el.closest?.('.t-ds')
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p)
    const y = /auto|scroll/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1, x = /auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1
    if (y || x) {
      const r = el.getBoundingClientRect(), b = p.getBoundingClientRect()
      if (y) { if (r.top < b.top) p.scrollTop -= b.top - r.top; else if (r.bottom > b.bottom) p.scrollTop += r.bottom - b.bottom }
      if (x) { if (r.left < b.left) p.scrollLeft -= b.left - r.left; else if (r.right > b.right) p.scrollLeft += r.right - b.right }
    }
    if (p === stop) break
  }
}

const nodeIcon = (n) => (n.t === 'group' ? 'group' : n.t === 'image' ? 'image' : n.t === 'text' ? 'type' : n.shape?.k === 'rect' ? 'square' : n.shape?.k === 'ellipse' ? 'circle' : n.shape?.k === 'poly' ? 'hexagon' : n.shape?.k === 'star' ? 'star' : 'spline-pointer')
const nodeName = (n) => n.name || (n.t === 'text' && n.str ? `${describeNode(n)} "${n.str.replace(/\s+/g, ' ').slice(0, 24)}"` : describeNode(n))

/** Objects docker. env: {store, app, commands}. Returns {el, refresh, setVisible}. */
export function createObjects({ store, app, commands }) {
  const open = new Map() // id -> expanded (layers default open, groups default closed)
  const caps = new Map() // list id -> rows shown
  let rows = [], focusKey = null, renaming = null, anchor = null, scheduled = false, visible = true, stale = false, reveal = false, dragIds = null

  const btn = (ic, label, onclick) => h('button', { type: 'button', class: 'ds-btn', 'aria-label': label, title: label, onclick }, icon(ic))
  const bNew = btn('plus', 'New layer', () => commands.run('object.newLayer'))
  const bDel = btn('trash-2', 'Delete layer', () => deleteActiveLayer())
  const bUp = btn('chevron-up', 'Move up', () => move(1))
  const bDown = btn('chevron-down', 'Move down', () => move(-1))
  const toLayer = h('select', { class: 'select ds-tolayer', 'aria-label': 'Move the selection to a layer', onchange: (e) => { const v = e.target.value; e.target.value = ''; if (v) commands.run('object.moveToLayer', { layerId: +v }) } })
  const bar = h('div', { class: 'ds-obj-bar', role: 'toolbar', 'aria-label': 'Objects tools' }, bNew, bDel, bUp, bDown, h('span', { class: 'ds-grow' }), toLayer)
  const tree = h('div', { class: 'ds-tree', role: 'tree', 'aria-label': 'Objects', 'aria-multiselectable': 'true' })
  const el = h('div', { class: 'ds-obj' }, bar, tree)

  // ---------- model ----------
  const activeLayerId = () => store.activeLayerOf(store.page())?.id
  function listRows(items, depth, listId, out, layer, parent) {
    const cap = caps.get(listId) ?? SHOW
    let shown = 0
    for (let i = items.length - 1; i >= 0 && shown < cap; i--, shown++) {
      const node = items[i]
      const expanded = node.t === 'group' && (open.get(node.id) ?? false)
      out.push({ key: `n${node.id}`, kind: 'node', id: node.id, depth, node, layer, parent, listId, expandable: node.t === 'group' && node.items.length > 0, expanded })
      if (expanded) listRows(node.items, depth + 1, node.id, out, layer, node)
    }
    if (shown < items.length) out.push({ key: `m${listId}`, kind: 'more', listId, depth, remaining: items.length - shown })
  }
  function buildRows() {
    const out = []
    store.root.pages.forEach((page, pi) => {
      const current = pi === store.pageIndex
      out.push({ key: `p${page.id}`, kind: 'page', id: page.id, depth: 0, page, pi, expandable: false, expanded: current })
      if (!current || page.pending) return
      for (let li = page.layers.length - 1; li >= 0; li--) {
        const layer = page.layers[li]
        const expanded = open.get(layer.id) ?? true
        out.push({ key: `l${layer.id}`, kind: 'layer', id: layer.id, depth: 1, layer, page, listId: layer.id, expandable: layer.items.length > 0, expanded })
        if (expanded) listRows(layer.items, 2, layer.id, out, layer, null)
      }
    })
    return out
  }

  // ---------- rendering ----------
  function rowEl(r) {
    const selected = r.kind === 'node' ? store.sel.ids.includes(r.id) : r.kind === 'page' ? r.pi === store.pageIndex : r.kind === 'layer' ? r.id === activeLayerId() : false
    const li = h('div', { class: ['ds-row', `ds-r-${r.kind}`, selected && 'ds-sel', r.kind === 'node' && r.node.hidden && 'ds-off', r.kind === 'layer' && r.layer.hidden && 'ds-off'], role: 'treeitem', 'aria-level': String(r.depth + 1), 'aria-selected': String(selected), 'data-key': r.key, tabindex: r.key === focusKey ? 0 : -1 })
    li.style.setProperty('--d', String(r.depth))
    if (r.expandable) li.setAttribute('aria-expanded', String(r.expanded))
    if (r.kind === 'more') {
      li.classList.add('ds-more')
      li.append(h('button', { type: 'button', class: 'ds-more-b', tabindex: -1, onclick: () => { caps.set(r.listId, (caps.get(r.listId) ?? SHOW) + SHOW); render() } }, `Show ${Math.min(SHOW, r.remaining)} more (${r.remaining} not shown)`))
      return li
    }
    const twisty = r.expandable ? h('button', { type: 'button', class: 'ds-twisty', tabindex: -1, 'aria-label': r.expanded ? 'Collapse' : 'Expand', title: r.expanded ? 'Collapse (Left arrow)' : 'Expand (Right arrow)' }, icon(r.expanded ? 'chevron-down' : 'chevron-right')) : h('span', { class: 'ds-twisty ds-twisty-none', 'aria-hidden': 'true' })
    const ic = r.kind === 'page' ? (r.page.pending ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon('files')) : icon(r.kind === 'layer' ? 'layers' : nodeIcon(r.node))
    const name = r.kind === 'page' ? r.page.name : r.kind === 'layer' ? r.layer.name : nodeName(r.node)
    li.append(twisty, ic, h('span', { class: 'ds-name', title: name }, name))
    if (r.kind !== 'page') {
      const t = r.kind === 'layer' ? r.layer : r.node
      li.append(
        h('button', { type: 'button', class: 'ds-eye', tabindex: -1, 'aria-label': `Visible: ${name}`, 'aria-pressed': String(!t.hidden), title: t.hidden ? 'Show (Space)' : 'Hide (Space)' }, icon(t.hidden ? 'eye-off' : 'eye')),
        h('button', { type: 'button', class: 'ds-lock', tabindex: -1, 'aria-label': `Locked: ${name}`, 'aria-pressed': String(!!t.locked), title: t.locked ? 'Unlock (L)' : 'Lock (L)' }, icon(t.locked ? 'lock' : 'unlock')))
      if (r.kind === 'node') li.draggable = true
    }
    return li
  }
  function render() {
    if (renaming) { stale = true; return }
    if (!visible) { stale = true; return }
    stale = false
    const had = tree.contains(document.activeElement)
    rows = buildRows()
    if (!rows.some((r) => r.key === focusKey)) focusKey = rows.find((r) => r.kind === 'node' && store.sel.ids.includes(r.id))?.key || rows.find((r) => r.kind === 'layer')?.key || rows[0]?.key
    tree.replaceChildren(...rows.map(rowEl))
    const layers = store.page()?.layers || []
    toLayer.replaceChildren(h('option', { value: '' }, 'Move to layer...'), ...[...layers].reverse().map((l) => h('option', { value: String(l.id) }, l.name)))
    toLayer.disabled = !store.sel.ids.length
    bDel.disabled = layers.length < 2
    bUp.disabled = bDown.disabled = false
    if (had) tree.querySelector(`.ds-row[data-key="${focusKey}"]`)?.focus({ preventScroll: true })
    if (reveal) { reveal = false; const sel = tree.querySelector('.ds-row.ds-sel.ds-r-node'); if (sel) scrollInside(sel) }
  }
  function schedule() { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; render() }) }

  // keep selected objects visible in the tree: open their groups and extend the "Show more" window
  function revealSelection() {
    for (const id of store.sel.ids) {
      const f = store.find(id)
      if (!f?.node) continue
      for (let p = f.parent; p; p = store.find(p.id)?.parent) open.set(p.id, true)
      const list = f.parent ? f.parent.items : f.layer.items
      const listId = f.parent ? f.parent.id : f.layer.id
      const fromTop = list.length - 1 - f.index
      if (fromTop >= (caps.get(listId) ?? SHOW)) caps.set(listId, Math.ceil((fromTop + 1) / SHOW) * SHOW)
      if (f.layer) open.set(f.layer.id, open.get(f.layer.id) ?? true)
    }
    reveal = true
  }

  // ---------- actions ----------
  const rowOf = (target) => { const li = target.closest?.('.ds-row'); return li ? rows.find((r) => r.key === li.dataset.key) : null }
  const say = (t) => store.setStatus(t)
  function activate(r, e = {}) {
    focusKey = r.key
    if (r.kind === 'page') { app.gotoPage(r.pi); return }
    if (r.kind === 'layer') { store.setActiveLayer(store.page().id, r.id); schedule(); return }
    if (r.kind !== 'node') return
    const ids = store.sel.ids
    let next
    if ((e.shiftKey) && anchor != null) {
      const a = rows.findIndex((x) => x.kind === 'node' && x.id === anchor), b = rows.indexOf(r)
      const range = a >= 0 ? rows.slice(Math.min(a, b), Math.max(a, b) + 1).filter((x) => x.kind === 'node' && x.listId === r.listId).map((x) => x.id) : [r.id]
      next = [...new Set([...ids, ...range])]
    } else if (e.ctrlKey || e.metaKey) next = ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id]
    else { next = [r.id]; anchor = r.id }
    store.ctx = r.parent ? r.parent.id : null
    if (!store.setSel(next)) schedule()
    store.emit('status')
  }
  function toggleOpen(r) { open.set(r.id, !r.expanded); render() }
  function toggleFlag(r, key) {
    const t = r.kind === 'layer' ? r.layer : r.node
    const on = !t[key]
    const sel = store.sel.ids.filter((id) => (r.kind === 'layer' ? store.find(id)?.layer?.id !== r.id : id !== r.id))
    const label = `${on ? (key === 'hidden' ? 'Hide' : 'Lock') : (key === 'hidden' ? 'Show' : 'Unlock')} ${r.kind === 'layer' ? 'layer' : 'object'}`
    store.tx(label, (root) => (r.kind === 'layer' ? setLayerFlag(root, r.id, key, on) : setFlag(root, [r.id], key, on)), { sel: on ? sel : store.sel.ids })
  }
  function deleteActiveLayer() {
    const page = store.page(), id = activeLayerId()
    if (page.layers.length < 2) { say('A page needs at least one layer.'); return }
    store.tx('Delete layer', (root) => deleteLayer(root, id))
  }
  function move(dir) {
    if (store.sel.ids.length) commands.run(dir > 0 ? 'arrange.forward' : 'arrange.backward')
    else store.tx('Move layer', (root) => moveLayer(root, activeLayerId(), dir))
  }
  function rename(r) {
    const li = tree.querySelector(`.ds-row[data-key="${r.key}"]`)
    const span = li?.querySelector('.ds-name')
    if (!span || r.kind === 'more') return
    const cur = r.kind === 'page' ? r.page.name : r.kind === 'layer' ? r.layer.name : nodeName(r.node)
    const input = h('input', { type: 'text', class: 'input ds-rename', value: cur, maxlength: 200, 'aria-label': 'New name' })
    renaming = r.key
    span.replaceWith(input)
    input.focus(); input.select()
    let done = false
    const finish = (commit) => {
      if (done) return
      done = true
      renaming = null
      const v = input.value
      if (commit && v.trim() !== cur) store.tx('Rename', (root) => (r.kind === 'page' ? renamePage(root, r.id, v) : r.kind === 'layer' ? renameLayer(root, r.id, v) : renameNode(root, r.id, v)))
      render()
      tree.querySelector(`.ds-row[data-key="${r.key}"]`)?.focus({ preventScroll: true })
    }
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true) } else if (e.key === 'Escape') { e.preventDefault(); finish(false) } })
    input.addEventListener('blur', () => finish(true))
  }

  tree.addEventListener('click', (e) => {
    const r = rowOf(e.target)
    if (!r) return
    if (e.target.closest('.ds-twisty') && r.expandable) { toggleOpen(r); return }
    if (e.target.closest('.ds-eye')) { toggleFlag(r, 'hidden'); return }
    if (e.target.closest('.ds-lock')) { toggleFlag(r, 'locked'); return }
    if (e.target.closest('.ds-rename')) return
    // a double-click renames. It is read from the second click's detail, because the first click re-renders the rows and a dblclick event would land on a replaced element
    if (e.detail === 2 && r.kind !== 'more' && (e.target.closest('.ds-name') || r.kind === 'page')) { rename(r); return }
    activate(r, e)
  })
  tree.addEventListener('focusin', (e) => { const r = rowOf(e.target); if (r && e.target.classList.contains('ds-row')) focusKey = r.key })
  tree.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input')) return
    const li = e.target.closest?.('.ds-row')
    if (!li) return
    const i = rows.findIndex((x) => x.key === li.dataset.key)
    const r = rows[i]
    const focusAt = (j) => { j = Math.max(0, Math.min(rows.length - 1, j)); focusKey = rows[j]?.key; tree.querySelectorAll('.ds-row').forEach((x) => { x.tabIndex = x.dataset.key === focusKey ? 0 : -1 }); const t = tree.querySelector(`.ds-row[data-key="${focusKey}"]`); if (t) { t.focus({ preventScroll: true }); scrollInside(t) } }
    let handled = true
    if (e.key === 'ArrowDown') focusAt(i + 1)
    else if (e.key === 'ArrowUp') focusAt(i - 1)
    else if (e.key === 'Home') focusAt(0)
    else if (e.key === 'End') focusAt(rows.length - 1)
    else if (e.key === 'ArrowRight') { if (r.expandable && !r.expanded) toggleOpen(r); else if (r.expanded) focusAt(i + 1) }
    else if (e.key === 'ArrowLeft') {
      if (r.expandable && r.expanded && r.kind !== 'page') toggleOpen(r)
      else { let j = i - 1; while (j >= 0 && rows[j].depth >= r.depth) j--; if (j >= 0) focusAt(j) }
    } else if (e.key === 'Enter') { if (r.kind === 'more') caps.set(r.listId, (caps.get(r.listId) ?? SHOW) + SHOW), render(); else activate(r, e) }
    else if (e.key === ' ') { if (r.kind === 'layer' || r.kind === 'node') toggleFlag(r, 'hidden') }
    else if ((e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey && !e.altKey) { if (r.kind === 'layer' || r.kind === 'node') toggleFlag(r, 'locked') }
    else if (e.key === 'F2') rename(r)
    else handled = false
    if (handled) { e.preventDefault(); e.stopPropagation() }
  })

  // ---------- drag and drop reordering ----------
  const clearMarks = () => tree.querySelectorAll('.ds-drop-above, .ds-drop-below, .ds-drop-into').forEach((x) => x.classList.remove('ds-drop-above', 'ds-drop-below', 'ds-drop-into'))
  function zoneFor(e, r, li) {
    const b = li.getBoundingClientRect(), y = (e.clientY - b.top) / (b.height || 1)
    if (r.kind === 'layer') return 'into'
    if (r.kind !== 'node') return null
    if (r.node.t === 'group' && y > 0.25 && y < 0.75) return 'into'
    return y < 0.5 ? 'above' : 'below'
  }
  tree.addEventListener('dragstart', (e) => {
    const r = rowOf(e.target)
    if (!r || r.kind !== 'node') return
    dragIds = store.sel.ids.includes(r.id) ? topIds(store, store.sel.ids) : [r.id]
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', 'ds-objects')
  })
  tree.addEventListener('dragover', (e) => {
    if (!dragIds) return
    const li = e.target.closest?.('.ds-row'), r = li && rows.find((x) => x.key === li.dataset.key)
    const z = r && zoneFor(e, r, li)
    clearMarks()
    if (!z) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    li.classList.add(`ds-drop-${z}`)
  })
  tree.addEventListener('dragleave', (e) => { if (!tree.contains(e.relatedTarget)) clearMarks() })
  tree.addEventListener('dragend', () => { dragIds = null; clearMarks() })
  tree.addEventListener('drop', (e) => {
    if (!dragIds) return
    const li = e.target.closest?.('.ds-row'), r = li && rows.find((x) => x.key === li.dataset.key)
    const z = r && zoneFor(e, r, li)
    const ids = dragIds
    dragIds = null; clearMarks()
    if (!z) return
    e.preventDefault()
    // the tree lists the front object first, so "above" in the list is the front side in z order
    const dest = z === 'into' ? { into: r.id } : z === 'above' ? { above: r.id } : { below: r.id }
    store.tx('Reorder', (root) => moveNodes(root, ids, dest))
  })

  // ---------- keep in step with the store ----------
  store.on('doc', (e) => { if (e?.load) { open.clear(); caps.clear(); anchor = null; focusKey = null } schedule() }) // a new document starts with a fresh tree state
  store.on('page', schedule)
  store.on('sel', () => { revealSelection(); schedule() })
  render()
  return {
    el, refresh: schedule,
    setVisible(v) { visible = v; if (v && stale) schedule() },
    /** For tests: the rows as {kind, name, depth, selected}. */
    get rows() { return rows },
  }
}

const SEGS = [['objects', 'Objects'], ['properties', 'Props'], ['align', 'Align'], ['transform', 'Transform']]
const SHEET_MIN = 120, SHEET_CLOSE = 100

/**
 * Dock shell: collapsible sections in a column (desktop) or a bottom sheet (phone). env: {store, app, commands, focusBack}.
 * On a phone the sheet shows ONE section at a time, chosen with a segmented control (Objects, Props, Align, Transform); its grip can be dragged
 * (up for more room, down past a threshold to close) or moved with the Up and Down keys; Esc, a tap outside and the Close button close it.
 */
export function createDocks({ store, app, commands, focusBack }) {
  const mq = window.matchMedia(PHONE)
  let desktopOpen = true, phoneOpen = false
  const sections = []
  const listeners = []
  let wrap = null, backdrop = null, seg = 'objects', saved = null, sheetH = null, drag = null
  const objects = createObjects({ store, app, commands })
  const closeBtn = h('button', { type: 'button', class: 'ds-btn ds-dock-close', 'aria-label': 'Close panels', onclick: () => set(false) }, icon('x'), h('span', 'Close'))
  const body = h('div', { class: 'ds-dock-body' })
  const grip = h('div', { class: 'ds-dock-grip', role: 'separator', 'aria-orientation': 'horizontal', tabindex: 0, 'aria-label': 'Resize the panels. Drag, or press the Up and Down arrow keys.', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '62' }, h('span', { 'aria-hidden': 'true' }))
  const head = h('div', { class: 'ds-dock-head' }, h('span', { class: 'ds-dock-title' }, 'Panels'), closeBtn)
  const segBtns = SEGS.map(([id, label]) => h('button', { type: 'button', role: 'tab', class: 'ds-seg-b', 'data-seg': id, 'aria-selected': 'false', tabindex: -1, onclick: () => selectSeg(id) }, label))
  const segBar = h('div', { class: 'ds-seg', role: 'tablist', 'aria-label': 'Panels' }, ...segBtns)
  const el = h('aside', { class: 'ds-dock', 'aria-label': 'Dockers' }, grip, head, segBar, body)

  function toggleSection(sec, on) {
    sec.body.hidden = !on; sec.head.setAttribute('aria-expanded', String(on)); sec.open = on
    sec.wrap.classList.toggle('ds-dsec-shut', !on)
    if (on) { objects.refresh(); sec.refresh?.() }
    sec.onToggle?.(on)
  }
  /** open: false starts the section collapsed (the Objects docker keeps the room until another one is opened). */
  function addSection({ id, title, el: content, refresh, open = true }) {
    const head = h('button', { type: 'button', class: 'ds-dsec-head', 'aria-expanded': String(open), onclick: () => toggleSection(sec, sec.body.hidden) }, h('span', title), icon('chevron-down'))
    const secBody = h('div', { class: 'ds-dsec-body', hidden: !open }, content)
    const wrapEl = h('section', { class: ['ds-dsec', !open && 'ds-dsec-shut'], 'data-section': id }, head, secBody)
    const sec = { id, head, body: secBody, wrap: wrapEl, open, refresh }
    body.append(wrapEl)
    sections.push(sec)
    if (mq.matches) syncPhone()
    return sec
  }
  // ---------- phone: one section at a time ----------
  function paintSeg() {
    for (const b of segBtns) { const on = b.dataset.seg === seg; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.hidden = !sections.some((s) => s.id === b.dataset.seg) }
  }
  function syncPhone() {
    if (!sections.some((s) => s.id === seg)) seg = 'objects'
    for (const s of sections) if ((s.id === seg) !== s.open) toggleSection(s, s.id === seg)
    paintSeg()
  }
  function selectSeg(id, focus = false) {
    if (!sections.some((s) => s.id === id)) return false
    seg = id
    if (mq.matches) { syncPhone(); body.scrollTop = 0 } else paintSeg()
    if (focus) segBtns.find((b) => b.dataset.seg === id)?.focus({ preventScroll: true })
    return true
  }
  segBar.addEventListener('keydown', (e) => {
    const list = segBtns.filter((b) => !b.hidden)
    const i = list.indexOf(document.activeElement)
    if (i < 0) return
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key]
    if (j == null) return
    e.preventDefault(); e.stopPropagation()
    selectSeg(list[(j + list.length) % list.length].dataset.seg, true)
  })
  // ---------- phone: the sheet height (drag the grip or the title) ----------
  const wrapH = () => wrap?.getBoundingClientRect().height || 700
  function setHeight(px, live) {
    const max = Math.max(SHEET_MIN, wrapH() * 0.9)
    const v = Math.max(live ? 40 : SHEET_MIN, Math.min(max, px))
    el.style.setProperty('--ds-sheet-h', `${Math.round(v)}px`)
    grip.setAttribute('aria-valuenow', String(Math.round((v / wrapH()) * 100)))
    el.classList.toggle('ds-closing', live && v < SHEET_CLOSE)
    return v
  }
  function dragStart(e) {
    if (!mq.matches || e.button > 0 || e.target.closest('button')) return
    drag = { y: e.clientY, h: el.getBoundingClientRect().height, id: e.pointerId, node: e.currentTarget }
    try { drag.node.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    e.preventDefault()
  }
  function dragMove(e) { if (drag && e.pointerId === drag.id) setHeight(drag.h - (e.clientY - drag.y), true) }
  function dragEnd(e) {
    if (!drag || e.pointerId !== drag.id) return
    const v = drag.h - (e.clientY - drag.y)
    drag = null
    el.classList.remove('ds-closing')
    if (e.type === 'pointerup' && v < SHEET_CLOSE) { sheetH = null; el.style.removeProperty('--ds-sheet-h'); set(false); return }
    if (e.type === 'pointerup') sheetH = setHeight(v, false)
    else if (sheetH == null) el.style.removeProperty('--ds-sheet-h')
    else setHeight(sheetH, false)
  }
  for (const n of [grip, head]) { n.addEventListener('pointerdown', dragStart); n.addEventListener('pointermove', dragMove); n.addEventListener('pointerup', dragEnd); n.addEventListener('pointercancel', dragEnd) }
  grip.addEventListener('keydown', (e) => {
    const cur = el.getBoundingClientRect().height
    const v = { ArrowUp: cur + 40, ArrowDown: cur - 40, Home: wrapH(), End: SHEET_MIN }[e.key]
    if (v == null) return
    e.preventDefault(); e.stopPropagation()
    sheetH = setHeight(v, false)
  })

  /** Show the dock, expand one section and bring it into view. */
  function openSection(id) {
    const sec = sections.find((s) => s.id === id)
    if (!sec) return false
    if (mq.matches) seg = id
    set(true)
    if (mq.matches) syncPhone()
    else if (!sec.open) toggleSection(sec, true)
    else sec.refresh?.()
    scrollInside(sec.wrap)
    return true
  }
  const obj = addSection({ id: 'objects', title: 'Objects', el: objects.el, refresh: () => objects.refresh() })
  obj.onToggle = (on) => objects.setVisible(on && isOpen())

  const isOpen = () => (mq.matches ? phoneOpen : desktopOpen)
  function apply() {
    wrap?.classList.toggle('ds-nodock', !desktopOpen)
    wrap?.classList.toggle('ds-sheet', phoneOpen && mq.matches)
    el.hidden = !isOpen()
    el.setAttribute('aria-label', mq.matches ? 'Panels' : 'Dockers')
    if (backdrop) backdrop.hidden = !(mq.matches && phoneOpen)
    objects.setVisible(isOpen() && obj.open)
    for (const s of sections) if (isOpen() && s.open) s.refresh?.()
    for (const fn of listeners) fn(isOpen())
  }
  function set(on) {
    if (mq.matches) phoneOpen = !!on; else desktopOpen = !!on
    apply()
    if (!on) focusBack?.()
    else if (mq.matches) segBtns.find((b) => b.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true })
  }
  // crossing the phone breakpoint: remember the desktop layout, show one section on a phone, bring the desktop layout back
  function onMq() {
    if (mq.matches) { saved = sections.map((s) => [s, s.open]); syncPhone() } else { for (const [s, on] of saved || []) if (s.open !== on) toggleSection(s, on); saved = null }
    apply()
  }
  mq.addEventListener?.('change', onMq)
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mq.matches && phoneOpen) { e.preventDefault(); e.stopPropagation(); set(false) } })
  return {
    el, objects, addSection, openSection, sections, selectSeg,
    attach(w) {
      wrap = w
      backdrop = h('div', { class: 'ds-sheet-bd', 'aria-hidden': 'true', hidden: true, onclick: () => set(false) })  // a click, not a pointerdown: the sheet must not vanish under the finger and let the tap land on what was behind it
      w.append(backdrop)
      if (mq.matches) { saved = sections.map((s) => [s, s.open]); syncPhone() }
      apply()
    },
    isOpen, toggle: () => set(!isOpen()), set,
    /** fn(open) runs whenever the dock opens, closes or changes layout (the Panels button keeps aria-expanded in step). */
    onChange(fn) { listeners.push(fn); fn(isOpen()) },
    dispose() { mq.removeEventListener?.('change', onMq); backdrop?.remove() },
  }
}
