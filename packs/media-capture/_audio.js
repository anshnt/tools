// Audio and container helpers for the recorders: WAV encoding, Opus in WebM or Ogg (via WebCodecs), peaks and
// silence detection, and a fix for the missing duration in WebM files that MediaRecorder writes.
// Everything here is pure data in, data out (no DOM), so it can be tested on its own.

const enc = new TextEncoder()
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

// ---------- WAV ----------

/** 16-bit PCM WAV from Int16 samples (interleaved when channels > 1). */
export function encodeWav(samples, sampleRate, channels = 1) {
  const bytes = samples.length * 2
  const buf = new ArrayBuffer(44 + bytes)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, bytes, true)
  new Int16Array(buf, 44).set(samples)
  return new Blob([buf], { type: 'audio/wav' })
}

export function floatToInt16(f32) {
  const out = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

export function int16ToFloat(i16, start = 0, end = i16.length) {
  const out = new Float32Array(end - start)
  for (let i = 0; i < out.length; i++) out[i] = i16[start + i] / 0x8000
  return out
}

/** Linear-interpolation resample of mono Int16 (fine for speech and notes; use 48000 as the source for best results). */
export function resampleInt16(src, from, to) {
  if (from === to) return src
  const n = Math.max(1, Math.round(src.length * to / from))
  const out = new Int16Array(n)
  const step = from / to
  for (let i = 0; i < n; i++) {
    const p = i * step, k = Math.floor(p), f = p - k
    const a = src[Math.min(k, src.length - 1)], b = src[Math.min(k + 1, src.length - 1)]
    out[i] = a + (b - a) * f
  }
  return out
}

/** Resample mono Int16 with the browser's own resampler (properly filtered); falls back to linear interpolation. */
export async function resample(src, from, to) {
  if (from === to) return src
  try {
    const off = new OfflineAudioContext(1, Math.max(1, Math.round(src.length * to / from)), to)
    const buf = off.createBuffer(1, src.length, from)
    buf.copyToChannel(int16ToFloat(src), 0)
    const node = off.createBufferSource()
    node.buffer = buf
    node.connect(off.destination)
    node.start()
    return floatToInt16((await off.startRendering()).getChannelData(0))
  } catch {
    return resampleInt16(src, from, to)
  }
}

/** Peak (0..1) per bucket for drawing a waveform. */
export function peaks(i16, buckets) {
  const out = new Float32Array(buckets)
  const per = i16.length / buckets
  for (let b = 0; b < buckets; b++) {
    let m = 0
    const s = Math.floor(b * per), e = Math.min(i16.length, Math.max(s + 1, Math.floor((b + 1) * per)))
    for (let i = s; i < e; i++) { const a = Math.abs(i16[i]); if (a > m) m = a }
    out[b] = m / 0x8000
  }
  return out
}

/** First and last sample whose 20 ms window is louder than thresholdDb (dBFS), with padding in seconds. Returns null for silence. */
export function findSpeech(i16, sampleRate, { thresholdDb = -48, pad = 0.15 } = {}) {
  const win = Math.max(1, Math.round(sampleRate * 0.02))
  const limit = Math.pow(10, thresholdDb / 20) * 0x8000
  let first = -1, last = -1
  for (let s = 0; s + win <= i16.length; s += win) {
    let sum = 0
    for (let i = s; i < s + win; i++) sum += i16[i] * i16[i]
    if (Math.sqrt(sum / win) > limit) { if (first < 0) first = s; last = s + win }
  }
  if (first < 0) return null
  const p = Math.round(pad * sampleRate)
  return { start: Math.max(0, first - p), end: Math.min(i16.length, last + p) }
}

/** Copy of a range with a short fade at both cut edges (avoids clicks) and optional peak normalising to targetDb. */
export function prepareClip(i16, start, end, { fadeMs = 8, sampleRate = 48000, normalize = false, targetDb = -1 } = {}) {
  const out = i16.slice(start, end)
  let gain = 1
  if (normalize) {
    let peak = 0
    for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a }
    if (peak > 0) gain = Math.min(Math.pow(10, targetDb / 20) * 0x7fff / peak, 31.6) // never boost more than 30 dB
  }
  const fade = Math.min(Math.round(sampleRate * fadeMs / 1000), out.length >> 1)
  for (let i = 0; i < out.length; i++) {
    let g = gain
    if (i < fade && start > 0) g *= i / fade
    else if (out.length - 1 - i < fade && end < i16.length) g *= (out.length - 1 - i) / fade
    if (g !== 1) out[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * g)))
  }
  return out
}

// ---------- Opus via WebCodecs ----------

/** True when this browser can encode Opus with WebCodecs (Chrome, Edge, recent Firefox and Safari). */
export async function canEncodeOpus() {
  try {
    if (typeof AudioEncoder === 'undefined') return false
    const r = await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 48000 })
    return !!r.supported
  } catch { return false }
}

const FRAME = 960 // 20 ms at 48 kHz
export const PRE_SKIP = 312 // libopus look-ahead at 48 kHz

/** Encode mono 48 kHz Int16 samples to Opus packets. Returns { packets: Uint8Array[], samples }. onProgress gets 0..1. */
export async function encodeOpus(i16, { bitrate = 48000, onProgress, signal } = {}) {
  const packets = []
  let failure = null
  const encoder = new AudioEncoder({
    output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); packets.push(b) },
    error: (e) => { failure = e },
  })
  encoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate })
  const step = FRAME * 50
  for (let s = 0; s < i16.length; s += step) {
    if (signal?.aborted) { encoder.close(); throw Object.assign(new Error('Cancelled'), { code: 'ABORT' }) }
    if (failure) throw failure
    const part = i16.subarray(s, Math.min(i16.length, s + step))
    const data = new AudioData({ format: 's16', sampleRate: 48000, numberOfFrames: part.length, numberOfChannels: 1, timestamp: Math.round(s / 48000 * 1e6), data: part })
    encoder.encode(data)
    data.close()
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0))
    onProgress?.(Math.min(1, (s + step) / i16.length) * 0.95)
    await new Promise((r) => setTimeout(r, 0))
  }
  await encoder.flush()
  encoder.close()
  if (failure) throw failure
  onProgress?.(1)
  return { packets, samples: i16.length }
}

const opusHead = (channels, inputRate) => {
  const b = new Uint8Array(19)
  b.set(enc.encode('OpusHead'))
  const v = new DataView(b.buffer)
  b[8] = 1; b[9] = channels; v.setUint16(10, PRE_SKIP, true); v.setUint32(12, inputRate, true); v.setInt16(16, 0, true); b[18] = 0
  return b
}

// ---------- Ogg (Opus) ----------

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; t[i] = r >>> 0 }
  return t
})()

function oggPage(headerType, granule, serial, seq, packets) {
  const lacing = []
  for (const p of packets) {
    let n = p.length
    while (n >= 255) { lacing.push(255); n -= 255 }
    lacing.push(n)
  }
  const head = new Uint8Array(27 + lacing.length)
  const v = new DataView(head.buffer)
  head.set(enc.encode('OggS'))
  head[5] = headerType
  v.setBigUint64(6, BigInt(granule), true)
  v.setUint32(14, serial, true); v.setUint32(18, seq, true)
  head[26] = lacing.length
  head.set(lacing, 27)
  const page = concat([head, ...packets])
  let crc = 0
  for (let i = 0; i < page.length; i++) crc = ((crc << 8) ^ CRC[((crc >>> 24) ^ page[i]) & 0xff]) >>> 0
  new DataView(page.buffer).setUint32(22, crc, true)
  return page
}

/** Opus packets -> Ogg Opus file (.ogg / .opus). samples is the real sample count at 48 kHz (trims the encoder padding at the end). */
export function muxOgg({ packets, samples, channels = 1, inputRate = 48000 }) {
  const serial = (Math.random() * 0xffffffff) >>> 0
  const tags = concat([enc.encode('OpusTags'), Uint8Array.of(8, 0, 0, 0), enc.encode('Tools'), Uint8Array.of(0, 0, 0, 0)])
  const pages = [oggPage(0x02, 0, serial, 0, [opusHead(channels, inputRate)]), oggPage(0, 0, serial, 1, [tags])]
  let seq = 2
  const perPage = 40
  for (let i = 0; i < packets.length; i += perPage) {
    const group = packets.slice(i, i + perPage)
    const last = i + perPage >= packets.length
    const granule = last ? PRE_SKIP + samples : (i + group.length) * FRAME
    pages.push(oggPage(last ? 0x04 : 0, granule, serial, seq++, group))
  }
  return new Blob(pages, { type: 'audio/ogg' })
}

// ---------- EBML / WebM ----------

const idBytes = (id) => { const o = []; for (let x = id; x > 0; x = Math.floor(x / 256)) o.unshift(x % 256); return Uint8Array.from(o) }
function sizeBytes(n, fixed8 = false) {
  let len = 1
  while (!fixed8 && n >= Math.pow(2, 7 * len) - 1 && len < 8) len++
  if (fixed8) len = 8
  const out = new Uint8Array(len)
  let x = n
  for (let i = len - 1; i >= 0; i--) { out[i] = x % 256; x = Math.floor(x / 256) }
  out[0] |= 0x80 >> (len - 1)
  return out
}
const ebml = (id, ...payload) => { const body = concat(payload); return concat([idBytes(id), sizeBytes(body.length), body]) }
const uintBytes = (n) => { const o = []; let x = n; do { o.unshift(x % 256); x = Math.floor(x / 256) } while (x > 0); return Uint8Array.from(o) }
const f64 = (x) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); return b }

/** Opus packets -> WebM (Matroska) audio file with a duration and a seek index. */
export function muxWebm({ packets, samples, channels = 1, inputRate = 48000 }) {
  const durationMs = samples / 48000 * 1000
  const header = ebml(0x1a45dfa3, ebml(0x4286, uintBytes(1)), ebml(0x42f7, uintBytes(1)), ebml(0x42f2, uintBytes(4)), ebml(0x42f3, uintBytes(8)),
    ebml(0x4282, enc.encode('webm')), ebml(0x4287, uintBytes(4)), ebml(0x4285, uintBytes(2)))
  const info = ebml(0x1549a966, ebml(0x2ad7b1, uintBytes(1000000)), ebml(0x4489, f64(durationMs)), ebml(0x4d80, enc.encode('Tools')), ebml(0x5741, enc.encode('Tools')))
  const tracks = ebml(0x1654ae6b, ebml(0xae, ebml(0xd7, uintBytes(1)), ebml(0x73c5, uintBytes(1)), ebml(0x83, uintBytes(2)), ebml(0x9c, uintBytes(0)),
    ebml(0x86, enc.encode('A_OPUS')), ebml(0x63a2, opusHead(channels, inputRate)), ebml(0x56aa, uintBytes(Math.round(PRE_SKIP / 48000 * 1e9))),
    ebml(0x56bb, uintBytes(80000000)), ebml(0xe1, ebml(0xb5, f64(48000)), ebml(0x9f, uintBytes(channels)))))
  const clusters = []
  const cues = []
  let pos = info.length + tracks.length // offset of the next cluster from the start of the segment payload
  const perCluster = 500 // 10 s, comfortably inside the int16 relative timecode
  for (let i = 0; i < packets.length; i += perCluster) {
    const t0 = Math.round(i * 20)
    const blocks = packets.slice(i, i + perCluster).map((p, k) => {
      const rel = k * 20
      return ebml(0xa3, Uint8Array.of(0x81, (rel >> 8) & 0xff, rel & 0xff, 0x80), p)
    })
    const cluster = ebml(0x1f43b675, ebml(0xe7, uintBytes(t0)), ...blocks)
    cues.push(ebml(0xbb, ebml(0xb3, uintBytes(t0)), ebml(0xb7, ebml(0xf7, uintBytes(1)), ebml(0xf1, uintBytes(pos)))))
    clusters.push(cluster)
    pos += cluster.length
  }
  const segment = ebml(0x18538067, info, tracks, ...clusters, ebml(0x1c53bb6b, ...cues))
  return new Blob([header, segment], { type: 'audio/webm' })
}

/**
 * MediaRecorder writes WebM without a duration, so players cannot show a length or seek well. This adds the Duration
 * element to the file's Info block. It only touches live-streamed files (unknown segment size, no seek table) and returns the
 * original blob whenever anything looks different from that.
 */
export async function fixWebmDuration(blob, seconds) {
  try {
    if (!/webm/.test(blob.type) || !(seconds > 0)) return blob
    const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer())
    const readId = (p) => { let len = 1; while (len < 4 && !(head[p] & (0x80 >> (len - 1)))) len++; let id = 0; for (let i = 0; i < len; i++) id = id * 256 + head[p + i]; return [id, len] }
    const readSize = (p) => {
      let len = 1
      while (len < 8 && !(head[p] & (0x80 >> (len - 1)))) len++
      let v = head[p] & (0xff >> len), unknown = v === (0xff >> len)
      for (let i = 1; i < len; i++) { v = v * 256 + head[p + i]; if (head[p + i] !== 0xff) unknown = false }
      return [v, len, unknown]
    }
    let p = 0
    const [id0, l0] = readId(0)
    if (id0 !== 0x1a45dfa3) return blob
    const [s0, sl0] = readSize(l0)
    p = l0 + sl0 + s0
    const [segId, segIdLen] = readId(p)
    if (segId !== 0x18538067) return blob
    const [, segSizeLen, segUnknown] = readSize(p + segIdLen)
    if (!segUnknown) return blob
    p += segIdLen + segSizeLen
    let info = null
    while (p < head.length - 12) {
      const [id, il] = readId(p)
      const [size, sl, unknown] = readSize(p + il)
      if (id === 0x1f43b675 || unknown) break // reached the first cluster
      if (id === 0x114d9b74) return blob // a seek table would need its offsets rewritten
      if (id === 0x1549a966) info = { at: p, hdr: il + sl, size }
      p += il + sl + size
    }
    if (!info || info.at + info.hdr + info.size > head.length) return blob
    // Look inside Info for a timecode scale and an existing duration.
    let scale = 1000000, q = info.at + info.hdr
    const end = q + info.size
    while (q < end) {
      const [id, il] = readId(q)
      const [size, sl] = readSize(q + il)
      if (id === 0x4489) return blob
      if (id === 0x2ad7b1) { scale = 0; for (let i = 0; i < size; i++) scale = scale * 256 + head[q + il + sl + i] }
      q += il + sl + size
    }
    const payload = concat([head.subarray(info.at + info.hdr, end), ebml(0x4489, f64(seconds * 1e9 / scale))])
    const newInfo = concat([idBytes(0x1549a966), sizeBytes(payload.length), payload])
    return new Blob([head.subarray(0, info.at), newInfo, blob.slice(end)], { type: blob.type })
  } catch {
    return blob
  }
}
