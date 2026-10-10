// Quick-start drawings for CAD Studio, built from the same entity model as everything else.
import { D2R } from './_vec.js'
import { blankState, newLayer } from './_doc.js'
import { filletPolyline } from './_edit.js'

const finish = (state, ents) => {
  let id = 1
  state.ents = ents.map((e) => ({ ...e, id: id++ }))
  state.nextId = id
  return state
}
const line = (layer, x1, y1, x2, y2, o = {}) => ({ type: 'line', layer, x1, y1, x2, y2, ...o })
const text = (layer, x, y, h, t, o = {}) => ({ type: 'text', layer, x, y, h, text: t, rot: 0, align: 'l', ...o })
const rect = (layer, x0, y0, x1, y1) => ({ type: 'polyline', layer, closed: true, pts: [{ x: x0, y: y0, b: 0 }, { x: x1, y: y0, b: 0 }, { x: x1, y: y1, b: 0 }, { x: x0, y: y1, b: 0 }] })

/** A 120 x 80 mm base plate with four holes, a bore, centre lines and dimensions. */
export function platePart() {
  const s = blankState('mm')
  s.layers = [newLayer('0'), newLayer('Outline', { color: '#ffffff', lw: 0.5 }), newLayer('Centre', { color: '#e5484d', ltype: 'center', lw: 0.18 }), newLayer('Dimensions', { color: '#12a594', lw: 0.18 }), newLayer('Text', { color: '#7d8590', lw: 0.18 })]
  const outline = filletPolyline(rect('Outline', 0, 0, 120, 80), 8).entity
  const holes = [[20, 20], [100, 20], [20, 60], [100, 60]]
  const ents = [outline]
  for (const [x, y] of holes) {
    ents.push({ type: 'circle', layer: 'Outline', cx: x, cy: y, r: 5 })
    ents.push(line('Centre', x - 8, y, x + 8, y), line('Centre', x, y - 8, x, y + 8))
  }
  ents.push({ type: 'circle', layer: 'Outline', cx: 60, cy: 40, r: 15 })
  ents.push(line('Centre', 40, 40, 80, 40), line('Centre', 60, 20, 60, 60))
  const dim = (o) => ({ type: 'dim', layer: 'Dimensions', th: 3, as: 3, pr: 1, ...o })
  ents.push(
    dim({ kind: 'linear', a: { x: 0, y: 0 }, b: { x: 120, y: 0 }, loc: { x: 60, y: -14 }, ang: 0 }),
    dim({ kind: 'linear', a: { x: 0, y: 0 }, b: { x: 0, y: 80 }, loc: { x: -14, y: 40 }, ang: Math.PI / 2 }),
    dim({ kind: 'linear', a: { x: 20, y: 20 }, b: { x: 100, y: 20 }, loc: { x: 60, y: 6 }, ang: 0 }),
    dim({ kind: 'linear', a: { x: 20, y: 20 }, b: { x: 20, y: 60 }, loc: { x: 6, y: 40 }, ang: Math.PI / 2 }),
    dim({ kind: 'diameter', cx: 60, cy: 40, r: 15, loc: { x: 88, y: 58 } }),
    dim({ kind: 'diameter', cx: 100, cy: 60, r: 5, loc: { x: 110, y: 74 } }),
    dim({ kind: 'radius', cx: 8, cy: 8, r: 8, loc: { x: -4, y: -6 } }),
    text('Text', 0, -34, 5, 'BASE PLATE  |  6 mm steel  |  4x Ø10 holes', { align: 'l' }),
  )
  Object.assign(s.settings, { textH: 3, dimTh: 3, dimAs: 3, dimPr: 1, ltscale: 0.4 })
  return finish(s, ents)
}

/** A small two-room floor plan in millimetres with walls, doors, a window, dimensions and labels. */
export function floorPlan() {
  const s = blankState('mm')
  s.layers = [newLayer('0'), newLayer('Walls', { color: '#ffffff', lw: 0.5 }), newLayer('Doors', { color: '#f76b15', lw: 0.25 }), newLayer('Windows', { color: '#3e63dd', lw: 0.25 }), newLayer('Dimensions', { color: '#12a594', lw: 0.18 }), newLayer('Text', { color: '#7d8590', lw: 0.18 })]
  const W = 9000, H = 6500, T = 200
  const ents = []
  const wall = (...a) => ents.push(line('Walls', ...a))
  // a wall side as outer + inner lines with gaps (doors and windows) and jamb lines
  const hrun = (y0, y1, x0, x1, gaps) => {
    let x = x0
    for (const [g0, g1] of gaps) { wall(x, y0, g0, y0); wall(x, y1, g0, y1); wall(g0, y0, g0, y1); wall(g1, y0, g1, y1); x = g1 }
    wall(x, y0, x1, y0); wall(x, y1, x1, y1)
  }
  const vrun = (x0, x1, y0, y1, gaps) => {
    let y = y0
    for (const [g0, g1] of gaps) { wall(x0, y, x0, g0); wall(x1, y, x1, g0); wall(x0, g0, x1, g0); wall(x0, g1, x1, g1); y = g1 }
    wall(x0, y, x0, y1); wall(x1, y, x1, y1)
  }
  hrun(0, T, 0, W, [[1000, 1900]])
  hrun(H - T, H, 0, W, [[1500, 3300], [6500, 8000]])
  wall(0, 0, 0, H); wall(W, 0, W, H); wall(T, T, T, H - T); wall(W - T, T, W - T, H - T)
  vrun(5400, 5600, T, H - T, [[2300, 3200]])
  // doors: leaf + swing arc
  const door = (hx, hy, r, a0, a1, leafAngle) => {
    ents.push({ type: 'arc', layer: 'Doors', cx: hx, cy: hy, r, a0: a0 * D2R, a1: a1 * D2R })
    ents.push(line('Doors', hx, hy, hx + Math.cos(leafAngle * D2R) * r, hy + Math.sin(leafAngle * D2R) * r))
  }
  door(1000, T, 900, 0, 90, 90)
  door(5400, 3200, 900, 180, 270, 180)
  // windows
  for (const [x0, x1] of [[1500, 3300], [6500, 8000]]) for (const y of [H - T, H - T / 2, H]) ents.push(line('Windows', x0, y, x1, y))
  const dim = (o) => ({ type: 'dim', layer: 'Dimensions', th: 180, as: 150, pr: 0, ...o })
  ents.push(
    dim({ kind: 'linear', a: { x: 0, y: 0 }, b: { x: W, y: 0 }, loc: { x: W / 2, y: -900 }, ang: 0 }),
    dim({ kind: 'linear', a: { x: 0, y: 0 }, b: { x: 0, y: H }, loc: { x: -900, y: H / 2 }, ang: Math.PI / 2 }),
    dim({ kind: 'linear', a: { x: T, y: H }, b: { x: 5400, y: H }, loc: { x: 2800, y: H + 700 }, ang: 0 }),
    dim({ kind: 'linear', a: { x: 5600, y: H }, b: { x: W - T, y: H }, loc: { x: 7300, y: H + 700 }, ang: 0 }),
    text('Text', 1800, 3200, 260, 'LIVING / KITCHEN', { align: 'l' }),
    text('Text', 6000, 4800, 260, 'BEDROOM', { align: 'l' }),
    text('Text', 6000, 1100, 260, 'BATH', { align: 'l' }),
    text('Text', 0, -1900, 300, 'GROUND FLOOR PLAN  1:50', { align: 'l' }),
  )
  Object.assign(s.settings, { textH: 220, dimTh: 180, dimAs: 150, dimPr: 0, gridStep: 500, hatchScale: 80, ltscale: 40 })
  return finish(s, ents)
}

export const TEMPLATES = { plate: platePart, floorplan: floorPlan }
