// MIME (RFC 822 / 2045-2047 / 2231) parsing and building for .eml and .mhtml: folded headers, encoded words, quoted-printable, base64, multipart
// trees, charsets through TextDecoder, inline (cid:) resources and attachments with their real file names.
import { concat, utf8, bytesToBase64, base64ToBytes, fail } from './_util.js'

const CHARSET_ALIAS = { cp949: 'euc-kr', 'ks_c_5601': 'euc-kr', uhc: 'euc-kr', cp932: 'shift_jis', sjis: 'shift_jis', 'x-sjis': 'shift_jis', cp936: 'gbk', cp950: 'big5', cp1252: 'windows-1252', cp1251: 'windows-1251', cp1250: 'windows-1250', utf8: 'utf-8', 'unicode-1-1-utf-7': 'utf-8', 'iso-2022-kr': 'euc-kr', 'x-unknown': 'windows-1252', unknown: 'windows-1252', 'us-ascii': 'windows-1252', ascii: 'windows-1252' }
export function decodeCharset(bytes, charset) {
  let cs = String(charset || 'utf-8').trim().toLowerCase().replace(/^"|"$/g, '')
  cs = CHARSET_ALIAS[cs] || cs
  try { return new TextDecoder(cs).decode(bytes) } catch { /* unknown label */ }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return new TextDecoder('windows-1252').decode(bytes) }
}

const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s }
const fromLatin1 = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b }

export function decodeQuotedPrintable(bytes, headerMode = false) {
  const out = []
  const n = bytes.length
  for (let i = 0; i < n; i++) {
    const c = bytes[i]
    if (c === 0x3d) {
      const a = bytes[i + 1], b = bytes[i + 2]
      if (a === 0x0d && b === 0x0a) { i += 2; continue }
      if (a === 0x0a) { i += 1; continue }
      const h = (x) => (x >= 0x30 && x <= 0x39 ? x - 0x30 : x >= 0x41 && x <= 0x46 ? x - 0x37 : x >= 0x61 && x <= 0x66 ? x - 0x57 : -1)
      if (h(a) >= 0 && h(b) >= 0) { out.push(h(a) * 16 + h(b)); i += 2; continue }
      out.push(c)
    } else if (headerMode && c === 0x5f) out.push(0x20)
    else out.push(c)
  }
  return Uint8Array.from(out)
}
export function decodeBase64Loose(bytes) {
  const s = latin1(bytes).replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const clean = s.replace(/=+$/, '')
  try { return base64ToBytes(clean + '='.repeat((4 - (clean.length % 4)) % 4)) } catch { return new Uint8Array(0) }
}

/** RFC 2047 encoded words in a header value. */
export function decodeWords(s) {
  if (!s || !s.includes('=?')) return s || ''
  let out = ''
  let last = 0
  const re = /=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g
  let prevEnc = false
  let m
  while ((m = re.exec(s))) {
    const gap = s.slice(last, m.index)
    if (!(prevEnc && /^\s*$/.test(gap))) out += gap
    const cs = m[1].replace(/\*[\w-]+$/, '')
    const data = m[2].toLowerCase() === 'b' ? decodeBase64Loose(utf8(m[3])) : decodeQuotedPrintable(utf8(m[3]), true)
    out += decodeCharset(data, cs)
    last = m.index + m[0].length
    prevEnc = true
  }
  return out + s.slice(last)
}

/** "text/html; charset=utf-8; name*0=..." -> {value, params}. Handles RFC 2231 continuations and charset'lang'value. */
export function parseParams(s) {
  s = s || ''
  const params = {}
  const parts = []
  let cur = '', q = false
  for (const ch of s) {
    if (ch === '"') q = !q
    if (ch === ';' && !q) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  const value = (parts.shift() || '').trim().toLowerCase()
  const cont = {}
  for (const p of parts) {
    const i = p.indexOf('=')
    if (i < 0) continue
    let k = p.slice(0, i).trim().toLowerCase()
    let v = p.slice(i + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, '$1')
    const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(k)
    if (m && (m[2] !== undefined || m[3])) {
      const base = m[1]
      ;(cont[base] ||= []).push({ idx: +(m[2] || 0), enc: !!m[3], v })
    } else params[k] = decodeWords(v)
  }
  for (const [base, list] of Object.entries(cont)) {
    list.sort((a, b) => a.idx - b.idx)
    let charset = null, text = ''
    list.forEach((item, i) => {
      let v = item.v
      if (item.enc) {
        if (i === 0) { const m = /^([^']*)'[^']*'(.*)$/.exec(v); if (m) { charset = m[1] || 'utf-8'; v = m[2] } }
        text += v
      } else text += v
    })
    if (list.some((x) => x.enc)) {
      const bytes = decodeQuotedPrintable(utf8(text.replace(/%([0-9a-fA-F]{2})/g, '=$1')))
      params[base] = decodeCharset(bytes, charset || 'utf-8')
    } else params[base] = text
  }
  return { value, params }
}

/** Parse one MIME entity. -> {headers: {name: [values]}, header(name), ctype, params, disp, dispParams, cte, body: Uint8Array (decoded), raw, parts: []} */
export function parseMime(bytes, depth = 0) {
  if (depth > 20) throw fail('This message is nested too deeply.')
  // split header / body
  let i = 0
  const n = bytes.length
  let hEnd = -1, bStart = n
  // a leading blank line means no headers
  if (bytes[0] === 0x0a || (bytes[0] === 0x0d && bytes[1] === 0x0a)) { hEnd = 0; bStart = bytes[0] === 0x0a ? 1 : 2 }
  else {
    for (i = 0; i < n - 1; i++) {
      if (bytes[i] === 0x0a && (bytes[i + 1] === 0x0a || (bytes[i + 1] === 0x0d && bytes[i + 2] === 0x0a))) { hEnd = i; bStart = i + (bytes[i + 1] === 0x0a ? 2 : 3); break }
    }
  }
  if (hEnd < 0) { hEnd = n; bStart = n }
  let headText
  const hb = bytes.subarray(0, hEnd)
  try { headText = new TextDecoder('utf-8', { fatal: true }).decode(hb) } catch { headText = new TextDecoder('windows-1252').decode(hb) }
  headText = headText.replace(/\r?\n[ \t]+/g, ' ').replace(/\r+$/, '')
  const headers = {}
  for (const line of headText.split(/\r?\n/)) {
    const m = /^([^:\s]+):\s*(.*)$/.exec(line)
    if (m) (headers[m[1].toLowerCase()] ||= []).push(m[2].trim())
  }
  const header = (k) => headers[k.toLowerCase()]?.[0] ?? ''
  const ct = parseParams(header('content-type') || 'text/plain')
  const disp = parseParams(header('content-disposition'))
  const cte = header('content-transfer-encoding').trim().toLowerCase()
  const raw = bytes.subarray(bStart)
  let body = raw
  const node = { headers, header, ctype: ct.value || 'text/plain', params: ct.params, disp: disp.value, dispParams: disp.params, cte, raw, parts: [] }
  if (ct.value.startsWith('multipart/') && ct.params.boundary) {
    node.parts = splitMultipart(raw, ct.params.boundary).map((p) => parseMime(p, depth + 1))
    node.body = new Uint8Array(0)
    return node
  }
  if (cte === 'base64') body = decodeBase64Loose(raw)
  else if (cte === 'quoted-printable') body = decodeQuotedPrintable(raw)
  node.body = body
  if (ct.value === 'message/rfc822' || ct.value === 'message/global') node.message = parseMime(body, depth + 1)
  return node
}

function splitMultipart(raw, boundary) {
  const s = latin1(raw)
  const marker = '--' + boundary
  const parts = []
  let pos = s.indexOf(marker)
  while (pos >= 0) {
    let lineEnd = s.indexOf('\n', pos)
    if (lineEnd < 0) break
    const after = s.slice(pos + marker.length, pos + marker.length + 2)
    if (after === '--') break
    const start = lineEnd + 1
    const next = s.indexOf('\n' + marker, start - 1)
    if (next < 0) { parts.push(fromLatin1(s.slice(start))); break }
    let end = next
    if (s[end - 1] === '\r') end--
    parts.push(fromLatin1(s.slice(start, Math.max(start, end))))
    pos = next + 1
  }
  return parts
}

export const textOf = (node) => decodeCharset(node.body, node.params.charset)

const extFor = (type) => ({ 'text/plain': 'txt', 'text/html': 'html', 'text/calendar': 'ics', 'text/css': 'css', 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'message/rfc822': 'eml', 'application/zip': 'zip', 'application/msword': 'doc' }[type] || 'bin')

/**
 * Walk a parsed message and pull out what a reader needs.
 * -> {headers: {from, to, cc, bcc, replyTo, subject, date, messageId}, text, html, attachments: [{name, type, bytes, cid, inline}]}
 */
export function extractMessage(root) {
  const attachments = []
  const textParts = [], htmlParts = []
  let attN = 0
  const nameOf = (node, type) => {
    const n = node.dispParams.filename || node.params.name
    if (n) return n.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    attN++
    return `attachment-${attN}.${extFor(type)}`
  }
  function addAttachment(node) {
    const type = node.ctype
    const cid = node.header('content-id').replace(/^<|>$/g, '')
    const bytes = node.message ? node.body : node.body
    attachments.push({ name: node.message && !(node.dispParams.filename || node.params.name) ? `${decodeWords(node.message.header('subject')).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'message'}.eml` : nameOf(node, type), type, bytes, cid: cid || null, inline: node.disp === 'inline' && !!cid, location: node.header('content-location') || null })
  }
  function walk(node) {
    if (node.ctype.startsWith('multipart/')) {
      if (node.ctype === 'multipart/alternative') {
        // keep the richest alternative; resources still come through the other branches
        const saveT = textParts.length, saveH = htmlParts.length
        for (const c of node.parts) walk(c)
        void saveT; void saveH
        return
      }
      for (const c of node.parts) walk(c)
      return
    }
    const isAttachment = node.disp === 'attachment' || node.dispParams.filename || (node.params.name && !/^text\/(plain|html)$/.test(node.ctype))
    if (!isAttachment && node.ctype === 'text/plain') { textParts.push(textOf(node)); return }
    if (!isAttachment && node.ctype === 'text/html') { htmlParts.push(textOf(node)); return }
    if (node.ctype === 'message/rfc822' && node.message && !isAttachment) { addAttachment(node); return }
    if (node.ctype.startsWith('text/') && !isAttachment && node.ctype !== 'text/calendar') { textParts.push(textOf(node)); return }
    addAttachment(node)
  }
  walk(root)
  const h = (k) => decodeWords(root.header(k))
  return {
    headers: { from: h('from'), to: h('to'), cc: h('cc'), bcc: h('bcc'), replyTo: h('reply-to'), subject: h('subject'), date: root.header('date'), messageId: root.header('message-id') },
    text: textParts.join('\n\n'), html: htmlParts.length ? htmlParts.join('\n') : null, attachments,
  }
}

// ------------------------------------------------------------------ building (.eml)
const b64Lines = (bytes) => bytesToBase64(bytes).replace(/(.{76})/g, '$1\r\n')
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${bytesToBase64(utf8(s))}?=`)
/** Encode an address list so non-ASCII display names survive: "Name <a@b>, ..." */
const encAddrs = (s) => String(s || '').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((p) => {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(p)
  if (!m) return p.trim()
  const name = m[1].replace(/^"|"$/g, '')
  return name ? `${/^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/"/g, '')}"` : encWord(name)} <${m[2]}>` : `<${m[2]}>`
}).filter(Boolean).join(', ')

/** Build an RFC 5322 message from {headers, text, html, attachments}. -> Uint8Array */
export function buildEml({ headers, text = '', html = null, attachments = [] }) {
  const id = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
  const CRLF = '\r\n'
  const part = (head, body) => head.join(CRLF) + CRLF + CRLF + body
  const textPart = (type, content) => part([`Content-Type: ${type}; charset="utf-8"`, 'Content-Transfer-Encoding: base64'], b64Lines(utf8(content)))
  const inlineAtts = attachments.filter((a) => a.inline && a.cid)
  const fileAtts = attachments.filter((a) => !(a.inline && a.cid))
  let bodyNode
  const hasText = text && text.trim()
  if (html) {
    const bAlt = 'alt_' + id()
    let htmlNode = textPart('text/html', html)
    if (inlineAtts.length) {
      const bRel = 'rel_' + id()
      htmlNode = part([`Content-Type: multipart/related; boundary="${bRel}"`], [`--${bRel}${CRLF}${htmlNode}`, ...inlineAtts.map((a) => `--${bRel}${CRLF}${part([`Content-Type: ${a.type}; name="${encWord(a.name)}"`, 'Content-Transfer-Encoding: base64', `Content-ID: <${a.cid}>`, `Content-Disposition: inline; filename="${encWord(a.name)}"`], b64Lines(a.bytes))}`)].join(CRLF) + `${CRLF}--${bRel}--`)
    }
    bodyNode = hasText ? part([`Content-Type: multipart/alternative; boundary="${bAlt}"`], `--${bAlt}${CRLF}${textPart('text/plain', text)}${CRLF}--${bAlt}${CRLF}${htmlNode}${CRLF}--${bAlt}--`) : htmlNode
  } else bodyNode = textPart('text/plain', text || '')
  const head = []
  const add = (k, v) => { if (v) head.push(`${k}: ${v}`) }
  add('From', encAddrs(headers.from))
  add('To', encAddrs(headers.to))
  add('Cc', encAddrs(headers.cc))
  add('Bcc', encAddrs(headers.bcc))
  add('Reply-To', encAddrs(headers.replyTo))
  add('Subject', encWord(headers.subject || ''))
  const d = headers.date ? new Date(headers.date) : null
  add('Date', d && !Number.isNaN(d.getTime()) ? d.toUTCString().replace('GMT', '+0000') : headers.date)
  add('Message-ID', headers.messageId || `<${id()}@converted.local>`)
  head.push('MIME-Version: 1.0')
  let out
  if (fileAtts.length) {
    const bMix = 'mix_' + id()
    const bodyHead = bodyNode.split(CRLF + CRLF)[0]
    void bodyHead
    out = head.join(CRLF) + CRLF + `Content-Type: multipart/mixed; boundary="${bMix}"` + CRLF + CRLF + `--${bMix}${CRLF}${bodyNode}${CRLF}` + fileAtts.map((a) => `--${bMix}${CRLF}${part([`Content-Type: ${a.type || 'application/octet-stream'}; name="${encWord(a.name)}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${encWord(a.name)}"`], b64Lines(a.bytes))}${CRLF}`).join('') + `--${bMix}--${CRLF}`
  } else out = head.join(CRLF) + CRLF + bodyNode + CRLF
  return utf8(out)
}
void concat
