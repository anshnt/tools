// Folder size analyzer: pick a folder and see where the space goes - an expandable tree sorted by size, a treemap you can drill into,
// the largest files, size by file type, and CSV export. Read-only and local: nothing is uploaded and nothing is changed.
import { h, icon, clear, button, tabs, table, stats, alert, empty, formatBytes, download, select, input, field, copyText, onCleanup } from '../../lib/ui.js'
import { KINDS, kindOfName, extOf, buildTree, fmtDateTime, naturalCompare } from './_core.js'
import { useFx, folderZone, card, chip, chips, tile, openPreview, injectStyle, countUp, reduceMotion } from './_ui.js'

// ---------- Pure helpers ----------
/**
 * Squarified treemap. items: [{value, ...}] (any order). Lays them out in rect {x, y, w, h}; returns [{...item, x, y, w, h}].
 * Items with value <= 0 are dropped.
 */
export function squarify(items, rect) {
  const list = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value)
  const total = list.reduce((s, i) => s + i.value, 0)
  if (!total) return []
  const scale = (rect.w * rect.h) / total
  const nodes = list.map((i) => ({ ...i, area: i.value * scale }))
  const out = []
  let r = { ...rect }
  let row = []
  const sum = (a) => a.reduce((s, n) => s + n.area, 0)
  const worst = (rw, side) => {
    const s = sum(rw)
    let mx = 0, mn = Infinity
    for (const n of rw) { mx = Math.max(mx, n.area); mn = Math.min(mn, n.area) }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn))
  }
  const place = (rw) => {
    const s = sum(rw)
    if (r.w >= r.h) {
      const cw = s / r.h
      let y = r.y
      for (const n of rw) { const hh = n.area / cw; out.push({ ...n, x: r.x, y, w: cw, h: hh }); y += hh }
      r = { x: r.x + cw, y: r.y, w: r.w - cw, h: r.h }
    } else {
      const rh = s / r.w
      let x = r.x
      for (const n of rw) { const ww = n.area / rh; out.push({ ...n, x, y: r.y, w: ww, h: rh }); x += ww }
      r = { x: r.x, y: r.y + rh, w: r.w, h: r.h - rh }
    }
  }
  for (let i = 0; i < nodes.length;) {
    const side = Math.min(r.w, r.h)
    if (!row.length || worst([...row, nodes[i]], side) <= worst(row, side)) row.push(nodes[i++])
    else { place(row); row = [] }
  }
  if (row.length) place(row)
  return out
}

const pct = (a, b) => (b ? (a / b) * 100 : 0)
const fmtPct = (p) => (p >= 10 ? `${Math.round(p)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : p > 0 ? '<0.1%' : '0%')
const hue = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x }
const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`

/** Aggregate entries by extension. Returns [{ext, kind, count, size}] sorted by size. */
export function byExtension(entries) {
  const m = new Map()
  for (const e of entries) {
    const ext = extOf(e.name) || '(none)'
    const r = m.get(ext) || m.set(ext, { ext, kind: kindOfName(e.name), count: 0, size: 0 }).get(ext)
    r.count++
    r.size += e.size
  }
  return [...m.values()].sort((a, b) => b.size - a.size)
}

const CSS = `
.fx-tree { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
.fx-tr { display: grid; grid-template-columns: minmax(0, 1fr) 170px 88px 56px; gap: 10px; align-items: center; padding: 6px 12px; border-top: 1px solid var(--border); font-size: 13.5px; min-height: 40px; }
.fx-tr:first-child { border-top: 0; }
.fx-tr.head { background: var(--surface-2); color: var(--muted); font: 600 12px var(--font, inherit); text-transform: uppercase; letter-spacing: .04em; position: sticky; top: 0; z-index: 1; }
.fx-tr .nm { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fx-tr .nm .t { overflow-wrap: anywhere; min-width: 0; }
.fx-tr .nm .cnt { color: var(--muted); font-size: 12px; white-space: nowrap; }
.fx-tr .tg { display: inline-grid; place-items: center; width: 24px; height: 24px; flex: none; border-radius: 8px; border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 0; transition: transform .2s var(--ease), background .2s; }
.fx-tr .tg:hover { background: var(--surface-3); }
.fx-tr .tg[aria-expanded=true] { transform: rotate(90deg); }
.fx-tr .tg .icon { width: 16px; height: 16px; }
.fx-tr .sp { width: 24px; flex: none; }
.fx-tr .sz { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
.fx-tr .pc { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; font-size: 12.5px; }
.fx-tr.dir > .nm { font-weight: 600; }
.fx-tr .pv { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 2px; border-radius: 6px; display: inline-grid; place-items: center; }
.fx-tr .pv:hover { color: var(--accent); background: var(--surface-3); }
.fx-tr .pv .icon { width: 15px; height: 15px; }
.fx-more { padding: 8px 12px 8px 44px; color: var(--muted); font-size: 12.5px; border-top: 1px solid var(--border); }
@media (max-width: 640px) {
  .fx-tr { grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 8px 10px; }
  .fx-tr.head { display: none; }
  .fx-tr .bar-c { grid-column: 1 / -1; grid-row: 2; }
  .fx-tr .pc { display: none; }
}
.fx-tm { position: relative; width: 100%; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); background: var(--surface-2); }
.fx-tm > button { position: absolute; overflow: hidden; padding: 6px 7px; text-align: left; font: inherit; color: var(--text); cursor: pointer; border-radius: 6px; line-height: 1.25;
  background: color-mix(in srgb, var(--c) 24%, var(--surface)); border: 1px solid color-mix(in srgb, var(--c) 55%, var(--surface)); outline-offset: -2px; transition: filter .2s, transform .2s var(--ease); display: flex; flex-direction: column; gap: 2px; box-sizing: border-box; }
.fx-tm > button:hover, .fx-tm > button:focus-visible { filter: brightness(1.06) saturate(1.2); z-index: 2; border-color: var(--c); }
.fx-tm > button b { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fx-tm > button span { font-size: 11.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fx-tm > button.dir { border-style: dashed; }
.fx-tm > button.dir b::before { content: ""; display: inline-block; width: 7px; height: 7px; border-radius: 2px; background: var(--c); margin-right: 5px; }
.fx-tm > button.pop { animation: fx-pop .45s var(--spring) both; animation-delay: calc(var(--i, 0) * 12ms); }
.fx-crumbs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 13px; }
.fx-crumbs button { border: 0; background: var(--surface-2); border-radius: 8px; padding: 3px 9px; cursor: pointer; color: var(--text); font: inherit; font-weight: 550; }
.fx-crumbs button:hover { background: var(--surface-3); }
.fx-crumbs .sep { color: var(--muted); }
.fx-kindbar { display: flex; height: 16px; border-radius: 99px; overflow: hidden; background: var(--surface-2); }
.fx-kindbar > i { display: block; height: 100%; background: var(--c); width: var(--w); transform-origin: left; animation: fx-grow .8s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms); }
.fx-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--text-2); }
.fx-legend span { display: inline-flex; align-items: center; gap: 6px; }
.fx-legend i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); display: inline-block; }
`

export function mount(root) {
  useFx()
  injectStyle('fx-foldersize', CSS)
  const out = h('div', { class: 'stack' })
  let scan = null, tree = null
  const zone = folderZone({ write: false, label: 'Drop a folder here or click to choose one', onFolder: (res) => analyse(res) })
  root.append(h('div', { class: 'stack fx' }, zone, out))

  function analyse(res) {
    scan = res
    const t0 = performance.now()
    tree = buildTree(res.name, res.entries, res.folders)
    const ms = Math.round(performance.now() - t0)
    const total = tree.size
    const files = res.entries
    const biggest = files.reduce((m, e) => (e.size > (m?.size ?? -1) ? e : m), null)
    const depth = Math.max(0, ...files.map((e) => (e.dir ? e.dir.split('/').length : 0)))
    zone.classList.add('compact')
    const totalEl = h('div', { class: 'value' }, formatBytes(total))
    const s = stats([
      { label: 'Total size', value: '', accent: true, hint: `${total.toLocaleString()} bytes` },
      { label: 'Files', value: files.length.toLocaleString() },
      { label: 'Folders', value: Math.max(res.folders.length, new Set(files.map((e) => e.dir).filter(Boolean)).size).toLocaleString(), hint: `${depth} levels deep` },
      { label: 'Average file', value: formatBytes(files.length ? total / files.length : 0) },
      { label: 'Largest file', value: formatBytes(biggest?.size ?? 0), hint: biggest ? biggest.name : '' },
    ])
    const tv = s.querySelector('.stat.accent .value')
    tv.replaceWith(totalEl)
    countUp(totalEl, total, formatBytes, 700)
    clear(out, h('div', { class: 'fx-hero fx-in', style: { '--k': '#d99a1e' } }, h('div', { class: 'fx-tile lg', style: { '--k': '#d99a1e' } }, icon('folder-tree')),
      h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, res.name), h('div', { class: 'fx-sub' }, `${formatBytes(total)} in ${files.length.toLocaleString()} files`),
        chips(chip('Read on this device', 'ok', 'shield-check'), res.truncated ? chip('Stopped at the file limit', 'warn', 'triangle-alert') : null, chip(`Analysed in ${ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'}`, '', 'timer')))),
    s,
    tabs([
      { id: 'tree', label: 'Folders', render: () => treeView() },
      { id: 'map', label: 'Treemap', render: () => treemapView() },
      { id: 'big', label: 'Largest files', render: () => bigView() },
      { id: 'types', label: 'File types', render: () => typesView() },
    ], 'tree'),
    exportRow())
  }

  // ----- Folders tab -----
  function childrenOf(node) {
    const items = []
    for (const c of node.children.values()) items.push({ dir: true, node: c, name: c.name, size: c.size, count: c.count })
    for (const f of node.files) items.push({ dir: false, file: f, name: f.name, size: f.size })
    return items.sort((a, b) => b.size - a.size || naturalCompare(a.name, b.name))
  }
  function treeView() {
    const box = h('div', { class: 'fx-tree' }, h('div', { class: 'fx-tr head' }, h('span', 'Name'), h('span', 'Share of folder'), h('span', { style: 'text-align:right' }, 'Size'), h('span', { style: 'text-align:right' }, '%')))
    const wrapper = h('div', { style: 'max-height:640px;overflow:auto' }, box)
    const LIMIT = 150
    const rowFor = (item, parent, depth) => {
      const p = pct(item.size, parent.size)
      const k = item.dir ? KINDS.folder : KINDS[kindOfName(item.name)] || KINDS.other
      const bar = h('div', { class: 'fx-bar bar-c', style: { '--w': `${Math.max(p, item.size ? 1.5 : 0)}%`, '--k': item.dir ? '#d99a1e' : k.color } }, h('i'))
      const row = h('div', { class: ['fx-tr', item.dir && 'dir'], dataset: { depth } })
      const toggle = item.dir && item.node.size + item.node.count > 0 ? h('button', { class: 'tg', type: 'button', 'aria-expanded': 'false', 'aria-label': `Expand ${item.name}` }, icon('chevron-right')) : h('span', { class: 'sp' })
      row.append(h('div', { class: 'nm', style: { paddingLeft: `${depth * 18}px` } }, toggle, tile(item.name, { size: 'sm', kind: item.dir ? 'folder' : undefined }),
        h('span', { class: 't', title: item.dir ? item.node.path : item.file.path }, item.name), item.dir ? h('span', { class: 'cnt' }, `${item.count.toLocaleString()} file${item.count === 1 ? '' : 's'}`) : null,
        !item.dir ? h('button', { class: 'pv', type: 'button', 'aria-label': `Preview ${item.name}`, title: 'Preview', onclick: (e) => { e.stopPropagation(); openPreview(item.file.file, { name: item.file.path }) } }, icon('eye')) : null),
      bar, h('div', { class: 'sz' }, formatBytes(item.size)), h('div', { class: 'pc' }, fmtPct(p)))
      if (item.dir && toggle.tagName === 'BUTTON') {
        let kids = []
        toggle.addEventListener('click', () => {
          const open = toggle.getAttribute('aria-expanded') === 'true'
          toggle.setAttribute('aria-expanded', String(!open))
          toggle.setAttribute('aria-label', `${open ? 'Expand' : 'Collapse'} ${item.name}`)
          if (open) { kids.forEach((n) => n.remove()); kids = []; return }
          const list = childrenOf(item.node)
          const shown = list.slice(0, LIMIT)
          kids = shown.map((c) => rowFor(c, item.node, depth + 1))
          if (list.length > LIMIT) {
            const rest = list.slice(LIMIT)
            kids.push(h('div', { class: 'fx-more', style: { paddingLeft: `${44 + (depth + 1) * 18}px` } }, `${rest.length.toLocaleString()} smaller items (${formatBytes(rest.reduce((s, r) => s + r.size, 0))}) not shown`))
          }
          let ref = row
          for (const n of kids) { ref.after(n); ref = n }
        })
      }
      return row
    }
    const top = childrenOf(tree)
    for (const it of top.slice(0, LIMIT)) box.append(rowFor(it, tree, 0))
    if (top.length > LIMIT) box.append(h('div', { class: 'fx-more' }, `${top.length - LIMIT} smaller items not shown`))
    if (!top.length) box.append(h('div', { style: 'padding:16px' }, 'This folder is empty.'))
    // Expand the biggest folder one level so the first view is already useful
    const first = box.querySelector('.fx-tr.dir .tg')
    first?.click()
    return wrapper
  }

  // ----- Treemap tab -----
  function treemapView() {
    let focus = tree
    const trail = []
    const holder = h('div')
    const crumbs = h('div', { class: 'fx-crumbs' })
    const map = h('div', { class: 'fx-tm' })
    const note = h('div', { class: 'small muted' })
    const wide = () => !matchMedia('(max-width: 640px)').matches
    function draw() {
      const w = wide()
      map.style.aspectRatio = w ? '16 / 9' : '4 / 5'
      const unit = w ? { x: 0, y: 0, w: 16, h: 9 } : { x: 0, y: 0, w: 4, h: 5 }
      let items = childrenOf(focus).filter((i) => i.size > 0).map((i) => ({ ...i, value: i.size }))
      const MAXN = 160
      let other = null
      if (items.length > MAXN) { const rest = items.slice(MAXN); items = items.slice(0, MAXN); other = { name: `${rest.length} smaller items`, value: rest.reduce((s, r) => s + r.size, 0), size: rest.reduce((s, r) => s + r.size, 0), other: true }; items.push(other) }
      const laid = squarify(items, unit)
      clear(map)
      laid.forEach((r, i) => {
        const left = (r.x / unit.w) * 100, top = (r.y / unit.h) * 100, wp = (r.w / unit.w) * 100, hp = (r.h / unit.h) * 100
        const color = r.other ? '#8a8794' : r.dir ? `hsl(${hue(r.name)} 62% 52%)` : (KINDS[kindOfName(r.name)] || KINDS.other).color
        const big = wp > 9 && hp > 9
        const label = r.other ? r.name : r.name
        const b = h('button', {
          type: 'button', class: [r.dir && 'dir', !reduceMotion() && 'pop'], style: { left: `${left}%`, top: `${top}%`, width: `${wp}%`, height: `${hp}%`, '--c': color, '--i': Math.min(i, 30) },
          title: `${r.dir ? r.node.path : r.other ? label : r.file.path}\n${formatBytes(r.size)} (${fmtPct(pct(r.size, focus.size))} of ${focus.name})`,
          'aria-label': `${label}, ${formatBytes(r.size)}${r.dir ? ', folder. Open it' : ''}`,
          onclick: () => { if (r.dir) { trail.push(focus); focus = r.node; draw() } else if (r.file) openPreview(r.file.file, { name: r.file.path }) },
        }, big ? [h('b', label), h('span', formatBytes(r.size))] : (wp > 4 && hp > 5 ? h('b', { style: 'font-size:11px' }, label) : null))
        map.append(b)
      })
      const path = [...trail, focus]
      clear(crumbs, path.map((n, i) => [i ? h('span', { class: 'sep' }, '/') : null, i === path.length - 1 ? h('strong', n.name) : h('button', { type: 'button', onclick: () => { focus = n; trail.length = i; draw() } }, n.name)]))
      note.textContent = items.length ? `${formatBytes(focus.size)} in ${focus.count.toLocaleString()} files. Folders are dashed: click one to open it, click a file to preview it.` : 'Nothing with a size here.'
    }
    draw()
    const onResize = () => { if (map.isConnected) draw() }
    matchMedia('(max-width: 640px)').addEventListener('change', onResize)
    onCleanup(() => matchMedia('(max-width: 640px)').removeEventListener('change', onResize))
    return clear(holder, h('div', { class: 'stack tight' }, crumbs, map, note))
  }

  // ----- Largest files -----
  function bigView() {
    const filter = input({ placeholder: 'Filter by name, folder or type', 'aria-label': 'Filter files' })
    const body = h('div')
    const sorted = [...scan.entries].sort((a, b) => b.size - a.size)
    const draw = () => {
      const q = filter.value.trim().toLowerCase()
      const list = (q ? sorted.filter((e) => e.path.toLowerCase().includes(q)) : sorted).slice(0, 100)
      clear(body, list.length ? table({
        columns: ['#', 'File', { label: 'Size', num: true }, { label: 'Share', num: true }, 'Modified'],
        rows: list.map((e, i) => [i + 1, h('div', { style: 'display:flex;gap:8px;align-items:center;min-width:220px' }, tile(e.name, { size: 'sm' }),
          h('div', { style: 'min-width:0' }, h('button', { class: 'fx-link', style: 'text-align:left;overflow-wrap:anywhere', onclick: () => openPreview(e.file, { name: e.path }) }, e.name), e.dir ? h('div', { class: 'small muted', style: 'overflow-wrap:anywhere' }, e.dir) : null)),
        formatBytes(e.size), fmtPct(pct(e.size, tree.size)), fmtDateTime(e.mtime)]), max: 100,
      }) : empty('No files match that filter.', 'search-x'))
    }
    filter.addEventListener('input', draw)
    draw()
    return h('div', { class: 'stack tight' }, field('Top 100 by size', filter), body)
  }

  // ----- File types -----
  function typesView() {
    const rows = byExtension(scan.entries)
    const total = tree.size || 1
    const kinds = new Map()
    for (const r of rows) { const k = kinds.get(r.kind) || kinds.set(r.kind, { kind: r.kind, size: 0, count: 0 }).get(r.kind); k.size += r.size; k.count += r.count }
    const ks = [...kinds.values()].sort((a, b) => b.size - a.size)
    const max = rows[0]?.size || 1
    return h('div', { class: 'stack' },
      h('div', { class: 'stack tight' }, h('div', { class: 'fx-kindbar', role: 'img', 'aria-label': 'Size by kind of file' }, ks.map((k, i) => h('i', { style: { '--w': `${(k.size / total) * 100}%`, '--c': KINDS[k.kind].color, '--i': i }, title: `${KINDS[k.kind].label}: ${formatBytes(k.size)}` }))),
        h('div', { class: 'fx-legend' }, ks.map((k) => h('span', { style: { '--c': KINDS[k.kind].color } }, h('i'), `${KINDS[k.kind].label} ${formatBytes(k.size)} (${fmtPct(pct(k.size, total))})`)))),
      table({
        columns: ['Type', { label: 'Files', num: true }, { label: 'Total size', num: true }, 'Share'],
        rows: rows.slice(0, 200).map((r, i) => [h('span', { style: 'display:inline-flex;gap:8px;align-items:center' }, tile(`x.${r.ext}`, { size: 'sm' }), r.ext === '(none)' ? 'No extension' : `.${r.ext}`), r.count.toLocaleString(), formatBytes(r.size),
          h('div', { style: 'display:flex;gap:8px;align-items:center;min-width:130px' }, h('div', { class: 'fx-bar', style: { '--w': `${(r.size / max) * 100}%`, '--k': KINDS[r.kind].color, flex: 1, '--i': Math.min(i, 12) } }, h('i')), h('span', { class: 'small muted', style: 'min-width:38px;text-align:right' }, fmtPct(pct(r.size, total))))]), max: 200,
      }))
  }

  // ----- Export -----
  function exportRow() {
    const kindSel = select([['files', 'Every file (path, type, size, date)'], ['folders', 'Folder summary (size and file count)'], ['types', 'Size by file type']], 'files')
    const btn = button('Export CSV', { icon: 'download', variant: 'primary', onClick: () => {
      let text, name
      if (kindSel.value === 'files') {
        text = 'path,name,extension,kind,size_bytes,modified\r\n' + [...scan.entries].sort((a, b) => b.size - a.size).map((e) => [csvCell(e.path), csvCell(e.name), extOf(e.name), kindOfName(e.name), e.size, fmtDateTime(e.mtime, true)].join(',')).join('\r\n')
        name = 'files'
      } else if (kindSel.value === 'folders') {
        const lines = []
        const walk = (n, p) => { lines.push([csvCell(p || '(root)'), n.count, n.size].join(',')); for (const c of n.children.values()) walk(c, c.path) }
        walk(tree, '')
        text = 'folder,files,size_bytes\r\n' + lines.join('\r\n')
        name = 'folders'
      } else {
        text = 'extension,files,size_bytes,kind\r\n' + byExtension(scan.entries).map((r) => [csvCell(r.ext), r.count, r.size, r.kind].join(',')).join('\r\n')
        name = 'file-types'
      }
      download('﻿' + text + '\r\n', `${scan.name.replace(/[\\/:*?"<>|]+/g, '_')}-${name}.csv`, 'text/csv;charset=utf-8')
    } })
    return h('div', { class: 'row' }, h('div', { style: 'min-width:240px;flex:1' }, field('Export', kindSel)), h('div', { style: 'align-self:flex-end' }, btn))
  }
}
