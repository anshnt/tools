// Volume, surface area, size and print weight of an STL (or any other 3D model). Runs on this device.
import { h, dropzone, fileList, select, number, field, panel, stack, table, alert, progress, formatNumber, formatBytes, stats as statTiles } from '../../lib/ui.js'
import { readModel, flatten, analyze, isModelFile, ACCEPT, FORMATS } from './_model.js'

const UNITS = [['mm', 'Millimetres'], ['cm', 'Centimetres'], ['m', 'Metres'], ['in', 'Inches']]
const TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4 }
const MATERIALS = [['PLA', 1.24], ['ABS', 1.04], ['PETG', 1.27], ['TPU', 1.21], ['Nylon', 1.14], ['Standard resin', 1.1], ['Aluminium', 2.7], ['Stainless steel', 7.9], ['Brass', 8.5], ['Titanium', 4.43], ['Custom density', 0]]
const defaultUnit = (f) => (['glb', 'gltf', 'usdz', 'dae'].includes(f) ? 'm' : f === 'fbx' ? 'cm' : 'mm')

export function mount(root, { signal }) {
  const o = { unit: 'mm', material: 'PLA', density: 1.24, infill: 100, price: NaN }
  let items = []
  const out = h('div', { class: 'stack' })
  const prog = progress('Measuring')
  const list = fileList({ sortable: false, onChange: () => run() })
  const zone = dropzone({ accept: ACCEPT, multiple: true, icon: 'ruler', label: 'Drop an STL or other 3D model here', hint: 'STL, OBJ, 3MF, PLY, GLB, glTF, FBX and more', onFiles: (fs) => { list.add(fs); run() } })
  const unitSel = select(UNITS, o.unit, (v) => { o.unit = v; draw() })
  const matSel = select(MATERIALS.map(([n, d]) => [n, d ? `${n} (${d} g/cm³)` : n]), o.material, (v) => { o.material = v; const d = MATERIALS.find((m) => m[0] === v)[1]; if (d) { o.density = d; dens.value = d } dens.disabled = !!d; draw() })
  const dens = number(o.density, { min: 0, onInput: (n) => { if (n > 0) { o.density = n; draw() } } })
  dens.disabled = true
  const infill = number(100, { min: 1, max: 100, onInput: (n) => { o.infill = n >= 1 && n <= 100 ? n : 100; draw() } })
  const price = number('', { min: 0, placeholder: 'optional', onInput: (n) => { o.price = n; draw() } })
  const opts = panel(
    h('div', { class: 'grid-2' }, field('Model units', unitSel, 'STL files have no unit, most are in millimetres'), field('Material', matSel)),
    h('div', { class: 'grid-2' }, field('Density (g/cm³)', dens), field('Infill (%)', infill, '100 for solid parts and resin')),
    field('Price per kg (optional)', price, 'Gives a material cost estimate'),
  )
  opts.classList.add('stack')
  opts.hidden = true

  async function run() {
    const models = list.files.filter(isModelFile), extras = list.files.filter((f) => !isModelFile(f))
    opts.hidden = !models.length
    if (!models.length) { items = []; draw(); return }
    prog.set(0, 'Measuring')
    const next = []
    for (const [i, f] of models.entries()) {
      prog.set(i / models.length, `Measuring ${f.name}`)
      try {
        const m = await readModel(f, extras, { signal })
        const s = await analyze(flatten(m.object))
        m.dispose()
        next.push({ name: f.name, format: m.format, size: f.size, s, notes: m.notes })
      } catch (e) {
        if (e?.code === 'ABORT') return
        next.push({ name: f.name, error: e.message || String(e) })
      }
    }
    prog.hide()
    items = next
    if (items[0]?.format && !items[0].error) { o.unit = defaultUnit(items[0].format); unitSel.value = o.unit }
    draw()
  }

  function draw() {
    out.replaceChildren(...items.map((it) => {
      if (it.error) return alert('error', `${it.name}: ${it.error}`)
      const f = TO_MM[o.unit], s = it.s
      const mm3 = s.volume * f ** 3, mm2 = s.area * f ** 2, cm3 = mm3 / 1000
      const grams = cm3 * o.density * (o.infill / 100)
      const dims = s.size.map((v) => v * f)
      return panel(
        h('h2', { style: 'overflow-wrap:anywhere' }, `${it.name}`),
        statTiles([
          { label: 'Volume', value: `${formatNumber(cm3, 3)} cm³`, hint: `${formatNumber(mm3, 0)} mm³, ${formatNumber(mm3 / 16387.064, 3)} in³`, accent: true },
          { label: 'Surface area', value: `${formatNumber(mm2 / 100, 2)} cm²`, hint: `${formatNumber(mm2 / 645.16, 2)} in²` },
          { label: `Weight in ${o.material}`, value: `${formatNumber(grams, 1)} g`, hint: `${formatNumber(grams / 28.3495, 2)} oz${o.infill < 100 ? `, at ${o.infill}% of solid` : ''}` },
          ...(o.price > 0 ? [{ label: 'Material cost', value: formatNumber(grams / 1000 * o.price, 2), hint: 'at your price per kg' }] : []),
        ]),
        s.closed === false ? alert('warn', `This model is not watertight (${formatNumber(s.open + s.nonManifold + s.badWinding, 0)} problem edges), so the volume is only approximate. The STL repair tool can fix many of these.`) : s.closed ? alert('success', 'Watertight: every edge is shared by exactly two triangles, so the volume is exact.') : null,
        table({ columns: ['Measure', { label: 'Value', num: true }], rows: [
          ['Size X x Y x Z', `${formatNumber(dims[0], 2)} x ${formatNumber(dims[1], 2)} x ${formatNumber(dims[2], 2)} mm`],
          ['Size in inches', dims.map((v) => formatNumber(v / 25.4, 3)).join(' x ')],
          ['Triangles', formatNumber(s.triangles, 0)], ['Vertices stored', formatNumber(s.vertices, 0)], ['Separate meshes', formatNumber(s.meshes, 0)],
          ['Format and file size', `${FORMATS[it.format].label}, ${formatBytes(it.size)}`],
        ] }),
        ...it.notes.map((n) => h('p', { class: 'small muted' }, n)),
      )
    }))
  }

  root.append(stack(zone, list.el, opts, prog.el, out, h('p', { class: 'small muted' }, 'Volume is the signed sum of tetrahedra over every triangle, exact for a closed shell. Weight is volume times density times infill, a rough guide that ignores walls and supports.')))
  list.el.hidden = false
}
