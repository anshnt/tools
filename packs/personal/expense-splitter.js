// Group expense splitter: members, expenses with a payer and an equal / shares / exact / percent split, running balances
// and a minimal settle-up plan (greedy minimum cash flow). Money is handled in minor units (paise) so nothing drifts.
import { h, icon, button, input, field, select, segmented, toggle, toast, clear } from '../../lib/ui.js'
import { app, css, makeStore, uid, today, fmtDate, money, CURRENCIES, stat, emptyState, ib, chip, docTabs, promptBox, confirmBox, dataBar, shareText, bar, plural, PALETTE, sum } from './_shared.js'

export const toMinor = (x) => Math.round(Number(x) * 100)
export const fromMinor = (m) => m / 100

/** Split `total` minor units by weights using the largest-remainder method, so the parts always add up exactly. */
export function splitMinor(total, weights) {
  const sw = sum(weights)
  if (!(sw > 0)) return weights.map(() => 0)
  const raw = weights.map((w) => (total * w) / sw)
  const out = raw.map(Math.floor)
  let left = total - sum(out)
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++
  return out
}

/** Minor-unit share of each member for an expense: {memberId: minor}. */
export function sharesOf(e) {
  const total = toMinor(e.amount)
  if (e.kind === 'payment') return { [e.to]: total }
  const ids = Object.keys(e.parts || {})
  if (!ids.length) return {}
  if (e.type === 'exact') return Object.fromEntries(ids.map((id) => [id, toMinor(e.parts[id])]))
  const w = ids.map((id) => (e.type === 'equal' ? 1 : Number(e.parts[id]) || 0))
  const s = splitMinor(total, w)
  return Object.fromEntries(ids.map((id, i) => [id, s[i]]))
}

/** Net balance per member in minor units: positive means the group owes them, negative means they owe. */
export function balances(group) {
  const net = Object.fromEntries(group.members.map((m) => [m.id, 0]))
  const paid = { ...net }, owed = { ...net }
  for (const e of group.expenses) {
    const total = toMinor(e.amount)
    if (e.payer in net) { net[e.payer] += total; if (e.kind !== 'payment') paid[e.payer] += total }
    for (const [id, v] of Object.entries(sharesOf(e))) if (id in net) { net[id] -= v; if (e.kind !== 'payment') owed[id] += v }
  }
  return { net, paid, owed }
}

/** Greedy minimum cash flow: repeatedly settle the biggest debtor against the biggest creditor. At most n-1 payments. */
export function settleUp(net) {
  const cr = [], db = []
  for (const [id, v] of Object.entries(net)) { if (v > 0) cr.push([id, v]); else if (v < 0) db.push([id, -v]) }
  const out = []
  while (cr.length && db.length) {
    cr.sort((a, b) => b[1] - a[1]); db.sort((a, b) => b[1] - a[1])
    const t = Math.min(cr[0][1], db[0][1])
    out.push({ from: db[0][0], to: cr[0][0], amount: t })
    cr[0][1] -= t; db[0][1] -= t
    if (cr[0][1] === 0) cr.shift()
    if (db[0][1] === 0) db.shift()
  }
  return out
}

const CSS = `
.t-split .mem{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.t-split .mchip{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 6px 0 4px;border-radius:999px;background:var(--surface-2);border:1px solid var(--border);font-size:13.5px;font-weight:550}
.t-split .mchip .av{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:12px;font-weight:700;background:var(--mc)}
.t-split .mchip button{width:22px;height:22px;border-radius:50%;border:0;background:none;color:var(--muted);cursor:pointer;display:grid;place-items:center;padding:0}
.t-split .mchip button:hover{background:var(--danger-soft);color:var(--danger)}
.t-split .mchip button .icon{width:13px;height:13px}
.t-split .form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.t-split .form .wide{grid-column:1/-1}
.t-split .prow{display:grid;grid-template-columns:auto minmax(0,1fr) 110px;gap:10px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--border)}
.t-split .prow:last-child{border-bottom:0}
.t-split .prow.off{opacity:.55}
.t-split .prow label{display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere;font-size:14px}
.t-split .prow .amt{font-variant-numeric:tabular-nums;font-size:12.5px;color:var(--muted);text-align:right}
.t-split .prow.noval{grid-template-columns:auto minmax(0,1fr) auto}
.t-split .exp{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px 10px;align-items:center;padding:10px 4px;border-bottom:1px solid var(--border)}
.t-split .exp:last-child{border-bottom:0}
.t-split .exp b{font-size:14.5px;overflow-wrap:anywhere}
.t-split .exp small{display:block;color:var(--muted);font-size:12.5px}
.t-split .exp .a{font-weight:650;font-variant-numeric:tabular-nums}
.t-split .bal{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:8px 0}
.t-split .bal .v{font-weight:650;font-variant-numeric:tabular-nums}
.t-split .bal .pos{color:var(--success)}.t-split .bal .neg{color:var(--danger)}
.t-split .bal .bars{grid-column:1/-1}
.t-split .pay{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:center;padding:12px;border-radius:16px;background:var(--surface-2);margin-bottom:8px}
.t-split .pay b{font-variant-numeric:tabular-nums}
.t-split .pay .arrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:14.5px}
.t-split .pay .arrow .icon{width:16px;height:16px;color:var(--muted)}
.t-split .err{color:var(--danger);font-size:12.5px}
`

const blankGroup = (name = 'Trip with friends') => ({ id: uid(), name, currency: 'INR', members: [], expenses: [] })
const fresh = () => { const g = blankGroup(); return { groups: [g], active: g.id } }

export function mount(root) {
  const el = app(root, 'split', '#14b8a6')
  css('t-split', CSS)
  const store = makeStore('splitter', fresh(), (d) => { if (!d.groups?.length) Object.assign(d, fresh()); if (!d.groups.some((g) => g.id === d.active)) d.active = d.groups[0].id })
  const D = () => store.get()
  const G = () => D().groups.find((g) => g.id === D().active)
  const $ = (minor) => money(fromMinor(minor), G().currency)
  const nameOf = (id) => G().members.find((m) => m.id === id)?.name || 'Someone'
  const colorOf = (id) => PALETTE[Math.max(0, G().members.findIndex((m) => m.id === id)) % PALETTE.length]
  let draft = null // expense being added or edited

  const tabsHost = h('div'), memHost = h('div'), formHost = h('div'), expHost = h('div'), balHost = h('div'), payHost = h('div'), dataHost = h('div')
  el.append(tabsHost, memHost, h('div', { class: 'pz-cols wide-l' }, h('div', { class: 'stack' }, formHost, expHost), h('div', { class: 'stack' }, balHost, payHost)), dataHost)
  const commit = () => { store.save(); renderAll() }

  function renderTabs() {
    clear(tabsHost, docTabs({
      docs: D().groups, activeId: D().active, noun: 'group',
      onSelect: (id) => { D().active = id; draft = null; store.save(); renderAll() },
      onAdd: async () => { const n = await promptBox({ title: 'New group', label: 'Group name', placeholder: 'Goa trip' }); if (!n) return; const g = blankGroup(n); D().groups.push(g); D().active = g.id; draft = null; commit() },
      onRename: async () => { const n = await promptBox({ title: 'Rename group', label: 'Group name', value: G().name }); if (n) { G().name = n; commit() } },
      onDelete: async () => { if (!(await confirmBox({ title: `Delete "${G().name}"?`, text: `This removes the group, its ${plural(G().members.length, 'member')} and ${plural(G().expenses.length, 'expense')}.` }))) return; D().groups = D().groups.filter((g) => g.id !== D().active); D().active = D().groups[0]?.id; draft = null; commit() },
    }))
  }

  // ---------- members
  function addMembers(text) {
    const names = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    let n = 0
    for (const nm of names) { if (G().members.some((m) => m.name.toLowerCase() === nm.toLowerCase())) { toast(`${nm} is already in the group`); continue } G().members.push({ id: uid(), name: nm }); n++ }
    if (n) commit()
  }
  function renderMembers() {
    const g = G()
    const inp = input({ placeholder: g.members.length ? 'Add another person' : 'Names, separated by commas: Asha, Ravi, Meera', 'aria-label': 'Add members', autocomplete: 'off', enterkeyhint: 'done' })
    const go = () => { if (inp.value.trim()) { addMembers(inp.value); inp.value = '' } }
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go() } })
    clear(memHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('users'), h('span', { class: 'grow' }, 'Who is in this group'), h('span', { class: 'pz-note' }, 'Currency'), select(CURRENCIES, g.currency, (v) => { g.currency = v; commit() })),
      h('div', { class: 'stack' }, g.members.length ? h('div', { class: 'mem' }, g.members.map((m) => h('span', { class: 'mchip', style: { '--mc': colorOf(m.id) } }, h('span', { class: 'av' }, m.name[0].toUpperCase()), m.name,
        h('button', { type: 'button', 'aria-label': `Remove ${m.name}`, title: `Remove ${m.name}`, onclick: async () => {
          if (g.expenses.some((e) => e.payer === m.id || e.to === m.id || m.id in (e.parts || {}))) { toast(`${m.name} is part of some expenses. Delete those first.`, 'error'); return }
          g.members = g.members.filter((x) => x.id !== m.id); commit() } }, icon('x'))))) : null,
        h('div', { class: 'pz-row nowrap' }, inp, button('Add', { icon: 'user-plus', variant: 'primary', onClick: go })))))
  }

  // ---------- expense form
  const newDraft = (e) => e ? { id: e.id, desc: e.desc, amount: String(e.amount), payer: e.payer, date: e.date, type: e.type || 'equal', parts: structuredClone(e.parts || {}), editing: true }
    : { id: uid(), desc: '', amount: '', payer: G().members[0]?.id, date: today(), type: 'equal', parts: Object.fromEntries(G().members.map((m) => [m.id, 1])), editing: false }
  function renderForm() {
    const g = G()
    if (g.members.length < 2) { clear(formHost, h('section', { class: 'pz-card' }, emptyState('Add at least two people', 'Then you can log who paid and how it is shared.', 'user-plus'))); return }
    if (!draft || !g.members.some((m) => m.id === draft.payer)) draft = newDraft()
    const d = draft
    const desc = input({ value: d.desc, placeholder: 'What was it for? e.g. Dinner', maxlength: 80, 'aria-label': 'Description', oninput: () => { d.desc = desc.value } })
    const amt = input({ type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: d.amount, placeholder: '0', 'aria-label': 'Amount', oninput: () => { d.amount = amt.value; refresh() } })
    const payer = select(g.members.map((m) => [m.id, m.name]), d.payer, (v) => { d.payer = v }); payer.setAttribute('aria-label', 'Paid by')
    const date = input({ type: 'date', value: d.date, 'aria-label': 'Date', onchange: () => { d.date = date.value } })
    const typeSeg = segmented([['equal', 'Equally'], ['shares', 'Shares'], ['exact', 'Exact'], ['percent', 'Percent']], d.type, (v) => {
      d.type = v
      for (const m of g.members) if (m.id in d.parts) d.parts[m.id] = v === 'equal' ? 1 : v === 'shares' ? 1 : v === 'percent' ? '' : ''
      if (v === 'percent') { const ids = Object.keys(d.parts); const sp = splitMinor(10000, ids.map(() => 1)); ids.forEach((id, i) => { d.parts[id] = sp[i] / 100 }) }
      buildRows(); refresh()
    }, 'How to split')
    const rows = h('div'), note = h('div', { class: 'err', 'aria-live': 'polite' })
    const addBtn = button(d.editing ? 'Save changes' : 'Add expense', { icon: d.editing ? 'check' : 'plus', variant: 'primary', onClick: save })
    const amts = new Map()
    function buildRows() {
      amts.clear()
      clear(rows, g.members.map((m) => {
        const on = m.id in d.parts
        const val = d.type === 'equal' ? null : input({ type: 'number', min: 0, step: 'any', inputmode: 'decimal', value: d.parts[m.id] ?? '', disabled: !on, placeholder: d.type === 'percent' ? '%' : d.type === 'exact' ? g.currency : 'shares', 'aria-label': `${m.name}: ${d.type}`, oninput: () => { d.parts[m.id] = val.value; refresh() } })
        const cb = h('input', { type: 'checkbox', checked: on, 'aria-label': `Include ${m.name}`, onchange: () => { if (cb.checked) d.parts[m.id] = d.type === 'equal' || d.type === 'shares' ? 1 : ''; else delete d.parts[m.id]; buildRows(); refresh() } })
        const a = h('span', { class: 'amt' }); amts.set(m.id, a)
        return h('div', { class: ['prow', !on && 'off', d.type === 'equal' && 'noval'] }, cb, h('label', { onclick: (e) => { if (e.target === e.currentTarget) cb.click() } }, h('span', { class: 'mchip', style: { '--mc': colorOf(m.id), height: '26px', padding: '0 8px 0 3px' } }, h('span', { class: 'av', style: 'width:20px;height:20px;font-size:11px' }, m.name[0].toUpperCase()), m.name)), val || a)
      }))
    }
    function refresh() {
      const total = toMinor(d.amount)
      const e = { ...d, amount: Number(d.amount) || 0, kind: 'expense' }
      let msg = ''
      const ids = Object.keys(d.parts)
      if (!ids.length) msg = 'Pick at least one person who shares this.'
      else if (d.type === 'exact') { const left = total - sum(ids.map((id) => toMinor(d.parts[id]))); if (left !== 0 && total > 0) msg = left > 0 ? `${$(left)} still to assign` : `${$(-left)} too much assigned` }
      else if (d.type === 'percent') { const p = sum(ids.map((id) => Number(d.parts[id]) || 0)); if (Math.abs(p - 100) > 0.001) msg = `Percentages add up to ${Math.round(p * 100) / 100}, they need to be 100` }
      else if (d.type === 'shares' && !(sum(ids.map((id) => Number(d.parts[id]) || 0)) > 0)) msg = 'Give at least one person a share above zero.'
      note.textContent = msg
      addBtn.disabled = !!msg || !(total > 0)
      const sh = sharesOf(e)
      for (const [id, a] of amts) a.textContent = id in sh && total > 0 && d.type !== 'exact' ? $(sh[id]) : ''
      if (d.type === 'equal') for (const [id, a] of amts) a.textContent = id in sh && total > 0 ? $(sh[id]) : ''
    }
    function save() {
      const total = Number(d.amount)
      if (!(total > 0)) { amt.focus(); return }
      const rec = { id: d.id, kind: 'expense', desc: d.desc.trim() || 'Expense', amount: Math.round(total * 100) / 100, payer: d.payer, date: d.date || today(), type: d.type, parts: Object.fromEntries(Object.entries(d.parts).map(([k, v]) => [k, d.type === 'equal' ? 1 : Number(v) || 0])) }
      const i = g.expenses.findIndex((x) => x.id === rec.id)
      if (i >= 0) g.expenses[i] = rec; else g.expenses.unshift(rec)
      toast(d.editing ? 'Expense updated' : 'Expense added', 'success')
      draft = null; commit()
    }
    for (const i of [desc, amt]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !addBtn.disabled) { e.preventDefault(); save() } })
    buildRows(); refresh()
    clear(formHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('receipt'), h('span', { class: 'grow' }, d.editing ? 'Edit expense' : 'Add an expense'), d.editing ? button('Cancel', { size: 'sm', onClick: () => { draft = null; renderForm() } }) : null),
      h('div', { class: 'form' }, h('div', { class: 'wide' }, field('Description', desc)), field(`Amount (${g.currency})`, amt), field('Paid by', payer), field('Date', date),
        h('div', { class: 'wide' }, field('Split', typeSeg)), h('div', { class: 'wide' }, rows, note), h('div', { class: 'wide pz-row' }, addBtn,
          g.members.length > 2 ? h('span', { class: 'pz-note' }, d.type === 'equal' ? 'Untick people who did not share it.' : '') : null))))
  }

  // ---------- list of expenses
  function renderExpenses() {
    const g = G()
    const list = [...g.expenses].sort((a, b) => b.date.localeCompare(a.date))
    const total = sum(g.expenses.filter((e) => e.kind !== 'payment'), (e) => toMinor(e.amount))
    clear(expHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('list'), h('span', { class: 'grow' }, `Expenses (${g.expenses.length})`), h('span', { class: 'pz-note' }, `Total ${$(total)}`)),
      list.length ? list.map((e) => {
        const isPay = e.kind === 'payment'
        const who = isPay ? `${nameOf(e.payer)} paid ${nameOf(e.to)}` : `${nameOf(e.payer)} paid, split ${e.type === 'equal' ? `equally among ${Object.keys(e.parts).length}` : e.type}`
        return h('div', { class: 'exp' }, h('div', h('b', isPay ? 'Payment' : e.desc), h('small', `${who} - ${fmtDate(e.date, { day: 'numeric', month: 'short' })}`)), h('span', { class: 'a' }, $(toMinor(e.amount))),
          h('span', { class: 'pz-row nowrap', style: 'gap:2px' }, !isPay ? ib('pencil', `Edit ${e.desc}`, () => { draft = newDraft(e); renderForm(); formHost.scrollIntoView({ behavior: 'smooth', block: 'center' }) }) : null, ib('trash-2', `Delete ${isPay ? 'payment' : e.desc}`, () => { g.expenses = g.expenses.filter((x) => x !== e); if (draft?.id === e.id) draft = null; commit() }, 'danger')))
      }) : h('p', { class: 'pz-note' }, 'No expenses yet.')))
  }

  // ---------- balances and settle up
  function summaryText() {
    const g = G(), { net } = balances(g), plan = settleUp(net)
    const total = sum(g.expenses.filter((e) => e.kind !== 'payment'), (e) => toMinor(e.amount))
    return [`${g.name} - total spent ${$(total)}`, '', 'Balances:', ...g.members.map((m) => `- ${m.name}: ${net[m.id] > 0 ? `gets back ${$(net[m.id])}` : net[m.id] < 0 ? `owes ${$(-net[m.id])}` : 'all settled'}`), '', plan.length ? 'To settle up:' : 'Everyone is settled up.', ...plan.map((p) => `- ${nameOf(p.from)} pays ${nameOf(p.to)} ${$(p.amount)}`)].join('\n')
  }
  function renderBalances() {
    const g = G()
    if (!g.members.length) { clear(balHost); clear(payHost); return }
    const { net, paid, owed } = balances(g)
    const peak = Math.max(1, ...Object.values(net).map(Math.abs))
    clear(balHost, h('section', { class: 'pz-card tint' }, h('h2', { class: 'pz-title' }, icon('scale'), 'Balances'),
      g.members.map((m) => {
        const v = net[m.id]
        return h('div', { class: 'bal' }, h('div', h('b', m.name), h('small', { class: 'pz-note', style: 'display:block' }, `paid ${$(paid[m.id])}, share ${$(owed[m.id])}`)),
          h('span', { class: ['v', v > 0 ? 'pos' : v < 0 ? 'neg' : ''] }, v > 0 ? `gets ${$(v)}` : v < 0 ? `owes ${$(-v)}` : 'settled'),
          h('div', { class: 'bars' }, bar(Math.abs(v) / peak, v >= 0 ? 'var(--success)' : 'var(--danger)')))
      })))
    const plan = settleUp(net)
    clear(payHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('handshake'), h('span', { class: 'grow' }, 'Settle up'), h('span', { class: 'pz-note' }, plan.length ? plural(plan.length, 'payment') : '')),
      plan.length ? plan.map((p) => h('div', { class: 'pay' }, h('div', { class: 'arrow' }, h('b', nameOf(p.from)), icon('arrow-right'), h('b', nameOf(p.to)), h('b', { style: 'color:var(--tc)' }, $(p.amount))),
        button('Mark paid', { size: 'sm', icon: 'check', title: 'Record this payment so the balances update', onClick: () => { g.expenses.unshift({ id: uid(), kind: 'payment', desc: 'Payment', amount: fromMinor(p.amount), payer: p.from, to: p.to, date: today(), type: 'exact', parts: {} }); commit(); toast('Payment recorded', 'success') } })))
        : h('p', { class: 'pz-note' }, g.expenses.length ? 'Everyone is settled up.' : 'Add expenses to see who pays whom.'),
      g.expenses.length ? h('div', { class: 'pz-row pz-noprint' }, button('Share summary', { icon: 'share-2', size: 'sm', onClick: () => shareText(`${g.name} expenses`, summaryText()).then((ok) => ok && toast('Summary copied or shared', 'success')) }), button('Copy', { icon: 'copy', size: 'sm', onClick: async () => { await navigator.clipboard?.writeText(summaryText()).catch(() => {}); toast('Summary copied', 'success') } })) : null))
  }

  function renderAll() { renderTabs(); renderMembers(); renderForm(); renderExpenses(); renderBalances() }
  clear(dataHost, dataBar({ kind: 'splitter', get: () => D(), set: (d) => { store.set(d.groups?.length ? d : fresh()); draft = null; renderAll() }, reset: () => { store.set(fresh()); draft = null; renderAll() } }))
  renderAll()
}
