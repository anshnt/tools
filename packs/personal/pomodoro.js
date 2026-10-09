// Pomodoro timer: focus / short break / long break with auto-start options, task list with estimated and completed
// pomodoros, daily stats chart, sound and notifications. Stores the end time so it survives reloads.
import { h, icon, button, input, number, field, toggle, segmented, toast, clear } from '../../lib/ui.js'
import { app, css, makeStore, uid, ticker, pageTitle, alarm, audio, chime, tone, askNotify, notify, ring, ib, checkBtn, stat, emptyState, fmtClock, makeChart, today, addDays, fmtDate, num, plural, clamp, dataBar, grip, sortable } from './_shared.js'

export const PHASES = { work: { label: 'Focus', color: '#ef4444', key: 'work' }, short: { label: 'Short break', color: '#10b981', key: 'short' }, long: { label: 'Long break', color: '#0ea5e9', key: 'long' } }
const DEFAULTS = { work: 25, short: 5, long: 15, every: 4, autoBreak: true, autoWork: false, sound: true, notify: false }

/** Phase after finishing `phase`, given how many focus sessions happened since the last long break. */
export function nextPhase(phase, sinceLong, every) {
  if (phase !== 'work') return { phase: 'work', sinceLong: phase === 'long' ? 0 : sinceLong }
  const n = sinceLong + 1
  return n >= every ? { phase: 'long', sinceLong: 0 } : { phase: 'short', sinceLong: n }
}
/** Consecutive days (ending today, or yesterday if today is empty) with at least one finished pomodoro. */
export function pomoStreak(log, t = today()) {
  let d = log[t]?.n ? t : addDays(t, -1), n = 0
  while (log[d]?.n) { n++; d = addDays(d, -1) }
  return n
}

const CSS = `
.t-pomo .stage{display:grid;place-items:center;gap:14px;padding:22px 16px 20px;border-radius:28px;text-align:center;background:radial-gradient(120% 100% at 50% 0%,color-mix(in srgb,var(--tc) 17%,var(--surface)),var(--surface) 70%);border:1px solid color-mix(in srgb,var(--tc) 26%,var(--border));transition:background .5s,border-color .5s;--tc:var(--pc)}
.t-pomo .dial{position:relative;width:min(100%,300px);aspect-ratio:1}
.t-pomo .dial .pz-ring{width:100%;height:100%}
.t-pomo .dial .mid{position:absolute;inset:0;display:grid;place-content:center;gap:2px}
.t-pomo .digits{font-size:clamp(46px,13vw,68px);font-weight:700;letter-spacing:-.04em;font-variant-numeric:tabular-nums;line-height:1}
.t-pomo .sub{font-size:13.5px;color:var(--muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:20px}
.t-pomo .ctrl{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.t-pomo .dots{display:flex;gap:7px;justify-content:center}
.t-pomo .dots i{width:10px;height:10px;border-radius:50%;background:var(--surface-3);transition:background .3s,transform .3s var(--spring)}
.t-pomo .dots i.on{background:var(--pc);transform:scale(1.15)}
.t-pomo .task{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;gap:6px 8px;padding:8px 6px 8px 4px;border-radius:14px;border:1px solid var(--border);background:var(--surface);cursor:pointer;transition:border-color .2s,background .2s}
.t-pomo .task.cur{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 9%,var(--surface))}
.t-pomo .task.done .tx{text-decoration:line-through;color:var(--muted)}
.t-pomo .task .tx{min-width:0;overflow-wrap:anywhere;font-size:14.5px}
.t-pomo .task .pm{display:flex;align-items:center;gap:2px;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.t-pomo .task .pm button{width:24px;height:24px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text-2);cursor:pointer;padding:0;line-height:1}
.t-pomo .tasks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.t-pomo .chartbox{position:relative;height:210px}
.t-pomo .sets{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
`

export function mount(root) {
  const el = app(root, 'pomo', '#ef4444')
  css('t-pomo', CSS)
  const store = makeStore('pomodoro', { cfg: { ...DEFAULTS }, phase: 'work', status: 'idle', endAt: 0, remain: 0, total: 0, sinceLong: 0, tasks: [], cur: '', log: {} }, (d) => { d.cfg = { ...DEFAULTS, ...d.cfg }; d.tasks ||= []; d.log ||= {} })
  const S = store.get()
  const cfg = S.cfg
  const setTitle = pageTitle()
  let stopAlarm = null

  const digits = h('div', { class: 'digits', role: 'timer' })
  const sub = h('div', { class: 'sub' })
  const rg = ring({ size: 300, stroke: 12, color: 'var(--pc)' })
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' })
  const ctrl = h('div', { class: 'ctrl' })
  const phaseSeg = segmented(Object.values(PHASES).map((p) => [p.key, p.label]), S.phase, (v) => { if (S.status === 'running') { phaseSeg.set(S.phase); return } stopAlarm?.(); setPhase(v) }, 'Session type')
  const stage = h('div', { class: 'stage' }, phaseSeg, h('div', { class: 'dial' }, rg, h('div', { class: 'mid' }, digits, sub)), dots, ctrl)
  const tasksHost = h('div')
  const statsHost = h('div')
  const settingsHost = h('div')
  const dataHost = h('div')
  const chartBox = h('div', { class: 'chartbox' }, h('canvas', { 'aria-label': 'Focus minutes per day, last 14 days', role: 'img' }))
  const doc = h('div', { class: 'pz-cols wide-l' }, stage, tasksHost)
  el.append(doc, statsHost, settingsHost, dataHost)

  const secs = (p = S.phase) => Math.round(clamp(Number(cfg[p]) || 1, 1, 180) * 60)
  const remainMs = () => (S.status === 'running' ? S.endAt - Date.now() : S.remain)

  function setPhase(p) {
    S.phase = p; S.status = 'idle'; S.total = secs(p) * 1000; S.remain = S.total
    store.save(); phaseSeg.set(p); paint(); renderCtrl()
  }
  function start() {
    audio()
    if (S.status === 'idle') { S.total = secs() * 1000; S.remain = S.total }
    S.endAt = Date.now() + S.remain; S.status = 'running'
    store.save(); renderCtrl(); tick()
  }
  function pause() { S.remain = Math.max(0, S.endAt - Date.now()); S.status = 'paused'; store.save(); renderCtrl(); paint() }
  function reset() { S.status = 'idle'; S.total = secs() * 1000; S.remain = S.total; store.save(); renderCtrl(); paint() }
  function skip() { stopAlarm?.(); setPhase(S.phase === 'work' ? (S.sinceLong + 1 >= cfg.every ? 'long' : 'short') : 'work') }

  function logFocus() {
    const t = today()
    const e = (S.log[t] ||= { n: 0, min: 0 })
    e.n++; e.min += Math.round(secs('work') / 60)
    const task = S.tasks.find((x) => x.id === S.cur)
    if (task) { task.count = (task.count || 0) + 1; if (task.count === task.est) toast(`"${task.text}" reached its ${plural(task.est, 'pomodoro')} estimate`, 'success') }
  }
  function advance(completed) {
    if (completed && S.phase === 'work') logFocus()
    const n = nextPhase(S.phase, S.sinceLong, cfg.every)
    S.sinceLong = n.sinceLong
    S.phase = n.phase; S.total = secs(n.phase) * 1000; S.remain = S.total; S.status = 'idle'
    phaseSeg.set(S.phase)
    const auto = n.phase === 'work' ? cfg.autoWork : cfg.autoBreak
    store.save(); renderTasks(); renderStats(); paint()
    if (completed && auto) start(); else renderCtrl()
  }
  function finish() {
    const was = S.phase
    if (cfg.sound) { if (cfg.autoBreak || cfg.autoWork) [660, 880].forEach((f, i) => tone(f, { at: i * 0.18, dur: 0.5 })); else stopAlarm = alarm({ maxMs: 8000 }) }
    if (cfg.notify) notify(was === 'work' ? 'Focus session complete' : 'Break is over', was === 'work' ? 'Time for a break.' : 'Ready for the next focus session?')
    toast(was === 'work' ? 'Focus session complete. Nice work!' : 'Break is over', 'success')
    advance(true)
  }

  function paint() {
    const P = PHASES[S.phase]
    stage.style.setProperty('--pc', P.color)
    el.style.setProperty('--pc', P.color)
    const r = Math.max(0, remainMs())
    const txt = fmtClock(S.status === 'idle' ? secs() * 1000 : r)
    digits.textContent = txt
    rg.set(S.status === 'idle' ? 1 : S.total ? r / S.total : 1)
    const task = S.tasks.find((x) => x.id === S.cur && !x.done)
    sub.textContent = S.status === 'paused' ? 'Paused' : task && S.phase === 'work' ? task.text : P.label
    const filled = S.phase === 'long' ? cfg.every : S.sinceLong
    clear(dots, Array.from({ length: cfg.every }, (_, i) => h('i', { class: i < filled ? 'on' : '' })))
    setTitle(S.status === 'running' ? `${txt} ${P.label}` : '')
  }
  function renderCtrl() {
    clear(ctrl,
      S.status === 'running' ? button('Pause', { icon: 'pause', variant: 'primary', size: 'lg', onClick: pause }) : button(S.status === 'paused' ? 'Resume' : 'Start', { icon: 'play', variant: 'primary', size: 'lg', onClick: start }),
      button('Skip', { icon: 'skip-forward', title: 'Skip to the next session', onClick: skip }),
      S.status !== 'idle' ? button('Reset', { icon: 'rotate-ccw', variant: 'ghost', onClick: reset }) : null)
  }
  function tick() {
    if (S.status !== 'running') return
    if (S.endAt - Date.now() <= 0) { finish(); return }
    paint()
  }

  // ---------- tasks
  const taskIn = input({ placeholder: 'Add a task and press Enter', 'aria-label': 'New task', maxlength: 120 })
  const estIn = input({ type: 'number', min: 1, max: 20, value: 2, 'aria-label': 'Estimated pomodoros', style: 'width:72px' })
  const addTask = () => {
    const text = taskIn.value.trim()
    if (!text) return
    const t = { id: uid(), text, est: clamp(parseInt(estIn.value) || 1, 1, 20), count: 0, done: false }
    S.tasks.push(t)
    if (!S.cur) S.cur = t.id
    taskIn.value = ''; store.save(); renderTasks(); paint(); taskIn.focus()
  }
  taskIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTask() } })
  const taskList = h('ul', { class: 'tasks' })
  sortable({ root: taskList, containers: () => [taskList], item: '.task', handle: '.pz-grip', onDrop: ({ ids }) => { S.tasks = ids.map((id) => S.tasks.find((t) => t.id === id)); store.save() } })
  function renderTasks() {
    const open = S.tasks.filter((t) => !t.done)
    const estLeft = open.reduce((s, t) => s + Math.max(0, t.est - t.count), 0)
    clear(taskList, S.tasks.map((t) => h('li', { class: ['task', t.id === S.cur && !t.done && 'cur', t.done && 'done'], 'data-id': t.id, onclick: (e) => { if (e.target.closest('button,.pz-grip')) return; if (!t.done) { S.cur = t.id; store.save(); renderTasks(); paint() } } },
      grip(), checkBtn(t.done, (v) => { t.done = v; if (v && S.cur === t.id) S.cur = S.tasks.find((x) => !x.done && x !== t)?.id || ''; store.save(); setTimeout(() => { renderTasks(); paint() }, 380) }, `Mark ${t.text} done`, 'var(--pc)'),
      h('span', { class: 'tx' }, t.text),
      h('span', { class: 'pm' }, h('button', { type: 'button', 'aria-label': 'Fewer estimated pomodoros', onclick: () => { t.est = Math.max(1, t.est - 1); store.save(); renderTasks() } }, '-'), h('span', { title: 'Completed / estimated pomodoros' }, `${t.count}/${t.est}`), h('button', { type: 'button', 'aria-label': 'More estimated pomodoros', onclick: () => { t.est = Math.min(20, t.est + 1); store.save(); renderTasks() } }, '+'), ib('x', `Delete ${t.text}`, () => { S.tasks = S.tasks.filter((x) => x !== t); if (S.cur === t.id) S.cur = S.tasks.find((x) => !x.done)?.id || ''; store.save(); renderTasks(); paint() }, 'danger')))))
    clear(tasksHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('list-checks'), h('span', { class: 'grow' }, 'Tasks'), open.length ? h('span', { class: 'pz-note' }, `${plural(open.length, 'open task')}, about ${plural(estLeft, 'pomodoro')} left`) : null),
      h('div', { class: 'stack' }, h('div', { class: 'pz-row nowrap pz-noprint' }, taskIn, estIn, button('', { icon: 'plus', variant: 'primary', ariaLabel: 'Add task', onClick: addTask })),
        S.tasks.length ? taskList : emptyState('Nothing planned', 'Add what you want to focus on. Tap a task to make it the current one.', 'list-checks'),
        S.tasks.some((t) => t.done) ? button('Clear completed', { icon: 'check-check', size: 'sm', variant: 'ghost', onClick: () => { S.tasks = S.tasks.filter((t) => !t.done); store.save(); renderTasks() } }) : null)))
  }

  // ---------- stats
  let chart
  const days = (n) => Array.from({ length: n }, (_, i) => addDays(today(), i - n + 1))
  const build = (c) => ({ type: 'bar', data: { labels: days(14).map((d) => fmtDate(d, { day: 'numeric', month: 'short' })), datasets: [{ label: 'Focus minutes', data: days(14).map((d) => S.log[d]?.min || 0), backgroundColor: PHASES.work.color, borderRadius: 6, maxBarThickness: 26 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: c.muted, maxRotation: 0, autoSkip: true } }, y: { beginAtZero: true, grid: { color: c.grid }, ticks: { color: c.muted, precision: 0 } } } } })
  const tilesHost = h('div')
  const chartCard = h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('chart-column'), 'Your focus'), tilesHost, chartBox)
  statsHost.append(chartCard)
  makeChart(chartBox.querySelector('canvas'), build).then((c) => { chart = c }).catch(() => { chartBox.replaceChildren(h('div', { class: 'pz-note' }, 'The chart needs an internet connection to load once.')) })
  function renderStats() {
    const t = S.log[today()] || { n: 0, min: 0 }
    const total = Object.values(S.log).reduce((s, e) => s + e.n, 0)
    const week = days(7).reduce((s, d) => s + (S.log[d]?.min || 0), 0)
    clear(tilesHost, h('div', { class: 'pz-bento', style: 'margin-bottom:14px' },
      stat({ label: 'Today', value: String(t.n), hint: plural(t.n, 'pomodoro'), icon: 'target', hero: true }),
      stat({ label: 'Focus time today', value: `${num(t.min / 60, 1)} h`, hint: `${t.min} min`, icon: 'clock', tone: 'info' }),
      stat({ label: 'Last 7 days', value: `${num(week / 60, 1)} h`, icon: 'calendar-days', tone: 'ok' }),
      stat({ label: 'Day streak', value: String(pomoStreak(S.log)), hint: `${total} pomodoros in total`, icon: 'flame', tone: 'warn' })))
    chart?.refresh(build)
  }

  // ---------- settings
  function renderSettings() {
    const n = (k, label, max = 180) => field(label, number(cfg[k], { min: 1, max, step: 1, ariaLabel: label, onInput: (v) => { if (Number.isFinite(v) && v >= 1) { cfg[k] = clamp(Math.round(v), 1, max); store.save(); if (S.status === 'idle') { S.total = secs() * 1000; S.remain = S.total; paint() } else paint() } } }))
    const notif = toggle('Desktop notifications', cfg.notify, async (v) => { cfg.notify = v; if (v) { const r = await askNotify(); if (r !== 'granted') { cfg.notify = false; notif.input.checked = false; toast('Notifications are not available or blocked', 'error') } } store.save() })
    clear(settingsHost, h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('settings-2'), 'Settings'),
      h('div', { class: 'stack' }, h('div', { class: 'sets' }, n('work', 'Focus (min)'), n('short', 'Short break (min)'), n('long', 'Long break (min)'), n('every', 'Long break every', 12)),
        h('div', { class: 'pz-row' }, toggle('Auto-start breaks', cfg.autoBreak, (v) => { cfg.autoBreak = v; store.save() }), toggle('Auto-start focus', cfg.autoWork, (v) => { cfg.autoWork = v; store.save() }), toggle('Sound', cfg.sound, (v) => { cfg.sound = v; store.save(); if (v) chime() }), notif))))
    clear(dataHost, dataBar({ kind: 'pomodoro', get: () => S, set: (d) => { Object.assign(S, d); S.cfg = { ...DEFAULTS, ...d.cfg }; Object.assign(cfg, S.cfg); store.save(); init() }, reset: () => { Object.assign(S, { cfg: { ...DEFAULTS }, phase: 'work', status: 'idle', endAt: 0, remain: 0, total: 0, sinceLong: 0, tasks: [], cur: '', log: {} }); Object.assign(cfg, DEFAULTS); store.save(); init() } }))
  }

  function init() {
    if (S.status === 'running' && S.endAt <= Date.now()) { S.status = 'idle'; S.total = secs() * 1000; S.remain = S.total }
    if (!S.total) { S.total = secs() * 1000; S.remain = S.total }
    phaseSeg.set(S.phase)
    renderCtrl(); renderTasks(); renderStats(); renderSettings(); paint()
  }
  init()
  ticker(tick, 250)
  const onKey = (e) => {
    if (e.target.closest('input,textarea,select,button,dialog') || e.metaKey || e.ctrlKey) return
    if (e.code === 'Space') { e.preventDefault(); S.status === 'running' ? pause() : start() }
  }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}
