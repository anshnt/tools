// Shared 3D display code: lighting, camera framing and still-image rendering (used by the viewer and the PNG/JPG routes).
import { toBlob } from '../../lib/image.js'
import { three, addon } from './_three.js'

export const ANGLES = [
  ['iso', 'Front right (3/4 view)'], ['iso-left', 'Front left (3/4 view)'], ['iso-back', 'Back right (3/4 view)'], ['front', 'Front'], ['back', 'Back'],
  ['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom'],
]
const DIRS = { iso: [1, 0.8, 1], 'iso-left': [-1, 0.8, 1], 'iso-back': [1, 0.8, -1], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] }

/** A display root that stands a Z-up model upright (three.js is Y-up). */
export async function displayRoot(object, up = 'y') {
  const T = await three()
  const root = new T.Group()
  if (up === 'z') root.rotation.x = -Math.PI / 2
  root.add(object)
  root.updateMatrixWorld(true)
  return root
}

/** Point the camera at the box from a preset direction, far enough to fit it. */
export function frame(T, camera, box, angle = 'iso', aspect = 1) {
  const c = box.getCenter(new T.Vector3())
  const r = Math.max(box.getSize(new T.Vector3()).length() / 2, 1e-6)
  const fov = camera.fov * Math.PI / 180
  const half = Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * aspect))
  const dist = (r / Math.sin(half)) * 1.08
  const d = new T.Vector3(...(DIRS[angle] || DIRS.iso)).normalize()
  camera.up.set(0, angle === 'top' ? 0 : angle === 'bottom' ? 0 : 1, angle === 'top' ? -1 : angle === 'bottom' ? 1 : 0)
  camera.position.copy(c).addScaledVector(d, dist)
  camera.near = Math.max(dist / 1000, 1e-6)
  camera.far = dist + r * 20
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  camera.lookAt(c)
  return { center: c, radius: r, distance: dist }
}

/** Image-based lighting for PBR materials (a neutral studio room). */
export async function studioLight(T, renderer) {
  const { RoomEnvironment } = await addon('environments/RoomEnvironment.js')
  const pmrem = new T.PMREMGenerator(renderer)
  const target = pmrem.fromScene(new RoomEnvironment(), 0.04)
  pmrem.dispose()
  return target
}

export function addLights(T, scene, camera) {
  const key = new T.DirectionalLight(0xffffff, 1.1)
  key.position.set(2, 3, 4)
  camera.add(key)
  scene.add(camera)
}

function forEachMaterial(root, fn) {
  const seen = new Set()
  root.traverse((o) => { for (const m of [].concat(o.material || [])) if (!seen.has(m)) { seen.add(m); fn(m, o) } })
}
export { forEachMaterial }

/**
 * Render a still image of a model. opts: { up, angle, size, transparent, type: 'png'|'jpg', background, wireframe }.
 * Returns a Blob.
 */
export async function renderImage(object, { up = 'y', angle = 'iso', size = 1024, transparent = false, type = 'png', background = '#eef0f4', wireframe = false } = {}) {
  const T = await three()
  const canvas = document.createElement('canvas')
  let renderer
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  } catch (e) {
    throw Object.assign(new Error('This browser cannot draw 3D previews (WebGL is not available).'), { cause: e })
  }
  try {
    const max = Math.min(renderer.capabilities.maxTextureSize || 4096, 4096)
    const px = Math.max(64, Math.min(Math.round(size), max))
    renderer.setPixelRatio(1)
    renderer.setSize(px, px, false)
    renderer.setClearColor(new T.Color(background), transparent ? 0 : 1)
    const scene = new T.Scene()
    const root = await displayRoot(object, up)
    scene.add(root)
    forEachMaterial(root, (m) => { m.side = T.DoubleSide; m.wireframe = !!wireframe })
    const env = await studioLight(T, renderer)
    scene.environment = env.texture
    scene.environmentIntensity = 0.55
    renderer.toneMapping = T.NeutralToneMapping
    const camera = new T.PerspectiveCamera(32, 1, 0.1, 1000)
    const box = new T.Box3().setFromObject(root)
    frame(T, camera, box, angle, 1)
    addLights(T, scene, camera)
    renderer.render(scene, camera)
    const out = document.createElement('canvas')
    out.width = out.height = px
    const ctx = out.getContext('2d')
    if (type === 'jpg') { ctx.fillStyle = background; ctx.fillRect(0, 0, px, px) }
    ctx.drawImage(canvas, 0, 0)
    env.dispose()
    return await toBlob(out, type === 'jpg' ? 'image/jpeg' : 'image/png', 0.92)
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
