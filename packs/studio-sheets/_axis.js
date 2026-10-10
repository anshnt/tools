// Row/column sizes with hidden entries: offset(i) and at(px) in O(log n). No DOM.
export class Axis {
  constructor(def) { this.def = def; this.o = new Map(); this.keys = []; this.pre = [] }
  set(i, size) { this.o.set(i, size) }
  build() {
    this.keys = [...this.o.keys()].sort((a, b) => a - b)
    let acc = 0
    this.pre = this.keys.map((k) => (acc += this.o.get(k) - this.def))
  }
  size(i) { const v = this.o.get(i); return v === undefined ? this.def : v }
  /** Sum of sizes of [0, i). */
  offset(i) {
    let lo = 0, hi = this.keys.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.keys[m] < i) lo = m + 1; else hi = m }
    return i * this.def + (lo ? this.pre[lo - 1] : 0)
  }
  /** Index of the visible item that contains px. */
  at(px, max = 2000000) {
    if (px <= 0) { let i = 0; while (this.size(i) === 0 && i < max) i++; return i }
    let lo = 0, hi = max
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.offset(m) <= px) lo = m; else hi = m - 1 }
    while (this.size(lo) === 0 && lo < max) lo++
    return lo
  }
  /** Next visible index after i in direction dir (+1/-1), or i when none. */
  step(i, dir, limit) {
    let j = i + dir
    while (j >= 0 && j < limit && this.size(j) === 0) j += dir
    return j < 0 || j >= limit ? i : j
  }
}

/** Font size of a style in screen pixels at 100% zoom (fs is stored in points; 11pt shows as 13px). */
export const fontPx = (st) => (st.fs ? (st.fs * 13) / 11 : 13)
