// three.js (MIT) from a pinned jsDelivr build. The +esm endpoint rewrites the add-ons' bare 'three' import,
// so every loader and exporter shares the single three instance loaded here.
export const THREE_VERSION = '0.186.1'
const BASE = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`
const cache = new Map()
const load = (key, url) => {
  if (!cache.has(key)) {
    cache.set(key, import(url).catch((e) => {
      cache.delete(key)
      throw Object.assign(new Error('Could not load the 3D engine. Check your connection and try again.'), { cause: e })
    }))
  }
  return cache.get(key)
}
/** The three.js core namespace. */
export const three = () => load('three', `${BASE}/+esm`)
/** An add-on module, e.g. addon('loaders/STLLoader.js') or addon('controls/OrbitControls.js'). */
export const addon = (path) => load(path, `${BASE}/examples/jsm/${path}/+esm`)
