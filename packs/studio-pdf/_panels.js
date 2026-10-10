// Side panels: page thumbnails (organize), properties inspector, comments list, document info and the search bar.
import { h, icon, button, field, toggle, segmented, rangeField, input, textarea, toast, yieldToMain, debounce, formatBytes } from '../../lib/ui.js'
import { dispSize, clamp } from './_geom.js'
import { PALETTE, LABELS, FONTS, hasComment, makeAnnot } from './_annots.js'
import { loadItems, flatten, findAll, rangeRects } from './_text.js'
import { TOOL_LIST } from './_tools.js'

/** Small icon button with a tooltip. */
export const ibtn = (ic, label, onClick, extra = {}) => h('button', { type: 'button', class: ['pbtn', extra.class], 'data-tip': extra.tip || label, 'aria-label': label, onclick: onClick, disabled: extra.disabled }, icon(ic))

// ---------- thumbnails / organize ----------
export function createThumbs(app) {
  const { store, viewer } = app
  const list = h('div', { class: 'thumbs', role: 'listbox', 'aria-label': 'Pages', 'aria-multiselectable': 'true' })
  const count = h('span', { class: 'th-count' })
  const cache = new Map() // pid -> {key, canvas}
  let anchor = null, dragIds = null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  const targets = () => (store.thumbSel.size ? store.state.pages.filter((p) => store.thumbSel.has(p.id)).map((p) => p.id) : [store.state.pages[viewer.current]?.id].filter(Boolean))

  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); renderThumb(e.target) } }, { root: list, rootMargin: '200px 0px' })
  async function renderThumb(th) {
    const p = store.page(th.dataset.pid)
    if (!p) return
    const key = `${p.src}|${p.rot}`
    const hit = cache.get(p.id)
    const slot = th.querySelector('.th-img')
    if (hit?.key === key) { slot.replaceChildren(hit.canvas); return }
    const canvas = h('canvas', { class: 'th-canvas' })
    try {
      if (p.src == null) {
        const [dw, dh] = dispSize(p.rot, p.w, p.h)
        canvas.width = Math.round(dw * 0.4); canvas.height = Math.round(dh * 0.4)
        const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height)
      } else {
        const done = app.doc.hold(p.src)
        try {
          const page = await app.doc.page(p.src)
          const rotation = (page.rotate + p.rot) % 360
          const v0 = page.getViewport({ scale: 1, rotation })
          const vp = page.getViewport({ scale: (150 / Math.max(v0.width, v0.height)) * dpr, rotation })
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height)
          const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height)
          await page.render({ canvasContext: c, canvas, viewport: vp }).promise
        } finally { done() }
      }
    } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e) }
    cache.set(p.id, { key, canvas })
    if (th.isConnected) th.querySelector('.th-img').replaceChildren(canvas)
  }

  function render() {
    const pages = store.state.pages
    count.textContent = pages.length ? `${pages.length} page${pages.length === 1 ? '' : 's'}` : ''
    const alive = new Set(pages.map((p) => p.id))
    for (const k of cache.keys()) if (!alive.has(k)) cache.delete(k)
    list.replaceChildren(...pages.map((p, i) => {
      const [dw, dh] = dispSize(p.rot, p.w, p.h)
      const th = h('div', {
        class: 'th', role: 'option', tabindex: 0, draggable: true, dataset: { pid: p.id }, 'aria-label': `Page ${i + 1}`,
        onclick: (e) => select(p.id, e), ondblclick: () => viewer.goto(i),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.id, e) } else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(-1) } else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(1) } else if (e.key === 'Delete') { e.preventDefault(); del() }
        },
        ondragstart: (e) => { dragIds = store.thumbSel.has(p.id) ? targets() : [p.id]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'page'); th.classList.add('dragging') },
        ondragend: () => { dragIds = null; th.classList.remove('dragging'); for (const x of list.children) x.classList.remove('over-before', 'over-after') },
        ondragover: (e) => {
          if (!dragIds) return
          e.preventDefault()
          const r = th.getBoundingClientRect(), before = e.clientY < r.top + r.height / 2
          th.classList.toggle('over-before', before); th.classList.toggle('over-after', !before)
        },
        ondragleave: () => th.classList.remove('over-before', 'over-after'),
        ondrop: (e) => {
          if (!dragIds) return
          e.preventDefault()
          const r = th.getBoundingClientRect()
          reorder(dragIds, p.id, e.clientY < r.top + r.height / 2)
          dragIds = null
        },
      }, h('div', { class: 'th-img', style: { aspectRatio: `${dw} / ${dh}` } }), h('div', { class: 'th-num' }, i + 1))
      io.observe(th)
      return th
    }))
    syncSel()
  }
  function syncSel() {
    const cur = store.state.pages[viewer.current]?.id
    for (const th of list.children) {
      const on = store.thumbSel.has(th.dataset.pid)
      th.classList.toggle('sel', on)
      th.classList.toggle('cur', th.dataset.pid === cur)
      th.setAttribute('aria-selected', String(on))
    }
    const c = list.querySelector('.th.cur')
    if (c) {
      const lr = list.getBoundingClientRect(), cr = c.getBoundingClientRect()
      if (cr.top < lr.top) list.scrollTop -= lr.top - cr.top + 8
      else if (cr.bottom > lr.bottom) list.scrollTop += cr.bottom - lr.bottom + 8
      if (cr.left < lr.left) list.scrollLeft -= lr.left - cr.left + 8
      else if (cr.right > lr.right) list.scrollLeft += cr.right - lr.right + 8
    }
  }
  function select(pid, e) {
    const pages = store.state.pages
    if (e.shiftKey && anchor) {
      const a = store.pageIndex(anchor), b = store.pageIndex(pid)
      store.thumbSel = new Set(pages.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.id))
    } else if (e.ctrlKey || e.metaKey) {
      const s = new Set(store.thumbSel)
      s.has(pid) ? s.delete(pid) : s.add(pid)
      store.thumbSel = s; anchor = pid
    } else {
      store.thumbSel = new Set([pid]); anchor = pid
      viewer.gotoPid(pid)
    }
    syncSel()
  }

  // ---- commands ----
  function rotate(dir) {
    const ids = new Set(targets())
    if (!ids.size) return
    store.commit('Rotate pages', (s) => { for (const p of s.pages) if (ids.has(p.id)) p.rot = (p.rot + dir * 90 + 360) % 360 })
  }
  function del() {
    const ids = new Set(targets())
    if (!ids.size) return
    if (ids.size >= store.state.pages.length) return toast('A document needs at least one page.', 'error')
    store.commit(`Delete ${ids.size} page${ids.size === 1 ? '' : 's'}`, (s) => {
      s.pages = s.pages.filter((p) => !ids.has(p.id))
      s.annots = s.annots.filter((a) => !ids.has(a.pid))
    })
    store.thumbSel = new Set()
    toast(`Deleted ${ids.size} page${ids.size === 1 ? '' : 's'}. Undo with Ctrl+Z.`, 'info', 2500)
  }
  function blank() {
    const ids = targets()
    const pages = store.state.pages
    const refId = ids.length ? ids.at(-1) : pages[viewer.current]?.id
    const ref = store.page(refId)
    if (!ref) return
    const [dw, dh] = dispSize(ref.rot, ref.w, ref.h)
    const np = store.newPage({ src: null, w: dw, h: dh })
    store.commit('Insert blank page', (s) => { s.pages.splice(s.pages.findIndex((p) => p.id === refId) + 1, 0, np) })
    store.thumbSel = new Set([np.id])
    setTimeout(() => viewer.gotoPid(np.id), 0)
  }
  function move(dir) {
    const ids = new Set(targets())
    if (!ids.size) return
    store.commit('Move pages', (s) => {
      const arr = s.pages
      if (dir < 0) for (let i = 1; i < arr.length; i++) { if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]] }
      else for (let i = arr.length - 2; i >= 0; i--) { if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]] }
    })
  }
  function reorder(ids, targetPid, before) {
    const moving = new Set(ids)
    if (moving.has(targetPid)) return
    store.commit('Reorder pages', (s) => {
      const picked = s.pages.filter((p) => moving.has(p.id))
      const rest = s.pages.filter((p) => !moving.has(p.id))
      const at = rest.findIndex((p) => p.id === targetPid) + (before ? 0 : 1)
      rest.splice(at, 0, ...picked)
      s.pages = rest
    })
  }

  const head = h('div', { class: 'panel-head' },
    h('div', { class: 'ph-title' }, h('strong', 'Pages'), count),
    h('div', { class: 'ph-actions' },
      ibtn('rotate-ccw', 'Rotate left', () => rotate(-1)), ibtn('rotate-cw', 'Rotate right', () => rotate(1)),
      ibtn('file-plus-2', 'Insert blank page after', blank), ibtn('arrow-up', 'Move up (Alt+Up)', () => move(-1)), ibtn('arrow-down', 'Move down (Alt+Down)', () => move(1)),
      ibtn('trash-2', 'Delete page (Del)', del, { class: 'danger' })))
  const el = h('div', { class: 'thumbs-panel' }, head,
    h('div', { class: 'small muted ph-hint' }, 'Click to select, Ctrl or Shift for several. Drag to reorder.'), list)

  const off = store.on((type, d) => {
    if (type === 'change') {
      const sig = store.state.pages.map((p) => `${p.id}:${p.rot}:${p.src}`).join('|')
      if (sig !== render.sig) { render.sig = sig; render() }
    }
  })
  return { el, render, syncSel, rotate, del, blank, move, destroy: () => { off(); io.disconnect() }, reset() { cache.clear(); render.sig = ''; render() } }
}

// ---------- colour swatches ----------
function swatches(value, onChange, { none = false, label } = {}) {
  const box = h('div', { class: 'swatches', role: 'group', 'aria-label': label || 'Colour' })
  const set = (v) => { for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); custom.value = /^#[0-9a-f]{6}$/i.test(v || '') ? v : custom.value }
  const custom = h('input', { type: 'color', class: 'sw-custom', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#2563eb', 'aria-label': `${label || 'Colour'} (custom)`, oninput: (e) => { set(e.target.value); onChange(e.target.value) } })
  if (none) box.append(h('button', { type: 'button', class: 'sw sw-none', dataset: { v: 'null' }, 'aria-label': 'None', 'data-tip': 'None', onclick: () => { set(null); onChange(null) } }))
  for (const c of PALETTE) box.append(h('button', { type: 'button', class: 'sw', dataset: { v: c }, style: { '--c': c }, 'aria-label': c, onclick: () => { set(c); onChange(c) } }))
  box.append(custom)
  set(value)
  return box
}

// ---------- properties ----------
export function createProps(app) {
  const { store } = app
  const el = h('div', { class: 'props' })

  function setProp(a, key, val, label) {
    app.styles[a.type] = { ...app.styles[a.type], [key]: val }
    store.commit(`Edit ${label || key}`, (s) => { const x = s.annots.find((q) => q.id === a.id); if (x) x[key] = val }, { coalesce: `prop:${a.id}:${key}`, pids: [a.pid] })
  }
  function control(a, key, kind, label, opts = {}) {
    const get = () => a[key]
    if (kind === 'color') return field(label, swatches(get(), (v) => setProp(a, key, v, label), { none: opts.none, label }))
    if (kind === 'range') return rangeField(label, { min: opts.min, max: opts.max, step: opts.step, value: get() ?? opts.min, format: opts.format, onInput: (v) => setProp(a, key, v, label) })
    return null
  }
  function sectionFor(a) {
    const t = a.type
    const out = []
    if (t === 'highlight') out.push(control(a, 'color', 'color', 'Colour'), control(a, 'opacity', 'range', 'Opacity', { min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }))
    else if (t === 'underline' || t === 'strike') out.push(control(a, 'color', 'color', 'Colour'))
    else if (t === 'ink') out.push(control(a, 'color', 'color', 'Colour'), control(a, 'width', 'range', 'Thickness', { min: 1, max: 24, step: 0.5, format: (v) => `${v} pt` }), control(a, 'opacity', 'range', 'Opacity', { min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }))
    else if (t === 'rect' || t === 'ellipse') out.push(control(a, 'stroke', 'color', 'Outline'), control(a, 'fill', 'color', 'Fill', { none: true }), control(a, 'width', 'range', 'Thickness', { min: 0.5, max: 20, step: 0.5, format: (v) => `${v} pt` }), control(a, 'opacity', 'range', 'Opacity', { min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }))
    else if (t === 'line' || t === 'arrow') out.push(control(a, 'stroke', 'color', 'Colour'), control(a, 'width', 'range', 'Thickness', { min: 0.5, max: 20, step: 0.5, format: (v) => `${v} pt` }), control(a, 'opacity', 'range', 'Opacity', { min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }))
    else if (t === 'note') out.push(control(a, 'color', 'color', 'Colour'))
    else if (t === 'text') {
      out.push(
        field('Text', textarea({ rows: 3, value: a.text || '', 'aria-label': 'Text', oninput: (e) => { store.commit('Edit text', (s) => { const x = s.annots.find((q) => q.id === a.id); x.text = e.target.value }, { coalesce: `text:${a.id}`, pids: [a.pid] }) } })),
        field('Font', segmented(Object.entries(FONTS).map(([k, f]) => [k, f.label]), a.font, (v) => setProp(a, 'font', v, 'font'), 'Font')),
        h('div', { class: 'row' },
          field('Size', h('input', { class: 'input', type: 'number', min: 6, max: 120, step: 1, value: a.size, 'aria-label': 'Font size', oninput: (e) => { const v = clamp(+e.target.value || 14, 6, 120); setProp(a, 'size', v, 'size') } })),
          field('Style', h('div', { class: 'row tight' },
            toggleBtn('bold', 'Bold', a.bold, (v) => setProp(a, 'bold', v, 'bold')), toggleBtn('italic', 'Italic', a.italic, (v) => setProp(a, 'italic', v, 'italic')))),
          field('Align', segmented([['left', 'L'], ['center', 'C'], ['right', 'R']], a.align, (v) => setProp(a, 'align', v, 'alignment'), 'Alignment'))),
        control(a, 'color', 'color', 'Text colour'), control(a, 'fill', 'color', 'Background', { none: true }), control(a, 'border', 'color', 'Border', { none: true }))
    } else if (t === 'whiteout') out.push(h('p', { class: 'small muted' }, 'White-out only covers the area. The text underneath is still in the file. Use Redact to remove it for good.'))
    else if (t === 'redact') out.push(h('p', { class: 'small muted' }, 'Marked for redaction. When you save, everything under this box is removed and the page is rebuilt as an image.'))
    else if (t === 'image') out.push(h('p', { class: 'small muted' }, `${a.kind === 'signature' ? 'Signature' : a.kind === 'stamp' ? 'Stamp' : 'Image'}. Drag the corners to resize.`))
    return out.filter(Boolean)
  }
  const toggleBtn = (ic, label, on, cb) => {
    const b = h('button', { type: 'button', class: 'pbtn tog', 'aria-pressed': String(!!on), 'data-tip': label, 'aria-label': label, onclick: () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); cb(v) } }, icon(ic))
    return b
  }

  function refresh() {
    const a = store.sel && store.annot(store.sel)
    if (a) {
      const actions = h('div', { class: 'row tight actions' },
        button('Duplicate', { icon: 'copy', size: 'sm', onClick: () => app.tools.duplicate(a) }),
        button('To front', { icon: 'bring-to-front', size: 'sm', onClick: () => store.commit('Bring to front', (s) => { const i = s.annots.findIndex((x) => x.id === a.id); s.annots.push(...s.annots.splice(i, 1)) }, { pids: [a.pid] }) }),
        button('To back', { icon: 'send-to-back', size: 'sm', onClick: () => store.commit('Send to back', (s) => { const i = s.annots.findIndex((x) => x.id === a.id); s.annots.unshift(...s.annots.splice(i, 1)) }, { pids: [a.pid] }) }),
        button('Delete', { icon: 'trash-2', size: 'sm', variant: 'danger', onClick: () => app.removeSelected() }))
      const comment = hasComment(a) && a.type !== 'text'
        ? field(a.type === 'note' ? 'Note' : 'Comment', textarea({ rows: 3, id: 'cm-prop', value: a.text || '', placeholder: 'Add a comment...', 'aria-label': 'Comment', oninput: (e) => store.commit('Edit comment', (s) => { const x = s.annots.find((q) => q.id === a.id); x.text = e.target.value }, { coalesce: `text:${a.id}`, pids: [a.pid] }) })) : null
      el.replaceChildren(h('div', { class: 'props-head' }, icon(TOOL_LIST.find((t) => t.id === a.type || (a.type === 'image' && t.id === a.kind))?.icon || 'square'), h('strong', LABELS[a.type]), h('span', { class: 'muted small' }, `Page ${store.pageIndex(a.pid) + 1}`)),
        ...sectionFor(a), comment, actions)
      return
    }
    const tool = store.tool
    const tmpl = TOOL_LIST.find((t) => t.id === tool)
    if (['highlight', 'underline', 'strike', 'ink', 'rect', 'ellipse', 'line', 'arrow', 'note', 'text'].includes(tool)) {
      el.replaceChildren(h('div', { class: 'props-head' }, icon(tmpl.icon), h('strong', `${tmpl.name} settings`)), ...defaultsPanel({ ...app.styleOf(tool) }, tool),
        h('p', { class: 'small muted' }, 'Applies to the next thing you add. Select an existing item to change it.'))
    } else {
      el.replaceChildren(h('div', { class: 'props-empty' }, icon('mouse-pointer-click'), h('strong', tool === 'select' ? 'Nothing selected' : tmpl.name), h('p', { class: 'small muted' }, tool === 'select' ? 'Click an annotation to change its colour, size or comment. Select text to highlight, underline or redact it.' : tmpl.tip)))
    }
  }
  function defaultsPanel(stub, tool) {
    const t = tool
    const set = (k, v) => { app.styles[t] = { ...app.styles[t], [k]: v }; stub[k] = v }
    const col = (k, label, o) => field(label, swatches(stub[k], (v) => set(k, v), { none: o?.none, label }))
    const rg = (k, label, min, max, step, format) => rangeField(label, { min, max, step, value: stub[k] ?? min, format, onInput: (v) => set(k, v) })
    const pct = (v) => `${Math.round(v * 100)}%`, pt = (v) => `${v} pt`
    switch (t) {
      case 'highlight': return [col('color', 'Colour'), rg('opacity', 'Opacity', 0.1, 1, 0.05, pct)]
      case 'underline': case 'strike': return [col('color', 'Colour')]
      case 'ink': return [col('color', 'Colour'), rg('width', 'Thickness', 1, 24, 0.5, pt), rg('opacity', 'Opacity', 0.1, 1, 0.05, pct)]
      case 'rect': case 'ellipse': return [col('stroke', 'Outline'), col('fill', 'Fill', { none: true }), rg('width', 'Thickness', 0.5, 20, 0.5, pt)]
      case 'line': case 'arrow': return [col('stroke', 'Colour'), rg('width', 'Thickness', 0.5, 20, 0.5, pt)]
      case 'note': return [col('color', 'Colour')]
      case 'text': return [
        field('Font', segmented(Object.entries(FONTS).map(([k, f]) => [k, f.label]), stub.font, (v) => set('font', v), 'Font')),
        field('Size', h('input', { class: 'input', type: 'number', min: 6, max: 120, value: stub.size, 'aria-label': 'Font size', oninput: (e) => set('size', clamp(+e.target.value || 14, 6, 120)) })),
        col('color', 'Text colour'), col('fill', 'Background', { none: true })]
      default: return []
    }
  }
  const off = store.on((type, d) => { if (type === 'sel' || type === 'tool' || (type === 'change' && (d.restore || d.reset))) refresh() })
  refresh()
  return { el, refresh, destroy: off }
}

// ---------- comments ----------
export function createComments(app) {
  const { store, viewer } = app
  const list = h('div', { class: 'comments' })
  const el = h('div', { class: 'comments-panel' }, list)
  let sig = ''

  const items = () => {
    const pages = store.state.pages
    return store.state.annots.filter((a) => hasComment(a) && (a.text || a.text === '' || a.type === 'note'))
      .map((a) => ({ a, pi: pages.findIndex((p) => p.id === a.pid) })).filter((x) => x.pi >= 0)
      .sort((p, q) => p.pi - q.pi || (p.a.y ?? p.a.rects?.[0]?.[1] ?? 0) - (q.a.y ?? q.a.rects?.[0]?.[1] ?? 0))
  }
  function refresh(force) {
    const its = items()
    const s = its.map((x) => `${x.a.id}:${x.pi}`).join('|')
    if (!force && s === sig && list.contains(document.activeElement)) return
    sig = s
    app.setBadge?.('comments', its.length)
    if (!its.length) { list.replaceChildren(h('div', { class: 'props-empty' }, icon('message-square-text'), h('strong', 'No comments yet'), h('p', { class: 'small muted' }, 'Add a sticky note, or select any annotation and write a comment. Double-click an item to comment on it.'))); return }
    list.replaceChildren(...its.map(({ a, pi }) => h('div', { class: ['cm', store.sel === a.id && 'sel'], dataset: { id: a.id } },
      h('button', { type: 'button', class: 'cm-head', onclick: () => { store.setTool('select'); store.select(a.id); viewer.gotoPid(a.pid) } },
        icon(a.type === 'note' ? 'message-square' : TOOL_LIST.find((t) => t.id === a.type)?.icon || 'message-square'), h('strong', LABELS[a.type]), h('span', { class: 'muted small' }, `Page ${pi + 1}${a.author ? ` · ${a.author}` : ''}`)),
      textarea({ rows: 2, value: a.text || '', placeholder: 'Write a comment...', 'aria-label': `Comment on ${LABELS[a.type]}, page ${pi + 1}`, oninput: (e) => store.commit('Edit comment', (s2) => { const x = s2.annots.find((q) => q.id === a.id); if (x) x.text = e.target.value }, { coalesce: `text:${a.id}`, pids: [a.pid] }) }),
      h('div', { class: 'row tight' }, button('Delete', { icon: 'trash-2', size: 'sm', variant: 'ghost', onClick: () => { store.commit('Delete comment', (s2) => { s2.annots = s2.annots.filter((q) => q.id !== a.id) }, { pids: [a.pid] }); if (store.sel === a.id) store.select(null) } })))))
  }
  const deb = debounce(refresh, 120)
  const off = store.on((type, d) => { if (type === 'change') deb(); else if (type === 'sel') { for (const c of list.querySelectorAll('.cm')) c.classList.toggle('sel', c.dataset.id === store.sel) } })
  refresh(true)
  return {
    el, refresh,
    focus(id) {
      refresh(true)
      app.showRight('comments')
      requestAnimationFrame(() => list.querySelector(`.cm[data-id="${id}"] textarea`)?.focus())
    },
    destroy: off,
  }
}

// ---------- document tab ----------
export function createDocInfo(app) {
  const el = h('div', { class: 'docinfo' })
  const authorIn = input({ value: app.author(), placeholder: 'Your name', 'aria-label': 'Author name', oninput: (e) => app.setAuthor(e.target.value) })
  function refresh() {
    const d = app.doc
    if (!d) { el.replaceChildren(h('p', { class: 'small muted' }, 'Open a PDF to see its details.')); return }
    const hl = toggle('Highlight form fields', app.forms.highlight, (v) => app.forms.setHighlight(v))
    el.replaceChildren(
      h('dl', { class: 'kv' },
        h('dt', 'File'), h('dd', d.name), h('dt', 'Size'), h('dd', formatBytes(d.bytes.length)), h('dt', 'Pages'), h('dd', String(app.store.state.pages.length)),
        h('dt', 'Form fields'), h('dd', String(app.forms.count))),
      field('Author for comments', authorIn),
      d.fieldCount ? h('div', { class: 'stack' }, hl, button('Reset form to original', { icon: 'rotate-ccw', size: 'sm', onClick: () => app.forms.clearAll() })) : null,
      h('details', { class: 'shortcuts' }, h('summary', 'Keyboard shortcuts'),
        h('div', { class: 'sc-grid' }, ...[['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S', 'Save PDF'], ['Ctrl+F', 'Search'], ['Ctrl+O', 'Open file'], ['Ctrl+wheel, + / -', 'Zoom'], ['Ctrl+0', 'Fit width'], ['Delete', 'Delete selection'], ['Arrows', 'Nudge (Shift = 10 pt)'], ['Ctrl+D', 'Duplicate'], ['Enter', 'Edit text box'], ['Esc', 'Back to Select'],
          ...TOOL_LIST.filter((t) => t.key).map((t) => [t.key, t.name])].flatMap(([k, v]) => [h('kbd', k), h('span', v)]))))
  }
  const off = app.store.on((type, d) => { if (type === 'change' && (d.reset || /pages?/i.test(d.label || ''))) refresh() })
  refresh()
  return { el, refresh, destroy: off }
}

// ---------- search ----------
export function createSearch(app) {
  const { store, viewer } = app
  const S = app.search
  let runId = 0, matchCase = false, whole = false
  const q = input({ type: 'search', placeholder: 'Find in document', 'aria-label': 'Find in document', autocomplete: 'off', oninput: () => deb(), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1) } else if (e.key === 'Escape') close() } })
  const info = h('span', { class: 'sb-info', 'aria-live': 'polite' })
  const flat = (src, items) => { app.doc.flatCache ??= new Map(); if (!app.doc.flatCache.has(src)) app.doc.flatCache.set(src, flatten(items)); return app.doc.flatCache.get(src) }

  async function run() {
    const term = q.value.trim()
    const my = ++runId
    S.q = term
    if (!term) return clear()
    const hits = []
    const pages = store.state.pages
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]
      if (p.src == null) continue
      if (i % 4 === 0) info.textContent = `Searching ${i + 1}/${pages.length}`
      const { items } = await loadItems(app.doc, p.src)
      if (my !== runId) return
      const fl = flat(p.src, items)
      for (const [s, e] of findAll(fl.text, term, { matchCase, whole })) {
        const rects = rangeRects(items, fl, s, e)
        if (rects.length) hits.push({ pid: p.id, rects })
        if (hits.length >= 3000) break
      }
      if (i % 6 === 5) await yieldToMain()
    }
    hits.forEach((x, i) => { x.idx = i })
    S.list = hits
    S.byPid = new Map()
    for (const x of hits) { if (!S.byPid.has(x.pid)) S.byPid.set(x.pid, []); S.byPid.get(x.pid).push(x) }
    const curPid = store.state.pages[viewer.current]?.id
    const first = hits.findIndex((x) => store.pageIndex(x.pid) >= store.pageIndex(curPid))
    S.cur = hits.length ? (first < 0 ? 0 : first) : -1
    label()
    viewer.drawHits()
    if (S.cur >= 0) reveal()
    redactBtn.disabled = !hits.length
  }
  const deb = debounce(run, 250)
  function label() { info.textContent = !S.q ? '' : S.list.length ? `${S.cur + 1} of ${S.list.length}${S.list.length >= 3000 ? '+' : ''}` : 'No matches' }
  function reveal() {
    const x = S.list[S.cur]
    if (!x) return
    viewer.gotoPid(x.pid)
    requestAnimationFrame(() => viewer.scrollToRect(x.pid, { x: x.rects[0][0], y: x.rects[0][1], w: x.rects[0][2], h: x.rects[0][3] }))
  }
  function go(d) {
    if (!S.list.length) return run()
    S.cur = (S.cur + d + S.list.length) % S.list.length
    label(); viewer.drawHits(); reveal()
  }
  function clear() {
    S.list = []; S.byPid = new Map(); S.cur = -1
    label(); viewer.drawHits()
    redactBtn.disabled = true
  }
  function open() {
    bar.hidden = false
    app.root.dataset.search = 'on'
    const t = getSelection()?.toString().trim()
    if (t && t.length < 80 && !t.includes('\n')) q.value = t
    q.focus(); q.select()
    if (q.value) run()
  }
  function close() {
    bar.hidden = true
    app.root.dataset.search = 'off'
    clear(); S.q = ''
    viewer.el.focus({ preventScroll: true })
  }
  function redactAll() {
    if (!S.list.length) return
    const author = app.author()
    store.commit(`Redact ${S.list.length} match${S.list.length === 1 ? '' : 'es'}`, (s) => {
      for (const x of S.list) for (const r of x.rects) s.annots.push(makeAnnot('redact', x.pid, { x: r[0] - 0.5, y: r[1] - 0.5, w: r[2] + 1, h: r[3] + 1 }, author))
    })
    toast(`Marked ${S.list.length} match${S.list.length === 1 ? '' : 'es'} for redaction. They are removed when you save.`, 'success', 4000)
  }
  const optBtn = (txt, label, get, set) => {
    const b = h('button', { type: 'button', class: 'pbtn tog txt', 'aria-pressed': 'false', 'data-tip': label, 'aria-label': label, onclick: () => { set(!get()); b.setAttribute('aria-pressed', String(get())); run() } }, txt)
    return b
  }
  const redactBtn = button('Redact all', { icon: 'eye-off', size: 'sm', onClick: redactAll, disabled: true, title: 'Mark every match for redaction' })
  const bar = h('div', { class: 'pdfs-search', hidden: true, role: 'search' },
    h('div', { class: 'sb-field' }, icon('search'), q),
    optBtn('Aa', 'Match case', () => matchCase, (v) => { matchCase = v }), optBtn('ab', 'Whole word', () => whole, (v) => { whole = v }),
    info, ibtn('chevron-up', 'Previous match (Shift+Enter)', () => go(-1)), ibtn('chevron-down', 'Next match (Enter)', () => go(1)), redactBtn, ibtn('x', 'Close search (Esc)', close))
  app.closeSearch = close
  app.openSearch = open
  const off = store.on((type, d) => { if (type === 'change' && !bar.hidden && q.value && (d.reset || /page/i.test(d.label || '') || d.restore)) deb() })
  return { bar, open, close, run, destroy: off, clear }
}

