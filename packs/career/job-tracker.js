// Job application tracker: a kanban board (wishlist, applied, interview, offer, closed) stored on this device. Drag cards between columns
// or use the arrows, set follow-up dates that turn into reminders, watch your weekly goal and export CSV or JSON.
import { h, icon, button, toast, alert, field, input, select, modal, clear, debounce, stats, copyText, errorMessage } from '../../lib/ui.js'
import { pickFiles } from '../../lib/files.js'
import { load, save } from '../../lib/store.js'
import { shell, banner, card, fi, uid, ring, saveAs, burst, moreMenu, saveIndicator } from './_kit.js'

const KEY = 'jobs:list', GOAL = 'jobs:goal'
export const COLUMNS = [['wishlist', 'Wishlist', 'bookmark', '#7c5cf0'], ['applied', 'Applied', 'send', '#2f7de1'], ['interview', 'Interviewing', 'messages-square', '#e5833a'], ['offer', 'Offer', 'party-popper', '#12804a'], ['rejected', 'Closed', 'archive', '#8a8f98']]
const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const pretty = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')

export const blankJob = (status = 'wishlist') => ({ id: uid(), company: '', role: '', status, location: '', link: '', salary: '', applied: status === 'applied' ? iso() : '', next: '', nextDate: '', contact: '', notes: '', star: false, updated: Date.now() })
export const mondayOf = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }

export function summarize(jobs, today = iso(), goal = 5) {
  const by = Object.fromEntries(COLUMNS.map(([id]) => [id, jobs.filter((j) => j.status === id).length]))
  const submitted = by.applied + by.interview + by.offer + by.rejected
  const wk = iso(mondayOf())
  const week = jobs.filter((j) => j.applied && j.applied >= wk && j.applied <= today).length
  const due = jobs.filter((j) => j.nextDate && j.nextDate <= today && j.status !== 'rejected')
  return { by, total: jobs.length, active: by.applied + by.interview, submitted, rate: submitted ? Math.round(((by.interview + by.offer) / submitted) * 100) : 0, week, goal, due }
}
export function toCsv(jobs) {
  const cols = [['Company', 'company'], ['Role', 'role'], ['Status', 'status'], ['Location', 'location'], ['Salary', 'salary'], ['Applied', 'applied'], ['Next step', 'next'], ['Next date', 'nextDate'], ['Contact', 'contact'], ['Link', 'link'], ['Notes', 'notes']]
  const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return [cols.map((c) => q(c[0])).join(','), ...jobs.map((j) => cols.map((c) => q(c[1] === 'status' ? (COLUMNS.find((x) => x[0] === j.status)?.[1] || j.status) : j[c[1]])).join(','))].join('\r\n') + '\r\n'
}

export async function mount(root) {
  let jobs = (load(KEY, []) || []).filter((j) => j && j.id)
  let goal = Number(load(GOAL, 5)) || 5
  let q = ''
  const saved = saveIndicator('Saved on this device')
  const persist = debounce(() => { save(KEY, jobs); saved.saved() }, 200)
  const board = h('div', { class: 'cr-board' })
  const statHost = h('div')
  const dueHost = h('div')

  function touch() { saved.dirty(); persist(); drawAll() }
  function move(j, status) { if (j.status === status) return; j.status = status; j.updated = Date.now(); if (status === 'applied' && !j.applied) j.applied = iso(); touch(); if (status === 'offer') burst() }

  function drawStats() {
    const s = summarize(jobs, iso(), goal)
    clear(statHost, h('div', { class: 'cr-statrow' },
      h('div', { class: 'cr-card tint', style: 'display:flex;align-items:center;gap:18px;flex-wrap:wrap' }, ring(goal ? Math.min(100, (s.week / goal) * 100) : 0, { label: 'this week', size: 112, stroke: 9 }), h('div', { class: 'stack tight' }, h('b', `${s.week} of ${goal} applications this week`), h('div', { class: 'small muted' }, s.week >= goal ? 'Goal reached. Nice work!' : `${goal - s.week} to go. Small steady steps win.`),
        h('div', { class: 'row small' }, 'Weekly goal', Object.assign(input({ type: 'number', min: 1, max: 100, 'aria-label': 'Weekly goal', style: 'width:76px;height:34px' }), { value: String(goal), oninput: (e) => { goal = Math.max(1, Math.min(100, +e.target.value || 5)); save(GOAL, goal); drawStats() } })))),
      stats([{ label: 'Tracked', value: String(s.total) }, { label: 'In progress', value: String(s.active), hint: 'Applied or interviewing' }, { label: 'Interview rate', value: s.submitted ? `${s.rate}%` : '-', hint: `${s.by.interview + s.by.offer} of ${s.submitted} applications`, accent: true }, { label: 'Offers', value: String(s.by.offer) }])))
    clear(dueHost, s.due.length ? alert('warn', h('strong', `${s.due.length} follow-up${s.due.length > 1 ? 's' : ''} due: `), s.due.slice(0, 4).map((j) => `${j.company || 'Company'}${j.next ? ` (${j.next})` : ''}`).join(', '), s.due.length > 4 ? ` and ${s.due.length - 4} more` : '') : null)
  }

  function jobCard(j) {
    const today = iso()
    const overdue = j.nextDate && j.nextDate < today && j.status !== 'rejected'
    const dueToday = j.nextDate === today
    const idx = COLUMNS.findIndex((c) => c[0] === j.status)
    const el = h('div', { class: 'cr-job', draggable: 'true', dataset: { id: j.id }, tabindex: 0, role: 'button', 'aria-label': `${j.company || 'Company'}, ${j.role || 'role'}. Press Enter to edit.`,
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', j.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging') }, ondragend: () => el.classList.remove('dragging'),
      onclick: (e) => { if (!e.target.closest('button')) edit(j) }, onkeydown: (e) => { if (e.key === 'Enter' && e.target === el) edit(j) } },
    h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:nowrap;gap:6px' }, h('b', { class: 'co' }, j.company || 'New company'),
      h('button', { type: 'button', class: ['cr-star', j.star && 'on'], 'aria-pressed': String(!!j.star), 'aria-label': j.star ? 'Remove star' : 'Star this job', onclick: () => { j.star = !j.star; touch() } }, icon('star'))),
    h('div', { class: 'small', style: 'color:var(--text-2)' }, j.role || 'Role'),
    h('div', { class: 'cr-chips', style: 'margin-top:6px' }, [j.location && ['map-pin', j.location], j.salary && ['banknote', j.salary], j.applied && ['calendar-check', `Applied ${pretty(j.applied)}`]].filter(Boolean).map(([ic, t]) => h('span', { class: 'cr-chip', style: 'min-height:24px;font-size:12px;padding:1px 9px' }, icon(ic), t))),
    j.next || j.nextDate ? h('div', { class: ['cr-next', overdue && 'bad', dueToday && 'today'] }, icon(overdue ? 'alarm-clock' : 'calendar-clock'), h('span', `${j.next || 'Follow up'}${j.nextDate ? `, ${pretty(j.nextDate)}${overdue ? ' (overdue)' : dueToday ? ' (today)' : ''}` : ''}`)) : null,
    h('div', { class: 'row', style: 'justify-content:space-between;margin-top:8px;gap:4px' },
      h('div', { class: 'row', style: 'gap:2px' }, button('', { icon: 'chevron-left', variant: 'ghost', size: 'sm', ariaLabel: 'Move to the previous column', disabled: idx === 0, onClick: () => move(j, COLUMNS[idx - 1][0]) }), button('', { icon: 'chevron-right', variant: 'ghost', size: 'sm', ariaLabel: 'Move to the next column', disabled: idx === COLUMNS.length - 1, onClick: () => move(j, COLUMNS[idx + 1][0]) })),
      j.link ? h('a', { class: 'small link', href: /^https?:/i.test(j.link) ? j.link : `https://${j.link}`, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, 'Job post') : null))
    return el
  }

  function drawBoard() {
    const needle = q.trim().toLowerCase()
    const match = (j) => !needle || `${j.company} ${j.role} ${j.location} ${j.notes} ${j.contact}`.toLowerCase().includes(needle)
    clear(board, COLUMNS.map(([id, name, ic, color]) => {
      const list = jobs.filter((j) => j.status === id && match(j)).sort((a, b) => (b.star - a.star) || b.updated - a.updated)
      const col = h('section', { class: 'cr-col', style: { '--k': color }, dataset: { status: id }, 'aria-label': `${name}, ${list.length} jobs`,
        ondragover: (e) => { e.preventDefault(); col.classList.add('over') }, ondragleave: (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over') },
        ondrop: (e) => { e.preventDefault(); col.classList.remove('over'); const j = jobs.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (j) move(j, id) } },
      h('div', { class: 'cr-col-h' }, icon(ic), h('b', name), h('span', { class: 'n' }, String(list.length)), button('', { icon: 'plus', variant: 'ghost', size: 'sm', ariaLabel: `Add a job to ${name}`, onClick: () => edit(blankJob(id), true) })),
      h('div', { class: 'cr-col-b' }, list.length ? list.map(jobCard) : h('div', { class: 'small muted', style: 'padding:10px 4px' }, id === 'wishlist' ? 'Save jobs you want to apply to.' : 'Drop a card here.')))
      return col
    }))
  }
  const drawAll = () => { drawStats(); drawBoard() }

  function edit(job, isNew = false) {
    const j = { ...job }
    const exists = jobs.some((x) => x.id === job.id)
    const del = !isNew && exists ? button('Delete', { icon: 'trash-2', variant: 'danger', onClick: () => { jobs = jobs.filter((x) => x.id !== j.id); m.close(); touch(); toast('Removed') } }) : null
    const sv = button(isNew ? 'Add job' : 'Save', { icon: 'check', variant: 'primary' })
    const body = h('div', { class: 'stack tight' },
      h('div', { class: 'grid-2' }, fi(j, 'company', 'Company', { ph: 'Northwind Labs' }), fi(j, 'role', 'Role', { ph: 'Product Designer' })),
      h('div', { class: 'grid-2' }, field('Status', select(COLUMNS.map(([id, n]) => [id, n]), j.status, (v) => { j.status = v; if (v === 'applied' && !j.applied) { j.applied = iso(); dateIn.value = j.applied } })), fi(j, 'applied', 'Date applied', { type: 'date' })),
      h('div', { class: 'grid-2' }, fi(j, 'location', 'Location', { ph: 'Remote or Bengaluru' }), fi(j, 'salary', 'Salary or range', { ph: '24 to 30 LPA' })),
      fi(j, 'link', 'Job post link', { ph: 'https://...' }),
      h('div', { class: 'grid-2' }, fi(j, 'next', 'Next step', { ph: 'Send thank-you note' }), fi(j, 'nextDate', 'Follow up on', { type: 'date' })),
      fi(j, 'contact', 'Contact', { ph: 'Priya Sharma, recruiter, priya@northwind.example' }),
      fi(j, 'notes', 'Notes', { area: true, rows: 4, ph: 'Interview feedback, questions to ask, salary talk...' }))
    const dateIn = body.querySelectorAll('input[type=date]')[0]
    const m = modal({ title: isNew ? 'Add a job' : 'Edit job', icon: 'briefcase', body, actions: [del, sv].filter(Boolean) })
    const submit = () => {
      if (!j.company.trim() && !j.role.trim()) { toast('Add a company or a role', 'error'); return }
      j.updated = Date.now()
      const i = jobs.findIndex((x) => x.id === j.id)
      if (i >= 0) jobs[i] = j; else jobs.unshift(j)
      m.close(); touch()
    }
    sv.addEventListener('click', submit)
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit() })
    setTimeout(() => body.querySelector('input')?.focus(), 60)
  }

  const search = input({ placeholder: 'Search company, role, notes...', 'aria-label': 'Search jobs', style: 'max-width:300px' })
  search.addEventListener('input', () => { q = search.value; drawBoard() })

  root.append(shell(
    banner({ icon: 'kanban', text: '<b>Keep your job search organized.</b> Track every application from wishlist to offer, set follow-up dates and see your weekly pace. Stored only on this device.', steps: ['Add jobs', 'Move them along', 'Follow up'] }),
    dueHost, statHost,
    h('div', { class: 'row' }, button('Add job', { icon: 'plus', variant: 'primary', onClick: () => edit(blankJob('applied'), true) }), search,
      moreMenu('More', 'ellipsis', [
        { label: 'Export CSV', icon: 'sheet', onClick: () => saveAs(toCsv(jobs), 'job-applications.csv', 'text/csv;charset=utf-8') },
        { label: 'Export JSON backup', icon: 'save', onClick: () => saveAs(JSON.stringify(jobs, null, 2), 'job-applications.json', 'application/json') },
        { label: 'Import JSON backup', icon: 'folder-open', onClick: async () => {
          const [f] = await pickFiles({ accept: '.json,application/json' })
          if (!f) return
          try {
            const arr = JSON.parse(await f.text())
            if (!Array.isArray(arr)) throw new Error('This is not a job tracker backup.')
            const known = new Set(jobs.map((x) => x.id))
            const add = arr.filter((x) => x && typeof x === 'object' && (x.company || x.role) && !known.has(x.id)).map((x) => ({ ...blankJob(), ...x, id: x.id || uid(), status: COLUMNS.some((c) => c[0] === x.status) ? x.status : 'wishlist' }))
            jobs = [...add, ...jobs]; touch(); toast(`Imported ${add.length} job${add.length === 1 ? '' : 's'}`, 'success')
          } catch (e) { toast(e instanceof SyntaxError ? 'That file is not valid JSON.' : errorMessage(e), 'error') }
        } },
        { label: 'Copy follow-ups', icon: 'copy', onClick: () => { const l = jobs.filter((j) => j.nextDate).sort((a, b) => a.nextDate.localeCompare(b.nextDate)).map((j) => `${j.nextDate}  ${j.company}: ${j.next || 'follow up'}`); l.length ? copyText(l.join('\n')) : toast('No follow-ups set', 'error') } },
      ]), saved.el),
    board))
  drawAll()
}
