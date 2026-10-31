// More subtitle formats for the converter: SAMI (.smi, several languages), LRC lyrics (with word timing), TTML / DFXP, MicroDVD (.sub)
// and SCC (CEA-608 captions), plus reading old text encodings. Pure functions, no DOM except DOMParser for TTML.
// A cue is { start, end, text } in seconds (rounded to milliseconds), lines joined by "\n". Basic <i> <b> <u> tags may stay in the text.

const r3 = (s) => Math.round(s * 1000) / 1000
const pad = (n, w = 2) => String(n).padStart(w, '0')
const escXml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const unescXml = (t) => t.replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/gi, '&')
/** Plain text with only <i>, <b>, <u> kept. */
const basicTags = (t) => t.replace(/\{\\[^}]*\}/g, '').replace(/<(?!\/?[ibu]>)[^>]*>/gi, '')
/** Plain text, no tags at all. */
const noTags = (t) => t.replace(/\{\\[^}]*\}/g, '').replace(/<[^>]*>/g, '')

// ---------- Text encodings ----------

export const ENCODINGS = [
  ['auto', 'Detect automatically'], ['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 (little endian)'], ['utf-16be', 'UTF-16 (big endian)'],
  ['euc-kr', 'Korean (CP949, EUC-KR)'], ['shift_jis', 'Japanese (Shift_JIS)'], ['gbk', 'Chinese, simplified (GBK)'], ['big5', 'Chinese, traditional (Big5)'],
  ['windows-1252', 'Western European (Windows-1252)'], ['windows-1251', 'Cyrillic (Windows-1251)'], ['windows-1253', 'Greek (Windows-1253)'], ['windows-1254', 'Turkish (Windows-1254)'], ['windows-1250', 'Central European (Windows-1250)'],
]

const strict = (label, bytes) => { try { return new TextDecoder(label, { fatal: true }).decode(bytes) } catch { return null } }

/** Share of byte pairs (lead >= 0x81) that fall inside the common double-byte block of a legacy CJK encoding. */
function pairShare(u, loLead, hiLead) {
  let pairs = 0
  let hit = 0
  for (let i = 0; i < u.length; i++) {
    if (u[i] < 0x81) continue
    pairs++
    const lead = u[i]
    const trail = u[i + 1]
    i++
    if (lead >= loLead && lead <= hiLead && trail >= 0xa1 && trail <= 0xfe) hit++
  }
  return pairs ? hit / pairs : 0
}

/** Which legacy encoding fits these bytes best: returns { label, score } for the likeliest of Korean, Japanese, Chinese or Western text. */
function guessLegacy(u) {
  const best = { label: 'windows-1252', score: 0.3 }
  const consider = (label, score) => { if (score > best.score) { best.label = label; best.score = score } }
  const count = (s) => {
    const c = { n: 0, hangul: 0, kana: 0, hw: 0, han: 0 }
    for (const ch of s) {
      const x = ch.codePointAt(0)
      if (x < 0x80) continue
      c.n++
      if ((x >= 0xac00 && x <= 0xd7a3) || (x >= 0x3131 && x <= 0x318e)) c.hangul++
      else if (x >= 0x3040 && x <= 0x30ff) c.kana++
      else if (x >= 0xff61 && x <= 0xff9f) c.hw++
      else if ((x >= 0x3400 && x <= 0x9fff) || (x >= 0xf900 && x <= 0xfaff)) c.han++
    }
    return c
  }
  const kr = strict('euc-kr', u)
  if (kr) { const c = count(kr); if (c.n) consider('euc-kr', (c.hangul / c.n) * pairShare(u, 0xb0, 0xc8) + 0.04 * (c.han / c.n)) }
  const sj = strict('shift_jis', u)
  if (sj) { const c = count(sj); if (c.n) consider('shift_jis', (c.kana + 0.8 * c.han + 0.1 * c.hw) / c.n) }
  const gb = strict('gbk', u)
  if (gb) { const c = count(gb); if (c.n) consider('gbk', 0.8 * (c.han / c.n) * pairShare(u, 0xb0, 0xf7)) }
  return best
}

/**
 * decodeBytes(bytes, encoding = 'auto') -> { text, encoding }
 * Auto: a byte order mark wins, then UTF-16 without one, then UTF-8; otherwise the likeliest of Korean (CP949), Japanese (Shift_JIS),
 * simplified Chinese (GBK) or Windows-1252. Big5 and the other Windows code pages are only used when you pick them.
 */
export function decodeBytes(bytes, encoding = 'auto') {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const dec = (label, skip = 0) => new TextDecoder(label).decode(u.subarray(skip)).replace(/^﻿/, '')
  if (encoding && encoding !== 'auto') return { text: dec(encoding, encoding === 'utf-8' && u[0] === 0xef && u[1] === 0xbb && u[2] === 0xbf ? 3 : 0), encoding }
  if (u[0] === 0xef && u[1] === 0xbb && u[2] === 0xbf) return { text: dec('utf-8', 3), encoding: 'utf-8' }
  if (u[0] === 0xff && u[1] === 0xfe) return { text: dec('utf-16le', 2), encoding: 'utf-16le' }
  if (u[0] === 0xfe && u[1] === 0xff) return { text: dec('utf-16be', 2), encoding: 'utf-16be' }
  if (u.length >= 4 && u.length % 2 === 0) { // UTF-16 text without a BOM: ASCII characters leave a zero byte on every second position
    let even = 0
    let odd = 0
    const n = Math.min(u.length, 400)
    for (let i = 0; i < n; i++) if (u[i] === 0) (i % 2 ? odd++ : even++)
    if (odd > n * 0.3 && even === 0) return { text: dec('utf-16le'), encoding: 'utf-16le' }
    if (even > n * 0.3 && odd === 0) return { text: dec('utf-16be'), encoding: 'utf-16be' }
  }
  const utf8 = strict('utf-8', u)
  if (utf8 !== null) return { text: utf8.replace(/^﻿/, ''), encoding: 'utf-8' }
  const g = guessLegacy(u)
  return { text: dec(g.label), encoding: g.label }
}

// ---------- Detecting the format ----------

/** sniffFormat(text) -> 'srt' | 'vtt' | 'ass' | 'smi' | 'lrc' | 'ttml' | 'sub' | 'scc' | 'unknown' */
export function sniffFormat(text) {
  const t = String(text || '').replace(/^﻿/, '')
  const head = t.slice(0, 4000)
  if (/^\s*Scenarist_SCC/i.test(head)) return 'scc'
  if (/<sami[\s>]/i.test(head) || /<sync\s+start/i.test(head)) return 'smi'
  if (/^\s*WEBVTT/.test(head)) return 'vtt'
  if (/^\s*\[Script Info\]/i.test(head) || (/\[Events\]/i.test(t) && /^\s*Dialogue\s*:/im.test(t))) return 'ass'
  if (/<tt[\s>]/.test(head) && (/ttml|<p\b/i.test(head) || /<body/i.test(t))) return 'ttml'
  if (/^\s*\{\d+\}\s*\{\d+\}/m.test(head)) return 'sub'
  if (/-->/.test(head)) return 'srt'
  if (/^\s*\[(?:\d+:)?\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/m.test(head)) return 'lrc'
  return 'unknown'
}

// ---------- SAMI ----------

/** Class names and language labels used when writing SAMI. */
export const SAMI_LANGS = [
  ['ENCC', 'English', 'en-US'], ['KRCC', 'Korean', 'ko-KR'], ['JPCC', 'Japanese', 'ja-JP'], ['CNCC', 'Chinese', 'zh-CN'], ['ESCC', 'Spanish', 'es-ES'],
  ['FRCC', 'French', 'fr-FR'], ['DECC', 'German', 'de-DE'], ['ITCC', 'Italian', 'it-IT'], ['PTCC', 'Portuguese', 'pt-BR'], ['RUCC', 'Russian', 'ru-RU'], ['HICC', 'Hindi', 'hi-IN'],
]

/**
 * parseSami(text) -> { languages: [{ id, name, lang, cues }] }
 * SAMI files can hold several languages as <P Class=...> inside the same <SYNC> blocks. A cue ends when the next sync of its
 * own language starts (usually an &nbsp; line); the last one lasts three seconds.
 */
export function parseSami(text) {
  const src = String(text || '').replace(/^﻿/, '')
  const meta = new Map()
  const style = src.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || ''
  for (const m of style.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
    const body = m[2]
    meta.set(m[1].toLowerCase(), { id: m[1], name: body.match(/\bname\s*:\s*([^;\r\n}]+)/i)?.[1]?.trim() || '', lang: body.match(/\blang\s*:\s*([^;\r\n}]+)/i)?.[1]?.trim() || '' })
  }
  const body = src.slice(Math.max(0, src.search(/<body[\s>]/i)))
  const parts = body.split(/<sync\b/i).slice(1)
  const events = new Map() // class -> [{start, text}]
  for (const part of parts) {
    const gt = part.indexOf('>')
    const startAttr = part.slice(0, gt).match(/start\s*=\s*["']?(\d+)/i)
    if (!startAttr || gt < 0) continue
    const start = +startAttr[1] / 1000
    const content = part.slice(gt + 1).replace(/<\/body>[\s\S]*$/i, '')
    const ps = content.split(/<p\b/i)
    const chunks = ps.length > 1 ? ps.slice(1) : []
    for (const chunk of chunks) {
      const g2 = chunk.indexOf('>')
      const attrs = chunk.slice(0, g2)
      const cls = (attrs.match(/class\s*=\s*["']?([\w-]+)/i)?.[1] || 'default').toLowerCase()
      let t = chunk.slice(g2 + 1).replace(/<\/p>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(?:font|span|ruby|rt|rp|div|center)[^>]*>/gi, '')
      t = basicTags(t)
      t = unescXml(t).replace(/[ \t\r\f\v]+/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim()
      if (!events.has(cls)) events.set(cls, [])
      events.get(cls).push({ start, text: t })
    }
  }
  const languages = []
  for (const [cls, list] of events) {
    const cues = []
    list.forEach((e, i) => {
      if (!e.text) return
      const next = list.slice(i + 1).find((n) => n.start > e.start)
      cues.push({ start: r3(e.start), end: r3(next ? next.start : e.start + 3), text: e.text })
    })
    if (!cues.length) continue
    const m = meta.get(cls) || {}
    languages.push({ id: m.id || cls, name: m.name || '', lang: m.lang || '', cues })
  }
  return { languages }
}

/** Cues -> SAMI text. opts: { className: 'ENCC', name: 'English', lang: 'en-US', title } */
export function toSami(cues, { className = 'ENCC', name = 'English', lang = 'en-US', title = 'Subtitles' } = {}) {
  const body = []
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  sorted.forEach((c, i) => {
    const text = escXml(basicTags(c.text).replace(/<(?!\/?[ibu]>)[^>]*>/gi, '')).replace(/&lt;(\/?[ibu])&gt;/gi, '<$1>').replace(/\n/g, '<br>')
    body.push(`<SYNC Start=${Math.round(c.start * 1000)}><P Class=${className}>${text || '&nbsp;'}`)
    const next = sorted[i + 1]
    if (!next || next.start - c.end > 0.001) body.push(`<SYNC Start=${Math.round(Math.max(c.end, c.start) * 1000)}><P Class=${className}>&nbsp;`)
  })
  return `<SAMI>\n<HEAD>\n<TITLE>${escXml(title)}</TITLE>\n<STYLE TYPE="text/css">\n<!--\nP { margin-left:8pt; margin-right:8pt; margin-bottom:2pt; margin-top:2pt; font-size:20pt; text-align:center; font-family:arial, sans-serif; font-weight:normal; color:white; background-color:black; }\n.${className} { Name:${name}; lang:${lang}; SAMIType:CC; }\n-->\n</STYLE>\n</HEAD>\n<BODY>\n${body.join('\n')}\n</BODY>\n</SAMI>\n`
}

// ---------- LRC lyrics ----------

const LRC_TIME = /\[(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const lrcSec = (h, m, s, f) => (+(h || 0)) * 3600 + +m * 60 + +s + (f ? +f.padEnd(3, '0').slice(0, 3) / 1000 : 0)

/**
 * parseLrc(text) -> { cues, meta, enhanced }
 * Reads [mm:ss.xx] lines (several timestamps per line are fine), the [offset:ms] tag and enhanced <mm:ss.xx> word timing.
 * A line ends when the next one starts (an empty timestamp line also ends it). Word timing is read to find where a line ends, then dropped.
 */
export function parseLrc(text) {
  const meta = {}
  const rows = []
  let enhanced = false
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line) continue
    const tag = line.match(/^\[([a-z]{2,8})\s*:\s*([^\]]*)\]$/i)
    if (tag && !/^\d/.test(tag[1])) { meta[tag[1].toLowerCase()] = tag[2].trim(); continue }
    const stamps = [...line.matchAll(LRC_TIME)]
    if (!stamps.length) continue
    // the body starts after the last leading [..] stamp
    let body = line
    let guard = 0
    const times = []
    for (let m = body.match(/^\s*\[(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/); m && guard++ < 20; m = body.match(/^\s*\[(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/)) {
      times.push(lrcSec(m[1], m[2], m[3], m[4]))
      body = body.slice(m[0].length)
    }
    const words = []
    const WORD = /<(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g
    let plain = body
    if (WORD.test(body)) {
      enhanced = true
      WORD.lastIndex = 0
      plain = ''
      let last = null
      let idx = 0
      for (const w of body.matchAll(WORD)) {
        const chunk = body.slice(idx, w.index)
        if (last) words.push({ start: last.t, text: chunk }); else plain += chunk
        last = { t: lrcSec(w[1], w[2], w[3], w[4]) }
        idx = w.index + w[0].length
      }
      const tail = body.slice(idx)
      if (last) words.push({ start: last.t, text: tail })
      plain += words.map((w) => w.text).join('')
    }
    const t = unescXml(plain).replace(/\s+/g, ' ').trim()
    for (const start of times) rows.push({ start, text: t, words: words.length ? words.map((w) => ({ start: w.start, text: w.text })) : null })
  }
  const offset = (+meta.offset || 0) / 1000
  rows.sort((a, b) => a.start - b.start)
  const cues = []
  rows.forEach((r, i) => {
    if (!r.text) return
    const start = r3(Math.max(0, r.start - offset))
    const next = rows[i + 1]
    let end = next ? next.start - offset : start + 4
    const lastWord = r.words?.at(-1)
    if (lastWord && !lastWord.text.trim()) end = Math.min(end, lastWord.start - offset) // trailing empty word tag = the line ends there
    cues.push({ start, end: r3(Math.max(start + 0.05, Math.min(end, start + 12))), text: r.text })
  })
  return { cues, meta, enhanced }
}

const lrcStamp = (sec) => {
  const cs = Math.max(0, Math.round(sec * 100))
  return `[${pad(Math.floor(cs / 6000))}:${pad(Math.floor((cs % 6000) / 100))}.${pad(cs % 100)}]`
}

/** Cues -> LRC. opts: { title, gaps: add an empty line where the text should clear (default true) } */
export function toLrc(cues, { title = '', gaps = true } = {}) {
  const out = title ? [`[ti:${title}]`] : []
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  sorted.forEach((c, i) => {
    const text = noTags(c.text).replace(/\s*\n\s*/g, ' ').trim()
    out.push(`${lrcStamp(c.start)}${text}`)
    const next = sorted[i + 1]
    if (gaps && (!next || next.start - c.end > 0.25)) out.push(lrcStamp(c.end))
  })
  return `${out.join('\n')}\n`
}

// ---------- TTML / DFXP ----------

function ttmlTime(value, { frameRate = 30, tickRate = 1 } = {}) {
  const s = String(value || '').trim()
  if (!s) return NaN
  let m = s.match(/^(\d+):(\d{2}):(\d{2})(?:[.,](\d+)|:(\d+)(?:\.\d+)?)?$/)
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +`0.${m[4]}` : m[5] ? +m[5] / frameRate : 0)
  m = s.match(/^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/)
  if (m) return { h: 3600, m: 60, s: 1, ms: 0.001, f: 1 / frameRate, t: 1 / tickRate }[m[2]] * +m[1]
  return /^\d+(\.\d+)?$/.test(s) ? +s : NaN
}

/** parseTtml(text) -> { cues }. Reads begin / end / dur as clock times, offsets (1.5s, 120ms, 90f, 10000t) and handles <br/> and italic spans. */
export function parseTtml(text) {
  if (typeof DOMParser === 'undefined') throw new Error('TTML needs a browser to read.')
  const doc = new DOMParser().parseFromString(String(text || '').replace(/^﻿/, ''), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This TTML file is not valid XML.')
  const root = doc.documentElement
  const attr = (el, name) => el.getAttribute(name) ?? el.getAttributeNS?.('*', name) ?? [...el.attributes].find((a) => a.localName === name)?.value ?? null
  const frameRate = (+attr(root, 'ttp:frameRate') || 30) * ((+(attr(root, 'ttp:frameRateMultiplier')?.split(/\s+/)[0]) || 1000) / (+(attr(root, 'ttp:frameRateMultiplier')?.split(/\s+/)[1]) || 1000))
  const tickRate = +attr(root, 'ttp:tickRate') || 1
  const tc = { frameRate, tickRate }
  const cues = []
  const walk = (node, italic) => {
    let out = ''
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue.replace(/\s+/g, ' ')
      else if (n.nodeType === 1) {
        const name = n.localName.toLowerCase()
        if (name === 'br') out += '\n'
        else {
          const it = /italic/i.test(attr(n, 'tts:fontStyle') || attr(n, 'fontStyle') || '')
          const inner = walk(n, italic || it)
          out += it && !italic ? `<i>${inner}</i>` : inner
        }
      }
    }
    return out
  }
  for (const p of doc.getElementsByTagNameNS('*', 'p')) {
    let base = 0
    for (let up = p.parentElement; up; up = up.parentElement) { const b = ttmlTime(attr(up, 'begin'), tc); if (Number.isFinite(b)) base += b }
    const begin = ttmlTime(attr(p, 'begin'), tc)
    let end = ttmlTime(attr(p, 'end'), tc)
    const dur = ttmlTime(attr(p, 'dur'), tc)
    if (!Number.isFinite(begin)) continue
    if (!Number.isFinite(end)) end = Number.isFinite(dur) ? begin + dur : begin + 3
    const t = walk(p, false).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').trim()
    if (t) cues.push({ start: r3(base + begin), end: r3(base + end), text: t })
  }
  return { cues: cues.sort((a, b) => a.start - b.start) }
}

/** Cues -> TTML (W3C Timed Text). opts: { lang: 'en' } */
export function toTtml(cues, { lang = 'en' } = {}) {
  const clock = (sec) => { const ms = Math.max(0, Math.round(sec * 1000)); return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}` }
  const body = cues.map((c) => {
    const lines = basicTags(c.text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) =>
      escXml(l).replace(/&lt;i&gt;/gi, '<span tts:fontStyle="italic">').replace(/&lt;\/i&gt;/gi, '</span>').replace(/&lt;b&gt;/gi, '<span tts:fontWeight="bold">').replace(/&lt;\/b&gt;/gi, '</span>').replace(/&lt;\/?u&gt;/gi, ''))
    return `      <p begin="${clock(c.start)}" end="${clock(Math.max(c.end, c.start))}" style="s1">${lines.join('<br/>')}</p>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="${escXml(lang)}">\n  <head>\n    <styling>\n      <style xml:id="s1" tts:textAlign="center" tts:color="white"/>\n    </styling>\n  </head>\n  <body>\n    <div>\n${body.join('\n')}\n    </div>\n  </body>\n</tt>\n`
}

// ---------- MicroDVD ----------

/**
 * parseMicroDvd(text, fps?) -> { cues, fps, fpsFromFile }
 * Lines look like {start}{end}text with frame numbers; "|" is a line break; {y:i} is italic. A first line {1}{1}23.976 sets the frame rate.
 */
export function parseMicroDvd(text, fps = 0) {
  let rate = fps
  let fromFile = false
  const cues = []
  const rows = []
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const m = raw.match(/^\s*\{(\d+)\}\s*\{(\d+)\}(.*)$/)
    if (m) rows.push({ a: +m[1], b: +m[2], t: m[3] })
  }
  if (rows.length && rows[0].a <= 1 && rows[0].b <= 1 && /^\s*\d+(?:\.\d+)?\s*$/.test(rows[0].t) && +rows[0].t >= 5 && +rows[0].t <= 120) {
    if (!rate) { rate = +rows[0].t; fromFile = true }
    rows.shift()
  }
  if (!rate) rate = 23.976
  for (const r of rows) {
    let t = r.t
    t = t.replace(/\{[yY]:([ibu]+)\}([^|{]*)/g, (_, st, body) => [...st].reduceRight((acc, s) => `<${s}>${acc}</${s}>`, body))
    t = t.replace(/\{[^}]*\}/g, '').split('|').map((l) => l.trim()).join('\n').trim()
    if (t) cues.push({ start: r3(r.a / rate), end: r3(Math.max(r.a, r.b) / rate), text: t })
  }
  return { cues, fps: rate, fpsFromFile: fromFile }
}

/** Cues -> MicroDVD text with frame numbers at `fps`. The first line carries the frame rate. */
export function toMicroDvd(cues, { fps = 23.976 } = {}) {
  const f = (s) => Math.max(0, Math.round(s * fps))
  const lines = [`{1}{1}${+fps.toFixed(3)}`]
  for (const c of cues) {
    const t = basicTags(c.text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const it = /^<i>([\s\S]*)<\/i>$/i.exec(l)
      return it ? `{y:i}${noTags(it[1])}` : noTags(l)
    }).join('|')
    if (t) lines.push(`{${f(c.start)}}{${Math.max(f(c.end), f(c.start) + 1)}}${t}`)
  }
  return `${lines.join('\n')}\n`
}

// ---------- SCC (CEA-608) ----------

const SCC_BASIC = { 0x2a: 'á', 0x5c: 'é', 0x5e: 'í', 0x5f: 'ó', 0x60: 'ú', 0x7b: 'ç', 0x7c: '÷', 0x7d: 'Ñ', 0x7e: 'ñ', 0x7f: '█' }
const SCC_SPECIAL = '®°½¿™¢£♪àÿèâêîôû'.replace('ÿ', ' ')
const SCC_EXT12 = 'ÁÉÓÚÜü‘¡*’\u2014©℠•“”ÀÂÇÈÊËëÎÏïÔÙùÛ«»'
const SCC_EXT13 = 'ÃãÍÌìÒòÕõ{}\\^_|~ÄäÖöß¥¤│ÅåØø┌┐└┘'
const PAC_ROWS = [[11, 11], [1, 2], [3, 4], [12, 13], [14, 15], [5, 6], [7, 8], [9, 10]]
const frameToSec = (f) => (f * 1001) / 30000
const secToFrame = (s) => Math.round((s * 30000) / 1001)

function sccFrames(h, m, s, sep, f) {
  const base = (+h * 3600 + +m * 60 + +s) * 30 + +f
  if (sep === ';' || sep === '.') { const total = +h * 60 + +m; return base - 2 * (total - Math.floor(total / 10)) }
  return base
}

/** parseScc(text) -> { cues }. Decodes channel 1 captions (pop-on, roll-up and paint-on) from the CEA-608 byte pairs. */
export function parseScc(text) {
  const cues = []
  let shown = { rows: {}, since: 0 }
  let hidden = { rows: {} }
  let mode = 'pop'
  let row = 15
  let col = 0
  let lastCtl = ''
  const rowsText = (mem) => Object.keys(mem).map(Number).sort((a, b) => a - b).map((r) => mem[r].replace(/\s+$/, '').replace(/^\s+/, '')).filter(Boolean).join('\n')
  const flush = (t) => {
    const tx = rowsText(shown.rows)
    if (tx && t > shown.since) cues.push({ start: r3(frameToSec(shown.since)), end: r3(frameToSec(t)), text: tx })
  }
  const target = () => (mode === 'pop' ? hidden : shown)
  const put = (ch, t) => {
    const mem = target()
    if (mem === shown && !rowsText(shown.rows)) shown.since = t
    const cur = (mem.rows[row] || '').padEnd(col, ' ')
    mem.rows[row] = cur.slice(0, col) + ch + cur.slice(col + 1)
    col++
  }
  const back = () => {
    const mem = target()
    if (col > 0) { col--; mem.rows[row] = (mem.rows[row] || '').slice(0, col) }
  }
  let t = 0
  for (const rawLine of String(text || '').split(/\r\n|\r|\n/)) {
    const m = rawLine.match(/^\s*(\d{1,2}):(\d{2}):(\d{2})([:;.])(\d{2})\s+(.*)$/)
    if (!m) continue
    const t0 = sccFrames(m[1], m[2], m[3], m[4], m[5])
    const words = m[6].trim().split(/\s+/).filter((w) => /^[0-9a-f]{4}$/i.test(w))
    words.forEach((w, k) => {
      t = t0 + k
      const b1 = parseInt(w.slice(0, 2), 16) & 0x7f
      const b2 = parseInt(w.slice(2, 4), 16) & 0x7f
      if (b1 >= 0x10 && b1 <= 0x1f) {
        if (w.toLowerCase() === lastCtl) { lastCtl = ''; return } // control codes are sent twice; the repeat is ignored
        lastCtl = w.toLowerCase()
        if (b1 & 0x08) return // channel 2
        if (b2 >= 0x40) { // preamble address code: row and indent
          const [a, b] = PAC_ROWS[b1 & 7]
          row = b2 >= 0x60 ? b : a
          col = b2 & 0x10 ? ((b2 & 0x0e) >> 1) * 4 : 0
          return
        }
        if (b1 === 0x11) { // mid-row codes and special characters
          if (b2 >= 0x30) put(SCC_SPECIAL[b2 - 0x30], t); else if (b2 >= 0x20) put(' ', t)
        } else if (b1 === 0x12 && b2 >= 0x20) { back(); put((SCC_EXT12 + '                                ')[b2 - 0x20] || ' ', t) } else if (b1 === 0x13 && b2 >= 0x20) { back(); put((SCC_EXT13 + '                                ')[b2 - 0x20] || ' ', t) } else if (b1 === 0x14 || b1 === 0x15) {
          switch (b2) {
            case 0x20: mode = 'pop'; break // RCL
            case 0x25: case 0x26: case 0x27: mode = 'roll'; break // RU2-4
            case 0x29: mode = 'paint'; break // RDC
            case 0x21: back(); break // backspace
            case 0x2c: flush(t); shown = { rows: {}, since: t }; break // EDM: erase displayed memory
            case 0x2d: if (mode === 'roll') { flush(t); const rows = Object.keys(shown.rows).map(Number).sort((a, b2) => a - b2); const next = {}; rows.forEach((r) => { if (r > 1) next[r - 1] = shown.rows[r] }); shown = { rows: next, since: t }; col = 0 } break // CR
            case 0x2e: hidden = { rows: {} }; break // ENM
            case 0x2f: flush(t); [shown, hidden] = [{ rows: hidden.rows, since: t }, { rows: {} }]; break // EOC: show the loaded caption
            default: break
          }
        } else if (b1 === 0x17 && b2 >= 0x21 && b2 <= 0x23) col += b2 - 0x20
        return
      }
      lastCtl = ''
      for (const b of [b1, b2]) if (b >= 0x20) put(SCC_BASIC[b] || String.fromCharCode(b), t)
    })
  }
  flush(t + 60)
  return { cues: cues.filter((c) => c.end > c.start).sort((a, b) => a.start - b.start) }
}

const parity = (b) => { let n = b; n ^= n >> 4; n ^= n >> 2; n ^= n >> 1; return (n & 1) ? b : b | 0x80 }
const hex = (a, b) => parity(a).toString(16).padStart(2, '0') + parity(b).toString(16).padStart(2, '0')
const frameToTc = (f) => {
  const d = Math.floor(f / 17982)
  const m = f % 17982
  const g = f + 18 * d + (m > 2 ? 2 * Math.floor((m - 2) / 1798) : 0)
  return `${pad(Math.floor(g / 108000))}:${pad(Math.floor(g / 1800) % 60)}:${pad(Math.floor(g / 30) % 60)};${pad(g % 30)}`
}

function sccBytes(text) {
  const out = []
  for (const ch of text.replace(/[–−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')) {
    const code = ch.codePointAt(0)
    const basicIdx = Object.entries(SCC_BASIC).find(([, v]) => v === ch)
    if (code >= 0x20 && code <= 0x7e && ch !== '*' && !'\\^_`{|}~'.includes(ch) && code !== 0x2a) out.push({ pair: null, b: code })
    else if (basicIdx) out.push({ pair: null, b: +basicIdx[0] })
    else if (SCC_SPECIAL.includes(ch)) out.push({ pair: [0x11, 0x30 + SCC_SPECIAL.indexOf(ch)] })
    else if (SCC_EXT12.includes(ch)) out.push({ pair: [0x12, 0x20 + SCC_EXT12.indexOf(ch)], erase: true })
    else if (SCC_EXT13.includes(ch)) out.push({ pair: [0x13, 0x20 + SCC_EXT13.indexOf(ch)], erase: true })
    else {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '')
      out.push({ pair: null, b: /^[\x20-\x7e]$/.test(plain) && plain !== '*' ? plain.charCodeAt(0) : 0x3f })
    }
  }
  return out
}

function wrap32(text) {
  const lines = []
  for (const para of noTags(text).split('\n').map((l) => l.trim()).filter(Boolean)) {
    let cur = ''
    for (const w of para.split(/\s+/)) {
      if (cur && cur.length + 1 + w.length > 32) { lines.push(cur); cur = w } else cur = cur ? `${cur} ${w}` : w
    }
    if (cur) lines.push(cur)
  }
  return lines.slice(0, 4).map((l) => l.slice(0, 32))
}

function sccWords(c) {
  const lines = wrap32(c.text)
  const words = [hex(0x14, 0x20), hex(0x14, 0x20), hex(0x14, 0x2e), hex(0x14, 0x2e)]
  lines.forEach((line, li) => {
    const r = 15 - lines.length + 1 + li
    const pair = PAC_ROWS.findIndex(([a, b]) => a === r || b === r)
    const b2 = (PAC_ROWS[pair][0] !== r ? 0x60 : 0x40) | 0x10 | (Math.min(7, Math.floor((32 - line.length) / 2 / 4)) << 1)
    words.push(hex(0x10 + pair, b2), hex(0x10 + pair, b2))
    let pend = null
    const flushPend = () => { if (pend !== null) { words.push(hex(pend, 0)); pend = null } }
    for (const e of sccBytes(line)) {
      if (e.pair) {
        flushPend()
        if (e.erase) words.push(hex(0x20, 0)) // a placeholder the extended character replaces
        words.push(hex(...e.pair))
      } else if (pend === null) pend = e.b
      else { words.push(hex(pend, e.b)); pend = null }
    }
    flushPend()
  })
  words.push(hex(0x14, 0x2f), hex(0x14, 0x2f))
  return words
}

/** Cues -> SCC (29.97 fps drop-frame, pop-on captions on rows 12-15, up to 32 characters by 4 lines; letters outside the CEA-608 set become plain letters or "?"). */
export function toScc(cues) {
  const items = [...cues].filter((c) => noTags(c.text).trim()).sort((a, b) => a.start - b.start).map((c) => ({ c, words: sccWords(c) }))
  const events = []
  let busy = 0
  items.forEach((it, i) => {
    const n = it.words.length
    const lineF = Math.max(busy, secToFrame(it.c.start) - (n - 2)) // the caption is shown by the EOC code in the last two words
    events.push({ f: lineF, words: it.words })
    busy = lineF + n
    const next = items[i + 1]
    const endF = Math.max(secToFrame(it.c.end), busy)
    const nextStart = next ? secToFrame(next.c.start) : Infinity
    if (!next || nextStart - endF > 8) { // a gap: clear the screen (otherwise the next caption replaces this one)
      const f = Math.min(endF, next ? nextStart - (next.words.length - 2) - 2 : Infinity)
      if (f >= busy) { events.push({ f, words: [hex(0x14, 0x2c), hex(0x14, 0x2c)] }); busy = f + 2 }
    }
  })
  return `Scenarist_SCC V1.0\n\n${events.map((e) => `${frameToTc(e.f)}\t${e.words.join(' ')}`).join('\n\n')}\n`
}
