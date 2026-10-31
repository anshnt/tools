// Work out what a file really is: the extension first, confirmed or corrected by the first bytes (magic numbers).
import { canon, kindOfExt } from './_formats.js'
import { ext as extOf } from '../../lib/files.js'

const A = (s) => [...s].map((c) => c.charCodeAt(0))
const starts = (b, sig, at = 0) => sig.every((v, i) => v === null || b[at + i] === v)
const text = (b, from, to) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)))

/** Our own magic-number checks. Each returns an extension or undefined. Order matters. */
export const SNIFF = [
  { ext: 'pdf', test: (b) => starts(b, A('%PDF-')) || text(b, 0, 1024).includes('%PDF-') },
  { ext: 'jpg', test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { ext: 'png', test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { ext: 'gif', test: (b) => starts(b, A('GIF8')) },
  { ext: 'webp', test: (b) => starts(b, A('RIFF')) && text(b, 8, 12) === 'WEBP' },
  { ext: 'bmp', test: (b) => starts(b, A('BM')) && b.length > 14 && b[6] === 0 && b[7] === 0 },
  { ext: 'ico', test: (b) => starts(b, [0, 0, 1, 0]) && b[5] === 0 && b[4] > 0 },
  { ext: 'tiff', test: (b) => starts(b, [0x49, 0x49, 0x2a, 0]) || starts(b, [0x4d, 0x4d, 0, 0x2a]) },
  { ext: 'psd', test: (b) => starts(b, A('8BPS')) },
  { ext: 'heic', test: (b) => text(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(text(b, 8, 12)) },
  { ext: 'avif', test: (b) => text(b, 4, 8) === 'ftyp' && /^avi[fs]/.test(text(b, 8, 12)) },
  { ext: 'mov', test: (b) => text(b, 4, 8) === 'ftyp' && text(b, 8, 12) === 'qt  ' },
  { ext: 'm4a', test: (b) => text(b, 4, 8) === 'ftyp' && /^M4[AB] /.test(text(b, 8, 12)) },
  { ext: '3gp', test: (b) => text(b, 4, 8) === 'ftyp' && /^3g/.test(text(b, 8, 11)) },
  { ext: 'mp4', test: (b) => text(b, 4, 8) === 'ftyp' },
  { ext: 'webm', test: (b) => starts(b, [0x1a, 0x45, 0xdf, 0xa3]) && text(b, 0, 64).includes('webm') },
  { ext: 'mkv', test: (b) => starts(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  { ext: 'avi', test: (b) => starts(b, A('RIFF')) && text(b, 8, 12) === 'AVI ' },
  { ext: 'wav', test: (b) => starts(b, A('RIFF')) && text(b, 8, 12) === 'WAVE' },
  { ext: 'mp3', test: (b) => starts(b, A('ID3')) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) },
  { ext: 'flac', test: (b) => starts(b, A('fLaC')) },
  { ext: 'ogg', test: (b) => starts(b, A('OggS')) },
  { ext: 'flv', test: (b) => starts(b, A('FLV')) },
  { ext: 'gz', test: (b) => starts(b, [0x1f, 0x8b]) },
  { ext: '7z', test: (b) => starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  { ext: 'rar', test: (b) => starts(b, A('Rar!')) },
  { ext: 'xz', test: (b) => starts(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]) },
  { ext: 'bz2', test: (b) => starts(b, A('BZh')) },
  { ext: 'zst', test: (b) => starts(b, [0x28, 0xb5, 0x2f, 0xfd]) },
  { ext: 'woff2', test: (b) => starts(b, A('wOF2')) },
  { ext: 'woff', test: (b) => starts(b, A('wOFF')) },
  { ext: 'otf', test: (b) => starts(b, A('OTTO')) },
  { ext: 'ttf', test: (b) => starts(b, [0, 1, 0, 0, 0]) || starts(b, A('true')) },
  { ext: 'rtf', test: (b) => starts(b, A('{\\rtf')) },
  { ext: 'sqlite', test: (b) => text(b, 0, 15) === 'SQLite format 3' },
  { ext: 'hwp', test: (b) => starts(b, [0xd0, 0xcf, 0x11, 0xe0]) && text(b, 0, 4096).includes('H\0w\0p\0') },
  { ext: 'ole', test: (b) => starts(b, [0xd0, 0xcf, 0x11, 0xe0]) },
  { ext: 'zip', test: (b) => starts(b, [0x50, 0x4b, 3, 4]) || starts(b, [0x50, 0x4b, 5, 6]) },
  { ext: 'svg', test: (b) => /<svg[\s>]/i.test(text(b, 0, 2048)) },
  { ext: 'html', test: (b) => /^\s*(<!doctype html|<html)/i.test(text(b, 0, 512)) },
  { ext: 'xml', test: (b) => /^\s*<\?xml/i.test(text(b, 0, 64)) },
]

/** Zip containers are told apart by what is inside (the first entry names sit within the first few KB). */
function zipKind(b) {
  const t = text(b, 0, 8192)
  if (t.includes('mimetypeapplication/epub+zip')) return 'epub'
  if (t.includes('[Content_Types].xml')) {
    if (t.includes('word/')) return 'docx'
    if (t.includes('xl/')) return 'xlsx'
    if (t.includes('ppt/')) return 'pptx'
  }
  if (t.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return 'odt'
  if (t.includes('mimetypeapplication/vnd.oasis.opendocument.spreadsheet')) return 'ods'
  if (t.includes('mimetypeapplication/vnd.oasis.opendocument.presentation')) return 'odp'
  if (t.includes('Contents/section0.xml')) return 'hwpx'
  return null
}

// Formats that share a container: a different name inside the same family is not a conflict.
const FAMILIES = [['mp4', 'mov', 'm4a', '3gp', 'm4v', 'heic', 'avif', 'aac'], ['mkv', 'webm'], ['avi', 'wav', 'webp'], ['mp3', 'aac', 'mp2'], ['ogg', 'opus', 'oga', 'ogv'],
  ['zip', 'docx', 'xlsx', 'pptx', 'epub', 'odt', 'ods', 'odp', 'hwpx', 'jar', 'apk', 'cbz', 'kmz', '3mf', 'xlsm', 'dotx', 'ppsx', 'xltx'], ['ole', 'doc', 'xls', 'ppt', 'hwp', 'msg'],
  ['gz', 'tgz'], ['ttf', 'ttc'], ['html', 'xml', 'svg', 'txt'], ['jpg', 'jpeg']]
const sameFamily = (a, b) => a === b || FAMILIES.some((f) => f.includes(a) && f.includes(b))
// Magic that is trustworthy enough to overrule a wrong file name.
const STRONG = new Set(['pdf', 'jpg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'psd', 'heic', 'avif', 'mp4', 'mov', 'webm', 'mkv', 'avi', 'wav', 'mp3', 'flac', 'ogg', 'gz', '7z', 'rar', 'woff', 'woff2', 'otf', 'ttf', 'fits'])

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/heic': 'heic', 'image/heif': 'heif',
  'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'text/html': 'html', 'text/markdown': 'md', 'application/json': 'json', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav',
  'video/webm': 'webm', 'application/zip': 'zip' }

/**
 * detect(file, {extra: [{ext, test}], known: (ext) => bool})
 * -> {ext, kind, nameExt, magic, corrected}: ext is the type to route on (canonical, lower case, '' when unknown).
 * `known` tells which extensions the converters accept; a name that is unknown is replaced by what the bytes say.
 */
export async function detect(file, { extra = [], known = () => true } = {}) {
  const nameExt = canon(extOf(file.name))
  let b
  try { b = new Uint8Array(await file.slice(0, 8192).arrayBuffer()) } catch { b = new Uint8Array(0) }
  let magic
  for (const s of [...extra, ...SNIFF]) {
    try { if (s.test(b)) { magic = s.ext; break } } catch { /* a bad sniffer must not stop detection */ }
  }
  if (magic === 'zip') magic = zipKind(b) || 'zip'
  magic = magic && canon(magic)
  let ext = nameExt
  let corrected = false
  if (magic && magic !== 'ole') {
    const nameOk = nameExt && known(nameExt)
    if (!nameExt || !nameOk) { ext = magic; corrected = !!nameExt }
    else if (!sameFamily(nameExt, magic) && STRONG.has(magic) && known(magic)) { ext = magic; corrected = true }
    else if (magic === 'docx' || magic === 'xlsx' || magic === 'pptx') ext = nameExt === 'zip' ? magic : nameExt
  } else if (!nameExt && file.type) ext = MIME_EXT[file.type] || ''
  else if (!known(nameExt) && file.type && MIME_EXT[file.type]) ext = MIME_EXT[file.type]
  return { ext, kind: kindOfExt(ext), nameExt, magic: magic || null, corrected }
}
