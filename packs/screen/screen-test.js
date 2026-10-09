// Dead pixel and screen test: full-screen colors, gradients, grids, text, motion and a stuck-pixel flasher.
import { h, icon, button, select, toggle, modal, stats, formatNumber } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { baseCss, injectCss, clamp } from './_shared.js'

// ---------- patterns: draw(ctx, W, H, dpr, state) in device pixels ----------
const fill = (c) => (ctx, W, H) => { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H) }
const gray = (p) => fill(`rgb(${Math.round(p * 2.55)},${Math.round(p * 2.55)},${Math.round(p * 2.55)})`)

function ramp(ctx, x0, y0, w, h, rgb) {
  for (let x = 0; x < w; x++) {
    const v = Math.floor((x / Math.max(1, w - 1)) * 255)
    ctx.fillStyle = `rgb(${rgb[0] ? v : 0},${rgb[1] ? v : 0},${rgb[2] ? v : 0})`
    ctx.fillRect(x0 + x, y0, 1, h)
  }
}
function steps(ctx, x0, y0, w, h, from, to, dpr) {
  const n = to - from + 1
  for (let i = 0; i < n; i++) {
    const v = from + i
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(x0 + Math.floor((i * w) / n), y0, Math.ceil(w / n), h)
    if (n <= 40 && (i % 4 === 0 || i === n - 1)) {
      ctx.fillStyle = v < 128 ? '#fff' : '#000'
      ctx.font = `${10 * dpr}px ui-monospace, Menlo, Consolas, monospace`
      ctx.textAlign = 'left'
      ctx.fillText(String(v), x0 + Math.floor((i * w) / n) + 2 * dpr, y0 + h - 6 * dpr)
    }
  }
}
function checker(size) {
  return (ctx, W, H, dpr) => {
    const s = Math.max(1, Math.round(size * (size === 1 ? 1 : dpr)))
    const img = ctx.createImageData(W, H)
    const d = img.data
    for (let y = 0; y < H; y++) {
      const ry = Math.floor(y / s)
      for (let x = 0; x < W; x++) {
        const v = (Math.floor(x / s) + ry) & 1 ? 255 : 0
        const i = (y * W + x) * 4
        d[i] = d[i + 1] = d[i + 2] = v
        d[i + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }
}
function grid(ctx, W, H, dpr) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
  const step = Math.round(50 * dpr), lw = Math.max(1, Math.round(dpr))
  ctx.fillStyle = '#555'
  for (let x = step; x < W; x += step) ctx.fillRect(x, 0, lw, H)
  for (let y = step; y < H; y += step) ctx.fillRect(0, y, W, lw)
  ctx.fillStyle = '#fff'
  ctx.fillRect(Math.floor(W / 2), 0, lw, H); ctx.fillRect(0, Math.floor(H / 2), W, lw)
  ctx.strokeStyle = '#fff'; ctx.lineWidth = lw
  const r = Math.min(W, H) / 2 - 2 * lw
  ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.arc(W / 2, H / 2, r / 2, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = lw * 2
  ctx.strokeRect(lw, lw, W - 2 * lw, H - 2 * lw) // the very edge of the screen
  ctx.fillStyle = '#fff'; ctx.font = `${13 * dpr}px ui-monospace, Menlo, Consolas, monospace`; ctx.textAlign = 'center'
  ctx.fillText(`${W} x ${H} device pixels`, W / 2, H / 2 + r / 2 + 22 * dpr)
}
function fineLines(ctx, W, H) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  const half = Math.floor(W / 2)
  for (let x = 0; x < half; x += 2) ctx.fillRect(x, 0, 1, H)
  for (let y = 0; y < H; y += 2) ctx.fillRect(half, y, W - half, 1)
  ctx.fillStyle = '#f00'; ctx.fillRect(half - 1, 0, 2, H)
}
function colorBars(ctx, W, H) {
  const cols = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000']
  cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor((i * W) / 8), 0, Math.ceil(W / 8), H * 0.75) })
  const g = ['#000', '#222', '#444', '#666', '#888', '#aaa', '#ccc', '#fff']
  g.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor((i * W) / 8), H * 0.75, Math.ceil(W / 8), H * 0.25) })
}
function rgbRamps(ctx, W, H) {
  const bh = Math.floor(H / 4)
  ramp(ctx, 0, 0, W, bh, [1, 0, 0]); ramp(ctx, 0, bh, W, bh, [0, 1, 0]); ramp(ctx, 0, bh * 2, W, bh, [0, 0, 1]); ramp(ctx, 0, bh * 3, W, H - bh * 3, [1, 1, 1])
}
function detail(ctx, W, H, dpr) {
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H)
  const half = Math.floor(W / 2)
  steps(ctx, 0, 0, half, H, 0, 31, dpr)
  steps(ctx, half, 0, W - half, H, 224, 255, dpr)
  ctx.fillStyle = '#fff'; ctx.font = `600 ${14 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'left'
  ctx.fillText('Shadows 0 to 31: you should tell every bar apart', 14 * dpr, 28 * dpr)
  ctx.fillStyle = '#000'; ctx.fillText('Highlights 224 to 255: every bar visible', half + 14 * dpr, 28 * dpr)
}
function sharpText(ctx, W, H, dpr) {
  const sizes = [8, 9, 10, 11, 12, 13, 14, 16, 18, 22, 28]
  const sample = 'Hamburgefonstiv 0123456789 The quick brown fox'
  const draw = (x0, w, bg, fg, extra) => {
    ctx.fillStyle = bg; ctx.fillRect(x0, 0, w, H)
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    let y = 14 * dpr
    for (const s of sizes) {
      ctx.font = `${s * dpr}px ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif`
      ctx.fillText(`${s}px  ${sample}`, x0 + 16 * dpr, y)
      y += s * 1.5 * dpr + 4 * dpr
      if (y > H - 40 * dpr) break
    }
    ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, sans-serif`
    ctx.fillText(extra, x0 + 16 * dpr, Math.min(y + 6 * dpr, H - 24 * dpr))
  }
  const half = Math.floor(W / 2)
  draw(0, half, '#fff', '#000', 'Dark text on light')
  draw(half, W - half, '#000', '#fff', 'Light text on dark')
  // colour fringing: thin coloured text on contrasting backgrounds
  const bh = 78 * dpr, by = H - bh
  ;[['#ff0000', '#0000ff'], ['#00ff00', '#ff00ff'], ['#ffff00', '#0000ff'], ['#00ffff', '#ff0000']].forEach(([fg, bg], i) => {
    const w = Math.floor(W / 4)
    ctx.fillStyle = bg; ctx.fillRect(i * w, by, w, bh)
    ctx.fillStyle = fg; ctx.font = `${13 * dpr}px ui-sans-serif, system-ui, sans-serif`; ctx.textAlign = 'center'
    ctx.fillText('Color fringing check 123', i * w + w / 2, by + bh / 2 - 8 * dpr)
  })
  ctx.textBaseline = 'alphabetic'
}
const MOTION = { speeds: [240, 480, 960] }
function motion(ctx, W, H, dpr, st, t) {
  ctx.fillStyle = '#7f7f7f'; ctx.fillRect(0, 0, W, H)
  const rows = MOTION.speeds.length, rh = H / (rows + 1)
  MOTION.speeds.forEach((v, i) => {
    const size = Math.round(52 * dpr), span = W - size
    const pos = (((t / 1000) * v * dpr) % (2 * span))
    const x = pos > span ? 2 * span - pos : pos
    const y = rh * (i + 1) - size / 2
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, size, size)
    ctx.fillStyle = '#fff'; ctx.fillRect(x + size * 0.25, y + size * 0.25, size * 0.5, size * 0.5)
    ctx.fillStyle = '#000'; ctx.font = `${12 * dpr}px ui-monospace, Menlo, Consolas, monospace`; ctx.textAlign = 'left'
    ctx.fillText(`${v} px/s`, 12 * dpr, rh * (i + 1) - size / 2 - 8 * dpr)
  })
  ctx.fillStyle = '#000'; ctx.textAlign = 'right'
  ctx.fillText(st.hz ? `Your display refreshes at about ${st.hz} Hz` : 'Measuring refresh rate...', W - 12 * dpr, H - 16 * dpr)
}

const FLASH = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#00ffff', '#ff00ff', '#ffff00', '#000000']
function flasher(ctx, W, H, dpr, st, t) {
  ctx.fillStyle = st.bg; ctx.fillRect(0, 0, W, H)
  const idx = Math.floor((t / 1000) * st.hz)
  if (idx !== st.last) { st.last = idx; st.ci = (st.ci + 1 + Math.floor(Math.random() * 6)) % FLASH.length }
  let c = FLASH[st.ci]
  if (c.toLowerCase() === st.bg.toLowerCase()) c = FLASH[(st.ci + 1) % FLASH.length]
  const s = st.size * dpr
  ctx.fillStyle = c
  ctx.fillRect(Math.round(st.x * dpr - s / 2), Math.round(st.y * dpr - s / 2), Math.round(s), Math.round(s))
}

export const TESTS = [
  { id: 'black', g: 'Solid colors', name: 'Black', draw: fill('#000'), hint: 'Look for bright dots (stuck pixels), light leaking at the edges and corners (backlight bleed) and uneven glow.' },
  { id: 'white', g: 'Solid colors', name: 'White', draw: fill('#fff'), hint: 'Look for dark or colored dots (dead pixels), yellow or gray patches and dirty-looking areas.' },
  { id: 'red', g: 'Solid colors', name: 'Red', draw: fill('#f00'), hint: 'Dead pixels show as black dots, stuck pixels as green or blue dots.' },
  { id: 'green', g: 'Solid colors', name: 'Green', draw: fill('#0f0'), hint: 'Dead pixels show as black dots, stuck pixels as red or blue dots.' },
  { id: 'blue', g: 'Solid colors', name: 'Blue', draw: fill('#00f'), hint: 'Dead pixels show as black dots, stuck pixels as red or green dots.' },
  { id: 'cyan', g: 'Solid colors', name: 'Cyan', draw: fill('#0ff'), hint: 'A red sub-pixel that is stuck on shows as a dot that is not cyan.' },
  { id: 'magenta', g: 'Solid colors', name: 'Magenta', draw: fill('#f0f'), hint: 'A green sub-pixel that is stuck on shows as a dot that is not magenta.' },
  { id: 'yellow', g: 'Solid colors', name: 'Yellow', draw: fill('#ff0'), hint: 'A blue sub-pixel that is stuck on shows as a dot that is not yellow.' },
  { id: 'gray50', g: 'Solid colors', name: 'Gray 50%', draw: gray(50), hint: 'Good for spotting uneven patches, banding and color tint across the screen.' },
  { id: 'gray-ramp', g: 'Gradients', name: 'Gray ramp', draw: (ctx, W, H) => ramp(ctx, 0, 0, W, H, [1, 1, 1]), hint: 'The gradient should look smooth. Visible bands or a color tint mean limited color depth or a poor panel.' },
  { id: 'rgb-ramps', g: 'Gradients', name: 'Red, green, blue ramps', draw: rgbRamps, hint: 'Each ramp should be smooth with no sudden jumps. The gray ramp at the bottom should have no color cast.' },
  { id: 'bars', g: 'Gradients', name: 'Color bars', draw: colorBars, hint: 'Eight pure colors and eight gray steps. All should be clearly different from their neighbors.' },
  { id: 'detail', g: 'Gradients', name: 'Shadow and highlight detail', draw: detail, hint: 'Count the bars at the dark and the bright end. Missing bars mean crushed blacks or clipped whites.' },
  { id: 'checker1', g: 'Patterns', name: 'Pixel checkerboard', draw: checker(1), hint: 'Every other pixel is on. Up close it should look like an even gray with no flicker or shimmering.' },
  { id: 'checker', g: 'Patterns', name: 'Large checkerboard', draw: checker(32), hint: 'Squares should be equal in size. Edges should be sharp and straight.' },
  { id: 'grid', g: 'Patterns', name: 'Grid and geometry', draw: grid, hint: 'Lines should be straight and evenly spaced, circles round, and the red frame visible on all four edges.' },
  { id: 'lines', g: 'Patterns', name: 'Fine lines (1 px)', draw: fineLines, hint: 'Left: vertical 1 px lines. Right: horizontal. They should look sharp and even, not blurred or doubled.' },
  { id: 'text', g: 'Text', name: 'Text sharpness', draw: sharpText, hint: 'Small text should be crisp. Colored fringes around letters point to sub-pixel rendering or scaling problems.' },
  { id: 'gray10', g: 'Uniformity', name: 'Gray 10%', draw: gray(10), hint: 'Dark gray shows clouding and backlight bleed best. Dim the room.' },
  { id: 'gray25', g: 'Uniformity', name: 'Gray 25%', draw: gray(25), hint: 'Look for blotchy patches and vertical or horizontal stripes.' },
  { id: 'gray75', g: 'Uniformity', name: 'Gray 75%', draw: gray(75), hint: 'Look for yellow or blue tints and darker corners.' },
  { id: 'motion', g: 'Motion', name: 'Motion and refresh rate', draw: motion, animated: true, hint: 'Follow the squares with your eyes. Heavy trails mean slow pixel response. The refresh rate is measured live.' },
]
const GROUPS = [...new Set(TESTS.map((t) => t.g))]
const DEAD_SEQ = ['black', 'white', 'red', 'green', 'blue', 'cyan', 'magenta', 'yellow']

const CSS = `
.t-st .quick{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:14px}
.t-st .qc{position:relative;overflow:hidden;text-align:left;padding:18px;border-radius:var(--radius-lg);border:1px solid var(--border);background:var(--surface);cursor:pointer;display:flex;flex-direction:column;gap:8px;transition:transform .3s var(--spring),box-shadow .3s,border-color .2s;font:inherit;color:inherit}
.t-st .qc:hover{transform:translateY(-4px);box-shadow:var(--shadow-lg);border-color:var(--border-strong)}
.t-st .qc .ic{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;color:#fff;background:var(--g)}
.t-st .qc b{font-size:16px}
.t-st .qc span{font-size:13.5px;color:var(--muted);line-height:1.45}
.t-st .qc.main{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 14%,var(--surface)),var(--surface))}
.t-st .grp{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:8px 2px -4px}
.t-st .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,168px),1fr));gap:12px}
.t-st .tc{padding:0;border:1px solid var(--border);border-radius:16px;background:var(--surface);overflow:hidden;cursor:pointer;text-align:left;font:inherit;color:inherit;transition:transform .25s var(--spring),box-shadow .25s,border-color .2s}
.t-st .tc:hover{transform:translateY(-3px);box-shadow:var(--shadow);border-color:var(--accent)}
.t-st .tc canvas{display:block;width:100%;aspect-ratio:16/10;background:#000}
.t-st .tc div{padding:9px 12px;font-size:13.5px;font-weight:550}
.t-st .opts{display:flex;gap:14px 22px;flex-wrap:wrap;align-items:end}
.t-st .opts .select{min-width:150px}
.t-st-layer{position:fixed;inset:0;z-index:2147483000;background:#000;overflow:hidden;outline:none;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.t-st-layer.idle{cursor:none}
.t-st-layer canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.t-st-layer .hud{position:absolute;left:50%;bottom:max(22px,env(safe-area-inset-bottom));transform:translateX(-50%) translateY(0);width:max-content;max-width:min(94vw,640px);padding:10px 16px;border-radius:18px;background:rgba(14,14,20,.78);color:#fff;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 18px 40px -12px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.14);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity .4s,transform .4s;text-align:center;display:flex;flex-direction:column;gap:4px}
.t-st-layer.idle .hud,.t-st-layer.idle .x{opacity:0;transform:translateX(-50%) translateY(12px);pointer-events:none}
.t-st-layer .hud b{font-size:15px}
.t-st-layer .hud small{color:#c7c7d4;font-size:12.5px}
.t-st-layer .hud .row2{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:4px}
.t-st-layer .hud button{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;border-radius:10px;height:32px;padding:0 12px;font:600 13px system-ui,sans-serif;cursor:pointer}
.t-st-layer .hud button:hover{background:rgba(255,255,255,.22)}
.t-st-layer .x{position:absolute;top:max(14px,env(safe-area-inset-top));right:14px;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(14,14,20,.7);color:#fff;font:600 20px system-ui;cursor:pointer;transition:opacity .4s;display:grid;place-items:center}
.t-st-layer .x:hover{background:rgba(60,60,70,.9)}
@media (prefers-reduced-motion:reduce){.t-st-layer .hud,.t-st-layer .x{transition:none}}
`

export function mount(root) {
  baseCss()
  injectCss('st', CSS)
  const prefs = persisted('screen-test:prefs', { auto: 0, cycle: 3, hud: true })
  let layer = null, cv = null, ctx = null, hud = null, cur = 0, raf = 0, autoTimer = 0, idleTimer = 0, paused = false
  let seq = TESTS.map((t) => t.id), mode = 'tests', fl = null, motionState = { hz: 0, frames: [] }

  const extra = new Map() // the visitor's own color test
  const byId = (id) => TESTS.find((t) => t.id === id) || extra.get(id)
  const draw = (target, W, H, dpr, t, test = byId(seq[cur])) => {
    const c2 = target.getContext('2d')
    c2.setTransform(1, 0, 0, 1, 0, 0)
    c2.textBaseline = 'alphabetic'
    test.draw(c2, W, H, dpr, motionState, t)
  }

  // ----- stage -----
  function open(ids, startAt = 0, m = 'tests', opts = {}) {
    close()
    seq = ids; cur = startAt; mode = m; paused = false
    cv = h('canvas', { 'aria-label': 'Test pattern' })
    ctx = cv.getContext('2d')
    hud = h('div', { class: 'hud', role: 'status', 'aria-live': 'polite' })
    const x = h('button', { type: 'button', class: 'x', 'aria-label': 'Close the test', title: 'Close (Esc)', onclick: close }, '×')
    layer = h('div', { class: 't-st-layer', tabindex: -1, role: 'dialog', 'aria-label': 'Screen test' }, cv, hud, x)
    layer.addEventListener('pointerdown', onPointer)
    layer.addEventListener('pointermove', (e) => { wake(); if (fl && e.buttons) moveFlash(e) })
    layer.addEventListener('wheel', (e) => { if (fl) { e.preventDefault(); sizeFlash(e.deltaY < 0 ? 10 : -10) } }, { passive: false })
    document.body.append(layer)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', redraw)
    document.addEventListener('fullscreenchange', onFs)
    layer.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {}) // the overlay already covers the window; fullscreen is a bonus
    layer.focus({ preventScroll: true })
    fl = m === 'flash' ? { x: innerWidth / 2, y: innerHeight / 2, size: 40, hz: 20, bg: '#000000', ci: 0, last: -1 } : null
    show(cur)
    startAuto(opts.interval)
    wake()
  }
  function close() {
    if (!layer) return
    cancelAnimationFrame(raf); raf = 0
    clearInterval(autoTimer); clearTimeout(idleTimer)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', redraw)
    document.removeEventListener('fullscreenchange', onFs)
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    layer.remove()
    layer = cv = ctx = hud = fl = null
  }
  const onFs = () => { if (!document.fullscreenElement && layer) close() }
  function size() {
    const dpr = window.devicePixelRatio || 1
    const W = Math.round(layer.clientWidth * dpr), H = Math.round(layer.clientHeight * dpr)
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    return { W, H, dpr }
  }
  function redraw() {
    if (!layer) return
    const { W, H, dpr } = size()
    if (fl) { flasher(ctx, W, H, dpr, fl, performance.now()); return }
    const t = byId(seq[cur])
    if (t.animated) return
    draw(cv, W, H, dpr, 0)
  }
  function show(i) {
    cur = (i + seq.length) % seq.length
    const t = byId(seq[cur])
    cancelAnimationFrame(raf); raf = 0
    if (t.animated || fl) { motionState = { hz: 0, frames: [] }; startLoop() } else redraw()
    paintHud()
  }
  function startLoop() {
    cancelAnimationFrame(raf)
    const t0 = performance.now()
    const loop = (now) => {
      if (!layer) return
      const { W, H, dpr } = size()
      if (fl) flasher(ctx, W, H, dpr, fl, now - t0)
      else {
        const fr = motionState.frames
        fr.push(now); if (fr.length > 90) fr.shift()
        if (fr.length > 20) { const d = fr.slice(1).map((v, k) => v - fr[k]).sort((a, b) => a - b); motionState.hz = Math.round(1000 / d[Math.floor(d.length / 2)]) }
        draw(cv, W, H, dpr, now - t0)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
  }
  function paintHud() {
    hud.replaceChildren()
    if (fl) {
      hud.append(h('b', 'Stuck pixel flasher'),
        h('small', 'Drag over the stuck pixel. Keep it flashing for 10 to 20 minutes. This helps sometimes but cannot be guaranteed.'),
        h('div', { class: 'row2' },
          h('button', { type: 'button', onclick: () => sizeFlash(-10) }, 'Smaller'), h('button', { type: 'button', onclick: () => sizeFlash(10) }, 'Larger'),
          h('button', { type: 'button', onclick: () => { fl.hz = clamp(fl.hz - 5, 5, 60); paintHud() } }, 'Slower'), h('button', { type: 'button', onclick: () => { fl.hz = clamp(fl.hz + 5, 5, 60); paintHud() } }, 'Faster'),
          h('button', { type: 'button', onclick: () => { fl.bg = fl.bg === '#000000' ? '#808080' : '#000000'; paintHud() } }, 'Background')),
        h('small', `${fl.size} px square · ${fl.hz} flashes per second · Esc to stop`))
      return
    }
    if (!prefs.get().hud) return
    const t = byId(seq[cur])
    const auto = autoTimer ? (paused ? 'paused (Space to resume)' : `auto, next in ${autoSecs()}s`) : null
    hud.append(h('b', `${cur + 1} / ${seq.length}  ${t.name}`), h('small', t.hint),
      h('small', `Arrow keys or tap: next / previous · Esc: close${auto ? ` · ${auto}` : ''}`))
  }
  let autoLeft = 0, autoEvery = 0
  const autoSecs = () => Math.max(0, Math.ceil(autoLeft))
  function startAuto(override) {
    clearInterval(autoTimer); autoTimer = 0
    autoEvery = override ?? (mode === 'cycle' ? prefs.get().cycle : prefs.get().auto)
    if (!autoEvery || mode === 'flash') return
    autoLeft = autoEvery
    autoTimer = setInterval(() => {
      if (paused) return
      autoLeft -= 0.5
      if (autoLeft <= 0) { autoLeft = autoEvery; show(cur + 1) } else if (autoLeft % 1 === 0) paintHud()
    }, 500)
  }
  function wake() {
    if (!layer) return
    layer.classList.remove('idle')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => layer?.classList.add('idle'), 2800)
  }
  function onPointer(e) {
    wake()
    if (e.target.closest('button')) return
    if (fl) { moveFlash(e); return }
    if (e.pointerType === 'mouse' && e.button === 2) return
    const left = e.clientX < innerWidth * 0.25 && e.pointerType !== 'mouse'
    show(cur + (left ? -1 : 1))
    if (autoTimer) autoLeft = autoEvery
  }
  function moveFlash(e) { fl.x = e.clientX; fl.y = e.clientY }
  function sizeFlash(d) { fl.size = clamp(fl.size + d, 1, 800); paintHud() }
  function onKey(e) {
    if (!layer) return
    const k = e.key
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    wake()
    if (fl) {
      const d = { '+': () => sizeFlash(10), '=': () => sizeFlash(10), '-': () => sizeFlash(-10), ArrowUp: () => { fl.hz = clamp(fl.hz + 5, 5, 60); paintHud() }, ArrowDown: () => { fl.hz = clamp(fl.hz - 5, 5, 60); paintHud() },
        ArrowRight: () => { fl.x += 1 }, ArrowLeft: () => { fl.x -= 1 }, b: () => { fl.bg = fl.bg === '#000000' ? '#808080' : '#000000' } }[k]
      if (d) { e.preventDefault(); e.stopPropagation(); d() }
      return
    }
    if (k === 'ArrowRight' || k === 'PageDown' || k === 'Enter') { e.preventDefault(); show(cur + 1) } else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { e.preventDefault(); show(cur - 1) } else if (k === ' ') {
      e.preventDefault()
      if (autoTimer) { paused = !paused; paintHud() } else show(cur + 1)
    } else if (k === 'i' || k === 'I') { prefs.update((p) => ({ ...p, hud: !p.hud })); paintHud() } else if (k === 'Home') { show(0) } else if (k === 'End') { show(seq.length - 1) } else return
    e.stopPropagation()
    if (autoTimer) autoLeft = autoEvery
  }

  // ----- page -----
  const startList = (id) => open(TESTS.map((t) => t.id), TESTS.findIndex((t) => t.id === id), 'tests')
  const quick = (iconName, g, title, text, onClick, main) => h('button', { type: 'button', class: ['qc', main && 'main'], onclick: onClick },
    h('div', { class: 'ic', style: { '--g': g } }, icon(iconName)), h('b', title), h('span', text))
  const flashWarn = () => {
    const m = modal({ title: 'Flashing colors warning', icon: 'triangle-alert',
      body: h('div', { class: 'stack' }, h('p', 'This test flashes bright colors quickly. It can trigger seizures in people with photosensitive epilepsy and can be uncomfortable for anyone. Stop if you feel unwell.'),
        h('p', { class: 'small muted' }, 'It tries to wake a stuck pixel by cycling it through colors. It helps sometimes, but it cannot repair a truly dead pixel.')),
      actions: [button('Cancel', { onClick: () => m.close() }), button('I understand, start', { variant: 'primary', icon: 'zap', onClick: () => { m.close(); open(['black'], 0, 'flash') } })] })
  }
  const customIn = h('input', { type: 'color', value: '#ff6600', 'aria-label': 'Pick a color to fill the screen', style: 'width:100%;height:100%;opacity:0;position:absolute;inset:0;cursor:pointer',
    onchange: (e) => { extra.set('custom', { id: 'custom', name: `Custom color ${e.target.value}`, draw: fill(e.target.value), hint: 'The color you picked.' }); open(['custom'], 0, 'tests') } })

  const cards = (g) => h('div', { class: 'cards' }, TESTS.filter((t) => t.g === g).map((t) => {
    const c = h('canvas', { width: 160, height: 100, 'aria-hidden': 'true' })
    queueMicrotask(() => { try { draw(c, 160, 100, 1, 600, t) } catch { /* thumbnail is optional */ } })
    return h('button', { type: 'button', class: 'tc', onclick: () => startList(t.id), title: t.hint }, c, h('div', t.name))
  }))
  const dpr = window.devicePixelRatio || 1
  const facts = stats([
    { label: 'Native resolution', value: `${Math.round(screen.width * dpr)} × ${Math.round(screen.height * dpr)}`, hint: 'device pixels (approx.)', accent: true },
    { label: 'Scale', value: `${formatNumber(dpr, 2)}x`, hint: `${screen.width} × ${screen.height} CSS px` },
    { label: 'Color depth', value: `${screen.colorDepth}-bit` },
    { label: 'Wide gamut', value: matchMedia('(color-gamut: p3)').matches ? 'P3' : matchMedia('(color-gamut: srgb)').matches ? 'sRGB' : 'Unknown', hint: matchMedia('(dynamic-range: high)').matches ? 'HDR capable' : 'Standard range' },
  ])
  const autoSel = select([['0', 'Off'], ['2', 'Every 2 seconds'], ['3', 'Every 3 seconds'], ['5', 'Every 5 seconds'], ['10', 'Every 10 seconds']], String(prefs.get().auto), (v) => prefs.update((p) => ({ ...p, auto: Number(v) })))
  const cycleSel = select([['2', '2 seconds'], ['3', '3 seconds'], ['5', '5 seconds'], ['10', '10 seconds']], String(prefs.get().cycle), (v) => prefs.update((p) => ({ ...p, cycle: Number(v) })))

  root.append(h('div', { class: 't-st stack' },
    h('div', { class: 'quick' },
      quick('scan-eye', 'linear-gradient(135deg,#6366f1,#ec4899)', 'Dead pixel check', 'Cycles black, white, red, green, blue, cyan, magenta and yellow on its own. Look for dots that do not match.', () => open(DEAD_SEQ, 0, 'cycle'), true),
      quick('moon', 'linear-gradient(135deg,#0f172a,#475569)', 'Backlight bleed', 'All black. Dim the room and look for glow at the edges and corners.', () => open(['black', 'gray10', 'gray25'], 0, 'tests')),
      quick('zap', 'linear-gradient(135deg,#f97316,#ef4444)', 'Stuck pixel flasher', 'A small square flashes colors fast. Drag it over a stuck pixel to try to wake it up.', flashWarn)),
    h('section', { class: 'panel stack' }, h('h2', 'Your display'), facts),
    h('section', { class: 'panel' }, h('div', { class: 'opts' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Auto-advance the tests'), autoSel),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Dead pixel check speed'), cycleSel),
      toggle('Show on-screen tips', prefs.get().hud, (v) => prefs.update((p) => ({ ...p, hud: v }))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Your own color'), h('div', { style: 'position:relative;width:120px;height:42px;border-radius:12px;border:1px solid var(--border-strong);background:conic-gradient(#ef4444,#facc15,#22c55e,#06b6d4,#8b5cf6,#ef4444);overflow:hidden' }, customIn)))),
    GROUPS.map((g) => [h('div', { class: 'grp' }, g), cards(g)]),
    h('p', { class: 'small muted' }, 'Tap or press the arrow keys to move through the tests, Space pauses the auto-advance, I hides the tips and Esc closes. Run the tests with the screen at its normal brightness, and clean it first so dust is not mistaken for a dead pixel.')))

  return close
}
