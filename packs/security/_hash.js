// Hash algorithms (hash-wasm) with streaming for big files, shared by hash-generator and file-checksum.
import { hashwasm } from '../../lib/libs.js'
import { yieldToMain } from '../../lib/ui.js'
import { toHex, toBase64, toBase64Url } from './_shared.js'

export const FAMILIES = {
  sha2: 'SHA-2',
  sha3: 'SHA-3',
  blake: 'BLAKE',
  legacy: 'Legacy (not safe for security)',
  sum: 'Checksums',
}
/** id, label, family, bits (digest size), make(hashwasm) -> hasher. */
export const ALGOS = [
  { id: 'sha256', label: 'SHA-256', family: 'sha2', bits: 256, make: (w) => w.createSHA256(), note: 'The everyday standard. Used by Git, Bitcoin, TLS and most download pages.' },
  { id: 'sha512', label: 'SHA-512', family: 'sha2', bits: 512, make: (w) => w.createSHA512() },
  { id: 'sha384', label: 'SHA-384', family: 'sha2', bits: 384, make: (w) => w.createSHA384() },
  { id: 'sha224', label: 'SHA-224', family: 'sha2', bits: 224, make: (w) => w.createSHA224() },
  { id: 'sha3-256', label: 'SHA3-256', family: 'sha3', bits: 256, make: (w) => w.createSHA3(256) },
  { id: 'sha3-512', label: 'SHA3-512', family: 'sha3', bits: 512, make: (w) => w.createSHA3(512) },
  { id: 'sha3-384', label: 'SHA3-384', family: 'sha3', bits: 384, make: (w) => w.createSHA3(384) },
  { id: 'sha3-224', label: 'SHA3-224', family: 'sha3', bits: 224, make: (w) => w.createSHA3(224) },
  { id: 'blake3', label: 'BLAKE3', family: 'blake', bits: 256, make: (w) => w.createBLAKE3(256) },
  { id: 'blake2b', label: 'BLAKE2b-512', family: 'blake', bits: 512, make: (w) => w.createBLAKE2b(512) },
  { id: 'blake2s', label: 'BLAKE2s-256', family: 'blake', bits: 256, make: (w) => w.createBLAKE2s(256) },
  { id: 'md5', label: 'MD5', family: 'legacy', bits: 128, make: (w) => w.createMD5(), note: 'MD5 is broken for security (collisions are easy). It is still fine for spotting accidental corruption.' },
  { id: 'sha1', label: 'SHA-1', family: 'legacy', bits: 160, make: (w) => w.createSHA1(), note: 'SHA-1 has practical collision attacks. Use SHA-256 for anything security related.' },
  { id: 'ripemd160', label: 'RIPEMD-160', family: 'legacy', bits: 160, make: (w) => w.createRIPEMD160() },
  { id: 'crc32', label: 'CRC32', family: 'sum', bits: 32, make: (w) => w.createCRC32(), note: 'CRC32 detects accidental errors only. Anyone can forge it.' },
  { id: 'xxh32', label: 'xxHash32', family: 'sum', bits: 32, make: (w) => w.createXXHash32() },
  { id: 'xxh64', label: 'xxHash64', family: 'sum', bits: 64, make: (w) => w.createXXHash64() },
  { id: 'xxh3', label: 'XXH3 (64-bit)', family: 'sum', bits: 64, make: (w) => w.createXXHash3() },
  { id: 'xxh128', label: 'XXH128', family: 'sum', bits: 128, make: (w) => w.createXXHash128() },
]
export const algoById = (id) => ALGOS.find((a) => a.id === id)

/** Output formats. */
export const FORMATS = [['hex', 'hex'], ['HEX', 'HEX'], ['base64', 'Base64']]
export function formatDigest(bytes, fmt = 'hex') {
  if (fmt === 'HEX') return toHex(bytes).toUpperCase()
  if (fmt === 'base64') return toBase64(bytes)
  return toHex(bytes)
}

const abort = () => Object.assign(new Error('Cancelled'), { code: 'ABORT' })

async function makeHashers(ids) {
  const w = await hashwasm()
  const list = []
  for (const id of ids) {
    const hasher = await algoById(id).make(w)
    hasher.init()
    list.push({ id, hasher })
  }
  return list
}
const finish = (list) => Object.fromEntries(list.map(({ id, hasher }) => [id, hasher.digest('binary')]))

/** Hash bytes with each algorithm. Returns { [id]: Uint8Array }. */
export async function hashBytes(bytes, ids = ALGOS.map((a) => a.id)) {
  const list = await makeHashers(ids)
  for (const { hasher } of list) hasher.update(bytes)
  return finish(list)
}

const CHUNK = 4 * 1024 * 1024
/** Stream a File through several hashers at once (one read of the file). onProgress(fraction). */
export async function hashFile(file, ids, { onProgress, signal } = {}) {
  const list = await makeHashers(ids)
  let done = 0
  let last = performance.now()
  while (done < file.size) {
    if (signal?.aborted) throw abort()
    const buf = new Uint8Array(await file.slice(done, done + CHUNK).arrayBuffer())
    for (const { hasher } of list) hasher.update(buf)
    done += buf.length
    if (!buf.length) break
    if (performance.now() - last > 40) { onProgress?.(done / file.size); await yieldToMain(); last = performance.now() }
  }
  onProgress?.(1)
  return finish(list)
}

/** Which hex digest lengths belong to which algorithms. */
export function guessAlgos(hexLength) {
  return ALGOS.filter((a) => a.bits / 4 === hexLength).map((a) => a.id)
}

/** Strip spaces, colons and 0x from a pasted checksum. Returns { clean, isHex }. */
export function cleanChecksum(text) {
  const t = text.trim().replace(/^(?:[a-z0-9-]+\s*[:=]\s*)/i, (m) => (/^(?:sha|md|crc|blake|xx)/i.test(m) ? '' : m))
  const hex = t.replace(/^0x/i, '').replace(/[\s:-]+/g, '')
  if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) return { clean: hex.toLowerCase(), isHex: true }
  return { clean: t.replace(/\s+/g, ''), isHex: false }
}

/** Which of the computed digests equals the pasted checksum? Accepts hex (any case) or Base64 / Base64URL. */
export function matchChecksum(text, digests) {
  const { clean, isHex } = cleanChecksum(text)
  if (!clean) return []
  const out = []
  for (const [id, bytes] of Object.entries(digests)) {
    if (isHex ? toHex(bytes) === clean : (toBase64(bytes) === clean || toBase64(bytes).replace(/=+$/, '') === clean.replace(/=+$/, '') || toBase64Url(bytes) === clean.replace(/=+$/, ''))) out.push(id)
  }
  return out
}

/** Parse a checksum file: "hash  name", "hash *name", BSD "SHA256 (name) = hash" or a lone hash. Returns [{hash, name}] */
export function parseChecksumFile(text) {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    let m = line.match(/^([A-Za-z0-9-]+)\s*\((.+)\)\s*=\s*([0-9a-fA-F]+)$/)
    if (m) { out.push({ hash: m[3].toLowerCase(), name: m[2], algoHint: m[1] }); continue }
    m = line.match(/^([0-9a-fA-F]{8,128})\s+\*?(.+)$/)
    if (m) { out.push({ hash: m[1].toLowerCase(), name: m[2].trim() }); continue }
    m = line.match(/^([0-9a-fA-F]{8,128})$/)
    if (m) out.push({ hash: m[1].toLowerCase(), name: null })
  }
  return out
}
