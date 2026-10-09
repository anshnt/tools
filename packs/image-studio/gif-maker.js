// GIF maker: turn a set of images into an animated GIF (gifenc), with delay, loop, size, direction and palette options.
import { h, panel, split, field, button, busy, clear, download, toast, formatBytes, rangeField, toggle, fileList, progress, onCleanup, yieldToMain } from '../../lib/ui.js'
import { addStyle, heroDrop, stage, pills, chipPicker, newCanvas, drawCover, drawContain, done, stem, readImages, IMG_ACCEPT, MAX_PIXELS } from './_shared.js'

const GIFENC = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm'
let lib = null
const gifenc = () => (lib ||= import(GIFENC).catch((e) => { lib = null; throw Object.assign(new Error('Could not load the GIF encoder. Check your connection and try again.'), { cause: e }) }))

/** The order frames are played in. mode: forward | reverse | pingpong (the ends are not repeated, so the loop is smooth). */
export function frameOrder(n, mode) {
  const fwd = Array.from({ length: n }, (_, i) => i)
  if (mode === 'reverse') return fwd.reverse()
  if (mode === 'pingpong' && n > 2) return [...fwd, ...fwd.slice(1, -1).reverse()]
  if (mode === 'pingpong' && n === 2) return [0, 1]
  return fwd
}
/** gifenc "repeat" value for a number of plays (0 = forever, -1 = once, n = n more plays). */
export const repeatFor = (plays) => (plays === 0 ? 0 : plays === 1 ? -1 : plays - 1)

const WIDTHS = [160, 240, 320, 480, 640, 800, 1024]
const BGS = [['#ffffff', 'White'], ['#000000', 'Black'], ['#6d5dfc', 'Violet']]

export function mount(root, { signal }) {
  addStyle('is-gif', `
.t-gif .player { display: grid; justify-items: center; gap: 10px; }
.t-gif .player canvas, .t-gif .player img { display: block; max-width: 100%; max-height: 520px; width: auto; height: auto; border-radius: 6px; background: var(--checker); box-shadow: 0 22px 44px -24px rgba(10, 10, 30, .55), 0 0 0 1px rgba(0, 0, 0, .1); }
.t-gif .list { max-height: 300px; overflow: auto; padding-right: 4px; }
.t-gif .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.t-gif .tabs2 { display: flex; gap: 8px; justify-content: center; }
`)
  const s = { width: 480, delay: 400, hold: 0, plays: 0, dir: 'forward', fit: 'contain', bg: '#ffffff', clear: false, colors: 256, perFrame: false }
  let files = []
  const byFile = new Map()
  let timer = 0, gifUrl = null, gifBlob = null
  onCleanup(() => { clearInterval(timer); clearTimeout(timer); if (gifUrl) URL.revokeObjectURL(gifUrl) })

  const drop = heroDrop({ accept: IMG_ACCEPT, multiple: true, sample: 6, label: 'Drop the pictures for your GIF', hint: 'Frames play in the order of the list. You can reorder them next.', onFiles: (f) => addFiles(f) })
  const work = h('div', { class: 'stack', hidden: true })
  const list = fileList({ onChange: (fs) => { files = fs.map((f) => byFile.get(f)).filter(Boolean); resetResult(); update() } })
  const stageHost = h('div', { class: 'player' }); const caption = h('div', { class: 'is-cap' })
  const result = h('div'); const prog = progress()

  const widthChips = chipPicker(WIDTHS.map((w) => [w, `${w}`]), s.width, (v) => { s.width = v; update() }, 'Output width')
  const delayF = rangeField('Time per frame', { min: 20, max: 2000, step: 10, value: s.delay, format: (v) => `${v} ms (${(1000 / v).toFixed(1)} fps)`, onInput: (v) => { s.delay = v; restart() } })
  const holdF = rangeField('Extra pause on the last frame', { min: 0, max: 3000, step: 100, value: 0, format: (v) => `${v} ms`, onInput: (v) => { s.hold = v; restart() } })
  const dirSeg = pills([['forward', 'Forward'], ['reverse', 'Reverse'], ['pingpong', 'Back and forth']], s.dir, (v) => { s.dir = v; resetResult(); update() }, 'Direction')
  const loopSeg = pills([[0, 'Forever'], [1, 'Once'], [2, 'Twice'], [3, '3 times']], s.plays, (v) => { s.plays = v; resetResult() }, 'Loop')
  const fitSeg = pills([['contain', 'Fit (borders)'], ['cover', 'Fill (crop)']], s.fit, (v) => { s.fit = v; resetResult(); update() }, 'Fit')
  const bgChips = chipPicker(BGS.map(([c, n]) => [c, n]), s.bg, (v) => { s.bg = v; s.clear = false; clrT.input.checked = false; resetResult(); update() }, 'Background')
  const clrT = toggle('Transparent background', false, (v) => { s.clear = v; resetResult(); update() })
  const colorsF = rangeField('Colors', { min: 8, max: 256, step: 8, value: 256, format: (v) => `${v}`, hint: 'Fewer colors make a smaller file.', onInput: (v) => { s.colors = v; resetResult() } })
  const palT = toggle('Best color for every frame (bigger file)', false, (v) => { s.perFrame = v; resetResult() })
  const encodeBtn = button('Make GIF', { icon: 'film', variant: 'primary', size: 'lg', block: true })
  const controls = panel(h('div', { class: 'stack' }, field('Width (px)', widthChips), delayF, holdF, field('Direction', dirSeg), field('Loop', loopSeg), field('When the shapes differ', fitSeg),
    field('Background', bgChips), clrT, colorsF, palT, encodeBtn, prog.el, result))

  const order = () => frameOrder(files.length, s.dir)
  const size = () => {
    const a = files[0]
    const w = Math.min(s.width, a.w), hh = Math.max(1, Math.round((w * a.h) / a.w))
    return [Math.max(1, Math.round(w)), hh]
  }
  function draw(f, W, H) {
    const c = newCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true })
    g.imageSmoothingQuality = 'high'
    if (!s.clear) { g.fillStyle = s.bg; g.fillRect(0, 0, W, H) }
    if (s.fit === 'cover') drawCover(g, f.img, f.w, f.h, 0, 0, W, H); else drawContain(g, f.img, f.w, f.h, 0, 0, W, H)
    return c
  }

  // ----- live preview -----
  let preview = null // {canvases, ctx}
  function update() {
    if (!files.length) { work.hidden = true; return }
    work.hidden = false
    widthChips.set(WIDTHS.includes(s.width) ? s.width : null); dirSeg.set(s.dir); fitSeg.set(s.fit); loopSeg.set(s.plays); bgChips.set(s.clear ? null : s.bg)
    bgChips.parentElement.hidden = s.clear
    const [W, H] = size()
    if (W * H * files.length > MAX_PIXELS) { clear(stageHost, h('p', { class: 'muted' }, 'Too many large frames. Use a smaller width or fewer pictures.')); return }
    const pw = Math.min(W, 520), ph = Math.round((pw * H) / W)
    preview = { frames: files.map((f) => draw(f, pw, ph)), pw, ph }
    const cv = newCanvas(pw, ph)
    preview.cv = cv
    clear(stageHost, gifBlob ? h('div', { class: 'player' }, h('img', { src: gifUrl, alt: 'Your finished GIF' })) : cv)
    clear(caption, h('span', h('b', `${W} x ${H}`), ' px'), h('span', h('b', files.length), ' pictures'), h('span', `${order().length} frames, about `, h('b', `${((order().length * s.delay + s.hold) / 1000).toFixed(1)} s`)))
    restart()
  }
  function restart() {
    clearTimeout(timer)
    if (!preview || gifBlob) return
    const seq = order(); let i = 0
    const g = preview.cv.getContext('2d')
    const tick = () => {
      if (!preview.cv.isConnected) return
      g.clearRect(0, 0, preview.pw, preview.ph); g.drawImage(preview.frames[seq[i % seq.length]], 0, 0)
      const last = i % seq.length === seq.length - 1
      i++
      timer = setTimeout(tick, s.delay + (last ? s.hold : 0))
    }
    tick()
  }
  function resetResult() {
    if (gifUrl) URL.revokeObjectURL(gifUrl)
    gifUrl = gifBlob = null
    clear(result)
    if (preview && !preview.cv.isConnected && files.length) { clear(stageHost, preview.cv); restart() }
  }

  // ----- encoding -----
  encodeBtn.addEventListener('click', () => busy(encodeBtn, async () => {
    const { GIFEncoder, quantize, applyPalette } = await gifenc()
    clear(result)
    const [W, H] = size()
    const seq = order(), snapshot = { ...s }
    const cache = new Map()
    const rgbaOf = (idx) => { if (!cache.has(idx)) cache.set(idx, draw(files[idx], W, H).getContext('2d').getImageData(0, 0, W, H).data); return cache.get(idx) }
    const fmtName = snapshot.clear ? 'rgba4444' : 'rgb565'
    const opts = snapshot.clear ? { format: 'rgba4444', oneBitAlpha: true } : { format: 'rgb565' }
    const gif = GIFEncoder()
    let globalPal = null
    if (!snapshot.perFrame) {
      // one palette from a sample of every picture
      const sample = []
      for (let i = 0; i < files.length; i++) { const d = rgbaOf(i); const step = Math.max(1, Math.floor(d.length / 4 / 40000)); for (let p = 0; p < d.length; p += 4 * step) sample.push(d[p], d[p + 1], d[p + 2], d[p + 3]); await yieldToMain() }
      globalPal = quantize(new Uint8Array(sample), snapshot.colors, opts)
    }
    for (let k = 0; k < seq.length; k++) {
      if (signal.aborted) return
      prog.set(k / seq.length, `Encoding frame ${k + 1} of ${seq.length}`)
      const data = rgbaOf(seq[k])
      const palette = globalPal || quantize(data, snapshot.colors, opts)
      const index = applyPalette(data, palette, fmtName)
      const delay = snapshot.delay + (k === seq.length - 1 ? snapshot.hold : 0)
      const frameOpts = { palette: k === 0 || !globalPal ? palette : undefined, delay, repeat: repeatFor(snapshot.plays) }
      if (snapshot.clear) { frameOpts.transparent = true; frameOpts.transparentIndex = Math.max(0, palette.findIndex((c) => c[3] === 0)); frameOpts.dispose = 2 }
      gif.writeFrame(index, W, H, frameOpts)
      await yieldToMain()
    }
    gif.finish()
    const blob = new Blob([gif.bytes()], { type: 'image/gif' })
    if (gifUrl) URL.revokeObjectURL(gifUrl)
    gifBlob = blob; gifUrl = URL.createObjectURL(blob)
    clearTimeout(timer)
    clear(stageHost, h('img', { src: gifUrl, alt: 'Your finished GIF' }))
    const name = `${stem(files[0].name)}-animation.gif`
    clear(result, done('Your GIF is ready', `${W} x ${H} px, ${seq.length} frames, ${formatBytes(blob.size)}`,
      button('Download GIF', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(blob, name) }),
      button('Back to the preview', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: () => { resetResult(); update() } })))
  }, { label: 'Encoding', errorTo: result, progress: prog }))

  async function addFiles(fs) {
    const loaded = await readImages(fs.slice(0, 200), { signal })
    const added = []
    for (const l of loaded) { const it = { file: l.file, name: l.name, img: l.img, w: l.w, h: l.h }; byFile.set(l.file, it); added.push(l.file) }
    if (!added.length) return
    drop.setCompact(true)
    resetResult()
    list.add(added)
  }

  work.append(split(h('div', { class: 'stack' }, stage(stageHost, caption)), h('div', { class: 'stack' }, controls, panel(h('div', { class: 'panel-title' }, h('span', 'Frames (drag to reorder)')), h('div', { class: 'list' }, list.el))), 'wide-left'))
  root.append(h('div', { class: 't-gif stack' }, drop, work))
}
