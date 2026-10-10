// Develop inspector (right panel): histogram, Basic, Tone curve, HSL, Color grading, Detail, Effects and Crop sections.
// Every control reads from and writes to the active photo's settings through the app, so undo, copy and paste all just work.
import { h, icon } from '../../lib/ui.js'
import * as store from '../../lib/store.js'
import { slider, section, curveEditor, colorWheel, histogramView, iconBtn } from './_controls.js'
import { ASPECTS, HUES, HUE_COLORS, aspectCrop, aspectValue, clone, constrainCrop, defaults, groupChanged, orientedSize, pick } from './_model.js'

const getPath = (o, p) => [].concat(p).reduce((a, k) => a?.[k], o)
function setPath(o, p, v) {
  const path = [].concat(p)
  let t = o
  for (let i = 0; i < path.length - 1; i++) t = t[path[i]]
  t[path.at(-1)] = v
}

const TEMP_TRACK = 'linear-gradient(90deg,#3b82f6,#9db8ff 40%,#fff3c4 60%,#fbbf24)'
const TINT_TRACK = 'linear-gradient(90deg,#22c55e,#a3e0b0 40%,#f2c4e8 60%,#d946ef)'
const hueTrack = (i) => {
  const a = HUE_COLORS[(i + 7) % 8], b = HUE_COLORS[i], c = HUE_COLORS[(i + 1) % 8]
  return `linear-gradient(90deg,${a},${b} 50%,${c})`
}
const satTrack = (i) => `linear-gradient(90deg,#8a8a94,${HUE_COLORS[i]})`
const lumTrack = (i) => `linear-gradient(90deg,#000,${HUE_COLORS[i]} 50%,#fff)`
const wheelHue = 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)'

export function createInspector(app, stage) {
  const ui = store.load('pdev:sections', {})
  const rows = [] // {path, el}
  const changedFns = []
  const root = h('div', { class: 'pd-inspector' })

  /** A slider bound to a settings path. */
  function bind({ path, label, aria, min = -100, max = 100, step = 1, def = 0, track, format, unit }) {
    const s = app.settings() || defaults()
    const el = slider({
      label, aria, min, max, step, def, track, format, unit, value: getPath(s, path),
      onInput: (v) => app.update(label, (st) => { setPath(st, path, v); return st }),
    })
    rows.push({ path, el })
    return el
  }
  const resetGroups = (label, groups) => () => app.update(`Reset ${label}`, (s) => ({ ...s, ...clone(pick(defaults(), groups)) }), { coalesce: false })
  const sec = (key, opts) => {
    const el = section({ ...opts, key, open: ui[key] ?? opts.open ?? false })
    el.addEventListener('pd-toggle', (e) => { ui[key] = e.detail; store.save('pdev:sections', ui) })
    root.append(el)
    return el
  }
  const sub = (text, ...right) => h('div', { class: 'pd-sub' }, h('span', text), ...right)
  const seg = (items, value, onChange, label) => {
    const el = h('div', { class: 'pd-seg', role: 'group', 'aria-label': label })
    const btns = items.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => { el.set(v); onChange(v) } }, l))
    el.append(...btns)
    el.set = (v) => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(items[i][0] === v)))
    return el
  }

  // ---------- Histogram ----------
  const hist = histogramView()
  const clipBtn = iconBtn({ icon: 'zap', tip: 'Show clipped highlights and shadows (J)', pressed: false, onClick: () => app.setClip(!app.clip) })
  app.on('clip', (on) => clipBtn.setPressed(on))
  const histBox = h('div', { class: 'pd-histbox' }, hist.el,
    h('div', { class: 'pd-hist-tools' }, h('span', { class: 'pd-hist-title' }, 'Histogram'), clipBtn))
  app.on('histogram', (b) => { hist.draw(b); curve.setHistogram(b) })
  root.append(histBox)

  // ---------- Basic ----------
  const bwSeg = seg([[false, 'Color'], [true, 'Black & white']], false, (v) => app.update('Treatment', (s) => { s.bw = v; return s }), 'Treatment')
  const autoBtn = h('button', { type: 'button', class: 'pd-mini', onclick: () => autoTone(), 'data-tip': 'Set exposure, whites and blacks from the histogram (Ctrl+U)' }, icon('wand-sparkles'), 'Auto')
  function autoTone() {
    const src = stage.source?.small
    const m = app.active()
    if (!src || !m) return
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0)
    const d = x.getImageData(0, 0, c.width, c.height).data
    const hist = new Uint32Array(256)
    for (let i = 0; i < d.length; i += 4) hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++
    const total = d.length / 4
    const pct = (p) => { let a = 0; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= total * p) return i / 255 } return 1 }
    const lo = pct(0.005), mid = pct(0.5), hi = pct(0.995)
    const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const exposure = Math.max(-2, Math.min(2, Math.log2(lin(0.46) / Math.max(lin(mid), 0.004)) * 0.7))
    const whites = Math.round(Math.max(-30, Math.min(60, (0.965 - hi * Math.pow(2, exposure * 0.45)) * 220)))
    const blacks = -Math.round(Math.max(0, Math.min(55, (lo - 0.015) * 380)))
    app.update('Auto tone', (s) => ({ ...s, exposure: Math.round(exposure * 20) / 20, whites, blacks, contrast: Math.max(s.contrast, 8) }), { coalesce: false })
  }
  app.autoTone = autoTone
  const basic = sec('basic', {
    title: 'Basic', icon: 'sliders-horizontal', open: true, onReset: resetGroups('Basic', ['basic', 'color', 'presence']),
    body: h('div', { class: 'pd-stack' },
      bwSeg,
      sub('White balance'),
      bind({ path: 'temp', label: 'Temperature', track: TEMP_TRACK }),
      bind({ path: 'tint', label: 'Tint', track: TINT_TRACK }),
      sub('Tone', autoBtn),
      bind({ path: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.05 }),
      bind({ path: 'contrast', label: 'Contrast' }),
      bind({ path: 'highlights', label: 'Highlights' }),
      bind({ path: 'shadows', label: 'Shadows' }),
      bind({ path: 'whites', label: 'Whites' }),
      bind({ path: 'blacks', label: 'Blacks' }),
      sub('Presence'),
      bind({ path: 'texture', label: 'Texture' }),
      bind({ path: 'clarity', label: 'Clarity' }),
      bind({ path: 'dehaze', label: 'Dehaze' }),
      bind({ path: 'vibrance', label: 'Vibrance' }),
      bind({ path: 'saturation', label: 'Saturation' })),
  })
  changedFns.push((s) => {
    basic.markChanged(['basic', 'color', 'presence'].some((g) => groupChanged(s, g)))
    bwSeg.set(s.bw)
  })

  // ---------- Tone curve ----------
  const curve = curveEditor({
    get: () => (app.settings() || defaults()).curve,
    onChange: (ch, list, live) => app.update('Tone curve', (s) => { s.curve[ch] = list; return s }, { coalesce: live }),
  })
  const curveSeg = seg([['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']], 'rgb', (c) => curve.setChannel(c), 'Curve channel')
  const curveSec = sec('curve', {
    title: 'Tone curve', icon: 'spline', open: false, onReset: resetGroups('Tone curve', ['curve']),
    body: h('div', { class: 'pd-stack' }, curveSeg, h('div', { class: 'pd-curve-wrap' }, curve.el),
      h('div', { class: 'pd-hint' }, 'Click the line to add a point, drag to shape it, double-click a point to remove it.')),
  })
  changedFns.push((s) => { curveSec.markChanged(groupChanged(s, 'curve')); curve.refresh() })

  // ---------- HSL ----------
  let hslTab = 'hue'
  const hslRows = {
    hue: HUES.map((n, i) => bind({ path: ['hue', i], label: n, aria: `${n} hue`, track: hueTrack(i) })),
    sat: HUES.map((n, i) => bind({ path: ['sat', i], label: n, aria: `${n} saturation`, track: satTrack(i) })),
    lum: HUES.map((n, i) => bind({ path: ['lum', i], label: n, aria: `${n} luminance`, track: lumTrack(i) })),
  }
  const hslBox = h('div', { class: 'pd-stack' })
  const hslHint = h('div', { class: 'pd-hint' })
  const showHsl = () => {
    hslBox.replaceChildren(...hslRows[hslTab])
    const bw = app.settings()?.bw
    hslHint.textContent = bw && hslTab === 'lum' ? 'Black and white is on: these sliders mix how bright each color becomes in gray.' : ''
  }
  const hslSeg = seg([['hue', 'Hue'], ['sat', 'Saturation'], ['lum', 'Luminance']], 'hue', (t) => { hslTab = t; showHsl() }, 'HSL mode')
  const hslSec = sec('hsl', {
    title: 'Color mixer (HSL)', icon: 'palette', open: false, onReset: resetGroups('HSL', ['hsl']),
    body: h('div', { class: 'pd-stack' }, hslSeg, hslBox, hslHint),
  })
  showHsl()
  changedFns.push((s) => { hslSec.markChanged(groupChanged(s, 'hsl')); showHsl() })

  // ---------- Color grading ----------
  let zone = 'sh'
  const zoneKeys = { sh: 'Shadows', mid: 'Midtones', hi: 'Highlights' }
  const wheel = colorWheel({
    label: 'Color grading wheel',
    onInput: (v) => app.update(`Grade ${zoneKeys[zone]}`, (s) => { s.grade[zone].h = v.h; s.grade[zone].s = v.s; return s }),
  })
  const gradeSliders = {}
  for (const z of ['sh', 'mid', 'hi']) {
    gradeSliders[z] = {
      h: bind({ path: ['grade', z, 'h'], label: 'Hue', aria: `${zoneKeys[z]} hue`, min: 0, max: 360, def: 0, track: wheelHue, unit: '°' }),
      s: bind({ path: ['grade', z, 's'], label: 'Saturation', aria: `${zoneKeys[z]} saturation`, min: 0, max: 100, def: 0 }),
      l: bind({ path: ['grade', z, 'l'], label: 'Luminance', aria: `${zoneKeys[z]} luminance`, min: -100, max: 100, def: 0 }),
    }
  }
  const gradeBox = h('div', { class: 'pd-stack' })
  const showZone = () => {
    const g = gradeSliders[zone]
    gradeBox.replaceChildren(g.h, g.s, g.l)
    const s = app.settings()
    if (s) wheel.set(s.grade[zone])
  }
  const zoneSeg = seg([['sh', 'Shadows'], ['mid', 'Midtones'], ['hi', 'Highlights']], 'sh', (z) => { zone = z; showZone() }, 'Zone')
  const gradeSec = sec('grading', {
    title: 'Color grading', icon: 'circle-dot', open: false, onReset: resetGroups('Color grading', ['grading']),
    body: h('div', { class: 'pd-stack' }, zoneSeg, h('div', { class: 'pd-wheel-wrap' }, wheel), gradeBox,
      bind({ path: ['grade', 'blend'], label: 'Blending', min: 0, max: 100, def: 50 }),
      bind({ path: ['grade', 'balance'], label: 'Balance', min: -100, max: 100, def: 0 })),
  })
  showZone()
  changedFns.push((s) => { gradeSec.markChanged(groupChanged(s, 'grading')); wheel.set(s.grade[zone]) })

  // ---------- Detail ----------
  const detail = sec('detail', {
    title: 'Detail', icon: 'scan-search', open: false, onReset: resetGroups('Detail', ['detail']),
    body: h('div', { class: 'pd-stack' },
      sub('Sharpening'),
      bind({ path: 'sharpen', label: 'Amount', aria: 'Sharpening amount', min: 0, max: 100, def: 0 }),
      bind({ path: 'sharpMask', label: 'Masking', aria: 'Sharpening masking', min: 0, max: 100, def: 0 }),
      sub('Noise reduction'),
      bind({ path: 'nrLuma', label: 'Luminance', aria: 'Noise reduction luminance', min: 0, max: 100, def: 0 }),
      bind({ path: 'nrColor', label: 'Color', aria: 'Noise reduction color', min: 0, max: 100, def: 0 }),
      h('div', { class: 'pd-hint' }, 'Noise reduction here is light and edge aware. For very noisy photos use a dedicated denoiser first.')),
  })
  changedFns.push((s) => detail.markChanged(groupChanged(s, 'detail')))

  // ---------- Effects ----------
  const effects = sec('effects', {
    title: 'Effects', icon: 'sparkles', open: false, onReset: resetGroups('Effects', ['effects']),
    body: h('div', { class: 'pd-stack' },
      sub('Vignette'),
      bind({ path: 'vignette', label: 'Amount', aria: 'Vignette amount' }),
      bind({ path: 'vigMid', label: 'Midpoint', aria: 'Vignette midpoint', min: 0, max: 100, def: 50 }),
      bind({ path: 'vigRound', label: 'Roundness', aria: 'Vignette roundness' }),
      bind({ path: 'vigFeather', label: 'Feather', aria: 'Vignette feather', min: 0, max: 100, def: 50 }),
      sub('Grain'),
      bind({ path: 'grain', label: 'Amount', aria: 'Grain amount', min: 0, max: 100, def: 0 }),
      bind({ path: 'grainSize', label: 'Size', aria: 'Grain size', min: 0, max: 100, def: 25 }),
      bind({ path: 'grainRough', label: 'Roughness', aria: 'Grain roughness', min: 0, max: 100, def: 50 })),
  })
  changedFns.push((s) => effects.markChanged(groupChanged(s, 'effects')))

  // ---------- Crop and rotate ----------
  const dims = () => { const m = app.active(); return m ? orientedSize(m.w, m.h, app.settings().rot) : [1, 1] }
  const aspectSel = h('select', { class: 'pd-select', 'aria-label': 'Crop aspect ratio', onchange: (e) => setAspect(e.target.value) },
    ASPECTS.map(([v, l]) => h('option', { value: v }, l)))
  let aspectId = 'free'
  function ratio() {
    const [Wo, Ho] = dims()
    const r = aspectValue(aspectId, Wo, Ho)
    return r && app.swapped ? 1 / r : r
  }
  function setAspect(id) {
    aspectId = id; app.aspect = id
    const [Wo, Ho] = dims()
    const r = ratio()
    stage.setCropRatio(r)
    if (r) app.update('Crop', (s) => ({ ...s, crop: aspectCrop(r, s.angle, Wo, Ho, { x: s.crop.x + s.crop.w / 2, y: s.crop.y + s.crop.h / 2 }) }), { coalesce: false })
  }
  const swapBtn = iconBtn({ icon: 'rotate-3d', tip: 'Swap landscape and portrait', onClick: () => { app.swapped = !app.swapped; setAspect(aspectId) } })
  const cropBtn = iconBtn({ icon: 'crop', tip: 'Crop tool (C)', text: 'Crop', pressed: false, onClick: () => app.setCropMode(!app.cropMode) })
  app.on('crop', (on) => { cropBtn.setPressed(on); if (on) { stage.setCropRatio(ratio()); geom.setOpen(true) } })
  const rotate = (dir) => app.update(dir > 0 ? 'Rotate right' : 'Rotate left', (s) => {
    const c = s.crop
    s.crop = dir > 0 ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w }
    s.rot = (s.rot + dir + 4) % 4
    return s
  }, { coalesce: false })
  const flip = (axis) => app.update(axis === 'h' ? 'Flip horizontal' : 'Flip vertical', (s) => {
    const c = s.crop
    if (axis === 'h') { s.flipH = !s.flipH; s.crop = { ...c, x: 1 - (c.x + c.w) } } else { s.flipV = !s.flipV; s.crop = { ...c, y: 1 - (c.y + c.h) } }
    s.angle = -s.angle
    return s
  }, { coalesce: false })
  const angleRow = slider({
    label: 'Straighten', min: -45, max: 45, step: 0.1, def: 0, value: 0, format: (v) => v.toFixed(1), unit: '°',
    onInput: (v) => app.update('Straighten', (s) => {
      const [Wo, Ho] = orientedSize(app.active().w, app.active().h, s.rot)
      s.angle = v
      s.crop = constrainCrop(s.crop, v, Wo, Ho)
      return s
    }),
  })
  rows.push({ path: 'angle', el: angleRow })
  const geom = sec('geometry', {
    title: 'Crop and rotate', icon: 'crop', open: false,
    onReset: () => app.update('Reset crop', (s) => ({ ...s, ...clone(pick(defaults(), ['geometry'])) }), { coalesce: false }),
    body: h('div', { class: 'pd-stack' },
      h('div', { class: 'pd-row' }, cropBtn, aspectSel, swapBtn),
      angleRow,
      h('div', { class: 'pd-row wrap' },
        iconBtn({ icon: 'rotate-ccw', tip: 'Rotate left', onClick: () => rotate(-1) }),
        iconBtn({ icon: 'rotate-cw', tip: 'Rotate right', onClick: () => rotate(1) }),
        iconBtn({ icon: 'flip-horizontal-2', tip: 'Flip horizontal', onClick: () => flip('h') }),
        iconBtn({ icon: 'flip-vertical-2', tip: 'Flip vertical', onClick: () => flip('v') })),
      h('div', { class: 'pd-hint' }, 'In crop mode drag the corners or edges. Press Enter when you are done or Esc to cancel.')),
  })
  changedFns.push((s) => geom.markChanged(groupChanged(s, 'geometry')))

  // ---------- Sync ----------
  function refresh() {
    const s = app.settings()
    if (!s) return
    for (const r of rows) r.el.set(getPath(s, r.path))
    for (const fn of changedFns) fn(s)
  }
  app.on('edit', refresh)
  app.on('active', () => { app.swapped = false; aspectId = 'free'; aspectSel.value = 'free'; refresh() })
  refresh()
  return { el: root, refresh, openSection: (key) => root.querySelector(`[data-key="${key}"]`)?.setOpen?.(true) }
}
