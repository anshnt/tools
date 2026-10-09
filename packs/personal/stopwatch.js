// Stopwatch with laps and splits, best/worst lap highlighting, keyboard shortcuts, CSV export. Keeps running across reloads.
import { h, icon, button, download, clear, toast, copyText } from '../../lib/ui.js'
import { app, css, makeStore, ticker, pageTitle, pad, today, stat, emptyState } from './_shared.js'

/** 83456 -> "01:23.45" (centiseconds, hours only when needed). */
export function fmtSW(ms) {
  ms = Math.max(0, Math.floor(ms))
  const cs = Math.floor((ms % 1000) / 10), s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000) % 60, hh = Math.floor(ms / 3600000)
  return `${hh ? hh + ':' : ''}${pad(m)}:${pad(s)}.${pad(cs)}`
}
/** laps: [{lap, total}] -> index of fastest and slowest (needs 2+ laps). */
export function bestWorst(laps) {
  if (laps.length < 2) return { best: -1, worst: -1 }
  let best = 0, worst = 0
  laps.forEach((l, i) => { if (l.lap < laps[best].lap) best = i; if (l.lap > laps[worst].lap) worst = i })
  return { best, worst }
}
export const lapsToCsv = (laps) => 'lap,lap_time,split_time,lap_ms,split_ms\n' + laps.map((l, i) => `${i + 1},${fmtSW(l.lap)},${fmtSW(l.total)},${l.lap},${l.total}`).join('\n')

const CSS = `
.t-stopwatch .face{display:grid;place-items:center;gap:18px;padding:34px 16px 26px;border-radius:28px;background:radial-gradient(120% 100% at 50% 0%,color-mix(in srgb,var(--tc) 16%,var(--surface)),var(--surface) 70%);border:1px solid color-mix(in srgb,var(--tc) 24%,var(--border))}
.t-stopwatch .big{font-size:clamp(46px,14vw,88px);font-weight:700;letter-spacing:-.04em;font-variant-numeric:tabular-nums;line-height:1;white-space:nowrap}
.t-stopwatch .big small{font-size:.5em;color:var(--muted);letter-spacing:-.02em}
.t-stopwatch .lapnow{font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums;min-height:20px}
.t-stopwatch .ctrl{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.t-stopwatch .ctrl .btn{min-width:108px;justify-content:center}
.t-stopwatch tr.best td{color:var(--success);font-weight:600}.t-stopwatch tr.worst td{color:var(--danger);font-weight:600}
.t-stopwatch td,.t-stopwatch th{font-variant-numeric:tabular-nums}
.t-stopwatch .kbd{font-size:12px;color:var(--muted);text-align:center}
.t-stopwatch kbd{font:inherit;font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface-2)}
`

export function mount(root) {
  const el = app(root, 'stopwatch', '#0ea5e9')
  css('t-stopwatch', CSS)
  const store = makeStore('stopwatch', { running: false, startedAt: 0, acc: 0, laps: [] })
  const S = store.get()
  const setTitle = pageTitle()
  const now = () => S.acc + (S.running ? Date.now() - S.startedAt : 0)
  const lastTotal = () => S.laps.at(-1)?.total || 0

  const big = h('div', { class: 'big', role: 'timer', 'aria-live': 'off' })
  const lapNow = h('div', { class: 'lapnow' })
  const ctrl = h('div', { class: 'ctrl' })
  const face = h('section', { class: 'pz-card tint face' }, big, lapNow, ctrl, h('div', { class: 'kbd pz-noprint' }, h('kbd', 'Space'), ' start / stop   ', h('kbd', 'L'), ' lap   ', h('kbd', 'R'), ' reset'))
  const lapsHost = h('section', { class: 'pz-card' })
  el.append(h('div', { class: 'pz-cols' }, face, lapsHost))

  function paint() {
    const t = now()
    const f = fmtSW(t)
    const i = f.lastIndexOf('.')
    big.textContent = ''
    big.append(f.slice(0, i), h('small', f.slice(i)))
    lapNow.textContent = S.laps.length || S.running ? `Lap ${S.laps.length + 1}: ${fmtSW(t - lastTotal())}` : 'Ready'
    if (S.running) setTitle(f.slice(0, i))
  }
  let raf = 0
  const loop = () => { paint(); raf = S.running ? requestAnimationFrame(loop) : 0 }
  const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) }
  ticker(() => { if (S.running) paint() }, 500) // keeps the tab title fresh when the tab is hidden

  function startStop() {
    if (S.running) { S.acc = now(); S.running = false; S.startedAt = 0; setTitle('') } else { S.startedAt = Date.now(); S.running = true }
    store.save(); renderCtrl(); paint(); kick()
  }
  function lap() {
    if (!S.running) return
    const t = now()
    S.laps.push({ lap: t - lastTotal(), total: t })
    store.save(); renderCtrl(); renderLaps(); paint()
  }
  function reset() { S.running = false; S.startedAt = 0; S.acc = 0; S.laps = []; store.save(); setTitle(''); renderCtrl(); renderLaps(); paint() }

  function renderCtrl() {
    const stopped = !S.running && S.acc > 0
    clear(ctrl,
      button(S.running ? 'Stop' : stopped ? 'Resume' : 'Start', { icon: S.running ? 'square' : 'play', variant: S.running ? 'danger' : 'primary', size: 'lg', onClick: startStop }),
      S.running ? button('Lap', { icon: 'flag', size: 'lg', onClick: lap }) : button('Reset', { icon: 'rotate-ccw', size: 'lg', disabled: !stopped, onClick: reset }))
  }

  function renderLaps() {
    const laps = S.laps
    if (!laps.length) { clear(lapsHost, h('h2', { class: 'pz-title' }, icon('flag'), 'Laps'), emptyState('No laps yet', 'Press Lap while the stopwatch runs to record a split.', 'flag')); return }
    const { best, worst } = bestWorst(laps)
    const avg = laps.reduce((s, l) => s + l.lap, 0) / laps.length
    const t = h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', h('tr', h('th', '#'), h('th', 'Lap time'), h('th', 'Split (total)'))),
      h('tbody', laps.map((l, i) => h('tr', { class: i === best ? 'best' : i === worst ? 'worst' : '' }, h('td', String(i + 1)), h('td', fmtSW(l.lap), i === best ? ' (fastest)' : i === worst ? ' (slowest)' : ''), h('td', fmtSW(l.total)))).reverse())))
    clear(lapsHost,
      h('h2', { class: 'pz-title' }, icon('flag'), h('span', { class: 'grow' }, 'Laps'),
        button('Copy', { icon: 'copy', size: 'sm', onClick: () => copyText(laps.map((l, i) => `Lap ${i + 1}: ${fmtSW(l.lap)} (total ${fmtSW(l.total)})`).join('\n')) }),
        button('CSV', { icon: 'download', size: 'sm', title: 'Download laps as CSV', onClick: () => download(lapsToCsv(laps), `stopwatch-${today()}.csv`, 'text/csv') })),
      laps.length > 1 ? h('div', { class: 'pz-bento', style: 'margin-bottom:12px' }, stat({ label: 'Fastest', value: fmtSW(laps[best].lap), hint: `Lap ${best + 1}`, tone: 'ok' }), stat({ label: 'Slowest', value: fmtSW(laps[worst].lap), hint: `Lap ${worst + 1}`, tone: 'bad' }), stat({ label: 'Average', value: fmtSW(avg), hint: `${laps.length} laps` })) : null,
      t)
  }

  renderCtrl(); renderLaps(); paint()
  if (S.running) kick()
  const onKey = (e) => {
    if (e.target.closest('input,textarea,select,button,dialog') || e.metaKey || e.ctrlKey) return
    if (e.code === 'Space') { e.preventDefault(); startStop() } else if (e.key === 'l' || e.key === 'L') lap()
    else if ((e.key === 'r' || e.key === 'R') && !S.running && S.acc > 0) reset()
  }
  document.addEventListener('keydown', onKey)
  return () => { document.removeEventListener('keydown', onKey); cancelAnimationFrame(raf) }
}
