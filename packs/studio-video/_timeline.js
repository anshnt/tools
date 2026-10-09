// Timeline: ruler, tracks, clips, playhead, snapping, trimming, zoom. Plain DOM, one lane per track.
// Clips are reconciled by id, so dragging only touches style.left/top and never rebuilds filmstrips.
import { h } from '../../lib/ui.js'
import { clipById, trackById, clipsOn, projectDuration, snapPoints, snapTime, freeStart, fits, MIN_DUR, EPS, clamp, clipEnd } from './_model.js'
import { iconBtn, popMenu, setOn, fmtClock } from './_kit.js'
import { dataUrlToBlobUrl } from './_media.js'

export const LANE_H = { video: 56, title: 34, audio: 46 }
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
export const MIN_PPS = 3
export const MAX_PPS = 800

export function createTimeline({ doc, media, player, ui, actions }) {
  let HEAD = 132
  const cache = new Map()
  const laneEls = new Map()
  const rowRecs = []
  let rowSig = ''
  let rulerSig = ''
  let drag = null
  let scrub = false

  const phl = h('div', { class: 'vs-phl' })
  const phh = h('div', { class: 'vs-phh' })
  const snapEl = h('div', { class: 'vs-snap' })
  const ruler = h('div', { class: 'vs-ruler', 'aria-label': 'Timeline ruler. Click or drag to move the playhead.' }, phh)
  const corner = h('div', { class: 'vs-corner' }, 'Tracks')
  const rowsEl = h('div', { class: 'vs-rows' })
  const inner = h('div', { class: 'vs-inner' }, h('div', { class: 'vs-rulerrow' }, corner, ruler), rowsEl, phl, snapEl)
  const scroll = h('div', { class: 'vs-scroll', tabindex: 0, 'aria-label': 'Timeline' }, inner)

  // ---- rail and bar
  const bSelect = iconBtn('mouse-pointer-2', 'Select', { pos: 'r', shortcut: 'V', onClick: () => ui.set({ tool: 'select' }) })
  const bRazor = iconBtn('scissors', 'Razor: click a clip to cut it', { pos: 'r', shortcut: 'C', onClick: () => ui.set({ tool: 'razor' }) })
  const bSnap = iconBtn('magnet', 'Snapping', { pos: 'r', shortcut: 'N', onClick: () => ui.set({ snap: !ui.snap }) })
  const bRipple = iconBtn('fold-horizontal', 'Ripple delete: close the gap', { pos: 'r', shortcut: 'Shift+Del flips', onClick: () => ui.set({ ripple: !ui.ripple }) })
  const rail = h('div', { class: 'vs-rail' }, bSelect, bRazor, h('i', { class: 'vs-sep' }), bSnap, bRipple)

  const zoomIn = iconBtn('zoom-in', 'Zoom in', { pos: 'b', shortcut: '+', onClick: () => setZoom(ui.pps * 1.4) })
  const zoomOut = iconBtn('zoom-out', 'Zoom out', { pos: 'b', shortcut: '-', onClick: () => setZoom(ui.pps / 1.4) })
  const zoomFit = iconBtn('maximize-2', 'Fit project in view', { pos: 'b', shortcut: '\\', onClick: () => fit() })
  const zoomRange = h('input', {
    type: 'range', min: 0, max: 100, step: 1, 'aria-label': 'Timeline zoom',
    oninput: (e) => setZoom(MIN_PPS * (MAX_PPS / MIN_PPS) ** (e.target.valueAsNumber / 100)),
  })
  const addTrack = iconBtn('plus', 'Add a track', { pos: 'b', text: 'Track', onClick: () => popMenu(addTrack, [
    { label: 'Video track', icon: 'film', onClick: () => actions.addTrack('video') },
    { label: 'Audio track', icon: 'music', onClick: () => actions.addTrack('audio') },
    { label: 'Titles track', icon: 'type', onClick: () => actions.addTrack('title') },
  ]) })
  const clock = h('span', { class: 'vs-tc', style: 'padding:0 6px' })
  const bar = h('div', { class: 'vs-tlbar' }, addTrack, h('span', { class: 'vs-grow' }), clock, zoomOut, zoomRange, zoomIn, zoomFit)
  const el = h('section', { class: 'vs-panel vs-tl', 'aria-label': 'Timeline panel' }, rail, h('div', { class: 'vs-tlm' }, bar, scroll))

  // ---- geometry
  const rulerLeft = () => ruler.getBoundingClientRect().left
  const timeAt = (clientX) => (clientX - rulerLeft()) / ui.pps
  const frame = (t) => Math.round(t * doc.p.fps) / doc.p.fps

  function setZoom(pps, anchorX) {
    pps = clamp(pps, MIN_PPS, MAX_PPS)
    const t = anchorX === undefined ? player.t : timeAt(anchorX)
    const screenX = anchorX === undefined ? rulerLeft() + player.t * ui.pps : anchorX
    ui.set({ pps })
    scroll.scrollLeft += rulerLeft() + t * pps - screenX
  }
  function fit() {
    const dur = Math.max(projectDuration(doc.p), 5)
    ui.set({ pps: clamp((scroll.clientWidth - HEAD - 28) / dur, MIN_PPS, MAX_PPS) })
    scroll.scrollLeft = 0
  }
  function reveal() {
    const x = HEAD + player.t * ui.pps
    if (x > scroll.scrollLeft + scroll.clientWidth - 30) scroll.scrollLeft = x - HEAD - 80
    else if (x < scroll.scrollLeft + HEAD + 4) scroll.scrollLeft = Math.max(0, x - HEAD - 80)
  }

  // ---- rows
  function buildRows() {
    laneEls.clear()
    rowRecs.length = 0
    const p = doc.p
    rowsEl.replaceChildren(...p.tracks.map((t) => {
      const lane = h('div', { class: 'vs-lane', dataset: { track: t.id } })
      laneEls.set(t.id, lane)
      const same = p.tracks.filter((x) => x.kind === t.kind).length
      const empty = !p.clips.some((c) => c.track === t.id)
      const eye = (t.kind === 'video' || t.kind === 'title') && iconBtn(t.hidden ? 'eye-off' : 'eye', t.hidden ? 'Show track' : 'Hide track', { pos: 'r', onClick: () => actions.toggleTrack(t.id, 'hidden'), cls: t.hidden ? 'off' : null })
      const spk = (t.kind === 'video' || t.kind === 'audio') && iconBtn(t.muted ? 'volume-x' : 'volume-2', t.muted ? 'Unmute track' : 'Mute track', { pos: 'r', onClick: () => actions.toggleTrack(t.id, 'muted'), cls: t.muted ? 'off' : null })
      const lock = iconBtn(t.locked ? 'lock' : 'lock-open', t.locked ? 'Unlock track' : 'Lock track', { pos: 'r', onClick: () => actions.toggleTrack(t.id, 'locked'), cls: t.locked ? 'off' : null })
      const del = empty && same > 1 && iconBtn('x', 'Remove empty track', { pos: 'r', onClick: () => actions.removeTrack(t.id), cls: 'rm' })
      const head = h('div', { class: 'vs-head' }, h('b', { title: t.name }, t.name), eye, spk, lock, del)
      const row = h('div', { class: ['vs-row', t.locked && 'locked'], dataset: { kind: t.kind, id: t.id }, style: { height: `${LANE_H[t.kind]}px` } }, head, lane)
      rowRecs.push({ id: t.id, kind: t.kind, locked: !!t.locked, el: row })
      return row
    }))
  }

  // ---- ruler
  function drawRuler(len) {
    const pps = ui.pps
    const step = STEPS.find((s) => s * pps >= 84) || 3600
    const key = `${step}|${pps}|${Math.ceil(len)}`
    if (key === rulerSig) return
    rulerSig = key
    ruler.style.backgroundImage = 'linear-gradient(90deg, var(--border-strong) 1px, transparent 1px)'
    ruler.style.backgroundSize = `${(step * pps) / 5}px 8px`
    ruler.style.backgroundPosition = '0 100%'
    ruler.style.backgroundRepeat = 'repeat-x'
    ruler.replaceChildren(phh)
    for (let t = 0; t <= len; t += step) ruler.append(h('span', { class: 'vs-tick', style: { left: `${t * pps}px` } }, fmtClock(t, step < 1 ? 2 : 0)))
  }

  // ---- clips
  const laneHeight = (trackId) => LANE_H[trackById(doc.p, trackId)?.kind] || 54
  function fill(clipEl, c, m, w) {
    const th = laneHeight(c.track) - 8
    const missing = c.kind !== 'title' && (!m || m.status !== 'ok')
    clipEl.classList.toggle('missing', missing)
    const kids = []
    const pps = ui.pps
    if (c.kind === 'video' && m?.strip) {
      const src = (m._stripUrl ??= dataUrlToBlobUrl(m.strip))
      const n = clamp(m.stripN || 1, 1, 64)
      const tw = Math.max(28, Math.round(th * ((m.width || 16) / (m.height || 9))))
      const count = Math.min(240, Math.max(1, Math.ceil(w / tw)))
      const sw = w / count
      const film = h('div', { class: 'vs-film' })
      for (let i = 0; i < count; i++) {
        const t = c.in + (((i + 0.5) * sw) / pps) * c.speed
        const idx = clamp(Math.floor((t / (m.duration || 1)) * n), 0, n - 1)
        film.append(h('div', { class: 'vs-tile', style: { left: `${i * sw}px`, width: `${sw + 0.5}px`, backgroundImage: `url(${src})`, backgroundSize: `${n * 100}% 100%`, backgroundPosition: `${n > 1 ? (idx / (n - 1)) * 100 : 0}% 0` } }))
      }
      kids.push(film)
    } else if (c.kind === 'image' && m?.thumb) {
      kids.push(h('div', { class: 'vs-film', style: { backgroundImage: `url(${m.thumb})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' } }))
    } else if (c.kind === 'audio' && m?.wave) {
      kids.push(h('div', { class: 'vs-wave', style: { backgroundImage: `url(${m.wave})`, backgroundSize: `${(m.duration / c.speed) * pps}px 100%`, backgroundPosition: `${(-c.in / c.speed) * pps}px 50%` } }))
    }
    const name = c.kind === 'title' ? (c.text || 'Title').replace(/\s+/g, ' ') : c.name || m?.name || 'Clip'
    kids.push(h('span', { class: 'vs-cname' }, missing ? `Missing: ${name}` : name))
    const tw = (d) => `${clamp(d * pps, 0, w / 2)}px`
    if (c.kind === 'video' || c.kind === 'image') {
      if (c.tin.type !== 'none') kids.push(h('i', { class: `vs-tm in ${c.tin.type}`, style: { width: tw(c.tin.dur) } }))
      if (c.tout.type !== 'none') kids.push(h('i', { class: `vs-tm out ${c.tout.type}`, style: { width: tw(c.tout.dur) } }))
    }
    if (c.fadeIn > 0 && c.kind !== 'image') kids.push(h('i', { class: 'vs-fade', style: { left: 0, width: tw(c.fadeIn) } }))
    if (c.fadeOut > 0 && c.kind !== 'image') kids.push(h('i', { class: 'vs-fade out', style: { right: 0, width: tw(c.fadeOut) } }))
    kids.push(h('i', { class: 'vs-trim l' }), h('i', { class: 'vs-trim r' }))
    clipEl.replaceChildren(...kids)
  }

  function syncClips() {
    const p = doc.p, pps = ui.pps
    const seen = new Set()
    for (const c of p.clips) {
      const lane = laneEls.get(c.track)
      if (!lane) continue
      seen.add(c.id)
      let rec = cache.get(c.id)
      if (!rec) { rec = { el: h('div', { class: 'vs-clip', dataset: { id: c.id, kind: c.kind } }), sig: '' }; cache.set(c.id, rec) }
      const w = Math.max(4, c.dur * pps)
      rec.el.style.left = `${c.start * pps}px`
      rec.el.style.width = `${w}px`
      if (rec.el.parentNode !== lane) lane.append(rec.el)
      rec.el.classList.toggle('sel', ui.sel.has(c.id))
      const m = media.get(c.mediaId)
      const sig = [c.kind, c.name, Math.round(w), c.in.toFixed(3), c.speed, m?.status, m?.strip ? 1 : 0, m?.wave ? 1 : 0, m?.thumb ? 1 : 0, c.tin.type, c.tin.dur, c.tout.type, c.tout.dur, c.fadeIn, c.fadeOut, c.kind === 'title' ? c.text : '', laneHeight(c.track)].join('|')
      if (sig !== rec.sig) { rec.sig = sig; fill(rec.el, c, m, w) }
    }
    for (const [id, rec] of cache) if (!seen.has(id)) { rec.el.remove(); cache.delete(id) }
  }

  function placePlayhead() {
    const x = player.t * ui.pps
    phl.style.left = `${HEAD + x}px`
    phh.style.left = `${x}px`
    clock.textContent = fmtClock(player.t, 1)
  }

  function refresh() {
    const p = doc.p, pps = ui.pps
    HEAD = parseFloat(getComputedStyle(scroll).getPropertyValue('--head')) || 132
    const dur = projectDuration(p)
    const view = Math.max(0, scroll.clientWidth - HEAD)
    const len = Math.max(dur + 12, view / pps)
    const laneW = Math.ceil(len * pps)
    inner.style.width = `${HEAD + laneW}px`
    ruler.style.width = `${laneW}px`
    const sig = p.tracks.map((t) => `${t.id}|${t.kind}|${t.name}|${t.muted ? 1 : 0}${t.hidden ? 1 : 0}${t.locked ? 1 : 0}|${p.clips.some((c) => c.track === t.id) ? 1 : 0}`).join(';')
    if (sig !== rowSig) { rowSig = sig; buildRows() }
    for (const lane of laneEls.values()) lane.style.width = `${laneW}px`
    drawRuler(len)
    syncClips()
    placePlayhead()
    setOn(bSelect, ui.tool === 'select')
    setOn(bRazor, ui.tool === 'razor')
    setOn(bSnap, ui.snap)
    setOn(bRipple, ui.ripple)
    zoomRange.value = String((Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 100)
    scroll.dataset.tool = ui.tool
  }

  // ---- pointer interaction
  const rowAtY = (y) => rowRecs.find((r) => { const b = r.el.getBoundingClientRect(); return y >= b.top && y < b.bottom })
  const hideSnap = () => { snapEl.style.display = 'none' }
  const showSnap = (t) => { snapEl.style.display = 'block'; snapEl.style.left = `${HEAD + t * ui.pps}px` }

  function startScrub(e) {
    if (player.playing) player.pause()
    scrub = true
    scroll.setPointerCapture(e.pointerId)
    player.seek(Math.max(0, frame(timeAt(e.clientX))))
  }

  scroll.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const t = e.target
    if (t.closest('.vs-head')) return
    if (t.closest('.vs-ruler')) return startScrub(e)
    const lane = t.closest('.vs-lane')
    if (!lane) return
    const clipEl = t.closest('.vs-clip')
    const when = Math.max(0, timeAt(e.clientX))
    if (!clipEl) {
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) ui.select([])
      player.seek(frame(when))
      return
    }
    const id = clipEl.dataset.id
    const c = clipById(doc.p, id)
    if (!c) return
    const locked = trackById(doc.p, c.track)?.locked
    if (ui.tool === 'razor') {
      if (!locked) actions.splitAt(id, frame(when))
      return
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const s = new Set(ui.sel)
      s.has(id) ? s.delete(id) : s.add(id)
      ui.select(s)
      return
    }
    if (!ui.sel.has(id)) ui.select([id])
    if (locked) return
    const r = clipEl.getBoundingClientRect()
    const x = e.clientX - r.left
    const edge = Math.min(10, r.width / 3)
    const mode = x < edge ? 'trimL' : r.width - x < edge ? 'trimR' : 'move'
    if (mode !== 'move') ui.select([id])
    const ids = mode === 'move' ? [...ui.sel].filter((i) => { const cc = clipById(doc.p, i); return cc && !trackById(doc.p, cc.track)?.locked }) : [id]
    drag = {
      mode, id, ids, x0: e.clientX, y0: e.clientY, snap: doc.snapshot(), moved: false, lastDt: 0,
      orig: new Map(ids.map((i) => { const cc = clipById(doc.p, i); return [i, { start: cc.start, dur: cc.dur, in: cc.in, track: cc.track }] })),
    }
    scroll.setPointerCapture(e.pointerId)
  })

  function groupFits(dt) {
    const p = doc.p
    const ex = new Set(drag.ids)
    for (const [i, o] of drag.orig) {
      const s = o.start + dt
      if (s < -EPS) return false
      if (clipsOn(p, o.track).some((x) => !ex.has(x.id) && s < clipEnd(x) - EPS && s + o.dur > x.start + EPS)) return false
    }
    return true
  }

  scroll.addEventListener('pointermove', (e) => {
    if (scrub) { player.seek(Math.max(0, frame(timeAt(e.clientX)))); return }
    if (!drag) return
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return
      drag.moved = true
      for (const i of drag.ids) cache.get(i)?.el.classList.add('moving')
    }
    const p = doc.p, pps = ui.pps
    const c = clipById(p, drag.id)
    const o = drag.orig.get(drag.id)
    if (!c || !o) return
    const exclude = new Set(drag.ids)
    const pts = snapPoints(p, exclude, [player.t])
    const thr = 10 / pps
    const noSnap = e.altKey || !ui.snap
    let dt = dx / pps
    hideSnap()
    if (drag.mode === 'move') {
      const minStart = Math.min(...[...drag.orig.values()].map((v) => v.start))
      dt = Math.max(dt, -minStart)
      if (!noSnap) {
        const a = snapTime(o.start + dt, pts, thr), b = snapTime(o.start + o.dur + dt, pts, thr)
        const da = a.hit === null ? Infinity : Math.abs(a.t - o.start - dt), db = b.hit === null ? Infinity : Math.abs(b.t - o.start - o.dur - dt)
        if (da <= db && a.hit !== null) { dt = a.t - o.start; showSnap(a.hit) } else if (b.hit !== null) { dt = b.t - o.dur - o.start; showSnap(b.hit) }
        dt = Math.max(dt, -minStart)
      }
      if (drag.ids.length === 1) {
        const row = rowAtY(e.clientY)
        const tid = row && fits(c.kind, row.kind) && !row.locked ? row.id : o.track
        c.track = tid
        c.start = freeStart(p, tid, o.start + dt, o.dur, exclude)
      } else {
        if (groupFits(dt)) drag.lastDt = dt
        for (const [i, oo] of drag.orig) { const cc = clipById(p, i); if (cc) cc.start = oo.start + drag.lastDt }
      }
    } else if (drag.mode === 'trimL') {
      let ns = o.start + dt
      if (!noSnap) { const s = snapTime(ns, pts, thr); if (s.hit !== null) { ns = s.t; showSnap(s.hit) } }
      const prevEnd = clipsOn(p, o.track).filter((x) => x.id !== c.id && clipEnd(x) <= o.start + EPS).reduce((m, x) => Math.max(m, clipEnd(x)), 0)
      let lo = prevEnd
      if (c.kind === 'video' || c.kind === 'audio') lo = Math.max(lo, o.start - o.in / c.speed)
      ns = clamp(ns, lo, o.start + o.dur - MIN_DUR)
      const d = ns - o.start
      c.start = ns
      c.dur = o.dur - d
      if (c.kind === 'video' || c.kind === 'audio') c.in = Math.max(0, o.in + d * c.speed)
    } else {
      let ne = o.start + o.dur + dt
      if (!noSnap) { const s = snapTime(ne, pts, thr); if (s.hit !== null) { ne = s.t; showSnap(s.hit) } }
      const next = clipsOn(p, o.track).filter((x) => x.id !== c.id && x.start >= o.start + o.dur - EPS).reduce((m, x) => Math.min(m, x.start), Infinity)
      const m = media.get(c.mediaId)
      let hi = next
      if ((c.kind === 'video' || c.kind === 'audio') && m?.duration) hi = Math.min(hi, o.start + (m.duration - o.in) / c.speed)
      ne = clamp(ne, o.start + MIN_DUR, Math.max(o.start + MIN_DUR, hi))
      c.dur = ne - o.start
    }
    doc.emit('live')
  })

  const endDrag = (e) => {
    if (scrub) { scrub = false; scroll.releasePointerCapture?.(e.pointerId); return }
    if (!drag) return
    const d = drag
    drag = null
    hideSnap()
    for (const i of d.ids) cache.get(i)?.el.classList.remove('moving')
    scroll.releasePointerCapture?.(e.pointerId)
    if (d.moved) {
      doc.pushUndo(d.mode === 'move' ? (d.ids.length > 1 ? 'Move clips' : 'Move clip') : 'Trim clip', d.snap)
      doc.emit('change')
    }
  }
  scroll.addEventListener('pointerup', endDrag)
  scroll.addEventListener('pointercancel', endDrag)

  // media bin -> timeline
  scroll.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('application/x-vs-media')) return
    const row = rowAtY(e.clientY)
    const m = media.get(ui.dragMedia)
    e.preventDefault()
    for (const r of rowRecs) r.el.classList.toggle('dropok', r === row && !r.locked && (!m || fits(m.kind, r.kind)))
  })
  scroll.addEventListener('dragleave', (e) => { if (!scroll.contains(e.relatedTarget)) for (const r of rowRecs) r.el.classList.remove('dropok') })
  scroll.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData('application/x-vs-media')
    for (const r of rowRecs) r.el.classList.remove('dropok')
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    const row = rowAtY(e.clientY)
    actions.addMediaClip(id, { trackId: row?.id, start: Math.max(0, frame(timeAt(e.clientX))) })
  })

  scroll.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    setZoom(ui.pps * (e.deltaY < 0 ? 1.18 : 1 / 1.18), e.clientX)
  }, { passive: false })

  const offs = [doc.on(() => refresh()), ui.on(() => refresh()), media.on(() => refresh())]
  const ro = new ResizeObserver(() => refresh())
  ro.observe(scroll)
  refresh()

  return {
    el, refresh, fit, setZoom, reveal, placePlayhead,
    destroy() { offs.forEach((f) => f()); ro.disconnect() },
  }
}
