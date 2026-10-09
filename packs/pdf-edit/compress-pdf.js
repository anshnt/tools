// Compress PDF: recompress the JPEG images inside (text stays selectable), hit a target size, and only as a last resort turn pages into images.
import { h, icon, busy, progress, number, select, field, button, toggle, alert, formatBytes, yieldToMain } from '../../lib/ui.js'
import { savePdf, pdfToTargetSize } from '../../lib/pdf.js'
import { toBlob } from '../../lib/image.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, plural, pick, dock } from './_shared.js'

const CSS = `
.pe-space { display: flex; height: 14px; border-radius: 99px; overflow: hidden; background: var(--surface-3); border: 1px solid var(--border); }
.pe-space i { display: block; height: 100%; transition: width .8s var(--ease); }
.pe-space i:nth-child(1) { background: linear-gradient(90deg, #f97316, #ec4899); }
.pe-space i:nth-child(2) { background: #a78bfa; }
.pe-space i:nth-child(3) { background: var(--border-strong); }
.pe-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--muted); }
.pe-legend span::before { content: ""; display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 6px; background: var(--c); }
.pe-bars { display: grid; gap: 8px; margin: 14px 0 4px; }
.pe-bar2 { display: grid; grid-template-columns: 64px minmax(0, 1fr) 76px; gap: 10px; align-items: center; font-size: 12.5px; color: var(--muted); }
.pe-bar2 b { color: var(--text); font-variant-numeric: tabular-nums; text-align: right; }
.pe-bar2 div { height: 12px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.pe-bar2 i { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--border-strong); transition: width 1s .25s var(--ease); }
.pe-bar2.after i { background: linear-gradient(90deg, #34d399, #12804a); }
.pe-custom-size { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 8px; max-width: 320px; }
`

/** Image quality ladder, gentle first. q = JPEG quality, max = longest side in pixels. */
export const LEVELS = [
  { q: 0.85, max: 2600 }, { q: 0.78, max: 2000 }, { q: 0.7, max: 1600 }, { q: 0.6, max: 1300 }, { q: 0.5, max: 1050 },
  { q: 0.4, max: 850 }, { q: 0.32, max: 680 }, { q: 0.25, max: 520 }, { q: 0.2, max: 400 },
]
const BALANCED = 2
/** Interpolated level for t in [0, LEVELS.length - 1]. */
export function levelAt(t) {
  const i = Math.min(LEVELS.length - 1, Math.floor(t)), j = Math.min(LEVELS.length - 1, i + 1), f = t - i
  return { q: LEVELS[i].q + (LEVELS[j].q - LEVELS[i].q) * f, max: LEVELS[i].max + (LEVELS[j].max - LEVELS[i].max) * f }
}
const PRESETS = [
  { value: 'balanced', label: 'Balanced', hint: 'Smaller, still sharp. Good for most files.', icon: 'scale' },
  { value: 'max', label: 'Max quality', hint: 'Lossless: tidy the file without touching images.', icon: 'gem' },
  { value: 'email', label: 'Email', hint: 'Under 10 MB for attachments.', icon: 'mail', target: 10_000_000 },
  { value: 'whatsapp', label: 'WhatsApp', hint: 'About 2 MB, quick to send on mobile data.', icon: 'message-circle', target: 2_000_000 },
  { value: 'portal', label: 'Government portal', hint: 'Under 200 KB for upload forms.', icon: 'landmark', target: 200_000 },
  { value: 'custom', label: 'Custom size', hint: 'Pick your own target.', icon: 'sliders-horizontal' },
]

/** Find JPEG images that are safe to recompress and remember their original bytes. */
export async function findJpegs(doc) {
  const lib = await pdfLib()
  const { PDFName, PDFRawStream, PDFArray, PDFDict, PDFStream, PDFBool, PDFRef } = lib
  const ctx = doc.context
  const N = (s) => PDFName.of(s)
  const masks = new Set()
  const all = []
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue
    const d = obj.dict
    if (d.get(N('Subtype'))?.toString() !== '/Image') { all.push({ ref, obj, image: false }); continue }
    for (const k of ['SMask', 'Mask']) { const m = d.get(N(k)); if (m instanceof PDFRef) masks.add(m.toString()) }
    all.push({ ref, obj, image: true })
  }
  const out = []
  let jpegBytes = 0, otherImg = 0, other = 0
  for (const { ref, obj, image } of all) {
    const size = obj.getContentsSize?.() ?? obj.contents?.length ?? 0
    if (!image) { other += size; continue }
    const d = obj.dict
    const f = d.lookup(N('Filter'))
    const filters = f instanceof PDFArray ? Array.from({ length: f.size() }, (_, i) => f.lookup(i).toString()) : f ? [f.toString()] : []
    const isJpeg = filters.at(-1) === '/DCTDecode' && filters.slice(0, -1).every((x) => ['/ASCII85Decode', '/ASCIIHexDecode', '/FlateDecode', '/RunLengthDecode'].includes(x))
    if (!isJpeg) { otherImg += size; continue }
    jpegBytes += size
    const cs = d.lookup(N('ColorSpace'))
    let ok = cs?.toString() === '/DeviceRGB' || cs?.toString() === '/DeviceGray'
    if (!ok && cs instanceof PDFArray && cs.lookup(0)?.toString() === '/ICCBased') { const n = cs.lookupMaybe(1, PDFStream)?.dict.lookup(N('N'))?.asNumber?.(); ok = n === 3 || n === 1 }
    const im = d.lookup(N('ImageMask'))
    if (!ok || (im instanceof PDFBool && im.asBoolean()) || d.has(N('Decode')) || d.lookup(N('Mask')) instanceof PDFArray || masks.has(ref.toString()) || !(obj instanceof PDFRawStream) || size < 8000) continue
    let bytes = obj.contents
    if (filters.length > 1) {
      // reportlab and some others wrap the JPEG in ASCII85 or Flate: undo the wrapper to get the plain JPEG
      try {
        const lead = ctx.obj({})
        for (const [k, v] of d.entries()) if (k.decodeText() !== 'Filter' && k.decodeText() !== 'DecodeParms') lead.set(k, v)
        lead.set(N('Filter'), ctx.obj(filters.slice(0, -1).map((x) => PDFName.of(x.slice(1)))))
        bytes = lib.decodePDFRawStream(PDFRawStream.of(lead, obj.contents)).decode()
      } catch { continue }
    }
    out.push({ ref, size, bytes, orig: obj })
  }
  return { images: out, jpegBytes, otherImg, other }
}

/** Re-encode the found images at one level and write them into the document. Returns {done, before, after}. */
export async function applyLevel(doc, images, level, onTick) {
  const { PDFName, PDFRawStream } = await pdfLib()
  const ctx = doc.context
  let done = 0, before = 0, after = 0
  for (let i = 0; i < images.length; i++) {
    const im = images[i]
    before += im.size
    let bmp
    try { bmp = await createImageBitmap(new Blob([im.bytes], { type: 'image/jpeg' })) } catch { after += im.size; continue }
    const k = Math.min(1, level.max / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k))
    const c = document.createElement('canvas')
    c.width = w; c.height = hh
    const g = c.getContext('2d')
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh)
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, 0, 0, w, hh)
    bmp.close?.()
    const blob = await toBlob(c, 'image/jpeg', level.q)
    c.width = c.height = 0
    if (blob.size < im.bytes.length * 0.93) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const dict = ctx.obj({})
      for (const [key, v] of im.orig.dict.entries()) { const n = key.decodeText(); if (!['Length', 'Filter', 'DecodeParms', 'Width', 'Height', 'ColorSpace', 'BitsPerComponent', 'Decode'].includes(n)) dict.set(key, v) }
      dict.set(PDFName.of('Type'), PDFName.of('XObject')); dict.set(PDFName.of('Subtype'), PDFName.of('Image'))
      dict.set(PDFName.of('Width'), ctx.obj(w)); dict.set(PDFName.of('Height'), ctx.obj(hh))
      dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB')); dict.set(PDFName.of('BitsPerComponent'), ctx.obj(8)); dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
      ctx.assign(im.ref, PDFRawStream.of(dict, bytes))
      done++; after += bytes.length
    } else {
      // not worth it: put the original back (an earlier, harsher level may have replaced it)
      ctx.assign(im.ref, im.orig); after += im.size
    }
    onTick?.((i + 1) / images.length)
    await yieldToMain()
  }
  return { done, before, after }
}

export function mount(root) {
  css('pe-compress', CSS)
  pdfWorkspace(root, {
    label: 'Drop a PDF to shrink',
    icon: 'minimize-2',
    async onLoad(src, ws) {
      const result = h('div'), prog = progress()
      const doc0 = await src.edit()
      const info = await findJpegs(doc0)
      const total = src.size
      const pct = (n) => `${Math.max(0, Math.min(100, (n / total) * 100)).toFixed(1)}%`
      const rest = Math.max(0, total - info.jpegBytes - info.otherImg)
      let preset = 'balanced'
      const presets = pick(PRESETS, preset, (v) => { preset = v; sync() })
      const size = number(1, { min: 0.01, step: 0.1, ariaLabel: 'Target size', onInput: () => sync() })
      const unit = select([['MB', 'MB'], ['KB', 'KB']], 'MB', () => sync())
      const sizeBox = field('Target size', h('div', { class: 'pe-custom-size' }, size, unit))
      const raster = toggle('If photos alone cannot reach the size, turn pages into images (text becomes non-selectable)', true)
      const btn = button('Compress PDF', { icon: 'minimize-2', variant: 'primary', onClick: () => run() })
      const bar = dock({ actions: [btn] })

      const targetOf = () => (preset === 'custom' ? Math.round((size.valueAsNumber || 0) * (unit.value === 'MB' ? 1_000_000 : 1000)) : PRESETS.find((p) => p.value === preset).target || null)
      function sync() {
        sizeBox.hidden = preset !== 'custom'
        raster.hidden = !(preset === 'custom' || PRESETS.find((p) => p.value === preset).target)
        const t = targetOf()
        const invalid = preset === 'custom' && !(t > 0)
        btn.disabled = invalid
        bar.text(invalid ? 'Type a target size.' : preset === 'max' ? 'Lossless: only the file structure is tidied.' : t ? h('span', 'Aim for ', h('b', `under ${formatBytes(t)}`), `. This file is ${formatBytes(total)} now.`) : h('span', 'Recompress photos for a smaller file that still looks good.'))
      }

      async function run() {
        const target = targetOf()
        await busy(btn, async () => {
          prog.set(0.02, 'Reading file')
          const notes = []
          let best = null // {blob, kind}
          const save = async (d) => new Blob([await d.save({ useObjectStreams: true })], { type: 'application/pdf' })
          // 1) lossless tidy-up
          const doc = await src.edit()
          const lossless = await save(doc)
          let blob = lossless.size < total ? lossless : null
          let kind = 'lossless'
          let imgsDone = 0
          const reached = (b) => target && b && b.size <= target
          // 2) recompress photos in place
          if (preset !== 'max' && info.images.length && !reached(blob || { size: total })) {
            const label = (lv) => `Photos at ${Math.round(lv.q * 100)}% quality, up to ${Math.round(lv.max)}px`
            const tryAt = async (t) => {
              const lv = levelAt(t)
              prog.set(0, label(lv))
              const stats = await applyLevel(doc, info.images, lv, (f) => prog.set(f, label(lv)))
              const b = await save(doc)
              return { b, stats }
            }
            const keep = ({ b, stats }) => { if (!blob || b.size < blob.size) { blob = b; kind = 'images'; imgsDone = stats.done } }
            if (!target) keep(await tryAt(BALANCED))
            else {
              const budget = target - (total - info.jpegBytes)
              const r = budget / Math.max(1, info.jpegBytes)
              let li = r > 0.6 ? 0 : r > 0.38 ? 1 : r > 0.25 ? 2 : r > 0.16 ? 3 : r > 0.1 ? 4 : r > 0.065 ? 5 : r > 0.04 ? 6 : r > 0.025 ? 7 : 8
              li = Math.max(0, li - 1)
              let win = null
              for (; li < LEVELS.length; li++) {
                const res = await tryAt(li)
                if (!win && res.b.size <= target) { win = { t: li, res } }
                keep(res)
                if (res.b.size <= target) break
              }
              // the ladder jumps in big steps: bisect between the last miss and the first hit to stay as sharp as the size allows
              if (win && win.t > 0 && win.res.b.size < target * 0.8) {
                let lo = win.t - 1, hi = win.t
                for (let k = 0; k < 4; k++) {
                  const mid = (lo + hi) / 2
                  const res = await tryAt(mid)
                  if (res.b.size <= target) { hi = mid; blob = res.b; kind = 'images'; imgsDone = res.stats.done; if (res.b.size >= target * 0.85) break } else lo = mid
                }
              }
            }
          }
          // 3) last resort: rebuild pages as images
          if (target && (!blob || blob.size > target) && raster.input.checked) {
            prog.set(null, 'Converting pages to images')
            const r = await pdfToTargetSize(src.bytes, { maxBytes: target, password: src.password, onProgress: (f, t) => prog.set(f, t || 'Converting pages to images') })
            if (!blob || r.blob.size < blob.size) { blob = r.blob; kind = 'raster' }
          }
          if (!blob || blob.size >= total) {
            await showResult(result, {
              blob: new Blob([src.bytes], { type: 'application/pdf' }), name: outName(src.file, 'copy'), title: 'Already as small as it gets', lead: `${src.name} is ${formatBytes(total)} and could not be made smaller without hurting quality.`,
              facts: [{ label: 'Size', value: formatBytes(total) }], note: info.images.length ? 'Try a smaller target, or the Government portal preset.' : 'This file has no photos to recompress. Most of it is text and drawings, which are already compact.', again: ws.reset, button: 'Download original',
            })
            return
          }
          const saved = 1 - blob.size / total
          const hit = !target || blob.size <= target
          if (kind === 'images') notes.push(`${plural(imgsDone, 'photo')} recompressed in place. Text, links and bookmarks are untouched and still selectable.`)
          if (kind === 'lossless') notes.push('Only the file structure was optimised, so quality is identical to the original.')
          if (kind === 'raster') notes.push('Pages were converted to images to reach the size, so the text is no longer selectable.')
          if (!hit) notes.push(`This is the smallest we could reach, still above your ${formatBytes(target)} target.`)
          const bars = h('div', { class: 'pe-bars' },
            h('div', { class: 'pe-bar2' }, h('span', 'Before'), h('div', h('i', { style: 'width:100%' })), h('b', formatBytes(total))),
            h('div', { class: 'pe-bar2 after' }, h('span', 'After'), h('div', h('i', { dataset: { w: Math.max(2, (blob.size / total) * 100).toFixed(1) } })), h('b', formatBytes(blob.size))))
          await showResult(result, {
            blob, name: outName(src.file, 'compressed'), title: hit ? (saved < 0.01 ? 'Tidied up, nothing lost' : saved > 0.995 ? 'Over 99% smaller' : `${Math.round(saved * 100)}% smaller`) : `Down ${Math.round(saved * 100)}%, not quite there`, lead: `${formatBytes(total)} to ${formatBytes(blob.size)}.`,
            facts: [{ label: 'Saved', value: formatBytes(total - blob.size), tone: 'good' }, { label: 'New size', value: formatBytes(blob.size), tone: hit ? 'good' : 'bad' }, { label: 'Method', value: kind === 'raster' ? 'Page images' : kind === 'images' ? 'Photo recompression' : 'Lossless' }],
            extra: bars, note: notes.join(' '), again: ws.reset,
          })
          requestAnimationFrame(() => requestAnimationFrame(() => { for (const i of result.querySelectorAll('.pe-bar2.after i')) i.style.width = `${i.dataset.w}%` }))
          for (const i of result.querySelectorAll('.pe-bar2:not(.after) i')) i.style.width = '100%'
        }, { label: 'Compressing', errorTo: result, progress: prog })
      }

      const space = h('section', { class: 'panel stack' }, heading('pie-chart', 'What takes up space'),
        h('div', { class: 'pe-space', role: 'img', 'aria-label': `Photos ${pct(info.jpegBytes)}, other images ${pct(info.otherImg)}, everything else ${pct(rest)}` }, h('i', { style: { width: pct(info.jpegBytes) } }), h('i', { style: { width: pct(info.otherImg) } }), h('i', { style: { width: pct(rest) } })),
        h('div', { class: 'pe-legend' }, h('span', { style: '--c:#f97316' }, `Photos (JPEG) ${formatBytes(info.jpegBytes)}`), h('span', { style: '--c:#a78bfa' }, `Other images ${formatBytes(info.otherImg)}`), h('span', { style: '--c:var(--border-strong)' }, `Text, fonts, rest ${formatBytes(rest)}`)),
        h('small', { class: 'field-hint' }, info.images.length ? `${plural(info.images.length, 'photo')} can be recompressed without touching the text.` : 'There are no JPEG photos to recompress here, so only a lossless tidy-up or page images can shrink this file.'))
      sync()
      return [space, h('section', { class: 'panel stack' }, heading('gauge', 'How small?'), presets, sizeBox, raster), prog.el, result, bar]
    },
  })
}
