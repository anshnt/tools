// Shared UI for the pdf-convert pack: a "convert studio" look (format flow header, numbered steps, PDF file card,
// page picker with thumbnails, celebratory result card). Everything is built on lib/ui.js and the site's CSS variables.
import { h, icon, button, dropzone, alert, input, toast, clear, onCleanup, formatBytes, yieldToMain, formatDuration, modal, download } from '../../lib/ui.js'
import { openPdf, thumbnail, parseRanges } from '../../lib/pdf.js'

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** Format badge colors: [label, color]. */
export const FMT = {
  pdf: ['PDF', '#e5484d'], docx: ['DOCX', '#2b6cdf'], xlsx: ['XLSX', '#1f9d55'], csv: ['CSV', '#16a34a'], pptx: ['PPTX', '#e8710a'],
  jpg: ['JPG', '#a855f7'], png: ['PNG', '#0ea5e9'], img: ['IMG', '#a855f7'], txt: ['TXT', '#64748b'], md: ['MD', '#6366f1'],
  html: ['HTML', '#e34f26'], zip: ['ZIP', '#ca8a04'], ocr: ['OCR', '#0d9488'], diff: ['DIFF', '#ec4899'], doc: ['DOC', '#2b6cdf'],
}

const CSS = `
.cv { display: flex; flex-direction: column; gap: 18px; }
.cv-flow { --fa: #e5484d; --fb: #2b6cdf; position: relative; display: flex; align-items: center; justify-content: center; gap: clamp(8px, 3vw, 26px); padding: 20px 14px; border-radius: var(--radius-xl); overflow: hidden; border: 1px solid var(--border);
  background: radial-gradient(110% 150% at 0% 0%, color-mix(in srgb, var(--fa) 15%, transparent), transparent 60%), radial-gradient(110% 150% at 100% 100%, color-mix(in srgb, var(--fb) 17%, transparent), transparent 60%), var(--surface); }
.cv-flow::before { content: ""; position: absolute; inset: 0; background-image: radial-gradient(color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1.5px); background-size: 18px 18px; mask-image: linear-gradient(90deg, #000, transparent 30%, transparent 70%, #000); opacity: .7; pointer-events: none; }
.cv-doc { position: relative; flex: none; width: 60px; height: 76px; border-radius: 11px 17px 11px 11px; background: var(--surface); border: 1.5px solid color-mix(in srgb, var(--fc) 42%, var(--border)); overflow: hidden;
  box-shadow: 0 16px 28px -16px color-mix(in srgb, var(--fc) 75%, transparent), var(--shadow-sm); display: flex; flex-direction: column; justify-content: space-between; padding: 15px 9px 9px; transition: transform .6s var(--spring); }
.cv-doc::before { content: ""; position: absolute; top: 0; right: 0; width: 19px; height: 19px; background: linear-gradient(225deg, var(--bg-2) 50%, color-mix(in srgb, var(--fc) 28%, var(--surface)) 50%); border-bottom-left-radius: 7px; }
.cv-doc > span i { display: block; height: 4px; border-radius: 3px; background: color-mix(in srgb, var(--fc) 24%, var(--surface-3)); margin-bottom: 5px; }
.cv-doc > span i:nth-child(2) { width: 78%; } .cv-doc > span i:nth-child(3) { width: 55%; }
.cv-doc b { align-self: flex-start; font: 700 11px/1 var(--mono); letter-spacing: .04em; color: #fff; background: var(--fc); padding: 4px 6px; border-radius: 6px; }
.cv-doc.from { transform: rotate(-5deg); } .cv-doc.to { transform: rotate(5deg); }
.cv-flow:hover .cv-doc.from { transform: rotate(-8deg) translateX(-3px); } .cv-flow:hover .cv-doc.to { transform: rotate(8deg) translateX(3px); }
.cv-tick { position: absolute; right: 5px; bottom: 5px; width: 22px; height: 22px; border-radius: 50%; background: var(--success); color: #fff; display: grid; place-items: center; transform: scale(0); transition: transform .5s var(--spring); }
.cv-tick .icon { width: 13px; height: 13px; stroke-width: 3; }
.cv-flow[data-state="done"] .cv-tick { transform: scale(1); } .cv-flow[data-state="done"] .cv-doc.to { transform: rotate(0) scale(1.1); }
.cv-flow[data-state="working"] .cv-doc.from { animation: cv-wob .9s ease-in-out infinite; } .cv-flow[data-state="working"] .cv-doc.to { animation: cv-wob .9s .45s ease-in-out infinite; }
@keyframes cv-wob { 50% { transform: translateY(-6px) rotate(0); } }
.cv-link { position: relative; flex: 1; max-width: 190px; height: 6px; border-radius: 99px; overflow: hidden; background: repeating-linear-gradient(90deg, var(--border-strong) 0 6px, transparent 6px 13px); opacity: .9; }
.cv-link::after { content: ""; position: absolute; top: 0; bottom: 0; width: 46px; border-radius: 99px; background: linear-gradient(90deg, transparent, var(--fa), var(--fb), transparent); animation: cv-run 3.4s linear infinite; }
.cv-flow[data-state="working"] .cv-link::after { animation-duration: .8s; width: 70px; } .cv-flow[data-state="done"] .cv-link::after { animation: none; left: 0; right: 0; width: auto; background: linear-gradient(90deg, var(--fa), var(--fb)); }
@keyframes cv-run { from { left: -60px; } to { left: 100%; } }
.cv-flow-cap { position: absolute; left: 14px; bottom: 9px; font-size: 11.5px; color: var(--muted); letter-spacing: .02em; }
.cv-step { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 4px 14px; transition: opacity .4s, filter .4s; }
.cv-step[data-locked="true"] { opacity: .42; filter: saturate(.5); pointer-events: none; user-select: none; }
.cv-step-n { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font: 650 14px/1 var(--mono); color: var(--accent-text); background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 8px 18px -8px var(--accent); transition: transform .5s var(--spring); }
.cv-step[data-locked="true"] .cv-step-n { background: var(--surface-3); color: var(--muted); box-shadow: none; } .cv-step:not([data-locked="true"]) .cv-step-n.pop { animation: cv-pop .6s var(--spring); }
.cv-step-h { display: flex; align-items: center; min-height: 34px; font-weight: 620; letter-spacing: -.015em; font-size: 16px; gap: 10px; flex-wrap: wrap; }
.cv-step-h small { font-weight: 450; color: var(--muted); font-size: 13px; letter-spacing: 0; }
.cv-step-body { grid-column: 2; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
@keyframes cv-pop { 0% { transform: scale(.5); } 60% { transform: scale(1.18); } 100% { transform: scale(1); } }
.cv-file { display: flex; align-items: center; gap: 16px; padding: 16px; border-radius: var(--radius-lg); border: 1px solid var(--border); background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 7%, var(--surface)), var(--surface)); box-shadow: var(--shadow-sm); animation: rise .45s var(--ease) both; position: relative; }
.cv-file.drag { border-color: var(--accent); box-shadow: 0 0 0 4px var(--ring); }
.cv-thumb { position: relative; flex: none; width: 74px; min-height: 96px; display: grid; place-items: center; }
.cv-thumb canvas, .cv-thumb .cv-ph { position: relative; z-index: 2; display: block; width: 74px; height: auto; max-height: 104px; object-fit: cover; border-radius: 5px; background: #fff; box-shadow: 0 10px 22px -10px rgba(0, 0, 0, .45); transform: rotate(-2deg); }
.cv-thumb .cv-ph { height: 96px; display: grid; place-items: center; color: var(--muted); }
.cv-thumb::before, .cv-thumb::after { content: ""; position: absolute; inset: 6px 4px 4px 6px; border-radius: 5px; background: var(--surface); border: 1px solid var(--border-strong); z-index: 1; transform: rotate(4deg) translate(5px, 2px); }
.cv-thumb::after { z-index: 0; transform: rotate(9deg) translate(10px, 3px); opacity: .7; }
.cv-file-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.cv-file-name { font-weight: 620; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cv-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 3px 9px; border-radius: 99px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); white-space: nowrap; }
.cv-chip .icon { width: 12px; height: 12px; } .cv-chip.good { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 25%, transparent); }
.cv-chip.warn { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 28%, transparent); }
.cv-file-actions { display: flex; gap: 4px; flex: none; }
.cv-pw { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; padding: 16px; border-radius: var(--radius-lg); border: 1px solid color-mix(in srgb, var(--warning) 30%, var(--border)); background: var(--warning-soft); animation: rise .35s var(--ease) both; }
.cv-pw .field { flex: 1; min-width: 180px; }
.cv-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 16px 18px; align-items: start; }
.cv-opts.wide { grid-template-columns: minmax(0, 1fr); }
.cv-sub { font-size: 12.5px; color: var(--muted); }
.cv-pick { display: flex; flex-direction: column; gap: 12px; }
.cv-pick-bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.cv-pick-bar .input { flex: 1 1 160px; min-width: 0; max-width: 280px; }
.cv-pick-count { font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; margin-left: auto; white-space: nowrap; }
.cv-pill { border: 1px solid var(--border); background: var(--surface); color: var(--text-2); font-size: 12.5px; min-height: 32px; padding: 0 12px; border-radius: 99px; cursor: pointer; transition: background .2s, border-color .2s, transform .15s; }
.cv-pill:hover { background: var(--surface-2); border-color: var(--border-strong); } .cv-pill:active { transform: scale(.95); }
.cv-pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px; max-height: 420px; overflow: auto; padding: 4px; margin: -4px; }
.cv-page { position: relative; border: 2px solid transparent; border-radius: 10px; padding: 0; background: transparent; cursor: pointer; display: flex; flex-direction: column; gap: 5px; align-items: center; font: inherit; color: var(--muted); font-size: 11.5px; }
.cv-page .cv-pg-box { position: relative; width: 100%; border-radius: 6px; overflow: hidden; background: #fff; box-shadow: 0 6px 14px -8px rgba(0, 0, 0, .4), 0 0 0 1px var(--border); transition: transform .3s var(--spring), box-shadow .25s, opacity .25s, filter .25s; }
.cv-page canvas { display: block; width: 100%; height: 100%; } .cv-page .cv-pg-box.loading { background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%) 0 0 / 200% 100%; animation: shimmer 1.4s linear infinite; }
.cv-page:hover .cv-pg-box { transform: translateY(-3px); }
.cv-page[aria-pressed="false"] .cv-pg-box { opacity: .38; filter: grayscale(.8); }
.cv-page[aria-pressed="true"] { color: var(--accent); font-weight: 600; } .cv-page[aria-pressed="true"] .cv-pg-box { box-shadow: 0 10px 20px -10px var(--accent), 0 0 0 2px var(--accent); }
.cv-page .cv-ck { position: absolute; top: 5px; right: 5px; width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: var(--accent-text); display: grid; place-items: center; transform: scale(0); transition: transform .35s var(--spring); z-index: 2; }
.cv-page[aria-pressed="true"] .cv-ck { transform: scale(1); } .cv-ck .icon { width: 12px; height: 12px; stroke-width: 3; }
.cv-page:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.cv-done { position: relative; overflow: hidden; display: flex; gap: 18px; align-items: center; flex-wrap: wrap; padding: 20px; border-radius: var(--radius-lg); border: 1px solid color-mix(in srgb, var(--success) 30%, var(--border)); background: linear-gradient(135deg, var(--success-soft), var(--surface) 70%); animation: rise .45s var(--ease) both; }
.cv-ring { flex: none; width: 56px; height: 56px; }
.cv-ring circle { fill: var(--success); opacity: .14; } .cv-ring .arc { fill: none; stroke: var(--success); stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 160; stroke-dashoffset: 160; animation: cv-draw .7s .1s var(--ease) forwards; opacity: 1; }
.cv-ring path { fill: none; stroke: var(--success); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 40; stroke-dashoffset: 40; animation: cv-draw .45s .5s var(--ease) forwards; }
@keyframes cv-draw { to { stroke-dashoffset: 0; } }
.cv-done-text { flex: 1 1 220px; min-width: 0; } .cv-done-text h3 { font-size: 18px; letter-spacing: -.02em; } .cv-done-text p { color: var(--text-2); font-size: 14px; margin-top: 3px; overflow-wrap: anywhere; }
.cv-done-actions { display: flex; gap: 8px; flex-wrap: wrap; width: 100%; } .cv-done .cv-chips { margin-top: 8px; }
.cv-fx { position: absolute; left: 30px; top: 40px; width: 8px; height: 8px; border-radius: 2px; pointer-events: none; animation: cv-burst .9s var(--ease) forwards; }
@keyframes cv-burst { from { transform: translate(0, 0) rotate(0) scale(1); opacity: 1; } to { transform: translate(var(--dx), var(--dy)) rotate(var(--r)) scale(.4); opacity: 0; } }
.cv-pane { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; min-width: 0; }
.cv-pane-h { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--surface-2); font-size: 13px; font-weight: 600; flex-wrap: wrap; }
.cv-pane-h .grow { flex: 1; min-width: 0; }
.cv-gal { columns: 170px; column-gap: 12px; }
.cv-gal-item { position: relative; break-inside: avoid; margin: 0 0 12px; border-radius: 13px; overflow: hidden; border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow-sm); transition: transform .35s var(--spring), box-shadow .3s; animation: rise .5s var(--ease) both; animation-delay: calc(min(var(--i, 0), 12) * 45ms); }
.cv-gal-item:hover { transform: translateY(-4px) rotate(-.4deg); box-shadow: var(--shadow); }
.cv-gal-item > button.cv-gal-open { display: block; width: 100%; padding: 0; border: 0; background: var(--checker); cursor: zoom-in; }
.cv-gal-item img { display: block; width: 100%; height: auto; }
.cv-gal-cap { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 8px 7px 11px; font-size: 12px; color: var(--muted); min-width: 0; }
.cv-gal-cap span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.cv-ba { position: relative; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); background: var(--checker); touch-action: pan-y; user-select: none; display: grid; --p: 50%; }
.cv-ba > canvas, .cv-ba > img { grid-area: 1 / 1; display: block; width: 100%; height: auto; max-height: 560px; object-fit: contain; margin: 0 auto; }
.cv-ba > .after { clip-path: inset(0 0 0 var(--p)); }
.cv-ba-line { position: absolute; top: 0; bottom: 0; left: var(--p); width: 3px; margin-left: -1.5px; background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .25), 0 0 14px rgba(0, 0, 0, .35); pointer-events: none; }
.cv-ba-line::after { content: "↔"; position: absolute; top: 50%; left: 50%; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: #fff; color: #333; display: grid; place-items: center; font-size: 17px; box-shadow: 0 4px 14px rgba(0, 0, 0, .4); }
.cv-ba input[type="range"] { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: ew-resize; margin: 0; }
.cv-ba-tag { position: absolute; top: 10px; padding: 3px 9px; border-radius: 99px; font-size: 11.5px; font-weight: 600; background: rgba(0, 0, 0, .6); color: #fff; pointer-events: none; }
.cv-ba-tag.l { left: 10px; } .cv-ba-tag.r { right: 10px; }
.cv-note { font-size: 12.5px; color: var(--muted); display: flex; gap: 6px; align-items: flex-start; } .cv-note .icon { width: 14px; height: 14px; margin-top: 2px; flex: none; }
@media (max-width: 720px) {
  .cv-doc { width: 50px; height: 64px; padding: 12px 7px 7px; } .cv-doc b { font-size: 10px; padding: 3px 5px; }
  .cv-step { grid-template-columns: 28px minmax(0, 1fr); gap: 4px 10px; } .cv-step-n { width: 28px; height: 28px; font-size: 12.5px; } .cv-step-h { min-height: 28px; font-size: 15px; }
  .cv-file { flex-wrap: wrap; padding: 13px; gap: 12px; } .cv-thumb { width: 58px; min-height: 76px; } .cv-thumb canvas, .cv-thumb .cv-ph { width: 58px; }
  .cv-file-actions { width: 100%; justify-content: flex-end; }
  .cv-pages { grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px; }
  .cv-done { padding: 15px; } .cv-pick-count { margin-left: 0; width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .cv-link::after, .cv-doc, .cv-fx { animation: none !important; } .cv-ring .arc, .cv-ring path { animation: none !important; stroke-dashoffset: 0; } }
`

let styled = false
/** Inject the pack stylesheet once. Call from mount(). */
export function useStyles(extra) {
  if (!styled || !document.getElementById('cv-style')) {
    document.head.append(h('style', { id: 'cv-style' }, CSS))
    styled = true
  }
  if (extra) {
    const id = `cv-style-${extra.id}`
    if (!document.getElementById(id)) document.head.append(h('style', { id }, extra.css))
  }
}

// ---------------------------------------------------------------- flow header

const docBadge = (fmt, side) => {
  const [label, color] = FMT[fmt] || [String(fmt).toUpperCase().slice(0, 5), '#64748b']
  return h('div', { class: ['cv-doc', side], style: { '--fc': color } }, h('span', h('i'), h('i'), h('i')), h('b', label), side === 'to' && h('i', { class: 'cv-tick' }, icon('check')))
}

/** flow('pdf', 'docx') -> element with .state('idle' | 'working' | 'done') and .setTo(fmt). Animated "from -> to" banner shown at the top of every tool. */
export function flow(from, to, caption) {
  const colorOf = (f) => (FMT[f] || ['', '#64748b'])[1]
  const labelOf = (f) => (FMT[f] || [String(f).toUpperCase()])[0]
  let fromEl = docBadge(from, 'from'), toEl = docBadge(to, 'to')
  const el = h('div', { class: 'cv-flow', 'data-state': 'idle', style: { '--fa': colorOf(from), '--fb': colorOf(to) }, role: 'img', 'aria-label': `${labelOf(from)} to ${labelOf(to)}` },
    fromEl, h('div', { class: 'cv-link', 'aria-hidden': 'true' }), toEl, caption && h('span', { class: 'cv-flow-cap' }, caption))
  el.state = (s) => el.setAttribute('data-state', s)
  const swap = (side, fmt) => {
    const next = docBadge(fmt, side)
    const old = side === 'to' ? toEl : fromEl
    old.replaceWith(next)
    if (side === 'to') { toEl = next; el.style.setProperty('--fb', colorOf(fmt)) } else { fromEl = next; el.style.setProperty('--fa', colorOf(fmt)) }
    el.setAttribute('aria-label', `${labelOf(side === 'from' ? fmt : from)} to ${labelOf(side === 'to' ? fmt : to)}`)
    if (side === 'from') from = fmt; else to = fmt
  }
  el.setTo = (fmt) => swap('to', fmt)
  el.setFrom = (fmt) => swap('from', fmt)
  return el
}

// ---------------------------------------------------------------- numbered steps

/** step(1, 'Choose a PDF', [content], {locked, hint}) -> element with .unlock() / .lock() */
export function step(n, title, content, { locked = false, hint } = {}) {
  const num = h('span', { class: 'cv-step-n' }, n)
  const el = h('section', { class: 'cv-step', 'data-locked': String(locked) },
    num, h('div', { class: 'cv-step-h' }, title, hint && h('small', hint)), h('div', { class: 'cv-step-body' }, content))
  el.unlock = () => {
    if (el.getAttribute('data-locked') === 'false') return
    el.setAttribute('data-locked', 'false')
    num.classList.remove('pop'); void num.offsetWidth; num.classList.add('pop')
  }
  el.lock = () => el.setAttribute('data-locked', 'true')
  return el
}

/** Grid of option controls: options(field1, field2, ...) */
export const options = (...kids) => h('div', { class: 'cv-opts' }, kids)

export const chip = (text, kind, ic) => h('span', { class: ['cv-chip', kind] }, ic && icon(ic), text)
export const note = (text, ic = 'info') => h('div', { class: 'cv-note' }, icon(ic), h('span', text))

// ---------------------------------------------------------------- PDF source

/**
 * pdfSource({ onLoad(api), onClear(), label, hint }) -> api
 * api.el          element (dropzone, then a file card with page-1 thumbnail)
 * api.file / api.doc (pdf.js) / api.numPages / api.password / api.hasText (null until known) / api.bytes()
 * Handles password-protected PDFs with an inline prompt. Replaces and destroys the previous document.
 */
export function pdfSource({ onLoad, onClear, label, hint } = {}) {
  const host = h('div', { class: 'stack' })
  const zone = dropzone({ accept: '.pdf,application/pdf', label: label || 'Drop a PDF here or click to choose', hint, onFiles: ([f]) => load(f) })
  const api = { el: host, file: null, doc: null, numPages: 0, password: undefined, hasText: null, token: 0, bytes: () => api.file.arrayBuffer() }
  let thumbCanvas = null

  const destroy = () => { try { api.doc?.destroy() } catch { /* already gone */ } api.doc = null }
  onCleanup(destroy)

  async function load(file, password) {
    const token = ++api.token
    if (!/\.pdf$/i.test(file.name) && file.type && file.type !== 'application/pdf') return toast('That does not look like a PDF.', 'error')
    clear(host, h('div', { class: 'cv-file' }, h('div', { class: 'cv-thumb' }, h('div', { class: 'cv-ph' }, h('span', { class: 'spinner' }))),
      h('div', { class: 'cv-file-info' }, h('div', { class: 'cv-file-name' }, file.name), h('div', { class: 'cv-sub' }, 'Reading your PDF...'))))
    let doc
    try {
      doc = await openPdf(file, { password })
    } catch (e) {
      if (token !== api.token) return
      if (e.code === 'PASSWORD') return askPassword(file, password != null)
      zone.hidden = false
      clear(host, alert('error', e.message), zone)
      return
    }
    if (token !== api.token) { doc.destroy(); return }
    destroy()
    Object.assign(api, { file, doc, numPages: doc.numPages, password, hasText: null })
    let canvas = null
    try { canvas = await thumbnail(doc, 1, 220) } catch { /* thumbnail is optional */ }
    if (token !== api.token) return
    thumbCanvas = canvas
    render()
    sniffText(token)
    await onLoad?.(api)
  }

  function askPassword(file, wrong) {
    const pw = input({ type: 'password', autocomplete: 'off', placeholder: 'Password', 'aria-label': 'PDF password' })
    const go = () => load(file, pw.value)
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    clear(host, h('div', { class: 'cv-pw' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', `${file.name} is password-protected`)), pw,
        wrong && h('small', { class: 'field-hint', style: 'color:var(--danger)' }, 'That password did not work. Try again.')),
      button('Unlock', { icon: 'lock-open', variant: 'primary', onClick: go }), button('Cancel', { variant: 'ghost', onClick: () => api.reset() })))
    pw.focus()
  }

  // sample the first pages to know whether this is a scanned PDF (no text layer)
  async function sniffText(token) {
    let chars = 0
    for (let i = 1; i <= Math.min(api.numPages, 3) && chars < 40; i++) {
      try { chars += (await (await api.doc.getPage(i)).getTextContent()).items.reduce((n, it) => n + (it.str || '').trim().length, 0) } catch { break }
    }
    if (token !== api.token) return
    api.hasText = chars >= 40
    render()
    api.onSniff?.(api)
  }

  function render() {
    if (!api.file) return clear(host, zone)
    const f = api.file
    const card = h('div', { class: 'cv-file', ondragover: (e) => { e.preventDefault(); card.classList.add('drag') }, ondragleave: () => card.classList.remove('drag'),
      ondrop: (e) => { e.preventDefault(); card.classList.remove('drag'); const p = [...e.dataTransfer.files].find((x) => /pdf/i.test(x.type) || /\.pdf$/i.test(x.name)); if (p) load(p) } },
    h('div', { class: 'cv-thumb' }, thumbCanvas || h('div', { class: 'cv-ph' }, icon('file-text'))),
    h('div', { class: 'cv-file-info' },
      h('div', { class: 'cv-file-name', title: f.name }, f.name),
      h('div', { class: 'cv-chips' }, chip(`${api.numPages} page${api.numPages === 1 ? '' : 's'}`, '', 'layers'), chip(formatBytes(f.size), '', 'hard-drive'),
        api.hasText === true && chip('Has selectable text', 'good', 'text-cursor'), api.hasText === false && chip('Scanned or image-only', 'warn', 'scan-line'),
        api.password ? chip('Unlocked', '', 'lock-open') : null)),
    h('div', { class: 'cv-file-actions' }, button('Change', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', onClick: () => zone.open() }), button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove file', onClick: () => api.reset() })))
    clear(host, card, zone.hidden ? null : null)
    host.append(Object.assign(zone, { hidden: true }))
  }

  api.reset = () => {
    api.token++
    destroy()
    Object.assign(api, { file: null, numPages: 0, password: undefined, hasText: null })
    thumbCanvas = null
    zone.hidden = false
    clear(host, zone)
    onClear?.()
  }
  api.load = load
  clear(host, zone)
  return api
}

// ---------------------------------------------------------------- page picker

/** "1-3,5" from a sorted array of page numbers. */
export function formatRanges(pages) {
  const out = []
  for (let i = 0; i < pages.length; i++) {
    let j = i
    while (pages[j + 1] === pages[j] + 1) j++
    out.push(j > i + 1 ? `${pages[i]}-${pages[j]}` : j === i + 1 ? `${pages[i]},${pages[j]}` : `${pages[i]}`)
    i = j
  }
  return out.join(',')
}

/**
 * pageSelector(src, {thumbs: true, onChange}) -> {el, pages(), count, reset()}
 * Quick chips (All / None / Odd / Even), a range box ("1-3, 5, 8-") and a thumbnail grid you can click (shift-click for a range).
 * src is a pdfSource api; call .reset() after a new PDF loads. pages() returns sorted 1-based page numbers (never empty: throws when none picked).
 */
export function pageSelector(src, { thumbs = true, onChange, maxThumbs = 400 } = {}) {
  const sel = new Set()
  let n = 0, last = null, observer = null, renderToken = 0
  const range = input({ placeholder: 'All pages, or e.g. 1-3, 5, 8-', 'aria-label': 'Pages to include', spellcheck: false, autocomplete: 'off' })
  const count = h('span', { class: 'cv-pick-count', 'aria-live': 'polite' })
  const msg = h('div', { class: 'cv-sub', style: 'color:var(--danger)', hidden: true })
  const grid = h('div', { class: 'cv-pages', hidden: !thumbs })
  const btns = []

  const setAll = (pred) => { sel.clear(); for (let i = 1; i <= n; i++) if (pred(i)) sel.add(i); sync(true) }
  const pill = (label, pred) => h('button', { type: 'button', class: 'cv-pill', onclick: () => setAll(pred) }, label)

  function sync(writeRange) {
    const arr = [...sel].sort((a, b) => a - b)
    if (writeRange) { range.value = arr.length === n ? '' : formatRanges(arr); range.classList.remove('invalid'); msg.hidden = true }
    for (const b of btns) b.setAttribute('aria-pressed', String(sel.has(b._p)))
    count.textContent = n ? `${arr.length} of ${n} page${n === 1 ? '' : 's'}` : ''
    onChange?.(arr)
  }
  range.addEventListener('input', () => {
    const v = range.value.trim()
    if (!v) { for (let i = 1; i <= n; i++) sel.add(i); range.classList.remove('invalid'); msg.hidden = true; return sync(false) }
    try {
      const pages = parseRanges(v, n)
      sel.clear(); for (const p of pages) sel.add(p)
      range.classList.remove('invalid'); msg.hidden = true
      sync(false)
    } catch (e) { range.classList.add('invalid'); msg.textContent = e.message; msg.hidden = false }
  })

  function buildGrid() {
    renderToken++
    observer?.disconnect()
    btns.length = 0
    clear(grid)
    if (!thumbs || !src.doc || n > maxThumbs) { grid.hidden = true; return }
    grid.hidden = false
    const token = renderToken
    const doc = src.doc
    let chain = Promise.resolve()
    observer = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue
        observer.unobserve(en.target)
        const b = en.target
        chain = chain.then(async () => {
          if (token !== renderToken) return
          try {
            const c = await thumbnail(doc, b._p, 150)
            if (token !== renderToken) return
            const box = b.querySelector('.cv-pg-box')
            box.classList.remove('loading')
            box.replaceChildren(c, b._ck)
          } catch { /* page failed to render: leave the placeholder */ }
          await yieldToMain()
        })
      }
    }, { root: grid, rootMargin: '200px' })
    doc.getPage(1).then((p) => {
      if (token !== renderToken) return
      const vp = p.getViewport({ scale: 1 })
      for (let i = 1; i <= n; i++) {
        const ck = h('span', { class: 'cv-ck' }, icon('check'))
        const box = h('span', { class: 'cv-pg-box loading', style: { aspectRatio: `${vp.width} / ${vp.height}` } }, ck)
        const b = h('button', { type: 'button', class: 'cv-page', 'aria-pressed': String(sel.has(i)), 'aria-label': `Page ${i}`, onclick: (e) => toggle(i, e.shiftKey) }, box, h('span', String(i)))
        b._p = i
        b._ck = ck
        btns.push(b)
        grid.append(b)
        observer.observe(b)
      }
    })
  }

  function toggle(p, shift) {
    if (shift && last != null) {
      const [a, b] = [Math.min(last, p), Math.max(last, p)]
      const on = !sel.has(p)
      for (let i = a; i <= b; i++) on ? sel.add(i) : sel.delete(i)
    } else if (sel.has(p)) sel.delete(p)
    else sel.add(p)
    last = p
    sync(true)
  }

  const el = h('div', { class: 'cv-pick' },
    h('div', { class: 'cv-pick-bar' }, pill('All', () => true), pill('None', () => false), pill('Odd', (i) => i % 2 === 1), pill('Even', (i) => i % 2 === 0), range, count),
    msg, grid)
  onCleanup(() => observer?.disconnect())

  const api = {
    el,
    get count() { return sel.size },
    pages() {
      if (!sel.size) throw new Error('Pick at least one page.')
      return [...sel].sort((a, b) => a - b)
    },
    reset() {
      n = src.numPages
      sel.clear(); for (let i = 1; i <= n; i++) sel.add(i)
      last = null
      sync(true)
      buildGrid()
      // a single page needs no picker
      el.hidden = n < 2
    },
  }
  return api
}

// ---------------------------------------------------------------- result card

const FX_COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#22c55e', '#0ea5e9']
/** Small burst of confetti from the check icon (skipped for reduced motion). */
function burst(host) {
  if (reduceMotion()) return
  for (let i = 0; i < 14; i++) {
    const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.4, d = 50 + Math.random() * 60
    const p = h('i', { class: 'cv-fx', style: { background: FX_COLORS[i % FX_COLORS.length], '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 10}px`, '--r': `${Math.random() * 360}deg` } })
    host.append(p)
    setTimeout(() => p.remove(), 950)
  }
}

/**
 * done(target, {title, text, stats: ['12 pages', ...], actions: [buttons]}) renders the animated success card into target.
 * Optionally sync the flow banner: pass flowEl to mark it done.
 */
export function done(target, { title = 'Done', text, stats = [], actions = [], flowEl, celebrate = true }) {
  const ring = h('svg', { class: 'cv-ring', viewBox: '0 0 56 56', 'aria-hidden': 'true' }, h('circle', { cx: 28, cy: 28, r: 26 }), h('circle', { class: 'arc', cx: 28, cy: 28, r: 25.5 }), h('path', { d: 'M17 29.5l8 8 15-17' }))
  const card = h('div', { class: 'cv-done', role: 'status' }, ring,
    h('div', { class: 'cv-done-text' }, h('h3', title), text && h('p', text), stats.length && h('div', { class: 'cv-chips' }, stats.map((s) => chip(s)))),
    actions.length ? h('div', { class: 'cv-done-actions' }, actions) : null)
  clear(target, card)
  flowEl?.state('done')
  if (celebrate) setTimeout(() => burst(card), 350)
  card.scrollIntoView?.({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' })
  return card
}

/** Run an async job with the flow banner in "working" state; restores idle on error. */
export async function working(flowEl, fn) {
  flowEl?.state('working')
  const t0 = performance.now()
  try {
    const r = await fn()
    return r
  } catch (e) {
    flowEl?.state('idle')
    throw e
  } finally {
    working.last = performance.now() - t0
  }
}

export const secs = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)
export { formatDuration }

// ---------------------------------------------------------------- misc helpers

/** Read a File as text, guessing UTF-16 BOMs. */
export async function readTextFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer())
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf)
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf)
  return new TextDecoder('utf-8').decode(buf)
}

/** Throw the shell's cancel error when the tool page was left. */
export function checkAbort(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
}

/** Canvas -> Uint8Array in the given image type (png/jpeg). */
export async function canvasBytes(canvas, type = 'image/png', quality = 0.92) {
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), type, quality))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Page labels: number of pages + word forms. */
export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/**
 * gallery([{blob, name, label}], {onOpen}) -> element (Pinterest-style masonry of results with a download button and lightbox on each).
 * Object URLs are revoked when you leave the page or call el.revoke().
 */
export function gallery(items, { download: dl = download } = {}) {
  const urls = []
  const el = h('div', { class: 'cv-gal' }, items.map((it, i) => {
    const url = URL.createObjectURL(it.blob)
    urls.push(url)
    const img = h('img', { src: url, alt: it.name, loading: 'lazy', decoding: 'async' })
    return h('figure', { class: 'cv-gal-item', style: { '--i': i, margin: '0 0 12px' } },
      h('button', { type: 'button', class: 'cv-gal-open', 'aria-label': `Preview ${it.name}`, onclick: () => lightbox(url, it.name) }, img),
      h('figcaption', { class: 'cv-gal-cap' }, h('span', { title: it.name }, it.label || it.name),
        button('', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: `Download ${it.name}`, onClick: () => dl(it.blob, it.name) })))
  }))
  el.revoke = () => { for (const u of urls.splice(0)) URL.revokeObjectURL(u) }
  onCleanup(el.revoke)
  return el
}

function lightbox(url, name) {
  modal({ title: name, body: h('div', { class: 'preview' }, h('img', { src: url, alt: name, style: 'max-height:70vh' })) })
}

/** beforeAfter(beforeNode, afterNode, ['Original', 'Scan']) -> element with a draggable divider (also keyboard accessible). */
export function beforeAfter(before, after, labels = ['Before', 'After']) {
  after.classList.add('after')
  const slider = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Compare before and after', oninput: (e) => el.style.setProperty('--p', `${e.target.value}%`) })
  const ar = before.width && before.height ? before.width / before.height : 0
  const el = h('div', { class: 'cv-ba', style: ar ? { maxWidth: `${Math.round(Math.min(900, Math.max(260, 520 * ar)))}px`, margin: '0 auto', width: '100%' } : null }, before, after, h('i', { class: 'cv-ba-line' }), h('span', { class: 'cv-ba-tag l' }, labels[0]), h('span', { class: 'cv-ba-tag r' }, labels[1]), slider)
  return el
}
