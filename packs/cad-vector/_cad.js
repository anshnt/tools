// DXF -> SVG, PDF and PNG through CAD Studio's own DXF reader and exporters (packs/studio-cad).
import { importDxf } from '../studio-cad/_dxf.js'
import { Doc, blankState } from '../studio-cad/_doc.js'
import { toSvg, toPdf, toPngBlob, PAPERS } from '../studio-cad/_export.js'
import { bbox } from '../studio-cad/_ent.js'
import { unionBox } from '../studio-cad/_vec.js'

export const PAPER_CHOICES = [...Object.keys(PAPERS).map((k) => [k, k]), ['drawing', 'Drawing size (1:1)']]
const niceNum = (x) => { if (!(x > 0)) return 1; const e = 10 ** Math.floor(Math.log10(x)); return [1, 2, 2.5, 5, 10].map((m) => m * e).reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a)) }

/** DXF bytes or text -> {doc, res} where doc is a CAD Studio Doc and res the import report ({count, skipped, units, layers}). */
export async function dxfToCad(data, name = 'drawing') {
  const res = await importDxf(data)
  if (!res.count) throw Object.assign(new Error('No drawable objects were found.'), { userMessage: 'No drawable objects were found in this drawing. It may only hold 3D solids, pictures or kinds of objects that are not supported.' })
  const st = blankState(res.units)
  let id = 1
  st.ents = res.ents.map((e) => ({ ...e, id: id++ }))
  st.nextId = id
  st.layers = res.layers
  const ext = st.ents.reduce((b, e) => unionBox(b, bbox(e)), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity })
  const size = Math.max(ext.x1 - ext.x0, ext.y1 - ext.y0)
  if (Number.isFinite(size) && size > 0) {
    const th = niceNum(size / 140)
    Object.assign(st.settings, { textH: th, dimTh: th, dimAs: th, gridStep: niceNum(size / 40), hatchScale: niceNum(size / 300), ltscale: res.ltscale ?? niceNum(size / 300) })
  }
  const doc = new Doc(st)
  doc.name = name
  return { doc, res }
}

export const skippedNote = (res) => {
  const e = Object.entries(res.skipped || {})
  return e.length ? `Not drawn (not supported): ${e.map(([k, n]) => `${k} x${n}`).join(', ')}.` : ''
}

/** to: 'svg' | 'pdf' | 'png'. opts: {paper, px, transparent, mono} */
export async function cadExport(doc, to, opts = {}) {
  const plot = { paper: opts.paper || 'A4', orient: 'auto', scale: 'fit', margin: 10, mono: !!opts.mono, background: '#ffffff' }
  if (to === 'svg') return new Blob([toSvg(doc, plot)], { type: 'image/svg+xml' })
  if (to === 'pdf') return toPdf(doc, plot)
  if (to === 'png') return toPngBlob(doc, { px: opts.px || 2000, transparent: !!opts.transparent, mono: !!opts.mono })
  throw new Error(`Cannot write ${to} from a drawing.`)
}
