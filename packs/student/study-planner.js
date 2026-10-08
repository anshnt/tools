// Study timetable planner: subjects + exam dates + hours per day -> a balanced, printable timetable you can export to a calendar.
import { h, button, select, number, toggle, clear, copyText, download, formatNumber, icon, toast } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, printNode, confirmModal, esc, TINTS, uid } from './_kit.js'

// ---------- dates (local calendar days as YYYY-MM-DD, so daylight-saving never shifts a day) ----------
export const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d) }
export const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d) }
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)
export const todayStr = () => fmtDate(new Date())
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(parseDate(s).getTime())
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmtHM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const parseHM = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 18 * 60 }
const niceDate = (s) => { const d = parseDate(s); return `${WD[d.getDay()]} ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}` }

/**
 * Build a plan.
 * subjects: [{name, exam: 'YYYY-MM-DD', difficulty 1-5, hours?: manual target hours}]
 * opts: {start, hoursByWeekday: [Sun..Sat], sessionMin, examDayFactor, revisionDay, breakMin, startTime: 'HH:MM'}
 * -> {days: [{date, hours, slots: [{s, extra}], blocks: [{s, slots, startMin, endMin}], exams: [s]}], subjects: [{need, planned, extra, eligible, shortfall, daysLeft}], warnings: []}
 */
export function buildPlan(subjects, opts) {
  const { start, hoursByWeekday, sessionMin = 60, examDayFactor = 0.5, revisionDay = true, breakMin = 10, startTime = '18:00' } = opts
  const warnings = []
  const subs = subjects.map((s, i) => ({ ...s, i, need: 0, planned: 0, extra: 0, eligible: 0, shortfall: 0, ok: !!s.name?.trim() && validDate(s.exam) }))
  const usable = subs.filter((s) => s.ok)
  for (const s of subs) if (s.name?.trim() && !validDate(s.exam)) warnings.push(`${s.name}: pick an exam date.`)
  for (const s of usable) if (s.exam <= start) { warnings.push(`${s.name}: the exam is ${s.exam === start ? 'today' : 'already over'}, so nothing was planned for it.`); s.ok = false }
  const live = subs.filter((s) => s.ok)
  if (!live.length || !validDate(start)) return { days: [], subjects: subs, warnings }
  const last = live.reduce((m, s) => (s.exam > m ? s.exam : m), live[0].exam)
  const days = []
  for (let d = start, n = 0; d < last && n < 400; d = addDays(d, 1), n++) {
    const exams = live.filter((s) => s.exam === d).map((s) => s.i)
    let hours = Number(hoursByWeekday[parseDate(d).getDay()]) || 0
    if (exams.length) hours *= examDayFactor
    days.push({ date: d, hours, slots: Array.from({ length: Math.max(0, Math.floor((hours * 60) / sessionMin + 1e-9)) }, () => ({ s: null, extra: false })), exams })
  }
  // exam days after the plan window (the last day) still need to show up
  const examOnLast = live.filter((s) => s.exam === last).map((s) => s.i)
  days.push({ date: last, hours: 0, slots: [], exams: examOnLast })
  // eligible slots per subject: any slot on a day strictly before its exam
  const totalSlots = days.reduce((t, d) => t + d.slots.length, 0)
  for (const s of live) s.eligible = days.reduce((t, d) => t + (d.date < s.exam ? d.slots.length : 0), 0)
  // targets: manual hours first, the rest shared by difficulty weight
  const manual = live.filter((s) => Number.isFinite(s.hours) && s.hours > 0)
  const auto = live.filter((s) => !manual.includes(s))
  for (const s of manual) s.need = Math.round((s.hours * 60) / sessionMin)
  const left = Math.max(0, totalSlots - manual.reduce((t, s) => t + Math.min(s.need, s.eligible), 0))
  const wOf = (s) => s.difficulty || 3
  const sumW = auto.reduce((t, s) => t + wOf(s), 0)
  for (const s of auto) s.need = Math.min(s.eligible, Math.round((left * wOf(s)) / (sumW || 1)))
  // Make the targets feasible: for subjects sorted by exam date, work due by each exam must fit in the slots before it.
  const byExam = [...live].sort((a, b) => a.exam.localeCompare(b.exam) || a.i - b.i)
  let prefix = 0
  for (const s of byExam) {
    if (auto.includes(s) && prefix + s.need > s.eligible) s.need = Math.max(0, s.eligible - prefix)
    prefix += s.need
  }
  // hand spare capacity to subjects that still have room, in proportion to difficulty
  const roomOf = (k) => {
    let room = Infinity, cum = 0
    byExam.forEach((s, j) => { cum += s.need; if (j >= k) room = Math.min(room, s.eligible - cum) })
    return room
  }
  for (let pass = 0; pass < 400; pass++) {
    let leftover = totalSlots - byExam.reduce((t, s) => t + s.need, 0)
    if (leftover <= 0) break
    let moved = false
    for (const s of [...byExam].filter((x) => auto.includes(x)).sort((a, b) => wOf(b) - wOf(a))) {
      if (leftover <= 0) break
      if (s.need < s.eligible && roomOf(byExam.indexOf(s)) >= 1) { s.need++; leftover--; moved = true }
    }
    if (!moved) break
  }
  for (const s of live) s.target = s.need

  const remaining = new Map(live.map((s) => [s.i, s.need]))
  const done = new Map(live.map((s) => [s.i, 0]))
  // slots still available (from the current slot on) before each exam
  const eligLeft = new Map(live.map((s) => [s.i, s.eligible]))
  const credit = new Map()
  for (const day of days) {
    for (let k = 0; k < day.slots.length; k++) {
      const el = live.filter((s) => day.date < s.exam)
      // Smooth weighted round-robin: every active subject gets slots in proportion to how urgent it is (work left / time left),
      // so subjects are interleaved instead of one exam hogging whole days. When the slots before an exam are all spoken for,
      // only subjects due by then may use this slot (earliest-deadline-first), which keeps a feasible plan feasible.
      let pick = null
      const cand = []
      for (const s of el) {
        const rem = remaining.get(s.i)
        if (rem <= 0) continue
        const urgency = rem / Math.max(1, eligLeft.get(s.i))
        let w = Math.pow(urgency, 0.6)
        if (revisionDay && addDays(day.date, 1) === s.exam) w *= 3
        cand.push({ s, w, rem })
      }
      if (cand.length) {
        cand.sort((a, b) => a.s.exam.localeCompare(b.s.exam) || a.s.i - b.s.i)
        let cum = 0, upTo = cand.length - 1
        for (let k = 0; k < cand.length; k++) {
          cum += cand[k].rem
          if (eligLeft.get(cand[k].s.i) - cum <= 0) { upTo = k; break }
        }
        const pool = cand.slice(0, upTo + 1)
        const total = pool.reduce((t, c) => t + c.w, 0)
        let bestCur = -Infinity
        for (const c of pool) {
          const cur = (credit.get(c.s.i) || 0) + c.w
          credit.set(c.s.i, cur)
          if (cur > bestCur + 1e-12) { bestCur = cur; pick = c.s }
        }
        credit.set(pick.i, credit.get(pick.i) - total)
      }
      let extra = false
      if (!pick) {
        // everything planned: use spare time for extra revision, nearest exam and least-revised first
        let bestE = Infinity
        for (const s of el) {
          const v = (done.get(s.i) / (s.difficulty || 3)) + Math.max(0, daysBetween(day.date, s.exam) - 1) * 0.02
          if (v < bestE) { bestE = v; pick = s }
        }
        extra = true
      }
      if (pick) {
        day.slots[k] = { s: pick.i, extra }
        done.set(pick.i, done.get(pick.i) + 1)
        if (!extra) remaining.set(pick.i, remaining.get(pick.i) - 1)
        if (extra) subs[pick.i].extra++
      }
      for (const s of live) if (day.date < s.exam) eligLeft.set(s.i, eligLeft.get(s.i) - 1)
    }
  }
  const startMin = parseHM(startTime)
  for (const day of days) {
    let t = startMin
    day.blocks = []
    for (const sl of day.slots) {
      if (sl.s == null) continue
      const b = day.blocks.at(-1)
      if (b && b.s === sl.s) { b.slots++; b.endMin += sessionMin; t = b.endMin; if (sl.extra) b.extra = true; continue }
      if (b) t += breakMin
      day.blocks.push({ s: sl.s, slots: 1, startMin: t, endMin: t + sessionMin, extra: sl.extra })
      t += sessionMin
    }
  }
  for (const s of live) {
    const sub = subs[s.i]
    sub.planned = done.get(s.i)
    sub.shortfall = Math.max(0, remaining.get(s.i))
    sub.daysLeft = daysBetween(start, s.exam)
    if (sub.shortfall > 0) warnings.push(`${s.name}: wanted ${formatNumber((s.need * sessionMin) / 60, 1)} h but only ${formatNumber((sub.planned * sessionMin) / 60, 1)} h fit before the exam. Add study hours or move the exam date.`)
  }
  if (!totalSlots) warnings.push('No study time is available. Add some hours per day.')
  return { days, subjects: subs, warnings }
}

/** Plain text version of a plan. */
export function planText(plan, sessionMin) {
  const lines = []
  for (const d of plan.days) {
    const parts = d.blocks.map((b) => `${fmtHM(b.startMin)}-${fmtHM(b.endMin)} ${plan.subjects[b.s].name}${b.extra ? ' (revision)' : ''}`)
    const ex = d.exams.map((i) => `EXAM: ${plan.subjects[i].name}`)
    if (parts.length || ex.length) lines.push(`${niceDate(d.date)}: ${[...ex, ...parts].join(' | ')}`)
  }
  return lines.join('\n')
}

const icsEsc = (s) => String(s).replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n')
/** iCalendar file with an all-day event per exam and a timed event per study block. */
export function toICS(plan) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const dt = (date, min) => `${date.replace(/-/g, '')}T${fmtHM(min).replace(':', '')}00`
  const ev = []
  for (const d of plan.days) {
    for (const i of d.exams) ev.push(['BEGIN:VEVENT', `UID:exam-${d.date}-${i}@tools`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(d.date, 1).replace(/-/g, '')}`, `SUMMARY:${icsEsc('Exam: ' + plan.subjects[i].name)}`, 'END:VEVENT'].join('\r\n'))
    d.blocks.forEach((b, k) => ev.push(['BEGIN:VEVENT', `UID:study-${d.date}-${k}@tools`, `DTSTAMP:${stamp}`, `DTSTART:${dt(d.date, b.startMin)}`, `DTEND:${dt(d.date, b.endMin)}`, `SUMMARY:${icsEsc((b.extra ? 'Revise: ' : 'Study: ') + plan.subjects[b.s].name)}`, 'END:VEVENT'].join('\r\n')))
  }
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tools//Study planner//EN', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n'
}

const CSS = `
.t-plan .p-top { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 12px; align-items: start; }
@media (max-width: 960px) { .t-plan .p-top { grid-template-columns: minmax(0, 1fr); } }
.t-plan .sub-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) 150px 128px 98px 34px; gap: 8px; align-items: center; margin-bottom: 8px; animation: stu-pop .35s var(--ease) both; }
.t-plan .sub-row .input, .t-plan .sub-row .select { height: 40px; }
.t-plan .sub-head { display: grid; grid-template-columns: 22px minmax(0, 1fr) 150px 128px 98px 34px; gap: 8px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 6px; }
.t-plan .dotc { width: 18px; height: 18px; border-radius: 50%; background: var(--dot); box-shadow: 0 3px 8px -2px var(--dot); }
@media (max-width: 720px) {
  .t-plan .sub-head { display: none; }
  .t-plan .sub-row { grid-template-columns: 18px minmax(0, 1fr) minmax(0, 1fr) 34px; grid-template-areas: "dot name name x" "date date date date" "diff diff hrs hrs"; padding-bottom: 10px; border-bottom: 1px dashed var(--border); }
  .t-plan .sub-row > :nth-child(1) { grid-area: dot; }
  .t-plan .sub-row > :nth-child(2) { grid-area: name; }
  .t-plan .sub-row > :nth-child(3) { grid-area: date; }
  .t-plan .sub-row > :nth-child(4) { grid-area: diff; }
  .t-plan .sub-row > :nth-child(5) { grid-area: hrs; }
  .t-plan .sub-row > :nth-child(6) { grid-area: x; }
}
.t-plan .wd { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.t-plan .wd label { display: grid; gap: 4px; text-align: center; font-size: 11.5px; font-weight: 600; color: var(--muted); }
.t-plan .wd .input { height: 38px; padding: 0 4px; text-align: center; }
.t-plan .heat { display: flex; flex-wrap: wrap; gap: 5px; }
.t-plan .heat i { width: 22px; height: 22px; border-radius: 7px; border: 1px solid var(--border); background: var(--surface-2); animation: stu-pop .5s var(--ease) both; position: relative; overflow: hidden; }
.t-plan .heat i.exam::after { content: ""; position: absolute; right: 2px; top: 2px; width: 6px; height: 6px; border-radius: 50%; background: var(--text); }
.t-plan .scards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 10px; }
.t-plan .scard { padding: 14px; border-radius: 18px; border: 1px solid color-mix(in srgb, var(--dot) 30%, var(--border)); background: linear-gradient(150deg, color-mix(in srgb, var(--dot) 12%, var(--surface)), var(--surface) 70%); animation: stu-pop .5s var(--ease) both; }
.t-plan .scard b { display: block; font-size: 15px; letter-spacing: -.01em; }
.t-plan .scard .big { font-size: 28px; font-weight: 700; letter-spacing: -.04em; font-variant-numeric: tabular-nums; color: var(--dot); }
.t-plan .scard small { color: var(--muted); font-size: 12px; }
.t-plan .meter { height: 7px; border-radius: 9px; background: var(--surface-3); overflow: hidden; margin: 8px 0 4px; }
.t-plan .meter span { display: block; height: 100%; border-radius: inherit; background: var(--dot); }
.t-plan .days { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 10px; }
.t-plan .day { padding: 12px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); animation: stu-pop .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 35ms); }
.t-plan .day.today { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.t-plan .day.is-exam { background: linear-gradient(150deg, color-mix(in srgb, var(--danger) 9%, var(--surface)), var(--surface)); border-color: color-mix(in srgb, var(--danger) 30%, var(--border)); }
.t-plan .day h4 { margin: 0 0 8px; font-size: 13.5px; display: flex; justify-content: space-between; gap: 6px; align-items: baseline; letter-spacing: -.01em; }
.t-plan .day h4 small { font-weight: 500; color: var(--muted); font-size: 12px; }
.t-plan .blk { display: flex; gap: 8px; align-items: center; padding: 7px 9px; border-radius: 11px; margin-bottom: 6px; background: color-mix(in srgb, var(--dot) 13%, var(--surface)); border-left: 4px solid var(--dot); font-size: 13px; }
.t-plan .blk .t { font: 500 11.5px var(--mono); color: var(--muted); white-space: nowrap; }
.t-plan .blk .n { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-plan .blk em { font-style: normal; font-size: 11px; color: var(--muted); }
.t-plan .exam-tag { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 650; color: var(--danger); margin-bottom: 6px; }
.t-plan .free { color: var(--muted); font-size: 12.5px; }
`

const newSub = (i, name = '', exam = '', difficulty = 3) => ({ id: uid(), name, exam, difficulty, hours: NaN, color: TINTS[i % TINTS.length] })

export function mount(root) {
  toolStyle('plan', CSS)
  const saved = load('planner:state', null)
  const st = saved?.subjects ? saved : { subjects: [], start: todayStr(), hours: [3, 4, 4, 4, 4, 4, 5], sessionMin: 60, startTime: '18:00', breakMin: 10, revisionDay: true, examDayFactor: 0.5 }
  if (!validDate(st.start) || st.start < todayStr()) st.start = todayStr()
  for (const s of st.subjects) if (s.hours == null) s.hours = NaN
  const persist = () => save('planner:state', st)

  const subBox = h('div'), outBox = h('div', { class: 'stack' })
  let plan = null

  function renderSubjects() {
    clear(subBox)
    if (!st.subjects.length) {
      subBox.append(emptyState('calendar-clock', 'Add your subjects and exam dates', 'We spread your study time across the days left, give harder subjects more hours and put a revision day before each paper.',
        button('Add a subject', { icon: 'plus', variant: 'primary', onClick: () => addSub() }), button('Try an example', { icon: 'wand-sparkles', onClick: example })))
      return
    }
    subBox.append(h('div', { class: 'sub-head' }, h('span'), h('span', 'Subject'), h('span', 'Exam date'), h('span', 'Difficulty'), h('span', 'Hours'), h('span')))
    st.subjects.forEach((s, i) => {
      subBox.append(h('div', { class: 'sub-row', style: `--dot:${s.color}` }, h('span', { class: 'dotc' }),
        h('input', { class: 'input', type: 'text', value: s.name, placeholder: 'e.g. Physics', 'aria-label': `Subject ${i + 1} name`, oninput: (e) => { s.name = e.target.value; persist(); schedule() } }),
        h('input', { class: 'input', type: 'date', value: s.exam, min: addDays(st.start, 1), 'aria-label': `Exam date for ${s.name || 'subject ' + (i + 1)}`, oninput: (e) => { s.exam = e.target.value; persist(); schedule() } }),
        h('select', { class: 'select', 'aria-label': `Difficulty of ${s.name || 'subject ' + (i + 1)}`, onchange: (e) => { s.difficulty = +e.target.value; persist(); schedule() } },
          [[1, '1 Easy'], [2, '2 Light'], [3, '3 Medium'], [4, '4 Hard'], [5, '5 Very hard']].map(([v, l]) => h('option', { value: v, selected: s.difficulty === v }, l))),
        h('input', { class: 'input', type: 'number', min: 0, step: 'any', placeholder: 'Hours (auto)', value: Number.isFinite(s.hours) ? s.hours : '', 'aria-label': `Study hours wanted for ${s.name || 'subject ' + (i + 1)} (blank for automatic)`, oninput: (e) => { s.hours = e.target.valueAsNumber; persist(); schedule() } }),
        button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${s.name || 'subject ' + (i + 1)}`, onClick: () => { st.subjects.splice(i, 1); persist(); renderSubjects(); schedule() } })))
    })
    subBox.append(h('div', { class: 'row', style: 'margin-top:6px' }, button('Add subject', { icon: 'plus', size: 'sm', onClick: () => addSub() }),
      button('Clear all', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => confirmModal({ title: 'Remove all subjects?', text: 'Your subjects and exam dates saved on this device will be cleared.', yes: 'Remove', danger: true }, () => { st.subjects = []; persist(); renderSubjects(); schedule() }) })))
  }
  function addSub(name = '', exam = '', diff = 3) {
    if (st.subjects.length >= 14) { toast('That is plenty. Up to 14 subjects are supported.', 'error'); return }
    st.subjects.push(newSub(st.subjects.length, name, exam, diff)); persist(); renderSubjects(); schedule()
    subBox.querySelector('.sub-row:last-of-type input')?.focus()
  }
  function example() {
    const t = todayStr()
    st.subjects = [newSub(0, 'Mathematics', addDays(t, 12), 5), newSub(1, 'Physics', addDays(t, 15), 4), newSub(2, 'Chemistry', addDays(t, 18), 3), newSub(3, 'English', addDays(t, 20), 2)]
    persist(); renderSubjects(); schedule()
  }

  // ---------- settings ----------
  const startIn = h('input', { class: 'input', type: 'date', value: st.start, min: todayStr(), 'aria-label': 'Start date', oninput: (e) => { if (validDate(e.target.value)) { st.start = e.target.value; persist(); schedule() } } })
  const wdIns = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const inp = number(st.hours[d], { min: 0, max: 16, onInput: (n) => { st.hours[d] = Number.isFinite(n) ? n : 0; persist(); schedule() } })
    inp.setAttribute('aria-label', `Study hours on ${WD[d]}`)
    return h('label', WD[d], inp)
  })
  const allIn = number('', { min: 0, max: 16, placeholder: 'all', onInput: (n) => {
    if (!Number.isFinite(n)) return
    st.hours = st.hours.map(() => n); wdIns.forEach((l) => { l.querySelector('input').value = n }); persist(); schedule()
  } })
  const sessSel = select([[30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours']], st.sessionMin, (v) => { st.sessionMin = +v; persist(); schedule() })
  const timeIn = h('input', { class: 'input', type: 'time', value: st.startTime, 'aria-label': 'Daily start time', oninput: (e) => { st.startTime = e.target.value || '18:00'; persist(); schedule() } })
  const revT = toggle('Revision day before each exam', st.revisionDay, (v) => { st.revisionDay = v; persist(); schedule() })
  const lightT = toggle('Lighter study on exam days', st.examDayFactor < 1, (v) => { st.examDayFactor = v ? 0.5 : 1; persist(); schedule() })

  // ---------- output ----------
  let raf = 0
  const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderPlan) }
  function renderPlan() {
    const subs = st.subjects
    clear(outBox)
    if (!subs.some((s) => s.name.trim() && s.exam)) {
      plan = null
      outBox.append(tile({ tint: '#6366f1' }, emptyState('calendar-days', 'Your timetable appears here', 'Add at least one subject with an exam date. It updates as you type.')))
      return
    }
    plan = buildPlan(subs, { start: st.start, hoursByWeekday: st.hours, sessionMin: st.sessionMin, examDayFactor: st.examDayFactor, revisionDay: st.revisionDay, breakMin: st.breakMin, startTime: st.startTime })
    const col = (i) => subs[i]?.color || '#999'
    const hrs = (slots) => formatNumber((slots * st.sessionMin) / 60, 1)
    // summary cards
    const live = plan.subjects.filter((s) => s.ok)
    const scards = h('div', { class: 'scards' }, live.map((s, k) => {
      const planned = s.planned, need = s.target || 0
      return h('div', { class: 'scard', style: { '--dot': col(s.i), '--i': k } },
        h('b', s.name), h('small', `${niceDate(s.exam)} · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`),
        h('div', { class: 'big' }, `${hrs(planned)} h`),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.min(100, need ? (Math.min(planned, need) / need) * 100 : 100)}%` })),
        h('small', s.extra ? `${hrs(Math.max(0, planned - s.extra))} h core + ${hrs(s.extra)} h extra revision` : `${hrs(planned)} h planned`),
        s.shortfall > 0 ? h('div', { style: 'margin-top:6px' }, pill(`${hrs(s.shortfall)} h short`, 'bad', 'triangle-alert')) : null)
    }))
    // heat strip
    const heat = h('div', { class: 'heat', role: 'img', 'aria-label': 'Overview of study days' }, plan.days.map((d, k) => {
      const total = d.slots.filter((x) => x.s != null).length
      const counts = new Map()
      d.slots.forEach((x) => x.s != null && counts.set(x.s, (counts.get(x.s) || 0) + 1))
      let acc = 0
      const stops = [...counts].map(([s, c]) => { const a = acc; acc += (c / total) * 100; return `${col(s)} ${a}% ${acc}%` })
      const el = h('i', { class: d.exams.length ? 'exam' : '', title: `${niceDate(d.date)}${d.exams.length ? ' (exam)' : ''}: ${d.blocks.map((b) => plan.subjects[b.s].name).filter((v, i, a) => a.indexOf(v) === i).join(', ') || 'free'}`, style: { '--i': Math.min(k, 30) } })
      if (stops.length) el.style.background = `linear-gradient(to top, ${stops.join(', ')})`
      return el
    }))
    const dayCards = h('div', { class: 'days' }, plan.days.map((d, k) => {
      const cls = ['day', d.exams.length && 'is-exam', d.date === todayStr() && 'today']
      return h('div', { class: cls, style: { '--i': Math.min(k, 14) } },
        h('h4', niceDate(d.date), h('small', d.hours ? `${formatNumber(d.hours, 1)} h available` : 'no study time')),
        d.exams.map((i) => h('div', { class: 'exam-tag' }, icon('flag'), `Exam: ${plan.subjects[i].name}`)),
        d.blocks.length ? d.blocks.map((b) => h('div', { class: 'blk', style: { '--dot': col(b.s) } }, h('span', { class: 'n' }, plan.subjects[b.s].name), h('span', { class: 't' }, `${fmtHM(b.startMin)}-${fmtHM(b.endMin)}`))
        ) : (d.exams.length ? null : h('div', { class: 'free' }, 'Free day')))
    }))
    clear(outBox,
      plan.warnings.length ? h('div', { class: 'stack tight' }, plan.warnings.map((w) => h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', w)))) : null,
      tile({ tint: '#6366f1', title: 'Hours per subject', icon: 'pie-chart' },
        h('div', { class: 'row', style: 'gap:6px;margin:-4px 0 12px' },
          button('Print', { icon: 'printer', size: 'sm', onClick: () => printNode(printable(), 'Study timetable') }),
          button('Calendar (.ics)', { icon: 'calendar-plus', size: 'sm', onClick: () => download(toICS(plan), 'study-plan.ics', 'text/calendar') }),
          button('Copy', { icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => copyText(planText(plan, st.sessionMin)) })),
        scards, h('div', { style: 'margin-top:14px' }, heat),
      h('div', { class: 'stu-hint', style: 'margin-top:6px' }, 'Each square is a day; stripes show the subjects studied. A dot marks an exam day.')),
      tile({ tint: '#ec4899', title: 'Day by day', icon: 'calendar-days' }, dayCards))
  }

  function printable() {
    const p = plan
    const rows = p.days.map((d) => {
      const blocks = d.blocks.map((b) => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:3px 8px;border-left:4px solid ${col2(b.s)};background:#f4f4f6;border-radius:4px">${esc(p.subjects[b.s].name)} <span style="color:#666">${fmtHM(b.startMin)}-${fmtHM(b.endMin)}</span></span>`).join('')
      const ex = d.exams.map((i) => `<b style="color:#b91c1c">EXAM: ${esc(p.subjects[i].name)}</b> `).join('')
      return `<tr><td style="white-space:nowrap;padding:6px 10px;border-bottom:1px solid #ddd;font-weight:600">${esc(niceDate(d.date))}</td><td style="padding:6px 10px;border-bottom:1px solid #ddd">${ex}${blocks || (d.exams.length ? '' : '<span style="color:#888">Free day</span>')}</td></tr>`
    }).join('')
    const legend = p.subjects.filter((s) => s.ok).map((s) => `<span style="margin-right:14px"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${col2(s.i)};margin-right:5px"></span>${esc(s.name)} (exam ${esc(niceDate(s.exam))})</span>`).join('')
    return h('div', { html: `<div style="font:14px/1.45 system-ui,sans-serif;color:#111;padding:8px"><h1 style="font-size:24px;margin:0 0 4px">Study timetable</h1><div style="color:#555;margin-bottom:10px">From ${esc(niceDate(st.start))}. Sessions of ${st.sessionMin} min starting at ${esc(st.startTime)}.</div><div style="margin-bottom:12px">${legend}</div><table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table></div>` })
  }
  const col2 = (i) => st.subjects[i]?.color || '#888'

  renderSubjects(); renderPlan()
  root.append(stage('t-plan',
    h('div', { class: 'stack' },
      h('div', { class: 'p-top' },
        tile({ tint: '#6366f1', title: 'Subjects and exams', icon: 'book-open-check', i: 0 }, subBox),
        tile({ tint: '#f59e0b', title: 'Your time', icon: 'clock', i: 1 },
          h('div', { class: 'stack' },
            h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Start planning from'), startIn),
              h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Daily start time'), timeIn)),
            h('div', null, h('div', { class: 'field-label', style: 'margin-bottom:6px;font-size:13px;font-weight:550;color:var(--text-2);display:flex;justify-content:space-between;gap:8px' }, h('span', 'Study hours per weekday'), h('span', { style: 'width:70px' }, allIn)), h('div', { class: 'wd' }, wdIns)),
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Session length'), sessSel),
            revT, lightT))),
      outBox)))
}
