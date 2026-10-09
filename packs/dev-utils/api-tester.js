// API tester: send HTTP requests from the browser and inspect status, time, size, headers and a pretty body.
// Explains CORS failures, keeps saved requests and a history on this device, imports a cURL command and copies the request as cURL or code.
import { h, button, input, textarea, select, segmented, toggle, tabs, number, alert, clear, table, empty, copyText, download, modal, onCleanup, formatBytes } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { useKit, css, chips, eyebrow, pill, jsonView, hashParams, hex } from './_kit.js'
import { kvEditor } from './_kv.js'
import { parseCurl, buildCurl, generate } from './_curl.js'
import { CODES } from './_http-codes.js'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const HEADER_NAMES = ['Accept', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Type', 'If-None-Match', 'If-Modified-Since', 'X-API-Key', 'X-Requested-With', 'X-Request-ID']
const FORBIDDEN = new Set(['accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method', 'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via'])
const isForbidden = (n) => { const l = n.toLowerCase(); return FORBIDDEN.has(l) || l.startsWith('proxy-') || l.startsWith('sec-') }
const MAX_BODY = 20 * 1024 * 1024
const STATUS_TEXT = new Map(CODES.map((c) => [c[0], c[1]]))
const EXAMPLES = [
  ['GET JSON', { method: 'GET', url: 'https://jsonplaceholder.typicode.com/todos/1' }],
  ['POST JSON', { method: 'POST', url: 'https://jsonplaceholder.typicode.com/posts', headers: [['Content-Type', 'application/json']], bodyType: 'json', json: '{\n  "title": "hello",\n  "body": "from the API tester",\n  "userId": 1\n}' }],
  ['Echo anything', { method: 'POST', url: 'https://httpbin.org/anything', headers: [['X-Demo', 'yes']], bodyType: 'form', form: [['a', '1'], ['b', 'two words']] }],
  ['404 response', { method: 'GET', url: 'https://jsonplaceholder.typicode.com/posts/99999' }],
  ['See a CORS error', { method: 'GET', url: 'https://example.com/' }],
]

/** Re-indent JSON text without parsing the numbers, so large integers and 1.0 style numbers survive untouched. Returns null for invalid JSON. */
export function prettyJson(text) {
  try { JSON.parse(text) } catch { return null }
  let out = ''
  let depth = 0
  let i = 0
  const nl = () => '\n' + '  '.repeat(depth)
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '{' || c === '[') {
      let j = i + 1
      while (/\s/.test(text[j])) j++
      if (text[j] === (c === '{' ? '}' : ']')) { out += c + text[j]; i = j + 1 } else { depth++; out += c + nl(); i++ }
    } else if (c === '}' || c === ']') { depth--; out += nl() + c; i++ }
    else if (c === ',') { out += ',' + nl(); i++ }
    else if (c === ':') { out += ': '; i++ }
    else if (/\s/.test(c)) i++
    else { let j = i; while (j < text.length && !/[\s,:\]}]/.test(text[j])) j++; out += text.slice(i, j); i = j }
  }
  return out
}

const STYLE = `
.t-at .at-bar { display: flex; gap: 8px; }
.t-at .at-bar .input { flex: 1; min-width: 0; font-family: var(--mono); font-size: 14px; height: 46px; }
.t-at .at-bar .select { width: 124px; flex: none; height: 46px; font-weight: 650; }
.t-at .at-bar .btn { height: 46px; }
@media (max-width: 640px) { .t-at .at-bar { flex-wrap: wrap; } .t-at .at-bar .input { flex-basis: 100%; order: 3; } .t-at .at-bar .btn-primary { flex: 1; } }
.t-at .at-status { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.t-at .at-code { font-family: var(--mono); font-size: 22px; font-weight: 700; letter-spacing: -.02em; padding: 4px 14px; border-radius: 12px; border: 1px solid; }
.t-at .at-code.c2 { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 35%, transparent); }
.t-at .at-code.c3 { color: var(--info); background: var(--info-soft); border-color: color-mix(in srgb, var(--info) 35%, transparent); }
.t-at .at-code.c4 { color: var(--warning); background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 35%, transparent); }
.t-at .at-code.c5, .t-at .at-code.c0 { color: var(--danger); background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 35%, transparent); }
.t-at .at-meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--text-2); }
.t-at .at-meta b { font-family: var(--mono); font-weight: 600; color: var(--text); }
.t-at .at-body { margin: 0; padding: 14px; font-family: var(--mono); font-size: 13px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 520px; overflow: auto; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.t-at iframe.at-frame { width: 100%; height: 420px; border: 1px solid var(--border); border-radius: 14px; background: #fff; }
.t-at img.at-img { max-width: 100%; max-height: 420px; border-radius: 12px; border: 1px solid var(--border); background: var(--checker); }
.t-at .at-saved { display: grid; gap: 6px; max-height: 320px; overflow: auto; }
.t-at .at-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); cursor: pointer; text-align: left; color: inherit; transition: border-color .2s, transform .2s var(--spring); }
.t-at .at-item:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); transform: translateY(-1px); }
.t-at .at-item .m { font-family: var(--mono); font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 8px; background: var(--accent-soft); color: var(--accent); }
.t-at .at-item .u { font-family: var(--mono); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.t-at .at-item .s { font-size: 12px; color: var(--muted); }
.t-at .at-mp { display: grid; grid-template-columns: 22px minmax(0, 1fr) 96px minmax(0, 1.3fr) 36px; gap: 8px; align-items: center; }
@media (max-width: 640px) { .t-at .at-mp { grid-template-columns: 22px minmax(0, 1fr) 36px; } .t-at .at-mp > :nth-child(3), .t-at .at-mp > :nth-child(4) { grid-column: 2 / 3; } }
.t-at .at-spin { display: inline-block; }
`

export function mount(root, { signal } = {}) {
  useKit()
  css('t-at-css', STYLE)
  const q = hashParams()
  let controller = null
  let lastRes = null
  let view = 'pretty'
  let objUrl = null
  const revoke = () => { if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null } }
  onCleanup(() => { revoke(); controller?.abort() })

  // ---------- request builder ----------
  const methodSel = select(METHODS, 'GET', () => persist())
  methodSel.setAttribute('aria-label', 'HTTP method')
  const urlIn = input({ value: '', placeholder: 'https://api.example.com/path', 'aria-label': 'Request URL', spellcheck: false, autocomplete: 'off', oninput: () => { urlNote(); persist() } })
  const sendBtn = button('Send', { icon: 'send', variant: 'primary', onClick: () => send() })
  const cancelBtn = button('Cancel', { icon: 'x', variant: 'secondary', onClick: () => controller?.abort() })
  cancelBtn.hidden = true
  const urlWarn = h('div', { class: 'small' })
  const params = kvEditor({ keyPlaceholder: 'Parameter', onChange: () => persist() })
  const headers = kvEditor({ keyPlaceholder: 'Header name', listId: 'at-header-names', onChange: () => { headerWarn(); persist() } })
  const datalist = h('datalist', { id: 'at-header-names' }, HEADER_NAMES.map((n) => h('option', { value: n })))
  const headerNote = h('div')
  const authType = segmented([['none', 'None'], ['basic', 'Basic'], ['bearer', 'Bearer token'], ['apikey', 'API key']], 'none', () => { paintAuth(); persist() }, 'Authentication')
  const aUser = input({ placeholder: 'Username', 'aria-label': 'Username', autocomplete: 'off', oninput: () => persist() })
  const aPass = input({ placeholder: 'Password', 'aria-label': 'Password', type: 'password', autocomplete: 'off', oninput: () => persist() })
  const aToken = input({ mono: true, placeholder: 'Token', 'aria-label': 'Bearer token', autocomplete: 'off', oninput: () => persist() })
  const aKeyName = input({ mono: true, value: 'X-API-Key', placeholder: 'Name', 'aria-label': 'API key name', oninput: () => persist() })
  const aKeyVal = input({ mono: true, placeholder: 'Key', 'aria-label': 'API key value', autocomplete: 'off', oninput: () => persist() })
  const aKeyIn = segmented([['header', 'Header'], ['query', 'Query string']], 'header', () => persist(), 'API key location')
  const authBox = h('div', { class: 'stack tight' })
  function paintAuth() {
    const t = authType.value
    clear(authBox, t === 'none' ? h('div', { class: 'small muted' }, 'No credentials are sent.') : t === 'basic' ? h('div', { class: 'grid-2' }, aUser, aPass) : t === 'bearer' ? aToken : h('div', { class: 'stack tight' }, h('div', { class: 'grid-2' }, aKeyName, aKeyVal), aKeyIn),
      t !== 'none' ? h('div', { class: 'small muted' }, 'Saved requests keep credentials on this device only. Clear them before exporting.') : null)
  }
  const bodyType = segmented([['none', 'None'], ['json', 'JSON'], ['form', 'Form'], ['multipart', 'Multipart'], ['raw', 'Raw'], ['binary', 'Binary']], 'none', () => { paintBody(); persist() }, 'Body type')
  const jsonIn = textarea({ rows: 9, mono: true, spellcheck: false, 'aria-label': 'JSON body', oninput: () => { jsonCheck(); persist() } })
  const jsonNote = h('div', { class: 'row' })
  const formKv = kvEditor({ keyPlaceholder: 'Field', onChange: () => persist() })
  const rawIn = textarea({ rows: 7, mono: true, spellcheck: false, 'aria-label': 'Raw body', oninput: () => persist() })
  const rawType = select([['text/plain', 'text/plain'], ['application/xml', 'application/xml'], ['text/html', 'text/html'], ['text/csv', 'text/csv'], ['application/graphql', 'application/graphql'], ['application/json', 'application/json']], 'text/plain', () => persist())
  rawType.setAttribute('aria-label', 'Raw content type')
  const fileIn = h('input', { type: 'file', 'aria-label': 'File to send', class: 'input', style: 'padding-top:8px', onchange: () => persist() })
  const mpRows = []
  const mpWrap = h('div', { class: 'stack tight' })
  function addMp(k = '', v = '', kind = 'text', on = true) {
    const r = { on, k, v, kind, file: null }
    mpRows.push(r)
    const kin = input({ value: k, placeholder: 'Field', 'aria-label': 'Field name', oninput: (e) => { r.k = e.target.value; persist() } })
    const kindSel = select([['text', 'Text'], ['file', 'File']], kind, (val) => { r.kind = val; paintVal(); persist() })
    kindSel.setAttribute('aria-label', 'Field type')
    const valCell = h('div', { style: 'min-width:0' })
    const paintVal = () => clear(valCell, r.kind === 'file' ? h('input', { type: 'file', class: 'input', style: 'padding-top:8px', 'aria-label': 'File', onchange: (e) => { r.file = e.target.files[0] || null; persist() } }) : input({ value: r.v, placeholder: 'Value', 'aria-label': 'Field value', oninput: (e) => { r.v = e.target.value; persist() } }))
    paintVal()
    const row = h('div', { class: 'at-mp' }, h('input', { type: 'checkbox', checked: on, 'aria-label': 'Enabled', onchange: (e) => { r.on = e.target.checked; persist() } }), kin, kindSel, valCell,
      button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove field', onClick: () => { mpRows.splice(mpRows.indexOf(r), 1); row.remove(); persist() } }))
    mpWrap.append(row)
  }
  const bodyBox = h('div', { class: 'stack tight' })
  function paintBody() {
    const t = bodyType.value
    clear(bodyBox,
      t === 'none' ? h('div', { class: 'small muted' }, 'This request has no body.') :
      t === 'json' ? h('div', { class: 'stack tight' }, jsonIn, h('div', { class: 'row' }, jsonNote, button('Format', { icon: 'wand-sparkles', size: 'sm', variant: 'ghost', onClick: () => { const p = prettyJson(jsonIn.value); if (p) { jsonIn.value = p; jsonCheck(); persist() } } }))) :
      t === 'form' ? h('div', { class: 'stack tight' }, formKv.el, button('Add field', { icon: 'plus', size: 'sm', onClick: () => formKv.add('', '', true, true) })) :
      t === 'multipart' ? h('div', { class: 'stack tight' }, mpWrap, button('Add field', { icon: 'plus', size: 'sm', onClick: () => addMp() })) :
      t === 'raw' ? h('div', { class: 'stack tight' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Content type'), rawType), rawIn) :
      h('div', { class: 'stack tight' }, fileIn, h('div', { class: 'small muted' }, 'The file is sent as the raw request body. Choose a file for each session; browsers cannot remember file selections.')))
  }
  function jsonCheck() {
    clear(jsonNote)
    if (!jsonIn.value.trim()) return
    try { JSON.parse(jsonIn.value); jsonNote.append(pill('ok', 'check', 'Valid JSON')) } catch (e) { jsonNote.append(pill('warn', 'triangle-alert', 'Not valid JSON'), h('span', { class: 'small muted' }, e.message)) }
  }
  const optTimeout = number(30, { min: 1, max: 600, step: 1, ariaLabel: 'Timeout in seconds', onInput: () => persist() })
  const optCreds = toggle('Send cookies and credentials (credentials: include)', false, () => persist())
  const optRedirect = toggle('Follow redirects', true, () => persist())
  const optBust = toggle('Bypass the browser cache (cache: no-store)', true, () => persist())
  const optionsBox = h('div', { class: 'stack' }, h('label', { class: 'field', style: 'max-width:200px' }, h('span', { class: 'field-label' }, 'Timeout (seconds)'), optTimeout), optBust, optRedirect, optCreds,
    h('div', { class: 'small muted' }, 'Credentials only work when the server answers with Access-Control-Allow-Credentials: true and a specific origin.'))

  function urlNote() {
    clear(urlWarn)
    const v = urlIn.value.trim()
    if (!v) return
    try { const u = new URL(v); if (!/^https?:$/.test(u.protocol)) throw new Error() } catch { urlWarn.append(h('span', { style: 'color:var(--danger)' }, 'Enter a full URL starting with http:// or https://')); return }
    if (location.protocol === 'https:' && v.startsWith('http://') && !/^http:\/\/(localhost|127\.|\[::1\])/.test(v)) urlWarn.append(h('span', { style: 'color:var(--warning)' }, 'This page is served over https, so the browser will block a plain http:// request (mixed content). Use https:// if the server supports it.'))
  }
  function headerWarn() {
    const bad = headers.get().map(([k]) => k).filter(isForbidden)
    clear(headerNote, bad.length ? alert('warn', `Browsers do not let web pages set ${[...new Set(bad)].join(', ')}; ${bad.length === 1 ? 'it is' : 'they are'} ignored or replaced. Use the cURL output to send ${bad.length === 1 ? 'it' : 'them'} from a terminal.`) : h('span'))
  }

  // ---------- state ----------
  function getState() {
    return {
      method: methodSel.value, url: urlIn.value, params: params.rows.map((r) => [r.k, r.v, r.on]), headers: headers.rows.map((r) => [r.k, r.v, r.on]),
      authType: authType.value, aUser: aUser.value, aPass: aPass.value, aToken: aToken.value, aKeyName: aKeyName.value, aKeyVal: aKeyVal.value, aKeyIn: aKeyIn.value,
      bodyType: bodyType.value, json: jsonIn.value, form: formKv.rows.map((r) => [r.k, r.v, r.on]), raw: rawIn.value, rawType: rawType.value, mp: mpRows.map((r) => [r.k, r.kind === 'file' ? (r.file?.name || '') : r.v, r.kind, r.on]),
      timeout: optTimeout.valueAsNumber || 30, creds: optCreds.input.checked, redirect: optRedirect.input.checked, bust: optBust.input.checked,
    }
  }
  function setState(s) {
    methodSel.value = METHODS.includes(s.method) ? s.method : 'GET'
    urlIn.value = s.url || ''
    const setRows = (ed, list) => { ed.rows.length = 0; clear(ed.el); for (const [k, v, on] of list) ed.add(k, v, on !== false) }
    setRows(params, s.params?.length ? s.params : [['', '']])
    setRows(headers, s.headers || [])
    authType.set(s.authType || 'none'); aUser.value = s.aUser || ''; aPass.value = s.aPass || ''; aToken.value = s.aToken || ''; aKeyName.value = s.aKeyName || 'X-API-Key'; aKeyVal.value = s.aKeyVal || ''; aKeyIn.set(s.aKeyIn || 'header')
    bodyType.set(s.bodyType || 'none'); jsonIn.value = s.json || ''; setRows(formKv, s.form || [['', '']]); rawIn.value = s.raw || ''; rawType.value = s.rawType || 'text/plain'
    mpRows.length = 0; clear(mpWrap)
    for (const [k, v, kind, on] of s.mp?.length ? s.mp : [['', '', 'text', true]]) addMp(k, kind === 'file' ? '' : v, kind, on !== false)
    optTimeout.value = s.timeout || 30; optCreds.input.checked = !!s.creds; optRedirect.input.checked = s.redirect !== false; optBust.input.checked = s.bust !== false
    paintAuth(); paintBody(); jsonCheck(); headerWarn(); urlNote()
  }
  const persist = () => save('api-tester:last', getState())

  // ---------- model for cURL / code ----------
  function buildUrl() {
    let base = urlIn.value.trim()
    const ps = params.get()
    if (authType.value === 'apikey' && aKeyIn.value === 'query' && aKeyName.value) ps.push([aKeyName.value, aKeyVal.value])
    const [noHash, ...hashParts] = base.split('#')
    if (ps.length) base = `${noHash}${noHash.includes('?') ? '&' : '?'}${ps.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}${hashParts.length ? '#' + hashParts.join('#') : ''}`
    return base
  }
  function buildModel() {
    const m = { method: methodSel.value, url: buildUrl(), headers: headers.get(), body: null, auth: null, warnings: [], opts: { follow: optRedirect.input.checked, insecure: false, compressed: false, timeout: null, proxy: null } }
    const has = (k) => m.headers.some(([n]) => n.toLowerCase() === k)
    if (authType.value === 'basic') m.auth = { user: aUser.value, pass: aPass.value }
    else if (authType.value === 'bearer' && aToken.value) m.headers.push(['Authorization', `Bearer ${aToken.value}`])
    else if (authType.value === 'apikey' && aKeyIn.value === 'header' && aKeyName.value) m.headers.push([aKeyName.value, aKeyVal.value])
    const bt = bodyType.value
    if (bt === 'json' && jsonIn.value.trim()) { m.body = { kind: 'text', text: (() => { try { return JSON.stringify(JSON.parse(jsonIn.value)) } catch { return jsonIn.value } })() }; if (!has('content-type')) m.headers.push(['Content-Type', 'application/json']) }
    else if (bt === 'form') { const f = formKv.get(); if (f.length) { m.body = { kind: 'urlencoded', fields: f }; if (!has('content-type')) m.headers.push(['Content-Type', 'application/x-www-form-urlencoded']) } }
    else if (bt === 'multipart') { const parts = mpRows.filter((r) => r.on && r.k.trim()).map((r) => (r.kind === 'file' ? { name: r.k.trim(), file: r.file?.name || 'file' } : { name: r.k.trim(), value: r.v })); if (parts.length) m.body = { kind: 'multipart', parts } }
    else if (bt === 'raw' && rawIn.value) { m.body = { kind: 'text', text: rawIn.value }; if (!has('content-type')) m.headers.push(['Content-Type', rawType.value]) }
    else if (bt === 'binary' && fileIn.files[0]) m.body = { kind: 'file', path: fileIn.files[0].name }
    return m
  }

  // ---------- sending ----------
  const resultBox = h('div', { class: 'stack' })
  async function send() {
    if (controller) return
    let url
    try { url = buildUrl(); const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw new Error() } catch { clear(resultBox, alert('warn', 'Enter a full URL starting with http:// or https:// first.')); urlIn.focus(); return }
    const m = buildModel()
    const hd = new Headers()
    for (const [k, v] of m.headers) { try { hd.append(k, v) } catch { /* invalid header name or value: skipped */ } }
    if (m.auth) hd.set('Authorization', 'Basic ' + btoa(unescape(encodeURIComponent(`${m.auth.user}:${m.auth.pass}`))))
    let body
    const bt = bodyType.value
    const method = m.method
    if (method !== 'GET' && method !== 'HEAD') {
      if (bt === 'json' && jsonIn.value.trim()) body = jsonIn.value
      else if (bt === 'form' && m.body?.kind === 'urlencoded') body = new URLSearchParams(m.body.fields)
      else if (bt === 'multipart' && m.body) { body = new FormData(); for (const r of mpRows.filter((x) => x.on && x.k.trim())) r.kind === 'file' ? (r.file && body.append(r.k.trim(), r.file, r.file.name)) : body.append(r.k.trim(), r.v) }
      else if (bt === 'raw' && rawIn.value) body = rawIn.value
      else if (bt === 'binary' && fileIn.files[0]) body = fileIn.files[0]
    }
    if (bt === 'multipart') hd.delete('Content-Type') // the browser adds the boundary
    controller = new AbortController()
    const timeoutMs = Math.max(1, optTimeout.valueAsNumber || 30) * 1000
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    signal?.addEventListener('abort', () => controller?.abort(), { once: true })
    sendBtn.disabled = true; cancelBtn.hidden = false
    clear(resultBox, h('div', { class: 'row small muted' }, h('span', { class: 'spinner' }), `Sending ${method} request...`))
    const t0 = performance.now()
    try {
      const res = await fetch(url, { method, headers: hd, body, signal: controller.signal, redirect: optRedirect.input.checked ? 'follow' : 'manual', cache: optBust.input.checked ? 'no-store' : 'default', credentials: optCreds.input.checked ? 'include' : 'same-origin', mode: 'cors' })
      const tHead = performance.now() - t0
      const { bytes, truncated } = await readLimited(res, controller.signal)
      const tTotal = performance.now() - t0
      lastRes = { status: res.status, statusText: res.statusText, url: res.url, redirected: res.redirected, type: res.type, headers: [...res.headers.entries()], bytes, truncated, tHead, tTotal, method }
      pushHistory(url, method, res.status, tTotal)
      renderResponse()
    } catch (err) {
      lastRes = null
      if (timedOut) clear(resultBox, alert('error', h('div', h('strong', `Timed out after ${timeoutMs / 1000} seconds.`), ' The server did not answer in time. Raise the timeout under Options or check that the server is reachable.')))
      else if (controller.signal.aborted) clear(resultBox, alert('info', 'Request cancelled.'))
      else clear(resultBox, explainFailure(err, url, method, m))
      pushHistory(url, method, 0, performance.now() - t0)
    } finally {
      clearTimeout(timer)
      controller = null
      sendBtn.disabled = false; cancelBtn.hidden = true
    }
  }

  async function readLimited(res, sig) {
    if (!res.body) return { bytes: new Uint8Array(await res.arrayBuffer()), truncated: false }
    const reader = res.body.getReader()
    const chunks = []
    let total = 0
    let truncated = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
      if (total > MAX_BODY) { truncated = true; reader.cancel().catch(() => {}); break }
      if (sig.aborted) throw new DOMException('Aborted', 'AbortError')
    }
    const bytes = new Uint8Array(Math.min(total, MAX_BODY + 65536))
    let off = 0
    for (const c of chunks) { if (off >= bytes.length) break; bytes.set(c.subarray(0, bytes.length - off), off); off += c.length }
    return { bytes: bytes.subarray(0, Math.min(total, bytes.length)), truncated }
  }

  function explainFailure(err, url, method, m) {
    const custom = m.headers.filter(([k]) => !['accept', 'accept-language', 'content-language'].includes(k.toLowerCase()) && !(k.toLowerCase() === 'content-type' && /^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)/i.test(m.headers.find(([n]) => n.toLowerCase() === 'content-type')?.[1] || '')))
    const preflight = !['GET', 'HEAD', 'POST'].includes(method) || custom.length > 0
    const origin = location.origin === 'null' ? 'this page' : location.origin
    const probeOut = h('div')
    const probeBtn = button('Check whether the server is reachable', { icon: 'radar', size: 'sm', onClick: async () => {
      clear(probeOut, h('span', { class: 'small muted' }, 'Checking...'))
      try { await fetch(url, { mode: 'no-cors', cache: 'no-store', method: 'GET', signal: AbortSignal.timeout(8000) }); clear(probeOut, alert('success', h('div', h('strong', 'The server answered. '), 'A request with mode no-cors got a response, so the server is up and the failure is almost certainly CORS: the response was blocked because it lacks the headers listed above.'))) } catch { clear(probeOut, alert('warn', h('div', h('strong', 'No response at all. '), 'The server is probably down or unreachable, the name does not resolve, the TLS certificate is invalid, or a firewall, VPN, ad blocker or extension blocked the request. This is not a CORS problem.'))) }
    } })
    return h('div', { class: 'stack tight' },
      alert('error', h('div', h('strong', 'The browser could not complete this request. '), h('span', { class: 'muted' }, `(${err?.name || 'Error'}: ${err?.message || 'Failed to fetch'})`))),
      h('div', { class: 'panel stack tight' }, eyebrow('shield-question', 'Why this happens (usually CORS)'),
        h('p', { class: 'small', style: 'margin:0' }, `Browsers only let a page read a response from another site if that server opts in. Your request goes from ${origin} to ${(() => { try { return new URL(url).origin } catch { return url } })()}, so the server must answer with CORS headers. Browsers report CORS blocks, DNS failures, bad certificates and offline servers with the same generic error, so check the DevTools console for the exact reason.`),
        h('ul', { class: 'small', style: 'margin:0;padding-left:18px;display:grid;gap:4px' },
          h('li', h('code', 'Access-Control-Allow-Origin: *'), ' (or exactly ', h('code', origin), ') must be on the response.'),
          preflight ? h('li', `This request needs a preflight: the browser first sends OPTIONS, and the server must answer 2xx with `, h('code', 'Access-Control-Allow-Methods'), method !== 'GET' ? ` (including ${method})` : '', custom.length ? [' and ', h('code', 'Access-Control-Allow-Headers'), ` (${custom.map(([k]) => k).join(', ')})`] : '', '.') : null,
          optCreds.input.checked ? h('li', 'With credentials, the origin cannot be * and the response needs Access-Control-Allow-Credentials: true.') : null,
          h('li', 'Redirects must also carry CORS headers on every hop.'),
          location.protocol === 'https:' && url.startsWith('http://') ? h('li', { style: 'color:var(--warning)' }, 'Mixed content: this page is https, so http:// URLs are blocked outright.') : null),
        h('div', { class: 'row' }, probeBtn, button('Copy as cURL', { icon: 'terminal', size: 'sm', onClick: () => copyText(buildCurl(m, { multiline: false })) }), h('span', { class: 'small muted' }, 'cURL is not limited by CORS, so you can try the request in a terminal.')), probeOut))
  }

  // ---------- response ----------
  const decodeText = (bytes, ct) => {
    const cs = /charset=([^;\s]+)/i.exec(ct || '')?.[1] || 'utf-8'
    try { return new TextDecoder(cs, { fatal: true }).decode(bytes) } catch { return null }
  }
  function renderResponse() {
    revoke()
    const r = lastRes
    if (!r) return
    const ct = (r.headers.find(([k]) => k === 'content-type')?.[1] || '')
    const text = /^(image|audio|video)\//i.test(ct) || /octet-stream|zip|pdf|font/i.test(ct) ? null : decodeText(r.bytes, ct)
    const cls = String(r.status)[0]
    const phrase = r.statusText || STATUS_TEXT.get(r.status) || ''
    const kind = /^image\//i.test(ct) ? 'image' : /html/i.test(ct) ? 'html' : text == null ? 'binary' : (/json/i.test(ct) || (/^\s*[{[]/.test(text) && prettyJson(text) != null)) ? 'json' : 'text'
    const pretty = kind === 'json' ? prettyJson(text) : null
    view = kind === 'json' ? 'pretty' : kind === 'html' || kind === 'image' ? 'preview' : 'raw'
    const hdrSize = r.headers.reduce((n, [k, v]) => n + k.length + v.length + 4, 0)
    const views = [['pretty', 'Pretty'], ['raw', 'Raw'], ...(kind === 'html' || kind === 'image' ? [['preview', 'Preview']] : [])].filter(([v]) => v !== 'pretty' || kind === 'json')
    if (!views.some(([v]) => v === view)) view = views[0][0]
    const bodyEl = h('div')
    const paintBody = () => {
      clear(bodyEl)
      if (r.method === 'HEAD' || !r.bytes.length) { bodyEl.append(empty('The response has no body.', 'inbox')); return }
      if (kind === 'binary') { bodyEl.append(h('div', { class: 'stack tight' }, alert('info', `This response is binary (${ct || 'unknown type'}), ${formatBytes(r.bytes.length)}. Download it to open it.`), h('pre', { class: 'at-body' }, hex(r.bytes.subarray(0, 512), ' ') + (r.bytes.length > 512 ? '\n...' : '')))); return }
      if (view === 'preview' && kind === 'image') { objUrl = URL.createObjectURL(new Blob([r.bytes], { type: ct })); bodyEl.append(h('img', { class: 'at-img', src: objUrl, alt: 'Response image' })); return }
      if (view === 'preview' && kind === 'html') { bodyEl.append(h('iframe', { class: 'at-frame', sandbox: '', srcdoc: text, title: 'HTML preview (scripts disabled)' })); return }
      const shown = view === 'pretty' && pretty ? pretty : text
      if (shown.length > 400000) bodyEl.append(h('pre', { class: 'at-body' }, shown.slice(0, 400000) + '\n... (showing the first 400,000 characters; download the body for the rest)'))
      else if (view === 'pretty' && pretty) { const jv = jsonView(pretty, 'at-body'); jv.classList.remove('dv-out-body'); jv.classList.add('at-body'); bodyEl.append(jv) }
      else bodyEl.append(h('pre', { class: 'at-body', tabindex: 0 }, shown))
    }
    const viewChips = chips(views, { value: view, ariaLabel: 'Body view', onChange: (v) => { view = v; revoke(); paintBody() } })
    const bodyText = () => (text == null ? null : view === 'pretty' && pretty ? pretty : text)
    const ext = kind === 'json' ? 'json' : kind === 'html' ? 'html' : kind === 'image' ? (ct.split('/')[1] || 'img').split(';')[0] : kind === 'text' ? 'txt' : 'bin'
    const copyBtn = button('Copy', { icon: 'copy', size: 'sm', onClick: () => { const t = bodyText(); if (t != null) copyText(t) } })
    const dlBtn = button('Download', { icon: 'download', size: 'sm', variant: 'ghost', onClick: () => download(new Blob([r.bytes], { type: ct || 'application/octet-stream' }), `response.${ext}`) })
    const resultTabs = tabs([
      { id: 'body', label: 'Body', render: () => h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, viewChips, h('div', { class: 'row', style: 'gap:6px' }, copyBtn, dlBtn)), bodyEl) },
      { id: 'headers', label: `Headers (${r.headers.length})`, render: () => h('div', { class: 'stack tight' }, r.headers.length ? table({ columns: ['Name', 'Value'], rows: r.headers.map(([k, v]) => [h('code', { style: 'font-family:var(--mono)' }, k), h('span', { style: 'font-family:var(--mono);font-size:12.5px;overflow-wrap:anywhere' }, v)]) }) : empty('No response headers are visible.', 'inbox'),
        h('div', { class: 'small muted' }, 'Browsers only expose headers that are safe-listed or named in Access-Control-Expose-Headers, so some headers the server sent (such as Set-Cookie) may be missing here.')) },
      { id: 'request', label: 'Request', render: () => h('div', { class: 'stack tight' }, h('dl', { class: 'dv-kv' }, h('dt', 'Method'), h('dd', r.method), h('dt', 'Final URL'), h('dd', r.url || '(not exposed)'), h('dt', 'Redirected'), h('dd', r.redirected ? 'Yes' : 'No'), h('dt', 'Response type'), h('dd', r.type)), h('div', { class: 'row' }, button('Copy as cURL', { icon: 'terminal', size: 'sm', onClick: () => copyText(buildCurl(buildModel())) }), button('Copy as fetch', { icon: 'code', size: 'sm', onClick: () => copyText(generate(buildModel(), 'fetch')) }))) },
    ], 'body')
    paintBody()
    clear(resultBox,
      h('div', { class: 'panel stack' },
        h('div', { class: 'at-status' }, h('span', { class: ['at-code', `c${cls}`] }, r.status), h('div', { class: 'stack tight', style: 'gap:2px' }, h('b', phrase || 'Status'), h('a', { href: `#/http-status-codes?code=${r.status}`, class: 'small' }, `What does ${r.status} mean?`)),
          h('div', { class: 'at-meta', style: 'margin-left:auto' }, h('span', 'Time ', h('b', `${Math.round(r.tTotal)} ms`), h('span', { class: 'muted' }, ` (headers ${Math.round(r.tHead)} ms)`)), h('span', 'Size ', h('b', formatBytes(r.bytes.length)), r.truncated ? ' (truncated at 20 MB)' : '', h('span', { class: 'muted' }, ` + ${formatBytes(hdrSize)} headers`)))),
        r.type === 'opaqueredirect' ? alert('info', 'The server answered with a redirect and "Follow redirects" is off, so the browser hides the details. Turn it on to follow the redirect.') : null,
        resultTabs))
  }

  // ---------- saved + history ----------
  let savedList = load('api-tester:saved', [])
  let history = load('api-tester:history', [])
  const savedEl = h('div', { class: 'at-saved' })
  const histEl = h('div', { class: 'at-saved' })
  const nameIn = input({ placeholder: 'Name this request', 'aria-label': 'Request name', onkeydown: (e) => { if (e.key === 'Enter') doSave() } })
  const strip = (s) => ({ ...s, aPass: s.aPass, mp: (s.mp || []).map(([k, v, kind, on]) => [k, kind === 'file' ? '' : v, kind, on]) })
  function doSave() {
    const name = nameIn.value.trim() || `${methodSel.value} ${urlIn.value.trim().replace(/^https?:\/\//, '').slice(0, 40)}`
    savedList = [{ id: Date.now(), name, state: strip(getState()) }, ...savedList.filter((x) => x.name !== name)].slice(0, 60)
    save('api-tester:saved', savedList)
    nameIn.value = ''
    renderSaved()
  }
  function renderSaved() {
    clear(savedEl, ...(savedList.length ? savedList.map((s) => h('div', { class: 'at-item', role: 'button', tabindex: 0, onclick: () => { setState(s.state); persist() }, onkeydown: (e) => { if (e.key === 'Enter') { setState(s.state); persist() } } },
      h('span', { class: 'm' }, s.state.method), h('div', { style: 'min-width:0' }, h('div', { style: 'font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, s.name), h('div', { class: 'u muted' }, s.state.url)),
      button('', { icon: 'trash-2', size: 'sm', variant: 'ghost', ariaLabel: `Delete ${s.name}`, onClick: (e) => { e.stopPropagation(); savedList = savedList.filter((x) => x.id !== s.id); save('api-tester:saved', savedList); renderSaved() } }))) : [h('div', { class: 'small muted' }, 'No saved requests yet. Build one, name it above and press Save.')]))
  }
  function pushHistory(url, method, status, ms) {
    history = [{ t: Date.now(), method, url, status, ms: Math.round(ms), state: strip(getState()) }, ...history].slice(0, 25)
    save('api-tester:history', history)
    renderHistory()
  }
  function renderHistory() {
    clear(histEl, ...(history.length ? history.map((x) => h('div', { class: 'at-item', role: 'button', tabindex: 0, onclick: () => { setState(x.state); persist() }, onkeydown: (e) => { if (e.key === 'Enter') { setState(x.state); persist() } } },
      h('span', { class: 'm' }, x.method), h('div', { class: 'u', title: x.url }, x.url), h('span', { class: 's' }, `${x.status || 'failed'} · ${x.ms} ms`))) : [h('div', { class: 'small muted' }, 'Requests you send appear here.')]),
    history.length ? h('div', { class: 'row' }, button('Clear history', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { history = []; save('api-tester:history', history); renderHistory() } })) : null)
  }
  const exportBtn = button('Export', { icon: 'download', size: 'sm', variant: 'ghost', onClick: () => savedList.length && download(JSON.stringify({ app: 'api-tester', requests: savedList }, null, 2), 'api-tester-requests.json', 'application/json') })
  const importIn = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async (e) => {
    try { const j = JSON.parse(await e.target.files[0].text()); const list = (j.requests || []).filter((x) => x?.state?.url !== undefined); savedList = [...list, ...savedList].slice(0, 60); save('api-tester:saved', savedList); renderSaved() } catch { /* ignore invalid files */ }
    e.target.value = ''
  } })

  // ---------- import cURL ----------
  function importCurl(text) {
    const m = parseCurl(text)
    const [base, query] = m.url.split(/\?(.*)/s)
    const ps = query ? query.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')) } catch { return x } }; return i < 0 ? [dec(p), ''] : [dec(p.slice(0, i)), dec(p.slice(i + 1))] }) : []
    const s = { method: METHODS.includes(m.method) ? m.method : 'GET', url: base, params: ps.length ? ps : [['', '']], headers: m.headers, bodyType: 'none', timeout: 30, redirect: m.opts.follow, bust: true }
    if (m.auth) { s.authType = 'basic'; s.aUser = m.auth.user; s.aPass = m.auth.pass }
    const b = m.body
    if (b?.kind === 'text') { try { JSON.parse(b.text); s.bodyType = 'json'; s.json = prettyJson(b.text) || b.text } catch { s.bodyType = 'raw'; s.raw = b.text; s.rawType = m.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] || 'text/plain' } }
    else if (b?.kind === 'urlencoded') s.bodyType = 'form', s.form = b.fields
    else if (b?.kind === 'multipart') { s.bodyType = 'multipart'; s.mp = b.parts.map((p) => [p.name, p.file ? p.file : p.value, p.file ? 'file' : 'text', true]) }
    else if (b?.kind === 'file') s.bodyType = 'binary'
    if (s.bodyType === 'json' || s.bodyType === 'form') s.headers = m.headers.filter(([k, v]) => !(k.toLowerCase() === 'content-type' && /^(application\/json|application\/x-www-form-urlencoded)$/i.test(v)))
    setState(s)
    persist()
    return m
  }
  function importDialog() {
    const ta = textarea({ rows: 8, mono: true, spellcheck: false, placeholder: "curl 'https://api.example.com/items' -H 'Authorization: Bearer ...' -d '{\"a\":1}'", 'aria-label': 'curl command' })
    const msg = h('div')
    const dlg = modal({ title: 'Import a cURL command', icon: 'terminal', body: h('div', { class: 'stack tight' }, h('div', { class: 'small muted' }, 'Paste a command, for example from your browser\'s "Copy as cURL".'), ta, msg),
      actions: [button('Import', { variant: 'primary', icon: 'download', onClick: () => { try { const m = importCurl(ta.value); dlg.close(); if (m.warnings.length) clear(resultBox, alert('warn', h('div', m.warnings.join(' ')))) } catch (e) { clear(msg, alert('error', e.message)) } } })] })
    ta.focus()
  }

  // ---------- layout ----------
  const reqTabs = tabs([
    { id: 'params', label: 'Query', render: () => h('div', { class: 'stack tight' }, params.el, button('Add parameter', { icon: 'plus', size: 'sm', onClick: () => params.add('', '', true, true) })) },
    { id: 'headers', label: 'Headers', render: () => h('div', { class: 'stack tight' }, headers.el, datalist, headerNote, h('div', { class: 'row' }, button('Add header', { icon: 'plus', size: 'sm', onClick: () => headers.add('', '', true, true) }),
      ...[['Content-Type', 'application/json'], ['Accept', 'application/json'], ['Authorization', 'Bearer ']].map(([k, v]) => h('button', { type: 'button', class: 'dv-chip', onclick: () => { headers.add(k, v, true, false); persist() } }, k)))) },
    { id: 'auth', label: 'Auth', render: () => h('div', { class: 'stack tight' }, authType, authBox) },
    { id: 'body', label: 'Body', render: () => h('div', { class: 'stack tight' }, bodyType, bodyBox) },
    { id: 'options', label: 'Options', render: () => optionsBox },
  ], 'params')

  const exampleChips = h('div', { class: 'dv-chips' }, EXAMPLES.map(([name, s]) => h('button', { type: 'button', class: 'dv-chip', onclick: () => { setState({ ...s, params: [['', '']], timeout: 30, bust: true, redirect: true }); persist(); send() } }, name)))
  urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') send() })
  root.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send() } })

  root.append(h('div', { class: 'dv t-at stack' },
    h('div', { class: 'panel stack' },
      h('div', { class: 'at-bar' }, methodSel, urlIn, sendBtn, cancelBtn), urlWarn,
      reqTabs,
      h('div', { class: 'row between' }, h('div', { class: 'row', style: 'gap:6px' }, button('Import cURL', { icon: 'terminal', size: 'sm', onClick: importDialog }), button('Copy as cURL', { icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => { try { copyText(buildCurl(buildModel())) } catch { /* invalid */ } } })),
        h('div', { class: 'row', style: 'gap:6px' }, h('span', { class: 'small muted' }, 'Try:'), exampleChips))),
    resultBox,
    h('div', { class: 'tool-split' },
      h('div', { class: 'panel stack tight' }, h('div', { class: 'row between' }, eyebrow('bookmark', 'Saved requests'), h('div', { class: 'row', style: 'gap:4px' }, exportBtn, button('Import', { icon: 'upload', size: 'sm', variant: 'ghost', onClick: () => importIn.click() }), importIn)),
        h('div', { class: 'row' }, h('div', { style: 'flex:1;min-width:160px' }, nameIn), button('Save', { icon: 'save', size: 'sm', onClick: doSave })), savedEl),
      h('div', { class: 'panel stack tight' }, eyebrow('history', 'History'), histEl)),
    h('p', { class: 'small muted' }, 'Requests are sent straight from your browser to the URL you enter; nothing passes through our servers, so servers must allow cross-origin requests (CORS). Press Ctrl+Enter to send.')))

  // initial state: ?curl= from the converter, ?url= link, last request, or a friendly default
  const fromCurl = q.get('curl')
  if (fromCurl) { setState({}); try { importCurl(fromCurl) } catch (e) { clear(resultBox, alert('error', e.message)) } }
  else if (q.get('url')) setState({ method: q.get('method') || 'GET', url: q.get('url'), params: [['', '']] })
  else setState(load('api-tester:last', null) || { method: 'GET', url: 'https://jsonplaceholder.typicode.com/todos/1', params: [['', '']], headers: [['Accept', 'application/json']], timeout: 30, redirect: true, bust: true })
  renderSaved(); renderHistory()
  if (!resultBox.childElementCount) clear(resultBox, h('div', { class: 'panel' }, empty('Press Send to see the response: status, time, size, headers and a formatted body.', 'send')))
}
