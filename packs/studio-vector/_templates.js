// Starter documents for the focused Vector Studio entries and the "Load an example" button.
import { mk, solid, FONTS, newDoc } from './_model.js'
import { starSubs } from './_geom.js'

const FONT = FONTS[0][0]
const lin = (c1, c2, x1 = 0, y1 = 0, x2 = 1, y2 = 1) => ({ t: 'linear', stops: [{ o: 0, c: c1, a: 1 }, { o: 1, c: c2, a: 1 }], x1, y1, x2, y2 })
const S = (extra) => ({ fill: null, stroke: null, sw: 0, dash: '', cap: 'butt', join: 'miter', ml: 4, rule: 'nonzero', ...extra })
const text = (d, props, style) => mk(d, 'text', { ff: FONT, fi: false, lh: 1.2, ls: 0, ...props }, S(style))

export const TEMPLATES = {
  logo() {
    const d = newDoc(800, 800)
    d.nodes.push(
      mk(d, 'ellipse', { cx: 400, cy: 370, rx: 270, ry: 270, name: 'Badge' }, S({ fill: { t: 'radial', stops: [{ o: 0, c: '#a78bfa', a: 1 }, { o: 1, c: '#4f46e5', a: 1 }], cx: 0.35, cy: 0.3, r: 0.85, fx: 0.35, fy: 0.3 } })),
      mk(d, 'ellipse', { cx: 400, cy: 370, rx: 238, ry: 238, name: 'Ring' }, S({ stroke: solid('#ffffff', 0.7), sw: 6, dash: '4 14', cap: 'round' })),
      mk(d, 'path', { subs: starSubs(400, 360, 132, 58, 5), name: 'Star' }, S({ fill: solid('#ffffff'), stroke: solid('#fde68a'), sw: 6, join: 'round' })),
      text(d, { x: 400, y: 740, text: 'BRAND', fs: 84, fw: 800, ta: 'middle', ls: 8, name: 'Wordmark' }, { fill: solid('#1b1b2f') }))
    return { doc: d }
  },
  icon() {
    const d = newDoc(64, 64)
    d.nodes.push(
      mk(d, 'rect', { x: 4, y: 4, w: 56, h: 56, rx: 14, ry: 14, name: 'Tile' }, S({ fill: lin('#6366f1', '#ec4899') })),
      mk(d, 'path', { subs: starSubs(32, 33, 18, 8, 5), name: 'Star' }, S({ fill: solid('#ffffff'), stroke: solid('#ffffff'), sw: 2, join: 'round' })))
    return { doc: d, grid: { on: true, size: 4, snap: true } }
  },
  social() {
    const d = newDoc(1080, 1080)
    d.nodes.push(
      mk(d, 'rect', { x: 0, y: 0, w: 1080, h: 1080, rx: 0, ry: 0, name: 'Background' }, S({ fill: lin('#6366f1', '#ec4899') })),
      mk(d, 'ellipse', { cx: 900, cy: 180, rx: 260, ry: 260, name: 'Circle 1' }, S({ fill: solid('#ffffff', 0.14) })),
      mk(d, 'ellipse', { cx: 140, cy: 940, rx: 200, ry: 200, name: 'Circle 2' }, S({ fill: solid('#ffffff', 0.12) })),
      text(d, { x: 540, y: 520, text: 'Your big idea\nin one line', fs: 112, fw: 800, ta: 'middle', lh: 1.1, ls: -2, name: 'Headline' }, { fill: solid('#ffffff') }),
      text(d, { x: 540, y: 800, text: 'Edit me with the Text tool', fs: 44, fw: 500, ta: 'middle', name: 'Subtitle' }, { fill: solid('#ffffff', 0.9) }))
    return { doc: d }
  },
}
