// Themes (colour and font sets), slide layouts, placeholders and starter decks.
import { uid, textEl, imageEl, tableEl, para, newDeck, isEmptyEl, textBase, parseOutline } from './_model.js'

// ---------- Themes ----------
// colours: bg text title muted accent accent2 surface onAccent. Elements use them as '@accent' tokens, so a theme switch recolours the deck.
// kinds: per slide kind (title, section, content): background, title/subtitle colour, title/subtitle boxes (fractions of the slide), decoration.
const R = (x, y, w, h, fill, op = 1) => ({ shape: 'rect', x, y, w, h, fill, op })
const C = (x, y, d, fill, op = 1) => ({ shape: 'ellipse', x, y, w: d, h: d, fill, op })
const GRAD = (c1, c2, ang = 135) => ({ c1, c2, ang })

export const THEMES = [
  {
    id: 'aurora', name: 'Aurora', note: 'Clean and modern',
    colors: { bg: '#ffffff', text: '#1f2340', title: '#1b1f3b', muted: '#6b7090', accent: '#5b4cf0', accent2: '#ec4899', surface: '#f2f1ff', onAccent: '#ffffff' },
    fonts: { head: 'Segoe UI', body: 'Segoe UI' },
    kinds: {
      title: { bg: { c1: '@bg' }, t: '@title', s: '@muted', tb: [0.0625, 0.28, 0.6, 0.28], sb: [0.0625, 0.58, 0.56, 0.14], a: 'left',
        decor: (W, H) => [R(W * 0.72, 0, W * 0.28, H, '@accent'), C(W * 0.76, H * 0.14, H * 0.34, '@accent2', 0.9), C(W * 0.82, H * 0.6, H * 0.2, '#ffffff', 0.25)] },
      section: { bg: { c1: '@accent' }, t: '@onAccent', s: '@onAccent', tb: [0.0625, 0.34, 0.62, 0.22], sb: [0.0625, 0.58, 0.55, 0.12], a: 'left',
        decor: (W, H) => [C(W * 0.66, H * 0.26, H * 0.52, '#ffffff', 0.14), C(W * 0.8, H * 0.12, H * 0.2, '#ffffff', 0.18)] },
      content: { bg: { c1: '@bg' }, t: '@title', s: '@muted', decor: (W, H) => [R(W * 0.0625, H * 0.065, 56, 6, '@accent'), R(W * 0.0625, H * 0.94, W * 0.875, 1, '@muted', 0.35)] },
    },
  },
  {
    id: 'midnight', name: 'Midnight', note: 'Dark with cyan glow',
    colors: { bg: '#0f172a', text: '#e2e8f0', title: '#f8fafc', muted: '#94a3b8', accent: '#38bdf8', accent2: '#a78bfa', surface: '#1e293b', onAccent: '#0b1220' },
    fonts: { head: 'Trebuchet MS', body: 'Segoe UI' },
    kinds: {
      title: { bg: { c1: '@bg' }, t: '@title', s: '@muted', tb: [0.0625, 0.28, 0.62, 0.28], sb: [0.0625, 0.58, 0.58, 0.14], a: 'left',
        decor: (W, H) => [C(W * 0.58, H * 0.18, H * 0.7, '@accent', 0.16), C(W * 0.72, H * 0.4, H * 0.46, '@accent2', 0.24), R(W * 0.0625 - 22, H * 0.3, 6, H * 0.26, '@accent')] },
      section: { bg: { c1: '@surface' }, t: '@title', s: '@muted', tb: [0.0625, 0.34, 0.7, 0.22], sb: [0.0625, 0.58, 0.6, 0.12], a: 'left',
        decor: (W, H) => [R(W * 0.0625 - 22, H * 0.36, 6, H * 0.2, '@accent'), C(W * 0.76, H * 0.5, H * 0.4, '@accent2', 0.2)] },
      content: { bg: { c1: '@bg' }, t: '@title', s: '@muted', decor: (W, H) => [R(0, H - 5, W, 5, '@accent'), R(W * 0.0625, H * 0.07, 40, 4, '@accent2')] },
    },
  },
  {
    id: 'paper', name: 'Paper', note: 'Warm serif, editorial',
    colors: { bg: '#fbf7ef', text: '#2b2118', title: '#2b2118', muted: '#7a6a58', accent: '#c2410c', accent2: '#0f766e', surface: '#f1e8d8', onAccent: '#fffaf0' },
    fonts: { head: 'Georgia', body: 'Palatino Linotype' },
    kinds: {
      title: { bg: { c1: '@bg' }, t: '@title', s: '@muted', tb: [0.1, 0.3, 0.8, 0.24], sb: [0.15, 0.58, 0.7, 0.12], a: 'center',
        decor: (W, H) => [R(W * 0.3, H * 0.26, W * 0.4, 2, '@accent'), R(W * 0.3, H * 0.74, W * 0.4, 2, '@accent')] },
      section: { bg: { c1: '@surface' }, t: '@title', s: '@muted', tb: [0.1, 0.36, 0.8, 0.2], sb: [0.15, 0.58, 0.7, 0.12], a: 'center',
        decor: (W, H) => [R(W * 0.45, H * 0.32, W * 0.1, 3, '@accent'), R(W * 0.45, H * 0.72, W * 0.1, 3, '@accent')] },
      content: { bg: { c1: '@bg' }, t: '@title', s: '@muted', decor: (W, H) => [R(W * 0.0625, H * 0.255, W * 0.875, 1.5, '@accent')] },
    },
  },
  {
    id: 'slate', name: 'Slate', note: 'Corporate blue',
    colors: { bg: '#f5f6f8', text: '#1f2937', title: '#111827', muted: '#6b7280', accent: '#1d4ed8', accent2: '#0ea5e9', surface: '#e5e7eb', onAccent: '#ffffff' },
    fonts: { head: 'Calibri', body: 'Calibri' },
    kinds: {
      title: { bg: { c1: '@bg' }, t: '@title', s: '@muted', tb: [0.0625, 0.2, 0.8, 0.28], sb: [0.0625, 0.5, 0.8, 0.12], a: 'left',
        decor: (W, H) => [R(0, H * 0.72, W, H * 0.28, '@accent'), R(0, H * 0.72, W, 6, '@accent2'), R(W * 0.0625, H * 0.1, 56, 6, '@accent')] },
      section: { bg: { c1: '@accent' }, t: '@onAccent', s: '@onAccent', tb: [0.0625, 0.34, 0.72, 0.22], sb: [0.0625, 0.58, 0.6, 0.12], a: 'left',
        decor: (W, H) => [R(0, H * 0.9, W, H * 0.1, '#000000', 0.12), R(W * 0.0625, H * 0.3, 56, 6, '@accent2')] },
      content: { bg: { c1: '@bg' }, t: '@title', s: '@muted', decor: (W, H) => [R(0, 0, 18, H, '@accent'), R(0, 0, 18, H * 0.12, '@accent2')] },
    },
  },
  {
    id: 'sunrise', name: 'Sunrise', note: 'Warm gradient',
    colors: { bg: '#fffaf5', text: '#3b1f1a', title: '#3b1f1a', muted: '#8a6a5e', accent: '#f97316', accent2: '#db2777', surface: '#ffedd5', onAccent: '#ffffff' },
    fonts: { head: 'Trebuchet MS', body: 'Trebuchet MS' },
    kinds: {
      title: { bg: GRAD('#f97316', '#db2777'), t: '#ffffff', s: '#ffe4d6', tb: [0.0625, 0.28, 0.7, 0.28], sb: [0.0625, 0.58, 0.6, 0.14], a: 'left',
        decor: (W, H) => [C(W * 0.64, H * 0.1, H * 0.62, '#ffffff', 0.14), C(W * 0.8, H * 0.58, H * 0.3, '#ffffff', 0.12)] },
      section: { bg: GRAD('#db2777', '#7c3aed', 135), t: '#ffffff', s: '#fde4f0', tb: [0.0625, 0.34, 0.7, 0.22], sb: [0.0625, 0.58, 0.6, 0.12], a: 'left',
        decor: (W, H) => [C(W * 0.64, H * 0.2, H * 0.55, '#ffffff', 0.12)] },
      content: { bg: { c1: '@bg' }, t: '@title', s: '@muted', decor: (W, H) => [R(0, 0, W, 10, '@accent'), R(W * 0.5, 0, W * 0.5, 10, '@accent2')] },
    },
  },
  {
    id: 'forest', name: 'Forest', note: 'Calm greens',
    colors: { bg: '#f3f7f2', text: '#14301f', title: '#0f2a1a', muted: '#58705f', accent: '#2f7d4f', accent2: '#d97706', surface: '#dcebdc', onAccent: '#ffffff' },
    fonts: { head: 'Cambria', body: 'Calibri' },
    kinds: {
      title: { bg: { c1: '#14301f' }, t: '#f3f7f2', s: '#a7c4af', tb: [0.0625, 0.28, 0.62, 0.28], sb: [0.0625, 0.58, 0.58, 0.14], a: 'left',
        decor: (W, H) => [C(W * 0.6, H * 0.16, H * 0.7, '@accent', 0.4), C(W * 0.78, H * 0.5, H * 0.34, '@accent2', 0.5)] },
      section: { bg: { c1: '@accent' }, t: '@onAccent', s: '#e6f2ea', tb: [0.0625, 0.34, 0.7, 0.22], sb: [0.0625, 0.58, 0.6, 0.12], a: 'left',
        decor: (W, H) => [C(W * 0.7, H * 0.3, H * 0.48, '#ffffff', 0.12), R(W * 0.0625, H * 0.3, 56, 6, '@accent2')] },
      content: { bg: { c1: '@bg' }, t: '@title', s: '@muted', decor: (W, H) => [R(0, H - 16, W, 16, '@accent'), R(0, H - 16, W * 0.12, 16, '@accent2')] },
    },
  },
]
export const getTheme = (deckOrId) => THEMES.find((t) => t.id === (typeof deckOrId === 'string' ? deckOrId : deckOrId?.theme)) || THEMES[0]

/** Resolve '@token' (or a literal colour) against the deck's theme. */
export function colorOf(deck, v, fallback = '') {
  if (!v) return fallback
  if (v[0] !== '@') return v
  return getTheme(deck).colors[v.slice(1)] || fallback
}
export const fontOf = (deck, f) => (f === '@head' ? getTheme(deck).fonts.head : f === '@body' || !f ? getTheme(deck).fonts.body : f)

// ---------- Layouts ----------
export const LAYOUTS = [
  { id: 'title', name: 'Title', kind: 'title' },
  { id: 'title-content', name: 'Title and content', kind: 'content' },
  { id: 'two-col', name: 'Two columns', kind: 'content' },
  { id: 'image', name: 'Picture', kind: 'content' },
  { id: 'section', name: 'Section', kind: 'section' },
  { id: 'title-only', name: 'Title only', kind: 'content' },
  { id: 'blank', name: 'Blank', kind: 'content' },
]
export const kindOf = (layoutId) => LAYOUTS.find((l) => l.id === layoutId)?.kind || 'content'
const kindSpec = (deck, slide) => getTheme(deck).kinds[kindOf(slide.layout)]

/** Slide background resolved to hex colours: { c1, c2?, ang? }. */
export function bgOf(deck, slide) {
  const b = slide.bg || kindSpec(deck, slide).bg
  return { c1: colorOf(deck, b.c1, '#ffffff'), c2: b.c2 ? colorOf(deck, b.c2) : null, ang: b.ang ?? 135 }
}

/** Theme decoration for a slide as non-editable shape elements in slide coordinates. */
export function decorOf(deck, slide) {
  if (slide.plain) return []
  const k = kindSpec(deck, slide)
  return (k.decor?.(deck.w, deck.h) || []).map((d, i) => ({ id: `d${i}`, type: 'shape', rot: 0, stroke: '', sw: 0, rad: 0.2, ...d }))
}

const frac = (deck, [x, y, w, h]) => ({ x: x * deck.w, y: y * deck.h, w: w * deck.w, h: h * deck.h })
const M = 0.0625

/** Placeholder elements for a layout, in this deck's theme and size. */
export function layoutSpec(deck, layoutId) {
  const sc = deck.h / 540
  const k = getTheme(deck).kinds[kindOf(layoutId)]
  const ph = (role, box, tx, extra = {}) => {
    const g = frac(deck, box)
    if (role === 'image') return imageEl(null, { ph: role, ...g, fit: 'contain', ...extra })
    const { bu, ...rest } = tx
    return textEl({ ph: role, ...g, tx: { ...rest, auto: false, paras: [para('', bu ? { bu: 'dot' } : {})] }, ...extra })
  }
  const title = (size, o = {}) => textBase({ font: '@head', size: Math.round(size * sc), color: k.t, b: true, va: 'middle', pad: 6, ...o })
  const bodyTx = (size = 24) => ({ ...textBase({ size: Math.round(size * sc), color: '@text', ps: Math.round(8 * sc), pad: 6 }), bu: true })
  const cT = [M, 0.1, 1 - 2 * M, 0.15]
  switch (layoutId) {
    case 'title': return [ph('title', k.tb, title(54, { a: k.a, va: 'bottom' })), ph('subtitle', k.sb, textBase({ size: Math.round(24 * sc), color: k.s, a: k.a, pad: 6 }))]
    case 'section': return [ph('title', k.tb, title(46, { a: k.a, va: 'bottom' })), ph('subtitle', k.sb, textBase({ size: Math.round(22 * sc), color: k.s, a: k.a, pad: 6 }))]
    case 'title-content': return [ph('title', cT, title(36)), ph('body', [M, 0.3, 1 - 2 * M, 0.6], bodyTx())]
    case 'two-col': return [ph('title', cT, title(36)), ph('body', [M, 0.3, 0.42, 0.6], bodyTx(22)), ph('body2', [M + 0.4375, 0.3, 0.42, 0.6], bodyTx(22))]
    case 'image': return [ph('title', cT, title(36)), ph('image', [M, 0.27, 1 - 2 * M, 0.56]), ph('caption', [M, 0.85, 1 - 2 * M, 0.08], textBase({ size: Math.round(16 * sc), color: '@muted', a: 'center', pad: 4 }))]
    case 'title-only': return [ph('title', cT, title(36))]
    default: return []
  }
}

/** Fill a placeholder: strings, arrays of strings, or [{t, lv}]. */
export function setPlaceholder(slide, role, value) {
  const el = slide.elements.find((e) => e.ph === role)
  if (!el || value == null || !el.tx) return
  const bullets = el.ph === 'body' || el.ph === 'body2'
  const items = Array.isArray(value) ? value : String(value).split('\n')
  el.tx.paras = items.map((x) => {
    const o = typeof x === 'string' ? { t: x } : x
    const p = para(o.t)
    if (bullets) p.bu = 'dot'
    if (o.lv) p.lv = o.lv
    return p
  })
}

export function newSlide(deck, layoutId = 'title-content', content = {}) {
  const slide = { id: uid('s'), layout: layoutId, bg: null, notes: content.notes || '', tr: content.tr || 'none', elements: layoutSpec(deck, layoutId) }
  for (const role of ['title', 'subtitle', 'body', 'body2', 'caption']) setPlaceholder(slide, role, content[role])
  return slide
}

/** Switch the deck theme. Placeholder text keeps its look unless it still matches the old theme's defaults, in which case it follows the new theme. */
export function applyTheme(deck, themeId) {
  const before = { ...deck }, after = { ...deck, theme: themeId }
  for (const slide of deck.slides) {
    if (slide.plain) continue
    const oldSpec = layoutSpec(before, slide.layout), newSpec = layoutSpec(after, slide.layout)
    for (const e of slide.elements) {
      const o = oldSpec.find((s) => s.ph === e.ph), n = newSpec.find((s) => s.ph === e.ph)
      if (!e.ph || !o || !n) continue
      if (e.tx && o.tx && n.tx) for (const k of ['color', 'font', 'a', 'va']) if (e.tx[k] === o.tx[k]) e.tx[k] = n.tx[k]
      if (['x', 'y', 'w', 'h'].every((k) => Math.abs(e[k] - o[k]) < 0.6)) Object.assign(e, { x: n.x, y: n.y, w: n.w, h: n.h })
    }
  }
  deck.theme = themeId
}

/** Switch a slide to another layout, keeping text that is already typed into matching placeholders. */
export function applyLayout(deck, slide, layoutId) {
  const spec = layoutSpec(deck, layoutId)
  const used = new Set()
  for (const s of spec) {
    const ex = slide.elements.find((e) => e.ph === s.ph && !used.has(e))
    if (ex) {
      Object.assign(ex, { x: s.x, y: s.y, w: s.w, h: s.h })
      if (ex.tx && s.tx) ex.tx = { ...ex.tx, ...s.tx, paras: ex.tx.paras.map((p) => (s.ph === 'body' || s.ph === 'body2' ? { bu: 'dot', ...p } : p)) }
      used.add(ex)
    } else {
      slide.elements.push(s)
      used.add(s)
    }
  }
  slide.elements = slide.elements.filter((e) => !(e.ph && !used.has(e) && isEmptyEl(e)))
  for (const e of slide.elements) if (e.ph && !used.has(e) && e.tx) e.tx.color = e.ph === 'subtitle' || e.ph === 'caption' ? '@muted' : '@text'
  // placeholders go first so they sit behind anything the user added
  slide.elements.sort((a, b) => (b.ph ? 1 : 0) - (a.ph ? 1 : 0) || 0)
  slide.layout = layoutId
  delete slide.plain
}

// ---------- Starter decks ----------
export const TEMPLATES = [
  { id: 'blank', name: 'Blank deck', desc: 'One title slide to start from', theme: 'aurora' },
  { id: 'pitch', name: 'Pitch deck', desc: 'Problem, solution, traction, team and ask', theme: 'midnight' },
  { id: 'lesson', name: 'Lesson', desc: 'Goals, key ideas, practice and summary', theme: 'forest' },
  { id: 'report', name: 'Project update', desc: 'Status, highlights, risks and next steps', theme: 'slate' },
]

export function buildTemplate(id, base = {}) {
  const tpl = TEMPLATES.find((t) => t.id === id) || TEMPLATES[0]
  const deck = newDeck({ theme: tpl.theme, ...base })
  const add = (layout, content) => { const s = newSlide(deck, layout, content); deck.slides.push(s); return s }
  const table = (s, cells, widths) => {
    const t = tableEl(cells.length, cells[0].length, { x: 0.0625 * deck.w, y: 0.3 * deck.h, w: 0.875 * deck.w, h: cells.length * 46, cells, size: 20 })
    if (widths) t.colw = widths
    s.elements.push(t)
  }
  if (tpl.id === 'blank') {
    deck.title = 'Untitled deck'
    add('title', { title: 'My presentation', subtitle: 'Double-click to edit this text', notes: 'Speaker notes go here. They show in the presenter window.' })
  } else if (tpl.id === 'pitch') {
    deck.title = 'Pitch deck'
    add('title', { title: 'Northwind Labs', subtitle: 'Smarter inventory for independent shops', notes: 'Introduce yourself and the one sentence pitch.' })
    add('title-content', { title: 'The problem', body: ['Small shops lose 8 percent of revenue to stock-outs and overstock', 'Spreadsheets break down past a few hundred products', 'Existing tools are built for enterprises and cost too much'], notes: 'Tell a short customer story here.' })
    add('title-content', { title: 'Our solution', body: ['Connects to your till in minutes', 'Forecasts demand per product, per week', 'Suggests orders you can approve in one tap'], notes: 'Keep this to what the product does, not how.' })
    add('two-col', { title: 'Why now', body: ['Point of sale data is finally easy to export', 'Cloud forecasting costs a fraction of what it did'], body2: ['4.2M independent shops in our markets', '$6B yearly inventory software spend'], notes: 'Left: the trends. Right: the market size.' })
    add('image', { title: 'The product', caption: 'Drop a screenshot into the picture area', notes: 'Walk through one real order.' })
    const t = add('title-only', { title: 'Traction', notes: 'Use real numbers.' })
    table(t, [['Metric', 'Q1', 'Q2', 'Q3'], ['Shops', '40', '120', '310'], ['Monthly revenue', '$8k', '$26k', '$71k'], ['Stock-outs avoided', '12%', '19%', '24%']], [0.37, 0.21, 0.21, 0.21])
    add('title-content', { title: 'Business model', body: ['Subscription from $49 per shop per month', 'Add-ons for multi-store and supplier ordering', 'Payback period under 4 months'], notes: '' })
    add('title-content', { title: 'The team', body: ['Alex Rivera, CEO, ten years in retail operations', 'Sam Okoye, CTO, built forecasting at a logistics scale-up', 'Priya Nair, Head of Customers, ex shop owner'], notes: '' })
    add('section', { title: 'Thank you', subtitle: 'hello@northwind.example', notes: 'Ask for the intro or the meeting here.' })
  } else if (tpl.id === 'lesson') {
    deck.title = 'Lesson'
    add('title', { title: 'How plants make food', subtitle: 'Science, Year 7', notes: 'Hook: ask where a tree gets its mass from.' })
    add('title-content', { title: 'Learning goals', body: ['Name the inputs and outputs of photosynthesis', 'Explain why light and chlorophyll matter', 'Design a simple experiment to test it'], notes: 'Read the goals aloud.' })
    add('section', { title: 'Key idea', subtitle: 'Light energy becomes chemical energy', notes: '' })
    add('two-col', { title: 'Inputs and outputs', body: ['Carbon dioxide from the air', 'Water from the soil', 'Light energy from the sun'], body2: ['Glucose, stored as food', 'Oxygen, released to the air'], notes: 'Draw the arrows on the board.' })
    add('title-content', { title: 'Practice', body: ['Work in pairs for 10 minutes', 'Label the diagram of the leaf', { t: 'Extension: what happens in the dark?', lv: 1 }], notes: 'Walk around and check the diagrams.' })
    add('title-content', { title: 'Summary', body: ['Plants turn light, water and CO2 into glucose and oxygen', 'Chlorophyll absorbs the light', 'Tomorrow: the experiment'], notes: '' })
  } else {
    deck.title = 'Project update'
    add('title', { title: 'Project update', subtitle: 'Week 12 status', notes: 'One minute on the overall status: green, amber or red.' })
    add('title-content', { title: 'Highlights', body: ['Beta shipped to 40 customers', 'Checkout latency down 35 percent', 'Two new hires started'], notes: '' })
    const t = add('title-only', { title: 'Milestones', notes: '' })
    table(t, [['Milestone', 'Owner', 'Due', 'Status'], ['Beta launch', 'Dana', 'Mar 3', 'Done'], ['Billing v2', 'Luis', 'Mar 24', 'On track'], ['Public launch', 'Mei', 'Apr 14', 'At risk']], [0.4, 0.2, 0.2, 0.2])
    add('two-col', { title: 'Risks and asks', body: ['Vendor delay on payments review', 'Design capacity for launch assets'], body2: ['Decision on pricing by Friday', 'One more engineer for April'], notes: '' })
    add('section', { title: 'Next steps', subtitle: 'Owners and dates in the tracker', notes: '' })
  }
  return deck
}

/** Slides from an outline: first slide is a title slide when it has at most one detail line. */
export function deckFromOutline(text, base = {}) {
  const spec = parseOutline(text)
  const deck = newDeck({ ...base })
  spec.forEach((s, i) => {
    if (i === 0 && s.bullets.length <= 1) deck.slides.push(newSlide(deck, 'title', { title: s.title, subtitle: s.bullets[0]?.t || '' }))
    else deck.slides.push(newSlide(deck, s.bullets.length ? 'title-content' : 'section', { title: s.title, body: s.bullets.length ? s.bullets : undefined }))
  })
  if (spec[0]) deck.title = spec[0].title.slice(0, 80)
  return deck
}
