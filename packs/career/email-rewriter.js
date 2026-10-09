// Email rewriter (AI): Claude rewrites an email with tone and length presets and you compare it with the original side by side
// or inline. Without a key you still get an instant local check (wordy phrases, pushy wording, tone signals) with one-click fixes.
import { h, icon, button, busy, toast, alert, segmented, field, input, textarea, clear, copyText, errorMessage } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { diff } from '../../lib/libs.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, burst, chip } from './_kit.js'

export const TONES = [
  ['professional', 'Professional', 'clear, courteous and businesslike'],
  ['friendly', 'Friendly', 'warm, approachable and conversational while still professional'],
  ['polite', 'Extra polite', 'very courteous, softening requests and showing appreciation'],
  ['formal', 'Formal', 'formal and respectful, suitable for senior people, institutions or official matters'],
  ['assertive', 'Assertive', 'confident and direct without being rude, with clear asks and deadlines'],
  ['empathetic', 'Empathetic', 'understanding and caring, acknowledging the other person\'s situation'],
  ['casual', 'Casual', 'relaxed and brief, like a message to a colleague you know well'],
  ['persuasive', 'Persuasive', 'compelling, benefit-focused and action-oriented'],
]
const LENGTHS = [['shorter', 'Shorter'], ['same', 'Same length'], ['longer', 'Longer']]

const FIXES = [
  [/\bin order to\b/gi, 'to', 'Wordy: "in order to"', true],
  [/\bat this point in time\b/gi, 'now', 'Wordy: "at this point in time"', true],
  [/\bdue to the fact that\b/gi, 'because', 'Wordy: "due to the fact that"', true],
  [/\bin the event that\b/gi, 'if', 'Wordy: "in the event that"', true],
  [/\bfor the purpose of\b/gi, 'for', 'Wordy: "for the purpose of"', true],
  [/\bis able to\b/gi, 'can', 'Wordy: "is able to"', true],
  [/\bin spite of the fact that\b/gi, 'although', 'Wordy: "in spite of the fact that"', true],
  [/\bkindly revert back\b/gi, 'please reply', 'Unclear: "kindly revert back"', true],
  [/\b(?<!kindly )revert back\b/gi, 'reply', 'Unclear: "revert back"', true],
  [/\bdo the needful\b/gi, 'take care of this', 'Vague: "do the needful"', true],
  [/\bplease find attached\b/gi, "I've attached", 'Stiff: "please find attached"', true],
  [/\bas per my last email\b/gi, 'as I mentioned earlier', 'Can read as passive-aggressive: "as per my last email"', true],
  [/\bI would like to take this opportunity to\b/gi, 'I want to', 'Wordy opener', true],
  [/ {2,}/g, ' ', 'Extra spaces', true],
  [/\bASAP\b/g, null, 'Pushy: "ASAP" has no date. Give a deadline instead.', false],
  [/\bjust (?:wanted|writing|checking|following)\b/gi, null, 'Hedging: "just" makes you sound unsure', false],
  [/\b(?:sorry to bother you|i hope you don't mind|if it's not too much trouble)\b/gi, null, 'Over-apologizing', false],
  [/!{2,}/g, null, 'Multiple exclamation marks', false],
  [/\b[A-Z]{5,}\b/g, null, 'ALL CAPS words can feel like shouting', false],
  [/\bhope this email finds you well\b/gi, null, 'Cliche opener, consider getting to the point', false],
]

/** Local email check. Returns {words, sentences, avgSentence, issues:[{label, count, auto}], tone}. */
export function quickCheck(text) {
  const words = (text.match(/\S+/g) || []).length
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length
  const issues = []
  for (const [re, rep, label, auto] of FIXES) {
    const n = (text.match(re) || []).length
    if (n) issues.push({ label, count: n, auto: !!auto })
  }
  const long = text.split(/(?<=[.!?])\s+/).filter((s) => s.split(/\s+/).length > 30).length
  if (long) issues.push({ label: 'Very long sentences (over 30 words)', count: long, auto: false })
  const passive = (text.match(/\b(?:was|were|is|are|been|be|being)\s+\w+ed\b/gi) || []).length
  if (passive > 2) issues.push({ label: 'Passive voice makes it sound distant', count: passive, auto: false })
  if (words && !/^(?:hi|hello|dear|hey|good (?:morning|afternoon|evening))\b/i.test(text.trim())) issues.push({ label: 'No greeting', count: 1, auto: false })
  if (words > 20 && !/\b(?:regards|thanks|thank you|sincerely|best|cheers|yours)\b/i.test(text.slice(-120))) issues.push({ label: 'No sign-off', count: 1, auto: false })
  const formal = (text.match(/\b(?:dear|sincerely|regards|kindly|please|pursuant|herewith|respectfully)\b/gi) || []).length
  const casual = (text.match(/\b(?:hey|hi|thanks|cheers|yeah|gonna|wanna|btw|asap|lol)\b|!/gi) || []).length
  return { words, sentences, avgSentence: sentences ? Math.round(words / sentences) : 0, issues, tone: formal > casual + 1 ? 'Formal' : casual > formal + 1 ? 'Casual' : 'Neutral' }
}
export function applyFixes(text) {
  let t = text
  for (const [re, rep, , auto] of FIXES) if (auto && rep !== null) t = t.replace(re, rep)
  return t.replace(/ +([,.!?])/g, '$1').replace(/^(\s*)([a-z])/, (m, a, b) => a + b.toUpperCase())
}

const SAMPLE = `hi john,

just wanted to check if you did the needful regarding the report i sent last week. as per my last email we need it ASAP because the client is waiting and it is really urgent!!! please find attached the template again in order to make things easier. kindly revert back today

thanks`

export async function mount(root, { signal }) {
  const prev = load('rewriter:state', {})
  const st = { tone: prev.tone || 'professional', length: prev.length || 'same', extra: prev.extra || '', view: 'rewrite' }
  const src = textarea({ rows: 13, placeholder: 'Paste the email you want to improve...', value: prev.text || '' })
  const extra = input({ placeholder: 'Optional: e.g. keep it under 80 words, mention the Friday deadline', value: st.extra })
  const out = textarea({ rows: 13, readonly: true, placeholder: 'Your rewritten email appears here.' })
  const viewHost = h('div')
  const checkHost = h('div')
  const stats = h('span', { class: 'small muted' })
  let result = ''
  const keep = () => save('rewriter:state', { text: src.value.slice(0, 20000), tone: st.tone, length: st.length, extra: extra.value })

  const toneChips = h('div', { class: 'cr-chips' })
  const drawTones = () => clear(toneChips, TONES.map(([id, label]) => h('button', { type: 'button', class: 'cr-chip btn-chip', 'aria-pressed': String(st.tone === id), onclick: () => { st.tone = id; drawTones(); keep() } }, label)))
  drawTones()
  const lenSeg = segmented(LENGTHS, st.length, (v) => { st.length = v; keep() }, 'Length')

  function drawCheck() {
    const c = quickCheck(src.value)
    if (!c.words) { clear(checkHost, h('div', { class: 'small muted' }, 'Paste an email to see an instant check.')); return }
    const autos = c.issues.filter((i) => i.auto).length
    clear(checkHost, h('div', { class: 'stack tight' },
      h('div', { class: 'cr-chips' }, chip(`${c.words} words`, 'info'), chip(`${c.sentences} sentences, ${c.avgSentence} words each`, 'info'), chip(`Reads ${c.tone.toLowerCase()}`, 'info')),
      c.issues.length ? h('ul', { class: 'list-plain', style: 'display:grid;gap:6px;font-size:13.5px' }, c.issues.slice(0, 8).map((i) => h('li', { class: 'row', style: 'gap:8px;flex-wrap:nowrap' }, icon('triangle-alert'), h('span', i.label + (i.count > 1 ? ` (x${i.count})` : ''))))) : alert('success', 'No obvious problems found.'),
      autos ? button(`Fix ${autos} simple issue${autos > 1 ? 's' : ''} automatically`, { icon: 'wand-sparkles', variant: 'secondary', size: 'sm', onClick: () => { src.value = applyFixes(src.value); keep(); drawCheck(); toast('Applied the simple fixes', 'success') } }) : null))
  }
  src.addEventListener('input', () => { keep(); drawCheck() })
  extra.addEventListener('input', keep)

  const D = (s) => h('span', s)
  async function drawView() {
    if (!result) { clear(viewHost, h('div', { class: 'empty' }, icon('arrow-right-left'), h('div', 'Your rewrite and the comparison will show up here.'))); return }
    if (st.view === 'rewrite') { out.value = result; clear(viewHost, out); return }
    const { diffWords } = await diff()
    const parts = diffWords(src.value, result)
    const left = parts.filter((p) => !p.added).map((p) => (p.removed ? h('del', p.value) : D(p.value)))
    const right = parts.filter((p) => !p.removed).map((p) => (p.added ? h('ins', p.value) : D(p.value)))
    if (st.view === 'side') clear(viewHost, h('div', { class: 'grid-2' }, h('div', { class: 'cr-diff' }, h('div', { class: 'cr-diff-h' }, 'Original'), h('div', left)), h('div', { class: 'cr-diff' }, h('div', { class: 'cr-diff-h' }, 'Rewrite'), h('div', right))))
    else clear(viewHost, h('div', { class: 'cr-diff' }, h('div', { class: 'cr-diff-h' }, 'Changes'), h('div', parts.map((p) => (p.added ? h('ins', p.value) : p.removed ? h('del', p.value) : D(p.value))))))
  }
  const viewSeg = segmented([['rewrite', 'Rewrite'], ['side', 'Side by side'], ['inline', 'Changes']], st.view, (v) => { st.view = v; drawView() }, 'View')

  const go = button('Rewrite', { icon: 'sparkles', variant: 'primary', size: 'lg' })
  const status = h('div')
  const run = async (again = false) => {
    const text = src.value.trim()
    if (text.length < 15) { clear(status, alert('error', 'Paste an email first (at least a sentence).')); return }
    if (!(await ai.ensureKey())) return
    clear(status)
    const tone = TONES.find((t) => t[0] === st.tone)
    st.view = st.view === 'rewrite' ? 'rewrite' : st.view
    const prevResult = result
    const hadResult = !!result
    result = ''
    out.value = ''
    clear(viewHost, out)
    viewSeg.set('rewrite'); st.view = 'rewrite'
    const lenRule = { shorter: 'Make it noticeably shorter (about 30 to 50 percent fewer words) by cutting filler, not facts.', same: 'Keep roughly the same length.', longer: 'Expand it slightly with helpful context and smoother transitions, without inventing facts.' }[st.length]
    const text2 = await ai.ask({
      system: 'You are an expert business writing editor. Rewrite emails to match the requested tone and length. Preserve every fact, name, date, number and request exactly. Never invent details. Keep [placeholders] unchanged. Output only the rewritten email (subject line only if the original had one), with no commentary and no quotation marks. Do not use em dashes.',
      prompt: `Tone: ${tone[1]} (${tone[2]}).\n${lenRule}${extra.value.trim() ? `\nExtra instruction: ${extra.value.trim()}` : ''}${again && hadResult ? `\nUse clearly different wording from this previous version:\n${prevResult}` : ''}\n\nEMAIL:\n${text}`,
      effort: 'low', maxTokens: 3000, signal, onText: (t) => { out.value = t; result = t },
    })
    result = text2.trim()
    out.value = result
    stats.textContent = `${(result.match(/\S+/g) || []).length} words (original ${(text.match(/\S+/g) || []).length})`
    burst(go)
    await drawView()
  }
  go.addEventListener('click', () => busy(go, () => run(false), { label: 'Rewriting', errorTo: status }))
  const again = button('Try another version', { icon: 'refresh-cw', variant: 'secondary', size: 'sm' })
  again.addEventListener('click', () => busy(again, () => run(true), { label: 'Rewriting', errorTo: status }))

  root.append(shell(
    banner({ icon: 'pen-line', text: '<b>Same email, better words.</b> Pick a tone and length, let AI rewrite it, then compare changes word by word. Instant local checks work even without a key.', steps: ['Paste email', 'Pick tone', 'Compare'] }),
    ai.notice('Rewrites use AI'),
    h('div', { class: 'cr-work' },
      h('div', { class: 'stack' },
        card('Your email', 'mail', h('div', { class: 'stack tight' }, src, h('div', { class: 'row' }, button('Try a sample', { icon: 'sparkles', variant: 'ghost', size: 'sm', onClick: () => { src.value = SAMPLE; keep(); drawCheck() } }), button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { src.value = ''; keep(); drawCheck() } })))),
        card('Style', 'sliders-horizontal', h('div', { class: 'stack' }, field('Tone', toneChips), field('Length', lenSeg), field('Anything else? (optional)', extra))),
        h('div', { class: 'row' }, go, again),
        status),
      h('div', { class: 'stack' },
        card('Result', 'arrow-right-left', h('div', { class: 'stack tight' }, viewSeg, viewHost,
          h('div', { class: 'row between' }, stats, h('div', { class: 'row' }, button('Copy', { icon: 'copy', variant: 'secondary', size: 'sm', onClick: () => { if (result) copyText(result); else toast('Nothing to copy yet', 'error') } }), button('Use as input', { icon: 'corner-up-left', variant: 'ghost', size: 'sm', onClick: () => { if (result) { src.value = result; result = ''; keep(); drawCheck(); drawView() } } }))))),
        card('Instant check (works offline)', 'list-checks', checkHost)))))
  drawCheck()
  drawView()
}
