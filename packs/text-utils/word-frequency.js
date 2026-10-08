// Word frequency: top words and 2-3 word phrases with an optional stop-word filter, a table with bars, a word cloud and CSV export.
// analyze(text, options) is pure and exported for tests.
import { h, button, copyText } from '../../lib/ui.js'
import {
  root, dock, group, chips, ribbon, pane, area, createOptions, copyBtn, inputActions, acceptFiles, saveText, plural, injectStyle, flash, tooBig,
} from './_shared.js'

const EN_STOP = ('a about above after again against all also am an and any are aren\'t as at be because been before being below between both but by can can\'t cannot could couldn\'t did didn\'t do does doesn\'t doing don\'t down during each few for from further get got had hadn\'t has hasn\'t have haven\'t having he he\'d he\'ll he\'s her here here\'s hers herself him himself his how how\'s i i\'d i\'ll i\'m i\'ve if in into is isn\'t it it\'s its itself just let\'s me more most mustn\'t my myself no nor not of off on once only or other ought our ours ourselves out over own same shan\'t she she\'d she\'ll she\'s should shouldn\'t so some such than that that\'s the their theirs them themselves then there there\'s these they they\'d they\'ll they\'re they\'ve this those through to too under until up us very was wasn\'t we we\'d we\'ll we\'re we\'ve were weren\'t what what\'s when when\'s where where\'s which while who who\'s whom why why\'s will with won\'t would wouldn\'t you you\'d you\'ll you\'re you\'ve your yours yourself yourselves').split(' ')
const HI_STOP = ('की का के को से में पर है हैं था थे थी और या कि यह ये वह वे एक भी तो ही नहीं इस उस कर करने करना लिए साथ जो कुछ हम तुम आप मैं मुझे मेरा मेरी मेरे तुम्हारा उनके उनकी उनका अपने अपना अपनी क्या कौन कब कहाँ क्यों कैसे बहुत सब अगर लेकिन परंतु तथा होता होती होते हो गया गई गए रहा रही रहे सकता सकती सकते वाला वाली वाले ' +
  'hai hain ka ki ke ko se mein me par aur ya yeh ye woh wo tha thi the nahi nahin bhi to toh hi kya kuch mera meri mere tera teri tere hum tum aap main mai jo jab tab agar lekin ek is us kar karna raha rahi rahe hota hoti hote hua hui hue') .split(' ')

export const STOP_SETS = { none: new Set(), en: new Set(EN_STOP), hi: new Set(HI_STOP), both: new Set([...EN_STOP, ...HI_STOP]) }

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['\u{2019}-][\p{L}\p{M}\p{N}]+)*/gu
const BREAK_RE = /[.!?;:,()[\]{}"\u{201c}\u{201d}\u{2014}\u{2013}\u{2026}|\u{964}\n\r]+/u

/** analyze(text, {mode: 1|2|3, stop: 'none'|'en'|'hi'|'both', minLen, minCount, numbers, caseSensitive}) */
export function analyze(text, o) {
  const n = Number(o.mode)
  const stop = STOP_SETS[o.stop] || STOP_SETS.none
  const norm = (w) => (o.caseSensitive ? w : w.toLocaleLowerCase())
  const isStop = (w) => stop.has(w.toLocaleLowerCase().replace(/\u{2019}/gu, "'"))
  let totalWords = 0
  const all = new Set()
  const counts = new Map()
  const first = new Map()
  let order = 0
  for (const seg of text.split(BREAK_RE)) {
    const toks = (seg.match(WORD_RE) || [])
    totalWords += toks.length
    for (const t of toks) all.add(norm(t))
    if (toks.length < n) continue
    for (let i = 0; i + n <= toks.length; i++) {
      const gram = toks.slice(i, i + n)
      if (n === 1) {
        const w = gram[0]
        if (isStop(w)) continue
        if (!o.numbers && /^\p{N}+$/u.test(w)) continue
        if ([...w].length < o.minLen) continue
      } else if (isStop(gram[0]) || isStop(gram[n - 1])) continue
      const key = gram.map(norm).join(' ')
      counts.set(key, (counts.get(key) || 0) + 1)
      if (!first.has(key)) first.set(key, order++)
    }
  }
  const floor = n === 1 ? o.minCount : Math.max(2, o.minCount)
  const rows = [...counts.entries()].filter(([, c]) => c >= floor)
    .sort((a, b) => b[1] - a[1] || first.get(a[0]) - first.get(b[0]))
    .map(([term, count], i) => ({ rank: i + 1, term, count, pct: totalWords ? (count * n * 100) / totalWords : 0 }))
  return { rows, totalWords, unique: all.size, distinct: counts.size, hiddenOnce: n > 1 ? [...counts.values()].filter((c) => c < floor).length : 0 }
}

export const toCsv = (rows) => ['Rank,Term,Count,Density %', ...rows.map((r) => `${r.rank},"${r.term.replace(/"/g, '""')}",${r.count},${r.pct.toFixed(2)}`)].join('\r\n')

const CSS = `
.tu-wf-list { display: flex; flex-direction: column; padding: 2px 8px 8px; max-height: 560px; overflow: auto; }
.tu-wf-row { display: grid; grid-template-columns: 30px minmax(0, 1.2fr) minmax(40px, 1fr) 46px 54px; gap: 10px; align-items: center; padding: 7px 8px; border-radius: 12px; font-size: 14px; cursor: pointer; transition: background .2s; }
.tu-wf-row:hover { background: var(--surface-2); }
.tu-wf-row .rk { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
.tu-wf-row .w { font-weight: 560; overflow-wrap: anywhere; }
.tu-wf-row .n, .tu-wf-row .pc { text-align: right; font-variant-numeric: tabular-nums; }
.tu-wf-row .pc { color: var(--muted); font-size: 12.5px; }
.tu-wf-row .tu-bar > i { transform-origin: left; animation-delay: calc(var(--i, 0) * 28ms); }
.tu-cloud { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; justify-content: center; padding: 18px 16px 22px; max-height: 560px; overflow: auto; line-height: 1.15; }
.tu-cloud button { border: 0; background: transparent; cursor: pointer; font-family: inherit; font-weight: 600; letter-spacing: -.02em; padding: 2px 4px; border-radius: 10px; transition: transform .25s var(--spring), background .2s; animation: tu-pop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 22ms); }
.tu-cloud button:hover { transform: scale(1.12) rotate(-2deg); background: var(--surface-2); }
.tu-wf-empty { padding: 36px 16px; text-align: center; color: var(--muted); }
@media (max-width: 720px) { .tu-wf-row { grid-template-columns: 24px minmax(0, 1fr) 40px 50px; } .tu-wf-row .tu-bar { display: none; } }
`

const SAMPLE = 'Good data tools save time. A good data pipeline moves data from many sources into one place, and a good dashboard turns that data into decisions.\nTeams that trust their data make faster decisions. Without a reliable data pipeline, teams spend hours cleaning data instead of making decisions.\nThe best data tools are simple, fast and easy to share. Simple tools get used; complicated tools get ignored. A simple dashboard beats a complicated report every time.'

export function mount(rootEl, { tool }) {
  injectStyle()
  if (!document.getElementById('tu-wf-style')) document.head.append(h('style', { id: 'tu-wf-style' }, CSS))
  const o = createOptions(tool.id, { mode: 1, stop: 'en', minLen: 2, minCount: 1, numbers: false, caseSensitive: false, top: '25', view: 'table' })
  const input = area({ placeholder: 'Type or paste your text here...', 'aria-label': 'Text to analyse' })
  const rib = ribbon()
  const inFoot = h('div', { class: 'tu-foot' }, h('span', 'Nothing yet'), h('span'))
  const body = h('div')
  const outFoot = h('div', { class: 'tu-foot' }, h('span'), h('span'))
  let rows = []
  const viewBtns = h('div', { class: 'tu-tabs', role: 'group', 'aria-label': 'View' })
  const mkView = (id, label) => h('button', { type: 'button', 'aria-pressed': String(o.v.view === id), onclick: () => { o.set({ view: id }) } }, label)
  const vTable = mkView('table', 'Table'), vCloud = mkView('cloud', 'Cloud')
  viewBtns.append(vTable, vCloud)
  const csv = () => toCsv(rows)

  const inPane = pane({ title: 'Your text', body: input, foot: inFoot, actions: inputActions({ ta: input, sample: SAMPLE, onChange: () => refresh() }) })
  const outPane = pane({
    title: 'Most used', out: true, body, foot: outFoot,
    actions: [viewBtns, copyBtn(csv, 'CSV'), button('', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: 'Download as a CSV file', onClick: () => { if (rows.length) saveText(csv(), 'word-frequency.csv', 'text/csv;charset=utf-8') } })],
  })
  acceptFiles(inPane, (t) => { input.value = t; refresh() })

  const controls = dock(
    group('Count', o.pills('mode', [[1, 'Words'], [2, '2-word phrases'], [3, '3-word phrases']], 'What to count')),
    group('Skip common words', o.select('stop', [['en', 'English'], ['hi', 'Hindi'], ['both', 'English + Hindi'], ['none', 'Keep everything']], 'Stop words')),
    group('Show', o.select('top', [[10, 'Top 10'], [25, 'Top 25'], [50, 'Top 50'], [100, 'Top 100'], [500, 'Top 500']].map(([v, l]) => [String(v), l]), 'How many')),
    group('Shortest word', o.num('minLen', { min: 1, max: 20 })),
    group('Appears at least', o.num('minCount', { min: 1, max: 999 })),
    group('Options', chips(o.bool('numbers', 'Count numbers'), o.bool('caseSensitive', 'Case sensitive'))))

  function render(r, text) {
    const top = Number(o.v.top) || 25
    rows = r.rows
    const shown = rows.slice(0, top)
    if (!text.trim()) {
      body.replaceChildren(h('div', { class: 'tu-wf-empty' }, 'Paste some text to see its most used words.'))
    } else if (!shown.length) {
      body.replaceChildren(h('div', { class: 'tu-wf-empty' }, o.v.mode > 1 ? 'No phrase appears twice yet. Try 2-word phrases with more text.' : 'No words match these settings.'))
    } else if (o.v.view === 'cloud') {
      const max = shown[0].count, min = shown[shown.length - 1].count
      const scale = (c) => (max === min ? 1 : (Math.log(c) - Math.log(min)) / (Math.log(max) - Math.log(min)))
      const wrap = h('div', { class: 'tu-cloud', role: 'list' }, [...shown].sort((a, b) => (a.term < b.term ? -1 : 1)).map((x, i) => h('button', {
        type: 'button', role: 'listitem', title: `${x.count} times. Click to copy.`, style: { fontSize: `${(13 + scale(x.count) * 30).toFixed(1)}px`, color: `color-mix(in srgb, var(--accent) ${100 - ((i * 37) % 100)}%, var(--accent-2))`, '--i': i },
        onclick: () => copyText(x.term),
      }, x.term)))
      body.replaceChildren(wrap)
    } else {
      const max = shown[0].count
      body.replaceChildren(h('div', { class: 'tu-wf-list' }, shown.map((x, i) => h('div', { class: 'tu-wf-row', title: 'Click to copy', onclick: () => copyText(x.term) },
        h('span', { class: 'rk' }, String(x.rank)), h('span', { class: 'w' }, x.term),
        h('span', { class: 'tu-bar', 'aria-hidden': 'true' }, h('i', { style: { transform: `scaleX(${(x.count / max).toFixed(3)})`, '--i': i } })),
        h('span', { class: 'n' }, x.count.toLocaleString()), h('span', { class: 'pc' }, `${x.pct.toFixed(x.pct < 10 ? 1 : 0)}%`)))))
    }
    outFoot.firstChild.textContent = rows.length ? `Showing ${Math.min(top, rows.length)} of ${rows.length.toLocaleString()}` : ''
    outFoot.lastChild.textContent = r.hiddenOnce ? `${r.hiddenOnce.toLocaleString()} phrases that appear once are hidden` : ''
    flash(outPane)
  }

  function refresh() {
    const text = input.value
    if (tooBig(text)) { rows = []; rib.set([{ label: tooBig(text), value: '!', tone: 'bad' }]); body.replaceChildren(h('div', { class: 'tu-wf-empty' }, 'Too much text for one go.')); return }
    const r = analyze(text, { ...o.v, mode: Number(o.v.mode), top: undefined })
    vTable.setAttribute('aria-pressed', String(o.v.view === 'table'))
    vCloud.setAttribute('aria-pressed', String(o.v.view === 'cloud'))
    inFoot.firstChild.textContent = text ? `${plural(r.totalWords, 'word')} · ${plural(r.unique, 'unique word')}` : 'Nothing yet'
    const t = r.rows[0]
    rib.set(text.trim() ? [
      { label: 'words', value: r.totalWords, tone: 'accent' }, { label: 'unique', value: r.unique },
      ...(t ? [{ label: `top ${o.v.mode > 1 ? 'phrase' : 'word'}: ${t.term}`, value: `${t.count}×`, tone: 'good' }] : []),
    ] : [], '')
    render(r, text)
  }
  o.onChange = refresh
  input.addEventListener('input', () => (input.value.length > 60_000 ? (clearTimeout(refresh._t), refresh._t = setTimeout(refresh, 180)) : refresh()))

  rootEl.append(root(controls, rib.el, h('div', { class: 'tu-panes' }, inPane, outPane)))
  refresh()
  input.focus({ preventScroll: true })
}
