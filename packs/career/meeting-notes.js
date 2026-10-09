// Meeting notes: a structured editor (details, attendees, agenda, notes, decisions, action items with owner and due date) that
// autosaves several meetings on this device and exports Markdown, Word, PDF or copyable text. Raw notes can be sorted locally
// (lines like "Action: ..." and "Decision: ...") or cleaned up by Claude.
import { h, icon, button, busy, toast, alert, field, input, textarea, select, clear, copyText, debounce, modal, errorMessage } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { safeName } from '../../lib/files.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, fi, uid, sortable, handle, burst, saveAs, saveIndicator, chip } from './_kit.js'
import { blocksToDocx, blocksToPdf } from './_doc.js'

const KEY = 'meeting:notes'
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const prettyDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : v || '')
export const blank = () => ({ id: uid(), title: '', date: isoToday(), time: '', location: '', facilitator: '', attendees: [], agenda: [], notes: '', decisions: [], actions: [], next: '', updated: Date.now() })

export function normalize(n) {
  const b = blank()
  const o = { ...b, ...(n && typeof n === 'object' ? n : {}) }
  const arr = (a, f) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object').map((x) => ({ id: x.id || uid(), ...f(x) })) : [])
  o.attendees = arr(o.attendees, (x) => ({ name: String(x.name || ''), absent: !!x.absent })).filter((a) => a.name)
  o.agenda = arr(o.agenda, (x) => ({ text: String(x.text || ''), done: !!x.done }))
  o.decisions = arr(o.decisions, (x) => ({ text: String(x.text || '') }))
  o.actions = arr(o.actions, (x) => ({ task: String(x.task || ''), owner: String(x.owner || ''), due: String(x.due || ''), done: !!x.done }))
  for (const k of ['title', 'date', 'time', 'location', 'facilitator', 'notes', 'next']) o[k] = String(o[k] ?? '')
  return o
}

// ---------- exports ----------
const att = (n) => n.attendees.filter((a) => !a.absent).map((a) => a.name)
const absent = (n) => n.attendees.filter((a) => a.absent).map((a) => a.name)
export function toMarkdown(n) {
  const L = [`# ${n.title || 'Meeting notes'}`, '']
  const meta = [[`Date`, prettyDate(n.date) + (n.time ? `, ${n.time}` : '')], ['Location', n.location], ['Facilitator', n.facilitator], ['Attendees', att(n).join(', ')], ['Absent', absent(n).join(', ')]].filter(([, v]) => v)
  for (const [k, v] of meta) L.push(`**${k}:** ${v}  `)
  const ag = n.agenda.filter((a) => a.text.trim())
  if (ag.length) L.push('', '## Agenda', ...ag.map((a, i) => `${i + 1}. ${a.done ? '~~' : ''}${a.text.trim()}${a.done ? '~~' : ''}`))
  if (n.notes.trim()) L.push('', '## Notes', n.notes.trim())
  const dc = n.decisions.filter((d) => d.text.trim())
  if (dc.length) L.push('', '## Decisions', ...dc.map((d) => `- ${d.text.trim()}`))
  const ac = n.actions.filter((a) => a.task.trim())
  if (ac.length) L.push('', '## Action items', ...ac.map((a) => `- [${a.done ? 'x' : ' '}] ${a.task.trim()}${a.owner ? ` (${a.owner.trim()})` : ''}${a.due ? `, due ${prettyDate(a.due)}` : ''}`))
  if (n.next.trim()) L.push('', '## Next meeting', n.next.trim())
  return L.join('\n') + '\n'
}
export function toText(n) {
  return toMarkdown(n).replace(/^# (.*)$/m, (m, t) => `${t.toUpperCase()}\n${'='.repeat(Math.min(60, t.length))}`).replace(/^## (.*)$/gm, (m, t) => `\n${t.toUpperCase()}`).replace(/\*\*(.*?)\*\*/g, '$1').replace(/~~/g, '').replace(/  $/gm, '')
}
export function toBlocks(n) {
  const B = [{ t: 'name', text: n.title || 'Meeting notes' }]
  const meta = [['Date', prettyDate(n.date) + (n.time ? `, ${n.time}` : '')], ['Location', n.location], ['Facilitator', n.facilitator], ['Attendees', att(n).join(', ')], ['Absent', absent(n).join(', ')]].filter(([, v]) => v)
  for (const [k, v] of meta) B.push({ t: 'kv', label: k, text: v })
  const ag = n.agenda.filter((a) => a.text.trim())
  if (ag.length) { B.push({ t: 'h', text: 'Agenda' }); ag.forEach((a, i) => B.push({ t: 'li', text: `${a.text.trim()}${a.done ? ' (done)' : ''}` })) }
  if (n.notes.trim()) { B.push({ t: 'h', text: 'Notes' }); B.push({ t: 'p', text: n.notes.trim() }) }
  const dc = n.decisions.filter((d) => d.text.trim())
  if (dc.length) { B.push({ t: 'h', text: 'Decisions' }); dc.forEach((d) => B.push({ t: 'li', text: d.text.trim() })) }
  const ac = n.actions.filter((a) => a.task.trim())
  if (ac.length) { B.push({ t: 'h', text: 'Action items' }); ac.forEach((a) => B.push({ t: 'li', text: `${a.done ? '[Done] ' : ''}${a.task.trim()}${a.owner ? ` - ${a.owner.trim()}` : ''}${a.due ? `, due ${prettyDate(a.due)}` : ''}` })) }
  if (n.next.trim()) { B.push({ t: 'h', text: 'Next meeting' }); B.push({ t: 'p', text: n.next.trim() }) }
  return B
}

// ---------- local raw-notes sorter ----------
const ACTION = /^\s*(?:[-*•]\s*)?(?:\[\s?\]\s*)?(?:action(?: item)?s?|a\/i|ai|todo|to-do|to do|follow[- ]?up|next step)\s*[:\-]\s*(.+)$/i
const DECISION = /^\s*(?:[-*•]\s*)?(?:decision|decided|agreed|resolved)\s*[:\-]?\s*(.+)$/i
const OWNER_TO = /^@?([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\s+(?:to|will|should|needs to|is going to)\s+(.+)$/
const DUE = /\b(?:by|due|before|on)\s+(\d{4}-\d{2}-\d{2}|(?:mon|tues?|wednes|thurs?|fri|satur|sun)day|tomorrow|today|next week|end of (?:the )?(?:day|week|month)|eod|eow|\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+|[A-Z][a-z]+\s+\d{1,2}(?:st|nd|rd|th)?)\b/i
export function sortRaw(raw) {
  const out = { attendees: [], agenda: [], decisions: [], actions: [], notes: [], title: '' }
  let mode = ''
  for (const line0 of raw.replace(/\r/g, '').split('\n')) {
    const line = line0.trim()
    if (!line) { mode = mode === 'notes' ? 'notes' : ''; continue }
    let m
    if ((m = line.match(/^(?:attendees?|present|participants?|who)\s*[:\-]\s*(.+)$/i))) { out.attendees.push(...m[1].split(/[,;]|\band\b/).map((x) => x.trim()).filter(Boolean)); continue }
    if (/^(?:agenda|topics?)\s*[:\-]?\s*$/i.test(line)) { mode = 'agenda'; continue }
    if (/^(?:decisions?)\s*[:\-]?\s*$/i.test(line)) { mode = 'decisions'; continue }
    if (/^(?:action items?|actions?|todos?|next steps?)\s*[:\-]?\s*$/i.test(line)) { mode = 'actions'; continue }
    if ((m = line.match(/^(?:title|subject|meeting)\s*[:\-]\s*(.+)$/i))) { out.title = m[1].trim(); continue }
    const bare = line.replace(/^[-*•\d.)\s]+/, '').replace(/^\[\s?[xX ]?\s?\]\s*/, '')
    const act = (txt) => {
      const o = txt.match(OWNER_TO)
      const due = txt.match(DUE)
      out.actions.push({ task: (o ? o[2] : txt).replace(DUE, '').replace(/[\s,;]+$/, '').trim(), owner: o ? o[1] : '', due: due ? (/^\d{4}-/.test(due[1]) ? due[1] : due[1]) : '' })
    }
    if ((m = line.match(ACTION))) { act(m[1]); continue }
    if ((m = line.match(DECISION)) && !/^(?:decided|agreed|resolved)$/i.test(m[1])) { out.decisions.push(m[1].replace(/^to\s+/i, 'To ').trim()); continue }
    if (line.startsWith('@') && OWNER_TO.test(bare)) { act(bare); continue }
    if (mode === 'agenda') { out.agenda.push(bare); continue }
    if (mode === 'decisions') { out.decisions.push(bare); continue }
    if (mode === 'actions') { act(bare); continue }
    if (/^\[\s?\]/.test(line)) { act(bare); continue }
    if (OWNER_TO.test(bare) && /\b(?:by|due|will|to)\b/.test(bare) && /^[-*•@]/.test(line)) { act(bare); continue }
    out.notes.push(line0.replace(/\s+$/, ''))
    mode = 'notes'
  }
  return out
}

export async function mount(root, { signal }) {
  let notes = load(KEY, []).map(normalize)
  const cur = load('meeting:current', '')
  let n = notes.find((x) => x.id === cur) || notes[0]
  if (!n) { n = blank(); notes = [n] }
  const saved = saveIndicator('Autosaved on this device')
  const persist = debounce(() => { n.updated = Date.now(); const i = notes.findIndex((x) => x.id === n.id); if (i < 0) notes.unshift(n); save(KEY, notes.slice(0, 60)); save('meeting:current', n.id); saved.saved(); drawPicker() }, 450)
  const touch = () => { saved.dirty(); persist() }
  const editor = h('div', { class: 'stack' })
  const picker = h('div')
  const progressHost = h('span', { class: 'small muted' })

  function drawPicker() {
    const opts = [...notes].sort((a, b) => b.updated - a.updated).map((x) => [x.id, `${x.title || 'Untitled meeting'} (${prettyDate(x.date) || 'no date'})`])
    clear(picker, h('div', { class: 'row' },
      h('div', { class: 'grow', style: 'min-width:200px;max-width:420px' }, select(opts, n.id, (id) => { n = notes.find((x) => x.id === id); save('meeting:current', id); draw() })),
      button('New meeting', { icon: 'plus', variant: 'secondary', onClick: () => { n = blank(); notes.unshift(n); touch(); draw() } }),
      button('Delete', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => {
        const yes = button('Delete meeting', { variant: 'danger', icon: 'trash-2' })
        const m = modal({ title: 'Delete these notes?', icon: 'triangle-alert', body: h('p', `"${n.title || 'Untitled meeting'}" will be removed from this device.`), actions: [button('Cancel', { onClick: () => m.close() }), yes] })
        yes.addEventListener('click', () => { m.close(); notes = notes.filter((x) => x.id !== n.id); n = notes[0] || blank(); if (!notes.length) notes = [n]; save(KEY, notes); save('meeting:current', n.id); draw(); toast('Deleted') })
      } })))
  }

  // ---------- list editors ----------
  function listEditor(key, { ph, makeItem, row }) {
    const list = h('div', { class: 'cr-list' })
    const wrap = h('div', { class: 'stack tight' }, list)
    const draw_ = () => {
      clear(list, n[key].map((it) => {
        const el = h('div', { class: 'cr-item', dataset: { id: it.id }, style: 'padding:6px 8px' }, h('div', { class: 'row', style: 'flex-wrap:nowrap;gap:6px' }, handle(), row(it, () => { n[key] = n[key].filter((x) => x.id !== it.id); touch(); draw_(); updateProgress() }), ))
        return el
      }))
      if (!n[key].length) list.append(h('div', { class: 'small muted', style: 'padding:4px 2px' }, 'Nothing yet.'))
    }
    sortable(list, { onSort: (ids) => { n[key] = ids.map((id) => n[key].find((x) => x.id === id)); touch() } })
    draw_()
    const add = button('Add', { icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => { n[key].push(makeItem()); touch(); draw_(); list.lastElementChild?.querySelector('input')?.focus() } })
    wrap.append(add)
    return wrap
  }
  const del = (onClick) => button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove', onClick })
  const bindIn = (obj, k, props = {}, after) => { const i = input({ ...props }); i.value = obj[k] ?? ''; i.addEventListener('input', () => { obj[k] = i.value; after?.(); touch() }); return i }
  const check = (obj, after) => h('input', { type: 'checkbox', checked: obj.done, 'aria-label': 'Done', onchange: (e) => { obj.done = e.target.checked; after?.(); touch() } })

  function updateProgress() {
    const total = n.actions.filter((a) => a.task.trim()).length
    const done = n.actions.filter((a) => a.task.trim() && a.done).length
    progressHost.textContent = total ? `${done} of ${total} done` : ''
  }

  // ---------- attendees ----------
  function attendeeEditor() {
    const chips = h('div', { class: 'cr-chips' })
    const inp = input({ placeholder: 'Type a name and press Enter', 'aria-label': 'Add attendee' })
    const drawC = () => clear(chips, n.attendees.map((a, i) => h('span', { class: ['cr-chip', a.absent ? 'warn' : 'ok'], style: { '--i': i } },
      h('button', { type: 'button', style: 'background:none;border:0;padding:0;font:inherit;cursor:pointer;color:inherit', title: a.absent ? 'Marked absent. Click to mark present' : 'Click to mark absent', onclick: () => { a.absent = !a.absent; touch(); drawC() } }, a.absent ? `${a.name} (absent)` : a.name),
      h('button', { type: 'button', 'aria-label': `Remove ${a.name}`, style: 'background:none;border:0;padding:0 0 0 4px;cursor:pointer;color:var(--muted);display:inline-flex', onclick: () => { n.attendees = n.attendees.filter((x) => x !== a); touch(); drawC() } }, icon('x')))))
    const addName = (v) => { for (const name of v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) if (!n.attendees.some((a) => a.name.toLowerCase() === name.toLowerCase())) n.attendees.push({ id: uid(), name, absent: false }) ; inp.value = ''; touch(); drawC(); dl() }
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (inp.value.trim()) addName(inp.value) } })
    inp.addEventListener('blur', () => { if (inp.value.trim()) addName(inp.value) })
    drawC()
    return h('div', { class: 'stack tight' }, inp, chips, h('div', { class: 'small muted' }, 'Click a name to mark them absent.'))
  }
  const dl = () => { const d = document.getElementById('mn-owners'); if (d) d.replaceChildren(...n.attendees.map((a) => h('option', { value: a.name }))) }

  // ---------- raw notes ----------
  function rawCard() {
    const raw = textarea({ rows: 8, placeholder: 'Paste rough notes or a transcript.\nTip: lines like "Action: Priya to send the deck by Friday" and "Decision: ship in November" are sorted automatically.' })
    const status = h('div')
    const merge = (r) => {
      if (r.title && !n.title) n.title = r.title
      for (const name of r.attendees || []) if (!n.attendees.some((a) => a.name.toLowerCase() === name.toLowerCase())) n.attendees.push({ id: uid(), name, absent: false })
      for (const t of r.agenda || []) n.agenda.push({ id: uid(), text: t, done: false })
      for (const t of r.decisions || []) n.decisions.push({ id: uid(), text: t })
      for (const a of r.actions || []) n.actions.push({ id: uid(), task: a.task, owner: a.owner || '', due: a.due || '', done: false })
      const notes_ = Array.isArray(r.notes) ? r.notes.join('\n').trim() : String(r.notes || '').trim()
      if (notes_) n.notes = [n.notes.trim(), notes_].filter(Boolean).join('\n\n')
      touch(); draw()
    }
    const quick = button('Sort into sections', { icon: 'list-filter', variant: 'secondary' })
    quick.addEventListener('click', () => { if (raw.value.trim().length < 10) return toast('Paste some notes first', 'error'); const r = sortRaw(raw.value); merge(r); toast(`Added ${r.actions.length} action${r.actions.length === 1 ? '' : 's'}, ${r.decisions.length} decision${r.decisions.length === 1 ? '' : 's'}`, 'success') })
    const aiBtn = button('Clean up with Claude', { icon: 'sparkles', variant: 'primary' })
    aiBtn.addEventListener('click', () => busy(aiBtn, async () => {
      if (raw.value.trim().length < 20) { toast('Paste some notes first', 'error'); return }
      if (!(await ai.ensureKey())) return
      const r = await ai.ask({
        system: 'You turn messy meeting notes or transcripts into structured minutes. Do not invent facts, owners or dates. Keep names as written. due must be an ISO date (YYYY-MM-DD) only when the date is clear from the text (today is ' + isoToday() + '), otherwise leave it as the words used or empty. notes is a concise summary of the discussion in short paragraphs. Do not use em dashes.',
        prompt: `Structure these notes:\n\n${raw.value.slice(0, 24000)}`,
        json: { type: 'object', properties: { title: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } }, agenda: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' }, decisions: { type: 'array', items: { type: 'string' } }, actions: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' } }, required: ['task', 'owner', 'due'], additionalProperties: false } } }, required: ['title', 'attendees', 'agenda', 'notes', 'decisions', 'actions'], additionalProperties: false },
        effort: 'low', maxTokens: 6000, signal,
      })
      merge(r)
      toast('Cleaned up by Claude. Review each section.', 'success')
    }, { label: 'Cleaning up', errorTo: status }))
    return card('Raw notes to structure', 'wand-sparkles', h('div', { class: 'stack tight' }, raw, h('div', { class: 'row' }, quick, aiBtn), ai.notice('Optional: uses Claude'), status))
  }

  // ---------- exports ----------
  const fileBase = () => `${safeName(n.title || 'meeting-notes').replace(/\s+/g, '-')}-${n.date || isoToday()}`
  const mk = (label, ic, variant, fn) => { const b = button(label, { icon: ic, variant, size: 'sm' }); b.addEventListener('click', () => busy(b, async () => { await fn(); burst(b) }, { label: 'Preparing' })); return b }
  const exportBar = h('div', { class: 'row' },
    mk('Copy Markdown', 'copy', 'secondary', async () => copyText(toMarkdown(n))),
    mk('Copy text', 'clipboard', 'ghost', async () => copyText(toText(n))),
    mk('Word', 'file-type', 'primary', async () => saveAs(await blocksToDocx(toBlocks(n), { title: n.title, font: 'Calibri' }), `${fileBase()}.docx`)),
    mk('PDF', 'file-down', 'secondary', async () => saveAs(await blocksToPdf(toBlocks(n), { title: n.title, size: 11 }), `${fileBase()}.pdf`)),
    mk('Markdown file', 'file-text', 'ghost', async () => saveAs(toMarkdown(n), `${fileBase()}.md`, 'text/markdown;charset=utf-8')))

  function draw() {
    drawPicker()
    clear(editor, h('div', { class: 'stack' },
      h('div', { class: 'cr-work' },
        h('div', { class: 'stack' },
          card('Details', 'calendar', h('div', { class: 'stack tight' },
            fi(n, 'title', 'Meeting title', { ph: 'Q4 roadmap sync' }, () => { touch() }),
            h('div', { class: 'grid-2' }, fi(n, 'date', 'Date', { type: 'date' }, touch), fi(n, 'time', 'Time', { ph: '15:00 to 15:45' }, touch)),
            h('div', { class: 'grid-2' }, fi(n, 'location', 'Location or link', { ph: 'Room 4B, or meet.google.com/...' }, touch), fi(n, 'facilitator', 'Facilitator or note taker', { ph: 'Priya' }, touch)))),
          card('Attendees', 'users', attendeeEditor()),
          card('Agenda', 'list-ordered', listEditor('agenda', { makeItem: () => ({ id: uid(), text: '', done: false }), row: (it, rm) => [check(it), h('div', { class: 'grow' }, bindIn(it, 'text', { placeholder: 'Agenda item' })), del(rm)] }))),
        h('div', { class: 'stack' },
          card('Notes', 'notebook-pen', field('What was discussed', textarea({ rows: 9, placeholder: 'Key points, context, questions raised...', value: n.notes, oninput: (e) => { n.notes = e.target.value; touch() } }))),
          card('Decisions', 'gavel', listEditor('decisions', { makeItem: () => ({ id: uid(), text: '' }), row: (it, rm) => [h('div', { class: 'grow' }, bindIn(it, 'text', { placeholder: 'We decided to...' })), del(rm)] })))),
      card('Action items', 'list-todo', h('div', { class: 'stack tight' }, h('div', { class: 'row small muted', style: 'justify-content:space-between' }, h('span', 'Who does what, by when.'), progressHost),
        h('datalist', { id: 'mn-owners' }, n.attendees.map((a) => h('option', { value: a.name }))),
        listEditor('actions', { makeItem: () => ({ id: uid(), task: '', owner: '', due: '', done: false }), row: (it, rm) => [check(it, updateProgress), h('div', { class: 'grow', style: 'min-width:140px;flex:2 1 160px' }, bindIn(it, 'task', { placeholder: 'Task' }, updateProgress)), h('div', { style: 'flex:1 1 120px;min-width:110px' }, bindIn(it, 'owner', { placeholder: 'Owner', list: 'mn-owners' })), h('div', { style: 'flex:0 1 150px;min-width:130px' }, bindIn(it, 'due', { type: 'date', 'aria-label': 'Due date' })), del(rm)] }))),
      h('div', { class: 'grid-2' }, card('Next meeting', 'calendar-plus', fi(n, 'next', 'When and what', { ph: 'Thursday 15:00, review the draft spec' }, touch)), rawCard()),
      h('div', { class: 'cr-card tint' }, h('div', { class: 'row between' }, h('b', 'Share these notes'), saved.el), h('div', { style: 'margin-top:10px' }, exportBar))))
    updateProgress()
  }

  root.append(shell(
    banner({ icon: 'notebook-pen', text: '<b>Minutes that people actually read.</b> Capture attendees, decisions and action items in one place, then send a clean summary. Everything autosaves on this device.', steps: ['Capture', 'Assign actions', 'Share'] }),
    picker, editor))
  draw()
}
