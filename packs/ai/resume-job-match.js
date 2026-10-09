// Resume to job matching: fit score, strengths, gaps, keywords, tailored bullets and a cover letter opener (structured JSON from Claude).
// Without an API key a free on-device keyword check still shows which job terms your resume covers.
import { h, button, field, input, textarea, dropzone, alert, clear, panel, split, row, tabs, copyButton, icon, busy, formatNumber } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { openPdf, extractText } from '../../lib/pdf.js'
import { injectStyle, exportBar, runner, readSource, fileChips, fetchPage, DOC_ACCEPT, UNTRUSTED } from './_shared.js'

const SCHEMA = {
  type: 'object',
  properties: {
    fit_score: { type: 'integer' },
    verdict: { type: 'string' },
    summary: { type: 'string' },
    breakdown: { type: 'array', items: { type: 'object', properties: { area: { type: 'string' }, score: { type: 'integer' }, note: { type: 'string' } }, required: ['area', 'score', 'note'], additionalProperties: false } },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'object', properties: { gap: { type: 'string' }, how_to_address: { type: 'string' } }, required: ['gap', 'how_to_address'], additionalProperties: false } },
    matched_keywords: { type: 'array', items: { type: 'string' } },
    missing_keywords: { type: 'array', items: { type: 'string' } },
    tailored_bullets: { type: 'array', items: { type: 'object', properties: { section: { type: 'string' }, original: { type: 'string' }, suggested: { type: 'string' } }, required: ['section', 'original', 'suggested'], additionalProperties: false } },
    cover_letter_opener: { type: 'string' },
  },
  required: ['fit_score', 'verdict', 'summary', 'breakdown', 'strengths', 'gaps', 'matched_keywords', 'missing_keywords', 'tailored_bullets', 'cover_letter_opener'],
  additionalProperties: false,
}
const CSS = `
.ai-score { display: grid; grid-template-columns: auto 1fr; gap: 18px; align-items: center; }
.ai-ring { --p: 0; --c: var(--accent); width: 112px; height: 112px; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--c) calc(var(--p) * 1%), var(--surface-3) 0); position: relative; }
.ai-ring::before { content: ''; position: absolute; inset: 11px; border-radius: 50%; background: var(--surface); }
.ai-ring b { position: relative; font-size: 30px; letter-spacing: -.03em; color: var(--text); }
.ai-ring small { position: relative; display: block; font-size: 11px; color: var(--muted); text-align: center; margin-top: -4px; }
.ai-bar { height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; } .ai-bar i { display: block; height: 100%; border-radius: 99px; background: var(--c, var(--accent)); transition: width .8s var(--ease); }
.ai-kw { display: inline-flex; align-items: center; min-height: 26px; padding: 0 10px; border-radius: 99px; font-size: 12.5px; font-weight: 550; border: 1px solid; }
.ai-kw.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 30%, transparent); }
.ai-kw.miss { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 35%, transparent); }
.ai-sug { border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: grid; gap: 6px; background: var(--surface); }
.ai-sug del { color: var(--muted); }
.ai-li { display: flex; gap: 8px; align-items: flex-start; } .ai-li .icon { flex: none; margin-top: 3px; width: 16px; height: 16px; }
@media (max-width: 480px) { .ai-score { grid-template-columns: 1fr; justify-items: center; text-align: center; } }
`
const STOP = new Set('the and for with you your are will our from that this have has not but all can who their they them its was were been being into over such than then also more most other some any each per via use using used work working team teams ability able strong good great new role job company position candidate years year experience including include required requirements preferred plus well within across between about etc may must should would could what when where which while who whom'.split(' '))

/** Free keyword check: the most frequent meaningful words of the job text and whether the resume contains them. Exported for tests. */
export function keywordCheck(resume, jd, max = 24) {
  const tok = (s) => s.toLowerCase().match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]/g) || []
  const have = new Set(tok(resume))
  const counts = new Map()
  for (const w of tok(jd)) if (w.length > 2 && !STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([w]) => w)
  const matched = top.filter((w) => have.has(w))
  return { matched, missing: top.filter((w) => !have.has(w)), score: top.length ? Math.round((matched.length / top.length) * 100) : 0 }
}

export function reportMd(d) {
  const L = (a) => a.map((x) => `- ${x}`).join('\n') || '- None'
  return [`# Resume fit report: ${d.fit_score}/100`, `**${d.verdict}**\n\n${d.summary}`,
    `## Score breakdown\n\n${d.breakdown.map((b) => `- **${b.area}:** ${b.score}/100. ${b.note}`).join('\n')}`,
    `## Strengths\n\n${L(d.strengths)}`,
    `## Gaps and how to address them\n\n${d.gaps.map((g) => `- **${g.gap}:** ${g.how_to_address}`).join('\n') || '- None'}`,
    `## Keywords\n\n**Matched:** ${d.matched_keywords.join(', ') || 'none'}\n\n**Missing:** ${d.missing_keywords.join(', ') || 'none'}`,
    `## Suggested bullet rewrites\n\n${d.tailored_bullets.map((b) => `**${b.section}**\n\n- Before: ${b.original}\n- After: ${b.suggested}`).join('\n\n') || 'None'}`,
    `## Cover letter opener\n\n${d.cover_letter_opener}`].join('\n\n')
}

const scoreColor = (n) => (n >= 75 ? 'var(--success)' : n >= 50 ? 'var(--warning)' : 'var(--danger)')

export function mount(root, { signal }) {
  injectStyle()
  if (!document.getElementById('ai-resume-style')) document.head.append(h('style', { id: 'ai-resume-style' }, CSS))
  let resume = null
  let data = null
  let rTab = 'file'
  let jTab = 'paste'
  const status = h('div')
  const results = h('div', { class: 'stack' })
  const chips = h('div')
  const rText = textarea({ rows: 8, placeholder: 'Paste your resume text...', 'aria-label': 'Resume text' })
  const jd = textarea({ rows: 8, placeholder: 'Paste the job description...', 'aria-label': 'Job description' })
  const jUrl = input({ placeholder: 'https://company.com/careers/job', inputmode: 'url', 'aria-label': 'Job posting link' })
  const fetchBtn = button('Fetch', { icon: 'download', variant: 'secondary' })
  const zone = dropzone({ accept: DOC_ACCEPT, label: 'Drop your resume (PDF, Word or text)', icon: 'file-user', hint: 'PDF, DOCX or TXT',
    onFiles: async ([f]) => { clear(status); try { resume = await readSource(f); clear(chips, fileChips([resume], () => { resume = null; clear(chips) })) } catch (e) { resume = null; clear(status, alert('error', e.message)) } } })
  const go = button('Check my fit', { icon: 'target', variant: 'primary', size: 'lg' })
  const quick = button('Free keyword check', { icon: 'list-checks', title: 'No AI and no key: compares the job words with your resume on this device' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Comparing' })
  const bar = exportBar(() => (data ? reportMd(data) : ''), 'resume-fit-report', { title: 'Resume fit report' })
  bar.hidden = true

  fetchBtn.addEventListener('click', () => busy(fetchBtn, async () => { const p = await fetchPage(jUrl.value.trim()); jd.value = p.text.slice(0, 30000); tabApiJ.show('paste') }, { label: 'Fetching', errorTo: status }))

  async function resumeText() {
    if (rTab === 'paste') return rText.value.trim()
    if (!resume) return ''
    if (resume.text) return resume.text
    const doc = await openPdf(resume.file)
    try { return (await extractText(doc)).map((p) => p.text).join('\n') } finally { doc.destroy?.() }
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    const jdText = jd.value.trim()
    if (jdText.length < 60) throw new Error('Paste the job description first (at least a few lines).')
    const blocks = rTab === 'paste' ? [ai.textBlock(`<resume>\n${rText.value.trim()}\n</resume>`)] : resume ? await resume.blocks() : []
    if (rTab === 'paste' ? rText.value.trim().length < 60 : !resume) throw new Error('Add your resume first: upload a file or paste its text.')
    const system = `You are an experienced recruiter and resume coach. Compare the candidate's resume with the job description and be honest and specific. ${UNTRUSTED}
fit_score (0-100) is how likely a recruiter would shortlist this resume for this job: 85+ strong match, 65-84 good, 45-64 partial, below 45 weak. breakdown has 4 to 6 areas (for example Skills, Experience level, Domain, Education, Keywords) each scored 0-100 with a one-line note. strengths: 3 to 6 points with evidence from the resume. gaps: real gaps against the job's requirements, each with a concrete way to address it (reframe existing experience, learn, or add a project). matched_keywords and missing_keywords are exact terms from the job description (up to 15 each). tailored_bullets: 3 to 6 rewrites of EXISTING resume bullets so they match the job's language; original is the resume's text, suggested is the rewrite. Use only facts in the resume: never invent employers, titles, tools or numbers; where a metric would help but is missing, write a placeholder like [X%] for the candidate to fill in. cover_letter_opener: a 2 to 3 sentence opening paragraph that is specific to this job and this candidate.`
    clear(results)
    const out = await ai.ask({ system, json: SCHEMA, effort: 'medium', signal: sig, messages: [{ role: 'user', content: [...blocks, ai.textBlock(`<job_description>\n${jdText}\n</job_description>\n\nCompare the resume with this job.`)] }] })
    data = { ...out, fit_score: Math.max(0, Math.min(100, Math.round(out.fit_score))), breakdown: (out.breakdown || []).map((b) => ({ ...b, score: Math.max(0, Math.min(100, Math.round(b.score))) })) }
    render()
  }, { label: 'Comparing' }))

  quick.addEventListener('click', () => busy(quick, async () => {
    const r = await resumeText()
    const j = jd.value.trim()
    if (!r || !j) throw new Error('Add your resume and the job description first.')
    const k = keywordCheck(r, j)
    data = null; bar.hidden = true
    clear(results, panel(h('div', { class: 'stack' },
      h('div', { class: 'ai-score' }, ring(k.score, 'keyword match'), h('div', h('strong', { style: 'font-size:17px' }, `${k.matched.length} of ${k.matched.length + k.missing.length} top job words appear in your resume`), h('p', { class: 'small muted', style: 'margin:4px 0 0' }, 'A quick local count of the most frequent words in the job text. For a real assessment, use Check my fit.'))),
      kwBlock('In your resume', k.matched, 'ok'), kwBlock('Not found in your resume', k.missing, 'miss'))))
  }, { label: 'Checking', errorTo: status }))

  const ring = (n, label) => h('div', { class: 'ai-ring', style: { '--p': n, '--c': scoreColor(n) }, role: 'img', 'aria-label': `${n} out of 100` }, h('div', { style: 'position:relative;text-align:center' }, h('b', n), h('small', label)))
  const kwBlock = (title, list, kind) => h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'ai-label' }, title), list.length ? h('div', { class: 'ai-chips' }, list.map((w) => h('span', { class: `ai-kw ${kind}` }, w))) : h('span', { class: 'small muted' }, 'None'))

  function render() {
    const d = data
    clear(results,
      panel(h('div', { class: 'stack' },
        h('div', { class: 'ai-score' }, ring(d.fit_score, 'fit score'), h('div', h('strong', { style: 'font-size:18px;display:block' }, d.verdict), h('p', { style: 'margin:6px 0 0;color:var(--text-2)' }, d.summary))),
        h('div', { class: 'stack', style: 'gap:10px' }, d.breakdown.map((b) => h('div', { style: `--c:${scoreColor(b.score)}` }, h('div', { class: 'row', style: 'justify-content:space-between;font-size:13.5px' }, h('strong', b.area), h('span', { class: 'muted' }, `${b.score}/100`)), h('div', { class: 'ai-bar' }, h('i', { style: `width:${b.score}%` })), h('div', { class: 'small muted', style: 'margin-top:3px' }, b.note)))),
        h('p', { class: 'small muted', style: 'margin:0' }, 'An AI estimate to guide your edits, not the result of any real applicant tracking system.'))),
      panel(h('div', { class: 'stack' }, h('h2', 'Strengths'), ...d.strengths.map((s) => h('div', { class: 'ai-li' }, icon('circle-check', ''), h('span', s))),
        h('h2', { style: 'margin-top:8px' }, 'Gaps and how to close them'), ...(d.gaps.length ? d.gaps.map((g) => h('div', { class: 'ai-li' }, icon('triangle-alert'), h('span', h('strong', g.gap), ' ', g.how_to_address))) : [h('span', { class: 'muted' }, 'No major gaps found.')]))),
      panel(h('div', { class: 'stack' }, h('h2', 'Keywords'), kwBlock('Matched', d.matched_keywords, 'ok'), kwBlock('Missing (add them only where they are true)', d.missing_keywords, 'miss'),
        d.missing_keywords.length ? h('div', { class: 'row' }, copyButton(() => d.missing_keywords.join(', '), 'Copy missing keywords')) : null)),
      d.tailored_bullets.length ? panel(h('div', { class: 'stack' }, h('h2', 'Suggested bullet rewrites'), ...d.tailored_bullets.map((b) => h('div', { class: 'ai-sug' },
        h('span', { class: 'ai-label' }, b.section), b.original && h('del', b.original), h('div', { style: 'color:var(--text)' }, b.suggested), h('div', { class: 'row' }, copyButton(() => b.suggested, 'Copy'))))) ) : null,
      panel(h('div', { class: 'stack' }, h('h2', 'Cover letter opener'), h('p', { style: 'margin:0;white-space:pre-wrap;color:var(--text)' }, d.cover_letter_opener), h('div', { class: 'row' }, copyButton(() => d.cover_letter_opener, 'Copy')))))
    bar.hidden = false
    results.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const resumeTabs = tabs([{ id: 'file', label: 'Upload', render: () => h('div', { class: 'stack' }, zone, chips) }, { id: 'paste', label: 'Paste text', render: () => rText }], 'file', (id) => { rTab = id })
  const tabApiJ = tabs([{ id: 'paste', label: 'Paste', render: () => jd }, { id: 'url', label: 'From a link', render: () => h('div', { class: 'stack' }, field('Job posting link', jUrl, 'Read through r.jina.ai. If a site blocks it, paste the text instead.'), row(fetchBtn)) }], 'paste', (id) => { jTab = id })

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' }, h('div', h('div', { class: 'ai-label', style: 'margin-bottom:6px' }, '1. Your resume'), resumeTabs), h('div', h('div', { class: 'ai-label', style: 'margin-bottom:6px' }, '2. The job'), tabApiJ),
        row(go, run.stop, quick), status,
        h('p', { class: 'small muted' }, 'Your resume and job text go only to the AI provider you chose. The free keyword check never leaves your device.'))),
      h('div', { class: 'stack' }, results, bar), 'wide-left')))
  clear(results, h('div', { class: 'empty' }, icon('target'), h('strong', { style: 'color:var(--text-2)' }, 'Your fit report appears here'), h('div', 'Add your resume and a job description: you get a fit score, strengths, gaps, missing keywords, rewritten bullets and a cover letter opener.')))
}
