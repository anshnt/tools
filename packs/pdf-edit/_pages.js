// Shared page-thumbnail grid: lazy thumbnails, select / multi-select, drag to reorder (mouse, touch, keyboard),
// rotate badges and mark-as-deleted. Used by split, rotate, delete, rearrange, extract, add pages and crop.
//
//   const grid = pageGrid({ pdf, select: 'multi', reorder: true, rotate: true, onChange(e) {} })
//   root.append(grid.el)            // grid.items, grid.selected(), grid.selectAll(), grid.rotate(items, 90), grid.reverse() ...
//
// An item is { id, pdf, page, rot, removed, caption? } (rot in degrees on top of the page's own rotation). Items may also bring
// their own thumbnail with draw: async () => canvas (blank pages, images).
import { h, icon, button, clear, onCleanup } from '../../lib/ui.js'
import { thumbnail, pageSize } from '../../lib/pdf.js'
import { css, ensureStyles, plural, formatRanges } from './_shared.js'
import { parseRanges } from '../../lib/pdf.js'

let nextId = 1
/** New grid item. */
export const newItem = (props) => ({ id: nextId++, rot: 0, removed: false, ...props })
/** One item per page of a pdf.js document. */
export const pageItems = (pdf) => Array.from({ length: pdf.numPages }, (_, i) => newItem({ pdf, page: i + 1 }))
/** Normalised extra rotation of an item: 0, 90, 180 or 270. */
export const itemRotation = (it) => ((Math.round(it.rot / 90) * 90 % 360) + 360) % 360

const CSS = `
.pe-gridwrap { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pe-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--border); }
.pe-bar .btn { background: transparent; box-shadow: none; }
.pe-bar .btn:hover:not(:disabled) { background: var(--surface); }
.pe-bar .pe-sep { width: 1px; height: 20px; background: var(--border-strong); margin: 0 4px; }
.pe-bar .pe-count { margin-left: auto; padding: 0 10px; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.pe-bar .pe-count b { color: var(--text); }
.pe-grid { position: relative; list-style: none; margin: 0; padding: 4px; display: grid; gap: 16px 14px; grid-template-columns: repeat(auto-fill, minmax(var(--pe-col, 136px), 1fr)); outline: none; }
.pe-grid.pe-lg { --pe-col: 200px; }
.pe-grid.pe-sm { --pe-col: 104px; gap: 12px 10px; }
.pe-tile { position: relative; display: flex; flex-direction: column; gap: 7px; min-width: 0; outline: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; cursor: pointer; }
.pe-grid.pe-nosel .pe-tile { cursor: default; }
.pe-thumb { position: relative; aspect-ratio: var(--pe-ratio, 3 / 4); container-type: size; display: grid; place-items: center; border-radius: 12px; overflow: hidden;
  background: var(--surface-2); border: 1.5px solid var(--border); box-shadow: var(--shadow-sm); transition: transform .3s var(--spring), box-shadow .25s, border-color .2s, background .2s; }
.pe-thumb::before { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 20%, color-mix(in srgb, var(--surface) 70%, transparent) 50%, transparent 80%) 0 0 / 200% 100%; animation: pe-shimmer 1.4s linear infinite; }
.pe-tile.is-ready .pe-thumb::before { display: none; }
.pe-thumb canvas { position: relative; display: block; width: min(100cqw, 100cqh * var(--a, .75)); aspect-ratio: var(--a, .75); height: auto; background: #fff; border-radius: 3px;
  box-shadow: 0 1px 6px rgba(16, 16, 40, .22); transform: rotate(var(--rot, 0deg)); transition: transform .45s var(--spring), width .45s var(--spring); animation: pe-pop .35s var(--ease) both; }
.pe-tile[data-q="1"] .pe-thumb canvas, .pe-tile[data-q="3"] .pe-thumb canvas { width: min(100cqw * var(--a, .75), 100cqh); }
@media (hover: hover) { .pe-grid:not(.pe-dragging) .pe-tile:hover .pe-thumb { transform: translateY(-4px); box-shadow: var(--shadow); border-color: var(--border-strong); } }
.pe-tile:focus-visible .pe-thumb { outline: 2px solid var(--accent); outline-offset: 3px; }
.pe-tile[aria-selected="true"] .pe-thumb { border-color: var(--pe-tone, var(--accent)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pe-tone, var(--accent)) 28%, transparent), var(--shadow); background: color-mix(in srgb, var(--pe-tone, var(--accent)) 8%, var(--surface-2)); }
.pe-grid.pe-danger { --pe-tone: var(--danger); }
.pe-check { position: absolute; z-index: 3; top: 7px; left: 7px; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--pe-tone, var(--accent));
  box-shadow: 0 4px 10px -3px var(--pe-tone, var(--accent)); transform: scale(0); transition: transform .35s var(--spring); pointer-events: none; }
.pe-check .icon { width: 14px; height: 14px; stroke-width: 3; }
.pe-tile[aria-selected="true"] .pe-check { transform: scale(1); }
.pe-grid.pe-danger .pe-tile[aria-selected="true"] .pe-thumb::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--danger) 16%, transparent) 0 8px, transparent 8px 16px); pointer-events: none; }
.pe-grip { position: absolute; z-index: 3; top: 4px; right: 4px; width: 32px; height: 32px; border-radius: 9px; border: 0; display: grid; place-items: center; color: var(--text-2); cursor: grab; touch-action: none;
  background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(6px); box-shadow: var(--shadow-sm); opacity: 0; transition: opacity .2s; }
.pe-grip .icon { width: 15px; height: 15px; }
.pe-tile:hover .pe-grip, .pe-tile:focus-within .pe-grip { opacity: 1; }
@media (hover: none) { .pe-grip { opacity: .9; } }
.pe-acts { position: absolute; z-index: 3; left: 50%; bottom: 6px; transform: translate(-50%, 6px); display: flex; gap: 4px; opacity: 0; transition: opacity .2s, transform .25s var(--spring); }
.pe-acts button { width: 32px; height: 32px; border-radius: 10px; border: 0; display: grid; place-items: center; cursor: pointer; color: var(--text); background: color-mix(in srgb, var(--surface) 90%, transparent); backdrop-filter: blur(6px); box-shadow: var(--shadow); }
.pe-acts button:hover { color: var(--accent); }
.pe-acts button .icon { width: 15px; height: 15px; }
@media (hover: hover) { .pe-tile:hover .pe-acts, .pe-tile:focus-within .pe-acts { opacity: 1; transform: translate(-50%, 0); } }
.pe-rotbadge { position: absolute; z-index: 2; right: 6px; bottom: 6px; display: none; align-items: center; gap: 3px; height: 20px; padding: 0 7px; border-radius: 99px; font-size: 11px; font-weight: 600; color: #fff;
  background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 4px 10px -4px var(--accent); }
.pe-rotbadge .icon { width: 11px; height: 11px; stroke-width: 2.6; }
.pe-tile.is-rotated .pe-rotbadge { display: inline-flex; animation: pe-pop .35s var(--spring) both; }
.pe-gone { position: absolute; inset: 0; z-index: 2; display: none; place-items: center; background: color-mix(in srgb, var(--danger) 18%, color-mix(in srgb, var(--surface) 78%, transparent)); color: var(--danger); font-size: 12px; font-weight: 600; text-align: center; gap: 4px; align-content: center; }
.pe-gone .icon { width: 22px; height: 22px; }
.pe-tile.is-removed .pe-gone { display: grid; }
.pe-tile.is-removed .pe-thumb canvas { filter: grayscale(1); opacity: .5; }
.pe-cap { display: flex; align-items: baseline; justify-content: center; gap: 6px; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; min-height: 18px; }
.pe-cap b { color: var(--text); font-weight: 600; font-size: 13px; }
.pe-tile[aria-selected="true"] .pe-cap b { color: var(--pe-tone, var(--accent)); }
.pe-tile[data-tint] .pe-thumb { border-color: var(--tint); box-shadow: 0 0 0 2px color-mix(in srgb, var(--tint) 35%, transparent); }
.pe-tile[data-tint] .pe-cap span { color: var(--tint); font-weight: 600; }
.pe-tile.is-lifted { opacity: .38; }
.pe-tile.is-lifted .pe-thumb { border-style: dashed; }
.pe-ghost { position: fixed; z-index: 600; left: 0; top: 0; pointer-events: none; will-change: transform; filter: drop-shadow(0 22px 28px rgba(16, 16, 40, .38)); transition: scale .2s var(--spring); }
.pe-ghost canvas { display: block; border-radius: 4px; background: #fff; border: 1px solid var(--border); }
.pe-ghost .pe-ghost-n { position: absolute; right: -8px; top: -8px; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 99px; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; background: var(--accent); box-shadow: 0 6px 14px -4px var(--accent); }
.pe-ghost .pe-ghost-stack { position: absolute; inset: 0; border-radius: 4px; background: var(--surface); border: 1px solid var(--border); transform: translate(7px, 7px) rotate(3deg); z-index: -1; }
.pe-grid.pe-dragging, .pe-grid.pe-dragging * { cursor: grabbing !important; }
.pe-empty { padding: 28px 16px; text-align: center; color: var(--muted); border: 1px dashed var(--border); border-radius: 16px; }
@media (max-width: 480px) { .pe-grid { --pe-col: 100px; gap: 12px 10px; } .pe-grid.pe-lg { --pe-col: 150px; } .pe-bar { gap: 2px; } .pe-bar .btn span { font-size: 12.5px; } .pe-bar .btn { padding: 0 9px; } }
`

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const docIds = new WeakMap()
let docSeq = 0
const docKey = (pdf) => { if (!docIds.has(pdf)) docIds.set(pdf, ++docSeq); return docIds.get(pdf) }
const copyCanvas = (src) => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); return c }

/**
 * pageGrid(options) -> controller
 * options: pdf (default source), items, select: 'multi' | 'single' | false, reorder, rotate, remove (mark pages as deleted),
 *   tone: 'accent' | 'danger', size: 'sm' | 'md' | 'lg', toolbar (select shortcuts), bar: [extra toolbar nodes], label,
 *   onChange({type: 'select' | 'reorder' | 'rotate' | 'remove' | 'items'}), onOpen(item) (double click / Enter on a single-select grid)
 */
export function pageGrid(options = {}) {
  ensureStyles()
  css('pe-grid', CSS)
  const o = { select: 'multi', reorder: false, rotate: false, remove: false, tone: 'accent', size: 'md', toolbar: true, label: 'Pages', ...options }
  let items = [...(o.items || (o.pdf ? pageItems(o.pdf) : []))]
  const selected = new Set()
  const nodes = new Map()
  const byNode = new WeakMap()
  const cache = new Map()
  const queue = []
  let active = 0, destroyed = false, focusId = items[0]?.id ?? null, anchor = null, justDragged = false, drag = null

  const live = h('div', { class: 'sr-only', 'aria-live': 'polite' })
  const say = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t }, 30) }
  const count = h('span', { class: 'pe-count' })
  const bar = h('div', { class: 'pe-bar', role: 'toolbar', 'aria-label': `${o.label} tools` })
  const ul = h('ul', {
    class: ['pe-grid', o.size !== 'md' && `pe-${o.size}`, o.tone === 'danger' && 'pe-danger', !o.select && 'pe-nosel'], role: 'listbox', 'aria-label': o.label,
    'aria-multiselectable': o.select === 'multi' ? 'true' : null,
    onclick: onClick, onkeydown: onKey, onpointerdown: onPointerDown, ondblclick: (e) => { const it = itemOf(e); if (it && o.onOpen) o.onOpen(it) },
  })
  const el = h('div', { class: 'pe-gridwrap' }, bar, ul, live)

  // ----- thumbnails -----
  const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); enqueue(byNode.get(e.target)) }
  }, { rootMargin: '500px 0px' })
  function enqueue(it) { if (!it || it._queued) return; it._queued = true; queue.push(it); pump() }
  function pump() {
    while (active < 2 && queue.length) {
      const it = queue.shift()
      active++
      paint(it).finally(() => { active--; if (!destroyed) pump() })
    }
  }
  function thumbCanvas(it) {
    if (it.draw) return Promise.resolve(it.draw())
    const key = `${docKey(it.pdf)}:${it.page}`
    if (!cache.has(key)) cache.set(key, thumbnail(it.pdf, it.page, o.size === 'lg' ? 400 : 300))
    return cache.get(key).then(copyCanvas)
  }
  async function paint(it) {
    const node = nodes.get(it.id)
    if (destroyed || !node) return
    try {
      const c = await thumbCanvas(it)
      if (destroyed || !nodes.has(it.id)) return
      const thumb = node.querySelector('.pe-thumb')
      thumb.querySelector(':scope > canvas')?.remove()
      thumb.prepend(c)
      thumb.style.setProperty('--a', (c.width / c.height).toFixed(4))
      node.classList.add('is-ready')
    } catch (err) {
      console.error(err)
      node.classList.add('is-ready', 'is-error')
    }
  }

  // ----- tiles -----
  const itemOf = (e) => { const li = e.target.closest?.('.pe-tile'); return li ? items.find((x) => x.id === +li.dataset.id) : null }
  function build(it, i) {
    const acts = h('div', { class: 'pe-acts' },
      o.rotate && h('button', { type: 'button', 'data-act': 'rotate', title: 'Rotate right', 'aria-label': 'Rotate this page right', onclick: (e) => { e.stopPropagation(); api.rotate([it], 90) } }, icon('rotate-cw')),
      o.remove && h('button', { type: 'button', 'data-act': 'remove', title: 'Delete or restore', 'aria-label': 'Delete or restore this page', onclick: (e) => { e.stopPropagation(); api.remove([it], !it.removed) } }, icon('trash-2')))
    const thumb = h('div', { class: 'pe-thumb' },
      o.select && h('span', { class: 'pe-check', 'aria-hidden': 'true' }, icon(o.checkIcon || (o.tone === 'danger' ? 'trash-2' : 'check'))),
      o.reorder && h('button', { type: 'button', class: 'pe-grip', 'aria-label': 'Drag to move this page. With a keyboard, focus the page and press Alt plus an arrow key.', tabindex: -1 }, icon('grip-vertical')),
      (o.rotate || o.remove) && acts,
      h('span', { class: 'pe-rotbadge', 'aria-hidden': 'true' }, icon('rotate-cw'), h('span')),
      h('div', { class: 'pe-gone' }, icon('trash-2'), 'Deleted'))
    const li = h('li', { class: 'pe-tile', role: 'option', tabindex: -1, 'data-id': it.id }, thumb, h('div', { class: 'pe-cap' }))
    li.style.setProperty('--i', i)
    nodes.set(it.id, li)
    byNode.set(li, it)
    if (it.canvas) { thumb.prepend(it.canvas); thumb.style.setProperty('--a', (it.canvas.width / it.canvas.height).toFixed(4)); li.classList.add('is-ready') }
    else if (io) io.observe(li)
    else enqueue(it)
    if (!reduced()) li.animate([{ opacity: 0, transform: 'translateY(14px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: Math.min(i, 16) * 26, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' })
    return li
  }
  function sync(it, i) {
    const li = nodes.get(it.id)
    if (!li) return
    const q = (itemRotation(it) / 90) | 0
    li.dataset.q = q
    li.style.setProperty('--rot', `${it.rot}deg`)
    li.classList.toggle('is-rotated', q !== 0)
    li.classList.toggle('is-removed', !!it.removed)
    if (it.tint) { li.dataset.tint = '1'; li.style.setProperty('--tint', it.tint) } else { delete li.dataset.tint; li.style.removeProperty('--tint') }
    li.querySelector('.pe-rotbadge span').textContent = `${itemRotation(it)}°`
    if (o.select) li.setAttribute('aria-selected', String(selected.has(it.id)))
    li.tabIndex = it.id === focusId ? 0 : -1
    const pos = i + 1
    const cap = li.querySelector('.pe-cap')
    cap.replaceChildren(h('b', it.caption ?? String(pos)), it.sub ? h('span', it.sub) : (it.pdf && it.page !== pos && o.reorder ? h('span', `was ${it.page}`) : ''))
    li.setAttribute('aria-label', `Page ${pos}${it.sub ? `, ${it.sub}` : ''}${it.removed ? ', deleted' : ''}${q ? `, rotated ${itemRotation(it)} degrees` : ''}${selected.has(it.id) ? ', selected' : ''}`)
  }
  function syncAll() {
    items.forEach(sync)
    count.replaceChildren(h('b', selected.size.toLocaleString()), ` of ${items.length.toLocaleString()} selected`)
    for (const b of bar.querySelectorAll('[data-needs-sel]')) b.disabled = !selected.size
  }
  function layout(animate = true) {
    const keep = new Set(items.map((x) => x.id))
    const first = animate && !reduced() ? new Map([...nodes].map(([id, n]) => [id, n.getBoundingClientRect()])) : null
    for (const [id, n] of nodes) if (!keep.has(id)) { n.remove(); nodes.delete(id) }
    items.forEach((it, i) => { if (!nodes.has(it.id)) build(it, i) })
    items.forEach((it, i) => { const n = nodes.get(it.id); if (ul.children[i] !== n) ul.insertBefore(n, ul.children[i] || null) })
    syncAll()
    if (first) {
      for (const [id, n] of nodes) {
        const a = first.get(id)
        if (!a) continue
        const b = n.getBoundingClientRect()
        const dx = a.left - b.left, dy = a.top - b.top
        if (dx || dy) n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    }
  }
  const emit = (type) => o.onChange?.({ type, grid: api })
  function setFocus(id, focus = true) {
    focusId = id
    items.forEach((x) => { const n = nodes.get(x.id); if (n) n.tabIndex = x.id === id ? 0 : -1 })
    if (focus) nodes.get(id)?.focus({ preventScroll: false })
  }

  // ----- selection -----
  function pick(it, e) {
    if (!o.select || !api.interactive) return
    if (o.select === 'single') { selected.clear(); selected.add(it.id) }
    else if (e?.shiftKey && anchor != null && items.some((x) => x.id === anchor)) {
      const a = items.findIndex((x) => x.id === anchor), b = items.findIndex((x) => x.id === it.id)
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selected.add(items[i].id)
    } else if (selected.has(it.id)) selected.delete(it.id)
    else selected.add(it.id)
    anchor = it.id
    setFocus(it.id, false)
    syncAll()
    emit('select')
  }
  function onClick(e) {
    if (justDragged || e.target.closest('.pe-acts, .pe-grip')) return
    const it = itemOf(e)
    if (it) pick(it, e)
  }

  // ----- keyboard -----
  const cols = () => { const t = ul.children[0]?.offsetTop; let n = 0; for (const c of ul.children) { if (c.offsetTop !== t) break; n++ } return Math.max(1, n) }
  function onKey(e) {
    const it = itemOf(e)
    if (!it || e.target.closest('button')) return
    const i = items.indexOf(it)
    const go = (j) => { j = Math.max(0, Math.min(items.length - 1, j)); setFocus(items[j].id); if (e.shiftKey && o.select === 'multi') { selected.add(items[j].id); syncAll(); emit('select') } }
    if (e.altKey && o.reorder && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowUp' ? -cols() : cols())
      const group = selected.has(it.id) && selected.size > 1 ? items.filter((x) => selected.has(x.id)) : [it]
      api.moveBy(group, step)
      nodes.get(it.id)?.focus({ preventScroll: false })
      say(`Page moved to position ${items.indexOf(it) + 1}`)
      return
    }
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); go(i + 1); break
      case 'ArrowLeft': e.preventDefault(); go(i - 1); break
      case 'ArrowDown': e.preventDefault(); go(i + cols()); break
      case 'ArrowUp': e.preventDefault(); go(i - cols()); break
      case 'Home': e.preventDefault(); go(0); break
      case 'End': e.preventDefault(); go(items.length - 1); break
      case ' ': e.preventDefault(); pick(it, e); break
      case 'Enter': e.preventDefault(); if (o.onOpen && o.select === 'single') o.onOpen(it); else pick(it, e); break
      case 'a': case 'A': if ((e.ctrlKey || e.metaKey) && o.select === 'multi') { e.preventDefault(); api.selectAll() } break
      case 'Delete': case 'Backspace': if (o.remove) { e.preventDefault(); const t = selected.size ? api.selected() : [it]; api.remove(t, !it.removed) } break
      case 'r': case 'R': if (o.rotate) { e.preventDefault(); api.rotate(selected.size ? api.selected() : [it], e.shiftKey ? -90 : 90) } break
      default:
    }
  }

  // ----- drag to reorder -----
  function onPointerDown(e) {
    if (!o.reorder || e.button !== 0 || drag) return
    const it = itemOf(e)
    if (!it) return
    const onGrip = !!e.target.closest('.pe-grip')
    if (e.pointerType !== 'mouse' && !onGrip) return // touch scrolls the page; only the grip drags
    if (e.target.closest('.pe-acts')) return
    drag = { it, x: e.clientX, y: e.clientY, started: false, id: e.pointerId, grip: onGrip }
    if (onGrip) e.preventDefault()
    addEventListener('pointermove', onMove)
    addEventListener('pointerup', onUp)
    addEventListener('pointercancel', onUp)
  }
  function startDrag(e) {
    const { it } = drag
    const group = selected.has(it.id) && selected.size > 1 ? items.filter((x) => selected.has(x.id)) : [it]
    const src = nodes.get(it.id).querySelector('canvas')
    const r = nodes.get(it.id).querySelector('.pe-thumb').getBoundingClientRect()
    const gc = src ? copyCanvas(src) : document.createElement('canvas')
    gc.style.width = `${Math.min(r.width, 150)}px`
    gc.style.height = 'auto'
    const ghost = h('div', { class: 'pe-ghost' }, group.length > 1 ? h('div', { class: 'pe-ghost-stack' }) : null, gc, group.length > 1 ? h('span', { class: 'pe-ghost-n' }, group.length) : null)
    document.body.append(ghost)
    drag.ghost = ghost
    drag.group = group
    drag.dx = Math.min(r.width, 150) / 2
    drag.dy = 24
    for (const g of group) nodes.get(g.id).classList.add('is-lifted')
    ul.classList.add('pe-dragging')
    drag.timer = setInterval(() => { const y = drag.lastY; if (y < 70) scrollBy(0, -14); else if (y > innerHeight - 70) scrollBy(0, 14); if (y < 70 || y > innerHeight - 70) hover(drag.lastX, y) }, 16)
    drag.started = true
  }
  function hover(x, y) {
    // hit-test against layout boxes (offset*), which ignore the transforms of running FLIP animations
    const box = ul.getBoundingClientRect()
    const px = x - box.left, py = y - box.top
    const under = [...ul.children].find((n) => px >= n.offsetLeft && px <= n.offsetLeft + n.offsetWidth && py >= n.offsetTop && py <= n.offsetTop + n.offsetHeight)
    if (!under) return
    const target = items.find((t) => t.id === +under.dataset.id)
    if (!target || drag.group.includes(target)) return
    const from = items.indexOf(drag.group[0]), to = items.indexOf(target)
    const rest = items.filter((x) => !drag.group.includes(x))
    const at = rest.indexOf(target) + (from < to ? 1 : 0)
    const next = [...rest.slice(0, at), ...drag.group, ...rest.slice(at)]
    if (next.every((x, i) => x === items[i])) return
    items = next
    drag.moved = true
    layout()
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return
    drag.lastX = e.clientX; drag.lastY = e.clientY
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return
      startDrag(e)
    }
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px) rotate(3deg)`
    hover(e.clientX, e.clientY)
  }
  function onUp(e) {
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp)
    const d = drag
    drag = null
    if (!d.started) return
    clearInterval(d.timer)
    d.ghost.remove()
    ul.classList.remove('pe-dragging')
    for (const g of d.group) nodes.get(g.id)?.classList.remove('is-lifted')
    justDragged = true
    setTimeout(() => { justDragged = false }, 0)
    if (d.moved) { say(`Moved to position ${items.indexOf(d.it) + 1}`); emit('reorder') }
    setFocus(d.it.id, false)
  }

  // ----- public API -----
  const api = {
    el, ul, bar, interactive: true,
    get items() { return items },
    selected: () => items.filter((x) => selected.has(x.id)),
    /** selected items, or every item when nothing is selected */
    targets: () => (selected.size ? api.selected() : items),
    isSelected: (it) => selected.has(it.id),
    set(next) { items = [...next]; for (const id of [...selected]) if (!items.some((x) => x.id === id)) selected.delete(id); if (!items.some((x) => x.id === focusId)) focusId = items[0]?.id ?? null; layout(false); emit('items') },
    select(list, replace = true) { if (replace) selected.clear(); for (const x of list) selected.add(typeof x === 'object' ? x.id : x); syncAll(); emit('select') },
    selectAll() { api.select(items) },
    selectNone() { api.select([]) },
    invert() { api.select(items.filter((x) => !selected.has(x.id))) },
    selectBy(fn) { api.select(items.filter(fn)) },
    rotate(list, deg) { for (const x of list) x.rot += deg; syncAll(); emit('rotate') },
    remove(list, on = true) { for (const x of list) x.removed = on; syncAll(); emit('remove') },
    /** put items in a new order (array of the same items) */
    order(next, type = 'reorder') { items = [...next]; layout(); emit(type) },
    reverse() { api.order([...items].reverse()) },
    moveBy(group, step) {
      const rest = items.filter((x) => !group.includes(x))
      const first = items.indexOf(group[0])
      const at = Math.max(0, Math.min(rest.length, first + step))
      api.order([...rest.slice(0, at), ...group, ...rest.slice(at)])
    },
    moveTo(group, where) { api.moveBy(group, where === 'start' ? -items.length : items.length) },
    insert(list, at = items.length) { items = [...items.slice(0, at), ...list, ...items.slice(at)]; layout(); emit('items') },
    focus() { setFocus(focusId ?? items[0]?.id) },
    refresh: syncAll,
    destroy() { destroyed = true; io?.disconnect(); queue.length = 0; cache.clear(); removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp); drag?.ghost?.remove(); clearInterval(drag?.timer) },
  }
  api.duplicate = (list) => {
    const out = []
    for (const x of items) { out.push(x); if (list.includes(x)) out.push({ ...x, id: nextId++, _queued: false, canvas: x.canvas ? copyCanvas(x.canvas) : undefined }) }
    api.order(out, 'items')
  }

  // toolbar
  const tb = (label, ic, fn, needsSel) => button(label, { icon: ic, variant: 'ghost', size: 'sm', onClick: fn, attrs: needsSel ? { 'data-needs-sel': '' } : {} })
  if (o.toolbar && o.select === 'multi') {
    bar.append(tb('All', 'check-check', () => api.selectAll()), tb('None', 'x', () => api.selectNone(), true), tb('Invert', 'arrow-left-right', () => api.invert()),
      tb('Odd', 'list-filter', () => api.selectBy((x) => (items.indexOf(x) + 1) % 2 === 1)), tb('Even', 'list-filter', () => api.selectBy((x) => (items.indexOf(x) + 1) % 2 === 0)))
  }
  for (const n of [o.bar].flat(Infinity)) if (n) bar.append(n)
  count.hidden = !o.select
  bar.append(count)
  if (!o.toolbar && !o.bar && !o.select) bar.hidden = true

  layout(false)
  if (!items.length) ul.after(h('div', { class: 'pe-empty' }, 'No pages'))
  // page-1 aspect ratio makes landscape documents lay out as landscape tiles
  const first = items.find((x) => x.pdf)
  if (first) pageSize(first.pdf, first.page).then((s) => { if (!destroyed) ul.style.setProperty('--pe-ratio', `${Math.min(1.5, Math.max(0.7, s.width / s.height)).toFixed(3)}`) }).catch(() => {})
  onCleanup(api.destroy)
  api.plural = plural
  return api
}

/**
 * Keep a "pages" text box and a grid selection in sync. Typing "2, 5-7" selects those pages; selecting pages rewrites the text.
 * Returns {toText(), fromText()}; call toText() from the grid's onChange.
 */
export function bindRange(grid, box, total, onUpdate) {
  let syncing = false
  return {
    toText() { if (!syncing) box.value = formatRanges(grid.selected().map((x) => grid.items.indexOf(x) + 1)) },
    fromText() {
      syncing = true
      try {
        const pages = box.value.trim() ? parseRanges(box.value, total) : []
        box.classList.remove('invalid')
        grid.select(pages.map((p) => grid.items[p - 1]))
      } catch { box.classList.add('invalid') }
      syncing = false
      onUpdate?.()
    },
  }
}
