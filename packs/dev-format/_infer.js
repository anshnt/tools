// Type inference from JSON samples. One descriptor is built per position in the document, and every value seen at that
// position (all items of an array, say) is added to it, so arrays of objects merge into a single shape.
// Pure logic: used by the JSON Schema generator and the TypeScript generator, and unit-testable in Node.

const blank = () => ({ n: 0, t: { null: 0, boolean: 0, integer: 0, number: 0, string: 0, object: 0, array: 0 }, props: new Map(), items: null, fmt: new Map() })

const FORMATS = [
  ['date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i],
  ['date', /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/],
  ['time', /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ['uri', /^(?:[a-z][a-z0-9+.-]*:\/\/[^\s/?#]+[^\s]*|mailto:[^\s@]+@[^\s@]+)$/i],
  ['ipv4', /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/],
]
/** The JSON Schema format a string looks like, or null. */
export function detectFormat(s) {
  if (s.length < 5 || s.length > 2048) return null
  for (const [name, re] of FORMATS) if (re.test(s)) return name
  if (/^[0-9a-f:.]+$/i.test(s) && (s.includes('::') || (s.match(/:/g) || []).length === 7) && /^[0-9a-f:.]+$/i.test(s) && s.split(':').every((g) => g.length <= 4 || g.includes('.'))) return 'ipv6'
  return null
}

function add(d, node) {
  d.n++
  switch (node.t) {
    case 'z': d.t.null++; break
    case 'b': d.t.boolean++; break
    case 'n': d.t[/^-?\d+$/.test(node.r) ? 'integer' : 'number']++; break
    case 's': { d.t.string++; const f = detectFormat(node.v) || ''; d.fmt.set(f, (d.fmt.get(f) || 0) + 1); break }
    case 'o':
      d.t.object++
      node.k.forEach((k, j) => {
        let p = d.props.get(k)
        if (!p) d.props.set(k, (p = { d: blank(), n: 0 }))
        p.n++
        add(p.d, node.v[j])
      })
      break
    case 'a':
      d.t.array++
      if (!d.items) d.items = blank()
      for (const c of node.i) add(d.items, c)
      break
  }
}
/** Build the descriptor for a node tree (see parseJson). */
export function infer(node) { const d = blank(); add(d, node); return d }

const ORDER = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']
/** JSON type names seen at a position. integer folds into number when both occur. */
export function typesOf(d) {
  const out = []
  for (const t of ORDER) {
    if (!d.t[t]) continue
    if (t === 'integer' && d.t.number) continue
    out.push(t)
  }
  return out
}

/** Draft 2020-12 JSON Schema for a descriptor. o: {required, formats, strict, examples} */
export function toJsonSchema(d, o = {}) {
  const { required = true, formats = true, strict = false } = o
  const go = (x) => {
    const s = {}
    const types = typesOf(x)
    if (types.length === 1) s.type = types[0]
    else if (types.length > 1) s.type = types
    if (formats && x.t.string && x.fmt.size === 1) { const [f] = x.fmt.keys(); if (f) s.format = f }
    if (x.t.object) {
      s.properties = {}
      const req = []
      for (const [k, p] of x.props) {
        s.properties[k] = go(p.d)
        if (required && p.n === x.t.object) req.push(k)
      }
      if (req.length) s.required = req
      if (strict) s.additionalProperties = false
    }
    if (x.t.array) s.items = x.items && x.items.n ? go(x.items) : {}
    return s
  }
  return go(d)
}

// ---------- TypeScript ----------
const pascal = (s) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c || '').toUpperCase()).replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/^(\d)/, '_$1') || 'Item'
export function singular(word) {
  const w = String(word)
  if (/ies$/i.test(w) && w.length > 3) return w.replace(/ies$/i, 'y')
  if (/(ss|us|is)$/i.test(w)) return w
  if (/(ches|shes|xes|zes|sses)$/i.test(w)) return w.replace(/es$/i, '')
  if (/s$/i.test(w) && w.length > 1) return w.slice(0, -1)
  return `${w}Item`
}
const IDENT = /^[A-Za-z_$][\w$]*$/
const propName = (k) => (IDENT.test(k) ? k : JSON.stringify(k))

/**
 * TypeScript declarations for a descriptor.
 * o: {rootName, kind: 'interface' | 'type', exportKeyword, readonly, indent, semicolons}
 */
export function toTypeScript(d, o = {}) {
  const { rootName = 'Root', kind = 'interface', exportKeyword = true, readonly = false, indent = '  ', semicolons = true } = o
  const semi = semicolons ? ';' : ''
  const decls = []
  const byBody = new Map()
  const used = new Set()
  const uniqueName = (want) => {
    let name = pascal(want), i = 2
    const base = name
    while (used.has(name)) name = `${base}${i++}`
    used.add(name)
    return name
  }
  const ro = readonly ? 'readonly ' : ''
  const arrayOf = (elem) => (/[|&]/.test(elem) || elem.includes(' => ') ? `${ro}(${elem})[]` : `${ro}${elem}[]`)

  function objectType(x, hint) {
    if (!x.props.size) return 'Record<string, unknown>'
    const slot = decls.length
    decls.push(null)
    const lines = []
    for (const [k, p] of x.props) {
      const optional = p.n < x.t.object
      lines.push(`${indent}${ro}${propName(k)}${optional ? '?' : ''}: ${typeOf(p.d, k)}${semicolons ? ';' : ''}`)
    }
    const body = lines.join('\n')
    const known = byBody.get(body)
    if (known) { decls[slot] = undefined; return known }
    const name = uniqueName(hint)
    byBody.set(body, name)
    const head = `${exportKeyword ? 'export ' : ''}${kind === 'interface' ? `interface ${name} ` : `type ${name} = `}`
    decls[slot] = `${head}{\n${body}\n}${kind === 'type' ? semi : ''}`
    return name
  }
  function typeOf(x, hint) {
    const parts = []
    for (const t of typesOf(x)) {
      if (t === 'string') parts.push('string')
      else if (t === 'number' || t === 'integer') parts.push('number')
      else if (t === 'boolean') parts.push('boolean')
      else if (t === 'null') parts.push('null')
      else if (t === 'object') parts.push(objectType(x, hint))
      else if (t === 'array') parts.push(x.items && x.items.n ? arrayOf(typeOf(x.items, singular(hint))) : `${ro}unknown[]`)
    }
    const uniq = [...new Set(parts)]
    return uniq.length ? uniq.join(' | ') : 'unknown'
  }
  const rootType = typeOf(d, rootName)
  const isDeclared = used.has(rootType)
  const all = decls.filter(Boolean)
  if (!isDeclared) all.unshift(`${exportKeyword ? 'export ' : ''}type ${uniqueName(rootName)} = ${rootType}${semi}`)
  return all.join('\n\n') + '\n'
}
