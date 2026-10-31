// SVG <-> SVGZ (gzip) with the browser's CompressionStream and DecompressionStream.
const pipe = async (bytes, stream) => {
  const w = stream.writable.getWriter()
  w.write(bytes).catch(() => {})
  w.close().catch(() => {})
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}
export const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b

export async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot compress files. Use a current Chrome, Edge, Firefox or Safari.')
  return pipe(bytes, new CompressionStream('gzip'))
}
export async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack gzip files. Use a current Chrome, Edge, Firefox or Safari.')
  try { return await pipe(bytes, new DecompressionStream('gzip')) } catch { throw new Error('This file is not valid gzip data, so it cannot be an SVGZ.') }
}
