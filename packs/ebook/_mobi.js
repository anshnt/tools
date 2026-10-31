// Reader for Palm and Kindle books: PDB (PalmDOC), MOBI 6 (PalmDOC or HUFF/CDIC compression), AZW and AZW3 (KF8, including files that carry
// both a MOBI 6 and a KF8 part). DRM-protected books are detected and refused. Written from the public descriptions of the Palm database,
// MOBI and KF8 layouts. Pure JavaScript, no libraries.
import {
  newBook, fail, drmError, fromBytes, sniffImage, addImage, parseXhtmlOrHtml, parseHtml, innerXhtml, stripActive, splitByHeadings, splitTextChapters, textOfHtml, svgToImg, modernize,
} from './_book.js'

const u16 = (d, o) => (d[o] << 8) | d[o + 1]
const u32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0
const ascii = (d, a, b) => String.fromCharCode(...d.subarray(a, b))
const NONE = 0xffffffff
const B32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV'
const fromB32 = (s) => [...s].reduce((n, c) => n * 32 + Math.max(0, B32.indexOf(c)), 0)
const yieldNow = () => new Promise((r) => setTimeout(r, 0))

/** Latin-1 string <-> bytes (every char code is one byte) in chunks, for byte-exact regex work. */
function bytesToBinary(b) {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000))
  return s
}
function binaryToBytes(s) {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i)
  return b
}
const concat = (chunks) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}

// ---------- compression ----------
export function palmDecompress(rec) {
  const out = []
  let i = 0
  const n = rec.length
  while (i < n) {
    const c = rec[i++]
    if (c >= 1 && c <= 8) { for (let k = 0; k < c && i < n; k++) out.push(rec[i++]) }
    else if (c < 0x80) out.push(c)
    else if (c >= 0xc0) { out.push(0x20, c ^ 0x80) }
    else {
      if (i >= n) break
      const pair = (c << 8) | rec[i++]
      const dist = (pair >> 3) & 0x7ff
      const len = (pair & 7) + 3
      let p = out.length - dist
      if (dist === 0 || p < 0) continue
      for (let k = 0; k < len; k++) out.push(out[p++])
    }
  }
  return Uint8Array.from(out)
}

/** HUFF/CDIC decoder (compression type 17480). recs = [HUFF record, CDIC records...]. */
export class HuffCdic {
  constructor(recs) {
    const h = recs[0]
    if (ascii(h, 0, 4) !== 'HUFF') throw fail('This book uses an unsupported compression table.', 'BAD')
    const off1 = u32(h, 16), off2 = u32(h, 20)
    this.dict1 = []
    for (let i = 0; i < 256; i++) {
      const x = u32(h, off1 + i * 4)
      const codelen = x & 0x1f, term = !!(x & 0x80)
      this.dict1.push({ codelen, term, maxcode: ((x >>> 8) + 1) * 2 ** (32 - codelen) - 1 })
    }
    this.mincode = [0]
    this.maxcode = [0]
    for (let l = 1; l <= 32; l++) {
      this.mincode[l] = u32(h, off2 + (l - 1) * 8) * 2 ** (32 - l)
      this.maxcode[l] = (u32(h, off2 + (l - 1) * 8 + 4) + 1) * 2 ** (32 - l) - 1
    }
    this.dictionary = []
    for (const cdic of recs.slice(1)) {
      if (ascii(cdic, 0, 4) !== 'CDIC') continue
      const phrases = u32(cdic, 8), bits = u32(cdic, 12)
      const n = Math.min(2 ** bits, phrases - this.dictionary.length)
      for (let i = 0; i < n; i++) {
        const off = u16(cdic, 16 + i * 2)
        const blen = u16(cdic, 16 + off)
        this.dictionary.push({ slice: cdic.subarray(18 + off, 18 + off + (blen & 0x7fff)), done: !!(blen & 0x8000) })
      }
    }
  }
  unpack(data) {
    const out = []
    let bitsLeft = data.length * 8, bp = 0
    const peek = (p) => {
      const i = p >> 3, s = p & 7
      const g = (k) => (i + k < data.length ? data[i + k] : 0)
      const hi = ((g(0) << 24) | (g(1) << 16) | (g(2) << 8) | g(3)) >>> 0
      return ((hi << s) | (g(4) >>> (8 - s))) >>> 0
    }
    for (;;) {
      const code = peek(bp)
      let { codelen, term, maxcode } = this.dict1[code >>> 24]
      if (!term) {
        while (code < this.mincode[codelen]) codelen++
        maxcode = this.maxcode[codelen]
      }
      bp += codelen
      bitsLeft -= codelen
      if (bitsLeft < 0) break
      const r = Math.floor((maxcode - code) / 2 ** (32 - codelen))
      const e = this.dictionary[r]
      if (!e) break
      if (!e.done) { e.done = true; e.slice = this.unpack(e.slice) }
      out.push(e.slice)
    }
    return concat(out)
  }
}

// ---------- trailing data of a text record ----------
function trailingSize(rec, flags) {
  const entry = (size) => {
    let bit = 0, result = 0
    if (size <= 0) return 0
    for (;;) {
      const v = rec[size - 1]
      result |= (v & 0x7f) << bit
      bit += 7
      size--
      if ((v & 0x80) || bit >= 28 || size === 0) return result
    }
  }
  let num = 0
  let t = flags >>> 1
  while (t) { if (t & 1) num += entry(rec.length - num); t >>>= 1 }
  if (flags & 1) num += (rec[rec.length - num - 1] & 3) + 1
  return num
}

// ---------- INDX / TAGX / CNCX ----------
const decint = (d, p) => {
  let v = 0, n = 0
  for (;;) {
    const b = d[p + n++]
    v = v * 128 + (b & 0x7f)
    if (b & 0x80 || p + n >= d.length) return [v, n]
  }
}
function indxHeader(d) {
  if (ascii(d, 0, 4) !== 'INDX') throw fail('A table of contents index in this book is damaged.', 'BAD')
  return { len: u32(d, 4), type: u32(d, 12), start: u32(d, 20), count: u32(d, 24), code: u32(d, 28), total: u32(d, 36), ncncx: u32(d, 52), tagx: u32(d, 180) }
}
/** Read a whole index: [{ident, tags: Map(tag -> [values])}] and the CNCX string pool. */
function readIndex(sections, idx, codec) {
  const hdr = sections[idx]
  const h = indxHeader(hdr)
  const cncx = new Map()
  let recOff = 0
  for (let r = 0; r < h.ncncx; r++) {
    const raw = sections[idx + h.count + 1 + r]
    if (!raw) break
    let pos = 0
    while (pos < raw.length) {
      const [len, used] = decint(raw, pos)
      if (len > 0) cncx.set(pos + recOff, fromBytes(raw.subarray(pos + used, pos + used + len), codec))
      pos += used + len
    }
    recOff += 0x10000
  }
  // TAGX
  const tx = h.tagx
  if (ascii(hdr, tx, tx + 4) !== 'TAGX') throw fail('A table of contents index in this book is damaged.', 'BAD')
  const firstEntry = u32(hdr, tx + 4), ctrlBytes = u32(hdr, tx + 8)
  const tagx = []
  for (let i = tx + 12; i < tx + firstEntry; i += 4) tagx.push({ tag: hdr[i], n: hdr[i + 1], mask: hdr[i + 2], eof: hdr[i + 3] })
  const entries = []
  for (let r = 1; r <= h.count; r++) {
    const rec = sections[idx + r]
    if (!rec) continue
    const rh = indxHeader(rec)
    const idxt = rh.start
    if (ascii(rec, idxt, idxt + 4) !== 'IDXT') continue
    const pos = []
    for (let j = 0; j < rh.count; j++) pos.push(u16(rec, idxt + 4 + j * 2))
    pos.push(idxt)
    for (let j = 0; j < rh.count; j++) {
      const data = rec.subarray(pos[j], pos[j + 1])
      const L = data[0]
      const ident = fromBytes(data.subarray(1, 1 + L), codec)
      entries.push({ ident, tags: tagMap(data.subarray(1 + L), ctrlBytes, tagx) })
    }
  }
  return { entries, cncx }
}
function tagMap(data, ctrlCount, tagx) {
  let ctrl = Array.from(data.subarray(0, ctrlCount))
  let p = ctrlCount
  const plan = []
  for (const x of tagx) {
    if (x.eof === 1) { ctrl = ctrl.slice(1); continue }
    let value = ctrl[0] & x.mask
    if (!value) continue
    let count = null, bytes = null
    if (value === x.mask) {
      if (x.mask.toString(2).split('1').length - 1 > 1) { const [v, used] = decint(data, p); bytes = v; p += used } else count = 1
    } else {
      let m = x.mask
      while ((m & 1) === 0) { m >>= 1; value >>= 1 }
      count = value
    }
    plan.push({ x, count, bytes })
  }
  const out = new Map()
  for (const { x, count, bytes } of plan) {
    const vals = []
    if (count != null) {
      for (let i = 0; i < count * x.n; i++) { const [v, used] = decint(data, p); p += used; vals.push(v) }
    } else {
      let total = 0
      while (total < bytes) { const [v, used] = decint(data, p); p += used; total += used; vals.push(v) }
    }
    out.set(x.tag, vals)
  }
  return out
}

// ---------- EXTH ----------
function readExth(r0, hdrLen) {
  const out = new Map()
  const p0 = 16 + hdrLen
  if (r0.length < p0 + 12 || ascii(r0, p0, p0 + 4) !== 'EXTH') return out
  const count = u32(r0, p0 + 8)
  let p = p0 + 12
  for (let i = 0; i < count && p + 8 <= r0.length; i++) {
    const t = u32(r0, p), l = u32(r0, p + 4)
    if (l < 8) break
    if (!out.has(t)) out.set(t, [])
    out.get(t).push(r0.subarray(p + 8, p + l))
    p += l
  }
  return out
}

// ---------- the reader ----------
export async function readMobi(file, onProgress) {
  const d = new Uint8Array(await file.arrayBuffer())
  if (d.length < 80) throw fail('This file is too small to be a book.', 'BAD')
  const kind = ascii(d, 60, 68)
  if (kind !== 'BOOKMOBI' && kind !== 'TEXtREAd') throw fail('This is not a Kindle or Palm book.', 'BAD')
  const n = u16(d, 76)
  const offs = []
  for (let i = 0; i < n; i++) offs.push(u32(d, 78 + i * 8))
  offs.push(d.length)
  const sections = offs.slice(0, n).map((o, i) => d.subarray(o, Math.max(o, offs[i + 1])))
  if (!n || !sections[0].length) throw fail('This book has no content.', 'BAD')

  // a joint file holds MOBI 6 first and a KF8 part after a BOUNDARY record: read the newer KF8 part
  let base = 0
  const probe = (b) => {
    const r = sections[b]
    if (!r || r.length < 24 || ascii(r, 16, 20) !== 'MOBI') return null
    return { hdrLen: u32(r, 20), version: u32(r, 36) }
  }
  const first = probe(0)
  if (first) {
    const exth0 = readExth(sections[0], first.hdrLen)
    const k = exth0.get(121)
    if (k) {
      const start = u32(k[0], 0)
      for (const c of [start, start + 1, start - 1]) { const p = probe(c); if (p && p.version >= 8) { base = c; break } }
    }
  }
  const r0 = sections[base]
  const comp = u16(r0, 0)
  const textLen = u32(r0, 4)
  const textRecs = u16(r0, 8)
  const encryption = u16(r0, 12)
  if (encryption !== 0) throw drmError('book')
  const hasMobi = r0.length > 24 && ascii(r0, 16, 20) === 'MOBI'
  let hdrLen = 0, codepage = 65001, version = 0, extra = 0, firstImage = NONE, exth = new Map()
  let hdr = {}
  if (hasMobi) {
    hdrLen = u32(r0, 20)
    codepage = u32(r0, 28)
    version = u32(r0, 36)
    firstImage = u32(r0, 108)
    const drmOff = hdrLen >= 0xb4 ? u32(r0, 168) : NONE
    const drmCount = hdrLen >= 0xb4 ? u32(r0, 172) : 0
    if (drmOff !== NONE && drmOff !== 0 && drmCount > 0) throw drmError('book')
    if (hdrLen >= 0xe4) extra = u32(r0, 0xf0)
    if (u32(r0, 128) & 0x40) exth = readExth(r0, hdrLen)
    hdr = {
      huffRec: u32(r0, 112), huffCount: u32(r0, 116),
      fdst: hdrLen >= 0xc4 ? u32(r0, 0xc0) : NONE,
      ncx: hdrLen >= 0xe8 ? u32(r0, 0xf4) : NONE,
      chunk: hdrLen >= 0x104 ? u32(r0, 0xf8) : NONE,
      skel: hdrLen >= 0x104 ? u32(r0, 0xfc) : NONE,
    }
  }
  const codec = codepage === 1252 ? 'windows-1252' : 'utf-8'
  const isKf8 = version >= 8 && hdr.skel !== NONE && hdr.chunk !== NONE
  if (version > 8) throw fail('This Kindle format version is not supported.', 'FORMAT')

  // ----- text
  let huff = null
  if (comp === 17480) {
    const hs = []
    for (let i = 0; i < hdr.huffCount; i++) hs.push(sections[base + hdr.huffRec + i] || sections[hdr.huffRec + i])
    huff = new HuffCdic(hs.filter(Boolean))
  } else if (comp !== 1 && comp !== 2) throw fail(`This book uses an unsupported compression method (${comp}).`, 'FORMAT')
  const chunks = []
  for (let i = 1; i <= textRecs; i++) {
    let rec = sections[base + i]
    if (!rec) break
    if (extra) rec = rec.subarray(0, rec.length - trailingSize(rec, extra))
    chunks.push(comp === 2 ? palmDecompress(rec) : comp === 17480 ? huff.unpack(rec) : rec)
    if (i % 20 === 0) { onProgress?.(i / textRecs, 'Reading text'); await yieldNow() }
  }
  let raw = concat(chunks)
  if (textLen && raw.length > textLen) raw = raw.subarray(0, textLen)
  onProgress?.(1, 'Reading text')

  const book = newBook('reflow')
  const str = (t) => (exth.get(t) ? fromBytes(exth.get(t)[0], codec) : '')
  const m = book.meta
  let title = ''
  if (hasMobi) {
    const off = u32(r0, 84), len = u32(r0, 88)
    if (off && len && off + len <= r0.length) title = fromBytes(r0.subarray(off, off + len), codec)
  }
  m.title = str(503) || title || fromBytes(d.subarray(0, 32).filter((x) => x), 'windows-1252').replace(/_/g, ' ').trim()
  m.authors = (exth.get(100) || []).map((b) => fromBytes(b, codec)).filter(Boolean)
  m.publisher = str(101)
  m.description = str(103)
  m.language = str(524)
  m.date = str(106)
  m.identifier = str(113) || str(104)

  // ----- pictures
  const imgNames = new Map()
  let imgBase = 0
  if (firstImage !== NONE) {
    for (const c of [base + firstImage, firstImage]) { if (sections[c] && sniffImage(sections[c])) { imgBase = c; break } }
  }
  const imageFor = (num) => {
    if (num < 1 || firstImage === NONE) return null
    if (imgNames.has(num)) return imgNames.get(num)
    const rec = sections[imgBase + num - 1]
    const type = rec && sniffImage(rec)
    const name = type ? addImage(book, rec, type, `image${num}`) : null
    imgNames.set(num, name)
    return name
  }
  const coverOff = exth.get(201) ? u32(exth.get(201)[0], 0) : null
  if (coverOff != null && coverOff !== NONE) {
    const rec = sections[imgBase + coverOff]
    const type = rec && sniffImage(rec)
    if (type) book.cover = { data: rec, type }
  }

  if (!hasMobi) {
    // a plain PalmDOC book is text, not HTML
    for (const c of splitTextChapters(fromBytes(raw, 'windows-1252'))) book.chapters.push(c)
  } else if (isKf8) readKf8({ book, sections, base, hdr, raw, codec, imageFor, imgBase, firstImage })
  else readMobi6({ book, raw, codec, imageFor, hdr, sections, base, hasMobi })

  if (!book.cover && imageFor(1)) { const im = book.images.get(imgNames.get(1)); if (im && book.chapters[0] && /<img/.test(book.chapters[0].body.slice(0, 400))) book.cover = { data: im.data, type: im.type } }
  return book
}


/** Index entries -> TOC tree. items: [{title, ch, frag, depth, parent}] in index order (parent = index of the parent entry). Entries without a chapter are dropped. */
function buildToc(items) {
  const nodes = items.map((it) => ({ title: it.title, ch: it.ch, frag: it.frag || '', children: [] }))
  const useParent = items.some((it) => it.parent != null && it.parent !== NONE && it.parent < items.length)
  const top = []
  const stack = []
  items.forEach((it, k) => {
    if (useParent) {
      const p = it.parent
      if (p != null && p !== NONE && nodes[p] && p !== k) nodes[p].children.push(nodes[k])
      else top.push(nodes[k])
    } else {
      while (stack.length && stack[stack.length - 1].depth >= it.depth) stack.pop()
      ;(stack.length ? stack[stack.length - 1].node.children : top).push(nodes[k])
      stack.push({ depth: it.depth, node: nodes[k] })
    }
  })
  const prune = (list) => list.flatMap((n) => { n.children = prune(n.children); return n.ch == null ? n.children : [n] })
  return prune(top)
}

// ---------- MOBI 6 ----------
function readMobi6({ book, raw, codec, imageFor, hdr, sections, base, hasMobi }) {
  let s = bytesToBinary(raw)
  // table of contents index (positions in the text)
  const ncx = []
  if (hasMobi && hdr.ncx !== NONE && hdr.ncx !== 0) {
    try {
      const { entries, cncx } = readIndex(sections, base + hdr.ncx, codec)
      for (const e of entries) {
        const pos = e.tags.get(1)?.[0]
        const label = cncx.get(e.tags.get(3)?.[0])
        if (pos != null && label) ncx.push({ pos, title: label, depth: e.tags.get(4)?.[0] ?? 0, parent: e.tags.get(21)?.[0] })
      }
    } catch { /* a book without a usable TOC is still readable */ }
  }
  s = s.replace(/<guide>[\s\S]*?<\/guide>/i, '')
  // pages are split at <mbp:pagebreak/>, and at the TOC positions when the book has few page breaks
  const breaks = (s.match(/<mbp:pagebreak\s*\/?>/gi) || []).length
  const targets = new Set()
  for (const mt of s.matchAll(/filepos\s*=\s*["']?0*(\d+)/gi)) targets.add(Number(mt[1]))
  for (const e of ncx) targets.add(e.pos)
  const splitAt = new Set(breaks < 3 ? ncx.map((e) => e.pos) : [])
  const marks = [...new Set([...targets, ...splitAt])].sort((a, b) => a - b)
  let out = '', last = 0
  for (const off of marks) {
    if (off < 0 || off > s.length) continue
    let pos = off
    if (s.lastIndexOf('<', pos - 1) > s.lastIndexOf('>', pos - 1)) pos = s.lastIndexOf('<', pos - 1)
    if (pos < last) pos = last
    out += s.slice(last, pos)
    if (splitAt.has(off)) out += '<mbp:pagebreak/>'
    if (targets.has(off)) out += `<a id="filepos${off}"></a>`
    last = pos
  }
  out += s.slice(last)
  let html = fromBytes(binaryToBytes(out), codec)
  html = html.replace(/(<a\b[^>]*?)filepos\s*=\s*["']?0*(\d+)["']?/gi, '$1href="#filepos$2"').replace(/(<img\b[^>]*?)recindex\s*=\s*["']?0*(\d+)["']?/gi, '$1src="mobiimg:$2"')
  const segments = html.split(/<mbp:pagebreak\s*\/?>/i)
  const ctx = { imageFor }
  const chapterOf = new Map()
  for (const seg of segments) {
    const doc = parseHtml(`<body>${seg.replace(/<\/?mbp:[^>]*>/gi, '')}</body>`)
    for (const t of doc.querySelectorAll('title')) t.remove()
    processBody(doc.body, ctx)
    const body = innerXhtml(doc.body).trim()
    if (!textOfHtml(body) && !/<img/i.test(body)) continue
    const idx = book.chapters.length
    for (const mt of body.matchAll(/\sid="filepos(\d+)"/g)) chapterOf.set(Number(mt[1]), idx)
    book.chapters.push({ title: '', body })
  }
  // a book that is one big blob: split it at headings
  if (book.chapters.length === 1 && book.chapters[0].body.length > 120000) {
    const parts = splitByHeadings(book.chapters[0].body)
    if (parts.length > 1) {
      chapterOf.clear()
      book.chapters = parts.map((p) => ({ title: p.title, body: p.body }))
      book.chapters.forEach((c, i) => { for (const mt of c.body.matchAll(/\sid="filepos(\d+)"/g)) chapterOf.set(Number(mt[1]), i) })
    }
  }
  // links between positions
  book.chapters.forEach((c, i) => {
    c.body = c.body.replace(/href="#filepos(\d+)"/g, (all, n) => (chapterOf.has(Number(n)) && chapterOf.get(Number(n)) !== i ? `href="chapter-${chapterOf.get(Number(n)) + 1}.xhtml#filepos${n}"` : all))
  })
  // TOC tree from the index
  book.toc = buildToc(ncx.map((e) => {
    const ch = chapterOf.get(e.pos)
    if (ch == null) return { title: e.title, ch: null, depth: e.depth, parent: e.parent }
    const startsChapter = book.chapters[ch].body.search(new RegExp(`id="filepos${e.pos}"`)) < 40
    if (startsChapter && !book.chapters[ch].title) book.chapters[ch].title = e.title
    return { title: e.title, ch, frag: startsChapter ? '' : `filepos${e.pos}`, depth: e.depth, parent: e.parent }
  }))
}

// ---------- KF8 (AZW3) ----------
function readKf8({ book, sections, base, hdr, raw, codec, imageFor }) {
  const at = (i, sig) => { for (const c of [base + i, i]) if (sections[c] && ascii(sections[c], 0, sig.length) === sig) return c; return null }
  let flows = [raw]
  if (hdr.fdst !== NONE) {
    const f = sections[at(hdr.fdst, 'FDST') ?? -1]
    if (f) {
      const num = u32(f, 8)
      const starts = []
      for (let i = 0; i < num; i++) starts.push(u32(f, 12 + i * 8))
      starts.push(raw.length)
      flows = starts.slice(0, -1).map((s, i) => raw.subarray(s, starts[i + 1]))
    }
  }
  const text = flows[0]
  const skelAt = at(hdr.skel, 'INDX'), chunkAt = at(hdr.chunk, 'INDX')
  if (skelAt == null || chunkAt == null) throw fail('This Kindle book could not be read (its structure tables are missing).', 'BAD')
  const skels = readIndex(sections, skelAt, codec).entries.map((e) => ({ count: e.tags.get(1)[0], start: e.tags.get(6)[0], len: e.tags.get(6)[1] }))
  const chunkIdx = readIndex(sections, chunkAt, codec)
  const chunks = chunkIdx.entries.map((e) => ({ insert: parseInt(e.ident, 10), file: e.tags.get(3)[0], len: e.tags.get(6)[1] }))
  // each skeleton is a whole XHTML file with its pieces (chunks) stored after it
  const parts = []
  let ptr = 0
  for (const sk of skels) {
    let at2 = sk.start + sk.len
    let skeleton = text.subarray(sk.start, at2)
    for (let i = 0; i < sk.count; i++) {
      const ch = chunks[ptr++]
      if (!ch) break
      const piece = text.subarray(at2, at2 + ch.len)
      const ins = Math.max(0, Math.min(skeleton.length, ch.insert - sk.start))
      skeleton = concat([skeleton.subarray(0, ins), piece, skeleton.subarray(ins)])
      at2 += ch.len
    }
    parts.push(skeleton)
  }
  const flowText = (n) => (n > 0 && flows[n] ? fromBytes(flows[n], codec) : '')
  const embed = (t) => t.replace(/kindle:embed:([0-9A-V]+)(\?mime=[^"')\s]+)?/g, (_, n) => `mobiimg:${fromB32(n)}`)
  const cssDone = new Set()
  const cssParts = []
  const ctx = {
    imageFor,
    flowImage: (n) => { const m = embed(flowText(n)).match(/mobiimg:(\d+)/); return m ? imageFor(Number(m[1])) : null },
  }
  parts.forEach((p) => {
    let html = embed(fromBytes(p, codec))
    html = html.replace(/kindle:pos:fid:([0-9A-V]+):off:[0-9A-V]+/g, (_, f) => { const c = chunks[fromB32(f)]; return c ? `chapter-${c.file + 1}.xhtml` : '#' })
    const doc = parseXhtmlOrHtml(html)
    for (const l of doc.querySelectorAll('link[href^="kindle:flow"]')) {
      const n = fromB32((l.getAttribute('href').match(/kindle:flow:([0-9A-V]+)/) || [])[1] || '')
      if (cssDone.has(n) || !/css/.test(l.getAttribute('href') + (l.getAttribute('type') || ''))) continue
      cssDone.add(n)
      cssParts.push(embed(flowText(n)).replace(/@font-face\s*\{[^}]*\}/gi, '').replace(/url\(\s*['"]?mobiimg:(\d+)['"]?\s*\)/g, (_, k) => { const name = imageFor(Number(k)); return name ? `url(${name})` : 'url()' }))
    }
    const body = doc.body || parseHtml('<body></body>').body
    processBody(body, ctx)
    for (const el of body.querySelectorAll('[aid]')) el.removeAttribute('aid')
    const xhtml = innerXhtml(body).trim()
    book.chapters.push({ title: '', body: xhtml || '<p></p>' })
  })
  book.css = cssParts.join('\n')
  // table of contents
  const ncxAt = hdr.ncx !== NONE && hdr.ncx !== 0 ? at(hdr.ncx, 'INDX') : null
  if (ncxAt != null) {
    try {
      const { entries, cncx } = readIndex(sections, ncxAt, codec)
      const items = entries.map((e) => {
        const label = cncx.get(e.tags.get(3)?.[0])
        const pf = e.tags.get(6)
        let ch = pf ? chunks[pf[0]]?.file : null
        if (!label || ch == null || ch >= book.chapters.length) ch = null
        else if (!book.chapters[ch].title) book.chapters[ch].title = label
        return { title: label || '', ch, frag: '', depth: e.tags.get(4)?.[0] ?? 0, parent: e.tags.get(21)?.[0] }
      })
      book.toc = buildToc(items)
    } catch { /* readable without a TOC */ }
  }
}

function processBody(body, ctx) {
  svgToImg(body)
  stripActive(body)
  modernize(body)
  for (const img of [...body.querySelectorAll('img')]) {
    const src = img.getAttribute('src') || ''
    let name = null
    const mi = src.match(/^mobiimg:(\d+)/)
    if (mi) name = ctx.imageFor(Number(mi[1]))
    const fl = src.match(/^kindle:flow:([0-9A-V]+)/)
    if (fl && ctx.flowImage) name = ctx.flowImage(fromB32(fl[1]))
    if (/^data:image\//i.test(src)) continue
    if (name) img.setAttribute('src', name)
    else img.remove()
    for (const a of ['recindex', 'hirecindex', 'lorecindex', 'srcset']) img.removeAttribute(a)
  }
  for (const a of body.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href')
    if (/^kindle:|^mobi/i.test(h)) a.removeAttribute('href')
  }
}
