// 3D model viewer: orbit, wireframe, grid, bounding box, clay mode, size, triangle counts, volume and surface area, animation, screenshot.
// Opens GLB, glTF, STL, OBJ (+MTL, textures), 3MF, PLY, FBX, DAE, 3DS, OFF and USDZ. Everything stays on this device.
import { h, icon, button, dropzone, select, segmented, toast, download, formatBytes, formatNumber, onCleanup } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { three, addon } from './_three.js'
import { readModel, flatten, analyze, defaultMaterial, isModelFile, upAxisOf, ACCEPT, FORMATS } from './_model.js'
import { displayRoot, frame, studioLight, addLights, forEachMaterial } from './_stage.js'

const UNITS = [['mm', 'Millimetres'], ['cm', 'Centimetres'], ['m', 'Metres'], ['in', 'Inches'], ['ft', 'Feet']]
const TO_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 }
const defaultUnit = (f) => (['glb', 'gltf', 'usdz', 'dae'].includes(f) ? 'm' : f === 'fbx' ? 'cm' : 'mm')
const BACKGROUNDS = [['light', 'Light'], ['dark', 'Dark'], ['clear', 'Transparent']]
const BG = { light: 0xeef0f4, dark: 0x14161a }

const STYLE = `
.mv{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px;height:calc(100dvh - 260px);min-height:440px}
.tool-body.app:fullscreen .mv{height:calc(100dvh - 24px)}
.mv-stage{position:relative;border:1px solid var(--border);border-radius:var(--radius-lg,16px);overflow:hidden;background:var(--surface-2);min-height:300px;touch-action:none}
.mv-stage.clear{background:repeating-conic-gradient(var(--surface-2) 0 25%,var(--surface) 0 50%) 0 0/20px 20px}
.mv-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none}
.mv-bar{position:absolute;top:8px;left:8px;right:8px;display:flex;flex-wrap:wrap;gap:6px;pointer-events:none}
.mv-bar>*{pointer-events:auto}
.mv-bar .btn{background:var(--surface)}
.mv-bar .btn[aria-pressed=true]{background:var(--accent);color:var(--accent-text,#fff);border-color:transparent}
.mv-empty{position:absolute;inset:0;display:grid;place-items:center;padding:16px}
.mv-empty .dropzone{max-width:420px;width:100%}
.mv-busy{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;background:var(--surface);border:1px solid var(--border);font-size:13px}
.mv-side{overflow:auto;display:flex;flex-direction:column;gap:10px;min-width:0}
.mv-side .panel{padding:12px}
.mv-side h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.mv-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-size:14px}
.mv-kv dt{color:var(--muted)}
.mv-kv dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.mv-good{color:var(--success)}.mv-bad{color:var(--danger)}
.mv-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media (max-width:820px){.mv-bar .btn span{display:none}.mv{grid-template-columns:1fr;height:auto}.mv-stage{height:58vh;min-height:320px}.mv-side{overflow:visible}}`

export function mount(root, { signal }) {
  let T, controls, renderer, scene, camera, envTarget
  let model = null, display = null, parts = null, stats = null, upMode = 'y', unit = 'mm'
  let gridHelper = null, boxHelper = null, mixer = null, action = null, clock = null
  const flags = { wire: false, grid: true, box: false, clay: false, bg: 'light' }
  let raf = 0, disposed = false, loading = 0, speed = 1, ro = null

  const stageEl = h('div', { class: 'mv-stage' })
  const canvas = h('canvas', { tabindex: 0, 'aria-label': '3D view. Drag to orbit, scroll to zoom, right-drag to pan.' })
  const busyEl = h('div', { class: 'mv-busy', hidden: true, role: 'status' })
  const empty = h('div', { class: 'mv-empty' }, dropzone({ accept: ACCEPT, multiple: true, icon: 'box', label: 'Drop a 3D model here or click to choose', hint: 'GLB, glTF, STL, OBJ, 3MF, PLY, FBX, DAE, 3DS, OFF, USDZ. Add .mtl and textures too.', onFiles: (f) => open(f) }))

  const toggles = {}
  const tbtn = (key, ic, short, label, onClick, pressed) => {
    const b = button(short, { icon: ic, size: 'sm', ariaLabel: label, title: label, onClick })
    if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed))
    toggles[key] = b
    return b
  }
  const flip = (key) => { flags[key] = !flags[key]; toggles[key].setAttribute('aria-pressed', String(flags[key])) }
  const bar = h('div', { class: 'mv-bar' },
    tbtn('wire', 'grid-3x3', 'Wireframe', 'Wireframe', () => { flip('wire'); applyWire(); render() }, false),
    tbtn('grid', 'layout-grid', 'Grid', 'Floor grid', () => { flip('grid'); syncHelpers(); render() }, true),
    tbtn('box', 'box', 'Box', 'Bounding box', () => { flip('box'); syncHelpers(); render() }, false),
    tbtn('clay', 'palette', 'Plain', 'Plain material (hide colours and textures)', () => { flip('clay'); applyClay(); render() }, false),
    tbtn('up', 'arrow-up', 'Y/Z up', 'Switch between Y-up and Z-up display', () => { if (!display) return; upMode = upMode === 'y' ? 'z' : 'y'; display.rotation.x = upMode === 'z' ? -Math.PI / 2 : 0; display.updateMatrixWorld(true); refit(); toast(`Showing ${upMode.toUpperCase()}-up`) }),
    tbtn('reset', 'rotate-3d', 'Reset', 'Reset the view', () => refit()),
    tbtn('shot', 'camera', 'Screenshot', 'Save a screenshot (PNG)', shot),
  )
  stageEl.append(canvas, bar, empty, busyEl)

  // ----- side panel
  const infoBox = h('div'), dimBox = h('div'), countBox = h('div'), printBox = h('div'), animBox = h('div')
  const unitSel = select(UNITS, unit, (v) => { unit = v; showStats() })
  const bgSel = segmented(BACKGROUNDS, 'light', (v) => { flags.bg = v; applyBg(); render() }, 'Background')
  const side = h('aside', { class: 'mv-side' },
    h('section', { class: 'panel' }, h('h2', 'Model'), infoBox, h('div', { style: 'margin-top:10px' }, dropzone({ accept: ACCEPT, multiple: true, compact: true, paste: false, icon: 'folder-open', label: 'Open another model', hint: 'Drop it here', onFiles: (f) => open(f) }))),
    h('section', { class: 'panel' }, h('h2', 'Size'), h('div', { class: 'mv-row', style: 'margin-bottom:8px' }, h('span', { class: 'small muted' }, 'Model units'), unitSel), dimBox),
    h('section', { class: 'panel' }, h('h2', 'Mesh'), countBox),
    h('section', { class: 'panel' }, h('h2', '3D printing'), printBox),
    animBox,
    h('section', { class: 'panel' }, h('h2', 'Background'), bgSel),
  )

  const wrap = h('div', { class: 'mv' }, stageEl, side)
  root.append(h('style', STYLE), wrap)

  const kv = (rows) => h('dl', { class: 'mv-kv' }, rows.map(([k, v, cls]) => [h('dt', k), h('dd', { class: cls }, v)]))
  const note = (t) => h('p', { class: 'small muted', style: 'margin:8px 0 0' }, t)
  const num = (v, d = 2) => formatNumber(v, d)
  function showInfo() {
    infoBox.replaceChildren(model ? kv([['File', model.name], ['Format', FORMATS[model.format].label], ['File size', formatBytes(model.size)]]) : note('No model open.'))
  }
  function showStats() {
    if (!stats) { for (const b of [dimBox, countBox, printBox]) b.replaceChildren(note(loading ? 'Measuring...' : '-')); return }
    const f = TO_MM[unit]
    const [x, y, z] = stats.size
    dimBox.replaceChildren(kv([['X (width)', `${num(x)} ${unit}`], ['Y', `${num(y)} ${unit}`], ['Z', `${num(z)} ${unit}`]]), note('Axes are the file\'s own. Z is up in STL, 3MF and PLY, Y is up in glTF.'))
    countBox.replaceChildren(kv([['Triangles', formatNumber(stats.triangles, 0)], ['Vertices', formatNumber(stats.vertices, 0)], ['Meshes', formatNumber(stats.meshes, 0)], ...(stats.points ? [['Point clouds', formatNumber(stats.points, 0)]] : []), ['Materials', formatNumber(model.materials, 0)]]))
    const mm3 = stats.volume * f ** 3, mm2 = stats.area * f ** 2
    const watertight = stats.closed
    printBox.replaceChildren(
      kv([['Volume', `${num(mm3 / 1000, 3)} cm³`], ['', `${num(mm3 / 16387.064, 3)} in³`], ['Surface area', `${num(mm2 / 100, 2)} cm²`],
        ['Watertight', watertight === null ? 'Not checked (very large)' : watertight ? 'Yes' : `No, ${formatNumber(stats.open + stats.nonManifold + stats.badWinding, 0)} problem edges`, watertight === null ? '' : watertight ? 'mv-good' : 'mv-bad']]),
      note(watertight === false ? 'Open or inconsistent surfaces: the volume is only approximate. Try the STL repair tool.' : 'Volume assumes the model units above.'))
  }

  // ----- three.js
  function render() { if (renderer && !disposed) renderer.render(scene, camera) }
  function resize() {
    if (!renderer) return
    const w = stageEl.clientWidth, hgt = stageEl.clientHeight
    if (!w || !hgt) return
    renderer.setSize(w, hgt, false)
    camera.aspect = w / hgt
    camera.updateProjectionMatrix()
    render()
  }
  function applyBg() {
    stageEl.classList.toggle('clear', flags.bg === 'clear')
    if (flags.bg === 'clear') renderer.setClearColor(0x000000, 0)
    else renderer.setClearColor(BG[flags.bg], 1)
  }
  function applyWire() { if (display) forEachMaterial(display, (m) => { m.wireframe = flags.wire }) }
  function applyClay() {
    if (!display) return
    const clay = (display.userData.clay ||= defaultMaterial(T))
    display.traverse((o) => {
      if (!o.isMesh) return
      if (flags.clay) { o.userData.orig ||= o.material; o.material = clay } else if (o.userData.orig) { o.material = o.userData.orig }
    })
    applyWire()
  }
  function worldBox() { return new T.Box3().setFromObject(display) }
  function syncHelpers() {
    for (const hp of [gridHelper, boxHelper]) if (hp) { scene.remove(hp); hp.geometry?.dispose() }
    gridHelper = boxHelper = null
    if (!display) return
    const box = worldBox(), size = box.getSize(new T.Vector3())
    const span = Math.max(size.x, size.z, size.y * 0.5, 1e-6) * 2.4
    const pow = 10 ** Math.floor(Math.log10(span)), mult = [1, 2, 5, 10].find((m) => m * pow >= span)
    if (flags.grid) {
      gridHelper = new T.GridHelper(mult * pow, 20, 0x8a8f98, 0xb8bcc4)
      gridHelper.material.transparent = true
      gridHelper.material.opacity = 0.55
      gridHelper.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
      scene.add(gridHelper)
    }
    if (flags.box) { boxHelper = new T.Box3Helper(box, 0x3e63dd); scene.add(boxHelper) }
  }
  function refit() {
    if (!display) return
    const box = worldBox()
    const { center, radius, distance } = frame(T, camera, box, 'iso', camera.aspect)
    controls.target.copy(center)
    controls.minDistance = radius * 0.05
    controls.maxDistance = distance * 20
    controls.update()
    syncHelpers()
    render()
  }
  function setBusy(text) { busyEl.hidden = !text; busyEl.textContent = text || '' }

  async function ensureEngine() {
    if (renderer) return
    T = await three()
    const { OrbitControls } = await addon('controls/OrbitControls.js')
    try { renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }) } catch (e) { throw Object.assign(new Error('This browser cannot draw 3D (WebGL is not available).'), { cause: e }) }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    renderer.toneMapping = T.NeutralToneMapping
    scene = new T.Scene()
    camera = new T.PerspectiveCamera(32, 1, 0.1, 1000)
    envTarget = await studioLight(T, renderer)
    scene.environment = envTarget.texture
    scene.environmentIntensity = 0.55
    addLights(T, scene, camera)
    controls = new OrbitControls(camera, canvas)
    controls.addEventListener('change', render)
    controls.listenToKeyEvents(canvas)
    clock = new T.Clock()
    ro = new ResizeObserver(resize)
    ro.observe(stageEl)
    applyBg()
    resize()
  }

  function disposeModel() {
    if (mixer) { mixer.stopAllAction(); mixer = action = null }
    cancelAnimationFrame(raf); raf = 0
    if (display) {
      scene.remove(display)
      display.traverse((o) => { o.geometry?.dispose?.(); for (const m of [].concat(o.material || [])) m.dispose?.() })
      display = null
    }
    model?.dispose()
    model = parts = stats = null
  }

  async function open(files) {
    const main = files.find(isModelFile)
    if (!main) return toast('Add a model file (GLB, glTF, STL, OBJ, 3MF, PLY, FBX, DAE, 3DS, OFF or USDZ).', 'error')
    const ticket = ++loading
    setBusy(`Opening ${main.name}...`)
    try {
      await ensureEngine()
      const m = await readModel(main, files.filter((f) => f !== main), { signal })
      if (ticket !== loading || disposed) { m.dispose(); return }
      disposeModel()
      m.name = main.name; m.size = main.size
      const mats = new Set()
      m.object.traverse((o) => { for (const x of [].concat(o.material || [])) mats.add(x) })
      m.materials = mats.size
      model = m
      upMode = upAxisOf(m.format)
      display = await displayRoot(m.object, upMode)
      scene.add(display)
      empty.hidden = true
      unit = defaultUnit(m.format); unitSel.value = unit
      applyWire(); applyClay(); refit()
      for (const n of m.notes) toast(n)
      showInfo(); stats = null; showStats(); buildAnim()
      setBusy('Measuring...')
      await new Promise((r) => setTimeout(r, 30))
      parts = flatten(m.object, { points: false })
      const s = await analyze(parts)
      if (ticket === loading) { stats = s; showStats() }
    } catch (e) {
      if (e?.code !== 'ABORT') toast(e.message || String(e), 'error')
    } finally {
      if (ticket === loading) setBusy('')
    }
  }

  function buildAnim() {
    animBox.replaceChildren()
    if (!model?.animations?.length) return
    mixer = new T.AnimationMixer(model.object)
    const clips = model.animations
    const sel = select(clips.map((c, i) => [i, `${c.name || 'Animation ' + (i + 1)} (${c.duration.toFixed(1)} s)`]), 0, (v) => start(+v))
    const playBtn = button('Play', { icon: 'play', size: 'sm', onClick: () => toggle() })
    const spd = h('input', { type: 'range', min: 0.1, max: 3, step: 0.1, value: 1, 'aria-label': 'Speed', oninput: (e) => { speed = +e.target.value; if (mixer) mixer.timeScale = speed } })
    let idx = 0, playing = false
    function start(i) { idx = i; mixer.stopAllAction(); action = mixer.clipAction(clips[i]); action.play(); mixer.timeScale = speed; playing = true; tick(); label() }
    function label() { playBtn.replaceChildren(icon(playing ? 'pause' : 'play'), h('span', playing ? 'Pause' : 'Play')) }
    function tick() {
      cancelAnimationFrame(raf)
      if (!playing || disposed) return
      mixer.update(clock.getDelta())
      render()
      raf = requestAnimationFrame(tick)
    }
    function toggle() {
      if (!action) return start(idx)
      playing = !playing
      if (playing) { clock.getDelta(); tick() } else cancelAnimationFrame(raf)
      label()
    }
    animBox.append(h('section', { class: 'panel' }, h('h2', 'Animation'), h('div', { class: 'stack' }, sel, h('div', { class: 'mv-row' }, playBtn, h('span', { class: 'small muted' }, 'Speed'), spd))))
    start(0)
  }

  function shot() {
    if (!display) return toast('Open a model first.', 'error')
    render()
    canvas.toBlob((b) => b && download(b, `${baseName(model.name)}-view.png`), 'image/png')
  }

  showInfo(); showStats()
  signal?.addEventListener('abort', () => { disposed = true })
  const cleanup = () => {
    disposed = true
    cancelAnimationFrame(raf)
    ro?.disconnect()
    if (renderer) { disposeModel(); envTarget?.dispose(); controls?.dispose(); renderer.dispose(); renderer.forceContextLoss() }
  }
  onCleanup(cleanup)
  return cleanup
}
