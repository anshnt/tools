// Draw Studio path booleans (Weld, Trim, Intersect, Simplify, Front minus back, Back minus front) with paper.js, loaded on first use.
// Contract path commands go in as SVG path data and come back through parseD. Open paths count as closed. Text must be converted to curves
// first and pictures are refused. Every paper call is guarded: on failure the caller gets a readable message and the document is untouched.
import { script } from '../../lib/libs.js'
import { parseD } from './_model.js'

const PAPER = 'https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-core.min.js'
export const LIMIT_SHAPES = 200, LIMIT_SEGMENTS = 60000, CONFIRM_SEGMENTS = 20000
export const OPS = ['weld', 'trim', 'intersect', 'simplify', 'frontMinusBack', 'backMinusFront']
export const FAIL_TEXT = 'Shaping failed on these shapes. Try Object > Convert to curves or simplify the nodes first.'
const STRIP = ['shape', 'sm', 'nt', 'rot', 'src']
let scope = null

async function paperScope() {
  if (scope) return scope
  try { await script(PAPER) } catch { throw new Error('Shaping needs the paper.js library, which could not be loaded. Check your connection and try again.') }
  const paper = window.paper
  if (!paper) throw new Error('Shaping needs the paper.js library, which could not be loaded.')
  if (!paper.project) paper.setup(new paper.Size(64, 64))
  scope = paper
  return scope
}
const pathString = (d) => d.map((c) => (c[0] === 'Z' ? 'Z' : c[0] + c.slice(1).join(' '))).join('')
/** Number of segments a node's path has (the cost measure for the limits). */
export const segmentCount = (n) => (n.t === 'path' ? n.d.length : 0)
const tick = () => new Promise((r) => setTimeout(r, 0))

function toPaper(paper, node) {
  const item = new paper.CompoundPath({ pathData: pathString(node.d), fillRule: node.rule === 'evenodd' ? 'evenodd' : 'nonzero' })
  for (const c of item.children || []) c.closed = true
  return item
}
const unite = (list) => list.slice(1).reduce((acc, it) => { const r = acc.unite(it, { insert: false }); if (acc !== list[0]) acc.remove(); return r }, list[0])
const isEmpty = (item) => !item || item.isEmpty?.() || !item.pathData

/** What these nodes cannot do: '' when they can be shaped, else the readable reason. */
export function shapeBlocker(leaves, need = 2) {
  if (leaves.some((l) => l.t === 'text')) return 'Convert text to curves first (Ctrl+Q).'
  if (leaves.some((l) => l.t === 'image')) return 'Pictures cannot be shaped. Trace them first, or select only shapes.'
  if (leaves.length < need) return need === 2 ? 'Select two or more shapes.' : 'Select a shape.'
  if (leaves.length > LIMIT_SHAPES) return `Shaping works on at most ${LIMIT_SHAPES} shapes at a time.`
  if (leaves.reduce((s, l) => s + segmentCount(l), 0) > LIMIT_SEGMENTS) return 'These shapes have too many points to shape here. Simplify them first.'
  return ''
}

/**
 * Run one shaping operation.
 *   leaves   path nodes back to front (z order)
 *   targetId the target (see PLAN 7: last selected when the selection was clicked, else the bottom-most)
 *   o        {newId, leaveSource, leaveTarget, onProgress, signal}
 * Returns {replace: Map(id -> node | [nodes] | null), notes}, ready for replaceLeaves. A result with no area removes the object.
 */
export async function shape(op, leaves, targetId, o = {}) {
  const { newId, leaveSource = false, leaveTarget = false, signal } = o
  const paper = await paperScope()
  const made = []
  const live = (item) => { made.push(item); return item }
  const items = new Map(leaves.map((n) => [n.id, live(toPaper(paper, n))]))
  const notes = []
  const replace = new Map()
  const done = (n, i = 0, total = 1) => o.onProgress?.((i + 1) / total, n)
  const mk = (src, item) => {
    const d = parseD(item.pathData)
    if (!d.length) return null
    const out = { ...src, d, rule: 'nonzero' }
    for (const k of STRIP) delete out[k]
    if (!out.fill && out.stroke) out.fill = out.stroke // a line-only shape gets its line colour as fill, so the result is visible
    return out
  }
  const abort = () => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' }) }
  try {
    const target = leaves.find((n) => n.id === targetId) || leaves[0]
    const sources = leaves.filter((n) => n !== target)
    const all = () => leaves.map((n) => items.get(n.id))
    if (op === 'weld' || op === 'intersect' || op === 'trim') {
      const tItem = items.get(target.id), sItems = sources.map((n) => items.get(n.id))
      const res = op === 'weld' ? live(unite(all())) : op === 'intersect' ? all().slice(1).reduce((a, b) => live(a.intersect(b, { insert: false })), all()[0]) : live(tItem.subtract(sItems.length === 1 ? sItems[0] : live(unite(sItems)), { insert: false }))
      const node = isEmpty(res) ? null : mk(target, res)
      if (!node) notes.push(op === 'intersect' ? 'The shapes do not overlap, so nothing was made.' : 'Nothing was left after shaping.')
      if (op === 'intersect' || leaveTarget) { // the result is a NEW object at the target's place; the target stays only when asked to
        if (node) node.id = newId()
        const list = [...(leaveTarget ? [target] : []), ...(node ? [node] : [])]
        replace.set(target.id, list.length ? list : null)
      } else replace.set(target.id, node) // weld and trim replace the target (it keeps its id and look)
      if (!leaveSource) for (const s of sources) replace.set(s.id, null)
    } else if (op === 'simplify') {
      // back to front: each object loses what the objects in front of it cover
      for (let i = 0; i < leaves.length; i++) {
        abort()
        const front = leaves.slice(i + 1).map((n) => items.get(n.id))
        let res = items.get(leaves[i].id)
        if (front.length) res = live(res.subtract(front.length === 1 ? front[0] : live(unite(front)), { insert: false }))
        replace.set(leaves[i].id, isEmpty(res) ? null : mk(leaves[i], res))
        done('Simplifying', i, leaves.length)
        if (i % 8 === 7) await tick()
      }
    } else if (op === 'frontMinusBack' || op === 'backMinusFront') {
      const rear = leaves[0], front = leaves.slice(1)
      if (op === 'frontMinusBack') {
        replace.set(rear.id, null)
        front.forEach((n, i) => { abort(); const res = live(items.get(n.id).subtract(items.get(rear.id), { insert: false })); replace.set(n.id, isEmpty(res) ? null : mk(n, res)); done('Shaping', i, front.length) })
      } else {
        const res = live(items.get(rear.id).subtract(front.length === 1 ? items.get(front[0].id) : live(unite(front.map((n) => items.get(n.id)))), { insert: false }))
        replace.set(rear.id, isEmpty(res) ? null : mk(rear, res))
        for (const n of front) replace.set(n.id, null)
      }
    } else throw new Error(`Unknown shaping operation ${op}`)
    // objects whose result is empty simply go away; say so once
    const gone = [...replace.values()].filter((v) => v === null).length
    if (op === 'simplify' && gone) notes.push(`${gone} shape${gone === 1 ? ' was' : 's were'} completely covered and removed.`)
    return { replace, notes }
  } catch (e) {
    if (e?.code === 'ABORT') throw e
    console.warn('Draw Studio: shaping failed', e)
    throw new Error(FAIL_TEXT)
  } finally {
    for (const it of made) { try { it.remove() } catch { /* already gone */ } }
    for (const it of items.values()) { try { it.remove() } catch { /* already gone */ } }
  }
}
