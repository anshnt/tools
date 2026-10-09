// Job description analyzer: paste a job post and see skills (must vs nice to have), years, education, responsibilities vs
// requirements, soft skills, pay, work mode and red flags. Live and local; an optional Claude summary adds interview prep.
import { h, icon, button, busy, toast, alert, textarea, clear, copyText, debounce } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, chip, tile, check, renderMarkdown } from './_kit.js'
import { analyzeJD, SAMPLE_JD } from './_jd.js'

const JD_KEY = 'career:jd'

export function toMarkdown(a) {
  const L = [`# ${a.title || 'Job analysis'}`]
  const facts = [a.seniority, a.employment.join(', '), a.mode, a.location].filter(Boolean)
  if (facts.length) L.push(facts.join(' | '))
  L.push('', `- Experience: ${a.years.main != null ? `${a.years.main}+ years` : 'not stated'}`, `- Education: ${a.education.top || 'not stated'}${a.education.equivalent ? ' (or equivalent experience)' : ''}`,
    `- Pay: ${a.salary.figures.join('; ') || 'not stated'}`)
  const must = a.skills.filter((s) => s.level === 'must').map((s) => s.name), nice = a.skills.filter((s) => s.level === 'nice').map((s) => s.name)
  if (must.length) L.push('', '## Required skills', must.join(', '))
  if (nice.length) L.push('', '## Nice to have', nice.join(', '))
  if (a.soft.length) L.push('', '## Soft skills', a.soft.map((s) => s.name).join(', '))
  if (a.sections.responsibilities.length) L.push('', '## Responsibilities', ...a.sections.responsibilities.map((x) => `- ${x}`))
  if (a.sections.requirements.length) L.push('', '## Requirements', ...a.sections.requirements.map((x) => `- ${x}`))
  if (a.flags.length) L.push('', '## Watch outs', ...a.flags.map((f) => `- ${f.label}: ${f.why}`))
  return L.join('\n') + '\n'
}

export async function mount(root, { signal }) {
  const ta = textarea({ rows: 18, placeholder: 'Paste the full job description here...', value: load(JD_KEY, '') })
  const count = h('span', { class: 'small muted' })
  const out = h('div')
  let last = null

  const run = () => {
    const text = ta.value
    save(JD_KEY, text)
    count.textContent = text.trim() ? `${(text.match(/\S+/g) || []).length} words` : ''
    if (text.trim().length < 60) { last = null; clear(out, h('div', { class: 'empty' }, icon('file-search'), h('div', 'Paste a job description to see the skills, years, pay and red flags it contains.'), h('div', { class: 'row', style: 'justify-content:center' }, button('Try a sample job', { icon: 'sparkles', variant: 'primary', size: 'sm', onClick: () => { ta.value = SAMPLE_JD; run() } })))); return }
    const a = analyzeJD(text.slice(0, 60000))
    last = a
    render(a)
  }
  const live = debounce(run, 350)
  ta.addEventListener('input', live)

  const flagRow = (f, i) => h('div', { class: 'cr-check warn', style: { '--i': i } }, h('div', { class: 'ic' }, icon('triangle-alert')),
    h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 't' }, f.label), h('div', { class: 'd' }, f.why), h('div', { class: 'small', style: 'margin-top:4px;font-style:italic;color:var(--text-2);overflow-wrap:anywhere' }, `"${f.snippet}"`)))

  function render(a) {
    const must = a.skills.filter((s) => s.level === 'must')
    const nice = a.skills.filter((s) => s.level === 'nice')
    const byCat = (list) => { const m = new Map(); for (const s of list) (m.get(s.cat) || m.set(s.cat, []).get(s.cat)).push(s); return m }
    const heads = [a.seniority, ...a.employment, a.mode, a.location].filter(Boolean)
    const tiles = [
      { icon: 'calendar-range', label: 'Experience', value: a.years.main != null ? `${a.years.main}+ years` : 'Not stated', hint: a.years.list.length > 1 ? `Other mentions: ${a.years.list.slice(1, 4).map((y) => y.text).join(', ')}` : a.years.list[0]?.line, kind: a.years.main != null ? 'info' : '' },
      { icon: 'graduation-cap', label: 'Education', value: a.education.top || 'Not stated', hint: a.education.top ? (a.education.equivalent ? 'Or equivalent experience' : 'Degree expected') : 'No degree mentioned', kind: a.education.top ? 'info' : '' },
      { icon: 'banknote', label: 'Pay', value: a.salary.figures[0] || 'Not stated', hint: a.salary.figures.length > 1 ? `+${a.salary.figures.length - 1} more figure${a.salary.figures.length > 2 ? 's' : ''}` : a.salary.vague ? 'Says "competitive" but gives no number' : a.salary.figures.length ? 'Stated in the post' : 'Ask early in the process', kind: a.salary.figures.length ? 'ok' : 'warn' },
      { icon: 'map-pin', label: 'Work mode', value: a.mode || 'Not stated', hint: a.location || a.employment.join(', '), kind: a.mode ? 'info' : '' },
      { icon: 'wrench', label: 'Skills asked', value: String(a.skills.length), hint: `${must.length} required, ${nice.length} nice to have` },
      { icon: 'flag', label: 'Red flags', value: String(a.flags.length), hint: a.flags.length ? 'See details below' : 'Nothing worrying found', kind: a.flags.length > 3 ? 'bad' : a.flags.length ? 'warn' : 'ok' },
    ].map((t, i) => tile({ ...t, i }))

    const skillGroup = (title, list, kind) => list.length ? h('div', { class: 'stack tight' }, h('h3', { style: 'font-size:14px' }, `${title} (${list.length})`),
      h('div', [...byCat(list)].map(([cat, items]) => h('div', { class: 'cr-cat' }, h('div', { class: 'k' }, cat), h('div', { class: 'cr-chips' }, items.map((s, i) => chip(s.name, kind, { i, count: s.count })))))) ) : null

    const listCard = (title, ic, items, empty) => h('div', { class: 'cr-card' }, h('h2', { class: 'cr-h' }, h('span', { class: 'tile' }, icon(ic)), title, h('span', { class: 'aside' }, String(items.length))),
      items.length ? h('ul', { style: 'margin:0;padding-left:18px;display:grid;gap:7px;font-size:14px' }, items.slice(0, 14).map((x) => h('li', x))) : h('div', { class: 'small muted' }, empty))

    const maxC = Math.max(1, ...a.terms.map((t) => t.count))
    const cloud = a.terms.length ? h('div', { class: 'cr-chips' }, a.terms.slice(0, 24).map((t, i) => h('span', { class: 'cr-chip info', style: { '--i': i, fontSize: `${12 + Math.round((t.count / maxC) * 5)}px` } }, h('span', t.term), h('small', `x${t.count}`)))) : h('div', { class: 'small muted' }, 'Not enough text to find repeated terms yet.')

    const aiOut = h('div', { class: 'cr-md' })
    const aiBtn = button('Summarize with AI', { icon: 'sparkles', variant: 'secondary' })
    aiBtn.addEventListener('click', () => busy(aiBtn, async () => {
      if (!(await ai.ensureKey())) return
      let acc = ''
      const text = await ai.ask({
        system: 'You are a career coach. Be concrete and brief. Use short Markdown sections.',
        prompt: `Analyze this job description for a candidate deciding whether and how to apply.\n\n${ta.value.slice(0, 12000)}\n\nWrite: **The role in 3 lines**, **What they really want** (top 5 priorities, reading between the lines), **Likely interview questions** (6), **How to tailor a resume** (4 bullets) and **Questions to ask them** (4).`,
        effort: 'low', maxTokens: 3000, signal, onText: (t) => { acc = t; renderMarkdown(aiOut, t) },
      })
      await renderMarkdown(aiOut, text || acc)
    }, { label: 'Summarizing', errorTo: aiOut }))

    clear(out, h('div', { class: 'stack' },
      h('div', { class: 'cr-card tint cr-rise' }, h('div', { class: 'small muted', style: 'font-weight:600;text-transform:uppercase;letter-spacing:.08em' }, 'Role'), h('div', { style: 'font-size:clamp(20px,3vw,28px);font-weight:700;letter-spacing:-.03em;margin:4px 0 10px' }, a.title || 'Untitled role'), heads.length ? h('div', { class: 'cr-chips' }, heads.map((x, i) => chip(x, 'info', { i }))) : null),
      h('div', { class: 'cr-bento' }, tiles),
      card('Skills and tools', 'wrench', h('div', { class: 'stack' },
        skillGroup('Required', must, 'ok'), skillGroup('Nice to have', nice, 'warn'),
        !a.skills.length ? h('div', { class: 'small muted' }, 'No known skills were found. Paste the full requirements section.') : null,
        a.soft.length ? h('div', { class: 'stack tight' }, h('h3', { style: 'font-size:14px' }, `Soft skills (${a.soft.length})`), h('div', { class: 'cr-chips' }, a.soft.map((s, i) => chip(s.name, 'info', { i, count: s.count })))) : null)),
      h('div', { class: 'grid-2' }, listCard('Responsibilities', 'list-todo', a.sections.responsibilities, 'No responsibilities section found.'), listCard('Requirements', 'clipboard-check', a.sections.requirements, 'No requirements section found.')),
      a.sections.nice.length ? listCard('Nice to have', 'plus', a.sections.nice, '') : null,
      card('Red flags and watch outs', 'flag', a.flags.length
        ? h('div', { class: 'cr-checks' }, a.flags.map(flagRow))
        : alert('success', 'No obvious red flags in this post.')),
      card('Keywords to mirror', 'quote', cloud, h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Repeated words and phrases that are not on the skills list. Use the ones that are true for you.')),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-primary', href: '#/ats-checker' }, icon('scan-search'), h('span', 'Check my resume against this job')),
        h('a', { class: 'btn btn-secondary', href: '#/cover-letter' }, icon('mail-open'), h('span', 'Write a cover letter')),
        button('Copy analysis', { icon: 'copy', variant: 'ghost', onClick: () => copyText(toMarkdown(a)) })),
      card('AI summary and interview prep', 'sparkles', h('div', { class: 'stack' }, ai.notice('Optional: uses AI'), h('div', { class: 'row' }, aiBtn), aiOut))))
  }

  root.append(shell(
    banner({ icon: 'file-search', text: '<b>Read between the lines of any job post.</b> Skills, years, pay, work mode and red flags, found as you paste. Nothing is sent anywhere.', steps: ['Paste the post', 'Review', 'Tailor your resume'] }),
    h('div', { class: 'cr-work wide-left' },
      h('div', { class: 'stack tight cr-sticky' }, card('Job description', 'file-text', ta, h('div', { class: 'row between', style: 'margin-top:8px' }, count, h('div', { class: 'row' }, button('Sample', { icon: 'sparkles', variant: 'ghost', size: 'sm', onClick: () => { ta.value = SAMPLE_JD; run() } }), button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { ta.value = ''; run(); ta.focus() } }))))),
      out)))
  run()
}
