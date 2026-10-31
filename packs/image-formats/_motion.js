// Motion photos: the short video hidden inside an Android motion photo (JPEG with an MP4 attached), and iPhone .livp files (a zip of a still and a MOV).
import { jszip } from './_libs.js'
import { ascii, be32 } from './_codecs.js'

const BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  ', 'MSNV', 'dash', 'hvc1', 'heic'])

const isFtyp = (b, p) => p >= 4 && p + 12 <= b.length && ascii(b, p, 4) === 'ftyp' && be32(b, p - 4) >= 16 && be32(b, p - 4) <= 128 && BRANDS.has(ascii(b, p + 4, 4))

/** Find the video appended to a motion photo. Returns { video, still, method } or throws when the picture has no motion part. */
export function splitMotionPhoto(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) throw new Error('This is not a JPEG photo. Motion photos from Android phones are JPEG files.')
  const head = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 400000)))
  let start = -1, method = ''
  // 1. older "micro video" photos: the offset is counted back from the end of the file
  const micro = head.match(/MicroVideoOffset["']?\s*[=>:]\s*["']?(\d+)/)
  if (micro && +micro[1] > 0 && +micro[1] < b.length) { start = b.length - +micro[1]; method = 'MicroVideoOffset' }
  // 2. newer photos list the video as the last item of the container directory
  if (start < 0 || !isFtyp(b, start + 4)) {
    const items = [...head.matchAll(/<Container:Item\b[^>]*>/g)].map((m) => m[0])
    const vid = items.find((s) => /Item:Mime="video\/mp4"/i.test(s) || /Item:Semantic="MotionPhoto"/i.test(s))
    const len = vid && vid.match(/Item:Length="(\d+)"/)
    if (len && +len[1] > 0 && +len[1] < b.length) { start = b.length - +len[1]; method = 'container directory' }
  }
  // 3. look for the start of an MP4 file
  if (start < 0 || !isFtyp(b, start + 4)) {
    start = -1
    for (let p = 2048; p + 12 < b.length; p++) {
      if (b[p] === 0x66 && b[p + 1] === 0x74 && b[p + 2] === 0x79 && b[p + 3] === 0x70 && isFtyp(b, p)) { start = p - 4; method = 'file search'; break }
    }
  }
  if (start < 0 || !isFtyp(b, start + 4)) throw new Error('No video was found inside this photo. It may be an ordinary photo, or the motion part was removed when it was shared.')
  return { video: b.subarray(start), still: b.subarray(0, start), method }
}

/** Read an iPhone Live Photo (.livp). Returns { still: { name, blob } | null, video: { name, blob } | null }. */
export async function readLivp(file) {
  const JSZip = await jszip()
  let z
  try { z = await JSZip.loadAsync(file) } catch { throw new Error('This does not look like a Live Photo (.livp) file.') }
  const files = Object.values(z.files).filter((f) => !f.dir && !/^__MACOSX|\/\./.test(f.name))
  const pick = (re) => files.find((f) => re.test(f.name))
  const still = pick(/\.(heic|heif|jpe?g)$/i), video = pick(/\.(mov|mp4)$/i)
  if (!still && !video) throw new Error('This Live Photo file has no picture or video inside.')
  const read = async (f) => (f ? { name: f.name.split('/').pop(), blob: await f.async('blob') } : null)
  return { still: await read(still), video: await read(video) }
}
