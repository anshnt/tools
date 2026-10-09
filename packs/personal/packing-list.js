// Packing list generator: a checklist built from trip length, climate, trip type, activities and who is travelling.
// Quantities scale with the number of days (and laundry). Check items off, add your own, keep several lists, share or print.
import { h, icon, button, input, field, toggle, segmented, toast, clear } from '../../lib/ui.js'
import { app, css, makeStore, uid, chip, ib, checkBtn, ring, bar, emptyState, docTabs, promptBox, confirmBox, dataBar, shareText, plural, clamp } from './_shared.js'

export const CLIMATES = [['hot', 'Hot', 'sun'], ['warm', 'Warm', 'cloud-sun'], ['mild', 'Mild', 'cloud'], ['cold', 'Cold', 'snowflake']]
export const TYPES = [['leisure', 'Holiday', 'tree-palm'], ['city', 'City break', 'building-2'], ['beach', 'Beach', 'waves'], ['trek', 'Trek or hike', 'mountain'], ['business', 'Business', 'briefcase'], ['wedding', 'Wedding or event', 'party-popper'], ['roadtrip', 'Road trip', 'car'], ['camping', 'Camping', 'tent']]
export const ACTS = [['swim', 'Swimming'], ['gym', 'Gym or running'], ['hike', 'Day hikes'], ['photo', 'Photography'], ['remote', 'Working remotely'], ['dine', 'Fine dining'], ['night', 'Nightlife'], ['snow', 'Snow sports'], ['yoga', 'Yoga'], ['temple', 'Temples or religious sites'], ['cycle', 'Cycling']]
export const CATS = { docs: ['Documents and money', 'file-text'], clothes: ['Clothing', 'shirt'], toilet: ['Toiletries', 'bath'], tech: ['Electronics', 'smartphone'], health: ['Health and safety', 'heart-pulse'], kids: ['Kids and baby', 'baby'], gear: ['Gear and extras', 'backpack'], food: ['Food and drink', 'utensils'], home: ['Before you leave', 'house'] }

/** Context for the rules: n is the number of outfits to pack (capped at a week when laundry is available). */
export function context(o) {
  const days = clamp(Math.round(o.days) || 1, 1, 90)
  return { days, n: o.laundry ? Math.min(days, 6) : days, climate: o.climate, type: o.type, acts: new Set(o.acts || []), adults: Math.max(0, o.adults ?? 1), kids: Math.max(0, o.kids || 0), infants: Math.max(0, o.infants || 0), intl: !!o.intl, flying: !!o.flying, laundry: !!o.laundry, rain: !!o.rain }
}
const RULES = []
const rule = (cat, text, when, qty) => RULES.push({ cat, text, when: when || (() => true), qty })
const cold = (c) => c.climate === 'cold', hot = (c) => c.climate === 'hot', warmish = (c) => c.climate === 'hot' || c.climate === 'warm'
const is = (t) => (c) => c.type === t
const act = (a) => (c) => c.acts.has(a)

// documents and money
rule('docs', 'Government photo ID (Aadhaar, driving licence)')
rule('docs', 'Passport (valid for 6+ months)', (c) => c.intl)
rule('docs', 'Visa or e-visa printout', (c) => c.intl)
rule('docs', 'Travel insurance papers', (c) => c.intl)
rule('docs', 'Forex card and some local currency', (c) => c.intl)
rule('docs', 'Tickets and boarding passes', (c) => c.flying)
rule('docs', 'Hotel or stay confirmations')
rule('docs', 'Driving licence and vehicle papers (RC, insurance, PUC)', is('roadtrip'))
rule('docs', 'FASTag with balance', is('roadtrip'))
rule('docs', 'Debit and credit cards')
rule('docs', 'Cash in small notes')
rule('docs', 'Printed itinerary and emergency contacts')
rule('docs', 'Wedding invitation and venue address', is('wedding'))
rule('docs', 'Gift or shagun envelope', is('wedding'))
rule('docs', 'Business cards and meeting documents', is('business'))
rule('docs', 'Trek permits and ID photocopies', is('trek'))

// clothing
rule('clothes', 'Underwear', null, (c) => c.n + 1)
rule('clothes', 'Socks', (c) => !(c.type === 'beach' && hot(c)), (c) => c.n + 1)
rule('clothes', 'T-shirts or tops', (c) => c.type !== 'business' && c.type !== 'wedding', (c) => Math.max(2, Math.ceil(c.n * (hot(c) ? 1.1 : 0.8))))
rule('clothes', 'Trousers, jeans or leggings', (c) => c.type !== 'beach' || !hot(c), (c) => Math.max(2, Math.ceil(c.n / 2)))
rule('clothes', 'Shorts or light skirts', warmish, (c) => Math.max(2, Math.ceil(c.n / 2)))
rule('clothes', 'Night clothes', null, (c) => (c.days > 6 ? 2 : 1))
rule('clothes', 'Comfortable walking shoes', (c) => c.type !== 'trek')
rule('clothes', 'Sandals or flip-flops', (c) => warmish(c) || c.type === 'beach')
rule('clothes', 'Light jacket or hoodie', (c) => c.climate === 'mild' || c.climate === 'warm')
rule('clothes', 'Warm jacket', cold)
rule('clothes', 'Thermal innerwear', cold, (c) => Math.min(3, Math.ceil(c.n / 2)))
rule('clothes', 'Sweaters or fleece', cold, (c) => Math.max(2, Math.ceil(c.n / 3)))
rule('clothes', 'Gloves, beanie and scarf', cold)
rule('clothes', 'Warm socks', cold, (c) => Math.min(c.n + 1, 6))
rule('clothes', 'Raincoat or poncho and umbrella', (c) => c.rain)
rule('clothes', 'Quick-dry clothes', (c) => c.rain && c.type === 'trek')
rule('clothes', 'Sun hat or cap', warmish)
rule('clothes', 'Sunglasses', (c) => warmish(c) || c.acts.has('snow'))
rule('clothes', 'Swimwear', (c) => c.type === 'beach' || c.acts.has('swim'), (c) => (c.days > 4 ? 2 : 1))
rule('clothes', 'Cover-up and beach towel', is('beach'))
rule('clothes', 'Formal shirts or blouses', is('business'), (c) => c.n)
rule('clothes', 'Formal trousers or skirts', is('business'), (c) => Math.max(2, Math.ceil(c.n / 2)))
rule('clothes', 'Blazer', is('business'))
rule('clothes', 'Formal shoes and belt', is('business'))
rule('clothes', 'Event outfits and matching footwear', is('wedding'), (c) => Math.max(2, Math.ceil(c.days * 0.8)))
rule('clothes', 'Jewellery and accessories', is('wedding'))
rule('clothes', 'Trekking shoes (broken in)', is('trek'))
rule('clothes', 'Trek pants and quick-dry tees', is('trek'), (c) => Math.min(c.n, 4))
rule('clothes', 'Moisture-wicking hiking socks', (c) => c.type === 'trek' || c.acts.has('hike'), (c) => Math.min(c.n + 1, 5))
rule('clothes', 'Gym clothes and sports shoes', act('gym'), (c) => Math.max(2, Math.ceil(c.n / 2)))
rule('clothes', 'Dressy outfit and shoes', (c) => c.acts.has('dine') && c.type !== 'business' && c.type !== 'wedding')
rule('clothes', 'Party outfit', act('night'))
rule('clothes', 'Ski jacket, snow pants and waterproof gloves', act('snow'))
rule('clothes', 'Modest clothes that cover shoulders and knees, and a scarf', act('temple'))
rule('clothes', 'Cycling shorts and gloves', act('cycle'))
rule('clothes', 'Yoga clothes', act('yoga'))

// toiletries
rule('toilet', 'Toothbrush and toothpaste')
rule('toilet', 'Shampoo and soap or body wash')
rule('toilet', 'Deodorant')
rule('toilet', 'Comb or hairbrush')
rule('toilet', 'Razor and shaving kit')
rule('toilet', 'Moisturiser and lip balm', (c) => cold(c) || c.days > 3)
rule('toilet', 'Sunscreen (SPF 30+)', (c) => warmish(c) || c.type === 'beach' || c.type === 'trek' || c.acts.has('snow'))
rule('toilet', 'Hand sanitiser and wet wipes')
rule('toilet', 'Glasses, contact lenses and solution')
rule('toilet', 'Quick-dry towel', (c) => ['trek', 'camping', 'beach'].includes(c.type))
rule('toilet', 'Menstrual products (if needed)')

// electronics
rule('tech', 'Phone and charger')
rule('tech', 'Power bank', (c) => c.days > 1)
rule('tech', 'Earphones or headphones')
rule('tech', 'Travel adapter', (c) => c.intl)
rule('tech', 'Laptop, charger and mouse', (c) => c.type === 'business' || c.acts.has('remote'))
rule('tech', 'Mobile hotspot or local SIM', (c) => c.acts.has('remote') || c.intl)
rule('tech', 'Camera, spare battery and memory cards', act('photo'))
rule('tech', 'Tripod and lens cleaner', act('photo'))
rule('tech', 'Extension cord or multi-plug', (c) => c.adults + c.kids > 2)
rule('tech', 'Phone mount and car charger', is('roadtrip'))
rule('tech', 'Headlamp or torch with spare batteries', (c) => c.type === 'trek' || c.type === 'camping')
rule('tech', 'Offline maps downloaded', (c) => c.type === 'trek' || c.type === 'roadtrip' || c.intl)

// health
rule('health', 'Prescription medicines (with a little extra)')
rule('health', 'Basic first-aid kit (plasters, antiseptic, pain relief)')
rule('health', 'Stomach and motion-sickness tablets, ORS')
rule('health', 'Insect repellent', (c) => c.rain || warmish(c) || ['trek', 'camping'].includes(c.type))
rule('health', 'Water purification tablets or filter', (c) => c.type === 'trek' || c.type === 'camping')
rule('health', 'Blister plasters and knee support', is('trek'))
rule('health', 'Face masks', (c) => c.flying)
rule('health', 'Thermometer', (c) => c.kids + c.infants > 0)

// kids and baby
rule('kids', 'Kids clothes (sets)', (c) => c.kids > 0, (c) => c.days + 2)
rule('kids', 'Diapers', (c) => c.infants > 0, (c) => c.days * 7)
rule('kids', 'Baby wipes and rash cream', (c) => c.infants > 0)
rule('kids', 'Bottles, formula or baby food', (c) => c.infants > 0)
rule('kids', 'Stroller or baby carrier', (c) => c.infants > 0)
rule('kids', 'Swim diapers or kids swimwear', (c) => c.kids + c.infants > 0 && (c.type === 'beach' || c.acts.has('swim')))
rule('kids', 'Favourite toy or comfort blanket', (c) => c.kids + c.infants > 0)
rule('kids', 'Books, colouring or tablet with downloads', (c) => c.kids > 0 && (c.flying || c.type === 'roadtrip'))
rule('kids', "Children's medicines and hat", (c) => c.kids + c.infants > 0)
rule('kids', 'Snacks for kids', (c) => c.kids + c.infants > 0)

// gear
rule('gear', 'Daypack or small bag')
rule('gear', 'Reusable water bottle')
rule('gear', 'Travel pillow and eye mask', (c) => c.flying && c.days > 2)
rule('gear', 'Packing cubes or laundry bag', (c) => c.days > 3)
rule('gear', 'Padlock for bags', (c) => c.flying || c.intl)
rule('gear', 'Small umbrella', (c) => c.rain && c.type !== 'trek')
rule('gear', 'Trekking poles and backpack rain cover', is('trek'))
rule('gear', 'Tent, sleeping bag and mat', is('camping'))
rule('gear', 'Stove, lighter and cooking utensils', is('camping'))
rule('gear', 'Camp lantern and folding chairs', is('camping'))
rule('gear', 'Garbage bags', (c) => c.type === 'camping' || c.type === 'roadtrip')
rule('gear', 'Spare tyre, jack and jumper cables checked', is('roadtrip'))
rule('gear', 'Goggles, swim cap and waterproof pouch', act('swim'))
rule('gear', 'Yoga mat', act('yoga'))
rule('gear', 'Bike helmet, lock and puncture kit', act('cycle'))
rule('gear', 'Goggles, helmet and ski pass', act('snow'))
rule('gear', 'Pen and notebook', (c) => c.type === 'business')

// food
rule('food', 'Snacks for the journey', (c) => c.flying || c.type === 'roadtrip' || c.type === 'trek')
rule('food', 'Energy bars, nuts and electrolytes', (c) => c.type === 'trek' || c.acts.has('hike'), (c) => Math.max(4, c.days * 2))
rule('food', 'Food supplies and a cooler', (c) => c.type === 'camping' || c.type === 'roadtrip')

// before you leave
rule('home', 'Check in online and note the baggage limit', (c) => c.flying)
rule('home', 'Charge phone, power bank and camera')
rule('home', 'Switch off geyser, AC, gas and main switch')
rule('home', 'Lock doors and windows, ask someone to check on the home')
rule('home', 'Take out the garbage and empty the fridge', (c) => c.days > 3)
rule('home', 'Tell your bank about the trip', (c) => c.intl)
rule('home', 'Share your itinerary with family')

/** Packing items for the options, grouped by category: {cat: [{key, text, qty}]} in display order. */
export function generate(o) {
  const c = context(o)
  const out = {}
  for (const r of RULES) {
    if (!r.when(c)) continue
    const q = r.qty ? r.qty(c) : ''
    ;(out[r.cat] ||= []).push({ key: `${r.cat}|${r.text}`, text: r.text, qty: q === '' ? '' : String(q) })
  }
  return out
}

/** Rebuild a list for new options while keeping what the user did: packed state, edited quantities, custom items and categories. */
export function refresh(list) {
  const gen = generate(list.opts)
  const old = new Map(list.cats.flatMap((c) => c.items.map((i) => [i.key, i])))
  const gone = new Set(list.removed || [])
  const cats = []
  for (const id of Object.keys(CATS)) {
    const prev = list.cats.find((c) => c.id === id)
    const items = (gen[id] || []).filter((g) => !gone.has(g.key)).map((g) => { const o = old.get(g.key); return { id: o?.id || uid(), key: g.key, text: g.text, qty: o?.qtyEdited ? o.qty : g.qty, qtyEdited: !!o?.qtyEdited, done: !!o?.done, custom: false } })
    const keep = (prev?.items || []).filter((i) => i.custom || (i.done && !items.some((x) => x.key === i.key)))
    if (items.length || keep.length) cats.push({ id, name: CATS[id][0], icon: CATS[id][1], collapsed: !!prev?.collapsed, items: [...items, ...keep] })
  }
  for (const c of list.cats) if (!CATS[c.id]) cats.push(c)
  list.cats = cats
  return list
}
export function listToText(list) {
  const total = list.cats.reduce((s, c) => s + c.items.length, 0), done = list.cats.reduce((s, c) => s + c.items.filter((i) => i.done).length, 0)
  return [`${list.name} - packing list (${done} of ${total} packed)`, '', ...list.cats.flatMap((c) => [c.name.toUpperCase(), ...c.items.map((i) => `[${i.done ? 'x' : ' '}] ${i.text}${i.qty ? ` x${i.qty}` : ''}`), ''])].join('\n').trim()
}

const CSS = `
.t-pack .opts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
@media (max-width:760px){.t-pack .opts{grid-template-columns:minmax(0,1fr)}}
.t-pack .step{display:flex;align-items:center;gap:6px}
.t-pack .step .input{width:76px;text-align:center;font-weight:650}
.t-pack .step button{width:36px;height:36px;border-radius:11px;border:1px solid var(--border);background:var(--surface);font-size:18px;cursor:pointer;color:var(--text);padding:0}
.t-pack .step button:hover{border-color:var(--tc)}
.t-pack .trio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.t-pack .phero{display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;align-items:center}
.t-pack .phero .rw{position:relative;width:96px;height:96px}
.t-pack .phero .rw .pct{position:absolute;inset:0;display:grid;place-items:center;font-weight:700;font-size:20px}
.t-pack .phero .big{font-size:26px;font-weight:700;letter-spacing:-.03em}
.t-pack .phero .big small{font-size:14px;color:var(--muted);font-weight:500}
.t-pack .cats{columns:2 380px;column-gap:16px}
.t-pack .cat{break-inside:avoid;margin-bottom:16px;display:block}
.t-pack .cat>header{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.t-pack .cat>header .ic{width:32px;height:32px;border-radius:11px;display:grid;place-items:center;background:color-mix(in srgb,var(--tc) 14%,var(--surface));color:var(--tc)}
.t-pack .cat>header .ic .icon{width:17px;height:17px}
.t-pack .cat>header b{flex:1;min-width:0;font-size:15px}
.t-pack .cat>header small{color:var(--muted);font-variant-numeric:tabular-nums}
.t-pack .pi{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;gap:8px;align-items:center;padding:7px 2px;border-bottom:1px solid var(--border)}
.t-pack .pi:last-of-type{border-bottom:0}
.t-pack .pi .tx{overflow-wrap:anywhere;font-size:14.5px}
.t-pack .pi.done .tx{text-decoration:line-through;color:var(--muted)}
.t-pack .pi .qty{width:56px;height:30px;padding:0 6px;text-align:center;font-size:13px;border-radius:9px;font-variant-numeric:tabular-nums}
.t-pack .addrow{display:flex;gap:6px;margin-top:8px}
.t-pack .addrow .input{min-width:0}
@media print{.t-pack .opts,.t-pack .addrow,.t-pack .pz-ib{display:none}.t-pack .cats{columns:2}}
`

const defaults = () => ({ days: 5, climate: 'mild', type: 'leisure', acts: [], adults: 1, kids: 0, infants: 0, intl: false, flying: true, laundry: false, rain: false })
const newList = (name, opts) => refresh({ id: uid(), name, opts: { ...defaults(), ...opts }, cats: [], hidePacked: false })
const fresh = () => { const l = newList('My trip'); return { lists: [l], active: l.id } }

export function mount(root) {
  const el = app(root, 'pack', '#8b5cf6')
  css('t-pack', CSS)
  const store = makeStore('packing', fresh(), (d) => { if (!d.lists?.length) Object.assign(d, fresh()); if (!d.lists.some((l) => l.id === d.active)) d.active = d.lists[0].id })
  const D = () => store.get()
  const L = () => D().lists.find((l) => l.id === D().active)
  const tabsHost = h('div'), optHost = h('div'), heroHost = h('div'), listHost = h('div'), dataHost = h('div')
  el.append(tabsHost, optHost, heroHost, listHost, dataHost)
  let timer = 0
  const regen = () => { clearTimeout(timer); timer = setTimeout(() => { refresh(L()); store.save(); renderProgress(); renderList() }, 250) }
  const commit = () => { store.save(); renderAll() }

  function renderTabs() {
    clear(tabsHost, docTabs({
      docs: D().lists, activeId: D().active, noun: 'list',
      onSelect: (id) => { D().active = id; store.save(); renderAll() },
      onAdd: async () => { const n = await promptBox({ title: 'New packing list', label: 'Trip name', placeholder: 'Goa weekend' }); if (!n) return; const l = newList(n, { ...L().opts, acts: [...L().opts.acts] }); D().lists.push(l); D().active = l.id; commit() },
      onRename: async () => { const n = await promptBox({ title: 'Rename list', label: 'Trip name', value: L().name }); if (n) { L().name = n; commit() } },
      onDelete: async () => { if (!(await confirmBox({ title: `Delete "${L().name}"?`, text: 'The list and what you ticked off are removed.' }))) return; D().lists = D().lists.filter((l) => l.id !== D().active); D().active = D().lists[0]?.id; commit() },
    }))
  }

  const stepper = (get, set, min, max, label) => {
    const inp = input({ type: 'number', min, max, value: get(), 'aria-label': label, oninput: () => { const v = Math.round(inp.valueAsNumber); if (Number.isFinite(v)) { set(clamp(v, min, max)); regen() } } })
    const bump = (d) => { const v = clamp(get() + d, min, max); set(v); inp.value = v; regen() }
    return h('div', { class: 'step' }, h('button', { type: 'button', 'aria-label': `Fewer ${label.toLowerCase()}`, onclick: () => bump(-1) }, '-'), inp, h('button', { type: 'button', 'aria-label': `More ${label.toLowerCase()}`, onclick: () => bump(1) }, '+'))
  }
  function renderOptions() {
    const o = L().opts
    const upd = () => { store.save(); regen() }
    const climate = h('div', { class: 'pz-chips', role: 'group', 'aria-label': 'Weather' }, CLIMATES.map(([id, label, ic]) => chip(label, { ic, pressed: o.climate === id, onClick: () => { o.climate = id; renderOptions(); upd() } })))
    const types = h('div', { class: 'pz-chips', role: 'group', 'aria-label': 'Trip type' }, TYPES.map(([id, label, ic]) => chip(label, { ic, pressed: o.type === id, onClick: () => { o.type = id; renderOptions(); upd() } })))
    const acts = h('div', { class: 'pz-chips', role: 'group', 'aria-label': 'Activities' }, ACTS.map(([id, label]) => chip(label, { pressed: o.acts.includes(id), onClick: () => { o.acts = o.acts.includes(id) ? o.acts.filter((x) => x !== id) : [...o.acts, id]; renderOptions(); upd() } })))
    clear(optHost, h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('sliders-horizontal'), 'Tell us about the trip'),
      h('div', { class: 'opts' },
        h('div', { class: 'stack' }, field('How many days?', stepper(() => o.days, (v) => { o.days = v }, 1, 90, 'Days')), field('Weather', climate), toggle('Expect rain', o.rain, (v) => { o.rain = v; upd() }), field('Trip type', types)),
        h('div', { class: 'stack' }, field('Activities', acts),
          h('div', { class: 'trio' }, field('Adults', stepper(() => o.adults, (v) => { o.adults = v }, 1, 12, 'Adults')), field('Kids', stepper(() => o.kids, (v) => { o.kids = v }, 0, 12, 'Kids')), field('Infants', stepper(() => o.infants, (v) => { o.infants = v }, 0, 6, 'Infants'))),
          h('div', { class: 'stack', style: 'gap:8px' }, toggle('Flying', o.flying, (v) => { o.flying = v; upd() }), toggle('International trip', o.intl, (v) => { o.intl = v; upd() }), toggle('Laundry available (pack fewer clothes)', o.laundry, (v) => { o.laundry = v; upd() }))))))
  }

  const stats = () => { const items = L().cats.flatMap((c) => c.items); return { total: items.length, done: items.filter((i) => i.done).length } }
  function renderProgress() {
    const { total, done } = stats()
    const f = total ? done / total : 0
    const rg = ring({ size: 96, stroke: 10 })
    setTimeout(() => rg.set(f), 20)
    clear(heroHost, h('section', { class: 'pz-card tint' }, h('div', { class: 'phero' }, h('div', { class: 'rw' }, rg, h('div', { class: 'pct' }, `${Math.round(f * 100)}%`)),
      h('div', { class: 'stack', style: 'gap:10px' }, h('div', { class: 'big' }, `${done}`, h('small', ` of ${total} packed`)), bar(f, f === 1 ? 'var(--success)' : undefined),
        h('div', { class: 'pz-row pz-noprint' }, button('Share', { icon: 'share-2', size: 'sm', onClick: () => shareText(L().name, listToText(L())).then((ok) => ok && toast('Packing list shared or copied', 'success')) }),
          button('Print', { icon: 'printer', size: 'sm', onClick: () => window.print() }),
          toggle('Hide packed items', L().hidePacked, (v) => { L().hidePacked = v; store.save(); renderList() }),
          (L().removed || []).length ? button(`Restore ${(L().removed || []).length} removed`, { size: 'sm', variant: 'ghost', onClick: () => { L().removed = []; refresh(L()); commit() } }) : null,
          done ? button('Unpack all', { size: 'sm', variant: 'ghost', onClick: () => { for (const c of L().cats) for (const i of c.items) i.done = false; commit() } }) : null)))))
  }
  function renderList() {
    const l = L()
    const cats = l.cats.map((c) => {
      const items = l.hidePacked ? c.items.filter((i) => !i.done) : c.items
      const dn = c.items.filter((i) => i.done).length
      const add = input({ placeholder: `Add to ${c.name.toLowerCase()}`, 'aria-label': `Add item to ${c.name}`, maxlength: 80, autocomplete: 'off' })
      const addIt = () => { const t = add.value.trim(); if (!t) return; c.items.push({ id: uid(), key: '', text: t, qty: '', qtyEdited: false, done: false, custom: true }); store.save(); renderProgress(); renderList(); setTimeout(() => listHost.querySelector(`[data-cat="${c.id}"] input`)?.focus(), 20) }
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addIt() } })
      return h('section', { class: 'pz-card cat pz-rise', 'data-cat': c.id },
        h('header', h('span', { class: 'ic' }, icon(c.icon)), h('b', c.name), h('small', `${dn}/${c.items.length}`), ib(c.collapsed ? 'chevron-down' : 'chevron-up', c.collapsed ? `Expand ${c.name}` : `Collapse ${c.name}`, () => { c.collapsed = !c.collapsed; store.save(); renderList() }),
          !CATS[c.id] ? ib('trash-2', `Delete ${c.name}`, () => { l.cats = l.cats.filter((x) => x !== c); commit() }, 'danger') : null),
        c.collapsed ? null : [items.map((i) => h('div', { class: ['pi', i.done && 'done'] },
          checkBtn(i.done, (v) => { i.done = v; store.save(); renderProgress(); setTimeout(renderList, 350) }, `Packed ${i.text}`),
          h('span', { class: 'tx' }, i.text),
          h('input', { class: 'input qty', value: i.qty, 'aria-label': `Quantity for ${i.text}`, placeholder: 'qty', maxlength: 8, onchange: (e) => { i.qty = e.target.value.trim(); i.qtyEdited = true; store.save() } }),
          ib('x', `Remove ${i.text}`, () => { c.items = c.items.filter((x) => x !== i); if (!i.custom) (l.removed ||= []).push(i.key); store.save(); renderProgress(); renderList() }, 'danger'))),
          items.length === 0 && c.items.length ? h('p', { class: 'pz-note' }, 'Everything here is packed.') : null,
          h('div', { class: 'addrow pz-noprint' }, add, button('', { icon: 'plus', ariaLabel: `Add to ${c.name}`, variant: 'primary', size: 'sm', onClick: addIt }))])
    })
    clear(listHost, h('div', { class: 'cats' }, cats),
      h('div', { class: 'pz-row pz-noprint' }, button('Add a category', { icon: 'folder-plus', size: 'sm', onClick: async () => { const n = await promptBox({ title: 'New category', label: 'Name', placeholder: 'Gifts to take' }); if (!n) return; l.cats.push({ id: uid(), name: n, icon: 'package', collapsed: false, items: [] }); commit() } })))
  }
  function renderAll() { renderTabs(); renderOptions(); renderProgress(); renderList() }
  clear(dataHost, dataBar({ kind: 'packing', get: () => D(), set: (d) => { store.set(d.lists?.length ? d : fresh()); renderAll() }, reset: () => { store.set(fresh()); renderAll() } }))
  renderAll()
  return () => clearTimeout(timer)
}
