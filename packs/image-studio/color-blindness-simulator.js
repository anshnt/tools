// Color blindness simulator: Machado, Oliveira & Fernandes (2009) matrices for protanopia, deuteranopia and tritanopia, plus achromatopsia.
import { h, panel, split, field, button, busy, progress, clear, download, toast, rangeField, yieldToMain } from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import { loadImage } from '../../lib/image.js'
import { addStyle, heroDrop, stage, pills, chipPicker, scaled, newCanvas, capSize, encode, done, tilt, compareSlider, stem, IMG_ACCEPT } from './_shared.js'
import { LIN, toSrgb } from './_color.js'

// Full-severity (1.0) matrices from Machado 2009, applied in linear RGB.
export const MATRICES = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
}
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]
/** Matrix at a severity from 0 (normal) to 1 (full dichromacy): a linear blend between the identity and the Machado matrix. */
export const matrixAt = (type, severity) => MATRICES[type].map((v, i) => IDENTITY[i] + (v - IDENTITY[i]) * severity)

/** Simulate a type of color vision on RGBA data. Returns a new Uint8ClampedArray. type: 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia'. */
export function simulate(data, type, severity = 1) {
  const out = new Uint8ClampedArray(data.length)
  const n = data.length / 4
  if (type === 'normal') { out.set(data); return out }
  if (type === 'achromatopsia') {
    for (let i = 0; i < n; i++) {
      const o = i * 4
      const y = toSrgb(0.2126 * LIN[data[o]] + 0.7152 * LIN[data[o + 1]] + 0.0722 * LIN[data[o + 2]])
      out[o] = out[o + 1] = out[o + 2] = y
      out[o + 3] = data[o + 3]
    }
    return out
  }
  const m = matrixAt(type, severity)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = LIN[data[o]], g = LIN[data[o + 1]], b = LIN[data[o + 2]]
    out[o] = toSrgb(m[0] * r + m[1] * g + m[2] * b)
    out[o + 1] = toSrgb(m[3] * r + m[4] * g + m[5] * b)
    out[o + 2] = toSrgb(m[6] * r + m[7] * g + m[8] * b)
    out[o + 3] = data[o + 3]
  }
  return out
}

const TYPES = [
  { id: 'normal', name: 'Normal vision', short: 'Normal', desc: 'How most people see it.', stat: 'About 92% of men and 99.5% of women.', icon: 'eye' },
  { id: 'protanopia', name: 'Protanopia', anomaly: 'Protanomaly', short: 'Protan', desc: 'No working red cones. Reds turn dark and muddy and blend with greens.', stat: 'About 1% of men (protanomaly: another 1%).', icon: 'eye-off' },
  { id: 'deuteranopia', name: 'Deuteranopia', anomaly: 'Deuteranomaly', short: 'Deutan', desc: 'No working green cones. Reds, greens and browns look alike.', stat: 'About 1% of men (deuteranomaly: about 5%).', icon: 'eye-off' },
  { id: 'tritanopia', name: 'Tritanopia', anomaly: 'Tritanomaly', short: 'Tritan', desc: 'No working blue cones. Blues look green and yellows look pink.', stat: 'Very rare, under 0.01% of people.', icon: 'eye-off' },
  { id: 'achromatopsia', name: 'Achromatopsia', short: 'Mono', desc: 'No color vision at all. Only brightness is seen.', stat: 'Very rare, about 1 in 30,000.', icon: 'contrast' },
]
const label = (t, sev) => (t.anomaly && sev < 0.995 ? t.anomaly : t.name)

export function mount(root, { signal }) {
  addStyle('is-cb', `
.t-cb .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 270px), 1fr)); gap: 14px; }
.t-cb .card { position: relative; border-radius: 24px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  animation: isPop .55s var(--spring) both; animation-delay: calc(var(--i, 0) * 70ms); transition: box-shadow .3s; }
.t-cb .card:hover { box-shadow: var(--shadow); }
.t-cb .card canvas { display: block; width: 100%; height: auto; }
.t-cb .card .meta { padding: 12px 14px 14px; display: grid; gap: 3px; }
.t-cb .card .meta b { font-size: 15px; letter-spacing: -.01em; }
.t-cb .card .meta span { font-size: 12.5px; color: var(--muted); }
.t-cb .card .meta .st { font-size: 12px; color: var(--text-2); }
.t-cb .card .dl { position: absolute; top: 10px; right: 10px; opacity: 0; transform: scale(.8); transition: all .25s var(--spring); }
.t-cb .card:hover .dl, .t-cb .card:focus-within .dl { opacity: 1; transform: none; }
@media (hover: none) { .t-cb .card .dl { opacity: 1; transform: none; } }
.t-cb .cta { display: grid; place-items: center; align-content: center; text-align: center; gap: 10px; padding: 24px 16px; border-radius: 24px; border: 1.5px dashed var(--border-strong); background: color-mix(in srgb, var(--accent) 5%, var(--surface)); }
.t-cb .cta p { font-size: 13px; color: var(--muted); max-width: 240px; }
`)
  let src = null, small = null, prev = {}
  const s = { view: 'grid', severity: 1, pick: 'deuteranopia' }

  const drop = heroDrop({ accept: IMG_ACCEPT, sample: 1, sampleFrom: 5, sampleLabel: 'Try the color test card', label: 'Drop an image to see it through other eyes', onFiles: ([f]) => load(f) })
  const work = h('div', { class: 'stack', hidden: true })
  const viewSeg = pills([['grid', 'All at once'], ['compare', 'Compare with slider']], s.view, (v) => { s.view = v; render() }, 'View')
  const sev = rangeField('Severity', { min: 10, max: 100, step: 5, value: 100, format: (v) => `${v}%`, hint: '100% is full dichromacy. Lower values are the milder "anomalous" forms (for example deuteranomaly).', onInput: (v) => { s.severity = v / 100; render() } })
  const pickChips = chipPicker(TYPES.filter((t) => t.id !== 'normal').map((t) => [t.id, t.name]), s.pick, (v) => { s.pick = v; render() }, 'Vision type to compare')
  const body = h('div', { class: 'stack' })
  const result = h('div')
  const prog = progress()

  const sim = (type) => {
    const ctx = small.getContext('2d', { willReadFrequently: true })
    const d = ctx.getImageData(0, 0, small.width, small.height)
    const c = newCanvas(small.width, small.height)
    c.getContext('2d').putImageData(new ImageData(simulate(d.data, type, s.severity), d.width, d.height), 0, 0)
    return c
  }

  async function full(type) {
    const { w, h: hh } = capSize(src.w, src.h)
    const c = newCanvas(w, hh)
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(src.img, 0, 0, w, hh)
    const d = g.getImageData(0, 0, w, hh)
    g.putImageData(new ImageData(simulate(d.data, type, s.severity), w, hh), 0, 0)
    return encode(c, 'image/png')
  }
  const fname = (t) => `${stem(src.name)}-${t.id === 'normal' ? 'original' : t.id}.png`

  function render() {
    if (!small) return
    viewSeg.set(s.view); pickChips.set(s.pick)
    if (s.view === 'grid') renderGrid(); else renderCompare()
  }

  function renderGrid() {
    const cards = TYPES.map((t, i) => {
      const c = t.id === 'normal' ? small : sim(t.id)
      const cv = newCanvas(c.width, c.height)
      cv.getContext('2d').drawImage(c, 0, 0)
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `${label(t, s.severity)} preview`)
      const dl = button('', { icon: 'download', variant: 'secondary', size: 'sm', ariaLabel: `Download ${t.name}`, onClick: () => busy(dl, async () => download(await full(t.id), fname(t))) })
      dl.classList.add('dl')
      const card = h('article', { class: 'card', style: { '--i': i } }, cv, dl, h('div', { class: 'meta' }, h('b', label(t, s.severity)), h('span', t.desc), h('span', { class: 'st' }, t.stat)))
      return tilt(card, 3)
    })
    const all = button('Download all (ZIP)', { icon: 'archive', variant: 'primary', onClick: () => downloadAll(all) })
    cards.push(h('div', { class: 'cta', style: { '--i': 6 } }, h('strong', 'Take them with you'), h('p', 'Full-size PNGs of every view, in one ZIP.'), all))
    clear(body, h('div', { class: 'grid' }, cards))
  }

  function renderCompare() {
    const t = TYPES.find((x) => x.id === s.pick)
    const a = newCanvas(small.width, small.height); a.getContext('2d').drawImage(small, 0, 0)
    const b = sim(t.id)
    const sl = compareSlider({ a, b, labelA: 'Normal vision', labelB: label(t, s.severity), width: small.width, height: small.height })
    clear(body, field('Compare normal vision with', pickChips), stage(sl, h('div', { class: 'is-cap' }, h('span', t.desc), h('span', t.stat))))
    sl.sweep()
  }

  async function downloadAll(btn) {
    await busy(btn, async () => {
      const entries = []
      for (let i = 0; i < TYPES.length; i++) {
        if (signal.aborted) return
        prog.set(i / TYPES.length, `Rendering ${TYPES[i].name}`)
        entries.push({ name: fname(TYPES[i]), data: await full(TYPES[i].id) })
        await yieldToMain()
      }
      prog.set(1, 'Zipping')
      const blob = await zip(entries)
      download(blob, `${stem(src.name)}-color-vision.zip`)
      clear(result, done('Saved 5 images', `${stem(src.name)}-color-vision.zip`))
    }, { label: 'Rendering', errorTo: result, progress: prog })
  }

  async function load(file) {
    try {
      const img = await loadImage(file)
      src = { img, name: file.name, w: img.naturalWidth, h: img.naturalHeight }
      small = scaled(img, 720)
      drop.setCompact(true)
      work.hidden = false
      clear(result)
      render()
    } catch (e) { toast(e.message, 'error') }
  }

  work.append(panel(h('div', { class: 'stack' }, field('View', viewSeg), sev)), body, prog.el, result)
  root.append(h('div', { class: 't-cb stack' }, drop, work))
}
