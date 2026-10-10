// Text engine: resolves paragraph/character styles and lays a story out across a chain of frames (columns, threading, overflow).
// Pure geometry: the canvas renderer and the PDF exporter both consume the same lines, so what you see is what is exported.
import { face, cssFont, measure, metrics, isReady } from './_fonts.js'
import { paraStyle, charStyle } from './_model.js'

const interned = new Map()
/** Resolve the effective style of a run: paragraph style < paragraph overrides < character style < inline flags. */
export function styleOf(doc, p, run, missing) {
  const ps = paraStyle(doc, p.ps)
  const o = p.o || {}
  const cs = run.cs ? charStyle(doc, run.cs) : null
  const pick = (k) => cs?.[k] ?? o[k] ?? ps[k]
  let weight = pick('weight')
  if (run.b) weight = Math.max(weight, 700)
  const italic = run.i ? true : pick('italic')
  const f = face(pick('font'), weight, italic)
  if (missing && !isReady(f)) missing.set(f.key, f)
  const size = pick('size'), color = run.c ?? pick('color'), tracking = pick('tracking') || 0, caps = !!pick('caps'), lh = pick('lh') || 1.3
  const u = !!(run.u || cs?.underline)
  const key = [f.key, size, color, tracking, caps ? 1 : 0, u ? 1 : 0, lh].join('|')
  let st = interned.get(key)
  if (!st) {
    st = { f, size, color, tracking, caps, u, lh, font: cssFont(f, size), key }
    if (interned.size > 5000) interned.clear()
    interned.set(key, st)
  }
  return st
}
export const paraProp = (doc, p, k) => (p.o && p.o[k] !== undefined ? p.o[k] : paraStyle(doc, p.ps)[k])

const subst = (t, tokens) => (tokens && t.includes('{') ? t.replace(/\{(#|total|title)\}/g, (_, k) => tokens[k] ?? '') : t)
const partWidth = (st, text) => measure(st.font, text) + (st.tracking ? (st.tracking * st.size * text.length) / 1000 : 0)

function buildUnits(doc, p, tokens, missing) {
  const out = []
  for (const run of p.runs) {
    const st = styleOf(doc, p, run, missing)
    let text = subst(run.t, tokens)
    if (st.caps) text = text.toUpperCase()
    for (const piece of text.split(/(\n|[ \t]+)/)) {
      if (!piece) continue
      if (piece === '\n') out.push({ k: 'br', w: 0, parts: [] })
      else if (/^[ \t]+$/.test(piece)) {
        const t = piece.replace(/\t/g, '    ')
        out.push({ k: 's', parts: [{ text: t, st, sp: true, w: partWidth(st, t) }] })
      } else {
        const part = { text: piece, st, w: partWidth(st, piece) }
        const last = out[out.length - 1]
        if (last && last.k === 'w') last.parts.push(part)
        else out.push({ k: 'w', parts: [part] })
      }
    }
  }
  for (const u of out) u.w = u.parts.reduce((a, x) => a + x.w, 0)
  return out
}

/** Split a too-long word so that the head fits in width W (at least one character). */
function splitWord(u, W) {
  const head = [], tail = []
  let w = 0, done = false
  for (const part of u.parts) {
    if (done) { tail.push(part); continue }
    if (w + part.w <= W) { head.push(part); w += part.w; continue }
    let n = 1
    while (n < part.text.length && w + partWidth(part.st, part.text.slice(0, n + 1)) <= W) n++
    if (!head.length || n < part.text.length) {
      const a = part.text.slice(0, n), b = part.text.slice(n)
      head.push({ text: a, st: part.st, w: partWidth(part.st, a) })
      if (b) tail.push({ text: b, st: part.st, w: partWidth(part.st, b) })
    } else head.push(part)
    done = true
  }
  const mk = (parts) => ({ k: 'w', parts, w: parts.reduce((a, x) => a + x.w, 0) })
  return [mk(head), tail.length ? mk(tail) : null]
}

function nextLine(units, ui, W, skipLeading) {
  const parts = []
  let w = 0, i = ui, br = false, newUnits = null
  while (i < units.length) {
    const u = units[i]
    if (u.k === 'br') { i++; br = true; break }
    if (u.k === 's') {
      if (!parts.length && skipLeading) { i++; continue }
      parts.push(...u.parts); w += u.w; i++
      continue
    }
    if (w + u.w <= W + 0.01) { parts.push(...u.parts); w += u.w; i++; continue }
    if (parts.every((x) => x.sp)) { // nothing but spaces so far: the word itself is wider than the column
      const [head, tail] = splitWord(u, W)
      parts.length = 0
      parts.push(...head.parts)
      w = head.w
      if (tail) { newUnits = units.slice(); newUnits[i] = tail } else i++
    }
    break
  }
  while (parts.length && parts[parts.length - 1].sp) w -= parts.pop().w
  return { parts, w, next: i, br, units: newUnits, end: i >= (newUnits || units).length }
}

/**
 * Lay a story out through a chain of text frames.
 * env: {tokens: {'#','total','title'}}. Returns {frames: Map(frameId -> {lines}), overflow, missing: Map(key -> face), used: chars left}.
 * A line is {x, y (baseline), h, w, parts: [{text, st, x, w, sp}], just, marker}; coordinates are relative to the frame's top-left.
 */
export function layoutStory(doc, story, chain, env = {}) {
  const missing = new Map()
  const frames = new Map(chain.map((f) => [f.id, { lines: [] }]))
  const paras = story.paras
  let pi = 0, ui = 0, units = null, firstLine = true, pendingAfter = 0, guard = 0
  const numbers = []
  { let n = 0; for (const p of paras) { n = paraProp(doc, p, 'list') === 'number' ? n + 1 : 0; numbers.push(n) } }

  outer: for (const f of chain) {
    const inset = f.inset || 0
    const cols = Math.max(1, f.cols || 1), gap = f.gap ?? 12
    const colW = Math.max(4, (f.w - 2 * inset - gap * (cols - 1)) / cols), colH = f.h - 2 * inset
    const res = frames.get(f.id)
    for (let c = 0; c < cols; c++) {
      let y = 0, atTop = true
      const colStart = res.lines.length
      while (pi < paras.length) {
        if (++guard > 200000) break outer
        const p = paras[pi]
        if (!units) { units = buildUnits(doc, p, env.tokens, missing); ui = 0; firstLine = true }
        const align = paraProp(doc, p, 'align') || 'left'
        const left = paraProp(doc, p, 'left') || 0, indent = paraProp(doc, p, 'indent') || 0
        const list = paraProp(doc, p, 'list')
        const isList = list === 'bullet' || list === 'number'
        const lineX = isList ? left : left + (firstLine ? indent : 0)
        const W = Math.max(4, colW - lineX)
        const ln = nextLine(units, ui, W, !firstLine)
        const baseSt = ln.parts[0]?.st || styleOf(doc, p, p.runs[0] || { t: '' }, missing)
        let lineH = 0
        for (const part of ln.parts) lineH = Math.max(lineH, part.st.size * part.st.lh)
        if (!ln.parts.length) lineH = baseSt.size * baseSt.lh
        const dom = ln.parts.reduce((b, x) => (x.st.size * x.st.lh >= (b?.st.size * b?.st.lh || 0) ? x : b), null)?.st || baseSt
        const extra = !atTop && firstLine ? pendingAfter + (paraProp(doc, p, 'before') || 0) : 0
        if (y + extra + lineH > colH + 0.5) break
        const m = metrics(dom.f)
        const top = y + extra
        const base = top + (lineH - (m.asc + m.desc) * dom.size) / 2 + m.asc * dom.size
        const justify = align === 'justify' && !ln.br && !ln.end
        const line = { x: inset + c * (colW + gap) + lineX, y: inset + base, top: inset + top, h: lineH, w: ln.w, parts: [], align, just: justify, colW: W, marker: null }
        // position parts (justify spreads the spare room over the spaces)
        let spaces = 0
        if (justify) for (const part of ln.parts) if (part.sp) spaces++
        const bonus = justify && spaces ? Math.max(0, W - ln.w) / spaces : 0
        let x = align === 'center' && !justify ? (W - ln.w) / 2 : align === 'right' ? W - ln.w : 0
        for (const part of ln.parts) {
          const w = part.w + (part.sp ? bonus : 0)
          line.parts.push({ text: part.text, st: part.st, sp: !!part.sp, x, w })
          x += w
        }
        if (justify && spaces) line.w = W
        if (isList && firstLine) {
          const text = list === 'bullet' ? '•' : `${numbers[pi]}.`
          line.marker = { text, st: baseSt, x: inset + c * (colW + gap) + indent }
        }
        res.lines.push(line)
        y = top + lineH
        atTop = false
        firstLine = false
        if (ln.units) units = ln.units
        if (ln.end) { pi++; units = null; pendingAfter = paraProp(doc, p, 'after') || 0 } else ui = ln.next
      }
      // vertical alignment of single-column frames
      if (cols === 1 && f.valign && f.valign !== 'top' && res.lines.length > colStart) {
        const used = y, free = colH - used
        const dy = f.valign === 'middle' ? free / 2 : free
        if (dy > 0) for (const l of res.lines.slice(colStart)) { l.y += dy; l.top += dy }
      }
      if (pi >= paras.length) break outer
    }
  }
  return { frames, overflow: pi < paras.length, missing }
}

/** Plain text of a story (for search and word counts). */
export const storyPlain = (st) => st.paras.map((p) => p.runs.map((r) => r.t).join('')).join('\n')
