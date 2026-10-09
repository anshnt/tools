// Internet speed test using Cloudflare's public speed endpoints: latency and jitter, then parallel streams for download and upload.
import { h, icon, button, alert, clear, segmented, onCleanup, formatBytes, toast } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { ensureStyle, pill, note, tile, ago, wait } from './_shared.js'

const BASE = 'https://speed.cloudflare.com'
const LENGTHS = { quick: 5, standard: 8, long: 15 }
const STREAMS = 4

export const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN }
/** Mean absolute difference between consecutive samples. */
export const jitter = (a) => (a.length < 2 ? 0 : a.slice(1).reduce((s, v, i) => s + Math.abs(v - a[i]), 0) / (a.length - 1))
/** Speed in Mbps from cumulative samples [[seconds, bytes]], ignoring the first `skip` seconds of ramp-up (or the first quarter for short runs). */
export function speedFromSamples(samples, skip = 1.5) {
  if (samples.length < 2) return 0
  const end = samples[samples.length - 1]
  const total = end[0] - samples[0][0]
  const from = total > skip * 2.2 ? skip : total * 0.25
  const start = samples.find((s) => s[0] - samples[0][0] >= from) || samples[0]
  const dt = end[0] - start[0]
  return dt > 0 ? ((end[1] - start[1]) * 8) / dt / 1e6 : 0
}
/** Current speed over the last `win` seconds. */
export function recentSpeed(samples, win = 1) {
  if (samples.length < 2) return 0
  const end = samples[samples.length - 1]
  const start = [...samples].reverse().find((s) => end[0] - s[0] >= win) || samples[0]
  const dt = end[0] - start[0]
  return dt > 0 ? ((end[1] - start[1]) * 8) / dt / 1e6 : 0
}
const fmtMbps = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2))
const gaugePos = (v) => Math.min(1, Math.log10(Math.max(0, v) + 1) / Math.log10(1001)) // 0..1000 Mbps on a log scale

const CSS = `
.t-st .stage { display: grid; justify-items: center; gap: 4px; padding: 24px 16px 20px; text-align: center; }
.t-st .gauge { width: min(360px, 100%); height: auto; overflow: visible; }
.t-st .gauge .track { stroke: var(--surface-3); } .t-st .gauge .fill { transition: stroke-dashoffset .25s linear; }
.t-st .gauge text { font-family: var(--font); fill: var(--text); text-anchor: middle; }
.t-st .gauge .num { font-size: 38px; font-weight: 700; letter-spacing: -.03em; } .t-st .gauge .unit { font-size: 11px; fill: var(--muted); letter-spacing: .08em; text-transform: uppercase; }
.t-st .gauge .tick { fill: var(--muted); font-size: 9px; }
.t-st .phase { font-weight: 600; min-height: 24px; display: flex; align-items: center; gap: 8px; }
.t-st .phase .spinner { width: 14px; height: 14px; }
.t-st .go { min-width: 200px; }
.t-st .res { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); }
.t-st .res .wt-tile .t-val { font-size: 26px; letter-spacing: -.03em; font-weight: 700; } .t-st .res .wt-tile .t-val small { font-size: 13px; font-weight: 500; color: var(--muted); margin-left: 4px; }
.t-st .can { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); }
.t-st .hist { border: 1px solid var(--border); border-radius: 16px; overflow: hidden; background: var(--surface); }
.t-st .hist .hr { display: grid; grid-template-columns: minmax(0, 1.2fr) repeat(3, minmax(0, 1fr)); gap: 8px; padding: 8px 14px; border-top: 1px solid var(--border); font-size: 13px; align-items: center; }
.t-st .hist .hr:first-child { border-top: 0; color: var(--muted); font-size: 12px; background: var(--surface-2); }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-st-style')) document.head.append(h('style', { id: 't-st-style' }, CSS))
  const hist = persisted('speedtest:history', [])
  let length = 'standard'
  let running = false
  let ctl = null
  const NS = 'http://www.w3.org/2000/svg'

  // Gauge
  const fill = h('path', { class: 'fill', d: 'M 20 100 A 80 80 0 0 1 180 100', fill: 'none', 'stroke-width': 14, 'stroke-linecap': 'round', stroke: 'url(#stg)', pathLength: 100, 'stroke-dasharray': 100, 'stroke-dashoffset': 100 })
  const num = h('text', { class: 'num', x: 100, y: 88 }, '0')
  const unit = h('text', { class: 'unit', x: 100, y: 108 }, 'Mbps')
  const gauge = h('svg', { class: 'gauge', viewBox: '0 0 200 124', role: 'img', 'aria-label': 'Speed gauge' },
    h('defs', h('linearGradient', { id: 'stg', x1: 0, y1: 0, x2: 1, y2: 0 }, h('stop', { offset: '0%', 'stop-color': '#6366f1' }), h('stop', { offset: '55%', 'stop-color': '#a855f7' }), h('stop', { offset: '100%', 'stop-color': '#ec4899' }))),
    h('path', { class: 'track', d: 'M 20 100 A 80 80 0 0 1 180 100', fill: 'none', 'stroke-width': 14, 'stroke-linecap': 'round' }), fill, num, unit,
    ...[[0, 0], [1, 10], [2, 100], [3, 1000]].map(([i, v]) => { const a = Math.PI * (1 - gaugePos(v)); return h('text', { class: 'tick', x: 100 + 98 * Math.cos(a), y: 100 - 98 * Math.sin(a) + 3 }, v === 0 ? '0' : String(v)) }))
  const setGauge = (v, big) => { fill.style.strokeDashoffset = String(100 - gaugePos(v) * 100); num.textContent = big ?? fmtMbps(v) }
  const phaseEl = h('div', { class: 'phase', 'aria-live': 'polite' }, 'Ready when you are')
  const goBtn = button('Start test', { icon: 'play', variant: 'primary', size: 'lg', onClick: () => (running ? cancel() : run()) })
  goBtn.classList.add('go')
  const lenSeg = segmented([['quick', 'Quick'], ['standard', 'Standard'], ['long', 'Thorough']], length, (v) => { length = v }, 'Test length')
  const resEl = h('div'), canEl = h('div'), histEl = h('div'), errEl = h('div')
  const serverPill = h('div', { class: 'row', style: 'justify-content:center' })

  function setRunning(on) {
    running = on
    clear(goBtn, icon(on ? 'square' : 'play'), h('span', on ? 'Stop' : hist.get().length ? 'Test again' : 'Start test'))
    goBtn.className = `btn btn-${on ? 'secondary' : 'primary'} btn-lg go`
    for (const b of lenSeg.querySelectorAll('button')) b.disabled = on
  }
  const setPhase = (txt, spin) => clear(phaseEl, spin ? h('span', { class: 'spinner' }) : null, txt)
  const cancel = () => { ctl?.abort() }

  // ---- measurements ----
  async function measureLatency(sig, onPoint) {
    const times = []
    let meta = null
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now()
      const res = await fetch(`${BASE}/__down?bytes=0&r=${Math.random().toString(36).slice(2)}`, { cache: 'no-store', signal: sig })
      await res.arrayBuffer()
      const ms = performance.now() - t0
      if (i === 0) { meta = { colo: res.headers.get('cf-meta-colo'), city: res.headers.get('cf-meta-city'), country: res.headers.get('cf-meta-country') }; continue } // first one includes connection setup
      times.push(ms)
      onPoint(median(times))
      await wait(40, sig)
    }
    return { ping: median(times), min: Math.min(...times), jitter: jitter(times), meta }
  }

  async function measureDownload(sig, seconds, onSpeed) {
    const samples = []
    const t0 = performance.now()
    let total = 0
    let bytesPerReq = 25e6
    const sampler = setInterval(() => { const t = (performance.now() - t0) / 1000; samples.push([t, total]); onSpeed(recentSpeed(samples, 1)) }, 150)
    const inner = new AbortController()
    const onAbort = () => inner.abort()
    sig.addEventListener('abort', onAbort, { once: true })
    const stopTimer = setTimeout(() => inner.abort(), seconds * 1000)
    const worker = async () => {
      while (!inner.signal.aborted) {
        const started = performance.now()
        let got = 0
        try {
          const res = await fetch(`${BASE}/__down?bytes=${bytesPerReq}&r=${Math.random().toString(36).slice(2)}`, { cache: 'no-store', signal: inner.signal })
          const reader = res.body.getReader()
          for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; got += value.byteLength }
        } catch (e) { if (inner.signal.aborted) break; throw e }
        if (performance.now() - started < 1500 && bytesPerReq < 100e6) bytesPerReq = 100e6 // fast line: ask for bigger chunks
      }
    }
    try { await Promise.all(Array.from({ length: STREAMS }, worker)) } finally { clearInterval(sampler); clearTimeout(stopTimer); sig.removeEventListener('abort', onAbort) }
    samples.push([(performance.now() - t0) / 1000, total])
    if (sig.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    return { mbps: speedFromSamples(samples), bytes: total }
  }

  async function measureUpload(sig, seconds, onSpeed) {
    const samples = []
    const t0 = performance.now()
    let done = 0
    const active = new Set()
    let chunk = 4e6
    const payloads = new Map()
    const blobFor = (n) => { if (!payloads.has(n)) payloads.set(n, new Blob([new Uint8Array(n)])); return payloads.get(n) } // empty content type: a simple request, no preflight
    const loaded = () => done + [...active].reduce((s, x) => s + x.loaded, 0)
    const sampler = setInterval(() => { const t = (performance.now() - t0) / 1000; samples.push([t, loaded()]); onSpeed(recentSpeed(samples, 1)) }, 150)
    let stop = false
    const stopTimer = setTimeout(() => { stop = true; for (const x of active) x.xhr.abort() }, seconds * 1000)
    const onAbort = () => { stop = true; for (const x of active) x.xhr.abort() }
    sig.addEventListener('abort', onAbort, { once: true })
    const one = () => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const rec = { xhr, loaded: 0 }
      active.add(rec)
      const started = performance.now()
      xhr.open('POST', `${BASE}/__up?r=${Math.random().toString(36).slice(2)}`)
      xhr.upload.onprogress = (e) => { rec.loaded = e.loaded }
      xhr.onload = () => { done += chunk; active.delete(rec); if (performance.now() - started < 1000 && chunk < 32e6) chunk *= 2; resolve() }
      xhr.onerror = () => { active.delete(rec); reject(new Error('The upload test could not reach the server.')) }
      xhr.onabort = () => { done += rec.loaded; active.delete(rec); resolve() }
      xhr.send(blobFor(chunk))
    })
    const worker = async () => { while (!stop) await one() }
    try { await Promise.all(Array.from({ length: STREAMS }, worker)) } finally { clearInterval(sampler); clearTimeout(stopTimer); sig.removeEventListener('abort', onAbort) }
    samples.push([(performance.now() - t0) / 1000, done])
    if (sig.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    return { mbps: speedFromSamples(samples), bytes: done }
  }

  async function run() {
    clear(errEl); clear(resEl); clear(canEl); clear(serverPill)
    ctl = new AbortController()
    const sig = ctl.signal
    signal?.addEventListener('abort', () => ctl.abort(), { once: true })
    setRunning(true)
    const secs = LENGTHS[length]
    const result = { t: Date.now() }
    try {
      setPhase('Measuring latency', true); setGauge(0, '...'); unit.textContent = 'ms'
      const lat = await measureLatency(sig, (m) => { num.textContent = m.toFixed(0); fill.style.strokeDashoffset = String(100 - Math.min(1, m / 300) * 100) })
      Object.assign(result, { ping: lat.ping, jitter: lat.jitter })
      if (lat.meta?.colo) clear(serverPill, pill(`Server: ${[lat.meta.city, lat.meta.country].filter(Boolean).join(', ') || lat.meta.colo} (${lat.meta.colo})`, '', 'server'))
      unit.textContent = 'Mbps'
      setPhase('Testing download', true); setGauge(0)
      const dl = await measureDownload(sig, secs, (v) => setGauge(v))
      result.down = dl.mbps; setGauge(dl.mbps)
      showResults(result, false)
      setPhase('Testing upload', true); setGauge(0)
      const ul = await measureUpload(sig, secs, (v) => setGauge(v))
      result.up = ul.mbps; result.bytes = dl.bytes + ul.bytes
      setGauge(result.down)
      setPhase(`Done. Used about ${formatBytes(result.bytes)} of data.`)
      hist.update((l) => [result, ...l].slice(0, 8))
      showResults(result, true)
    } catch (e) {
      if (e.code === 'ABORT' || sig.aborted) { setPhase('Stopped'); if (result.down) showResults(result, false) }
      else { setPhase('The test could not finish'); clear(errEl, alert('error', /fetch|network|reach|Failed/i.test(e.message) ? 'Could not reach Cloudflare\'s speed servers. Check your connection (an ad blocker, VPN or firewall can block speed.cloudflare.com) and try again.' : e.message)) }
    } finally {
      setRunning(false)
      renderHist()
    }
  }

  function showResults(r, final) {
    clear(resEl, h('div', { class: 'res' },
      tile('Download', h('span', fmtMbps(r.down), h('small', 'Mbps')), 'Pulling data to your device', 'arrow-down-to-line', 0),
      r.up != null ? tile('Upload', h('span', fmtMbps(r.up), h('small', 'Mbps')), 'Sending data from your device', 'arrow-up-from-line', 1) : null,
      tile('Latency', h('span', r.ping.toFixed(0), h('small', 'ms')), 'Round trip to the server', 'timer', 2),
      tile('Jitter', h('span', r.jitter.toFixed(1), h('small', 'ms')), 'How much latency varies', 'activity', 3)))
    if (final) {
      const g = (ok, label, hint) => h('div', { class: 'wt-tile', style: 'padding:10px 14px;display:flex;gap:10px;align-items:center' }, icon(ok ? 'circle-check' : 'circle-x'), h('div', h('div', { style: 'font-weight:600;font-size:14px' }, label), h('div', { class: 'small muted' }, hint)))
      const c = [
        [r.down >= 5 && r.up >= 3, 'Video calls', 'Needs about 5 Mbps down and 3 Mbps up'],
        [r.down >= 8, 'HD streaming', 'Needs about 8 Mbps per stream'],
        [r.down >= 25, '4K streaming', 'Needs about 25 Mbps per stream'],
        [r.ping < 60 && r.jitter < 20, 'Online gaming', 'Wants under 60 ms latency and little jitter'],
        [r.down >= 100, 'Big downloads', '100 Mbps is about 45 GB an hour'],
        [r.up >= 10, 'Cloud backups and uploads', 'Needs about 10 Mbps up'],
      ]
      clear(canEl, h('h2', { style: 'margin:0 0 10px;font-size:16px' }, 'What your connection can do'), h('div', { class: 'can' }, c.map(([ok, a, b]) => g(ok, a, b))))
    }
  }

  function renderHist() {
    const l = hist.get()
    clear(histEl)
    if (!l.length) return
    histEl.append(h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:8px' }, h('h2', { style: 'margin:0;font-size:16px' }, 'Your recent tests'), button('Clear', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { hist.set([]); renderHist(); setRunning(false) } })),
      h('div', { class: 'hist' }, h('div', { class: 'hr' }, h('span', 'When'), h('span', 'Download'), h('span', 'Upload'), h('span', 'Latency')),
        l.map((r) => h('div', { class: 'hr' }, h('span', ago(r.t)), h('b', `${fmtMbps(r.down)} Mbps`), h('span', r.up != null ? `${fmtMbps(r.up)} Mbps` : '-'), h('span', `${r.ping.toFixed(0)} ms`)))))
  }

  root.append(h('div', { class: 't-st stack' },
    h('section', { class: 'panel wt-mesh' }, h('div', { class: 'stage' }, gauge, phaseEl, serverPill, h('div', { class: 'row', style: 'justify-content:center;margin-top:6px' }, goBtn), h('div', { class: 'row', style: 'justify-content:center' }, lenSeg))),
    errEl, resEl, canEl, histEl,
    note('Uses Cloudflare\'s public speed test servers (speed.cloudflare.com). The test downloads and uploads data for several seconds, roughly 10 to 300 MB depending on your speed, so be careful on a metered mobile plan. Results reflect this browser, this device and the path to the nearest Cloudflare server, and can vary run to run. Wi-Fi, VPNs and other devices on your network all affect it.')))
  setRunning(false)
  renderHist()
  onCleanup(() => ctl?.abort())
}
