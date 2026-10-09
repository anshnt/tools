// Question builders on top of _text.js: flashcards, fill-in-the-blank, short-answer and multiple-choice questions made locally from notes.
import { splitSentences, extractDefinitions, extractFacts, keyTerms, blankOut, pickNumber, rng, shuffle, stem, words, STOP } from './_text.js'

const BLANK = '________'
const trim = (s, n = 150) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…')
const lower1 = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const sameTerm = (a, b) => stem(a.toLowerCase()) === stem(b.toLowerCase())

/** Abbreviations written as "Long Name (ABBR)". -> [{abbr, full}] */
export function extractAbbreviations(text) {
  const out = [], seen = new Set()
  for (const m of String(text).matchAll(/((?:[A-Za-z][\p{L}-]+\s+){1,6}[A-Za-z][\p{L}-]+)\s*\(([A-Z][A-Za-z]{1,7})\)/gu)) {
    const abbr = m[2]
    // the abbreviation must plausibly be made of the initials of the long name
    const initials = m[1].split(/\s+/).map((w) => w[0].toUpperCase()).join('')
    if (!initials.includes(abbr.toUpperCase().slice(0, 2)) && !initials.endsWith(abbr.toUpperCase())) continue
    const full = m[1].split(/\s+/).slice(-abbr.length - 1).join(' ')
    if (seen.has(abbr)) continue
    seen.add(abbr)
    out.push({ abbr, full: m[1].replace(/^(?:the|a|an)\s+/i, '') })
  }
  return out
}

/** Flashcards: [{front, back, kind}] */
export function buildCards(text, { max = 40 } = {}) {
  const defs = extractDefinitions(text)
  const cards = []
  const used = new Set()
  const add = (front, back, kind) => {
    const k = front.toLowerCase()
    if (used.has(k) || !front.trim() || !back.trim()) return
    used.add(k)
    cards.push({ front, back, kind })
  }
  for (const d of defs.filter((x) => !x.low)) add(d.term, d.definition, 'definition')
  for (const a of extractAbbreviations(text)) add(`What does ${a.abbr} stand for?`, a.full, 'abbreviation')
  for (const d of defs.filter((x) => x.low)) add(d.term, d.definition, 'definition')
  for (const f of extractFacts(text)) {
    const n = pickNumber(f.numbers)
    if (/^\d{1,2}$/.test(n)) continue
    const { text: q, found } = blankOut(f.sentence, n, { all: false, blank: BLANK })
    if (found) add(q, n, 'fact')
  }
  if (cards.length < max) {
    const terms = keyTerms(text, 40).filter((t) => t.kind !== 'word' || t.count >= 3)
    const defSentences = new Set(defs.map((d) => d.sentence))
    for (const sent of splitSentences(text)) {
      if (cards.length >= max) break
      if (sent.text.length < 40 || sent.text.length > 220 || defSentences.has(sent.text)) continue
      for (const x of terms) {
        if (x.count > 6) continue
        const m = new RegExp(`(?<![\\p{L}])${x.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').exec(sent.text)
        if (!m) continue
        const { text: q, found } = blankOut(sent.text, m[0], { all: true, blank: BLANK })
        if (found && (q.match(/_{8}/g) || []).length === 1) add(q, m[0], 'cloze')
        break
      }
    }
  }
  return cards.slice(0, max)
}

const loose0 = (text) => extractDefinitions(text)
/** Sentences suited to a blank, each with the term (or number) to remove. */
function blankCandidates(text) {
  const defs = extractDefinitions(text)
  const defTerms = new Set(defs.filter((d) => !d.low).map((d) => d.term.toLowerCase()))
  const terms = keyTerms(text, 50).filter((t) => (t.kind !== 'word' && t.kind !== 'phrase') || t.count >= 3)
  const out = []
  const sents = splitSentences(text)
  const lineDefs = new Set(defs.concat(loose0(text)).filter((d) => d.kind === 'line').map((d) => d.sentence))
  const factSet = new Map(extractFacts(text).map((f) => [f.sentence, f.numbers]))
  sents.forEach((s, idx) => {
    const t = s.text
    if (t.length < 45 || t.length > 260 || t.endsWith('?') || lineDefs.has(t)) return
    let best = null
    for (const term of terms) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}-])${term.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}]|-\\p{L})`, 'iu')
      const m = re.exec(t)
      if (!m) continue
      const occurrences = (t.match(new RegExp(re.source, 'giu')) || []).length
      if (occurrences > 2) continue
      const score = (defTerms.has(term.term.toLowerCase()) ? 5 : 0) + term.score / 10 + (term.kind === 'proper' || term.kind === 'acronym' ? 1.5 : 0) - (term.count > 6 ? 3 : 0)
      if (!best || score > best.score) best = { term: term.term, answer: m[0], score, kind: 'term' }
    }
    const nums = factSet.get(t)
    const num = nums && pickNumber(nums)
    if (num && !/^\d{1,2}$/.test(num) && (!best || best.score < 7)) best = { term: num, answer: num, score: 6, kind: 'number' }
    if (best) out.push({ sentence: t, idx, heading: s.heading, ...best })
  })
  return out
}

/** Fill-in-the-blank items: [{q, a, source, kind}] */
export function buildBlanks(text, { max = 15, seed = 1 } = {}) {
  const rand = rng(seed)
  let cands = blankCandidates(text)
  if (seed > 1) cands = shuffle(cands, rand)
  const out = [], usedAns = new Set()
  for (const c of cands.sort((a, b) => (seed > 1 ? 0 : a.idx - b.idx))) {
    if (out.length >= max) break
    const key = c.answer.toLowerCase()
    if (usedAns.has(key)) continue
    const { text: q, found } = blankOut(c.sentence, c.answer, { all: true, blank: BLANK })
    if (!found) continue
    usedAns.add(key)
    out.push({ q, a: c.answer, source: c.sentence, kind: c.kind })
  }
  return out
}

/** Short-answer questions: [{q, a, kind}] */
export function buildShort(text, { max = 10, seed = 1 } = {}) {
  const rand = rng(seed)
  const defs = extractDefinitions(text).filter((d) => !d.low || wordsN(d.definition) >= 6)
  const stems = ['What is {t}?', 'Define {t}.', 'Explain what is meant by {t}.', 'Describe {t} in your own words.']
  const out = []
  defs.forEach((d, i) => {
    const tpl = stems[(i + Math.floor(rand() * 3)) % stems.length]
    const plural = /s$/i.test(d.term) && !/(?:ss|us|is)$/i.test(d.term)
    const q = d.kind === 'called' ? `What is the term for: ${lower1(d.definition)}?` : plural && tpl === 'What is {t}?' ? `What are ${d.term.toLowerCase() === d.term ? d.term : d.term}?` : tpl.replace('{t}', d.term)
    out.push({ q, a: d.definition, kind: 'definition' })
  })
  for (const a of extractAbbreviations(text)) out.push({ q: `What does ${a.abbr} stand for?`, a: cap(a.full), kind: 'abbreviation' })
  if (out.length < max) {
    const CONNECTOR = /\b(?:because|due to|so that|in order to|which led to|which caused|which angered|as a result|leading to|resulting in|results in|leads to)\b/i
    for (const s of splitSentences(text)) {
      if (out.length >= max) break
      if (s.text.length < 60 || s.text.length > 260 || !CONNECTOR.test(s.text)) continue
      const m = CONNECTOR.exec(s.text)
      // "A because B" -> ask about A; "Because B, A" -> ask about A (the part after the first comma)
      const main = (m.index < 3 ? s.text.slice(s.text.indexOf(',') + 1) : s.text.slice(0, m.index)).replace(/[\s,;]+$/, '').trim()
      if (wordsN(main) < 4) continue
      out.push({ q: `Explain why this happened: "${trim(main.replace(/^[a-z]/, (c) => c.toUpperCase()), 120)}".`, a: s.text, kind: 'explain' })
    }
  }
  return (seed > 1 ? shuffle(out, rand) : out).slice(0, max)
}
const wordsN = (s) => s.trim().split(/\s+/).length

/** Numbers that look like the answer but are wrong. */
function numberDistractors(ans, rand) {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(.*)$/.exec(ans.trim())
  if (!m) return []
  const raw = m[1].replace(/,/g, '') + (m[2] || ''), rest = m[3] || ''
  const n = parseFloat(raw), dec = (m[2] || '').length - 1, comma = m[1].includes(',')
  const fmt = (v) => {
    const s = dec > 0 ? v.toFixed(dec) : String(Math.round(v))
    return (comma ? Number(s).toLocaleString('en-US', { maximumFractionDigits: Math.max(0, dec) }) : s) + rest
  }
  const isYear = Number.isInteger(n) && n >= 1000 && n <= 2999 && !rest.trim()
  const isPct = /%|percent/i.test(rest)
  const small = Number.isInteger(n) && n < 100 && !isPct
  const outs = new Set()
  let tries
  if (isYear) tries = [-10, 5, 12, -25, 20, -3, 50, 100, -50, 8, -15]
  else if (isPct) tries = [-30, -20, -10, -5, 5, 10, 15, 20, 25, 30]
  else if (small) tries = [-5, -3, -2, -1, 1, 2, 3, 5, 7, 10, -10]
  else tries = [0.5, 2, 1.1, 0.9, 1.25, 0.75, 1.5, 3, 0.25]
  for (const t of shuffle(tries, rand)) {
    const v = isYear || isPct || small ? n + t : n * t
    if (!Number.isFinite(v) || v <= 0 || (isYear && v > 2999) || (isPct && v > 100)) continue
    const f = fmt(v)
    if (f !== ans && f.replace(/[^0-9.]/g, '') !== String(raw)) outs.add(f)
    if (outs.size >= 6) break
  }
  return [...outs]
}

/** Multiple-choice questions. Options always include the right answer once. -> [{q, options: [string], answer: index, explanation, kind}] */
export function buildMcqs(text, { max = 10, seed = 1, options = 4 } = {}) {
  const rand = rng(seed * 7919 + 13)
  const defs = extractDefinitions(text).filter((d) => !d.low)
  const loose = extractDefinitions(text).filter((d) => d.low)
  const terms = keyTerms(text, 60)
  const strongTerms = [...new Set([...defs.map((d) => d.term), ...loose.map((d) => d.term), ...terms.filter((t) => ['defined', 'proper', 'acronym', 'phrase'].includes(t.kind)).map((t) => t.term)])]
  const weakTerms = terms.filter((t) => t.kind === 'word' && t.count >= 3 && t.term.length >= 5).map((t) => t.term)
  const termPool = strongTerms.length >= 6 ? strongTerms : [...new Set([...strongTerms, ...weakTerms])]
  const items = []
  const take = (arr, n) => arr.slice(0, n)

  const finish = (q, correct, wrongPool, explanation, kind) => {
    const wrong = []
    for (const w of shuffle(wrongPool, rand)) {
      if (wrong.length >= options - 1) break
      if (w.toLowerCase() === correct.toLowerCase() || sameTerm(w, correct) || wrong.some((x) => x.toLowerCase() === w.toLowerCase())) continue
      wrong.push(w)
    }
    if (wrong.length < options - 1) return null
    const opts = shuffle([correct, ...wrong], rand)
    return { q, options: opts, answer: opts.indexOf(correct), explanation, kind }
  }

  // 1) "Which term is described as ...?"  and  "Which best describes X?"
  defs.forEach((d, i) => {
    if (d.definition.length > 220) return
    if (i % 2 === 0) {
      const ok = (t) => !sameTerm(t, d.term) && wordsN(t) <= wordsN(d.term) + 2 && !d.definition.toLowerCase().includes(t.toLowerCase())
      const byLen = (x, y) => Math.abs(x.length - d.term.length) - Math.abs(y.length - d.term.length)
      // other defined terms make the best distractors; fall back to other key terms of the same kind (name vs common word)
      const proper = /^\p{Lu}/u.test(d.term) && wordsN(d.term) > 1
      const fromDefs = [...defs, ...loose].map((x) => x.term).filter(ok).sort(byLen)
      const fromTerms = termPool.filter((t) => ok(t) && !fromDefs.includes(t) && (/^\p{Lu}/u.test(t) === /^\p{Lu}/u.test(d.term) || proper) && !/^[a-z]+ [a-z]+$/.test(t)).sort(byLen)
      const similar = [...new Set([...fromDefs, ...fromTerms])].slice(0, 12)
      const it = finish(`Which term is described as: "${trim(d.definition, 170)}"?`, d.term, similar, `${d.term}: ${d.definition}`, 'definition')
      if (it) items.push(it)
    } else {
      const wrongDefs = defs.filter((x) => x !== d).map((x) => trim(x.definition, 130))
      const it = finish(`Which of the following best describes ${d.term}?`, trim(d.definition, 130), wrongDefs, `${d.term}: ${d.definition}`, 'definition')
      if (it) items.push(it)
    }
  })

  // 2) cloze questions with distractors from other key terms or nearby numbers
  for (const c of blankCandidates(text)) {
    const { text: q, found } = blankOut(c.sentence, c.answer, { all: true, blank: BLANK })
    if (!found) continue
    let pool
    if (c.kind === 'number') pool = numberDistractors(c.answer, rand)
    else {
      const isProper = /^\p{Lu}/u.test(c.answer)
      pool = termPool.filter((t) => !c.sentence.toLowerCase().includes(t.toLowerCase()) && (/^\p{Lu}/u.test(t) === isProper || wordsN(t) === wordsN(c.answer)))
        .sort((a, b) => Math.abs(wordsN(a) - wordsN(c.answer)) - Math.abs(wordsN(b) - wordsN(c.answer)) || Math.abs(a.length - c.answer.length) - Math.abs(b.length - c.answer.length)).slice(0, 14)
      if (/^\p{Ll}/u.test(c.answer)) pool = pool.map((t) => (/^\p{Lu}[\p{Ll}]+$/u.test(t) && !defs.some((d) => d.term === t) ? t.toLowerCase() : t))
    }
    const it = finish(q, c.answer, pool, c.sentence, 'cloze')
    if (it && !items.some((x) => x.q === it.q)) items.push(it)
  }
  const ordered = seed > 1 ? shuffle(items, rand) : items
  return take(ordered, max)
}

/** Distractors helper exported for tests. */
export const _numberDistractors = numberDistractors
export { BLANK, STOP, words }
