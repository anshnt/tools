// Interaction: creating, selecting, moving and resizing annotations, in-place text editing, the text-selection popover
// and keyboard shortcuts. Everything edits through store.commit()/record() so undo works.
import { h, icon, debounce, toast } from '../../lib/ui.js'
import { clamp, normRect, decimate } from './_geom.js'
import {
  DEFAULTS, LABELS, MARKUP, makeAnnot, renderAnnot, bounds, hit, translate, resizeRect, layoutText, FONTS, clampToPage,
} from './_annots.js'
import { selectionRects } from './_text.js'

export const TOOL_LIST = [
  { id: 'select', name: 'Select', key: 'V', icon: 'mouse-pointer-2', tip: 'Select, move and resize; select text to mark it up' },
  { sep: true },
  { id: 'highlight', name: 'Highlight', key: 'H', icon: 'highlighter', tip: 'Select text to highlight it' },
  { id: 'underline', name: 'Underline', key: 'U', icon: 'underline', tip: 'Select text to underline it' },
  { id: 'strike', name: 'Strikethrough', key: 'S', icon: 'strikethrough', tip: 'Select text to strike it out' },
  { sep: true },
  { id: 'ink', name: 'Draw', key: 'P', icon: 'pencil', tip: 'Freehand pen' },
  { id: 'rect', name: 'Rectangle', key: 'R', icon: 'square', tip: 'Draw a rectangle' },
  { id: 'ellipse', name: 'Ellipse', key: 'E', icon: 'circle', tip: 'Draw an ellipse' },
  { id: 'line', name: 'Line', key: 'L', icon: 'minus', tip: 'Draw a straight line' },
  { id: 'arrow', name: 'Arrow', key: 'A', icon: 'arrow-up-right', tip: 'Draw an arrow' },
  { sep: true },
  { id: 'note', name: 'Sticky note', key: 'N', icon: 'message-square-plus', tip: 'Add a comment note' },
  { id: 'text', name: 'Text box', key: 'T', icon: 'type', tip: 'Add text anywhere' },
  { id: 'image', name: 'Image', key: 'I', icon: 'image-plus', tip: 'Place an image' },
  { id: 'signature', name: 'Signature', key: 'G', icon: 'signature', tip: 'Draw, type or upload a signature' },
  { id: 'stamp', name: 'Stamp', key: 'M', icon: 'stamp', tip: 'Approved, Draft, Confidential and more' },
  { sep: true },
  { id: 'whiteout', name: 'White-out', key: 'W', icon: 'eraser', tip: 'Cover content with white (the text underneath stays in the file)' },
  { id: 'redact', name: 'Redact', key: 'X', icon: 'eye-off', tip: 'Mark areas to remove for good when you save' },
]
const KEYS = Object.fromEntries(TOOL_LIST.filter((t) => t.key).map((t) => [t.key.toLowerCase(), t.id]))
const BOX = new Set(['rect', 'ellipse', 'whiteout', 'redact'])
const LINE = new Set(['line', 'arrow'])
const PLACE = new Set(['note', 'image', 'signature', 'stamp'])
const ONE_SHOT = new Set(['note', 'text', 'image', 'signature', 'stamp'])
const typing = (t) => !!t?.closest?.('input, textarea, select, [contenteditable="true"]')

export function createTools(app) {
  const { store, viewer } = app
  let g = null // active pointer gesture
  let pending = null // image/signature/stamp waiting to be placed: {assetId, w, h, kind}
  let clip = null
  let ghostPv = null

  const styleOf = (type) => ({ ...DEFAULTS[type], ...app.styles[type] })
  const tol = () => 6 / viewer.zoom
  const hide = (el) => { el.hidden = true }

  function addAnnot(pv, type, props, { select = false } = {}) {
    const a = makeAnnot(type, pv.pid, { ...styleOf(type), ...props }, app.author())
    store.commit(`Add ${LABELS[type].toLowerCase()}`, (s) => s.annots.push(a), { pids: [pv.pid] })
    if (select) { store.setTool('select'); store.select(a.id) }
    return a
  }
  const topHit = (pv, pt) => {
    const list = store.state.annots
    for (let i = list.length - 1; i >= 0; i--) if (list[i].pid === pv.pid && hit(list[i], pt.x, pt.y, tol())) return list[i]
    return null
  }

  // ---------- pointer gestures ----------
  function onDown(e) {
    if (g || (e.pointerType === 'mouse' && e.button !== 0)) return
    const pv = viewer.pageFromEvent(e)
    if (!pv || e.target.closest('input, textarea, select, button, a')) return
    const tool = store.tool
    const pt = viewer.toBase(pv, e.clientX, e.clientY)
    const start = (kind, extra = {}) => { g = { kind, pv, pt, start: pt, tool, before: store.begin(), moved: false, id: e.pointerId, ...extra }; e.preventDefault() }

    if (tool === 'select') {
      const handle = e.target.dataset?.h
      const sel = store.sel && store.annot(store.sel)
      if (handle && sel) { start('resize', { a: sel, handle, orig: structuredClone(bounds(sel)) }); return }
      const a = topHit(pv, pt)
      if (a) { store.select(a.id); start('move', { a, last: pt }) } else if (store.sel) store.select(null)
      return
    }
    if (MARKUP.has(tool)) {
      if (e.target.closest('.textlayer span')) return // let the browser select text; applied on pointer up
      start('box', { markup: true, pts: [pt] }); return
    }
    if (tool === 'ink') { start('ink', { pts: [[pt.x, pt.y]] }); draw(e) ; return }
    if (BOX.has(tool) || tool === 'text') { start('box'); return }
    if (LINE.has(tool)) { start('line'); return }
    if (PLACE.has(tool)) { start('place'); return }
  }

  function tmpAnnot(type, props) {
    return makeAnnot(type, g.pv.pid, { ...styleOf(type), ...props }, '')
  }
  const ptOf = (pv, e) => {
    const p = viewer.toBase(pv, e.clientX, e.clientY), pg = store.page(pv.pid)
    return g?.kind === 'move' ? p : { x: clamp(p.x, 0, pg.w), y: clamp(p.y, 0, pg.h) }
  }
  function draw(e) {
    if (!g) return
    const pt = ptOf(g.pv, e)
    if (Math.hypot(pt.x - g.start.x, pt.y - g.start.y) * viewer.zoom > 3) g.moved = true
    const pv = g.pv
    switch (g.kind) {
      case 'ink':
        g.pts.push([pt.x, pt.y])
        viewer.drawTmp(pv, renderAnnot(tmpAnnot('ink', { paths: [g.pts] })))
        break
      case 'box': {
        const r = normRect(g.start.x, g.start.y, pt.x, pt.y)
        const shown = g.markup ? tmpAnnot(store.tool, { rects: [[r.x, r.y, r.w, r.h]] }) : tmpAnnot(store.tool === 'text' ? 'rect' : store.tool, store.tool === 'text' ? { ...r, stroke: '#5b4cf0', width: 1, fill: null } : r)
        viewer.drawTmp(pv, renderAnnot(shown))
        break
      }
      case 'line': {
        let { x, y } = pt
        if (e.shiftKey) { const ang = Math.round(Math.atan2(y - g.start.y, x - g.start.x) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(x - g.start.x, y - g.start.y); x = g.start.x + d * Math.cos(ang); y = g.start.y + d * Math.sin(ang) }
        g.end = { x, y }
        viewer.drawTmp(pv, renderAnnot(tmpAnnot(store.tool, { x1: g.start.x, y1: g.start.y, x2: x, y2: y })))
        break
      }
      case 'move': {
        if (!g.moved) break
        translate(g.a, pt.x - g.last.x, pt.y - g.last.y)
        g.last = pt
        viewer.draw(pv.pid)
        break
      }
      case 'resize': {
        if (g.handle === 'p1') { g.a.x1 = pt.x; g.a.y1 = pt.y } else if (g.handle === 'p2') { g.a.x2 = pt.x; g.a.y2 = pt.y } else {
          resizeRect(g.a, g.orig, g.handle, pt, g.a.type === 'image' || e.shiftKey)
          if (g.a.type === 'text') g.a.h = Math.max(g.a.h, layoutText(g.a).h)
        }
        g.moved = true
        viewer.draw(pv.pid)
        break
      }
      case 'place':
        showGhost(pv, pt)
        break
    }
    if (g?.kind !== 'place') e.preventDefault?.()
  }

  function up(e) {
    if (!g) return
    const gg = g
    g = null
    const pv = gg.pv
    viewer.drawTmp(pv, null)
    g = gg
    const pt = ptOf(pv, e)
    g = null
    const min = 3 / viewer.zoom
    switch (gg.kind) {
      case 'ink': {
        addAnnot(pv, 'ink', { paths: [decimate(gg.pts)] })
        break
      }
      case 'box': {
        const r = normRect(gg.start.x, gg.start.y, pt.x, pt.y)
        const tool = store.tool
        if (tool === 'text') {
          const small = r.w < min * 4 || r.h < min * 4
          createText(pv, small ? { x: gg.start.x, y: gg.start.y, w: 200 } : r)
        } else if (r.w >= min && r.h >= min) {
          if (gg.markup) addAnnot(pv, tool, { rects: [[r.x, r.y, r.w, r.h]] })
          else addAnnot(pv, tool, r)
        }
        break
      }
      case 'line': {
        const end = gg.end || pt
        if (Math.hypot(end.x - gg.start.x, end.y - gg.start.y) >= min * 2) addAnnot(pv, store.tool, { x1: gg.start.x, y1: gg.start.y, x2: end.x, y2: end.y })
        break
      }
      case 'move':
      case 'resize':
        if (gg.moved) {
          if (gg.kind === 'move') clampToPage(gg.a, store.page(pv.pid).w, store.page(pv.pid).h)
          store.record(gg.kind === 'move' ? 'Move' : 'Resize', gg.before, { pids: [pv.pid] })
          viewer.draw(pv.pid)
        }
        break
      case 'place': place(pv, pt, gg); break
    }
    viewer.drawTmp(pv, null)
  }

  function place(pv, pt, gg) {
    const tool = store.tool
    if (tool === 'note') {
      const a = addAnnot(pv, 'note', { x: pt.x - 4, y: pt.y - 4, text: '' }, { select: true })
      app.panels?.focusComment(a.id)
      return
    }
    if (!pending) return
    const pg = store.page(pv.pid)
    const ratio = pending.w / pending.h
    let w = pending.defW || Math.min(pending.w, Math.min(pg.w, pg.h) * 0.4)
    let x = pt.x - w / 2, y = pt.y - w / ratio / 2
    if (gg.moved) {
      const r = normRect(gg.start.x, gg.start.y, pt.x, pt.y)
      if (r.w > 12) { w = r.w; x = r.x; y = r.y }
    }
    const a = addAnnot(pv, 'image', { x, y, w, h: w / ratio, asset: pending.assetId, kind: pending.kind }, { select: true })
    clampToPage(a, pg.w, pg.h)
    pending = null
    viewer.draw(pv.pid)
  }
  function showGhost(pv, pt) {
    if (!pending || !PLACE.has(store.tool) || store.tool === 'note') return
    const pg = store.page(pv.pid)
    const w = pending.defW || Math.min(pending.w, Math.min(pg.w, pg.h) * 0.4)
    const a = makeAnnot('image', pv.pid, { x: pt.x - w / 2, y: pt.y - w / (pending.w / pending.h) / 2, w, h: w / (pending.w / pending.h), asset: pending.assetId }, '')
    const el = renderAnnot(a, { assets: app.assets })
    el.style.opacity = 0.55
    if (ghostPv && ghostPv !== pv) viewer.drawTmp(ghostPv, null)
    ghostPv = pv
    viewer.drawTmp(pv, el)
  }
  function onHover(e) {
    if (g || !pending || !PLACE.has(store.tool)) return
    const pv = viewer.pageFromEvent(e)
    if (!pv) { if (ghostPv) viewer.drawTmp(ghostPv, null); ghostPv = null; return }
    showGhost(pv, viewer.toBase(pv, e.clientX, e.clientY))
  }

  // ---------- text boxes ----------
  function createText(pv, box) {
    const pg = store.page(pv.pid)
    const before = store.begin()
    const a = makeAnnot('text', pv.pid, { ...styleOf('text'), x: box.x, y: box.y, w: clamp(box.w, 40, pg.w), h: box.h || 0, text: '' }, app.author())
    a.h = Math.max(a.h, a.size * 1.2 + 6)
    store.state.annots.push(a)
    store.setTool('select')
    store.select(a.id)
    startEdit(a, before, true)
  }
  function startEdit(a, before = store.begin(), isNew = false) {
    const pv = viewer.views.get(a.pid)
    if (!pv) return
    store.editing = a.id
    viewer.draw(pv.pid)
    const f = FONTS[a.font] || FONTS.helv
    const ta = h('textarea', { class: 'tbox', spellcheck: true, 'aria-label': 'Text box content', value: a.text })
    const fit = () => {
      a.text = ta.value
      a.h = Math.max(a.h, layoutText(a).h)
      ta.style.height = `${Math.max(a.h, layoutText(a).h)}px`
      viewer.draw(pv.pid)
    }
    Object.assign(ta.style, {
      left: `${a.x}px`, top: `${a.y}px`, width: `${a.w}px`, height: `${a.h}px`, fontSize: `${a.size}px`, fontFamily: f.css, color: a.color,
      fontWeight: a.bold ? 700 : 400, fontStyle: a.italic ? 'italic' : 'normal', textAlign: a.align, background: a.fill || 'rgba(255,255,255,.01)',
    })
    ta.addEventListener('input', fit)
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) { ev.preventDefault(); ta.blur() } ev.stopPropagation() })
    ta.addEventListener('blur', () => {
      a.text = ta.value
      store.editing = null
      ta.remove()
      if (!a.text.trim()) { const i = store.state.annots.indexOf(a); if (i >= 0) store.state.annots.splice(i, 1); store.select(null) }
      store.record(isNew ? 'Add text box' : 'Edit text', before, { pids: [pv.pid] })
      viewer.draw(pv.pid)
      app.panels?.refresh()
    })
    pv.html.append(ta)
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }

  // ---------- text selection -> markup ----------
  function applyMarkup(kind) {
    const groups = selectionRects(viewer.pagesEl, (pid) => viewer.views.get(pid)?.items)
    if (!groups.length) return false
    const author = app.author()
    store.commit(`Add ${LABELS[kind].toLowerCase()}`, (s) => {
      for (const gr of groups) {
        if (kind === 'redact') for (const r of gr.rects) s.annots.push(makeAnnot('redact', gr.pid, { x: r[0] - 0.5, y: r[1] - 0.5, w: r[2] + 1, h: r[3] + 1 }, author))
        else s.annots.push(makeAnnot(kind, gr.pid, { ...styleOf(kind), rects: gr.rects }, author))
      }
    }, { pids: groups.map((x) => x.pid) })
    getSelection()?.removeAllRanges()
    hide(pop)
    return true
  }
  const pop = h('div', { class: 'sel-pop', hidden: true, role: 'toolbar', 'aria-label': 'Selected text' },
    ...[['highlight', 'highlighter', 'Highlight'], ['underline', 'underline', 'Underline'], ['strike', 'strikethrough', 'Strikethrough'], ['redact', 'eye-off', 'Redact']].map(([k, ic, label]) =>
      h('button', { type: 'button', class: 'sp-btn', 'aria-label': label, 'data-tip': label, onpointerdown: (e) => e.preventDefault(), onclick: () => applyMarkup(k) }, icon(ic))),
    h('button', { type: 'button', class: 'sp-btn', 'aria-label': 'Copy text', 'data-tip': 'Copy', onpointerdown: (e) => e.preventDefault(), onclick: () => { try { document.execCommand('copy') } catch { /* ignore */ } toast('Copied', 'success'); getSelection()?.removeAllRanges(); hide(pop) } }, icon('copy')))
  app.root.append(pop)

  function selectionInText() {
    const sel = getSelection()
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null
    const n = sel.anchorNode?.parentElement
    return n?.closest?.('.textlayer') ? sel.getRangeAt(0) : null
  }
  let pointerDown = false
  const checkSelection = debounce(() => {
    if (pointerDown) return
    const range = selectionInText()
    if (!range) return hide(pop)
    if (MARKUP.has(store.tool)) { applyMarkup(store.tool); return }
    if (store.tool !== 'select') return hide(pop)
    const r = range.getBoundingClientRect(), box = app.root.getBoundingClientRect()
    pop.hidden = false
    const pw = pop.offsetWidth || 200
    pop.style.left = `${clamp(r.left + r.width / 2 - pw / 2 - box.left, 8, box.width - pw - 8)}px`
    pop.style.top = `${clamp(r.bottom + 10 - box.top, 8, box.height - 60)}px`
  }, 180)
  const onSelChange = () => checkSelection()
  const onPointerDownAny = () => { pointerDown = true }
  const onPointerUpAny = () => { pointerDown = false; checkSelection() }

  // ---------- tool changes ----------
  const offStore = store.on(async (type, d) => {
    if (type === 'tool') {
      if (g) g = null
      viewer.drawTmp(ghostPv || [...viewer.views.values()][0], null)
      hide(pop)
      pending = null
      if (d.tool === 'image') await arm(() => app.sign.chooseImage(), 'image')
      else if (d.tool === 'signature') await arm(() => app.sign.chooseSignature(), 'signature')
      else if (d.tool === 'stamp') await arm(() => app.sign.chooseStamp(), 'stamp')
    }
  })
  async function arm(chooser, tool) {
    const res = await chooser()
    if (store.tool !== tool) return
    if (!res) { store.setTool('select'); return }
    pending = res
    toast('Click the page to place it. Drag to size it.', 'info', 2600)
  }

  // ---------- double click, keyboard ----------
  function onDbl(e) {
    if (store.tool !== 'select') return
    const pv = viewer.pageFromEvent(e)
    if (!pv || e.target.closest('input, textarea, select, button')) return
    const a = topHit(pv, viewer.toBase(pv, e.clientX, e.clientY))
    if (!a) return
    if (a.type === 'text') startEdit(a)
    else if (a.type !== 'redact') app.panels?.focusComment(a.id)
  }

  function removeSelected() {
    const a = store.sel && store.annot(store.sel)
    if (!a) return false
    store.commit(`Delete ${LABELS[a.type].toLowerCase()}`, (s) => { s.annots = s.annots.filter((x) => x.id !== a.id) }, { pids: [a.pid] })
    store.select(null)
    return true
  }
  function duplicate(src, dx = 14, dy = 14, pid = src.pid) {
    const c = structuredClone(src)
    c.id = makeAnnot('note', pid, {}).id
    c.pid = pid
    translate(c, dx, dy)
    store.commit('Duplicate', (s) => s.annots.push(c), { pids: [pid] })
    store.setTool('select')
    store.select(c.id)
  }
  app.removeSelected = removeSelected

  function onKey(e) {
    if (!app.root.isConnected || app.busy) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (typing(e.target)) {
      if (key === 'escape' && e.target.closest('.pdfs-search')) app.closeSearch?.()
      if (!(mod && ['s', 'o', 'f'].includes(key))) return
    }
    if (document.querySelector('dialog[open]')) return
    if (mod) {
      if (key === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo() } else if (key === 'y') { e.preventDefault(); store.redo() } else if (key === 's') { e.preventDefault(); app.save?.() } else if (key === 'f') { e.preventDefault(); app.openSearch?.() } else if (key === 'o') { e.preventDefault(); app.open?.() } else if (key === '0') { e.preventDefault(); viewer.setZoom('width') } else if (key === '=' || key === '+') { e.preventDefault(); viewer.zoomBy(1) } else if (key === '-') { e.preventDefault(); viewer.zoomBy(-1) } else if (key === 'd') {
        const a = store.sel && store.annot(store.sel)
        if (a) { e.preventDefault(); duplicate(a) }
      } else if (key === 'c' && store.sel && getSelection()?.isCollapsed !== false) { clip = structuredClone(store.annot(store.sel)); toast('Copied', 'info', 1200) } else if (key === 'v' && clip) {
        e.preventDefault()
        const pv = viewer.views.get(store.state.pages[viewer.current]?.id)
        if (pv) duplicate(clip, 14, 14, pv.pid)
      }
      return
    }
    if (e.altKey) return
    if (key === 'escape') {
      if (g) { g = null; viewer.drawTmp(ghostPv, null) } else if (store.tool !== 'select') store.setTool('select'); else if (store.sel) store.select(null); else if (!pop.hidden) { hide(pop); getSelection()?.removeAllRanges() }
      return
    }
    if (!app.doc) return
    const a = store.sel && store.annot(store.sel)
    if (a && (key === 'delete' || key === 'backspace')) { e.preventDefault(); removeSelected(); return }
    if (a && key === 'enter' && a.type === 'text') { e.preventDefault(); startEdit(a); return }
    if (a && key.startsWith('arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 10 : 1
      const before = store.begin()
      translate(a, key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0)
      store.record('Nudge', before, { pids: [a.pid], coalesce: `nudge:${a.id}` })
      return
    }
    if (KEYS[key]) { e.preventDefault(); store.setTool(KEYS[key]); return }
    if (key === '+' || key === '=') { viewer.zoomBy(1); return }
    if (key === '-') { viewer.zoomBy(-1); return }
  }

  const vp = viewer.pagesEl
  vp.addEventListener('pointerdown', onDown)
  vp.addEventListener('pointermove', onHover)
  vp.addEventListener('dblclick', onDbl)
  const onMove = (e) => { if (g && (e.pointerId === g.id)) draw(e) }
  const onUp = (e) => { if (g && e.pointerId === g.id) up(e) }
  const onCancel = () => { if (g) { viewer.drawTmp(g.pv, null); if (g.kind === 'move' || g.kind === 'resize') store.record('Edit', g.before, { pids: [g.pv.pid] }); g = null } }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  document.addEventListener('keydown', onKey)
  document.addEventListener('selectionchange', onSelChange)
  document.addEventListener('pointerdown', onPointerDownAny, true)
  document.addEventListener('pointerup', onPointerUpAny, true)

  return {
    pop,
    addAnnot, startEdit, removeSelected, applyMarkup, duplicate,
    cancel() { g = null; pending = null },
    destroy() {
      offStore()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('selectionchange', onSelChange)
      document.removeEventListener('pointerdown', onPointerDownAny, true)
      document.removeEventListener('pointerup', onPointerUpAny, true)
      pop.remove()
    },
  }
}

