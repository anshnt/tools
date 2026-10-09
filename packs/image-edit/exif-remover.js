// EXIF metadata remover (and viewer): shows camera, date and GPS (exifr), then strips JPEG, PNG and WebP metadata byte for byte, no re-encoding.
import { toggle, progress, table } from '../../lib/ui.js'
import {
  shell, h, icon, button, busy, section, note, tiles, batchSlot, results, runBatch, readSource, previewCanvas, encode, outName, clear, errorMessage,
  formatBytes,
} from './_kit.js'
import { stripJpeg, stripPng, stripWebp, sniff } from './_meta.js'

const EXIFR = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs'
let exifrP
const exifr = () => (exifrP ??= import(EXIFR).then((m) => m.default || m).catch((e) => { exifrP = null; throw Object.assign(new Error('Could not load the metadata reader. Check your connection and try again.'), { cause: e }) }))

const OPTS = { tiff: true, exif: true, gps: true, ifd1: false, interop: false, xmp: true, iptc: true, icc: false, jfif: true, translateKeys: true, translateValues: true, reviveValues: true, sanitize: true, mergeOutput: true }
const CAMERA = ['Make', 'Model', 'LensMake', 'LensModel', 'Software', 'HostComputer', 'BodySerialNumber', 'SerialNumber', 'CameraOwnerName']
const CAPTURE = ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat', 'Flash', 'ExposureProgram', 'MeteringMode', 'WhiteBalance']
const PERSON = ['Artist', 'Copyright', 'ImageDescription', 'UserComment', 'creator', 'rights', 'title', 'description', 'Byline', 'Caption', 'Credit', 'Keywords']
const SKIP = new Set(['ThumbnailOffset', 'ThumbnailLength', 'thumbnail', 'MakerNote', 'PrintIM', 'ComponentsConfiguration', 'ExifVersion', 'FlashpixVersion'])

const num = (v) => (v && typeof v === 'object' && !Array.isArray(v) && '0' in v && '1' in v ? (v[1] ? v[0] / v[1] : 0) : v)
const fmtVal = (v, k = '') => {
  v = num(v)
  if (k === 'ExposureTime' && typeof v === 'number') return v > 0 && v < 1 ? `1/${Math.round(1 / v)} s` : `${v} s`
  if (k === 'FNumber' && typeof v === 'number') return `f/${+v.toFixed(1)}`
  if ((k === 'FocalLength' || k === 'FocalLengthIn35mmFormat') && typeof v === 'number') return `${+v.toFixed(1)} mm`
  if (v instanceof Date) return Number.isNaN(+v) ? String(v) : v.toLocaleString()
  if (Array.isArray(v)) return v.length > 8 ? `${v.slice(0, 8).join(', ')} ...` : v.join(', ')
  if (v && typeof v === 'object') return v instanceof Uint8Array ? `${v.length} bytes` : JSON.stringify(v)
  return String(v)
}

/** Read metadata with exifr. Returns {raw, groups, gps, risks}. */
export async function readMeta(file) {
  const x = await exifr()
  let raw = null
  try { raw = await x.parse(file, OPTS) } catch { raw = null }
  raw = raw || {}
  const pick = (keys) => keys.filter((k) => raw[k] != null && raw[k] !== '').map((k) => [k, fmtVal(raw[k], k)])
  const gps = Number.isFinite(raw.latitude) && Number.isFinite(raw.longitude) ? { lat: raw.latitude, lon: raw.longitude, alt: raw.GPSAltitude } : null
  const camera = pick(CAMERA), capture = pick(CAPTURE), person = pick(PERSON)
  const risks = []
  if (gps) risks.push('exact location')
  if (camera.length) risks.push('device')
  if (capture.some(([k]) => /Date|Create/.test(k))) risks.push('date and time')
  if (person.length) risks.push('name or description')
  const shown = new Set([...CAMERA, ...CAPTURE, ...PERSON, 'latitude', 'longitude', ...SKIP])
  const other = Object.keys(raw).filter((k) => !shown.has(k) && raw[k] != null).map((k) => [k, fmtVal(raw[k], k)])
  return { raw, camera, capture, person, other, gps, risks, count: Object.keys(raw).length }
}

/** Strip one file. Returns {blob, name, removed, removedBytes, kind, note?}. */
export async function stripFile(file, { keepOrientation, keepIcc }) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniff(bytes)
  if (kind === 'jpeg') { const r = stripJpeg(bytes, { keepIcc, keepOrientation }); return { ...r, blob: new Blob([r.bytes], { type: 'image/jpeg' }), name: file.name, kind } }
  if (kind === 'png') { const r = stripPng(bytes, { keepIcc }); return { ...r, blob: new Blob([r.bytes], { type: 'image/png' }), name: file.name, kind } }
  if (kind === 'webp') { const r = stripWebp(bytes, { keepIcc }); return { ...r, blob: new Blob([r.bytes], { type: 'image/webp' }), name: file.name, kind } }
  if (kind === 'gif' || kind === 'bmp' || kind === 'ico') return { blob: file, name: file.name, removed: [], removedBytes: 0, kind, note: `${kind.toUpperCase()} files carry no photo metadata, left unchanged` }
  // HEIC, AVIF, TIFF and others: re-draw the pixels, which leaves every tag behind.
  const src = await readSource(file)
  const c = previewCanvas(src.img, 1e6)
  const blob = await encode(c, 'jpg', { quality: 0.95 })
  return { blob, name: outName(file.name, '', 'jpg'), removed: ['All metadata'], removedBytes: Math.max(0, file.size - blob.size), kind, note: `${(kind || 'image').toUpperCase()} was re-saved as JPG, which drops all tags` }
}

const mapLink = (g) => `https://www.openstreetmap.org/?mlat=${g.lat.toFixed(6)}&mlon=${g.lon.toFixed(6)}#map=16/${g.lat.toFixed(6)}/${g.lon.toFixed(6)}`

export function mount(root, { params, signal }) {
  const viewFirst = !!params.view
  const o = { keepOrientation: true, keepIcc: true }
  const host = h('div', { class: 'stack' })
  const metas = new Map()

  async function show(file) {
    if (!file) { clear(host); return }
    clear(host, h('div', { class: 'empty loading' }, h('span', { class: 'spinner' }), 'Reading metadata...'))
    try {
      let m = metas.get(file)
      if (!m) {
        m = await readMeta(file)
        metas.set(file, m)
      }
      render(file, m)
    } catch (e) { clear(host, h('div', { class: 'ie-note' }, errorMessage(e))) }
  }
  function group(title, ic, rows) {
    return rows.length ? h('div', { class: 'panel ie-glass' }, h('div', { class: 'ie-sec-title' }, icon(ic), h('span', title)), table({ columns: ['Tag', 'Value'], rows })) : null
  }
  function render(file, m) {
    const risky = m.risks.length > 0
    const loc = m.gps ? h('div', { class: 'panel ie-glass stack' },
      h('div', { class: 'ie-sec-title' }, icon('map-pin'), h('span', 'Where this was taken')),
      h('div', { class: 'ie-note' }, h('b', `${m.gps.lat.toFixed(5)}, ${m.gps.lon.toFixed(5)}`), m.gps.alt != null ? ` at ${Math.round(m.gps.alt)} m` : ''),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-secondary btn-sm', href: mapLink(m.gps), target: '_blank', rel: 'noopener noreferrer' }, icon('map'), h('span', 'Open in OpenStreetMap')),
        h('a', { class: 'btn btn-secondary btn-sm', href: `https://www.google.com/maps?q=${m.gps.lat.toFixed(6)},${m.gps.lon.toFixed(6)}`, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'Google Maps'))),
      h('div', { class: 'ie-note' }, 'Anyone who receives this file can see this place. Opening the map link sends the coordinates to that map service; nothing else leaves your device.')) : null
    clear(host,
      tiles([
        { label: 'Metadata tags', value: String(m.count), sub: m.count ? 'found in this file' : 'none found', good: !m.count, hot: !!m.count },
        { label: 'Location', value: m.gps ? 'Included' : 'None', sub: m.gps ? 'GPS coordinates are stored' : 'no GPS data', bad: !!m.gps, good: !m.gps },
        { label: 'Device', value: m.camera.find(([k]) => k === 'Model')?.[1] || (m.camera.length ? 'Included' : 'None'), sub: m.camera.find(([k]) => k === 'Make')?.[1] || '', bad: m.camera.length > 0, good: !m.camera.length },
        { label: 'Date taken', value: m.capture.find(([k]) => k === 'DateTimeOriginal' || k === 'CreateDate')?.[1] || 'None', bad: m.capture.some(([k]) => /DateTimeOriginal|CreateDate/.test(k)), good: !m.capture.length },
      ]),
      risky ? h('div', { class: 'alert warn' }, icon('triangle-alert'), h('div', h('strong', 'This file shares: '), m.risks.join(', '), '. Remove it before posting or sending.')) : h('div', { class: 'alert success' }, icon('circle-check'), h('div', 'No personal metadata found. You can still run the cleaner to be sure.')),
      loc, group('Camera and software', 'camera', m.camera), group('Capture settings', 'aperture', m.capture), group('Author and description', 'user', m.person),
      m.other.length ? h('details', { class: 'panel ie-glass' }, h('summary', { style: 'cursor:pointer;font-weight:600' }, `All other tags (${m.other.length})`), h('div', { style: 'margin-top:12px' }, table({ columns: ['Tag', 'Value'], rows: m.other }))) : null)
  }

  const prog = progress()
  const res = results({ zipName: 'metadata-removed.zip', compare: true, noun: 'photo' })
  const goBtn = button('Remove metadata', { icon: 'shield-off', variant: viewFirst ? 'secondary' : 'primary', size: 'lg', block: true })
  const slot = batchSlot({ ic: 'shield-off', onChange: (fs) => { goBtn.querySelector('span').textContent = fs.length > 1 ? `Clean ${fs.length} photos` : 'Remove metadata'; work.hidden = !fs.length; if (!fs.length) clear(host) }, onSelect: show })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return
    await runBatch(files, async (file) => {
      const r = await stripFile(file, o)
      let verdict = ''
      if (!r.note) {
        try {
          const after = await readMeta(new File([r.blob], r.name, { type: r.blob.type }))
          const left = Object.keys(after.raw).filter((k) => !(o.keepOrientation && k === 'Orientation'))
          verdict = after.gps || after.camera.length || after.person.length ? 'WARNING: some tags remain' : left.length ? `${left.length} basic tag(s) left` : 'verified clean'
        } catch { verdict = '' }
      }
      const saved = r.removedBytes
      return {
        name: r.name === file.name ? outName(file.name, 'clean', r.kind === 'jpeg' ? 'jpg' : r.kind) : r.name, blob: r.blob, inSize: file.size,
        badge: r.note ? 'No change' : saved ? `-${formatBytes(saved)}` : 'Clean', badgeKind: r.note ? '' : 'good',
        note: r.note || `${r.removed.join(', ') || 'nothing to remove'}${verdict ? `, ${verdict}` : ''}`,
      }
    }, { out: res, prog, signal, label: 'Cleaning' })
  }, { label: 'Cleaning', progress: prog }))

  const keepO = toggle('Keep the rotation so photos stay upright', true, (v) => { o.keepOrientation = v })
  const keepI = toggle('Keep the color profile', true, (v) => { o.keepIcc = v })
  const side = h('aside', { class: 'ie-side ie-glass' },
    section(viewFirst ? 'Want it gone?' : 'Clean-up', 'shield-off', keepO, keepI, note('JPG, PNG and WebP are cleaned by deleting the metadata blocks. The picture itself is not re-compressed, so quality is identical.')),
    section('Good to know', 'info', note('Messengers and social sites often strip metadata for you, but email, cloud links and many forums do not. Remove it yourself before sharing.')),
    h('div', { class: 'ie-foot' }, goBtn, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main' }, host), side)
  root.append(shell(slot.el, work, res.el))
}
