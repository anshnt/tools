// Document schema (ProseMirror) plus HTML parse/serialize helpers for the Docs editor.
// The schema doubles as the sanitizer: anything outside it is dropped when HTML is pasted or imported.
import { model, tables } from './vendor/prosemirror.js'

const { Schema, DOMParser: PMParser, DOMSerializer } = model

export const INDENT_PT = 36 // one indent level
export const MAX_INDENT = 8

export const FONTS = [
  ['Calibri', 'Calibri, Carlito, "Segoe UI", Arial, sans-serif'],
  ['Arial', 'Arial, Helvetica, sans-serif'],
  ['Cambria', 'Cambria, Caladea, Georgia, serif'],
  ['Georgia', 'Georgia, "Times New Roman", serif'],
  ['Times New Roman', '"Times New Roman", Times, serif'],
  ['Verdana', 'Verdana, Geneva, sans-serif'],
  ['Courier New', '"Courier New", Courier, monospace'],
]
export const FONT_STACK = Object.fromEntries(FONTS)
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]
export const DEFAULT_FONT = 'Calibri'
export const DEFAULT_SIZE = 11

const clamp = (n, a, b) => Math.min(b, Math.max(a, n))

/** Normalise a CSS colour to #rrggbb. Returns null for anything that is not a plain colour. */
export function normColor(v) {
  if (!v) return null
  v = String(v).trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('')
  const m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/)
  if (m) {
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    if (a === 0) return null
    return '#' + [m[1], m[2], m[3]].map((n) => clamp(+n, 0, 255).toString(16).padStart(2, '0')).join('')
  }
  if (/^[a-z]{3,20}$/.test(v) && !['transparent', 'inherit', 'initial', 'unset', 'currentcolor', 'windowtext', 'auto', 'none', 'revert'].includes(v)) {
    const probe = document.createElement('span')
    probe.style.color = v
    if (probe.style.color) {
      const ctx = document.createElement('canvas').getContext('2d')
      ctx.fillStyle = '#000'
      ctx.fillStyle = v
      const out = ctx.fillStyle
      return /^#[0-9a-f]{6}$/.test(out) ? out : null
    }
  }
  return null
}

const toPt = (v) => {
  const m = String(v || '').trim().match(/^([\d.]+)(pt|px)$/)
  if (!m) return null
  const n = parseFloat(m[1]) * (m[2] === 'px' ? 0.75 : 1)
  return n > 0 ? n : null
}

function cleanFamily(v) {
  const first = String(v || '').split(',')[0].replace(/["']/g, '').trim()
  if (!first) return null
  const known = FONTS.find(([n]) => n.toLowerCase() === first.toLowerCase())
  if (known) return known[0]
  const l = first.toLowerCase()
  if (/^(monospace|consolas|menlo|monaco|courier)/.test(l)) return 'Courier New'
  if (/^(serif|times|palatino|garamond|book antiqua)/.test(l)) return 'Times New Roman'
  if (/^(sans-serif|system-ui|helvetica|segoe|-apple-system|tahoma|trebuchet|aptos)/.test(l)) return l.startsWith('aptos') ? 'Aptos' : 'Arial'
  return /^[\w -]{2,40}$/.test(first) ? first : null
}

export const safeHref = (href) => {
  const v = String(href || '').trim()
  if (!v) return null
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(v)) return v
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null // javascript:, data:, file: ...
  return v // relative or bare host, left as typed
}
export const safeImageSrc = (src) => (/^(data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|avif);|blob:|https?:)/i.test(String(src || '').trim()) ? String(src).trim() : null)

// ---------- block attribute helpers ----------
const blockAttrs = () => ({ align: { default: null }, indent: { default: 0 } })
const readBlock = (dom) => {
  const align = (dom.style.textAlign || dom.getAttribute('align') || '').toLowerCase()
  const ml = toPt(dom.style.marginLeft) || toPt(dom.style.paddingLeft) || 0
  return {
    align: ['left', 'center', 'right', 'justify'].includes(align) ? align : null,
    indent: clamp(Math.round(ml / INDENT_PT), 0, MAX_INDENT),
  }
}
const writeBlock = (a, extra = {}) => {
  const css = []
  if (a.align) css.push(`text-align:${a.align}`)
  if (a.indent) css.push(`margin-left:${a.indent * INDENT_PT}pt`)
  if (a.lineHeight) css.push(`line-height:${a.lineHeight}`)
  const out = { ...extra }
  if (css.length) out.style = css.join(';')
  return out
}

const nodes = {
  doc: { content: 'block+' },
  paragraph: {
    content: 'inline*', group: 'block',
    attrs: { ...blockAttrs(), variant: { default: null }, lineHeight: { default: null } },
    parseDOM: [{
      tag: 'p',
      getAttrs: (dom) => {
        const lh = parseFloat(dom.style.lineHeight)
        const v = dom.getAttribute('data-variant') || (dom.classList.contains('dc-title') ? 'title' : dom.classList.contains('dc-subtitle') ? 'subtitle' : null)
        return { ...readBlock(dom), variant: v === 'title' || v === 'subtitle' ? v : null, lineHeight: lh > 0.5 && lh < 4 && /^[\d.]+$/.test(dom.style.lineHeight) ? lh : null }
      },
    }],
    toDOM: (n) => ['p', writeBlock(n.attrs, n.attrs.variant ? { 'data-variant': n.attrs.variant } : {}), 0],
  },
  heading: {
    content: 'inline*', group: 'block', defining: true, attrs: { ...blockAttrs(), level: { default: 1 } },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, getAttrs: (dom) => ({ ...readBlock(dom), level }) })),
    toDOM: (n) => [`h${n.attrs.level}`, writeBlock(n.attrs), 0],
  },
  blockquote: { content: 'block+', group: 'block', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
  code_block: {
    content: 'text*', marks: '', group: 'block', code: true, defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }], toDOM: () => ['pre', ['code', 0]],
  },
  horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr:not(.dc-pb)' }], toDOM: () => ['hr'] },
  page_break: {
    group: 'block', atom: true, selectable: true,
    parseDOM: [
      { tag: 'hr.dc-pb' },
      { tag: 'div[data-page-break]' },
      { tag: 'div', getAttrs: (d) => (/page-break-(after|before)\s*:\s*always/i.test(d.getAttribute('style') || '') && !d.textContent.trim() ? {} : false) },
    ],
    toDOM: () => ['div', { class: 'dc-pb', 'data-page-break': '' }],
  },
  bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul', getAttrs: (d) => (d.hasAttribute('data-task') ? false : {}) }], toDOM: () => ['ul', 0] },
  ordered_list: {
    content: 'list_item+', group: 'block', attrs: { order: { default: 1 } },
    parseDOM: [{ tag: 'ol', getAttrs: (d) => ({ order: d.hasAttribute('start') ? Math.max(1, parseInt(d.getAttribute('start'), 10) || 1) : 1 }) }],
    toDOM: (n) => (n.attrs.order === 1 ? ['ol', 0] : ['ol', { start: n.attrs.order }, 0]),
  },
  list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li', getAttrs: (d) => (d.hasAttribute('data-task') ? false : {}) }], toDOM: () => ['li', 0] },
  task_list: { content: 'task_item+', group: 'block', parseDOM: [{ tag: 'ul[data-task]' }], toDOM: () => ['ul', { 'data-task': '' }, 0] },
  task_item: {
    content: 'paragraph block*', defining: true, attrs: { checked: { default: false } },
    parseDOM: [{ tag: 'li[data-task]', getAttrs: (d) => ({ checked: d.getAttribute('data-checked') === 'true' }) }],
    toDOM: (n) => ['li', { 'data-task': '', 'data-checked': String(!!n.attrs.checked) }, 0],
  },
  image: {
    inline: true, group: 'inline', draggable: true,
    attrs: { src: {}, alt: { default: null }, width: { default: null }, height: { default: null } },
    parseDOM: [{
      tag: 'img[src]',
      getAttrs: (d) => {
        const src = safeImageSrc(d.getAttribute('src'))
        if (!src) return false
        const w = parseFloat(d.getAttribute('width') || d.style.width) || null
        const hh = parseFloat(d.getAttribute('height') || d.style.height) || null
        return { src, alt: d.getAttribute('alt') || null, width: w && w > 0 ? Math.round(w) : null, height: hh && hh > 0 && w ? Math.round(hh) : null }
      },
    }],
    toDOM: (n) => {
      const { src, alt, width, height } = n.attrs
      const a = { src, alt: alt || '' }
      if (width) { a.width = String(width); if (height) a.height = String(height) }
      return ['img', a]
    },
  },
  hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  text: { group: 'inline' },
  ...tables.tableNodes({
    tableGroup: 'block', cellContent: 'block+',
    cellAttributes: {
      background: {
        default: null,
        getFromDOM: (dom) => normColor(dom.getAttribute('data-bg') || dom.style.backgroundColor),
        setDOMAttr: (v, attrs) => { if (v) { attrs['data-bg'] = v; attrs.style = (attrs.style ? attrs.style + ';' : '') + `background-color:${v}` } },
      },
    },
  }),
}

const marks = {
  link: {
    attrs: { href: {}, title: { default: null } }, inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (d) => { const href = safeHref(d.getAttribute('href')); return href ? { href, title: d.getAttribute('title') } : false } }],
    toDOM: (m) => ['a', { href: m.attrs.href, title: m.attrs.title, rel: 'noopener noreferrer nofollow' }, 0],
  },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (d) => d.style.fontWeight !== 'normal' && null },
      { style: 'font-weight=400', clearMark: (m) => m.type.name === 'strong' },
      { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2,})$/.test(v) && null },
    ],
    toDOM: () => ['strong', 0],
  },
  em: { parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }, { style: 'font-style=normal', clearMark: (m) => m.type.name === 'em' }], toDOM: () => ['em', 0] },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: (v) => (/underline/.test(v) ? null : false), consuming: false }],
    toDOM: () => ['u', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration', getAttrs: (v) => (/line-through/.test(v) ? null : false), consuming: false }],
    toDOM: () => ['s', 0],
  },
  code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
  sub: { excludes: 'sup', parseDOM: [{ tag: 'sub' }, { style: 'vertical-align=sub' }], toDOM: () => ['sub', 0] },
  sup: { excludes: 'sub', parseDOM: [{ tag: 'sup' }, { style: 'vertical-align=super' }], toDOM: () => ['sup', 0] },
  color: {
    attrs: { color: {} },
    parseDOM: [{ style: 'color', consuming: false, getAttrs: (v) => { const c = normColor(v); return c && c !== '#000000' ? { color: c } : false } }],
    toDOM: (m) => ['span', { style: `color:${m.attrs.color}` }, 0],
  },
  highlight: {
    attrs: { color: { default: '#fff176' } },
    parseDOM: [
      { tag: 'mark', getAttrs: (d) => ({ color: normColor(d.style.backgroundColor) || '#fff176' }) },
      { style: 'background-color', context: 'paragraph/|heading/|code_block/', consuming: false, getAttrs: (v) => { const c = normColor(v); return c && c !== '#ffffff' ? { color: c } : false } },
    ],
    toDOM: (m) => ['mark', { style: `background-color:${m.attrs.color}` }, 0],
  },
  fontSize: {
    attrs: { size: {} },
    parseDOM: [{ style: 'font-size', consuming: false, getAttrs: (v) => { const pt = toPt(v); return pt ? { size: Math.round(clamp(pt, 1, 400) * 2) / 2 } : false } }],
    toDOM: (m) => ['span', { style: `font-size:${m.attrs.size}pt` }, 0],
  },
  fontFamily: {
    attrs: { family: {} },
    parseDOM: [{ style: 'font-family', consuming: false, getAttrs: (v) => { const f = cleanFamily(v); return f ? { family: f } : false } }],
    toDOM: (m) => ['span', { style: `font-family:${FONT_STACK[m.attrs.family] || `"${m.attrs.family}", sans-serif`}` }, 0],
  },
}

export const schema = new Schema({ nodes, marks })
const parser = PMParser.fromSchema(schema)
const serializer = DOMSerializer.fromSchema(schema)

/** Parse an HTML string (inert: nothing runs, nothing loads) into a doc node. */
export function htmlToDoc(html) {
  const body = new window.DOMParser().parseFromString(String(html), 'text/html').body
  return parser.parse(body, { preserveWhitespace: false })
}
/** Strip anything unsafe from document JSON (project files and imports are untrusted): bad links, image sources, colours, fonts. */
function cleanJson(n) {
  if (!n || typeof n !== 'object') return null
  if (Array.isArray(n.marks)) {
    n.marks = n.marks.filter((m) => {
      const a = (m.attrs ||= {})
      switch (m.type) {
        case 'link': { const href = safeHref(a.href); if (!href) return false; a.href = href; return true }
        case 'color': case 'highlight': { const c = normColor(a.color); if (!c) return false; a.color = c; return true }
        case 'fontSize': return Number.isFinite(a.size) && a.size > 0 && a.size < 500
        case 'fontFamily': { const f = String(a.family || '').replace(/[^\w -]/g, '').trim().slice(0, 40); if (!f) return false; a.family = f; return true }
        default: return true
      }
    })
  }
  if (n.type === 'image') {
    const src = safeImageSrc(n.attrs?.src)
    if (!src) return null
    n.attrs.src = src
  }
  if (n.attrs?.background) n.attrs.background = normColor(n.attrs.background)
  if (Array.isArray(n.content)) n.content = n.content.map(cleanJson).filter(Boolean)
  return n
}
export const jsonToDoc = (json) => schema.nodeFromJSON(cleanJson(JSON.parse(JSON.stringify(json))))

export function serializeToDom(doc) {
  const box = document.createElement('div')
  box.append(serializer.serializeFragment(doc.content))
  return box
}

export const wordCount = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0)
export const docText = (doc) => doc.textBetween(0, doc.content.size, '\n', ' ')
