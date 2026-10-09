// Find duplicate files: group by size, narrow with a quick fingerprint, confirm with a full SHA-256, then let you pick which copy to
// keep. Browsers rarely allow deleting, so you can export the list, download a ZIP without the extras, or (Chromium) move the extra
// copies into a "_duplicates" folder with one-click undo. Everything stays on this device.
import { h, icon, clear, button, busy, alert, stats, field, select, toggle, input, progress, modal, download, formatBytes, toast, errorMessage, onCleanup, yieldToMain } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { hashBlob, ensurePermission, canPickDirectory, kindOfName, KINDS, fmtDateTime, throwIfAborted } from './_core.js'
import { useFx, folderZone, card, chip, chips, tile, openPreview, injectStyle, celebrate } from './_ui.js'

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const BIG = 256 * 1024

/**
 * Find duplicate groups among scan entries ({path, name, size, file, ...}). Same size, then a fingerprint of the first and last 64 KB,
 * then a full SHA-256 only for files that still collide. Resolves {groups: [{size, hash, files}], hashedBytes}. groups are sorted by wasted space.
 */
export async function findDuplicates(entries, { minSize = 1, includeEmpty = false, onProgress, signal, cache = new Map() } = {}) {
  const bySize = new Map()
  for (const e of entries) {
    if (e.size === 0 ? !includeEmpty : e.size < minSize) continue
    ;(bySize.get(e.size) || bySize.set(e.size, []).get(e.size)).push(e)
  }
  const cand = [...bySize.values()].filter((g) => g.length > 1)
  const totalBytes = cand.reduce((s, g) => s + (g[0].size ? g[0].size * g.length : 0), 0) || 1
  let done = 0
  const groups = []
  const report = (extra, name) => onProgress?.(Math.min(1, (done + extra) / totalBytes), name)
  const fullHash = async (e) => {
    const c = cache.get(e) || cache.set(e, {}).get(e)
    if (c.full) { done += e.size; report(0, e.name); return c.full }
    c.full = (await hashBlob(e.file, ['sha256'], { signal, onProgress: (f) => report(f * e.size, e.name) })).sha256
    done += e.size
    report(0, e.name)
    return c.full
  }
  const partial = async (e) => {
    const c = cache.get(e) || cache.set(e, {}).get(e)
    if (!c.part) c.part = (await hashBlob(new Blob([e.file.slice(0, 65536), e.file.slice(e.size - 65536)]), ['md5'], { signal })).md5
    return c.part
  }
  for (const g of cand) {
    throwIfAborted(signal)
    if (g[0].size === 0) { groups.push({ size: 0, hash: EMPTY_SHA, files: g }); continue }
    let buckets = [g]
    if (g[0].size > BIG) {
      const m = new Map()
      for (const e of g) { const k = await partial(e); (m.get(k) || m.set(k, []).get(k)).push(e); await yieldToMain() }
      buckets = [...m.values()]
      for (const b of buckets) if (b.length < 2) done += b[0].size
    }
    for (const b of buckets) {
      if (b.length < 2) continue
      const m = new Map()
      for (const e of b) { const k = await fullHash(e); (m.get(k) || m.set(k, []).get(k)).push(e); await yieldToMain() }
      for (const [hash, files] of m) if (files.length > 1) groups.push({ size: g[0].size, hash, files })
    }
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1) || b.files.length - a.files.length)
  return { groups, hashedBytes: done }
}

/** Index of the file to keep in a group for a rule: oldest | newest | shortest | longest | alpha. */
export function keepIndex(files, rule) {
  const best = (cmp) => files.reduce((bi, f, i) => (cmp(f, files[bi]) < 0 ? i : bi), 0)
  switch (rule) {
    case 'newest': return best((a, b) => b.mtime - a.mtime)
    case 'shortest': return best((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))
    case 'longest': return best((a, b) => b.path.length - a.path.length || a.path.localeCompare(b.path))
    case 'alpha': return best((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
    default: return best((a, b) => a.mtime - b.mtime || a.path.length - b.path.length)
  }
}

// ---------- Moving files with the File System Access API ----------
async function dirAt(root, parts) {
  let d = root
  for (const p of parts) d = await d.getDirectoryHandle(p, { create: true })
  return d
}
async function nameFree(dir, name) {
  const [stem, ext] = /^(.*?)(\.[^.]*)?$/.exec(name).slice(1)
  let n = name, i = 2
  for (;;) {
    let taken = false
    try { await dir.getFileHandle(n); taken = true } catch { /* free as a file */ }
    if (!taken) { try { await dir.getDirectoryHandle(n); taken = true } catch { /* free */ } }
    if (!taken) return n
    n = `${stem} (${i++})${ext || ''}`
  }
}
async function moveFile(entry, destDir, destName) {
  const h0 = entry.handle
  if (h0.move) { try { await h0.move(destDir, destName); return } catch { /* fall back to copy and remove */ } }
  const file = await h0.getFile()
  const dest = await destDir.getFileHandle(destName, { create: true })
  const w = await dest.createWritable()
  try { await file.stream().pipeTo(w) } catch (e) { try { await destDir.removeEntry(destName) } catch { /* ignore */ } throw e }
  await entry.parent.removeEntry(h0.name)
  entry.handle = dest
}

const CSS = `
.fx-dg { display: grid; gap: 12px; }
.fx-g { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.fx-g-h { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border); background: linear-gradient(90deg, color-mix(in srgb, var(--k) 9%, var(--surface)), var(--surface) 70%); }
.fx-g-h .tt { font-weight: 600; overflow-wrap: anywhere; min-width: 0; flex: 1 1 200px; }
.fx-gf { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 9px 14px; border-top: 1px solid var(--border); font-size: 13.5px; cursor: pointer; transition: background .2s; }
.fx-gf:first-of-type { border-top: 0; }
.fx-gf:hover { background: var(--surface-2); }
.fx-gf input[type=radio] { width: 18px; height: 18px; accent-color: var(--success); margin: 0; }
.fx-gf .pth { overflow-wrap: anywhere; min-width: 0; }
.fx-gf .pth small { display: block; color: var(--muted); font-size: 12px; }
.fx-gf.keep { background: var(--success-soft); }
.fx-gf.extra .pth b { text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--danger) 60%, transparent); font-weight: 500; color: var(--text-2); }
.fx-gf .acts { display: flex; gap: 6px; align-items: center; }
.fx-gf .pv { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 8px; display: inline-grid; }
.fx-gf .pv:hover { color: var(--accent); background: var(--surface-3); }
.fx-gf .pv .icon { width: 16px; height: 16px; }
@media (max-width: 560px) { .fx-gf { grid-template-columns: 28px minmax(0, 1fr); } .fx-gf .acts { grid-column: 2; } }
`

export function mount(root) {
  useFx()
  injectStyle('fx-dups', CSS)
  const out = h('div', { class: 'stack' })
  const prog = progress('Scanning')
  const cancelBtn = button('Cancel', { variant: 'ghost', size: 'sm', onClick: () => ctl?.abort() })
  const progBox = h('div', { class: 'stack tight' }, prog.el)
  let scan = null, result = null, ctl = null, keeps = new Map(), rule = 'oldest', shownGroups = 50, filter = ''
  const cache = new Map()
  const moved = new Set()
  let lastMove = null
  const opts = { minSize: 1, includeEmpty: false }

  const zone = folderZone({ write: false, label: 'Drop a folder here or click to choose one', skip: (n, isDir) => isDir && n === '_duplicates', onFolder: (res) => { scan = res; moved.clear(); lastMove = null; run() } })
  const minSel = select([[1, 'Any size'], [1024, 'Bigger than 1 KB'], [102400, 'Bigger than 100 KB'], [1048576, 'Bigger than 1 MB'], [10485760, 'Bigger than 10 MB']], opts.minSize, (v) => { opts.minSize = +v; if (scan) run() })
  const emptyBox = toggle('Also match empty files', false, (v) => { opts.includeEmpty = v; if (scan) run() })
  const optionsRow = h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { style: 'min-width:200px' }, field('Look at files', minSel)), emptyBox)
  optionsRow.hidden = true
  root.append(h('div', { class: 'stack fx' }, zone, optionsRow, progBox, out))
  onCleanup(() => ctl?.abort())

  async function run() {
    ctl?.abort()
    const mine = (ctl = new AbortController())
    clear(out)
    optionsRow.hidden = false
    zone.classList.add('compact')
    prog.set(0, 'Grouping files by size')
    progBox.append(cancelBtn)
    const t0 = performance.now()
    try {
      const entries = scan.entries.filter((e) => !moved.has(e))
      result = await findDuplicates(entries, { ...opts, signal: mine.signal, cache, onProgress: (f, name) => prog.set(f, `Checking contents ${Math.round(f * 100)}%${name ? `: ${name}` : ''}`) })
      if (mine.signal.aborted) return
      keeps = new Map(result.groups.map((g, i) => [i, keepIndex(g.files, rule)]))
      shownGroups = 50
      render(Math.round(performance.now() - t0))
    } catch (e) {
      if (e?.code === 'ABORT') { clear(out, alert('info', 'Stopped. Choose the folder again to restart.')); return }
      console.error(e)
      clear(out, alert('error', errorMessage(e)))
    } finally { prog.hide(); cancelBtn.remove() }
  }

  const extras = () => {
    const list = []
    result.groups.forEach((g, gi) => g.files.forEach((f, fi) => { if (fi !== keeps.get(gi) && !moved.has(f)) list.push({ f, g, gi }) }))
    return list
  }

  function render(ms) {
    const gs = result.groups
    const wasted = gs.reduce((s, g) => s + g.size * (g.files.length - 1), 0)
    const copies = gs.reduce((s, g) => s + g.files.length - 1, 0)
    if (!gs.length) {
      clear(out, h('div', { class: 'fx-hero fx-in', style: { '--k': 'var(--success)' } }, h('div', { class: 'fx-tile lg fx-pop', style: { '--k': 'var(--success)' } }, icon('circle-check')),
        h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, 'No duplicates found'), h('div', { class: 'fx-sub' }, `All ${scan.entries.length.toLocaleString()} files in "${scan.name}" are different. Checked in ${ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(1) + ' s'}.`))))
      return
    }
    const top = h('div', { class: 'stack' },
      stats([{ label: 'Duplicate groups', value: gs.length.toLocaleString() }, { label: 'Extra copies', value: copies.toLocaleString() }, { label: 'Space you could free', value: formatBytes(wasted), accent: true, hint: `${wasted.toLocaleString()} bytes` },
        { label: 'Files checked', value: scan.entries.length.toLocaleString(), hint: `${formatBytes(result.hashedBytes)} compared` }]),
      actionsCard(wasted))
    const groupsEl = h('div', { class: 'fx-dg' })
    const more = h('div', { class: 'row', style: 'justify-content:center' })
    function drawGroups() {
      const arr = byFilter(gs)
      clear(groupsEl, arr.slice(0, shownGroups).map(({ g, gi }, i) => groupCard(g, gi, i)))
      clear(more, arr.length > shownGroups ? button(`Show ${Math.min(50, arr.length - shownGroups)} more groups`, { onClick: () => { shownGroups += 50; drawGroups() } }) : null)
    }
    const q = input({ placeholder: 'Filter groups by file name or folder', 'aria-label': 'Filter groups', oninput: (e) => { filter = e.target.value.toLowerCase(); shownGroups = 50; drawGroups() } })
    const ruleSel = select([['oldest', 'Keep the oldest file'], ['newest', 'Keep the newest file'], ['shortest', 'Keep the shortest path'], ['longest', 'Keep the longest path'], ['alpha', 'Keep the first by name']], rule, (v) => {
      rule = v
      result.groups.forEach((g, i) => keeps.set(i, keepIndex(g.files, rule)))
      render(ms)
    })
    clear(out, top, h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { style: 'min-width:220px' }, field('In every group', ruleSel)), h('div', { style: 'flex:1;min-width:220px' }, field('Filter', q))), groupsEl, more)
    drawGroups()
    function byFilter(arr) { return arr.map((g, gi) => ({ g, gi })).filter(({ g }) => !filter || g.files.some((f) => f.path.toLowerCase().includes(filter))) }
  }

  function groupCard(g, gi, i) {
    const keep = keeps.get(gi)
    const k = KINDS[kindOfName(g.files[0].name)] || KINDS.other
    const el = h('section', { class: 'fx-g fx-in', style: { '--k': k.color, '--i': Math.min(i, 8) } },
      h('div', { class: 'fx-g-h' }, tile(g.files[0].name, { size: 'sm' }), h('div', { class: 'tt' }, g.files[keep].name),
        chips(chip(`${g.files.length} copies`, 'accent', 'copy'), chip(`${formatBytes(g.size)} each`, '', 'weight'), chip(`${formatBytes(g.size * (g.files.length - 1))} extra`, 'bad', 'trash-2'))),
      g.files.map((f, fi) => {
        const radio = h('input', { type: 'radio', name: `g${gi}`, checked: fi === keep, 'aria-label': `Keep ${f.path}`, onchange: () => { keeps.set(gi, fi); refreshGroup() } })
        const row = h('label', { class: ['fx-gf', fi === keep ? 'keep' : 'extra'] }, radio,
          h('div', { class: 'pth' }, h('b', f.name), h('small', `${f.dir || '(top folder)'} · ${fmtDateTime(f.mtime)}`)),
          h('div', { class: 'acts' }, fi === keep ? chip('Keep', 'ok', 'check') : chip('Extra', 'warn', 'minus'),
            h('button', { type: 'button', class: 'pv', 'aria-label': `Preview ${f.name}`, title: 'Preview', onclick: (e) => { e.preventDefault(); openPreview(f.file, { name: f.path }) } }, icon('eye'))))
        return row
      }))
    const refreshGroup = () => { el.replaceWith(groupCard(g, gi, 0)); updateActions() }
    return el
  }

  // ----- Actions -----
  const actionHost = h('div')
  function actionsCard(wasted) {
    clear(actionHost)
    const n = extras().length
    const size = extras().reduce((s, x) => s + x.g.size, 0)
    const canMove = !!scan.handle && canPickDirectory()
    const listBtn = button('Download list of extras', { icon: 'list-x', onClick: () => exportList() })
    const csvBtn = button('CSV report', { icon: 'table', variant: 'ghost', onClick: () => exportCsv() })
    const zipBtn = button('ZIP without the extras', { icon: 'file-archive', onClick: () => doZip(zipBtn) })
    const moveBtn = canMove ? button('Move extras to a _duplicates folder', { icon: 'folder-output', variant: 'primary', onClick: () => confirmMove(moveBtn) }) : null
    const resultEl = h('div')
    actionHost.resultEl = resultEl
    clear(actionHost, h('section', { class: 'fx-card fx-in', style: { '--k': '#e5484d' } },
      h('h2', { class: 'fx-card-h' }, h('span', { class: 'fx-tile sm', style: { '--k': '#e5484d' } }, icon('trash-2')), h('span', 'What to do with the extras')),
      h('div', { class: 'stack' }, h('div', { class: 'small muted', 'data-extras': '' }, `${n.toLocaleString()} file${n === 1 ? '' : 's'} (${formatBytes(size)}) are marked as extra copies. Pick which copy to keep in each group below. Nothing is deleted by this tool.`),
        h('div', { class: 'row' }, moveBtn, zipBtn, listBtn, csvBtn),
        !canMove ? h('div', { class: 'small muted' }, 'Your browser cannot move files, so export the list or take a ZIP of the files to keep. In Chrome or Edge you can also move the extras with one click.') : null,
        resultEl)))
    return actionHost
  }
  function updateActions() {
    const list = extras()
    const el = actionHost.querySelector('[data-extras]')
    if (el) el.textContent = `${list.length.toLocaleString()} file${list.length === 1 ? '' : 's'} (${formatBytes(list.reduce((s, x) => s + x.g.size, 0))}) are marked as extra copies. Pick which copy to keep in each group below. Nothing is deleted by this tool.`
  }

  function exportList() {
    const list = extras()
    download(list.map((x) => x.f.path).join('\r\n') + '\r\n', `${scan.name}-duplicates-to-remove.txt`, 'text/plain;charset=utf-8')
  }
  function exportCsv() {
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`
    const lines = ['group,action,path,size_bytes,modified,sha256']
    result.groups.forEach((g, gi) => g.files.forEach((f, fi) => { if (!moved.has(f)) lines.push([gi + 1, fi === keeps.get(gi) ? 'keep' : 'extra', q(f.path), g.size, fmtDateTime(f.mtime, true), g.hash].join(',')) }))
    download('﻿' + lines.join('\r\n') + '\r\n', `${scan.name}-duplicates.csv`, 'text/csv;charset=utf-8')
  }

  async function doZip(btn) {
    const drop = new Set(extras().map((x) => x.f))
    const keepers = scan.entries.filter((e) => !drop.has(e) && !moved.has(e))
    const total = keepers.reduce((s, e) => s + e.size, 0)
    if (total > 3 * 1024 ** 3) return toast('The files to keep add up to more than 3 GB, which is too much for a browser ZIP. Use the list instead.', 'error')
    await busy(btn, async () => {
      const JSZip = await jszip()
      const z = new JSZip()
      for (const e of keepers) z.file(e.path, e.file, { date: new Date(e.mtime) })
      const blob = await z.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (m) => prog.set(m.percent / 100, 'Packing ZIP'))
      download(blob, `${scan.name}-no-duplicates.zip`)
      clear(actionHost.resultEl, alert('success', h('strong', 'ZIP ready. '), `${keepers.length.toLocaleString()} files, ${formatBytes(blob.size)}. It has one copy of every file and your folder structure.`))
      celebrate(btn, 14)
    }, { label: 'Packing', errorTo: actionHost.resultEl, progress: prog })
  }

  function confirmMove(btn) {
    const list = extras()
    if (!list.length) return toast('No extra copies are marked.', 'info')
    const size = list.reduce((s, x) => s + x.g.size, 0)
    const m = modal({
      title: `Move ${list.length.toLocaleString()} extra file${list.length === 1 ? '' : 's'}?`, icon: 'folder-output',
      body: h('div', { class: 'stack' }, h('p', { style: 'margin:0' }, `${formatBytes(size)} of duplicates will move into a "_duplicates" folder inside "${scan.name}", keeping their sub-folders. Nothing is deleted, and you can undo it right after.`),
        h('div', { class: 'small muted' }, 'You will be asked to allow changes to this folder.')),
      actions: [button('Cancel', { onClick: () => m.close() }), button('Move them', { variant: 'primary', icon: 'check', onClick: () => { m.close(); doMove(btn, list) } })],
    })
  }

  async function doMove(btn, list) {
    await busy(btn, async () => {
      if (!(await ensurePermission(scan.handle, 'readwrite'))) throw new Error('Permission to change this folder was not granted, so nothing was moved.')
      const done = []
      try {
        let n = 0
        for (const { f } of list) {
          const parts = ['_duplicates', ...(f.dir ? f.dir.split('/') : [])]
          const dir = await dirAt(scan.handle, parts)
          const name = await nameFree(dir, f.name)
          const origParent = f.parent, origName = f.name
          await moveFile(f, dir, name)
          done.push({ f, dir, name, origParent, origName })
          prog.set(++n / list.length, `Moving ${n} of ${list.length}`)
        }
      } catch (e) {
        if (done.length) { done.forEach((d) => moved.add(d.f)); lastMove = done }
        e.message = `${e.message} (${done.length} file${done.length === 1 ? '' : 's'} were moved before the problem.)`
        throw e
      }
      done.forEach((d) => moved.add(d.f))
      lastMove = done
      showMoved(done)
      celebrate(btn, 18)
    }, { label: 'Moving', errorTo: actionHost.resultEl, progress: prog })
  }

  function showMoved(done) {
    clear(actionHost.resultEl, alert('success', h('strong', 'Done. '), `${done.length.toLocaleString()} extra file${done.length === 1 ? '' : 's'} moved into "_duplicates". Your originals of each file stay where they were.`,
      h('div', { class: 'row', style: 'margin-top:10px' }, button('Undo', { icon: 'undo-2', size: 'sm', onClick: (e) => undoMove(e.currentTarget) }), button('Scan again', { icon: 'refresh-cw', size: 'sm', variant: 'ghost', onClick: () => run() }))))
  }

  async function undoMove(btn) {
    const done = lastMove
    if (!done) return
    await busy(btn, async () => {
      let n = 0
      for (const d of [...done].reverse()) {
        const dir = d.origParent
        const name = await nameFree(dir, d.origName)
        await moveFile({ handle: d.f.handle, parent: d.dir }, dir, name)
        d.f.name = name
        try { d.f.file = await d.f.handle.getFile() } catch { /* keep the old snapshot */ }
        moved.delete(d.f)
        prog.set(++n / done.length, `Restoring ${n} of ${done.length}`)
      }
      lastMove = null
      toast('Undone. The extra copies are back where they were.', 'success')
      await run()
    }, { label: 'Restoring', errorTo: actionHost.resultEl, progress: prog })
  }
}
