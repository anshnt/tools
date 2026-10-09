// Resize image. One module serves three tools: resize-image (pixels, percent, longest side, print size),
// batch-image-resizer (params.batch) and exact-size-image (params.exact: exact W x H with fit, fill or stretch).
import { number, toggle, progress, formatNumber } from '../../lib/ui.js'
import { canvas, MAX_PIXELS } from '../../lib/image.js'
import {
  shell, h, icon, button, busy, field, chips, section, note, hint, tiles, stage, anchorGrid, colorField, outputPicker, encodeWith, batchSlot,
  results, runBatch, readSource, previewCanvas, resample, outName, clear, toast, errorMessage,
} from './_kit.js'
import { setJpegDpi, setPngDpi } from './_meta.js'

const clampPx = (n) => Math.max(1, Math.min(20000, Math.round(n)))
const UNIT_IN = { cm: 1 / 2.54, mm: 1 / 25.4, in: 1 }

function lockSize(o, sw, sh, tw, th) {
  if (!o.lock) return { w: tw, h: th }
  let k = o.driver === 'h' ? th / sh : tw / sw
  if (o.noEnlarge) k = Math.min(1, k)
  return { w: sw * k, h: sh * k }
}

/** Output pixel size for a source of sw x sh under the options, or null when the inputs are incomplete. */
export function computeSize(o, sw, sh) {
  let w, hh
  if (o.mode === 'percent') { w = (sw * o.pct) / 100; hh = (sh * o.pct) / 100 }
  else if (o.mode === 'longest') {
    let k = o.longest / Math.max(sw, sh)
    if (o.noEnlarge) k = Math.min(1, k)
    w = sw * k; hh = sh * k
  } else if (o.mode === 'print') {
    const f = UNIT_IN[o.unit] * o.dpi
    ;({ w, h: hh } = lockSize(o, sw, sh, o.pw * f, o.ph * f))
  } else if (o.mode === 'exact') { w = o.w; hh = o.h }
  else ({ w, h: hh } = lockSize(o, sw, sh, o.w, o.h))
  if (!(w > 0) || !(hh > 0)) return null
  return { w: clampPx(w), h: clampPx(hh) }
}

/** Draw the resized image. fit (exact mode): fill = crop to cover, pad = letterbox, stretch. anchor: 'tl'..'br'. scale shrinks the output for previews. */
export function renderResize(img, plan, { exact = false, fit = 'fill', anchor = 'cc', bg, scale = 1 } = {}) {
  const W = Math.max(1, Math.round(plan.w * scale)), H = Math.max(1, Math.round(plan.h * scale))
  if (W * H > MAX_PIXELS) throw new Error(`${plan.w} x ${plan.h} is too large to create here. Try a smaller size.`)
  if (!exact || fit === 'stretch') return resample(img, W, H)
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height
  const ax = anchor[1] === 'l' ? 0 : anchor[1] === 'r' ? 1 : 0.5, ay = anchor[0] === 't' ? 0 : anchor[0] === 'b' ? 1 : 0.5
  if (fit === 'fill') {
    const k = Math.max(W / iw, H / ih), cw = W / k, ch = H / k
    const crop = canvas(Math.max(1, Math.round(cw)), Math.max(1, Math.round(ch)))
    crop.getContext('2d').drawImage(img, (iw - cw) * ax, (ih - ch) * ay, cw, ch, 0, 0, crop.width, crop.height)
    return resample(crop, W, H)
  }
  const k = Math.min(W / iw, H / ih), dw = Math.max(1, Math.round(iw * k)), dh = Math.max(1, Math.round(ih * k))
  const out = canvas(W, H)
  const ctx = out.getContext('2d')
  if (bg && bg !== 'transparent') { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H) }
  ctx.drawImage(resample(img, dw, dh), Math.round((W - dw) * ax), Math.round((H - dh) * ay))
  return out
}

const PRESETS = [['1080x1080', 'Instagram', 1080, 1080], ['1080x1350', 'Portrait 4:5', 1080, 1350], ['1920x1080', 'Full HD', 1920, 1080], ['1280x720', 'HD 720p', 1280, 720],
  ['1200x630', 'Link preview', 1200, 630], ['512x512', 'App icon', 512, 512], ['413x531', 'Passport 35x45', 413, 531], ['300x300', 'Avatar', 300, 300]]
const LONGEST = [256, 640, 800, 1024, 1280, 1600, 1920, 2560]

export function mount(root, { params, signal }) {
  const exact = !!params.exact, batch = !!params.batch
  const o = {
    mode: exact ? 'exact' : batch ? 'longest' : 'pixels', w: NaN, h: NaN, lock: true, driver: 'w', pct: 50, longest: 1600, noEnlarge: batch,
    unit: 'cm', pw: 10, ph: 15, dpi: 300, embedDpi: true, fit: 'fill', anchor: 'cc', pad: '#ffffff',
  }
  let active = null // {file, src, prev}
  let seq = 0

  // ----- inputs
  const numIns = { w: [], h: [] }
  const px = (key, aria) => {
    const el = number('', { min: 1, step: 1, placeholder: key === 'w' ? 'Width' : 'Height', ariaLabel: aria, onInput: (v) => { o[key] = v; o.driver = key; update() } })
    numIns[key].push(el)
    return el
  }
  const locks = []
  const lockButton = () => {
    const b = h('button', { type: 'button', class: 'ie-chip', 'aria-pressed': String(o.lock), title: 'Keep aspect ratio', onclick: () => { o.lock = !o.lock; locks.forEach((l) => l.setAttribute('aria-pressed', String(o.lock))); update() } }, icon('link'), h('span', 'Keep aspect ratio'))
    locks.push(b)
    return b
  }
  const noEnl = toggle('Never enlarge small images', o.noEnlarge, (v) => { o.noEnlarge = v; update() })
  const pctIn = number(50, { min: 1, max: 1000, step: 1, ariaLabel: 'Percent', onInput: (v) => { o.pct = v; pctChips.set(null); update() } })
  const pctChips = chips([[25, '25%'], [50, '50%'], [75, '75%'], [150, '150%'], [200, '200%']], 50, (v) => { o.pct = v; pctIn.value = v; update() })
  const longIn = number(1600, { min: 16, max: 20000, step: 1, ariaLabel: 'Longest side in pixels', onInput: (v) => { o.longest = v; longChips.set(null); update() } })
  const longChips = chips(LONGEST.map((n) => [n, String(n)]), 1600, (v) => { o.longest = v; longIn.value = v; update() })
  const unitSel = chips([['cm', 'cm'], ['mm', 'mm'], ['in', 'inches']], 'cm', (v) => { o.unit = v; update() })
  const pwIn = number(10, { min: 0.1, step: 0.1, ariaLabel: 'Print width', onInput: (v) => { o.pw = v; o.driver = 'w'; update() } })
  const phIn = number(15, { min: 0.1, step: 0.1, ariaLabel: 'Print height', onInput: (v) => { o.ph = v; o.driver = 'h'; update() } })
  const dpiChips = chips([[72, '72'], [150, '150'], [300, '300'], [600, '600']], 300, (v) => { o.dpi = v; update() })
  const embed = toggle('Save the DPI in the file (JPG and PNG)', true, (v) => { o.embedDpi = v })
  const fitChips = chips([['fill', 'Crop to fill', 'crop'], ['pad', 'Fit + padding', 'frame'], ['stretch', 'Stretch', 'move-diagonal']], 'fill', (v) => { o.fit = v; syncFit(); update() })
  const anchor = anchorGrid('cc', (v) => { o.anchor = v; update() })
  const padColor = colorField('Padding color', '#ffffff', (v) => { o.pad = v; update() }, { swatches: ['#ffffff', '#000000', '#f3f4f6'], none: true })
  const anchorBox = section('Focus', 'crosshair', anchor, note('Choose which part of the photo stays in frame, or where it sits inside the padding.'))
  const out = outputPicker({ formats: ['jpg', 'png', 'webp'], value: 'same' })

  const modeChips = chips([['pixels', 'Pixels', 'ruler'], ['percent', 'Percent', 'percent'], ['longest', 'Longest side', 'maximize'], ['print', 'Print size', 'printer']], o.mode, (v) => { o.mode = v; syncMode(); update() }, { label: 'Resize by' })
  const pxBox = h('div', { class: 'stack' }, h('div', { class: 'ie-row2' }, field('Width (px)', px('w', 'Width in pixels')), field('Height (px)', px('h', 'Height in pixels'))), h('div', { class: 'row' }, lockButton()))
  const pctBox = h('div', { class: 'stack' }, pctChips, field('Custom percent', pctIn))
  const longBox = h('div', { class: 'stack' }, longChips, field('Longest side (px)', longIn), note('The longer edge becomes this size and the other edge follows. Every image keeps its own shape.'))
  const printBox = h('div', { class: 'stack' }, unitSel, h('div', { class: 'ie-row2' }, field('Width', pwIn), field('Height', phIn)), field('Print quality (DPI)', dpiChips, '300 DPI is sharp photo quality; 150 is fine for posters.'), embed, h('div', { class: 'row' }, lockButton()))
  const exactBox = h('div', { class: 'stack' },
    h('div', { class: 'ie-chips' }, PRESETS.map(([id, label, w, hh]) => h('button', { type: 'button', class: 'ie-chip', onclick: () => { o.w = w; o.h = hh; syncInputs(); update() } }, label, h('small', id)))),
    h('div', { class: 'ie-row2' }, field('Width (px)', px('w', 'Width in pixels')), field('Height (px)', px('h', 'Height in pixels'))),
    field('When the shape differs', fitChips))
  const syncInputs = () => { for (const k of ['w', 'h']) if (Number.isFinite(o[k])) numIns[k].forEach((el) => { el.value = o[k] }) }

  function syncMode() {
    pxBox.hidden = o.mode !== 'pixels' || exact; pctBox.hidden = o.mode !== 'percent'; longBox.hidden = o.mode !== 'longest'; printBox.hidden = o.mode !== 'print'
    noEnl.hidden = exact || !(o.mode === 'longest' || o.mode === 'pixels')
  }
  function syncFit() { anchorBox.hidden = !exact || o.fit === 'stretch'; padColor.hidden = o.fit !== 'pad' }
  const modeSec = exact ? section('Exact size', 'frame', exactBox, padColor) : section('Resize by', 'scaling', modeChips, pxBox, pctBox, longBox, printBox, noEnl)

  // ----- preview and plan
  const previewHost = stage(h('div', { class: 'ie-center ie-note' }, 'Your preview appears here.'))
  const tileHost = h('div')
  const planFor = (src) => (src ? computeSize(o, src.w, src.h) : null)
  const optsFor = () => ({ exact, fit: o.fit, anchor: o.anchor, bg: o.pad })
  const dim = (w, hh) => `${w} x ${hh}`

  function update() {
    if (!active) return
    const { src, prev } = active
    const plan = planFor(src)
    if (!plan) {
      clear(tileHost, hint('Enter a width and height to see the preview.', 'ruler'))
      goBtn.disabled = true
      return
    }
    // keep the number inputs in step with the locked aspect ratio
    if (o.mode === 'pixels' && o.lock) { if (o.driver === 'w') numIns.h.forEach((el) => { el.value = plan.h }); else numIns.w.forEach((el) => { el.value = plan.w }) }
    if (o.mode === 'print' && o.lock) { if (o.driver === 'w') phIn.value = +((plan.h / o.dpi) / UNIT_IN[o.unit]).toFixed(2); else pwIn.value = +((plan.w / o.dpi) / UNIT_IN[o.unit]).toFixed(2) }
    const over = plan.w * plan.h > MAX_PIXELS
    goBtn.disabled = over
    const scale = Math.min(1, 900 / Math.max(plan.w, plan.h))
    const token = ++seq
    requestAnimationFrame(() => {
      if (token !== seq) return
      try {
        const c = renderResize(prev, plan, { ...optsFor(), scale })
        c.setAttribute('aria-label', `Preview at ${dim(plan.w, plan.h)} pixels`)
        previewHost.classList.remove('busy')
        previewHost.replaceChildren(c)
      } catch (e) { previewHost.replaceChildren(h('div', { class: 'ie-note' }, errorMessage(e))) }
    })
    const k = (plan.w * plan.h) / (src.w * src.h)
    clear(tileHost, tiles([
      { label: 'Original', value: dim(src.w, src.h), sub: `${formatNumber((src.w * src.h) / 1e6, 1)} megapixels` },
      { label: 'New size', value: dim(plan.w, plan.h), sub: over ? 'Too large for this device' : `${formatNumber((plan.w * plan.h) / 1e6, 2)} megapixels`, hot: !over, bad: over },
      { label: 'Pixels', value: `${k > 1 ? '+' : ''}${formatNumber((k - 1) * 100, 0)}%`, sub: k === 1 ? 'Same pixel count' : k > 1 ? 'More pixels: enlarging cannot add detail' : 'Fewer pixels: smaller file', good: k < 1 },
      ...(o.mode === 'print' ? [{ label: 'Print size', value: `${formatNumber(plan.w / o.dpi / UNIT_IN[o.unit], 1)} x ${formatNumber(plan.h / o.dpi / UNIT_IN[o.unit], 1)} ${o.unit}`, sub: `at ${o.dpi} DPI` }] : []),
    ]))
  }

  async function select(file) {
    if (!file) { active = null; work.hidden = true; return }
    previewHost.classList.add('busy')
    try {
      const src = await readSource(file)
      const prev = previewCanvas(src.img, 1400)
      active = { file, src, prev }
      if (!exact && !Number.isFinite(o.w) && !Number.isFinite(o.h)) { o.w = src.w; o.h = src.h; o.driver = 'w' }
      if (exact && !Number.isFinite(o.w)) { o.w = 1080; o.h = 1080 }
      syncInputs()
      work.hidden = false
      update()
    } catch (e) { toast(errorMessage(e), 'error'); previewHost.classList.remove('busy') }
  }
  const slot = batchSlot({
    label: batch ? 'Drop a pile of images here, or click to choose' : undefined,
    onChange: (fs) => { goBtn.querySelector('span').textContent = fs.length > 1 ? `Resize ${fs.length} images` : 'Resize image'; if (!fs.length) select(null) },
    onSelect: (f) => select(f),
  })

  // ----- run
  const prog = progress()
  const res = results({ zipName: batch ? 'resized-images.zip' : exact ? 'exact-size-images.zip' : 'resized-images.zip', noun: 'image' })
  const goBtn = button('Resize image', { icon: 'scaling', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return toast('Add at least one image first.', 'error')
    await runBatch(files, async (file) => {
      const src = await readSource(file)
      const plan = computeSize(o, src.w, src.h)
      if (!plan) throw new Error('Enter a width and height first.')
      const c = renderResize(src.img, plan, optsFor())
      const pick = out.resolve(src)
      let blob = await encodeWith(c, { ...pick, bg: exact && o.fit === 'pad' && o.pad !== 'transparent' ? o.pad : pick.bg })
      if (o.mode === 'print' && o.embedDpi && (pick.fmt === 'jpg' || pick.fmt === 'png')) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        blob = new Blob([pick.fmt === 'jpg' ? setJpegDpi(bytes, o.dpi) : setPngDpi(bytes, o.dpi)], { type: blob.type })
      }
      return { name: outName(file.name, `${plan.w}x${plan.h}`, pick.fmt), blob, w: plan.w, h: plan.h, inSize: file.size, original: file }
    }, { out: res, prog, signal, label: 'Resizing' })
  }, { label: 'Resizing', progress: prog }))

  const side = h('aside', { class: 'ie-side ie-glass' }, modeSec, exact ? anchorBox : null, out.el, h('div', { class: 'ie-foot' }, goBtn, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin' }, previewHost, tileHost), side)
  root.append(shell(slot.el, work, res.el))
  syncMode(); syncFit()
}
