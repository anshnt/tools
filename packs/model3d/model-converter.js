// 3D model converter: GLB, glTF, STL, OBJ, 3MF, PLY, FBX, DAE, 3DS, OFF and USDZ in, GLB, glTF, STL, OBJ, 3MF, PLY and USDZ out.
// One module serves the generic converter and the focused entries (params.from / params.to). Runs on this device.
import { h, icon, dropzone, fileList, button, busy, progress, field, select, number, toggle, segmented, panel, alert, stack, downloadButton, download, formatBytes, toast } from '../../lib/ui.js'
import { zip, baseName } from '../../lib/files.js'
import { convertModel, FORMATS, READ_EXTS, WRITE_EXTS, COMPANION_EXTS, isModelFile, UNIT_PRESETS, AXIS_CHOICES, PLACE_CHOICES } from './_model.js'

const IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
const companionsFor = (from) => (from === 'gltf' ? ['bin', ...IMAGES] : from === 'obj' ? ['mtl', ...IMAGES] : from === 'fbx' || from === 'dae' || from === '3ds' ? IMAGES : [])

export function mount(root, { params = {}, signal }) {
  const from = params.from, fixedTo = params.to
  const accept = (from ? [from, ...companionsFor(from)] : [...READ_EXTS, ...COMPANION_EXTS]).map((e) => '.' + e).join(',')
  const o = { to: fixedTo || 'glb', units: '1', scale: 1, axis: 'keep', place: 'keep', merge: false, repair: !!params.repair, binary: true }
  let results = []

  const zone = dropzone({
    accept, multiple: true, icon: 'box',
    label: from ? `Drop ${FORMATS[from].label} files here or click to choose` : undefined,
    hint: from === 'gltf' ? 'Add the .bin and texture files too, if the glTF has them' : from === 'obj' ? 'Add the .mtl and texture images too, if you have them' : from ? undefined : 'Models plus their .bin, .mtl and texture files',
    onFiles: (fs) => { list.add(fs); sync() },
  })
  const list = fileList({ sortable: false, onChange: () => sync() })
  const toSeg = fixedTo ? null : segmented(WRITE_EXTS.map((e) => [e, FORMATS[e].label]), o.to, (v) => { o.to = v; sync() }, 'Convert to')
  const formatNote = h('p', { class: 'small muted' })
  const unitsSel = select(UNIT_PRESETS, o.units, (v) => { o.units = v })
  const scaleNum = number(1, { min: 0, onInput: (n) => { o.scale = n > 0 ? n : 1 } })
  const axisSel = select(AXIS_CHOICES, o.axis, (v) => { o.axis = v })
  const placeSel = select(PLACE_CHOICES, o.place, (v) => { o.place = v })
  const mergeT = toggle('Merge all meshes into one', o.merge, (v) => { o.merge = v })
  const repairT = toggle('Repair the mesh (merge duplicate vertices, fix inside-out faces)', o.repair, (v) => { o.repair = v })
  const binT = toggle('Binary file (smaller and faster)', true, (v) => { o.binary = v })
  const printHint = h('div', { class: 'small muted' })
  const extraNote = h('p', { class: 'small muted' })
  const prog = progress('Converting')
  const out = h('div', { class: 'stack' })
  const go = button('Convert', { variant: 'primary', size: 'lg', icon: 'repeat-2', block: true })

  function sources() { return list.files.filter(isModelFile) }
  function sync() {
    const models = sources(), extras = list.files.length - models.length
    go.hidden = !models.length
    list.el.hidden = !list.files.length
    panelEl.hidden = !models.length
    toSeg?.set(o.to)
    binT.hidden = !(o.to === 'stl' || o.to === 'ply')
    formatNote.textContent = { glb: 'One compact file with geometry, materials, textures and animation. Works in most 3D tools, web viewers and game engines.', gltf: 'The same as GLB as a readable JSON file, with textures and data embedded inside it.', stl: 'Plain triangles, no colours or textures. The standard for 3D printing.', obj: 'Widely supported. Materials go into a .mtl file and textures into PNG files next to it.', '3mf': 'Modern 3D printing format in millimetres, smaller and more precise than STL. Keeps colours.', ply: 'Common for 3D scans. Keeps vertex colours, and point clouds stay point clouds.', usdz: 'AR format for iPhone and iPad (also opens in many 3D tools).' }[o.to] || ''
    const printing = ['stl', '3mf', 'ply'].includes(o.to)
    const web = models.some((f) => ['glb', 'gltf', 'usdz'].includes(f.name.split('.').pop().toLowerCase()))
    printHint.replaceChildren()
    if (printing && web) printHint.append('glTF and USDZ files are Y-up and in metres, printers expect Z-up and millimetres. ', button('Use print settings', { size: 'sm', onClick: () => { o.axis = 'y-to-z'; o.units = '1000'; axisSel.value = 'y-to-z'; unitsSel.value = '1000' } }))
    else if (!printing && models.some((f) => ['stl', '3mf'].includes(f.name.split('.').pop().toLowerCase())) && ['glb', 'gltf', 'usdz'].includes(o.to)) printHint.append('STL and 3MF files are Z-up and in millimetres, glTF viewers expect Y-up and metres. ', button('Use web settings', { size: 'sm', onClick: () => { o.axis = 'z-to-y'; o.units = '0.001'; axisSel.value = 'z-to-y'; unitsSel.value = '0.001' } }))
    extraNote.textContent = extras ? `${extras} extra file${extras > 1 ? 's' : ''} (textures, .bin or .mtl) will be used when the model asks for them.` : ''
    go.querySelector('span').textContent = models.length > 1 ? `Convert ${models.length} models to ${FORMATS[o.to].label}` : `Convert to ${FORMATS[o.to].label}`
  }

  const panelEl = panel(
    toSeg && field('Convert to', toSeg),
    formatNote,
    h('div', { class: 'grid-2' }, field('Units', unitsSel), field('Extra scale', scaleNum, 'Multiplies the size, 1 keeps it')),
    h('div', { class: 'grid-2' }, field('Up axis', axisSel), field('Position', placeSel)),
    printHint,
    mergeT, repairT, binT, extraNote,
  )
  panelEl.classList.add('stack')

  go.addEventListener('click', () => busy(go, async () => {
    const models = [...sources()], extras = list.files.filter((f) => !isModelFile(f))
    if (!models.length) return
    list.setDisabled(true)
    results = []
    out.replaceChildren()
    const notes = []
    try {
      for (const [i, m] of models.entries()) {
        prog.set(i / models.length, `Converting ${m.name}`)
        try {
          const r = await convertModel(m, extras, o.to, o, { signal, onProgress: (f) => prog.set((i + f) / models.length, `Converting ${m.name}`) })
          results.push(...r.files.map((f) => ({ file: f, from: m })))
          for (const n of r.notes) notes.push(`${m.name}: ${n}`)
        } catch (e) {
          if (e?.code === 'ABORT') return
          results.push({ error: e.message || String(e), from: m })
        }
      }
    } finally { list.setDisabled(false) }
    render(notes)
  }, { label: 'Converting', progress: prog }))

  function render(notes) {
    const ok = results.filter((r) => r.file)
    const rows = results.map((r) => (r.file
      ? h('li', { class: 'file-item' }, h('div', { class: 'thumb' }, icon('box')),
        h('div', { class: 'meta' }, h('div', { class: 'name', title: r.file.name }, r.file.name), h('div', { class: 'size' }, `${formatBytes(r.from.size)} to ${formatBytes(r.file.size)}`)),
        downloadButton(r.file, r.file.name, 'Download', { size: 'sm' }))
      : h('li', { class: 'file-item' }, h('div', { class: 'thumb' }, icon('circle-alert')), h('div', { class: 'meta' }, h('div', { class: 'name' }, r.from.name), h('div', { class: 'size' }, r.error)))))
    out.replaceChildren(
      ok.length ? alert('success', `Done. ${ok.length} file${ok.length > 1 ? 's' : ''} ready, nothing left your device.`) : alert('error', 'Nothing could be converted.'),
      h('ul', { class: 'file-list' }, rows),
      ...notes.map((n) => h('p', { class: 'small muted' }, n)),
      ok.length > 1 ? button('Download all (ZIP)', { icon: 'download', variant: 'primary', onClick: async () => download(await zip(ok.map((r) => ({ name: r.file.name, data: r.file }))), `${baseName(ok[0].file.name)}-${o.to}.zip`) }) : null,
    )
    if (ok.length) toast('Converted', 'success')
  }

  root.append(stack(
    zone, list.el, panelEl, go, prog.el, out,
    h('p', { class: 'small muted' }, 'Models are read and converted in this tab. Nothing is uploaded. glTF files that point to separate .bin or texture files need those files dropped with them.'),
  ))
  sync()
}
