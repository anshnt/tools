// Animation maker: pictures (or a GIF / APNG) in, animated PNG or GIF out.
import {
  h, dropzone, fileList, button, busy, progress, segmented, select, toggle, number, field, panel, alert, downloadButton, formatBytes, onCleanup,
} from '../../lib/ui.js'
import { decodeFile, rasterOf } from './_decode.js'
import { encodeFrames } from './_encode.js'
import { resizeRaster, newCanvas, toCanvas, fromCanvas } from './_raster.js'

const ACCEPT = '.png,.apng,.gif,.jpg,.jpeg,.webp,.bmp,.avif,.tif,.tiff,.tga,.qoi,.pcx,.ppm,.pgm,.pbm,.jxl,.heic,.heif'

function fitInto(r, w, hh) {
  if (r.width === w && r.height === hh) return r
  const k = Math.min(w / r.width, hh / r.height)
  const sw = Math.max(1, Math.round(r.width * k)), sh = Math.max(1, Math.round(r.height * k))
  const scaled = resizeRaster(r, sw, sh)
  const c = newCanvas(w, hh)
  c.getContext('2d').drawImage(toCanvas(scaled), Math.round((w - sw) / 2), Math.round((hh - sh) / 2))
  return fromCanvas(c)
}

export function mount(root, { params = {}, signal }) {
  let files = []
  let format = params.to || 'apng'
  const o = { delay: 100, keepDelays: true, maxWidth: 0, colors: 0, loop: 'forever' }
  let url = null
  onCleanup(() => url && URL.revokeObjectURL(url))

  const list = fileList({ onChange: (f) => { files = f; refresh() } })
  const dz = dropzone({ accept: ACCEPT, multiple: true, label: 'Drop pictures here or click to choose', hint: 'Several pictures make an animation. A GIF or animated PNG is split and rebuilt.', onFiles: (fs) => { files = [...files, ...fs]; list.set(files); refresh() } })
  const fmt = segmented([['apng', 'Animated PNG'], ['gif', 'Animated GIF']], format, (v) => { format = v; refresh() }, 'Output format')
  const delay = number(100, { min: 20, max: 10000, step: 10, ariaLabel: 'Frame delay in milliseconds', onInput: (n) => { o.delay = Number.isFinite(n) ? Math.max(20, n) : 100 } })
  const keep = toggle('Keep the delays of GIF and APNG frames', true, (v) => { o.keepDelays = v })
  const maxW = number(0, { min: 0, placeholder: 'Same as the first picture', ariaLabel: 'Maximum width', onInput: (n) => { o.maxWidth = n || 0 } })
  const colors = field('Colors (APNG)', select([['0', 'All colors, lossless'], ['256', 'Reduce to 256 colors (smaller)'], ['64', 'Reduce to 64 colors (smallest)']], '0', (v) => { o.colors = +v }))
  const loop = field('Repeat (GIF)', select([['forever', 'Forever'], ['once', 'Play once']], 'forever', (v) => { o.loop = v }))
  const prog = progress('Building')
  const out = h('div', { class: 'stack', 'aria-live': 'polite' })
  const go = button('Make animation', { icon: 'clapperboard', variant: 'primary', size: 'lg', block: true, onClick: make })
  const opts = panel(h('h2', 'Options'), field('Save as', fmt),
    field('Delay between pictures (ms)', delay, 'Used for still pictures. 100 ms is 10 frames per second.'), keep,
    field('Width (px)', maxW, 'Leave empty to use the size of the first picture.'), colors, loop)

  function refresh() {
    opts.hidden = go.hidden = list.el.hidden = !files.length
    colors.hidden = format !== 'apng'
    loop.hidden = format !== 'gif'
  }

  async function make() {
    const batch = [...files]
    if (!batch.length) return
    list.setDisabled(true)
    out.replaceChildren()
    if (url) { URL.revokeObjectURL(url); url = null }
    await busy(go, async () => {
      const frames = []
      for (let i = 0; i < batch.length; i++) {
        prog.set((i / batch.length) * 0.6, `Reading ${batch[i].name}`)
        const dec = await decodeFile(batch[i], { pages: 'all' }, { signal })
        const animated = dec.frames.length > 1 && ['gif', 'apng'].includes(dec.kind)
        try { for (const f of dec.frames) frames.push({ raster: await rasterOf(f), delay: animated && o.keepDelays ? f.delay || o.delay : o.delay }) } finally { dec.close?.() }
      }
      if (frames.length < 2) throw new Error('Add at least two pictures, or one animated GIF or PNG, to make an animation.')
      if (frames.length > 600) throw new Error('That is too many frames. Use 600 or fewer.')
      let w = frames[0].raster.width, hh = frames[0].raster.height
      if (o.maxWidth > 0 && o.maxWidth < w) { hh = Math.max(1, Math.round((hh * o.maxWidth) / w)); w = Math.round(o.maxWidth) }
      prog.set(0.7, 'Building the animation')
      const fitted = frames.map((f) => ({ ...f, raster: fitInto(f.raster, w, hh) }))
      const { blob, ext } = await encodeFrames(fitted, format, { apngColors: o.colors, loop: o.loop })
      prog.set(1, 'Done')
      url = URL.createObjectURL(blob)
      const name = `animation.${ext}`
      out.replaceChildren(
        alert('success', `${fitted.length} frames, ${w} x ${hh} px, ${formatBytes(blob.size)}.`),
        h('div', { class: 'preview' }, h('img', { src: url, alt: 'Preview of the animation', style: 'max-width:100%;height:auto' })),
        downloadButton(blob, name, `Download ${format === 'apng' ? 'animated PNG' : 'GIF'}`, { size: 'lg' }),
        h('p', { class: 'muted small' }, format === 'apng' ? 'Animated PNG plays in every current browser. Older apps may show only the first frame.' : 'GIF is limited to 256 colors per frame.'))
    }, { label: 'Building', errorTo: out, progress: prog })
    list.setDisabled(false)
  }

  root.append(h('div', { class: 'stack' }, dz, list.el, opts, go, prog.el, out, h('p', { class: 'muted small' }, 'Everything is built on your device. Nothing is uploaded.')))
  refresh()
}
