// Bullet pattern designer: a canvas bullet-hell (danmaku) pattern editor. Several emitters (ring, spiral, fan, wave, random burst,
// aimed) fire into a fixed 800 x 600 world that is simulated in fixed steps with an object pool and a bullet cap.
// Patterns export as JSON or a share link, and the canvas can be recorded to a WebM clip with MediaRecorder. Everything is local.
import { h, icon, button, busy, toast, alert, select, rangeField, toggle, card, split, textarea, dropzone, copyText, download, clear, onCleanup, formatNumber } from '../../lib/ui.js'

// ---------- Model (pure, no DOM) ----------
export const WORLD = { w: 800, h: 600 }
export const MAX_BULLETS = 4000
export const MAX_EMITTERS = 8
export const FIXED_DT = 1 / 120
const DEG = Math.PI / 180
const TAU = Math.PI * 2

export const TYPES = [['ring', 'Ring'], ['spiral', 'Spiral'], ['fan', 'Arc / fan'], ['wave', 'Wave (sweeping)'], ['burst', 'Random burst'], ['aimed', 'Aimed at target']]
export const COLORS = ['violet', 'rose', 'amber', 'teal', 'sky', 'lime', 'orange', 'ink']
const COLOR_LABEL = { violet: 'Violet', rose: 'Rose', amber: 'Amber', teal: 'Teal', sky: 'Sky', lime: 'Lime', orange: 'Orange', ink: 'Ink' }

// [min, max, step] for every numeric emitter field
export const LIMITS = {
  count: [1, 64, 1], rate: [0.2, 30, 0.1], speed: [10, 600, 5], accel: [-300, 300, 5], spin: [-720, 720, 5], curve: [-360, 360, 5],
  spread: [0, 360, 1], angle: [-180, 180, 1], waveAmp: [-80, 80, 1], waveFreq: [0, 8, 0.1], size: [1.5, 14, 0.5], life: [0.5, 12, 0.5],
}

const BASE = { count: 12, rate: 4, speed: 140, accel: 0, spin: 0, curve: 0, spread: 60, angle: 90, waveAmp: 0, waveFreq: 1, size: 5, life: 6 }
const TYPE_DEFAULTS = {
  ring: { count: 18, rate: 2, spin: 12, color: 'violet' },
  spiral: { count: 4, rate: 14, spin: 160, speed: 150, size: 4.5, color: 'rose' },
  fan: { count: 7, rate: 3, spread: 70, speed: 170, color: 'amber' },
  wave: { count: 6, rate: 10, spread: 70, waveFreq: 0.6, speed: 150, size: 4, color: 'teal' },
  burst: { count: 30, rate: 1.2, spread: 360, speed: 160, accel: -40, color: 'orange' },
  aimed: { count: 3, rate: 4, spread: 18, speed: 240, angle: 0, size: 4, color: 'sky' },
}

export function defaultEmitter(type = 'ring') {
  const t = TYPE_DEFAULTS[type] ? type : 'ring'
  return { type: t, ...BASE, color: 'violet', ...TYPE_DEFAULTS[t] }
}

const clampNum = (v, [lo, hi], fb) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb
}
const clamp01 = (v, fb) => clampNum(v, [0, 1], fb)

/** Clamp and fill one emitter so anything loaded from JSON or a link is safe to simulate. */
export function normalizeEmitter(e) {
  const src = e && typeof e === 'object' ? e : {}
  const type = TYPES.some(([k]) => k === src.type) ? src.type : 'ring'
  const d = defaultEmitter(type)
  const out = { type }
  for (const k of Object.keys(LIMITS)) out[k] = clampNum(src[k], LIMITS[k], d[k])
  out.count = Math.round(out.count)
  out.color = COLORS.includes(src.color) ? src.color : d.color
  return out
}

/** Validate a whole pattern. Throws with a readable message when it is not a pattern at all. */
export function normalizePattern(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('This is not a pattern. Expected a JSON object with an "emitters" list.')
  if (!Array.isArray(p.emitters) || !p.emitters.length) throw new Error('The pattern has no emitters. Add at least one emitter to the "emitters" list.')
  return {
    v: 1,
    name: typeof p.name === 'string' ? p.name.slice(0, 60) : 'Custom pattern',
    seed: Number.isInteger(p.seed) ? p.seed >>> 0 : 1,
    origin: { x: clamp01(p.origin?.x, 0.5), y: clamp01(p.origin?.y, 0.3) },
    target: { x: clamp01(p.target?.x, 0.5), y: clamp01(p.target?.y, 0.85) },
    emitters: p.emitters.slice(0, MAX_EMITTERS).map(normalizeEmitter),
  }
}

// base64url of UTF-8 JSON, for #/bullet-pattern-designer?p=...
export function encodePattern(p) {
  const bytes = new TextEncoder().encode(JSON.stringify(p))
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function decodePattern(s) {
  const b64 = String(s).trim().replace(/-/g, '+').replace(/_/g, '/')
  let bin
  try { bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)) } catch { throw new Error('The share link is damaged (not valid base64).') }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  let obj
  try { obj = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new Error('The share link is damaged (not valid JSON).') }
  return normalizePattern(obj)
}

/** Deterministic random numbers (mulberry32). Returns a function that yields [0, 1). */
export function makeRng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fan(push, base, n, spreadDeg) {
  if (n === 1) return push(base)
  const spread = spreadDeg * DEG
  // A full circle would put the first and last bullet on top of each other, so space them like a ring
  const stepA = spreadDeg >= 360 ? spread / n : spread / (n - 1)
  const start = spreadDeg >= 360 ? base : base - spread / 2
  for (let i = 0; i < n; i++) push(start + stepA * i)
}

/**
 * Bullets fired by one emitter at pattern time t (seconds).
 * ctx: {origin: {x, y}, target: {x, y}} in world units, rand: () => [0, 1).
 * Returns [{x, y, dir (radians, 0 = right, PI/2 = down), speed}].
 */
export function spawnBullets(e, t, ctx = {}) {
  const o = ctx.origin || { x: WORLD.w / 2, y: WORLD.h / 2 }
  const rand = ctx.rand || Math.random
  const n = Math.max(1, Math.round(e.count))
  const out = []
  const push = (a, sp = e.speed) => out.push({ x: o.x, y: o.y, dir: a, speed: sp })
  let base = (e.angle + e.spin * t) * DEG
  switch (e.type) {
    case 'ring':
    case 'spiral':
      for (let i = 0; i < n; i++) push(base + (TAU * i) / n)
      break
    case 'fan':
      fan(push, base, n, e.spread)
      break
    case 'wave':
      // The whole ring sweeps back and forth across the spread at the wave frequency
      base += (e.spread * DEG / 2) * Math.sin(TAU * e.waveFreq * t)
      for (let i = 0; i < n; i++) push(base + (TAU * i) / n)
      break
    case 'burst':
      for (let i = 0; i < n; i++) push(base + (rand() - 0.5) * e.spread * DEG, e.speed * (0.6 + 0.8 * rand()))
      break
    case 'aimed': {
      const tg = ctx.target || { x: o.x, y: WORLD.h }
      const aim = Math.atan2(tg.y - o.y, tg.x - o.x) + e.angle * DEG
      fan(push, aim, n, e.spread)
      break
    }
    default:
      push(base)
  }
  return out
}

/** Fresh simulation state for a pattern. Bullets live in a pool; pool[0..n-1] are alive. */
export function createState(pattern, { cap = MAX_BULLETS } = {}) {
  return { pattern, time: 0, n: 0, pool: [], cap, next: pattern.emitters.map(() => 0), rand: makeRng(pattern.seed), dropped: 0, spawned: 0 }
}

/** Call after emitters were added, removed or retimed so their next shot times line up. */
export function syncState(state) {
  const em = state.pattern.emitters
  const next = em.map((e, i) => {
    const old = state.next[i]
    const period = 1 / e.rate
    return old == null ? state.time : Math.min(old, state.time + period)
  })
  state.next = next
  return state
}

const MARGIN = 60
function advance(b, dt) {
  b.age += dt
  b.speed = Math.max(0, b.speed + b.accel * dt)
  b.dir += b.curve * dt
  b.bx += Math.cos(b.dir) * b.speed * dt
  b.by += Math.sin(b.dir) * b.speed * dt
  if (b.amp) {
    const off = b.amp * Math.sin(TAU * b.freq * b.age)
    b.x = b.bx - Math.sin(b.dir) * off
    b.y = b.by + Math.cos(b.dir) * off
  } else { b.x = b.bx; b.y = b.by }
  return b.age < b.life && b.x > -MARGIN && b.x < WORLD.w + MARGIN && b.y > -MARGIN && b.y < WORLD.h + MARGIN
}

/** Advance the simulation by dt seconds: move and cull bullets, then fire every shot due in (time, time + dt]. Mutates and returns state. */
export function step(state, dt) {
  const { pool, pattern } = state
  let i = 0
  while (i < state.n) {
    if (advance(pool[i], dt)) { i++; continue }
    const last = --state.n
    const tmp = pool[i]; pool[i] = pool[last]; pool[last] = tmp
  }
  const t1 = state.time + dt
  const origin = { x: pattern.origin.x * WORLD.w, y: pattern.origin.y * WORLD.h }
  const target = { x: pattern.target.x * WORLD.w, y: pattern.target.y * WORLD.h }
  const ctx = { origin, target, rand: state.rand }
  pattern.emitters.forEach((e, k) => {
    const period = 1 / e.rate
    let guard = 0
    while (state.next[k] <= t1 + 1e-9 && guard++ < 64) {
      const ts = state.next[k]
      state.next[k] = ts + period
      for (const s of spawnBullets(e, ts, ctx)) {
        if (state.n >= state.cap) { state.dropped++; continue }
        let b = pool[state.n]
        if (!b) b = pool[state.n] = {}
        b.bx = b.x = s.x; b.by = b.y = s.y; b.dir = s.dir; b.speed = s.speed
        b.accel = e.accel; b.curve = e.curve * DEG; b.amp = e.waveAmp; b.freq = e.waveFreq
        b.size = e.size; b.color = e.color; b.life = e.life; b.age = 0
        state.spawned++
        if (advance(b, t1 - ts)) state.n++
      }
    }
    if (guard >= 64) state.next[k] = t1 + period // a huge dt: skip the backlog rather than flooding
  })
  state.time = t1
  return state
}

/** Run the simulation for `seconds` in fixed steps (used to warm up a still frame or a recording). */
export function simulate(state, seconds, dt = FIXED_DT) {
  const steps = Math.round(seconds / dt)
  for (let i = 0; i < steps; i++) step(state, dt)
  return state
}

// ---------- Presets ----------
const E = (type, o) => ({ ...defaultEmitter(type), ...o })
export const PRESETS = [
  { name: 'Twin spiral', origin: { x: 0.5, y: 0.4 }, emitters: [E('spiral', { count: 3, rate: 16, spin: 140, speed: 150, color: 'violet' }), E('spiral', { count: 3, rate: 16, spin: -140, speed: 150, color: 'rose' })] },
  { name: 'Rotating rings', origin: { x: 0.5, y: 0.45 }, emitters: [E('ring', { count: 24, rate: 2.5, spin: 9, speed: 120, size: 5.5, color: 'teal' }), E('ring', { count: 12, rate: 1.25, spin: -20, speed: 80, size: 8, color: 'amber' })] },
  { name: 'Galaxy', origin: { x: 0.5, y: 0.5 }, emitters: [E('spiral', { count: 5, rate: 10, spin: 50, speed: 110, curve: 45, size: 4, life: 7, color: 'sky' }), E('ring', { count: 10, rate: 1, spin: 0, speed: 60, curve: -30, size: 7, color: 'violet' })] },
  { name: 'Sine sprinkler', origin: { x: 0.5, y: 0.2 }, emitters: [E('wave', { count: 1, rate: 22, spread: 140, waveFreq: 0.5, angle: 90, speed: 200, size: 4, color: 'lime' }), E('wave', { count: 1, rate: 22, spread: 140, waveFreq: 0.5, angle: -90, speed: 200, size: 4, color: 'teal', spin: 0 })] },
  { name: 'Fireworks', origin: { x: 0.5, y: 0.45 }, emitters: [E('burst', { count: 48, rate: 0.9, spread: 360, speed: 190, accel: -70, size: 4.5, life: 5, color: 'orange' }), E('burst', { count: 24, rate: 0.9, spread: 360, speed: 120, accel: -40, size: 6, life: 5, color: 'amber' })] },
  { name: 'Sniper and fan', origin: { x: 0.5, y: 0.15 }, target: { x: 0.35, y: 0.88 }, emitters: [E('aimed', { count: 3, rate: 5, spread: 14, speed: 280, size: 4, color: 'rose' }), E('fan', { count: 9, rate: 1.5, spread: 120, angle: 90, speed: 130, size: 6, color: 'ink' })] },
  { name: 'Double helix', origin: { x: 0.1, y: 0.5 }, emitters: [E('fan', { count: 1, rate: 24, spread: 0, angle: 0, speed: 160, waveAmp: 36, waveFreq: 1.2, size: 4.5, color: 'sky' }), E('fan', { count: 1, rate: 24, spread: 0, angle: 0, speed: 160, waveAmp: -36, waveFreq: 1.2, size: 4.5, color: 'rose', curve: 0 })] },
  { name: 'Blooming flower', origin: { x: 0.5, y: 0.5 }, emitters: [E('ring', { count: 16, rate: 3, spin: 30, speed: 40, accel: 60, curve: 70, size: 5, life: 6, color: 'rose' }), E('ring', { count: 16, rate: 3, spin: -30, speed: 40, accel: 60, curve: -70, size: 5, life: 6, color: 'violet' })] },
].map((p, i) => normalizePattern({ ...p, seed: 7 + i }))

// ---------- UI ----------
const CSS = `
.t-bpd{--bp-stage:#f7f7fb;--bp-grid:rgba(20,20,60,.07);--bp-core:#ffffff;--bp-edge:rgba(15,15,40,.38);
  --bp-violet:#6d4aff;--bp-rose:#e11d63;--bp-amber:#d97706;--bp-teal:#0d9488;--bp-sky:#0284c7;--bp-lime:#4d7c0f;--bp-orange:#ea580c;--bp-ink:#334155}
:root[data-theme="dark"] .t-bpd{--bp-stage:#0b0b13;--bp-grid:rgba(200,200,255,.06);--bp-core:#ffffff;--bp-edge:rgba(0,0,0,0);
  --bp-violet:#a78bfa;--bp-rose:#fb7199;--bp-amber:#fbbf24;--bp-teal:#2dd4bf;--bp-sky:#38bdf8;--bp-lime:#a3e635;--bp-orange:#fb923c;--bp-ink:#e2e8f0}
.t-bpd .stage{position:relative;width:100%;aspect-ratio:4/3;border-radius:var(--radius-lg);overflow:hidden;background:var(--bp-stage);border:1px solid var(--border);touch-action:none;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--border) 40%,transparent)}
.t-bpd .stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.t-bpd .handle{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent);display:grid;place-items:center;color:var(--accent);cursor:grab;padding:0;touch-action:none}
.t-bpd .handle .icon{width:16px;height:16px}
.t-bpd .handle.target{border-style:dashed;border-color:var(--text-2);color:var(--text-2);background:color-mix(in srgb,var(--text) 8%,transparent)}
.t-bpd .handle:focus-visible{outline:3px solid var(--ring);outline-offset:2px}
.t-bpd .handle.drag{cursor:grabbing}
.t-bpd .hud{position:absolute;left:10px;top:10px;display:flex;gap:6px;flex-wrap:wrap;pointer-events:none;max-width:calc(100% - 20px)}
.t-bpd .hud span{font:600 12px var(--mono);padding:3px 8px;border-radius:8px;background:color-mix(in srgb,var(--surface) 78%,transparent);border:1px solid var(--border);color:var(--text-2);font-variant-numeric:tabular-nums}
.t-bpd .hud span.full{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 40%,transparent)}
.t-bpd .paused-badge{position:absolute;right:10px;bottom:10px;font:600 12px var(--font);padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--surface) 80%,transparent);border:1px solid var(--border);color:var(--muted);display:inline-flex;gap:5px;align-items:center;pointer-events:none}
.t-bpd .paused-badge .icon{width:13px;height:13px}
.t-bpd .presets{display:flex;gap:6px;flex-wrap:wrap}
.t-bpd .presets .btn[aria-pressed="true"]{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.t-bpd .em-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.t-bpd .em-item{display:flex;align-items:center;gap:6px;min-width:0}
.t-bpd .em-pick{flex:1;min-width:0;display:flex;align-items:center;gap:9px;min-height:40px;padding:6px 10px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;text-align:left;font:inherit;font-size:14px}
.t-bpd .em-pick:hover{background:var(--surface-2)}
.t-bpd .em-pick[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-soft)}
.t-bpd .em-pick .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t-bpd .em-pick .meta{font:12px var(--mono);color:var(--muted);white-space:nowrap}
.t-bpd .dot{width:14px;height:14px;border-radius:50%;flex:none;box-shadow:0 0 0 2px var(--surface),0 0 0 3px var(--border-strong)}
.t-bpd .swatches{display:flex;gap:6px;flex-wrap:wrap}
.t-bpd .sw{width:34px;height:34px;border-radius:10px;border:1px solid var(--border);background:var(--surface);display:grid;place-items:center;cursor:pointer;padding:0}
.t-bpd .sw[aria-checked="true"]{border-color:var(--text);box-shadow:0 0 0 2px var(--ring)}
.t-bpd .sw .dot{box-shadow:none;width:18px;height:18px}
.t-bpd .sw[aria-checked="true"] .dot{box-shadow:0 0 0 3px var(--surface),0 0 0 4px var(--text)}
.t-bpd .grid-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr));gap:10px 14px}
.t-bpd .field.off{opacity:.45}
.t-bpd video{width:100%;max-height:320px;border-radius:var(--radius);background:var(--bp-stage);border:1px solid var(--border)}
.t-bpd .json{min-height:120px;font-family:var(--mono);font-size:12.5px}
.t-bpd .kbd-hint{font-size:12.5px;color:var(--muted)}
@media (prefers-reduced-motion: reduce){.t-bpd .handle{transition:none}}
`
function injectCss() {
  if (document.getElementById('t-bpd-css')) return
  document.head.append(h('style', { id: 't-bpd-css' }, CSS))
}

const ICON_FOR = { ring: 'circle-dot', spiral: 'loader', fan: 'triangle', wave: 'audio-waveform', burst: 'sparkles', aimed: 'crosshair' }
const typeLabel = (t) => TYPES.find(([k]) => k === t)?.[1] || t
const FIELDS = [
  ['count', 'Bullets per shot', (v) => String(v)],
  ['rate', 'Fire rate', (v) => `${formatNumber(v, 1)} /s`],
  ['speed', 'Speed', (v) => `${v} px/s`],
  ['accel', 'Acceleration', (v) => `${v} px/s²`],
  ['spin', 'Spin (emitter rotation)', (v) => `${v}°/s`],
  ['curve', 'Curve (bullet angular velocity)', (v) => `${v}°/s`],
  ['angle', 'Direction', (v) => `${v}°`],
  ['spread', 'Spread angle', (v) => `${v}°`],
  ['waveAmp', 'Wave amplitude', (v) => `${v} px`],
  ['waveFreq', 'Wave frequency', (v) => `${formatNumber(v, 1)} Hz`],
  ['size', 'Bullet size', (v) => `${formatNumber(v, 1)} px`],
  ['life', 'Lifetime', (v) => `${formatNumber(v, 1)} s`],
]
const HINTS = {
  angle: '0 is right, 90 is down. Aimed emitters add it to the aim.',
  spread: 'Used by fan, wave (sweep width), burst and aimed.',
  waveAmp: 'Bullets weave sideways. Negative flips the phase.',
  waveFreq: 'Wave emitters also sweep their aim at this rate.',
  spin: 'Turns the firing direction over time.',
}
const usesSpread = (t) => t === 'fan' || t === 'wave' || t === 'burst' || t === 'aimed'

function readHashPattern() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const p = q.get('p')
  return p ? decodePattern(p) : null
}

export function mount(root, { signal } = {}) {
  injectCss()
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const wrap = h('div', { class: 't-bpd stack' })
  root.append(wrap)

  let pattern
  let linkError = null
  try { pattern = readHashPattern() } catch (e) { linkError = e.message }
  const fromLink = !!pattern
  if (!pattern) pattern = structuredClone(PRESETS[0])
  let state = createState(pattern)
  let selected = 0
  let playing = !reduce
  let speedMul = 1
  let raf = 0, lastT = 0, acc = 0, frames = 0, fpsT = 0, fps = 0
  let recUrl = null, recording = null
  let disposed = false

  // ----- stage -----
  const cv = h('canvas', { role: 'img', 'aria-label': 'Bullet pattern preview' })
  const g = cv.getContext('2d')
  const hudCount = h('span', { 'data-count': '0' }, 'Bullets 0')
  const hudFps = h('span', '- fps')
  const hudTime = h('span', 't 0.0 s')
  const hud = h('div', { class: 'hud', 'aria-hidden': 'true' }, hudCount, hudFps, hudTime)
  const pausedBadge = h('div', { class: 'paused-badge' }, icon('pause'), 'Paused')
  const originH = h('button', { type: 'button', class: 'handle', 'aria-label': 'Emitter origin' }, icon('move'))
  const targetH = h('button', { type: 'button', class: ['handle', 'target'], 'aria-label': 'Aim target' }, icon('crosshair'))
  const stage = h('div', { class: 'stage' }, cv, hud, pausedBadge, originH, targetH)

  let colors = {}
  let dpr = 1, cssW = 0
  function readColors() {
    const cs = getComputedStyle(wrap)
    const v = (n) => cs.getPropertyValue(n).trim()
    colors = { stage: v('--bp-stage'), grid: v('--bp-grid'), core: v('--bp-core'), edge: v('--bp-edge') }
    for (const c of COLORS) colors[c] = v(`--bp-${c}`)
  }
  function resize() {
    const r = stage.getBoundingClientRect()
    if (!r.width) return
    dpr = Math.min(2.5, window.devicePixelRatio || 1)
    cssW = r.width
    cv.width = Math.round(r.width * dpr)
    cv.height = Math.round(r.height * dpr)
    draw()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(stage)
  const mo = new MutationObserver(() => { readColors(); draw() })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  const buckets = new Map()
  function draw() {
    if (!cv.width) return
    const s = cv.width / WORLD.w
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = colors.stage || '#000'
    g.fillRect(0, 0, cv.width, cv.height)
    g.setTransform(s, 0, 0, s, 0, 0)
    // faint grid
    g.strokeStyle = colors.grid
    g.lineWidth = 1 / s
    g.beginPath()
    for (let x = 100; x < WORLD.w; x += 100) { g.moveTo(x, 0); g.lineTo(x, WORLD.h) }
    for (let y = 100; y < WORLD.h; y += 100) { g.moveTo(0, y); g.lineTo(WORLD.w, y) }
    g.stroke()
    // group bullets by color so each color is one path
    for (const arr of buckets.values()) arr.length = 0
    const { pool, n } = state
    for (let i = 0; i < n; i++) {
      const b = pool[i]
      let arr = buckets.get(b.color)
      if (!arr) buckets.set(b.color, (arr = []))
      arr.push(b)
    }
    const edge = colors.edge && colors.edge !== 'rgba(0, 0, 0, 0)' && colors.edge !== 'rgba(0,0,0,0)'
    for (const [c, arr] of buckets) {
      if (!arr.length) continue
      g.beginPath()
      for (const b of arr) { g.moveTo(b.x + b.size, b.y); g.arc(b.x, b.y, b.size, 0, TAU) }
      g.fillStyle = colors[c] || '#888'
      g.fill()
      if (edge) { g.strokeStyle = colors.edge; g.lineWidth = Math.max(0.8, 1 / s); g.stroke() }
    }
    g.beginPath()
    for (let i = 0; i < n; i++) { const b = pool[i]; const r = b.size * 0.42; if (r < 0.9) continue; g.moveTo(b.x + r, b.y); g.arc(b.x, b.y, r, 0, TAU) }
    g.fillStyle = colors.core
    g.globalAlpha = 0.92
    g.fill()
    g.globalAlpha = 1
    updateHud()
  }

  function updateHud() {
    hudCount.textContent = `Bullets ${state.n}${state.n >= state.cap ? ' (cap)' : ''}`
    hudCount.dataset.count = String(state.n)
    hudCount.classList.toggle('full', state.n >= state.cap)
    hudFps.textContent = `${fps || '-'} fps`
    hudFps.hidden = !playing
    hudTime.textContent = `t ${state.time.toFixed(1)} s`
  }

  // ----- loop -----
  function frame(now) {
    raf = 0
    if (disposed) return
    const dt = Math.min(0.1, (now - (lastT || now)) / 1000)
    lastT = now
    acc += dt * speedMul
    let steps = 0
    while (acc >= FIXED_DT && steps < 24) { step(state, FIXED_DT); acc -= FIXED_DT; steps++ }
    if (steps >= 24) acc = 0 // the device cannot keep up: drop time instead of spiralling
    frames++
    if (now - fpsT >= 500) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now }
    draw()
    if (playing && !document.hidden) raf = requestAnimationFrame(frame)
  }
  function startLoop() {
    if (raf || disposed || !playing || document.hidden) return
    lastT = 0; acc = 0; frames = 0; fpsT = performance.now()
    raf = requestAnimationFrame(frame)
  }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0 }
  function setPlaying(v) {
    playing = v
    pausedBadge.hidden = v
    playBtn.querySelector('span:last-child').textContent = v ? 'Pause' : 'Play'
    playBtn.querySelector('.ic').replaceChildren(icon(v ? 'pause' : 'play'))
    playBtn.setAttribute('aria-pressed', String(v))
    stepBtn.disabled = v
    if (v) startLoop(); else { stopLoop(); draw() }
  }
  const onVis = () => { if (document.hidden) stopLoop(); else startLoop() }
  document.addEventListener('visibilitychange', onVis)

  // ----- transport -----
  const playBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => setPlaying(!playing) }, h('span', { class: 'ic', style: 'display:contents' }, icon('play')), h('span', 'Play'))
  const stepBtn = button('Step', { icon: 'step-forward', title: 'Advance one frame (1/60 s)', onClick: () => { step(state, FIXED_DT); step(state, FIXED_DT); draw() } })
  const resetBtn = button('Reset', { icon: 'rotate-ccw', onClick: () => restart(!playing) })
  const speedSel = select([['0.25', '0.25x'], ['0.5', '0.5x'], ['1', '1x'], ['1.5', '1.5x'], ['2', '2x'], ['3', '3x']], '1', (v) => { speedMul = Number(v) })
  speedSel.setAttribute('aria-label', 'Simulation speed')
  speedSel.style.width = 'auto'
  const transport = h('div', { class: 'row' }, playBtn, stepBtn, resetBtn, h('label', { class: 'row', style: 'gap:6px' }, h('span', { class: 'small muted' }, 'Speed'), speedSel))

  /** Restart the simulation. When paused, pre-run a moment so the still frame shows the pattern. */
  function restart(warm) {
    state = createState(pattern)
    acc = 0
    if (warm) simulate(state, Math.min(2.5, Math.max(...pattern.emitters.map((e) => e.life))))
    draw()
  }

  // ----- handles -----
  function placeHandles() {
    originH.style.left = `${pattern.origin.x * 100}%`
    originH.style.top = `${pattern.origin.y * 100}%`
    targetH.style.left = `${pattern.target.x * 100}%`
    targetH.style.top = `${pattern.target.y * 100}%`
    targetH.hidden = !pattern.emitters.some((e) => e.type === 'aimed')
    const pct = (v) => Math.round(v * 100)
    originH.setAttribute('aria-label', `Emitter origin at ${pct(pattern.origin.x)}% across, ${pct(pattern.origin.y)}% down. Drag or use arrow keys to move.`)
    targetH.setAttribute('aria-label', `Aim target at ${pct(pattern.target.x)}% across, ${pct(pattern.target.y)}% down. Drag or use arrow keys to move.`)
  }
  function bindHandle(el, key) {
    let id = null
    const moveTo = (e) => {
      const r = stage.getBoundingClientRect()
      pattern[key].x = Math.min(1, Math.max(0, +((e.clientX - r.left) / r.width).toFixed(3)))
      pattern[key].y = Math.min(1, Math.max(0, +((e.clientY - r.top) / r.height).toFixed(3)))
      placeHandles()
      if (!playing) draw()
    }
    el.addEventListener('pointerdown', (e) => { id = e.pointerId; el.setPointerCapture(id); el.classList.add('drag'); e.preventDefault(); el.focus() })
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) moveTo(e) })
    const end = (e) => { if (e.pointerId === id) { id = null; el.classList.remove('drag'); syncJson() } }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('keydown', (e) => {
      const d = e.shiftKey ? 0.05 : 0.01
      const mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key]
      if (!mv) return
      e.preventDefault()
      pattern[key].x = Math.min(1, Math.max(0, +(pattern[key].x + mv[0]).toFixed(3)))
      pattern[key].y = Math.min(1, Math.max(0, +(pattern[key].y + mv[1]).toFixed(3)))
      placeHandles()
      syncJson()
      if (!playing) draw()
    })
  }
  bindHandle(originH, 'origin')
  bindHandle(targetH, 'target')

  // ----- presets -----
  const presetBtns = PRESETS.map((p, i) => {
    const b = button(p.name, { size: 'sm', attrs: { 'aria-pressed': 'false' }, onClick: () => loadPattern(structuredClone(PRESETS[i]), i) })
    return b
  })
  const markPreset = (i) => presetBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)))

  function loadPattern(p, presetIndex = -1) {
    pattern = p
    selected = 0
    markPreset(presetIndex)
    restart(!playing)
    renderList()
    renderEditor()
    placeHandles()
    syncJson()
  }

  // ----- emitter list -----
  const list = h('ul', { class: 'em-list', 'aria-label': 'Emitters' })
  const addSel = select(TYPES, 'spiral')
  addSel.setAttribute('aria-label', 'Type of emitter to add')
  addSel.style.flex = '1'
  addSel.style.minWidth = '0'
  const addBtn = button('Add', { icon: 'plus', onClick: () => {
    if (pattern.emitters.length >= MAX_EMITTERS) return toast(`Up to ${MAX_EMITTERS} emitters per pattern.`, 'error')
    pattern.emitters.push(defaultEmitter(addSel.value))
    selected = pattern.emitters.length - 1
    changed(true)
  } })
  function changed(structure) {
    markPreset(-1)
    if (structure) { syncState(state); renderList(); renderEditor() }
    else { syncState(state); refreshListMeta() }
    placeHandles()
    syncJson()
    if (!playing) restart(true)
  }
  const metaText = (e) => `${e.count} × ${formatNumber(e.rate, 1)}/s`
  function renderList() {
    clear(list, pattern.emitters.map((e, i) => h('li', { class: 'em-item' },
      h('button', { type: 'button', class: 'em-pick', 'aria-pressed': String(i === selected), onclick: () => { selected = i; renderList(); renderEditor() } },
        h('span', { class: 'dot', style: { background: `var(--bp-${e.color})` } }), icon(ICON_FOR[e.type] || 'circle'),
        h('span', { class: 'nm' }, `${i + 1}. ${typeLabel(e.type)}`), h('span', { class: 'meta', dataset: { meta: i } }, metaText(e))),
      button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Duplicate emitter ${i + 1}`, disabled: pattern.emitters.length >= MAX_EMITTERS, onClick: () => {
        pattern.emitters.splice(i + 1, 0, structuredClone(e)); selected = i + 1; state.next.splice(i + 1, 0, state.time); changed(true)
      } }),
      button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Remove emitter ${i + 1}`, disabled: pattern.emitters.length <= 1, onClick: () => {
        pattern.emitters.splice(i, 1); state.next.splice(i, 1); if (i < selected) selected--; selected = Math.min(selected, pattern.emitters.length - 1); changed(true)
      } }))))
  }
  function refreshListMeta() {
    pattern.emitters.forEach((e, i) => {
      const m = list.querySelector(`[data-meta="${i}"]`)
      if (m) m.textContent = metaText(e)
      const dot = m?.parentElement.querySelector('.dot')
      if (dot) dot.style.background = `var(--bp-${e.color})`
      const nm = m?.parentElement.querySelector('.nm')
      if (nm) nm.textContent = `${i + 1}. ${typeLabel(e.type)}`
    })
  }

  // ----- emitter editor -----
  const editor = h('div', { class: 'stack' })
  function renderEditor() {
    const e = pattern.emitters[selected]
    if (!e) return clear(editor)
    const typeSel = select(TYPES, e.type, (v) => {
      const keepColor = e.color
      Object.assign(e, defaultEmitter(v), { color: keepColor })
      changed(true)
    })
    const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Bullet color' })
    const swBtns = COLORS.map((c) => h('button', {
      type: 'button', class: 'sw', role: 'radio', 'aria-checked': String(c === e.color), 'aria-label': COLOR_LABEL[c], title: COLOR_LABEL[c], tabIndex: c === e.color ? 0 : -1,
      onclick: () => pick(c),
      onkeydown: (ev) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key]
        if (!d) return
        ev.preventDefault()
        const j = (COLORS.indexOf(e.color) + d + COLORS.length) % COLORS.length
        pick(COLORS[j]); swBtns[j].focus()
      },
    }, h('span', { class: 'dot', style: { background: `var(--bp-${c})` } })))
    function pick(c) {
      e.color = c
      swBtns.forEach((b, j) => { const on = COLORS[j] === c; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1 })
      changed(false)
    }
    sw.append(...swBtns)
    const fields = FIELDS.map(([k, label, fmt]) => {
      const [min, max, stp] = LIMITS[k]
      const f = rangeField(label, { min, max, step: stp, value: e[k], format: fmt, hint: HINTS[k], onInput: (v) => { e[k] = v; changed(false) } })
      if (k === 'spread' && !usesSpread(e.type)) { f.classList.add('off'); f.querySelector('.field-hint').textContent = `Not used by ${typeLabel(e.type).toLowerCase()} emitters.` }
      return f
    })
    clear(editor,
      h('div', { class: 'grid-fields' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Emitter type'), typeSel),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Color'), sw)),
      h('div', { class: 'grid-fields' }, fields))
  }

  // ----- JSON, link, import -----
  const jsonOut = textarea({ class: 'json', mono: true, rows: 6, 'aria-label': 'Pattern JSON (edit or paste, then Apply)' })
  const jsonMsg = h('div')
  const toJson = () => JSON.stringify({ ...pattern, name: pattern.name || 'Custom pattern' }, null, 2)
  const shareUrl = () => `${location.origin}${location.pathname}#/bullet-pattern-designer?p=${encodePattern(pattern)}`
  let jsonDirty = false
  jsonOut.addEventListener('input', () => { jsonDirty = true })
  function syncJson() { if (!jsonDirty) jsonOut.value = toJson() }
  function importText(text, from) {
    clear(jsonMsg)
    let obj
    try { obj = JSON.parse(text) } catch (err) { clear(jsonMsg, alert('error', `${from} is not valid JSON (${err.message}).`)); return false }
    try { obj = normalizePattern(obj) } catch (err) { clear(jsonMsg, alert('error', err.message)); return false }
    jsonDirty = false
    loadPattern(obj)
    toast(`Loaded ${obj.emitters.length} emitter${obj.emitters.length === 1 ? '' : 's'}`, 'success')
    return true
  }
  const applyBtn = button('Apply JSON', { icon: 'check', size: 'sm', onClick: () => importText(jsonOut.value, 'The text') })
  const copyJsonBtn = button('Copy JSON', { icon: 'copy', size: 'sm', onClick: () => copyText(toJson()) })
  const dlJsonBtn = button('Download JSON', { icon: 'download', size: 'sm', onClick: () => download(new Blob([toJson()], { type: 'application/json' }), `${(pattern.name || 'pattern').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`) })
  const linkBtn = button('Copy share link', { icon: 'link', size: 'sm', variant: 'primary', onClick: async () => {
    const url = shareUrl()
    if (url.length > 8000) toast('This pattern makes a very long link. JSON is safer for sharing.', 'info')
    await copyText(url)
    history.replaceState(history.state, '', url)
  } })
  const drop = dropzone({ accept: '.json,application/json', compact: true, paste: true, icon: 'file-json', label: 'Import a pattern JSON file', onFiles: async ([f]) => {
    if (f.size > 1_000_000) return clear(jsonMsg, alert('error', 'That file is too big to be a pattern (over 1 MB).'))
    importText(await f.text(), 'That file')
  } })

  // ----- recording -----
  const canRecord = typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype && typeof MediaRecorder !== 'undefined'
  const recMime = canRecord ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) : null
  const recSecs = select([['3', '3 seconds'], ['5', '5 seconds'], ['8', '8 seconds']], '5')
  recSecs.setAttribute('aria-label', 'Clip length')
  recSecs.style.width = 'auto'
  const warmTgl = toggle('Start full (skip the empty first seconds)', true)
  const recBtn = button('Record clip', { icon: 'video', variant: 'primary' })
  const recOut = h('div', { class: 'stack' })
  recBtn.addEventListener('click', () => busy(recBtn, async () => {
    if (!recMime) throw new Error('This browser cannot record the canvas to video. Try a recent Chrome, Edge or Firefox.')
    const secs = Number(recSecs.value)
    state = createState(pattern)
    if (warmTgl.input.checked) simulate(state, Math.min(6, Math.max(...pattern.emitters.map((e) => e.life))))
    setPlaying(true)
    const stream = cv.captureStream(60)
    const rec = new MediaRecorder(stream, { mimeType: recMime, videoBitsPerSecond: 8_000_000 })
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const stopped = new Promise((r) => { rec.onstop = r })
    recording = rec
    rec.start(250)
    await new Promise((r) => {
      const t = setTimeout(r, secs * 1000)
      signal?.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true })
    })
    if (rec.state !== 'inactive') rec.stop()
    await stopped
    stream.getTracks().forEach((t) => t.stop())
    recording = null
    if (disposed) return
    const blob = new Blob(chunks, { type: 'video/webm' })
    if (!blob.size) throw new Error('The recording came out empty. Keep this tab visible while it records.')
    if (recUrl) URL.revokeObjectURL(recUrl)
    recUrl = URL.createObjectURL(blob)
    const name = `${(pattern.name || 'pattern').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${secs}s.webm`
    clear(recOut,
      h('video', { src: recUrl, controls: true, loop: true, muted: true, playsinline: true, autoplay: !reduce, 'aria-label': 'Recorded clip preview' }),
      h('div', { class: 'row' }, button(`Download WebM (${formatNumber(blob.size / 1e6, 1)} MB)`, { icon: 'download', variant: 'primary', onClick: () => download(blob, name) }),
        h('span', { class: 'small muted' }, 'Convert to GIF or MP4 with the video tools if you need another format.')))
  }, { label: 'Recording', errorTo: recOut }))

  // ----- layout -----
  const stageCard = h('section', { class: 'panel stack' },
    stage,
    transport,
    h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'small muted' }, 'Presets'), h('div', { class: 'presets' }, presetBtns)),
    h('p', { class: 'kbd-hint' }, 'Drag the ', icon('move'), ' origin (or focus it and use the arrow keys, Shift for bigger steps). Aimed emitters fire at the dashed target.'))
  const emCard = card('Emitters',
    h('div', { class: 'stack' }, list, h('div', { class: 'row', style: 'flex-wrap:nowrap' }, addSel, addBtn), h('hr', { style: 'border:0;border-top:1px solid var(--border);margin:4px 0' }), editor))
  const exportCard = card('Share and export',
    h('div', { class: 'stack' },
      h('div', { class: 'row' }, linkBtn, copyJsonBtn, dlJsonBtn),
      field2('Pattern JSON', jsonOut), h('div', { class: 'row' }, applyBtn, h('span', { class: 'small muted' }, 'Edit the JSON or paste one, then apply.')),
      drop, jsonMsg))
  const recCard = card('Record a clip',
    h('div', { class: 'stack' },
      canRecord && recMime
        ? h('div', { class: 'row' }, recBtn, recSecs, warmTgl)
        : alert('warn', 'This browser cannot record the canvas to video. Export the pattern as JSON instead.'),
      h('div', { class: 'small muted' }, 'Records the preview at its current size to a WebM video, right in your browser.'),
      recOut))

  if (linkError) wrap.append(alert('warn', `${linkError} Showing a preset instead.`))
  if (reduce) wrap.append(alert('info', 'Your system asks for reduced motion, so the preview starts paused. Press Play when you are ready.'))
  wrap.append(split(h('div', { class: 'stack' }, stageCard, recCard), h('div', { class: 'stack' }, emCard, exportCard), 'wide-left'))

  readColors()
  renderList()
  renderEditor()
  placeHandles()
  syncJson()
  if (!fromLink) markPreset(0)
  setPlaying(playing)
  if (!playing) restart(true)
  resize()

  const dispose = () => {
    if (disposed) return
    disposed = true
    stopLoop()
    ro.disconnect()
    mo.disconnect()
    document.removeEventListener('visibilitychange', onVis)
    if (recording && recording.state !== 'inactive') try { recording.stop() } catch { /* already stopped */ }
    if (recUrl) URL.revokeObjectURL(recUrl)
    recUrl = null
  }
  onCleanup(dispose)
  signal?.addEventListener('abort', dispose)
  return dispose
}

function field2(label, control) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control)
}
