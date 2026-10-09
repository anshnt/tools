// Document translator: PDF, Word or pasted text to any language, keeping headings, lists and tables.
// Long documents are translated in parts (text split at paragraph boundaries, PDFs a few pages at a time) so nothing gets cut off.
import { h, button, field, select, segmented, toggle, textarea, dropzone, alert, clear, panel, split, row, progress, tabs, isAbort } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { baseName } from '../../lib/files.js'
import { injectStyle, resultView, exportBar, runner, readSource, fileChips, DOC_ACCEPT, LANGUAGES, RTL_LANGS, UNTRUSTED } from './_shared.js'

const PDF_PAGES_PER_PART = 3
const TEXT_CHARS_PER_PART = 5000

/** Split Markdown at blank lines into parts of about `max` characters, never inside a fenced code block. */
export function chunkMarkdown(md, max = TEXT_CHARS_PER_PART) {
  const paras = md.split(/\n{2,}/)
  const parts = []
  let cur = ''
  let fenced = false
  for (const p of paras) {
    const joined = cur ? `${cur}\n\n${p}` : p
    if (cur && !fenced && joined.length > max) { parts.push(cur); cur = p } else cur = joined
    if ((p.match(/^```/gm) || []).length % 2) fenced = !fenced
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

/** Inclusive page ranges of `size` pages: pageRanges(7, 3) -> [[1,3],[4,6],[7,7]]. */
export const pageRanges = (n, size = PDF_PAGES_PER_PART) => Array.from({ length: Math.ceil(n / size) }, (_, i) => [i * size + 1, Math.min(n, (i + 1) * size)])

export function buildSystem({ target, source, tone, keepNames, glossary }) {
  return `You are a professional translator. Translate into ${target}${source && source !== 'Auto-detect' ? ` from ${source}` : ''}. Tone: ${tone}.
Preserve the structure exactly: headings (same Markdown levels), bullet and numbered lists, tables (as Markdown tables), bold and italic, links and paragraph breaks. Keep numbers, URLs, email addresses, code and placeholders unchanged. Translate everything: do not summarize, shorten, explain or add notes.${keepNames ? '\nKeep proper nouns, brand names and technical terms in the original language.' : ''}${glossary ? `\nUse this glossary exactly:\n${glossary}` : ''}
If a passage is already in ${target}, keep it as is. Reply with the translated Markdown only. ${UNTRUSTED}`
}

export function mount(root, { signal }) {
  injectStyle()
  let source = null
  let langName = 'Hindi'
  const view = resultView({ emptyIcon: 'languages', emptyTitle: 'Your translation appears here', emptyText: 'Add a PDF, Word file or text, pick the language, and the translation keeps your headings, lists and tables.' })
  const status = h('div')
  const prog = progress()
  const chipsEl = h('div')
  const paste = textarea({ rows: 8, placeholder: 'Paste the text to translate...', 'aria-label': 'Text to translate' })
  const zone = dropzone({
    accept: DOC_ACCEPT, label: 'Drop a PDF, Word or text file',
    onFiles: async ([f]) => {
      clear(status)
      try { source = await readSource(f); clear(chipsEl, fileChips([source], () => { source = null; clear(chipsEl); update() })); update() } catch (e) { source = null; clear(status, alert('error', e.message)) }
    },
  })
  const target = select(LANGUAGES, 'Hindi', (v) => { langName = v; setDir() })
  const from = select(['Auto-detect', ...LANGUAGES], 'Auto-detect')
  const tone = segmented([['neutral', 'Neutral'], ['formal', 'Formal'], ['casual', 'Casual']], 'neutral', null, 'Tone')
  const keep = toggle('Keep names, brands and technical terms untranslated', false)
  const glossary = textarea({ rows: 3, placeholder: 'Optional glossary, one per line:\nsprint = sprint\ninvoice = बीजक', 'aria-label': 'Glossary', mono: true })
  const go = button('Translate', { icon: 'languages', variant: 'primary', size: 'lg' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Translating' })
  let activeTab = 'file'
  const setDir = () => { view.body.dir = RTL_LANGS.has(langName) ? 'rtl' : 'auto' }
  const slug = () => langName.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')
  const bar = exportBar(view, () => `${baseName(source?.name || 'translation')}-${slug()}`, { rtl: () => RTL_LANGS.has(langName) })
  const update = () => zone.classList.toggle('compact', !!source)

  go.addEventListener('click', () => run.go(async (sig) => {
    const usePaste = activeTab === 'paste'
    if (usePaste ? !paste.value.trim() : !source) throw new Error(usePaste ? 'Paste some text to translate first.' : 'Add a file to translate first.')
    const gl = glossary.value.trim()
    const system = buildSystem({ target: langName, source: from.value, tone: tone.value, keepNames: keep.input.checked, glossary: gl })
    let jobs
    let blocks = null
    const text = usePaste ? paste.value.trim() : source.text
    if (!usePaste && source.kind === 'pdf') {
      blocks = await source.blocks({ cache: true })
      jobs = source.pages <= PDF_PAGES_PER_PART
        ? [{ prompt: 'Translate the whole PDF.' }]
        : pageRanges(source.pages).map(([a, b]) => ({ prompt: `Translate only pages ${a} to ${b} of the PDF, in reading order. If a paragraph continues from the previous page, translate its continuation without repeating earlier text.` }))
      jobs.forEach((j) => { j.prompt += ' Leave out running headers, footers and page numbers. Reply with Markdown only.' })
    } else {
      jobs = chunkMarkdown(text).map((c) => ({ prompt: `Translate this text:\n\n${c}` }))
    }
    if (jobs.length > 15) clear(status, alert('info', `This is a long document: it will be translated in ${jobs.length} parts. You can stop at any time and keep what is done.`))
    setDir()
    view.reset()
    let acc = ''
    let partial = ''
    try {
      for (let i = 0; i < jobs.length; i++) {
        prog.set(i / jobs.length, jobs.length > 1 ? `Translating part ${i + 1} of ${jobs.length}` : 'Translating')
        partial = ''
        const content = [...(blocks || []), ai.textBlock(jobs[i].prompt)]
        const out = await ai.ask({ system, messages: [{ role: 'user', content }], effort: 'low', signal: sig, onText: (t) => { partial = t; view.stream(acc + (acc ? '\n\n' : '') + t) } })
        acc += (acc ? '\n\n' : '') + out.trim()
        partial = ''
        view.stream(acc)
      }
      await view.done(acc)
    } catch (e) {
      const so = acc + (partial ? (acc ? '\n\n' : '') + partial : '')
      await view.done(so, { stopped: isAbort(e) })
      throw e
    }
  }, { label: 'Translating', progress: prog }))

  const fileTab = h('div', { class: 'stack' }, zone, chipsEl)
  const tabApi = tabs([{ id: 'file', label: 'File', render: () => fileTab }, { id: 'paste', label: 'Paste text', render: () => paste }], 'file', (id) => { activeTab = id })

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' }, tabApi,
        h('div', { class: 'grid-auto' }, field('Translate to', target), field('From', from)),
        field('Tone', tone), keep, field('Glossary (optional)', glossary, 'One "term = translation" per line.'),
        row(go, run.stop), prog.el, status,
        h('p', { class: 'small muted' }, 'Scanned PDFs work. Tables and lists stay as real tables and lists. Pictures are not carried over.'))),
      h('div', { class: 'stack' }, view.el, bar), 'wide-right')))
}
