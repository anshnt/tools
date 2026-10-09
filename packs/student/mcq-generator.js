// MCQ generator: multiple-choice questions with answers and explanations. AI writes the best ones; without a key a local builder
// makes cloze and definition questions and uses other key terms from the text as wrong options.
import { h, button, busy, field, segmented, alert, clear, debounce, download, toast, rangeField, copyText } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, confetti, esc, takeHandoff, ring } from './_kit.js'
import { buildMcqs } from './_qgen.js'
import { shuffle } from './_text.js'
import { sourceInput, SAMPLES } from './_source.js'
import { DOC_CSS, printDoc } from './_pages.js'

const CSS = `
.t-mcq .side { position: sticky; top: calc(var(--header-h) + 12px); display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 900px) { .t-mcq .side { position: static; } }
.t-mcq .q { padding: 14px 16px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); margin-bottom: 12px; animation: stu-pop .45s var(--ease) both; animation-delay: calc(var(--i, 0) * 45ms); }
.t-mcq .q .qt { font-weight: 600; font-size: 15.5px; line-height: 1.45; margin-bottom: 10px; display: flex; gap: 10px; }
.t-mcq .q .qt .num { flex: none; width: 26px; height: 26px; border-radius: 9px; display: grid; place-items: center; font-size: 13px; background: var(--surface-3); color: var(--text-2); }
.t-mcq .opts { display: grid; gap: 7px; }
.t-mcq .opt { display: grid; grid-template-columns: 26px minmax(0, 1fr) 22px; gap: 10px; align-items: center; text-align: left; width: 100%; padding: 9px 12px; border-radius: 12px; border: 1.5px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 14.5px; cursor: pointer; transition: border-color .2s, background .2s, transform .2s var(--ease); min-height: 44px; overflow-wrap: anywhere; }
.t-mcq .opt:hover:not(:disabled) { border-color: var(--accent); transform: translateX(3px); }
.t-mcq .opt .L { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 650; background: var(--surface-3); color: var(--text-2); }
.t-mcq .opt .mk { display: grid; place-items: center; }
.t-mcq .opt.right { border-color: var(--success); background: var(--success-soft); } .t-mcq .opt.right .L { background: var(--success); color: #fff; }
.t-mcq .opt.wrong { border-color: var(--danger); background: var(--danger-soft); animation: stu-shake .4s; } .t-mcq .opt.wrong .L { background: var(--danger); color: #fff; }
.t-mcq .opt:disabled { cursor: default; color: var(--text); opacity: 1; }
.t-mcq .why { margin-top: 10px; padding: 9px 12px; border-radius: 12px; background: var(--surface-2); font-size: 13.5px; color: var(--text-2); line-height: 1.5; animation: stu-pop .35s var(--ease) both; }
.t-mcq .why b { color: var(--text); }
.t-mcq .score { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
`

const LETTERS = 'ABCDE'
const plain = (s) => String(s).replace(/_{4,}/g, '________')

export function mcqHtml(qs, { title = 'Multiple choice quiz', key = true, explain = true } = {}) {
  const items = qs.map((q) => `<li class="q-item">${esc(plain(q.q))}<ol class="q-opts">${q.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ol></li>`).join('')
  const keyHtml = key ? `<section class="q-key" style="break-before:page"><h2>Answer key</h2><ol class="q-list">${qs.map((q) => `<li class="q-item"><span class="qk-a">${LETTERS[q.answer]}. ${esc(q.options[q.answer])}</span>${explain && q.explanation ? `<div class="qk-x">${esc(q.explanation)}</div>` : ''}</li>`).join('')}</ol></section>` : ''
  return `<h1>${esc(title)}</h1><div class="q-meta"><span>Name: ______________________</span><span>Date: ____________</span><span>Score: ______ / ${qs.length}</span></div><ol class="q-list">${items}</ol>${keyHtml}`
}

export function mcqText(qs, { explain = true } = {}) {
  const out = []
  qs.forEach((q, i) => { out.push(`${i + 1}. ${plain(q.q)}`); q.options.forEach((o, j) => out.push(`   ${LETTERS[j]}) ${o}`)); out.push('') })
  out.push('ANSWER KEY')
  qs.forEach((q, i) => out.push(`${i + 1}. ${LETTERS[q.answer]}${explain && q.explanation ? ` - ${q.explanation}` : ''}`))
  return out.join('\n')
}

/** Moodle GIFT: one question per block. Special characters ~ = # { } : are escaped. */
export function mcqGift(qs) {
  const e = (s) => String(s).replace(/([~=#{}:\\])/g, '\\$1').replace(/\r?\n/g, ' ')
  return qs.map((q, i) => `::Q${i + 1}:: ${e(plain(q.q))} {\n${q.options.map((o, j) => `${j === q.answer ? '=' : '~'}${e(o)}`).join('\n')}${q.explanation ? `\n#${e(q.explanation)}` : ''}\n}`).join('\n\n') + '\n'
}

export function mcqCsv(qs) {
  const cell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  const n = Math.max(...qs.map((q) => q.options.length), 4)
  const head = ['Question', ...Array.from({ length: n }, (_, i) => `Option ${LETTERS[i]}`), 'Answer', 'Explanation']
  return [head, ...qs.map((q) => [plain(q.q), ...Array.from({ length: n }, (_, i) => q.options[i] ?? ''), LETTERS[q.answer], q.explanation || ''])].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

function cleanAi(list, nOpts) {
  const out = []
  for (const q of list || []) {
    const opts = [...new Set((q.options || []).map((o) => String(o).trim()).filter(Boolean))]
    const ans = Number.isInteger(q.answer) ? q.answer : LETTERS.indexOf(String(q.answer).toUpperCase())
    if (!q.q || opts.length < 3 || !(ans >= 0 && ans < (q.options || []).length)) continue
    const correct = String(q.options[ans]).trim()
    let use = opts.slice(0, Math.max(nOpts, 3))
    if (!use.includes(correct)) use = [...use.slice(0, use.length - 1), correct]
    use = shuffle(use)
    out.push({ q: String(q.q).trim(), options: use, answer: use.indexOf(correct), explanation: String(q.explanation || '').trim(), kind: 'ai' })
  }
  return out
}

export function mount(root) {
  toolStyle('mcq', CSS)
  toolStyle('pgdoc', DOC_CSS)
  const prefs = { engine: 'local', n: 8, opts: 4, level: 'medium', title: 'Multiple choice quiz', ...load('mcq:prefs', {}) }
  const S = { qs: [], seed: 1, answered: new Map(), made: '' }
  const savePrefs = () => save('mcq:prefs', prefs)

  const src = sourceInput({ placeholder: 'Paste your notes or a textbook section. The more specific facts, names and numbers, the better the questions.', sample: 'biology', rows: 12 })
  const handoff = takeHandoff('mcq-generator')
  if (typeof handoff === 'string') src.set(handoff)
  const listBox = h('div')
  const info = h('div')
  const scoreBox = h('div')
  const genOut = h('div')

  function paint() {
    clear(scoreBox)
    if (!S.qs.length) {
      clear(listBox, emptyState('circle-check', 'Your questions appear here', prefs.engine === 'local' ? 'Paste notes on the left, or try the sample. Questions are built on your device as you type.' : 'Paste notes on the left and press "Write questions with AI".',
        button('Try a sample', { variant: 'primary', icon: 'wand-sparkles', onClick: () => src.set(SAMPLES.biology) })))
      info.replaceChildren(); return
    }
    info.replaceChildren(pill(`${S.qs.length} question${S.qs.length === 1 ? '' : 's'}`, '', 'circle-check'), ' ', pill(S.made === 'ai' ? 'Written by AI' : 'Built on this device', S.made === 'ai' ? 'ok' : '', S.made === 'ai' ? 'sparkles' : 'cpu'))
    clear(listBox, S.qs.map((q, qi) => {
      const optEls = q.options.map((o, oi) => {
        const b = h('button', { type: 'button', class: 'opt', onclick: () => pick(qi, oi) }, h('span', { class: 'L' }, LETTERS[oi]), h('span', o), h('span', { class: 'mk' }))
        return b
      })
      const card = h('div', { class: 'q', style: { '--i': Math.min(qi, 12) }, dataset: { qi } }, h('div', { class: 'qt' }, h('span', { class: 'num' }, qi + 1), h('span', plain(q.q))), h('div', { class: 'opts' }, optEls), h('div', { class: 'why-box' }))
      const a = S.answered.get(qi)
      if (a != null) reveal(card, q, a)
      return card
    }))
    updateScore()
  }

  function reveal(card, q, chosen) {
    const btns = [...card.querySelectorAll('.opt')]
    btns.forEach((b, i) => {
      b.disabled = true
      if (i === q.answer) { b.classList.add('right'); b.querySelector('.mk').textContent = '✓' }
      else if (i === chosen) { b.classList.add('wrong'); b.querySelector('.mk').textContent = '✗' }
    })
    clear(card.querySelector('.why-box'), q.explanation || chosen !== q.answer ? h('div', { class: 'why' }, chosen === q.answer ? h('b', 'Correct. ') : h('b', `The answer is ${LETTERS[q.answer]}. `), q.explanation || '') : null)
  }
  function pick(qi, oi) {
    if (S.answered.has(qi)) return
    S.answered.set(qi, oi)
    reveal(listBox.querySelector(`[data-qi="${qi}"]`), S.qs[qi], oi)
    updateScore()
  }
  function updateScore() {
    const done = S.answered.size
    if (!done) { clear(scoreBox); return }
    const right = [...S.answered].filter(([qi, oi]) => S.qs[qi]?.answer === oi).length
    const pct = Math.round((right / S.qs.length) * 100)
    const r = ring({ value: pct, max: 100, size: 84, stroke: 9, label: 'score', fmt: (v) => `${Math.round(v)}%`, color: pct >= 70 ? 'var(--success)' : 'var(--warning)' })
    clear(scoreBox, h('div', { class: 'score' }, r, h('div', h('b', `${right} right out of ${done} answered`), h('div', { class: 'stu-hint' }, done === S.qs.length ? (pct >= 80 ? 'Excellent work!' : 'Done. Try another set to practise more.') : `${S.qs.length - done} to go`)),
      button('Reset answers', { size: 'sm', variant: 'ghost', icon: 'rotate-ccw', onClick: () => { S.answered.clear(); paint() } })))
    if (done === S.qs.length && pct >= 80) confetti(r, { count: 70 })
  }

  function generateLocal(reset) {
    if (reset) S.seed = 1
    const text = src.get()
    S.answered.clear()
    if (text.trim().length < 80) { S.qs = []; S.made = ''; paint(); return }
    S.qs = buildMcqs(text, { max: prefs.n, seed: S.seed, options: prefs.opts }); S.made = 'local'
    paint()
    if (S.qs.length && S.qs.length < prefs.n) clear(genOut, alert('info', `Only ${S.qs.length} question${S.qs.length === 1 ? '' : 's'} could be built from this text on your device. Add more notes, or use AI for more.`))
    else clear(genOut)
  }
  const regen = debounce(() => { if (prefs.engine === 'local') generateLocal(true) }, 350)
  src.onInput(regen)

  const aiBtn = button('Write questions with AI', { icon: 'sparkles', variant: 'primary', onClick: () => busy(aiBtn, async () => {
    const text = src.get()
    if (text.trim().length < 60) throw new Error('Paste some notes first.')
    if (!(await ai.ensureKey())) return
    clear(genOut)
    const res = await ai.ask({
      system: 'You are an experienced exam-setter. You write clear multiple-choice questions strictly from the supplied notes. Every question has exactly one correct option; wrong options are plausible, similar in length and style, and clearly wrong to someone who studied the notes. Never write "all of the above" or "none of the above". Never use facts that are not in the notes.',
      prompt: `Write ${prefs.n} ${prefs.level} multiple-choice questions with ${prefs.opts} options each from these notes. Spread the questions across the topics. Give the index (starting at 0) of the correct option and a one-sentence explanation quoting or paraphrasing the notes. Use the language of the notes.\n\nNOTES:\n${text.slice(0, 40000)}`,
      json: { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' }, explanation: { type: 'string' } }, required: ['q', 'options', 'answer', 'explanation'], additionalProperties: false } } }, required: ['questions'], additionalProperties: false },
      effort: 'low', maxTokens: 12000,
    })
    S.qs = cleanAi(res.questions, prefs.opts); S.made = 'ai'; S.answered.clear()
    if (!S.qs.length) throw new Error('AI did not return usable questions. Try again with more text.')
    paint()
  }, { label: 'Writing questions', errorTo: genOut }) })
  const localBtn = button('Another set', { icon: 'shuffle', variant: 'secondary', onClick: () => { S.seed++; generateLocal(false) } })

  const engineSeg = segmented([['local', 'On this device'], ['ai', 'With AI']], prefs.engine, (v) => { prefs.engine = v; savePrefs(); drawEngine(); if (v === 'local') generateLocal(true); else { S.qs = []; paint() } }, 'Engine')
  const engineBox = h('div', { class: 'stack' })
  function drawEngine() {
    clear(engineBox, prefs.engine === 'local'
      ? [h('div', { class: 'stu-hint' }, 'Builds fill-in and definition questions, using other key terms from your notes as the wrong options. Free and private.'), h('div', { class: 'row' }, localBtn)]
      : [ai.notice('AI questions use AI'), h('div', { class: 'row' }, aiBtn), h('div', { class: 'stu-hint' }, 'AI reads your notes and writes better wrong options and explanations. Your text goes to Anthropic under your own API key.')])
  }
  const titleIn = h('input', { class: 'input', value: prefs.title, 'aria-label': 'Quiz title', oninput: (e) => { prefs.title = e.target.value || 'Quiz'; savePrefs() } })
  const levelSeg = segmented([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], prefs.level, (v) => { prefs.level = v; savePrefs() }, 'Difficulty')

  const need = () => { if (!S.qs.length) { toast('Make some questions first', 'error'); return false } return true }
  const slug = () => prefs.title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'mcq'
  const left = h('div', { class: 'side' },
    tile({ tint: TINTS[0], title: 'Your notes', icon: 'notebook-pen' }, src.el),
    tile({ tint: TINTS[2], title: 'Options', icon: 'sliders-horizontal' }, h('div', { class: 'stack' },
      field('How should the questions be made?', engineSeg), engineBox,
      rangeField('Number of questions', { min: 3, max: 25, step: 1, value: prefs.n, format: (v) => String(v), onInput: (v) => { prefs.n = v; savePrefs(); regen() } }),
      field('Options per question', segmented([['3', '3'], ['4', '4'], ['5', '5']], String(prefs.opts), (v) => { prefs.opts = +v; savePrefs(); regen() }, 'Options per question')),
      field('Difficulty (AI only)', levelSeg), field('Quiz title', titleIn), genOut)))
  const right = h('div', { class: 'stack', style: 'min-width:0' },
    tile({ tint: TINTS[4], title: 'Your questions', icon: 'circle-check', actions: info }, h('div', { class: 'stack' }, scoreBox, listBox)),
    h('div', { class: 'row' },
      button('Print with answer key', { icon: 'printer', variant: 'primary', onClick: () => { if (need()) printDoc(mcqHtml(S.qs, { title: prefs.title }), { marginMm: 16, fontSize: 14, title: prefs.title }) } }),
      button('Print quiz only', { icon: 'printer', onClick: () => { if (need()) printDoc(mcqHtml(S.qs, { title: prefs.title, key: false }), { marginMm: 16, fontSize: 14, title: prefs.title }) } }),
      button('Copy text', { icon: 'copy', onClick: () => { if (need()) copyText(mcqText(S.qs)) } })),
    h('div', { class: 'row' },
      button('Moodle GIFT', { icon: 'download', size: 'sm', variant: 'secondary', onClick: () => { if (need()) download(mcqGift(S.qs), `${slug()}.gift.txt`, 'text/plain') } }),
      button('CSV', { icon: 'download', size: 'sm', variant: 'secondary', onClick: () => { if (need()) download('﻿' + mcqCsv(S.qs), `${slug()}.csv`, 'text/csv;charset=utf-8') } }),
      button('JSON', { icon: 'download', size: 'sm', variant: 'secondary', onClick: () => { if (need()) download(JSON.stringify(S.qs, null, 1), `${slug()}.json`, 'application/json') } })))
  root.append(stage('t-mcq', h('div', { class: 'stu-bento' }, h('div', { class: 's5', style: 'min-width:0' }, left), h('div', { class: 's7', style: 'min-width:0' }, right))))
  drawEngine()
  if (prefs.engine === 'local' && src.get().trim()) generateLocal(true); else paint()
}
