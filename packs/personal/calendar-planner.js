// Calendar planner: month, week and agenda views, colored events with repeats and reminders (while this page is open),
// and .ics export and import. Events stay in this browser.
import { h, icon, button, input, textarea, field, select, segmented, toggle, toast, clear, modal, download } from '../../lib/ui.js'
import { app, css, makeStore, uid, today, addDays, parseYmd, ymd, fmtDate, fmtTime, startOfWeek, daysBetween, stat, emptyState, ib, chip, swatches, PALETTE, DAY_NAMES, dataBar, confirmBox, plural, pad, ticker, askNotify, notify, chime, hhmm } from './_shared.js'
import { buildIcs, parseIcs } from './_ics.js'

const REPEATS = [['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']]
const REMINDS = [['', 'No reminder'], [0, 'At the time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [1440, '1 day before']]
export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate()

/** Does event `e` happen on day `d` (YYYY-MM-DD)? Handles multi-day events and daily / weekly / monthly / yearly repeats. */
export function occursOn(e, d) {
  if (d < e.date) return false
  if (!e.repeat || e.repeat === 'none') return d <= (e.endDate || e.date)
  if (e.until && d > e.until) return false
  const n = Math.max(1, e.interval || 1)
  const diff = daysBetween(e.date, d)
  if (e.repeat === 'daily') return diff % n === 0
  if (e.repeat === 'weekly') return diff % (7 * n) === 0
  const a = parseYmd(e.date), b = parseYmd(d)
  const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()
  if (e.repeat === 'monthly') return months % n === 0 && b.getDate() === Math.min(a.getDate(), daysInMonth(b.getFullYear(), b.getMonth()))
  if (e.repeat === 'yearly') return months % (12 * n) === 0 && b.getMonth() === a.getMonth() && b.getDate() === Math.min(a.getDate(), daysInMonth(b.getFullYear(), b.getMonth()))
  return false
}
/** Events on a day, all-day first then by start time. */
export const eventsOn = (events, d) => events.filter((e) => occursOn(e, d)).sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title))
/** When should the reminder for this occurrence fire (ms)? All-day events count from 09:00. Null if no reminder. */
export function reminderTime(e, d) {
  if (e.remind == null || e.remind === '') return null
  const [hh, mm] = (e.allDay ? '09:00' : e.start || '09:00').split(':').map(Number)
  const t = parseYmd(d)
  t.setHours(hh, mm, 0, 0)
  return t.getTime() - Number(e.remind) * 60000
}

const CSS = `
.t-cal .nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.t-cal .nav h2{margin:0;font-size:clamp(18px,4vw,24px);letter-spacing:-.03em;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t-cal .mg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border:1px solid var(--border);border-radius:18px;overflow:hidden;background:var(--border);gap:1px}
.t-cal .mg .dh{background:var(--surface-2);padding:8px 6px;font-size:12px;font-weight:600;color:var(--muted);text-align:center}
.t-cal .day{background:var(--surface);min-height:96px;padding:6px 5px;display:flex;flex-direction:column;gap:3px;cursor:pointer;text-align:left;color:var(--text);min-width:0;position:relative;transition:background .15s}
.t-cal .day:hover{background:color-mix(in srgb,var(--tc) 6%,var(--surface))}
.t-cal .day.out{background:var(--surface-2);color:var(--muted)}
.t-cal .day.sel{outline:2px solid var(--tc);outline-offset:-2px;z-index:1}
.t-cal .day .n{font-size:12.5px;font-weight:600;width:26px;height:26px;display:grid;place-items:center;border-radius:50%;font-variant-numeric:tabular-nums;border:0;background:none;color:inherit;cursor:pointer;padding:0}
.t-cal .day.today .n{background:var(--tc);color:#fff}
.t-cal .ev{display:block;width:100%;font-size:11.5px;line-height:1.25;padding:2px 6px;border-radius:6px;background:color-mix(in srgb,var(--ec) 20%,var(--surface));border-left:3px solid var(--ec);color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;text-align:left;border-top:0;border-right:0;border-bottom:0}
.t-cal .ev.solid{background:var(--ec);color:#fff}
.t-cal .more{font-size:11px;color:var(--muted);padding-left:4px}
.t-cal .dots{display:none;gap:3px;flex-wrap:wrap}.t-cal .dots i{width:7px;height:7px;border-radius:50%;background:var(--ec)}
@media (max-width:700px){.t-cal .day{min-height:58px;align-items:center}.t-cal .day .ev,.t-cal .day .more{display:none}.t-cal .day .dots{display:flex;justify-content:center}}
.t-cal .wk{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px}
@media (max-width:900px){.t-cal .wk{grid-template-columns:minmax(0,1fr)}}
.t-cal .wcol{border:1px solid var(--border);border-radius:16px;padding:10px;background:var(--surface);display:flex;flex-direction:column;gap:6px;min-height:120px;min-width:0}
.t-cal .wcol.today{border-color:var(--tc);background:color-mix(in srgb,var(--tc) 6%,var(--surface))}
.t-cal .wcol header{display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:var(--muted);font-weight:600}
.t-cal .wcol header b{color:var(--text);font-size:16px}
.t-cal .row-ev{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;border:1px solid var(--border);background:var(--surface);cursor:pointer;text-align:left;width:100%;color:var(--text);border-left:4px solid var(--ec)}
.t-cal .row-ev:hover{background:var(--surface-2)}
.t-cal .row-ev .tm{font-size:12.5px;color:var(--muted);min-width:58px;font-variant-numeric:tabular-nums}
.t-cal .row-ev b{font-weight:600;font-size:14.5px;overflow-wrap:anywhere}
.t-cal .row-ev small{display:block;color:var(--muted);font-size:12px;overflow-wrap:anywhere}
.t-cal .grp{font-size:12px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:10px 0 6px}
.t-cal .tr{display:grid;grid-template-columns:1fr 1fr;gap:10px}
`

const blank = () => ({ events: [], view: 'month', cursor: today(), sel: today(), monday: true, notify: false })

export function mount(root) {
  const el = app(root, 'cal', '#6366f1')
  css('t-cal', CSS)
  const store = makeStore('calendar', blank(), (d) => { d.events ||= []; d.cursor ||= today(); d.sel ||= today(); d.view ||= 'month' })
  const S = () => store.get()
  const fired = new Set()
  const colorOf = (e) => e.color || PALETTE[0]

  const head = h('div'), body = h('div'), selHost = h('div'), toolsHost = h('div'), dataHost = h('div')
  el.append(head, body, selHost, toolsHost, dataHost)

  // ---------------------------------------------------------------- event form
  function openForm(ev, date) {
    const isNew = !ev
    const m = ev ? structuredClone(ev) : { id: uid(), title: '', date: date || S().sel, endDate: '', allDay: false, start: '09:00', end: '10:00', color: PALETTE[0], repeat: 'none', interval: 1, until: '', remind: 15, notes: '', place: '' }
    const title = input({ value: m.title, placeholder: 'Event title', maxlength: 120, 'aria-label': 'Title' })
    const dateIn = input({ type: 'date', value: m.date, 'aria-label': 'Date', onchange: () => { m.date = dateIn.value } })
    const endDateIn = input({ type: 'date', value: m.endDate, 'aria-label': 'Last day (optional)', onchange: () => { m.endDate = endDateIn.value } })
    const startIn = input({ type: 'time', value: m.start || '09:00', 'aria-label': 'Start time', onchange: () => { m.start = startIn.value } })
    const endIn = input({ type: 'time', value: m.end || '', 'aria-label': 'End time', onchange: () => { m.end = endIn.value } })
    const allDay = toggle('All day', m.allDay, (v) => { m.allDay = v; sync() })
    const rep = select(REPEATS, m.repeat, (v) => { m.repeat = v; sync() })
    rep.setAttribute('aria-label', 'Repeat')
    const until = input({ type: 'date', value: m.until, 'aria-label': 'Repeat until', onchange: () => { m.until = until.value } })
    const rem = select(REMINDS, m.remind ?? '', (v) => { m.remind = v === '' ? null : Number(v) })
    rem.setAttribute('aria-label', 'Reminder')
    const place = input({ value: m.place, placeholder: 'Location (optional)', 'aria-label': 'Location' })
    const notes = textarea({ rows: 3, value: m.notes, placeholder: 'Notes (optional)', 'aria-label': 'Notes' })
    const col = swatches(PALETTE.slice(0, 10), colorOf(m), (c) => { m.color = c })
    const timeBox = h('div', { class: 'tr' }, field('Starts', startIn), field('Ends', endIn))
    const endDateBox = field('Last day (for multi-day events)', endDateIn)
    const untilBox = field('Repeat until (optional)', until)
    function sync() { timeBox.hidden = m.allDay; endDateBox.hidden = !m.allDay || m.repeat !== 'none'; untilBox.hidden = m.repeat === 'none' }
    sync()
    function save() {
      const t = title.value.trim()
      if (!t) { title.focus(); toast('Give the event a title', 'error'); return }
      if (!m.date) { toast('Pick a date', 'error'); return }
      if (!m.allDay && m.end && m.start && m.end < m.start) { toast('The end time is before the start time', 'error'); return }
      if (m.endDate && m.endDate < m.date) { toast('The last day is before the first day', 'error'); return }
      if (m.until && m.until < m.date) { toast('"Repeat until" is before the start date', 'error'); return }
      m.title = t; m.place = place.value.trim(); m.notes = notes.value.trim(); m.color = col.value || m.color
      if (m.allDay) { m.start = ''; m.end = '' }
      if (isNew) S().events.push(m); else Object.assign(S().events.find((x) => x.id === m.id), m)
      S().sel = m.date; if (S().view === 'month' || S().view === 'week') S().cursor = m.date
      store.save(); dlg.close(); render()
      if (m.remind != null && !S().notify) toast('Reminders pop up while this page is open', 'info')
    }
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save() } })
    const acts = []
    if (!isNew) {
      acts.push(button('Delete', { icon: 'trash-2', variant: 'danger', onClick: async () => { if (await confirmBox({ title: `Delete "${ev.title}"?`, text: m.repeat !== 'none' ? 'This removes every repeat of the event.' : 'This removes the event.' })) { S().events = S().events.filter((x) => x.id !== ev.id); store.save(); dlg.close(); render() } } }),
        button('.ics', { icon: 'download', title: 'Download this event as .ics', onClick: () => download(buildIcs([m]), `${(m.title || 'event').replace(/[^\w-]+/g, '-')}.ics`, 'text/calendar') }))
    }
    acts.push(button('Cancel', { onClick: () => dlg.close() }), button(isNew ? 'Add event' : 'Save', { variant: 'primary', onClick: save }))
    const dlg = modal({ title: isNew ? 'New event' : 'Edit event', icon: 'calendar-plus',
      body: h('div', { class: 'stack' }, field('Title', title), h('div', { class: 'tr' }, field('Date', dateIn), h('div', { style: 'align-self:end;padding-bottom:10px' }, allDay)), timeBox, endDateBox,
        h('div', { class: 'tr' }, field('Repeat', rep), field('Reminder', rem)), untilBox, field('Location', place), field('Notes', notes), field('Color', col)), actions: acts })
    setTimeout(() => title.focus(), 60)
  }

  // ---------------------------------------------------------------- views
  const evLabel = (e) => (e.allDay ? '' : fmtTime(e.start) + ' ') + e.title
  const evBtn = (e, d, solid) => h('button', { type: 'button', class: ['ev', solid && 'solid'], style: { '--ec': colorOf(e) }, title: evLabel(e), onclick: (x) => { x.stopPropagation(); openForm(e) } }, evLabel(e))
  const rowEv = (e) => h('button', { type: 'button', class: 'row-ev', style: { '--ec': colorOf(e) }, onclick: () => openForm(e) },
    h('span', { class: 'tm' }, e.allDay ? 'All day' : `${fmtTime(e.start)}${e.end ? ' - ' + fmtTime(e.end) : ''}`),
    h('span', h('b', e.title), (e.place || e.notes) ? h('small', [e.place, e.notes].filter(Boolean).join(' - ')) : null),
    h('span', { class: 'pz-note', style: 'display:flex;gap:6px' }, e.repeat && e.repeat !== 'none' ? icon('repeat') : null, e.remind != null ? icon('bell') : null))

  function monthRange(c) { const d = parseYmd(c); return [d.getFullYear(), d.getMonth()] }
  function title() {
    const s = S()
    if (s.view === 'month') { const [y, m] = monthRange(s.cursor); return new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }
    if (s.view === 'week') { const a = startOfWeek(s.cursor, s.monday); return `${fmtDate(a, { day: 'numeric', month: 'short' })} - ${fmtDate(addDays(a, 6), { day: 'numeric', month: 'short', year: 'numeric' })}` }
    return 'Coming up'
  }
  function step(dir) {
    const s = S(), d = parseYmd(s.cursor)
    if (s.view === 'month') { d.setDate(1); d.setMonth(d.getMonth() + dir); s.cursor = ymd(d) } else s.cursor = addDays(s.cursor, 7 * dir)
    store.save(); render()
  }
  function renderHead() {
    const s = S()
    clear(head, h('div', { class: 'pz-card' }, h('div', { class: 'nav' },
      h('h2', title()),
      s.view !== 'agenda' ? [ib('chevron-left', 'Previous', () => step(-1)), button('Today', { size: 'sm', onClick: () => { s.cursor = s.sel = today(); store.save(); render() } }), ib('chevron-right', 'Next', () => step(1))] : null,
      segmented([['month', 'Month'], ['week', 'Week'], ['agenda', 'Agenda']], s.view, (v) => { s.view = v; store.save(); render() }, 'View'),
      button('Add event', { icon: 'plus', variant: 'primary', size: 'sm', onClick: () => openForm(null, s.sel) }))))
  }
  function renderMonth() {
    const s = S(), [y, m] = monthRange(s.cursor), t = today()
    const first = ymd(new Date(y, m, 1))
    const start = startOfWeek(first, s.monday)
    const names = s.monday ? DAY_NAMES : [DAY_NAMES[6], ...DAY_NAMES.slice(0, 6)]
    const cells = []
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i)
      if (i >= 35 && parseYmd(d).getMonth() !== m) break
      const evs = eventsOn(s.events, d)
      const shown = evs.slice(0, 3)
      const pick = () => { s.sel = d; store.save(); renderMonthSel(); cells.forEach((c) => c.classList.toggle('sel', c.dataset.date === d)) }
      cells.push(h('div', { class: ['day', parseYmd(d).getMonth() !== m && 'out', d === t && 'today', d === s.sel && 'sel'], 'data-date': d, onclick: pick, ondblclick: () => openForm(null, d) },
        h('button', { type: 'button', class: 'n', 'aria-label': `${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}, ${plural(evs.length, 'event')}`, onclick: (x) => { x.stopPropagation(); pick() } }, String(parseYmd(d).getDate())),
        shown.map((e) => evBtn(e, d)), evs.length > 3 ? h('span', { class: 'more' }, `+${evs.length - 3} more`) : null,
        h('span', { class: 'dots' }, evs.slice(0, 4).map((e) => h('i', { style: { '--ec': colorOf(e) } })))))
    }
    clear(body, h('div', { class: 'mg' }, names.map((n) => h('div', { class: 'dh' }, n)), cells))
    renderMonthSel()
  }
  function renderMonthSel() {
    const s = S()
    const evs = eventsOn(s.events, s.sel)
    clear(selHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('calendar-days'), h('span', { class: 'grow' }, fmtDate(s.sel, { weekday: 'long', day: 'numeric', month: 'long' })), button('Add', { icon: 'plus', size: 'sm', onClick: () => openForm(null, s.sel) })),
      evs.length ? h('div', { class: 'stack', style: 'gap:8px' }, evs.map(rowEv)) : h('p', { class: 'pz-note' }, 'Nothing planned. Double-click a day or press Add to create an event.')))
  }
  function renderWeek() {
    const s = S(), t = today(), a = startOfWeek(s.cursor, s.monday)
    clear(selHost)
    clear(body, h('div', { class: 'wk' }, Array.from({ length: 7 }, (_, i) => {
      const d = addDays(a, i), evs = eventsOn(s.events, d)
      return h('section', { class: ['wcol', d === t && 'today'] }, h('header', h('span', fmtDate(d, { weekday: 'short' }) + ' ', h('b', String(parseYmd(d).getDate()))), ib('plus', `Add event on ${fmtDate(d)}`, () => openForm(null, d))),
        evs.length ? evs.map((e) => h('button', { type: 'button', class: 'ev', style: { '--ec': colorOf(e), whiteSpace: 'normal' }, onclick: () => openForm(e) }, h('b', { style: 'display:block' }, e.allDay ? e.title : fmtTime(e.start)), e.allDay ? 'All day' : e.title)) : h('span', { class: 'pz-note' }, 'Free'))
    })))
  }
  function renderAgenda() {
    const s = S(), t = today()
    clear(selHost)
    const days = []
    for (let i = 0; i < 60; i++) { const d = addDays(t, i); const evs = eventsOn(s.events, d); if (evs.length) days.push([d, evs]) }
    clear(body, h('section', { class: 'pz-card' }, days.length ? days.map(([d, evs]) => h('div', h('div', { class: 'grp' }, d === t ? `Today, ${fmtDate(d)}` : d === addDays(t, 1) ? `Tomorrow, ${fmtDate(d)}` : fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' })), h('div', { class: 'stack', style: 'gap:8px' }, evs.map(rowEv))))
      : emptyState('Nothing in the next 60 days', 'Add an event and it shows up here.', 'calendar-check')))
  }
  function renderTools() {
    const s = S()
    const file = h('input', { type: 'file', accept: '.ics,text/calendar', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; e.target.value = ''
      if (!f) return
      try {
        const r = parseIcs(await f.text(), uid)
        if (!r.events.length) { toast('No events found in that file', 'error'); return }
        const known = new Set(s.events.map((x) => `${x.title}|${x.date}|${x.start}`))
        const add = r.events.filter((x) => !known.has(`${x.title}|${x.date}|${x.start}`))
        s.events.push(...add); store.save(); render()
        toast(`Imported ${plural(add.length, 'event')}${r.events.length > add.length ? `, skipped ${r.events.length - add.length} already here` : ''}`, 'success')
        if (r.notes.length) toast(r.notes[0], 'info')
      } catch (err) { toast(`Could not read that file: ${err.message}`, 'error') }
    } })
    const notifT = toggle('Desktop notifications for reminders', s.notify, async (v) => { s.notify = v; if (v) { const r = await askNotify(); if (r !== 'granted') { s.notify = false; notifT.input.checked = false; toast('Notifications are not available or blocked', 'error') } } store.save() })
    clear(toolsHost, h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('arrow-left-right'), 'Calendar file and settings'),
      h('div', { class: 'pz-row' }, button('Export .ics', { icon: 'download', onClick: () => { if (!s.events.length) { toast('Add an event first', 'error'); return } download(buildIcs(s.events, { name: 'My calendar' }), 'calendar.ics', 'text/calendar') } }),
        button('Import .ics', { icon: 'upload', onClick: () => file.click() }), file,
        toggle('Week starts on Monday', s.monday, (v) => { s.monday = v; store.save(); render() }),
        notifT),
      h('p', { class: 'pz-note', style: 'margin-top:10px' }, 'Reminders pop up while this page is open in a browser tab. Export an .ics file to get alerts from Google, Apple or Outlook calendars.')))
  }
  function render() {
    renderHead()
    ;({ month: renderMonth, week: renderWeek, agenda: renderAgenda })[S().view]()
  }

  // ---------------------------------------------------------------- reminders
  function checkReminders() {
    const now = Date.now(), t = today()
    for (const d of [t, addDays(t, 1)]) {
      for (const e of eventsOn(S().events, d)) {
        const at = reminderTime(e, d)
        if (at == null) continue
        const key = `${e.id}:${d}`
        if (now >= at && now < at + 3 * 60000 && !fired.has(key)) {
          fired.add(key)
          const when = e.allDay ? 'today' : `at ${fmtTime(e.start)}`
          toast(`${e.title} ${when}`, 'info', 10000); chime()
          if (S().notify) notify(e.title, `${fmtDate(d)} ${e.allDay ? '' : fmtTime(e.start)}`.trim())
        }
      }
    }
  }
  ticker(checkReminders, 15000)
  checkReminders()

  clear(dataHost, dataBar({ kind: 'calendar', get: () => S(), set: (d) => { store.set({ ...blank(), ...d }); render(); renderTools() }, reset: () => { store.set(blank()); render(); renderTools() } }))
  renderTools()
  render()
}
