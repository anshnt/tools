// Boolean operations (unite, subtract, intersect, exclude) with paper.js (MIT), loaded on first use.
import { script } from '../../lib/libs.js'
import { toSubs } from './_model.js'
import { parseD } from './_geom.js'

const PAPER = 'https://cdn.jsdelivr.net/npm/paper@0.12.18/dist/paper-core.min.js'
let scope = null

async function paperScope() {
  if (!scope) {
    await script(PAPER)
    const paper = window.paper
    paper.setup(new paper.Size(64, 64))
    scope = paper
  }
  return scope
}

function toPaper(paper, node) {
  const subs = toSubs(node)
  const paths = subs.map((s) => new paper.Path({
    segments: s.pts.map((p) => new paper.Segment(new paper.Point(p.x, p.y), new paper.Point(p.ix, p.iy), new paper.Point(p.ox, p.oy))),
    closed: true,
  }))
  const item = paths.length === 1 ? paths[0] : new paper.CompoundPath({ children: paths })
  item.fillRule = node.rule === 'evenodd' ? 'evenodd' : 'nonzero'
  return item
}

/** shapes: path/rect/ellipse nodes sorted back to front. Returns sub-paths in document coordinates ([] when the result is empty). */
export async function booleanOp(shapes, op) {
  const paper = await paperScope()
  const items = shapes.map((n) => toPaper(paper, n))
  let res = items[0]
  const fn = { unite: 'unite', subtract: 'subtract', intersect: 'intersect', exclude: 'exclude' }[op]
  for (let i = 1; i < items.length; i++) {
    const next = res[fn](items[i], { insert: false })
    if (res !== items[0]) res.remove()
    res = next
  }
  const d = res.pathData || ''
  items.forEach((x) => x.remove())
  res.remove()
  return d ? parseD(d) : []
}
