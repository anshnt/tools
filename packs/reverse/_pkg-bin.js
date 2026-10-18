// Binary format helpers for the app inspector: DER, X.509 and PKCS#7, the APK Signing Block, DEX headers and Mach-O.
// DOM-free (WebCrypto only) so Node tests can import it.

const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }
const hex = (u8, sep = '') => [...u8].map((x) => x.toString(16).padStart(2, '0')).join(sep)
export { hex }

// ---------- DER ----------
export function derRead(b, o) {
  if (o + 2 > b.length) fail('Truncated certificate data.')
  const tag = b[o]
  let len = b[o + 1]
  let p = o + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) fail('Unsupported DER length in certificate data.')
    len = 0
    for (let i = 0; i < n; i++) len = len * 256 + b[p++]
  }
  if (p + len > b.length) fail('Truncated certificate data.')
  return { tag, hdr: o, start: p, end: p + len }
}
export function derChildren(b, el) {
  const out = []
  for (let o = el.start; o < el.end;) { const c = derRead(b, o); out.push(c); o = c.end }
  return out
}
export function oidText(b, el) {
  const s = b.subarray(el.start, el.end)
  if (!s.length) return ''
  const parts = [Math.floor(s[0] / 40), s[0] % 40]
  let v = 0
  for (let i = 1; i < s.length; i++) { v = v * 128 + (s[i] & 0x7f); if (!(s[i] & 0x80)) { parts.push(v); v = 0 } }
  if (s[0] >= 80) { parts[0] = 2; parts[1] = s[0] - 80 }
  return parts.join('.')
}

const OIDS = {
  '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'serialNumber', '2.5.4.9': 'street',
  '2.5.4.12': 'title', '2.5.4.4': 'SN', '2.5.4.42': 'GN', '1.2.840.113549.1.9.1': 'emailAddress', '0.9.2342.19200300.100.1.1': 'UID', '0.9.2342.19200300.100.1.25': 'DC',
}
const SIG_ALGS = {
  '1.2.840.113549.1.1.4': 'MD5 with RSA', '1.2.840.113549.1.1.5': 'SHA-1 with RSA', '1.2.840.113549.1.1.11': 'SHA-256 with RSA', '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
  '1.2.840.113549.1.1.13': 'SHA-512 with RSA', '1.2.840.113549.1.1.10': 'RSA-PSS', '1.2.840.10045.4.1': 'ECDSA with SHA-1', '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384', '1.2.840.10045.4.3.4': 'ECDSA with SHA-512', '1.2.840.10040.4.3': 'DSA with SHA-1', '2.16.840.1.101.3.4.3.2': 'DSA with SHA-256',
  '1.3.101.112': 'Ed25519',
}
const KEY_ALGS = { '1.2.840.113549.1.1.1': 'RSA', '1.2.840.10045.2.1': 'EC', '1.2.840.10040.4.1': 'DSA', '1.3.101.112': 'Ed25519', '1.3.101.110': 'X25519' }
const CURVES = { '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384', '1.3.132.0.35': 'P-521', '1.3.132.0.10': 'secp256k1' }

function derString(b, el) {
  const s = b.subarray(el.start, el.end)
  if (el.tag === 0x1e) { let r = ''; for (let i = 0; i + 1 < s.length; i += 2) r += String.fromCharCode((s[i] << 8) | s[i + 1]); return r } // BMPString
  if (el.tag === 0x0c || el.tag === 0x13 || el.tag === 0x16) return new TextDecoder().decode(s)
  return String.fromCharCode(...s) // T61/Teletex and others: latin1
}
function nameText(b, el) {
  const out = []
  for (const set of derChildren(b, el)) for (const atv of derChildren(b, set)) {
    const [o, v] = derChildren(b, atv)
    const k = OIDS[oidText(b, o)] || oidText(b, o)
    out.push(`${k}=${derString(b, v)}`)
  }
  return out.join(', ')
}
function timeOf(b, el) {
  const s = String.fromCharCode(...b.subarray(el.start, el.end))
  let y, rest
  if (el.tag === 0x17) { y = +s.slice(0, 2); y += y < 50 ? 2000 : 1900; rest = s.slice(2) } else { y = +s.slice(0, 4); rest = s.slice(4) }
  const [mo, d, hh, mm, ss] = [0, 2, 4, 6, 8].map((i) => +rest.slice(i, i + 2) || 0)
  return new Date(Date.UTC(y, mo - 1, d, hh, mm, ss))
}

/** Parse an X.509 certificate (DER). Fingerprints are computed with WebCrypto. */
export async function parseCertificate(der) {
  const b = der
  const cert = derRead(b, 0)
  const [tbs, sigAlg] = derChildren(b, cert)
  let f = derChildren(b, tbs)
  let version = 1
  if (f[0].tag === 0xa0) { version = b[derChildren(b, f[0])[0].start] + 1; f = f.slice(1) }
  const [serial, , issuer, validity, subject, spki] = f
  const [nb, na] = derChildren(b, validity)
  const [algSeq, bits] = derChildren(b, spki)
  const algKids = derChildren(b, algSeq)
  const keyOid = oidText(b, algKids[0])
  let keyType = KEY_ALGS[keyOid] || keyOid
  let keyBits = null
  if (keyType === 'RSA') {
    try { const rsa = derRead(b, bits.start + 1); const [mod] = derChildren(b, rsa); let n = mod.end - mod.start; if (b[mod.start] === 0) n--; keyBits = n * 8 } catch { /* odd key */ }
  } else if (keyType === 'EC' && algKids[1]?.tag === 0x06) keyType = `EC ${CURVES[oidText(b, algKids[1])] || oidText(b, algKids[1])}`
  const raw = b.slice(cert.hdr, cert.end)
  const [s256, s1] = await Promise.all([crypto.subtle.digest('SHA-256', raw), crypto.subtle.digest('SHA-1', raw)])
  const notBefore = timeOf(b, nb), notAfter = timeOf(b, na)
  let serialBytes = b.subarray(serial.start, serial.end)
  if (serialBytes.length > 1 && serialBytes[0] === 0) serialBytes = serialBytes.subarray(1)
  const subjectText = nameText(b, subject), issuerText = nameText(b, issuer)
  return {
    version, serial: hex(serialBytes, ':'), subject: subjectText, issuer: issuerText, notBefore, notAfter,
    sigAlg: SIG_ALGS[oidText(b, derChildren(b, sigAlg)[0])] || oidText(b, derChildren(b, sigAlg)[0]),
    keyType, keyBits, selfSigned: subjectText === issuerText,
    sha256: hex(new Uint8Array(s256), ':').toUpperCase(), sha1: hex(new Uint8Array(s1), ':').toUpperCase(),
    debug: /CN=Android Debug/.test(subjectText), der: raw,
  }
}

/** Certificates inside a PKCS#7 / CMS SignedData blob (META-INF/*.RSA, *.DSA, *.EC). Returns DER Uint8Arrays. */
export function pkcs7Certificates(b) {
  const ci = derRead(b, 0)
  const [oid, wrapped] = derChildren(b, ci)
  if (oidText(b, oid) !== '1.2.840.113549.1.7.2') fail('The signature file is not PKCS#7 SignedData.')
  const sd = derRead(b, wrapped.start)
  const certs = []
  for (const k of derChildren(b, sd)) {
    if (k.tag === 0xa0) for (const c of derChildren(b, k)) if (c.tag === 0x30) certs.push(b.slice(c.hdr, c.end))
  }
  return certs
}

// ---------- ZIP end records and the APK Signing Block ----------
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 2 ** 32
const MAGIC = 'APK Sig Block 42'
export const SIG_IDS = { 0x7109871a: 'v2', 0xf05368c0: 'v3', 0x1b93ad61: 'v3.1', 0x6dff800d: 'source stamp', 0x2146444e: 'Play metadata', 0x42726577: 'padding', 0x504b4453: 'dependency info' }

/** Find the central directory offset from the tail of a ZIP (the last ~64 KB). Returns {cdOffset, cdSize} or null. */
export function findEocd(tail, tailStart) {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      return { cdOffset: u32(tail, i + 16), cdSize: u32(tail, i + 12), eocdOffset: tailStart + i }
    }
  }
  return null
}

/**
 * Read the APK Signing Block that sits right before the central directory.
 * `readRange(start, end)` returns a Promise<Uint8Array> (for a File: blob.slice().arrayBuffer()).
 * Returns null when there is no block, else {schemes: ['v2', 'v3'], blocks: [{id, name, size}], certs: [{scheme, der}]}.
 */
export async function readApkSigningBlock(readRange, fileSize) {
  const tailStart = Math.max(0, fileSize - 65557)
  const eocd = findEocd(await readRange(tailStart, fileSize), tailStart)
  if (!eocd || eocd.cdOffset < 32) return null
  const foot = await readRange(eocd.cdOffset - 24, eocd.cdOffset)
  if (String.fromCharCode(...foot.subarray(8, 24)) !== MAGIC) return null
  const size = u64(foot, 0)
  const start = eocd.cdOffset - size - 8
  if (start < 0 || size > 64 * 1024 * 1024) return { schemes: [], blocks: [], certs: [], damaged: true }
  const blk = await readRange(start, eocd.cdOffset)
  const blocks = [], certs = [], schemes = []
  let o = 8
  const end = blk.length - 24
  while (o + 12 <= end) {
    const len = u64(blk, o)
    if (len < 4 || o + 8 + len > end) break
    const id = u32(blk, o + 8)
    const name = SIG_IDS[id] || '0x' + id.toString(16)
    blocks.push({ id, name, size: len - 4 })
    if (id === 0x7109871a || id === 0xf05368c0 || id === 0x1b93ad61) {
      schemes.push(name)
      try { certs.push(...signerCerts(blk.subarray(o + 12, o + 8 + len)).map((der) => ({ scheme: name, der }))) } catch { /* unreadable signer */ }
    }
    o += 8 + len
  }
  return { schemes, blocks, certs }
}

// v2/v3 value: lp(signers) where each signer = lp(signedData = lp(digests), lp(certificates = lp(cert)...), ...)
function signerCerts(v) {
  // Clamp to the value so a damaged length cannot make the loops below walk billions of empty bytes.
  const lp = (b, o) => { const n = u32(b, o); return { s: o + 4, e: Math.min(b.length, o + 4 + n) } }
  const out = []
  const signers = lp(v, 0)
  for (let o = signers.s; o < signers.e;) {
    const signer = lp(v, o)
    const sd = lp(v, signer.s)
    const digests = lp(v, sd.s)
    const certsSeq = lp(v, digests.e)
    for (let c = certsSeq.s; c < certsSeq.e;) { const one = lp(v, c); out.push(v.slice(one.s, one.e)); c = one.e }
    o = signer.e
  }
  return out
}

// ---------- DEX ----------
/** Read a DEX header: version and table sizes. */
export function parseDexHeader(b) {
  if (b.length < 112 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'dex\n') fail('Not a DEX file.')
  const version = String.fromCharCode(b[4], b[5], b[6])
  return {
    version, checksum: '0x' + u32(b, 8).toString(16).padStart(8, '0'), signature: hex(b.subarray(12, 32)), fileSize: u32(b, 32), headerSize: u32(b, 36),
    endian: u32(b, 40) === 0x12345678 ? 'little' : 'big',
    strings: u32(b, 56), types: u32(b, 64), protos: u32(b, 72), fields: u32(b, 80), methods: u32(b, 88), classes: u32(b, 96), dataSize: u32(b, 104),
  }
}

// ---------- Mach-O ----------
const CPU = { 7: 'x86', 0x01000007: 'x86_64', 12: 'arm', 0x0100000c: 'arm64', 0x0200000c: 'arm64_32', 18: 'ppc', 0x01000012: 'ppc64' }
const FILETYPE = { 1: 'object', 2: 'executable', 6: 'dylib', 8: 'bundle', 0xb: 'kext', 9: 'dylib stub', 0xa: 'dSYM' }
const PLATFORM = { 1: 'macOS', 2: 'iOS', 3: 'tvOS', 4: 'watchOS', 6: 'Mac Catalyst', 7: 'iOS Simulator', 8: 'tvOS Simulator', 9: 'watchOS Simulator', 11: 'visionOS', 12: 'visionOS Simulator' }
const ver = (v) => `${v >>> 16}.${(v >> 8) & 0xff}${v & 0xff ? '.' + (v & 0xff) : ''}`

function cpuName(type, sub) {
  const base = CPU[type] || `cpu ${type}`
  if (type === 0x0100000c && (sub & 0xff) === 2) return 'arm64e'
  if (type === 12) return { 9: 'armv7', 11: 'armv7s', 12: 'armv7k', 6: 'armv6' }[sub & 0xff] || 'arm'
  return base
}

/** Parse a Mach-O (thin or fat). Returns {fat, arches: [{cpu, fileType, ncmds, flags, pie, encrypted, cryptid, dylibs, rpaths, uuid, minOS, sdk, platform, codeSignature, entitlements}]} */
export function parseMachO(b) {
  if (b.length < 32) fail('This file is too small to be a Mach-O binary.')
  const dvb = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const magic = dvb.getUint32(0, false)
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const n = dvb.getUint32(4, false)
    if (n > 30) fail('Not a Mach-O binary (this looks like a Java class file).')
    const is64 = magic === 0xcafebabf
    const arches = []
    for (let i = 0; i < n; i++) {
      const o = 8 + i * (is64 ? 32 : 20)
      const off = is64 ? Number(dvb.getBigUint64(o + 8, false)) : dvb.getUint32(o + 8, false)
      const size = is64 ? Number(dvb.getBigUint64(o + 16, false)) : dvb.getUint32(o + 12, false)
      try { arches.push({ ...thin(b.subarray(off, off + size)), offset: off, size }) } catch (e) { arches.push({ cpu: cpuName(dvb.getUint32(o, false), dvb.getUint32(o + 4, false)), error: e.message, offset: off, size }) }
    }
    return { fat: true, arches }
  }
  return { fat: false, arches: [{ ...thin(b), offset: 0, size: b.length }] }
}

function thin(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const m = dv.getUint32(0, true)
  let le = true, is64
  if (m === 0xfeedface) is64 = false
  else if (m === 0xfeedfacf) is64 = true
  else if (m === 0xcefaedfe || m === 0xcffaedfe) { le = false; is64 = m === 0xcffaedfe }
  else fail('Not a Mach-O binary.')
  const g = (o) => dv.getUint32(o, le)
  const cputype = g(4), sub = g(8), filetype = g(12), ncmds = g(16), flags = g(24)
  const r = { cpu: cpuName(cputype, sub), bits: is64 ? 64 : 32, fileType: FILETYPE[filetype] || String(filetype), ncmds, flags, pie: (flags & 0x200000) !== 0,
    encrypted: false, cryptid: null, dylibs: [], rpaths: [], uuid: null, minOS: null, sdk: null, platform: null, codeSignature: null, entitlements: null, entry: null }
  const cstr = (o, max) => { let s = ''; for (let i = o; i < max && b[i]; i++) s += String.fromCharCode(b[i]); return s }
  let o = is64 ? 32 : 28
  for (let i = 0; i < ncmds && o + 8 <= b.length; i++) {
    const cmd = g(o), size = g(o + 4)
    if (size < 8) break
    const end = Math.min(o + size, b.length)
    switch (cmd >>> 0) {
      case 0x21: case 0x2c: r.cryptid = g(o + 16); r.encrypted = r.cryptid !== 0; break // LC_ENCRYPTION_INFO(_64)
      case 0xc: case 0x80000018: case 0x8000001f: case 0x80000023: // LC_LOAD_DYLIB, WEAK, REEXPORT, LAZY
        r.dylibs.push({ name: cstr(o + g(o + 8), end), weak: cmd >>> 0 === 0x80000018, current: ver(g(o + 16)) }); break
      case 0x8000001c: r.rpaths.push(cstr(o + g(o + 8), end)); break
      case 0x1b: r.uuid = hex(b.subarray(o + 8, o + 24)).toUpperCase().replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-'); break
      case 0x32: r.platform = PLATFORM[g(o + 8)] || String(g(o + 8)); r.minOS = ver(g(o + 12)); r.sdk = ver(g(o + 16)); break
      case 0x25: r.platform = 'iOS'; r.minOS = ver(g(o + 8)); r.sdk = ver(g(o + 12)); break
      case 0x24: r.platform = 'macOS'; r.minOS = ver(g(o + 8)); r.sdk = ver(g(o + 12)); break
      case 0x2f: r.platform = 'tvOS'; r.minOS = ver(g(o + 8)); r.sdk = ver(g(o + 12)); break
      case 0x30: r.platform = 'watchOS'; r.minOS = ver(g(o + 8)); r.sdk = ver(g(o + 12)); break
      case 0x1d: r.codeSignature = { offset: g(o + 8), size: g(o + 12) }; break
      case 0x80000028: r.entry = true; break
      default: break
    }
    o += size
  }
  if (r.codeSignature) {
    try { r.entitlements = codeSignEntitlements(b, r.codeSignature.offset, r.codeSignature.size) } catch { /* unsigned or odd signature */ }
  }
  return r
}

// Code signature SuperBlob (big-endian). The entitlements blob (0xfade7171) holds an XML plist.
function codeSignEntitlements(b, off, size) {
  if (off + 12 > b.length) return null
  const dv = new DataView(b.buffer, b.byteOffset + off, Math.min(size, b.length - off))
  if (dv.getUint32(0) !== 0xfade0cc0) return null
  const count = dv.getUint32(8)
  for (let i = 0; i < count; i++) {
    const bo = dv.getUint32(12 + i * 8 + 4)
    if (bo + 8 > dv.byteLength) continue
    if (dv.getUint32(bo) === 0xfade7171) {
      const len = dv.getUint32(bo + 4)
      return new TextDecoder().decode(b.subarray(off + bo + 8, off + bo + len))
    }
  }
  return null
}
