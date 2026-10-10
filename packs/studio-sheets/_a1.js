// A1 notation helpers shared by the formula engine, the grid and import/export. No DOM.
export const MAXR = 1048576
export const MAXC = 16384
const SPAN = 34359738368 // 2^35: room for r * 16384 + c

/** Numeric key of a cell: unique across sheets. */
export const gk = (sid, r, c) => sid * SPAN + r * MAXC + c
/** Key of a cell inside one sheet. */
export const ck = (r, c) => r * MAXC + c
export const ckR = (k) => Math.floor(k / MAXC)
export const ckC = (k) => k % MAXC

export function colName(c) {
  let s = ''
  c++
  while (c > 0) {
    const m = (c - 1) % 26
    s = String.fromCharCode(65 + m) + s
    c = Math.floor((c - 1) / 26)
  }
  return s
}
export function colIndex(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) & 31)
  return n - 1
}
export const addr = (r, c) => colName(c) + (r + 1)

const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/
/** parseCell('$B$3') -> {r, c, rAbs, cAbs} or null */
export function parseCell(s) {
  const m = CELL.exec(s)
  if (!m) return null
  const c = colIndex(m[2]), r = parseInt(m[4], 10) - 1
  if (c >= MAXC || r >= MAXR || r < 0) return null
  return { r, c, rAbs: !!m[3], cAbs: !!m[1] }
}
export const isCellRef = (s) => !!parseCell(s)

/** parseRange('A1:C5' | 'A1' | 'A:A' | '2:5') -> {r1,c1,r2,c2} (normalized) or null */
export function parseRange(s) {
  s = String(s).trim().replace(/\$/g, '')
  let m = /^([A-Za-z]{1,3})(\d+):([A-Za-z]{1,3})(\d+)$/.exec(s)
  if (m) return norm(parseInt(m[2], 10) - 1, colIndex(m[1]), parseInt(m[4], 10) - 1, colIndex(m[3]))
  m = /^([A-Za-z]{1,3})(\d+)$/.exec(s)
  if (m) { const r = parseInt(m[2], 10) - 1, c = colIndex(m[1]); return { r1: r, c1: c, r2: r, c2: c } }
  m = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(s)
  if (m) return norm(0, colIndex(m[1]), MAXR - 1, colIndex(m[2]))
  m = /^(\d+):(\d+)$/.exec(s)
  if (m) return norm(parseInt(m[1], 10) - 1, 0, parseInt(m[2], 10) - 1, MAXC - 1)
  return null
}
const norm = (r1, c1, r2, c2) => ({ r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) })

export function rangeText(g) {
  if (g.r1 === g.r2 && g.c1 === g.c2) return addr(g.r1, g.c1)
  if (g.r1 === 0 && g.r2 >= MAXR - 1) return `${colName(g.c1)}:${colName(g.c2)}`
  if (g.c1 === 0 && g.c2 >= MAXC - 1) return `${g.r1 + 1}:${g.r2 + 1}`
  return `${addr(g.r1, g.c1)}:${addr(g.r2, g.c2)}`
}
export const rangeContains = (g, r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2
export const rangesOverlap = (a, b) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2
export const rangeArea = (g) => (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1)
