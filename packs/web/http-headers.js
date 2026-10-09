// HTTP header checker: fetch a URL's response headers (HackerTarget API) or paste your own, then explain them and grade the security headers.
import { h, icon, button, alert, clear, copyText, copyButton, tabs, textarea } from '../../lib/ui.js'
import { ensureStyle, pill, note, omnibar, getText, parseWebUrl, recents, recentChips, skeleton, hashParam, setHashParams } from './_shared.js'

const EXPLAIN = {
  'content-type': 'What kind of file this is and its text encoding.',
  'content-length': 'Size of the response body in bytes.',
  'content-encoding': 'How the body is compressed (gzip, br, zstd). Compression makes pages load faster.',
  'cache-control': 'Tells browsers and CDNs how long they may reuse this response.',
  'etag': 'A fingerprint of this version of the page, used to skip downloading it again.',
  'last-modified': 'When the page was last changed, used for conditional requests.',
  'expires': 'An older way to say when the response goes stale. Cache-Control wins when both exist.',
  'age': 'How many seconds a CDN or proxy has already held this response.',
  'vary': 'Which request headers change the response, so caches keep separate copies.',
  'server': 'The web server software. Showing exact version numbers helps attackers pick exploits.',
  'x-powered-by': 'The framework behind the site. It is better to hide it.',
  'date': 'When the server sent the response.',
  'connection': 'Whether the connection stays open for more requests.',
  'transfer-encoding': 'How the body is sent in pieces (chunked) when its length is not known upfront.',
  'location': 'Where a redirect (301, 302, 307, 308) sends the browser next.',
  'set-cookie': 'Stores a cookie in the browser. Look for Secure, HttpOnly and SameSite flags.',
  'strict-transport-security': 'HSTS: forces browsers to use https for this site for a set time.',
  'content-security-policy': 'CSP: a whitelist of where scripts, styles and images may load from. The strongest defense against XSS.',
  'x-content-type-options': '"nosniff" stops browsers from guessing file types, which blocks some attacks.',
  'x-frame-options': 'Controls whether other sites may show this page in a frame (clickjacking protection).',
  'referrer-policy': 'How much of the page address is shared when a visitor clicks a link.',
  'permissions-policy': 'Switches browser features (camera, microphone, location) on or off for this page.',
  'cross-origin-opener-policy': 'COOP: isolates this page from windows opened by other sites.',
  'cross-origin-resource-policy': 'CORP: controls which sites may load this resource.',
  'cross-origin-embedder-policy': 'COEP: needed together with COOP to enable powerful features like SharedArrayBuffer.',
  'access-control-allow-origin': 'CORS: which other sites may read this response from JavaScript. "*" means any site.',
  'access-control-allow-credentials': 'CORS: whether cookies may be sent with cross-site requests.',
  'x-xss-protection': 'Old browser XSS filter. Modern browsers ignore it. Prefer a CSP.',
  'link': 'Hints such as preload, canonical or next page.',
  'content-language': 'The language of the content.',
  'content-disposition': 'Asks the browser to download the file or shows its filename.',
  'accept-ranges': 'Says the server can send parts of a file (used for video and resumed downloads).',
  'alt-svc': 'Advertises HTTP/3 or other ways to reach this site faster.',
  'via': 'Proxies or CDNs the response went through.',
  'cf-ray': 'Cloudflare request ID. Useful when asking Cloudflare support.',
  'cf-cache-status': 'Whether Cloudflare served this from cache (HIT) or fetched it fresh (MISS).',
  'x-cache': 'Whether a CDN served this from cache.',
  'x-request-id': 'A unique ID for this request, handy for finding it in server logs.',
  'report-to': 'Where browsers should send security and error reports.',
  'nel': 'Network Error Logging: asks browsers to report connection failures.',
  'x-robots-tag': 'Crawling instructions for search engines, same as the robots meta tag.',
  'x-dns-prefetch-control': 'Whether the browser may look up linked domains ahead of time.',
  'x-permitted-cross-domain-policies': 'Legacy Flash/PDF cross-domain policy. "none" is the safe value.',
  'timing-allow-origin': 'Which sites may read detailed timing data for this resource.',
  'server-timing': 'Server-side timing measurements shown in browser dev tools.',
}

/** Parse raw header text ("HTTP/1.1 200 OK" then "Name: value" lines). */
export function parseHeaders(text) {
  const lines = String(text).replace(/\r/g, '').split('\n')
  let status = null
  const headers = []
  for (const line of lines) {
    if (!line.trim()) continue
    const st = /^HTTP\/([\d.]+)\s+(\d{3})\s*(.*)$/i.exec(line)
    if (st) { if (!status) status = { version: st[1], code: +st[2], text: st[3] }; continue }
    const i = line.indexOf(':')
    if (i > 0 && !/\s/.test(line.slice(0, i))) headers.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() })
  }
  return { status, headers }
}

const get = (headers, name) => headers.filter((x) => x.name.toLowerCase() === name)
const first = (headers, name) => get(headers, name)[0]?.value

/** Grade the security headers. Pure. */
export function analyze(headers, { https = true } = {}) {
  const checks = []
  const add = (c) => checks.push(c)
  const hsts = first(headers, 'strict-transport-security')
  const csp = first(headers, 'content-security-policy')
  const xcto = first(headers, 'x-content-type-options')
  const xfo = first(headers, 'x-frame-options')
  const ref = first(headers, 'referrer-policy')
  const perm = first(headers, 'permissions-policy')
  const coop = first(headers, 'cross-origin-opener-policy')
  const corp = first(headers, 'cross-origin-resource-policy')

  if (!https) add({ key: 'hsts', name: 'Strict-Transport-Security', weight: 20, state: 'info', pts: 0, detail: 'Only meaningful on https. This URL used plain http.', fix: '' })
  else if (!hsts) add({ key: 'hsts', name: 'Strict-Transport-Security', weight: 20, state: 'missing', pts: 0, detail: 'Missing. Browsers may still connect over unencrypted http first.', fix: 'Strict-Transport-Security: max-age=31536000; includeSubDomains' })
  else {
    const age = +(/max-age=(\d+)/i.exec(hsts)?.[1] || 0)
    add(age >= 15552000 ? { key: 'hsts', name: 'Strict-Transport-Security', weight: 20, state: 'good', pts: 20, detail: `Enabled for ${Math.round(age / 86400)} days${/includeSubDomains/i.test(hsts) ? ', including subdomains' : ''}${/preload/i.test(hsts) ? ', preload' : ''}.` }
      : { key: 'hsts', name: 'Strict-Transport-Security', weight: 20, state: 'warn', pts: 10, detail: `The max-age is only ${age >= 86400 ? Math.round(age / 86400) + ' days' : Math.round(age / 60) + ' minutes'}. Use at least 180 days (15552000 seconds).`, fix: 'Strict-Transport-Security: max-age=31536000; includeSubDomains' })
  }
  if (!csp) add({ key: 'csp', name: 'Content-Security-Policy', weight: 25, state: 'missing', pts: 0, detail: 'Missing. This is the strongest protection against cross-site scripting.', fix: "Content-Security-Policy: default-src 'self'; frame-ancestors 'self'" })
  else {
    const weak = /'unsafe-eval'|'unsafe-inline'|\bdefault-src\s+\*|script-src\s+[^;]*\*/i.test(csp)
    add(weak ? { key: 'csp', name: 'Content-Security-Policy', weight: 25, state: 'warn', pts: 15, detail: "Present, but allows 'unsafe-inline', 'unsafe-eval' or a wildcard, which weakens it. Prefer nonces or hashes." }
      : { key: 'csp', name: 'Content-Security-Policy', weight: 25, state: 'good', pts: 25, detail: 'Present with no obviously unsafe sources.' })
  }
  add(/nosniff/i.test(xcto || '') ? { key: 'xcto', name: 'X-Content-Type-Options', weight: 15, state: 'good', pts: 15, detail: 'Set to nosniff.' }
    : { key: 'xcto', name: 'X-Content-Type-Options', weight: 15, state: 'missing', pts: 0, detail: 'Missing. Browsers may guess file types and run files they should not.', fix: 'X-Content-Type-Options: nosniff' })
  const fa = /frame-ancestors/i.test(csp || '')
  add(xfo || fa ? { key: 'xfo', name: 'Clickjacking protection', weight: 15, state: 'good', pts: 15, detail: xfo ? `X-Frame-Options: ${xfo}` : 'Set through CSP frame-ancestors.' }
    : { key: 'xfo', name: 'Clickjacking protection', weight: 15, state: 'missing', pts: 0, detail: 'Missing. Other sites can embed this page in a frame and trick visitors into clicking.', fix: 'X-Frame-Options: SAMEORIGIN' })
  if (!ref) add({ key: 'ref', name: 'Referrer-Policy', weight: 10, state: 'missing', pts: 0, detail: 'Missing. Browsers use their default, which is usually fine but not guaranteed.', fix: 'Referrer-Policy: strict-origin-when-cross-origin' })
  else add(/unsafe-url/i.test(ref) ? { key: 'ref', name: 'Referrer-Policy', weight: 10, state: 'warn', pts: 3, detail: 'unsafe-url sends the full address, including query strings, to every site you link to.' } : { key: 'ref', name: 'Referrer-Policy', weight: 10, state: 'good', pts: 10, detail: ref })
  add(perm ? { key: 'perm', name: 'Permissions-Policy', weight: 10, state: 'good', pts: 10, detail: 'Present.' } : { key: 'perm', name: 'Permissions-Policy', weight: 10, state: 'missing', pts: 0, detail: 'Missing. Optional, but lets you turn off camera, microphone and location for the page.', fix: 'Permissions-Policy: camera=(), microphone=(), geolocation=()' })
  add(coop || corp ? { key: 'coop', name: 'Cross-origin isolation', weight: 5, state: 'good', pts: 5, detail: [coop && `COOP: ${coop}`, corp && `CORP: ${corp}`].filter(Boolean).join(', ') } : { key: 'coop', name: 'Cross-origin isolation', weight: 5, state: 'missing', pts: 0, detail: 'Optional. COOP and CORP isolate your page from other sites.', fix: 'Cross-Origin-Opener-Policy: same-origin' })

  const leaks = []
  const server = first(headers, 'server')
  if (server && /\d+\.\d+/.test(server)) leaks.push(`Server reveals its version: ${server}`)
  for (const n of ['x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version']) { const v = first(headers, n); if (v) leaks.push(`${n}: ${v}`) }
  const penalty = Math.min(10, leaks.length * 5)
  let score = checks.reduce((s, c) => s + c.pts, 0)
  const max = checks.reduce((s, c) => s + (c.state === 'info' ? 0 : c.weight), 0) || 1
  score = Math.max(0, Math.round((score / max) * 100) - penalty)
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F'

  const cookies = get(headers, 'set-cookie').map((c) => {
    const [pair, ...attrs] = c.value.split(';').map((s) => s.trim())
    const a = attrs.map((x) => x.toLowerCase())
    return { name: pair.split('=')[0], secure: a.includes('secure'), httpOnly: a.includes('httponly'), sameSite: (a.find((x) => x.startsWith('samesite=')) || '').split('=')[1] || '', raw: c.value }
  })
  return { checks, leaks, score, grade, cookies }
}

const statusTone = (c) => (c >= 500 ? 'bad' : c >= 400 ? 'bad' : c >= 300 ? 'warn' : c >= 200 ? 'ok' : 'info')
const statusText = (c) => ({ 200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' }[c] || '')

const CSS = `
@property --p { syntax: '<number>'; inherits: false; initial-value: 0; }
.t-hh .score { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: center; }
.t-hh .ring { --p: 0; width: 112px; height: 112px; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--ringc, var(--accent)) calc(var(--p) * 1%), var(--surface-3) 0); position: relative; transition: --p .8s var(--ease); }
.t-hh .ring::before { content: ""; position: absolute; inset: 9px; border-radius: 50%; background: var(--surface); }
.t-hh .ring b { position: relative; font-size: 38px; letter-spacing: -.03em; line-height: 1; text-align: center; } .t-hh .ring small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 0; }
.t-hh .chk { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 12px; padding: 11px 6px; border-top: 1px solid var(--border); align-items: start; }
.t-hh .chk:first-child { border-top: 0; }
.t-hh .chk .ic { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; margin-top: 1px; }
.t-hh .chk .ic .icon { width: 14px; height: 14px; }
.t-hh .chk.good .ic { background: var(--success-soft); color: var(--success); } .t-hh .chk.warn .ic { background: var(--warning-soft); color: var(--warning); } .t-hh .chk.missing .ic { background: var(--danger-soft); color: var(--danger); } .t-hh .chk.info .ic { background: var(--surface-2); color: var(--muted); }
.t-hh .chk .n { font-weight: 600; font-size: 14px; } .t-hh .chk .d { color: var(--text-2); font-size: 13px; overflow-wrap: anywhere; }
.t-hh .chk .fix { grid-column: 2 / 4; margin-top: 4px; }
.t-hh .hrow { display: grid; grid-template-columns: minmax(120px, 230px) minmax(0, 1fr) auto; gap: 4px 12px; padding: 9px 4px 9px 14px; border-top: 1px solid var(--border); align-items: start; }
.t-hh .hrow:first-child { border-top: 0; }
.t-hh .hrow .k { font-family: var(--mono); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; } .t-hh .hrow .v { font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; word-break: break-word; } .t-hh .hrow .e { grid-column: 2 / 4; font-size: 12.5px; color: var(--muted); font-family: var(--font); }
.t-hh .list { border: 1px solid var(--border); border-radius: 16px; background: var(--surface); overflow: hidden; }
@media (max-width: 560px) { .t-hh .hrow { grid-template-columns: minmax(0, 1fr) auto; } .t-hh .hrow .v, .t-hh .hrow .e { grid-column: 1 / 3; } .t-hh .score { grid-template-columns: 1fr; justify-items: center; text-align: center; } }
`

export function mount(root, { signal }) {
  ensureStyle()
  if (!document.getElementById('t-hh-style')) document.head.append(h('style', { id: 't-hh-style' }, CSS))
  const rec = recents('headers', 8)
  const out = h('div', { class: 'stack' })
  const err = h('div')
  let chipsRecent

  function show(text, { url = '', https = true, source = '' } = {}) {
    const { status, headers } = parseHeaders(text)
    if (!headers.length) return clear(out, alert('error', 'No headers found in that text. Paste lines like "Content-Type: text/html".'))
    const a = analyze(headers, { https })
    const ringColor = a.grade === 'A' || a.grade === 'B' ? 'var(--success)' : a.grade === 'C' ? 'var(--warning)' : 'var(--danger)'
    const ring = h('div', { class: 'ring', style: { '--ringc': ringColor } }, h('b', a.grade, h('small', `${a.score}/100`)))
    requestAnimationFrame(() => ring.style.setProperty('--p', a.score))
    const loc = first(headers, 'location')
    const head = h('section', { class: 'panel stack' },
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'row' }, status ? pill(`${status.code} ${status.text || statusText(status.code)}`, statusTone(status.code)) : null, status ? pill(`HTTP/${status.version}`) : null, url ? h('span', { class: 'mono small', style: 'overflow-wrap:anywhere' }, url) : null),
        h('div', { class: 'row' }, copyButton(() => text, 'Copy raw'))),
      status && status.code >= 300 && status.code < 400 && loc ? alert('info', `This URL redirects (${status.code}) to `, h('b', { style: 'overflow-wrap:anywhere' }, loc), '. ', url ? button('Check the target', { size: 'sm', onClick: () => { try { const t = new URL(loc, url).href; omni.set(t); omni.run() } catch { /* ignore */ } } }) : null) : null)
    const chkRow = (c) => h('div', { class: ['chk', c.state] }, h('span', { class: 'ic' }, icon(c.state === 'good' ? 'check' : c.state === 'warn' ? 'triangle-alert' : c.state === 'missing' ? 'x' : 'minus')),
      h('div', h('div', { class: 'n' }, c.name), h('div', { class: 'd' }, c.detail)), c.state === 'good' ? pill('Good', 'ok') : c.state === 'warn' ? pill('Weak', 'warn') : c.state === 'missing' ? pill('Missing', 'bad') : pill('n/a'),
      c.fix ? h('div', { class: 'fix' }, h('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, h('code', { class: 'wt-code', style: 'padding:6px 10px;flex:1;min-width:0;border-radius:10px;font-size:12px' }, c.fix), button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${c.name} fix`, onClick: () => copyText(c.fix) }))) : null)
    const score = h('section', { class: 'panel stack' }, h('h2', { style: 'margin:0' }, 'Security headers'), h('div', { class: 'score' }, ring, h('div', { class: 'stack', style: 'gap:6px' },
      h('div', { class: 'wt-chips' }, pill(`${a.checks.filter((c) => c.state === 'good').length} good`, 'ok'), pill(`${a.checks.filter((c) => c.state === 'warn').length} weak`, 'warn'), pill(`${a.checks.filter((c) => c.state === 'missing').length} missing`, 'bad')),
      h('div', { class: 'muted small' }, 'A rough grade for the headers that harden a site against common web attacks. Not a full security audit.'))),
    h('div', { class: 'list' }, a.checks.map(chkRow)),
    a.leaks.length ? alert('warn', h('b', 'Information leaks. '), a.leaks.join('; '), '. Hiding these makes targeted attacks harder.') : null,
    a.cookies.length ? h('div', { class: 'stack' }, h('h3', { style: 'margin:6px 0 0;font-size:14px' }, `Cookies (${a.cookies.length})`), h('div', { class: 'list' }, a.cookies.map((c) => h('div', { class: 'hrow', style: 'grid-template-columns:minmax(0,1fr) auto' }, h('span', { class: 'k' }, c.name),
      h('div', { class: 'wt-chips' }, pill('Secure', c.secure ? 'ok' : 'warn', c.secure ? 'check' : 'x'), pill('HttpOnly', c.httpOnly ? 'ok' : 'warn', c.httpOnly ? 'check' : 'x'), pill(c.sameSite ? `SameSite=${c.sameSite}` : 'No SameSite', c.sameSite ? 'ok' : 'warn')))))) : null)
    const rows = headers.map((x) => {
      const ex = EXPLAIN[x.name.toLowerCase()]
      return h('div', { class: 'hrow' }, h('div', { class: 'k' }, x.name), h('div', { class: 'v' }, x.value), button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: `Copy ${x.name}`, onClick: () => copyText(`${x.name}: ${x.value}`) }), ex ? h('div', { class: 'e' }, ex) : null)
    })
    const all = h('section', { class: 'stack' }, h('h2', { style: 'margin:0' }, `All headers (${headers.length})`), h('div', { class: 'list' }, rows))
    clear(out, head, score, all, source ? note(source) : null)
  }

  const omni = omnibar({ icon: 'list', placeholder: 'https://example.com', label: 'Check headers', buttonIcon: 'search', busyLabel: 'Fetching headers', errorTo: err, onSubmit: async (v) => {
    clear(err)
    const u = parseWebUrl(v)
    clear(out, skeleton(4))
    let text
    try { text = await getText(`https://api.hackertarget.com/httpheaders/?q=${encodeURIComponent(u.href)}`, { signal, timeout: 25000, service: 'The header service (HackerTarget)' }) } catch (e) { clear(out); throw e }
    const t = text.trim()
    if (/API count exceeded|increase quota/i.test(t)) { clear(out); throw new Error('The free header service has reached its daily limit for your network. Use the "Paste headers" tab (run curl -I yourself) or try again tomorrow.') }
    if (!/^HTTP\//i.test(t)) { clear(out); throw new Error(/error/i.test(t) ? `The service could not fetch that URL: ${t.slice(0, 160)}` : 'The service did not return headers for that URL. Check that it is reachable from the internet.') }
    rec.add(u.href); chipsRecent.refresh(); setHashParams({ q: u.href })
    show(t, { url: u.href, https: u.protocol === 'https:', source: 'Headers fetched from the server by HackerTarget (free tier, limited daily lookups). The result is the response to a request from their server, so it may differ from what your browser gets.' })
  } })
  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent' })

  const paste = textarea({ rows: 9, mono: true, spellcheck: false, 'aria-label': 'Raw HTTP headers', placeholder: 'HTTP/2 200\ncontent-type: text/html; charset=utf-8\nstrict-transport-security: max-age=31536000\nx-content-type-options: nosniff\n\nPaste the output of curl -I https://yoursite.com or the headers from your browser dev tools.' })
  const pasteBtn = button('Analyze', { icon: 'search', variant: 'primary', onClick: () => { clear(err); show(paste.value, { https: true, source: 'Analyzed locally from the text you pasted. Nothing was sent anywhere.' }) } })
  const tabsEl = tabs([
    { id: 'url', label: 'Check a URL', render: () => h('div', { class: 'stack' }, omni.el, err, chipsRecent) },
    { id: 'paste', label: 'Paste headers', render: () => h('div', { class: 'stack' }, paste, h('div', { class: 'row' }, pasteBtn, button('Example', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: () => { paste.value = 'HTTP/2 200\ncontent-type: text/html; charset=utf-8\nserver: nginx/1.18.0\nx-powered-by: Express\nstrict-transport-security: max-age=31536000; includeSubDomains\nx-content-type-options: nosniff\nreferrer-policy: strict-origin-when-cross-origin\nset-cookie: sid=abc123; Path=/; HttpOnly\nset-cookie: pref=dark; Path=/; Secure; SameSite=Lax\ncache-control: max-age=600'; } })), note('Works offline for any site, including internal ones. Everything stays in your browser.')) },
  ], 'url', () => {})
  root.append(h('div', { class: 't-hh stack' }, tabsEl, out, note('The URL check uses the free HackerTarget API, which allows only a handful of lookups per day per network.')))
  clear(out, h('div', { class: 'wt-empty-hero' }, icon('list'), h('div', 'Enter a URL to see its response headers, or paste headers you already have.')))
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() }
}
