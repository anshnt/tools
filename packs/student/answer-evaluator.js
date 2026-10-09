// Answer evaluator: score a written answer against a model answer or a marking rubric (keyword and concept coverage), with feedback.
// Local scoring is transparent and explainable; AI evaluation (Claude, your key) gives a more nuanced second opinion.
import { h, button, busy, field, segmented, alert, clear, debounce, number, toast, copyText } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, confetti, esc, ring } from './_kit.js'
import { splitSentences, words, stem, STOP } from './_text.js'

const CSS = `
.t-ev .side { position: sticky; top: calc(var(--header-h) + 12px); display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 900px) { .t-ev .side { position: static; } }
.t-ev .hero { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.t-ev .big { font-size: 40px; font-weight: 700; letter-spacing: -.045em; line-height: 1; font-variant-numeric: tabular-nums; }
.t-ev .big small { font-size: 20px; color: var(--muted); font-weight: 560; }
.t-ev .pt { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; padding: 10px 0; border-bottom: 1px dashed var(--border); align-items: start; animation: stu-pop .4s var(--ease) both; animation-delay: calc(var(--i, 0) * 40ms); }
.t-ev .pt:last-child { border-bottom: 0; }
.t-ev .pt .st { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 14px; color: #fff; }
.t-ev .pt .st.ok { background: var(--success); } .t-ev .pt .st.part { background: var(--warning); } .t-ev .pt .st.no { background: var(--danger); }
.t-ev .pt .tx { font-size: 14.5px; line-height: 1.45; }
.t-ev .pt .sub { font-size: 12.5px; color: var(--muted); margin-top: 3px; }
.t-ev .pt .mk { font-variant-numeric: tabular-nums; font-weight: 650; font-size: 14px; white-space: nowrap; }
.t-ev .hl { padding: 12px 14px; border-radius: 14px; background: var(--surface-2); line-height: 1.7; font-size: 14.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.t-ev .meter { height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; margin-top: 6px; }
.t-ev .meter i { display: block; height: 100%; border-radius: inherit; background: var(--bc, var(--accent)); width: 0; transition: width .8s var(--ease); }
.t-ev .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.t-ev ul.fb { margin: 6px 0 0; padding-left: 18px; font-size: 14px; display: grid; gap: 4px; }
`

const SAMPLE = {
  question: 'Explain how plants make their own food.',
  model: 'Plants make food by photosynthesis. Chlorophyll in the chloroplasts absorbs sunlight. Carbon dioxide enters the leaf through the stomata and water is absorbed by the roots. Light energy is used to convert carbon dioxide and water into glucose and oxygen is released.',
  rubric: 'Photosynthesis is the process {makes food, produces glucose} (2)\nChlorophyll absorbs sunlight / light energy (2)\nCarbon dioxide enters through the stomata (1)\nWater is absorbed by the roots (1)\nGlucose is produced and oxygen is released (2)',
  answer: 'Plants use sunlight, which is absorbed by chlorophyll, to turn carbon dioxide and water into glucose. Oxygen is given out as a waste gas. This happens in the leaves.',
}

// ---------- scoring ----------
const toks = (text) => words(text).filter((w) => /^\d/.test(w) || (!STOP.has(w) && w.length > 2)).map((w) => (/^\d/.test(w) ? w.replace(/,/g, '') : stem(w)))
const uniq = (a) => [...new Set(a)]

/** Parse a rubric: one point per line, optional marks in (2) or [2] at the end, optional {alternative wordings, separated by commas}. */
export function parseRubric(text) {
  const out = []
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, '').trim()
    if (!line) continue
    let marks = NaN
    const m = /[(\[]\s*(\d+(?:\.\d+)?)\s*(?:marks?|mks?|pts?|points?)?\s*[)\]]\s*$/i.exec(line)
    if (m) { marks = parseFloat(m[1]); line = line.slice(0, m.index).trim() }
    let alts = []
    const a = /\{([^}]*)\}/.exec(line)
    if (a) { alts = a[1].split(/[,;|]/).map((s) => s.trim()).filter(Boolean); line = line.replace(a[0], ' ').replace(/\s+/g, ' ').trim() }
    // "a / b" at the end of a point means either wording is fine
    const slash = line.split(/\s+\/\s+/)
    if (slash.length > 1) { alts.push(...slash.slice(1)); line = slash[0] }
    if (line) out.push({ text: line, alts, marks })
  }
  return out
}

/** Model answer -> rubric points: one per sentence, equal marks. */
export function pointsFromModel(model) {
  return splitSentences(model).map((s) => s.text).filter((t) => toks(t).length >= 2).map((t) => ({ text: t, alts: [], marks: NaN }))
}

function coverageOf(pointToks, have) {
  if (!pointToks.length) return 1
  let got = 0, weight = 0
  for (const t of pointToks) { const w = /^\d/.test(t) ? 2 : 1; weight += w; if (have.has(t)) got += w }
  return got / weight
}
const credit = (c) => Math.max(0, Math.min(1, (c - 0.2) / 0.45))
const halves = (x) => Math.round(x * 2) / 2

/**
 * evaluate({mode: 'model'|'rubric', model, rubric, answer, max}) -> {points, total, max, pct, similarity, matched: Set, length}
 * Each point: {text, marks, awarded, coverage, status: 'ok'|'part'|'no', missing: [surface words], found: [surface words]}
 */
export function evaluate({ mode = 'model', model = '', rubric = '', answer = '', max = 10 }) {
  const pts = mode === 'rubric' ? parseRubric(rubric) : pointsFromModel(model)
  const ans = String(answer)
  const aTok = toks(ans)
  const have = new Set(aTok)
  const known = pts.reduce((t, p) => t + (Number.isFinite(p.marks) ? p.marks : 0), 0)
  const unknown = pts.filter((p) => !Number.isFinite(p.marks)).length
  const rest = Math.max(0, max - known)
  const marksOf = (p) => (Number.isFinite(p.marks) ? p.marks : unknown ? rest / unknown : 0)
  const totalMarks = pts.reduce((t, p) => t + marksOf(p), 0) || max
  const scale = totalMarks ? max / totalMarks : 1
  const matched = new Set()
  const points = pts.map((p) => {
    const pt = uniq(toks(p.text))
    let cov = coverageOf(pt, have)
    for (const alt of p.alts) { const at = uniq(toks(alt)); if (at.length) cov = Math.max(cov, coverageOf(at, have)) }
    const surface = words(p.text).filter((w) => /^\d/.test(w) || (!STOP.has(w) && w.length > 2))
    const found = [], missing = []
    for (const w of surface) { const t = /^\d/.test(w) ? w.replace(/,/g, '') : stem(w); (have.has(t) ? found : missing).push(w); if (have.has(t)) matched.add(t) }
    const c = credit(cov)
    const marks = marksOf(p) * scale
    const awarded = halves(c * marks) // quarter-mark noise would look false: round to half marks
    return { text: p.text, alts: p.alts, marks: Math.round(marks * 100) / 100, awarded: Math.min(awarded, Math.round(marks * 100) / 100), coverage: cov, status: cov >= 0.65 ? 'ok' : cov >= 0.35 ? 'part' : 'no', missing: uniq(missing).slice(0, 8), found: uniq(found).slice(0, 8) }
  })
  const total = Math.min(max, points.reduce((t, p) => t + p.awarded, 0))
  // overall similarity of the answer with the model/rubric text (cosine on stems)
  const ref = pts.flatMap((p) => toks(p.text))
  const f = (arr) => { const m = new Map(); for (const t of arr) m.set(t, (m.get(t) || 0) + 1); return m }
  const fa = f(aTok), fr = f(ref)
  let dot = 0
  for (const [t, v] of fa) dot += v * (fr.get(t) || 0)
  const na = Math.sqrt([...fa.values()].reduce((t, v) => t + v * v, 0)), nr = Math.sqrt([...fr.values()].reduce((t, v) => t + v * v, 0))
  return { points, total, max, pct: max ? (total / max) * 100 : 0, similarity: na && nr ? dot / (na * nr) : 0, matched, length: { answer: aTok.length, reference: ref.length } }
}

const verdict = (pct) => (pct >= 85 ? ['Excellent', 'success'] : pct >= 65 ? ['Good', 'success'] : pct >= 40 ? ['Partly there', 'warning'] : ['Needs more work', 'danger'])
const fmtMark = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function highlight(answer, matched) {
  const frag = document.createDocumentFragment()
  for (const part of answer.split(/(\p{L}[\p{L}\p{N}'’-]*|\d[\d,.]*)/gu)) {
    if (!part) continue
    const w = part.toLowerCase()
    const t = /^\d/.test(w) ? w.replace(/,/g, '') : stem(w)
    frag.append(matched.has(t) && !STOP.has(w) ? h('mark', { class: 'stu-mark' }, part) : part)
  }
  return frag
}

export function mount(root) {
  toolStyle('ev', CSS)
  const st = { mode: 'model', max: 10, ...load('ev:state', {}) }
  const persist = () => save('ev:state', { mode: st.mode, max: st.max, question: st.question, model: st.model, rubric: st.rubric, answer: st.answer })
  st.question ??= ''; st.model ??= ''; st.rubric ??= ''; st.answer ??= ''

  const q = h('textarea', { class: 'textarea', rows: 2, placeholder: 'The question (optional, shown to the AI evaluator)', value: st.question, 'aria-label': 'Question', oninput: (e) => { st.question = e.target.value; persist() } })
  const ref = h('textarea', { class: 'textarea', rows: 8, 'aria-label': 'Model answer or rubric', oninput: (e) => { st[st.mode === 'model' ? 'model' : 'rubric'] = e.target.value; persist(); run() } })
  const refHint = h('div', { class: 'stu-hint' })
  const ans = h('textarea', { class: 'textarea', rows: 8, placeholder: 'Paste or type the answer to evaluate', value: st.answer, 'aria-label': 'Answer to evaluate', oninput: (e) => { st.answer = e.target.value; persist(); run() } })
  const maxIn = number(st.max, { min: 1, max: 1000, step: 0.5, ariaLabel: 'Maximum marks', onInput: (n) => { if (n > 0) { st.max = n; persist(); run() } } })
  const out = h('div', { class: 'stack' })
  const aiOut = h('div')
  const modeSeg = segmented([['model', 'Model answer'], ['rubric', 'Marking rubric']], st.mode, (v) => { st.mode = v; persist(); syncRef(); run() }, 'Reference type')
  function syncRef() {
    ref.value = st.mode === 'model' ? st.model : st.rubric
    ref.placeholder = st.mode === 'model' ? 'Paste the model answer. Each sentence becomes a point worth equal marks.' : 'One marking point per line, with marks in brackets:\nChlorophyll absorbs sunlight (2)\nOxygen is released (1)\nUse {a, b} for other accepted wordings.'
    clear(refHint, st.mode === 'model' ? 'Tip: write the model answer as short sentences, one idea each.' : 'Tip: "Stomata open {pores, openings} (1)" accepts either wording. "a / b" also works.')
  }

  let last = null
  const run = debounce(() => {
    const refText = st.mode === 'model' ? st.model : st.rubric
    if (!refText.trim() || !st.answer.trim()) { last = null; clear(out, emptyState('graduation-cap', 'Your score appears here', 'Add a model answer (or rubric) and the answer to check. Scores update as you type.', button('Try an example', { variant: 'primary', icon: 'wand-sparkles', onClick: loadSample }))); return }
    const r = evaluate({ mode: st.mode, model: st.model, rubric: st.rubric, answer: st.answer, max: st.max })
    last = r
    if (!r.points.length) { clear(out, alert('warn', st.mode === 'rubric' ? 'No rubric points found. Put one marking point on each line.' : 'The model answer needs at least one full sentence.')); return }
    draw(r)
  }, 250)

  function draw(r) {
    const [label, tone] = verdict(r.pct)
    const rg = ring({ value: r.pct, max: 100, size: 132, stroke: 12, label: 'of marks', fmt: (v) => `${Math.round(v)}%`, color: `var(--${tone})` })
    const covered = r.points.filter((p) => p.status === 'ok').length
    const missing = r.points.filter((p) => p.status !== 'ok')
    const short = r.length.reference && r.length.answer < r.length.reference * 0.4
    clear(out,
      tile({ tint: tone === 'success' ? TINTS[3] : tone === 'warning' ? TINTS[2] : TINTS[6], title: 'Score', icon: 'award' },
        h('div', { class: 'hero' }, rg,
          h('div', null, h('div', { class: 'big' }, fmtMark(Math.round(r.total * 2) / 2), h('small', ` / ${fmtMark(r.max)}`)), h('div', { style: 'margin-top:6px' }, pill(label, tone === 'success' ? 'ok' : tone === 'warning' ? 'warn' : 'bad')),
            h('div', { class: 'stu-hint', style: 'margin-top:6px' }, `${covered} of ${r.points.length} points fully covered`))),
        h('div', { class: 'two', style: 'margin-top:14px' },
          meter('Concept coverage', (r.points.reduce((t, p) => t + Math.min(1, p.coverage), 0) / r.points.length) * 100),
          meter('Overall similarity to the reference', r.similarity * 100))),
      tile({ tint: TINTS[4], title: 'Point by point', icon: 'list-checks' }, h('div', r.points.map((p, i) => h('div', { class: 'pt', style: { '--i': Math.min(i, 10) } },
        h('span', { class: ['st', p.status], 'aria-label': p.status === 'ok' ? 'covered' : p.status === 'part' ? 'partly covered' : 'missing' }, p.status === 'ok' ? '✓' : p.status === 'part' ? '~' : '✗'),
        h('div', null, h('div', { class: 'tx' }, p.text), h('div', { class: 'sub' }, p.status === 'ok' ? `Found: ${p.found.slice(0, 5).join(', ') || 'whole idea'}` : p.missing.length ? `Missing: ${p.missing.slice(0, 5).join(', ')}` : 'Not clearly covered')),
        h('span', { class: 'mk' }, `${fmtMark(p.awarded)} / ${fmtMark(p.marks)}`))))),
      tile({ tint: TINTS[1], title: 'Feedback', icon: 'message-square-text', actions: button('Copy', { size: 'sm', variant: 'ghost', icon: 'copy', onClick: () => copyText(feedbackText(r, label)) }) },
        h('div', { class: 'stack' },
          h('div', { class: 'hl' }, highlight(st.answer, r.matched)), h('div', { class: 'stu-hint' }, 'Highlighted words match ideas from the reference.'),
          h('ul', { class: 'fb' }, ...feedbackLines(r, missing, short).map((t) => h('li', t))))),
      aiTile())
  }
  const meter = (label, pct) => { const v = Math.max(0, Math.min(100, Math.round(pct))); const m = h('i', { style: { '--bc': v >= 70 ? 'var(--success)' : v >= 40 ? 'var(--warning)' : 'var(--danger)' } }); setTimeout(() => { m.style.width = v + '%' }, 60); return h('div', h('div', { class: 'row', style: 'justify-content:space-between;font-size:13px' }, h('span', label), h('b', `${v}%`)), h('div', { class: 'meter' }, m)) }
  function feedbackLines(r, missing, short) {
    const lines = []
    if (r.pct >= 85) lines.push('Strong answer: it covers nearly everything in the reference.')
    for (const p of missing.slice(0, 4)) lines.push(p.status === 'part' ? `Develop this point further: "${trim(p.text)}"${p.missing.length ? ` (mention ${p.missing.slice(0, 3).join(', ')})` : ''}.` : `Add this idea: "${trim(p.text)}".`)
    if (missing.length > 4) lines.push(`${missing.length - 4} more point${missing.length - 4 === 1 ? '' : 's'} to cover.`)
    if (short) lines.push('The answer is much shorter than the reference. Add the missing details and an example.')
    if (!missing.length && r.pct < 100) lines.push('All ideas are present. Check the wording of numbers and technical terms.')
    return lines
  }
  const trim = (s) => (s.length > 90 ? s.slice(0, 88).replace(/\s+\S*$/, '') + '...' : s)
  const feedbackText = (r, label) => [`Score: ${fmtMark(Math.round(r.total * 2) / 2)} / ${fmtMark(r.max)} (${label})`, '', ...r.points.map((p) => `${p.status === 'ok' ? '[x]' : p.status === 'part' ? '[~]' : '[ ]'} ${p.text} (${fmtMark(p.awarded)}/${fmtMark(p.marks)})`), '', 'Feedback:', ...feedbackLines(r, r.points.filter((p) => p.status !== 'ok'), false).map((l) => `- ${l}`)].join('\n')

  function aiTile() {
    const btn = button('Evaluate with AI', { icon: 'sparkles', variant: 'secondary', onClick: () => busy(btn, async () => {
      if (!(await ai.ensureKey())) return
      clear(aiOut)
      const reference = st.mode === 'model' ? `MODEL ANSWER:\n${st.model}` : `MARKING RUBRIC (points with marks):\n${st.rubric}`
      const res = await ai.ask({
        system: 'You are a fair, experienced examiner. Mark the student answer strictly against the reference. Award marks for correct ideas even when the wording differs; do not award marks for things that are wrong or missing. Be specific and kind in feedback. Never reveal the reference verbatim when giving advice.',
        prompt: `${st.question ? `QUESTION:\n${st.question}\n\n` : ''}${reference}\n\nMAXIMUM MARKS: ${st.max}\n\nSTUDENT ANSWER:\n${st.answer}`,
        json: { type: 'object', properties: { score: { type: 'number' }, verdict: { type: 'string' }, points: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, awarded: { type: 'number' }, max: { type: 'number' }, comment: { type: 'string' } }, required: ['point', 'awarded', 'max', 'comment'], additionalProperties: false } }, strengths: { type: 'array', items: { type: 'string' } }, improvements: { type: 'array', items: { type: 'string' } } }, required: ['score', 'verdict', 'points', 'strengths', 'improvements'], additionalProperties: false },
        effort: 'low', maxTokens: 6000,
      })
      const sc = Math.max(0, Math.min(st.max, Number(res.score) || 0))
      clear(aiOut, h('div', { class: 'stack', style: 'margin-top:12px' },
        h('div', { class: 'row' }, pill('AI says', 'ok', 'sparkles'), h('b', { style: 'font-size:20px' }, `${fmtMark(sc)} / ${fmtMark(st.max)}`), h('span', { class: 'muted' }, res.verdict)),
        h('div', (res.points || []).map((p) => h('div', { class: 'pt', style: 'grid-template-columns:minmax(0,1fr) auto' }, h('div', null, h('div', { class: 'tx' }, p.point), h('div', { class: 'sub' }, p.comment)), h('span', { class: 'mk' }, `${fmtMark(p.awarded)} / ${fmtMark(p.max)}`)))),
        res.strengths?.length ? h('div', null, h('b', 'What went well'), h('ul', { class: 'fb' }, ...res.strengths.map((t) => h('li', t)))) : null,
        res.improvements?.length ? h('div', null, h('b', 'How to improve'), h('ul', { class: 'fb' }, ...res.improvements.map((t) => h('li', t)))) : null))
    }, { label: 'Evaluating', errorTo: aiOut }) })
    return tile({ tint: TINTS[5], title: 'AI second opinion', icon: 'sparkles' }, h('div', { class: 'stack' }, h('div', { class: 'stu-hint' }, 'The on-device score checks wording overlap. AI understands paraphrases, spelling slips and reasoning, so use it for borderline answers.'), ai.notice('AI evaluation uses AI'), h('div', { class: 'row' }, btn), aiOut))
  }

  function loadSample() {
    st.question = SAMPLE.question; st.model = SAMPLE.model; st.rubric = SAMPLE.rubric; st.answer = SAMPLE.answer; st.max = 8
    q.value = st.question; ans.value = st.answer; maxIn.value = st.max; syncRef(); persist(); run()
  }

  const left = h('div', { class: 'side' },
    tile({ tint: TINTS[0], title: 'Reference', icon: 'book-check', actions: button('Example', { size: 'sm', variant: 'ghost', icon: 'wand-sparkles', onClick: loadSample }) }, h('div', { class: 'stack' }, field('Question', q), field('Marking against', modeSeg), ref, refHint)),
    tile({ tint: TINTS[1], title: 'Answer to check', icon: 'pen-line' }, h('div', { class: 'stack' }, ans, field('Maximum marks', maxIn))))
  root.append(stage('t-ev', h('div', { class: 'stu-bento' }, h('div', { class: 's5', style: 'min-width:0' }, left), h('div', { class: 's7', style: 'min-width:0' }, out))))
  syncRef(); run()
}
