// XHTML chapter -> a flat list of blocks that the PDF, DOCX, TXT and Markdown writers share.
//   { t: 'h', level, runs } | { t: 'p', runs, quote } | { t: 'li', runs, depth, marker, quote } | { t: 'pre', text }
//   { t: 'img', src, alt } | { t: 'hr' } | { t: 'table', rows: [[runs]] }
// runs: { text, b, i, u, s, sup, sub, code, href } or { br: true }
import { parseHtml } from './_book.js'

const SHY = String.fromCharCode(0xad) // soft hyphens would show as stray characters in PDF, DOCX and TXT
const HEADING = /^h([1-6])$/
const BLOCKY = new Set(['p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav', 'figure', 'figcaption', 'address', 'details', 'summary', 'dl', 'dt', 'dd', 'center', 'body', 'caption'])
const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'svg', 'audio', 'video', 'object', 'iframe'])

function styleOf(el, st) {
  const n = el.localName
  const s = { ...st }
  if (n === 'b' || n === 'strong') s.b = true
  else if (n === 'i' || n === 'em' || n === 'cite' || n === 'dfn' || n === 'var') s.i = true
  else if (n === 'u' || n === 'ins') s.u = true
  else if (n === 's' || n === 'del' || n === 'strike') s.s = true
  else if (n === 'sup') s.sup = true
  else if (n === 'sub') s.sub = true
  else if (n === 'code' || n === 'tt' || n === 'kbd' || n === 'samp') s.code = true
  else if (n === 'a' && el.getAttribute('href')) s.href = el.getAttribute('href')
  const css = el.getAttribute('style') || ''
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(css)) s.b = true
  if (/font-style\s*:\s*italic/i.test(css)) s.i = true
  if (/text-decoration[^;]*underline/i.test(css)) s.u = true
  return s
}

const sameStyle = (a, b) => ['b', 'i', 'u', 's', 'sup', 'sub', 'code', 'href'].every((k) => (a[k] || false) === (b[k] || false))

/** @returns blocks */
export function htmlToBlocks(html) {
  const doc = parseHtml(`<body>${html}</body>`)
  const out = []
  let runs = []
  const ctx = { quote: 0, lists: [] }
  let pending = null // {t, level, marker, depth}

  const flush = (kind) => {
    // trim whitespace at both ends and merge neighbours
    const merged = []
    for (const r of runs) {
      const last = merged[merged.length - 1]
      if (!r.br && last && !last.br && sameStyle(last, r)) last.text += r.text
      else merged.push({ ...r })
    }
    while (merged.length && !merged[0].br && !merged[0].text.trim()) merged.shift()
    while (merged.length && !merged[merged.length - 1].br && !merged[merged.length - 1].text.trim()) merged.pop()
    while (merged.length && merged[merged.length - 1].br) merged.pop()
    if (merged.length && !merged[0].br) merged[0].text = merged[0].text.replace(/^\s+/, '')
    if (merged.length && !merged[merged.length - 1].br) merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, '')
    runs = []
    const p = pending
    pending = null
    if (!merged.length || merged.every((r) => r.br)) return
    const base = kind || p || { t: 'p' }
    out.push({ ...base, runs: merged, quote: ctx.quote })
  }
  const inlineText = (el, st) => {
    // collect runs of an element into a fresh buffer and return them
    const saved = runs
    runs = []
    for (const c of el.childNodes) walk(c, st)
    const got = runs
    runs = saved
    return got
  }

  function walk(node, st) {
    if (node.nodeType === 3) {
      const t = node.nodeValue.split(SHY).join('').replace(/[ \t\r\n\f]+/g, ' ')
      if (t) runs.push({ text: t, ...st })
      return
    }
    if (node.nodeType !== 1) return
    const n = node.localName.toLowerCase()
    if (SKIP.has(n)) return
    const h = n.match(HEADING)
    if (h) {
      flush()
      pending = { t: 'h', level: Number(h[1]) }
      for (const c of node.childNodes) walk(c, { ...st })
      flush()
      return
    }
    if (n === 'br') { runs.push({ br: true }); return }
    if (n === 'hr') { flush(); out.push({ t: 'hr' }); return }
    if (n === 'img') {
      flush()
      out.push({ t: 'img', src: node.getAttribute('src') || '', alt: node.getAttribute('alt') || '' })
      return
    }
    if (n === 'pre') {
      flush()
      const text = node.textContent.replace(/^\n/, '').replace(/\s+$/, '')
      if (text) out.push({ t: 'pre', text, quote: ctx.quote })
      return
    }
    if (n === 'table') {
      flush()
      const rows = []
      for (const tr of node.getElementsByTagName('tr')) {
        const cells = [...tr.children].filter((c) => /^t[hd]$/i.test(c.localName)).map((c) => {
          const rr = inlineText(c, c.localName === 'th' ? { ...st, b: true } : { ...st })
          return rr
        })
        if (cells.length) rows.push(cells)
      }
      if (rows.length) out.push({ t: 'table', rows })
      return
    }
    if (n === 'ul' || n === 'ol') {
      flush()
      ctx.lists.push({ ordered: n === 'ol', n: Number(node.getAttribute('start') || 1) - 1 })
      for (const c of node.children) {
        if (c.localName === 'li') {
          const L = ctx.lists[ctx.lists.length - 1]
          L.n++
          flush()
          pending = { t: 'li', depth: ctx.lists.length - 1, marker: L.ordered ? `${L.n}.` : '•' }
          walk2li(c, st)
          flush()
        } else walk(c, st)
      }
      ctx.lists.pop()
      return
    }
    if (n === 'blockquote') {
      flush()
      ctx.quote++
      for (const c of node.childNodes) walk(c, st)
      flush()
      ctx.quote--
      return
    }
    if (BLOCKY.has(n) || n === 'li' || n === 'dd' || n === 'dt') {
      flush()
      for (const c of node.childNodes) walk(c, st)
      flush()
      return
    }
    const s2 = styleOf(node, st)
    for (const c of node.childNodes) walk(c, s2)
  }
  // content of an <li>: inline text belongs to the item, nested lists and blocks start new blocks
  function walk2li(li, st) {
    for (const c of li.childNodes) {
      if (c.nodeType === 1 && (/^(ul|ol)$/.test(c.localName) || c.localName === 'table' || c.localName === 'pre')) {
        flush()
        walk(c, st)
      } else if (c.nodeType === 1 && (c.localName === 'p' || c.localName === 'div')) {
        // paragraphs inside an item continue the same item
        for (const cc of c.childNodes) walk(cc, st)
        runs.push({ text: ' ' })
      } else walk(c, st)
    }
  }
  for (const c of doc.body.childNodes) walk(c, {})
  flush()
  return out
}

/** The text of runs (line breaks become newlines). */
export const runsText = (runs) => runs.map((r) => (r.br ? '\n' : r.text)).join('')
