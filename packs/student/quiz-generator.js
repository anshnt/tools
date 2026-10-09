// Quiz generator: fill-in-the-blank and short-answer questions from notes, answer key, practice mode, printable. Optional AI rewrite.
import { h, button, busy, field, segmented, toggle, alert, clear, debounce, download, toast, rangeField, copyText } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, confetti, esc, takeHandoff, ring } from './_kit.js'
import { buildBlanks, buildShort } from './_qgen.js'
import { sameAnswer } from './_text.js'
import { sourceInput, SAMPLES } from './_source.js'
import { DOC_CSS, printDoc } from './_pages.js'

const CSS = `
.t-quiz .paper { background: #fff; color: #14161f; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 18px 40px -22px rgba(20,22,40,.5); padding: 26px 28px; border: 1px solid var(--border); max-height: 760px; overflow: auto; }
.t-quiz .side { position: sticky; top: calc(var(--header-h) + 12px); display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 900px) { .t-quiz .side { position: static; } }
.t-quiz .del { opacity: 0; transition: opacity .2s; margin-left: 6px; vertical-align: middle; }
.t-quiz .q-item:hover .del, .t-quiz .q-item:focus-within .del { opacity: 1; }
@media (hover: none) { .t-quiz .del { opacity: .7; } }
.t-quiz .pq { margin: 0 0 14px; padding: 12px 14px; border-radius: 14px; border: 1px solid #dfe2ea; background: #fafbff; transition: border-color .2s, background .2s; }
.t-quiz .pq.ok { border-color: #34c38f; background: #effaf5; } .t-quiz .pq.bad { border-color: #f1707a; background: #fff3f4; animation: stu-shake .4s; }
.t-quiz .pq input[type=text] { font: inherit; width: min(220px, 60vw); padding: 2px 8px; margin: 0 4px; border: 0; border-bottom: 2px solid #6366f1; background: #eef0ff; border-radius: 6px 6px 0 0; color: #14161f; outline: none; }
.t-quiz .pq textarea { width: 100%; font: inherit; margin-top: 8px; padding: 8px 10px; border: 1px solid #cfd3e2; border-radius: 10px; background: #fff; color: #14161f; min-height: 64px; }
.t-quiz .pq .ans { margin-top: 8px; font-size: .92em; color: #0f6b46; }
.t-quiz .pq button.lnk { background: none; border: 0; color: #4f46e5; cursor: pointer; font: inherit; padding: 4px 0; text-decoration: underline; }
.t-quiz .ai-chip { display: inline-flex; gap: 5px; align-items: center; }
`

const BLANK = '________'
const plainQ = (q) => String(q).replace(/_{4,}/g, BLANK)

export function quizHtml({ title, blanks, shorts, marks, key = true, showMarks = true }) {
  const total = blanks.length * marks.blank + shorts.length * marks.short
  const mk = (n) => (showMarks ? `<span class="q-mk">${n} mark${n === 1 ? '' : 's'}</span>` : '')
  let n = 0
  const secA = blanks.length ? `<section class="q-sec"><h3>Section A: Fill in the blanks</h3><ol class="q-list" start="1">${blanks.map((b) => { n++; return `<li class="q-item">${mk(marks.blank)}${esc(plainQ(b.q)).replace(BLANK, '<span class="q-blank">&nbsp;</span>')}</li>` }).join('')}</ol></section>` : ''
  const secB = shorts.length ? `<section class="q-sec"><h3>${blanks.length ? 'Section B' : 'Section A'}: Short answer</h3><ol class="q-list" start="${n + 1}">${shorts.map((s) => `<li class="q-item">${mk(marks.short)}${esc(s.q)}<div class="q-lines"></div></li>`).join('')}</ol></section>` : ''
  const keyHtml = key ? `<section class="q-key" style="break-before:page"><h2>Answer key</h2><ol class="q-list" start="1">${[...blanks, ...shorts].map((x) => `<li class="q-item"><span class="qk-a">${esc(x.a)}</span></li>`).join('')}</ol></section>` : ''
  return `<h1>${esc(title)}</h1><div class="q-meta"><span>Name: ______________________</span><span>Date: ____________</span>${showMarks ? `<span>Score: ______ / ${total}</span>` : ''}</div>${secA}${secB}${keyHtml}`
}

export function quizText({ title, blanks, shorts, marks, showMarks = true }) {
  const total = blanks.length * marks.blank + shorts.length * marks.short
  let n = 0
  const out = [title, showMarks ? `Total marks: ${total}` : '', '']
  if (blanks.length) { out.push('Section A: Fill in the blanks'); for (const b of blanks) out.push(`${++n}. ${plainQ(b.q)}${showMarks ? ` [${marks.blank}]` : ''}`); out.push('') }
  if (shorts.length) { out.push(`${blanks.length ? 'Section B' : 'Section A'}: Short answer`); for (const s of shorts) out.push(`${++n}. ${s.q}${showMarks ? ` [${marks.short}]` : ''}`, ''); }
  out.push('ANSWER KEY'); n = 0
  for (const x of [...blanks, ...shorts]) out.push(`${++n}. ${x.a}`)
  return out.join('\n')
}

export function mount(root) {
  toolStyle('quiz', CSS)
  toolStyle('pgdoc', DOC_CSS)
  const prefs = { nBlank: 8, nShort: 4, marksBlank: 1, marksShort: 2, showMarks: true, showKey: true, title: 'Quick quiz', ...load('quiz:prefs', {}) }
  const S = { seed: 1, blanks: [], shorts: [], aiMade: false, view: 'sheet' }
  const savePrefs = () => save('quiz:prefs', prefs)

  const src = sourceInput({ placeholder: 'Paste your notes here. Sentences with key terms, names, dates and numbers make the best blanks; definitions ("X is ...") make the best short answers.', sample: 'history', rows: 12 })
  const handoff = takeHandoff('quiz-generator')
  if (typeof handoff === 'string') src.set(handoff)
  const paper = h('div', { class: 'paper' })
  const info = h('div')
  const aiOut = h('div')
  const practiceInfo = h('div')

  const marks = () => ({ blank: prefs.marksBlank, short: prefs.marksShort })
  function generate(resetSeed) {
    if (resetSeed) S.seed = 1
    S.aiMade = false
    const text = src.get()
    if (text.trim().length < 60) { S.blanks = []; S.shorts = []; paint(); return }
    S.blanks = prefs.nBlank ? buildBlanks(text, { max: prefs.nBlank, seed: S.seed }) : []
    S.shorts = prefs.nShort ? buildShort(text, { max: prefs.nShort, seed: S.seed }) : []
    paint()
  }
  const regen = debounce(() => generate(true), 350)
  src.onInput(regen)

  function paint() {
    clear(aiOut)
    const n = S.blanks.length + S.shorts.length
    if (!src.get().trim()) { clear(paper, emptyState('list-checks', 'Your quiz appears here', 'Paste notes on the left, or try the sample, and questions are made instantly on your device.', button('Try a sample', { variant: 'primary', icon: 'wand-sparkles', onClick: () => src.set(SAMPLES.history) }))); clear(info, ); return }
    if (!n) { clear(paper, emptyState('circle-help', 'Not enough to ask about yet', 'Add more text, or write full sentences with key terms and numbers. AI can also write questions from rougher notes.')); clear(info, ); return }
    clear(info, pill(`${S.blanks.length} blank${S.blanks.length === 1 ? '' : 's'}`, '', 'text-cursor-input'), ' ', pill(`${S.shorts.length} short answer`, '', 'message-square-text'), ' ', S.aiMade ? h('span', { class: 'stu-pill ok ai-chip' }, 'Written by AI') : null)
    S.view === 'sheet' ? drawSheet() : drawPractice()
  }

  function drawSheet() {
    const total = S.blanks.length * prefs.marksBlank + S.shorts.length * prefs.marksShort
    let n = 0
    const li = (arr, kind) => arr.map((x, i) => {
      n++
      return h('li', { class: 'q-item' }, prefs.showMarks ? h('span', { class: 'q-mk' }, `${kind === 'b' ? prefs.marksBlank : prefs.marksShort} mark${(kind === 'b' ? prefs.marksBlank : prefs.marksShort) === 1 ? '' : 's'}`) : null,
        kind === 'b' ? blankNodes(x.q) : x.q,
        h('button', { class: 'btn btn-ghost btn-sm btn-icon del', type: 'button', 'aria-label': `Remove question ${n}`, title: 'Remove this question', onclick: () => { arr.splice(i, 1); paint() } }, '×'),
        kind === 's' ? h('div', { class: 'q-lines' }) : null)
    })
    const startB = S.blanks.length + 1
    clear(paper, h('div', { class: 'pgdoc', style: { '--pg-fs': '14px', '--pg-accent': '#6366f1' } },
      h('h1', prefs.title),
      h('div', { class: 'q-meta' }, h('span', 'Name: ______________________'), h('span', 'Date: ____________'), prefs.showMarks ? h('span', `Score: ______ / ${total}`) : null),
      S.blanks.length ? h('section', { class: 'q-sec' }, h('h3', 'Section A: Fill in the blanks'), h('ol', { class: 'q-list' }, li(S.blanks, 'b'))) : null,
      S.shorts.length ? h('section', { class: 'q-sec' }, h('h3', `${S.blanks.length ? 'Section B' : 'Section A'}: Short answer`), h('ol', { class: 'q-list', start: startB }, li(S.shorts, 's'))) : null,
      prefs.showKey ? h('section', { class: 'q-key' }, h('h2', 'Answer key'), h('ol', { class: 'q-list' }, [...S.blanks, ...S.shorts].map((x) => h('li', { class: 'q-item' }, h('span', { class: 'qk-a' }, x.a))))) : null))
  }
  const blankNodes = (q) => { const parts = plainQ(q).split(BLANK); return parts.flatMap((p, i) => (i < parts.length - 1 ? [p, h('span', { class: 'q-blank' }, ' ')] : [p])) }

  function drawPractice() {
    const fields = []
    const cards = []
    let n = 0
    for (const b of S.blanks) {
      n++
      const parts = plainQ(b.q).split(BLANK)
      const inps = parts.slice(0, -1).map(() => h('input', { type: 'text', 'aria-label': `Answer to question ${n}`, autocomplete: 'off', spellcheck: false, oninput: (e) => { for (const o of inps) o.value = e.target.value } }))
      const inp = inps[0]
      const card = h('div', { class: 'pq' }, h('b', `${n}. `), parts.flatMap((p, i) => (i < parts.length - 1 ? [p, inps[i]] : [p])), h('div', { class: 'ans', hidden: true }))
      fields.push({ kind: 'b', inp, inps, b, card }); cards.push(card)
    }
    for (const s of S.shorts) {
      n++
      const ta = h('textarea', { 'aria-label': `Answer to question ${n}`, placeholder: 'Write your answer in your own words' })
      const ans = h('div', { class: 'ans', hidden: true }, h('b', 'Model answer: '), s.a)
      const reveal = h('button', { class: 'lnk', type: 'button', onclick: () => { ans.hidden = !ans.hidden; reveal.textContent = ans.hidden ? 'Show model answer' : 'Hide model answer' } }, 'Show model answer')
      cards.push(h('div', { class: 'pq' }, h('b', `${n}. `), s.q, ta, h('div', reveal), ans))
    }
    const score = h('div')
    const check = button('Check my answers', { variant: 'primary', icon: 'check-check', onClick: () => {
      let right = 0
      for (const f of fields) {
        const ok = sameAnswer(f.inp.value, f.b.a)
        if (ok) right++
        f.card.classList.remove('ok', 'bad'); void f.card.offsetWidth
        f.card.classList.add(ok ? 'ok' : 'bad')
        const a = f.card.querySelector('.ans')
        a.hidden = ok
        if (!ok) { a.replaceChildren(h('b', 'Answer: '), f.b.a) }
      }
      const pct = fields.length ? Math.round((right / fields.length) * 100) : 0
      const r = ring({ value: pct, max: 100, size: 96, stroke: 10, label: 'blanks', fmt: (v) => `${Math.round(v)}%`, color: pct >= 70 ? 'var(--success)' : 'var(--warning)' })
      clear(score, h('div', { class: 'row', style: 'margin-top:10px' }, r, h('div', h('b', `${right} of ${fields.length} blanks right`), h('div', { class: 'stu-hint' }, 'Short answers are for you to compare with the model answer.'))))
      if (pct >= 80) confetti(r, { count: 60 })
    } })
    clear(paper, h('div', { class: 'pgdoc', style: { '--pg-fs': '14px' } }, h('h1', prefs.title)), h('div', cards), fields.length ? h('div', { class: 'row' }, check, button('Clear', { variant: 'ghost', onClick: () => { for (const f of fields) { for (const o of f.inps) o.value = ''; f.card.classList.remove('ok', 'bad'); f.card.querySelector('.ans').hidden = true } clear(score) } })) : null, score)
  }

  // ---- AI
  const aiBtn = button('Rewrite with AI', { icon: 'sparkles', variant: 'secondary', onClick: () => busy(aiBtn, async () => {
    const text = src.get()
    if (text.trim().length < 60) throw new Error('Paste some notes first.')
    if (!(await ai.ensureKey())) return
    clear(aiOut)
    const res = await ai.ask({
      system: 'You are an experienced teacher who writes clear, fair quiz questions strictly from the notes provided. Never use facts that are not in the notes.',
      prompt: `Write ${prefs.nBlank} fill-in-the-blank questions and ${prefs.nShort} short-answer questions from these notes. For blanks, write one sentence with the key word or number replaced by ${BLANK} and give exactly that answer. For short answers, ask a question that needs one or two sentences and give a concise model answer. Keep the language of the notes.\n\nNOTES:\n${text.slice(0, 40000)}`,
      json: { type: 'object', properties: { blanks: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'], additionalProperties: false } }, shorts: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'], additionalProperties: false } } }, required: ['blanks', 'shorts'], additionalProperties: false },
      effort: 'low', maxTokens: 8000,
    })
    S.blanks = (res.blanks || []).filter((b) => b.q && b.a).map((b) => ({ ...b, q: /_{3,}/.test(b.q) ? b.q : `${b.q} ${BLANK}`, kind: 'ai' }))
    S.shorts = (res.shorts || []).filter((b) => b.q && b.a).map((b) => ({ ...b, kind: 'ai' }))
    S.aiMade = true
    paint()
  }, { label: 'Writing questions', errorTo: aiOut }) })

  const more = button('Another set', { icon: 'shuffle', variant: 'secondary', onClick: () => { S.seed++; generate(false) } })
  const viewSeg = segmented([['sheet', 'Worksheet'], ['practice', 'Practise online']], S.view, (v) => { S.view = v; paint() }, 'View')
  const titleIn = h('input', { class: 'input', value: prefs.title, 'aria-label': 'Quiz title', oninput: (e) => { prefs.title = e.target.value || 'Quiz'; savePrefs(); paint() } })

  const getData = () => ({ title: prefs.title, blanks: S.blanks, shorts: S.shorts, marks: marks(), showMarks: prefs.showMarks })
  const need = () => { if (!S.blanks.length && !S.shorts.length) { toast('Make a quiz first', 'error'); return false } return true }
  const pr = (key) => button(key ? 'Print with answer key' : 'Print quiz only', { icon: 'printer', variant: key ? 'primary' : 'secondary', onClick: () => { if (need()) printDoc(quizHtml({ ...getData(), key }), { marginMm: 16, fontSize: 14, title: prefs.title }) } })

  const left = h('div', { class: 'side' },
    tile({ tint: TINTS[0], title: 'Your notes', icon: 'notebook-pen' }, src.el),
    tile({ tint: TINTS[2], title: 'Options', icon: 'sliders-horizontal' }, h('div', { class: 'stack' },
      field('Quiz title', titleIn),
      rangeField('Fill in the blank', { min: 0, max: 20, step: 1, value: prefs.nBlank, format: (v) => `${v} questions`, onInput: (v) => { prefs.nBlank = v; savePrefs(); regen() } }),
      rangeField('Short answer', { min: 0, max: 12, step: 1, value: prefs.nShort, format: (v) => `${v} questions`, onInput: (v) => { prefs.nShort = v; savePrefs(); regen() } }),
      h('div', { class: 'row' }, toggle('Show marks', prefs.showMarks, (v) => { prefs.showMarks = v; savePrefs(); paint() }), toggle('Answer key on sheet', prefs.showKey, (v) => { prefs.showKey = v; savePrefs(); paint() })),
      h('div', { class: 'row' }, more, aiBtn), ai.notice('AI rewrite uses AI'), aiOut)))
  const right = h('div', { class: 'stack', style: 'min-width:0' },
    tile({ tint: TINTS[4], title: 'Your quiz', icon: 'list-checks', actions: info }, h('div', { class: 'stack' }, h('div', { class: 'row' }, viewSeg), paper)),
    h('div', { class: 'row' }, pr(true), pr(false),
      button('Copy text', { icon: 'copy', onClick: () => { if (need()) copyText(quizText(getData())) } }),
      button('Download .txt', { icon: 'download', onClick: () => { if (need()) download(quizText(getData()), `${prefs.title.replace(/[^\w-]+/g, '-').toLowerCase() || 'quiz'}.txt`, 'text/plain') } })))
  root.append(stage('t-quiz', h('div', { class: 'stu-bento' }, h('div', { class: 's5', style: 'min-width:0' }, left), h('div', { class: 's7', style: 'min-width:0' }, right))))
  if (src.get().trim()) generate(true); else paint()
}
