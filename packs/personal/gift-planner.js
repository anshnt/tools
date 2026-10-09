// Birthday & gift planner: occasions with yearly repeats, countdowns, gift ideas with prices, budgets and spending,
// and an .ics export so the dates show up in your calendar app. Data stays in this browser.
import { h, icon, button, input, field, select, toggle, segmented, toast, clear, modal, download } from '../../lib/ui.js'
import { app, css, makeStore, uid, today, addDays, parseYmd, ymd, fmtDate, daysBetween, money, CURRENCIES, stat, emptyState, ib, chip, checkBtn, bar, dataBar, confirmBox, plural, num, PALETTE } from './_shared.js'
import { buildIcs } from './_ics.js'

const TYPES = ['Birthday', 'Anniversary', 'Wedding', 'Festival', 'Graduation', 'Housewarming', 'Other']

/** Next date (YYYY-MM-DD) an occasion falls on, at or after `now`. Yearly occasions repeat (29 Feb falls on 28 Feb in other years). */
export function nextDate(o, now = today()) {
  if (o.date >= now) return o.date
  if (!o.yearly) return null
  const [y, m, d] = o.date.split('-').map(Number)
  const now0 = parseYmd(now)
  for (let yr = now0.getFullYear(); yr <= now0.getFullYear() + 1; yr++) {
    const dim = new Date(yr, m, 0).getDate()
    const c = `${yr}-${String(m).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`
    if (c >= now) return c
  }
  return null
}
export const daysUntil = (o, now = today()) => { const n = nextDate(o, now); return n == null ? null : daysBetween(now, n) }
/** "turns 30" / "5th anniversary" for yearly occasions with a real start year (we store year 0001 when unknown). */
export function milestone(o, now = today()) {
  const n = nextDate(o, now)
  const y0 = Number(o.date.slice(0, 4))
  if (!n || !o.yearly || y0 < 1900 || o.noYear) return ''
  const k = Number(n.slice(0, 4)) - y0
  if (k <= 0) return ''
  const ord = (x) => { const t = ['th', 'st', 'nd', 'rd'], v = x % 100; return x + (t[(v - 20) % 10] || t[v] || t[0]) }
  return o.type === 'Birthday' ? `turns ${k}` : `${ord(k)} ${o.type === 'Wedding' || o.type === 'Anniversary' ? 'anniversary' : 'year'}`
}
export const when = (days) => (days == null ? 'Past' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 7 ? `In ${days} days` : days < 31 ? `In ${Math.round(days / 7)} week${Math.round(days / 7) > 1 ? 's' : ''}` : `In ${Math.round(days / 30.4)} month${Math.round(days / 30.4) > 1 ? 's' : ''}`)
export const planned = (o) => (o.ideas || []).reduce((s, i) => s + (Number(i.price) || 0), 0)
export const spent = (o) => (o.ideas || []).filter((i) => i.bought).reduce((s, i) => s + (Number(i.price) || 0), 0)

const CSS = `
.t-gift .add{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr) auto;gap:10px;align-items:end}
@media (max-width:760px){.t-gift .add{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.t-gift .add .btn{grid-column:1/-1}}
.t-gift .occ{display:grid;gap:12px;--pc:var(--tc);transition:border-color .2s,box-shadow .2s}
.t-gift .occ.soon{border-color:color-mix(in srgb,var(--pc) 55%,var(--border))}
.t-gift .occ.today{border-color:var(--pc);box-shadow:0 0 0 4px color-mix(in srgb,var(--pc) 18%,transparent)}
.t-gift .ohead{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center}
.t-gift .av{width:46px;height:46px;border-radius:16px;display:grid;place-items:center;font-weight:700;font-size:19px;color:#fff;background:var(--pc)}
.t-gift .ohead b{display:block;font-size:16px;overflow-wrap:anywhere}
.t-gift .ohead small{color:var(--muted);font-size:12.5px}
.t-gift .when{display:inline-flex;align-items:center;height:26px;padding:0 11px;border-radius:999px;font-size:12.5px;font-weight:650;background:color-mix(in srgb,var(--pc) 15%,var(--surface));color:var(--pc);white-space:nowrap}
.t-gift .occ.today .when{background:var(--pc);color:#fff}
.t-gift .ideas{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.t-gift .idea{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:4px 2px}
.t-gift .idea.bought .tx{text-decoration:line-through;color:var(--muted)}
.t-gift .idea .pr{font-variant-numeric:tabular-nums;font-size:13px;color:var(--text-2)}
.t-gift .newidea{display:grid;grid-template-columns:minmax(0,1fr) 100px auto;gap:8px}
.t-gift .budget{display:grid;gap:6px;font-size:12.5px;color:var(--muted)}
.t-gift .budget .row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
.t-gift .grp{font-size:12px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:6px 0 -4px}
`

const blank = () => ({ occasions: [], currency: 'INR', filter: 'all', open: {} })
const hue = (name) => PALETTE[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % PALETTE.length]

export function mount(root) {
  const el = app(root, 'gift', '#ec4899')
  css('t-gift', CSS)
  const store = makeStore('gifts', blank(), (d) => { d.occasions ||= []; d.currency ||= 'INR'; d.open ||= {}; d.filter ||= 'all' })
  const S = () => store.get()
  const $$ = (n) => money(n, S().currency)
  const statsHost = h('div'), formHost = h('div'), listHost = h('div', { class: 'stack' }), dataHost = h('div')
  el.append(statsHost, formHost, listHost, dataHost)

  // ---------- add / edit occasion
  function form(o) {
    const isNew = !o
    const m = o ? structuredClone(o) : { id: uid(), person: '', type: 'Birthday', date: '', yearly: true, noYear: false, budget: '', note: '', ideas: [] }
    const names = [...new Set(S().occasions.map((x) => x.person))]
    const listId = 'gp' + uid()
    const person = input({ value: m.person, placeholder: 'Who is it for?', list: listId, maxlength: 40, 'aria-label': 'Person', autocomplete: 'off' })
    const dl = h('datalist', { id: listId }, names.map((n) => h('option', { value: n })))
    const type = select(TYPES, m.type, (v) => { m.type = v; if (v === 'Birthday' || v === 'Anniversary' || v === 'Wedding') yearly.input.checked = m.yearly = true })
    type.setAttribute('aria-label', 'Occasion')
    const date = input({ type: 'date', value: m.date, 'aria-label': 'Date', onchange: () => { m.date = date.value } })
    const budget = input({ type: 'number', min: 0, step: 'any', value: m.budget, placeholder: 'Optional', 'aria-label': 'Budget', inputmode: 'decimal' })
    const yearly = toggle('Repeats every year', m.yearly, (v) => { m.yearly = v })
    const showYear = toggle('Show age or year count', !m.noYear, (v) => { m.noYear = !v })
    const note = input({ value: m.note, placeholder: 'Notes: likes, sizes, address...', maxlength: 200, 'aria-label': 'Notes' })
    const save = () => {
      if (!person.value.trim()) { person.focus(); toast('Who is this for?', 'error'); return false }
      if (!m.date) { toast('Pick a date', 'error'); return false }
      Object.assign(m, { person: person.value.trim(), budget: budget.value === '' ? '' : Number(budget.value), note: note.value.trim() })
      if (isNew) S().occasions.push(m); else Object.assign(S().occasions.find((x) => x.id === m.id), m)
      store.save(); render(); return true
    }
    return { m, isNew, person, dl, type, date, budget, yearly, showYear, note, save }
  }
  function openForm(o) {
    const f = form(o)
    const dlg = modal({ title: f.isNew ? 'New occasion' : 'Edit occasion', icon: 'gift',
      body: h('div', { class: 'stack' }, field('Person', f.person), f.dl, h('div', { class: 'pz-row' }, field('Occasion', f.type), field('Date', f.date)), f.yearly, f.showYear, field(`Gift budget (${S().currency})`, f.budget), field('Notes', f.note)),
      actions: [!f.isNew && button('Delete', { icon: 'trash-2', variant: 'danger', onClick: async () => { if (await confirmBox({ title: `Delete ${f.m.person}'s ${f.m.type.toLowerCase()}?`, text: 'Its gift ideas are removed too.' })) { S().occasions = S().occasions.filter((x) => x.id !== f.m.id); store.save(); dlg.close(); render() } } }),
        button('Cancel', { onClick: () => dlg.close() }), button(f.isNew ? 'Add' : 'Save', { variant: 'primary', onClick: () => f.save() && dlg.close() })].filter(Boolean) })
    setTimeout(() => f.person.focus(), 60)
  }
  function quickAdd() {
    const f = form()
    const go = () => { if (f.save()) { toast('Saved. Add gift ideas on its card.', 'success'); renderForm() } }
    f.person.addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    clear(formHost, h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('calendar-plus'), 'Add a birthday or occasion'),
      h('div', { class: 'stack' }, h('div', { class: 'add' }, field('Person', f.person), field('Occasion', f.type), field('Date', f.date), button('Add', { icon: 'plus', variant: 'primary', onClick: go })), f.dl,
        h('div', { class: 'pz-row' }, f.yearly, f.showYear, h('div', { style: 'width:180px' }, field(`Budget (${S().currency})`, f.budget)), h('div', { class: 'pz-grow' }, field('Notes', f.note))))))
  }
  const renderForm = quickAdd

  // ---------- stats
  function renderStats() {
    const os = S().occasions
    const ups = os.map((o) => ({ o, d: daysUntil(o) })).filter((x) => x.d != null).sort((a, b) => a.d - b.d)
    const next = ups[0]
    const in30 = ups.filter((x) => x.d <= 30)
    const budget = in30.reduce((s, x) => s + (Number(x.o.budget) || 0), 0)
    const sp = in30.reduce((s, x) => s + spent(x.o), 0), pl = in30.reduce((s, x) => s + planned(x.o), 0)
    clear(statsHost, h('div', { class: 'pz-bento' },
      stat({ label: 'Next up', value: next ? next.o.person : '-', hint: next ? `${next.o.type}, ${when(next.d).toLowerCase()}` : 'Add an occasion below', icon: 'cake', hero: true, tone: next && next.d <= 7 ? 'warn' : undefined }),
      stat({ label: 'In the next 30 days', value: String(in30.length), hint: plural(in30.length, 'occasion'), icon: 'calendar-clock', tone: 'info' }),
      stat({ label: 'Budget (30 days)', value: budget ? $$(budget) : '-', hint: pl ? `${$$(pl)} planned` : 'no ideas yet', icon: 'wallet', tone: budget && pl > budget ? 'bad' : 'ok' }),
      stat({ label: 'Spent so far', value: $$(sp), hint: 'on gifts marked bought', icon: 'shopping-bag', tone: 'warn' })))
  }

  // ---------- list
  function ideaRow(o, i) {
    return h('li', { class: ['idea', i.bought && 'bought'] }, checkBtn(i.bought, (v) => { i.bought = v; store.save(); renderStats(); refreshBudget(o) }, `Bought ${i.text}`, 'var(--success)'),
      h('span', { class: 'tx' }, i.text), h('span', { class: 'pr' }, Number(i.price) ? $$(Number(i.price)) : ''),
      ib('x', `Remove ${i.text}`, () => { o.ideas = o.ideas.filter((x) => x !== i); store.save(); render() }, 'danger'))
  }
  const budgetEls = new Map()
  function budgetBlock(o) {
    const b = Number(o.budget) || 0, pl = planned(o), sp = spent(o)
    const bb = bar(b ? Math.max(pl, sp) / b : 0, pl > b && b ? 'var(--danger)' : 'var(--success)')
    const txt = h('div', { class: 'row' })
    const set = () => {
      const bu = Number(o.budget) || 0, p = planned(o), s = spent(o)
      clear(txt, h('span', `Planned ${$$(p)}${bu ? ` of ${$$(bu)}` : ''}`), h('span', { style: bu && p > bu ? 'color:var(--danger);font-weight:600' : '' }, bu ? (p > bu ? `${$$(p - bu)} over budget` : `${$$(bu - p)} left`) : `Spent ${$$(s)}`))
      bb.set(bu ? Math.max(p, s) / bu : 0, bu && p > bu ? 'var(--danger)' : 'var(--success)')
    }
    set()
    budgetEls.set(o.id, set)
    return o.budget || pl ? h('div', { class: 'budget' }, bb, txt) : null
  }
  function refreshBudget(o) { budgetEls.get(o.id)?.() }
  function card(o, idx) {
    const d = daysUntil(o), nx = nextDate(o)
    const color = hue(o.person)
    const ms = milestone(o)
    const open = S().open[o.id] ?? (d != null && d <= 14)
    const text = input({ placeholder: 'Add a gift idea', 'aria-label': `Gift idea for ${o.person}`, maxlength: 80 })
    const price = input({ type: 'number', min: 0, step: 'any', placeholder: 'Price', 'aria-label': 'Price', inputmode: 'decimal' })
    const addIdea = () => { const t = text.value.trim(); if (!t) { text.focus(); return } (o.ideas ||= []).push({ id: uid(), text: t, price: price.value === '' ? '' : Number(price.value), bought: false }); store.save(); S().open[o.id] = true; render(); setTimeout(() => listHost.querySelector(`[data-oid="${o.id}"] input`)?.focus(), 30) }
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addIdea() } })
    price.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addIdea() } })
    return h('article', { class: ['pz-card', 'occ', 'pz-rise', d === 0 && 'today', d != null && d <= 7 && 'soon'], 'data-oid': o.id, style: { '--pc': color, '--i': Math.min(idx, 8) } },
      h('div', { class: 'ohead' }, h('div', { class: 'av', 'aria-hidden': 'true' }, o.person[0].toUpperCase()),
        h('div', { style: 'min-width:0' }, h('b', `${o.person}'s ${o.type.toLowerCase()}`), h('small', [nx ? fmtDate(nx, { weekday: 'short', day: 'numeric', month: 'long', year: o.yearly ? undefined : 'numeric' }) : fmtDate(o.date, { day: 'numeric', month: 'short', year: 'numeric' }), ms, o.yearly ? 'every year' : ''].filter(Boolean).join(' - '))),
        h('div', { class: 'pz-row nowrap' }, h('span', { class: 'when' }, when(d)), ib('pencil', `Edit ${o.person}'s ${o.type}`, () => openForm(o)))),
      o.note ? h('p', { class: 'pz-note', style: 'margin:0' }, o.note) : null,
      budgetBlock(o),
      h('button', { type: 'button', class: 'pz-chip', style: 'justify-self:start', 'aria-expanded': String(open), onclick: () => { S().open[o.id] = !open; store.save(); render() } }, icon(open ? 'chevron-up' : 'chevron-down'), `Gift ideas (${(o.ideas || []).length})`),
      open ? h('div', { class: 'stack', style: 'gap:8px' }, (o.ideas || []).length ? h('ul', { class: 'ideas' }, o.ideas.map((i) => ideaRow(o, i))) : h('p', { class: 'pz-note', style: 'margin:0' }, 'No ideas yet. Jot down anything that comes to mind.'),
        h('div', { class: 'newidea pz-noprint' }, text, price, button('Add', { icon: 'plus', size: 'sm', onClick: addIdea }))) : null)
  }
  function render() {
    renderStats()
    budgetEls.clear()
    const os = S().occasions
    const people = [...new Set(os.map((o) => o.person))]
    if (S().filter !== 'all' && !people.includes(S().filter)) S().filter = 'all'
    const shown = os.filter((o) => S().filter === 'all' || o.person === S().filter).map((o) => ({ o, d: daysUntil(o) }))
    const up = shown.filter((x) => x.d != null).sort((a, b) => a.d - b.d)
    const past = shown.filter((x) => x.d == null).sort((a, b) => b.o.date.localeCompare(a.o.date))
    const groups = [['This week', up.filter((x) => x.d <= 7)], ['This month', up.filter((x) => x.d > 7 && x.d <= 31)], ['Later', up.filter((x) => x.d > 31)], ['Past', past]].filter(([, l]) => l.length)
    let k = 0
    clear(listHost,
      people.length > 1 ? h('div', { class: 'pz-chips scroll pz-noprint' }, chip('Everyone', { pressed: S().filter === 'all', onClick: () => { S().filter = 'all'; store.save(); render() } }), people.map((p) => chip(p, { pressed: S().filter === p, dot: hue(p), onClick: () => { S().filter = p; store.save(); render() } }))) : null,
      os.length ? groups.map(([g, l]) => h('div', { class: 'stack' }, h('div', { class: 'grp' }, g), l.map((x) => card(x.o, k++)))) : emptyState('No occasions yet', 'Add a birthday or anniversary above. You will see countdowns, gift ideas and a budget per person.', 'gift'),
      os.length ? h('div', { class: 'pz-row pz-noprint' },
        button('Add all to calendar (.ics)', { icon: 'calendar-plus', onClick: () => { download(buildIcs(os.map((o) => ({ id: o.id, title: `${o.person}'s ${o.type.toLowerCase()}`, date: o.date, allDay: true, repeat: o.yearly ? 'yearly' : 'none', interval: 1, remind: 1440, notes: o.note || '' })), { name: 'Birthdays and gifts' }), 'birthdays.ics', 'text/calendar') } }),
        select(CURRENCIES, S().currency, (v) => { S().currency = v; store.save(); render(); quickAdd() }), h('span', { class: 'pz-note' }, 'Currency')) : null)
  }

  clear(dataHost, dataBar({ kind: 'gifts', get: () => S(), set: (d) => { store.set({ ...blank(), ...d }); render(); quickAdd() }, reset: () => { store.set(blank()); render(); quickAdd() } }))
  quickAdd()
  render()
}
