// Editing actions: insert, delete, duplicate, copy/paste, z-order, align, nudge, slide-level settings.
import { toast } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import { uid, clone, bboxOf, imageEl, tableEl, clamp, SIZES } from './_model.js'
import { applyLayout, applyTheme } from './_themes.js'

export function createActions(app) {
  const { store } = app
  const slide = () => store.slide
  const sel = () => store.selected

  const a = {
    addElement(el, label = 'Insert') {
      store.edit(label, (d, s) => { s.slide.elements.push(el); s.sel = [el.id] })
      return el
    },
    deleteSelected() {
      const ids = new Set(store.sel)
      if (!ids.size) return false
      store.edit('Delete', (d, s) => { s.slide.elements = s.slide.elements.filter((e) => !ids.has(e.id)); s.sel = [] })
      return true
    },
    selectAll() { store.select(slide().elements.map((e) => e.id)) },
    copy() {
      if (!sel().length) return false
      app.clip = { els: clone(sel()), n: 0 }
      toast(`Copied ${sel().length === 1 ? 'object' : `${sel().length} objects`}`)
      return true
    },
    cut() { if (a.copy()) a.deleteSelected() },
    paste() {
      if (!app.clip) return false
      app.clip.n++
      const off = 18 * app.clip.n
      const els = clone(app.clip.els).map((e) => ({ ...e, id: uid(), x: e.x + off, y: e.y + off }))
      for (const e of els) delete e.ph // a pasted placeholder is just a text box
      store.edit('Paste', (d, s) => { s.slide.elements.push(...els); s.sel = els.map((e) => e.id) })
      return true
    },
    duplicate() {
      if (!sel().length) return false
      const els = clone(sel()).map((e) => { const x = { ...e, id: uid(), x: e.x + 18, y: e.y + 18 }; delete x.ph; return x })
      store.edit('Duplicate', (d, s) => { s.slide.elements.push(...els); s.sel = els.map((e) => e.id) })
      return true
    },
    nudge(dx, dy) {
      if (!sel().length) return
      store.edit('Nudge', () => { for (const e of sel()) { e.x = Math.round((e.x + dx) * 10) / 10; e.y = Math.round((e.y + dy) * 10) / 10 } }, 'slide', true)
    },
    order(how) { // front | back | forward | backward
      const ids = new Set(store.sel)
      if (!ids.size) return
      store.edit('Arrange', (d, s) => {
        const els = s.slide.elements
        const picked = els.filter((e) => ids.has(e.id)), rest = els.filter((e) => !ids.has(e.id))
        if (how === 'front') s.slide.elements = [...rest, ...picked]
        else if (how === 'back') s.slide.elements = [...picked, ...rest]
        else {
          const out = [...els]
          const step = how === 'forward' ? 1 : -1
          const idx = out.map((e, i) => (ids.has(e.id) ? i : -1)).filter((i) => i >= 0)
          for (const i of step > 0 ? idx.reverse() : idx) {
            const j = i + step
            if (j < 0 || j >= out.length || ids.has(out[j].id)) continue;
            [out[i], out[j]] = [out[j], out[i]]
          }
          s.slide.elements = out
        }
      })
    },
    align(kind) { // left center right top middle bottom
      const els = sel()
      if (!els.length) return
      const W = store.deck.w, H = store.deck.h
      const box = els.length === 1 ? { x: 0, y: 0, w: W, h: H } : bboxOf(els)
      store.edit('Align', () => {
        for (const e of els) {
          if (kind === 'left') e.x = box.x
          else if (kind === 'center') e.x = box.x + (box.w - e.w) / 2
          else if (kind === 'right') e.x = box.x + box.w - e.w
          else if (kind === 'top') e.y = box.y
          else if (kind === 'middle') e.y = box.y + (box.h - e.h) / 2
          else if (kind === 'bottom') e.y = box.y + box.h - e.h
          e.x = Math.round(e.x * 10) / 10; e.y = Math.round(e.y * 10) / 10
        }
      })
    },
    distribute(axis) { // h | v
      const els = [...sel()].sort((p, q) => (axis === 'h' ? p.x - q.x : p.y - q.y))
      if (els.length < 3) return
      store.edit('Distribute', () => {
        const first = els[0], last = els.at(-1)
        const total = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y
        const used = els.reduce((s, e) => s + (axis === 'h' ? e.w : e.h), 0)
        const gap = (total - used) / (els.length - 1)
        let pos = axis === 'h' ? first.x : first.y
        for (const e of els) { if (axis === 'h') e.x = Math.round(pos * 10) / 10; else e.y = Math.round(pos * 10) / 10; pos += (axis === 'h' ? e.w : e.h) + gap }
      })
    },

    // ----- images and tables -----
    async pickImage(forId) {
      const files = await pickFiles({ accept: 'image/*', multiple: !forId })
      if (files.length) await a.insertImages(files, { forId })
    },
    async insertImages(files, { forId, at } = {}) {
      files = [...files].filter((f) => /^image\//.test(f.type) || /\.(heic|heif|avif|webp|png|jpe?g|gif|bmp|svg)$/i.test(f.name))
      if (!files.length) return false
      let n = 0
      for (const f of files) {
        try {
          const id = await store.addImageFile(f)
          const as = store.asset(id)
          const target = forId && slide().elements.find((e) => e.id === forId && e.type === 'image')
          if (target) {
            store.edit('Replace image', () => { target.asset = id; target.alt ||= f.name.replace(/\.[^.]+$/, ''); store.sel = [target.id] })
          } else {
            const { w, h } = app.stage.insertSize(as.w, as.h)
            const cx = at?.x ?? store.deck.w / 2, cy = at?.y ?? store.deck.h / 2
            const off = n * 24
            a.addElement(imageEl(id, { w, h, x: clamp(cx - w / 2 + off, 0, store.deck.w - 20), y: clamp(cy - h / 2 + off, 0, store.deck.h - 20), alt: f.name.replace(/\.[^.]+$/, '') }), 'Insert image')
          }
          n++
        } catch (e) {
          toast(`${f.name}: ${e.message || 'could not be read'}`, 'error')
        }
      }
      return n > 0
    },
    insertTable(rows, cols) {
      const W = store.deck.w, H = store.deck.h
      const t = tableEl(rows, cols, { w: Math.min(W * 0.8, cols * 150), h: rows * 44, size: 18 })
      t.x = (W - t.w) / 2; t.y = Math.max(H * 0.28, (H - t.h) / 2)
      a.addElement(t, 'Insert table')
    },
    tableOp(op) {
      const t = sel().find((e) => e.type === 'table')
      if (!t) return
      store.edit('Edit table', () => {
        const cols = t.cells[0].length
        if (op === 'addRow') { t.cells.push(Array(cols).fill('')); t.h += t.h / (t.cells.length - 1) }
        else if (op === 'delRow' && t.cells.length > 1) { t.h -= t.h / t.cells.length; t.cells.pop() }
        else if (op === 'addCol') { t.cells.forEach((r) => r.push('')); t.colw = [...t.colw.map((w) => (w * cols) / (cols + 1)), 1 / (cols + 1)] }
        else if (op === 'delCol' && cols > 1) { t.cells.forEach((r) => r.pop()); const rest = t.colw.slice(0, -1); const s = rest.reduce((x, y) => x + y, 0); t.colw = rest.map((w) => w / s) }
      })
    },

    // ----- slide-level settings -----
    setLayout(id) { store.edit('Change layout', (d, s) => applyLayout(d, s.slide, id), 'deck') },
    setTheme(id) { store.edit('Change theme', (d) => applyTheme(d, id), 'deck') },
    setSize(id) {
      const sz = SIZES.find((x) => x[0] === id)
      if (!sz || sz[2] === store.deck.w) return
      store.edit('Slide size', (d) => {
        const k = sz[2] / d.w
        for (const s of d.slides) for (const e of s.elements) { e.x *= k; e.w *= k }
        d.w = sz[2]; d.h = sz[3]
      }, 'deck')
    },
    setTransition(tr, all = false) { store.edit('Transition', (d, s) => { for (const sl of all ? d.slides : [s.slide]) sl.tr = tr }, 'meta') },
    setBackground(c, all = false) {
      store.edit('Background', (d, s) => { for (const sl of all ? d.slides : [s.slide]) sl.bg = c ? { c1: c } : null }, 'deck')
    },
    newSlideWith(layout) { store.addSlide(layout) },
  }
  return a
}
