// Recipe scaler: paste a recipe, scale it by servings or a factor, convert units (cups, tbsp, tsp, ml, g with ingredient
// densities), copy or save it to the meal planner. Understands fractions (1/2, 1 1/2, ½), ranges (2-3) and "a pinch of".
import { h, icon, button, input, field, textarea, segmented, toggle, toast, clear, copyText, download } from '../../lib/ui.js'
import { app, css, makeStore, uid, chip, ib, emptyState, promptBox, plural, num, clamp } from './_shared.js'
import { load, save } from '../../lib/store.js'
import { parseRecipe, parseLine, convertLine, formatParts } from './_recipe.js'

const SAMPLE = `Dal tadka (serves 4)
1 cup toor dal
3 cups water
1/2 tsp turmeric powder
1 tsp salt
2 tbsp ghee
1 tsp cumin seeds
4 cloves garlic, minced
1 inch piece ginger, grated
2 green chillies, slit
1 large onion, chopped
2 medium tomatoes, chopped
1 tsp red chilli powder
1/2 tsp garam masala
a handful of fresh coriander`

/** Servings mentioned in the text: "serves 4", "makes 12 cookies", "4 servings". */
export function guessServings(text) {
  const m = text.match(/\b(?:serves?|servings?|yield|yields|makes|feeds)\s*:?\s*(\d{1,3})\b/i) || text.match(/\b(\d{1,3})\s*(?:servings?|portions?|people|persons?)\b/i)
  return m ? Number(m[1]) : null
}

const CSS = `
.t-scaler .out{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.t-scaler .out li{display:flex;gap:8px;align-items:baseline;padding:7px 10px;border-radius:10px;font-size:15px;overflow-wrap:anywhere}
.t-scaler .out li:nth-child(odd){background:var(--surface-2)}
.t-scaler .out li b{font-variant-numeric:tabular-nums;color:var(--tc);white-space:nowrap;min-width:4.2em}
.t-scaler .out li.note{color:var(--muted);font-size:14px}
.t-scaler .out li.head{font-weight:650;color:var(--text)}
.t-scaler .out li.changed b{background:color-mix(in srgb,var(--tc) 14%,transparent);border-radius:6px;padding:0 6px;margin-left:-6px}
.t-scaler .big{display:flex;align-items:center;justify-content:center;gap:10px;font-size:30px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.t-scaler .big small{font-size:14px;color:var(--muted);font-weight:500;letter-spacing:0}
.t-scaler .step{display:flex;align-items:center;gap:6px}
.t-scaler .step .input{width:92px;text-align:center;font-size:18px;font-weight:650}
.t-scaler .step button{width:40px;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--surface);font-size:20px;cursor:pointer;color:var(--text)}
.t-scaler .step button:hover{border-color:var(--tc)}
.t-scaler .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
`

export function mount(root) {
  const el = app(root, 'scaler', '#f59e0b')
  css('t-scaler', CSS)
  const store = makeStore('recipe-scaler', { text: SAMPLE, from: 4, to: 6, factor: 1.5, mode: 'servings', system: 'original', smart: true, both: false, grams: true, decimals: false })
  const S = store.get()
  let fromEdited = false

  const ta = textarea({ rows: 15, value: S.text, spellcheck: false, placeholder: 'Paste ingredients here, one per line:\n2 cups flour\n1 1/2 tsp baking powder\n3 eggs', 'aria-label': 'Recipe text', oninput: () => { S.text = ta.value; const g = guessServings(S.text); if (g && !fromEdited) { S.from = g; fromIn.value = g; if (S.mode === 'servings') factorSync() } store.save(); update() } })
  const fromIn = input({ type: 'number', min: 1, max: 999, step: 'any', value: S.from, 'aria-label': 'Servings in the original recipe', oninput: () => { const v = fromIn.valueAsNumber; if (v > 0) { S.from = v; fromEdited = true; factorSync(); store.save(); update() } } })
  const toIn = input({ type: 'number', min: 1, max: 999, step: 'any', value: S.to, 'aria-label': 'Servings you want', oninput: () => { const v = toIn.valueAsNumber; if (v > 0) { S.to = v; factorSync(); store.save(); update() } } })
  const facIn = input({ type: 'number', min: 0.01, max: 99, step: 'any', value: S.factor, 'aria-label': 'Scale factor', oninput: () => { const v = facIn.valueAsNumber; if (v > 0) { S.factor = v; store.save(); update() } } })
  const factor = () => (S.mode === 'servings' ? S.to / S.from : S.factor)
  function factorSync() { S.factor = Math.round((S.to / S.from) * 1000) / 1000; facIn.value = S.factor }
  const stepper = (inp, get, set, d) => h('div', { class: 'step' }, h('button', { type: 'button', 'aria-label': 'Decrease', onclick: () => { const v = Math.max(d.min, Math.round((get() - d.step) * 100) / 100); set(v); inp.value = v; update() } }, '-'), inp, h('button', { type: 'button', 'aria-label': 'Increase', onclick: () => { const v = Math.round((get() + d.step) * 100) / 100; set(v); inp.value = v; update() } }, '+'))

  const modeSeg = segmented([['servings', 'By servings'], ['factor', 'By factor']], S.mode, (v) => { S.mode = v; store.save(); sync(); update() }, 'Scale by')
  const servBox = h('div', { class: 'two' },
    field('Original serves', stepper(fromIn, () => S.from, (v) => { S.from = v; fromEdited = true; factorSync(); store.save() }, { min: 1, step: 1 })),
    field('You want', stepper(toIn, () => S.to, (v) => { S.to = v; factorSync(); store.save() }, { min: 1, step: 1 })))
  const facBox = h('div', { class: 'stack' }, field('Multiply everything by', stepper(facIn, () => S.factor, (v) => { S.factor = v; store.save() }, { min: 0.25, step: 0.25 })),
    h('div', { class: 'pz-chips' }, [[0.25, '¼x'], [0.5, '½x'], [1.5, '1½x'], [2, '2x'], [3, '3x'], [4, '4x']].map(([f, l]) => chip(l, { onClick: () => { S.factor = f; facIn.value = f; store.save(); update() } }))))
  const sysSeg = segmented([['original', 'As written'], ['metric', 'Metric (g, ml)'], ['us', 'US (cups)']], S.system, (v) => { S.system = v; store.save(); update() }, 'Units')
  const optSmart = toggle('Tidy units (3 tsp becomes 1 tbsp)', S.smart, (v) => { S.smart = v; store.save(); update() })
  const optBoth = toggle('Show both unit systems', S.both, (v) => { S.both = v; store.save(); update() })
  const optGrams = toggle('Weigh known dry ingredients in grams', S.grams, (v) => { S.grams = v; store.save(); update() })
  const optDec = toggle('Decimals instead of fractions', S.decimals, (v) => { S.decimals = v; store.save(); update() })
  const big = h('div', { class: 'big' })
  const outHost = h('div')
  const hint = h('p', { class: 'pz-note' })
  const sync = () => { servBox.hidden = S.mode !== 'servings'; facBox.hidden = S.mode !== 'factor' }

  const left = h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('clipboard-paste'), h('span', { class: 'grow' }, 'Your recipe'),
    button('Example', { size: 'sm', onClick: () => { ta.value = S.text = SAMPLE; S.from = 4; S.to = 6; fromIn.value = 4; toIn.value = 6; fromEdited = false; factorSync(); store.save(); update() } }),
    button('Clear', { size: 'sm', variant: 'ghost', onClick: () => { ta.value = S.text = ''; store.save(); update(); ta.focus() } })),
  h('div', { class: 'stack' }, ta, h('p', { class: 'pz-note' }, 'One ingredient per line. Fractions (1/2, 1 1/2, ½), ranges (2-3) and words like "a pinch of" work. Lines without a quantity, like headings and steps, stay as they are.')))
  const right = h('div', { class: 'stack' },
    h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('scale'), 'Scale'), h('div', { class: 'stack' }, modeSeg, servBox, facBox, big, hint)),
    h('section', { class: 'pz-card' }, h('h2', { class: 'pz-title' }, icon('arrow-left-right'), 'Units'), h('div', { class: 'stack' }, sysSeg, h('div', { class: 'stack', style: 'gap:8px' }, optSmart, optGrams, optBoth, optDec))))
  const outCard = h('section', { class: 'pz-card tint' })
  el.append(h('div', { class: 'pz-cols' }, left, right), outCard)
  sync()

  let outText = ''
  function update() {
    const f = factor()
    clear(big, h('span', `x${num(f, 2)}`), h('small', S.mode === 'servings' ? `${num(S.from, 1)} to ${num(S.to, 1)} servings` : 'scale factor'))
    hint.textContent = f >= 2.5 ? 'Tip: when scaling up a lot, add salt and spices gradually, and cooking times often change a little.' : f <= 0.5 ? 'Tip: for small batches, use a smaller pan and check doneness earlier.' : ''
    const lines = parseRecipe(S.text)
    const opts = { factor: Number.isFinite(f) && f > 0 ? f : 1, system: S.system, smart: S.smart, both: S.both, grams: S.grams, decimals: S.decimals }
    const lis = [], text = []
    let n = 0
    for (const p of lines) {
      const raw = p.raw.trim()
      if (!raw) { text.push(''); continue }
      const r = convertLine(p, opts)
      if (!r) { const head = /:\s*$/.test(raw) || raw.length < 40 && !/[.!?]$/.test(raw) && lines.indexOf(p) === 0; lis.push(h('li', { class: head ? 'head' : 'note' }, raw)); text.push(raw); continue }
      n++
      const { qty, rest } = formatParts(p, r, opts)
      const changed = qty !== raw.slice(0, qty.length)
      lis.push(h('li', { class: changed ? 'changed' : '' }, h('b', qty), h('span', rest)))
      text.push(`${qty} ${rest}`.trim())
    }
    outText = text.join('\n').trim()
    clear(outCard, h('h2', { class: 'pz-title' }, icon('chef-hat'), h('span', { class: 'grow' }, n ? `Scaled recipe (${plural(n, 'ingredient')})` : 'Scaled recipe'),
      button('Copy', { icon: 'copy', size: 'sm', disabled: !outText, onClick: () => copyText(outText) }),
      button('.txt', { icon: 'download', size: 'sm', disabled: !outText, title: 'Download as a text file', onClick: () => download(outText + '\n', 'scaled-recipe.txt', 'text/plain') }),
      button('Save to meal planner', { icon: 'calendar-plus', size: 'sm', disabled: !outText, onClick: saveToPlanner })),
    n ? h('ul', { class: 'out' }, lis) : emptyState('Paste a recipe to begin', 'Scaled quantities appear here as you type.', 'chef-hat'))
  }
  async function saveToPlanner() {
    const name = await promptBox({ title: 'Save to meal planner', label: 'Recipe name', value: (S.text.split('\n')[0] || '').replace(/\(.*?\)/g, '').replace(/serves.*$/i, '').trim().slice(0, 50), confirm: 'Save' })
    if (!name) return
    const d = load('mealplanner', null) || { recipes: [], plan: {}, people: 2 }
    d.recipes = d.recipes || []
    d.recipes.push({ id: uid(), name, servings: Math.round(S.mode === 'servings' ? S.to : S.from * S.factor) || 4, ingredients: outText.split('\n').filter((l) => parseLine(l).qty || /to taste|as needed|for garnish|for serving/i.test(l)).join('\n'), notes: '' })
    save('mealplanner', d)
    toast(`Saved "${name}". Find it in the Meal planner.`, 'success')
  }
  const g0 = guessServings(S.text)
  if (g0 && S.text === SAMPLE) { S.from = g0; fromIn.value = g0; factorSync() }
  update()
}
