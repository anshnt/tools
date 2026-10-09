// Subtitle parsing, formatting and timing transforms (SRT, WebVTT, basic ASS/SSA). Pure functions, no DOM.
// A cue is { start, end, text } with times in seconds (rounded to milliseconds) and lines joined by "\n".

export const SUB_ACCEPT = '.srt,.vtt,.ass,.ssa,.sbv,.txt,text/vtt,application/x-subrip,text/plain'
export const SUB_FORMATS = [['srt', 'SRT'], ['vtt', 'WebVTT'], ['ass', 'ASS'], ['txt', 'Plain text']]

const ms = (sec) => Math.round(sec * 1000)
const round3 = (sec) => Math.round(sec * 1000) / 1000
const pad = (n, w = 2) => String(n).padStart(w, '0')

/** "00:01:02,500" | "1:02.5" | "62.5" | "1:02:03.45" (ASS centiseconds work too) -> seconds, or NaN. */
export function parseTime(input) {
  const s = String(input ?? '').trim().replace(',', '.')
  if (!s) return NaN
  const neg = s.startsWith('-')
  const parts = (neg ? s.slice(1) : s).split(':')
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d*)?$/.test(p))) return NaN
  let sec = 0
  for (const p of parts) sec = sec * 60 + parseFloat(p)
  return round3(neg ? -sec : sec)
}

/** formatTime(3723.5) -> "01:02:03.500" (vtt/default), style 'srt' uses a comma, 'ass' gives "1:02:03.50", 'short' gives "62:03.5". */
export function formatTime(sec, style = 'vtt') {
  let t = ms(Math.max(0, Number.isFinite(sec) ? sec : 0))
  if (style === 'ass') {
    const cs = Math.round(t / 10)
    return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`
  }
  const hh = Math.floor(t / 3600000), mm = Math.floor(t / 60000) % 60, ss = Math.floor(t / 1000) % 60, mil = t % 1000
  if (style === 'short') return `${hh * 60 + mm}:${pad(ss)}.${Math.floor(mil / 100)}`
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${style === 'srt' ? ',' : '.'}${pad(mil, 3)}`
}

const TIME = String.raw`(?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`
const TIMING = new RegExp(String.raw`^\s*(${TIME})\s*-->\s*(${TIME})(.*)$`)

/** Remove markup from one line of subtitle text. keepBasic keeps <i>, <b>, <u>. */
export function stripTags(text, { keepBasic = false } = {}) {
  let t = text
    .replace(/\{\\[^}]*\}/g, '') // ASS overrides left in SRT files, e.g. {\an8}
    .replace(/<v(?:\.[^ >]*)?\s+([^>]+)>/gi, (_, who) => `${who.trim()}: `) // WebVTT voice span
  t = keepBasic ? t.replace(/<(?!\/?[ibu]>)[^>]*>/gi, '') : t.replace(/<[^>]*>/g, '')
  return t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&lrm;|&rlm;/g, '')
}

function parseAss(text) {
  const lines = text.split(/\r\n|\r|\n/)
  let inEvents = false
  let fmt = null
  const cues = []
  for (const raw of lines) {
    const line = raw.trim()
    if (/^\[.*\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue }
    if (!inEvents) continue
    if (/^format\s*:/i.test(line)) { fmt = line.replace(/^format\s*:/i, '').split(',').map((s) => s.trim().toLowerCase()); continue }
    if (!/^dialogue\s*:/i.test(line)) continue
    const cols = fmt || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
    const body = line.replace(/^dialogue\s*:\s*/i, '')
    const parts = []
    let rest = body
    for (let i = 0; i < cols.length - 1; i++) {
      const k = rest.indexOf(',')
      if (k < 0) break
      parts.push(rest.slice(0, k))
      rest = rest.slice(k + 1)
    }
    parts.push(rest)
    const get = (name) => parts[cols.indexOf(name)]
    const start = parseTime(get('start')), end = parseTime(get('end'))
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    const txt = (get('text') ?? '').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim()
    if (txt) cues.push({ start, end, text: txt })
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** parseSubtitles(text) -> { format: 'srt' | 'vtt' | 'ass' | 'unknown', cues: [{start, end, text}] }. Tolerates missing indexes, BOMs and sloppy blank lines. */
export function parseSubtitles(input) {
  const text = String(input ?? '').replace(/^﻿/, '')
  if (/^\s*\[Script Info\]/i.test(text) || (/\[Events\]/i.test(text) && /^\s*Dialogue\s*:/im.test(text))) return { format: 'ass', cues: parseAss(text) }
  const lines = text.split(/\r\n|\r|\n/)
  const vtt = /^\s*WEBVTT/.test(lines[0] || '')
  const cues = []
  let i = 0
  while (i < lines.length) {
    const m = TIMING.exec(lines[i])
    if (!m) { i++; continue }
    const start = parseTime(m[1]), end = parseTime(m[2])
    const body = []
    i++
    while (i < lines.length && lines[i].trim() !== '') {
      if (TIMING.test(lines[i])) break // a missing blank line before the next cue
      body.push(lines[i])
      i++
    }
    // Drop the next cue's index or identifier when the blank line was missing.
    if (i < lines.length && TIMING.test(lines[i]) && body.length > 1 && /^\d+$/.test(body.at(-1).trim())) body.pop()
    if (Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text: body.map((l) => l.trimEnd()).join('\n').trim() })
  }
  return { format: cues.length ? (vtt ? 'vtt' : 'srt') : 'unknown', cues }
}

const oneBlank = (t) => t.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '').join('\n')

/** Cues -> SRT text (always ends with a newline). */
export function toSRT(cues) {
  return cues.map((c, i) => `${i + 1}\n${formatTime(c.start, 'srt')} --> ${formatTime(Math.max(c.end, c.start), 'srt')}\n${oneBlank(vttToSrtText(c.text))}\n`).join('\n')
}

/** Cues -> WebVTT text. */
export function toVTT(cues) {
  const body = cues.map((c) => `${formatTime(c.start, 'vtt')} --> ${formatTime(Math.max(c.end, c.start), 'vtt')}\n${oneBlank(toVttText(c.text))}\n`).join('\n')
  return `WEBVTT\n\n${body}`
}

/** Cues -> a minimal ASS script (one default style, bottom centre). */
export function toASS(cues, { title = 'Subtitles', width = 1280, height = 720 } = {}) {
  const head = `[Script Info]\nTitle: ${title}\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n` +
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    'Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,40,40,40,1\n\n' +
    '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
  const lines = cues.map((c) => {
    const t = oneBlank(stripTags(c.text)).replace(/\n/g, '\\N')
    return `Dialogue: 0,${formatTime(c.start, 'ass')},${formatTime(Math.max(c.end, c.start), 'ass')},Default,,0,0,0,,${t}`
  })
  return head + lines.join('\n') + '\n'
}

// WebVTT only allows a few tags; SRT players mostly understand <i> <b> <u> and <font>.
function toVttText(t) {
  return t.replace(/\{\\[^}]*\}/g, '').replace(/<\/?font[^>]*>/gi, '').replace(/&(?!(?:amp|lt|gt|nbsp|lrm|rlm);)/g, '&amp;')
}
function vttToSrtText(t) {
  return t.replace(/<v(?:\.[^ >]*)?\s+([^>]+)>/gi, (_, who) => `${who.trim()}: `)
    .replace(/<\/v>/gi, '')
    .replace(/<(?!\/?[ibu]>|\/?font[ >])[^>]*>/gi, '')
}

/** Output in any of 'srt' | 'vtt' | 'ass' | 'txt'. */
export function format(cues, kind, opts) {
  if (kind === 'vtt') return toVTT(cues)
  if (kind === 'ass') return toASS(cues, opts)
  if (kind === 'txt') return toPlain(cues, opts)
  return toSRT(cues)
}

const SOUND = /^\s*[\[(＜<{♪♫].*[\])＞>}♪♫]\s*$|^\s*[♪♫]+\s*$/
const SPEAKER = /^\s*(?:-\s*)?[A-Z][A-Z0-9 .'_-]{0,24}:\s+/

/**
 * Cues -> plain text without timing or markup.
 * Options: merge (join cue lines into flowing paragraphs), gap (seconds of silence that starts a new paragraph when merging),
 * dedupe (drop a line that repeats the one before it, common in auto captions), noSounds (drop [Music], (applause), music-note lines),
 * noSpeakers (drop "JOHN:" labels), dashes (drop leading "- " dialogue dashes).
 */
export function toPlain(cues, { merge = false, gap = 2.5, dedupe = true, noSounds = false, noSpeakers = false, dashes = false } = {}) {
  const items = []
  let last = ''
  for (const c of cues) {
    let lines = stripTags(c.text).split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (noSounds) lines = lines.map((l) => (SOUND.test(l) ? '' : l.replace(/\s*[\[(][^\])]{0,60}[\])]\s*/g, ' ').replace(/[♪♫]+/g, '').trim())).filter(Boolean)
    if (noSpeakers) lines = lines.map((l) => l.replace(SPEAKER, '')).filter(Boolean)
    if (dashes) lines = lines.map((l) => l.replace(/^-\s*/, '')).filter(Boolean)
    if (dedupe) lines = lines.filter((l) => { const same = l.toLowerCase() === last; last = l.toLowerCase(); return !same })
    if (lines.length) items.push({ start: c.start, end: c.end, lines })
  }
  if (!merge) return items.map((it) => it.lines.join('\n')).join('\n')
  const paras = []
  let cur = null
  for (const it of items) {
    if (!cur || it.start - cur.end >= gap) { cur = { end: it.end, text: '' }; paras.push(cur) }
    cur.text = (cur.text ? `${cur.text} ` : '') + it.lines.join(' ')
    cur.end = Math.max(cur.end, it.end)
  }
  return paras.map((p) => p.text).join('\n\n')
}

// ---------- Timing transforms ----------
// Each returns { cues, dropped, clamped } and never mutates its input.

/** Move every cue by deltaMs (negative = earlier). Cues that end up entirely before 0 are dropped; ones that start before 0 are clamped. */
export function shiftCues(cues, deltaMs) {
  const d = deltaMs / 1000
  let dropped = 0, clamped = 0
  const out = []
  for (const c of cues) {
    const s = round3(c.start + d), e = round3(c.end + d)
    if (e <= 0) { dropped++; continue }
    if (s < 0) clamped++
    out.push({ ...c, start: Math.max(0, s), end: e })
  }
  return { cues: out, dropped, clamped }
}

/** Multiply every time by factor. Frame-rate fix: factor = fpsSubtitlesWereTimedFor / fpsOfYourVideo (23.976 -> 25 gives 0.95904). */
export function stretchCues(cues, factor) {
  if (!(factor > 0)) return { cues: cues.map((c) => ({ ...c })), dropped: 0, clamped: 0 }
  return { cues: cues.map((c) => ({ ...c, start: round3(c.start * factor), end: round3(c.end * factor) })), dropped: 0, clamped: 0 }
}

/**
 * Linear resync from two anchors: the subtitle that is at time a1 should be at b1, and the one at a2 should be at b2.
 * Returns the mapping (offset in ms and speed factor) too. Throws on identical anchors.
 */
export function resyncCues(cues, a1, b1, a2, b2) {
  if (![a1, b1, a2, b2].every(Number.isFinite)) throw new Error('Enter all four times.')
  if (Math.abs(a2 - a1) < 0.001) throw new Error('The two sync points must be at different times.')
  const scale = (b2 - b1) / (a2 - a1)
  if (!(scale > 0)) throw new Error('The second sync point must come after the first one in both columns.')
  const map = (t) => round3(b1 + (t - a1) * scale)
  let dropped = 0, clamped = 0
  const out = []
  for (const c of cues) {
    const s = map(c.start), e = map(c.end)
    if (e <= 0) { dropped++; continue }
    if (s < 0) clamped++
    out.push({ ...c, start: Math.max(0, s), end: e })
  }
  return { cues: out, dropped, clamped, scale, offsetMs: ms(b1 - a1 * scale) }
}

export const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60]

// ---------- Building cues from speech-to-text output ----------

function firstFit(words, max) {
  const lines = []
  let cur = ''
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > max) { lines.push(cur); cur = w } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  return lines
}

/** Wrap text at spaces into the fewest lines of at most max characters, then balance them (a word longer than max stays whole). */
export function wrapLines(text, max) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!max || t.length <= max) return t
  const words = t.split(' ')
  const fit = firstFit(words, max)
  for (let w = Math.ceil(t.length / fit.length); w < max; w++) {
    const l = firstFit(words, w)
    if (l.length <= fit.length) return l.join('\n')
  }
  return fit.join('\n')
}

/** Turn text with start/end times into evenly timed pseudo-words (weighted by length). Used when the model gave segments only. */
export function spreadWords(segments) {
  const out = []
  for (const s of segments) {
    const words = s.text.trim().split(/\s+/).filter(Boolean)
    if (!words.length) continue
    const total = words.reduce((a, w) => a + w.length + 1, 0)
    const dur = Math.max(0.05, s.end - s.start)
    let t = s.start
    for (const w of words) {
      const d = dur * ((w.length + 1) / total)
      out.push({ start: round3(t), end: round3(t + d), text: w, estimated: true })
      t += d
    }
  }
  return out
}

/**
 * Group timed words into readable cues.
 * opts: maxChars (per line, default 42), maxLines (default 2), maxDuration (seconds, default 6.5), pause (gap that forces a break, default 0.9),
 * minDuration (default 0.9, a short cue is stretched into a following gap).
 */
export function buildCues(words, { maxChars = 42, maxLines = 2, maxDuration = 6.5, pause = 0.9, minDuration = 0.9 } = {}) {
  const limit = maxChars * maxLines
  const cues = []
  let cur = []
  const textOf = (list) => list.map((w) => w.text.trim()).join(' ').replace(/\s+([,.!?;:])/g, '$1')
  const flush = () => {
    if (!cur.length) return
    cues.push({ start: cur[0].start, end: cur.at(-1).end, text: wrapLines(textOf(cur), maxChars) })
    cur = []
  }
  for (const w of words) {
    if (!w.text.trim()) continue
    if (cur.length) {
      const joined = textOf([...cur, w])
      const prev = cur.at(-1)
      const sentenceEnd = /[.!?。？！…]["')\]]?$/.test(prev.text.trim())
      const tooLong = firstFit(joined.split(' '), maxChars).length > maxLines
      if (tooLong || w.end - cur[0].start > maxDuration || w.start - prev.end > pause || (sentenceEnd && joined.length > limit * 0.3)) flush()
    }
    cur.push(w)
  }
  flush()
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i], next = cues[i + 1]
    if (c.end - c.start < minDuration) c.end = round3(Math.min(c.start + minDuration, next ? next.start : Infinity))
    if (next && c.end > next.start) c.end = next.start
    if (c.end < c.start) c.end = c.start
  }
  return cues
}

/** Characters per second of a cue (spaces and line breaks excluded); readable subtitles stay under about 20. */
export function cps(c) {
  const d = c.end - c.start
  return d > 0 ? c.text.replace(/\s/g, '').length / d : Infinity
}

/** Decode subtitle file bytes: UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252 (old SRT files from Windows and DVDs). */
export function decodeText(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u.subarray(2))
  if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(u.subarray(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u).replace(/^\uFEFF/, '') } catch { return new TextDecoder('windows-1252').decode(u) }
}
