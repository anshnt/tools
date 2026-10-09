// Image upscaler: Swin2SR super-resolution (transformers.js image-to-image) at 2x and 4x, run tile by tile so large
// photos never run out of memory, with a no-download Quick mode (smooth resize plus sharpening) as a fallback.
import { h, icon, button, busy, alert, clear, segmented, rangeField, toggle, toast, download, formatBytes, formatDuration, yieldToMain } from '../../lib/ui.js'
import { suffixName } from '../../lib/files.js'
import { canvas as makeCanvas, canEncode, MAX_PIXELS } from '../../lib/image.js'
import { transformers } from '../../lib/libs.js'
import { bestDevice, markGpuBroken, loadWorking, canvasBlob, friendlyError, checkAbort, isReady, markReady, handoff } from './_ml.js'
import { unsharp } from './_enhance.js'
import { shell, steps, heroDrop, panelOf, section, stage, scanFx, compare, optionCards, note, devicePill, burst, doneCard } from './_ui.js'

export const ENGINES = {
  2: [
    { key: 'light2', repo: 'Xenova/swin2SR-lightweight-x2-64', mb: 8, title: 'Fast AI', desc: 'Small and quick. A clear step up from a plain resize.', scale: 2, tile: { webgpu: 192, wasm: 128 }, rate: { webgpu: 0.09, wasm: 0.36 } },
    { key: 'classic2', repo: 'Xenova/swin2SR-classical-sr-x2-64', mb: 54, title: 'Sharp AI', desc: 'The most detail at 2x. Larger download, slower.', scale: 2, tile: { webgpu: 160, wasm: 128 }, rate: { webgpu: 0.45, wasm: 2.4 } },
    { key: 'quick', title: 'Quick (no AI)', desc: 'Smooth resize plus sharpening. Works offline, instantly.', scale: 2 },
  ],
  4: [
    { key: 'classic4', repo: 'Xenova/swin2SR-classical-sr-x4-64', mb: 55, title: 'Clean photo AI', desc: 'For sharp, clean photos, art and screenshots.', scale: 4, tile: { webgpu: 160, wasm: 128 }, rate: { webgpu: 0.47, wasm: 2.6 } },
    { key: 'real4', repo: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', mb: 53, title: 'Real-world AI', desc: 'For old, noisy or heavily compressed photos.', scale: 4, tile: { webgpu: 160, wasm: 128 }, rate: { webgpu: 0.47, wasm: 2.6 } },
    { key: 'quick', title: 'Quick (no AI)', desc: 'Smooth resize plus sharpening. Works offline, instantly.', scale: 4 },
  ],
}
const MARGIN = 8

/** Tile origins and the stretch each tile is responsible for along one axis. Pure. */
export function planAxis(len, tile, margin = MARGIN, offset = 0) {
  // a length just over one tile is cheaper as a single, slightly larger tile than as two overlapping ones
  const t = len <= tile * 1.25 ? len : Math.min(tile, len)
  const stride = Math.max(1, t - 2 * margin)
  const origins = []
  for (let o = 0; o < len - t; o += stride) origins.push(o)
  origins.push(Math.max(0, len - t))
  const out = []
  let prevEnd = 0
  origins.forEach((o, i) => {
    const last = i === origins.length - 1
    const end = last ? len : Math.min(len, o + t - margin)
    out.push({ origin: o + offset, size: t, from: prevEnd + offset, to: end + offset })
    prevEnd = end
  })
  return out
}

const pipes = new Map()
async function getPipeline(spec, device, onProgress) {
  const key = `${spec.key}:${device}`
  if (!pipes.has(key)) {
    pipes.set(key, (async () => {
      const T = await transformers()
      T.env.allowLocalModels = false
      const files = new Map()
      const pipe = await T.pipeline('image-to-image', spec.repo, {
        device, dtype: 'fp32',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            files.set(p.file, p.loaded)
            let loaded = 0
            for (const v of files.values()) loaded += v
            onProgress?.(Math.min(0.99, loaded / (spec.mb * 1e6)), `Downloading AI model (${formatBytes(loaded)})`)
          }
        },
      })
      markReady(`up-${spec.key}`)
      return { T, pipe }
    })().catch((e) => { pipes.delete(key); throw e }))
  }
  return pipes.get(key)
}

function resizeSmooth(src, w, h) {
  // step by step so the browser's resampler never skips pixels
  let cur = src
  let cw = src.width, ch = src.height
  while (cw < w || ch < h) {
    const nw = Math.min(w, Math.round(cw * 2)), nh = Math.min(h, Math.round(ch * 2))
    const c = makeCanvas(nw, nh)
    const x = c.getContext('2d')
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'
    x.drawImage(cur, 0, 0, nw, nh)
    cur = c; cw = nw; ch = nh
  }
  return cur
}

export function mount(root, { signal }) {
  const st = { scale: 2, engine: 'light2', sharpen: false, fmt: 'jpg', quality: 95 }
  let src = null, name = '', out = null, quickCv = null, ctl = new AbortController(), busyRun = false, lastInfo = null
  signal.addEventListener('abort', () => ctl.abort())

  const stepper = steps(['Add photo', 'Upscale', 'Download'], 0)
  const beforeCv = document.createElement('canvas')
  const afterCv = document.createElement('canvas')
  const cmp = compare(beforeCv, afterCv, { beforeLabel: 'Original', afterLabel: 'Upscaled', start: 0.5 })
  beforeCv.style.imageRendering = 'auto'
  const stg = stage('on-plain')
  const scan = scanFx()
  const infoChip = h('div', { class: 'ia-chip bl' }, icon('scaling'), h('span', ''))
  const viewSeg = segmented([['result', 'Upscaled'], ['original', 'Original'], ['compare', 'Compare']], 'compare', (v) => setView(v), 'View')
  stg.append(cmp, infoChip, h('div', { class: 'ia-tools' }, viewSeg), scan.el)
  const msgSlot = h('div')
  const doneSlot = h('div')
  const tileInfo = h('div', { class: 'small muted' })

  const scaleSeg = segmented([['2', '2x'], ['4', '4x']], String(st.scale), (v) => { st.scale = Number(v); st.engine = ENGINES[st.scale][0].key; renderEngines(); updateInfo() }, 'Scale')
  const engineHost = h('div')
  let engineCards = null
  function engineOpts() {
    return ENGINES[st.scale].map((e) => ({
      value: e.key, title: e.title, desc: e.desc, icon: e.key === 'quick' ? 'zap' : 'sparkles',
      tags: [e.mb ? (isReady(`up-${e.key}`) ? { text: 'Ready', cls: 'ok' } : `${e.mb} MB`) : { text: 'No download', cls: 'ok' }, `${e.scale}x`],
    }))
  }
  function renderEngines() {
    engineCards = optionCards(engineOpts(), st.engine, (v) => { st.engine = v; updateInfo() }, { col: true, label: 'Engine' })
    clear(engineHost, engineCards)
  }
  const sharpenT = toggle('Add a little extra sharpening', false, (v) => { st.sharpen = v })
  const fmtSeg = segmented([['jpg', 'JPG'], ['png', 'PNG'], ...(canEncode('image/webp') ? [['webp', 'WebP']] : [])], st.fmt, (v) => { st.fmt = v; quality.hidden = v === 'png' }, 'File format')
  const quality = rangeField('Quality', { min: 60, max: 100, value: st.quality, format: (v) => `${v}%`, onInput: (v) => { st.quality = v } })
  const panel = panelOf(
    section('Enlarge by', 'scaling', [scaleSeg, tileInfo]),
    section('Engine', 'cpu', [engineHost, note('shield-check', 'Models run on your device and download once. Your photo is never uploaded.')]),
    section('Finish', 'sliders-horizontal', [sharpenT], false),
    section('Download', 'download', [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Format'), fmtSeg), quality], false))

  const goBtn = button('Upscale', { icon: 'zoom-in', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, () => run(false), { label: 'Upscaling', errorTo: msgSlot }))
  const previewBtn = button('Preview a small area first', { icon: 'scan-search', variant: 'secondary', block: true })
  previewBtn.addEventListener('click', () => busy(previewBtn, () => run(true), { label: 'Previewing', errorTo: msgSlot }))
  const dlBtn = button('Download', { icon: 'download', variant: 'secondary', size: 'lg', block: true, disabled: true })
  dlBtn.addEventListener('click', () => busy(dlBtn, downloadResult, { label: 'Preparing file', errorTo: msgSlot }))
  const another = button('Use another photo', { icon: 'image-up', variant: 'ghost', block: true, onClick: () => hero.zone.open() })
  const side = h('div', { class: 'ia-side' }, panel, h('div', { class: 'stack tight' }, goBtn, previewBtn, dlBtn, another))
  const studioEl = h('div', { class: 'ia-studio', hidden: true }, h('div', { class: 'ia-main' }, stg, msgSlot, doneSlot), side)

  const hero = heroDrop({
    accept: 'image/*', label: 'Drop a small or blurry photo',
    hint: 'Make it 2x or 4x bigger with AI that adds believable detail. Paste with Ctrl+V works too.',
    icons: ['zoom-in', 'scaling', 'sparkles', 'image'],
    features: [['shield-check', 'Stays on your device'], ['layout-grid', 'Big photos are handled tile by tile'], ['zap', 'Quick mode works offline']],
    onFiles: ([f]) => openFile(f),
  })
  shell(root, stepper, hero, studioEl)
  renderEngines()

  const held = handoff.take()
  if (held) openFile(held.file)

  function setView(v) {
    viewSeg.set(v)
    cmp.setStatic(v !== 'compare')
    cmp.animateTo(v === 'result' ? 0 : v === 'original' ? 1 : 0.5)
  }

  async function openFile(file) {
    clear(msgSlot); clear(doneSlot)
    hero.hidden = true; studioEl.hidden = false
    scan.start('Opening your photo')
    try {
      const w = await loadWorking(file, { maxSide: 4096 })
      src = w.canvas
      name = file.name
    } catch (e) { scan.stop(); clear(msgSlot, alert('error', friendlyError(e).message)); hero.hidden = false; studioEl.hidden = true; return }
    scan.stop()
    out = null; quickCv = null
    beforeCv.width = src.width; beforeCv.height = src.height
    beforeCv.getContext('2d').drawImage(src, 0, 0)
    afterCv.width = src.width; afterCv.height = src.height
    afterCv.getContext('2d').drawImage(src, 0, 0)
    cmp.setAspect(src.width, src.height)
    cmp.setStatic(true); cmp.set(1)
    viewSeg.set('original')
    dlBtn.disabled = true
    stepper.set(1)
    updateInfo()
  }

  let dev = 'wasm'
  bestDevice().then((d) => { dev = d; updateInfo() })
  const tileTotals = (spec, region) => {
    const t = spec.tile[dev] || spec.tile.wasm
    const xs = planAxis(region.w, t), ys = planAxis(region.h, t)
    let px = 0
    for (const x of xs) for (const y of ys) px += x.size * y.size
    return { tiles: xs.length * ys.length, px }
  }
  function updateInfo() {
    if (!src) return
    const s = st.scale
    const ow = src.width * s, oh = src.height * s
    infoChip.querySelector('span').textContent = `${name}  -  ${src.width} x ${src.height}  to  ${ow} x ${oh}`
    const spec = ENGINES[s].find((e) => e.key === st.engine)
    let t = `Result: ${ow} x ${oh} px (${((ow * oh) / 1e6).toFixed(1)} MP). `
    if (spec.key === 'quick') t += 'Instant.'
    else {
      const { tiles, px } = tileTotals(spec, { w: src.width, h: src.height })
      const sec = (px * spec.rate[dev]) / 1000
      t += `${tiles} tile${tiles === 1 ? '' : 's'}, about ${sec < 60 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`} on your ${dev === 'webgpu' ? 'GPU' : 'CPU'}.`
      if (sec > 240) t += ' That is a long wait. Try Preview first, a smaller photo, or Quick mode.'
    }
    if (ow * oh > MAX_PIXELS) t += ` Too large for this device (limit ${(MAX_PIXELS / 1e6).toFixed(0)} MP).`
    tileInfo.textContent = t
  }

  async function run(preview = false) {
    if (!src || busyRun) return
    clear(msgSlot); clear(doneSlot)
    const s = st.scale
    const spec = ENGINES[s].find((e) => e.key === st.engine)
    const W = src.width * s, H = src.height * s
    if (W * H > MAX_PIXELS) {
      const maxSide = Math.floor(Math.sqrt(MAX_PIXELS / (s * s * (src.width / src.height))))
      throw new Error(`The result would be ${(W * H / 1e6).toFixed(0)} megapixels, more than this device can handle. Try ${s === 4 ? '2x or ' : ''}a photo smaller than about ${maxSide} px wide.`)
    }
    busyRun = true
    ctl = new AbortController()
    scan.onCancel = () => ctl.abort()
    scan.start('Preparing', spec.key !== 'quick')
    const t0 = performance.now()
    let device = 'wasm'
    let region = null
    try {
      // instant smooth version first, so something good is on screen from the start
      const quick = resizeSmooth(src, W, H)
      out = makeCanvas(W, H)
      out.getContext('2d').drawImage(quick, 0, 0, W, H)
      beforeCv.width = src.width; beforeCv.height = src.height
      beforeCv.getContext('2d').drawImage(src, 0, 0)
      showOut()
      if (spec.key === 'quick') {
        const id = out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H)
        unsharp(id.data, W, H, 70, 0.9 * (Math.max(W, H) / 1000), 3)
        out.getContext('2d').putImageData(id, 0, 0)
      } else {
        const r = await upscaleTiles(spec, ctl.signal, preview)
        device = r.device; region = r.region
      }
      if (preview && region) {
        showRegion(region, s)
        dlBtn.disabled = true
        clear(doneSlot, alert('info', h('strong', 'Preview. '), `Only a ${region.w} x ${region.h} px area from the middle was upscaled. Drag the slider to judge it, then press Upscale for the whole photo.`))
        setView('compare')
        cmp.sweep()
        return
      }
      if (st.sharpen && spec.key !== 'quick') {
        scan.update(null, 'Sharpening')
        await yieldToMain()
        const id = out.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H)
        unsharp(id.data, W, H, 45, 0.9 * (Math.max(W, H) / 1000), 3)
        out.getContext('2d').putImageData(id, 0, 0)
      }
      showOut()
      engineCards.refresh(engineOpts())
      dlBtn.disabled = false
      stepper.set(2)
      setView('compare')
      cmp.sweep()
      burst(stg)
      const sec = (performance.now() - t0) / 1000
      lastInfo = { w: W, h: H }
      clear(doneSlot, doneCard({
        title: `Upscaled to ${W} x ${H}`, sub: `${spec.title}, ${sec < 90 ? `${sec.toFixed(1)} s` : formatDuration(sec)}${spec.key === 'quick' ? '' : ` on your ${device === 'webgpu' ? 'GPU' : 'CPU'}`}. Drag the slider to compare.`,
        actions: [button('Download', { icon: 'download', variant: 'primary', size: 'lg', onClick: () => busy(dlBtn, downloadResult, { label: 'Preparing file', errorTo: msgSlot }) }), spec.key === 'quick' ? null : devicePill(device)],
        next: [h('button', { type: 'button', onclick: async () => {
          const b = await canvasBlob(out, 'image/png')
          handoff.put(new File([b], suffixName(name, `${s}x`, 'png'), { type: 'image/png' }))
          location.hash = '#/enhance-image'
        } }, icon('sparkles'), 'Enhance colors and light')],
      }))
    } catch (e) {
      if (e?.code === 'ABORT' || e?.name === 'AbortError') { toast('Cancelled'); out = null; afterCv.width = src.width; afterCv.height = src.height; afterCv.getContext('2d').drawImage(src, 0, 0); cmp.setAspect(src.width, src.height) }
      else throw friendlyError(e)
    } finally {
      scan.stop(); busyRun = false
    }
  }

  function showOut() {
    if (afterCv.width !== out.width || afterCv.height !== out.height) { afterCv.width = out.width; afterCv.height = out.height }
    afterCv.getContext('2d').drawImage(out, 0, 0)
    cmp.setAspect(out.width, out.height)
  }

  async function upscaleTiles(spec, signal, preview = false) {
    const s = spec.scale
    let device = await bestDevice()
    let handle = null
    for (let attempt = 0; attempt < 2 && !handle; attempt++) {
      try {
        scan.update(null, 'Loading AI model')
        handle = await getPipeline(spec, device, (f, l) => scan.update(f, l))
      } catch (e) {
        if (device === 'webgpu') { markGpuBroken(); device = 'wasm'; continue }
        throw e
      }
    }
    const { T, pipe } = handle
    const tsz = spec.tile[device] || spec.tile.wasm
    // Preview upscales one tile from the middle of the photo so you can judge the result in seconds.
    const region = preview
      ? { x: Math.max(0, Math.round((src.width - tsz) / 2)), y: Math.max(0, Math.round((src.height - tsz) / 2)), w: Math.min(tsz, src.width), h: Math.min(tsz, src.height) }
      : { x: 0, y: 0, w: src.width, h: src.height }
    const xs = planAxis(region.w, tsz, MARGIN, region.x), ys = planAxis(region.h, tsz, MARGIN, region.y)
    const total = xs.length * ys.length
    const octx = out.getContext('2d')
    const tile = document.createElement('canvas')
    const tctx = tile.getContext('2d', { willReadFrequently: true })
    let done = 0, firstDone = 0
    for (const yy of ys) {
      for (const xx of xs) {
        checkAbort(signal)
        const tw = xx.size, th = yy.size
        const pw = Math.ceil(tw / 8) * 8, ph = Math.ceil(th / 8) * 8
        tile.width = pw; tile.height = ph
        tctx.drawImage(src, xx.origin, yy.origin, tw, th, 0, 0, tw, th)
        if (pw > tw) tctx.drawImage(tile, tw - 1, 0, 1, th, tw, 0, pw - tw, th)
        if (ph > th) tctx.drawImage(tile, 0, th - 1, pw, 1, 0, th, pw, ph - th)
        const raw = T.RawImage.fromCanvas(tile).rgb()
        let res
        try { res = await pipe(raw) } catch (e) {
          if (device === 'webgpu') { markGpuBroken(); toast('GPU failed, switching to the CPU', 'info'); pipes.clear(); return upscaleTiles(spec, signal, preview) }
          throw e
        }
        // copy the part of the result this tile is responsible for
        const rw = res.width, ch = res.channels
        const x0 = (xx.from - xx.origin) * s, x1 = (xx.to - xx.origin) * s, y0 = (yy.from - yy.origin) * s, y1 = (yy.to - yy.origin) * s
        const id = octx.createImageData(x1 - x0, y1 - y0)
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const si = (y * rw + x) * ch, di = ((y - y0) * (x1 - x0) + (x - x0)) * 4
            id.data[di] = res.data[si]; id.data[di + 1] = res.data[si + 1]; id.data[di + 2] = res.data[si + 2]; id.data[di + 3] = 255
          }
        }
        octx.putImageData(id, xx.from * s, yy.from * s)
        done++
        if (done === 1) firstDone = performance.now()
        const per = done > 1 ? (performance.now() - firstDone) / (done - 1) : 0
        const eta = per ? ((total - done) * per) / 1000 : null
        scan.update(done / total, `Adding detail (tile ${done} of ${total})`, eta != null ? `About ${formatDuration(eta)} left` : 'Measuring speed')
        showOut()
        await yieldToMain()
      }
    }
    return { device, region }
  }

  function showRegion(r, s) {
    beforeCv.width = r.w; beforeCv.height = r.h
    beforeCv.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
    afterCv.width = r.w * s; afterCv.height = r.h * s
    afterCv.getContext('2d').drawImage(out, r.x * s, r.y * s, r.w * s, r.h * s, 0, 0, r.w * s, r.h * s)
    cmp.setAspect(r.w, r.h)
  }

  async function downloadResult() {
    if (!out) throw new Error('Upscale the photo first.')
    const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[st.fmt]
    let c = out
    if (st.fmt === 'jpg') { c = makeCanvas(out.width, out.height); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(out, 0, 0) }
    const blob = await canvasBlob(c, type, st.quality / 100)
    download(blob, suffixName(name, `${st.scale}x`, st.fmt))
    toast(`Saved ${lastInfo?.w} x ${lastInfo?.h} (${formatBytes(blob.size)})`, 'success')
  }

  return () => {
    ctl.abort()
    for (const p of pipes.values()) p.then((h2) => h2.pipe.dispose?.()).catch(() => {})
    pipes.clear()
  }
}
