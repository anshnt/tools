// App chrome: top bar, formatting ribbon, tool rail, status bar and dialogs.
import { h, svg, icon, modal, button, toast, alert } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import { FONTS, FONT_SIZES, SHAPES, SIZES } from './_model.js'
import { shapePath } from './_render.js'
import { getTheme, TEMPLATES, buildTemplate, deckFromOutline, THEMES } from './_themes.js'
import { tbtn, setActive, sep, menu, popover, colorPicker, swatchBtn, selField } from './_ui.js'

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'
const colors = (app) => getTheme(app.store.deck).colors

// ---------- Top bar ----------
export function buildTopbar(app) {
  const { store, root } = app
  const title = h('input', {
    class: 'ss-title', value: store.deck.title, maxlength: 120, 'aria-label': 'Deck title', spellcheck: false,
    oninput: () => { store.deck.title = title.value || 'Untitled deck'; store.scheduleSave() },
    onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') title.blur() },
  })
  const undo = tbtn('Undo', 'undo-2', () => store.undoStep(), { key: `${MOD}+Z` })
  const redo = tbtn('Redo', 'redo-2', () => store.redoStep(), { key: `${MOD}+Shift+Z` })
  const fileBtn = tbtn('File', 'folder-open', (e, b) => menu(root, b, [
    { label: 'New deck...', icon: 'file-plus', run: () => newDeckDialog(app) },
    { label: 'Open project or PPTX...', icon: 'folder-open', run: () => app.openFiles() },
    { label: 'Slides from an outline...', icon: 'list', run: () => outlineDialog(app) },
    '-',
    { label: 'Save project file', icon: 'save', key: `${MOD}+S`, run: () => app.saveProject() },
    '-',
    { head: 'Export' },
    { label: 'PowerPoint (.pptx)', icon: 'presentation', run: () => app.exportAs('pptx') },
    { label: 'PDF', icon: 'file-text', run: () => app.exportAs('pdf') },
    { label: 'Current slide as PNG', icon: 'image', run: () => app.exportAs('png') },
    { label: 'All slides as PNG (ZIP)', icon: 'file-image', run: () => app.exportAs('png-all') },
  ]), { text: 'File', cls: 'ss-file' })
  const exportBtn = tbtn('Export', 'download', (e, b) => menu(root, b, [
    { label: 'PowerPoint (.pptx)', icon: 'presentation', run: () => app.exportAs('pptx') },
    { label: 'PDF', icon: 'file-text', run: () => app.exportAs('pdf') },
    { label: 'Current slide as PNG', icon: 'image', run: () => app.exportAs('png') },
    { label: 'All slides as PNG (ZIP)', icon: 'file-image', run: () => app.exportAs('png-all') },
    '-',
    { label: 'Project file (.zip)', icon: 'save', run: () => app.saveProject() },
  ], { align: 'right' }), { text: 'Export', cls: 'ss-export' })

  const zoomOut = tbtn('Zoom out', 'zoom-out', () => app.stage.setZoom(app.stage.zoom / 1.2), { key: `${MOD}+-`, cls: 'ss-zoomctl' })
  const zoomIn = tbtn('Zoom in', 'zoom-in', () => app.stage.setZoom(app.stage.zoom * 1.2), { key: `${MOD}+=`, cls: 'ss-zoomctl' })
  const zoomBtn = tbtn('Zoom level', null, (e, b) => menu(root, b, [
    { label: 'Fit to window', key: `${MOD}+0`, run: () => app.stage.setZoom('fit') },
    ...[0.5, 0.75, 1, 1.5, 2].map((z) => ({ label: `${z * 100}%`, run: () => app.stage.setZoom(z) })),
  ]), { text: '100%', cls: 'ss-zoom ss-zoomctl' })

  const present = h('div', { class: 'ss-split' },
    tbtn('Present from the beginning', 'monitor-play', () => app.presenter.start({ from: 'start' }), { text: 'Present', cls: 'ss-present-btn', key: 'F5' }),
    tbtn('More present options', 'chevron-down', (e, b) => menu(root, b, [
      { label: 'From the beginning', icon: 'play', key: 'F5', run: () => app.presenter.start({ from: 'start' }) },
      { label: 'From the current slide', icon: 'play', key: 'Shift+F5', run: () => app.presenter.start({ from: 'current' }) },
      { label: 'Presenter view (notes, next slide, timer)', icon: 'monitor', run: () => app.presenter.start({ from: 'current', presenter: true }) },
    ], { align: 'right' }), { cls: 'ss-present-more' }))
  const help = tbtn('Keyboard shortcuts', 'keyboard', () => shortcutsDialog(), { key: '?', cls: 'ss-zoomctl' })

  const el = h('div', { class: 'ss-top', role: 'toolbar', 'aria-label': 'Deck' },
    h('div', { class: 'ss-brand' }, icon('presentation')), title, fileBtn, sep(), undo, redo, h('span', { class: 'ss-grow' }), zoomOut, zoomBtn, zoomIn, sep(), help, exportBtn, present)

  const refresh = () => {
    undo.disabled = !store.canUndo
    redo.disabled = !store.canRedo
    undo.dataset.tip = store.undo.at(-1) ? `Undo ${store.undo.at(-1).label}  ${MOD}+Z` : `Undo  ${MOD}+Z`
    redo.dataset.tip = store.redo.at(-1) ? `Redo ${store.redo.at(-1).label}  ${MOD}+Shift+Z` : `Redo  ${MOD}+Shift+Z`
    if (document.activeElement !== title && title.value !== store.deck.title) title.value = store.deck.title
    zoomBtn.querySelector('span').textContent = `${Math.round(app.stage.zoom * 100)}%`
  }
  app.onDispose(store.on((t) => { if (t === 'change') refresh() }))
  app.onDispose(app.bus.on('zoom', refresh))
  refresh()
  return { el, refresh }
}

// ---------- Ribbon: text and shape formatting ----------
export function buildRibbon(app) {
  const { store, root, format: fmt } = app
  const font = selField('Font', FONTS.map((f) => f[0]), 'Arial', (v) => { fmt.setFont(v); app.stage.editing?.tc.focus({ preventScroll: true }) }, { bare: true })
  font.classList.add('ss-font')
  const size = h('input', { class: 'ss-size', type: 'number', min: 4, max: 400, step: 1, list: 'ss-sizes', 'aria-label': 'Font size',
    onchange: () => { const v = size.valueAsNumber; if (v) fmt.setSize(v) }, onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); size.blur(); app.stage.editing?.tc.focus({ preventScroll: true }) } } })
  const sizes = h('datalist', { id: 'ss-sizes' }, FONT_SIZES.map((s) => h('option', { value: s })))
  const bold = tbtn('Bold', 'bold', () => fmt.toggle('b'), { key: `${MOD}+B`, active: false })
  const italic = tbtn('Italic', 'italic', () => fmt.toggle('i'), { key: `${MOD}+I`, active: false })
  const under = tbtn('Underline', 'underline', () => fmt.toggle('u'), { key: `${MOD}+U`, active: false })
  const textColor = swatchBtn('Text colour', '#000000', (e, b) => colorPicker(root, b, { value: fmt.state().color, colors: colors(app), label: 'Text colour', onPick: (v) => fmt.setColor(v || '@text') }), { text: 'A' })
  const hl = tbtn('Highlight', 'highlighter', (e, b) => colorPicker(root, b, { value: '', colors: colors(app), label: 'Highlight', none: true, onPick: (v) => fmt.setHighlight(v) }))
  const aligns = [['left', 'align-left'], ['center', 'align-center'], ['right', 'align-right'], ['justify', 'align-justify']].map(([a, ic]) => tbtn(`Align ${a}`, ic, () => fmt.align(a), { active: false }))
  const bul = tbtn('Bullets', 'list', () => fmt.bullet('dot'), { active: false })
  const num = tbtn('Numbering', 'list-ordered', () => fmt.bullet('num'), { active: false })
  const outd = tbtn('Decrease indent', 'indent-decrease', () => fmt.indent(-1), { key: 'Shift+Tab' })
  const ind = tbtn('Increase indent', 'indent-increase', () => fmt.indent(1), { key: 'Tab' })
  const fillBtn = swatchBtn('Fill colour', '', (e, b) => {
    const t = store.selected.find((x) => x.type === 'shape' || x.type === 'text')
    colorPicker(root, b, { value: t?.fill || '', colors: colors(app), label: 'Fill colour', none: true, onPick: (v) => app.setProps('Fill', (x) => { if (x.type === 'shape' || x.type === 'text') x.fill = v }) })
  }, { text: 'Fill' })
  const lineBtn = swatchBtn('Outline colour', '', (e, b) => {
    const t = store.selected.find((x) => x.type === 'shape' || x.type === 'line' || x.type === 'text' || x.type === 'image')
    colorPicker(root, b, { value: t?.stroke || '', colors: colors(app), label: 'Outline colour', none: true, onPick: (v) => app.setProps('Outline', (x) => { if (['shape', 'line', 'text', 'image'].includes(x.type)) { x.stroke = v; if (v && !x.sw) x.sw = x.type === 'line' ? 3 : 2 } }) })
  }, { text: 'Line' })

  const textGroup = h('div', { class: 'ss-group' }, font, tbtn('Smaller', 'minus', () => fmt.stepSize(-2)), size, tbtn('Larger', 'plus', () => fmt.stepSize(2)), sizes)
  const el = h('div', { class: 'ss-ribbon', role: 'toolbar', 'aria-label': 'Formatting' },
    textGroup, sep(), bold, italic, under, textColor, hl, sep(), ...aligns, sep(), bul, num, outd, ind, sep(), fillBtn, lineBtn)

  const refresh = () => {
    const s = fmt.state()
    const anyShape = store.selected.some((e) => e.type === 'shape' || e.type === 'text' || e.type === 'line' || e.type === 'image')
    for (const c of [font, size, bold, italic, under, textColor, hl, ...aligns, bul, num, outd, ind]) c.disabled = !s.on
    fillBtn.disabled = !store.selected.some((e) => e.type === 'shape' || e.type === 'text')
    lineBtn.disabled = !anyShape
    if (!s.on) { for (const c of [bold, italic, under, ...aligns, bul, num]) setActive(c, false); size.value = ''; return }
    if (document.activeElement !== size) size.value = s.size || ''
    if (![...font.options].some((o) => o.value === s.font)) font.append(h('option', { value: s.font }, s.font))
    font.value = s.font
    setActive(bold, s.b); setActive(italic, s.i); setActive(under, s.u)
    aligns.forEach((b, i) => setActive(b, ['left', 'center', 'right', 'justify'][i] === s.align))
    setActive(bul, s.bu === 'dot'); setActive(num, s.bu === 'num')
    textColor.setChip(s.color || '#000000')
    const t = store.selected.find((x) => x.type === 'shape' || x.type === 'text')
    fillBtn.setChip(t?.fill ? app.color(t.fill) : '')
    lineBtn.setChip(store.selected[0]?.stroke ? app.color(store.selected[0].stroke) : '')
  }
  const rs = () => requestAnimationFrame(refresh)
  app.onDispose(store.on((t) => { if (t === 'change' || t === 'sel' || t === 'slide') refresh() }))
  app.onDispose(app.bus.on('fmt', rs))
  app.onDispose(app.bus.on('edit', refresh))
  refresh()
  return { el, refresh }
}

// ---------- Tool rail ----------
export function buildRail(app) {
  const { store, root } = app
  const mk = (id, label, ic, key) => tbtn(label, ic, () => app.setTool(id), { key, active: false, cls: 'ss-tool' })
  const sel = mk('select', 'Select', 'mouse-pointer-2', 'V')
  const text = mk('text', 'Text box', 'type', 'T')
  const shape = tbtn('Shapes', 'shapes', (e, b) => {
    const grid = h('div', { class: 'ss-shapes' }, SHAPES.map(([id, name]) => h('button', {
      type: 'button', class: 'ss-shape-pick', title: name, 'aria-label': name, onmousedown: (ev) => ev.preventDefault(),
      onclick: () => { app.setTool('shape', id); p.close() },
    }, svg('svg', { viewBox: '0 0 28 24', width: 28, height: 24 }, svg('path', { d: shapePath(id, 24, 18, 0.25), transform: 'translate(2 3)', fill: 'currentColor', 'fill-rule': 'evenodd' })))))
    const p = popover(root, b, h('div', h('div', { class: 'ss-pop-title' }, 'Shapes'), grid), { label: 'Shapes' })
  }, { key: 'R', active: false, cls: 'ss-tool' })
  const line = mk('line', 'Line', 'minus', 'L')
  const image = tbtn('Picture', 'image-plus', () => app.pickImage(), { key: 'I', cls: 'ss-tool' })
  const table = tbtn('Table', 'table', (e, b) => {
    const rows = 6, cols = 7
    const label = h('div', { class: 'ss-grid-label' }, 'Insert table')
    const cells = []
    const grid = h('div', { class: 'ss-tgrid', style: { '--cols': cols } }, Array.from({ length: rows * cols }, (_, i) => {
      const r = Math.floor(i / cols) + 1, c = (i % cols) + 1
      const cell = h('button', { type: 'button', class: 'ss-tcell', 'aria-label': `${r} by ${c} table`, onmousedown: (ev) => ev.preventDefault(),
        onmouseenter: () => hot(r, c), onfocus: () => hot(r, c), onclick: () => { app.insertTable(r, c); p.close() } })
      cells.push([cell, r, c])
      return cell
    }))
    const hot = (r, c) => { label.textContent = `${r} rows x ${c} columns`; for (const [cell, rr, cc] of cells) cell.classList.toggle('on', rr <= r && cc <= c) }
    const p = popover(root, b, h('div', label, grid), { label: 'Insert table' })
    hot(3, 3)
  }, { cls: 'ss-tool' })
  const tools = { select: sel, text, shape, line }
  const el = h('div', { class: 'ss-rail', role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'vertical' }, sel, text, shape, line, image, table)
  const refresh = () => { for (const [k, b] of Object.entries(tools)) setActive(b, app.tool === k) }
  app.onDispose(app.bus.on('tool', refresh))
  refresh()
  return { el, refresh }
}

// ---------- Status bar ----------
export function buildStatus(app) {
  const { store } = app
  const pos = h('span'), saved = h('span', { class: 'ss-saved' }), info = h('span', { class: 'ss-hint' })
  const el = h('div', { class: 'ss-status' }, pos, h('span', { class: 'ss-grow' }), info, saved)
  const refresh = () => {
    pos.textContent = `Slide ${store.cur + 1} of ${store.deck.slides.length}  ·  ${store.deck.w} x ${store.deck.h} pt`
    const s = store.saveState
    saved.textContent = s === 'saved' ? 'Saved in this browser' : s === 'saving' ? 'Saving...' : s === 'failed' ? 'Could not autosave (storage blocked)' : 'Unsaved changes'
    saved.dataset.state = s
    info.textContent = app.stage.editing ? 'Editing text. Press Esc when you are done.' : 'Double-click text to edit it. Drag to move. Hold Shift to constrain.'
  }
  app.onDispose(store.on(refresh))
  app.onDispose(app.bus.on('edit', refresh))
  refresh()
  return { el, refresh }
}

// ---------- Dialogs ----------
export function shortcutsDialog() {
  const k = (...keys) => h('span', keys.map((x, i) => [i ? ' ' : '', h('kbd', x)]))
  const rows = [
    ['Edit', [[k(MOD, 'Z'), 'Undo'], [k(MOD, 'Shift', 'Z'), 'Redo (also ' + MOD + '+Y)'], [k(MOD, 'C', '/', 'X', '/', 'V'), 'Copy, cut, paste'], [k(MOD, 'D'), 'Duplicate'], [k('Delete'), 'Delete selection'], [k(MOD, 'A'), 'Select all on the slide'], [k('Arrows'), 'Nudge (Shift = 10 pt)'], [k(MOD, '[', ']'), 'Send backward or forward']]],
    ['Text', [[k('Enter'), 'Start typing in the selected box (or double-click)'], [k('Esc'), 'Finish editing'], [k(MOD, 'B', '/', 'I', '/', 'U'), 'Bold, italic, underline'], [k('Tab'), 'Indent a bullet (Shift+Tab to outdent)']]],
    ['Slides', [[k(MOD, 'M'), 'New slide'], [k('PgUp', '/', 'PgDn'), 'Previous or next slide'], [k('F5'), 'Present from the beginning'], [k('Shift', 'F5'), 'Present from the current slide']]],
    ['Tools', [[k('V', 'T', 'R', 'L'), 'Select, text, shape, line (when nothing is selected)'], [k(MOD, 'S'), 'Save project file'], [k(MOD, '0'), 'Zoom to fit'], [k(MOD, 'wheel'), 'Zoom']]],
    ['While presenting', [[k('Space', '/', '→'), 'Next'], [k('←', '/', 'Backspace'), 'Previous'], [k('B', '/', 'W'), 'Black or white screen'], [k('Esc'), 'Exit']]],
  ]
  modal({ title: 'Slides Studio shortcuts', icon: 'keyboard', body: rows.map(([t, items]) => h('div', { class: 'ss-keys' }, h('h3', t), h('table', { class: 'table' }, h('tbody', items.map(([a, b]) => h('tr', h('td', a), h('td', b))))))) })
}

export function newDeckDialog(app) {
  let pick = 'blank', size = '16:9'
  const cards = TEMPLATES.map((t) => {
    const c = h('button', { type: 'button', class: ['ss-tpl', t.id === pick && 'on'], 'aria-pressed': String(t.id === pick), onclick: () => { pick = t.id; for (const x of cards) { x.classList.toggle('on', x === c); x.setAttribute('aria-pressed', String(x === c)) } } },
      h('b', t.name), h('span', t.desc), h('small', `Theme: ${THEMES.find((x) => x.id === t.theme)?.name}`))
    return c
  })
  const m = modal({
    title: 'New deck', icon: 'file-plus',
    body: [
      alert('info', 'This replaces the deck in the editor. You can undo it, and your current deck stays in the autosave until you change something.'),
      h('div', { class: 'ss-tpls' }, cards),
      selField('Slide size', SIZES.map((s) => [s[0], s[1]]), size, (v) => { size = v }),
    ],
    actions: [button('Create deck', { variant: 'primary', icon: 'check', onClick: () => { const sz = SIZES.find((s) => s[0] === size); app.replaceDeck(buildTemplate(pick, { w: sz[2], h: sz[3] }), [], 'New deck'); m.close() } })],
  })
}

export function outlineDialog(app) {
  const ta = h('textarea', { class: 'textarea ss-outline', rows: 12, placeholder: 'Product launch\n  Q3 plan\nWhy now\n  - Market is growing\n  - Customers asked for it\nRoadmap\n  - Beta in July\n  - Public launch in September', 'aria-label': 'Outline',
    onkeydown: (e) => e.stopPropagation() })
  const m = modal({
    title: 'Slides from an outline', icon: 'list',
    body: [h('p', 'One line per slide title. Indented lines (or lines starting with "- ") become bullets on that slide.'), ta],
    actions: [button('Create slides', { variant: 'primary', icon: 'wand-sparkles', onClick: () => {
      if (!ta.value.trim()) { toast('Type or paste an outline first.', 'error'); return }
      const d = deckFromOutline(ta.value, { theme: app.store.deck.theme, w: app.store.deck.w, h: app.store.deck.h })
      app.replaceDeck(d, [], 'Slides from outline'); m.close()
    } })],
  })
  setTimeout(() => ta.focus(), 50)
}

export const pickProjectFiles = () => pickFiles({ accept: '.zip,.json,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip' })
