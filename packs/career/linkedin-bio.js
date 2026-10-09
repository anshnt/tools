// LinkedIn bio generator: five headline options (220 character limit) and three About variants (2600 limit) from your details,
// tuned by goal, tone and perspective, with live counters and a "See more" fold preview. Optional Claude rewrite.
import { h, icon, button, busy, toast, alert, segmented, field, clear, copyText, debounce, textarea, select } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, fi, fs, getProfile, setProfile, firstName, len, burst, saveIndicator } from './_kit.js'

const KEY = 'linkedin:fields'
export const LIMITS = { headline: 220, about: 2600, fold: 300 }

const trimTo = (s, n) => {
  if (len(s) <= n) return s
  const cut = [...s].slice(0, n - 1).join('')
  const sp = cut.lastIndexOf(' ')
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s|,&\-:;]+$/, '')}…`
}
const list = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`)
const sentence = (s) => { const t = (s || '').trim().replace(/\s+/g, ' ').replace(/[.;,\s]+$/, ''); return t ? t[0].toUpperCase() + t.slice(1) + '.' : '' }
const lines = (t) => (t || '').split('\n').map((x) => x.replace(/^[\s\-•*]+/, '').trim()).filter(Boolean)
const aOrAn = (s) => (/^[aeiou]/i.test(s.trim()) ? 'an' : 'a')
const csv = (t) => (t || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

/** Five headline candidates, each trimmed to the limit. */
export function headlines(f, { goal = 'job', tone = 'professional' } = {}) {
  const role = f.role?.trim() || 'Your title'
  const sk = csv(f.skills)
  const aud = f.audience?.trim()
  const out = f.outcome?.trim()
  const years = parseFloat(f.years) > 0 ? `${parseFloat(f.years)}+ years` : ''
  const open = f.openTo?.trim()
  const co = f.company?.trim()
  const ach = lines(f.achievements)[0]
  const out5 = []
  const add = (s) => { const t = s.replace(/\s+/g, ' ').replace(/(?:\s*\|\s*)+$/, '').trim(); if (t && !out5.includes(t)) out5.push(t) }

  const tail = {
    job: open ? `Open to ${open}` : 'Open to new opportunities',
    freelance: 'Available for freelance projects',
    founder: co ? `Building ${co}` : 'Building in public',
    creator: 'Sharing what I learn',
    student: open ? `Seeking ${open}` : 'Seeking internships and entry level roles',
  }[goal]
  const valueProp = aud && out ? `Helping ${aud} ${out}` : out ? `I help teams ${out}` : aud ? `Working with ${aud}` : ''

  add([role + (co && goal !== 'founder' ? ` at ${co}` : ''), sk.slice(0, 3).join(' | '), valueProp].filter(Boolean).join(' | '))
  add([role, valueProp || sk.slice(0, 2).join(' and '), tail].filter(Boolean).join(' | '))
  add([years ? `${role} with ${years} of experience` : role, ach ? sentence(ach).replace(/\.$/, '') : '', sk[0] ? `${sk[0]} specialist` : ''].filter(Boolean).join(' | '))
  add([...sk.slice(0, 4), role].join(' · '))
  if (tone === 'bold') add(`${out ? out.charAt(0).toUpperCase() + out.slice(1) : `${role} who ships`}${aud ? ` for ${aud}` : ''} | ${sk.slice(0, 2).join(' + ') || role}`)
  else if (tone === 'creative') add(`${out ? `Turning ideas into ${out}` : 'Turning ideas into outcomes'} | ${role}${sk[0] ? ` | ${sk[0]}` : ''}`)
  else if (tone === 'friendly') add(`${role} who loves ${sk.slice(0, 2).join(' and ') || 'solving problems'} | ${tail}`)
  else add(`${role} | ${tail}${sk[0] ? ` | ${sk.slice(0, 2).join(', ')}` : ''}`)
  add(`${role}${co ? ` @ ${co}` : ''}${years ? ` | ${years}` : ''}${sk.length ? ` | ${sk.slice(0, 3).join(', ')}` : ''} | ${tail}`)
  return out5.slice(0, 5).map((t) => trimTo(t, LIMITS.headline))
}

/** Three About drafts: story, skills first, short. */
export function abouts(f, { goal = 'job', tone = 'professional', person = 'first' } = {}) {
  const role = f.role?.trim() || 'professional'
  const sk = csv(f.skills)
  const hl = lines(f.achievements)
  const aud = f.audience?.trim(), out = f.outcome?.trim()
  const years = parseFloat(f.years) > 0 ? parseFloat(f.years) : 0
  const co = f.company?.trim(), field_ = f.field?.trim()
  const name = f.name?.trim()
  const fn = firstName(name)
  const third = person === 'third'
  const P = third ? (fn || 'They') : 'I'
  const poss = third ? 'their' : 'my'
  const verb = (a, b) => (third ? b : a) // verb(first, third)
  const intro = `${third ? `${name || 'This professional'} is` : "I'm"} ${aOrAn(role)} ${role}${co ? ` at ${co}` : ''}${years ? ` with ${years}${years === 1 ? ' year' : '+ years'} of experience` : ''}${field_ ? ` in ${field_}` : ''}.`
  const what = aud || out
    ? `${third ? `${fn || 'They'} help${fn ? 's' : ''}` : 'I help'} ${aud || 'teams'} ${out || 'do their best work'}${sk.length ? `, using ${list(sk.slice(0, 4))}` : ''}.`
    : sk.length ? `${third ? `${fn || 'Their'} ${fn ? 'works' : 'toolkit'}` : 'My toolkit'} ${third && fn ? 'with' : 'includes'} ${list(sk.slice(0, 5))}.` : ''
  const hook = {
    professional: out ? `${sentence(out.charAt(0).toUpperCase() + out.slice(1))}` : `${years ? `${years} years` : 'Years'} of turning complex problems into clear, working solutions.`,
    friendly: `I love ${sk.length ? `working with ${list(sk.slice(0, 2))}` : 'solving real problems'}, and I love it even more when it helps someone.`,
    bold: out ? `${out.charAt(0).toUpperCase() + out.slice(1)}. That's the job.` : 'Results first. Everything else is noise.',
    creative: `Some people see a problem. ${third ? 'They see' : 'I see'} a puzzle waiting to be solved.`,
  }[tone]
  const hookLine = third ? (tone === 'bold' ? hook : hook.replace(/\bI love\b/, `${fn || 'They'} love${fn ? 's' : ''}`).replace(/\bmy\b/g, 'their').replace(/\bI see\b/, `${fn || 'they'} see${fn ? 's' : ''}`)) : hook
  const proofHead = { professional: `Selected highlights:`, friendly: `A few things I'm proud of:`, bold: `The proof:`, creative: `Along the way:` }[tone]
  const proofHeadT = third ? proofHead.replace(/^A few things I'm proud of:/, 'A few highlights:').replace(/^Along the way:/, 'Along the way:') : proofHead
  const bullets = hl.slice(0, 4).map((x) => `• ${sentence(x)}`)
  const cta = {
    job: f.cta?.trim() || (third ? `${fn || 'They'} ${fn ? 'is' : 'are'} open to new opportunities${f.openTo ? `: ${f.openTo}` : ''}.` : `I'm open to new opportunities${f.openTo ? `: ${f.openTo}` : ''}. Let's talk.`),
    freelance: f.cta?.trim() || `${third ? 'Available' : "I'm available"} for freelance projects. Send a message to discuss yours.`,
    founder: f.cta?.trim() || `${third ? 'Happy' : "I'm always happy"} to connect with founders, builders and customers.`,
    creator: f.cta?.trim() || `${third ? 'Follow' : 'Follow along'} for what ${third ? 'they are' : "I'm"} learning, building and getting wrong.`,
    student: f.cta?.trim() || `${third ? 'Looking' : "I'm looking"} for ${f.openTo || 'internships and entry level roles'}. Happy to chat.`,
  }[goal]
  const ctaLine = f.cta?.trim() ? sentence(f.cta) : cta

  const story = [hookLine, [intro, what].filter(Boolean).join(' '), bullets.length ? `${proofHeadT}\n${bullets.join('\n')}` : '', ctaLine].filter(Boolean).join('\n\n')
  const skillsFirst = [
    [intro, what].filter(Boolean).join(' '),
    sk.length ? `Core skills: ${sk.slice(0, 8).join(' · ')}` : '',
    bullets.length ? `${proofHeadT}\n${bullets.join('\n')}` : '',
    ctaLine,
  ].filter(Boolean).join('\n\n')
  const short = trimTo([hookLine, intro, sk.length ? `${verb('Skills', 'Skills')}: ${sk.slice(0, 5).join(', ')}.` : '', ctaLine].filter(Boolean).join(' '), 600)
  return [
    { id: 'story', label: 'Story', blurb: 'A hook, proof and a call to action', text: story },
    { id: 'skills', label: 'Skills first', blurb: 'Keyword rich, easy to scan', text: skillsFirst },
    { id: 'short', label: 'Short and punchy', blurb: 'Under 600 characters', text: short },
  ].map((a) => ({ ...a, text: trimTo(a.text, LIMITS.about) }))
}

function counter(max) {
  const bar = h('i')
  const txt = h('span')
  const el = h('div', { class: 'stack tight' }, h('div', { class: 'cr-meter' }, bar), h('div', { class: 'row small muted', style: 'justify-content:space-between' }, txt))
  el.set = (n, extra = '') => {
    const over = n > max
    txt.textContent = `${n.toLocaleString()} / ${max.toLocaleString()} characters${over ? ` (${(n - max).toLocaleString()} over)` : ''}${extra ? `  ·  ${extra}` : ''}`
    bar.style.setProperty('--w', `${Math.min(100, (n / max) * 100)}%`)
    el.firstChild.classList.toggle('over', over)
    el.firstChild.classList.toggle('warn', !over && n / max > 0.9)
  }
  return el
}

export async function mount(root, { signal }) {
  const prof = getProfile()
  const f = { name: prof.name, role: prof.title, company: '', field: '', years: '', skills: '', achievements: '', audience: '', outcome: '', openTo: '', cta: '', ...load(KEY, {}) }
  const opt = { goal: f.goal || 'job', tone: f.tone || 'professional', person: f.person || 'first' }
  const overrides = {} // text the user edited by hand
  const saved = saveIndicator('Saved on this device')
  const persist = debounce(() => { save(KEY, { ...f, ...opt }); setProfile({ name: f.name, title: f.role }); saved.saved() }, 400)
  const outHost = h('div', { class: 'stack' })
  let aiOut = null

  const hlCard = (text, i) => {
    const c = counter(LIMITS.headline)
    const ta = textarea({ rows: 2, 'aria-label': `Headline option ${i + 1}` })
    ta.value = text
    ta.style.minHeight = '64px'
    const up = () => c.set(len(ta.value))
    ta.addEventListener('input', up)
    up()
    return h('div', { class: 'cr-card cr-rise', style: { '--i': i, padding: '14px' } }, h('div', { class: 'row small muted', style: 'justify-content:space-between;margin-bottom:6px' }, h('b', { style: 'color:var(--text)' }, `Option ${i + 1}`), button('Copy', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => { copyText(ta.value); burst() } })), ta, c)
  }
  const aboutCard = (a, i) => {
    const c = counter(LIMITS.about)
    const ta = textarea({ rows: 9, 'aria-label': `About: ${a.label}` })
    ta.value = a.text
    const fold = h('div', { class: 'small', style: 'padding:10px 12px;border-radius:12px;background:var(--surface-2);border:1px dashed var(--border-strong);color:var(--text-2);overflow-wrap:anywhere' })
    const up = () => {
      const t = ta.value
      c.set(len(t), t.length > LIMITS.fold ? `${LIMITS.fold} shown before "See more"` : '')
      fold.replaceChildren(h('span', { class: 'muted' }, 'First lines on your profile: '), [...t].slice(0, LIMITS.fold).join('').split('\n').join(' '), len(t) > LIMITS.fold ? h('b', { style: 'color:var(--accent)' }, ' ...see more') : '')
    }
    ta.addEventListener('input', up)
    up()
    return h('div', { class: 'cr-card cr-rise', style: { '--i': i } }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:8px' }, h('div', h('b', a.label), h('div', { class: 'small muted' }, a.blurb)), button('Copy', { icon: 'copy', variant: 'secondary', size: 'sm', onClick: () => { copyText(ta.value); burst() } })), ta, h('div', { style: 'margin-top:8px' }, c), h('div', { style: 'margin-top:8px' }, fold))
  }

  function draw() {
    const hs = aiOut ? aiOut.headlines : headlines(f, opt)
    const as = aiOut ? aiOut.abouts : abouts(f, opt)
    clear(outHost,
      aiOut ? alert('success', 'Written by Claude from your details. Read it carefully before you post. ', h('button', { type: 'button', class: 'link', style: 'background:none;border:0;padding:0;font:inherit;cursor:pointer', onclick: () => { aiOut = null; draw() } }, 'Back to the template versions')) : null,
      h('div', { class: 'stack tight' }, h('h2', { class: 'cr-h', style: 'margin:0' }, h('span', { class: 'tile' }, icon('heading')), 'Headlines', h('span', { class: 'aside' }, `${LIMITS.headline} characters max`)), h('div', { class: 'stack tight' }, hs.map(hlCard))),
      h('div', { class: 'stack tight' }, h('h2', { class: 'cr-h', style: 'margin:0' }, h('span', { class: 'tile' }, icon('text-quote')), 'About section', h('span', { class: 'aside' }, `${LIMITS.about.toLocaleString()} characters max`)), h('div', { class: 'stack tight' }, as.map(aboutCard))))
  }
  const redraw = debounce(draw, 180)
  const onField = () => { saved.dirty(); persist(); aiOut = null; redraw() }

  const goalSel = fs(opt, 'goal', 'I want to', [['job', 'Find a job'], ['freelance', 'Win freelance clients'], ['founder', 'Promote my business'], ['creator', 'Build a personal brand'], ['student', 'Start my career (student)']], onField)
  const toneSeg = segmented([['professional', 'Professional'], ['friendly', 'Friendly'], ['bold', 'Bold'], ['creative', 'Creative']], opt.tone, (v) => { opt.tone = v; onField() }, 'Tone')
  const personSeg = segmented([['first', 'First person (I)'], ['third', 'Third person']], opt.person, (v) => { opt.person = v; onField() }, 'Perspective')

  const aiBtn = button('Rewrite with Claude', { icon: 'sparkles', variant: 'secondary' })
  const aiErr = h('div')
  aiBtn.addEventListener('click', () => busy(aiBtn, async () => {
    if (!(await ai.ensureKey())) return
    const facts = Object.entries({ Name: f.name, 'Current title': f.role, Company: f.company, Field: f.field, 'Years of experience': f.years, Skills: f.skills, Achievements: f.achievements, 'Who I help': f.audience, 'What I help them do': f.outcome, 'Open to': f.openTo, 'Call to action': f.cta }).filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${v}`).join('\n')
    const res = await ai.ask({
      system: 'You write LinkedIn profiles. Be specific and human, never invent facts, employers, numbers or credentials that are not given. No emojis unless the tone is creative. Avoid buzzwords like "passionate", "results-driven" and "synergy". Do not use em dashes.',
      prompt: `Goal: ${opt.goal}. Tone: ${opt.tone}. Perspective: ${opt.person === 'third' ? 'third person' : 'first person'}.\n\nDETAILS:\n${facts || '(few details given)'}\n\nWrite 5 distinct headline options (each at most ${LIMITS.headline} characters, using | or middle dots as separators) and 3 About section drafts: a story version (about 1200 to 1800 characters, strong first 2 lines because only about ${LIMITS.fold} characters show before "See more"), a skills-first version (about 900 to 1400 characters, with a short bulleted proof list using the bullet character), and a short version (under 600 characters). Each About must stay under ${LIMITS.about} characters.`,
      json: { type: 'object', properties: { headlines: { type: 'array', items: { type: 'string' } }, abouts: { type: 'array', items: { type: 'string' } } }, required: ['headlines', 'abouts'], additionalProperties: false },
      effort: 'low', maxTokens: 6000, signal,
    })
    const labels = [['story', 'Story', 'A hook, proof and a call to action'], ['skills', 'Skills first', 'Keyword rich, easy to scan'], ['short', 'Short and punchy', 'Under 600 characters']]
    aiOut = { headlines: res.headlines.slice(0, 5).map((t) => trimTo(t, LIMITS.headline)), abouts: res.abouts.slice(0, 3).map((t, i) => ({ id: labels[i][0], label: labels[i][1], blurb: labels[i][2], text: trimTo(t, LIMITS.about) })) }
    draw()
  }, { label: 'Writing', errorTo: aiErr }))

  root.append(shell(
    banner({ icon: 'user-round-pen', text: '<b>A profile that gets read.</b> Headlines under 220 characters, About sections that hook in the first two lines, and live counters so nothing gets cut off.', steps: ['Tell us about you', 'Pick a style', 'Copy to LinkedIn'] }),
    h('div', { class: 'cr-work' },
      h('div', { class: 'stack cr-pane-edit' },
        card('About you', 'user-round', h('div', { class: 'stack tight' },
          h('div', { class: 'grid-2' }, fi(f, 'name', 'Your name', { ph: 'Aarav Mehta', ac: 'name' }, onField), fi(f, 'role', 'Current title', { ph: 'Senior Software Engineer' }, onField)),
          h('div', { class: 'grid-2' }, fi(f, 'company', 'Company (optional)', { ph: 'Northwind Labs' }, onField), fi(f, 'years', 'Years of experience', { ph: '7', mode: 'numeric' }, onField)),
          fi(f, 'field', 'Field or industry', { ph: 'fintech and payments' }, onField),
          fi(f, 'skills', 'Top skills (comma separated)', { ph: 'React, Node.js, AWS, team leadership' }, onField),
          fi(f, 'achievements', 'Achievements (one per line)', { area: true, rows: 3, ph: 'Cut page load time by 42% for 2M users\nLed a team of 6 to launch payments in 3 months' }, onField))),
        card('Your audience', 'target', h('div', { class: 'stack tight' },
          h('div', { class: 'grid-2' }, fi(f, 'audience', 'Who do you help?', { ph: 'fintech startups' }, onField), fi(f, 'outcome', 'What do you help them do?', { ph: 'ship reliable products faster' }, onField)),
          h('div', { class: 'grid-2' }, fi(f, 'openTo', 'Open to (optional)', { ph: 'Staff Engineer roles in fintech' }, onField), fi(f, 'cta', 'Call to action (optional)', { ph: 'Message me or email aarav@example.com' }, onField)))),
        card('Style', 'palette', h('div', { class: 'stack tight' }, goalSel, field('Tone', toneSeg), field('Perspective', personSeg))),
        card('Polish with AI', 'sparkles', h('div', { class: 'stack tight' }, ai.notice('Optional: uses Claude'), h('div', { class: 'row' }, aiBtn, saved.el), aiErr))),
      h('div', { class: 'cr-sticky-lite' }, outHost))))
  draw()
}
