// Sitemap generator: from a pasted list of URLs or the links on one page (fetched via r.jina.ai). Download sitemap.xml.
import { h, icon, button, field, input, textarea, select, toggle, alert, clear, copyButton, download, debounce, split, tabs, busy, table, empty } from '../../lib/ui.js'
import { ensureStyle, pill, note, omnibar, getText, parseWebUrl, hashParam } from './_shared.js'

const FREQS = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']
const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|css|js|mjs|json|xml|rss|atom|woff2?|ttf|otf|eot|map|mp4|webm|mp3|wav|zip|gz|rar|7z|dmg|exe|apk|pdf|docx?|xlsx?|pptx?|csv)$/i
const TRACK = /^(utm_[a-z0-9_]+|fbclid|gclid|msclkid|igshid|mc_eid|mc_cid|_ga|ref)$/i
export const MAX_URLS = 50000

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Clean one URL: absolute, no #fragment, optional tracking-parameter removal and trailing-slash policy. Returns a string or null. */
export function normalizeUrl(raw, base, { stripTracking = true, slash = 'keep', forceHttps = false } = {}) {
  let u
  try { u = new URL(String(raw).trim(), base || undefined) } catch { return null }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) return null
  if (forceHttps) u.protocol = 'https:'
  u.hash = ''
  if (stripTracking && u.search) {
    const keep = [...u.searchParams].filter(([k]) => !TRACK.test(k))
    u.search = ''
    keep.forEach(([k, v]) => u.searchParams.append(k, v))
  }
  if (u.pathname !== '/' && !/\.[a-z0-9]{1,5}$/i.test(u.pathname)) {
    if (slash === 'add' && !u.pathname.endsWith('/')) u.pathname += '/'
    if (slash === 'remove' && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '') || '/'
  }
  return u.href
}

/** Pull page links out of r.jina.ai Markdown ([text](url) and bare links). Keeps same-host pages only, drops files and images. */
export function extractLinks(markdown, pageUrl, opts = {}) {
  const page = new URL(pageUrl)
  const found = new Set()
  const add = (href) => {
    if (!href || /^(mailto|tel|javascript|data):/i.test(href)) return
    const abs = normalizeUrl(href, page.href, opts)
    if (!abs) return
    const u = new URL(abs)
    if (u.hostname.replace(/^www\./, '') !== page.hostname.replace(/^www\./, '')) return
    if (ASSET.test(u.pathname)) return
    u.host = page.host // www.example.com and example.com are the same site: keep the address the person gave
    found.add(u.href)
  }
  for (const m of String(markdown).matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m[1])
  for (const m of String(markdown).matchAll(/(?<![(\["'])\bhttps?:\/\/[^\s)<>"'\]]+/g)) add(m[0].replace(/[.,;:!?]+$/, ''))
  return [...found]
}

/** Priority from how deep the page is: home 1.0, then 0.8, 0.6, 0.5, 0.4 (never below 0.3). */
export function autoPriority(url) {
  const u = new URL(url)
  const depth = u.pathname.split('/').filter(Boolean).length
  return depth === 0 ? 1 : [0.8, 0.6, 0.5, 0.4][depth - 1] ?? 0.3
}

/** entries: [{loc, priority?, changefreq?, lastmod?}] -> sitemap.xml text. */
export function buildSitemap(entries, { priorityNumbers = true } = {}) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
  for (const e of entries) {
    lines.push('  <url>', `    <loc>${xmlEsc(e.loc)}</loc>`)
    if (e.lastmod) lines.push(`    <lastmod>${xmlEsc(e.lastmod)}</lastmod>`)
    if (e.changefreq) lines.push(`    <changefreq>${e.changefreq}</changefreq>`)
    if (priorityNumbers && e.priority != null && e.priority !== '') lines.push(`    <priority>${Number(e.priority).toFixed(1)}</priority>`)
    lines.push('  </url>')
  }
  lines.push('</urlset>')
  return lines.join('\n') + '\n'
}

const CSS = `
.t-sm .rows .num { width: 4.5em; }
.t-sm td .select, .t-sm td .input { height: 34px; padding: 0 8px; font-size: 13px; min-width: 0; }
.t-sm td.url { max-width: 380px; overflow-wrap: anywhere; font-family: var(--mono); font-size: 12.5px; }
.t-sm .code { max-height: 300px; }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-sm-style')) document.head.append(h('style', { id: 't-sm-style' }, CSS))
  let rows = [] // {loc, on, priority: 'auto'|number, changefreq: 'auto'|string}
  const cfg = { freq: 'weekly', lastmod: 'today', date: today(), prio: 'auto', slash: 'keep', strip: true, https: false, priorities: true }
  const listEl = h('div')
  const xmlEl = h('pre', { class: 'wt-code code', tabindex: 0, 'aria-label': 'sitemap.xml preview' })
  const statsEl = h('div', { class: 'row' })
  const warnEl = h('div', { class: 'stack', style: 'gap:8px' })
  const errorTo = h('div')
  let xml = ''

  const pasted = textarea({ rows: 8, mono: true, spellcheck: false, 'aria-label': 'URLs, one per line', placeholder: 'https://example.com/\nhttps://example.com/about\nhttps://example.com/blog/hello-world\nexample.com/contact' })
  const siteIn = input({ placeholder: 'https://example.com', 'aria-label': 'Site address (optional)', spellcheck: false, value: '' })
  const skipNote = h('div', { class: 'small muted' })
  const normOpts = () => ({ stripTracking: cfg.strip, slash: cfg.slash, forceHttps: cfg.https })

  function setRows(urls, keep = true) {
    const old = new Map(rows.map((r) => [r.loc, r]))
    const seen = new Set()
    rows = urls.filter((u) => !seen.has(u) && seen.add(u)).map((u) => (keep && old.get(u)) || { loc: u, on: true, priority: 'auto', changefreq: 'auto' })
    renderList()
    renderXml()
  }
  function fromPasted() {
    let base = null
    try { base = siteIn.value.trim() ? parseWebUrl(siteIn.value).href : null } catch { /* ignored: absolute URLs still work */ }
    const urls = []
    let skipped = 0
    for (const tok of pasted.value.split(/[\s,]+/).filter(Boolean)) {
      if (!/[./]/.test(tok)) { skipped++; continue } // a real address has a dot or a slash
      const t = /^[a-z][a-z0-9+.-]*:/i.test(tok) || tok.startsWith('/') || tok.startsWith('.') ? tok : (base ? tok : 'https://' + tok)
      const n = normalizeUrl(t, base, normOpts())
      if (n) urls.push(n); else skipped++
    }
    setRows(urls)
    skipNote.textContent = skipped ? `${skipped} item${skipped === 1 ? '' : 's'} did not look like web addresses and ${skipped === 1 ? 'was' : 'were'} skipped.` : ''
  }
  pasted.addEventListener('input', debounce(fromPasted, 200))
  siteIn.addEventListener('input', debounce(fromPasted, 300))

  // From a page
  const crawlOut = h('div')
  const omni = omnibar({ icon: 'globe', placeholder: 'https://example.com', label: 'Find links', buttonIcon: 'search', busyLabel: 'Reading page', errorTo: crawlOut, onSubmit: async (v) => {
    const u = parseWebUrl(v)
    clear(crawlOut)
    const md = await getText(`https://r.jina.ai/${u.href}`, { signal, timeout: 40000, service: 'The page reader (r.jina.ai)' })
    if (/^Warning: Target URL returned error (\d+)/m.test(md)) throw new Error(`That page answered with an error (${md.match(/error (\d+)/)[1]}), so there are no links to read.`)
    const links = extractLinks(md, u.href, normOpts())
    const home = normalizeUrl(u.href, null, normOpts())
    const all = [home, ...links.filter((l) => l !== home)]
    if (all.length < 2) clear(crawlOut, alert('warn', 'No other pages were linked from that page. If the site builds its menu with JavaScript, the reader may not see them. Paste the URLs instead.'))
    else clear(crawlOut, alert('success', `Found ${all.length} pages on ${u.hostname}. Untick any you do not want below.`))
    setRows(all, false)
    omni.input.blur()
  } })
  omni.input.value = hashParam('q')

  // Settings
  const set = (patch) => { Object.assign(cfg, patch); renderList(); renderXml() }
  const freqSel = select([['', 'Leave out'], ...FREQS.map((f) => [f, f])], cfg.freq, (v) => set({ freq: v }))
  const lmSel = select([['today', 'Today'], ['none', 'Leave out'], ['custom', 'A date I choose']], cfg.lastmod, (v) => { set({ lastmod: v }); dateIn.hidden = v !== 'custom' })
  const dateIn = h('input', { class: 'input', type: 'date', value: cfg.date, hidden: true, 'aria-label': 'Last modified date', onchange: (e) => set({ date: e.target.value }) })
  const prioSel = select([['auto', 'Automatic (home page highest)'], ['0.5', 'All 0.5'], ['none', 'Leave out']], cfg.prio, (v) => set({ prio: v }))
  const slashSel = select([['keep', 'Keep as listed'], ['add', 'Always add a trailing slash'], ['remove', 'Remove trailing slash']], cfg.slash, (v) => { cfg.slash = v; reapply() })
  const settings = h('div', { class: 'grid-auto', style: '--min: 220px' },
    field('Change frequency', freqSel), field('Last modified', lmSel, null), field('Priority', prioSel), field('Trailing slashes', slashSel),
    h('div', { class: 'stack', style: 'gap:8px;align-content:end' }, dateIn, toggle('Remove tracking parameters (utm_, fbclid)', true, (c) => { cfg.strip = c; reapply() }), toggle('Force https', false, (c) => { cfg.https = c; reapply() })))
  function reapply() {
    setRows(rows.map((r) => normalizeUrl(r.loc, null, normOpts()) || r.loc))
  }

  const effective = (r) => ({
    loc: r.loc,
    lastmod: cfg.lastmod === 'none' ? '' : cfg.lastmod === 'custom' ? cfg.date : today(),
    changefreq: r.changefreq !== 'auto' ? r.changefreq : cfg.freq,
    priority: cfg.prio === 'none' ? '' : r.priority !== 'auto' ? r.priority : cfg.prio === 'auto' ? autoPriority(r.loc) : Number(cfg.prio),
  })

  function renderList() {
    clear(listEl)
    if (!rows.length) return listEl.append(empty('Add URLs on the left, or let the tool read the links on a page.', 'network'))
    const shown = rows.slice(0, 300)
    const allOn = rows.every((r) => r.on)
    const head = h('div', { class: 'row', style: 'justify-content:space-between' },
      h('div', { class: 'row' }, pill(`${rows.filter((r) => r.on).length} of ${rows.length} included`, 'accent'), toggle('Select all', allOn, (c) => { rows.forEach((r) => (r.on = c)); renderList(); renderXml() })),
      button('Clear list', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { rows = []; pasted.value = ''; renderList(); renderXml() } }))
    const prioOpts = [['auto', 'Auto'], ...[1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1].map((p) => [String(p), p.toFixed(1)])]
    const t = table({ columns: ['', 'Page', 'Priority', 'Change'], rows: shown.map((r) => [
      h('input', { type: 'checkbox', checked: r.on, 'aria-label': `Include ${r.loc}`, onchange: (e) => { r.on = e.target.checked; renderXml(); head.firstChild.firstChild.textContent = `${rows.filter((x) => x.on).length} of ${rows.length} included` } }),
      h('span', { class: 'mono small' }, r.loc),
      select(prioOpts, String(r.priority), (v) => { r.priority = v === 'auto' ? 'auto' : Number(v); renderXml() }),
      select([['auto', 'Auto'], ...FREQS.map((f) => [f, f])], r.changefreq, (v) => { r.changefreq = v; renderXml() }),
    ]), max: 300 })
    listEl.append(head, t, rows.length > 300 ? note(`Showing the first 300 of ${rows.length} pages. All included pages are in the file.`) : null)
    for (const td of t.querySelectorAll('tbody tr td:nth-child(2)')) td.classList.add('url')
  }

  function renderXml() {
    const on = rows.filter((r) => r.on)
    clear(warnEl)
    const entries = on.slice(0, MAX_URLS).map(effective)
    xml = entries.length ? buildSitemap(entries, { priorityNumbers: cfg.prio !== 'none' }) : ''
    xmlEl.textContent = xml ? (xml.length > 6000 ? `${xml.slice(0, 6000)}\n<!-- preview shortened: the download has all ${entries.length} URLs -->` : xml) : '<!-- Add some URLs to see the sitemap -->'
    clear(statsEl, pill(`${entries.length} URLs`, entries.length ? 'accent' : ''), xml ? pill(`${(new Blob([xml]).size / 1024).toFixed(1)} KB`) : null)
    dlBtn.disabled = !xml
    if (on.length > MAX_URLS) warnEl.append(alert('warn', `A sitemap can hold ${MAX_URLS.toLocaleString()} URLs. Only the first ${MAX_URLS.toLocaleString()} are in the file. Split the rest into a second sitemap.`))
    const hosts = new Set(on.map((r) => { try { return new URL(r.loc).host } catch { return '' } }))
    if (hosts.size > 1) warnEl.append(alert('warn', `Your URLs use ${hosts.size} different hosts (${[...hosts].slice(0, 3).join(', ')}). A sitemap may only list pages of the site it is uploaded to.`))
    const long = on.filter((r) => r.loc.length > 2048)
    if (long.length) warnEl.append(alert('warn', `${long.length} URL(s) are longer than 2,048 characters and will be ignored by search engines.`))
    if (hosts.size === 1 && xml) warnEl.append(note(`Upload it to the root of your site, then add this line to robots.txt: Sitemap: https://${[...hosts][0]}/sitemap.xml`))
    if (xml && cfg.prio !== 'none') warnEl.append(note('Google ignores priority and changefreq and only uses an honest lastmod. Bing and others may still read them.'))
  }
  const dlBtn = button('Download sitemap.xml', { icon: 'download', variant: 'primary', onClick: () => xml && download(xml, 'sitemap.xml', 'application/xml') })

  const input1 = h('section', { class: 'panel stack' }, tabs([
    { id: 'paste', label: 'Paste URLs', render: () => h('div', { class: 'stack' }, field('Your URLs', pasted, 'One per line. Domains without https:// are fine.'), skipNote, field('Site address (optional)', siteIn, 'Lets you paste short paths like /about or /blog/post.')) },
    { id: 'page', label: 'From a page', render: () => h('div', { class: 'stack' }, omni.el, crawlOut, note('Reads the links on that one page through the free r.jina.ai reader (the page address is sent to it). It does not crawl the whole site, so for big sites paste your URL list instead.')) },
  ], 'paste'))
  const left = h('div', { class: 'stack' }, input1, h('section', { class: 'panel stack' }, h('h2', { style: 'margin:0' }, 'Defaults'), settings), h('section', { class: 'panel stack' }, h('h2', { style: 'margin:0' }, 'Pages'), listEl))
  const right = h('div', { class: 'stack', style: 'position:sticky;top:calc(var(--header-h) + 16px);align-self:start' },
    h('section', { class: 'panel stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'wt-kicker' }, 'sitemap.xml'), statsEl),
      xmlEl, warnEl, h('div', { class: 'row' }, dlBtn, copyButton(() => xml, 'Copy XML'))))
  root.append(h('div', { class: 't-sm' }, split(left, right, 'wide-left')))
  renderList()
  renderXml()
  if (omni.input.value) { input1.querySelector('[role=tab]:nth-child(2)')?.click(); omni.run() }
}
