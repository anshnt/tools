// Outline conversion between TrueType (quadratic glyf) and OpenType CFF (cubic Type 2 charstrings). DOM-free.
// Glyph outlines are read with opentype.js (composites and subroutines resolved), then written again in the other format; every other table
// (cmap, name, OS/2, GSUB, GPOS, ...) is kept, because glyph ids do not change.
import { loadOpentype } from './_engine.js'
import { dv, parseHead, parseName, pickName } from './_info.js'
import { writeSfnt } from './_sfnt.js'
import { encodeGlyf, makeMaxp, makeHmtx, makePost, patchHeadHhea, GASP } from './_ttfbuild.js'

const tick = () => new Promise((r) => setTimeout(r, 0))
const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }
const aborted = (signal) => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' }) }

/** Read every glyph as {name, advance, contours} where contours are [{start: [x, y], segs: [['L', x, y] | ['Q', cx, cy, x, y] | ['C', c1x, c1y, c2x, c2y, x, y]]}]. */
async function readOutlines(tables, { onProgress, signal } = {}) {
  const ot = await loadOpentype()
  const sfnt = writeSfnt(tables)
  let font
  try { font = ot.parse(sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength)) } catch (e) { fail(`The glyph outlines could not be read (${e.message}).`) }
  const out = []
  const n = font.glyphs.length
  for (let i = 0; i < n; i++) {
    const g = font.glyphs.get(i)
    const contours = toContours(g.path.commands)
    // TrueType scalers place a glyph so that its left edge sits at the hmtx side bearing; honour that shift
    const dx = !tables.has('glyf') || !contours.length || g.xMin == null || g.leftSideBearing == null ? 0 : g.leftSideBearing - g.xMin
    if (dx) for (const c of contours) { c.start[0] += dx; for (const s of c.segs) for (let k = 1; k < s.length; k += 2) s[k] += dx }
    out.push({ name: g.name, advance: g.advanceWidth || 0, contours })
    if (i % 400 === 399) { aborted(signal); onProgress?.(i / n); await tick() }
  }
  return { glyphs: out, upm: font.unitsPerEm }
}

function toContours(commands) {
  const out = []
  let cur = null
  const close = () => {
    if (!cur) return
    const last = cur.segs[cur.segs.length - 1]
    const end = last ? last.slice(-2) : cur.start
    if (last && (end[0] !== cur.start[0] || end[1] !== cur.start[1])) cur.segs.push(['L', cur.start[0], cur.start[1]])
    if (cur.segs.length) out.push(cur)
    cur = null
  }
  for (const c of commands) {
    if (c.type === 'M') { close(); cur = { start: [c.x, c.y], segs: [] } }
    else if (c.type === 'Z') close()
    else if (!cur) continue
    else if (c.type === 'L') cur.segs.push(['L', c.x, c.y])
    else if (c.type === 'Q') cur.segs.push(['Q', c.x1, c.y1, c.x, c.y])
    else if (c.type === 'C') cur.segs.push(['C', c.x1, c.y1, c.x2, c.y2, c.x, c.y])
  }
  close()
  return out
}

/** The same contour traversed the other way round. */
function reverse(c) {
  const nodes = [c.start, ...c.segs.map((s) => s.slice(-2))]
  const segs = []
  for (let i = c.segs.length - 1; i >= 0; i--) {
    const s = c.segs[i], to = nodes[i]
    if (s[0] === 'L') segs.push(['L', to[0], to[1]])
    else if (s[0] === 'Q') segs.push(['Q', s[1], s[2], to[0], to[1]])
    else segs.push(['C', s[3], s[4], s[1], s[2], to[0], to[1]])
  }
  return { start: nodes[nodes.length - 1], segs }
}

// ---------- cubic -> quadratic ----------
const lerp = (a, b, t) => a + (b - a) * t
function cubicAt(p, t) {
  const u = 1 - t
  return [0, 1].map((k) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k])
}
function cubicSlope(p, t) {
  const u = 1 - t
  return [0, 1].map((k) => 3 * (u * u * (p[1][k] - p[0][k]) + 2 * u * t * (p[2][k] - p[1][k]) + t * t * (p[3][k] - p[2][k])))
}
/** Split a cubic into n quadratics and report the worst distance between the curves. Returns {quads: [[cx, cy, x, y]], err}. */
function approximate(p, n) {
  const quads = []
  let err = 0
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, d = (t1 - t0) / 3
    const a = cubicAt(p, t0), b = cubicAt(p, t1), sa = cubicSlope(p, t0), sb = cubicSlope(p, t1)
    const c1 = [a[0] + d * sa[0], a[1] + d * sa[1]], c2 = [b[0] - d * sb[0], b[1] - d * sb[1]]
    const q = [0, 1].map((k) => (3 * (c1[k] + c2[k]) - (a[k] + b[k])) / 4)
    for (let s = 1; s < 8; s++) {
      const t = s / 8, u = 1 - t
      const cu = [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * b[k])
      const qu = [0, 1].map((k) => u * u * a[k] + 2 * u * t * q[k] + t * t * b[k])
      err = Math.max(err, Math.hypot(cu[0] - qu[0], cu[1] - qu[1]))
    }
    quads.push([q[0], q[1], b[0], b[1]])
  }
  quads[quads.length - 1][2] = p[3][0]; quads[quads.length - 1][3] = p[3][1]
  return { quads, err }
}
export function cubicToQuads(p0, p1, p2, p3, tol) {
  const p = [p0, p1, p2, p3]
  let best
  for (let n = 1; n <= 24; n++) {
    best = approximate(p, n)
    if (best.err <= tol) break
  }
  return best.quads
}

/** Contours -> TrueType point lists (integer coordinates, implied on-curve points dropped). */
function toTrueTypePoints(contours, tol) {
  const result = []
  for (const c of contours) {
    const r = reverse(c) // PostScript outlines run counter-clockwise, TrueType outer contours clockwise
    const pts = [{ x: Math.round(r.start[0]), y: Math.round(r.start[1]), on: true }]
    let cx = r.start[0], cy = r.start[1]
    for (const s of r.segs) {
      if (s[0] === 'L') pts.push({ x: Math.round(s[1]), y: Math.round(s[2]), on: true })
      else if (s[0] === 'Q') pts.push({ x: Math.round(s[1]), y: Math.round(s[2]), on: false }, { x: Math.round(s[3]), y: Math.round(s[4]), on: true })
      else for (const q of cubicToQuads([cx, cy], [s[1], s[2]], [s[3], s[4]], [s[5], s[6]], tol)) pts.push({ x: Math.round(q[0]), y: Math.round(q[1]), on: false }, { x: Math.round(q[2]), y: Math.round(q[3]), on: true })
      cx = s[s.length - 2]; cy = s[s.length - 1]
    }
    const first = pts[0], last = pts[pts.length - 1]
    if (pts.length > 1 && last.on && last.x === first.x && last.y === first.y) pts.pop()
    // an on-curve point exactly halfway between two off-curve neighbours is implied
    const keep = pts.map((p, i) => {
      if (!p.on) return true
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length]
      return !(!a.on && !b.on && 2 * p.x === a.x + b.x && 2 * p.y === a.y + b.y)
    })
    const list = pts.filter((_, i) => keep[i])
    if (list.length >= 3) result.push(list)
  }
  return result
}

const REMOVE_FOR_TT = ['CFF ', 'CFF2', 'VORG']
const REMOVE_FOR_CFF = ['glyf', 'loca', 'cvt ', 'fpgm', 'prep', 'gasp', 'hdmx', 'LTSH', 'VDMX', 'cvar', 'gvar']

function needStatic(tables) {
  if (tables.has('fvar') || tables.has('CFF2')) fail('Variable fonts cannot change outline type here. Convert the container (for example to WOFF2) instead.')
}

/** OpenType CFF -> TrueType outlines. tol is the allowed curve error in font units (default 1). */
export async function cffToTrueType(tables, { tolerance = 1, onProgress, signal } = {}) {
  needStatic(tables)
  const { glyphs, upm } = await readOutlines(tables, { signal, onProgress: (f) => onProgress?.(f * 0.6) })
  const tol = Math.max(0.05, tolerance * (upm / 1000))
  const conv = []
  for (let i = 0; i < glyphs.length; i++) {
    conv.push({ contours: toTrueTypePoints(glyphs[i].contours, tol) })
    if (i % 300 === 299) { aborted(signal); onProgress?.(0.6 + (0.4 * i) / glyphs.length); await tick() }
  }
  const enc = encodeGlyf(conv)
  const advances = glyphs.map((g) => g.advance)
  const { head, hhea } = patchHeadHhea(tables.get('head'), tables.get('hhea'), { format: enc.format, bboxes: enc.bboxes, advances })
  const out = new Map(tables)
  for (const t of REMOVE_FOR_TT) out.delete(t)
  out.set('glyf', enc.glyf); out.set('loca', enc.loca); out.set('head', head); out.set('hhea', hhea)
  out.set('hmtx', makeHmtx(advances, enc.bboxes))
  out.set('maxp', makeMaxp(glyphs.length, enc.maxPoints, enc.maxContours))
  out.set('gasp', GASP)
  out.set('post', makePost(tables.get('post'), glyphs.map((g) => g.name)))
  onProgress?.(1)
  return out
}

// ---------- CFF writing ----------
function num(n) { // Type 2 charstring and DICT integer operand
  n = Math.round(n)
  if (n >= -107 && n <= 107) return [n + 139]
  if (n >= 108 && n <= 1131) { n -= 108; return [(n >> 8) + 247, n & 255] }
  if (n >= -1131 && n <= -108) { n = -n - 108; return [(n >> 8) + 251, n & 255] }
  if (n >= -32768 && n <= 32767) return [28, (n >> 8) & 255, n & 255]
  return [29, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}
const int5 = (n) => [29, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] // fixed width so offsets do not change the DICT size
function real(x) {
  const [m, e] = x.toExponential().split('e')
  const nib = [...m].map((c) => (c === '.' ? 0xa : c === '-' ? 0xe : +c))
  const ex = +e
  if (ex !== 0) nib.push(ex < 0 ? 0xc : 0xb, ...String(Math.abs(ex)).split('').map(Number))
  nib.push(0xf)
  if (nib.length % 2) nib.push(0xf)
  const bytes = [30]
  for (let i = 0; i < nib.length; i += 2) bytes.push((nib[i] << 4) | nib[i + 1])
  return bytes
}
function index(items) {
  if (!items.length) return [0, 0]
  const total = items.reduce((a, b) => a + b.length, 0) + 1
  const offSize = total < 256 ? 1 : total < 65536 ? 2 : total < 1 << 24 ? 3 : 4
  const out = [(items.length >> 8) & 255, items.length & 255, offSize]
  const push = (v) => { for (let k = offSize - 1; k >= 0; k--) out.push((v >>> (8 * k)) & 255) }
  let off = 1
  push(off)
  for (const it of items) { off += it.length; push(off) }
  for (const it of items) for (const b of it) out.push(b)
  return out
}

/** Type 2 charstring for contours of ['L'|'Q'|'C'] segments; lines and curves are relative, coordinates are rounded once. */
function charstring(contours, width) {
  const out = []
  let first = true
  const withWidth = () => { if (first) { first = false; if (width) out.push(...num(width)) } }
  let px = 0, py = 0
  for (const c of contours) {
    const sx = Math.round(c.start[0]), sy = Math.round(c.start[1])
    withWidth()
    out.push(...num(sx - px), ...num(sy - py), 21)
    px = sx; py = sy
    let lines = [], curves = [] // argument lists (numbers), encoded on flush so a chunk never splits an operand group
    const flush = () => {
      for (let i = 0; i < lines.length; i += 40) out.push(...lines.slice(i, i + 40).flatMap(num), 5)
      for (let i = 0; i < curves.length; i += 36) out.push(...curves.slice(i, i + 36).flatMap(num), 8)
      lines = []; curves = []
    }
    let kind = ''
    for (const s of c.segs) {
      let cubic
      if (s[0] === 'L') {
        const x = Math.round(s[1]), y = Math.round(s[2])
        if (x === px && y === py) continue
        if (kind === 'C') flush()
        kind = 'L'
        lines.push(x - px, y - py); px = x; py = y
        continue
      }
      if (s[0] === 'Q') cubic = [px + (2 / 3) * (s[1] - px), py + (2 / 3) * (s[2] - py), s[3] + (2 / 3) * (s[1] - s[3]), s[4] + (2 / 3) * (s[2] - s[4]), s[3], s[4]]
      else cubic = s.slice(1)
      if (kind === 'L') flush()
      kind = 'C'
      const r = cubic.map(Math.round)
      curves.push(r[0] - px, r[1] - py, r[2] - r[0], r[3] - r[1], r[4] - r[2], r[5] - r[3])
      px = r[4]; py = r[5]
    }
    flush()
  }
  withWidth()
  out.push(14)
  return Uint8Array.from(out)
}

const cffName = (n, i, used) => {
  let s = (n || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)
  if (!s || s === '.notdef' || used.has(s)) s = `glyph${i}`
  while (used.has(s)) s += '_'
  used.add(s)
  return s
}

function makeCff(glyphs, { psName, upm, bbox }) {
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0) & 127)
  const used = new Set(['.notdef'])
  const names = glyphs.map((g, i) => (i === 0 ? '.notdef' : cffName(g.name, i, used)))
  const strings = names.slice(1).map(ascii)
  const charset = []
  names.slice(1).forEach((_, i) => charset.push(((391 + i) >> 8) & 255, (391 + i) & 255))
  const charStrings = glyphs.map((g) => charstring(g.contours, g.advance))
  const priv = [...num(0), 20, ...num(0), 21]
  const topFor = (csetOff, csOff, privOff) => [
    ...num(bbox[0]), ...num(bbox[1]), ...num(bbox[2]), ...num(bbox[3]), 5,
    ...(upm !== 1000 ? [...real(1 / upm), ...num(0), ...num(0), ...real(1 / upm), ...num(0), ...num(0), 12, 7] : []),
    ...int5(csetOff), 15, ...int5(csOff), 17, ...int5(priv.length), ...int5(privOff), 18,
  ]
  const header = [1, 0, 4, 4]
  const nameIdx = index([ascii(psName || 'Font')])
  const strIdx = index(strings)
  const gsubr = index([])
  const topLen = index([topFor(0, 0, 0)]).length
  const csetOff = header.length + nameIdx.length + topLen + strIdx.length + gsubr.length
  const csIdx = index(charStrings)
  const csOff = csetOff + charset.length + 1
  const privOff = csOff + csIdx.length
  const topIdx = index([topFor(csetOff, csOff, privOff)])
  return Uint8Array.from([...header, ...nameIdx, ...topIdx, ...strIdx, ...gsubr, 0, ...charset, ...csIdx, ...priv])
}

/** TrueType -> OpenType CFF. Quadratic curves become cubic exactly; hinting instructions are dropped. */
export async function trueTypeToCff(tables, { onProgress, signal } = {}) {
  needStatic(tables)
  const { glyphs, upm } = await readOutlines(tables, { signal, onProgress: (f) => onProgress?.(f * 0.9) })
  const conv = glyphs.map((g) => ({ ...g, contours: g.contours.map(reverse) })) // TrueType outer contours run clockwise, PostScript counter-clockwise
  const head = parseHead(tables.get('head'))
  const psName = pickName(parseName(tables.get('name')), 6)
  const cff = makeCff(conv, { psName: psName.replace(/[^\x21-\x7e]/g, '') || 'Font', upm, bbox: [head.xMin, head.yMin, head.xMax, head.yMax] })
  const out = new Map(tables)
  for (const t of REMOVE_FOR_CFF) out.delete(t)
  out.set('CFF ', cff)
  const maxp = new Uint8Array(6)
  dv(maxp).setUint32(0, 0x00005000); dv(maxp).setUint16(4, glyphs.length)
  out.set('maxp', maxp)
  const post = tables.get('post')
  if (post && post.length >= 32) { const p = post.slice(0, 32); dv(p).setUint32(0, 0x00030000); out.set('post', p) }
  const h = tables.get('head').slice()
  dv(h).setInt16(50, 0)
  out.set('head', h)
  onProgress?.(1)
  return out
}
