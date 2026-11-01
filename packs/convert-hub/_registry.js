// The converter registry: collects the routes of this pack and every engine pack, and finds the shortest chain of conversions
// between two formats (at most 3 steps, for example hwp -> docx -> pdf).
import { canon } from './_formats.js'
import { canEncode } from '../../lib/image.js'

// Engine packs ship packs/<name>/_convert.js. They are loaded one by one and a missing or broken one is simply skipped.
const SIBLINGS = ['image-formats', 'data-sql', 'docs-convert', 'ebook', 'archive', 'fonts', 'data-formats', 'model3d', 'geo', 'cad-vector', 'media-convert', 'media-capture']
export const MAX_HOPS = 3

const convs = []
const sniffers = []
const listeners = new Set()
const status = { loaded: [], skipped: [] }
let version = 0
let graph = null
let loading = null

const canonTo = (t) => (/^pdf-/.test(t) ? t : canon(t))
function norm(c) {
  // `raw` maps a canonical target back to the converter's own name for it (jsonl, not ndjson), which is what run() expects
  const raw = new Map()
  for (const t of c.to) if (!raw.has(canonTo(t))) raw.set(canonTo(t), t)
  return { ...c, from: [...new Set(c.from.map(canon))], to: [...raw.keys()], raw }
}

/** Add a converter definition (used by the pack loader, and by tests to simulate a pack). */
export function register(conv) {
  convs.push(norm(conv))
  version++
  graph = null
  for (const fn of listeners) fn()
}
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const registered = () => [...convs]

function build() {
  // edges[from] = Map(to -> step); first registered wins, so this pack's own routes come first
  const edges = new Map()
  for (const c of convs) {
    if (c.combine) continue
    for (const f of c.from) for (const t of c.to) {
      if (f === t && !c.sameFormat) continue // a route from x to x is skipped, unless the route says it can resize or recompress
      if (t === 'avif' && !avifOk()) continue // offered only where this browser can save AVIF
      if (!edges.has(f)) edges.set(f, new Map())
      if (!edges.get(f).has(t)) edges.get(f).set(t, { conv: c, from: f, to: t, raw: c.raw?.get(t) || t })
    }
  }
  graph = { edges, cache: new Map(), froms: new Set(convs.flatMap((c) => c.from)) }
  return graph
}
let avif
const avifOk = () => (avif ??= typeof document === 'undefined' || canEncode('image/avif'))
const G = () => graph || build()

/** True when some converter takes this extension as input. */
export const isKnown = (ext) => G().froms.has(canon(ext))

/** Every target reachable from `ext` within MAX_HOPS: Map(target -> {path: [{conv, from, to}], hops}). Shortest chain wins. */
export function routesFrom(ext) {
  ext = canon(ext)
  const g = G()
  if (g.cache.has(ext)) return g.cache.get(ext)
  const best = new Map()
  const self = g.edges.get(ext)?.get(ext)
  if (self) best.set(ext, { path: [self], hops: 1 })
  let frontier = [{ node: ext, path: [] }]
  const seen = new Set([ext])
  for (let hop = 1; hop <= MAX_HOPS && frontier.length; hop++) {
    const next = []
    for (const { node, path } of frontier) {
      for (const [t, step] of g.edges.get(node) || []) {
        // first route found wins (converters register in priority order); firstOnly reads something only an original file has
        if (seen.has(t) || best.has(t) || (hop > 1 && step.conv.firstOnly)) continue
        const p = [...path, step]
        best.set(t, { path: p, hops: hop })
        const last = step.conv.lastOnly
        if (last !== true && !last?.includes(t)) next.push({ node: t, path: p }) // lastOnly outputs never feed another step
      }
    }
    for (const n of next) seen.add(n.node)
    frontier = next
  }
  g.cache.set(ext, best)
  return best
}

/** The chain of steps from one format to another, or null. */
export const findRoute = (from, to) => routesFrom(from).get(to)?.path || null

/** Combine routes (several files into one) that accept this extension. */
export const combineRoutes = () => convs.filter((c) => c.combine)

/** Options a chain asks for, merged by key (later steps win). */
export function optionsOf(path) {
  const map = new Map()
  for (const s of path) for (const o of s.conv.options || []) map.set(o.key, o)
  return [...map.values()]
}
export const routeNotes = (path) => path.map((s) => s.conv.note).filter(Boolean)
export const routeExclusive = (path) => [...new Set(path.map((s) => s.conv.exclusive).filter(Boolean))]

/** Sniffers (magic-byte checks) shipped by the engine packs. */
export const extraSniffers = () => sniffers

/**
 * Load this pack's routes and every engine pack that exists on the site. Safe to call many times.
 * Only packs the site catalog lists are fetched, so a missing pack costs no failed request.
 */
export function loadAll() {
  loading ||= (async () => {
    let present = null
    try {
      const { TOOLS } = await import('../../assets/catalog.js')
      present = new Set(TOOLS.map((t) => t.pack))
    } catch { /* catalog unavailable: try everything */ }
    const fetchPack = (name, url) => import(url).then((m) => [name, m], (e) => { status.skipped.push(name); console.debug(`File Converter: ${name} routes not available`, e?.message); return [name, null] })
    // import in parallel, register in a fixed order so the same route always wins
    const mods = await Promise.all([fetchPack('core', './_core.js'), ...SIBLINGS.filter((p) => !present || present.has(p)).map((p) => fetchPack(p, `../${p}/_convert.js`))])
    for (const [name, m] of mods) {
      if (!m) continue
      for (const c of m.CONVERTERS || []) register(c)
      for (const s of m.SNIFF || []) sniffers.push(s)
      status.loaded.push(name)
    }
    return status
  })()
  return loading
}
export const loadStatus = () => status
