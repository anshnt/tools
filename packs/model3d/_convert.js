// Routes of the 3D model pack for the universal File Converter. Extensions are lowercase, without the dot.
import { convertModel, READ_EXTS, UNIT_PRESETS, AXIS_CHOICES, PLACE_CHOICES } from './_model.js'
import { ANGLES } from './_stage.js'

const IN = READ_EXTS
const MODEL_OPTIONS = [
  { key: 'units', label: 'Change units', type: 'select', choices: UNIT_PRESETS, default: '1' },
  { key: 'scale', label: 'Extra scale factor', type: 'number', min: 0.000001, max: 1000000, default: 1 },
  { key: 'axis', label: 'Up axis', type: 'select', choices: AXIS_CHOICES, default: 'keep' },
  { key: 'place', label: 'Position', type: 'select', choices: PLACE_CHOICES, default: 'keep' },
  { key: 'merge', label: 'Merge meshes into one', type: 'toggle', default: false },
  { key: 'repair', label: 'Repair mesh (STL, 3D printing)', type: 'toggle', default: false },
  { key: 'binary', label: 'Binary file (STL and PLY)', type: 'toggle', default: true },
]
const IMAGE_OPTIONS = [
  { key: 'angle', label: 'View', type: 'select', choices: ANGLES, default: 'iso' },
  { key: 'size', label: 'Image size (px)', type: 'number', min: 64, max: 4096, default: 1024 },
  { key: 'transparent', label: 'Transparent background (PNG)', type: 'toggle', default: false },
  { key: 'wireframe', label: 'Wireframe', type: 'toggle', default: false },
]

// One file in, the converted file(s) out. Companion files (textures, .bin, .mtl) are only available in the 3D model converter tool.
const run = async (file, to, opts = {}, { signal, onProgress } = {}) => (await convertModel(file, [], to, opts, { signal, onProgress })).files

export const CONVERTERS = [
  { from: IN, to: ['glb', 'gltf', 'stl', 'obj', 'ply', '3mf', 'usdz'], group: '3D models', options: MODEL_OPTIONS, run },
  { from: IN, to: ['png', 'jpg'], group: '3D models', options: IMAGE_OPTIONS, run },
]

const ascii = (b, s, o = 0) => [...s].every((ch, i) => b[o + i] === ch.charCodeAt(0))
export const SNIFF = [
  { ext: 'glb', test: (b) => ascii(b, 'glTF') },
  { ext: 'ply', test: (b) => ascii(b, 'ply') },
  { ext: 'fbx', test: (b) => ascii(b, 'Kaydara FBX Binary') },
  { ext: 'off', test: (b) => ascii(b, 'OFF') || ascii(b, 'COFF') },
  { ext: 'stl', test: (b) => ascii(b, 'solid') && new TextDecoder().decode(b.subarray(0, Math.min(b.length, 600))).includes('facet') },
  { ext: 'dae', test: (b) => new TextDecoder().decode(b.subarray(0, Math.min(b.length, 600))).includes('<COLLADA') },
  { ext: '3ds', test: (b) => b[0] === 0x4d && b[1] === 0x4d && !(b[2] === 0 && b[3] === 0x2a) },
]
