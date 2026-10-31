// The common document model every converter in this pack goes through: HTML in, a small block/run tree out, then writers (DOCX, ODT, RTF,
// HWPX, EPUB, Markdown, plain text) walk that tree. Readers (RTF, ODT, HWP, EML ...) produce HTML, so one walker serves them all.
//
// Block: {t:'p', runs, level?:1-6, align?, list?:{ordered, level, n, type?}, quote?:depth, code?:true, cont?:listLevel}
//        {t:'table', rows:[[{blocks, th, colspan, rowspan, bg}]]}   {t:'hr'}   {t:'pagebreak'}
// Run:   {text, b, i, u, s, sup, sub, mono, color:'rrggbb', bg, size:pt, font, href}  |  {br:true}  |  {tab:true}  |  {img:{bytes, mime, w, h, alt}}
import { parseHtml, parseDataUrl, normalizeImage, hex6, romanOf, alphaOf, esc, bytesToBase64 } from './_util.js'

const SKIP = new Set(['script', 'style', 'head', 'meta', 'link', 'title', 'noscript', 'template', 'object', 'embed', 'iframe', 'svg', 'canvas', 'audio', 'video', 'form', 'button', 'select', 'textarea', 'colgroup', 'col', 'area', 'map'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figure', 'figcaption', 'details', 'summary', 'address', 'center', 'dl', 'dt', 'dd', 'fieldset', 'legend', 'body', 'html', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'caption', 'hgroup', 'li'])
const INLINE_STYLE = {
  b: { b: true }, strong: { b: true }, i: { i: true }, em: { i: true }, cite: { i: true }, dfn: { i: true }, var: { i: true }, u: { u: true }, ins: { u: true },
  s: { s: true }, strike: { s: true }, del: { s: true }, sup: { sup: true }, sub: { sub: true }, code: { mono: true }, kbd: { mono: true }, samp: { mono: true }, tt: { mono: true },
  mark: { bg: 'ffff00' }, th: { b: true },
}
const NAMED_SIZES = { 'xx-small': 7, 'x-small': 8, small: 9, medium: 11, large: 13, 'x-large': 16, 'xx-large': 20 }
const FONT_TAG_SIZE = [0, 8, 10, 12, 14, 18, 24, 36]

function cssSize(v, base) {
  v = String(v || '').trim().toLowerCase()
  if (NAMED_SIZES[v]) return NAMED_SIZES[v]
  const m = /^([\d.]+)\s*(pt|px|em|rem|%)?$/.exec(v)
  if (!m) return null
  const n = parseFloat(m[1])
  switch (m[2]) { case 'pt': return n; case 'px': case undefined: return n * 0.75; case 'em': case 'rem': return n * base; case '%': return (n / 100) * base; default: return null }
}

function styleOf(el, ctx) {
  const c = { ...ctx }
  const tag = el.localName
  Object.assign(c, INLINE_STYLE[tag] || {})
  if (tag === 'a' && el.getAttribute('href')) c.href = el.getAttribute('href')
  if (tag === 'font') {
    const col = hex6(el.getAttribute('color')); if (col) c.color = col
    const face = el.getAttribute('face'); if (face) c.font = face.split(',')[0].replace(/['"]/g, '').trim()
    const sz = el.getAttribute('size'); if (sz && FONT_TAG_SIZE[+sz]) c.size = FONT_TAG_SIZE[+sz]
  }
  const st = el.getAttribute('style')
  if (st) {
    for (const decl of st.split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const k = decl.slice(0, i).trim().toLowerCase(), v = decl.slice(i + 1).trim()
      const lv = v.toLowerCase()
      if (k === 'font-weight') c.b = lv === 'bold' || lv === 'bolder' || +lv >= 600 ? true : lv === 'normal' || +lv < 600 ? false : c.b
      else if (k === 'font-style') c.i = /italic|oblique/.test(lv) ? true : lv === 'normal' ? false : c.i
      else if (k === 'text-decoration' || k === 'text-decoration-line') {
        if (/underline/.test(lv)) c.u = true
        if (/line-through/.test(lv)) c.s = true
        if (lv === 'none') { c.u = false; c.s = false }
      } else if (k === 'color') { const col = hex6(v); if (col) c.color = col }
      else if (k === 'background-color' || k === 'background') { const col = hex6(v.split(/\s+/)[0]); if (col && col !== 'ffffff') c.bg = col }
      else if (k === 'font-size') { const s = cssSize(v, ctx.size || 11); if (s) c.size = Math.round(s * 2) / 2 }
      else if (k === 'font-family') { const f = v.split(',')[0].replace(/['"]/g, '').trim(); if (f && !/^(inherit|initial)$/i.test(f)) { c.font = f; if (/mono|courier|consolas/i.test(v)) c.mono = true } }
      else if (k === 'vertical-align') { if (lv === 'super') c.sup = true; else if (lv === 'sub') c.sub = true }
    }
  }
  return c
}
const hiddenEl = (el) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') || '') || el.hasAttribute('hidden')

/** Parse HTML into blocks. -> {blocks, title} (images carry `raw` until resolveImages runs). */
export function htmlToAst(html, { baseSize = 11 } = {}) {
  const doc = typeof html === 'string' ? parseHtml(html) : html
  const title = doc.querySelector('title')?.textContent?.trim() || ''
  const blocks = walkBlocks(doc.body || doc.documentElement, { size: baseSize })
  return { blocks, title }
}

function walkBlocks(root, ctx, opts = {}) {
  const out = []
  const st = { cur: [], props: {}, lists: [], pendingList: null, quote: 0, out }
  const flush = () => {
    const runs = st.cur
    st.cur = []
    // trim whitespace at the paragraph edges
    while (runs.length && runs[0].text !== undefined && !/\S/.test(runs[0].text)) runs.shift()
    if (runs[0]?.text !== undefined) runs[0].text = runs[0].text.replace(/^\s+/, '')
    while (runs.length && runs[runs.length - 1].text !== undefined && !/\S/.test(runs[runs.length - 1].text)) runs.pop()
    const last = runs[runs.length - 1]
    if (last?.text !== undefined) last.text = last.text.replace(/\s+$/, '')
    if (!runs.length) return
    const p = { t: 'p', runs, ...st.props }
    if (st.pendingList) { p.list = st.pendingList; st.pendingList = null } else if (st.lists.length) p.cont = st.lists.length - 1
    if (st.quote) p.quote = st.quote
    out.push(p)
  }
  const addText = (data, ctx2, pre) => {
    let s = pre ? data.replace(/\r\n?/g, '\n') : data.replace(/[ \t\r\n\f]+/g, ' ')
    if (!s) return
    if (!pre && s === ' ' && !st.cur.length) return
    const run = { text: s }
    for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'mono', 'color', 'bg', 'size', 'font', 'href']) if (ctx2[k]) run[k] = ctx2[k]
    const prev = st.cur[st.cur.length - 1]
    if (prev && prev.text !== undefined && ['b', 'i', 'u', 's', 'sup', 'sub', 'mono', 'color', 'bg', 'size', 'font', 'href'].every((k) => prev[k] === run[k])) {
      if (!(prev.text.endsWith(' ') && run.text.startsWith(' '))) prev.text += run.text
      else prev.text += run.text.slice(1)
    } else if (!(prev?.text?.endsWith(' ') && run.text.startsWith(' '))) st.cur.push(run)
    else { run.text = run.text.slice(1); if (run.text) st.cur.push(run) }
  }
  const alignOf = (el) => {
    const a = (el.getAttribute('align') || /text-align\s*:\s*(left|right|center|justify)/i.exec(el.getAttribute('style') || '')?.[1] || '').toLowerCase()
    return ['left', 'right', 'center', 'justify'].includes(a) ? a : el.localName === 'center' ? 'center' : null
  }

  function walk(node, c) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { addText(n.data, c, false); continue }
      if (n.nodeType !== 1) continue
      const tag = n.localName
      if (SKIP.has(tag) || hiddenEl(n)) continue
      const cc = styleOf(n, c)
      if (tag === 'br') { st.cur.push({ br: true }); continue }
      if (tag === 'img') {
        const src = n.getAttribute('src') || ''
        const d = parseDataUrl(src)
        if (d && (/^image\//.test(d.mime) || d.mime === 'application/octet-stream')) st.cur.push({ img: { raw: d, alt: n.getAttribute('alt') || '', w: +n.getAttribute('width') || 0, h: +n.getAttribute('height') || 0 } })
        else if (n.getAttribute('alt')) addText(`[${n.getAttribute('alt')}]`, cc, false)
        continue
      }
      if (tag === 'hr') { flush(); out.push({ t: 'hr' }); continue }
      if (tag === 'wbr') continue
      if (tag === 'table') { flush(); const t = tableOf(n, cc); if (t) out.push(t); continue }
      if (tag === 'pre') {
        flush()
        const text = n.textContent.replace(/\r\n?/g, '\n').replace(/^\n/, '').replace(/\n$/, '')
        for (const line of text.split('\n')) out.push({ t: 'p', code: true, runs: [{ text: line.replace(/\t/g, '    '), mono: true }], ...(st.quote ? { quote: st.quote } : {}) })
        continue
      }
      if (tag === 'ul' || tag === 'ol') {
        flush()
        const start = tag === 'ol' ? (parseInt(n.getAttribute('start'), 10) || 1) : 1
        const lt = (n.getAttribute('type') || /list-style-type\s*:\s*([\w-]+)/i.exec(n.getAttribute('style') || '')?.[1] || '').toLowerCase()
        st.lists.push({ ordered: tag === 'ol', n: start - 1, type: { a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman', 1: 'decimal' }[n.getAttribute('type')] || lt || 'decimal' })
        walk(n, cc)
        flush(); st.pendingList = null
        st.lists.pop()
        continue
      }
      if (tag === 'li') {
        flush()
        const L = st.lists[st.lists.length - 1]
        if (L) {
          const v = parseInt(n.getAttribute('value'), 10)
          if (v) L.n = v - 1
          L.n++
          st.pendingList = { ordered: L.ordered, level: st.lists.length - 1, n: L.n, type: L.type }
        }
        const task = n.querySelector(':scope > input[type=checkbox]')
        const saved = st.props
        st.props = { ...saved }
        if (task) st.props.task = task.hasAttribute('checked')
        walk(n, cc)
        flush(); st.pendingList = null
        st.props = saved
        continue
      }
      if (tag === 'blockquote') { flush(); st.quote++; walk(n, cc); flush(); st.quote--; continue }
      if (BLOCK.has(tag)) {
        flush()
        const saved = st.props
        const props = { ...saved }
        const a = alignOf(n)
        if (a) props.align = a
        if (/^h[1-6]$/.test(tag)) props.level = +tag[1]
        st.props = props
        walk(n, tag === 'dt' ? { ...cc, b: true } : cc)
        flush()
        st.props = saved
        continue
      }
      if (tag === 'input' || tag === 'label') { if (tag === 'label') walk(n, cc); continue }
      // inline element
      if (n.hasAttribute('align') && n.localName === 'span') { /* ignore */ }
      walk(n, cc)
    }
  }

  function tableOf(tbl, c) {
    const rows = []
    const trs = [...tbl.querySelectorAll('tr')].filter((tr) => tr.closest('table') === tbl)
    for (const tr of trs) {
      const cells = []
      for (const td of tr.children) {
        if (td.localName !== 'td' && td.localName !== 'th') continue
        const cs = styleOf(td, c)
        const inner = walkBlocks(td, td.localName === 'th' ? { ...cs, b: true } : cs)
        const bg = hex6(td.getAttribute('bgcolor')) || hex6(/background(?:-color)?\s*:\s*([^;]+)/i.exec(td.getAttribute('style') || '')?.[1]?.trim().split(/\s+/)[0])
        cells.push({ blocks: inner.length ? inner : [{ t: 'p', runs: [{ text: '' }] }], th: td.localName === 'th', colspan: Math.max(1, parseInt(td.getAttribute('colspan'), 10) || 1), rowspan: Math.max(1, parseInt(td.getAttribute('rowspan'), 10) || 1), bg: bg && bg !== 'ffffff' ? bg : null, align: alignOf(td) })
      }
      if (cells.length) rows.push(cells)
    }
    if (!rows.length) return null
    const border = tbl.getAttribute('border') !== '0' && !/border\s*:\s*(none|0)/i.test(tbl.getAttribute('style') || '')
    return { t: 'table', rows, border }
  }

  walk(root, ctx)
  flush()
  return out
}

/** Decode and size every image in the tree. Images that cannot be decoded are replaced by their alt text. Mutates and returns `blocks`. */
export async function resolveImages(blocks) {
  const jobs = []
  const visit = (list) => {
    for (const b of list) {
      if (b.t === 'p') for (let i = 0; i < b.runs.length; i++) { const r = b.runs[i]; if (r.img?.raw) jobs.push({ run: r, run_i: i, par: b }) }
      else if (b.t === 'table') for (const row of b.rows) for (const cell of row) visit(cell.blocks)
    }
  }
  visit(blocks)
  const cache = new Map()
  await Promise.all(jobs.map(async ({ run, par }) => {
    const { raw, alt, w: hw, h: hh } = run.img
    let key = raw.bytes.length + ':' + raw.mime + ':' + raw.bytes[10] + raw.bytes[raw.bytes.length >> 1]
    let norm = cache.get(key)
    if (norm === undefined) { norm = await normalizeImage(raw.bytes, raw.mime); cache.set(key, norm) }
    if (!norm) { delete run.img; run.text = alt ? `[${alt}]` : ''; return }
    // display size in px: the width/height attributes win, otherwise the picture's own size
    let w = hw || norm.w, h = hh || norm.h
    if (hw && !hh) h = Math.round((hw * norm.h) / norm.w)
    if (!hw && hh) w = Math.round((hh * norm.w) / norm.h)
    run.img = { bytes: norm.bytes, mime: norm.mime, w, h, alt }
  }))
  const prune = (list) => { for (const b of list) { if (b.t === 'p') b.runs = b.runs.filter((r) => !(r.text === '' && !r.br && !r.img && !r.tab)); else if (b.t === 'table') for (const row of b.rows) for (const cell of row) prune(cell.blocks) } }
  prune(blocks)
  return blocks
}

/** Convenience: HTML -> resolved AST. */
export async function htmlToBlocks(html, opts) {
  const r = htmlToAst(html, opts)
  await resolveImages(r.blocks)
  return r
}

export const runText = (runs) => runs.map((r) => (r.br ? '\n' : r.tab ? '\t' : r.img ? (r.img.alt ? `[${r.img.alt}]` : '') : r.text || '')).join('')
export const blockText = (b) => (b.t === 'p' ? runText(b.runs) : b.t === 'table' ? b.rows.map((r) => r.map((c) => c.blocks.map(blockText).join(' ')).join('\t')).join('\n') : '')

const listMarker = (l) => {
  if (!l.ordered) return '\u2022'
  switch (l.type) { case 'lower-alpha': case 'lower-latin': return alphaOf(l.n) + '.'; case 'upper-alpha': case 'upper-latin': return alphaOf(l.n).toUpperCase() + '.'; case 'lower-roman': return romanOf(l.n) + '.'; case 'upper-roman': return romanOf(l.n).toUpperCase() + '.'; default: return l.n + '.' }
}
export { listMarker }

/** Blocks -> plain text. Tables become tab-separated rows. */
export function astToText(blocks, { tab = '\t' } = {}) {
  const lines = []
  const push = (s) => lines.push(s)
  const gap = () => { if (lines.length && lines[lines.length - 1] !== '') lines.push('') }
  let prevList = false
  const emit = (list) => {
    for (const b of list) {
      if (b.t === 'p') {
        const text = runText(b.runs)
        const q = b.quote ? '> '.repeat(b.quote) : ''
        if (b.list) { push(`${q}${'  '.repeat(b.list.level)}${b.task !== undefined ? (b.task ? '[x] ' : '[ ] ') : listMarker(b.list) + ' '}${text}`); prevList = true; continue }
        if (b.cont != null) { push(`${q}${'  '.repeat(b.cont + 1)}${text}`); prevList = true; continue }
        if (b.code) { push(text); prevList = false; continue }
        if (prevList || (lines.length && lines[lines.length - 1] !== '')) gap()
        push(q + text)
        gap()
        prevList = false
      } else if (b.t === 'table') {
        gap()
        for (const row of b.rows) push(row.map((c) => c.blocks.map(blockText).join(' ').replace(/\s*\n\s*/g, ' ')).join(tab))
        gap(); prevList = false
      } else if (b.t === 'hr') { gap(); push('----------'); gap(); prevList = false }
    }
  }
  emit(blocks)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Blocks -> Markdown. images: 'inline' (data URLs), 'files' (images/imageN.ext, returned in `images`) or 'none'. -> {text, images:[{name, bytes, mime}]} */
export function astToMarkdown(blocks, { images = 'files' } = {}) {
  const imgs = []
  const lines = []
  const escMd = (s) => s.replace(/([\`*_{}\[\]<>|])/g, '\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\$2$3')
  const wrap = (t, mark) => { const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t); return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : t }
  const inline = (runs, inTable) => runs.map((r) => {
    if (r.br) return inTable ? '<br>' : '  \n'
    if (r.tab) return '    '
    if (r.img) {
      if (images === 'none') return r.img.alt ? `[${r.img.alt}]` : ''
      if (images === 'inline') return `![${r.img.alt || ''}](data:${r.img.mime};base64,${bytesToBase64(r.img.bytes)})`
      const name = `images/image${imgs.length + 1}.${{ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }[r.img.mime] || 'png'}`
      imgs.push({ name, bytes: r.img.bytes, mime: r.img.mime })
      return `![${r.img.alt || ''}](${name})`
    }
    let t = r.mono ? '`' + (r.text || '').replace(/`/g, "'") + '`' : escMd(r.text || '')
    if (!t.trim()) return t
    if (r.b && r.i) t = wrap(t, '***'); else if (r.b) t = wrap(t, '**'); else if (r.i) t = wrap(t, '*')
    if (r.s) t = wrap(t, '~~')
    if (r.href) t = `[${t}](${r.href})`
    return t
  }).join('')
  const blank = () => { if (lines.length && lines[lines.length - 1] !== '') lines.push('') }
  let prevList = false, prevOrdered = null
  const emit = (b) => {
    if (b.t === 'p') {
      const text = inline(b.level ? b.runs.map((r) => (r.b ? { ...r, b: false } : r)) : b.runs)
      const q = b.quote ? '> '.repeat(b.quote) : ''
      if (b.list) { if (!prevList || prevOrdered !== b.list.ordered) { if (prevList && prevOrdered !== b.list.ordered) blank() } prevOrdered = b.list.ordered;  lines.push(`${q}${'  '.repeat(b.list.level)}${b.list.ordered ? b.list.n + '.' : '-'} ${b.task !== undefined ? (b.task ? '[x] ' : '[ ] ') : ''}${text}`); prevList = true; return }
      if (b.cont != null) { lines.push(`${q}${'  '.repeat(b.cont + 1)}${text}`); prevList = true; return }
      blank()
      lines.push(b.level ? `${q}${'#'.repeat(b.level)} ${text.replace(/\n/g, ' ')}` : q + text)
      blank(); prevList = false
    } else if (b.t === 'table') {
      blank()
      const cell = (c) => c.blocks.map((x) => (x.t === 'p' ? inline(x.runs, true) : blockText(x))).join('<br>').replace(/\|/g, '\|').replace(/\n/g, ' ') || ' '
      const rows = b.rows.map((r) => r.flatMap((c) => [cell(c), ...Array.from({ length: c.colspan - 1 }, () => ' ')]))
      const n = Math.max(...rows.map((r) => r.length))
      rows.forEach((r, i) => { while (r.length < n) r.push(' '); lines.push(`| ${r.join(' | ')} |`); if (i === 0) lines.push(`|${' --- |'.repeat(n)}`) })
      blank(); prevList = false
    } else if (b.t === 'hr') { blank(); lines.push('---'); blank() }
  }
  for (let i = 0; i < blocks.length;) {
    const b = blocks[i]
    if (b.t === 'p' && b.code) {
      const g = []
      while (i < blocks.length && blocks[i].t === 'p' && blocks[i].code) g.push(blocks[i++].runs.map((r) => r.text).join(''))
      blank(); lines.push('```', ...g, '```'); blank()
    } else { emit(b); i++ }
  }
  void prevList
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', images: imgs }
}

/** Render blocks back to simple semantic HTML (used by writers that go through HTML, e.g. EPUB from RTF). Images become data URLs unless `imgSrc` maps them. */
export function astToHtml(blocks, { imgSrc } = {}) {
  let n = 0
  const run = (r) => {
    if (r.br) return '<br>'
    if (r.tab) return '&emsp;'
    if (r.img) return `<img src="${imgSrc ? imgSrc(r.img, ++n) : `data:${r.img.mime};base64,${bytesToBase64(r.img.bytes)}`}"${r.img.w ? ` width="${Math.round(r.img.w)}"` : ''} alt="${esc(r.img.alt || '')}">`
    let t = esc(r.text || '')
    const st = []
    if (r.color) st.push(`color:#${r.color}`)
    if (r.bg) st.push(`background:#${r.bg}`)
    if (r.size) st.push(`font-size:${r.size}pt`)
    if (r.font) st.push(`font-family:'${r.font.replace(/'/g, '')}'`)
    if (st.length) t = `<span style="${st.join(';')}">${t}</span>`
    if (r.mono) t = `<code>${t}</code>`
    if (r.sup) t = `<sup>${t}</sup>`
    if (r.sub) t = `<sub>${t}</sub>`
    if (r.s) t = `<s>${t}</s>`
    if (r.u) t = `<u>${t}</u>`
    if (r.i) t = `<em>${t}</em>`
    if (r.b) t = `<strong>${t}</strong>`
    if (r.href) t = `<a href="${esc(r.href)}">${t}</a>`
    return t
  }
  let html = ''
  let openList = []
  const closeLists = (to = 0) => { while (openList.length > to) html += `</li></${openList.pop().tag}>` }
  const emit = (list) => {
    for (const b of list) {
      if (b.t === 'p') {
        const inner = b.runs.map(run).join('')
        if (b.list) {
          const want = b.list.level + 1
          if (openList.length > want) closeLists(want)
          if (openList.length === want && openList[want - 1].tag !== (b.list.ordered ? 'ol' : 'ul')) closeLists(want - 1)
          if (openList.length === want) html += '</li>'
          while (openList.length < want) { const tag = b.list.ordered ? 'ol' : 'ul'; openList.push({ tag }); html += `<${tag}>` }
          html += `<li>${inner}`
          continue
        }
        if (b.cont != null && openList.length) { html += `<br>${inner}`; continue }
        closeLists()
        const al = b.align ? ` style="text-align:${b.align}"` : ''
        if (b.code) html += `<pre>${inner}</pre>`
        else if (b.level) html += `<h${b.level}${al}>${inner}</h${b.level}>`
        else if (b.quote) html += `<blockquote><p>${inner}</p></blockquote>`
        else html += `<p${al}>${inner}</p>`
      } else if (b.t === 'table') {
        closeLists()
        html += `<table${b.border ? ' border="1"' : ''}>`
        for (const row of b.rows) {
          html += '<tr>'
          for (const c of row) {
            const tag = c.th ? 'th' : 'td'
            const saved = html
            html = ''
            const prevOpen = openList
            openList = []
            emit(c.blocks)
            closeLists()
            const inner = html
            html = saved
            openList = prevOpen
            html += `<${tag}${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}${c.bg ? ` style="background:#${c.bg}"` : ''}>${inner}</${tag}>`
          }
          html += '</tr>'
        }
        html += '</table>'
      } else if (b.t === 'hr') { closeLists(); html += '<hr>' } else if (b.t === 'pagebreak') { closeLists(); html += '<hr class="pagebreak">' }
    }
  }
  emit(blocks)
  closeLists()
  return html
}
