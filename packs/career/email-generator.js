// Email generator: 39 professional templates (leave, job search, everyday work, business) with fields, three tones, live preview,
// copy, open in your mail app (mailto) or Gmail / Outlook on the web, and an optional Claude polish.
import { h, icon, button, busy, toast, alert, segmented, field, input, textarea, clear, copyText, debounce } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, fi, getProfile, setProfile, burst, openMail, saveIndicator } from './_kit.js'
import { TEMPLATES, GROUPS, getTemplate, composeEmail } from './_emails.js'

const KEY = 'email:data'
const webLinks = ({ to, subject, body }) => ({
  gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  outlook: `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
})

export async function mount(root, { signal }) {
  const prof = getProfile()
  const store = load(KEY, {})
  const common = { from: store.from || prof.name || '' }
  const state = { tone: store.tone || 'neutral', byTpl: store.byTpl || {}, group: 'all', q: '' }
  const wanted = new URLSearchParams(location.hash.split('?')[1] || '').get('t')
  const host = h('div')
  const saved = saveIndicator('Saved on this device')
  const persist = debounce(() => { save(KEY, { from: common.from, tone: state.tone, byTpl: state.byTpl }); setProfile({ name: common.from }); saved.saved() }, 400)

  // ---------- pick ----------
  function pick() {
    const grid = h('div', { class: 'cr-masonry' })
    const chips = h('div', { class: 'cr-chips' })
    const q = input({ placeholder: `Search ${TEMPLATES.length} templates (leave, resignation, follow-up...)`, 'aria-label': 'Search templates', value: state.q })
    const draw = () => {
      const needle = state.q.trim().toLowerCase()
      const list = TEMPLATES.filter((t) => (state.group === 'all' || t.group === state.group) && (!needle || `${t.name} ${t.desc} ${t.id} ${GROUPS.find((g) => g.id === t.group).name}`.toLowerCase().includes(needle)))
      clear(grid, list.length ? list.map((t, i) => {
        const g = GROUPS.find((x) => x.id === t.group)
        const snippet = composeEmail(t, {}, 'neutral').body.split('\n\n').slice(1, 2).join(' ')
        return h('button', { type: 'button', class: 'cr-tcard', style: { '--i': Math.min(i, 14), '--cr': g.color, '--clamp': 2 + (i % 4) }, onclick: () => edit(t.id) },
          h('span', { class: 'tile', style: '--c:var(--cr)' }, icon(t.icon)), h('b', t.name), h('small', t.desc), h('span', { class: 'cr-snip' }, snippet), h('span', { class: 'cr-tag' }, g.name))
      }) : [h('div', { class: 'empty', style: 'column-span:all' }, icon('search-x'), h('div', 'No template matches that. Try a shorter word.'))])
      clear(chips, [['all', 'All', 'layout-grid'], ...GROUPS.map((g) => [g.id, g.name, g.icon])].map(([id, name, ic]) => h('button', { type: 'button', class: 'cr-chip btn-chip', 'aria-pressed': String(state.group === id), onclick: () => { state.group = id; draw() } }, icon(ic), name)))
    }
    q.addEventListener('input', () => { state.q = q.value; draw() })
    draw()
    clear(host, h('div', { class: 'stack' }, h('div', { class: 'cr-search' }, icon('search'), q), chips, grid))
  }

  // ---------- edit ----------
  function edit(id) {
    const tpl = getTemplate(id)
    if (!tpl) return pick()
    const F = (state.byTpl[id] ||= {})
    F.to ??= ''
    const view = { get from() { return common.from } }
    let edited = false
    const subject = input({ 'aria-label': 'Subject' })
    const toMail = input({ type: 'email', placeholder: 'recipient@example.com', 'aria-label': 'Recipient email', autocomplete: 'off' })
    const body = textarea({ rows: 16, 'aria-label': 'Email body' })
    const note = h('div')
    const stats = h('span', { class: 'small muted' })
    const gen = () => {
      if (edited) return
      const r = composeEmail(tpl, { ...F, from: common.from }, state.tone)
      subject.value = r.subject
      body.value = r.body
      upStats()
    }
    const upStats = () => { const w = (body.value.match(/\S+/g) || []).length; stats.textContent = `${w} words` }
    const onField = () => { saved.dirty(); persist(); gen() }
    const regen = () => { edited = false; clear(note); gen() }
    body.addEventListener('input', () => { edited = true; upStats(); clear(note, alert('info', 'You edited the email, so the fields will not overwrite it. ', h('button', { type: 'button', class: 'link', style: 'background:none;border:0;padding:0;font:inherit;cursor:pointer', onclick: regen }, 'Regenerate from the fields'), '.')) })
    const toneSeg = segmented([['formal', 'Formal'], ['neutral', 'Neutral'], ['friendly', 'Friendly']], state.tone, (v) => { state.tone = v; onField() }, 'Tone')

    const controls = [
      ...(tpl.noTo ? [] : [fi(F, 'to', 'Recipient name', { ph: 'Priya Sharma' }, onField)]),
      fi(common, 'from', 'Your name', { ph: 'Aarav Mehta', ac: 'name' }, onField),
      ...tpl.fields.map((x) => fi(F, x.k, x.label, { ph: x.ph, area: x.area, rows: 3, type: x.type }, onField)),
    ]
    const full = () => `Subject: ${subject.value}\n\n${body.value}`
    const mail = () => ({ to: toMail.value.trim(), subject: subject.value, body: body.value })
    const mk = (label, ic, variant, fn, size) => { const b = button(label, { icon: ic, variant, size }); b.addEventListener('click', fn); return b }
    const aiBtn = button('Polish with Claude', { icon: 'sparkles', variant: 'secondary', size: 'sm' })
    const aiErr = h('div')
    aiBtn.addEventListener('click', () => busy(aiBtn, async () => {
      if (!(await ai.ensureKey())) return
      if (body.value.trim().length < 20) { toast('Fill in the fields first', 'error'); return }
      edited = true
      const prev = body.value
      body.value = ''
      try {
        const text = await ai.ask({
          system: 'You edit professional emails. Keep every fact, date, name and number exactly as given. Improve clarity, flow and tone. Keep placeholders in [square brackets]. Return only the email body (greeting to signature), with no subject line and no commentary. Do not use em dashes.',
          prompt: `Tone: ${state.tone}. Situation: ${tpl.name}.\n\nSubject: ${subject.value}\n\n${prev}`, effort: 'low', maxTokens: 2000, signal, onText: (t) => { body.value = t; upStats() },
        })
        body.value = text.trim(); upStats()
        clear(note, alert('success', 'Polished by Claude. Check the details before you send. ', h('button', { type: 'button', class: 'link', style: 'background:none;border:0;padding:0;font:inherit;cursor:pointer', onclick: regen }, 'Back to the template version'), '.'))
      } catch (e) { body.value = prev; throw e }
    }, { label: 'Polishing', errorTo: aiErr }))

    clear(host, h('div', { class: 'stack' },
      h('div', { class: 'row' }, button('All templates', { icon: 'arrow-left', variant: 'ghost', size: 'sm', onClick: pick }), h('h2', { class: 'cr-h', style: 'margin:0' }, h('span', { class: 'tile' }, icon(tpl.icon)), tpl.name)),
      h('div', { class: 'cr-work' },
        h('div', { class: 'stack' }, card('Details', 'pencil-line', h('div', { class: 'stack tight' }, field('Tone', toneSeg), ...controls)),
          card('Polish with AI', 'sparkles', h('div', { class: 'stack tight' }, ai.notice('Optional: uses Claude'), h('div', { class: 'row' }, aiBtn, h('span', { class: 'small muted' }, 'Rewrites your draft with the same facts.')), aiErr))),
        h('div', { class: 'cr-sticky stack tight' }, card('Your email', 'mail', h('div', { class: 'stack tight' },
          field('To (optional, used by the mail buttons)', toMail),
          field('Subject', subject), note, field('Message', body),
          h('div', { class: 'row between' }, stats, saved.el),
          h('div', { class: 'row' },
            mk('Copy email', 'copy', 'primary', () => { copyText(full()); burst() }),
            mk('Open in mail app', 'mail-open', 'secondary', () => openMail(mail())),
            mk('Gmail', 'external-link', 'ghost', () => window.open(webLinks(mail()).gmail, '_blank', 'noopener'), 'sm'),
            mk('Outlook', 'external-link', 'ghost', () => window.open(webLinks(mail()).outlook, '_blank', 'noopener'), 'sm')),
          h('div', { class: 'row small' }, button('Copy body', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copyText(body.value) }), button('Copy subject', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copyText(subject.value) }))))))))
    gen()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  root.append(shell(
    banner({ icon: 'mail-plus', text: `<b>${TEMPLATES.length} ready-to-send emails.</b> Pick a situation, fill a few fields, choose a tone and send it from your own mail app. Nothing leaves your device until you click send.`, steps: ['Pick a template', 'Fill the blanks', 'Send or copy'] }), host))
  if (wanted && getTemplate(wanted)) edit(wanted)
  else pick()
}
