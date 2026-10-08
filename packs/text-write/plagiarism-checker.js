// Plagiarism checker (text overlap): compares your text with one or more source texts you supply using word shingles, shows
// the overlap highlighted, and builds exact-phrase web search links for the most distinctive sentences.
// It does NOT query any plagiarism database or the web itself.
import { h, button, alert, clear, formatNumber, debounce, empty, icon, copyText } from '../../lib/ui.js'
import { toolRoot, addStyle, textInput, chips, kicker, note, ring, sentences, wordsWithRanges, wordCount, STOP } from './_shared.js'

const COLORS = ['#e5484d', '#3e63dd', '#12a594', '#e08700', '#8e4ec6', '#d6409f']
const MAX_SOURCES = 6

const norm = (w) => w.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '')

/**
 * Compare `text` against `sources` ([{name, text}]) with n-word shingles.
 * Returns {words, overall (0..1 share of your words found in any source), per: [{name, containment, jaccard, matched, runs}], owner: Int array (source index per word or -1)}.
 */
export function compare(text, sources, n = 5) {
  const A = wordsWithRanges(text)
  const an = A.map((w) => norm(w.w))
  const W = A.length
  const sh = (arr) => { const s = new Set(); for (let i = 0; i + n <= arr.length; i++) s.add(arr.slice(i, i + n).join(' ')); return s }
  const aSet = sh(an)
  const owner = new Array(W).fill(-1)
  const per = sources.map((src, si) => {
    const bn = wordsWithRanges(src.text).map((w) => norm(w.w))
    const bSet = sh(bn)
    const mask = new Array(W).fill(false)
    let inter = 0
    for (const k of aSet) if (bSet.has(k)) inter++
    for (let i = 0; i + n <= W; i++) {
      if (bSet.has(an.slice(i, i + n).join(' '))) for (let j = i; j < i + n; j++) { mask[j] = true; if (owner[j] < 0) owner[j] = si }
    }
    const matched = mask.filter(Boolean).length
    // runs of consecutive matched words = shared passages
    const runs = []
    for (let i = 0; i < W; i++) {
      if (!mask[i]) continue
      let j = i
      while (j + 1 < W && mask[j + 1]) j++
      runs.push({ from: i, to: j, words: j - i + 1, start: A[i].start, end: A[j].end, text: text.slice(A[i].start, A[j].end) })
      i = j
    }
    // where does each shared passage appear in the source (for the source highlight)?
    const bw = wordsWithRanges(src.text)
    const bmask = new Array(bw.length).fill(false)
    for (let i = 0; i + n <= bn.length; i++) if (aSet.has(bn.slice(i, i + n).join(' '))) for (let j = i; j < i + n; j++) bmask[j] = true
    const union = aSet.size + bSet.size - inter
    return { name: src.name, containment: W ? matched / W : 0, jaccard: union ? inter / union : 0, matched, runs: runs.sort((a, b) => b.words - a.words), srcWords: bw, srcMask: bmask, shared: inter }
  })
  const overall = W ? owner.filter((o) => o >= 0).length / W : 0
  return { words: A, W, overall, per, owner }
}

/** The most distinctive sentences of a text (long, with rare words) for exact-phrase searching. */
export function distinctive(text, count = 6) {
  const freq = new Map()
  for (const { w } of wordsWithRanges(text)) { const k = norm(w); freq.set(k, (freq.get(k) || 0) + 1) }
  return sentences(text).map((s) => {
    const ws = wordsWithRanges(s.text)
    if (ws.length < 8) return null
    let rare = 0
    for (const { w } of ws) { const k = norm(w); if (!STOP.has(k) && k.length > 3) rare += 1 / freq.get(k) }
    // Google ignores words past about 32, so long sentences are cut to a 28 word phrase
    const take = ws.slice(0, 28)
    const phrase = s.text.slice(0, take.at(-1).end).replace(/\s+/g, ' ').trim()
    return { phrase, score: (rare / ws.length) * Math.log(ws.length + 1), words: take.length, full: s.text }
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, count)
}

const q = (phrase) => encodeURIComponent(`"${phrase}"`)
const SEARCH = [['Google', (p) => `https://www.google.com/search?q=${q(p)}`], ['Bing', (p) => `https://www.bing.com/search?q=${q(p)}`], ['DuckDuckGo', (p) => `https://duckduckgo.com/?q=${q(p)}`]]

const SAMPLE_MINE = 'Plants are remarkable. Photosynthesis is the process by which green plants, algae and some bacteria convert light energy into chemical energy. In simple terms, they take in carbon dioxide and water, and with sunlight they make sugar. They release oxygen as a by-product, which is essential for most life on Earth, because animals and humans need it to breathe.'
const SAMPLE_SRC = 'Photosynthesis is the process by which green plants, algae and some bacteria convert light energy into chemical energy. During photosynthesis, plants absorb carbon dioxide from the air and water from the soil. Using the energy of sunlight, they turn these ingredients into glucose and release oxygen as a by-product. This oxygen is essential for most life on Earth, because animals and humans need it to breathe.'

const CSS = `
.tw-plag .tw-src { border: 1px solid var(--border); border-left: 4px solid var(--k); border-radius: 16px; padding: 12px; background: var(--surface); display: flex; flex-direction: column; gap: 8px; animation: tw-rise .35s var(--ease) both; }
.tw-plag .tw-src .top { display: flex; gap: 8px; align-items: center; }
.tw-plag .tw-text { padding: 16px 18px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); line-height: 1.85; font-size: 15.5px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 480px; overflow: auto; }
.tw-plag .tw-text .hit { background: color-mix(in srgb, var(--k) 24%, transparent); box-shadow: 0 2px 0 var(--k); border-radius: 3px; }
.tw-plag .tw-dash { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 22px; align-items: center; }
.tw-plag .tw-verdict b { display: block; font-size: 20px; letter-spacing: -.02em; margin-bottom: 2px; }
.tw-plag .tw-verdict span { color: var(--muted); font-size: 14px; }
.tw-plag .tw-q { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); }
.tw-plag .tw-q p { margin: 0; font-size: 14.5px; overflow-wrap: anywhere; }
.tw-plag .tw-link { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 99px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-2); font-size: 13px; font-weight: 550; transition: transform .2s var(--spring), border-color .2s; }
.tw-plag .tw-link:hover { transform: translateY(-1px); border-color: var(--accent); color: var(--accent); }
.tw-plag .tw-link .icon { width: 13px; height: 13px; }
.tw-plag .tw-legend { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 13px; }
.tw-plag .tw-legend span { display: inline-flex; align-items: center; gap: 6px; } .tw-plag .tw-legend i { width: 10px; height: 10px; border-radius: 3px; background: var(--k); }
@media (max-width: 560px) { .tw-plag .tw-dash { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; } }
`

export function mount(root) {
  addStyle('tw-plag-css', CSS)
  const st = { n: 5, sources: [], view: 'mine' }
  const mine = textInput({ rows: 12, placeholder: 'Paste the text you want to check...', sample: SAMPLE_MINE, label: 'Your text', onInput: () => later(), extra: [] })
  const sourceList = h('div', { class: 'stack' })
  const results = h('div', { class: 'stack' })
  const sizeChips = chips([[3, '3 words'], [4, '4 words'], [5, '5 words'], [6, '6 words']], st.n, (v) => { st.n = v; run() }, { ariaLabel: 'Match length' })
  const addBtn = button('Add another source', { icon: 'plus', size: 'sm', variant: 'secondary', onClick: () => addSource() })
  const gauge = ring({ size: 150, stroke: 13 })

  function addSource(text = '', name = '') {
    if (st.sources.length >= MAX_SOURCES) return
    const i = st.sources.length
    const color = COLORS[i % COLORS.length]
    const ti = textInput({ rows: 6, placeholder: 'Paste a source text to compare with...', label: `Source ${i + 1} text`, value: text, onInput: () => later() })
    const nameEl = h('input', { class: 'input', value: name || `Source ${i + 1}`, 'aria-label': `Source ${i + 1} name`, oninput: () => later() })
    const rm = button('', { icon: 'x', size: 'sm', variant: 'ghost', ariaLabel: `Remove source ${i + 1}`, onClick: () => { st.sources = st.sources.filter((x) => x !== s); s.el.remove(); renumber(); run() } })
    const s = { ti, nameEl, color, el: h('div', { class: 'tw-src', style: { '--k': color } }, h('div', { class: 'top' }, nameEl, rm), ti.el) }
    st.sources.push(s)
    sourceList.append(s.el)
    addBtn.hidden = st.sources.length >= MAX_SOURCES
    return s
  }
  function renumber() {
    st.sources.forEach((s, i) => { s.color = COLORS[i % COLORS.length]; s.el.style.setProperty('--k', s.color) })
    addBtn.hidden = st.sources.length >= MAX_SOURCES
  }

  const later = debounce(() => run(), 250)

  function run() {
    const text = mine.get()
    const srcs = st.sources.map((s, i) => ({ name: s.nameEl.value.trim() || `Source ${i + 1}`, text: s.ti.get(), color: s.color })).filter((s) => wordCount(s.text) > 0)
    const W = wordCount(text)
    const dist = distinctive(text)
    if (W === 0) { clear(results, empty('Paste your text above. Add a source text to see the overlap, or use the search links to check it against the web.', 'shield-check')); return }
    const blocks = []
    if (srcs.length && W >= st.n) {
      const cmp = compare(text, srcs, st.n)
      blocks.push(overlapView(text, srcs, cmp))
    } else if (srcs.length) blocks.push(h('div', { class: 'tw-sub' }, `Your text needs at least ${st.n} words to compare.`))
    else blocks.push(h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Compare with a source', 'git-compare'), h('div', { class: 'tw-sub' }, 'Paste a source text (an article, a classmate\'s paragraph, a document) in a source box to see exactly which passages overlap.'))))
    blocks.push(searchView(dist))
    clear(results, blocks)
  }

  function overlapView(text, srcs, cmp) {
    const pct = cmp.overall * 100
    const [label, desc, color] = pct < 10 ? ['Low overlap', 'Only a small share of your wording appears in the sources.', '#30a46c'] : pct < 25 ? ['Some overlap', 'Check that the matching passages are quoted or cited.', '#d6a400'] : pct < 50 ? ['Significant overlap', 'A large part of this text matches the sources. Rewrite it or cite it.', '#f08400'] : ['High overlap', 'Most of this text matches the sources word for word.', '#e5484d']
    gauge.set(cmp.overall, `${Math.round(pct)}%`, 'of your words', color)
    const legend = h('div', { class: 'tw-legend' }, srcs.map((s, i) => h('span', { style: { '--k': s.color } }, h('i'), s.name)))
    // highlighted text of the chosen document
    const docs = [['mine', 'Your text'], ...srcs.map((s, i) => [`s${i}`, s.name])]
    const viewEl = h('div', { class: 'tw-text', tabindex: 0 })
    const draw = (v) => {
      st.view = v
      if (v === 'mine') {
        const frag = []
        let pos = 0
        const w = cmp.words
        for (let i = 0; i < w.length; i++) {
          const o = cmp.owner[i]
          if (o < 0) continue
          let j = i
          while (j + 1 < w.length && cmp.owner[j + 1] === o) j++
          if (w[i].start > pos) frag.push(text.slice(pos, w[i].start))
          frag.push(h('span', { class: 'hit', style: { '--k': srcs[o].color }, title: `Also in ${srcs[o].name}` }, text.slice(w[i].start, w[j].end)))
          pos = w[j].end
          i = j
        }
        frag.push(text.slice(pos))
        clear(viewEl, frag)
      } else {
        const si = Number(v.slice(1))
        const src = srcs[si], per = cmp.per[si]
        const frag = []
        let pos = 0
        const w = per.srcWords
        for (let i = 0; i < w.length; i++) {
          if (!per.srcMask[i]) continue
          let j = i
          while (j + 1 < w.length && per.srcMask[j + 1]) j++
          if (w[i].start > pos) frag.push(src.text.slice(pos, w[i].start))
          frag.push(h('span', { class: 'hit', style: { '--k': src.color } }, src.text.slice(w[i].start, w[j].end)))
          pos = w[j].end
          i = j
        }
        frag.push(src.text.slice(pos))
        clear(viewEl, frag)
      }
      for (const b of viewChips.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b._id === v))
    }
    const viewChips = chips(docs.map(([id, label]) => [id, label]), st.view in Object.fromEntries(docs) ? st.view : 'mine', draw, { ariaLabel: 'Document to show' })
    draw(viewChips.value)
    const bars = h('div', { class: 'tw-bars' }, cmp.per.map((p, i) => h('div', { class: 'tw-bar-row', style: { '--tw-accent': srcs[i].color } },
      h('b', { style: { fontSize: '14px' } }, p.name), h('span', { class: 'tw-sub' }, `${Math.round(p.containment * 100)}% of your text matches · similarity ${Math.round(p.jaccard * 100)}%`),
      h('div', { class: 'trk' }, h('i', { style: { width: '0%', background: srcs[i].color } })))))
    requestAnimationFrame(() => bars.querySelectorAll('.trk i').forEach((el, i) => { el.style.width = `${Math.round(cmp.per[i].containment * 100)}%` }))
    const passages = cmp.per.flatMap((p, i) => p.runs.map((r) => ({ ...r, si: i }))).sort((a, b) => b.words - a.words).slice(0, 8)
    return h('div', { class: 'stack tw-result-in' },
      h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, h('div', { class: 'tw-dash' }, gauge.el, h('div', { class: 'tw-verdict' }, h('b', { style: { color } }, label), h('span', desc),
        h('div', { class: 'tw-sub', style: 'margin-top:8px' }, `${formatNumber(cmp.words.length, 0)} words checked against ${srcs.length} source${srcs.length === 1 ? '' : 's'} using ${st.n}-word matches.`))), bars)),
      h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, h('div', { class: 'tw-head' }, kicker('Highlighted overlap', 'highlighter'), legend), viewChips, viewEl)),
      passages.length ? h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Longest shared passages', 'quote'),
        passages.map((r) => h('div', { class: 'tw-q', style: { borderLeft: `4px solid ${srcs[r.si].color}` } }, h('p', `"${r.text.length > 260 ? `${r.text.slice(0, 260)}...` : r.text}"`), h('div', { class: 'tw-sub' }, `${r.words} words in a row, also in ${srcs[r.si].name}`))))) : alert('success', 'No shared passages of this length were found between your text and the sources.'))
  }

  function searchView(list) {
    return h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Check the web yourself', 'search'),
      h('div', { class: 'tw-sub' }, 'This tool does not search the internet or any plagiarism database. These links open ordinary exact-phrase searches for the most distinctive sentences in your text. If a search shows the same sentence on another site, you have found a possible source.'),
      list.length ? list.map((d) => h('div', { class: 'tw-q' }, h('p', `"${d.phrase}"`), h('div', { class: 'row' },
        SEARCH.map(([name, fn]) => h('a', { class: 'tw-link', href: fn(d.phrase), target: '_blank', rel: 'noopener noreferrer' }, name, icon('external-link'))),
        button('Copy phrase', { size: 'sm', variant: 'ghost', icon: 'copy', onClick: () => copyText(d.phrase) }))))
        : h('div', { class: 'tw-sub' }, 'Add longer sentences (8 words or more) to get search phrases.')))
  }

  addSource()
  const left = h('div', { class: 'stack' }, h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Your text', 'type'), mine.el)))
  const right = h('div', { class: 'stack' }, h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Sources to compare with', 'files'), sourceList, h('div', { class: 'row' }, addBtn), h('div', { class: 'stack tight' }, kicker('Match length', 'ruler'), sizeChips, h('div', { class: 'tw-sub' }, 'Shorter matches find more overlap (and more coincidences); 5 words is a good default.')))),
    button('Load an example', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: () => { mine.set(SAMPLE_MINE, true); st.sources[0].ti.set(SAMPLE_SRC, true); run() } }))
  root.append(toolRoot('plag', h('div', { class: ['tool-split'] }, left, right), results,
    note('Everything is compared on your device and nothing is stored. A low score does not prove originality and a high score does not prove copying: quoted and cited passages also match. You make the call.', 'shield-check')))
  run()
}
