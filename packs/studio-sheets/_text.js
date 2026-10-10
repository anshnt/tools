// Delimited text (CSV/TSV) parsing and writing. No DOM.

/** Parse CSV/TSV text with quoted fields into a matrix of strings. */
export function parseDelimited(text, delim = ',') {
  const rows = []
  let row = [], cur = '', q = false, i = 0
  const n = text.length
  if (text.charCodeAt(0) === 0xfeff) i = 1
  for (; i < n; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch
    } else if (ch === '"' && cur === '') q = true
    else if (ch === delim) { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows
}

/** Guess the delimiter of a text file from its first lines. */
export function sniffDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 10).filter(Boolean)
  let best = ',', bestScore = -1
  for (const d of [',', '\t', ';', '|']) {
    const counts = sample.map((l) => parseDelimited(l, d)[0]?.length || 0)
    if (!counts.length || counts[0] < 2) continue
    const same = counts.filter((c) => c === counts[0]).length
    const score = same * 100 + counts[0]
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best
}

export function toDelimited(rows, delim = ',') {
  const esc = (s) => (s.includes(delim) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s)
  return rows.map((r) => r.map((v) => esc(v == null ? '' : String(v))).join(delim)).join('\r\n')
}
