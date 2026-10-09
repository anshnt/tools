// Website uptime checker. A browser cannot read another site's status code, so this measures whether the server answers
// (no-cors fetch: any response = reachable, network error = unreachable) and how fast, repeating while the tab is open.
import { h, icon, button, alert, clear, toggle, select, number, toast, onCleanup, stats, field, formatDuration } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, note, sparkline, parseWebUrl, recents, recentChips, wait, ago, hashParam, setHashParams } from './_shared.js'

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
const INTERVALS = [[5, 'Every 5 seconds'], [10, 'Every 10 seconds'], [30, 'Every 30 seconds'], [60, 'Every minute'], [300, 'Every 5 minutes']]
const MAX_POINTS = 90

/** One timed reachability probe. Returns {ok, ms, reason}. */
export async function probe(url, { timeout = 10000, signal } = {}) {
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, timeout)
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const t0 = performance.now()
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal: ctl.signal })
    const ms = performance.now() - t0
    ctl.abort() // do not download the whole page
    return { ok: true, ms }
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    return { ok: false, ms: performance.now() - t0, reason: timedOut ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Summarize the history array of {ok, ms, slow}. */
export function summarize(hist) {
  const ok = hist.filter((x) => x.ok)
  const ms = ok.map((x) => x.ms)
  return {
    checks: hist.length, up: ok.length, uptime: hist.length ? (ok.length / hist.length) * 100 : null,
    avg: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null, min: ms.length ? Math.min(...ms) : null, max: ms.length ? Math.max(...ms) : null,
    last: hist.length ? hist[hist.length - 1] : null,
  }
}

const CSS = `
.t-up2 .orbwrap { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 22px; align-items: center; padding: 22px; text-align: left; }
.t-up2 .upo { --c: var(--muted); width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--c); position: relative; transition: background .4s; }
.t-up2 .upo .icon { width: 42px; height: 42px; }
.t-up2 .upo::after { content: ""; position: absolute; inset: -10px; border-radius: 50%; border: 2px solid var(--c); opacity: 0; }
.t-up2 .upo.up { --c: var(--success); } .t-up2 .upo.slow { --c: var(--warning); } .t-up2 .upo.down { --c: var(--danger); }
.t-up2 .upo.running::after { animation: up2-ping 2.2s var(--ease) infinite; }
@keyframes up2-ping { 0% { transform: scale(.85); opacity: .55; } 100% { transform: scale(1.35); opacity: 0; } }
.t-up2 .state { font: 700 clamp(24px, 5vw, 36px)/1.1 var(--font); letter-spacing: -.03em; }
.t-up2 .ms { font: 600 15px var(--mono); color: var(--text-2); }
.t-up2 .log { border: 1px solid var(--border); border-radius: 16px; overflow: hidden; background: var(--surface); }
.t-up2 .log .li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; padding: 9px 14px; border-top: 1px solid var(--border); align-items: center; font-size: 13.5px; }
.t-up2 .log .li:first-child { border-top: 0; }
.t-up2 .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--muted); } .t-up2 .dot.up { background: var(--success); } .t-up2 .dot.down { background: var(--danger); } .t-up2 .dot.slow { background: var(--warning); }
.t-up2 .chart { padding: 14px 16px 8px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
@media (max-width: 520px) { .t-up2 .orbwrap { grid-template-columns: 1fr; justify-items: center; text-align: center; } }
@media (prefers-reduced-motion: reduce) { .t-up2 .upo.running::after { animation: none; } }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-up2-style')) document.head.append(h('style', { id: 't-up2-style' }, CSS))
  const rec = recents('uptime', 6)
  const cfg = { interval: 30, slow: 1500, notify: false, ...load('uptime:cfg', {}) }
  let url = '', running = false, timer = null, ctl = null, hist = [], events = [], state = 'idle', since = 0
  let chipsRecent

  const urlIn = h('input', { class: 'input', type: 'text', inputmode: 'url', placeholder: 'https://example.com', 'aria-label': 'Website to watch', autocapitalize: 'off', spellcheck: false, value: hashParam('q'), onkeydown: (e) => { if (e.key === 'Enter') start() } })
  const err = h('div')
  const orb = h('div', { class: 'upo' }, icon('activity'))
  const stateEl = h('div', { class: 'state' }, 'Not watching yet')
  const subEl = h('div', { class: 'ms' }, 'Enter a site and press Start.')
  const statsEl = h('div')
  const chartEl = h('div', { class: 'chart' })
  const logEl = h('div')
  const startBtn = button('Start watching', { icon: 'play', variant: 'primary', size: 'lg', onClick: () => (running ? stop() : start()) })
  const nowBtn = button('Check now', { icon: 'refresh-cw', onClick: () => { if (url) tick(true) } })

  function setState(next, ms) {
    const prevGroup = state === 'idle' ? null : state === 'down' ? 'down' : 'up'
    const group = next === 'down' ? 'down' : 'up'
    if (state !== next) {
      if (state !== 'idle' && prevGroup !== group) {
        const dur = Math.round((Date.now() - since) / 1000)
        events.unshift({ t: Date.now(), kind: group, text: group === 'down' ? 'Went down' : 'Back up', note: `after ${formatDuration(dur)} ${prevGroup === 'down' ? 'down' : 'up'}` })
        events.length = Math.min(events.length, 30)
        alertChange(group)
        since = Date.now()
      } else if (state === 'idle') { since = Date.now(); events.unshift({ t: Date.now(), kind: group, text: next === 'down' ? 'First check: unreachable' : 'First check: reachable', note: '' }) }
      state = next
    }
  }
  function alertChange(group) {
    const msg = group === 'down' ? `${new URL(url).hostname} is not responding` : `${new URL(url).hostname} is back online`
    toast(msg, group === 'down' ? 'error' : 'success')
    if (cfg.notify && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(group === 'down' ? 'Site is down' : 'Site is back up', { body: msg }) } catch { /* ignore */ }
    }
  }

  async function check() {
    ctl = new AbortController()
    const sig = AbortSignal.any ? AbortSignal.any([ctl.signal, signal].filter(Boolean)) : ctl.signal
    let r = await probe(url, { signal: sig })
    if (!r.ok) { await wait(1200, sig); r = await probe(url, { signal: sig }) } // one quick retry so a single blip is not a false alarm
    if (!r.ok) {
      const control = await probe('https://www.cloudflare.com/cdn-cgi/trace', { timeout: 6000, signal: sig })
      r.offline = !control.ok || !navigator.onLine
    }
    return r
  }

  async function tick(manual = false) {
    if (!url) return
    clearTimeout(timer)
    const t0 = Date.now()
    nowBtn.disabled = true
    let r
    try { r = await check() } catch (e) { if (e.code === 'ABORT') return; r = { ok: false, ms: 0, reason: 'network' } }
    nowBtn.disabled = false
    if (!running && !manual) return
    if (r.offline) {
      clear(err, alert('warn', 'Your own internet connection seems to be down, so this check was skipped. It will not count against the site.'))
    } else {
      clear(err)
      const slow = r.ok && r.ms > cfg.slow
      hist.push({ t: Date.now(), ok: r.ok, ms: r.ok ? r.ms : null, slow, reason: r.reason })
      if (hist.length > MAX_POINTS) hist.shift()
      setState(!r.ok ? 'down' : slow ? 'slow' : 'up', r.ms)
    }
    render()
    if (running) timer = setTimeout(() => tick(), Math.max(1000, cfg.interval * 1000 - (Date.now() - t0)))
  }

  function render() {
    orb.className = ['upo', state === 'idle' ? '' : state, running && 'running'].filter(Boolean).join(' ')
    clear(orb, icon(state === 'down' ? 'x' : state === 'slow' ? 'gauge' : state === 'up' ? 'check' : 'activity'))
    const s = summarize(hist)
    const last = s.last
    stateEl.textContent = { idle: 'Not watching yet', up: 'Reachable', slow: 'Reachable but slow', down: 'Not responding' }[state]
    subEl.textContent = !last ? 'Enter a site and press Start.' : last.ok ? `${Math.round(last.ms)} ms to first response, checked ${ago(last.t)}` : `${last.reason === 'timeout' ? 'No answer within 10 seconds' : 'Could not connect (DNS, connection or TLS failed)'}, checked ${ago(last.t)}`
    clear(statsEl, s.checks ? stats([
      { label: 'Uptime', value: `${s.uptime.toFixed(s.uptime === 100 ? 0 : 1)}%`, hint: `${s.up} of ${s.checks} checks`, accent: true, danger: s.uptime < 99 },
      { label: 'Last', value: last.ok ? `${Math.round(last.ms)} ms` : 'Failed' },
      { label: 'Average', value: s.avg != null ? `${Math.round(s.avg)} ms` : '-' },
      { label: 'Fastest', value: s.min != null ? `${Math.round(s.min)} ms` : '-' },
      { label: 'Slowest', value: s.max != null ? `${Math.round(s.max)} ms` : '-' },
    ]) : null)
    clear(chartEl)
    if (hist.length >= 2) chartEl.append(h('div', { class: 'wt-kicker', style: 'margin-bottom:6px' }, 'Response time (red bars are failed checks)'), sparkline(hist.map((x) => (x.ok ? x.ms : null)), { width: 480, height: 56 }))
    chartEl.hidden = hist.length < 2
    clear(logEl)
    if (events.length) logEl.append(h('div', { class: 'wt-kicker', style: 'margin:4px 0 8px' }, 'Status changes'), h('div', { class: 'log' }, events.map((e) => h('div', { class: 'li' }, h('span', { class: ['dot', e.kind] }), h('span', e.text, e.note ? h('span', { class: 'muted' }, ` ${e.note}`) : ''), h('span', { class: 'muted small' }, new Date(e.t).toLocaleTimeString())))))
    clear(startBtn, icon(running ? 'square' : 'play'), h('span', running ? 'Stop watching' : 'Start watching'))
    startBtn.className = `btn btn-${running ? 'secondary' : 'primary'} btn-lg`
  }

  async function start() {
    clear(err)
    let u
    try { u = parseWebUrl(urlIn.value) } catch (e) { return clear(err, alert('error', e.message)) }
    if (location.protocol === 'https:' && u.protocol === 'http:' && !LOCAL.has(u.hostname)) {
      return clear(err, alert('error', 'This page runs on https, so the browser blocks plain http:// checks. Use the https:// address of the site if it has one.'))
    }
    if (url !== u.href) { hist = []; events = []; state = 'idle' }
    url = u.href
    urlIn.value = u.href
    rec.add(u.href); chipsRecent.refresh(); setHashParams({ q: u.href })
    if (cfg.notify && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission() } catch { /* ignore */ } }
    running = true
    render()
    tick()
  }
  function stop() {
    running = false
    clearTimeout(timer)
    ctl?.abort()
    render()
  }

  const intervalSel = select(INTERVALS.map(([v, l]) => [String(v), l]), String(cfg.interval), (v) => { cfg.interval = +v; save('uptime:cfg', cfg); if (running) { clearTimeout(timer); timer = setTimeout(() => tick(), cfg.interval * 1000) } })
  const slowIn = number(cfg.slow, { min: 100, step: 100, ariaLabel: 'Slow threshold in milliseconds', onInput: (n) => { if (n >= 100) { cfg.slow = n; save('uptime:cfg', cfg) } } })
  const notifyT = toggle('Notify me when the status changes', cfg.notify, async (c) => {
    cfg.notify = c; save('uptime:cfg', cfg)
    if (c && 'Notification' in window && Notification.permission === 'default') { try { await Notification.requestPermission() } catch { /* ignore */ } }
    if (c && 'Notification' in window && Notification.permission === 'denied') toast('Notifications are blocked for this site in your browser settings. You will still see alerts on this page.', 'info')
    if (c && !('Notification' in window)) toast('This browser has no notifications. You will still see alerts on this page.', 'info')
  })
  chipsRecent = recentChips(rec, (v) => { urlIn.value = v; start() }, { label: 'Recent' })
  root.append(h('div', { class: 't-up2 stack' },
    h('section', { class: 'panel stack' }, h('div', { class: 'grid-2', style: 'align-items:end' }, field('Website', urlIn), h('div', { class: 'row' }, startBtn, nowBtn)), err, chipsRecent,
      h('div', { class: 'grid-3' }, field('Check', intervalSel), field('Mark as slow above (ms)', slowIn), h('div', { style: 'align-self:end;padding-bottom:6px' }, notifyT))),
    h('section', { class: 'panel orbwrap wt-mesh' }, orb, h('div', { class: 'stack', style: 'gap:6px' }, stateEl, subEl)),
    statsEl, chartEl, logEl,
    alert('info', h('div', h('b', 'What this can and cannot tell you. '), 'Browsers hide the status code of other sites, so a page that answers with an error (404, 500) still counts as reachable. "Not responding" means the server could not be reached at all: DNS failure, refused connection, bad certificate or no answer in 10 seconds. Response time is how long the first response took from your device, including connection setup on the first check.')),
    note('Checks run from your browser while this tab is open, so the result reflects your own connection. Browsers slow background tabs, so keep it visible for short intervals. A single failed check is retried once before it counts as down.')))
  render()
  onCleanup(() => { running = false; clearTimeout(timer); ctl?.abort() })
  if (urlIn.value) start()
}
