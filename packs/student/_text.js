// Text analysis helpers shared by the flashcard, quiz, MCQ, answer-evaluator and lecture-notes tools.
// Everything here is plain JavaScript (no DOM) so it can be tested in Node. The heuristics are deliberately simple and explainable.

export const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves ' +
  'also however therefore thus hence moreover furthermore although though whether either neither since upon within without among per via etc eg ie may might must shall will one two three first second third many much several various another others every into onto like called known used using use make makes made get gets got yet ever never often usually generally typically really actually').split(/\s+/))

const ABBR = ['e.g.', 'i.e.', 'etc.', 'vs.', 'Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Prof.', 'Fig.', 'fig.', 'No.', 'no.', 'approx.', 'St.', 'Jr.', 'Sr.', 'cf.', 'viz.', 'al.', 'Inc.', 'Ltd.', 'Co.', 'Eq.', 'eq.', 'Vol.', 'vol.', 'pp.', 'ca.']
const DOT = '\u0001'
const NOT_TERMS = new Set('january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday celsius fahrenheit kelvin'.split(' '))

/** Strip markdown and list markers from one line. */
export function stripMd(line) {
  return String(line)
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+•·▪●○◦►]\s+|\d{1,3}[.)]\s+|\(?[a-zA-Z][.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const ABBR_RE = new RegExp('(?<![\\p{L}\\p{N}.])(?:' + ABBR.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gu')
const protect = (s) => {
  const out = s.replace(ABBR_RE, (m) => m.replace(/\./g, DOT))
  return out
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)
    .replace(/\b([A-Z])\.(?=\s?[A-Z])/g, `$1${DOT}`)
}
const restore = (s) => s.split(DOT).join('.')

/** Split text into sentences. Returns [{text, heading}] where heading is the nearest preceding heading-like line. */
export function splitSentences(text) {
  const out = []
  let heading = ''
  const lines = String(text).replace(/\r/g, '').split('\n')
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]
    if (!raw.trim()) continue
    const isMdHeading = /^\s{0,3}#{1,6}\s+/.test(raw)
    const clean = stripMd(raw)
    if (!clean) continue
    const wordsN = clean.split(/\s+/).length
    if (isMdHeading || (wordsN <= 6 && /^\p{Lu}/u.test(clean) && !/[.!?:;,=]$/.test(clean) && !/\s[-–\u2014]\s|[:=]/.test(clean) && !/^\s*(?:[-*+•]|\d+[.)])\s/.test(raw) && (lines[li + 1] ?? '').trim() && !/\b(?:is|are|was|were)\b/i.test(clean))) { heading = clean; continue }
    const parts = protect(clean).split(/(?<=[.!?…।])["')\]]*\s+(?=["'(\[]?[\p{Lu}\p{N}])/u).map((p) => restore(p).trim()).filter(Boolean)
    for (const p of parts) out.push({ text: p, heading })
  }
  return out
}

/** Lowercase word tokens (letters, digits, inner apostrophes and hyphens). */
export const words = (text) => (String(text).toLowerCase().match(/\p{L}[\p{L}\p{N}'’-]*|\p{N}+(?:[.,]\p{N}+)*/gu) || []).map((w) => w.replace(/^['’-]+|['’-]+$/g, '')).filter(Boolean)

const SUFFIXES = ['ization', 'isation', 'ational', 'ations', 'ation', 'ments', 'ment', 'ities', 'ity', 'ings', 'ing', 'ness', 'ers', 'ies', 'ied', 'ed', 'es', 'ly', 'er', 'al', 's']
/** A small suffix-stripping stemmer: good enough to match "cells" with "cell" and "dividing" with "divided". */
export function stem(word) {
  let w = word.toLowerCase().replace(/['’]s$/, '')
  if (w.length <= 3 || !/^[a-z]+$/.test(w)) return w
  for (const suf of SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = suf === 'ies' || suf === 'ied' || suf === 'ities' ? w.slice(0, -suf.length) + (suf === 'ities' ? 'ity' : 'y') : w.slice(0, -suf.length)
      break
    }
  }
  if (/(.)\1$/.test(w) && !/(ss|ll|zz)$/.test(w)) w = w.slice(0, -1)
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

/** Content words (no stop words) as stems. */
export const contentStems = (text) => words(text).filter((w) => !STOP.has(w) && w.length > 2).map(stem)

const PRONOUN_START = /^(?:he|she|it|they|we|you|i|this|that|these|those|there|here|what|which|who|its|his|her|their|our|my|your|some|many|most|each|both|all|such|one)\b/i
const cleanTerm = (t) => t.replace(/^(?:the|a|an)\s+/i, '').replace(/^["'“‘(]+|["'”’)]+$/g, '').replace(/[.,;:!?]+$/, '').trim()
const cleanDef = (d) => d.replace(/^(?:a|an|the)\s+(?=\S)/i, (m) => m).replace(/[\s.;]+$/, '').trim()
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const wc = (s) => s.trim().split(/\s+/).length

const DEF_PATTERNS = [
  // "X is defined as Y", "X can be defined as Y", "X is known as Y"
  { re: /^(.{2,80}?)\s+(?:is|are)\s+(?:formally\s+)?defined\s+as\s+(.{8,})$/i, kind: 'defined' },
  { re: /^(.{2,80}?)\s+can\s+be\s+(?:defined|described)\s+as\s+(.{8,})$/i, kind: 'defined' },
  { re: /^(.{2,80}?)\s+(?:refers?|refer)\s+to\s+(.{8,})$/i, kind: 'refers' },
  { re: /^(.{2,80}?)\s+(?:means?|stands?\s+for|denotes?)\s+(.{4,})$/i, kind: 'means' },
  { re: /^(.{2,80}?)\s+(?:is|are)\s+the\s+(?:process|study|science|method|act|ability|measure|branch|movement|state|property|tendency|rate|amount|quantity)\s+(?:of|by which|in which|that|which|to)\s+(.{6,})$/i, kind: 'process', keepPrefix: true },
  { re: /^(.{2,80}?)\s+(?:is|are)\s+((?:an?|the)\s+.{12,})$/i, kind: 'is-a' },
  { re: /^(.{2,60}?)\s+(?:is|are)\s+(?:used|found|made|formed|produced|caused|located|responsible)\s+(.{6,})$/i, kind: 'is-x', keepPrefix: true },
  { re: /^(\S+(?:\s+\S+){0,2})\s+(?:is|are)\s+((?!not|also|often|usually|very|more|less|likely|important|optimal|able|only)\p{L}.{22,})$/iu, kind: 'is-loose', low: true },
]
const CALLED_RE = /^(.{12,}?)\s+(?:is|are)\s+(?:called|termed|known\s+as|named)\s+(.{2,70})$/i

/**
 * Find "term - definition" pairs in text. Handles lines like "Mitosis: cell division", "Term - meaning", "Term = meaning"
 * and sentences like "X is a ...", "X refers to ...", "X is defined as ...", "The process ... is called X".
 * -> [{term, definition, sentence, kind}] in the order they appear, without duplicate terms.
 */
export function extractDefinitions(text) {
  const out = []
  const seen = new Set()
  const push = (term, definition, sentence, kind, low = false) => {
    term = cleanTerm(term)
    definition = cleanDef(definition)
    if (!term || !definition) return
    const tw = wc(term)
    if (tw > 7 || term.length > 70 || term.length < 2 || wc(definition) < 2 || !/\p{L}/u.test(term) || (kind !== 'line' && /\d/.test(term))) return
    if (PRONOUN_START.test(term) || STOP.has(term.toLowerCase())) return
    const key = term.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ term, definition: upperFirst(definition), sentence, kind, low })
  }
  // 1) delimited lines
  const lineRe = /^\s*(?:[-*+•·▪●]\s+|\d{1,3}[.)]\s+)?(?:\*\*|__)?([^:=→\t|–\u2014]{2,70}?)(?:\*\*|__)?\s*(?::|=|\s-\s|\s–\s|\s\u2014\s|→|->|\t|\s\|\s)\s*(.{3,})$/
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const m = lineRe.exec(raw)
    if (!m) continue
    const left = stripMd(m[1]), right = m[2].trim()
    if (!left || wc(left) > 7 || /[.!?]$/.test(left) || /^(?:note|example|e\.g|eg|i\.e|ie|source|hint|tip|step|figure|fig|table|q|a|ans|question|answer)\b/i.test(left)) continue
    if (/^https?:/i.test(right) || /^\d+$/.test(right)) continue
    push(left, stripMd(right), stripMd(raw), 'line')
  }
  // 2) sentence patterns
  for (const { text: s } of splitSentences(text)) {
    const sent = s.replace(/\s+/g, ' ').trim()
    if (sent.length < 20 || sent.length > 400 || sent.endsWith('?')) continue
    const called = CALLED_RE.exec(sent)
    if (called) { push(called[2], called[1], sent, 'called'); continue }
    for (const p of DEF_PATTERNS) {
      const m = p.re.exec(sent)
      if (!m) continue
      let term = m[1], def = m[2]
      if (p.keepPrefix) def = sent.slice(m[1].length).replace(/^\s*(?:is|are)\s+/i, '')
      // sentence subjects that are a whole clause are not terms
      if (/[,;]/.test(term) && wc(term) > 3) continue
      if (/\b(?:because|when|if|while|although|since|which|that)\b/i.test(term)) continue
      push(term, def, sent, p.kind, !!p.low)
      break
    }
  }
  return out
}

const NUM_RE = /(?<![\p{L}\p{N}.,])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|percent|per cent|degrees?|°[CF]?|km|cm|mm|m|kg|mg|g|ml|l|s|ms|hz|khz|mhz|ghz|years?|yrs?|days?|hours?|hrs?|minutes?|mins?|seconds?|bc|ad|bce|ce|million|billion|trillion|thousand|crore|lakh|mol|kj|kcal|j|w|v|a|n|pa|atm|rpm|mph|km\/h|m\/s))?(?![\p{L}\p{N}])/giu

/** Sentences containing a number or year, with the numbers found. -> [{sentence, numbers: [string]}] */
export function extractFacts(text) {
  const out = []
  for (const { text: s } of splitSentences(text)) {
    if (s.length < 25 || s.length > 300 || s.endsWith('?')) continue
    const nums = [...s.matchAll(NUM_RE)].map((m) => m[0].trim()).filter((n) => !/^\d$/.test(n) || /[a-z%°]/i.test(n))
    if (nums.length) out.push({ sentence: s, numbers: [...new Set(nums)] })
  }
  return out
}

/** Choose the most quiz-worthy number from a sentence's numbers: years, percentages and measurements before small bare numbers. */
export function pickNumber(numbers) {
  const score = (n) => (/^(?:1\d{3}|2[01]\d{2})$/.test(n) ? 5 : /%|percent/i.test(n) ? 4 : /[a-z°]/i.test(n) ? 3.5 : /,/.test(n) ? 3 : /^\d{3,}/.test(n) ? 2.5 : /^\d{1,2}$/.test(n) ? (Number(n) > 31 ? 1.5 : 0.5) : 1)
  return [...numbers].sort((a, b) => score(b) - score(a))[0]
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Replace the first (or all) whole-word occurrences of `term` in `sentence` with a blank. -> {text, found} */
export function blankOut(sentence, term, { all = true, blank = '________' } = {}) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}-])${escRe(term).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}]|-\\p{L})`, all ? 'giu' : 'iu')
  let found = false
  const text = sentence.replace(re, () => { found = true; return blank })
  return { text, found }
}

/** Key terms ranked by importance. -> [{term, score, count, kind}] */
export function keyTerms(text, limit = 30) {
  const sents = splitSentences(text)
  const all = sents.map((s) => s.text).join(' ')
  const cands = new Map()
  const bump = (term, weight, kind) => {
    const key = term.toLowerCase()
    const c = cands.get(key) || { term, count: 0, score: 0, kind }
    c.count++; c.score += weight
    if (kind === 'proper' || kind === 'acronym') c.kind = kind
    cands.set(key, c)
  }
  // single words and word pairs by frequency
  const toks = words(all)
  const isContent = (w) => !STOP.has(w) && !NOT_TERMS.has(w) && w.length > 3 && !/^\d/.test(w)
  const freq = new Map()
  for (const w of toks) if (isContent(w)) { const s = stem(w); freq.set(s, (freq.get(s) || 0) + 1) }
  const firstForm = new Map()
  for (const w of toks) if (isContent(w) && !firstForm.has(stem(w))) firstForm.set(stem(w), w)
  for (const [s, n] of freq) if (n >= 2) { const f = firstForm.get(s); bump(f, n, 'word'); cands.get(f.toLowerCase()).count = n }
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i], b = toks[i + 1]
    if (isContent(a) && isContent(b)) bump(`${a} ${b}`, 2.2, 'phrase')
  }
  for (const [k, c] of [...cands]) if (c.kind === 'phrase' && c.count < 2) cands.delete(k)
  // capitalised names (not just sentence starts) and acronyms
  for (const s of sents) {
    for (const m of s.text.matchAll(/\b((?:[A-Z][\p{L}'’-]+)(?:\s+(?:of|the|de|and|for)\s+[A-Z][\p{L}'’-]+|\s+[A-Z][\p{L}'’-]+)*)\b/gu)) {
      let t = m[1]
      // drop leading stop words ("The French Revolution" -> "French Revolution") and ignore a lone capitalised first word
      while (t && STOP.has(t.split(/\s+/)[0].toLowerCase())) t = t.split(/\s+/).slice(1).join(' ')
      if (!t || t.length < 3 || NOT_TERMS.has(t.toLowerCase()) || STOP.has(t.toLowerCase())) continue
      if (m.index === 0 && wc(t) < 2) continue
      bump(t, 2.5 + wc(t) * 0.6, 'proper')
    }
    for (const m of s.text.matchAll(/\b[A-Z]{2,6}s?\b/g)) if (!STOP.has(m[0].toLowerCase())) bump(m[0], 3, 'acronym')
  }
  // terms that have definitions matter most
  for (const d of extractDefinitions(text)) bump(d.term, 6, d.term.length < 6 && /^[A-Z]+$/.test(d.term) ? 'acronym' : 'defined')
  const ranked = [...cands.values()].map((c) => ({ ...c, score: c.score * (1 + 0.25 * (wc(c.term) - 1)) })).sort((a, b) => b.score - a.score)
  // drop single words swallowed by a stronger phrase containing them
  const picked = []
  for (const c of ranked) {
    const low = c.term.toLowerCase()
    if (picked.some((p) => p.term.toLowerCase() !== low && (p.term.toLowerCase().includes(low) && wc(c.term) === 1 && p.score >= c.score * 0.6))) continue
    picked.push(c)
    if (picked.length >= limit) break
  }
  return picked
}

/** Extractive summary: the n most central sentences, in their original order. */
export function summarize(text, n = 5) {
  const sents = splitSentences(text).filter((s) => s.text.length > 30 && wc(s.text) >= 6 && !s.text.endsWith('?'))
  if (sents.length <= n) return sents.map((s) => s.text)
  const tf = new Map()
  for (const s of sents) for (const st of new Set(contentStems(s.text))) tf.set(st, (tf.get(st) || 0) + 1)
  const scored = sents.map((s, i) => {
    const st = [...new Set(contentStems(s.text))]
    let sc = st.reduce((t, w) => t + (tf.get(w) > 1 ? tf.get(w) : 0.2), 0) / Math.sqrt(st.length || 1)
    if (i < 3) sc *= 1.25 - i * 0.07
    if (/\b(?:is|are)\s+(?:defined|called|known|the)\b|\b(?:important|key|main|primary|essential|therefore|thus|in summary|in conclusion)\b/i.test(s.text)) sc *= 1.25
    if (wc(s.text) > 40) sc *= 0.8
    return { s, i, sc }
  })
  return scored.sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.s.text)
}

/** Deterministic pseudo random generator (so "Another set" can reshuffle with a new seed). */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s >>> 0) / 4294967296 }
}
export function shuffle(arr, rand = Math.random) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

/** Does `text` mention the answer (loosely: case, punctuation, plural and word-order insensitive)? */
export function sameAnswer(given, expected) {
  const norm = (s) => words(String(s).replace(/[^\p{L}\p{N}\s%.,-]/gu, ' ')).map((w) => stem(w)).filter((w) => w && !['the', 'a', 'an'].includes(w))
  const a = norm(given), b = norm(expected)
  if (!a.length || !b.length) return false
  if (a.join(' ') === b.join(' ')) return true
  const sa = new Set(a), sb = new Set(b)
  const inter = [...sb].filter((w) => sa.has(w)).length
  if (b.length >= 2) return inter / sb.size >= 0.8 && a.length <= b.length + 2
  // single word: allow one typo for words of 6+ letters
  return editDistance(a.join(''), b.join('')) <= (b.join('').length >= 6 ? 1 : 0)
}
export function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

/** Parse "term - definition" / CSV / TSV pasted text into [{front, back}]. */
export function parsePairs(text) {
  const out = []
  const rows = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim())
  for (const raw of rows) {
    let parts
    if (raw.includes('\t')) parts = raw.split('\t')
    else if (/^"[^"]*"\s*,/.test(raw) || (raw.includes(',') && raw.split(',').length === 2 && !/\s-\s|:/.test(raw))) parts = splitCsvLine(raw)
    else {
      const m = /^(.+?)\s+(?:-|–|\u2014|=|:|→|->)\s+(.+)$/.exec(raw) || /^([^:=]{1,80}?)\s*[:=]\s*(.+)$/.exec(raw)
      parts = m ? [m[1], m[2]] : null
    }
    if (!parts || parts.length < 2) continue
    const front = stripMd(parts[0]).replace(/^"|"$/g, '').trim(), back = parts.slice(1).join(' ').replace(/^"|"$/g, '').trim()
    if (front && back) out.push({ front, back })
  }
  return out
}
function splitCsvLine(line) {
  const out = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c } else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}
