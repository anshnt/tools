// AI chat: multi-turn conversation with image, PDF, Word and text attachments. Kept in memory; optionally saved on this device.
import { h, button, select, toggle, alert, clear, icon, copyText, download, isAbort, errorMessage, onCleanup } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { load, save, remove } from '../../lib/store.js'
import { injectStyle, injectChatStyle, mdSink, readSource, fileChips, DOC_ACCEPT, todayISO, UNTRUSTED } from './_shared.js'

const STORE = 'ai-chat'
const STARTERS = [
  ['Explain something simply', 'Explain how vaccines train the immune system, like I am 12.'],
  ['Draft a message', 'Write a polite message asking my landlord to fix a leaking tap.'],
  ['Plan my week', 'I have 6 hours free this weekend. Help me plan a study schedule for an exam in 10 days.'],
  ['Debug some code', 'Why does this JavaScript print undefined?\n\nconst user = { name: "A" }\nconsole.log(user.age)'],
]

export function mount(root, { signal }) {
  injectStyle()
  injectChatStyle()
  const messages = [] // API shape
  const log = [] // display + saved: {role, text, files}
  let attachments = []
  let controller = null
  let remember = load(`${STORE}:remember`, false)

  const thread = h('div', { class: 'ai-thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' })
  const status = h('div')
  const attachEl = h('div')
  const ta = h('textarea', { rows: 1, placeholder: 'Message AI. Paste or attach images, PDFs or documents.', 'aria-label': 'Message' })
  const send = button('Send', { icon: 'arrow-up', variant: 'primary' })
  const stop = button('Stop', { icon: 'square' })
  stop.hidden = true
  const fileInput = h('input', { type: 'file', multiple: true, accept: `${DOC_ACCEPT},image/*,.heic,.heif`, hidden: true, onchange: (e) => { addFiles([...e.target.files]); e.target.value = '' } })
  const attach = button('', { icon: 'paperclip', variant: 'ghost', size: 'sm', ariaLabel: 'Attach files', onClick: () => fileInput.click() })
  const modelSel = h('div')
  const clearBtn = button('New chat', { icon: 'plus', size: 'sm', onClick: () => { if (log.length && !confirm('Clear this conversation?')) return; reset() } })
  const dl = button('Download', { icon: 'download', size: 'sm', onClick: () => download(transcript(), 'chat.md', 'text/markdown') })
  const cp = button('Copy chat', { icon: 'copy', size: 'sm', onClick: () => copyText(transcript()) })
  const rememberToggle = toggle('Save this chat on this device', remember, (on) => { remember = on; save(`${STORE}:remember`, on); on ? persist() : remove(`${STORE}:log`) })

  const transcript = () => log.map((m) => `**${m.role === 'user' ? 'You' : 'AI'}:**\n\n${m.text}`).join('\n\n---\n\n')
  const persist = () => { if (remember) save(`${STORE}:log`, log.map(({ role, text, files }) => ({ role, text, files }))) }
  const scroll = () => { thread.scrollTop = thread.scrollHeight }
  const hasChat = () => log.length > 0
  const syncBar = () => { clearBtn.hidden = dl.hidden = cp.hidden = !hasChat() }

  function buildModelSel() {
    const c = ai.config()
    const cur = modelSel.firstChild?.value || ''
    clear(modelSel, select([['', `Default (${(ai.PROVIDERS[c.provider].models.find((m) => m[0] === c.model)?.[1] || c.model).split(' - ')[0]})`], ...ai.PROVIDERS[c.provider].models.map(([v, l]) => [v, l.split(' - ')[0]])], cur))
    modelSel.firstChild.setAttribute('aria-label', 'Model for this chat')
  }
  buildModelSel()
  window.addEventListener('ai-config', buildModelSel)
  signal?.addEventListener('abort', () => controller?.abort())
  onCleanup(() => window.removeEventListener('ai-config', buildModelSel))

  function bubble(role, text, files = []) {
    const body = h('div', { class: role === 'user' ? '' : 'ai-md' })
    if (role === 'user') body.textContent = text
    const acts = h('div', { class: 'ai-acts' })
    const bub = h('div', { class: 'ai-bub' }, files.length ? h('div', { class: 'ai-attached' }, files.map((f) => h('span', { class: 'ai-chip static' }, icon('paperclip'), h('span', f)))) : null, body, role === 'user' ? null : acts)
    const el = h('div', { class: ['ai-msg', role === 'user' ? 'user' : 'bot'] }, role === 'user' ? null : h('div', { class: 'ai-av' }, icon('sparkles')), bub)
    thread.append(el)
    return { el, body, acts, sink: role === 'user' ? null : mdSink(body) }
  }

  function addActions(b, getText, isLast) {
    clear(b.acts, button('Copy', { icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => copyText(getText()) }))
    if (isLast) {
      for (const old of thread.querySelectorAll('[data-regen]')) old.remove()
      b.acts.append(button('Regenerate', { icon: 'refresh-cw', size: 'sm', variant: 'ghost', onClick: regenerate, attrs: { dataset: { regen: '' } } }))
    }
  }

  function renderAll() {
    clear(thread)
    if (!log.length) {
      clear(thread, h('div', { class: 'empty', style: 'margin:auto;width:100%' }, icon('message-circle'), h('strong', { style: 'color:var(--text-2);font-size:16px' }, 'Ask anything'),
        h('div', 'Chat with AI, attach images, PDFs or documents, and copy the answers. Your conversation stays in this tab unless you save it.'),
        h('div', { class: 'ai-chips', style: 'justify-content:center;margin-top:6px' }, STARTERS.map(([label, text]) => h('button', { type: 'button', class: 'ai-chip', onclick: () => { ta.value = text; grow(); ta.focus() } }, icon('sparkles'), h('span', label))))))
      syncBar(); return
    }
    log.forEach((m, i) => {
      const b = bubble(m.role, m.text, m.files)
      if (m.role === 'assistant') { b.sink.done(m.text); addActions(b, () => m.text, i === log.length - 1) }
    })
    syncBar(); scroll()
  }

  function reset() {
    controller?.abort()
    messages.length = 0; log.length = 0; attachments = []; clear(status); remove(`${STORE}:log`)
    drawAttachments(); renderAll()
  }

  function drawAttachments() { clear(attachEl, attachments.length ? fileChips(attachments, (i) => { attachments.splice(i, 1); drawAttachments() }) : null) }

  async function addFiles(files) {
    clear(status)
    for (const f of files) {
      try {
        if (attachments.length >= 8) throw new Error('You can attach up to 8 files per message.')
        attachments.push(await readSource(f, { allow: ['pdf', 'docx', 'text', 'image'] }))
      } catch (e) { clear(status, alert('error', e.message)) }
    }
    drawAttachments()
  }

  const system = () => `You are a helpful, accurate assistant in a browser tool. Today is ${todayISO()}. Answer in Markdown: be direct, put code in fenced blocks with a language tag, and ask a brief clarifying question only when it is really needed. ${UNTRUSTED}`

  async function userContent(text, atts) {
    if (!atts.length) return text
    const blocks = []
    for (const a of atts) blocks.push(...await a.blocks({ cache: a.kind === 'pdf' }))
    blocks.push(ai.textBlock(text || 'Please look at the attached file(s).'))
    return blocks
  }

  async function respond(botBubble) {
    controller = new AbortController()
    send.hidden = true; stop.hidden = false
    let last = ''
    try {
      const text = await ai.ask({ system: system(), messages, model: modelSel.firstChild.value || undefined, signal: controller.signal, onText: (t) => { last = t; botBubble.sink.stream(t); scroll() } })
      await botBubble.sink.done(text)
      messages.push({ role: 'assistant', content: text })
      log.push({ role: 'assistant', text })
      addActions(botBubble, () => text, true)
      persist()
    } catch (e) {
      if (isAbort(e) && last) {
        await botBubble.sink.done(last)
        messages.push({ role: 'assistant', content: last }); log.push({ role: 'assistant', text: last })
        addActions(botBubble, () => last, true)
        botBubble.body.append(h('div', { class: 'ai-stopped' }, 'Stopped.'))
      } else {
        // nothing usable came back: drop the user turn so the visitor can edit and resend
        botBubble.el.remove()
        const u = log.pop(); messages.pop()
        thread.lastElementChild?.remove()
        if (u) ta.value = u.text
        grow()
        if (!isAbort(e)) clear(status, alert('error', errorMessage(e)))
        if (!log.length) renderAll()
      }
    } finally {
      controller = null; send.hidden = false; stop.hidden = true
      syncBar(); scroll(); ta.focus({ preventScroll: true })
    }
  }

  async function submit() {
    const text = ta.value.trim()
    if (controller || (!text && !attachments.length)) return
    if (!(await ai.ensureKey())) return
    clear(status)
    const atts = attachments
    let content
    try { content = await userContent(text, atts) } catch (e) { return clear(status, alert('error', errorMessage(e))) }
    if (!log.length) clear(thread)
    const names = atts.map((a) => a.name)
    messages.push({ role: 'user', content }); log.push({ role: 'user', text: text || '(attachment)', files: names })
    bubble('user', text || '(attachment)', names)
    ta.value = ''; grow(); attachments = []; drawAttachments(); syncBar()
    const b = bubble('assistant', '')
    scroll()
    await respond(b)
  }

  async function regenerate() {
    if (controller || !log.length || log.at(-1).role !== 'assistant') return
    log.pop(); messages.pop(); thread.lastElementChild?.remove()
    const b = bubble('assistant', '')
    await respond(b)
  }

  function grow() { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 200)}px` }
  ta.addEventListener('input', grow)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); submit() }
  })
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])]
    if (files.length) { e.preventDefault(); addFiles(files) }
  })
  send.addEventListener('click', submit)
  stop.addEventListener('click', () => controller?.abort())
  const box = h('div', { class: 'ai-chatbox' })
  box.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('ai-drag') } })
  box.addEventListener('dragleave', (e) => { if (e.target === box) box.classList.remove('ai-drag') })
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('ai-drag'); addFiles([...e.dataTransfer.files]) })

  // restore a saved chat
  if (remember) {
    for (const m of load(`${STORE}:log`, [])) {
      if (!m?.text || !['user', 'assistant'].includes(m.role)) continue
      log.push({ role: m.role, text: m.text, files: m.files || [] })
      messages.push({ role: m.role, content: m.role === 'user' && m.files?.length ? `${m.text}\n\n[Attachments from earlier, no longer available: ${m.files.join(', ')}]` : m.text })
    }
  }

  box.append(
    h('div', { class: 'row', style: 'justify-content:space-between;gap:10px' }, h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Model'), modelSel), h('div', { class: 'row' }, cp, dl, clearBtn)),
    thread, status,
    h('div', { class: 'ai-composer' }, attachEl, ta, h('div', { class: 'ai-compbar' }, h('div', { class: 'row' }, attach, fileInput), h('div', { class: 'row' }, stop, send))),
    h('div', { class: 'row', style: 'justify-content:space-between' }, rememberToggle, h('span', { class: 'small muted' }, 'AI can make mistakes. Check important facts.')))
  root.append(h('div', { class: 'stack' }, ai.notice(), box))
  renderAll()
}
