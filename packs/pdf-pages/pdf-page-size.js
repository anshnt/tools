// PDF page-size detector: every page's size in mm / in / pt, a named paper size (A4, Letter...) with tolerance, and orientation.
import { h, icon, button, segmented, select, field, stats, table, empty, clear, downloadButton, copyButton, alert } from '../../lib/ui.js'
import { pdfSource, ppRoot, useStyle, identifyPaper, orientationOf, toMm, toIn, round, compressRanges, toCSV, pageThumb, pop, countUp } from './_shared.js'

const PALETTE = ['#3e63dd', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#e2a336']

const UNITS = {
  mm: { label: 'mm', f: (pt) => round(toMm(pt), 1), text: (pt) => `${round(toMm(pt), 1)}` },
  in: { label: 'in', f: (pt) => round(toIn(pt), 2), text: (pt) => `${round(toIn(pt), 2)}` },
  pt: { label: 'pt', f: (pt) => round(pt, 1), text: (pt) => `${round(pt, 1)}` },
}

/** Group page sizes: same named size + orientation (or same rounded size) -> one group. Pure, exported for tests. */
export function groupSizes(sizes, tolMm = 2) {
  const groups = new Map()
  sizes.forEach((sz, i) => {
    const paper = identifyPaper(sz.w, sz.h, tolMm)
    const orient = orientationOf(sz.w, sz.h)
    const key = paper ? `${paper.name}|${orient}` : `${round(toMm(sz.w) * 2, 0) / 2}x${round(toMm(sz.h) * 2, 0) / 2}`
    if (!groups.has(key)) groups.set(key, { key, name: paper?.name || 'Custom', orient, w: sz.w, h: sz.h, pages: [], exact: true })
    const g = groups.get(key)
    g.pages.push(i + 1)
    if (paper && !paper.exact) g.exact = false
  })
  return [...groups.values()].sort((a, b) => b.pages.length - a.pages.length)
}

export function mount(root) {
  const body = h('div', { class: 'stack' })
  const state = { unit: 'mm', tol: 2, filter: null }
  let s

  const src = pdfSource({
    onLoad: async (source) => {
      s = source
      clear(body, empty('Measuring pages...', 'ruler'))
      await s.pageSizes()
      render()
    },
    onClear: () => { s = null; clear(body) },
  })

  function render() {
    const list = Array.from({ length: s.pages }, (_, i) => s.sizeOf(i + 1))
    const groups = groupSizes(list, state.tol)
    const u = UNITS[state.unit]
    const mixed = groups.length > 1
    const main = groups[0]
    const dim = (g) => `${u.text(Math.min(g.w, g.h))} x ${u.text(Math.max(g.w, g.h))} ${u.label}`
    const rotated = list.filter((x) => x.rot).length

    const statsEl = stats([
      { label: 'Pages', value: h('span', { 'data-n': s.pages }, '0'), accent: true },
      { label: 'Different sizes', value: h('span', { 'data-n': groups.length }, '0'), danger: false, hint: mixed ? 'Mixed sizes' : 'All pages match' },
      { label: 'Most common', value: main.name, hint: `${main.orient}, ${main.pages.length} of ${s.pages} pages` },
      { label: `Size (${u.label})`, value: `${u.text(Math.min(main.w, main.h))} x ${u.text(Math.max(main.w, main.h))}`, hint: main.exact ? 'Exact match' : 'Close match' },
    ])
    for (const el of statsEl.querySelectorAll('[data-n]')) countUp(el, +el.dataset.n)

    const total = Math.max(...list.map((x) => Math.max(x.w, x.h)))
    const scale = 118 / total
    const cards = h('div', { class: 'pp-masonry pp-size-groups' }, groups.map((g, i) => {
      const color = PALETTE[i % PALETTE.length]
      const thumb = pageThumb(s, g.pages[0], { max: 200 })
      const pw = Math.max(34, Math.min(g.w, g.h) * scale), ph = Math.max(34, Math.max(g.w, g.h) * scale)
      const art = h('div', { class: 'pp-size-art' }, h('div', { style: { width: `${g.w >= g.h ? ph : pw}px` } }, thumb))
      const card = h('button', {
        type: 'button', class: ['pp-size-card', state.filter === g.key && 'active'], style: { '--c': color }, 'aria-pressed': String(state.filter === g.key),
        title: state.filter === g.key ? 'Show all pages' : 'Show only these pages in the table',
        onclick: () => { state.filter = state.filter === g.key ? null : g.key; render() },
      }, art,
      h('div', { class: 'pp-size-info' },
        h('div', { class: 'pp-size-name' }, g.name, h('span', { class: 'pp-chip plain' }, g.orient)),
        h('div', { class: 'pp-size-dim' }, dim({ w: g.w, h: g.h })),
        h('div', { class: 'pp-size-pages' }, `${g.pages.length} ${g.pages.length === 1 ? 'page' : 'pages'}: `, h('b', compressRanges(g.pages)))))
      return pop(card, i)
    }))

    const rows = []
    list.forEach((sz, i) => {
      const paper = identifyPaper(sz.w, sz.h, state.tol)
      const key = paper ? `${paper.name}|${orientationOf(sz.w, sz.h)}` : null
      const g = groups.find((x) => x.pages.includes(i + 1))
      if (state.filter && g.key !== state.filter) return
      rows.push([i + 1, u.text(sz.w), u.text(sz.h), paper ? `${paper.name}${paper.exact ? '' : ' (close)'}` : 'Custom', orientationOf(sz.w, sz.h), sz.rot ? `${sz.rot} deg` : '-', key])
    })
    const tbl = table({ columns: [{ label: 'Page', num: true }, { label: `Width (${u.label})`, num: true }, { label: `Height (${u.label})`, num: true }, 'Paper', 'Orientation', 'Rotation'], rows: rows.map((r) => r.slice(0, 6)), max: 2000 })

    const csv = () => toCSV([['Page', 'Width mm', 'Height mm', 'Width in', 'Height in', 'Width pt', 'Height pt', 'Paper', 'Orientation', 'Rotation'],
      ...list.map((sz, i) => {
        const paper = identifyPaper(sz.w, sz.h, state.tol)
        return [i + 1, round(toMm(sz.w), 2), round(toMm(sz.h), 2), round(toIn(sz.w), 3), round(toIn(sz.h), 3), round(sz.w, 2), round(sz.h, 2), paper?.name || 'Custom', orientationOf(sz.w, sz.h), sz.rot || 0]
      })])
    const text = () => list.map((sz, i) => { const p = identifyPaper(sz.w, sz.h, state.tol); return `Page ${i + 1}: ${u.text(sz.w)} x ${u.text(sz.h)} ${u.label} (${p?.name || 'Custom'}, ${orientationOf(sz.w, sz.h)})` }).join('\n')

    clear(body,
      statsEl,
      mixed
        ? alert('warn', h('strong', 'This PDF mixes page sizes. '), `${groups.length} different sizes found. Use Normalize page size to make them all the same.`)
        : alert('success', `Every page is ${main.name} ${main.orient.toLowerCase()}${main.exact ? '' : ' (within tolerance)'}.`),
      rotated ? h('div', { class: 'pp-hint' }, `${rotated} ${rotated === 1 ? 'page has' : 'pages have'} a /Rotate flag. Sizes show the page as displayed, with rotation applied.`) : null,
      h('div', { class: 'pp-toolbar' },
        field('Units', segmented([['mm', 'mm'], ['in', 'inches'], ['pt', 'points']], state.unit, (v) => { state.unit = v; render() }, 'Units')),
        field('Name match tolerance', select([[1, '+/- 1 mm'], [2, '+/- 2 mm'], [5, '+/- 5 mm'], [10, '+/- 10 mm']], state.tol, (v) => { state.tol = +v; state.filter = null; render() }), null),
        h('span', { class: 'grow' }),
        copyButton(text, 'Copy list'),
        downloadButton(() => new Blob([csv()], { type: 'text/csv' }), 'page-sizes.csv', 'Download CSV', { variant: 'secondary', size: 'sm' })),
      h('div', { class: 'pp-section-title' }, icon('layout-grid'), mixed ? 'Sizes found (to scale). Click one to filter the table.' : 'Page size (to scale)'),
      cards,
      h('div', { class: 'pp-section-title' }, icon('table'), state.filter ? `Pages in the selected size (${rows.length})` : `All ${s.pages} pages`),
      tbl)
  }

  useStyle('pp-style-size', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-size-groups { columns: 3 240px; }
.pp .pp-size-card { all: unset; box-sizing: border-box; display: flex; gap: 14px; align-items: flex-end; width: 100%; padding: 14px; border-radius: 18px; cursor: pointer; position: relative; overflow: hidden; isolation: isolate;
  background: linear-gradient(150deg, color-mix(in srgb, var(--c) 11%, var(--surface)), var(--surface) 70%); border: 1px solid color-mix(in srgb, var(--c) 22%, var(--border));
  transition: transform .35s var(--spring), box-shadow .3s, border-color .25s; }
.pp .pp-size-card::after { content: ""; position: absolute; width: 140px; height: 140px; right: -50px; top: -60px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--c) 30%, transparent), transparent 70%); z-index: -1; transition: transform .6s var(--ease); }
.pp .pp-size-card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px -22px color-mix(in srgb, var(--c) 60%, rgba(0,0,0,.4)); }
.pp .pp-size-card:hover::after { transform: scale(1.5); }
.pp .pp-size-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pp .pp-size-card.active { border-color: var(--c); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 28%, transparent); }
.pp .pp-size-art { flex: none; display: grid; place-items: end center; min-width: 40px; }
.pp .pp-size-info { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.pp .pp-size-name { font-weight: 650; font-size: 17px; letter-spacing: -.02em; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pp .pp-size-dim { font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }
.pp .pp-size-pages { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.pp .pp-size-pages b { color: var(--text-2); font-weight: 600; }
`
