// A small generated demo (drums, bass, pad) so you can try the editor without importing anything. Synthesized locally, nothing is downloaded.
import { SR } from './_dsp.js'

/** Returns [{name, samples}] for a few bars at the given tempo. */
export function demoSamples(bpm = 100, bars = 4) {
  const beat = 60 / bpm
  const len = Math.round(SR * beat * 4 * bars)
  const drums = new Float32Array(len), bass = new Float32Array(len), pad = new Float32Array(len)
  let seed = 7
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1
  const at = (t) => Math.floor(t * SR)
  const kick = (t) => { const s = at(t); for (let i = 0; i < SR * 0.3 && s + i < len; i++) { const x = i / SR; drums[s + i] += Math.sin(2 * Math.PI * (52 * x + (110 * (1 - Math.exp(-30 * x))) / 30)) * Math.exp(-x * 12) * 0.9 } }
  const snare = (t) => { const s = at(t); for (let i = 0; i < SR * 0.22 && s + i < len; i++) { const x = i / SR; drums[s + i] += (rnd() * Math.exp(-x * 22) * 0.45 + Math.sin(2 * Math.PI * 190 * x) * Math.exp(-x * 30) * 0.3) } }
  let prev = 0
  const hat = (t, a) => { const s = at(t); for (let i = 0; i < SR * 0.05 && s + i < len; i++) { const n = rnd(); drums[s + i] += (n - prev) * 0.5 * Math.exp((-i / SR) * 90) * a; prev = n } }
  const bassNotes = [55, 55, 82.41, 73.42]
  for (let b = 0; b < bars; b++) {
    for (let k = 0; k < 4; k++) {
      const t = (b * 4 + k) * beat
      if (k === 0 || k === 2) kick(t)
      if (k === 1 || k === 3) snare(t)
      hat(t, 0.5); hat(t + beat / 2, 0.3)
      const f = bassNotes[k] * (b % 2 ? 1.122 : 1)
      const s0 = at(t)
      for (let i = 0; i < SR * beat * 0.9 && s0 + i < len; i++) {
        const x = i / SR
        bass[s0 + i] += (Math.sin(2 * Math.PI * f * x) * 0.55 + Math.sin(4 * Math.PI * f * x) * 0.15) * Math.min(1, x * 80) * Math.exp(-x * 2.2)
      }
    }
    const chord = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]][b % 4]
    const s0 = at(b * 4 * beat)
    const n = Math.min(len - s0, Math.round(SR * beat * 4))
    for (let i = 0; i < n; i++) {
      const x = i / SR
      const env = Math.min(1, x / 0.4) * Math.min(1, (n - i) / (SR * 0.5))
      let v = 0
      for (const f of chord) v += Math.sin(2 * Math.PI * f * x) + 0.3 * Math.sin(2 * Math.PI * f * 2.003 * x)
      pad[s0 + i] += v * 0.06 * env
    }
  }
  const norm = (a, peak) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); if (m > 0) for (let i = 0; i < a.length; i++) a[i] *= peak / m; return a }
  return [{ name: 'Demo drums', samples: norm(drums, 0.85) }, { name: 'Demo bass', samples: norm(bass, 0.8) }, { name: 'Demo pad', samples: norm(pad, 0.6) }]
}
