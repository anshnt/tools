// Side panels: slide sorter (thumbnails, drag reorder), inspector (design and format) and speaker notes.
import { h, icon } from '../../lib/ui.js'
import { SHAPES, SIZES, TRANSITIONS, round, isTextual } from './_model.js'
import { renderThumb } from './_render.js'
import { THEMES, LAYOUTS, getTheme, newSlide, colorOf, bgOf } from './_themes.js'
import { tbtn, menu, colorPicker, numField, selField, segField, section, swatchBtn, setActive } from './_ui.js'
import { MOD } from './_chrome.js'

// ---------- Slide sorter ----------
export function buildSorter(app) {
  const { store, root } = app
  const list = h('div', { class: 'ss-slist', role: 'listbox', 'aria-label': 'Slides', tabindex: 0 })
  const count = h('span', { class: 'ss-count' })
  const add = tbtn('New slide', 'plus', () => store.addSlide(nextLayout()), { key: `${MOD}+M` })
  const addMore = tbtn('Choose a layout', 'chevron-down', (e, b) => menu(root, b, LAYOUTS.map((l) => ({ label: l.name, run: () => store.addSlide(l.id) }))), {})
  const el = h('aside', { class: 'ss-sorter', 'aria-label': 'Slide sorter' }, h('div', { class: 'ss-ph' }, h('span', 'Slides'), count, h('span', { class: 'ss-grow' }), add, addMore), list)
  const cache = new Map()
  const nextLayout = () => { const l = store.slide?.layout; return !l || l === 'title' || l === 'section' || l === 'blank' ? 'title-content' : l }

  const thumbFor = (s) => {
    const d = store.deck
    const key = JSON.stringify([s, d.theme, d.w, d.h])
    const hit = cache.get(s.id)
    if (hit && hit.key === key) return hit.node
    const node = renderThumb(d, s, 148, { url: (id) => store.assetUrl(id) })
    cache.set(s.id, { key, node })
    return node
  }

  function slideMenu(x, y, i) {
    const anchor = h('div', { class: 'ss-anchor', style: { left: `${x}px`, top: `${y}px` } })
    document.body.append(anchor)
    const n = store.deck.slides.length
    const p = menu(root, anchor, [
      { label: 'New slide', icon: 'plus', run: () => store.addSlide(nextLayout(), i + 1) },
      { label: 'Duplicate slide', icon: 'copy', run: () => store.duplicateSlide(i) },
      { label: 'Move up', icon: 'chevron-up', disabled: i === 0, run: () => store.moveSlide(i, i - 1) },
      { label: 'Move down', icon: 'chevron-down', disabled: i === n - 1, run: () => store.moveSlide(i, i + 1) },
      '-',
      { label: 'Delete slide', icon: 'trash-2', danger: true, run: () => store.deleteSlide(i) },
    ])
    setTimeout(() => anchor.remove(), 0)
    return p
  }

  function beginDrag(e, i, node) {
    const vertical = getComputedStyle(list).flexDirection !== 'row'
    const x0 = e.clientX, y0 = e.clientY
    const touch = e.pointerType !== 'mouse'
    let started = false, drop = i, ghost = null, timer = 0
    const marker = h('div', { class: 'ss-dropline' })
    const items = () => [...list.querySelectorAll('.ss-sl')]
    const start = () => {
      started = true
      node.classList.add('dragging')
      ghost = node.cloneNode(true)
      ghost.classList.add('ss-ghost')
      ghost.style.width = `${node.offsetWidth}px`
      document.body.append(ghost)
      list.append(marker)
    }
    const move = (ev) => {
      const dist = Math.hypot(ev.clientX - x0, ev.clientY - y0)
      if (!started) {
        if (touch) { if (dist > 10) cleanup() ; return }
        if (dist < 5) return
        start()
      }
      ev.preventDefault()
      ghost.style.left = `${ev.clientX + 8}px`
      ghost.style.top = `${ev.clientY + 8}px`
      const its = items()
      let idx = its.length
      for (let k = 0; k < its.length; k++) {
        const r = its[k].getBoundingClientRect()
        if ((vertical ? ev.clientY : ev.clientX) < (vertical ? r.top + r.height / 2 : r.left + r.width / 2)) { idx = k; break }
      }
      drop = idx
      const ref = its[Math.min(idx, its.length - 1)].getBoundingClientRect(), lr = list.getBoundingClientRect()
      const after = idx >= its.length
      if (vertical) Object.assign(marker.style, { left: '6px', right: '6px', top: `${(after ? ref.bottom : ref.top) - lr.top + list.scrollTop - 1}px`, width: 'auto', height: '3px' })
      else Object.assign(marker.style, { top: '6px', bottom: '6px', left: `${(after ? ref.right : ref.left) - lr.left + list.scrollLeft - 1}px`, height: 'auto', width: '3px' })
    }
    const up = () => {
      const wasStarted = started
      cleanup()
      if (wasStarted) store.moveSlide(i, drop > i ? drop - 1 : drop)
      else store.goto(i)
    }
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cleanup)
      ghost?.remove(); marker.remove(); node.classList.remove('dragging')
    }
    if (touch) timer = setTimeout(start, 320)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cleanup)
  }

  function refresh() {
    const slides = store.deck.slides
    count.textContent = String(slides.length)
    const alive = new Set(slides.map((s) => s.id))
    for (const k of cache.keys()) if (!alive.has(k)) cache.delete(k)
    list.replaceChildren(...slides.map((s, i) => {
      const node = h('div', {
        class: ['ss-sl', i === store.cur && 'cur'], role: 'option', 'aria-selected': String(i === store.cur), 'aria-label': `Slide ${i + 1}`, dataset: { i },
        onpointerdown: (e) => { if (e.button === 0) beginDrag(e, i, node) },
        oncontextmenu: (e) => { e.preventDefault(); store.goto(i); slideMenu(e.clientX, e.clientY, i) },
      }, h('span', { class: 'ss-n' }, i + 1), thumbFor(s))
      return node
    }))
    list.querySelector('.cur')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  list.addEventListener('keydown', (e) => {
    const k = e.key
    if (k === 'ArrowDown' || k === 'ArrowRight') { store.goto(store.cur + 1); e.preventDefault() }
    else if (k === 'ArrowUp' || k === 'ArrowLeft') { store.goto(store.cur - 1); e.preventDefault() }
    else if (k === 'Delete' || k === 'Backspace') { store.deleteSlide(); e.preventDefault() }
    else if (k === 'Enter') { app.root.focus(); e.preventDefault() }
    else if (k === 'd' && (e.ctrlKey || e.metaKey)) { store.duplicateSlide(); e.preventDefault() }
  })
  let t = 0
  app.onDispose(store.on((type) => {
    if (type === 'slide') { clearTimeout(t); refresh() }
    else if (type === 'change') { clearTimeout(t); t = setTimeout(refresh, 80) }
  }))
  app.onDispose(() => clearTimeout(t))
  refresh()
  return { el, refresh }
}

// ---------- Notes ----------
export function buildNotes(app) {
  const { store } = app
  const ta = h('textarea', { class: 'ss-notes-ta', rows: 2, placeholder: 'Click to add speaker notes', 'aria-label': 'Speaker notes' })
  let before = null
  ta.addEventListener('focus', () => { before = store.begin() })
  ta.addEventListener('input', () => { if (store.slide) { store.slide.notes = ta.value; store.scheduleSave() } })
  ta.addEventListener('blur', () => { if (before) store.end(before, 'Edit notes', 'meta'); before = null })
  ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') ta.blur() })
  const el = h('div', { class: 'ss-notes' }, h('label', { class: 'ss-notes-l' }, icon('sticky-note'), 'Speaker notes'), ta)
  const refresh = () => { if (document.activeElement !== ta) ta.value = store.slide?.notes || '' }
  app.onDispose(store.on((t) => { if (t === 'slide' || t === 'change') refresh() }))
  refresh()
  return { el, refresh }
}

// ---------- Inspector ----------
export function buildInspector(app) {
  const { store, root, actions } = app
  const body = h('div', { class: 'ss-ibody' })
  let tab = 'design', manual = false
  const tabBtns = { design: null, format: null }
  const mkTab = (id, label, ic) => (tabBtns[id] = h('button', { type: 'button', role: 'tab', class: 'ss-tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; manual = true; refresh() } }, icon(ic), h('span', label)))
  const el = h('aside', { class: 'ss-insp', 'aria-label': 'Inspector' }, h('div', { class: 'ss-tabs', role: 'tablist' }, mkTab('design', 'Design', 'palette'), mkTab('format', 'Format', 'sliders-horizontal')), body)
  const cols = () => getTheme(store.deck).colors
  const themeCache = { key: '', nodes: null }
  let geom = {}

  const edit = (label, fn, merge) => store.edit(label, () => store.selected.forEach(fn), 'slide', merge)
  const colorField = (label, value, onPick, o = {}) => {
    const b = swatchBtn(label, value ? colorOf(store.deck, value) : '', (e, btn) => colorPicker(root, btn, { value, colors: cols(), label, none: o.none ?? true, onPick }), { text: label })
    return h('div', { class: 'ss-field wide' }, b)
  }

  function designTab() {
    const d = store.deck, s = store.slide
    const key = `${d.theme}|${d.w}|${d.h}`
    if (themeCache.key !== key) {
      themeCache.key = key
      themeCache.nodes = {
        themes: THEMES.map((t) => {
          const tmp = { ...d, theme: t.id }
          return { t, node: renderThumb(tmp, newSlide(tmp, 'title', { title: 'Aa', subtitle: t.note }), 112) }
        }),
        layouts: LAYOUTS.map((l) => {
          const slide = newSlide(d, l.id, { title: 'Title', subtitle: 'Subtitle', body: ['Text', 'Text'], body2: ['Text', 'Text'], caption: 'Caption' })
          return { l, node: renderThumb(d, slide, 104, { mode: 'edit' }) }
        }),
      }
    }
    const themes = h('div', { class: 'ss-tgrid2' }, themeCache.nodes.themes.map(({ t, node }) => {
      const b = h('button', { type: 'button', class: ['ss-card', t.id === d.theme && 'on'], 'aria-pressed': String(t.id === d.theme), title: `${t.name}: ${t.note}`, onclick: () => actions.setTheme(t.id) }, h('div', { class: 'ss-card-thumb' }, node.cloneNode(true)), h('span', t.name))
      return b
    }))
    const layouts = h('div', { class: 'ss-lgrid' }, themeCache.nodes.layouts.map(({ l, node }) => h('button', {
      type: 'button', class: ['ss-card', l.id === s.layout && 'on'], 'aria-pressed': String(l.id === s.layout), title: l.name, onclick: () => actions.setLayout(l.id),
    }, h('div', { class: 'ss-card-thumb' }, node.cloneNode(true)), h('span', l.name))))
    const bg = bgOf(d, s)
    return h('div', { class: 'ss-pane' },
      section('Theme', themes),
      section('Layout', layouts),
      section('Slide',
        colorField('Background', s.bg?.c1 || bg.c1, (v) => actions.setBackground(v), { none: false }),
        h('div', { class: 'ss-row' },
          h('button', { type: 'button', class: 'ss-link', disabled: !s.bg, onclick: () => actions.setBackground('') }, 'Reset background'),
          h('button', { type: 'button', class: 'ss-link', onclick: () => actions.setBackground(s.bg?.c1 || bg.c1, true) }, 'Apply to all slides')),
        selField('Transition', TRANSITIONS, s.tr || 'none', (v) => actions.setTransition(v)),
        h('button', { type: 'button', class: 'ss-link', onclick: () => actions.setTransition(s.tr || 'none', true) }, 'Apply transition to all slides'),
        selField('Slide size', SIZES.map((x) => [x[0], x[1]]), SIZES.find((x) => x[2] === d.w && x[3] === d.h)?.[0] || '', (v) => actions.setSize(v))))
  }

  function formatTab() {
    const els = store.selected
    if (!els.length) {
      return h('div', { class: 'ss-pane' }, h('div', { class: 'ss-empty' }, icon('mouse-pointer-2'), h('p', 'Select an object on the slide to format it.'), h('p', { class: 'small muted' }, 'Theme, layout, background and transitions are on the Design tab.')))
    }
    geom = {}
    const e = els[0], one = els.length === 1
    const num = (key, label, o = {}) => (geom[key] = numField(label, e[key], (v) => edit(label, (x) => { x[key] = v }), o))
    const kids = []
    // Arrange
    const arrange = [
      one && h('div', { class: 'ss-grid4' }, num('x', 'X', { dec: 1 }), num('y', 'Y', { dec: 1 }), num('w', 'W', { min: 1, dec: 1, disabled: e.type === 'line' && false }), num('h', 'H', { min: e.type === 'line' ? 0 : 1, dec: 1 })),
      one && e.type !== 'line' && h('div', { class: 'ss-grid4' }, num('rot', 'Rotate', { min: 0, max: 360, dec: 0 })),
      h('label', { class: 'ss-field wide' }, h('span', 'Opacity'), (() => {
        let before = null
        const r = h('input', { type: 'range', min: 5, max: 100, step: 1, value: Math.round((e.op ?? 1) * 100), 'aria-label': 'Opacity',
          onpointerdown: () => { before = store.begin() },
          oninput: () => { before ||= store.begin(); for (const x of els) { x.op = r.value / 100; const n = app.stage.nodeOf(x.id); if (n) n.style.opacity = x.op < 1 ? x.op : '' } },
          onchange: () => { store.end(before || store.begin(), 'Opacity', 'slide'); before = null } })
        return r
      })()),
      h('div', { class: 'ss-btnrow', role: 'group', 'aria-label': 'Order' },
        tbtn('Bring to front', 'bring-to-front', () => actions.order('front')), tbtn('Bring forward', 'arrow-up', () => actions.order('forward')),
        tbtn('Send backward', 'arrow-down', () => actions.order('backward')), tbtn('Send to back', 'send-to-back', () => actions.order('back')),
        tbtn('Duplicate', 'copy', () => actions.duplicate(), { key: `${MOD}+D` }), tbtn('Delete', 'trash-2', () => actions.deleteSelected(), { key: 'Del', cls: 'danger' })),
      h('div', { class: 'ss-btnrow', role: 'group', 'aria-label': 'Align' },
        tbtn('Align left', 'align-start-vertical', () => actions.align('left')), tbtn('Align centre', 'align-center-vertical', () => actions.align('center')), tbtn('Align right', 'align-end-vertical', () => actions.align('right')),
        tbtn('Align top', 'align-start-horizontal', () => actions.align('top')), tbtn('Align middle', 'align-center-horizontal', () => actions.align('middle')), tbtn('Align bottom', 'align-end-horizontal', () => actions.align('bottom'))),
      els.length >= 3 && h('div', { class: 'ss-btnrow', role: 'group', 'aria-label': 'Distribute' }, tbtn('Distribute horizontally', 'columns-3', () => actions.distribute('h'), { text: 'Spread' }), tbtn('Distribute vertically', 'rows-3', () => actions.distribute('v'), { text: 'Spread' })),
    ]
    kids.push(section('Arrange', arrange))

    if (one && e.type === 'shape') {
      kids.push(section('Shape',
        selField('Shape', SHAPES, e.shape, (v) => edit('Change shape', (x) => { x.shape = v })),
        colorField('Fill', e.fill, (v) => edit('Fill', (x) => { x.fill = v })),
        colorField('Outline', e.stroke, (v) => edit('Outline', (x) => { x.stroke = v; if (v && !x.sw) x.sw = 2 })),
        h('div', { class: 'ss-grid4' }, numField('Width pt', e.sw || 0, (v) => edit('Outline width', (x) => { x.sw = Math.max(0, v) }), { min: 0, max: 40, step: 0.5 }),
          e.shape === 'roundRect' ? numField('Corner %', Math.round((e.rad ?? 0.2) * 100), (v) => edit('Corner radius', (x) => { x.rad = Math.min(50, Math.max(0, v)) / 100 }), { min: 0, max: 50 }) : null),
        selField('Outline style', [['', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']], e.dash || '', (v) => edit('Outline style', (x) => { x.dash = v }))))
    }
    if (one && e.type === 'line') {
      kids.push(section('Line',
        colorField('Colour', e.stroke, (v) => edit('Line colour', (x) => { x.stroke = v || '@text' }), { none: false }),
        h('div', { class: 'ss-grid4' }, numField('Width pt', e.sw || 1, (v) => edit('Line width', (x) => { x.sw = Math.max(0.5, v) }), { min: 0.5, max: 40, step: 0.5 })),
        selField('Style', [['', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']], e.dash || '', (v) => edit('Line style', (x) => { x.dash = v })),
        h('div', { class: 'ss-btnrow' },
          tbtn('Arrow at start', 'arrow-left', () => edit('Arrow', (x) => { x.as = !x.as }), { text: 'Start arrow', active: !!e.as }),
          tbtn('Arrow at end', 'arrow-right', () => edit('Arrow', (x) => { x.ae = !x.ae }), { text: 'End arrow', active: !!e.ae }))))
    }
    if (one && e.type === 'text') {
      kids.push(section('Box', colorField('Fill', e.fill, (v) => edit('Fill', (x) => { x.fill = v })), colorField('Outline', e.stroke, (v) => edit('Outline', (x) => { x.stroke = v; if (v && !x.sw) x.sw = 2 }))))
    }
    const tx = els.filter(isTextual)
    if (tx.length) {
      const t = tx[0].tx
      kids.push(section('Text',
        segField('Vertical', [['top', 'Top', 'align-start-horizontal'], ['middle', 'Middle', 'align-center-horizontal'], ['bottom', 'Bottom', 'align-end-horizontal']], t.va || 'top', (v) => edit('Vertical align', (x) => { if (x.tx) x.tx.va = v })),
        selField('Line spacing', [[0.9, '0.9'], [1, 'Single'], [1.15, '1.15'], [1.3, '1.3'], [1.5, '1.5'], [2, 'Double']], t.lh || 1, (v) => edit('Line spacing', (x) => { if (x.tx) x.tx.lh = +v })),
        h('div', { class: 'ss-grid4' },
          numField('Para gap', t.ps || 0, (v) => edit('Paragraph spacing', (x) => { if (x.tx) x.tx.ps = Math.max(0, v) }), { min: 0, max: 80 }),
          numField('Padding', t.pad ?? 8, (v) => edit('Padding', (x) => { if (x.tx) x.tx.pad = Math.max(0, v) }), { min: 0, max: 80 })),
        one && e.type === 'text' ? h('label', { class: 'switch ss-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: !!t.auto, onchange: (ev) => edit('Auto height', (x) => { x.tx.auto = ev.target.checked }) }), h('span', 'Grow box to fit the text')) : null))
    }
    if (one && e.type === 'image') {
      kids.push(section('Picture',
        segField('Fit', [['contain', 'Fit'], ['cover', 'Fill'], ['fill', 'Stretch']], e.fit || 'contain', (v) => edit('Picture fit', (x) => { x.fit = v })),
        h('div', { class: 'ss-btnrow' }, tbtn('Replace picture', 'image-plus', () => app.pickImage(e.id), { text: 'Replace' })),
        h('div', { class: 'ss-grid4' }, numField('Corner pt', e.rad || 0, (v) => edit('Corner radius', (x) => { x.rad = Math.max(0, v) }), { min: 0, max: 400 }), numField('Border pt', e.sw || 0, (v) => edit('Border', (x) => { x.sw = Math.max(0, v); if (v && !x.stroke) x.stroke = '@text' }), { min: 0, max: 40, step: 0.5 })),
        h('label', { class: 'ss-field wide' }, h('span', 'Alt text'), h('input', { class: 'ss-text', type: 'text', value: e.alt || '', placeholder: 'Describe the picture', onkeydown: (ev) => ev.stopPropagation(), onchange: (ev) => edit('Alt text', (x) => { x.alt = ev.target.value }) }))))
    }
    if (one && e.type === 'table') {
      kids.push(section('Table',
        h('div', { class: 'ss-btnrow' }, tbtn('Add row', 'plus', () => actions.tableOp('addRow'), { text: 'Row' }), tbtn('Remove row', 'minus', () => actions.tableOp('delRow'), { text: 'Row' }), tbtn('Add column', 'plus', () => actions.tableOp('addCol'), { text: 'Col' }), tbtn('Remove column', 'minus', () => actions.tableOp('delCol'), { text: 'Col' })),
        h('label', { class: 'switch ss-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: !!e.hdr, onchange: (ev) => edit('Header row', (x) => { x.hdr = ev.target.checked }) }), h('span', 'Header row')),
        h('label', { class: 'switch ss-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: !!e.band, onchange: (ev) => edit('Banded rows', (x) => { x.band = ev.target.checked }) }), h('span', 'Banded rows')),
        h('div', { class: 'ss-grid4' }, numField('Font pt', e.size || 18, (v) => edit('Table font size', (x) => { x.size = Math.max(6, v) }), { min: 6, max: 72 })),
        segField('Align', [['left', 'Left', 'align-left'], ['center', 'Centre', 'align-center'], ['right', 'Right', 'align-right']], e.a || 'left', (v) => edit('Table align', (x) => { x.a = v })),
        h('p', { class: 'small muted' }, 'Double-click the table to type in its cells. Tab moves to the next cell.')))
    }
    return h('div', { class: 'ss-pane' }, kids)
  }

  function refresh() {
    for (const [id, b] of Object.entries(tabBtns)) b.setAttribute('aria-selected', String(id === tab))
    body.replaceChildren(tab === 'design' ? designTab() : formatTab())
  }
  const refreshGeom = () => {
    const e = store.selected[0]
    if (!e || store.selected.length !== 1) return
    for (const [k, f] of Object.entries(geom)) { const i = f.querySelector('input'); if (i && document.activeElement !== i) i.value = round(e[k] ?? 0, 1) }
  }
  let prevCount = 0
  app.onDispose(store.on((type) => {
    if (type === 'sel' || type === 'change' || type === 'slide') {
      const n = store.sel.length
      if (!manual && (n > 0) !== (prevCount > 0)) tab = n > 0 ? 'format' : 'design'
      prevCount = n
      refresh()
    }
  }))
  app.onDispose(app.bus.on('geom', refreshGeom))
  refresh()
  void setActive
  return { el, refresh }
}
