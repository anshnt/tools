// URL parser (also serves query-string-parser via params.focus = 'query'). Everything runs locally.
import { h, icon, button, field, input, textarea, panel, alert, clear, copyButton, debounce } from '../../lib/ui.js'
import { ensureStyle, pill, note, kvList, setHashParams, hashParam } from './_shared.js'

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443', 'ftp:': '21', 'ws:': '80', 'wss:': '443' }
const TRACKING = /^(utm_[a-z0-9_]+|fbclid|gclid|gclsrc|dclid|msclkid|yclid|mc_eid|mc_cid|igshid|_ga|_gl|ref_src|ref|spm|vero_id|oly_enc_id|oly_anon_id|__s|wickedid)$/i

/** Decode one query component: "+" is a space, bad escapes are kept as typed. */
export function decodeComponent(s) {
  const t = s.replace(/\+/g, ' ')
  try { return decodeURIComponent(t) } catch { return t }
}
/** Encode a query component without turning spaces into "+" (works in every server and app). */
export const encodeComponent = (s) => encodeURIComponent(s).replace(/%2C/gi, ',').replace(/%3A/gi, ':').replace(/%2F/gi, '/').replace(/%40/g, '@').replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())

/** "a=1&b=%20x&c" -> [{key, value, hasValue}] keeping order and duplicates. */
export function parseQuery(qs) {
  const s = String(qs || '').replace(/^\?/, '')
  if (!s) return []
  return s.split('&').filter((p) => p !== '').map((p) => {
    const i = p.indexOf('=')
    return i < 0 ? { key: decodeComponent(p), value: '', hasValue: false } : { key: decodeComponent(p.slice(0, i)), value: decodeComponent(p.slice(i + 1)), hasValue: true }
  })
}
export const buildQuery = (params) => params.filter((p) => p.key !== '' || p.value !== '').map((p) => (p.hasValue === false && p.value === '' ? encodeComponent(p.key) : `${encodeComponent(p.key)}=${encodeComponent(p.value)}`)).join('&')

/**
 * Turn what a person typed into a URL. Accepts full URLs, bare domains ("example.com/a?b=1"), and for the query tool
 * a bare query string ("?a=1&b=2" or "a=1&b=2"). Returns {url, kind: 'url'|'query'} or throws a friendly Error.
 */
export function parseInput(raw) {
  const s = String(raw || '').trim()
  if (!s) throw Object.assign(new Error('empty'), { empty: true })
  if (/^\?/.test(s) || (/^[^/:?#\s]+=[^\s]*$/.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s))) {
    return { url: new URL('https://placeholder.invalid/?' + s.replace(/^\?/, '')), kind: 'query' }
  }
  let t = s
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t) || /^[a-z0-9.-]+:\d+(\/|$)/i.test(t)) t = 'https://' + t.replace(/^\/\//, '')
  try { return { url: new URL(t), kind: 'url' } } catch { throw new Error('That does not look like a valid URL. Try something like https://example.com/page?id=1') }
}

const SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ne', 'or', 'go', 'nic', 'res', 'mil', 'sch', 'gen', 'firm', 'ind'])
/** Split a hostname into subdomain, registrable domain and suffix. Heuristic (no public suffix list): handles co.uk, com.au, co.in and similar. */
export function splitHost(host) {
  const parts = host.split('.')
  if (parts.length < 2) return { domain: '', suffix: parts[0] || '', subdomain: '' }
  const two = parts.length >= 3 && parts[parts.length - 1].length === 2 && SLD.has(parts[parts.length - 2])
  const n = two ? 2 : 1
  return { suffix: parts.slice(-n).join('.'), domain: parts.slice(-(n + 1)).join('.'), subdomain: parts.slice(0, -(n + 1)).join('.') }
}

/** Break a URL into the parts shown in the table. */
export function describeUrl(u) {
  const segments = u.pathname.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x) } catch { return x } })
  const host = u.hostname
  const ipHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')
  const { domain, suffix, subdomain } = ipHost ? { domain: '', suffix: '', subdomain: '' } : splitHost(host)
  return {
    protocol: u.protocol, username: u.username, password: u.password, host: u.host, hostname: host, port: u.port, defaultPort: DEFAULT_PORTS[u.protocol] || '',
    origin: u.origin === 'null' ? '' : u.origin, pathname: u.pathname, segments, search: u.search, hash: u.hash,
    domain, suffix, subdomain, isIp: ipHost,
  }
}

const CSS = `
.t-up .kv-in { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto; gap: 8px; align-items: center; }
.t-up .kv-head { font-size: 12px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
.t-up .kv-in .input { height: 40px; font-family: var(--mono); font-size: 14px; }
.t-up .params { display: grid; gap: 8px; }
.t-up .final { padding: 14px 16px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface-2); font-family: var(--mono); font-size: 13.5px; line-height: 1.6; overflow-wrap: anywhere; word-break: break-all; }
.t-up .final mark { background: var(--accent-soft); color: var(--accent); border-radius: 5px; padding: 0 3px; }
.t-up .final .p-q { color: var(--accent); }
.t-up .final .p-h { color: var(--accent-2); }
.t-up .final .p-o { color: var(--muted); }
@media (max-width: 560px) { .t-up .kv-in { grid-template-columns: minmax(0, 1fr) auto; } .t-up .kv-in .v { grid-column: 1 / 2; grid-row: 2; } .t-up .kv-in .del { grid-row: 1 / 3; grid-column: 2; } .t-up .kv-head.v { display: none; } }
`

export function mount(root, { params }) {
  ensureStyle()
  if (!document.getElementById('t-up-style')) document.head.append(h('style', { id: 't-up-style' }, CSS))
  const queryFocus = params.focus === 'query'
  const initial = hashParam('q')
  const box = textarea({ rows: 3, mono: true, spellcheck: false, 'aria-label': queryFocus ? 'URL or query string' : 'URL to parse', value: initial,
    placeholder: queryFocus ? 'Paste a URL or just a query string, e.g. https://shop.example/?utm_source=news&q=red%20shoes' : 'https://user:pass@www.example.com:8080/a/b/c.html?x=1&y=two#section' })
  const status = h('div')
  const out = h('div', { class: 'stack' })
  let state = null // {u, kind, params, hash}

  const currentHref = () => {
    if (state.kind === 'query') return (buildQuery(state.params) ? '?' : '') + buildQuery(state.params)
    const u = new URL(state.u.href)
    u.search = ''
    const q = buildQuery(state.params)
    let href = u.href.replace(/#.*$/, '').replace(/\?$/, '')
    href += (q ? '?' + q : '') + u.hash
    return href
  }

  function paramsEditor() {
    const wrap = h('div', { class: 'params' })
    const render = () => {
      clear(wrap)
      if (!state.params.length) wrap.append(h('div', { class: 'muted small' }, 'No query parameters. Add one below.'))
      else {
        wrap.append(h('div', { class: 'kv-in' }, h('div', { class: 'kv-head' }, 'Name'), h('div', { class: 'kv-head v' }, 'Value (decoded)'), h('span')))
        state.params.forEach((p, i) => {
          const dupe = state.params.filter((x) => x.key === p.key).length > 1
          wrap.append(h('div', { class: 'kv-in' },
            input({ value: p.key, title: dupe ? 'This name appears more than once' : null, style: dupe ? 'border-color: var(--warning)' : null, 'aria-label': `Parameter ${i + 1} name`, spellcheck: false, autocapitalize: 'off', oninput: (e) => { p.key = e.target.value; refreshFinal() } }),
            h('input', { class: 'input v', type: 'text', value: p.value, 'aria-label': `Parameter ${i + 1} value`, spellcheck: false, autocapitalize: 'off', oninput: (e) => { p.value = e.target.value; p.hasValue = true; refreshFinal() } }),
            h('div', { class: 'row', style: 'gap:2px;flex-wrap:nowrap' },
              button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${p.key || 'parameter'}`, onClick: () => { state.params.splice(i, 1); render(); refreshFinal() } }))))
        })
      }
    }
    render()
    wrap.render = render
    return wrap
  }

  let finalEl, editor
  function refreshFinal() {
    if (!finalEl) return
    const href = currentHref()
    clear(finalEl)
    if (state.kind === 'query') { finalEl.append(href || h('span', { class: 'p-o' }, '(empty)')); return }
    const i = href.indexOf('?'), j = href.indexOf('#')
    const qEnd = j >= 0 ? j : href.length
    const base = href.slice(0, i >= 0 && (j < 0 || i < j) ? i : qEnd)
    finalEl.append(base, i >= 0 && (j < 0 || i < j) ? h('span', { class: 'p-q' }, href.slice(i, qEnd)) : '', j >= 0 ? h('span', { class: 'p-h' }, href.slice(j)) : '')
  }

  function render() {
    clear(status)
    let parsed
    try { parsed = parseInput(box.value) } catch (e) {
      state = null
      clear(out)
      if (!e.empty) status.append(alert('error', e.message))
      else out.append(h('div', { class: 'wt-empty-hero' }, icon(queryFocus ? 'list-tree' : 'link', 'icon'), h('div', queryFocus ? 'Paste a URL or a query string to see every parameter decoded.' : 'Paste a URL to see its parts.'),
        h('div', { style: 'margin-top:12px' }, button('Try an example', { icon: 'wand-sparkles', variant: 'secondary', size: 'sm', onClick: () => { box.value = 'https://user:pass@www.shop.example.co.uk:8443/men/shoes%20sale/index.html?utm_source=newsletter&utm_medium=email&q=red%20shoes&size=42&size=43&promo=a%2Bb#reviews'; render() } }))))
      setHashParams({ q: '' })
      return
    }
    setHashParams({ q: box.value.trim().length < 1500 ? box.value.trim() : '' })
    const keepParams = state && state.raw === box.value.trim() ? state.params : null
    state = { u: parsed.url, kind: parsed.kind, params: keepParams || parseQuery(parsed.url.search), raw: box.value.trim() }
    const d = describeUrl(state.u)
    editor = paramsEditor()
    finalEl = h('div', { class: 'final', 'aria-live': 'polite' })
    const hasTracking = () => state.params.some((p) => TRACKING.test(p.key))
    const tools = h('div', { class: 'row' },
      button('Add parameter', { icon: 'plus', size: 'sm', onClick: () => { state.params.push({ key: '', value: '', hasValue: true }); editor.render(); refreshFinal(); editor.querySelector('.kv-in:last-child input')?.focus() } }),
      button('Sort A to Z', { icon: 'arrow-down-a-z', variant: 'ghost', size: 'sm', onClick: () => { state.params.sort((a, b) => a.key.localeCompare(b.key)); editor.render(); refreshFinal() } }),
      button('Remove empty', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { state.params = state.params.filter((p) => p.value !== ''); editor.render(); refreshFinal() } }),
      button('Strip tracking', { icon: 'shield-off', variant: 'ghost', size: 'sm', title: 'Remove utm_*, fbclid, gclid and similar', onClick: () => { const n = state.params.length; state.params = state.params.filter((p) => !TRACKING.test(p.key)); editor.render(); refreshFinal(); if (n === state.params.length) clear(msg, note('No tracking parameters found.')); else clear(msg, alert('success', `Removed ${n - state.params.length} tracking parameter(s).`)) } }))
    const msg = h('div')
    const queryPanel = h('section', { class: 'panel stack' },
      h('div', { class: 'row', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0' }, queryFocus ? 'Query parameters' : 'Query parameters (editable)'), pill(`${state.params.length} found`, state.params.length ? 'accent' : '')),
      editor, state.params.some((p, i) => state.params.findIndex((x) => x.key === p.key) !== i) ? note('Names with an orange border are repeated. Many sites read repeated names as a list.') : null, tools, msg,
      h('div', { class: 'stack', style: 'gap:8px' },
        h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'wt-kicker' }, state.kind === 'query' ? 'Rebuilt query string' : 'Rebuilt URL'), copyButton(() => currentHref(), 'Copy')),
        finalEl))
    refreshFinal()
    // Components
    const rows = [
      ['Protocol', d.protocol, { mono: true }],
      ['Username', d.username ? decodeComponent(d.username) : '', { mono: true }],
      ['Password', d.password ? '•'.repeat(Math.min(12, d.password.length)) : '', { mono: true, copyValue: decodeComponent(d.password) }],
      ['Host', d.host, { mono: true }],
      ['Hostname', d.hostname, { mono: true }],
      ['Domain', d.domain, { mono: true }],
      ['Subdomain', d.subdomain, { mono: true }],
      ['Suffix', d.suffix, { mono: true }],
      ['Port', d.port || (d.defaultPort ? `${d.defaultPort} (default)` : ''), { mono: true, copyValue: d.port || d.defaultPort }],
      ['Origin', d.origin, { mono: true }],
      ['Path', d.pathname, { mono: true }],
      ['Path segments', d.segments.length ? d.segments.map((s, i) => `${i + 1}. ${s}`).join('   ') : '', { copyValue: d.segments.join('/') }],
      ['Query string', d.search, { mono: true }],
      ['Fragment', d.hash, { mono: true }],
    ]
    const comp = state.kind === 'query' ? null : h('section', { class: 'panel stack' }, h('h2', { style: 'margin:0' }, 'Components'), kvList(rows),
      d.password ? alert('warn', 'This URL contains a password. Do not share it, and avoid putting credentials in links.') : null,
      /xn--/.test(d.hostname) ? note('This is an internationalized domain stored as punycode (xn--...).') : null)
    const dec = state.kind === 'query' || !state.u.search ? null : h('details', { class: 'panel' }, h('summary', { style: 'cursor:pointer;font-weight:600;min-height:32px;display:flex;align-items:center' }, 'Decoded view of the whole URL'),
      h('pre', { class: 'wt-code', style: 'margin-top:10px' }, (() => { try { return decodeURI(state.u.href) } catch { return state.u.href } })()))
    clear(out, ...(queryFocus ? [queryPanel, comp, dec] : [comp, queryPanel, dec]).filter(Boolean))
  }
  const soon = debounce(render, 120)
  box.addEventListener('input', soon)
  root.append(h('div', { class: 't-up stack' }, panel(field(queryFocus ? 'URL or query string' : 'URL', box)), status, out))
  render()
  if (!initial) box.focus({ preventScroll: true })
}
