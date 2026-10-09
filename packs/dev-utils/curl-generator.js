// cURL generator (params.mode 'build') and cURL converter (params.mode 'convert'): build a curl command from a form, or paste one and get
// JavaScript fetch, axios, Node.js, Python requests, PHP, Go and PowerShell code. All parsing happens in the browser.
import { h, icon, button, input, textarea, select, segmented, toggle, tabs, number, alert, clear, download, debounce } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { useKit, css, chips, eyebrow, pill, outBox } from './_kit.js'
import { parseCurl, buildCurl, generate, TARGETS, lowerHas } from './_curl.js'
import { kvEditor } from './_kv.js'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const HEADER_NAMES = ['Accept', 'Accept-Language', 'Authorization', 'Cache-Control', 'Content-Type', 'Cookie', 'If-None-Match', 'Origin', 'Referer', 'User-Agent', 'X-API-Key', 'X-Requested-With', 'X-Request-ID']
const QUICK = [['Content-Type', 'application/json'], ['Accept', 'application/json'], ['Authorization', 'Bearer YOUR_TOKEN'], ['User-Agent', 'my-app/1.0'], ['Content-Type', 'application/x-www-form-urlencoded']]
const EXT = { curl: ['sh', 'text/x-shellscript'], fetch: ['mjs', 'text/javascript'], axios: ['mjs', 'text/javascript'], node: ['mjs', 'text/javascript'], python: ['py', 'text/x-python'], php: ['php', 'text/x-php'], go: ['go', 'text/x-go'], powershell: ['ps1', 'text/plain'] }
const EXAMPLES = [
  ['JSON POST', `curl -X POST 'https://api.example.com/v1/users' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer YOUR_TOKEN' \\\n  -d '{"name":"Asha","email":"asha@example.com","roles":["admin","dev"]}'`],
  ['Browser copy', `curl 'https://api.example.com/search?q=cron&page=2' \\\n  -H 'accept: application/json, text/plain, */*' \\\n  -H 'accept-language: en-US,en;q=0.9' \\\n  -H 'cookie: session=abc123; theme=dark' \\\n  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64)' \\\n  --compressed`],
  ['Form + basic auth', `curl -u admin:secret -d 'title=Hello world' -d 'tags=a' -d 'tags=b' https://example.com/api/posts`],
  ['File upload', `curl -X POST https://example.com/upload \\\n  -F 'description=Quarterly report' \\\n  -F 'file=@report.pdf;type=application/pdf'`],
  ['Windows cmd', `curl ^"https://api.example.com/items^" ^\n  -H ^"Content-Type: application/json^" ^\n  --data-raw ^"^{^^^"id^^^":42,^^^"done^^^":true^}^"`],
]

const STYLE = `
.t-cg .cg-method { width: 130px; flex: none; }
.t-cg .cg-url { display: flex; gap: 8px; }
.t-cg .cg-url .input { flex: 1; min-width: 0; font-family: var(--mono); font-size: 14px; }
.t-cg .cg-summary { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; font-size: 13.5px; }
.t-cg .cg-summary dt { color: var(--muted); }
.t-cg .cg-summary dd { margin: 0; font-family: var(--mono); font-size: 13px; overflow-wrap: anywhere; }
.t-cg .cg-warn { margin: 0; padding-left: 18px; font-size: 13px; color: var(--warning); display: grid; gap: 2px; }
`

export function mount(root, { params = {} } = {}) {
  useKit()
  css('t-cg-css', STYLE)
  const convert = params.mode === 'convert'
  let model = null
  let target = 'curl'
  const saved = convert ? null : load('curl-builder', null)

  // ---------- outputs ----------
  const targetChips = chips([['curl', 'cURL'], ...TARGETS.map(([id, name]) => [id, name])], { value: target, ariaLabel: 'Output language', onChange: (v) => { target = v; renderOut() } })
  const shellSel = select([['bash', 'bash / zsh quoting'], ['cmd', 'Windows cmd'], ['powershell', 'PowerShell']], 'bash', () => renderOut())
  shellSel.setAttribute('aria-label', 'Shell quoting for the curl command')
  shellSel.style.cssText = 'width:auto;min-width:170px;height:34px'
  const oneLine = toggle('Single line', false, () => renderOut())
  const out = outBox('Output', { placeholder: 'The generated code appears here.' })
  let currentCode = ''
  out.head.querySelector('.acts').append(button('', { icon: 'download', size: 'sm', variant: 'ghost', ariaLabel: 'Download code', onClick: () => { if (currentCode) { const [ext, type] = EXT[target]; download(currentCode, `request.${ext}`, type) } } }))
  const warn = h('div')
  const shellNote = h('div', { class: 'small muted' })
  const summary = h('div')

  function renderOut() {
    clear(warn)
    if (!model) { currentCode = ''; out.set(''); return }
    let code = ''
    try { code = target === 'curl' ? buildCurl(model, { shell: shellSel.value, multiline: !oneLine.input.checked }) : generate(model, target) } catch (e) { clear(warn, alert('error', e.message)); out.set(''); return }
    currentCode = code
    out.set(code, { quiet: true })
    out.head.querySelector('span').textContent = target === 'curl' ? 'cURL command' : TARGETS.find(([id]) => id === target)[1]
    shellSel.hidden = oneLine.hidden = target !== 'curl'
    shellNote.textContent = target === 'curl' && shellSel.value === 'cmd' ? 'In a .bat file, write each % as %%.' : target === 'curl' && shellSel.value === 'powershell' ? 'Uses curl.exe, because curl is an alias of Invoke-WebRequest in Windows PowerShell.' : ''
    if (model.warnings.length) clear(warn, h('ul', { class: 'cg-warn' }, model.warnings.map((w) => h('li', w))))
  }

  // ---------- convert mode ----------
  const cmdIn = textarea({ rows: 12, mono: true, spellcheck: false, placeholder: "Paste a curl command here, for example from your browser's \"Copy as cURL\"...", 'aria-label': 'curl command' })
  const status = h('div', { class: 'row', style: 'min-height:28px' })
  function parseNow() {
    clear(summary); clear(status)
    const text = cmdIn.value
    if (!text.trim()) { model = null; renderOut(); clear(status, pill('', 'info', 'Paste a curl command')); return }
    try { model = parseCurl(text) } catch (e) {
      model = null
      clear(status, pill('bad', 'circle-alert', 'Cannot read this command'))
      clear(summary, alert('error', e.message))
      renderOut()
      return
    }
    clear(status, pill('ok', 'check', 'Parsed'), pill('info', null, model.method))
    const b = model.body
    const bodyText = !b ? '(none)' : b.kind === 'text' ? b.text : b.kind === 'urlencoded' ? b.fields.map(([k, v]) => `${k}=${v}`).join('\n') : b.kind === 'multipart' ? b.parts.map((p) => `${p.name} = ${p.file ? '@' + p.file : p.value}`).join('\n') : `file: ${b.path}`
    clear(summary, h('div', { class: 'panel stack tight' }, eyebrow('scan-search', 'What curl would send'),
      h('dl', { class: 'cg-summary' }, h('dt', 'Method'), h('dd', model.method), h('dt', 'URL'), h('dd', model.url),
        model.auth ? [h('dt', 'Basic auth'), h('dd', `${model.auth.user}:${'*'.repeat(Math.min(8, model.auth.pass.length))}`)] : null,
        h('dt', 'Headers'), h('dd', model.headers.length ? model.headers.map(([k, v]) => `${k}: ${v}`).join('\n') : '(none)'),
        h('dt', 'Body'), h('dd', { style: 'white-space:pre-wrap;max-height:160px;overflow:auto' }, bodyText.length > 2000 ? bodyText.slice(0, 2000) + '...' : bodyText),
        h('dt', 'Options'), h('dd', [model.opts.follow && 'follow redirects', model.opts.insecure && 'skip TLS verification', model.opts.compressed && 'compressed', model.opts.timeout && `timeout ${model.opts.timeout}s`, model.opts.proxy && `proxy ${model.opts.proxy}`].filter(Boolean).join(', ') || '(defaults)'))))
    renderOut()
  }
  cmdIn.addEventListener('input', debounce(parseNow, 150))

  // ---------- build mode ----------
  const methodSel = select(METHODS, saved?.method || 'POST', () => update())
  methodSel.classList.add('cg-method')
  methodSel.setAttribute('aria-label', 'HTTP method')
  const urlIn = input({ value: saved?.url ?? 'https://api.example.com/v1/users', placeholder: 'https://api.example.com/path', 'aria-label': 'URL', spellcheck: false, oninput: () => update() })
  const params_ = kvEditor({ keyPlaceholder: 'Parameter', onChange: () => update() })
  const headers = kvEditor({ keyPlaceholder: 'Header name', listId: 'cg-header-names', onChange: () => update() })
  const datalist = h('datalist', { id: 'cg-header-names' }, HEADER_NAMES.map((n) => h('option', { value: n })))
  const authType = segmented([['none', 'None'], ['basic', 'Basic'], ['bearer', 'Bearer token'], ['apikey', 'API key']], saved?.authType || 'none', () => { paintAuth(); update() }, 'Authentication')
  const authUser = input({ value: saved?.authUser || '', placeholder: 'Username', 'aria-label': 'Username', autocomplete: 'off', oninput: () => update() })
  const authPass = input({ value: saved?.authPass || '', placeholder: 'Password', 'aria-label': 'Password', autocomplete: 'off', oninput: () => update() })
  const authToken = input({ mono: true, value: saved?.authToken || '', placeholder: 'Token', 'aria-label': 'Bearer token', autocomplete: 'off', oninput: () => update() })
  const authKeyName = input({ mono: true, value: saved?.authKeyName || 'X-API-Key', placeholder: 'Header name', 'aria-label': 'API key header name', oninput: () => update() })
  const authKeyVal = input({ mono: true, value: saved?.authKeyVal || '', placeholder: 'Key', 'aria-label': 'API key', autocomplete: 'off', oninput: () => update() })
  const authBox = h('div', { class: 'stack tight' })
  function paintAuth() {
    const t = authType.value
    clear(authBox, t === 'none' ? h('div', { class: 'small muted' }, 'No authentication header is added.') : t === 'basic' ? h('div', { class: 'grid-2' }, authUser, authPass) : t === 'bearer' ? authToken : h('div', { class: 'grid-2' }, authKeyName, authKeyVal),
      t !== 'none' ? h('div', { class: 'small muted' }, 'Credentials stay in this page and in the generated text. Use placeholders for real secrets before sharing a command.') : null)
  }
  const bodyType = segmented([['none', 'None'], ['json', 'JSON'], ['form', 'Form'], ['multipart', 'Multipart'], ['raw', 'Raw'], ['file', 'File']], saved?.bodyType || 'json', () => { paintBody(); update() }, 'Body type')
  const jsonIn = textarea({ rows: 8, mono: true, spellcheck: false, value: saved?.json ?? '{\n  "name": "Asha",\n  "email": "asha@example.com",\n  "roles": ["admin", "dev"]\n}', 'aria-label': 'JSON body', oninput: () => update() })
  const jsonNote = h('div', { class: 'small' })
  const formKv = kvEditor({ keyPlaceholder: 'Field', onChange: () => update() })
  const multiKv = kvEditor({ keyPlaceholder: 'Field', valuePlaceholder: 'Text, or @path/to/file', onChange: () => update() })
  const rawIn = textarea({ rows: 6, mono: true, spellcheck: false, value: saved?.raw || '', 'aria-label': 'Raw body', oninput: () => update() })
  const rawType = select([['text/plain', 'text/plain'], ['application/xml', 'application/xml'], ['text/csv', 'text/csv'], ['application/graphql', 'application/graphql'], ['application/octet-stream', 'binary']], saved?.rawType || 'text/plain', () => update())
  rawType.setAttribute('aria-label', 'Raw content type')
  const fileIn = input({ mono: true, value: saved?.file || '', placeholder: 'path/to/file.bin', 'aria-label': 'File path', oninput: () => update() })
  const bodyBox = h('div', { class: 'stack tight' })
  function paintBody() {
    const t = bodyType.value
    clear(bodyBox,
      t === 'none' ? h('div', { class: 'small muted' }, 'No request body.') :
      t === 'json' ? h('div', { class: 'stack tight' }, jsonIn, h('div', { class: 'row' }, jsonNote, button('Format', { icon: 'wand-sparkles', size: 'sm', variant: 'ghost', onClick: () => { try { jsonIn.value = JSON.stringify(JSON.parse(jsonIn.value), null, 2); update() } catch { /* the note shows the error */ } } }))) :
      t === 'form' ? h('div', { class: 'stack tight' }, formKv.el, button('Add field', { icon: 'plus', size: 'sm', onClick: () => formKv.add('', '', true, true) })) :
      t === 'multipart' ? h('div', { class: 'stack tight' }, multiKv.el, button('Add field', { icon: 'plus', size: 'sm', onClick: () => multiKv.add('', '', true, true) }), h('div', { class: 'small muted' }, 'Start a value with @ to upload a file, for example @photo.png.')) :
      t === 'raw' ? h('div', { class: 'stack tight' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Content type'), rawType), rawIn) :
      h('div', { class: 'stack tight' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'File to send as the body'), fileIn), h('div', { class: 'small muted' }, 'Sent exactly as is (curl --data-binary @file).')))
  }
  const optFollow = toggle('Follow redirects (-L)', saved?.follow || false, () => update())
  const optInsecure = toggle('Skip TLS verification (-k)', false, () => update())
  const optCompressed = toggle('Compressed (--compressed)', saved?.compressed || false, () => update())
  const optVerbose = toggle('Verbose (-v)', false, () => update())
  const optSilent = toggle('Silent (-s)', false, () => update())
  const optInclude = toggle('Show response headers (-i)', false, () => update())
  const optTimeout = number('', { min: 0, step: 1, placeholder: 'seconds', ariaLabel: 'Timeout in seconds', onInput: () => update() })
  const optProxy = input({ mono: true, placeholder: 'http://proxy:8080', 'aria-label': 'Proxy', oninput: () => update() })
  const optionsBox = h('div', { class: 'stack' }, h('div', { class: 'grid-auto' }, optFollow, optCompressed, optInsecure, optVerbose, optSilent, optInclude),
    h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Timeout'), optTimeout), h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Proxy'), optProxy)))
  const urlNote = h('div', { class: 'small' })

  if (!convert) {
    if (saved?.params?.length) params_.set(saved.params); else params_.add('', '')
    if (saved?.headers?.length) headers.set(saved.headers); else headers.set([['Content-Type', 'application/json'], ['Authorization', 'Bearer YOUR_TOKEN']])
    formKv.set(saved?.form?.length ? saved.form : [['name', 'Asha']])
    multiKv.set(saved?.multi?.length ? saved.multi : [['description', 'Report'], ['file', '@report.pdf']])
    paintAuth(); paintBody()
  }

  function update() {
    if (convert) return
    clear(urlNote)
    let url
    try {
      const base = urlIn.value.trim()
      if (!/^https?:$/.test(new URL(base).protocol)) throw new Error('scheme')
      const ps = params_.get()
      const [beforeHash, ...hashParts] = base.split('#')
      url = ps.length ? `${beforeHash}${beforeHash.includes('?') ? '&' : '?'}${ps.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}${hashParts.length ? '#' + hashParts.join('#') : ''}` : base
    } catch { model = null; clear(urlNote, h('span', { style: 'color:var(--danger)' }, 'Enter a full URL starting with http:// or https://')); renderOut(); return }
    const hs = headers.get()
    const m = { method: methodSel.value, url, headers: [...hs], body: null, auth: null, warnings: [], opts: { follow: optFollow.input.checked, insecure: optInsecure.input.checked, compressed: optCompressed.input.checked, verbose: optVerbose.input.checked, silent: optSilent.input.checked, include: optInclude.input.checked, timeout: optTimeout.valueAsNumber > 0 ? optTimeout.valueAsNumber : null, proxy: optProxy.value.trim() || null } }
    // The body type decides the Content-Type unless the user wrote a custom one (a value that is not one of the automatic ones)
    const AUTO = ['application/json', 'application/x-www-form-urlencoded', 'text/plain', 'application/xml', 'text/csv', 'application/graphql', 'application/octet-stream']
    const addH = (k, v) => {
      const i = m.headers.findIndex(([n]) => n.toLowerCase() === k.toLowerCase())
      if (i < 0) m.headers.push([k, v])
      else if (AUTO.includes(m.headers[i][1].toLowerCase())) m.headers[i] = [m.headers[i][0], v]
    }
    const t = authType.value
    if (t === 'basic') m.auth = { user: authUser.value, pass: authPass.value }
    else if (t === 'bearer' && authToken.value) m.headers = m.headers.filter(([k]) => k.toLowerCase() !== 'authorization').concat([['Authorization', `Bearer ${authToken.value}`]])
    else if (t === 'apikey' && authKeyName.value) m.headers.push([authKeyName.value, authKeyVal.value])
    const bt = bodyType.value
    clear(jsonNote)
    if (bt === 'json') {
      const txt = jsonIn.value
      if (txt.trim()) {
        try { JSON.parse(txt); jsonNote.append(pill('ok', 'check', 'Valid JSON')) } catch (e) { jsonNote.append(pill('warn', 'triangle-alert', 'Not valid JSON'), h('span', { class: 'small muted' }, ` ${e.message}`)) }
        m.body = { kind: 'text', text: txt.trim().startsWith('{') || txt.trim().startsWith('[') ? compactJson(txt) : txt }
        addH('Content-Type', 'application/json')
      }
    } else if (bt === 'form') { const f = formKv.get(); if (f.length) { m.body = { kind: 'urlencoded', fields: f }; addH('Content-Type', 'application/x-www-form-urlencoded') } }
    else if (bt === 'multipart') { const f = multiKv.get(); if (f.length) m.body = { kind: 'multipart', parts: f.map(([k, v]) => (v.startsWith('@') ? { name: k, file: v.slice(1) } : { name: k, value: v })) } }
    else if (bt === 'raw' && rawIn.value) { m.body = { kind: 'text', text: rawIn.value }; addH('Content-Type', rawType.value) }
    else if (bt === 'file' && fileIn.value.trim()) m.body = { kind: 'file', path: fileIn.value.trim() }
    model = m
    renderOut()
    save('curl-builder', { method: methodSel.value, url: urlIn.value, params: params_.rows.map((r) => [r.k, r.v]), headers: headers.rows.map((r) => [r.k, r.v]), authType: authType.value, authUser: authUser.value, authToken: authToken.value, authKeyName: authKeyName.value, authKeyVal: authKeyVal.value,
      bodyType: bodyType.value, json: jsonIn.value, form: formKv.rows.map((r) => [r.k, r.v]), multi: multiKv.rows.map((r) => [r.k, r.v]), raw: rawIn.value, rawType: rawType.value, file: fileIn.value, follow: optFollow.input.checked, compressed: optCompressed.input.checked })
  }
  // curl sends the JSON exactly as written; keep it compact like most examples do
  const compactJson = (t) => { try { return JSON.stringify(JSON.parse(t)) } catch { return t } }

  // ---------- layout ----------
  const outputs = h('div', { class: 'stack' }, h('div', { class: 'panel stack' }, h('div', { class: 'row between' }, eyebrow('code', 'Output'), h('div', { class: 'row', style: 'gap:8px' }, shellSel, oneLine)), targetChips, out.el, shellNote, warn,
    h('div', { class: 'row' }, h('a', { class: 'btn btn-secondary btn-sm', href: '#/api-tester', onclick: (e) => { if (model) { e.preventDefault(); location.hash = `#/api-tester?curl=${encodeURIComponent(buildCurl(model, { multiline: false }))}` } } }, icon('send'), h('span', 'Open in API tester')),
      h('span', { class: 'small muted' }, 'Runs the request from your browser (subject to CORS).'))))

  if (convert) {
    const ex = h('div', { class: 'dv-chips' }, EXAMPLES.map(([name, cmd]) => h('button', { type: 'button', class: 'dv-chip', onclick: () => { cmdIn.value = cmd; parseNow(); cmdIn.focus() } }, name)))
    root.append(h('div', { class: 'dv t-cg stack' }, h('div', { class: 'tool-split' },
      h('div', { class: 'stack' }, h('div', { class: 'panel stack tight' }, eyebrow('terminal', 'Your curl command'), cmdIn, status, h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Try:'), ex, button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { cmdIn.value = ''; parseNow(); cmdIn.focus() } }))), summary),
      outputs),
    h('p', { class: 'small muted' }, 'Handles quotes, line continuations, $\'...\' strings and Windows cmd carets, plus -X -H -d --data-raw --data-urlencode -F -u -b -A -e -L -k -G -I -T --json --compressed and more. Options with no equivalent are listed as notes.')))
    target = 'fetch'
    targetChips.set('fetch')
    cmdIn.value = EXAMPLES[0][1]
    parseNow()
    return
  }

  const reqTabs = tabs([
    { id: 'params', label: 'Query', render: () => h('div', { class: 'stack tight' }, params_.el, button('Add parameter', { icon: 'plus', size: 'sm', onClick: () => params_.add('', '', true, true) })) },
    { id: 'headers', label: 'Headers', render: () => h('div', { class: 'stack tight' }, headers.el, datalist, h('div', { class: 'row' }, button('Add header', { icon: 'plus', size: 'sm', onClick: () => headers.add('', '', true, true) }), ...QUICK.map(([k, v]) => h('button', { type: 'button', class: 'dv-chip', title: `${k}: ${v}`, onclick: () => { headers.add(k, v); update() } }, k === 'Content-Type' || k === 'Accept' ? `${k}: ${v.replace('application/', '')}` : k)))) },
    { id: 'auth', label: 'Auth', render: () => h('div', { class: 'stack tight' }, authType, authBox) },
    { id: 'body', label: 'Body', render: () => h('div', { class: 'stack tight' }, bodyType, bodyBox) },
    { id: 'options', label: 'Options', render: () => optionsBox },
  ], 'headers')

  root.append(h('div', { class: 'dv t-cg stack' }, h('div', { class: 'tool-split' },
    h('div', { class: 'panel stack' }, eyebrow('sliders-horizontal', 'Request'), h('div', { class: 'cg-url' }, methodSel, urlIn), urlNote, reqTabs),
    outputs),
  h('p', { class: 'small muted' }, 'Already have a curl command? Use the cURL converter to turn it into code. Nothing you type here is sent anywhere; the last request is remembered on this device only.')))
  paintAuth(); paintBody(); update()
}
