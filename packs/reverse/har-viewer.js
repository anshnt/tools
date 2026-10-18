// HAR log viewer: request list with filters and waterfall, per-request detail tabs, summary stats,
// a redacted copy for sharing and CSV export. Everything runs locally.
import { h, clear, dropzone, alert, stats, tabs, button, download, formatBytes, formatNumber, input, select, field, toggle, copyButton, onCleanup, debounce, progress, yieldToMain, errorMessage } from '../../lib/ui.js'
import { baseName, base64ToBytes } from '../../lib/files.js'

// ---------- Pure logic (exported for tests) ----------

export class HarError extends Error {}

const TYPE_LABELS = { document: 'Document', script: 'Script', stylesheet: 'CSS', image: 'Image', font: 'Font', xhr: 'XHR', fetch: 'Fetch', media: 'Media', websocket: 'WebSocket', manifest: 'Manifest', other: 'Other' }
export const RESOURCE_TYPES = Object.keys(TYPE_LABELS)

/** Resource type from Chrome's _resourceType, else from the MIME type and URL. */
export function classifyType(entry) {
  const rt = String(entry._resourceType || '').toLowerCase()
  if (TYPE_LABELS[rt]) return rt
  if (rt === 'eventsource' || rt === 'ping' || rt === 'preflight') return 'fetch'
  const mime = String(entry.response?.content?.mimeType || '').toLowerCase().split(';')[0].trim()
  const url = String(entry.request?.url || '')
  if (/^wss?:/i.test(url) || entry._webSocketMessages) return 'websocket'
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'document'
  if (/javascript|ecmascript/.test(mime)) return 'script'
  if (mime === 'text/css') return 'stylesheet'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('font/') || /font|woff|opentype|truetype/.test(mime)) return 'font'
  if (mime.startsWith('video/') || mime.startsWith('audio/')) return 'media'
  if (mime === 'application/manifest+json') return 'manifest'
  if (/json|xml|text\/plain/.test(mime)) return 'xhr'
  const ext = (url.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  return { js: 'script', mjs: 'script', css: 'stylesheet', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image', ico: 'image', woff: 'font', woff2: 'font', ttf: 'font', otf: 'font', mp4: 'media', webm: 'media', mp3: 'media', html: 'document' }[ext] || 'other'
}
export const typeLabel = (t) => TYPE_LABELS[t] || t

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : -1)

/** Parse and validate HAR text. Returns { har, entries, pages, creator, warnings }. Throws HarError with a readable message. */
export function parseHar(text) {
  if (typeof text !== 'string' || !text.trim()) throw new HarError('The file is empty.')
  let har
  try {
    har = JSON.parse(text.replace(/^﻿/, ''))
  } catch (e) {
    const pos = /position (\d+)/.exec(e.message)?.[1]
    let where = ''
    if (pos != null) {
      const before = text.slice(0, +pos)
      where = ` near line ${before.split('\n').length}, column ${+pos - before.lastIndexOf('\n')}`
    }
    throw new HarError(`This is not valid JSON${where}. A HAR file is JSON exported from the browser's Network panel (Save all as HAR). It may be cut off.`)
  }
  if (!har || typeof har !== 'object' || Array.isArray(har)) throw new HarError('This JSON is not a HAR file: the top level should be an object with a "log" property.')
  const log = har.log
  if (!log || typeof log !== 'object') throw new HarError('This JSON is not a HAR file: there is no "log" object.')
  if (!Array.isArray(log.entries)) throw new HarError('This HAR file has no "log.entries" list, so there are no requests to show.')
  const warnings = []
  if (log.version && !/^1\.[12]/.test(String(log.version))) warnings.push(`HAR version ${log.version} is not 1.1 or 1.2; some fields may be missing.`)
  const entries = []
  let skipped = 0
  log.entries.forEach((e, i) => {
    const req = e?.request, res = e?.response
    if (!req || typeof req.url !== 'string' || !req.method) { skipped++; return }
    let u = null
    try { u = new URL(req.url) } catch { /* data: or relative */ }
    const start = Date.parse(e.startedDateTime)
    const t = e.timings || {}
    const content = res?.content || {}
    const bodySize = num(res?.bodySize), headersSize = num(res?.headersSize)
    const transfer = num(res?._transferSize) >= 0 ? res._transferSize : (bodySize >= 0 ? bodySize : 0) + (headersSize >= 0 ? headersSize : 0)
    entries.push({
      index: i,
      method: String(req.method).toUpperCase(),
      url: req.url,
      host: u?.host || '',
      path: u ? u.pathname + u.search : req.url.slice(0, 200),
      scheme: u?.protocol.replace(':', '') || '',
      status: typeof res?.status === 'number' ? res.status : 0,
      statusText: res?.statusText || '',
      mime: String(content.mimeType || '').split(';')[0].trim(),
      type: classifyType(e),
      size: num(content.size) >= 0 ? content.size : bodySize >= 0 ? bodySize : 0,
      transfer,
      time: num(e.time) >= 0 ? e.time : sumTimings(t),
      start: Number.isFinite(start) ? start : NaN,
      timings: t,
      fromCache: !!(e._fromCache || res?._fromCache) || (res?.status === 304),
      raw: e,
    })
  })
  if (skipped) warnings.push(`${skipped} entr${skipped === 1 ? 'y was' : 'ies were'} skipped because they have no request URL or method.`)
  if (entries.some((x) => Number.isNaN(x.start))) warnings.push('Some entries have no valid startedDateTime, so they are left out of the waterfall.')
  return { har, entries, pages: Array.isArray(log.pages) ? log.pages : [], creator: log.creator || null, warnings }
}

function sumTimings(t) {
  let s = 0
  for (const k of ['blocked', 'dns', 'connect', 'send', 'wait', 'receive']) if (num(t[k]) > 0) s += t[k]
  return s
}

/** Timing phases in display order. ssl is part of connect in HAR, so connect is shown without the TLS part. */
export function timingPhases(t = {}) {
  const v = (k) => (num(t[k]) > 0 ? t[k] : 0)
  const ssl = v('ssl')
  return [
    { key: 'blocked', label: 'Blocked / queued', ms: v('blocked') },
    { key: 'dns', label: 'DNS lookup', ms: v('dns') },
    { key: 'connect', label: 'Initial connection', ms: Math.max(0, v('connect') - ssl) },
    { key: 'ssl', label: 'TLS handshake', ms: ssl },
    { key: 'send', label: 'Request sent', ms: v('send') },
    { key: 'wait', label: 'Waiting (TTFB)', ms: v('wait') },
    { key: 'receive', label: 'Content download', ms: v('receive') },
  ]
}

export const statusClass = (s) => (s >= 100 && s < 600 ? `${Math.floor(s / 100)}xx` : 'failed')

/** Summary numbers for a list of parsed entries. */
export function summarizeHar(entries) {
  const starts = entries.map((e) => e.start).filter(Number.isFinite)
  const t0 = starts.length ? starts.reduce((a, b) => (b < a ? b : a)) : NaN // no spread: big HARs overflow the argument limit
  let end = -Infinity, transferred = 0, size = 0, errors = 0
  const domains = new Map()
  for (const e of entries) {
    transferred += e.transfer
    size += e.size
    if (e.status === 0 || e.status >= 400) errors++
    if (Number.isFinite(e.start)) end = Math.max(end, e.start + e.time)
    if (e.host) domains.set(e.host, (domains.get(e.host) || 0) + 1)
  }
  return { requests: entries.length, transferred, size, totalTime: Number.isFinite(t0) && end > t0 ? end - t0 : 0, start: t0, domains, errors }
}

/** Filter entries: { text, status: 'all'|'2xx'|..|'failed', type: 'all'|type, domain: 'all'|host }. */
export function filterEntries(entries, f = {}) {
  const text = (f.text || '').trim().toLowerCase()
  return entries.filter((e) =>
    (!f.status || f.status === 'all' || statusClass(e.status) === f.status) &&
    (!f.type || f.type === 'all' || e.type === f.type) &&
    (!f.domain || f.domain === 'all' || e.host === f.domain) &&
    (!text || `${e.method} ${e.url} ${e.status} ${e.mime}`.toLowerCase().includes(text)))
}

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|set-cookie2|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|csrf-token|x-amz-security-token|x-goog-api-key|x-session-id|x-refresh-token|x-[a-z0-9-]*(?:token|secret|api-?key|auth|session|password)[a-z0-9-]*)$/i
const SENSITIVE_PARAM = /^(?:.*[_-])?(?:token|access_token|id_token|refresh_token|auth|authorization|key|api_?key|apikey|secret|client_secret|password|passwd|pwd|pass|session|sessionid|session_id|sid|jwt|signature|sig|code|otp|x-amz-signature|x-amz-credential|x-amz-security-token)$/i
export const REDACTED = 'REDACTED'
export const isSensitiveHeader = (name) => SENSITIVE_HEADER.test(String(name))
export const isSensitiveParam = (name) => SENSITIVE_PARAM.test(String(name))

function redactUrl(url) {
  try {
    const u = new URL(url)
    let changed = false
    for (const k of [...new Set(u.searchParams.keys())]) {
      if (isSensitiveParam(k)) { u.searchParams.set(k, REDACTED); changed = true }
    }
    if (u.username || u.password) { u.username = ''; u.password = ''; changed = true }
    return changed ? u.toString() : url
  } catch { return url }
}

/**
 * Deep copy of a HAR object with secrets removed: sensitive headers, all cookies, token-like query parameters
 * (in the URL, queryString and form postData params). Bodies are kept unless removeBodies is true.
 * Returns { har, counts: { headers, cookies, params, bodies } }.
 */
export function redactHar(har, { removeBodies = false } = {}) {
  const copy = JSON.parse(JSON.stringify(har))
  const counts = { headers: 0, cookies: 0, params: 0, bodies: 0 }
  const redactHeaders = (list) => Array.isArray(list) ? list.map((x) => {
    if (x && isSensitiveHeader(x.name)) { counts.headers++; return { ...x, value: REDACTED } }
    return x
  }) : list
  const redactParams = (list) => Array.isArray(list) ? list.map((x) => {
    if (x && isSensitiveParam(x.name)) { counts.params++; return { ...x, value: REDACTED } }
    return x
  }) : list
  for (const e of copy.log?.entries || []) {
    const req = e.request || {}, res = e.response || {}
    req.headers = redactHeaders(req.headers)
    res.headers = redactHeaders(res.headers)
    for (const r of [req, res]) if (Array.isArray(r.cookies) && r.cookies.length) { counts.cookies += r.cookies.length; r.cookies = [] }
    if (typeof req.url === 'string') {
      const nu = redactUrl(req.url)
      if (nu !== req.url) req.url = nu
    }
    req.queryString = redactParams(req.queryString)
    if (req.postData) {
      req.postData.params = redactParams(req.postData.params)
      if (removeBodies && req.postData.text != null) { req.postData.text = ''; counts.bodies++ }
      else if (typeof req.postData.text === 'string' && /x-www-form-urlencoded/i.test(req.postData.mimeType || '')) {
        const sp = new URLSearchParams(req.postData.text)
        let changed = false
        for (const k of [...new Set(sp.keys())]) if (isSensitiveParam(k)) { sp.set(k, REDACTED); changed = true; counts.params++ }
        if (changed) req.postData.text = sp.toString()
      }
    }
    if (typeof res.redirectURL === 'string' && res.redirectURL) res.redirectURL = redactUrl(res.redirectURL)
    if (removeBodies && res.content && res.content.text != null) { delete res.content.text; delete res.content.encoding; counts.bodies++ }
    for (const m of e._webSocketMessages || []) if (removeBodies) { m.data = ''; counts.bodies++ }
  }
  return { har: copy, counts }
}

export function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function harCsv(entries) {
  const head = ['index', 'started', 'method', 'status', 'status_text', 'type', 'mime', 'host', 'url', 'transferred_bytes', 'size_bytes', 'time_ms']
  const rows = entries.map((e) => [e.index, Number.isFinite(e.start) ? new Date(e.start).toISOString() : '', e.method, e.status, e.statusText, e.type, e.mime, e.host, e.url, e.transfer, e.size, Math.round(e.time * 100) / 100])
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** Decode response content: { kind: 'json'|'text'|'image'|'binary'|'none', text?, bytes?, mime }. */
export function decodeContent(content = {}) {
  const mime = String(content.mimeType || '').split(';')[0].trim().toLowerCase()
  if (content.text == null || content.text === '') return { kind: 'none', mime }
  let bytes = null, text = null
  if (String(content.encoding || '').toLowerCase() === 'base64') {
    try { bytes = base64ToBytes(content.text) } catch { return { kind: 'text', text: content.text, mime, note: 'Marked as base64 but could not be decoded.' } }
  } else text = content.text
  if (mime.startsWith('image/')) {
    if (!bytes && mime === 'image/svg+xml') return { kind: 'text', text, mime }
    if (bytes) return { kind: 'image', bytes, mime }
  }
  if (bytes) {
    if (/^(text\/|application\/(json|javascript|xml|.*\+json|.*\+xml|x-www-form-urlencoded))/.test(mime) || looksText(bytes)) text = new TextDecoder().decode(bytes)
    else return { kind: 'binary', bytes, mime }
  }
  if (/json/.test(mime) || /^\s*[[{]/.test(text)) {
    try { return { kind: 'json', text: JSON.stringify(JSON.parse(text), null, 2), mime } } catch { /* not JSON */ }
  }
  return { kind: 'text', text, mime }
}
function looksText(b) {
  const n = Math.min(b.length, 512)
  let bad = 0
  for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0 || (c < 9) || (c > 13 && c < 32)) bad++ }
  return bad === 0
}

// ---------- UI ----------

const STYLE = `
.t-har .hv-filters { display: grid; grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr)); gap: 10px; align-items: end; }
@media (max-width: 720px) { .t-har .hv-filters { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .t-har .hv-filters > :first-child { grid-column: 1 / -1; } }
.t-har .hv-list { max-height: 460px; }
.t-har .hv-list tbody tr { cursor: pointer; }
.t-har .hv-list tbody tr:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.t-har .hv-list tbody tr[aria-selected="true"] td { background: var(--accent-soft); }
.t-har .hv-name { max-width: 340px; overflow: hidden; text-overflow: ellipsis; }
.t-har .hv-name small { display: block; color: var(--muted); }
.t-har .hv-st { display: inline-flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.t-har .hv-st::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
.t-har .hv-st.s2::before { background: var(--success); }
.t-har .hv-st.s3::before { background: var(--info); }
.t-har .hv-st.s4::before { background: var(--warning); }
.t-har .hv-st.s5::before, .t-har .hv-st.s0::before { background: var(--danger); }
.t-har .hv-st.s4, .t-har .hv-st.s5, .t-har .hv-st.s0 { color: var(--danger); }
.t-har .hv-wf { position: relative; width: 180px; height: 12px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.t-har .hv-seg { position: absolute; top: 2px; height: 8px; }
.t-har .hv-p-blocked { background: var(--border-strong); }
.t-har .hv-p-dns { background: color-mix(in srgb, var(--info) 50%, var(--success)); }
.t-har .hv-p-connect { background: var(--warning); }
.t-har .hv-p-ssl { background: var(--accent-2); }
.t-har .hv-p-send { background: color-mix(in srgb, var(--success) 55%, var(--surface)); }
.t-har .hv-p-wait { background: var(--success); }
.t-har .hv-p-receive { background: var(--info); }
.t-har .hv-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.t-har .hv-legend span { display: inline-flex; align-items: center; gap: 6px; }
.t-har .hv-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.t-har .hv-tbar { display: grid; grid-template-columns: minmax(0, 160px) minmax(0, 1fr) 80px; gap: 10px; align-items: center; }
.t-har .hv-tbar .hv-track { height: 10px; background: var(--surface-2); border-radius: 3px; position: relative; overflow: hidden; }
.t-har .hv-kv { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); gap: 4px 14px; font-size: 13px; }
.t-har .hv-kv dt { color: var(--muted); overflow-wrap: anywhere; }
.t-har .hv-kv dd { margin: 0; font-family: var(--mono); overflow-wrap: anywhere; white-space: pre-wrap; }
@media (max-width: 560px) { .t-har .hv-kv { grid-template-columns: minmax(0, 1fr); } .t-har .hv-kv dd { margin-bottom: 6px; } .t-har .hv-tbar { grid-template-columns: minmax(0, 1fr) 70px; } .t-har .hv-tbar .hv-track { grid-column: 1 / -1; grid-row: 2; } }
.t-har .hv-url { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
.t-har .hv-img { max-width: 100%; max-height: 360px; image-rendering: auto; }
.t-har .hv-h3 { margin: 10px 0 4px; font-size: 14px; }
`
let styled = false
const injectStyle = () => { if (!styled) { styled = true; document.head.append(h('style', { 'data-tool': 'har-viewer' }, STYLE)) } }

const PAGE = 300
const fmtMs = (ms) => (!Number.isFinite(ms) || ms < 0 ? '-' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`)

function statusBadge(e) {
  const c = e.status ? Math.floor(e.status / 100) : 0
  const text = e.status ? String(e.status) : 'failed'
  return h('span', { class: ['hv-st', `s${c}`], title: e.statusText || null }, text, e.statusText ? h('span', { class: 'small muted' }, e.statusText.length > 18 ? '' : e.statusText) : null)
}

export function mount(root) {
  injectStyle()
  const urls = new Set()
  onCleanup(() => { for (const u of urls) URL.revokeObjectURL(u); urls.clear() })
  const prog = progress('Reading HAR')
  const result = h('div', { class: 'stack' })
  const zone = dropzone({
    accept: '.har,.json,application/json',
    label: 'Drop a .har file here or click to choose',
    hint: 'Export from DevTools: Network panel, then Save all as HAR. Stays on your device.',
    icon: 'network',
    onFiles: ([f]) => open(f),
  })

  async function open(file) {
    for (const u of urls) URL.revokeObjectURL(u)
    urls.clear()
    clear(result)
    try {
      prog.set(null, `Reading ${file.name}`)
      const text = await file.text()
      prog.set(0.5, 'Parsing')
      await yieldToMain()
      const parsed = parseHar(text)
      zone.classList.add('compact')
      show(file, parsed)
    } catch (e) {
      if (!(e instanceof HarError)) console.error(e)
      clear(result, alert('error', errorMessage(e)))
    } finally { prog.hide() }
  }

  function show(file, { har, entries, warnings, creator }) {
    const name = baseName(file.name) || 'log'
    const sum = summarizeHar(entries)
    const filt = { text: '', status: 'all', type: 'all', domain: 'all' }
    let current = entries, selected = null, limit = PAGE
    const types = [...new Set(entries.map((e) => e.type))]
    const domains = [...sum.domains.entries()].sort((a, b) => b[1] - a[1])
    const statsHost = h('div')
    const listHost = h('div', { class: 'stack tight' })
    const detailHost = h('div')
    const count = h('span', { class: 'small muted', 'aria-live': 'polite' })

    const textIn = input({ type: 'search', placeholder: 'URL, method, status or MIME' })
    textIn.addEventListener('input', debounce(() => { filt.text = textIn.value; refilter() }, 150))
    const statusSel = select([['all', 'All statuses'], ['2xx', '2xx success'], ['3xx', '3xx redirect'], ['4xx', '4xx client error'], ['5xx', '5xx server error'], ['failed', 'Failed (no status)']], 'all', (v) => { filt.status = v; refilter() })
    const typeSel = select([['all', 'All types'], ...RESOURCE_TYPES.filter((t) => types.includes(t)).map((t) => [t, typeLabel(t)])], 'all', (v) => { filt.type = v; refilter() })
    const domainSel = select([['all', `All domains (${domains.length})`], ...domains.map(([d, n]) => [d, `${d} (${n})`])], 'all', (v) => { filt.domain = v; refilter() })

    const redactBodies = toggle('Also remove request and response bodies', false)
    const redactBtn = button('Download redacted copy', { icon: 'shield-check', variant: 'primary', onClick: () => {
      const { har: red, counts } = redactHar(har, { removeBodies: redactBodies.input.checked })
      download(JSON.stringify(red, null, 2), `${name}-redacted.har`, 'application/json')
      redactInfo.textContent = `Removed ${counts.headers} header value(s), ${counts.cookies} cookie(s) and ${counts.params} query or form value(s)${counts.bodies ? `, ${counts.bodies} bod${counts.bodies === 1 ? 'y' : 'ies'}` : ''}.`
    } })
    const redactInfo = h('p', { class: 'small muted', 'aria-live': 'polite' })
    const csvBtn = button('Export filtered list (CSV)', { icon: 'file-spreadsheet', onClick: () => download(harCsv(current), `${name}-requests.csv`, 'text/csv') })

    function refilter() {
      current = filterEntries(entries, filt)
      limit = PAGE
      drawStats()
      drawList()
    }

    function drawStats() {
      const s = current === entries ? sum : summarizeHar(current)
      clear(statsHost, stats([
        { label: 'Requests', value: current === entries ? formatNumber(s.requests) : `${formatNumber(s.requests)} of ${formatNumber(entries.length)}`, accent: true },
        { label: 'Transferred', value: formatBytes(s.transferred), hint: `${formatBytes(s.size)} resources` },
        { label: 'Total time', value: fmtMs(s.totalTime), hint: 'First request start to last response end' },
        { label: 'Domains', value: formatNumber(s.domains.size) },
        { label: 'Errors', value: formatNumber(s.errors), danger: s.errors > 0, hint: '4xx, 5xx or failed' },
      ]))
    }

    function drawList() {
      const t0 = sum.start
      let span = 1
      for (const e of current) if (Number.isFinite(e.start)) span = Math.max(span, e.start - t0 + e.time)
      count.textContent = `${current.length} request${current.length === 1 ? '' : 's'} shown`
      if (!current.length) { clear(listHost, h('p', { class: 'muted' }, 'No requests match these filters.')); return }
      const rows = current.slice(0, limit).map((e) => {
        const tr = h('tr', {
          tabindex: 0, 'aria-selected': String(selected === e),
          onclick: () => select_(e, tr),
          onkeydown: (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select_(e, tr) }
            else if (ev.key === 'ArrowDown') { ev.preventDefault(); tr.nextElementSibling?.focus() }
            else if (ev.key === 'ArrowUp') { ev.preventDefault(); tr.previousElementSibling?.focus() }
          },
        },
        h('td', h('strong', { class: 'small' }, e.method)),
        h('td', statusBadge(e)),
        h('td', { class: 'hv-name', title: e.url }, e.path.length > 70 ? e.path.slice(0, 67) + '...' : e.path, h('small', e.host)),
        h('td', typeLabel(e.type)),
        h('td', { class: 'num' }, e.fromCache && !e.transfer ? h('span', { class: 'muted' }, 'cache') : formatBytes(e.transfer)),
        h('td', { class: 'num' }, fmtMs(e.time)),
        h('td', waterfallBar(e, t0, span)))
        return tr
      })
      clear(listHost,
        h('div', { class: 'table-wrap hv-list' }, h('table', { class: 'table' },
          h('thead', h('tr', ['Method', 'Status', 'Path and domain', 'Type', 'Size', 'Time', 'Waterfall'].map((c, i) => h('th', { scope: 'col', class: i === 4 || i === 5 ? 'num' : null }, c)))),
          h('tbody', rows))),
        current.length > limit ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, `Showing ${limit} of ${current.length}.`), button('Show more', { size: 'sm', icon: 'chevrons-down', onClick: () => { limit += PAGE; drawList() } })) : null)
    }

    function select_(e, tr) {
      selected = e
      for (const r of listHost.querySelectorAll('tbody tr')) r.setAttribute('aria-selected', String(r === tr))
      clear(detailHost, detail(e, urls))
      if (matchMedia('(max-width: 900px)').matches) detailHost.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    }

    clear(result,
      h('div', { class: 'small muted' }, `${file.name}${creator?.name ? `, exported by ${creator.name}${creator.version ? ' ' + creator.version : ''}` : ''}`),
      warnings.map((w) => alert('warn', w)),
      !entries.length ? alert('info', 'This HAR file is valid but contains no requests.') : null,
      statsHost,
      h('section', { class: 'panel stack' },
        h('div', { class: 'hv-filters' }, field('Search', textIn), field('Status', statusSel), field('Type', typeSel), field('Domain', domainSel)),
        h('div', { class: 'row between' }, count, csvBtn),
        legend(),
        listHost),
      detailHost,
      h('section', { class: 'panel stack tight' },
        h('h2', 'Share safely'),
        h('p', { class: 'small muted' }, 'The redacted copy replaces Authorization, Cookie, Set-Cookie and API key or token headers, empties cookie lists, and masks token-like query and form values (token, key, secret, password, session, signature, code). Bodies can still hold personal data, so remove them if unsure.'),
        redactBodies, h('div', { class: 'row' }, redactBtn), redactInfo))
    drawStats()
    drawList()
    clear(detailHost, h('p', { class: 'muted small' }, 'Select a request to see its headers, body, cookies and timings.'))
  }

  root.append(h('div', { class: 'stack t-har' }, zone, prog.el, result))
}

function legend() {
  return h('div', { class: 'hv-legend small muted', 'aria-hidden': 'true' },
    timingPhases().map((p) => h('span', h('i', { class: `hv-p-${p.key}` }), p.label)))
}

function waterfallBar(e, t0, span) {
  if (!Number.isFinite(e.start)) return h('span', { class: 'muted small' }, '-')
  let x = ((e.start - t0) / span) * 100
  const segs = []
  for (const p of timingPhases(e.timings)) {
    if (!p.ms) continue
    const w = (p.ms / span) * 100
    segs.push(h('span', { class: ['hv-seg', `hv-p-${p.key}`], style: { left: `${x}%`, width: `${Math.max(w, 0.4)}%` } }))
    x += w
  }
  if (!segs.length) segs.push(h('span', { class: 'hv-seg hv-p-wait', style: { left: `${x}%`, width: `${Math.max((e.time / span) * 100, 0.4)}%` } }))
  return h('div', { class: 'hv-wf', role: 'img', 'aria-label': `Starts at ${fmtMs(e.start - t0)}, takes ${fmtMs(e.time)}` }, segs)
}

// HAR values come from an untrusted file and may be objects. h(tag, obj) would treat an object as props (html, innerHTML),
// so every value is turned into text first.
const txt = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function kv(list) {
  if (!list || !list.length) return h('p', { class: 'muted small' }, 'None.')
  return h('dl', { class: 'hv-kv' }, list.map(([k, v]) => [h('dt', txt(k)), h('dd', txt(v))]))
}
const headerPairs = (hs) => (Array.isArray(hs) ? hs.map((x) => [x.name, x.value]) : [])

function detail(e, urls) {
  const req = e.raw.request || {}, res = e.raw.response || {}
  return h('section', { class: 'panel stack tight' },
    h('div', { class: 'row between' }, h('div', { class: 'row' }, h('strong', e.method), statusBadge(e)), copyButton(() => e.url, 'Copy URL')),
    h('div', { class: 'hv-url' }, e.url),
    tabs([
      { id: 'headers', label: 'Headers', render: () => h('div', { class: 'stack tight' },
        kv([['Request URL', e.url], ['Method', e.method], ['Status', `${e.status || 'failed'} ${e.statusText}`], ['HTTP version', res.httpVersion || req.httpVersion || '-'], ['Server IP', e.raw.serverIPAddress || '-'], ['Connection', e.raw.connection || '-']]),
        h('h3', { class: 'hv-h3' }, `Response headers (${(res.headers || []).length})`), kv(headerPairs(res.headers)),
        h('h3', { class: 'hv-h3' }, `Request headers (${(req.headers || []).length})`), kv(headerPairs(req.headers))) },
      { id: 'query', label: 'Query', render: () => {
        let qs = Array.isArray(req.queryString) ? req.queryString.map((x) => [x.name, x.value]) : []
        if (!qs.length) { try { qs = [...new URL(e.url).searchParams] } catch { /* no URL */ } }
        return qs.length ? kv(qs) : h('p', { class: 'muted small' }, 'This request has no query string.')
      } },
      { id: 'reqbody', label: 'Request body', render: () => requestBody(req) },
      { id: 'resbody', label: 'Response body', render: () => responseBody(e, res, urls) },
      { id: 'cookies', label: `Cookies (${(req.cookies || []).length + (res.cookies || []).length})`, render: () => cookies(req, res) },
      { id: 'timing', label: 'Timings', render: () => timingView(e) },
    ]))
}

function requestBody(req) {
  const pd = req.postData
  if (!pd || (pd.text == null && !pd.params?.length)) return h('p', { class: 'muted small' }, 'No request body.')
  const kids = [h('div', { class: 'small muted' }, pd.mimeType || 'unknown type')]
  if (pd.params?.length) kids.push(kv(pd.params.map((p) => [p.name, p.fileName ? `${p.value ?? ''} (file ${p.fileName})` : p.value ?? ''])))
  if (pd.text != null && pd.text !== '') {
    const d = decodeContent({ text: pd.text, mimeType: pd.mimeType })
    kids.push(h('pre', { class: 'code-out' }, d.text ?? pd.text), h('div', { class: 'row' }, copyButton(() => d.text ?? pd.text, 'Copy body')))
  }
  return h('div', { class: 'stack tight' }, kids)
}

function responseBody(e, res, urls) {
  const c = res.content || {}
  const d = decodeContent(c)
  const meta = h('div', { class: 'small muted' }, `${d.mime || 'unknown type'}, ${formatBytes(e.size)}${c.compression > 0 ? `, saved ${formatBytes(c.compression)} by compression` : ''}${c.encoding ? `, stored as ${c.encoding}` : ''}`)
  const fname = (baseName(e.path.split('?')[0].split('/').pop() || '') || 'response')
  if (d.kind === 'none') return h('div', { class: 'stack tight' }, meta, h('p', { class: 'muted small' }, 'The HAR file does not include this response body. Some browsers leave out bodies of images, fonts and large or cached responses.'))
  if (d.kind === 'image') {
    const blob = new Blob([d.bytes], { type: d.mime })
    const url = URL.createObjectURL(blob)
    urls.add(url)
    const dims = h('span', { class: 'small muted' })
    const img = h('img', { class: 'hv-img', src: url, alt: `Response image ${fname}`, onload: () => { dims.textContent = `${img.naturalWidth} x ${img.naturalHeight} px` }, onerror: () => { dims.textContent = 'The image data could not be decoded.' } })
    return h('div', { class: 'stack tight' }, meta, h('div', { class: 'preview' }, img), h('div', { class: 'row' }, dims, button('Download', { icon: 'download', size: 'sm', onClick: () => download(blob, `${fname}.${d.mime.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg')}`) })))
  }
  if (d.kind === 'binary') {
    const hex = Array.from(d.bytes.subarray(0, 256), (b) => b.toString(16).padStart(2, '0')).join(' ')
    return h('div', { class: 'stack tight' }, meta, h('p', { class: 'small' }, `Binary data, ${formatBytes(d.bytes.length)}. First bytes:`), h('pre', { class: 'code-out' }, hex),
      h('div', { class: 'row' }, button('Download', { icon: 'download', size: 'sm', onClick: () => download(new Blob([d.bytes], { type: d.mime || 'application/octet-stream' }), `${fname}.bin`) })))
  }
  const shown = d.text.length > 400000 ? d.text.slice(0, 400000) : d.text
  return h('div', { class: 'stack tight' }, meta,
    d.note ? alert('warn', d.note) : null,
    h('pre', { class: 'code-out' }, shown),
    shown !== d.text ? h('p', { class: 'small muted' }, `Showing the first 400,000 of ${formatNumber(d.text.length)} characters. Download for the rest.`) : null,
    h('div', { class: 'row' }, copyButton(() => d.text, d.kind === 'json' ? 'Copy JSON' : 'Copy text'),
      button('Download', { icon: 'download', size: 'sm', onClick: () => download(d.text, `${fname}.${d.kind === 'json' ? 'json' : 'txt'}`, d.mime || 'text/plain') })))
}

function cookies(req, res) {
  const tbl = (list, title) => h('div', { class: 'stack tight' }, h('h3', { class: 'hv-h3' }, title),
    !list?.length ? h('p', { class: 'muted small' }, 'None.') : h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', h('tr', ['Name', 'Value', 'Domain', 'Path', 'Expires', 'Flags'].map((c) => h('th', { scope: 'col' }, c)))),
      h('tbody', list.map((c) => h('tr', h('td', txt(c.name)), h('td', { class: 'hv-name', title: txt(c.value) }, txt(c.value).slice(0, 80)), h('td', txt(c.domain)), h('td', txt(c.path)), h('td', txt(c.expires)),
        h('td', [c.httpOnly && 'HttpOnly', c.secure && 'Secure', c.sameSite && `SameSite=${c.sameSite}`].filter(Boolean).join(', '))))))))
  return h('div', { class: 'stack tight' }, tbl(req.cookies, 'Sent with the request'), tbl(res.cookies, 'Set by the response'))
}

function timingView(e) {
  const phases = timingPhases(e.timings)
  const total = Math.max(1, phases.reduce((a, p) => a + p.ms, 0))
  let x = 0
  const rows = phases.map((p) => {
    const left = (x / total) * 100, w = (p.ms / total) * 100
    x += p.ms
    return h('div', { class: 'hv-tbar' }, h('span', { class: 'small' }, p.label),
      h('div', { class: 'hv-track', role: 'img', 'aria-label': `${p.label}: ${fmtMs(p.ms)}` }, p.ms ? h('span', { class: ['hv-seg', `hv-p-${p.key}`], style: { left: `${left}%`, width: `${Math.max(w, 0.6)}%`, top: '1px' } }) : null),
      h('span', { class: 'small num', style: 'text-align:right' }, p.ms ? fmtMs(p.ms) : '-'))
  })
  return h('div', { class: 'stack tight' },
    Number.isFinite(e.start) ? h('div', { class: 'small muted' }, `Started ${new Date(e.start).toLocaleString()}`) : null,
    rows,
    h('div', { class: 'row between' }, h('strong', 'Total'), h('strong', fmtMs(e.time))),
    h('p', { class: 'small muted' }, 'Phases marked - were not used (for example a reused connection has no DNS or connect time).'))
}

