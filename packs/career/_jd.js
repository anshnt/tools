// Job description analysis (skills, years, education, sections, salary, red flags, keywords). Pure logic, shared by the
// job description analyzer, ATS checker and cover letter tool.
import { findSkills, STOPWORDS } from './_skills.js'

const EM = String.fromCharCode(0x2014)
export const DASH = `-–${EM}`
const dashRe = `[${DASH}]`

const GENERIC = new Set(`company companies team teams role roles work working job jobs position candidate candidates ability experience experienced years year skills skill strong good great excellent knowledge understanding preferred required requirements responsibilities qualifications opportunity opportunities looking seeking responsible including include includes etc within across using use used based help helping ensure provide support develop developing build building create creating join joining will plus new well make get must should may might need needs needed environment business people customers customer clients client product products services service solutions solution projects project tasks task industry global world leading looking hiring apply application employer equal employment location full time part benefits salary compensation paid please contact email also like would want wants able love passion passionate fast growing growth impact day months month week weeks hours hour per range level high highly proven demonstrated deep broad working closely collaborate collaboration collaborating related relevant similar general hard play plays works offer offers depending flexible budget learning minimal supervision critical every stakeholders ship features`.split(/\s+/))

const HEAD = {
  responsibilities: /^(?:what you(?:['’]ll| will) (?:do|be doing|own)|(?:key |core |main )?responsibilities|your role|the role|role overview|duties|day[- ]to[- ]day|about the (?:role|job|position)|job description|job summary|position summary|what the job involves|in this role)\b/i,
  nice: /^(?:nice[- ]to[- ]haves?|preferred(?: qualifications| skills| experience)?|bonus(?: points)?|good[- ]to[- ]have|desired(?: skills| qualifications)?|extra credit|it['’]s a plus|a plus|great to have|pluses)\b/i,
  requirements: /^(?:requirements?|(?:minimum |basic |required |key )?qualifications|what you(?:['’]ll| will) need|what we(?:['’]re| are) looking for|must[- ]haves?|required(?: skills| experience)?|who you are|you have|your profile|what you bring|you bring|ideal candidate|about you|skills(?: and experience)?(?: required)?|technical skills|eligibility|experience (?:and|&) skills)\b/i,
  benefits: /^(?:benefits|perks(?: and benefits)?|what we offer|why join|why (?:you['’]ll )?love|compensation(?: and benefits)?|what['’]s in it for you|we offer|our benefits|life at)\b/i,
  about: /^(?:about (?:us|the company|our company|the team)|who we are|company(?: overview| description)?|our (?:mission|story|team|culture)|overview)\b/i,
}
const BULLET = /^\s*(?:[•●▪◦‣⁃∙·■✓→➢*+-]|–|\d{1,2}[.)])\s+/

/** Split a JD into labelled sections: {responsibilities, requirements, nice, benefits, about, other: string[]}. */
export function splitSections(text) {
  const out = { responsibilities: [], requirements: [], nice: [], benefits: [], about: [], other: [] }
  let cur = 'other'
  let detected = false
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const bare = line.replace(/[:*_#]+$/g, '').replace(/^[#*_\s]+/, '').trim()
    if (bare.length <= 64 && !BULLET.test(line) && (/:\s*$/.test(line) || /^[A-Z][A-Za-z '’&/-]{2,60}$/.test(bare) || bare === bare.toUpperCase())) {
      const hit = Object.entries(HEAD).find(([, re]) => re.test(bare))
      if (hit) { cur = hit[0]; detected = true; continue }
    }
    const inline = line.match(/^([A-Za-z][A-Za-z '’&/-]{2,40}):\s+(\S.*)$/)
    const inlineHit = inline && Object.entries(HEAD).find(([, re]) => re.test(inline[1].trim()))
    if (inlineHit) { cur = inlineHit[0]; detected = true; out[cur].push(inline[2].trim()); continue }
    out[cur].push(line.replace(BULLET, '').trim())
  }
  out.detected = detected
  return out
}

const sentences = (lines) => lines.flatMap((l) => (l.length > 160 ? l.split(/(?<=[.!?])\s+(?=[A-Z])/) : [l])).map((s) => s.trim()).filter((s) => s.length > 12)

/** When a JD has no headings, sort sentences by the language they use. */
function classifyLoose(lines) {
  const resp = [], req = []
  for (const s of sentences(lines)) {
    if (/\b(you will|you['’]ll|responsible for|will be responsible|will work|will lead|will own|will design|will build|you are going to)\b/i.test(s)) resp.push(s)
    else if (/\b(must|required|requires?|experience (?:with|in|of)|proficien|knowledge of|ability to|degree|years of|strong|familiar)/i.test(s)) req.push(s)
  }
  return { resp, req }
}

const YEARS = new RegExp(`(\\d{1,2})\\s*(?:\\+|plus)?\\s*(?:(?:${dashRe}|to)\\s*(\\d{1,2})\\s*\\+?\\s*)?(?:years?|yrs?)\\b`, 'gi')
export function findYears(text) {
  const out = []
  let m
  YEARS.lastIndex = 0
  while ((m = YEARS.exec(text))) {
    const min = +m[1], max = m[2] ? +m[2] : null
    if (min > 40) continue
    const ctx = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 70).replace(/\s+/g, ' ').trim()
    if (!/exp|work|industry|professional|background|years of|in a|in the|with/i.test(ctx)) continue
    out.push({ min, max, plus: /\+|plus|at least|minimum|more than/i.test(m[0] + ctx.slice(0, 40)), text: m[0].trim(), ctx })
  }
  return out
}

const EDU = [
  ['PhD', /\b(ph\.?\s?d\.?|doctorate|doctoral)\b/i, 4],
  ['Master\'s', /\b(master(?:['’]s)?(?: degree)?|m\.?\s?tech|m\.?\s?sc|m\.?\s?s\.?(?= in| degree)|mba|m\.?\s?e\.?(?= in)|mca|pgdm|postgraduate|post[- ]graduate)\b/i, 3],
  ['Bachelor\'s', /\b(bachelor(?:['’]s)?(?: degree)?|b\.?\s?tech|b\.?\s?e\.?(?= in| degree)|b\.?\s?sc|b\.?\s?s\.?(?= in| degree)|b\.?\s?a\.?(?= in| degree)|b\.?\s?com|bca|bba|undergraduate|graduate degree|university degree|college degree|degree in)\b/i, 2],
  ['Diploma', /\b(diploma|associate(?:['’]s)? degree|iti|polytechnic)\b/i, 1],
]
export function findEducation(text) {
  const hits = EDU.filter(([, re]) => re.test(text)).map(([n, , rank]) => ({ level: n, rank }))
  hits.sort((a, b) => b.rank - a.rank)
  return { levels: hits.map((h) => h.level), top: hits[0]?.level || '', equivalent: /(or )?equivalent (?:practical |work |professional )?experience|or related (?:field|experience)|in lieu of/i.test(text) }
}

export function findSeniority(title, years) {
  const t = (title || '').toLowerCase()
  const map = [['Intern', /\bintern(?:ship)?\b|\btrainee\b/], ['Executive', /\b(vp|vice president|chief|cxo|c-level|head of|director)\b/], ['Lead / Principal', /\b(principal|staff|lead|architect|manager)\b/], ['Senior', /\b(senior|sr\.?)\b/], ['Junior', /\b(junior|jr\.?|entry[- ]level|graduate|fresher|associate)\b/]]
  for (const [n, re] of map) if (re.test(t)) return n
  if (years != null) return years >= 8 ? 'Senior' : years >= 4 ? 'Mid-level' : years >= 1 ? 'Junior' : 'Entry level'
  return ''
}

const CUR = String.raw`(?:₹|rs\.?|inr|\$|usd|us\$|£|gbp|€|eur|cad|aud|sgd|aed|c\$|a\$)`
const NUM = String.raw`\d[\d,]*(?:\.\d+)?\s*(?:k|m|mn|million|lpa|lakhs?|lacs?|crores?|cr)?`
const SALARY = [
  new RegExp(`${CUR}\\s*${NUM}(?:\\s*(?:${dashRe}|to)\\s*${CUR}?\\s*${NUM})?(?:\\s*(?:/|per|a|an)\\s*(?:year|yr|annum|month|mo|hour|hr|week|day)|\\s*(?:p\\.?a\\.?|pm|ctc|annually|monthly|hourly))?`, 'gi'),
  new RegExp(`\\b\\d[\\d.]*\\s*(?:${dashRe}|to)\\s*\\d[\\d.]*\\s*(?:lpa|lakhs?|lacs?|l\\.?p\\.?a\\.?|cr|crores?)\\b`, 'gi'),
  new RegExp(`\\b\\d[\\d,]*\\s*(?:${dashRe}|to)\\s*\\d[\\d,]*\\s*(?:usd|inr|eur|gbp|dollars)\\b`, 'gi'),
]
export function findSalary(text) {
  const seen = new Set()
  const figures = []
  for (const re of SALARY) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      const s = m[0].trim().replace(/\s+/g, ' ')
      if (!/\d/.test(s) || seen.has(s.toLowerCase())) continue
      if (/^\d{1,3}$/.test(s.replace(/\D/g, '')) && !/[kmlc$₹£€]/i.test(s) && s.length < 4) continue
      seen.add(s.toLowerCase())
      figures.push(s)
    }
  }
  const vague = /\b(competitive|attractive|market[- ]leading|industry[- ]standard|best[- ]in[- ]class|commensurate)\b[^.]{0,30}\b(salary|pay|compensation|package|remuneration)\b|\b(salary|pay|compensation|package)\b[^.]{0,25}\b(competitive|negotiable|based on experience|depends on experience|commensurate)\b/i.test(text)
  return { figures: figures.slice(0, 8), vague, none: !figures.length }
}

export const RED_FLAGS = [
  [/\b(rock ?stars?|ninjas?|gurus?|wizards?|superheroe?s?|unicorns?|10x)\b/i, 'Hype job titles', 'Words like rockstar or ninja usually signal vague expectations and a try-hard culture. Ask what the day to day really looks like.'],
  [/\bfast[- ]paced\b/i, '"Fast-paced environment"', 'Often a polite way to say tight deadlines or thin staffing. Ask about workload and typical hours.'],
  [/\bwear(?:ing)? (?:many|multiple|several) hats\b|\bjack[- ]of[- ]all[- ]trades\b/i, 'Wear many hats', 'The role may have no clear boundaries and cover several jobs for one salary.'],
  [/\bwork hard,? play hard\b|\b(?:we(?:['’]re| are)|like) (?:a )?family\b|\bour family\b/i, 'Work hard / we are a family', 'Family language can blur boundaries and make overtime feel like loyalty.'],
  [/\bthick skin\b|\bhigh[- ]pressure\b|\bhandle (?:a lot of )?pressure\b|\bstress(?:ful)? environment\b/i, 'High pressure', 'They are telling you the job is stressful. Ask how the team supports people under pressure.'],
  [/\bother duties as assigned\b|\band other duties\b|\bduties may vary\b|\bas needed\b/i, 'Open-ended duties', 'Scope can grow without any change in title or pay.'],
  [/\b24\s?\/\s?7\b|\bon[- ]call\b|\bweekends?\b[^.]{0,20}\b(?:as needed|required|when needed)\b|\blong hours\b|\bflexible (?:hours|schedule)\b[^.]{0,30}\b(?:required|expected)\b/i, 'Unsocial hours', 'On-call or weekend work is mentioned. Check how it is compensated.'],
  [/\bself[- ]starter\b|\bminimal supervision\b|\bwork independently\b|\bno hand[- ]holding\b/i, 'Little support', 'Often means you will get limited onboarding or mentoring.'],
  [/\bunpaid\b|\bcommission[- ]only\b|\bno (?:base )?salary\b|\bperformance[- ]based pay only\b/i, 'Unpaid or commission only', 'No guaranteed base pay. Make sure that works for you before investing time.'],
  [/\b(?:young|youthful|energetic|dynamic) (?:and|&|,)? ?(?:dynamic|energetic|team|professionals?)\b|\bdigital native\b|\brecent graduates? only\b|\bunder (?:the age of )?\d{2}\b|\bmale candidates?\b|\bfemale candidates?\b/i, 'Possibly discriminatory wording', 'Age or gender preferences can be illegal in many places and say a lot about the employer.'],
  [/\b(?:immediate joiners?|urgent(?:ly)? (?:hiring|required|requirement)|join immediately)\b/i, 'Urgent hiring', 'They need someone fast. That can mean churn or a rushed process.'],
  [/\bunlimited (?:pto|vacation|leave|time off)\b/i, 'Unlimited time off', 'Sounds generous, but people often end up taking less. Ask what the average actually is.'],
  [/\bwilling to relocate\b|\bmust relocate\b|\btravel (?:up to|of up to|approximately)?\s*\d{2,3}\s?%/i, 'Relocation or heavy travel', 'Check what support is offered for moving or travel time.'],
  [/\bmultitask(?:ing)?\b[^.]{0,30}\b(?:priorities|projects)\b|\bjuggle\b/i, 'Juggling priorities', 'Could mean too many priorities and no clear owner.'],
]

export function findFlags(text) {
  const out = []
  for (const [re, label, why] of RED_FLAGS) {
    const m = text.match(re)
    if (m) {
      const i = m.index
      const from = text.lastIndexOf('\n', i) + 1
      let to = text.indexOf('\n', i + m[0].length)
      if (to < 0) to = text.length
      let snippet = text.slice(from, to).replace(BULLET, '').replace(/\s+/g, ' ').trim()
      if (snippet.length > 150) { const k = i - from; snippet = `...${snippet.slice(Math.max(0, k - 50), k + m[0].length + 70).trim()}...` }
      out.push({ label, why, snippet })
    }
  }
  return out
}

/** Frequent meaningful words and two-word phrases that are not dictionary skills. */
export function keyTerms(text, skillNames = []) {
  const skillWords = new Set(skillNames.flatMap((s) => s.toLowerCase().split(/[^a-z0-9+#.]+/)))
  const words = (text.toLowerCase().match(/[a-z][a-z0-9+#.\-/]{2,}/g) || []).map((w) => w.replace(/[.\-/]+$/, ''))
  const ok = (w) => w.length >= 3 && !STOPWORDS.has(w) && !GENERIC.has(w) && !skillWords.has(w) && !/^\d/.test(w)
  const uni = new Map(), bi = new Map()
  for (let i = 0; i < words.length; i++) {
    if (ok(words[i])) uni.set(stem(words[i]), { term: words[i], n: (uni.get(stem(words[i]))?.n || 0) + 1 })
    if (i + 1 < words.length && ok(words[i]) && ok(words[i + 1])) {
      const k = `${words[i]} ${words[i + 1]}`
      bi.set(k, (bi.get(k) || 0) + 1)
    }
  }
  const phrases = [...bi.entries()].filter(([, n]) => n >= 2).map(([term, n]) => ({ term, count: n, phrase: true }))
  const phraseWords = new Set(phrases.flatMap((p) => p.term.split(' ').map(stem)))
  const single = [...uni.values()].filter((x) => x.n >= 2 && !phraseWords.has(stem(x.term))).map((x) => ({ term: x.term, count: x.n }))
  return [...phrases, ...single].sort((a, b) => b.count - a.count || b.term.length - a.term.length).slice(0, 30)
}

/** Light stemmer so "managing", "managed" and "management" meet in the middle. */
export function stem(w) {
  return w.replace(/(?:ing|ed|es|s|ment|ions?|ally|ly)$/i, '').replace(/(.)\1$/, '$1')
}

export function guessTitle(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const labelled = text.match(/^(?:job\s*title|position|role|title)\s*[:\-]\s*(.+)$/im)
  if (labelled) return labelled[1].trim().slice(0, 90)
  const first = lines.find((l) => l.length <= 90 && !/[.!?]$/.test(l) && !HEAD.about.test(l) && !HEAD.responsibilities.test(l))
  return first || ''
}

/** Full JD analysis. */
export function analyzeJD(text) {
  const t = String(text || '').replace(/\r/g, '').trim()
  const sec = splitSections(t)
  let responsibilities = sec.responsibilities, requirements = sec.requirements, nice = sec.nice
  if (!sec.detected || (!responsibilities.length && !requirements.length)) {
    const loose = classifyLoose(sec.other.length ? sec.other : t.split('\n'))
    if (!responsibilities.length) responsibilities = loose.resp
    if (!requirements.length) requirements = loose.req
  }
  responsibilities = sentences(responsibilities).slice(0, 40)
  requirements = sentences(requirements).slice(0, 40)
  nice = sentences(nice).slice(0, 30)

  const found = findSkills(t)
  const niceText = nice.join('\n').toLowerCase()
  const niceSkillNames = new Set(findSkills(nice.join('\n')).map((s) => s.name))
  const reqNames = new Set(findSkills(requirements.join('\n')).map((s) => s.name))
  const skills = found.filter((s) => s.cat !== 'Soft skills').map((s) => {
    const inNiceSentence = new RegExp(`(?:nice to have|preferred|bonus|a plus|good to have|desired|ideally)[^.\\n]{0,120}\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(t)
    const level = niceSkillNames.has(s.name) && !reqNames.has(s.name) || inNiceSentence ? 'nice' : 'must'
    return { ...s, level, inReq: reqNames.has(s.name) }
  })
  void niceText
  const soft = found.filter((s) => s.cat === 'Soft skills')
  const years = findYears(t)
  const mainYears = years.length ? Math.max(...years.map((y) => y.min)) : null
  const title = guessTitle(t)
  const education = findEducation(t)
  const salary = findSalary(t)
  const flags = findFlags(t)
  const wordsN = (t.match(/\S+/g) || []).length
  if (skills.filter((s) => s.level === 'must').length > 16) flags.push({ label: 'Very long wish list', why: 'A very long list of must-have skills usually describes an imaginary perfect hire. Apply if you match the core, not every item.', snippet: `${skills.filter((s) => s.level === 'must').length} required skills listed` })
  if ((/\bentry[- ]level\b|\bfreshers?\b/i.test(t) || /\b(?:junior|graduate|associate)\b/i.test(title)) && mainYears != null && mainYears >= 3) flags.push({ label: 'Entry level with experience', why: `Asks for entry level but also ${mainYears}+ years of experience. Expectations and pay may not match.`, snippet: `${mainYears}+ years` })
  if (!salary.figures.length) flags.push({ label: 'No pay range', why: 'Pay is not stated. In many regions employers are expected to share it, so ask early.', snippet: salary.vague ? 'Mentions competitive pay but gives no figure' : 'No salary information found' })
  const mode = /\bfully remote\b|\b100% remote\b|\bremote[- ]first\b|\bwork from home\b|\bwfh\b/i.test(t) ? 'Remote' : /\bhybrid\b/i.test(t) ? 'Hybrid' : /\bon[- ]?site\b|\bin[- ]office\b|\bwork from (?:the )?office\b|\bwfo\b/i.test(t) ? 'On-site' : /\bremote\b/i.test(t) ? 'Remote friendly' : ''
  const employment = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance', 'Temporary'].filter((x) => new RegExp(`\\b${x.replace('-', '[- ]?')}\\b`, 'i').test(t) || (x === 'Contract' && /\bcontract(?:or)?\b/i.test(t)) || (x === 'Internship' && /\bintern(?:ship)?\b/i.test(t)))
  const location = (t.match(/^(?:location|based in|office location|work location)\s*[:\-]\s*(.+)$/im) || [])[1]?.split(/\s*[|•]\s*/)[0].trim().slice(0, 80) || ''
  return {
    words: wordsN, title, seniority: findSeniority(title, mainYears), years: { main: mainYears, list: years.slice(0, 6) }, education, employment, mode, location,
    sections: { responsibilities, requirements, nice, benefits: sentences(sec.benefits).slice(0, 20), about: sentences(sec.about).slice(0, 8) },
    skills, soft, terms: keyTerms(t, found.map((s) => s.name)), salary, flags, headingsFound: sec.detected,
  }
}

export const SAMPLE_JD = `Senior Backend Engineer - Payments Platform
Location: Bengaluru, India (Hybrid)  |  Full-time

About us
Northwind Labs builds payment infrastructure used by 20,000 merchants. We are a fast-paced team that works hard and plays hard.

What you will do
- Design and build scalable microservices in Python and Go
- Own our data pipelines on AWS using Kafka, Airflow and PostgreSQL
- Lead code reviews and mentor junior engineers
- Partner with product managers and stakeholders to ship features every sprint
- Improve reliability, monitoring and incident response for critical payment flows

Requirements
- 5+ years of professional experience in backend engineering
- Bachelor's degree in Computer Science or equivalent practical experience
- Strong knowledge of Python, SQL, Docker and Kubernetes
- Experience designing REST APIs and event-driven systems
- Excellent communication and teamwork skills
- Ability to work independently with minimal supervision

Nice to have
- Experience with Terraform, GraphQL or Redis
- Familiarity with machine learning workflows

What we offer
Competitive salary of 28-40 LPA depending on experience, health insurance, learning budget and flexible hours. Other duties as assigned.`
