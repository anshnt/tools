// Android Motion Photo from a video: a JPEG still with the short MP4 clip appended after it, and the XMP metadata that tells
// gallery apps where the clip starts (both the current Container directory and the older GCamera:MicroVideo fields, as cameras write them).
// DOM-free. Spec: "Motion Photo format 1.0" in the Android developer docs.
import { capShortSide, inputName } from './_media.js'
import { baseName } from '../../lib/files.js'

const NS = 'http://ns.adobe.com/xap/1.0/\0'

/** The XMP packet for a motion photo whose video is `videoLength` bytes long and shows the still at `presentationUs` microseconds. */
export function buildXmp({ videoLength, presentationUs }) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.1.0-jc003">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:GCamera="http://ns.google.com/photos/1.0/camera/"
        xmlns:Container="http://ns.google.com/photos/1.0/container/"
        xmlns:Item="http://ns.google.com/photos/1.0/container/item/"
        GCamera:MicroVideo="1"
        GCamera:MicroVideoVersion="1"
        GCamera:MicroVideoOffset="${videoLength}"
        GCamera:MicroVideoPresentationTimestampUs="${presentationUs}"
        GCamera:MotionPhoto="1"
        GCamera:MotionPhotoVersion="1"
        GCamera:MotionPhotoPresentationTimestampUs="${presentationUs}">
      <Container:Directory>
        <rdf:Seq>
          <rdf:li rdf:parseType="Resource">
            <Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/>
          </rdf:li>
          <rdf:li rdf:parseType="Resource">
            <Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${videoLength}" Item:Padding="0"/>
          </rdf:li>
        </rdf:Seq>
      </Container:Directory>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

/** Put an XMP APP1 segment into a JPEG, after the JFIF and Exif segments. Returns a new Uint8Array. */
export function injectXmp(jpeg, xmp) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('The still frame is not a valid JPEG.')
  let pos = 2
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    const marker = jpeg[pos + 1]
    const len = (jpeg[pos + 2] << 8) | jpeg[pos + 3]
    const exif = marker === 0xe1 && jpeg[pos + 4] === 0x45 && jpeg[pos + 5] === 0x78 // "Ex"
    if (marker === 0xe0 || exif) pos += 2 + len; else break
  }
  const body = new TextEncoder().encode(NS + xmp)
  if (body.length + 2 > 0xffff) throw new Error('The metadata block is too large.')
  const seg = new Uint8Array(4 + body.length)
  seg[0] = 0xff
  seg[1] = 0xe1
  seg[2] = (body.length + 2) >> 8
  seg[3] = (body.length + 2) & 0xff
  seg.set(body, 4)
  const out = new Uint8Array(jpeg.length + seg.length)
  out.set(jpeg.subarray(0, pos), 0)
  out.set(seg, pos)
  out.set(jpeg.subarray(pos), pos + seg.length)
  return out
}

/** Pull the MP4 clip out of a motion photo made by makeMotionPhoto (or any file with MicroVideoOffset). Returns {jpeg, video} byte arrays or null. */
export function splitMotionPhoto(bytes) {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 70000)))
  const m = text.match(/MicroVideoOffset="(\d+)"/) || text.match(/Item:Semantic="MotionPhoto"\s+Item:Length="(\d+)"/)
  if (!m) return null
  const n = +m[1]
  return { jpeg: bytes.subarray(0, bytes.length - n), video: bytes.subarray(bytes.length - n) }
}

/** PNG blob -> JPEG blob with the browser's own encoder (canvas). */
export async function pngToJpeg(png, quality = 0.92) {
  const bmp = await createImageBitmap(png)
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height })
  c.getContext('2d').drawImage(bmp, 0, 0)
  bmp.close?.()
  return c.convertToBlob ? c.convertToBlob({ type: 'image/jpeg', quality }) : new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', quality))
}

/**
 * makeMotionPhoto({file, info, time, clip, cap, run}) -> {blob, name, still, videoBytes}
 * `time` is where the still frame is (seconds), `clip` the length of the moving part (it is centred on the still), `cap` caps the short side in pixels.
 */
export async function makeMotionPhoto({ file, info, time, clip = 3, cap = 1080, run }) {
  if (!info.hasVideo) throw new Error('No video found in this file.')
  const dur = info.duration || 0
  const t = Math.min(Math.max(0, Number.isFinite(time) ? time : Math.min(1.5, dur / 2)), Math.max(0, dur - 0.1))
  const start = Math.max(0, Math.min(t - clip / 2, dur - clip))
  const len = Math.min(clip, Math.max(0.5, dur - start))
  const dims = cap && info.display ? capShortSide(info.display.width, info.display.height, cap) : null
  const vf = dims?.w ? `scale=${dims.w}:${dims.h}:flags=lanczos` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
  const inName = inputName(file)
  const rel = t - start
  const common = { inputs: [{ name: inName, data: file }], total: len }
  // two separate jobs. The still is a PNG that the browser turns into a JPEG: this engine's own JPEG encoder is unreliable after an input seek
  const png = await run({
    ...common, label: 'Taking the still frame', output: 'still.png',
    args: ['-ss', t.toFixed(3), '-i', inName, '-map', '0:v:0', '-an', '-vf', vf, '-frames:v', '1', '-update', '1', 'still.png'],
  })
  const mp4 = await run({
    ...common, label: 'Making the moving clip', output: 'clip.mp4',
    args: [
      '-ss', start.toFixed(3), '-t', len.toFixed(3), '-i', inName,
      '-map', '0:v:0', ...(info.hasAudio ? ['-map', '0:a:0'] : []), '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']), '-movflags', '+faststart', 'clip.mp4',
    ],
  })
  const video = new Uint8Array(await mp4.arrayBuffer())
  const jpg = await pngToJpeg(png)
  const jpeg = injectXmp(new Uint8Array(await jpg.arrayBuffer()), buildXmp({ videoLength: video.length, presentationUs: Math.round(rel * 1e6) }))
  return { blob: new Blob([jpeg, video], { type: 'image/jpeg' }), name: `${baseName(file.name) || 'video'}-motion.jpg`, videoBytes: video.length, stillTime: t }
}
