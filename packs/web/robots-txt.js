// robots.txt generator with presets, import and a "can this bot fetch this URL?" tester. Runs locally.
import { h, icon, button, field, input, textarea, panel, alert, clear, copyButton, download, debounce, split } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, note, chipGroup } from './_shared.js'

export const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'Google-Extended', 'PerplexityBot', 'CCBot', 'Bytespider', 'Applebot-Extended', 'cohere-ai', 'Meta-ExternalAgent', 'Amazonbot', 'Diffbot']
const COMMON_AGENTS = ['*', 'Googlebot', 'Googlebot-Image', 'Bingbot', 'DuckDuckBot', 'Baiduspider', 'YandexBot', 'Slurp', 'facebookexternalhit', 'Twitterbot', 'LinkedInBot', 'AhrefsBot', 'SemrushBot', 'MJ12bot', ...AI_BOTS]

const group = (agents, disallow = [], allow = [], crawlDelay = '') => ({ agents, disallow: disallow.join('\n'), allow: allow.join('\n'), crawlDelay })
export const PRESETS = {
  allow: { label: 'Allow everything', model: () => ({ groups: [group('*', [''])], sitemaps: '' }) },
  block: { label: 'Block everything', model: () => ({ groups: [group('*', ['/'])], sitemaps: '' }) },
  wordpress: { label: 'WordPress', model: () => ({ groups: [group('*', ['/wp-admin/', '/wp-login.php', '/?s=', '/search/', '/wp-json/'], ['/wp-admin/admin-ajax.php'])], sitemaps: '' }) },
  ai: { label: 'Block AI bots', model: () => ({ groups: [group('*', ['']), group(AI_BOTS.join(', '), ['/'])], sitemaps: '' }) },
  shop: { label: 'Online shop', model: () => ({ groups: [group('*', ['/cart', '/checkout', '/account', '/search', '/*?sort=', '/*?filter=', '/*?session='])], sitemaps: '' }) },
}

const lines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
const agentsOf = (s) => String(s || '').split(/[,\n]/).map((a) => a.trim()).filter(Boolean)

/** Build the robots.txt text from the model. */
export function buildRobots(model, { header = true } = {}) {
  const out = []
  if (header) out.push('# robots.txt', '')
  for (const g of model.groups) {
    const agents = agentsOf(g.agents)
    if (!agents.length) continue
    agents.forEach((a) => out.push(`User-agent: ${a}`))
    const allow = lines(g.allow)
    const dLines = lines(g.disallow)
    // An empty Disallow means "allow all"; keep it explicit when the group has no other rules.
    if (!dLines.length && !allow.length) out.push('Disallow:')
    allow.forEach((p) => out.push(`Allow: ${p}`))
    dLines.forEach((p) => out.push(`Disallow: ${p}`))
    if (String(g.crawlDelay).trim() !== '' && Number(g.crawlDelay) > 0) out.push(`Crawl-delay: ${Number(g.crawlDelay)}`)
    out.push('')
  }
  const maps = lines(model.sitemaps)
  maps.forEach((m) => out.push(`Sitemap: ${m}`))
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n') + '\n'
}

/** Parse an existing robots.txt into the editor model. */
export function parseRobots(text) {
  const groups = []
  const sitemaps = []
  let cur = null
  let lastWasAgent = false
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) { continue }
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const val = line.slice(i + 1).trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], disallow: [], allow: [], crawlDelay: '' }; groups.push(cur) }
      cur.agents.push(val)
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (key === 'sitemap') { sitemaps.push(val); continue }
    if (!cur) continue
    if (key === 'disallow') { if (val) cur.disallow.push(val) } else if (key === 'allow') { if (val) cur.allow.push(val) } else if (key === 'crawl-delay') cur.crawlDelay = val
  }
  return { groups: groups.map((g) => ({ agents: g.agents.join(', '), disallow: g.disallow.join('\n'), allow: g.allow.join('\n'), crawlDelay: g.crawlDelay })), sitemaps: sitemaps.join('\n') }
}

/** Does a robots.txt pattern (with * and $) match this path (+query)? Returns the matched length or -1. */
export function ruleMatch(pattern, path) {
  let p = pattern
  let anchored = false
  if (p.endsWith('$')) { anchored = true; p = p.slice(0, -1) }
  const re = new RegExp('^' + p.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''))
  return re.test(path) ? pattern.length : -1
}

/** Pick the group that applies to this user agent: the longest matching agent name wins, else "*". */
export function groupFor(model, agent) {
  const a = agent.toLowerCase()
  let best = null, bestLen = -1
  for (const g of model.groups) {
    for (const name of agentsOf(g.agents)) {
      const n = name.toLowerCase()
      if (n === '*') { if (bestLen < 0) { best = g; bestLen = 0 } } else if (a.includes(n) && n.length > bestLen) { best = g; bestLen = n.length }
    }
  }
  return best
}

/** Test a path for an agent: {allowed, rule, type, group}. Longest matching rule wins; on a tie, Allow wins. */
export function testRobots(model, agent, rawPath) {
  const g = groupFor(model, agent)
  let path = String(rawPath || '/').trim()
  try { if (/^https?:\/\//i.test(path)) { const u = new URL(path); path = u.pathname + u.search } } catch { /* keep as typed */ }
  if (!path.startsWith('/')) path = '/' + path
  if (!g) return { allowed: true, rule: null, type: null, group: null }
  let best = null
  for (const [type, list] of [['Allow', lines(g.allow)], ['Disallow', lines(g.disallow)]]) {
    for (const rule of list) {
      const len = ruleMatch(rule, path)
      if (len < 0) continue
      if (!best || len > best.len || (len === best.len && type === 'Allow')) best = { len, rule, type }
    }
  }
  return best ? { allowed: best.type === 'Allow', rule: best.rule, type: best.type, group: g } : { allowed: true, rule: null, type: null, group: g }
}

const CSS = `
.t-rb .grp { border: 1px solid var(--border); border-radius: 18px; padding: 14px; background: var(--surface); display: grid; gap: 12px; animation: rise .4s var(--ease) both; }
.t-rb .grp textarea { min-height: 84px; font-family: var(--mono); font-size: 13.5px; }
.t-rb .sticky { position: sticky; top: calc(var(--header-h) + 16px); }
.t-rb .verdict { display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-radius: 14px; font-weight: 600; }
.t-rb .verdict.ok { background: var(--success-soft); color: var(--success); } .t-rb .verdict.no { background: var(--danger-soft); color: var(--danger); }
.t-rb .verdict small { display: block; font-weight: 400; color: var(--text-2); font-family: var(--mono); font-size: 12.5px; }
@media (max-width: 900px) { .t-rb .sticky { position: static; } }
`

export function mount(root) {
  ensureStyle()
  if (!document.getElementById('t-rb-style')) document.head.append(h('style', { id: 't-rb-style' }, CSS))
  let model = load('robots:model', null) || PRESETS.wordpress.model()
  if (!model.groups?.length) model = PRESETS.allow.model()
  const persist = debounce(() => save('robots:model', model), 400)
  const out = h('pre', { class: 'wt-code', tabindex: 0, 'aria-label': 'robots.txt output', style: 'min-height:160px' })
  const warnings = h('div', { class: 'stack', style: 'gap:8px' })
  const groupsEl = h('div', { class: 'stack' })
  const datalist = h('datalist', { id: 'rb-agents' }, COMMON_AGENTS.map((a) => h('option', { value: a })))
  const sitemaps = textarea({ rows: 2, placeholder: 'https://www.example.com/sitemap.xml', value: model.sitemaps, 'aria-label': 'Sitemap URLs, one per line', spellcheck: false, oninput: (e) => { model.sitemaps = e.target.value; changed() } })
  const importBox = textarea({ rows: 6, mono: true, placeholder: 'Paste an existing robots.txt here', 'aria-label': 'Existing robots.txt', spellcheck: false })

  function renderGroups() {
    clear(groupsEl, ...model.groups.map((g, i) => h('div', { class: 'grp' },
      h('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start' },
        field('Bots (User-agent)', h('input', { class: 'input', type: 'text', list: 'rb-agents', value: g.agents, placeholder: '*  or  Googlebot, Bingbot', spellcheck: false, autocapitalize: 'off', 'aria-label': `Bots for group ${i + 1}`, oninput: (e) => { g.agents = e.target.value; changed() } }), '* means every bot. Separate several bots with commas.'),
        model.groups.length > 1 ? button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Remove group ${i + 1}`, onClick: () => { model.groups.splice(i, 1); renderGroups(); changed() } }) : null),
      h('div', { class: 'grid-2' },
        field('Disallow (blocked paths)', textarea({ value: g.disallow, placeholder: '/admin/\n/private/\n/*?session=', spellcheck: false, 'aria-label': `Disallow paths for group ${i + 1}`, oninput: (e) => { g.disallow = e.target.value; changed() } }), 'One path per line. "/" blocks the whole site.'),
        field('Allow (exceptions)', textarea({ value: g.allow, placeholder: '/admin/public/', spellcheck: false, 'aria-label': `Allow paths for group ${i + 1}`, oninput: (e) => { g.allow = e.target.value; changed() } }), 'Open a path inside a blocked one.')),
      h('div', { class: 'grid-2' }, field('Crawl delay (seconds, optional)', h('input', { class: 'input', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: g.crawlDelay, placeholder: 'Google ignores this', 'aria-label': `Crawl delay for group ${i + 1}`, oninput: (e) => { g.crawlDelay = e.target.value; changed() } }), 'Bing and Yandex respect it, Google does not.'), h('span')))))
  }

  function checks() {
    clear(warnings)
    const text = buildRobots(model)
    const all = model.groups.find((g) => agentsOf(g.agents).includes('*'))
    if (all && lines(all.disallow).includes('/') && !lines(all.allow).length) warnings.append(alert('warn', 'This blocks every bot from the whole site. Search engines will stop crawling it. That is right for a staging site and wrong for a live one.'))
    const bad = model.groups.flatMap((g) => [...lines(g.disallow), ...lines(g.allow)]).filter((p) => !/^[/*]/.test(p))
    if (bad.length) warnings.append(alert('warn', `Paths should start with / or *. Check: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '...' : ''}`))
    const maps = lines(model.sitemaps).filter((m) => !/^https?:\/\//i.test(m))
    if (maps.length) warnings.append(alert('warn', 'Sitemap entries must be full https:// addresses.'))
    if (!model.groups.some((g) => agentsOf(g.agents).length)) warnings.append(alert('warn', 'Add at least one bot (User-agent) to start.'))
    if (!lines(model.sitemaps).length) warnings.append(note('Add your sitemap address so crawlers find all your pages faster.'))
    warnings.append(note('robots.txt is a request, not security. Polite bots follow it, bad ones ignore it, and blocked pages can still appear in search if other sites link to them. Use "noindex" or a login to truly hide pages.'))
    return text
  }
  const changed = () => { persist(); out.textContent = checks(); renderTester() }

  // Tester
  const testAgent = h('input', { class: 'input', type: 'text', list: 'rb-agents', value: 'Googlebot', 'aria-label': 'Bot to test', spellcheck: false, oninput: () => renderTester() })
  const testPath = h('input', { class: 'input', type: 'text', value: '/wp-admin/options.php', 'aria-label': 'Path or URL to test', spellcheck: false, placeholder: '/blog/post?id=1', oninput: () => renderTester() })
  const verdict = h('div', { 'aria-live': 'polite' })
  const gl = (g) => (g.agents.length > 36 ? g.agents.slice(0, 33) + '...' : g.agents)
  function renderTester() {
    const r = testRobots(model, testAgent.value.trim() || '*', testPath.value)
    clear(verdict, h('div', { class: ['verdict', r.allowed ? 'ok' : 'no'] }, icon(r.allowed ? 'circle-check' : 'circle-x'), h('div', r.allowed ? 'Allowed' : 'Blocked',
      h('small', r.rule ? `${r.type}: ${r.rule}  (group: ${gl(r.group)})` : r.group ? `No rule matches, so the bot may crawl it (group: ${gl(r.group)})` : 'No group applies to this bot, so it may crawl everything'))))
  }

  const presets = chipGroup(Object.entries(PRESETS).map(([k, p]) => [k, p.label]), '', (k) => { model = PRESETS[k].model(); sitemaps.value = model.sitemaps; renderGroups(); changed(); presets.set([]) }, { label: 'Presets', soft: false })
  const left = h('div', { class: 'stack' },
    h('section', { class: 'panel stack' }, h('div', { class: 'wt-kicker' }, 'Start from a preset'), presets),
    groupsEl,
    h('div', { class: 'row' }, button('Add another group', { icon: 'plus', onClick: () => { model.groups.push(group('', [])); renderGroups(); changed() } }), button('Block AI bots too', { icon: 'bot', variant: 'ghost', onClick: () => { model.groups.push(group(AI_BOTS.join(', '), ['/'])); renderGroups(); changed() } })),
    h('section', { class: 'panel stack' }, field('Sitemaps', sitemaps, 'Optional. One full address per line.')),
    h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center' }, 'Import an existing robots.txt'),
      h('div', { class: 'stack', style: 'margin-top:10px' }, importBox, button('Load into the editor', { icon: 'file-input', onClick: () => { if (!importBox.value.trim()) return; model = parseRobots(importBox.value); if (!model.groups.length) model = PRESETS.allow.model(); sitemaps.value = model.sitemaps; renderGroups(); changed() } }))))
  const right = h('div', { class: 'stack sticky' },
    h('section', { class: 'panel stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('div', { class: 'wt-kicker' }, 'robots.txt'), h('div', { class: 'row' }, copyButton(() => buildRobots(model), 'Copy'), button('Download', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(buildRobots(model), 'robots.txt', 'text/plain') }))), out, warnings,
      note('Upload it to the root of your site so it is reachable at /robots.txt.')),
    h('section', { class: 'panel stack' }, h('div', { class: 'wt-kicker' }, 'Test a URL'), h('div', { class: 'grid-2' }, field('Bot', testAgent), field('Path or URL', testPath)), verdict))
  root.append(h('div', { class: 't-rb' }, datalist, split(left, right, 'wide-left')))
  renderGroups()
  changed()
}
