// Text -> outlines with opentype.js and a bundled free font.
import { mapPath } from './_model.js'
import { loadFont } from './_libs.js'

const toCubic = (cmds) => {
  const d = []
  let cx = 0, cy = 0, sx = 0, sy = 0
  for (const c of cmds) {
    if (c.type === 'M') { d.push(['M', c.x, c.y]); cx = sx = c.x; cy = sy = c.y }
    else if (c.type === 'L') { d.push(['L', c.x, c.y]); cx = c.x; cy = c.y }
    else if (c.type === 'C') { d.push(['C', c.x1, c.y1, c.x2, c.y2, c.x, c.y]); cx = c.x; cy = c.y }
    else if (c.type === 'Q') {
      d.push(['C', cx + (2 / 3) * (c.x1 - cx), cy + (2 / 3) * (c.y1 - cy), c.x + (2 / 3) * (c.x1 - c.x), c.y + (2 / 3) * (c.y1 - c.y), c.x, c.y]); cx = c.x; cy = c.y
    } else if (c.type === 'Z') { d.push(['Z']); cx = sx; cy = sy }
  }
  return d
}

/** Replace text items of every page by path items. Returns the number converted and the number left as text. */
export async function outlineDoc(doc) {
  let done = 0, kept = 0
  for (const page of doc.pages) {
    const out = []
    for (const it of page.items) {
      if (it.t !== 'text') { out.push(it); continue }
      try {
        const font = await loadFont(it.family, it.bold)
        if ([...it.str].some((ch) => ch.trim() && !font.charToGlyphIndex(ch))) { kept++; out.push(it); continue }
        const path = font.getPath(it.str, 0, 0, it.size)
        const d = mapPath(toCubic(path.commands), it.m)
        if (d.length) out.push({ t: 'path', d, fill: it.fill, fillOpacity: it.opacity ?? 1, rule: 'nonzero', stroke: null, strokeWidth: 0, ...(it.clip ? { clip: it.clip } : {}), ...(it.name ? { name: it.name } : {}) })
        done++
      } catch (e) {
        console.warn(e)
        kept++; out.push(it)
      }
    }
    page.items = out
  }
  return { done, kept }
}
