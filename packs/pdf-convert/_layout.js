// PDF layout analysis on top of pdf.js text items: lines, columns (XY-cut), headings (by font size and weight), lists, code, tables,
// repeating headers/footers and paragraph joining. Used by PDF to Word, Markdown, Text, HTML and Excel. Pure functions, no DOM except pdf.js.
// Coordinates are PDF points with the origin at the top-left of the page as displayed (rotation applied).

import { pdfjs } from '../../lib/libs.js'
import { renderPage } from '../../lib/pdf.js'

const fontCache = new WeakMap()
const BOLD = /bold|black|heavy|semibold|demi|extrabold|ultra/i
const ITALIC = /italic|oblique|slanted|kursiv/i
const MONO = /mono|courier|consolas|menlo|lucida\s*console|typewriter|fixed|code|inconsolata|source\s*code/i
const SERIF = /times|georgia|garamond|palatino|cambria|book|serif(?!.*sans)|minion|baskerville|century|roman/i

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
const round1 = (v) => Math.round(v * 2) / 2

function fontInfo(page, doc, id) {
  let cache = fontCache.get(doc)
  if (!cache) fontCache.set(doc, (cache = new Map()))
  if (cache.has(id)) return cache.get(id)
  let name = ''
  try { if (page.commonObjs.has(id)) name = page.commonObjs.get(id)?.name || '' } catch { /* font not resolved */ }
  name = name.replace(/^[A-Z]{6}\+/, '')
  const info = { name, bold: BOLD.test(name) || /[-,]B$/.test(name), italic: ITALIC.test(name) || /[-,]I$/.test(name), mono: MONO.test(name), serif: SERIF.test(name) }
  if (name) cache.set(id, info) // only cache resolved fonts
  return info
}

/** Read one page into positioned text items. Rotated (non-horizontal) text, such as watermarks and side labels, is skipped. */
export async function readPage(doc, n, { fonts = true, links = true } = {}) {
  const page = await doc.getPage(n)
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  if (fonts) { try { await page.getOperatorList() } catch { /* styles are optional */ } }
  const m = vp.transform
  const items = []
  let skipped = 0
  for (const it of tc.items) {
    if (!('str' in it) || !it.str || !it.str.trim()) continue
    const t = it.transform
    const x = m[0] * t[4] + m[2] * t[5] + m[4], y = m[1] * t[4] + m[3] * t[5] + m[5]
    const dx = m[0] * t[0] + m[2] * t[1], dy = m[1] * t[0] + m[3] * t[1]
    const ux = m[0] * t[2] + m[2] * t[3], uy = m[1] * t[2] + m[3] * t[3]
    const fs = Math.hypot(ux, uy) || it.height || 10
    if (Math.abs(Math.atan2(dy, dx)) > 0.2) { skipped++; continue }
    const f = fonts ? fontInfo(page, doc, it.fontName) : {}
    items.push({ str: it.str, x, y, w: it.width, fs, bold: !!f.bold, italic: !!f.italic, mono: !!f.mono, serif: !!f.serif, font: f.name || '' })
  }
  let urls = []
  if (links) {
    try {
      urls = (await page.getAnnotations()).filter((a) => a.subtype === 'Link' && (a.url || a.unsafeUrl)).map((a) => {
        const r = vp.convertToViewportRectangle(a.rect)
        return { url: a.url || a.unsafeUrl, x0: Math.min(r[0], r[2]), x1: Math.max(r[0], r[2]), y0: Math.min(r[1], r[3]), y1: Math.max(r[1], r[3]) }
      })
    } catch { /* no annotations */ }
    for (const it of items) {
      const cx = it.x + it.w / 2, cy = it.y - it.fs * 0.3
      const l = urls.find((u) => cx >= u.x0 && cx <= u.x1 && cy >= u.y0 && cy <= u.y1)
      if (l) it.url = l.url
    }
  }
  // drop exact duplicates (fake bold drawn twice)
  const seen = new Set()
  const unique = items.filter((it) => { const k = `${it.str}|${Math.round(it.x)}|${Math.round(it.y)}`; if (seen.has(k)) return false; seen.add(k); return true })
  return { n, width: vp.width, height: vp.height, items: unique, skipped }
}

/** Read many pages. */
export async function readPages(doc, pageNumbers, { fonts = true, onProgress, signal } = {}) {
  const out = []
  for (let i = 0; i < pageNumbers.length; i++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    out.push(await readPage(doc, pageNumbers[i], { fonts }))
    onProgress?.((i + 1) / pageNumbers.length, `Reading page ${i + 1} of ${pageNumbers.length}`)
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0))
  }
  return out
}

// ---------------------------------------------------------------- lines

const styleKey = (it) => `${+it.bold}${+it.italic}${+it.mono}${+!!it.sup}${+!!it.sub}${it.url || ''}`

/** Merge items into display runs [{text, bold, italic, mono, sup, sub, url, fs}], inserting spaces where the gap between items shows a word break. */
export function runsOf(items) {
  const runs = []
  const push = (text, it) => {
    if (!text) return
    const last = runs[runs.length - 1]
    if (last && last.key === styleKey(it) && Math.abs(last.fs - it.fs) < 0.6) last.text += text
    else runs.push({ key: styleKey(it), text, bold: it.bold, italic: it.italic, mono: it.mono, sup: !!it.sup, sub: !!it.sub, url: it.url, fs: it.fs, font: it.font, serif: it.serif })
  }
  let prev = null
  for (const it of items) {
    if (prev) {
      const gap = it.x - (prev.x + prev.w)
      if (gap > it.fs * 0.15 && !/\s$/.test(prev.str) && !/^\s/.test(it.str)) push(' ', prev.url && it.url === prev.url ? prev : { ...prev, url: undefined })
    }
    push(it.str, it)
    prev = it
  }
  return runs
}

const textOf = (runs) => runs.map((r) => r.text).join('')

/** Group page items into lines (same baseline), sorted top to bottom, left to right. Superscripts and subscripts stay on their line. */
export function buildLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines = []
  for (const it of sorted) {
    let target = null
    for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
      const l = lines[k]
      const dy = Math.abs(it.y - l.y), big = Math.max(it.fs, l.fs), small = Math.min(it.fs, l.fs)
      if (dy <= 0.3 * big || (small <= 0.82 * big && dy <= 0.6 * big && it.x >= l.x0 - 1)) { target = l; break }
    }
    if (target) {
      target.items.push(it)
      if (it.fs > target.fs + 0.1) { target.fs = it.fs; target.y = it.y }
    } else lines.push({ y: it.y, fs: it.fs, items: [it] })
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x)
    for (const it of l.items) {
      if (it.fs <= l.fs * 0.82) { if (it.y < l.y - l.fs * 0.15) it.sup = true; else if (it.y > l.y + l.fs * 0.1) it.sub = true }
    }
    finishLine(l)
  }
  return lines.sort((a, b) => a.y - b.y)
}

function finishLine(l) {
  l.x0 = Math.min(...l.items.map((i) => i.x))
  l.x1 = Math.max(...l.items.map((i) => i.x + i.w))
  l.top = l.y - l.fs * 0.85
  l.bottom = l.y + l.fs * 0.25
  l.runs = runsOf(l.items)
  l.text = textOf(l.runs)
  const chars = l.items.reduce((n, i) => n + i.str.length, 0) || 1
  const weight = (f) => l.items.filter(f).reduce((n, i) => n + i.str.length, 0) / chars
  l.bold = weight((i) => i.bold) > 0.8
  l.italic = weight((i) => i.italic) > 0.8
  l.mono = weight((i) => i.mono) > 0.8
  return l
}

/** Split a line into cells wherever two neighbouring items are further apart than `gap` points. */
export function segmentLine(line, gap) {
  const segs = []
  let cur = null
  for (const it of line.items) {
    if (cur && it.x - cur.x1 <= gap) { cur.items.push(it); cur.x1 = Math.max(cur.x1, it.x + it.w) }
    else { cur = { items: [it], x0: it.x, x1: it.x + it.w }; segs.push(cur) }
  }
  for (const s of segs) { s.runs = runsOf(s.items); s.text = textOf(s.runs).trim(); s.fs = Math.max(...s.items.map((i) => i.fs)); s.bold = s.items.every((i) => i.bold) }
  return segs
}

// ---------------------------------------------------------------- tables

/** Find column bands (as [x0, x1] pairs) from a set of table rows using the rows that have the usual number of cells as the grid. */
function columnBands(rows) {
  const counts = rows.filter((r) => r.segs.length >= 2).map((r) => r.segs.length)
  const freq = new Map()
  for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1)
  let k = 0, best = 0
  for (const [c, n] of freq) if (n > best || (n === best && c > k)) { best = n; k = c }
  let core = rows.filter((r) => r.segs.length === k)
  if (core.length < 2) core = rows.filter((r) => r.segs.length >= 2)
  const iv = core.flatMap((r) => r.segs.map((s) => [s.x0, s.x1])).sort((a, b) => a[0] - b[0])
  const bands = []
  for (const [a, b] of iv) {
    const last = bands[bands.length - 1]
    if (last && a < last[1] - 0.5) last[1] = Math.max(last[1], b)
    else bands.push([a, b])
  }
  return bands
}

/**
 * Detect tables in a page's lines (text laid out in aligned rows and columns).
 * -> {tables: [{rows: [[string]], bold: bool[] (first row), x0, x1, y0, y1, merges: [{r, c, span}], cols}], used: Set(line)}
 */
export function detectTables(lines, { cellGap = 1.0, minRows = 3, minCols = 2 } = {}) {
  const rows = lines.map((l) => ({ line: l, segs: l.mono ? [{ x0: l.x0, x1: l.x1, items: l.items, text: l.text, runs: l.runs, fs: l.fs, bold: false }] : segmentLine(l, Math.max(3, l.fs * cellGap)) }))
  const tables = [], used = new Set()
  let i = 0
  while (i < rows.length) {
    if (rows[i].segs.length < 2) { i++; continue }
    let j = i + 1
    while (j < rows.length) {
      const r = rows[j], p = rows[j - 1]
      if (r.line.y - p.line.y > 3 * Math.max(r.line.fs, p.line.fs)) break
      if (r.segs.length >= 2) { j++; continue }
      const starts = rows.slice(i, j).flatMap((x) => x.segs.map((s) => s.x0))
      const s0 = r.segs[0]
      const next = rows[j + 1]
      if (next && next.segs.length >= 2 && starts.some((x) => Math.abs(x - s0.x0) < r.line.fs * 0.9)) { j++; continue }
      if (starts.some((x) => Math.abs(x - s0.x0) < r.line.fs * 0.9) && s0.x1 - s0.x0 < 0.45 * (Math.max(...rows.slice(i, j).flatMap((x) => x.segs.map((s) => s.x1))) - Math.min(...starts))) { j++; continue }
      break
    }
    while (j - 1 > i && rows[j - 1].segs.length < 2) j--
    const run = rows.slice(i, j)
    const multi = run.filter((r) => r.segs.length >= 2).length
    const bands = run.length >= 2 ? columnBands(run) : []
    if (run.length >= minRows && multi >= 2 && bands.length >= minCols && bands.length <= 24 && multi / run.length >= 0.55) {
      const t = buildTable(run, bands)
      if (!rejectTable(t)) { tables.push(t); for (const r of run) used.add(r.line) }
      i = j
    } else i++
  }
  return { tables, used }
}

const BULLET_ONLY = new RegExp(`^[-•◦▪●○■⁃·${String.fromCharCode(0x2013, 0x2014)}*]$`)
/** Text columns and bullet or number columns look like tables to the row detector but are not. */
function rejectTable(t) {
  const first = t.rows.map((r) => r[0].trim()).filter(Boolean)
  if (first.length >= Math.max(2, t.rows.length * 0.7)) {
    if (first.every((c) => BULLET_ONLY.test(c))) return true
    const nums = first.map((c) => (/^\(?(\d{1,2})[.)]?$/.exec(c) || [])[1]).map(Number)
    if (nums.length >= 2 && nums.every((n, k) => n && (k === 0 || n === nums[k - 1] + 1))) return true
  }
  const cells = t.rows.flat().filter(Boolean)
  const mean = cells.reduce((n, c) => n + c.length, 0) / Math.max(1, cells.length)
  return t.rows.length >= 4 && mean >= 28 && t.cols <= 3
}

function buildTable(run, bands) {
  const out = [], merges = [], bold = []
  const overlap = (s, b) => Math.min(s.x1, b[1]) - Math.max(s.x0, b[0])
  let prevCells = null, prevLine = null
  for (const r of run) {
    const cells = new Array(bands.length).fill('')
    let spans = []
    for (const s of r.segs) {
      let hit = bands.map((b, k) => [k, overlap(s, b)]).filter(([, o]) => o > 0).map(([k]) => k)
      if (!hit.length) {
        const c = (s.x0 + s.x1) / 2
        hit = [bands.reduce((bk, b, k) => (Math.abs((b[0] + b[1]) / 2 - c) < Math.abs((bands[bk][0] + bands[bk][1]) / 2 - c) ? k : bk), 0)]
      }
      const t = hit[0]
      cells[t] = cells[t] ? `${cells[t]} ${s.text}` : s.text
      if (hit.length > 1) spans.push({ c: t, span: hit.length })
    }
    const filled = cells.filter(Boolean).length
    // a one-cell row that continues the previous row's text in the same column is a wrapped cell
    if (r.segs.length === 1 && prevCells && filled === 1) {
      const c = cells.findIndex(Boolean)
      if (prevCells[c] && r.line.y - prevLine.y <= 1.7 * r.line.fs && Math.abs(r.segs[0].x0 - bands[c][0]) < r.line.fs * 0.9 && c > 0) {
        prevCells[c] += ` ${cells[c]}`
        prevLine = r.line
        continue
      }
    }
    out.push(cells)
    bold.push(r.segs.every((s) => s.bold))
    for (const sp of spans) merges.push({ r: out.length - 1, c: sp.c, span: sp.span })
    prevCells = cells
    prevLine = r.line
  }
  const all = run.flatMap((r) => r.segs)
  return {
    rows: out, boldRows: bold, merges, cols: bands.length, x0: Math.min(...all.map((s) => s.x0)), x1: Math.max(...all.map((s) => s.x1)),
    y0: run[0].line.top, y1: run[run.length - 1].line.bottom, y: run[0].line.y, lines: run.map((r) => r.line),
  }
}

// ---------------------------------------------------------------- reading order (columns)

/**
 * Split a page's boxes into reading groups. When narrow boxes leave a clear vertical gutter (two or three text columns),
 * each column is read top to bottom in turn, with full-width boxes (titles, captions, footers) acting as separators.
 * Anything else stays one group, so paragraphs, lists and code are never cut apart.
 */
function orderBoxes(boxes, minV, depth = 0) {
  const sortY = (arr) => [...arr].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  if (boxes.length < 6 || depth > 2) return [sortY(boxes)]
  const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1)), W = x1 - x0
  if (W < minV * 6) return [sortY(boxes)]
  // how many boxes cover each x; a gutter is a run of x covered by only a few boxes (titles and footers may cross it)
  const cover = new Int32Array(Math.ceil(W) + 2)
  for (const b of boxes) for (let x = Math.max(0, Math.floor(b.x0 - x0)); x <= Math.min(cover.length - 1, Math.ceil(b.x1 - x0)); x++) cover[x]++
  const thr = Math.max(1, Math.floor(boxes.length * 0.12))
  let best = null, start = -1
  for (let x = 0; x <= cover.length; x++) {
    const low = x < cover.length && cover[x] <= thr
    if (low && start < 0) start = x
    if (!low && start >= 0) {
      const a = start, b = x - 1
      if (b - a >= minV && a > W * 0.15 && b < W * 0.85 && (!best || b - a > best.b - best.a)) best = { a, b }
      start = -1
    }
  }
  if (!best) return [sortY(boxes)]
  const ga = x0 + best.a, gb = x0 + best.b, g = (ga + gb) / 2
  const crosses = (b) => b.x1 > ga + 1 && b.x0 < gb - 1
  const isNarrow = new Set(boxes.filter((b) => !crosses(b)))
  const leftN = [...isNarrow].filter((b) => (b.x0 + b.x1) / 2 < g).length
  if (leftN < 3 || isNarrow.size - leftN < 3) return [sortY(boxes)]
  const out = []
  let L = [], R = [], wide = []
  const flushCols = () => {
    if (L.length) out.push(...orderBoxes(L, minV, depth + 1))
    if (R.length) out.push(...orderBoxes(R, minV, depth + 1))
    L = []; R = []
  }
  const flushWide = () => { if (wide.length) out.push(wide); wide = [] }
  for (const b of sortY(boxes)) {
    if (isNarrow.has(b)) { flushWide(); ((b.x0 + b.x1) / 2 < g ? L : R).push(b) }
    else { flushCols(); wide.push(b) }
  }
  flushCols(); flushWide()
  return out
}

// ---------------------------------------------------------------- document analysis

const BULLET = /^\s*([\u2022\u25E6\u25AA\u25AB\u25A0\u25A1\u25CF\u25CB\u25C6\u25C7\u25B6\u25BA\u27A2\u27A4\u2713\u2714\u2043\u00B7\u2023\u25B8\u2219\u25AA]|[-\u2013\u2014*+])\s+(?=\S)/
const NUMBERED = /^\s*(\(?(\d{1,3}|[a-zA-Z]|[ivxlc]{1,5})[.)])\s+(?=\S)/

/** Does this line start a list item? -> {ordered, marker, textX} or null */
function listMarker(line, bodyFs) {
  const t = line.text
  let m = t.match(BULLET)
  let ordered = false
  if (!m) { m = t.match(NUMBERED); ordered = !!m }
  if (!m) {
    // a bare number or bullet drawn as its own item, followed by a clear gap ("1   Grow enterprise accounts")
    const a = line.items[0], b = line.items[1]
    const bare = a && b && /^\d{1,2}$/.exec(a.str.trim())
    if (bare && b.x - (a.x + a.w) > line.fs * 0.5 && b.x - (a.x + a.w) < line.fs * 4) {
      m = [`${a.str.trim()} `, a.str.trim()]
      ordered = true
    }
  }
  if (!m) return null
  if (ordered && m[2]) {
    const tok = m[2]
    if (/^[a-zA-Z]$/.test(tok) && line.fs > bodyFs * 1.1) return null
    if (/^\d+$/.test(tok) && +tok > 99) return null
  }
  // x where the text after the marker starts
  let textX = line.x0
  let acc = ''
  for (const it of line.items) {
    if (acc.length >= m[0].trimEnd().length) { textX = it.x; break }
    acc += it.str
    textX = it.x + it.w
  }
  return { ordered, marker: m[1].trim(), textX, strip: m[0].length - (m[0].length - m[0].trimStart().length) }
}

/** Remove the first `n` visible characters from runs (used to cut list markers). */
function cutRuns(runs, n) {
  const out = []
  let left = n
  for (const r of runs) {
    if (left <= 0) { out.push(r); continue }
    if (r.text.length <= left) { left -= r.text.length; continue }
    out.push({ ...r, text: r.text.slice(left) })
    left = 0
  }
  while (out.length && !out[0].text.trim()) out.shift()
  if (out.length) out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') }
  return out
}

/** Join lines' runs into paragraph runs, merging hyphenated words across line ends. */
export function joinRuns(lines, hyphens = true) {
  const out = []
  for (const l of lines) {
    const runs = l.runs.map((r) => ({ ...r }))
    if (!out.length) { out.push(...runs); continue }
    const last = out[out.length - 1]
    const first = runs[0]
    if (hyphens && first && /[A-Za-z\u00C0-\u024F]-$/.test(last.text) && /^[a-z\u00DF-\u00FF]/.test(first.text.trim())) {
      last.text = last.text.slice(0, -1)
      out.push(...runs)
    } else {
      if (!/\s$/.test(last.text) && !/^\s/.test(first?.text || '')) out.push({ ...last, text: ' ', url: undefined, key: '' })
      out.push(...runs)
    }
  }
  // coalesce neighbours with the same style
  const merged = []
  for (const r of out) {
    const p = merged[merged.length - 1]
    if (p && p.bold === r.bold && p.italic === r.italic && p.mono === r.mono && p.sup === r.sup && p.sub === r.sub && p.url === r.url && Math.abs(p.fs - r.fs) < 1.1) p.text += r.text
    else merged.push({ ...r })
  }
  return merged.filter((r) => r.text)
}

const normKey = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
const PAGE_NUM = /^(page\s*)?[-\u2013]?\s*\d{1,4}\s*([-\u2013]|(of|\/)\s*\d{1,4})?$/i

/** Flag lines that repeat at the top or bottom of many pages (running headers, footers, page numbers). Returns how many were removed. */
function stripHeadersFooters(pages) {
  if (pages.length < 2) return 0
  const counts = new Map()
  const edge = (p, l) => l.y < p.height * 0.1 || l.y > p.height * 0.92
  for (const p of pages) {
    const seen = new Set()
    for (const l of p.lines) if (edge(p, l)) { const k = normKey(l.text); if (k && !seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) || 0) + 1) } }
  }
  const need = Math.max(2, Math.ceil(pages.length * 0.5))
  let removed = 0
  for (const p of pages) {
    p.lines = p.lines.filter((l) => {
      if (!edge(p, l)) return true
      const k = normKey(l.text)
      const drop = (counts.get(k) || 0) >= need || (PAGE_NUM.test(l.text.trim()) && (counts.get('#') || 0) + (counts.get('page #') || 0) >= 2)
      if (drop) removed++
      return !drop
    })
  }
  return removed
}

/**
 * analyze(pageData[], opts) -> {pages: [{n, width, height, blocks}], body, removed, stats}
 * Blocks: {type: 'heading', level, runs} | {type: 'p', runs, align, indent} | {type: 'li', ordered, marker, level, runs}
 *       | {type: 'code', text} | {type: 'table', rows, boldRows, merges, cols}
 * opts: headings, boldHeadings, lists, tables, cellGap, minRows, removeHeaders, hyphens, joinPages, columns, headingRatio
 */
export function analyze(pageData, opts = {}) {
  const o = { headings: true, boldHeadings: true, lists: true, tables: true, cellGap: 1.0, minRows: 3, removeHeaders: true, hyphens: true, joinPages: true, columns: true, headingRatio: 1.15, ...opts }
  const pages = pageData.map((p) => ({ n: p.n, width: p.width, height: p.height, lines: buildLines(p.items), images: p.images || [], preBlocks: p.preBlocks }))
  // body size: the font size carrying the most characters
  const weight = new Map(), fontWeight = new Map()
  for (const p of pages) for (const l of p.lines) for (const it of l.items) {
    weight.set(round1(it.fs), (weight.get(round1(it.fs)) || 0) + it.str.length)
    if (it.font) fontWeight.set(it.font, (fontWeight.get(it.font) || 0) + it.str.length)
  }
  let body = 11, bw = 0
  for (const [s, w] of weight) if (w > bw) { bw = w; body = s }
  let bodyFont = '', fw = 0
  for (const [f, w] of fontWeight) if (w > fw) { fw = w; bodyFont = f }
  const removed = o.removeHeaders ? stripHeadersFooters(pages) : 0
  // heading sizes -> levels
  const headingSizes = new Map()
  const sizeSet = new Set()
  if (o.headings) {
    for (const p of pages) for (const l of p.lines) if (isBigText(l, body, o) && l.text.trim().length <= 160) sizeSet.add(round1(l.fs))
  }
  const sizes = [...sizeSet].sort((a, b) => b - a)
  sizes.forEach((s, i) => headingSizes.set(s, Math.min(i + 1, 4)))
  const ctx = { body, headingSizes, o, boldLevel: Math.min(sizes.length + 1, 5) }

  const result = pages.map((p) => {
    const ls = p.lines
    const bounds = ls.length ? { x0: Math.min(...ls.map((l) => l.x0)), x1: Math.max(...ls.map((l) => l.x1)), y0: Math.min(...ls.map((l) => l.top)), y1: Math.max(...ls.map((l) => l.bottom)) } : null
    return { n: p.n, width: p.width, height: p.height, bounds, blocks: p.preBlocks ? [...p.preBlocks] : layoutPage(p, ctx) }
  })
  if (o.joinPages) joinAcrossPages(result)
  return { pages: result, body, bodyFont, removed, sizes }
}

/** Large enough to be a heading: clearly bigger than the body text, and bold or much bigger. */
const isBigText = (l, body, o) => l.fs >= body * o.headingRatio && (l.bold || l.fs >= body * 1.3)

function layoutPage(page, ctx) {
  const { o } = ctx
  let lines = page.lines
  let tables = []
  if (o.tables) {
    const found = detectTables(lines, { cellGap: o.cellGap, minRows: o.minRows })
    tables = found.tables
    lines = lines.filter((l) => !found.used.has(l))
  }
  const colGap = (l) => Math.max(l.fs * 1.8, 14)
  const boxes = []
  for (const l of lines) {
    const segs = l.mono ? [{ x0: l.x0, x1: l.x1, items: l.items }] : segmentLine(l, colGap(l))
    for (const s of segs) boxes.push({ x0: s.x0, x1: s.x1, y0: l.top, y1: l.bottom, items: s.items, line: l })
  }
  for (const t of tables) boxes.push({ x0: t.x0, x1: t.x1, y0: t.y0, y1: t.y1, table: t })
  for (const im of page.images) boxes.push({ x0: im.x0, x1: im.x1, y0: im.y0, y1: im.y1, image: im })
  const groups = o.columns ? orderBoxes(boxes, Math.max(12, ctx.body * 1.2)) : [boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)]
  const blocks = []
  for (const g of groups) {
    // tables and pictures keep their vertical position among the text lines of their group
    const items = g.filter((b) => !b.table && !b.image).flatMap((b) => b.items)
    const textLines = buildLines(items)
    const merged = [...textLines.map((l) => ({ y: l.y, l })), ...g.filter((b) => b.table).map((b) => ({ y: b.table.y, t: b.table })), ...g.filter((b) => b.image).map((b) => ({ y: b.image.y1, im: b.image }))].sort((a, b) => a.y - b.y)
    let run = []
    const flush = () => { if (run.length) blocks.push(...paragraphs(run, ctx, page)); run = [] }
    for (const e of merged) {
      if (e.t) { flush(); blocks.push(tableBlock(e.t)) }
      else if (e.im) { flush(); blocks.push({ type: 'image', data: e.im.data, width: e.im.x1 - e.im.x0, height: e.im.y1 - e.im.y0, px: e.im.px, py: e.im.py, x: e.im.x0 }) }
      else run.push(e.l)
    }
    flush()
  }
  return blocks
}

function tableBlock(t) {
  return { type: 'table', rows: t.rows, boldRows: t.boldRows, merges: t.merges, cols: t.cols, y: t.y }
}

/** Turn the lines of one text region into blocks. */
function paragraphs(lines, ctx, page) {
  const { body, o } = ctx
  const blocks = []
  if (!lines.length) return blocks
  const x1s = lines.map((l) => l.x1).sort((a, b) => a - b)
  const regionR = x1s[Math.max(0, Math.floor(x1s.length * 0.9) - 1)]
  const regionL = Math.min(...lines.map((l) => l.x0))
  const leads = []
  for (let i = 1; i < lines.length; i++) {
    const dy = lines[i].y - lines[i - 1].y
    if (Math.abs(lines[i].fs - lines[i - 1].fs) < 0.6 && dy > lines[i].fs * 0.8 && dy < lines[i].fs * 2.2) leads.push(dy / lines[i].fs)
  }
  const lead = median(leads) || 1.2
  const centerX = (regionL + regionR) / 2, width = Math.max(1, regionR - regionL)
  let cur = null
  const close = () => { if (cur) { blocks.push(finishBlock(cur, ctx, { regionL, regionR, centerX, width, page })); cur = null } }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], prev = lines[i - 1]
    const dy = prev ? l.y - prev.y : 0
    const hSize = o.headings && isBigText(l, body, o) && ctx.headingSizes.get(round1(l.fs))
    const isBoldHead = !hSize && o.boldHeadings && l.bold && l.fs >= body * 0.95 && l.text.trim().split(/\s+/).length <= 14 && !/[.,;]$/.test(l.text.trim()) && l.text.trim().length > 1
    const lm = o.lists && !hSize && !l.mono ? listMarker(l, body) : null

    if (l.mono && !hSize) {
      if (cur?.kind === 'code' && dy < l.fs * 3.6) { cur.lines.push(l); continue }
      close(); cur = { kind: 'code', lines: [l] }; continue
    }
    if (hSize || isBoldHead) {
      const level = hSize || ctx.boldLevel
      if (cur?.kind === 'heading' && cur.level === level && dy < l.fs * lead * 1.35 && Math.abs(prev.fs - l.fs) < 0.6) { cur.lines.push(l); continue }
      // bold line inside a normal paragraph is emphasis, not a heading, unless it stands alone
      if (isBoldHead) {
        const next = lines[i + 1]
        const standsAlone = (!prev || dy > l.fs * lead * 1.15 || !prev.bold) && (!next || next.y - l.y > l.fs * lead * 1.1 || !next.bold)
        const prevInPara = cur?.kind === 'p' && prev && dy <= l.fs * lead * 1.15
        if (!standsAlone || prevInPara) { if (cur?.kind === 'p') { cur.lines.push(l); continue } }
      }
      close(); cur = { kind: 'heading', level, lines: [l] }; continue
    }
    if (lm) {
      close(); cur = { kind: 'li', marker: lm, lines: [l] }; continue
    }
    if (cur?.kind === 'li') {
      const cont = l.x0 >= cur.marker.textX - body * 0.9 && dy <= l.fs * lead * 1.3 && !listMarker(l, body)
      if (cont) { cur.lines.push(l); continue }
      close(); cur = { kind: 'p', lines: [l] }; continue
    }
    if (cur?.kind === 'p') {
      const pl = prev
      const sameSize = Math.abs(pl.fs - l.fs) < 0.9
      const gap = dy > Math.max(l.fs * lead * 1.3, pl.fs * 1.55)
      const indent = l.x0 - pl.x0 > l.fs * 0.9 && l.x0 - regionL > l.fs * 0.9 && pl.x1 < regionR - l.fs * 2
      const shortEnd = pl.x1 < regionR - l.fs * 5 && /[.!?:;"\u201D)\]]$/.test(pl.text.trim())
      const alignChange = Math.abs((pl.x0 + pl.x1) / 2 - centerX) < width * 0.03 !== (Math.abs((l.x0 + l.x1) / 2 - centerX) < width * 0.03) && pl.x1 - pl.x0 < width * 0.8
      if (sameSize && !gap && !indent && !shortEnd && !alignChange) { cur.lines.push(l); continue }
    }
    close(); cur = { kind: 'p', lines: [l] }
  }
  close()
  return blocks
}

function finishBlock(b, ctx, geo) {
  const { body } = ctx
  const lines = b.lines
  if (b.kind === 'code') {
    const x0 = Math.min(...lines.map((l) => l.x0))
    const cw = Math.max(1, median(lines.flatMap((l) => l.items.map((i) => i.w / Math.max(1, i.str.length)))))
    const rows = []
    lines.forEach((l, k) => {
      if (k) for (let b = Math.round((l.y - lines[k - 1].y) / (l.fs * 1.25)) - 1; b > 0 && b < 3; b--) rows.push('')
      rows.push(' '.repeat(Math.max(0, Math.round((l.x0 - x0) / cw))) + l.text.trimEnd())
    })
    return { type: 'code', text: rows.join('\n'), fs: lines[0].fs }
  }
  if (b.kind === 'heading') return { type: 'heading', level: b.level, runs: joinRuns(lines, ctx.o.hyphens).map((r) => ({ ...r, bold: false })), fs: lines[0].fs, text: lines.map((l) => l.text).join(' ') }
  if (b.kind === 'li') {
    const first = lines[0]
    const firstRuns = cutRuns(first.runs, first.text.length - first.text.replace(/^\s*\S+\s+/, '').length)
    const runs = joinRuns([{ ...first, runs: firstRuns }, ...lines.slice(1)], ctx.o.hyphens)
    return { type: 'li', ordered: b.marker.ordered, marker: b.marker.marker, x: first.x0, textX: b.marker.textX, runs, fs: first.fs, level: 0 }
  }
  const first = lines[0], last = lines[lines.length - 1]
  const cx = (Math.min(...lines.map((l) => l.x0)) + Math.max(...lines.map((l) => l.x1))) / 2
  const x0 = Math.min(...lines.map((l) => l.x0)), x1 = Math.max(...lines.map((l) => l.x1))
  let align = 'left'
  if (Math.abs(cx - geo.centerX) < geo.width * 0.04 && x0 - geo.regionL > geo.width * 0.06 && x1 - x0 < geo.width * 0.9) align = 'center'
  else if (geo.regionR - x1 < geo.width * 0.02 && x0 - geo.regionL > geo.width * 0.25) align = 'right'
  const runs = joinRuns(lines, ctx.o.hyphens)
  return { type: 'p', runs, align, indent: Math.max(0, x0 - geo.regionL), firstIndent: Math.max(0, first.x0 - x0), fs: median(lines.map((l) => l.fs)) || body, x0, text: lines.map((l) => l.text).join(' ') }
}

const SENTENCE_END = /[.!?:\u2026"\u201D)\]]\s*$/
function joinAcrossPages(pages) {
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i].blocks, b = pages[i + 1].blocks
    const last = a[a.length - 1], first = b[0]
    if (!last || !first) continue
    const text = (r) => r.runs.map((x) => x.text).join('')
    if (last.type === 'p' && first.type === 'p' && !SENTENCE_END.test(text(last)) && /^[a-z0-9(]/.test(text(first).trim())) {
      const t = text(last)
      if (/[A-Za-z]-$/.test(t) && /^[a-z]/.test(text(first))) { last.runs[last.runs.length - 1].text = last.runs[last.runs.length - 1].text.slice(0, -1) } else last.runs.push({ ...last.runs[last.runs.length - 1], text: ' ' })
      last.runs.push(...first.runs)
      last.text = `${last.text} ${first.text}`
      first.merged = true
      b.shift()
      last.continued = true
    } else if (last.type === 'li' && first.type === 'li' && first.ordered === last.ordered && false) { /* lists keep their own markers */ }
    else if (last.type === 'table' && first.type === 'table' && last.cols === first.cols) {
      // same column count: treat as a continued table (drop a repeated header row)
      const same = last.rows[0].join('|') === first.rows[0].join('|')
      last.rows.push(...(same ? first.rows.slice(1) : first.rows))
      last.boldRows.push(...(same ? first.boldRows.slice(1) : first.boldRows))
      b.shift()
    }
  }
  // list levels by marker x
  for (const p of pages) {
    const xs = [...new Set(p.blocks.filter((b) => b.type === 'li').map((b) => Math.round(b.x)))].sort((a, b) => a - b)
    const levels = []
    for (const x of xs) { if (!levels.length || x - levels[levels.length - 1] > 8) levels.push(x) }
    for (const b of p.blocks) if (b.type === 'li') { const k = levels.findIndex((l, idx) => Math.abs(b.x - l) <= 8 || (idx === levels.length - 1 && b.x > l)); b.level = Math.min(2, Math.max(0, k)) }
  }
}

// ---------------------------------------------------------------- writers shared by several tools

export const blockText = (b) => (b.runs ? b.runs.map((r) => r.text).join('') : b.text || '')

/** Plain text in reading order. Paragraphs are separated by a blank line; lists and code keep their shape. */
export function blocksToText(pages, { pageBreaks = false } = {}) {
  const out = pages.map((p) => {
    let txt = ''
    p.blocks.forEach((b, k) => {
      const piece = b.type === 'table' ? b.rows.map((r) => r.join('\t')).join('\n') : b.type === 'li' ? `${'  '.repeat(b.level)}${b.ordered ? b.marker : '•'} ${blockText(b)}` : blockText(b)
      const prev = p.blocks[k - 1]
      txt += (k === 0 ? '' : prev?.type === 'li' && b.type === 'li' ? '\n' : '\n\n') + piece
    })
    return txt
  })
  return pageBreaks ? out.join('\n\n\f\n') : out.join('\n\n')
}

const mdEscape = (t, lead) => {
  const e = t.replace(/([\\`*_{}\[\]<>#|~])/g, '\\$1')
  return lead ? e.replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3').replace(/^(\s*)([-+])(\s)/, '$1\\$2$3') : e
}
/** Runs -> Markdown inline text (bold, italic, code, links). Pass {lead: true} for paragraph text so a line start that looks like a list marker is escaped. */
export function runsToMarkdown(runs, { lead: escapeLead = false } = {}) {
  let out = ''
  let first = true
  for (const r of runs) {
    let t = r.mono ? r.text : mdEscape(r.text, escapeLead && first)
    if (t.trim()) first = false
    if (!t.trim()) { out += t; continue }
    const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0]
    let core = t.trim()
    if (r.mono) core = `\`${core.replace(/`/g, '\\`')}\``
    if (r.bold && r.italic) core = `***${core}***`
    else if (r.bold) core = `**${core}**`
    else if (r.italic) core = `*${core}*`
    if (r.sup) core = `<sup>${core}</sup>`
    if (r.sub) core = `<sub>${core}</sub>`
    if (r.url) core = `[${core}](${r.url})`
    out += lead + core + trail
  }
  return out.replace(/\*\*\s*\*\*/g, '').replace(/(\*\*|\*)(\s+)\1/g, '$2')
}

/** Document blocks -> Markdown. */
export function blocksToMarkdown(pages, { pageBreaks = false } = {}) {
  const out = []
  pages.forEach((p, pi) => {
    const parts = []
    p.blocks.forEach((b, k) => {
      const prev = p.blocks[k - 1]
      let piece
      if (b.type === 'heading') piece = `${'#'.repeat(Math.min(6, b.level))} ${runsToMarkdown(b.runs).trim()}`
      else if (b.type === 'li') piece = `${'  '.repeat(b.level)}${b.ordered ? (/\d/.test(b.marker) ? `${parseInt(b.marker.replace(/\D/g, ''), 10)}.` : '1.') : '-'} ${runsToMarkdown(b.runs).trim()}`
      else if (b.type === 'code') piece = `\`\`\`\n${b.text}\n\`\`\``
      else if (b.type === 'table') {
        const cols = b.cols, rows = b.rows.map((r) => r.map((c) => (c || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')))
        if (rows.length < 2) piece = rows.map((r) => r.filter(Boolean).join('  ')).join('\n\n')
        else piece = [`| ${rows[0].join(' | ')} |`, `| ${new Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n')
      } else {
        const t = runsToMarkdown(b.runs, { lead: true }).trim()
        piece = b.align === 'center' ? `<p align="center">${t}</p>` : t
      }
      parts.push((k === 0 ? '' : prev?.type === 'li' && b.type === 'li' ? '\n' : '\n\n') + piece)
    })
    out.push(parts.join(''))
    void pi
  })
  return out.join(pageBreaks ? '\n\n---\n\n' : '\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function runsToHtml(runs) {
  return runs.map((r) => {
    let t = esc(r.text)
    if (!t.trim()) return t
    if (r.mono) t = `<code>${t}</code>`
    if (r.bold) t = `<strong>${t}</strong>`
    if (r.italic) t = `<em>${t}</em>`
    if (r.sup) t = `<sup>${t}</sup>`
    if (r.sub) t = `<sub>${t}</sub>`
    if (r.url) t = `<a href="${esc(r.url)}">${t}</a>`
    return t
  }).join('')
}

export function blocksToHtml(pages) {
  const out = []
  for (const p of pages) {
    let list = null
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
    for (const b of p.blocks) {
      if (b.type === 'li') {
        const tag = b.ordered ? 'ol' : 'ul'
        if (list && list !== tag) closeList()
        if (!list) { out.push(`<${tag}>`); list = tag }
        out.push(`<li>${runsToHtml(b.runs)}</li>`)
        continue
      }
      closeList()
      if (b.type === 'heading') out.push(`<h${Math.min(6, b.level)}>${runsToHtml(b.runs)}</h${Math.min(6, b.level)}>`)
      else if (b.type === 'code') out.push(`<pre><code>${esc(b.text)}</code></pre>`)
      else if (b.type === 'table') {
        out.push('<table>', ...b.rows.map((r, i) => `<tr>${r.map((c) => `<${i === 0 && b.boldRows[0] ? 'th' : 'td'}>${esc(c || '')}</${i === 0 && b.boldRows[0] ? 'th' : 'td'}>`).join('')}</tr>`), '</table>')
      } else out.push(`<p${b.align !== 'left' ? ` style="text-align:${b.align}"` : ''}>${runsToHtml(b.runs)}</p>`)
    }
    closeList()
  }
  return out.join('\n')
}

/** Text with columns kept in place, like `pdftotext -layout`: items are positioned on a character grid. */
export function layoutText(pageData, { body = 11 } = {}) {
  const cw = body * 0.5
  return pageData.map((p) => {
    const lines = buildLines(p.items)
    if (!lines.length) return ''
    const minX = Math.min(...lines.map((l) => l.x0))
    let prevY = null
    const out = []
    for (const l of lines) {
      if (prevY !== null) { const gaps = Math.round((l.y - prevY) / (l.fs * 1.3)) - 1; for (let k = 0; k < Math.min(gaps, 2); k++) out.push('') }
      let s = ''
      for (const it of l.items) {
        const col = Math.round((it.x - minX) / cw)
        if (s.length < col) s += ' '.repeat(col - s.length)
        else if (s.length && !/\s$/.test(s) && !/^\s/.test(it.str)) s += ' '
        s += it.str
      }
      out.push(s.trimEnd())
      prevY = l.y
    }
    return out.join('\n')
  })
}

/** Memoized page reader for one open document: re-running an analysis with new options does not re-read the PDF. */
export function pageReader(getDoc) {
  let doc = null, cache = new Map()
  return {
    async pages(nums, { onProgress, signal } = {}) {
      const d = getDoc()
      if (d !== doc) { doc = d; cache = new Map() }
      const out = []
      for (let i = 0; i < nums.length; i++) {
        if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
        const n = nums[i]
        if (!cache.has(n)) cache.set(n, await readPage(doc, n))
        out.push(cache.get(n))
        onProgress?.((i + 1) / nums.length, `Reading page ${i + 1} of ${nums.length}`)
        if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0))
      }
      return out
    },
    clear() { cache = new Map(); doc = null },
  }
}

// ---------------------------------------------------------------- pictures

/** Bounding boxes (page points, top-left origin) of the raster images a page paints. */
export async function findImageBoxes(page) {
  const { OPS, Util } = await pdfjs()
  const vp = page.getViewport({ scale: 1 })
  const ops = await page.getOperatorList()
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = [], boxes = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0]
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args)
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (args?.[0]) ctm = Util.transform(ctm, args[0]) }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const m = Util.transform(vp.transform, ctm)
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]])
      boxes.push({ x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) })
    }
  }
  return boxes
}

const overlapFrac = (b, rects) => {
  const area = (b.x1 - b.x0) * (b.y1 - b.y0) || 1
  let sum = 0
  for (const r of rects) {
    const w = Math.min(b.x1, r.x1) - Math.max(b.x0, r.x0), hh = Math.min(b.y1, r.y1) - Math.max(b.y0, r.y0)
    if (w > 0 && hh > 0) sum += w * hh
  }
  return sum / area
}

/**
 * Crop the pictures of a page out of a rendering of it and attach them as pageData.images (PNG bytes + position).
 * Pictures that sit under text (backgrounds, watermarks) and tiny decorations are skipped.
 */
export async function attachImages(doc, pd, { scale = 2, minSize = 28 } = {}) {
  pd.images = []
  const page = await doc.getPage(pd.n)
  const W = pd.width, H = pd.height
  const text = pd.items.map((it) => ({ x0: it.x, x1: it.x + it.w, y0: it.y - it.fs * 0.85, y1: it.y + it.fs * 0.25 }))
  let boxes = (await findImageBoxes(page)).map((b) => ({ x0: Math.max(0, b.x0), x1: Math.min(W, b.x1), y0: Math.max(0, b.y0), y1: Math.min(H, b.y1) }))
    .filter((b) => b.x1 - b.x0 >= minSize && b.y1 - b.y0 >= minSize && (!text.length || (b.x1 - b.x0) * (b.y1 - b.y0) < W * H * 0.9) && overlapFrac(b, text) < 0.12)
  boxes = boxes.filter((b, i) => !boxes.slice(0, i).some((a) => Math.abs(a.x0 - b.x0) < 2 && Math.abs(a.y0 - b.y0) < 2 && Math.abs(a.x1 - b.x1) < 2 && Math.abs(a.y1 - b.y1) < 2))
  if (!boxes.length) return
  const canvas = await renderPage(doc, pd.n, { scale })
  const k = canvas.width / W
  for (const b of boxes) {
    const sx = Math.round(b.x0 * k), sy = Math.round(b.y0 * k), sw = Math.max(1, Math.round((b.x1 - b.x0) * k)), sh = Math.max(1, Math.round((b.y1 - b.y0) * k))
    const c = document.createElement('canvas')
    c.width = sw; c.height = sh
    c.getContext('2d').drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
    pd.images.push({ ...b, data: new Uint8Array(await blob.arrayBuffer()), px: sw, py: sh })
    c.width = c.height = 0
  }
  canvas.width = canvas.height = 0
}
