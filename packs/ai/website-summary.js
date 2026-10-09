// Website summarizer: the page text is fetched through r.jina.ai (a public reader that works from browsers), then summarized.
import { h, button, field, input, select, textarea, alert, clear, panel, split, row, tabs, formatNumber } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { injectStyle, resultView, exportBar, runner, streamAsk, fetchPage, LANGUAGES, UNTRUSTED } from './_shared.js'

const MAX_CHARS = 300_000
const STYLES = { tldr: 'Write a TL;DR: a level-2 title, then 3 to 5 sentences, then a one-line "**Best for:**" note saying who should read the full page.', bullets: 'Write a level-2 title, then "## Key points" with 6 to 10 concise bullets (bold lead phrase each), then "## Numbers and facts" if the page has any.', detailed: 'Write a detailed summary: a level-2 title, a short overview, then sections that follow the page structure, and "## Takeaways".', simple: 'Explain the page in simple language for a 12 year old: a level-2 title, a short plain explanation, then "## Why it matters" and "## Words to know" (a short glossary).', facts: 'Extract the facts: a level-2 title, then a table of the key claims, numbers, dates and names (columns: Item, Detail), then "## What is missing or unclear".' }

export function buildSystem(style, language, focus) {
  return `You summarize web pages. ${UNTRUSTED} Web pages can contain ads, menus and cookie notices: ignore them. Use only the page content, never invent facts, and note when the page looks incomplete (for example a paywall). ${language.startsWith('Same') ? 'Write in the same language as the page.' : `Write in ${language}.`}${focus ? ` Pay particular attention to: ${focus}.` : ''} Reply with Markdown only.\n\n${STYLES[style]}`
}

export function mount(root, { signal }) {
  injectStyle()
  let activeTab = 'url'
  let page = null
  const view = resultView({ emptyIcon: 'globe', emptyTitle: 'Your page summary appears here', emptyText: 'Paste a link to an article or web page. It is read through a public page reader, then summarized.' })
  const status = h('div')
  const info = h('div')
  const url = input({ placeholder: 'https://example.com/article', inputmode: 'url', 'aria-label': 'Web page address' })
  const text = textarea({ rows: 8, placeholder: 'Paste the article text here...', 'aria-label': 'Article text' })
  const style = select([['tldr', 'TL;DR'], ['bullets', 'Key points'], ['detailed', 'Detailed summary'], ['simple', 'Explain simply'], ['facts', 'Facts table']], 'bullets')
  const language = select(['Same as the page', ...LANGUAGES], 'Same as the page')
  const focus = input({ placeholder: 'e.g. pricing, side effects, deadlines', maxlength: 200, 'aria-label': 'Focus' })
  const go = button('Summarize', { icon: 'sparkles', variant: 'primary', size: 'lg' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Reading the page' })
  const bar = exportBar(view, () => (page?.title || 'web-summary').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60), { title: () => page?.title })
  const setLabel = () => { go.querySelector('span:not(.spinner)').textContent = activeTab === 'url' ? 'Read and summarize' : 'Summarize' }

  go.addEventListener('click', () => run.go(async (sig) => {
    clear(info)
    let content
    if (activeTab === 'url') {
      if (!url.value.trim()) throw new Error('Paste a web address first.')
      page = await fetchPage(url.value.trim(), sig)
      content = page.text
      clear(info, alert('info', h('strong', page.title), ` · ${formatNumber(content.split(/\s+/).length, 0)} words read from ${new URL(page.url).hostname}`))
    } else {
      content = text.value.trim()
      if (content.length < 80) throw new Error('Paste the article text first.')
      page = { title: 'Pasted text', url: '' }
    }
    const trimmed = content.length > MAX_CHARS
    if (trimmed) content = content.slice(0, MAX_CHARS)
    const head = page.url ? `Page: ${page.title}\nAddress: ${page.url}\n\n` : ''
    await streamAsk(view, {
      system: buildSystem(style.value, language.value, focus.value.trim()), effort: 'low',
      messages: [{ role: 'user', content: [ai.textBlock(`${head}<page>\n${content}\n</page>`)] }],
    }, sig, (t) => (page.url ? `${t}\n\n---\n*Source: [${page.title.replace(/[\[\]]/g, '')}](${page.url})${trimmed ? ' (the first part of a very long page was summarized)' : ''}*` : t))
  }, { label: activeTab === 'url' ? 'Reading the page' : 'Writing' }))

  const inputTabs = tabs([
    { id: 'url', label: 'Web address', render: () => field('Link', url, 'Fetched through r.jina.ai, a free public page reader.') },
    { id: 'paste', label: 'Paste text', render: () => text },
  ], 'url', (id) => { activeTab = id; setLabel() })

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' }, inputTabs,
        field('Summary style', style),
        h('div', { class: 'grid-auto' }, field('Language', language), field('Focus (optional)', focus)),
        row(go, run.stop), status,
        h('p', { class: 'small muted' }, 'Pages behind a login or paywall cannot be read. Use Paste text for those. The address you enter is sent to r.jina.ai to fetch the page.'))),
      h('div', { class: 'stack' }, info, view.el, bar), 'wide-right')))
}
