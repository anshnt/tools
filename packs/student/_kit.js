// Shared look-and-feel and helpers for the student pack (files starting with _ are never tool modules).
// One stylesheet is injected once; every selector is namespaced under .stu so nothing leaks into the shell.
import { h, icon, onCleanup, modal, button } from '../../lib/ui.js'
import { load, save, remove } from '../../lib/store.js'

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const CSS = `
.stu { position: relative; --stu-r: 22px; --pop: cubic-bezier(.34, 1.56, .64, 1); }
.stu * { box-sizing: border-box; }
/* Animated mesh stage that tools sit on */
.stu-stage { position: relative; isolation: isolate; border-radius: 28px; padding: 14px; background: color-mix(in srgb, var(--surface-2) 55%, transparent); border: 1px solid var(--border); overflow: clip; }
.stu-stage::before, .stu-stage::after { content: ""; position: absolute; z-index: -1; width: 420px; height: 420px; border-radius: 50%; filter: blur(70px); opacity: .32; pointer-events: none; animation: stu-drift 18s ease-in-out infinite alternate; }
.stu-stage::before { left: -140px; top: -160px; background: radial-gradient(circle, var(--c, #e2a336), transparent 65%); }
.stu-stage::after { right: -160px; bottom: -180px; background: radial-gradient(circle, var(--accent-2, #c026d3), transparent 65%); animation-delay: -7s; opacity: .22; }
@keyframes stu-drift { to { transform: translate(60px, 40px) scale(1.12); } }
@media (max-width: 720px) { .stu-stage { padding: 8px; border-radius: 22px; } }

/* Tiles: soft tinted bento cards */
.stu-tile { position: relative; border-radius: var(--stu-r); border: 1px solid color-mix(in srgb, var(--tint, var(--border-strong)) 30%, var(--border)); padding: 18px;
  background: linear-gradient(150deg, color-mix(in srgb, var(--tint, transparent) 13%, var(--surface)), var(--surface) 62%); box-shadow: var(--shadow-sm); min-width: 0;
  transition: transform .35s var(--ease), box-shadow .35s var(--ease), border-color .3s; }
.stu-tile.lift:hover { transform: translateY(-3px); box-shadow: 0 22px 40px -24px color-mix(in srgb, var(--tint, #000) 60%, rgba(0,0,0,.35)); border-color: color-mix(in srgb, var(--tint, var(--accent)) 45%, var(--border)); }
.stu-tile.glow::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity .3s;
  background: radial-gradient(260px circle at var(--mx, 50%) var(--my, 0%), color-mix(in srgb, var(--tint, var(--accent)) 22%, transparent), transparent 70%); }
.stu-tile.glow:hover::before { opacity: 1; }
.stu-tile h3, .stu-title { font-size: 15px; font-weight: 620; letter-spacing: -.015em; display: flex; align-items: center; gap: 8px; margin: 0 0 12px; }
.stu-title .icon { color: var(--tint, var(--accent)); }
.stu-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; }
.stu-bento > .s3 { grid-column: span 3; } .stu-bento > .s4 { grid-column: span 4; } .stu-bento > .s5 { grid-column: span 5; } .stu-bento > .s6 { grid-column: span 6; }
.stu-bento > .s7 { grid-column: span 7; } .stu-bento > .s8 { grid-column: span 8; } .stu-bento > .s12 { grid-column: span 12; }
@media (max-width: 900px) { .stu-bento > * { grid-column: span 12 !important; } .stu-bento > .h6 { grid-column: span 6 !important; } }

/* Motion */
@keyframes stu-pop { from { opacity: 0; transform: translateY(14px) scale(.97); filter: blur(3px); } }
@keyframes stu-fade { from { opacity: 0; } }
@keyframes stu-shake { 0%, 100% { transform: none; } 20% { transform: translateX(-7px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(3px); } }
@keyframes stu-bounce { 0% { transform: scale(.7); } 60% { transform: scale(1.12); } 100% { transform: none; } }
@keyframes stu-sheen { to { background-position: 200% center; } }
@keyframes stu-pulse-ring { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
.stu-pop { animation: stu-pop .55s var(--ease) both; animation-delay: calc(var(--i, 0) * 55ms); }
.stu-shake { animation: stu-shake .4s var(--ease); }
.stu-bounce { animation: stu-bounce .45s var(--pop); }
.stu-gradient-text { background: var(--brand); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent; animation: stu-sheen 6s linear infinite; }

/* Small pieces */
.stu-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 11px; border-radius: 999px; font-size: 12.5px; font-weight: 550; color: var(--text-2); background: color-mix(in srgb, var(--tint, var(--surface-3)) 14%, var(--surface-2)); border: 1px solid color-mix(in srgb, var(--tint, var(--border-strong)) 28%, var(--border)); white-space: nowrap; }
.stu-pill .icon { width: 13px; height: 13px; }
.stu-pill.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 28%, transparent); }
.stu-pill.bad { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 28%, transparent); }
.stu-pill.warn { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 30%, transparent); }
.stu-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.stu-chip-btn { border: 1px solid var(--border); background: var(--surface); color: var(--text-2); border-radius: 999px; padding: 6px 13px; font-size: 13px; font-weight: 550; cursor: pointer; min-height: 32px; transition: all .2s var(--ease); }
.stu-chip-btn:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.stu-chip-btn[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }
.stu-hint { font-size: 12.5px; color: var(--muted); }
.stu-big { font-size: clamp(30px, 6vw, 52px); font-weight: 680; letter-spacing: -.045em; line-height: 1; font-variant-numeric: tabular-nums; }
.stu-ring { position: relative; display: grid; place-items: center; flex: none; }
.stu-ring svg { transform: rotate(-90deg); overflow: visible; }
.stu-ring .track { stroke: var(--surface-3); }
.stu-ring .bar { stroke-linecap: round; transition: stroke-dashoffset 1.1s var(--ease); }
.stu-ring .mid { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; align-content: center; }
.stu-ring .mid b { font-size: 28px; letter-spacing: -.04em; font-variant-numeric: tabular-nums; line-height: 1; }
.stu-ring .mid span { font-size: 11.5px; color: var(--muted); }
.stu-kbd { display: inline-block; min-width: 20px; padding: 1px 6px; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 6px; font: 600 11px var(--mono); background: var(--surface); color: var(--text-2); text-align: center; }
.stu-empty { display: grid; place-items: center; text-align: center; gap: 10px; padding: 34px 18px; color: var(--muted); border: 1.5px dashed var(--border-strong); border-radius: var(--stu-r); background: color-mix(in srgb, var(--surface) 60%, transparent); }
.stu-empty .art { width: 64px; height: 64px; border-radius: 20px; display: grid; place-items: center; color: var(--tint, var(--accent)); background: color-mix(in srgb, var(--tint, var(--accent)) 14%, var(--surface)); animation: stu-float 4s ease-in-out infinite; }
.stu-empty .art .icon { width: 30px; height: 30px; }
.stu-empty b { color: var(--text); font-size: 16px; letter-spacing: -.02em; }
@keyframes stu-float { 50% { transform: translateY(-6px) rotate(-4deg); } }
.stu-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.stu-toolbar .grow { flex: 1; min-width: 0; }
.stu-scroll { overflow: auto; -webkit-overflow-scrolling: touch; }
.stu-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.stu-mark { background: color-mix(in srgb, var(--success) 22%, transparent); border-radius: 4px; padding: 0 2px; }
.stu-miss { background: color-mix(in srgb, var(--danger) 16%, transparent); border-radius: 4px; padding: 0 2px; }
.stu-confetti { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 500; }
.stu-drop-hint { outline: 3px dashed var(--accent); outline-offset: -6px; }

/* Printing: only .stu-print is shown, with explicit light colours so dark mode never prints white on white */
@media screen { .stu-print { display: none; } }
@media print {
  body > *:not(.stu-print) { display: none !important; }
  .stu-print { display: block; color: #111; background: #fff; }
  html, body { background: #fff !important; }
}
@media (prefers-reduced-motion: reduce) {
  .stu-stage::before, .stu-stage::after, .stu-empty .art { animation: none; }
}
`

let styled = false
/** Inject the shared stylesheet once. */
export function ensureStyle() {
  if (styled || document.getElementById('stu-style')) { styled = true; return }
  document.head.append(h('style', { id: 'stu-style' }, CSS))
  styled = true
}

/** Inject a tool-specific stylesheet once (all selectors must be namespaced under the tool's own class). */
export function toolStyle(id, css) {
  if (document.getElementById(`stu-style-${id}`)) return
  document.head.append(h('style', { id: `stu-style-${id}` }, css))
}

/** Root wrapper every tool uses: sets up styles and returns the element to build into. */
export function stage(cls, ...kids) {
  ensureStyle()
  return h('div', { class: ['stu', 'stu-stage', cls] }, ...kids)
}

/** Plain wrapper without the animated stage (for tools that need a clean canvas). */
export function plain(cls, ...kids) {
  ensureStyle()
  return h('div', { class: ['stu', cls] }, ...kids)
}

/** A tinted bento tile. tile({tint:'#6366f1', title:'Notes', icon:'notebook', cls:'s6', glow:true}, ...kids) */
export function tile(opts = {}, ...kids) {
  const { tint, title, icon: ic, cls = '', glow = false, lift = false, actions, i } = opts
  const el = h('section', { class: ['stu-tile', glow && 'glow', lift && 'lift', cls], style: { ...(tint ? { '--tint': tint } : {}), ...(i != null ? { '--i': i } : {}) } },
    title && h('h3', { class: 'stu-title' }, ic && icon(ic), h('span', { style: 'flex:1;min-width:0' }, title), actions || null), ...kids)
  if (glow && matchMedia('(hover: hover)').matches) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }, { passive: true })
  }
  return el
}

export const TINTS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#a855f7', '#ef4444', '#14b8a6']

export function pill(text, tone = '', ic) {
  return h('span', { class: ['stu-pill', tone] }, ic && icon(ic), text)
}

/** Friendly empty state with an animated icon. */
export function emptyState(ic, title, text, ...actions) {
  return h('div', { class: 'stu-empty' }, h('div', { class: 'art' }, icon(ic)), h('b', title), text && h('div', { style: 'max-width:420px' }, text), actions.length ? h('div', { class: 'row', style: 'justify-content:center' }, actions) : null)
}

/** Set --i on children so .stu-pop staggers them. */
export function stagger(parent, selector) {
  const kids = selector ? [...parent.querySelectorAll(selector)] : [...parent.children]
  kids.forEach((k, i) => { k.classList.add('stu-pop'); k.style.setProperty('--i', Math.min(i, 14)) })
  return parent
}

/** Animate a number inside el. fmt(n) formats it. Always ends on the exact value. */
export function countUp(el, to, { dur = 700, fmt = (n) => String(Math.round(n)), from = 0 } = {}) {
  if (reduceMotion() || !Number.isFinite(to) || !Number.isFinite(from)) { el.textContent = fmt(to); return () => {} }
  const t0 = performance.now()
  let raf
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur)
    const e = 1 - Math.pow(1 - p, 3)
    el.textContent = fmt(from + (to - from) * e)
    if (p < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  const done = setTimeout(() => { cancelAnimationFrame(raf); el.textContent = fmt(to) }, dur + 80)
  const cancel = () => { cancelAnimationFrame(raf); clearTimeout(done) }
  onCleanup(cancel)
  return cancel
}

/** Animated progress ring. ring({value, max, size, stroke, color, label, fmt}) -> element with .update(value, label) */
export function ring({ value = 0, max = 100, size = 128, stroke = 11, color = 'var(--accent)', label = '', fmt = (v) => Math.round(v) }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  const mk = (cls) => {
    const el = document.createElementNS(NS, 'circle')
    el.setAttribute('cx', size / 2); el.setAttribute('cy', size / 2); el.setAttribute('r', r); el.setAttribute('fill', 'none'); el.setAttribute('stroke-width', stroke); el.setAttribute('class', cls)
    return el
  }
  const track = mk('track'), bar = mk('bar')
  bar.setAttribute('stroke', color); bar.setAttribute('stroke-dasharray', c); bar.setAttribute('stroke-dashoffset', c)
  svg.append(track, bar)
  const num = h('b', '0'), sub = h('span', label)
  const el = h('div', { class: 'stu-ring', style: { width: `${size}px`, height: `${size}px` }, role: 'img' }, svg, h('div', { class: 'mid' }, num, sub))
  let cur = 0, cancel = () => {}, M = max
  el.update = (v, lab) => {
    const f = Math.max(0, Math.min(1, M ? v / M : 0))
    requestAnimationFrame(() => requestAnimationFrame(() => bar.setAttribute('stroke-dashoffset', c * (1 - f))))
    if (reduceMotion()) bar.style.transition = 'none'
    cancel()
    cancel = countUp(num, v, { fmt, from: cur, dur: 600 })
    cur = v
    if (lab != null) sub.textContent = lab
    el.setAttribute('aria-label', `${fmt(v)} ${lab ?? label}`.trim())
  }
  el.setMax = (m) => { M = m }
  el.setColor = (col) => bar.setAttribute('stroke', col)
  el.update(value)
  return el
}

/** Confetti burst from an element (or the middle of the screen). No-op with reduced motion. */
export function confetti(from, { count = 90, colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#a855f7'] } = {}) {
  if (reduceMotion() || document.hidden) return
  const cv = h('canvas', { class: 'stu-confetti', 'aria-hidden': 'true' })
  const dpr = Math.min(2, devicePixelRatio || 1)
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr
  document.body.append(cv)
  const ctx = cv.getContext('2d')
  ctx.scale(dpr, dpr)
  const rect = from?.getBoundingClientRect?.()
  const ox = rect ? rect.left + rect.width / 2 : innerWidth / 2
  const oy = rect ? rect.top + rect.height / 2 : innerHeight / 3
  const ps = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2, s = 5 + Math.random() * 9
    return { x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 6, w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - .5) * .5, c: colors[(Math.random() * colors.length) | 0], life: 0 }
  })
  let raf, t0 = performance.now()
  const stop = () => { cancelAnimationFrame(raf); cv.remove() }
  const tick = (t) => {
    const dt = Math.min(2, (t - t0) / 16.67); t0 = t
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    let alive = 0
    for (const p of ps) {
      p.vy += .32 * dt; p.vx *= .99; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life += dt
      if (p.y < innerHeight + 20 && p.life < 130) alive++
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - p.life / 130); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore()
    }
    if (alive) raf = requestAnimationFrame(tick); else stop()
  }
  raf = requestAnimationFrame(tick)
  setTimeout(stop, 3500)
  onCleanup(stop)
}

/** Print a node in isolation (the rest of the page is hidden by CSS). Colours inside must be explicit, not theme variables. */
export function printNode(node, title) {
  ensureStyle()
  const wrap = h('div', { class: 'stu-print' }, node)
  document.body.append(wrap)
  const prev = document.title
  if (title) document.title = title
  let finished = false
  const done = () => {
    if (finished) return
    finished = true
    wrap.remove(); document.title = prev
    removeEventListener('afterprint', done)
  }
  addEventListener('afterprint', done)
  setTimeout(done, 180_000)
  setTimeout(() => { try { print() } catch { done() } }, 80)
  return done
}

/** Small hand-off between tools: put text in storage for another tool to pick up on mount. */
export function handoff(toolId, data) {
  save(`student:handoff:${toolId}`, data)
  location.hash = `#/${toolId}`
}
export function takeHandoff(toolId) {
  const v = load(`student:handoff:${toolId}`, null)
  if (v != null) remove(`student:handoff:${toolId}`)
  return v
}

/** Styled yes/no dialog: confirmModal({title, text, yes: 'Delete', danger: true}, () => ...) */
export function confirmModal({ title = 'Are you sure?', text = '', yes = 'Yes', danger = false }, onYes) {
  const m = modal({ title, body: h('div', text), actions: [
    button('Cancel', { variant: 'ghost', onClick: () => m.close() }),
    button(yes, { variant: danger ? 'danger' : 'primary', onClick: () => { m.close(); onYes() } })] })
  return m
}

/** Escape text for HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Wrap text in hidden-file download of text. */
export const uid = () => Math.random().toString(36).slice(2, 9)

/** Make an element accept dropped/pasted text files. */
export function acceptTextFiles(el, onText) {
  el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('stu-drop-hint') } })
  el.addEventListener('dragleave', () => el.classList.remove('stu-drop-hint'))
  el.addEventListener('drop', async (e) => {
    el.classList.remove('stu-drop-hint')
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    e.preventDefault()
    onText(await f.text(), f)
  })
}

/** Lines of text a person might paste, trimmed and without empties. */
export const lines = (t) => String(t || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)

/** Styled text prompt: askText({title, label, value, ok: 'Save'}, (text) => ...) */
export function askText({ title = 'Name', label = '', value = '', ok = 'Save', placeholder = '' }, onOk) {
  const inp = h('input', { class: 'input', type: 'text', value, placeholder, 'aria-label': label || title, maxlength: 80 })
  const go = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return } m.close(); onOk(v) }
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go() } })
  const m = modal({ title, body: h('div', { class: 'stack' }, label ? h('div', { class: 'small muted' }, label) : null, inp), actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button(ok, { variant: 'primary', onClick: go })] })
  setTimeout(() => { inp.focus(); inp.select() }, 60)
  return m
}
