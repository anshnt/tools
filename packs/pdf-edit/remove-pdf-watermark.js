// Remove PDF watermark (best effort): stamp annotations, watermark layers, repeated images and text you name.
// It can only remove what is stored separately from the page picture. Scans and flattened files are out of reach, and the UI says so.
import { h, icon, busy, progress, field, textarea, button, toggle, alert, formatBytes, debounce, yieldToMain } from '../../lib/ui.js'
import { savePdf } from '../../lib/pdf.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfWorkspace, showResult, outName, css, heading, plural } from './_shared.js'
import { bytesToStr, strToBytes, cleanContent, makeDecoder } from './_content.js'

const CSS = `
.pe-find { display: grid; gap: 10px; }
.pe-find .pe-hid { align-items: center; }
.pe-cand { display: flex; flex-wrap: wrap; gap: 6px; }
.pe-cand button { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; height: 32px; padding: 0 12px; border-radius: 99px; border: 1.5px dashed var(--border-strong); background: var(--surface); cursor: pointer; font-size: 13px; transition: all .2s var(--spring); }
.pe-cand button:hover { border-style: solid; border-color: var(--accent); transform: translateY(-2px); }
.pe-cand button.is-wm { border-color: color-mix(in srgb, var(--warning) 55%, var(--border)); background: var(--warning-soft); }
.pe-cand button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pe-cand small { color: var(--muted); font-size: 11.5px; }
.pe-match { font-size: 13px; color: var(--muted); }
.pe-match.ok { color: var(--success); }
`
const LAYER_RE = /water|draft|confiden|stamp|sample|copy|void|specimen/i
const key = (r) => r.toString()

/** Text that shows up on most pages; rotated or very large text is flagged as a likely watermark. */
export async function findRepeatedText(pdf, maxPages = 40) {
  const n = Math.min(pdf.numPages, maxPages)
  const seen = new Map()
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i)
    const tc = await page.getTextContent()
    for (const it of tc.items) {
      if (!('str' in it)) continue
      const t = it.str.trim()
      if (t.length < 3 || /^\d+$/.test(t)) continue
      const [a, b, c] = it.transform
      const e = seen.get(t.toLowerCase()) || { text: t, pages: new Set(), rotated: false, size: 0 }
      e.pages.add(i); e.rotated ||= Math.abs(b) > 0.02 || Math.abs(c) > 0.02; e.size = Math.max(e.size, Math.hypot(a, b))
      seen.set(t.toLowerCase(), e)
    }
    if (i % 5 === 0) await yieldToMain()
  }
  const min = Math.max(2, Math.ceil(n * 0.6))
  return [...seen.values()].filter((e) => e.pages.size >= min).map((e) => ({ text: e.text, pages: e.pages.size, of: n, likely: e.rotated || e.size >= 36 })).sort((x, y) => Number(y.likely) - Number(x.likely) || y.pages - x.pages).slice(0, 10)
}

export function mount(root) {
  css('pe-rmwm', CSS)
  pdfWorkspace(root, {
    label: 'Drop a watermarked PDF',
    icon: 'eraser',
    async onLoad(src, ws) {
      const lib = await pdfLib()
      const { PDFName, PDFDict, PDFArray, PDFStream, PDFRef, PDFNumber } = lib
      const result = h('div'), prog = progress()
      const doc = await src.edit()
      const ctx = doc.context
      const pages = doc.getPages()
      const N = (s) => PDFName.of(s)
      const nameOf = (o) => { try { return o.decodeText() } catch { return '' } }

      // ---------- scan ----------
      const annots = { watermark: 0, stamp: 0 }
      pages.forEach((p) => { const a = p.node.Annots(); if (a) for (let i = 0; i < a.size(); i++) { const sub = a.lookupMaybe(i, PDFDict)?.get(N('Subtype'))?.toString(); if (sub === '/Watermark') annots.watermark++; else if (sub === '/Stamp') annots.stamp++ } })
      const layers = []
      const ocp = doc.catalog.lookupMaybe(N('OCProperties'), PDFDict)
      const ocgs = ocp?.lookupMaybe(N('OCGs'), PDFArray)
      if (ocgs) for (let i = 0; i < ocgs.size(); i++) { const ref = ocgs.get(i), d = ocgs.lookupMaybe(i, PDFDict); const name = d ? nameOf(d.lookup(N('Name'))) : ''; if (d) layers.push({ ref, name, hit: LAYER_RE.test(name), on: LAYER_RE.test(name) }) }
      const imgCount = new Map()
      pages.forEach((p) => { const xo = p.node.Resources()?.lookupMaybe(N('XObject'), PDFDict); if (!xo) return; const seenHere = new Set(); for (const [, v] of xo.entries()) { if (!(v instanceof PDFRef)) continue; const o = ctx.lookup(v); if (o instanceof PDFStream && o.dict.get(N('Subtype'))?.toString() === '/Image' && !seenHere.has(key(v))) { seenHere.add(key(v)); const e = imgCount.get(key(v)) || { ref: v, n: 0, w: o.dict.lookup(N('Width'), PDFNumber).asNumber(), h: o.dict.lookup(N('Height'), PDFNumber).asNumber() }; e.n++; imgCount.set(key(v), e) } } })
      const imgMin = Math.max(2, Math.ceil(pages.length * 0.6))
      const repeatedImgs = [...imgCount.values()].filter((e) => e.n >= imgMin).map((e) => ({ ...e, on: false }))
      const candidates = await findRepeatedText(src.pdf)

      // ---------- page streams (decoded once) ----------
      const fontCache = new Map()
      const decoderFor = (res) => (fontName) => {
        const fd = res?.lookupMaybe(N('Font'), PDFDict)?.lookupMaybe(N(fontName), PDFDict)
        if (!fd) return null
        const k = fd
        if (fontCache.has(k)) return fontCache.get(k)
        let toUnicode = null
        const tu = fd.lookupMaybe(N('ToUnicode'), PDFStream)
        if (tu) { try { toUnicode = bytesToStr(lib.decodePDFRawStream(tu).decode()) } catch { /* no map */ } }
        const enc = fd.lookup(N('Encoding'))
        const differences = {}
        const diff = enc instanceof PDFDict ? enc.lookupMaybe(N('Differences'), PDFArray) : null
        if (diff) { let code = 0; for (let i = 0; i < diff.size(); i++) { const v = diff.lookup(i); if (v instanceof PDFNumber) code = v.asNumber(); else { differences[code++] = nameOf(v) } } }
        const dec = makeDecoder({ toUnicode, differences, composite: fd.get(N('Subtype'))?.toString() === '/Type0' })
        fontCache.set(k, dec)
        return dec
      }
      const streamsOf = (page) => {
        const c = page.node.Contents()
        const list = c instanceof PDFArray ? Array.from({ length: c.size() }, (_, i) => ({ ref: c.get(i), obj: c.lookup(i) })) : c ? [{ ref: page.node.get(N('Contents')), obj: c }] : []
        return list.filter((x) => x.obj instanceof PDFStream)
      }
      const pageData = pages.map((p) => {
        const parts = streamsOf(p)
        let s = ''
        let ok = true
        for (const x of parts) { try { s += bytesToStr(lib.decodePDFRawStream(x.obj).decode()) + '\n' } catch { ok = false } }
        return { page: p, parts, s, ok, res: p.node.Resources() }
      })
      const unreadable = pageData.filter((d) => !d.ok).length

      // ---------- controls ----------
      const needles = textarea({ rows: 3, placeholder: 'One per line, for example:\nCONFIDENTIAL\nSample', 'aria-label': 'Watermark text to remove', oninput: () => count() })
      const tAnn = toggle('Remove watermark annotations', annots.watermark > 0)
      const tStamp = toggle('Remove stamp annotations (APPROVED, DRAFT...)', false)
      const matchBox = h('div', { class: 'pe-match', 'aria-live': 'polite' })
      const btn = button('Remove watermark', { icon: 'eraser', variant: 'primary', size: 'lg', onClick: () => run() })
      const addNeedle = (t) => { const cur = needles.value.split('\n').map((x) => x.trim()).filter(Boolean); if (!cur.some((x) => x.toLowerCase() === t.toLowerCase())) cur.push(t); needles.value = cur.join('\n'); count() }

      function options() {
        const wanted = needles.value.split('\n').map((x) => x.trim()).filter(Boolean)
        const onLayers = layers.filter((l) => l.on)
        const onImgs = repeatedImgs.filter((i) => i.on)
        return { wanted, onLayers, onImgs, layerKeys: new Set(onLayers.map((l) => key(l.ref))), imgKeys: new Set(onImgs.map((i) => key(i.ref))) }
      }
      /** names in a Resources dict that point at the things we want gone */
      function targets(res, o) {
        const wmProps = new Set(), wmX = new Set()
        const props = res?.lookupMaybe(N('Properties'), PDFDict)
        if (props) for (const [k, v] of props.entries()) if (v instanceof PDFRef && o.layerKeys.has(key(v))) wmProps.add(nameOf(k))
        const xo = res?.lookupMaybe(N('XObject'), PDFDict)
        if (xo) for (const [k, v] of xo.entries()) {
          if (v instanceof PDFRef && o.imgKeys.has(key(v))) wmX.add(nameOf(k))
          const obj = ctx.lookup(v)
          const oc = obj instanceof PDFStream ? obj.dict.get(N('OC')) : null
          if (oc instanceof PDFRef && o.layerKeys.has(key(oc))) wmX.add(nameOf(k))
        }
        return { wmProps, wmX }
      }
      const run1 = (data, o) => { const t = targets(data.res, o); return cleanContent(data.s, { needles: o.wanted, decoderFor: decoderFor(data.res), wmProps: t.wmProps, wmXObjects: t.wmX }) }
      /** Clean the form XObjects reachable from a Resources dict (in place when `write` is set). */
      function walkForms(res, o, c, ctx2, write, done, depth = 0) {
        const xo = res?.lookupMaybe(N('XObject'), PDFDict)
        if (!xo || depth > 6) return
        for (const [, ref] of xo.entries()) {
          if (!(ref instanceof PDFRef) || done.has(key(ref))) continue
          done.add(key(ref))
          const stream = ctx2.lookup(ref)
          if (!(stream instanceof PDFStream) || stream.dict.get(N('Subtype'))?.toString() !== '/Form') continue
          let text
          try { text = bytesToStr(lib.decodePDFRawStream(stream).decode()) } catch { continue }
          const fres = stream.dict.lookupMaybe(N('Resources'), PDFDict)
          const tg = targets(fres, o)
          const r = cleanContent(text, { needles: o.wanted, decoderFor: decoderFor(fres), wmProps: tg.wmProps, wmXObjects: tg.wmX })
          walkForms(fres, o, c, ctx2, write, done, depth + 1)
          if (r.text !== text) {
            if (write) {
              const entries = {}
              for (const [kk, vv] of stream.dict.entries()) { const nm = nameOf(kk); if (!['Length', 'Filter', 'DecodeParms'].includes(nm)) entries[nm] = vv }
              ctx2.assign(ref, ctx2.flateStream(strToBytes(r.text), entries))
            }
            c.text += r.removed.text; c.layers += r.removed.layers; c.images += r.removed.images
          }
        }
      }
      const count = debounce(() => {
        const o = options()
        if (!o.wanted.length) { matchBox.textContent = ''; matchBox.className = 'pe-match'; return }
        const c = { text: 0, layers: 0, images: 0 }, done = new Set()
        let n = 0
        for (const d of pageData) if (d.ok) { const r = run1(d, o); if (r.removed.text) n++; walkForms(d.res, o, c, ctx, false, done) }
        const inForms = c.text
        matchBox.className = n || inForms ? 'pe-match ok' : 'pe-match'
        matchBox.textContent = n || inForms ? `Found on ${plural(n, 'page')} of ${pages.length}${inForms ? `, plus ${plural(inForms, 'piece')} inside embedded page parts` : ''}.` : 'Not found in the page text. It may be an image, or stored in a font we cannot read.'
      }, 250)

      async function run() {
        const o = options()
        await busy(btn, async () => {
          prog.set(0, 'Cleaning pages')
          const out = await src.edit()
          const octx = out.context
          const opages = out.getPages()
          const total = { text: 0, layers: 0, images: 0, annots: 0, pages: 0 }
          const refCounts = new Map()
          pageData.forEach((d) => d.parts.forEach((x) => refCounts.set(key(x.ref), (refCounts.get(key(x.ref)) || 0) + 1)))
          const formsDone = new Set()
          for (let i = 0; i < opages.length; i++) {
            const d = pageData[i], pg = opages[i]
            if (d.ok && d.s) {
              const res = pg.node.Resources()
              const tg = targets(res, o)
              const r = cleanContent(d.s, { needles: o.wanted, decoderFor: decoderFor(res), wmProps: tg.wmProps, wmXObjects: tg.wmX })
              walkForms(res, o, total, octx, true, formsDone)
              if (r.text !== d.s) {
                const ref = octx.register(octx.flateStream(strToBytes(r.text)))
                pg.node.set(N('Contents'), ref)
                for (const x of d.parts) if (refCounts.get(key(x.ref)) === 1) octx.delete(x.ref)
                total.text += r.removed.text; total.layers += r.removed.layers; total.images += r.removed.images; total.pages++
              }
            }
            // annotations
            const an = pg.node.Annots()
            if (an) {
              const keep = []
              for (let k = 0; k < an.size(); k++) {
                const a = an.lookupMaybe(k, PDFDict)
                const sub = a?.get(N('Subtype'))?.toString()
                const oc = a?.get(N('OC'))
                const drop = (tAnn.input.checked && sub === '/Watermark') || (tStamp.input.checked && sub === '/Stamp') || (oc instanceof PDFRef && o.layerKeys.has(key(oc)))
                if (drop) total.annots++; else keep.push(an.get(k))
              }
              if (keep.length !== an.size()) { if (keep.length) pg.node.set(N('Annots'), octx.obj(keep)); else pg.node.delete(N('Annots')) }
            }
            prog.set((i + 1) / opages.length, `Page ${i + 1} of ${opages.length}`)
            if (i % 4 === 3) await yieldToMain()
          }
          // hide chosen layers too, so nothing of them can come back
          if (o.onLayers.length) {
            const oc = out.catalog.lookupMaybe(N('OCProperties'), PDFDict)
            const dflt = oc?.lookupMaybe(N('D'), PDFDict)
            if (dflt) { const off = dflt.lookupMaybe(N('OFF'), PDFArray) || octx.obj([]); dflt.set(N('OFF'), off); for (const l of o.onLayers) off.push(l.ref) }
          }
          const sum = total.text + total.layers + total.images + total.annots
          if (!sum) throw new Error(unreadable ? 'Nothing matched, and some pages could not be read. This watermark may be part of a picture, which cannot be removed here.' : 'Nothing matched. Check the spelling of the text, or this watermark may be part of a picture (a scan or a flattened file), which cannot be removed here.')
          const blob = await savePdf(out)
          await showResult(result, {
            blob, name: outName(src.file, 'no-watermark'), title: 'Watermark removed', lead: `${plural(sum, 'piece')} taken out. Check the preview, then compare it with your original.`,
            facts: [{ label: 'Text pieces', value: total.text }, { label: 'Layers', value: total.layers }, { label: 'Images', value: total.images }, { label: 'Annotations', value: total.annots }, { label: 'File size', value: formatBytes(blob.size) }],
            note: 'Best effort: only watermarks stored as text, layers, stamps or repeated images can be removed. Always keep your original.', again: ws.reset,
          })
        }, { label: 'Cleaning', errorTo: result, progress: prog })
      }

      const row = (title, desc, control) => h('div', { class: 'pe-hid has' }, h('div', h('b', title), h('small', desc)), control)
      const finds = h('div', { class: 'pe-find' },
        annots.watermark ? row(`${plural(annots.watermark, 'watermark annotation')}`, 'Stored as separate objects on the pages.', tAnn) : null,
        annots.stamp ? row(`${plural(annots.stamp, 'stamp')}`, 'Stamps are often real content you want to keep, so this is off by default.', tStamp) : null,
        layers.filter((l) => l.hit).map((l) => { const t = toggle('Remove', true, (v) => { l.on = v }); return row(`Layer "${l.name || 'unnamed'}"`, 'An optional content layer that looks like a watermark.', t) }),
        layers.filter((l) => !l.hit).length ? h('details', h('summary', { class: 'small muted', style: 'cursor:pointer' }, `${plural(layers.filter((l) => !l.hit).length, 'other layer')}`), h('div', { class: 'pe-find', style: 'margin-top:8px' }, layers.filter((l) => !l.hit).map((l) => row(`Layer "${l.name || 'unnamed'}"`, 'Does not look like a watermark.', toggle('Remove', false, (v) => { l.on = v }))))) : null,
        repeatedImgs.map((im) => row(`Image repeated on ${im.n} pages (${im.w} x ${im.h})`, 'Could be a watermark or a logo. Off by default.', toggle('Remove', false, (v) => { im.on = v }))))
      const nothing = !finds.children.length
      const panel = h('section', { class: 'panel stack' }, heading('search', 'What we found'),
        nothing ? alert('info', 'No watermark annotations, watermark layers or repeated images were found. If the watermark is text, name it below.') : finds,
        candidates.length ? h('div', { class: 'stack tight' }, h('div', { class: 'pe-sub-h' }, 'Text that repeats on most pages'), h('div', { class: 'pe-cand' }, candidates.map((c) => h('button', { type: 'button', class: c.likely ? 'is-wm' : '', title: c.likely ? 'Rotated or large: likely a watermark' : 'Repeats on most pages', onclick: () => addNeedle(c.text) }, h('span', c.text), h('small', `${c.pages}/${c.of}`))))) : null,
        field('Text to remove', needles, 'Everything in the page text that contains these words is taken out. Case does not matter.'), matchBox)
      const warn = alert('warn', h('strong', 'Best effort. '), 'This removes watermarks that are stored as separate text, layers, stamps or repeated images. A watermark baked into a scan or a flattened picture cannot be removed.')
      if (unreadable) matchBox.textContent = `${plural(unreadable, 'page')} use a content format we cannot read.`
      return [warn, panel, h('div', { class: 'row' }, btn), prog.el, result]
    },
  })
}
