// Code explainer: paste code (or load a file) and get an explanation, line-by-line notes, complexity, bugs and improvements.
import { h, button, field, select, segmented, toggle, textarea, dropzone, alert, clear, panel, split, row, icon } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { injectStyle, resultView, exportBar, runner, streamAsk, LANGUAGES, UNTRUSTED } from './_shared.js'

const SECTIONS = [
  ['overview', 'Overview', 'What the code does and how it is organised, in plain English.', true],
  ['lines', 'Line-by-line notes', 'Walk through the code in order, explaining each important line or block (quote the line, then explain it).', true],
  ['complexity', 'Complexity', 'Time and space complexity with a short justification, and what dominates for large inputs.', true],
  ['bugs', 'Bugs and edge cases', 'Real bugs, risky assumptions, unhandled errors and edge cases, with the input that would break it. Say "none found" if the code is sound.', true],
  ['improve', 'Improvements', 'Concrete suggestions on readability, performance, security and style.', true],
  ['refactor', 'Improved version', 'A cleaned-up rewrite of the code in a fenced code block, keeping the behavior the same, followed by a short list of what changed.', false],
]
const LANGS = ['Auto-detect', 'JavaScript', 'TypeScript', 'Python', 'Java', 'C', 'C++', 'C#', 'Go', 'Rust', 'PHP', 'Ruby', 'Swift', 'Kotlin', 'SQL', 'Bash', 'PowerShell', 'HTML/CSS', 'R', 'MATLAB', 'Excel formula', 'Regex']
const SAMPLE = `def find_pairs(nums, target):
    seen = {}
    result = []
    for i, n in enumerate(nums):
        need = target - n
        if need in seen:
            result.append((seen[need], i))
        seen[n] = i
    return result

print(find_pairs([2, 7, 11, 15, 7], 9))`

export function buildSystem({ lang, level, sections, language }) {
  const chosen = SECTIONS.filter((s) => sections.includes(s[0]))
  return `You are a senior engineer who explains code clearly. ${UNTRUSTED} The code may be incomplete; say what you assume. Audience: ${{ beginner: 'a beginner who is new to programming: avoid jargon and explain concepts', intermediate: 'a developer who knows the basics', expert: 'an experienced engineer: be brief and precise, skip basics' }[level]}.
${lang !== 'Auto-detect' ? `The language is ${lang}.` : 'Detect the language and name it in the overview.'} ${language === 'English' ? '' : `Write the explanation in ${language} (keep code and identifiers as they are).`}
Reply in Markdown with exactly these sections, as level-2 headings, in this order:
${chosen.map((s, i) => `${i + 1}. "${s[1]}": ${s[2]}`).join('\n')}
Never claim the code was run. Be accurate: if you are unsure about something, say so.`
}

export function mount(root, { signal }) {
  injectStyle()
  const view = resultView({ emptyIcon: 'code', emptyTitle: 'The explanation appears here', emptyText: 'Paste code on the left. Choose what you want: overview, line-by-line notes, complexity, bugs and improvements.' })
  const status = h('div')
  const code = textarea({ rows: 14, mono: true, placeholder: 'Paste your code here...', 'aria-label': 'Code', spellcheck: false, wrap: 'off' })
  const lang = select(LANGS, 'Auto-detect')
  const level = segmented([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['expert', 'Expert']], 'intermediate', null, 'Explanation level')
  const outLang = select(LANGUAGES, 'English')
  const toggles = SECTIONS.map(([id, label, , on]) => [id, toggle(label, on)])
  const go = button('Explain code', { icon: 'sparkles', variant: 'primary', size: 'lg' })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Reading the code' })
  const zone = dropzone({ accept: 'text/*,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.php,.rb,.swift,.kt,.sql,.sh,.ps1,.html,.css,.json,.yml,.yaml,.r,.m,.txt', label: 'Or drop a code file', hint: 'Any text-based source file', compact: true, paste: false,
    onFiles: async ([f]) => { if (f.size > 500_000) return clear(status, alert('error', 'That file is large. Paste the part you want explained (under about 500 KB).')); code.value = await f.text(); clear(status) } })
  const bar = exportBar(view, 'code-explanation', { formats: ['md', 'txt'] })

  go.addEventListener('click', () => run.go(async (sig) => {
    const src = code.value.trim()
    if (!src) throw new Error('Paste some code first.')
    if (src.length > 400_000) throw new Error('That is a lot of code. Paste the part you want explained.')
    const sections = toggles.filter(([, t]) => t.input.checked).map(([id]) => id)
    if (!sections.length) throw new Error('Pick at least one section.')
    await streamAsk(view, {
      system: buildSystem({ lang: lang.value, level: level.value, sections, language: outLang.value }), effort: 'medium',
      messages: [{ role: 'user', content: [ai.textBlock(`Explain this code.\n\n<code>\n${src}\n</code>`)] }],
    }, sig)
  }, { label: 'Reading the code' }))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' },
        field('Code', code), h('div', { class: 'row' }, button('Try an example', { icon: 'wand-sparkles', size: 'sm', variant: 'ghost', onClick: () => { code.value = SAMPLE } }), button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { code.value = ''; view.reset() } })), zone,
        h('div', { class: 'grid-auto' }, field('Language', lang), field('Explain in', outLang)),
        field('Level', level),
        field('Include', h('div', { class: 'stack', style: 'gap:8px' }, toggles.map(([, t]) => t))),
        row(go, run.stop), status)),
      h('div', { class: 'stack' }, view.el, bar), 'wide-right')))
}
