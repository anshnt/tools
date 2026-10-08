// Shared helpers for the text-write pack (files starting with "_" are never tool modules).
// Contents: one scoped stylesheet (.tw-*), small UI parts (chips, ring gauge, wave bars, text input with
// file open), text analysis helpers (sentences, words, syllables) and a reader for txt/md/docx/pdf files.
import { h, icon, button, textarea, toast, onCleanup } from '../../lib/ui.js'
import { ext } from '../../lib/files.js'
import { mammoth as loadMammoth } from '../../lib/libs.js'
import { openPdf, extractText } from '../../lib/pdf.js'

// ---------------------------------------------------------------- style

const CSS = `
.tw { --tw-accent: var(--c, var(--accent)); display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.tw *, .tw *::before, .tw *::after { box-sizing: border-box; }
.tw-stage { position: relative; border-radius: var(--radius-xl); border: 1px solid var(--border); padding: 18px; min-width: 0;
  background: radial-gradient(900px 280px at 0% 0%, color-mix(in srgb, var(--tw-accent) 9%, transparent), transparent 60%),
    radial-gradient(700px 260px at 100% 100%, color-mix(in srgb, var(--accent-2) 8%, transparent), transparent 60%), var(--surface); box-shadow: var(--shadow-sm); }
.tw-kicker { font-size: 11.5px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 7px; }
.tw-kicker .icon { width: 14px; height: 14px; color: var(--tw-accent); }
.tw-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; min-width: 0; }
.tw-sub { font-size: 12.5px; color: var(--muted); }
.tw-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.tw-chip { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface);
  color: var(--text-2); font: inherit; font-size: 13.5px; font-weight: 550; cursor: pointer; transition: transform .25s var(--spring), border-color .2s, background .2s, box-shadow .2s, color .2s; }
.tw-chip .icon { width: 15px; height: 15px; color: var(--muted); transition: color .2s, transform .3s var(--spring); }
.tw-chip:hover { transform: translateY(-1px); border-color: var(--border-strong); color: var(--text); }
.tw-chip:active { transform: scale(.96); }
.tw-chip[aria-pressed="true"] { color: var(--text); border-color: color-mix(in srgb, var(--tw-accent) 55%, var(--border));
  background: linear-gradient(135deg, color-mix(in srgb, var(--tw-accent) 15%, var(--surface)), color-mix(in srgb, var(--accent-2) 11%, var(--surface))); box-shadow: 0 8px 20px -14px var(--tw-accent); }
.tw-chip[aria-pressed="true"] .icon { color: var(--tw-accent); transform: scale(1.1); }
.tw-chip:disabled { opacity: .5; cursor: not-allowed; }
.tw-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 10px; }
.tw-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left; padding: 12px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface);
  color: var(--text); font: inherit; cursor: pointer; min-width: 0; transition: transform .3s var(--spring), border-color .2s, box-shadow .25s, background .2s; }
.tw-tile:hover { transform: translateY(-2px); box-shadow: var(--shadow); border-color: var(--border-strong); }
.tw-tile:active { transform: scale(.98); }
.tw-tile b { font-size: 14px; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
.tw-tile span { font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.tw-tile .tw-bubble { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; color: var(--tw-accent); background: color-mix(in srgb, var(--tw-accent) 13%, transparent); margin-bottom: 4px; }
.tw-tile .tw-bubble .icon { width: 16px; height: 16px; }
.tw-tile[aria-pressed="true"] { border-color: color-mix(in srgb, var(--tw-accent) 60%, var(--border));
  background: linear-gradient(150deg, color-mix(in srgb, var(--tw-accent) 13%, var(--surface)), var(--surface) 70%); box-shadow: 0 14px 30px -20px var(--tw-accent); }
.tw-tiles.sm { grid-template-columns: repeat(auto-fill, minmax(min(100%, 112px), 1fr)); gap: 8px; }
.tw-tiles.sm .tw-tile { display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 9px; align-items: center; padding: 8px 10px; border-radius: 14px; }
.tw-tiles.sm .tw-tile .tw-bubble { grid-row: span 2; margin: 0; width: 28px; height: 28px; border-radius: 9px; }
.tw-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.tw-bar .grow { flex: 1; min-width: 0; }
.tw-input { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.tw-input .textarea { min-height: 0; }
.tw-input.drag .textarea { border-color: var(--accent); box-shadow: 0 0 0 4px var(--ring); }
.tw-count { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.tw-ring { position: relative; display: grid; place-items: center; flex: none; }
.tw-ring svg { transform: rotate(-90deg); overflow: visible; }
.tw-ring .trk { stroke: var(--surface-3); fill: none; }
.tw-ring .val { fill: none; stroke-linecap: round; transition: stroke-dashoffset 1s var(--ease), stroke .4s; }
.tw-ring .mid { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; line-height: 1.1; }
.tw-ring .mid b { font-size: 30px; font-weight: 700; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.tw-ring .mid span { font-size: 11.5px; color: var(--muted); margin-top: 3px; }
.tw-wave { display: inline-flex; align-items: center; gap: 3px; height: 28px; }
.tw-wave i { width: 4px; height: 6px; border-radius: 4px; background: linear-gradient(var(--tw-accent), var(--accent-2)); opacity: .45; transition: opacity .3s; }
.tw-wave.on i { opacity: 1; animation: tw-wave 1.05s ease-in-out infinite; animation-delay: calc(var(--i) * -.13s); }
@keyframes tw-wave { 0%, 100% { height: 6px; } 50% { height: 26px; } }
.tw-play { position: relative; width: 64px; height: 64px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; flex: none; color: var(--accent-text);
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, var(--accent-2))); box-shadow: 0 14px 30px -12px var(--accent); transition: transform .3s var(--spring), box-shadow .3s; }
.tw-play .icon { width: 26px; height: 26px; fill: currentColor; stroke-width: 1.5; }
.tw-play:hover:not(:disabled) { transform: scale(1.06); }
.tw-play:active:not(:disabled) { transform: scale(.94); }
.tw-play:disabled { opacity: .5; cursor: not-allowed; }
.tw-play::before { content: ""; position: absolute; inset: -6px; border-radius: 50%; border: 2px solid var(--accent); opacity: 0; }
.tw-play.live::before { animation: tw-pulse 1.8s ease-out infinite; }
@keyframes tw-pulse { 0% { transform: scale(.88); opacity: .6; } 100% { transform: scale(1.35); opacity: 0; } }
.tw-mark { border-radius: 4px; padding: 1px 0; background: color-mix(in srgb, var(--mc, var(--accent)) 22%, transparent); box-shadow: 0 -1px 0 color-mix(in srgb, var(--mc, var(--accent)) 25%, transparent) inset, 0 2px 0 var(--mc, var(--accent)) inset; }
.tw-reader { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.75; font-size: 16px; padding: 14px 16px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); max-height: 420px; overflow: auto; cursor: text; }
.tw-reader .done { color: var(--muted); }
.tw-reader mark { background: linear-gradient(120deg, color-mix(in srgb, var(--accent) 35%, transparent), color-mix(in srgb, var(--accent-2) 35%, transparent)); color: var(--text); border-radius: 5px; padding: 1px 2px; }
.tw-paper { background: #fff; color: #1b1b1f; border-radius: 6px; box-shadow: 0 1px 2px rgba(16,16,40,.08), 0 24px 50px -24px rgba(16,16,40,.45); padding: 26px 28px; overflow: hidden; min-width: 0; }
.tw-burst { position: absolute; inset: 0; pointer-events: none; overflow: hidden; border-radius: inherit; }
.tw-burst i { position: absolute; left: var(--x, 50%); top: var(--y, 50%); width: 8px; height: 8px; border-radius: 2px; background: var(--k); opacity: 0; animation: tw-pop .95s var(--ease) forwards; animation-delay: var(--d, 0s); }
@keyframes tw-pop { 0% { opacity: 1; transform: translate(0, 0) rotate(0) scale(.6); } 100% { opacity: 0; transform: translate(var(--dx), var(--dy)) rotate(var(--r)) scale(1); } }
.tw-skel { border-radius: 10px; background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%); background-size: 200% 100%; animation: tw-skel 1.4s linear infinite; }
@keyframes tw-skel { to { background-position: -200% 0; } }
.tw-note { display: flex; gap: 9px; align-items: flex-start; font-size: 12.5px; color: var(--muted); }
.tw-note .icon { width: 15px; height: 15px; margin-top: 2px; color: var(--tw-accent); }
.tw-bars { display: flex; flex-direction: column; gap: 8px; }
.tw-bar-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; }
.tw-bar-row .trk { grid-column: 1 / -1; height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.tw-bar-row .trk i { display: block; height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, var(--tw-accent), var(--accent-2)); transition: width .8s var(--ease); }
.tw-result-in { animation: tw-rise .5s var(--ease) both; }
@keyframes tw-rise { from { opacity: 0; transform: translateY(10px); } }
.tw-kbd { font: 600 11px var(--mono); padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border-strong); border-bottom-width: 2px; background: var(--surface); color: var(--text-2); }
@media (max-width: 720px) { .tw-stage { padding: 14px; border-radius: 22px; } .tw-ring .mid b { font-size: 26px; } .tw-play { width: 58px; height: 58px; } }
`

/** Inject the shared stylesheet once. Call at the top of mount(). */
export function useStyle() {
  if (document.getElementById('tw-style')) return
  const s = document.createElement('style')
  s.id = 'tw-style'
  s.textContent = CSS
  document.head.append(s)
}

/** Inject an extra stylesheet once (use class names unique to the tool). */
export function addStyle(id, css) {
  if (document.getElementById(id)) return
  const s = document.createElement('style')
  s.id = id
  s.textContent = css
  document.head.append(s)
}

/** A tool root: <div class="tw tw-<id> stack"> with the stylesheet ready. */
export function toolRoot(id, ...kids) {
  useStyle()
  return h('div', { class: ['tw', `tw-${id}`] }, ...kids)
}

// ---------------------------------------------------------------- small UI parts

/** chip('Formal', {icon, pressed, onClick}) */
export function chip(label, { icon: ic, pressed = false, onClick, title, disabled } = {}) {
  return h('button', { type: 'button', class: 'tw-chip', 'aria-pressed': String(pressed), title, disabled, onclick: onClick }, ic && icon(ic), h('span', label))
}

/**
 * chips([['id','Label', 'icon?']], value, onChange) -> element with .value and .set(v). Single choice.
 * Pass {multi: true} and an array value for multi-select (onChange gets the array).
 */
export function chips(options, value, onChange, { multi = false, ariaLabel } = {}) {
  const el = h('div', { class: 'tw-chips', role: 'group', 'aria-label': ariaLabel || null })
  el.value = value
  const btns = options.map(([id, label, ic, title]) => {
    const b = chip(label, { icon: ic, title, pressed: multi ? value.includes(id) : value === id, onClick: () => {
      if (multi) el.set(el.value.includes(id) ? el.value.filter((x) => x !== id) : [...el.value, id])
      else el.set(id)
      onChange?.(el.value)
    } })
    b._id = id
    return b
  })
  el.append(...btns)
  el.set = (v) => { el.value = v; for (const b of btns) b.setAttribute('aria-pressed', String(multi ? v.includes(b._id) : b._id === v)) }
  return el
}

/** tiles([{id, title, sub, icon}], value, onChange) -> grid of selectable cards. */
export function tiles(options, value, onChange, { ariaLabel, compact = false } = {}) {
  const el = h('div', { class: ['tw-tiles', compact && 'sm'], role: 'group', 'aria-label': ariaLabel || null })
  el.value = value
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', class: 'tw-tile', 'aria-pressed': String(o.id === value), onclick: () => { el.set(o.id); onChange?.(o.id) } },
      o.icon && h('span', { class: 'tw-bubble' }, icon(o.icon)), h('b', o.title), o.sub && h('span', o.sub))
    b._id = o.id
    return b
  })
  el.append(...btns)
  el.set = (v) => { el.value = v; for (const b of btns) b.setAttribute('aria-pressed', String(b._id === v)) }
  return el
}

/** Animated ring gauge. ring({size: 132, stroke: 11}) -> {el, set(fraction 0..1, big, small, color)}. */
export function ring({ size = 132, stroke = 11 } = {}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const val = h('circle', { class: 'val', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke, 'stroke-dasharray': c, 'stroke-dashoffset': c })
  const big = h('b', '-')
  const small = h('span')
  const el = h('div', { class: 'tw-ring', style: { width: `${size}px`, height: `${size}px` } },
    h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, h('circle', { class: 'trk', cx: size / 2, cy: size / 2, r, 'stroke-width': stroke }), val),
    h('div', { class: 'mid' }, big, small))
  return {
    el,
    set(fraction, bigText, smallText, color = 'var(--accent)') {
      const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
      val.setAttribute('stroke-dashoffset', String(c * (1 - f)))
      val.setAttribute('stroke', color)
      big.textContent = bigText
      small.textContent = smallText || ''
    },
  }
}

/** Equaliser bars. wave(9) -> {el, set(on)} */
export function wave(n = 9) {
  const el = h('span', { class: 'tw-wave', 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => h('i', { style: { '--i': i } })))
  return { el, set: (on) => el.classList.toggle('on', !!on) }
}

/** Tiny confetti burst inside `host` (host must be position: relative). Skipped with reduced motion. */
export function celebrate(host) {
  if (!host || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const colors = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#22c55e', '#0ea5e9']
  const box = h('div', { class: 'tw-burst', 'aria-hidden': 'true' })
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + Math.random() * 0.4
    const d = 60 + Math.random() * 90
    box.append(h('i', { style: { '--x': '50%', '--y': '40%', '--k': colors[i % colors.length], '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 30}px`, '--r': `${(Math.random() - 0.5) * 540}deg`, '--d': `${Math.random() * 0.08}s` } }))
  }
  host.append(box)
  setTimeout(() => box.remove(), 1300)
}

/** Count a number up inside el. */
export function countUp(el, to, { format = (n) => Math.round(n).toLocaleString(), ms = 650 } = {}) {
  if (!Number.isFinite(to) || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = format(to); return }
  const from = Number(el._v) || 0
  el._v = to
  const t0 = performance.now()
  cancelAnimationFrame(el._raf)
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms)
    el.textContent = format(from + (to - from) * (1 - (1 - p) ** 3))
    if (p < 1) el._raf = requestAnimationFrame(step)
  }
  el._raf = requestAnimationFrame(step)
  onCleanup(() => cancelAnimationFrame(el._raf))
}

export const note = (text, ic = 'info') => h('div', { class: 'tw-note' }, icon(ic), h('span', text))
export const kicker = (text, ic) => h('div', { class: 'tw-kicker' }, ic && icon(ic), text)

// ---------------------------------------------------------------- reading files

export const TEXT_ACCEPT = '.txt,.md,.markdown,.docx,.pdf,.html,.htm,.csv,.srt,.vtt,text/plain'

/** Read plain text out of a txt / md / html / docx / pdf file. */
export async function readTextFile(file, onProgress) {
  const e = ext(file.name)
  if (e === 'docx') {
    const m = await loadMammoth()
    const r = await m.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return r.value.replace(/\n{3,}/g, '\n\n').trim()
  }
  if (e === 'doc') throw new Error('Old .doc files are not supported. Open it in Word and save it as .docx first.')
  if (e === 'pdf') {
    const doc = await openPdf(file)
    const pages = await extractText(doc, onProgress)
    const text = pages.map((p) => p.text).join('\n\n').trim()
    if (!text) throw new Error('No selectable text in this PDF (it may be a scan). Try the OCR tools first.')
    return text
  }
  const raw = await file.text()
  if (e === 'html' || e === 'htm') {
    const doc = new DOMParser().parseFromString(raw, 'text/html')
    doc.querySelectorAll('script, style, noscript').forEach((n) => n.remove())
    return (doc.body?.innerText || doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
  }
  return raw.replace(/\r\n?/g, '\n')
}

/**
 * Text input with Paste / Open file / Sample / Clear and drag-and-drop of files.
 * textInput({rows, placeholder, value, sample, onInput(text), label, accept, hint}) -> {el, ta, get(), set(text), focus()}
 */
export function textInput(opts = {}) {
  const { rows = 10, placeholder = 'Type or paste your text here...', value = '', sample, onInput, label = 'Text', accept = TEXT_ACCEPT, hint, extra = [] } = opts
  const ta = textarea({ rows, placeholder, value, 'aria-label': label })
  const count = h('span', { class: 'tw-count' })
  const fire = () => { count.textContent = counts(ta.value); onInput?.(ta.value) }
  const set = (v, silent) => { ta.value = v; if (!silent) fire(); else count.textContent = counts(v) }
  const loadFile = async (file) => {
    try {
      const text = await readTextFile(file)
      set(text)
      toast(`Loaded ${file.name}`, 'success')
    } catch (e) {
      toast(e.message || 'Could not read that file', 'error')
    }
  }
  const picker = h('input', { type: 'file', accept, hidden: true, onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f) } })
  const el = h('div', {
    class: 'tw-input',
    ondragover: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('drag') } },
    ondragleave: () => el.classList.remove('drag'),
    ondrop: (e) => { const f = e.dataTransfer?.files?.[0]; el.classList.remove('drag'); if (f) { e.preventDefault(); loadFile(f) } },
  },
  ta,
  h('div', { class: 'tw-bar' },
    button('Paste', { icon: 'clipboard-paste', size: 'sm', variant: 'secondary', onClick: async () => {
      try { set(await navigator.clipboard.readText()); ta.focus() } catch { toast('Clipboard access was blocked. Press Ctrl+V in the box instead.', 'error') }
    } }),
    button('Open file', { icon: 'file-up', size: 'sm', variant: 'secondary', onClick: () => picker.click(), title: 'Open a .txt, .md, .docx or .pdf file' }),
    sample && button('Try a sample', { icon: 'wand-sparkles', size: 'sm', variant: 'ghost', onClick: () => { set(sample); ta.focus({ preventScroll: true }) } }),
    ...extra,
    button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { set(''); ta.focus() } }),
    h('span', { class: 'grow' }), count),
  hint && h('div', { class: 'tw-sub' }, hint), picker)
  ta.addEventListener('input', fire)
  count.textContent = counts(value)
  return { el, ta, get: () => ta.value, set, focus: () => ta.focus({ preventScroll: true }) }
}
const counts = (t) => { const w = wordCount(t); return `${w.toLocaleString()} ${w === 1 ? 'word' : 'words'} · ${t.length.toLocaleString()} characters` }

// ---------------------------------------------------------------- text analysis

export const wordCount = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length

const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'no', 'fig', 'inc', 'ltd', 'co', 'u.s', 'u.k', 'a.m', 'p.m', 'approx', 'dept', 'est',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'mt', 'gen', 'col', 'lt', 'capt', 'sgt', 'rev', 'hon', 'ph.d', 'vol', 'pp', 'ed', 'al', 'cf', 'ca'])

/**
 * Split text into sentences with their character ranges: [{text, start, end}].
 * Handles abbreviations (Dr., e.g.), decimals, initials, quotes, Devanagari danda and CJK full stops, blank lines and list items.
 */
export function sentences(text) {
  const out = []
  let start = 0
  const push = (end) => {
    let s = start, e = end
    while (s < e && /\s/.test(text[s])) s++
    while (e > s && /\s/.test(text[e - 1])) e--
    if (e > s && /[\p{L}\p{N}]/u.test(text.slice(s, e))) out.push({ text: text.slice(s, e), start: s, end: e })
    start = end
  }
  const re = /[.!?…।。！？]+["'”’)\]»]*(?=\s|$)|\n[ \t]*\n+|\n(?=[ \t]*(?:[-*•–]|\d{1,3}[.)])\s)/g
  let m
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    const tok = m[0]
    if (tok[0] === '.' ) {
      const before = text.slice(Math.max(0, m.index - 12), m.index)
      const last = (before.match(/([\p{L}.]+)$/u) || [])[1] || ''
      const low = last.toLowerCase().replace(/^\.+/, '')
      const next = (text.slice(end).match(/^\s*(\S)/) || [])[1]
      if (ABBR.has(low) || (/^\p{Lu}$/u.test(last) && next && /\p{Lu}/u.test(next)) || (tok === '.' && next && /\p{Ll}/u.test(next) && !/\n/.test(text.slice(end, end + 3)) && !/[.!?]$/.test(last))) continue
    }
    push(end)
  }
  push(text.length)
  return out
}

/** Words with offsets: [{w, start, end}] */
export function wordsWithRanges(text) {
  const out = []
  const re = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*(?:-[\p{L}\p{N}]+)*/gu
  let m
  while ((m = re.exec(text))) out.push({ w: m[0], start: m.index, end: m.index + m[0].length })
  return out
}

const SYL_EXC = {
  the: 1, are: 1, were: 1, there: 1, where: 1, here: 1, some: 1, come: 1, done: 1, one: 1, once: 1, give: 1, live: 1, have: 1, love: 1, above: 1, move: 1, prove: 1, shoes: 1, eye: 1, eyes: 1,
  business: 2, every: 2, evening: 2, different: 3, interesting: 3, comfortable: 3, favorite: 3, favourite: 3, vegetable: 3, camera: 3, family: 3, general: 3, several: 3, chocolate: 3,
  area: 3, idea: 3, real: 1, really: 3, being: 2, doing: 2, going: 2, seeing: 2, poem: 2, poet: 2, quiet: 2, science: 2, society: 4, variety: 4, create: 2, created: 3, creation: 3, creative: 3,
  video: 3, radio: 3, studio: 3, ratio: 3, period: 3, serious: 3, various: 3, previous: 3, obvious: 3, curious: 3, furious: 3, experience: 4, material: 4, especially: 4, usually: 4,
  actually: 4, eventually: 5, immediately: 5, university: 5, technology: 4, particularly: 5, people: 2, little: 2, middle: 2, simple: 2, example: 3, table: 2, able: 2, bible: 2,
  beautiful: 3, tuesday: 2, wednesday: 3, february: 4, library: 3, probably: 3, average: 3, evidence: 3, quickly: 2, easily: 3, however: 3, whatever: 3, everyone: 3, everything: 3,
  somewhere: 2, anyone: 3, anything: 3, nothing: 2, something: 2, together: 3, another: 3, animal: 3, medicine: 3, memory: 3, history: 3, theory: 3, energy: 3, strategy: 3, category: 4,
  already: 3, always: 2, answer: 2, almost: 2, around: 2, because: 2, before: 2, begin: 2, between: 2, build: 1, built: 1, caught: 1, chosen: 2, coming: 2, cover: 2, early: 2, earth: 1,
  enough: 2, friend: 1, friends: 1, great: 1, heard: 1, heart: 1, house: 1, human: 2, important: 3, increase: 2, language: 2, machine: 2, minute: 2, money: 2, mother: 2, number: 2,
  often: 2, only: 2, other: 2, over: 2, paper: 2, person: 2, place: 1, point: 1, power: 2, process: 2, product: 2, program: 2, question: 2, reason: 2, remember: 3, research: 2, school: 1,
  second: 2, should: 1, sentence: 3, special: 2, story: 2, strong: 1, system: 2, today: 2, though: 1, thought: 1, through: 1, toward: 2, understand: 3, until: 2, usual: 3, water: 2, whole: 1, world: 1, would: 1, write: 1, written: 2, young: 1,
}

/** Rough English syllable counter (a regex heuristic plus a table of common exceptions). */
export function syllables(word) {
  let w = word.toLowerCase().replace(/[’']/g, '').replace(/[^a-z]/g, '')
  if (!w) return /[\p{L}]/u.test(word) ? Math.max(1, Math.round(word.length / 2.4)) : 0
  if (SYL_EXC[w] != null) return SYL_EXC[w]
  if (w.length <= 3) return 1
  w = w.replace(/(?:[^laeiouy]es|[^laeiouyt]ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  let n = (w.match(/[aeiouy]{1,2}/g) || []).length
  n += (w.match(/[^aeiou]ia|[^aeiou]io(?!n|u)|[^cgq]ua(?![rn])|eo(?!u)|iu|uo|uie|[^g]uity|ia(?=l)/g) || []).length
  return Math.max(1, n)
}

export const STOP = new Set(('a about above after again against all also am an and any are aren as at be because been before being below between both but by can cannot could did do does doing don down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up upon us very was we were what when where which while who whom why will with would you your yours yourself yourselves also however thus therefore may might must shall one two get got like said say says many much even still yet per via etc can\'t won\'t didn\'t doesn\'t isn\'t').split(/\s+/))

/** A ~330 word sample article used by tools that offer "Try a sample". */
export const SAMPLE_ARTICLE = `The rise of remote work has changed how companies think about offices. Before 2020, most employees commuted to a central workplace every day, and managers judged productivity largely by who was visible at their desk. When lockdowns forced millions of people to work from home, many firms expected a drop in output. Instead, surveys showed that a large share of staff were just as productive, and often happier, without the daily commute.

Employees quickly discovered the benefits. Without long journeys, they gained several hours each week for family, exercise and rest. Companies saved money on rent and utilities, and some were able to hire talented people who lived far from any major city. Research from several universities found that flexible schedules were linked with lower stress and better retention, which is expensive to fix once good people leave.

However, remote work is not perfect. Many workers report feeling isolated, and younger employees in particular miss the casual mentoring that happens in a shared space. Spontaneous conversations at the coffee machine often spark ideas that scheduled video calls rarely produce. Managers also struggle to build team culture when new colleagues have never met in person. Some tasks, such as hands-on training or sensitive negotiations, are still easier face to face.

As a result, a hybrid model has become the most popular compromise. Staff spend two or three days in the office for collaboration and the rest at home for focused work. Companies are redesigning their buildings with fewer rows of desks and more meeting rooms, quiet pods and social areas. Technology firms were the first to adopt this approach, but banks, insurers and government agencies are now following.

The long-term effects are still unclear. Cities that relied on office workers to support cafes and shops must adapt, while smaller towns may gain new residents. What is certain is that the old idea of a fixed nine-to-five routine is fading. The most successful organisations will be those that trust their people, measure results rather than hours, and keep listening as the way we work continues to change.`

