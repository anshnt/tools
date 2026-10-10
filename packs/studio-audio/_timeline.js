// Timeline view for Audio Studio: ruler, track lanes, clip waveforms (canvas) and all pointer editing
// (select, range, blade, move, trim, fades, clip gain). Playhead, range and loop are DOM overlays so they move without redrawing.
import { h } from '../../lib/ui.js'
import { clamp, waveColumns, niceStep, fmtTick, fmtBars, gridStep } from './_dsp.js'
import { clipEnd, projectLength, clampClip } from './_model.js'

export const RULER_H = 34
const LABEL_H = 16
const MIN_PPS = 1.5
const MAX_PPS = 3000

function parseColor(s, fallback = [128, 128, 128]) {
  s = (s || '').trim()
  let m = s.match(/^#([0-9a-f]{3})$/i)
  if (m) return [...m[1]].map((x) => parseInt(x + x, 16))
  m = s.match(/^#([0-9a-f]{6})/i)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  m = s.match(/rgba?\(([^)]+)\)/)
  if (m) return m[1].split(',').slice(0, 3).map((x) => +x)
  return fallback
}
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v * t + b[i] * (1 - t))).join(',')})`

export class Timeline {
  constructor(app) {
    this.app = app
    this.S = app.S
    this.pps = 90
    this.W = 800
    this.H = 400
    this.drag = null
    this.hover = null
    this.dirty = true
    this.raf = 0
    this.mins = new Float32Array(2048)
    this.maxs = new Float32Array(2048)

    this.canvas = h('canvas', { class: 'as-canvas' })
    this.playhead = h('div', { class: 'as-playhead' }, h('i'))
    this.rangeEl = h('div', { class: 'as-range', hidden: true })
    this.loopBand = h('div', { class: 'as-loopband', hidden: true })
    this.emptyHost = h('div', { class: 'as-empty-host' })
    this.content = h('div', { class: 'as-content' }, this.loopBand, this.canvas, this.rangeEl, this.playhead, this.emptyHost)
    this.scrollEl = h('div', { class: 'as-scroll', tabindex: -1 }, this.content)
    this.headsInner = h('div', { class: 'as-heads-in' })
    this.heads = h('div', { class: 'as-heads' }, this.headsInner)
    this.rulerCanvas = h('canvas')
    this.rph = h('div', { class: 'as-rph' })
    this.ruler = h('div', { class: 'as-ruler' }, this.rulerCanvas, this.rph)
    this.corner = h('div', { class: 'as-corner' })
    this.el = h('div', { class: 'as-tl' }, this.corner, this.ruler, this.heads, this.scrollEl)

    this.scrollEl.addEventListener('scroll', () => {
      this.heads.scrollTop = this.scrollEl.scrollTop
      this.invalidate()
      this.drawRuler()
      this.updateOverlays()
    }, { passive: true })
    this.scrollEl.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = this.scrollEl.getBoundingClientRect()
      this.zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left)
    }, { passive: false })
    this.scrollEl.addEventListener('pointerdown', (e) => this.down(e))
    this.scrollEl.addEventListener('pointermove', (e) => this.move(e))
    this.scrollEl.addEventListener('pointerup', (e) => this.up(e))
    this.scrollEl.addEventListener('pointercancel', (e) => this.up(e, true))
    this.scrollEl.addEventListener('dblclick', (e) => this.dbl(e))
    this.heads.addEventListener('wheel', (e) => { this.scrollEl.scrollTop += e.deltaY; e.preventDefault() }, { passive: false })
    this.ruler.addEventListener('pointerdown', (e) => this.rulerDown(e))
    this.ruler.addEventListener('pointermove', (e) => this.rulerMove(e))
    this.ruler.addEventListener('pointerup', (e) => this.rulerUp(e))
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(this.scrollEl)
  }

  destroy() {
    this.ro.disconnect()
    cancelAnimationFrame(this.raf)
  }

  // ---------- Geometry ----------
  get th() { return this.S.project.trackH }
  tx(t) { return t * this.pps }
  setTool(tool) {
    this.scrollEl.style.touchAction = tool === 'range' ? 'none' : tool === 'blade' ? 'manipulation' : 'pan-x pan-y'
    this.scrollEl.dataset.tool = tool
  }

  resize() {
    const sc = this.scrollEl
    this.W = Math.max(50, sc.clientWidth)
    this.H = Math.max(50, sc.clientHeight)
    const dpr = window.devicePixelRatio || 1
    this.canvas.style.width = `${this.W}px`
    this.canvas.style.height = `${this.H}px`
    this.canvas.width = Math.round(this.W * dpr)
    this.canvas.height = Math.round(this.H * dpr)
    this.rulerCanvas.style.width = `${this.W}px`
    this.rulerCanvas.width = Math.round(this.W * dpr)
    this.rulerCanvas.height = Math.round(RULER_H * dpr)
    this.headsInner.style.paddingBottom = `${sc.offsetHeight - sc.clientHeight}px`
    if (this.mins.length < this.W + 8) { this.mins = new Float32Array(this.W + 64); this.maxs = new Float32Array(this.W + 64) }
    this.layout()
  }

  /** Size the scrollable area for the current zoom, project length and track count. */
  layout() {
    const p = this.S.project
    const len = Math.max(projectLength(p), p.loop.on ? p.loop.end : 0, this.S.playheadNow() || 0)
    const viewSec = this.W / this.pps
    const w = Math.max(this.W, Math.ceil((len + Math.max(15, viewSec * 0.5)) * this.pps))
    const hgt = Math.max(this.H, p.tracks.length * p.trackH + 30)
    this.content.style.width = `${w}px`
    this.content.style.height = `${hgt}px`
    for (const el of [this.rangeEl, this.loopBand, this.playhead]) el.style.height = `${hgt}px`
    this.headsInner.style.minHeight = `${hgt}px`
    this.invalidate()
    this.drawRuler()
    this.updateOverlays()
  }

  /** Grow the scrollable area when the playhead (playing or recording) runs past the end of the project. */
  ensureWidth(t) {
    if ((t + 4) * this.pps > parseFloat(this.content.style.width || 0)) this.layout()
  }

  setZoom(pps, anchorPx) {
    const sc = this.scrollEl
    pps = clamp(pps, MIN_PPS, MAX_PPS)
    if (pps === this.pps) return
    const ax = anchorPx ?? this.W / 2
    const t = (sc.scrollLeft + ax) / this.pps
    this.pps = pps
    this.layout()
    sc.scrollLeft = Math.max(0, t * pps - ax)
    this.invalidate()
    this.drawRuler()
    this.updateOverlays()
    this.app.zoomChanged?.(pps)
  }
  zoomBy(f, anchorPx) { this.setZoom(this.pps * f, anchorPx) }
  fit() {
    const len = Math.max(projectLength(this.S.project), 4)
    this.setZoom((this.W - 60) / len)
    this.scrollEl.scrollLeft = 0
  }
  zoomToRange(t0, t1) {
    if (t1 - t0 < 0.05) return
    this.setZoom((this.W - 60) / (t1 - t0))
    this.scrollEl.scrollLeft = Math.max(0, t0 * this.pps - 30)
  }
  scrollToTime(t, margin = 40) {
    const sc = this.scrollEl
    const x = t * this.pps
    if (x < sc.scrollLeft || x > sc.scrollLeft + this.W - margin) sc.scrollLeft = Math.max(0, x - margin)
  }
  invalidate() {
    this.dirty = true
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.dirty) { this.dirty = false; this.draw() } })
  }

  // ---------- Drawing ----------
  colors() {
    const cs = getComputedStyle(this.app.root)
    const v = (n, f) => parseColor(cs.getPropertyValue(n), f)
    const bg = v('--surface', [255, 255, 255])
    return {
      bg, bg2: v('--surface-2', [244, 244, 247]), border: v('--border', [230, 230, 236]), text: v('--text', [10, 10, 16]), muted: v('--muted', [103, 103, 116]),
      accent: v('--accent', [91, 76, 240]), dark: bg[0] + bg[1] + bg[2] < 300,
    }
  }
  rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`

  draw() {
    const S = this.S, p = S.project, th = p.trackH
    const ctx = this.canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { W, H, pps } = this
    const sx = this.scrollEl.scrollLeft, sy = this.scrollEl.scrollTop
    const C = this.colors()
    ctx.fillStyle = this.rgb(C.bg2)
    ctx.fillRect(0, 0, W, H)
    const n = p.tracks.length
    for (let i = 0; i < n; i++) {
      const y = i * th - sy
      if (y > H || y + th < 0) continue
      const t = p.tracks[i]
      ctx.fillStyle = this.rgb(C.bg, i % 2 ? 0.55 : 0.8)
      ctx.fillRect(0, y, W, th)
      if (S.sel.track === t.id || S.sel.range?.ids.includes(t.id)) { ctx.fillStyle = this.rgb(C.accent, 0.07); ctx.fillRect(0, y, W, th) }
      ctx.fillStyle = this.rgb(C.border)
      ctx.fillRect(0, y + th - 1, W, 1)
    }
    this.drawGrid(ctx, C, sx)
    for (let i = 0; i < n; i++) {
      const y = i * th - sy
      if (y > H || y + th < 0) continue
      for (const c of p.tracks[i].clips) this.drawClip(ctx, C, p.tracks[i], c, y, sx)
    }
    const rec = S.rec
    if (rec) {
      const i = p.tracks.findIndex((t) => t.id === rec.trackId)
      if (i >= 0) this.drawRecording(ctx, C, rec, i * th - sy, sx, th)
    }
  }

  drawGrid(ctx, C, sx) {
    const p = this.S.project, { W, H, pps } = this
    const beat = 60 / p.bpm
    const step = gridStep(p)
    ctx.lineWidth = 1
    if (step) {
      const unit = beat * p.beats
      const minPx = 14
      let s = step
      while (s * pps < minPx) s *= 2
      const t0 = Math.floor(sx / pps / s) * s
      for (let t = t0; t * pps - sx < W; t += s) {
        const x = Math.round(t * pps - sx) + 0.5
        const isBar = Math.abs(t / unit - Math.round(t / unit)) < 1e-6
        const isBeat = Math.abs(t / beat - Math.round(t / beat)) < 1e-6
        ctx.strokeStyle = this.rgb(C.text, isBar ? 0.16 : isBeat ? 0.09 : 0.045)
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
    } else {
      const s = niceStep(90 / pps)
      const t0 = Math.floor(sx / pps / s) * s
      ctx.strokeStyle = this.rgb(C.text, 0.05)
      for (let t = t0; t * pps - sx < W; t += s) {
        const x = Math.round(t * pps - sx) + 0.5
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
    }
  }

  drawClip(ctx, C, track, c, laneTop, sx) {
    const S = this.S, { W, pps } = this, th = this.th
    const x0 = c.start * pps - sx
    const x1 = clipEnd(c) * pps - sx
    if (x1 < -2 || x0 > W + 2) return
    const asset = S.assets.get(c.asset)
    const col = parseColor(track.color)
    const y = laneTop + 3
    const hh = th - 6
    const w = Math.max(1, x1 - x0)
    const sel = S.sel.clips.has(c.id)
    const muted = !this.app.isAudible(track)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x0, y, w, hh, 6)
    ctx.clip()
    ctx.globalAlpha = muted ? 0.5 : 1
    ctx.fillStyle = mix(col, C.bg, C.dark ? 0.26 : 0.18)
    ctx.fillRect(x0, y, w, hh)
    const ay = y + LABEL_H
    const ah = hh - LABEL_H
    const mid = ay + ah / 2
    // waveform
    if (asset) {
      const xa = Math.max(0, Math.floor(x0))
      const xb = Math.min(W, Math.ceil(x1))
      const cols = xb - xa
      if (cols > 0) {
        const spp = asset.sampleRate / pps
        const startSample = (c.offset + (xa - x0) / pps) * asset.sampleRate
        waveColumns(asset, startSample, spp, cols, this.mins, this.maxs)
        const amp = (ah / 2) * 0.94 * c.gain
        ctx.fillStyle = mix(col, C.dark ? [255, 255, 255] : [0, 0, 0], C.dark ? 0.85 : 0.8)
        ctx.beginPath()
        for (let i = 0; i < cols; i++) ctx.lineTo(xa + i + 0.5, mid - this.maxs[i] * amp - 0.4)
        for (let i = cols - 1; i >= 0; i--) ctx.lineTo(xa + i + 0.5, mid - this.mins[i] * amp + 0.4)
        ctx.closePath()
        ctx.fill()
      }
    } else {
      ctx.fillStyle = this.rgb(C.muted, 0.6)
      ctx.font = '11px sans-serif'
      ctx.fillText('Audio missing', x0 + 8, mid)
    }
    // fades: shade the part that is turned down
    const fiW = c.fadeIn * pps, foW = c.fadeOut * pps
    ctx.fillStyle = this.rgb(C.bg, 0.55)
    if (fiW > 1) { ctx.beginPath(); ctx.moveTo(x0, ay); ctx.lineTo(x0 + fiW, ay); ctx.lineTo(x0, ay + ah); ctx.closePath(); ctx.fill() }
    if (foW > 1) { ctx.beginPath(); ctx.moveTo(x1, ay); ctx.lineTo(x1 - foW, ay); ctx.lineTo(x1, ay + ah); ctx.closePath(); ctx.fill() }
    ctx.strokeStyle = this.rgb(col, 0.9)
    ctx.lineWidth = 1.2
    if (fiW > 1) { ctx.beginPath(); ctx.moveTo(x0, ay + ah); ctx.lineTo(x0 + fiW, ay); ctx.stroke() }
    if (foW > 1) { ctx.beginPath(); ctx.moveTo(x1, ay + ah); ctx.lineTo(x1 - foW, ay); ctx.stroke() }
    // label strip
    ctx.globalAlpha = muted ? 0.5 : 1
    ctx.fillStyle = mix(col, C.dark ? [0, 0, 0] : [255, 255, 255], C.dark ? 0.8 : 0.92)
    ctx.fillRect(x0, y, w, LABEL_H)
    ctx.fillStyle = '#fff'
    ctx.font = '600 11px Geist, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const lx = Math.max(x0, 0) + 6
    if (x1 - lx > 16) ctx.fillText(c.name, lx, y + LABEL_H / 2 + 0.5)
    // gain line
    const showGain = sel || this.hover?.clipId === c.id
    if (showGain) {
      const gy = ay + ah * (1 - c.gain / 2)
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = this.rgb(C.text, 0.55)
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.restore()
    // border and handles (outside the clip region)
    ctx.beginPath()
    ctx.roundRect(x0 + 0.5, y + 0.5, w - 1, hh - 1, 6)
    ctx.strokeStyle = sel ? this.rgb(C.accent) : mix(col, C.bg, 0.65)
    ctx.lineWidth = sel ? 2 : 1
    ctx.stroke()
    if (w > 26 && (sel || this.hover?.clipId === c.id)) {
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = mix(col, [0, 0, 0], 0.8)
      ctx.lineWidth = 1.5
      for (const hx of [x0 + fiW, x1 - foW]) {
        if (hx < -6 || hx > W + 6) continue
        ctx.beginPath(); ctx.arc(hx, y + LABEL_H / 2 + 0.5, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      }
    }
  }

  drawRecording(ctx, C, rec, laneTop, sx, th) {
    const { pps, W } = this
    const x0 = rec.start * pps - sx
    const secs = rec.peaks.length / 2 / 100
    const x1 = (rec.start + secs) * pps - sx
    if (x1 < 0 || x0 > W) return
    const y = laneTop + 3, hh = th - 6
    ctx.save()
    ctx.beginPath(); ctx.roundRect(x0, y, Math.max(2, x1 - x0), hh, 6); ctx.clip()
    ctx.fillStyle = 'rgba(239,68,68,.16)'
    ctx.fillRect(x0, y, x1 - x0, hh)
    ctx.fillStyle = 'rgba(239,68,68,.9)'
    ctx.fillRect(x0, y, x1 - x0, LABEL_H)
    ctx.fillStyle = '#fff'
    ctx.font = '600 11px Geist, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('Recording...', Math.max(x0, 0) + 6, y + LABEL_H / 2 + 0.5)
    const mid = y + LABEL_H + (hh - LABEL_H) / 2
    const amp = ((hh - LABEL_H) / 2) * 0.94
    ctx.fillStyle = 'rgba(239,68,68,.95)'
    const per = pps / 100
    for (let i = 0; i < rec.peaks.length; i += 2) {
      const x = x0 + (i / 2) * per
      if (x < -2) continue
      if (x > W) break
      const mn = rec.peaks[i], mx = rec.peaks[i + 1]
      ctx.fillRect(x, mid - mx * amp - 0.4, Math.max(1, per), (mx - mn) * amp + 0.8)
    }
    ctx.restore()
  }

  drawRuler() {
    const p = this.S.project
    const cv = this.rulerCanvas
    const ctx = cv.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const C = this.colors()
    const { W, pps } = this
    const sx = this.scrollEl.scrollLeft
    ctx.fillStyle = this.rgb(C.bg)
    ctx.fillRect(0, 0, W, RULER_H)
    // loop strip
    if (p.loop.on && p.loop.end > p.loop.start) {
      const a = p.loop.start * pps - sx, b = p.loop.end * pps - sx
      ctx.fillStyle = this.rgb(C.accent, 0.55)
      ctx.fillRect(a, 2, Math.max(2, b - a), 8)
    }
    const bars = this.S.clockBars
    ctx.font = '10.5px Geist Mono, ui-monospace, monospace'
    ctx.textBaseline = 'top'
    const beatLen = 60 / p.bpm
    let step, major
    if (bars) {
      const unit = beatLen * p.beats
      step = unit
      while (step * pps < 70) step *= 2
      major = step
    } else {
      step = niceStep(80 / pps)
      major = step
    }
    const t0 = Math.floor(sx / pps / major) * major
    ctx.strokeStyle = this.rgb(C.muted, 0.7)
    ctx.fillStyle = this.rgb(C.muted)
    for (let t = t0; t * pps - sx < W + 80; t += major) {
      const x = Math.round(t * pps - sx) + 0.5
      ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, RULER_H); ctx.stroke()
      ctx.fillText(bars ? fmtBars(t, p.bpm, p.beats).split('.')[0] : fmtTick(t, major), x + 4, 15)
      const minor = bars ? beatLen : major / 5
      const mc = Math.round(major / minor)
      if (minor * pps >= 6) for (let k = 1; k < mc; k++) {
        const mx = Math.round((t + k * minor) * pps - sx) + 0.5
        ctx.beginPath(); ctx.moveTo(mx, RULER_H - 6); ctx.lineTo(mx, RULER_H); ctx.stroke()
      }
    }
    ctx.fillStyle = this.rgb(C.border)
    ctx.fillRect(0, RULER_H - 1, W, 1)
  }

  updateOverlays() {
    const S = this.S, p = S.project, th = p.trackH, pps = this.pps, sc = this.scrollEl
    const pos = S.playheadNow()
    this.playhead.style.transform = `translateX(${Math.round(pos * pps)}px)`
    const rx = pos * pps - sc.scrollLeft
    this.rph.style.transform = `translateX(${rx}px)`
    this.rph.hidden = rx < -4 || rx > this.W + 4
    const r = S.sel.range
    if (r) {
      const first = p.tracks.findIndex((t) => r.ids.includes(t.id))
      const cnt = p.tracks.filter((t) => r.ids.includes(t.id)).length
      this.rangeEl.hidden = first < 0
      Object.assign(this.rangeEl.style, { left: `${r.t0 * pps}px`, width: `${Math.max(1, (r.t1 - r.t0) * pps)}px`, top: `${first * th}px`, height: `${cnt * th}px` })
    } else this.rangeEl.hidden = true
    const l = p.loop
    this.loopBand.hidden = !l.on || !(l.end > l.start)
    if (!this.loopBand.hidden) Object.assign(this.loopBand.style, { left: `${l.start * pps}px`, width: `${(l.end - l.start) * pps}px` })
  }

  // ---------- Hit testing ----------
  pt(e) {
    const sc = this.scrollEl
    const r = sc.getBoundingClientRect()
    const x = e.clientX - r.left + sc.scrollLeft
    const y = e.clientY - r.top + sc.scrollTop
    const p = this.S.project
    const ti = y >= 0 && y < p.tracks.length * p.trackH ? Math.floor(y / p.trackH) : -1
    return { x, y, t: Math.max(0, x / this.pps), ti, viewX: e.clientX - r.left, viewY: e.clientY - r.top }
  }
  onScrollbar(pt) { return pt.viewX > this.W || pt.viewY > this.H }

  /** Which clip and part of it is under the point, if any. */
  hit(pt) {
    const p = this.S.project, th = p.trackH
    if (pt.ti < 0) return null
    const track = p.tracks[pt.ti]
    const laneTop = pt.ti * th
    const y0 = laneTop + 3
    if (pt.y < y0 || pt.y > y0 + th - 6) return null
    for (let i = track.clips.length - 1; i >= 0; i--) {
      const c = track.clips[i]
      const sx = c.start * this.pps, ex = clipEnd(c) * this.pps
      if (pt.x < sx - 3 || pt.x > ex + 3) continue
      const w = ex - sx
      const sel = this.S.sel.clips.has(c.id) || this.hover?.clipId === c.id
      if (w > 26 && sel) {
        const hy = y0 + LABEL_H / 2
        if (Math.hypot(pt.x - (sx + c.fadeIn * this.pps), pt.y - hy) < 9) return { clip: c, track, zone: 'fadeIn' }
        if (Math.hypot(pt.x - (ex - c.fadeOut * this.pps), pt.y - hy) < 9) return { clip: c, track, zone: 'fadeOut' }
      }
      if (pt.x < sx || pt.x > ex) continue
      if (w > 14) {
        if (pt.x - sx <= 6) return { clip: c, track, zone: 'trimL' }
        if (ex - pt.x <= 6) return { clip: c, track, zone: 'trimR' }
      }
      if (sel) {
        const ay = y0 + LABEL_H, ah = th - 6 - LABEL_H
        if (Math.abs(pt.y - (ay + ah * (1 - c.gain / 2))) <= 5 && pt.y > ay) return { clip: c, track, zone: 'gain' }
      }
      return { clip: c, track, zone: 'body' }
    }
    return null
  }

  /**
   * Snap a time. Clip edges, the playhead and loop points are magnetic within 8 px; the grid (when on) always quantizes,
   * using a coarser multiple when zoomed so far out that grid lines would be closer than 8 px.
   */
  snap(t, ignore) {
    const S = this.S, p = S.project
    t = Math.max(0, t)
    if (!p.snap || this.noSnap) return t
    const tol = 8 / this.pps
    let edge = null, ed = tol
    const cand = (c) => { const d = Math.abs(c - t); if (d < ed) { ed = d; edge = c } }
    for (const tr of p.tracks) for (const c of tr.clips) {
      if (ignore?.has(c.id)) continue
      cand(c.start)
      cand(clipEnd(c))
    }
    cand(S.playheadNow())
    if (p.loop.on) { cand(p.loop.start); cand(p.loop.end) }
    let step = gridStep(p)
    let grid = null
    if (step) {
      while (step * this.pps < 8) step *= 2
      grid = Math.round(t / step) * step
    }
    if (edge != null && (grid == null || ed <= Math.abs(grid - t))) return Math.max(0, edge)
    return Math.max(0, grid ?? t)
  }

  // ---------- Pointer: lanes ----------
  down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const pt = this.pt(e)
    if (this.onScrollbar(pt)) return
    this.noSnap = e.altKey
    const S = this.S
    const tool = S.tool
    this.app.focusRoot()
    const hit = tool === 'range' ? null : this.hit(pt)
    const base = { id: e.pointerId, cx: e.clientX, cy: e.clientY, pt, moved: false }
    if (tool === 'blade') {
      if (pt.ti >= 0) {
        const c = this.hit(pt)
        const t = this.snap(pt.t)
        this.app.splitAtClick(pt.ti, c?.clip, t)
      }
      return
    }
    this.scrollEl.setPointerCapture(e.pointerId)
    if (!hit) {
      S.sel.track = pt.ti >= 0 ? S.project.tracks[pt.ti].id : S.sel.track
      this.drag = { ...base, type: 'range', ti0: pt.ti, t0: this.snap(pt.t), shift: e.shiftKey }
      return
    }
    const { clip, zone } = hit
    if (zone === 'body') {
      if (e.shiftKey) {
        if (S.sel.clips.has(clip.id)) S.sel.clips.delete(clip.id)
        else S.sel.clips.add(clip.id)
        S.sel.range = null
        this.app.selectionChanged()
        this.drag = { ...base, type: 'none' }
        return
      }
      if (!S.sel.clips.has(clip.id)) S.sel.clips = new Set([clip.id])
      S.sel.range = null
      S.sel.track = hit.track.id
      this.app.selectionChanged()
      this.drag = { ...base, type: 'move', clip, ti0: pt.ti }
      return
    }
    S.sel.clips = new Set([clip.id])
    S.sel.range = null
    S.sel.track = hit.track.id
    this.app.selectionChanged()
    this.drag = { ...base, type: zone, clip, o: { start: clip.start, offset: clip.offset, dur: clip.dur, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, gain: clip.gain }, end: this.app.beginGesture() }
  }

  move(e) {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return this.hoverMove(e)
    const pt = this.pt(e)
    this.noSnap = e.altKey
    if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 3) return
    d.moved = true
    const S = this.S, p = S.project
    const r = this.scrollEl.getBoundingClientRect()
    if (e.clientX > r.right - 28) this.scrollEl.scrollLeft += 18
    else if (e.clientX < r.left + 28) this.scrollEl.scrollLeft -= 18
    const dt = (e.clientX - d.cx) / this.pps
    switch (d.type) {
      case 'range': {
        const t1 = this.snap(pt.t)
        const tiNow = clamp(pt.ti < 0 ? (pt.y < 0 ? 0 : p.tracks.length - 1) : pt.ti, 0, p.tracks.length - 1)
        const lo = Math.min(Math.max(d.ti0, 0), tiNow), hi = Math.max(Math.max(d.ti0, 0), tiNow)
        const a = Math.min(d.t0, t1), b = Math.max(d.t0, t1)
        if (b - a < 0.003 || !p.tracks.length) S.sel.range = null
        else S.sel.range = { t0: a, t1: b, ids: p.tracks.slice(lo, hi + 1).map((t) => t.id) }
        if (!d.shift) S.sel.clips = new Set()
        this.app.selectionChanged(true)
        break
      }
      case 'move': {
        if (!d.start) this.startMove(d)
        this.applyMove(d, dt, pt)
        break
      }
      case 'trimL': {
        const asset = S.assets.get(d.clip.asset)
        const o = d.o
        const lo = Math.max(0, o.start - o.offset)
        const ns = clamp(this.snap(o.start + dt, new Set([d.clip.id])), lo, o.start + o.dur - 0.01)
        const delta = ns - o.start
        Object.assign(d.clip, { start: ns, offset: o.offset + delta, dur: o.dur - delta })
        clampClip(d.clip, asset?.duration)
        break
      }
      case 'trimR': {
        const asset = S.assets.get(d.clip.asset)
        const o = d.o
        const maxEnd = o.start + (asset ? asset.duration - o.offset : o.dur)
        const ne = clamp(this.snap(o.start + o.dur + dt, new Set([d.clip.id])), o.start + 0.01, maxEnd)
        d.clip.dur = ne - o.start
        clampClip(d.clip, asset?.duration)
        break
      }
      case 'fadeIn': d.clip.fadeIn = clamp(pt.t - d.clip.start, 0, d.clip.dur - d.clip.fadeOut); break
      case 'fadeOut': d.clip.fadeOut = clamp(clipEnd(d.clip) - pt.t, 0, d.clip.dur - d.clip.fadeIn); break
      case 'gain': {
        const th = p.trackH
        const laneTop = p.tracks.findIndex((t) => t.clips.includes(d.clip)) * th
        const ay = laneTop + 3 + LABEL_H, ah = th - 6 - LABEL_H
        let g = clamp((1 - (pt.y - ay) / ah) * 2, 0, 2)
        if (Math.abs(g - 1) < 0.04) g = 1
        for (const id of S.sel.clips) { const f = this.app.findClip(id); if (f) f.clip.gain = g }
        this.app.status(`Clip gain ${g <= 0.001 ? '-inf' : (20 * Math.log10(g)).toFixed(1)} dB`)
        break
      }
      default: break
    }
    this.invalidate()
    this.updateOverlays()
  }

  startMove(d) {
    const S = this.S, p = S.project
    d.end = this.app.beginGesture()
    d.start = new Map()
    d.ids = new Set(S.sel.clips)
    for (const id of S.sel.clips) {
      const f = this.app.findClip(id)
      if (f) d.start.set(id, { start: f.clip.start, ti: p.tracks.indexOf(f.track) })
    }
    d.min = Math.min(...[...d.start.values()].map((o) => o.start))
  }

  applyMove(d, dt, pt) {
    const S = this.S, p = S.project, n = p.tracks.length
    const prim = d.start.get(d.clip.id)
    const dur = d.clip.dur
    const want = prim.start + dt
    const s1 = this.snap(want, d.ids)
    const e1 = this.snap(want + dur, d.ids) - dur
    let ns = Math.abs(s1 - want) <= Math.abs(e1 - want) ? s1 : e1
    ns = Math.max(prim.start - d.min, ns)
    const delta = ns - prim.start
    const tiNow = clamp(pt.ti < 0 ? (pt.y < 0 ? 0 : n - 1) : pt.ti, 0, n - 1)
    const dTi = tiNow - d.ti0
    for (const [id, o] of d.start) {
      const f = this.app.findClip(id)
      if (!f) continue
      f.clip.start = Math.max(0, o.start + delta)
      const want = clamp(o.ti + dTi, 0, n - 1)
      const dest = p.tracks[want]
      if (dest !== f.track) {
        f.track.clips.splice(f.track.clips.indexOf(f.clip), 1)
        dest.clips.push(f.clip)
      }
    }
    S.sel.track = p.tracks[clamp(prim.ti + dTi, 0, n - 1)].id
  }

  up(e, cancelled) {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    this.drag = null
    const S = this.S
    try { this.scrollEl.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    const pt = this.pt(e)
    if (d.type === 'range') {
      if (!d.moved) {
        S.sel.range = null
        if (!d.shift) S.sel.clips = new Set()
        if (!cancelled) this.app.setPlayhead(this.snap(d.pt.t))
      }
      this.app.selectionChanged()
    } else if (d.type === 'move' && !d.moved) {
      if (S.sel.clips.size > 1) { S.sel.clips = new Set([d.clip.id]); this.app.selectionChanged() } // a plain click narrows a multi-selection
      if (!cancelled) this.app.setPlayhead(this.snap(pt.t))
    } else if (d.end) {
      const label = { move: 'Move clip', trimL: 'Trim clip start', trimR: 'Trim clip end', fadeIn: 'Fade in', fadeOut: 'Fade out', gain: 'Clip gain' }[d.type] || 'Edit clip'
      if (cancelled) this.app.revertGesture?.()
      d.end(label, 'engine save insp heads')
    }
    this.app.status('')
    this.invalidate()
    this.updateOverlays()
  }

  hoverMove(e) {
    if (e.buttons) return
    const pt = this.pt(e)
    if (this.onScrollbar(pt)) return
    const tool = this.S.tool
    let cur = tool === 'range' ? 'crosshair' : tool === 'blade' ? 'crosshair' : 'default'
    let hover = null
    if (tool === 'select') {
      // look for a clip under the pointer first (so its handles become hit-testable), then re-test with it hovered
      const prev = this.hover
      this.hover = null
      let hit = this.hit(pt)
      if (hit) { this.hover = { clipId: hit.clip.id }; hit = this.hit(pt) }
      hover = this.hover
      this.hover = prev
      cur = !hit ? 'default' : { body: 'grab', trimL: 'ew-resize', trimR: 'ew-resize', fadeIn: 'ew-resize', fadeOut: 'ew-resize', gain: 'ns-resize' }[hit.zone]
    } else if (tool === 'blade') {
      const hit = this.hit(pt)
      hover = hit ? { clipId: hit.clip.id } : null
      cur = hit ? 'col-resize' : 'default'
    }
    this.scrollEl.style.cursor = cur
    if ((hover?.clipId || null) !== (this.hover?.clipId || null)) { this.hover = hover; this.invalidate() }
  }

  dbl(e) {
    const pt = this.pt(e)
    const hit = this.hit(pt)
    if (hit) {
      this.S.sel.clips = new Set([hit.clip.id])
      this.app.selectionChanged()
      this.app.showTab('clip')
    }
  }

  // ---------- Pointer: ruler ----------
  rulerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    this.ruler.setPointerCapture(e.pointerId)
    const r = this.ruler.getBoundingClientRect()
    const t = Math.max(0, (e.clientX - r.left + this.scrollEl.scrollLeft) / this.pps)
    this.noSnap = e.altKey
    if (e.clientY - r.top < 12 || e.shiftKey) {
      this.rdrag = { type: 'loop', t0: this.snap(t), end: this.app.beginGesture(), moved: false }
    } else {
      this.rdrag = { type: 'scrub' }
      this.app.setPlayhead(this.snap(t))
    }
  }
  rulerMove(e) {
    const d = this.rdrag
    if (!d) return
    const r = this.ruler.getBoundingClientRect()
    const t = Math.max(0, (e.clientX - r.left + this.scrollEl.scrollLeft) / this.pps)
    this.noSnap = e.altKey
    if (d.type === 'scrub') this.app.setPlayhead(this.snap(t))
    else {
      const t1 = this.snap(t)
      const a = Math.min(d.t0, t1), b = Math.max(d.t0, t1)
      if (b - a > 0.01) { d.moved = true; Object.assign(this.S.project.loop, { start: a, end: b, on: true }); this.app.loopChanged(); this.drawRuler(); this.updateOverlays(); this.invalidate() }
    }
  }
  rulerUp(e) {
    const d = this.rdrag
    this.rdrag = null
    if (!d) return
    try { this.ruler.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    if (d.type === 'loop') {
      if (!d.moved) this.app.setPlayhead(this.snap(d.t0))
      d.end('Set loop', 'engine save insp')
    }
  }
}
