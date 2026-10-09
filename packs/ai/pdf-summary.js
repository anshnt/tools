// PDF / document summarizer. One module serves four entries: PDF summarizer, Document summarizer (Word and text too),
// Research paper summarizer (params.preset 'research') and PDF to study notes (params.preset 'notes').
import { h, button, field, input, select, segmented, toggle, dropzone, alert, clear, panel, split, row } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { baseName } from '../../lib/files.js'
import { injectStyle, resultView, exportBar, runner, streamAsk, readSource, fileChips, DOC_ACCEPT, LANGUAGES, UNTRUSTED } from './_shared.js'

const SAME = 'Same language as the document'

const VARIANTS = {
  default: {
    formats: [['tldr', 'TL;DR'], ['bullets', 'Key points'], ['detailed', 'Detailed']], def: 'bullets', formatLabel: 'Summary style',
    toggles: [['actions', 'Add an action items list', false]],
    emptyTitle: 'Your summary appears here', emptyText: 'Add a PDF, choose TL;DR, key points or a detailed summary, then press Summarize.', verb: 'Summarize', icon: 'file-text',
  },
  research: {
    formats: [['brief', 'Brief'], ['standard', 'Standard'], ['deep', 'Deep dive']], def: 'standard', formatLabel: 'Depth',
    levels: [['plain', 'Plain English'], ['technical', 'Technical']],
    toggles: [['glossary', 'Add a glossary of key terms', true]],
    emptyTitle: 'Problem, method, results and limitations', emptyText: 'Add a paper (PDF or Word) and get a clear breakdown you can read in two minutes.', verb: 'Explain this paper', icon: 'book-open-text',
  },
  notes: {
    formats: [['concise', 'Concise'], ['detailed', 'Detailed']], def: 'detailed', formatLabel: 'Notes length',
    toggles: [['quiz', 'Add practice questions with answers', true]],
    emptyTitle: 'Revision notes appear here', emptyText: 'Add a chapter or lecture PDF and get headings, key terms and a quick recap you can study from.', verb: 'Make study notes', icon: 'notebook-text',
  },
}

/** Build the system prompt for the chosen variant and options. Exported so it can be tested without the UI. */
export function buildPrompt(variant, { format, level = 'plain', language = SAME, flags = {} } = {}) {
  const lang = language === SAME ? 'Write in the same language as the document.' : `Write the output in ${language}.`
  let spec
  if (variant === 'research') {
    const words = { brief: 'about 250 words', standard: 'about 500 words', deep: 'about 900 words, including datasets, baselines and ablations where the paper has them' }[format]
    spec = `Explain this research paper (${words}) in ${level === 'technical' ? 'precise technical language for a researcher in the field' : 'plain English that a smart newcomer can follow'}.
Use exactly these Markdown sections: a level-2 title with the paper's title, then "**In one sentence**", "## The problem", "## The approach", "## Results" (include the key numbers and what they are compared against), "## Limitations and open questions", "## Why it matters".${flags.glossary ? ' End with "## Key terms": a table with columns Term and Plain-language meaning.' : ''}
Say clearly when the paper does not state something (for example the dataset or baseline) instead of guessing.`
  } else if (variant === 'notes') {
    spec = `Turn this document into ${format === 'concise' ? 'one-page' : 'thorough'} revision notes for a student.
Structure: a level-2 title; "**Big idea**" (2 to 3 sentences); then one level-2 section per major topic, following the document's order. Inside sections use short bullets, **bold key terms** at first mention, definitions, formulas written in plain text, and one worked example where the document has one. Then "## Key terms" as a table (Term | Meaning), and "## Quick recap" with 5 to 8 bullets.${flags.quiz ? ' Finish with "## Practice questions": 8 questions (mix of recall and reasoning), then a "### Answers" section with brief answers.' : ''}`
  } else {
    spec = {
      tldr: 'Write a TL;DR: a level-2 title, then 3 to 5 sentences that capture the essence. Add a short "**Key numbers**" bullet list only if the document has important figures.',
      bullets: 'Write a level-2 title, then "## Key points": 6 to 12 concise bullets ordered by importance, each starting with a **bold lead phrase**. Then "## Important details" with dates, figures, names and decisions, if any.',
      detailed: 'Write a detailed summary: a level-2 title, a 2 to 3 sentence overview, then sections with headings that follow the structure of the document and cover every major part (keep key figures and names). End with "## Takeaways".',
    }[format]
    if (flags.actions) spec += '\nEnd with "## Action items": a bulleted list of tasks, deadlines and owners found in the document, or "None found".'
  }
  return `You are an expert analyst who writes accurate, well-structured summaries. ${UNTRUSTED}
Use only information from the document and never invent facts, numbers or quotes. ${lang} Reply with Markdown only, no preamble.

${spec}`
}

export function mount(root, { params, signal }) {
  injectStyle()
  const key = params.preset || 'default'
  const V = VARIANTS[key]
  const allow = params.docs || params.preset ? ['pdf', 'docx', 'text'] : ['pdf']
  let source = null

  const view = resultView({ emptyIcon: V.icon, emptyTitle: V.emptyTitle, emptyText: V.emptyText })
  const status = h('div')
  const chipsEl = h('div')
  const zone = dropzone({
    accept: allow.length > 1 ? DOC_ACCEPT : '.pdf,application/pdf', label: allow.length > 1 ? 'Drop a PDF, Word or text file' : 'Drop a PDF here or click to choose',
    onFiles: async ([f]) => {
      clear(status)
      try {
        source = await readSource(f, { allow })
        view.reset()
        update()
      } catch (e) { source = null; update(); clear(status, alert('error', e.message)) }
    },
  })
  const format = segmented(V.formats, V.def, null, V.formatLabel)
  const level = V.levels && segmented(V.levels, 'plain', null, 'Level')
  const language = select([SAME, ...LANGUAGES], SAME)
  const focus = input({ placeholder: 'e.g. costs, risks, the methodology', maxlength: 200 })
  const flags = Object.fromEntries(V.toggles.map(([k, label, on]) => [k, toggle(label, on)]))
  const go = button(V.verb, { icon: 'sparkles', variant: 'primary', size: 'lg', disabled: true })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Reading' })
  const bar = exportBar(view, () => `${baseName(source?.name || 'document')}-${key === 'notes' ? 'notes' : 'summary'}`, { title: () => baseName(source?.name || '') })

  function update() {
    go.disabled = !source
    zone.classList.toggle('compact', !!source)
    clear(chipsEl, source && fileChips([source], () => { source = null; view.reset(); update() }))
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    const sys = buildPrompt(key, { format: format.value, level: level?.value, language: language.value, flags: Object.fromEntries(Object.entries(flags).map(([k, t]) => [k, t.input.checked])) })
    const f = focus.value.trim()
    const blocks = await source.blocks()
    await streamAsk(view, {
      system: sys,
      messages: [{ role: 'user', content: [...blocks, ai.textBlock(`Please process the attached document.${f ? ` Pay particular attention to: ${f}.` : ''}`)] }],
      effort: format.value === 'tldr' || format.value === 'brief' || format.value === 'concise' ? 'low' : 'medium',
    }, sig)
  }, { label: 'Writing' }))

  const options = h('div', { class: 'stack' },
    field(V.formatLabel, format),
    level && field('Level', level),
    field('Output language', language),
    field('Focus (optional)', focus),
    h('div', { class: 'stack', style: 'gap:8px' }, Object.values(flags)))

  root.append(h('div', { class: 'stack' },
    ai.notice(),
    split(
      panel(h('div', { class: 'stack' }, zone, chipsEl, options, row(go, run.stop), status,
        h('p', { class: 'small muted' }, 'Scanned PDFs work too. Up to 600 pages or 24 MB. Your file goes only to the AI provider you chose.'))),
      h('div', { class: 'stack' }, view.el, bar), 'wide-right')))
}
