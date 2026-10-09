// ATS analysis of resume text: contact info, sections, length, action verbs, numbers, red flags and keyword match against a job
// description. Pure logic (no DOM). Scores are heuristics that mirror what common applicant tracking systems look for.
import { findSkills } from './_skills.js'
import { analyzeJD, stem } from './_jd.js'
import { detectHeading, BULLET_RE, looksLikeHeaderLine, RANGE_RE, VERB_START } from './_resume.js'

export const STRONG_VERBS = new Set(`accelerated achieved acquired adapted administered advised advocated aligned analyzed analysed architected assembled assessed audited authored automated boosted brought built championed chaired clarified coached collaborated compiled completed composed conceived conducted configured consolidated constructed consulted contributed converted coordinated created crafted cut debugged decreased defined delegated delivered demonstrated deployed designed detected developed devised diagnosed directed discovered documented doubled drafted drove earned edited eliminated enabled enforced engineered enhanced ensured established estimated evaluated examined exceeded executed expanded expedited explored facilitated finalized forecasted formulated founded generated governed grew guided halved handled headed identified implemented improved increased influenced initiated innovated inspected installed instituted integrated interviewed introduced invented investigated launched led leveraged lifted maintained managed mapped marketed maximized measured mediated mentored merged migrated minimized mobilized modernized monitored motivated navigated negotiated onboarded operated optimized orchestrated organized originated outperformed overhauled oversaw owned partnered penned performed piloted pioneered planned presented prioritized processed procured produced programmed promoted prototyped provided published raised ran rebuilt recommended reconciled recruited redesigned reduced refactored refined rejuvenated released remodeled renegotiated reorganized replaced reported represented researched resolved restructured retained revamped reviewed revised revitalized saved scaled scheduled scoped secured selected served shaped shipped simplified sold solved sourced spearheaded standardized steered streamlined strengthened structured supervised supported surpassed sustained synthesized systematized tailored taught tested tracked trained transformed translated tripled troubleshot unified updated upgraded utilized validated visualized won wrote`.split(/\s+/))

export const WEAK_PHRASES = [
  [/\bresponsible for\b/gi, 'responsible for'], [/\bduties (?:included|include|were)\b/gi, 'duties included'], [/\bworked on\b/gi, 'worked on'], [/\bhelped (?:with|to)\b/gi, 'helped with'],
  [/\bassisted (?:with|in|to)\b/gi, 'assisted with'], [/\btasked with\b/gi, 'tasked with'], [/\bin charge of\b/gi, 'in charge of'], [/\binvolved in\b/gi, 'involved in'],
  [/\bparticipated in\b/gi, 'participated in'], [/\bexposure to\b/gi, 'exposure to'], [/\bfamiliar with\b/gi, 'familiar with'], [/\bvarious\b/gi, 'various'],
]
export const BUZZWORDS = ['team player', 'hard-working', 'hardworking', 'results-driven', 'results driven', 'detail-oriented', 'detail oriented', 'go-getter', 'think outside the box', 'synergy', 'self-motivated', 'highly motivated', 'people person', 'fast learner', 'strong work ethic', 'excellent communication skills', 'dynamic', 'passionate about', 'proven track record']
const PERSONAL = /\b(date of birth|d\.?o\.?b\.?|marital status|gender|religion|nationality|father['’]?s name|mother['’]?s name|passport (?:no|number)|photograph|age\s*:)/i
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,5}/g
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)'
const BULLET_START = new RegExp(BULLET_RE.source, 'u')

const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0)
const firstWord = (s) => (s.match(/^[A-Za-z]+/) || [''])[0].toLowerCase()
export const isStrongVerb = (w) => STRONG_VERBS.has(w) || STRONG_VERBS.has(w.replace(/s$/, '')) || /^(?:led|ran|cut|won|grew|built|drove|wrote|taught|sold|saved|set|made)$/.test(w) || VERB_START.test(w)

/** Split text into {id, lines} blocks by resume headings. */
export function blocksOf(text) {
  const blocks = [{ id: 'header', lines: [] }]
  for (const line of text.split('\n')) {
    const id = detectHeading(line)
    if (id) blocks.push({ id, lines: [], title: line.trim() })
    else blocks.at(-1).lines.push(line)
  }
  return blocks
}

export function extractBullets(lines) {
  const out = []
  let cur = null
  const push = () => { if (cur && cur.split(/\s+/).length >= 4) out.push(cur); cur = null }
  for (const raw of lines) {
    const t = raw.trim()
    if (!t) { push(); continue }
    if (BULLET_START.test(t)) { push(); cur = t.replace(BULLET_START, '').trim(); continue }
    if (RANGE_RE.test(t) && t.length < 110) { push(); continue }
    if (looksLikeHeaderLine(t)) { push(); continue }
    if (cur && (/^[a-z0-9(,]/.test(t) || !/[.!?]$/.test(cur))) { cur += ` ${t}`; continue }
    if (t.split(/\s+/).length >= 6 || isStrongVerb(firstWord(t))) { push(); cur = t } else push()
  }
  push()
  return out
}

function monthsOf(s, end) {
  const y = +(s.match(/(?:19|20)\d{2}/)?.[0] || 0)
  if (/present|current|now|today|ongoing|till/i.test(s)) { const d = new Date(); return d.getFullYear() * 12 + d.getMonth() }
  const mo = s.match(new RegExp(MON, 'i'))
  const m = mo ? ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(mo[0].toLowerCase()) : (s.match(/^(\d{1,2})\s*[/.-]/)?.[1] ? +s.match(/^(\d{1,2})\s*[/.-]/)[1] - 1 : end ? 11 : 0)
  return y * 12 + Math.max(0, Math.min(11, m))
}
/** Years covered by the date ranges in a text (overlaps counted once). */
export function yearsOfExperience(text) {
  const spans = []
  const re = new RegExp(RANGE_RE.source, 'gi')
  let m
  while ((m = re.exec(text))) {
    const a = monthsOf(m[1], false), b = monthsOf(m[2], true)
    if (a > 0 && b >= a && b - a < 12 * 50) spans.push([a, b + 1])
  }
  spans.sort((x, y) => x[0] - y[0])
  let total = 0, cur = null
  for (const s of spans) {
    if (!cur || s[0] > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [...s] } else cur[1] = Math.max(cur[1], s[1])
  }
  if (cur) total += cur[1] - cur[0]
  return Math.round((total / 12) * 10) / 10
}

function dateFormats(text) {
  const kinds = { 'Jan 2020': 0, 'January 2020': 0, '01/2020': 0, '2020': 0 }
  for (const m of text.matchAll(new RegExp(`\\b${MON}[a-z]*\\.?\\s*(?:'|’)?\\d{2,4}\\b|\\b\\d{1,2}\\s*[/.-]\\s*(?:19|20)\\d{2}\\b`, 'gi'))) {
    const t = m[0]
    if (/^\d/.test(t)) kinds['01/2020']++
    else if (/^[A-Za-z]{3}\b/.test(t) && !/^[A-Za-z]{4,}/.test(t.replace(/\.$/, ''))) kinds['Jan 2020']++
    else kinds['January 2020']++
  }
  return kinds
}

/** Keyword match of resume text against a parsed JD. */
export function matchJD(resumeText, jd, years = yearsOfExperience(resumeText)) {
  const rs = findSkills(resumeText)
  const have = new Map(rs.map((s) => [s.name, s]))
  const lower = resumeText.toLowerCase()
  const stems = new Set((lower.match(/[a-z][a-z0-9+#.\-/]{2,}/g) || []).map((w) => stem(w.replace(/[.\-/]+$/, ''))))
  const stemText = [...stems].join(' ')
  const skillRows = jd.skills.map((s) => {
    const weight = (s.level === 'nice' ? 1 : 2) + Math.min(s.count - 1, 2) * 0.5 + (s.inReq ? 0.5 : 0)
    const h = have.get(s.name)
    return { ...s, weight, present: !!h, inResume: h?.count || 0 }
  })
  const termRows = jd.terms.slice(0, 14).map((t) => {
    const parts = t.term.split(' ')
    const present = parts.every((p) => stems.has(stem(p))) && (parts.length === 1 || lower.includes(t.term) || parts.every((p) => stemText.includes(stem(p))))
    return { ...t, weight: 0.6 + Math.min(t.count - 1, 3) * 0.2, present }
  })
  const sTot = skillRows.reduce((n, s) => n + s.weight, 0), sHit = skillRows.filter((s) => s.present).reduce((n, s) => n + s.weight, 0)
  const tTot = termRows.reduce((n, s) => n + s.weight, 0), tHit = termRows.filter((s) => s.present).reduce((n, s) => n + s.weight, 0)
  const total = sTot + tTot
  const score = total ? Math.round((100 * (sHit + tHit)) / total) : null
  const softRows = jd.soft.map((s) => ({ ...s, present: lower.includes(s.name.toLowerCase().split('|')[0]) }))
  return { score, skills: skillRows, terms: termRows, soft: softRows, years, jdYears: jd.years.main, skillScore: sTot ? Math.round((100 * sHit) / sTot) : null }
}

/** Main entry. meta = extraction info ({kind, pages, info:{columns, tables, images, scanned}}). */
export function analyzeResume(text, meta = {}, jdText = '') {
  const info = meta.info || {}
  const raw = String(text || '')
  const words = (raw.match(/\S+/g) || []).length
  const blocks = blocksOf(raw)
  const has = (id) => blocks.some((b) => b.id === id && b.lines.some((l) => l.trim()))
  const head = raw.slice(0, 600)
  const emails = raw.match(EMAIL)
  const phones = (raw.slice(0, 1200).match(PHONE) || []).filter((p) => p.replace(/\D/g, '').length >= 8 && p.replace(/\D/g, '').length <= 15)
  const linkedin = /linkedin\.com\/in\//i.test(raw)
  const github = /github\.com\//i.test(raw)
  const location = /\b[A-Z][a-zA-Z.\- ]{2,25},\s*(?:[A-Z]{2}\b|[A-Z][a-zA-Z .]{3,25})/.test(head)
  const expBlocks = blocks.filter((b) => b.id === 'experience' || b.id === 'projects')
  const bullets = extractBullets((expBlocks.length ? expBlocks : blocks.filter((b) => b.id !== 'header' && b.id !== 'skills' && b.id !== 'education')).flatMap((b) => b.lines))
  const strong = bullets.filter((b) => isStrongVerb(firstWord(b)))
  const numbered = bullets.filter((b) => /\d|%|\$|₹|£|€/.test(b))
  const weak = []
  for (const [re, label] of WEAK_PHRASES) { const n = (raw.match(re) || []).length; if (n) weak.push({ label, n }) }
  const lower = raw.toLowerCase()
  const buzz = BUZZWORDS.filter((b) => lower.includes(b))
  const pronouns = (raw.match(/(?:^|[\s.(])(?:I|my|me)\s/g) || []).length
  const personal = (raw.match(PERSONAL) || [])[0]
  const symbols = [...new Set(raw.match(/[\p{Extended_Pictographic}☀-➿←-⇿■-◿]/gu) || [])].filter((c) => !/[•●▪◦→✓]/.test(c))
  const fmts = dateFormats(raw)
  const usedFmts = Object.entries(fmts).filter(([, n]) => n > 0)
  const hasDates = RANGE_RE.test(raw)
  const years = yearsOfExperience(blocks.filter((b) => b.id === 'experience').flatMap((b) => b.lines).join('\n') || raw)
  const skills = findSkills(raw).filter((s) => s.cat !== 'Soft skills')
  const longLines = bullets.filter((b) => b.split(/\s+/).length > 45).length
  const pages = meta.pages || Math.max(1, Math.ceil(words / 550))

  const checks = []
  const add = (id, kind, title, detail, weight, extra) => checks.push({ id, kind, title, detail, weight, extra })

  if (info.scanned) add('scanned', 'bad', 'No selectable text', 'This looks like a scanned or image-only PDF. Applicant tracking systems cannot read it at all, so your resume would be rejected before a human sees it. Export a text PDF from Word or Docs, or use the Resume builder.', 25)
  if (info.columns) add('columns', 'bad', 'Multiple columns detected', 'Many ATS read columns across the page, mixing up your jobs and skills. Use a single-column layout.', 9)
  if (info.tables) add('tables', 'warn', `Tables found (${info.tables})`, 'Tables can scramble reading order in some systems. Prefer plain paragraphs with tab-aligned dates.', 6)
  if (info.images) add('images', 'warn', `Images found (${info.images})`, 'Photos, logos and icons are ignored by ATS and can push your text around. Remove them.', 4)

  add('email', emails ? 'ok' : 'bad', emails ? 'Email address found' : 'No email address', emails ? emails[0] : 'Recruiters and ATS need an email in plain text near the top.', 8)
  add('phone', phones.length ? 'ok' : 'warn', phones.length ? 'Phone number found' : 'No phone number', phones[0]?.trim() || 'Add a phone number with the country code.', 5)
  add('links', linkedin ? 'ok' : 'warn', linkedin ? 'LinkedIn profile linked' : 'No LinkedIn link', linkedin ? (github ? 'GitHub also linked.' : '') : 'Most recruiters look you up. Add your linkedin.com/in/ URL.', 3)
  add('location', location ? 'ok' : 'warn', location ? 'Location found' : 'No location', location ? '' : 'Add your city and country. Many ATS filter candidates by location.', 2)

  add('experience', has('experience') ? 'ok' : 'bad', has('experience') ? 'Experience section found' : 'No "Experience" heading', has('experience') ? '' : 'Use a standard heading such as "Work Experience" so the parser can find your jobs.', 10)
  add('education', has('education') ? 'ok' : 'warn', has('education') ? 'Education section found' : 'No "Education" heading', has('education') ? '' : 'Add an Education section with degree, school and year.', 6)
  add('skills', has('skills') ? 'ok' : 'warn', has('skills') ? 'Skills section found' : 'No "Skills" heading', has('skills') ? `${skills.length} known skills detected.` : 'A dedicated Skills section is the first place keyword filters look.', 8)
  add('summary', has('summary') ? 'ok' : 'info', has('summary') ? 'Summary found' : 'No summary (optional)', has('summary') ? '' : 'A 2 to 3 line summary with your title and top skills helps both ATS and humans.', 2)
  add('dates', hasDates ? 'ok' : 'warn', hasDates ? 'Dates are readable' : 'No date ranges found', hasDates ? '' : 'Use clear ranges like "Jan 2021 - Present" so tenure can be calculated.', 4)
  if (usedFmts.length > 1 && usedFmts.filter(([, n]) => n >= 2).length > 1) add('datefmt', 'warn', 'Mixed date formats', `You use ${usedFmts.map(([k]) => k).join(' and ')}. Pick one format and use it everywhere.`, 3)

  const lenKind = words < 200 ? 'bad' : words < 280 ? 'warn' : words <= 850 ? 'ok' : words <= 1050 ? 'warn' : 'bad'
  add('length', lenKind, `${words.toLocaleString()} words${meta.pages ? `, ${meta.pages} page${meta.pages > 1 ? 's' : ''}` : ''}`, lenKind === 'ok' ? 'A good length. One page for under 10 years of experience, two for more.' : words < 280 ? 'Quite short. Add measurable achievements and relevant projects.' : 'Long. Cut older or less relevant detail. Aim for one or two pages.', 8)
  if (meta.pages > 2) add('pages', meta.pages > 3 ? 'bad' : 'warn', `${meta.pages} pages`, 'Recruiters spend seconds per resume. Keep it to two pages at most.', 4)

  if (bullets.length >= 3) {
    const vp = pct(strong.length, bullets.length)
    add('verbs', vp >= 60 ? 'ok' : vp >= 35 ? 'warn' : 'bad', `${vp}% of bullets start with a strong verb`, vp >= 60 ? 'Good. Strong verbs show ownership.' : `Start more bullets with verbs like Led, Built, Reduced, Launched. Weak starts: ${bullets.filter((b) => !isStrongVerb(firstWord(b))).slice(0, 2).map((b) => `"${b.slice(0, 40)}..."`).join(', ')}`, 10, `${strong.length} of ${bullets.length}`)
    const np = pct(numbered.length, bullets.length)
    add('numbers', np >= 40 ? 'ok' : np >= 20 ? 'warn' : 'bad', `${np}% of bullets include numbers`, np >= 40 ? 'Numbers make results believable.' : 'Add metrics: percentages, money, team size, time saved, users, volume.', 10, `${numbered.length} of ${bullets.length}`)
    if (longLines) add('longbullets', 'warn', `${longLines} very long bullet${longLines > 1 ? 's' : ''}`, 'Keep bullets to one or two lines (under about 35 words).', 3)
  } else if (has('experience')) {
    add('bullets', 'warn', 'Few bullet points found', 'Describe each job with 3 to 5 bullets instead of long paragraphs. If your bullets exist but are not detected, your PDF may have dropped the bullet characters.', 8)
  }
  add('weak', weak.length ? 'warn' : 'ok', weak.length ? `Weak phrases: ${weak.map((w) => `"${w.label}"`).join(', ')}` : 'No weak phrases', weak.length ? 'Replace "responsible for" and "worked on" with what you achieved: "Led", "Built", "Reduced".' : '', 5)
  if (buzz.length) add('buzz', 'warn', `Buzzwords: ${buzz.slice(0, 4).join(', ')}`, 'These phrases say nothing specific. Show the result instead of claiming the trait.', 3)
  if (pronouns > 2) add('pronouns', 'warn', 'First-person pronouns', 'Resumes drop "I" and "my". Write "Led a team of 5" rather than "I led my team of 5".', 3)
  if (personal) add('personal', 'warn', `Personal details ("${personal.trim()}")`, 'Date of birth, marital status, gender or photo are unnecessary and can introduce bias. Remove them unless the country requires them.', 3)
  if (symbols.length) add('symbols', 'warn', `Special symbols: ${symbols.slice(0, 5).join(' ')}`, 'Emojis and decorative icons often turn into garbage characters in ATS. Use plain text.', 3)
  add('skillcount', skills.length >= 8 ? 'ok' : skills.length >= 4 ? 'warn' : 'bad', `${skills.length} known skill${skills.length === 1 ? '' : 's'} mentioned`, skills.length >= 8 ? '' : 'List more relevant tools and technologies. Skills are the main thing keyword filters match.', 5)

  const total = checks.filter((c) => c.weight).reduce((n, c) => n + c.weight, 0)
  const earned = checks.reduce((n, c) => n + (c.kind === 'ok' ? c.weight : c.kind === 'warn' ? c.weight * 0.5 : 0), 0)
  let readiness = total ? Math.round((100 * earned) / total) : 0
  if (info.scanned) readiness = Math.min(readiness, 10)
  checks.sort((a, b) => ({ bad: 0, warn: 1, info: 2, ok: 3 }[a.kind] - { bad: 0, warn: 1, info: 2, ok: 3 }[b.kind]) || b.weight - a.weight)

  const jd = jdText && jdText.trim().length > 40 ? analyzeJD(jdText) : null
  const match = jd ? matchJD(raw, jd, years) : null
  const suggestions = []
  if (match) {
    const miss = match.skills.filter((s) => !s.present).sort((a, b) => b.weight - a.weight)
    const must = miss.filter((s) => s.level === 'must').slice(0, 6)
    if (must.length) suggestions.push(`Add these required skills if you have them: ${must.map((s) => s.name).join(', ')}. Put them in your Skills section and in a bullet that shows how you used them.`)
    const nice = miss.filter((s) => s.level === 'nice').slice(0, 4)
    if (nice.length) suggestions.push(`Nice-to-have keywords you can mention honestly: ${nice.map((s) => s.name).join(', ')}.`)
    const mt = match.terms.filter((t) => !t.present).slice(0, 5)
    if (mt.length) suggestions.push(`Echo the employer's wording where it is true for you: ${mt.map((t) => `"${t.term}"`).join(', ')}.`)
    if (match.jdYears && match.years && match.years + 0.5 < match.jdYears) suggestions.push(`The role asks for ${match.jdYears}+ years and your dates add up to about ${match.years}. Emphasize depth and scope of your work, or apply if the other requirements fit well.`)
    if (jd.title && !lower.includes(jd.title.toLowerCase().split(/[,(|\-–]/)[0].trim())) suggestions.push(`Mirror the job title ("${jd.title.split(/[,(|]/)[0].trim()}") in your headline or summary if it honestly describes you.`)
  }
  for (const c of checks.filter((c) => c.kind === 'bad' || c.kind === 'warn').sort((a, b) => b.weight - a.weight).slice(0, 5)) suggestions.push(`${c.title}. ${c.detail}`.replace(/\.\./g, '.'))

  return {
    words, pages: meta.pages || null, bullets: bullets.length, strongBullets: strong.length, numberedBullets: numbered.length, years, skills, checks, readiness,
    contact: { email: emails?.[0] || '', phone: phones[0]?.trim() || '', linkedin, github, location }, sections: blocks.filter((b) => b.id !== 'header' && b.id !== 'ignored').map((b) => b.id),
    jd, match, suggestions,
  }
}

export const verdict = (n) => (n >= 85 ? 'Excellent' : n >= 70 ? 'Good' : n >= 50 ? 'Needs work' : 'Risky')

export function reportText(a, name = '') {
  const L = [`ATS report${name ? ` for ${name}` : ''}`, `ATS readiness: ${a.readiness}/100 (${verdict(a.readiness)})`]
  if (a.match?.score != null) L.push(`Job match: ${a.match.score}/100 (${verdict(a.match.score)})`)
  L.push('', 'Checks')
  for (const c of a.checks) L.push(`[${c.kind.toUpperCase()}] ${c.title}${c.detail ? ` - ${c.detail}` : ''}`)
  if (a.match) {
    L.push('', `Present keywords: ${a.match.skills.filter((s) => s.present).map((s) => s.name).join(', ') || 'none'}`, `Missing keywords: ${a.match.skills.filter((s) => !s.present).map((s) => s.name).join(', ') || 'none'}`)
    if (a.match.terms.some((t) => !t.present)) L.push(`Missing terms: ${a.match.terms.filter((t) => !t.present).map((t) => t.term).join(', ')}`)
  }
  if (a.suggestions.length) L.push('', 'Top fixes', ...a.suggestions.map((s, i) => `${i + 1}. ${s}`))
  return L.join('\n')
}
