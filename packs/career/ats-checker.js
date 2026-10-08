// Resume ATS checker: upload a resume (PDF, DOCX, TXT) or paste text, optionally add a job description, and get a readiness score,
// keyword match, section / contact / formatting checks and prioritized fixes. Analysis is local; the AI review is optional.
import { h, icon, button, busy, toast, alert, tabs, segmented, clear, copyText, errorMessage, textarea, field } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, ring, chip, tile, check, burst, renderMarkdown, bandOf } from './_kit.js'
import { textSource } from './_source.js'
import { analyzeResume, reportText, verdict } from './_ats.js'
import { SAMPLE_JD } from './_jd.js'
import { normalizeResume, resumeToText, hasContent, sampleResume } from './_resume.js'

const JD_KEY = 'career:jd'

export async function mount(root, { signal }) {
  const src = textSource({ rows: 10, placeholder: 'Paste your resume text here, or drop a file above.', label: 'Drop your resume (PDF, DOCX or TXT) or click to choose', onChange: () => { stale() } })
  const jd = textarea({ rows: 12, placeholder: 'Paste the full job description here (optional). Include the requirements and responsibilities for the best match.', value: load(JD_KEY, '') })
  const jdCount = h('span', { class: 'small muted' })
  const results = h('div')
  const runBtn = button('Check my resume', { icon: 'scan-search', variant: 'primary', size: 'lg' })
  let last = null

  const savedResume = (() => { try { const r = normalizeResume(load('resume:data', null)); return r && !r.sample && hasContent(r) ? r : null } catch { return null } })()
  const stale = () => { results.classList.toggle('muted', !!last) }
  const upJd = () => { jdCount.textContent = jd.value.trim() ? `${(jd.value.match(/\S+/g) || []).length} words` : 'Optional'; save(JD_KEY, jd.value) }
  jd.addEventListener('input', upJd)
  upJd()

  const useBuilder = savedResume && button('Use my builder resume', { icon: 'file-user', variant: 'secondary', size: 'sm', onClick: () => { src.set(resumeToText(savedResume), { pages: null, info: {} }); toast('Loaded your saved resume') } })
  const example = button('Try an example', { icon: 'sparkles', variant: 'ghost', size: 'sm', onClick: () => { src.set(resumeToText(sampleResume()), { pages: 1, info: {} }); jd.value = SAMPLE_JD; upJd(); toast('Example loaded. Press Check my resume.') } })

  runBtn.addEventListener('click', () => busy(runBtn, async () => {
    const text = src.text.trim()
    if (text.length < 60) { clear(results, alert('error', 'Upload your resume or paste its text first (at least a few lines).')); return }
    await new Promise((r) => setTimeout(r, 120))
    const a = analyzeResume(text, src.meta || {}, jd.value)
    last = { a, text }
    show(a)
    burst(runBtn)
  }, { label: 'Analyzing', errorTo: results }))

  function show(a) {
    const hasMatch = a.match && a.match.score != null
    const attention = a.checks.filter((c) => c.kind === 'bad' || c.kind === 'warn').length
    const rings = h('div', { class: 'row', style: 'gap:28px;align-items:center;justify-content:space-around' },
      h('div', { style: 'text-align:center' }, ring(a.readiness, { label: 'ATS ready', size: 156 }), h('div', { style: 'margin-top:8px;font-weight:600' }, verdict(a.readiness)), h('div', { class: 'small muted' }, attention ? `${attention} thing${attention > 1 ? 's' : ''} to fix` : 'Nothing to fix')),
      hasMatch
        ? h('div', { style: 'text-align:center' }, ring(a.match.score, { label: 'Job match', size: 156 }), h('div', { style: 'margin-top:8px;font-weight:600' }, verdict(a.match.score)), h('div', { class: 'small muted' }, `${a.match.skills.filter((s) => s.present).length} of ${a.match.skills.length} skills matched`))
        : h('div', { style: 'text-align:center;max-width:240px' }, h('div', { class: 'cr-ring', style: '--sz:156px;color:var(--border-strong)' }, h('div', { class: 'mid-text' }, h('div', { class: 'num', style: 'color:var(--muted)' }, '--'), h('div', { class: 'lab' }, 'Job match'))), h('div', { class: 'small muted', style: 'margin-top:8px' }, 'Paste a job description to see which keywords you are missing.')))

    const tiles = [
      { icon: 'file-text', label: 'Length', value: `${a.words.toLocaleString()} words`, hint: a.pages ? `${a.pages} page${a.pages > 1 ? 's' : ''}` : 'Pasted text', kind: a.checks.find((c) => c.id === 'length')?.kind },
      { icon: 'zap', label: 'Strong verbs', value: a.bullets ? `${Math.round((100 * a.strongBullets) / a.bullets)}%` : '-', hint: `${a.strongBullets} of ${a.bullets} bullets`, kind: a.checks.find((c) => c.id === 'verbs')?.kind },
      { icon: 'hash', label: 'With numbers', value: a.bullets ? `${Math.round((100 * a.numberedBullets) / a.bullets)}%` : '-', hint: `${a.numberedBullets} of ${a.bullets} bullets`, kind: a.checks.find((c) => c.id === 'numbers')?.kind },
      { icon: 'wrench', label: 'Skills found', value: String(a.skills.length), hint: a.skills.slice(0, 3).map((s) => s.name).join(', ') || 'None detected', kind: a.checks.find((c) => c.id === 'skillcount')?.kind },
      { icon: 'calendar-range', label: 'Experience', value: a.years ? `~${a.years} yrs` : '-', hint: a.match?.jdYears ? `Job asks ${a.match.jdYears}+ yrs` : 'From your dates', kind: a.match?.jdYears && a.years && a.years + 0.5 < a.match.jdYears ? 'warn' : '' },
      { icon: 'layout-list', label: 'Sections', value: String(new Set(a.sections).size), hint: [...new Set(a.sections)].slice(0, 4).join(', ') },
    ].map((t, i) => tile({ ...t, kind: t.kind === 'bad' ? 'bad' : t.kind === 'warn' ? 'warn' : t.kind === 'ok' ? 'ok' : '', i }))

    const fixes = a.suggestions.length ? h('div', { class: 'cr-card' }, h('h2', { class: 'cr-h' }, h('span', { class: 'tile' }, icon('list-checks')), 'Top fixes'),
      h('ol', { style: 'margin:0;padding-left:20px;display:grid;gap:8px' }, a.suggestions.slice(0, 6).map((s) => h('li', { style: 'padding-left:4px' }, s)))) : null

    const tabItems = []
    if (a.match) tabItems.push({ id: 'kw', label: 'Keywords', render: () => keywordsView(a) })
    tabItems.push({ id: 'checks', label: `Checks (${a.checks.length})`, render: () => checksView(a) })
    tabItems.push({ id: 'skills', label: 'Skills found', render: () => skillsView(a) })
    tabItems.push({ id: 'ai', label: 'AI review', render: () => aiView() })

    clear(results, h('div', { class: 'stack' },
      h('div', { class: 'cr-card tint cr-rise' }, rings),
      h('div', { class: 'cr-bento' }, tiles),
      fixes,
      h('div', { class: 'cr-card' }, tabs(tabItems, tabItems[0].id)),
      h('div', { class: 'row' }, button('Copy report', { icon: 'copy', variant: 'secondary', onClick: () => copyText(reportText(a)) }), h('a', { class: 'link small', href: '#/resume-builder' }, 'Fix it in the Resume builder'))))
    results.firstElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function keywordsView(a) {
    const m = a.match
    const group = (title, ic, list, kind, hint) => list.length ? h('div', { class: 'stack tight' }, h('h3', { style: 'font-size:14px;display:flex;gap:8px;align-items:center' }, icon(ic), `${title} (${list.length})`, hint ? h('span', { class: 'small muted', style: 'font-weight:400' }, hint) : null),
      h('div', { class: 'cr-chips' }, list.map((s, i) => chip(s.name || s.term, kind, { i, count: kind === 'ok' ? s.inResume : s.count, title: kind === 'miss' ? `Mentioned ${s.count}x in the job description` : undefined })))) : null
    const missMust = m.skills.filter((s) => !s.present && s.level === 'must')
    const missNice = m.skills.filter((s) => !s.present && s.level === 'nice')
    const hit = m.skills.filter((s) => s.present)
    const missTerms = m.terms.filter((t) => !t.present)
    const hitTerms = m.terms.filter((t) => t.present)
    const missing = [...missMust, ...missNice].map((s) => s.name).concat(missTerms.map((t) => t.term))
    return h('div', { class: 'stack' },
      !m.skills.length && !m.terms.length ? alert('info', 'No recognizable skills found in the job description. Paste the full text including requirements.') : null,
      group('Missing required skills', 'circle-x', missMust, 'miss', 'Mentioned in the requirements'),
      group('Missing nice to have', 'circle-dashed', missNice, 'warn'),
      group('Matched skills', 'circle-check', hit, 'ok'),
      group('Employer wording not in your resume', 'quote', missTerms, 'info', 'Use if true'),
      hitTerms.length ? group('Employer wording you already use', 'quote', hitTerms, 'ok') : null,
      m.soft.length ? group('Soft skills asked for', 'handshake', m.soft.map((s) => ({ ...s, name: s.name })), m.soft.every((s) => s.present) ? 'ok' : 'info') : null,
      missing.length ? h('div', { class: 'row' }, button('Copy missing keywords', { icon: 'copy', variant: 'secondary', size: 'sm', onClick: () => copyText(missing.join(', ')) }), h('span', { class: 'small muted' }, 'Add only the ones you can honestly back up with experience.')) : alert('success', 'You cover every skill and keyword found in this job description.'))
  }

  function checksView(a) {
    const host = h('div', { class: 'cr-checks' })
    const draw = (mode) => {
      const list = mode === 'all' ? a.checks : a.checks.filter((c) => c.kind !== 'ok')
      clear(host, list.length ? list.map((c, i) => check(c.kind === 'info' ? 'info' : c.kind, c.title, c.detail, c.extra, i)) : alert('success', 'Everything passes. Nice work.'))
    }
    draw('attention')
    return h('div', { class: 'stack' }, segmented([['attention', 'Needs attention'], ['all', 'All checks']], 'attention', draw, 'Filter checks'), host)
  }

  function skillsView(a) {
    const byCat = new Map()
    for (const s of a.skills) (byCat.get(s.cat) || byCat.set(s.cat, []).get(s.cat)).push(s)
    if (!byCat.size) return alert('warn', 'No known skills were detected. Add a Skills section listing your tools and technologies.')
    return h('div', { class: 'stack' }, [...byCat].map(([cat, list]) => h('div', { class: 'stack tight' }, h('h3', { style: 'font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em' }, cat),
      h('div', { class: 'cr-chips' }, list.map((s, i) => chip(s.name, 'ok', { i, count: s.count })))))
    )
  }

  function aiView() {
    const out = h('div', { class: 'cr-md' })
    const btn = button('Review with Claude', { icon: 'sparkles', variant: 'primary' })
    btn.addEventListener('click', () => busy(btn, async () => {
      if (!last) return
      if (!(await ai.ensureKey())) return
      let acc = ''
      const text = await ai.ask({
        system: 'You are a senior technical recruiter and ATS expert. Give honest, specific, actionable feedback. Never suggest inventing experience, skills or numbers the candidate does not have. Use short Markdown sections.',
        prompt: `Review this resume${jd.value.trim() ? ' against the job description' : ''}.\n\nRESUME:\n${last.text.slice(0, 16000)}\n\n${jd.value.trim() ? `JOB DESCRIPTION:\n${jd.value.slice(0, 8000)}\n\n` : ''}Heuristic findings already computed: ATS readiness ${last.a.readiness}/100${last.a.match?.score != null ? `, keyword match ${last.a.match.score}/100` : ''}. Write: 1) Overall impression (2 sentences). 2) Top 5 fixes in priority order. 3) ${jd.value.trim() ? 'Keyword gaps and where to truthfully add them. 4) ' : ''}Rewrite the 3 weakest bullets with stronger verbs and placeholders like [X%] where a number is needed. ${jd.value.trim() ? '5' : '4'}) A tighter 2-3 sentence summary.`,
        effort: 'medium', maxTokens: 4000, signal,
        onText: (t) => { acc = t; renderMarkdown(out, t) },
      })
      await renderMarkdown(out, text || acc)
    }, { label: 'Reviewing', errorTo: out }))
    return h('div', { class: 'stack' }, ai.notice('AI review uses Claude'), h('div', { class: 'small muted' }, 'Sends your resume text (and the job description) to Anthropic with your own key. The score above is computed locally and never leaves this device.'), h('div', { class: 'row' }, btn), out)
  }

  root.append(shell(
    banner({ icon: 'scan-search', text: '<b>See your resume the way an ATS does.</b> Score it, match it to a job and fix what is missing. Everything is analyzed on this device.', steps: ['Add resume', 'Paste job', 'Fix gaps'] }),
    h('div', { class: 'cr-work' },
      card('Your resume', 'file-user', src.el, h('div', { class: 'row', style: 'margin-top:10px' }, useBuilder, example)),
      card('Job description', 'briefcase', field('Paste the job post', jd, h('span', { class: 'row', style: 'justify-content:space-between' }, h('span', 'Gives you a keyword match score and a list of missing skills.'), jdCount)),
        h('div', { class: 'row', style: 'margin-top:8px' }, button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { jd.value = ''; upJd() } })))),
    h('div', { class: 'row' }, runBtn, h('span', { class: 'small muted' }, 'Files are read in your browser and never uploaded.')),
    results))
}
