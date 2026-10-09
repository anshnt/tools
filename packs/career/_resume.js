// Resume data model: defaults, sample, normalization, a heuristic text parser and plain-text export.
// Pure logic (no DOM) so the ATS checker, the builder and tests can share it.

export const uid = () => Math.random().toString(36).slice(2, 9)

export const SECTIONS = [
  { id: 'summary', label: 'Summary', icon: 'text-quote' },
  { id: 'experience', label: 'Experience', icon: 'briefcase' },
  { id: 'education', label: 'Education', icon: 'graduation-cap' },
  { id: 'skills', label: 'Skills', icon: 'wrench' },
  { id: 'projects', label: 'Projects', icon: 'rocket' },
  { id: 'certifications', label: 'Certifications', icon: 'badge-check' },
  { id: 'awards', label: 'Awards', icon: 'trophy' },
  { id: 'languages', label: 'Languages', icon: 'languages' },
  { id: 'links', label: 'Links', icon: 'link' },
]
export const SECTION_IDS = SECTIONS.map((s) => s.id)

export const emptyResume = () => ({
  v: 1,
  sample: false,
  style: { template: 'modern', accent: '#0d9b8a', size: 'm', page: 'a4' },
  contact: { name: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '' },
  summary: '',
  order: [...SECTION_IDS],
  hidden: {},
  experience: [],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
  awards: [],
  languages: [],
  links: [],
})

export const newEntry = (kind) => ({
  experience: () => ({ id: uid(), role: '', company: '', location: '', start: '', end: '', current: false, bullets: [''] }),
  education: () => ({ id: uid(), school: '', degree: '', field: '', location: '', start: '', end: '', grade: '', notes: '' }),
  skills: () => ({ id: uid(), group: '', items: '' }),
  projects: () => ({ id: uid(), name: '', link: '', tech: '', bullets: [''] }),
  certifications: () => ({ id: uid(), name: '', issuer: '', date: '' }),
  awards: () => ({ id: uid(), name: '', issuer: '', date: '' }),
  languages: () => ({ id: uid(), name: '', level: '' }),
  links: () => ({ id: uid(), label: '', url: '' }),
})[kind]()

export function sampleResume() {
  const r = emptyResume()
  r.sample = true
  r.contact = { name: 'Aarav Mehta', title: 'Senior Software Engineer', email: 'aarav.mehta@example.com', phone: '+91 98765 43210', location: 'Bengaluru, India', website: 'aaravmehta.dev', linkedin: 'linkedin.com/in/aaravmehta', github: 'github.com/aaravmehta' }
  r.summary = 'Full-stack engineer with 7+ years building high-traffic web products. Led a team of 6 to cut page load time by 42% and ship a payments platform handling 1.2M monthly transactions. Comfortable across React, Node.js and AWS, and happiest turning messy requirements into clear, reliable software.'
  r.experience = [
    { id: uid(), role: 'Senior Software Engineer', company: 'Northwind Labs', location: 'Bengaluru', start: 'Mar 2021', end: '', current: true, bullets: [
      'Led a team of 6 engineers to rebuild the checkout flow in React and Node.js, increasing conversion by 18%.',
      'Reduced average API latency from 480 ms to 190 ms by introducing Redis caching and query optimization.',
      'Designed an event-driven billing service on AWS (SQS, Lambda) processing 1.2M transactions per month.',
      'Mentored 4 junior developers and introduced code review guidelines that cut production bugs by 30%.'] },
    { id: uid(), role: 'Software Engineer', company: 'Brightpath Systems', location: 'Pune', start: 'Jul 2018', end: 'Feb 2021', current: false, bullets: [
      'Built 12 REST APIs in Express and PostgreSQL used by 3 mobile apps and 200K active users.',
      'Automated deployments with Docker and GitHub Actions, shrinking release time from 2 hours to 15 minutes.',
      'Wrote unit and integration tests (Jest) that raised coverage from 38% to 86%.'] },
  ]
  r.education = [{ id: uid(), school: 'Pune Institute of Technology', degree: 'B.Tech', field: 'Computer Engineering', location: 'Pune', start: '2014', end: '2018', grade: 'CGPA 8.7 / 10', notes: '' }]
  r.skills = [
    { id: uid(), group: 'Languages', items: 'JavaScript, TypeScript, Python, SQL' },
    { id: uid(), group: 'Frameworks', items: 'React, Next.js, Node.js, Express, Django' },
    { id: uid(), group: 'Cloud and tools', items: 'AWS, Docker, Kubernetes, PostgreSQL, Redis, GitHub Actions, Terraform' },
  ]
  r.projects = [{ id: uid(), name: 'OpenInvoice', link: 'github.com/aaravmehta/openinvoice', tech: 'Next.js, Prisma, PostgreSQL', bullets: ['Open-source invoicing app with 1.4K GitHub stars and 30+ contributors.'] }]
  r.certifications = [{ id: uid(), name: 'AWS Certified Solutions Architect - Associate', issuer: 'Amazon Web Services', date: '2022' }]
  r.languages = [{ id: uid(), name: 'English', level: 'Fluent' }, { id: uid(), name: 'Hindi', level: 'Native' }]
  r.hidden = { awards: true, links: true }
  return r
}

/** Make any object safe to use as a resume (fills defaults, repairs arrays, assigns ids). */
export function normalizeResume(input) {
  const base = emptyResume()
  const src = input && typeof input === 'object' ? input : {}
  const str = (v) => (v == null ? '' : String(v))
  const r = { ...base, v: 1, sample: !!src.sample }
  r.style = { ...base.style, ...(src.style && typeof src.style === 'object' ? src.style : {}) }
  r.contact = { ...base.contact }
  for (const k of Object.keys(base.contact)) r.contact[k] = str(src.contact?.[k])
  r.summary = str(src.summary)
  const order = Array.isArray(src.order) ? src.order.filter((id) => SECTION_IDS.includes(id)) : []
  r.order = [...new Set([...order, ...SECTION_IDS])]
  r.hidden = src.hidden && typeof src.hidden === 'object' ? { ...src.hidden } : {}
  const list = (key, fields, extra) => {
    const arr = Array.isArray(src[key]) ? src[key] : []
    r[key] = arr.filter((e) => e && typeof e === 'object').map((e) => {
      const o = { id: str(e.id) || uid() }
      for (const f of fields) o[f] = str(e[f])
      if (extra) extra(o, e)
      return o
    })
  }
  const bullets = (o, e) => { o.bullets = (Array.isArray(e.bullets) ? e.bullets : str(e.bullets).split('\n')).map(str) ; if (!o.bullets.length) o.bullets = [''] }
  list('experience', ['role', 'company', 'location', 'start', 'end'], (o, e) => { bullets(o, e); o.current = !!e.current })
  list('education', ['school', 'degree', 'field', 'location', 'start', 'end', 'grade', 'notes'])
  list('skills', ['group', 'items'])
  list('projects', ['name', 'link', 'tech'], bullets)
  list('certifications', ['name', 'issuer', 'date'])
  list('awards', ['name', 'issuer', 'date'])
  list('languages', ['name', 'level'])
  list('links', ['label', 'url'])
  return r
}

export const hasContent = (r) => !!(r.contact.name || r.summary || r.experience.length || r.education.length || r.skills.length || r.projects.length)

// ---------- helpers shared by exporters ----------
export const fullUrl = (u) => (/^(https?:|mailto:|tel:)/i.test(u) ? u : `https://${u}`)
export const shortUrl = (u) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')
export const periodOf = (e) => {
  const end = e.current ? 'Present' : e.end
  return [e.start, end].filter(Boolean).join(' - ')
}
export function contactItems(c) {
  const out = []
  if (c.email) out.push({ text: c.email, url: `mailto:${c.email}` })
  if (c.phone) out.push({ text: c.phone, url: `tel:${c.phone.replace(/[^\d+]/g, '')}` })
  if (c.location) out.push({ text: c.location })
  if (c.website) out.push({ text: shortUrl(c.website), url: fullUrl(c.website) })
  if (c.linkedin) out.push({ text: shortUrl(c.linkedin), url: fullUrl(c.linkedin) })
  if (c.github) out.push({ text: shortUrl(c.github), url: fullUrl(c.github) })
  return out
}
export const cleanBullets = (b) => (b || []).map((x) => x.trim()).filter(Boolean)
export const skillItems = (s) => s.items.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)

/** Sections in the user's order that are visible and have something to show. */
export function visibleSections(r) {
  const has = {
    summary: !!r.summary.trim(),
    experience: r.experience.some((e) => e.role || e.company),
    education: r.education.some((e) => e.school || e.degree),
    skills: r.skills.some((s) => s.items.trim()),
    projects: r.projects.some((p) => p.name),
    certifications: r.certifications.some((c) => c.name),
    awards: r.awards.some((c) => c.name),
    languages: r.languages.some((l) => l.name),
    links: r.links.some((l) => l.url),
  }
  return r.order.filter((id) => has[id] && !r.hidden[id])
}
export const sectionLabel = (id) => ({ summary: 'Summary', experience: 'Experience', education: 'Education', skills: 'Skills', projects: 'Projects', certifications: 'Certifications', awards: 'Awards', languages: 'Languages', links: 'Links' })[id]

/** Plain text version (used for copy, and for ATS scoring of the saved resume). */
export function resumeToText(r) {
  const L = []
  const c = r.contact
  if (c.name) L.push(c.name)
  if (c.title) L.push(c.title)
  const ci = contactItems(c).map((x) => x.text)
  if (ci.length) L.push(ci.join(' | '))
  for (const id of visibleSections(r)) {
    L.push('', sectionLabel(id).toUpperCase())
    if (id === 'summary') L.push(r.summary.trim())
    if (id === 'experience') for (const e of r.experience.filter((x) => x.role || x.company)) {
      L.push([e.role, e.company, e.location].filter(Boolean).join(' | ') + (periodOf(e) ? `  ${periodOf(e)}` : ''))
      for (const b of cleanBullets(e.bullets)) L.push(`- ${b}`)
    }
    if (id === 'education') for (const e of r.education.filter((x) => x.school || x.degree)) {
      L.push([[e.degree, e.field].filter(Boolean).join(' in '), e.school, e.location].filter(Boolean).join(' | ') + (periodOf(e) ? `  ${periodOf(e)}` : ''))
      if (e.grade) L.push(e.grade)
      if (e.notes) L.push(e.notes)
    }
    if (id === 'skills') for (const s of r.skills.filter((x) => x.items.trim())) L.push(s.group ? `${s.group}: ${skillItems(s).join(', ')}` : skillItems(s).join(', '))
    if (id === 'projects') for (const p of r.projects.filter((x) => x.name)) {
      L.push([p.name, p.tech, p.link].filter(Boolean).join(' | '))
      for (const b of cleanBullets(p.bullets)) L.push(`- ${b}`)
    }
    if (id === 'certifications' || id === 'awards') for (const x of r[id].filter((y) => y.name)) L.push([x.name, x.issuer, x.date].filter(Boolean).join(' | '))
    if (id === 'languages') L.push(r.languages.filter((l) => l.name).map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', '))
    if (id === 'links') for (const l of r.links.filter((x) => x.url)) L.push(`${l.label ? l.label + ': ' : ''}${l.url}`)
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

// ---------- heading detection (also used by the ATS checker) ----------
export const HEADINGS = {
  summary: ['summary', 'professional summary', 'profile', 'professional profile', 'career summary', 'objective', 'career objective', 'about me', 'about', 'executive summary', 'personal statement', 'overview', 'profile summary', 'summary of qualifications'],
  experience: ['experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history', 'career history', 'relevant experience', 'internships', 'internship experience', 'professional background', 'experience summary', 'industry experience', 'work and experience'],
  education: ['education', 'academic background', 'academics', 'educational qualifications', 'education and training', 'academic qualifications', 'educational background', 'academic details', 'education details', 'qualifications'],
  skills: ['skills', 'technical skills', 'key skills', 'core competencies', 'competencies', 'areas of expertise', 'expertise', 'skills and tools', 'tools and technologies', 'technologies', 'technical proficiency', 'skills and abilities', 'core skills', 'technical expertise', 'skills summary', 'professional skills', 'it skills', 'tools'],
  projects: ['projects', 'personal projects', 'academic projects', 'key projects', 'selected projects', 'side projects', 'open source', 'open source contributions', 'project experience', 'notable projects'],
  certifications: ['certifications', 'certificates', 'licenses', 'licenses and certifications', 'courses', 'training', 'professional development', 'certifications and licenses', 'certifications and courses', 'courses and certifications', 'training and certifications'],
  awards: ['awards', 'honors', 'honours', 'achievements', 'accomplishments', 'awards and honors', 'awards and achievements', 'honors and awards', 'recognition', 'publications', 'extracurricular activities', 'extracurriculars', 'leadership'],
  languages: ['languages', 'language skills', 'language proficiency'],
  links: ['links', 'profiles', 'online profiles', 'social', 'websites', 'social links', 'portfolio'],
}
const IGNORED_HEADINGS = ['references', 'interests', 'hobbies', 'volunteer experience', 'volunteering', 'volunteer work', 'declaration', 'personal details', 'personal information', 'additional information', 'activities', 'interests and hobbies']
const HEAD_LOOKUP = new Map(Object.entries(HEADINGS).flatMap(([id, list]) => list.map((t) => [t, id])))

const normHead = (line) => line.replace(/[:\-_=*#|•●▪]+/g, ' ').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim().toLowerCase()
/** 'experience' | ... | 'ignored' | null for a standalone heading line. */
export function detectHeading(line) {
  const t = line.trim()
  if (!t || t.length > 42 || /[.@]/.test(t.replace(/\.$/, ''))) return null
  const n = normHead(t)
  if (n.split(' ').length > 6) return null
  if (HEAD_LOOKUP.has(n)) return HEAD_LOOKUP.get(n)
  if (IGNORED_HEADINGS.includes(n)) return 'ignored'
  return null
}

// ---------- parser ----------
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DATE = `(?:${MONTH}\\.?,?\\s*(?:'|’)?\\d{2,4}|\\d{1,2}\\s*[/.-]\\s*\\d{4}|(?:19|20)\\d{2})`
const PRESENT = '(?:present|current|currently|now|ongoing|till date|to date|today)'
export const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|\u2014|to|until|till|through)\\s*(${DATE}|${PRESENT})`, 'i')
const SINGLE_DATE_RE = new RegExp(`(?:expected\\s*(?:in\\s*)?)?(${DATE})`, 'i')
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d{2,5}[\s.-]?\d{3,5}[\s.-]?\d{0,5}/
const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev|in|co|me|app|ai|tech|xyz|info|edu|gov|uk|us|ca|de|fr|sg|au)(?:\/[^\s|,;()]*)?/gi
export const BULLET_RE = /^\s*(?:[•●▪▫◦‣⁃∙·■□✓→➢❖*+>-]|–|\u2014|\d{1,2}[.)])\s+/
const ROLE_WORDS = /\b(engineer|developer|manager|analyst|designer|intern|lead|director|consultant|specialist|associate|officer|executive|architect|scientist|administrator|assistant|coordinator|head|president|founder|co-founder|owner|programmer|technician|supervisor|representative|strategist|researcher|professor|lecturer|teacher|trainee|accountant|auditor|advisor|adviser|editor|writer|producer|recruiter|agent|clerk|nurse|physician|principal|partner|vp|cto|ceo|cfo|coo|freelancer|contractor|tester|qa|sde|swe)\b/i
const COMPANY_WORDS = /\b(inc|llc|ltd|limited|pvt|private|corp|corporation|company|co\.|technologies|technology|solutions|systems|labs|software|services|group|consulting|consultancy|bank|university|college|institute|school|foundation|studio|studios|industries|enterprises|partners|agency|global|international|holdings|networks|ventures|analytics|infotech|infosys|tcs|wipro|accenture|google|microsoft|amazon|meta|apple|oracle|ibm|deloitte|pwc|kpmg)\b/i
const SCHOOL_WORDS = /\b(university|college|institute|school|academy|polytechnic|iit|nit|iiit|bits|vidyalaya|campus)\b/i
const DEGREE_RE = /\b(b\.?\s?tech|m\.?\s?tech|b\.?\s?e\.?|m\.?\s?e\.?|b\.?\s?sc|m\.?\s?sc|b\.?\s?a\.?|m\.?\s?a\.?|b\.?\s?com|m\.?\s?com|bba|mba|bca|mca|ph\.?\s?d|bachelor(?:'?s)?|master(?:'?s)?|diploma|associate|b\.?\s?s\.?|m\.?\s?s\.?|high school|secondary|senior secondary|hsc|ssc|cbse|icse|12th|10th|doctorate|pgdm|post graduate|undergraduate|graduate)\b/i
const SMALL = new Set(['of', 'and', 'the', 'at', 'for', 'in', 'on', 'to', 'a', 'an', '&', 'de', 'la'])

const stripBullet = (l) => l.replace(BULLET_RE, '').trim()
const isBullet = (l) => BULLET_RE.test(l)
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, a, b) => a + b.toUpperCase())
const capRatio = (s) => {
  const w = s.split(/\s+/).filter((x) => x && !SMALL.has(x.toLowerCase()))
  return w.length ? w.filter((x) => /^[A-Z0-9(]/.test(x)).length / w.length : 0
}
export const VERB_START = /^(built|led|developed|managed|created|designed|implemented|improved|increased|reduced|worked|responsible|launched|delivered|collaborated|analyzed|analysed|maintained|achieved|established|drove|owned|automated|migrated|wrote|supported|ran|coordinated|conducted|handled|assisted|helped|organized|organised|trained|mentored|spearheaded|optimized|optimised|streamlined|executed|oversaw|negotiated|generated|utilized|performed|participated|integrated|resolved|identified|prepared|processed|monitored|tested|deployed|configured|published|presented|served|secured|won|earned|completed)\b/i
export const looksLikeHeaderLine = (l) => l.length <= 70 && !/[.;:]$/.test(l) && capRatio(l) >= 0.6 && !isBullet(l) && !VERB_START.test(l) && (l.split(/\s+/).length <= 5 || ROLE_WORDS.test(l) || COMPANY_WORDS.test(l))
const LOCATION_RE = /^[A-Z][A-Za-z.'\- ]+,\s*[A-Z][A-Za-z.'\- ]+(?:,\s*[A-Z][A-Za-z.'\- ]+)?$/

function splitTokens(s) {
  return s.split(/\s*[|•·●]\s*|\s+[–\u2014-]\s+|\s+at\s+|\s+@\s+/).map((t) => t.replace(/^[,;:\s()–\u2014-]+|[,;:\s()–\u2014-]+$/g, '')).filter(Boolean)
}

function headerFields(tokens) {
  const out = { role: '', company: '', location: '' }
  const rest = []
  const queue = [...tokens]
  let afterRole = false
  while (queue.length) {
    let t = queue.shift()
    const comma = t.indexOf(',')
    if (comma > 0 && ROLE_WORDS.test(t.slice(0, comma)) && !ROLE_WORDS.test(t.slice(comma + 1))) { queue.unshift(t.slice(comma + 1).trim()); t = t.slice(0, comma).trim(); afterRole = true }
    else if (afterRole && comma > 0 && !COMPANY_WORDS.test(t.slice(comma + 1)) && !out.company) {
      // "Role, Company, City": the piece after the role is the company, the rest is the place
      afterRole = false
      if (!out.location) out.location = t.slice(comma + 1).trim()
      t = t.slice(0, comma).trim()
      rest.push(t)
      continue
    }
    const m = t.match(/^(.*?),\s*((?:remote|hybrid|on-?site)|[A-Z][\w.'\- ]+(?:,\s*[A-Z][\w.'\- ]+)?)$/)
    if (m && COMPANY_WORDS.test(m[1]) && !out.location) { out.location = m[2]; t = m[1] }
    else if (!ROLE_WORDS.test(t) && !COMPANY_WORDS.test(t) && (LOCATION_RE.test(t) || /^(remote|hybrid|on-?site)$/i.test(t)) && !out.location) { out.location = t; continue }
    rest.push(t)
  }
  const pick = (re) => { const i = rest.findIndex((t) => re.test(t)); return i >= 0 ? rest.splice(i, 1)[0] : '' }
  out.role = pick(ROLE_WORDS)
  out.company = pick(COMPANY_WORDS)
  // nothing recognisable: first piece is the role, second the company
  for (const t of rest) {
    if (!out.role && !out.company) out.role = t
    else if (!out.company) out.company = t
    else if (!out.role) out.role = t
  }
  return out
}

export function parseDateRange(line) {
  const m = line.match(RANGE_RE)
  if (!m) return null
  const end = m[2]
  const current = new RegExp(`^${PRESENT}$`, 'i').test(end.trim())
  return { start: m[1].trim(), end: current ? '' : end.trim(), current, rest: line.replace(m[0], ' ').replace(/[(\[]\s*[)\]]/g, ' ').replace(/\s{2,}/g, ' ').trim() }
}

function parseExperience(lines) {
  const entries = []
  const items = lines.map((raw) => ({ raw: raw.trim(), bullet: isBullet(raw), blank: !raw.trim() }))
  for (const it of items) {
    it.text = it.bullet ? stripBullet(it.raw) : it.raw
    it.range = !it.bullet && !it.blank && it.raw.length <= 140 ? parseDateRange(it.raw) : null
  }
  const anchors = items.map((it, i) => (it.range ? i : -1)).filter((i) => i >= 0)
  if (!anchors.length) {
    // no dates: treat bulleted lines as one entry
    const bullets = items.filter((it) => !it.blank).map((it) => it.text)
    return bullets.length ? [{ ...newEntry('experience'), bullets }] : []
  }
  const claimed = new Set()
  for (const a of anchors) {
    const pre = []
    for (let i = a - 1, n = 0; i >= 0 && n < 2; i--) {
      if (items[i].blank) { if (pre.length) break; continue }
      if (items[i].bullet || items[i].range || claimed.has(i) || !looksLikeHeaderLine(items[i].raw)) break
      pre.unshift(i); n++
    }
    const post = []
    for (let i = a + 1; i < items.length && post.length < 2; i++) {
      if (items[i].blank) { if (post.length) break; continue }
      if (items[i].bullet || items[i].range || !looksLikeHeaderLine(items[i].raw)) break
      post.push(i)
    }
    const r = items[a].range
    const tokens = [...pre.map((i) => items[i].raw), r.rest, ...post.map((i) => items[i].raw)].flatMap(splitTokens)
    // only accept trailing lines as header when the first line left role or company missing
    const f = headerFields(tokens, 'e')
    ;[...pre, ...post].forEach((i) => claimed.add(i))
    claimed.add(a)
    entries.push({ anchor: a, pre: pre[0] ?? a, e: { ...newEntry('experience'), role: f.role, company: f.company, location: f.location, start: r.start, end: r.end, current: r.current, bullets: [] } })
  }
  entries.forEach((en, k) => {
    const from = Math.max(en.anchor + 1, 0)
    const to = k + 1 < entries.length ? entries[k + 1].pre : items.length
    for (let i = from; i < to; i++) {
      if (claimed.has(i) || items[i].blank) continue
      const it = items[i]
      const last = en.e.bullets.length - 1
      if (it.bullet) en.e.bullets.push(it.text)
      else if (last >= 0 && !/[.!?;:]$/.test(en.e.bullets[last]) && /^[a-z0-9(]/.test(it.text)) en.e.bullets[last] += ` ${it.text}`
      else en.e.bullets.push(it.text)
    }
    if (!en.e.bullets.length) en.e.bullets = ['']
  })
  return entries.map((x) => x.e)
}

function parseEducation(lines) {
  const entries = []
  let cur = null
  const flush = () => { if (cur && (cur.school || cur.degree)) entries.push(cur); cur = null }
  const fresh = () => newEntry('education')
  for (const raw of lines) {
    let line = raw.trim()
    if (!line) continue
    const bullet = isBullet(line)
    if (bullet) line = stripBullet(line)
    const hasSchool = SCHOOL_WORDS.test(line) || COMPANY_WORDS.test(line) && !DEGREE_RE.test(line) && line.length < 80
    const hasDegree = DEGREE_RE.test(line) && line.length < 120
    if (!bullet && (hasSchool || hasDegree)) {
      if (cur && ((hasSchool && cur.school && !hasDegree) || (hasDegree && cur.degree && (cur.school || !hasSchool)) || (hasSchool && hasDegree && cur.school))) flush()
      cur ??= fresh()
      const range = parseDateRange(line)
      let rest = line
      if (range) { cur.start ||= range.start; cur.end ||= range.end || (range.current ? 'Present' : ''); rest = range.rest }
      else {
        const y = rest.match(/\b(?:expected\s*(?:in\s*)?)?((?:19|20)\d{2})\b/i)
        if (y) { cur.end ||= y[0].replace(/\s+/g, ' ').trim(); rest = rest.replace(y[0], ' ') }
      }
      const g = rest.match(/\b(?:cgpa|gpa|grade|percentage|score|aggregate)\s*[:\-]?\s*([\d.]+\s*(?:\/\s*[\d.]+|%)?)/i) || rest.match(/\b(\d\.\d{1,2}\s*\/\s*(?:10|4(?:\.0)?))\b/) || rest.match(/\b(\d{2}(?:\.\d+)?\s*%)/)
      if (g) { cur.grade ||= g[0].trim(); rest = rest.replace(g[0], ' ') }
      const tokens = splitTokens(rest.replace(/\s{2,}/g, ' '))
      for (const t of tokens) {
        if (DEGREE_RE.test(t) && !SCHOOL_WORDS.test(t) && !cur.degree) {
          const m = t.match(/^(.*?)(?:\s+in\s+|\s*\(|,\s*)(.+?)\)?$/i)
          if (m && DEGREE_RE.test(m[1])) { cur.degree = m[1].trim(); cur.field ||= m[2].trim() } else cur.degree = t
        } else if ((SCHOOL_WORDS.test(t) || COMPANY_WORDS.test(t)) && !cur.school) {
          const m = /^(?:university|college|institute) of\b/i.test(t) ? null : t.match(/^(.*?),\s*([A-Z][\w.'\- ]+(?:,\s*[A-Z][\w.'\- ]+)?)$/)
          if (m && !cur.location) { cur.school = m[1]; cur.location = m[2] } else cur.school = t
        } else if (!cur.school && !DEGREE_RE.test(t)) cur.school = t
        else if (!cur.location && LOCATION_RE.test(t)) cur.location = t
        else if (!cur.field && cur.degree) cur.field = t
        else cur.notes = [cur.notes, t].filter(Boolean).join('; ')
      }
    } else if (cur) {
      const range = parseDateRange(line)
      const g = line.match(/\b(?:cgpa|gpa|grade|percentage|score)\s*[:\-]?\s*([\d.]+\s*(?:\/\s*[\d.]+|%)?)/i)
      if (range && !cur.start) { cur.start = range.start; cur.end = range.end || 'Present' }
      else if (g && !cur.grade) cur.grade = g[0].trim()
      else cur.notes = [cur.notes, line].filter(Boolean).join('; ')
    } else {
      cur = fresh()
      cur.school = line
    }
  }
  flush()
  return entries
}

function parseSkills(lines) {
  const groups = []
  const loose = []
  for (const raw of lines) {
    const line = stripBullet(raw.trim())
    if (!line) continue
    const m = line.match(/^([A-Za-z][A-Za-z &/+.\-]{1,34}?)\s*[:–\u2014-]\s+(.+)$/) || line.match(/^([A-Za-z][A-Za-z &/+]{1,34}):(.+)$/)
    if (m && m[2].split(/[,;|]/).length >= 1 && m[1].split(' ').length <= 5) groups.push({ ...newEntry('skills'), group: m[1].trim(), items: m[2].split(/[,;|•·]/).map((x) => x.trim()).filter(Boolean).join(', ') })
    else loose.push(...line.split(/[,;|•·\t]/).map((x) => x.trim()).filter(Boolean))
  }
  if (loose.length) groups.push({ ...newEntry('skills'), group: groups.length ? 'Other' : '', items: loose.join(', ') })
  return groups
}

function parseProjects(lines) {
  const out = []
  let cur = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (isBullet(line)) { (cur ??= { ...newEntry('projects'), name: 'Project', bullets: [] }).bullets.push(stripBullet(line)); continue }
    const isName = line.length <= 90 && !/[.!?]$/.test(line) && (!cur || cur.bullets.length > 0 || cur.bullets.length === 0 && false)
    if (isName || !cur) {
      if (cur) out.push(cur)
      const url = line.match(URL_RE)?.[0] || ''
      const text = line.replace(URL_RE, ' ').replace(/[()]/g, ' ')
      const [name, ...rest] = text.split(/\s*[|–\u2014:]\s*|\s+-\s+/).map((x) => x.trim()).filter(Boolean)
      cur = { ...newEntry('projects'), name: name || line, link: url, tech: rest.join(', '), bullets: [] }
    } else cur.bullets.push(line)
  }
  if (cur) out.push(cur)
  return out.map((p) => ({ ...p, bullets: p.bullets.length ? p.bullets : [''] }))
}

const ISSUERS = /\b(coursera|udemy|aws|amazon|google|microsoft|oracle|cisco|pmi|nptel|edx|udacity|linkedin|hackerrank|meta|ibm|salesforce|comptia|red hat|scrum|axelos|isaca|cfa|nasscom|infosys|tcs|stanford|harvard|mit|deeplearning\.ai|datacamp|simplilearn|great learning|upgrad)\b/i
function parseCertLines(lines) {
  return lines.map((l) => stripBullet(l.trim())).filter(Boolean).map((line) => {
    const e = { ...newEntry('certifications') }
    const dm = line.match(SINGLE_DATE_RE)
    if (dm) { e.date = dm[1]; line = line.replace(dm[0], ' ') }
    const toks = splitTokens(line.replace(/[()]/g, ' | ').replace(/\s{2,}/g, ' ').replace(/\s*,\s*$/, ''))
    const iss = toks.findIndex((t) => ISSUERS.test(t))
    if (iss > 0) e.issuer = toks.splice(iss, 1)[0]
    e.name = toks.shift() || line.trim()
    if (!e.issuer && toks.length) e.issuer = toks.join(', ')
    return e
  })
}

function parseLanguages(lines) {
  const items = lines.flatMap((l) => stripBullet(l.trim()).split(/[,;|•·]/)).map((x) => x.trim()).filter(Boolean)
  return items.map((t) => {
    const m = t.match(/^([A-Za-z][A-Za-z ]{1,24}?)\s*(?:\(([^)]+)\)|[:\-–\u2014]\s*(.+))$/)
    return { ...newEntry('languages'), name: (m ? m[1] : t).trim(), level: (m ? m[2] || m[3] : '').trim() }
  })
}

function parseLinks(lines) {
  const out = []
  for (const l of lines) {
    const urls = l.match(URL_RE) || []
    for (const u of urls) {
      const label = /linkedin/i.test(u) ? 'LinkedIn' : /github/i.test(u) ? 'GitHub' : /medium|dev\.to|substack/i.test(u) ? 'Blog' : /behance|dribbble/i.test(u) ? 'Portfolio' : l.replace(u, '').replace(/[:|\-–]/g, ' ').trim().slice(0, 30) || 'Website'
      out.push({ ...newEntry('links'), label, url: u })
    }
  }
  return out
}

/** Heuristic parse of pasted or extracted resume text. Returns {data, report}. */
export function parseResumeText(text) {
  const r = emptyResume()
  const lines = String(text || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n').map((l) => l.replace(/\s+$/g, ''))
  const report = { found: {}, skipped: [], warnings: [] }
  // split into blocks by headings
  const blocks = []
  let cur = { id: 'header', lines: [] }
  for (const line of lines) {
    const id = detectHeading(line)
    if (id) { blocks.push(cur); cur = { id, label: line.trim(), lines: [] } } else cur.lines.push(line)
  }
  blocks.push(cur)

  // header: name, title, contact
  const head = blocks.find((b) => b.id === 'header')
  const headLines = head.lines.map((l) => l.trim()).filter(Boolean)
  const c = r.contact
  const used = new Set()
  const allHead = headLines.join(' | ')
  c.email = allHead.match(EMAIL_RE)?.[0] || ''
  const urls = (allHead.replace(EMAIL_RE, ' ').match(URL_RE) || [])
  for (const u of urls) {
    if (/linkedin\./i.test(u)) c.linkedin ||= u
    else if (/github\./i.test(u)) c.github ||= u
    else c.website ||= u
  }
  const noUrl = allHead.replace(EMAIL_RE, ' ').replace(URL_RE, ' ')
  const pm = noUrl.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,5}/g)?.map((p) => p.trim()).filter((p) => p.replace(/\D/g, '').length >= 8 && p.replace(/\D/g, '').length <= 15)
  if (pm?.length) c.phone = pm[0]
  headLines.forEach((l, i) => {
    const t = l.replace(EMAIL_RE, ' ').replace(URL_RE, ' ').replace(c.phone || '\u0000', ' ').replace(/[|•·●,;]+/g, ' ').replace(/\b(email|e-mail|phone|mobile|tel|linkedin|github|website|portfolio|contact|address|location)\s*:?/gi, ' ').trim()
    if (!c.name && i < 4 && t && t.split(/\s+/).length >= 1 && t.split(/\s+/).length <= 5 && /^[\p{L}][\p{L} .'\-]+$/u.test(t) && !ROLE_WORDS.test(t)) {
      c.name = t === t.toUpperCase() ? titleCase(t) : t
      used.add(i)
    }
  })
  if (!c.name && headLines[0]) { c.name = titleCase(headLines[0].replace(EMAIL_RE, '').replace(URL_RE, '').replace(/[|•].*$/, '').trim()); used.add(0) }
  headLines.forEach((l, i) => {
    if (used.has(i)) return
    const stripped = l.replace(EMAIL_RE, ' ').replace(URL_RE, ' ').replace(c.phone || '\u0000', ' ').replace(/[|•·●;]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
    if (!stripped) return
    if (!c.title && stripped.length <= 80 && !/\d{3,}/.test(stripped) && (ROLE_WORDS.test(stripped) || i <= 2) && !LOCATION_RE.test(stripped)) { c.title = stripped; return }
    if (!c.location) {
      const m = stripped.match(/([A-Z][A-Za-z.'\- ]+,\s*[A-Z][A-Za-z.'\- ]+(?:,\s*[A-Z][A-Za-z.'\- ]+)?)/)
      if (m) c.location = m[1].trim()
    }
  })
  if (!c.title) { /* leave blank */ }

  const body = (id) => blocks.filter((b) => b.id === id).flatMap((b) => b.lines)
  const sum = body('summary').map((l) => l.trim()).filter(Boolean).join(' ')
  if (sum) r.summary = stripBullet(sum)
  r.experience = parseExperience(body('experience'))
  r.education = parseEducation(body('education'))
  r.skills = parseSkills(body('skills'))
  r.projects = parseProjects(body('projects'))
  r.certifications = parseCertLines(body('certifications'))
  r.awards = parseCertLines(body('awards'))
  r.languages = parseLanguages(body('languages'))
  r.links = parseLinks(body('links'))
  for (const b of blocks) if (b.id === 'ignored' && b.lines.some((l) => l.trim())) report.skipped.push(b.label)
  // put links from the header into links list if there is none
  report.found = {
    contact: [c.name, c.email, c.phone, c.location, c.linkedin, c.github, c.website].filter(Boolean).length,
    summary: r.summary ? 1 : 0,
    experience: r.experience.length, education: r.education.length,
    skills: r.skills.reduce((n, s) => n + skillItems(s).length, 0),
    projects: r.projects.length, certifications: r.certifications.length, awards: r.awards.length, languages: r.languages.length, links: r.links.length,
  }
  if (!c.name) report.warnings.push('Could not find your name. Add it in Contact.')
  if (!c.email) report.warnings.push('No email address found.')
  if (!blocks.some((b) => b.id === 'experience')) report.warnings.push('No "Experience" heading found, so jobs were not detected. Add a heading line like "Experience".')
  if (r.experience.some((e) => !e.role || !e.company)) report.warnings.push('Some jobs are missing a title or company. Please review the Experience cards.')
  r.hidden = {}
  for (const id of ['awards', 'languages', 'links', 'projects', 'certifications']) if (!r[id].length) r.hidden[id] = false
  return { data: r, report }
}

/** JSON schema for AI parsing (structured output). */
const S = { type: 'string' }
const arr = (props) => ({ type: 'array', items: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false } })
export const RESUME_SCHEMA = {
  type: 'object',
  properties: {
    contact: { type: 'object', properties: { name: S, title: S, email: S, phone: S, location: S, website: S, linkedin: S, github: S }, required: ['name', 'title', 'email', 'phone', 'location', 'website', 'linkedin', 'github'], additionalProperties: false },
    summary: S,
    experience: arr({ role: S, company: S, location: S, start: S, end: S, current: { type: 'boolean' }, bullets: { type: 'array', items: S } }),
    education: arr({ school: S, degree: S, field: S, location: S, start: S, end: S, grade: S, notes: S }),
    skills: arr({ group: S, items: S }),
    projects: arr({ name: S, link: S, tech: S, bullets: { type: 'array', items: S } }),
    certifications: arr({ name: S, issuer: S, date: S }),
    awards: arr({ name: S, issuer: S, date: S }),
    languages: arr({ name: S, level: S }),
    links: arr({ label: S, url: S }),
  },
  required: ['contact', 'summary', 'experience', 'education', 'skills', 'projects', 'certifications', 'awards', 'languages', 'links'],
  additionalProperties: false,
}
export const RESUME_AI_SYSTEM = 'You convert raw resume text into structured JSON. Copy facts exactly as written; never invent employers, dates, numbers or skills. Keep bullets as separate array items without bullet symbols. Use empty strings for fields that are not present. Dates stay as written (e.g. "Jan 2020"). For a current job set current to true and leave end empty. Group skills by their label when the resume has one, otherwise use one group with an empty label.'
