// Interview prep: likely questions from your role and the job post (behavioral, situational, skill based, from the responsibilities),
// a STAR answer builder with a practice timer, a prepared checklist, questions to ask them, Word export and optional Claude coaching.
import { h, icon, button, busy, toast, alert, segmented, field, input, textarea, select, clear, copyText, debounce, onCleanup } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, fi, saveAs, burst, renderMarkdown, chip } from './_kit.js'
import { analyzeJD } from './_jd.js'
import { blocksToDocx } from './_doc.js'

const KEY = 'interview:state', JD_KEY = 'career:jd'

const BEHAVIORAL = [
  'Tell me about yourself.', 'Why do you want to work at {company}?', 'Why are you interested in the {role} role?', 'What are your greatest strengths?',
  'What is your biggest weakness, and what are you doing about it?', 'Tell me about a time you faced a conflict at work. How did you handle it?', 'Describe the project you are most proud of.',
  'Tell me about a time you failed. What did you learn?', 'Describe a time you took the lead without being asked.', 'How do you handle tight deadlines and competing priorities?',
  'Tell me about a time you disagreed with your manager.', 'Describe a time you had to learn something new quickly.', 'How do you respond to critical feedback?',
  'Tell me about a time you went above and beyond.', 'Why are you leaving your current job?', 'What motivates you at work?', 'Tell me about a mistake you made and how you fixed it.',
  'What would you do in your first 90 days as {role}?', 'Where do you see yourself in five years?', 'What are your salary expectations?',
]
const SITUATIONAL = [
  'A stakeholder keeps changing requirements mid-project. What do you do?', 'You inherit a project that is already behind schedule. How do you get it back on track?',
  'Two teammates disagree and it is slowing the team down. How do you step in?', 'You spot a serious mistake in work that has already been shared. What do you do?',
  'You have three urgent tasks and only time for one. How do you decide?', 'A customer or client is unhappy with your team. How do you handle the conversation?',
]
const ASK = [
  'What does success look like in this role in the first six months?', 'How is the team structured, and who would I work with most closely?', 'What are the biggest challenges the team is facing right now?',
  'How do you give feedback and measure performance?', 'What does a typical week look like?', 'How has this role changed since it was created?', 'What do you enjoy most about working here?',
  'What are the next steps in the hiring process, and when can I expect to hear back?',
]
const TECH = {
  default: ['Walk me through the most complex thing you have done with {skill}.', 'What trade-offs or limits of {skill} have you run into, and how did you work around them?', 'How do you check that your work with {skill} is correct before you hand it over?'],
  'Programming languages': ['Walk me through the most complex thing you have built in {skill}.', 'How do you keep {skill} code readable and maintainable on a team?', 'How do you debug a hard-to-reproduce bug in {skill}?'],
  Frontend: ['How do you structure a large {skill} application and manage its state?', 'How have you improved performance or accessibility using {skill}?', 'Describe a tricky bug you fixed in {skill}.'],
  'Backend and APIs': ['Describe how you designed and built something with {skill}, and what you would change now.', 'How do you handle errors, scale and security when working with {skill}?', 'How do you test and monitor {skill} in production?'],
  Databases: ['How do you design a schema and indexes in {skill} for a new feature?', 'Tell me about a slow query you diagnosed in {skill} and how you fixed it.', 'How do you handle migrations and backups in {skill}?'],
  'Cloud and DevOps': ['Describe a deployment or incident you handled with {skill}.', 'How do you keep {skill} costs and security under control?', 'How would you automate and monitor a release using {skill}?'],
  'Data, ML and AI': ['How do you validate results and avoid misleading conclusions when using {skill}?', 'Describe an analysis or model with {skill} that changed a business decision.', 'How do you handle messy or missing data in {skill}?'],
  'Testing and QA': ['How do you decide what to test with {skill} and what to leave out?', 'Describe a bug that {skill} helped you catch, and the impact.', 'How do you keep {skill} tests reliable and fast?'],
  'Design and creative': ['Walk me through a project where you used {skill} from brief to final result.', 'How do you handle critical feedback on work made with {skill}?', 'How do you balance user needs and business goals in your {skill} work?'],
  'Product and project management': ['Describe a time you used {skill} to deliver something on time.', 'How do you decide what not to do when applying {skill}?', 'What metrics tell you {skill} is working for your team?'],
  'Marketing and content': ['Describe a {skill} campaign you ran: goal, approach and measured result.', 'Which metrics do you track for {skill}, and why?', 'How would you improve results with {skill} on a small budget?'],
  'Sales and customer success': ['Tell me about a deal or account you won using {skill}.', 'How do you handle objections or churn risk when applying {skill}?', 'How do you plan and forecast around {skill}?'],
  'Finance and accounting': ['Describe an analysis or close process where you used {skill}.', 'How do you make sure {skill} work is accurate and auditable?', 'Tell me about an error you caught in {skill} and what you changed.'],
  'Soft skills': ['Give a specific example where your {skill} made a difference.', 'When has {skill} been hard for you, and what did you do?'],
}
const LEVEL = { entry: 'Keep examples from internships, projects or studies if you have little work history.', mid: 'Aim for examples with your own measurable impact and what you learned.', senior: 'Lead with scope, decisions you owned and the people you grew.', lead: 'Show how you set direction, grew people and handled trade-offs across teams.' }

const rep = (s, v) => s.replace(/the \{role\} role/g, v.role ? `the ${v.role} role` : 'this role').replace(/as \{role\}/g, v.role ? `as ${v.role}` : 'in this role').replace(/\{role\}/g, v.role || 'this role').replace(/\{company\}/g, v.company || 'our company').replace(/\{skill\}/g, v.skill || 'this')
const pick = (arr, n) => arr.slice(0, n)

/** Build the question list. Pure: same inputs give the same list. */
export function buildQuestions({ role = '', company = '', jd = '', focus = ['behavioral', 'skills', 'situational', 'job'], level = 'mid' } = {}) {
  const out = []
  const add = (cat, q, extra = {}) => { if (!out.some((x) => x.q === q)) out.push({ id: `${cat}:${q}`.slice(0, 160), cat, q, ...extra }) }
  const v = { role, company }
  const a = jd && jd.trim().length > 60 ? analyzeJD(jd) : null
  if (focus.includes('behavioral')) pick(BEHAVIORAL, level === 'entry' ? 14 : 16).forEach((q) => add('Behavioral', rep(q, v)))
  if (focus.includes('skills') && a) {
    const must = a.skills.filter((s) => s.level === 'must').sort((x, y) => y.count - x.count).slice(0, 6)
    for (const s of must) { const tpl = TECH[s.cat] || TECH.default; pick(tpl, 2).forEach((q) => add('Skills', rep(q, { ...v, skill: s.name }), { skill: s.name })) }
    for (const s of a.soft.slice(0, 2)) add('Skills', rep(TECH['Soft skills'][0], { ...v, skill: s.name.toLowerCase() }), { skill: s.name })
  }
  if (focus.includes('situational')) pick(SITUATIONAL, level === 'entry' ? 4 : 6).forEach((q) => add('Situational', q))
  if (focus.includes('job') && a) pick(a.sections.responsibilities, 5).forEach((r) => add('From the job post', `The job post says: "${r.replace(/[.\s]+$/, '')}". How would you approach this in your first month?`))
  return out
}
export const questionsToAsk = (company) => ASK.map((q) => (company ? q.replace('working here', `working at ${company}`) : q))

export async function mount(root, { signal }) {
  const prev = load(KEY, {})
  const st = { role: prev.role || '', company: prev.company || '', level: prev.level || 'mid', focus: prev.focus || ['behavioral', 'skills', 'situational', 'job'] }
  const answers = load('interview:answers', {})
  let extra = load('interview:ai', [])
  const jd = textarea({ rows: 8, placeholder: 'Paste the job description to get questions about its skills and responsibilities (optional).', value: load(JD_KEY, '') })
  const list = h('div', { class: 'stack tight' })
  const prog = h('div', { class: 'cr-meter' }, h('i'))
  const progTxt = h('span', { class: 'small muted' })
  let timer = null
  onCleanup(() => clearInterval(timer))
  const keepAns = debounce(() => save('interview:answers', answers), 300)
  const keepSt = debounce(() => save(KEY, st), 300)

  const all = () => [...buildQuestions({ ...st, jd: jd.value }), ...extra.map((x) => ({ id: `ai:${x.q}`.slice(0, 160), cat: x.cat || 'AI tailored', q: x.q, why: x.why }))]
  function updProg(qs) {
    const done = qs.filter((q) => answers[q.id]?.done).length
    prog.firstChild.style.setProperty('--w', `${qs.length ? (done / qs.length) * 100 : 0}%`)
    progTxt.textContent = `${done} of ${qs.length} prepared`
  }
  let catFilter = 'all'
  const catBar = h('div', { class: 'cr-chips' })
  function draw() {
    const qs = all()
    updProg(qs)
    const cats = [...new Set(qs.map((q) => q.cat))]
    if (catFilter !== 'all' && !cats.includes(catFilter)) catFilter = 'all'
    clear(catBar, cats.length > 1 ? ['all', ...cats].map((c) => h('button', { type: 'button', class: 'cr-chip btn-chip', 'aria-pressed': String(catFilter === c), onclick: () => { catFilter = c; draw() } }, c === 'all' ? `All (${qs.length})` : `${c} (${qs.filter((q) => q.cat === c).length})`)) : [])
    const shown = qs.filter((q) => catFilter === 'all' || q.cat === catFilter)
    clear(list, shown.length ? shown.map((q, i) => qCard(q, i, qs)) : h('div', { class: 'empty' }, icon('messages-square'), h('div', 'Pick at least one focus area on the left.')))
  }
  function qCard(q, i, qs) {
    const A = (answers[q.id] ||= { s: '', t: '', a: '', r: '', done: false })
    const body = h('div', { class: 'cr-item-b', style: 'display:none' })
    const item = h('div', { class: 'cr-item', style: { '--i': Math.min(i, 12) } })
    const clock = h('span', { class: 'small muted', 'aria-live': 'off' })
    const tmr = button('Practice 2:00', { icon: 'timer', variant: 'secondary', size: 'sm' })
    tmr.addEventListener('click', () => {
      clearInterval(timer)
      let left = 120
      tmr.textContent = ''; tmr.append(icon('square'), h('span', 'Stop'))
      clock.textContent = '2:00'
      timer = setInterval(() => {
        left--
        clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
        if (left <= 0) { clearInterval(timer); clock.textContent = 'Time. Wrap up your answer.'; reset() }
      }, 1000)
      tmr.onclick = () => { clearInterval(timer); clock.textContent = ''; reset() }
      function reset() { tmr.replaceChildren(icon('timer'), h('span', 'Practice 2:00')); tmr.onclick = null }
    })
    const star = (k, label, ph) => field(label, Object.assign(textarea({ rows: 2, placeholder: ph }), { value: A[k], oninput: (e) => { A[k] = e.target.value; keepAns() } }))
    const out = h('div', { class: 'cr-md' })
    const coach = button('Coach me with Claude', { icon: 'sparkles', variant: 'secondary', size: 'sm' })
    coach.addEventListener('click', () => busy(coach, async () => {
      if (!(await ai.ensureKey())) return
      const mine = [A.s && `Situation: ${A.s}`, A.t && `Task: ${A.t}`, A.a && `Action: ${A.a}`, A.r && `Result: ${A.r}`].filter(Boolean).join('\n') || '(nothing written yet)'
      let acc = ''
      const text = await ai.ask({
        system: 'You are a supportive interview coach. Be concrete and brief. Never invent facts about the candidate; use [brackets] where details are missing.',
        prompt: `Role: ${st.role || 'not given'} at ${st.company || 'a company'}. Seniority: ${st.level}.\nQuestion: ${q.q}\n\nCandidate notes (STAR):\n${mine}\n\nGive: 1) what a strong answer to this question covers (3 bullets), 2) feedback on the notes, 3) a polished 90 second spoken answer using the notes with [placeholders] for missing details.`,
        effort: 'low', maxTokens: 1800, signal, onText: (t) => { acc = t; renderMarkdown(out, t) },
      })
      await renderMarkdown(out, text || acc)
    }, { label: 'Coaching', errorTo: out }))
    body.append(h('div', { class: 'stack tight' },
      q.why ? h('div', { class: 'small muted' }, q.why) : h('div', { class: 'small muted' }, `Use the STAR method. ${LEVEL[st.level]}`),
      h('div', { class: 'grid-2' }, star('s', 'Situation', 'Where and when, in one or two lines'), star('t', 'Task', 'What you had to achieve')),
      h('div', { class: 'grid-2' }, star('a', 'Action', 'What you personally did, step by step'), star('r', 'Result', 'The outcome, with numbers if you can')),
      h('div', { class: 'row' }, tmr, clock, coach), out))
    const done = h('input', { type: 'checkbox', checked: !!A.done, 'aria-label': 'Prepared', onchange: (e) => { A.done = e.target.checked; keepAns(); updProg(qs); item.classList.toggle('done', A.done) } })
    item.classList.toggle('done', !!A.done)
    item.append(h('div', { class: 'cr-item-h', style: 'padding-left:12px' }, done, h('button', { type: 'button', class: 'lbl', 'aria-expanded': 'false', onclick: (e) => { const o = item.classList.toggle('open'); body.style.display = o ? 'block' : 'none'; e.currentTarget.setAttribute('aria-expanded', String(o)) } }, h('b', { style: 'white-space:normal' }, q.q), h('small', q.cat)), h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chevron-down'))), body)
    return item
  }

  const focusChips = h('div', { class: 'cr-chips' })
  const FOC = [['behavioral', 'Behavioral'], ['skills', 'Skills from the job'], ['situational', 'Situational'], ['job', 'Job responsibilities']]
  const drawFocus = () => clear(focusChips, FOC.map(([id, label]) => h('button', { type: 'button', class: 'cr-chip btn-chip', 'aria-pressed': String(st.focus.includes(id)), onclick: () => { st.focus = st.focus.includes(id) ? st.focus.filter((x) => x !== id) : [...st.focus, id]; drawFocus(); keepSt(); draw() } }, label)))
  drawFocus()
  const redraw = debounce(() => { save(JD_KEY, jd.value); draw() }, 300)
  jd.addEventListener('input', redraw)
  const onField = () => { keepSt(); draw() }

  const aiBtn = button('Add tailored questions with Claude', { icon: 'sparkles', variant: 'secondary' })
  const aiErr = h('div')
  aiBtn.addEventListener('click', () => busy(aiBtn, async () => {
    if (!(await ai.ensureKey())) return
    const res = await ai.ask({
      system: 'You are an experienced interviewer. Write realistic, specific interview questions. Do not use em dashes.',
      prompt: `Role: ${st.role || 'not given'}. Company: ${st.company || 'not given'}. Seniority: ${st.level}.\n${jd.value.trim() ? `Job description:\n${jd.value.slice(0, 8000)}\n` : ''}Write 8 questions this interviewer would plausibly ask, mixing behavioral, technical or domain, and situational. For each give a one line "why" explaining what they are testing.`,
      json: { type: 'object', properties: { questions: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, cat: { type: 'string' }, why: { type: 'string' } }, required: ['q', 'cat', 'why'], additionalProperties: false } } }, required: ['questions'], additionalProperties: false },
      effort: 'low', maxTokens: 3000, signal,
    })
    extra = res.questions.slice(0, 10).map((x) => ({ q: x.q, cat: `AI: ${x.cat}`, why: x.why }))
    save('interview:ai', extra); draw(); toast(`Added ${extra.length} questions`, 'success')
  }, { label: 'Writing questions', errorTo: aiErr }))

  const md = () => {
    const L = [`# Interview prep: ${st.role || 'role'}${st.company ? ` at ${st.company}` : ''}`, '']
    for (const q of all()) {
      const A = answers[q.id]
      L.push(`## ${q.q}`, `*${q.cat}*`)
      if (A && (A.s || A.t || A.a || A.r)) L.push('', ...[['Situation', A.s], ['Task', A.t], ['Action', A.a], ['Result', A.r]].filter(([, x]) => x).map(([k, x]) => `- **${k}:** ${x}`))
      L.push('')
    }
    L.push('## Questions to ask them', ...questionsToAsk(st.company).map((x) => `- ${x}`))
    return L.join('\n') + '\n'
  }
  const docBlocks = () => {
    const B = [{ t: 'name', text: `Interview prep: ${st.role || 'role'}${st.company ? ` at ${st.company}` : ''}` }]
    for (const q of all()) {
      const A = answers[q.id]
      B.push({ t: 'h', text: q.cat }, { t: 'title', text: q.q })
      if (A) for (const [k, x] of [['Situation', A.s], ['Task', A.t], ['Action', A.a], ['Result', A.r]]) if (x) B.push({ t: 'kv', label: k, text: x })
    }
    B.push({ t: 'h', text: 'Questions to ask them' }, ...questionsToAsk(st.company).map((x) => ({ t: 'li', text: x })))
    return B
  }
  const wb = button('Word', { icon: 'file-type', variant: 'primary', size: 'sm' })
  wb.addEventListener('click', () => busy(wb, async () => { saveAs(await blocksToDocx(docBlocks(), { title: 'Interview prep' }), 'interview-prep.docx'); burst(wb) }, { label: 'Preparing' }))

  root.append(shell(
    banner({ icon: 'messages-square', text: '<b>Walk in ready.</b> Get the questions this job is likely to bring up, build your STAR answers, practice against the clock and tick them off.', steps: ['Add the role', 'Prepare answers', 'Practice'] }),
    h('div', { class: 'cr-work' },
      h('div', { class: 'stack cr-sticky' },
        card('The interview', 'briefcase', h('div', { class: 'stack tight' },
          h('div', { class: 'grid-2' }, fi(st, 'role', 'Role', { ph: 'Product Designer' }, onField), fi(st, 'company', 'Company', { ph: 'Northwind Labs' }, onField)),
          field('Seniority', select([['entry', 'Entry level'], ['mid', 'Mid level'], ['senior', 'Senior'], ['lead', 'Lead or manager']], st.level, (v) => { st.level = v; onField() })),
          field('Focus', focusChips),
          field('Job description (optional)', jd))),
        card('Tailor with AI', 'sparkles', h('div', { class: 'stack tight' }, ai.notice('Optional: uses Claude'), h('div', { class: 'row' }, aiBtn), aiErr))),
      h('div', { class: 'stack' },
        card('Your question list', 'list-checks', h('div', { class: 'stack tight' },
          catBar, h('div', { class: 'row between' }, progTxt, h('div', { class: 'row' }, button('Copy Markdown', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copyText(md()) }), wb)), prog, list)),
        card('Questions to ask them', 'help-circle', h('ul', { style: 'margin:0;padding-left:18px;display:grid;gap:7px;font-size:14px' }, questionsToAsk(st.company).map((x) => h('li', x))))))))
  draw()
}
