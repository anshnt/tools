// PDF info viewer: version, pages, encryption and permissions, fonts, metadata, forms, attachments, bookmarks, signatures and page sizes
// in a bento layout. Everything is read on this device with pdf.js and pdf-lib.
import { h, icon, clear, formatBytes, progress, copyButton, downloadButton } from '../../lib/ui.js'
import { pdfLib } from '../../lib/libs.js'
import { pdfSource, ppRoot, useStyle, readOutline, toMm, round, compressRanges, countUp } from './_shared.js'
import { groupSizes } from './pdf-page-size.js'

/** PDF date string D:YYYYMMDDHHmmSSOHH'mm' -> Date or null. */
export function parsePdfDate(s) {
  const m = String(s || '').match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/)
  if (!m) return null
  const [, y, mo = '01', d = '01', hh = '00', mi = '00', ss = '00', tz = 'Z'] = m
  let off = 'Z'
  if (tz !== 'Z') { const t = tz.replace(/'/g, ''); off = `${t.slice(0, 3)}:${t.slice(3, 5) || '00'}` }
  const dt = new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}${off}`)
  return Number.isNaN(dt.getTime()) ? null : dt
}

/** Decode the /P permission bits of an encrypted PDF. */
export function permissionsOf(p) {
  const bits = [[2, 'Print'], [3, 'Edit content'], [4, 'Copy text'], [5, 'Add comments'], [8, 'Fill forms'], [9, 'Screen readers'], [10, 'Assemble pages'], [11, 'Print in high quality']]
  return bits.map(([b, label]) => ({ label, allowed: !!(p & (1 << b)) }))
}

function countMarker(bytes, marker) {
  const m = [...marker].map((c) => c.charCodeAt(0))
  let n = 0
  for (let i = 0; i <= bytes.length - m.length; i++) {
    if (bytes[i] !== m[0]) continue
    let ok = true
    for (let j = 1; j < m.length; j++) if (bytes[i + j] !== m[j]) { ok = false; break }
    if (ok) { n++; i += m.length - 1 }
  }
  return n
}

const fmtDate = (d) => d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

async function gather(s, onStep) {
  const lib = await pdfLib()
  const { PDFName, PDFDict, PDFArray, PDFStream, PDFRef, PDFNumber, PDFBool, PDFString, PDFHexString } = lib
  const out = {}
  const bytes = s.bytes
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1100))
  out.header = head.match(/%PDF-(\d\.\d)/)?.[1] || null
  out.linearized = /\/Linearized\b/.test(head)
  out.updates = countMarker(bytes, '%%EOF')
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 12000)))
  const hasEncrypt = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(head + tail)
  onStep?.('Reading structure')
  const doc = await s.inspect()
  const ctx = doc.context
  const N = (n) => PDFName.of(n)
  const lk = (d, k) => { try { return d.lookup(N(k)) } catch { return undefined } }
  const nameOf = (v) => (v instanceof PDFName ? v.asString().replace(/^\//, '') : null)
  const text = (v) => (v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null)
  const cat = doc.catalog
  out.catalogVersion = nameOf(lk(cat, 'Version'))
  out.lang = text(lk(cat, 'Lang'))
  out.pageLayout = nameOf(lk(cat, 'PageLayout'))
  out.pageMode = nameOf(lk(cat, 'PageMode'))
  const mark = lk(cat, 'MarkInfo')
  out.tagged = mark instanceof PDFDict && lk(mark, 'Marked') instanceof PDFBool && lk(mark, 'Marked').asBoolean()
  out.hasStructTree = !!lk(cat, 'StructTreeRoot')
  out.pages = doc.getPageCount()
  out.objects = ctx.enumerateIndirectObjects().length
  out.objStreams = ctx.enumerateIndirectObjects().some(([, o]) => o instanceof PDFStream && nameOf(lk(o.dict, 'Type')) === 'ObjStm')
  // encryption
  out.encrypted = hasEncrypt || !!doc.isEncrypted
  out.userPassword = !!s.password
  if (out.encrypted) {
    // the working copy is already decrypted, so read the encryption dictionary from a copy loaded as-is
    let enc = null
    try { const raw = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); enc = raw.context.lookup(raw.context.trailerInfo.Encrypt) } catch { /* keep going without details */ }
    if (enc instanceof PDFDict) {
      const v = lk(enc, 'V'), r = lk(enc, 'R'), len = lk(enc, 'Length'), p = lk(enc, 'P')
      let method = null
      const cf = lk(enc, 'CF')
      if (cf instanceof PDFDict) { const std = lk(cf, 'StdCF'); if (std instanceof PDFDict) method = nameOf(lk(std, 'CFM')) }
      out.encryption = { version: v instanceof PDFNumber ? v.asNumber() : null, revision: r instanceof PDFNumber ? r.asNumber() : null, bits: len instanceof PDFNumber ? len.asNumber() : (method === 'AESV3' ? 256 : method === 'AESV2' ? 128 : null), method, perms: p instanceof PDFNumber ? permissionsOf(p.asNumber()) : null }
    }
  }
  // fonts
  onStep?.('Listing fonts')
  const fonts = new Map()
  const fontInfo = (d) => {
    const sub = nameOf(lk(d, 'Subtype'))
    let base = nameOf(lk(d, 'BaseFont')) || 'Unnamed'
    let desc = lk(d, 'FontDescriptor')
    if (sub === 'Type0') {
      const df = lk(d, 'DescendantFonts')
      const first = df instanceof PDFArray ? ctx.lookup(df.get(0)) : null
      if (first instanceof PDFDict) { desc = lk(first, 'FontDescriptor'); return { base, kind: `Type 0 (${nameOf(lk(first, 'Subtype')) || 'CID'})`, desc } }
    }
    return { base, kind: sub || 'Font', desc }
  }
  for (const [, o] of ctx.enumerateIndirectObjects()) {
    if (!(o instanceof PDFDict) || nameOf(lk(o, 'Type')) !== 'Font') continue
    const sub = nameOf(lk(o, 'Subtype'))
    if (sub === 'CIDFontType0' || sub === 'CIDFontType2') continue
    const { base, kind, desc } = fontInfo(o)
    const embedded = desc instanceof PDFDict && (!!desc.get(N('FontFile')) || !!desc.get(N('FontFile2')) || !!desc.get(N('FontFile3')))
    const clean = base.replace(/^[A-Z]{6}\+/, '')
    if (!fonts.has(clean)) fonts.set(clean, { name: clean, kind, embedded, subset: /^[A-Z]{6}\+/.test(base) })
    else if (embedded) fonts.get(clean).embedded = true
  }
  out.fonts = [...fonts.values()].sort((a, b) => a.name.localeCompare(b.name))
  // forms
  onStep?.('Checking forms')
  out.form = null
  try {
    const af = lk(cat, 'AcroForm')
    if (af instanceof PDFDict) {
      const form = doc.getForm()
      const fields = form.getFields()
      const types = {}
      const kinds = [[lib.PDFTextField, 'text field'], [lib.PDFCheckBox, 'checkbox'], [lib.PDFRadioGroup, 'radio group'], [lib.PDFDropdown, 'dropdown'], [lib.PDFOptionList, 'list'], [lib.PDFButton, 'button'], [lib.PDFSignature, 'signature']]
      for (const f of fields) { const t = kinds.find(([C]) => f instanceof C)?.[1] || 'field'; types[t] = (types[t] || 0) + 1 }
      out.form = { count: fields.length, types, xfa: !!lk(af, 'XFA'), signed: (lk(af, 'SigFlags') instanceof PDFNumber ? lk(af, 'SigFlags').asNumber() & 1 : 0) === 1 }
    }
  } catch { out.form = { count: 0, types: {}, error: true } }
  // pdf.js bits
  onStep?.('Reading metadata')
  const pjs = s.doc
  try { const md = await pjs.getMetadata(); out.info = md.info || {} } catch { out.info = {} }
  try { const att = await pjs.getAttachments(); out.attachments = att ? Object.values(att).map((a) => ({ name: a.filename, size: a.content?.length ?? null })) : [] } catch { out.attachments = [] }
  try { out.hasJS = await pjs.hasJSActions() } catch { out.hasJS = false }
  try { const lbl = await pjs.getPageLabels(); out.pageLabels = lbl ? lbl.filter((x, i) => lbl.indexOf(x) === i).length : 0 } catch { out.pageLabels = 0 }
  try { const oc = await pjs.getOptionalContentConfig(); out.layers = [...oc].length } catch { out.layers = 0 }
  try { const ol = await readOutline(pjs); const count = (a) => a.reduce((n, x) => n + 1 + count(x.items || []), 0); out.bookmarks = ol ? { top: ol.length, total: count(ol) } : null } catch { out.bookmarks = null }
  await s.pageSizes()
  out.sizes = groupSizes(Array.from({ length: s.pages }, (_, i) => s.sizeOf(i + 1)), 2)
  return out
}

const row = (k, v, cls) => [h('dt', k), h('dd', { class: cls }, v ?? h('span', { class: 'muted' }, 'Not set'))]
const chip = (t, kind = 'plain') => h('span', { class: ['pp-chip', kind] }, t)

export function mount(root, { signal }) {
  const body = h('div', { class: 'stack' })
  let s
  let gen = 0
  const src = pdfSource({ onLoad: (source) => { s = source; return run(source) }, onClear: () => { s = null; gen++; clear(body) } })

  async function run(source) {
    const my = ++gen
    const prog = progress()
    clear(body, h('div', { class: 'row' }, h('span', { class: 'spinner' }), h('strong', 'Reading the file...')), prog.el)
    const r = await gather(source, (t) => prog.set(null, t))
    if (my !== gen || source.dead || signal.aborted) return
    show(r, source)
  }

  function show(r, source) {
    const dates = { created: parsePdfDate(r.info.CreationDate), modified: parsePdfDate(r.info.ModDate) }
    const version = r.catalogVersion && parseFloat(r.catalogVersion) > parseFloat(r.header || 0) ? r.catalogVersion : r.header
    const cards = []
    const card = (cls, iconName, title, ...kids) => cards.push(h('section', { class: ['pp-bento-card', cls, 'pp-in'], style: { '--i': cards.length } }, h('h3', icon(iconName), title), kids))

    // overview hero
    const big = h('div', { class: 'pp-info-hero-n' }, h('b', { 'data-n': r.pages }, '0'), h('span', r.pages === 1 ? 'page' : 'pages'))
    countUp(big.firstChild, r.pages, { ms: 700 })
    cards.push(h('section', { class: 'pp-bento-card pp-span-5 pp-hero pp-in', style: { '--i': 0 } },
      h('div', { class: 'pp-info-hero-top' }, h('span', { class: 'pp-chip' }, version ? `PDF ${version}` : 'PDF'), r.encrypted ? chip('Encrypted', 'warn') : chip('Not encrypted', 'ok')),
      big,
      h('div', { class: 'pp-info-hero-name', title: source.name }, source.name),
      h('div', { class: 'pp-file-sub' }, chip(formatBytes(source.size), 'plain'), chip(`${r.objects.toLocaleString()} objects`, 'plain'), r.linearized ? chip('Fast web view', 'ok') : null, r.tagged ? chip('Tagged (accessible)', 'ok') : null)))

    card('pp-span-7', 'tags', 'Document properties', h('dl', { class: 'pp-kv' },
      ...row('Title', r.info.Title), ...row('Author', r.info.Author), ...row('Subject', r.info.Subject), ...row('Keywords', r.info.Keywords),
      ...row('Created with', r.info.Creator), ...row('PDF producer', r.info.Producer),
      ...row('Created', dates.created ? fmtDate(dates.created) : null), ...row('Modified', dates.modified ? fmtDate(dates.modified) : null),
      ...(r.lang ? row('Language', r.lang) : [])))

    const enc = r.encryption
    card('pp-span-5', r.encrypted ? 'lock' : 'lock-open', 'Security',
      r.encrypted
        ? [h('dl', { class: 'pp-kv' }, ...row('Algorithm', enc ? `${enc.method === 'AESV3' ? 'AES' : enc.method === 'AESV2' ? 'AES' : enc.method === 'V2' ? 'RC4' : 'Standard'} ${enc.bits ? enc.bits + '-bit' : ''}`.trim() : 'Standard'), ...row('Opened with', r.userPassword ? 'Password you entered' : 'No password needed (owner restrictions only)')),
          enc?.perms ? h('div', { class: 'pp-perms' }, enc.perms.map((p) => h('span', { class: ['pp-perm', p.allowed ? 'yes' : 'no'] }, icon(p.allowed ? 'check' : 'x'), p.label))) : null]
        : h('p', { class: 'small muted' }, 'Anyone can open, copy and print this file. No password or restrictions.'),
      r.hasJS ? h('div', { class: 'pp-kv-note' }, chip('Contains JavaScript', 'warn')) : null,
      r.form?.signed ? h('div', { class: 'pp-kv-note' }, chip('Has digital signatures', 'ok')) : null)

    card('pp-span-7', 'layout-grid', 'Pages',
      h('dl', { class: 'pp-kv' }, ...row('Page count', String(r.pages)), ...row('Page labels', r.pageLabels ? `${r.pageLabels} custom label styles` : 'Plain numbers'), ...row('Opens at', [r.pageMode && r.pageMode !== 'UseNone' ? r.pageMode : null, r.pageLayout].filter(Boolean).join(', ') || 'Page only')),
      h('div', { class: 'pp-sizechips' }, r.sizes.map((g) => h('div', { class: 'pp-sizechip' }, h('b', g.name === 'Custom' ? `${round(toMm(Math.min(g.w, g.h)), 0)} x ${round(toMm(Math.max(g.w, g.h)), 0)} mm` : g.name), h('span', `${g.orient}, ${g.pages.length === 1 ? 'page' : 'pages'} ${compressRanges(g.pages).slice(0, 28)}`)))))

    card('pp-span-6', 'book-marked', 'Structure',
      h('dl', { class: 'pp-kv' },
        ...row('Bookmarks', r.bookmarks ? `${r.bookmarks.total} (${r.bookmarks.top} top level)` : 'None'),
        ...row('Layers', r.layers ? `${r.layers} optional content layers` : 'None'),
        ...row('Saved', r.updates > 1 ? `${r.updates} times (has incremental updates)` : 'Once, no update history'),
        ...row('Compression', r.objStreams ? 'Object streams (PDF 1.5+)' : 'Classic objects')))

    card('pp-span-6', 'text-cursor-input', 'Forms and attachments',
      h('dl', { class: 'pp-kv' },
        ...row('Form fields', r.form ? (r.form.count ? `${r.form.count} (${Object.entries(r.form.types).map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`).join(', ')})` : 'A form with no fields') : 'None'),
        ...row('XFA form', r.form?.xfa ? 'Yes (Adobe-only dynamic form)' : 'No'),
        ...row('Attachments', r.attachments.length ? '' : 'None')),
      r.attachments.length ? h('ul', { class: 'pp-attach' }, r.attachments.map((a) => h('li', icon('paperclip'), h('span', a.name), a.size != null ? h('small', formatBytes(a.size)) : null))) : null)

    card('pp-span-12', 'type', `Fonts (${r.fonts.length})`,
      r.fonts.length ? h('div', { class: 'pp-fontgrid' }, r.fonts.map((f) => h('div', { class: 'pp-font' }, h('b', f.name), h('span', f.kind), chip(f.embedded ? (f.subset ? 'Embedded subset' : 'Embedded') : 'Not embedded', f.embedded ? 'ok' : 'warn')))) : h('p', { class: 'small muted' }, 'No fonts. This PDF has no text, or the text was drawn as shapes.'))

    const text = () => [
      `File: ${source.name} (${formatBytes(source.size)})`, `PDF version: ${version || 'unknown'}`, `Pages: ${r.pages}`, `Encrypted: ${r.encrypted ? 'yes' : 'no'}`, `Tagged: ${r.tagged ? 'yes' : 'no'}`, `Linearized: ${r.linearized ? 'yes' : 'no'}`,
      ...['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'].map((k) => `${k}: ${r.info[k] || ''}`),
      `Created: ${dates.created ? dates.created.toISOString() : ''}`, `Modified: ${dates.modified ? dates.modified.toISOString() : ''}`,
      `Page sizes: ${r.sizes.map((g) => `${g.name} ${g.orient} x${g.pages.length}`).join('; ')}`,
      `Fonts: ${r.fonts.map((f) => `${f.name}${f.embedded ? '' : ' (not embedded)'}`).join(', ')}`,
      `Bookmarks: ${r.bookmarks ? r.bookmarks.total : 0}`, `Form fields: ${r.form ? r.form.count : 0}`, `Attachments: ${r.attachments.map((a) => a.name).join(', ')}`,
    ].join('\n')
    const json = () => JSON.stringify({ file: source.name, bytes: source.size, version, pages: r.pages, encrypted: r.encrypted, tagged: r.tagged, linearized: r.linearized, info: r.info, sizes: r.sizes.map((g) => ({ name: g.name, orientation: g.orient, pages: g.pages })), fonts: r.fonts, bookmarks: r.bookmarks, form: r.form, attachments: r.attachments, javascript: r.hasJS }, null, 2)

    clear(body,
      h('div', { class: 'pp-toolbar' }, h('span', { class: 'grow' }), copyButton(text, 'Copy summary'), downloadButton(() => new Blob([json()], { type: 'application/json' }), `${source.name.replace(/\.pdf$/i, '')}-info.json`, 'JSON', { variant: 'secondary', size: 'sm' })),
      h('div', { class: 'pp-bento' }, cards))
  }

  useStyle('pp-style-info', CSS)
  root.append(ppRoot(src.el, body))
}

const CSS = `
.pp .pp-bento { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 14px; }
.pp .pp-bento-card { grid-column: span 12; position: relative; overflow: hidden; padding: 18px 20px; border-radius: 22px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm); min-width: 0; transition: transform .35s var(--spring), box-shadow .3s, border-color .25s; }
.pp .pp-bento-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); border-color: var(--border-strong); }
.pp .pp-bento-card h3 { display: flex; align-items: center; gap: 9px; font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 14px; }
.pp .pp-bento-card h3 .icon { width: 16px; height: 16px; color: var(--accent); }
.pp .pp-span-12 { grid-column: span 12; } .pp .pp-span-7 { grid-column: span 7; } .pp .pp-span-6 { grid-column: span 6; } .pp .pp-span-5 { grid-column: span 5; }
.pp .pp-bento-card.pp-hero { background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 16%, var(--surface)), color-mix(in srgb, var(--accent-2) 10%, var(--surface)) 60%, var(--surface)); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); display: flex; flex-direction: column; gap: 6px; justify-content: space-between; min-height: 230px; }
.pp .pp-bento-card.pp-hero::after { content: ""; position: absolute; width: 260px; height: 260px; right: -90px; bottom: -110px; border-radius: 50%; background: radial-gradient(circle, color-mix(in srgb, var(--accent-2) 35%, transparent), transparent 70%); pointer-events: none; }
.pp .pp-info-hero-top { display: flex; gap: 8px; flex-wrap: wrap; }
.pp .pp-info-hero-n { display: flex; align-items: baseline; gap: 10px; }
.pp .pp-info-hero-n b { font-size: clamp(56px, 9vw, 92px); letter-spacing: -.05em; line-height: 1; font-variant-numeric: tabular-nums; background: var(--brand); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pp .pp-info-hero-n span { font-size: 18px; color: var(--muted); }
.pp .pp-info-hero-name { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp .pp-perms { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.pp .pp-perm { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 550; border: 1px solid var(--border); }
.pp .pp-perm .icon { width: 13px; height: 13px; stroke-width: 3; }
.pp .pp-perm.yes { color: var(--success); background: var(--success-soft); }
.pp .pp-perm.no { color: var(--danger); background: var(--danger-soft); }
.pp .pp-kv-note { margin-top: 10px; }
.pp .pp-sizechips { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
.pp .pp-sizechip { display: flex; flex-direction: column; padding: 8px 12px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); }
.pp .pp-sizechip b { font-size: 14px; } .pp .pp-sizechip span { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.pp .pp-attach { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 6px; }
.pp .pp-attach li { display: flex; align-items: center; gap: 8px; font-size: 13.5px; } .pp .pp-attach .icon { width: 15px; height: 15px; color: var(--accent); flex: none; } .pp .pp-attach small { margin-left: auto; color: var(--muted); }
.pp .pp-fontgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 10px; }
.pp .pp-font { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 14px; background: var(--surface-2); border: 1px solid var(--border); align-items: flex-start; min-width: 0; }
.pp .pp-font b { font-size: 14px; overflow-wrap: anywhere; } .pp .pp-font > span:not(.pp-chip) { font-size: 12px; color: var(--muted); }
@media (max-width: 900px) { .pp .pp-span-7, .pp .pp-span-6, .pp .pp-span-5 { grid-column: span 12; } .pp .pp-bento-card.pp-hero { min-height: 190px; } }
`
