// Text to URL slug: separator, case, accents and Devanagari/Cyrillic/Greek transliteration, max length, batch per line.
// slugify(text, options) and slugifyLines(text, options) are pure and exported for tests.
import { h, icon } from '../../lib/ui.js'
import { studio, createOptions, group, chips, quick } from './_shared.js'
import { transliterate } from './_translit.js'

const STOP = new Set('a an the and or but of to in on at for with by from is are was were be as it its this that'.split(' '))

export function slugify(input, o) {
  let ext = ''
  let s = input.trim()
  if (o.keepExt) {
    const m = s.match(/\.([A-Za-z0-9]{1,6})$/)
    if (m && m.index > 0) { ext = `.${m[1].toLowerCase()}`; s = s.slice(0, m.index) }
  }
  if (o.translit) s = transliterate(s)
  s = s.replace(/['\u{2018}\u{2019}\u{201b}`\u{b4}]/gu, '')
  if (o.ampersand) s = s.replace(/\s*&\s*/g, ' and ')
  if (o.lower) s = s.toLowerCase()
  if (o.stopwords) {
    const words = s.split(/\s+/)
    const kept = words.filter((w) => !STOP.has(w.toLowerCase()))
    if (kept.length) s = kept.join(' ')
  }
  const keepRe = o.translit && !o.keepOther ? /[^A-Za-z0-9]+/g : /[^\p{L}\p{M}\p{N}]+/gu
  const sep = o.sep
  s = s.replace(keepRe, sep || ' ')
  if (sep) {
    const e = sep.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    s = s.replace(new RegExp(`(?:${e})+`, 'g'), sep).replace(new RegExp(`^(?:${e})+|(?:${e})+$`, 'g'), '')
  } else s = s.replace(/\s+/g, '')
  s = s.trim()
  const max = Math.max(0, Math.floor(o.max || 0))
  if (max && [...s].length > max) {
    let cut = [...s].slice(0, max).join('')
    if (o.wholeWord && sep) {
      const idx = cut.lastIndexOf(sep)
      const nextIsBoundary = s.startsWith(sep, cut.length)
      if (!nextIsBoundary && idx > 0) cut = cut.slice(0, idx)
    }
    s = sep ? cut.replace(new RegExp(`(?:${sep.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')})+$`), '') : cut
  }
  return s + ext
}

/** One slug per line. Empty lines stay empty; duplicates get -2, -3... when options.unique is on. */
export function slugifyLines(text, o) {
  const used = new Map()
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => {
    if (!line.trim()) return ''
    let slug = slugify(line, o)
    if (o.unique && slug) {
      const key = slug.toLowerCase()
      const n = (used.get(key) || 0) + 1
      used.set(key, n)
      if (n > 1) {
        const ext = o.keepExt ? slug.match(/\.[A-Za-z0-9]{1,6}$/)?.[0] || '' : ''
        slug = `${slug.slice(0, slug.length - ext.length)}${o.sep || ''}${n}${ext}`
      }
    }
    return slug ? o.prefix + slug : ''
  })
}

const CSS = `
.tu-urlbar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); font: 14px var(--mono); overflow: hidden; min-width: 0; }
.tu-urlbar .icon { width: 16px; height: 16px; color: var(--success); flex: none; }
.tu-urlbar .u { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
.tu-urlbar .u b { color: var(--text); font-weight: 650; background: linear-gradient(90deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.tu-meter { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-size: 12.5px; color: var(--muted); }
.tu-meter .tu-bar { flex: 1; max-width: 260px; }
.tu-meter .tu-bar > i.warn { background: linear-gradient(90deg, #f59e0b, #f97316); }
.tu-meter .tu-bar > i.bad { background: linear-gradient(90deg, #ef4444, #f97316); }
`

const SAMPLE = "10 Best Caf\u{e9}s in Mumbai & Pune (2025 Guide)\nHello World! This is Your First Post\n\u{92d}\u{93e}\u{930}\u{924} \u{915}\u{940} \u{930}\u{93e}\u{91c}\u{927}\u{93e}\u{928}\u{940} \u{928}\u{908} \u{926}\u{93f}\u{932}\u{94d}\u{932}\u{940}\nSt\u{f8}rre Gr\u{fc}\u{df}e \u{2014} Zo\u{eb}'s Notes\nMy Holiday Photo (1).JPG"

export function mount(rootEl, { tool }) {
  if (!document.getElementById('tu-sl-style')) document.head.append(h('style', { id: 'tu-sl-style' }, CSS))
  const o = createOptions(tool.id, { sep: '-', lower: true, translit: true, keepOther: false, ampersand: true, stopwords: false, max: 0, wholeWord: true, unique: true, keepExt: false, prefix: '' })
  let st
  const prefixIn = o.text('prefix', { placeholder: '/blog/ or https://site.com/', cls: 'mid' })
  const run = (text) => {
    const slugs = slugifyLines(text, o.v)
    const filled = slugs.filter(Boolean)
    const first = filled[0]
    let extra = null
    if (first) {
      const raw = first.slice(o.v.prefix.length)
      const len = [...raw].length
      const tone = len > 75 ? 'bad' : len > 60 ? 'warn' : ''
      extra = h('section', { class: 'tu-card' }, h('h3', slugs.filter(Boolean).length > 1 ? 'Preview of the first slug' : 'Preview'),
        h('div', { class: 'tu-urlbar' }, icon('lock'), h('span', { class: 'u' }, o.v.prefix || 'example.com/', h('b', raw))),
        h('div', { class: 'tu-meter' }, h('span', `${len} characters`), h('div', { class: 'tu-bar', 'aria-hidden': 'true' }, h('i', { class: tone, style: { transform: `scaleX(${Math.min(1, len / 90).toFixed(3)})` } })),
          h('span', len > 60 ? 'Long slugs get cut off in search results. Try a shorter one.' : 'Good length for search results.')))
    }
    const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim()).length
    return {
      text: slugs.join('\n'),
      badges: text.trim() ? [{ label: lines === 1 ? 'slug' : 'slugs', value: filled.length, tone: 'accent' }, ...(filled.length < lines ? [{ label: 'came out empty', value: lines - filled.length, tone: 'warn' }] : [])] : [],
      note: lines > filled.length ? 'Some lines had nothing left after cleaning. Turn on "Keep other scripts" or transliteration.' : '',
      extra,
    }
  }
  st = studio({
    id: tool.id, inputTitle: 'Titles or file names (one per line)', outputTitle: 'Slugs', placeholder: 'Type a title. Add more lines to make several slugs at once.', sample: SAMPLE, mono: false,
    controls: [
      group('Separator', o.pills('sep', [['-', 'Hyphen -'], ['_', 'Underscore _'], ['.', 'Dot .'], ['', 'None']], 'Separator')),
      group('Letters', chips(o.bool('lower', 'lowercase'), o.bool('translit', 'Transliterate to a-z', 'Accents, Cyrillic, Greek and Devanagari become plain letters'), o.bool('keepOther', 'Keep other scripts', 'Keep letters that cannot be converted, like Japanese or Arabic'))),
      group('Clean up', chips(o.bool('ampersand', '& becomes "and"'), o.bool('stopwords', 'Drop a, an, the, of...'), o.bool('unique', 'Make batch slugs unique'), o.bool('keepExt', 'Keep file extension'))),
      group('Max length', o.num('max', { min: 0, max: 200 }), o.bool('wholeWord', 'Cut at a whole word')),
      group('Prefix for every slug', prefixIn, quick([['/blog/', '/blog/'], ['https://example.com/', 'https://...']], (v) => { o.set({ prefix: v }); prefixIn.focus() })),
      h('span', { class: 'tu-hint' }, 'Max length 0 means no limit. Devanagari is converted roughly.'),
    ],
    run, filename: 'slugs.txt', emptyText: 'Slugs show up here as you type',
  })
  o.onChange = () => st.refresh()
  rootEl.append(st.el)
  st.input.focus({ preventScroll: true })
}
