// Chat with PDF (and Chat with multiple PDFs via params.multi): answers grounded in the documents with page citations.
// Claude: native citations (document blocks with citations enabled) shown as page chips that open the cited page.
// Gemini: the model is asked to write page references like [p. 3], which are turned into the same chips.
import { h, button, alert, clear, icon, dropzone, modal, copyText, isAbort, errorMessage, panel, onCleanup } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { openPdf, renderPage } from '../../lib/pdf.js'
import { injectStyle, injectChatStyle, mdSink, readSource, fileChips, DOC_ACCEPT, UNTRUSTED } from './_shared.js'

const SUGGEST = [
  'Summarize this in 5 bullet points',
  'What are the key dates, numbers and deadlines?',
  'What risks, caveats or open issues are mentioned?',
  'Who is responsible for what?',
]
const SUGGEST_MULTI = ['What do these documents have in common?', 'Where do the documents disagree?', 'Summarize each document in two sentences', ...SUGGEST.slice(1, 3)]
const MAX_DOCS = 6

/** Turn AI citations (or Gemini-style [p. 3] text) into chip descriptors: {doc, page, to, quote, label}. Exported for tests. */
export function collectRefs(blocks, names, claude) {
  const out = new Map()
  const label = (d, p, to) => `${names.length > 1 ? `${names[d] || 'Doc'} · ` : ''}${to > p ? `pp. ${p}-${to}` : `p. ${p}`}`
  const add = (d, p, to, quote) => {
    const key = `${d}:${p}:${to}`
    if (!out.has(key)) out.set(key, { doc: d, page: p, to, quote, label: label(d, p, to) })
  }
  if (claude) {
    for (const b of blocks) {
      for (const c of b.citations || []) {
        if (c.type === 'page_location') add(c.document_index ?? 0, c.start_page_number, Math.max(c.start_page_number, (c.end_page_number ?? c.start_page_number + 1) - 1), c.cited_text)
        else if (c.type === 'char_location' || c.type === 'content_block_location') {
          const d = c.document_index ?? 0
          const key = `${d}:q:${(c.cited_text || '').slice(0, 40)}`
          if (!out.has(key)) out.set(key, { doc: d, page: 0, quote: c.cited_text, label: `${names.length > 1 ? `${names[d]} · ` : ''}Excerpt ${[...out.values()].filter((x) => !x.page && x.doc === d).length + 1}` })
        }
      }
    }
  } else {
    const text = blocks.map((b) => b.text).join('')
    for (const m of text.matchAll(/\[(?:([^\]\[]+?),\s*)?pp?\.\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/g)) {
      const di = m[1] ? names.findIndex((n) => n.toLowerCase().startsWith(m[1].trim().toLowerCase().slice(0, 20))) : 0
      add(Math.max(0, di), +m[2], m[3] ? +m[3] : +m[2], '')
    }
  }
  return [...out.values()].sort((a, b) => a.doc - b.doc || a.page - b.page).slice(0, 14)
}

export function mount(root, { params, signal }) {
  injectStyle(); injectChatStyle()
  const multi = !!params.multi
  let sources = []
  const messages = []
  let controller = null
  const pdfDocs = new Map()
  onCleanup(() => { for (const p of pdfDocs.values()) p.then((d) => d.destroy?.()).catch(() => {}); pdfDocs.clear() })

  const status = h('div')
  const chipsEl = h('div')
  const thread = h('div', { class: 'ai-thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' })
  const ta = h('textarea', { rows: 1, placeholder: 'Ask a question about the document...', 'aria-label': 'Your question', disabled: true })
  const send = button('Ask', { icon: 'arrow-up', variant: 'primary', disabled: true })
  const stop = button('Stop', { icon: 'square' })
  stop.hidden = true
  const sugg = h('div', { class: 'ai-chips' })
  const suggestBtn = button('Suggest questions from the document', { icon: 'lightbulb', size: 'sm', variant: 'ghost' })
  const change = button(multi ? 'Change documents' : 'Change document', { icon: 'file-up', size: 'sm' })
  const names = () => sources.map((s) => s.name)
  const claude = () => ai.config().provider === 'anthropic'

  const zone = dropzone({
    accept: DOC_ACCEPT, multiple: multi, icon: multi ? 'files' : 'file-text',
    label: multi ? 'Drop two or more documents' : 'Drop a PDF to chat with',
    hint: multi ? `PDF, Word or text · up to ${MAX_DOCS} files` : 'PDF, Word or text · up to 600 pages',
    onFiles: async (files) => {
      clear(status)
      if (messages.length && !confirm('Adding documents starts a new conversation. Continue?')) return
      const next = multi ? [...sources] : []
      for (const f of files) {
        if (next.length >= MAX_DOCS) { clear(status, alert('warn', `Up to ${MAX_DOCS} documents at a time.`)); break }
        try { next.push(await readSource(f)) } catch (e) { clear(status, alert('error', e.message)) }
      }
      if (next.length === sources.length && !multi) return
      sources = next
      resetChat()
    },
  })

  function resetChat() {
    controller?.abort()
    messages.length = 0
    ta.disabled = !sources.length
    send.disabled = !sources.length
    zone.hidden = multi ? sources.length >= MAX_DOCS : !!sources.length
    zone.classList.toggle('compact', sources.length > 0)
    change.hidden = !sources.length
    suggestBtn.hidden = !sources.length
    clear(chipsEl, sources.length ? fileChips(sources, multi ? (i) => { sources.splice(i, 1); resetChat() } : null) : null)
    ta.placeholder = sources.length ? (multi ? 'Ask across all the documents...' : 'Ask a question about the document...') : 'Add a document first...'
    clear(thread)
    if (!sources.length) {
      clear(thread, h('div', { class: 'empty', style: 'margin:auto;width:100%' }, icon('message-square-text'), h('strong', { style: 'color:var(--text-2);font-size:16px' }, multi ? 'Ask questions across several documents' : 'Ask questions about a PDF'),
        h('div', multi ? 'Add two or more documents, then ask. Answers say which document and page they came from.' : 'Add a PDF, then ask anything. Answers come from the document and point to the page they used.')))
    } else {
      clear(thread, h('div', { class: 'empty', style: 'margin:auto;width:100%' }, icon('sparkles'), h('strong', { style: 'color:var(--text-2);font-size:16px' }, 'Ready. What would you like to know?'), h('div', 'Pick a suggestion or type your own question below.')))
    }
    drawSuggestions(multi ? SUGGEST_MULTI : SUGGEST)
  }

  function drawSuggestions(list) {
    clear(sugg, sources.length ? list.map((q) => h('button', { type: 'button', class: 'ai-chip', onclick: () => ask(q) }, icon('sparkles'), h('span', q))) : null)
  }

  const system = () => `You answer questions about the attached document${sources.length > 1 ? 's' : ''} (${names().join('; ')}). Use only the document content; if the answer is not there, say so plainly instead of guessing. Be concise and specific, quote exact figures and names, and format with Markdown. ${sources.length > 1 ? 'Say which document each fact comes from. ' : ''}${claude() ? '' : `After each claim add its page like [p. 3]${sources.length > 1 ? ' or [Document name, p. 3]' : ''}. `}${UNTRUSTED}`

  async function showSource(ref) {
    const src = sources[ref.doc]
    const body = h('div', { class: 'stack' })
    if (ref.quote) body.append(h('blockquote', { style: 'margin:0;border-left:3px solid var(--accent);padding:2px 0 2px 12px;color:var(--text-2);font-size:14px;white-space:pre-wrap' }, ref.quote))
    const m = modal({ title: `${src?.name || 'Document'}${ref.page ? `, page ${ref.page}` : ''}`, icon: 'file-text', body })
    if (src?.kind === 'pdf' && ref.page) {
      body.append(h('div', { class: 'small muted' }, 'Loading page...'))
      try {
        if (!pdfDocs.has(src)) pdfDocs.set(src, openPdf(src.file))
        const canvas = await renderPage(await pdfDocs.get(src), Math.min(ref.page, src.pages), { scale: 1.4 })
        canvas.style.cssText = 'max-width:100%;height:auto;border:1px solid var(--border);border-radius:10px;background:#fff'
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `Page ${ref.page}`)
        body.lastChild.replaceWith(canvas)
      } catch { body.lastChild.replaceWith(h('div', { class: 'small muted' }, 'Could not render this page.')) }
    }
    return m
  }

  function bubble(role) {
    const body = h('div', { class: role === 'user' ? '' : 'ai-md' })
    const refs = h('div', { class: 'ai-chips', style: 'margin-top:8px' })
    const acts = h('div', { class: 'ai-acts' })
    const el = h('div', { class: ['ai-msg', role === 'user' ? 'user' : 'bot'] }, role === 'user' ? null : h('div', { class: 'ai-av' }, icon('sparkles')),
      h('div', { class: 'ai-bub' }, body, role === 'user' ? null : [refs, acts]))
    thread.append(el)
    return { el, body, refs, acts, sink: role === 'user' ? null : mdSink(body) }
  }

  async function ask(question) {
    question = (question ?? ta.value).trim()
    if (!question || controller || !sources.length) return
    if (!(await ai.ensureKey())) return
    clear(status)
    if (!messages.length) clear(thread)
    const first = !messages.length
    let content
    try {
      if (first) {
        const blocks = []
        for (const s of sources) blocks.push(...await s.blocks({ citations: claude() }))
        blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: 'ephemeral' } }
        content = [...blocks, ai.textBlock(question)]
      } else content = question
    } catch (e) { return clear(status, alert('error', errorMessage(e))) }
    messages.push({ role: 'user', content })
    const u = bubble('user'); u.body.textContent = question
    ta.value = ''; grow()
    const b = bubble('bot')
    thread.scrollTop = thread.scrollHeight
    controller = new AbortController()
    send.hidden = true; stop.hidden = false; sugg.hidden = true
    let done = '', cur = ''
    try {
      const final = await ai.ask({
        raw: true, system: system(), messages, signal: controller.signal, effort: 'low',
        onText: (snap) => { if (!snap.startsWith(cur)) done += cur; cur = snap; b.sink.stream(done + cur); thread.scrollTop = thread.scrollHeight },
      })
      const blocks = final.content.filter((x) => x.type === 'text')
      const text = blocks.map((x) => x.text).join('') + (final.stop_reason === 'max_tokens' ? '\n\n[Answer cut off at the length limit]' : '')
      await b.sink.done(text)
      messages.push({ role: 'assistant', content: text })
      const refs = collectRefs(blocks, names(), claude())
      clear(b.refs, refs.length ? [h('span', { class: 'ai-label', style: 'align-self:center' }, 'Sources'), ...refs.map((r) => h('button', { type: 'button', class: 'ai-cite', title: r.quote ? r.quote.slice(0, 300) : `Open ${r.label}`, onclick: () => showSource(r) }, icon('file-text'), r.label))] : null)
      clear(b.acts, button('Copy', { icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => copyText(text) }))
    } catch (e) {
      const partial = (done + cur).trim()
      if (isAbort(e) && partial) {
        await b.sink.done(partial); messages.push({ role: 'assistant', content: partial })
        b.body.append(h('div', { class: 'ai-stopped' }, 'Stopped.'))
      } else {
        b.el.remove(); u.el.remove(); messages.pop(); ta.value = question; grow()
        if (!messages.length) resetChat()
        if (!isAbort(e)) clear(status, alert('error', errorMessage(e)))
      }
    } finally {
      controller = null; send.hidden = false; stop.hidden = true; sugg.hidden = false
      thread.scrollTop = thread.scrollHeight
    }
  }

  suggestBtn.addEventListener('click', async () => {
    if (!sources.length || !(await ai.ensureKey())) return
    suggestBtn.disabled = true
    clear(status)
    try {
      const blocks = []
      for (const s of sources) blocks.push(...await s.blocks())
      const res = await ai.ask({
        system: `You read documents and propose useful questions about them. ${UNTRUSTED}`, effort: 'low',
        json: { type: 'object', properties: { questions: { type: 'array', items: { type: 'string' } } }, required: ['questions'], additionalProperties: false },
        messages: [{ role: 'user', content: [...blocks, ai.textBlock('Suggest 6 specific, useful questions a reader could ask about this content. Each under 120 characters, answerable from the text, and varied (facts, numbers, reasoning, risks).')] }],
      })
      drawSuggestions((res.questions || []).filter((q) => typeof q === 'string').slice(0, 6))
    } catch (e) { if (!isAbort(e)) clear(status, alert('error', errorMessage(e))) } finally { suggestBtn.disabled = false }
  })

  change.addEventListener('click', () => { if (messages.length && !confirm('Start over with different documents? This conversation will be cleared.')) return; sources = []; resetChat() })
  function grow() { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 160)}px` }
  ta.addEventListener('input', grow)
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); ask() } })
  send.addEventListener('click', () => ask())
  stop.addEventListener('click', () => controller?.abort())
  signal?.addEventListener('abort', () => controller?.abort())

  root.append(h('div', { class: 'stack' },
    ai.notice(),
    panel(h('div', { class: 'stack' }, zone, h('div', { class: 'row', style: 'justify-content:space-between' }, chipsEl, change), status)),
    h('div', { class: 'ai-chatbox' }, thread, sugg,
      h('div', { class: 'row' }, suggestBtn),
      h('div', { class: 'ai-composer' }, ta, h('div', { class: 'ai-compbar' }, h('span', { class: 'small muted' }, 'Answers use only your document. Check important facts.'), h('div', { class: 'row' }, stop, send))))))
  resetChat()
}
