// Pure DSP and math helpers for Audio Studio. No DOM, so they are easy to test.
export const SR = 44100
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
/** Decibels to linear gain; anything at or below the floor is silence. */
export const dbToGain = (db, floor = -60) => (db <= floor ? 0 : 10 ** (db / 20))
export const gainToDb = (g) => (g <= 0.000001 ? -Infinity : 20 * Math.log10(g))
export const fmtDb = (db, digits = 1) => (db === -Infinity || db < -90 ? '-inf dB' : `${db > 0 ? '+' : ''}${db.toFixed(digits)} dB`)

/** 83.256 -> '1:23.256' */
export function fmtClock(t) {
  t = Math.max(0, t || 0)
  let m = Math.floor(t / 60)
  let s = Math.round((t - m * 60) * 1000) / 1000
  if (s >= 60) { m += 1; s -= 60 }
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}
/** Bar.beat.hundredths for a tempo, e.g. '3.2.45'. */
export function fmtBars(t, bpm, beats = 4) {
  const beat = (Math.max(0, t) * bpm) / 60
  const bar = Math.floor(beat / beats) + 1
  const inBar = beat - (bar - 1) * beats
  const b = Math.floor(inBar) + 1
  return `${bar}.${b}.${String(Math.floor((inBar % 1) * 100)).padStart(2, '0')}`
}
/** Short label for ruler ticks: '0:05' or '1:05.5'. */
export function fmtTick(t, step) {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
  t = Math.round(t * 10 ** d) / 10 ** d
  const hh = Math.floor(t / 3600)
  const m = Math.floor((t - hh * 3600) / 60)
  const s = t - hh * 3600 - m * 60
  return `${hh ? `${hh}:${String(m).padStart(2, '0')}` : m}:${s.toFixed(d).padStart(d ? 3 + d : 2, '0')}`
}
const STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
/** Smallest 'nice' time step (seconds) that is at least minSec. */
export const niceStep = (minSec) => STEPS.find((s) => s >= minSec) || STEPS.at(-1)

/** Grid step in seconds for a project grid setting, or 0 when the grid is off. */
export function gridStep(project) {
  const beat = 60 / project.bpm
  return ({ bar: beat * project.beats, '1/4': beat, '1/8': beat / 2, '1/16': beat / 4 })[project.grid] || 0
}

// ---------- Peaks ----------
const BASES = [128, 1024, 8192]
/** Min/max pyramid (mono-merged) used to draw waveforms at any zoom without touching raw samples. */
export function buildPeaks(chans, length) {
  const b0 = BASES[0]
  const cnt0 = Math.ceil(length / b0)
  const min0 = new Float32Array(cnt0)
  const max0 = new Float32Array(cnt0)
  for (let i = 0; i < cnt0; i++) {
    let lo = 1, hi = -1
    const e = Math.min(length, (i + 1) * b0)
    for (const d of chans) for (let j = i * b0; j < e; j++) { const v = d[j]; if (v < lo) lo = v; if (v > hi) hi = v }
    min0[i] = lo
    max0[i] = hi
  }
  const levels = [{ block: b0, min: min0, max: max0 }]
  for (let k = 1; k < BASES.length; k++) {
    const f = BASES[k] / BASES[k - 1]
    const prev = levels[k - 1]
    const cnt = Math.ceil(prev.min.length / f)
    const mn = new Float32Array(cnt)
    const mx = new Float32Array(cnt)
    for (let i = 0; i < cnt; i++) {
      let lo = 1, hi = -1
      const e = Math.min(prev.min.length, (i + 1) * f)
      for (let j = i * f; j < e; j++) { if (prev.min[j] < lo) lo = prev.min[j]; if (prev.max[j] > hi) hi = prev.max[j] }
      mn[i] = lo
      mx[i] = hi
    }
    levels.push({ block: BASES[k], min: mn, max: mx })
  }
  return { levels, length }
}

/** Fill mins/maxs (length n) with the waveform extremes of n columns of spp samples each, starting at startSample. */
export function waveColumns(asset, startSample, spp, n, mins, maxs) {
  const { peaks, chans, length } = asset
  let li = -1
  for (let k = peaks.levels.length - 1; k >= 0; k--) if (peaks.levels[k].block <= spp) { li = k; break }
  for (let i = 0; i < n; i++) {
    const a = Math.floor(startSample + i * spp)
    const b = Math.max(a + 1, Math.floor(startSample + (i + 1) * spp))
    let lo = 1, hi = -1
    if (a >= 0 && a < length) {
      if (li < 0) {
        const e = Math.min(b, length)
        for (const d of chans) for (let j = a; j < e; j++) { const v = d[j]; if (v < lo) lo = v; if (v > hi) hi = v }
      } else {
        const L = peaks.levels[li]
        const e = Math.min(L.min.length, Math.ceil(b / L.block))
        for (let j = Math.floor(a / L.block); j < e; j++) { if (L.min[j] < lo) lo = L.min[j]; if (L.max[j] > hi) hi = L.max[j] }
      }
    }
    if (lo > hi) { lo = 0; hi = 0 }
    mins[i] = lo
    maxs[i] = hi
  }
}

/** Largest absolute sample between two times of an asset (used by Normalize). */
export function peakOf(asset, offset, dur) {
  const a = Math.max(0, Math.floor(offset * asset.sampleRate))
  const b = Math.min(asset.length, Math.ceil((offset + dur) * asset.sampleRate))
  let p = 0
  for (const d of asset.chans) for (let j = a; j < b; j++) { const v = Math.abs(d[j]); if (v > p) p = v }
  return p
}

// ---------- Effects helpers ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Stereo impulse response for the reverb: decaying noise, darkened over time. Deterministic so exports match playback. */
export function impulseData(sampleRate, decay, preDelay = 0.012) {
  const len = Math.max(64, Math.floor(sampleRate * (decay + preDelay)))
  const pre = Math.floor(sampleRate * preDelay)
  const out = []
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(1234 + ch * 77)
    const d = new Float32Array(len)
    let lp = 0
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate
      const env = Math.exp((-6.9 * t) / decay)
      const a = 0.9 - 0.75 * Math.min(1, t / decay) // one-pole lowpass gets darker as the tail dies
      lp += ((rnd() * 2 - 1) - lp) * (1 - a)
      d[i] = lp * env * (i - pre < 40 ? (i - pre) / 40 : 1)
    }
    out.push(d)
  }
  for (const d of out) { // unit energy per channel, so the wet level is set by the Mix control alone
    let e = 0
    for (let i = 0; i < d.length; i++) e += d[i] * d[i]
    const g = e > 0 ? 1 / Math.sqrt(e) : 1
    for (let i = 0; i < d.length; i++) d[i] *= g
  }
  return out
}

/**
 * Gate gain envelope for an asset at 100 Hz (one value per 10 ms hop). RMS over each hop opens the gate above the threshold
 * (dB), holds, and closes with a release; attack and release are smoothed. The curve is applied with setValueCurveAtTime,
 * which also works in OfflineAudioContext, so playback and export match. Ceiling: threshold detection is per clip, not per track mix.
 */
export function gateEnvelope(chans, length, sampleRate, g) {
  const hop = Math.max(1, Math.round(sampleRate / 100))
  const rate = sampleRate / hop
  const n = Math.ceil(length / hop)
  const out = new Float32Array(n)
  const thr = dbToGain(g.threshold, -120)
  const floor = dbToGain(g.range, -120)
  const att = 1 - Math.exp(-1 / (Math.max(g.attack, 0.001) * rate))
  const rel = 1 - Math.exp(-1 / (Math.max(g.release, 0.01) * rate))
  const holdN = Math.round(g.hold * rate)
  let env = floor, open = false, hold = 0
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0
    const e = Math.min(length, (i + 1) * hop)
    for (const d of chans) for (let j = i * hop; j < e; j++) { sum += d[j] * d[j]; cnt++ }
    const lvl = cnt ? Math.sqrt(sum / cnt) : 0
    if (lvl >= thr) { open = true; hold = holdN } else if (open) { if (hold > 0) hold--; else if (lvl < thr * 0.7) open = false }
    env += ((open ? 1 : floor) - env) * (open ? att : rel)
    out[i] = env
  }
  return { env: out, rate }
}

// ---------- WAV ----------
/** Encode channels (Float32Array[]) as a WAV Blob. bits: 16 (with TPDF dither), 24, or 32 (float). */
export function encodeWav(chans, sampleRate, bits = 16) {
  const nch = chans.length
  const len = chans[0].length
  const bytes = bits / 8
  const dataSize = len * nch * bytes
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nch, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nch * bytes, true); v.setUint16(32, nch * bytes, true); v.setUint16(34, bits, true)
  str(36, 'data'); v.setUint32(40, dataSize, true)
  let o = 44
  const rnd = mulberry32(99)
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      let s = chans[c][i]
      if (bits === 32) { v.setFloat32(o, s, true); o += 4; continue }
      s = s > 1 ? 1 : s < -1 ? -1 : s
      if (bits === 16) {
        const x = Math.round(s * 32767 + (rnd() - rnd()) * 0.5)
        v.setInt16(o, x > 32767 ? 32767 : x < -32768 ? -32768 : x, true)
        o += 2
      } else {
        const x = Math.round(s * 8388607)
        v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255)
        o += 3
      }
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

/** Peak of an array of channels. */
export function peakAll(chans) {
  let p = 0
  for (const d of chans) for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > p) p = v }
  return p
}
