// Draw Studio colour palette and colour dialog. Left click a swatch = fill, right click = outline, the X swatch = no fill (left) or no outline
// (right). On a phone there is no right click, so a Fill | Outline chip chooses what a tap sets. Tabs: Default, Document (colours used on this
// page plus the ones added to the document), Recent. Colours are RGB hex everywhere; CMYK is only a way to type a colour (the dialog says so).
// Only validated #rrggbb strings ever reach a style attribute.
import { h, icon, button, modal } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { DEFAULT_PALETTE, cmykFromRgb, hexToRgb, normHex, rgbFromCmyk, rgbToHex, usedColors } from './_ds-colors.js'

const RECENT_KEY = 'ds-recent-colors'
const TABS = [['default', 'Default'], ['doc', 'Document'], ['recent', 'Recent']]
// on a phone the three tabs collapse to one button that cycles through them
const phone = () => window.matchMedia('(max-width: 860px)').matches
const HEX = /^#[0-9a-f]{6}$/
export const safeHex = (v) => (typeof v === 'string' && HEX.test(v) ? v : null)
const KIND_WORD = { fill: 'Fill', stroke: 'Outline' }

export function createPalette({ store, app }) {
  let target = 'fill'
  let tab = 'default'
  let recent = (() => { const v = load(RECENT_KEY, []); return Array.isArray(v) ? v.map(safeHex).filter(Boolean).slice(0, 24) : [] })()
  let lastRoot = null, lastPage = null

  const mkSwatch = (hex, label) => {
    if (!safeHex(hex)) return null
    const b = h('button', { type: 'button', class: 'ds-sw', 'data-hex': hex, 'aria-label': `${KIND_WORD.fill} ${label} (left click), outline (right click)`, title: `${label}  left click: fill, right click: outline` })
    b.style.background = hex
    return b
  }
  const none = h('button', { type: 'button', class: 'ds-sw ds-sw-x', 'aria-label': 'No fill (left click), no outline (right click)', title: 'No colour  left click: no fill, right click: no outline' })
  const chip = h('button', { type: 'button', class: 'ds-chip', 'aria-pressed': 'false', 'aria-label': 'Colour target: fill. Switch to outline', onclick: () => { target = target === 'fill' ? 'stroke' : 'fill'; syncChip() } }, h('span', 'Fill'))
  const more = h('button', { type: 'button', class: 'ds-pal-more', 'aria-label': 'Open the colour dialog', title: 'More colours...', onclick: () => app.colorDialog(target) }, icon('sliders-horizontal'))
  const grid = h('div', { class: 'ds-sw-grid', role: 'group', 'aria-label': 'Colours', tabindex: -1 }) // a scrolling box is focusable by default: the swatches are the one Tab stop
  const tabs = TABS.map(([id, label]) => h('button', { type: 'button', role: 'tab', class: 'ds-pal-tab', 'data-tab': id, 'aria-selected': String(id === tab), title: `${label} colours`, 'aria-label': `${label} colours`, onclick: () => { tab = phone() && id === tab ? TABS[(TABS.findIndex(([x]) => x === id) + 1) % TABS.length][0] : id; renderGrid(true) } }, label.slice(0, 3)))
  const tabbar = h('div', { class: 'ds-pal-tabs', role: 'tablist', 'aria-label': 'Palette' }, tabs)
  const el = h('div', { class: 'ds-palette', role: 'group', 'aria-label': 'Colour palette' }, h('div', { class: 'ds-pal-head' }, none, chip, more), grid, tabbar)

  function syncChip() {
    const out = target === 'stroke'
    chip.setAttribute('aria-pressed', String(out))
    chip.setAttribute('aria-label', `Colour target: ${out ? 'outline' : 'fill'}. Switch to ${out ? 'fill' : 'outline'}`)
    chip.firstChild.textContent = out ? 'Outline' : 'Fill'
  }
  const chipVisible = () => chip.offsetParent !== null
  const kindFor = (e) => (e.type === 'contextmenu' || e.shiftKey ? 'stroke' : chipVisible() ? target : 'fill')

  function apply(kind, hex) { app.paint(kind, hex) }
  grid.addEventListener('click', (e) => { const sw = e.target.closest('.ds-sw[data-hex]'); if (sw) apply(kindFor(e), sw.dataset.hex) })
  grid.addEventListener('contextmenu', (e) => { e.preventDefault(); const sw = e.target.closest('.ds-sw[data-hex]'); if (sw) apply('stroke', sw.dataset.hex) })
  none.addEventListener('click', (e) => apply(kindFor(e), null))
  none.addEventListener('contextmenu', (e) => { e.preventDefault(); apply('stroke', null) })
  // the arrow keys belong to the swatches here, never to nudging the selection. The X swatch and the grid are ONE Tab stop (roving focus: the swatch last focused).
  const swatches = () => [...el.querySelectorAll('.ds-sw')]
  let rover = none
  const setRover = (b) => { rover = b; for (const x of swatches()) x.tabIndex = x === b ? 0 : -1 }
  el.addEventListener('focusin', (e) => { const sw = e.target.closest?.('.ds-sw'); if (sw && sw !== rover) setRover(sw) })
  el.addEventListener('keydown', (e) => {
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
      const list = swatches()
      const i = list.indexOf(document.activeElement)
      if (i >= 0) { e.preventDefault(); list[e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)))].focus() }
      e.stopPropagation()
    }
  })

  function colorsFor(which) {
    if (which === 'recent') return recent.map((hex) => ({ hex }))
    if (which === 'doc') {
      const seen = new Set(), out = []
      for (const hex of store.root.palette || []) if (!seen.has(hex)) { seen.add(hex); out.push({ hex, note: 'added to this document' }) }
      for (const { hex, count } of usedColors(store.root, store.page()?.id)) if (!seen.has(hex)) { seen.add(hex); out.push({ hex, note: `used ${count} time${count === 1 ? '' : 's'}` }) }
      return out
    }
    return DEFAULT_PALETTE.map((hex) => ({ hex }))
  }
  function renderGrid(force) {
    for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.tab === tab))
    if (!force && tab !== 'doc') return
    if (!force && lastRoot === store.root && lastPage === store.page()?.id) return
    lastRoot = store.root; lastPage = store.page()?.id
    const list = colorsFor(tab)
    grid.replaceChildren(...list.map(({ hex, note }) => mkSwatch(hex, note ? `${hex} (${note})` : hex)).filter(Boolean))
    setRover(swatches().includes(rover) ? rover : none)
    if (!list.length) grid.append(h('span', { class: 'ds-pal-empty' }, tab === 'recent' ? 'Colours you use appear here.' : 'No colours yet.'))
  }
  renderGrid(true)

  return {
    el,
    refresh: () => renderGrid(false),
    get target() { return target },
    /** Remember a colour in the Recent tab. */
    noteColor(hex) {
      hex = safeHex(hex)
      if (!hex) return
      recent = [hex, ...recent.filter((x) => x !== hex)].slice(0, 24)
      save(RECENT_KEY, recent)
      if (tab === 'recent') renderGrid(true)
    },
  }
}

// ---------- colour dialog ----------
const CMYK_ROWS = [['C', 'Cyan'], ['M', 'Magenta'], ['Y', 'Yellow'], ['K', 'Black']]
const RGB_ROWS = [['R', 'Red'], ['G', 'Green'], ['B', 'Blue']]

/**
 * Colour dialog with old and new preview, CMYK, RGB and HEX fields that stay in step.
 * opts: {kind: 'fill'|'stroke', hex, K ([c,m,y,k] 0..1 hint), onApply(hex, K|null), onAddToPalette(hex)}. Returns the modal handle.
 */
export function openColorDialog({ kind = 'fill', hex = '#000000', K = null, onApply, onAddToPalette }) {
  const start = safeHex(normHex(hex)) || '#000000'
  let rgb = hexToRgb(start)
  let cmyk = K ? K.map((v) => Math.round(v * 100)) : cmykFromRgb(...rgb).map((v) => Math.round(v * 100))
  let usedCmyk = !!K
  const oldSw = h('span', { class: 'ds-cd-sw', 'aria-label': 'Old colour' }), newSw = h('span', { class: 'ds-cd-sw', 'aria-label': 'New colour' })
  oldSw.style.background = start
  const rows = []
  const row = (letter, name, max, get, set) => {
    const range = h('input', { type: 'range', min: 0, max, step: 1, 'aria-label': `${name} slider` })
    const numIn = h('input', { type: 'number', min: 0, max, step: 1, class: 'input', 'aria-label': name })
    const onIn = (src) => (e) => { const v = Math.max(0, Math.min(max, Math.round(+e.target.value || 0))); set(v); sync(src) }
    range.addEventListener('input', onIn(range)); numIn.addEventListener('input', onIn(numIn))
    rows.push({ range, numIn, get })
    return h('div', { class: 'ds-cd-row' }, h('span', { class: 'ds-cd-l', title: name }, letter), range, numIn)
  }
  const hexIn = h('input', { type: 'text', class: 'input', maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Hex colour' })
  hexIn.addEventListener('input', () => { const v = normHex(hexIn.value); if (v) { rgb = hexToRgb(v); usedCmyk = false; cmyk = cmykFromRgb(...rgb).map((x) => Math.round(x * 100)); sync(hexIn) } })
  const cm = CMYK_ROWS.map(([l, n], i) => row(l, n, 100, () => cmyk[i], (v) => { cmyk[i] = v; usedCmyk = true; rgb = rgbFromCmyk(...cmyk.map((x) => x / 100)) }))
  const rg = RGB_ROWS.map(([l, n], i) => row(l, n, 255, () => rgb[i], (v) => { rgb[i] = v; usedCmyk = false; cmyk = cmykFromRgb(...rgb).map((x) => Math.round(x * 100)) }))
  function sync(src) {
    const hx = rgbToHex(...rgb)
    newSw.style.background = hx
    for (const r of rows) { const v = String(r.get()); if (r.range !== src) r.range.value = v; if (r.numIn !== src) r.numIn.value = v }
    if (hexIn !== src) hexIn.value = hx
  }
  sync(null)
  const finish = (fn) => () => { fn(rgbToHex(...rgb), usedCmyk ? cmyk.map((x) => x / 100) : null) }
  const body = h('div', { class: 't-ds-dlg ds-cd' },
    h('div', { class: 'ds-cd-prev' }, h('div', h('small', 'Old'), oldSw), h('div', h('small', 'New'), newSw)),
    h('div', { class: 'ds-cd-grid' }, h('div', { class: 'ds-cd-col' }, h('strong', 'CMYK'), ...cm), h('div', { class: 'ds-cd-col' }, h('strong', 'RGB'), ...rg)),
    h('label', { class: 'ds-cd-hex' }, h('span', 'Hex'), hexIn),
    h('p', { class: 'small muted' }, 'Colours are stored as RGB in the drawing and in every file. CMYK is a convenient way to type a colour, with no colour profile.'))
  let m
  const apply = button('Apply', { variant: 'primary', onClick: finish((hx, k) => { m.close(); onApply?.(hx, k) }) })
  const add = button('Add to palette', { variant: 'secondary', onClick: finish((hx) => { onAddToPalette?.(hx) }) })
  m = modal({ title: `${KIND_WORD[kind] || 'Fill'} colour`, icon: kind === 'stroke' ? 'pen-line' : 'paint-bucket', body, actions: [button('Cancel', { variant: 'secondary', onClick: () => m.close() }), add, apply] })
  return m
}
