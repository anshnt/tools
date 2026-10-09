// Shared building blocks for the developer tools: a code editor with line numbers, a highlighted read-only code view,
// error frames, chips, animated stats and `studio()`, the two-pane "input -> output" shell most tools are built on.
// Nothing here touches the DOM at import time, so pure helpers can be unit tested in Node.
import { h, icon, button, copyText, download, toast, formatBytes, formatNumber, clear, errorMessage, segmented, toggle, select, stats, alert } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import { CSS } from './_style.js'

export const jsd = (path) => `https://cdn.jsdelivr.net/npm/${path}`
const once = new Map()
/** Load something heavy once; a failed load is retried next time. */
export function loadOnce(key, fn) {
  if (!once.has(key)) once.set(key, fn().catch((e) => { once.delete(key); throw Object.assign(new Error(`Could not load ${key}. Check your connection and try again.`), { cause: e }) }))
  return once.get(key)
}
export const hljs = () => loadOnce('the highlighter', () => import(jsd('highlight.js@11.11.1/lib/common/+esm')).then((m) => m.default))

export function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById('df-styles')) return
  document.head.append(h('style', { id: 'df-styles' }, CSS))
}

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
export const countLines = (s) => { let n = 1; for (let i = s.indexOf('\n'); i !== -1; i = s.indexOf('\n', i + 1)) n++; return n }
export const byteLength = (s) => new TextEncoder().encode(s).length

/** An error with an optional position, shown as a code frame. actions: [{label, icon, onClick(ctx)}] */
export class DevError extends Error {
  constructor(message, o = {}) {
    super(message)
    this.name = 'DevError'
    this.line = o.line
    this.col = o.col
    this.pos = o.pos
    this.hint = o.hint
    this.actions = o.actions
  }
}
/** 1-based line and column of a character offset. */
export function lineCol(text, pos) {
  pos = Math.max(0, Math.min(pos, text.length))
  let line = 1, last = -1
  for (let i = text.indexOf('\n'); i !== -1 && i < pos; i = text.indexOf('\n', i + 1)) { line++; last = i }
  return { line, col: pos - last }
}
/** Character offset of a 1-based line and column. */
export function offsetOf(text, line, col = 1) {
  let pos = 0
  for (let l = 1; l < line; l++) {
    const i = text.indexOf('\n', pos)
    if (i === -1) return text.length
    pos = i + 1
  }
  return Math.min(text.length, pos + Math.max(0, col - 1))
}

/** A small code frame: a few lines around the error with a caret under the column. */
export function frame(text, line, col = 1, context = 2) {
  const lines = text.split('\n')
  const from = Math.max(1, line - context), to = Math.min(lines.length, line + context)
  const rows = []
  for (let n = from; n <= to; n++) {
    let t = (lines[n - 1] || '').replace(/\r$/, '').replace(/\t/g, '  ')
    let c = col
    if (n === line && col > 1) c = col + (((lines[n - 1] || '').slice(0, col - 1).match(/\t/g) || []).length)
    let shift = 0
    if (t.length > 140) {
      const start = n === line ? Math.max(0, Math.min(t.length - 140, c - 60)) : 0
      shift = start
      t = (start > 0 ? '...' : '') + t.slice(start, start + 140) + (start + 140 < t.length ? '...' : '')
      if (start > 0) shift -= 3
    }
    rows.push(h('div', { class: ['df-fl', n === line && 'bad'] }, h('span', { class: 'n' }, n), t))
    if (n === line) rows.push(h('div', { class: 'df-fl caret' }, h('span', { class: 'n' }), `${' '.repeat(Math.max(0, c - 1 - shift))}^`))
  }
  return h('div', { class: 'df-fr-box', role: 'img', 'aria-label': `Code around line ${line}, column ${col}` }, rows)
}

// ---------- highlighting ----------
const JSON_TOKEN = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])/g
/** Fast JSON highlighter (no library). Returns HTML. */
export function highlightJson(text) {
  let out = '', last = 0
  JSON_TOKEN.lastIndex = 0
  for (let m; (m = JSON_TOKEN.exec(text));) {
    if (m.index > last) out += esc(text.slice(last, m.index))
    last = JSON_TOKEN.lastIndex
    const cls = m[1] ? (m[2] ? 'tk-k' : 'tk-s') : m[3] ? 'tk-n' : m[4] ? 'tk-b' : m[5] ? 'tk-nl' : 'tk-p'
    if (m[1] && m[2]) out += `<span class="tk-k">${esc(m[1])}</span><span class="tk-p">${esc(m[2])}</span>`
    else out += `<span class="${cls}">${esc(m[0])}</span>`
  }
  return out + esc(text.slice(last))
}
const HL_LANG = { html: 'xml', xml: 'xml', vue: 'xml', js: 'javascript', javascript: 'javascript', jsx: 'javascript', ts: 'typescript', typescript: 'typescript', tsx: 'typescript', css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', markdown: 'markdown', yaml: 'yaml', yml: 'yaml', graphql: 'graphql', sql: 'sql', diff: 'diff', shell: 'shell', plain: 'plaintext' }
const HL_MAX = 350_000
/** Highlight code to HTML. JSON is synchronous; everything else uses highlight.js (loaded once). */
export async function highlight(text, lang) {
  if (lang === 'json') return text.length > HL_MAX * 2 ? esc(text) : highlightJson(text)
  const name = HL_LANG[lang]
  if (!name || name === 'plaintext' || text.length > HL_MAX) return esc(text)
  try {
    return (await hljs()).highlight(text, { language: name, ignoreIllegals: true }).value
  } catch {
    return esc(text)
  }
}

// ---------- small widgets ----------
export function chip(kind, text) { return h('span', { class: ['df-chip', kind], role: 'status' }, text) }
export function opt(label, control) { return h('div', { class: 'df-opt' }, label && h('span', { class: 'df-ol' }, label), control) }
export function bar(...kids) { return h('div', { class: 'df-bar' }, kids) }
export const spacer = () => h('span', { class: 'df-spacer' })
export function kbdHint() { return h('kbd', { 'aria-hidden': 'true' }, isMac() ? '⌘↵' : 'Ctrl+↵') }

/** Animate a number up to its final value (final text is always set, even in background tabs). */
export function countUp(el, to, fmt = (n) => formatNumber(n, 0), ms = 650) {
  if (!Number.isFinite(to) || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(to) < 3) { el.textContent = fmt(to); return }
  const t0 = performance.now()
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / ms)
    el.textContent = fmt(Math.round(to * (1 - (1 - k) ** 3)))
    if (k < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  setTimeout(() => { el.textContent = fmt(to) }, ms + 80)
}
/** Stat tiles with count-up numbers. items: [{label, value: number | string, fmt?, hint, accent, danger}] */
export function statTiles(items) {
  const el = stats(items.map((s) => ({ ...s, value: typeof s.value === 'number' ? '' : s.value })))
  el.classList.add('df-stats')
  const tiles = el.querySelectorAll('.stat .value')
  items.forEach((s, i) => { if (typeof s.value === 'number') countUp(tiles[i], s.value, s.fmt) })
  return el
}
/** A check button: copies, then shows a green tick for a moment. */
export function copyBtn(getText, label = 'Copy', opts = {}) {
  const btn = button(label, { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: opts.ariaLabel || label || 'Copy', ...opts })
  btn.addEventListener('click', async () => {
    if (await copyText(typeof getText === 'function' ? getText() : getText)) {
      const old = [...btn.childNodes]
      btn.classList.add('df-copied')
      btn.replaceChildren(icon('check'), ...(label ? [h('span', 'Copied')] : []))
      setTimeout(() => { btn.classList.remove('df-copied'); btn.replaceChildren(...old) }, 1500)
    }
  })
  return btn
}
export function flash(el, kind) {
  const cls = kind === 'err' ? 'df-flash-err' : 'df-flash-ok'
  el.classList.remove('df-flash-ok', 'df-flash-err')
  void el.offsetWidth
  el.classList.add(cls)
  setTimeout(() => el.classList.remove(cls), 1000)
  if (kind === 'err') { el.classList.remove('df-shake'); void el.offsetWidth; el.classList.add('df-shake'); setTimeout(() => el.classList.remove('df-shake'), 450) }
}
export const aurora = () => h('div', { class: 'df-aurora', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))
/** Row of example chips. Hidden by the caller once the user has input. */
export function samples(list, onPick) {
  return h('div', { class: 'df-samples' }, h('span', { class: 'df-ol' }, icon('sparkles'), 'Try an example'),
    list.map((s) => h('button', { type: 'button', class: 'df-sample', onclick: () => onPick(s) }, s.icon ? icon(s.icon) : null, s.label)))
}
export const emptyOverlay = (ic, text) => h('div', { class: 'df-empty-ov' }, h('div', { class: 'df-orb' }, icon(ic)), h('div', text))

function gutterText(n) { return n > 250_000 ? '' : Array.from({ length: n }, (_, i) => i + 1).join('\n') }

/** Wire shared behaviour of editor and code view: line numbers that follow the scroll. */
function lineNumbers(scroller) {
  const gi = h('div', { class: 'df-gi' })
  const gutter = h('div', { class: 'df-gutter', 'aria-hidden': 'true' }, gi)
  const layerG = h('div', { class: 'df-layer' })
  let count = 0
  const api = {
    gutter, layerG,
    setCount(n) {
      if (n === count) return
      count = n
      gi.textContent = gutterText(n)
      gutter.style.setProperty('--df-gw', `${String(n).length}ch`)
    },
    sync() { gi.style.transform = `translateY(${-scroller.scrollTop}px)`; layerG.firstChild && (layerG.firstChild.style.transform = `translateY(${-scroller.scrollTop}px)`) },
  }
  gutter.append(layerG)
  return api
}
const lineHeight = (el) => parseFloat(getComputedStyle(el).lineHeight) || 21
const padTop = (el) => parseFloat(getComputedStyle(el).paddingTop) || 12

/**
 * editor({title, ic, placeholder, accept, onInput(value), onRun(), indent: () => '  ', autoIndent, maxBytes, onFile(file), onLarge(file), actions})
 * -> {el, ta, value, set(text, {emit}), focus(), mark(line), clearMark(), goto(line, col), fileName}
 */
export function editor(o = {}) {
  injectStyles()
  const { title = 'Input', ic = 'file-input', placeholder = '', accept = '', maxBytes = 8_000_000, indent = () => '  ', autoIndent = false, actions = ['upload', 'paste', 'clear'] } = o
  const ta = h('textarea', { class: 'df-ta', spellcheck: false, wrap: 'off', placeholder, autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', 'aria-label': title })
  const nums = lineNumbers(ta)
  const markLayer = h('div', { class: 'df-layer' })
  const pos = h('b', 'Ln 1, Col 1')
  const stat = h('span')
  const foot = h('div', { class: 'df-foot' }, pos, stat, h('span', { class: 'df-fr', title: 'Press Esc, then Tab, to move focus out of the editor' }, 'Tab indents'))
  const api = { ta, fileName: '' }
  let escaped = false

  function refresh() {
    const v = ta.value
    const n = countLines(v)
    nums.setCount(n)
    stat.textContent = v ? `${formatNumber(v.length, 0)} chars · ${formatNumber(n, 0)} lines${v.length > 2000 ? ` · ${formatBytes(byteLength(v))}` : ''}` : 'empty'
    updPos()
  }
  function updPos() {
    const before = ta.value.slice(0, ta.selectionStart)
    const lc = lineCol(before, before.length)
    pos.textContent = `Ln ${lc.line}, Col ${lc.col}`
  }
  async function loadFile(file) {
    if (file.size > maxBytes) { if (o.onLarge) return o.onLarge(file); return toast(`That file is ${formatBytes(file.size)}. This editor handles up to ${formatBytes(maxBytes)}.`, 'error') }
    const text = (await file.text()).replace(/^﻿/, '')
    if (text.includes('\u0000')) return toast('That looks like a binary file, not text.', 'error')
    api.fileName = file.name
    api.set(text, { emit: true })
    o.onFile?.(file)
    toast(`Loaded ${file.name}`, 'success')
  }
  function replace(start, end, text, selStart, selEnd) {
    ta.focus()
    ta.setSelectionRange(start, end)
    let ok = false
    try { ok = document.execCommand('insertText', false, text) } catch { /* fall through */ }
    if (!ok) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })) }
    ta.setSelectionRange(selStart, selEnd)
  }
  function indentSelection(outdent) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, unit = indent()
    if (s === e && !outdent) return replace(s, e, unit, s + unit.length, s + unit.length)
    const ls = v.lastIndexOf('\n', s - 1) + 1
    let le = e > s && v[e - 1] === '\n' ? e - 1 : v.indexOf('\n', e)
    if (le === -1) le = v.length
    let first = 0, total = 0
    const block = v.slice(ls, le).split('\n').map((line, i) => {
      let out
      if (outdent) {
        const m = line.match(unit === '\t' ? /^(\t| {1,4})/ : new RegExp(`^ {1,${unit.length}}|^\\t`))
        out = m ? line.slice(m[0].length) : line
      } else out = unit + line
      const d = out.length - line.length
      if (i === 0) first = d
      total += d
      return out
    }).join('\n')
    replace(ls, le, block, Math.max(ls, s + first), Math.max(ls, e + total))
  }
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { escaped = true; return }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); o.onRun?.(); return }
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey && !escaped) { e.preventDefault(); indentSelection(e.shiftKey); return }
    if (e.key === 'Enter' && autoIndent && !e.shiftKey && !e.altKey && ta.selectionStart === ta.selectionEnd) {
      const v = ta.value, s = ta.selectionStart
      const lineStart = v.lastIndexOf('\n', s - 1) + 1
      const ws = v.slice(lineStart, s).match(/^[ \t]*/)[0]
      const extra = /[{[(]\s*$/.test(v.slice(lineStart, s)) ? indent() : ''
      if (ws || extra) { e.preventDefault(); replace(s, s, `\n${ws}${extra}`, s + 1 + ws.length + extra.length, s + 1 + ws.length + extra.length) }
    }
  })
  ta.addEventListener('blur', () => { escaped = false })
  ta.addEventListener('input', () => { refresh(); api.clearMark(); o.onInput?.(ta.value) })
  ta.addEventListener('scroll', () => { nums.sync(); if (markLayer.firstChild) markLayer.firstChild.style.transform = `translateY(${-ta.scrollTop}px)` })
  for (const ev of ['keyup', 'click', 'focus']) ta.addEventListener(ev, updPos)

  const acts = {
    upload: () => button('Open', { icon: 'file-up', variant: 'ghost', size: 'sm', ariaLabel: 'Open a file', title: 'Open a file', onClick: async () => { const [f] = await pickFiles({ accept }); if (f) loadFile(f) } }),
    paste: () => button('Paste', { icon: 'clipboard-paste', variant: 'ghost', size: 'sm', ariaLabel: 'Paste from clipboard', title: 'Paste from clipboard', onClick: async () => {
      try { api.set(await navigator.clipboard.readText(), { emit: true }); ta.focus() } catch { toast('Clipboard access was blocked. Click in the editor and press Ctrl+V instead.', 'error') }
    } }),
    clear: () => button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', ariaLabel: 'Clear', title: 'Clear', onClick: () => { api.set('', { emit: true }); api.fileName = ''; ta.focus() } }),
    copy: () => copyBtn(() => ta.value, 'Copy'),
  }
  const el = h('section', {
    class: 'df-frame', 'aria-label': title,
    ondragover: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('df-drag') } },
    ondragleave: (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('df-drag') },
    ondrop: (e) => { el.classList.remove('df-drag'); const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); loadFile(f) } },
  },
  h('div', { class: 'df-head' }, h('div', { class: 'df-title' }, icon(ic), h('span', title)), h('div', { class: 'df-actions' }, o.headExtra || null, actions.map((a) => acts[a]?.()))),
  h('div', { class: 'df-body' }, nums.gutter, h('div', { class: 'df-main' }, markLayer, ta)),
  foot)
  // marks sit in their own layer so they scroll with the text
  const markInner = h('div'); markLayer.append(markInner)
  const gmarkInner = h('div'); nums.layerG.append(gmarkInner)

  Object.defineProperty(api, 'value', { get: () => ta.value, set: (v) => api.set(v) })
  Object.assign(api, {
    el,
    set(text, { emit = false } = {}) {
      ta.value = text
      api.clearMark()
      refresh()
      ta.scrollTop = 0
      nums.sync()
      if (emit) o.onInput?.(text)
    },
    focus: () => ta.focus(),
    mark(line) {
      api.clearMark()
      const top = padTop(ta) + (line - 1) * lineHeight(ta)
      markInner.append(h('div', { class: 'df-mark error', style: { top: `${top}px` } }))
      gmarkInner.append(h('div', { class: 'df-gmark', style: { top: `${top}px` } }))
      nums.sync()
      ta.scrollLeft = 0
    },
    clearMark() { markInner.replaceChildren(); gmarkInner.replaceChildren() },
    /** Select the error position (or just scroll the line into view). */
    goto(line, col = 1, len = 1) {
      const start = offsetOf(ta.value, line, col)
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(start, Math.min(ta.value.length, start + len))
      const lh = lineHeight(ta)
      ta.scrollTop = Math.max(0, padTop(ta) + (line - 1) * lh - ta.clientHeight / 2)
      nums.sync()
      updPos()
    },
  })
  nums.setCount(1)
  refresh()
  return api
}

/**
 * codeView({title, ic, filename: () => 'out.json', mime, empty: [icon, text], actions})
 * -> {el, set(text, lang), text, setStale(bool), foot}
 * Highlights in place, truncates huge outputs for display (copy and download always use the full text).
 */
export function codeView(o = {}) {
  injectStyles()
  const { title = 'Output', ic = 'sparkles', mime = 'text/plain', empty = ['sparkles', 'The result appears here'] } = o
  const code = h('code')
  const pre = h('pre', { class: 'df-pre', tabindex: 0, 'aria-label': title, role: 'region' }, code)
  const nums = lineNumbers(pre)
  const emptyEl = emptyOverlay(empty[0], empty[1])
  const sizeEl = h('b', '0 lines')
  const noteEl = h('span')
  const api = { text: '', filename: o.filename || (() => 'output.txt') }
  const body = h('div', { class: 'df-body' }, nums.gutter, h('div', { class: 'df-main' }, pre, emptyEl))
  const chipHost = h('span')
  const titleEl = h('span', title)
  const el = h('section', { class: 'df-frame', 'aria-label': title },
    h('div', { class: 'df-head' }, h('div', { class: 'df-title' }, icon(ic), titleEl, chipHost),
      h('div', { class: 'df-actions' }, o.headExtra || null,
        button('Download', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: 'Download', title: 'Download', onClick: () => api.text && download(api.text, typeof api.filename === 'function' ? api.filename() : api.filename, mime) }),
        copyBtn(() => api.text, 'Copy'))),
    body, h('div', { class: 'df-foot' }, sizeEl, noteEl))
  pre.addEventListener('scroll', nums.sync)
  let token = 0
  const MAX_LINES = 30_000, MAX_CHARS = 2_500_000
  Object.assign(api, {
    el, pre,
    async set(text, lang = 'plain') {
      api.text = text
      const my = ++token
      emptyEl.hidden = !!text
      pre.scrollTop = 0
      const n = countLines(text)
      let shown = text, note = ''
      if (n > MAX_LINES || text.length > MAX_CHARS) {
        const cut = offsetOf(text, Math.min(n, MAX_LINES) + 1)
        shown = text.slice(0, Math.min(cut, MAX_CHARS)).replace(/\n[^\n]*$/, '')
        note = `Showing the first ${formatNumber(countLines(shown), 0)} lines. Copy and Download use the full result.`
      }
      nums.setCount(text ? countLines(shown) : 1)
      sizeEl.textContent = text ? `${formatNumber(n, 0)} lines · ${formatBytes(byteLength(text))}` : '0 lines'
      noteEl.textContent = note
      code.textContent = shown
      pre.classList.remove('df-fresh')
      if (!shown) return
      const html = await highlight(shown, lang)
      if (my !== token) return
      code.innerHTML = html
      void pre.offsetWidth
      pre.classList.add('df-fresh')
    },
    setStale: (b) => body.classList.toggle('df-stale', !!b),
    setTitle: (t) => { titleEl.textContent = t },
    setChip(c) { chipHost.replaceChildren(...(c ? [c] : [])) },
  })
  return api
}

/**
 * studio(config) - the two-pane shell: input editor, live output, error card with a code frame, example chips, stats and notices.
 *   process(text, {manual}) -> {output, lang, chip, stats: [...], notice: {type, text}, verdict: {title, text}} | throws DevError
 */
export function studio(c) {
  injectStyles()
  const cfg = { inputTitle: 'Input', outputTitle: 'Output', inputIcon: 'file-input', outputIcon: 'sparkles', runLabel: 'Format', runIcon: 'wand-sparkles', accept: '', wide: false, ...c }
  const errHost = h('div'), noteHost = h('div'), statHost = h('div'), verdictHost = h('div')
  let hadError = false, hadOutput = false, seq = 0, timer = 0
  const ed = editor({
    title: cfg.inputTitle, ic: cfg.inputIcon, placeholder: cfg.placeholder, accept: cfg.accept, indent: cfg.indent, autoIndent: cfg.autoIndent ?? true, maxBytes: cfg.maxBytes,
    onInput: () => { sampleRow.hidden = !!ed.value; schedule() }, onRun: () => run(true), onFile: cfg.onFile,
  })
  const view = codeView({ title: cfg.outputTitle, ic: cfg.outputIcon, mime: cfg.mime || 'text/plain', empty: cfg.empty || ['sparkles', 'The result appears here as you type'],
    filename: () => (typeof cfg.filename === 'function' ? cfg.filename(ed.fileName) : cfg.filename || 'output.txt'),
    headExtra: button('Use as input', { icon: 'corner-up-left', variant: 'ghost', size: 'sm', ariaLabel: 'Use the output as the new input', title: 'Use the output as the new input', onClick: () => { if (view.text) { ed.set(view.text, { emit: true }); ed.focus() } } }) })
  const sampleRow = cfg.samples?.length ? samples(cfg.samples, (s) => { ed.set(s.text, { emit: false }); sampleRow.hidden = true; cfg.onSample?.(s); run(true) }) : h('div', { hidden: true })
  const runBtn = button(cfg.runLabel, { icon: cfg.runIcon, variant: 'primary', size: 'sm', onClick: () => run(true) })
  runBtn.append(kbdHint())
  const optBar = h('div', { class: ['df-bar', cfg.sticky !== false && 'df-sticky'] }, cfg.options || [], spacer(), cfg.noRun ? null : runBtn)

  const delayFor = () => { const n = ed.value.length; return n > 1_000_000 ? 900 : n > 150_000 ? 450 : 120 }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => run(false), delayFor()) }
  function reset() {
    view.set(''); view.setStale(false); view.setChip(null)
    clear(errHost); clear(noteHost); clear(statHost); clear(verdictHost)
    ed.clearMark(); hadError = false; hadOutput = false
  }
  async function run(manual) {
    clearTimeout(timer)
    const text = ed.value
    const my = ++seq
    if (!text.trim()) return reset()
    try {
      const r = await cfg.process(text, { manual })
      if (my !== seq) return
      show(r, manual)
    } catch (e) {
      if (my !== seq) return
      fail(e, manual)
    }
  }
  function show(r, manual) {
    const loud = manual || hadError || !hadOutput
    clear(errHost); ed.clearMark(); view.setStale(false)
    view.set(r.output ?? '', typeof cfg.outLang === 'function' ? cfg.outLang(r) : r.lang || cfg.outLang || 'plain')
    view.setChip(r.chip ? chip('ok', r.chip) : null)
    clear(noteHost, r.notice ? h('div', { class: 'df-note' }, alert(r.notice.type || 'info', r.notice.text)) : null)
    clear(statHost, r.stats?.length ? statTiles(r.stats) : null)
    clear(verdictHost, r.verdict ? h('div', { class: 'df-verdict ok' }, h('div', { class: 'df-vi' }, icon('check')), h('div', h('h3', r.verdict.title), h('p', r.verdict.text))) : null)
    if (loud) flash(view.el, 'ok')
    hadError = false; hadOutput = true
    cfg.afterShow?.(r)
  }
  function fail(e, manual) {
    if (!(e instanceof DevError)) console.error(e)
    const text = ed.value
    const hasPos = e.line != null
    const line = e.line, col = e.col || 1
    if (hasPos) ed.mark(line)
    clear(noteHost); clear(statHost); clear(verdictHost)
    clear(errHost, h('div', { class: 'df-err', role: 'alert' },
      h('div', { class: 'df-err-head' }, icon('circle-alert'), h('div', { class: 'df-err-msg' }, e instanceof DevError ? e.message : errorMessage(e)), hasPos && h('span', { class: 'df-pos' }, `Line ${line}, column ${col}`)),
      hasPos && frame(text, line, col),
      e.hint && h('div', { class: 'df-hint' }, e.hint),
      (hasPos || e.actions?.length) && h('div', { class: 'df-errbtns' },
        hasPos && button('Jump to the error', { icon: 'crosshair', size: 'sm', onClick: () => ed.goto(line, col) }),
        (e.actions || []).map((a) => button(a.label, { icon: a.icon, size: 'sm', variant: a.primary ? 'primary' : 'secondary', onClick: () => a.onClick({ ed, view, run }) })))))
    if (hadOutput) view.setStale(true)
    view.setChip(chip('err', 'Error'))
    if (manual || !hadError) flash(view.el, 'err')
    hadError = true
  }

  const el = h('div', { class: 't-df' }, aurora(), optBar, sampleRow, verdictHost, errHost, noteHost,
    h('div', { class: ['df-grid', cfg.wide && 'df-wide-left'] }, ed.el, view.el), statHost)
  const api = { el, ed, view, run, schedule, reset, optBar, show, fail }
  return api
}

/** Focus an editor on devices with a real keyboard (phones would pop up the keyboard and hide the page). */
export function focusOnDesktop(ed) { if (matchMedia('(hover: hover) and (pointer: fine)').matches) ed.focus() }

// ---------- option helpers ----------
export const INDENTS = [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tab']]
export const indentUnit = (v) => (v === 'tab' ? '\t' : ' '.repeat(Number(v) || 2))
/** seg(options, value, onChange) with an aria label */
export const seg = (options, value, onChange, label) => segmented(options, value, onChange, label)
export { h, icon, button, toggle, select, segmented }
