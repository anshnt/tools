// Library: a virtualized thumbnail grid (also used as the horizontal filmstrip), with ratings, flags, filters and multi-select.
import { h, icon, segmented, select } from '../../lib/ui.js'
import { stars } from './_controls.js'

/**
 * createGrid(app, { mode: 'grid' | 'strip', onOpen(id) }) -> {el, update(), scrollToActive(), setMin(px)}
 * Only the cells in (and just around) the visible area exist in the DOM, so thousands of photos stay smooth.
 */
export function createGrid(app, { mode = 'grid', onOpen, minCell = mode === 'strip' ? 92 : 168 } = {}) {
  const strip = mode === 'strip'
  const inner = h('div', { class: 'pd-grid-inner' })
  const el = h('div', { class: ['pd-grid', strip && 'strip'], role: 'listbox', 'aria-label': strip ? 'Filmstrip' : 'Photos', 'aria-multiselectable': 'true', tabindex: 0 }, inner)
  const cells = new Map() // id -> element
  let ids = []
  let cell = { w: minCell, h: minCell, cols: 1 }
  let min = minCell
  let frame = 0

  function measure() {
    const W = el.clientWidth, H = el.clientHeight
    if (strip) { const s = Math.max(60, H - 6); cell = { w: Math.round(s * 1.25), h: s, cols: Infinity } }
    else {
      const cols = Math.max(1, Math.floor(W / min))
      const w = W / cols
      cell = { w, h: Math.round(w * 0.86), cols }
    }
  }
  function pos(i) {
    return strip ? { x: i * cell.w, y: 0 } : { x: (i % cell.cols) * cell.w, y: Math.floor(i / cell.cols) * cell.h }
  }

  function make(id) {
    const m = app.get(id)
    const img = h('img', { alt: m.name, draggable: false, decoding: 'async', loading: 'lazy' })
    const star = stars(m.rating, (n) => app.setRating(app.selection.has(id) ? app.selectedIds() : [id], n), 'sm')
    const c = h('div', {
      class: 'pd-cell', role: 'option', id: `pd-cell-${id}`, dataset: { id },
      onclick: (e) => {
        if (e.target.closest('.pd-stars')) return
        app.select(id, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single')
        if (strip) onOpen?.(id, true)
      },
      ondblclick: (e) => { if (!e.target.closest('.pd-stars')) onOpen?.(id) },
    },
    h('div', { class: 'pd-thumb' }, img),
    h('span', { class: 'pd-flag pick', title: 'Picked' }, icon('flag')),
    h('span', { class: 'pd-flag reject', title: 'Rejected' }, icon('circle-x')),
    h('span', { class: 'pd-edited', title: 'Edited' }, icon('sliders-horizontal')),
    h('div', { class: 'pd-cell-foot' }, h('span', { class: 'pd-cell-name' }, m.name), star))
    c._img = img; c._star = star
    app.thumbUrl(id).then((u) => { if (u && c.isConnected !== false) img.src = u })
    return c
  }

  function sync(c, id, i) {
    const m = app.get(id)
    const p = pos(i)
    c.style.transform = `translate(${p.x}px, ${p.y}px)`
    c.style.width = `${cell.w}px`; c.style.height = `${cell.h}px`
    const on = app.selection.has(id)
    c.classList.toggle('selected', on)
    c.classList.toggle('active', id === app.activeId)
    c.classList.toggle('picked', m.flag === 'pick')
    c.classList.toggle('rejected', m.flag === 'reject')
    c.classList.toggle('edited', app.isEdited(id))
    c.setAttribute('aria-selected', String(on))
    c._star.set(m.rating)
  }

  function update() {
    frame = 0
    if (!el.clientWidth) return // hidden view: nothing to draw, and the next resize or view change redraws
    measure()
    ids = app.visible()
    const n = ids.length
    if (strip) { inner.style.width = `${n * cell.w}px`; inner.style.height = '100%' }
    else { inner.style.height = `${Math.ceil(n / cell.cols) * cell.h}px`; inner.style.width = '100%' }
    // visible window with a little overscan
    let from, to
    if (strip) { from = Math.floor(el.scrollLeft / cell.w) - 3; to = Math.ceil((el.scrollLeft + el.clientWidth) / cell.w) + 3 }
    else {
      const r0 = Math.floor(el.scrollTop / cell.h) - 1, r1 = Math.ceil((el.scrollTop + el.clientHeight) / cell.h) + 1
      from = r0 * cell.cols; to = (r1 + 1) * cell.cols
    }
    from = Math.max(0, from); to = Math.min(n, to)
    const want = new Set()
    for (let i = from; i < to; i++) want.add(ids[i])
    for (const [id, c] of cells) if (!want.has(id)) { c.remove(); cells.delete(id) }
    const ordered = []
    for (let i = from; i < to; i++) {
      const id = ids[i]
      let c = cells.get(id)
      if (!c) { c = make(id); cells.set(id, c); inner.append(c) }
      sync(c, id, i)
      ordered.push(c)
    }
    if (ordered.some((c, k) => inner.children[k] !== c)) inner.append(...ordered) // keep DOM order equal to visual order for screen readers
    if (n === 0) el.dataset.empty = '1'; else delete el.dataset.empty
    const a = cells.get(app.activeId)
    if (a) el.setAttribute('aria-activedescendant', a.id)
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }

  function scrollToActive() {
    const i = ids.indexOf(app.activeId)
    if (i < 0) return
    measure()
    const p = pos(i)
    if (strip) {
      if (p.x < el.scrollLeft) el.scrollLeft = p.x - 8
      else if (p.x + cell.w > el.scrollLeft + el.clientWidth) el.scrollLeft = p.x + cell.w - el.clientWidth + 8
    } else if (p.y < el.scrollTop) el.scrollTop = p.y
    else if (p.y + cell.h > el.scrollTop + el.clientHeight) el.scrollTop = p.y + cell.h - el.clientHeight
    update()
  }

  el.addEventListener('scroll', schedule, { passive: true })
  const ro = new ResizeObserver(schedule)
  ro.observe(el)
  el.addEventListener('keydown', (e) => {
    const i = ids.indexOf(app.activeId)
    if (e.key === 'Enter' && app.activeId) { onOpen?.(app.activeId); return }
    const cols = strip ? 1 : cell.cols
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, Home: -Infinity, End: Infinity }[e.key]
    if (d === undefined || !ids.length) return
    e.preventDefault()
    const j = d === -Infinity ? 0 : d === Infinity ? ids.length - 1 : Math.min(ids.length - 1, Math.max(0, (i < 0 ? 0 : i) + d))
    app.select(ids[j], e.shiftKey ? 'range' : 'single')
    if (strip) onOpen?.(ids[j], true)
    scrollToActive()
  })
  const offs = [
    app.on('library', () => { frame = 0; update() }),
    app.on('selection', schedule), app.on('meta', schedule), app.on('active', () => { schedule(); if (strip) setTimeout(scrollToActive, 0) }),
    app.on('edit', schedule),
  ]
  update()
  return {
    el, update: schedule, scrollToActive, setMin(px) { min = px; schedule() },
    dispose() { ro.disconnect(); offs.forEach((o) => o()); cancelAnimationFrame(frame) },
  }
}

/** Filter, sort and thumbnail size controls above the grid. */
export function createFilterBar(app, grid) {
  const search = h('input', { type: 'search', class: 'pd-search', placeholder: 'Search by name', 'aria-label': 'Search photos by name', oninput: (e) => app.setFilter({ text: e.target.value }) })
  const minStars = stars(0, (n) => { app.setFilter({ rating: n }); minStars.set(n) }, 'sm')
  minStars.setAttribute('aria-label', 'Show photos rated at least')
  const flags = segmented([['all', 'All'], ['pick', 'Picks'], ['unflagged', 'Unflagged'], ['reject', 'Rejected']], 'all', (v) => app.setFilter({ flag: v }), 'Flag filter')
  const edited = h('label', { class: 'pd-check' }, h('input', { type: 'checkbox', onchange: (e) => app.setFilter({ edited: e.target.checked }) }), h('span', 'Edited'))
  const sortSel = select([['added', 'Import order'], ['name', 'File name'], ['rating', 'Rating'], ['taken', 'Date']], 'added', (v) => app.setSort(v))
  sortSel.setAttribute('aria-label', 'Sort photos')
  const size = h('input', { type: 'range', class: 'pd-range', min: 110, max: 320, step: 10, value: 168, 'aria-label': 'Thumbnail size', oninput: (e) => grid.setMin(e.target.valueAsNumber) })
  const count = h('span', { class: 'pd-count' })
  const el = h('div', { class: 'pd-filters' },
    search, h('div', { class: 'pd-filter-item rate-item' }, h('span', 'Rating'), minStars), flags, edited, h('div', { class: 'pd-filter-item sort-item' }, h('span', 'Sort'), sortSel),
    h('div', { class: 'pd-filter-item size' }, icon('image'), size, icon('image', 'big')), count)
  const upd = () => { count.textContent = `${app.visible().length} of ${app.order.length}` }
  const offs = [app.on('library', upd)]
  upd()
  return { el, update: upd, dispose: () => offs.forEach((o) => o()) }
}
