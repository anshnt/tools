// Text -> outlines with opentype.js. Exact outlines from the font program embedded in the document (Doc.fonts) when the text carries
// glyphs, otherwise a bundled free font (closest of sans, serif, mono). Works on any {pages: [{items}], fonts?} object.
import { mapPath } from './_model.js'
import { loadFont, opentype } from './_libs.js'

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

// Parsed embedded fonts, by the data array (so a font shared by many items, or by several calls, is parsed once). null = unusable.
const parsed = new WeakMap()
async function embedded(doc, key) {
  const data = key != null && doc.fonts && Object.hasOwn(doc.fonts, key) ? doc.fonts[key]?.data : null
  if (!data || !data.byteLength) return null
  if (!parsed.has(data)) {
    parsed.set(data, (async () => {
      try { return (await opentype()).parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) } catch { return null }
    })())
  }
  return parsed.get(data)
}

/** Outline of exactly the glyphs the text carries, in text units, or null when the font lacks one of them. */
function glyphPath(font, it) {
  const cmds = []
  for (const g of it.glyphs) {
    if (typeof g?.c !== 'string' || !Number.isFinite(g.x)) return null
    const gi = font.charToGlyphIndex(g.c)
    if (!gi) { if (g.c.trim()) return null; continue }
    cmds.push(...font.glyphs.get(gi).getPath(g.x, 0, it.size).commands)
  }
  return cmds
}

/** Outline of a string (lines split on '\n', laid out with lh and align) in text units, or null when the font lacks a character. */
function stringPath(font, it) {
  const cmds = []
  const lines = String(it.str).split('\n'), lh = it.lh || 1.2
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]
    if ([...line].some((ch) => ch.trim() && !font.charToGlyphIndex(ch))) return null
    const w = it.align === 'center' || it.align === 'right' ? font.getAdvanceWidth(line, it.size) : 0
    const x = it.align === 'center' ? -w / 2 : it.align === 'right' ? -w : 0
    cmds.push(...font.getPath(line, x, k * lh * it.size, it.size).commands)
  }
  return cmds
}

/**
 * Replace text items of every page by path items. Returns {done, kept}: the number converted and the number left as text.
 * Text with a `font` key that exists in doc.fonts (data) and `glyphs` gets exact outlines from that font; anything else uses the bundled fonts.
 */
export async function outlineDoc(doc) {
  let done = 0, kept = 0
  for (const page of doc.pages || []) {
    if (!page.items) continue
    const out = []
    for (const it of page.items) {
      if (it.t !== 'text') { out.push(it); continue }
      try {
        let cmds = null
        const ef = await embedded(doc, it.font)
        if (ef) cmds = it.glyphs?.length ? glyphPath(ef, it) : stringPath(ef, it)
        if (!cmds) {
          const font = await loadFont(it.family, it.bold)
          cmds = stringPath(font, it)
        }
        if (!cmds) { kept++; out.push(it); continue }
        const d = mapPath(toCubic(cmds), it.m)
        if (d.length) out.push({ t: 'path', d, fill: it.fill, fillOpacity: it.opacity ?? 1, rule: 'nonzero', stroke: null, strokeWidth: 0, ...(it.clip ? { clip: it.clip } : {}),
          ...(it.name ? { name: it.name } : {}), ...(it.id != null ? { id: it.id } : {}), ...(it.hidden ? { hidden: it.hidden } : {}), ...(it.locked ? { locked: it.locked } : {}) })
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
