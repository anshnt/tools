// A tiny DOM-free XML reader and a few writer helpers, so the geo readers run anywhere (page, worker, Node) and stay fast on big files.
// parseXml(text) -> { name, prefix, attrs, children: [node], text } where `name` is the local name (no namespace prefix).

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const unesc = (s) => (s.includes('&') ? s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m }
  return ENT[e.toLowerCase()] ?? m
}) : s)

export function parseXml(src) {
  let s = String(src)
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  const root = { name: '#root', prefix: '', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[2] !== undefined) {
      if (stack.length > 1) stack.pop()
    } else if (m[3] !== undefined) {
      const q = m[3], ci = q.indexOf(':')
      const node = { name: ci < 0 ? q : q.slice(ci + 1), prefix: ci < 0 ? '' : q.slice(0, ci), attrs: {}, children: [], text: '' }
      if (m[4]) { attrRe.lastIndex = 0; let a; while ((a = attrRe.exec(m[4]))) { const k = a[1], i = k.indexOf(':'); node.attrs[i < 0 ? k : k.slice(i + 1)] = unesc(a[2] ?? a[3]) } }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6] !== undefined) top.text += unesc(m[6])
  }
  const el = root.children[0]
  if (!el) throw new Error('This file is not valid XML.')
  return el
}

export const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : [])
export const kid = (n, name) => (n ? n.children.find((c) => c.name === name) : undefined)
export const txt = (n, name) => { const c = name ? kid(n, name) : n; return c ? c.text.trim() : undefined }
/** All descendants with the given local name (depth first). */
export function deep(n, name, out = []) {
  for (const c of n.children) { if (c.name === name) out.push(c); deep(c, name, out) }
  return out
}

export const esc = (v) => String(v).replace(/[<>&"\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || ''))
/** Tag with text content, or '' when the value is empty. */
export const tag = (name, v, attrs = '') => (v === undefined || v === null || v === '' ? '' : `<${name}${attrs}>${esc(v)}</${name}>`)
