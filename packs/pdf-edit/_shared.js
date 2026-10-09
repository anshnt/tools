// Shared building blocks for the pdf-edit pack: styles, the open-a-PDF workspace (with password prompt),
// page-range picker, floating action dock, animated result card and page geometry helpers.
// Files starting with "_" are never tool modules.
import { h, icon, dropzone, button, input, alert, clear, formatBytes, segmented, field, toast, downloadButton, onCleanup, errorMessage } from '../../lib/ui.js'
import { openPdf, loadPdfLib, thumbnail, parseRanges } from '../../lib/pdf.js'
import { pickFiles, suffixName } from '../../lib/files.js'
import { pdfLib } from '../../lib/libs.js'

// ---------- Styles ----------
const injected = new Set()
/** Inject a <style> once (id is unique per stylesheet). */
export function css(id, text) {
  if (injected.has(id) || document.getElementById(id)) return
  injected.add(id)
  document.head.append(h('style', { id }, text))
}

const BASE = `
@keyframes pe-pop { from { opacity: 0; transform: translateY(10px) scale(.96); } }
@keyframes pe-shimmer { to { background-position: -200% 0; } }
@keyframes pe-draw { to { stroke-dashoffset: 0; } }
@keyframes pe-ring { from { transform: scale(.4); opacity: 0; } 60% { opacity: .9; } to { transform: scale(1.7); opacity: 0; } }
@keyframes pe-burst { 0% { transform: translate(0, 0) scale(1); opacity: 1; } 100% { transform: translate(var(--x), var(--y)) scale(.3) rotate(var(--r)); opacity: 0; } }
@keyframes pe-float { 0%, 100% { transform: translateY(0) rotate(-5deg); } 50% { transform: translateY(-5px) rotate(-3deg); } }
.pe-ws { display: flex; flex-direction: column; gap: 16px; }
.pe-body { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.pe-filebar { display: flex; align-items: center; gap: 14px; padding: 10px 12px 10px 14px; border-radius: 20px; border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 84%, transparent); backdrop-filter: blur(12px); box-shadow: var(--shadow-sm); animation: pe-pop .5s var(--spring) both; }
.pe-cover { width: 40px; height: 52px; border-radius: 7px; flex: none; overflow: hidden; background: var(--surface-2); display: grid; place-items: center; color: var(--muted);
  box-shadow: 0 8px 16px -8px rgba(16, 16, 40, .5), 0 0 0 1px var(--border); transform: rotate(-5deg); transition: transform .45s var(--spring); }
.pe-cover canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
.pe-filebar:hover .pe-cover { transform: rotate(0) scale(1.06); }
.pe-filebar .pe-meta { flex: 1; min-width: 0; }
.pe-filebar .pe-name { font-weight: 600; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pe-filebar .pe-sub { font-size: 12.5px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; }
.pe-dot::before { content: "\\00b7"; margin-right: 6px; }
.pe-loading { display: flex; align-items: center; gap: 12px; padding: 22px; border-radius: 20px; border: 1px dashed var(--border-strong); color: var(--muted); animation: pe-pop .4s var(--ease) both; }
.pe-lock { display: grid; gap: 14px; padding: 22px; border-radius: 24px; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow); animation: pe-pop .5s var(--spring) both; max-width: 520px; }
.pe-lock .pe-lock-tile { width: 54px; height: 54px; border-radius: 17px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); animation: pe-float 4s ease-in-out infinite; }
.pe-lock .pe-lock-tile .icon { width: 26px; height: 26px; }
.pe-dock { position: sticky; bottom: calc(12px + var(--safe-b)); z-index: 25; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 10px 10px 18px; border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border)); background: color-mix(in srgb, var(--surface) 78%, transparent);
  backdrop-filter: blur(18px) saturate(160%); -webkit-backdrop-filter: blur(18px) saturate(160%); box-shadow: 0 22px 44px -20px rgba(16, 16, 40, .5), var(--shadow); animation: pe-pop .5s var(--spring) both; }
.pe-dock .pe-dock-info { flex: 1; min-width: 150px; font-size: 14px; color: var(--text-2); }
.pe-dock .pe-dock-info b { color: var(--text); font-variant-numeric: tabular-nums; }
.pe-dock .pe-dock-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.pe-sub-h { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); margin: 2px 0 -4px; }
.pe-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pe-chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 999px; font-size: 13px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); cursor: pointer; transition: all .2s var(--ease); }
.pe-chip:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.pe-chip[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.pe-pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 10px; }
.pe-opt { position: relative; display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 13px 14px; border-radius: 16px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer;
  transition: border-color .2s, background .2s, transform .25s var(--spring), box-shadow .2s; color: var(--text); font: inherit; min-height: 64px; }
.pe-opt:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow); }
.pe-opt[aria-pressed="true"] { border-color: var(--accent); background: linear-gradient(150deg, var(--accent-soft), var(--surface)); box-shadow: 0 0 0 3px var(--ring); }
.pe-opt b { font-size: 14px; display: flex; align-items: center; gap: 7px; }
.pe-opt b .icon { width: 16px; height: 16px; color: var(--accent); }
.pe-opt span { font-size: 12.5px; color: var(--muted); }
.pe-result { position: relative; overflow: hidden; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 22px; align-items: center; padding: 24px; border-radius: 26px;
  border: 1px solid color-mix(in srgb, var(--success) 30%, var(--border)); animation: pe-pop .6s var(--spring) both;
  background: radial-gradient(520px 240px at 0% 0%, color-mix(in srgb, var(--success) 13%, transparent), transparent 70%), radial-gradient(420px 220px at 100% 100%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%), var(--surface); }
.pe-paper { position: relative; width: 112px; aspect-ratio: 3 / 4; flex: none; }
.pe-paper > i, .pe-paper > .pe-paper-top { position: absolute; inset: 0; border-radius: 9px; background: var(--surface); border: 1px solid var(--border); box-shadow: 0 12px 24px -14px rgba(16, 16, 40, .55); }
.pe-paper > i:nth-child(1) { transform: rotate(-9deg) translate(-8px, 2px); background: var(--surface-2); }
.pe-paper > i:nth-child(2) { transform: rotate(6deg) translate(7px, 1px); }
.pe-paper > .pe-paper-top { overflow: hidden; transform: rotate(-1.5deg); display: grid; place-items: center; color: var(--muted); animation: pe-pop .7s .1s var(--spring) both; }
.pe-paper canvas { width: 100%; height: 100%; object-fit: cover; display: block; }
.pe-tick { position: absolute; right: -14px; bottom: -12px; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; z-index: 2; color: #fff;
  background: linear-gradient(140deg, #34d399, var(--success)); box-shadow: 0 10px 22px -8px var(--success); animation: pe-pop .5s .25s var(--spring) both; }
.pe-tick::before { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--success); animation: pe-ring .9s .3s ease-out both; }
.pe-tick svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 26; stroke-dashoffset: 26; animation: pe-draw .45s .45s ease-out forwards; }
.pe-result h3 { font-size: 21px; letter-spacing: -.03em; }
.pe-result .pe-lead { color: var(--muted); font-size: 14px; margin-top: 3px; overflow-wrap: anywhere; }
.pe-result .pe-facts { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
.pe-fact { padding: 8px 13px; border-radius: 14px; background: color-mix(in srgb, var(--surface) 80%, transparent); border: 1px solid var(--border); min-width: 84px; }
.pe-fact small { display: block; font-size: 11.5px; color: var(--muted); }
.pe-fact b { font-size: 17px; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.pe-fact.good b { color: var(--success); }
.pe-fact.bad b { color: var(--danger); }
.pe-burst { position: absolute; left: 56px; top: 50%; width: 0; height: 0; pointer-events: none; }
.pe-burst i { position: absolute; width: 8px; height: 8px; border-radius: 2px; background: hsl(var(--h) 85% 62%); animation: pe-burst .95s .3s cubic-bezier(.2, .8, .3, 1) both; }
.pe-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pe-note { font-size: 13px; color: var(--muted); margin-top: 12px; display: flex; gap: 8px; }
.pe-note .icon { width: 15px; height: 15px; margin-top: 2px; flex: none; }
.pe-pwd { display: flex; gap: 8px; }
.pe-pwd .input { flex: 1; }
.pe-meter { height: 6px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.pe-meter i { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--danger); transition: width .35s var(--ease), background .35s; }
@media (max-width: 560px) {
  .pe-result { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; padding: 20px 16px; }
  .pe-result .pe-facts, .pe-result .pe-actions { justify-content: center; }
  .pe-dock { padding: 10px; border-radius: 20px; }
  .pe-dock .pe-dock-info { flex-basis: 100%; text-align: center; }
  .pe-dock .pe-dock-actions { flex: 1; justify-content: stretch; }
  .pe-dock .pe-dock-actions .btn { flex: 1; }
}
@media (prefers-reduced-motion: reduce) { .pe-burst { display: none; } .pe-tick svg { stroke-dashoffset: 0; } }
`

export const ensureStyles = () => css('pe-base', BASE)

// ---------- Small helpers ----------
export const PDF_ACCEPT = '.pdf,application/pdf'
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
export const outName = (file, suffix) => suffixName(file.name, suffix, 'pdf')
/** Hex color '#rrggbb' -> {r,g,b} in 0..1 */
export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  const n = m ? parseInt(m[1], 16) : 0
  return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255 }
}
/** Panel heading with a small leading icon. */
export const heading = (ic, text) => h('h2', h('span', { style: 'display:flex;align-items:center;gap:8px' }, icon(ic), text))
/** Free a pdf.js document (v6 documents have no destroy(); the loading task owns the worker memory). */
export const destroyPdf = (pdf) => { try { const t = pdf?.loadingTask || pdf; t?.destroy?.()?.catch?.(() => {}) } catch { /* already gone */ } }
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ---------- Open-a-PDF workspace ----------
/** Open a File as a PDF source: pdf.js doc for reading plus edit() for a fresh decrypted pdf-lib doc. Throws code 'PASSWORD'. */
export async function openSource(file, password) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await openPdf(bytes, { password })
  return {
    file, name: file.name, size: file.size, bytes, password, pdf, numPages: pdf.numPages,
    /** fresh pdf-lib document (metadata left untouched unless you pass updateMetadata: true) */
    edit: (o) => loadPdfLib(bytes, { password, updateMetadata: false, ...o }),
    _disposers: [],
    /** run fn when the file is replaced or the tool is left */
    dispose(fn) { this._disposers.push(fn) },
  }
}

/**
 * The standard single-PDF flow: dropzone -> (password prompt) -> file bar + your UI.
 * pdfWorkspace(root, { label, hint, onLoad(src, ws) -> Node | Node[] | void })
 * ws: { reset(), body, src }.  src: see openSource().
 */
export function pdfWorkspace(root, opts) {
  ensureStyles()
  const { label = 'Drop a PDF here or click to choose', hint, onLoad, accept = PDF_ACCEPT, icon: ic = 'file-text' } = opts
  const host = h('div', { class: 'pe-ws' })
  const slot = h('div', { class: 'pe-body' })
  let zone, current, token = 0
  const ws = { body: slot, src: null, reset: () => show(), load: (f) => load(f) }

  const disposeCurrent = () => {
    if (!current) return
    for (const fn of current._disposers.splice(0)) { try { fn() } catch (e) { console.error(e) } }
    destroyPdf(current.pdf)
    current = null
    ws.src = null
  }
  onCleanup(disposeCurrent)

  function show() {
    token++
    disposeCurrent()
    zone = dropzone({ accept, label, hint, icon: ic, onFiles: ([f]) => load(f) })
    clear(host, zone)
  }

  async function load(file, password) {
    const mine = ++token
    disposeCurrent()
    clear(host, h('div', { class: 'pe-loading', role: 'status' }, h('span', { class: 'spinner' }), h('span', `Reading ${file.name}...`)))
    let src
    try {
      src = await openSource(file, password)
    } catch (err) {
      if (mine !== token) return
      if (err.code === 'PASSWORD') return askPassword(file, !!password)
      clear(host, alert('error', h('strong', 'Could not open that file. '), errorMessage(err)),
        button('Choose another file', { icon: 'upload', variant: 'secondary', onClick: show }))
      return
    }
    if (mine !== token) { destroyPdf(src.pdf); return }
    current = src
    ws.src = src
    clear(slot)
    clear(host, fileBar(src), slot)
    try {
      const ui = await onLoad(src, ws)
      if (mine !== token) return
      if (ui) slot.append(...[ui].flat(Infinity).filter(Boolean))
    } catch (err) {
      console.error(err)
      if (mine !== token) return
      clear(slot, alert('error', h('strong', 'Something went wrong. '), errorMessage(err)))
    }
  }

  function askPassword(file, wrong) {
    const pw = input({ type: 'password', placeholder: 'PDF password', autocomplete: 'off', 'aria-label': 'PDF password' })
    const go = () => pw.value && load(file, pw.value)
    pw.addEventListener('keydown', (e) => e.key === 'Enter' && go())
    clear(host, h('div', { class: 'pe-lock' },
      h('div', { class: 'pe-lock-tile' }, icon('lock')),
      h('div', h('h3', 'This PDF is password-protected'), h('p', { class: 'muted small', style: 'margin-top:4px' }, `${file.name} needs its password to open. The password stays in your browser.`)),
      wrong ? alert('error', 'That password did not work. Try again.') : null,
      h('div', { class: 'pe-pwd' }, pw, button('Unlock', { icon: 'lock-open', variant: 'primary', onClick: go })),
      h('div', { class: 'row' }, button('Choose another file', { variant: 'ghost', size: 'sm', onClick: show }))))
    pw.focus()
  }

  function fileBar(src) {
    const cover = h('div', { class: 'pe-cover' }, icon('file-text'))
    thumbnail(src.pdf, 1, 120).then((c) => { if (src === current) clear(cover, c) }).catch(() => {})
    return h('div', { class: 'pe-filebar' }, cover,
      h('div', { class: 'pe-meta' }, h('div', { class: 'pe-name', title: src.name }, src.name),
        h('div', { class: 'pe-sub' }, h('span', plural(src.numPages, 'page')), h('span', { class: 'pe-dot' }, formatBytes(src.size)), src.password ? h('span', { class: 'pe-dot' }, 'unlocked') : null)),
      button('Change', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', onClick: async () => { const [f] = await pickFiles({ accept }); if (f) load(f) } }),
      button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Close this file', onClick: show }))
  }

  root.append(host)
  show()
  return ws
}

// ---------- Page range picker ----------
/**
 * pageRange(total, {label, onChange}) -> element; el.pages() returns sorted 1-based page numbers (throws a readable Error),
 * el.error() returns '' or the message, el.mode(), el.setTotal(n).
 */
export function pageRange(total, { label = 'Pages', modes = ['all', 'odd', 'even', 'custom'], onChange, value = 'all' } = {}) {
  let n = total
  const names = { all: 'All', odd: 'Odd', even: 'Even', custom: 'Custom', first: 'First', rest: 'All but first' }
  const text = input({ placeholder: 'e.g. 1-3, 5, 8-', 'aria-label': 'Custom page range', oninput: () => fire() })
  const seg = segmented(modes.map((m) => [m, names[m]]), value, () => fire(), label)
  const msg = h('small', { class: 'field-hint' })
  const el = field(label, h('div', { class: 'stack tight' }, seg, h('div', { hidden: value !== 'custom' }, text), msg))
  const wrap = text.parentElement
  function render() {
    wrap.hidden = seg.value !== 'custom'
    msg.textContent = el.error()
    if (!msg.textContent && seg.value !== 'all') { try { msg.textContent = `${plural(el.pages().length, 'page')} selected` } catch { /* shown as error */ } }
  }
  function fire() { render(); onChange?.(el) }
  el.pages = () => {
    const all = Array.from({ length: n }, (_, i) => i + 1)
    switch (seg.value) {
      case 'odd': return all.filter((p) => p % 2)
      case 'even': return all.filter((p) => !(p % 2))
      case 'first': return all.slice(0, 1)
      case 'rest': return all.slice(1)
      case 'custom': {
        if (!text.value.trim()) throw new Error('Type the pages to use, for example 1-3, 5.')
        return parseRanges(text.value, n)
      }
      default: return all
    }
  }
  el.error = () => { try { const p = el.pages(); return p.length ? '' : 'No pages match that choice.' } catch (e) { return seg.value === 'custom' && !text.value.trim() ? '' : e.message } }
  el.mode = () => seg.value
  el.setTotal = (t) => { n = t; fire() }
  el.set = (mode, custom = '') => { seg.set(mode); text.value = custom; fire() }
  render()
  return el
}

// ---------- Dock (floating action bar) ----------
/** dock({text, actions}) -> el with .text(nodeOrString) ; sticks to the bottom of the viewport while its tool is on screen. */
export function dock({ text = '', actions = [] } = {}) {
  ensureStyles()
  const info = h('div', { class: 'pe-dock-info', 'aria-live': 'polite' }, text)
  const el = h('div', { class: 'pe-dock' }, info, h('div', { class: 'pe-dock-actions' }, actions))
  el.text = (t) => clear(info, t)
  return el
}

/** Option cards: pick(options: [{value, label, hint, icon}], value, onChange) -> el with .value / .set(v). */
export function pick(options, value, onChange) {
  ensureStyles()
  const el = h('div', { class: 'pe-pick', role: 'group' })
  el.value = value
  const btns = options.map((o) => h('button', { type: 'button', class: 'pe-opt', 'aria-pressed': String(o.value === value), onclick: () => { el.set(o.value); onChange?.(o.value) } },
    h('b', o.icon ? icon(o.icon) : null, o.label), o.hint ? h('span', o.hint) : null))
  el.append(...btns)
  el.set = (v) => { el.value = v; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === v))) }
  return el
}

// ---------- Result card ----------
const CHECK = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = '<path d="M5 12.5l4.5 4.5L19 7.5"/>'; return s }

/**
 * Animated success card with a first-page preview of the result.
 * showResult(target, {blob, name, title, lead, facts: [{label, value, tone: 'good'|'bad'}], note, actions: [Node], extra: Node, again})
 */
export async function showResult(target, { blob, name, title = 'Your PDF is ready', lead, facts = [], note, actions = [], extra, again, password, button: label = 'Download' }) {
  ensureStyles()
  const isPdf = blob.type === 'application/pdf' || /\.pdf$/i.test(name)
  const top = h('div', { class: 'pe-paper-top' }, icon(isPdf ? 'file-text' : 'file-archive'))
  const burst = h('div', { class: 'pe-burst', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4, d = 60 + Math.random() * 70
    return h('i', { style: { '--x': `${Math.cos(a) * d}px`, '--y': `${Math.sin(a) * d}px`, '--r': `${Math.random() * 360}deg`, '--h': `${Math.round(Math.random() * 360)}` } })
  }))
  const card = h('div', { class: 'pe-result', role: 'status' }, burst,
    h('div', { class: 'pe-paper' }, h('i'), h('i'), top, h('div', { class: 'pe-tick' }, CHECK())),
    h('div', { style: 'min-width:0' },
      h('h3', title), lead ? h('div', { class: 'pe-lead' }, lead) : null,
      facts.length ? h('div', { class: 'pe-facts' }, facts.map((f) => h('div', { class: ['pe-fact', f.tone] }, h('small', f.label), h('b', f.value)))) : null,
      h('div', { class: 'pe-actions' }, downloadButton(blob, name, `${label} (${formatBytes(blob.size)})`, { size: 'lg' }), ...actions,
        again ? button('Start over', { icon: 'rotate-ccw', variant: 'ghost', onClick: again }) : null),
      extra || null,
      note ? h('div', { class: 'pe-note' }, icon('info'), h('span', note)) : null))
  clear(target, card)
  card.scrollIntoView?.({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' })
  if (isPdf) {
    try {
      const pdf = await openPdf(blob, { password })
      const c = await thumbnail(pdf, 1, 260)
      if (top.isConnected) clear(top, c)
      destroyPdf(pdf)
    } catch { /* keep the icon */ }
  }
  return card
}

// ---------- Page geometry (rotation aware) ----------
/**
 * Describe a pdf-lib page as the viewer shows it (rotation applied, crop box respected).
 * g.width / g.height: displayed size in points; g.toPdf(u, v): displayed point (origin top-left, y down) -> [x, y] in page space.
 */
export function pageGeom(page) {
  const rot = (((page.getRotation().angle % 360) + 360) % 360)
  const box = page.getCropBox()
  const W = box.width, H = box.height
  const m = {
    0: (u, v) => [box.x + u, box.y + H - v],
    90: (u, v) => [box.x + v, box.y + u],
    180: (u, v) => [box.x + W - u, box.y + v],
    270: (u, v) => [box.x + W - v, box.y + H - u],
  }[rot] || ((u, v) => [box.x + u, box.y + H - v])
  return { rot, box, width: rot % 180 ? H : W, height: rot % 180 ? W : H, toPdf: m }
}

/**
 * Where to draw something so it appears at a displayed rectangle: top-left (u, v), size (w, h) in displayed points,
 * rotated by `angle` degrees counter-clockwise about its centre. Returns {x, y, rotate} for pdf-lib's drawImage/drawText (rotate in degrees).
 */
export function placeRect(g, u, v, w, h, angle = 0) {
  const cx = u + w / 2, cy = v + h / 2, a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  const lx = -w / 2 * c + h / 2 * s, ly = -w / 2 * s - h / 2 * c
  const [x, y] = g.toPdf(cx + lx, cy - ly)
  return { x, y, rotate: g.rot + angle }
}

/** [1,2,3,5,7,8] -> "1-3, 5, 7-8" */
export function formatRanges(pages) {
  const out = []
  const list = [...pages].sort((a, b) => a - b)
  for (let i = 0; i < list.length; i++) {
    let j = i
    while (list[j + 1] === list[j] + 1) j++
    out.push(j > i ? `${list[i]}-${list[j]}` : `${list[i]}`)
    i = j
  }
  return out.join(', ')
}

/** Carry the document info (title, author ...) from one pdf-lib doc to another. */
export function copyInfo(from, to) {
  try {
    const t = from.getTitle(), a = from.getAuthor(), s = from.getSubject(), k = from.getKeywords(), c = from.getCreator(), d = from.getCreationDate()
    if (t) to.setTitle(t)
    if (a) to.setAuthor(a)
    if (s) to.setSubject(s)
    if (k) to.setKeywords(k.split(/\s*[,;]\s*/).filter(Boolean))
    if (c) to.setCreator(c)
    if (d) to.setCreationDate(d)
    to.setProducer('Tools (in your browser)')
    to.setModificationDate(new Date())
  } catch { /* info is a nicety */ }
}

/**
 * Build a new PDF from a plan of pages. plan: [{index (0-based page of base), rot (extra degrees), doc? (another pdf-lib doc)}].
 * Only objects the chosen pages use are copied, so deleting or extracting pages really shrinks the file.
 */
export async function buildPages(base, plan, onProgress) {
  const { PDFDocument, degrees } = await pdfLib()
  const out = await PDFDocument.create()
  let i = 0
  while (i < plan.length) {
    const doc = plan[i].doc || base
    let j = i
    while (j < plan.length && (plan[j].doc || base) === doc) j++
    const pages = await out.copyPages(doc, plan.slice(i, j).map((p) => p.index))
    pages.forEach((pg, k) => {
      const rot = plan[i + k].rot || 0
      if (rot) pg.setRotation(degrees((((pg.getRotation().angle + rot) % 360) + 360) % 360))
      out.addPage(pg)
    })
    i = j
    onProgress?.(i / plan.length)
    await new Promise((r) => setTimeout(r, 0))
  }
  copyInfo(base, out)
  return out
}

/**
 * Put a pdf-lib document's pages into a new order in place (keeps forms, bookmarks and metadata).
 * pages: PDFPage[] in the wanted order (duplicates must be real copies, see PDFDocument.copyPages).
 * The page tree is rebuilt flat, so inherited attributes are copied onto each page first.
 */
export async function setPageOrder(doc, pages) {
  const { PDFName, PDFNumber } = await pdfLib()
  const root = doc.catalog.Pages()
  const rootRef = doc.catalog.get(PDFName.of('Pages'))
  for (const pg of pages) {
    for (const key of ['MediaBox', 'CropBox', 'Resources', 'Rotate']) {
      const n = PDFName.of(key)
      if (!pg.node.has(n)) { const v = pg.node.getInheritableAttribute(n); if (v) pg.node.set(n, v) }
    }
    pg.node.set(PDFName.of('Parent'), rootRef)
  }
  root.set(PDFName.of('Kids'), doc.context.obj(pages.map((p) => p.ref)))
  root.set(PDFName.of('Count'), PDFNumber.of(pages.length))
}

export { toast }
