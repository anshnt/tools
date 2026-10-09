// Recipe parsing, scaling, unit conversion and ingredient merging. Pure functions (no DOM), shared by the recipe scaler and
// the meal planner. Quantities: whole numbers, decimals, fractions (1/2, 1 1/2), unicode fractions, ranges (2-3, 2 to 3).

const UF = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }
const UFC = Object.keys(UF).join('')
const NUM_SRC = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\s?[${UFC}]|[${UFC}]|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|\\.\\d+)`
const QTY_RE = new RegExp(`^\\s*(?:(?:about|approx\\.?|approximately|around|roughly|~)\\s*)?(${NUM_SRC})(?:\\s*(?:-|\\u2013|\\u2014|to)\\s*(${NUM_SRC}))?(?![\\d/])`, 'i')

/** "1 1/2" -> 1.5, "1½" -> 1.5, "1,000" -> 1000, ".5" -> 0.5. NaN when unreadable. */
export function parseNumber(tok) {
  const t = String(tok).trim()
  let m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/)
  if (m) return +m[1] + +m[2] / +m[3]
  m = t.match(/^(\d+)\/(\d+)$/)
  if (m) return +m[2] ? +m[1] / +m[2] : NaN
  m = t.match(new RegExp(`^(\\d+)\\s?([${UFC}])$`))
  if (m) return +m[1] + UF[m[2]]
  if (t.length === 1 && UF[t]) return UF[t]
  return parseFloat(t.replace(/,/g, ''))
}

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5 }
// "a pinch of salt", "two eggs", "half a cup of milk" -> leading number words become digits (only at the start of a line)
const WORDQ_RE = /^(?:(a|an)\s+(?=(?:pinch|dash|handful|knob|sprig|bunch|clove|slice|piece|can|stick|drop)\b)|(one|two|three|four|five|six|seven|eight|nine|ten)\s+(?=[a-z])|(half)\s+(?:a\s+|an\s+)?(?=(?:cup|tsp|tbsp|teaspoon|tablespoon|kg|lb|pound|litre|liter|l)\b))/i

// ---------------------------------------------------------------- units
export const UNITS = {
  tsp: { kind: 'vol', base: 5, label: 'tsp' }, tbsp: { kind: 'vol', base: 15, label: 'tbsp' }, cup: { kind: 'vol', base: 240, label: 'cup', plural: 'cups' },
  floz: { kind: 'vol', base: 29.5735, label: 'fl oz' }, pt: { kind: 'vol', base: 473.176, label: 'pint', plural: 'pints' }, qt: { kind: 'vol', base: 946.353, label: 'quart', plural: 'quarts' }, gal: { kind: 'vol', base: 3785.41, label: 'gallon', plural: 'gallons' },
  ml: { kind: 'vol', base: 1, label: 'ml' }, l: { kind: 'vol', base: 1000, label: 'l' },
  mg: { kind: 'mass', base: 0.001, label: 'mg' }, g: { kind: 'mass', base: 1, label: 'g' }, kg: { kind: 'mass', base: 1000, label: 'kg' }, oz: { kind: 'mass', base: 28.3495, label: 'oz' }, lb: { kind: 'mass', base: 453.592, label: 'lb' },
  // counted units: never converted
  pinch: { kind: 'count', label: 'pinch', plural: 'pinches' }, dash: { kind: 'count', label: 'dash', plural: 'dashes' }, clove: { kind: 'count', label: 'clove', plural: 'cloves' },
  piece: { kind: 'count', label: 'piece', plural: 'pieces' }, slice: { kind: 'count', label: 'slice', plural: 'slices' }, can: { kind: 'count', label: 'can', plural: 'cans' },
  stick: { kind: 'count', label: 'stick', plural: 'sticks' }, bunch: { kind: 'count', label: 'bunch', plural: 'bunches' }, sprig: { kind: 'count', label: 'sprig', plural: 'sprigs' },
  handful: { kind: 'count', label: 'handful', plural: 'handfuls' }, packet: { kind: 'count', label: 'packet', plural: 'packets' }, sheet: { kind: 'count', label: 'sheet', plural: 'sheets' },
  stalk: { kind: 'count', label: 'stalk', plural: 'stalks' }, head: { kind: 'count', label: 'head', plural: 'heads' }, leaf: { kind: 'count', label: 'leaf', plural: 'leaves' },
  inch: { kind: 'count', label: 'inch', plural: 'inches' }, drop: { kind: 'count', label: 'drop', plural: 'drops' }, cube: { kind: 'count', label: 'cube', plural: 'cubes' },
}
const ALIASES = {
  tsp: 'tsp tsps teaspoon teaspoons tspn', tbsp: 'tbsp tbsps tbs tbl tbspn tablespoon tablespoons', cup: 'cup cups', floz: 'floz fl.oz', pt: 'pint pints pt', qt: 'quart quarts qt', gal: 'gallon gallons gal',
  ml: 'ml mls milliliter milliliters millilitre millilitres', l: 'l lt liter liters litre litres ltr', mg: 'mg milligram milligrams',
  g: 'g gm gms gram grams gramme grammes', kg: 'kg kgs kilo kilos kilogram kilograms', oz: 'oz ounce ounces', lb: 'lb lbs pound pounds',
  pinch: 'pinch pinches', dash: 'dash dashes', clove: 'clove cloves', piece: 'piece pieces pc pcs', slice: 'slice slices', can: 'can cans tin tins', stick: 'stick sticks', bunch: 'bunch bunches',
  sprig: 'sprig sprigs', handful: 'handful handfuls', packet: 'packet packets pack packs pkt', sheet: 'sheet sheets', stalk: 'stalk stalks', head: 'head heads', leaf: 'leaf leaves',
  inch: 'inch inches', drop: 'drop drops', cube: 'cube cubes',
}
const ALIAS = new Map()
for (const [u, list] of Object.entries(ALIASES)) for (const a of list.split(' ')) ALIAS.set(a, u)
const unitName = (u, plural) => (plural && UNITS[u].plural) || UNITS[u].label

// Grams per metric cup (240 ml) for common ingredients; `liquid` ones stay in millilitres when going metric.
const DENSITY = [
  ['all purpose flour|all-purpose flour|plain flour|maida|refined flour', 120], ['atta|whole wheat flour|wholemeal', 120], ['besan|gram flour|chickpea flour', 92], ['rice flour', 150], ['corn flour|cornflour|cornstarch|corn starch', 128],
  ['flour', 120], ['powdered sugar|icing sugar|confectioners', 120], ['brown sugar', 213], ['jaggery|gur', 200], ['sugar', 200], ['honey', 340, 1], ['maple syrup|golden syrup|syrup', 322, 1],
  ['butter', 227], ['ghee', 218], ['oil', 216, 1], ['milk', 245, 1], ['buttermilk|chaas', 245, 1], ['cream', 238, 1], ['yogurt|yoghurt|curd|dahi', 245], ['water|stock|broth', 240, 1],
  ['basmati|rice', 185], ['oats|rolled oats', 90], ['sooji|suji|semolina|rava', 167], ['poha|flattened rice', 100], ['dal|lentil|lentils|moong|masoor|toor|chana|rajma|beans', 192], ['quinoa', 170],
  ['cocoa', 85], ['salt', 288], ['baking powder', 230], ['baking soda|bicarbonate', 220], ['breadcrumbs|bread crumbs', 108], ['grated cheese|cheddar|mozzarella|parmesan', 100], ['paneer', 225],
  ['peanut butter', 258], ['peanuts|groundnuts', 146], ['almonds', 143], ['cashews|cashew', 137], ['walnuts', 117], ['raisins|sultanas', 150], ['coconut', 80], ['chocolate chips', 170], ['spinach', 30],
  ['turmeric|haldi', 96], ['chili powder|chilli powder|red chili|paprika', 100], ['cumin|jeera|coriander powder|garam masala', 100],
]
const DENS = DENSITY.map(([k, g, liquid]) => ({ re: new RegExp(`\\b(?:${k})\\b`, 'i'), g, liquid: !!liquid }))
/** {gPerCup, liquid} for an ingredient name, or null when unknown. */
export function densityOf(name) {
  for (const d of DENS) if (d.re.test(name)) return { gPerCup: d.g, liquid: d.liquid }
  return null
}

// ---------------------------------------------------------------- parsing
const DESCRIPTORS = /\b(large|medium|small|big|fresh|freshly|ripe|raw|whole|finely|roughly|coarsely|thinly|thickly|chopped|diced|minced|sliced|grated|crushed|peeled|boiled|cooked|dried|ground|powdered|packed|heaped|level|optional|extra|good quality|organic|boneless|skinless|frozen|canned|tinned|soft|hard|cold|warm|hot|lukewarm|melted|softened|beaten|shredded|cubed|halved|rinsed|washed|soaked|toasted|roasted)\b/gi

/**
 * "1 1/2 cups flour, sifted" -> {raw, qty: {min, max}, unit: 'cup', name: 'flour, sifted', pre: ''}.
 * Lines without a leading quantity come back with qty: null (headings, notes, steps).
 */
export function parseLine(raw) {
  let line = String(raw).replace(/^\s*[-*•·▪◦]\s+/, '').replace(/\s+/g, ' ').trim()
  const step = line.match(/^\d+[.)]\s+(\S)/)
  if (step) { if (/^[A-Za-z]/.test(step[1])) return { raw, qty: null, unit: '', name: line, pre: '' }; line = line.replace(/^\d+[.)]\s+/, '') }
  line = line.replace(WORDQ_RE, (_, a, n, hf) => ' ' + WORDS[(a || n || hf).toLowerCase()] + ' ').trim()
  const m = line.match(QTY_RE)
  if (!m) return { raw, qty: null, unit: '', name: line, pre: '' }
  const min = parseNumber(m[1])
  let max = m[2] ? parseNumber(m[2]) : min
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { raw, qty: null, unit: '', name: line, pre: '' }
  if (max < min) max = min
  let rest = line.slice(m[0].length).trim()
  let pre = ''
  const pm = rest.match(/^\(([^)]*)\)\s*/)
  if (pm) { pre = `(${pm[1]})`; rest = rest.slice(pm[0].length) }
  let unit = ''
  const two = rest.match(/^(fl\.?\s?oz|fluid\s+ounces?)\b\.?\s*/i)
  if (two) { unit = 'floz'; rest = rest.slice(two[0].length) }
  else {
    const w = rest.match(/^([A-Za-z]+)\.?(?=\s|$|[,)(])\s*/)
    if (w && ALIAS.has(w[1].toLowerCase()) && !(w[1].length === 1 && w[1] !== 'g' && w[1] !== 'l')) { unit = ALIAS.get(w[1].toLowerCase()); rest = rest.slice(w[0].length) }
  }
  // "250g" style handled above because \s* is optional between number and unit; "of" is noise: "2 cups of flour"
  rest = rest.replace(/^of\s+/i, '')
  let suffix = ''
  if (unit === 'inch') { const sm = rest.match(/^(piece|stick|knob|chunk)\b\s*/i); if (sm) { suffix = sm[1].toLowerCase(); rest = rest.slice(sm[0].length) } }
  // a trailing unit-less sentence like "2 minutes" would still parse as an ingredient, which is fine for a pasted recipe list
  return { raw, qty: { min, max }, unit, name: rest.trim(), pre, suffix }
}
export const parseRecipe = (text) => String(text).split(/\r?\n/).map(parseLine)

// ---------------------------------------------------------------- formatting
const FRACS = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']]
const FRAC_ASCII = { '⅛': '1/8', '¼': '1/4', '⅓': '1/3', '⅜': '3/8', '½': '1/2', '⅝': '5/8', '⅔': '2/3', '¾': '3/4', '⅞': '7/8' }
const DECIMAL_UNITS = new Set(['g', 'kg', 'ml', 'l', 'mg', 'oz', 'lb', 'floz'])

/** Format a number as a cooking fraction ("1½") or a tidy decimal; `ascii` writes "1 1/2" instead of unicode. */
export function fmtFraction(v, ascii = false) {
  if (!(v > 0)) return '0'
  let whole = Math.floor(v + 1e-9)
  const f = v - whole
  let best = FRACS[0]
  for (const fr of FRACS) if (Math.abs(f - fr[0]) < Math.abs(f - best[0])) best = fr
  if (Math.abs(f - best[0]) > 0.035) return String(Math.round(v * 100) / 100)
  if (best[0] === 1) whole++
  if (!best[1]) return String(whole || 0)
  const sym = ascii ? FRAC_ASCII[best[1]] : best[1]
  if (!whole) return sym
  return ascii ? `${whole} ${sym}` : `${whole}${sym}`
}
/** Round a metric quantity sensibly: 1234.5678 -> 1235, 12.34 -> 12.3, 0.5 -> 0.5. */
export function fmtMetric(v) {
  if (v >= 100) return String(Math.round(v))
  if (v >= 10) return String(Math.round(v * 10) / 10)
  return String(Math.round(v * 100) / 100)
}
export const fmtQtyValue = (v, unit, { decimals = false, ascii = false } = {}) => (decimals || (unit && ['g', 'kg', 'ml', 'l', 'mg'].includes(unit)) ? fmtMetric(v) : fmtFraction(v, ascii))

// ---------------------------------------------------------------- conversion
/** Convert a value between units; volume <-> mass needs a known density for the ingredient. Returns null if impossible. */
export function convertValue(v, from, to, name = '') {
  if (from === to) return v
  const a = UNITS[from], b = UNITS[to]
  if (!a || !b || a.kind === 'count' || b.kind === 'count') return null
  if (a.kind === b.kind) return (v * a.base) / b.base
  const d = densityOf(name)
  if (!d) return null
  const gPerMl = d.gPerCup / 240
  if (a.kind === 'vol') return (v * a.base * gPerMl) / b.base
  return (v * a.base) / gPerMl / b.base
}

/** Tidy a (value, unit) pair after scaling: 3 tsp -> 1 tbsp, 1500 ml -> 1.5 l, 0.5 kg -> 500 g, 4 tbsp -> 1/4 cup. */
export function normalizeUnit(v, unit) {
  const eps = 1e-9
  if (unit === 'tsp' && v >= 3 - eps) { v /= 3; unit = 'tbsp' }
  if (unit === 'tbsp' && v >= 4 - eps) { v /= 16; unit = 'cup' }
  else if (unit === 'tbsp' && v < 0.5) { v *= 3; unit = 'tsp' }
  if (unit === 'cup' && v < 0.25 - eps) { v *= 16; unit = 'tbsp' }
  if (unit === 'ml' && v >= 1000) { v /= 1000; unit = 'l' }
  else if (unit === 'l' && v < 1) { v *= 1000; unit = 'ml' }
  if (unit === 'g' && v >= 1000) { v /= 1000; unit = 'kg' }
  else if (unit === 'kg' && v < 1) { v *= 1000; unit = 'g' }
  if (unit === 'oz' && v >= 16) { v /= 16; unit = 'lb' }
  else if (unit === 'lb' && v < 1) { v *= 16; unit = 'oz' }
  return [v, unit]
}

/**
 * Scale and convert one parsed line.
 * opts: {factor, system: 'original'|'metric'|'us', grams: use grams for known solids when going metric, smart: tidy units, both: also return the other system as `alt`}
 * Returns {qty: {min, max}, unit, alt: {qty, unit}|null}.
 */
export function convertLine(p, { factor = 1, system = 'original', grams = true, smart = true, both = false } = {}) {
  if (!p.qty) return null
  let { min, max } = p.qty
  min *= factor; max *= factor
  let unit = p.unit
  const orig = { qty: { min, max }, unit }
  if (unit && UNITS[unit].kind !== 'count') {
    const target = targetUnit(min, max, unit, p.name, system, grams)
    if (target && target !== unit) {
      const a = convertValue(min, unit, target, p.name), b = convertValue(max, unit, target, p.name)
      if (a != null && b != null) { min = a; max = b; unit = target }
    }
    if (smart) {
      const [v1, u1] = normalizeUnit(max, unit)
      if (u1 !== unit) { const k = v1 / max; if (min === max || isClean(min * k, u1)) { min *= k; max = v1; unit = u1 } }
    }
  }
  let alt = null
  if (both && unit && UNITS[unit].kind !== 'count') {
    const other = system === 'metric' || ['g', 'kg', 'ml', 'l', 'mg'].includes(unit) ? 'us' : 'metric'
    const tu = targetUnit(min, max, unit, p.name, other, true)
    if (tu && tu !== unit) {
      const a = convertValue(min, unit, tu, p.name), b = convertValue(max, unit, tu, p.name)
      if (a != null && b != null) { let [bv, bu] = smart ? normalizeUnit(b, tu) : [b, tu]; const k = bv / b; alt = { qty: { min: a * k, max: bv }, unit: bu } }
    }
  }
  return { qty: { min, max }, unit, alt, orig }
}
/** Does v read as a tidy cooking amount (a nice fraction, or any metric number)? */
function isClean(v, unit) { if (DECIMAL_UNITS.has(unit) || unit === 'l') return true; return !String(fmtFraction(v)).includes('.') }
function targetUnit(min, max, unit, name, system, grams) {
  const kind = UNITS[unit].kind
  const d = densityOf(name)
  if (system === 'metric') {
    if (kind === 'vol') {
      if (['ml', 'l', 'tsp', 'tbsp'].includes(unit)) return unit
      if (grams && d && !d.liquid) return 'g'
      return 'ml'
    }
    return unit === 'g' || unit === 'kg' || unit === 'mg' ? unit : 'g'
  }
  if (system === 'us') {
    if (kind === 'vol') return ['ml', 'l', 'floz', 'pt', 'qt', 'gal'].includes(unit) ? 'cup' : unit
    if (d && (unit === 'g' || unit === 'kg')) return 'cup'
    return unit === 'g' || unit === 'kg' ? 'oz' : unit === 'mg' ? 'g' : unit
  }
  return unit
}

/** {qty, rest}: the quantity part ("1½ cups") and the remaining text ("flour (180 g)") of a converted line. */
export function formatParts(p, res, { decimals = false, ascii = false } = {}) {
  if (!res) return { qty: '', rest: p.name || '' }
  const one = (r) => {
    const { min, max } = r.qty
    const plural = max > 1.0001
    const a = fmtQtyValue(min, r.unit, { decimals, ascii }), b = fmtQtyValue(max, r.unit, { decimals, ascii })
    return `${Math.abs(max - min) < 1e-9 ? a : `${a}-${b}`}${r.unit ? ` ${unitName(r.unit, plural && !p.suffix)}${p.suffix ? ' ' + p.suffix : ''}` : ''}`
  }
  const name = ['pinch', 'dash', 'handful', 'bunch', 'drop', 'sprig'].includes(res.unit) && p.name ? `of ${p.name}` : p.name
  return { qty: one(res), rest: `${p.pre ? p.pre + ' ' : ''}${name}${res.alt ? ` (${one(res.alt)})` : ''}`.replace(/\s+/g, ' ').trim() }
}
/** Plain-text line from a conversion result. */
export function formatLine(p, res, opts = {}) {
  if (!res) return p.name || ''
  const { qty, rest } = formatParts(p, res, opts)
  return `${qty} ${rest}`.trim()
}
/** Scale a whole recipe text. Returns the lines as text. */
export function scaleRecipe(text, opts = {}) {
  return parseRecipe(text).map((p) => { const r = convertLine(p, opts); return r ? formatLine(p, r, opts) : p.raw.trim() })
}

// ---------------------------------------------------------------- merging for shopping lists
/** Lowercase, drop descriptors and anything after a comma, light singularising: "2 Large Red Onions, chopped" -> "red onion". */
export function normName(name) {
  let n = String(name).toLowerCase().replace(/\(.*?\)/g, ' ').split(/,| - | or /)[0].replace(DESCRIPTORS, ' ').replace(/[^a-zÀ-ɏ0-9 '&-]/g, ' ').replace(/\s+/g, ' ').trim()
  n = n.replace(/\bof\b/g, '').replace(/\s+/g, ' ').trim()
  const words = n.split(' ')
  const last = words.at(-1) || ''
  const keep = /(ss|us|is|ous)$/i.test(last) || ['molasses', 'hummus', 'couscous', 'asparagus', 'lemongrass', 'swiss', 'citrus'].includes(last)
  if (!keep && last.length > 3) {
    if (/ies$/.test(last)) words[words.length - 1] = last.replace(/ies$/, 'y')
    else if (/(oes)$/.test(last)) words[words.length - 1] = last.replace(/oes$/, 'o')
    else if (/(ches|shes|xes|sses)$/.test(last)) words[words.length - 1] = last.replace(/es$/, '')
    else if (/s$/.test(last)) words[words.length - 1] = last.replace(/s$/, '')
  }
  return words.join(' ').trim()
}
/**
 * Merge scaled ingredient items [{qty:{min,max}, unit, name}] into one list: same ingredient and unit family are added up
 * (ranges count at their top end so you never buy too little). Returns [{name, qty, unit, text}] sorted by name.
 */
export function mergeIngredients(items) {
  const map = new Map()
  for (const it of items) {
    const key0 = normName(it.name)
    if (!key0) continue
    if (!it.qty) { const k = `${key0}|free`; if (!map.has(k)) map.set(k, { name: key0, display: key0, kind: 'free', base: 0, top: 0 }); continue }
    const kind = it.unit ? UNITS[it.unit].kind : 'none'
    const group = kind === 'count' ? `c:${it.unit}` : kind
    const key = `${key0}|${group}`
    const base = kind === 'vol' || kind === 'mass' ? it.qty.max * UNITS[it.unit].base : it.qty.max
    const cur = map.get(key) || { name: key0, display: '', kind, countUnit: kind === 'count' ? it.unit : '', base: 0, top: 0 }
    cur.base += base
    if (it.qty.max >= cur.top) { cur.top = it.qty.max; cur.display = String(it.name).split(',')[0].replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim() }
    map.set(key, cur)
  }
  const have = new Set([...map.values()].filter((c) => c.kind !== 'free').map((c) => c.name))
  const out = []
  for (const c of map.values()) {
    if (c.kind === 'free' && have.has(c.name)) continue
    let qty = c.base, unit = ''
    if (c.kind === 'vol') { if (qty < 14.9) { qty /= 5; unit = 'tsp' } else if (qty < 59.9) { qty /= 15; unit = 'tbsp' } else [qty, unit] = normalizeUnit(qty, 'ml') }
    else if (c.kind === 'mass') [qty, unit] = normalizeUnit(qty, 'g')
    else if (c.kind === 'count') unit = c.countUnit
    const text = c.kind === 'free' ? '' : c.kind === 'none' ? fmtFraction(qty) : `${fmtQtyValue(qty, unit)} ${unitName(unit, qty > 1.0001)}`
    out.push({ name: c.name, display: c.display || c.name, qty: c.kind === 'free' ? null : qty, unit, kind: c.kind, text })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
