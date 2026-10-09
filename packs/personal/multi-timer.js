// Multi-timer: run several named timers at once (kitchen, workouts, games) with presets and alarms.
// Timers store their end time, so they keep going across reloads.
import { h, icon, button, input, toggle, toast, clear } from '../../lib/ui.js'
import { app, css, makeStore, uid, ticker, pageTitle, alarm, audio, chime, askNotify, notify, ring, chip, ib, fmtClock, parseDuration, promptBox, emptyState, PALETTE, plural } from './_shared.js'

const DEFAULT_PRESETS = [['Boiled egg', 420], ['Tea', 180], ['Pasta', 600], ['Rice', 900], ['Plank', 60], ['Rest', 90], ['HIIT', 30], ['Chess clock', 600]]

const CSS = `
.t-multi .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:14px}
.t-multi .tm{display:grid;justify-items:center;gap:8px;text-align:center;padding:16px 14px 14px;--tc:var(--c)}
.t-multi .tm .nm{font-weight:600;font-size:15px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:none;border:0;color:var(--text);cursor:text;padding:2px 8px;border-radius:8px}
.t-multi .tm .nm:hover{background:var(--surface-2)}
.t-multi .dial{position:relative;width:min(100%,150px);aspect-ratio:1}
.t-multi .dial .pz-ring{width:100%;height:100%}
.t-multi .dial .t{position:absolute;inset:0;display:grid;place-items:center;font-size:25px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.t-multi .tm .btns{display:flex;gap:4px;justify-content:center;flex-wrap:wrap}
.t-multi .tm.done{border-color:var(--danger);animation:mt-pulse 1s ease-in-out infinite}
.t-multi .tm.done .t{color:var(--danger)}
.t-multi .tm .st{font-size:12px;color:var(--muted);min-height:16px}
@keyframes mt-pulse{50%{box-shadow:0 0 0 6px color-mix(in srgb,var(--danger) 25%,transparent)}}
.t-multi .addrow{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto auto;gap:8px;align-items:center}
@media (max-width:620px){.t-multi .addrow{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.t-multi .addrow .btn{width:100%;justify-content:center}}
.t-multi .xchip{display:inline-flex;align-items:center;gap:0}
.t-multi .xchip .pz-ib{width:26px;height:26px;margin-left:-6px}
@media (prefers-reduced-motion:reduce){.t-multi .tm.done{animation:none}}
`

export function mount(root) {
  const el = app(root, 'multi', '#8b5cf6')
  css('t-multi', CSS)
  const store = makeStore('multitimer', { timers: [], presets: [], sound: true, notify: false })
  const S = store.get()
  const setTitle = pageTitle()
  const dials = new Map()
  let stopAlarm = null

  const nameIn = input({ placeholder: 'Name, e.g. Pasta', 'aria-label': 'Timer name', maxlength: 30, enterkeyhint: 'next' })
  const durIn = input({ placeholder: 'Time: 10m, 1:30, 90s', 'aria-label': 'Duration', autocomplete: 'off' })
  const add = () => {
    const sec = parseDuration(durIn.value || '5m')
    if (!Number.isFinite(sec) || sec <= 0) { toast('Enter a time like 10m, 1h 30m, 90s or 1:30', 'error'); durIn.focus(); return }
    addTimer(nameIn.value.trim(), sec * 1000, true); nameIn.value = ''; durIn.value = ''
  }
  for (const i of [nameIn, durIn]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add() } })
  const starBtn = ib('star', 'Save as preset', () => {
    const sec = parseDuration(durIn.value)
    if (!nameIn.value.trim() || !Number.isFinite(sec) || sec <= 0) { toast('Type a name and a time first', 'error'); return }
    S.presets.push([nameIn.value.trim(), sec]); store.save(); renderPresets(); toast('Preset saved', 'success')
  })
  const addBar = h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('alarm-clock-plus'), 'New timer'),
    h('div', { class: 'stack' }, h('div', { class: 'addrow' }, nameIn, durIn, button('Add and start', { icon: 'play', variant: 'primary', onClick: add }), starBtn),
      h('div', { class: 'pz-chips', 'aria-label': 'Presets', id: 'presets' })))
  const presetsHost = addBar.querySelector('#presets')
  const tools = h('div', { class: 'pz-row pz-noprint' })
  const grid = h('div', { class: 'grid' })
  const sound = toggle('Alarm sound', S.sound, (v) => { S.sound = v; store.save(); if (v) chime() })
  const notif = toggle('Notifications', S.notify, async (v) => {
    S.notify = v
    if (v) { const r = await askNotify(); if (r !== 'granted') { S.notify = false; notif.input.checked = false; toast('Notifications are not available or blocked', 'error') } }
    store.save()
  })
  el.append(addBar, tools, grid, h('div', { class: 'pz-row pz-noprint' }, sound, notif))

  function renderPresets() {
    clear(presetsHost, DEFAULT_PRESETS.map(([n, t]) => chip(`${n} ${fmtClock(t * 1000)}`, { onClick: () => addTimer(n, t * 1000, true) })),
      S.presets.map(([n, t], i) => h('span', { class: 'xchip' }, chip(`${n} ${fmtClock(t * 1000)}`, { ic: 'star', onClick: () => addTimer(n, t * 1000, true) }), ib('x', `Remove preset ${n}`, () => { S.presets.splice(i, 1); store.save(); renderPresets() }))))
  }

  function addTimer(name, ms, start) {
    audio()
    const t = { id: uid(), name: name || `Timer ${S.timers.length + 1}`, total: ms, status: 'idle', endAt: 0, remain: ms, color: PALETTE[S.timers.length % PALETTE.length] }
    S.timers.push(t)
    if (start) run(t, true)
    store.save(); render()
  }
  const left = (t) => (t.status === 'running' ? t.endAt - Date.now() : t.remain)
  function run(t, silent) { t.endAt = Date.now() + t.remain; t.status = 'running'; if (!silent) { store.save(); render() } }
  function pause(t) { t.remain = Math.max(0, t.endAt - Date.now()); t.status = 'paused'; store.save(); render() }
  function resetT(t) { t.status = 'idle'; t.remain = t.total; syncAlarm(); store.save(); render() }
  function addTime(t, ms) { if (t.status === 'running') t.endAt += ms; else t.remain += ms; t.total += ms; if (t.status === 'done') { t.status = 'paused'; t.remain = ms; t.total = ms; run(t, true) } store.save(); render() }
  function remove(t) { S.timers = S.timers.filter((x) => x !== t); syncAlarm(); store.save(); render() }
  function syncAlarm() { if (!S.timers.some((t) => t.status === 'done') && stopAlarm) { stopAlarm(); stopAlarm = null } }

  function card(t, i) {
    const rg = ring({ size: 150, stroke: 10, color: t.color })
    const time = h('div', { class: 't' })
    const st = h('div', { class: 'st' })
    const upd = () => {
      const r = Math.max(0, left(t))
      time.textContent = fmtClock(r, { hours: t.total >= 3600e3 })
      rg.set(t.status === 'done' ? 0 : t.total ? r / t.total : 1)
      st.textContent = t.status === 'running' ? `ends ${new Date(t.endAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : t.status === 'paused' ? 'Paused' : t.status === 'done' ? "Time's up" : fmtClock(t.total, { hours: t.total >= 3600e3 }) + ' timer'
    }
    dials.set(t.id, upd)
    upd()
    const main = t.status === 'running' ? ib('pause', `Pause ${t.name}`, () => pause(t)) : t.status === 'done' ? ib('bell-off', `Dismiss ${t.name}`, () => resetT(t)) : ib('play', `Start ${t.name}`, () => run(t))
    return h('section', { class: ['pz-card', 'tm', 'pz-rise', t.status === 'done' && 'done'], style: { '--c': t.color, '--i': Math.min(i, 8) } },
      h('button', { type: 'button', class: 'nm', title: 'Rename', onclick: async () => { const n = await promptBox({ title: 'Rename timer', label: 'Name', value: t.name }); if (n) { t.name = n; store.save(); render() } } }, t.name),
      h('div', { class: 'dial' }, rg, time), st,
      h('div', { class: 'btns' }, main, ib('plus', `Add one minute to ${t.name}`, () => addTime(t, 60000)), ib('rotate-ccw', `Reset ${t.name}`, () => resetT(t)), ib('trash-2', `Delete ${t.name}`, () => remove(t), 'danger')))
  }

  function render() {
    dials.clear()
    clear(tools, S.timers.length ? [
      button('Start all', { icon: 'play', size: 'sm', onClick: () => { S.timers.forEach((t) => { if (t.status === 'idle' || t.status === 'paused') run(t, true) }); store.save(); render() } }),
      button('Pause all', { icon: 'pause', size: 'sm', onClick: () => { S.timers.filter((t) => t.status === 'running').forEach((t) => { t.remain = Math.max(0, t.endAt - Date.now()); t.status = 'paused' }); store.save(); render() } }),
      button('Clear all', { icon: 'trash-2', size: 'sm', variant: 'ghost', onClick: () => { S.timers = []; syncAlarm(); store.save(); render() } }),
      h('span', { class: 'pz-note' }, `${plural(S.timers.filter((t) => t.status === 'running').length, 'timer')} running`)] : null)
    clear(grid, S.timers.length ? S.timers.map(card) : h('div', { style: 'grid-column:1/-1' }, emptyState('No timers yet', 'Pick a preset above or type a name and a time. Run as many as you like at once.', 'alarm-clock')))
  }

  function tick() {
    let next = Infinity, nm = ''
    for (const t of S.timers) {
      if (t.status !== 'running') continue
      const r = t.endAt - Date.now()
      if (r <= 0) {
        t.status = 'done'; t.remain = 0; store.save()
        if (S.sound && !stopAlarm) stopAlarm = alarm()
        if (S.notify) notify(`${t.name} is done`, 'Your timer finished.')
        toast(`${t.name} is done`, 'success')
        render()
        continue
      }
      if (r < next) { next = r; nm = t.name }
      dials.get(t.id)?.()
    }
    setTitle(next < Infinity ? `${fmtClock(next)} ${nm}` : '')
  }

  renderPresets()
  for (const t of S.timers) if (t.status === 'running' && t.endAt <= Date.now()) { t.status = 'done'; t.remain = 0 }
  render()
  ticker(tick, 250)
}
