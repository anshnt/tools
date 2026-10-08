// Shared UI for the media-convert tools: file stage with preview and facts, option widgets, the run dock with a
// progress ring and Cancel, the animated result card, and createShell() that wires them together for single-file tools.
import { h, icon, button, dropzone, alert, clear, formatBytes, isAbort, toast, stats, downloadButton, download, fileType, onCleanup } from '../../lib/ui.js'
import { MAX_INPUT_BYTES } from '../../lib/ffmpeg.js'
import { ext, zip } from '../../lib/files.js'
import { injectStyles } from './_style.js'
import { engine, onEngine, warm, inspect, resetEngine, run as ffRun, friendlyError, needsReset, mediaDuration, saveData } from './_engine.js'
import { fmtTime, LARGE_FILE, MB, pctChange } from './_media.js'

export { h, icon, button, alert, clear, formatBytes, toast, injectStyles }

export const ENGINE_MB = 31

// ---------- Small widgets ----------

/** Numbered option group: step(1, 'Format', content, 'optional right-hand note') */
export const step = (n, title, kids, small) =>
  h('div', { class: 'mc-step' }, h('header', h('span', { class: 'n' }, n), title, small ? h('small', small) : null), kids)

/** The options card that holds the steps. */
export const panel = (...steps) => h('div', { class: 'mc-panel' }, steps.flat())

/** A non-interactive "this is what you get" card for tools whose output format is fixed. */
export const fixedOutput = (ic, title, text) => h('div', { class: 'mc-fixed' }, h('span', { class: 't-ic' }, icon(ic)), h('div', h('b', title), h('small', text)))

export const note = (text, cls = '') => h('p', { class: ['mc-note', cls] }, text)

/** Big selectable tiles. options: [{value, label, sub, icon, disabled}]. Returns element with .value, .set(v), .disable(v, bool). */
export function tilePicker({ options, value, onChange, compact = false, label }) {
  const el = h('div', { class: ['mc-tiles', compact && 'compact'], role: 'group', 'aria-label': label || null })
  el.value = value
  const btns = options.map((o) => {
    const b = h('button', {
      type: 'button', class: 'mc-tile', 'aria-pressed': String(o.value === value), disabled: !!o.disabled,
      onclick: () => { if (b.disabled) return; el.set(o.value); onChange?.(o.value) },
    }, o.icon ? h('span', { class: 't-ic' }, icon(o.icon)) : null, h('b', o.label), o.sub ? h('small', o.sub) : null)
    b._v = o.value
    return b
  })
  el.append(...btns)
  el.set = (v) => { el.value = v; for (const b of btns) b.setAttribute('aria-pressed', String(b._v === v)) }
  el.disable = (v, on = true) => { for (const b of btns) if (b._v === v) b.disabled = on }
  return el
}

/** Quick-pick pills (single choice). */
export function pills(options, value, onChange, label) {
  const el = h('div', { class: 'mc-pills', role: 'group', 'aria-label': label || null })
  el.value = value
  const btns = options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, String(o)]
    const b = h('button', { type: 'button', class: 'mc-pill', 'aria-pressed': String(v === value), onclick: () => { el.set(v); onChange?.(v) } }, l)
    b._v = v
    return b
  })
  el.append(...btns)
  el.set = (v) => { el.value = v; for (const b of btns) b.setAttribute('aria-pressed', String(b._v === v)) }
  return el
}

const CONFETTI = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#22c55e', '#0ea5e9']
function confetti(host) {
  const n = 22
  const box = h('div', { class: 'mc-confetti', 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5
    const d = 55 + Math.random() * 80
    return h('i', { style: { '--x': `${(Math.cos(a) * d).toFixed(0)}px`, '--y': `${(Math.sin(a) * d - 18).toFixed(0)}px`, '--r': `${(Math.random() * 540 - 270) | 0}deg`, '--k': CONFETTI[i % CONFETTI.length], '--d': (Math.random() * 140) | 0 } })
  }))
  host.append(box)
  setTimeout(() => box.remove(), 1500)
}

// ---------- File facts ----------

const num = (n, d = 2) => +Number(n).toFixed(d)
const kbps = (n) => (n >= 1000 ? `${num(n / 1000, 1)} Mbps` : `${Math.round(n)} kbps`)

/** Chips describing a probed file: duration, size, fps, codecs, loudness-friendly audio facts. */
export function specChips(file, info) {
  const c = []
  if (info.duration != null) c.push(['clock', fmtTime(info.duration, info.duration < 10 ? 1 : 0)])
  if (info.display) c.push(['maximize', `${info.display.width} x ${info.display.height}`])
  if (info.video?.fps) c.push(['gauge', `${num(info.video.fps)} fps`])
  if (info.video) c.push(['film', info.video.codec.toUpperCase()])
  if (info.audio) c.push(['audio-lines', [info.audio.codec.toUpperCase(), info.audio.rate ? `${num(info.audio.rate / 1000, 1)} kHz` : '', info.audio.layout].filter(Boolean).join(' ')])
  else if (info.hasVideo) c.push(['volume-x', 'No sound'])
  c.push(['hard-drive', formatBytes(file.size)])
  if (info.bitrate) c.push(['activity', kbps(info.bitrate)])
  if (info.rotation) c.push(['rotate-cw', `Rotated ${info.rotation} deg`])
  return c.map(([ic, t], i) => h('span', { class: 'mc-chip', style: { '--i': i } }, icon(ic), t))
}

/** Mini audio player with a live equalizer. Wraps an <audio> element. */
export function audioPlayer(el, getDuration = () => el.duration) {
  const bars = Array.from({ length: 72 }, (_, i) => h('i', { style: { '--i': i, '--h': (0.3 + 0.7 * Math.abs(Math.sin(i * 1.9) * Math.cos(i * 0.47))).toFixed(2) } }))
  const play = h('button', { type: 'button', class: 'mc-play', 'aria-label': 'Play' }, icon('play'))
  const seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Seek' })
  const cur = h('span', '0:00')
  const tot = h('span', '0:00')
  const box = h('div', { class: 'mc-aud' }, play, h('div', { class: 'mc-aud-main' }, h('div', { class: 'mc-eq', 'aria-hidden': 'true' }, bars)), h('div', { class: 'mc-aud-bar' }, cur, seek, tot))
  const dur = () => { const d = getDuration(); return Number.isFinite(d) && d > 0 ? d : 0 }
  const paint = () => {
    const d = dur()
    cur.textContent = fmtTime(el.currentTime || 0)
    tot.textContent = fmtTime(d)
    if (d && document.activeElement !== seek) seek.value = String(Math.round((el.currentTime / d) * 1000))
  }
  const setPlaying = (on) => {
    box.classList.toggle('playing', on)
    play.replaceChildren(icon(on ? 'pause' : 'play'))
    play.setAttribute('aria-label', on ? 'Pause' : 'Play')
  }
  play.addEventListener('click', () => (el.paused ? el.play().catch(() => {}) : el.pause()))
  seek.addEventListener('input', () => { const d = dur(); if (d) el.currentTime = (seek.valueAsNumber / 1000) * d })
  for (const ev of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked']) el.addEventListener(ev, paint)
  el.addEventListener('play', () => setPlaying(true))
  el.addEventListener('pause', () => setPlaying(false))
  el.addEventListener('ended', () => setPlaying(false))
  box.paint = paint
  paint()
  return box
}

export function noPreview(text) {
  return h('div', { class: 'mc-nopreview' }, icon('eye-off'), h('div', text || 'Your browser cannot preview this format. The file is fine and can still be processed.'))
}

// ---------- Stage ----------

/**
 * The media card: preview, file name, spec chips, status area (engine download, warnings) and a slot for extras.
 * media = {file, url, kind, info, el, canPlay}
 */
export function createStage(file, { onChange }) {
  const url = URL.createObjectURL(file)
  const media = { file, url, kind: /^audio\//.test(fileType(file)) ? 'audio' : 'video', info: null, el: null, canPlay: true }
  const view = h('div', { class: 'mc-view' })
  const nameEl = h('div', { class: 'mc-fname', title: file.name }, file.name, h('small', formatBytes(file.size)))
  const chipsEl = h('div', { class: 'mc-chips', 'aria-label': 'File details' })
  const statusEl = h('div', { class: 'mc-status', 'aria-live': 'polite' })
  const extra = h('div', { class: 'mc-over' })
  const el = h('section', { class: 'mc-stage', 'aria-label': 'Your file' }, view,
    h('div', { class: 'mc-meta' }, nameEl, button('Change file', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', onClick: onChange })),
    chipsEl, statusEl, extra)
  let player = null

  function render() {
    player = null
    media.canPlay = true
    if (media.kind === 'audio') {
      media.el = h('audio', { src: url, preload: 'metadata' })
      player = audioPlayer(media.el, () => (Number.isFinite(media.el.duration) ? media.el.duration : media.info?.duration))
      media.el.addEventListener('error', () => { media.canPlay = false; clear(view, noPreview()) })
      clear(view, player, media.el)
    } else {
      media.el = h('video', { src: url, controls: true, playsinline: true, preload: 'metadata', class: 'mc-fx' })
      media.el.addEventListener('error', () => { media.canPlay = false; clear(view, noPreview()) })
      clear(view, h('span', { class: 'mc-float' }, icon('film'), ext(file.name).toUpperCase() || 'VIDEO'), media.el)
    }
  }
  render()

  return {
    el, media, extra,
    /** Adopt probe results: fixes the preview type and fills the chips. */
    setInfo(info) {
      media.info = info
      const kind = info.hasVideo ? 'video' : 'audio'
      if (kind !== media.kind) { media.kind = kind; render() }
      clear(chipsEl, specChips(file, info))
      const t = info.tags
      if (t?.title) clear(nameEl, t.title, h('small', [t.artist, file.name].filter(Boolean).join(' · ')))
    },
    setStatus(...kids) { clear(statusEl, kids) },
    busy(on) { el.classList.toggle('busy', !!on) },
    destroy() { try { media.el?.pause() } catch { /* gone */ } URL.revokeObjectURL(url) },
  }
}

/** Download progress block for the one-time engine fetch. */
function engineBar(e) {
  const f = e.frac
  const ind = f == null || !Number.isFinite(f)
  return h('div', { class: 'stack tight' },
    h('div', { class: ['mc-bar', ind && 'ind'], role: 'progressbar', 'aria-label': 'Video engine download', 'aria-valuenow': ind ? null : Math.round(f * 100) }, h('i', { style: ind ? '' : `width:${(f * 100).toFixed(1)}%` })),
    h('div', { class: 'mc-bar-text' }, h('span', ind ? 'Starting the video engine' : `Downloading the video engine, ${(f * ENGINE_MB).toFixed(1)} of ${ENGINE_MB} MB`), h('span', ind ? '' : `${Math.round(f * 100)}%`)),
    h('div', { class: 'mc-note' }, 'One time only. It is saved in your browser, so next time this step is instant.'))
}

export const skeleton = () => h('div', { class: 'mc-skel', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))

// ---------- Runner: dock, progress ring, result ----------

const kindOf = (name) => (/\.(mp3|m4a|m4r|wav|ogg|opus|flac|aac|ac3|wma|amr)$/i.test(name) ? 'audio' : /\.(gif|png|jpe?g|webp)$/i.test(name) ? 'image' : 'video')

/**
 * createRunner({signal, label, icon, busyLabel, onRun(helpers) -> result, onBusy(bool)})
 * helpers: {signal, report(fraction|null, label), ffmpeg(spec, [from, to]), engineLabel}
 * result:  {blob, name, kind?, inputSize?, title?, summary?, notes?: [Node], stats?: [], actions?: [Node], duration?, compare?}
 */
export function createRunner({ signal, label, icon: ic, busyLabel, onRun, onBusy }) {
  const goBtn = button(label, { icon: ic, variant: 'primary', size: 'lg' })
  goBtn.classList.add('mc-go')
  const infoEl = h('div', { class: 'mc-dock-info' })
  const dock = h('div', { class: 'mc-dock' }, infoEl, goBtn)
  const runEl = h('div', { hidden: true })
  const resultEl = h('div', { class: 'mc-over' })
  const el = h('div', { class: 'mc-over' }, dock, runEl, resultEl)
  let running = false
  let urls = []
  let reason = ''
  let enabled = true

  const sync = () => { goBtn.disabled = running || !enabled; goBtn.title = !enabled && reason ? reason : '' }
  const api = {
    el,
    /** setInfo('About 14 MB', 'Under the WhatsApp limit') */
    setInfo(strong, text) { clear(infoEl, strong ? h('b', strong) : null, text ? h('span', text) : null) },
    setEnabled(on, why = '') { enabled = !!on; reason = why; sync() },
    setLabel(text) { goBtn.querySelector('span:not(.spinner)').textContent = text },
    get running() { return running },
    clearResult() { previewAudio?.pause(); previewAudio = null; for (const u of urls) URL.revokeObjectURL(u); urls = []; clear(resultEl) },
    destroy() { api.clearResult() },
  }

  async function start() {
    if (running || !enabled) return
    running = true
    api.clearResult()
    sync()
    const original = [...goBtn.childNodes]
    goBtn.replaceChildren(h('span', { class: 'spinner' }), h('span', busyLabel || 'Working'))
    onBusy?.(true)
    const ac = new AbortController()
    const onParent = () => ac.abort()
    signal?.addEventListener('abort', onParent, { once: true })

    const ringNum = h('b')
    const ring = h('div', { class: 'mc-ring ind', 'aria-hidden': 'true' }, ringNum)
    const title = h('b', 'Getting ready')
    const sub = h('span', 'Starting the engine')
    const cancel = button('Cancel', { icon: 'x', variant: 'secondary', onClick: () => ac.abort() })
    clear(runEl, h('div', { class: 'mc-run', role: 'status' }, ring, h('div', { class: 'mc-run-text' }, title, sub), cancel))
    runEl.hidden = false
    runEl.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })

    const t0 = performance.now()
    let tProc = 0
    let frac = null
    let lab = ''
    const paintSub = () => {
      const el = (performance.now() - t0) / 1000
      if (/download/i.test(lab) && frac != null) sub.textContent = `${(frac * ENGINE_MB).toFixed(1)} of ${ENGINE_MB} MB. One time only.`
      else if (frac != null && frac > 0.04 && tProc) {
        const left = ((performance.now() - tProc) / 1000) * ((1 - frac) / frac)
        sub.textContent = `${fmtTime(el)} elapsed · about ${fmtTime(Math.max(1, left))} left`
      } else sub.textContent = `${fmtTime(el)} elapsed`
    }
    const report = (f, l) => {
      frac = f == null || !Number.isFinite(f) ? null : Math.min(1, Math.max(0, f))
      if (l) lab = l
      if (!/download|loading/i.test(lab) && !tProc && frac != null) tProc = performance.now()
      ring.classList.toggle('ind', frac == null)
      if (frac != null) ring.style.setProperty('--mc-p', (frac * 100).toFixed(1))
      ringNum.textContent = frac == null ? '' : `${Math.round(frac * 100)}%`
      title.textContent = lab || busyLabel || 'Working'
      paintSub()
    }
    const tick = setInterval(paintSub, 500)

    const helpers = {
      signal: ac.signal,
      report,
      // spec.total (seconds of output) makes progress follow ffmpeg's own "time=" log lines, which is exact for multi-input jobs
      ffmpeg: (spec, span = [0, 1]) => {
        const map = (f) => span[0] + f * (span[1] - span[0])
        const label = spec.label || 'Processing'
        return ffRun({
          ...spec, signal: ac.signal,
          onLog: (m) => {
            if (spec.total) {
              const t = m.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
              if (t) report(map(Math.min(0.99, (+t[1] * 3600 + +t[2] * 60 + +t[3]) / spec.total)), label)
            }
            spec.onLog?.(m)
          },
          onProgress: (f, l) => {
            if (/download|loading/i.test(l || '')) report(f, l)
            else if (!spec.total) report(f == null ? null : map(f), label)
          },
        })
      },
    }
    try {
      const res = await onRun(helpers)
      if (ac.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
      if (res) await showResult(res, (performance.now() - t0) / 1000)
    } catch (e) {
      if (isAbort(e) || ac.signal.aborted) {
        if (!signal?.aborted) { resetEngine(); clear(resultEl, alert('info', h('strong', 'Cancelled. '), 'Nothing was saved. Change the settings and try again whenever you like.')) }
      } else {
        console.error(e)
        if (needsReset(e)) resetEngine()
        clear(resultEl, alert('error', h('strong', 'That did not work. '), friendlyError(e)))
      }
    } finally {
      clearInterval(tick)
      signal?.removeEventListener('abort', onParent)
      runEl.hidden = true
      clear(runEl)
      running = false
      goBtn.replaceChildren(...original)
      sync()
      onBusy?.(false)
    }
  }
  goBtn.addEventListener('click', start)

  let previewAudio = null
  function showMulti(res, seconds) {
    const done = res.items.filter((i) => i.blob)
    const failed = res.items.length - done.length
    const total = done.reduce((n, i) => n + i.blob.size, 0)
    const check = h('div', { class: 'mc-check', 'aria-hidden': 'true' },
      h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, h('path', { d: 'm5 12.5 4.5 4.5L19 7.5' })))
    const head = h('div', { class: 'mc-done-head' }, check,
      h('div', h('h3', res.title || `${done.length} file${done.length === 1 ? '' : 's'} ready`), h('p', res.summary || `Finished in ${fmtTime(Math.max(1, seconds))}.${failed ? ` ${failed} could not be converted.` : ''}`)))
    const rows = res.items.map((it, i) => {
      if (!it.blob) return h('div', { class: 'mc-zip-row bad', style: { animationDelay: `${i * 50}ms` } }, h('div', { class: 'nm', title: it.name }, it.name, h('small', it.error || 'Could not be converted')), h('span'), h('span'))
      const url = URL.createObjectURL(it.blob)
      urls.push(url)
      const isAudio = (it.kind || kindOf(it.name)) === 'audio'
      const playBtn = isAudio ? button('', { icon: 'play', variant: 'ghost', size: 'sm', ariaLabel: `Play ${it.name}`, onClick: () => {
        if (previewAudio && previewAudio.src === url && !previewAudio.paused) { previewAudio.pause(); return }
        previewAudio?.pause()
        previewAudio = new Audio(url)
        previewAudio.play().catch(() => {})
      } }) : h('span')
      return h('div', { class: 'mc-zip-row', style: { animationDelay: `${i * 50}ms` } },
        h('div', { class: 'nm', title: it.name }, it.name, h('small', [formatBytes(it.blob.size), it.inputSize ? `${pctChange(it.inputSize, it.blob.size)} vs original` : '', it.note].filter(Boolean).join(' · '))),
        playBtn,
        button('Download', { icon: 'download', variant: 'secondary', size: 'sm', onClick: () => download(it.blob, it.name) }))
    })
    const actions = h('div', { class: 'mc-actions' },
      done.length > 1 ? downloadButton(() => zip(done.map((i) => ({ name: i.name, data: i.blob }))), res.zipName || 'converted-files.zip', 'Download all (ZIP)', { size: 'lg' })
        : done.length === 1 ? downloadButton(done[0].blob, done[0].name, 'Download', { size: 'lg' }) : null)
    clear(resultEl, h('section', { class: 'mc-done', 'aria-label': 'Results' }, head,
      h('div', { class: 'mc-list' }, rows),
      done.length ? stats([{ label: 'Files', value: String(done.length), accent: true }, { label: 'Total size', value: formatBytes(total) }, ...(res.stats || [])]) : null, res.notes, actions))
    confetti(resultEl.querySelector('.mc-done'))
    resultEl.querySelector('.mc-done')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  async function showResult(res, seconds) {
    if (res.items) return showMulti(res, seconds)
    const kind = res.kind || kindOf(res.name)
    const url = URL.createObjectURL(res.blob)
    urls.push(url)
    const dur = res.duration !== undefined ? res.duration : kind === 'image' ? null : await mediaDuration(res.blob, kind)
    const eExt = (ext(res.name) || '').toUpperCase()
    const check = h('div', { class: 'mc-check', 'aria-hidden': 'true' },
      h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, h('path', { d: 'm5 12.5 4.5 4.5L19 7.5' })))
    const head = h('div', { class: 'mc-done-head' }, check,
      h('div', h('h3', res.title || 'All done'), h('p', res.summary || `${res.name} is ready. Finished in ${fmtTime(Math.max(1, seconds))}.`)))

    let cmp = null
    if (res.inputSize && res.compare !== false) {
      const max = Math.max(res.inputSize, res.blob.size)
      const change = pctChange(res.inputSize, res.blob.size)
      cmp = h('div', { class: 'mc-cmp', role: 'img', 'aria-label': `Original ${formatBytes(res.inputSize)}, new ${formatBytes(res.blob.size)}` },
        h('div', { class: 'mc-cmp-row' }, h('span', 'Original'), h('div', { class: 'mc-cmp-bar' }, h('i', { style: { '--w': `${(res.inputSize / max) * 100}%` } })), h('b', formatBytes(res.inputSize))),
        h('div', { class: 'mc-cmp-row new' }, h('span', 'New'), h('div', { class: 'mc-cmp-bar' }, h('i', { style: { '--w': `${Math.max(2, (res.blob.size / max) * 100)}%` } })),
          h('b', formatBytes(res.blob.size), ' ', h('span', { class: ['mc-delta', res.blob.size <= res.inputSize ? 'down' : 'up'] }, change))))
    }

    let prev
    if (kind === 'video') {
      const v = h('video', { src: url, controls: true, playsinline: true, preload: 'metadata' })
      v.addEventListener('error', () => prev.replaceChildren(noPreview('This format cannot be previewed in the browser, but the file is fine. Download it to play it.')))
      prev = h('div', { class: 'mc-view' }, v)
    } else if (kind === 'audio') {
      const a = h('audio', { src: url, preload: 'metadata' })
      a.addEventListener('error', () => prev.replaceChildren(noPreview('This format cannot be previewed in the browser, but the file is fine. Download it to play it.')))
      prev = h('div', { class: 'mc-view' }, audioPlayer(a, () => (Number.isFinite(a.duration) ? a.duration : dur)), a)
    } else prev = h('div', { class: 'mc-view' }, h('img', { src: url, alt: 'Result preview', style: 'max-width:100%;max-height:420px;display:block;margin:0 auto' }))

    const file = new File([res.blob], res.name, { type: res.blob.type })
    const canShare = typeof navigator.canShare === 'function' && (() => { try { return navigator.canShare({ files: [file] }) } catch { return false } })()
    const actions = h('div', { class: 'mc-actions' },
      downloadButton(res.blob, res.name, res.downloadLabel || `Download ${eExt || 'file'}`, { size: 'lg' }),
      canShare ? button('Share', { icon: 'share-2', variant: 'secondary', size: 'lg', onClick: () => navigator.share({ files: [file] }).catch(() => {}) }) : null,
      res.actions)

    const items = [
      { label: 'File size', value: formatBytes(res.blob.size), accent: true, hint: res.inputSize && res.compare !== false ? `${pctChange(res.inputSize, res.blob.size)} vs original` : null },
      dur != null ? { label: 'Duration', value: fmtTime(dur, dur < 10 ? 1 : 0) } : null,
      { label: 'Format', value: eExt || '-' },
      ...(res.stats || []),
    ].filter(Boolean)
    clear(resultEl, h('section', { class: 'mc-done', 'aria-label': 'Result' }, head, cmp, prev, stats(items), res.notes, actions))
    confetti(resultEl.querySelector('.mc-done'))
    resultEl.querySelector('.mc-done')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }

  sync()
  return api
}

// ---------- Shell for single-file tools ----------

export const ACCEPT = {
  video: 'video/*,.mkv,.avi,.mov,.m4v,.wmv,.flv,.3gp,.ts,.mts,.m2ts,.webm,.mp4',
  audio: 'audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.wma,.amr,.aif,.aiff',
}
export const TRUST = {
  video: [['shield-check', 'Stays on your device', 'Nothing is uploaded. Your video is processed inside this tab.'], ['download-cloud', 'One-time engine', 'A 31 MB engine downloads once, then your browser keeps it.'], ['zap', 'Fast when it can be', 'Streams are copied without re-encoding whenever that is possible.']],
  audio: [['shield-check', 'Stays on your device', 'Nothing is uploaded. Your audio is processed inside this tab.'], ['download-cloud', 'One-time engine', 'A 31 MB engine downloads once, then your browser keeps it.'], ['audio-lines', 'Videos work too', 'Drop a video and its soundtrack is used.']],
}

export function trustStrip(items) {
  return h('div', { class: 'mc-trust' }, items.map(([ic, t, d], i) => h('div', { style: { '--i': i } }, h('span', { class: 't-ic' }, icon(ic)), h('div', h('b', t), d))))
}

export function enginePill() {
  const label = h('span')
  const el = h('div', { class: 'mc-engine-pill', role: 'status' }, h('i', { class: 'dot' }), label)
  const off = onEngine((e) => {
    el.className = `mc-engine-pill ${e.state === 'ready' ? 'ready' : e.state === 'loading' ? 'loading' : ''}`
    label.textContent = e.state === 'ready' ? 'Video engine ready'
      : e.state === 'loading' ? (Number.isFinite(e.frac) ? `Getting the video engine ${Math.round(e.frac * 100)}%` : 'Getting the video engine')
        : e.state === 'error' ? 'Engine failed to load. Pick a file to retry.' : `The video engine (${ENGINE_MB} MB) downloads once when you pick a file`
  })
  onCleanup(off)
  return el
}

/**
 * createShell(root, {signal}, cfg) for tools that work on one file.
 * cfg: {kind: 'video'|'audio', require?: 'video'|'audio', accept?, dropLabel?, dropHint?, dropIcon?, trust?,
 *       action: {label, icon, busy}, stageExtra?(media, shell) -> Node, options?(media, shell) -> Node | Node[],
 *       execute(media, helpers, shell) -> result (see createRunner), onMedia?(media, shell)}
 * shell: {media, setInfo(strong, text), setEnabled(bool, why), setLabel(text), reset(), destroy()}
 */
export function createShell(root, { signal }, cfg) {
  injectStyles()
  const kind = cfg.kind || 'video'
  const wrap = h('div', { class: 'mc' })
  root.append(wrap)
  const st = { stage: null, runner: null, id: 0, offEngine: null }

  const zone = dropzone({
    accept: cfg.accept || ACCEPT[kind], icon: cfg.dropIcon || (kind === 'video' ? 'film' : 'audio-lines'),
    label: cfg.dropLabel || (kind === 'video' ? 'Drop a video here or click to choose' : 'Drop an audio file or click to choose'),
    hint: cfg.dropHint || (kind === 'video' ? 'MP4, MOV, MKV, WebM, AVI and more' : 'MP3, WAV, M4A, OGG, FLAC and more (videos work too)'),
    onFiles: ([f]) => load(f),
  })
  const pill = enginePill()
  const trust = trustStrip(cfg.trust || TRUST[kind])
  const work = h('div', { class: 'mc-over' })
  wrap.append(zone, h('div', { class: 'row', style: 'justify-content:center' }, pill), trust, work)

  const warmUp = () => { if (!saveData() && engine.state === 'idle') warm().catch(() => {}) }
  zone.addEventListener('pointerenter', warmUp, { once: true })
  zone.addEventListener('focus', warmUp, { once: true })
  wrap.addEventListener('dragenter', warmUp, { once: true })
  wrap.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() })
  wrap.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length || e.defaultPrevented) return
    e.preventDefault()
    zone._take(files)
  })

  const shell = {
    get media() { return st.stage?.media || null },
    setInfo: (a, b) => st.runner?.setInfo(a, b),
    setEnabled: (on, why) => st.runner?.setEnabled(on, why),
    setLabel: (t) => st.runner?.setLabel(t),
    reset,
    destroy,
  }

  function reset() {
    st.id++
    st.offEngine?.()
    st.offEngine = null
    st.runner?.destroy()
    st.stage?.destroy()
    st.runner = st.stage = null
    clear(work)
    zone.hidden = false
    pill.parentElement.hidden = false
    trust.hidden = false
  }

  async function load(file) {
    const id = ++st.id
    st.offEngine?.()
    st.runner?.destroy()
    st.stage?.destroy()
    st.runner = st.stage = null
    zone.hidden = true
    pill.parentElement.hidden = true
    trust.hidden = true
    const stage = createStage(file, { onChange: () => zone.open() })
    st.stage = stage
    clear(work, stage.el)
    if (file.size > MAX_INPUT_BYTES) {
      stage.setStatus(alert('error', h('strong', 'This file is too big for the browser. '), `The limit is about ${MAX_INPUT_BYTES / MB} MB and this file is ${formatBytes(file.size)}. Trim or compress it on your computer first.`))
      return
    }
    const sk = skeleton()
    work.append(sk)
    st.offEngine = onEngine((e) => { if (id === st.id && e.state === 'loading') stage.setStatus(engineBar(e)) })
    let info
    try {
      info = await inspect(file)
    } catch (e) {
      if (id !== st.id) return
      st.offEngine?.()
      sk.remove()
      stage.setStatus(alert('error', h('strong', 'Could not read this file. '), friendlyError(e)))
      return
    }
    if (id !== st.id) return
    st.offEngine?.()
    st.offEngine = null
    sk.remove()
    stage.setInfo(info)
    stage.setStatus()
    const warnings = []
    if (cfg.require === 'video' && !info.hasVideo) warnings.push(alert('error', h('strong', 'No video found. '), 'This file only has audio. Pick a video file, or use the audio tools.'))
    else if (cfg.require === 'audio' && !info.hasAudio) warnings.push(alert('error', h('strong', 'No sound found. '), 'This file has no audio track to use.'))
    if (warnings.length) { stage.setStatus(warnings); return }
    if (file.size > LARGE_FILE) {
      stage.setStatus(alert('warn', h('strong', 'Big file. '), `${formatBytes(file.size)} is large for a browser. It works, but it can be slow and may run out of memory. A shorter clip is safer.`))
    }
    const media = stage.media
    try {
      const extra = cfg.stageExtra?.(media, shell)
      if (extra) stage.extra.append(extra)
      const runner = createRunner({
        signal, label: cfg.action.label, icon: cfg.action.icon, busyLabel: cfg.action.busy,
        onBusy: (on) => stage.busy(on),
        onRun: (helpers) => cfg.execute(media, helpers, shell),
      })
      st.runner = runner
      const opts = cfg.options?.(media, shell)
      const optNodes = [opts].flat().filter(Boolean)
      if (optNodes.length) work.append(h('div', { class: 'mc-panel' }, optNodes))
      work.append(runner.el)
      cfg.onMedia?.(media, shell)
    } catch (e) {
      console.error(e)
      stage.setStatus(alert('error', h('strong', 'Something went wrong setting this file up. '), friendlyError(e)))
    }
  }

  function destroy() {
    st.id++
    st.offEngine?.()
    st.runner?.destroy()
    st.stage?.destroy()
  }
  signal?.addEventListener('abort', destroy, { once: true })
  return shell
}
