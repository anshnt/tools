// Cover letter generator: template-driven prose from a few fields (four tones, three lengths, rotating phrasing), editable output,
// copy / Word / PDF / text download, and optional tailoring with Claude using the job description and your resume.
import { h, icon, button, busy, toast, alert, textarea, segmented, field, clear, copyText, debounce, download } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { safeName } from '../../lib/files.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, fi, getProfile, setProfile, today, firstName, burst, saveAs, saveIndicator } from './_kit.js'
import { blocksToDocx, blocksToPdf } from './_doc.js'
import { normalizeResume, resumeToText, hasContent, cleanBullets, skillItems } from './_resume.js'
import { yearsOfExperience } from './_ats.js'

const KEY = 'cover:fields'
const aOrAn = (s) => (/^(?:[aeiou]|hour|honest|heir)/i.test(s.trim()) ? 'an' : 'a')
const sentence = (s) => { const t = (s || '').trim().replace(/\s+/g, ' ').replace(/[.;,\s]+$/, ''); return t ? t[0].toUpperCase() + t.slice(1) + '.' : '' }
const lcFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const list = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`)
const splitLines = (t) => (t || '').split('\n').map((x) => x.replace(/^[\s\-•*]+/, '').trim()).filter(Boolean)

/** Compose the letter text. Pure: same fields and variant give the same letter. */
export function composeLetter(f, { tone = 'professional', length = 'standard', variant = 0, header = true } = {}) {
  const role = f.role?.trim() || '[job title]'
  const company = f.company?.trim() || '[company]'
  const skills = (f.skills || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 6)
  const highlights = splitLines(f.highlights)
  const yn = parseFloat(String(f.years || '').replace(',', '.'))
  const years = yn > 0 ? `${yn} year${yn === 1 ? '' : 's'}` : String(f.years || '').trim()
  const cur = f.currentRole?.trim()
  const aRole = cur ? `${aOrAn(cur)} ${cur}` : 'an experienced professional'
  const src = (f.source || '').trim()
  const via = !src ? '' : /^(?:on|at|via|through|from|in)\b/i.test(src) ? src : /referr|recommend|friend|colleague|contact|mentor/i.test(src) ? `through ${/^(?:a|an|the|my)\b/i.test(src) ? src : `a ${src}`}` : `on ${src}`
  const found = via ? ` that I found ${via}` : ''
  const skillsLine = skills.length ? list(skills.slice(0, 4)) : ''
  const v = variant

  const first = firstName(f.manager)
  const greeting = f.manager?.trim()
    ? (tone === 'friendly' || tone === 'enthusiastic' ? `Hi ${first},` : `Dear ${f.manager.trim()},`)
    : (tone === 'friendly' ? `Hello ${company} team,` : 'Dear Hiring Manager,')

  const yrPhrase = years ? `${years} of experience` : 'hands-on experience'
  const OPEN = {
    professional: [
      `I am writing to apply for the ${role} position at ${company}${found}. As ${aRole} with ${yrPhrase}${skillsLine ? ` in ${skillsLine}` : ''}, I am confident I can make a meaningful contribution to your team.`,
      `Please accept this letter as my application for the ${role} role at ${company}${found}. With ${yrPhrase} as ${aRole}${skillsLine ? ` and a strong grounding in ${skillsLine}` : ''}, my background lines up closely with what this position requires.`,
      `I was pleased to see the ${role} opening at ${company}${found}. My work as ${aRole}${years ? `, backed by ${years} of experience` : ''}${skillsLine ? ` with ${skillsLine}` : ''}, makes me a strong candidate.`,
    ],
    friendly: [
      `I'm excited to apply for the ${role} role at ${company}${found}. I'm ${aRole} with ${yrPhrase}${skillsLine ? `, and I really enjoy working with ${skillsLine}` : ''}.`,
      `Thanks for taking a moment to read my application for the ${role} role at ${company}${found}. I'm ${aRole}${years ? ` with ${years} under my belt` : ''}${skillsLine ? ` and I love building things with ${skillsLine}` : ''}.`,
      `The ${role} role at ${company}${found} caught my eye right away. I'm ${aRole}${years ? ` with ${years} of experience` : ''}${skillsLine ? ` in ${skillsLine}` : ''}, and I think we could do great work together.`,
    ],
    confident: [
      `${company} is hiring a ${role}${via ? ` (I found the role ${via})` : ''}, and I can deliver results from the first week. As ${aRole} with ${yrPhrase}${skillsLine ? ` across ${skillsLine}` : ''}, I have done this work before and done it well.`,
      `I am applying for the ${role} role at ${company}${found} because I know I can move the needle there. As ${aRole}${years ? ` with ${years} of results` : ''}${skillsLine ? `, I bring proven strength in ${skillsLine}` : ', I bring a proven record'}. I will contribute from day one.`,
      `You need a ${role} who can hit the ground running. That is exactly what I offer: ${yrPhrase} as ${aRole}${skillsLine ? `, deep experience with ${skillsLine}` : ''}, and a habit of finishing what I start.`,
    ],
    enthusiastic: [
      `I was thrilled to see the ${role} opening at ${company}${found}, and I would love to be considered. I'm ${aRole} with ${yrPhrase}${skillsLine ? ` and a real passion for ${skillsLine}` : ''}.`,
      `The ${role} role at ${company}${found} is exactly the kind of opportunity I have been hoping for, so I am delighted to apply. As ${aRole}${years ? ` with ${years} of experience` : ''}${skillsLine ? ` in ${skillsLine}` : ''}, I would be energized to join your team.`,
      `${company}'s ${role} position${found ? ` ${found.replace(/^ that I /, 'which I ')}` : ''} feels like a perfect match for my background and my ambitions. I'm ${aRole} with ${yrPhrase}${skillsLine ? ` who is genuinely excited by ${skillsLine}` : ''}.`,
    ],
  }[tone]
  const opening = OPEN[v % OPEN.length]

  const HL_INTRO = {
    professional: ['In my recent work, I have:', 'Some of my most relevant achievements include:', 'Highlights of my track record:'],
    friendly: ['Here are a few things I\'m proud of:', 'A few highlights from my recent work:', 'Some things I\'ve been lucky to work on:'],
    confident: ['The results speak for themselves:', 'What I have delivered:', 'My track record:'],
    enthusiastic: ['A few things I am really proud of:', 'Some highlights I would love to bring to your team:', 'Here is some of what I have been up to:'],
  }[tone][v % 3]
  let body2 = ''
  if (highlights.length) {
    const hs = (length === 'short' ? highlights.slice(0, 2) : highlights.slice(0, 5)).map((x) => `• ${sentence(x)}`)
    body2 = `${HL_INTRO}\n${hs.join('\n')}`
  } else body2 = `[Add two or three achievements with numbers, for example: Reduced onboarding time by 40 percent by redesigning the checkout flow.]`
  if (length === 'detailed' && skills.length > 4) body2 += `\n\nMy toolkit also includes ${list(skills.slice(4))}, which I use to turn ideas into reliable, shipped work.`

  const WHY = {
    professional: [(w) => `What draws me to ${company} is ${w}. I would welcome the chance to bring the same discipline and care to your ${role} team.`, (w) => `I am particularly interested in ${company} for ${w}. I believe my background would help the team move faster on the work that matters.`, (w) => `${company} stands out to me for ${w}, and I would be glad to contribute to that.`],
    friendly: [(w) => `What I like most about ${company} is ${w}. I'd love to be part of that.`, (w) => `What really appeals to me about ${company} is ${w}. It feels like a place where I could do my best work.`, (w) => `${company} stands out to me for ${w}. I'd be happy to help take it further.`],
    confident: [(w) => `I chose ${company} deliberately, for ${w}. That is the environment where I do my strongest work.`, (w) => `${company} is a clear fit for me, given ${w}. I can add value quickly.`, (w) => `I am targeting ${company} for ${w}, and I will bring that same standard to the ${role} role.`],
    enthusiastic: [(w) => `I am so drawn to ${company} for ${w}. Being part of that would be a dream.`, (w) => `Everything I have read about ${company} excites me, especially ${w}. I would be thrilled to contribute.`, (w) => `${company} inspires me with ${w}, and I can't wait to help build what comes next.`],
  }[tone]
  const whyText = f.why?.trim() ? WHY[v % 3](lcFirst(f.why.trim().replace(/[.\s]+$/, '').replace(/^because\s+/i, ''))) : `I admire the work ${company} is doing, and I would welcome the chance to contribute to it as your ${role}.`

  const avail = f.availability?.trim() ? ` ${sentence(f.availability)}` : ''
  const CLOSE = {
    professional: [`Thank you for your time and consideration. I would welcome the opportunity to discuss how my experience can support ${company}.${avail}`, `I appreciate your consideration and would be glad to discuss my application in more detail.${avail}`, `Thank you for reviewing my application. I look forward to the possibility of speaking with you.${avail}`],
    friendly: [`Thanks so much for reading this. I'd really enjoy chatting about how I can help ${company}.${avail}`, `Thank you for your time! I'd be glad to talk through my experience whenever suits you.${avail}`, `I'd love to hear more about the team and share how I can help. Thanks for considering me!${avail}`],
    confident: [`I would like to discuss how I can deliver for ${company}. I am available to talk at your earliest convenience.${avail}`, `Let us talk about what I can accomplish in the first 90 days. I am ready when you are.${avail}`, `I look forward to showing you what I can do for ${company}.${avail}`],
    enthusiastic: [`Thank you for considering my application. I would be delighted to talk about how I can help ${company}!${avail}`, `I'd be thrilled to discuss the role with you. Thank you so much for your time!${avail}`, `Thank you for this opportunity. I can't wait to hear what you think!${avail}`],
  }[tone][v % 3]
  const signoff = { professional: 'Sincerely,', friendly: 'Warm regards,', confident: 'Best regards,', enthusiastic: 'With enthusiasm,' }[tone]
  const name = f.name?.trim() || '[Your name]'

  const parts = []
  if (header) {
    parts.push([name, [f.email, f.phone, f.city].filter((x) => x?.trim()).join(' | ')].filter(Boolean).join('\n'))
    parts.push(today())
    parts.push([f.manager?.trim(), `${company === '[company]' ? '[Company]' : company}`].filter(Boolean).join('\n'))
  }
  parts.push(greeting, opening, body2)
  if (length !== 'short') parts.push(whyText)
  else if (f.why?.trim()) parts.push(WHY[v % 3](lcFirst(f.why.trim().replace(/[.\s]+$/, ''))))
  parts.push(CLOSE, `${signoff}\n${name}`)
  return parts.join('\n\n')
}

/** Letter text -> document blocks (header, paragraphs, bullet lists). */
export function letterBlocks(text, { header = true } = {}) {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const out = []
  paras.forEach((p, i) => {
    const lines = p.split('\n')
    if (header && i === 0 && lines.length <= 3) { out.push({ t: 'name', text: lines[0] }); lines.slice(1).forEach((l) => out.push({ t: 'meta', text: l })); out.push({ t: 'rule' }); return }
    const bullets = lines.filter((l) => /^•\s/.test(l))
    if (bullets.length) {
      lines.filter((l) => !/^•\s/.test(l)).forEach((l) => out.push({ t: 'p', text: l }))
      bullets.forEach((l) => out.push({ t: 'li', text: l.replace(/^•\s*/, '') }))
      out.push({ t: 'space', h: 8 })
    } else out.push({ t: 'p', text: p })
  })
  return out
}

export async function mount(root, { signal }) {
  const prof = getProfile()
  const f = { name: prof.name, email: prof.email, phone: prof.phone, city: prof.location, role: '', company: '', manager: '', source: '', currentRole: prof.title, years: '', skills: '', highlights: '', why: '', availability: '', ...load(KEY, {}) }
  for (const k of ['name', 'email', 'phone', 'city', 'currentRole']) if (!f[k]) f[k] = { name: prof.name, email: prof.email, phone: prof.phone, city: prof.location, currentRole: prof.title }[k]
  const opt = { tone: f.tone || 'professional', length: f.length || 'standard', variant: f.variant || 0, header: f.header !== false, look: f.look || 'classic' }
  let edited = false
  const out = textarea({ rows: 24, 'aria-label': 'Your cover letter' })
  out.classList.add('cr-letter')
  const editedNote = h('div')
  const saved = saveIndicator('Fields saved on this device')
  const persist = debounce(() => { save(KEY, { ...f, ...opt }); setProfile({ name: f.name, email: f.email, phone: f.phone, location: f.city }); saved.saved() }, 400)
  const stats = h('span', { class: 'small muted' })

  const gen = () => { if (edited) return; out.value = composeLetter(f, opt); upStats() }
  const upStats = () => { const w = (out.value.match(/\S+/g) || []).length; stats.textContent = `${w} words, about ${Math.max(1, Math.round(w / 230))} min read` }
  const onField = () => { saved.dirty(); persist(); gen() }
  out.addEventListener('input', () => { edited = true; upStats(); clear(editedNote, alert('info', 'You edited the letter, so the fields will not overwrite it. ', h('button', { type: 'button', class: 'link', style: 'background:none;border:0;padding:0;font:inherit;cursor:pointer', onclick: () => { edited = false; clear(editedNote); gen() } }, 'Regenerate from the fields'), '.')) })
  const regen = () => { edited = false; clear(editedNote); gen() }

  const fromResume = () => {
    let r
    try { r = normalizeResume(load('resume:data', null)) } catch { return toast('No saved resume found. Build one first.', 'error') }
    if (!hasContent(r)) return toast('No saved resume found. Build one in the Resume builder first.', 'error')
    const job = r.experience[0]
    f.name ||= r.contact.name; f.email ||= r.contact.email; f.phone ||= r.contact.phone; f.city ||= r.contact.location
    f.currentRole = job?.role || r.contact.title || f.currentRole
    const yrs = yearsOfExperience(r.experience.map((e) => `${e.start} - ${e.current ? 'Present' : e.end}`).join('\n'))
    if (yrs) f.years = String(Math.max(1, Math.round(yrs)))
    f.skills = r.skills.flatMap((s) => skillItems(s)).slice(0, 8).join(', ')
    const bl = r.experience.flatMap((e) => cleanBullets(e.bullets))
    f.highlights = [...bl.filter((b) => /\d/.test(b)), ...bl].filter((b, i, a) => a.indexOf(b) === i).slice(0, 3).join('\n')
    drawForm()
    regen()
    persist()
    toast('Filled from your resume. Review each field.', 'success')
  }

  let formHost = h('div')
  function drawForm() {
    clear(formHost, h('div', { class: 'stack' },
      h('div', { class: 'row' }, button('Fill from my resume', { icon: 'file-user', variant: 'secondary', size: 'sm', onClick: fromResume }), h('span', { class: 'small muted' }, 'Uses the Resume builder data on this device.')),
      card('You', 'user-round', h('div', { class: 'stack tight' },
        h('div', { class: 'grid-2' }, fi(f, 'name', 'Your name', { ph: 'Aarav Mehta', ac: 'name' }, onField), fi(f, 'email', 'Email', { ph: 'you@example.com', type: 'email', ac: 'email' }, onField)),
        h('div', { class: 'grid-2' }, fi(f, 'phone', 'Phone', { ph: '+91 98765 43210', ac: 'tel' }, onField), fi(f, 'city', 'City', { ph: 'Bengaluru' }, onField)),
        h('div', { class: 'grid-2' }, fi(f, 'currentRole', 'Current or last role', { ph: 'Senior Software Engineer' }, onField), fi(f, 'years', 'Years of experience', { ph: '7', mode: 'numeric' }, onField)),
        fi(f, 'skills', 'Top skills (comma separated)', { ph: 'React, Node.js, AWS, team leadership' }, onField))),
      card('The job', 'briefcase', h('div', { class: 'stack tight' },
        h('div', { class: 'grid-2' }, fi(f, 'role', 'Job title', { ph: 'Staff Engineer' }, onField), fi(f, 'company', 'Company', { ph: 'Northwind Labs' }, onField)),
        h('div', { class: 'grid-2' }, fi(f, 'manager', 'Hiring manager (optional)', { ph: 'Priya Sharma' }, onField), fi(f, 'source', 'Where you found it', { ph: 'LinkedIn, or a referral from Sam' }, onField)))),
      card('Your pitch', 'sparkles', h('div', { class: 'stack tight' },
        fi(f, 'highlights', 'Achievements (one per line, with numbers)', { area: true, rows: 4, ph: 'Cut page load time by 42% for 2M monthly users\nLed a team of 6 to launch payments in 3 months' }, onField),
        fi(f, 'why', 'Why this company or role?', { area: true, rows: 2, ph: 'its focus on making payments simple for small businesses', hint: 'Finish the sentence: "What draws me to the company is ..."' }, onField),
        fi(f, 'availability', 'Availability (optional)', { ph: 'I can join within 30 days.' }, onField)))))
  }

  const toneSeg = segmented([['professional', 'Professional'], ['friendly', 'Friendly'], ['confident', 'Confident'], ['enthusiastic', 'Enthusiastic']], opt.tone, (v) => { opt.tone = v; onField() }, 'Tone')
  const lenSeg = segmented([['short', 'Short'], ['standard', 'Standard'], ['detailed', 'Detailed']], opt.length, (v) => { opt.length = v; onField() }, 'Length')
  const lookSeg = segmented([['classic', 'Classic'], ['modern', 'Modern']], opt.look, (v) => { opt.look = v; persist() }, 'Document style')

  const fileBase = () => `${safeName(f.name || 'cover-letter').replace(/\s+/g, '-')}-cover-letter${f.company ? `-${safeName(f.company).replace(/\s+/g, '-')}` : ''}`
  const docOpts = () => (opt.look === 'modern' ? { font: 'helvetica', accent: '#0d9b8a' } : { font: 'times', accent: '#18181b' })
  const mk = (label, ic, variant, fn) => {
    const b = button(label, { icon: ic, variant })
    b.addEventListener('click', () => busy(b, async () => { if (out.value.trim().length < 30) { toast('Write or generate a letter first', 'error'); return } await fn(); burst(b) }, { label: 'Preparing' }))
    return b
  }
  const pdfBtn = mk('PDF', 'file-down', 'primary', async () => saveAs(await blocksToPdf(letterBlocks(out.value, opt), { ...docOpts(), size: 11, title: `Cover letter - ${f.name}`, author: f.name }), `${fileBase()}.pdf`))
  const docxBtn = mk('Word', 'file-type', 'secondary', async () => saveAs(await blocksToDocx(letterBlocks(out.value, opt), { font: opt.look === 'modern' ? 'Calibri' : 'Georgia', accent: opt.look === 'modern' ? '#0d9b8a' : '#18181b', title: `Cover letter - ${f.name}`, author: f.name }), `${fileBase()}.docx`))

  // AI tailoring
  const jdBox = textarea({ rows: 6, placeholder: 'Paste the job description so AI can tailor the letter to it (optional but recommended).', value: load('career:jd', '') })
  jdBox.addEventListener('input', () => save('career:jd', jdBox.value))
  const aiBtn = button('Tailor with AI', { icon: 'sparkles', variant: 'primary' })
  const aiStatus = h('div')
  aiBtn.addEventListener('click', () => busy(aiBtn, async () => {
    if (!(await ai.ensureKey())) return
    let resumeText = ''
    try { const r = normalizeResume(load('resume:data', null)); if (hasContent(r) && !r.sample) resumeText = resumeToText(r) } catch { /* none */ }
    const facts = Object.entries({ Name: f.name, Email: f.email, Phone: f.phone, City: f.city, 'Target role': f.role, Company: f.company, 'Hiring manager': f.manager, 'Found via': f.source, 'Current role': f.currentRole, 'Years of experience': f.years, Skills: f.skills, Achievements: f.highlights, 'Why this company': f.why, Availability: f.availability }).filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${v}`).join('\n')
    edited = true
    const start = out.value
    out.value = ''
    try {
      const text = await ai.ask({
        system: 'You write honest, specific cover letters. Never invent employers, numbers, degrees or skills that are not in the candidate details. Use [square brackets] for anything missing. Return only the letter text with no commentary, no markdown and no subject line. Avoid cliches like "I am writing to express my interest" and avoid em dashes.',
        prompt: `Write a ${opt.length} cover letter in a ${opt.tone} tone (${opt.length === 'short' ? 'about 150 words' : opt.length === 'detailed' ? 'about 350 words' : 'about 250 words'}).${opt.header ? ' Start with the sender name and contact line, then the date (' + today() + '), then the recipient.' : ' Start with the greeting.'}\n\nCANDIDATE DETAILS:\n${facts || '(none given)'}\n\n${resumeText ? `RESUME:\n${resumeText.slice(0, 8000)}\n\n` : ''}${jdBox.value.trim() ? `JOB DESCRIPTION:\n${jdBox.value.slice(0, 8000)}\n\nMirror the job's priorities and keywords where they truthfully apply.` : 'No job description was provided; keep it general to the role.'}`,
        effort: 'medium', maxTokens: 2500, signal, onText: (t) => { out.value = t; upStats() },
      })
      out.value = text.trim(); upStats()
      clear(editedNote, alert('success', 'Written by AI from your details. Read it carefully and replace any [brackets]. ', h('button', { type: 'button', class: 'link', style: 'background:none;border:0;padding:0;font:inherit;cursor:pointer', onclick: regen }, 'Go back to the template version'), '.'))
    } catch (e) { out.value = start; throw e }
  }, { label: 'Writing', errorTo: aiStatus }))

  root.append(shell(
    banner({ icon: 'mail-open', text: '<b>A solid first draft in seconds.</b> Fill in a few fields, pick a tone and edit the result. Add the job post and let AI tailor it if you want more.', steps: ['Your details', 'Pick a tone', 'Edit and download'] }),
    h('div', { class: 'cr-work wide-left' },
      h('div', { class: 'cr-pane-edit' }, formHost),
      h('div', { class: 'cr-sticky stack tight' },
        card('Your letter', 'mail-open', h('div', { class: 'stack tight' },
          h('div', { class: 'row', style: 'gap:10px 16px' }, field('Tone', toneSeg), field('Length', lenSeg)),
          editedNote, out,
          h('div', { class: 'row between' }, stats, saved.el),
          h('div', { class: 'row' }, button('Copy', { icon: 'copy', variant: 'secondary', onClick: () => copyText(out.value) }), pdfBtn, docxBtn,
            button('', { icon: 'file-text', variant: 'ghost', ariaLabel: 'Download as text file', title: 'Download .txt', onClick: () => saveAs(out.value, `${fileBase()}.txt`, 'text/plain;charset=utf-8') }),
            button('Shuffle wording', { icon: 'shuffle', variant: 'ghost', size: 'sm', onClick: () => { opt.variant = (opt.variant + 1) % 3; regen(); persist() } })),
          h('div', { class: 'row small muted' }, 'Document style', lookSeg, h('label', { class: 'switch', style: 'margin-left:auto' }, h('input', { type: 'checkbox', role: 'switch', checked: opt.header, onchange: (e) => { opt.header = e.target.checked; regen(); persist() } }), h('span', 'Include header'))))),
        card('Tailor with AI', 'sparkles', h('div', { class: 'stack tight' }, ai.notice('Optional: uses AI'), jdBox, h('div', { class: 'row' }, aiBtn, h('span', { class: 'small muted' }, 'Sends your fields, saved resume and the job text to Anthropic.')), aiStatus))))))
  drawForm()
  gen()
  if (f.role || f.company) saved.saved()
}
