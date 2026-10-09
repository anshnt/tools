// To-do, grocery and shopping lists (params.kind). Add with Enter, animated check-off, inline edit, drag to reorder,
// aisles (grocery) / priorities and due dates (to-do) / prices and totals (shopping), several lists, share as text.
import { h, icon, button, input, select, segmented, field, toast, clear, copyText } from '../../lib/ui.js'
import { app, css, makeStore, uid, today, addDays, parseYmd, fmtDate, daysBetween, money, CURRENCIES, docTabs, promptBox, confirmBox, dataBar, ib, chip, checkBtn, emptyState, sortable, grip, shareText, bar, ring, confetti, plural, num } from './_shared.js'
import { AISLES, aisleById, aisleOf, parseGrocery } from './_aisles.js'

export const KINDS = {
  todo: { tone: '#8b5cf6', list: 'My tasks', placeholder: 'Add a task and press Enter. Try "Call mom tomorrow !high"', noun: 'task', icon: 'list-todo' },
  grocery: { tone: '#10b981', list: 'Groceries', placeholder: 'Add an item and press Enter. Try "2 kg tomatoes" or "milk x2"', noun: 'item', icon: 'shopping-basket' },
  shopping: { tone: '#f97316', list: 'Shopping', placeholder: 'What do you want to buy? Press Enter to add', noun: 'item', icon: 'shopping-cart' },
}
export const PRI = [{ label: 'None', color: 'var(--muted)' }, { label: 'Low', color: '#3b82f6' }, { label: 'Medium', color: '#f59e0b' }, { label: 'High', color: '#ef4444' }]
const BUCKETS = [['overdue', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days'], ['later', 'Later'], ['none', 'No date']]
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** "Call mom tomorrow !high" -> {text: 'Call mom', due: 'YYYY-MM-DD', pri: 3}. */
export function parseTodo(raw, now = today()) {
  let text = raw.trim().replace(/\s+/g, ' ')
  let pri = 0, due = ''
  const pm = text.match(/(?:^|\s)!(high|h|med|medium|m|low|l)\b/i)
  if (pm) { const k = pm[1][0].toLowerCase(); pri = k === 'h' ? 3 : k === 'm' ? 2 : 1; text = text.replace(pm[0], ' ').trim() }
  const dm = text.match(/\s(?:(?:by|on|due|next)\s+)?(today|tonight|tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i)
  if (dm) {
    const w = dm[1].toLowerCase()
    if (w === 'today' || w === 'tonight') due = now
    else if (w === 'tomorrow' || w === 'tmrw') due = addDays(now, 1)
    else { const k = (WEEKDAYS.indexOf(w) - parseYmd(now).getDay() + 7) % 7; due = addDays(now, k || 7) }
    text = text.slice(0, dm.index).trim()
  }
  return { text, due, pri }
}

export function bucketOf(due, now = today()) {
  if (!due) return 'none'
  const d = daysBetween(now, due)
  return d < 0 ? 'overdue' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : d <= 7 ? 'week' : 'later'
}
export function dueLabel(due, now = today()) {
  const d = daysBetween(now, due)
  return d < 0 ? `Overdue ${-d}d` : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : fmtDate(due, { weekday: 'short', day: 'numeric', month: 'short' })
}
export const qtyOf = (it) => { const n = parseFloat(it.qty); return Number.isFinite(n) && n > 0 ? n : 1 }
export function totals(items) {
  const line = (i) => (Number(i.price) || 0) * qtyOf(i)
  const open = items.filter((i) => !i.done), done = items.filter((i) => i.done)
  return { all: items.reduce((s, i) => s + line(i), 0), cart: done.reduce((s, i) => s + line(i), 0), left: open.reduce((s, i) => s + line(i), 0), open: open.length, done: done.length }
}

/** Plain-text version of a list for sharing. */
export function listToText(list, kind, cur = 'INR') {
  const open = list.items.filter((i) => !i.done).length
  const out = [`${list.name} (${open} of ${list.items.length} left)`, '']
  const line = (i) => {
    const bits = []
    if (kind === 'grocery' && i.qty) bits.push(i.qty)
    let s = `- [${i.done ? 'x' : ' '}] ${i.text}`
    if (kind === 'shopping') { if (qtyOf(i) !== 1) s += ` x${i.qty}`; if (Number(i.price)) s += ` - ${money((Number(i.price) || 0) * qtyOf(i), cur)}` }
    if (bits.length) s += ` (${bits.join(', ')})`
    if (kind === 'todo') { const m = []; if (i.due) m.push(`due ${fmtDate(i.due, { day: 'numeric', month: 'short' })}`); if (i.pri) m.push(`${PRI[i.pri].label.toLowerCase()} priority`); if (m.length) s += ` (${m.join(', ')})` }
    if (i.note) s += ` - ${i.note}`
    return s
  }
  if (kind === 'grocery' && list.view !== 'flat') {
    for (const a of AISLES) {
      const its = list.items.filter((i) => (i.cat || 'other') === a.id)
      if (its.length) out.push(`${a.name}:`, ...its.map(line), '')
    }
  } else out.push(...list.items.map(line), '')
  if (kind === 'shopping') { const t = totals(list.items); out.push(`Total: ${money(t.all, cur)}`) }
  return out.join('\n').trim() + '\n'
}

const fresh = () => ({ v: 1, active: null, currency: 'INR', lists: [] })
function normalize(d, kind) {
  if (!d || !Array.isArray(d.lists)) d = fresh()
  d.currency ||= 'INR'
  d.lists = d.lists.filter((l) => l && Array.isArray(l.items)).map((l) => ({ id: l.id || uid(), name: l.name || KINDS[kind].list, sort: l.sort || (kind === 'grocery' ? 'aisle' : 'manual'), items: l.items.map((i) => ({ id: i.id || uid(), text: String(i.text || ''), done: !!i.done, qty: i.qty ?? '', cat: i.cat || 'other', pri: i.pri | 0, due: i.due || '', price: i.price ?? '', note: i.note || '' })) }))
  if (!d.lists.length) d.lists.push({ id: uid(), name: KINDS[kind].list, sort: kind === 'grocery' ? 'aisle' : 'manual', items: [] })
  if (!d.lists.some((l) => l.id === d.active)) d.active = d.lists[0].id
  return d
}

const CSS = `
.t-lists .li-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-height:8px}
.t-lists .li{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;gap:6px 8px;padding:9px 8px 9px 4px;border-radius:16px;background:var(--surface);border:1px solid var(--border);transition:background .2s,border-color .2s,box-shadow .2s}
.t-lists .li.nogrip{grid-template-columns:auto minmax(0,1fr) auto;padding-left:10px}
.t-lists .li:hover{border-color:color-mix(in srgb,var(--tc) 30%,var(--border));box-shadow:var(--shadow-sm)}
.t-lists .li.flash{animation:li-flash 1s var(--ease)}
@keyframes li-flash{0%,60%{background:color-mix(in srgb,var(--tc) 22%,var(--surface))}}
.t-lists .li.leaving{animation:li-out .36s var(--ease) forwards}
@keyframes li-out{to{opacity:0;transform:translateX(34px) scale(.95)}}
.t-lists .main{min-width:0;cursor:text}
.t-lists .tx{font-size:15px;line-height:1.35;overflow-wrap:anywhere}
.t-lists .tx span{background:linear-gradient(currentColor,currentColor) no-repeat 0 58%/0 2px;transition:background-size .35s var(--ease),color .3s}
.t-lists .li.done .tx{color:var(--muted)}
.t-lists .li.done .tx span{background-size:100% 2px}
.t-lists .meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;align-items:center}
.t-lists .meta:empty{display:none}
.t-lists .note{font-size:12.5px;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}
.t-lists .side{display:flex;align-items:center;gap:2px}
.t-lists .price{font-weight:620;font-variant-numeric:tabular-nums;font-size:14px;text-align:right;padding-right:4px;white-space:nowrap}
.t-lists .price small{display:block;font-weight:400;color:var(--muted);font-size:11px}
.t-lists .li.editing{grid-template-columns:minmax(0,1fr);padding:14px;border-color:var(--tc);box-shadow:0 0 0 4px color-mix(in srgb,var(--tc) 16%,transparent)}
.t-lists .eform{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px}
.t-lists .eform .wide{grid-column:1/-1}
.t-lists .grp{padding:14px;border-radius:22px}
.t-lists .grp-h{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:13px;font-weight:650;color:var(--text-2)}
.t-lists .grp-h .ico{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;color:var(--tc);background:color-mix(in srgb,var(--tc) 14%,transparent)}
.t-lists .grp-h .ico .icon{width:15px;height:15px}
.t-lists .grp-h .n{margin-left:auto;font-weight:500;color:var(--muted);font-size:12.5px}
.t-lists .lhero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;align-items:center}
.t-lists .lhero .big{font-size:32px;font-weight:700;letter-spacing:-.04em;line-height:1;margin-bottom:12px}
.t-lists .lhero .big small{font-size:15px;color:var(--muted);font-weight:500;letter-spacing:0}
.t-lists .lhero .mini{display:flex;gap:6px 18px;flex-wrap:wrap;margin-top:12px;font-size:13px;color:var(--muted)}
.t-lists .lhero .mini b{color:var(--text);font-variant-numeric:tabular-nums}
.t-lists .ringwrap{position:relative;width:88px;height:88px}
.t-lists .ringwrap .pct{position:absolute;inset:0;display:grid;place-items:center;font-weight:650;font-size:17px;font-variant-numeric:tabular-nums}
.t-lists .opts{display:flex;gap:8px 10px;flex-wrap:wrap;align-items:center}
.t-lists .opts .input,.t-lists .opts .select{height:36px;width:auto;border-radius:999px;font-size:13.5px}
.t-lists .opts input[type=number]{width:96px}
.t-lists .opts input[type=date]{width:150px}
.t-lists .preview-aisle{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.t-lists .toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.t-lists .done-h{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;padding:6px 2px;cursor:pointer;color:var(--text-2);font-weight:600;font-size:13.5px}
.t-lists .done-h .icon{transition:transform .25s var(--ease)}
.t-lists .done-h[aria-expanded="true"] .icon{transform:rotate(90deg)}
@media (max-width:560px){.t-lists .lhero{grid-template-columns:1fr;justify-items:start}.t-lists .li{gap:4px 6px}}
`

export function mount(root, { params }) {
  const kind = KINDS[params.kind] ? params.kind : 'todo'
  const K = KINDS[kind]
  const el = app(root, 'lists', K.tone)
  css('t-lists', CSS)
  const store = makeStore(`lists:${kind}`, fresh(), (d) => normalize(d, kind))
  store.set(normalize(store.get(), kind))
  const state = { editing: null, flash: null, fresh: null, showDone: false, add: { pri: 0, due: '', cat: 'auto', price: '', qty: '' } }
  const data = () => store.get()
  const cur = () => data().lists.find((l) => l.id === data().active)
  const find = (id) => cur().items.find((i) => i.id === id)
  const commit = () => { store.save(); render() }

  const tabsHost = h('div')
  const heroHost = h('div')
  const addHost = h('div')
  const barHost = h('div')
  const listHost = h('div', { class: 'stack' })
  const dataHost = h('div')
  el.append(tabsHost, heroHost, addHost, barHost, listHost, dataHost)

  // ---------- tabs (several lists)
  function renderTabs() {
    clear(tabsHost, docTabs({
      docs: data().lists, activeId: data().active, noun: 'list',
      onSelect: (id) => { data().active = id; state.editing = null; store.save(); renderTabs(); buildAdd(); render() },
      onAdd: async () => {
        const name = await promptBox({ title: 'New list', label: 'List name', placeholder: kind === 'grocery' ? 'Weekend party' : 'Work' })
        if (!name) return
        const l = { id: uid(), name, sort: kind === 'grocery' ? 'aisle' : 'manual', items: [] }
        data().lists.push(l); data().active = l.id; store.save(); renderTabs(); buildAdd(); render()
      },
      onRename: async () => { const n = await promptBox({ title: 'Rename list', label: 'List name', value: cur().name }); if (n) { cur().name = n; store.save(); renderTabs() } },
      onDelete: async () => {
        if (!(await confirmBox({ title: `Delete "${cur().name}"?`, text: `This removes the list and its ${plural(cur().items.length, 'item')}.` }))) return
        const d = data(); d.lists = d.lists.filter((l) => l.id !== d.active); d.active = d.lists[0].id
        store.save(); renderTabs(); buildAdd(); render()
      },
    }))
  }

  // ---------- add bar
  function buildAdd() {
    const a = state.add
    const text = input({ placeholder: K.placeholder, 'aria-label': `Add ${K.noun}`, autocomplete: 'off', enterkeyhint: 'done' })
    const addBtn = button('Add', { icon: 'plus', variant: 'primary', size: 'sm', onClick: submit })
    const bar1 = h('div', { class: 'pz-addbar' }, icon(K.icon), text, addBtn)
    const opts = h('div', { class: 'opts' })
    let aisleSel, dueIn, priSeg, priceIn, qtyIn, preview
    if (kind === 'todo') {
      priSeg = segmented([[0, 'No priority'], [1, 'Low'], [2, 'Medium'], [3, 'High']], a.pri, (v) => { a.pri = Number(v) }, 'Priority')
      dueIn = input({ type: 'date', 'aria-label': 'Due date', value: a.due, onchange: () => { a.due = dueIn.value } })
      opts.append(priSeg, dueIn, chip('Today', { onClick: () => { dueIn.value = a.due = today() } }), chip('Tomorrow', { onClick: () => { dueIn.value = a.due = addDays(today(), 1) } }))
    } else if (kind === 'grocery') {
      preview = h('span', { class: 'preview-aisle' })
      aisleSel = select([['auto', 'Aisle: auto'], ...AISLES.map((x) => [x.id, x.name])], a.cat, (v) => { a.cat = v; showPreview() })
      aisleSel.setAttribute('aria-label', 'Aisle')
      opts.append(preview, aisleSel)
    } else {
      priceIn = input({ type: 'number', inputmode: 'decimal', min: 0, step: 'any', placeholder: `Price (${money(0, data().currency).replace(/[\d.,\s]/g, '')})`, 'aria-label': 'Price each' })
      qtyIn = input({ type: 'number', inputmode: 'numeric', min: 1, step: 1, placeholder: 'Qty', 'aria-label': 'Quantity' })
      opts.append(priceIn, qtyIn)
    }
    function showPreview() {
      if (!preview) return
      const p = parseGrocery(text.value)
      const id = a.cat === 'auto' ? aisleOf(p.name) : a.cat
      const ai = aisleById(id)
      clear(preview, icon(ai.icon), text.value.trim() ? `${p.qty ? p.qty + ' of ' : ''}${p.name} goes to ${ai.name}` : 'Aisles are picked automatically')
    }
    function submit() {
      const raw = text.value.trim()
      if (!raw) { text.focus(); return }
      const item = { id: uid(), text: raw, done: false, qty: '', cat: 'other', pri: 0, due: '', price: '', note: '' }
      if (kind === 'todo') {
        const p = parseTodo(raw)
        item.text = p.text || raw
        item.pri = p.pri || a.pri
        item.due = p.due || a.due
      } else if (kind === 'grocery') {
        const p = parseGrocery(raw)
        item.text = p.name
        item.qty = p.qty
        item.cat = a.cat === 'auto' ? aisleOf(p.name) : a.cat
        const dup = cur().items.find((i) => !i.done && i.text.toLowerCase() === item.text.toLowerCase())
        if (dup) { state.flash = dup.id; toast(`"${dup.text}" is already on the list`); text.value = ''; showPreview(); render(); return }
      } else {
        item.price = priceIn.value ? Number(priceIn.value) : ''
        item.qty = qtyIn.value && Number(qtyIn.value) !== 1 ? String(Number(qtyIn.value)) : ''
        priceIn.value = ''; qtyIn.value = ''
      }
      cur().items.unshift(item)
      state.fresh = item.id
      text.value = ''
      if (kind === 'todo') { a.pri = 0; a.due = ''; priSeg.set(0); dueIn.value = '' }
      showPreview()
      commit()
      text.focus()
    }
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } })
    text.addEventListener('input', showPreview)
    showPreview()
    clear(addHost, h('div', { class: 'stack pz-noprint' }, bar1, opts))
  }

  // ---------- hero + toolbar
  function renderHero() {
    const l = cur()
    const t = totals(l.items)
    const n = l.items.length
    const frac = n ? t.done / n : 0
    const rg = ring({ size: 88, stroke: 9 })
    setTimeout(() => rg.set(frac), 30)
    const mini = []
    if (kind === 'todo') {
      const over = l.items.filter((i) => !i.done && i.due && bucketOf(i.due) === 'overdue').length
      const tod = l.items.filter((i) => !i.done && bucketOf(i.due) === 'today').length
      mini.push(h('span', 'Overdue ', h('b', { style: over ? 'color:var(--danger)' : '' }, over)), h('span', 'Due today ', h('b', tod)), h('span', 'Open ', h('b', t.open)))
    } else if (kind === 'grocery') {
      const aisles = new Set(l.items.filter((i) => !i.done).map((i) => i.cat)).size
      mini.push(h('span', 'To buy ', h('b', t.open)), h('span', 'In basket ', h('b', t.done)), h('span', 'Aisles ', h('b', aisles)))
    } else {
      const cur0 = data().currency
      mini.push(h('span', 'Total ', h('b', money(t.all, cur0))), h('span', 'In cart ', h('b', money(t.cart, cur0))), h('span', 'Still to buy ', h('b', money(t.left, cur0))))
    }
    const label = kind === 'todo' ? 'tasks done' : kind === 'grocery' ? 'items picked' : 'items bought'
    clear(heroHost, h('div', { class: 'pz-card tint lhero pz-noprint' },
      h('div', { class: 'ringwrap' }, rg, h('div', { class: 'pct' }, `${Math.round(frac * 100)}%`)),
      h('div',
        h('div', { class: 'big' }, `${t.done}`, h('small', ` / ${n} ${label}`)),
        bar(frac),
        h('div', { class: 'mini' }, mini))))
  }

  function renderBar() {
    const l = cur()
    const sorts = kind === 'todo' ? [['manual', 'My order'], ['due', 'Due date'], ['pri', 'Priority']]
      : kind === 'grocery' ? [['aisle', 'By aisle'], ['flat', 'My order']] : [['manual', 'My order'], ['price', 'Price'], ['az', 'A to Z']]
    const sort = segmented(sorts, l.sort, (v) => { l.sort = v; commit() }, 'Sort')
    const cs = select(CURRENCIES, data().currency, (v) => { data().currency = v; buildAdd(); commit() })
    cs.setAttribute('aria-label', 'Currency')
    cs.style.cssText = 'width:auto;height:36px'
    clear(barHost, h('div', { class: 'toolbar pz-noprint' },
      sort,
      h('div', { class: 'pz-row' },
        kind === 'shopping' && cs,
        button('Share', { icon: 'share-2', size: 'sm', onClick: () => shareText(l.name, listToText(l, kind, data().currency)) }),
        button('Copy', { icon: 'copy', size: 'sm', onClick: () => copyText(listToText(l, kind, data().currency)) }),
        button('Print', { icon: 'printer', size: 'sm', variant: 'ghost', onClick: () => window.print() }),
        button('Clear done', { icon: 'check-check', size: 'sm', variant: 'ghost', disabled: !l.items.some((i) => i.done), onClick: () => { l.items = l.items.filter((i) => !i.done); commit(); toast('Cleared completed items') } }))))
  }

  // ---------- rows
  function tagsFor(it) {
    const tags = []
    if (kind === 'grocery') {
      if (it.qty) tags.push(h('span', { class: 'pz-tag', style: { '--tg': 'var(--text-2)' } }, it.qty))
      if (cur().sort === 'flat') { const a = aisleById(it.cat); tags.push(h('span', { class: 'pz-tag', style: { '--tg': a.color } }, icon(a.icon), a.name)) }
    }
    if (kind === 'shopping' && qtyOf(it) !== 1) tags.push(h('span', { class: 'pz-tag' }, `x${it.qty}`))
    if (kind === 'todo') {
      if (it.due) { const b = bucketOf(it.due); tags.push(h('span', { class: 'pz-tag', style: { '--tg': it.done ? 'var(--muted)' : b === 'overdue' ? 'var(--danger)' : b === 'today' ? 'var(--warning)' : 'var(--text-2)' } }, icon('calendar'), dueLabel(it.due))) }
      if (it.pri) tags.push(h('span', { class: 'pz-tag', style: { '--tg': PRI[it.pri].color } }, icon('flag'), PRI[it.pri].label))
    }
    return tags
  }

  function toggle(it, li, v) {
    it.done = v
    store.save()
    li.classList.toggle('done', v)
    setTimeout(() => {
      li.classList.add('leaving')
      setTimeout(() => {
        const l = cur()
        const allDone = l.items.length >= 2 && l.items.every((i) => i.done)
        render()
        if (v && allDone) { confetti({ y: innerHeight * 0.35 }); toast(kind === 'todo' ? 'All done. Nice work!' : 'Everything is ticked off', 'success') }
      }, 330)
    }, 420)
  }

  function editForm(it) {
    const f = {
      text: input({ value: it.text, 'aria-label': 'Name' }),
      qty: input({ value: it.qty, 'aria-label': 'Quantity', placeholder: kind === 'grocery' ? 'e.g. 2 kg' : '1', type: kind === 'shopping' ? 'number' : 'text', min: 1 }),
      price: input({ value: it.price, type: 'number', min: 0, step: 'any', 'aria-label': 'Price each' }),
      cat: select(AISLES.map((a) => [a.id, a.name]), it.cat),
      due: input({ value: it.due, type: 'date', 'aria-label': 'Due date' }),
      pri: select([[0, 'None'], [1, 'Low'], [2, 'Medium'], [3, 'High']], it.pri),
      note: input({ value: it.note, placeholder: 'Optional note', 'aria-label': 'Note' }),
    }
    const save = () => {
      const t = f.text.value.trim()
      if (!t) { f.text.focus(); return }
      it.text = t
      if (kind === 'grocery') { it.qty = f.qty.value.trim(); it.cat = f.cat.value }
      if (kind === 'shopping') { it.qty = f.qty.value && Number(f.qty.value) !== 1 ? String(Number(f.qty.value)) : ''; it.price = f.price.value === '' ? '' : Number(f.price.value) }
      if (kind === 'todo') { it.due = f.due.value; it.pri = Number(f.pri.value) }
      it.note = f.note.value.trim()
      state.editing = null
      commit()
    }
    const cancel = () => { state.editing = null; render() }
    const form = h('div', { class: 'stack tight' },
      h('div', { class: 'eform' },
        h('div', { class: 'wide' }, field('Name', f.text)),
        kind === 'grocery' && field('Quantity', f.qty),
        kind === 'grocery' && field('Aisle', f.cat),
        kind === 'shopping' && field('Quantity', f.qty),
        kind === 'shopping' && field('Price each', f.price),
        kind === 'todo' && field('Due date', f.due),
        kind === 'todo' && field('Priority', f.pri),
        h('div', { class: 'wide' }, field('Note', f.note))),
      h('div', { class: 'pz-row' }, button('Save', { variant: 'primary', size: 'sm', icon: 'check', onClick: save }), button('Cancel', { size: 'sm', onClick: cancel }),
        h('span', { class: 'pz-note' }, 'Enter saves, Esc cancels')))
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save() } if (e.key === 'Escape') cancel() })
    setTimeout(() => { f.text.focus(); f.text.select() }, 30)
    return form
  }

  function row(it, { drag, i = 0 }) {
    const editing = state.editing === it.id
    const li = h('li', { class: ['li', it.done && 'done', !drag && 'nogrip', editing && 'editing', state.fresh === it.id && 'pz-rise', state.flash === it.id && 'flash'], 'data-id': it.id, style: { '--i': Math.min(i, 8) } })
    if (editing) { li.append(editForm(it)); return li }
    const line = (Number(it.price) || 0) * qtyOf(it)
    li.append(...[
      drag ? grip() : null,
      checkBtn(it.done, (v) => toggle(it, li, v), `${it.done ? 'Uncheck' : 'Check off'} ${it.text}`, 'var(--tc)'),
      h('div', { class: 'main', ondblclick: () => { state.editing = it.id; render() } },
        h('div', { class: 'tx' }, h('span', it.text)),
        h('div', { class: 'meta' }, tagsFor(it)),
        it.note && h('div', { class: 'note' }, it.note)),
      h('div', { class: 'side' },
        kind === 'shopping' && h('div', { class: 'price' }, Number(it.price) ? [money(line, data().currency), qtyOf(it) !== 1 ? h('small', `${money(Number(it.price), data().currency)} each`) : null] : h('span', { class: 'pz-note' }, 'no price')),
        ib('pencil', `Edit ${it.text}`, () => { state.editing = it.id; render() }),
        ib('x', `Delete ${it.text}`, () => { cur().items = cur().items.filter((x) => x.id !== it.id); commit() }, 'danger'))].filter(Boolean))
    return li
  }

  const ul = (items, extra = {}, drag = false, startI = 0) => h('ul', { class: 'li-list', ...(drag ? { 'data-drop': '1' } : {}), ...extra }, items.map((it, i) => row(it, { drag, i: startI + i })))

  function render() {
    const l = cur()
    renderHero()
    renderBar()
    const open = l.items.filter((i) => !i.done)
    const done = l.items.filter((i) => i.done)
    const out = []
    const canDrag = (kind === 'todo' && l.sort === 'manual') || (kind === 'grocery') || (kind === 'shopping' && l.sort === 'manual')
    if (!l.items.length) {
      out.push(h('div', { class: 'pz-card' }, emptyState(kind === 'todo' ? 'Nothing to do yet' : kind === 'grocery' ? 'Your list is empty' : 'Nothing on the list yet',
        kind === 'todo' ? 'Type a task above. "Pay rent friday !high" sets the date and priority for you.' : kind === 'grocery' ? 'Type "2 kg tomatoes" or "milk x2". Items drop into the right aisle on their own.' : 'Add items with a price to see a running total.', K.icon)))
    } else {
      if (kind === 'grocery' && l.sort === 'aisle') {
        for (const a of AISLES) {
          const its = open.filter((i) => (i.cat || 'other') === a.id)
          if (!its.length) continue
          out.push(h('section', { class: 'pz-card tint grp pz-rise', style: { '--tc': a.color } }, h('div', { class: 'grp-h' }, h('span', { class: 'ico' }, icon(a.icon)), a.name, h('span', { class: 'n' }, plural(its.length, 'item'))), ul(its, { 'data-cat': a.id }, true)))
        }
      } else if (kind === 'todo' && l.sort !== 'manual') {
        const groups = l.sort === 'due' ? BUCKETS.map(([id, label]) => [label, open.filter((i) => bucketOf(i.due) === id)]) : [3, 2, 1, 0].map((p) => [p ? `${PRI[p].label} priority` : 'No priority', open.filter((i) => i.pri === p)])
        for (const [label, its] of groups) if (its.length) out.push(h('section', { class: 'stack tight pz-rise' }, h('div', { class: 'grp-h', style: 'margin:6px 2px 0' }, label, h('span', { class: 'n' }, its.length)), ul(its)))
      } else {
        let items = open
        if (kind === 'shopping' && l.sort === 'price') items = [...open].sort((a, b) => (Number(b.price) || 0) * qtyOf(b) - (Number(a.price) || 0) * qtyOf(a))
        if (kind === 'shopping' && l.sort === 'az') items = [...open].sort((a, b) => a.text.localeCompare(b.text))
        if (items.length) out.push(ul(items, {}, canDrag && items === open))
      }
      if (!open.length) out.push(h('div', { class: 'pz-card' }, emptyState('All done', 'Everything is ticked off. Add more above or clear the completed items.', 'party-popper')))
      if (done.length) {
        const exp = state.showDone
        out.push(h('div', { class: 'stack tight' },
          h('button', { type: 'button', class: 'done-h', 'aria-expanded': String(exp), onclick: () => { state.showDone = !state.showDone; render() } }, icon('chevron-right'), `Completed (${done.length})`),
          exp && ul(done)))
      }
    }
    if (kind === 'shopping' && l.items.length) {
      const t = totals(l.items), c = data().currency
      out.push(h('div', { class: 'pz-card tint pz-row between', style: 'justify-content:space-between' }, h('div', h('div', { class: 'pz-note' }, 'Running total'), h('div', { class: 'result-big' }, money(t.all, c))), h('div', { class: 'pz-note', style: 'text-align:right' }, `In cart ${money(t.cart, c)}`, h('br'), `Still to buy ${money(t.left, c)}`)))
    }
    clear(listHost, h('h2', { class: 'pz-printonly' }, l.name), out)
    state.fresh = null
    if (state.flash) { const f = state.flash; state.flash = null; setTimeout(() => listHost.querySelector(`[data-id="${f}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50) }
  }

  sortable({
    root: listHost, containers: () => [...listHost.querySelectorAll('ul[data-drop]')], item: '.li', handle: '.pz-grip',
    onDrop() {
      const l = cur()
      const conts = [...listHost.querySelectorAll('ul[data-drop]')]
      const byId = new Map(l.items.map((i) => [i.id, i]))
      const order = []
      for (const c of conts) for (const li of c.children) { const it = byId.get(li.dataset.id); if (!it) continue; if (c.dataset.cat) it.cat = c.dataset.cat; order.push(it) }
      const seen = new Set(order)
      l.items = [...order, ...l.items.filter((i) => !seen.has(i))]
      commit()
    },
  })

  const replaceAll = (d) => { store.set(normalize(d, kind)); state.editing = null; renderTabs(); buildAdd(); render() }
  clear(dataHost, dataBar({ kind: `lists-${kind}`, get: () => data(), set: replaceAll, reset: () => replaceAll(fresh()) }))
  renderTabs()
  buildAdd()
  render()
}
