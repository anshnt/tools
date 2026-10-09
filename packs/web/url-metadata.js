// URL metadata and link preview: what a link looks like in Google, X, Facebook, LinkedIn and WhatsApp, and which tags it has (via Microlink).
import { h, icon, button, alert, clear, copyText, copyButton, segmented, table, stats } from '../../lib/ui.js'
import { ensureStyle, pill, note, omnibar, microlink, quotaNote, parseWebUrl, recents, recentChips, skeleton, hashParam, setHashParams, fixMojibake, textWidth } from './_shared.js'
import { previewCard, PREVIEW_KINDS } from './_preview.js'

// CSS rules Microlink evaluates on the page: [selector, attribute]
const RULES = {
  htmlTitle: ['title', null], metaDescription: ['meta[name="description"]', 'content'], canonical: ['link[rel="canonical"]', 'href'], robots: ['meta[name="robots"]', 'content'], keywords: ['meta[name="keywords"]', 'content'],
  viewport: ['meta[name="viewport"]', 'content'], themeColor: ['meta[name="theme-color"]', 'content'], favicon: ['link[rel~="icon"]', 'href'], htmlLang: ['html', 'lang'],
  ogTitle: ['meta[property="og:title"]', 'content'], ogDescription: ['meta[property="og:description"]', 'content'], ogImage: ['meta[property="og:image"]', 'content'], ogImageAlt: ['meta[property="og:image:alt"]', 'content'],
  ogType: ['meta[property="og:type"]', 'content'], ogUrl: ['meta[property="og:url"]', 'content'], ogSiteName: ['meta[property="og:site_name"]', 'content'], ogLocale: ['meta[property="og:locale"]', 'content'],
  twCard: ['meta[name="twitter:card"]', 'content'], twTitle: ['meta[name="twitter:title"]', 'content'], twDescription: ['meta[name="twitter:description"]', 'content'], twImage: ['meta[name="twitter:image"]', 'content'], twSite: ['meta[name="twitter:site"]', 'content'],
}
const TAG_LABELS = { htmlTitle: '<title>', metaDescription: 'description', canonical: 'canonical', robots: 'robots', keywords: 'keywords', viewport: 'viewport', themeColor: 'theme-color', favicon: 'icon', htmlLang: 'html lang',
  ogTitle: 'og:title', ogDescription: 'og:description', ogImage: 'og:image', ogImageAlt: 'og:image:alt', ogType: 'og:type', ogUrl: 'og:url', ogSiteName: 'og:site_name', ogLocale: 'og:locale',
  twCard: 'twitter:card', twTitle: 'twitter:title', twDescription: 'twitter:description', twImage: 'twitter:image', twSite: 'twitter:site' }

export function ruleParams() {
  const p = {}
  for (const [k, [sel, attr]] of Object.entries(RULES)) { p[`data.${k}.selector`] = sel; if (attr) p[`data.${k}.attr`] = attr }
  return p
}
const abs = (u, base) => { try { return u ? new URL(u, base).href : '' } catch { return u || '' } }
const imgUrl = (x) => (typeof x === 'string' ? x : x?.url || '')

/** Turn Microlink's data into one flat record with per-platform fallbacks. Pure. */
export function normalize(d, requested) {
  const clean = (s) => (typeof s === 'string' ? fixMojibake(s).replace(/\s+/g, ' ').trim() : '')
  const url = d.url || requested
  const t = {}
  for (const k of Object.keys(RULES)) t[k] = clean(d[k])
  const img = d.image || {}
  const ogImage = abs(t.ogImage || imgUrl(img), url)
  return {
    url, requested, status: d.statusCode, redirects: d.redirects || [], tags: t,
    title: clean(d.title), description: clean(d.description), publisher: clean(d.publisher), author: clean(d.author), lang: clean(d.lang) || t.htmlLang, date: d.date || '',
    logo: abs(imgUrl(d.logo), url), image: ogImage, imageInfo: { width: img.width, height: img.height, type: img.type, size: img.size_pretty },
    google: { title: t.htmlTitle || t.ogTitle || clean(d.title), description: t.metaDescription || t.ogDescription || clean(d.description) },
    og: { title: t.ogTitle || t.htmlTitle || clean(d.title), description: t.ogDescription || t.metaDescription || clean(d.description), image: ogImage, siteName: t.ogSiteName || clean(d.publisher) },
    x: { title: t.twTitle || t.ogTitle || t.htmlTitle || clean(d.title), description: t.twDescription || t.ogDescription || t.metaDescription || clean(d.description), image: abs(t.twImage, url) || ogImage, large: /large/i.test(t.twCard) || !t.twCard },
  }
}

/** SEO and sharing checks. Returns [{label, state: 'good'|'warn'|'bad', detail}]. Pure. */
export function audit(n) {
  const out = []
  const add = (label, state, detail) => out.push({ label, state, detail })
  const title = n.tags.htmlTitle || n.title
  const tw = title ? textWidth(title, '400 20px Arial') : 0
  if (!title) add('Page title', 'bad', 'Missing. Every page needs a <title>.')
  else if (title.length < 25) add('Page title', 'warn', `${title.length} characters is short. Aim for 30 to 60.`)
  else if (tw > 600) add('Page title', 'warn', `${title.length} characters. Google will likely cut it off. Aim for 30 to 60.`)
  else add('Page title', 'good', `${title.length} characters, fits in search results.`)
  const desc = n.tags.metaDescription || n.description
  if (!n.tags.metaDescription) add('Meta description', desc ? 'warn' : 'bad', desc ? 'No description tag. Search engines will pick text from the page.' : 'Missing. Add a 70 to 160 character summary.')
  else if (desc.length < 70) add('Meta description', 'warn', `${desc.length} characters is short. Aim for 70 to 160.`)
  else if (desc.length > 165) add('Meta description', 'warn', `${desc.length} characters, it will be cut. Aim for 70 to 160.`)
  else add('Meta description', 'good', `${desc.length} characters.`)
  add('Open Graph tags', n.tags.ogTitle && n.tags.ogImage ? 'good' : n.tags.ogTitle || n.tags.ogImage ? 'warn' : 'bad', n.tags.ogTitle && n.tags.ogImage ? 'og:title and og:image are set.' : n.tags.ogTitle || n.tags.ogImage ? 'Some Open Graph tags are missing (need og:title and og:image).' : 'None found. Links will look plain on Facebook, LinkedIn and WhatsApp.')
  const w = n.imageInfo.width, ht = n.imageInfo.height
  if (!n.image) add('Share image', 'bad', 'No share image found. Add og:image (1200 x 630 pixels is ideal).')
  else if (w && ht && (w < 600 || ht < 315)) add('Share image', 'warn', `${w} x ${ht} pixels is small. Use at least 1200 x 630.`)
  else if (w && ht && Math.abs(w / ht - 1.91) > 0.3) add('Share image', 'warn', `${w} x ${ht} pixels will be cropped. The ideal ratio is 1.91:1 (1200 x 630).`)
  else add('Share image', 'good', w && ht ? `${w} x ${ht} pixels.` : 'Found.')
  add('X / Twitter card', n.tags.twCard ? 'good' : 'warn', n.tags.twCard ? `twitter:card is ${n.tags.twCard}.` : 'No twitter:card tag. X falls back to Open Graph, but setting summary_large_image gives the big preview.')
  add('Canonical URL', n.tags.canonical ? 'good' : 'warn', n.tags.canonical ? n.tags.canonical : 'Not set. A canonical tag tells search engines the preferred address and avoids duplicate pages.')
  add('Language', n.lang ? 'good' : 'warn', n.lang ? `html lang is "${n.lang}".` : 'No lang attribute on <html>. It helps screen readers and search engines.')
  add('Mobile viewport', n.tags.viewport ? 'good' : 'bad', n.tags.viewport ? n.tags.viewport : 'No viewport tag. The page may look tiny on phones.')
  if (/noindex/i.test(n.tags.robots)) add('Indexing', 'warn', `robots says "${n.tags.robots}". Search engines are told not to list this page.`)
  add('Favicon', n.tags.favicon || n.logo ? 'good' : 'warn', n.tags.favicon || n.logo ? 'Found.' : 'No icon link found. Browsers will look for /favicon.ico.')
  return out
}

const CSS = `
.t-meta2 .id { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; align-items: center; padding: 18px 20px; text-align: left; }
.t-meta2 .id .lg { width: 56px; height: 56px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); display: grid; place-items: center; overflow: hidden; }
.t-meta2 .id .lg img { width: 100%; height: 100%; object-fit: contain; padding: 6px; } .t-meta2 .id .lg .icon { width: 26px; height: 26px; color: var(--muted); }
.t-meta2 .id .tt { font: 700 clamp(18px, 3.4vw, 24px)/1.25 var(--font); letter-spacing: -.02em; overflow-wrap: anywhere; }
.t-meta2 .cols { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); align-items: start; }
.t-meta2 .chk { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; padding: 10px 4px; border-top: 1px solid var(--border); }
.t-meta2 .chk:first-child { border-top: 0; }
.t-meta2 .chk .ic { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; grid-row: 1 / 3; margin-top: 1px; }
.t-meta2 .chk .ic .icon { width: 14px; height: 14px; }
.t-meta2 .chk.good .ic { background: var(--success-soft); color: var(--success); } .t-meta2 .chk.warn .ic { background: var(--warning-soft); color: var(--warning); } .t-meta2 .chk.bad .ic { background: var(--danger-soft); color: var(--danger); }
.t-meta2 .chk b { font-size: 14px; } .t-meta2 .chk span.d { color: var(--text-2); font-size: 13px; overflow-wrap: anywhere; }
.t-meta2 .pvbox { overflow: hidden; padding-top: 6px; }
.t-meta2 td.v { max-width: 420px; overflow-wrap: anywhere; font-family: var(--mono); font-size: 12.5px; }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-meta2-style')) document.head.append(h('style', { id: 't-meta2-style' }, CSS))
  const rec = recents('metadata', 8)
  const err = h('div'), out = h('div', { class: 'stack' })
  let chipsRecent
  let kind = 'google'
  let mobile = false

  function view(n, raw, quota) {
    const results = audit(n)
    const good = results.filter((r) => r.state === 'good').length
    const score = Math.round((good / results.length) * 100)
    const pvBox = h('div', { class: 'pvbox' })
    const draw = () => {
      const o = n.og, x = n.x, g = n.google
      const data = { google: { title: g.title, description: g.description, image: '', url: n.url, siteName: o.siteName || n.publisher, favicon: n.tags.favicon ? abs(n.tags.favicon, n.url) : n.logo, mobile },
        x: { title: x.title, description: x.description, image: x.image, url: n.url, large: x.large }, facebook: { title: o.title, description: o.description, image: o.image, url: n.url }, linkedin: { title: o.title, description: o.description, image: o.image, url: n.url }, whatsapp: { title: o.title, description: o.description, image: o.image, url: n.url } }
      clear(pvBox, previewCard(kind, data[kind]))
    }
    const seg = segmented(PREVIEW_KINDS, kind, (k) => { kind = k; draw(); dev.hidden = k !== 'google' }, 'Preview style')
    const dev = segmented([['desktop', 'Desktop'], ['mobile', 'Mobile']], 'desktop', (m) => { mobile = m === 'mobile'; draw() }, 'Search preview device')
    dev.hidden = kind !== 'google'
    draw()
    const tagRows = Object.entries(TAG_LABELS).filter(([k]) => n.tags[k]).map(([k, label]) => [h('b', { class: 'mono small' }, label), h('span', { class: 'v' }, n.tags[k]), button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${label}`, onClick: () => copyText(n.tags[k]) })])
    const chain = [n.requested, ...n.redirects.map((r) => r.url || r)].filter((v, i, a) => v && a.indexOf(v) === i)
    const redirected = n.url && n.requested && new URL(n.url).href !== new URL(n.requested).href
    clear(out,
      h('section', { class: 'panel id wt-mesh' }, h('div', { class: 'lg' }, n.logo ? h('img', { src: n.logo, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(icon('globe')) }) : icon('globe')),
        h('div', { class: 'stack', style: 'gap:6px;min-width:0' }, h('div', { class: 'tt' }, n.og.title || n.title || n.url), h('a', { class: 'wt-link small', href: n.url, target: '_blank', rel: 'noopener noreferrer' }, n.url),
          h('div', { class: 'wt-chips' }, n.status ? pill(`HTTP ${n.status}`, n.status < 300 ? 'ok' : n.status < 400 ? 'warn' : 'bad') : null, n.publisher ? pill(n.publisher) : null, n.lang ? pill(n.lang) : null, n.author ? pill(`By ${n.author}`) : null, redirected ? pill('Redirected', 'warn', 'corner-down-right') : null, quotaNote(quota)))),
      redirected ? alert('info', `You entered ${n.requested}, which led to `, h('b', { style: 'overflow-wrap:anywhere' }, n.url), '. Previews use the final page.') : null,
      h('div', { class: 'cols' },
        h('section', { class: 'panel stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0' }, 'Link preview'), dev), seg, pvBox),
        h('section', { class: 'panel stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0' }, 'Checks'), pill(`${good} of ${results.length} good`, score >= 75 ? 'ok' : score >= 50 ? 'warn' : 'bad')),
          h('div', results.map((r) => h('div', { class: ['chk', r.state] }, h('span', { class: 'ic' }, icon(r.state === 'good' ? 'check' : r.state === 'warn' ? 'triangle-alert' : 'x')), h('b', r.label), h('span', { class: 'd' }, r.detail)))))),
      tagRows.length ? h('section', { class: 'stack' }, h('h2', { style: 'margin:0' }, `Tags found (${tagRows.length})`), table({ columns: ['Tag', 'Value', ''], rows: tagRows })) : alert('warn', 'No meta tags were found in the page head. The page may build them with JavaScript after loading, which social networks do not run.'),
      n.image ? h('section', { class: 'panel stack' }, h('h2', { style: 'margin:0' }, 'Share image'), h('div', { class: 'row', style: 'align-items:flex-start' }, h('img', { src: n.image, alt: '', referrerpolicy: 'no-referrer', style: 'max-width:min(100%,360px);border-radius:12px;border:1px solid var(--border)', onerror: (e) => e.target.replaceWith(h('div', { class: 'muted' }, 'The image could not be loaded.')) }),
        h('div', { class: 'stack', style: 'gap:6px' }, n.imageInfo.width ? pill(`${n.imageInfo.width} x ${n.imageInfo.height} px`) : null, n.imageInfo.type ? pill(String(n.imageInfo.type).toUpperCase()) : null, n.imageInfo.size ? pill(n.imageInfo.size) : null, copyButton(() => n.image, 'Copy image URL')))) : null,
      h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center' }, 'Raw data'), h('pre', { class: 'wt-code', style: 'margin-top:10px;max-height:360px' }, JSON.stringify(raw, null, 2))),
      note('Read through the free Microlink API (about 25 to 50 requests a day per network). Previews are approximations of how each network draws a link card, which each platform changes from time to time.'))
  }

  const omni = omnibar({ icon: 'tags', placeholder: 'https://example.com/page', label: 'Get metadata', buttonIcon: 'search', busyLabel: 'Reading page', errorTo: err, onSubmit: async (v) => {
    clear(err)
    const u = parseWebUrl(v)
    clear(out, skeleton(5))
    let r
    try { r = await microlink({ url: u.href, meta: true, ...ruleParams() }, { signal }) } catch (e) { clear(out); throw e }
    rec.add(u.href); chipsRecent.refresh(); setHashParams({ q: u.href })
    view(normalize({ ...r.data, statusCode: r.body?.statusCode, redirects: r.body?.redirects }, u.href), r.data, r.quota)
  } })
  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent', fmt: (v) => v.replace(/^https?:\/\//, '') })
  root.append(h('div', { class: 't-meta2 stack' }, omni.el, err, chipsRecent, out))
  clear(out, h('div', { class: 'wt-empty-hero' }, icon('tags'), h('div', 'Paste a link to see how it looks when shared, and what is missing.'),
    h('div', { class: 'wt-chips', style: 'justify-content:center;margin-top:14px' }, ['https://github.com', 'https://www.wikipedia.org'].map((d) => h('button', { type: 'button', class: 'wt-chip', onclick: () => { omni.set(d); omni.run() } }, d.replace('https://', ''))))))
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() }
}
