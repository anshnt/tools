// Countdown timer: by duration or until a clock time, big full-screen display, WebAudio alarm, optional notification,
// remaining time in the tab title. Keeps running across reloads (it stores the end time, not a counter).
import { h, icon, button, input, field, toggle, segmented, toast, clear } from '../../lib/ui.js'
import { app, css, makeStore, ticker, pageTitle, alarm, audio, chime, askNotify, notify, ring, chip, fmtClock, parseDuration, hhmm, pad } from './_shared.js'

const PRESETS = [['1 min', 60], ['3 min', 180], ['5 min', 300], ['10 min', 600], ['15 min', 900], ['25 min', 1500], ['30 min', 1800], ['1 hour', 3600]]

/** Next occurrence of "HH:MM" strictly after `now` (ms). */
export function nextOccurrence(hm, now = Date.now()) {
  const [hh, mm] = hm.split(':').map(Number)
  const d = new Date(now)
  d.setHours(hh, mm, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

const CSS = `
.t-countdown .stage{position:relative;display:grid;place-items:center;gap:14px;padding:26px 16px 22px;border-radius:28px;background:radial-gradient(120% 100% at 50% 0%,color-mix(in srgb,var(--tc) 16%,var(--surface)),var(--surface) 70%);border:1px solid color-mix(in srgb,var(--tc) 24%,var(--border));text-align:center}
.t-countdown .dial{position:relative;width:min(100%,340px);aspect-ratio:1}
.t-countdown .dial .pz-ring{width:100%;height:100%}
.t-countdown .dial .mid{position:absolute;inset:0;display:grid;place-content:center;gap:2px}
.t-countdown .digits{font-size:clamp(44px,13vw,76px);font-weight:700;letter-spacing:-.04em;font-variant-numeric:tabular-nums;line-height:1}
.t-countdown .sub{font-size:14px;color:var(--muted);min-height:20px}
.t-countdown .stage.done .digits{color:var(--danger);animation:cd-pulse 1s ease-in-out infinite}
.t-countdown .stage.done .pz-ring circle:last-child{stroke:var(--danger)}
@keyframes cd-pulse{50%{transform:scale(1.06)}}
.t-countdown .ctrl{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.t-countdown .stage:fullscreen{background:var(--bg);border:0;border-radius:0;align-content:center;gap:28px}
.t-countdown .stage:fullscreen .dial{width:min(70vh,92vw)}
.t-countdown .stage:fullscreen .digits{font-size:clamp(60px,min(20vw,22vh),240px)}
.t-countdown .hms{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.t-countdown .hms .input{text-align:center;font-size:20px;font-weight:600;height:52px;font-variant-numeric:tabular-nums}
.t-countdown .fs{position:absolute;right:10px;top:10px}
@media (prefers-reduced-motion:reduce){.t-countdown .stage.done .digits{animation:none}}
`

export function mount(root) {
  const el = app(root, 'countdown', '#f43f5e')
  css('t-countdown', CSS)
  const store = makeStore('countdown', { mode: 'dur', h: 0, m: 10, s: 0, at: '18:00', label: '', sound: true, notify: false, status: 'idle', endAt: 0, remain: 0, total: 0 })
  const S = store.get()
  const setTitle = pageTitle()
  let stopAlarm = null

  const digits = h('div', { class: 'digits', 'aria-hidden': 'true' })
  const sub = h('div', { class: 'sub' })
  const live = h('div', { class: 'sr-only', role: 'timer', 'aria-live': 'off', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' })
  const rg = ring({ size: 340, stroke: 12 })
  const stage = h('div', { class: 'stage' }, h('div', { class: 'dial' }, rg, h('div', { class: 'mid' }, digits, sub)), live)
  const ctrl = h('div', { class: 'ctrl' })
  const fsBtn = h('button', { type: 'button', class: 'pz-ib fs', title: 'Full screen', 'aria-label': 'Full screen', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen?.().catch(() => toast('Full screen is not available here', 'error'))) }, icon('maximize'))
  if (!stage.requestFullscreen) fsBtn.hidden = true
  stage.append(fsBtn, ctrl)

  // ---------- setup form
  const hIn = input({ type: 'number', min: 0, max: 99, inputmode: 'numeric', 'aria-label': 'Hours', value: S.h, oninput: () => read() })
  const mIn = input({ type: 'number', min: 0, max: 999, inputmode: 'numeric', 'aria-label': 'Minutes', value: S.m, oninput: () => read() })
  const sIn = input({ type: 'number', min: 0, max: 59, inputmode: 'numeric', 'aria-label': 'Seconds', value: S.s, oninput: () => read() })
  const quick = input({ placeholder: 'or type 10m, 1h 30m, 90s, 1:30', 'aria-label': 'Quick duration', autocomplete: 'off', onchange: () => { const t = parseDuration(quick.value); if (Number.isFinite(t) && t > 0) { setDur(t); quick.value = '' } else if (quick.value) toast('Try something like 10m, 1h 30m or 1:30', 'error') } })
  const atIn = input({ type: 'time', 'aria-label': 'Target time', value: S.at, oninput: () => { S.at = atIn.value; store.save(); renderIdle() } })
  const label = input({ placeholder: 'What is this for? (optional)', 'aria-label': 'Label', value: S.label, maxlength: 40, oninput: () => { S.label = label.value; store.save(); renderSub() } })
  const durBox = h('div', { class: 'stack' },
    h('div', { class: 'hms' }, field('Hours', hIn), field('Minutes', mIn), field('Seconds', sIn)),
    h('div', { class: 'pz-chips' }, PRESETS.map(([l, t]) => chip(l, { onClick: () => setDur(t) }))),
    quick)
  const atBox = h('div', { class: 'stack' }, field('Count down to', atIn, 'Today if still ahead, otherwise tomorrow.'),
    h('div', { class: 'pz-chips' }, [['Lunch', '13:00'], ['Evening', '18:00'], ['Bedtime', '22:00'], ['Midnight', '00:00']].map(([l, t]) => chip(l, { onClick: () => { atIn.value = S.at = t; store.save(); renderIdle() } }))))
  const modeSeg = segmented([['dur', 'Duration'], ['at', 'Until a time']], S.mode, (v) => { S.mode = v; store.save(); syncMode(); renderIdle() }, 'Timer type')
  const soundT = toggle('Play an alarm sound', S.sound, (v) => { S.sound = v; store.save(); if (v) chime() })
  const notifT = toggle('Show a notification when done', S.notify, async (v) => {
    S.notify = v
    if (v) { const r = await askNotify(); if (r !== 'granted') { S.notify = false; notifT.input.checked = false; toast(r === 'unsupported' ? 'Notifications are not supported in this browser' : 'Notifications are blocked for this site', 'error') } }
    store.save()
  })
  const setup = h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('sliders-horizontal'), 'Set the timer'),
    h('div', { class: 'stack' }, modeSeg, durBox, atBox, label, h('div', { class: 'stack', style: 'gap:8px' }, soundT, notifT)))
  const syncMode = () => { durBox.hidden = S.mode !== 'dur'; atBox.hidden = S.mode !== 'at' }
  const secs = () => (Number(hIn.value) || 0) * 3600 + (Number(mIn.value) || 0) * 60 + (Number(sIn.value) || 0)
  function read() { S.h = Number(hIn.value) || 0; S.m = Number(mIn.value) || 0; S.s = Number(sIn.value) || 0; store.save(); renderIdle() }
  function setDur(t) { hIn.value = S.h = Math.floor(t / 3600); mIn.value = S.m = Math.floor((t % 3600) / 60); sIn.value = S.s = t % 60; store.save(); renderIdle() }

  // ---------- state machine
  const remainMs = () => (S.status === 'running' ? S.endAt - Date.now() : S.remain)
  function start() {
    let total
    if (S.status === 'paused') total = S.total
    else if (S.mode === 'at') { total = nextOccurrence(S.at) - Date.now(); S.total = total }
    else { total = secs() * 1000; if (total <= 0) { toast('Set a time above zero first', 'error'); return } S.total = total }
    if (S.status !== 'paused') S.remain = total
    S.endAt = Date.now() + S.remain
    S.status = 'running'
    store.save()
    audio()
    render()
  }
  function pause() { S.remain = Math.max(0, S.endAt - Date.now()); S.status = 'paused'; store.save(); render() }
  function reset() { stopAlarm?.(); stopAlarm = null; S.status = 'idle'; S.remain = 0; store.save(); render() }
  function add(ms) { if (S.status === 'running') S.endAt += ms; else S.remain += ms; S.total += ms; store.save(); tick() }
  function finish(silent) {
    S.status = 'done'; S.remain = 0; store.save()
    if (!silent) {
      if (S.sound) stopAlarm = alarm()
      if (S.notify) notify(S.label ? `${S.label} is done` : 'Timer finished', `Your ${fmtClock(S.total, { hours: 'auto' })} countdown is over.`)
    }
    render()
  }

  function renderSub() {
    const parts = []
    if (S.label) parts.push(S.label)
    if (S.status === 'running' || S.status === 'paused') parts.push(S.mode === 'at' ? `until ${hhmm(new Date(S.endAt))}` : `ends ${hhmm(new Date(S.endAt || Date.now() + S.remain))}`)
    if (S.status === 'paused') parts.unshift('Paused')
    if (S.status === 'done') parts.unshift("Time's up")
    sub.textContent = parts.join(' - ')
  }
  function renderIdle() {
    if (S.status !== 'idle') return
    const t = S.mode === 'at' ? nextOccurrence(S.at) - Date.now() : secs() * 1000
    digits.textContent = fmtClock(Math.max(0, t), { hours: S.mode === 'at' || t >= 3600e3 })
    rg.set(1)
    renderSub()
  }
  function tick() {
    if (S.status !== 'running') return
    const r = S.endAt - Date.now()
    if (r <= 0) { digits.textContent = fmtClock(0); rg.set(0); setTitle(''); finish(); return }
    const txt = fmtClock(r, { hours: r >= 3600e3 || S.total >= 3600e3 })
    if (digits.textContent !== txt) { digits.textContent = txt; live.textContent = r % 60000 < 1000 ? `${Math.ceil(r / 60000)} minutes left` : live.textContent }
    rg.set(r / S.total)
    setTitle(`${txt}${S.label ? ' ' + S.label : ''}`)
  }
  function render() {
    stage.classList.toggle('done', S.status === 'done')
    const dis = S.status === 'running' || S.status === 'paused'
    for (const n of [hIn, mIn, sIn, atIn, quick]) n.disabled = dis
    modeSeg.style.pointerEvents = dis ? 'none' : ''
    setup.style.opacity = dis ? '.6' : ''
    const c = []
    if (S.status === 'idle') c.push(button('Start', { icon: 'play', variant: 'primary', size: 'lg', onClick: start }))
    else if (S.status === 'running') c.push(button('Pause', { icon: 'pause', variant: 'primary', size: 'lg', onClick: pause }), button('+1 min', { icon: 'plus', onClick: () => add(60000) }), button('Reset', { icon: 'rotate-ccw', variant: 'ghost', onClick: reset }))
    else if (S.status === 'paused') c.push(button('Resume', { icon: 'play', variant: 'primary', size: 'lg', onClick: start }), button('+1 min', { icon: 'plus', onClick: () => add(60000) }), button('Reset', { icon: 'rotate-ccw', variant: 'ghost', onClick: reset }))
    else c.push(button(stopAlarm ? 'Stop alarm' : 'Done', { icon: 'bell-off', variant: 'primary', size: 'lg', onClick: reset }), button('Restart', { icon: 'rotate-ccw', onClick: () => { const t = S.total; reset(); S.mode === 'dur' && setDur(Math.round(t / 1000)); start() } }), button('+5 min', { icon: 'plus', onClick: () => { stopAlarm?.(); stopAlarm = null; S.total = 300000; S.endAt = Date.now() + 300000; S.status = 'running'; store.save(); render() } }))
    clear(ctrl, c)
    if (S.status === 'idle') { setTitle(''); renderIdle() }
    else if (S.status === 'paused') { digits.textContent = fmtClock(S.remain, { hours: S.total >= 3600e3 }); rg.set(S.total ? S.remain / S.total : 1); setTitle(''); renderSub() }
    else if (S.status === 'done') { digits.textContent = fmtClock(0); rg.set(0); setTitle(''); renderSub() }
    else { renderSub(); tick() }
  }

  el.append(h('div', { class: 'pz-cols wide-l' }, stage, setup))
  syncMode()
  if (S.status === 'running' && S.endAt <= Date.now()) finish(true)
  render()
  ticker(tick, 250)
  const onKey = (e) => {
    if (e.target.closest('input,textarea,select,button,dialog') || e.metaKey || e.ctrlKey) return
    if (e.code === 'Space') { e.preventDefault(); if (S.status === 'running') pause(); else if (S.status !== 'done') start() }
  }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}
