// E-mail conversions: parsed message -> HTML / text, Outlook .msg (compound file) reader, and MHTML (saved web page) -> self-contained HTML.
import { xlsx, dompurify } from '../../lib/libs.js'
import { esc, fail, dataUrl, utf8, concat, parseHtml, formatSize, mimeFor, sniffImage } from './_util.js'
import { parseMime, extractMessage, decodeCharset, decodeWords, textOf, buildEml } from './_mime.js'
import { DOC_CSS, wrapDoc } from './_html.js'
import { decodeCodepage } from './_rtf.js'

export { formatSize }

// ------------------------------------------------------------------ eml
export function parseEml(bytes) {
  const root = parseMime(bytes)
  if (!root.headers.from && !root.headers.subject && !root.headers['content-type'] && !root.headers.date) throw fail('This does not look like an e-mail (.eml) file: no message headers were found.')
  return extractMessage(root)
}

const linkify = (escaped) => escaped.replace(/\b(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g, '<a href="$1">$1</a>')

const CSS = `${DOC_CSS}
.mail-head { border-bottom: 1px solid #d5d5de; margin-bottom: 1.2em; padding-bottom: .8em; } .mail-head h1 { font-size: 1.45em; margin: 0 0 .5em; }
.mail-head table { border-collapse: collapse; margin: 0; } .mail-head td { border: 0; padding: .1em .7em .1em 0; vertical-align: top; } .mail-head td:first-child { color: #6a6a76; white-space: nowrap; }
.mail-att { margin: .8em 0 0; font-size: .92em; } .mail-att span { display: inline-block; border: 1px solid #d5d5de; border-radius: 6px; padding: .15em .55em; margin: .15em .3em .15em 0; background: #f6f6f9; }
.mail-body pre.plain { font: inherit; white-space: pre-wrap; background: none; padding: 0; margin: 0; }
`

/** Sanitize and prepare an HTML e-mail body: cid: pictures become data URLs, remote content is blocked unless allowed, scripts and forms removed. */
export async function cleanEmailHtml(html, attachments, { remoteImages = false } = {}) {
  const purify = await dompurify()
  const doc = parseHtml(html)
  const byCid = new Map(attachments.filter((a) => a.cid).map((a) => [a.cid.toLowerCase(), a]))
  const byLoc = new Map(attachments.filter((a) => a.location).map((a) => [a.location, a]))
  const toData = (a) => dataUrl(a.bytes, /^image\//.test(a.type) ? a.type : sniffImage(a.bytes) || a.type)
  const resolve = (src) => {
    if (!src) return null
    const m = /^cid:(.+)$/i.exec(src.trim())
    if (m) { const a = byCid.get(decodeURIComponent(m[1]).replace(/^<|>$/g, '').toLowerCase()); return a ? toData(a) : null }
    if (byLoc.has(src)) return toData(byLoc.get(src))
    return undefined
  }
  const blockedRemote = []
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src') || ''
    const r = resolve(src)
    if (r) img.setAttribute('src', r)
    else if (/^https?:|^\/\//i.test(src)) {
      if (!remoteImages) { img.removeAttribute('src'); img.removeAttribute('srcset'); blockedRemote.push(src); if (!img.getAttribute('alt')) img.setAttribute('alt', '[remote image not loaded]') }
    } else if (!/^data:/i.test(src)) img.removeAttribute('src')
    img.removeAttribute('srcset')
  }
  for (const el of doc.querySelectorAll('[background]')) { const r = resolve(el.getAttribute('background')); if (r) el.setAttribute('style', `${el.getAttribute('style') || ''};background-image:url(${r})`); el.removeAttribute('background') }
  const fixCss = (css) => css.replace(/@import[^;]+;?/gi, '').replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, u) => { const r = resolve(u); return r ? `url(${r})` : /^data:/i.test(u) ? m : remoteImages ? m : 'none' })
  for (const st of doc.querySelectorAll('style')) st.textContent = fixCss(st.textContent)
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', fixCss(el.getAttribute('style')))
  const clean = purify.sanitize(doc.documentElement.outerHTML, { WHOLE_DOCUMENT: false, FORBID_TAGS: ['form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'script', 'video', 'audio', 'source'], FORBID_ATTR: ['srcset', 'ping'], ADD_TAGS: ['style'], ALLOW_DATA_ATTR: false, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|data:image\/|#)/i })
  return { html: clean, blockedRemote }
}

/** Parsed message -> standalone HTML. attachments in the page: listed, and downloadable (as data links) when `embedAttachments` is on and they are small enough. */
export async function emailToHtml(msg, { remoteImages = false, embedAttachments = true, title } = {}) {
  const h = msg.headers
  let body
  let blocked = []
  if (msg.html) {
    const r = await cleanEmailHtml(msg.html, msg.attachments, { remoteImages })
    body = r.html
    blocked = r.blockedRemote
    // the sanitized document comes back wrapped in <html><body>; keep only the body content plus style elements
    const d = parseHtml(r.html)
    body = [...d.querySelectorAll('style')].map((s) => s.outerHTML).join('') + d.body.innerHTML
  } else body = `<pre class="plain">${linkify(esc(msg.text || ''))}</pre>`
  const rows = []
  const row = (k, v) => { if (v) rows.push(`<tr><td>${k}</td><td>${esc(v)}</td></tr>`) }
  row('From', h.from); row('To', h.to); row('Cc', h.cc); row('Bcc', h.bcc); row('Date', h.date)
  const files = msg.attachments.filter((a) => !(a.inline && a.cid && msg.html && msg.html.toLowerCase().includes('cid:' + a.cid.toLowerCase())))
  const totalSize = files.reduce((n, a) => n + a.bytes.length, 0)
  const att = files.length ? `<div class="mail-att">Attachments: ${files.map((a) => (embedAttachments && totalSize < 12e6 ? `<span><a href="${dataUrl(a.bytes, a.type || 'application/octet-stream')}" download="${esc(a.name)}">${esc(a.name)}</a> (${formatSize(a.bytes.length)})</span>` : `<span>${esc(a.name)} (${formatSize(a.bytes.length)})</span>`)).join('')}</div>` : ''
  const note = blocked.length ? `<p class="mail-att">${blocked.length} remote picture${blocked.length === 1 ? '' : 's'} not loaded, to keep this message private.</p>` : ''
  const doc = `<div class="mail-head"><h1>${esc(h.subject || '(no subject)')}</h1><table>${rows.join('')}</table>${att}${note}</div><div class="mail-body">${body}</div>`
  return wrapDoc(doc, { title: title || h.subject || 'E-mail', css: CSS })
}

/** Parsed message -> plain text with a header block and an attachment list. */
export async function emailToText(msg) {
  const h = msg.headers
  const lines = []
  const add = (k, v) => { if (v) lines.push(`${k}: ${v}`) }
  add('From', h.from); add('To', h.to); add('Cc', h.cc); add('Date', h.date); add('Subject', h.subject)
  lines.push('')
  let body = msg.text
  if ((!body || !body.trim()) && msg.html) {
    const { htmlToBlocks, astToText } = await import('./_ast.js')
    body = astToText((await htmlToBlocks(msg.html)).blocks)
  }
  lines.push((body || '').replace(/\r\n?/g, '\n').trim())
  if (msg.attachments.length) { lines.push('', 'Attachments:'); for (const a of msg.attachments) lines.push(`- ${a.name} (${formatSize(a.bytes.length)})`) }
  return lines.join('\n') + '\n'
}

// ------------------------------------------------------------------ msg (Outlook)
const LZ_INIT = '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx'

/** Decompress the RTF stored in a .msg (LZFu). */
export function lzfuDecompress(data) {
  if (data.length < 16) return new Uint8Array(0)
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const rawSize = dv.getUint32(4, true), magic = dv.getUint32(8, true)
  if (magic === 0x414c454d) return data.subarray(16, 16 + rawSize)
  if (magic !== 0x75465a4c) throw fail('The message body (RTF) in this .msg file is in an unknown format.')
  const dict = new Uint8Array(4096)
  for (let i = 0; i < LZ_INIT.length; i++) dict[i] = LZ_INIT.charCodeAt(i)
  let w = LZ_INIT.length
  const out = []
  let i = 16
  outer: while (i < data.length) {
    const ctrl = data[i++]
    for (let bit = 0; bit < 8; bit++) {
      if (ctrl & (1 << bit)) {
        if (i + 1 >= data.length + 0) break outer
        const hi = data[i++], lo = data[i++]
        const off = (hi << 4) | (lo >> 4), len = (lo & 15) + 2
        if (off === w) break outer
        for (let k = 0; k < len; k++) { const b = dict[(off + k) & 4095]; out.push(b); dict[w] = b; w = (w + 1) & 4095 }
      } else {
        if (i >= data.length) break outer
        const b = data[i++]
        out.push(b); dict[w] = b; w = (w + 1) & 4095
      }
    }
  }
  return Uint8Array.from(out)
}

const MSG_PROPS = {
  subject: '0037', senderName: '0C1A', senderEmail: '0C1F', senderSmtp: '5D01', reprName: '0042', reprSmtp: '5D02', displayTo: '0E04', displayCc: '0E03', displayBcc: '0E02',
  headers: '007D', body: '1000', html: '1013', rtf: '1009', messageId: '1035',
}
/** Outlook .msg (OLE compound file) -> {headers, text, html, attachments}. */
export async function parseMsg(bytes) {
  if (!(bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)) throw fail('This does not look like an Outlook .msg file.')
  const X = await xlsx()
  let cfb
  try { cfb = X.CFB.read(bytes, { type: 'array' }) } catch { throw fail('Could not read this .msg file. It may be damaged.') }
  const paths = new Map()
  cfb.FullPaths.forEach((p, i) => paths.set(p.replace(/\/$/, ''), cfb.FileIndex[i]))
  const rootName = cfb.FullPaths[0].replace(/\/$/, '')
  const get = (prefix, id, types) => {
    for (const t of types) {
      const e = paths.get(`${prefix}/__substg1.0_${id}${t}`)
      if (e && e.content) return { type: t, data: Uint8Array.from(e.content) }
    }
    return null
  }
  if (!paths.has(`${rootName}/__properties_version1.0`)) throw fail('This .msg file has no message properties. It may not be an e-mail message.')

  function readMessage(prefix, isTop, depth = 0) {
    const props = paths.get(`${prefix}/__properties_version1.0`)
    const fixed = new Map()
    if (props?.content) {
      const c = Uint8Array.from(props.content)
      const dv = new DataView(c.buffer)
      for (let o = isTop ? 32 : 24; o + 16 <= c.length; o += 16) fixed.set(dv.getUint32(o, true), { lo: dv.getUint32(o + 8, true), hi: dv.getUint32(o + 12, true) })
    }
    const cp = fixed.get(0x3fde0003)?.lo || fixed.get(0x3ffd0003)?.lo || 1252
    const str = (id) => {
      const g = get(prefix, id, ['001F', '001E'])
      if (!g) return ''
      return (g.type === '001F' ? new TextDecoder('utf-16le').decode(g.data) : decodeCodepage(g.data, cp)).replace(/\u0000+$/, '')
    }
    const filetime = (id) => { const f = fixed.get(id); if (!f) return null; const t = (BigInt(f.hi) << 32n) | BigInt(f.lo); const ms = Number(t / 10000n) - 11644473600000; return ms > 0 ? new Date(ms) : null }
    const headersRaw = str(MSG_PROPS.headers)
    let date = filetime(0x00390040) || filetime(0x0e060040) || filetime(0x00300040)
    let dateStr = date ? date.toUTCString() : ''
    if (headersRaw) { const m = /^Date:\s*(.+)$/im.exec(headersRaw.replace(/\r?\n[ \t]+/g, ' ')); if (m) dateStr = m[1].trim() }
    const sender = (name, email) => (email && name && name !== email ? `${name} <${email}>` : email || name)
    const from = sender(str(MSG_PROPS.senderName) || str(MSG_PROPS.reprName), str(MSG_PROPS.senderSmtp) || str(MSG_PROPS.reprSmtp) || (/^[^\s@]+@[^\s@]+$/.test(str(MSG_PROPS.senderEmail)) ? str(MSG_PROPS.senderEmail) : ''))
    // recipients
    const rec = { 1: [], 2: [], 3: [] }
    for (const [p] of paths) {
      const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/__recip_version1\\.0_#([0-9A-F]+)$`).exec(p)
      if (!m) continue
      const rp = paths.get(`${p}/__properties_version1.0`)
      let type = 1
      if (rp?.content) { const c = Uint8Array.from(rp.content), dv = new DataView(c.buffer); for (let o = 8; o + 16 <= c.length; o += 16) if (dv.getUint32(o, true) === 0x0c150003) type = dv.getUint32(o + 8, true) }
      const sub = (id) => { const g = get(p, id, ['001F', '001E']); return g ? (g.type === '001F' ? new TextDecoder('utf-16le').decode(g.data) : decodeCodepage(g.data, cp)).replace(/\u0000+$/, '') : '' }
      const email = sub('39FE') || (/@/.test(sub('3003')) ? sub('3003') : '')
      ;(rec[type] || rec[1]).push(sender(sub('3001'), email))
    }
    const to = rec[1].length ? rec[1].join(', ') : str(MSG_PROPS.displayTo).replace(/;\s*/g, ', ')
    const cc = rec[2].length ? rec[2].join(', ') : str(MSG_PROPS.displayCc).replace(/;\s*/g, ', ')
    const bcc = rec[3].length ? rec[3].join(', ') : str(MSG_PROPS.displayBcc).replace(/;\s*/g, ', ')
    // bodies
    let html = null
    const hb = get(prefix, MSG_PROPS.html, ['0102', '001F', '001E'])
    if (hb) html = hb.type === '001F' ? new TextDecoder('utf-16le').decode(hb.data).replace(/\u0000+$/, '') : decodeCharsetGuess(hb.data, fixed.get(0x3fde0003)?.lo || cp)
    let text = str(MSG_PROPS.body)
    let rtfHtmlBlocks = null
    if (!html) {
      const rb = get(prefix, MSG_PROPS.rtf, ['0102'])
      if (rb) rtfHtmlBlocks = { rtf: lzfuDecompress(rb.data) }
    }
    // attachments
    const attachments = []
    const attPaths = [...paths.keys()].filter((p) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/__attach_version1\\.0_#[0-9A-F]+$`).test(p))
    let n = 0
    for (const ap of attPaths) {
      n++
      const sub = (id) => { const g = get(ap, id, ['001F', '001E']); return g ? (g.type === '001F' ? new TextDecoder('utf-16le').decode(g.data) : decodeCodepage(g.data, cp)).replace(/\u0000+$/, '') : '' }
      const ap_props = paths.get(`${ap}/__properties_version1.0`)
      const apf = new Map()
      if (ap_props?.content) { const c = Uint8Array.from(ap_props.content), dv = new DataView(c.buffer); for (let o = 8; o + 16 <= c.length; o += 16) apf.set(dv.getUint32(o, true), dv.getUint32(o + 8, true)) }
      const method = apf.get(0x37050003)
      const name = (sub('3707') || sub('3704') || sub('3001') || `attachment-${n}`).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      const cid = sub('3712') || null
      const type = sub('370E') || ''
      if (method === 5 && depth < 4) {
        const inner = paths.has(`${ap}/__substg1.0_3701000D`) ? readMessage(`${ap}/__substg1.0_3701000D`, false, depth + 1) : null
        if (inner) { attachments.push({ name: `${(inner.headers.subject || name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.eml`, type: 'message/rfc822', bytes: null, nested: inner, cid: null, inline: false }); continue }
      }
      const data = get(ap, '3701', ['0102'])
      if (!data) continue
      const hidden = apf.get(0x7ffe000b)
      const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase()
      const t = type || (sniffImage(data.data) ?? mimeFor(ext || ''))
      attachments.push({ name, type: t, bytes: data.data, cid, inline: !!cid && (hidden === 1 || /^image\//.test(t)) })
    }
    return { headers: { from, to, cc, bcc, replyTo: '', subject: str(MSG_PROPS.subject), date: dateStr, messageId: str(MSG_PROPS.messageId) }, text, html, attachments, rtfHtmlBlocks }
  }
  const m = readMessage(rootName, true)
  // an RTF-only body: render it through the RTF reader
  if (!m.html && m.rtfHtmlBlocks) {
    try {
      const { rtfToBlocks } = await import('./_rtf.js')
      const { astToHtml } = await import('./_ast.js')
      const { blocks } = rtfToBlocks(m.rtfHtmlBlocks.rtf)
      const h = astToHtml(blocks)
      if (h) m.html = h
    } catch { /* keep the plain-text body */ }
  }
  const resolveNested = (msg) => {
    msg.attachments = msg.attachments.map((a) => {
      if (a.nested) { resolveNested(a.nested); return { ...a, bytes: buildEml(a.nested) } }
      return a
    })
    delete msg.rtfHtmlBlocks
  }
  resolveNested(m)
  if (!m.text && !m.html) m.text = ''
  return m
}
function decodeCharsetGuess(bytes, cp) {
  // .msg HTML bodies are stored as bytes in the message's code page
  if (cp === 65001) return new TextDecoder('utf-8').decode(bytes)
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (!utf.includes('\ufffd')) return utf
  return decodeCodepage(bytes, cp)
}

// ------------------------------------------------------------------ mhtml
/** MHTML / MHT bytes -> self-contained HTML string (resources become data URLs, scripts removed). */
export async function mhtmlToHtml(bytes) {
  const root = parseMime(bytes)
  const parts = []
  const walk = (n) => { if (n.ctype.startsWith('multipart/')) n.parts.forEach(walk); else parts.push(n) }
  walk(root)
  if (!parts.length) throw fail('No page was found inside this MHTML file.')
  const main = parts.find((p) => p.ctype === 'text/html') || parts[0]
  if (main.ctype !== 'text/html') throw fail('This MHTML file does not contain an HTML page.')
  const res = new Map()
  const byCid = new Map()
  for (const p of parts) {
    if (p === main) continue
    const loc = p.header('content-location'), cid = p.header('content-id').replace(/^<|>$/g, '')
    const entry = { part: p, type: p.ctype }
    if (loc) res.set(loc, entry)
    if (cid) byCid.set(cid, entry)
  }
  const base = main.header('content-location') || ''
  const absolute = (u) => { try { return new URL(u, base || undefined).href } catch { return u } }
  const lookup = (u) => {
    if (!u) return null
    u = u.trim()
    const m = /^cid:(.+)$/i.exec(u)
    if (m) return byCid.get(m[1].replace(/^<|>$/g, '')) || null
    return res.get(u) || res.get(absolute(u)) || null
  }
  const asData = (e) => dataUrl(e.part.body, e.type === 'application/octet-stream' ? sniffImage(e.part.body) || e.type : e.type)
  let html = textOf(main)
  const doc = parseHtml(html)
  for (const s of doc.querySelectorAll('script, iframe, frame, object, embed, noscript')) s.remove()
  for (const el of doc.querySelectorAll('*')) for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name)
  const cssInline = (css, cssBase) => css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (m, q, u) => { if (/^data:/i.test(u)) return m; const e = lookup(cssBase ? (() => { try { return new URL(u, cssBase).href } catch { return u } })() : u) || lookup(u); return e ? `url(${asData(e)})` : m }).replace(/@import\s+(?:url\()?['"]?([^'")\s;]+)['"]?\)?[^;]*;/gi, (m, u) => { const e = lookup(u); return e && /css/.test(e.type) ? decodeCharset(e.part.body, e.part.params.charset) : '' })
  for (const l of doc.querySelectorAll('link[rel~=stylesheet]')) {
    const e = lookup(l.getAttribute('href'))
    if (e) { const st = doc.createElement('style'); st.textContent = cssInline(decodeCharset(e.part.body, e.part.params.charset), e.part.header('content-location')); l.replaceWith(st) } else l.remove()
  }
  for (const l of doc.querySelectorAll('link')) l.remove()
  for (const st of doc.querySelectorAll('style')) st.textContent = cssInline(st.textContent, base)
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', cssInline(el.getAttribute('style'), base))
  for (const img of doc.querySelectorAll('img, source, input[type=image]')) {
    const e = lookup(img.getAttribute('src'))
    if (e) img.setAttribute('src', asData(e)); else if (!/^data:/i.test(img.getAttribute('src') || '')) img.removeAttribute('src')
    img.removeAttribute('srcset')
    img.removeAttribute('loading')
  }
  for (const el of doc.querySelectorAll('[background]')) { const e = lookup(el.getAttribute('background')); if (e) el.setAttribute('background', asData(e)) }
  for (const a of doc.querySelectorAll('a[href]')) { const h = a.getAttribute('href'); if (/^javascript:/i.test(h)) a.removeAttribute('href'); else if (!/^(#|mailto:|data:)/i.test(h)) a.setAttribute('href', absolute(h)) }
  if (!doc.querySelector('meta[charset]')) { const m = doc.createElement('meta'); m.setAttribute('charset', 'utf-8'); doc.head.prepend(m) }
  for (const m of doc.querySelectorAll('meta[http-equiv]')) m.remove()
  const title = doc.title || main.header('subject') || ''
  return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, title, location: base }
}
void concat; void utf8; void decodeWords
