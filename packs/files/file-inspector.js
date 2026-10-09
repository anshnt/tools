// File inspector: drop any file and see what it really is. Name, size, MIME (browser + magic bytes), dates, hashes, and
// type-specific details (image EXIF, PDF metadata, audio/video duration, text encoding, ZIP contents). Nothing is uploaded.
import { h, icon, clear, dropzone, button, alert, formatBytes, formatDuration, formatNumber, input, table, progress, errorMessage, copyText, toast } from '../../lib/ui.js'
import { openPdf, pageSize, thumbnail } from '../../lib/pdf.js'
import {
  extOf, detectFile, extensionVerdict, hashBlob, HASH_LABEL, readRange, imageDimensions, readExif, exifr, entropy, analyzeText, decodeText, countLines,
  readZipEntries, extractEntry, fmtDateTime, hexBytes, hex, KINDS, kindOfName, METHOD_NAMES, SIGNATURE_COUNT, setHandoff, throwIfAborted,
} from './_core.js'
import { useFx, docGlyph, chip, chips, kv, card, hashRow, celebrate, tile } from './_ui.js'

const MEDIA_TIMEOUT = 7000
const gcd = (a, b) => (b ? gcd(b, a % b) : a)
const ASPECTS = [[1, 1], [4, 3], [3, 2], [16, 9], [16, 10], [21, 9], [5, 4], [2, 1], [3, 1]]
export function aspectLabel(w, hgt) {
  if (!w || !hgt) return ''
  const r = w / hgt
  for (const [a, b] of ASPECTS) {
    if (Math.abs(r - a / b) < 0.012) return `${a}:${b}`
    if (Math.abs(r - b / a) < 0.012) return `${b}:${a}`
  }
  const g = gcd(w, hgt)
  return g > 1 && w / g < 100 ? `${w / g}:${hgt / g}` : r.toFixed(2) + ':1'
}

/** Load audio/video metadata through a media element. Resolves {duration, width, height, frame (canvas|null)} or null. */
function probeMedia(file, tag) {
  return new Promise((resolve) => {
    const el = document.createElement(tag)
    const url = URL.createObjectURL(file)
    let settled = false
    const done = (v) => { if (settled) return; settled = true; clearTimeout(timer); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); resolve(v) }
    const timer = setTimeout(() => done(null), MEDIA_TIMEOUT)
    el.preload = 'metadata'
    el.muted = true
    el.onerror = () => done(null)
    el.onloadedmetadata = () => {
      const base = { duration: el.duration, width: el.videoWidth || 0, height: el.videoHeight || 0, frame: null }
      if (tag !== 'video' || !base.width) return done(base)
      el.onseeked = () => {
        try {
          const c = document.createElement('canvas')
          const s = Math.min(1, 480 / Math.max(base.width, base.height))
          c.width = Math.max(1, Math.round(base.width * s))
          c.height = Math.max(1, Math.round(base.height * s))
          c.getContext('2d').drawImage(el, 0, 0, c.width, c.height)
          base.frame = c
        } catch { /* tainted or undecodable: no poster */ }
        done(base)
      }
      try { el.currentTime = Number.isFinite(el.duration) ? Math.min(1, el.duration / 10) : 0 } catch { done(base) }
    }
    el.src = url
  })
}

const pdfDate = (s) => {
  const m = typeof s === 'string' && s.match(/^D:(\d{4})(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?/)
  return m ? fmtDateTime(new Date(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0)) : s || ''
}
const nice = (v) => {
  if (v == null) return ''
  if (v instanceof Date) return fmtDateTime(v, true)
  if (Array.isArray(v)) return v.length > 12 ? `[${v.length} values]` : v.map(nice).join(', ')
  if (v instanceof Uint8Array || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return `[${v.byteLength} bytes]`
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6))
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 160)
  return String(v)
}

const EXIF_FMT = {
  ExposureTime: (v) => (typeof v === 'number' ? (v >= 1 ? `${+v.toFixed(1)} s` : `1/${Math.round(1 / v)} s`) : v),
  FNumber: (v) => (typeof v === 'number' ? `f/${+v.toFixed(1)}` : v),
  FocalLength: (v) => (typeof v === 'number' ? `${+v.toFixed(1)} mm` : v),
  FocalLengthIn35mmFormat: (v) => (typeof v === 'number' ? `${v} mm` : v),
  ExposureBiasValue: (v) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${+v.toFixed(2)} EV` : v),
}
const fmtExif = (k, v) => (EXIF_FMT[k] ? String(EXIF_FMT[k](v)) : nice(v))

const EXIF_GROUPS = [
  ['Camera', ['Make', 'Model', 'LensModel', 'LensMake', 'Software', 'BodySerialNumber']],
  ['Exposure', ['DateTimeOriginal', 'CreateDate', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat', 'ExposureProgram', 'ExposureMode', 'MeteringMode', 'WhiteBalance', 'Flash', 'ExposureBiasValue']],
  ['Image', ['ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight', 'Orientation', 'ColorSpace', 'XResolution', 'YResolution', 'ResolutionUnit', 'BitDepth', 'ColorType']],
  ['Credits', ['Artist', 'Copyright', 'ImageDescription', 'UserComment', 'title', 'creator', 'rights', 'description']],
]

export function mount(root, { signal }) {
  useFx()
  const out = h('div', { class: 'stack' })
  let ctl = null
  let toRevoke = []
  const zone = dropzone({
    multiple: false, label: 'Drop any file here or click to choose', hint: `Any type. Checks ${SIGNATURE_COUNT}+ file signatures, hashes and metadata on this device.`,
    onFiles: ([f]) => inspect(f),
  })
  root.append(h('div', { class: 'stack fx' }, zone, out))
  signal.addEventListener('abort', () => { ctl?.abort(); toRevoke.forEach((u) => URL.revokeObjectURL(u)) })

  async function inspect(file) {
    ctl?.abort()
    toRevoke.forEach((u) => URL.revokeObjectURL(u))
    toRevoke = []
    const run = (ctl = new AbortController())
    const url = () => { const u = URL.createObjectURL(file); toRevoke.push(u); return u }
    zone.classList.add('compact')
    clear(out)
    const ext = extOf(file.name)
    let det = null
    try { det = await detectFile(file) } catch (e) { console.warn(e) }
    if (run.signal.aborted) return
    const kindKey = det?.kind && det.kind !== 'other' ? det.kind : kindOfName(file.name)
    const kind = KINDS[kindKey] || KINDS.other
    const verdict = extensionVerdict(det, file.name)
    const thumb = h('div', { class: 'fx-thumb', hidden: true })

    // ----- Hero -----
    const summary = () => {
      const lines = [`File: ${file.name}`, `Size: ${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`, `Type: ${det ? `${det.label} (${det.mime})` : file.type || 'unknown'}`, `Modified: ${fmtDateTime(file.lastModified, true)}`]
      for (const [k, r] of Object.entries(rows)) if (r.value()) lines.push(`${HASH_LABEL[k]}: ${r.value()}`)
      return lines.join('\n')
    }
    const hero = h('div', { class: 'fx-hero fx-in', style: { '--k': kind.color } },
      docGlyph(file.name, kindKey),
      h('div', { class: 'fx-body' },
        h('div', { class: 'fx-title' }, file.name),
        h('div', { class: 'fx-sub' }, `${formatBytes(file.size)} · ${det ? det.label : file.type || 'Unknown type'}`),
        chips(
          chip(kind.label.replace(/s$/, ''), 'accent', kind.icon),
          det && chip(det.mime, '', 'fingerprint'),
          verdict.ok ? (det?.sure !== false && det && chip('Extension matches contents', 'ok', 'circle-check')) : chip('Extension does not match', 'warn', 'triangle-alert'),
        ),
        h('div', { class: 'row' },
          button('Copy summary', { icon: 'clipboard-copy', size: 'sm', onClick: () => copyText(summary()) }),
          button('Open in hex viewer', { icon: 'binary', size: 'sm', variant: 'ghost', onClick: () => { setHandoff(file); location.hash = '#/hex-viewer' } }))),
      thumb)
    out.append(hero)
    if (!verdict.ok && det) {
      const want = det.exts[0] || det.ext
      out.append(alert('warn', h('strong', 'The name and the contents disagree. '),
        `This file is named .${ext}, but its bytes say ${det.label}${want ? ` (normally .${want})` : ''}. Apps may refuse to open it, or it may not be what it claims. Check where it came from before opening it.`))
    }
    const setThumb = (node) => { if (run.signal.aborted) return; clear(thumb, node); thumb.hidden = false }

    // ----- Cards -----
    const rows = { md5: hashRow('MD5'), sha1: hashRow('SHA-1'), sha256: hashRow('SHA-256') }
    const prog = progress('Hashing')
    const verify = input({ placeholder: 'Paste an expected MD5, SHA-1 or SHA-256 to check it', 'aria-label': 'Expected checksum', mono: true, spellcheck: false, autocomplete: 'off' })
    const verdictEl = h('div', { class: 'small', 'aria-live': 'polite' })
    const checkVerify = () => {
      const want = verify.value.trim().split(/\s+/)[0]?.toLowerCase().replace(/^\*/, '') || ''
      for (const r of Object.values(rows)) r.classList.remove('match')
      if (!want) return clear(verdictEl)
      const hit = Object.entries(rows).find(([, r]) => r.value() && r.value() === want)
      if (hit) {
        rows[hit[0]].classList.add('match')
        clear(verdictEl, chip(`Matches ${HASH_LABEL[hit[0]]}. This is the file you expected.`, 'ok', 'circle-check'))
        celebrate(verdictEl, 12)
      } else if (![32, 40, 64].includes(want.length) || /[^0-9a-f]/.test(want)) {
        clear(verdictEl, chip('That does not look like an MD5, SHA-1 or SHA-256 value.', 'warn', 'circle-help'))
      } else if (!Object.values(rows).every((r) => r.value())) {
        clear(verdictEl, chip('Still hashing, one moment...', '', 'loader'))
      } else clear(verdictEl, chip('No match. The file differs from what you expected.', 'bad', 'circle-x'))
    }
    verify.addEventListener('input', checkVerify)

    const basics = card('Basics', 'info', kind.color, kv([
      ['Name', file.name],
      ['Extension', ext ? `.${ext}` : 'none'],
      ['Size', `${formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`],
      ['Type (browser)', file.type || 'not reported'],
      ['Type (by bytes)', det ? `${det.label} - ${det.mime}${det.detail ? ` - ${det.detail}` : ''}` : 'Not a known format (generic binary)'],
      ['Modified', fmtDateTime(file.lastModified, true)],
      ['Kind', kind.label.replace(/s$/, '')],
    ]))
    const fingerprints = card('Fingerprints', 'fingerprint', '#6e56cf',
      h('div', { class: 'stack tight' }, Object.values(rows), prog.el, h('div', { class: 'stack tight', style: 'margin-top:6px' }, verify, verdictEl)))
    const bento = h('div', { class: 'fx-bento' }, basics, fingerprints)
    out.append(bento)
    ;[basics, fingerprints].forEach((c, i) => c.style.setProperty('--i', i + 1))

    // ----- Hashes (streaming) -----
    prog.set(0, 'Hashing')
    hashBlob(file, ['md5', 'sha1', 'sha256'], { signal: run.signal, onProgress: (f) => prog.set(f, `Hashing ${Math.round(f * 100)}%`) })
      .then((r) => { for (const [k, v] of Object.entries(r)) rows[k].setValue(v); prog.hide(); checkVerify() })
      .catch((e) => { prog.hide(); if (e?.code !== 'ABORT') for (const r of Object.values(rows)) r.setValue(`Failed: ${errorMessage(e)}`) })

    // ----- Type specific -----
    const head = await readRange(file, 0, 1 << 20)
    if (run.signal.aborted) return
    const lazy = (title, ic, color, build, wide) => {
      const body = h('div', { class: 'stack tight' }, h('div', { class: 'fx-skel' }), h('div', { class: 'fx-skel', style: 'width:72%' }), h('div', { class: 'fx-skel', style: 'width:48%' }))
      const el = card(title, ic, color, body)
      if (wide) el.classList.add('fx-wide')
      el.style.setProperty('--i', bento.children.length + 1)
      bento.append(el)
      Promise.resolve().then(build).then((node) => { if (run.signal.aborted) return; if (node) clear(body, node); else el.remove() })
        .catch((e) => { if (e?.code === 'ABORT' || run.signal.aborted) return; clear(body, h('div', { class: 'small muted' }, errorMessage(e))) })
      return el
    }
    const mime = det?.mime || file.type || ''
    const isImage = kindKey === 'image' || mime.startsWith('image/')
    const isPdf = mime === 'application/pdf'
    const isAudio = kindKey === 'audio' || mime.startsWith('audio/')
    const isVideo = kindKey === 'video' || mime.startsWith('video/')
    const textInfo = analyzeText(head.subarray(0, 8192))

    if (isImage) {
      const exifP = readExif(file).catch(() => null)
      lazy('Image', 'image', '#d6409f', async () => {
        let dim = imageDimensions(head.subarray(0, 262144))
        const exif = await exifP
        if (!dim && exif) {
          const w = exif.ExifImageWidth || exif.ImageWidth, hh = exif.ExifImageHeight || exif.ImageHeight
          if (w && hh) dim = { w, h: hh, note: det?.label }
        }
        const canShow = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml|avif|x-icon)$/.test(mime)
        if (canShow) {
          const img = h('img', { alt: `Preview of ${file.name}`, src: url(), decoding: 'async' })
          setThumb(img)
          if (!dim) { try { await img.decode(); dim = { w: img.naturalWidth, h: img.naturalHeight } } catch { /* ignore */ } }
        } else {
          try { const t = await (await exifr()).thumbnailUrl(file); if (t) { toRevoke.push(t); setThumb(h('img', { src: t, alt: 'Embedded thumbnail' })) } } catch { /* no thumbnail */ }
        }
        const rowsOut = []
        if (dim) {
          const mp = (dim.w * dim.h) / 1e6
          rowsOut.push(['Dimensions', `${dim.w.toLocaleString()} x ${dim.h.toLocaleString()} px`], ['Megapixels', `${mp.toFixed(mp < 10 ? 2 : 1)} MP`], ['Aspect ratio', aspectLabel(dim.w, dim.h)])
          rowsOut.push(['Print size at 300 dpi', `${(dim.w / 300 * 2.54).toFixed(1)} x ${(dim.h / 300 * 2.54).toFixed(1)} cm (${(dim.w / 300).toFixed(1)} x ${(dim.h / 300).toFixed(1)} in)`])
          rowsOut.push(['Bytes per pixel', (file.size / (dim.w * dim.h)).toFixed(2)])
        }
        if (exif?.Orientation) rowsOut.push(['Orientation', nice(exif.Orientation)])
        if (exif?.XResolution > 1) rowsOut.push(['Resolution', `${nice(exif.XResolution)} x ${nice(exif.YResolution ?? exif.XResolution)} ${nice(exif.ResolutionUnit || 'dpi')}`])
        return rowsOut.length ? kv(rowsOut) : h('div', { class: 'small muted' }, 'The browser could not read this image (the format may need a desktop app).')
      })
      lazy('Photo metadata', 'camera', '#f76b15', async () => {
        const exif = await exifP
        if (!exif) return h('div', { class: 'small muted' }, 'No EXIF, GPS or XMP metadata found. That is common for screenshots, web images and anything that was exported with metadata removed.')
        const frag = h('div', { class: 'stack' })
        const lat = exif.latitude, lon = exif.longitude
        if (typeof lat === 'number' && typeof lon === 'number') {
          frag.append(alert('warn', h('strong', 'This photo records where it was taken. '), `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
            h('div', { class: 'row', style: 'margin-top:8px' },
              h('a', { class: 'btn btn-secondary btn-sm', href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`, target: '_blank', rel: 'noopener noreferrer' }, icon('map-pin'), h('span', 'View on map')),
              h('a', { class: 'btn btn-ghost btn-sm', href: '#/exif-remover' }, icon('eraser'), h('span', 'Remove metadata')))))
        }
        const used = new Set(['latitude', 'longitude'])
        for (const [title, keys] of EXIF_GROUPS) {
          const r = keys.filter((k) => exif[k] != null && exif[k] !== '').map((k) => { used.add(k); return [k.replace(/([a-z])([A-Z])/g, '$1 $2'), fmtExif(k, exif[k])] })
          if (r.length) frag.append(h('div', h('div', { class: 'small muted', style: 'margin-bottom:2px;font-weight:600' }, title), kv(r)))
        }
        const rest = Object.entries(exif).filter(([k]) => !used.has(k)).map(([k, v]) => [k, nice(v)]).filter(([, v]) => v !== '')
        if (rest.length) {
          const filter = input({ placeholder: `Filter ${rest.length} more tags`, 'aria-label': 'Filter metadata tags' })
          const tbl = h('div')
          const draw = () => { const q = filter.value.trim().toLowerCase(); clear(tbl, table({ columns: ['Tag', 'Value'], rows: rest.filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.toLowerCase().includes(q)).map(([k, v]) => [k, h('span', { class: 'fx-mono' }, v)]), max: 300 })) }
          filter.addEventListener('input', draw)
          draw()
          frag.append(h('details', h('summary', { style: 'cursor:pointer;font-weight:600;font-size:13.5px;padding:4px 0' }, `All other tags (${rest.length})`), h('div', { class: 'stack tight', style: 'margin-top:8px' }, filter, tbl)))
        }
        return frag
      }, true)
    }

    if (isPdf) {
      lazy('PDF', 'file-text', '#e5484d', async () => {
        const version = new TextDecoder().decode(head.subarray(0, 12)).match(/%PDF-(\d\.\d)/)?.[1]
        let doc
        try { doc = await openPdf(file) } catch (e) {
          if (e.code === 'PASSWORD') return kv([['Status', 'Password-protected. Open it in a PDF app, or use the PDF unlock tools, to see its pages.'], ['PDF version', version]])
          throw e
        }
        const meta = await doc.getMetadata().catch(() => null)
        const info = meta?.info || {}
        const sz = await pageSize(doc, 1)
        const mm = (pt) => (pt / 72 * 25.4).toFixed(0)
        try { setThumb(await thumbnail(doc, 1, 300)) } catch { /* skip */ }
        const names = [['A4', 595.28, 841.89], ['Letter', 612, 792], ['Legal', 612, 1008], ['A3', 841.89, 1190.55], ['A5', 419.53, 595.28]]
        const std = names.find(([, w, hh]) => (Math.abs(sz.width - w) < 3 && Math.abs(sz.height - hh) < 3) || (Math.abs(sz.width - hh) < 3 && Math.abs(sz.height - w) < 3))?.[0]
        return kv([
          ['Pages', doc.numPages.toLocaleString()],
          ['Page size', `${mm(sz.width)} x ${mm(sz.height)} mm (${Math.round(sz.width)} x ${Math.round(sz.height)} pt)${std ? ` - ${std}` : ''}`],
          ['PDF version', version],
          ['Title', info.Title], ['Author', info.Author], ['Subject', info.Subject], ['Keywords', info.Keywords],
          ['Created with', info.Creator], ['PDF producer', info.Producer],
          ['Created', pdfDate(info.CreationDate)], ['Modified', pdfDate(info.ModDate)],
          ['Form fields', info.IsAcroFormPresent ? 'Yes (fillable form)' : ''], ['Tagged (accessible)', info.IsTagged === true || info.Marked ? 'Yes' : ''],
        ])
      })
    }

    if (isAudio || isVideo) {
      lazy(isVideo ? 'Video' : 'Audio', isVideo ? 'clapperboard' : 'music', isVideo ? '#8e4ec6' : '#f76b15', async () => {
        const m = await probeMedia(file, isVideo ? 'video' : 'audio')
        if (!m) return h('div', { class: 'small muted' }, 'Your browser could not read this media (the codec may not be supported here). Size, type and hashes are still correct.')
        if (m.frame) setThumb(m.frame)
        const kbps = Number.isFinite(m.duration) && m.duration > 0 ? Math.round((file.size * 8) / m.duration / 1000) : null
        return kv([
          ['Duration', Number.isFinite(m.duration) ? `${formatDuration(m.duration)} (${m.duration.toFixed(2)} s)` : 'unknown (a live or streamed file)'],
          m.width ? ['Resolution', `${m.width} x ${m.height} px (${aspectLabel(m.width, m.height)})`] : null,
          kbps ? ['Average bitrate', `${kbps.toLocaleString()} kbps`] : null,
          ['Container', det?.label],
        ].filter(Boolean))
      })
    }

    if (det?.zip || det?.kind === 'archive' && /zip|docx|xlsx|pptx|jar|apk/.test(det.ext)) {
      lazy('Archive contents', 'file-archive', '#d99a1e', async () => {
        const entries = det.entries || await readZipEntries(file)
        const files = entries.filter((e) => !e.dir)
        const total = files.reduce((s, e) => s + e.size, 0)
        const packed = files.reduce((s, e) => s + e.csize, 0)
        const enc = files.filter((e) => e.encrypted).length
        const frag = h('div', { class: 'stack' })
        frag.append(kv([
          ['Entries', `${files.length.toLocaleString()} files, ${entries.length - files.length} folders`],
          ['Uncompressed', formatBytes(total)], ['Compressed', `${formatBytes(packed)}${total ? ` (${Math.round((1 - packed / total) * 100)}% smaller)` : ''}`],
          enc ? ['Encrypted', `${enc} entries are password-protected`] : null,
        ].filter(Boolean)))
        // Office documents: author, dates, application
        const core = entries.find((e) => e.name === 'docProps/core.xml')
        if (core && !core.encrypted) {
          const parse = async (e) => new DOMParser().parseFromString(await (await extractEntry(file, e)).text(), 'application/xml')
          const dom = await parse(core).catch(() => null)
          const app = entries.find((e) => e.name === 'docProps/app.xml')
          const adom = app ? await parse(app).catch(() => null) : null
          const get = (d, tag) => d?.getElementsByTagName(tag)[0]?.textContent || ''
          const props = [['Title', get(dom, 'dc:title')], ['Author', get(dom, 'dc:creator')], ['Last saved by', get(dom, 'cp:lastModifiedBy')], ['Created', get(dom, 'dcterms:created').replace('T', ' ').replace('Z', '')],
            ['Modified', get(dom, 'dcterms:modified').replace('T', ' ').replace('Z', '')], ['Application', get(adom, 'Application')], ['Pages', get(adom, 'Pages')], ['Words', get(adom, 'Words')], ['Company', get(adom, 'Company')]]
          if (props.some(([, v]) => v)) frag.append(h('div', h('div', { class: 'small muted', style: 'margin-bottom:2px;font-weight:600' }, 'Document properties'), kv(props)))
        }
        frag.append(table({
          columns: ['Name', { label: 'Size', num: true }, { label: 'Packed', num: true }, 'Method'],
          rows: entries.slice(0, 400).map((e) => [e.encrypted ? h('span', { title: 'Password-protected' }, '🔒 ' + e.name) : e.name, e.dir ? '' : formatBytes(e.size), e.dir ? '' : formatBytes(e.csize), e.dir ? 'Folder' : METHOD_NAMES[e.method] || `Method ${e.method}`]), max: 400,
        }))
        return frag
      }, true)
    }

    if (textInfo.text && !isImage && !isPdf && !isAudio && !isVideo && !det?.zip && file.size <= 512 << 20 && (det?.text || !det)) {
      lazy('Text', 'file-text', '#6b7bb3', async () => {
        const wide = textInfo.encoding.includes('UTF-16') || textInfo.encoding.includes('UTF-32')
        const lc = wide ? null : await countLines(file, { signal: run.signal })
        const preview = decodeText(head.subarray(0, 2048)).replace(/\0/g, '').split(/\r\n|\r|\n/).slice(0, 14).join('\n')
        return h('div', { class: 'stack' },
          kv([['Encoding', textInfo.encoding + (textInfo.bom ? ' with BOM' : '')], lc ? ['Lines', lc.lines.toLocaleString()] : null, lc ? ['Line endings', lc.style] : null].filter(Boolean)),
          h('pre', { class: 'code-out', style: 'max-height:260px' }, preview + (file.size > 2048 ? '\n...' : '')))
      }, true)
    }

    // Entropy and hex preview apply to everything
    lazy('First bytes', 'binary', '#6f6e77', () => {
      const b = head.subarray(0, 256)
      const rowsHex = []
      for (let i = 0; i < b.length; i += 16) {
        const s = b.subarray(i, i + 16)
        rowsHex.push(`${hex(i, 6)}  ${hexBytes(s).padEnd(47)}  ${[...s].map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '.')).join('')}`)
      }
      const ent = entropy(head)
      const entLabel = ent > 7.6 ? 'very high: compressed or encrypted' : ent > 6.5 ? 'high: packed or binary data' : ent > 4.2 ? 'medium: typical documents and code' : 'low: repetitive or plain text'
      return h('div', { class: 'stack' },
        kv([['Entropy', `${ent.toFixed(2)} bits per byte (${entLabel})`]]),
        h('pre', { class: 'code-out', style: 'max-height:300px' }, rowsHex.join('\n')),
        h('div', { class: 'small muted' }, 'Magic bytes are the first few bytes of a file. Many formats start with a fixed signature, which is how the type above is detected.'))
    }, true)
  }

  return () => { ctl?.abort(); toRevoke.forEach((u) => URL.revokeObjectURL(u)) }
}
