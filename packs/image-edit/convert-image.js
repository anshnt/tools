// Image converter. One module for the generic converter and the focused JPG to PNG, PNG to WebP, ... entries (params.from / params.to).
// JPG, PNG, WebP and AVIF use the browser; GIF, BMP and ICO use our own encoders.
import { progress, toggle, formatBytes } from '../../lib/ui.js'
import {
  shell, h, icon, button, busy, field, chips, multiChips, section, note, hint, slider, colorField, batchSlot, results, runBatch, readSource, previewCanvas, encode, FORMATS, canWrite, outName,
  clear, toast, errorMessage, tiles, stage,
} from './_kit.js'
import { gifInfo, sniff } from './_meta.js'

const ACCEPT = { jpg: '.jpg,.jpeg,image/jpeg', png: '.png,image/png', webp: '.webp,image/webp', gif: '.gif,image/gif', bmp: '.bmp,image/bmp', avif: '.avif,image/avif' }
const LABEL = { jpg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', gif: 'GIF', bmp: 'BMP', ico: 'ICO' }
const BLURB = {
  jpg: 'Small photos that work everywhere. Transparency becomes the background color.',
  png: 'Lossless and sharp, keeps transparency. Files are larger than JPG.',
  webp: 'Modern, much smaller than JPG or PNG, keeps transparency.',
  avif: 'The smallest files at the same quality. Chrome and Edge can save it.',
  gif: 'Up to 256 colors with simple transparency. Animated GIFs convert their first frame.',
  bmp: 'Uncompressed bitmap for old software. Files are big.',
  ico: 'Windows icon with several sizes inside, great for favicons.',
}
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

export function mount(root, { params, signal }) {
  const fixedTo = params.to, from = params.from
  const o = { to: fixedTo || 'png', quality: 90, bg: '#ffffff', colors: 256, dither: true, icoSizes: [16, 32, 48], icoFit: 'contain', gifBg: 'transparent' }

  // ----- header banner for focused tools
  const banner = fixedTo ? h('div', { class: 'ie-conv' },
    h('span', { class: 'ie-conv-tag' }, LABEL[from] || 'IMAGE'), h('span', { class: 'ie-conv-arrow' }, icon('arrow-right')), h('span', { class: ['ie-conv-tag', 'to'] }, LABEL[fixedTo]),
    h('div', { class: 'ie-note' }, BLURB[fixedTo])) : null

  const order = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'ico'].filter(canWrite)
  const toChips = chips(order.map((f) => [f, LABEL[f]]), o.to, (v) => { o.to = v; syncOpts() }, { label: 'Convert to' })
  const note1 = h('div', { class: 'ie-note' })
  const q = slider('Quality', { min: 40, max: 100, value: 90, format: (v) => `${v}%`, onInput: (v) => { o.quality = v } })
  const bg = colorField('Background (replaces transparency)', '#ffffff', (v) => { o.bg = v }, { swatches: ['#ffffff', '#000000', '#f3f4f6'] })
  const gifBg = colorField('Background', 'transparent', (v) => { o.gifBg = v }, { swatches: ['#ffffff', '#000000'], none: true })
  const colors = slider('Colors', { min: 2, max: 256, step: 1, value: 256, format: (v) => `${v}`, onInput: (v) => { o.colors = v } })
  const dither = toggle('Smooth gradients (dithering)', true, (v) => { o.dither = v })
  const icoSizes = multiChips(ICO_SIZES.map((s) => [s, `${s}`]), o.icoSizes, (v) => { o.icoSizes = v })
  const icoFit = chips([['contain', 'Pad to square'], ['cover', 'Crop to square']], 'contain', (v) => { o.icoFit = v }, { label: 'Non-square images' })
  const optBox = h('div', { class: 'ie-sec' }, q, bg, gifBg, colors, dither, h('div', { class: 'ie-sec' }, field('Icon sizes (px)', icoSizes), icoFit))
  const icoBox = optBox.lastChild

  function syncOpts() {
    const t = o.to
    q.hidden = !FORMATS[t].lossy
    bg.hidden = !(t === 'jpg' || t === 'bmp')
    gifBg.hidden = t !== 'gif'
    colors.hidden = dither.hidden = t !== 'gif'
    icoBox.hidden = t !== 'ico'
    note1.textContent = BLURB[t]
  }

  const prog = progress()
  const res = results({ zipName: `converted-${o.to}.zip`, compare: false, noun: 'image' })
  const goBtn = button('Convert', { icon: 'repeat-2', variant: 'primary', size: 'lg', block: true })
  const slot = batchSlot({
    accept: from ? ACCEPT[from] : 'image/*', ic: 'repeat-2',
    label: from ? `Drop ${LABEL[from]} files here or click to choose` : undefined,
    formats: from ? [LABEL[from]] : undefined,
    onChange: (fs) => { retitle(); work.hidden = !fs.length },
    onSelect: async (file) => {
      if (!file) return
      try {
        const src = await readSource(file)
        const kind = sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer())) || src.type.replace('image/', '')
        previewHost.replaceChildren(previewCanvas(src.img, 900))
        clear(facts, tiles([{ label: 'Now', value: String(kind).toUpperCase(), sub: `${src.w} x ${src.h} px` }, { label: 'File size', value: formatBytes(file.size) }]))
      } catch (e) { toast(errorMessage(e), 'error') }
    },
  })
  const previewHost = stage(h('div', { class: 'ie-note' }, 'Preview'))
  const facts = h('div')
  const retitle = () => { const n = slot.files.length; goBtn.querySelector('span').textContent = n > 1 ? `Convert ${n} images to ${LABEL[o.to]}` : `Convert to ${LABEL[o.to]}` }
  toChips.addEventListener('click', retitle)

  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...slot.files]
    if (!files.length) return
    const to = o.to
    await runBatch(files, async (file) => {
      const src = await readSource(file)
      let c = previewCanvas(src.img, 1e6)
      if (to === 'ico' && Math.max(src.w, src.h) > 1024) c = previewCanvas(src.img, 1024)
      let noteText = ''
      if (sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer())) === 'gif') {
        const info = gifInfo(new Uint8Array(await file.arrayBuffer()))
        if (info.frames > 1) noteText = 'first frame only'
      }
      const blob = await encode(c, to, {
        quality: o.quality / 100, background: to === 'gif' ? (o.gifBg === 'transparent' ? undefined : o.gifBg) : to === 'jpg' || to === 'bmp' ? o.bg : undefined, colors: o.colors, dither: o.dither, sizes: o.icoSizes, icoFit: o.icoFit,
      })
      return { name: outName(file.name, '', to), blob, w: to === 'ico' ? Math.max(...o.icoSizes) : c.width, h: to === 'ico' ? Math.max(...o.icoSizes) : c.height, inSize: file.size, badge: LABEL[to], note: to === 'ico' ? `${o.icoSizes.length} sizes${noteText ? ', ' + noteText : ''}` : noteText }
    }, { out: res, prog, signal, label: 'Converting' })
  }, { label: 'Converting', progress: prog }))

  const style = h('style', `
.ie-conv{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 18px;border-radius:22px;border:1px solid var(--border);background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 9%,var(--surface)),var(--surface))}
.ie-conv-tag{font-weight:700;font-size:15px;letter-spacing:.02em;padding:8px 16px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-2)}
.ie-conv-tag.to{background:var(--ie-grad);border-color:transparent;color:var(--accent-text);box-shadow:0 12px 22px -12px var(--accent)}
.ie-conv-arrow{display:grid;place-items:center;color:var(--accent);animation:ie-nudge 1.6s ease-in-out infinite}
.ie-conv .ie-note{flex:1 1 240px}
@keyframes ie-nudge{50%{transform:translateX(5px)}}
@media (prefers-reduced-motion:reduce){.ie-conv-arrow{animation:none}}`)
  const side = h('aside', { class: 'ie-side ie-glass' },
    fixedTo ? null : section('Convert to', 'repeat-2', toChips),
    section(fixedTo ? `${LABEL[fixedTo]} settings` : 'Settings', 'sliders-horizontal', note1, optBox),
    h('div', { class: 'ie-foot' }, goBtn, prog.el))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main pin' }, previewHost, facts, hint('Everything is converted on your device. Nothing is uploaded.', 'shield-check')), side)
  root.append(shell(style, banner, slot.el, work, res.el))
  syncOpts()
  retitle()
}
