// Readability checker: Flesch reading ease, Flesch-Kincaid grade, Gunning Fog, SMOG, Coleman-Liau and ARI, plus highlights for
// long sentences, passive voice, adverbs and hard words. English text; everything runs in the browser.
import { h, clear, stats, formatNumber, debounce, empty, icon } from '../../lib/ui.js'
import { toolRoot, addStyle, textInput, chips, kicker, note, ring, sentences, wordsWithRanges, syllables } from './_shared.js'

const IRREGULAR = new Set(('known shown given taken made done seen written spoken broken chosen driven eaten fallen forgotten forgiven frozen gotten hidden ridden risen stolen sworn thrown worn woken born built bought brought caught found heard held kept left lost meant paid put sent set sold told thought understood won bound cut hurt led lent shut split spent taught torn drawn grown flown begun sung rung sunk shaken beaten bitten blown dealt dug fed felt fought hung laid lit met proven quit shot slept stuck struck swept swung wound').split(' '))
const NOT_ADVERB = new Set(('family only early likely friendly lovely lonely holy ugly silly belly bully jelly july italy reply supply apply multiply rely imply ally rally anomaly assembly butterfly monopoly fly ply sly comply lively orderly elderly deadly costly curly chilly jolly kindly lowly manly motherly scholarly timely unlikely daily weekly monthly yearly hourly nightly likely bubbly curly wobbly frilly gly oily surly rely july may').split(' '))
const AUX = '(?:am|is|are|was|were|be|been|being|get|gets|got|getting)'
const PASSIVE_RE = new RegExp(`\\b${AUX}\\b(?:\\s+(?:\\w+ly|not|never|also|often|always|already|still|just|really|being|been|be|now|then))*\\s+([A-Za-z]+)\\b`, 'gi')

const NOT_PARTICIPLE = new Set(('need indeed seed bleed speed breed feed weed proceed exceed succeed hundred kindred sacred naked wicked rugged ragged beloved tired excited bored scared interested surprised worried pleased concerned married satisfied used supposed open even often seven eleven golden garden children women men then when').split(' '))

/** Passive voice candidates: a form of "to be/get" followed by a past participle. Returns [{start, end}]. */
export function findPassive(text) {
  const out = []
  for (const m of text.matchAll(PASSIVE_RE)) {
    const w = m[1].toLowerCase()
    const participle = IRREGULAR.has(w) || (/^[a-z]{3,}(?:ed|en)$/.test(w) && !NOT_PARTICIPLE.has(w))
    if (participle) out.push({ start: m.index, end: m.index + m[0].length })
  }
  return out
}

export function findAdverbs(text) {
  return wordsWithRanges(text).filter(({ w }) => /ly$/i.test(w) && w.length > 3 && !NOT_ADVERB.has(w.toLowerCase())).map(({ start, end }) => ({ start, end }))
}

/** All readability numbers for a text. Pure function, used by the UI and the tests. */
export function analyze(text) {
  const sents = sentences(text)
  const words = wordsWithRanges(text)
  const W = words.length, S = Math.max(sents.length, W ? 1 : 0)
  if (!W) return { W: 0, S: 0 }
  let syl = 0, letters = 0, chars = 0, complex = 0, poly = 0
  const hard = []
  const startsOfSentence = new Set(sents.map((s) => s.start))
  for (const wd of words) {
    const isNum = /^\d+$/.test(wd.w)
    const s = isNum ? Math.max(1, Math.ceil(wd.w.length / 2)) : syllables(wd.w)
    syl += s
    chars += wd.w.replace(/['’-]/g, '').length
    letters += (wd.w.match(/\p{L}/gu) || []).length
    if (s >= 3 && !isNum) {
      poly++
      const proper = /^\p{Lu}/u.test(wd.w) && !startsOfSentence.has(wd.start)
      if (!proper && !wd.w.includes('-')) { complex++; hard.push({ start: wd.start, end: wd.end }) }
    }
  }
  const wps = W / S, spw = syl / W
  const fre = 206.835 - 1.015 * wps - 84.6 * spw
  const fk = 0.39 * wps + 11.8 * spw - 15.59
  const fog = 0.4 * (wps + 100 * (complex / W))
  const smog = 1.043 * Math.sqrt(poly * (30 / S)) + 3.1291
  const cli = 0.0588 * ((letters / W) * 100) - 0.296 * ((S / W) * 100) - 15.8
  const ari = 4.71 * (chars / W) + 0.5 * wps - 21.43
  const grades = [fk, fog, smog, cli, ari]
  const avgGrade = Math.max(0, grades.reduce((a, b) => a + b, 0) / grades.length)
  const lens = sents.map((s) => ({ ...s, n: wordsWithRanges(s.text).length }))
  return { W, S, syl, letters, chars, complex, poly, wps, spw, fre, fk, fog, smog, cli, ari, avgGrade, sents: lens, hard, passive: findPassive(text), adverbs: findAdverbs(text), readingMin: W / 238 }
}

const BANDS = [
  [90, 'Very easy', 'About 5th grade. Any 11-year-old follows this easily.', '#12a594'],
  [80, 'Easy', 'About 6th grade. Conversational English.', '#30a46c'],
  [70, 'Fairly easy', 'About 7th grade.', '#7bb61e'],
  [60, 'Plain English', 'About 8th to 9th grade. Most 13 to 15 year olds understand it.', '#d6a400'],
  [50, 'Fairly difficult', 'About 10th to 12th grade.', '#f08400'],
  [30, 'Difficult', 'College level.', '#e5484d'],
  [-Infinity, 'Very difficult', 'College graduate level. Consider shorter sentences and simpler words.', '#c4264f'],
]
const band = (fre) => BANDS.find((b) => fre >= b[0])
const gradeLabel = (g) => (g < 1 ? 'Kindergarten' : g < 13 ? `Grade ${Math.round(g)}` : g < 17 ? 'College' : 'Graduate')
const SAMPLE = `The utilization of sophisticated methodologies was thoroughly evaluated by the committee, which subsequently determined that the aforementioned proposals were insufficiently comprehensive to be implemented across the organization without additional consultation.

We really need to write shorter sentences. Readers get tired quickly when a sentence keeps going and going, adding clause after clause, qualification after qualification, until the original point has been completely buried under the weight of everything that was added afterwards.

Short words help. Active verbs help more. The report was written by the team, but "the team wrote the report" is clearer.`

const CSS = `
.tw-read .tw-dash { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 22px; align-items: center; }
.tw-read .tw-verdict b { display: block; font-size: 20px; letter-spacing: -.02em; margin-bottom: 2px; }
.tw-read .tw-verdict span { color: var(--muted); font-size: 14px; }
.tw-read .tw-grade { display: grid; grid-template-columns: 112px minmax(0, 1fr) 72px; gap: 10px; align-items: center; font-size: 13.5px; }
.tw-read .tw-grade .trk { height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.tw-read .tw-grade .trk i { display: block; height: 100%; border-radius: inherit; width: 0; transition: width .8s var(--ease), background .4s; }
.tw-read .tw-grade output { font-variant-numeric: tabular-nums; text-align: right; font-weight: 600; }
.tw-read .tw-text { padding: 16px 18px; border-radius: 14px; border: 1px solid var(--border); background: var(--surface); line-height: 1.85; font-size: 15.5px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 520px; overflow: auto; }
.tw-read .lg { background: color-mix(in srgb, #e5a50a 22%, transparent); border-radius: 4px; }
.tw-read .vl { background: color-mix(in srgb, #e5484d 24%, transparent); border-radius: 4px; }
.tw-read .pv { background: color-mix(in srgb, #3e63dd 22%, transparent); border-radius: 3px; box-shadow: 0 2px 0 #3e63dd; }
.tw-read .ad { background: color-mix(in srgb, #8e4ec6 22%, transparent); border-radius: 3px; box-shadow: 0 2px 0 #8e4ec6; }
.tw-read .hd { text-decoration: underline dotted #12a594 2px; text-underline-offset: 4px; }
.tw-read .tw-tip { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); font-size: 13.5px; }
.tw-read .tw-tip .icon { margin-top: 2px; color: var(--accent); }
.tw-read .tw-tip q { quotes: none; color: var(--muted); display: block; margin-top: 3px; overflow-wrap: anywhere; }
@media (max-width: 560px) { .tw-read .tw-dash { grid-template-columns: minmax(0, 1fr); justify-items: center; text-align: center; } .tw-read .tw-grade { grid-template-columns: 96px minmax(0, 1fr) 56px; } }
`

export function mount(root) {
  addStyle('tw-read-css', CSS)
  const st = { show: ['vlong', 'long', 'passive', 'adverb', 'hard'] }
  const inp = textInput({ rows: 12, placeholder: 'Paste your writing here to see its reading level...', sample: SAMPLE, label: 'Text to analyse', onInput: () => later() })
  const gauge = ring({ size: 150, stroke: 13 })
  const verdict = h('div', { class: 'tw-verdict' })
  const grades = h('div', { class: 'stack tight' })
  const statBox = h('div')
  const tips = h('div', { class: 'stack tight' })
  const view = h('div', { class: 'tw-text', tabindex: 0, 'aria-label': 'Your text with readability highlights' })
  const legend = chips([['vlong', 'Very long sentence', 'rectangle-horizontal'], ['long', 'Long sentence', 'rectangle-horizontal'], ['passive', 'Passive voice', 'arrow-left-right'], ['adverb', 'Adverbs', 'zap'], ['hard', 'Hard words', 'graduation-cap']],
    st.show, (v) => { st.show = v; paintText() }, { multi: true, ariaLabel: 'Highlights to show' })
  ;[...legend.children].forEach((b, i) => b.style.setProperty('--tw-accent', ['#e5484d', '#e5a50a', '#3e63dd', '#8e4ec6', '#12a594'][i]))
  const dash = h('section', { class: 'tw-stage', hidden: true }, h('div', { class: 'stack' }, h('div', { class: 'tw-dash' }, gauge.el, verdict), grades))
  const body = h('div', { class: 'stack', hidden: true }, statBox,
    h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, h('div', { class: 'tw-head' }, kicker('Highlights', 'highlighter')), legend, view)),
    h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('What to fix first', 'lightbulb'), tips)))
  const emptyBox = h('div', empty('Paste or type some text and your reading level appears instantly.', 'gauge'))
  let res = null

  function paintText() {
    const text = inp.get()
    if (!res || !res.W) return
    const on = new Set(st.show)
    const marks = []
    for (const s of res.sents) {
      if (s.n > 30 && on.has('vlong')) marks.push({ start: s.start, end: s.end, cls: 'vl', rank: 0 })
      else if (s.n > 20 && s.n <= 30 && on.has('long')) marks.push({ start: s.start, end: s.end, cls: 'lg', rank: 0 })
    }
    const inner = []
    if (on.has('passive')) for (const p of res.passive) inner.push({ ...p, cls: 'pv' })
    if (on.has('adverb')) for (const a of res.adverbs) if (!inner.some((p) => p.cls === 'pv' && a.start >= p.start && a.end <= p.end)) inner.push({ ...a, cls: 'ad' })
    if (on.has('hard')) for (const w of res.hard) if (!inner.some((p) => w.start >= p.start && w.end <= p.end)) inner.push({ ...w, cls: 'hd' })
    inner.sort((a, b) => a.start - b.start)
    const flat = []
    let last = 0
    for (const m of inner) { if (m.start < last) continue; flat.push(m); last = m.end }
    const range = (from, to) => { // text in [from, to) with the word-level marks inside it
      const arr = []
      let p = from
      for (const m of flat) {
        if (m.start < p || m.end > to) continue
        if (m.start > p) arr.push(text.slice(p, m.start))
        arr.push(h('span', { class: m.cls }, text.slice(m.start, m.end)))
        p = m.end
      }
      if (p < to) arr.push(text.slice(p, to))
      return arr
    }
    const frag = []
    let pos = 0
    for (const s of marks.sort((a, b) => a.start - b.start)) {
      if (s.start > pos) frag.push(...range(pos, s.start))
      frag.push(h('span', { class: s.cls }, ...range(s.start, s.end)))
      pos = s.end
    }
    if (pos < text.length) frag.push(...range(pos, text.length))
    clear(view, frag)
  }

  function render() {
    const text = inp.get()
    res = analyze(text)
    const has = res.W > 0
    emptyBox.hidden = has
    dash.hidden = !has
    body.hidden = !has
    if (!has) return
    const b = band(res.fre)
    gauge.set(Math.max(0, Math.min(100, res.fre)) / 100, String(Math.round(Math.max(0, Math.min(100, res.fre)))), 'Reading ease', b[3])
    clear(verdict, h('b', { style: { color: b[3] } }, b[1]), h('span', b[2]), h('div', { class: 'tw-sub', style: 'margin-top:8px' }, `Average across the five grade formulas: ${gradeLabel(res.avgGrade)} (${res.avgGrade.toFixed(1)})`))
    const rows = [['Flesch-Kincaid', res.fk], ['Gunning Fog', res.fog], ['SMOG', res.smog], ['Coleman-Liau', res.cli], ['ARI', res.ari]]
    clear(grades, kicker('US grade level by formula', 'graduation-cap'), rows.map(([n, v]) => {
      const g = Math.max(0, v)
      const col = g <= 8 ? '#30a46c' : g <= 12 ? '#d6a400' : '#e5484d'
      const bar = h('i', { style: { background: col } })
      requestAnimationFrame(() => { bar.style.width = `${Math.min(100, (g / 18) * 100)}%` })
      return h('div', { class: 'tw-grade' }, h('span', n), h('div', { class: 'trk' }, bar), h('output', { title: `Raw value ${v.toFixed(2)}` }, g.toFixed(1)))
    }), res.S < 30 ? h('div', { class: 'tw-sub' }, 'SMOG is designed for 30 or more sentences, so treat it as a rough guide on short texts.') : null)
    const longN = res.sents.filter((s) => s.n > 20).length
    const nums = (n) => formatNumber(n, 0)
    clear(statBox, stats([
      { label: 'Words', value: nums(res.W), accent: true }, { label: 'Sentences', value: nums(res.S) }, { label: 'Words per sentence', value: res.wps.toFixed(1), hint: res.wps <= 20 ? 'good' : 'on the long side', danger: res.wps > 25 },
      { label: 'Syllables per word', value: res.spw.toFixed(2) }, { label: 'Long sentences', value: nums(longN), hint: 'over 20 words', danger: longN > res.S * 0.4 && longN > 2 }, { label: 'Passive voice', value: nums(res.passive.length), hint: 'likely cases' },
      { label: 'Adverbs', value: nums(res.adverbs.length) }, { label: 'Hard words', value: `${((res.complex / res.W) * 100).toFixed(1)}%`, hint: '3+ syllables' }, { label: 'Reading time', value: res.readingMin < 1 ? `${Math.max(1, Math.round(res.readingMin * 60))} sec` : `${Math.round(res.readingMin)} min` },
    ]))
    // suggestions
    const list = []
    const longest = [...res.sents].sort((a, b) => b.n - a.n).filter((s) => s.n > 20).slice(0, 3)
    if (longest.length) list.push(h('div', { class: 'tw-tip' }, icon('scissors'), h('div', h('b', `${res.sents.filter((s) => s.n > 20).length} sentence${res.sents.filter((s) => s.n > 20).length === 1 ? ' is' : 's are'} over 20 words.`), ' Try splitting them.',
      longest.map((s) => h('q', `${s.n} words: "${s.text.length > 110 ? `${s.text.slice(0, 110)}...` : s.text}"`)))))
    if (res.passive.length) list.push(h('div', { class: 'tw-tip' }, icon('arrow-left-right'), h('div', h('b', `${res.passive.length} likely passive voice phrase${res.passive.length === 1 ? '' : 's'}.`), ' Say who does the action: "the team wrote the report" beats "the report was written".',
      res.passive.slice(0, 2).map((p) => h('q', `"${text.slice(p.start, p.end)}"`)))))
    if (res.adverbs.length > Math.max(3, res.W / 40)) list.push(h('div', { class: 'tw-tip' }, icon('zap'), h('div', h('b', `${res.adverbs.length} adverbs.`), ' Many can go, or be replaced by a stronger verb.')))
    if (res.complex / res.W > 0.12) list.push(h('div', { class: 'tw-tip' }, icon('graduation-cap'), h('div', h('b', `${((res.complex / res.W) * 100).toFixed(0)}% of the words have 3 or more syllables.`), ' Look for shorter alternatives (use, not utilise).')))
    if (!list.length) list.push(h('div', { class: 'tw-tip' }, icon('circle-check'), h('div', h('b', 'Nothing stands out.'), ' Sentences are a good length and the wording is plain.')))
    clear(tips, list)
    paintText()
  }
  const later = debounce(render, 250)

  render()
  root.append(toolRoot('read',
    h('section', { class: 'tw-stage' }, h('div', { class: 'stack' }, kicker('Your writing', 'type'), inp.el)),
    emptyBox, dash, body,
    note('The formulas are built for English text. Syllables are counted with a rule-based method and passive voice is detected by pattern, so treat the numbers as a guide, not a verdict.', 'info')))
}
