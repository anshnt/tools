// Image alt text and caption writer: accessibility alt text, a fuller description, a social caption with hashtags, and a clean file name.
import { h, button, field, select, dropzone, fileList, alert, clear, panel, row, progress, textarea, copyButton, download, icon, isAbort, errorMessage } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { baseName, ext } from '../../lib/files.js'
import { injectStyle, runner, LANGUAGES, UNTRUSTED } from './_shared.js'

const SCHEMA = {
  type: 'object',
  properties: { alt_text: { type: 'string' }, long_description: { type: 'string' }, caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, file_name: { type: 'string' }, text_in_image: { type: 'string' } },
  required: ['alt_text', 'long_description', 'caption', 'hashtags', 'file_name', 'text_in_image'],
  additionalProperties: false,
}
const PLATFORMS = [['generic', 'Any platform'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['x', 'X / Twitter'], ['pinterest', 'Pinterest'], ['blog', 'Blog or website']]
const TONES = [['friendly', 'Friendly'], ['professional', 'Professional'], ['playful', 'Playful'], ['inspiring', 'Inspiring'], ['plain', 'Plain and factual']]
const MAX_FILES = 10

export const csvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
/** Keep alt text at or under 125 characters without cutting a word in half. Exported for tests. */
export function trimAlt(s, max = 125) {
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '')}…`
}

export function mount(root, { signal }) {
  injectStyle()
  const list = fileList({ sortable: false, onChange: () => { go.disabled = !list.files.length; zone.classList.toggle('compact', list.files.length > 0) } })
  const status = h('div')
  const out = h('div', { class: 'stack' })
  const prog = progress()
  let rows = [] // {name, data}
  const zone = dropzone({ accept: 'image/*,.heic,.heif', multiple: true, label: 'Drop images to describe', icon: 'captions', hint: `Up to ${MAX_FILES} images · JPG, PNG, WebP, HEIC · or paste with Ctrl+V`,
    onFiles: (f) => { const next = [...list.files, ...f.filter((x) => !list.files.some((y) => y.name === x.name && y.size === x.size))].slice(0, MAX_FILES); list.set(next) } })
  const platform = select(PLATFORMS, 'generic')
  const tone = select(TONES, 'friendly')
  const language = select(LANGUAGES, 'English')
  const context = textarea({ rows: 2, placeholder: 'Optional context, e.g. "our new cafe in Pune, opening Saturday" or "product photo for the spring catalog"', 'aria-label': 'Context', maxlength: 300 })
  const go = button('Write alt text', { icon: 'captions', variant: 'primary', size: 'lg', disabled: true })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Looking' })

  const card = (r) => {
    const d = r.data
    const alt = trimAlt(d.alt_text)
    const tags = (d.hashtags || []).map((t) => `#${t.replace(/^#/, '').replace(/\s+/g, '')}`).filter((t) => t.length > 1)
    const fileName = `${(d.file_name || baseName(r.name)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image'}.${ext(r.name) || 'jpg'}`
    const f = (label, text, rows = 2) => field(label, h('div', { class: 'stack', style: 'gap:6px' }, textarea({ rows, value: text, 'aria-label': `${label} for ${r.name}`, readonly: false }), h('div', { class: 'row' }, copyButton(() => text, 'Copy'))), label === 'Alt text' ? `${alt.length} characters. Screen readers read this aloud: keep it short and concrete.` : null)
    return panel(h('div', { class: 'stack' }, h('strong', { style: 'overflow-wrap:anywhere' }, r.name),
      f('Alt text', alt), f('Longer description', d.long_description, 4), f(`Caption (${platform.options[platform.selectedIndex].text})`, [d.caption, tags.join(' ')].filter(Boolean).join('\n\n'), 4),
      f('Suggested file name', fileName, 1), d.text_in_image?.trim() ? f('Text in the image', d.text_in_image, 2) : null))
  }
  function render() {
    clear(out, rows.length > 1 ? row(button('Download CSV', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(['File,Alt text,Caption,Hashtags', ...rows.map((r) => [r.name, trimAlt(r.data.alt_text), r.data.caption, r.data.hashtags.map((t) => `#${t.replace(/^#/, '')}`).join(' ')].map(csvCell).join(','))].join('\n'), 'alt-text.csv', 'text/csv') })) : null, ...rows.map(card))
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    const files = [...list.files]
    rows = []; clear(out)
    const system = `You write accessible image descriptions and social captions. ${UNTRUSTED} alt_text: one concrete sentence, at most 120 characters, no "image of" or "picture of", no hashtags; name the subject, action and key visible detail, and read out short text that matters. long_description: 2 to 4 sentences for people who want more detail (setting, colors, mood, text, who or what is where). caption: a ready-to-post caption for ${PLATFORMS.find((p) => p[0] === platform.value)[1]} in a ${tone.value} tone, in ${language.value}, with the length and style that platform suits. hashtags: 5 to 8 relevant hashtags without the # sign, in ${language.value} where natural. file_name: a short descriptive SEO file name in lowercase words, no extension. text_in_image: any readable text in the picture, or an empty string. Write alt_text and long_description in ${language.value}. Never guess names of people from their faces; describe them by what they do or wear.${context.value.trim() ? ` Context from the user: ${context.value.trim()}` : ''}`
    list.setDisabled(true)
    try {
      for (let i = 0; i < files.length; i++) {
        prog.set(i / files.length, `Looking at ${files[i].name} (${i + 1} of ${files.length})`)
        try {
          const data = await ai.ask({ system, json: SCHEMA, effort: 'low', signal: sig, messages: [{ role: 'user', content: [await ai.imageBlock(files[i]), ai.textBlock('Describe this image.')] }] })
          rows.push({ name: files[i].name, data: { ...data, hashtags: data.hashtags || [] } })
        } catch (e) {
          if (isAbort(e)) throw e
          clear(status, alert('error', `${files[i].name}: ${errorMessage(e)}`))
        }
        render()
      }
    } finally { list.setDisabled(false); render() }
  }, { label: 'Looking', progress: prog }))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    panel(h('div', { class: 'stack' }, zone, list.el,
      h('div', { class: 'grid-auto' }, field('Platform', platform), field('Tone', tone), field('Language', language)),
      field('Context (optional)', context), row(go, run.stop), prog.el, status,
      h('p', { class: 'small muted' }, 'Good alt text helps people who use screen readers and also helps search. Check the result: AI can miss details or misread text.'))),
    out))
  clear(out, h('div', { class: 'empty' }, icon('captions'), h('strong', { style: 'color:var(--text-2)' }, 'Alt text, description, caption and hashtags appear here'), h('div', 'Add one or more images and press Write alt text.')))
}
