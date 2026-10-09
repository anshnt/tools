// Word to PDF. The .docx is rendered in the browser with docx-preview (page size, margins, headers and footers, styles, tables, lists and pictures),
// then every page is captured with html2canvas and written to a PDF with an invisible text layer so it stays searchable. Documents without page
// markers are paginated automatically. If docx-preview cannot read a file, mammoth gives a simpler flowing version instead.
import { h, button, busy, progress, alert, segmented, field, dropzone, split, clear, download, debounce, onCleanup, formatBytes, icon } from '../../lib/ui.js'
import { jszip, script, mammoth as mammothLib } from '../../lib/libs.js'
import { baseName } from '../../lib/files.js'
import { MAX_PIXELS } from '../../lib/image.js'
import { useStyles, flow, step, options, done, chip, note, plural, secs, checkAbort } from './_shared.js'
import { makeFrame, settle, measure, choosePages, renderRange, canvasSlice, createPdfBuilder, paginate, printFrame, mediaRanges, hasMediaIn, PX, tick } from './_paginate.js'

const DOCX_PREVIEW = 'https://cdn.jsdelivr.net/npm/docx-preview@0.4.0/dist/docx-preview.min.js'
const CSS = `
.t-wtp .pvwrap { position: relative; border: 1px solid var(--border); border-radius: var(--radius-lg); background: #e8e9ee; overflow: auto; height: 560px; }
.t-wtp .pvwrap iframe { display: block; border: 0; background: transparent; }
.t-wtp .pvbar { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); margin-bottom: 8px; flex-wrap: wrap; } .t-wtp .pvbar b { color: var(--text-2); }
.t-wtp .fcard { display: flex; align-items: center; gap: 14px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: linear-gradient(150deg, color-mix(in srgb, #2b6cdf 8%, var(--surface)), var(--surface)); animation: rise .45s var(--ease) both; }
.t-wtp .fcard .doc { width: 48px; height: 60px; flex: none; border-radius: 8px 12px 8px 8px; background: #2b6cdf; color: #fff; display: grid; place-items: end start; padding: 7px; font: 700 10px var(--mono); box-shadow: 0 10px 18px -10px #2b6cdf; }
.t-wtp .fcard .grow { flex: 1; min-width: 0; } .t-wtp .fcard .name { font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

let docxApi
async function docxPreview() {
  if (!docxApi) {
    window.JSZip = await jszip()
    await script(DOCX_PREVIEW)
    docxApi = window.docx
  }
  return docxApi
}

const DOC_BASE = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}section.docx{box-shadow:none!important;margin:0!important}</style></head><body></body></html>'

export function mount(root, { signal }) {
  useStyles({ id: 'wtp', css: CSS })
  const S = { scale: 2 }
  const fl = flow('docx', 'pdf')
  const prog = progress()
  const result = h('div', { class: 'stack' })
  let file = null, buf = null, previewFrame = null, simple = false

  const holder = h('div', { class: 'stack' })
  const prevFrame = h('iframe', { sandbox: 'allow-same-origin', title: 'Document preview', tabindex: -1 })
  const wrap = h('div', { class: 'pvwrap' }, prevFrame)
  const pvInfo = h('div', { class: 'pvbar' })
  const qualSeg = segmented([[2, 'Standard'], [3, 'Sharp']], S.scale, (v) => { S.scale = +v }, 'Quality')
  const zone = dropzone({ accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Drop a Word document here or click to choose', hint: '.docx files (save older .doc files as .docx first)', onFiles: ([f]) => loadFile(f) })

  async function renderInto(doc, data) {
    try {
      const d = await docxPreview()
      await d.renderAsync(data.slice(0), doc.body, doc.head, { className: 'docx', inWrapper: false, ignoreWidth: false, ignoreHeight: false, breakPages: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: false })
      await settle(doc)
      return 'docx'
    } catch (e) {
      // fall back to mammoth: simpler, flowing layout
      try {
        const mm = await mammothLib()
        const r = await mm.convertToHtml({ arrayBuffer: data.slice(0) })
        doc.body.innerHTML = `<main class="flow">${r.value}</main>`
        const st = doc.createElement('style')
        st.textContent = '.flow{font:11pt/1.55 Calibri,"Segoe UI",Arial,sans-serif;color:#111;padding:0}.flow h1{font-size:22pt}.flow h2{font-size:16pt}.flow h3{font-size:13pt}.flow table{border-collapse:collapse}.flow td,.flow th{border:1px solid #bbb;padding:4px 8px}.flow img{max-width:100%}'
        doc.head.append(st)
        await settle(doc)
        return 'flow'
      } catch (e2) { throw Object.assign(new Error('Could not read this Word file. It may be damaged, password protected or an old .doc file. Save it as .docx in Word and try again.'), { cause: e2 }) }
    }
  }

  async function loadFile(f) {
    clear(result)
    fl.state('idle')
    file = f
    clear(holder, h('div', { class: 'fcard' }, h('div', { class: 'doc' }, 'DOCX'), h('div', { class: 'grow' }, h('div', { class: 'name' }, f.name), h('div', { class: 'cv-sub' }, 'Reading the document...'))))
    try {
      const b = await f.arrayBuffer()
      const head = new Uint8Array(b.slice(0, 4))
      if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new Error(/\.doc$/i.test(f.name) ? 'This is an old .doc file. Open it in Word, choose Save As, pick .docx, and use that file here.' : 'This does not look like a .docx file.')
      buf = b
      // visible preview
      previewFrame?.destroy()
      previewFrame = await makeFrame(DOC_BASE.replace('</style>', 'body{background:#e8e9ee;padding:18px 0}section.docx{margin:0 auto 18px!important;box-shadow:0 6px 24px rgba(0,0,0,.18)!important}</style>'), 900)
      const mode = await renderInto(previewFrame.doc, buf)
      simple = mode === 'flow'
      const sections = [...previewFrame.doc.querySelectorAll('section.docx')]
      const pageW = sections[0]?.getBoundingClientRect().width || 816
      const k = Math.min(1, (wrap.clientWidth || 600) / (pageW + 36))
      const total = Math.max(previewFrame.doc.documentElement.scrollHeight, 400)
      prevFrame.style.width = `${pageW + 36}px`
      prevFrame.style.height = `${Math.round(total + 40)}px`
      prevFrame.style.zoom = String(k)
      prevFrame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">${[...previewFrame.doc.querySelectorAll('style')].map((s) => s.outerHTML).join('')}</head>${previewFrame.doc.body.outerHTML}</html>`
      const pages = sections.length
      clear(holder, h('div', { class: 'fcard' }, h('div', { class: 'doc' }, 'DOCX'), h('div', { class: 'grow' }, h('div', { class: 'name', title: f.name }, f.name),
        h('div', { class: 'cv-chips', style: 'margin-top:6px' }, chip(formatBytes(f.size), '', 'hard-drive'), mode === 'docx' ? chip(pages > 1 ? `${pages} page sections` : '1 page section', 'good', 'layers') : chip('Simplified layout', 'warn', 'info'), chip(`${Math.round(total / PX)} pt tall`, '', 'ruler'))),
      button('Change', { icon: 'refresh-cw', variant: 'ghost', size: 'sm', onClick: () => zone.open() })), zone)
      zone.hidden = true
      clear(pvInfo, h('b', 'Live preview'), mode === 'docx' ? 'as Word lays it out' : 'simplified, formatting approximated')
      s2.unlock(); s3.unlock()
      convertBtn.disabled = printBtn.disabled = false
    } catch (e) {
      zone.hidden = false
      clear(holder, alert('error', e.message), zone)
      s2.lock(); s3.lock()
    }
  }

  const convertBtn = button('Convert to PDF', { icon: 'file-down', variant: 'primary', size: 'lg', disabled: true })
  const printBtn = button('Print or save with the browser', { icon: 'printer', size: 'lg', disabled: true })
  convertBtn.addEventListener('click', () => busy(convertBtn, convert, { label: 'Building PDF', errorTo: result, progress: prog }))
  printBtn.addEventListener('click', async () => {
    const frame = await makeFrame(DOC_BASE, 900)
    await renderInto(frame.doc, buf)
    const sec = frame.doc.querySelector('section.docx')
    const w = sec ? sec.getBoundingClientRect().width : 816, hh = sec ? parseFloat(getComputedStyle(sec).minHeight) || 1056 : 1056
    printFrame(frame, { css: simple ? '@page{margin:18mm}' : `@page { size: ${w}px ${hh}px; margin: 0 } html, body { background: #fff } section.docx { box-shadow: none !important; margin: 0 !important; break-after: page; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }` })
    frame.win.addEventListener('afterprint', () => frame.destroy(), { once: true })
    setTimeout(() => frame.destroy(), 120_000)
  })

  async function convert() {
    clear(result)
    fl.state('working')
    const t0 = performance.now()
    const frame = await makeFrame(DOC_BASE, 900)
    try {
      const mode = await renderInto(frame.doc, buf)
      const title = baseName(file.name)
      let out
      if (mode === 'flow') {
        out = await paginate(frame.doc.querySelector('.flow'), { size: 'A4', margin: { t: 56, r: 56, b: 56, l: 56 }, scale: S.scale, title, onProgress: (f, t) => prog.set(f, t), signal })
      } else out = await convertSections(frame, title)
      const blob = new Blob([out.bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      onCleanup(() => URL.revokeObjectURL(url))
      done(result, {
        flowEl: fl, title: 'Your PDF is ready', text: mode === 'flow' ? 'This file used a simplified layout: headings, lists, tables and pictures are kept, but page layout and fonts are approximated.' : 'Pages match the Word layout and include an invisible text layer, so text can be searched and selected.',
        stats: [plural(out.pages, 'page'), `${out.words.toLocaleString()} words searchable`, out.links ? plural(out.links, 'link') : null, formatBytes(blob.size), secs(performance.now() - t0)].filter(Boolean),
        actions: [button('Download PDF', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, `${title}.pdf`) }), button('Preview', { icon: 'external-link', onClick: () => window.open(url, '_blank', 'noopener') })],
      })
    } catch (e) { fl.state('idle'); throw e } finally { frame.destroy() }
  }

  /** Each Word page section becomes a PDF page; sections taller than a page (documents saved without page markers) are cut at line boundaries. */
  async function convertSections(frame, title) {
    const doc = frame.doc, win = frame.win
    const rootEl = doc.body
    const sections = [...doc.querySelectorAll('section.docx')]
    if (!sections.length) throw new Error('This document has no pages to convert.')
    prog.set(0.03, 'Measuring pages')
    await tick()
    const m = measure(rootEl)
    const rootTop = rootEl.getBoundingClientRect().top
    const plan = []
    for (const sec of sections) {
      const r = sec.getBoundingClientRect(), cs = win.getComputedStyle(sec)
      const top = r.top - rootTop, hh = Math.max(r.height, sec.scrollHeight)
      const secW = r.width, minH = parseFloat(cs.minHeight) || r.height
      const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0
      const W = secW / PX, H = minH / PX
      if (hh <= minH + 8) { plan.push({ s: top, e: top + hh, W, H, secW, y: 0 }); continue }
      const sub = { atoms: m.atoms.filter((a) => a.top >= top - 1 && a.bottom <= top + hh + 1).map((a) => ({ ...a, top: a.top - top, bottom: a.bottom - top })), forced: [], height: hh }
      const ranges = choosePages(sub, minH - padT - padB, minH - padB)
      ranges.forEach(([s, e], i) => plan.push({ s: top + s, e: top + e, W, H, secW, y: i === 0 ? 0 : padT / PX }))
    }
    const media = mediaRanges(rootEl)
    const builder = await createPdfBuilder({ title, allText: m.words.map((w) => w.text).join(' '), textLayer: true })
    const widest = Math.max(...plan.map((p) => p.secW))
    const sr = S.scale
    const maxChunk = Math.max(1, Math.floor((MAX_PIXELS * 0.7) / (widest * sr * sr)))
    const totalH = Math.max(m.height, ...plan.map((p) => p.e)) + 40
    let i = 0
    while (i < plan.length) {
      checkAbort(signal)
      let j = i
      while (j + 1 < plan.length && plan[j + 1].e - plan[i].s <= maxChunk) j++
      prog.set(0.08 + 0.86 * (i / plan.length), `Rendering page ${i + 1} of ${plan.length}`)
      const chunk = await renderRange(rootEl, plan[i].s, plan[j].e, { width: widest, scale: sr, windowHeight: totalH })
      for (let p = i; p <= j; p++) {
        const pg = plan[p]
        const sy = Math.round((pg.s - plan[i].s) * sr), sh = Math.max(1, Math.min(chunk.height - sy, Math.round((pg.e - pg.s) * sr)))
        const sw = Math.round(pg.secW * sr)
        const c = document.createElement('canvas')
        c.width = sw; c.height = sh
        const g = c.getContext('2d')
        g.fillStyle = '#fff'; g.fillRect(0, 0, sw, sh)
        g.drawImage(chunk, 0, sy, sw, sh, 0, 0, sw, sh)
        const image = await canvasSlice(c, 0, sh, { jpeg: hasMediaIn(media, pg.s, pg.e) })
        c.width = c.height = 0
        const inPage = (top) => top >= pg.s - 1 && top < pg.e - 1
        await builder.addPage({
          W: pg.W, H: pg.H, image, x: 0, y: pg.y, w: pg.W, h: (pg.e - pg.s) / PX,
          words: m.words.filter((w) => inPage(w.top)).map((w) => ({ text: w.text, x: w.x / PX, y: pg.y + (w.top + w.h * 0.8 - pg.s) / PX, size: w.size / PX, w: w.w / PX })),
          links: m.links.filter((l) => inPage(l.top)).map((l) => ({ x: l.x / PX, y: pg.y + (l.top - pg.s) / PX, w: l.w / PX, h: l.h / PX, href: l.href })),
        })
      }
      chunk.width = chunk.height = 0
      i = j + 1
      await tick()
    }
    prog.set(0.97, 'Saving')
    return { bytes: await builder.save(), pages: plan.length, ...builder.stats() }
  }

  const s1 = step(1, 'Choose your Word document', h('div', { class: 'stack' }, holder))
  clear(holder, zone)
  const s2 = step(2, 'Preview', split(h('div', { class: 'stack' }, options(field('Quality', qualSeg, 'Sharp makes bigger files with crisper text.')), note('Layout, fonts, headers, footers, tables and pictures follow the document. Fonts you do not have installed are replaced by similar ones.', 'info')), h('div', pvInfo, wrap), 'wide-left'), { locked: true })
  const s3 = step(3, 'Create the PDF', h('div', { class: 'stack' }, h('div', { class: 'row' }, convertBtn, printBtn), note('Runs on your device. The file is never uploaded.', 'shield-check'), prog.el, result), { locked: true })
  root.append(h('div', { class: 'cv t-wtp' }, fl, s1, s2, s3))
  onCleanup(() => previewFrame?.destroy())
}
