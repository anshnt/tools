// In-place text editing: story model <-> contenteditable DOM, plus formatting commands on the live selection.
import { styleOf } from './_text.js'
import { paraStyle, charStyle, para } from './_model.js'

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const BLOCKS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL'])
const INVISIBLE = new RegExp('[' + String.fromCharCode(0x200b, 0xfeff) + ']', 'g')

function css(st) {
  return `font-family:"${st.f.css}",sans-serif;font-weight:${st.f.weight};font-style:${st.f.italic ? 'italic' : 'normal'};font-size:${st.size}px;color:${st.color};` +
    (st.tracking ? `letter-spacing:${st.tracking / 1000}em;` : '') + (st.caps ? 'text-transform:uppercase;' : '')
}

/** Fill `root` with one <div> per paragraph, styled like the canvas renders it. */
export function storyToDom(doc, story, root) {
  root.replaceChildren()
  for (const p of story.paras.length ? story.paras : [para('')]) {
    const ps = paraStyle(doc, p.ps)
    const o = p.o || {}
    const eff = (k) => (o[k] !== undefined ? o[k] : ps[k])
    const base = styleOf(doc, p, { t: '' })
    const div = document.createElement('div')
    div.dataset.ps = ps.id
    div.dataset.o = JSON.stringify(o)
    div.style.cssText = `${css(base)}line-height:${eff('lh')};text-align:${eff('align') === 'justify' ? 'justify' : eff('align')};margin:${eff('before') || 0}px 0 ${eff('after') || 0}px;` +
      `padding-left:${eff('left') || 0}px;text-indent:${eff('indent') || 0}px;`
    let any = false
    for (const r of p.runs) {
      if (!r.t) continue
      const parts = r.t.split('\n')
      parts.forEach((txt, i) => {
        if (i > 0) div.append(document.createElement('br'))
        if (!txt) return
        const st = styleOf(doc, p, r)
        const span = document.createElement('span')
        span.dataset.g = '1' // generated: its inline style mirrors the model, so parsing reads the data attributes only
        if (r.cs) span.dataset.cs = r.cs
        if (r.b) span.dataset.b = '1'
        if (r.i) span.dataset.i = '1'
        if (r.u) span.dataset.u = '1'
        if (r.c) span.dataset.c = r.c
        if (r.cs || r.b || r.i || r.c) span.style.cssText = css(st)
        if (r.u || charStyle(doc, r.cs)?.underline) span.style.textDecoration = 'underline'
        span.textContent = txt
        div.append(span)
        any = true
      })
    }
    if (!any && !div.querySelector('br')) div.append(document.createElement('br'))
    root.append(div)
  }
}

const hex = (c) => {
  if (!c) return null
  if (c.startsWith('#')) return c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c.toLowerCase()
  const m = c.match(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/)
  return m ? '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('') : null
}

/** Parse the editor DOM back into paragraphs [{ps, o, runs}]. Unknown markup is flattened; only the formats we model survive. */
export function domToParas(doc, root) {
  const paras = []
  let cur = null
  const startPara = (el, from) => {
    let o = from ? { ...from.o } : {}
    try { if (el?.dataset?.o) o = JSON.parse(el.dataset.o) } catch { /* keep inherited */ }
    cur = { ps: el?.dataset?.ps || from?.ps || paras[paras.length - 1]?.ps || doc.styles.para[0].id, o, runs: [] }
    if (!doc.styles.para.some((s) => s.id === cur.ps)) cur.ps = doc.styles.para[0].id
    paras.push(cur)
  }
  const push = (t, st) => {
    if (!t) return
    if (!cur) startPara(null)
    const last = cur.runs[cur.runs.length - 1]
    const same = last && ['b', 'i', 'u', 'c', 'cs'].every((k) => (last[k] || null) === (st[k] || null))
    if (same) last.t += t
    else cur.runs.push({ t, ...Object.fromEntries(Object.entries(st).filter(([, v]) => v)) })
  }
  const walk = (node, st, depth) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) { push(ch.nodeValue.split(String.fromCharCode(160)).join(' ').replace(INVISIBLE, ''), st); continue }
      if (ch.nodeType !== 1) continue
      const tag = ch.tagName
      if (tag === 'BR') {
        if (ch.nextSibling) push(String.fromCharCode(10), st) // a trailing <br> is only the placeholder that keeps an empty line open
        continue
      }
      if (BLOCKS.has(tag)) {
        if (depth === 0) startPara(ch)
        else if (ch.dataset.ps || cur?.runs.length) startPara(ch, cur)
        walk(ch, st, depth + 1)
        continue
      }
      const next = { ...st }
      if (tag === 'B' || tag === 'STRONG') next.b = true
      if (tag === 'I' || tag === 'EM') next.i = true
      if (tag === 'U') next.u = true
      const sty = ch.style
      if (ch.dataset?.g) {
        if (ch.dataset.b) next.b = true
        if (ch.dataset.i) next.i = true
        if (ch.dataset.u) next.u = true
        if (ch.dataset.c) next.c = ch.dataset.c
      } else if (sty) {
        const w = sty.fontWeight
        if (w === 'bold' || w === 'bolder' || +w >= 600) next.b = true
        else if (w === 'normal' || +w === 400) next.b = false
        if (sty.fontStyle === 'italic') next.i = true
        else if (sty.fontStyle === 'normal') next.i = false
        const td = sty.textDecorationLine || sty.textDecoration || ''
        if (/underline/.test(td)) next.u = true
        else if (/none/.test(td)) next.u = false
        if (sty.color) next.c = hex(sty.color)
      }
      if (tag === 'FONT' && ch.getAttribute('color')) next.c = hex(ch.getAttribute('color'))
      if (ch.dataset && 'cs' in ch.dataset) next.cs = ch.dataset.cs || undefined
      walk(ch, next, depth)
    }
  }
  walk(root, {}, 0)
  for (const p of paras) { if (!p.runs.length) p.runs.push({ t: '' }) }
  return paras.length ? paras : [para('')]
}

/** Paragraph <div>s that the current selection touches. */
export function selectedParas(root) {
  const sel = window.getSelection()
  if (!sel.rangeCount) return []
  const r = sel.getRangeAt(0)
  const divOf = (n) => { while (n && n.parentNode !== root) n = n.parentNode; return n }
  const a = divOf(r.startContainer), b = divOf(r.endContainer)
  if (!a || !b || a.parentNode !== root) return []
  const kids = [...root.children]
  return kids.slice(kids.indexOf(a), kids.indexOf(b) + 1)
}

/** Apply a char style (or clear it with '') to the selected text. */
export function applyCharStyle(root, id) {
  const sel = window.getSelection()
  if (!sel.rangeCount || sel.isCollapsed) return false
  const r = sel.getRangeAt(0)
  const wrap = document.createElement('div')
  wrap.append(r.cloneContents())
  document.execCommand('insertHTML', false, `<span data-cs="${esc(id)}">${wrap.innerHTML}</span>`)
  return true
}

/** Turn a .txt or .md file into paragraphs. Markdown headings, bullets, **bold** and *italic* map onto the document styles. */
export function parseTextFile(text, markdown, doc) {
  const has = (id) => doc.styles.para.some((s) => s.id === id)
  const out = []
  const inline = (t) => {
    const runs = []
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g
    let last = 0, m
    while ((m = re.exec(t))) {
      if (m.index > last) runs.push({ t: t.slice(last, m.index) })
      const tok = m[0]
      runs.push(tok.startsWith('**') ? { t: tok.slice(2, -2), b: true } : { t: tok.slice(1, -1), i: true })
      last = m.index + tok.length
    }
    if (last < t.length) runs.push({ t: t.slice(last) })
    return runs.length ? runs : [{ t: '' }]
  }
  for (const raw of text.split(String.fromCharCode(13)).join('').split(String.fromCharCode(10))) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    if (!markdown) { out.push({ ps: doc.styles.para[0].id, o: {}, runs: [{ t: line.trim() }] }); continue }
    let m
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) out.push({ ps: m[1].length === 1 ? (has('title') ? 'title' : 'h1') : m[1].length === 2 ? (has('h1') ? 'h1' : doc.styles.para[0].id) : (has('h2') ? 'h2' : doc.styles.para[0].id), o: {}, runs: inline(m[2]) })
    else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) out.push({ ps: has('bullets') ? 'bullets' : doc.styles.para[0].id, o: {}, runs: inline(m[1]) })
    else out.push({ ps: doc.styles.para[0].id, o: {}, runs: inline(line.trim()) })
  }
  return out.length ? out : [para('')]
}
