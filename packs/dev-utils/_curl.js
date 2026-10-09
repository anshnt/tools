// cURL <-> request model <-> code. Pure functions, no DOM.
// Request model: { method, url, headers: [[name, value]], body, auth: {user, pass}|null, opts: {...}, warnings: [] }
//   body: null | {kind: 'text', text} | {kind: 'urlencoded', fields: [[k, v]]} | {kind: 'multipart', parts: [{name, value?, file?, type?, filename?}]} | {kind: 'file', path}

// ---------- shell tokenizer ----------
const ANSI = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '?': '?' }

/** Split a shell command into words, honouring '...', "...", $'...', backslashes and line continuations. Also understands Windows cmd ^" quoting. */
export function tokenize(src) {
  let s = src.replace(/\r\n/g, '\n')
  if (/\^"/.test(s)) s = s.replace(/\^\^\^"/g, '\u0001').replace(/\^"/g, '"').replace(/\^\n/g, ' ').replace(/\^([^\n])/g, '$1').replace(/\u0001/g, '\\"')
  s = s.replace(/\\\n/g, ' ')
  const out = []
  let cur = ''
  let has = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false } continue }
    has = true
    if (c === '\\') { if (i + 1 < s.length) cur += s[++i]; continue }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) throw new Error('Unclosed single quote in the command.'); cur += s.slice(i + 1, j); i = j; continue }
    if (c === '$' && s[i + 1] === "'") {
      i += 2
      let bytes = []
      const flush = () => { if (bytes.length) { cur += new TextDecoder().decode(Uint8Array.from(bytes)); bytes = [] } }
      for (; i < s.length && s[i] !== "'"; i++) {
        if (s[i] !== '\\') { flush(); cur += s[i]; continue }
        const n = s[++i]
        let m
        if (n === 'x' && (m = /^[0-9a-fA-F]{1,2}/.exec(s.slice(i + 1)))) { bytes.push(parseInt(m[0], 16)); i += m[0].length; continue }
        if (/[0-7]/.test(n) && (m = /^[0-7]{1,3}/.exec(s.slice(i)))) { bytes.push(parseInt(m[0], 8) & 255); i += m[0].length - 1; continue }
        flush()
        if (n === 'u' && (m = /^[0-9a-fA-F]{1,4}/.exec(s.slice(i + 1)))) { cur += String.fromCharCode(parseInt(m[0], 16)); i += m[0].length }
        else if (n === 'U' && (m = /^[0-9a-fA-F]{1,8}/.exec(s.slice(i + 1)))) { cur += String.fromCodePoint(parseInt(m[0], 16)); i += m[0].length }
        else cur += n in ANSI ? ANSI[n] : '\\' + n
      }
      flush()
      continue
    }
    if (c === '"') {
      i++
      for (; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && '"\\$`'.includes(s[i + 1])) { cur += s[++i]; continue }
        cur += s[i]
      }
      if (i >= s.length) throw new Error('Unclosed double quote in the command.')
      continue
    }
    cur += c
  }
  if (has) out.push(cur)
  return out
}

// ---------- parser ----------
const LONG_ARG = new Set(['request', 'header', 'data', 'data-raw', 'data-binary', 'data-ascii', 'data-urlencode', 'user', 'user-agent', 'referer', 'cookie', 'cookie-jar', 'form', 'form-string', 'output', 'max-time', 'connect-timeout', 'proxy', 'upload-file', 'write-out', 'url', 'oauth2-bearer', 'json', 'resolve', 'cacert', 'cert', 'key', 'retry', 'range', 'limit-rate', 'proxy-user', 'dump-header', 'config', 'trace', 'trace-ascii', 'interface', 'local-port', 'max-redirs', 'retry-delay', 'retry-max-time', 'speed-limit', 'speed-time', 'time-cond', 'tlsv1.2', 'pass', 'ciphers', 'connect-to', 'aws-sigv4', 'variable', 'expect100-timeout', 'keepalive-time', 'happy-eyeballs-timeout-ms'])
const SHORT_ARG = { X: 'request', H: 'header', d: 'data', u: 'user', A: 'user-agent', e: 'referer', b: 'cookie', c: 'cookie-jar', F: 'form', o: 'output', m: 'max-time', x: 'proxy', T: 'upload-file', w: 'write-out', K: 'config', r: 'range', D: 'dump-header', E: 'cert', P: 'ftp-port', t: 'telnet-option', y: 'speed-time', Y: 'speed-limit', z: 'time-cond', Q: 'quote' }
const SHORT_BOOL = { L: 'location', k: 'insecure', s: 'silent', S: 'show-error', v: 'verbose', i: 'include', I: 'head', G: 'get', f: 'fail', O: 'remote-name', g: 'globoff', N: 'no-buffer', '0': 'http1.0', '1': 'tlsv1', '2': 'sslv2', '3': 'sslv3', '4': 'ipv4', '6': 'ipv6', j: 'junk-session-cookies', l: 'list-only', n: 'netrc', p: 'proxytunnel', q: 'disable', Z: 'parallel', '#': 'progress-bar' }
const KNOWN_BOOL = new Set(['location', 'insecure', 'silent', 'show-error', 'verbose', 'include', 'head', 'get', 'fail', 'remote-name', 'globoff', 'no-buffer', 'compressed', 'http1.0', 'http1.1', 'http2', 'http2-prior-knowledge', 'http3', 'ipv4', 'ipv6', 'progress-bar', 'location-trusted', 'tr-encoding', 'fail-with-body', 'no-keepalive', 'raw', 'path-as-is', 'anyauth', 'basic', 'digest', 'ntlm', 'negotiate', 'netrc', 'parallel', 'remote-name-all', 'tcp-nodelay', 'ssl', 'tlsv1.3', 'tlsv1.2', 'tlsv1.1', 'tlsv1.0', 'no-progress-meter', 'create-dirs', 'retry-connrefused', 'disable', 'proxytunnel', 'list-only', 'junk-session-cookies', 'ssl-no-revoke', 'insecure-skip', 'styled-output'])
const NOOP = new Set(['silent', 'show-error', 'verbose', 'progress-bar', 'no-progress-meter', 'globoff', 'no-buffer', 'ipv4', 'ipv6', 'http1.0', 'http1.1', 'http2', 'http2-prior-knowledge', 'http3', 'fail', 'fail-with-body', 'raw', 'path-as-is', 'tcp-nodelay', 'no-keepalive', 'tlsv1.3', 'tlsv1.2', 'tlsv1.1', 'tlsv1.0', 'ssl', 'disable', 'create-dirs', 'ssl-no-revoke', 'styled-output', 'tr-encoding', 'location-trusted', 'remote-name', 'remote-name-all', 'output', 'dump-header', 'write-out', 'trace', 'trace-ascii'])

const encForm = (s) => encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
const lowerHas = (headers, name) => headers.find(([k]) => k.toLowerCase() === name.toLowerCase())

/** Parse a curl command line into the request model. Throws a readable Error when it cannot find a URL. */
export function parseCurl(cmd) {
  const toks = tokenize(cmd.trim().replace(/^\$\s+/, ''))
  if (!toks.length) throw new Error('Paste a curl command first.')
  let i = /^(?:curl|curl\.exe)$/i.test(toks[0]) ? 1 : 0
  const m = { method: null, url: null, headers: [], body: null, auth: null, opts: { follow: false, insecure: false, compressed: false, timeout: null, proxy: null, head: false, get: false }, warnings: [] }
  const data = [] // {text|file, mode}
  const forms = []
  let jsonMode = false
  let uploadFile = null
  const urls = []
  const addHeader = (raw) => {
    const k = raw.indexOf(':')
    if (k < 0) { if (raw.endsWith(';')) return; m.warnings.push(`Header "${raw}" has no colon and was ignored.`); return }
    const name = raw.slice(0, k).trim()
    const value = raw.slice(k + 1).trim()
    if (!value && raw.slice(k + 1) === '') return // "Name:" removes a header in curl
    m.headers.push([name, value])
  }
  const handle = (name, val) => {
    switch (name) {
      case 'request': m.method = val.toUpperCase(); break
      case 'header': if (val.startsWith('@')) m.warnings.push('Headers read from a file (-H @file) are not supported.'); else addHeader(val); break
      case 'data': case 'data-ascii': case 'data-binary': case 'data-raw': data.push({ raw: name === 'data-raw', text: val }); break
      case 'data-urlencode': {
        const eq = val.indexOf('=')
        if (eq >= 0) data.push({ text: (eq > 0 ? val.slice(0, eq) + '=' : '') + encForm(val.slice(eq + 1)), raw: true })
        else data.push({ text: encForm(val), raw: true })
        break
      }
      case 'json': data.push({ text: val, raw: false, json: true }); jsonMode = true; break
      case 'form': case 'form-string': forms.push({ val, literal: name === 'form-string' }); break
      case 'user': { const c = val.indexOf(':'); m.auth = c < 0 ? { user: val, pass: '' } : { user: val.slice(0, c), pass: val.slice(c + 1) }; if (c < 0) m.warnings.push('No password was given with -u; curl would prompt for it.'); break }
      case 'user-agent': m.headers.push(['User-Agent', val]); break
      case 'referer': m.headers.push(['Referer', val]); break
      case 'cookie': if (val.includes('=')) m.headers.push(['Cookie', val]); else m.warnings.push('Cookies read from a file (-b file) are not supported.'); break
      case 'cookie-jar': m.warnings.push('The cookie jar (-c) was ignored.'); break
      case 'location': m.opts.follow = true; break
      case 'silent': m.opts.silent = true; break
      case 'verbose': m.opts.verbose = true; break
      case 'insecure': m.opts.insecure = true; break
      case 'compressed': m.opts.compressed = true; break
      case 'max-time': m.opts.timeout = parseFloat(val) || null; break
      case 'connect-timeout': if (m.opts.timeout == null) m.opts.timeout = parseFloat(val) || null; break
      case 'proxy': m.opts.proxy = val; break
      case 'head': m.opts.head = true; break
      case 'get': m.opts.get = true; break
      case 'include': m.opts.include = true; break
      case 'upload-file': uploadFile = val; break
      case 'url': urls.push(val); break
      case 'oauth2-bearer': m.headers.push(['Authorization', `Bearer ${val}`]); break
      case 'range': m.headers.push(['Range', `bytes=${val}`]); break
      default:
        if (!NOOP.has(name)) m.warnings.push(`The option --${name} has no equivalent here and was ignored.`)
    }
  }
  for (; i < toks.length; i++) {
    const t = toks[i]
    if (t === '--') { urls.push(...toks.slice(i + 1)); break }
    if (t.startsWith('--')) {
      const eq = t.indexOf('=')
      const name = (eq > 0 ? t.slice(2, eq) : t.slice(2)).toLowerCase()
      if (LONG_ARG.has(name)) {
        let val
        if (eq > 0) val = t.slice(eq + 1)
        else { val = toks[++i]; if (val === undefined) throw new Error(`The option --${name} needs a value.`) }
        handle(name, val)
      } else {
        if (!KNOWN_BOOL.has(name)) m.warnings.push(`Unknown option --${name} was ignored.`)
        else handle(name, true)
      }
    } else if (t.length > 1 && t[0] === '-') {
      for (let j = 1; j < t.length; j++) {
        const ch = t[j]
        if (SHORT_ARG[ch]) {
          let val = t.slice(j + 1)
          if (!val) { val = toks[++i]; if (val === undefined) throw new Error(`The option -${ch} needs a value.`) }
          handle(SHORT_ARG[ch], val)
          break
        }
        if (SHORT_BOOL[ch]) handle(SHORT_BOOL[ch], true)
        else m.warnings.push(`Unknown option -${ch} was ignored.`)
      }
    } else urls.push(t)
  }
  const url = urls.find((u) => /^[a-z][a-z0-9+.-]*:\/\//i.test(u)) || urls.find((u) => /^[\w.-]+(:\d+)?(\/|$)/.test(u))
  if (!url) throw new Error('No URL found in the command. A curl command needs a URL such as https://api.example.com/items.')
  if (urls.filter((u) => /^[a-z][a-z0-9+.-]*:\/\//i.test(u)).length > 1) m.warnings.push('Several URLs were given; only the first one is used.')
  m.url = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`

  // body
  if (forms.length) {
    m.body = { kind: 'multipart', parts: forms.map(({ val, literal }) => {
      const eq = val.indexOf('=')
      if (eq < 0) return { name: val, value: '' }
      const name = val.slice(0, eq)
      let v = val.slice(eq + 1)
      if (!literal && v.startsWith('@') || (!literal && v.startsWith('<'))) {
        const [file, ...opts] = v.slice(1).split(';')
        const part = { name, file }
        for (const o of opts) { const [k, x] = o.split('='); if (k === 'type') part.type = x; if (k === 'filename') part.filename = x }
        return part
      }
      const [value, ...opts] = literal ? [v] : v.split(/;(?=type=|filename=)/)
      v = value
      const part = { name, value: v }
      for (const o of opts) { const [k, x] = o.split('='); if (k === 'type') part.type = x }
      return part
    }) }
  } else if (data.length) {
    const files = data.filter((d) => !d.raw && d.text.startsWith('@'))
    if (files.length && data.length === 1) m.body = { kind: 'file', path: files[0].text.slice(1) }
    else {
      const text = data.map((d) => d.text).join('&')
      m.body = { kind: 'text', text }
      if (files.length) m.warnings.push('Data read from a file (@file) was left as written in the body.')
    }
    if (jsonMode) { m.headers.push(['Content-Type', 'application/json']); if (!lowerHas(m.headers, 'accept')) m.headers.push(['Accept', 'application/json']) }
  } else if (uploadFile) m.body = { kind: 'file', path: uploadFile }
  if (m.body?.kind === 'text' && !lowerHas(m.headers, 'content-type')) m.headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
  if (m.body?.kind === 'text' && /^application\/x-www-form-urlencoded/i.test(lowerHas(m.headers, 'content-type')?.[1] || '') && /^[^{[]*=/.test(m.body.text) && !/\n/.test(m.body.text)) {
    m.body = { kind: 'urlencoded', fields: m.body.text.split('&').filter(Boolean).map((p) => { const e = p.indexOf('='); const dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')) } catch { return x } }; return e < 0 ? [dec(p), ''] : [dec(p.slice(0, e)), dec(p.slice(e + 1))] }) }
  }
  // method
  if (m.opts.head) m.method ||= 'HEAD'
  if (m.opts.get && m.body && (m.body.kind === 'text' || m.body.kind === 'urlencoded')) {
    const q = m.body.kind === 'text' ? m.body.text : m.body.fields.map(([k, v]) => `${encForm(k)}=${encForm(v)}`).join('&')
    m.url += (m.url.includes('?') ? '&' : '?') + q
    m.body = null
    m.headers = m.headers.filter(([k, v]) => !(k.toLowerCase() === 'content-type' && /x-www-form-urlencoded/i.test(v)))
    m.method ||= 'GET'
  }
  if (!m.method) m.method = uploadFile && !forms.length && !data.length ? 'PUT' : m.body ? 'POST' : 'GET'
  return m
}

// ---------- model -> curl ----------
export const shQuote = (s) => (s === '' ? "''" : /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)
export const cmdQuote = (s) => `"${s.replace(/(["\\])/g, '\\$1')}"`
const psQuote = (s) => `'${s.replace(/'/g, "''")}'`

/** Build a curl command line. shell: 'bash' | 'cmd' | 'powershell'. */
export function buildCurl(m, { shell = 'bash', multiline = true } = {}) {
  const q = shell === 'cmd' ? cmdQuote : shell === 'powershell' ? psQuote : shQuote
  const nl = shell === 'cmd' ? ' ^\n  ' : shell === 'powershell' ? ' `\n  ' : ' \\\n  '
  const parts = []
  const o = m.opts || {}
  const flags = []
  if (o.follow) flags.push('-L')
  if (o.insecure) flags.push('-k')
  if (o.silent) flags.push('-s')
  if (o.verbose) flags.push('-v')
  if (o.include) flags.push('-i')
  if (o.compressed) flags.push('--compressed')
  const head = shell === 'powershell' ? 'curl.exe' : 'curl'
  parts.push(`${head}${flags.length ? ' ' + flags.join(' ') : ''} ${q(m.url)}`)
  const methodNeeded = m.method === 'HEAD' ? false : !(m.method === 'GET' && !m.body) && !(m.method === 'POST' && m.body)
  if (m.method === 'HEAD') parts.push('-I')
  else if (methodNeeded) parts.push(`-X ${m.method}`)
  for (const [k, v] of m.headers) {
    if (m.body?.kind === 'multipart' && k.toLowerCase() === 'content-type') continue
    parts.push(`-H ${q(`${k}: ${v}`)}`)
  }
  if (m.auth) parts.push(`-u ${q(`${m.auth.user}:${m.auth.pass}`)}`)
  if (o.proxy) parts.push(`-x ${q(o.proxy)}`)
  if (o.timeout) parts.push(`--max-time ${o.timeout}`)
  const b = m.body
  if (b) {
    if (b.kind === 'text') parts.push(`--data-raw ${q(b.text)}`)
    else if (b.kind === 'urlencoded') {
      if (b.fields.every(([k, v]) => /^[\w.~-]*$/.test(k) && /^[\w.~-]*$/.test(v))) parts.push(`-d ${q(b.fields.map(([k, v]) => `${k}=${v}`).join('&'))}`)
      else for (const [k, v] of b.fields) parts.push(`--data-urlencode ${q(`${k}=${v}`)}`)
    }
    else if (b.kind === 'multipart') for (const p of b.parts) parts.push(p.file ? `-F ${q(`${p.name}=@${p.file}${p.type ? `;type=${p.type}` : ''}${p.filename ? `;filename=${p.filename}` : ''}`)}` : /^[@<]|;/.test(p.value) ? `--form-string ${q(`${p.name}=${p.value}`)}` : `-F ${q(`${p.name}=${p.value}`)}`)
    else if (b.kind === 'file') parts.push(`--data-binary ${q('@' + b.path)}`)
  }
  return multiline && parts.length > 2 ? parts.join(nl) : parts.join(' ')
}

// ---------- model -> code ----------
const ct = (m) => lowerHas(m.headers, 'content-type')?.[1] || ''
const jsonBody = (m) => {
  if (m.body?.kind !== 'text' || !/json/i.test(ct(m))) return undefined
  try { const v = JSON.parse(m.body.text); return typeof v === 'object' && v !== null ? { value: v } : undefined } catch { return undefined }
}
const indent = (s, n) => s.split('\n').map((l, i) => (i ? ' '.repeat(n) + l : l)).join('\n')
const jsStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}'`
const jsLit = (v, pad = 0) => {
  const sp = ' '.repeat(pad + 2)
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => sp + jsLit(x, pad + 2)).join(',\n')},\n${' '.repeat(pad)}]` : '[]'
  if (v && typeof v === 'object') { const e = Object.entries(v); return e.length ? `{\n${e.map(([k, x]) => `${sp}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : jsStr(k)}: ${jsLit(x, pad + 2)}`).join(',\n')},\n${' '.repeat(pad)}}` : '{}' }
  if (typeof v === 'string') return jsStr(v)
  return String(v)
}
const pyStr = (s) => JSON.stringify(s)
const pyLit = (v, pad = 0) => {
  const sp = ' '.repeat(pad + 4)
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => sp + pyLit(x, pad + 4)).join(',\n')},\n${' '.repeat(pad)}]` : '[]'
  if (v && typeof v === 'object') { const e = Object.entries(v); return e.length ? `{\n${e.map(([k, x]) => `${sp}${pyStr(k)}: ${pyLit(x, pad + 4)}`).join(',\n')},\n${' '.repeat(pad)}}` : '{}' }
  if (v === null) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'string') return pyStr(v)
  return String(v)
}
const phpStr = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const goStr = (s) => JSON.stringify(s)
const hdrs = (m) => m.headers.filter(([k]) => !(m.body?.kind === 'multipart' && k.toLowerCase() === 'content-type'))
const basicB64 = (a) => (typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(`${a.user}:${a.pass}`))) : Buffer.from(`${a.user}:${a.pass}`).toString('base64'))
const qs = (fields) => fields.map(([k, v]) => `${encForm(k)}=${encForm(v)}`).join('&')
const bodyText = (m) => (m.body?.kind === 'text' ? m.body.text : m.body?.kind === 'urlencoded' ? qs(m.body.fields) : '')
const tidy = (lines) => lines.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '')
const noteLines = (m, c = '//') => m.warnings.map((w) => `${c} Note: ${w}`).join('\n')

function genFetch(m) {
  const lines = []
  const usesFiles = m.body?.kind === 'file' || (m.body?.kind === 'multipart' && m.body.parts.some((p) => p.file))
  if (usesFiles) lines.push("import { openAsBlob } from 'node:fs'; // Node 20+. In a browser, take the File from an <input type=\"file\"> instead.", '')
  const h = hdrs(m)
  const H = h.map(([k, v]) => `    ${jsStr(k)}: ${jsStr(v)},`)
  if (m.auth) H.push(`    'Authorization': 'Basic ' + btoa(${jsStr(`${m.auth.user}:${m.auth.pass}`)}),`)
  const pre = []
  let body = ''
  const b = m.body
  const jb = jsonBody(m)
  if (b?.kind === 'multipart') {
    pre.push('const form = new FormData();')
    for (const p of b.parts) pre.push(p.file ? `form.append(${jsStr(p.name)}, await openAsBlob(${jsStr(p.file)}), ${jsStr(p.filename || p.file.split(/[\\/]/).pop())});` : `form.append(${jsStr(p.name)}, ${jsStr(p.value)});`)
    body = '    body: form,'
  } else if (jb) body = `    body: JSON.stringify(${jsLit(jb.value, 4)}),`
  else if (b?.kind === 'urlencoded') body = `    body: new URLSearchParams(${indent(jsLit(b.fields.reduce((o, [k, v]) => ((o[k] = v), o), {}), 4), 0)}),`
  else if (b?.kind === 'text') body = `    body: ${jsStr(b.text)},`
  else if (b?.kind === 'file') body = `    body: await openAsBlob(${jsStr(b.path)}),`
  if (b?.kind === 'urlencoded' && new Set(b.fields.map(([k]) => k)).size !== b.fields.length) body = `    body: ${jsStr(qs(b.fields))},`
  lines.push(...pre, '', `const response = await fetch(${jsStr(m.url)}, {`, `  method: ${jsStr(m.method)},`)
  if (H.length) lines.push('  headers: {', ...H, '  },')
  if (body) lines.push(body.replace(/^ {2}/, ''))
  lines.push(`  redirect: ${jsStr(m.opts.follow ? 'follow' : 'manual')},`)
  if (m.opts.timeout) lines.push(`  signal: AbortSignal.timeout(${Math.round(m.opts.timeout * 1000)}),`)
  lines.push('});', '', 'console.log(response.status, response.statusText);', 'console.log(await response.text());')
  const notes = [noteLines(m)]
  if (m.opts.insecure) notes.push("// Note: -k (skip TLS verification) has no fetch option. In Node, run with NODE_TLS_REJECT_UNAUTHORIZED=0 for testing only.")
  if (m.opts.proxy) notes.push('// Note: fetch has no proxy option; in Node use undici ProxyAgent or the HTTPS_PROXY environment variable.')
  if (m.opts.compressed) notes.push('// --compressed: fetch already asks for and decodes gzip/br automatically.')
  return tidy([...notes, ...lines])
}

function genAxios(m) {
  const h = hdrs(m).filter(([k]) => !(m.auth && k.toLowerCase() === 'authorization'))
  const jb = jsonBody(m)
  const o = []
  o.push(`  method: ${jsStr(m.method.toLowerCase())},`, `  url: ${jsStr(m.url)},`)
  if (h.length) o.push('  headers: {', ...h.map(([k, v]) => `    ${jsStr(k)}: ${jsStr(v)},`), '  },')
  if (m.auth) o.push(`  auth: { username: ${jsStr(m.auth.user)}, password: ${jsStr(m.auth.pass)} },`)
  const b = m.body
  if (jb) o.push(`  data: ${indent(jsLit(jb.value, 2), 0)},`)
  else if (b?.kind === 'urlencoded') o.push(`  data: new URLSearchParams(${jsStr(qs(b.fields))}),`)
  else if (b?.kind === 'text') { o.push(`  data: ${jsStr(b.text)},`); if (/json/i.test(ct(m))) o.push('  transformRequest: [(data) => data], // axios would JSON-encode a string again otherwise') }
  else if (b?.kind === 'multipart') o.push('  data: form,')
  else if (b?.kind === 'file') o.push(`  data: fs.createReadStream(${jsStr(b.path)}),`)
  o.push(`  maxRedirects: ${m.opts.follow ? 5 : 0},`)
  if (m.opts.timeout) o.push(`  timeout: ${Math.round(m.opts.timeout * 1000)},`)
  if (m.opts.insecure) o.push('  httpsAgent: new https.Agent({ rejectUnauthorized: false }),')
  o.push('  validateStatus: () => true,')
  const pre = ["import axios from 'axios';"]
  if (m.opts.insecure) pre.push("import https from 'node:https';")
  if (b?.kind === 'file') pre.push("import fs from 'node:fs';")
  if (b?.kind === 'multipart') {
    pre.push('', 'const form = new FormData();')
    for (const p of b.parts) pre.push(p.file ? `form.append(${jsStr(p.name)}, await openAsBlob(${jsStr(p.file)}), ${jsStr(p.filename || p.file.split(/[\\/]/).pop())});` : `form.append(${jsStr(p.name)}, ${jsStr(p.value)});`)
    if (b.parts.some((p) => p.file)) pre.unshift("import { openAsBlob } from 'node:fs'; // Node 20+")
  }
  return tidy([noteLines(m), ...pre, '', 'const response = await axios({', ...o, '});', '', 'console.log(response.status, response.statusText);', 'console.log(response.data);'])
}

function genNode(m) {
  const u = new URL(m.url)
  const h = hdrs(m)
  const b = m.body
  const out = [noteLines(m), `import ${u.protocol === 'https:' ? 'https' : 'http'} from 'node:${u.protocol === 'https:' ? 'https' : 'http'}';`]
  if (b?.kind === 'file') out.push("import fs from 'node:fs';")
  const payload = b?.kind === 'text' ? b.text : b?.kind === 'urlencoded' ? qs(b.fields) : null
  out.push('')
  const hd = [...h].map(([k, v]) => `    ${jsStr(k)}: ${jsStr(v)},`)
  if (m.auth) hd.push(`    'Authorization': ${jsStr(`Basic ${basicB64(m.auth)}`)},`)
  if (b?.kind === 'multipart') {
    if (b.parts.some((p) => p.file)) out.splice(1, 0, "import fs from 'node:fs';")
    out.push("const boundary = '----curl' + Math.random().toString(16).slice(2);", 'const chunks = [];')
    for (const p of b.parts) {
      if (p.file) out.push(`chunks.push(Buffer.from(\`--\${boundary}\\r\\nContent-Disposition: form-data; name=${JSON.stringify(p.name).replace(/`/g, '\\`')}; filename=${JSON.stringify(p.filename || p.file.split(/[\\/]/).pop())}\\r\\nContent-Type: ${p.type || 'application/octet-stream'}\\r\\n\\r\\n\`), fs.readFileSync(${jsStr(p.file)}), Buffer.from('\\r\\n'));`)
      else out.push(`chunks.push(Buffer.from(\`--\${boundary}\\r\\nContent-Disposition: form-data; name=${JSON.stringify(p.name).replace(/`/g, '\\`')}\\r\\n\\r\\n\` + ${jsStr(p.value)} + '\\r\\n'));`)
    }
    out.push("chunks.push(Buffer.from(`--${boundary}--\\r\\n`));", 'const payload = Buffer.concat(chunks);', '')
    hd.push('    \'Content-Type\': `multipart/form-data; boundary=${boundary}`,', '    \'Content-Length\': payload.length,')
  }
  if (payload != null) hd.push(`    'Content-Length': ${new TextEncoder().encode(payload).length},`)
  out.push('const options = {', `  method: ${jsStr(m.method)},`, `  hostname: ${jsStr(u.hostname)},`)
  if (u.port) out.push(`  port: ${u.port},`)
  out.push(`  path: ${jsStr(u.pathname + u.search)},`)
  if (hd.length) out.push('  headers: {', ...hd, '  },')
  if (m.opts.insecure) out.push('  rejectUnauthorized: false,')
  if (m.opts.timeout) out.push(`  timeout: ${Math.round(m.opts.timeout * 1000)},`)
  out.push('};', '', `const req = ${u.protocol === 'https:' ? 'https' : 'http'}.request(options, (res) => {`, '  const chunks = [];', "  res.on('data', (c) => chunks.push(c));", "  res.on('end', () => {", '    console.log(res.statusCode, res.statusMessage);', "    console.log(Buffer.concat(chunks).toString('utf8'));", '  });', '});', '', "req.on('error', (err) => console.error(err));")
  if (payload != null) out.push(`req.write(${jsStr(payload)});`)
  if (b?.kind === 'multipart') out.push('req.write(payload);')
  if (b?.kind === 'file') out.push(`fs.createReadStream(${jsStr(b.path)}).pipe(req);`)
  else out.push('req.end();')
  return tidy(out)
}

function genPython(m) {
  const h = hdrs(m).filter(([k]) => !(m.auth && k.toLowerCase() === 'authorization'))
  const b = m.body
  const jb = jsonBody(m)
  const hh = h.filter(([k]) => !(jb && k.toLowerCase() === 'content-type') && !(b?.kind === 'urlencoded' && k.toLowerCase() === 'content-type'))
  const out = [noteLines(m, '#'), 'import requests', '']
  const args = [`${pyStr(m.url)}`]
  if (hh.length) { out.push(`headers = {\n${hh.map(([k, v]) => `    ${pyStr(k)}: ${pyStr(v)},`).join('\n')}\n}`, ''); args.push('headers=headers') }
  if (jb) { out.push(`payload = ${pyLit(jb.value)}`, ''); args.push('json=payload') }
  else if (b?.kind === 'urlencoded') {
    const dup = new Set(b.fields.map(([k]) => k)).size !== b.fields.length
    out.push(dup ? `payload = [\n${b.fields.map(([k, v]) => `    (${pyStr(k)}, ${pyStr(v)}),`).join('\n')}\n]` : `payload = {\n${b.fields.map(([k, v]) => `    ${pyStr(k)}: ${pyStr(v)},`).join('\n')}\n}`, '')
    args.push('data=payload')
  } else if (b?.kind === 'text') { out.push(`payload = ${pyStr(b.text)}`, ''); args.push('data=payload.encode("utf-8")') }
  else if (b?.kind === 'multipart') {
    const fields = b.parts.map((p) => (p.file ? `    ${pyStr(p.name)}: (${pyStr(p.filename || p.file.split(/[\\/]/).pop())}, open(${pyStr(p.file)}, 'rb'${p.type ? `), ${pyStr(p.type)}` : ')'}),` : `    ${pyStr(p.name)}: (None, ${pyStr(p.value)}),`))
    out.push(`files = {\n${fields.join('\n')}\n}`, ''); args.push('files=files')
  } else if (b?.kind === 'file') { out.push(`with open(${pyStr(b.path)}, 'rb') as f:\n    payload = f.read()`, ''); args.push('data=payload') }
  if (m.auth) args.push(`auth=(${pyStr(m.auth.user)}, ${pyStr(m.auth.pass)})`)
  args.push(`allow_redirects=${m.opts.follow ? 'True' : 'False'}`)
  if (m.opts.timeout) args.push(`timeout=${m.opts.timeout}`)
  if (m.opts.insecure) args.push('verify=False')
  if (m.opts.proxy) args.push(`proxies={'http': ${pyStr(m.opts.proxy)}, 'https': ${pyStr(m.opts.proxy)}}`)
  out.push(`response = requests.request(${pyStr(m.method)}, ${args.join(', ')})`, '', 'print(response.status_code, response.reason)', 'print(response.text)')
  return tidy(out)
}

function genPhp(m) {
  const h = hdrs(m)
  const b = m.body
  const o = ['<?php', ...(m.warnings.length ? [noteLines(m)] : []), '$ch = curl_init();', '', 'curl_setopt_array($ch, [', `    CURLOPT_URL => ${phpStr(m.url)},`, '    CURLOPT_RETURNTRANSFER => true,']
  o.push(m.method === 'HEAD' ? '    CURLOPT_NOBODY => true,' : `    CURLOPT_CUSTOMREQUEST => ${phpStr(m.method)},`)
  const H = h.map(([k, v]) => `${k}: ${v}`)
  if (H.length) o.push('    CURLOPT_HTTPHEADER => [', ...H.map((x) => `        ${phpStr(x)},`), '    ],')
  if (m.auth) o.push(`    CURLOPT_USERPWD => ${phpStr(`${m.auth.user}:${m.auth.pass}`)},`)
  if (b?.kind === 'text') o.push(`    CURLOPT_POSTFIELDS => ${phpStr(b.text)},`)
  else if (b?.kind === 'urlencoded') o.push(`    CURLOPT_POSTFIELDS => ${phpStr(qs(b.fields))},`)
  else if (b?.kind === 'multipart') o.push('    CURLOPT_POSTFIELDS => [', ...b.parts.map((p) => `        ${phpStr(p.name)} => ${p.file ? `new CURLFile(${phpStr(p.file)}${p.type ? `, ${phpStr(p.type)}` : ''}${p.filename ? `, ${phpStr(p.filename)}` : ''})` : phpStr(p.value)},`), '    ],')
  else if (b?.kind === 'file') o.push(`    CURLOPT_POSTFIELDS => file_get_contents(${phpStr(b.path)}),`)
  o.push(`    CURLOPT_FOLLOWLOCATION => ${m.opts.follow ? 'true' : 'false'},`)
  if (m.opts.timeout) o.push(`    CURLOPT_TIMEOUT => ${m.opts.timeout},`)
  if (m.opts.insecure) o.push('    CURLOPT_SSL_VERIFYPEER => false,', '    CURLOPT_SSL_VERIFYHOST => 0,')
  if (m.opts.compressed) o.push("    CURLOPT_ENCODING => '',")
  if (m.opts.proxy) o.push(`    CURLOPT_PROXY => ${phpStr(m.opts.proxy)},`)
  o.push(']);', '', '$response = curl_exec($ch);', 'if ($response === false) {', "    echo 'Error: ' . curl_error($ch) . PHP_EOL;", '} else {', '    echo curl_getinfo($ch, CURLINFO_HTTP_CODE) . PHP_EOL;', '    echo $response . PHP_EOL;', '}', 'curl_close($ch);')
  return tidy(o)
}

function genGo(m) {
  const b = m.body
  const imports = ['"fmt"', '"io"', '"net/http"']
  const pre = []
  let bodyArg = 'nil'
  if (b?.kind === 'text' || b?.kind === 'urlencoded') { imports.push('"strings"'); bodyArg = `strings.NewReader(${goStr(bodyText(m))})` }
  else if (b?.kind === 'file') { imports.push('"os"'); pre.push(`\tf, err := os.Open(${goStr(b.path)})`, '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer f.Close()', ''); bodyArg = 'f' }
  else if (b?.kind === 'multipart') { imports.push('"bytes"', '"mime/multipart"'); pre.push('\tvar buf bytes.Buffer', '\tw := multipart.NewWriter(&buf)', ...b.parts.flatMap((p) => (p.file ? [`\t// TODO: add file ${goStr(p.file)} with w.CreateFormFile(${goStr(p.name)}, ${goStr(p.filename || p.file.split(/[\\/]/).pop())}) and io.Copy`] : [`\tw.WriteField(${goStr(p.name)}, ${goStr(p.value)})`])), '\tw.Close()', ''); bodyArg = '&buf' }
  if (m.opts.insecure) imports.push('"crypto/tls"')
  if (m.opts.timeout) imports.push('"time"')
  const sorted = [...new Set(imports)].sort()
  const out = [noteLines(m), 'package main', '', 'import (', ...sorted.map((i) => `\t${i}`), ')', '', 'func main() {', ...pre]
  const client = []
  if (!m.opts.follow) client.push('\t\tCheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },')
  if (m.opts.timeout) client.push(`\t\tTimeout: ${Math.round(m.opts.timeout * 1000)} * time.Millisecond,`)
  if (m.opts.insecure) client.push('\t\tTransport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}},')
  out.push(client.length ? `\tclient := &http.Client{\n${client.join('\n')}\n\t}` : '\tclient := &http.Client{}', `\treq, err := http.NewRequest(${goStr(m.method)}, ${goStr(m.url)}, ${bodyArg})`, '\tif err != nil {', '\t\tpanic(err)', '\t}')
  for (const [k, v] of hdrs(m)) out.push(`\treq.Header.Set(${goStr(k)}, ${goStr(v)})`)
  if (b?.kind === 'multipart') out.push('\treq.Header.Set("Content-Type", w.FormDataContentType())')
  if (m.auth) out.push(`\treq.SetBasicAuth(${goStr(m.auth.user)}, ${goStr(m.auth.pass)})`)
  out.push('', '\tres, err := client.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer res.Body.Close()', '', '\tbody, _ := io.ReadAll(res.Body)', '\tfmt.Println(res.Status)', '\tfmt.Println(string(body))', '}')
  return tidy(out)
}

function genPowerShell(m) {
  const b = m.body
  const out = [noteLines(m, '#')]
  const h = hdrs(m)
  const cookie = h.find(([k]) => k.toLowerCase() === 'cookie')
  const rest = h.filter(([k]) => k.toLowerCase() !== 'cookie')
  const auth = m.auth ? `Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${psQuote(`${m.auth.user}:${m.auth.pass}`)}))` : null
  if (b?.kind === 'multipart') {
    out.push('Add-Type -AssemblyName System.Net.Http', `$uri = ${psQuote(m.url)}`, '$content = New-Object System.Net.Http.MultipartFormDataContent')
    for (const p of b.parts) out.push(p.file ? `$content.Add((New-Object System.Net.Http.StreamContent([IO.File]::OpenRead(${psQuote(p.file)}))), ${psQuote(p.name)}, ${psQuote(p.filename || p.file.split(/[\\/]/).pop())})` : `$content.Add((New-Object System.Net.Http.StringContent(${psQuote(p.value)})), ${psQuote(p.name)})`)
    out.push(`$request = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::new(${psQuote(m.method)}), $uri)`, '$request.Content = $content')
    for (const [k, v] of rest) out.push(`[void]$request.Headers.TryAddWithoutValidation(${psQuote(k)}, ${psQuote(v)})`)
    if (cookie) out.push(`[void]$request.Headers.TryAddWithoutValidation('Cookie', ${psQuote(cookie[1])})`)
    if (auth) out.push(`[void]$request.Headers.TryAddWithoutValidation('Authorization', 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${psQuote(`${m.auth.user}:${m.auth.pass}`)})))`)
    const hnd = m.opts.follow ? '' : 'New-Object System.Net.Http.HttpClientHandler -Property @{ AllowAutoRedirect = $false }'
    out.push(hnd ? `$client = New-Object System.Net.Http.HttpClient (${hnd})` : '$client = New-Object System.Net.Http.HttpClient', '$response = $client.SendAsync($request).GetAwaiter().GetResult()', '[int]$response.StatusCode', '$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()')
    return tidy(out)
  }
  const H = rest.map(([k, v]) => `    ${psQuote(k)} = ${psQuote(v)}`)
  if (auth) H.push(`    'Authorization' = '${auth}`)
  if (H.length) out.push(`$headers = @{\n${H.join('\n')}\n}`, '')
  const args = [`-Uri ${psQuote(m.url)}`, `-Method ${m.method}`]
  if (H.length) args.push('-Headers $headers')
  if (cookie) {
    out.push('$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession', `$uri = [Uri]${psQuote(m.url)}`)
    for (const pair of cookie[1].split(/;\s*/).filter(Boolean)) { const e = pair.indexOf('='); out.push(`$session.Cookies.Add($uri, (New-Object System.Net.Cookie(${psQuote(pair.slice(0, e))}, ${psQuote(pair.slice(e + 1))})))`) }
    out.push('')
    args.push('-WebSession $session')
  }
  if (b?.kind === 'text') { out.push(`$body = ${psQuote(b.text)}`, ''); args.push('-Body ([Text.Encoding]::UTF8.GetBytes($body))') }
  else if (b?.kind === 'urlencoded') { out.push(`$body = ${psQuote(qs(b.fields))}`, ''); args.push('-Body $body') }
  else if (b?.kind === 'file') args.push(`-InFile ${psQuote(b.path)}`)
  if (!m.opts.follow) args.push('-MaximumRedirection 0')
  if (m.opts.insecure) args.push('-SkipCertificateCheck') // PowerShell 7+
  if (m.opts.timeout) args.push(`-TimeoutSec ${Math.ceil(m.opts.timeout)}`)
  if (m.opts.proxy) args.push(`-Proxy ${psQuote(m.opts.proxy)}`)
  out.push(`$response = Invoke-WebRequest ${args.join(' ')} -UseBasicParsing`, '', '$response.StatusCode', '$response.Content')
  return tidy(out)
}

export const TARGETS = [
  ['fetch', 'JavaScript fetch', genFetch], ['axios', 'JavaScript axios', genAxios], ['node', 'Node.js https', genNode],
  ['python', 'Python requests', genPython], ['php', 'PHP cURL', genPhp], ['go', 'Go net/http', genGo], ['powershell', 'PowerShell', genPowerShell],
]
export const generate = (m, target) => TARGETS.find(([id]) => id === target)[2](m)
export { psQuote, lowerHas }
