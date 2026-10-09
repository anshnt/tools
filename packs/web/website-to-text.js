// Website to text: the readable text (or Markdown) of any web page, fetched through the free r.jina.ai reader.
import { h, icon, button, alert, clear, copyButton, download, segmented, toggle, tabs, stats, toast } from '../../lib/ui.js'
import { marked, dompurify } from '../../lib/libs.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, note, omnibar, getText, parseWebUrl, recents, recentChips, skeleton, hashParam, setHashParams, slug, fixMojibake } from './_shared.js'

/** Split the r.jina.ai reply into {title, source, published, warning, body}. */
export function parseJina(text) {
  const t = String(text).replace(/\r/g, '')
  const marker = t.indexOf('Markdown Content:')
  const head = marker >= 0 ? t.slice(0, marker) : ''
  const body = (marker >= 0 ? t.slice(marker + 'Markdown Content:'.length) : t).replace(/^\n+/, '')
  const pick = (k) => (new RegExp(`^${k}:\\s*(.*)$`, 'mi').exec(head)?.[1] || '').trim()
  return { title: pick('Title'), source: pick('URL Source'), published: pick('Published Time'), warning: pick('Warning'), body: body.trim() }
}

/** Markdown -> readable plain text. Pure. opts: {links: 'drop' | 'keep'} */
export function mdToText(md, { links = 'drop' } = {}) {
  let s = String(md).replace(/\r/g, '')
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  s = s.replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, (_, text, url) => {
    const label = text.trim()
    if (!label) return ''
    return links === 'keep' && /^https?:/i.test(url) && label !== url && !/^\[?\d+\]?$/.test(label) ? `${label} (${url})` : label
  })
  s = s.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  s = s.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
  s = s.replace(/^[ \t]*>[ \t]?/gm, '')
  s = s.replace(/^([ \t]*)[*+][ \t]+/gm, '$1- ')
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, '$1$2').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, '$1$2')
  s = s.replace(/`([^`\n]+)`/g, '$1')
  s = s.replace(/^[ \t]*\|?[ \t:|-]*-{2,}[ \t:|-]*\|?[ \t]*$\n?/gm, '')
  s = s.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, row) => row.split('|').map((c) => c.trim()).join('\t'))
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/** Apply the display options to Markdown: drop images and/or links but keep the Markdown structure. */
export function tidyMarkdown(md, { images = true, links = true } = {}) {
  let s = md
  if (!images) s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  if (!links) s = s.replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?[^)\s>]+>?(?:\s+"[^"]*")?\s*\)/g, '$1')
  return s.replace(/^[ \t]*[-*][ \t]*$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
}

const CSS = `
.t-w2t .head { display: grid; gap: 8px; padding: 18px 20px; }
.t-w2t .head .ttl { font: 700 clamp(18px, 3.4vw, 26px)/1.25 var(--font); letter-spacing: -.02em; overflow-wrap: anywhere; }
.t-w2t textarea { min-height: 420px; font-family: var(--mono); font-size: 13.5px; line-height: 1.6; }
.t-w2t .md-preview { padding: 16px 20px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); min-height: 420px; max-height: 640px; overflow: auto; }
.t-w2t .md-preview img { max-width: 100%; height: auto; } .t-w2t .md-preview pre { background: var(--surface-2); padding: 12px; border-radius: 10px; overflow: auto; }
.t-w2t .md-preview table { border-collapse: collapse; } .t-w2t .md-preview td, .t-w2t .md-preview th { border: 1px solid var(--border); padding: 5px 9px; }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-w2t-style')) document.head.append(h('style', { id: 't-w2t-style' }, CSS))
  const rec = recents('w2t', 8)
  const o = { format: 'md', links: true, urls: false, images: true, ...load('w2t:opts', {}) }
  let data = null // {title, source, published, warning, body, url}
  const err = h('div'), out = h('div', { class: 'stack' })
  let chipsRecent

  const text = () => {
    if (!data) return ''
    return o.format === 'md' ? tidyMarkdown(data.body, { images: o.images, links: o.links }) : mdToText(data.body, { links: o.urls ? 'keep' : 'drop' })
  }

  function render() {
    if (!data) return
    const body = text()
    const words = (body.match(/\S+/g) || []).length
    const ta = h('textarea', { class: 'textarea', readonly: true, 'aria-label': o.format === 'md' ? 'Page as Markdown' : 'Page as plain text', value: body })
    const preview = h('div', { class: 'md-preview prose' })
    const t = tabs([{ id: 'text', label: o.format === 'md' ? 'Markdown' : 'Plain text', render: () => ta }, { id: 'view', label: 'Reader view', render: () => preview }], 'text', async (id) => {
      if (id !== 'view' || preview.dataset.done === body) return
      try {
        const [mk, purify] = await Promise.all([marked(), dompurify()])
        const html = (mk.marked || mk).parse(tidyMarkdown(data.body, { images: o.images, links: o.links }), { gfm: true })
        preview.innerHTML = purify.sanitize(html)
        preview.querySelectorAll('a').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer' })
        preview.dataset.done = body
      } catch { clear(preview, 'Could not load the reader view.') }
    })
    const ext = o.format === 'md' ? 'md' : 'txt'
    const fname = `${slug(data.title || data.url, 50)}.${ext}`
    clear(out,
      h('section', { class: 'panel head wt-mesh' }, h('div', { class: 'wt-kicker' }, 'Extracted from'), h('div', { class: 'ttl' }, data.title || data.url),
        h('div', { class: 'row' }, h('a', { class: 'wt-link small', href: data.url, target: '_blank', rel: 'noopener noreferrer' }, data.url), data.published ? pill(`Published ${data.published.slice(0, 10)}`, 'info') : null)),
      data.warning ? alert('warn', data.warning) : null,
      !body ? alert('warn', 'The reader found no text on that page. It may need a login, block automated readers, or build its content with JavaScript.') : null,
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'row' }, segmented([['md', 'Markdown'], ['txt', 'Plain text']], o.format, (v) => { o.format = v; save('w2t:opts', o); render() }, 'Output format'),
          o.format === 'md' ? toggle('Keep links', o.links, (c) => { o.links = c; save('w2t:opts', o); render() }) : toggle('Show link addresses', o.urls, (c) => { o.urls = c; save('w2t:opts', o); render() }), o.format === 'md' ? toggle('Keep images', o.images, (c) => { o.images = c; save('w2t:opts', o); render() }) : null),
        h('div', { class: 'row' }, copyButton(() => text(), 'Copy'), button(`Download .${ext}`, { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(`${o.format === 'md' && data.title && !/^#\s/.test(body) ? `# ${data.title}

` : ''}${body}
`, fname, 'text/plain')}))),
      t,
      body ? stats([{ label: 'Words', value: words.toLocaleString(), accent: true }, { label: 'Characters', value: body.length.toLocaleString() }, { label: 'Reading time', value: words < 120 ? 'under 1 min' : `${Math.round(words / 238)} min` }, { label: 'Lines', value: body.split('\n').length.toLocaleString() }]) : null,
      note('Fetched through the free r.jina.ai reader, which loads the page on its servers and returns the text. The address you enter is sent to it. Limited to roughly 20 requests a minute without an account.'))
  }

  const omni = omnibar({ icon: 'file-text', placeholder: 'https://example.com/article', label: 'Get text', buttonIcon: 'download', busyLabel: 'Reading page', errorTo: err, onSubmit: async (v) => {
    clear(err)
    const u = parseWebUrl(v)
    clear(out, skeleton(5))
    let raw
    try { raw = await getText(`https://r.jina.ai/${u.href}`, { signal, timeout: 45000, service: 'The page reader (r.jina.ai)' }) } catch (e) { clear(out); throw e }
    const p = parseJina(raw)
    p.title = fixMojibake(p.title); p.body = fixMojibake(p.body)
    data = { ...p, url: p.source || u.href }
    if (/Target URL returned error (4|5)\d\d/i.test(p.warning) && p.body.length < 200) { clear(out); throw new Error(`The page answered with an error: ${p.warning.replace(/^Target URL returned error\s*/i, '')}. There is no text to extract.`) }
    rec.add(u.href); chipsRecent.refresh(); setHashParams({ q: u.href })
    render()
  } })
  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent' })
  root.append(h('div', { class: 't-w2t stack' }, omni.el, err, chipsRecent, out))
  clear(out, h('div', { class: 'wt-empty-hero' }, icon('file-text'), h('div', 'Paste a link to get the article text without ads, menus or scripts.')))
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() }
}
