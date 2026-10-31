// Render a picture (PNG or JPG) of a 3D model from a chosen angle. Runs on this device with WebGL.
import { h, dropzone, fileList, button, busy, progress, field, select, number, toggle, segmented, panel, alert, stack, preview, downloadButton, download, formatBytes, debounce, toast } from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import { convertModel, isModelFile, ACCEPT } from './_model.js'
import { ANGLES } from './_stage.js'

export function mount(root, { signal }) {
  const o = { type: 'png', angle: 'iso', size: 1024, transparent: false, wireframe: false }
  let results = []
  const list = fileList({ sortable: false, onChange: () => { sync(); previewNow() } })
  const zone = dropzone({ accept: ACCEPT, multiple: true, icon: 'box', label: 'Drop 3D models here or click to choose', hint: 'GLB, glTF, STL, OBJ, 3MF, PLY, FBX, DAE, 3DS, OFF, USDZ. Add .mtl and textures too.', onFiles: (fs) => { list.add(fs); sync(); previewNow() } })
  const typeSeg = segmented([['png', 'PNG'], ['jpg', 'JPG']], o.type, (v) => { o.type = v; sync(); previewNow() }, 'Image format')
  const angleSel = select(ANGLES, o.angle, (v) => { o.angle = v; previewNow() })
  const sizeNum = number(o.size, { min: 64, max: 4096, onInput: (n) => { if (n >= 64 && n <= 4096) o.size = Math.round(n) } })
  const trans = toggle('Transparent background (PNG)', false, (v) => { o.transparent = v; previewNow() })
  const wire = toggle('Wireframe', false, (v) => { o.wireframe = v; previewNow() })
  const prev = h('div', { class: 'preview' })
  const prog = progress('Rendering')
  const out = h('div', { class: 'stack' })
  const go = button('Render image', { variant: 'primary', size: 'lg', icon: 'image', block: true })
  const opts = panel(field('Format', typeSeg), field('View', angleSel), field('Image size (px, square)', sizeNum, 'Up to 4096'), trans, wire, preview(prev), go)
  opts.classList.add('stack')
  opts.hidden = true

  const sources = () => list.files.filter(isModelFile)
  const extras = () => list.files.filter((f) => !isModelFile(f))
  function sync() {
    const n = sources().length
    opts.hidden = !n
    trans.hidden = o.type !== 'png'
    go.querySelector('span').textContent = n > 1 ? `Render ${n} images` : 'Render image'
  }

  let token = 0, url = ''
  const previewNow = debounce(async () => {
    const m = sources()[0]
    if (!m) return
    if (m.size > 25e6) { prev.replaceChildren(h('p', { class: 'small muted', style: 'padding:12px' }, 'Preview skipped for a large file. Press Render image.')); return }
    const t = ++token
    try {
      const r = await convertModel(m, extras(), o.type, { ...o, size: 480 }, { signal })
      if (t !== token) return
      if (url) URL.revokeObjectURL(url)
      url = URL.createObjectURL(r.files[0])
      prev.replaceChildren(h('img', { src: url, alt: `Preview of ${m.name}`, style: 'max-width:100%;height:auto;display:block;margin:auto' }))
    } catch (e) {
      if (e?.code !== 'ABORT') prev.replaceChildren(alert('error', e.message || String(e)))
    }
  }, 300)

  go.addEventListener('click', () => busy(go, async () => {
    const models = [...sources()], ex = [...extras()]
    results = []
    list.setDisabled(true)
    try {
      for (const [i, m] of models.entries()) {
        prog.set(i / models.length, `Rendering ${m.name}`)
        try {
          const r = await convertModel(m, ex, o.type, o, { signal })
          results.push({ file: r.files[0], from: m, notes: r.notes })
        } catch (e) { if (e?.code === 'ABORT') return; results.push({ error: e.message || String(e), from: m }) }
      }
    } finally { list.setDisabled(false) }
    const ok = results.filter((r) => r.file)
    out.replaceChildren(
      ...results.map((r) => (r.file
        ? h('div', { class: 'panel' }, preview(h('img', { src: URL.createObjectURL(r.file), alt: r.file.name, style: 'max-width:100%;height:auto;display:block;margin:auto' })),
          h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'small muted' }, `${r.file.name}, ${formatBytes(r.file.size)}`), downloadButton(r.file, r.file.name, 'Download', { size: 'sm' })))
        : alert('error', `${r.from.name}: ${r.error}`))),
      ok.length > 1 ? button('Download all (ZIP)', { icon: 'download', variant: 'primary', onClick: async () => download(await zip(ok.map((r) => ({ name: r.file.name, data: r.file }))), '3d-previews.zip') }) : null,
    )
    if (ok.length) toast('Image ready', 'success')
  }, { label: 'Rendering', progress: prog }))

  root.append(stack(zone, list.el, opts, prog.el, out, h('p', { class: 'small muted' }, 'Rendered on your device with WebGL. Nothing is uploaded.')))
  sync()
}
