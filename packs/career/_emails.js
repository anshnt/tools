// Email templates for common work situations. Each template lists its fields and builds {subject, paras} for a tone
// (formal, neutral, friendly). Pure data and functions, no DOM.

const has = (x) => !!(x && String(x).trim())
const val = (x, ph) => (has(x) ? String(x).trim() : `[${ph}]`)
const first = (n) => (n || '').trim().split(/\s+/)[0] || ''
export const fmtDate = (v) => {
  if (!has(v)) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return String(v).trim()
}
const dt = (v, ph) => fmtDate(v) || `[${ph}]`
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const end = (s) => (has(s) ? String(s).trim().replace(/[.!?\s]+$/, '') : '')
const days = (a, b) => (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b) ? Math.round((new Date(b) - new Date(a)) / 86400000) + 1 : 0)

/** Tone helpers handed to every builder. */
export function style(tone, f) {
  const t = (formal, neutral, friendly) => ({ formal, neutral, friendly }[tone] ?? neutral)
  const to = (f.to || '').trim()
  return {
    tone, t,
    greet: to ? t(`Dear ${to},`, `Hello ${to},`, `Hi ${first(to)},`) : t('Dear Sir or Madam,', 'Hello,', 'Hi there,'),
    close: (kind = 'neutral') => ({ formal: kind === 'warm' ? 'Yours sincerely,' : 'Sincerely,', neutral: kind === 'warm' ? 'Kind regards,' : 'Best regards,', friendly: kind === 'warm' ? 'Warm regards,' : 'Thanks,' })[tone],
    thanks: t('Thank you for your time and consideration.', 'Thanks for your time.', 'Thanks so much!'),
    please: t('I would be grateful if you could', 'Could you please', 'Could you'),
    sorry: t('I sincerely apologize', 'I am sorry', "I'm really sorry"),
  }
}

const COMMON_TO = { k: 'to', label: 'Recipient name', ph: 'Priya Sharma' }
const COMMON_FROM = { k: 'from', label: 'Your name', ph: 'Aarav Mehta' }
const date = (k, label) => ({ k, label, type: 'date' })

export const GROUPS = [
  { id: 'leave', name: 'Leave and absence', icon: 'calendar-off', color: '#0d9b8a' },
  { id: 'job', name: 'Job search', icon: 'briefcase', color: '#7c5cf0' },
  { id: 'work', name: 'Everyday work', icon: 'building-2', color: '#2f7de1' },
  { id: 'business', name: 'Business and service', icon: 'handshake', color: '#e5833a' },
]

export const TEMPLATES = [
  // ---------- Leave and absence ----------
  { id: 'leave-application', group: 'leave', name: 'Leave application', icon: 'calendar-off', desc: 'Ask your manager for time off.',
    fields: [date('start', 'First day of leave'), date('end', 'Last day of leave'), { k: 'reason', label: 'Reason (optional)', ph: 'a family function' }, { k: 'cover', label: 'Who covers for you?', ph: 'Rahul' }, { k: 'reach', label: 'Reachable in emergencies?', ph: 'Yes, by phone' }],
    build: (f, S) => ({ subject: `Leave application: ${dt(f.start, 'start date')}${has(f.end) && f.end !== f.start ? ` to ${dt(f.end, 'end date')}` : ''}`, paras: [
      S.t(`I am writing to request leave from ${dt(f.start, 'start date')} to ${dt(f.end, 'end date')}${days(f.start, f.end) ? ` (${days(f.start, f.end)} day${days(f.start, f.end) > 1 ? 's' : ''})` : ''}${has(f.reason) ? ` due to ${end(f.reason)}` : ''}.`, `I would like to request leave from ${dt(f.start, 'start date')} to ${dt(f.end, 'end date')}${has(f.reason) ? ` for ${end(f.reason)}` : ''}.`, `I'd like to take some time off from ${dt(f.start, 'start date')} to ${dt(f.end, 'end date')}${has(f.reason) ? ` for ${end(f.reason)}` : ''}.`),
      `I will make sure my current tasks are completed or handed over before I leave.${has(f.cover) ? ` ${cap(end(f.cover))} has agreed to cover for me.` : ''}${has(f.reach) ? ` ${S.t('In an emergency I can be reached', 'I can be reached', 'You can reach me')}: ${end(f.reach)}.` : ''}`,
      S.t('Kindly let me know if this is approved. I would be happy to discuss any concerns.', 'Please let me know if this works for you.', 'Let me know if that works!') ] }) },
  { id: 'sick-leave', group: 'leave', name: 'Sick leave', icon: 'thermometer', desc: 'Tell your manager you are unwell.',
    fields: [date('start', 'First day off'), { k: 'days', label: 'How many days?', ph: '2' }, { k: 'note', label: 'Medical note?', ph: 'I can share a doctor\'s note on return' }, { k: 'work', label: 'Urgent work arrangement', ph: 'Rahul has my handover notes' }],
    build: (f, S) => ({ subject: `Sick leave${has(f.start) ? ` from ${dt(f.start)}` : ''}`, paras: [
      S.t(`I am unwell and unable to work${has(f.start) ? ` from ${dt(f.start)}` : ' today'}${has(f.days) ? `. I expect to be away for ${end(f.days)} day${f.days == 1 ? '' : 's'}` : ''}.`, `I am not feeling well and will need to take sick leave${has(f.start) ? ` starting ${dt(f.start)}` : ' today'}${has(f.days) ? ` for about ${end(f.days)} day${f.days == 1 ? '' : 's'}` : ''}.`, `I'm not feeling well, so I'll need to take sick leave${has(f.start) ? ` from ${dt(f.start)}` : ' today'}${has(f.days) ? ` for around ${end(f.days)} day${f.days == 1 ? '' : 's'}` : ''}.`),
      [has(f.note) ? `${cap(end(f.note))}.` : '', has(f.work) ? `For anything urgent: ${end(f.work)}.` : ''].filter(Boolean).join(' '),
      S.t('I apologize for the inconvenience and will update you as soon as I know when I can return.', 'Sorry for the short notice. I will keep you posted.', "Sorry for the short notice. I'll keep you posted!") ] }) },
  { id: 'emergency-leave', group: 'leave', name: 'Emergency leave', icon: 'siren', desc: 'Short notice leave for an urgent personal matter.',
    fields: [date('start', 'From'), { k: 'return', label: 'Expected return', ph: 'Monday, or I will confirm tomorrow' }, { k: 'reach', label: 'How to reach you', ph: 'WhatsApp or phone' }],
    build: (f, S) => ({ subject: 'Emergency leave request', paras: [
      S.t(`I regret to inform you that I need to take emergency leave${has(f.start) ? ` starting ${dt(f.start)}` : ' with immediate effect'} due to an urgent personal matter.`, `I need to take emergency leave${has(f.start) ? ` from ${dt(f.start)}` : ' starting today'} because of an urgent personal matter.`, `Something urgent has come up at home and I need to take emergency leave${has(f.start) ? ` from ${dt(f.start)}` : ' starting today'}.`),
      `${has(f.return) ? `I expect to be back: ${end(f.return)}. ` : ''}${has(f.reach) ? `You can reach me by ${end(f.reach)} if something critical comes up.` : ''}`.trim(),
      S.t('I apologize for the short notice and appreciate your understanding.', 'Sorry for the short notice, and thank you for understanding.', "Sorry for the short notice, and thanks for understanding.") ] }) },
  { id: 'wfh-request', group: 'leave', name: 'Work from home request', icon: 'house', desc: 'Ask to work remotely for a day or more.',
    fields: [date('start', 'First day'), date('end', 'Last day (optional)'), { k: 'reason', label: 'Reason', ph: 'a plumber is visiting in the morning' }, { k: 'avail', label: 'Availability', ph: 'Online 9 to 6, reachable on Slack and phone' }],
    build: (f, S) => ({ subject: `Work from home request: ${dt(f.start, 'date')}`, paras: [
      S.t(`I would like to request permission to work from home on ${dt(f.start, 'date')}${has(f.end) && f.end !== f.start ? ` to ${dt(f.end)}` : ''}${has(f.reason) ? ` because ${end(f.reason)}` : ''}.`, `Could I work from home on ${dt(f.start, 'date')}${has(f.end) && f.end !== f.start ? ` to ${dt(f.end)}` : ''}${has(f.reason) ? `? ${cap(end(f.reason))}` : '?'}.`.replace('?.', '?'), `Would it be okay if I work from home on ${dt(f.start, 'date')}${has(f.end) && f.end !== f.start ? ` to ${dt(f.end)}` : ''}${has(f.reason) ? `? ${cap(end(f.reason))}` : '?'}.`.replace('?.', '?')),
      `${has(f.avail) ? `${cap(end(f.avail))}. ` : ''}I will keep my tasks on track and join all scheduled meetings.`,
      S.t('Please let me know if you approve.', 'Let me know if that is fine.', 'Let me know!') ] }) },
  { id: 'vacation-request', group: 'leave', name: 'Vacation request', icon: 'plane', desc: 'Plan a holiday with your team in mind.',
    fields: [date('start', 'Leaving on'), date('end', 'Back on'), { k: 'cover', label: 'Coverage plan', ph: 'Rahul will cover client calls; handover doc ready by Friday' }],
    build: (f, S) => ({ subject: `Vacation request: ${dt(f.start, 'start')} to ${dt(f.end, 'end')}`, paras: [
      S.t(`I would like to request vacation leave from ${dt(f.start, 'start date')} to ${dt(f.end, 'end date')}${days(f.start, f.end) ? ` (${days(f.start, f.end)} days)` : ''}.`, `I'd like to take vacation from ${dt(f.start, 'start date')} to ${dt(f.end, 'end date')}${days(f.start, f.end) ? ` (${days(f.start, f.end)} days)` : ''}.`, `I'm planning a holiday from ${dt(f.start, 'start date')} to ${dt(f.end, 'end date')}${days(f.start, f.end) ? ` (${days(f.start, f.end)} days)` : ''} and wanted to check it works for the team.`),
      has(f.cover) ? `To keep things running smoothly: ${end(f.cover)}.` : 'I will hand over my work in advance so nothing is blocked while I am away.',
      S.t('Please let me know if these dates are suitable.', 'Let me know if these dates work.', 'Let me know if the dates work for you!') ] }) },
  { id: 'parental-leave', group: 'leave', name: 'Parental leave', icon: 'baby', desc: 'Notify your employer about maternity or paternity leave.',
    fields: [{ k: 'kind', label: 'Type', ph: 'maternity or paternity' }, date('start', 'Leave starts'), date('end', 'Expected return'), { k: 'plan', label: 'Handover plan', ph: 'I will document my projects and brief the team by 15 October' }],
    build: (f, S) => ({ subject: `${cap(has(f.kind) ? f.kind.trim() : 'parental')} leave request`, paras: [
      S.t(`I am writing to formally request ${has(f.kind) ? end(f.kind) : 'parental'} leave starting ${dt(f.start, 'start date')}${has(f.end) ? `, with an expected return on ${dt(f.end)}` : ''}.`, `I'd like to request ${has(f.kind) ? end(f.kind) : 'parental'} leave starting ${dt(f.start, 'start date')}${has(f.end) ? `, and I expect to return on ${dt(f.end)}` : ''}.`, `I have some happy news and need to request ${has(f.kind) ? end(f.kind) : 'parental'} leave starting ${dt(f.start, 'start date')}${has(f.end) ? `, planning to return on ${dt(f.end)}` : ''}.`),
      has(f.plan) ? `${cap(end(f.plan))}.` : 'I will work with you to plan a smooth handover before I go.',
      S.t('Please let me know what paperwork is required and when we can discuss the details.', 'Please let me know the next steps and any forms I should complete.', 'Let me know what I need to fill in and when we can chat about the details.') ] }) },
  { id: 'leave-extension', group: 'leave', name: 'Leave extension', icon: 'calendar-plus', desc: 'Ask for more time off than approved.',
    fields: [date('orig', 'Original return date'), date('newd', 'New return date'), { k: 'reason', label: 'Reason', ph: 'my recovery is taking longer than expected' }],
    build: (f, S) => ({ subject: 'Request to extend my leave', paras: [
      S.t(`I am writing to request an extension of my leave. I was due to return on ${dt(f.orig, 'original date')}, but ${has(f.reason) ? end(f.reason) : '[reason]'}.`, `I need to extend my leave. I was due back on ${dt(f.orig, 'original date')}, but ${has(f.reason) ? end(f.reason) : '[reason]'}.`, `I'm sorry to say I need a bit more time off. I was due back on ${dt(f.orig, 'original date')}, but ${has(f.reason) ? end(f.reason) : '[reason]'}.`),
      `I would now plan to return on ${dt(f.newd, 'new date')}. I will update you if anything changes.`,
      S.t('I apologize for the inconvenience and appreciate your understanding.', 'Thank you for understanding.', 'Thanks for being so understanding.') ] }) },

  // ---------- Job search ----------
  { id: 'resignation', group: 'job', name: 'Resignation', icon: 'door-open', desc: 'Resign professionally and leave on good terms.',
    fields: [{ k: 'role', label: 'Your role', ph: 'Senior Software Engineer' }, { k: 'company', label: 'Company', ph: 'Northwind Labs' }, date('last', 'Last working day'), { k: 'reason', label: 'Reason (optional)', ph: 'a new opportunity that fits my long term goals' }, { k: 'handover', label: 'Handover offer', ph: 'document my projects and train a successor' }, { k: 'thanks', label: 'Something you are grateful for', ph: 'the mentorship and the chance to lead the payments team' }],
    build: (f, S) => ({ subject: `Resignation: ${has(f.from) ? f.from.trim() : '[your name]'}`, paras: [
      S.t(`Please accept this email as formal notice of my resignation from my position as ${val(f.role, 'role')} at ${val(f.company, 'company')}. My last working day will be ${dt(f.last, 'last working day')}.`, `I am writing to resign from my position as ${val(f.role, 'role')} at ${val(f.company, 'company')}. My last day will be ${dt(f.last, 'last working day')}.`, `I wanted to let you know that I've decided to resign from my role as ${val(f.role, 'role')} at ${val(f.company, 'company')}. My last day will be ${dt(f.last, 'last working day')}.`),
      `${has(f.reason) ? `I have decided to move on for ${end(f.reason)}. ` : ''}${has(f.thanks) ? `I am grateful for ${end(f.thanks)}.` : 'I am grateful for the opportunities I have had here.'}`,
      `${has(f.handover) ? `During my notice period I will ${end(f.handover)}.` : 'During my notice period I will do everything I can to ensure a smooth handover.'} Please let me know how I can help make the transition easy.`,
      S.t('Thank you for your support and guidance. I wish you and the team continued success.', 'Thank you for everything. I wish you and the team all the best.', "Thanks for everything. I'll miss working with you all and wish the team the best!") ] }) },
  { id: 'job-application', group: 'job', name: 'Job application email', icon: 'send', desc: 'A short email to apply with your resume attached.',
    fields: [{ k: 'role', label: 'Role', ph: 'Product Designer' }, { k: 'company', label: 'Company', ph: 'Northwind Labs' }, { k: 'source', label: 'Where you saw it', ph: 'LinkedIn' }, { k: 'pitch', label: 'Why you fit (1 or 2 lines)', ph: 'I have 5 years of experience designing fintech apps and led the redesign that lifted onboarding completion by 28%', area: true }],
    build: (f, S) => ({ subject: `Application for ${val(f.role, 'role')}${has(f.from) ? ` - ${f.from.trim()}` : ''}`, paras: [
      S.t(`I am writing to apply for the ${val(f.role, 'role')} position at ${val(f.company, 'company')}${has(f.source) ? `, which I found on ${end(f.source)}` : ''}.`, `I'd like to apply for the ${val(f.role, 'role')} role at ${val(f.company, 'company')}${has(f.source) ? ` that I saw on ${end(f.source)}` : ''}.`, `I'm excited to apply for the ${val(f.role, 'role')} role at ${val(f.company, 'company')}${has(f.source) ? ` that I spotted on ${end(f.source)}` : ''}.`),
      has(f.pitch) ? `${cap(end(f.pitch))}.` : '[One or two lines on why you are a strong fit.]',
      'I have attached my resume for your review.', S.t('I would welcome the opportunity to discuss how I can contribute to your team. Thank you for your consideration.', 'I would love to talk about how I can contribute. Thanks for your time.', "I'd love to chat about how I can help. Thanks for taking a look!") ] }) },
  { id: 'interview-thank-you', group: 'job', name: 'Thank you after interview', icon: 'heart-handshake', desc: 'Follow up within 24 hours of an interview.',
    fields: [{ k: 'role', label: 'Role', ph: 'Product Designer' }, { k: 'company', label: 'Company', ph: 'Northwind Labs' }, { k: 'topic', label: 'Something you discussed', ph: 'your plans to simplify the checkout experience' }, date('date', 'Interview date')],
    build: (f, S) => ({ subject: `Thank you: ${val(f.role, 'role')} interview`, paras: [
      S.t(`Thank you for taking the time to speak with me${has(f.date) ? ` on ${dt(f.date)}` : ''} about the ${val(f.role, 'role')} position at ${val(f.company, 'company')}.`, `Thanks for speaking with me${has(f.date) ? ` on ${dt(f.date)}` : ''} about the ${val(f.role, 'role')} role at ${val(f.company, 'company')}.`, `Thanks so much for chatting with me${has(f.date) ? ` on ${dt(f.date)}` : ''} about the ${val(f.role, 'role')} role at ${val(f.company, 'company')}!`),
      `${has(f.topic) ? `I especially enjoyed our conversation about ${end(f.topic)}. ` : ''}It strengthened my interest in the role and in how I could contribute to the team.`,
      S.t('Please let me know if I can provide any further information. I look forward to hearing about the next steps.', 'Let me know if you need anything else from me. I look forward to the next steps.', 'Let me know if I can share anything else. Looking forward to what comes next!') ] }) },
  { id: 'application-follow-up', group: 'job', name: 'Application follow-up', icon: 'mail-question', desc: 'Politely check on the status of an application.',
    fields: [{ k: 'role', label: 'Role', ph: 'Product Designer' }, date('applied', 'Applied on'), { k: 'company', label: 'Company', ph: 'Northwind Labs' }],
    build: (f, S) => ({ subject: `Following up: ${val(f.role, 'role')} application`, paras: [
      S.t(`I am writing to follow up on my application for the ${val(f.role, 'role')} position at ${val(f.company, 'company')}${has(f.applied) ? `, submitted on ${dt(f.applied)}` : ''}.`, `I wanted to follow up on my application for the ${val(f.role, 'role')} role at ${val(f.company, 'company')}${has(f.applied) ? ` from ${dt(f.applied)}` : ''}.`, `I wanted to check in on my application for the ${val(f.role, 'role')} role at ${val(f.company, 'company')}${has(f.applied) ? ` (I applied on ${dt(f.applied)})` : ''}.`),
      'I remain very interested in the position and would be glad to provide any additional information.',
      S.t('Could you please share an update on the status of my application? Thank you for your time.', 'Could you let me know where things stand? Thanks for your time.', "Could you let me know where things stand? Thanks so much!") ] }) },
  { id: 'offer-acceptance', group: 'job', name: 'Accept a job offer', icon: 'party-popper', desc: 'Confirm your acceptance clearly and warmly.',
    fields: [{ k: 'role', label: 'Role', ph: 'Product Designer' }, { k: 'company', label: 'Company', ph: 'Northwind Labs' }, date('start', 'Start date'), { k: 'terms', label: 'Terms to confirm (optional)', ph: 'a salary of 28 LPA and a remote-first arrangement' }],
    build: (f, S) => ({ subject: `Accepting the ${val(f.role, 'role')} offer`, paras: [
      S.t(`Thank you for offering me the position of ${val(f.role, 'role')} at ${val(f.company, 'company')}. I am pleased to formally accept the offer.`, `Thank you for the offer for the ${val(f.role, 'role')} role at ${val(f.company, 'company')}. I'm happy to accept.`, `Thank you so much for the offer! I'm thrilled to accept the ${val(f.role, 'role')} role at ${val(f.company, 'company')}.`),
      `${has(f.terms) ? `As discussed, I understand the terms to be ${end(f.terms)}. ` : ''}I am looking forward to starting on ${dt(f.start, 'start date')}.`,
      S.t('Please let me know if there are any documents I should complete before my first day.', 'Let me know if there is any paperwork I should complete before I start.', 'Let me know if there is anything I should do before my first day!') ] }) },
  { id: 'offer-decline', group: 'job', name: 'Decline a job offer', icon: 'circle-x', desc: 'Say no gracefully and keep the door open.',
    fields: [{ k: 'role', label: 'Role', ph: 'Product Designer' }, { k: 'company', label: 'Company', ph: 'Northwind Labs' }, { k: 'reason', label: 'Reason (optional)', ph: 'I have accepted another offer that is closer to my goals' }],
    build: (f, S) => ({ subject: `${val(f.role, 'role')} offer`, paras: [
      S.t(`Thank you for offering me the ${val(f.role, 'role')} position at ${val(f.company, 'company')}. After careful consideration, I have decided to respectfully decline.`, `Thank you for the offer for the ${val(f.role, 'role')} role at ${val(f.company, 'company')}. After a lot of thought, I've decided to decline.`, `Thank you so much for the offer for the ${val(f.role, 'role')} role at ${val(f.company, 'company')}. After a lot of thought, I've decided not to move forward.`),
      `${has(f.reason) ? `${cap(end(f.reason))}. ` : ''}This was not an easy decision, as I was impressed by the team and the work you are doing.`,
      S.t('I appreciate the time you invested and hope our paths cross again.', 'I appreciate your time and hope we can stay in touch.', 'I really appreciate your time and hope we stay in touch!') ] }) },
  { id: 'salary-negotiation', group: 'job', name: 'Salary negotiation', icon: 'badge-indian-rupee', desc: 'Counter an offer with confidence and evidence.',
    fields: [{ k: 'role', label: 'Role', ph: 'Product Designer' }, { k: 'offer', label: 'Current offer', ph: '24 LPA' }, { k: 'ask', label: 'Your target', ph: '28 LPA' }, { k: 'why', label: 'Your evidence', ph: 'my 6 years of fintech design experience and the 28% onboarding lift I delivered at my last company', area: true }],
    build: (f, S) => ({ subject: `${val(f.role, 'role')} offer: compensation`, paras: [
      S.t(`Thank you for the offer for the ${val(f.role, 'role')} position. I am excited about the role and the team, and I would like to discuss the compensation.`, `Thank you for the offer for the ${val(f.role, 'role')} role. I'm excited about it and would like to talk about compensation.`, `Thanks again for the offer for the ${val(f.role, 'role')} role. I'm really excited about it and wanted to talk about compensation.`),
      `The offer of ${val(f.offer, 'current offer')} is below what I was expecting. Based on ${has(f.why) ? end(f.why) : '[your experience and market data]'}, I was hoping for ${val(f.ask, 'target')}.`,
      S.t('I am confident I can deliver strong results and would be happy to discuss how we can reach an agreement that works for both sides.', 'I am confident I can add real value and hope we can find something that works for both of us.', "I'm confident I can add a lot of value and hope we can find something that works for both of us!") ] }) },
  { id: 'raise-request', group: 'job', name: 'Raise or promotion request', icon: 'trending-up', desc: 'Make your case for a raise with achievements.',
    fields: [{ k: 'role', label: 'Current role', ph: 'Senior Software Engineer' }, { k: 'wins', label: 'Your recent wins (one per line)', ph: 'Led the checkout rebuild, up 18% conversion\nMentored 4 engineers', area: true }, { k: 'ask', label: 'What you are asking for', ph: 'a salary revision and a move to Staff Engineer' }],
    build: (f, S) => ({ subject: 'Request to discuss my compensation and role', paras: [
      S.t(`I would like to schedule time to discuss my compensation and career progression. I have been in my role as ${val(f.role, 'role')} for some time and believe my contributions merit a review.`, `I'd like to set up time to talk about my compensation and growth. I've been ${val(f.role, 'role')} for a while and I think my results justify a review.`, `Could we find time to talk about my compensation and growth? I've been ${val(f.role, 'role')} for a while and I'd love to talk about what's next.`),
      has(f.wins) ? `Some highlights since my last review:\n${f.wins.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n')}` : 'Some highlights since my last review:\n- [achievement with a number]\n- [achievement with a number]',
      `I am asking for ${has(f.ask) ? end(f.ask) : '[your ask]'}, and I would appreciate your feedback on how I can continue to grow.`,
      S.t('Please let me know a convenient time to meet.', 'When would be a good time to meet?', 'When works for you?') ] }) },
  { id: 'referral-request', group: 'job', name: 'Referral request', icon: 'users', desc: 'Ask a contact to refer you for a role.',
    fields: [{ k: 'role', label: 'Role', ph: 'Product Designer' }, { k: 'company', label: 'Company', ph: 'Northwind Labs' }, { k: 'link', label: 'Job link (optional)', ph: 'https://...' }, { k: 'how', label: 'How you know them', ph: 'We worked together at Brightpath' }],
    build: (f, S) => ({ subject: `Quick favor: referral for ${val(f.role, 'role')} at ${val(f.company, 'company')}`, paras: [
      S.t(`I hope you are well. ${has(f.how) ? `${cap(end(f.how))}, and ` : ''}I am reaching out because I am interested in the ${val(f.role, 'role')} position at ${val(f.company, 'company')}.`, `Hope you're doing well. ${has(f.how) ? `${cap(end(f.how))}, so ` : ''}I wanted to reach out about the ${val(f.role, 'role')} role at ${val(f.company, 'company')}.`, `Hope you're doing great! ${has(f.how) ? `${cap(end(f.how))}, so ` : ''}I wanted to ask you something about the ${val(f.role, 'role')} role at ${val(f.company, 'company')}.`),
      `${has(f.link) ? `Here is the posting: ${f.link.trim()}\n\n` : ''}Would you be comfortable referring me? I have attached my resume and a few lines you can forward, and I completely understand if now is not a good time.`,
      S.t('Thank you for considering this. I would be glad to return the favor in any way I can.', 'Thanks for considering it. Happy to return the favor anytime.', 'Thanks a ton for even considering it. Happy to return the favor anytime!') ] }) },
  { id: 'reference-request', group: 'job', name: 'Reference request', icon: 'file-badge', desc: 'Ask a former manager or colleague to be a referee.',
    fields: [{ k: 'role', label: 'Role you are applying for', ph: 'Product Designer' }, { k: 'company', label: 'Company', ph: 'Northwind Labs' }, date('deadline', 'Needed by (optional)'), { k: 'worked', label: 'Work you did together', ph: 'the payments redesign at Brightpath' }],
    build: (f, S) => ({ subject: 'Would you be a reference for me?', paras: [
      S.t(`I hope this message finds you well. I am applying for the ${val(f.role, 'role')} position at ${val(f.company, 'company')} and would be honored if you would act as a reference.`, `I hope you're well. I'm applying for the ${val(f.role, 'role')} role at ${val(f.company, 'company')} and wondered if you'd be willing to be a reference for me.`, `Hope you're well! I'm applying for the ${val(f.role, 'role')} role at ${val(f.company, 'company')} and would love it if you could be a reference for me.`),
      `${has(f.worked) ? `I valued working with you on ${end(f.worked)}, and I think you can speak well to my work. ` : ''}I can send my resume and the job description so you know what to highlight.${has(f.deadline) ? ` The employer may contact you by ${dt(f.deadline)}.` : ''}`,
      S.t('Please let me know whether you are comfortable with this. Thank you for your support.', 'Let me know if you are comfortable with this. Thank you!', 'Let me know if you are up for it. Thank you so much!') ] }) },
  { id: 'networking', group: 'job', name: 'Networking or coffee chat', icon: 'coffee', desc: 'Reach out to someone you admire for advice.',
    fields: [{ k: 'who', label: 'Their role or company', ph: 'Head of Design at Northwind Labs' }, { k: 'why', label: 'Why them', ph: 'I read your talk on design systems at scale' }, { k: 'ask', label: 'What you want to learn', ph: 'how you moved from IC to leadership' }, { k: 'time', label: 'Time ask', ph: '20 minutes' }],
    build: (f, S) => ({ subject: `${has(f.time) ? end(f.time) + ' ' : 'Quick '}chat?`, paras: [
      S.t(`I hope you do not mind me reaching out. ${has(f.why) ? `${cap(end(f.why))}, and ` : ''}I admire your work as ${val(f.who, 'their role')}.`, `I hope you don't mind me reaching out. ${has(f.why) ? `${cap(end(f.why))}, and ` : ''}I really admire your work as ${val(f.who, 'their role')}.`, `Hope you don't mind a message out of the blue! ${has(f.why) ? `${cap(end(f.why))}, and ` : ''}I really admire your work as ${val(f.who, 'their role')}.`),
      `I am hoping to learn ${has(f.ask) ? end(f.ask) : '[what you would like advice on]'}. Would you have ${has(f.time) ? end(f.time) : '20 minutes'} in the next couple of weeks for a call or coffee? I will keep it focused and respect your time.`,
      S.t('Thank you for considering my request. I understand if your schedule is full.', 'Thanks for considering it, and no worries if you are busy.', 'Thanks for considering it, and no worries at all if you are swamped!') ] }) },
  { id: 'reconnect', group: 'job', name: 'Reconnect with a contact', icon: 'refresh-cw', desc: 'Restart a conversation after a long gap.',
    fields: [{ k: 'last', label: 'When you last spoke', ph: 'at the 2023 design summit' }, { k: 'update', label: 'Update about you', ph: 'I recently joined Northwind Labs as a Senior Designer' }, { k: 'ask', label: 'What you would like', ph: 'catch up over a call next week' }],
    build: (f, S) => ({ subject: 'It has been a while', paras: [
      S.t(`I hope you are doing well. It has been a while since we last spoke${has(f.last) ? `, ${end(f.last)}` : ''}.`, `I hope you're doing well. It's been a while since we last spoke${has(f.last) ? `, ${end(f.last)}` : ''}.`, `Hope you're doing well! It's been way too long since we last spoke${has(f.last) ? `, ${end(f.last)}` : ''}.`),
      `${has(f.update) ? `${cap(end(f.update))}. ` : ''}I would love to hear what you have been working on.`,
      `${has(f.ask) ? `Would you be open to ${end(f.ask)}?` : 'Would you be open to catching up soon?'}`, S.t('I look forward to hearing from you.', 'Hope to hear from you soon.', 'Would love to hear from you!') ] }) },

  // ---------- Everyday work ----------
  { id: 'meeting-request', group: 'work', name: 'Meeting request', icon: 'calendar-plus', desc: 'Ask for time with a clear purpose and options.',
    fields: [{ k: 'topic', label: 'Topic', ph: 'Q4 roadmap priorities' }, { k: 'len', label: 'Duration', ph: '30 minutes' }, { k: 'times', label: 'Times that work (one per line)', ph: 'Tuesday 11:00\nWednesday 15:00', area: true }, { k: 'agenda', label: 'Agenda (optional)', ph: 'Review draft roadmap\nDecide on owners', area: true }],
    build: (f, S) => ({ subject: `Meeting request: ${val(f.topic, 'topic')}`, paras: [
      S.t(`I would like to schedule a${has(f.len) ? ` ${end(f.len)}` : ''} meeting to discuss ${val(f.topic, 'topic')}.`, `Could we find${has(f.len) ? ` ${end(f.len)}` : ' some time'} to talk about ${val(f.topic, 'topic')}?`, `Do you have${has(f.len) ? ` ${end(f.len)}` : ' a bit of time'} to chat about ${val(f.topic, 'topic')}?`),
      has(f.agenda) ? `Proposed agenda:\n${f.agenda.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n')}` : '',
      has(f.times) ? `These times work for me:\n${f.times.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n')}` : 'Please suggest a time that suits you.',
      S.t('Please let me know which option suits you, or suggest an alternative.', 'Let me know what works, or suggest another time.', 'Pick whatever works, or suggest another time!') ] }) },
  { id: 'meeting-reschedule', group: 'work', name: 'Reschedule a meeting', icon: 'calendar-clock', desc: 'Move a meeting without causing friction.',
    fields: [{ k: 'meeting', label: 'Meeting', ph: 'our 1:1 on Thursday at 15:00' }, { k: 'reason', label: 'Reason (optional)', ph: 'a client call has come up' }, { k: 'times', label: 'New options (one per line)', ph: 'Friday 10:00\nMonday 14:00', area: true }],
    build: (f, S) => ({ subject: `Rescheduling: ${val(f.meeting, 'meeting')}`, paras: [
      S.t(`I apologize, but I need to reschedule ${val(f.meeting, 'meeting')}${has(f.reason) ? ` because ${end(f.reason)}` : ''}.`, `I need to reschedule ${val(f.meeting, 'meeting')}${has(f.reason) ? ` because ${end(f.reason)}` : ''}. Sorry about that.`, `Sorry, I need to move ${val(f.meeting, 'meeting')}${has(f.reason) ? ` because ${end(f.reason)}` : ''}.`),
      has(f.times) ? `Would any of these work instead?\n${f.times.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n')}` : 'Could you suggest a few times that suit you?',
      S.t('Thank you for your flexibility.', 'Thanks for being flexible.', 'Thanks for being flexible!') ] }) },
  { id: 'meeting-follow-up', group: 'work', name: 'Meeting follow-up', icon: 'clipboard-list', desc: 'Send a recap with decisions and next steps.',
    fields: [{ k: 'meeting', label: 'Meeting', ph: 'Q4 roadmap sync' }, { k: 'decisions', label: 'Decisions (one per line)', ph: 'Ship search in November\nPause the mobile redesign', area: true }, { k: 'actions', label: 'Action items (one per line)', ph: 'Priya: draft spec by Friday\nRahul: estimate effort', area: true }],
    build: (f, S) => ({ subject: `Recap: ${val(f.meeting, 'meeting')}`, paras: [
      S.t(`Thank you for attending ${val(f.meeting, 'the meeting')}. Here is a summary of what we agreed.`, `Thanks for joining ${val(f.meeting, 'the meeting')}. Here's a quick recap.`, `Thanks for joining ${val(f.meeting, 'the meeting')}! Quick recap below.`),
      `Decisions:\n${has(f.decisions) ? f.decisions.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n') : '- [decision]'}`,
      `Action items:\n${has(f.actions) ? f.actions.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n') : '- [owner: task by date]'}`,
      S.t('Please reply if I have missed or misstated anything.', 'Reply if I missed anything.', 'Shout if I missed anything!') ] }) },
  { id: 'status-update', group: 'work', name: 'Project status update', icon: 'activity', desc: 'Progress, blockers and next steps in one email.',
    fields: [{ k: 'project', label: 'Project', ph: 'Checkout rebuild' }, { k: 'status', label: 'Overall status', ph: 'On track' }, { k: 'done', label: 'Done this week (one per line)', ph: 'Payment form shipped to staging\nLoad tests passed', area: true }, { k: 'next', label: 'Next (one per line)', ph: 'Security review\nRollout plan', area: true }, { k: 'blockers', label: 'Blockers or risks', ph: 'Waiting on legal sign-off for the new terms', area: true }],
    build: (f, S) => ({ subject: `Status update: ${val(f.project, 'project')} (${has(f.status) ? end(f.status) : 'status'})`, paras: [
      S.t(`Please find below the latest status of ${val(f.project, 'project')}. Overall status: ${has(f.status) ? end(f.status) : '[status]'}.`, `Here's the latest on ${val(f.project, 'project')}. Overall: ${has(f.status) ? end(f.status) : '[status]'}.`, `Here's where ${val(f.project, 'project')} stands. Overall: ${has(f.status) ? end(f.status) : '[status]'}.`),
      `Done:\n${has(f.done) ? f.done.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n') : '- [completed item]'}`,
      `Next:\n${has(f.next) ? f.next.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n') : '- [upcoming item]'}`,
      `Blockers and risks: ${has(f.blockers) ? end(f.blockers) + '.' : 'None at the moment.'}`,
      S.t('Please let me know if you would like more detail on any point.', 'Happy to give more detail on anything.', 'Happy to dig into anything you want!') ] }) },
  { id: 'thank-you', group: 'work', name: 'Thank you', icon: 'heart', desc: 'Appreciate a colleague, manager or client.',
    fields: [{ k: 'for', label: 'What you are thanking them for', ph: 'staying late to help us ship the release' }, { k: 'impact', label: 'The impact', ph: 'We launched on time and customers noticed' }],
    build: (f, S) => ({ subject: 'Thank you', paras: [
      S.t(`I wanted to sincerely thank you for ${val(f.for, 'what they did')}.`, `I wanted to say thank you for ${val(f.for, 'what they did')}.`, `Thank you so much for ${val(f.for, 'what they did')}!`),
      has(f.impact) ? `${cap(end(f.impact))}. It made a real difference.` : 'It made a real difference.',
      S.t('I truly appreciate your effort and support.', 'I really appreciate it.', 'I really appreciate you!') ] }) },
  { id: 'apology', group: 'work', name: 'Apology for a mistake', icon: 'hand-heart', desc: 'Own the mistake and say how you will fix it.',
    fields: [{ k: 'what', label: 'What went wrong', ph: 'I sent the report with last month\'s numbers' }, { k: 'fix', label: 'How you will fix it', ph: 'The corrected report is attached and I have added a review step' }],
    build: (f, S) => ({ subject: 'My apologies and the fix', paras: [
      `${S.sorry} for ${has(f.what) ? end(f.what) : '[what went wrong]'}. ${S.t('This was my responsibility, and I understand the inconvenience it caused.', 'That was on me.', 'That was my mistake.')}`,
      `${has(f.fix) ? `${cap(end(f.fix))}.` : '[What you have done to fix it.]'} I will make sure it does not happen again.`,
      S.t('Thank you for your patience and understanding.', 'Thanks for your patience.', 'Thanks for bearing with me.') ] }) },
  { id: 'out-of-office', group: 'work', name: 'Out of office reply', icon: 'plane-takeoff', desc: 'An automatic reply with dates and a backup.', noTo: true,
    fields: [date('from', 'Away from'), date('back', 'Back on'), { k: 'backup', label: 'Backup contact', ph: 'Rahul Verma (rahul@example.com)' }, { k: 'urgent', label: 'Urgent matters', ph: 'please call +91 98765 43210' }],
    build: (f, S) => ({ subject: `Out of office${has(f.back) ? ` until ${dt(f.back)}` : ''}`, noGreet: true, paras: [
      S.t('Thank you for your email.', 'Thanks for your message.', 'Thanks for your email!'),
      `I am out of the office${has(f.from) ? ` from ${dt(f.from)}` : ''}${has(f.back) ? ` and will return on ${dt(f.back)}` : ''} with limited access to email. I will reply when I am back.`,
      `${has(f.backup) ? `For anything that cannot wait, please contact ${end(f.backup)}.` : ''}${has(f.urgent) ? ` For urgent matters, ${end(f.urgent)}.` : ''}`.trim() ] }) },
  { id: 'introduction', group: 'work', name: 'Introduce two people', icon: 'link-2', desc: 'A double opt-in introduction that respects both.', noTo: true,
    fields: [{ k: 'a', label: 'Person A', ph: 'Priya Sharma' }, { k: 'aInfo', label: 'About A', ph: 'Head of Design at Northwind Labs' }, { k: 'b', label: 'Person B', ph: 'Rahul Verma' }, { k: 'bInfo', label: 'About B', ph: 'founder of a fintech startup' }, { k: 'why', label: 'Why they should talk', ph: 'you are both thinking about design systems for payments' }],
    build: (f, S) => ({ subject: `Intro: ${val(f.a, 'A')} and ${val(f.b, 'B')}`, noGreet: true, greeting: `${S.t('Dear', 'Hello', 'Hi')} ${val(f.a, 'A')} and ${val(f.b, 'B')},`, paras: [
      S.t('I would like to introduce the two of you, as I believe you would benefit from speaking.', "I'd like to introduce you both, because I think you'll get a lot out of talking.", "I'm excited to connect you two, because I think you'll hit it off."),
      `${val(f.a, 'A')} is ${val(f.aInfo, 'role')}. ${val(f.b, 'B')} is ${val(f.bInfo, 'role')}. ${has(f.why) ? `I thought of you both because ${end(f.why)}.` : ''}`,
      'I will let you take it from here.' ] }) },
  { id: 'deadline-extension', group: 'work', name: 'Deadline extension', icon: 'timer-reset', desc: 'Ask for more time with a concrete new date.',
    fields: [{ k: 'task', label: 'Task or deliverable', ph: 'the vendor comparison report' }, date('old', 'Current deadline'), date('newd', 'Proposed deadline'), { k: 'reason', label: 'Reason', ph: 'two vendors have not sent their quotes yet' }],
    build: (f, S) => ({ subject: `Request to extend the deadline: ${val(f.task, 'task')}`, paras: [
      S.t(`I am writing to request an extension for ${val(f.task, 'the task')}, currently due on ${dt(f.old, 'current deadline')}.`, `I'd like to ask for an extension on ${val(f.task, 'the task')}, which is due on ${dt(f.old, 'current deadline')}.`, `Could I get a little more time on ${val(f.task, 'the task')}? It's due on ${dt(f.old, 'current deadline')}.`),
      `${has(f.reason) ? `${cap(end(f.reason))}. ` : ''}I can deliver by ${dt(f.newd, 'new date')}, and I will share a progress update before then.`,
      S.t('I apologize for any inconvenience and appreciate your understanding.', 'Sorry for the trouble, and thanks for understanding.', 'Sorry about that, and thanks for understanding!') ] }) },
  { id: 'feedback-request', group: 'work', name: 'Ask for feedback', icon: 'message-square-heart', desc: 'Get useful, specific feedback from a manager or peer.',
    fields: [{ k: 'about', label: 'What you want feedback on', ph: 'the product launch presentation' }, { k: 'focus', label: 'What to focus on', ph: 'clarity of the story and how I handled questions' }, date('by', 'Needed by (optional)')],
    build: (f, S) => ({ subject: `Could I get your feedback on ${val(f.about, 'my work')}?`, paras: [
      S.t(`I would value your feedback on ${val(f.about, 'my work')}. As someone whose opinion I respect, your perspective would help me improve.`, `I'd appreciate your feedback on ${val(f.about, 'my work')}. I respect your opinion and think it would help me improve.`, `Would you mind giving me some feedback on ${val(f.about, 'my work')}? I really trust your eye and it would help me a lot.`),
      `${has(f.focus) ? `I am especially interested in ${end(f.focus)}. ` : ''}Even a few quick notes would be useful.${has(f.by) ? ` If possible, by ${dt(f.by)}.` : ''}`,
      S.t('Thank you for your time and candor.', 'Thanks for your time.', 'Thanks a lot, and be honest!') ] }) },
  { id: 'handover', group: 'work', name: 'Work handover note', icon: 'package-open', desc: 'Pass your work to a colleague without dropping anything.',
    fields: [{ k: 'to2', label: 'Who takes over', ph: 'Rahul' }, { k: 'items', label: 'What is being handed over (one per line)', ph: 'Weekly vendor report: every Monday\nClient X escalations', area: true }, { k: 'docs', label: 'Where the details are', ph: 'the shared drive under Handover/Aarav' }, date('until', 'I am reachable until')],
    build: (f, S) => ({ subject: 'Handover notes', paras: [
      S.t(`As discussed, I am handing over my responsibilities to ${val(f.to2, 'colleague')}. Below is a summary to ensure continuity.`, `I'm handing my work over to ${val(f.to2, 'colleague')}. Here's what you need to know.`, `Here are my handover notes for ${val(f.to2, 'colleague')}. I've tried to cover everything!`),
      `Items:\n${has(f.items) ? f.items.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n') : '- [item and where it stands]'}`,
      `${has(f.docs) ? `Full details are in ${end(f.docs)}. ` : ''}${has(f.until) ? `I am available for questions until ${dt(f.until)}.` : 'Please ask me anything that is unclear.'}`,
      S.t('Thank you for taking this on.', 'Thanks for picking this up.', 'Thanks so much for taking this on!') ] }) },
  { id: 'congratulations', group: 'work', name: 'Congratulations', icon: 'party-popper', desc: 'Celebrate a promotion, launch or milestone.',
    fields: [{ k: 'what', label: 'What happened', ph: 'your promotion to Head of Design' }, { k: 'note', label: 'A personal note (optional)', ph: 'It is so well deserved after the year you have had' }],
    build: (f, S) => ({ subject: 'Congratulations!', paras: [
      S.t(`Congratulations on ${val(f.what, 'your news')}. This is a wonderful achievement.`, `Congratulations on ${val(f.what, 'your news')}! Great news.`, `Huge congratulations on ${val(f.what, 'your news')}!`),
      has(f.note) ? `${cap(end(f.note))}.` : '',
      S.t('Wishing you continued success.', 'Wishing you all the best.', 'So happy for you!') ] }) },
  { id: 'welcome', group: 'work', name: 'Welcome a new teammate', icon: 'hand-metal', desc: 'A warm first-day message with the practical bits.',
    fields: [{ k: 'role', label: 'Their role', ph: 'Product Designer' }, date('start', 'Start date'), { k: 'first', label: 'First week plan', ph: 'Meet the team on Monday, tooling setup on Tuesday', area: true }, { k: 'buddy', label: 'Buddy', ph: 'Rahul will be your onboarding buddy' }],
    build: (f, S) => ({ subject: `Welcome to the team${has(f.start) ? `, starting ${dt(f.start)}` : ''}`, paras: [
      S.t(`On behalf of the team, I would like to welcome you as our new ${val(f.role, 'role')}${has(f.start) ? `, starting ${dt(f.start)}` : ''}.`, `Welcome to the team! We're glad you're joining as our new ${val(f.role, 'role')}${has(f.start) ? ` on ${dt(f.start)}` : ''}.`, `Welcome aboard! We're so happy you're joining as our new ${val(f.role, 'role')}${has(f.start) ? ` on ${dt(f.start)}` : ''}.`),
      `${has(f.first) ? `Your first week: ${end(f.first)}. ` : ''}${has(f.buddy) ? `${cap(end(f.buddy))}.` : ''}`.trim(),
      S.t('Please do not hesitate to ask if you need anything before you start.', 'Ask me anything before you start.', 'Ask me anything, anytime!') ] }) },

  // ---------- Business and service ----------
  { id: 'complaint', group: 'business', name: 'Complaint', icon: 'octagon-alert', desc: 'Raise a service or product problem clearly.',
    fields: [{ k: 'company', label: 'Company or service', ph: 'Swift Courier' }, { k: 'ref', label: 'Order or reference number', ph: 'SC-2284' }, { k: 'issue', label: 'What went wrong', ph: 'my parcel arrived damaged and 5 days late', area: true }, { k: 'want', label: 'What you want', ph: 'a replacement or a full refund' }, date('by', 'Reply by (optional)')],
    build: (f, S) => ({ subject: `Complaint${has(f.ref) ? `: ${end(f.ref)}` : ''}`, paras: [
      S.t(`I am writing to make a formal complaint about ${val(f.company, 'your service')}${has(f.ref) ? ` (reference ${end(f.ref)})` : ''}.`, `I'm writing to complain about ${val(f.company, 'your service')}${has(f.ref) ? ` (reference ${end(f.ref)})` : ''}.`, `I'm writing about a problem with ${val(f.company, 'your service')}${has(f.ref) ? ` (reference ${end(f.ref)})` : ''}.`),
      `The problem: ${has(f.issue) ? end(f.issue) : '[describe what went wrong]'}.`,
      `${has(f.want) ? `I would like ${end(f.want)}.` : 'I would like this resolved.'}${has(f.by) ? ` Please respond by ${dt(f.by)}.` : ''}`,
      S.t('I trust you will treat this matter with the urgency it deserves.', 'I hope we can sort this out quickly.', 'I hope we can sort this out quickly. Thanks for your help.') ] }) },
  { id: 'refund-request', group: 'business', name: 'Refund request', icon: 'receipt', desc: 'Ask for your money back with the details they need.',
    fields: [{ k: 'order', label: 'Order number', ph: '#48213' }, { k: 'amount', label: 'Amount', ph: 'Rs. 4,999' }, date('date', 'Purchase date'), { k: 'reason', label: 'Reason', ph: 'the product stopped working after two days' }],
    build: (f, S) => ({ subject: `Refund request: order ${val(f.order, 'order number')}`, paras: [
      S.t(`I am writing to request a refund of ${val(f.amount, 'amount')} for order ${val(f.order, 'number')}${has(f.date) ? `, placed on ${dt(f.date)}` : ''}.`, `I'd like to request a refund of ${val(f.amount, 'amount')} for order ${val(f.order, 'number')}${has(f.date) ? ` from ${dt(f.date)}` : ''}.`, `I'd like to ask for a refund of ${val(f.amount, 'amount')} for order ${val(f.order, 'number')}${has(f.date) ? ` (bought on ${dt(f.date)})` : ''}.`),
      `${has(f.reason) ? `The reason: ${end(f.reason)}.` : '[Reason for the refund.]'} Please refund the amount to the original payment method.`,
      S.t('Kindly confirm once the refund has been processed. Thank you.', 'Please confirm when it is processed. Thank you.', 'Please let me know once it is on its way. Thanks!') ] }) },
  { id: 'payment-reminder', group: 'business', name: 'Payment reminder', icon: 'banknote', desc: 'Chase an overdue invoice without burning the relationship.',
    fields: [{ k: 'invoice', label: 'Invoice number', ph: 'INV-0042' }, { k: 'amount', label: 'Amount due', ph: 'Rs. 1,18,000' }, date('due', 'Original due date'), { k: 'pay', label: 'How to pay', ph: 'bank transfer to the account on the invoice, or UPI to aarav@upi' }],
    build: (f, S) => ({ subject: `Payment reminder: invoice ${val(f.invoice, 'number')}`, paras: [
      S.t(`I hope you are well. This is a reminder that invoice ${val(f.invoice, 'number')} for ${val(f.amount, 'amount')}${has(f.due) ? `, which was due on ${dt(f.due)},` : ''} remains unpaid.`, `Hope you're well. A quick reminder that invoice ${val(f.invoice, 'number')} for ${val(f.amount, 'amount')}${has(f.due) ? ` (due ${dt(f.due)})` : ''} is still open.`, `Hope you're doing well! Just a friendly nudge that invoice ${val(f.invoice, 'number')} for ${val(f.amount, 'amount')}${has(f.due) ? ` (due ${dt(f.due)})` : ''} is still open.`),
      `${has(f.pay) ? `You can pay by ${end(f.pay)}. ` : ''}If you have already paid, please ignore this message and share the payment reference so I can match it.`,
      S.t('Please let me know when I can expect payment. Thank you for your prompt attention.', 'Please let me know when to expect it. Thank you.', 'Let me know if anything is holding it up. Thanks!') ] }) },
  { id: 'quotation-request', group: 'business', name: 'Quotation request', icon: 'calculator', desc: 'Ask a supplier for a clear, comparable quote.',
    fields: [{ k: 'items', label: 'What you need (one per line)', ph: '200 branded notebooks, A5\n50 tote bags', area: true }, date('by', 'Need it by'), { k: 'ask', label: 'Quote should include', ph: 'unit price, delivery cost, lead time and payment terms' }],
    build: (f, S) => ({ subject: 'Request for quotation', paras: [
      S.t('We are interested in purchasing the following and would appreciate a quotation.', "We'd like a quote for the following.", "We're looking for a quote on the following."),
      has(f.items) ? f.items.split('\n').filter((x) => x.trim()).map((x) => `- ${x.replace(/^[\s\-•*]+/, '').trim()}`).join('\n') : '- [item and quantity]',
      `${has(f.ask) ? `Please include ${end(f.ask)}. ` : ''}${has(f.by) ? `We need the goods by ${dt(f.by)}.` : ''}`.trim(),
      S.t('We look forward to your response.', 'Looking forward to your quote.', 'Thanks, looking forward to it!') ] }) },
  { id: 'event-invite', group: 'business', name: 'Event invitation', icon: 'ticket', desc: 'Invite colleagues or clients with all the details.',
    fields: [{ k: 'event', label: 'Event', ph: 'Annual customer meetup' }, date('date', 'Date'), { k: 'time', label: 'Time', ph: '5 to 8 PM' }, { k: 'venue', label: 'Venue or link', ph: 'Taj Westend, Bengaluru' }, { k: 'rsvp', label: 'RSVP by', ph: 'next Friday' }],
    build: (f, S) => ({ subject: `You are invited: ${val(f.event, 'event')}`, paras: [
      S.t(`You are cordially invited to ${val(f.event, 'our event')}.`, `We'd like to invite you to ${val(f.event, 'our event')}.`, `You're invited to ${val(f.event, 'our event')}!`),
      `When: ${dt(f.date, 'date')}${has(f.time) ? `, ${end(f.time)}` : ''}\nWhere: ${val(f.venue, 'venue')}`,
      `${has(f.rsvp) ? `Please RSVP by ${end(f.rsvp)}.` : 'Please RSVP so we can plan.'}`, S.t('We hope you can join us.', 'Hope you can make it.', 'Would be great to see you there!') ] }) },
  { id: 'collaboration', group: 'business', name: 'Collaboration proposal', icon: 'handshake', desc: 'Pitch a partnership in a few clear lines.',
    fields: [{ k: 'who', label: 'Their company or project', ph: 'Northwind Labs' }, { k: 'idea', label: 'Your idea', ph: 'a joint webinar on payment security for small businesses' }, { k: 'benefit', label: 'What is in it for them', ph: 'access to our 12,000 subscribers and shared lead generation' }, { k: 'next', label: 'Suggested next step', ph: 'a 20 minute call next week' }],
    build: (f, S) => ({ subject: `Collaboration idea: ${val(f.who, 'company')} x ${has(f.company) ? f.company.trim() : 'us'}`, paras: [
      S.t(`I am reaching out with a proposal for a collaboration between our organizations.`, `I'd like to suggest a collaboration with ${val(f.who, 'your team')}.`, `I've got an idea I think ${val(f.who, 'your team')} might like.`),
      `The idea: ${has(f.idea) ? end(f.idea) : '[your idea]'}. ${has(f.benefit) ? `For you, that means ${end(f.benefit)}.` : ''}`,
      `${has(f.next) ? `Would you be open to ${end(f.next)}?` : 'Would you be open to a short call to explore it?'}`, S.t('Thank you for considering this.', 'Thanks for considering it.', 'Thanks for reading, and no pressure either way!') ] }) },
  { id: 'escalation', group: 'business', name: 'Escalation', icon: 'arrow-up-circle', desc: 'Escalate an unresolved issue with the facts.',
    fields: [{ k: 'issue', label: 'The issue', ph: 'our API outage ticket has had no response for 4 days' }, { k: 'ref', label: 'Ticket or reference', ph: 'TCK-90812' }, { k: 'tried', label: 'What has been tried', ph: 'three emails and two calls to support', area: true }, { k: 'ask', label: 'What you need now', ph: 'a named owner and an update by end of day' }],
    build: (f, S) => ({ subject: `Escalation${has(f.ref) ? `: ${end(f.ref)}` : ''}`, paras: [
      S.t('I am escalating this matter as it remains unresolved despite earlier attempts.', "I'm escalating this because it's still unresolved.", "I'm sorry to escalate, but this is still unresolved."),
      `The issue: ${has(f.issue) ? end(f.issue) : '[issue]'}${has(f.ref) ? ` (${end(f.ref)})` : ''}.\nWhat has been tried: ${has(f.tried) ? end(f.tried) : '[steps taken]'}.`,
      `${has(f.ask) ? `What I need now: ${end(f.ask)}.` : 'I need a named owner and a timeline.'}`, S.t('I would appreciate your urgent attention to this.', 'Thanks for looking into this urgently.', 'Thanks for helping get this moving.') ] }) },
]

export const getTemplate = (id) => TEMPLATES.find((t) => t.id === id)

/** Build the final email for a template. */
export function composeEmail(tpl, f, tone = 'neutral') {
  const S = style(tone, f)
  const r = tpl.build(f, S)
  const greeting = r.greeting || (r.noGreet ? '' : S.greet)
  const sign = has(f.from) ? f.from.trim() : '[Your name]'
  const body = [greeting, ...r.paras.filter((p) => p && p.trim()), `${S.close(tpl.group === 'job' ? 'warm' : 'neutral')}\n${sign}`].filter(Boolean).join('\n\n')
  return { subject: r.subject.replace(/\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/g, ''), body }
}
