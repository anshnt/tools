// Starter templates. Each make() returns {doc, assets}; artwork is generated SVG so templates look finished and need no downloads.
import { newDoc, addText, addShape, uid } from './_model.js'

// ---------- Generated artwork (SVG strings) ----------
const svgDoc = (w, h, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`
const grad = (id, stops, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`
const ART = {
  sunset: (w, h) => svgDoc(w, h,
    `<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.72}" cy="${h * 0.46}" r="${h * 0.2}" fill="#fde68a" opacity=".92"/>` +
    `<path d="M0 ${h * 0.68} Q ${w * 0.2} ${h * 0.55} ${w * 0.42} ${h * 0.7} T ${w * 0.8} ${h * 0.66} T ${w} ${h * 0.7} V ${h} H0Z" fill="#4c1d95" opacity=".85"/>` +
    `<path d="M0 ${h * 0.8} Q ${w * 0.25} ${h * 0.7} ${w * 0.5} ${h * 0.82} T ${w} ${h * 0.78} V ${h} H0Z" fill="#1e1b4b"/>`,
    grad('g', [[0, '#f97316'], [0.5, '#db2777'], [1, '#5b21b6']])),
  mountains: (w, h) => svgDoc(w, h,
    `<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.78}" cy="${h * 0.24}" r="${h * 0.09}" fill="#fff7d6"/>` +
    `<path d="M0 ${h * 0.7} L ${w * 0.2} ${h * 0.38} L ${w * 0.38} ${h * 0.62} L ${w * 0.56} ${h * 0.3} L ${w * 0.8} ${h * 0.66} L ${w} ${h * 0.5} V ${h} H0Z" fill="#38bdf8" opacity=".75"/>` +
    `<path d="M0 ${h * 0.82} L ${w * 0.25} ${h * 0.55} L ${w * 0.45} ${h * 0.8} L ${w * 0.7} ${h * 0.5} L ${w} ${h * 0.82} V ${h} H0Z" fill="#0369a1"/>` +
    `<path d="M0 ${h * 0.92} L ${w * 0.3} ${h * 0.74} L ${w * 0.6} ${h * 0.93} L ${w} ${h * 0.78} V ${h} H0Z" fill="#082f49"/>`,
    grad('g', [[0, '#7dd3fc'], [1, '#e0f2fe']])),
  geo: (w, h) => svgDoc(w, h,
    `<rect width="${w}" height="${h}" fill="#f5f1e8"/><circle cx="${w * 0.3}" cy="${h * 0.36}" r="${h * 0.26}" fill="#ef4444"/>` +
    `<rect x="${w * 0.42}" y="${h * 0.12}" width="${w * 0.36}" height="${h * 0.5}" fill="#111827"/>` +
    `<path d="M${w * 0.1} ${h * 0.95} L ${w * 0.4} ${h * 0.5} L ${w * 0.7} ${h * 0.95}Z" fill="#f59e0b"/>` +
    `<circle cx="${w * 0.74}" cy="${h * 0.7}" r="${h * 0.17}" fill="#5b4cf0"/><rect x="${w * 0.06}" y="${h * 0.72}" width="${w * 0.88}" height="${h * 0.035}" fill="#111827"/>`),
  waves: (w, h) => svgDoc(w, h,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    [0.45, 0.58, 0.7, 0.82].map((y, i) => `<path d="M0 ${h * y} Q ${w * 0.25} ${h * (y - 0.12)} ${w * 0.5} ${h * y} T ${w} ${h * y} V ${h} H0Z" fill="#fff" opacity="${0.12 + i * 0.07}"/>`).join(''),
    grad('g', [[0, '#5b4cf0'], [1, '#c026d3']], false)),
  spot: (w, h) => svgDoc(w, h,
    `<rect width="${w}" height="${h}" fill="#0b1020"/><polygon points="${w * 0.3},0 ${w * 0.7},0 ${w * 0.95},${h} ${w * 0.05},${h}" fill="url(#b)" opacity=".7"/>` +
    `<ellipse cx="${w / 2}" cy="${h * 0.95}" rx="${w * 0.42}" ry="${h * 0.12}" fill="#fde68a" opacity=".35"/>` +
    Array.from({ length: 14 }, (_, i) => `<circle cx="${(i + 0.5) * (w / 14)}" cy="${h * (0.92 + (i % 3) * 0.02)}" r="${h * 0.05}" fill="#05070f"/>`).join(''),
    '<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a" stop-opacity=".95"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></linearGradient>'),
  pastel: (w, h) => svgDoc(w, h,
    `<rect width="${w}" height="${h}" fill="#ecfeff"/><circle cx="${w * 0.25}" cy="${h * 0.4}" r="${h * 0.3}" fill="#a5f3fc"/><circle cx="${w * 0.62}" cy="${h * 0.62}" r="${h * 0.34}" fill="#fbcfe8"/>` +
    `<circle cx="${w * 0.82}" cy="${h * 0.25}" r="${h * 0.18}" fill="#fde68a"/><rect x="0" y="${h * 0.86}" width="${w}" height="${h * 0.14}" fill="#0e7490" opacity=".85"/>`),
}
function art(kind, w = 1200, h = 800) {
  const id = uid('a')
  return { id, name: `${kind}.svg`, type: 'image/svg+xml', w, h, blob: new Blob([ART[kind](w, h)], { type: 'image/svg+xml' }) }
}

// ---------- Builders ----------
const p = (text, ps = 'body', o = {}) => ({ ps, o, runs: [{ t: text }] })
const rich = (ps, o, ...parts) => ({ ps, o, runs: parts.map((x) => (typeof x === 'string' ? { t: x } : x)) })
const B = (t) => ({ t, b: true })
const label = (text, o = {}) => ({ ps: 'caption', o: { size: 8.5, weight: 700, caps: true, tracking: 160, ...o }, runs: [{ t: text }] })
function restyle(doc, patch) {
  for (const [id, v] of Object.entries(patch)) {
    const s = doc.styles.para.find((x) => x.id === id)
    if (s) Object.assign(s, v)
  }
}
const rect = (doc, c, x, y, w, h, fill, props = {}) => addShape(doc, c, 'rect', { x, y, w, h }, { fill, ...props })
const ell = (doc, c, x, y, w, h, fill, props = {}) => addShape(doc, c, 'ellipse', { x, y, w, h }, { fill, ...props })
const line = (doc, c, x, y, w, stroke, sw = 1, props = {}) => addShape(doc, c, 'line', { x, y, w, h: 0 }, { stroke, sw, ...props })
const text = (doc, c, x, y, w, h, paras, props) => addText(doc, c, { x, y, w, h }, paras, props)
function image(doc, c, assets, kind, x, y, w, h, props = {}) {
  const a = art(kind, Math.round(Math.max(w, 400) * 3), Math.round(Math.max(h, 270) * 3))
  assets.push(a)
  return addShape(doc, c, 'image', { x, y, w, h }, { asset: a.id, ...props })
}

const LOREM = [
  'Every Saturday morning the empty lot behind Mill Lane used to collect litter and weeds. This spring forty neighbours decided to change that, arriving with spades, wheelbarrows and a shared flask of tea. By lunchtime the first raised beds were standing in neat rows.',
  'The project began with a simple question on the street noticeboard: what would you grow if the land was yours? Replies came in the hundreds. Tomatoes and beans topped the list, followed by sunflowers, herbs for the corner cafe and a long wish list of strawberries.',
  'Local carpenter Priya Nair donated offcuts from a shop refit and showed volunteers how to build a bed in under an hour. Children painted the boards in bright colours, and a retired teacher labelled every plant so that visitors can learn as they wander.',
  'Water was the biggest worry, so the group installed a rain barrel network fed by the nearby community hall roof. On a wet week the barrels fill in a single afternoon, and the volunteers say the plants have never looked healthier.',
  'The garden is now open every day from sunrise to sunset. Anyone is welcome to pick a handful of herbs, sit on a bench or join the Saturday session. New volunteers receive a pair of gloves and a mug, and nobody is ever asked to work harder than they would like.',
  'Next on the list is a small greenhouse for seedlings, a compost corner and a weekly swap table where spare produce, jars and seeds change hands. Organisers hope to host a harvest supper in September and invite every household on the street.',
  'If you would like to help, bring a trowel, a friend or simply your curiosity. The team meets at the gate at nine, and the kettle is always on. Donations of tools, pots and good stories are gratefully received at the community hall.',
  'Looking back over the first season, the volunteers agree that the vegetables are only half of the harvest. The real crop is the conversations that now happen over the fence, the doorstep deliveries of surplus beans and the sense that this street belongs to the people who live on it.',
]

// ---------- Templates ----------
function flyer() {
  const doc = newDoc({ w: 612, h: 792, bleed: 9, margin: 40, name: 'Summer Night Market flyer', unit: 'in' })
  restyle(doc, { title: { size: 70, lh: 0.98, color: '#ffffff' }, lead: { size: 14, color: '#cbd5e1', lh: 1.5 }, body: { size: 10.5, color: '#cbd5e1' }, h2: { size: 13, color: '#ffffff' }, bullets: { color: '#e2e8f0', size: 10.5 } })
  const c = doc.pages[0], assets = []
  rect(doc, c, -9, -9, 630, 810, '#0b1020', { locked: true })
  image(doc, c, assets, 'sunset', -9, -9, 630, 420)
  ell(doc, c, 380, 130, 260, 260, '#5b4cf0', { opacity: 0.35 })
  text(doc, c, 40, 46, 420, 16, [label('Free entry  |  Food  |  Music  |  Makers', { color: '#fde68a' })])
  text(doc, c, 40, 78, 460, 230, [rich('title', {}, 'Summer\nNight\nMarket')])
  text(doc, c, 40, 440, 330, 86, [p('Food stalls, live music and eighty local makers under the lights. Come hungry, stay for the sunset set.', 'lead')])
  text(doc, c, 410, 436, 162, 150, [label('When', { color: '#fbbf24' }), rich('body', { color: '#ffffff', size: 12 }, B('Sat 12 July, 4 to 11 pm')), label('Where', { color: '#fbbf24' }), rich('body', { color: '#ffffff', size: 12 }, B('Riverside Park, 5 Mill Lane')), label('Tickets', { color: '#fbbf24' }), rich('body', { color: '#ffffff', size: 12 }, B('Free, no booking'))])
  text(doc, c, 40, 540, 340, 130, [p('What to expect', 'h2'), p('Thirty street food kitchens from five continents', 'bullets'), p('Three live stages with local bands and DJs', 'bullets'), p('Handmade goods, plants and vintage finds', 'bullets'), p('Kids corner, quiet space and free water points', 'bullets')])
  rect(doc, c, 40, 692, 532, 54, '#5b4cf0', { radius: 14 })
  text(doc, c, 52, 706, 508, 28, [{ ps: 'h2', o: { align: 'center', size: 15, color: '#ffffff' }, runs: [{ t: 'Bring a friend. Dogs welcome. Rain or shine.' }] }])
  text(doc, c, 40, 756, 532, 14, [p('nightmarket.example  |  @summernights  |  Step-free access and quiet hours from 4 pm', 'caption', { color: '#94a3b8', align: 'center' })])
  return { doc, assets }
}

function brochure() {
  const doc = newDoc({ w: 792, h: 612, bleed: 9, margin: 28, cols: 3, gutter: 56, pages: 2, name: 'Harbor Tours brochure', unit: 'in' })
  restyle(doc, { title: { font: 'playfair-display', size: 40, lh: 1.05, color: '#ffffff' }, h1: { size: 20, color: '#0c4a6e' }, h2: { size: 12.5, color: '#0c4a6e' }, body: { size: 9.5, color: '#334155' }, lead: { size: 11, color: '#e0f2fe' } })
  const [outside, inside] = doc.pages, assets = []
  const P = 264
  // Outside: contact panel | back cover | front cover
  rect(doc, outside, -9, -9, 810, 630, '#f0f9ff', { locked: true })
  rect(doc, outside, 2 * P, -9, P + 9 + 9, 630, '#0c4a6e', { locked: true })
  image(doc, outside, assets, 'mountains', 2 * P + 28, 250, P - 56, 190, { radius: 12 })
  text(doc, outside, 2 * P + 28, 56, P - 56, 14, [label('Harbor Tours', { color: '#7dd3fc' })])
  text(doc, outside, 2 * P + 28, 80, P - 56, 150, [p('See the coast the slow way', 'title', { size: 34 })])
  text(doc, outside, 2 * P + 28, 462, P - 56, 80, [p('Small group boat tours, kayak trips and sunset cruises from the old harbour.', 'lead')])
  text(doc, outside, P + 28, 56, P - 56, 480, [p('Why guests love us', 'h1'), p('Skippers who grew up on this coast', 'bullets'), p('Never more than twelve people per boat', 'bullets'), p('Warm blankets, hot drinks and binoculars on board', 'bullets'), p('Free cancellation up to 24 hours before departure', 'bullets'), p('Our promise', 'h2', { before: 14 }), p('If the weather stops us sailing, we rebook you for another day or refund you in full. No forms, no fuss.', 'body')])
  text(doc, outside, 28, 56, P - 56, 480, [p('Plan your visit', 'h1'), p('Old Harbour Quay, Pier 4', 'h2'), p('Open daily 9 am to 6 pm in season. Free parking at the quay for guests.', 'body'), p('Book ahead', 'h2', { before: 12 }), p('harbortours.example', 'body'), p('+44 1632 960 123', 'body'), p('hello@harbortours.example', 'body')])
  image(doc, outside, assets, 'waves', P + 28, 372, P - 56, 160, { radius: 12 })
  image(doc, outside, assets, 'sunset', 28, 372, P - 56, 160, { radius: 12 })
  // Inside: three panels
  rect(doc, inside, -9, -9, 810, 630, '#ffffff', { locked: true })
  const heads = [['Morning cruise', 'Two hours along the cliffs with a guide who points out seals, puffins and the odd dolphin. Tea and pastries included.', 'waves'], ['Kayak and picnic', 'Paddle into the quiet coves in a small group, then eat on a pebble beach. Equipment and a lesson are included.', 'pastel'], ['Sunset sail', 'A golden hour trip under sail with local music, blankets and a glass of something sparkling for adults.', 'sunset']]
  heads.forEach(([h, t, kind], i) => {
    const x = i * P + 28
    image(doc, inside, assets, kind, x, 44, P - 56, 190, { radius: 12 })
    text(doc, inside, x, 252, P - 56, 28, [p(h, 'h1')])
    text(doc, inside, x, 286, P - 56, 150, [p(t, 'body')])
    rect(doc, inside, x, 456, P - 56, 40, '#0ea5e9', { radius: 10 })
    text(doc, inside, x, 466, P - 56, 22, [{ ps: 'h2', o: { align: 'center', color: '#ffffff', size: 11 }, runs: [{ t: ['From 29 pounds', 'From 45 pounds', 'From 55 pounds'][i] }] }])
  })
  return { doc, assets }
}

function newsletter() {
  const doc = newDoc({ w: 595.28, h: 841.89, bleed: 0, margin: 42, cols: 2, gutter: 18, pages: 2, name: 'The Weekly Fold newsletter', unit: 'mm' })
  restyle(doc, { title: { size: 44, color: '#ffffff' }, h1: { font: 'playfair-display', size: 26, lh: 1.12, weight: 700 }, body: { font: 'merriweather', size: 9, lh: 1.6, after: 7, color: '#2b2f3a' }, lead: { font: 'merriweather', size: 11.5, lh: 1.55, color: '#444b5a' } })
  const assets = []
  const m = doc.masters[0]
  line(doc, m, 42, 34, 511, '#cbd5e1', 0.75)
  text(doc, m, 42, 18, 300, 12, [label('The Weekly Fold  |  Neighbourhood news', { color: '#64748b' })])
  text(doc, m, 353, 18, 200, 12, [{ ps: 'caption', o: { align: 'right', size: 8.5, color: '#64748b', weight: 600 }, runs: [{ t: 'Issue 24  |  Summer' }] }])
  line(doc, m, 42, 800, 511, '#cbd5e1', 0.75)
  text(doc, m, 42, 806, 300, 12, [p('{title}', 'caption')])
  text(doc, m, 353, 806, 200, 12, [{ ps: 'caption', o: { align: 'right', weight: 700 }, runs: [{ t: 'Page {#} of {total}' }] }])
  const [p1, p2] = doc.pages
  rect(doc, p1, 42, 48, 511, 110, '#111827', { radius: 6 })
  text(doc, p1, 62, 62, 470, 56, [p('The Weekly Fold', 'title', { size: 46 })])
  text(doc, p1, 62, 122, 470, 24, [label('Stories from the street, delivered every week', { color: '#fbbf24' })])
  text(doc, p1, 42, 176, 335, 84, [p('Neighbours turn an empty lot into a thriving community garden', 'h1', { size: 24 })])
  text(doc, p1, 42, 262, 335, 48, [p('How forty volunteers and a borrowed wheelbarrow changed Mill Lane in a single season.', 'lead', { size: 10.5 })])
  image(doc, p1, assets, 'pastel', 392, 176, 161, 112, { radius: 6 })
  text(doc, p1, 392, 290, 161, 24, [p('Volunteers at the first planting day on Mill Lane.', 'caption')])
  const a = text(doc, p1, 42, 326, 511, 290, LOREM.map((t, i) => (i === 0 ? rich('body', {}, B('Mill Lane. '), t) : p(t))), { cols: 2, gap: 18 })
  const b = text(doc, p2, 42, 50, 511, 400, [], { cols: 2, gap: 18 })
  const spare = b.story
  a.next = b.id
  b.story = a.story
  delete doc.stories[spare]
  rect(doc, p1, 42, 636, 511, 138, '#f1f5f9', { radius: 8 })
  text(doc, p1, 62, 654, 230, 110, [p('In this issue', 'h2'), p('Garden workday, Saturdays at 9. Repair cafe, first Sunday of the month. Harvest supper on 14 September in the hall.', 'body', { size: 9 })])
  text(doc, p1, 312, 654, 220, 110, [p('Good things grow where people gather.', 'quote', { size: 18 })])
  rect(doc, p2, 42, 596, 511, 176, '#f1f5f9', { radius: 8 })
  text(doc, p2, 62, 614, 230, 140, [p('Community diary', 'h2'), p('Garden workday, Saturdays at 9. Repair cafe, first Sunday of the month. Harvest supper, 14 September in the hall. Book club meets Tuesdays at the library.', 'body', { size: 9 })])
  text(doc, p2, 312, 614, 220, 140, [p('Good things grow where people gather. Plant something and invite a neighbour.', 'quote', { size: 17 })])
  return { doc, assets }
}

function poster() {
  const doc = newDoc({ w: 792, h: 1224, bleed: 9, margin: 48, name: 'Design Week poster', unit: 'in' })
  restyle(doc, { title: { font: 'bebas-neue', size: 190, lh: 0.88, weight: 400, color: '#ffffff' }, h1: { font: 'bebas-neue', size: 46, weight: 400, color: '#f59e0b', lh: 1 }, body: { size: 13, color: '#e2e8f0', lh: 1.5 } })
  const c = doc.pages[0], assets = []
  rect(doc, c, -9, -9, 810, 1242, '#0f172a', { locked: true })
  image(doc, c, assets, 'geo', 48, 430, 696, 470, { radius: 18 })
  text(doc, c, 48, 56, 696, 380, [p('Design\nWeek', 'title')])
  text(doc, c, 468, 56, 276, 80, [{ ps: 'h1', o: { align: 'right', size: 64 }, runs: [{ t: '2026' }] }])
  line(doc, c, 48, 930, 696, '#334155', 1.5)
  const cols = [['Dates', '4 to 11 October'], ['Venue', 'The Old Foundry, Mill Street'], ['Entry', 'Free for everyone']]
  cols.forEach(([k, v], i) => {
    text(doc, c, 48 + i * 238, 952, 220, 90, [label(k, { color: '#f59e0b', size: 10 }), p(v, 'h2', { color: '#ffffff', size: 18, lh: 1.25, font: 'playfair-display' })])
  })
  text(doc, c, 48, 1070, 520, 70, [p('Talks, studio visits, workshops and a print fair across the city. Pick up the full programme at any venue.', 'body')])
  rect(doc, c, 548, 1076, 196, 54, '#f59e0b', { radius: 27 })
  text(doc, c, 548, 1090, 196, 28, [{ ps: 'h2', o: { align: 'center', color: '#0f172a', size: 14, weight: 700 }, runs: [{ t: 'designweek.example' }] }])
  return { doc, assets }
}

function businessCard() {
  const doc = newDoc({ w: 252, h: 144, bleed: 9, margin: 16, pages: 2, name: 'Business card', unit: 'mm' })
  restyle(doc, { h1: { font: 'playfair-display', size: 20, lh: 1.1, weight: 700, color: '#ffffff', before: 0, after: 2 }, caption: { size: 7, color: '#94a3b8', after: 1 }, body: { size: 7.5, color: '#e2e8f0', after: 1.5, lh: 1.4 } })
  const [front, back] = doc.pages
  rect(doc, front, -9, -9, 270, 162, '#0f172a', { locked: true })
  rect(doc, front, -9, -9, 10, 162, '#5b4cf0', { locked: true })
  ell(doc, front, 176, 22, 58, 58, '#5b4cf0')
  ell(doc, front, 196, 40, 42, 42, '#c026d3', { opacity: 0.85 })
  text(doc, front, 22, 22, 150, 56, [p('Maya Rao', 'h1'), label('Brand and packaging designer', { color: '#a5b4fc', size: 6.5 })])
  text(doc, front, 22, 86, 190, 44, [p('maya@studiorao.example', 'body'), p('+44 1632 960 321', 'body'), p('studiorao.example  |  12 Mill Street', 'body')])
  rect(doc, back, -9, -9, 270, 162, '#5b4cf0', { locked: true })
  ell(doc, back, 160, -40, 140, 140, '#c026d3', { opacity: 0.5 })
  text(doc, back, 20, 48, 212, 30, [{ ps: 'h1', o: { size: 22 }, runs: [{ t: 'Studio Rao' }] }])
  text(doc, back, 20, 80, 212, 18, [label('Identity  |  Packaging  |  Print', { color: '#e0e7ff', size: 7 })])
  return { doc, assets: [] }
}

function blank() {
  return { doc: newDoc({ margin: 56, name: 'Untitled layout' }), assets: [] }
}

export const TEMPLATES = [
  { id: 'blank', name: 'Blank A4', size: 'A4, 20 mm margins', desc: 'An empty page to build on.', make: blank },
  { id: 'flyer', name: 'Event flyer', size: 'US Letter, bleed', desc: 'Bold header art, details and a call to action.', make: flyer },
  { id: 'brochure', name: 'Tri-fold brochure', size: 'Letter landscape, 2 sides', desc: 'Three panels per side with images and prices.', make: brochure },
  { id: 'newsletter', name: 'Newsletter', size: 'A4, 2 pages, 2 columns', desc: 'Masthead, master page numbers and threaded story text.', make: newsletter },
  { id: 'poster', name: 'Poster', size: 'Tabloid, bleed', desc: 'Huge headline, artwork and event details.', make: poster },
  { id: 'business-card', name: 'Business card', size: '3.5 x 2 in, front and back', desc: 'Two-sided card with bleed.', make: businessCard },
]
export const makeTemplate = (id) => (TEMPLATES.find((t) => t.id === id) || TEMPLATES[0]).make()
export { art }
