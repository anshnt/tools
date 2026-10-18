// Stereo panning lab: Web Audio demo of StereoPannerNode (equal-power pan law) and PannerNode (HRTF or equal-power 3D positioning)
// with test tones, pink noise, a beep sequence or your own audio file, an auto-pan LFO, live L and R meters and a goniometer.
// Everything runs locally; the AudioContext is created only after a click.
import { h, icon, button, alert, select, rangeField, segmented, toggle, card, split, dropzone, clear, onCleanup, formatDuration } from '../../lib/ui.js'

// ---------- Pure math ----------
const HALF_PI = Math.PI / 2
const clampPan = (p) => Math.max(-1, Math.min(1, Number(p) || 0))

/** Equal-power gains for a mono source (the StereoPannerNode law): x = (pan + 1) / 2, L = cos(x * PI/2), R = sin(x * PI/2). */
export function equalPowerGains(pan) {
  const x = (clampPan(pan) + 1) / 2
  return { l: Math.cos(x * HALF_PI), r: Math.sin(x * HALF_PI) }
}
/** Linear (constant-sum) law for comparison: the center sits at 0.5 (-6 dB). */
export function linearGains(pan) {
  const p = clampPan(pan)
  return { l: (1 - p) / 2, r: (1 + p) / 2 }
}
/**
 * What a StereoPannerNode outputs for one sample frame, following the Web Audio spec.
 * Mono input (inR undefined): equal-power split. Stereo input: panning left keeps L and folds part of R into L, and the reverse.
 */
export function stereoPannerOutput(pan, inL, inR) {
  const p = clampPan(pan)
  if (inR === undefined) { const g = equalPowerGains(p); return { l: inL * g.l, r: inL * g.r } }
  const x = p <= 0 ? p + 1 : p
  const gL = Math.cos(x * HALF_PI), gR = Math.sin(x * HALF_PI)
  return p <= 0 ? { l: inL + inR * gL, r: inR * gR } : { l: inL * gL, r: inR + inL * gR }
}
/** Linear gain to decibels; silence is clamped to -Infinity. */
export const toDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity)

/** RMS and peak of a block of samples in dBFS (silence clamps to -100). */
export function levels(samples) {
  let sum = 0, peak = 0
  for (let i = 0; i < samples.length; i++) { const v = samples[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a }
  const rms = Math.sqrt(sum / Math.max(1, samples.length))
  const db = (v) => (v > 1e-5 ? 20 * Math.log10(v) : -100)
  return { rms: db(rms), peak: db(peak) }
}

/** PannerNode distance gain (Web Audio spec formulas). model: 'linear' | 'inverse' | 'exponential'. */
export function distanceGain(model, d, ref = 1, max = 10000, rolloff = 1) {
  const dist = Math.max(0, d)
  if (model === 'linear') {
    const r = Math.max(0, Math.min(1, rolloff))
    if (max <= ref) return 1
    const dd = Math.min(Math.max(dist, ref), max)
    return 1 - (r * (dd - ref)) / (max - ref)
  }
  if (model === 'exponential') {
    if (ref <= 0) return 1
    return Math.pow(Math.max(dist, ref) / ref, -rolloff)
  }
  if (ref <= 0 && rolloff === 0) return 1
  return ref / (ref + rolloff * (Math.max(dist, ref) - ref))
}

/** Azimuth in degrees of a source at (x, z) with the listener facing -z: 0 is front, 90 right, -90 left, 180 behind. */
export const azimuth = (x, z) => (Math.atan2(x, -z) * 180) / Math.PI
export function directionWord(az) {
  const a = Math.abs(az)
  const side = az > 0 ? 'right' : 'left'
  if (a < 15) return 'in front'
  if (a > 165) return 'behind'
  if (a < 75) return `front ${side}`
  if (a <= 105) return `hard ${side}`
  return `behind ${side}`
}

/** Auto-pan LFO value at time t (seconds): depth * sin(2 PI rate t). */
export const lfo = (t, rate, depth) => depth * Math.sin(2 * Math.PI * rate * t)

/** Goniometer mapping: mid (L + R) goes up, side (R - L) goes right. */
export const msPoint = (l, r) => ({ x: (r - l) * Math.SQRT1_2, y: (l + r) * Math.SQRT1_2 })

/** Pink noise (Paul Kellet's filter) as a Float32Array, normalized to the given peak. */
export function pinkNoise(n, rand = Math.random, peak = 0.5) {
  const out = new Float32Array(n)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, max = 0
  for (let i = 0; i < n; i++) {
    const w = rand() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
    out[i] = v
    const a = Math.abs(v); if (a > max) max = a
  }
  if (max > 0) for (let i = 0; i < n; i++) out[i] *= peak / max
  return out
}

/** A 2 second looping beep sequence: short and long pitched beeps with gaps, easy to place in space. */
export function beepSequence(sampleRate = 48000) {
  const out = new Float32Array(Math.round(sampleRate * 2))
  const notes = [[0, 0.12, 660], [0.18, 0.12, 660], [0.5, 0.3, 880], [1.0, 0.1, 990], [1.15, 0.1, 740], [1.3, 0.25, 550]]
  for (const [start, dur, f] of notes) {
    const s0 = Math.round(start * sampleRate), n = Math.round(dur * sampleRate), fade = Math.round(0.008 * sampleRate)
    for (let i = 0; i < n && s0 + i < out.length; i++) {
      const env = Math.min(1, i / fade, (n - i) / fade)
      out[s0 + i] += 0.45 * env * Math.sin((2 * Math.PI * f * i) / sampleRate)
    }
  }
  return out
}

/** Frequency slider: 0..100 maps logarithmically to 50 Hz..5 kHz. */
export const sliderToFreq = (v) => Math.round(50 * Math.pow(100, v / 100))
export const freqToSlider = (f) => (100 * Math.log(f / 50)) / Math.log(100)

// ---------- UI ----------
const CSS = `
.t-spl{--sp-l:var(--accent);--sp-r:var(--accent-2)}
.t-spl .meters{display:grid;gap:10px}
.t-spl .meter-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px 10px;align-items:center}
.t-spl .ch{font:700 15px var(--mono);width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:var(--surface-2);border:1px solid var(--border);color:var(--text)}
.t-spl .meter{position:relative;height:26px;border-radius:9px;background:var(--surface-3);overflow:hidden}
.t-spl .meter .bar{position:absolute;inset:0;background:linear-gradient(90deg,var(--success) 0%,var(--success) 60%,var(--warning) 85%,var(--danger) 100%);clip-path:inset(0 100% 0 0)}
.t-spl .meter .pk{position:absolute;top:3px;bottom:3px;width:3px;border-radius:2px;background:var(--text);left:0;opacity:.85}
.t-spl .meter-row .val{grid-column:2;font:600 12px var(--mono);color:var(--text-2);font-variant-numeric:tabular-nums;margin-top:-4px}
.t-spl .scale{display:flex;justify-content:space-between;font:11px var(--mono);color:var(--muted);margin-left:38px}
.t-spl .gonio-wrap{position:relative;width:100%;max-width:260px;aspect-ratio:1;margin:0 auto}
.t-spl .gonio-wrap canvas{width:100%;height:100%;display:block;border-radius:var(--radius);background:var(--surface-2);border:1px solid var(--border)}
.t-spl .gonio-wrap .lb{position:absolute;font:600 11px var(--mono);color:var(--muted);pointer-events:none}
.t-spl .chart{width:100%;max-width:400px;height:auto;display:block;margin:0 auto}
.t-spl .chart text{font:11px var(--mono);fill:var(--muted)}
.t-spl .chart .lbl{font-weight:700;fill:var(--text)}
.t-spl .chart .axis{stroke:var(--border-strong);stroke-width:1}
.t-spl .chart .gridl{stroke:var(--border);stroke-width:1;stroke-dasharray:2 4}
.t-spl .chart .cl{fill:none;stroke:var(--sp-l);stroke-width:2.5}
.t-spl .chart .cr{fill:none;stroke:var(--sp-r);stroke-width:2.5;stroke-dasharray:7 4}
.t-spl .chart .lin{fill:none;stroke:var(--muted);stroke-width:1.2;stroke-dasharray:2 3}
.t-spl .chart .cursor{stroke:var(--text);stroke-width:1.2}
.t-spl .chart .dl{fill:var(--sp-l)}
.t-spl .chart .dr{fill:var(--sp-r)}
.t-spl .field2d{position:relative;width:100%;max-width:420px;aspect-ratio:1;margin:0 auto;border-radius:var(--radius-lg);background:var(--surface-2);border:1px solid var(--border);touch-action:none;overflow:hidden}
.t-spl .field2d svg{position:absolute;inset:0;width:100%;height:100%}
.t-spl .field2d .ring{fill:none;stroke:var(--border-strong);stroke-width:.6;stroke-dasharray:2 3}
.t-spl .field2d .refring{fill:color-mix(in srgb,var(--accent) 8%,transparent);stroke:var(--accent);stroke-width:.6}
.t-spl .field2d .head{fill:var(--surface);stroke:var(--text-2);stroke-width:1.2}
.t-spl .field2d text{font:6px var(--mono);fill:var(--muted)}
.t-spl .field2d .ear{font-weight:700;fill:var(--text)}
.t-spl .field2d .trail{fill:none;stroke:var(--accent);stroke-width:.8;opacity:.6}
.t-spl .src{position:absolute;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 22%,var(--surface));color:var(--accent);display:grid;place-items:center;cursor:grab;padding:0;touch-action:none}
.t-spl .src .icon{width:17px;height:17px}
.t-spl .src:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
.t-spl .src.drag{cursor:grabbing}
.t-spl .swap{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.t-spl .swap div{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;border-radius:14px;border:1px dashed var(--border-strong);font:700 16px var(--font);color:var(--muted);transition:background .15s,color .15s}
.t-spl .swap div.on{border-style:solid;border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.t-spl .readout{font:600 13px var(--mono);color:var(--text-2);font-variant-numeric:tabular-nums}
.t-spl .note{font-size:13.5px;color:var(--text-2);line-height:1.55}
.t-spl .note b{color:var(--text)}
@media (prefers-reduced-motion: reduce){.t-spl .swap div{transition:none}}
`
function injectCss() {
  if (document.getElementById('t-spl-css')) return
  document.head.append(h('style', { id: 't-spl-css' }, CSS))
}

const SOURCES = [['sine', 'Sine tone'], ['square', 'Square tone'], ['sawtooth', 'Sawtooth tone'], ['pink', 'Pink noise'], ['beeps', 'Beep sequence'], ['file', 'Your audio file']]
const FIELD_RANGE = 8 // meters from the listener to the edge of the 2D field
const fmtDb = (db) => (Number.isFinite(db) && db > -99 ? `${db > 0 ? '+' : ''}${db.toFixed(1)} dB` : '-∞ dB')

function panChart() {
  const W = 320, H = 170, L = 34, R = 12, T = 12, B = 30
  const px = (p) => L + ((p + 1) / 2) * (W - L - R)
  const py = (g) => T + (1 - g) * (H - T - B)
  const pts = (fn) => Array.from({ length: 81 }, (_, i) => { const p = -1 + i / 40; return `${px(p).toFixed(1)},${py(fn(p)).toFixed(1)}` }).join(' ')
  const el = h('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Left and right gain against pan position for the equal-power law, with the linear law dotted for comparison' })
  const grid = [0, 0.5, Math.SQRT1_2, 1].map((g) => [
    h('line', { class: 'gridl', x1: L, x2: W - R, y1: py(g), y2: py(g) }),
    h('text', { x: L - 5, y: py(g) + 3.5, 'text-anchor': 'end' }, g === Math.SQRT1_2 ? '.707' : String(g)),
  ])
  const cursor = h('line', { class: 'cursor', y1: T, y2: H - B })
  const dl = h('circle', { class: 'dl', r: 4.5 })
  const dr = h('rect', { class: 'dr', width: 8, height: 8 })
  el.append(
    ...grid.flat(),
    h('line', { class: 'axis', x1: L, x2: W - R, y1: H - B, y2: H - B }),
    h('line', { class: 'axis', x1: L, x2: L, y1: T, y2: H - B }),
    h('polyline', { class: 'lin', points: pts((p) => linearGains(p).l) }),
    h('polyline', { class: 'lin', points: pts((p) => linearGains(p).r) }),
    h('polyline', { class: 'cl', points: pts((p) => equalPowerGains(p).l) }),
    h('polyline', { class: 'cr', points: pts((p) => equalPowerGains(p).r) }),
    h('text', { class: 'lbl', x: px(-1) + 4, y: py(1) + 12 }, 'L'),
    h('text', { class: 'lbl', x: px(1) - 12, y: py(1) + 12 }, 'R'),
    h('text', { x: px(-1), y: H - 10, 'text-anchor': 'start' }, '-1 left'),
    h('text', { x: px(0), y: H - 10, 'text-anchor': 'middle' }, '0'),
    h('text', { x: px(1), y: H - 10, 'text-anchor': 'end' }, 'right +1'),
    cursor, dl, dr)
  el.set = (pan) => {
    const g = equalPowerGains(pan)
    const x = px(clampPan(pan))
    cursor.setAttribute('x1', x); cursor.setAttribute('x2', x)
    dl.setAttribute('cx', x); dl.setAttribute('cy', py(g.l))
    dr.setAttribute('x', x - 4); dr.setAttribute('y', py(g.r) - 4)
  }
  el.set(0)
  return el
}

export function mount(root, { signal } = {}) {
  injectCss()
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const wrap = h('div', { class: 't-spl stack' })
  root.append(wrap)

  // ----- state -----
  let ac = null, nodes = null, srcNode = null, playing = false, disposed = false
  let mode = 'stereo', sourceKind = 'sine', freq = 440, basePan = 0, livePan = 0, volume = 0.15
  let pos = { x: 2, z: -3 }, livePos = { ...pos }
  let lfoOn = false, lfoRate = 0.5, lfoDepth = 1
  let fileBuf = null, fileName = ''
  let noiseBuf = null, beepBuf = null
  let raf = 0, lfoTimer = 0, swapTimers = []
  const peakHold = { l: -100, r: -100 }

  // ----- audio graph -----
  function ensureAudio() {
    if (ac) return ac
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) throw new Error('This browser does not support Web Audio.')
    ac = new AC()
    const bus = ac.createGain()
    const stereo = ac.createStereoPanner()
    const p3 = ac.createPanner()
    const post = ac.createGain()
    const master = ac.createGain()
    const splitter = ac.createChannelSplitter(2)
    const anL = ac.createAnalyser(), anR = ac.createAnalyser()
    anL.fftSize = anR.fftSize = 2048
    master.gain.value = volume
    stereo.connect(post); p3.connect(post)
    post.connect(master); master.connect(ac.destination)
    post.connect(splitter); splitter.connect(anL, 0); splitter.connect(anR, 1)
    nodes = { bus, stereo, p3, post, master, anL, anR, bufL: new Float32Array(anL.fftSize), bufR: new Float32Array(anR.fftSize) }
    applyPannerParams()
    routeMode()
    applyPan(true)
    return ac
  }
  function routeMode() {
    if (!nodes) return
    try { nodes.bus.disconnect() } catch { /* not connected yet */ }
    nodes.bus.connect(mode === 'stereo' ? nodes.stereo : nodes.p3)
  }
  function applyPannerParams() {
    if (!nodes) return
    const p = nodes.p3
    p.panningModel = modelSel.value
    p.distanceModel = distSel.value
    p.refDistance = refDist
    p.maxDistance = maxDist
    p.rolloffFactor = rolloff
    p.positionY.value = 0
  }
  function applyPan(instant) {
    if (!nodes) return
    const t = ac.currentTime, k = instant ? 0.001 : 0.015
    nodes.stereo.pan.setTargetAtTime(livePan, t, k)
    nodes.p3.positionX.setTargetAtTime(livePos.x, t, k)
    nodes.p3.positionZ.setTargetAtTime(livePos.z, t, k)
  }
  function buildSource() {
    const kind = sourceKind
    let node, level = 1
    if (kind === 'sine' || kind === 'square' || kind === 'sawtooth') {
      node = ac.createOscillator()
      node.type = kind
      node.frequency.value = freq
      level = kind === 'sine' ? 0.5 : 0.22
    } else {
      let buf
      if (kind === 'pink') {
        if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate); noiseBuf.copyToChannel(pinkNoise(noiseBuf.length), 0) }
        buf = noiseBuf
      } else if (kind === 'beeps') {
        if (!beepBuf) { const d = beepSequence(ac.sampleRate); beepBuf = ac.createBuffer(1, d.length, ac.sampleRate); beepBuf.copyToChannel(d, 0) }
        buf = beepBuf
      } else {
        if (!fileBuf) return null
        buf = fileBuf
      }
      node = ac.createBufferSource()
      node.buffer = buf
      node.loop = true
    }
    const g = ac.createGain()
    g.gain.value = level
    node.connect(g); g.connect(nodes.bus)
    node.start()
    return { node, g }
  }
  function stopSource() {
    if (!srcNode) return
    const { node, g } = srcNode
    try { node.stop() } catch { /* already stopped */ }
    try { node.disconnect(); g.disconnect() } catch { /* already gone */ }
    srcNode = null
  }
  async function play() {
    if (sourceKind === 'file' && !fileBuf) { clear(msg, alert('warn', 'Choose an audio file first, or pick another source.')); return }
    ensureAudio()
    if (ac.state !== 'running') await ac.resume()
    stopSource()
    srcNode = buildSource()
    playing = !!srcNode
    clear(msg)
    syncPlayBtn()
    startLoops()
  }
  function stop() {
    stopSource()
    playing = false
    syncPlayBtn()
  }
  function restartIfPlaying() { if (playing) { stopSource(); srcNode = buildSource() } }

  // ----- loops: LFO (timer, keeps running in the background) and meters (animation frame) -----
  function startLoops() {
    if (!lfoTimer) lfoTimer = setInterval(lfoTick, 30)
    if (!raf && !document.hidden) raf = requestAnimationFrame(meterTick)
  }
  function lfoTick() {
    if (!ac) return
    const t = ac.currentTime
    if (lfoOn) {
      const v = lfo(t, lfoRate, lfoDepth)
      livePan = clampPan(basePan + v)
      const r = Math.hypot(pos.x, pos.z) || 1
      const a0 = Math.atan2(pos.x, -pos.z)
      const a = lfoDepth >= 1 ? a0 + 2 * Math.PI * lfoRate * t : a0 + v * Math.PI
      livePos = { x: r * Math.sin(a), z: -r * Math.cos(a) }
    } else { livePan = basePan; livePos = { ...pos } }
    applyPan(false)
  }
  function meterTick() {
    raf = 0
    if (disposed) return
    if (nodes) {
      nodes.anL.getFloatTimeDomainData(nodes.bufL)
      nodes.anR.getFloatTimeDomainData(nodes.bufR)
      paintMeter(meterL, levels(nodes.bufL), 'l')
      paintMeter(meterR, levels(nodes.bufR), 'r')
      paintGonio(nodes.bufL, nodes.bufR)
    }
    chart.set(livePan)
    panOut.textContent = panText(livePan)
    if (mode === '3d') { placeSrc(livePos); paint3dReadout(livePos) }
    if (!document.hidden && (playing || swapTimers.length || peakHold.l > -99 || peakHold.r > -99)) raf = requestAnimationFrame(meterTick)
  }
  const onVis = () => { if (!document.hidden && ac && !raf) raf = requestAnimationFrame(meterTick) }
  document.addEventListener('visibilitychange', onVis)

  // ----- meters -----
  const DB_MIN = -60
  function makeMeter(ch, label) {
    const bar = h('div', { class: 'bar' }), pk = h('div', { class: 'pk' }), val = h('div', { class: 'val' }, '-∞ dB')
    const m = h('div', { class: 'meter', role: 'meter', 'aria-label': `${label} channel level`, 'aria-valuemin': DB_MIN, 'aria-valuemax': 0, 'aria-valuenow': DB_MIN, dataset: { ch, rms: '-100', peak: '-100' } }, bar, pk)
    m.parts = { bar, pk, val }
    return h('div', { class: 'meter-row' }, h('span', { class: 'ch', 'aria-hidden': 'true' }, ch.toUpperCase()), m, val)
  }
  const rowL = makeMeter('l', 'Left'), rowR = makeMeter('r', 'Right')
  const meterL = rowL.querySelector('.meter'), meterR = rowR.querySelector('.meter')
  const frac = (db) => Math.max(0, Math.min(1, (db - DB_MIN) / -DB_MIN))
  function paintMeter(m, lv, ch) {
    const { bar, pk, val } = m.parts
    peakHold[ch] = lv.peak >= peakHold[ch] ? lv.peak : Math.max(lv.peak, peakHold[ch] - 0.6)
    bar.style.clipPath = `inset(0 ${(1 - frac(lv.rms)) * 100}% 0 0)`
    pk.style.left = `calc(${frac(peakHold[ch]) * 100}% - 3px)`
    val.textContent = `${fmtDb(lv.rms)} RMS · peak ${fmtDb(lv.peak)}`
    m.dataset.rms = lv.rms.toFixed(1)
    m.dataset.peak = lv.peak.toFixed(1)
    m.setAttribute('aria-valuenow', Math.max(DB_MIN, Math.round(lv.rms)))
    m.setAttribute('aria-valuetext', `${fmtDb(lv.rms)} RMS, peak ${fmtDb(lv.peak)}`)
  }
  const scale = h('div', { class: 'scale', 'aria-hidden': 'true' }, ['-60', '-45', '-30', '-15', '0 dB'].map((s) => h('span', s)))

  // ----- goniometer -----
  const gonio = h('canvas', { role: 'img', 'aria-label': 'Goniometer: a vertical line means mono, tilting toward L or R shows the pan, a wide cloud means wide stereo' })
  const gctx = gonio.getContext('2d')
  const gWrap = h('div', { class: 'gonio-wrap' }, gonio,
    h('span', { class: 'lb', style: 'left:50%;top:6px;transform:translateX(-50%)' }, 'M'),
    h('span', { class: 'lb', style: 'left:10px;top:10px' }, 'L'),
    h('span', { class: 'lb', style: 'right:10px;top:10px' }, 'R'),
    h('span', { class: 'lb', style: 'right:8px;top:50%;transform:translateY(-50%)' }, 'S'))
  let gColors = {}
  const readColors = () => {
    const cs = getComputedStyle(wrap)
    gColors = { bg: cs.getPropertyValue('--surface-2').trim(), axis: cs.getPropertyValue('--border-strong').trim(), dot: cs.getPropertyValue('--accent').trim() }
  }
  function sizeGonio() {
    const r = gonio.getBoundingClientRect()
    if (!r.width) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    gonio.width = Math.round(r.width * dpr); gonio.height = Math.round(r.height * dpr)
    paintGonio(null, null, true)
  }
  function paintGonio(bl, br, full) {
    const W = gonio.width, H = gonio.height
    if (!W) return
    gctx.globalAlpha = full || reduce ? 1 : 0.35
    gctx.fillStyle = gColors.bg
    gctx.fillRect(0, 0, W, H)
    gctx.globalAlpha = 1
    const cx = W / 2, cy = H / 2, R = W * 0.46
    gctx.strokeStyle = gColors.axis
    gctx.lineWidth = 1
    gctx.beginPath()
    gctx.moveTo(cx, cy - R); gctx.lineTo(cx, cy + R); gctx.moveTo(cx - R, cy); gctx.lineTo(cx + R, cy)
    gctx.moveTo(cx - R * 0.7, cy - R * 0.7); gctx.lineTo(cx + R * 0.7, cy + R * 0.7); gctx.moveTo(cx + R * 0.7, cy - R * 0.7); gctx.lineTo(cx - R * 0.7, cy + R * 0.7)
    gctx.stroke()
    if (!bl) return
    gctx.fillStyle = gColors.dot
    const s = R * 1.2
    for (let i = 0; i < bl.length; i += 2) {
      const p = msPoint(bl[i], br[i])
      gctx.fillRect(cx + p.x * s - 1, cy - p.y * s - 1, 2, 2)
    }
  }

  // ----- controls -----
  const msg = h('div')
  const playBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => (playing ? stop() : play().catch((e) => clear(msg, alert('error', e.message || String(e))))) },
    h('span', { class: 'ic', style: 'display:contents' }, icon('play')), h('span', 'Play'))
  function syncPlayBtn() {
    playBtn.querySelector('.ic').replaceChildren(icon(playing ? 'square' : 'play'))
    playBtn.lastChild.textContent = playing ? 'Stop' : 'Play'
    playBtn.setAttribute('aria-pressed', String(playing))
  }
  const swapBtn = button('Swap check', { icon: 'headphones', title: 'Plays three beeps on the left, then three on the right' })
  const swapL = h('div', { 'aria-hidden': 'true' }, icon('arrow-left'), 'LEFT')
  const swapR = h('div', { 'aria-hidden': 'true' }, 'RIGHT', icon('arrow-right'))
  const swapLive = h('div', { class: 'small muted', 'aria-live': 'polite' }, 'Plays three low beeps in the left ear, then three higher beeps in the right ear.')
  swapBtn.addEventListener('click', async () => {
    try { ensureAudio(); if (ac.state !== 'running') await ac.resume() } catch (e) { clear(msg, alert('error', e.message)); return }
    if (swapTimers.length) return
    const t0 = ac.currentTime + 0.08
    const merger = ac.createChannelMerger(2)
    merger.connect(nodes.post)
    // duck the main source while the check plays
    nodes.bus.gain.setTargetAtTime(0, t0 - 0.06, 0.02)
    nodes.bus.gain.setTargetAtTime(1, t0 + 2.3, 0.05)
    const beep = (ch, at, f) => {
      const o = ac.createOscillator(), g = ac.createGain()
      o.frequency.value = f
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.5, at + 0.01); g.gain.setValueAtTime(0.5, at + 0.14); g.gain.linearRampToValueAtTime(0, at + 0.16)
      o.connect(g); g.connect(merger, 0, ch)
      o.start(at); o.stop(at + 0.2)
    }
    for (let i = 0; i < 3; i++) beep(0, t0 + i * 0.25, 440)
    for (let i = 0; i < 3; i++) beep(1, t0 + 1.2 + i * 0.25, 660)
    const at = (s, fn) => swapTimers.push(setTimeout(fn, s * 1000))
    swapL.classList.add('on'); swapLive.textContent = 'Left ear now: three low beeps.'
    at(1.15, () => { swapL.classList.remove('on'); swapR.classList.add('on'); swapLive.textContent = 'Right ear now: three higher beeps.' })
    at(2.0, () => { swapR.classList.remove('on'); swapLive.textContent = 'Done. Low beeps should have been on your left. If they were on the right, your headphones are swapped.' })
    at(2.4, () => { try { merger.disconnect() } catch { /* gone */ } swapTimers = [] })
    startLoops()
  })

  const srcSel = select(SOURCES, sourceKind, (v) => { sourceKind = v; freqField.hidden = !['sine', 'square', 'sawtooth'].includes(v); fileBox.hidden = v !== 'file'; if (playing) { if (v === 'file' && !fileBuf) stop(); else restartIfPlaying() } })
  const freqField = rangeField('Tone frequency', { min: 0, max: 100, step: 0.5, value: freqToSlider(freq), format: (v) => `${sliderToFreq(v)} Hz`, onInput: (v) => {
    freq = sliderToFreq(v)
    if (srcNode?.node.frequency) srcNode.node.frequency.setTargetAtTime(freq, ac.currentTime, 0.01)
  } })
  const fileInfo = h('div', { class: 'small muted' })
  const fileDrop = dropzone({ accept: 'audio/*,.mp3,.wav,.ogg,.oga,.m4a,.flac,.aac,.opus,.webm', compact: true, icon: 'file-audio', label: 'Choose an audio file', onFiles: async ([f]) => {
    if (f.size > 150 * 1024 * 1024) return clear(msg, alert('error', 'That file is over 150 MB. Use a shorter clip.'))
    clear(fileInfo, 'Decoding...')
    try {
      const data = await f.arrayBuffer()
      const off = new OfflineAudioContext(1, 1, ac?.sampleRate || 48000)
      fileBuf = await off.decodeAudioData(data)
      fileName = f.name
      clear(fileInfo, `${fileName} · ${formatDuration(fileBuf.duration)} · ${fileBuf.numberOfChannels === 1 ? 'mono' : `${fileBuf.numberOfChannels} channels`} · loops`)
      clear(msg)
      if (playing) restartIfPlaying()
    } catch {
      fileBuf = null
      clear(fileInfo)
      clear(msg, alert('error', `Could not decode "${f.name}". Try an MP3, WAV, OGG, FLAC or M4A file.`))
    }
  } })
  const fileBox = h('div', { class: 'stack', hidden: true }, fileDrop, fileInfo,
    h('div', { class: 'small muted' }, 'A stereo file is panned as stereo: moving left fades the right channel into the left, it does not just turn one side down.'))
  freqField.hidden = false

  const volField = rangeField('Master volume', { min: 0, max: 100, step: 1, value: Math.round(volume * 100), format: (v) => `${v}% (${fmtDb(toDb(v / 100))})`, hint: 'Starts low. Raise it slowly, especially on headphones.', onInput: (v) => {
    volume = v / 100
    if (nodes) nodes.master.gain.setTargetAtTime(volume, ac.currentTime, 0.02)
  } })

  // Mode A: stereo panner
  const panText = (p) => {
    const g = equalPowerGains(p)
    return `pan ${p >= 0 ? '+' : ''}${p.toFixed(2)} · L ${g.l.toFixed(3)} (${fmtDb(toDb(g.l))}) · R ${g.r.toFixed(3)} (${fmtDb(toDb(g.r))})`
  }
  const panOut = h('div', { class: 'readout', 'aria-live': 'off' }, panText(0))
  const panField = rangeField('Pan', { min: -1, max: 1, step: 0.01, value: 0, format: (v) => (v === 0 ? 'center' : `${v < 0 ? 'L' : 'R'} ${Math.abs(v).toFixed(2)}`), onInput: (v) => { basePan = v; if (!lfoOn) { livePan = v; applyPan(false) } if (!raf) meterTick() } })
  panField.input.setAttribute('aria-label', 'Pan from -1 (left) to +1 (right)')
  const centerBtn = button('Center', { size: 'sm', icon: 'align-center-vertical', onClick: () => { panField.set(0); basePan = 0; if (!lfoOn) livePan = 0; applyPan(false); if (!raf) meterTick() } })
  const chart = panChart()
  const modeA = h('div', { class: 'stack' },
    h('div', { class: 'row', style: 'align-items:end;flex-wrap:nowrap' }, h('div', { style: 'flex:1;min-width:0' }, panField), centerBtn),
    panOut, chart,
    h('p', { class: 'note' }, h('b', 'Equal-power pan law. '), 'StereoPannerNode splits a mono sound with L = cos(θ) and R = sin(θ), where θ goes from 0 to 90° as pan goes from -1 to +1. ',
      'Because L² + R² is always 1, the total power stays the same while the sound moves, so it does not get quieter in the middle. ',
      'At center both sides are 0.707 (-3 dB). The dotted lines show a linear law, which drops to 0.5 (-6 dB) at center and sounds like a dip.'))

  // Mode B: 3D panner
  let refDist = 1, maxDist = 50, rolloff = 1
  const modelSel = select([['HRTF', 'HRTF (best on headphones)'], ['equalpower', 'Equal power (left/right only)']], 'HRTF', () => applyPannerParams())
  const distSel = select([['inverse', 'Inverse (natural)'], ['linear', 'Linear'], ['exponential', 'Exponential']], 'inverse', () => { applyPannerParams(); paint3dReadout(livePos) })
  const refField = rangeField('Reference distance', { min: 0.5, max: 5, step: 0.1, value: refDist, format: (v) => `${v.toFixed(1)} m`, hint: 'Full volume up to this distance.', onInput: (v) => { refDist = v; applyPannerParams(); drawField(); paint3dReadout(livePos) } })
  const maxField = rangeField('Max distance', { min: 5, max: 100, step: 1, value: maxDist, format: (v) => `${v} m`, hint: 'Only the linear model stops getting quieter here.', onInput: (v) => { maxDist = v; applyPannerParams(); paint3dReadout(livePos) } })
  const rollField = rangeField('Rolloff factor', { min: 0, max: 4, step: 0.1, value: rolloff, format: (v) => v.toFixed(1), hint: 'How fast it gets quieter. Linear caps this at 1.', onInput: (v) => { rolloff = v; applyPannerParams(); paint3dReadout(livePos) } })

  const fsvg = h('svg', { viewBox: '-100 -100 200 200', 'aria-hidden': 'true' })
  const srcBtn = h('button', { type: 'button', class: 'src' }, icon('volume-2'))
  const field2d = h('div', { class: 'field2d' }, fsvg, srcBtn)
  const posOut = h('div', { class: 'readout' })
  const scaleF = 100 / FIELD_RANGE
  function drawField() {
    const rings = [2, 4, 6, 8].map((m) => [h('circle', { class: 'ring', r: m * scaleF }), h('text', { x: m * scaleF * 0.7071 + 1.5, y: -m * scaleF * 0.7071 - 1.5 }, `${m} m`)])
    clear(fsvg,
      h('circle', { class: 'refring', r: Math.min(refDist, FIELD_RANGE) * scaleF }),
      rings,
      h('line', { x1: -100, x2: 100, y1: 0, y2: 0, class: 'ring' }), h('line', { x1: 0, x2: 0, y1: -100, y2: 100, class: 'ring' }),
      h('polygon', { class: 'head', points: '0,-12 -4,-7 4,-7' }),
      h('circle', { class: 'head', r: 8 }),
      h('text', { class: 'ear', x: -17, y: 2.5, 'text-anchor': 'middle' }, 'L'), h('text', { class: 'ear', x: 17, y: 2.5, 'text-anchor': 'middle' }, 'R'),
      h('text', { x: 0, y: -90, 'text-anchor': 'middle' }, 'front'), h('text', { x: 0, y: 96, 'text-anchor': 'middle' }, 'behind'))
  }
  function placeSrc(p) {
    srcBtn.style.left = `${50 + (p.x / FIELD_RANGE) * 50}%`
    srcBtn.style.top = `${50 + (p.z / FIELD_RANGE) * 50}%`
  }
  function paint3dReadout(p) {
    const d = Math.hypot(p.x, p.z), az = azimuth(p.x, p.z)
    const g = distanceGain(distSel.value, d, refDist, maxDist, rolloff)
    posOut.textContent = `${d.toFixed(1)} m · ${Math.round(az)}° (${directionWord(az)}) · distance gain ${fmtDb(toDb(g))}`
    srcBtn.setAttribute('aria-label', `Sound source, ${d.toFixed(1)} meters ${directionWord(az)}. Drag or use arrow keys to move.`)
  }
  function setPos(x, z) {
    const lim = FIELD_RANGE
    pos = { x: Math.max(-lim, Math.min(lim, +x.toFixed(2))), z: Math.max(-lim, Math.min(lim, +z.toFixed(2))) }
    if (!lfoOn) livePos = { ...pos }
    placeSrc(livePos); paint3dReadout(livePos); applyPan(false)
  }
  {
    let id = null
    const toPos = (e) => {
      const r = field2d.getBoundingClientRect()
      setPos(((e.clientX - r.left) / r.width * 2 - 1) * FIELD_RANGE, ((e.clientY - r.top) / r.height * 2 - 1) * FIELD_RANGE)
    }
    srcBtn.addEventListener('pointerdown', (e) => { id = e.pointerId; srcBtn.setPointerCapture(id); srcBtn.classList.add('drag'); srcBtn.focus(); e.preventDefault() })
    srcBtn.addEventListener('pointermove', (e) => { if (e.pointerId === id) toPos(e) })
    const end = (e) => { if (e.pointerId === id) { id = null; srcBtn.classList.remove('drag') } }
    srcBtn.addEventListener('pointerup', end); srcBtn.addEventListener('pointercancel', end)
    field2d.addEventListener('pointerdown', (e) => { if (e.target === srcBtn || srcBtn.contains(e.target)) return; toPos(e) })
    srcBtn.addEventListener('keydown', (e) => {
      const d = e.shiftKey ? 1 : 0.25
      const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key]
      if (!mv) return
      e.preventDefault()
      setPos(pos.x + mv[0], pos.z + mv[1])
    })
  }
  const modeB = h('div', { class: 'stack', hidden: true },
    field2d, posOut,
    h('div', { class: 'small muted', style: 'text-align:center' }, 'Top view. You are in the middle, facing up. Drag the speaker, click the field, or focus it and use the arrow keys (Shift for 1 m steps).'),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Panning model'), modelSel),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Distance model'), distSel)),
    h('div', { class: 'grid-2' }, refField, maxField, rollField),
    h('p', { class: 'note' }, h('b', 'PannerNode. '), 'HRTF filters the sound the way your head and ears do, so on headphones you can hear front, side and some sense of behind. ',
      'Equal power only changes the left and right volume, so front and behind sound the same. Distance makes the sound quieter following the distance model.'))

  const modeSeg = segmented([['stereo', 'Stereo panner'], ['3d', '3D panner']], mode, (v) => {
    mode = v
    modeA.hidden = v !== 'stereo'
    modeB.hidden = v !== '3d'
    routeMode()
    if (v === '3d') { drawField(); placeSrc(livePos); paint3dReadout(livePos) }
    lfoHint.textContent = v === 'stereo' ? 'Sweeps the pan around the slider position.' : 'Swings the source around you. Depth 1 is a full orbit.'
  }, 'Panner type')
  modeSeg.classList.add('seg-fill')

  // Auto-pan LFO
  const lfoHint = h('div', { class: 'small muted' }, 'Sweeps the pan around the slider position.')
  const lfoTgl = toggle('Auto-pan (LFO)', false, (v) => { lfoOn = v; if (!v) { livePan = basePan; livePos = { ...pos }; applyPan(false) } startLoopsIfAudio() })
  const rateField = rangeField('LFO rate', { min: 0.05, max: 5, step: 0.05, value: lfoRate, format: (v) => `${v.toFixed(2)} Hz`, onInput: (v) => { lfoRate = v } })
  const depthField = rangeField('LFO depth', { min: 0, max: 1, step: 0.01, value: lfoDepth, format: (v) => v.toFixed(2), onInput: (v) => { lfoDepth = v } })
  function startLoopsIfAudio() { if (ac) startLoops() }

  // ----- layout -----
  const left = h('div', { class: 'stack' },
    card('Source',
      h('div', { class: 'stack' },
        h('div', { class: 'row' }, playBtn, h('div', { style: 'flex:1;min-width:160px' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Sound'), srcSel))),
        freqField, fileBox, volField, msg)),
    card('Panner', h('div', { class: 'stack' }, modeSeg, modeA, modeB)),
    card('Auto-pan', h('div', { class: 'stack' }, lfoTgl, lfoHint, h('div', { class: 'grid-2' }, rateField, depthField))))
  const right = h('div', { class: 'stack' },
    card('Levels', h('div', { class: 'stack' },
      h('div', { class: 'meters' }, rowL, rowR, scale),
      h('div', { class: 'small muted' }, 'Bar is RMS level, the thin line is the peak. Measured after the panner, before master volume.'))),
    card('Goniometer', h('div', { class: 'stack' }, gWrap,
      h('div', { class: 'small muted' }, 'Mono sound draws a line. Straight up means centered, leaning toward L or R follows the pan, and a round cloud means wide stereo.'))),
    card('Headphone check', h('div', { class: 'stack' }, h('div', { class: 'swap' }, swapL, swapR), swapLive, h('div', swapBtn))))
  wrap.append(
    h('div', { class: 'small muted' }, icon('headphones'), ' Use headphones for the clearest result. Sound starts only when you press Play, and nothing leaves your device.'),
    split(left, right))

  readColors()
  const ro = new ResizeObserver(sizeGonio)
  ro.observe(gonio)
  const mo = new MutationObserver(() => { readColors(); paintGonio(null, null, true) })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  drawField(); placeSrc(pos); paint3dReadout(pos)

  const dispose = () => {
    if (disposed) return
    disposed = true
    stopSource()
    clearInterval(lfoTimer)
    swapTimers.forEach(clearTimeout)
    if (raf) cancelAnimationFrame(raf)
    ro.disconnect(); mo.disconnect()
    document.removeEventListener('visibilitychange', onVis)
    if (ac) { const c = ac; ac = null; c.suspend().catch(() => {}).finally(() => c.close().catch(() => {})) }
  }
  onCleanup(dispose)
  signal?.addEventListener('abort', dispose)
  return dispose
}
