// Meta tag generator with live Google and social previews. Runs locally.
import { h, icon, button, field, input, textarea, select, toggle, panel, alert, clear, copyButton, download, debounce, tabs, split, segmented } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, note, textWidth } from './_shared.js'
import { previewCard, PREVIEW_KINDS } from './_preview.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const DEFAULTS = {
  title: '', description: '', url: '', lang: 'en', author: '', keywords: '', index: true, follow: true, extraRobots: [], themeColor: '', favicon: '',
  siteName: '', ogType: 'website', image: '', imageAlt: '', twitterCard: 'summary_large_image', twitterSite: '', twitterCreator: '',
  incCore: true, incOg: true, incTwitter: true,
}
const EXAMPLE = {
  title: 'Handmade Ceramic Mugs | Clay & Co', description: 'Small-batch stoneware mugs, thrown and glazed by hand in Pune. Dishwasher safe, ships across India in 3 to 5 days.',
  url: 'https://www.clayandco.example/shop/mugs', lang: 'en', author: 'Clay & Co', siteName: 'Clay & Co', ogType: 'website', image: 'https://www.clayandco.example/img/mugs-1200x630.jpg',
  imageAlt: 'Three stoneware mugs in sage, sand and charcoal', twitterSite: '@clayandco', themeColor: '#b45309', keywords: 'ceramic mugs, handmade pottery, stoneware',
}
const LANGS = [['en', 'English'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-IN', 'English (India)'], ['hi', 'Hindi'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt-BR', 'Portuguese (Brazil)'], ['it', 'Italian'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-CN', 'Chinese (Simplified)'], ['ar', 'Arabic'], ['ru', 'Russian'], ['tr', 'Turkish'], ['id', 'Indonesian']]
const EXTRA_ROBOTS = [['noarchive', 'noarchive', 'No cached copy'], ['nosnippet', 'nosnippet', 'No text snippet in results'], ['noimageindex', 'noimageindex', 'Do not index images'], ['max-image-preview:large', 'max-image-preview:large', 'Allow large image previews']]

/** Build the HTML for the <head> from the form values. */
export function buildMeta(v, { indent = '  ' } = {}) {
  const L = []
  const add = (s) => L.push(indent + s)
  const meta = (name, content, attr = 'name') => { if (content !== '' && content != null) add(`<meta ${attr}="${name}" content="${esc(content)}">`) }
  if (v.incCore) {
    add('<meta charset="utf-8">')
    add('<meta name="viewport" content="width=device-width, initial-scale=1">')
  }
  if (v.title) add(`<title>${escText(v.title)}</title>`)
  meta('description', v.description)
  if (v.url) add(`<link rel="canonical" href="${esc(v.url)}">`)
  const robots = [v.index ? null : 'noindex', v.follow ? null : 'nofollow', ...(v.extraRobots || [])].filter(Boolean)
  if (robots.length) meta('robots', robots.join(', '))
  meta('author', v.author)
  meta('keywords', v.keywords)
  meta('theme-color', v.themeColor)
  if (v.favicon) add(`<link rel="icon" href="${esc(v.favicon)}">`)
  if (v.incOg) {
    if (L.length) L.push('')
    meta('og:type', v.ogType, 'property')
    meta('og:title', v.title, 'property')
    meta('og:description', v.description, 'property')
    meta('og:url', v.url, 'property')
    meta('og:site_name', v.siteName, 'property')
    meta('og:locale', v.lang ? v.lang.replace('-', '_').replace(/^([a-z]{2})$/, (m) => ({ en: 'en_US', hi: 'hi_IN', es: 'es_ES', fr: 'fr_FR', de: 'de_DE', it: 'it_IT', ja: 'ja_JP', ko: 'ko_KR', ru: 'ru_RU', ar: 'ar_AR', nl: 'nl_NL', id: 'id_ID', tr: 'tr_TR' }[m] || m)) : '', 'property')
    meta('og:image', v.image, 'property')
    if (v.image) meta('og:image:alt', v.imageAlt, 'property')
  }
  if (v.incTwitter) {
    if (L.length && L[L.length - 1] !== '') L.push('')
    meta('twitter:card', v.image ? v.twitterCard : 'summary')
    meta('twitter:title', v.title)
    meta('twitter:description', v.description)
    meta('twitter:image', v.image)
    if (v.image) meta('twitter:image:alt', v.imageAlt)
    meta('twitter:site', v.twitterSite ? '@' + v.twitterSite.replace(/^@/, '') : '')
    meta('twitter:creator', v.twitterCreator ? '@' + v.twitterCreator.replace(/^@/, '') : '')
  }
  while (L[L.length - 1] === '') L.pop()
  return L.join('\n')
}

const CSS = `
.t-meta .sticky { position: sticky; top: calc(var(--header-h) + 16px); }
.t-meta .count { font-size: 12.5px; color: var(--muted); display: grid; gap: 2px; }
.t-meta .meter { height: 5px; border-radius: 999px; background: var(--surface-3); overflow: hidden; margin-top: 4px; }
.t-meta .meter i { display: block; height: 100%; border-radius: inherit; background: var(--success); transition: width .25s var(--ease), background .2s; }
.t-meta .meter.warn i { background: var(--warning); } .t-meta .meter.bad i { background: var(--danger); }
.t-meta .pvwrap { display: grid; justify-items: start; padding-top: 4px; overflow: hidden; }
.t-meta input[type="color"] { width: 100%; height: 42px; padding: 3px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; }
.t-meta .code-out { max-height: 360px; }
@media (max-width: 900px) { .t-meta .sticky { position: static; } }
`

export function mount(root) {
  ensureStyle()
  if (!document.getElementById('t-meta-style')) document.head.append(h('style', { id: 't-meta-style' }, CSS))
  const v = { ...DEFAULTS, ...load('meta-tags:v', {}) }
  let inputs = {}
  let pvKind = load('meta-tags:pv', 'google')
  let mobile = false
  const persist = debounce(() => save('meta-tags:v', v), 400)

  let counters = {}
  function counter(key, [okMin, okMax], measure) {
    const label = h('span'), meter = h('div', { class: 'meter' }, h('i'))
    counters[key] = () => {
      const m = measure(v[key] || '')
      const state = !v[key] ? '' : m.value > okMax || m.value < okMin ? (m.value > okMax * 1.15 || m.value < okMin * 0.5 ? 'bad' : 'warn') : ''
      meter.className = 'meter ' + state
      meter.firstChild.style.width = Math.min(100, (m.value / okMax) * 100) + '%'
      label.textContent = m.text
    }
    return h('div', { class: 'count' }, label, meter)
  }
  const text = (key, label, ph, o = {}) => {
    const ctl = o.multiline ? textarea({ rows: 3, placeholder: ph, value: v[key], 'aria-label': label, oninput: (e) => change(key, e.target.value) })
      : input({ value: v[key], placeholder: ph, 'aria-label': label, spellcheck: o.spell ?? true, autocapitalize: 'off', oninput: (e) => change(key, e.target.value) })
    inputs[key] = ctl
    return field(label, ctl, o.hint)
  }

  const formHost = h('section', { class: 'panel' })
  function buildForm() {
    inputs = {}
    counters = {}
    const titleCount = counter('title', [30, 60], (s) => { const px = Math.round(textWidth(s, '400 20px Arial')); return { value: Math.max(s.length, px / 10), text: s ? `${s.length} characters, about ${px}px of 600px${px > 600 ? ' (Google will cut it)' : s.length < 30 ? ' (a bit short)' : ''}` : 'Aim for 30 to 60 characters' } })
    const descCount = counter('description', [70, 160], (s) => ({ value: s.length, text: s ? `${s.length} of 160 characters${s.length > 160 ? ' (will be cut)' : s.length < 70 ? ' (a bit short)' : ''}` : 'Aim for 70 to 160 characters' }))

    const basics = h('div', { class: 'stack' },
      h('div', { class: 'stack', style: 'gap:6px' }, text('title', 'Page title', 'Handmade Ceramic Mugs | Clay & Co'), titleCount),
      h('div', { class: 'stack', style: 'gap:6px' }, text('description', 'Meta description', 'One or two sentences that make people click.', { multiline: true }), descCount),
      text('url', 'Canonical URL', 'https://www.example.com/page', { spell: false, hint: 'The one official address of this page.' }),
      h('div', { class: 'grid-2' },
        field('Language', select(LANGS, v.lang, (x) => change('lang', x))),
        text('author', 'Author', 'Your name or brand')),
      text('keywords', 'Keywords (optional)', 'comma, separated, words', { hint: 'Google ignores this tag. Add it only if another tool needs it.' }),
      h('div', { class: 'grid-2' },
        field('Theme color', h('input', { type: 'color', value: v.themeColor || '#5b4cf0', 'aria-label': 'Theme color', oninput: (e) => change('themeColor', e.target.value) }), v.themeColor ? null : 'Colors the browser bar on phones.'),
        text('favicon', 'Favicon URL (optional)', '/favicon.ico', { spell: false })))

    const social = h('div', { class: 'stack' },
      h('div', { class: 'grid-2' }, text('siteName', 'Site name', 'Clay & Co'), field('Content type', select([['website', 'Website'], ['article', 'Article'], ['product', 'Product'], ['profile', 'Profile'], ['video.other', 'Video']], v.ogType, (x) => change('ogType', x)))),
      text('image', 'Share image URL', 'https://www.example.com/og-image.jpg', { spell: false, hint: 'Use a full https address. 1200 x 630 pixels works best everywhere.' }),
      text('imageAlt', 'Image description', 'What the image shows (for screen readers)'),
      h('div', { class: 'grid-3' },
        field('X card', select([['summary_large_image', 'Large image'], ['summary', 'Small image']], v.twitterCard, (x) => change('twitterCard', x))),
        text('twitterSite', 'X site handle', '@yourbrand', { spell: false }),
        text('twitterCreator', 'X author handle', '@yourname', { spell: false })))

    const robotsBox = h('div', { class: 'stack' },
      h('div', { class: 'row' }, toggle('Let search engines index this page', v.index, (c) => change('index', c)), toggle('Let them follow links', v.follow, (c) => change('follow', c))),
      h('div', { class: 'stack', style: 'gap:8px' }, EXTRA_ROBOTS.map(([val, , hint]) => toggle(`${val}  -  ${hint}`, v.extraRobots.includes(val), (c) => change('extraRobots', c ? [...v.extraRobots, val] : v.extraRobots.filter((x) => x !== val))))),
      h('div', { class: 'stack', style: 'gap:8px' }, h('div', { class: 'wt-kicker' }, 'Include in the output'),
        toggle('Basics: charset and viewport', v.incCore, (c) => change('incCore', c)), toggle('Open Graph tags (Facebook, LinkedIn, WhatsApp)', v.incOg, (c) => change('incOg', c)), toggle('Twitter / X card tags', v.incTwitter, (c) => change('incTwitter', c))),
      note('"noindex" keeps a page out of search results. Do not use it on pages you want people to find.'))

    clear(formHost, tabs([{ id: 'basics', label: 'Basics', render: () => basics }, { id: 'social', label: 'Social sharing', render: () => social }, { id: 'robots', label: 'Robots and output', render: () => robotsBox }], 'basics'))
  }

  const codeEl = h('pre', { class: 'wt-code code-out', tabindex: 0, 'aria-label': 'Generated meta tags' })
  const hints = h('div', { class: 'stack', style: 'gap:8px' })
  const pvBox = h('div', { class: 'pvwrap' })
  const kindChips = segmented(PREVIEW_KINDS, pvKind, (k) => { pvKind = k; save('meta-tags:pv', k); renderPreview() }, 'Preview style')
  const devToggle = segmented([['desktop', 'Desktop'], ['mobile', 'Mobile']], 'desktop', (m) => { mobile = m === 'mobile'; renderPreview() }, 'Search preview device')
  const currentCode = () => `<head>\n${buildMeta(v)}\n</head>`

  function renderPreview() {
    devToggle.hidden = pvKind !== 'google'
    clear(pvBox, previewCard(pvKind, { title: v.title, description: v.description, image: v.image, url: v.url || 'https://www.example.com/', siteName: v.siteName, favicon: v.favicon && /^https?:/.test(v.favicon) ? v.favicon : '', large: v.twitterCard !== 'summary' || !v.image, mobile, empty: true }))
  }
  function renderOut() {
    const body = buildMeta(v)
    codeEl.textContent = body ? `<head>\n${body}\n</head>` : '<!-- Fill in the page title to start -->'
    clear(hints)
    if (!v.title) hints.append(note('Start with a page title. Everything updates as you type.'))
    if (v.url && !/^https?:\/\//i.test(v.url)) hints.append(alert('warn', 'The canonical URL should start with https:// so search engines treat it as the full address.'))
    if (v.image && !/^https:\/\//i.test(v.image)) hints.append(alert('warn', 'Use a full https:// address for the share image. Relative paths and http images often do not show in previews.'))
    if (v.incOg && v.title && !v.image) hints.append(note('No share image: links will look plain on social networks. Add one for much better click-through.'))
    if (!v.index) hints.append(alert('warn', 'This page is set to noindex, so search engines will drop it from results.'))
    for (const c of Object.values(counters)) c()
  }
  function change(key, val) { v[key] = val; persist(); renderOut(); renderPreview() }

  const reset = (vals) => { Object.assign(v, DEFAULTS, vals); persist(); buildForm(); renderOut(); renderPreview() }
  const form = h('div', { class: 'stack' },
    h('div', { class: 'row' }, button('Fill an example', { icon: 'wand-sparkles', variant: 'secondary', size: 'sm', onClick: () => reset(EXAMPLE) }),
      button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => reset({}) })),
    formHost)

  const right = h('div', { class: 'stack sticky' },
    h('section', { class: 'panel stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'wt-kicker' }, 'Live preview'), devToggle), kindChips, pvBox),
    h('section', { class: 'panel stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'wt-kicker' }, 'HTML for your <head>'), h('div', { class: 'row' }, copyButton(currentCode, 'Copy'), button('Download', { icon: 'download', size: 'sm', onClick: () => download(currentCode(), 'meta-tags.html', 'text/html') }))), hints, codeEl))
  root.append(h('div', { class: 't-meta' }, split(form, right, 'wide-left')))
  buildForm()
  renderOut()
  renderPreview()
}
