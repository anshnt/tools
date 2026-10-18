// Pure, DOM-free packet capture parser and summarizer for pcap and pcapng files.
// Used by pcap-summary.js and by the Node tests. Nothing here touches the page.
//
// readPackets(bytes)      -> generator of { ts, linktype, data, capLen, origLen, iface }
// decodePacket(lt, data)  -> { net, src, dst, proto, sport, dport, payload, ... }
// summarizeCapture(bytes, { onProgress, yieldFn, signal }) -> summary object (see Summary.finish)
// parseDns(bytes), parseClientHello(bytes), parseHttpRequest(bytes) are exported for tests.

export const MAX_CAPTURE_BYTES = 500 * 1024 * 1024
const MAX_LIST = 20000 // cap for DNS / TLS / HTTP record lists

export class CaptureError extends Error {}

// ---------- Format detection and packet iteration ----------

const PCAP_MAGIC = { 0xa1b2c3d4: 1e6, 0xa1b23c4d: 1e9 }

/** 'pcap' | 'pcapng' | null */
export function detectFormat(bytes) {
  if (bytes.length < 12) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const le = dv.getUint32(0, true), be = dv.getUint32(0, false)
  if (PCAP_MAGIC[le] || PCAP_MAGIC[be]) return 'pcap'
  if (le === 0x0a0d0d0a) return 'pcapng'
  return null
}

/**
 * Iterate packets of a pcap or pcapng capture. Yields objects with ts (seconds, float), linktype, data (a view into
 * bytes), capLen, origLen and iface. Sets info.truncated if the file ends mid-record; info.format/info.interfaces are filled.
 */
export function* readPackets(bytes, info = {}) {
  const fmt = detectFormat(bytes)
  info.format = fmt
  info.truncated = false
  info.interfaces = []
  info.skippedBlocks = 0
  if (!fmt) throw new CaptureError('This is not a pcap or pcapng capture (the file header is not recognized). Save the capture from Wireshark or tcpdump as .pcap or .pcapng and try again.')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (fmt === 'pcap') yield* readPcap(bytes, dv, info)
  else yield* readPcapng(bytes, dv, info)
}

function* readPcap(bytes, dv, info) {
  if (bytes.length < 24) { info.truncated = true; return }
  const le = !!PCAP_MAGIC[dv.getUint32(0, true)]
  const units = PCAP_MAGIC[dv.getUint32(0, le)]
  info.version = `${dv.getUint16(4, le)}.${dv.getUint16(6, le)}`
  info.littleEndian = le
  info.nanosecond = units === 1e9
  info.snaplen = dv.getUint32(16, le)
  const linktype = dv.getUint32(20, le) & 0x03ffffff
  info.interfaces.push({ linktype, tsUnits: units })
  let off = 24
  while (off + 16 <= bytes.length) {
    const sec = dv.getUint32(off, le), frac = dv.getUint32(off + 4, le)
    const capLen = dv.getUint32(off + 8, le), origLen = dv.getUint32(off + 12, le)
    off += 16
    if (capLen > 0x10000000 || off + capLen > bytes.length) { info.truncated = true; info.offset = bytes.length; return }
    yield { ts: sec + frac / units, linktype, data: bytes.subarray(off, off + capLen), capLen, origLen, iface: 0 }
    off += capLen
    info.offset = off
  }
  if (off < bytes.length) info.truncated = true
  info.offset = bytes.length
}

function* readPcapng(bytes, dv, info) {
  let off = 0
  let le = true
  let ifaces = []
  while (off + 12 <= bytes.length) {
    let type = dv.getUint32(off, le)
    if (type === 0x0a0d0d0a || dv.getUint32(off, !le) === 0x0a0d0d0a) {
      // Section header: the byte-order magic decides endianness for the whole section.
      const bom = dv.getUint32(off + 8, true)
      if (bom === 0x1a2b3c4d) le = true
      else if (bom === 0x4d3c2b1a) le = false
      else throw new CaptureError('This pcapng file has a damaged section header (unknown byte-order magic).')
      type = 0x0a0d0d0a
      ifaces = []
      info.littleEndian = le
    }
    const len = dv.getUint32(off + 4, le)
    if (len < 12 || len % 4 !== 0 || off + len > bytes.length) { info.truncated = true; info.offset = bytes.length; return }
    const body = off + 8, end = off + len - 4
    // Blocks too short for their fixed fields are skipped (reading them would run past the block or the file).
    const minBody = { 1: 8, 2: 20, 3: 4, 6: 20, 0x0a0d0d0a: 8 }[type] || 0
    if (end - body < minBody) { info.skippedBlocks++; off += len; info.offset = off; continue }
    if (type === 0x0a0d0d0a) info.version = `${dv.getUint16(off + 12, le)}.${dv.getUint16(off + 14, le)}`
    if (type === 1) {
      // Interface description block
      const iface = { linktype: dv.getUint16(body, le), snaplen: dv.getUint32(body + 4, le), tsUnits: 1e6, tsOffset: 0, name: '' }
      for (const [code, o, l] of options(dv, body + 8, end, le)) {
        if (code === 9 && l >= 1) {
          const v = bytes[o]
          iface.tsUnits = v & 0x80 ? 2 ** (v & 0x7f) : 10 ** v
        } else if (code === 14 && l >= 8) iface.tsOffset = Number(dv.getBigInt64(o, le))
        else if (code === 2) iface.name = utf8(bytes.subarray(o, o + l))
        else if (code === 3) iface.description = utf8(bytes.subarray(o, o + l))
      }
      ifaces.push(iface)
      info.interfaces.push(iface)
    } else if (type === 6 || type === 2) {
      // Enhanced packet block (6) or obsolete packet block (2)
      const id = type === 6 ? dv.getUint32(body, le) : dv.getUint16(body, le)
      const iface = ifaces[id]
      const hi = dv.getUint32(body + 4, le), lo = dv.getUint32(body + 8, le)
      const capLen = dv.getUint32(body + 12, le), origLen = dv.getUint32(body + 16, le)
      const start = body + 20
      if (!iface || start + capLen > end) { info.skippedBlocks++ } else {
        yield { ts: tsFrom(hi, lo, iface), linktype: iface.linktype, data: bytes.subarray(start, start + capLen), capLen, origLen, iface: id }
      }
    } else if (type === 3) {
      // Simple packet block: interface 0, no timestamp
      const iface = ifaces[0]
      const origLen = dv.getUint32(body, le)
      const capLen = Math.min(origLen, end - (body + 4))
      if (!iface) info.skippedBlocks++
      else yield { ts: NaN, linktype: iface.linktype, data: bytes.subarray(body + 4, body + 4 + capLen), capLen, origLen, iface: 0 }
    }
    off += len
    info.offset = off
  }
  if (off < bytes.length) info.truncated = true
  info.offset = bytes.length
}

function* options(dv, off, end, le) {
  while (off + 4 <= end) {
    const code = dv.getUint16(off, le), len = dv.getUint16(off + 2, le)
    if (code === 0) return
    if (off + 4 + len > end) return
    yield [code, off + 4, len]
    off += 4 + ((len + 3) & ~3)
  }
}

function tsFrom(hi, lo, iface) {
  const units = iface.tsUnits
  if (hi === 0 && lo === 0) return NaN
  if (hi < 0x200000 && Number.isInteger(units)) return (hi * 4294967296 + lo) / units + iface.tsOffset
  const v = (BigInt(hi) << 32n) | BigInt(lo)
  const u = BigInt(Math.round(units))
  return Number(v / u) + Number(v % u) / units + iface.tsOffset
}

const dec = new TextDecoder('utf-8', { fatal: false })
const latin = new TextDecoder('latin1')
const utf8 = (b) => dec.decode(b).replace(/\0+$/, '')

// ---------- Address formatting ----------

export const ipv4 = (b, o) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`
export function ipv6(b, o) {
  const g = []
  for (let i = 0; i < 8; i++) g.push((b[o + i * 2] << 8) | b[o + i * 2 + 1])
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return `::ffff:${ipv4(b, o + 12)}`
  let best = -1, bestLen = 0
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue }
    let j = i
    while (j < 8 && g[j] === 0) j++
    if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i }
    i = j
  }
  const hex = g.map((x) => x.toString(16))
  if (best < 0) return hex.join(':')
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`
}
export const mac = (b, o) => Array.from(b.subarray(o, o + 6), (x) => x.toString(16).padStart(2, '0')).join(':')

// ---------- Packet decoding ----------

export const LINKTYPES = { 0: 'BSD loopback', 1: 'Ethernet', 12: 'Raw IP', 14: 'Raw IP', 101: 'Raw IP', 108: 'OpenBSD loopback', 113: 'Linux cooked (SLL)', 228: 'Raw IPv4', 229: 'Raw IPv6', 276: 'Linux cooked v2 (SLL2)' }
const IP_PROTOS = { 1: 'ICMP', 2: 'IGMP', 6: 'TCP', 17: 'UDP', 41: 'IPv6-in-IPv4', 47: 'GRE', 50: 'ESP', 51: 'AH', 58: 'ICMPv6', 89: 'OSPF', 132: 'SCTP' }

/**
 * Decode one captured frame. Returns { net: 'IPv4'|'IPv6'|'ARP'|'Other', ... }.
 * For IP: src, dst, proto (name), protoNum, ttl, fragment, and for TCP/UDP: sport, dport, payload (Uint8Array), tcpFlags, seq.
 */
export function decodePacket(linktype, d) {
  let off = 0, etype = -1
  switch (linktype) {
    case 1: {
      if (d.length < 14) return { net: 'Other', why: 'short frame' }
      etype = (d[12] << 8) | d[13]
      off = 14
      let vlan = null
      while ((etype === 0x8100 || etype === 0x88a8 || etype === 0x9100) && off + 4 <= d.length) {
        vlan ??= ((d[off] & 0x0f) << 8) | d[off + 1]
        etype = (d[off + 2] << 8) | d[off + 3]
        off += 4
      }
      const r = byEthertype(etype, d, off)
      if (vlan != null) r.vlan = vlan
      return r
    }
    case 113:
      if (d.length < 16) return { net: 'Other', why: 'short frame' }
      return byEthertype((d[14] << 8) | d[15], d, 16)
    case 276:
      if (d.length < 20) return { net: 'Other', why: 'short frame' }
      return byEthertype((d[0] << 8) | d[1], d, 20)
    case 12: case 14: case 101:
      return byVersion(d, 0)
    case 228: return decodeIPv4(d, 0)
    case 229: return decodeIPv6(d, 0)
    case 0: case 108: {
      if (d.length < 4) return { net: 'Other', why: 'short frame' }
      // Address family in host byte order (NULL) or network order (LOOP); either way it is a small number.
      const le = d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24)
      const be = (d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]
      const fam = linktype === 108 ? be : (le > 0 && le < 256 ? le : be)
      if (fam === 2) return decodeIPv4(d, 4)
      if (fam === 24 || fam === 28 || fam === 30 || fam === 10) return decodeIPv6(d, 4)
      return byVersion(d, 4)
    }
    default:
      return { net: 'Other', why: `link type ${linktype}` }
  }
}

function byEthertype(etype, d, off) {
  if (etype === 0x0800) return decodeIPv4(d, off)
  if (etype === 0x86dd) return decodeIPv6(d, off)
  if (etype === 0x0806) return decodeArp(d, off)
  if (etype <= 1500) return { net: 'Other', why: '802.3 / LLC' }
  return { net: 'Other', why: `EtherType 0x${etype.toString(16).padStart(4, '0')}` }
}
function byVersion(d, off) {
  const v = d[off] >> 4
  if (v === 4) return decodeIPv4(d, off)
  if (v === 6) return decodeIPv6(d, off)
  return { net: 'Other', why: 'not IP' }
}

function decodeArp(d, o) {
  if (o + 28 > d.length) return { net: 'ARP', op: 0 }
  const op = (d[o + 6] << 8) | d[o + 7]
  const hlen = d[o + 4], plen = d[o + 5]
  if (hlen !== 6 || plen !== 4) return { net: 'ARP', op }
  return { net: 'ARP', op, senderMac: mac(d, o + 8), src: ipv4(d, o + 14), targetMac: mac(d, o + 18), dst: ipv4(d, o + 24), proto: 'ARP' }
}

function decodeIPv4(d, o) {
  if (o + 20 > d.length || d[o] >> 4 !== 4) return { net: 'Other', why: 'bad IPv4 header' }
  const ihl = (d[o] & 0x0f) * 4
  const total = (d[o + 2] << 8) | d[o + 3]
  const fragOff = ((d[o + 6] & 0x1f) << 8) | d[o + 7]
  const more = !!(d[o + 6] & 0x20)
  const p = d[o + 9]
  const r = { net: 'IPv4', src: ipv4(d, o + 12), dst: ipv4(d, o + 16), protoNum: p, ttl: d[o + 8], fragment: fragOff > 0 || more }
  const end = Math.min(d.length, total >= ihl ? o + total : d.length)
  if (fragOff > 0) { r.proto = IP_PROTOS[p] || `IP proto ${p}`; r.laterFragment = true; return r }
  return transport(r, p, d, o + ihl, end)
}

const V6_EXT = new Set([0, 43, 60, 135, 139, 140])
function decodeIPv6(d, o) {
  if (o + 40 > d.length || d[o] >> 4 !== 6) return { net: 'Other', why: 'bad IPv6 header' }
  const plen = (d[o + 4] << 8) | d[o + 5]
  let next = d[o + 6]
  const r = { net: 'IPv6', src: ipv6(d, o + 8), dst: ipv6(d, o + 24), ttl: d[o + 7] }
  const end = Math.min(d.length, plen ? o + 40 + plen : d.length)
  let p = o + 40
  for (let guard = 0; guard < 12; guard++) {
    if (V6_EXT.has(next)) {
      if (p + 2 > end) break
      const nn = d[p]
      p += (d[p + 1] + 1) * 8
      next = nn
    } else if (next === 44) {
      // Fragment header: only the first fragment carries the transport header.
      if (p + 8 > end) break
      const fo = ((d[p + 2] << 8) | d[p + 3]) >> 3
      r.fragment = true
      if (fo !== 0) { r.protoNum = d[p]; r.proto = IP_PROTOS[d[p]] || `IP proto ${d[p]}`; r.laterFragment = true; return r }
      next = d[p]
      p += 8
    } else if (next === 51) {
      if (p + 2 > end) break
      const nn = d[p]
      p += (d[p + 1] + 2) * 4
      next = nn
    } else break
  }
  r.protoNum = next
  if (next === 59) { r.proto = 'No next header'; return r }
  return transport(r, next, d, p, end)
}

function transport(r, p, d, o, end) {
  r.proto = IP_PROTOS[p] || `IP proto ${p}`
  if (o > end) return r
  if (p === 6 && o + 20 <= end) {
    const doff = (d[o + 12] >> 4) * 4
    r.sport = (d[o] << 8) | d[o + 1]
    r.dport = (d[o + 2] << 8) | d[o + 3]
    r.seq = ((d[o + 4] << 24) | (d[o + 5] << 16) | (d[o + 6] << 8) | d[o + 7]) >>> 0
    r.tcpFlags = d[o + 13]
    r.payload = d.subarray(Math.min(end, o + doff), end)
  } else if (p === 17 && o + 8 <= end) {
    r.sport = (d[o] << 8) | d[o + 1]
    r.dport = (d[o + 2] << 8) | d[o + 3]
    const ulen = (d[o + 4] << 8) | d[o + 5]
    r.payload = d.subarray(o + 8, ulen >= 8 ? Math.min(end, o + ulen) : end)
  } else if ((p === 1 || p === 58) && o + 2 <= end) {
    r.icmpType = d[o]
    r.icmpCode = d[o + 1]
  }
  return r
}

// ---------- Application layer ----------

export const DNS_TYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 35: 'NAPTR', 41: 'OPT', 43: 'DS', 46: 'RRSIG', 47: 'NSEC', 48: 'DNSKEY', 64: 'SVCB', 65: 'HTTPS', 99: 'SPF', 252: 'AXFR', 255: 'ANY', 257: 'CAA' }
const RCODES = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED', 'YXDOMAIN', 'YXRRSET', 'NXRRSET', 'NOTAUTH', 'NOTZONE']

/** Read a (possibly compressed) DNS name at off. Returns [name, nextOffset]. Throws on loops or out-of-range pointers. */
export function readDnsName(b, off) {
  const labels = []
  let next = -1, jumps = 0, p = off, total = 0
  for (;;) {
    if (p >= b.length) throw new Error('DNS name runs past the end')
    const len = b[p]
    if (len === 0) { p++; break }
    if ((len & 0xc0) === 0xc0) {
      if (p + 1 >= b.length) throw new Error('DNS pointer runs past the end')
      if (next < 0) next = p + 2
      p = ((len & 0x3f) << 8) | b[p + 1]
      if (++jumps > 64) throw new Error('DNS name compression loop')
      continue
    }
    if (len & 0xc0) throw new Error('Unsupported DNS label type')
    if (p + 1 + len > b.length) throw new Error('DNS label runs past the end')
    labels.push(latin.decode(b.subarray(p + 1, p + 1 + len)).replace(/[.\\]/g, (c) => '\\' + c))
    total += len + 1
    if (total > 255) throw new Error('DNS name too long')
    p += 1 + len
  }
  return [labels.join('.') || '.', next >= 0 ? next : p]
}

/** Parse a DNS message (no TCP length prefix). Returns null when it does not look like DNS. */
export function parseDns(b) {
  if (b.length < 12) return null
  const id = (b[0] << 8) | b[1]
  const flags = (b[2] << 8) | b[3]
  const qd = (b[4] << 8) | b[5], an = (b[6] << 8) | b[7], ns = (b[8] << 8) | b[9], ar = (b[10] << 8) | b[11]
  if (qd > 64 || an > 512 || ns > 512 || ar > 512) return null
  const msg = { id, response: !!(flags & 0x8000), opcode: (flags >> 11) & 0xf, rcode: RCODES[flags & 0xf] || String(flags & 0xf), questions: [], answers: [] }
  try {
    let p = 12
    for (let i = 0; i < qd; i++) {
      const [name, n] = readDnsName(b, p)
      if (n + 4 > b.length) throw new Error('short question')
      const t = (b[n] << 8) | b[n + 1]
      msg.questions.push({ name, type: DNS_TYPES[t] || `TYPE${t}` })
      p = n + 4
    }
    for (let i = 0; i < an; i++) {
      const [name, n] = readDnsName(b, p)
      if (n + 10 > b.length) throw new Error('short answer')
      const t = (b[n] << 8) | b[n + 1]
      const ttl = ((b[n + 4] << 24) | (b[n + 5] << 16) | (b[n + 6] << 8) | b[n + 7]) >>> 0
      const rdlen = (b[n + 8] << 8) | b[n + 9]
      const rd = n + 10
      if (rd + rdlen > b.length) throw new Error('short rdata')
      msg.answers.push({ name, type: DNS_TYPES[t] || `TYPE${t}`, ttl, data: rdata(b, t, rd, rdlen) })
      p = rd + rdlen
    }
  } catch (e) {
    if (!msg.questions.length) return null
    msg.malformed = e.message
  }
  return msg
}

function rdata(b, t, o, len) {
  if (t === 1 && len === 4) return ipv4(b, o)
  if (t === 28 && len === 16) return ipv6(b, o)
  if (t === 5 || t === 2 || t === 12) return readDnsName(b, o)[0]
  if (t === 15 && len >= 3) return `${(b[o] << 8) | b[o + 1]} ${readDnsName(b, o + 2)[0]}`
  if (t === 33 && len >= 7) return `${(b[o] << 8) | b[o + 1]} ${(b[o + 2] << 8) | b[o + 3]} ${(b[o + 4] << 8) | b[o + 5]} ${readDnsName(b, o + 6)[0]}`
  if (t === 16) {
    const parts = []
    for (let p = o; p < o + len;) { const l = b[p]; parts.push(latin.decode(b.subarray(p + 1, Math.min(o + len, p + 1 + l)))); p += 1 + l }
    return parts.map((s) => JSON.stringify(s)).join(' ')
  }
  if (t === 6) { const [m, n] = readDnsName(b, o); return `${m} ${readDnsName(b, n)[0]}` }
  return `${len} bytes`
}

/** Parse a TLS ClientHello at the start of a TCP payload. Returns { sni, alpn, version } or null. */
export function parseClientHello(b) {
  if (b.length < 9 || b[0] !== 0x16 || b[1] !== 3 || b[5] !== 1) return null
  const hsLen = (b[6] << 16) | (b[7] << 8) | b[8]
  const end = Math.min(b.length, 9 + hsLen)
  let p = 9
  if (p + 34 > end) return { sni: null, alpn: [], version: null, partial: true }
  const legacy = (b[p] << 8) | b[p + 1]
  p += 34 // version + random
  p += 1 + b[p] // session id
  if (p + 2 > end) return { sni: null, alpn: [], version: tlsVersion(legacy), partial: true }
  p += 2 + ((b[p] << 8) | b[p + 1]) // cipher suites
  if (p + 1 > end) return { sni: null, alpn: [], version: tlsVersion(legacy), partial: true }
  p += 1 + b[p] // compression methods
  const out = { sni: null, alpn: [], version: tlsVersion(legacy) }
  if (p + 2 > end) return out
  const extEnd = Math.min(end, p + 2 + ((b[p] << 8) | b[p + 1]))
  p += 2
  while (p + 4 <= extEnd) {
    const type = (b[p] << 8) | b[p + 1], len = (b[p + 2] << 8) | b[p + 3]
    const d = p + 4
    if (d + len > extEnd) { out.partial = true; break }
    if (type === 0 && len >= 5) {
      let q = d + 2
      const listEnd = Math.min(d + len, d + 2 + ((b[d] << 8) | b[d + 1]))
      while (q + 3 <= listEnd) {
        const nt = b[q], nl = (b[q + 1] << 8) | b[q + 2]
        if (nt === 0 && q + 3 + nl <= listEnd) { out.sni = latin.decode(b.subarray(q + 3, q + 3 + nl)); break }
        q += 3 + nl
      }
    } else if (type === 16 && len >= 2) {
      let q = d + 2
      while (q < d + len) { const l = b[q]; out.alpn.push(latin.decode(b.subarray(q + 1, q + 1 + l))); q += 1 + l }
    } else if (type === 43 && len >= 3) {
      const vs = []
      for (let q = d + 1; q + 1 < d + 1 + b[d] && q + 1 < d + len; q += 2) vs.push((b[q] << 8) | b[q + 1])
      const best = vs.filter((v) => (v & 0x0f0f) !== 0x0a0a).sort((x, y) => y - x)[0]
      if (best) out.version = tlsVersion(best)
    }
    p = d + len
  }
  return out
}
const tlsVersion = (v) => ({ 0x0300: 'SSL 3.0', 0x0301: 'TLS 1.0', 0x0302: 'TLS 1.1', 0x0303: 'TLS 1.2', 0x0304: 'TLS 1.3' })[v] || `0x${v.toString(16)}`

const HTTP_RE = /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT|TRACE|PROPFIND) (\S+) HTTP\/1\.[01]\r?\n/
/** Parse an HTTP/1.x request line and Host header at the start of a TCP payload. */
export function parseHttpRequest(b) {
  if (b.length < 14 || b[0] < 0x41 || b[0] > 0x5a) return null
  const head = latin.decode(b.subarray(0, Math.min(b.length, 4096)))
  const m = HTTP_RE.exec(head)
  if (!m) return null
  const host = /\r?\nhost:[ \t]*([^\r\n]*)/i.exec(head)?.[1]?.trim() || ''
  const ua = /\r?\nuser-agent:[ \t]*([^\r\n]*)/i.exec(head)?.[1]?.trim() || ''
  return { method: m[1], target: m[2], host, userAgent: ua }
}

// ---------- Adaptive histogram (constant memory timeline) ----------

class Timeline {
  constructor(n = 512) { this.n = n; this.counts = new Float64Array(n); this.bytes = new Float64Array(n); this.start = NaN; this.width = 0.001 }
  add(ts, size) {
    if (!Number.isFinite(ts)) return
    if (Number.isNaN(this.start)) this.start = ts
    let i = Math.floor((ts - this.start) / this.width)
    if (i < 0) i = 0
    while (i >= this.n) {
      // Double the bucket width: merge pairs into the first half.
      for (let k = 0; k < this.n / 2; k++) {
        this.counts[k] = this.counts[2 * k] + this.counts[2 * k + 1]
        this.bytes[k] = this.bytes[2 * k] + this.bytes[2 * k + 1]
      }
      this.counts.fill(0, this.n / 2)
      this.bytes.fill(0, this.n / 2)
      this.width *= 2
      i = Math.floor((ts - this.start) / this.width)
    }
    this.counts[i]++
    this.bytes[i] += size
  }
  /** Rebin into at most `bins` buckets covering the used range. */
  result(bins = 120) {
    if (Number.isNaN(this.start)) return { start: NaN, width: 0, counts: [], bytes: [] }
    let used = this.n
    while (used > 1 && this.counts[used - 1] === 0) used--
    const group = Math.max(1, Math.ceil(used / bins))
    const counts = [], bytes = []
    for (let i = 0; i < used; i += group) {
      let c = 0, s = 0
      for (let k = i; k < Math.min(used, i + group); k++) { c += this.counts[k]; s += this.bytes[k] }
      counts.push(c); bytes.push(s)
    }
    return { start: this.start, width: this.width * group, counts, bytes }
  }
}

// ---------- Summary ----------

const SERVICES = { 20: 'FTP data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 69: 'TFTP', 80: 'HTTP', 110: 'POP3', 123: 'NTP', 137: 'NetBIOS', 138: 'NetBIOS', 143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 514: 'Syslog', 587: 'SMTP', 636: 'LDAPS', 853: 'DNS over TLS', 993: 'IMAPS', 995: 'POP3S', 1883: 'MQTT', 1900: 'SSDP', 3306: 'MySQL', 3389: 'RDP', 5060: 'SIP', 5353: 'mDNS', 5355: 'LLMNR', 5432: 'PostgreSQL', 6379: 'Redis', 8080: 'HTTP alt', 8443: 'HTTPS alt', 27017: 'MongoDB' }
export const serviceName = (port) => SERVICES[port] || ''

/** Label for the most specific protocol we recognize in a decoded packet. */
export function appLabel(p) {
  if (p.net === 'ARP') return 'ARP'
  if (p.net === 'Other') return 'Other'
  if (p.proto === 'TCP') {
    if (p.dns) return 'DNS'
    if (p.tls || p.sport === 443 || p.dport === 443) return 'TLS'
    if (p.http || p.sport === 80 || p.dport === 80 || p.sport === 8080 || p.dport === 8080) return 'HTTP'
    const s = serviceName(Math.min(p.sport, p.dport)) || serviceName(p.sport) || serviceName(p.dport)
    return s ? `TCP (${s})` : 'TCP'
  }
  if (p.proto === 'UDP') {
    if (p.dns) return p.sport === 5353 || p.dport === 5353 ? 'mDNS' : 'DNS'
    if (p.sport === 443 || p.dport === 443) return 'QUIC'
    const s = serviceName(Math.min(p.sport, p.dport)) || serviceName(p.sport) || serviceName(p.dport)
    return s ? `UDP (${s})` : 'UDP'
  }
  return p.proto || 'IP'
}

export class Summary {
  constructor() {
    this.packets = 0
    this.bytes = 0
    this.captured = 0
    this.first = Infinity
    this.last = -Infinity
    this.noTimestamp = 0
    this.network = new Map()
    this.transport = new Map()
    this.apps = new Map()
    this.linktypes = new Map()
    this.hosts = new Map()
    this.convs = new Map()
    this.dns = []
    this.tls = []
    this.http = []
    this.listCapped = false
    this.timeline = new Timeline()
    this.arp = 0
  }

  add(pkt) {
    const size = pkt.origLen
    this.packets++
    this.bytes += size
    this.captured += pkt.capLen
    if (Number.isFinite(pkt.ts)) { if (pkt.ts < this.first) this.first = pkt.ts; if (pkt.ts > this.last) this.last = pkt.ts } else this.noTimestamp++
    this.timeline.add(pkt.ts, size)
    bump(this.linktypes, LINKTYPES[pkt.linktype] || `Link type ${pkt.linktype}`, size)
    const p = decodePacket(pkt.linktype, pkt.data)
    bump(this.network, p.net === 'Other' ? `Other (${p.why})` : p.net, size)
    if (p.net === 'IPv4' || p.net === 'IPv6') {
      bump(this.transport, p.proto, size)
      this.host(p.src, size, true)
      this.host(p.dst, size, false)
      if (p.payload && p.payload.length) this.app(p, pkt.ts)
      this.conv(p, size, pkt.ts)
    } else if (p.net === 'ARP') {
      bump(this.transport, 'ARP', size)
    }
    bump(this.apps, appLabel(p), size)
    return p
  }

  host(ip, size, sent) {
    let h = this.hosts.get(ip)
    if (!h) this.hosts.set(ip, (h = { ip, packets: 0, bytes: 0, sent: 0, received: 0 }))
    h.packets++
    h.bytes += size
    if (sent) h.sent += size
    else h.received += size
  }

  conv(p, size, ts) {
    const hasPorts = p.sport != null
    const a = hasPorts ? `${p.src}|${p.sport}` : p.src, b = hasPorts ? `${p.dst}|${p.dport}` : p.dst
    const fwd = a <= b
    const key = `${p.proto}|${fwd ? a : b}|${fwd ? b : a}`
    let c = this.convs.get(key)
    if (!c) {
      // The first packet decides who is "A" (usually the client).
      c = { proto: p.proto, a: p.src, aPort: hasPorts ? p.sport : null, b: p.dst, bPort: hasPorts ? p.dport : null, packets: 0, bytes: 0, aToB: 0, bToA: 0, first: ts, last: ts }
      this.convs.set(key, c)
    }
    c.packets++
    c.bytes += size
    if (p.src === c.a && (!hasPorts || p.sport === c.aPort)) c.aToB += size
    else c.bToA += size
    if (Number.isFinite(ts)) {
      if (!(c.first <= ts)) c.first = ts
      if (!(c.last >= ts)) c.last = ts
    }
  }

  push(list, item) {
    if (list.length >= MAX_LIST) { this.listCapped = true; return }
    list.push(item)
  }

  app(p, ts) {
    const pl = p.payload
    const base = { ts, src: p.src, dst: p.dst, sport: p.sport, dport: p.dport }
    const dnsPort = (x) => x === 53 || x === 5353 || x === 5355
    if (p.proto === 'UDP' && (dnsPort(p.sport) || dnsPort(p.dport))) {
      const m = parseDns(pl)
      if (m) { p.dns = m; this.pushDns(base, m) }
    } else if (p.proto === 'TCP') {
      if ((p.sport === 53 || p.dport === 53) && pl.length > 14) {
        const len = (pl[0] << 8) | pl[1]
        const m = parseDns(pl.subarray(2, 2 + len))
        if (m) { p.dns = m; this.pushDns(base, m) }
        return
      }
      if (pl[0] === 0x16) {
        const ch = parseClientHello(pl)
        if (ch) { p.tls = ch; this.push(this.tls, { ...base, ...ch }) }
        return
      }
      const r = parseHttpRequest(pl)
      if (r) { p.http = r; this.push(this.http, { ...base, ...r }) }
    }
  }

  pushDns(base, m) {
    const q = m.questions[0] || { name: '', type: '' }
    this.push(this.dns, {
      ...base, id: m.id, response: m.response, name: q.name, qtype: q.type, rcode: m.response ? m.rcode : '',
      answers: m.answers.map((a) => ({ name: a.name, type: a.type, ttl: a.ttl, data: a.data })), malformed: m.malformed || null,
    })
  }

  finish(info = {}) {
    const duration = Number.isFinite(this.first) && this.last > this.first ? this.last - this.first : 0
    const sortMap = (m) => [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.bytes - x.bytes || y.packets - x.packets)
    const convs = [...this.convs.values()].map((c) => ({ ...c, duration: Number.isFinite(c.first) && Number.isFinite(c.last) ? c.last - c.first : 0 }))
    convs.sort((x, y) => y.bytes - x.bytes)
    // Collapse DNS queries with their responses into lookups keyed by id + name.
    const lookups = []
    const pending = new Map()
    for (const d of this.dns) {
      const k = `${d.id}|${d.name}|${d.response ? d.dst : d.src}`
      if (!d.response) {
        const l = { ts: d.ts, client: d.src, server: d.dst, name: d.name, qtype: d.qtype, rcode: '', answers: [], latency: null, answered: false }
        pending.set(k, l)
        lookups.push(l)
      } else {
        const l = pending.get(k)
        if (l && !l.answered) {
          l.answered = true
          l.rcode = d.rcode
          l.answers = d.answers
          if (Number.isFinite(d.ts) && Number.isFinite(l.ts)) l.latency = d.ts - l.ts
        } else lookups.push({ ts: d.ts, client: d.dst, server: d.src, name: d.name, qtype: d.qtype, rcode: d.rcode, answers: d.answers, latency: null, answered: true })
      }
    }
    return {
      format: info.format, version: info.version, littleEndian: info.littleEndian, nanosecond: info.nanosecond, interfaces: info.interfaces || [],
      truncated: !!info.truncated, capped: !!info.capped, skippedBlocks: info.skippedBlocks || 0,
      packets: this.packets, bytes: this.bytes, captured: this.captured,
      first: Number.isFinite(this.first) ? this.first : null, last: Number.isFinite(this.last) ? this.last : null, duration, noTimestamp: this.noTimestamp,
      linktypes: sortMap(this.linktypes), network: sortMap(this.network), transport: sortMap(this.transport), apps: sortMap(this.apps),
      hosts: [...this.hosts.values()].sort((x, y) => y.bytes - x.bytes),
      conversations: convs,
      dns: this.dns, lookups, tls: this.tls, http: this.http, listCapped: this.listCapped,
      timeline: this.timeline.result(120),
    }
  }
}

function bump(map, key, size) {
  let v = map.get(key)
  if (!v) map.set(key, (v = { packets: 0, bytes: 0 }))
  v.packets++
  v.bytes += size
}

/**
 * Summarize a whole capture. bytes: Uint8Array. Options: onProgress(fraction), yieldFn (awaited every ~20k packets),
 * signal (AbortSignal). Throws CaptureError for unreadable files.
 */
export async function summarizeCapture(bytes, { onProgress, yieldFn, signal } = {}) {
  const info = {}
  const sum = new Summary()
  let n = 0
  for (const pkt of readPackets(bytes, info)) {
    sum.add(pkt)
    if (++n % 20000 === 0) {
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
      onProgress?.(info.offset / bytes.length)
      if (yieldFn) await yieldFn()
    }
  }
  if (!sum.packets && info.truncated) throw new CaptureError('The capture is truncated or damaged: no complete packets could be read.')
  onProgress?.(1)
  return sum.finish(info)
}

// ---------- CSV helpers ----------

export function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

export function conversationsCsv(convs) {
  return toCsv(['protocol', 'address_a', 'port_a', 'address_b', 'port_b', 'packets', 'bytes', 'bytes_a_to_b', 'bytes_b_to_a', 'start', 'duration_s'],
    convs.map((c) => [c.proto, c.a, c.aPort ?? '', c.b, c.bPort ?? '', c.packets, c.bytes, c.aToB, c.bToA, isoTime(c.first), c.duration.toFixed(6)]))
}
export function dnsCsv(lookups) {
  return toCsv(['time', 'client', 'server', 'name', 'type', 'rcode', 'answers', 'latency_ms'],
    lookups.map((l) => [isoTime(l.ts), l.client, l.server, l.name, l.qtype, l.rcode, l.answers.map((a) => `${a.type} ${a.data}`).join('; '), l.latency == null ? '' : (l.latency * 1000).toFixed(3)]))
}
export function isoTime(ts) {
  if (!Number.isFinite(ts)) return ''
  try { return new Date(ts * 1000).toISOString() } catch { return '' }
}
