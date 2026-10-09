// Lorem ipsum generator: paragraphs, sentences or words, three flavours (classic Latin, startup buzzwords, Hindi), text, HTML or Markdown.
// generate(options) is pure and exported for tests. A seeded generator keeps the text stable while you change options.
import { h, button } from '../../lib/ui.js'
import { root, dock, group, chips, ribbon, pane, area, createOptions, copyBtn, saveText, plural, flash, injectStyle } from './_shared.js'

const LATIN = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt lacus nunc gravida augue vestibulum ante primis faucibus orci luctus ultrices posuere cubilia curae donec tellus eget mauris iaculis porta ultricies pharetra volutpat ornare viverra mollis risus nam libero justo laoreet cursus dictum quisque aliquam erat volutpat maecenas feugiat sollicitudin pulvinar suspendisse potenti integer'.split(' ')
const BUZZ = 'agile synergy roadmap stakeholder deliverable bandwidth leverage scalable pipeline workflow dashboard insight alignment ecosystem innovation framework milestone sprint backlog iteration onboarding retention growth funnel metric benchmark paradigm strategy initiative cadence touchpoint robust seamless streamline optimize pivot disrupt platform vertical horizon holistic granular actionable proactive mindset ownership velocity outcome playbook runway traction unlock empower the our your with for and across into through every quickly together'.split(' ')
const HINDI = 'भारत देश संस्कृति परंपरा विचार जीवन समय लोग शहर गाँव नदी पहाड़ पुस्तक शिक्षा ज्ञान विज्ञान कला संगीत भाषा शब्द अर्थ कहानी यात्रा मित्र परिवार घर बाजार खेल स्वास्थ्य सुबह शाम रात दिन मौसम बारिश धूप हवा पानी फूल पेड़ पक्षी आकाश सूरज चाँद तारे सपना आशा विश्वास सफलता मेहनत सरलता सुंदर नया पुराना बड़ा छोटा अच्छा तेज़ धीरे साथ और या लेकिन क्योंकि इसलिए हर कोई सबसे बहुत हमेशा कभी-कभी यहाँ वहाँ'.split(' ')
const VOCAB = { latin: LATIN, buzz: BUZZ, hindi: HINDI }
const LEAD = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit'

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** generate({unit: 'paragraphs'|'sentences'|'words'|'list', count, flavor, classic, format: 'text'|'html'|'md', seed}) -> {text, paragraphs: string[], words} */
export function generate(o) {
  const rnd = mulberry32(o.seed || 1)
  const vocab = VOCAB[o.flavor] || LATIN
  const hindi = o.flavor === 'hindi'
  const end = hindi ? '\u{964}' : '.'
  const pick = () => vocab[Math.floor(rnd() * vocab.length)]
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  let leadUsed = false
  const sentence = () => {
    const lead = o.classic && o.flavor === 'latin' && !leadUsed
    if (lead) leadUsed = true
    const n = lead ? between(4, 8) : between(6, 16)
    const ws = []
    while (ws.length < n) { const w = pick(); if (w !== ws[ws.length - 1]) ws.push(w) }
    let out = ''
    ws.forEach((w, i) => {
      out += (i ? ' ' : '') + w
      if (ws.length - i - 1 > 2 && i >= 2 && rnd() < 0.14) out += ','
    })
    if (lead) return `${LEAD}, ${out}${end}`
    return (hindi ? out : out[0].toUpperCase() + out.slice(1)) + end
  }
  const paragraph = () => Array.from({ length: between(3, 7) }, sentence).join(' ')
  const count = Math.max(1, Math.floor(o.count) || 1)
  let paras = []
  if (o.unit === 'paragraphs' || o.unit === 'list') paras = Array.from({ length: Math.min(count, 500) }, paragraph)
  else if (o.unit === 'sentences') paras = [Array.from({ length: Math.min(count, 2000) }, sentence).join(' ')]
  else {
    const total = Math.min(count, 20000)
    const ws = []
    if (o.classic && o.flavor === 'latin') ws.push(...'lorem ipsum dolor sit amet consectetur adipiscing elit'.split(' '))
    while (ws.length < total) ws.push(pick())
    let t = ws.slice(0, total).join(' ')
    if (!hindi) t = t[0].toUpperCase() + t.slice(1)
    paras = [t]
  }
  const words = paras.join(' ').split(/\s+/).filter(Boolean).length
  let text
  if (o.format === 'html') text = o.unit === 'list' ? `<ul>\n${paras.map((p) => `  <li>${p}</li>`).join('\n')}\n</ul>` : paras.map((p) => `<p>${p}</p>`).join('\n')
  else if (o.format === 'md') text = o.unit === 'list' ? paras.map((p) => `- ${p}`).join('\n') : paras.join('\n\n')
  else text = o.unit === 'list' ? paras.map((p) => `\u{2022} ${p}`).join('\n') : paras.join('\n\n')
  return { text, paragraphs: paras, words }
}

const CSS = `
.tu-sheet { font: 16px/1.75 Georgia, "Times New Roman", serif; padding: 22px 24px 26px; max-height: 520px; overflow: auto; color: var(--text-2); }
.tu-sheet p { margin: 0 0 1em; text-wrap: pretty; animation: tu-rise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 50ms); }
.tu-sheet p:first-child::first-letter { float: left; font-size: 3.1em; line-height: .9; padding: 4px 8px 0 0; font-weight: 700; color: var(--accent); }
.tu-sheet.dev p:first-child::first-letter { float: none; font-size: inherit; padding: 0; color: inherit; font-weight: inherit; }
.tu-sheet ul { padding-left: 1.2em; margin: 0; } .tu-sheet li { margin-bottom: .6em; }
.tu-sheet.hindi { font-family: var(--font); line-height: 1.9; }
`

export function mount(rootEl, { tool }) {
  injectStyle()
  if (!document.getElementById('tu-li-style')) document.head.append(h('style', { id: 'tu-li-style' }, CSS))
  const o = createOptions(tool.id, { unit: 'paragraphs', count: 3, flavor: 'latin', classic: true, format: 'text' })
  let seed = (Math.random() * 2 ** 31) | 0
  let latest = ''
  const rib = ribbon()
  const out = area({ readonly: true, short: false, 'aria-label': 'Generated text' })
  const sheet = h('div', { class: 'tu-sheet', 'aria-label': 'Preview' })
  const foot = h('div', { class: 'tu-foot' }, h('span'), h('span'))
  const ext = () => ({ text: 'txt', html: 'html', md: 'md' }[o.v.format])
  const outPane = pane({
    title: 'Generated text', out: true, body: out, foot,
    actions: [button('', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: 'Download', onClick: () => latest && saveText(latest, `lorem-ipsum.${ext()}`, 'text/plain;charset=utf-8') }), copyBtn(() => latest, 'Copy')],
  })
  const prevPane = pane({ title: 'Preview', body: sheet })

  const unitLabel = { paragraphs: 'Paragraphs', sentences: 'Sentences', words: 'Words', list: 'List items' }
  const maxFor = () => ({ paragraphs: 200, sentences: 1000, words: 10000, list: 200 }[o.v.unit])
  function refresh() {
    const count = Math.min(o.v.count, maxFor())
    const r = generate({ ...o.v, count, seed })
    latest = r.text
    out.value = r.text
    out.classList.toggle('mono', o.v.format !== 'text')
    sheet.className = `tu-sheet${o.v.flavor === 'hindi' ? ' hindi' : ''}`
    sheet.replaceChildren(...(o.v.unit === 'list'
      ? [h('ul', r.paragraphs.slice(0, 12).map((p) => h('li', p)))]
      : r.paragraphs.slice(0, 12).map((p, i) => h('p', { style: { '--i': i } }, p))))
    if (r.paragraphs.length > 12) sheet.append(h('p', { class: 'tu-hint' }, `Showing 12 of ${r.paragraphs.length}. The text box has everything.`))
    flash(outPane)
    rib.set([
      { label: r.paragraphs.length === 1 ? 'paragraph' : 'paragraphs', value: r.paragraphs.length, tone: 'accent' },
      { label: 'words', value: r.words }, { label: 'characters', value: [...r.text].length },
    ], count < o.v.count ? `Capped at ${maxFor().toLocaleString()} ${unitLabel[o.v.unit].toLowerCase()}.` : '')
    foot.firstChild.textContent = `${plural([...r.text].length, 'character')}`
  }
  const countIn = o.num('count', { min: 1, max: 10000, cls: 'narrow', ariaLabel: 'How many' })
  const controls = dock(
    group('Make', o.pills('unit', Object.entries(unitLabel), 'What to make')),
    group('How many', countIn, h('div', { class: 'tu-quick' }, [1, 3, 5, 10, 25].map((n) => h('button', { type: 'button', onclick: () => o.set({ count: n }) }, String(n))))),
    group('Flavour', o.select('flavor', [['latin', 'Classic Latin'], ['buzz', 'Startup buzzwords'], ['hindi', 'Hindi (Devanagari)']], 'Flavour')),
    group('Format', o.select('format', [['text', 'Plain text'], ['html', 'HTML'], ['md', 'Markdown']], 'Output format')),
    group('Options', chips(o.bool('classic', 'Start with "Lorem ipsum dolor sit amet"'))),
    group('', button('New text', { icon: 'refresh-cw', variant: 'secondary', size: 'sm', onClick: () => { seed = (Math.random() * 2 ** 31) | 0; refresh() } })))
  o.onChange = refresh
  rootEl.append(root(controls, rib.el, h('div', { class: 'tu-panes' }, outPane, prevPane)))
  refresh()
}
