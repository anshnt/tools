// Email reply writer: paste an email, say what you want to do and in which tone, get up to three ready-to-send replies
// that you can edit, refine ("shorter", "warmer"), copy or open in your mail app.
import { h, button, field, input, select, segmented, textarea, alert, clear, panel, split, row, copyButton, icon, busy, isAbort, errorMessage, toast } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { load, save } from '../../lib/store.js'
import { injectStyle, runner, LANGUAGES, UNTRUSTED } from './_shared.js'

const INTENTS = ['Reply helpfully', 'Say yes / accept', 'Decline politely', 'Ask for more details', 'Follow up (no reply yet)', 'Say thank you', 'Apologize', 'Negotiate or counter-offer', 'Reschedule', 'Set a boundary firmly']
const TONES = [['professional', 'Professional'], ['friendly', 'Friendly'], ['concise', 'Concise'], ['warm', 'Warm'], ['firm', 'Firm']]
const SCHEMA = {
  type: 'object',
  properties: {
    email_summary: { type: 'string' },
    replies: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['label', 'subject', 'body'], additionalProperties: false } },
    check_before_sending: { type: 'array', items: { type: 'string' } },
  },
  required: ['email_summary', 'replies', 'check_before_sending'],
  additionalProperties: false,
}
const REFINE = [['Shorter', 'Make it noticeably shorter and keep the key points.'], ['Warmer', 'Make the tone warmer and more personable.'], ['More formal', 'Make it more formal and polished.'], ['More direct', 'Make it more direct: get to the point in the first sentence.']]

export function buildSystem({ tone, length, language, name }) {
  return `You write email replies that sound like a thoughtful human, not a template. ${UNTRUSTED} Tone: ${tone}. Length: ${{ short: '2 to 4 sentences', medium: 'a short paragraph or two', long: 'thorough but still scannable' }[length]}. ${language.startsWith('Same') ? 'Reply in the same language as the email.' : `Write in ${language}.`}
Rules: answer every question the sender asked; keep facts exactly as given by the user; never invent dates, prices, names or commitments that the user did not provide (use a clear [placeholder] instead); start with a greeting that uses the sender's name when it is known; end with ${name ? `the sign-off name "${name}"` : 'a simple sign-off without inventing a name'}. No subject-line prefixes beyond "Re:". Plain text only, no Markdown.`
}

export const mailto = (subject, body) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

export function mount(root, { signal }) {
  injectStyle()
  let incoming = ''
  const status = h('div')
  const results = h('div', { class: 'stack' })
  const mail = textarea({ rows: 9, placeholder: 'Paste the email you received (include the sender name if you can)...', 'aria-label': 'Email to reply to' })
  const intent = select(INTENTS, INTENTS[0])
  const points = textarea({ rows: 3, placeholder: 'Anything specific to say? e.g. "I can do Thursday 3pm, but not before. Ask them to send the contract."', 'aria-label': 'Key points to include' })
  const tone = segmented(TONES, 'professional', null, 'Tone')
  const length = segmented([['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']], 'medium', null, 'Length')
  const language = select(['Same as the email', ...LANGUAGES], 'Same as the email')
  const name = input({ placeholder: 'Your name for the sign-off', maxlength: 60, value: load('email-reply:name', ''), 'aria-label': 'Your name' })
  const count = select([['1', '1 reply'], ['2', '2 options'], ['3', '3 options']], '2')
  const go = button('Write reply', { icon: 'reply', variant: 'primary', size: 'lg' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Writing' })
  const sys = () => buildSystem({ tone: tone.value, length: length.value, language: language.value, name: name.value.trim() })

  function card(r, i) {
    const subject = input({ value: r.subject, 'aria-label': 'Subject' })
    const body = textarea({ rows: 10, value: r.body, 'aria-label': `Reply ${i + 1}` })
    const grow = () => { body.style.height = 'auto'; body.style.height = `${Math.min(body.scrollHeight + 4, 520)}px` }
    body.addEventListener('input', grow)
    queueMicrotask(grow)
    const refine = (label, instr, btnEl) => busy(btnEl, async () => {
      const out = await ai.ask({
        system: sys(), effort: 'low', signal,
        messages: [{ role: 'user', content: [ai.textBlock(`<received_email>\n${incoming}\n</received_email>\n\n<my_current_reply>\n${body.value}\n</my_current_reply>\n\nRevise my reply. ${instr} Return only the new reply body as plain text.`)] }],
      })
      body.value = out.trim(); grow()
    }, { label })
    const mailLink = h('a', { class: 'btn btn-secondary btn-sm', href: '#', onclick: (e) => { e.currentTarget.href = mailto(subject.value, body.value) } }, icon('mail'), h('span', 'Open in mail app'))
    return h('section', { class: 'panel' },
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('strong', r.label || `Option ${i + 1}`), h('span', { class: 'ai-label' }, 'Editable')),
      h('div', { class: 'stack' }, field('Subject', subject), body,
        h('div', { class: 'row', style: 'gap:8px' }, copyButton(() => body.value, 'Copy reply'), copyButton(() => `Subject: ${subject.value}\n\n${body.value}`, 'Copy with subject'), mailLink),
        h('div', { class: 'row', style: 'gap:6px' }, h('span', { class: 'small muted' }, 'Refine:'), ...REFINE.map(([l, instr]) => { const b = button(l, { size: 'sm', variant: 'ghost' }); b.addEventListener('click', () => refine(l, instr, b)); return b }))))
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    incoming = mail.value.trim()
    if (incoming.length < 10) throw new Error('Paste the email you want to reply to.')
    save('email-reply:name', name.value.trim())
    clear(results)
    const n = +count.value
    const d = await ai.ask({
      system: sys(), json: SCHEMA, effort: 'low', signal: sig,
      messages: [{ role: 'user', content: [ai.textBlock(`<received_email>\n${incoming}\n</received_email>\n\nWhat I want to do: ${intent.value}.${points.value.trim() ? `\nKey points I want included: ${points.value.trim()}` : ''}\n\nWrite ${n} ${n === 1 ? 'reply' : 'different reply options (vary the angle or structure, for example a direct one and a softer one)'}. Give each a short label. In email_summary give a one-line summary of the received email. In check_before_sending list anything I should verify (dates, amounts, promises) before sending, or leave it empty.`)] }],
    })
    const replies = (d.replies || []).filter((r) => r?.body)
    if (!replies.length) throw new Error('No reply was written. Try again with a little more detail.')
    clear(results,
      h('div', { class: 'alert info' }, icon('mail-open'), h('div', h('strong', 'The email says: '), d.email_summary)),
      ...replies.map(card),
      d.check_before_sending?.length ? alert('warn', h('strong', 'Check before sending'), h('ul', { style: 'margin:6px 0 0;padding-left:18px' }, d.check_before_sending.map((c) => h('li', c)))) : null)
  }, { label: 'Writing' }))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' },
        field('Email you received', mail),
        h('div', { class: 'grid-auto' }, field('I want to', intent), field('Options', count)),
        field('Key points (optional)', points),
        field('Tone', tone), field('Length', length),
        h('div', { class: 'grid-auto' }, field('Language', language), field('Sign-off name', name, 'Remembered on this device.')),
        row(go, run.stop), status,
        h('p', { class: 'small muted' }, 'Replies are drafts. Read them before you send, especially dates, amounts and promises.'))),
      h('div', { class: 'stack' }, results), 'wide-left')))
  clear(results, h('div', { class: 'empty' }, icon('reply'), h('strong', { style: 'color:var(--text-2)' }, 'Your reply options appear here'), h('div', 'Paste an email, pick what you want to say and the tone. You get editable replies you can copy or open in your mail app.')))
}
