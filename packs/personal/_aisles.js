// Grocery aisles and keyword-based auto-categorization (Indian and international items). Shared by lists and meal-planner.

export const AISLES = [
  { id: 'produce', name: 'Fruits & vegetables', icon: 'carrot', color: '#10b981' },
  { id: 'dairy', name: 'Dairy & eggs', icon: 'milk', color: '#0ea5e9' },
  { id: 'bakery', name: 'Bread & bakery', icon: 'croissant', color: '#f59e0b' },
  { id: 'meat', name: 'Meat & fish', icon: 'drumstick', color: '#ef4444' },
  { id: 'staples', name: 'Grains, pulses & oils', icon: 'wheat', color: '#d97706' },
  { id: 'spices', name: 'Spices & masalas', icon: 'flame', color: '#f97316' },
  { id: 'snacks', name: 'Snacks & sweets', icon: 'cookie', color: '#ec4899' },
  { id: 'drinks', name: 'Drinks', icon: 'cup-soda', color: '#6366f1' },
  { id: 'frozen', name: 'Frozen & ready', icon: 'snowflake', color: '#38bdf8' },
  { id: 'household', name: 'Household', icon: 'spray-can', color: '#14b8a6' },
  { id: 'personal', name: 'Personal care', icon: 'sparkles', color: '#a855f7' },
  { id: 'other', name: 'Other', icon: 'package', color: '#64748b' },
]
export const aisleById = (id) => AISLES.find((a) => a.id === id) || AISLES.at(-1)

const WORDS = {
  produce: 'tomato onion potato garlic ginger chilli chili capsicum pepper carrot cucumber spinach palak cabbage cauliflower gobi broccoli brinjal eggplant aubergine okra bhindi lady beans peas pea corn pumpkin gourd lauki bottle karela radish mooli beetroot lemon lime coriander cilantro mint pudina curry leaf leaves parsley basil lettuce mushroom zucchini celery spring methi fenugreek drumstick sweet apple banana mango orange grapes grape papaya pomegranate watermelon melon pineapple guava kiwi pear peach plum strawberry strawberries blueberry blueberries berry berries cherry coconut avocado fig dates fruit fruits veggies vegetable vegetables salad herbs',
  dairy: 'milk curd yogurt yoghurt dahi paneer cheese butter ghee cream buttermilk chaas lassi egg eggs khoa mawa condensed whey',
  bakery: 'bread bun buns pav loaf toast bagel roti chapati tortilla cake pastry croissant muffin cookie rusk naan paratha kulcha bakery',
  meat: 'chicken mutton lamb beef pork fish prawn prawns shrimp crab salmon tuna sausage bacon ham meat keema turkey squid',
  staples: 'rice atta flour maida besan sooji suji semolina rava dal dhal daal lentil lentils chana rajma moong masoor urad toor arhar oats poha muesli cornflakes pasta noodles macaroni spaghetti sugar jaggy jaggery gur salt oil sunflower mustard olive vinegar honey yeast sabudana quinoa millet ragi jowar bajra wheat grain grains cereal vermicelli seviyan sauce ketchup jam peanut butter almonds cashew cashews raisins walnut walnuts pistachio nuts',
  spices: 'masala turmeric haldi cumin jeera coriander powder cardamom elaichi cinnamon dalchini clove cloves laung pepper peppercorn saffron kesar fennel saunf mustard seeds hing asafoetida garam chaat paprika oregano thyme spice spices bay tej patta ajwain kasuri',
  snacks: 'chips kitkat oreo lays kurkure parle cadbury bingo haldiram biscuit biscuits cookies namkeen bhujia chocolate chocolates candy sweets mithai popcorn crackers wafers snack snacks ice cream kulfi nutella',
  drinks: 'tea coffee juice cola soda water drink drinks squash beer wine whisky rum vodka lemonade horlicks bournvita complan energy protein smoothie coconut',
  frozen: 'frozen pizza nuggets fries parathas icecream samosa momos ready instant maggi soup',
  household: 'detergent soap dishwash dish harpic cleaner phenyl tissue tissues napkin napkins foil wrap garbage trash bags bag bulb battery batteries mop broom sponge scrub bleach freshener candle matchbox matches toilet paper roll liquid vim surf ariel comfort',
  personal: 'shampoo conditioner toothpaste toothbrush facewash face wash cream lotion sanitizer sanitiser razor deodorant deo perfume powder talc pad pads sanitary diaper diapers wipes soap shaving mask medicine tablet paracetamol vitamin comb hairoil',
}
// More specific words win when a name contains several categories ("coconut oil" is a staple, "dish soap" is household).
const PRIORITY = ['household', 'personal', 'frozen', 'spices', 'meat', 'dairy', 'bakery', 'snacks', 'drinks', 'staples', 'produce']
const INDEX = new Map()
for (const [aisle, list] of Object.entries(WORDS)) for (const w of list.split(' ')) { const set = INDEX.get(w) || new Set(); set.add(aisle); INDEX.set(w, set) }

const forms = (w) => [w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')]

/** Best aisle id for a grocery item name. */
export function aisleOf(name) {
  const words = String(name).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  const hits = new Map()
  const bump = (a, w) => hits.set(a, (hits.get(a) || 0) + w)
  words.forEach((w, i) => {
    for (const cand of forms(w)) {
      const set = INDEX.get(cand)
      if (set) { for (const a of set) bump(a, (set.size === 1 ? 2 : 1) + (i === words.length - 1 ? 0.5 : 0)); break }
    }
  })
  if (!hits.size) return 'other'
  let best = 'other', score = 0
  for (const [a, s] of hits) if (s > score || (s === score && PRIORITY.indexOf(a) < PRIORITY.indexOf(best))) { best = a; score = s }
  return best
}

const UNITS = '(?:kg|kgs|g|gm|gms|gram|grams|l|ltr|ltrs|litre|litres|liter|liters|ml|dozen|dz|pcs?|pieces?|packs?|packets?|bottles?|cans?|boxes|box|bunch(?:es)?|lbs?|oz|bags?|loaf|loaves)'
const NUM = '(?:\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+)?|[\\u00bc\\u00bd\\u00be])'
/** "2 kg tomatoes" -> {name: 'tomatoes', qty: '2 kg'}; "milk x2" -> {name: 'milk', qty: '2'}. */
export function parseGrocery(text) {
  const t = text.trim().replace(/\s+/g, ' ')
  let m = t.match(new RegExp(`^(${NUM}\\s*${UNITS}?)\\s+(?:of\\s+)?(.+)$`, 'i'))
  if (m && m[2] && !/^\d/.test(m[2])) return { qty: m[1].replace(/\s+/g, ' ').trim(), name: m[2].trim() }
  m = t.match(new RegExp(`^(.+?)\\s*(?:x|\\u00d7|-|,|\\()\\s*(${NUM}\\s*${UNITS}?)\\)?$`, 'i'))
  if (m && m[1]) return { qty: m[2].replace(/\s+/g, ' ').trim(), name: m[1].trim() }
  m = t.match(new RegExp(`^(.+?)\\s+(${NUM}\\s*${UNITS})$`, 'i'))
  if (m && m[1] && !/\d$/.test(m[1])) return { qty: m[2].replace(/\s+/g, ' ').trim(), name: m[1].trim() }
  return { qty: '', name: t }
}
