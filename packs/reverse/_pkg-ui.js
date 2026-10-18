// Shared UI pieces for the package tools (app inspector, ASAR explorer, source map viewer, plist viewer).
// Everything is scoped under .pkg so nothing leaks into the site shell.
import { h, icon, button, clear, formatBytes, input, onCleanup } from '../../lib/ui.js'

const CSS = `
.pkg { min-width: 0; }
.pkg .pkg-kv { display: grid; grid-template-columns: minmax(90px, max-content) minmax(0, 1fr); gap: 6px 16px; font-size: 13.5px; align-items: baseline; margin: 0; }
.pkg .pkg-kv dt { color: var(--muted); font-size: 12.5px; }
.pkg .pkg-kv dd { margin: 0; font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; min-width: 0; }
.pkg .pkg-pill { display: inline-flex; align-items: center; gap: 5px; min-height: 22px; padding: 1px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); white-space: nowrap; vertical-align: middle; }
.pkg .pkg-pill .icon { width: 12px; height: 12px; }
.pkg .pkg-pill.bad { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, transparent); }
.pkg .pkg-pill.warn { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 30%, transparent); }
.pkg .pkg-pill.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 30%, transparent); }
.pkg .pkg-pill.info { color: var(--info, var(--accent)); background: var(--info-soft, var(--surface-2)); }
.pkg .pkg-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.pkg .pkg-code { margin: 0; padding: 12px 14px; font-family: var(--mono); font-size: 12.5px; line-height: 1.55; white-space: pre; overflow: auto; max-height: 520px;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg, 12px); tab-size: 2; }
.pkg .pkg-code.wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
.pkg .pkg-lines { display: grid; grid-template-columns: max-content minmax(0, 1fr); font-family: var(--mono); font-size: 12.5px; line-height: 1.55; max-height: 560px; overflow: auto;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg, 12px); }
.pkg .pkg-lines .ln { color: var(--muted); text-align: right; padding: 0 10px; user-select: none; border-right: 1px solid var(--border); }
.pkg .pkg-lines .lc { white-space: pre; padding: 0 12px; min-width: 0; }
.pkg .pkg-lines .hl { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.pkg .pkg-lines mark { background: color-mix(in srgb, var(--accent) 40%, transparent); color: inherit; border-radius: 3px; outline: 1px solid var(--accent); }
.pkg .pkg-tree { font-size: 13px; border: 1px solid var(--border); border-radius: var(--radius-lg, 12px); background: var(--surface); max-height: 560px; overflow: auto; padding: 6px 0; }
.pkg .pkg-tree ul { list-style: none; margin: 0; padding: 0 0 0 16px; }
.pkg .pkg-tree > ul { padding-left: 4px; }
.pkg .pkg-row { display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 8px 0 4px; border-radius: 8px; min-width: 0; }
.pkg .pkg-row:hover { background: var(--surface-2); }
.pkg .pkg-row.sel { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.pkg .pkg-row .icon { width: 15px; height: 15px; flex: none; color: var(--muted); }
.pkg .pkg-row .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); font-size: 12.5px; }
.pkg .pkg-row .sz { color: var(--muted); font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.pkg .pkg-row button.tg { all: unset; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; cursor: pointer; flex: none; }
.pkg .pkg-row button.tg:focus-visible, .pkg .pkg-row button.pick:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pkg .pkg-row button.tg .icon { transition: transform .15s; }
.pkg .pkg-row button.tg[aria-expanded="true"] .icon { transform: rotate(90deg); }
.pkg .pkg-row button.pick { all: unset; flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; cursor: pointer; min-height: 32px; border-radius: 6px; }
.pkg .pkg-row .ty { font-size: 11px; color: var(--muted); font-family: var(--mono); white-space: nowrap; }
.pkg .pkg-row .val { font-family: var(--mono); font-size: 12.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); flex: 1; }
.pkg .pkg-row .val.s { color: var(--success); }
.pkg .pkg-row .val.n { color: var(--warning); }
.pkg .pkg-row .val.b { color: var(--accent); }
.pkg .pkg-row .key { font-family: var(--mono); font-size: 12.5px; font-weight: 600; white-space: nowrap; max-width: 55%; overflow: hidden; text-overflow: ellipsis; }
.pkg .pkg-spacer { width: 24px; flex: none; }
.pkg .pkg-section-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: space-between; }
.pkg .pkg-section-title h2 { margin: 0; }
.pkg .pkg-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
.pkg .pkg-list li { padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.pkg .pkg-list li code { font-size: 12.5px; }
.pkg .pkg-hero { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.pkg .pkg-hero .big { font-size: 20px; font-weight: 700; overflow-wrap: anywhere; min-width: 0; }
.pkg .pkg-hero .sub { color: var(--muted); font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
.pkg .pkg-hero .ic { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; background: color-mix(in srgb, var(--c, var(--accent)) 14%, transparent); color: var(--c, var(--accent)); flex: none; }
.pkg .pkg-hero .ic .icon { width: 24px; height: 24px; }
.pkg .pkg-hero .ic img { width: 48px; height: 48px; border-radius: 12px; object-fit: cover; }
.pkg .pkg-imgprev { max-width: 100%; max-height: 420px; display: block; margin: 0 auto; image-rendering: auto; }
@media (prefers-reduced-motion: reduce) { .pkg .pkg-row button.tg .icon { transition: none; } }
`

/** Inject the shared style once and return the class to put on the tool root. */
export function useCss() {
  if (!document.getElementById('pkg-css')) document.head.append(h('style', { id: 'pkg-css' }, CSS))
  return 'pkg'
}

/** Definition list from [[label, value], ...]; null/undefined values are skipped. */
export function kv(pairs) {
  return h('dl', { class: 'pkg-kv' }, pairs.filter(([, v]) => v != null && v !== '').flatMap(([k, v]) => [h('dt', k), h('dd', v instanceof Node ? v : String(v))]))
}

export const pill = (text, kind = '', ic = null) => h('span', { class: ['pkg-pill', kind] }, ic && icon(ic), text)
export const pills = (...kids) => h('div', { class: 'pkg-pills' }, kids)

/** Section header with a title and optional actions on the right. */
export const sectionTitle = (title, ...actions) => h('div', { class: 'pkg-section-title' }, h('h2', title), actions.length ? h('div', { class: 'row' }, actions) : null)

/** Code block (pre) with optional wrapping. */
export const codeBlock = (text, wrap = false) => h('pre', { class: ['pkg-code', wrap && 'wrap'], tabindex: 0 }, text)

/** Classic hex dump of the first bytes. */
export function hexDump(bytes, max = 1024) {
  const n = Math.min(bytes.length, max)
  const out = []
  for (let o = 0; o < n; o += 16) {
    const row = bytes.subarray(o, Math.min(o + 16, n))
    const hx = [...row].map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47)
    const asc = [...row].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')
    out.push(`${o.toString(16).padStart(8, '0')}  ${hx}  ${asc}`)
  }
  if (bytes.length > max) out.push(`... ${bytes.length - max} more bytes`)
  return out.join('\n')
}

/** Text with line numbers. focus = {line (1-based), col (0-based)} highlights a line and a character. */
export function codeLines(text, { focus, firstLine = 1, maxLines = 20000 } = {}) {
  const lines = text.split(/\r\n|\r|\n/)
  const shown = lines.slice(0, maxLines)
  const el = h('div', { class: 'pkg-lines', tabindex: 0, role: 'region', 'aria-label': 'Code' })
  const frag = document.createDocumentFragment()
  let target = null
  shown.forEach((line, i) => {
    const n = firstLine + i
    const hl = focus && focus.line === n
    const ln = h('span', { class: ['ln', hl && 'hl'] }, String(n))
    let lc
    if (hl && focus.col != null && focus.col <= line.length) {
      const c = Math.max(0, focus.col)
      lc = h('span', { class: 'lc hl' }, line.slice(0, c), h('mark', line.slice(c, c + 1) || ' '), line.slice(c + 1))
    } else lc = h('span', { class: ['lc', hl && 'hl'] }, line.length > 5000 ? line.slice(0, 5000) + ' ...' : line)
    if (hl) target = ln
    frag.append(ln, lc)
  })
  el.append(frag)
  if (lines.length > maxLines) el.append(h('span', { class: 'ln' }, ''), h('span', { class: 'lc small muted' }, `${lines.length - maxLines} more lines not shown`))
  if (target) requestAnimationFrame(() => { if (el.isConnected) el.scrollTop = Math.max(0, target.offsetTop - el.clientHeight / 2) })
  return el
}

// ---------- File tree ----------

/** Build a nested folder structure from [{path, size, ...}] entries. */
export function buildTree(entries) {
  const root = { name: '', path: '', dirs: new Map(), files: [], size: 0, count: 0 }
  for (const e of entries) {
    const parts = e.path.split('/').filter(Boolean)
    let d = root
    root.size += e.size || 0
    root.count++
    for (let i = 0; i < parts.length - 1; i++) {
      if (!d.dirs.has(parts[i])) d.dirs.set(parts[i], { name: parts[i], path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [], size: 0, count: 0 })
      d = d.dirs.get(parts[i])
      d.size += e.size || 0
      d.count++
    }
    d.files.push({ ...e, name: parts.at(-1) || e.path })
  }
  return root
}

const FILE_ICONS = [[/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i, 'file-image'], [/\.(js|mjs|cjs|ts|tsx|jsx|json|css|html?|xml|plist|java|kt|swift|m|h|c|cpp|py|rb|sh|smali)$/i, 'file-code'],
  [/\.(so|dylib|dll|node|dex|exe|bin|odex|oat)$/i, 'binary'], [/\.(zip|jar|apk|aar|asar|gz|tar)$/i, 'file-archive'], [/\.(txt|md|strings|properties|cfg|ini|yml|yaml)$/i, 'file-text'],
  [/\.(mp3|wav|ogg|m4a|caf|aac)$/i, 'file-audio'], [/\.(mp4|mov|webm)$/i, 'file-video']]
export const fileIcon = (name) => FILE_ICONS.find(([re]) => re.test(name))?.[1] || 'file'

/**
 * Collapsible file tree with search. entries: [{path, size, note}]. Folders render their children lazily.
 * opts: {onSelect(entry), actions(entry) -> Node[], open: depth to expand initially, label}
 */
export function fileTree(entries, opts = {}) {
  const { onSelect, actions, open = 1, label = 'Files' } = opts
  const tree = buildTree(entries)
  const box = h('div', { class: 'pkg-tree', role: 'tree', 'aria-label': label })
  const search = input({ type: 'search', placeholder: `Search ${entries.length} files`, 'aria-label': 'Search files' })
  let selected = null
  const select = (row, e) => {
    selected?.classList.remove('sel')
    selected = row
    row.classList.add('sel')
    onSelect?.(e)
  }
  const fileRow = (f, showPath) => {
    const row = h('div', { class: 'pkg-row' })
    const nameEl = h('span', { class: 'nm', title: f.path }, showPath ? f.path : f.name)
    const main = onSelect ? h('button', { type: 'button', class: 'pick', onclick: () => select(row, f) }, icon(f.icon || fileIcon(f.name)), nameEl)
      : h('span', { class: 'pick', style: 'display:flex;align-items:center;gap:6px;flex:1;min-width:0' }, icon(f.icon || fileIcon(f.name)), nameEl)
    row.append(h('span', { class: 'pkg-spacer' }), main, f.note ? pill(f.note, f.noteKind || '') : null, h('span', { class: 'sz' }, f.size == null ? '' : formatBytes(f.size)), actions ? actions(f) : null)
    return h('li', { role: 'treeitem' }, row)
  }
  const dirNode = (d, depth) => {
    const kids = h('ul', { role: 'group' })
    let rendered = false
    const tg = h('button', { type: 'button', class: 'tg', 'aria-expanded': 'false', 'aria-label': `Toggle ${d.name}` }, icon('chevron-right'))
    const toggle = (on) => {
      tg.setAttribute('aria-expanded', String(on))
      if (on && !rendered) { fill(kids, d, depth + 1); rendered = true }
      kids.hidden = !on
    }
    tg.addEventListener('click', () => toggle(tg.getAttribute('aria-expanded') !== 'true'))
    const row = h('div', { class: 'pkg-row' }, tg, h('span', { class: 'pick', style: 'display:flex;align-items:center;gap:6px;flex:1;min-width:0;cursor:pointer', onclick: () => tg.click() },
      icon('folder'), h('span', { class: 'nm' }, d.name)), h('span', { class: 'sz' }, `${d.count} · ${formatBytes(d.size)}`))
    kids.hidden = true
    const li = h('li', { role: 'treeitem' }, row, kids)
    if (depth < open) toggle(true)
    return li
  }
  const fill = (ul, d, depth) => {
    const dirs = [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
    const files = [...d.files].sort((a, b) => a.name.localeCompare(b.name))
    for (const x of dirs) ul.append(dirNode(x, depth))
    const max = 2000
    for (const f of files.slice(0, max)) ul.append(fileRow(f, false))
    if (files.length > max) ul.append(h('li', { class: 'small muted', style: 'padding:6px 12px' }, `${files.length - max} more files here. Use search to find them.`))
  }
  const render = () => {
    const q = search.value.trim().toLowerCase()
    selected = null
    if (!q) { const ul = h('ul'); fill(ul, tree, 0); clear(box, ul); return }
    const hits = entries.filter((e) => e.path.toLowerCase().includes(q))
    const ul = h('ul')
    for (const f of hits.slice(0, 500)) ul.append(fileRow({ ...f, name: f.path.split('/').pop() }, true))
    clear(box, hits.length ? ul : h('div', { class: 'small muted', style: 'padding:10px 14px' }, 'No files match.'),
      hits.length > 500 ? h('div', { class: 'small muted', style: 'padding:6px 14px' }, `Showing 500 of ${hits.length} matches.`) : null)
  }
  let t
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 150) })
  onCleanup(() => clearTimeout(t))
  render()
  return h('div', { class: 'stack' }, search, box)
}

// ---------- Plist / JSON tree ----------

const TYPE_LABEL = { dict: 'dict', array: 'array', string: 'string', int: 'integer', real: 'real', bool: 'boolean', date: 'date', data: 'data', uid: 'uid', null: 'null' }

function previewOf(n) {
  switch (n.t) {
    case 'dict': return [`${n.v.length} ${n.v.length === 1 ? 'key' : 'keys'}`, '']
    case 'array': return [`${n.v.length} ${n.v.length === 1 ? 'item' : 'items'}`, '']
    case 'string': return [JSON.stringify(n.v.length > 300 ? n.v.slice(0, 300) + '...' : n.v), 's']
    case 'int': case 'real': case 'uid': return [String(n.v), 'n']
    case 'bool': return [String(n.v), 'b']
    case 'date': return [n.v.toISOString(), 'n']
    case 'data': {
      const hx = [...n.v.subarray(0, 24)].map((x) => x.toString(16).padStart(2, '0')).join('')
      return [`${formatBytes(n.v.length)} <${hx}${n.v.length > 24 ? '...' : ''}>`, '']
    }
    default: return ['null', '']
  }
}

/** Collapsible tree for a typed plist node. Containers render lazily. */
export function plistTree(root, { open = 2, label = 'Property list' } = {}) {
  const box = h('div', { class: 'pkg-tree', role: 'tree', 'aria-label': label })
  const item = (key, n, depth) => {
    const container = n.t === 'dict' || n.t === 'array'
    const [pv, cls] = previewOf(n)
    const row = h('div', { class: 'pkg-row' })
    const li = h('li', { role: 'treeitem' }, row)
    if (container) {
      const kids = h('ul', { role: 'group', hidden: true })
      let rendered = false
      const tg = h('button', { type: 'button', class: 'tg', 'aria-expanded': 'false', 'aria-label': `Toggle ${key}` }, icon('chevron-right'))
      const toggle = (on) => {
        tg.setAttribute('aria-expanded', String(on))
        if (on && !rendered) {
          rendered = true
          const list = n.t === 'dict' ? n.v : n.v.map((v, i) => [String(i), v])
          for (const [k, v] of list.slice(0, 5000)) kids.append(item(k, v, depth + 1))
          if (list.length > 5000) kids.append(h('li', { class: 'small muted', style: 'padding:6px 12px' }, `${list.length - 5000} more not shown. Export to see everything.`))
        }
        kids.hidden = !on
      }
      tg.addEventListener('click', () => toggle(tg.getAttribute('aria-expanded') !== 'true'))
      row.append(tg, h('span', { class: 'key', title: key, onclick: () => tg.click(), style: 'cursor:pointer' }, key), h('span', { class: 'ty' }, TYPE_LABEL[n.t]), h('span', { class: 'val' }, pv))
      li.append(kids)
      if (depth < open) toggle(true)
    } else {
      row.append(h('span', { class: 'pkg-spacer' }), h('span', { class: 'key', title: key }, key), h('span', { class: 'ty' }, TYPE_LABEL[n.t]), h('span', { class: ['val', cls], title: pv }, pv))
    }
    return li
  }
  box.append(h('ul', item('Root', root, 0)))
  return box
}

/** Small icon + title + subtitle header for a result. */
export function hero({ title, sub, ic = 'package', img, extra }) {
  return h('div', { class: 'pkg-hero' }, h('div', { class: 'ic' }, img || icon(ic)), h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 'big' }, title), sub && h('div', { class: 'sub' }, sub)), extra || null)
}

/** Ghost download icon button used in tree rows. */
export const rowDownload = (name, onClick) => button('', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: `Download ${name}`, onClick })
