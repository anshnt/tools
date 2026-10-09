// Unzip / extract ZIP: open an archive without loading all of it, browse its folders, preview or download single files, test the
// checksums, and extract the selection to a folder (Chromium) or as downloads. Encrypted ZIPs are not supported. Local only.
import { h, icon, clear, dropzone, button, busy, alert, stats, input, field, progress, download, formatBytes, toast, errorMessage, onCleanup, modal, yieldToMain } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { readZipEntries, extractEntry, METHOD_NAMES, safeEntryPath, canPickDirectory, ensurePermission, fmtDateTime, naturalCompare, extOf, KINDS, kindOfName, throwIfAborted } from './_core.js'
import { useFx, card, chip, chips, tile, openPreview, injectStyle, celebrate, docGlyph, countUp, hit } from './_ui.js'

const PREVIEW_MAX = 60 * 1024 * 1024
const CSS = `
.fx-zt { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
.fx-zr { display: grid; grid-template-columns: minmax(0, 1fr) 90px 90px auto; gap: 8px; align-items: center; padding: 5px 10px; border-top: 1px solid var(--border); font-size: 13.5px; min-height: 38px; }
.fx-zr:first-child { border-top: 0; }
.fx-zr.head { background: var(--surface-2); color: var(--muted); font: 600 12px var(--font, inherit); text-transform: uppercase; letter-spacing: .04em; position: sticky; top: 0; z-index: 1; }
.fx-zr .nm { display: flex; align-items: center; gap: 6px; min-width: 0; }
.fx-zr .nm .t { overflow-wrap: anywhere; min-width: 0; }
.fx-zr .nm .t.dir { font-weight: 600; }
.fx-zr input[type=checkbox] { width: 17px; height: 17px; accent-color: var(--accent); margin: 0; flex: none; }
.fx-zr .tg { display: inline-grid; place-items: center; width: 24px; height: 24px; flex: none; border: 0; background: transparent; color: var(--muted); border-radius: 8px; cursor: pointer; padding: 0; transition: transform .2s var(--ease); }
.fx-zr .tg:hover { background: var(--surface-3); }
.fx-zr .tg[aria-expanded=true] { transform: rotate(90deg); }
.fx-zr .tg .icon { width: 16px; height: 16px; }
.fx-zr .sp { width: 24px; flex: none; }
.fx-zr .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-2); font-size: 12.5px; }
.fx-zr .acts { display: flex; gap: 2px; justify-content: flex-end; }
.fx-zr .acts button { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 5px; border-radius: 8px; display: inline-grid; }
.fx-zr .acts button:hover:not(:disabled) { color: var(--accent); background: var(--surface-3); }
.fx-zr .acts button:disabled { opacity: .35; cursor: not-allowed; }
.fx-zr .acts .icon { width: 16px; height: 16px; }
.fx-zr.enc .t { color: var(--muted); }
@media (max-width: 640px) { .fx-zr { grid-template-columns: minmax(0, 1fr) auto; } .fx-zr .n.p, .fx-zr.head .n.p { display: none; } .fx-zr.head .n:not(.p) { text-align: right; } }
`

// ---------- Pure helpers ----------
/** Build a folder tree from ZIP entries. Node: {name, path, dir, children: Map, entry?, size, csize, count}. */
export function buildZipTree(entries) {
  const root = { name: '', path: '', dir: true, children: new Map(), size: 0, csize: 0, count: 0, files: 0, unsafe: 0 }
  entries.forEach((entry, index) => {
    const raw = entry.name.replace(/\\/g, '/').split('/').filter(Boolean)
    const parts = raw.filter((x) => x !== '.' && x !== '..')
    if (parts.length && /^[A-Za-z]:$/.test(parts[0])) parts.shift()
    if (parts.length !== raw.length || entry.name.startsWith('/')) root.unsafe++
    if (!parts.length) return
    let node = root
    const chain = [root]
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1
      const isDir = !last || entry.dir
      let c = node.children.get(parts[i] + (isDir ? '/' : ''))
      if (!c) {
        c = { name: parts[i], path: parts.slice(0, i + 1).join('/'), dir: isDir, children: new Map(), size: 0, csize: 0, count: 0, files: 0 }
        node.children.set(parts[i] + (isDir ? '/' : ''), c)
      }
      node = c
      chain.push(c)
    }
    if (!entry.dir) {
      node.entry = entry
      node.index = index
      for (const n of chain) { n.size += entry.size; n.csize += entry.csize; n.files++ }
    }
  })
  return root
}
const sortKids = (node) => [...node.children.values()].sort((a, b) => (a.dir === b.dir ? naturalCompare(a.name, b.name) : a.dir ? -1 : 1))
const filesUnder = (node, out = []) => { if (!node.dir) out.push(node); for (const c of node.children.values()) filesUnder(c, out); return out }

export function mount(root, { signal }) {
  useFx()
  injectStyle('fx-unzip', CSS)
  let zipFile = null, entries = [], tree = null, ctl = null
  const selected = new Set() // file nodes
  const out = h('div', { class: 'stack' })
  const prog = progress('Working')
  const zone = dropzone({ multiple: false, label: 'Drop a ZIP file here or click to choose', hint: 'Also opens ZIP-based files such as .docx, .xlsx, .jar and .apk. Password-protected ZIPs are not supported.', onFiles: ([f]) => open(f) })
  root.append(h('div', { class: 'stack fx' }, zone, prog.el, out))
  onCleanup(() => ctl?.abort())
  signal.addEventListener('abort', () => ctl?.abort())

  async function open(f) {
    ctl?.abort()
    zipFile = f; entries = []; selected.clear()
    zone.classList.add('compact')
    clear(out, h('div', { class: 'fx-skel', style: 'height:90px;border-radius:16px' }))
    try {
      entries = await readZipEntries(f)
    } catch (e) {
      return clear(out, alert('error', errorMessage(e)))
    }
    if (!entries.length) return clear(out, alert('info', 'This ZIP file is empty. There is nothing to extract.'))
    tree = buildZipTree(entries)
    const files = entries.filter((e) => !e.dir)
    const total = files.reduce((s, e) => s + e.size, 0), packed = files.reduce((s, e) => s + e.csize, 0)
    const enc = files.filter((e) => e.encrypted).length
    const unsupported = files.filter((e) => !e.encrypted && e.method !== 0 && e.method !== 8).length
    const symlinks = files.filter((e) => e.symlink).length
    const bomb = total > 5 * 1024 ** 3 || (packed > 0 && total / packed > 1000 && total > 500 * 1024 * 1024)
    const sizeEl = h('div', { class: 'value' }, formatBytes(total))
    const st = stats([{ label: 'Files', value: files.length.toLocaleString(), hint: `${entries.length - files.length} folder entr${entries.length - files.length === 1 ? 'y' : 'ies'}` }, { label: 'Unpacked size', value: '', accent: true, hint: `${formatBytes(packed)} in the ZIP` }, { label: 'Compression', value: total ? `${Math.max(0, Math.round((1 - packed / total) * 100))}%` : '-', hint: 'space saved' }])
    st.querySelector('.stat.accent .value').replaceWith(sizeEl)
    countUp(sizeEl, total, formatBytes, 600)
    const toolbar = h('div')
    const filter = input({ placeholder: 'Filter by name', 'aria-label': 'Filter files', oninput: () => drawTree() })
    const treeHost = h('div')
    const resultEl = h('div')
    clear(out,
      h('div', { class: 'fx-hero fx-in', style: { '--k': '#d99a1e' } }, docGlyph(f.name, 'archive'), h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, f.name),
        h('div', { class: 'fx-sub' }, `${formatBytes(f.size)} · ${entries.length.toLocaleString()} entries`),
        chips(chip('Opened on this device', 'ok', 'shield-check'), enc ? chip(`${enc} encrypted`, 'bad', 'lock') : null, unsupported ? chip(`${unsupported} with unsupported compression`, 'warn', 'triangle-alert') : null, symlinks ? chip(`${symlinks} symbolic links`, '', 'link') : null, tree.unsafe ? chip(`${tree.unsafe} unsafe paths cleaned`, 'warn', 'shield-alert') : null))),
      enc ? alert('warn', h('strong', 'Password-protected files. '), `${enc} file${enc === 1 ? ' is' : 's are'} encrypted. Encrypted ZIPs are not supported here, so those files are greyed out. Use a desktop tool such as 7-Zip for them.`) : null,
      unsupported ? alert('warn', `${unsupported} file${unsupported === 1 ? ' uses' : 's use'} a compression method browsers cannot unpack (not Store or Deflate). Those are greyed out.`) : null,
      bomb ? alert('warn', 'This archive unpacks to a very large size compared with the ZIP itself. Only extract files you trust, and pick just the ones you need.') : null,
      st,
      h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { style: 'flex:1;min-width:220px' }, field('Filter', filter)),
        button('Expand all', { icon: 'chevrons-down', size: 'sm', onClick: () => drawTree({ all: true }) }), button('Collapse', { icon: 'chevrons-up', size: 'sm', variant: 'ghost', onClick: () => drawTree({ collapse: true }) })),
      treeHost, toolbar, resultEl)

    // ----- tree -----
    const rowEls = new Set()
    const usable = (n) => !n.entry.encrypted && (n.entry.method === 0 || n.entry.method === 8)
    function syncChecks() {
      for (const r of rowEls) {
        const n = r._node
        if (!r._cb) continue
        const leaves = n.dir ? filesUnder(n).filter(usable) : [n]
        const sel = leaves.filter((l) => selected.has(l)).length
        r._cb.checked = leaves.length > 0 && sel === leaves.length
        r._cb.indeterminate = sel > 0 && sel < leaves.length
        r._cb.disabled = !leaves.length
      }
      const nSel = selected.size
      const size = [...selected].reduce((s, n) => s + n.entry.size, 0)
      clear(toolbar, card('Extract', 'package-open', '#d99a1e', h('div', { class: 'stack' },
        h('div', { class: 'small muted' }, nSel ? `${nSel.toLocaleString()} file${nSel === 1 ? '' : 's'} selected (${formatBytes(size)}).` : 'Tick the files or folders you want, or extract everything.'),
        h('div', { class: 'row' },
          canPickDirectory() ? button(nSel ? 'Extract selected to a folder' : 'Extract all to a folder', { icon: 'folder-output', variant: 'primary', onClick: (e) => extractToFolder(e.currentTarget) }) : null,
          button(nSel === 1 ? 'Download this file' : nSel ? `Download ${nSel} files` : 'Download all files', { icon: 'download', variant: canPickDirectory() ? 'secondary' : 'primary', onClick: (e) => downloadFiles(e.currentTarget) }),
          nSel > 1 || (!nSel && files.length > 1) ? button('Save as a new ZIP', { icon: 'file-archive', variant: 'secondary', onClick: (e) => zipSelection(e.currentTarget) }) : null,
          button('Test archive', { icon: 'shield-check', variant: 'ghost', onClick: (e) => testAll(e.currentTarget) }),
          nSel ? button('Clear selection', { variant: 'ghost', size: 'sm', onClick: () => { selected.clear(); syncChecks() } }) : null),
        !canPickDirectory() ? h('div', { class: 'small muted' }, 'Your browser cannot write to folders, so extracted files come as downloads. Chrome and Edge can extract straight to a folder.') : null)))
    }
    function rowFor(node, depth, openState, label = node.name) {
      const dir = node.dir
      const e = node.entry
      const lockd = !dir && !usable(node)
      const row = h('div', { class: ['fx-zr', lockd && 'enc'] })
      row._node = node
      const cb = h('input', { type: 'checkbox', 'aria-label': `Select ${node.name}`, onchange: (ev) => {
        const leaves = dir ? filesUnder(node).filter(usable) : [node]
        for (const l of leaves) ev.target.checked ? selected.add(l) : selected.delete(l)
        syncChecks()
      } })
      row._cb = cb
      const tg = dir && node.children.size ? h('button', { class: 'tg', type: 'button', 'aria-expanded': String(!!openState), 'aria-label': `Expand ${node.name}` }, icon('chevron-right')) : h('span', { class: 'sp' })
      row.append(h('div', { class: 'nm', style: { paddingLeft: `${depth * 18}px` } }, hit(cb), tg, tile(node.name, { size: 'sm', kind: dir ? 'folder' : undefined }),
        h('span', { class: ['t', dir && 'dir'], title: node.path }, label, lockd && e.encrypted ? ' (encrypted)' : '')),
      h('div', { class: 'n' }, dir ? `${node.files.toLocaleString()} file${node.files === 1 ? '' : 's'}` : formatBytes(e.size)),
      h('div', { class: 'n p' }, formatBytes(dir ? node.csize : e.csize)),
      h('div', { class: 'acts' }, dir ? null : [
        h('button', { type: 'button', disabled: lockd || e.size > PREVIEW_MAX, 'aria-label': `Preview ${node.name}`, title: e && e.size > PREVIEW_MAX ? 'Too big to preview' : 'Preview', onclick: () => previewOne(node) }, icon('eye')),
        h('button', { type: 'button', disabled: lockd, 'aria-label': `Download ${node.name}`, title: 'Download', onclick: (ev) => downloadOne(node, ev.currentTarget) }, icon('download'))]))
      rowEls.add(row)
      if (dir && tg.tagName === 'BUTTON') {
        let kids = []
        const expand = () => {
          tg.setAttribute('aria-expanded', 'true')
          const list = sortKids(node)
          const shown = list.slice(0, 300)
          kids = shown.map((c) => rowFor(c, depth + 1, false))
          if (list.length > 300) kids.push(h('div', { class: 'small muted', style: { padding: `6px 10px 6px ${40 + depth * 18}px` } }, `${list.length - 300} more items. Use the filter to find them.`))
          let ref = row
          for (const k of kids) { ref.after(k); ref = k }
          syncChecks()
        }
        const collapse = () => {
          tg.setAttribute('aria-expanded', 'false')
          const drop = (r) => { if (r._node?.dir) for (const x of [...rowEls]) if (x._node && isInside(x._node, r._node) && x !== r) { rowEls.delete(x); x.remove() } }
          for (const k of kids) { rowEls.delete(k); k.remove(); drop(k) }
          kids = []
        }
        tg.addEventListener('click', () => (tg.getAttribute('aria-expanded') === 'true' ? collapse() : expand()))
        row._expand = expand
        row._collapse = collapse
      }
      return row
    }
    const isInside = (n, ancestor) => n.path.startsWith(ancestor.path + '/')

    function drawTree(opt = {}) {
      rowEls.clear()
      const q = filter.value.trim().toLowerCase()
      const box = h('div', { class: 'fx-zt' }, h('div', { class: 'fx-zr head' }, h('span', 'Name'), h('span', { class: 'n' }, 'Size'), h('span', { class: 'n p' }, 'Packed'), h('span')))
      const scroller = h('div', { style: 'max-height:560px;overflow:auto' }, box)
      clear(treeHost, scroller)
      if (q) {
        const hits = filesUnder(tree).filter((n) => n.path.toLowerCase().includes(q))
        if (!hits.length) box.append(h('div', { style: 'padding:14px' }, 'No file names match that filter.'))
        for (const n of hits.slice(0, 300)) { box.append(rowFor(n, 0, false, n.path)) }
        if (hits.length > 300) box.append(h('div', { class: 'small muted', style: 'padding:8px 12px' }, `Showing 300 of ${hits.length} matches.`))
      } else {
        const top = sortKids(tree)
        for (const n of top.slice(0, 300)) box.append(rowFor(n, 0, false))
        if (top.length > 300) box.append(h('div', { class: 'small muted', style: 'padding:8px 12px' }, `${top.length - 300} more items. Use the filter.`))
        const rows = [...box.querySelectorAll('.fx-zr:not(.head)')]
        if (opt.all) { const walk = () => { let again = false; for (const r of [...rowEls]) { if (r._expand && r.querySelector('.tg')?.getAttribute('aria-expanded') === 'false') { r._expand(); again = true } } if (again && rowEls.size < 3000) walk() }; walk() }
        else if (!opt.collapse && rows.length === 1 && rows[0]._expand) rows[0]._expand()
      }
      syncChecks()
    }
    // ----- actions -----
    const usableNodes = () => filesUnder(tree).filter(usable)
    const target = () => (selected.size ? [...selected] : usableNodes())
    const bytesOf = (node, onProgress) => extractEntry(zipFile, node.entry, { onProgress, signal: ctl.signal })
    const baseOf = () => zipFile.name.replace(/\.[^.]+$/, '') || 'archive'

    async function previewOne(node) {
      try { openPreview(await bytesOf(node), { name: node.path }) } catch (e) { toast(errorMessage(e), 'error') }
    }
    async function downloadOne(node, btn) {
      btn.disabled = true
      try { download(await bytesOf(node), node.name) } catch (e) { toast(errorMessage(e), 'error') } finally { btn.disabled = false }
    }

    async function downloadFiles(btn) {
      const list = target()
      if (!list.length) return toast('There are no files that can be extracted.', 'error')
      if (list.length > 40) return toast(`${list.length} separate downloads is too many for a browser. Tick fewer files, or save them as one ZIP.`, 'error')
      await busy(btn, async () => {
        clear(resultEl)
        let n = 0
        for (const node of list) {
          throwIfAborted(ctl.signal)
          prog.set(n / list.length, `Extracting ${node.name}`)
          download(await bytesOf(node), node.name)
          n++
          await new Promise((r) => setTimeout(r, 250))
        }
        clear(resultEl, alert('success', h('strong', 'Done. '), `${n} file${n === 1 ? '' : 's'} sent to your downloads. If some are missing, your browser may have asked to allow multiple downloads.`))
      }, { label: 'Extracting', errorTo: resultEl, progress: prog })
    }

    async function zipSelection(btn) {
      const list = target()
      if (!list.length) return
      await busy(btn, async () => {
        clear(resultEl)
        const JSZip = await jszip()
        const z = new JSZip()
        let n = 0
        for (const node of list) {
          throwIfAborted(ctl.signal)
          prog.set(n++ / list.length, `Extracting ${node.name}`)
          z.file(node.path, await bytesOf(node), { date: node.entry.date || undefined })
        }
        const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (m) => prog.set(m.percent / 100, 'Packing ZIP'))
        download(blob, `${baseOf()}-selection.zip`)
        clear(resultEl, alert('success', h('strong', 'Done. '), `A new ZIP with ${list.length} file${list.length === 1 ? '' : 's'} (${formatBytes(blob.size)}) was downloaded.`))
      }, { label: 'Packing', errorTo: resultEl, progress: prog })
    }

    async function extractToFolder(btn) {
      const list = target()
      if (!list.length) return toast('There are no files that can be extracted.', 'error')
      let dir
      try { dir = await window.showDirectoryPicker({ id: 'tools-files', mode: 'readwrite' }) } catch (e) { if (e?.name === 'AbortError') return; return toast(errorMessage(e), 'error') }
      await busy(btn, async () => {
        clear(resultEl)
        if (!(await ensurePermission(dir, 'readwrite'))) throw new Error('Permission to write to that folder was not granted.')
        const base = await dir.getDirectoryHandle(baseOf().replace(/[\\/:*?"<>|]+/g, '_') || 'extracted', { create: true })
        const dirAt = async (parts) => { let d = base; for (const p of parts) d = await d.getDirectoryHandle(p, { create: true }); return d }
        let n = 0, bytes = 0, renamed = 0
        for (const node of list) {
          throwIfAborted(ctl.signal)
          prog.set(n / list.length, `Extracting ${node.name}`)
          const parts = safeEntryPath(node.path).split('/').filter(Boolean)
          if (!parts.length) continue
          const fileName = parts.pop()
          const d = await dirAt(parts)
          let finalName = fileName, k = 2
          for (;;) {
            try { await d.getFileHandle(finalName) } catch { break }
            const dot = fileName.lastIndexOf('.')
            finalName = dot > 0 ? `${fileName.slice(0, dot)} (${k++})${fileName.slice(dot)}` : `${fileName} (${k++})`
            renamed++
          }
          const blob = await bytesOf(node)
          const w = await (await d.getFileHandle(finalName, { create: true })).createWritable()
          await blob.stream().pipeTo(w)
          n++; bytes += blob.size
        }
        if (!selected.size) for (const e of entries.filter((x) => x.dir)) { const parts = safeEntryPath(e.name).split('/').filter(Boolean); if (parts.length) await dirAt(parts) }
        prog.set(1, 'Done')
        clear(resultEl, alert('success', h('strong', 'Extracted. '), `${n.toLocaleString()} file${n === 1 ? '' : 's'} (${formatBytes(bytes)}) saved in the folder "${base.name}" inside the folder you picked.${renamed ? ` ${renamed} name clash${renamed === 1 ? ' was' : 'es were'} numbered so nothing was overwritten.` : ''}`))
        celebrate(btn, 18)
      }, { label: 'Extracting', errorTo: resultEl, progress: prog })
    }

    async function testAll(btn) {
      const list = usableNodes()
      await busy(btn, async () => {
        clear(resultEl)
        const bad = []
        let n = 0
        for (const node of list) {
          throwIfAborted(ctl.signal)
          prog.set(n++ / (list.length || 1), `Checking ${node.name}`)
          try { await bytesOf(node) } catch (e) { if (e?.code === 'ABORT') throw e; bad.push(`${node.path}: ${errorMessage(e)}`) }
          if (n % 10 === 0) await yieldToMain()
        }
        clear(resultEl, bad.length
          ? alert('error', h('strong', `${bad.length} problem${bad.length === 1 ? '' : 's'} found. `), 'The archive may be damaged.', h('ul', { style: 'margin:8px 0 0;padding-left:18px' }, bad.slice(0, 20).map((b) => h('li', b))))
          : alert('success', h('strong', 'All good. '), `${list.length.toLocaleString()} file${list.length === 1 ? '' : 's'} unpacked and every checksum matched.`))
      }, { label: 'Testing', errorTo: resultEl, progress: prog })
    }
    ctl = new AbortController()
    drawTree()
  }
}
