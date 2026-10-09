// Meal planner: a week grid (breakfast, lunch, dinner, snacks), recipes with ingredients, and a grocery list generated
// from the plan with quantities added up across recipes. Print it, copy it, or send it to the Grocery list tool.
import { h, icon, button, input, field, textarea, segmented, toast, clear, modal, copyText } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { app, css, makeStore, uid, today, addDays, fmtDate, startOfWeek, parseYmd, stat, emptyState, ib, chip, checkBtn, dataBar, confirmBox, promptBox, shareText, plural, num, clamp, DAY_NAMES } from './_shared.js'
import { AISLES, aisleById, aisleOf } from './_aisles.js'
import { parseLine, convertLine, mergeIngredients } from './_recipe.js'

export const SLOTS = [['breakfast', 'Breakfast', 'coffee', '#f59e0b'], ['lunch', 'Lunch', 'sun', '#10b981'], ['dinner', 'Dinner', 'moon', '#6366f1'], ['snacks', 'Snacks', 'cookie', '#ec4899']]
const SAMPLES = [
  { name: 'Poha', servings: 2, ingredients: '2 cups poha\n1 medium onion, chopped\n1 medium potato, diced\n2 tbsp oil\n1 tsp mustard seeds\n8 curry leaves\n2 green chillies\n1/2 tsp turmeric powder\n1 tsp salt\n2 tbsp roasted peanuts\n1 lemon\na handful of fresh coriander' },
  { name: 'Dal tadka', servings: 4, ingredients: '1 cup toor dal\n3 cups water\n1/2 tsp turmeric powder\n1 tsp salt\n2 tbsp ghee\n1 tsp cumin seeds\n4 cloves garlic\n1 inch piece ginger\n2 green chillies\n1 large onion\n2 medium tomatoes\n1 tsp red chilli powder\n1/2 tsp garam masala' },
  { name: 'Veg pulao', servings: 4, ingredients: '1.5 cups basmati rice\n2 tbsp ghee\n1 tsp cumin seeds\n1 large onion\n1 cup mixed vegetables\n3 cups water\n1 tsp salt\n2 green chillies\n1/2 tsp garam masala' },
  { name: 'Paneer bhurji', servings: 2, ingredients: '200 g paneer\n2 tbsp oil\n1 large onion\n2 medium tomatoes\n1/2 tsp turmeric powder\n1 tsp garam masala\n1 tsp red chilli powder\nsalt to taste' },
  { name: 'Masala omelette', servings: 1, ingredients: '3 eggs\n1 small onion\n1 green chilli\n1 tbsp oil\n1/4 tsp turmeric powder\nsalt to taste\n1 slice bread' },
  { name: 'Curd rice', servings: 2, ingredients: '1 cup rice\n1.5 cups curd\n1 cup milk\n1 tsp mustard seeds\n8 curry leaves\n1 tbsp oil\n1 green chilli\nsalt to taste' },
]

const FREE_RE = /to taste|as needed|for garnish|for serving|for frying|for dusting/i
/** Ingredient items [{qty, unit, name}] for a recipe cooked for `servings` people. Lines without a quantity only count when they say "to taste" and so on. */
export function recipeItems(recipe, servings) {
  const f = servings > 0 && recipe.servings > 0 ? servings / recipe.servings : 1
  const items = []
  for (const line of String(recipe.ingredients || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const p = parseLine(line)
    if (p.qty) { const r = convertLine(p, { factor: f, smart: false }); items.push({ qty: r.qty, unit: r.unit, name: p.name }) }
    else if (FREE_RE.test(line)) items.push({ qty: null, unit: '', name: line.replace(FREE_RE, '').replace(/[,;-]\s*$/, '').trim() || line })
  }
  return items
}
/** Merged shopping items for a list of dates. */
export function groceryFor(data, dates) {
  const items = []
  for (const d of dates) for (const [slot] of SLOTS) for (const e of data.plan[d]?.[slot] || []) {
    const r = data.recipes.find((x) => x.id === e.recipeId)
    if (r) items.push(...recipeItems(r, e.servings || data.people))
  }
  return mergeIngredients(items)
}

const CSS = `
.t-meal .head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.t-meal .head h2{margin:0;font-size:clamp(17px,3.6vw,22px);letter-spacing:-.03em;flex:1;min-width:0}
.t-meal .grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px}
@media (max-width:1180px){.t-meal .grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}}
.t-meal .day{border:1px solid var(--border);border-radius:18px;background:var(--surface);padding:10px;display:flex;flex-direction:column;gap:8px;min-width:0}
.t-meal .day.today{border-color:var(--tc);box-shadow:0 0 0 3px color-mix(in srgb,var(--tc) 14%,transparent)}
.t-meal .day>header{display:flex;align-items:baseline;justify-content:space-between;font-size:12.5px;color:var(--muted);font-weight:600}
.t-meal .day>header b{font-size:17px;color:var(--text)}
.t-meal .slot{display:flex;flex-direction:column;gap:4px;padding:6px;border-radius:12px;background:color-mix(in srgb,var(--sc) 7%,var(--surface))}
.t-meal .slot>.sh{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.07em;color:var(--sc)}
.t-meal .slot>.sh .icon{width:13px;height:13px}
.t-meal .slot>.sh .l{display:flex;gap:5px;align-items:center}
.t-meal .slot .add{width:24px;height:24px;border-radius:8px;border:1px dashed color-mix(in srgb,var(--sc) 50%,var(--border));background:none;color:var(--sc);cursor:pointer;display:grid;place-items:center;padding:0}
.t-meal .slot .add:hover{background:color-mix(in srgb,var(--sc) 14%,transparent)}
.t-meal .slot .add .icon{width:13px;height:13px}
.t-meal .ent{display:flex;align-items:center;gap:4px;padding:5px 6px 5px 8px;border-radius:9px;background:var(--surface);border:1px solid var(--border);font-size:13px;line-height:1.25;cursor:pointer;text-align:left;color:var(--text);width:100%;min-width:0}
.t-meal .ent span.t{flex:1;min-width:0;overflow-wrap:anywhere}
.t-meal .ent .sv{font-size:11px;color:var(--muted);white-space:nowrap}
.t-meal .ent:hover{border-color:color-mix(in srgb,var(--sc) 55%,var(--border))}
.t-meal .glist{columns:2 340px;column-gap:28px}
.t-meal .aisle{margin-bottom:14px;break-inside:avoid}
.t-meal .aisle h3{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.08em;color:var(--ac)}
.t-meal .aisle h3 .icon{width:14px;height:14px}
.t-meal .gi{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:7px 4px;border-bottom:1px solid var(--border)}
.t-meal .gi:last-child{border-bottom:0}
.t-meal .gi.done .nm{text-decoration:line-through;color:var(--muted)}
.t-meal .gi .nm{overflow-wrap:anywhere;font-size:14.5px;text-transform:capitalize}
.t-meal .gi .q{font-weight:650;font-variant-numeric:tabular-nums;font-size:13.5px;white-space:nowrap}
.t-meal .rc{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center;padding:10px 4px;border-bottom:1px solid var(--border)}
.t-meal .rc:last-child{border-bottom:0}
.t-meal .rc b{font-size:14.5px;overflow-wrap:anywhere}.t-meal .rc small{display:block;color:var(--muted);font-size:12.5px}
.t-meal .pick{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto}
.t-meal .pick button{display:flex;justify-content:space-between;gap:10px;text-align:left;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:var(--surface);cursor:pointer;color:var(--text);font-size:14px}
.t-meal .pick button:hover,.t-meal .pick button[aria-pressed="true"]{border-color:var(--tc);background:color-mix(in srgb,var(--tc) 8%,var(--surface))}
@media print{.t-meal .day{break-inside:avoid}.t-meal .grid{grid-template-columns:repeat(4,1fr)}.t-meal .slot .add,.t-meal .ent .pz-ib{display:none}}
`

const blank = () => ({ recipes: [], plan: {}, people: 2, week: startOfWeek(today()), checked: {} })

export function mount(root) {
  const el = app(root, 'meal', '#10b981')
  css('t-meal', CSS)
  const store = makeStore('mealplanner', blank(), (d) => { d.recipes ||= []; d.plan ||= {}; d.people ||= 2; d.week ||= startOfWeek(today()); d.checked ||= {} })
  const D = () => store.get()
  const weekDates = () => Array.from({ length: 7 }, (_, i) => addDays(D().week, i))
  const wkLabel = () => `${fmtDate(D().week, { day: 'numeric', month: 'short' })} - ${fmtDate(addDays(D().week, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`
  const headHost = h('div'), gridHost = h('div'), listHost = h('div'), recHost = h('div'), dataHost = h('div')
  el.append(h('h2', { class: 'pz-printonly' }, 'Meal plan'), headHost, gridHost, listHost, recHost, dataHost)

  // ---------- week + grid
  function renderHead() {
    const planned = weekDates().reduce((s, d) => s + SLOTS.reduce((n, [k]) => n + (D().plan[d]?.[k]?.length || 0), 0), 0)
    const pi = input({ type: 'number', min: 1, max: 30, value: D().people, 'aria-label': 'How many people eat', style: 'width:84px', onchange: () => { D().people = clamp(Math.round(pi.valueAsNumber) || 1, 1, 30); store.save(); renderGrid(); renderList() } })
    clear(headHost, h('section', { class: 'pz-card' }, h('div', { class: 'head' }, h('h2', wkLabel()),
      ib('chevron-left', 'Previous week', () => { D().week = addDays(D().week, -7); store.save(); renderAll() }),
      button('This week', { size: 'sm', onClick: () => { D().week = startOfWeek(today()); store.save(); renderAll() } }),
      ib('chevron-right', 'Next week', () => { D().week = addDays(D().week, 7); store.save(); renderAll() }),
      h('span', { class: 'pz-note pz-noprint' }, 'Cooking for'), pi, h('span', { class: 'pz-note pz-noprint' }, 'people'),
      h('span', { class: 'pz-noprint pz-row' }, button('Copy to next week', { size: 'sm', icon: 'copy', disabled: !planned, onClick: copyForward }), button('Print', { size: 'sm', icon: 'printer', onClick: () => window.print() }),
        button('Clear week', { size: 'sm', icon: 'eraser', variant: 'ghost', disabled: !planned, onClick: async () => { if (await confirmBox({ title: 'Clear this week?', text: 'All meals planned this week are removed. Recipes stay.', confirm: 'Clear week' })) { for (const d of weekDates()) delete D().plan[d]; store.save(); renderAll() } } })))))
  }
  function copyForward() {
    let n = 0
    for (const d of weekDates()) { const src = D().plan[d]; if (!src) continue; const to = addDays(d, 7); D().plan[to] ||= {}; for (const [k] of SLOTS) for (const e of src[k] || []) { (D().plan[to][k] ||= []).push({ ...e, id: uid() }); n++ } }
    store.save(); D().week = addDays(D().week, 7); store.save(); renderAll(); toast(`Copied ${plural(n, 'meal')} to this week`, 'success')
  }
  function entryForm(date, slot, entry) {
    const e = entry ? { ...entry } : { id: uid(), recipeId: '', text: '', servings: '' }
    const isNew = !entry
    const recipes = D().recipes
    let mode = e.recipeId || (recipes.length && isNew) ? 'recipe' : e.text ? 'text' : recipes.length ? 'recipe' : 'text'
    const q = input({ type: 'search', placeholder: 'Search your recipes', 'aria-label': 'Search recipes' })
    const pickHost = h('div', { class: 'pick' })
    const txt = input({ value: e.text, placeholder: 'e.g. Leftovers, eating out, fruit', 'aria-label': 'Meal', maxlength: 80 })
    const sv = input({ type: 'number', min: 1, max: 60, step: 'any', value: e.servings || '', placeholder: String(D().people), 'aria-label': 'Servings', style: 'width:96px' })
    const drawPick = () => {
      const f = q.value.toLowerCase()
      clear(pickHost, recipes.filter((r) => r.name.toLowerCase().includes(f)).map((r) => h('button', { type: 'button', 'aria-pressed': String(e.recipeId === r.id), onclick: () => { e.recipeId = r.id; drawPick() } }, h('span', r.name), h('span', { class: 'pz-note' }, `serves ${r.servings}`))))
      if (!pickHost.children.length) pickHost.append(h('p', { class: 'pz-note' }, recipes.length ? 'No match.' : 'No recipes yet. Add one below, or use a quick note.'))
    }
    q.addEventListener('input', drawPick); drawPick()
    const recBox = h('div', { class: 'stack' }, q, pickHost, field('Servings (blank = everyone)', sv))
    const txtBox = h('div', { class: 'stack' }, field('What are you having?', txt))
    const seg = segmented([['recipe', 'From my recipes'], ['text', 'Quick note']], mode, (v) => { mode = v; sync() }, 'Meal type')
    const sync = () => { recBox.hidden = mode !== 'recipe'; txtBox.hidden = mode !== 'text' }
    sync()
    const go = () => {
      if (mode === 'recipe') { if (!e.recipeId) { toast('Pick a recipe', 'error'); return } e.text = ''; e.servings = sv.value ? Number(sv.value) : '' }
      else { if (!txt.value.trim()) { txt.focus(); return } e.recipeId = ''; e.text = txt.value.trim(); e.servings = '' }
      const cell = ((D().plan[date] ||= {})[slot] ||= [])
      if (isNew) cell.push(e); else Object.assign(cell.find((x) => x.id === e.id), e)
      store.save(); dlg.close(); renderAll()
    }
    txt.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go() } })
    const dlg = modal({ title: `${isNew ? 'Plan' : 'Edit'} ${SLOTS.find((s) => s[0] === slot)[1].toLowerCase()}, ${fmtDate(date)}`, icon: 'utensils', body: h('div', { class: 'stack' }, seg, recBox, txtBox),
      actions: [!isNew && button('Remove', { icon: 'trash-2', variant: 'danger', onClick: () => { D().plan[date][slot] = D().plan[date][slot].filter((x) => x.id !== e.id); store.save(); dlg.close(); renderAll() } }), button('Cancel', { onClick: () => dlg.close() }), button(isNew ? 'Add' : 'Save', { variant: 'primary', onClick: go })].filter(Boolean) })
    setTimeout(() => (mode === 'text' ? txt : q).focus(), 60)
  }
  function renderGrid() {
    const t = today()
    clear(gridHost, h('div', { class: 'grid' }, weekDates().map((d, i) => h('section', { class: ['day', d === t && 'today', 'pz-rise'], style: { '--i': i } },
      h('header', h('span', DAY_NAMES[i]), h('b', String(parseYmd(d).getDate()))),
      SLOTS.map(([k, label, ic, color]) => h('div', { class: 'slot', style: { '--sc': color } },
        h('div', { class: 'sh' }, h('span', { class: 'l' }, icon(ic), label), h('button', { type: 'button', class: 'add pz-noprint', 'aria-label': `Add ${label.toLowerCase()} on ${fmtDate(d)}`, title: `Add ${label.toLowerCase()}`, onclick: () => entryForm(d, k) }, icon('plus'))),
        (D().plan[d]?.[k] || []).map((e) => {
          const r = D().recipes.find((x) => x.id === e.recipeId)
          return h('button', { type: 'button', class: 'ent', title: 'Edit', onclick: () => entryForm(d, k, e) }, h('span', { class: 't' }, r ? r.name : e.text || 'Meal'), r ? h('span', { class: 'sv' }, `x${num(e.servings || D().people, 1)}`) : null)
        })))))))
  }

  // ---------- grocery list
  function listText(items) {
    const by = new Map()
    for (const it of items) { const a = aisleOf(it.name); if (!by.has(a)) by.set(a, []); by.get(a).push(it) }
    return [`Grocery list, ${wkLabel()}`, '', ...AISLES.filter((a) => by.has(a.id)).flatMap((a) => [a.name.toUpperCase(), ...by.get(a.id).map((it) => `- ${it.text ? it.text + ' ' : ''}${it.display}`), ''])].join('\n').trim()
  }
  function renderList() {
    const items = groceryFor(D(), weekDates())
    const by = new Map()
    for (const it of items) { const a = aisleOf(it.name); if (!by.has(a)) by.set(a, []); by.get(a).push(it) }
    const key = (it) => `${D().week}|${it.name}|${it.unit}`
    const left = items.filter((i) => !D().checked[key(i)]).length
    clear(listHost, h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('shopping-basket'), h('span', { class: 'grow' }, 'Grocery list for this week'), items.length ? h('span', { class: 'pz-note' }, `${left} of ${items.length} to buy`) : null),
      items.length ? h('div', null, h('div', { class: 'glist' }, AISLES.filter((a) => by.has(a.id)).map((a) => h('div', { class: 'aisle', style: { '--ac': a.color } }, h('h3', icon(a.icon), a.name),
        by.get(a.id).map((it) => { const done = !!D().checked[key(it)]; return h('div', { class: ['gi', done && 'done'] }, checkBtn(done, (v) => { if (v) D().checked[key(it)] = 1; else delete D().checked[key(it)]; store.save(); renderList() }, `Got ${it.display}`, a.color), h('span', { class: 'nm' }, it.display), h('span', { class: 'q' }, it.text)) }))))
        , h('div', { class: 'pz-row pz-noprint' }, button('Copy', { icon: 'copy', size: 'sm', onClick: () => copyText(listText(items)) }), button('Share', { icon: 'share-2', size: 'sm', onClick: () => shareText('Grocery list', listText(items)) }), button('Send to Grocery list', { icon: 'send', size: 'sm', variant: 'primary', onClick: () => sendToGrocery(items.filter((i) => !D().checked[key(i)])) }),
          left < items.length ? button('Uncheck all', { size: 'sm', variant: 'ghost', onClick: () => { for (const i of items) delete D().checked[key(i)]; store.save(); renderList() } }) : null))
        : emptyState('Plan some meals first', 'Add recipes to the week above and the shopping list, with quantities added up, appears here.', 'shopping-basket')))
  }
  function sendToGrocery(items) {
    if (!items.length) { toast('Nothing left to buy', 'error'); return }
    const g = load('lists:grocery', null) || { v: 1, active: null, currency: 'INR', lists: [] }
    g.lists ||= []
    const list = { id: uid(), name: `Meal plan ${fmtDate(D().week, { day: 'numeric', month: 'short' })}`, sort: 'aisle', items: items.map((it) => ({ id: uid(), text: it.display, done: false, qty: it.text, cat: aisleOf(it.name), pri: 0, due: '', price: '', note: '' })) }
    g.lists.push(list); g.active = list.id
    save('lists:grocery', g)
    toast(`Sent ${plural(items.length, 'item')} to your Grocery list`, 'success')
  }

  // ---------- recipes
  function recipeForm(r) {
    const isNew = !r
    const m = r ? { ...r } : { id: uid(), name: '', servings: 4, ingredients: '', notes: '' }
    const name = input({ value: m.name, placeholder: 'e.g. Rajma chawal', maxlength: 60, 'aria-label': 'Recipe name' })
    const sv = input({ type: 'number', min: 1, max: 100, step: 'any', value: m.servings, 'aria-label': 'Servings', style: 'width:100px' })
    const ing = textarea({ rows: 9, value: m.ingredients, placeholder: '2 cups basmati rice\n1 cup rajma, soaked\n2 onions\nsalt to taste', 'aria-label': 'Ingredients, one per line', spellcheck: false })
    const info = h('p', { class: 'pz-note' })
    const upd = () => { const n = recipeItems({ servings: 1, ingredients: ing.value }, 1).length; info.textContent = n ? `${plural(n, 'ingredient')} recognised` : 'Write one ingredient per line, with a quantity: 2 cups rice' }
    ing.addEventListener('input', upd); upd()
    const dlg = modal({ title: isNew ? 'New recipe' : 'Edit recipe', icon: 'chef-hat', body: h('div', { class: 'stack' }, h('div', { class: 'pz-row' }, h('div', { class: 'pz-grow' }, field('Name', name)), field('Serves', sv)), field('Ingredients', ing), info),
      actions: [!isNew && button('Delete', { icon: 'trash-2', variant: 'danger', onClick: async () => { if (await confirmBox({ title: `Delete "${r.name}"?`, text: 'Meals planned with this recipe stay as plain notes.' })) { D().recipes = D().recipes.filter((x) => x.id !== r.id); for (const day of Object.values(D().plan)) for (const k of Object.keys(day)) for (const e of day[k]) if (e.recipeId === r.id) { e.text = r.name; e.recipeId = '' } store.save(); dlg.close(); renderAll() } } }), button('Cancel', { onClick: () => dlg.close() }),
        button('Save recipe', { variant: 'primary', onClick: () => { if (!name.value.trim()) { name.focus(); return } Object.assign(m, { name: name.value.trim(), servings: Math.max(1, Number(sv.value) || 1), ingredients: ing.value.trim() }); if (isNew) D().recipes.push(m); else Object.assign(D().recipes.find((x) => x.id === m.id), m); store.save(); dlg.close(); renderAll() } })].filter(Boolean) })
    setTimeout(() => name.focus(), 60)
  }
  function renderRecipes() {
    const rs = D().recipes
    clear(recHost, h('section', { class: 'pz-card pz-noprint' }, h('h2', { class: 'pz-title' }, icon('book-open'), h('span', { class: 'grow' }, `Your recipes (${rs.length})`), button('New recipe', { icon: 'plus', size: 'sm', variant: 'primary', onClick: () => recipeForm() })),
      rs.length ? rs.map((r) => h('div', { class: 'rc' }, h('div', h('b', r.name), h('small', `Serves ${r.servings}, ${plural(recipeItems(r, r.servings).length, 'ingredient')}`)), h('span', { class: 'pz-row nowrap', style: 'gap:2px' }, ib('pencil', `Edit ${r.name}`, () => recipeForm(r)))))
        : emptyState('No recipes yet', 'Add your own, paste one from the Recipe scaler, or start with a few Indian staples.', 'chef-hat'),
      h('div', { class: 'pz-row', style: 'margin-top:10px' }, button('Add sample recipes', { icon: 'sparkles', size: 'sm', onClick: () => { const have = new Set(D().recipes.map((r) => r.name)); let n = 0; for (const s of SAMPLES) if (!have.has(s.name)) { D().recipes.push({ id: uid(), notes: '', ...s }); n++ } store.save(); renderAll(); toast(n ? `Added ${plural(n, 'recipe')}` : 'Already added') } }))))
  }

  function renderAll() { renderHead(); renderGrid(); renderList(); renderRecipes() }
  clear(dataHost, dataBar({ kind: 'mealplanner', get: () => D(), set: (d) => { store.set({ ...blank(), ...d }); renderAll() }, reset: () => { store.set(blank()); renderAll() } }))
  renderAll()
}
