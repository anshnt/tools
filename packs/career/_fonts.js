// Optional Unicode fonts for jsPDF (Roboto: Apache 2.0). Needed for the rupee sign and other symbols outside the built-in fonts.
// Loads once from the CDN; callers fall back to Helvetica when it cannot be fetched.
import { bytesToBase64 } from '../../lib/files.js'

const BASE = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/roboto@0.2.3/'
const FILES = { normal: 'Roboto_400Regular.ttf', bold: 'Roboto_700Bold.ttf' }
let cache = null

async function fetchFonts() {
  const out = {}
  for (const [style, file] of Object.entries(FILES)) {
    const res = await fetch(BASE + file)
    if (!res.ok) throw new Error(`font ${file}: ${res.status}`)
    out[style] = bytesToBase64(new Uint8Array(await res.arrayBuffer()))
  }
  return out
}

/** Register Roboto on a jsPDF doc. Resolves true when available. */
export async function addRoboto(doc) {
  try {
    cache ??= fetchFonts().catch((e) => { cache = null; throw e })
    const f = await cache
    for (const [style, b64] of Object.entries(f)) {
      const name = `Roboto-${style}.ttf`
      doc.addFileToVFS(name, b64)
      doc.addFont(name, 'Roboto', style)
    }
    return true
  } catch (e) {
    console.warn('Roboto font unavailable, using the built-in font', e)
    return false
  }
}
