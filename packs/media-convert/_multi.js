// Multi-file tools (merge videos, merge audio, batch audio converter): a reorderable file list with probed details
// and the same run dock and result card as the single-file tools.
import { h, icon, button, dropzone, fileList, table, alert, clear, formatBytes, onCleanup } from '../../lib/ui.js'
import { createRunner, injectStyles, enginePill, trustStrip, ACCEPT, TRUST } from './_ui.js'
import { inspect, warm, saveData, engine, friendlyError } from './_engine.js'
import { fmtTime, LARGE_FILE, MB } from './_media.js'
import { MAX_INPUT_BYTES } from '../../lib/ffmpeg.js'

const num = (n, d = 2) => +Number(n).toFixed(d)

/** One-line summary of a probed file for the details table. */
export function summarize(info) {
  if (!info) return 'Reading...'
  const bits = []
  if (info.display) bits.push(`${info.display.width}x${info.display.height}`)
  if (info.video?.fps) bits.push(`${num(info.video.fps)} fps`)
  if (info.video) bits.push(info.video.codec.toUpperCase())
  if (info.audio) bits.push([info.audio.codec.toUpperCase(), info.audio.rate ? `${num(info.audio.rate / 1000, 1)} kHz` : '', info.audio.layout].filter(Boolean).join(' '))
  else if (info.hasVideo) bits.push('no sound')
  if (!info.hasVideo && info.bitrate) bits.push(`${info.bitrate} kbps`)
  return bits.join(' · ') || 'Unknown format'
}

/**
 * createFileSet({kind, accept, dropLabel, dropHint, dropIcon, sortable, max, play, onChange})
 * -> {el, files, infos(Map), info(file), ready(), setDisabled(bool), destroy()}
 * Files are probed one by one in the background; onChange fires when the list or any details change.
 */
export function createFileSet(opts) {
  const { kind = 'audio', sortable = true, max = 30, play = kind === 'audio', onChange } = opts
  const infos = new Map()
  const failed = new Map()
  let pending = 0
  let idle = Promise.resolve()
  let audio = null
  let playingFile = null
  let dead = false

  const list = fileList({ sortable, onChange: () => { render(); onChange?.() } })
  const detailBox = h('div')
  const notice = h('div')
  const zone = dropzone({
    accept: opts.accept || ACCEPT[kind], multiple: true, icon: opts.dropIcon || (kind === 'video' ? 'film' : 'audio-lines'),
    label: opts.dropLabel || 'Drop files here or click to choose',
    hint: opts.dropHint,
    onFiles: (files) => add(files),
  })
  const el = h('div', { class: 'mc-over' }, zone, list.el, notice, detailBox)

  function add(files) {
    const room = max - list.files.length
    const take = files.slice(0, Math.max(0, room))
    if (take.length < files.length) notice.replaceChildren(alert('warn', `Only ${max} files can be added at once. Skipped ${files.length - take.length}.`))
    else notice.replaceChildren()
    const tooBig = take.filter((f) => f.size > MAX_INPUT_BYTES)
    if (tooBig.length) notice.append(alert('error', h('strong', 'Too big for the browser: '), `${tooBig.map((f) => f.name).join(', ')} (limit about ${MAX_INPUT_BYTES / MB} MB each).`))
    const ok = take.filter((f) => f.size <= MAX_INPUT_BYTES)
    if (!ok.length) return
    list.add(ok)
    for (const f of ok) probeLater(f)
    warm().catch(() => {})
  }

  function probeLater(f) {
    pending++
    idle = idle.then(async () => {
      if (dead) return
      try { infos.set(f, await inspect(f)) } catch (e) { failed.set(f, friendlyError(e)) }
      pending--
      if (dead) return
      render()
      onChange?.()
    })
  }

  let audioUrl = null
  function stop() { audio?.pause(); audio = null; playingFile = null; if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null }
  function toggle(f) {
    if (audio && playingFile === f && !audio.paused) { stop(); render(); return }
    stop()
    audioUrl = URL.createObjectURL(f)
    audio = new Audio(audioUrl)
    playingFile = f
    audio.addEventListener('ended', () => { stop(); render() })
    audio.addEventListener('error', () => { stop(); render() })
    audio.play().catch(() => {})
    render()
  }

  function render() {
    const files = list.files
    zone.classList.toggle('compact', files.length > 0)
    if (!files.length) { clear(detailBox); return }
    const rows = files.map((f, i) => {
      const info = infos.get(f)
      const bad = failed.get(f)
      const playing = playingFile === f && audio && !audio.paused
      return [
        String(i + 1),
        h('span', { title: f.name, style: 'display:inline-block;max-width:220px;overflow:hidden;text-overflow:ellipsis;vertical-align:bottom' }, f.name),
        info?.duration != null ? fmtTime(info.duration, 1) : '-',
        bad ? h('span', { style: 'color:var(--danger)' }, 'Cannot read this file') : summarize(info),
        formatBytes(f.size),
        play ? button('', { icon: playing ? 'pause' : 'play', variant: 'ghost', size: 'sm', ariaLabel: `${playing ? 'Pause' : 'Play'} ${f.name}`, disabled: !!bad, onClick: () => toggle(f) }) : '',
      ]
    })
    const total = files.reduce((n, f) => n + (infos.get(f)?.duration || 0), 0)
    clear(detailBox, h('div', { class: 'stack tight' },
      table({ columns: [{ label: '#', num: true }, 'File', { label: 'Length', num: true }, 'Details', { label: 'Size', num: true }, ...(play ? [{ label: 'Play' }] : [])], rows: rows.map((r) => (play ? r : r.slice(0, 5))) }),
      h('div', { class: 'mc-note' }, `${files.length} file${files.length === 1 ? '' : 's'}${total ? ` · ${fmtTime(total)} in total` : ''} · ${formatBytes(files.reduce((n, f) => n + f.size, 0))}${pending ? ' · reading file details...' : ''}`)))
  }

  onCleanup(() => { dead = true; stop() })
  render()
  return {
    el, zone,
    get files() { return list.files },
    info: (f) => infos.get(f),
    failedFor: (f) => failed.get(f),
    infos,
    ready: () => idle,
    setDisabled: (b) => { list.setDisabled(b) },
    clearAll: () => list.set([]),
    destroy: () => { dead = true; stop(); list.destroy() },
  }
}

/**
 * createMultiShell(root, {signal}, cfg)
 * cfg: {kind, min, max, accept, dropLabel, dropHint, dropIcon, trust, sortable, play, action: {label, icon, busy},
 *       options?(set, shell) -> Node | Node[] (built once, when the first file arrives),
 *       onSet?(set, shell) (called when the list or file details change),
 *       execute(set, helpers, shell) -> result}
 */
export function createMultiShell(root, { signal }, cfg) {
  injectStyles()
  const kind = cfg.kind || 'audio'
  const min = cfg.min || 1
  const wrap = h('div', { class: 'mc' })
  root.append(wrap)
  let optionsBuilt = false
  const optionsEl = h('div', { class: 'mc-panel', hidden: true })
  const pill = enginePill()
  const trust = trustStrip(cfg.trust || TRUST[kind])
  const runner = createRunner({
    signal, label: cfg.action.label, icon: cfg.action.icon, busyLabel: cfg.action.busy,
    onBusy: (on) => set.setDisabled(on),
    onRun: (hp) => cfg.execute(set, hp, shell),
  })
  runner.el.hidden = true
  const set = createFileSet({
    kind, sortable: cfg.sortable ?? true, max: cfg.max || 30, play: cfg.play, accept: cfg.accept,
    dropLabel: cfg.dropLabel, dropHint: cfg.dropHint, dropIcon: cfg.dropIcon,
    onChange: () => sync(),
  })
  const warnBox = h('div')
  const shell = {
    set,
    setInfo: (a, b) => runner.setInfo(a, b),
    setEnabled: (on, why) => runner.setEnabled(on, why),
    setLabel: (t) => runner.setLabel(t),
  }
  wrap.append(set.el, h('div', { class: 'row', style: 'justify-content:center' }, pill), trust, warnBox, optionsEl, runner.el)
  const warmUp = () => { if (!saveData() && engine.state === 'idle') warm().catch(() => {}) }
  set.zone.addEventListener('pointerenter', warmUp, { once: true })

  function sync() {
    const n = set.files.length
    pill.parentElement.hidden = n > 0
    trust.hidden = n > 0
    optionsEl.hidden = n === 0
    runner.el.hidden = n === 0
    if (n && !optionsBuilt) {
      optionsBuilt = true
      const nodes = [cfg.options?.(set, shell)].flat().filter(Boolean)
      clear(optionsEl, nodes)
      optionsEl.hidden = !nodes.length
    }
    const total = set.files.reduce((a, f) => a + f.size, 0)
    clear(warnBox, total > LARGE_FILE ? alert('warn', h('strong', 'Big job. '), `${formatBytes(total)} in total is a lot for a browser. It can be slow and may run out of memory. Fewer or smaller files are safer.`) : null)
    const bad = set.files.find((f) => set.failedFor(f))
    if (n < min) runner.setEnabled(false, `Add at least ${min} files`)
    else if (bad) runner.setEnabled(false, `${bad.name} cannot be read. Remove it to continue.`)
    else runner.setEnabled(true)
    cfg.onSet?.(set, shell)
  }
  sync()
  signal?.addEventListener('abort', () => { runner.destroy(); set.destroy() }, { once: true })
  return shell
}

/** A proportional bar of the files in order, like a timeline of the joined result. Call .update() when the set changes. */
export function storyboard(set) {
  const bar = h('div', { class: 'mc-story', role: 'img' })
  const label = h('div', { class: 'mc-note' })
  const el = h('div', { class: 'stack tight' }, bar, label)
  el.update = () => {
    const files = set.files
    const durs = files.map((f) => set.info(f)?.duration || 0)
    const total = durs.reduce((a, b) => a + b, 0)
    clear(bar, files.map((f, i) => h('i', { title: `${i + 1}. ${f.name}`, style: { '--w': String(durs[i] || total / Math.max(1, files.length) || 1), '--k': String(files.length > 1 ? i / (files.length - 1) : 0) } }, String(i + 1))))
    bar.setAttribute('aria-label', `Order of the ${files.length} files`)
    label.textContent = total ? `Joined length: ${fmtTime(total, 1)}. Drag or use the arrows in the list above to change the order.` : 'Drag or use the arrows in the list above to change the order.'
  }
  el.update()
  return el
}
