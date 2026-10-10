// Audio Studio: a multitrack audio editor in the browser. Record or import audio, edit clips on a timeline, mix with per-track
// effects, and export WAV or MP3. A clean-room take on the same category as the open-source SoundCraft by ArtCraft.
// Modules: _model (document + edit ops), _engine (WebAudio playback and offline render), _timeline (canvas view + pointer editing),
// _panels (toolbar, headers, inspector, dialogs), _io (decode + microphone), _export, _store (autosave + project files), _dsp (math).
import { h, icon, button, toast, modal, dropzone } from '../../lib/ui.js'
import { pickFiles, download, safeName } from '../../lib/files.js'
import { SR, fmtClock, fmtBars, dbToGain, peakOf, clamp } from './_dsp.js'
import {
  newProject, fixProject, newTrack, newClip, findClip, uid, projectLength, History, MAX_TRACKS, FX_PRESETS, clampClip,
  splitClip, splitRange, removeRange, extractRange, pasteItems, trimToRange, duplicateClip,
} from './_model.js'
import { Engine, isAudible } from './_engine.js'
import { Timeline } from './_timeline.js'
import { injectStyle } from './_style.js'
import { buildToolbar, buildRail, buildHeads, buildInspector, popMenu, closeMenu, exportDialog as openExport, newDialog, shortcutsDialog } from './_panels.js'
import { ACCEPT, decodeFile, decodeStored, startCapture, assetFromSamples } from './_io.js'
import { saveAuto, loadAuto, clearAuto, projectToZip, projectFromZip } from './_store.js'
import { demoSamples } from './_demo.js'

const PREFS = new Set(['snap', 'ripple', 'follow', 'trackH', 'metro', 'metroVol'])
const FLAGS = {
  bpm: 'tl resched save insp', beats: 'tl resched save insp', grid: 'tl save insp', snap: 'save insp', metro: 'resched save insp', metroVol: 'engine save',
  masterVol: 'engine save', ripple: 'save insp', follow: 'save insp', trackH: 'tl heads save insp', name: 'save insp',
}
const HINT = 'Drag in a track to select a range. Space plays, S splits, H shows all shortcuts.'
const LABELS = { vol: 'Track volume', pan: 'Track pan', mute: 'Mute track', solo: 'Solo track', name: 'Rename track', color: 'Track color' }

export async function mount(root, { tool, params = {}, signal }) {
  injectStyle()
  const ns = tool.id
  const hist = new History()
  const assets = new Map()
  const stored = new Set()
  const S = {
    project: newProject(params.template || 'blank'), assets, tool: 'select', playhead: 0, sel: { clips: new Set(), track: null, range: null },
    rec: null, armId: null, clockBars: false, playheadNow: () => (engine.playing ? engine.position() : S.playhead),
  }
  const engine = new Engine(() => S.project, () => S.assets)
  const rootEl = h('div', { class: 'as', tabindex: -1, role: 'application', 'aria-label': 'Audio Studio' })
  const app = { S, hist, engine, root: rootEl, clipboard: null, menu: null, lastExport: null, toast }
  rootEl.__as = app

  // ---------- Lookups ----------
  app.track = (id) => S.project.tracks.find((t) => t.id === id)
  app.findClip = (id) => findClip(S.project, id)
  app.isAudible = (t) => isAudible(S.project, t)
  app.focusRoot = () => { if (!rootEl.contains(document.activeElement)) rootEl.focus({ preventScroll: true }) }

  // ---------- Build the UI ----------
  const tl = new Timeline(app)
  app.tl = tl
  const toolbar = buildToolbar(app)
  const rail = buildRail(app)
  const heads = buildHeads(app)
  const insp = buildInspector(app)
  const statusSel = h('span', { class: 'sel' })
  const statusHint = h('span', { class: 'hint' }, HINT)
  const statusSave = h('span', { class: 'save', 'aria-live': 'polite' }, '')
  const statusEl = h('div', { class: 'as-status' }, statusSel, statusHint, h('span', { class: 'sp' }), statusSave, toolbar.zoom)
  const addTrackBtn = h('button', { type: 'button', class: 'add', onclick: () => addTrack() }, icon('plus'), h('span', 'Add track'))
  addTrackBtn.setAttribute('aria-label', 'Add track')
  tl.corner.append(addTrackBtn)
  const emptyZone = dropzone({ accept: ACCEPT, multiple: true, label: 'Drop audio or video files here', hint: 'MP3, WAV, M4A, FLAC, OGG, MP4... or click to browse', onFiles: (f) => importFiles(f), compact: true })
  const emptyHost = h('div', { class: 'as-empty' },
    h('h3', 'Start with some sound'),
    h('p', 'Import audio or video (its soundtrack is used), record with your microphone, or try a generated demo.'),
    emptyZone,
    h('div', { class: 'row' }, button('Record', { icon: 'mic', onClick: () => toggleRecord() }), button('Try the demo', { icon: 'audio-lines', onClick: () => loadDemo() })))
  tl.el.append(emptyHost)
  rootEl.append(toolbar.el, h('div', { class: 'as-main' }, rail.el, tl.el, insp.el), statusEl)
  if (matchMedia('(max-width: 760px)').matches) rootEl.classList.add('no-insp')
  const credit = h('p', { class: 'as-credit' }, 'Prefer a native app? ', h('a', { href: 'https://github.com/storytold/soundcraft', target: '_blank', rel: 'noopener' }, 'SoundCraft by ArtCraft'), ' is free and open source.')
  root.append(rootEl, credit)
  tl.resize()

  // ---------- Change pipeline ----------
  let reschedT = 0
  function changed(flags = '') {
    const f = new Set(flags.split(' ').filter(Boolean))
    if (f.has('tl')) tl.layout()
    if (f.has('heads')) heads.render()
    else heads.sync()
    if (f.has('insp')) insp.schedule()
    if (f.has('engine')) engine.syncMix()
    if (f.has('resched')) { clearTimeout(reschedT); reschedT = setTimeout(() => { engine.syncMix(); engine.refresh() }, 60) }
    if (f.has('save')) scheduleSave()
    toolbar.update()
    rail.update()
    updateStatus()
    updateEmpty()
  }
  function cleanSel() {
    const p = S.project
    S.sel.clips = new Set([...S.sel.clips].filter((id) => findClip(p, id)))
    if (S.sel.track && !app.track(S.sel.track)) S.sel.track = null
    if (S.armId && !app.track(S.armId)) S.armId = null
    if (S.sel.range) {
      S.sel.range.ids = S.sel.range.ids.filter((id) => app.track(id))
      if (!S.sel.range.ids.length) S.sel.range = null
    }
  }
  app.selectionChanged = (light) => {
    if (!light) { cleanSel(); heads.sync(); insp.schedule(); rail.update() }
    tl.invalidate()
    tl.updateOverlays()
    updateStatus()
  }
  function edit(label, fn, o = {}) {
    const before = JSON.stringify(S.project)
    fn(S.project)
    if (JSON.stringify(S.project) === before) return false
    hist.record(label, before, o.key)
    changed(o.flags ?? 'tl heads insp engine resched save')
    return true
  }
  app.beginGesture = () => {
    const before = JSON.stringify(S.project)
    return (label) => {
      if (JSON.stringify(S.project) === before) { changed('tl'); return false }
      hist.record(label, before)
      changed('tl heads insp engine resched save')
      return true
    }
  }
  function applySnapshot(json) {
    S.project = JSON.parse(json)
    cleanSel()
    changed('tl heads insp engine resched save')
    app.selectionChanged()
  }
  app.undo = () => { const e = hist.undo(JSON.stringify(S.project)); if (e) { applySnapshot(e.json); app.status(`Undid: ${e.label}`) } }
  app.redo = () => { const e = hist.redo(JSON.stringify(S.project)); if (e) { applySnapshot(e.json); app.status(`Redid: ${e.label}`) } }

  // ---------- Status, clock, empty state ----------
  let hintT = 0
  app.status = (text) => {
    clearTimeout(hintT)
    if (text) { statusHint.textContent = text; statusHint.style.display = 'inline'; hintT = setTimeout(() => app.status(''), 2500) } else { statusHint.textContent = HINT; statusHint.style.display = '' }
  }
  function updateStatus() {
    const r = S.sel.range
    const n = S.sel.clips.size
    statusSel.textContent = r ? `Range ${fmtClock(r.t0)} to ${fmtClock(r.t1)} (${(r.t1 - r.t0).toFixed(2)} s, ${r.ids.length} track${r.ids.length === 1 ? '' : 's'})`
      : n ? `${n} clip${n === 1 ? '' : 's'} selected` : `${S.project.tracks.length} track${S.project.tracks.length === 1 ? '' : 's'}, ${fmtClock(projectLength(S.project))} long`
  }
  function updateClock() {
    const t = S.playheadNow()
    toolbar.setClock(S.clockBars ? fmtBars(t, S.project.bpm, S.project.beats) : fmtClock(t), S.clockBars)
  }
  function updateEmpty() {
    const has = S.project.tracks.some((t) => t.clips.length)
    emptyHost.hidden = has || !!S.rec
  }
  app.toggleClockMode = () => { S.clockBars = !S.clockBars; updateClock(); tl.drawRuler() }
  const busyEl = h('div', { class: 'as-busy', role: 'status', hidden: true })
  rootEl.append(busyEl)
  function busyMsg(text) {
    const label = h('span', text)
    busyEl.replaceChildren(h('span', { class: 'spinner' }), label)
    busyEl.hidden = false
    return { set: (t, f) => { label.textContent = f != null && Number.isFinite(f) ? `${t} ${Math.round(f * 100)}%` : t }, done: () => { busyEl.hidden = true } }
  }
  const ago = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  // ---------- Autosave ----------
  let saveT = 0, saving = false, saveAgain = false
  function scheduleSave() {
    statusSave.textContent = 'Saving...'
    clearTimeout(saveT)
    saveT = setTimeout(saveNow, 1000)
  }
  async function saveNow() {
    clearTimeout(saveT)
    if (saving) { saveAgain = true; return }
    saving = true
    try {
      const ok = await saveAuto(ns, structuredClone(S.project), assets, stored)
      statusSave.textContent = ok ? `Saved ${ago()}` : 'Autosave is unavailable (storage blocked or full). Save a project file to keep your work.'
    } finally {
      saving = false
      if (saveAgain) { saveAgain = false; saveT = setTimeout(saveNow, 300) }
    }
  }

  // ---------- Frame loop (playhead, clock, meters) ----------
  let raf = 0
  function frame() {
    raf = 0
    const playing = engine.playing
    if (playing) tl.ensureWidth(S.playheadNow())
    tl.updateOverlays()
    updateClock()
    if (playing && S.project.follow) tl.scrollToTime(S.playheadNow())
    const lv = engine.levels()
    toolbar.meter.draw(lv)
    heads.meters()
    if (S.rec) tl.invalidate()
    if (playing || S.rec || lv[0] > 0.0004 || lv[1] > 0.0004) raf = requestAnimationFrame(frame)
    else toolbar.meter.draw([0, 0])
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame) }
  engine.endedCb = () => { S.playhead = engine.pos; toolbar.update(); tl.updateOverlays(); updateClock(); kick() }

  // ---------- Transport ----------
  app.setPlayhead = (t) => {
    t = Math.max(0, t)
    if (S.rec) return
    if (engine.playing) engine.seek(t)
    else { S.playhead = t; engine.pos = t }
    tl.updateOverlays()
    updateClock()
  }
  function play() {
    if (S.rec) return
    const p = S.project
    let from = S.playheadNow()
    const end = projectLength(p)
    if (!end && !p.metro) return toast('Nothing to play yet. Add or record some audio.')
    if (p.loop.on && p.loop.end > p.loop.start && from >= p.loop.end) from = p.loop.start
    else if (!p.loop.on && end > 0 && from >= end - 0.01) from = 0
    engine.play(from)
    S.playhead = from
    kick()
    toolbar.update()
  }
  function pause() {
    engine.pause()
    S.playhead = engine.pos
    toolbar.update()
    tl.updateOverlays()
    kick()
  }
  app.togglePlay = () => { if (S.rec) stopRecording(); else if (engine.playing) pause(); else play() }
  app.stop = () => {
    if (S.rec) return stopRecording()
    engine.stopAndReturn()
    S.playhead = engine.pos
    toolbar.update()
    tl.updateOverlays()
    updateClock()
    tl.scrollToTime(S.playhead)
    kick()
  }
  app.toStart = () => { app.setPlayhead(0); tl.scrollToTime(0) }
  app.toEnd = () => { app.setPlayhead(projectLength(S.project)); tl.scrollToTime(S.playheadNow(), 120) }
  app.toggleLoop = () => {
    const p = S.project
    if (!p.loop.on && !(p.loop.end - p.loop.start > 0.05)) {
      const r = S.sel.range
      const len = Math.max(2, Math.min(projectLength(p), 8))
      p.loop.start = r ? r.t0 : 0
      p.loop.end = r ? r.t1 : len
    } else if (!p.loop.on && S.sel.range) { p.loop.start = S.sel.range.t0; p.loop.end = S.sel.range.t1 }
    p.loop.on = !p.loop.on
    changed('tl resched save insp')
  }
  app.loopChanged = () => { toolbar.update() }
  app.toggleMetro = () => app.setProject('metro', !S.project.metro)
  app.setLoopPoint = (which) => {
    const p = S.project
    const t = S.playheadNow()
    if (which === 'start') { p.loop.start = t; if (p.loop.end <= t) p.loop.end = t + 4 } else { p.loop.end = t; if (p.loop.start >= t) p.loop.start = Math.max(0, t - 4) }
    p.loop.on = true
    changed('tl resched save insp')
  }

  // ---------- Recording ----------
  async function toggleRecord() {
    if (S.rec) return stopRecording()
    if (S.rec === 0) return
    S.rec = 0 // guard against double clicks while the permission prompt is open
    try {
      const ctx = engine.ensure()
      if (engine.playing) pause()
      let trackId = S.armId && app.track(S.armId) ? S.armId : S.sel.track && app.track(S.sel.track) ? S.sel.track : null
      if (!trackId) {
        if (S.project.tracks.length >= MAX_TRACKS) throw new Error(`A project can have up to ${MAX_TRACKS} tracks.`)
        edit('Add track', (p) => { const t = newTrack(`Audio ${p.tracks.length + 1}`, p.tracks.length); p.tracks.push(t); trackId = t.id })
      }
      const start = S.playhead
      const overdub = S.project.tracks.some((t) => t.clips.length && isAudible(S.project, t)) || S.project.metro
      const rec = { trackId, start, peaks: [], level: 0, cap: null, overdub, carryMin: 1, carryMax: -1, carryN: 0 }
      rec.cap = await startCapture(ctx, (chunk) => {
        let peak = 0
        for (let i = 0; i < chunk.length; i++) {
          const v = chunk[i]
          if (v < rec.carryMin) rec.carryMin = v
          if (v > rec.carryMax) rec.carryMax = v
          if (++rec.carryN >= SR / 100) { rec.peaks.push(rec.carryMin, rec.carryMax); rec.carryMin = 1; rec.carryMax = -1; rec.carryN = 0 }
          const a = v < 0 ? -v : v
          if (a > peak) peak = a
        }
        rec.level = peak
      })
      S.rec = rec
      S.sel.track = trackId
      engine.play(start, { recording: true })
      kick()
      changed('heads')
      toast(overdub ? 'Recording. Use headphones so the playback is not picked up by the microphone.' : 'Recording...')
    } catch (e) {
      S.rec = null
      toast(e.message || 'Could not start recording.', 'error')
      toolbar.update()
    }
  }
  async function stopRecording() {
    const rec = S.rec
    if (!rec) return
    S.rec = null
    const stopAt = engine.position()
    engine.pause()
    toolbar.update()
    const job = busyMsg('Finishing the recording')
    try {
      const { samples, sampleRate } = await rec.cap.stop()
      if (samples.length < sampleRate * 0.05) { toast('That recording was too short and was discarded.'); return }
      const n = S.project.tracks.reduce((k, t) => k + t.clips.filter((c) => c.name.startsWith('Take')).length, 0) + 1
      const asset = assetFromSamples(`Take ${n}`, samples, sampleRate)
      assets.set(asset.id, asset)
      const lat = rec.overdub ? (engine.ctx.baseLatency || 0) + (engine.ctx.outputLatency || 0) : 0
      const clip = newClip(asset, Math.max(0, rec.start - lat))
      if (rec.start - lat < 0) { clip.offset = lat - rec.start; clip.dur = Math.max(0.01, asset.duration - clip.offset) }
      edit('Record', (p) => { p.tracks.find((t) => t.id === rec.trackId)?.clips.push(clip) })
      S.sel.clips = new Set([clip.id])
      S.sel.range = null
      app.selectionChanged()
      S.playhead = Math.max(stopAt, rec.start + asset.duration)
      engine.pos = S.playhead
      tl.updateOverlays()
    } catch (e) {
      toast(e.message || 'The recording failed.', 'error')
    } finally {
      job.done()
      updateClock()
      changed('heads tl')
      kick()
    }
  }
  app.toggleRecord = toggleRecord

  // ---------- Tracks ----------
  function addTrack(name) {
    if (S.project.tracks.length >= MAX_TRACKS) return toast(`A project can have up to ${MAX_TRACKS} tracks.`, 'error')
    let id
    edit('Add track', (p) => { const t = newTrack(name || `Track ${p.tracks.length + 1}`, p.tracks.length); p.tracks.push(t); id = t.id })
    S.sel.track = id
    app.selectionChanged()
    return id
  }
  app.addTrack = addTrack
  app.removeTrack = (id) => {
    edit('Delete track', (p) => { p.tracks = p.tracks.filter((t) => t.id !== id) })
    app.selectionChanged()
  }
  app.moveTrack = (id, dir) => edit('Move track', (p) => {
    const i = p.tracks.findIndex((t) => t.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= p.tracks.length) return
    ;[p.tracks[i], p.tracks[j]] = [p.tracks[j], p.tracks[i]]
  })
  app.dupTrack = (id) => {
    if (S.project.tracks.length >= MAX_TRACKS) return toast(`A project can have up to ${MAX_TRACKS} tracks.`, 'error')
    edit('Duplicate track', (p) => {
      const i = p.tracks.findIndex((t) => t.id === id)
      if (i < 0) return
      const copy = structuredClone(p.tracks[i])
      copy.id = uid('t')
      copy.name = `${copy.name} copy`
      copy.clips.forEach((c) => { c.id = uid('c') })
      p.tracks.splice(i + 1, 0, copy)
      S.sel.track = copy.id
    })
    app.selectionChanged()
  }
  app.selectTrack = (id) => { S.sel.track = id; app.selectionChanged() }
  app.arm = (id) => { S.armId = S.armId === id ? null : id; heads.sync(); insp.schedule() }
  app.setTrack = (id, prop, value, o = {}) => edit(LABELS[prop] || 'Track', (p) => { const t = p.tracks.find((x) => x.id === id); if (t) t[prop] = value }, { key: o.key, flags: o.flags })
  app.setFx = (id, key, prop, value) => edit('Effect', (p) => { const t = p.tracks.find((x) => x.id === id); if (t) t.fx[key][prop] = value },
    { key: `fx${id}${key}${prop}`, flags: `engine save${key === 'gate' ? ' resched' : ''}${prop === 'on' ? ' resched' : ''}` })
  app.applyPreset = (id, name) => edit('Effect preset', (p) => { const t = p.tracks.find((x) => x.id === id); if (t) t.fx = FX_PRESETS[name]() }, { flags: 'engine resched save insp' })
  app.trackMenu = (id) => [
    { label: 'Duplicate track', icon: 'copy', onClick: () => app.dupTrack(id) },
    { label: 'Move up', icon: 'chevron-up', onClick: () => app.moveTrack(id, -1) },
    { label: 'Move down', icon: 'chevron-down', onClick: () => app.moveTrack(id, 1) },
    { label: 'Reset effects', icon: 'rotate-ccw', onClick: () => app.applyPreset(id, 'flat') },
    { sep: true },
    { label: 'Delete track', icon: 'trash-2', onClick: () => app.removeTrack(id) },
  ]
  app.setClips = (prop, value) => edit(`Clip ${prop}`, (p) => {
    for (const id of S.sel.clips) {
      const f = findClip(p, id)
      if (!f) continue
      if (prop === 'name') f.clip.name = value
      else { f.clip[prop] = prop === 'gain' ? clamp(value, 0, 4) : value; clampClip(f.clip, assets.get(f.clip.asset)?.duration) }
    }
  }, { key: `clip-${prop}`, flags: 'tl resched save' })
  app.setProject = (prop, value) => {
    const flags = FLAGS[prop] || 'save'
    if (PREFS.has(prop)) { S.project[prop] = value; changed(flags) } else edit(`Project ${prop}`, (p) => { p[prop] = value }, { key: `proj${prop}`, flags })
  }
  app.setTool = (t) => { S.tool = t; tl.setTool(t); rail.update(); tl.hover = null }
  app.showTab = (name) => { insp.show(name); if (rootEl.classList.contains('no-insp')) app.toggleInspector() }
  app.toggleInspector = () => { rootEl.classList.toggle('no-insp'); toolbar.update() }
  app.zoomChanged = () => {}

  // ---------- Editing ----------
  const selClips = () => [...S.sel.clips].map((id) => findClip(S.project, id)).filter(Boolean)
  app.splitAtClick = (ti, clip, t) => {
    if (!clip) return
    let made = null
    edit('Split clip', (p) => {
      const tr = p.tracks[ti]
      const c = tr?.clips.find((x) => x.id === clip.id)
      if (c) made = splitClip(tr, c, t)
    })
    if (made) { S.sel.clips = new Set([made.id]); app.selectionChanged() }
  }
  app.split = (all = false) => {
    if (!S.project.tracks.length) return
    if (S.sel.range) {
      const { t0, t1, ids } = S.sel.range
      const made = []
      edit('Split at selection', (p) => { for (const id of ids) { const tr = p.tracks.find((x) => x.id === id); if (tr) made.push(...splitRange(tr, t0, t1)) } })
      if (made.length) { S.sel.clips = new Set(made.map((c) => c.id)); app.selectionChanged() }
      return
    }
    const t = S.playheadNow()
    const made = []
    edit('Split', (p) => {
      for (const tr of p.tracks) {
        if (!all && !S.sel.clips.size && S.sel.track && tr.id !== S.sel.track) continue
        for (const c of [...tr.clips]) {
          if (!all && S.sel.clips.size && !S.sel.clips.has(c.id)) continue
          const r = splitClip(tr, c, t)
          if (r) made.push(r)
        }
      }
    })
    if (made.length) { S.sel.clips = new Set(made.map((c) => c.id)); app.selectionChanged() } else toast('Nothing to split here. Put the playhead inside a clip first.')
  }
  app.copy = () => {
    const p = S.project
    if (S.sel.range) {
      const { t0, t1, ids } = S.sel.range
      const idxs = ids.map((id) => p.tracks.findIndex((t) => t.id === id)).filter((i) => i >= 0).sort((a, b) => a - b)
      app.clipboard = { len: t1 - t0, tracks: idxs.map((i) => ({ ti: i - idxs[0], items: extractRange(p.tracks[i], t0, t1) })) }
    } else if (S.sel.clips.size) {
      const sel = selClips()
      const t0 = Math.min(...sel.map((f) => f.clip.start))
      const t1 = Math.max(...sel.map((f) => f.clip.start + f.clip.dur))
      const by = new Map()
      for (const f of sel) {
        const i = p.tracks.indexOf(f.track)
        if (!by.has(i)) by.set(i, [])
        by.get(i).push({ ...f.clip, id: undefined, start: f.clip.start - t0 })
      }
      const base = Math.min(...by.keys())
      app.clipboard = { len: t1 - t0, tracks: [...by].map(([i, items]) => ({ ti: i - base, items })) }
    } else { toast('Select a clip, or drag a range in a track, first.'); return false }
    rail.update()
    app.status('Copied')
    return true
  }
  app.del = () => {
    if (S.sel.range) {
      const { t0, t1, ids } = S.sel.range
      edit('Delete range', (p) => { for (const id of ids) { const tr = p.tracks.find((x) => x.id === id); if (tr) removeRange(tr, t0, t1, p.ripple) } })
      S.sel.range = null
      S.sel.clips = new Set()
      app.setPlayhead(t0)
      app.selectionChanged()
    } else if (S.sel.clips.size) {
      const ids = new Set(S.sel.clips)
      edit('Delete clips', (p) => { for (const tr of p.tracks) tr.clips = tr.clips.filter((c) => !ids.has(c.id)) })
      S.sel.clips = new Set()
      app.selectionChanged()
    }
  }
  app.cut = () => { if (app.copy()) app.del() }
  app.paste = () => {
    const cb = app.clipboard
    if (!cb) return toast('Nothing to paste. Copy or cut something first.')
    const t = S.playheadNow()
    const made = []
    edit('Paste', (p) => {
      if (!p.tracks.length) p.tracks.push(newTrack('Track 1', 0))
      let base = p.tracks.findIndex((x) => x.id === (S.sel.range?.ids[0] ?? S.sel.track))
      if (base < 0) base = 0
      for (const tc of cb.tracks) {
        while (base + tc.ti >= p.tracks.length && p.tracks.length < MAX_TRACKS) p.tracks.push(newTrack(`Track ${p.tracks.length + 1}`, p.tracks.length))
        made.push(...pasteItems(p.tracks[Math.min(base + tc.ti, p.tracks.length - 1)], tc.items, t))
      }
    })
    S.sel.clips = new Set(made.map((c) => c.id))
    S.sel.range = null
    app.setPlayhead(t + cb.len)
    app.selectionChanged()
  }
  app.trim = () => {
    const r = S.sel.range
    if (!r) return toast('Drag a range in a track first, then trim.')
    edit('Trim to selection', (p) => { for (const id of r.ids) { const tr = p.tracks.find((x) => x.id === id); if (tr) trimToRange(tr, r.t0, r.t1) } })
    app.selectionChanged()
  }
  app.duplicate = () => {
    if (!S.sel.clips.size) return
    const made = []
    edit('Duplicate clips', (p) => { for (const id of [...S.sel.clips]) { const f = findClip(p, id); if (f) made.push(duplicateClip(f.track, f.clip)) } })
    S.sel.clips = new Set(made.map((c) => c.id))
    app.selectionChanged()
  }
  app.selectAll = () => {
    S.sel.clips = new Set(S.project.tracks.flatMap((t) => t.clips.map((c) => c.id)))
    S.sel.range = null
    app.selectionChanged()
  }
  app.normalizeClips = () => {
    edit('Normalize clip', (p) => {
      for (const id of S.sel.clips) {
        const f = findClip(p, id)
        const a = f && assets.get(f.clip.asset)
        if (!a) continue
        const pk = peakOf(a, f.clip.offset, f.clip.dur)
        if (pk > 1e-4) f.clip.gain = Math.min(4, dbToGain(-1) / pk)
      }
    }, { flags: 'tl resched save insp' })
  }

  // ---------- Import, projects ----------
  async function importFiles(files) {
    files = (files || []).filter(Boolean)
    if (!files.length) return
    if (engine.playing) pause()
    const job = busyMsg(`Reading ${files[0].name}`)
    const added = []
    try {
      for (const [i, f] of files.entries()) {
        job.set(`Reading ${f.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''}`)
        try {
          const a = await decodeFile(f, { onStatus: (m, frac) => job.set(m || 'Converting', frac), signal })
          assets.set(a.id, a)
          added.push(a)
        } catch (e) { if (e?.code !== 'ABORT') toast(e.message || `Could not read ${f.name}.`, 'error') }
        if (signal.aborted) return
      }
    } finally { job.done() }
    if (!added.length) return
    const wasEmpty = !projectLength(S.project)
    const made = []
    edit('Import audio', (p) => {
      const t0 = S.playhead
      added.forEach((a, i) => {
        let tr = null
        const sel = p.tracks.find((t) => t.id === S.sel.track)
        if (added.length === 1 && sel && !sel.clips.length) tr = sel
        if (!tr && p.tracks.length < MAX_TRACKS) { tr = newTrack(a.name, p.tracks.length); p.tracks.push(tr) }
        if (!tr) tr = sel || p.tracks[0]
        if (tr.name.startsWith('Track ') || tr.name.startsWith('Audio ')) tr.name = a.name
        const c = newClip(a, t0)
        tr.clips.push(c)
        made.push(c)
        if (i === added.length - 1) S.sel.track = tr.id
      })
    })
    S.sel.clips = new Set(made.map((c) => c.id))
    S.sel.range = null
    app.selectionChanged()
    if (wasEmpty) tl.fit()
    toast(`Added ${added.length === 1 ? added[0].name : `${added.length} files`}`, 'success')
  }
  app.pickAudio = async () => importFiles(await pickFiles({ accept: ACCEPT, multiple: true }))

  async function resetProject(project, newAssets = []) {
    engine.halt()
    engine.playing = false
    S.rec?.cap?.cancel()
    S.rec = null
    S.project = project
    assets.clear()
    for (const a of newAssets) assets.set(a.id, a)
    stored.clear()
    hist.clear()
    S.sel = { clips: new Set(), track: null, range: null }
    S.armId = null
    S.playhead = 0
    engine.pos = 0
    engine.syncMix()
    changed('tl heads insp engine save')
    app.selectionChanged()
    updateClock()
    tl.scrollEl.scrollLeft = 0
    if (projectLength(project) > 0) tl.fit()
    else tl.setZoom(90)
  }
  const hasContent = () => S.project.tracks.some((t) => t.clips.length)
  app.newProject = async (tpl) => {
    await clearAuto(ns)
    await resetProject(newProject(tpl))
    toast('Started a new project', 'success')
  }
  app.projectMenu = () => [
    { label: 'New project...', icon: 'file-plus', onClick: () => newDialog(app) },
    { label: 'Open project file...', icon: 'folder-open', onClick: () => app.openFile() },
    { label: 'Save project file', icon: 'save', key: 'Ctrl+S', onClick: () => app.saveFile() },
    { sep: true },
    { label: 'Add audio or video...', icon: 'plus', key: 'Ctrl+I', onClick: () => app.pickAudio() },
    { label: 'Add an empty track', icon: 'list-plus', onClick: () => addTrack() },
    { label: 'Load a generated demo', icon: 'audio-lines', onClick: () => loadDemo() },
    { sep: true },
    { label: 'Export audio...', icon: 'download', key: 'Ctrl+E', onClick: () => app.exportDialog() },
    { sep: true },
    { label: 'Keyboard shortcuts', icon: 'keyboard', key: 'H', onClick: () => shortcutsDialog() },
  ]
  app.exportDialog = () => openExport(app)
  app.saveFile = async () => {
    if (!S.project.tracks.length) return toast('Nothing to save yet.')
    const job = busyMsg('Packing the project')
    try {
      const blob = await projectToZip(S.project, assets)
      download(blob, `${safeName(S.project.name)}.audiostudio.zip`)
      toast('Project file saved', 'success')
    } catch (e) { toast(e.message || 'Could not save the project file.', 'error') } finally { job.done() }
  }
  app.openFile = async () => {
    const [file] = await pickFiles({ accept: '.zip,application/zip' })
    if (!file) return
    const job = busyMsg('Opening the project')
    try {
      const doc = await projectFromZip(file)
      const loaded = []
      for (const [i, a] of doc.assets.entries()) { job.set(`Decoding audio ${i + 1} of ${doc.assets.length}`); loaded.push(await decodeStored(a)) }
      await resetProject(fixProject(doc.project), loaded)
      toast(`Opened ${file.name}`, 'success')
    } catch (e) { toast(e.message || 'Could not open that project file.', 'error') } finally { job.done() }
  }
  function confirmModal(title, text, label, onYes) {
    const m = modal({ title, body: h('p', text), actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button(label, { variant: 'primary', onClick: () => { m.close(); onYes() } })] })
  }
  function loadDemo() {
    if (hasContent()) return confirmModal('Replace this project?', 'The demo replaces your current project. Save a project file first if you want to keep it.', 'Load the demo', buildDemo)
    return buildDemo()
  }
  async function buildDemo() {
    const bpm = 100
    const loaded = demoSamples(bpm, 4).map((d) => assetFromSamples(d.name, d.samples, SR))
    const p = newProject('blank')
    p.name = 'Demo project'
    p.bpm = bpm
    p.grid = '1/4'
    loaded.forEach((a, i) => { const t = newTrack(a.name.replace('Demo ', ''), i); t.clips.push(newClip(a, 0)); if (i === 2) { t.vol = -8; t.fx.reverb = { on: true, decay: 2.4, mix: 0.3 } }; p.tracks.push(t) })
    await resetProject(p, loaded)
    S.sel.track = p.tracks[0].id
    app.selectionChanged()
  }

  // ---------- Keyboard ----------
  function onKey(e) {
    if (!rootEl.isConnected || e.defaultPrevented || document.querySelector('dialog[open]')) return
    const t = e.target
    if (t?.closest?.('input:not([type=range]), textarea, select, [contenteditable="true"]')) return
    const onBtn = !!t?.closest?.('button, a, [role="tab"], summary')
    if (t?.matches?.('input[type=range]') && /^(Arrow|Home$|End$|Page)/.test(e.key)) return // let sliders use their own keys
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key
    const lk = k.toLowerCase()
    const handled = () => { e.preventDefault(); e.stopPropagation() }
    if (ctrl) {
      if (lk === 'z') { handled(); e.shiftKey ? app.redo() : app.undo() } else if (lk === 'y') { handled(); app.redo() } else if (lk === 'x') { handled(); app.cut() } else if (lk === 'c') { handled(); app.copy() } else if (lk === 'v') { handled(); app.paste() }
      else if (lk === 'a') { handled(); app.selectAll() } else if (lk === 'd') { handled(); app.duplicate() } else if (lk === 't') { handled(); app.trim() } else if (lk === 's') { handled(); app.saveFile() }
      else if (lk === 'e') { handled(); app.exportDialog() } else if (lk === 'i') { handled(); app.pickAudio() } else if (k === '0') { handled(); tl.fit() } else if (k === '=' || k === '+') { handled(); tl.zoomBy(1.5) } else if (k === '-') { handled(); tl.zoomBy(1 / 1.5) }
      return
    }
    if (e.altKey) return
    if ((k === ' ' || k === 'Enter') && onBtn) return
    const step = (S.project.grid !== 'off' ? 60 / S.project.bpm : 0.5) * (e.shiftKey ? 10 : 1)
    switch (k) {
      case ' ': handled(); app.togglePlay(); break
      case 'Enter': handled(); app.stop(); break
      case 'Home': handled(); app.toStart(); break
      case 'End': handled(); app.toEnd(); break
      case 'Delete': case 'Backspace': handled(); app.del(); break
      case 'ArrowLeft': handled(); app.setPlayhead(S.playheadNow() - step); tl.scrollToTime(S.playheadNow(), 120); break
      case 'ArrowRight': handled(); app.setPlayhead(S.playheadNow() + step); tl.scrollToTime(S.playheadNow(), 120); break
      case 'ArrowUp': case 'ArrowDown': {
        const p = S.project
        const i = p.tracks.findIndex((x) => x.id === S.sel.track)
        const j = clamp((i < 0 ? 0 : i) + (k === 'ArrowDown' ? 1 : -1), 0, p.tracks.length - 1)
        if (p.tracks[j]) { handled(); app.selectTrack(p.tracks[j].id) }
        break
      }
      case 'Escape': S.sel.range = null; S.sel.clips = new Set(); app.selectionChanged(); closeMenu(app); break
      case '+': case '=': handled(); tl.zoomBy(1.5); break
      case '-': case '_': handled(); tl.zoomBy(1 / 1.5); break
      case '[': handled(); app.setLoopPoint('start'); break
      case ']': handled(); app.setLoopPoint('end'); break
      default:
        if (lk === 'r') { handled(); toggleRecord() } else if (lk === 'l') { handled(); app.toggleLoop() } else if (lk === 'k') { handled(); app.toggleMetro() } else if (lk === 'v') { handled(); app.setTool('select') }
        else if (lk === 't') { handled(); app.setTool('range') } else if (lk === 'b') { handled(); app.setTool('blade') } else if (lk === 's') { handled(); app.split(e.shiftKey) } else if (lk === 'n') { handled(); app.setProject('snap', !S.project.snap) }
        else if (lk === 'h') { handled(); shortcutsDialog() } else if (lk === 'f') { handled(); app.setProject('follow', !S.project.follow) } else if (lk === 'i') { handled(); app.toggleInspector() }
        else if (lk === 'z') { handled(); if (S.sel.range) tl.zoomToRange(S.sel.range.t0, S.sel.range.t1) }
        else if (lk === 'm' || lk === 'o') {
          const tr = app.track(S.sel.track)
          if (tr) { handled(); app.setTrack(tr.id, lk === 'm' ? 'mute' : 'solo', !tr[lk === 'm' ? 'mute' : 'solo'], { flags: 'tl engine save insp' }) }
        }
    }
  }
  document.addEventListener('keydown', onKey)
  const onKeyUp = (e) => { if (e.key === 'Alt') tl.noSnap = false }
  document.addEventListener('keyup', onKeyUp)
  const onHide = () => { saveNow() }
  window.addEventListener('pagehide', onHide)

  // ---------- Initial state ----------
  tl.setTool('select')
  changed('tl heads insp engine bar')
  updateClock()
  const saved = await loadAuto(ns).catch(() => null)
  if (signal.aborted) return cleanup
  if (saved?.project?.tracks?.length) {
    const job = busyMsg('Restoring your last project')
    try {
      const loaded = []
      for (const a of saved.assets) { try { loaded.push(await decodeStored(a)) } catch { toast(`Could not restore the audio "${a.name}".`, 'error') } }
      await resetProject(fixProject(saved.project), loaded)
      for (const a of loaded) stored.add(a.id)
      statusSave.textContent = `Restored from ${new Date(saved.savedAt || Date.now()).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
    } finally { job.done() }
  } else if (params.template && params.template !== 'blank') {
    S.sel.track = S.project.tracks[0]?.id || null
    if (params.template === 'voiceover') S.armId = S.sel.track
    changed('heads insp')
  }
  app.selectionChanged()
  return cleanup

  // ---------- Cleanup ----------
  function cleanup() {
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('pagehide', onHide)
    cancelAnimationFrame(raf)
    clearTimeout(reschedT)
    clearTimeout(hintT)
    closeMenu(app)
    S.rec?.cap?.cancel()
    S.rec = null
    if (hasContent() || S.project.tracks.length) saveNow()
    tl.destroy()
    engine.dispose()
  }
}
