// Export: standalone HTML, print / save-as-PDF, Markdown (turndown), plain text and the project file.
import { turndown } from '../../lib/libs.js'
import { serializeToDom, FONT_STACK } from './_schema.js'
import { docCss, exportCss } from './_doccss.js'
import { pageMm } from './_page.js'

const cssStr = (s) => String(s).replace(/[\\"]/g, '\\$&').replace(/\s+/g, ' ')
export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function marginBoxes(s) {
  const base = 'font: 9pt Arial, Helvetica, sans-serif; color: #7a7a86;'
  const out = []
  if (s.header) out.push(`@top-center { content: "${cssStr(s.header)}"; ${base} }`)
  if (s.footer && s.pageNumbers) {
    out.push(`@bottom-left { content: "${cssStr(s.footer)}"; ${base} }`)
    out.push(`@bottom-right { content: counter(page); ${base} }`)
  } else if (s.pageNumbers) out.push(`@bottom-center { content: counter(page); ${base} }`)
  else if (s.footer) out.push(`@bottom-center { content: "${cssStr(s.footer)}"; ${base} }`)
  return out.join('\n  ')
}

/** Give tables a colgroup from the stored column widths so exports keep the layout. */
function prepareTables(dom) {
  for (const table of dom.querySelectorAll('table')) {
    const row = table.querySelector('tr')
    if (!row) continue
    const widths = []
    for (const cell of row.children) {
      const span = +cell.getAttribute('colspan') || 1
      const cw = (cell.getAttribute('data-colwidth') || '').split(',').map(Number)
      for (let i = 0; i < span; i++) widths.push(cw[i] > 0 ? cw[i] : 0)
    }
    if (!widths.some(Boolean)) continue
    const group = document.createElement('colgroup')
    for (const w of widths) {
      const col = document.createElement('col')
      if (w) col.style.width = `${w}px`
      group.append(col)
    }
    table.prepend(group)
  }
}

/** A complete, self-contained HTML file. With forPrint the page size, margins, header and page numbers come from @page. */
export function buildHtml(doc, settings, title) {
  const dom = serializeToDom(doc)
  prepareTables(dom)
  const { w, h } = pageMm(settings)
  const m = settings.margins
  const stack = FONT_STACK[settings.font] || FONT_STACK.Calibri
  const css = `
@page { size: ${w}mm ${h}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;
  ${marginBoxes(settings)} }
:root { --doc-font: ${stack}; --doc-size: ${settings.fontSize}pt; }
html, body { margin: 0; padding: 0; background: #fff; }
${docCss('body')}
${exportCss()}
@media screen { body { max-width: min(${Math.round(w - m.left - m.right)}mm, 100%); margin: 0 auto; padding: 36px 20px 80px; box-sizing: border-box; } }
`
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${css}</style></head>\n<body>\n${dom.innerHTML}\n</body></html>\n`
}

/** Print the document through a hidden iframe so only the paper is printed. The browser's print dialog offers "Save as PDF". */
export function printHtml(html, host = document.body, onDone) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none'
    const cleanup = () => { setTimeout(() => frame.remove(), 500); onDone?.() }
    frame.onload = async () => {
      try {
        const d = frame.contentDocument
        await Promise.all([...d.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r }))))
        frame.contentWindow.addEventListener('afterprint', cleanup)
        frame.contentWindow.focus()
        frame.contentWindow.print()
        setTimeout(() => frame.remove(), 120000)
        setTimeout(() => onDone?.(), 120) // the hidden frame holds focus while printing: give it back to the editor
        resolve()
      } catch (e) {
        frame.remove()
        reject(e)
      }
    }
    host.append(frame)
    frame.srcdoc = html
  })
}

// ---------- Markdown ----------
function simplifyForMarkdown(dom) {
  // turndown drops empty elements, so a page break becomes a paragraph holding the HTML that marks it
  for (const pb of dom.querySelectorAll('div[data-page-break]')) {
    const p = document.createElement('p')
    p.textContent = '<div style="page-break-after: always"></div>'
    pb.replaceWith(p)
  }
  for (const el of dom.querySelectorAll('li > p:only-child, td > p:only-child, th > p:only-child')) el.replaceWith(...el.childNodes)
  for (const cell of dom.querySelectorAll('td, th')) {
    const ps = [...cell.children].filter((c) => c.tagName === 'P')
    if (ps.length > 1) ps.forEach((p, i) => { if (i) p.before(document.createElement('br')); p.replaceWith(...p.childNodes) })
  }
}

export async function exportMarkdown(doc) {
  const Turndown = await turndown()
  const td = new Turndown({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**', hr: '---' })
  td.addRule('strike', { filter: ['s', 'del', 'strike'], replacement: (c) => `~~${c}~~` })
  td.addRule('underline', { filter: 'u', replacement: (c) => `<u>${c}</u>` })
  td.addRule('highlight', { filter: 'mark', replacement: (c) => c })
  td.addRule('taskItem', {
    filter: (n) => n.nodeName === 'LI' && n.hasAttribute('data-task'),
    replacement(content, node) {
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ')
      return `- [${node.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${body}${node.nextSibling ? '\n' : ''}`
    },
  })
  td.addRule('table', {
    filter: 'table',
    replacement(content, node) {
      const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => td.turndown(c.innerHTML).replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').trim()))
      if (!rows.length) return ''
      const cols = Math.max(...rows.map((r) => r.length))
      const line = (r) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ')} |`
      return `\n\n${[line(rows[0]), line(Array(cols).fill('---')), ...rows.slice(1).map(line)].join('\n')}\n\n`
    },
  })
  const dom = serializeToDom(doc)
  simplifyForMarkdown(dom)
  const md = td.turndown(dom.innerHTML)
    .replace(/^(\s*)([-*+]) {3}/gm, '$1$2 ') // "-   item" -> "- item"
    .replace(/^(\s*)(\d+\.) {2}/gm, '$1$2 ')
    .replace(/[ \t]+$/gm, (m) => (m.length === 2 ? m : '')) // keep the two-space hard break, drop other trailing spaces
    .replace(/\n{3,}/g, '\n\n')
  return `${md.trim()}\n`
}

// ---------- Plain text ----------
function inlineText(node) {
  let t = ''
  node.forEach((c) => {
    if (c.isText) t += c.text
    else if (c.type.name === 'hard_break') t += '\n'
    else if (c.type.name === 'image') t += `[image${c.attrs.alt ? `: ${c.attrs.alt}` : ''}]`
  })
  return t
}

function textBlock(node) {
  switch (node.type.name) {
    case 'paragraph': case 'heading': return inlineText(node).split('\n')
    case 'code_block': return node.textContent.split('\n')
    case 'horizontal_rule': return ['----------']
    case 'page_break': return ['']
    case 'blockquote': return blocks(node).map((l) => (l ? `> ${l}` : '>'))
    case 'bullet_list': case 'ordered_list': case 'task_list': {
      const lines = []
      node.forEach((item, _o, i) => {
        const mark = node.type.name === 'bullet_list' ? '- ' : node.type.name === 'ordered_list' ? `${node.attrs.order + i}. ` : item.attrs.checked ? '[x] ' : '[ ] '
        const inner = blocks(item, true)
        inner.forEach((l, k) => lines.push((k === 0 ? mark : ' '.repeat(mark.length)) + l))
      })
      return lines
    }
    case 'table': {
      const rows = []
      node.forEach((row) => { const cells = []; row.forEach((c) => cells.push(blocks(c, true).join(' ').replace(/\s+/g, ' ').trim())); rows.push(cells.join('\t')) })
      return rows
    }
    default: return [node.textContent]
  }
}

function blocks(parent, tight = false) {
  const out = []
  parent.forEach((child, _o, i) => {
    if (i && !(tight && /_list$/.test(child.type.name))) out.push('')
    out.push(...textBlock(child))
  })
  return out
}

export function exportText(doc) {
  return `${blocks(doc).join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

// ---------- Project file ----------
export const projectJson = (title, doc, settings) => JSON.stringify({ format: 'docs-studio', version: 1, title, saved: new Date().toISOString(), settings, doc: doc.toJSON() }, null, 1)
