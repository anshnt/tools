// Pinned third-party libraries used by the CorelDRAW tools, loaded on demand from the CDN.
import { script, jszip } from '../../lib/libs.js'

const jsd = (path) => `https://cdn.jsdelivr.net/npm/${path}`
export const VERSIONS = { imagetracer: '1.2.6', opentype: '1.3.4', fontsource: '5.0.8', pako: '2.1.0' }

/** imagetracerjs (Unlicense): raster image -> layered vector paths. */
export const imagetracer = () => script(jsd(`imagetracerjs@${VERSIONS.imagetracer}/imagetracer_v${VERSIONS.imagetracer}.js`)).then(() => {
  if (!window.ImageTracer) throw new Error('The image tracer did not load.')
  return window.ImageTracer
})
/** opentype.js (MIT): reads font files so text can become outlines. */
export const opentype = () => script(jsd(`opentype.js@${VERSIONS.opentype}/dist/opentype.min.js`)).then(() => window.opentype)
/** pako (MIT and zlib): inflate fallback for browsers without DecompressionStream. */
export const pako = () => import(jsd(`pako@${VERSIONS.pako}/dist/pako.esm.mjs`))
export { jszip }

// Free fonts (Google Fonts, OFL) served by Fontsource on the CDN: one sans, one serif, one mono, regular and bold.
const FONT_FILES = {
  sans: (w) => `@fontsource/inter@${VERSIONS.fontsource}/files/inter-latin-${w}-normal.woff`,
  serif: (w) => `@fontsource/noto-serif@${VERSIONS.fontsource}/files/noto-serif-latin-${w}-normal.woff`,
  mono: (w) => `@fontsource/roboto-mono@${VERSIONS.fontsource}/files/roboto-mono-latin-${w}-normal.woff`,
}
export const fontKind = (family = '') => (/mono|courier|consolas|menlo|code/i.test(family) ? 'mono' : /serif|times|georgia|garamond|palatino|cambria|book/i.test(family) && !/sans/i.test(family) ? 'serif' : 'sans')
const fonts = new Map()
/** An opentype.js Font for a CSS family (mapped to the closest bundled font) and weight. */
export function loadFont(family, bold) {
  const key = `${fontKind(family)}${bold ? 700 : 400}`
  if (!fonts.has(key)) {
    fonts.set(key, (async () => {
      const [ot, res] = await Promise.all([opentype(), fetch(jsd(FONT_FILES[fontKind(family)](bold ? 700 : 400)))])
      if (!res.ok) throw new Error('Could not load the font for outlines.')
      return ot.parse(await res.arrayBuffer())
    })().catch((e) => { fonts.delete(key); throw e }))
  }
  return fonts.get(key)
}
