// Morse code translator: text to Morse and back (auto-detected), a blinking lamp, WebAudio playback with speed and tone, and a WAV download.
// textToMorse(), morseToText(), parseMorse(), schedule() and wav() are pure and exported for tests.
import { h, icon, button, rangeField, download } from '../../lib/ui.js'
import { studio, createOptions, group } from './_shared.js'

const TABLE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', _: '..--.-', '"': '.-..-.', $: '...-..-', '@': '.--.-.',
  '\u{c4}': '.-.-', '\u{d6}': '---.', '\u{dc}': '..--', '\u{d1}': '--.--', '\u{c9}': '..-..', '\u{c5}': '.--.-', '\u{c7}': '-.-..',
}
const REV = Object.fromEntries(Object.entries(TABLE).map(([k, v]) => [v, k]))
const FOLD = { '\u{c0}': '\u{c5}', '\u{c2}': 'A', '\u{c1}': 'A', '\u{c3}': 'A', '\u{c8}': '\u{c9}', '\u{ca}': '\u{c9}' }

/** Does this look like Morse (only dots, dashes, slashes and spaces)? */
export const looksLikeMorse = (s) => /^[.\-_\u{2022}\u{b7}\u{2219}\u{2212}\u{2013}\u{2014}/|\s]+$/u.test(s.trim()) && /[.\-_\u{2022}\u{b7}\u{2219}\u{2212}\u{2013}\u{2014}]/u.test(s)
const norm = (s) => s.replace(/[\u{2022}\u{b7}\u{2219}\u{25cf}]/gu, '.').replace(/[\u{2212}\u{2013}\u{2014}\u{2012}_]/gu, '-')

/** text -> canonical morse (letters split by a space, words by " / ", lines by a newline). */
export function textToMorse(text) {
  const skipped = new Set()
  const lines = text.split(/\r\n|\r|\n/).map((line) => line.split(/\s+/).filter(Boolean).map((word) => {
    const letters = []
    for (const raw of word) {
      let ch = raw.toUpperCase()
      if (!TABLE[ch]) ch = FOLD[ch] || ch
      if (!TABLE[ch]) { const base = ch.normalize('NFD').replace(/[\u{300}-\u{36f}]/gu, ''); if (TABLE[base]) ch = base }
      if (TABLE[ch]) letters.push(TABLE[ch])
      else skipped.add(raw)
    }
    return letters.join(' ')
  }).filter(Boolean).join(' / '))
  return { morse: lines.join('\n'), skipped: [...skipped] }
}

/** Parse morse (any common glyphs) into lines of words of letters: [{code, ch}]. */
export function parseMorse(input) {
  return norm(input).split(/\r\n|\r|\n/).map((line) => line.trim().split(/\s*[/|]\s*|\s{3,}/).map((w) => w.trim().split(/\s+/).filter(Boolean).map((code) => {
    const clean = code.replace(/[^.-]/g, '')
    return { code: clean, ch: REV[clean] ?? '?' }
  }).filter((l) => l.code)).filter((w) => w.length))
}

export function morseToText(input) {
  const lines = parseMorse(input)
  let unknown = 0
  const text = lines.map((words) => words.map((w) => w.map((l) => { if (l.ch === '?') unknown++; return l.ch }).join('')).join(' ')).join('\n')
  return { text, unknown }
}

/** Canonical morse string from parsed lines. */
export const toCanon = (lines) => lines.map((words) => words.map((w) => w.map((l) => l.code).join(' ')).join(' / ')).join('\n')

/** Timeline of tone and silence. Standard timing: dot = 1 unit, dash = 3, gap in a letter = 1, between letters = 3, between words = 7. unit = 1.2 / wpm seconds. */
export function schedule(lines, wpm) {
  const u = 1.2 / Math.max(1, wpm)
  const events = []
  let t = 0
  let tile = -1
  const push = (on, units, idx) => { const d = units * u; events.push({ t, d, on, idx }); t += d }
  const flat = lines.flat()
  flat.forEach((word, wi) => {
    word.forEach((letter, li) => {
      tile++
      ;[...letter.code].forEach((sym, si, arr) => {
        push(true, sym === '.' ? 1 : 3, tile)
        if (si < arr.length - 1) push(false, 1, tile)
      })
      if (li < word.length - 1) push(false, 3, tile)
    })
    if (wi < flat.length - 1) push(false, 7, tile)
  })
  return { events, total: t }
}

/** 16-bit mono PCM samples of the schedule as a sine tone with soft 5 ms edges. */
export function pcm(events, total, freq = 600, rate = 22050) {
  const n = Math.ceil((total + 0.15) * rate)
  const out = new Float32Array(n)
  const ramp = Math.floor(0.005 * rate)
  for (const e of events) {
    if (!e.on) continue
    const a = Math.floor(e.t * rate), b = Math.min(n, Math.floor((e.t + e.d) * rate))
    for (let i = a; i < b; i++) {
      const edge = Math.min(1, (i - a) / ramp, (b - i) / ramp)
      out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * 0.45 * edge
    }
  }
  return { samples: out, rate }
}

export function wav({ samples, rate }) {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true)
  return buf
}

const CSS = `
.tu-player { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px 22px; align-items: center; }
.tu-lamp { width: 84px; height: 84px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, var(--surface-3), var(--surface-2)); border: 1px solid var(--border); box-shadow: inset 0 -6px 14px rgba(0, 0, 0, .12); transition: background .05s, box-shadow .08s; }
.tu-lamp.on { background: radial-gradient(circle at 35% 30%, #fff7c2, #fbbf24 55%, #f97316); border-color: #f59e0b; box-shadow: 0 0 0 6px rgba(251, 191, 36, .22), 0 0 46px 10px rgba(251, 191, 36, .55); }
.tu-player .ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.tu-player .time { font: 13px var(--mono); color: var(--muted); }
.tu-mtiles { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px 6px; max-height: 260px; overflow: auto; padding: 2px; }
.tu-mt { display: flex; flex-direction: column; align-items: center; gap: 5px; min-width: 38px; padding: 7px 8px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--border); transition: background .1s, border-color .1s, transform .2s var(--spring); }
.tu-mt b { font-size: 15px; }
.tu-mt .cd { display: flex; align-items: center; gap: 3px; min-height: 8px; }
.tu-mt .cd i { height: 6px; border-radius: 99px; background: var(--muted); width: 6px; }
.tu-mt .cd i.d { width: 18px; }
.tu-mt.active { background: var(--accent-soft); border-color: var(--accent); transform: translateY(-3px) scale(1.06); }
.tu-mt.active .cd i { background: var(--accent); }
.tu-mgap { align-self: center; width: 14px; height: 2px; background: var(--border-strong); border-radius: 2px; margin: 0 4px; }
@media (max-width: 720px) { .tu-player { grid-template-columns: minmax(0, 1fr); justify-items: start; } .tu-lamp { width: 64px; height: 64px; } }
`

const SAMPLE = 'SOS we are safe\nMeet at 9:30'

export function mount(rootEl, { tool }) {
  if (!document.getElementById('tu-mc-style')) document.head.append(h('style', { id: 'tu-mc-style' }, CSS))
  const o = createOptions(tool.id, { dir: 'auto', glyphs: 'plain', wordSep: 'slash', wpm: 15, tone: 600 })
  let st, titles
  let canon = ''
  let lines = []
  let audio = null // {ctx, src, raf, t0, sched}
  const lamp = h('div', { class: 'tu-lamp', 'aria-hidden': 'true' })
  const timeEl = h('span', { class: 'time' })
  const tilesEl = h('div', { class: 'tu-mtiles', 'aria-label': 'Each letter and its code' })
  const playBtn = button('Play', { icon: 'play', variant: 'primary', size: 'sm', onClick: () => (audio ? stop() : play()) })
  const wavBtn = button('Download WAV', { icon: 'download', variant: 'secondary', size: 'sm', onClick: () => {
    if (!lines.length) return
    const s = schedule(lines, o.v.wpm)
    download(new Blob([wav(pcm(s.events, s.total, o.v.tone))], { type: 'audio/wav' }), 'morse-code.wav')
  } })
  const player = h('section', { class: 'tu-card tu-player' }, lamp, h('div', { class: 'ctl' }, playBtn, wavBtn, timeEl), tilesEl)

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  function drawTiles() {
    tilesEl.replaceChildren()
    let shown = 0
    const flat = lines.flat()
    outer: for (let wi = 0; wi < flat.length; wi++) {
      for (const l of flat[wi]) {
        if (shown >= 400) break outer
        tilesEl.append(h('div', { class: 'tu-mt', dataset: { i: String(shown++) } }, h('b', l.ch), h('span', { class: 'cd' }, [...l.code].map((c) => h('i', { class: c === '-' ? 'd' : '' })))))
      }
      if (wi < flat.length - 1) tilesEl.append(h('span', { class: 'tu-mgap', 'aria-hidden': 'true' }))
    }
    const s = lines.length ? schedule(lines, o.v.wpm) : { total: 0 }
    timeEl.textContent = lines.length ? `${fmtTime(s.total)} at ${o.v.wpm} WPM` : ''
    playBtn.disabled = wavBtn.disabled = !lines.length
    player.hidden = !lines.length
  }

  function stop() {
    if (!audio) return
    cancelAnimationFrame(audio.raf)
    try { audio.src.stop() } catch { /* already ended */ }
    audio.ctx.close().catch(() => {})
    audio = null
    lamp.classList.remove('on')
    tilesEl.querySelectorAll('.active').forEach((n) => n.classList.remove('active'))
    playBtn.replaceChildren(icon('play'), h('span', 'Play'))
    drawTime()
  }
  const drawTime = () => { if (lines.length) timeEl.textContent = `${fmtTime(schedule(lines, o.v.wpm).total)} at ${o.v.wpm} WPM` }

  function play() {
    if (!lines.length) return
    const sched = schedule(lines, o.v.wpm)
    if (sched.total > 300) { timeEl.textContent = 'Too long to play (limit 5 minutes). Shorten the text or raise the speed.'; return }
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) { timeEl.textContent = 'Your browser cannot play audio here.'; return }
    const ctx = new Ctx()
    const { samples, rate } = pcm(sched.events, sched.total, o.v.tone)
    const buffer = ctx.createBuffer(1, samples.length, rate)
    buffer.copyToChannel(samples, 0)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    audio = { ctx, src, raf: 0, sched }
    src.onended = () => { if (audio && audio.src === src) stop() }
    ctx.resume().then(() => {
      if (!audio || audio.ctx !== ctx) return
      const t0 = ctx.currentTime + 0.05
      src.start(t0)
      let k = 0
      const tick = () => {
        if (!audio || audio.ctx !== ctx) return
        const t = ctx.currentTime - t0
        while (k < sched.events.length - 1 && sched.events[k].t + sched.events[k].d <= t) k++
        const e = sched.events[k]
        const on = t >= 0 && e && e.on && t >= e.t && t < e.t + e.d
        lamp.classList.toggle('on', !!on)
        if (e && t >= 0) {
          const cur = tilesEl.querySelector('.active')
          if (!cur || cur.dataset.i !== String(e.idx)) {
            cur?.classList.remove('active')
            const next = tilesEl.querySelector(`[data-i="${e.idx}"]`)
            next?.classList.add('active')
            next?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
          }
          timeEl.textContent = `${fmtTime(Math.max(0, t))} / ${fmtTime(sched.total)}`
        }
        audio.raf = requestAnimationFrame(tick)
      }
      audio.raf = requestAnimationFrame(tick)
    })
    playBtn.replaceChildren(icon('square'), h('span', 'Stop'))
  }

  const glyph = (m) => (o.v.glyphs === 'pretty' ? m.replace(/\./g, '\u{2022}').replace(/-/g, '\u{2212}') : m)
  const sepOut = (m) => (o.v.wordSep === 'spaces' ? m.replace(/ \/ /g, '   ') : m)
  const run = (text) => {
    stop()
    if (!text.trim()) { canon = ''; lines = []; drawTiles(); return { text: '', badges: [] } }
    const dir = o.v.dir === 'auto' ? (looksLikeMorse(text) ? 'decode' : 'encode') : o.v.dir
    if (titles) { titles[0].textContent = dir === 'encode' ? 'Text' : 'Morse code'; titles[1].textContent = dir === 'encode' ? 'Morse code' : 'Text' }
    let outText, badges, note = ''
    if (dir === 'encode') {
      const r = textToMorse(text)
      canon = r.morse
      lines = parseMorse(canon)
      outText = sepOut(glyph(canon))
      const letters = lines.flat().flat().length
      badges = [{ label: 'letters and digits', value: letters, tone: 'accent' }, { label: 'words', value: lines.flat().length }, ...(r.skipped.length ? [{ label: 'skipped', value: r.skipped.length, tone: 'warn' }] : [])]
      if (r.skipped.length) note = `No Morse code for: ${r.skipped.slice(0, 12).join(' ')}`
    } else {
      lines = parseMorse(text)
      canon = toCanon(lines)
      const r = morseToText(text)
      outText = r.text
      badges = [{ label: 'letters read', value: lines.flat().flat().length, tone: 'accent' }, { label: 'words', value: lines.flat().length }, ...(r.unknown ? [{ label: 'unknown codes (?)', value: r.unknown, tone: 'warn' }] : [])]
      if (r.unknown) note = 'Some groups of dots and dashes are not letters, so they show as ?'
    }
    drawTiles()
    return { text: outText, badges, note }
  }
  const wpm = rangeField('Speed', { min: 5, max: 40, step: 1, value: o.v.wpm, format: (v) => `${v} WPM`, onInput: (v) => { o.set({ wpm: v }) } })
  const tone = rangeField('Tone', { min: 300, max: 1000, step: 10, value: o.v.tone, format: (v) => `${v} Hz`, onInput: (v) => { o.v.tone = v; o.commit() } })
  st = studio({
    id: tool.id, inputTitle: 'Text', outputTitle: 'Morse code', placeholder: 'Type text, or paste Morse code like ... --- ...', sample: SAMPLE, mono: true,
    controls: [
      group('Direction', o.pills('dir', [['auto', 'Detect'], ['encode', 'Text to Morse'], ['decode', 'Morse to text']], 'Direction')),
      group('Look', o.pills('glyphs', [['plain', '. -'], ['pretty', '\u{2022} \u{2212}']], 'Dot and dash symbols')),
      group('Between words', o.pills('wordSep', [['slash', ' / '], ['spaces', '3 spaces']], 'Word separator')),
      group('', wpm), group('', tone),
    ],
    after: player, run, filename: 'morse.txt', emptyText: 'Type something to hear it in Morse',
  })
  titles = st.el.querySelectorAll('.tu-title span')
  o.onChange = () => st.refresh()
  rootEl.append(st.el)
  st.input.focus({ preventScroll: true })
  return stop
}
