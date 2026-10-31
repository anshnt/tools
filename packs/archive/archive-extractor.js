// Archive extractor: open ZIP, 7z, RAR, TAR (+gz/bz2/xz/zst), ISO, CAB and many more, browse the contents as a tree, preview text and
// images, then save one file, a folder, a selection or everything (as a new ZIP or straight into a folder). Passwords stay on this device.
import { h, icon, clear, dropzone, button, busy, alert, stats, input, field, progress, download, formatBytes, toast, errorMessage, onCleanup, isAbort } from '../../lib/ui.js'
import { tile, chip, chips, docGlyph, card, openPreview, celebrate, countUp, hit } from '../files/_ui.js'
import { canPickDirectory, ensurePermission, safeEntryPath } from '../files/_core.js'
import { openArchive } from './_engine.js'
import { createSink, cleanPath, abortable } from './_write.js'
import { useAx, buildTree, sortedKids, filesUnder, fmtDate, formatLabel, looksLikeArchive, passwordPrompt } from './_ui.js'

const PREVIEW_MAX = 60 * 1024 * 1024
const PAGE = 300
const HINTS = {
  rar: 'RAR 4 and RAR 5, also with a password.',
  '7z': '7z archives, also with a password or encrypted file names.',
  tar: 'TAR, TAR.GZ, TGZ, TAR.BZ2, TAR.XZ and TAR.ZST.',
  iso: 'ISO 9660 disc images: browse and pull out single files.',
}

export function mount(root, { params = {}, signal }) {
  useAx()
  const out = h('div', { class: 'stack' })
  const prog = progress('Working')
  let op = null
  const cancelBtn = button('Cancel', { icon: 'x', variant: 'ghost', size: 'sm', onClick: () => op?.abort() })
  cancelBtn.hidden = true
  const progRow = h('div', { class: 'stack tight' }, prog.el, cancelBtn)
  const zone = dropzone({
    multiple: false,
    label: 'Drop an archive here or click to choose',
    hint: `${HINTS[params.focus] || 'ZIP, 7Z, RAR, TAR, TAR.GZ, TGZ, TAR.BZ2, TAR.XZ, ISO, CAB, LZH, CPIO, DEB, RPM, XAR, WIM, GZ, BZ2, XZ, Z, ZST, APK, JAR.'} Nothing is uploaded.`,
    onFiles: ([f]) => start(f),
  })
  root.append(h('div', { class: 'stack fx' }, zone, out))
  const stack = [] // opened archives (nested archives push, Back pops)
  const closeAll = () => { op?.abort(); for (const s of stack) s.arc.close() }
  onCleanup(closeAll)
  signal.addEventListener('abort', closeAll)

  async function start(file, parent) {
    op?.abort()
    if (!parent) { for (const s of stack) s.arc.close(); stack.length = 0 }
    zone.classList.add('compact')
    clear(out, h('div', { class: 'fx-skel', style: 'height:90px;border-radius:16px' }))
    let arc
    try {
      arc = await openArchive(file, { signal })
    } catch (e) {
      if (isAbort(e)) return
      if (e.code === 'NEEDPW' || e.code === 'BADPW') return askPassword(file, parent)
      return clear(out, alert('error', errorMessage(e)), parent ? backBar(parent) : null)
    }
    stack.push({ arc, file, parent })
    show(arc, file, parent)
  }

  function askPassword(file, parent) {
    clear(out, h('div', { class: 'fx-hero fx-in', style: { '--k': '#d99a1e' } }, docGlyph(file.name, 'archive'), h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, file.name), h('div', { class: 'fx-sub' }, `${formatBytes(file.size)} · file names are encrypted`))),
      passwordPrompt({ message: 'Even the file names are encrypted, so a password is needed to see inside.', onSubmit: async (pw) => {
        let arc
        try { arc = await openArchive(file, { password: pw, signal }) } catch (e) { if (e.code === 'NEEDPW') throw Object.assign(new Error('That password did not work.'), { code: 'BADPW' }); throw e }
        if (arc.encrypted) await arc.setPassword(pw, signal)
        stack.push({ arc, file, parent })
        show(arc, file, parent)
      } }), parent ? backBar(parent) : null)
  }

  const backBar = (parent) => button(`Back to ${parent.file.name}`, { icon: 'arrow-left', variant: 'ghost', size: 'sm', onClick: () => back() })
  function back() {
    const cur = stack.pop()
    cur?.arc.close()
    const prev = stack[stack.length - 1]
    if (prev) show(prev.arc, prev.file, prev.parent)
  }

  function show(arc, f, parent) {
    const { root: tree, unsafe } = buildTree(arc.entries)
    const files = arc.files()
    const folders = arc.entries.filter((e) => e.type === 'dir').length
    const total = files.reduce((s, e) => s + e.size, 0)
    const selected = new Set()
    const rows = new Set()
    const lockHost = h('div')
    const toolbar = h('div')
    const treeHost = h('div')
    const resultEl = h('div', { class: 'stack' })
    const filter = input({ placeholder: 'Search file names', 'aria-label': 'Search files', oninput: () => drawTree() })
    const usable = (n) => n.entry?.type === 'file'
    const baseOf = () => (f.name.replace(/\.(tar\.[a-z0-9]+|[^./\\]+)$/i, '') || 'archive')
    const sizeEl = h('div', { class: 'value' }, formatBytes(total))
    const st = stats([{ label: 'Files', value: files.length.toLocaleString(), hint: folders ? `${folders.toLocaleString()} folder${folders === 1 ? '' : 's'}` : '' }, { label: 'Unpacked size', value: '', accent: true, hint: `${formatBytes(f.size)} archive` }, { label: 'Format', value: formatLabel(arc), hint: f.size > 0 ? `${formatBytes(f.size)} file` : '' }])
    st.querySelector('.stat.accent .value').replaceWith(sizeEl)
    countUp(sizeEl, total, formatBytes, 600)

    const lock = () => {
      clear(lockHost, arc.needsPassword ? passwordPrompt({ message: `${files.filter((e) => e.encrypted).length.toLocaleString()} file${files.filter((e) => e.encrypted).length === 1 ? ' is' : 's are'} encrypted. Type the password to open them.`, onSubmit: async (pw) => { await arc.setPassword(pw, signal); lock(); syncChecks(); toast('Unlocked', 'success') } }) : null)
    }

    clear(out,
      parent ? h('div', { class: 'ax-crumbs' }, backBar(parent), h('span', `Inside ${parent.file.name}`)) : null,
      h('div', { class: 'fx-hero fx-in', style: { '--k': '#d99a1e' } }, docGlyph(f.name, 'archive'), h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, f.name),
        h('div', { class: 'fx-sub' }, `${formatBytes(f.size)} · ${arc.entries.length.toLocaleString()} entr${arc.entries.length === 1 ? 'y' : 'ies'}`),
        chips(chip('Opened on this device', 'ok', 'shield-check'), arc.encrypted ? chip('Encrypted', 'warn', 'lock') : null, unsafe ? chip(`${unsafe} unsafe path${unsafe === 1 ? '' : 's'} cleaned`, 'warn', 'shield-alert') : null,
          arc.entries.some((e) => e.type === 'link') ? chip('Contains links (skipped)', '', 'link') : null))),
      lockHost,
      f.size > 1024 ** 3 ? alert('info', 'This is a big archive. Opening works, but extracting everything at once needs a lot of memory. Pick just the files you need.') : null,
      total > 5 * 1024 ** 3 || (f.size > 0 && total / f.size > 1000 && total > 500 * 1024 * 1024) ? alert('warn', 'This archive unpacks to a very large size compared with the file itself. Only extract files you trust, and pick just the ones you need.') : null,
      st,
      !files.length ? alert('info', 'This archive has no files, only empty folders.') : null,
      h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { style: 'flex:1;min-width:220px' }, field('Search', filter)),
        button('Expand all', { icon: 'chevrons-down', size: 'sm', onClick: () => drawTree({ all: true }) }), button('Collapse', { icon: 'chevrons-up', size: 'sm', variant: 'ghost', onClick: () => drawTree({ collapse: true }) })),
      treeHost, toolbar, progRow, resultEl)
    lock()

    // ----- tree -----
    const leavesOf = (n) => (n._leaves ||= (n.dir ? filesUnder(n).filter(usable) : [n]))
    function syncChecks() {
      for (const r of rows) {
        if (!r.isConnected) { rows.delete(r); continue }
        const leaves = leavesOf(r._node)
        const sel = leaves.reduce((s, l) => s + (selected.has(l) ? 1 : 0), 0)
        r._cb.checked = leaves.length > 0 && sel === leaves.length
        r._cb.indeterminate = sel > 0 && sel < leaves.length
        r._cb.disabled = !leaves.length || arc.needsPassword
      }
      const n = selected.size
      const size = [...selected].reduce((s, x) => s + x.entry.size, 0)
      clear(toolbar, card('Save', 'package-open', '#d99a1e', h('div', { class: 'stack' },
        h('div', { class: 'small muted' }, n ? `${n.toLocaleString()} file${n === 1 ? '' : 's'} selected (${formatBytes(size)}).` : 'Tick files or folders, or save everything.'),
        h('div', { class: 'row' },
          n === 1 ? button('Download this file', { icon: 'download', variant: 'primary', onClick: (e) => downloadOne([...selected][0], e.currentTarget) }) : null,
          button(n ? `Download ${n} file${n === 1 ? '' : 's'} as ZIP` : 'Download all as ZIP', { icon: 'file-archive', variant: n === 1 ? 'secondary' : 'primary', disabled: !files.length, onClick: (e) => saveZip(e.currentTarget) }),
          canPickDirectory() ? button(n ? 'Extract selection to a folder' : 'Extract all to a folder', { icon: 'folder-output', disabled: !files.length, onClick: (e) => toFolder(e.currentTarget) }) : null,
          button('Test archive', { icon: 'shield-check', variant: 'ghost', disabled: !files.length, onClick: (e) => testAll(e.currentTarget) }),
          n ? button('Clear selection', { variant: 'ghost', size: 'sm', onClick: () => { selected.clear(); syncChecks() } }) : null),
        !canPickDirectory() ? h('div', { class: 'small muted' }, 'Your browser cannot write to folders, so files come as downloads or one ZIP. Chrome and Edge can extract straight into a folder.') : null)))
    }

    function rowFor(node, depth, label = node.name) {
      const dir = node.dir
      const e = node.entry
      const lockd = !dir && !usable(node)
      const row = h('div', { class: ['ax-r', lockd && 'lock'] })
      row._node = node
      const cb = h('input', { type: 'checkbox', 'aria-label': `Select ${node.name}`, onchange: (ev) => {
        for (const l of leavesOf(node)) ev.target.checked ? selected.add(l) : selected.delete(l)
        syncChecks()
      } })
      row._cb = cb
      const hasKids = dir && node.children.size
      const tg = hasKids ? h('button', { class: 'tg', type: 'button', 'aria-expanded': 'false', 'aria-label': `Expand ${node.name}` }, icon('chevron-right')) : h('span', { class: 'sp' })
      const nested = !dir && usable(node) && looksLikeArchive(node.name)
      row.append(h('div', { class: 'nm', style: { paddingLeft: `${depth * 18}px` } }, hit(cb), tg, tile(node.name, { size: 'sm', kind: dir ? 'folder' : undefined }),
        h('span', { class: ['t', dir && 'dir'], title: node.path }, label, e?.encrypted ? ' (encrypted)' : '', e?.type === 'link' ? ' (link)' : '')),
      h('div', { class: 'n' }, dir ? `${node.files.toLocaleString()} file${node.files === 1 ? '' : 's'}` : lockd ? '' : formatBytes(e.size)),
      h('div', { class: 'n d' }, fmtDate(node.date)),
      h('div', { class: 'acts' }, dir || lockd ? null : [
        nested ? h('button', { type: 'button', 'aria-label': `Open ${node.name} as an archive`, title: 'Open as an archive', onclick: (ev) => openNested(node, ev.currentTarget) }, icon('package-open')) : null,
        h('button', { type: 'button', disabled: e.size > PREVIEW_MAX, 'aria-label': `Preview ${node.name}`, title: e.size > PREVIEW_MAX ? 'Too big to preview' : 'Preview', onclick: (ev) => previewOne(node, ev.currentTarget) }, icon('eye')),
        h('button', { type: 'button', 'aria-label': `Download ${node.name}`, title: 'Download', onclick: (ev) => downloadOne(node, ev.currentTarget) }, icon('download'))]))
      rows.add(row)
      const wrap = h('div', { class: 'ax-w' }, row)
      if (hasKids) {
        const kids = h('div')
        wrap.append(kids)
        const expand = () => {
          tg.setAttribute('aria-expanded', 'true')
          const list = sortedKids(node)
          for (const c of list.slice(0, PAGE)) kids.append(rowFor(c, depth + 1))
          if (list.length > PAGE) kids.append(h('div', { class: 'small muted', style: { padding: `6px 10px 6px ${40 + depth * 18}px` } }, `${(list.length - PAGE).toLocaleString()} more items. Use the search to find them.`))
          syncChecks()
        }
        const collapse = () => { tg.setAttribute('aria-expanded', 'false'); kids.replaceChildren(); syncChecks() }
        tg.addEventListener('click', () => (tg.getAttribute('aria-expanded') === 'true' ? collapse() : expand()))
        row._expand = expand
      }
      return wrap
    }

    function drawTree(opt = {}) {
      rows.clear()
      const q = filter.value.trim().toLowerCase()
      const box = h('div', { class: 'ax-tree' })
      const scroller = h('div', { class: 'ax-scroll' }, h('div', { class: 'ax-r head' }, h('span', 'Name'), h('span', { class: 'n' }, 'Size'), h('span', { class: 'n d' }, 'Modified'), h('span')), box)
      clear(treeHost, h('div', { class: 'ax-tree' }, scroller))
      box.className = ''
      if (q) {
        const hits = filesUnder(tree).filter((n) => n.path.toLowerCase().includes(q))
        if (!hits.length) box.append(h('div', { style: 'padding:14px' }, 'No file names match that search.'))
        for (const n of hits.slice(0, PAGE)) box.append(rowFor(n, 0, n.path))
        if (hits.length > PAGE) box.append(h('div', { class: 'small muted', style: 'padding:8px 12px' }, `Showing ${PAGE} of ${hits.length.toLocaleString()} matches. Type more to narrow it down.`))
      } else {
        const top = sortedKids(tree)
        const first = top.slice(0, PAGE).map((n) => rowFor(n, 0))
        box.append(...first)
        if (top.length > PAGE) box.append(h('div', { class: 'small muted', style: 'padding:8px 12px' }, `${(top.length - PAGE).toLocaleString()} more items. Use the search.`))
        const expandRows = () => [...rows].filter((r) => r._expand && r.querySelector('.tg')?.getAttribute('aria-expanded') === 'false')
        if (opt.all) { for (let i = 0; i < 12 && rows.size < 3000; i++) { const todo = expandRows(); if (!todo.length) break; todo.forEach((r) => r._expand()) } }
        else if (!opt.collapse && top.length === 1 && first[0].firstChild._expand) first[0].firstChild._expand()
      }
      syncChecks()
    }

    // ----- actions -----
    const leafNodes = () => filesUnder(tree).filter(usable)
    const target = () => (selected.size ? [...selected] : leafNodes())
    const guard = () => { if (arc.needsPassword) { toast('Unlock the archive first.', 'error'); return false } return true }

    async function track(btn, label, fn) {
      if (!guard()) return
      op = new AbortController()
      cancelBtn.hidden = false
      const mine = op
      await busy(btn, async () => { clear(resultEl); prog.set(null, `${label}...`); await fn(mine.signal) }, { label, errorTo: resultEl, progress: prog })
      cancelBtn.hidden = true
      if (mine.signal.aborted) clear(resultEl, alert('info', 'Cancelled.'))
    }
    const wrongPw = (e) => (e.code === 'BADPW' ? Object.assign(new Error('The password is wrong, so the files could not be unpacked.'), { code: 'BADPW' }) : e)

    async function previewOne(node, btn) {
      if (!guard()) return
      btn.disabled = true
      try { openPreview(new File([await arc.read(node.entry.path)], node.name), { name: node.path }) } catch (e) { toast(errorMessage(wrongPw(e)), 'error') } finally { btn.disabled = false }
    }
    async function downloadOne(node, btn) {
      if (!guard()) return
      btn.disabled = true
      try { download(new Blob([await arc.read(node.entry.path)]), node.name) } catch (e) { toast(errorMessage(wrongPw(e)), 'error') } finally { btn.disabled = false }
    }
    async function openNested(node, btn) {
      if (!guard()) return
      btn.disabled = true
      try { start(new File([await arc.read(node.entry.path)], node.name), { arc, file: f, parent: stack.find((s) => s.arc === arc)?.parent }) } catch (e) { toast(errorMessage(wrongPw(e)), 'error') } finally { btn.disabled = false }
    }

    async function saveZip(btn) {
      const list = target()
      if (!list.length) return
      await track(btn, 'Packing', async (sig) => {
        const sink = await createSink('zip', { level: 6, signal: sig })
        sink.setTotal(list.reduce((s, n) => s + n.entry.size, 0))
        if (!selected.size) for (const d of arc.entries.filter((x) => x.type === 'dir')) sink.dir(d.path)
        const byPath = new Map(list.map((n) => [n.entry.path, n]))
        let chain = Promise.resolve()
        await arc.extract(list.map((n) => n.entry.path), (e, data) => { chain = chain.then(() => sink.add(cleanPath(e.path), data, { date: e.date })); chain.catch(() => {}) }, { signal: sig, onProgress: (p, t) => prog.set(p * 0.9, `Unpacking ${t}`) }).catch((e) => { throw wrongPw(e) })
        await abortable(chain, sig)
        prog.set(0.95, 'Finishing ZIP')
        const blob = await abortable(sink.finish(), sig)
        download(blob, `${baseOf()}${selected.size ? '-selection' : ''}.zip`)
        clear(resultEl, alert('success', h('strong', 'Done. '), `A ZIP with ${byPath.size.toLocaleString()} file${byPath.size === 1 ? '' : 's'} (${formatBytes(blob.size)}) was downloaded.`))
        celebrate(btn, 18)
      })
    }

    async function toFolder(btn) {
      const list = target()
      if (!list.length) return
      let dir
      try { dir = await window.showDirectoryPicker({ id: 'tools-files', mode: 'readwrite' }) } catch (e) { if (e?.name === 'AbortError') return; return toast(errorMessage(e), 'error') }
      await track(btn, 'Extracting', async (sig) => {
        if (!(await ensurePermission(dir, 'readwrite'))) throw new Error('Permission to write to that folder was not granted.')
        const base = await dir.getDirectoryHandle(baseOf().replace(/[\\/:*?"<>|]+/g, '_') || 'extracted', { create: true })
        const dirAt = async (parts) => { let d = base; for (const p of parts) d = await d.getDirectoryHandle(p, { create: true }); return d }
        let n = 0
        let bytes = 0
        let renamed = 0
        let chain = Promise.resolve()
        const write = async (e, data) => {
          const parts = safeEntryPath(e.path).split('/').filter(Boolean)
          if (!parts.length) return
          const name = parts.pop()
          const d = await dirAt(parts)
          let finalName = name
          let k = 2
          for (;;) {
            try { await d.getFileHandle(finalName) } catch { break }
            const dot = name.lastIndexOf('.')
            finalName = dot > 0 ? `${name.slice(0, dot)} (${k++})${name.slice(dot)}` : `${name} (${k++})`
            renamed++
          }
          const w = await (await d.getFileHandle(finalName, { create: true })).createWritable()
          await w.write(data)
          await w.close()
          n++; bytes += data.length
        }
        await arc.extract(list.map((x) => x.entry.path), (e, data) => { chain = chain.then(() => write(e, data)); chain.catch(() => {}) }, { signal: sig, onProgress: (p, t) => prog.set(p, `Extracting ${t}`) }).catch((e) => { throw wrongPw(e) })
        await abortable(chain, sig)
        if (!selected.size) for (const e of arc.entries.filter((x) => x.type === 'dir')) { const parts = safeEntryPath(e.path).split('/').filter(Boolean); if (parts.length) await dirAt(parts) }
        prog.set(1, 'Done')
        clear(resultEl, alert('success', h('strong', 'Extracted. '), `${n.toLocaleString()} file${n === 1 ? '' : 's'} (${formatBytes(bytes)}) saved in the folder "${base.name}" inside the folder you picked.${renamed ? ` ${renamed} name clash${renamed === 1 ? ' was' : 'es were'} numbered so nothing was overwritten.` : ''}`))
        celebrate(btn, 18)
      })
    }

    async function testAll(btn) {
      await track(btn, 'Testing', async (sig) => {
        const r = await arc.test({ signal: sig, onProgress: (p, t) => prog.set(p, `Checking ${t}`) }).catch((e) => { throw wrongPw(e) })
        clear(resultEl, r.problems.length
          ? alert('error', h('strong', `${r.problems.length} problem${r.problems.length === 1 ? '' : 's'} found. `), 'The archive may be damaged.', h('ul', { style: 'margin:8px 0 0;padding-left:18px' }, r.problems.slice(0, 20).map((b) => h('li', `${b.path ? b.path + ': ' : ''}${b.error}`))))
          : alert('success', h('strong', 'All good. '), `${r.checked.toLocaleString()} file${r.checked === 1 ? '' : 's'} unpacked and checked.`))
      })
    }
    drawTree()
  }
}
