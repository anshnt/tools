// Shared look and UI pieces for the Files pack: file-type tiles, hero cards, bento grid, folder picker, previews, small motion.
// Classes are all prefixed "fx-" so nothing leaks into the rest of the site. Files starting with "_" are never tool modules.
import { h, icon, clear, button, toast, modal, alert, formatBytes, copyText, onCleanup, isAbort, errorMessage } from '../../lib/ui.js'
import { pickFolder } from '../../lib/files.js'
import {
  KINDS, kindOfName, extOf, canPickDirectory, scanHandle, scanFileList, scanDrop, readRange, decodeText, looksBinary, hex, hexBytes,
} from './_core.js'

export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

const injected = new Set()
/** Inject a <style> once (by id). */
export function injectStyle(id, css) {
  if (injected.has(id) && document.getElementById(id)) return
  injected.add(id)
  const el = document.createElement('style')
  el.id = id
  el.textContent = css
  document.head.append(el)
}

const BASE_CSS = `
.fx { --k: var(--accent); }
@keyframes fx-up { from { opacity: 0; transform: translateY(14px) scale(.985); } }
@keyframes fx-pop { 0% { transform: scale(.55); opacity: 0; } 60% { transform: scale(1.09); opacity: 1; } 100% { transform: scale(1); } }
@keyframes fx-grow { from { transform: scaleX(0); } }
@keyframes fx-float { 0%, 100% { transform: translateY(0) rotate(-1.5deg); } 50% { transform: translateY(-7px) rotate(1.5deg); } }
@keyframes fx-sheen { to { background-position: -200% 0; } }
@keyframes fx-draw { to { stroke-dashoffset: 0; } }
@keyframes fx-burst { to { transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(var(--r)) scale(.25); opacity: 0; } }
@keyframes fx-ping { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--k) 45%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; } }
.fx-in { animation: fx-up .55s var(--ease) both; animation-delay: calc(var(--i, 0) * 45ms); }
.fx-pop { animation: fx-pop .5s var(--spring) both; }
.fx-tile { --s: 40px; width: var(--s); height: var(--s); border-radius: calc(var(--s) * .3); display: grid; place-items: center; flex: none; color: var(--k); background: color-mix(in srgb, var(--k) 13%, var(--surface)); border: 1px solid color-mix(in srgb, var(--k) 24%, transparent); }
.fx-tile .icon { width: calc(var(--s) * .5); height: calc(var(--s) * .5); }
.fx-tile.sm { --s: 30px; }
.fx-tile.lg { --s: 52px; }
.fx-doc { position: relative; width: 84px; height: 104px; flex: none; border-radius: 16px 28px 16px 16px; display: grid; place-items: center; padding-bottom: 14px;
  background: linear-gradient(160deg, color-mix(in srgb, var(--k) 22%, var(--surface)), var(--surface) 80%); border: 1px solid color-mix(in srgb, var(--k) 38%, transparent);
  box-shadow: 0 18px 34px -18px color-mix(in srgb, var(--k) 80%, transparent); color: var(--k); animation: fx-float 6s ease-in-out infinite; }
.fx-doc::after { content: ""; position: absolute; top: 0; right: 0; width: 28px; height: 28px; border-radius: 0 16px 0 10px; background: linear-gradient(225deg, var(--bg) 50%, color-mix(in srgb, var(--k) 38%, var(--surface)) 50%); }
.fx-doc .icon { width: 30px; height: 30px; }
.fx-doc b { position: absolute; bottom: 10px; left: 0; right: 0; text-align: center; font: 700 12.5px var(--mono); letter-spacing: .06em; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px; }
.fx-hero { position: relative; display: flex; gap: 20px; align-items: center; padding: 22px; border-radius: var(--radius-xl); border: 1px solid var(--border); background: var(--surface); overflow: hidden; isolation: isolate; box-shadow: var(--shadow); }
.fx-hero::before { content: ""; position: absolute; inset: 0; z-index: -1; background: radial-gradient(70% 120% at 100% -10%, color-mix(in srgb, var(--k) 20%, transparent), transparent 60%), radial-gradient(50% 90% at 0% 110%, color-mix(in srgb, var(--accent-2) 10%, transparent), transparent 60%); }
.fx-hero .fx-title { font-size: clamp(19px, 3.2vw, 26px); font-weight: 650; letter-spacing: -.025em; overflow-wrap: anywhere; line-height: 1.2; }
.fx-hero .fx-sub { color: var(--muted); margin-top: 4px; font-size: 14px; overflow-wrap: anywhere; }
.fx-hero .fx-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.fx-hero .fx-thumb { width: 150px; height: 118px; border-radius: 16px; border: 1px solid var(--border); background: var(--checker); overflow: hidden; display: grid; place-items: center; flex: none; }
.fx-hero .fx-thumb img, .fx-hero .fx-thumb canvas, .fx-hero .fx-thumb video { max-width: 100%; max-height: 100%; display: block; }
.fx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.fx-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 2px 10px; border-radius: 99px; font-size: 12px; font-weight: 550; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); overflow-wrap: anywhere; }
.fx-chip .icon { width: 13px; height: 13px; }
.fx-chip.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 28%, transparent); }
.fx-chip.warn { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 32%, transparent); }
.fx-chip.bad { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 32%, transparent); }
.fx-chip.accent { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 28%, transparent); }
.fx-bento { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 14px; align-items: start; }
.fx-bento > .fx-wide { grid-column: 1 / -1; }
.fx-card { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; min-width: 0; box-shadow: var(--shadow-sm); transition: transform .3s var(--ease), box-shadow .3s var(--ease), border-color .3s; overflow: hidden; }
.fx-card::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px; background: linear-gradient(90deg, var(--k), transparent 70%); opacity: .55; }
@media (hover: hover) { .fx-card:hover { transform: translateY(-2px); box-shadow: var(--shadow); border-color: color-mix(in srgb, var(--k) 30%, var(--border)); } }
.fx-card-h { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; font-size: 15px; font-weight: 600; min-width: 0; }
.fx-card-h > span { min-width: 0; overflow-wrap: anywhere; }
.fx-card-h .grow { flex: 1; }
.fx-kv { display: grid; grid-template-columns: minmax(78px, max-content) minmax(0, 1fr); gap: 0 16px; margin: 0; }
.fx-kv dt { color: var(--muted); font-size: 13px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.fx-kv dd { margin: 0; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13.5px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; min-width: 0; }
.fx-kv dt:nth-last-of-type(1), .fx-kv dd:last-of-type { border-bottom: 0; }
.fx-mono { font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; word-break: break-all; }
.fx-bar { height: 8px; border-radius: 99px; background: var(--surface-2); overflow: hidden; min-width: 40px; }
.fx-bar > i { display: block; height: 100%; width: var(--w, 0%); background: var(--k, var(--accent)); border-radius: inherit; transform-origin: left; animation: fx-grow .9s var(--ease) both; animation-delay: calc(var(--i, 0) * 35ms); }
.fx-hash { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; padding: 8px 8px 8px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); transition: border-color .2s, background .3s; }
.fx-hash > b { font-size: 12px; color: var(--muted); font-weight: 600; }
.fx-hash > code { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; word-break: break-all; line-height: 1.45; }
.fx-hash.match { border-color: var(--success); background: var(--success-soft); }
.fx-skel { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-3) 30%, var(--surface-2) 50%, var(--surface-3) 70%); background-size: 200% 100%; animation: fx-sheen 1.4s linear infinite; }
.fx-check { width: 74px; height: 74px; flex: none; }
.fx-check circle, .fx-check path { fill: none; stroke: currentColor; stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 200; stroke-dashoffset: 200; animation: fx-draw .75s var(--ease) .1s forwards; }
.fx-check path { animation-delay: .5s; animation-duration: .45s; }
.fx-burst { position: fixed; z-index: 500; pointer-events: none; width: 0; height: 0; }
.fx-burst i { position: absolute; left: 0; top: 0; width: 8px; height: 8px; border-radius: 2px; background: var(--c); animation: fx-burst .85s var(--ease) forwards; }
.fx-fz .fx-scan { min-height: 18px; }
.fx-fz.scanning { border-style: solid; border-color: var(--accent); }
.fx-fz.scanning .dz-icon { animation: fx-ping 1.1s ease-out infinite; --k: var(--accent); }
.fx-code { margin: 0; font: 12.5px/1.55 var(--mono); background: var(--surface-2); border: 1px solid var(--border); border-radius: 14px; overflow: auto; max-height: 56vh; }
.fx-code .ln { display: grid; grid-template-columns: 52px minmax(0, 1fr); }
.fx-code .ln > span:first-child { text-align: right; padding: 0 10px 0 6px; color: var(--muted); user-select: none; border-right: 1px solid var(--border); position: sticky; left: 0; background: var(--surface-2); }
.fx-code .ln > span:last-child { padding: 0 12px; white-space: pre; }
.fx-code .ln.hit { background: color-mix(in srgb, var(--warning) 14%, transparent); }
.fx-code mark { background: color-mix(in srgb, var(--accent) 30%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
.fx-media { max-width: 100%; max-height: 56vh; border-radius: 12px; display: block; margin: 0 auto; }
.fx-seg-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.fx-num { font-variant-numeric: tabular-nums; }
.fx-link { color: var(--accent); font-weight: 550; cursor: pointer; background: none; border: 0; padding: 0; font: inherit; text-decoration: underline; text-underline-offset: 3px; }
.fx-pill-list { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 600px) {
  .fx-hero { flex-direction: column; align-items: flex-start; padding: 18px; gap: 14px; }
  .fx-hero .fx-thumb { width: 100%; height: 150px; }
  .fx-doc { width: 68px; height: 84px; }
  .fx-card { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .fx-in, .fx-pop, .fx-doc, .fx-bar > i, .fx-check circle, .fx-check path, .fx-fz.scanning .dz-icon { animation: none !important; }
  .fx-check circle, .fx-check path { stroke-dashoffset: 0; }
}
`
/** Call once from mount(): injects the shared stylesheet. */
export const useFx = () => injectStyle('fx-files-base', BASE_CSS)

// ---------- Small building blocks ----------
export const kindOf = (name) => KINDS[kindOfName(name)] || KINDS.other
/** Colored squircle with the icon for a file name's type (kind: 'folder' forces a folder). */
export function tile(name, { size = '', kind } = {}) {
  const k = KINDS[kind] || kindOf(name)
  return h('span', { class: ['fx-tile', size], style: { '--k': k.color }, title: k.label.replace(/s$/, '') }, icon(k.icon))
}
/** Big document glyph with the extension on it. */
export function docGlyph(name, kindKey) {
  const k = KINDS[kindKey] || kindOf(name)
  const e = extOf(name)
  return h('div', { class: 'fx-doc', style: { '--k': k.color }, 'aria-hidden': 'true' }, icon(k.icon), h('b', e ? (e.length > 5 ? e.slice(0, 5) : e) : 'file'))
}
export const chip = (text, type = '', ic) => h('span', { class: ['fx-chip', type] }, ic && icon(ic), text)
export const chips = (...items) => h('div', { class: 'fx-chips' }, items.flat().filter(Boolean))

/** Definition list: kv([['Name', value], ...]); falsy values are skipped. */
export function kv(rows) {
  return h('dl', { class: 'fx-kv' }, rows.filter((r) => r && r[1] != null && r[1] !== '' && r[1] !== false).map(([k, v]) => [h('dt', k), h('dd', v)]))
}
/** Card for the bento grid. */
export function card(title, ic, color, ...kids) {
  return h('section', { class: 'fx-card fx-in', style: { '--k': color || 'var(--accent)' } },
    h('h2', { class: 'fx-card-h' }, ic && h('span', { class: 'fx-tile sm', style: { '--k': color || 'var(--accent)' } }, icon(ic)), h('span', title)), kids)
}
/** Stagger helper: call on a list of nodes to set --i. */
export const stagger = (nodes, cap = 14) => { nodes.forEach((n, i) => n.style?.setProperty('--i', Math.min(i, cap))); return nodes }

/** Count a number up inside el. fmt defaults to toLocaleString. */
export function countUp(el, to, fmt = (n) => Math.round(n).toLocaleString(), ms = 900) {
  if (reduceMotion() || !Number.isFinite(to) || to === 0) { el.textContent = fmt(to); return }
  const start = performance.now()
  const step = (now) => {
    const p = Math.min(1, (now - start) / ms)
    el.textContent = fmt(to * (1 - Math.pow(1 - p, 3)))
    if (p < 1 && el.isConnected) requestAnimationFrame(step)
    else el.textContent = fmt(to)
  }
  requestAnimationFrame(step)
}

const BURST = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#12a594', '#3e63dd']
/** A quick confetti puff from an element. Skipped for reduced motion. */
export function celebrate(anchor, count = 16) {
  if (reduceMotion() || !anchor?.getBoundingClientRect) return
  const r = anchor.getBoundingClientRect()
  const layer = h('div', { class: 'fx-burst', 'aria-hidden': 'true', style: { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` } })
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4
    const d = 46 + Math.random() * 64
    layer.append(h('i', { style: { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 14}px`, '--r': `${Math.round(Math.random() * 360)}deg`, '--c': BURST[i % BURST.length] } }))
  }
  document.body.append(layer)
  setTimeout(() => layer.remove(), 1000)
}

/** Animated check mark in a ring (uses currentColor). */
export function checkRing(extra = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 80 80')
  s.setAttribute('class', `fx-check ${extra}`.trim())
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = '<circle cx="40" cy="40" r="32"/><path d="M26 41l10 10 19-21"/>'
  return s
}

/** hashRow('SHA-256', value) -> row with copy button. el.setValue(v) fills it in later. */
export function hashRow(label, value = '') {
  const code = h('code', value || h('span', { class: 'fx-skel', style: 'display:block;height:12px' }))
  const btn = button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${label}`, disabled: !value, onClick: () => copyText(code.textContent) })
  const el = h('div', { class: 'fx-hash' }, h('b', label), code, btn)
  el.setValue = (v) => { code.textContent = v; btn.disabled = !v }
  el.value = () => code.textContent
  return el
}

/** Make an <img> / media preview from a Blob; the URL is revoked when you leave the page. */
export function objectUrl(blob) {
  const u = URL.createObjectURL(blob)
  onCleanup(() => URL.revokeObjectURL(u))
  return u
}

// ---------- Folder picker ----------
/**
 * Dropzone-looking folder picker. Click: showDirectoryPicker when available (real handles, in-place tools work),
 * otherwise a webkitdirectory input. Drop: folders and files. Scans with live counts and calls onFolder(result).
 * opts: {write, recursive, skip(name,isDir,path), onFolder(result), label, hint, compact}
 */
export function folderZone(opts = {}) {
  const { write = false, recursive = true, skip, onFolder, label, hint, compact = false } = opts
  const status = h('span', { class: 'fx-scan-text' }, hint || (canPickDirectory() ? 'Your files stay on this device. Nothing is uploaded.' : 'Your browser lists the folder for you. Nothing is uploaded.'))
  const cancel = button('Cancel', { variant: 'ghost', size: 'sm', onClick: (e) => { e.stopPropagation(); ctl?.abort() } })
  cancel.hidden = true
  let ctl = null
  const canHover = matchMedia('(hover: hover)').matches
  const el = h('div', {
    class: ['dropzone', 'fx-fz', compact && 'compact'], tabindex: 0, role: 'button', 'aria-label': label || 'Choose a folder',
    onclick: (e) => { if (!cancel.contains(e.target)) pick() },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } },
    ondragover: (e) => { e.preventDefault(); el.classList.add('drag') },
    ondragleave: () => el.classList.remove('drag'),
    ondrop: (e) => {
      e.preventDefault()
      el.classList.remove('drag')
      const dt = e.dataTransfer
      run((signal, onProgress) => scanDrop(dt, { recursive, skip, signal, onProgress }))
    },
  },
  h('div', { class: 'dz-icon' }, icon('folder-open')),
  h('div', h('strong', label || (canHover ? 'Drop a folder here or click to choose' : 'Tap to choose a folder')), h('div', { class: 'dz-hint' }, status, cancel)))

  async function run(task) {
    ctl?.abort()
    const mine = (ctl = new AbortController())
    el.classList.add('scanning')
    cancel.hidden = false
    status.textContent = 'Reading folder...'
    try {
      const res = await task(mine.signal, (n) => { status.textContent = `Reading folder... ${n.toLocaleString()} files found` })
      if (mine.signal.aborted) return
      if (!res.entries.length) { toast('That folder has no files in it.', 'info'); status.textContent = 'That folder was empty. Try another one.'; return }
      status.textContent = `${res.name}: ${res.entries.length.toLocaleString()} files, ${formatBytes(res.entries.reduce((s, e) => s + e.size, 0))}${res.truncated ? ' (stopped at the file limit)' : ''}`
      onFolder?.(res)
    } catch (err) {
      if (isAbort(err)) { status.textContent = 'Cancelled.'; return }
      console.error(err)
      status.textContent = 'Could not read that folder.'
      toast(errorMessage(err), 'error')
    } finally {
      if (ctl === mine) { el.classList.remove('scanning'); cancel.hidden = true }
    }
  }
  async function pick() {
    if (el.classList.contains('scanning')) return
    if (canPickDirectory()) {
      let handle
      try { handle = await window.showDirectoryPicker({ id: 'tools-files', mode: write ? 'readwrite' : 'read' }) } catch (e) {
        if (e?.name === 'AbortError') return
        if (e?.name !== 'SecurityError' && e?.name !== 'NotAllowedError' && e?.name !== 'TypeError') toast(errorMessage(e), 'error')
        else return viaInput()
        return
      }
      return run((signal, onProgress) => scanHandle(handle, { recursive, skip, signal, onProgress }))
    }
    return viaInput()
  }
  async function viaInput() {
    const files = await pickFolder()
    if (!files.length) return
    run(async () => scanFileList(files, { skip }))
  }
  el.reset = (text) => { status.textContent = text || hint || '' }
  onCleanup(() => ctl?.abort())
  return el
}

// ---------- File preview (shared by search, unzip, duplicates) ----------
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'oga'])

/** Escape + highlight regex matches as DOM (no innerHTML). */
export function highlightNodes(text, re) {
  if (!re) return [text]
  const out = []
  let last = 0
  re.lastIndex = 0
  for (let m; (m = re.exec(text)); ) {
    if (!m[0]) { re.lastIndex++; continue }
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(h('mark', m[0]))
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return out
}

/**
 * Open a modal preview for a File/Blob: image, video, audio, PDF, text with line numbers and highlighted matches, or a hex dump.
 * opts: {name, re (RegExp with g flag), line (1-based line to scroll to), actions: [buttons]}
 */
export async function openPreview(file, opts = {}) {
  const name = opts.name || file.name || 'file'
  const e = extOf(name)
  const urls = []
  const url = () => { const u = URL.createObjectURL(file); urls.push(u); return u }
  const body = h('div', { class: 'stack' })
  const meta = h('div', { class: 'small muted' }, `${formatBytes(file.size)} · ${name}`)
  body.append(meta)
  let after = null
  const head = await readRange(file, 0, 8192)
  if (IMG_EXT.has(e) || file.type?.startsWith('image/') && file.type !== 'image/heic') {
    body.append(h('img', { class: 'fx-media', src: url(), alt: name }))
  } else if (VIDEO_EXT.has(e)) {
    body.append(h('video', { class: 'fx-media', src: url(), controls: true, preload: 'metadata' }))
  } else if (AUDIO_EXT.has(e)) {
    body.append(h('audio', { src: url(), controls: true, style: 'width:100%' }))
  } else if (e === 'pdf') {
    body.append(h('object', { data: url(), type: 'application/pdf', style: 'width:100%;height:60vh;border-radius:12px;border:1px solid var(--border)' }, alert('info', 'Your browser cannot show PDFs inline. Use Download instead.')))
  } else if (!looksBinary(head)) {
    const limit = 1 << 20
    const text = decodeText(new Uint8Array(await file.slice(0, limit).arrayBuffer()))
    const lines = text.split(/\r\n|\r|\n/)
    const shown = lines.slice(0, 5000)
    const re = opts.re
    const hitLines = new Set()
    const code = h('div', { class: 'fx-code', tabindex: 0, role: 'region', 'aria-label': `Text of ${name}` })
    shown.forEach((ln, i) => {
      let hit = false
      if (re) { re.lastIndex = 0; hit = re.test(ln); re.lastIndex = 0 }
      if (hit) hitLines.add(i + 1)
      code.append(h('div', { class: ['ln', hit && 'hit'], dataset: { n: i + 1 } }, h('span', i + 1), h('span', hit ? highlightNodes(ln, re) : ln)))
    })
    body.append(code)
    if (file.size > limit || lines.length > shown.length) body.append(h('div', { class: 'small muted' }, `Showing the first ${shown.length.toLocaleString()} lines${file.size > limit ? ' (first 1 MB)' : ''}.`))
    after = () => {
      const target = opts.line ? code.querySelector(`[data-n="${opts.line}"]`) : code.querySelector('.hit')
      if (target) code.scrollTop = Math.max(0, target.offsetTop - code.clientHeight / 2 + 20)
    }
  } else {
    const rows = []
    for (let i = 0; i < Math.min(head.length, 512); i += 16) {
      const slice = head.subarray(i, i + 16)
      rows.push(`${hex(i, 8)}  ${hexBytes(slice).padEnd(47)}  ${[...slice].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}`)
    }
    body.append(h('div', { class: 'small muted' }, 'This looks like a binary file, so here are its first bytes.'), h('pre', { class: 'code-out' }, rows.join('\n')))
  }
  const m = modal({ title: name.split('/').pop(), icon: 'eye', body, actions: opts.actions || [], onClose: () => { urls.forEach((u) => URL.revokeObjectURL(u)); opts.onClose?.() } })
  after && requestAnimationFrame(after)
  return m
}

export { clear }
