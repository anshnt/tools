// Readers for the common SFNT tables (name, head, hhea, OS/2, post, cmap, fvar, GSUB/GPOS). DOM-free.
export const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength)
const tagAt = (v, o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
const fixed = (v, o) => v.getInt32(o) / 65536

export const NAME_IDS = {
  0: 'Copyright', 1: 'Family', 2: 'Subfamily', 3: 'Unique ID', 4: 'Full name', 5: 'Version', 6: 'PostScript name', 7: 'Trademark', 8: 'Manufacturer', 9: 'Designer',
  10: 'Description', 11: 'Vendor URL', 12: 'Designer URL', 13: 'License', 14: 'License URL', 16: 'Typographic family', 17: 'Typographic subfamily', 18: 'Compatible full name',
  19: 'Sample text', 21: 'WWS family', 22: 'WWS subfamily', 25: 'Variations PostScript prefix',
}

const utf16be = (b) => { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]); return s }
let mac
function decodeName(platform, bytes) {
  if (platform === 1) { mac ||= new TextDecoder('macintosh'); return mac.decode(bytes) }
  return utf16be(bytes)
}

/** name table -> [{platform, encoding, lang, id, value}] */
export function parseName(t) {
  if (!t || t.length < 6) return []
  const v = dv(t)
  const count = v.getUint16(2), strOff = v.getUint16(4)
  const out = []
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12
    if (r + 12 > t.length) break
    const platform = v.getUint16(r), len = v.getUint16(r + 8), off = strOff + v.getUint16(r + 10)
    if (off + len > t.length) continue
    out.push({ platform, encoding: v.getUint16(r + 2), lang: v.getUint16(r + 4), id: v.getUint16(r + 6), value: decodeName(platform, t.subarray(off, off + len)) })
  }
  return out
}
/** Best English string for a name id (Windows English first, then any Windows, Mac, anything). */
export function pickName(records, id) {
  const of = records.filter((r) => r.id === id && r.value)
  return (of.find((r) => r.platform === 3 && r.lang === 0x409) || of.find((r) => r.platform === 3) || of.find((r) => r.platform === 1 && r.lang === 0) || of[0])?.value || ''
}

export function parseHead(t) {
  if (!t || t.length < 54) return null
  const v = dv(t)
  return {
    fontRevision: fixed(v, 4), flags: v.getUint16(16), unitsPerEm: v.getUint16(18),
    created: Number(v.getBigInt64(20)), modified: Number(v.getBigInt64(28)),
    xMin: v.getInt16(36), yMin: v.getInt16(38), xMax: v.getInt16(40), yMax: v.getInt16(42),
    macStyle: v.getUint16(44), lowestRecPPEM: v.getUint16(46), indexToLocFormat: v.getInt16(50),
  }
}
/** LONGDATETIME (seconds since 1904-01-01) -> Date */
export const fontDate = (secs) => (secs > 0 ? new Date(Date.UTC(1904, 0, 1) + secs * 1000) : null)

export function parseHhea(t) {
  if (!t || t.length < 36) return null
  const v = dv(t)
  return { ascender: v.getInt16(4), descender: v.getInt16(6), lineGap: v.getInt16(8), advanceWidthMax: v.getUint16(10), numberOfHMetrics: v.getUint16(34) }
}
export const parseMaxp = (t) => (t && t.length >= 6 ? { numGlyphs: dv(t).getUint16(4) } : { numGlyphs: 0 })

export function parseOS2(t) {
  if (!t || t.length < 68) return null
  const v = dv(t)
  const o = { version: v.getUint16(0), xAvgCharWidth: v.getInt16(2), weight: v.getUint16(4), width: v.getUint16(6), fsType: v.getUint16(8), panose: [...t.subarray(32, 42)],
    unicodeRange: [42, 46, 50, 54].map((x) => v.getUint32(x)), vendor: String.fromCharCode(...t.subarray(58, 62)).trim(), fsSelection: v.getUint16(62),
    firstChar: v.getUint16(64), lastChar: v.getUint16(66) }
  if (t.length >= 78) Object.assign(o, { typoAscender: v.getInt16(68), typoDescender: v.getInt16(70), typoLineGap: v.getInt16(72), winAscent: v.getUint16(74), winDescent: v.getUint16(76) })
  if (o.version >= 2 && t.length >= 90) Object.assign(o, { xHeight: v.getInt16(86), capHeight: v.getInt16(88) })
  return o
}

export function parsePost(t) {
  if (!t || t.length < 32) return null
  const v = dv(t)
  return { version: fixed(v, 0), italicAngle: fixed(v, 4), underlinePosition: v.getInt16(8), underlineThickness: v.getInt16(10), isFixedPitch: v.getUint32(12) !== 0 }
}

/** cmap -> Map(codePoint -> glyphId), merged from the Unicode subtables. */
export function parseCmap(t) {
  const map = new Map()
  if (!t || t.length < 4) return map
  const v = dv(t)
  const n = v.getUint16(2)
  const subs = []
  for (let i = 0; i < n; i++) {
    const p = v.getUint16(4 + i * 8), e = v.getUint16(6 + i * 8), off = v.getUint32(8 + i * 8)
    if (off + 6 > t.length) continue
    const unicode = p === 0 || (p === 3 && (e === 1 || e === 10))
    // Windows Symbol (3,0) and Mac Roman (1,0) are kept as a last resort so symbol fonts show something.
    if (unicode || (p === 3 && e === 0) || (p === 1 && e === 0)) subs.push({ p, e, off, rank: p === 3 && e === 10 ? 4 : p === 0 ? 3 : p === 3 && e === 1 ? 2 : 1 })
  }
  subs.sort((a, b) => a.rank - b.rank)
  const hasUni = subs.some((s) => s.rank >= 2)
  for (const s of subs) {
    if (hasUni && s.rank < 2) continue
    const fmt = v.getUint16(s.off)
    try {
      if (fmt === 0) for (let c = 0; c < 256; c++) { const g = v.getUint8(s.off + 6 + c); if (g) map.set(c, g) }
      else if (fmt === 4) {
        const segX2 = v.getUint16(s.off + 6), endO = s.off + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2
        for (let i = 0; i < segX2 / 2; i++) {
          const end = v.getUint16(endO + i * 2), start = v.getUint16(startO + i * 2), delta = v.getInt16(deltaO + i * 2), ro = v.getUint16(rangeO + i * 2)
          for (let c = start; c <= end && c < 0xffff; c++) {
            let g
            if (ro === 0) g = (c + delta) & 0xffff
            else {
              const a = rangeO + i * 2 + ro + (c - start) * 2
              if (a + 2 > t.length) continue
              g = v.getUint16(a)
              if (g) g = (g + delta) & 0xffff
            }
            if (g) map.set(c, g)
          }
        }
      } else if (fmt === 6) {
        const first = v.getUint16(s.off + 6), cnt = v.getUint16(s.off + 8)
        for (let i = 0; i < cnt; i++) { const g = v.getUint16(s.off + 10 + i * 2); if (g) map.set(first + i, g) }
      } else if (fmt === 12 || fmt === 13) {
        const ng = v.getUint32(s.off + 12)
        for (let i = 0; i < ng; i++) {
          const o = s.off + 16 + i * 12
          if (o + 12 > t.length) break
          const a = v.getUint32(o), b = v.getUint32(o + 4), g0 = v.getUint32(o + 8)
          if (b < a || b - a > 0x10ffff) continue
          for (let c = a; c <= b; c++) map.set(c, fmt === 12 ? g0 + (c - a) : g0)
        }
      }
    } catch { /* a damaged subtable: keep what we have */ }
  }
  return map
}

/** fvar -> {axes: [{tag, min, def, max, nameId, hidden}], instances: [{nameId, coords}]} or null */
export function parseFvar(t) {
  if (!t || t.length < 16) return null
  const v = dv(t)
  const axOff = v.getUint16(4), axCount = v.getUint16(8), axSize = v.getUint16(10), inCount = v.getUint16(12), inSize = v.getUint16(14)
  const axes = [], instances = []
  for (let i = 0; i < axCount; i++) {
    const o = axOff + i * axSize
    if (o + 20 > t.length) break
    axes.push({ tag: tagAt(v, o), min: fixed(v, o + 4), def: fixed(v, o + 8), max: fixed(v, o + 12), hidden: (v.getUint16(o + 16) & 1) === 1, nameId: v.getUint16(o + 18) })
  }
  for (let i = 0; i < inCount; i++) {
    const o = axOff + axCount * axSize + i * inSize
    if (o + 4 + axCount * 4 > t.length) break
    instances.push({ nameId: v.getUint16(o), coords: axes.map((_, k) => fixed(v, o + 4 + k * 4)) })
  }
  return { axes, instances }
}

/** GSUB / GPOS -> {scripts: [tag], features: [tag]} */
export function parseLayout(t) {
  if (!t || t.length < 10) return { scripts: [], features: [] }
  const v = dv(t)
  const out = { scripts: [], features: [] }
  try {
    const sl = v.getUint16(4), fl = v.getUint16(6)
    const sc = v.getUint16(sl)
    for (let i = 0; i < sc; i++) out.scripts.push(tagAt(v, sl + 2 + i * 6))
    const fc = v.getUint16(fl)
    for (let i = 0; i < fc; i++) out.features.push(tagAt(v, fl + 2 + i * 6))
  } catch { /* partial */ }
  out.scripts = [...new Set(out.scripts)]
  out.features = [...new Set(out.features)]
  return out
}

export const FEATURE_NAMES = {
  liga: 'Standard ligatures', clig: 'Contextual ligatures', dlig: 'Discretionary ligatures', hlig: 'Historical ligatures', calt: 'Contextual alternates', kern: 'Kerning', mark: 'Mark positioning',
  mkmk: 'Mark-to-mark positioning', smcp: 'Small capitals', c2sc: 'Capitals to small capitals', pcap: 'Petite capitals', onum: 'Oldstyle figures', lnum: 'Lining figures', pnum: 'Proportional figures',
  tnum: 'Tabular figures', frac: 'Fractions', afrc: 'Alternative fractions', ordn: 'Ordinals', sups: 'Superscript', subs: 'Subscript', sinf: 'Scientific inferiors', zero: 'Slashed zero',
  salt: 'Stylistic alternates', swsh: 'Swash', cswh: 'Contextual swash', case: 'Case-sensitive forms', cpsp: 'Capital spacing', locl: 'Localized forms', ccmp: 'Glyph composition',
  init: 'Initial forms', medi: 'Medial forms', fina: 'Final forms', isol: 'Isolated forms', rlig: 'Required ligatures', rclt: 'Required contextual alternates', curs: 'Cursive attachment',
  dist: 'Distances', abvm: 'Above-mark positioning', blwm: 'Below-mark positioning', aalt: 'Access all alternates', hist: 'Historical forms', titl: 'Titling', nalt: 'Alternate annotation',
  ital: 'Italics', ruby: 'Ruby notation', vert: 'Vertical writing', vrt2: 'Vertical rotation', halt: 'Alternate half widths', palt: 'Proportional alternate widths', pwid: 'Proportional widths',
  fwid: 'Full widths', hwid: 'Half widths', jp78: 'JIS78 forms', jp83: 'JIS83 forms', jp90: 'JIS90 forms', jp04: 'JIS2004 forms', trad: 'Traditional forms', smpl: 'Simplified forms',
  nlck: 'NLC kanji forms', expt: 'Expert forms', dnom: 'Denominators', numr: 'Numerators', lfbd: 'Left bounds', rtbd: 'Right bounds', opbd: 'Optical bounds', size: 'Optical size',
  ljmo: 'Leading jamo', vjmo: 'Vowel jamo', tjmo: 'Trailing jamo', nukt: 'Nukta forms', akhn: 'Akhands', rphf: 'Reph forms', blwf: 'Below-base forms', half: 'Half forms',
  pstf: 'Post-base forms', vatu: 'Vattu variants', pres: 'Pre-base substitutions', abvs: 'Above-base substitutions', blws: 'Below-base substitutions', psts: 'Post-base substitutions',
  haln: 'Halant forms', cjct: 'Conjunct forms', pref: 'Pre-base forms', rkrf: 'Rakar forms', abvf: 'Above-base forms', ltra: 'Left-to-right alternates', rtla: 'Right-to-left alternates',
  ltrm: 'Left-to-right mirrored', rtlm: 'Right-to-left mirrored', stch: 'Stretching glyph decomposition', mset: 'Mark positioning via substitution', ornm: 'Ornaments', rand: 'Randomize',
  falt: 'Final glyph alternates', jalt: 'Justification alternates',
}
export function featureLabel(tag) {
  if (FEATURE_NAMES[tag]) return FEATURE_NAMES[tag]
  let m = tag.match(/^ss(\d\d)$/); if (m) return `Stylistic set ${+m[1]}`
  m = tag.match(/^cv(\d\d)$/); if (m) return `Character variant ${+m[1]}`
  return ''
}
/** Features a browser turns on by itself; the viewer shows these as already on. */
export const DEFAULT_ON = new Set(['liga', 'clig', 'calt', 'kern', 'ccmp', 'locl', 'mark', 'mkmk', 'rlig', 'rclt', 'curs', 'dist', 'abvm', 'blwm', 'init', 'medi', 'fina', 'isol', 'rtlm', 'ltra', 'ltrm', 'rtla', 'vert', 'vrt2', 'abvs', 'blws', 'psts', 'pres', 'akhn', 'rphf', 'blwf', 'half', 'pstf', 'vatu', 'cjct', 'pref', 'rkrf', 'abvf', 'haln', 'nukt'])

const FS_TYPE = [[0x0002, 'Restricted license embedding'], [0x0004, 'Preview and print embedding'], [0x0008, 'Editable embedding'], [0x0100, 'No subsetting'], [0x0200, 'Bitmap embedding only']]
export const embeddingText = (fsType) => (fsType === 0 ? 'Installable embedding (no restrictions)' : FS_TYPE.filter(([m]) => fsType & m).map(([, n]) => n).join(', ') || 'Unknown')

const WEIGHTS = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' }
export const weightName = (w) => WEIGHTS[w] || String(w)
const WIDTHS = ['', 'Ultra Condensed', 'Extra Condensed', 'Condensed', 'Semi Condensed', 'Medium', 'Semi Expanded', 'Expanded', 'Extra Expanded', 'Ultra Expanded']
export const widthName = (w) => WIDTHS[w] || String(w)

/** Everything the viewer and the @font-face generator need, from a table map. */
export function fontInfo(tables) {
  const names = parseName(tables.get('name'))
  const head = parseHead(tables.get('head'))
  const os2 = parseOS2(tables.get('OS/2'))
  const post = parsePost(tables.get('post'))
  const fvar = parseFvar(tables.get('fvar'))
  const gsub = parseLayout(tables.get('GSUB')), gpos = parseLayout(tables.get('GPOS'))
  const family = pickName(names, 16) || pickName(names, 1) || 'Untitled font'
  const sub = pickName(names, 17) || pickName(names, 2)
  const italic = !!(os2 && os2.fsSelection & 1) || !!(head && head.macStyle & 2) || !!(post && post.italicAngle)
  const bold = !!(os2 && os2.fsSelection & 32) || !!(head && head.macStyle & 1)
  const weight = os2?.weight || (bold ? 700 : 400)
  return {
    names, head, hhea: parseHhea(tables.get('hhea')), maxp: parseMaxp(tables.get('maxp')), os2, post, fvar, gsub, gpos, family, subfamily: sub,
    fullName: pickName(names, 4), psName: pickName(names, 6), version: pickName(names, 5), italic, bold, weight,
    axisName: (a) => pickName(names, a.nameId) || a.tag,
    isCff: tables.has('CFF ') || tables.has('CFF2'), isColor: ['COLR', 'CBDT', 'sbix', 'SVG '].filter((t) => tables.has(t)),
  }
}
