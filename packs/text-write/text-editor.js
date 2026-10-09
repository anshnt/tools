// Online notepad: many notes, autosave on this device, Markdown preview with clickable checklists, focus mode, downloads.
import { h, button, alert, clear, debounce, toast, icon, modal, empty, segmented, onCleanup, formatNumber, download } from '../../lib/ui.js'
import { marked as loadMarked, dompurify as loadPurify } from '../../lib/libs.js'
import { zip, safeName, pickFiles } from '../../lib/files.js'
import { toolRoot, addStyle, note, wordCount } from './_shared.js'
import { load, save } from '../../lib/store.js'

const KEY = 'notepad:v1'
const WELCOME = `# Welcome to your notepad

Everything you type is saved automatically **on this device**. Nothing is uploaded.

## Try these
- [x] Notes save as you type
- [ ] Click a checkbox in the preview to tick it
- [ ] Press the focus button for a distraction-free screen

Write in **Markdown** if you like: *italic*, \`code\`, [links](https://example.com), lists and tables.

| Shortcut | Does |
| --- | --- |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Esc | Leave focus mode |
`

/** First meaningful line of a note, cleaned of Markdown marks, used as its title. */
export function titleOf(text) {
  const line = text.split('\n').find((l) => l.trim()) || ''
  return line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|>\s+|\d+\.\s+)/, '').replace(/[*_`~]/g, '').trim().slice(0, 80) || 'Untitled note'
}
const snippetOf = (text) => text.split('\n').filter((l) => l.trim()).slice(1, 3).join(' ').replace(/[#*_`>\[\]-]/g, '').trim().slice(0, 90)
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
const ago = (ts) => {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  if (s < 86400 * 7) return rtf.format(-Math.round(s / 86400), 'day')
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: s > 86400 * 300 ? 'numeric' : undefined })
}

const CSS = `
.tw-pad { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 16px; align-items: start; }
.tw-pad .tw-side { position: sticky; top: 80px; display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 100px); }
.tw-pad .tw-nitems { display: flex; flex-direction: column; gap: 6px; overflow: auto; padding: 2px; min-height: 0; }
.tw-pad .tw-nitem { text-align: left; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; cursor: pointer; min-width: 0; transition: transform .25s var(--spring), border-color .2s, box-shadow .2s; animation: tw-rise .3s var(--ease) both; }
.tw-pad .tw-nitem:hover { transform: translateY(-1px); box-shadow: var(--shadow); }
.tw-pad .tw-nitem[aria-current="true"] { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 11%, var(--surface)), var(--surface) 70%); }
.tw-pad .tw-nitem b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
.tw-pad .tw-nitem b .icon { width: 12px; height: 12px; color: #eab308; fill: #eab308; flex: none; }
.tw-pad .tw-nitem span { font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tw-pad .tw-nitem small { font-size: 11.5px; color: var(--muted); }
.tw-pad .tw-editor { display: flex; flex-direction: column; gap: 0; border: 1px solid var(--border); border-radius: var(--radius-xl); background: var(--surface); overflow: hidden; min-width: 0; box-shadow: var(--shadow-sm); }
.tw-pad .tw-tb { display: flex; align-items: center; gap: 4px; padding: 8px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; background: color-mix(in srgb, var(--surface-2) 60%, var(--surface)); }
.tw-pad .tw-tb .sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
.tw-pad .tw-tb .grow { flex: 1; }
.tw-pad .tw-panes { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 420px; }
.tw-pad .tw-panes.split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.tw-pad textarea.tw-area { width: 100%; box-sizing: border-box; min-height: 420px; border: 0; outline: none; resize: none; background: transparent; color: var(--text); padding: 20px 24px; font-size: var(--fs, 16px); line-height: 1.75; font-family: var(--ff, var(--font)); }
.tw-pad .tw-prev { padding: 20px 24px; overflow: auto; max-height: 70vh; border-left: 1px solid var(--border); font-size: 15.5px; line-height: 1.7; }
.tw-pad .tw-panes:not(.split) .tw-prev { border-left: 0; max-height: none; }
.tw-pad .tw-prev h1 { font-size: 1.7em; } .tw-pad .tw-prev h2 { font-size: 1.35em; } .tw-pad .tw-prev h3 { font-size: 1.15em; }
.tw-pad .tw-prev blockquote { margin: 0 0 .8em; padding: 2px 14px; border-left: 3px solid var(--accent); color: var(--muted); }
.tw-pad .tw-prev code { font-family: var(--mono); font-size: .9em; background: var(--surface-2); padding: 1px 5px; border-radius: 5px; }
.tw-pad .tw-prev pre code { background: none; padding: 0; }
.tw-pad .tw-prev input[type="checkbox"] { width: 17px; height: 17px; margin-right: 8px; accent-color: var(--accent); cursor: pointer; vertical-align: -3px; }
.tw-pad .tw-prev li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.2em; }
.tw-pad .tw-prev img { max-width: 100%; }
.tw-pad .tw-foot { display: flex; align-items: center; gap: 14px; padding: 9px 16px; border-top: 1px solid var(--border); font-size: 12.5px; color: var(--muted); flex-wrap: wrap; font-variant-numeric: tabular-nums; }
.tw-pad .tw-foot .grow { flex: 1; }
.tw-pad .tw-saved { display: inline-flex; align-items: center; gap: 6px; }
.tw-pad .tw-saved .icon { width: 14px; height: 14px; color: var(--success); }
.tw-pad .tw-saved.warn .icon { color: var(--danger); }
.tw-pad .tw-saved.pop .icon { animation: tw-ticks .5s var(--spring); }
@keyframes tw-ticks { from { transform: scale(.3) rotate(-30deg); opacity: 0; } }
.tw-pad .tw-drawer { display: none; }
.tw-pad.focus { position: fixed; inset: 0; z-index: 250; display: block; background: var(--bg); overflow: auto; padding: 0; animation: tw-rise .3s var(--ease) both; }
.tw-pad.focus .tw-side, .tw-pad.focus .tw-tb .hide-f { display: none; }
.tw-pad.focus .tw-editor { max-width: 820px; margin: 0 auto; border: 0; border-radius: 0; background: transparent; box-shadow: none; min-height: 100vh; }
.tw-pad.focus .tw-tb { border: 0; background: transparent; justify-content: flex-end; padding: 14px 18px; opacity: .35; transition: opacity .3s; position: sticky; top: 0; z-index: 2; }
.tw-pad.focus .tw-tb:hover, .tw-pad.focus .tw-tb:focus-within { opacity: 1; }
.tw-pad.focus textarea.tw-area { font-size: 20px; line-height: 1.85; padding: 6vh 28px 30vh; min-height: 78vh; }
.tw-pad.focus .tw-prev { max-height: none; }
.tw-pad.focus .tw-foot { border: 0; position: sticky; bottom: 0; background: linear-gradient(transparent, var(--bg) 60%); padding: 18px; opacity: .6; }
@media (max-width: 900px) {
  .tw-pad { grid-template-columns: minmax(0, 1fr); }
  .tw-pad .tw-side { position: static; max-height: none; }
  .tw-pad .tw-drawer { display: flex; }
  .tw-pad .tw-side:not(.open) .tw-nitems { display: none; }
  .tw-pad .tw-nitems { max-height: 260px; }
  .tw-pad .tw-panes.split { grid-template-columns: minmax(0, 1fr); }
  .tw-pad .tw-prev { border-left: 0; border-top: 1px solid var(--border); }
  .tw-pad textarea.tw-area { padding: 16px; min-height: 340px; }
}
`

export function mount(root, { signal }) {
  addStyle('tw-pad-css', CSS)
  let db = load(KEY, null)
  if (!db || !Array.isArray(db.notes) || !db.notes.length) {
    const first = { id: uid(), text: WELCOME, created: Date.now(), updated: Date.now(), pinned: false }
    db = { notes: [first], current: first.id, prefs: { mode: 'write', font: 'sans', size: 16 } }
  }
  db.prefs = { mode: 'write', font: 'sans', size: 16, ...db.prefs }
  const st = { query: '', focus: false, dirty: false, saveFailed: false }
  const cur = () => db.notes.find((n) => n.id === db.current) || db.notes[0]

  const persist = () => { st.saveFailed = !save(KEY, db); paintSaved(false) }
  const persistLater = debounce(persist, 350)

  // ---------- elements
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search notes', 'aria-label': 'Search notes', oninput: (e) => { st.query = e.target.value.toLowerCase(); paintList() } })
  const list = h('div', { class: 'tw-nitems', role: 'list' })
  const newBtn = button('New note', { icon: 'plus', variant: 'primary', size: 'sm', onClick: () => addNote() })
  const side = h('aside', { class: 'tw-side', 'aria-label': 'Notes' },
    h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1; min-width:0' }, search), newBtn),
    h('div', { class: 'tw-drawer row', style: 'justify-content:space-between' }, button('All notes', { icon: 'chevrons-up-down', variant: 'ghost', size: 'sm', onClick: () => side.classList.toggle('open') })),
    list,
    h('div', { class: 'row' }, button('Import', { icon: 'file-up', variant: 'ghost', size: 'sm', onClick: importFiles }), button('Export all', { icon: 'folder-archive', variant: 'ghost', size: 'sm', onClick: exportAll })))
  const area = h('textarea', { class: 'tw-area', 'aria-label': 'Note text', placeholder: 'Start writing...', spellcheck: true, oninput: onType, onkeydown: onKey })
  const prev = h('div', { class: ['tw-prev', 'prose'], 'aria-label': 'Preview', hidden: true })
  const panes = h('div', { class: 'tw-panes' }, area, prev)
  const saved = h('span', { class: 'tw-saved' })
  const counts = h('span')
  const when = h('span', { class: 'grow' })
  const modeSeg = segmented([['write', 'Write'], ['split', 'Split'], ['preview', 'Preview']], db.prefs.mode, (v) => { db.prefs.mode = v; persist(); paintMode() }, 'View')
  const fontSeg = segmented([['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']], db.prefs.font, (v) => { db.prefs.font = v; persist(); paintFont() }, 'Font')
  const tb = (ic, label, fn, cls = 'hide-f') => { const b = button('', { icon: ic, variant: 'ghost', size: 'sm', ariaLabel: label, title: label, onClick: fn }); b.classList.add(cls); return b }
  const focusBtn = button('', { icon: 'maximize', variant: 'ghost', size: 'sm', ariaLabel: 'Focus mode', title: 'Focus mode (Esc to leave)', onClick: () => setFocus(!st.focus) })
  const toolbar = h('div', { class: 'tw-tb', role: 'toolbar', 'aria-label': 'Formatting and note actions' },
    tb('bold', 'Bold (Ctrl+B)', () => wrap('**')), tb('italic', 'Italic (Ctrl+I)', () => wrap('*')), tb('heading-2', 'Heading', () => linePrefix('## ')), tb('list', 'Bulleted list', () => linePrefix('- ')),
    tb('list-checks', 'Checklist', () => linePrefix('- [ ] ')), tb('quote', 'Quote', () => linePrefix('> ')), tb('code', 'Code', () => wrap('`')), tb('link', 'Link', () => link()),
    h('span', { class: 'sep hide-f' }), h('span', { class: 'hide-f' }, modeSeg), h('span', { class: 'grow' }),
    h('span', { class: 'hide-f' }, fontSeg), tb('a-arrow-down', 'Smaller text', () => size(-1)), tb('a-arrow-up', 'Larger text', () => size(1)),
    h('span', { class: 'sep hide-f' }), tb('pin', 'Pin note', () => togglePin()), tb('copy', 'Copy note', () => navigator.clipboard?.writeText(cur().text).then(() => toast('Copied', 'success'), () => toast('Copy failed', 'error'))),
    tb('download', 'Download note', () => downloadNote()), tb('trash-2', 'Delete note', () => removeNote()), focusBtn)
  const footer = h('div', { class: 'tw-foot' }, saved, counts, when)
  const editor = h('section', { class: 'tw-editor' }, toolbar, panes, footer)
  const wrapEl = h('div', { class: 'tw-pad' }, side, editor)

  // ---------- painting
  function paintList() {
    const items = [...db.notes].filter((n) => !st.query || n.text.toLowerCase().includes(st.query)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated)
    clear(list, items.length ? items.map((n) => h('button', { type: 'button', class: 'tw-nitem', role: 'listitem', 'aria-current': String(n.id === db.current), onclick: () => select(n.id) },
      h('b', n.pinned ? icon('pin') : null, titleOf(n.text)), h('span', snippetOf(n.text) || 'No additional text'), h('small', ago(n.updated)))) : [empty(st.query ? 'No notes match your search.' : 'No notes yet.', 'notebook-pen')])
    side.querySelector('.tw-drawer button span').textContent = `All notes (${db.notes.length})`
  }
  function paintSaved(pop) {
    saved.className = ['tw-saved', st.saveFailed && 'warn', pop && 'pop'].filter(Boolean).join(' ')
    clear(saved, icon(st.saveFailed ? 'triangle-alert' : 'check'), st.saveFailed ? 'Could not save here. Download your notes to keep them.' : 'Saved on this device')
  }
  function paintCounts() {
    const t = area.value
    const w = wordCount(t)
    counts.textContent = `${formatNumber(w, 0)} word${w === 1 ? '' : 's'} · ${formatNumber(t.length, 0)} characters · ${w < 238 ? Math.max(w ? 1 : 0, Math.round(w / 238 * 60)) + ' sec' : Math.round(w / 238) + ' min'} read`
    when.textContent = `Edited ${ago(cur().updated)}`
  }
  function paintFont() {
    area.style.setProperty('--ff', { sans: 'var(--font)', serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif', mono: 'var(--mono)' }[db.prefs.font])
    area.style.setProperty('--fs', `${db.prefs.size}px`)
  }
  function paintMode() {
    const m = st.focus ? 'write' : db.prefs.mode // focus mode is writing only
    modeSeg.set(db.prefs.mode)
    panes.classList.toggle('split', m === 'split')
    area.hidden = m === 'preview'
    prev.hidden = m === 'write'
    if (m !== 'write') renderPreview()
  }
  let rv = 0
  async function renderPreview() {
    const my = ++rv
    const [{ marked }, purify] = await Promise.all([loadMarked(), loadPurify()])
    if (my !== rv) return
    const html = purify.sanitize(marked.parse(area.value || '*Nothing to preview yet.*'), { ADD_ATTR: ['target'] })
    prev.innerHTML = html
    prev.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer' })
    prev.querySelectorAll('input[type="checkbox"]').forEach((cb, i) => {
      cb.disabled = false
      cb.addEventListener('change', () => {
        let k = -1
        area.value = area.value.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/gm, (m0, pre) => (++k === i ? `${pre}[${cb.checked ? 'x' : ' '}]` : m0))
        onType()
      })
    })
  }
  const renderLater = debounce(() => { if (db.prefs.mode !== 'write') renderPreview() }, 160)

  // ---------- note actions
  function select(id) {
    flush()
    db.current = id
    area.value = cur().text
    persist()
    paintList(); paintCounts(); paintMode()
    side.classList.remove('open')
    if (!st.focus && matchMedia('(min-width: 900px)').matches) area.focus({ preventScroll: true })
  }
  function addNote(text = '') {
    flush()
    const n = { id: uid(), text, created: Date.now(), updated: Date.now(), pinned: false }
    db.notes.unshift(n)
    db.current = n.id
    area.value = text
    persist(); paintList(); paintCounts(); paintMode()
    side.classList.remove('open')
    area.focus()
    return n
  }
  function flush() { if (st.dirty) { cur().text = area.value; cur().updated = Date.now(); st.dirty = false; persist() } }
  function onType() {
    const n = cur()
    n.text = area.value
    n.updated = Date.now()
    st.dirty = false
    clear(saved, h('span', 'Saving...'))
    persistLater()
    paintCounts()
    renderLater()
    paintListLater()
    savedPopLater()
  }
  const paintListLater = debounce(paintList, 400)
  const savedPopLater = debounce(() => paintSaved(true), 380)
  function togglePin() { const n = cur(); n.pinned = !n.pinned; persist(); paintList(); toast(n.pinned ? 'Pinned to the top' : 'Unpinned', 'info', 1500) }
  function removeNote() {
    const n = cur()
    const m = modal({ title: 'Delete this note?', icon: 'trash-2', body: [h('p', { style: 'margin:0' }, `"${titleOf(n.text)}" will be removed from this device. Download it first if you may need it again.`)],
      actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Download first', { icon: 'download', onClick: () => downloadNote() }),
        button('Delete', { icon: 'trash-2', variant: 'danger', onClick: () => {
          db.notes = db.notes.filter((x) => x.id !== n.id)
          if (!db.notes.length) db.notes.push({ id: uid(), text: '', created: Date.now(), updated: Date.now(), pinned: false })
          db.current = db.notes[0].id
          area.value = cur().text
          persist(); paintList(); paintCounts(); paintMode(); m.close(); toast('Note deleted', 'info')
        } })] })
  }
  function downloadNote() {
    const n = cur()
    const md = /(^|\n)\s*(#{1,6}\s|[-*]\s|>\s|\|)/.test(n.text)
    download(new Blob([n.text], { type: 'text/plain;charset=utf-8' }), `${safeName(titleOf(n.text)).slice(0, 60)}.${md ? 'md' : 'txt'}`)
  }
  async function exportAll() {
    flush()
    const used = new Set()
    const files = db.notes.map((n) => { let name = safeName(titleOf(n.text)).slice(0, 60) || 'note'; while (used.has(name)) name += '-2'; used.add(name); return { name: `${name}.md`, data: n.text } })
    download(await zip(files), 'notes.zip')
    toast(`Exported ${files.length} note${files.length === 1 ? '' : 's'}`, 'success')
  }
  async function importFiles() {
    const files = await pickFiles({ accept: '.txt,.md,.markdown,text/plain', multiple: true })
    if (!files.length) return
    let n = 0
    for (const f of files) { if (f.size > 2_000_000) { toast(`${f.name} is too large (max 2 MB)`, 'error'); continue } addNote(await f.text()); n++ }
    if (n) toast(`Imported ${n} note${n === 1 ? '' : 's'}`, 'success')
  }

  // ---------- editing helpers
  function replaceRange(a, b, text) {
    area.focus()
    const expected = area.value.slice(0, a) + text + area.value.slice(b)
    area.setSelectionRange(a, b)
    let ok = false
    try { ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete') } catch { /* fall back */ }
    if (!ok || area.value !== expected) { area.value = expected; area.setSelectionRange(a + text.length, a + text.length) } // keeps undo when the command works, still correct when it does not
  }
  function wrap(mark) {
    area.focus()
    const a = area.selectionStart, b = area.selectionEnd, sel = area.value.slice(a, b)
    const wrapped = sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2
    if (wrapped) { replaceRange(a, b, sel.slice(mark.length, sel.length - mark.length)); area.setSelectionRange(a, b - mark.length * 2) } else {
      replaceRange(a, b, `${mark}${sel || 'text'}${mark}`)
      area.setSelectionRange(a + mark.length, a + mark.length + (sel || 'text').length)
    }
    onType()
  }
  function linePrefix(prefix) {
    area.focus()
    const v = area.value
    const a = v.lastIndexOf('\n', area.selectionStart - 1) + 1
    let b = v.indexOf('\n', area.selectionEnd)
    if (b < 0) b = v.length
    const lines = v.slice(a, b).split('\n')
    const has = lines.every((l) => l.startsWith(prefix))
    replaceRange(a, b, lines.map((l) => (has ? l.slice(prefix.length) : prefix + l)).join('\n'))
    onType()
  }
  function link() {
    area.focus()
    const a = area.selectionStart, b = area.selectionEnd, sel = area.value.slice(a, b) || 'link text'
    replaceRange(a, b, `[${sel}](https://)`)
    area.setSelectionRange(a + sel.length + 3, a + sel.length + 11)
    onType()
  }
  function size(d) { db.prefs.size = Math.max(12, Math.min(30, db.prefs.size + d * 2)); persist(); paintFont() }
  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); wrap('**') }
    else if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); wrap('*') }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); toast('Notes save automatically as you type', 'info', 1800) }
    else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); replaceRange(area.selectionStart, area.selectionEnd, '  '); onType() }
    else if (e.key === 'Enter' && !e.shiftKey && !mod) {
      // continue a list: "- item" or "1. item" or "- [ ] task"
      const v = area.value, a = area.selectionStart
      const ls = v.lastIndexOf('\n', a - 1) + 1
      const m = /^(\s*)([-*+]|\d+\.)\s(\[[ xX]\]\s)?/.exec(v.slice(ls, a))
      if (m && a === area.selectionEnd) {
        e.preventDefault()
        const body = v.slice(ls + m[0].length, a)
        if (!body.trim()) { replaceRange(ls, a, ''); onType(); return }
        const next = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}.` : m[2]
        replaceRange(a, a, `\n${m[1]}${next} ${m[3] ? '[ ] ' : ''}`)
        onType()
      }
    }
  }

  // ---------- focus mode
  async function setFocus(on) {
    st.focus = on
    wrapEl.classList.toggle('focus', on)
    paintMode()
    clear(focusBtn, icon(on ? 'minimize' : 'maximize'))
    document.documentElement.style.overflow = on ? 'hidden' : ''
    if (on) { try { await wrapEl.requestFullscreen?.() } catch { /* the overlay alone is fine */ } area.focus() } else if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* ignore */ } }
  }
  const onFs = () => { if (!document.fullscreenElement && st.focus) setFocus(false) }
  const onEsc = (e) => { if (e.key === 'Escape' && st.focus) setFocus(false) }
  document.addEventListener('fullscreenchange', onFs)
  document.addEventListener('keydown', onEsc)
  const onStorage = (e) => {
    if (e.key !== `tools:${KEY}` || !e.newValue) return
    try {
      const incoming = JSON.parse(e.newValue)
      if (!incoming?.notes) return
      const typing = document.activeElement === area
      db = { ...incoming, current: typing ? db.current : incoming.current }
      paintList()
      if (!typing) { area.value = cur().text; paintCounts(); if (db.prefs.mode !== 'write') renderPreview() }
    } catch { /* ignore a malformed value */ }
  }
  window.addEventListener('storage', onStorage)
  const onHide = () => { flush(); persist() }
  window.addEventListener('pagehide', onHide)
  const tick = setInterval(() => { paintList(); paintCounts() }, 60000)
  onCleanup(() => {
    flush()
    document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('keydown', onEsc)
    window.removeEventListener('storage', onStorage); window.removeEventListener('pagehide', onHide); clearInterval(tick)
    document.documentElement.style.overflow = ''
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
  })
  signal?.addEventListener('abort', onHide)

  area.value = cur().text
  paintFont(); paintList(); paintCounts(); paintMode(); paintSaved(false)
  root.append(toolRoot('npad', wrapEl, note('Notes are stored in this browser only (localStorage). Clearing site data or using another browser or device will not show them, so use Export all for backups.', 'hard-drive'),
    st.saveFailed ? alert('warn', 'Storage looks unavailable, so notes will not survive a refresh.') : null))
}
