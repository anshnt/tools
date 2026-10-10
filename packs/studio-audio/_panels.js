// UI panels for Audio Studio: toolbar, tool rail, track headers, inspector (track / clip / project), master meter, menus and dialogs.
import { h, icon, button, field, select, toggle, segmented, rangeField, number, input, alert, progress, busy, modal, download, downloadButton, formatBytes, formatDuration, clear, empty } from '../../lib/ui.js'
import { safeName } from '../../lib/files.js'
import { COLORS, PRESET_LIST, TEMPLATES, projectLength, usedAssets } from './_model.js'
import { fmtDb, gainToDb, dbToGain, clamp, fmtClock } from './_dsp.js'
import { exportMix, WAV_BITS, MP3_RATES } from './_export.js'

// ---------- Small helpers ----------
export function tip(el, label, key, pos) {
  el.setAttribute('data-tip', key ? `${label}  (${key})` : label)
  el.setAttribute('aria-label', label)
  if (pos) el.setAttribute('data-tip-pos', pos)
  return el
}
/** Icon button with tooltip. opts: {pressed, cls, pos, text, disabled} */
export function ib(name, label, key, onClick, opts = {}) {
  const b = h('button', { type: 'button', class: ['as-b', opts.cls, opts.text && 'wide'], onclick: onClick, disabled: opts.disabled }, icon(name), opts.text && h('span', opts.text))
  tip(b, label, key, opts.pos)
  if (opts.pressed != null) b.setAttribute('aria-pressed', String(!!opts.pressed))
  return b
}
const press = (b, on) => b.setAttribute('aria-pressed', String(!!on))
const grp = (...kids) => h('div', { class: 'as-grp' }, kids)

const dbFmt = (v) => fmtDb(v)
const pct = (v) => `${Math.round(v * 100)}%`
const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`)
const secs = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`)

function logField(label, { min, max, value, onInput, format }) {
  const toPos = (v) => (Math.log(clamp(v, min, max) / min) / Math.log(max / min)) * 1000
  const toVal = (p) => min * (max / min) ** (p / 1000)
  return rangeField(label, { min: 0, max: 1000, step: 1, value: toPos(value), format: (p) => format(toVal(p)), onInput: (p) => onInput(toVal(p)) })
}
/** Slider whose double-click resets to a default. */
function resettable(f, def) {
  f.addEventListener('dblclick', (e) => {
    if (e.target !== f.input) return
    f.set(def)
    f.input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  f.title = 'Double-click the slider to reset'
  return f
}

// ---------- Menus ----------
export function closeMenu(app) {
  app.menu?.off()
  app.menu = null
}
export function popMenu(app, anchor, items) {
  closeMenu(app)
  const m = h('div', { class: 'as-menu', role: 'menu' }, items.map((it) => it.sep
    ? h('div', { class: 'as-mi sep', role: 'separator' })
    : h('button', { class: 'as-mi', type: 'button', role: 'menuitem', disabled: it.disabled, onclick: () => { closeMenu(app); it.onClick() } }, it.icon && icon(it.icon), h('span', it.label), it.key && h('kbd', it.key))))
  app.root.append(m)
  const r = anchor.getBoundingClientRect(), rr = app.root.getBoundingClientRect()
  m.style.left = `${Math.max(6, Math.min(r.left - rr.left, rr.width - m.offsetWidth - 8))}px`
  m.style.top = `${r.bottom - rr.top + 6}px`
  const btns = [...m.querySelectorAll('button:not(:disabled)')]
  btns[0]?.focus()
  const onDown = (e) => { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(app) }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(app); anchor.focus() }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = btns.indexOf(document.activeElement)
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus()
    }
  }
  document.addEventListener('pointerdown', onDown, true)
  m.addEventListener('keydown', onKey)
  app.menu = { el: m, off: () => { document.removeEventListener('pointerdown', onDown, true); m.remove() } }
}

// ---------- Master meter ----------
export function meterWidget() {
  const cv = h('canvas', { width: 300, height: 68 })
  const el = h('button', { type: 'button', class: 'as-meter', 'data-tip': 'Master level (click to clear the clip light)', 'aria-label': 'Master level meter', 'data-tip-pos': 'end' }, cv)
  const g = cv.getContext('2d')
  const hold = [0, 0], holdAt = [0, 0]
  let clipped = false
  el.addEventListener('click', () => { clipped = false })
  const dbPos = (db) => clamp((db + 60) / 60, 0, 1)
  const style = () => getComputedStyle(el)
  function draw(levels, now = performance.now()) {
    const cs = style()
    const W = 300, H = 68
    g.clearRect(0, 0, W, H)
    const muted = cs.getPropertyValue('--muted').trim() || '#888'
    const track = cs.getPropertyValue('--surface-3').trim() || '#ddd'
    const grad = g.createLinearGradient(0, 0, W - 22, 0)
    grad.addColorStop(0, '#22c55e'); grad.addColorStop(0.7, '#eab308'); grad.addColorStop(1, '#ef4444')
    let maxDb = -120
    levels.forEach((lv, i) => {
      const y = 6 + i * 22
      const db = lv > 0.00001 ? 20 * Math.log10(lv) : -120
      maxDb = Math.max(maxDb, db)
      if (lv >= hold[i] || now - holdAt[i] > 900) { if (lv >= hold[i]) holdAt[i] = now; hold[i] = Math.max(lv, hold[i] * 0.94) }
      if (lv >= 0.995) clipped = true
      g.fillStyle = track
      g.fillRect(0, y, W - 22, 16)
      g.fillStyle = grad
      g.fillRect(0, y, (W - 22) * dbPos(db), 16)
      const hp = dbPos(hold[i] > 0.00001 ? 20 * Math.log10(hold[i]) : -120)
      g.fillStyle = muted
      g.fillRect(Math.max(0, (W - 22) * hp - 3), y, 3, 16)
    })
    g.fillStyle = clipped ? '#ef4444' : track
    g.beginPath(); g.arc(W - 9, 34, 7, 0, Math.PI * 2); g.fill()
    g.fillStyle = muted
    g.font = '9px sans-serif'
    for (const d of [-48, -24, -12, -6, 0]) { const x = (W - 22) * dbPos(d); g.fillRect(x, 50, 1, 4); g.fillText(String(d), Math.min(x - 3, W - 40), 64) }
    el.dataset.db = String(Math.round(maxDb))
    el.dataset.clip = clipped ? '1' : '0'
  }
  draw([0, 0])
  return { el, draw, reset: () => { hold[0] = hold[1] = 0 } }
}

// ---------- Toolbar ----------
export function buildToolbar(app) {
  const S = app.S
  const b = {}
  const menuBtn = h('button', { type: 'button', class: 'as-b wide', 'aria-haspopup': 'menu', onclick: () => popMenu(app, menuBtn, app.projectMenu()) }, icon('folder-open'), h('span', 'Project'), icon('chevron-down'))
  tip(menuBtn, 'Project menu: new, open, save, import')
  b.importBtn = ib('plus', 'Add audio or video files', 'Ctrl+I', () => app.pickAudio(), { text: 'Add audio' })
  b.undo = ib('undo-2', 'Undo', 'Ctrl+Z', () => app.undo())
  b.redo = ib('redo-2', 'Redo', 'Ctrl+Shift+Z', () => app.redo())
  b.toStart = ib('skip-back', 'Go to start', 'Home', () => app.toStart())
  b.play = ib('play', 'Play / pause', 'Space', () => app.togglePlay(), { cls: 'play' })
  b.stop = ib('square', 'Stop and return', 'Enter', () => app.stop())
  b.rec = ib('circle', 'Record from the microphone', 'R', () => app.toggleRecord(), { cls: 'rec', pressed: false })
  b.loop = ib('repeat', 'Loop region on/off', 'L', () => app.toggleLoop(), { pressed: false })
  b.metro = ib('metronome', 'Metronome on/off', 'K', () => app.toggleMetro(), { pressed: false })
  b.clock = h('button', { type: 'button', class: 'as-clock', onclick: () => app.toggleClockMode() }, h('b', '0:00.000'), h('small', 'min:sec'))
  tip(b.clock, 'Playhead position. Click to switch between time and bars')
  b.bpm = h('input', { class: 'as-in', type: 'number', min: 30, max: 300, step: 1, value: S.project.bpm, 'aria-label': 'Tempo in beats per minute', oninput: (e) => { const v = e.target.valueAsNumber; if (v >= 30 && v <= 300) app.setProject('bpm', v) }, onchange: (e) => { e.target.value = S.project.bpm } })
  b.grid = h('select', { class: 'select', 'aria-label': 'Grid', onchange: (e) => app.setProject('grid', e.target.value) },
    [['off', 'Off'], ['bar', 'Bar'], ['1/4', '1/4 beat'], ['1/8', '1/8 beat'], ['1/16', '1/16 beat']].map(([v, l]) => h('option', { value: v }, l)))
  b.snap = ib('magnet', 'Snap to grid, clip edges and the playhead (hold Alt to bypass)', 'N', () => app.setProject('snap', !S.project.snap), { pressed: true })
  b.zoomOut = ib('zoom-out', 'Zoom out', '-', () => app.tl.zoomBy(1 / 1.5), { cls: 'sm', pos: 'up-end' })
  b.zoomIn = ib('zoom-in', 'Zoom in', '+', () => app.tl.zoomBy(1.5), { cls: 'sm', pos: 'up-end' })
  b.fit = ib('maximize', 'Fit the project in view', 'Ctrl+0', () => app.tl.fit(), { cls: 'sm', pos: 'up-end' })
  b.zoom = grp(b.zoomOut, b.zoomIn, b.fit)
  b.meter = meterWidget()
  b.vol = h('input', { class: 'as-vol', type: 'range', min: -40, max: 6, step: 0.5, value: S.project.masterVol, 'aria-label': 'Master volume', oninput: (e) => app.setProject('masterVol', e.target.valueAsNumber, 'master') })
  b.vol.addEventListener('dblclick', () => { b.vol.value = 0; app.setProject('masterVol', 0, 'master') })
  b.vol.setAttribute('data-tip', 'Master volume (double-click to reset)')
  b.insp = ib('panel-right', 'Show or hide the mixer panel', 'I', () => app.toggleInspector(), { pressed: true, pos: 'end' })
  b.export = button('Export', { icon: 'download', variant: 'primary', onClick: () => app.exportDialog() })
  b.export.setAttribute('data-tip', 'Export the mix as WAV or MP3 (Ctrl+E)')
  b.export.setAttribute('data-tip-pos', 'end')

  const el = h('div', { class: 'as-bar' },
    h('div', { class: 'as-grp file' }, menuBtn, b.importBtn),
    grp(b.undo, b.redo),
    h('div', { class: 'as-grp tr' }, b.toStart, b.play, b.stop, b.rec, b.loop, b.metro),
    b.clock,
    h('div', { class: 'as-grp tempo' }, h('label', { class: 'as-fld' }, 'BPM', b.bpm), h('label', { class: 'as-fld' }, 'Grid', b.grid), b.snap),
    h('span', { class: 'as-sp' }),
    b.meter.el, b.vol, b.insp, b.export)

  return {
    el, ...b,
    setClock(text, bars) { b.clock.firstChild.textContent = text; b.clock.lastChild.textContent = bars ? 'bar.beat' : 'min:sec' },
    update() {
      const p = S.project, hist = app.hist
      b.undo.disabled = !hist.canUndo
      b.redo.disabled = !hist.canRedo
      b.undo.setAttribute('data-tip', hist.canUndo ? `Undo ${hist.undoStack.at(-1).label}  (Ctrl+Z)` : 'Nothing to undo')
      b.redo.setAttribute('data-tip', hist.canRedo ? `Redo ${hist.redoStack.at(-1).label}  (Ctrl+Shift+Z)` : 'Nothing to redo')
      b.play.replaceChildren(icon(app.engine.playing && !S.rec ? 'pause' : 'play'))
      press(b.rec, !!S.rec)
      press(b.loop, p.loop.on)
      press(b.metro, p.metro)
      press(b.snap, p.snap)
      press(b.insp, !app.root.classList.contains('no-insp'))
      if (document.activeElement !== b.bpm) b.bpm.value = p.bpm
      b.grid.value = p.grid
      if (document.activeElement !== b.vol) b.vol.value = p.masterVol
    },
  }
}

// ---------- Tool rail ----------
export function buildRail(app) {
  const S = app.S
  const tools = {
    select: ib('mouse-pointer-2', 'Select tool: click clips, drag to move, trim or fade', 'V', () => app.setTool('select'), { pos: 'right' }),
    range: ib('text-cursor-input', 'Range tool: drag to select a time range', 'T', () => app.setTool('range'), { pos: 'right' }),
    blade: ib('scissors', 'Blade tool: click a clip to split it', 'B', () => app.setTool('blade'), { pos: 'right' }),
  }
  const acts = {
    cut: ib('scissors-line-dashed', 'Cut selection', 'Ctrl+X', () => app.cut(), { pos: 'right' }),
    copy: ib('copy', 'Copy selection', 'Ctrl+C', () => app.copy(), { pos: 'right' }),
    paste: ib('clipboard-paste', 'Paste at the playhead', 'Ctrl+V', () => app.paste(), { pos: 'right' }),
    del: ib('trash-2', 'Delete selection', 'Del', () => app.del(), { pos: 'right', cls: 'danger' }),
    split: ib('split', 'Split at the playhead or selection', 'S', () => app.split(), { pos: 'right' }),
    trim: ib('crop', 'Trim clips to the selected range', 'Ctrl+T', () => app.trim(), { pos: 'right' }),
    dup: ib('copy-plus', 'Duplicate selected clips', 'Ctrl+D', () => app.duplicate(), { pos: 'right' }),
    ripple: ib('arrow-left-right', 'Ripple delete: close the gap after deleting a range', null, () => app.setProject('ripple', !S.project.ripple), { pos: 'right', pressed: false }),
  }
  const el = h('div', { class: 'as-rail', role: 'toolbar', 'aria-label': 'Tools and edit actions' },
    tools.select, tools.range, tools.blade, h('div', { class: 'as-sep' }), acts.cut, acts.copy, acts.paste, acts.del, h('div', { class: 'as-sep' }), acts.split, acts.trim, acts.dup, h('div', { class: 'as-sep' }), acts.ripple)
  return {
    el,
    update() {
      for (const [k, b] of Object.entries(tools)) press(b, S.tool === k)
      const hasSel = S.sel.clips.size > 0 || !!S.sel.range
      acts.cut.disabled = acts.copy.disabled = acts.del.disabled = !hasSel
      acts.paste.disabled = !app.clipboard
      acts.trim.disabled = !S.sel.range
      acts.dup.disabled = !S.sel.clips.size
      acts.split.disabled = !S.project.tracks.length
      press(acts.ripple, S.project.ripple)
    },
  }
}

// ---------- Track headers ----------
export function buildHeads(app) {
  const S = app.S
  let sig = ''
  let rows = []
  const host = () => app.tl.headsInner

  function render() {
    const p = S.project
    const next = p.tracks.map((t) => t.id).join(',') + `|${p.trackH}`
    if (next === sig) return sync()
    sig = next
    host().replaceChildren()
    rows = p.tracks.map((t) => {
      const r = { id: t.id }
      r.dot = null
      r.name = h('input', { class: 'hd-name', value: t.name, 'aria-label': `Track name`, spellcheck: false,
        onfocus: (e) => { e.target.select(); app.selectTrack(t.id) },
        onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur() },
        onchange: (e) => app.setTrack(t.id, 'name', e.target.value.trim() || 'Track', { key: `name${t.id}`, flags: 'save insp' }) })
      r.m = h('button', { type: 'button', class: 'hd-t m', onclick: (e) => { e.stopPropagation(); app.setTrack(t.id, 'mute', !app.track(t.id).mute, { flags: 'tl engine save insp' }) } }, 'M')
      r.s = h('button', { type: 'button', class: 'hd-t s', onclick: (e) => { e.stopPropagation(); app.setTrack(t.id, 'solo', !app.track(t.id).solo, { flags: 'tl engine save insp' }) } }, 'S')
      r.r = h('button', { type: 'button', class: 'hd-t r', onclick: (e) => { e.stopPropagation(); app.arm(t.id) } }, 'R')
      r.f = h('button', { type: 'button', class: 'hd-t f', onclick: (e) => { e.stopPropagation(); app.selectTrack(t.id); app.showTab('track') } }, 'FX')
      tip(r.m, 'Mute', 'M'); tip(r.s, 'Solo', 'O'); tip(r.r, 'Arm for recording'); tip(r.f, 'Effects and mixer for this track')
      r.more = h('button', { type: 'button', class: 'as-b sm hd-more', 'aria-label': 'Track menu', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); popMenu(app, r.more, app.trackMenu(t.id)) } }, icon('chevron-down'))
      r.vol = h('input', { type: 'range', min: -60, max: 6, step: 0.5, value: t.vol, 'aria-label': `${t.name} volume`, onclick: (e) => e.stopPropagation(),
        oninput: (e) => app.setTrack(t.id, 'vol', e.target.valueAsNumber, { key: `vol${t.id}`, flags: 'engine save' }),
        ondblclick: (e) => { e.target.value = 0; app.setTrack(t.id, 'vol', 0, { key: `vol${t.id}`, flags: 'engine save' }) } })
      r.pan = h('input', { type: 'range', min: -1, max: 1, step: 0.02, value: t.pan, 'aria-label': `${t.name} pan`, onclick: (e) => e.stopPropagation(),
        oninput: (e) => app.setTrack(t.id, 'pan', e.target.valueAsNumber, { key: `pan${t.id}`, flags: 'engine save' }),
        ondblclick: (e) => { e.target.value = 0; app.setTrack(t.id, 'pan', 0, { key: `pan${t.id}`, flags: 'engine save' }) } })
      r.vol.title = 'Volume (double-click to reset)'
      r.pan.title = 'Pan (double-click to center)'
      r.bar = h('i')
      r.el = h('div', { class: 'as-head', dataset: { id: t.id, size: p.trackH <= 80 ? 's' : 'm' }, style: { '--th': `${p.trackH}px`, '--c': t.color }, role: 'group', 'aria-label': `Track ${t.name}`, onclick: () => app.selectTrack(t.id) },
        h('div', { class: 'hd-top' }, r.name, r.more),
        h('div', { class: 'hd-btns' }, r.m, r.s, r.r, r.f),
        h('div', { class: 'hd-sl' }, r.vol, r.pan),
        h('div', { class: 'hd-meter' }, r.bar))
      host().append(r.el)
      return r
    })
    sync()
  }

  function sync() {
    const p = S.project
    p.tracks.forEach((t, i) => {
      const r = rows[i]
      if (!r) return
      r.el.style.setProperty('--c', t.color)
      r.el.setAttribute('aria-selected', String(S.sel.track === t.id))
      if (document.activeElement !== r.name) r.name.value = t.name
      press(r.m, t.mute)
      press(r.s, t.solo)
      press(r.r, S.armId === t.id || S.rec?.trackId === t.id)
      if (document.activeElement !== r.vol) r.vol.value = t.vol
      if (document.activeElement !== r.pan) r.pan.value = t.pan
    })
  }

  return {
    render, sync,
    meters() {
      const p = S.project
      p.tracks.forEach((t, i) => {
        const r = rows[i]
        if (!r) return
        const lv = S.rec?.trackId === t.id ? S.rec.level : app.engine.trackLevel(t.id)
        r.bar.style.width = `${clamp((lv > 0.00001 ? 20 * Math.log10(lv) + 60 : 0) / 60, 0, 1) * 100}%`
      })
    },
  }
}

// ---------- Inspector ----------
export function buildInspector(app) {
  const S = app.S
  let tab = 'track'
  const body = h('div', { class: 'as-ib', role: 'tabpanel' })
  const tabs = [['track', 'Track'], ['clip', 'Clip'], ['project', 'Project']]
  const bar = h('div', { class: 'as-tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', {
    type: 'button', class: 'as-tab', role: 'tab', id: `as-tab-${id}`, onclick: () => show(id),
  }, label)))
  const el = h('aside', { class: 'as-insp', 'aria-label': 'Inspector' }, bar, body)
  const open = { gate: false, eq: true, comp: true, delay: false, reverb: false }
  let raf = 0

  function show(id) { tab = id; render() }
  function render() {
    raf = 0
    ;[...bar.children].forEach((b, i) => b.setAttribute('aria-selected', String(tabs[i][0] === tab)))
    body.setAttribute('aria-labelledby', `as-tab-${tab}`)
    const sc = body.scrollTop
    clear(body, tab === 'track' ? trackTab() : tab === 'clip' ? clipTab() : projectTab())
    body.scrollTop = sc
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render) }

  // ----- Track tab -----
  function fxSection(t, key, title, controls) {
    const fx = t.fx[key]
    const sec = h('section', { class: ['as-fx', fx.on && 'on', !open[key] && 'closed'] })
    const sw = toggle(title, fx.on, (on) => { app.setFx(t.id, key, 'on', on); sec.classList.toggle('on', on) })
    const chev = h('button', { type: 'button', class: 'as-b sm', 'aria-label': `${open[key] ? 'Collapse' : 'Expand'} ${title}`, 'aria-expanded': String(!!open[key]), onclick: () => { open[key] = !open[key]; sec.classList.toggle('closed', !open[key]); chev.setAttribute('aria-expanded', String(open[key])) } }, icon('chevron-down', 'chev'))
    sec.append(h('header', sw, chev), h('div', { class: 'body' }, controls))
    return sec
  }
  const fxRange = (t, key, prop, label, o) => resettable(rangeField(label, {
    min: o.min, max: o.max, step: o.step, value: o.scale ? Math.round(t.fx[key][prop] * o.scale) : t.fx[key][prop], format: o.format,
    onInput: (v) => app.setFx(t.id, key, prop, o.scale ? v / o.scale : v),
  }), o.def)

  function trackTab() {
    const p = S.project
    const t = p.tracks.find((x) => x.id === S.sel.track)
    if (!t) return empty(p.tracks.length ? 'Click a track name to see its mixer and effects.' : 'Add a track or import audio to start mixing.', 'sliders-horizontal')
    const nameIn = input({ value: t.name, 'aria-label': 'Track name', onchange: (e) => app.setTrack(t.id, 'name', e.target.value.trim() || 'Track', { flags: 'save heads' }) })
    nameIn.addEventListener('keydown', (e) => e.stopPropagation())
    const swatches = h('div', { class: 'as-swatches', role: 'group', 'aria-label': 'Track color' }, COLORS.map((c) => {
      const b = h('button', { type: 'button', class: 'as-sw', style: { '--c': c }, 'aria-label': `Color ${c}`, 'aria-pressed': String(t.color === c), onclick: () => { app.setTrack(t.id, 'color', c, { flags: 'tl save heads' }); swatches.querySelectorAll('.as-sw').forEach((x) => x.setAttribute('aria-pressed', String(x === b))) } })
      return b
    }))
    const vol = resettable(rangeField('Volume', { min: -60, max: 6, step: 0.5, value: t.vol, format: (v) => (v <= -60 ? '-inf dB' : dbFmt(v)), onInput: (v) => app.setTrack(t.id, 'vol', v, { key: `vol${t.id}`, flags: 'engine save hstate' }) }), 0)
    const pan = resettable(rangeField('Pan', { min: -1, max: 1, step: 0.02, value: t.pan, format: (v) => (Math.abs(v) < 0.02 ? 'Center' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`), onInput: (v) => app.setTrack(t.id, 'pan', v, { key: `pan${t.id}`, flags: 'engine save hstate' }) }), 0)
    const flag = (label, on, fn, variant) => { const b = h('button', { type: 'button', class: ['btn btn-sm', on ? 'btn-primary' : 'btn-secondary'], 'aria-pressed': String(on), onclick: fn }, label); return b }
    const preset = select([['', 'Choose a preset...'], ...PRESET_LIST], '', (v) => { if (v) { app.applyPreset(t.id, v); render() } })
    preset.setAttribute('aria-label', 'Effect preset')
    const idx = p.tracks.indexOf(t)
    return [
      h('div', { class: 'stack', style: 'gap:10px' }, field('Name', nameIn), swatches),
      h('h3', { class: 'as-h' }, 'Mixer'), vol, pan,
      h('div', { class: 'as-row' }, flag('Mute', t.mute, () => { app.setTrack(t.id, 'mute', !t.mute, { flags: 'tl engine save insp' }) }), flag('Solo', t.solo, () => { app.setTrack(t.id, 'solo', !t.solo, { flags: 'tl engine save insp' }) }),
        flag('Arm', S.armId === t.id, () => app.arm(t.id))),
      h('h3', { class: 'as-h' }, 'Effects'), field('Preset', preset),
      fxSection(t, 'gate', 'Noise gate', [
        fxRange(t, 'gate', 'threshold', 'Threshold', { min: -80, max: -10, step: 1, format: dbFmt, def: -45 }),
        fxRange(t, 'gate', 'range', 'Reduction when closed', { min: -80, max: -6, step: 1, format: dbFmt, def: -80 }),
        fxRange(t, 'gate', 'hold', 'Hold', { min: 0, max: 0.5, step: 0.01, format: secs, def: 0.06 }),
        fxRange(t, 'gate', 'release', 'Release', { min: 0.02, max: 1, step: 0.01, format: secs, def: 0.12 })]),
      fxSection(t, 'eq', 'EQ (3-band)', [
        fxRange(t, 'eq', 'low', 'Low shelf (120 Hz)', { min: -15, max: 15, step: 0.5, format: dbFmt, def: 0 }),
        fxRange(t, 'eq', 'mid', 'Mid bell', { min: -15, max: 15, step: 0.5, format: dbFmt, def: 0 }),
        resettable(logField('Mid frequency', { min: 200, max: 8000, value: t.fx.eq.midFreq, format: hz, onInput: (v) => app.setFx(t.id, 'eq', 'midFreq', Math.round(v)) }), 436),
        fxRange(t, 'eq', 'high', 'High shelf (6 kHz)', { min: -15, max: 15, step: 0.5, format: dbFmt, def: 0 })]),
      fxSection(t, 'comp', 'Compressor', [
        fxRange(t, 'comp', 'threshold', 'Threshold', { min: -60, max: 0, step: 1, format: dbFmt, def: -24 }),
        fxRange(t, 'comp', 'ratio', 'Ratio', { min: 1, max: 20, step: 0.5, format: (v) => `${v}:1`, def: 4 }),
        fxRange(t, 'comp', 'attack', 'Attack', { min: 1, max: 100, step: 1, format: (v) => `${v} ms`, def: 10, scale: 1000 }),
        fxRange(t, 'comp', 'release', 'Release', { min: 20, max: 1000, step: 10, format: (v) => `${v} ms`, def: 200, scale: 1000 }),
        fxRange(t, 'comp', 'makeup', 'Makeup gain', { min: 0, max: 24, step: 0.5, format: dbFmt, def: 0 })]),
      fxSection(t, 'delay', 'Delay', [
        fxRange(t, 'delay', 'time', 'Time', { min: 50, max: 1000, step: 10, format: (v) => `${v} ms`, def: 300, scale: 1000 }),
        fxRange(t, 'delay', 'feedback', 'Feedback', { min: 0, max: 90, step: 1, format: (v) => `${v}%`, def: 35, scale: 100 }),
        fxRange(t, 'delay', 'mix', 'Mix', { min: 0, max: 100, step: 1, format: (v) => `${v}%`, def: 30, scale: 100 })]),
      fxSection(t, 'reverb', 'Reverb', [
        fxRange(t, 'reverb', 'decay', 'Decay', { min: 0.3, max: 6, step: 0.1, format: (v) => `${v.toFixed(1)} s`, def: 1.8 }),
        fxRange(t, 'reverb', 'mix', 'Mix', { min: 0, max: 100, step: 1, format: (v) => `${v}%`, def: 25, scale: 100 })]),
      h('h3', { class: 'as-h' }, 'Track'),
      h('div', { class: 'as-row' },
        button('Duplicate', { size: 'sm', icon: 'copy', onClick: () => app.dupTrack(t.id) }),
        button('', { size: 'sm', icon: 'chevron-up', ariaLabel: 'Move track up', disabled: idx === 0, onClick: () => app.moveTrack(t.id, -1) }),
        button('', { size: 'sm', icon: 'chevron-down', ariaLabel: 'Move track down', disabled: idx === p.tracks.length - 1, onClick: () => app.moveTrack(t.id, 1) }),
        button('Delete', { size: 'sm', icon: 'trash-2', variant: 'danger', onClick: () => app.removeTrack(t.id) })),
    ]
  }

  // ----- Clip tab -----
  function clipTab() {
    const found = [...S.sel.clips].map((id) => app.findClip(id)).filter(Boolean)
    if (!found.length) return empty('Select a clip to edit it. Drag the edges to trim, the corner dots for fades, and the dashed line for gain.', 'audio-lines')
    const c = found[0].clip
    const many = found.length > 1
    const nameIn = input({ value: c.name, disabled: many, 'aria-label': 'Clip name', onchange: (e) => app.setClips('name', e.target.value.trim() || 'Clip') })
    nameIn.addEventListener('keydown', (e) => e.stopPropagation())
    const num = (label, prop, o = {}) => {
      const n = number(+(+c[prop]).toFixed(3), { min: 0, step: o.step ?? 0.01, ariaLabel: label, onInput: (v) => { if (Number.isFinite(v)) app.setClips(prop, v) } })
      n.addEventListener('keydown', (e) => e.stopPropagation())
      return field(label, n)
    }
    const gain = resettable(rangeField('Clip gain', { min: -40, max: 12, step: 0.5, value: c.gain > 0 ? Math.max(-40, gainToDb(c.gain)) : -40, format: (v) => (v <= -40 ? '-inf dB' : dbFmt(v)), onInput: (v) => app.setClips('gain', dbToGain(v, -40)) }), 0)
    const fi = resettable(rangeField('Fade in', { min: 0, max: Math.max(0.1, Math.min(10, c.dur)), step: 0.01, value: c.fadeIn, format: secs, onInput: (v) => app.setClips('fadeIn', v) }), 0)
    const fo = resettable(rangeField('Fade out', { min: 0, max: Math.max(0.1, Math.min(10, c.dur)), step: 0.01, value: c.fadeOut, format: secs, onInput: (v) => app.setClips('fadeOut', v) }), 0)
    return [
      h('h3', { class: 'as-h' }, many ? `${found.length} clips selected` : 'Clip'),
      field('Name', nameIn),
      h('div', { class: 'as-mini' }, num('Start (s)', 'start'), field('Length (s)', number(+c.dur.toFixed(3), { disabled: true, ariaLabel: 'Length' }))),
      gain, fi, fo,
      h('div', { class: 'as-row' },
        button('Normalize', { size: 'sm', icon: 'gauge', onClick: () => app.normalizeClips() }),
        button('Split at playhead', { size: 'sm', icon: 'split', onClick: () => app.split() }),
        button('Duplicate', { size: 'sm', icon: 'copy-plus', onClick: () => app.duplicate() }),
        button('Delete', { size: 'sm', icon: 'trash-2', variant: 'danger', onClick: () => app.del() })),
      h('p', { class: 'as-note' }, 'Clips on the same track that overlap play together, so use fade in and fade out for a crossfade.'),
    ]
  }

  // ----- Project tab -----
  function projectTab() {
    const p = S.project
    const nameIn = input({ value: p.name, 'aria-label': 'Project name', onchange: (e) => app.setProject('name', e.target.value.trim() || 'Untitled project') })
    nameIn.addEventListener('keydown', (e) => e.stopPropagation())
    const bpm = number(p.bpm, { min: 30, max: 300, step: 1, ariaLabel: 'Tempo', onInput: (v) => { if (v >= 30 && v <= 300) app.setProject('bpm', v) } })
    bpm.addEventListener('keydown', (e) => e.stopPropagation())
    const beats = select([['2', '2 / 4'], ['3', '3 / 4'], ['4', '4 / 4'], ['6', '6 / 8']], String(p.beats), (v) => app.setProject('beats', +v))
    beats.setAttribute('aria-label', 'Beats per bar')
    const grid = select([['off', 'Off'], ['bar', 'Bar'], ['1/4', '1/4 beat'], ['1/8', '1/8 beat'], ['1/16', '1/16 beat']], p.grid, (v) => app.setProject('grid', v))
    grid.setAttribute('aria-label', 'Grid')
    const sizes = segmented([[72, 'Small'], [104, 'Medium'], [150, 'Large']], p.trackH, (v) => app.setProject('trackH', v), 'Track height')
    const clips = p.tracks.reduce((n, t) => n + t.clips.length, 0)
    let bytes = 0
    for (const id of usedAssets(p)) bytes += S.assets.get(id)?.blob?.size || 0
    return [
      h('h3', { class: 'as-h' }, 'Project'), field('Name', nameIn),
      h('div', { class: 'as-mini' }, field('Tempo (BPM)', bpm), field('Beats per bar', beats)),
      field('Grid', grid),
      toggle('Snap to grid and clip edges', p.snap, (v) => app.setProject('snap', v)),
      toggle('Metronome while playing', p.metro, (v) => app.setProject('metro', v)),
      resettable(rangeField('Metronome volume', { min: 0, max: 1, step: 0.05, value: p.metroVol, format: pct, onInput: (v) => app.setProject('metroVol', v, 'master') }), 0.5),
      toggle('Ripple delete (close gaps)', p.ripple, (v) => app.setProject('ripple', v)),
      toggle('Follow the playhead', p.follow, (v) => app.setProject('follow', v)),
      field('Track height', sizes),
      resettable(rangeField('Master volume', { min: -40, max: 6, step: 0.5, value: p.masterVol, format: dbFmt, onInput: (v) => app.setProject('masterVol', v, 'master') }), 0),
      h('h3', { class: 'as-h' }, 'This project'),
      h('div', { class: 'as-kv' }, h('span', 'Tracks'), h('b', p.tracks.length), h('span', 'Clips'), h('b', clips), h('span', 'Length'), h('b', fmtClock(projectLength(p))), h('span', 'Audio stored'), h('b', formatBytes(bytes))),
      h('div', { class: 'as-row' },
        button('Export...', { size: 'sm', icon: 'download', variant: 'primary', onClick: () => app.exportDialog() }),
        button('Save project file', { size: 'sm', icon: 'save', onClick: () => app.saveFile() }),
        button('Open...', { size: 'sm', icon: 'folder-open', onClick: () => app.openFile() })),
      h('p', { class: 'as-note' }, 'Your project is saved automatically in this browser, including the audio. Save a project file to move it to another device.'),
    ]
  }

  return { el, show, render, schedule, get tab() { return tab } }
}

// ---------- Dialogs ----------
export function exportDialog(app) {
  const S = app.S, p = S.project
  const len = projectLength(p)
  if (!(len > 0.01)) return app.toast('Nothing to export yet. Add or record some audio first.', 'error')
  const hasSel = !!S.sel.range
  const hasLoop = p.loop.end - p.loop.start > 0.05
  const st = { format: 'wav', bits: '16', kbps: '192', sr: '44100', ch: '2', range: hasSel ? 'sel' : 'all', normalize: false, tail: true, name: safeName(p.name) }
  const result = h('div')
  const prog = progress('Exporting')
  const fmt = segmented([['wav', 'WAV'], ['mp3', 'MP3']], 'wav', (v) => { st.format = v; sync() }, 'Format')
  const bits = select(WAV_BITS, st.bits, (v) => { st.bits = v })
  const kbps = select(MP3_RATES, st.kbps, (v) => { st.kbps = v })
  const rangeOpts = [['all', `Whole project (${formatDuration(len)})`]]
  if (hasSel) rangeOpts.push(['sel', `Selection (${(S.sel.range.t1 - S.sel.range.t0).toFixed(2)} s)`])
  if (hasLoop) rangeOpts.push(['loop', `Loop region (${(p.loop.end - p.loop.start).toFixed(2)} s)`])
  const range = select(rangeOpts, st.range, (v) => { st.range = v })
  const sr = select([['44100', '44.1 kHz'], ['48000', '48 kHz']], st.sr, (v) => { st.sr = v })
  const ch = select([['2', 'Stereo'], ['1', 'Mono']], st.ch, (v) => { st.ch = v })
  const name = input({ value: st.name, 'aria-label': 'File name', oninput: (e) => { st.name = e.target.value } })
  const norm = toggle('Normalize the peak to -1 dB', false, (v) => { st.normalize = v })
  const tail = toggle('Include reverb and echo tails', true, (v) => { st.tail = v })
  const bitsF = field('Bit depth', bits), kbpsF = field('Bitrate', kbps)
  const note = h('p', { class: 'as-note' })
  function sync() {
    bitsF.hidden = st.format !== 'wav'
    kbpsF.hidden = st.format !== 'mp3'
    note.textContent = st.format === 'mp3' ? 'MP3 uses a small encoder (about 31 MB) that downloads once and is then cached.' : 'WAV is lossless and opens everywhere.'
  }
  sync()
  const go = button('Export', { icon: 'download', variant: 'primary' })
  const audible = p.tracks.filter((t) => !t.mute && (!p.tracks.some((x) => x.solo) || t.solo)).length
  const body = h('div', { class: 'stack' },
    h('div', { class: 'tool-split' }, field('Format', fmt), field('Range', range)),
    h('div', { class: 'tool-split' }, bitsF, kbpsF, field('Sample rate', sr)),
    h('div', { class: 'tool-split' }, field('Channels', ch), field('File name', name)),
    norm, tail, note,
    h('p', { class: 'as-note' }, `Exports ${audible} of ${p.tracks.length} track${p.tracks.length === 1 ? '' : 's'} (muted tracks are skipped; if any track is soloed only soloed tracks are exported).`),
    prog.el, result)
  const m = modal({ title: 'Export audio', icon: 'download', body, actions: [button('Close', { variant: 'ghost', onClick: () => m.close() }), go] })
  const ctl = new AbortController()
  m.el.addEventListener('close', () => ctl.abort())
  go.addEventListener('click', () => busy(go, async () => {
    clear(result)
    let from = 0, to = len
    if (st.range === 'sel' && S.sel.range) { from = S.sel.range.t0; to = S.sel.range.t1 }
    if (st.range === 'loop') { from = p.loop.start; to = p.loop.end }
    const out = await exportMix(S.project, S.assets, {
      format: st.format, bits: +st.bits, kbps: +st.kbps, sampleRate: +st.sr, channels: +st.ch, from, to, normalize: st.normalize, tail: st.tail, signal: ctl.signal,
      onProgress: (f, label) => prog.set(f, label),
    })
    const file = `${safeName(st.name) || 'mix'}.${out.ext}`
    prog.hide()
    download(out.blob, file)
    app.lastExport = { ...out, file }
    clear(result, alert('success', h('strong', 'Exported. '), `${file}: ${formatDuration(out.duration)} long, ${formatBytes(out.blob.size)}, peak ${fmtDb(out.peakDb)}.`),
      h('div', { class: 'row', style: 'margin-top:10px' }, downloadButton(out.blob, file, 'Download again', { size: 'sm' })))
  }, { label: 'Exporting', errorTo: result, progress: prog }))
}

export function newDialog(app) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'as-note' }, 'Start a new project. Your current project is replaced, so save a project file first if you want to keep it.'),
    h('div', { class: 'as-tpl' }, Object.entries(TEMPLATES).map(([id, t]) => h('button', { type: 'button', onclick: () => { m.close(); app.newProject(id) } },
      h('b', t.name), h('span', id === 'blank' ? 'Empty timeline' : `${t.tracks.length} track${t.tracks.length === 1 ? '' : 's'}: ${t.tracks.map((x) => x[0]).join(', ')}`)))))
  const m = modal({ title: 'New project', icon: 'file-plus', body })
}

export function shortcutsDialog() {
  const rows = [
    ['Space', 'Play / pause'], ['Enter', 'Stop and return'], ['Home / End', 'Go to start / end'], ['R', 'Record'], ['L', 'Loop on/off'], ['K', 'Metronome on/off'],
    ['V / T / B', 'Select / Range / Blade tool'], ['S', 'Split at playhead or selection'], ['Del', 'Delete selection'], ['Ctrl+X / C / V', 'Cut / copy / paste'],
    ['Ctrl+T', 'Trim to range'], ['Ctrl+D', 'Duplicate clips'], ['Ctrl+A', 'Select all clips'], ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
    ['+ / -', 'Zoom in / out'], ['Ctrl+0', 'Fit project'], ['Z', 'Zoom to range'], ['Ctrl+wheel', 'Zoom at the pointer'],
    ['Left / Right', 'Move playhead (Shift = bigger steps)'], ['Up / Down', 'Select previous / next track'], ['M / O', 'Mute / solo the selected track'],
    ['[ / ]', 'Set loop start / end at the playhead'], ['N', 'Snap on/off'], ['Alt (while dragging)', 'Bypass snapping'], ['Ctrl+E', 'Export'], ['F', 'Follow the playhead on/off'], ['I', 'Show or hide the mixer panel'], ['Ctrl+S', 'Save project file'], ['Ctrl+I', 'Add audio files'],
  ]
  modal({ title: 'Keyboard shortcuts', icon: 'keyboard', body: h('div', { class: 'as-keys' }, rows.flatMap(([k, d]) => [h('kbd', k), h('span', d)])) })
}

