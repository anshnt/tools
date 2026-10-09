// Habit tracker: habits with schedules (set weekdays or N times a week), a check-in week grid, streaks that respect the
// schedule, and a yearly heatmap per habit or for everything. Data stays in this browser with export/import.
import { h, icon, button, input, field, segmented, toast, clear, modal } from '../../lib/ui.js'
import { app, css, makeStore, uid, today, addDays, parseYmd, ymd, fmtDate, startOfWeek, daysBetween, stat, emptyState, ib, chip, checkBtn, swatches, PALETTE, DAY_NAMES, dataBar, confirmBox, plural, num, pad } from './_shared.js'

/** Weekday index with Monday = 0. */
export const dow = (s) => (parseYmd(s).getDay() + 6) % 7
/** Is `d` a day this habit is scheduled on? Weekly-target habits count every day as available. */
export const isScheduled = (hb, d) => (hb.mode === 'weekly' ? true : hb.days.includes(dow(d)))
const weekCount = (hb, done, ws) => { let n = 0; for (let i = 0; i < 7; i++) if (done[addDays(ws, i)]) n++; return n }

/**
 * Current and best streak.
 * Day-scheduled habits: consecutive scheduled days done (unscheduled days are skipped, today does not break it until it ends).
 * Weekly-target habits: consecutive weeks reaching the target (the running week only counts once it is met).
 */
export function calcStreaks(hb, done, now = today()) {
  const start = hb.created && hb.created <= now ? hb.created : now
  let cur = 0, best = 0, run = 0
  if (hb.mode === 'weekly') {
    const target = Math.max(1, hb.perWeek || 1)
    const w0 = startOfWeek(start), wNow = startOfWeek(now)
    for (let ws = w0; ws <= wNow; ws = addDays(ws, 7)) {
      const ok = weekCount(hb, done, ws) >= target
      if (ok) { run++; best = Math.max(best, run) } else if (ws !== wNow) run = 0
    }
    for (let ws = wNow; ws >= w0; ws = addDays(ws, -7)) {
      if (weekCount(hb, done, ws) >= target) cur++
      else if (ws !== wNow) break
    }
    return { cur, best }
  }
  const first = Object.keys(done).sort()[0]
  const from = first && first < start ? first : start
  for (let d = from; d <= now; d = addDays(d, 1)) {
    if (done[d]) { run++; best = Math.max(best, run) } else if (isScheduled(hb, d) && d !== now) run = 0
  }
  for (let d = now; d >= from; d = addDays(d, -1)) {
    if (done[d]) cur++
    else if (isScheduled(hb, d) && d !== now) break
  }
  return { cur, best }
}
/** Completion rate over the last `n` days among scheduled days (weekly habits: done days vs target). */
export function completionRate(hb, done, n = 30, now = today()) {
  let due = 0, ok = 0
  const from = hb.created && hb.created > addDays(now, -n + 1) ? hb.created : addDays(now, -n + 1)
  for (let d = from; d <= now; d = addDays(d, 1)) {
    if (hb.mode === 'weekly') { if (done[d]) ok++; continue }
    if (isScheduled(hb, d)) { due++; if (done[d]) ok++ }
  }
  if (hb.mode === 'weekly') { const weeks = Math.max(1, (daysBetween(from, now) + 1) / 7); due = Math.round(weeks * (hb.perWeek || 1)); return due ? Math.min(1, ok / due) : 0 }
  return due ? ok / due : 0
}
export const scheduleLabel = (hb) => (hb.mode === 'weekly' ? `${hb.perWeek} times a week` : hb.days.length === 7 ? 'Every day' : hb.days.join() === '0,1,2,3,4' ? 'Weekdays' : hb.days.join() === '5,6' ? 'Weekends' : hb.days.map((d) => DAY_NAMES[d]).join(', '))

const CSS = `
.t-habit .wk{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}
.t-habit .hrow{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1.9fr);gap:10px 16px;align-items:center;padding:12px;border-radius:18px;border:1px solid var(--border);background:var(--surface);--hc:var(--tc);transition:border-color .2s,box-shadow .2s}
.t-habit .hrow.sel{border-color:var(--hc);box-shadow:0 0 0 3px color-mix(in srgb,var(--hc) 16%,transparent)}
.t-habit .hname{display:flex;align-items:center;gap:10px;min-width:0;cursor:pointer;background:none;border:0;text-align:left;color:var(--text);padding:0}
.t-habit .hname .dot{width:38px;height:38px;border-radius:13px;flex:none;display:grid;place-items:center;font-size:19px;background:color-mix(in srgb,var(--hc) 18%,var(--surface));color:var(--hc);border:1px solid color-mix(in srgb,var(--hc) 30%,var(--border))}
.t-habit .hname b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.t-habit .hname small{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--muted);margin-top:1px;flex-wrap:wrap}
.t-habit .flame{display:inline-flex;align-items:center;gap:3px;font-weight:650;color:var(--warning)}
.t-habit .flame .icon{width:13px;height:13px}
.t-habit .days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.t-habit .cell{display:grid;justify-items:center;gap:3px;font-size:11px;color:var(--muted);padding:4px 0;border-radius:12px}
.t-habit .cell.today{background:color-mix(in srgb,var(--hc) 10%,transparent);color:var(--text);font-weight:650}
.t-habit .cell.off .pz-check{opacity:.35;border-style:dashed}
.t-habit .cell.future .pz-check{opacity:.18;pointer-events:none}
.t-habit .hrow .pz-check{--ck:var(--hc)}
.t-habit .heat{overflow-x:auto;padding-bottom:6px}
.t-habit .heat .inner{min-width:620px}
.t-habit .months{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);font-size:11px;color:var(--muted);height:16px;margin-left:24px}
.t-habit .hm{display:grid;grid-template-columns:20px minmax(0,1fr);gap:4px}
.t-habit .hm .dn{display:grid;grid-template-rows:repeat(7,1fr);font-size:10px;color:var(--muted);gap:3px}
.t-habit .hm .g{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,1fr);grid-auto-columns:minmax(0,1fr);gap:3px}
.t-habit .hm .g i{aspect-ratio:1;border-radius:3px;background:var(--surface-3);min-width:0}
.t-habit .hm .g i.none{background:transparent;outline:1px dashed var(--border)}
.t-habit .hm .g i.fut{background:transparent;outline:1px solid var(--border);opacity:.5}
.t-habit .hm .g i.void{background:transparent}
.t-habit .hm .g i.l1{background:color-mix(in srgb,var(--hc) 30%,var(--surface-3))}.t-habit .hm .g i.l2{background:color-mix(in srgb,var(--hc) 55%,var(--surface-3))}.t-habit .hm .g i.l3{background:color-mix(in srgb,var(--hc) 80%,var(--surface-3))}.t-habit .hm .g i.l4{background:var(--hc)}
.t-habit .ylg{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);justify-content:flex-end;margin-top:8px}
.t-habit .ylg i{width:11px;height:11px;border-radius:3px;background:var(--surface-3)}
.t-habit .dsel{display:flex;gap:6px;flex-wrap:wrap}
@media (max-width:700px){.t-habit .hrow{grid-template-columns:minmax(0,1fr)}}
`

const blank = () => ({ habits: [], log: {}, sel: 'all' })

export function mount(root) {
  const el = app(root, 'habit', '#10b981')
  css('t-habit', CSS)
  const store = makeStore('habits', blank(), (d) => { d.habits ||= []; d.log ||= {}; d.sel ||= 'all'; for (const hb of d.habits) { hb.days ||= [0, 1, 2, 3, 4, 5, 6]; hb.mode ||= 'days' } })
  const S = () => store.get()
  const st = { week: startOfWeek(today()), year: new Date().getFullYear() }
  const doneOf = (id) => (S().log[id] ||= {})

  const statsHost = h('div'), weekHost = h('div'), heatHost = h('div'), dataHost = h('div')
  el.append(statsHost, weekHost, heatHost, dataHost)

  // ---------- habit form
  function openForm(hb) {
    const isNew = !hb
    const m = hb ? structuredClone(hb) : { id: uid(), name: '', color: PALETTE[S().habits.length % PALETTE.length], emoji: '', mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 3, created: today() }
    const name = input({ value: m.name, placeholder: 'e.g. Read 20 pages', maxlength: 60, 'aria-label': 'Habit name' })
    const emo = input({ value: m.emoji, placeholder: 'optional', maxlength: 4, 'aria-label': 'Emoji', style: 'width:90px' })
    const col = swatches(PALETTE, m.color, (c) => { m.color = c })
    const preset = (id) => ({ every: [0, 1, 2, 3, 4, 5, 6], weekdays: [0, 1, 2, 3, 4], weekends: [5, 6] })[id]
    const curPreset = () => (m.mode === 'weekly' ? 'weekly' : m.days.length === 7 ? 'every' : m.days.join() === '0,1,2,3,4' ? 'weekdays' : m.days.join() === '5,6' ? 'weekends' : 'custom')
    const seg = segmented([['every', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['custom', 'Pick days'], ['weekly', 'X a week']], curPreset(), (v) => {
      if (v === 'weekly') m.mode = 'weekly'
      else { m.mode = 'days'; if (v !== 'custom') m.days = preset(v) }
      sync()
    }, 'Schedule')
    const dayChips = h('div', { class: 'dsel' })
    const per = input({ type: 'number', min: 1, max: 7, value: m.perWeek, 'aria-label': 'Times per week', style: 'width:90px', oninput: () => { m.perWeek = Math.min(7, Math.max(1, per.valueAsNumber || 1)) } })
    const perBox = field('Times per week', per, 'Any days count. The streak counts weeks that reach this target.')
    function sync() {
      perBox.hidden = m.mode !== 'weekly'
      dayChips.hidden = m.mode === 'weekly'
      clear(dayChips, DAY_NAMES.map((n, i) => chip(n, { pressed: m.days.includes(i), onClick: () => { m.days = m.days.includes(i) ? m.days.filter((x) => x !== i) : [...m.days, i].sort(); if (!m.days.length) m.days = [i]; seg.set(curPreset()); sync() } })))
    }
    sync()
    const save = () => {
      const n = name.value.trim()
      if (!n) { name.focus(); toast('Give the habit a name', 'error'); return }
      m.name = n; m.emoji = emo.value.trim(); m.color = col.value || m.color
      if (isNew) S().habits.push(m)
      else Object.assign(S().habits.find((x) => x.id === m.id), m)
      store.save(); dlg.close(); renderAll()
      if (isNew) toast('Habit added. Tap a day to check it in.', 'success')
    }
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save() } })
    const del = !isNew && button('Delete', { icon: 'trash-2', variant: 'danger', onClick: async () => { if (await confirmBox({ title: `Delete "${hb.name}"?`, text: 'Its check-ins are removed too. Export a backup first if you might need them.' })) { S().habits = S().habits.filter((x) => x.id !== hb.id); delete S().log[hb.id]; if (S().sel === hb.id) S().sel = 'all'; store.save(); dlg.close(); renderAll() } } })
    const dlg = modal({ title: isNew ? 'New habit' : 'Edit habit', icon: 'check-check', body: h('div', { class: 'stack' }, field('Name', name), h('div', { class: 'pz-row' }, field('Emoji', emo), field('Color', col)), field('Schedule', seg), dayChips, perBox),
      actions: [del || null, button('Cancel', { onClick: () => dlg.close() }), button(isNew ? 'Add habit' : 'Save', { variant: 'primary', onClick: save })].filter(Boolean) })
    setTimeout(() => name.focus(), 60)
  }

  // ---------- stats
  function renderStats() {
    const hs = S().habits, t = today()
    const due = hs.filter((x) => isScheduled(x, t) && x.mode !== 'weekly')
    const doneToday = hs.filter((x) => S().log[x.id]?.[t]).length
    const streaks = hs.map((x) => calcStreaks(x, doneOf(x.id)))
    const bestCur = Math.max(0, ...streaks.map((s) => s.cur))
    const weekDone = hs.reduce((s, x) => s + weekCount(x, doneOf(x.id), startOfWeek(t)), 0)
    const rate = hs.length ? hs.reduce((s, x) => s + completionRate(x, doneOf(x.id)), 0) / hs.length : 0
    clear(statsHost, h('div', { class: 'pz-bento' },
      stat({ label: 'Today', value: hs.length ? `${doneToday}/${Math.max(due.length, doneToday)}` : '-', hint: due.length && doneToday >= due.length ? 'All done. Great job!' : 'checked in', icon: 'circle-check', hero: true, tone: due.length && doneToday >= due.length ? 'ok' : undefined }),
      stat({ label: 'Longest current streak', value: String(bestCur), hint: bestCur === 1 ? 'day or week' : 'days or weeks', icon: 'flame', tone: 'warn' }),
      stat({ label: 'This week', value: String(weekDone), hint: 'check-ins', icon: 'calendar-check', tone: 'info' }),
      stat({ label: 'Last 30 days', value: `${Math.round(rate * 100)}%`, hint: 'of scheduled days done', icon: 'trending-up', tone: 'ok' })))
  }

  // ---------- week grid
  const flameEls = new Map()
  function renderWeek() {
    flameEls.clear()
    const hs = S().habits, t = today()
    const days = Array.from({ length: 7 }, (_, i) => addDays(st.week, i))
    const isNow = st.week === startOfWeek(t)
    const head = h('h2', { class: 'pz-title' }, icon('calendar-days'), h('span', { class: 'grow' }, `${fmtDate(days[0], { day: 'numeric', month: 'short' })} - ${fmtDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`),
      ib('chevron-left', 'Previous week', () => { st.week = addDays(st.week, -7); renderWeek() }), !isNow && button('This week', { size: 'sm', onClick: () => { st.week = startOfWeek(t); renderWeek() } }), ib('chevron-right', 'Next week', () => { st.week = addDays(st.week, 7); renderWeek() }))
    const rows = hs.map((hb, i) => {
      const done = doneOf(hb.id)
      const flame = h('span', { class: 'flame' }, icon('flame'), '0')
      flameEls.set(hb.id, flame)
      const cells = days.map((d, k) => {
        const fut = d > t, off = !isScheduled(hb, d)
        const btn = checkBtn(!!done[d], (v) => { if (v) done[d] = 1; else delete done[d]; store.save(); derived() }, `${hb.name}, ${fmtDate(d)}`, hb.color)
        return h('div', { class: ['cell', d === t && 'today', off && 'off', fut && 'future'] }, h('span', DAY_NAMES[k][0] + ' ' + parseYmd(d).getDate()), btn)
      })
      return h('div', { class: ['hrow', 'pz-rise', S().sel === hb.id && 'sel'], style: { '--hc': hb.color, '--i': Math.min(i, 8) } },
        h('div', { class: 'pz-row nowrap', style: 'min-width:0' }, h('button', { type: 'button', class: 'hname pz-grow', title: 'Show this habit in the yearly heatmap', onclick: () => { S().sel = S().sel === hb.id ? 'all' : hb.id; store.save(); renderWeek(); renderHeat() } },
          h('span', { class: 'dot' }, hb.emoji || icon('check')), h('span', { style: 'min-width:0' }, h('b', hb.name), h('small', scheduleLabel(hb), flame))), ib('pencil', `Edit ${hb.name}`, () => openForm(hb))),
        h('div', { class: 'days' }, cells))
    })
    clear(weekHost, h('section', { class: 'pz-card' }, head,
      hs.length ? h('div', { class: 'stack' }, rows, h('div', { class: 'pz-row pz-noprint' }, button('Add habit', { icon: 'plus', variant: 'primary', onClick: () => openForm() }), h('span', { class: 'pz-note' }, 'Tap a habit name to see its yearly heatmap.')))
        : emptyState('Build your first habit', 'Pick something small, like drinking water or ten minutes of reading, and check it off each day.', 'sprout'),
      !hs.length ? h('div', { class: 'pz-row', style: 'justify-content:center' }, button('Add your first habit', { icon: 'plus', variant: 'primary', onClick: () => openForm() }), button('Try examples', { onClick: addExamples })) : null))
    updateStreaks()
  }
  function addExamples() {
    const t = today()
    S().habits.push(
      { id: uid(), name: 'Drink 2L water', emoji: '', color: '#0ea5e9', mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 3, created: t },
      { id: uid(), name: 'Read 20 pages', emoji: '', color: '#a855f7', mode: 'days', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 3, created: t },
      { id: uid(), name: 'Workout', emoji: '', color: '#f97316', mode: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], perWeek: 3, created: t })
    store.save(); renderAll()
  }
  function updateStreaks() {
    for (const hb of S().habits) {
      const s = calcStreaks(hb, doneOf(hb.id)), e = flameEls.get(hb.id)
      if (e) { e.lastChild.textContent = `${s.cur}${hb.mode === 'weekly' ? 'w' : 'd'}`; e.title = `Current streak ${s.cur}, best ${s.best}${hb.mode === 'weekly' ? ' weeks' : ' days'}` }
    }
  }
  function derived() { updateStreaks(); renderStats(); renderHeat() }

  // ---------- heatmap
  function renderHeat() {
    const hs = S().habits, t = today()
    if (!hs.length) { clear(heatHost); return }
    const sel = hs.find((x) => x.id === S().sel)
    const y = st.year
    const jan1 = `${y}-01-01`, dec31 = `${y}-12-31`
    const off = dow(jan1)
    const total = daysBetween(jan1, dec31) + 1
    const cols = Math.ceil((off + total) / 7)
    const cells = []
    for (let i = 0; i < off; i++) cells.push(h('i', { class: 'void' }))
    let doneDays = 0, bestMonthN = 0
    for (let i = 0; i < total; i++) {
      const d = addDays(jan1, i)
      let cls = '', tip = fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      if (d > t) { cls = 'fut' } else if (sel) {
        const done = doneOf(sel.id)[d]
        if (done) { cls = 'l4'; doneDays++; tip += ': done' } else if (!isScheduled(sel, d)) { cls = 'none'; tip += ': rest day' } else tip += ': missed'
      } else {
        const sched = hs.filter((x) => isScheduled(x, d) && (x.created || '') <= d && x.mode !== 'weekly')
        const any = hs.filter((x) => doneOf(x.id)[d])
        const base = Math.max(sched.length, any.length)
        const f = base ? any.length / base : 0
        cls = f === 0 ? '' : f < 0.5 ? 'l1' : f < 1 ? 'l2' : 'l4'; if (any.length) doneDays++
        tip += base ? `: ${any.length} of ${base} done` : ''
      }
      cells.push(h('i', { class: cls, title: tip }))
    }
    const months = Array.from({ length: 12 }, (_, m) => { const first = daysBetween(jan1, `${y}-${pad(m + 1)}-01`); return { m, col: Math.floor((off + first) / 7) } })
    const monthRow = h('div', { class: 'months' }, Array.from({ length: cols }, (_, c) => { const mm = months.find((x) => x.col === c); return h('span', { style: 'overflow:visible;white-space:nowrap' }, mm ? new Date(y, mm.m, 1).toLocaleDateString(undefined, { month: 'short' }) : '') }))
    const s = sel ? calcStreaks(sel, doneOf(sel.id)) : null
    clear(heatHost, h('section', { class: 'pz-card', style: { '--hc': sel ? sel.color : 'var(--tc)' } },
      h('h2', { class: 'pz-title' }, icon('layout-grid'), h('span', { class: 'grow' }, sel ? sel.name : 'All habits'), ib('chevron-left', 'Previous year', () => { st.year--; renderHeat() }), h('b', { style: 'color:var(--text);font-size:13px' }, String(y)), ib('chevron-right', 'Next year', () => { st.year++; renderHeat() }),
        sel ? ib('pencil', 'Edit habit', () => openForm(sel)) : null),
      h('div', { class: 'pz-row', style: 'margin-bottom:10px' }, h('span', { class: 'pz-note' }, `${plural(doneDays, 'day')} with a check-in in ${y}`), s ? h('span', { class: 'pz-note' }, `Best streak ${s.best}${sel.mode === 'weekly' ? ' weeks' : ' days'}`) : null,
        sel ? chip('Show all habits', { ic: 'layers', onClick: () => { S().sel = 'all'; store.save(); renderWeek(); renderHeat() } }) : null),
      h('div', { class: 'heat' }, h('div', { class: 'inner' }, monthRow, h('div', { class: 'hm' }, h('div', { class: 'dn' }, ['M', '', 'W', '', 'F', '', 'S'].map((x) => h('span', x))), h('div', { class: 'g', role: 'img', 'aria-label': `Heatmap of ${doneDays} check-in days in ${y}` }, cells)))),
      h('div', { class: 'ylg' }, 'Less', [0, 1, 2, 3, 4].map((l) => h('i', { class: 'l' + l, style: l ? { background: `color-mix(in srgb,var(--hc) ${[0, 30, 55, 80, 100][l]}%,var(--surface-3))` } : '' })), 'More')))
    // the card scopes --hc itself, so the cells pick the habit color
    heatHost.querySelector('.pz-card').style.setProperty('--hc', sel ? sel.color : 'var(--tc)')
  }

  function renderAll() { renderStats(); renderWeek(); renderHeat() }
  function setAll(d) { store.set({ habits: d.habits || [], log: d.log || {}, sel: 'all' }); renderAll() }
  clear(dataHost, dataBar({ kind: 'habits', get: () => S(), set: setAll, reset: () => setAll(blank()) }))
  renderAll()
}
