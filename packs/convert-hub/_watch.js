// Watch folder: pick a folder, and every new file that shows up while this page is open is converted into a "converted" subfolder.
// It only ever reads and writes inside the folder the person chose. Needs the File System Access API (Chrome and Edge on a computer).
import { h, button, field, select, toggle, alert, icon, formatBytes } from '../../lib/ui.js'
import { safeName, ext as extOf } from '../../lib/files.js'
import { detect } from './_detect.js'
import { isKnown, findRoute, extraSniffers, registered } from './_registry.js'
import { convertFile, resolveOptions, outputName, renamed } from './_engine.js'
import { label, outExt } from './_formats.js'
import { allPresets, loadSettings } from './_presets.js'

export const supportsWatch = () => typeof globalThis.showDirectoryPicker === 'function'

const IGNORED = /^(\.|~\$)|\.(tmp|part|crdownload|download|partial|swp)$/i
const OUT_DIR = 'converted'
const ORIGINALS_DIR = 'originals'

/** A file name that is safe to create inside the chosen folder (no path parts). */
export function safeLeaf(name) {
  const n = safeName(String(name).split(/[\\/]/).pop() || '').replace(/^\.+$/, '_')
  return n || 'file'
}

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true } catch { return false }
}
async function uniqueName(dir, name) {
  if (!(await exists(dir, name))) return name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 1; i < 1000; i++) if (!(await exists(dir, `${base} (${i})${ext}`))) return `${base} (${i})${ext}`
  return `${base}-${Date.now()}${ext}`
}
async function writeFile(dir, name, blob) {
  const fh = await dir.getFileHandle(await uniqueName(dir, safeLeaf(name)), { create: true })
  const w = await fh.createWritable()
  await w.write(blob)
  await w.close()
  return fh.name
}

/**
 * createWatcher({dir, convert, moveOriginals, includeExisting, pollMs, onLog})
 *   dir: a directory handle. convert(file) -> Promise<File[] | null> (null = not convertible, skipped).
 * -> {start(), stop(), tick(), running}. tick() does one scan and is what the timer calls; tests call it directly.
 * A new file is converted once its size and date stop changing between two scans, so half-copied files are left alone.
 */
export function createWatcher({ dir, convert, moveOriginals = false, includeExisting = false, pollMs = 2000, onLog = () => {} }) {
  const settled = new Set(), pending = new Map(), busy = new Set()
  let timer = null, baselined = false, running = false, stopped = false, scanning = false
  const keyOf = (name, f) => `${name}|${f.size}|${f.lastModified}`

  async function tick() {
    if (scanning) return
    scanning = true
    try {
      const entries = []
      for await (const e of dir.values()) if (e.kind === 'file' && !IGNORED.test(e.name)) entries.push(e)
      for (const e of entries) {
        if (stopped) break
        let f
        try { f = await e.getFile() } catch { continue }
        const key = keyOf(e.name, f)
        if (settled.has(key) || busy.has(e.name)) continue
        if (!baselined && !includeExisting) { settled.add(key); continue }
        if (pending.get(e.name) !== key) { pending.set(e.name, key); continue } // wait one more scan: is it still being written?
        pending.delete(e.name)
        settled.add(key)
        busy.add(e.name)
        await handle(e, f)
        busy.delete(e.name)
      }
      baselined = true
    } finally { scanning = false }
  }

  async function handle(entry, f) {
    onLog('info', `New file: ${entry.name} (${formatBytes(f.size)})`)
    try {
      const outs = await convert(f)
      if (!outs) { onLog('skip', `Skipped ${entry.name}: nothing to convert it to`); return }
      const outDir = await dir.getDirectoryHandle(OUT_DIR, { create: true })
      const names = []
      for (const o of outs) names.push(await writeFile(outDir, o.name, o))
      onLog('ok', `Converted ${entry.name} to ${names.join(', ')}`)
      if (moveOriginals) {
        const origDir = await dir.getDirectoryHandle(ORIGINALS_DIR, { create: true })
        await writeFile(origDir, entry.name, f)
        await dir.removeEntry(entry.name)
        onLog('info', `Moved ${entry.name} to ${ORIGINALS_DIR}`)
      }
    } catch (err) {
      onLog('error', `Could not convert ${entry.name}: ${err?.message || err}`)
    }
  }

  return {
    get running() { return running },
    tick,
    async start() {
      running = true; stopped = false
      await tick() // the first scan only notes what is already there
      if (running) timer = setInterval(() => { tick().catch((e) => onLog('error', e?.message || String(e))) }, pollMs)
    },
    stop() { running = false; stopped = true; clearInterval(timer); timer = null },
  }
}

/** The panel for the Watch folder tab. */
export function watchPanel() {
  if (!supportsWatch()) {
    return alert('info', h('strong', 'Watch folder needs Chrome or Edge on a computer. '), 'Your browser cannot be given a folder to keep an eye on, so this part is switched off. Everything else works as usual.')
  }
  let dir = null, watcher = null, counter = 0
  const folderName = h('span', { class: 'muted' }, 'No folder chosen yet')
  const pickBtn = button('Choose folder', { icon: 'folder-open', onClick: choose })
  const targets = new Map()
  for (const c of registered()) if (!c.combine) for (const t of c.to) if (!targets.has(t)) targets.set(t, label(t))
  const targetSel = select([...targets].sort((a, b) => a[1].localeCompare(b[1])), 'pdf', null)
  const presets = allPresets()
  const presetSel = select([['', 'Default settings'], ...[...presets.keys()].map((n) => [n, n])], '', null)
  const moveTog = toggle('Move the originals into an "originals" folder afterwards', false)
  const existingTog = toggle('Also convert files that are already in the folder', false)
  const startBtn = button('Start watching', { icon: 'eye', variant: 'primary', disabled: true, onClick: () => (watcher?.running ? stop() : start()) })
  const log = h('ul', { class: 'fc-log', 'aria-live': 'polite', 'aria-label': 'Watch folder log' })
  const status = h('div', { class: 'muted small' })

  const addLog = (kind, text) => {
    const li = h('li', { class: kind }, h('time', new Date().toLocaleTimeString()), h('span', text))
    log.prepend(li)
    while (log.children.length > 200) log.lastChild.remove()
  }

  async function choose() {
    try {
      dir = await showDirectoryPicker({ mode: 'readwrite', id: 'fc-watch' })
    } catch (e) { if (e?.name !== 'AbortError') addLog('error', e?.message || 'Could not open the folder.'); return }
    folderName.textContent = `${dir.name}`
    folderName.className = ''
    startBtn.disabled = false
    if (watcher?.running) stop()
  }

  async function convertOne(file) {
    const d = await detect(file, { extra: extraSniffers(), known: isKnown })
    const target = targetSel.value
    if (!d.ext || d.ext === target) return null
    const path = findRoute(d.ext, target)
    if (!path) return null
    const preset = presets.get(presetSel.value)
    const opts = resolveOptions(path, preset?.values || {})
    const outs = await convertFile(file, path, opts, {})
    const pattern = loadSettings().pattern
    const n = ++counter
    return outs.map((o) => renamed(o, outputName(pattern, file, o, n)))
  }

  function start() {
    if (!dir) return
    counter = 0
    watcher = createWatcher({ dir, convert: convertOne, moveOriginals: moveTog.input.checked, includeExisting: existingTog.input.checked, onLog: addLog })
    watcher.start()
    startBtn.querySelector('span').textContent = 'Stop watching'
    status.textContent = `Watching "${dir.name}". New files are converted to ${label(outExt(targetSel.value))} in its "${OUT_DIR}" folder. Keep this page open.`
    for (const c of [pickBtn, targetSel, presetSel, moveTog.input, existingTog.input]) c.disabled = true
    addLog('info', 'Started. Files already in the folder are left alone.')
  }
  function stop() {
    watcher?.stop()
    startBtn.querySelector('span').textContent = 'Start watching'
    status.textContent = 'Stopped.'
    for (const c of [pickBtn, targetSel, presetSel, moveTog.input, existingTog.input]) c.disabled = false
    addLog('info', 'Stopped.')
  }

  const styles = h('style', `
.fc-log { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 280px; overflow: auto; font: 12.5px/1.4 var(--mono, monospace); }
.fc-log li { display: flex; gap: 10px; padding: 4px 8px; border-radius: 8px; background: var(--surface-2); }
.fc-log time { color: var(--muted); flex: none; } .fc-log li.ok span { color: var(--success); } .fc-log li.error span { color: var(--danger); } .fc-log li.skip span { color: var(--muted); }
.fc-log:empty::before { content: "Nothing yet. Start watching, then drop files into the folder."; color: var(--muted); padding: 4px 8px; }
`)
  return h('div', { class: 'stack' }, styles,
    h('section', { class: 'panel stack' },
      h('h2', icon('folder-sync'), ' Watch a folder'),
      h('p', { class: 'muted small' }, 'Choose a folder and a format. While this page stays open, every new file you put in that folder is converted and saved in a "converted" folder inside it. Nothing outside the folder is touched, and nothing is uploaded.'),
      h('div', { class: 'row' }, pickBtn, folderName),
      h('div', { class: 'grid-2' }, field('Convert new files to', targetSel), field('Settings', presetSel)),
      moveTog, existingTog,
      h('div', { class: 'row' }, startBtn, status)),
    h('section', { class: 'panel stack' }, h('h2', 'Live log'), log))
}
