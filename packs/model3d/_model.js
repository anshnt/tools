// 3D model engine. Reads GLB, glTF, STL, OBJ (+MTL), 3MF, PLY, FBX, DAE, 3DS, OFF and USDZ with three.js, then transforms,
// repairs, measures and writes GLB, glTF, USDZ (three.js exporters) and STL, PLY, OBJ (+MTL) and 3MF (own writers).
// Everything runs in the browser. Meshes are handled as "parts": plain typed arrays in world space.
import { ext, baseName, zip } from '../../lib/files.js'
import { yieldToMain } from '../../lib/ui.js'
import { three, addon } from './_three.js'

// ---------- formats ----------
// up: the axis most files of that format use. Used only to pick a sensible display orientation and ground plane.
export const FORMATS = {
  glb: { label: 'GLB', long: 'GLB (binary glTF)', up: 'y', read: true, write: true, mime: 'model/gltf-binary' },
  gltf: { label: 'glTF', long: 'glTF (JSON, textures embedded)', up: 'y', read: true, write: true, mime: 'model/gltf+json' },
  stl: { label: 'STL', long: 'STL (3D printing)', up: 'z', read: true, write: true, mime: 'model/stl' },
  obj: { label: 'OBJ', long: 'OBJ (with MTL and textures)', up: 'y', read: true, write: true, mime: 'model/obj' },
  '3mf': { label: '3MF', long: '3MF (3D printing)', up: 'z', read: true, write: true, mime: 'model/3mf' },
  ply: { label: 'PLY', long: 'PLY (scans, point clouds)', up: 'z', read: true, write: true, mime: 'model/ply' },
  usdz: { label: 'USDZ', long: 'USDZ (AR)', up: 'y', read: true, write: true, mime: 'model/vnd.usdz+zip' },
  fbx: { label: 'FBX', long: 'FBX', up: 'y', read: true, write: false, mime: 'application/octet-stream' },
  dae: { label: 'DAE', long: 'Collada (DAE)', up: 'y', read: true, write: false, mime: 'model/vnd.collada+xml' },
  '3ds': { label: '3DS', long: '3D Studio (3DS)', up: 'z', read: true, write: false, mime: 'application/octet-stream' },
  off: { label: 'OFF', long: 'OFF (Object File Format)', up: 'z', read: true, write: false, mime: 'text/plain' },
}
export const READ_EXTS = Object.keys(FORMATS).filter((k) => FORMATS[k].read)
export const WRITE_EXTS = Object.keys(FORMATS).filter((k) => FORMATS[k].write)
/** Files that travel with a model: glTF buffers, OBJ materials and textures (browser-decodable). */
export const COMPANION_EXTS = ['bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg']
export const ACCEPT = [...READ_EXTS, ...COMPANION_EXTS].map((e) => '.' + e).join(',')
export const isModelFile = (f) => READ_EXTS.includes(ext(f.name))
export const upAxisOf = (format) => FORMATS[format]?.up || 'y'

export const UNIT_PRESETS = [
  ['1', 'Keep the size as it is'], ['0.001', 'Millimetres to metres'], ['0.1', 'Millimetres to centimetres'], ['0.0393700787', 'Millimetres to inches'],
  ['1000', 'Metres to millimetres'], ['100', 'Metres to centimetres'], ['10', 'Centimetres to millimetres'], ['0.01', 'Centimetres to metres'],
  ['25.4', 'Inches to millimetres'], ['2.54', 'Inches to centimetres'], ['0.0254', 'Inches to metres'], ['304.8', 'Feet to millimetres'],
]
export const AXIS_CHOICES = [['keep', 'Keep as it is'], ['y-to-z', 'Y-up to Z-up (glTF to printing)'], ['z-to-y', 'Z-up to Y-up (printing to glTF)']]
export const PLACE_CHOICES = [['keep', 'Keep position'], ['center', 'Center on the origin'], ['ground', 'Center and sit on the ground']]

const fail = (msg, code = 'USER') => Object.assign(new Error(msg), { code })
export const abortError = () => Object.assign(new Error('Cancelled'), { name: 'AbortError', code: 'ABORT' })
const check = (signal) => { if (signal?.aborted) throw abortError() }
const fmtNum = (n) => String(+Number(n).toPrecision(7))
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c])

// ---------- reading ----------
function resolver(files) {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]))
  const urls = new Map()
  const lookup = (url) => {
    if (/^(data|blob):/i.test(url)) return null
    let name = url.split(/[?#]/)[0]
    try { name = decodeURIComponent(name) } catch { /* keep as is */ }
    return byName.get(name.replace(/\\/g, '/').split('/').pop().toLowerCase()) || null
  }
  return {
    lookup,
    modify(url) {
      const f = lookup(url)
      if (!f) return url
      if (!urls.has(f)) urls.set(f, URL.createObjectURL(f))
      return urls.get(f)
    },
    dispose() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear() },
  }
}

export function defaultMaterial(T) {
  const m = new T.MeshStandardMaterial({ color: 0x9eb0c8, roughness: 0.5, metalness: 0.05, name: 'default' })
  m.userData.generic = true
  return m
}

function parseOFF(T, text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
  const head = lines.shift()?.split(/\s+/) || []
  if (!/^[CNST4n]*OFF$/i.test(head[0] || '')) throw fail('This does not look like an OFF file.')
  const counts = (head.length > 1 ? head.slice(1) : lines.shift().split(/\s+/)).map(Number)
  const [nv, nf] = counts
  if (!(nv >= 0 && nf >= 0)) throw fail('The OFF file header is damaged.')
  const pos = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) {
    const t = lines[i].split(/\s+/)
    pos[i * 3] = +t[0]; pos[i * 3 + 1] = +t[1]; pos[i * 3 + 2] = +t[2]
  }
  const idx = []
  for (let i = 0; i < nf; i++) {
    const t = (lines[nv + i] || '').split(/\s+/).map(Number)
    const n = t[0]
    for (let k = 1; k < n - 1; k++) idx.push(t[1], t[1 + k], t[2 + k])
  }
  const g = new T.BufferGeometry()
  g.setAttribute('position', new T.BufferAttribute(pos, 3))
  g.setIndex(new T.BufferAttribute(Uint32Array.from(idx), 1))
  return g
}

const TEXTURE_SLOTS = (m) => Object.keys(m).filter((k) => m[k]?.isTexture)
/** Wait for the loaders' texture requests, then drop textures whose file was not provided or could not be decoded. */
async function settleTextures(object, notes, track) {
  if (track.loading) await new Promise((r) => { track.wake = r; setTimeout(r, 20000) })
  for (const url of new Set(track.failed)) {
    const name = /^(blob|data):/i.test(url) ? 'an image' : `"${decodeURIComponent(url.split(/[?#]/)[0]).replace(/[\\]/g, '/').split('/').pop().slice(0, 60)}"`
    notes.push(`The texture ${name} was not found or could not be read, so it was left out. Drop the image files together with the model.`)
  }
  object.traverse((o) => {
    for (const m of [].concat(o.material || [])) for (const k of TEXTURE_SLOTS(m)) {
      const img = m[k].image
      if (!img || !((img.naturalWidth ?? img.width) > 0)) { m[k] = null; m.needsUpdate = true }
    }
  })
}

/**
 * Read a model. `companions` are the other files dropped with it (glTF .bin and textures, OBJ .mtl and textures).
 * Returns { object, format, animations, notes, dispose }.
 */
export async function readModel(main, companions = [], { signal } = {}) {
  const format = ext(main.name)
  if (!READ_EXTS.includes(format)) throw fail(`${main.name}: this file type is not supported. Use ${READ_EXTS.map((e) => e.toUpperCase()).join(', ')}.`)
  const T = await three()
  const res = resolver([main, ...companions])
  const manager = new T.LoadingManager()
  manager.setURLModifier((u) => res.modify(u))
  const track = { loading: false, failed: [], wake: null }
  manager.onStart = () => { track.loading = true }
  manager.onLoad = () => { track.loading = false; track.wake?.() }
  manager.onError = (url) => track.failed.push(url)
  const notes = []
  let object, animations = []
  const mat = () => defaultMaterial(T)
  try {
    switch (format) {
      case 'glb': case 'gltf': {
        const { GLTFLoader } = await addon('loaders/GLTFLoader.js')
        const data = format === 'glb' ? await main.arrayBuffer() : await main.text()
        if (format === 'gltf') {
          let json
          try { json = JSON.parse(data) } catch { throw fail('This glTF file is not valid JSON.') }
          const uris = [...(json.buffers || []), ...(json.images || [])].map((x) => x.uri).filter((u) => u && !/^data:/i.test(u))
          const missing = [...new Set(uris.filter((u) => !res.lookup(u)))]
          if (missing.length) throw fail(`This glTF uses separate files: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' and more' : ''}. Drop them together with the .gltf file in the 3D model converter.`, 'MISSING_FILES')
        }
        const gltf = await new Promise((ok, no) => new GLTFLoader(manager).parse(data, '', ok, no))
        object = gltf.scene; animations = gltf.animations || []
        const req = gltf.parser?.json?.extensionsRequired || []
        if (req.some((e) => /draco|meshopt|basisu/i.test(e))) notes.push('This file uses compressed geometry or textures that may not have loaded.')
        break
      }
      case 'stl': {
        const { STLLoader } = await addon('loaders/STLLoader.js')
        const g = new STLLoader(manager).parse(await main.arrayBuffer())
        const m = mat()
        if (g.hasColors) { m.vertexColors = true; m.color.set(0xffffff) }
        object = new T.Group()
        object.add(new T.Mesh(g, m))
        break
      }
      case 'ply': {
        const { PLYLoader } = await addon('loaders/PLYLoader.js')
        const g = new PLYLoader(manager).parse(await main.arrayBuffer())
        object = new T.Group()
        if (g.index && g.index.count) {
          const m = mat()
          if (g.attributes.color) { m.vertexColors = true; m.color.set(0xffffff) }
          object.add(new T.Mesh(g, m))
        } else {
          g.computeBoundingBox()
          const diag = g.boundingBox.getSize(new T.Vector3()).length() || 1
          object.add(new T.Points(g, new T.PointsMaterial({ size: diag / 300, vertexColors: !!g.attributes.color, color: g.attributes.color ? 0xffffff : 0xb4c0d0 })))
          notes.push('This PLY has no faces, so it is a point cloud.')
        }
        break
      }
      case 'off': {
        const g = parseOFF(T, await main.text())
        object = new T.Group()
        object.add(new T.Mesh(g, mat()))
        break
      }
      case 'obj': {
        const [{ OBJLoader }, { MTLLoader }] = await Promise.all([addon('loaders/OBJLoader.js'), addon('loaders/MTLLoader.js')])
        const text = await main.text()
        const loader = new OBJLoader(manager)
        let mtls = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => res.lookup(m[1])).filter(Boolean)
        if (!mtls.length) mtls = companions.filter((f) => ext(f.name) === 'mtl')
        if (mtls.length) {
          const creator = new MTLLoader(manager).parse((await Promise.all(mtls.map((f) => f.text()))).join('\n'), '')
          creator.preload()
          loader.setMaterials(creator)
        }
        object = loader.parse(text)
        break
      }
      case '3mf': {
        const { ThreeMFLoader } = await addon('loaders/3MFLoader.js')
        object = new ThreeMFLoader(manager).parse(await main.arrayBuffer())
        break
      }
      case 'fbx': {
        const { FBXLoader } = await addon('loaders/FBXLoader.js')
        object = new FBXLoader(manager).parse(await main.arrayBuffer(), '')
        animations = object.animations || []
        break
      }
      case 'dae': {
        const { ColladaLoader } = await addon('loaders/ColladaLoader.js')
        const r = new ColladaLoader(manager).parse(await main.text(), '')
        object = r.scene; animations = r.animations || []
        break
      }
      case '3ds': {
        const { TDSLoader } = await addon('loaders/TDSLoader.js')
        object = new TDSLoader(manager).parse(await main.arrayBuffer(), '')
        break
      }
      case 'usdz': {
        const { USDLoader } = await addon('loaders/USDLoader.js')
        object = await new USDLoader(manager).parse(await main.arrayBuffer())
        break
      }
    }
    check(signal)
    if (!object) throw fail('Nothing could be read from this file.')
    await settleTextures(object, notes, track)
    let meshes = 0
    object.traverse((o) => {
      if (o.isMesh || o.isPoints) meshes++
      const g = o.isMesh && o.geometry
      if (g && g.attributes.position) {
        const nrm = g.attributes.normal
        if (nrm && nrm.array.some((v) => !Number.isFinite(v))) g.deleteAttribute('normal')
        if (!g.attributes.normal) g.computeVertexNormals()
      }
    })
    if (!meshes) throw fail('This file has no 3D geometry in it.')
  } catch (e) {
    res.dispose()
    if (['USER', 'MISSING_FILES', 'ABORT'].includes(e?.code) || e?.message?.startsWith('Could not load the 3D')) throw e
    throw fail(`Could not read this ${FORMATS[format].label} file: ${e?.message || e}`, 'READ')
  }
  object.userData.format = format
  return { object, format, animations, notes, dispose: () => res.dispose() }
}

// ---------- parts ----------
// part: { kind: 'mesh'|'points', name, material, positions: Float32Array (world), normals?, uvs?, colors? (3 per vertex),
//         index: Uint32Array, shared: bool (false when the source was non-indexed, so vertices are not shared) }
function readAttr(attr, size, count) {
  if (!attr) return null
  if (!attr.isInterleavedBufferAttribute && attr.array instanceof Float32Array && attr.itemSize === size && !attr.normalized) return attr.array.subarray(0, count * size)
  const out = new Float32Array(count * size)
  for (let i = 0; i < count; i++) {
    out[i * size] = attr.getX(i)
    if (size > 1) out[i * size + 1] = attr.getY(i)
    if (size > 2) out[i * size + 2] = attr.getZ(i)
  }
  return out
}
const visibleChain = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true }

/** Flatten a scene graph into world-space parts. Hidden nodes are skipped. Animated models are taken in their rest pose. */
export function flatten(root, { points = false } = {}) {
  root.updateMatrixWorld(true)
  const parts = []
  root.traverse((o) => {
    const g = o.geometry
    if (!(o.isMesh || (points && o.isPoints)) || !g?.attributes?.position || !visibleChain(o)) return
    const e = o.matrixWorld.elements
    const a = [e[0], e[1], e[2]], b = [e[4], e[5], e[6]], c = [e[8], e[9], e[10]]
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b)
    const det = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2]
    const flip = det < 0, sg = flip ? -1 : 1
    const n = g.attributes.position.count
    const src = readAttr(g.attributes.position, 3, n)
    const positions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2]
      positions[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]
      positions[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
      positions[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
    }
    const col = g.attributes.color
    let colors = null
    if (col) {
      colors = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) { colors[i * 3] = col.getX(i); colors[i * 3 + 1] = col.getY(i); colors[i * 3 + 2] = col.getZ(i) }
    }
    if (o.isPoints) { parts.push({ kind: 'points', name: o.name || 'points', positions, colors }); return }
    let normals = null
    if (g.attributes.normal) {
      const nn = readAttr(g.attributes.normal, 3, n)
      normals = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const x = nn[i * 3], y = nn[i * 3 + 1], z = nn[i * 3 + 2]
        const nx = sg * (x * bc[0] + y * ca[0] + z * ab[0]), ny = sg * (x * bc[1] + y * ca[1] + z * ab[1]), nz = sg * (x * bc[2] + y * ca[2] + z * ab[2])
        const l = Math.hypot(nx, ny, nz) || 1
        normals[i * 3] = nx / l; normals[i * 3 + 1] = ny / l; normals[i * 3 + 2] = nz / l
      }
    }
    const uvs = g.attributes.uv ? readAttr(g.attributes.uv, 2, n) : null
    const fullIndex = g.index ? g.index.array : null
    const ranges = Array.isArray(o.material) && g.groups.length
      ? g.groups.map((gr) => ({ start: gr.start, count: gr.count, material: o.material[gr.materialIndex] }))
      : [{ start: 0, count: fullIndex ? fullIndex.length : n, material: Array.isArray(o.material) ? o.material[0] : o.material }]
    for (const r of ranges) {
      const count = Math.min(r.count, (fullIndex ? fullIndex.length : n) - r.start)
      const tris = Math.floor(count / 3)
      if (tris <= 0) continue
      const index = new Uint32Array(tris * 3)
      for (let k = 0; k < tris * 3; k++) index[k] = fullIndex ? fullIndex[r.start + k] : r.start + k
      if (flip) for (let k = 0; k < index.length; k += 3) { const t = index[k + 1]; index[k + 1] = index[k + 2]; index[k + 2] = t }
      const part = { kind: 'mesh', name: o.name || 'mesh', material: r.material, positions, normals, uvs, colors, index, shared: !!fullIndex }
      parts.push(ranges.length > 1 ? compactPart(part) : part)
    }
  })
  return parts
}

function compactPart(p) {
  const remap = new Int32Array(p.positions.length / 3).fill(-1)
  let n = 0
  for (const i of p.index) if (remap[i] < 0) remap[i] = n++
  const pick = (arr, size) => {
    if (!arr) return null
    const out = new Float32Array(n * size)
    for (let i = 0; i < remap.length; i++) if (remap[i] >= 0) for (let k = 0; k < size; k++) out[remap[i] * size + k] = arr[i * size + k]
    return out
  }
  return { ...p, positions: pick(p.positions, 3), normals: pick(p.normals, 3), uvs: pick(p.uvs, 2), colors: pick(p.colors, 3), index: p.index.map((i) => remap[i]) }
}

export function bounds(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) {
    const a = p.positions
    for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { const v = a[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v }
  }
  if (min[0] === Infinity) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], diag: 0 }
  const size = max.map((v, k) => v - min[k])
  return { min, max, size, diag: Math.hypot(...size) }
}

/** Merge vertices closer than tol (absolute). Returns { positions, map } where map[i] is the new index of old vertex i. */
export async function weldPositions(pos, tol) {
  const n = pos.length / 3, map = new Uint32Array(n), keys = new Map(), out = []
  const inv = tol > 0 ? 1 / tol : 0
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
    const key = inv ? `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}` : `${x},${y},${z}`
    let j = keys.get(key)
    if (j === undefined) { j = out.length / 3; keys.set(key, j); out.push(x, y, z) }
    map[i] = j
    if (i % 200000 === 199999) await yieldToMain()
  }
  return { positions: Float32Array.from(out), map }
}

/** Weld one part by position: shared vertices, other per-vertex attributes dropped. */
async function weldPart(p, tolRel, diag) {
  const w = await weldPositions(p.positions, diag * tolRel)
  return { ...p, positions: w.positions, normals: null, uvs: null, colors: null, index: p.index.map((i) => w.map[i]), shared: true }
}

// ---------- measuring ----------
function edgeStats(index, nv) {
  const T = index.length / 3
  const und = new Float64Array(T * 3), dir = new Float64Array(T * 3)
  let k = 0, degenerate = 0
  for (let t = 0; t < T; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2]
    if (a === b || b === c || a === c) { degenerate++; continue }
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { und[k] = u < v ? u * nv + v : v * nv + u; dir[k] = u * nv + v; k++ }
  }
  const U = und.subarray(0, k).sort(), D = dir.subarray(0, k).sort()
  let open = 0, nonManifold = 0, badWinding = 0
  for (let i = 0; i < k;) { let j = i + 1; while (j < k && U[j] === U[i]) j++; const run = j - i; if (run === 1) open++; else if (run > 2) nonManifold++; i = j }
  for (let i = 0; i < k;) { let j = i + 1; while (j < k && D[j] === D[i]) j++; if (j - i > 1) badWinding++; i = j }
  return { open, nonManifold, badWinding, degenerate }
}

/** Size, counts, surface area, volume and a watertight check. Volume is only exact when `closed` is true. */
export async function analyze(parts, { topology = true } = {}) {
  const meshes = parts.filter((p) => p.kind !== 'points')
  const b = bounds(parts)
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2
  let triangles = 0, vertices = 0, area = 0, vol = 0, open = 0, nonManifold = 0, badWinding = 0, degenerate = 0
  for (const p of meshes) {
    const P = p.positions, I = p.index
    triangles += I.length / 3
    vertices += P.length / 3
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, bb = I[k + 1] * 3, c = I[k + 2] * 3
      const ax = P[a] - cx, ay = P[a + 1] - cy, az = P[a + 2] - cz
      const bx = P[bb] - cx, by = P[bb + 1] - cy, bz = P[bb + 2] - cz
      const qx = P[c] - cx, qy = P[c + 1] - cy, qz = P[c + 2] - cz
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      area += 0.5 * Math.hypot(nx, ny, nz)
      vol += (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6
    }
  }
  // Topology: weld every part together so material seams inside one shape do not count as holes.
  const checked = topology && triangles > 0 && triangles <= 3_000_000
  if (checked) {
    const all = new Float32Array(vertices * 3), idx = new Uint32Array(triangles * 3)
    let vo = 0, io = 0
    for (const p of meshes) {
      all.set(p.positions, vo * 3)
      for (let k = 0; k < p.index.length; k++) idx[io + k] = p.index[k] + vo
      vo += p.positions.length / 3; io += p.index.length
    }
    const w = await weldPositions(all, b.diag * 1e-6)
    const es = edgeStats(idx.map((i) => w.map[i]), w.positions.length / 3)
    open = es.open; nonManifold = es.nonManifold; badWinding = es.badWinding; degenerate = es.degenerate
  }
  return {
    meshes: meshes.length, points: parts.length - meshes.length, triangles, vertices, size: b.size, min: b.min, max: b.max, diag: b.diag,
    area, volume: Math.abs(vol), signedVolume: vol, open, nonManifold, badWinding, degenerate,
    closed: checked ? open === 0 && nonManifold === 0 && badWinding === 0 && triangles > 0 : null,
  }
}

// ---------- repair and merge ----------
export const REPAIR_MAX_TRIANGLES = 1_500_000

/** Merge duplicate vertices, drop degenerate and duplicate triangles, make the winding consistent and face outward. */
export async function repairParts(parts, { onProgress } = {}) {
  const { diag } = bounds(parts)
  const out = [], report = { welded: 0, degenerate: 0, duplicates: 0, flipped: 0, open: 0, nonManifold: 0 }
  const meshes = parts.filter((p) => p.kind !== 'points')
  if (meshes.reduce((s, p) => s + p.index.length / 3, 0) > REPAIR_MAX_TRIANGLES) throw fail(`Repair works on meshes up to ${REPAIR_MAX_TRIANGLES.toLocaleString('en-US')} triangles. Turn repair off for this one.`)
  let done = 0
  for (const p of parts) {
    if (p.kind === 'points') { out.push(p); continue }
    const w = await weldPositions(p.positions, diag * 1e-6)
    report.welded += p.positions.length / 3 - w.positions.length / 3
    const P = w.positions
    const tris = [], seen = new Set()
    for (let k = 0; k < p.index.length; k += 3) {
      const a = w.map[p.index[k]], b = w.map[p.index[k + 1]], c = w.map[p.index[k + 2]]
      if (a === b || b === c || a === c) { report.degenerate++; continue }
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2]
      if (uy * vz - uz * vy === 0 && uz * vx - ux * vz === 0 && ux * vy - uy * vx === 0) { report.degenerate++; continue }
      const s = [a, b, c].sort((x, y) => x - y)
      const key = `${s[0]},${s[1]},${s[2]}`
      if (seen.has(key)) { report.duplicates++; continue }
      seen.add(key)
      tris.push(a, b, c)
    }
    const idx = Uint32Array.from(tris)
    const T = idx.length / 3, nv = P.length / 3
    // Edge table: each edge remembers up to two triangles (code = tri * 2 + direction bit).
    const first = new Map(), second = new Map()
    for (let t = 0; t < T; t++) {
      for (let e = 0; e < 3; e++) {
        const u = idx[t * 3 + e], v = idx[t * 3 + (e + 1) % 3]
        const key = u < v ? u * nv + v : v * nv + u, code = t * 2 + (u < v ? 1 : 0)
        if (!first.has(key)) first.set(key, code)
        else if (!second.has(key)) second.set(key, code)
        else second.set(key, -1)
      }
      if (t % 100000 === 99999) await yieldToMain()
    }
    for (const [k, c] of first) { if (!second.has(k)) report.open++; else if (second.get(k) === -1) report.nonManifold++ }
    const flipped = new Uint8Array(T), comp = new Int32Array(T).fill(-1)
    let nc = 0
    for (let s = 0; s < T; s++) {
      if (comp[s] >= 0) continue
      comp[s] = nc
      const stack = [s], members = [s]
      let holes = 0
      while (stack.length) {
        const t = stack.pop()
        for (let e = 0; e < 3; e++) {
          const u = idx[t * 3 + e], v = idx[t * 3 + (e + 1) % 3]
          const key = u < v ? u * nv + v : v * nv + u
          const c1 = first.get(key), c2 = second.get(key)
          if (c2 === undefined) { holes++; continue }
          if (c2 === -1) { holes++; continue }
          const other = c1 >> 1 === t ? c2 : c1
          const n = other >> 1
          const myDir = (u < v ? 1 : 0) ^ flipped[t], nDir = (other & 1) ^ flipped[n]
          if (comp[n] < 0) { comp[n] = nc; if (myDir === nDir) flipped[n] ^= 1; stack.push(n); members.push(n) }
        }
      }
      // A closed shell with negative volume is inside out: flip the whole shell.
      let vol = 0
      for (const t of members) {
        const a = idx[t * 3], b = flipped[t] ? idx[t * 3 + 2] : idx[t * 3 + 1], c = flipped[t] ? idx[t * 3 + 1] : idx[t * 3 + 2]
        vol += P[a * 3] * (P[b * 3 + 1] * P[c * 3 + 2] - P[b * 3 + 2] * P[c * 3 + 1]) - P[a * 3 + 1] * (P[b * 3] * P[c * 3 + 2] - P[b * 3 + 2] * P[c * 3]) + P[a * 3 + 2] * (P[b * 3] * P[c * 3 + 1] - P[b * 3 + 1] * P[c * 3])
      }
      if (vol < 0 && holes === 0) for (const t of members) flipped[t] ^= 1
      nc++
    }
    for (let t = 0; t < T; t++) if (flipped[t]) { const x = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = x; report.flipped++ }
    out.push({ ...p, positions: P, normals: null, uvs: null, colors: null, index: idx, shared: true })
    onProgress?.(++done / meshes.length)
    await yieldToMain()
  }
  return { parts: out, report }
}

/** Join all meshes that share a material into one mesh. */
export function mergeByMaterial(parts) {
  const groups = new Map()
  for (const p of parts.filter((q) => q.kind !== 'points')) {
    const k = p.material || null
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(p)
  }
  const out = []
  for (const [material, list] of groups) {
    if (list.length === 1) { out.push(list[0]); continue }
    const nv = list.reduce((s, p) => s + p.positions.length / 3, 0), ni = list.reduce((s, p) => s + p.index.length, 0)
    const cat = (key, size) => {
      if (!list.every((p) => p[key])) return null
      const a = new Float32Array(nv * size)
      let o = 0
      for (const p of list) { a.set(p[key], o); o += p[key].length }
      return a
    }
    const positions = cat('positions', 3), index = new Uint32Array(ni)
    let io = 0, vo = 0
    for (const p of list) { for (let k = 0; k < p.index.length; k++) index[io + k] = p.index[k] + vo; io += p.index.length; vo += p.positions.length / 3 }
    out.push({ kind: 'mesh', name: 'Merged', material, positions, normals: cat('normals', 3), uvs: cat('uvs', 2), colors: cat('colors', 3), index, shared: list.every((p) => p.shared) })
  }
  return [...out, ...parts.filter((p) => p.kind === 'points')]
}

/** Rebuild a three.js group from parts. Parts without normals are expanded so they shade flat. */
export async function fromParts(parts) {
  const T = await three()
  const root = new T.Group()
  const fallback = defaultMaterial(T)
  for (const p of parts) {
    let g = new T.BufferGeometry()
    g.setAttribute('position', new T.BufferAttribute(p.positions, 3))
    if (p.colors) g.setAttribute('color', new T.BufferAttribute(p.colors, 3))
    if (p.kind === 'points') { root.add(Object.assign(new T.Points(g, new T.PointsMaterial({ size: 0.01, vertexColors: !!p.colors })), { name: p.name })); continue }
    if (p.normals) g.setAttribute('normal', new T.BufferAttribute(p.normals, 3))
    if (p.uvs) g.setAttribute('uv', new T.BufferAttribute(p.uvs, 2))
    g.setIndex(new T.BufferAttribute(p.index, 1))
    if (!p.normals) { g = g.toNonIndexed(); g.computeVertexNormals() }
    root.add(Object.assign(new T.Mesh(g, p.material || fallback), { name: p.name }))
  }
  return root
}

// ---------- transforms ----------
export const outputUp = (to, axis) => (axis === 'y-to-z' ? 'z' : axis === 'z-to-y' ? 'y' : upAxisOf(to))

/**
 * Apply merge, repair, units, up axis and placement. Returns { object, notes } where object is a new wrapper group.
 * opts: { merge, repair, units (factor), scale, axis, place }
 */
export async function prepare(model, opts = {}, to = 'glb', { onProgress } = {}) {
  const T = await three()
  let object = model.object
  const notes = []
  if (opts.merge || opts.repair) {
    let parts = flatten(object, { points: true })
    if (!parts.length) throw fail('This model has no surfaces to work on.')
    if (opts.repair) {
      const r = await repairParts(parts, { onProgress })
      parts = r.parts
      const s = r.report
      notes.push(`Repair: merged ${s.welded.toLocaleString('en-US')} duplicate vertices, removed ${(s.degenerate + s.duplicates).toLocaleString('en-US')} degenerate or duplicate triangles, flipped ${s.flipped.toLocaleString('en-US')} triangles.${s.open ? ` ${s.open.toLocaleString('en-US')} open edges (holes) remain, they are not filled.` : ''}`)
    }
    if (opts.merge) parts = mergeByMaterial(parts)
    object = await fromParts(parts)
    if (model.animations?.length) { notes.push('Animation was dropped because the model was merged or repaired into static meshes.'); model.animations = [] }
  }
  const s = (Number(opts.units) || 1) * (Number(opts.scale) || 1)
  const m = new T.Matrix4()
  if (opts.axis === 'y-to-z') m.set(s, 0, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, 0, 0, 1)
  else if (opts.axis === 'z-to-y') m.set(s, 0, 0, 0, 0, 0, s, 0, 0, -s, 0, 0, 0, 0, 0, 1)
  else m.set(s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1)
  const wrapper = new T.Group()
  wrapper.name = baseName(model.name || 'model')
  wrapper.matrixAutoUpdate = false
  wrapper.matrix.copy(m)
  wrapper.add(object)
  wrapper.updateMatrixWorld(true)
  if (opts.place && opts.place !== 'keep') {
    const box = new T.Box3().setFromObject(wrapper, true)
    const c = box.getCenter(new T.Vector3())
    const t = [-c.x, -c.y, -c.z]
    if (opts.place === 'ground') { const up = 'xyz'.indexOf(outputUp(to, opts.axis)); t[up] = -box.min.getComponent(up) }
    wrapper.matrix.elements[12] = t[0]; wrapper.matrix.elements[13] = t[1]; wrapper.matrix.elements[14] = t[2]
    wrapper.updateMatrixWorld(true)
  }
  return { object: wrapper, notes }
}

// ---------- writers ----------
function triNormal(P, a, b, c) {
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const l = Math.hypot(nx, ny, nz)
  return l ? [nx / l, ny / l, nz / l] : [0, 0, 0]
}
const stlNum = (n) => Number(n).toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2')

async function writeSTL(parts, name, binary) {
  const meshes = parts.filter((p) => p.kind !== 'points')
  const total = meshes.reduce((s, p) => s + p.index.length / 3, 0)
  if (binary) {
    const buf = new ArrayBuffer(84 + 50 * total), dv = new DataView(buf)
    const head = new TextEncoder().encode(`Binary STL ${name}`.slice(0, 79))
    new Uint8Array(buf, 0, 80).set(head)
    dv.setUint32(80, total, true)
    let o = 84, n = 0
    for (const p of meshes) {
      const P = p.positions, I = p.index
      for (let k = 0; k < I.length; k += 3) {
        const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3
        const nrm = triNormal(P, a, b, c)
        for (let i = 0; i < 3; i++) {
          dv.setFloat32(o + i * 4, nrm[i], true)
          dv.setFloat32(o + 12 + i * 4, P[a + i], true)
          dv.setFloat32(o + 24 + i * 4, P[b + i], true)
          dv.setFloat32(o + 36 + i * 4, P[c + i], true)
        }
        o += 50
        if (++n % 200000 === 0) await yieldToMain()
      }
    }
    return new Blob([buf], { type: 'model/stl' })
  }
  const chunks = [`solid ${name}\n`]
  let buf = [], n = 0
  for (const p of meshes) {
    const P = p.positions, I = p.index
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3
      const nr = triNormal(P, a, b, c)
      buf.push(`facet normal ${nr.map(stlNum).join(' ')}\n outer loop\n  vertex ${stlNum(P[a])} ${stlNum(P[a + 1])} ${stlNum(P[a + 2])}\n  vertex ${stlNum(P[b])} ${stlNum(P[b + 1])} ${stlNum(P[b + 2])}\n  vertex ${stlNum(P[c])} ${stlNum(P[c + 1])} ${stlNum(P[c + 2])}\n endloop\nendfacet\n`)
      if (++n % 50000 === 0) { chunks.push(buf.join('')); buf = []; await yieldToMain() }
    }
  }
  chunks.push(buf.join(''), `endsolid ${name}\n`)
  return new Blob(chunks, { type: 'model/stl' })
}

async function writePLY(parts, name, binary, diag) {
  let hasC = false, base = 0
  const prepared = []
  for (const p of parts) {
    let q = p
    if (p.kind !== 'points' && !p.shared) q = await weldPart(p, 1e-7, diag)
    prepared.push(q)
    if (q.colors) hasC = true
  }
  const hasN = prepared.length > 0 && prepared.every((q) => q.kind !== 'points' && q.normals)
  let nv = 0
  for (const q of prepared) nv += q.positions.length / 3
  const nf = prepared.reduce((s, q) => s + (q.kind === 'points' ? 0 : q.index.length / 3), 0)
  const props = ['property float x', 'property float y', 'property float z', ...(hasN ? ['property float nx', 'property float ny', 'property float nz'] : []), ...(hasC ? ['property uchar red', 'property uchar green', 'property uchar blue'] : [])]
  const header = `ply\nformat ${binary ? 'binary_little_endian' : 'ascii'} 1.0\ncomment ${name}\nelement vertex ${nv}\n${props.join('\n')}\n${nf ? `element face ${nf}\nproperty list uchar int vertex_indices\n` : ''}end_header\n`
  const c255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)))
  if (binary) {
    const stride = 12 + (hasN ? 12 : 0) + (hasC ? 3 : 0)
    const vb = new ArrayBuffer(nv * stride), vd = new DataView(vb)
    let o = 0
    for (const q of prepared) {
      const n = q.positions.length / 3
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) vd.setFloat32(o + k * 4, q.positions[i * 3 + k], true)
        o += 12
        if (hasN) { for (let k = 0; k < 3; k++) vd.setFloat32(o + k * 4, q.normals[i * 3 + k], true); o += 12 }
        if (hasC) { for (let k = 0; k < 3; k++) vd.setUint8(o + k, q.colors ? c255(q.colors[i * 3 + k]) : 255); o += 3 }
      }
      await yieldToMain()
    }
    const fb = new ArrayBuffer(nf * 13), fd = new DataView(fb)
    let fo = 0
    for (const q of prepared) {
      if (q.kind === 'points') { base += q.positions.length / 3; continue }
      for (let k = 0; k < q.index.length; k += 3) { fd.setUint8(fo, 3); for (let j = 0; j < 3; j++) fd.setInt32(fo + 1 + j * 4, q.index[k + j] + base, true); fo += 13 }
      base += q.positions.length / 3
    }
    return new Blob([header, vb, fb], { type: 'model/ply' })
  }
  const lines = [header]
  for (const q of prepared) {
    const n = q.positions.length / 3
    for (let i = 0; i < n; i++) {
      let s = `${fmtNum(q.positions[i * 3])} ${fmtNum(q.positions[i * 3 + 1])} ${fmtNum(q.positions[i * 3 + 2])}`
      if (hasN) s += ` ${fmtNum(q.normals[i * 3])} ${fmtNum(q.normals[i * 3 + 1])} ${fmtNum(q.normals[i * 3 + 2])}`
      if (hasC) s += q.colors ? ` ${c255(q.colors[i * 3])} ${c255(q.colors[i * 3 + 1])} ${c255(q.colors[i * 3 + 2])}` : ' 255 255 255'
      lines.push(s + '\n')
      if (i % 200000 === 199999) await yieldToMain()
    }
  }
  base = 0
  for (const q of prepared) {
    if (q.kind !== 'points') for (let k = 0; k < q.index.length; k += 3) lines.push(`3 ${q.index[k] + base} ${q.index[k + 1] + base} ${q.index[k + 2] + base}\n`)
    base += q.positions.length / 3
  }
  return new Blob(lines, { type: 'model/ply' })
}

/** Dedupe a per-vertex float array: returns { values, map } so equal tuples share one entry. */
function dedupeAttr(arr, size, tol) {
  const n = arr.length / size, map = new Uint32Array(n), keys = new Map(), out = []
  const inv = 1 / tol
  for (let i = 0; i < n; i++) {
    let key = ''
    for (let k = 0; k < size; k++) key += Math.round(arr[i * size + k] * inv) + ','
    let j = keys.get(key)
    if (j === undefined) { j = out.length / size; keys.set(key, j); for (let k = 0; k < size; k++) out.push(arr[i * size + k]) }
    map[i] = j
  }
  return { values: out, map }
}
const identity = (n) => Uint32Array.from({ length: n }, (_, i) => i)

async function textureToPng(tex) {
  const img = tex.image
  const w = img.videoWidth || img.naturalWidth || img.displayWidth || img.width, h = img.videoHeight || img.naturalHeight || img.displayHeight || img.height
  if (!(w > 0 && h > 0)) return null
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  if (img.data && !(img instanceof HTMLImageElement)) ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), w, h), 0, 0)
  else ctx.drawImage(img, 0, 0, w, h)
  return new Promise((r) => c.toBlob(r, 'image/png'))
}

async function writeOBJ(parts, name, diag) {
  const meshes = parts.filter((p) => p.kind !== 'points')
  const used = new Map() // material -> { id }
  const names = new Set()
  const matName = (m) => { let n = (m.name || 'material').replace(/\s+/g, '_'), i = 1; const b = n; while (names.has(n)) n = `${b}_${i++}`; names.add(n); return n }
  const body = []
  let vo = 1, to = 1, no = 1
  const wantMtl = meshes.some((p) => p.material && !p.material.userData?.generic)
  if (wantMtl) body.push(`mtllib ${name}.mtl\n`)
  for (const p of meshes) {
    const nvIn = p.positions.length / 3
    const P = p.shared ? { values: p.positions, map: identity(nvIn) } : dedupeAttr(p.positions, 3, Math.max(diag * 1e-7, 1e-12))
    const N = p.normals ? (p.shared ? { values: p.normals, map: identity(nvIn) } : dedupeAttr(p.normals, 3, 1e-4)) : null
    const flipV = p.material?.map && p.material.map.flipY === false
    let UV = null
    if (p.uvs) {
      const uv = flipV ? Float32Array.from(p.uvs, (v, i) => (i % 2 ? 1 - v : v)) : p.uvs
      UV = p.shared ? { values: uv, map: identity(nvIn) } : dedupeAttr(uv, 2, 1e-6)
    }
    body.push(`o ${(p.name || 'mesh').replace(/\s+/g, '_')}\n`)
    if (wantMtl && p.material && !p.material.userData?.generic) {
      if (!used.has(p.material)) used.set(p.material, { id: matName(p.material) })
      body.push(`usemtl ${used.get(p.material).id}\n`)
    }
    const vs = [], vts = [], vns = []
    for (let i = 0; i < P.values.length; i += 3) vs.push(`v ${fmtNum(P.values[i])} ${fmtNum(P.values[i + 1])} ${fmtNum(P.values[i + 2])}\n`)
    if (UV) for (let i = 0; i < UV.values.length; i += 2) vts.push(`vt ${fmtNum(UV.values[i])} ${fmtNum(UV.values[i + 1])}\n`)
    if (N) for (let i = 0; i < N.values.length; i += 3) vns.push(`vn ${fmtNum(N.values[i])} ${fmtNum(N.values[i + 1])} ${fmtNum(N.values[i + 2])}\n`)
    body.push(vs.join(''), vts.join(''), vns.join(''))
    const f = []
    const ref = (i) => `${P.map[i] + vo}${UV || N ? '/' : ''}${UV ? UV.map[i] + to : ''}${N ? '/' + (N.map[i] + no) : ''}`
    for (let k = 0; k < p.index.length; k += 3) {
      f.push(`f ${ref(p.index[k])} ${ref(p.index[k + 1])} ${ref(p.index[k + 2])}\n`)
      if (k % 300000 === 299997) { body.push(f.join('')); f.length = 0; await yieldToMain() }
    }
    body.push(f.join(''))
    vo += P.values.length / 3; to += UV ? UV.values.length / 2 : 0; no += N ? N.values.length / 3 : 0
  }
  const out = [new File(body, `${name}.obj`, { type: 'model/obj' })]
  if (wantMtl) {
    const lines = []
    const texFiles = new Map()
    for (const [m, { id }] of used) {
      lines.push(`newmtl ${id}\n`)
      const c = m.color ? m.color.getRGB({}, 'srgb') : { r: 0.8, g: 0.8, b: 0.8 }
      lines.push(`Kd ${[c.r, c.g, c.b].map((v) => +v.toFixed(4)).join(' ')}\n`)
      if (m.opacity < 1) lines.push(`d ${fmtNum(m.opacity)}\n`)
      lines.push('illum 2\n')
      if (m.map?.image) {
        if (!texFiles.has(m.map)) {
          const blob = await textureToPng(m.map)
          if (blob) texFiles.set(m.map, new File([blob], `${name}-texture${texFiles.size + 1}.png`, { type: 'image/png' }))
        }
        if (texFiles.has(m.map)) lines.push(`map_Kd ${texFiles.get(m.map).name}\n`)
      }
    }
    out.push(new File(lines, `${name}.mtl`, { type: 'model/mtl' }), ...texFiles.values())
  }
  return out
}

async function write3MF(parts, name, diag) {
  const meshes = parts.filter((p) => p.kind !== 'points')
  const colors = [], objects = []
  let id = 2
  for (const p of meshes) {
    const q = p.shared ? p : await weldPart(p, 1e-7, diag)
    const P = q.positions, I = q.index
    const v = new Array(P.length / 3), t = new Array(I.length / 3)
    for (let i = 0; i < v.length; i++) v[i] = `<vertex x="${fmtNum(P[i * 3])}" y="${fmtNum(P[i * 3 + 1])}" z="${fmtNum(P[i * 3 + 2])}"/>`
    let nt = 0
    for (let i = 0; i < I.length; i += 3) if (I[i] !== I[i + 1] && I[i + 1] !== I[i + 2] && I[i] !== I[i + 2]) t[nt++] = `<triangle v1="${I[i]}" v2="${I[i + 1]}" v3="${I[i + 2]}"/>`
    t.length = nt
    let pid = ''
    const m = p.material
    if (m?.color && !m.userData?.generic && !m.vertexColors) {
      const c = m.color.getRGB({}, 'srgb')
      const hex = '#' + [c.r, c.g, c.b].map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
      colors.push(`<basematerials id="${id}"><base name="${esc(m.name || 'material')}" displaycolor="${hex}"/></basematerials>`)
      pid = ` pid="${id}" pindex="0"`
      id++
    }
    objects.push({ id, xml: `<object id="${id}" type="model" name="${esc(p.name || 'mesh')}"${pid}><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>` })
    id++
    await yieldToMain()
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${esc(name)}</metadata><resources>${colors.join('')}${objects.map((o) => o.xml).join('')}</resources><build>${objects.map((o) => `<item objectid="${o.id}"/>`).join('')}</build></model>`
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: model },
  ]).then((b) => new Blob([b], { type: 'model/3mf' }))
}

/** skin.skeleton is optional, and the exporter sets it to a node that is not a common root for some rigs (strict readers reject that). */
function dropSkeletonRoots(result) {
  const strip = (json) => { let n = 0; for (const sk of json.skins || []) if ('skeleton' in sk) { delete sk.skeleton; n++ } return n }
  if (!(result instanceof ArrayBuffer)) { strip(result); return result }
  const dv = new DataView(result), jl = dv.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(result, 20, jl)))
  if (!strip(json)) return result
  const text = new TextEncoder().encode(JSON.stringify(json))
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20)
  padded.set(text)
  const rest = new Uint8Array(result, 20 + jl)
  const out = new Uint8Array(20 + padded.length + rest.length)
  out.set(new Uint8Array(result, 0, 12))
  const od = new DataView(out.buffer)
  od.setUint32(8, out.length, true)
  od.setUint32(12, padded.length, true)
  od.setUint32(16, 0x4e4f534a, true)
  out.set(padded, 20)
  out.set(rest, 20 + padded.length)
  return out.buffer
}

/** Write a prepared model. Returns File[] (OBJ can return the .obj plus its .mtl and textures). */
export async function writeModel(object, to, { name = 'model', binary = true, animations = [], signal } = {}) {
  const T = await three()
  const file = (blob, e = to) => new File([blob], `${name}.${e}`, { type: FORMATS[e]?.mime || blob.type })
  if (to === 'glb' || to === 'gltf' || to === 'usdz') {
    let has = false
    object.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && o.geometry) has = true })
    if (!has) throw fail('This model has no geometry to save.')
    if (to === 'usdz') {
      const { USDZExporter } = await addon('exporters/USDZExporter.js')
      const scene = new T.Scene()
      scene.add(object)
      let n = 0
      object.traverse((o) => { if (typeof o.name !== 'string') o.name = ''; for (const m of [].concat(o.material || [])) if (typeof m.name !== 'string' || !m.name) m.name = `material_${++n}` })
      const ex = new USDZExporter()
      const data = await (ex.parseAsync ? ex.parseAsync(scene) : ex.parse(scene))
      return [file(new Blob([data], { type: 'model/vnd.usdz+zip' }))]
    }
    const { GLTFExporter } = await addon('exporters/GLTFExporter.js')
    const result = await new GLTFExporter().parseAsync(object, { binary: to === 'glb', onlyVisible: true, animations: animations.filter((a) => a.tracks.length) })
    check(signal)
    return [file(to === 'glb' ? new Blob([dropSkeletonRoots(result)], { type: 'model/gltf-binary' }) : new Blob([JSON.stringify(dropSkeletonRoots(result))], { type: 'model/gltf+json' }))]
  }
  const parts = flatten(object, { points: to === 'ply' })
  const meshes = parts.filter((p) => p.kind !== 'points')
  if (!meshes.length && to !== 'ply') throw fail(`This model has no surfaces (it is a point cloud or lines), so it cannot be saved as ${to.toUpperCase()}.`)
  const { diag } = bounds(parts)
  check(signal)
  if (to === 'stl') return [file(await writeSTL(parts, name, binary))]
  if (to === 'ply') return [file(await writePLY(parts, name, binary, diag))]
  if (to === 'obj') return writeOBJ(parts, name, diag)
  if (to === '3mf') return [file(await write3MF(parts, name, diag))]
  throw fail(`Cannot write ${to.toUpperCase()} files.`)
}

/**
 * Read, transform and write in one call. `main` is the model file, `companions` the other dropped files.
 * `to` is a writable extension or 'png' / 'jpg' for a preview image. Returns { files, notes, format }.
 */
export async function convertModel(main, companions, to, opts = {}, { signal, onProgress } = {}) {
  const model = await readModel(main, companions, { signal })
  model.name = main.name
  try {
    onProgress?.(0.25)
    check(signal)
    const base = baseName(main.name)
    if (to === 'png' || to === 'jpg') {
      const { object } = await prepare(model, {}, to)
      const { renderImage } = await import('./_stage.js')
      const blob = await renderImage(object, { up: upAxisOf(model.format), angle: opts.angle || 'iso', size: Number(opts.size) || 1024, transparent: !!opts.transparent && to === 'png', type: to, wireframe: !!opts.wireframe })
      return { files: [new File([blob], `${base}.${to}`, { type: blob.type })], notes: model.notes, format: model.format }
    }
    const { object, notes } = await prepare(model, opts, to, { onProgress: (f) => onProgress?.(0.25 + f * 0.25) })
    onProgress?.(0.55)
    const files = await writeModel(object, to, { name: base, binary: opts.binary !== false, animations: model.animations, signal })
    onProgress?.(1)
    return { files, notes: [...model.notes, ...notes], format: model.format }
  } finally {
    model.dispose()
  }
}
