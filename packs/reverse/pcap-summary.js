// Packet capture summary: reads .pcap / .pcapng locally and summarizes protocols, talkers, conversations, DNS, TLS SNI and HTTP.
// Parsing lives in _net-pcap.js (DOM-free, tested in Node).
import { h, svg, clear, dropzone, alert, progress, stats, tabs, button, download, formatBytes, formatNumber, yieldToMain, input, field, onCleanup, icon, isAbort, errorMessage } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { summarizeCapture, CaptureError, MAX_CAPTURE_BYTES, conversationsCsv, dnsCsv, toCsv, serviceName, isoTime } from './_net-pcap.js'

export { summarizeCapture }

const STYLE = `
.t-pcap .pc-spark { width: 100%; height: 72px; display: block; }
.t-pcap .pc-spark .area { fill: color-mix(in srgb, var(--accent) 22%, transparent); }
.t-pcap .pc-spark .line { fill: none; stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.t-pcap .pc-axis { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.t-pcap .pc-bar { display: inline-block; height: 8px; border-radius: 4px; background: var(--accent); vertical-align: middle; min-width: 2px; }
.t-pcap .pc-barcell { display: flex; align-items: center; gap: 8px; min-width: 120px; }
.t-pcap .pc-sort { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font: inherit; color: inherit; }
.t-pcap .pc-sort:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.t-pcap .pc-sort .icon { width: 14px; height: 14px; }
.t-pcap .mono { font-family: var(--mono); font-size: 12.5px; }
.t-pcap .pc-tools { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
.t-pcap .pc-tools .field { flex: 1 1 200px; min-width: 0; }
.t-pcap .pc-h3 { margin: 6px 0 0; font-size: 15px; }
`
let styled = false
function injectStyle() {
  if (styled) return
  styled = true
  document.head.append(h('style', { 'data-tool': 'pcap-summary' }, STYLE))
}

/** Seconds as a short readable span. */
export function fmtSecs(s) {
  if (!Number.isFinite(s)) return '-'
  if (s < 1) return `${(s * 1000).toFixed(s < 0.01 ? 2 : 1)} ms`
  if (s < 120) return `${s.toFixed(3)} s`
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60)
  return hh ? `${hh} h ${mm} min` : `${mm} min ${ss} s`
}
const endpoint = (ip, port) => (port == null ? ip : ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`)
const pct = (x, total) => (total ? (x / total) * 100 : 0)

export function mount(root, { signal } = {}) {
  injectStyle()
  const result = h('div', { class: 'stack' })
  const prog = progress('Reading capture')
  let runId = 0
  const zone = dropzone({
    label: 'Drop a .pcap or .pcapng file here or click to choose',
    hint: '.pcap, .pcapng, .cap or .dmp from Wireshark, tcpdump or dumpcap, up to 500 MB. Analyzed on your device.',
    icon: 'activity',
    onFiles: ([f]) => analyze(f),
  })
  onCleanup(() => { runId++ })

  async function analyze(file) {
    const id = ++runId
    clear(result)
    if (file.size > MAX_CAPTURE_BYTES) {
      clear(result, alert('error', `${file.name} is ${formatBytes(file.size)}. This tool reads captures up to ${formatBytes(MAX_CAPTURE_BYTES)} in the browser. Split it first, for example with editcap -c 1000000.`))
      return
    }
    zone.classList.add('compact')
    try {
      prog.set(null, `Reading ${file.name}`)
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (id !== runId) return
      prog.set(0, 'Decoding packets')
      const sum = await summarizeCapture(bytes, {
        onProgress: (p) => prog.set(p, 'Decoding packets'),
        yieldFn: async () => { await yieldToMain(); if (id !== runId) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' }) },
        signal,
      })
      if (id !== runId) return
      prog.set(1, 'Building summary')
      await yieldToMain()
      render(file, sum)
    } catch (e) {
      if (isAbort(e)) return
      if (!(e instanceof CaptureError)) console.error(e)
      clear(result, alert('error', errorMessage(e)))
    } finally {
      if (id === runId) prog.hide()
    }
  }

  function render(file, s) {
    const notes = []
    if (s.truncated) notes.push(alert('warn', 'The capture ends in the middle of a packet (it was cut off or is still being written). Everything up to that point is included.'))
    if (s.listCapped) notes.push(alert('info', 'Very busy capture: the DNS, TLS and HTTP lists stop at 20,000 entries each. Totals still include every packet.'))
    if (s.noTimestamp) notes.push(alert('info', `${formatNumber(s.noTimestamp)} packet(s) had no timestamp (pcapng simple packet blocks) and are left out of the timeline.`))
    if (!s.packets) notes.push(alert('warn', 'The file is a valid capture but holds no packets.'))
    const name = base(file.name)
    const rate = s.duration > 0 ? (s.bytes * 8) / s.duration : NaN
    const fmtLabel = s.format === 'pcapng' ? `pcapng ${s.version || ''}` : `pcap ${s.version || ''}${s.nanosecond ? ', nanosecond' : ''}`
    clear(result,
      h('div', { class: 'small muted' }, `${file.name}: ${fmtLabel.trim()}, ${s.littleEndian ? 'little' : 'big'}-endian, link type ${s.linktypes.map((l) => l.name).join(', ') || '-'}`),
      notes,
      stats([
        { label: 'Packets', value: formatNumber(s.packets), accent: true },
        { label: 'Data on the wire', value: formatBytes(s.bytes), hint: s.captured < s.bytes ? `${formatBytes(s.captured)} captured (snaplen)` : null },
        { label: 'Duration', value: fmtSecs(s.duration), hint: s.first != null ? new Date(s.first * 1000).toLocaleString() : null },
        { label: 'Average rate', value: Number.isFinite(rate) ? `${formatNumber(rate / 1000, 1)} kbit/s` : '-', hint: s.duration > 0 ? `${formatNumber(s.packets / s.duration, 1)} packets/s` : null },
        { label: 'Hosts', value: formatNumber(s.hosts.length) },
        { label: 'Conversations', value: formatNumber(s.conversations.length) },
      ]),
      sparkline(s),
      tabs([
        { id: 'proto', label: 'Protocols', render: () => protocolsView(s) },
        { id: 'talkers', label: `Top talkers (${s.hosts.length})`, render: () => talkersView(s) },
        { id: 'conv', label: `Conversations (${s.conversations.length})`, render: () => conversationsView(s, name) },
        { id: 'dns', label: `DNS (${s.lookups.length})`, render: () => dnsView(s, name) },
        { id: 'tls', label: `TLS SNI (${s.tls.length})`, render: () => tlsView(s, name) },
        { id: 'http', label: `HTTP (${s.http.length})`, render: () => httpView(s, name) },
      ]))
  }

  root.append(h('div', { class: 'stack t-pcap' }, zone, prog.el, result))
}

const base = (n) => baseName(n) || 'capture'

function sparkline(s) {
  const t = s.timeline
  if (!t.counts.length || t.counts.length < 2) return null
  const max = Math.max(...t.counts)
  const W = 1000, H = 100
  const n = t.counts.length
  const pts = t.counts.map((c, i) => [(i / (n - 1)) * W, H - (c / max) * (H - 6) - 2])
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `M0,${H} L${line.split(' ').join(' L')} L${W},${H} Z`
  const peak = t.counts.indexOf(max)
  const perSec = t.width > 0 ? max / t.width : NaN
  const label = `Packets over time: ${n} buckets of ${fmtSecs(t.width)}, peak ${formatNumber(max)} packets${Number.isFinite(perSec) ? ` (${formatNumber(perSec, 1)} per second)` : ''} at +${fmtSecs(peak * t.width)}.`
  return h('div', { class: 'panel stack tight' },
    h('div', { class: 'row between' }, h('strong', 'Packets over time'), h('span', { class: 'small muted' }, `Peak ${formatNumber(max)} per ${fmtSecs(t.width)}`)),
    h('svg', { class: 'pc-spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
      svg('title', label), h('path', { class: 'area', d: area }), h('polyline', { class: 'line', points: line })),
    h('div', { class: 'pc-axis small muted' }, h('span', '+0'), h('span', `+${fmtSecs(n * t.width)}`)))
}

function barCell(v, total) {
  const p = pct(v, total)
  return h('div', { class: 'pc-barcell' }, h('span', { class: 'pc-bar', style: { width: `${Math.max(2, p)}px`, maxWidth: '100px' } }), h('span', { class: 'small' }, `${p.toFixed(1)}%`))
}

function breakdown(title, list, total) {
  return h('div', { class: 'stack tight' }, h('h3', { class: 'pc-h3' }, title),
    sortableTable([
      { label: 'Protocol', get: (r) => r.name },
      { label: 'Packets', num: true, get: (r) => r.packets, fmt: formatNumber },
      { label: 'Bytes', num: true, get: (r) => r.bytes, fmt: formatBytes },
      { label: 'Share of bytes', get: (r) => r.bytes, render: (r) => barCell(r.bytes, total) },
    ], list, { sort: 2 }))
}

function protocolsView(s) {
  return h('div', { class: 'stack' },
    breakdown('Application (by port and payload)', s.apps, s.bytes),
    breakdown('Transport', s.transport, s.bytes),
    breakdown('Network', s.network, s.bytes),
    s.linktypes.length > 1 ? breakdown('Link layer', s.linktypes, s.bytes) : null)
}

function talkersView(s) {
  return h('div', { class: 'stack tight' },
    h('p', { class: 'small muted' }, 'IP addresses ranked by bytes sent plus received.'),
    sortableTable([
      { label: 'Address', get: (r) => r.ip, cls: 'mono' },
      { label: 'Packets', num: true, get: (r) => r.packets, fmt: formatNumber },
      { label: 'Bytes', num: true, get: (r) => r.bytes, fmt: formatBytes },
      { label: 'Sent', num: true, get: (r) => r.sent, fmt: formatBytes },
      { label: 'Received', num: true, get: (r) => r.received, fmt: formatBytes },
      { label: 'Share', get: (r) => r.bytes, render: (r) => barCell(r.bytes, s.bytes) },
    ], s.hosts, { sort: 2, max: 500 }))
}

function conversationsView(s, name) {
  const q = input({ type: 'search', placeholder: 'Filter by address, port or protocol' })
  const host = h('div')
  const draw = () => {
    const t = q.value.trim().toLowerCase()
    const rows = t ? s.conversations.filter((c) => `${c.proto} ${c.a} ${c.aPort ?? ''} ${c.b} ${c.bPort ?? ''} ${serviceName(c.bPort)}`.toLowerCase().includes(t)) : s.conversations
    clear(host, sortableTable([
      { label: 'Protocol', get: (r) => r.proto },
      { label: 'Address A', get: (r) => endpoint(r.a, r.aPort), cls: 'mono' },
      { label: 'Address B', get: (r) => endpoint(r.b, r.bPort), cls: 'mono', render: (r) => h('span', endpoint(r.b, r.bPort), serviceName(r.bPort) ? h('span', { class: 'muted small' }, ` ${serviceName(r.bPort)}`) : null) },
      { label: 'Packets', num: true, get: (r) => r.packets, fmt: formatNumber },
      { label: 'Bytes', num: true, get: (r) => r.bytes, fmt: formatBytes },
      { label: 'A to B', num: true, get: (r) => r.aToB, fmt: formatBytes },
      { label: 'B to A', num: true, get: (r) => r.bToA, fmt: formatBytes },
      { label: 'Duration', num: true, get: (r) => r.duration, fmt: fmtSecs },
    ], rows, { sort: 4, max: 1000 }))
  }
  q.addEventListener('input', draw)
  draw()
  return h('div', { class: 'stack tight' },
    h('div', { class: 'pc-tools' }, field('Filter', q),
      button('Export CSV', { icon: 'download', size: 'sm', onClick: () => download(conversationsCsv(s.conversations), `${name}-conversations.csv`, 'text/csv') })),
    h('p', { class: 'small muted' }, 'A is the side that sent the first packet seen, usually the client. Click a column to sort.'),
    host)
}

function dnsView(s, name) {
  if (!s.lookups.length) return h('p', { class: 'muted' }, 'No DNS traffic on UDP or TCP port 53 (or mDNS 5353) in this capture.')
  const rel = (ts) => (Number.isFinite(ts) && s.first != null ? `+${(ts - s.first).toFixed(3)} s` : '-')
  const q = input({ type: 'search', placeholder: 'Filter by name, type or answer' })
  const host = h('div')
  const draw = () => {
    const t = q.value.trim().toLowerCase()
    const rows = t ? s.lookups.filter((l) => `${l.name} ${l.qtype} ${l.rcode} ${l.client} ${l.answers.map((a) => a.data).join(' ')}`.toLowerCase().includes(t)) : s.lookups
    clear(host, sortableTable([
      { label: 'Time', get: (r) => r.ts, fmt: rel, num: true },
      { label: 'Name', get: (r) => r.name, cls: 'mono' },
      { label: 'Type', get: (r) => r.qtype },
      { label: 'Result', get: (r) => (r.answered ? r.rcode : 'no reply'), render: (r) => h('span', { class: r.answered ? (r.rcode === 'NOERROR' ? '' : 'muted') : 'muted' }, r.answered ? r.rcode : 'no reply') },
      { label: 'Answers', get: (r) => r.answers.map((a) => `${a.type} ${a.data}`).join(', '), render: (r) => h('div', { class: 'mono' }, r.answers.length ? r.answers.map((a) => h('div', `${a.type} ${a.data}`)) : '-') },
      { label: 'Latency', num: true, get: (r) => r.latency ?? -1, fmt: (v) => (v >= 0 ? fmtSecs(v) : '-') },
      { label: 'Client', get: (r) => r.client, cls: 'mono' },
    ], rows, { max: 1000 }))
  }
  q.addEventListener('input', draw)
  draw()
  return h('div', { class: 'stack tight' },
    h('div', { class: 'pc-tools' }, field('Filter', q),
      button('Export CSV', { icon: 'download', size: 'sm', onClick: () => download(dnsCsv(s.lookups), `${name}-dns.csv`, 'text/csv') })),
    host)
}

function tlsView(s, name) {
  if (!s.tls.length) return h('p', { class: 'muted' }, 'No TLS ClientHello found. Only the first TCP segment of each connection is checked, and QUIC (HTTP/3) is encrypted from the start.')
  const counts = new Map()
  for (const t of s.tls) {
    const k = t.sni || '(no SNI)'
    const c = counts.get(k) || { sni: k, hellos: 0, servers: new Set(), alpn: new Set(), versions: new Set() }
    c.hellos++
    c.servers.add(endpoint(t.dst, t.dport))
    t.alpn.forEach((a) => c.alpn.add(a))
    if (t.version) c.versions.add(t.version)
    counts.set(k, c)
  }
  const rows = [...counts.values()].sort((a, b) => b.hellos - a.hellos)
  const csv = () => toCsv(['time', 'client', 'server', 'sni', 'alpn', 'version'], s.tls.map((t) => [isoTime(t.ts), endpoint(t.src, t.sport), endpoint(t.dst, t.dport), t.sni || '', t.alpn.join(' '), t.version || '']))
  return h('div', { class: 'stack tight' },
    h('div', { class: 'row between' }, h('p', { class: 'small muted' }, 'Server names from TLS ClientHello messages, grouped by name.'),
      button('Export CSV', { icon: 'download', size: 'sm', onClick: () => download(csv(), `${name}-tls-sni.csv`, 'text/csv') })),
    sortableTable([
      { label: 'Server name', get: (r) => r.sni, cls: 'mono' },
      { label: 'ClientHellos', num: true, get: (r) => r.hellos, fmt: formatNumber },
      { label: 'Servers', get: (r) => [...r.servers].join(', '), cls: 'mono' },
      { label: 'ALPN', get: (r) => [...r.alpn].join(', ') },
      { label: 'Version offered', get: (r) => [...r.versions].join(', ') },
    ], rows, { sort: 1 }))
}

function httpView(s, name) {
  if (!s.http.length) return h('p', { class: 'muted' }, 'No plain HTTP/1.x requests found. HTTPS traffic is encrypted, see the TLS SNI tab.')
  const rel = (ts) => (Number.isFinite(ts) && s.first != null ? `+${(ts - s.first).toFixed(3)} s` : '-')
  const csv = () => toCsv(['time', 'client', 'server', 'method', 'host', 'target', 'user_agent'], s.http.map((r) => [isoTime(r.ts), endpoint(r.src, r.sport), endpoint(r.dst, r.dport), r.method, r.host, r.target, r.userAgent]))
  return h('div', { class: 'stack tight' },
    h('div', { class: 'row end' }, button('Export CSV', { icon: 'download', size: 'sm', onClick: () => download(csv(), `${name}-http.csv`, 'text/csv') })),
    sortableTable([
      { label: 'Time', num: true, get: (r) => r.ts, fmt: rel },
      { label: 'Method', get: (r) => r.method },
      { label: 'Host', get: (r) => r.host, cls: 'mono' },
      { label: 'Path', get: (r) => r.target, cls: 'mono', fmt: (v) => (v.length > 120 ? v.slice(0, 117) + '...' : v) },
      { label: 'Server', get: (r) => endpoint(r.dst, r.dport), cls: 'mono' },
      { label: 'User agent', get: (r) => r.userAgent, fmt: (v) => (v.length > 60 ? v.slice(0, 57) + '...' : v) },
    ], s.http, { max: 1000 }))
}

/**
 * Small sortable table. cols: [{label, get(row), fmt?(value), render?(row), num?, cls?}]. Click or Enter on a header sorts.
 */
function sortableTable(cols, data, { sort = -1, max = 1000 } = {}) {
  let key = sort, dir = sort >= 0 ? -1 : 1
  const wrap = h('div')
  const draw = () => {
    let rows = data
    if (key >= 0) {
      const g = cols[key].get
      rows = [...data].sort((a, b) => {
        const x = g(a), y = g(b)
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir
      })
    }
    const shown = rows.slice(0, max)
    clear(wrap, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', h('tr', cols.map((c, i) => h('th', { class: c.num && 'num', scope: 'col', 'aria-sort': i === key ? (dir > 0 ? 'ascending' : 'descending') : null },
        h('button', { type: 'button', class: 'pc-sort', onclick: () => { if (key === i) dir = -dir; else { key = i; dir = c.num ? -1 : 1 } draw(); wrap.querySelector(`th:nth-child(${i + 1}) button`)?.focus() } },
          c.label, i === key ? icon(dir > 0 ? 'arrow-up' : 'arrow-down') : null))))),
      h('tbody', shown.map((r) => h('tr', cols.map((c) => {
        const v = c.get(r)
        return h('td', { class: [c.num && 'num', c.cls] }, c.render ? c.render(r) : c.fmt ? c.fmt(v) : v ?? '')
      })))))),
    rows.length > max ? h('div', { class: 'small muted', style: 'padding:8px 2px' }, `Showing ${formatNumber(max)} of ${formatNumber(rows.length)} rows. Export CSV for all of them.`) : null,
    !rows.length ? h('p', { class: 'small muted' }, 'Nothing matches.') : null)
  }
  draw()
  return wrap
}
