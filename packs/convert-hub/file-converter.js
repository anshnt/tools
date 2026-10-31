// File Converter: drop any mix of files, pick a format for each kind, and convert them all on this device.
// params.view picks the tab to open: 'convert' (default), 'batch', 'history' or 'watch'.
import { h, icon, button, busy, field, select, input, number, toggle, rangeField, segmented, tabs, alert, toast, formatBytes, download, dropzone, fileList, clear, fileType } from '../../lib/ui.js'
import { zip, ext as extOf, pickFolder } from '../../lib/files.js'
import { loadAll, routesFrom, optionsOf, routeNotes, combineRoutes, isKnown, extraSniffers, findRoute, onChange as onRegistryChange } from './_registry.js'
import { detect } from './_detect.js'
import { label, shortLabel, HINT, KINDS, KIND_ICON, POPULAR, CROPPABLE, outExt, kindOfExt, rankFor } from './_formats.js'
import { createQueue, convertJob, combineJob, resolveOptions, outputName, renamed } from './_engine.js'
import { listPresets, getPreset, savePreset, deletePreset, setDefaultPreset, defaultValues, loadSettings, saveSettings } from './_presets.js'
import { formatPicker } from './_picker.js'
import { cropSession, cropFile } from './_crop.js'
import * as history from './_history.js'
import { watchPanel, supportsWatch } from './_watch.js'

const CSS = `
.fc { display: grid; gap: 16px; max-width: 1040px; margin: 0 auto; }
.fc h2 { margin: 0; display: flex; align-items: center; justify-content: flex-start; gap: 8px; font-size: 17px; }
.fc .fc-intake { display: grid; gap: 10px; }
.fc .fc-intake-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.fc .fc-link { display: grid; gap: 8px; padding: 12px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); }
.fc .fc-link .row { flex-wrap: nowrap; } .fc .fc-link .input { flex: 1; min-width: 0; }
.fc .fc-quick { display: grid; gap: 8px; }
.fc .fc-quick .fc-face { display: flex; flex-wrap: wrap; gap: 8px; }
.fc-group { display: grid; gap: 14px; }
.fc-group-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.fc-group-head .tile { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); flex: none; }
.fc-group-head .grow { flex: 1; min-width: 160px; } .fc-group-head strong { display: block; font-size: 15px; } .fc-group-head span { font-size: 12.5px; color: var(--muted); }
.fc-files { display: flex; flex-wrap: wrap; gap: 6px; }
.fc-file { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 2px 4px 2px 10px; border-radius: 99px; background: var(--surface-2); border: 1px solid var(--border); font-size: 12.5px; }
.fc-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; } .fc-file em { font-style: normal; color: var(--muted); }
.fc-file .btn { min-height: 28px; min-width: 28px; padding: 0 4px; }
.fc-settings { display: grid; gap: 12px; padding: 12px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); }
.fc-settings > summary, .fc-settings h3 { font-weight: 600; font-size: 14px; margin: 0; }
.fc-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 12px; }
.fc-presets { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.fc-presets .field { min-width: 180px; flex: 1; }
.fc-preset-save { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.fc-via { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); font-size: 12.5px; font-weight: 600; }
.fc-notes { font-size: 12.5px; color: var(--muted); }
.fc-run { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
.fc-run .field { flex: 1; min-width: 200px; }
.fc-queue { display: grid; gap: 10px; }
.fc-queue-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.fc-jobs { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.fc-job { display: grid; gap: 8px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); }
.fc-job-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fc-job-main .name { flex: 1; min-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.fc-job-main .state { font-size: 12.5px; color: var(--muted); }
.fc-job.error .state { color: var(--danger); } .fc-job.done .state { color: var(--success); }
.fc-bar { height: 6px; border-radius: 99px; background: var(--surface-3); overflow: hidden; } .fc-bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width .25s; }
.fc-outs { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.fc-out { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
.fc-out .name { flex: 1; min-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .fc-out .size { color: var(--muted); font-size: 12.5px; }
.fc-err { font-size: 13px; color: var(--danger); overflow-wrap: anywhere; }
.fc-hist { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
.fc-card { display: grid; grid-template-columns: 72px 1fr; gap: 12px; padding: 12px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); }
.fc-card .thumb { width: 72px; height: 72px; border-radius: 10px; object-fit: cover; background: var(--surface-2); display: grid; place-items: center; font: 700 13px var(--mono); color: var(--muted); overflow: hidden; }
.fc-card .meta { min-width: 0; display: grid; gap: 2px; align-content: start; } .fc-card .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-card .sub { font-size: 12.5px; color: var(--muted); } .fc-card .acts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.fc-merge .file-list { margin: 0; }
@media (max-width: 480px) { .fc-file span { max-width: 140px; } .fc-card { grid-template-columns: 56px 1fr; } .fc-card .thumb { width: 56px; height: 56px; } }
`
let cssDone = false

const ORDER = Object.keys(KINDS)
const OPEN_OK = (f) => { const t = fileType(f); return t === 'application/pdf' || (t.startsWith('image/') && !t.includes('svg')) || t.startsWith('video/') || t.startsWith('audio/') || t === 'text/plain' }
const openInTab = (f) => { const u = URL.createObjectURL(f); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 120_000) }
const rank = (t) => { const i = POPULAR.indexOf(t); return i < 0 ? 999 : i }

/** Read a dropped folder tree (webkitGetAsEntry) into [{file, path}], path being the folder the file sits in. */
async function readEntry(entry, prefix = '') {
  if (entry.isFile) return new Promise((res) => entry.file((file) => res([{ file, path: prefix.replace(/\/$/, '') }]), () => res([])))
  const out = []
  const reader = entry.createReader()
  for (;;) {
    const batch = await new Promise((res) => reader.readEntries(res, () => res([])))
    if (!batch.length) break
    for (const e of batch) out.push(...(await readEntry(e, `${prefix}${entry.name}/`)))
  }
  return out
}

export async function mount(root, { params, signal }) {
  if (!cssDone) { cssDone = true; document.head.append(h('style', CSS)) }
  root.append(h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), 'Getting the converters ready...'))
  await loadAll()
  if (signal?.aborted) return
  clear(root)

  const settings = loadSettings()
  const items = []            // {id, file, dir, ext, kind, det}
  const groups = new Map()    // ext -> group state
  const order = new Map()     // combine route index -> [File] in the order the person arranged
  const combineOpts = new Map()
  let nextId = 0, tabsEl = null

  // ---------- engine ----------
  const queue = createQueue({
    onUpdate: (job) => updateJob(job),
    onDone: (job) => {
      const outs = finalOutputs(job)
      for (const f of outs) history.addResult(f, { from: job.label, to: job.meta.target || '' }).then(() => historyView?.refresh())
    },
  })
  const jobEls = new Map()
  const finalOutputs = (job) => {
    if (job.final) return job.final
    job.final = job.meta.keepName ? job.outputs : job.outputs.map((o) => renamed(o, outputName(settings.pattern, job.source, o, job.n)))
    return job.final
  }

  // ---------- intake ----------
  const status = h('div', { class: 'muted small', 'aria-live': 'polite' })
  async function addFiles(list) {
    const entries = list.map((x) => (x instanceof File ? { file: x, path: x.webkitRelativePath ? x.webkitRelativePath.split('/').slice(0, -1).join('/') : '' } : x))
    let added = 0
    for (let i = 0; i < entries.length; i++) {
      const { file, path } = entries[i]
      if (signal?.aborted) return
      if (items.some((it) => it.file.name === file.name && it.file.size === file.size && it.file.lastModified === file.lastModified && it.dir === path)) continue
      status.textContent = entries.length > 20 ? `Reading files ${i + 1} of ${entries.length}` : ''
      const det = await detect(file, { extra: extraSniffers(), known: isKnown })
      items.push({ id: ++nextId, file, dir: path || '', ext: det.ext, kind: det.kind, det })
      added++
    }
    status.textContent = ''
    if (added) renderAll()
    else if (entries.length) toast('Those files are already in the list.')
  }
  const removeItem = (it) => { items.splice(items.indexOf(it), 1); renderAll() }

  const zone = dropzone({ multiple: true, label: 'Drop files or folders here, or click to choose', hint: 'Any mix of pictures, PDFs, documents, spreadsheets, video, audio and more. Paste works too.', onFiles: addFiles })
  zone.addEventListener('drop', (e) => {
    const entries = [...(e.dataTransfer?.items || [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean)
    if (!entries.some((en) => en.isDirectory)) return
    e.preventDefault(); e.stopPropagation(); zone.classList.remove('drag')
    Promise.all(entries.map((en) => readEntry(en, ''))).then((r) => addFiles(r.flat()))
  }, true)
  const linkBox = h('div', { class: 'fc-link', hidden: true })
  const linkInput = input({ type: 'url', placeholder: 'https://example.com/file.pdf', 'aria-label': 'Web address of a file' })
  const linkBtn = button('Fetch', { icon: 'download', variant: 'primary' })
  linkBtn.addEventListener('click', () => busy(linkBtn, async () => { await addFiles([await fetchLink(linkInput.value.trim())]); linkInput.value = '' }, { label: 'Fetching', errorTo: linkMsg }))
  const linkMsg = h('div')
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') linkBtn.click() })
  linkBox.append(h('div', { class: 'row' }, linkInput, linkBtn), h('small', { class: 'muted' }, 'The file is downloaded straight to this page and converted here. Some websites do not allow other sites to download their files, and then it will not work. In that case, save the file to your device and drop it above.'), linkMsg)
  async function fetchLink(url) {
    let u
    try { u = new URL(url) } catch { throw new Error('That does not look like a web address. It should start with https://') }
    let res
    try { res = await fetch(u, { signal }) } catch (e) {
      if (e?.name === 'AbortError') throw e
      throw new Error('This website did not let the page download the file (many sites block downloads from other sites). Save the file to your device and drop it here instead.')
    }
    if (!res.ok) throw new Error(`The website answered "${res.status} ${res.statusText}". Check the address and try again.`)
    const blob = await res.blob()
    const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')?.[1]
    let name = decodeURIComponent(cd || u.pathname.split('/').pop() || '') || 'download'
    if (!extOf(name)) { const t = (blob.type || '').split(';')[0]; const e = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'text/plain': 'txt', 'text/html': 'html', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3' }[t]; if (e) name += `.${e}` }
    return new File([blob], name, { type: blob.type })
  }
  const intake = h('section', { class: 'panel fc-intake' }, zone,
    h('div', { class: 'fc-intake-row' },
      button('Choose a folder', { icon: 'folder-open', size: 'sm', onClick: async () => { const f = await pickFolder(); if (f.length) addFiles(f) } }),
      button('From a link', { icon: 'link', size: 'sm', onClick: () => { linkBox.hidden = !linkBox.hidden; if (!linkBox.hidden) linkInput.focus() } }),
      h('span', { class: 'muted small' }, 'Everything is converted on this device. Nothing is uploaded.')),
    linkBox, status)

  // ---------- groups ----------
  const groupsHost = h('div', { class: 'stack' })
  const quickHost = h('div')
  const combineHost = h('div', { class: 'stack' })
  const runHost = h('div')

  function targetChips(ext) {
    const canonExt = ext
    const routes = routesFrom(ext)
    const all = [...routes].map(([t, r]) => ({ id: t, hops: r.hops, via: r.path.slice(0, -1).map((s) => label(s.to)), group: r.path.at(-1).conv.group || 'More'}))
    const byKind = rankFor(kindOfExt(ext))
    const pri = (x) => (x.id === canonExt ? 1500 : byKind(x.id))
    all.sort((a, b) => a.hops - b.hops || pri(a) - pri(b))
    const direct = all.filter((x) => x.hops === 1)
    const front = direct.slice(0, 8)
    const chip = (x) => (x.id === canonExt ? { id: x.id, label: `${label(x.id)} (same format)`, hint: 'Resize or recompress only' } : { id: x.id, label: label(x.id), hint: x.hops > 1 ? `via ${x.via.join(' then ')}` : HINT[x.id] || '' })
    const rest = all.filter((x) => !front.includes(x))
    const groupsBack = new Map()
    for (const x of rest) { const k = x.hops > 1 ? 'Through another format' : x.group; if (!groupsBack.has(k)) groupsBack.set(k, []); groupsBack.get(k).push(chip(x)) }
    return { front: front.map(chip), back: [...groupsBack].map(([title, list]) => ({ title, items: list })), total: all.length }
  }

  function groupFor(ext) {
    if (!groups.has(ext)) groups.set(ext, { ext, kind: kindOfExt(ext), target: null, opts: {}, preset: '', crop: false, expanded: false, path: null })
    return groups.get(ext)
  }

  function setTarget(g, t) {
    g.target = t
    g.path = t ? routesFrom(g.ext).get(t)?.path || null : null
    const { default: def } = listPresets(g.kind)
    g.preset = def || ''
    g.opts = g.path ? resolveOptions(g.path, defaultValues(g.kind)) : {}
    if (g.crop && !cropOk(g)) g.crop = false
    renderSettings(g)
    renderRun()
  }
  const cropOk = (g) => g.kind === 'image' && CROPPABLE.has(g.ext) && g.target && (g.target === 'png' || findRoute('png', g.target))

  function renderSettings(g) {
    const host = g.settingsHost
    if (!host) return
    clear(host)
    if (!g.target || !g.path) { host.hidden = true; return }
    host.hidden = false
    const defs = optionsOf(g.path)
    const notes = routeNotes(g.path)
    const via = g.path.length > 1 ? h('span', { class: 'fc-via' }, icon('route'), `via ${g.path.slice(0, -1).map((s) => label(s.to)).join(' then ')}`) : null

    // presets
    const p = listPresets(g.kind)
    const presetSel = select([['', 'Default settings'], ...p.names.map((n) => [n, n === p.default ? `${n} (default)` : n])], g.preset, (v) => {
      g.preset = v
      g.opts = resolveOptions(g.path, v ? getPreset(g.kind, v) : {})
      renderSettings(g)
    })
    const saveForm = h('div', { class: 'fc-preset-save', hidden: true })
    const nameIn = input({ placeholder: 'Preset name', 'aria-label': 'Preset name', maxlength: 40 })
    const defTog = toggle(`Use it by default for ${KINDS[g.kind].toLowerCase()}`, false)
    const doSave = () => {
      try {
        const name = savePreset(g.kind, nameIn.value, g.opts, defTog.input.checked)
        g.preset = name
        toast(`Saved preset "${name}"`, 'success')
        renderSettings(g)
      } catch (e) { toast(e.message, 'error') }
    }
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave() } })
    saveForm.append(nameIn, defTog, button('Save', { variant: 'primary', size: 'sm', onClick: doSave }), button('Cancel', { variant: 'ghost', size: 'sm', onClick: () => { saveForm.hidden = true } }))
    const presetRow = h('div', { class: 'fc-presets' },
      field(`Presets for ${KINDS[g.kind].toLowerCase()}`, presetSel),
      button('Save settings as a preset', { icon: 'save', size: 'sm', onClick: () => { saveForm.hidden = false; nameIn.focus() } }),
      g.preset && g.preset !== p.default ? button('Make default', { size: 'sm', onClick: () => { setDefaultPreset(g.kind, g.preset); renderSettings(g) } }) : null,
      g.preset && g.preset === p.default ? button('Remove as default', { size: 'sm', onClick: () => { setDefaultPreset(g.kind, null); renderSettings(g) } }) : null,
      g.preset ? button('Delete preset', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { deletePreset(g.kind, g.preset); g.preset = ''; renderSettings(g) } }) : null)

    // route options
    const controls = defs.map((o) => optionControl(g, o))
    const cropTog = cropOk(g) ? toggle('Crop each picture before converting', g.crop, (v) => { g.crop = v }) : null
    clear(host, h('div', { class: 'row' }, h('h3', `Settings for ${label(g.ext)} to ${label(outExt(g.target))}`), via),
      notes.length ? h('div', { class: 'fc-notes' }, notes.join(' ')) : null,
      presetRow, saveForm,
      controls.length ? h('div', { class: 'fc-opts' }, controls) : h('div', { class: 'fc-notes' }, 'No extra settings for this conversion.'),
      cropTog)
  }

  function optionControl(g, o) {
    const val = g.opts[o.key] ?? o.default
    const set = (v) => { g.opts[o.key] = v }
    if (o.type === 'range') return rangeField(o.label, { min: o.min ?? 0, max: o.max ?? 100, step: o.step ?? 1, value: val, onInput: set, format: (v) => (o.key === 'quality' ? `${v}%` : v) })
    if (o.type === 'number') return field(o.label, number(val, { min: o.min, max: o.max, step: 1, ariaLabel: o.label, onInput: (n) => set(Number.isNaN(n) ? o.default : n) }))
    if (o.type === 'select') return field(o.label, select(o.choices, val, (v) => { const hit = o.choices.find(([c]) => String(c) === v); set(hit ? hit[0] : v) }))
    if (o.type === 'toggle') return toggle(o.label, !!val, set)
    return field(o.label, input({ value: val ?? '', 'aria-label': o.label, oninput: (e) => set(e.target.value) }))
  }

  function groupCard(g, list) {
    const total = list.reduce((a, i) => a + i.file.size, 0)
    const known = isKnown(g.ext)
    const head = h('div', { class: 'fc-group-head' },
      h('div', { class: 'tile' }, icon(KIND_ICON[g.kind] || 'file')),
      h('div', { class: 'grow' }, h('strong', `${list.length} ${g.ext ? shortLabel(g.ext) : 'unknown'} ${list.length === 1 ? 'file' : 'files'}`), h('span', `${KINDS[g.kind]} · ${formatBytes(total)}`)),
      button('Remove all', { variant: 'ghost', size: 'sm', icon: 'trash-2', onClick: () => { for (const it of [...list]) items.splice(items.indexOf(it), 1); renderAll() } }))
    const shown = g.expanded ? list : list.slice(0, 6)
    const files = h('div', { class: 'fc-files' }, shown.map((it) => h('span', { class: 'fc-file', title: `${it.dir ? it.dir + '/' : ''}${it.file.name}${it.det.corrected ? ` (named .${it.det.nameExt}, but it is really ${label(it.ext)})` : ''}` },
      h('span', (it.dir ? `${it.dir}/` : '') + it.file.name), h('em', formatBytes(it.file.size)),
      button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${it.file.name}`, onClick: () => removeItem(it) }))),
    list.length > 6 ? button(g.expanded ? 'Show fewer' : `Show all ${list.length}`, { variant: 'ghost', size: 'sm', onClick: () => { g.expanded = !g.expanded; renderAll() } }) : null)
    if (!known || !routesFrom(g.ext).size) {
      return h('section', { class: 'panel fc-group' }, head, files, alert('info', g.ext ? `There is no converter for ${shortLabel(g.ext)} files here yet.` : 'This file has no extension and its contents are not recognised, so it cannot be converted.'))
    }
    const t = targetChips(g.ext)
    g.picker = formatPicker({ front: t.front, back: t.back, value: g.target, ariaLabel: `Convert ${shortLabel(g.ext)} to`, onPick: (id) => setTarget(g, id) })
    g.settingsHost = h('div', { class: 'fc-settings', hidden: true })
    const card = h('section', { class: 'panel fc-group' }, head, files, h('div', { class: 'stack tight' }, h('strong', { style: 'font-size:13.5px' }, 'Convert to'), g.picker), g.settingsHost)
    renderSettings(g)
    if (!t.front.length) g.picker.flip(true)
    return card
  }

  function renderQuick(convertible) {
    clear(quickHost)
    if (convertible.length < 2) return
    let common = null
    for (const g of convertible) { const ks = new Set(routesFrom(g.ext).keys()); common = common ? new Set([...common].filter((k) => ks.has(k))) : ks }
    const list = [...(common || [])].sort((a, b) => rank(a) - rank(b)).slice(0, 10)
    if (!list.length) return
    const sel = new Set(convertible.map((g) => g.target))
    quickHost.append(h('section', { class: 'panel fc-quick' }, h('strong', 'Convert all to'),
      h('div', { class: 'fc-face', role: 'group', 'aria-label': 'Convert all to' }, list.map((t) => h('button', { type: 'button', class: 'fc-chip', 'aria-pressed': String(sel.size === 1 && sel.has(t)), onclick: () => { for (const g of convertible) { setTarget(g, t); g.picker?.set(t) } renderQuick(convertible) } }, h('b', label(t)), HINT[t] ? h('small', HINT[t]) : null)))))
  }

  function renderAll() {
    // groups by detected type, in the order they first appeared
    const byExt = new Map()
    for (const it of items) { const k = it.ext || ''; if (!byExt.has(k)) byExt.set(k, []); byExt.get(k).push(it) }
    for (const k of [...groups.keys()]) if (!byExt.has(k)) groups.delete(k)
    clear(groupsHost)
    const convertible = []
    for (const [ext, list] of byExt) {
      const g = groupFor(ext)
      g.items = list
      groupsHost.append(groupCard(g, list))
      if (isKnown(ext) && routesFrom(ext).size) convertible.push(g)
    }
    renderQuick(convertible)
    renderCombine()
    renderRun()
  }

  // ---------- merge in the order you choose ----------
  function renderCombine() {
    clear(combineHost)
    const convs = combineRoutes()
    convs.forEach((conv, ci) => {
      const match = items.filter((i) => conv.from.includes(i.ext))
      if (match.length < 2) return
      const prev = (order.get(ci) || []).filter((f) => match.some((i) => i.file === f))
      const files = [...prev, ...match.map((i) => i.file).filter((f) => !prev.includes(f))]
      order.set(ci, files)
      const target = conv.to[0]
      const opts = combineOpts.get(ci) || combineOpts.set(ci, {}).get(ci)
      const list = fileList({ files, onChange: (fs) => order.set(ci, [...fs]) })
      const defs = conv.options || []
      const vals = resolveOptions([{ conv }], opts)
      Object.assign(opts, vals)
      const btn = button(`Merge ${files.length} files into one ${shortLabel(outExt(target))}`, { icon: 'combine', variant: 'primary' })
      btn.addEventListener('click', () => {
        const fs = [...order.get(ci)]
        const job = combineJob({ conv, files: fs, target, values: opts, label: `${fs.length} files merged` })
        job.meta.keepName = true
        queue.add([job])
        renderQueueHead()
      })
      combineHost.append(h('section', { class: 'panel stack fc-merge' }, h('h2', icon('combine'), `${label(target)}: arrange the order`),
        h('p', { class: 'muted small' }, 'Drag the files, or use the arrows, to set the order they are merged in. Pictures get a page each.'),
        list.el, defs.length ? h('div', { class: 'fc-opts' }, defs.map((o) => optionControl({ opts }, o))) : null, h('div', { class: 'row' }, btn)))
    })
  }

  // ---------- run ----------
  const patternIn = input({ value: settings.pattern, 'aria-label': 'Output name pattern', oninput: (e) => { settings.pattern = e.target.value || '{name}'; saveSettings(settings) } })
  const saveSeg = segmented([['zip', 'One ZIP file'], ['files', 'Separate files']], settings.saveAs, (v) => { settings.saveAs = v; saveSettings(settings); renderQueueHead() }, 'Save results as')
  const convertBtn = button('Convert', { icon: 'wand-sparkles', variant: 'primary', size: 'lg' })
  convertBtn.addEventListener('click', () => busy(convertBtn, runAll, { label: 'Starting' }))
  const readyGroups = () => [...groups.values()].filter((g) => g.items?.length && g.target && g.path)
  function renderRun() {
    clear(runHost)
    if (!items.length) { runHost.append(h('p', { class: 'muted' }, 'Add some files above to get started.')); return }
    const ready = readyGroups()
    const n = ready.reduce((a, g) => a + g.items.length, 0)
    const waiting = [...groups.values()].filter((g) => g.items?.length && !g.target && isKnown(g.ext) && routesFrom(g.ext).size)
    convertBtn.disabled = !n
    convertBtn.querySelector('span').textContent = n ? `Convert ${n} ${n === 1 ? 'file' : 'files'}` : 'Choose a format to convert to'
    runHost.append(h('section', { class: 'panel stack' }, h('div', { class: 'fc-run' },
      field('Name the results', patternIn, 'Use {name} for the original name, {ext} for its type, {date} for today and {n} for a running number.'),
      field('Save results as', saveSeg),
      convertBtn),
    waiting.length && n ? h('div', { class: 'muted small' }, `Waiting for a format: ${waiting.map((g) => shortLabel(g.ext)).join(', ')}. Those files are skipped until you pick one.`) : null))
  }

  async function runAll() {
    const ready = readyGroups()
    let crops = new Map()
    const cropItems = ready.filter((g) => g.crop).flatMap((g) => g.items)
    if (cropItems.length) {
      crops = await cropSession(cropItems.map((i) => ({ id: i.id, file: i.file })))
      if (!crops) return
    }
    const jobs = []
    let n = 0
    for (const g of ready) for (const it of g.items) {
      n++
      const rect = crops.get(it.id)
      try {
        const job = convertJob({ file: it.file, ext: g.ext, target: g.target, values: g.opts, n, pre: rect ? (f) => cropFile(f, rect) : null, label: it.file.name })
        job.meta.dir = it.dir
        jobs.push(job)
      } catch (e) { toast(`${it.file.name}: ${e.message}`, 'error') }
    }
    if (!jobs.length) return
    queue.add(jobs)
    renderQueueHead()
    queueEl.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }

  // ---------- queue and results ----------
  const jobList = h('ul', { class: 'fc-jobs' })
  const queueHead = h('div', { class: 'fc-queue-head' })
  const queueEl = h('section', { class: 'panel fc-queue', hidden: true }, queueHead, jobList)

  function renderQueueHead() {
    const jobs = queue.jobs
    queueEl.hidden = !jobs.length
    if (!jobs.length) return
    const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued')
    const done = jobs.filter((j) => j.status === 'done')
    const outCount = done.reduce((a, j) => a + finalOutputs(j).length, 0)
    clear(queueHead,
      h('h2', icon('list-checks'), active.length ? `Converting (${active.length} left, ${queue.concurrency} at a time)` : `${done.length} of ${jobs.length} done`),
      h('div', { class: 'row' },
        active.length ? button('Cancel all', { icon: 'x', size: 'sm', onClick: () => queue.cancelAll() }) : null,
        jobs.some((j) => j.status === 'error' || j.status === 'cancelled') && !active.length ? button('Retry failed', { icon: 'refresh-cw', size: 'sm', onClick: () => jobs.forEach((j) => queue.retry(j)) }) : null,
        outCount > 1 ? button('Download all as ZIP', { icon: 'folder-down', size: 'sm', variant: settings.saveAs === 'zip' ? 'primary' : 'secondary', onClick: (e) => busy(e.currentTarget, downloadZip, { label: 'Zipping' }) }) : null,
        outCount > 1 ? button('Download each file', { icon: 'download', size: 'sm', variant: settings.saveAs === 'files' ? 'primary' : 'secondary', onClick: downloadEach }) : null,
        !active.length ? button('Clear list', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { queue.clear(); jobEls.clear(); clear(jobList); renderQueueHead() } }) : null))
  }
  const allOutputs = () => queue.jobs.filter((j) => j.status === 'done').flatMap((j) => finalOutputs(j).map((f) => ({ f, dir: j.meta.dir || '' })))
  async function downloadZip() {
    const outs = allOutputs()
    download(await zip(outs.map(({ f, dir }) => ({ name: dir ? `${dir}/${f.name}` : f.name, data: f }))), `converted-${new Date().toISOString().slice(0, 10)}.zip`)
  }
  async function downloadEach() {
    for (const { f } of allOutputs()) { download(f, f.name); await new Promise((r) => setTimeout(r, 300)) }
  }

  function jobTarget(job) { return job.meta.target ? label(outExt(job.meta.target)) : '' }
  function updateJob(job) {
    let li = jobEls.get(job.id)
    if (!li) {
      li = h('li', { class: 'fc-job', dataset: { id: job.id, status: job.status } })
      jobEls.set(job.id, li)
      jobList.append(li)
    }
    li.className = `fc-job ${job.status}`
    li.dataset.status = job.status
    const via = job.meta.via?.length ? ` via ${job.meta.via.map(label).join(' then ')}` : ''
    const stateText = { queued: 'Waiting', running: `${Math.round(job.progress * 100)}%`, done: 'Done', error: 'Failed', cancelled: 'Cancelled' }[job.status]
    const main = h('div', { class: 'fc-job-main' },
      icon({ done: 'circle-check', error: 'circle-alert', cancelled: 'ban', running: 'loader', queued: 'clock' }[job.status]),
      h('div', { class: 'name', title: job.label }, `${job.label} → ${jobTarget(job)}${via}`),
      h('span', { class: 'state' }, stateText),
      job.status === 'queued' || job.status === 'running' ? button('Cancel', { size: 'sm', variant: 'ghost', icon: 'x', onClick: () => queue.cancel(job) }) : null,
      job.status === 'error' || job.status === 'cancelled' ? button('Retry', { size: 'sm', icon: 'refresh-cw', onClick: () => queue.retry(job) }) : null)
    clear(li, main)
    if (job.status === 'running' || job.status === 'queued') li.append(h('div', { class: 'fc-bar', role: 'progressbar', 'aria-valuenow': Math.round(job.progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `Progress for ${job.label}` }, h('i', { style: `width:${Math.round(job.progress * 100)}%` })))
    if (job.status === 'error') li.append(h('div', { class: 'fc-err', role: 'alert' }, job.error))
    if (job.status === 'done') {
      const outs = finalOutputs(job)
      li.append(h('ul', { class: 'fc-outs' }, outs.slice(0, 50).map((f) => h('li', { class: 'fc-out' },
        h('span', { class: 'name', title: f.name }, f.name),
        h('span', { class: 'size' }, `${formatBytes(job.size)} → ${formatBytes(f.size)}`),
        button('Download', { icon: 'download', size: 'sm', variant: 'primary', onClick: () => download(f, f.name) }),
        OPEN_OK(f) ? button('Open', { icon: 'external-link', size: 'sm', onClick: () => openInTab(f) }) : null,
        button('Convert again', { icon: 'repeat', size: 'sm', title: 'Send this result back in to convert it to another format', onClick: () => { addFiles([f]); toast('Added to the converter above', 'success'); zone.scrollIntoView?.({ behavior: 'smooth', block: 'center' }) } }))),
      outs.length > 50 ? h('li', { class: 'muted small' }, `and ${outs.length - 50} more in the ZIP`) : null))
    }
    renderQueueHead()
  }

  // ---------- recent conversions ----------
  const historyView = historyPanel()
  function historyPanel() {
    const host = h('div', { class: 'stack' })
    let armed = false
    async function refresh() {
      const list = await history.list()
      const total = list.reduce((a, e) => a + e.size, 0)
      armed = false
      clear(host,
        h('div', { class: 'fc-queue-head' }, h('div', h('h2', icon('history'), 'Recent conversions'), h('p', { class: 'muted small' }, list.length ? `The last ${list.length} results (${formatBytes(total)}), kept in this browser only. The oldest are dropped past ${history.MAX_ENTRIES} results or 300 MB.` : 'Nothing yet. Converted files show up here so you can get them again.')),
          list.length ? button('Clear history', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: async (e) => { if (!armed) { armed = true; e.currentTarget.querySelector('span').textContent = 'Click again to clear'; return } await history.clear(); refresh() } }) : null),
        list.length ? h('div', { class: 'fc-hist' }, list.map((e) => h('article', { class: 'fc-card', dataset: { id: e.id } },
          e.thumb ? h('img', { class: 'thumb', src: e.thumb, alt: '' }) : h('div', { class: 'thumb', 'aria-hidden': 'true' }, shortLabel(extOf(e.name) || 'file')),
          h('div', { class: 'meta' }, h('div', { class: 'name', title: e.name }, e.name), h('div', { class: 'sub' }, `${formatBytes(e.size)} · ${new Date(e.date).toLocaleString()}`), e.from ? h('div', { class: 'sub' }, `From ${e.from}`) : null),
          h('div', { class: 'acts' },
            button('Download', { icon: 'download', size: 'sm', variant: 'primary', onClick: async () => { const f = await history.getFile(e.id); f ? download(f, e.name) : toast('That file is no longer stored.', 'error') } }),
            button('Open', { icon: 'external-link', size: 'sm', onClick: async () => { const f = await history.getFile(e.id); if (f && OPEN_OK(f)) openInTab(f); else toast('This type cannot be shown in the browser. Download it instead.') } }),
            button('Convert again', { icon: 'repeat', size: 'sm', onClick: async () => { const f = await history.getFile(e.id); if (!f) return toast('That file is no longer stored.', 'error'); tabsEl?.show('convert'); await addFiles([f]); toast('Added to the converter', 'success') } }),
            button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${e.name} from history`, onClick: async () => { await history.remove(e.id); refresh() } }))))) : null)
    }
    refresh()
    return Object.assign(host, { refresh })
  }

  // ---------- page ----------
  const convertView = () => h('div', { class: 'stack' }, intake, quickHost, groupsHost, combineHost, runHost, queueEl)
  const tabItems = [
    { id: 'convert', label: 'Convert', render: convertView },
    { id: 'history', label: 'Recent', render: () => historyView },
  ]
  if (supportsWatch()) tabItems.push({ id: 'watch', label: 'Watch folder', render: () => watchPanel() })
  const wanted = { batch: 'convert', history: 'history', watch: 'watch' }[params.view] || 'convert'
  tabsEl = tabs(tabItems, tabItems.some((t) => t.id === wanted) ? wanted : 'convert', (id) => { if (id === 'history') historyView.refresh() })
  const wrap = h('div', { class: 'fc' }, tabsEl,
    supportsWatch() ? null : h('p', { class: 'muted small' }, 'Watch folder (convert every new file that lands in a folder) works in Chrome and Edge on a computer, so it is hidden here.'))
  root.append(wrap)
  renderAll()
  renderQueueHead()
  const off = onRegistryChange(() => renderAll())
  return () => { off(); queue.cancelAll() }
}
