// Named presets per kind of file (pictures, PDF, video ...) and the converter's own remembered settings. Stored on this device only.
import { load, save } from '../../lib/store.js'

const KEY = 'fc-presets'
const SETTINGS = 'fc-settings'
const read = () => load(KEY, {})
const write = (all) => save(KEY, all)

/** {names: [...], default: name | null} for one kind. */
export function listPresets(kind) {
  const p = read()[kind] || { items: {} }
  return { names: Object.keys(p.items), default: p.default && p.items[p.default] ? p.default : null }
}
export const getPreset = (kind, name) => read()[kind]?.items?.[name] || null
/** Values of the default preset for a kind ({} when none). */
export function defaultValues(kind) {
  const { default: d } = listPresets(kind)
  return d ? { ...getPreset(kind, d) } : {}
}
export function savePreset(kind, name, values, makeDefault = false) {
  name = String(name || '').trim().slice(0, 40)
  if (!name) throw new Error('Give the preset a name.')
  const all = read()
  const p = (all[kind] ||= { items: {} })
  p.items[name] = { ...values }
  if (makeDefault) p.default = name
  write(all)
  return name
}
export function deletePreset(kind, name) {
  const all = read()
  const p = all[kind]
  if (!p) return
  delete p.items[name]
  if (p.default === name) p.default = null
  write(all)
}
export function setDefaultPreset(kind, name) {
  const all = read()
  const p = (all[kind] ||= { items: {} })
  p.default = name && p.items[name] ? name : null
  write(all)
}
/** Every preset name across kinds, for places that are not tied to one kind (the watch folder). */
export function allPresets() {
  const out = new Map()
  for (const [kind, p] of Object.entries(read())) for (const [name, values] of Object.entries(p.items || {})) if (!out.has(name)) out.set(name, { kind, values })
  return out
}

export const loadSettings = () => ({ pattern: '{name}', saveAs: 'zip', ...load(SETTINGS, {}) })
export const saveSettings = (s) => save(SETTINGS, s)
