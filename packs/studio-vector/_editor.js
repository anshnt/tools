// Editor state for Vector Studio: the document, selection, undo/redo, clipboard, view and all document commands.
// Every edit goes through begin()/commit() or tx(), which snapshot the document so Ctrl+Z / Ctrl+Shift+Z always work.
import { tr, sc, rot, about, mul, clamp, makeSmooth, makeCorner } from './_geom.js'
import { newDoc, mk, find, get, walk, leaves, lineage, cloneNode, topSelected, bboxOf, bboxOfAll, applyMatrix, convertToPath, applyStyle, styleOf, DEFAULT_STYLE, solid, FONTS } from './_model.js'
import { booleanOp } from './_bool.js'

const MAX_UNDO = 120, MAX_BYTES = 48e6

export class Editor {
  constructor() {
    this.h = {}
    this.doc = newDoc()
    this.sel = []
    this.ctx = null
    this.anchors = new Set()
    this.tool = 'select'
    this.style = structuredClone(DEFAULT_STYLE)
    this.tp = { radius: 0, sides: 6, points: 5, inner: 0.45, smooth: 3, ff: FONTS[0][0], fs: 48, fw: 400, fi: false, ta: 'start' }
    this.grid = { on: false, size: 20, snap: false }
    this.smart = true
    this.view = { x: 0, y: 0, z: 1 }
    this.stage = { w: 800, h: 600 }
    this.alignTo = 'auto'
    this.clip = null
    this.undoStack = []
    this.redoStack = []
    this.pasteCount = 0
  }

  setTool(t) {
    if (this.tool === t) return
    this.tool = t
    if (t !== 'select' && t !== 'direct') this.ctx = null
    this.emit('tool')
  }

  // ----- events -----
  on(ev, fn) { (this.h[ev] ||= new Set()).add(fn); return () => this.h[ev].delete(fn) }
  emit(ev, a) { for (const fn of [...(this.h[ev] || [])]) fn(a) }
  touch() { this.emit('doc') }

  // ----- history -----
  snapshot() { return JSON.stringify(this.doc) }
  begin(label, merge = null) { return { label, merge, before: this.snapshot(), done: false } }
  commit(t) {
    if (t.done) return false
    t.done = true
    const after = this.snapshot()
    if (after === t.before) return false
    const last = this.undoStack.at(-1), now = Date.now()
    if (t.merge && last && last.merge === t.merge && now - last.t < 1500) last.t = now
    else {
      this.undoStack.push({ label: t.label, before: t.before, merge: t.merge, t: now })
      // keep history bounded by step count and by memory (documents with embedded images are large)
      let bytes = this.undoStack.reduce((n, x) => n + x.before.length, 0)
      while (this.undoStack.length > 1 && (this.undoStack.length > MAX_UNDO || bytes > MAX_BYTES)) bytes -= this.undoStack.shift().before.length
    }
    this.redoStack.length = 0
    this.emit('doc'); this.emit('hist'); this.emit('commit')
    return true
  }
  cancel(t) { if (t.done) return; t.done = true; this.restore(t.before) }
  tx(label, fn, merge = null) {
    const t = this.begin(label, merge)
    try { fn() } catch (e) { this.cancel(t); throw e }
    this.commit(t)
    this.emit('doc')
  }
  restore(str) {
    this.doc = JSON.parse(str)
    this.sel = this.sel.filter((id) => get(this.doc, id))
    if (this.ctx && !get(this.doc, this.ctx)) this.ctx = null
    this.anchors = new Set([...this.anchors].filter((k) => this.anchorRef(k)))
    this.emit('doc'); this.emit('sel')
  }
  undo() {
    const e = this.undoStack.pop()
    if (!e) return false
    this.redoStack.push({ label: e.label, snap: this.snapshot() })
    this.restore(e.before)
    this.emit('hist'); this.emit('commit')
    return e.label
  }
  redo() {
    const e = this.redoStack.pop()
    if (!e) return false
    this.undoStack.push({ label: e.label, before: this.snapshot(), t: 0 })
    this.restore(e.snap)
    this.emit('hist'); this.emit('commit')
    return e.label
  }
  /** Step back (n > 0) or forward (n < 0) through history. */
  jump(n) { for (let i = 0; i < Math.abs(n); i++) { if (n > 0) this.undo(); else this.redo() } }
  get undoLabel() { return this.undoStack.at(-1)?.label }
  get redoLabel() { return this.redoStack.at(-1)?.label }

  /** Replace the whole document (New, Open, template); undoable. */
  loadDoc(doc, label = 'Open document') {
    this.tx(label, () => { this.doc = doc })
    this.sel = []; this.ctx = null; this.anchors.clear()
    this.emit('sel'); this.emit('doc')
  }
  /** Replace the document without making an undo step (restoring autosave). */
  resetDoc(doc) {
    this.doc = doc; this.sel = []; this.ctx = null; this.anchors.clear()
    this.undoStack = []; this.redoStack = []
    this.emit('doc'); this.emit('sel'); this.emit('hist')
  }

  // ----- selection -----
  get nodes() { return this.sel.map((id) => get(this.doc, id)).filter(Boolean) }
  get top() { return topSelected(this.doc, this.sel) }
  setSel(ids, keepAnchors = false, syncStyle = true) {
    this.sel = [...new Set(ids)].filter((id) => get(this.doc, id))
    if (!keepAnchors) this.anchors.clear()
    const nodes = this.nodes
    if (syncStyle && nodes.length) {
      const s = styleOf(nodes)
      if (s) { Object.assign(this.style, s); this.emit('style') }
      const tx = leaves({ type: 'group', kids: nodes }).find((n) => n.type === 'text')
      if (tx) for (const k of ['ff', 'fs', 'fw', 'fi', 'ta']) this.tp[k] = tx[k]
    }
    this.emit('sel')
  }
  toggleSel(id) { this.setSel(this.sel.includes(id) ? this.sel.filter((x) => x !== id) : [...this.sel, id]) }
  selectAll() { const list = this.ctx ? get(this.doc, this.ctx)?.kids || [] : this.doc.nodes; this.setSel(list.filter((n) => n.vis && !n.lock).map((n) => n.id)) }
  clearSel() { this.setSel([]) }
  /** The node a click on leaf `id` should select given the current group context. */
  pick(id) {
    const chain = lineage(this.doc, id)
    if (!chain.length) return null
    if (this.ctx) { const i = chain.findIndex((n) => n.id === this.ctx); if (i >= 0 && chain[i + 1]) return chain[i + 1] }
    return chain[0]
  }
  anchorRef(key) {
    const [id, s, i] = key.split('|')
    const n = get(this.doc, id)
    const sub = n?.type === 'path' && n.subs[+s]
    return sub && sub.pts[+i] ? { node: n, sub, pt: sub.pts[+i], s: +s, i: +i } : null
  }

  // ----- document commands -----
  listForNew() { return (this.ctx && get(this.doc, this.ctx)?.kids) || this.doc.nodes }
  /** Add nodes on top of the current context and select them. Does not create an undo step by itself. */
  add(nodes, select = true) {
    const list = this.listForNew()
    for (const n of [].concat(nodes)) list.push(n)
    if (select) this.setSel([].concat(nodes).map((n) => n.id), false, false)
    this.touch()
  }
  remove(ids) {
    const set = new Set(ids)
    const strip = (list) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (set.has(list[i].id)) list.splice(i, 1)
        else if (list[i].kids) { strip(list[i].kids); if (!list[i].kids.length) list.splice(i, 1) }
      }
    }
    strip(this.doc.nodes)
    if (this.ctx && !get(this.doc, this.ctx)) this.ctx = null
    this.sel = this.sel.filter((id) => get(this.doc, id))
    this.anchors.clear()
  }
  deleteSelection() {
    if (!this.sel.length) return
    this.tx('Delete', () => this.remove(this.sel))
    this.emit('sel')
  }
  copy() {
    const nodes = this.top
    if (!nodes.length) return false
    this.clip = JSON.stringify(nodes)
    this.pasteCount = 0
    return true
  }
  paste(inPlace = false) {
    if (!this.clip) return false
    const nodes = JSON.parse(this.clip).map((n) => cloneNode(this.doc, n))
    const off = inPlace ? 0 : 12 * ++this.pasteCount
    this.tx('Paste', () => { for (const n of nodes) applyMatrix(n, tr(off, off)); this.add(nodes) })
    return true
  }
  cut() { if (this.copy()) this.deleteSelection() }
  duplicate() {
    const nodes = this.top.map((n) => cloneNode(this.doc, n))
    if (!nodes.length) return
    this.tx('Duplicate', () => { for (const n of nodes) applyMatrix(n, tr(10, 10)); this.add(nodes) })
  }

  group(clip = false) {
    const nodes = this.top
    if (nodes.length < 2) return false
    this.tx(clip ? 'Make clipping mask' : 'Group', () => {
      const order = new Map(); let k = 0
      walk(this.doc.nodes, (n) => { order.set(n.id, k++) })
      nodes.sort((a, b) => order.get(a.id) - order.get(b.id))
      const topNode = nodes.at(-1), where = find(this.doc, topNode.id)
      const ids = new Set(nodes.map((n) => n.id))
      const before = where.list.slice(0, where.index).filter((n) => !ids.has(n.id)).length
      const list = where.list
      const g = mk(this.doc, 'group', { kids: nodes })
      if (clip) {
        g.clip = true // the top-most object becomes the mask; it keeps its outline but no longer paints
        const m = nodes.at(-1)
        for (const l of leaves(m)) if (l.type !== 'image') { l.fill = null; l.stroke = null }
      }
      const strip = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { if (ids.has(arr[i].id)) arr.splice(i, 1); else if (arr[i].kids) strip(arr[i].kids) } }
      strip(this.doc.nodes)
      list.splice(before, 0, g)
      this.setSel([g.id])
    })
    return true
  }
  /** Release clipping masks (and ungroup plain groups) among the selection. */
  ungroup() {
    const groups = this.top.filter((n) => n.type === 'group')
    if (!groups.length) return
    const out = []
    this.tx('Ungroup', () => {
      for (const g of groups) {
        const w = find(this.doc, g.id)
        if (!w) continue
        if (g.clip) for (const l of leaves(g.kids.at(-1))) if (l.type !== 'image' && !l.fill && !l.stroke) l.stroke = solid('#1b1b2f') // a released mask shows its outline
        for (const k of g.kids) { if (g.op < 1) k.op = k.op * g.op; out.push(k.id) }
        w.list.splice(w.index, 1, ...g.kids)
      }
      this.setSel(out)
    })
  }
  /** order: 'front' | 'back' | 'forward' | 'backward' */
  order(kind) {
    const nodes = this.top
    if (!nodes.length) return
    this.tx('Arrange', () => {
      const byList = new Map()
      for (const n of nodes) { const w = find(this.doc, n.id); if (!byList.has(w.list)) byList.set(w.list, []); byList.get(w.list).push(n) }
      for (const [list, items] of byList) {
        const set = new Set(items)
        if (kind === 'front') { const rest = list.filter((n) => !set.has(n)); list.splice(0, list.length, ...rest, ...list.filter((n) => set.has(n))) }
        else if (kind === 'back') { const rest = list.filter((n) => !set.has(n)); list.splice(0, list.length, ...list.filter((n) => set.has(n)), ...rest) }
        else if (kind === 'forward') { for (let i = list.length - 2; i >= 0; i--) if (set.has(list[i]) && !set.has(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]] }
        else for (let i = 1; i < list.length; i++) if (set.has(list[i]) && !set.has(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]]
      }
    })
  }
  /** Move a node next to (or into) another: where = 'before' | 'after' | 'into' (before/after are in z-order: after = above). */
  moveNode(id, targetId, where) {
    if (id === targetId) return
    const src = find(this.doc, id), dst = find(this.doc, targetId)
    if (!src || !dst) return
    if (lineage(this.doc, targetId).some((n) => n.id === id)) return // cannot drop a group into itself
    this.tx('Move layer', () => {
      src.list.splice(src.index, 1)
      const d = find(this.doc, targetId)
      if (where === 'into' && d.node.type === 'group') d.node.kids.push(src.node)
      else d.list.splice(d.index + (where === 'after' ? 1 : 0), 0, src.node)
      this.sel = this.sel.filter((x) => get(this.doc, x))
    })
  }
  rename(id, name) { const n = get(this.doc, id); if (n && n.name !== name) this.tx('Rename', () => { n.name = name }) }
  toggle(id, key) { const n = get(this.doc, id); if (n) this.tx(key === 'vis' ? 'Show or hide' : 'Lock or unlock', () => { n[key] = !n[key] }) }

  // ----- appearance -----
  setStyle(patch, merge = 'style') {
    const nodes = this.nodes
    Object.assign(this.style, patch)
    if (nodes.length) this.tx('Change appearance', () => { for (const n of nodes) applyStyle(n, patch) }, merge)
    this.emit('style')
  }
  setOpacity(v) {
    const nodes = this.nodes
    this.style.op = v
    if (nodes.length) this.tx('Opacity', () => { for (const n of nodes) n.op = v }, 'opacity')
    this.emit('style')
  }
  setRadius(v) {
    this.tp.radius = v
    const rects = leaves({ type: 'group', kids: this.nodes }).filter((n) => n.type === 'rect')
    if (rects.length) this.tx('Corner radius', () => { for (const r of rects) { r.rx = v; r.ry = v } }, 'radius')
    this.emit('style')
  }
  /** Text settings: ff, fs, fw, fi, ta (also remembered for new text) and lh, ls, text (selected text only). */
  setText(patch, merge = 'text') {
    for (const k of ['ff', 'fs', 'fw', 'fi', 'ta']) if (k in patch) this.tp[k] = patch[k]
    const texts = leaves({ type: 'group', kids: this.nodes }).filter((n) => n.type === 'text')
    if (texts.length) this.tx('Edit text', () => { for (const n of texts) Object.assign(n, patch) }, merge)
    this.emit('style')
  }
  swapFillStroke() {
    const f = this.style.fill, s = this.style.stroke
    this.setStyle({ fill: s, stroke: f }, 'swap')
  }

  // ----- transforms -----
  transform(M, label = 'Transform', nodes = this.top, merge = null) {
    if (!nodes.length) return
    this.tx(label, () => { for (const n of nodes) applyMatrix(n, M) }, merge)
  }
  box() { return bboxOfAll(this.top) }
  nudge(dx, dy) {
    if (this.anchors.size) { this.moveAnchors(dx, dy, 'Nudge', 'nudge'); return }
    this.transform(tr(dx, dy), 'Nudge', this.top, 'nudge')
  }
  setBox({ x, y, w, h }) {
    const B = this.box()
    if (!B) return
    const sx = w != null && B.w > 1e-6 && w > 0 ? w / B.w : 1, sy = h != null && B.h > 1e-6 && h > 0 ? h / B.h : 1
    const nx = x ?? B.x, ny = y ?? B.y
    this.transform(mul(tr(nx, ny), mul(sc(sx, sy), tr(-B.x, -B.y))), 'Transform', this.top, 'box')
  }
  rotateBy(deg) {
    const B = this.box()
    if (B) this.transform(about(rot((deg * Math.PI) / 180), B.x + B.w / 2, B.y + B.h / 2), 'Rotate')
  }
  flip(axis) {
    const B = this.box()
    if (!B) return
    const cx = B.x + B.w / 2, cy = B.y + B.h / 2
    this.transform(about(axis === 'h' ? sc(-1, 1) : sc(1, -1), cx, cy), 'Flip')
  }

  // ----- align and distribute -----
  alignRef() {
    const nodes = this.top
    const useBoard = this.alignTo === 'artboard' || (this.alignTo === 'auto' && nodes.length < 2)
    return useBoard ? { x: 0, y: 0, w: this.doc.ab.w, h: this.doc.ab.h } : bboxOfAll(nodes)
  }
  align(kind) {
    const nodes = this.top
    if (!nodes.length) return
    const R = this.alignRef()
    this.tx('Align', () => {
      for (const n of nodes) {
        const b = bboxOf(n)
        if (!b) continue
        let dx = 0, dy = 0
        if (kind === 'left') dx = R.x - b.x
        else if (kind === 'hcenter') dx = R.x + R.w / 2 - (b.x + b.w / 2)
        else if (kind === 'right') dx = R.x + R.w - (b.x + b.w)
        else if (kind === 'top') dy = R.y - b.y
        else if (kind === 'vcenter') dy = R.y + R.h / 2 - (b.y + b.h / 2)
        else if (kind === 'bottom') dy = R.y + R.h - (b.y + b.h)
        if (dx || dy) applyMatrix(n, tr(dx, dy))
      }
    })
  }
  /** kind: 'hspace' | 'vspace' | 'hcenter' | 'vcenter' (needs 3 or more objects). */
  distribute(kind) {
    const items = this.top.map((n) => ({ n, b: bboxOf(n) })).filter((i) => i.b)
    if (items.length < 3) return false
    const horiz = kind.startsWith('h')
    const pos = (b) => (horiz ? b.x : b.y), size = (b) => (horiz ? b.w : b.h)
    this.tx('Distribute', () => {
      if (kind.endsWith('center')) {
        items.sort((a, b) => pos(a.b) + size(a.b) / 2 - (pos(b.b) + size(b.b) / 2))
        const c0 = pos(items[0].b) + size(items[0].b) / 2, c1 = pos(items.at(-1).b) + size(items.at(-1).b) / 2
        items.forEach((it, i) => { const d = c0 + ((c1 - c0) * i) / (items.length - 1) - (pos(it.b) + size(it.b) / 2); if (d) applyMatrix(it.n, horiz ? tr(d, 0) : tr(0, d)) })
      } else {
        items.sort((a, b) => pos(a.b) - pos(b.b))
        const start = pos(items[0].b), end = pos(items.at(-1).b) + size(items.at(-1).b)
        const gap = (end - start - items.reduce((s, it) => s + size(it.b), 0)) / (items.length - 1)
        let cur = start
        for (const it of items) { const d = cur - pos(it.b); if (d) applyMatrix(it.n, horiz ? tr(d, 0) : tr(0, d)); cur += size(it.b) + gap }
      }
    })
    return true
  }

  // ----- path editing -----
  /** Make sure `n` is a path (converts rects and ellipses). Call inside a transaction. */
  ensurePath(n) { return n.type === 'path' || convertToPath(n) }
  convertSelectionToPath() {
    const t = leaves({ type: 'group', kids: this.top }).filter((n) => n.type === 'rect' || n.type === 'ellipse')
    if (!t.length) return false
    this.tx('Convert to path', () => { for (const n of t) convertToPath(n) })
    return true
  }
  moveAnchors(dx, dy, label = 'Move points', merge = null) {
    const refs = [...this.anchors].map((k) => this.anchorRef(k)).filter(Boolean)
    if (!refs.length) return
    this.tx(label, () => { for (const r of refs) { r.pt.x += dx; r.pt.y += dy } }, merge)
  }
  deleteAnchors() {
    const keys = [...this.anchors]
    if (!keys.length) return false
    this.tx('Delete points', () => {
      const bySub = new Map()
      for (const k of keys) { const r = this.anchorRef(k); if (!r) continue; const id = r.node.id + '|' + r.s; if (!bySub.has(id)) bySub.set(id, { node: r.node, s: r.s, idx: [] }); bySub.get(id).idx.push(r.i) }
      const dead = new Set()
      for (const { node, s, idx } of bySub.values()) {
        const sub = node.subs[s]
        sub.pts = sub.pts.filter((_, i) => !idx.includes(i))
        if (sub.pts.length < 2) dead.add(sub)
        else if (sub.pts.length < 3 && sub.closed) sub.closed = false
        node.subs = node.subs.filter((x) => !dead.has(x))
        if (!node.subs.length) this.remove([node.id])
      }
      this.anchors.clear()
    })
    this.emit('sel')
    return true
  }
  setSmooth(smooth) {
    const refs = [...this.anchors].map((k) => this.anchorRef(k)).filter(Boolean)
    if (!refs.length) return
    this.tx(smooth ? 'Smooth points' : 'Corner points', () => { for (const r of refs) smooth ? makeSmooth(r.sub, r.i) : makeCorner(r.pt) })
  }
  closeOpenPaths() {
    const ps = leaves({ type: 'group', kids: this.top }).filter((n) => n.type === 'path' && n.subs.some((s) => !s.closed))
    if (!ps.length) return
    this.tx('Close path', () => { for (const n of ps) for (const s of n.subs) s.closed = s.pts.length > 2 })
  }

  async boolean(op) {
    const order = new Map(); let k = 0
    walk(this.doc.nodes, (n) => { order.set(n.id, k++) })
    const items = leaves({ type: 'group', kids: this.top }).filter((n) => n.vis)
    const shapes = items.filter((n) => n.type === 'path' || n.type === 'rect' || n.type === 'ellipse').sort((a, b) => order.get(a.id) - order.get(b.id))
    if (shapes.length < 2) throw new Error('Select two or more shapes first. Text and images cannot be combined; convert text to shapes first.')
    const subs = await booleanOp(shapes, op)
    if (!subs.length) throw new Error('The result is empty: the shapes do not overlap in the way this operation needs.')
    const base = op === 'subtract' ? shapes[0] : shapes.at(-1)
    const label = { unite: 'Unite', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' }[op]
    this.tx(label, () => {
      const keep = get(this.doc, base.id)
      convertToPath(keep)
      keep.type = 'path'; keep.subs = subs
      for (const k of ['x', 'y', 'w', 'h', 'rx', 'ry', 'cx', 'cy', 't']) delete keep[k]
      if (!keep.fill && !keep.stroke) keep.fill = solid('#000000')
      keep.rule = 'nonzero'
      this.remove(shapes.filter((n) => n.id !== base.id).map((n) => n.id))
      this.setSel([keep.id])
    })
  }

  // ----- artboard -----
  setArtboard(patch, merge = 'artboard') {
    this.tx('Artboard', () => { Object.assign(this.doc.ab, patch) }, merge)
  }
  contentBox() { return this.doc.nodes.reduce((acc, n) => { const b = bboxOf(n); return !acc ? b : b ? { x: Math.min(acc.x, b.x), y: Math.min(acc.y, b.y), w: Math.max(acc.x + acc.w, b.x + b.w) - Math.min(acc.x, b.x), h: Math.max(acc.y + acc.h, b.y + b.h) - Math.min(acc.y, b.y) } : acc }, null) }
  fitArtboardToContent(pad = 20) {
    const B = this.contentBox()
    if (!B) return
    this.tx('Fit artboard to artwork', () => {
      const w = Math.max(1, Math.ceil(B.w + pad * 2)), h = Math.max(1, Math.ceil(B.h + pad * 2))
      const M = tr(pad - B.x, pad - B.y)
      for (const n of this.doc.nodes) applyMatrix(n, M)
      this.doc.ab.w = w; this.doc.ab.h = h
    })
  }

  // ----- view -----
  setView(v) { Object.assign(this.view, v); this.emit('view') }
  fit(pad = 40) {
    const { w, h } = this.stage, { ab } = this.doc
    const z = clamp(Math.min((w - pad * 2) / ab.w, (h - pad * 2) / ab.h), 0.02, 32)
    this.setView({ z, x: (w - ab.w * z) / 2, y: (h - ab.h * z) / 2 })
  }
  zoomAt(factor, sx = this.stage.w / 2, sy = this.stage.h / 2) {
    const z = clamp(this.view.z * factor, 0.02, 64)
    const k = z / this.view.z
    this.setView({ z, x: sx - (sx - this.view.x) * k, y: sy - (sy - this.view.y) * k })
  }
  zoomTo(z) { this.zoomAt(z / this.view.z) }
  toWorld(sx, sy) { return { x: (sx - this.view.x) / this.view.z, y: (sy - this.view.y) / this.view.z } }
  toScreen(x, y) { return [x * this.view.z + this.view.x, y * this.view.z + this.view.y] }
}
