// Trip itinerary planner: trips with days and items (time, place, notes, booking refs, cost, map links), drag items between
// days, print or share the plan, and optional AI ideas when an API key is set. Data stays in this browser.
import { h, icon, button, input, textarea, field, busy, toast, clear, modal, alert } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { app, css, makeStore, uid, today, addDays, fmtDate, fmtTime, parseYmd, daysBetween, money, stat, emptyState, ib, chip, docTabs, promptBox, confirmBox, dataBar, shareText, sortable, grip, plural, clamp, pad } from './_shared.js'

/** "9am Visit Amer Fort @ Amer", "14:30 Lunch at Taj", "Check in" -> {time, title, place}. */
export function parseQuick(raw) {
  let text = raw.trim().replace(/\s+/g, ' ')
  let time = ''
  const m = text.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?(?=\s|$)/i) || text.match(/^(\d{1,2})()\s*(am|pm)(?=\s|$)/i)
  if (m) {
    let hh = +m[1]
    const mm = m[2] ? +m[2] : 0
    const ap = (m[3] || '').toLowerCase()
    if (ap === 'pm' && hh < 12) hh += 12
    if (ap === 'am' && hh === 12) hh = 0
    if (hh < 24 && mm < 60) { time = `${pad(hh)}:${pad(mm)}`; text = text.slice(m[0].length).trim() }
  }
  let place = ''
  const at = text.match(/\s@\s(.+)$/) || text.match(/\sat\s([A-Z][^@]*)$/)
  if (at) { place = at[1].trim(); text = text.slice(0, at.index).trim() }
  return { time, title: text, place }
}
export const mapsUrl = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
/** Google Maps directions through every place of a day, in order (Maps allows 9 waypoints). */
export function routeUrl(places) {
  const p = places.filter(Boolean)
  if (p.length < 2) return ''
  const q = [`origin=${encodeURIComponent(p[0])}`, `destination=${encodeURIComponent(p.at(-1))}`]
  const mid = p.slice(1, -1).slice(0, 9)
  if (mid.length) q.push(`waypoints=${mid.map(encodeURIComponent).join('%7C')}`)
  return `https://www.google.com/maps/dir/?api=1&${q.join('&')}`
}
export const sortByTime = (items) => [...items].sort((a, b) => (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time || '').localeCompare(b.time || ''))
export const dayDate = (trip, i) => (trip.start ? addDays(trip.start, i) : '')
export function itineraryText(trip, cur = 'INR') {
  const out = [trip.name + (trip.dest ? ` - ${trip.dest}` : '')]
  if (trip.start && trip.days.length) out.push(`${fmtDate(trip.start, { day: 'numeric', month: 'short', year: 'numeric' })} to ${fmtDate(dayDate(trip, trip.days.length - 1), { day: 'numeric', month: 'short', year: 'numeric' })}`)
  trip.days.forEach((d, i) => {
    out.push('', `Day ${i + 1}${trip.start ? ` - ${fmtDate(dayDate(trip, i), { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}`)
    if (!d.items.length) out.push('  (free day)')
    for (const it of d.items) {
      let line = `  ${it.time ? fmtTime(it.time) + ' ' : '- '}${it.title}`
      if (it.place) line += ` @ ${it.place}`
      const extra = []
      if (it.booking) extra.push(`booking ${it.booking}`)
      if (Number(it.cost)) extra.push(money(Number(it.cost), cur))
      if (extra.length) line += ` (${extra.join(', ')})`
      out.push(line)
      if (it.notes) out.push(`      ${it.notes.replace(/\n/g, ' ')}`)
    }
  })
  return out.join('\n')
}

const CSS = `
.t-trip .hdr{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;align-items:end}
.t-trip .days{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:14px;align-items:start}
.t-trip .day{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0}
.t-trip .day>header{display:flex;align-items:center;gap:8px;min-width:0}
.t-trip .day>header .n{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--tc) 14%,var(--surface));color:var(--tc);font-weight:700;flex:none}
.t-trip .day>header .t{flex:1;min-width:0}
.t-trip .day>header b{display:block;font-size:14.5px}
.t-trip .day>header small{color:var(--muted);font-size:12px}
.t-trip .dl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;min-height:44px;border-radius:12px}
.t-trip .dl:empty::before{content:"Nothing planned yet. Add below or drop an item here.";display:grid;place-items:center;text-align:center;min-height:44px;padding:8px;border:1px dashed var(--border-strong);border-radius:12px;color:var(--muted);font-size:12.5px}
.t-trip .it{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 6px;align-items:start;padding:8px 6px 8px 2px;border-radius:14px;border:1px solid var(--border);background:var(--surface-2);cursor:default}
.t-trip .it .pz-grip{height:28px;margin-top:0}
.t-trip .it .body{min-width:0;cursor:pointer}
.t-trip .it .tm{font-size:12px;font-weight:650;color:var(--tc);font-variant-numeric:tabular-nums}
.t-trip .it .ti{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.t-trip .it .pl{display:flex;align-items:center;gap:4px;font-size:12.5px;color:var(--text-2);overflow-wrap:anywhere}
.t-trip .it .pl .icon{width:12px;height:12px;flex:none}
.t-trip .it .pl a{color:inherit;text-decoration:underline;text-decoration-color:var(--border-strong);text-underline-offset:2px}
.t-trip .it .no{font-size:12px;color:var(--muted);overflow-wrap:anywhere;white-space:pre-wrap}
.t-trip .it .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.t-trip .it .tag{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:550;border:0;cursor:pointer;background:color-mix(in srgb,var(--tc) 12%,var(--surface));color:var(--text-2)}
.t-trip .it .tag .icon{width:11px;height:11px}
.t-trip .quick{display:flex;gap:6px}
.t-trip .quick .input{min-width:0}
.t-trip .sug{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 12px;border-radius:14px;background:var(--surface-2)}
.t-trip .sug b{font-size:14px;display:block}.t-trip .sug small{color:var(--muted);font-size:12.5px;display:block;overflow-wrap:anywhere}
@media print{.t-trip .days{grid-template-columns:repeat(2,1fr)}.t-trip .day{break-inside:avoid}.t-trip .quick,.t-trip .pz-grip{display:none}.t-trip .it{background:none}}
`

const newTrip = (name = 'My trip') => ({ id: uid(), name, dest: '', start: '', notes: '', days: [{ id: uid(), items: [] }, { id: uid(), items: [] }, { id: uid(), items: [] }] })
const fresh = () => { const t = newTrip(); return { trips: [t], active: t.id, currency: 'INR' } }

export function mount(root, { signal }) {
  const el = app(root, 'trip', '#0ea5e9')
  css('t-trip', CSS)
  const store = makeStore('trips', fresh(), (d) => { if (!d.trips?.length) Object.assign(d, fresh()); d.currency ||= 'INR'; if (!d.trips.some((t) => t.id === d.active)) d.active = d.trips[0].id })
  const D = () => store.get()
  const T = () => D().trips.find((t) => t.id === D().active)
  const commit = () => { store.save(); renderAll() }
  const findItem = (id) => { for (const d of T().days) { const i = d.items.find((x) => x.id === id); if (i) return [d, i] } return [] }

  let sumHost = null
  const tabsHost = h('div'), hdrHost = h('div'), daysHost = h('div'), aiHost = h('div'), dataHost = h('div')
  el.append(h('h2', { class: 'pz-printonly', id: 'tp-print' }, ''), tabsHost, hdrHost, daysHost, aiHost, dataHost)

  function renderTabs() {
    clear(tabsHost, docTabs({
      docs: D().trips, activeId: D().active, noun: 'trip',
      onSelect: (id) => { D().active = id; store.save(); renderAll() },
      onAdd: async () => { const n = await promptBox({ title: 'New trip', label: 'Trip name', placeholder: 'Goa weekend' }); if (!n) return; const t = newTrip(n); D().trips.push(t); D().active = t.id; commit() },
      onRename: async () => { const n = await promptBox({ title: 'Rename trip', label: 'Trip name', value: T().name }); if (n) { T().name = n; commit() } },
      onDelete: async () => { if (!(await confirmBox({ title: `Delete "${T().name}"?`, text: 'The whole itinerary is removed.' }))) return; D().trips = D().trips.filter((t) => t.id !== D().active); D().active = D().trips[0]?.id; commit() },
    }))
  }

  function renderHeader() {
    const t = T()
    const dest = input({ value: t.dest, placeholder: 'e.g. Goa, India', 'aria-label': 'Destination', onchange: () => { t.dest = dest.value.trim(); store.save(); renderSummary() } })
    const start = input({ type: 'date', value: t.start, 'aria-label': 'Start date', onchange: () => { t.start = start.value; commit() } })
    const nd = input({ type: 'number', min: 1, max: 60, value: t.days.length, 'aria-label': 'Number of days', onchange: () => setDays(clamp(Math.round(nd.valueAsNumber) || 1, 1, 60)) })
    const sum = h('div')
    sumHost = sum
    clear(hdrHost, h('section', { class: 'pz-card tint pz-noprint' }, h('div', { class: 'stack' }, h('div', { class: 'hdr' }, field('Destination', dest), field('Starts on', start), field('Days', nd)), sum,
      h('div', { class: 'pz-row' }, button('Add day', { icon: 'plus', size: 'sm', onClick: () => setDays(t.days.length + 1) }),
        button('Share', { icon: 'share-2', size: 'sm', onClick: async () => { const ok = await shareText(t.name, itineraryText(t, D().currency)); if (ok) toast('Itinerary shared or copied', 'success') } }),
        button('Copy text', { icon: 'copy', size: 'sm', onClick: async () => { try { await navigator.clipboard.writeText(itineraryText(t, D().currency)); toast('Copied', 'success') } catch { toast('Could not copy', 'error') } } }),
        button('Print', { icon: 'printer', size: 'sm', onClick: () => { document.getElementById('tp-print').textContent = `${t.name}${t.dest ? ' - ' + t.dest : ''}`; window.print() } })))))
    renderSummary()
  }
  function setDays(n) {
    const t = T()
    if (n < t.days.length) {
      const drop = t.days.slice(n)
      if (drop.some((d) => d.items.length)) { confirmBox({ title: `Remove ${plural(drop.length, 'day')}?`, text: 'The last days have activities. They will be deleted.', confirm: 'Remove' }).then((ok) => { if (ok) { t.days = t.days.slice(0, n); commit() } else renderHeader() }); return }
      t.days = t.days.slice(0, n)
    } else while (t.days.length < n) t.days.push({ id: uid(), items: [] })
    commit()
  }
  function renderSummary() {
    const t = T()
    const all = t.days.flatMap((d) => d.items)
    const cost = all.reduce((s, i) => s + (Number(i.cost) || 0), 0)
    if (!sumHost) return
    clear(sumHost, h('div', { class: 'pz-bento' },
      stat({ label: 'Trip', value: plural(t.days.length, 'day'), hint: t.start ? `${fmtDate(t.start, { day: 'numeric', month: 'short' })} to ${fmtDate(dayDate(t, t.days.length - 1), { day: 'numeric', month: 'short' })}` : 'Set a start date for weekdays', icon: 'calendar-range' }),
      stat({ label: 'Things planned', value: String(all.length), hint: `${plural(t.days.filter((d) => !d.items.length).length, 'free day')}`, icon: 'list-checks', tone: 'info' }),
      stat({ label: 'Bookings', value: String(all.filter((i) => i.booking).length), hint: 'with a reference', icon: 'ticket', tone: 'ok' }),
      stat({ label: 'Estimated cost', value: cost ? money(cost, D().currency) : '-', hint: 'from items with a cost', icon: 'wallet', tone: 'warn' })))
  }

  // ---------- item form
  function itemForm(day, item) {
    const isNew = !item
    const m = item ? { ...item } : { id: uid(), time: '', title: '', place: '', booking: '', link: '', cost: '', notes: '' }
    const f = {
      time: input({ type: 'time', value: m.time, 'aria-label': 'Time' }), title: input({ value: m.title, placeholder: 'What are you doing?', maxlength: 100, 'aria-label': 'Title' }),
      place: input({ value: m.place, placeholder: 'Place or address (used for maps)', maxlength: 120, 'aria-label': 'Place' }), booking: input({ value: m.booking, placeholder: 'Confirmation number', maxlength: 60, 'aria-label': 'Booking reference' }),
      link: input({ type: 'url', value: m.link, placeholder: 'https://...', 'aria-label': 'Link' }), cost: input({ type: 'number', min: 0, step: 'any', value: m.cost, placeholder: D().currency, 'aria-label': 'Cost', inputmode: 'decimal' }), notes: textarea({ rows: 3, value: m.notes, placeholder: 'Opening hours, tips, who is coming', 'aria-label': 'Notes' }),
    }
    const dayOpts = T().days.map((d, i) => h('option', { value: d.id, selected: d.id === day.id }, `Day ${i + 1}${T().start ? ` (${fmtDate(dayDate(T(), i), { weekday: 'short', day: 'numeric', month: 'short' })})` : ''}`))
    const daySel = h('select', { class: 'select', 'aria-label': 'Day' }, dayOpts)
    const go = () => {
      if (!f.title.value.trim()) { f.title.focus(); toast('Add a title', 'error'); return }
      const link = f.link.value.trim()
      if (link && !/^https?:\/\//i.test(link)) { toast('The link must start with http:// or https://', 'error'); return }
      Object.assign(m, { time: f.time.value, title: f.title.value.trim(), place: f.place.value.trim(), booking: f.booking.value.trim(), link, cost: f.cost.value === '' ? '' : Number(f.cost.value), notes: f.notes.value.trim() })
      const to = T().days.find((d) => d.id === daySel.value)
      if (!isNew) { const [from] = findItem(m.id); if (from) from.items = from.items.filter((x) => x.id !== m.id) }
      to.items.push(m)
      commit(); dlg.close()
    }
    const dlg = modal({ title: isNew ? 'Add to itinerary' : 'Edit item', icon: 'map-pin',
      body: h('div', { class: 'stack' }, field('Title', f.title), h('div', { class: 'pz-row' }, field('Time', f.time), h('div', { class: 'pz-grow' }, field('Day', daySel))), field('Place', f.place), h('div', { class: 'pz-row' }, h('div', { class: 'pz-grow' }, field('Booking reference', f.booking)), field('Cost', f.cost)), field('Link (tickets, hotel page)', f.link), field('Notes', f.notes)),
      actions: [!isNew && button('Delete', { icon: 'trash-2', variant: 'danger', onClick: () => { const [d] = findItem(m.id); d.items = d.items.filter((x) => x.id !== m.id); commit(); dlg.close() } }), button('Cancel', { onClick: () => dlg.close() }), button(isNew ? 'Add' : 'Save', { variant: 'primary', onClick: go })].filter(Boolean) })
    f.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go() } })
    setTimeout(() => f.title.focus(), 60)
  }

  // ---------- days
  function itemEl(d, it) {
    const tags = []
    if (it.booking) tags.push(h('button', { type: 'button', class: 'tag', title: 'Copy booking reference', onclick: (e) => { e.stopPropagation(); navigator.clipboard?.writeText(it.booking).then(() => toast('Booking reference copied'), () => {}) } }, icon('ticket'), it.booking))
    if (it.link) tags.push(h('a', { class: 'tag', href: it.link, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, icon('external-link'), 'Link'))
    if (Number(it.cost)) tags.push(h('span', { class: 'tag' }, icon('wallet'), money(Number(it.cost), D().currency)))
    return h('li', { class: 'it', 'data-id': it.id }, grip(),
      h('div', { class: 'body', onclick: () => itemForm(d, it) }, it.time ? h('div', { class: 'tm' }, fmtTime(it.time)) : null, h('div', { class: 'ti' }, it.title),
        it.place ? h('div', { class: 'pl' }, icon('map-pin'), h('a', { href: mapsUrl(it.place), target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation(), title: 'Open in Google Maps' }, it.place)) : null,
        it.notes ? h('div', { class: 'no' }, it.notes) : null, tags.length ? h('div', { class: 'tags' }, tags) : null),
      ib('pencil', `Edit ${it.title}`, () => itemForm(d, it)))
  }
  function dayEl(d, i) {
    const t = T()
    const quick = input({ placeholder: 'Add: 9am Amer Fort @ Amer', 'aria-label': `Quick add to day ${i + 1}`, autocomplete: 'off', enterkeyhint: 'done' })
    const add = () => {
      if (!quick.value.trim()) return
      const p = parseQuick(quick.value)
      if (!p.title) { toast('Add a title after the time', 'error'); return }
      d.items.push({ id: uid(), time: p.time, title: p.title, place: p.place, booking: '', link: '', cost: '', notes: '' }); commit()
      setTimeout(() => daysHost.querySelector(`[data-day="${d.id}"] input`)?.focus(), 30)
    }
    quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add() } })
    const route = routeUrl(d.items.map((x) => x.place))
    return h('section', { class: 'day pz-rise', 'data-day': d.id, style: { '--i': Math.min(i, 8) } },
      h('header', h('span', { class: 'n' }, String(i + 1)), h('div', { class: 't' }, h('b', `Day ${i + 1}`), h('small', t.start ? fmtDate(dayDate(t, i), { weekday: 'long', day: 'numeric', month: 'short' }) : plural(d.items.length, 'item'))),
        route ? h('a', { class: 'pz-ib', href: route, target: '_blank', rel: 'noopener noreferrer', title: 'Route for this day in Google Maps', 'aria-label': `Route for day ${i + 1}` }, icon('route')) : null,
        d.items.length > 1 ? ib('arrow-down-wide-narrow', 'Sort by time', () => { d.items = sortByTime(d.items); commit() }) : null,
        ib('trash-2', `Delete day ${i + 1}`, async () => { if (d.items.length && !(await confirmBox({ title: `Delete day ${i + 1}?`, text: `Its ${plural(d.items.length, 'item')} are removed too.` }))) return; t.days = t.days.filter((x) => x !== d); if (!t.days.length) t.days.push({ id: uid(), items: [] }); commit() }, 'danger')),
      h('ul', { class: 'dl', 'data-day': d.id }, d.items.map((it) => itemEl(d, it))),
      h('div', { class: 'quick pz-noprint' }, quick, button('', { icon: 'plus', variant: 'primary', ariaLabel: `Add to day ${i + 1}`, onClick: add }), button('', { icon: 'square-pen', ariaLabel: `Add details to day ${i + 1}`, title: 'Add with details', onClick: () => itemForm(d) })))
  }
  function renderDays() {
    const t = T()
    clear(daysHost, h('div', { class: 'days' }, t.days.map(dayEl)))
    if (!t.days.some((d) => d.items.length) ) daysHost.append(h('p', { class: 'pz-note pz-noprint', style: 'margin-top:10px' }, 'Tip: type "9am Visit the fort @ Amer" and press Enter. The time and place are picked out for you. Drag the grip to reorder or move items to another day.'))
  }
  sortable({ root: daysHost, containers: () => [...daysHost.querySelectorAll('.dl')], item: '.it', handle: '.pz-grip', onDrop: ({ from, to }) => {
    const t = T()
    const all = new Map(t.days.flatMap((d) => d.items).map((i) => [i.id, i]))
    for (const ul of new Set([from, to])) { const day = t.days.find((d) => d.id === ul.dataset.day); if (day) day.items = [...ul.children].filter((c) => c.dataset.id).map((c) => all.get(c.dataset.id)).filter(Boolean) }
    store.save(); renderSummary()
  } })

  // ---------- AI ideas (optional)
  function renderAi() {
    const t = T()
    const wants = input({ placeholder: 'What do you like? e.g. street food, beaches, relaxed pace, with kids', 'aria-label': 'Interests', maxlength: 200 })
    const daySel = h('select', { class: 'select', style: 'width:auto', 'aria-label': 'Day for ideas' }, t.days.map((_, i) => h('option', { value: i }, `Day ${i + 1}`)))
    const out = h('div', { class: 'stack' })
    const btn = button('Suggest ideas', { icon: 'sparkles', variant: 'primary', onClick: () => busy(btn, async () => {
      if (!t.dest.trim()) { toast('Set a destination first', 'error'); return }
      if (!(await ai.ensureKey())) return
      const i = Number(daySel.value)
      const day = t.days[i]
      const have = day.items.map((x) => `${x.time || ''} ${x.title}`.trim()).join('; ') || 'nothing yet'
      const res = await ai.ask({ signal,
        system: 'You are a practical travel planner. Suggest realistic activities for one day with sensible timing and short, factual notes. Do not invent prices, opening hours or booking details.',
        prompt: `Destination: ${t.dest}. Trip length: ${t.days.length} days. This is day ${i + 1}${t.start ? ` (${fmtDate(dayDate(t, i), { weekday: 'long', day: 'numeric', month: 'long' })})` : ''}. Already planned that day: ${have}. Traveller interests: ${wants.value.trim() || 'general sightseeing, local food'}. Suggest 4 to 6 activities in a good order for the day.`,
        json: { type: 'object', properties: { ideas: { type: 'array', items: { type: 'object', properties: { time: { type: 'string', description: '24-hour HH:MM start time' }, title: { type: 'string' }, place: { type: 'string', description: 'A place name that works in a maps search' }, notes: { type: 'string' } }, required: ['time', 'title', 'place', 'notes'], additionalProperties: false } } }, required: ['ideas'], additionalProperties: false } })
      const ideas = (res?.ideas || []).filter((x) => x?.title)
      clear(out, ideas.length ? [h('div', { class: 'pz-row' }, h('span', { class: 'pz-note' }, 'Ideas for day ' + (i + 1)), button('Add all', { size: 'sm', onClick: () => { for (const s of ideas) day.items.push({ id: uid(), time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '', title: s.title, place: s.place || '', booking: '', link: '', cost: '', notes: s.notes || '' }); commit() } })),
        ideas.map((s) => h('div', { class: 'sug' }, h('div', h('b', `${/^\d{2}:\d{2}$/.test(s.time) ? fmtTime(s.time) + ' ' : ''}${s.title}`), h('small', [s.place, s.notes].filter(Boolean).join(' - '))),
          button('Add', { size: 'sm', icon: 'plus', onClick: (e) => { day.items.push({ id: uid(), time: /^\d{2}:\d{2}$/.test(s.time) ? s.time : '', title: s.title, place: s.place || '', booking: '', link: '', cost: '', notes: s.notes || '' }); store.save(); renderDays(); renderSummary(); e.currentTarget.disabled = true; e.currentTarget.querySelector('span').textContent = 'Added' } })))]
        : alert('info', 'No ideas came back. Try describing what you like.'))
    }, { label: 'Thinking', errorTo: out }) })
    clear(aiHost, h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('sparkles'), 'Ideas from AI (optional)'),
      h('div', { class: 'stack' }, ai.notice('Suggestions come from your own AI key. Only the destination, day and interests are sent.'), h('div', { class: 'pz-row' }, h('div', { class: 'pz-grow', style: 'min-width:220px' }, wants), daySel, btn), out,
        h('p', { class: 'pz-note' }, 'Always double-check opening hours and prices before you go.'))))
  }

  function renderAll() { renderTabs(); renderHeader(); renderDays(); renderAi() }
  clear(dataHost, dataBar({ kind: 'trips', get: () => D(), set: (d) => { store.set(d.trips?.length ? { currency: 'INR', ...d } : fresh()); renderAll() }, reset: () => { store.set(fresh()); renderAll() } }))
  renderAll()
}
