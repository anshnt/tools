// AI image to text (and Handwriting to text via params.handwriting): faithful transcription with Claude vision,
// plus a free on-device OCR fallback that works without an API key.
import { h, button, field, select, segmented, toggle, dropzone, fileList, alert, clear, panel, row, textarea, progress, busy, download, copyText, copyButton, icon, isAbort, errorMessage } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { baseName } from '../../lib/files.js'
import { loadImage, toCanvas } from '../../lib/image.js'
import { recognize, OCR_LANGS } from '../../lib/ocr.js'
import { injectStyle, renderMd, runner, readSource, mdToDocx, LANGUAGES, UNTRUSTED } from './_shared.js'

/** System prompt for transcription. Exported for tests. */
export function buildPrompt({ handwriting, markdown, layout, unclear, language }) {
  const lang = language && language !== 'Auto-detect' ? ` The text is mostly in ${language}.` : ''
  const fmt = markdown
    ? 'Use Markdown: reproduce tables as Markdown tables, lists as lists, and clear headings as headings.'
    : 'Output plain text only: no Markdown symbols. Reproduce tables with tab-separated columns.'
  const lay = layout ? 'Keep the original line breaks, paragraphs and reading order.' : 'Join lines that belong to the same paragraph into flowing text.'
  if (handwriting) {
    return `You transcribe handwritten notes faithfully. ${UNTRUSTED}${lang}
Write down exactly what the writer wrote, in reading order. Do not correct spelling or grammar, do not summarize, translate or explain. ${lay} ${fmt}
${unclear ? 'Put [?] right after any word you are not sure about, and write [illegible] where text cannot be read.' : 'Give your best reading of unclear words.'} Describe a drawing or diagram in square brackets, for example [diagram: arrow from A to B]. If the page has no writing, reply exactly: [No text found]
Reply with the transcription only.`
  }
  return `You are a precise OCR engine. ${UNTRUSTED}${lang}
Transcribe all text in the image exactly as written, in reading order. Do not translate, summarize, correct or comment. ${lay} ${fmt}
Write [illegible] where text cannot be read. If there is no text, reply exactly: [No text found]
Reply with the transcription only.`
}

export function mount(root, { params, signal }) {
  injectStyle()
  const hw = !!params.handwriting
  const list = fileList({ sortable: false, onChange: () => update() })
  const cards = h('div', { class: 'stack' })
  const status = h('div')
  const prog = progress()
  let results = [] // {file, ta, preview, name}

  const zone = dropzone({
    accept: 'image/*,.heic,.heif,.pdf,application/pdf', multiple: true, icon: hw ? 'pen-line' : 'scan-text',
    label: hw ? 'Drop photos of handwritten pages' : 'Drop photos, screenshots or scans',
    hint: 'JPG, PNG, WebP, HEIC, PDF scans · or paste with Ctrl+V',
    onFiles: (files) => { clear(status); list.add(files.filter((f) => !list.files.some((x) => x.name === f.name && x.size === f.size))) },
  })
  const format = segmented([['plain', 'Plain text'], ['md', 'Markdown (tables)']], hw ? 'plain' : 'plain', null, 'Output format')
  const language = select(['Auto-detect', ...LANGUAGES], 'Auto-detect')
  const layout = toggle('Keep line breaks and layout', true)
  const unclear = toggle('Mark unclear words with [?]', true)
  const go = button(hw ? 'Transcribe' : 'Extract text', { icon: hw ? 'pen-line' : 'scan-text', variant: 'primary', size: 'lg', disabled: true })
  const localBtn = button('Free on-device OCR', { icon: 'cpu', title: 'Works without an API key; best for clean printed text' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Reading' })
  const ocrLang = select(OCR_LANGS, 'eng')
  ocrLang.setAttribute('aria-label', 'On-device OCR language')
  const all = () => results.map((r) => (results.length > 1 ? `## ${r.name}\n\n` : '') + r.ta.value.trim()).join('\n\n')
  const bar = h('div', { class: 'row', style: 'gap:8px', hidden: true },
    copyButton(all, 'Copy all'),
    button('Text', { icon: 'download', size: 'sm', onClick: () => download(all(), `${baseName(results[0]?.name || 'text')}.txt`, 'text/plain') }),
    button('Markdown', { icon: 'download', size: 'sm', onClick: () => download(all(), `${baseName(results[0]?.name || 'text')}.md`, 'text/markdown') }),
    button('Word', { icon: 'download', size: 'sm', onClick: async (e) => busy(e.currentTarget, async () => download(await mdToDocx(format.value === 'md' ? all() : all().replace(/\n/g, '  \n')), `${baseName(results[0]?.name || 'text')}.docx`), 'Word') }))

  function update() {
    go.disabled = localBtn.disabled = !list.files.length
    zone.classList.toggle('compact', list.files.length > 0)
  }

  function card(file) {
    const ta = textarea({ rows: 9, placeholder: 'The text appears here. You can edit it.', 'aria-label': `Text from ${file.name}`, spellcheck: false })
    const preview = h('div', { class: 'ai-md', hidden: true, style: 'min-height:120px' })
    const view = segmented([['text', 'Text'], ['preview', 'Preview']], 'text', (v) => {
      ta.hidden = v === 'preview'; preview.hidden = v === 'text'
      if (v === 'preview') renderMd(preview, ta.value)
    }, 'View')
    view.hidden = format.value !== 'md'
    const el = h('section', { class: 'panel' },
      h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('strong', { style: 'overflow-wrap:anywhere' }, file.name), h('div', { class: 'row' }, view, copyButton(() => ta.value, 'Copy'))),
      ta, preview)
    cards.append(el)
    return { file, ta, preview, name: file.name, el }
  }

  const reveal = () => { bar.hidden = !results.length }

  go.addEventListener('click', () => run.go(async (sig) => {
    const files = [...list.files]
    clear(cards); results = []; bar.hidden = true
    list.setDisabled(true)
    try {
      const sys = buildPrompt({ handwriting: hw, markdown: format.value === 'md', layout: layout.input.checked, unclear: unclear.input.checked, language: language.value })
      for (let i = 0; i < files.length; i++) {
        prog.set(i / files.length, `Reading ${files[i].name} (${i + 1} of ${files.length})`)
        const src = await readSource(files[i], { allow: ['pdf', 'image'] })
        const r = card(files[i]); results.push(r)
        r.el.scrollIntoView?.({ block: 'nearest' })
        try {
          const blocks = await src.blocks()
          await ai.ask({ system: sys, messages: [{ role: 'user', content: [...blocks, ai.textBlock(hw ? 'Transcribe this handwriting.' : 'Extract the text.')] }], effort: 'low', signal: sig, onText: (t) => { r.ta.value = t } })
        } catch (e) {
          if (isAbort(e)) { reveal(); throw e }
          r.ta.value = ''
          r.el.append(alert('error', `${files[i].name}: ${errorMessage(e)}`))
        }
        reveal()
      }
    } finally { list.setDisabled(false) }
  }, { label: 'Reading', progress: prog }))

  localBtn.addEventListener('click', () => busy(localBtn, async () => {
    const files = [...list.files]
    clear(cards); results = []; clear(status)
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (/pdf/.test(f.type) || /\.pdf$/i.test(f.name)) { clear(status, alert('warn', `${f.name}: on-device OCR reads images only. Use the AI button for PDFs.`)); continue }
      const r = card(f); results.push(r)
      const img = await loadImage(f)
      const out = await recognize(toCanvas(img), { lang: ocrLang.value, onProgress: (p, label) => prog.set(p, `${f.name}: ${label || 'Reading'}`) })
      r.ta.value = out.text || '[No text found]'
    }
    reveal()
  }, { label: 'Reading', errorTo: status, progress: prog }))

  format.addEventListener('click', () => { for (const c of cards.querySelectorAll('.seg')) c.hidden = format.value !== 'md' })

  root.append(h('div', { class: 'stack' },
    ai.notice(),
    panel(h('div', { class: 'stack' },
      zone, list.el,
      h('div', { class: 'grid-auto' }, field('Output', format), field(hw ? 'Writing language' : 'Text language', language)),
      h('div', { class: 'row', style: 'gap:18px' }, layout, hw && unclear),
      row(go, run.stop, !hw && localBtn, !hw && field('', ocrLang)),
      prog.el, status,
      h('p', { class: 'small muted' }, hw
        ? 'Works best with a sharp, well-lit photo taken straight on. Neat handwriting is read well; check names and numbers.'
        : 'AI reading handles tables, receipts, screenshots and messy photos. The free on-device OCR button needs no key and keeps the image on your device.'))),
    bar, cards))
  update()
}
