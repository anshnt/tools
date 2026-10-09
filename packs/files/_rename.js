// Rename engine shared by Bulk renamer, Batch image renamer, Extension changer and Filename cleaner:
// a source picker (files or folder), a live preview table with conflict detection, and the three ways to apply it
// (ZIP of renamed copies, rename in place with the File System Access API, mapping CSV) plus undo.
import { h, icon, clear, button, busy, progress, alert, stats, toggle, toast, modal, download, formatBytes, debounce, errorMessage, onCleanup, yieldToMain } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { canPickDirectory, ensurePermission, fmtDate, extOf } from './_core.js'
import { sourceZone, injectStyle, celebrate, chip } from './_ui.js'

// ---------- Name helpers ----------
/** 'photo.final.jpg' -> ['photo.final', '.jpg']; '.gitignore' -> ['.gitignore', '']. */
export function splitName(name) {
  const i = name.lastIndexOf('.')
  return i > 0 && i < name.length - 1 ? [name.slice(0, i), name.slice(i)] : [name, '']
}

/** Plain-words reason a name cannot be used on common file systems, or ''. */
export function nameProblem(name) {
  if (!name || !name.trim()) return 'The new name is empty.'
  if (name === '.' || name === '..') return 'That is not a valid file name.'
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return 'Contains a character that is not allowed in file names (\\ / : * ? " < > |).'
  if (/[. ]$/.test(name)) return 'Windows does not allow names that end in a dot or a space.'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) return 'This is a reserved name on Windows.'
  if (new TextEncoder().encode(name).length > 255) return 'Longer than 255 bytes, which most file systems reject.'
  return ''
}

const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
/** mode: keep | lower | upper | title | sentence | camel | pascal | kebab | snake */
export function caseConvert(s, mode) {
  switch (mode) {
    case 'lower': return s.toLowerCase()
    case 'upper': return s.toUpperCase()
    case 'title': return s.toLowerCase().replace(/(^|[\s_\-.()[\]]+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    case 'sentence': { const t = s.toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1) }
    case 'camel': { const w = words(s); return w.map((x, i) => (i ? cap(x) : x.toLowerCase())).join('') }
    case 'pascal': return words(s).map(cap).join('')
    case 'kebab': return words(s).map((x) => x.toLowerCase()).join('-')
    case 'snake': return words(s).map((x) => x.toLowerCase()).join('_')
    default: return s
  }
}
export const CASE_OPTIONS = [['keep', 'Keep as is'], ['lower', 'lowercase'], ['upper', 'UPPERCASE'], ['title', 'Title Case'], ['sentence', 'Sentence case'], ['camel', 'camelCase'], ['pascal', 'PascalCase'], ['kebab', 'kebab-case'], ['snake', 'snake_case']]

/**
 * Expand {tokens} in a pattern. ctx: {name, orig, ext, n, pad, date, taken, parent, camera, now}.
 * {date:YYYY-MM-DD}, {taken:YYYYMMDD_HHmmss}, {n:4} take a format. Unknown tokens are kept so typos are visible.
 */
export function expandPattern(pattern, ctx) {
  const unknown = new Set()
  const text = pattern.replace(/\{(\w+)(?::([^}]*))?\}/g, (m, key, arg) => {
    switch (key) {
      case 'name': return ctx.name
      case 'orig': return ctx.orig
      case 'ext': return ctx.ext
      case 'parent': return ctx.parent || ''
      case 'camera': return ctx.camera || ''
      case 'n': { const p = arg && /^\d+$/.test(arg) ? +arg : ctx.pad; return String(ctx.n).padStart(p, '0') }
      case 'date': return fmtDate(ctx.date, arg || 'YYYY-MM-DD')
      case 'taken': return fmtDate(ctx.taken ?? ctx.date, arg || 'YYYY-MM-DD')
      case 'now': return fmtDate(ctx.now, arg || 'YYYY-MM-DD')
      default: unknown.add(m); return m
    }
  })
  return { text, unknown: [...unknown] }
}

/** Make names unique per folder by adding " (2)", " (3)" before the extension. Names are compared case-insensitively. */
export function uniqueify(items, names, include) {
  const used = new Map() // dir -> Set(lowercase)
  const bucket = (dir) => used.get(dir) || used.set(dir, new Set()).get(dir)
  items.forEach((it, i) => { if (!include(it)) bucket(it.dir).add(it.name.toLowerCase()) })
  return names.map((name, i) => {
    const it = items[i]
    if (!include(it)) return name
    const set = bucket(it.dir)
    let out = name, k = 2
    const [stem, ext] = splitName(name)
    while (set.has(out.toLowerCase())) out = `${stem} (${k++})${ext}`
    set.add(out.toLowerCase())
    return out
  })
}

// ---------- Applying renames ----------
async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true } catch { /* not a file */ }
  try { await dir.getDirectoryHandle(name); return true } catch { return false }
}

async function moveOne(item, newName) {
  if (item.handle?.move) {
    try { await item.handle.move(newName); item.name = newName; return } catch (e) { if (!item.parent) throw e }
  }
  if (!item.parent) throw new Error('This browser cannot rename that file in place. Use the ZIP download instead.')
  // Fallback: copy to the new name, then remove the old one (never overwrites an existing file)
  if (await exists(item.parent, newName)) throw new Error(`A file named "${newName}" already exists in the folder, so "${item.name}" was left alone.`)
  const src = await item.handle.getFile()
  const dest = await item.parent.getFileHandle(newName, { create: true })
  const w = await dest.createWritable()
  try { await src.stream().pipeTo(w) } catch (e) { try { await item.parent.removeEntry(newName) } catch { /* ignore */ } throw e }
  await item.parent.removeEntry(item.name)
  item.handle = dest
  item.name = newName
}

/**
 * Rename items in place. ops: [{item, to}]. Handles swaps and chains (a->b, b->a) with temporary names.
 * Returns the ops that completed. Throws after a partial run with err.done set.
 */
export async function executeRenames(ops, onProgress) {
  const todo = ops.filter((o) => o.to !== o.item.name)
  const sources = new Map() // dir -> Set(lowercase current names)
  for (const o of todo) (sources.get(o.item.dir) || sources.set(o.item.dir, new Set()).get(o.item.dir)).add(o.item.name.toLowerCase())
  const needsTemp = (o) => sources.get(o.item.dir).has(o.to.toLowerCase())
  const stage1 = todo.filter(needsTemp), direct = todo.filter((o) => !needsTemp(o))
  const done = []
  const orig = new Map(todo.map((o) => [o, o.item.name]))
  let n = 0
  const step = () => onProgress?.(++n / (stage1.length * 2 + direct.length || 1))
  try {
    for (const o of stage1) {
      await moveOne(o.item, `.rename-tmp-${Math.random().toString(36).slice(2, 8)}${splitName(o.to)[1]}`)
      step()
    }
    for (const o of direct) { const from = o.item.name; await moveOne(o.item, o.to); done.push({ item: o.item, from, to: o.to }); step() }
    for (const o of stage1) { await moveOne(o.item, o.to); done.push({ item: o.item, from: orig.get(o), to: o.to }); step() }
  } catch (err) {
    // put back anything still parked under a temporary name
    for (const o of stage1) if (o.item.name.startsWith('.rename-tmp-')) { try { await moveOne(o.item, orig.get(o)) } catch { /* best effort */ } }
    err.done = done
    throw err
  }
  return done
}

// ---------- The workbench ----------
const CSS = `
.fx-rn-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.fx-rn-list { border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface); }
.fx-rn-scroll { max-height: 520px; overflow: auto; }
.fx-rn-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) minmax(0, 1fr) 150px; gap: 8px 12px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--border); font-size: 13.5px; transition: background .2s; }
.fx-rn-row.has-thumb { grid-template-columns: 34px 46px minmax(0, 1fr) minmax(0, 1fr) 150px; }
.fx-rn-row.head { position: sticky; top: 0; z-index: 2; background: var(--surface-2); border-top: 0; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
.fx-rn-row > * { min-width: 0; }
.fx-rn-row .old { color: var(--muted); overflow-wrap: anywhere; }
.fx-rn-row .new { font-weight: 600; overflow-wrap: anywhere; }
.fx-rn-row .new.same { font-weight: 400; color: var(--muted); }
.fx-rn-row .dirp { color: var(--muted); font-weight: 400; }
.fx-rn-row .st { font-size: 12.5px; display: flex; align-items: center; gap: 6px; }
.fx-rn-row .st .icon { width: 14px; height: 14px; flex: none; }
.fx-rn-row.bad { background: var(--danger-soft); }
.fx-rn-row.bad .st { color: var(--danger); }
.fx-rn-row.skipped { opacity: .55; }
.fx-rn-row.ok .st { color: var(--success); }
.fx-rn-row.same .st { color: var(--muted); }
.fx-rn-row .th { width: 40px; height: 40px; border-radius: 9px; object-fit: cover; background: var(--checker); border: 1px solid var(--border); display: block; }
.fx-rn-row input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--accent); margin: 0; }
.fx-rn-row .arrow { display: none; }
.fx-rn-diff mark { background: color-mix(in srgb, var(--accent) 24%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
@media (max-width: 700px) {
  .fx-rn-row, .fx-rn-row.has-thumb { grid-template-columns: 30px minmax(0, 1fr); }
  .fx-rn-row.has-thumb { grid-template-columns: 30px 46px minmax(0, 1fr); }
  .fx-rn-row.head .c-old, .fx-rn-row.head .c-new, .fx-rn-row.head .c-st { display: none; }
  .fx-rn-row .c-old { grid-column: 2 / -1; }
  .fx-rn-row .c-new { grid-column: 2 / -1; }
  .fx-rn-row.has-thumb .c-old, .fx-rn-row.has-thumb .c-new { grid-column: 3 / -1; }
  .fx-rn-row .c-st { grid-column: 2 / -1; }
  .fx-rn-row.has-thumb .c-st { grid-column: 3 / -1; }
  .fx-rn-row .th { grid-row: span 3; }
  .fx-rn-row > input[type=checkbox] { grid-row: span 3; align-self: start; margin-top: 3px; }
}
`

/**
 * renameWorkbench({compute(items) -> string[] full new names, sort?(items) -> items, enrich?(item, signal), enrichLabel, accept, thumbs, noun,
 *                  hint, sourceHint})
 * Returns {source, preview, refresh, items(), setItems}. Put `source`, your options, then `preview` on the page and call refresh() when options change.
 * compute() receives only the included items, in order, and must return one new FULL name (with extension) per item.
 */
export function renameWorkbench(opts) {
  injectStyle('fx-rename', CSS)
  const noun = opts.noun || 'files'
  const st = { items: [], rootName: '', rootHandle: null, scan: null, includeSub: false, auto: false, undo: null, names: [], busy: false }
  const rowsEl = h('div', { class: 'fx-rn-scroll' })
  const statsEl = h('div')
  const actions = h('div', { class: 'stack' })
  const prog = progress('Working')
  const enrichProg = progress('Reading')
  const resultEl = h('div')
  let nextId = 1
  let enrichCtl = null
  const urls = new Map()
  const thumbUrl = (item) => {
    if (!urls.has(item.id)) urls.set(item.id, URL.createObjectURL(item.file))
    return urls.get(item.id)
  }
  const revokeAll = () => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear() }
  onCleanup(() => { revokeAll(); enrichCtl?.abort() })

  const includeSubToggle = toggle('Include files in subfolders', false, (v) => { st.includeSub = v })
  const source = sourceZone({
    accept: opts.accept || '', write: true, recursive: () => st.includeSub, hint: opts.sourceHint,
    onScan: (res) => setItems(res),
  })
  const sourceBlock = h('div', { class: 'stack tight' }, source, h('div', { class: 'row between' }, includeSubToggle,
    h('span', { class: 'small muted' }, canPickDirectory() ? 'Pick a folder to rename files in place, or take a ZIP of renamed copies.' : 'Your browser cannot rename in place, so you get a ZIP of renamed copies.')))

  function setItems(res) {
    enrichCtl?.abort()
    revokeAll()
    st.scan = res
    st.rootHandle = res.handle
    st.rootName = res.name
    st.undo = null
    st.items = res.entries.map((e) => ({ id: nextId++, file: e.file, dir: e.dir || '', name: e.name, originalName: e.name, handle: e.handle, parent: e.parent, include: true, meta: {} }))
    clear(resultEl)
    if (opts.accept) {
      // tolerate folders with other files: keep only accepted ones when an accept filter is given
      const ok = (f) => matchesAcceptLoose(f, opts.accept)
      const before = st.items.length
      st.items = st.items.filter((i) => ok(i.file))
      if (st.items.length < before) toast(`Skipped ${before - st.items.length} file(s) of other types`)
    }
    runEnrich().then(() => refresh())
    opts.onItems?.(st.items)
    refresh()
  }

  async function runEnrich() {
    if (!opts.enrich || !st.items.length || (enrichCtl && !enrichCtl.signal.aborted && enrichCtl.running)) return
    const ctl = (enrichCtl = new AbortController())
    ctl.running = true
    const list = [...st.items]
    for (let i = 0; i < list.length; i++) {
      if (ctl.signal.aborted) return
      enrichProg.set(i / list.length, `${opts.enrichLabel || 'Reading file details'} ${i + 1} of ${list.length}`)
      try { await opts.enrich(list[i], ctl.signal) } catch { /* leave meta empty */ }
      if (i % 20 === 19) { await yieldToMain(); refresh() }
    }
    ctl.running = false
    enrichProg.hide()
  }

  const included = () => st.items.filter((i) => i.include)

  function analyze() {
    const sorted = opts.sort ? opts.sort(st.items) : st.items
    if (sorted !== st.items) st.items = sorted
    const inc = included()
    let names = []
    let err = null
    try { names = inc.length ? opts.compute(inc) : [] } catch (e) { err = e; names = inc.map((i) => i.name) }
    if (st.auto && inc.length) names = uniqueify(st.items, expandToAll(inc, names), (i) => i.include).filter((_, k) => st.items[k].include)
    const byItem = new Map(inc.map((it, i) => [it, names[i]]))
    // conflicts: per folder, case-insensitive, excluded items keep their names
    const seen = new Map()
    for (const it of st.items) {
      const nn = it.include ? byItem.get(it) : it.name
      const key = `${it.dir}\u0000${nn.toLowerCase()}`
      ;(seen.get(key) || seen.set(key, []).get(key)).push(it)
    }
    const rows = st.items.map((it, idx) => {
      if (!it.include) return { it, idx, status: 'skipped', next: it.name }
      const nn = byItem.get(it)
      const prob = nameProblem(nn)
      if (prob) return { it, idx, status: 'bad', next: nn, msg: prob }
      const group = seen.get(`${it.dir}\u0000${nn.toLowerCase()}`)
      if (group.length > 1) {
        const other = group.find((g) => g !== it)
        return { it, idx, status: 'bad', next: nn, msg: `Same name as ${other.include ? 'another file' : 'a file you left out'}.`, conflict: true }
      }
      return { it, idx, status: nn === it.name ? 'same' : 'ok', next: nn }
    })
    return { rows, err }
  }
  // st.auto path needs names for all items; excluded items map to their own names
  function expandToAll(inc, names) {
    const m = new Map(inc.map((it, i) => [it, names[i]]))
    return st.items.map((it) => (m.has(it) ? m.get(it) : it.name))
  }

  let current = { rows: [] }
  function render() {
    const { rows, err } = current = analyze()
    const total = st.items.length
    clear(statsEl)
    clear(rowsEl)
    if (!total) { actions.hidden = true; statsEl.hidden = true; list.hidden = true; headEl.hidden = true; return }
    actions.hidden = false; statsEl.hidden = false; list.hidden = false; headEl.hidden = false
    const changed = rows.filter((r) => r.status === 'ok')
    const bad = rows.filter((r) => r.status === 'bad')
    const same = rows.filter((r) => r.status === 'same')
    statsEl.append(stats([
      { label: noun === 'files' ? 'Files' : noun, value: total.toLocaleString(), hint: formatBytes(st.items.reduce((s, i) => s + i.file.size, 0)) },
      { label: 'Will be renamed', value: changed.length.toLocaleString(), accent: true },
      { label: 'Unchanged', value: same.length.toLocaleString() },
      { label: 'Problems', value: bad.length.toLocaleString(), danger: bad.length > 0 },
    ]))
    if (err) rowsEl.append(h('div', { style: 'padding:12px' }, alert('error', errorMessage(err))))
    const thumbs = !!opts.thumbs
    const MAXROWS = 1000
    const allChecked = st.items.every((i) => i.include)
    const master = h('input', { type: 'checkbox', checked: allChecked, 'aria-label': 'Include all files', onchange: (e) => { st.items.forEach((i) => { i.include = e.target.checked }); refresh() } })
    rowsEl.append(h('div', { class: ['fx-rn-row head', thumbs && 'has-thumb'] }, master, thumbs && h('span'), h('span', { class: 'c-old' }, 'Original'), h('span', { class: 'c-new' }, 'New name'), h('span', { class: 'c-st' }, 'Status')))
    for (const r of rows.slice(0, MAXROWS)) {
      const { it } = r
      const cb = h('input', { type: 'checkbox', checked: it.include, 'aria-label': `Include ${it.name}`, onchange: (e) => { it.include = e.target.checked; refresh() } })
      const dirp = () => (it.dir ? h('span', { class: 'dirp' }, it.dir + '/') : null)
      const stEl = r.status === 'ok' ? h('span', { class: 'st' }, icon('check'), 'Will rename')
        : r.status === 'same' ? h('span', { class: 'st' }, icon('equal'), 'No change')
          : r.status === 'skipped' ? h('span', { class: 'st' }, icon('minus'), 'Left out')
            : h('span', { class: 'st', title: r.msg }, icon('triangle-alert'), r.msg)
      rowsEl.append(h('div', { class: ['fx-rn-row', r.status, thumbs && 'has-thumb'] }, cb,
        thumbs && (/^image\/(jpeg|png|gif|webp|bmp|avif|svg)/.test(it.file.type) ? h('img', { class: 'th', src: thumbUrl(it), alt: '', loading: 'lazy', decoding: 'async' }) : h('span', { class: 'th' })),
        h('div', { class: 'c-old old' }, dirp(), it.name, opts.detail?.(it) ? h('div', { class: 'small', style: 'margin-top:2px' }, opts.detail(it)) : null),
        h('div', { class: ['c-new new', r.status !== 'ok' && r.status !== 'bad' && 'same'] }, dirp(), r.next),
        h('div', { class: 'c-st' }, stEl)))
    }
    if (rows.length > MAXROWS) rowsEl.append(h('div', { class: 'small muted', style: 'padding:10px 14px' }, `Showing the first ${MAXROWS.toLocaleString()} of ${rows.length.toLocaleString()} rows. All of them are renamed.`))
    // actions
    const conflicts = bad.filter((r) => r.conflict).length
    const canApply = changed.length > 0 && !bad.length && !err
    const inPlace = canPickDirectory() && included().length && included().every((i) => i.handle && (i.parent || i.handle.move))
    const needFolder = !inPlace && canPickDirectory()
    const zipBtn = button('Download ZIP of renamed copies', { icon: 'file-archive', variant: inPlace ? 'secondary' : 'primary', size: 'lg', disabled: !included().length || bad.length > 0 || !!err, onClick: () => doZip(zipBtn) })
    const placeBtn = inPlace ? button('Rename in place', { icon: 'pencil-line', variant: 'primary', size: 'lg', disabled: !canApply, onClick: () => confirmInPlace(placeBtn, changed.length) }) : null
    const csvBtn = button('Mapping CSV', { icon: 'table', variant: 'ghost', disabled: !included().length, onClick: () => doCsv() })
    const fixBtn = conflicts ? button('Number duplicates automatically', { icon: 'list-ordered', onClick: () => { st.auto = true; refresh() } }) : null
    clear(actions,
      conflicts && !st.auto ? alert('warn', h('strong', 'Some names collide. '), 'Two files would end up with the same name. Change your pattern (for example add {n}) or let the tool number the duplicates.', h('div', { style: 'margin-top:8px' }, fixBtn)) : null,
      st.auto ? h('div', { class: 'row' }, chip('Duplicates are numbered like name (2).ext', 'accent', 'list-ordered'), button('Turn off', { variant: 'ghost', size: 'sm', onClick: () => { st.auto = false; refresh() } })) : null,
      h('div', { class: 'row' }, placeBtn, zipBtn, csvBtn),
      needFolder && !inPlace && st.items.length ? h('div', { class: 'small muted' }, 'To rename in place, use "Choose a folder" above instead of picking files one by one.') : null)
  }

  const refresh = debounce(render, 90)
  const refreshNow = () => render()

  function plan() {
    return current.rows.filter((r) => r.status === 'ok').map((r) => ({ item: r.it, to: r.next }))
  }

  async function doZip(btn) {
    const rows = current.rows.filter((r) => r.it.include)
    const total = rows.reduce((s, r) => s + r.it.file.size, 0)
    if (total > 3 * 1024 ** 3) { toast('That is more than 3 GB, which is too much for a browser to zip. Rename in place or do it in batches.', 'error'); return }
    await busy(btn, async () => {
      clear(resultEl)
      const JSZip = await jszip()
      const z = new JSZip()
      for (const r of rows) z.file(r.it.dir ? `${r.it.dir}/${r.next}` : r.next, r.it.file, { date: new Date(r.it.file.lastModified) })
      const blob = await z.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (m) => prog.set(m.percent / 100, 'Packing ZIP'))
      const name = `${(st.rootName || 'renamed').replace(/[\\/:*?"<>|]+/g, '_')}-renamed.zip`
      download(blob, name)
      clear(resultEl, alert('success', h('strong', 'ZIP ready. '), `${rows.length.toLocaleString()} files, ${formatBytes(blob.size)}. Your originals were not touched.`))
      celebrate(btn, 14)
    }, { label: 'Packing', errorTo: resultEl, progress: prog })
  }

  function doCsv() {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`
    const lines = ['original,new,folder,status', ...current.rows.map((r) => [q(r.it.name), q(r.next), q(r.it.dir), q(r.status === 'ok' ? 'renamed' : r.status === 'same' ? 'unchanged' : r.status === 'skipped' ? 'left out' : 'problem')].join(','))]
    download('﻿' + lines.join('\r\n') + '\r\n', 'rename-mapping.csv', 'text/csv;charset=utf-8')
  }

  function confirmInPlace(btn, n) {
    const ops = plan()
    const m = modal({
      title: `Rename ${n.toLocaleString()} file${n === 1 ? '' : 's'}?`, icon: 'pencil-line',
      body: h('div', { class: 'stack' }, h('p', { style: 'margin:0' }, `The files in "${st.rootName}" will be renamed on your disk. You can undo it right after, as long as you stay on this page.`),
        h('div', { class: 'small muted' }, `Example: ${ops[0].item.name} becomes ${ops[0].to}`)),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Rename now', { variant: 'primary', icon: 'check', onClick: () => { m.close(); runInPlace(btn, ops) } })],
    })
  }

  async function runInPlace(btn, ops) {
    await busy(btn, async () => {
      clear(resultEl)
      const root = st.rootHandle
      if (root) { if (!(await ensurePermission(root, 'readwrite'))) throw new Error('Permission to change files was not granted, so nothing was renamed.') } else {
        for (const o of ops) if (!(await ensurePermission(o.item.handle, 'readwrite'))) throw new Error('Permission to change files was not granted, so nothing was renamed.')
      }
      const before = new Map(ops.map((o) => [o.item, o.item.name]))
      let done
      try { done = await executeRenames(ops, (f) => prog.set(f, 'Renaming')) } catch (err) {
        if (err.done?.length) {
          st.undo = err.done.map((d) => ({ item: d.item, to: d.from }))
          renderUndo(`Stopped after ${err.done.length} file(s): ${errorMessage(err)}`, 'warn')
        }
        await refreshFiles()
        refreshNow()
        throw err
      }
      st.undo = done.map((d) => ({ item: d.item, to: before.get(d.item) }))
      await refreshFiles()
      renderUndo(`Renamed ${done.length.toLocaleString()} file${done.length === 1 ? '' : 's'} in "${st.rootName}".`, 'success')
      celebrate(btn, 18)
      refreshNow()
    }, { label: 'Renaming', errorTo: resultEl, progress: prog })
  }

  async function refreshFiles() {
    for (const it of st.items) { try { it.file = await it.handle.getFile() } catch { /* ignore */ } }
  }

  function renderUndo(text, type) {
    clear(resultEl, alert(type, h('strong', type === 'success' ? 'Done. ' : 'Heads up. '), text,
      st.undo?.length ? h('div', { class: 'row', style: 'margin-top:10px' }, button('Undo', { icon: 'undo-2', size: 'sm', onClick: (e) => undo(e.currentTarget) })) : null))
  }

  async function undo(btn) {
    const ops = st.undo
    if (!ops) return
    await busy(btn, async () => {
      await executeRenames(ops, (f) => prog.set(f, 'Undoing'))
      st.undo = null
      await refreshFiles()
      clear(resultEl, alert('info', 'Undone. Your files have their old names again.'))
      refreshNow()
    }, { label: 'Undoing', errorTo: resultEl, progress: prog })
  }

  const headEl = h('div', { class: 'fx-rn-head' }, h('h2', { style: 'margin:0;font-size:16px' }, 'Preview'), h('span', { class: 'small muted' }, 'Untick a row to leave that file out.'))
  const list = h('div', { class: 'fx-rn-list' }, rowsEl)
  headEl.hidden = list.hidden = statsEl.hidden = actions.hidden = true
  const preview = h('div', { class: 'stack' }, enrichProg.el, headEl, statsEl, list, actions, prog.el, resultEl)

  return {
    source: sourceBlock, preview, refresh, refreshNow, enrich: () => runEnrich().then(() => refresh()),
    items: () => st.items, hasItems: () => st.items.length > 0,
    setItems, state: st,
  }
}

function matchesAcceptLoose(file, accept) {
  const e = extOf(file.name)
  const t = (file.type || '').toLowerCase()
  return accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((a) => (a.startsWith('.') ? `.${e}` === a : a.endsWith('/*') ? t.startsWith(a.slice(0, -1)) : t === a))
}
