// A strict structural validator for CDR version 13 files in the plain (uncompressed) RIFF layout, written from the public format notes.
// The site's own reader is lenient on purpose; this one is not: every length must add up exactly, every record must be consumed to its last byte,
// padding must be zero, ids must resolve. It is used by cdrout.test.mjs on every file the writer produces.
//
//   strictCheck(bytes, {lean}) -> {version, pages: [{master, name, w, h, layers: [{name, type, objects, groups}]}], fills, outlines, fonts, bitmaps}   (throws on the first problem)
import assert from 'node:assert/strict'

const ascii = (b, o, n = 4) => String.fromCharCode(...b.subarray(o, o + n))
class R {
  constructor(b, what) { this.b = b; this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength); this.p = 0; this.what = what }
  need(n) { assert.ok(this.p + n <= this.b.length, `${this.what}: read ${n} bytes at ${this.p} of ${this.b.length}`) }
  u8() { this.need(1); return this.b[this.p++] }
  u16() { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v }
  u32() { this.need(4); const v = this.dv.getUint32(this.p, true); this.p += 4; return v }
  i32() { this.need(4); const v = this.dv.getInt32(this.p, true); this.p += 4; return v }
  f64() { this.need(8); const v = this.dv.getFloat64(this.p, true); this.p += 8; return v }
  skip(n) { this.need(n); this.p += n }
  bytes(n) { this.need(n); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v }
  get left() { return this.b.length - this.p }
  done() { assert.equal(this.left, 0, `${this.what}: ${this.left} unread bytes`) }
}
const utf16z = (b, what) => { assert.equal(b.length % 2, 0, `${what}: odd utf-16 length`); assert.equal(b[b.length - 1] | b[b.length - 2], 0, `${what}: missing terminator`); return new TextDecoder('utf-16le').decode(b.subarray(0, b.length - 2)) }

/** Chunk tree of a plain RIFF body. Lists named in rawLists keep their body as bytes. */
function chunks(b, what, depth = 0) {
  const out = []
  let p = 0
  while (p < b.length) {
    assert.ok(p + 8 <= b.length, `${what}: truncated chunk header at ${p}`)
    const id = ascii(b, p), len = new DataView(b.buffer, b.byteOffset + p + 4, 4).getUint32(0, true)
    assert.ok(/^[\x20-\x7e]{4}$/.test(id), `${what}: bad chunk id at ${p}`)
    assert.ok(p + 8 + len <= b.length, `${what}: chunk ${id} (${len}) runs past its parent (${b.length - p - 8} left)`)
    const body = b.subarray(p + 8, p + 8 + len)
    if (len & 1) { assert.ok(p + 9 + len <= b.length, `${what}: missing pad after ${id}`); assert.equal(b[p + 8 + len], 0, `${what}: pad byte after ${id} is not zero`) }
    p += 8 + len + (len & 1)
    const c = { id, body }
    if (id === 'LIST') {
      assert.ok(len >= 4, `${what}: LIST too short`)
      c.form = ascii(body, 0)
      assert.ok(depth < 36, `${what}: nested too deeply`)
      c.kids = c.form === 'stlt' ? [] : chunks(body.subarray(4), `${what}/${c.form}`, depth + 1)
    }
    out.push(c)
  }
  assert.equal(p, b.length, `${what}: chunks do not end exactly at the end of the parent`)
  return out
}
const colour = (r) => { const model = r.u16(), pal = r.u16(); r.skip(4); const v = [r.u8(), r.u8(), r.u8(), r.u8()]; assert.equal(model, 5, 'colour model'); assert.equal(pal, 5, 'palette'); return v }

function parseFild(c, lean) {
  const r = new R(c.body, 'fild')
  const id = r.u32(), since = r.u32(), len = r.u32()
  assert.equal(since, 1300, 'fild since_version')
  assert.equal(len, r.left, 'fild len_body')
  const type = r.u16()
  if (type === 0) { r.done(); return { id, type } }
  if (type === 1) {
    assert.equal(r.u32(), 1300, 'solid since_version')
    const lp = r.u32(), props = new R(r.bytes(lp), 'solid properties')
    let col = null
    for (;;) {
      const t = props.u8(), l = props.u32()
      if (t === 0) { assert.equal(l, 0); break }
      if (t === 7) { assert.ok(!lean); assert.equal(l, 16); assert.ok(props.bytes(16).every((v) => v === 0), 'empty user palette id'); continue }
      assert.equal(t, 1, 'only the colour and palette id properties are written'); assert.equal(l, 12)
      col = colour(new R(props.bytes(12), 'colour'))
    }
    props.done()
    assert.ok(col, 'solid fill has a colour')
    assert.equal(r.u16(), 0); r.skip(2); assert.equal(r.u32(), 0); r.i32(); r.u32()
    r.done()
    return { id, type, rgb: [col[2], col[1], col[0]] }
  }
  assert.equal(type, 2, 'fill type')
  assert.equal(r.u32(), 1300, 'gradient since_version')
  const lg = r.u32()
  assert.equal(lg, r.left, 'gradient block length')
  const kind = r.u8(); assert.ok(kind === 1 || kind === 2, 'gradient kind')
  r.skip(17); r.skip(2)
  const angle = r.i32() / 1e6
  r.skip(8); r.skip(2); r.skip(4); r.u8(); r.skip(1)
  const n = r.u32(); assert.ok(n >= 2 && n <= 64, 'gradient stop count')
  r.skip(3)
  const stops = []
  for (let i = 0; i < n; i++) { const col = colour(r); r.skip(5); const o = r.u32(); r.skip(3); stops.push({ o: o / 10000, rgb: [col[2], col[1], col[0]] }) }
  assert.equal(stops[0].o, 0); assert.equal(stops[n - 1].o, 1)
  for (let i = 1; i < n; i++) assert.ok(stops[i].o >= stops[i - 1].o, 'stops are ordered')
  r.skip(3)
  r.done()
  return { id, type, kind, angle, stops }
}
function parseOutl(c) {
  const r = new R(c.body, 'outl')
  const id = r.u32()
  assert.equal(r.u32(), 1, 'outline block id')
  assert.equal(r.u32(), r.left, 'outline block length')
  const type = r.u16(), cap = r.u16(), join = r.u16(), width = r.i32(), stretch = r.u16()
  r.skip(2); r.skip(4); r.skip(46)
  const col = colour(r)
  r.skip(16)
  const nd = r.u16()
  assert.ok(nd <= 11, 'dash count')
  const dash = []
  for (let i = 0; i < 11; i++) dash.push(r.u16())
  assert.equal(r.u32(), 0); assert.equal(r.u32(), 0)
  r.done()
  assert.equal(stretch, 100); assert.ok(cap <= 2 && join <= 2)
  assert.equal(!!(type & 2), nd > 0, 'dash flag matches the dash list')
  return { id, none: !!(type & 1), cap, join, width, rgb: [col[2], col[1], col[0]], dash: dash.slice(0, nd) }
}
function parseFont(c) {
  const r = new R(c.body, 'font')
  const id = r.u16(); r.u16(); r.u32(); r.skip(10)
  return { id, name: utf16z(r.bytes(r.left), 'font name') }
}
function parseBmp(c) {
  const r = new R(c.body, 'bmp')
  const id = r.u32(); r.skip(50)
  const model = r.u32(); r.skip(4)
  const w = r.u32(), h = r.u32(); r.skip(4)
  const bpp = r.u32(); r.skip(4)
  const size = r.u32(); r.skip(32)
  assert.equal(model, 5); assert.ok(bpp === 24 || bpp === 32)
  assert.equal(size, (((w * bpp + 31) >> 5) << 2) * h, 'bitmap byte size')
  assert.equal(r.left, size, 'bitmap payload length')
  return { id, w, h, bpp }
}
function parseLoda(c, where) {
  const b = c.body, r = new R(b, `loda in ${where}`)
  const total = r.u32(), n = r.u32(), startArgs = r.u32(), startTypes = r.u32(), ctype = r.u32()
  assert.equal(total, b.length, 'loda length')
  assert.equal(startArgs, 20); assert.equal(startTypes, 20 + (n + 1) * 4)
  const offs = [], types = []
  for (let i = 0; i <= n; i++) offs.push(r.u32())
  for (let i = 0; i < n; i++) types.push(r.u32())
  assert.equal(offs[0], startTypes + n * 4, 'first argument follows the type table')
  assert.equal(offs[n], b.length, 'last offset is the end')
  const args = []
  for (let i = 0; i < n; i++) { assert.ok(offs[i + 1] >= offs[i]); args.push({ type: types[n - 1 - i], body: b.subarray(offs[i], offs[i + 1]) }) }
  return { ctype, args }
}
/** Points of a curve: returns the subpaths [{pts:[[x,y]], ops, closed}] after checking the node grammar. */
function parsePoints(r, n, what) {
  const xy = [], types = []
  for (let i = 0; i < n; i++) xy.push([r.i32(), r.i32()])
  for (let i = 0; i < n; i++) types.push(r.u8())
  const subs = []
  let cur = null, i = 0
  while (i < n) {
    const t = types[i], op = (t & 0xc0) >> 6, close = !!(t & 8)
    if (op === 0) { assert.equal(t & 4, 4, `${what}: a move can be modified`); cur = { start: xy[i], close, n: 0, last: xy[i] }; subs.push(cur); i++; continue }
    assert.ok(cur, `${what}: a segment before any move`)
    if (op === 1) { cur.n++; cur.last = xy[i]; cur.endClose = close; i++ }
    else if (op === 3) { assert.equal(types[i + 1] >> 6, 3, `${what}: two control points in a row`); assert.equal(types[i + 2] >> 6, 2, `${what}: cubic end after two controls`); cur.n++; cur.last = xy[i + 2]; cur.endClose = !!(types[i + 2] & 8); i += 3 }
    else assert.fail(`${what}: stray cubic end at ${i}`)
    if (cur.endClose) { assert.deepEqual(cur.last, cur.start, `${what}: a closing segment ends at the start`); assert.ok(cur.close, `${what}: closing flag on the move`) }
  }
  for (const s of subs) { assert.ok(s.n > 0, `${what}: sub-path without segments`); assert.equal(!!s.endClose, s.close, `${what}: closed flags agree`) }
  return subs
}
function parseTxsm(body) {
  const r = new R(body, 'txsm')
  r.u32(); r.skip(32)
  assert.equal(r.u32(), 1, 'frames'); r.u32(); r.skip(48); r.u32(); r.skip(34)
  assert.equal(r.u32(), 1, 'paragraphs'); r.u32(); r.u8()
  assert.equal(r.u32(), 1, 'styles')
  const nch = r.u16(), fl = r.u8(), fl3 = r.u8()
  assert.equal(fl, 0x47); assert.equal(fl3, 0)
  const font = r.u16(); r.u16()
  const sf = r.u32(), size = r.i32() / 254000, fill = r.u32(); r.skip(48)
  assert.equal(r.u32(), nch, 'char count'); r.skip(nch * 8)
  const nb = r.u32(); assert.equal(nb, nch * 2)
  const text = new TextDecoder('utf-16le').decode(r.bytes(nb))
  assert.equal(r.u8(), 0, 'no path')
  r.done()
  return { text, font, sf, size, fill }
}

export function strictCheck(bytes, { lean = false } = {}) {
  const top = new R(bytes, 'file')
  assert.equal(ascii(bytes, 0), 'RIFF')
  assert.equal(top.dv.getUint32(4, true), bytes.length - 8, 'RIFF size covers the file')
  assert.equal(bytes.length % 2, 0, 'file length is even')
  assert.equal(ascii(bytes, 8), 'CDRD', 'form type')
  const root = chunks(bytes.subarray(12), 'RIFF')
  const ids = root.map((c) => c.id + (c.form ? ':' + c.form : ''))
  assert.deepEqual(ids.slice(0, 3), ['vrsn', 'DISP', 'LIST:doc '], 'top level order')
  assert.ok(ids.slice(3).every((x) => x === 'LIST:page'), 'only pages follow the document list')
  assert.equal(root[0].body.length, 2); assert.equal(new DataView(root[0].body.buffer, root[0].body.byteOffset).getUint16(0, true), 1300)
  // preview
  { const r = new R(root[1].body, 'DISP'); assert.equal(r.u32(), 0); assert.equal(r.u32(), 40); const w = r.u32(), h = r.u32(); assert.equal(r.u16(), 1); assert.equal(r.u16(), 24); assert.equal(r.u32(), 0); const sz = r.u32(); r.skip(16); assert.equal(sz, (((w * 24 + 31) >> 5) << 2) * h); assert.equal(r.left, sz) }
  // document tables
  const doc = root[2]
  assert.deepEqual(doc.kids.map((c) => c.id + (c.form ? ':' + c.form : '')), lean ? ['mcfg', 'LIST:fild', 'LIST:outl', 'LIST:font', 'LIST:bmpt'] : ['mcfg', 'LIST:stlt', 'LIST:fild', 'LIST:outl', 'LIST:font', 'LIST:bmpt'], 'document list')
  const mcfg = new R(doc.kids[0].body, 'mcfg'); mcfg.skip(12); const mw = mcfg.i32() / 254000, mh = mcfg.i32() / 254000
  assert.ok(doc.kids[0].body.length >= 20)
  if (!lean) { assert.equal(new DataView(doc.kids[1].body.buffer, doc.kids[1].body.byteOffset + 4, 4).getUint32(0, true), 0, 'style table has no records'); assert.equal(doc.kids[1].body.length, 8) }
  const tabs = doc.kids.filter((c) => c.id === 'LIST' && c.form !== 'stlt')
  const fills = new Map(), outls = new Map(), fonts = new Map(), bmps = new Map()
  for (const c of tabs[0].kids) { assert.equal(c.id, 'fild'); const f = parseFild(c, lean); assert.ok(!fills.has(f.id), 'unique fill id'); fills.set(f.id, f) }
  for (const c of tabs[1].kids) { assert.equal(c.id, 'outl'); const o = parseOutl(c); assert.ok(!outls.has(o.id), 'unique outline id'); outls.set(o.id, o) }
  for (const c of tabs[2].kids) { assert.equal(c.id, 'font'); const f = parseFont(c); assert.ok(!fonts.has(f.id)); fonts.set(f.id, f) }
  for (const c of tabs[3].kids) { assert.equal(c.id, 'bmp '); const b = parseBmp(c); assert.ok(!bmps.has(b.id)); bmps.set(b.id, b) }
  const usedBmps = new Set()
  const staticIds = new Set()
  const pages = []
  for (const pc of root.slice(3)) {
    const kids = pc.kids
    assert.equal(kids[0].id, 'flgs'); assert.equal(kids[0].body.length, 4)
    assert.equal(kids[0].body[3], 0x90)
    const master = kids[0].body[2] === 1
    const lod = parseLoda(kids[1], 'page')
    const name = utf16z(lod.args.find((a) => a.type === 1000).body, 'page name')
    const sz = lod.args.find((a) => a.type === 19130)
    let w = mw, h = mh
    if (sz) { assert.equal(sz.body.length, 8); const r = new R(sz.body, 'page size'); w = r.i32() / 254000; h = r.i32() / 254000 } else assert.ok(master, 'only the master page lacks a size')
    const page = { master, name, w, h, layers: [] }
    for (const lc of kids.slice(2)) {
      assert.equal(lc.form, 'layr')
      assert.equal(lc.kids[0].id, 'flgs'); assert.equal(lc.kids[0].body[3], 0x98)
      const ll = parseLoda(lc.kids[1], 'layer')
      const lname = utf16z(ll.args.find((a) => a.type === 1000).body, 'layer name')
      const g = ll.args.find((a) => a.type === 40050); if (lean) assert.ok(!g); else assert.equal(g.body.length, 16)
      const layer = { name: lname, type: lc.kids[0].body[0], objects: 0, groups: 0, texts: 0, images: 0, curves: 0 }
      const walk = (list, depth) => {
        for (const oc of list) {
          assert.equal(oc.id, 'LIST')
          if (oc.form === 'grp ') {
            assert.equal(oc.kids[0].id, 'flgs'); assert.equal(oc.kids[0].body[3], 0x10)
            let i = 1
            if (oc.kids[i].id === 'loda') { parseLoda(oc.kids[i], 'group'); i++ }
            assert.equal(oc.kids[i].id, 'trfd'); strictTrfd(oc.kids[i]); i++
            assert.equal(oc.kids[i].id, 'bbox'); assert.equal(oc.kids[i].body.length, 16); i++
            const rest = oc.kids.slice(i)
            assert.ok(rest.length > 0, 'a group has children')
            layer.groups++
            walk(rest, depth + 1)
            continue
          }
          assert.equal(oc.form, 'obj ')
          layer.objects++
          assert.equal(oc.kids[0].id, 'flgs'); assert.equal(oc.kids[0].body[3], 0x08)
          const lo = parseLoda(oc.kids[1], 'object')
          const ids = oc.kids.map((k) => k.id)
          assert.deepEqual(ids.filter((x) => x !== 'txsm'), lean ? ['flgs', 'loda', 'trfd', 'bbox'] : ['flgs', 'loda', 'trfd', 'bbox', 'obbx', 'usdn'], 'object chunks')
          strictTrfd(oc.kids.find((k) => k.id === 'trfd'))
          const argT = lo.args.map((a) => a.type)
          assert.deepEqual(argT.slice(0, 3), [30, 20, 10], 'argument order')
          const fid = new R(lo.args[1].body, 'fill arg').u32(), oid = new R(lo.args[2].body, 'outline arg').u32()
          assert.ok(fills.has(fid), `fill ${fid} exists`); assert.ok(outls.has(oid), `outline ${oid} exists`)
          for (const a of lo.args.slice(3)) { if (a.type === 1000) utf16z(a.body, 'name'); else { assert.equal(a.type, 8000); assert.equal(a.body.length, 16) } }
          const bb = new R(oc.kids.find((k) => k.id === 'bbox').body, 'bbox'), x0 = bb.i32(), y0 = bb.i32(), x1 = bb.i32(), y1 = bb.i32()
          assert.ok(x0 <= x1 && y0 <= y1, 'bbox is ordered')
          if (!lean) {
            const ob = new R(oc.kids.find((k) => k.id === 'obbx').body, 'obbx'); assert.equal(ob.left, 32)
            const sid = new R(oc.kids.find((k) => k.id === 'usdn').body, 'usdn').u32(); assert.ok(!staticIds.has(sid), 'unique static id'); staticIds.add(sid)
          }
          const geom = lo.args[0].body, gr = new R(geom, 'geometry')
          if (lo.ctype === 3) { layer.curves++; const n = gr.u32(); parsePoints(gr, n, 'curve'); gr.done() }
          else if (lo.ctype === 4) { layer.texts++; assert.equal(geom.length, 8); const t = parseTxsm(oc.kids.find((k) => k.id === 'txsm').body); assert.ok(fonts.has(t.font)); assert.ok(fills.has(t.fill)) }
          else if (lo.ctype === 5) {
            layer.images++
            gr.skip(16); gr.skip(32); const id = gr.u32(); usedBmps.add(id); assert.ok(bmps.has(id), 'bitmap id resolves'); gr.skip(20)
            const n = gr.u32(); assert.equal(n, 5); const s = parsePoints(gr, n, 'bitmap outline'); assert.equal(s.length, 1); gr.done()
          } else assert.fail(`unexpected object type ${lo.ctype}`)
        }
      }
      walk(lc.kids.slice(2), 0)
      page.layers.push(layer)
    }
    pages.push(page)
  }
  assert.equal(usedBmps.size, bmps.size, 'every bitmap is used')
  assert.equal(pages[0].master, true, 'master page first')
  assert.deepEqual(pages[0].layers.map((l) => [l.name, l.type]), [['Desktop', 8], ['Guides', 10], ['Document Grid', 26]])
  return { version: 1300, pages, fills, outlines: outls, fonts, bitmaps: bmps }
}
function strictTrfd(c) {
  const r = new R(c.body, 'trfd')
  assert.equal(r.u32(), c.body.length, 'trfd length'); assert.equal(r.u32(), 1); assert.equal(r.u32(), 12); assert.equal(r.u32(), 16)
  assert.equal(r.u32(), 1300); assert.equal(r.u32(), 56); assert.equal(r.u16(), 8); r.skip(6)
  for (let i = 0; i < 6; i++) assert.ok(Number.isFinite(r.f64()), 'matrix value is finite')
  r.done()
}
