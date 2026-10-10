// Video Studio: a multi-track video editor in the browser. Clean-room take on the category of the open-source native app
// FilmCraft by ArtCraft (https://github.com/storytold/filmcraft). Modules: _model (document + history), _media (library),
// _draw (compositor), _player (preview + audio), _timeline, _panels (media bin + inspector), _export, _style.
import { h, icon, button, toast, modal, debounce } from '../../lib/ui.js'
import { download, safeName, pickFiles, baseName } from '../../lib/files.js'
import * as idb from '../../lib/idb.js'
import {
  Doc, newProject, normalize, makeClip, clipById, trackById, projectDuration, trackEnd, freeStart, fits, removeClips, splitClip,
  trans, uid, clamp, ASPECTS, IMAGE_DUR, timecode, clipEnd, layersAt,
} from './_model.js'
import { MediaStore, buildProjectZip, readProjectZip } from './_media.js'
import { Player } from './_player.js'
import { layerBox } from './_draw.js'
import { createTimeline } from './_timeline.js'
import { createMediaPanel, createInspector } from './_panels.js'
import { openExport } from './_export.js'
import { iconBtn, popMenu, setOn, UiState } from './_kit.js'
import { injectStyle } from './_style.js'

const SHORTCUTS = [
  ['Space', 'Play or pause'], ['S', 'Split at the playhead'], ['C / V', 'Razor tool / Select tool'], ['Delete', 'Delete (ripple on by default)'], ['Shift+Delete', 'Delete the other way (leave a gap)'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'], ['Ctrl+C / X / V', 'Copy / Cut / Paste at the playhead'], ['Ctrl+D', 'Duplicate'], ['Ctrl+A', 'Select all clips'],
  ['Left / Right', 'Step one frame (Shift: one second)'], ['Home / End', 'Go to start / end'], ['+ / -', 'Zoom the timeline'], ['\\', 'Fit the project in view'], ['N', 'Toggle snapping'],
  ['T', 'Add a title'], ['Ctrl+E', 'Export'], ['Alt while dragging', 'Temporarily turn snapping off'], ['Ctrl+wheel', 'Zoom the timeline'],
]
const previewSize = (p) => { const k = Math.min(1, 1280 / Math.max(p.width, p.height)); return [Math.round(p.width * k), Math.round(p.height * k)] }

export async function mount(root, { tool, params = {}, signal }) {
  const removeStyle = injectStyle()
  const slot = tool.id
  const KEY = `vs:${slot}:project`
  const media = new MediaStore(slot)
  let project = newProject({ aspect: params.aspect })
  let restored = false
  const saved = await idb.get(KEY)
  if (signal.aborted) { removeStyle(); return () => {} }
  if (saved?.project) {
    project = normalize(saved.project)
    await media.restore(saved.media || [])
    restored = true
  } else if (params.template === 'titles') {
    project.clips.push(makeClip('title', 'T1', 0, 4, { text: 'Your title' }))
  }
  if (signal.aborted) { media.dispose(); removeStyle(); return () => {} }

  const doc = new Doc(project)
  const ui = new UiState()
  ui.dragMedia = null
  const sel = () => [...ui.sel].map((id) => clipById(doc.p, id)).filter(Boolean)
  let clipboard = null

  // ---------------------------------------------------------------- stage
  const base = h('canvas', { class: 'base', 'aria-label': 'Video preview' })
  const ov = h('canvas', { class: 'ov', 'aria-hidden': 'true' })
  const frame = h('div', { class: 'vs-frame' }, base, ov)
  const busyText = h('span')
  const busyChip = h('div', { class: 'vs-busy', hidden: true, role: 'status' }, h('span', { class: 'spinner' }), busyText)
  const showBusy = (text) => { busyChip.hidden = !text; if (text) busyText.textContent = text }
  const emptyEl = h('div', { class: 'vs-empty' },
    h('b', params.template === 'slideshow' ? 'Drop your photos here' : 'Start your video'),
    h('span', params.template === 'slideshow' ? 'They are laid out one after another with crossfades. Add music, titles and export as MP4.' : 'Import video, audio or images, then drag them onto the timeline.'),
    h('div', { class: 'row', style: 'justify-content:center' },
      button('Import media', { icon: 'upload', variant: 'primary', size: 'sm', onClick: () => pickAndImport() }),
      button('Add a title', { icon: 'type', variant: 'secondary', size: 'sm', onClick: () => actions.addTitle() })))
  const stage = h('div', { class: 'vs-stage' }, frame, emptyEl, busyChip)

  const player = new Player({ doc, media, canvas: base })
  player.onBusy = (b) => showBusy(b ? 'Preparing audio' : null)

  // ---------------------------------------------------------------- transport
  const tc = h('div', { class: 'vs-tc', 'aria-live': 'off' })
  const bPlay = iconBtn('play', 'Play', { pos: 't', shortcut: 'Space', variant: 'primary', size: 'sm', cls: 'vs-play', onClick: () => player.toggle() })
  const bMute = iconBtn('volume-2', 'Mute preview', { pos: 't', onClick: () => { player.setMuted(!player.muted); updateMute() } })
  const updateMute = () => { bMute.replaceChildren(icon(player.muted ? 'volume-x' : 'volume-2')); setOn(bMute, player.muted) }
  const transport = h('div', { class: 'vs-transport' },
    iconBtn('skip-back', 'Go to start', { pos: 't', shortcut: 'Home', onClick: () => seek(0) }),
    iconBtn('step-back', 'Back one frame', { pos: 't', shortcut: 'Left', onClick: () => seek(player.t - 1 / doc.p.fps) }),
    bPlay,
    iconBtn('step-forward', 'Forward one frame', { pos: 't', shortcut: 'Right', onClick: () => seek(player.t + 1 / doc.p.fps) }),
    iconBtn('skip-forward', 'Go to end', { pos: 't', shortcut: 'End', onClick: () => seek(projectDuration(doc.p)) }),
    tc, h('span', { class: 'vs-grow' }), bMute)
  const monitor = h('section', { class: 'vs-panel vs-mon', 'aria-label': 'Monitor' }, stage, transport)

  function seek(t) { player.seek(t); timeline.reveal() }
  function updateTc() {
    const fps = doc.p.fps
    tc.replaceChildren(timecode(player.t, fps), h('span', ` / ${timecode(projectDuration(doc.p), fps)}`))
  }

  // ---------------------------------------------------------------- panels and timeline
  const mediaPanel = createMediaPanel({ media, doc, ui, actions: lazy(() => actions) })
  const inspector = createInspector({ doc, ui, actions: lazy(() => actions), player })
  const timeline = createTimeline({ doc, media, player, ui, actions: lazy(() => actions) })
  function lazy(get) { return new Proxy({}, { get: (_, k) => (...a) => get()[k](...a) }) }

  // ---------------------------------------------------------------- toolbar
  const nameInput = h('input', {
    class: 'vs-name', value: doc.p.name, 'aria-label': 'Project name', maxlength: 80,
    oninput: (e) => doc.commit('Rename project', (p) => { p.name = e.target.value || 'Untitled project' }, { key: 'pname' }),
  })
  const status = h('span', { class: 'vs-status', role: 'status' }, h('i'), h('span', 'Saved'))
  const bUndo = iconBtn('undo-2', 'Undo', { shortcut: 'Ctrl+Z', onClick: () => actions.undo() })
  const bRedo = iconBtn('redo-2', 'Redo', { shortcut: 'Ctrl+Shift+Z', onClick: () => actions.redo() })
  const aspectSeg = h('div', { class: 'vs-seg', role: 'group', 'aria-label': 'Aspect ratio' }, Object.keys(ASPECTS).map((a) =>
    h('button', { type: 'button', dataset: { aspect: a }, onclick: () => actions.setAspect(a), 'aria-pressed': String(doc.p.aspect === a) }, a)))
  const bExport = button('Export', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => actions.openExport() })
  bExport.dataset.tip = 'Export video (Ctrl+E)'
  bExport.dataset.tipPos = 'l'
  const bTrans = iconBtn('blend', 'Transitions for the selected clip', { onClick: () => popMenu(bTrans, [
    { label: 'Crossfade in', icon: 'blend', onClick: () => actions.setTransition('tin', 'crossfade') },
    { label: 'Fade in from black', icon: 'sunrise', onClick: () => actions.setTransition('tin', 'black') },
    { label: 'Fade out', icon: 'sunset', onClick: () => actions.setTransition('tout', 'fade') },
    { label: 'Fade out to black', icon: 'moon', onClick: () => actions.setTransition('tout', 'black') },
    { label: 'Remove transitions', icon: 'x', onClick: () => { actions.setTransition('tin', 'none'); actions.setTransition('tout', 'none') } },
  ]) })
  const bar = h('div', { class: 'vs-bar', role: 'toolbar', 'aria-label': 'Editor toolbar' },
    nameInput,
    iconBtn('file-plus', 'New project', { onClick: () => actions.newProject() }),
    iconBtn('folder-open', 'Open a project file (.zip)', { onClick: () => actions.openProjectFile() }),
    iconBtn('save', 'Save the project as a file (.zip)', { shortcut: 'Ctrl+S', onClick: () => actions.saveProjectFile() }),
    h('i', { class: 'vs-sep' }), bUndo, bRedo, h('i', { class: 'vs-sep' }),
    iconBtn('upload', 'Import video, audio or images', { text: 'Import', variant: 'secondary', onClick: () => pickAndImport() }),
    iconBtn('type', 'Add a title at the playhead', { text: 'Title', variant: 'secondary', shortcut: 'T', onClick: () => actions.addTitle() }),
    h('i', { class: 'vs-sep' }),
    iconBtn('scissors', 'Split at the playhead', { shortcut: 'S', onClick: () => actions.split() }),
    iconBtn('copy', 'Duplicate', { shortcut: 'Ctrl+D', onClick: () => actions.duplicate() }),
    iconBtn('trash-2', 'Delete selected clips', { shortcut: 'Del', onClick: () => actions.deleteSel() }),
    bTrans,
    h('span', { class: 'vs-grow' }), aspectSeg, status,
    iconBtn('keyboard', 'Keyboard shortcuts', { shortcut: '?', pos: 'l', onClick: () => actions.showShortcuts() }), bExport)

  const showPanel = (v) => { vs.dataset.m = v; for (const b of mt.children) b.setAttribute('aria-pressed', String(b.dataset.v === v)) }
  const mt = h('div', { class: 'vs-seg', role: 'group', 'aria-label': 'Panel' }, [['media', 'Media'], ['inspector', 'Inspector']].map(([v, l]) =>
    h('button', { type: 'button', 'aria-pressed': String(v === 'media'), onclick: () => showPanel(v), dataset: { v } }, l)))
  const mtabs = h('div', { class: 'vs-mtabs' }, mt)

  const foot = h('div', { class: 'vs-foot' },
    h('span', 'Prefer a native app? ', h('a', { href: 'https://github.com/storytold/filmcraft', target: '_blank', rel: 'noopener' }, 'FilmCraft by ArtCraft'), ' is free and open source.'),
    h('span', 'Files stay on this device and the project autosaves in this browser. ', h('button', { type: 'button', onclick: () => actions.showShortcuts() }, 'Keyboard shortcuts')))

  const vs = h('div', { class: 'vs', dataset: { m: 'media', tool: 'select' } },
    bar,
    h('div', { class: 'vs-main' }, mediaPanel.el, monitor, inspector.el),
    timeline.el, mtabs, foot)
  root.append(vs)

  // ---------------------------------------------------------------- helpers
  // new video and image clips go to the lowest unlocked video track (V1), audio and titles to the first of their kind
  const pickTrackIn = (p, kind) => {
    const list = p.tracks.filter((t) => fits(kind, t.kind) && !t.locked)
    return kind === 'audio' || kind === 'title' ? list[0] : list.at(-1)
  }
  const pickTrack = (kind) => pickTrackIn(doc.p, kind)
  const mediaClip = (m, trackId, start, extra = {}) => {
    const dur = m.kind === 'image' ? (params.template === 'slideshow' ? 3 : IMAGE_DUR) : m.duration
    return makeClip(m.kind, trackId, start, dur, { mediaId: m.id, name: baseName(m.name), ...extra })
  }
  const aspectFor = (m) => { const r = m.width / m.height; return r > 1.2 ? '16:9' : r < 0.85 ? '9:16' : '1:1' }
  function setAspectIn(p, a) { p.aspect = a; [p.width, p.height] = ASPECTS[a] }

  async function pickAndImport() { importFiles(await pickFiles({ accept: 'video/*,audio/*,image/*', multiple: true })) }

  async function importFiles(files) {
    if (!files.length) return
    const added = []
    for (const f of files) {
      try { showBusy(`Importing ${f.name}`); added.push(await media.add(f)) } catch (e) { toast(`${f.name}: ${e.message || 'Could not import this file.'}`, 'error') }
    }
    showBusy(null)
    if (!added.length) return
    toast(`Added ${added.length} file${added.length > 1 ? 's' : ''} to the media bin`, 'success')
    if (doc.p.clips.length === 0 || params.template === 'slideshow') placeSequential(added)
  }

  function placeSequential(list) {
    const wasEmpty = doc.p.clips.length === 0
    const ids = []
    doc.commit('Add media to timeline', (p) => {
      const first = list.find((m) => m.kind !== 'audio')
      if (wasEmpty && first && !params.aspect && first.width && aspectFor(first) !== p.aspect) setAspectIn(p, aspectFor(first))
      for (const m of list) {
        const tr = pickTrackIn(p, m.kind)
        if (!tr) continue
        const start = trackEnd(p, tr.id)
        const c = mediaClip(m, tr.id, start)
        if (m.kind === 'image' && params.template === 'slideshow' && start > 0) c.tin = trans('crossfade', 0.6)
        p.clips.push(c)
        ids.push(c.id)
      }
    })
    ui.select(ids.slice(0, 1))
    seek(0)
    if (wasEmpty) timeline.fit()
  }

  // ---------------------------------------------------------------- actions
  const actions = {
    importFiles,
    undo() { const l = doc.undo(); if (l) toast(`Undid: ${l}`) },
    redo() { const l = doc.redo(); if (l) toast(`Redid: ${l}`) },
    syncName() {},
    fitTimeline() { timeline.fit() },
    showShortcuts() {
      modal({ title: 'Keyboard shortcuts', icon: 'keyboard', body: h('div', { class: 'vs-kbd' }, SHORTCUTS.flatMap(([k, d]) => [h('kbd', k), h('span', d)])) })
    },
    openExport() { openExport({ doc, media, player, signal }) },

    addMediaClip(mediaId, { trackId, start } = {}) {
      const m = media.get(mediaId)
      if (!m || m.status !== 'ok') return
      const given = trackId && trackById(doc.p, trackId)
      const tr = given && fits(m.kind, given.kind) && !given.locked ? given : pickTrack(m.kind)
      if (!tr) return toast('There is no unlocked track for this media. Add one with the Track button.', 'error')
      let created
      doc.commit('Add clip', (p) => {
        const c = mediaClip(m, tr.id, 0)
        c.start = freeStart(p, tr.id, start ?? player.t, c.dur)
        if (p.clips.length === 0 && m.kind !== 'audio' && !params.aspect && m.width && aspectFor(m) !== p.aspect) setAspectIn(p, aspectFor(m))
        p.clips.push(c)
        created = c
      })
      ui.select([created.id])
      seek(created.start)
    },

    removeMedia(id, inUse) {
      if (inUse) return toast('This file is used on the timeline. Delete its clips first.', 'error')
      media.remove(id)
    },

    addTitle(preset) {
      const tr = pickTrack('title')
      if (!tr) return toast('Add a titles track first.', 'error')
      let created
      doc.commit('Add title', (p) => {
        const c = makeClip('title', tr.id, 0, 4, { text: 'Your title', fadeIn: 0.4, fadeOut: 0.4, ...preset })
        c.start = freeStart(p, tr.id, player.t, c.dur)
        p.clips.push(c)
        created = c
      })
      ui.select([created.id])
      seek(created.start + Math.min(0.8, created.dur / 2)) // past the fade-in, so the new title is visible
    },

    split() {
      const t = player.t
      const under = doc.p.clips.filter((c) => t > c.start + 0.04 && t < clipEnd(c) - 0.04 && !trackById(doc.p, c.track)?.locked)
      const picked = sel().filter((c) => under.includes(c))
      const ids = (picked.length ? picked : under).map((c) => c.id)
      if (!ids.length) return toast('Move the playhead over a clip to split it.')
      const made = []
      doc.commit('Split clip', (p) => { for (const id of ids) { const n = splitClip(p, id, t); if (n) made.push(n) } })
      ui.select(made)
    },
    splitAt(id, t) {
      let n
      doc.commit('Split clip', (p) => { n = splitClip(p, id, t) })
      if (n) ui.select([n])
    },

    deleteSel({ ripple } = {}) {
      const list = sel().filter((c) => !trackById(doc.p, c.track)?.locked)
      if (!list.length) return
      const rip = ripple ?? ui.ripple
      doc.commit(rip ? 'Ripple delete' : 'Delete', (p) => removeClips(p, list.map((c) => c.id), rip))
      ui.select([])
    },

    duplicate() {
      const list = sel().filter((c) => !trackById(doc.p, c.track)?.locked)
      if (!list.length) return
      const made = []
      doc.commit('Duplicate', (p) => {
        for (const c of list) {
          const n = structuredClone(c)
          n.id = uid()
          n.start = freeStart(p, c.track, clipEnd(c), c.dur)
          p.clips.push(n)
          made.push(n.id)
        }
      })
      ui.select(made)
    },
    copy() {
      const list = sel()
      if (!list.length) return false
      clipboard = { clips: list.map((c) => structuredClone(c)), base: Math.min(...list.map((c) => c.start)) }
      toast(`Copied ${list.length} clip${list.length > 1 ? 's' : ''}`)
      return true
    },
    cut() { if (actions.copy()) actions.deleteSel() },
    paste() {
      if (!clipboard) return toast('Copy a clip first (Ctrl+C).')
      const made = []
      doc.commit('Paste', (p) => {
        for (const c of clipboard.clips) {
          const n = structuredClone(c)
          n.id = uid()
          const tr = trackById(p, n.track) && !trackById(p, n.track).locked ? n.track : p.tracks.find((t) => fits(n.kind, t.kind) && !t.locked)?.id
          if (!tr) continue
          n.track = tr
          n.start = freeStart(p, tr, player.t + (c.start - clipboard.base), n.dur)
          p.clips.push(n)
          made.push(n.id)
        }
      })
      ui.select(made)
    },

    async detachAudio() {
      const list = sel().filter((c) => c.kind === 'video')
      if (!list.length) return
      let any = false
      for (const c of list) { const buf = await media.ensureAudio(c.mediaId); if (buf) any = true }
      if (!any) return toast('That video has no audio to detach.')
      doc.commit('Detach audio', (p) => {
        for (const c of list) {
          const m = media.get(c.mediaId)
          if (!m?.hasAudio) continue
          let tr = p.tracks.filter((t) => t.kind === 'audio' && !t.locked).find((t) => freeStart(p, t.id, c.start, c.dur) === c.start)
          if (!tr) {
            tr = { id: uid('t'), kind: 'audio', name: `Audio ${p.tracks.filter((t) => t.kind === 'audio').length + 1}` }
            p.tracks.push(tr)
          }
          p.clips.push(makeClip('audio', tr.id, c.start, c.dur, { mediaId: c.mediaId, in: c.in, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut, name: `${c.name} (audio)` }))
          c.volume = 0
        }
      })
    },

    setTransition(side, type) {
      const list = sel().filter((c) => c.kind === 'video' || c.kind === 'image')
      if (!list.length) return toast('Select a video or image clip first.')
      const ids = new Set(list.map((c) => c.id))
      doc.commit('Set transition', (p) => { for (const c of p.clips) if (ids.has(c.id)) c[side] = trans(type, c[side].dur || 0.5) })
    },

    setAspect(a) { if (a !== doc.p.aspect) doc.commit('Change aspect ratio', (p) => setAspectIn(p, a)) },

    toggleTrack(id, key) { doc.commit(`Toggle track ${key}`, (p) => { const t = trackById(p, id); if (t) t[key] = !t[key] }) },
    addTrack(kind) {
      doc.commit('Add track', (p) => {
        const n = p.tracks.filter((t) => t.kind === kind).length + 1
        const t = { id: uid('t'), kind, name: kind === 'video' ? `Video ${n}` : kind === 'audio' ? `Audio ${n}` : `Titles ${n}` }
        if (kind === 'audio') p.tracks.push(t)
        else if (kind === 'title') p.tracks.unshift(t)
        else p.tracks.splice(Math.max(0, p.tracks.findIndex((x) => x.kind === 'video')), 0, t)
      })
    },
    removeTrack(id) { doc.commit('Remove track', (p) => { if (!p.clips.some((c) => c.track === id)) p.tracks = p.tracks.filter((t) => t.id !== id) }) },

    async newProject() {
      if (doc.p.clips.length && !(await confirmBox('Start a new project?', 'The current project and its imported files will be removed from this browser. Save a project file first if you want to keep it.', 'Start new'))) return
      resetTo(newProject({ aspect: params.aspect }), null)
    },
    async openProjectFile() {
      const [file] = await pickFiles({ accept: '.zip,application/zip' })
      if (!file) return
      try {
        showBusy('Opening project')
        const data = await readProjectZip(file)
        if (doc.p.clips.length && !(await confirmBox('Open this project?', 'It replaces the current project in this browser.', 'Open'))) return
        resetTo(normalize(data.project), data)
      } catch (e) {
        toast(e.message || 'Could not open that project.', 'error')
      } finally { showBusy(null) }
    },
    async saveProjectFile() {
      try {
        showBusy('Packing project')
        const blob = await buildProjectZip(doc.p, media)
        download(blob, `${safeName(doc.p.name)}.zip`)
        toast('Project file saved', 'success')
      } catch (e) { toast(e.message || 'Could not save the project file.', 'error') } finally { showBusy(null) }
    },
  }

  async function resetTo(project, data) {
    player.pause()
    media.clear()
    if (data) await media.restore(data.media, data.blobs)
    ui.select([])
    doc.reset(project)
    player.seek(0)
    timeline.fit()
    save()
  }

  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      let done = false
      const ok = button(okLabel, { variant: 'primary' })
      const cancel = button('Cancel')
      const m = modal({ title, body: h('div', { class: 'vs-confirm' }, h('p', text)), actions: [cancel, ok], onClose: () => { if (!done) resolve(false) } })
      ok.addEventListener('click', () => { done = true; resolve(true); m.close() })
      cancel.addEventListener('click', () => m.close())
    })
  }

  // ---------------------------------------------------------------- autosave
  const setStatus = (s) => { status.classList.toggle('saving', s === 'saving'); status.lastChild.textContent = s === 'saving' ? 'Saving' : s === 'error' ? 'Not saved' : 'Saved' }
  async function saveNow() {
    const ok = await idb.set(KEY, { project: structuredClone(doc.p), media: media.metas(), savedAt: Date.now() })
    setStatus(ok ? 'saved' : 'error')
  }
  const saveSoon = debounce(saveNow, 700)
  function save() { setStatus('saving'); saveSoon() }
  media.onPersistFail = (m) => toast(`Could not keep ${m.name} for autosave (storage is full or blocked). It will not come back after a reload.`, 'error')

  // ---------------------------------------------------------------- monitor: frame size, overlay, direct manipulation
  let lastDims = ''
  function applyAspect() {
    const p = doc.p
    const [W, H] = previewSize(p)
    if (lastDims !== `${W}x${H}`) { lastDims = `${W}x${H}`; ov.width = W; ov.height = H; player.resize(W, H) }
    stage.style.setProperty('--ar', String(Math.max(0.7, p.width / p.height)))
    fitFrame()
    for (const b of aspectSeg.children) b.setAttribute('aria-pressed', String(b.dataset.aspect === p.aspect))
  }
  function fitFrame() {
    const r = stage.getBoundingClientRect()
    const p = doc.p
    const k = Math.min(Math.max(40, r.width - 24) / p.width, Math.max(40, r.height - 24) / p.height)
    frame.style.width = `${Math.floor(p.width * k)}px`
    frame.style.height = `${Math.floor(p.height * k)}px`
  }
  const stageRO = new ResizeObserver(fitFrame)
  stageRO.observe(stage)

  const accent = () => getComputedStyle(vs).getPropertyValue('--accent').trim() || '#5b4cf0'
  player.onRender = (layers) => {
    const g = ov.getContext('2d')
    g.clearRect(0, 0, ov.width, ov.height)
    if (player.playing) return
    for (const L of layers) {
      if (L.ghost || !ui.sel.has(L.clip.id)) continue
      const b = layerBox(g, ov.width, ov.height, L.clip, L.clip.kind === 'title' ? null : player.fr.source(L))
      g.save()
      g.translate(b.cx, b.cy)
      g.rotate((b.rot * Math.PI) / 180)
      g.strokeStyle = accent()
      g.lineWidth = Math.max(2, ov.width / 360)
      g.setLineDash([ov.width / 90, ov.width / 140])
      g.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h)
      g.restore()
    }
  }

  let mdrag = null
  function hitTest(px, py) {
    const g = ov.getContext('2d')
    for (const L of layersAt(doc.p, player.t).filter((l) => !l.ghost).reverse()) {
      const b = layerBox(g, ov.width, ov.height, L.clip, L.clip.kind === 'title' ? null : player.fr.source(L))
      const a = (-b.rot * Math.PI) / 180
      const dx = px - b.cx, dy = py - b.cy
      if (Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= b.w / 2 && Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= b.h / 2) return L.clip
    }
    return null
  }
  base.addEventListener('pointerdown', (e) => {
    if (player.playing || e.button !== 0) return
    const r = frame.getBoundingClientRect()
    const hit = hitTest(((e.clientX - r.left) / r.width) * ov.width, ((e.clientY - r.top) / r.height) * ov.height)
    if (!hit) return ui.select([])
    if (!ui.sel.has(hit.id)) ui.select([hit.id])
    if (trackById(doc.p, hit.track)?.locked) return
    mdrag = { id: hit.id, x0: e.clientX, y0: e.clientY, ox: hit.x, oy: hit.y, snap: doc.snapshot(), moved: false, w: r.width, h: r.height }
    base.setPointerCapture(e.pointerId)
    frame.classList.add('drag')
  })
  base.addEventListener('pointermove', (e) => {
    if (!mdrag) return
    const dx = e.clientX - mdrag.x0, dy = e.clientY - mdrag.y0
    if (!mdrag.moved && Math.hypot(dx, dy) < 3) return
    mdrag.moved = true
    const c = clipById(doc.p, mdrag.id)
    if (!c) return
    c.x = clamp(Math.round((mdrag.ox + (dx / mdrag.w) * 100) * 10) / 10, -150, 150)
    c.y = clamp(Math.round((mdrag.oy + (dy / mdrag.h) * 100) * 10) / 10, -150, 150)
    doc.emit('live')
  })
  const endMDrag = () => {
    frame.classList.remove('drag')
    if (!mdrag) return
    const d = mdrag
    mdrag = null
    if (d.moved) { doc.pushUndo('Move in frame', d.snap); doc.emit('change') }
  }
  base.addEventListener('pointerup', endMDrag)
  base.addEventListener('pointercancel', endMDrag)

  // ---------------------------------------------------------------- wiring
  player.onPlay = (on) => {
    bPlay.replaceChildren(icon(on ? 'pause' : 'play'))
    bPlay.dataset.tip = `${on ? 'Pause' : 'Play'} (Space)`
    bPlay.setAttribute('aria-label', on ? 'Pause' : 'Play')
    if (!on) timeline.placePlayhead()
  }
  player.onTime = () => { updateTc(); timeline.placePlayhead(); if (player.playing) timeline.reveal() }

  function afterChange(kind) {
    if (kind === 'live') return
    const p = doc.p
    const keep = [...ui.sel].filter((id) => clipById(p, id))
    if (keep.length !== ui.sel.size) ui.select(keep) // only when something vanished: a selection event rebuilds the inspector
    if (nameInput.value !== p.name && document.activeElement !== nameInput) nameInput.value = p.name
    applyAspect()
    bUndo.disabled = !doc.canUndo
    bRedo.disabled = !doc.canRedo
    bUndo.dataset.tip = doc.canUndo ? `Undo: ${doc.undoStack.at(-1).label} (Ctrl+Z)` : 'Undo (Ctrl+Z)'
    bRedo.dataset.tip = doc.canRedo ? `Redo: ${doc.redoStack.at(-1).label} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)'
    emptyEl.hidden = p.clips.length > 0
    if (player.t > projectDuration(p)) player.seek(projectDuration(p))
    updateTc()
    if (kind !== 'init') save()
  }
  const offDoc = doc.on(afterChange)
  const offMedia = media.on(() => { if (media.list().length) save() })
  const offUi = ui.on((patch) => {
    if ('sel' in patch) {
      player.requestRender()
      if (ui.sel.size && matchMedia('(max-width: 860px)').matches) showPanel('inspector') // phones: show the clip's settings
    }
    if ('tool' in patch) vs.dataset.tool = ui.tool
  })

  // Text fields keep their keys; sliders, checkboxes and buttons let the editor shortcuts through (arrows still move a slider).
  const typing = (t) => t.closest?.('textarea, select, [contenteditable="true"]') || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button'].includes(t.type))
  function onKey(e) {
    if (!vs.isConnected || document.querySelector('dialog[open]') || typing(e.target)) return
    if (e.target.type === 'range' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    const fps = doc.p.fps
    if (k === ' ') { e.preventDefault(); if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); player.toggle() }
    else if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? actions.redo() : actions.undo() }
    else if (mod && k.toLowerCase() === 'y') { e.preventDefault(); actions.redo() }
    else if (mod && k.toLowerCase() === 'a') { e.preventDefault(); ui.select(doc.p.clips.filter((c) => !trackById(doc.p, c.track)?.locked).map((c) => c.id)) }
    else if (mod && k.toLowerCase() === 'c') { if (sel().length) { e.preventDefault(); actions.copy() } }
    else if (mod && k.toLowerCase() === 'x') { if (sel().length) { e.preventDefault(); actions.cut() } }
    else if (mod && k.toLowerCase() === 'v') { if (clipboard) { e.preventDefault(); actions.paste() } }
    else if (mod && k.toLowerCase() === 'd') { e.preventDefault(); actions.duplicate() }
    else if (mod && k.toLowerCase() === 'e') { e.preventDefault(); actions.openExport() }
    else if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveNow(); toast('Autosaved in this browser. Use Save (disk icon) for a project file.') }
    else if (mod) return
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); actions.deleteSel({ ripple: e.shiftKey ? !ui.ripple : ui.ripple }) }
    else if (k === 's' || k === 'S') actions.split()
    else if (k === 'c' || k === 'C') ui.set({ tool: 'razor' })
    else if (k === 'v' || k === 'V') ui.set({ tool: 'select' })
    else if (k === 'n' || k === 'N') ui.set({ snap: !ui.snap })
    else if (k === 't' || k === 'T') actions.addTitle()
    else if (k === 'ArrowLeft') { e.preventDefault(); seek(player.t - (e.shiftKey ? 1 : 1 / fps)) }
    else if (k === 'ArrowRight') { e.preventDefault(); seek(player.t + (e.shiftKey ? 1 : 1 / fps)) }
    else if (k === 'Home') { e.preventDefault(); seek(0) }
    else if (k === 'End') { e.preventDefault(); seek(projectDuration(doc.p)) }
    else if (k === '+' || k === '=') timeline.setZoom(ui.pps * 1.4)
    else if (k === '-' || k === '_') timeline.setZoom(ui.pps / 1.4)
    else if (k === '\\') timeline.fit()
    else if (k === 'Escape') { if (ui.tool !== 'select') ui.set({ tool: 'select' }); else ui.select([]) }
    else if (k === '?') actions.showShortcuts()
  }
  document.addEventListener('keydown', onKey)

  vs.__vs = { doc, ui, media, player, actions, timeline }
  afterChange('init')
  setStatus('saved')
  updateMute()
  timeline.fit()
  if (restored && doc.p.clips.length) timeline.fit()
  player.requestRender()

  const cleanup = () => {
    document.removeEventListener('keydown', onKey)
    document.querySelectorAll('.vs-menu').forEach((m) => m.remove())
    offDoc(); offMedia(); offUi()
    stageRO.disconnect()
    timeline.destroy(); mediaPanel.destroy(); inspector.destroy()
    saveNow()
    player.destroy()
    media.dispose()
    removeStyle()
  }
  return cleanup
}
