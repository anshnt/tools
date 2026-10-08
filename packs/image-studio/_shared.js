// Shared helpers for the image-studio pack: look and feel (stage, hero drop zone, sliding pills, bento tiles, success state),
// motion helpers, image loading, canvas drawing, color math and export helpers. Files starting with "_" are never tool modules.
import { h, svg, icon, button, toast, yieldToMain, onCleanup, dropzone, segmented, field, rangeField, number, formatBytes, clear } from '../../lib/ui.js'
import { loadImage, canvas as mkCanvas, toBlob, MAX_PIXELS } from '../../lib/image.js'

export { MAX_PIXELS }
export const IMG_ACCEPT = 'image/*,.heic,.heif,.avif,.webp'
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)')
export const canHover = matchMedia('(hover: hover)').matches

// ---------- Styles ----------
const CSS = `
@property --is-ang { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
@keyframes isSpin { to { --is-ang: 360deg; } }
@keyframes isPop { from { opacity: 0; transform: translateY(14px) scale(.94); filter: blur(4px); } }
@keyframes isFloat { from { transform: translateY(0) rotate(var(--r, 0deg)); } to { transform: translateY(-12px) rotate(calc(var(--r, 0deg) + 4deg)); } }
@keyframes isDraw { to { stroke-dashoffset: 0; } }
@keyframes isSkel { to { background-position: -200% 0; } }
@keyframes isBurst {
  0% { transform: translate(0, 0) scale(0) rotate(0); opacity: 1; }
  18% { transform: translate(calc(var(--dx) * .4), calc(var(--dy) * .4)) scale(var(--s)) rotate(calc(var(--r) * .3)); opacity: 1; }
  100% { transform: translate(var(--dx), calc(var(--dy) + 36px)) scale(.2) rotate(var(--r)); opacity: 0; }
}
@keyframes isPulse { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 40%, transparent); } 50% { box-shadow: 0 0 0 8px transparent; } }

/* Stage: the framed surface where the picture lives */
.is-stage { position: relative; isolation: isolate; border-radius: 26px; padding: clamp(12px, 2.4vw, 22px); overflow: hidden; border: 1px solid var(--border); min-width: 0;
  background: radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--accent) 12%, var(--surface)), var(--surface-2) 72%); }
.is-stage::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: .6;
  background-image: radial-gradient(color-mix(in srgb, var(--text) 14%, transparent) 1px, transparent 1.3px); background-size: 20px 20px;
  -webkit-mask-image: radial-gradient(75% 75% at 50% 45%, #000, transparent); mask-image: radial-gradient(75% 75% at 50% 45%, #000, transparent); }
.is-stage::after { content: ""; position: absolute; width: 320px; height: 320px; right: -120px; top: -150px; border-radius: 50%; z-index: -1; pointer-events: none;
  background: radial-gradient(circle, color-mix(in srgb, var(--c, var(--accent-2)) 30%, transparent), transparent 70%); animation: isFloat 9s ease-in-out infinite alternate; }
.is-stage.flat { padding: 0; }
.is-frame { display: block; margin: 0 auto; max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 24px 48px -26px rgba(10, 10, 30, .55), 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent); }
.is-checker { background: var(--checker); }
.is-cap { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; justify-content: center; margin-top: 12px; font-size: 12.5px; color: var(--muted); }
.is-cap b { color: var(--text-2); font-weight: 600; font-variant-numeric: tabular-nums; }
.is-eyebrow { font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }

/* Motion */
.is-pop { animation: isPop .55s var(--spring) both; animation-delay: calc(var(--i, 0) * 45ms); }
.is-tilt { transition: transform .18s var(--ease), box-shadow .3s; transform: perspective(900px) rotateX(var(--ry, 0deg)) rotateY(var(--rx, 0deg)); will-change: transform; }
.is-spot { position: relative; }
.is-spot::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity .3s;
  background: radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%); }
.is-spot:hover::after { opacity: 1; }
.is-skel { border-radius: 14px; background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%) 0 0 / 200% 100%; animation: isSkel 1.3s linear infinite; }
.is-burst { position: fixed; z-index: 500; width: 0; height: 0; pointer-events: none; }
.is-burst i { position: absolute; left: -4px; top: -4px; width: 8px; height: 8px; border-radius: 2px; animation: isBurst .95s cubic-bezier(.2, .8, .2, 1) forwards; }

/* Hero drop zone */
.is-drop { position: relative; border-radius: 30px; padding: 1.5px; min-width: 0;
  background: conic-gradient(from var(--is-ang), color-mix(in srgb, var(--accent) 85%, transparent), color-mix(in srgb, var(--c, var(--accent-2)) 85%, transparent), transparent 38%, transparent 62%, color-mix(in srgb, var(--accent) 85%, transparent));
  animation: isSpin 7s linear infinite; }
.is-drop.compact { padding: 0; background: none; animation: none; border-radius: 20px; }
.is-drop .dropzone { border: 0; border-radius: 28.5px; min-height: 290px; background: var(--surface); }
.is-drop .dropzone.compact { border: 1.5px dashed var(--border-strong); border-radius: 20px; min-height: 0; }
.is-drop .dropzone.compact:hover, .is-drop .dropzone.compact.drag { border-color: var(--accent); }
.is-drop .dropzone .dz-icon { width: 66px; height: 66px; border-radius: 20px; background: linear-gradient(140deg, var(--accent), color-mix(in srgb, var(--accent) 50%, var(--accent-2))); color: var(--accent-text); box-shadow: 0 16px 30px -14px var(--accent); }
.is-drop .dropzone.compact .dz-icon { width: 42px; height: 42px; border-radius: 13px; }
.is-drop .dropzone strong { font-size: 18px; letter-spacing: -.02em; position: relative; }
.is-drop .dropzone.compact strong { font-size: 14.5px; }
.is-art { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
.is-drop .dropzone.compact .is-art { display: none; }
.is-art i { position: absolute; width: 92px; height: 116px; border-radius: 16px; background: var(--surface); border: 1px solid color-mix(in srgb, var(--c, var(--accent)) 28%, var(--border)); box-shadow: var(--shadow);
  transform: rotate(var(--r)); animation: isFloat 6s ease-in-out infinite alternate; animation-delay: calc(var(--d, 0) * -1s); opacity: .9; }
.is-art i::before { content: ""; position: absolute; inset: 8px 8px 34px; border-radius: 9px; background: linear-gradient(135deg, var(--g1), var(--g2)); }
.is-art i::after { content: ""; position: absolute; left: 10px; right: 36px; bottom: 13px; height: 6px; border-radius: 4px; background: var(--border-strong); }
.is-art .a1 { left: 5%; top: 12%; --r: -12deg; --d: 1; --g1: #818cf8; --g2: #f472b6; }
.is-art .a2 { left: 14%; bottom: 8%; --r: 8deg; --d: 3; --g1: #34d399; --g2: #22d3ee; width: 74px; height: 94px; }
.is-art .a3 { right: 6%; top: 10%; --r: 10deg; --d: 2; --g1: #fb923c; --g2: #f43f5e; }
.is-art .a4 { right: 15%; bottom: 7%; --r: -7deg; --d: 4; --g1: #a78bfa; --g2: #38bdf8; width: 78px; height: 98px; }
.is-sample { display: inline-flex; align-items: center; gap: 6px; }

/* Sliding pills */
.is-pills { position: relative; display: inline-flex; flex-wrap: wrap; max-width: 100%; border-radius: 14px; padding: 4px; gap: 2px; }
.is-pills button { position: relative; z-index: 1; white-space: nowrap; }
.is-pills button[aria-pressed="true"], :root[data-theme="dark"] .is-pills button[aria-pressed="true"] { background: transparent; box-shadow: none; color: var(--text); }
.is-pills .thumb { position: absolute; z-index: 0; left: 0; top: 0; width: var(--w, 0); height: var(--h, 0); transform: translate(var(--x, 0), var(--y, 0)); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow-sm), 0 0 0 1px var(--border);
  transition: transform .38s var(--spring), width .3s var(--ease), height .3s var(--ease); pointer-events: none; }
:root[data-theme="dark"] .is-pills .thumb { background: var(--surface-3); }
.is-pills.block { display: flex; width: 100%; }
.field > .is-pills:not(.block), .stack > .is-pills:not(.block) { align-self: flex-start; }
.is-pills.block button { flex: 1; }

/* Preset chips */
.is-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.is-chip { height: 34px; padding: 0 13px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 13px; font-weight: 550; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
  transition: transform .2s var(--spring), border-color .2s, background .2s, color .2s, box-shadow .2s; }
.is-chip:hover { transform: translateY(-2px); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); color: var(--text); }
.is-chip:active { transform: scale(.96); }
.is-chip[aria-pressed="true"] { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); color: var(--accent-text); border-color: transparent; box-shadow: 0 8px 18px -10px var(--accent); }
.is-chip .icon { width: 15px; height: 15px; }

/* Bento tiles */
.is-bento { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 10px; }
.is-tile { position: relative; overflow: hidden; isolation: isolate; display: block; min-width: 0; padding: 15px 16px; border-radius: 20px; text-align: left; font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--border);
  transition: transform .3s var(--spring), box-shadow .3s, border-color .3s; animation: isPop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 45ms); }
button.is-tile { cursor: pointer; width: 100%; }
.is-tile:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: var(--border-strong); }
.is-tile .l { font-size: 12px; color: var(--muted); font-weight: 550; letter-spacing: .02em; display: flex; align-items: center; gap: 6px; }
.is-tile .l .icon { width: 13px; height: 13px; opacity: 0; transition: opacity .2s; }
button.is-tile:hover .l .icon { opacity: .8; }
.is-tile .v { font-size: 24px; font-weight: 650; letter-spacing: -.03em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; line-height: 1.2; margin-top: 3px; }
.is-tile .h { font-size: 12px; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }
.is-tile.hero { grid-column: span 2; background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 16%, var(--surface)), color-mix(in srgb, var(--c, var(--accent-2)) 10%, var(--surface))); border-color: color-mix(in srgb, var(--accent) 36%, var(--border)); }
.is-tile.hero::after { content: ""; position: absolute; width: 150px; height: 150px; right: -50px; top: -60px; border-radius: 50%; z-index: -1; background: radial-gradient(circle, color-mix(in srgb, var(--c, var(--accent-2)) 28%, transparent), transparent 70%); }
.is-tile.hero .v { font-size: clamp(30px, 5vw, 42px); background: var(--brand); -webkit-background-clip: text; background-clip: text; color: transparent; padding-bottom: .05em; }
:root[data-theme="dark"] .is-tile.hero .v { background-image: linear-gradient(120deg, #a5b4fc, #d8b4fe 40%, #f9a8d4 75%, #fdba74); }
.is-tile.bad { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 30%, var(--border)); }
.is-tile.bad .v { color: var(--danger); background: none; -webkit-text-fill-color: currentColor; }
.is-tile.good .v { color: var(--success); }
@media (max-width: 340px) { .is-tile.hero { grid-column: 1 / -1; } }

/* Success card */
.is-done { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px 16px; border-radius: 20px; animation: isPop .5s var(--spring) both;
  background: linear-gradient(135deg, color-mix(in srgb, var(--success) 12%, var(--surface)), var(--surface)); border: 1px solid color-mix(in srgb, var(--success) 30%, var(--border)); }
.is-check { width: 44px; height: 44px; flex: none; }
.is-check circle { fill: none; stroke: var(--success); stroke-width: 3; stroke-dasharray: 145; stroke-dashoffset: 145; animation: isDraw .6s var(--ease) .05s forwards; }
.is-check path { fill: none; stroke: var(--success); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; stroke-dashoffset: 40; animation: isDraw .4s var(--ease) .5s forwards; }
.is-done-text { flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.is-done-text span { font-size: 13.5px; color: var(--muted); }
.is-done-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* Compare slider */
.is-cmp { position: relative; margin: 0 auto; overflow: hidden; border-radius: 14px; user-select: none; -webkit-user-select: none; touch-action: pan-y; cursor: ew-resize; max-width: 100%;
  background: var(--checker); box-shadow: 0 24px 48px -26px rgba(10, 10, 30, .55), 0 0 0 1px color-mix(in srgb, var(--text) 8%, transparent); }
.is-cmp > .layer { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: fill; pointer-events: none; }
.is-cmp > .top { clip-path: inset(0 calc(100% - var(--p, 50%)) 0 0); }
.is-cmp.vertical > .top { clip-path: inset(0 0 calc(100% - var(--p, 50%)) 0); }
.is-cmp.vertical { cursor: ns-resize; touch-action: pan-x; }
.is-cmp .bar { position: absolute; top: 0; bottom: 0; left: var(--p, 50%); width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .25), 0 0 16px rgba(0, 0, 0, .35); pointer-events: none; }
.is-cmp.vertical .bar { top: var(--p, 50%); bottom: auto; left: 0; right: 0; width: auto; height: 2px; margin: -1px 0 0; }
.is-cmp .knob { position: absolute; left: var(--p, 50%); top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; display: grid; place-items: center; color: #111; background: #fff; box-shadow: 0 8px 24px rgba(0, 0, 0, .4); transition: transform .2s var(--spring); outline-offset: 3px; }
.is-cmp.vertical .knob { left: 50%; top: var(--p, 50%); margin: -22px 0 0 -22px; }
.is-cmp .knob:focus-visible { outline: 3px solid var(--accent); }
.is-cmp.drag .knob, .is-cmp:hover .knob { transform: scale(1.1); }
.is-cmp .tag { position: absolute; top: 10px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 650; color: #fff; background: rgba(10, 10, 20, .55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); pointer-events: none; }
.is-cmp .tag.a { left: 10px; }
.is-cmp .tag.b { right: 10px; }

@media (max-width: 720px) {
  .is-art .a2, .is-art .a4 { display: none; }
  .is-art i { width: 70px; height: 88px; }
  .is-drop .dropzone { min-height: 230px; }
}
@media (prefers-reduced-motion: reduce) {
  .is-drop { animation: none; }
  .is-stage::after, .is-art i { animation: none; }
}
`

/** Inject the shared stylesheet (once) and optional extra CSS for a tool. */
export function ensureStyle() {
  if (!document.getElementById('is-style')) document.head.append(h('style', { id: 'is-style' }, CSS))
}
export function addStyle(id, css) {
  ensureStyle()
  if (!document.getElementById(id)) document.head.append(h('style', { id }, css))
}
ensureStyle()

// ---------- Motion ----------
/** Run fn on the next frame, or after 90 ms if frames are paused (background tab). Coalesces repeated calls. */
export function frame(fn) {
  let pending = false
  return (...args) => {
    if (pending) return
    pending = true
    const run = () => { if (!pending) return; pending = false; fn(...args) }
    requestAnimationFrame(run)
    setTimeout(run, 90)
  }
}

/** Animate a number inside an element (instant when motion is reduced). */
export function countUp(el, to, { format = (n) => n.toLocaleString(), duration = 550 } = {}) {
  if (reduceMotion.matches || !Number.isFinite(to)) { el.textContent = format(to); return }
  const start = performance.now()
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration)
    el.textContent = format(to * (1 - Math.pow(1 - p, 3)))
    if (p < 1 && el.isConnected) requestAnimationFrame(step)
    else el.textContent = format(to)
  }
  requestAnimationFrame(step)
  setTimeout(() => { el.textContent = format(to) }, duration + 60)
}

const CONFETTI = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#22c55e', '#0ea5e9']
/** A quick burst of confetti from the middle of an element. */
export function burst(anchor, n = 16) {
  if (reduceMotion.matches || !anchor?.isConnected) return
  const r = anchor.getBoundingClientRect()
  const box = h('div', { class: 'is-burst', 'aria-hidden': 'true', style: { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` } })
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5
    const d = 46 + Math.random() * 64
    box.append(h('i', { style: { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d}px`, '--r': `${Math.random() * 540 - 270}deg`, '--s': 0.6 + Math.random() * 0.9, background: CONFETTI[i % CONFETTI.length] } }))
  }
  document.body.append(box)
  setTimeout(() => box.remove(), 1100)
}

/** Pointer-driven 3D tilt on hover-capable devices. */
export function tilt(el, max = 5) {
  if (!canHover || reduceMotion.matches) return el
  el.classList.add('is-tilt')
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect()
    el.style.setProperty('--rx', `${((e.clientX - r.left) / r.width - 0.5) * max * 2}deg`)
    el.style.setProperty('--ry', `${-((e.clientY - r.top) / r.height - 0.5) * max * 2}deg`)
  })
  el.addEventListener('pointerleave', () => { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg') })
  return el
}

/** Cursor spotlight (sets --mx/--my). */
export function spot(el) {
  el.classList.add('is-spot')
  if (canHover) el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }, { passive: true })
  return el
}

/** Give the children of a container staggered entrance delays. */
export function stagger(container) {
  ;[...container.children].forEach((c, i) => { c.classList.add('is-pop'); c.style.setProperty('--i', Math.min(i, 14)) })
  return container
}

// ---------- Components ----------
/** The framed stage for previews. */
export const stage = (...kids) => h('div', { class: 'is-stage' }, kids)

/** Hero drop zone with floating cards. Returns a wrapper; .dz is the kit dropzone, .setCompact(bool) shrinks it once files are loaded. */
export function heroDrop({ accept = IMG_ACCEPT, multiple = false, onFiles, label, hint, paste = true, sample = 0, sampleLabel, sampleFrom = 0 }) {
  const dz = dropzone({ accept, multiple, onFiles, label, hint, paste, icon: 'image-plus' })
  dz.append(h('div', { class: 'is-art', 'aria-hidden': 'true' }, h('i', { class: 'a1' }), h('i', { class: 'a2' }), h('i', { class: 'a3' }), h('i', { class: 'a4' })))
  const extra = sample ? h('div', { class: 'row', style: 'margin-top:10px' },
    button(sampleLabel || (multiple ? `Try ${sample} sample images` : 'Try a sample image'), { icon: 'wand-sparkles', variant: 'ghost', size: 'sm',
      onClick: async (e) => { const files = await sampleFiles(sample, 1200, 800, sampleFrom); (multiple ? onFiles : (f) => onFiles(f.slice(0, 1)))(files); e?.target?.blur?.() } })) : null
  const wrap = h('div', {}, h('div', { class: 'is-drop' }, dz), extra)
  const ring = wrap.firstChild
  wrap.dz = dz
  wrap.setCompact = (on) => {
    dz.classList.toggle('compact', on)
    ring.classList.toggle('compact', on)
    if (extra) extra.hidden = on
  }
  return wrap
}

/** Segmented control with a sliding highlight. Same API as the kit's segmented(). */
export function pills(options, value, onChange, ariaLabel, { block = false } = {}) {
  const el = segmented(options, value, onChange, ariaLabel)
  el.classList.add('is-pills')
  if (block) el.classList.add('block')
  const thumb = h('span', { class: 'thumb', 'aria-hidden': 'true' })
  el.prepend(thumb)
  const place = () => {
    const on = el.querySelector('button[aria-pressed="true"]')
    if (!on || !el.offsetWidth) return
    thumb.style.setProperty('--x', `${on.offsetLeft}px`)
    thumb.style.setProperty('--y', `${on.offsetTop}px`)
    thumb.style.setProperty('--w', `${on.offsetWidth}px`)
    thumb.style.setProperty('--h', `${on.offsetHeight}px`)
  }
  const baseSet = el.set
  el.set = (v) => { baseSet(v); place() }
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(place)
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  }
  requestAnimationFrame(place)
  return el
}

/** Preset chips (single choice). chips([['a','A',icon?]], 'a', onChange) -> element with .value and .set(v). */
export function chipPicker(options, value, onChange, ariaLabel) {
  const el = h('div', { class: 'is-chips', role: 'group', 'aria-label': ariaLabel || null })
  el.value = value
  const btns = options.map((o) => {
    const [v, l, ic] = Array.isArray(o) ? o : [o, o]
    const b = h('button', { type: 'button', class: 'is-chip', 'aria-pressed': String(v === value), onclick: () => { el.set(v); onChange?.(v) } }, ic && icon(ic), l)
    b._v = v
    return b
  })
  el.append(...btns)
  el.set = (v) => { el.value = v; for (const b of btns) b.setAttribute('aria-pressed', String(b._v === v)) }
  return el
}

/** tiles([{label, value, hint, hero, bad, good, copy}]) -> bento grid of result tiles (copy: click to copy that text). */
export function tiles(items, { copy } = {}) {
  const grid = h('div', { class: 'is-bento', 'aria-live': 'polite' })
  items.filter(Boolean).forEach((s, i) => {
    const inner = [h('div', { class: 'l' }, s.label, s.copy != null && icon('copy')), h('div', { class: 'v' }, s.value), s.hint && h('div', { class: 'h' }, s.hint)]
    const cls = ['is-tile', s.hero && 'hero', s.bad && 'bad', s.good && 'good']
    grid.append(s.copy != null && copy
      ? h('button', { type: 'button', class: cls, style: { '--i': Math.min(i, 12) }, title: 'Copy', onclick: () => copy(String(s.copy)) }, inner)
      : h('div', { class: cls, style: { '--i': Math.min(i, 12) } }, inner))
  })
  return grid
}

/** A labelled number input. onInput gets NaN while empty. Returns the field element; .input is the <input>. */
export function numField(label, value, onInput, { min, max, step, hint, placeholder } = {}) {
  const input = number(value, { min, max, step, placeholder, ariaLabel: label, onInput })
  const el = field(label, input, hint)
  el.input = input
  return el
}

/** Animated success card with a drawn check and a confetti burst. */
export function done(title, detail, ...actions) {
  const el = h('div', { class: 'is-done', role: 'status' },
    svg('svg', { class: 'is-check', viewBox: '0 0 52 52', 'aria-hidden': 'true' }, svg('circle', { cx: 26, cy: 26, r: 23 }), svg('path', { d: 'M15 27l8 8 14-17' })),
    h('div', { class: 'is-done-text' }, h('strong', title), detail ? h('span', detail) : null),
    actions.length ? h('div', { class: 'is-done-actions' }, actions) : null)
  setTimeout(() => burst(el.querySelector('.is-check')), 380)
  return el
}

/**
 * Before/after comparison with a draggable divider.
 * compareSlider({a, b, labelA, labelB, width, height, vertical, position}) where a and b are <img> or <canvas>.
 * "a" is shown on the left (or top) up to the divider. Returns an element with .setPosition(0..100), .position, .sweep().
 */
export function compareSlider({ a, b, labelA = '', labelB = '', width, height, vertical = false, position = 50, maxHeight = 560 }) {
  a.classList.add('layer', 'top')
  b.classList.add('layer')
  const knob = h('div', { class: 'knob', tabindex: 0, role: 'slider', 'aria-label': 'Comparison divider', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': position, 'aria-orientation': vertical ? 'vertical' : 'horizontal' },
    icon(vertical ? 'chevrons-up-down' : 'chevrons-left-right'))
  const el = h('div', { class: ['is-cmp', vertical && 'vertical'], style: { aspectRatio: `${width} / ${height}`, width: `min(100%, ${Math.round(maxHeight * width / height)}px)` } },
    b, a, labelB && h('span', { class: 'tag b' }, labelB), labelA && h('span', { class: 'tag a' }, labelA), h('div', { class: 'bar' }), knob)
  let anim = 0
  el.position = position
  el.setPosition = (p) => {
    el.position = Math.max(0, Math.min(100, p))
    el.style.setProperty('--p', `${el.position}%`)
    knob.setAttribute('aria-valuenow', String(Math.round(el.position)))
    el.onchange?.(el.position)
  }
  const fromEvent = (e) => {
    const r = el.getBoundingClientRect()
    el.setPosition(vertical ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100)
  }
  el.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim)
    el.setPointerCapture(e.pointerId)
    el.classList.add('drag')
    fromEvent(e)
  })
  el.addEventListener('pointermove', (e) => { if (el.classList.contains('drag')) fromEvent(e) })
  const end = () => el.classList.remove('drag')
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  knob.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 2
    const d = { ArrowLeft: -step, ArrowUp: -step, ArrowRight: step, ArrowDown: step, Home: -100, End: 100 }[e.key]
    if (d === undefined) return
    e.preventDefault()
    el.setPosition(e.key === 'Home' ? 0 : e.key === 'End' ? 100 : el.position + d)
  })
  /** Glide the divider from the edges to the middle so the visitor sees it is interactive. */
  el.sweep = () => {
    if (reduceMotion.matches) return el.setPosition(position)
    const t0 = performance.now()
    const seq = (t) => (t < 0.35 ? 50 + 42 * Math.sin((t / 0.35) * Math.PI / 2) : t < 0.8 ? 92 - 84 * ((t - 0.35) / 0.45) : 8 + (position - 8) * ((t - 0.8) / 0.2))
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / 1800)
      el.setPosition(seq(t))
      if (t < 1 && el.isConnected) anim = requestAnimationFrame(tick)
    }
    anim = requestAnimationFrame(tick)
  }
  el.style.setProperty('--p', `${position}%`)
  onCleanup(() => cancelAnimationFrame(anim))
  return el
}

// ---------- Images ----------
export const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif|svg|tiff?)$/i.test(f.name)

/**
 * Decode files into [{name, file, img, w, h}]. Unreadable files are skipped with a single toast.
 * onProgress(done, total, name) is called after each file; `signal` aborts the loop.
 */
export async function readImages(files, { onProgress, signal } = {}) {
  const out = []
  let failed = 0
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) break
    try {
      const img = await loadImage(files[i])
      out.push({ name: files[i].name, file: files[i], img, w: img.naturalWidth, h: img.naturalHeight })
    } catch { failed++ }
    onProgress?.(i + 1, files.length, files[i].name)
    await yieldToMain()
  }
  if (failed) toast(`Skipped ${failed} file${failed === 1 ? '' : 's'} that could not be read as images.`, 'error')
  return out
}

/** A canvas holding img scaled so its longest side is at most maxEdge (never upscaled). */
export function scaled(img, maxEdge) {
  const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height
  const s = Math.min(1, maxEdge / Math.max(w, hh))
  const c = mkCanvas(w * s, hh * s)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c
}

/** RGBA pixels of a source drawn at w x h. */
export function readPixels(src, w, hh) {
  const c = mkCanvas(w, hh)
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return ctx.getImageData(0, 0, c.width, c.height)
}

export const newCanvas = mkCanvas

/** Draw src (size sw x sh) so it covers the box. zoom >= 1 crops further; fx/fy (0..1) choose the focus. */
export function drawCover(ctx, src, sw, sh, x, y, w, hh, { zoom = 1, fx = 0.5, fy = 0.5 } = {}) {
  const scale = Math.max(w / sw, hh / sh) * zoom
  const cw = w / scale, ch = hh / scale
  ctx.drawImage(src, (sw - cw) * fx, (sh - ch) * fy, cw, ch, x, y, w, hh)
}
/** Draw src fully inside the box, centred. */
export function drawContain(ctx, src, sw, sh, x, y, w, hh) {
  const s = Math.min(w / sw, hh / sh)
  const dw = sw * s, dh = sh * s
  ctx.drawImage(src, x + (w - dw) / 2, y + (hh - dh) / 2, dw, dh)
  return { x: x + (w - dw) / 2, y: y + (hh - dh) / 2, w: dw, h: dh }
}

/** Copy of a canvas on an opaque background (JPEG has no transparency). */
export function flatten(c, bg = '#ffffff') {
  const o = mkCanvas(c.width, c.height)
  const x = o.getContext('2d')
  x.fillStyle = bg
  x.fillRect(0, 0, o.width, o.height)
  x.drawImage(c, 0, 0)
  return o
}

export const TYPE_LABEL = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP' }
export const TYPE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** canvas -> Blob. JPEG is flattened onto bg first. */
export function encode(c, type = 'image/png', quality = 0.92, bg = '#ffffff') {
  return toBlob(type === 'image/jpeg' ? flatten(c, bg) : c, type, quality)
}

/** Format + quality controls. Returns {el, type, quality, ext} (getters). */
export function formatPicker({ types = ['image/png', 'image/jpeg', 'image/webp'], value = 'image/png', quality = 92, onChange } = {}) {
  const q = rangeField('Quality', { min: 40, max: 100, value: quality, format: (v) => `${v}%`, onInput: () => onChange?.() })
  const sync = () => { q.hidden = state.value === 'image/png' }
  const seg = pills(types.map((t) => [t, TYPE_LABEL[t]]), value, () => { sync(); onChange?.() }, 'Format')
  const state = seg
  const el = h('div', { class: 'stack tight' }, field('Format', seg), q)
  sync()
  return { el, get type() { return seg.value }, get quality() { return q.input.valueAsNumber / 100 }, get ext() { return TYPE_EXT[seg.value] } }
}

/** Largest allowed output edge scale so w*h stays under MAX_PIXELS. */
export function capSize(w, hh) {
  const s = Math.min(1, Math.sqrt(MAX_PIXELS / (w * hh)))
  return { w: Math.max(1, Math.floor(w * s)), h: Math.max(1, Math.floor(hh * s)), capped: s < 1 }
}

// ---------- Math / color ----------
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const gcd = (a, b) => { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) [a, b] = [b, a % b]; return a || 1 }
export const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
export const rgbToHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase()
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let s = m[1]
  if (s.length === 3) s = [...s].map((c) => c + c).join('')
  const n = parseInt(s, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let hh = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    hh *= 60
  }
  return [Math.round(hh) % 360, Math.round(s * 100), Math.round(l * 100)]
}
export function hslToRgb([hh, s, l]) {
  s /= 100; l /= 100
  const k = (n) => (n + hh / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** '#000' or '#fff', whichever reads better on the color. */
export const textOn = (rgb) => (contrast(rgb, [0, 0, 0]) >= contrast(rgb, [255, 255, 255]) ? '#000000' : '#ffffff')

/** Deterministic random numbers (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const ratioOf = (w, hh) => { const g = gcd(w, hh); return [Math.round(w / g), Math.round(hh / g)] }
export const fmtNum = (n, max = 2) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: max }) : '-')
export const stem = (name) => name.replace(/\.[^.]+$/, '')

// ---------- Sample images (so every tool can be tried without a file) ----------
const SCENES = [
  { name: 'sunset', sky: ['#1e1b4b', '#6d28d9', '#db2777', '#fb923c', '#fde68a'], sun: '#fff4c7', hills: ['#6b21a8', '#4c1d95', '#2e1065'] },
  { name: 'ocean', sky: ['#082f49', '#0369a1', '#38bdf8', '#bae6fd', '#f0f9ff'], sun: '#ffffff', hills: ['#0e7490', '#155e75', '#134e4a'] },
  { name: 'forest', sky: ['#052e16', '#15803d', '#84cc16', '#d9f99d', '#fefce8'], sun: '#fef9c3', hills: ['#166534', '#14532d', '#052e16'] },
  { name: 'candy', sky: ['#a21caf', '#e879f9', '#fb7185', '#fdba74', '#fef3c7'], sun: '#fffbeb', hills: ['#be185d', '#9d174d', '#831843'] },
  { name: 'desert', sky: ['#7c2d12', '#c2410c', '#f97316', '#fcd34d', '#fff7ed'], sun: '#fffbeb', hills: ['#b45309', '#92400e', '#78350f'] },
  { name: 'colors', test: true },
]

/** Draw a synthetic scene (index into the sample set). */
export function sampleCanvas(i = 0, w = 1200, hh = 800) {
  const sc = SCENES[i % SCENES.length]
  const c = mkCanvas(w, hh)
  const g = c.getContext('2d')
  const r = rng(7 + i * 31)
  if (sc.test) {
    g.fillStyle = '#f5f5f4'
    g.fillRect(0, 0, w, hh)
    const hue = g.createLinearGradient(0, 0, w, 0)
    for (let k = 0; k <= 12; k++) hue.addColorStop(k / 12, `hsl(${k * 30} 85% 50%)`)
    g.fillStyle = hue
    g.fillRect(0, hh * 0.72, w, hh * 0.28)
    const wheel = g.createConicGradient ? g.createConicGradient(-Math.PI / 2, w * 0.27, hh * 0.36) : null
    if (wheel) {
      for (let k = 0; k <= 12; k++) wheel.addColorStop(k / 12, `hsl(${k * 30} 90% 50%)`)
      g.fillStyle = wheel
      g.beginPath(); g.arc(w * 0.27, hh * 0.36, hh * 0.3, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#f5f5f4'
      g.beginPath(); g.arc(w * 0.27, hh * 0.36, hh * 0.12, 0, Math.PI * 2); g.fill()
    }
    const dots = ['#dc2626', '#16a34a', '#2563eb', '#eab308', '#9333ea', '#ea580c']
    dots.forEach((col, k) => { g.fillStyle = col; g.beginPath(); g.arc(w * (0.58 + (k % 3) * 0.13), hh * (0.22 + Math.floor(k / 3) * 0.28), hh * 0.1, 0, Math.PI * 2); g.fill() })
    return c
  }
  const sky = g.createLinearGradient(0, 0, 0, hh)
  sc.sky.forEach((col, k) => sky.addColorStop(k / (sc.sky.length - 1), col))
  g.fillStyle = sky
  g.fillRect(0, 0, w, hh)
  for (let k = 0; k < 70; k++) { g.globalAlpha = 0.15 + r() * 0.5; g.fillStyle = '#fff'; g.beginPath(); g.arc(r() * w, r() * hh * 0.4, 0.6 + r() * 1.6, 0, Math.PI * 2); g.fill() }
  g.globalAlpha = 1
  const sx = w * (0.3 + r() * 0.4), sy = hh * 0.52
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, hh * 0.5)
  glow.addColorStop(0, sc.sun + 'dd'); glow.addColorStop(0.25, sc.sun + '55'); glow.addColorStop(1, sc.sun + '00')
  g.fillStyle = glow
  g.fillRect(0, 0, w, hh)
  g.fillStyle = sc.sun
  g.beginPath(); g.arc(sx, sy, hh * 0.07, 0, Math.PI * 2); g.fill()
  sc.hills.forEach((col, k) => {
    const base = hh * (0.62 + k * 0.13)
    const amp = hh * (0.1 - k * 0.02), f = 1.4 + r() * 1.6, ph = r() * 6
    g.fillStyle = col
    g.beginPath(); g.moveTo(0, hh)
    for (let x = 0; x <= w; x += 8) g.lineTo(x, base + Math.sin((x / w) * Math.PI * f + ph) * amp + Math.sin((x / w) * Math.PI * f * 2.7 + ph) * amp * 0.3)
    g.lineTo(w, hh); g.closePath(); g.fill()
  })
  return c
}

/** Make n sample image Files (JPEG, 1200 x 800). */
export async function sampleFiles(n = 1, w = 1200, hh = 800, start = 0) {
  const files = []
  for (let k = 0; k < n; k++) {
    const i = start + k
    const c = sampleCanvas(i, w, hh)
    const blob = await toBlob(c, 'image/jpeg', 0.9)
    files.push(new File([blob], `sample-${SCENES[i % SCENES.length].name}${i >= SCENES.length ? `-${Math.floor(i / SCENES.length) + 1}` : ''}.jpg`, { type: 'image/jpeg' }))
    await yieldToMain()
  }
  return files
}

// ---------- Misc ----------
export const kb = formatBytes
/** Run a named async job with a spinner-free guard: ignores re-entry. */
export function once(fn) {
  let running = false
  return async (...a) => { if (running) return; running = true; try { return await fn(...a) } finally { running = false } }
}
export { clear, yieldToMain }
