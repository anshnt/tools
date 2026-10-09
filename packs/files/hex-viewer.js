// Hex viewer: any file as offset / hex / text rows with virtual scrolling (millions of rows), go to offset, search for hex or text,
// click or shift-click to select bytes, and a data inspector (integers, floats, text) for the selection. Nothing is uploaded.
import { h, clear, dropzone, button, alert, field, input, select, segmented, copyText, formatBytes, errorMessage, split, toast, onCleanup } from '../../lib/ui.js'
import { sniff, readRange, hex, hexBytes, entropy, takeHandoff, throwIfAborted, kindOfName, KINDS } from './_core.js'
import { useFx, card, kv, chip, chips, tile, injectStyle } from './_ui.js'

const ROW_H = 22
const MAX_H = 6_000_000
const SEARCH_CHUNK = 4 << 20
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).toUpperCase().padStart(2, '0'))
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

// ---------- Pure helpers (exported for tests) ----------
/** Parse a go-to value: 0x1F, 1Fh, plain decimal, or hex when it contains a-f. Returns a number or NaN. */
export function parseOffset(text) {
  const t = String(text).trim().replace(/[_\s,]/g, '')
  if (!t) return NaN
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t, 16)
  if (/^[0-9a-f]+h$/i.test(t)) return parseInt(t.slice(0, -1), 16)
  if (/^\d+$/.test(t)) return parseInt(t, 10)
  if (/^[0-9a-f]+$/i.test(t)) return parseInt(t, 16)
  return NaN
}

/** Build a byte pattern for searching. Returns {bytes: number[] (-1 = any byte), ci, error}. mode: hex | utf8 | utf16. */
export function buildPattern(mode, text, ci = false) {
  if (!text) return { error: 'Type something to search for.' }
  if (mode === 'hex') {
    const clean = text.replace(/0x/gi, ' ').trim()
    let toks = clean.split(/[\s,:;-]+/).filter(Boolean)
    if (toks.length === 1 && toks[0].length > 2 && /^[0-9a-f?]+$/i.test(toks[0])) toks = toks[0].match(/.{1,2}/g)
    const bytes = []
    for (const t of toks) {
      if (/^\?{1,2}$/.test(t)) bytes.push(-1)
      else if (/^[0-9a-f]{2}$/i.test(t)) bytes.push(parseInt(t, 16))
      else if (/^[0-9a-f]$/i.test(t)) bytes.push(parseInt(t, 16))
      else return { error: `"${t}" is not a hex byte. Use pairs like DE AD BE EF (and ?? for any byte).` }
    }
    return bytes.length ? { bytes, ci: false } : { error: 'No bytes to search for.' }
  }
  let bytes
  if (mode === 'utf16') { bytes = []; for (const ch of text) { const c = ch.codePointAt(0); if (c > 0xFFFF) { const v = c - 0x10000; for (const u of [0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF)]) bytes.push(u & 255, u >> 8) } else bytes.push(c & 255, c >> 8) } }
  else bytes = [...new TextEncoder().encode(text)]
  if (ci) bytes = bytes.map((b) => (b >= 65 && b <= 90 ? b + 32 : b))
  return { bytes, ci }
}

/** Index of the first match of pat in data at or after `from`, or -1. */
export function indexOfPattern(data, pat, from = 0, to = data.length) {
  const { bytes, ci } = pat
  const n = bytes.length
  const first = bytes[0]
  const lastStart = Math.min(to, data.length) - n
  for (let i = from; i <= lastStart; i++) {
    if (first >= 0 && !ci) { i = data.indexOf(first, i); if (i < 0 || i > lastStart) return -1 }
    let ok = true
    for (let j = 0; j < n; j++) {
      const p = bytes[j]
      if (p < 0) continue
      let d = data[i + j]
      if (ci && d >= 65 && d <= 90) d += 32
      if (d !== p) { ok = false; break }
    }
    if (ok) return i
  }
  return -1
}
function lastIndexOfPattern(data, pat, before) {
  const n = pat.bytes.length
  for (let i = Math.min(before, data.length - n); i >= 0; i--) {
    let ok = true
    for (let j = 0; j < n; j++) {
      const p = pat.bytes[j]
      if (p < 0) continue
      let d = data[i + j]
      if (pat.ci && d >= 65 && d <= 90) d += 32
      if (d !== p) { ok = false; break }
    }
    if (ok) return i
  }
  return -1
}

/** Find the next match at or after `from` (wraps once). Resolves {offset, wrapped} or null. */
export async function findNext(file, pat, from, { signal, onProgress } = {}) {
  const n = pat.bytes.length
  const scan = async (start, end) => {
    for (let pos = start; pos < end; pos += SEARCH_CHUNK) {
      throwIfAborted(signal)
      const data = await readRange(file, pos, Math.min(end, pos + SEARCH_CHUNK + n - 1))
      const i = indexOfPattern(data, pat, 0)
      if (i >= 0) return pos + i
      onProgress?.(pos / file.size)
    }
    return -1
  }
  let r = await scan(from, file.size)
  if (r >= 0) return { offset: r, wrapped: false }
  if (from > 0) { r = await scan(0, Math.min(file.size, from + n - 1)); if (r >= 0) return { offset: r, wrapped: true } }
  return null
}
/** Find the closest match that starts before `before` (wraps once). */
export async function findPrev(file, pat, before, { signal, onProgress } = {}) {
  const n = pat.bytes.length
  const scan = async (start, end) => {
    for (let pos = end; pos > start; pos -= SEARCH_CHUNK) {
      throwIfAborted(signal)
      const s = Math.max(start, pos - SEARCH_CHUNK)
      const data = await readRange(file, s, Math.min(file.size, pos + n - 1))
      const i = lastIndexOfPattern(data, pat, pos - s - 1)
      if (i >= 0) return s + i
      onProgress?.(1 - pos / file.size)
    }
    return -1
  }
  let r = await scan(0, before)
  if (r >= 0) return { offset: r, wrapped: false }
  r = await scan(Math.max(0, before), file.size)
  return r >= 0 ? { offset: r, wrapped: true } : null
}

const CSS = `
.fx-hv-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.fx-hv-bar .grow { flex: 1 1 220px; min-width: 0; }
.fx-hv-wrap { border: 1px solid var(--border); border-radius: 14px; background: var(--surface-2); overflow: hidden; }
.fx-hv { font: 13px/22px var(--mono); }
.fx-hv-head, .fx-hv .r { display: flex; gap: 14px; padding: 0 12px; white-space: pre; height: 22px; align-items: center; width: max-content; min-width: 100%; }
.fx-hv-head { background: var(--surface-3); color: var(--muted); font-weight: 600; font-size: 12px; border-bottom: 1px solid var(--border); }
.fx-hv-headwrap { overflow: hidden; }
.fx-hv-scroll { height: min(62vh, 560px); overflow: auto; position: relative; outline-offset: -2px; }
.fx-hv-sticky { position: sticky; top: 0; left: 0; overflow: hidden; width: max-content; min-width: 100%; }
.fx-hv .o { color: var(--muted); user-select: none; }
.fx-hv .x, .fx-hv-head .x { display: inline-flex; }
.fx-hv .x > span, .fx-hv-head .x > span { display: inline-block; width: 2ch; margin-right: 1ch; text-align: center; border-radius: 3px; cursor: pointer; }
.fx-hv .x > span:nth-child(8n), .fx-hv-head .x > span:nth-child(8n) { margin-right: 2ch; }
.fx-hv .x > span:last-child, .fx-hv-head .x > span:last-child { margin-right: 0; }
.fx-hv .t > span { display: inline-block; width: 1ch; text-align: center; cursor: pointer; }
.fx-hv .t { color: var(--text-2); }
.fx-hv .z { color: var(--muted); opacity: .55; }
.fx-hv .hi { color: color-mix(in srgb, var(--accent-2) 80%, var(--text)); }
.fx-hv .m { background: color-mix(in srgb, var(--warning) 32%, transparent); border-radius: 3px; }
.fx-hv .s { background: var(--accent); color: #fff; opacity: 1; border-radius: 3px; }
.fx-hv .r:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.fx-hv-status { display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: space-between; padding: 8px 12px; font-size: 12.5px; color: var(--muted); border-top: 1px solid var(--border); background: var(--surface); }
.fx-insp .row2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
`

export function mount(root, { signal }) {
  useFx()
  injectStyle('fx-hexview', CSS)
  let file = null, bpr = matchMedia('(max-width: 640px)').matches ? 8 : 16
  let cache = { start: 0, bytes: new Uint8Array(0) }
  let sel = null, pat = null, token = 0, raf = 0, searchCtl = null, le = true, rows = 1, spacerH = 0, fullH = 0
  const out = h('div', { class: 'stack' })
  const zone = dropzone({ multiple: false, label: 'Drop any file here or click to choose', hint: 'Opens instantly, even for very large files. Nothing is uploaded.', onFiles: ([f]) => open(f) })

  // ----- viewer skeleton -----
  const headEx = h('div', { class: 'x' })
  const headEl = h('div', { class: 'fx-hv-head' }, h('span', 'Offset'), headEx, h('span', 'Text'))
  const headWrap = h('div', { class: 'fx-hv-headwrap fx-hv' }, headEl)
  const content = h('div', { class: 'fx-hv fx-hv-sticky' })
  const spacer = h('div', { style: 'position:relative' }, content)
  const scroller = h('div', { class: 'fx-hv-scroll', tabindex: 0, role: 'region', 'aria-label': 'Hex view. Use the arrow keys, Page Up and Page Down to scroll.' }, spacer)
  const statusEl = h('div', { class: 'fx-hv-status', 'aria-live': 'polite' })
  const viewer = h('div', { class: 'fx-hv-wrap' }, headWrap, scroller, statusEl)

  const inspector = h('div', { class: 'fx-insp stack tight' }, h('div', { class: 'small muted' }, 'Click a byte to inspect it. Shift-click to select a range.'))
  const endian = segmented([['le', 'Little-endian'], ['be', 'Big-endian']], 'le', (v) => { le = v === 'le'; showInspector() }, 'Byte order')

  // ----- toolbar -----
  const goInput = input({ placeholder: '0x1F40 or 8000', 'aria-label': 'Go to offset', mono: true, onkeydown: (e) => { if (e.key === 'Enter') goTo() } })
  const goBtn = button('Go', { icon: 'corner-down-right', onClick: () => goTo() })
  const modeSel = select([['hex', 'Hex bytes'], ['utf8', 'Text (UTF-8)'], ['utf16', 'Text (UTF-16)']], 'utf8', () => { searchMsg.textContent = '' })
  const findInput = input({ placeholder: 'Find text, or hex like DE AD ?? EF', 'aria-label': 'Search', onkeydown: (e) => { if (e.key === 'Enter') search(e.shiftKey ? 'prev' : 'next') } })
  const ciBox = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Ignore case' })
  const searchMsg = h('div', { class: 'small', 'aria-live': 'polite' })
  const bprSel = select([[8, '8 bytes per row'], [16, '16 bytes per row'], [32, '32 bytes per row']], bpr, (v) => { bpr = +v; layout(true) })
  const toolbar = h('div', { class: 'stack tight' },
    h('div', { class: 'fx-hv-bar' }, h('div', { class: 'grow' }, field('Find', findInput)), field('Search as', modeSel),
      h('div', { class: 'row', style: 'padding-bottom:2px' }, button('Previous', { icon: 'chevron-up', onClick: () => search('prev') }), button('Next', { icon: 'chevron-down', variant: 'primary', onClick: () => search('next') }), h('label', { class: 'switch' }, ciBox, h('span', 'Ignore case')))),
    searchMsg,
    h('div', { class: 'fx-hv-bar' }, h('div', { style: 'width:190px' }, field('Go to offset', goInput)), h('div', { style: 'padding-bottom:2px' }, goBtn), field('Row width', bprSel)))

  root.append(h('div', { class: 'stack fx' }, zone, out))
  signal.addEventListener('abort', () => searchCtl?.abort())
  onCleanup(() => searchCtl?.abort())

  const handed = takeHandoff()
  if (handed) queueMicrotask(() => open(handed))

  // ----- open a file -----
  async function open(f) {
    searchCtl?.abort()
    file = f; sel = null; pat = null; cache = { start: 0, bytes: new Uint8Array(0) }
    zone.classList.add('compact')
    clear(out)
    if (!f.size) { out.append(alert('info', 'This file is empty (0 bytes), so there is nothing to show.')); file = null; return }
    const head = await readRange(f, 0, 4096)
    const det = sniff(head, f.name)
    const kind = KINDS[det?.kind && det.kind !== 'other' ? det.kind : kindOfName(f.name)] || KINDS.other
    clear(out, h('div', { class: 'row' }, tile(f.name), h('div', { style: 'min-width:0' }, h('div', { style: 'font-weight:600;overflow-wrap:anywhere' }, f.name),
      chips(chip(formatBytes(f.size), '', 'hard-drive'), chip(`${f.size.toLocaleString()} bytes`, '', 'binary'), det && chip(det.label, 'accent', 'fingerprint'), chip(`Entropy ${entropy(head).toFixed(2)}`, '', 'activity')))),
    card('Find and jump', 'search', '#3e63dd', toolbar),
    split(viewer, card('Data inspector', 'scan-search', '#12a594', h('div', { class: 'stack tight' }, endian, inspector)), 'wide-left'))
    layout(true)
    scroller.scrollTop = 0
    scroller.focus({ preventScroll: true })
  }

  // ----- layout and virtual scrolling -----
  function layout(redrawHead) {
    if (!file) return
    rows = Math.max(1, Math.ceil(file.size / bpr))
    fullH = rows * ROW_H
    spacerH = Math.min(fullH, MAX_H)
    spacer.style.height = spacerH + 'px'
    if (redrawHead) {
      clear(headEx, Array.from({ length: bpr }, (_, i) => h('span', HEX[i])))
      headEl.firstChild.style.minWidth = `${offW()}ch`
    }
    draw()
  }
  const offW = () => { if (!file) return 8; const d = (file.size - 1).toString(16).length; return d <= 4 ? 4 : d <= 6 ? 6 : d <= 8 ? 8 : 12 }
  const scale = () => { const vh = scroller.clientHeight || 400; return fullH > spacerH ? (fullH - vh) / (spacerH - vh) : 1 }
  const firstRow = () => Math.max(0, Math.min(rows - 1, Math.floor((scroller.scrollTop * scale()) / ROW_H)))
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw() }) }
  scroller.addEventListener('scroll', () => { headWrap.scrollLeft = scroller.scrollLeft; schedule() }, { passive: true })
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => file && draw()) : null
  ro?.observe(scroller)
  onCleanup(() => { ro?.disconnect(); cancelAnimationFrame(raf) })

  async function ensure(a, b) {
    if (cache.start <= a && cache.start + cache.bytes.length >= b) return
    const s = Math.max(0, a - 65536 - ((a - 65536) % bpr || 0))
    const e = Math.min(file.size, b + 65536)
    cache = { start: s, bytes: await readRange(file, s, e) }
  }

  async function draw() {
    if (!file) return
    const my = ++token
    const vh = scroller.clientHeight || 400
    const first = firstRow()
    const n = Math.ceil(vh / ROW_H) + 1
    const a = first * bpr
    const b = Math.min(file.size, (first + n) * bpr)
    try { await ensure(a, b) } catch (e) { if (my === token) toast(errorMessage(e), 'error'); return }
    if (my !== token) return
    const hits = new Set()
    if (pat) {
      const n2 = pat.bytes.length
      let i = indexOfPattern(cache.bytes, pat, a - cache.start - n2 > 0 ? a - cache.start - n2 : 0, Math.min(cache.bytes.length, b - cache.start + n2))
      let guard = 0
      while (i >= 0 && guard++ < 5000) { for (let k = 0; k < n2; k++) hits.add(cache.start + i + k); i = indexOfPattern(cache.bytes, pat, i + 1, Math.min(cache.bytes.length, b - cache.start + n2)) }
    }
    const w = offW()
    let html = ''
    for (let r = 0; r < n; r++) {
      const off = (first + r) * bpr
      if (off >= file.size) break
      let hx = '', tx = ''
      for (let i = 0; i < bpr; i++) {
        const o = off + i
        if (o >= file.size) { hx += '<span></span>'; continue }
        const v = cache.bytes[o - cache.start]
        const cls = (sel && o >= sel.a && o <= sel.b ? 's ' : '') + (hits.has(o) ? 'm ' : '') + (v === 0 ? 'z' : v >= 128 ? 'hi' : '')
        const ch = v >= 32 && v < 127 ? String.fromCharCode(v) : '.'
        hx += `<span data-o="${o}" class="${cls}">${HEX[v]}</span>`
        tx += `<span data-o="${o}" class="${cls}${v < 32 || v === 127 ? ' z' : ''}">${ESC[ch] || ch}</span>`
      }
      html += `<div class="r"><span class="o" style="min-width:${w}ch">${off.toString(16).toUpperCase().padStart(w, '0')}</span><span class="x">${hx}</span><span class="t">${tx}</span></div>`
    }
    content.style.height = `${n * ROW_H}px`
    content.innerHTML = html
    const endOff = Math.min(file.size, (first + n) * bpr)
    clear(statusEl, h('span', `Offset 0x${hex(a, w)} to 0x${hex(Math.max(a, endOff - 1), w)}`),
      h('span', sel ? `${sel.a === sel.b ? 'Byte' : `${(sel.b - sel.a + 1).toLocaleString()} bytes`} selected at 0x${hex(sel.a, 1)}` : `${Math.round((a / file.size) * 100)}% through the file`))
  }

  function scrollToOffset(o, { select: doSelect = null } = {}) {
    const row = Math.floor(o / bpr)
    const vh = scroller.clientHeight || 400
    const visible = Math.floor(vh / ROW_H)
    const first = Math.max(0, Math.min(rows - 1, row - Math.floor(visible / 3)))
    const sc = scale()
    const target = Math.round((first * ROW_H) / sc)
    if (doSelect) { sel = doSelect; showInspector() }
    if (Math.abs(scroller.scrollTop - target) < 1) draw()
    else scroller.scrollTop = target
  }

  // ----- selection and inspector -----
  content.addEventListener('click', (e) => {
    const el = e.target.closest('[data-o]')
    if (!el) return
    const o = +el.dataset.o
    if (e.shiftKey && sel) { const anchor = sel.anchor ?? sel.a; sel = { a: Math.min(anchor, o), b: Math.max(anchor, o), anchor } } else sel = { a: o, b: o, anchor: o }
    showInspector()
    draw()
  })

  async function showInspector() {
    if (!sel || !file) return
    const my = ++inspToken
    const take = Math.min(sel.b - sel.a + 1, 1 << 20)
    const bytes = await readRange(file, sel.a, sel.a + Math.max(8, Math.min(take, 64)))
    if (my !== inspToken) return
    const b8 = bytes.subarray(0, 8)
    const dv = new DataView(b8.buffer, b8.byteOffset, b8.byteLength)
    const have = (n) => b8.length >= n
    const sig = (get, n) => (have(n) ? get() : '')
    const rowsKv = [
      ['Offset', `0x${hex(sel.a, 1)}  (${sel.a.toLocaleString()})`],
      sel.b > sel.a ? ['Selection', `${(sel.b - sel.a + 1).toLocaleString()} bytes, to 0x${hex(sel.b, 1)}`] : null,
      ['Unsigned 8', String(b8[0])], ['Signed 8', String(dv.getInt8(0))], ['Binary', b8[0].toString(2).padStart(8, '0')],
      ['Unsigned 16', sig(() => dv.getUint16(0, le), 2)], ['Signed 16', sig(() => dv.getInt16(0, le), 2)],
      ['Unsigned 32', sig(() => dv.getUint32(0, le), 4)], ['Signed 32', sig(() => dv.getInt32(0, le), 4)],
      ['Unsigned 64', sig(() => dv.getBigUint64(0, le).toString(), 8)], ['Signed 64', sig(() => dv.getBigInt64(0, le).toString(), 8)],
      ['Float 32', sig(() => fmtFloat(dv.getFloat32(0, le)), 4)], ['Float 64', sig(() => fmtFloat(dv.getFloat64(0, le)), 8)],
      have(4) ? ['As Unix time', (() => { const t = dv.getUint32(0, le); return t >= 946684800 && t <= 2145916800 ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '' })()] : null,
    ].filter((r) => r && r[1] !== '' && r[1] !== undefined)
    const selBytes = await readRange(file, sel.a, sel.a + Math.min(take, 1 << 20))
    let asText, textLabel = selBytes.length > 1 ? 'Selection as text' : 'As text'
    try { asText = new TextDecoder('utf-8', { fatal: true }).decode(selBytes.subarray(0, 4000)) } catch { asText = new TextDecoder('windows-1252').decode(selBytes.subarray(0, 4000)); textLabel += ' (Latin-1)' }
    asText = asText.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '\u00b7')
    clear(inspector, kv(rowsKv.map(([k, v]) => [k, h('span', { class: 'fx-mono' }, v)])),
      h('div', { class: 'stack tight', style: 'margin-top:10px' },
        h('div', { class: 'small muted', style: 'font-weight:600' }, textLabel), h('div', { class: 'fx-mono', style: 'max-height:96px;overflow:auto' }, asText),
        h('div', { class: 'row' }, button('Copy hex', { size: 'sm', icon: 'copy', onClick: () => copyText(hexBytes(selBytes.subarray(0, 1 << 16))) }), button('Copy text', { size: 'sm', icon: 'copy', variant: 'ghost', onClick: () => copyText(new TextDecoder().decode(selBytes)) }))))
  }
  let inspToken = 0
  const fmtFloat = (n) => (Number.isFinite(n) ? String(+n.toPrecision(9)) : String(n))

  // ----- go to and search -----
  function goTo() {
    if (!file) return
    const o = parseOffset(goInput.value)
    if (!Number.isFinite(o)) { searchMsg.textContent = 'Type an offset such as 0x1F40 or 8000.'; searchMsg.style.color = 'var(--danger)'; return }
    const at = Math.min(o, file.size - 1)
    searchMsg.style.color = ''
    searchMsg.textContent = o >= file.size ? `That is past the end of the file, so it jumped to the last byte (0x${hex(file.size - 1, 1)}).` : ''
    scrollToOffset(at, { select: { a: at, b: at, anchor: at } })
    scroller.focus({ preventScroll: true })
  }

  async function search(dir) {
    if (!file) return
    const p = buildPattern(modeSel.value, findInput.value, ciBox.checked && modeSel.value !== 'hex')
    if (p.error) { searchMsg.style.color = 'var(--danger)'; searchMsg.textContent = p.error; return }
    searchCtl?.abort()
    const ctl = (searchCtl = new AbortController())
    searchMsg.style.color = ''
    searchMsg.textContent = 'Searching...'
    pat = p
    try {
      const start = sel ? (dir === 'next' ? sel.a + 1 : sel.a) : (dir === 'next' ? 0 : file.size)
      const opts = { signal: ctl.signal, onProgress: (f) => { searchMsg.textContent = `Searching... ${Math.round(f * 100)}%` } }
      const r = dir === 'next' ? await findNext(file, p, Math.min(start, file.size), opts) : await findPrev(file, p, Math.max(0, start), opts)
      if (ctl.signal.aborted) return
      if (!r) { searchMsg.style.color = 'var(--danger)'; searchMsg.textContent = 'Not found in this file.'; draw(); return }
      const end = r.offset + p.bytes.length - 1
      searchMsg.textContent = `Found at 0x${hex(r.offset, 1)} (${r.offset.toLocaleString()})${r.wrapped ? '. Started again from the ' + (dir === 'next' ? 'top' : 'end') + '.' : ''}`
      scrollToOffset(r.offset, { select: { a: r.offset, b: end, anchor: r.offset } })
    } catch (e) {
      if (e?.code === 'ABORT') return
      searchMsg.style.color = 'var(--danger)'
      searchMsg.textContent = errorMessage(e)
    }
  }

  return () => { searchCtl?.abort(); ro?.disconnect(); cancelAnimationFrame(raf) }
}
