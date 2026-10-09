// Shared logic for the Files pack: type detection (magic bytes), streaming hashes, ZIP reading, folder scanning, text helpers.
// Everything runs locally; nothing is uploaded. Files starting with "_" are never tool modules.
import { hashwasm, jszip } from '../../lib/libs.js'
import { yieldToMain } from '../../lib/ui.js'

// ---------- Generic helpers ----------
export const extOf = (name = '') => (name.match(/\.([^.\/\\]+)$/)?.[1] || '').toLowerCase()
export const stemOf = (name = '') => name.replace(/\.[^.\/\\]+$/, '')
export const hex = (n, w = 2) => n.toString(16).toUpperCase().padStart(w, '0')
export const hexBytes = (bytes, sep = ' ') => Array.from(bytes, (b) => hex(b)).join(sep)
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const naturalCompare = (a, b) => collator.compare(a, b)
export const abortError = () => Object.assign(new Error('Cancelled'), { code: 'ABORT', name: 'AbortError' })
export const throwIfAborted = (signal) => { if (signal?.aborted) throw abortError() }
const pad2 = (n) => String(n).padStart(2, '0')

/** Local "2026-10-09 14:03:07" for a timestamp or Date. */
export function fmtDateTime(v, withSeconds = false) {
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return '-'
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}${withSeconds ? ':' + pad2(d.getSeconds()) : ''}`
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** Format a date with tokens YYYY YY MMMM MMM MM DD HH mm ss (anything else is kept). Safe for filenames. */
export function fmtDate(v, fmt = 'YYYY-MM-DD') {
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const map = {
    YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(-2), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad2(d.getMonth() + 1), DD: pad2(d.getDate()), HH: pad2(d.getHours()), mm: pad2(d.getMinutes()), ss: pad2(d.getSeconds()),
  }
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|DD|HH|mm|ss/g, (t) => map[t])
}

/** Read a byte range of a Blob. */
export async function readRange(blob, start, end) {
  return new Uint8Array(await blob.slice(Math.max(0, start), Math.max(0, end)).arrayBuffer())
}

// ---------- File kinds (colors and icons used across the pack) ----------
export const KINDS = {
  image: { label: 'Images', icon: 'image', color: '#d6409f' },
  video: { label: 'Video', icon: 'clapperboard', color: '#8e4ec6' },
  audio: { label: 'Audio', icon: 'music', color: '#f76b15' },
  document: { label: 'Documents', icon: 'file-text', color: '#3e63dd' },
  sheet: { label: 'Spreadsheets', icon: 'sheet', color: '#30a46c' },
  slides: { label: 'Presentations', icon: 'presentation', color: '#e5833a' },
  archive: { label: 'Archives', icon: 'file-archive', color: '#d99a1e' },
  code: { label: 'Code', icon: 'file-code', color: '#6e56cf' },
  data: { label: 'Data', icon: 'database', color: '#12a594' },
  font: { label: 'Fonts', icon: 'type', color: '#7c66dc' },
  exec: { label: 'Programs', icon: 'cpu', color: '#e5484d' },
  text: { label: 'Text', icon: 'file-text', color: '#6b7bb3' },
  folder: { label: 'Folders', icon: 'folder', color: '#8a8794' },
  other: { label: 'Other', icon: 'file', color: '#8a8794' },
}
const KIND_EXTS = {
  image: 'jpg jpeg jpe jfif png gif webp avif heic heif bmp tif tiff svg ico cur psd raw cr2 cr3 nef arw dng orf rw2 jp2 jxl dds exr xcf ai eps',
  video: 'mp4 m4v mov mkv webm avi wmv flv mpg mpeg 3gp 3g2 ogv ts mts m2ts vob f4v',
  audio: 'mp3 wav flac aac m4a ogg oga opus wma aiff aif amr mid midi ape caf',
  document: 'pdf doc docx odt rtf pages epub mobi azw3 xps djvu tex',
  sheet: 'xls xlsx xlsm xlsb ods numbers',
  slides: 'ppt pptx pptm odp key',
  archive: 'zip rar 7z tar gz tgz bz2 xz zst lz4 cab iso dmg z lzh deb rpm jar war apk ipa nupkg',
  code: 'js mjs cjs jsx ts tsx py rb php java kt kts c h cpp cc cxx hpp cs go rs swift sh bash zsh bat cmd ps1 html htm css scss sass less vue svelte sql lua pl r dart scala ex exs hs clj',
  data: 'json csv tsv xml yaml yml toml ini cfg conf env log sqlite sqlite3 db mdb parquet avro ndjson jsonl npy hdf5 h5 pickle pkl',
  font: 'ttf otf woff woff2 ttc eot',
  exec: 'exe dll msi sys so dylib bin elf macho class dex wasm o a lib com scr',
  text: 'txt md markdown rst nfo readme license srt vtt ass lrc',
}
const EXT_KIND = {}
for (const [k, list] of Object.entries(KIND_EXTS)) for (const e of list.split(' ')) EXT_KIND[e] = k
export const kindOfExt = (ext) => EXT_KIND[(ext || '').toLowerCase()] || 'other'
export const kindOfName = (name) => kindOfExt(extOf(name))

// ---------- Magic-byte signature table ----------
// [hex pattern with ?? wildcards, offset, label, mime, primary ext, extra]
const SIG_ROWS = [
  // Images
  ['89 50 4E 47 0D 0A 1A 0A', 0, 'PNG image', 'image/png', 'png'],
  ['FF D8 FF', 0, 'JPEG image', 'image/jpeg', 'jpg', { exts: ['jpg', 'jpeg', 'jpe', 'jfif'] }],
  ['47 49 46 38 37 61', 0, 'GIF image (87a)', 'image/gif', 'gif'],
  ['47 49 46 38 39 61', 0, 'GIF image (89a)', 'image/gif', 'gif'],
  ['42 4D ?? ?? ?? ?? 00 00 00 00', 0, 'BMP image', 'image/bmp', 'bmp', { exts: ['bmp', 'dib'] }],
  ['49 49 2A 00', 0, 'TIFF image (little-endian)', 'image/tiff', 'tif', { exts: ['tif', 'tiff', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2'] }],
  ['4D 4D 00 2A', 0, 'TIFF image (big-endian)', 'image/tiff', 'tif', { exts: ['tif', 'tiff'] }],
  ['00 00 01 00', 0, 'Windows icon', 'image/x-icon', 'ico', { weak: true, exts: ['ico'] }],
  ['00 00 02 00', 0, 'Windows cursor', 'image/x-icon', 'cur', { weak: true, exts: ['cur'] }],
  ['38 42 50 53 00 01', 0, 'Photoshop document', 'image/vnd.adobe.photoshop', 'psd'],
  ['00 00 00 0C 6A 50 20 20 0D 0A 87 0A', 0, 'JPEG 2000 image', 'image/jp2', 'jp2', { exts: ['jp2', 'j2k'] }],
  ['00 00 00 0C 4A 58 4C 20 0D 0A 87 0A', 0, 'JPEG XL image', 'image/jxl', 'jxl'],
  ['FF 0A', 0, 'JPEG XL image', 'image/jxl', 'jxl', { weak: true }],
  ['44 44 53 20', 0, 'DirectDraw Surface texture', 'image/vnd.ms-dds', 'dds'],
  ['76 2F 31 01', 0, 'OpenEXR image', 'image/x-exr', 'exr'],
  ['67 69 6D 70 20 78 63 66', 0, 'GIMP image (XCF)', 'image/x-xcf', 'xcf'],
  ['25 21 50 53 2D 41 64 6F 62 65', 0, 'PostScript / EPS', 'application/postscript', 'eps', { exts: ['eps', 'ps', 'ai'] }],
  // Documents
  ['25 50 44 46 2D', 0, 'PDF document', 'application/pdf', 'pdf', { exts: ['pdf', 'ai'] }],
  ['25 21', 0, 'PostScript', 'application/postscript', 'ps', { weak: true, exts: ['ps', 'eps'] }],
  ['7B 5C 72 74 66', 0, 'Rich Text Format', 'application/rtf', 'rtf'],
  ['D0 CF 11 E0 A1 B1 1A E1', 0, 'Microsoft Compound File (legacy Office, MSI)', 'application/x-cfb', 'doc', { exts: ['doc', 'xls', 'ppt', 'msi', 'msg', 'vsd', 'pub', 'dot', 'xlt', 'pps', 'mpp', 'db'] }],
  // Archives
  ['50 4B 03 04', 0, 'ZIP archive', 'application/zip', 'zip', { zip: true }],
  ['50 4B 05 06', 0, 'ZIP archive (empty)', 'application/zip', 'zip', { zip: true }],
  ['50 4B 07 08', 0, 'ZIP archive (spanned)', 'application/zip', 'zip', { zip: true }],
  ['52 61 72 21 1A 07 00', 0, 'RAR archive', 'application/vnd.rar', 'rar'],
  ['52 61 72 21 1A 07 01 00', 0, 'RAR5 archive', 'application/vnd.rar', 'rar'],
  ['37 7A BC AF 27 1C', 0, '7-Zip archive', 'application/x-7z-compressed', '7z'],
  ['1F 8B 08', 0, 'GZIP compressed', 'application/gzip', 'gz', { exts: ['gz', 'tgz', 'svgz'] }],
  ['42 5A 68', 0, 'BZIP2 compressed', 'application/x-bzip2', 'bz2', { exts: ['bz2', 'tbz2'] }],
  ['FD 37 7A 58 5A 00', 0, 'XZ compressed', 'application/x-xz', 'xz', { exts: ['xz', 'txz'] }],
  ['28 B5 2F FD', 0, 'Zstandard compressed', 'application/zstd', 'zst'],
  ['04 22 4D 18', 0, 'LZ4 compressed', 'application/x-lz4', 'lz4'],
  ['4D 53 43 46 00 00 00 00', 0, 'Microsoft Cabinet archive', 'application/vnd.ms-cab-compressed', 'cab'],
  ['75 73 74 61 72', 257, 'TAR archive', 'application/x-tar', 'tar'],
  ['1F 9D', 0, 'Unix compress (.Z)', 'application/x-compress', 'z', { weak: true, exts: ['z'] }],
  ['?? ?? 2D 6C 68', 0, 'LHA / LZH archive', 'application/x-lzh-compressed', 'lzh', { weak: true, exts: ['lzh', 'lha'] }],
  ['21 3C 61 72 63 68 3E 0A', 0, 'Unix ar archive', 'application/x-archive', 'a', { exts: ['a', 'lib', 'deb', 'ar'] }],
  ['ED AB EE DB', 0, 'RPM package', 'application/x-rpm', 'rpm'],
  // Audio
  ['49 44 33', 0, 'MP3 audio (ID3 tag)', 'audio/mpeg', 'mp3'],
  ['66 4C 61 43', 0, 'FLAC audio', 'audio/flac', 'flac'],
  ['46 4F 52 4D ?? ?? ?? ?? 41 49 46 46', 0, 'AIFF audio', 'audio/aiff', 'aiff', { exts: ['aiff', 'aif', 'aifc'] }],
  ['4D 54 68 64', 0, 'MIDI audio', 'audio/midi', 'mid', { exts: ['mid', 'midi', 'kar'] }],
  ['23 21 41 4D 52 0A', 0, 'AMR audio', 'audio/amr', 'amr'],
  ['4D 41 43 20', 0, "Monkey's Audio", 'audio/x-ape', 'ape'],
  ['63 61 66 66', 0, 'Core Audio Format', 'audio/x-caf', 'caf'],
  ['30 26 B2 75 8E 66 CF 11 A6 D9 00 AA 00 62 CE 6C', 0, 'Windows Media (ASF)', 'video/x-ms-asf', 'wmv', { exts: ['wmv', 'wma', 'asf'] }],
  // Video
  ['46 4C 56 01', 0, 'Flash video (FLV)', 'video/x-flv', 'flv'],
  ['00 00 01 BA', 0, 'MPEG program stream', 'video/mpeg', 'mpg', { exts: ['mpg', 'mpeg', 'vob'] }],
  ['00 00 01 B3', 0, 'MPEG video', 'video/mpeg', 'mpg', { exts: ['mpg', 'mpeg', 'm1v', 'm2v'] }],
  ['46 57 53', 0, 'Flash (SWF)', 'application/x-shockwave-flash', 'swf'],
  ['43 57 53', 0, 'Flash (SWF, compressed)', 'application/x-shockwave-flash', 'swf'],
  ['5A 57 53', 0, 'Flash (SWF, LZMA)', 'application/x-shockwave-flash', 'swf'],
  // Executables
  ['7F 45 4C 46', 0, 'ELF executable', 'application/x-executable', 'elf', { exts: ['elf', 'so', 'o', 'bin', 'out', 'axf', 'ko'] }],
  ['FE ED FA CE', 0, 'Mach-O executable (32-bit)', 'application/x-mach-binary', 'macho', { exts: ['dylib', 'o', 'bin', 'macho'] }],
  ['FE ED FA CF', 0, 'Mach-O executable (64-bit)', 'application/x-mach-binary', 'macho', { exts: ['dylib', 'o', 'bin', 'macho'] }],
  ['CE FA ED FE', 0, 'Mach-O executable (32-bit, LE)', 'application/x-mach-binary', 'macho', { exts: ['dylib', 'o', 'bin', 'macho'] }],
  ['CF FA ED FE', 0, 'Mach-O executable (64-bit, LE)', 'application/x-mach-binary', 'macho', { exts: ['dylib', 'o', 'bin', 'macho'] }],
  ['00 61 73 6D 01 00 00 00', 0, 'WebAssembly module', 'application/wasm', 'wasm'],
  ['64 65 78 0A', 0, 'Android Dalvik executable', 'application/vnd.android.dex', 'dex'],
  ['1B 4C 75 61', 0, 'Lua bytecode', 'application/x-lua-bytecode', 'luac', { exts: ['luac', 'lua'] }],
  ['4C 00 00 00 01 14 02 00', 0, 'Windows shortcut (.lnk)', 'application/x-ms-shortcut', 'lnk'],
  // Data and databases
  ['53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00', 0, 'SQLite database', 'application/vnd.sqlite3', 'sqlite', { exts: ['sqlite', 'sqlite3', 'db', 'db3', 's3db'] }],
  ['50 41 52 31', 0, 'Apache Parquet', 'application/vnd.apache.parquet', 'parquet'],
  ['89 48 44 46 0D 0A 1A 0A', 0, 'HDF5 data', 'application/x-hdf5', 'h5', { exts: ['h5', 'hdf5', 'hdf'] }],
  ['93 4E 55 4D 50 59', 0, 'NumPy array', 'application/x-npy', 'npy'],
  ['4F 62 6A 01', 0, 'Apache Avro', 'application/avro', 'avro'],
  ['62 70 6C 69 73 74 30 30', 0, 'Apple binary plist', 'application/x-plist', 'plist'],
  ['03 D9 A2 9A 67 FB 4B B5', 0, 'KeePass database', 'application/x-keepass2', 'kdbx'],
  ['D4 C3 B2 A1', 0, 'Packet capture (pcap)', 'application/vnd.tcpdump.pcap', 'pcap'],
  ['A1 B2 C3 D4', 0, 'Packet capture (pcap, BE)', 'application/vnd.tcpdump.pcap', 'pcap'],
  ['0A 0D 0D 0A', 0, 'Packet capture (pcapng)', 'application/x-pcapng', 'pcapng'],
  ['72 65 67 66', 0, 'Windows registry hive', 'application/x-ms-registry', 'dat', { exts: ['dat', 'hiv'] }],
  ['00 01 00 00 53 74 61 6E 64 61 72 64 20 4A 65 74 20 44 42', 0, 'Microsoft Access database', 'application/x-msaccess', 'mdb'],
  ['42 4C 45 4E 44 45 52', 0, 'Blender file', 'application/x-blender', 'blend'],
  ['67 6C 54 46', 0, 'glTF binary model', 'model/gltf-binary', 'glb'],
  ['64 38 3A 61 6E 6E 6F 75 6E 63 65', 0, 'BitTorrent file', 'application/x-bittorrent', 'torrent'],
  ['00 00 00 01 42 75 64 31', 0, 'macOS .DS_Store', 'application/octet-stream', 'ds_store', { exts: ['ds_store'] }],
  // Fonts
  ['00 01 00 00 00', 0, 'TrueType font', 'font/ttf', 'ttf', { exts: ['ttf'] }],
  ['4F 54 54 4F', 0, 'OpenType font', 'font/otf', 'otf'],
  ['74 74 63 66', 0, 'TrueType collection', 'font/collection', 'ttc'],
  ['77 4F 46 46', 0, 'WOFF font', 'font/woff', 'woff'],
  ['77 4F 46 32', 0, 'WOFF2 font', 'font/woff2', 'woff2'],
  // Text-like markers (binary-safe prefixes)
  ['EF BB BF', 0, 'Text (UTF-8 with BOM)', 'text/plain', 'txt', { text: true }],
  ['FF FE 00 00', 0, 'Text (UTF-32 LE)', 'text/plain', 'txt', { text: true }],
  ['FF FE', 0, 'Text (UTF-16 LE)', 'text/plain', 'txt', { text: true }],
  ['FE FF', 0, 'Text (UTF-16 BE)', 'text/plain', 'txt', { text: true }],
]
const parseHexPattern = (s) => s.split(' ').map((x) => (x === '??' ? -1 : parseInt(x, 16)))
const KINDS_FOR_MIME = [['image/', 'image'], ['video/', 'video'], ['audio/', 'audio'], ['font/', 'font']]
const sigKind = (mime, ext) => {
  const k = kindOfExt(ext)
  if (k !== 'other') return k
  return KINDS_FOR_MIME.find(([p]) => mime.startsWith(p))?.[1] || 'other'
}
export const SIGNATURES = SIG_ROWS.map(([pattern, off, label, mime, ext, o = {}]) => ({
  pattern: parseHexPattern(pattern), off, label, mime, ext, exts: o.exts || [ext], weak: !!o.weak, text: !!o.text, zip: !!o.zip, kind: sigKind(mime, ext),
})).sort((a, b) => b.pattern.length - a.pattern.length)

const matchSig = (bytes, s) => {
  if (bytes.length < s.off + s.pattern.length) return false
  for (let i = 0; i < s.pattern.length; i++) if (s.pattern[i] !== -1 && bytes[s.off + i] !== s.pattern[i]) return false
  return true
}
const ascii = (bytes, a, b) => String.fromCharCode(...bytes.subarray(a, Math.min(b, bytes.length)))
const result = (label, mime, ext, o = {}) => ({ label, mime, ext, exts: o.exts || [ext], kind: o.kind || sigKind(mime, ext), text: !!o.text, detail: o.detail || '', sure: o.sure !== false })

const ZIP_FAMILY = ['zip', 'jar', 'war', 'apk', 'ipa', 'epub', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'xlsm', 'docm', 'pptm', 'xlsb', 'vsdx', 'nupkg', 'xpi', 'whl', 'aar', 'kmz', '3mf', 'sketch', 'key', 'pages', 'numbers', 'xps', 'cbz', 'crx', 'maff', 'ear']
const CFB_NAMES = [['WordDocument', 'Microsoft Word document (.doc)', 'doc', 'application/msword'], ['Workbook', 'Microsoft Excel workbook (.xls)', 'xls', 'application/vnd.ms-excel'],
  ['PowerPoint Document', 'Microsoft PowerPoint (.ppt)', 'ppt', 'application/vnd.ms-powerpoint'], ['__properties_version1.0', 'Outlook message (.msg)', 'msg', 'application/vnd.ms-outlook']]

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
function utf16Has(bytes, str) {
  const pat = []
  for (const ch of str) pat.push(ch.charCodeAt(0), 0)
  outer: for (let i = 0; i + pat.length <= bytes.length; i++) {
    for (let j = 0; j < pat.length; j++) if (bytes[i + j] !== pat[j]) continue outer
    return true
  }
  return false
}

/** Heuristic: does this byte sample look like text? Returns {text, encoding, bom}. */
export function analyzeText(bytes) {
  const n = bytes.length
  if (!n) return { text: true, encoding: 'ASCII (empty)', bom: false }
  if (n >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return { text: true, encoding: 'UTF-8', bom: true }
  if (n >= 4 && bytes[0] === 0xFF && bytes[1] === 0xFE && bytes[2] === 0 && bytes[3] === 0) return { text: true, encoding: 'UTF-32 LE', bom: true }
  if (n >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return { text: true, encoding: 'UTF-16 LE', bom: true }
  if (n >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return { text: true, encoding: 'UTF-16 BE', bom: true }
  let nul = 0, ctrl = 0, high = 0
  const lim = Math.min(n, 8192)
  for (let i = 0; i < lim; i++) {
    const b = bytes[i]
    if (b === 0) nul++
    else if (b < 9 || (b > 13 && b < 32 && b !== 27)) ctrl++
    else if (b >= 0x80) high++
  }
  if (nul > 0) {
    // UTF-16 without BOM: NULs alternate with ASCII
    let even = 0, odd = 0
    for (let i = 0; i < lim; i++) if (bytes[i] === 0) { if (i % 2) odd++; else even++ }
    if (nul / lim > 0.25 && (even === 0 || odd === 0 || Math.max(even, odd) / Math.min(even, odd) > 8) && ctrl / lim < 0.05) {
      return { text: true, encoding: even > odd ? 'UTF-16 BE (no BOM)' : 'UTF-16 LE (no BOM)', bom: false }
    }
    return { text: false, encoding: '', bom: false }
  }
  if (ctrl / lim > 0.02) return { text: false, encoding: '', bom: false }
  if (!high) return { text: true, encoding: 'ASCII', bom: false }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, lim).slice(0, lim - (lim < n ? 3 : 0)))
    return { text: true, encoding: 'UTF-8', bom: false }
  } catch {
    return { text: true, encoding: 'Windows-1252 / Latin-1 (guess)', bom: false }
  }
}

function sniffText(head, name, an) {
  const e = extOf(name)
  const s = new TextDecoder('utf-8').decode(head.subarray(0, 1024)).replace(/^﻿/, '')
  const t = s.trimStart()
  const lower = t.slice(0, 200).toLowerCase()
  if (/^<\?xml/i.test(t) || t.startsWith('<')) {
    if (/<svg[\s>]/i.test(s)) return result('SVG image', 'image/svg+xml', 'svg', { text: true })
    if (/^<!doctype html|^<html/i.test(lower) || /<(head|body)[\s>]/i.test(lower)) return result('HTML document', 'text/html', 'html', { text: true, exts: ['html', 'htm', 'xhtml'] })
    if (/^<\?xml/i.test(t)) return result('XML document', 'application/xml', 'xml', { text: true, exts: ['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'kml', 'gpx', 'svg', 'csproj', 'config', 'resx', 'xaml', 'opml', 'wsdl', 'xhtml'] })
  }
  if (t.startsWith('-----BEGIN ')) {
    const m = t.match(/^-----BEGIN ([A-Z0-9 ]+)-----/)
    return result(`PEM / armored block (${(m?.[1] || 'unknown').toLowerCase()})`, 'application/x-pem-file', 'pem', { text: true, exts: ['pem', 'crt', 'cer', 'key', 'pub', 'asc', 'csr', 'gpg'] })
  }
  if (t.startsWith('#!')) return result('Script (shebang)', 'text/x-script', 'sh', { text: true, exts: ['sh', 'bash', 'zsh', 'py', 'rb', 'pl', 'js', 'mjs', 'php', 'lua', 'ps1', ''] })
  if (/^BEGIN:VCALENDAR/i.test(t)) return result('iCalendar', 'text/calendar', 'ics', { text: true, exts: ['ics', 'ical'] })
  if (/^BEGIN:VCARD/i.test(t)) return result('vCard contact', 'text/vcard', 'vcf', { text: true, exts: ['vcf', 'vcard'] })
  if (/^solid\s/.test(t) && e === 'stl') return result('STL model (ASCII)', 'model/stl', 'stl', { text: true })
  if (/^(\{|\[)/.test(t) && (e === 'json' || e === 'geojson' || e === 'map' || e === 'ipynb' || e === 'webmanifest' || e === 'har')) return result('JSON data', 'application/json', 'json', { text: true, exts: ['json', 'geojson', 'map', 'ipynb', 'webmanifest', 'har', 'jsonc', 'json5'] })
  return result(an.encoding.startsWith('UTF-16') || an.encoding.startsWith('UTF-32') ? 'Plain text (' + an.encoding + ')' : 'Plain text', 'text/plain', e && kindOfExt(e) !== 'other' ? e : 'txt', { text: true, sure: false, exts: [] })
}

const FTYP_BRANDS = {
  heic: ['HEIC image', 'image/heic', 'heic', ['heic', 'heif']], heix: ['HEIC image', 'image/heic', 'heic', ['heic', 'heif']], hevc: ['HEIC image sequence', 'image/heic-sequence', 'heic', ['heic', 'heif']],
  heim: ['HEIC image', 'image/heic', 'heic', ['heic', 'heif']], heis: ['HEIC image', 'image/heic', 'heic', ['heic', 'heif']], mif1: ['HEIF image', 'image/heif', 'heif', ['heif', 'heic', 'avif']], msf1: ['HEIF image sequence', 'image/heif-sequence', 'heif', ['heif', 'heic']],
  avif: ['AVIF image', 'image/avif', 'avif', ['avif']], avis: ['AVIF image sequence', 'image/avif-sequence', 'avif', ['avif']],
  'M4A ': ['M4A audio (AAC in MP4)', 'audio/mp4', 'm4a', ['m4a', 'mp4', 'm4b', 'aac']], 'M4B ': ['M4B audiobook', 'audio/mp4', 'm4b', ['m4b', 'm4a']], 'M4P ': ['M4P audio', 'audio/mp4', 'm4p', ['m4p']],
  'M4V ': ['M4V video', 'video/x-m4v', 'm4v', ['m4v', 'mp4']], 'qt  ': ['QuickTime movie', 'video/quicktime', 'mov', ['mov', 'qt']],
  '3gp4': ['3GP video', 'video/3gpp', '3gp', ['3gp']], '3gp5': ['3GP video', 'video/3gpp', '3gp', ['3gp']], '3gp6': ['3GP video', 'video/3gpp', '3gp', ['3gp']], '3g2a': ['3G2 video', 'video/3gpp2', '3g2', ['3g2']],
  'crx ': ['Canon CR3 raw photo', 'image/x-canon-cr3', 'cr3', ['cr3']], 'F4V ': ['Flash MP4 video', 'video/mp4', 'f4v', ['f4v']],
}

/** How many distinct signatures the detector checks (the table plus MP4/HEIC brands, RIFF, Ogg and Matroska variants). */
export const SIGNATURE_COUNT = SIGNATURES.length + Object.keys(FTYP_BRANDS).length + 10

/**
 * Detect a file type from its first bytes (plus a few container checks). head: first ~4 KB; extra: optional {tail, isoMark}.
 * Returns {label, mime, ext, exts, kind, text, detail, sure} or null when nothing matched.
 */
export function sniff(head, name = '', extra = {}) {
  const e = extOf(name)
  const b = head
  if (!b.length) return result('Empty file', 'application/x-empty', e || 'bin', { kind: 'other', exts: [], sure: false })

  // RIFF containers
  if (ascii(b, 0, 4) === 'RIFF' && b.length >= 12) {
    const t = ascii(b, 8, 12)
    if (t === 'WEBP') return result('WebP image', 'image/webp', 'webp')
    if (t === 'WAVE') return result('WAV audio', 'audio/wav', 'wav', { exts: ['wav', 'wave'] })
    if (t === 'AVI ') return result('AVI video', 'video/x-msvideo', 'avi')
    if (t === 'ACON') return result('Animated cursor', 'application/x-navi-animation', 'ani')
    return result(`RIFF container (${t.trim()})`, 'application/x-riff', 'riff', { kind: 'other' })
  }
  // ISO base media (MP4 family, HEIC, AVIF)
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12)
    const compat = ascii(b, 16, Math.min(b.length, 64))
    let m = FTYP_BRANDS[brand]
    if (brand === 'mif1' || brand === 'msf1') { if (compat.includes('avif')) m = FTYP_BRANDS.avif; else if (/hei[cxms]/.test(compat)) m = FTYP_BRANDS.heic }
    if (!m) m = [`MP4 video (${brand.trim()})`, 'video/mp4', 'mp4', ['mp4', 'm4v', 'mov', 'm4a', 'f4v', '3gp']]
    return result(m[0], m[1], m[2], { exts: m[3], detail: `brand ${brand.trim()}` })
  }
  // Matroska / WebM
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) {
    const s = ascii(b, 0, Math.min(b.length, 128))
    if (s.includes('webm')) return result('WebM video', 'video/webm', 'webm', { exts: ['webm', 'weba'] })
    return result('Matroska video', 'video/x-matroska', 'mkv', { exts: ['mkv', 'mka', 'mk3d'] })
  }
  // Ogg
  if (ascii(b, 0, 4) === 'OggS') {
    const s = ascii(b, 28, Math.min(b.length, 64))
    if (s.includes('OpusHead')) return result('Opus audio (Ogg)', 'audio/ogg', 'opus', { exts: ['opus', 'ogg', 'oga'] })
    if (s.includes('vorbis')) return result('Ogg Vorbis audio', 'audio/ogg', 'ogg', { exts: ['ogg', 'oga'] })
    if (s.includes('theora')) return result('Ogg Theora video', 'video/ogg', 'ogv', { exts: ['ogv', 'ogg'] })
    if (s.includes('FLAC')) return result('Ogg FLAC audio', 'audio/ogg', 'oga', { exts: ['oga', 'ogg', 'flac'] })
    return result('Ogg container', 'application/ogg', 'ogg', { exts: ['ogg', 'oga', 'ogv', 'opus', 'spx'] })
  }
  // Windows PE
  if (b[0] === 0x4D && b[1] === 0x5A) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    if (b.length >= 0x40) {
      const pe = dv.getUint32(0x3C, true)
      if (pe + 26 <= b.length && ascii(b, pe, pe + 4) === 'PE\0\0') {
        const machine = dv.getUint16(pe + 4, true)
        const chars = dv.getUint16(pe + 22, true)
        const arch = { 0x14c: 'x86', 0x8664: 'x64', 0xAA64: 'ARM64', 0x1c4: 'ARM' }[machine] || 'unknown CPU'
        const dll = !!(chars & 0x2000)
        return result(`Windows ${dll ? 'DLL' : 'executable'} (${arch})`, dll ? 'application/x-msdownload' : 'application/vnd.microsoft.portable-executable', dll ? 'dll' : 'exe', { exts: dll ? ['dll', 'ocx', 'cpl', 'sys', 'drv'] : ['exe', 'scr', 'sys', 'efi', 'com'], kind: 'exec' })
      }
    }
    return result('DOS / Windows executable', 'application/x-msdownload', 'exe', { exts: ['exe', 'dll', 'com', 'sys', 'scr'], kind: 'exec' })
  }
  // ELF details
  if (b[0] === 0x7F && ascii(b, 1, 4) === 'ELF' && b.length >= 20) {
    const le = b[5] === 1
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const type = dv.getUint16(16, le), mach = dv.getUint16(18, le)
    const t = { 1: 'relocatable object', 2: 'executable', 3: 'shared object / PIE', 4: 'core dump' }[type] || 'binary'
    const m = { 3: 'x86', 0x3E: 'x86-64', 0x28: 'ARM', 0xB7: 'AArch64', 0xF3: 'RISC-V', 8: 'MIPS' }[mach] || 'unknown CPU'
    return result(`ELF ${b[4] === 2 ? '64' : '32'}-bit ${t} (${m})`, 'application/x-executable', 'elf', { exts: ['elf', 'so', 'o', 'bin', 'out', 'axf', 'ko', ''], kind: 'exec' })
  }
  // Java class vs Mach-O universal (both 0xCAFEBABE)
  if (b[0] === 0xCA && b[1] === 0xFE && b[2] === 0xBA && b[3] === 0xBE && b.length >= 8) {
    const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, false)
    return n >= 44 ? result('Java class file', 'application/java-vm', 'class', { kind: 'exec' }) : result('Mach-O universal binary', 'application/x-mach-binary', 'macho', { exts: ['dylib', 'o', 'bin', 'macho'], kind: 'exec' })
  }
  // MPEG transport stream
  if (b.length >= 565 && b[0] === 0x47 && b[188] === 0x47 && b[376] === 0x47 && b[564] === 0x47) return result('MPEG transport stream', 'video/mp2t', 'ts', { exts: ['ts', 'mts', 'm2ts', 'tsv'] })

  for (const s of SIGNATURES) {
    if (!matchSig(b, s)) continue
    if (s.weak && !s.exts.includes(e)) continue
    if (s.zip) return { ...result(s.label, s.mime, s.ext, { exts: ZIP_FAMILY, kind: 'archive' }), zip: true }
    if (s.text) { const an = analyzeText(b); if (an.text) { const r = sniffText(b, name, an); r.detail = an.encoding; return r } continue }
    if (s.mime === 'application/x-cfb') {
      const scan = extra.tail ? concatBytes(b, extra.tail) : b
      for (const [n, label, ex, mime] of CFB_NAMES) if (utf16Has(scan, n)) return result(label, mime, ex, { exts: [ex, 'dot', 'xlt', 'pps'] })
    }
    return result(s.label, s.mime, s.ext, { exts: s.exts, kind: s.kind })
  }
  // ISO 9660 and TAR can sit deeper than the first bytes
  if (extra.isoMark === 'CD001') return result('ISO 9660 disc image', 'application/x-iso9660-image', 'iso')
  // MP3 / AAC frame sync
  if (b.length >= 4 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0) {
    const layer = (b[1] >> 1) & 3
    if (layer === 0 && (b[1] & 0xF6) === 0xF0) return result('AAC audio (ADTS)', 'audio/aac', 'aac', { exts: ['aac', 'adts'] })
    if (layer !== 0 && ((b[1] >> 3) & 3) !== 1) return result('MP3 audio', 'audio/mpeg', 'mp3', { exts: ['mp3', 'mp2', 'mpga'] })
  }
  const an = analyzeText(b)
  if (an.text) return sniffText(b, name, an)
  return null
}

/** Read the bytes a detector needs from a File and run sniff(); refines ZIP-based formats by their entry names. */
export async function detectFile(file) {
  const head = await readRange(file, 0, 4096)
  const extra = {}
  if (file.size > 32774) extra.isoMark = ascii(await readRange(file, 32769, 32774), 0, 5)
  if (head[0] === 0xD0 && head[1] === 0xCF && file.size > 4096) {
    const n = file.size
    extra.tail = n <= 8 << 20 ? await readRange(file, 4096, n) : concatBytes(await readRange(file, 4096, 524288), await readRange(file, n - 524288, n))
  }
  let r = sniff(head, file.name, extra)
  if (r?.zip) r = await refineZip(file, r).catch(() => r)
  if (r?.text && r.label === 'Plain text' && file.size <= 2_000_000 && /^\s*[\[{]/.test(new TextDecoder().decode(head.subarray(0, 64)))) {
    try { JSON.parse(await file.text()); r = result('JSON data', 'application/json', 'json', { text: true, exts: ['json', 'geojson', 'map', 'ipynb', 'webmanifest', 'har', 'jsonc'], detail: r.detail }) } catch { /* not JSON */ }
  }
  return r
}

async function refineZip(file, base) {
  const entries = await readZipEntries(file)
  const names = entries.map((x) => x.name)
  const has = (p) => names.some((n) => n === p || n.startsWith(p))
  const z = (label, mime, ext, exts = [ext, 'zip']) => ({ ...result(label, mime, ext, { exts: [...exts, 'zip'], kind: kindOfExt(ext) === 'other' ? 'archive' : kindOfExt(ext) }), zip: true, entries })
  if (has('[Content_Types].xml')) {
    if (has('word/')) return z('Word document (.docx)', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', ['docx', 'docm', 'dotx'])
    if (has('xl/')) return z(has('xl/workbook.bin') ? 'Excel binary workbook (.xlsb)' : 'Excel workbook (.xlsx)', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', has('xl/workbook.bin') ? 'xlsb' : 'xlsx', ['xlsx', 'xlsm', 'xlsb', 'xltx'])
    if (has('ppt/')) return z('PowerPoint presentation (.pptx)', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', ['pptx', 'pptm', 'ppsx', 'potx'])
    if (has('visio/')) return z('Visio drawing (.vsdx)', 'application/vnd.ms-visio.drawing', 'vsdx')
    if (has('3D/')) return z('3MF 3D model', 'model/3mf', '3mf')
    return z('Office Open XML package', 'application/vnd.openxmlformats-officedocument', 'docx', ['docx', 'xlsx', 'pptx', 'xps', 'oxps'])
  }
  const mt = entries.find((x) => x.name === 'mimetype' && x.size < 200)
  if (mt) {
    const m = (await extractEntry(file, mt).then((b) => b.text()).catch(() => '')).trim()
    const map = { 'application/epub+zip': ['EPUB e-book', 'epub'], 'application/vnd.oasis.opendocument.text': ['OpenDocument text (.odt)', 'odt'], 'application/vnd.oasis.opendocument.spreadsheet': ['OpenDocument spreadsheet (.ods)', 'ods'],
      'application/vnd.oasis.opendocument.presentation': ['OpenDocument presentation (.odp)', 'odp'], 'application/vnd.oasis.opendocument.graphics': ['OpenDocument drawing (.odg)', 'odg'] }
    if (map[m]) return z(map[m][0], m, map[m][1])
  }
  if (has('AndroidManifest.xml')) return z('Android package (APK)', 'application/vnd.android.package-archive', 'apk', ['apk', 'aab', 'xapk'])
  if (has('META-INF/MANIFEST.MF')) return z('Java archive (JAR)', 'application/java-archive', 'jar', ['jar', 'war', 'ear', 'aar'])
  if (has('Payload/') && names.some((n) => n.endsWith('.app/Info.plist'))) return z('iOS app (IPA)', 'application/octet-stream', 'ipa')
  if (names.some((n) => n.endsWith('.dist-info/METADATA'))) return z('Python wheel', 'application/zip', 'whl')
  if (has('doc.kml') || names.some((n) => n.endsWith('.kml'))) return z('Google Earth KMZ', 'application/vnd.google-earth.kmz', 'kmz')
  if (names.some((n) => n.endsWith('.nuspec'))) return z('NuGet package', 'application/octet-stream', 'nupkg')
  return { ...base, entries, kind: 'archive' }
}

const BINARY_KINDS = new Set(['image', 'video', 'audio', 'archive', 'exec', 'font', 'sheet', 'slides'])
const BINARY_DOC_EXTS = new Set(['pdf', 'doc', 'docx', 'odt', 'epub', 'rtf', 'pages'])
/** Is the declared extension consistent with what the bytes say? {ok:false} only when we are fairly sure it is not. */
export function extensionVerdict(det, name) {
  const e = extOf(name)
  if (!det || !e || det.exts.includes(e)) return { ok: true }
  const k = kindOfExt(e)
  if (k === 'other') return { ok: true }
  if (det.zip && ZIP_FAMILY.includes(e)) return { ok: true }
  if (det.text) {
    const binaryExt = (BINARY_KINDS.has(k) && e !== 'svg') || BINARY_DOC_EXTS.has(e)
    return { ok: !binaryExt }
  }
  return { ok: false }
}

// ---------- Text analysis ----------
const CP1252_HINT = /[\x80-\x9f]/
/** Shannon entropy of a byte sample in bits per byte (0 to 8). */
export function entropy(bytes) {
  if (!bytes.length) return 0
  const freq = new Uint32Array(256)
  for (let i = 0; i < bytes.length; i++) freq[bytes[i]]++
  let e = 0
  for (const f of freq) if (f) { const p = f / bytes.length; e -= p * Math.log2(p) }
  return e
}
export const looksBinary = (bytes) => !analyzeText(bytes).text
/** Decode text for display/search honoring BOMs; falls back to Latin-1 for invalid UTF-8. */
export function decodeText(bytes) {
  const an = analyzeText(bytes)
  const enc = an.encoding.startsWith('UTF-16 BE') ? 'utf-16be' : an.encoding.startsWith('UTF-16') ? 'utf-16le' : an.encoding.startsWith('Windows') ? 'windows-1252' : 'utf-8'
  try { return new TextDecoder(enc, { fatal: enc === 'utf-8' }).decode(bytes) } catch { return new TextDecoder('windows-1252').decode(bytes) }
}

/** Count lines and line-ending styles over a whole file (streaming, UTF-8 / single-byte encodings). */
export async function countLines(file, { signal } = {}) {
  let lf = 0, crlf = 0, cr = 0, prevCR = false, lastByte = -1, total = 0, since = 0
  const reader = file.stream().getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    throwIfAborted(signal)
    for (let i = 0; i < value.length; i++) {
      const c = value[i]
      if (c === 10) { if (prevCR) { crlf++; cr-- } else lf++ ; prevCR = false } else if (c === 13) { cr++; prevCR = true } else prevCR = false
    }
    lastByte = value[value.length - 1]
    total += value.length
    since += value.length
    if (since > 16 << 20) { since = 0; await yieldToMain() }
  }
  const breaks = lf + crlf + cr
  const lines = total === 0 ? 0 : breaks + (lastByte === 10 || lastByte === 13 ? 0 : 1)
  const styles = [lf && 'LF', crlf && 'CRLF', cr && 'CR'].filter(Boolean)
  return { lines, lf, crlf, cr, style: styles.length > 1 ? `Mixed (${styles.join(', ')})` : styles[0] || 'None' }
}

// ---------- Image header parsing (dimensions without decoding) ----------
export function imageDimensions(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20), note: 'PNG' }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true), note: 'GIF' }
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4D) return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)), note: 'BMP' }
  if (b.length > 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    const t = ascii(b, 12, 16)
    if (t === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), note: 'WebP' }
    if (t === 'VP8L') { const v = dv.getUint32(21, true); return { w: 1 + (v & 0x3FFF), h: 1 + ((v >> 14) & 0x3FFF), note: 'WebP' } }
    if (t === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3FFF, h: dv.getUint16(28, true) & 0x3FFF, note: 'WebP' }
  }
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue }
      const m = b[i + 1]
      if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i += m === 0xFF ? 1 : 2; continue }
      const len = dv.getUint16(i + 2)
      if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { h: dv.getUint16(i + 5), w: dv.getUint16(i + 7), note: m === 0xC2 || m === 0xC6 ? 'JPEG (progressive)' : 'JPEG' }
      i += 2 + len
    }
  }
  return null
}

// ---------- Hashing (streaming, hash-wasm) ----------
export const HASH_ALGOS = { md5: 'createMD5', sha1: 'createSHA1', sha256: 'createSHA256', sha512: 'createSHA512', crc32: 'createCRC32' }
export const HASH_LABEL = { md5: 'MD5', sha1: 'SHA-1', sha256: 'SHA-256', sha512: 'SHA-512', crc32: 'CRC32' }

/** Make an incremental hasher: {update(bytes), digest()}. */
export async function makeHasher(algo) {
  const lib = await hashwasm()
  const h = await lib[HASH_ALGOS[algo]]()
  h.init()
  return { update: (b) => h.update(b), digest: () => h.digest('hex') }
}

/**
 * Hash a Blob with several algorithms in one streaming pass. Resolves {md5, sha1, sha256, ...} as lowercase hex.
 * onProgress(fraction) is called about every few MB; the loop yields to the UI so big files do not freeze the tab.
 */
export async function hashBlob(blob, algos = ['sha256'], { onProgress, signal } = {}) {
  const hashers = await Promise.all(algos.map(makeHasher))
  let done = 0, lastYield = 0
  const reader = blob.stream().getReader()
  try {
    while (true) {
      const { done: end, value } = await reader.read()
      if (end) break
      throwIfAborted(signal)
      for (const h of hashers) h.update(value)
      done += value.length
      if (done - lastYield >= 8 << 20) { lastYield = done; onProgress?.(done / (blob.size || 1)); await yieldToMain() }
    }
  } finally { reader.releaseLock?.() }
  onProgress?.(1)
  return Object.fromEntries(algos.map((a, i) => [a, hashers[i].digest()]))
}

// ---------- ZIP reading (central directory; no whole-file load) ----------
const U32 = (dv, o) => dv.getUint32(o, true)
const U16 = (dv, o) => dv.getUint16(o, true)
const U64 = (dv, o) => Number(dv.getBigUint64(o, true))
export const zipError = (message, code) => Object.assign(new Error(message), { code })

function dosDate(date, time) {
  if (!date) return null
  return new Date(((date >> 9) & 127) + 1980, ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2)
}
function decodeZipName(raw, utf8) {
  if (utf8) return new TextDecoder().decode(raw)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(raw) } catch { return new TextDecoder('windows-1252').decode(raw) }
}

/** Read the entry list of a ZIP (also ZIP64). Resolves [{name, dir, size, csize, method, crc, date, encrypted, offset, comment}]. */
export async function readZipEntries(file) {
  const size = file.size
  if (size < 22) throw zipError('This does not look like a ZIP file (too small).', 'NOT_ZIP')
  const tailLen = Math.min(size, 65535 + 22 + 20)
  const tailStart = size - tailLen
  const tail = await readRange(file, tailStart, size)
  const tdv = new DataView(tail.buffer)
  let p = tail.length - 22
  while (p >= 0 && U32(tdv, p) !== 0x06054b50) p--
  if (p < 0) throw zipError('Could not find the ZIP directory. The file may be damaged, truncated, or not a ZIP.', 'NOT_ZIP')
  let total = U16(tdv, p + 10), cdSize = U32(tdv, p + 12), cdOff = U32(tdv, p + 16)
  const eocdPos = tailStart + p
  let zip64 = false
  if (total === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) {
    if (p >= 20 && U32(tdv, p - 20) === 0x07064b50) {
      const off = U64(tdv, p - 20 + 8)
      const rec = new DataView((await readRange(file, off, off + 56)).buffer)
      if (U32(rec, 0) === 0x06064b50) { total = U64(rec, 32); cdSize = U64(rec, 40); cdOff = U64(rec, 48); zip64 = true }
    }
  }
  // Archives with data in front (self-extractors): shift offsets so they point at the real positions
  let shift = 0
  if (!zip64 && cdOff + cdSize <= size && U32(new DataView((await readRange(file, cdOff, cdOff + 4)).buffer), 0) !== 0x02014b50) shift = Math.max(0, eocdPos - (cdOff + cdSize))
  cdOff += shift
  if (cdOff + cdSize > size) throw zipError('The ZIP directory points outside the file. The file may be truncated.', 'NOT_ZIP')
  const cd = await readRange(file, cdOff, cdOff + cdSize)
  const dv = new DataView(cd.buffer)
  const out = []
  let o = 0
  while (o + 46 <= cd.length && U32(dv, o) === 0x02014b50) {
    const made = U16(dv, o + 4), flags = U16(dv, o + 8), method = U16(dv, o + 10)
    let csize = U32(dv, o + 20), usize = U32(dv, o + 24), offset = U32(dv, o + 42)
    const nameLen = U16(dv, o + 28), extraLen = U16(dv, o + 30), commentLen = U16(dv, o + 32)
    const extAttr = U32(dv, o + 38)
    const name = decodeZipName(cd.subarray(o + 46, o + 46 + nameLen), !!(flags & 0x800))
    // ZIP64 extra field
    let x = o + 46 + nameLen
    const xEnd = x + extraLen
    while (x + 4 <= xEnd) {
      const id = U16(dv, x), len = U16(dv, x + 2)
      if (id === 0x0001) {
        let q = x + 4
        if (usize === 0xFFFFFFFF && q + 8 <= xEnd) { usize = U64(dv, q); q += 8 }
        if (csize === 0xFFFFFFFF && q + 8 <= xEnd) { csize = U64(dv, q); q += 8 }
        if (offset === 0xFFFFFFFF && q + 8 <= xEnd) { offset = U64(dv, q); q += 8 }
      }
      x += 4 + len
    }
    const unixMode = (made >> 8) === 3 ? extAttr >>> 16 : 0
    out.push({
      name, dir: name.endsWith('/'), size: usize, csize, method, flags, crc: U32(dv, o + 16), date: dosDate(U16(dv, o + 14), U16(dv, o + 12)),
      encrypted: !!(flags & 1), strongCrypto: !!(flags & 0x40), offset: offset + shift, symlink: (unixMode & 0xF000) === 0xA000,
      comment: commentLen ? decodeZipName(cd.subarray(x, x + commentLen), !!(flags & 0x800)) : '',
    })
    o += 46 + nameLen + extraLen + commentLen
  }
  if (!out.length && total) throw zipError('The ZIP directory could not be read. The file may be damaged.', 'NOT_ZIP')
  return out
}

export const METHOD_NAMES = { 0: 'Stored', 8: 'Deflate', 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 98: 'PPMd', 99: 'AES encrypted' }

/** Strip leading slashes, drive letters and ".." so an entry can be written safely (zip-slip protection). */
export function safeEntryPath(name) {
  const parts = name.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..')
  if (parts.length && /^[A-Za-z]:$/.test(parts[0])) parts.shift()
  return parts.map((s) => s.replace(/[\u0000-\u001f<>:"|?*]/g, '_')).join('/')
}

/** Decompress one entry to a Blob. Verifies the CRC. Throws coded errors: ENCRYPTED, METHOD, CRC. */
export async function extractEntry(file, entry, { onProgress, signal } = {}) {
  if (entry.dir) return new Blob([])
  if (entry.encrypted) throw zipError(`"${entry.name}" is password-protected. Encrypted ZIPs are not supported here; use a desktop tool such as 7-Zip.`, 'ENCRYPTED')
  if (entry.method !== 0 && entry.method !== 8) throw zipError(`"${entry.name}" uses compression method ${entry.method} (${METHOD_NAMES[entry.method] || 'unknown'}), which a browser cannot unpack. Use a desktop tool such as 7-Zip.`, 'METHOD')
  const lh = new DataView((await readRange(file, entry.offset, entry.offset + 30)).buffer)
  if (U32(lh, 0) !== 0x04034b50) throw zipError(`"${entry.name}": the local file header is damaged.`, 'DAMAGED')
  const start = entry.offset + 30 + U16(lh, 26) + U16(lh, 28)
  const comp = file.slice(start, start + entry.csize)
  let blob
  if (entry.method === 0) {
    blob = comp
  } else if (typeof DecompressionStream === 'function') {
    const stream = comp.stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const chunks = []
    let got = 0
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      throwIfAborted(signal)
      chunks.push(value)
      got += value.length
      onProgress?.(Math.min(1, got / (entry.size || got || 1)))
    }
    blob = new Blob(chunks)
  } else {
    const JSZip = await jszip()
    const z = await JSZip.loadAsync(file)
    blob = await z.file(entry.name).async('blob')
  }
  if (entry.size && blob.size !== entry.size) throw zipError(`"${entry.name}" came out ${blob.size} bytes but should be ${entry.size}. The archive may be damaged.`, 'CRC')
  if (blob.size <= 512 << 20) {
    const crc = (await hashBlob(blob, ['crc32'], { signal })).crc32
    if (parseInt(crc, 16) !== entry.crc) throw zipError(`"${entry.name}" failed its checksum. The archive may be damaged.`, 'CRC')
  }
  return blob
}

// ---------- Folder scanning ----------
export const canPickDirectory = () => typeof window.showDirectoryPicker === 'function'

/** Ask for read/write permission on a handle (needed before renaming or writing). */
export async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return true
  if ((await handle.queryPermission({ mode })) === 'granted') return true
  return (await handle.requestPermission({ mode })) === 'granted'
}

/**
 * Walk a directory handle. Each entry: {path, name, dir, size, mtime, file, handle, parent}. Folders are listed too in `folders`.
 * Skips nothing by default; pass skip(name, isDir, path) to ignore things like node_modules.
 */
export async function scanHandle(root, { recursive = true, onProgress, signal, skip, limit = 2_000_000 } = {}) {
  const entries = [], folders = []
  let truncated = false
  async function walk(dir, prefix) {
    const kids = []
    for await (const [name, h] of dir.entries()) kids.push([name, h])
    kids.sort((a, b) => naturalCompare(a[0], b[0]))
    let i = 0
    for (const [name, h] of kids) {
      throwIfAborted(signal)
      const path = prefix ? `${prefix}/${name}` : name
      if (h.kind === 'directory') {
        if (skip?.(name, true, path)) continue
        folders.push({ path, name, dir: prefix, handle: h, parent: dir })
        if (recursive) await walk(h, path)
      } else {
        if (skip?.(name, false, path)) continue
        if (entries.length >= limit) { truncated = true; return }
        try {
          const file = await h.getFile()
          entries.push({ path, name, dir: prefix, size: file.size, mtime: file.lastModified, file, handle: h, parent: dir })
        } catch { /* unreadable (locked or removed): skip */ }
        if (++i % 40 === 0) { onProgress?.(entries.length); await yieldToMain() }
      }
    }
  }
  await walk(root, '')
  onProgress?.(entries.length)
  return { name: root.name, entries, folders, handle: root, truncated }
}

/** Build a scan result from a flat File[] (webkitdirectory input). Paths drop the top-level folder name. */
export function scanFileList(files, { skip, recursive = true } = {}) {
  const entries = [], folderSet = new Set()
  let rootName = ''
  for (const file of files) {
    const rel = file.webkitRelativePath || file.name
    const parts = rel.split('/')
    if (parts.length > 1 && !rootName) rootName = parts[0]
    const inner = parts.length > 1 ? parts.slice(1) : parts
    if (!recursive && inner.length > 1) continue
    if (skip && inner.some((s, i) => skip(s, i < inner.length - 1, inner.slice(0, i + 1).join('/')))) continue
    const path = inner.join('/')
    const dir = inner.slice(0, -1).join('/')
    for (let i = 1; i <= inner.length - 1; i++) folderSet.add(inner.slice(0, i).join('/'))
    entries.push({ path, name: file.name, dir, size: file.size, mtime: file.lastModified, file, handle: null, parent: null })
  }
  entries.sort((a, b) => naturalCompare(a.path, b.path))
  const folders = [...folderSet].sort(naturalCompare).map((p) => ({ path: p, name: p.split('/').pop(), dir: p.split('/').slice(0, -1).join('/'), handle: null, parent: null }))
  return { name: rootName || 'Selected files', entries, folders, handle: null, truncated: false }
}

/** Walk a legacy FileSystemEntry (drag and drop in browsers without handles). */
async function walkLegacyEntry(entry, prefix, out, signal, onProgress) {
  throwIfAborted(signal)
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej))
    out.push({ file, rel: prefix ? `${prefix}/${entry.name}` : entry.name })
    if (out.length % 50 === 0) { onProgress?.(out.length); await yieldToMain() }
  } else if (entry.isDirectory) {
    const reader = entry.createReader()
    const here = prefix ? `${prefix}/${entry.name}` : entry.name
    while (true) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej))
      if (!batch.length) break
      for (const k of batch) await walkLegacyEntry(k, here, out, signal, onProgress)
    }
  }
}

/**
 * Turn a drop event's DataTransfer into a scan result (folders and files). Prefers real handles so in-place tools work.
 * Call it synchronously from the drop handler: the browser invalidates the items once the handler returns.
 */
export async function scanDrop(dt, opts = {}) {
  const items = [...(dt.items || [])].filter((i) => i.kind === 'file')
  const handleP = items.map((it) => (typeof it.getAsFileSystemHandle === 'function' ? it.getAsFileSystemHandle().catch(() => null) : null))
  const legacy = items.map((it) => it.webkitGetAsEntry?.() || null)
  const plain = items.map((it) => it.getAsFile())
  const handles = (await Promise.all(handleP)).filter(Boolean)
  if (handles.length === 1 && handles[0].kind === 'directory') return scanHandle(handles[0], opts)
  if (handles.length) {
    // Several things dropped (or loose files): treat them as one virtual root
    const entries = [], folders = []
    for (const h of handles) {
      if (h.kind === 'file') { const file = await h.getFile(); entries.push({ path: h.name, name: h.name, dir: '', size: file.size, mtime: file.lastModified, file, handle: h, parent: null }) }
      else {
        const r = await scanHandle(h, opts)
        folders.push({ path: h.name, name: h.name, dir: '', handle: h, parent: null })
        for (const e of r.entries) entries.push({ ...e, path: `${h.name}/${e.path}`, dir: e.dir ? `${h.name}/${e.dir}` : h.name })
        for (const f of r.folders) folders.push({ ...f, path: `${h.name}/${f.path}`, dir: f.dir ? `${h.name}/${f.dir}` : h.name })
      }
    }
    return { name: 'Dropped items', entries, folders, handle: null, truncated: false }
  }
  // Legacy API (Firefox, Safari): entries give files with relative paths
  const raw = []
  const single = items.length === 1 && legacy[0]?.isDirectory ? legacy[0].name : null
  for (let i = 0; i < items.length; i++) {
    if (legacy[i]) await walkLegacyEntry(legacy[i], '', raw, opts.signal, opts.onProgress)
    else if (plain[i]) raw.push({ file: plain[i], rel: plain[i].name })
  }
  for (const r of raw) Object.defineProperty(r.file, 'webkitRelativePath', { value: single ? r.rel : `Dropped items/${r.rel}`, configurable: true })
  return scanFileList(raw.map((r) => r.file), opts)
}

export const DEFAULT_SKIP = (name, isDir) => isDir && (name === 'node_modules' || name === '.git')

// ---------- Misc ----------
/** Group entries into a nested tree: {name, path, size, count, files, children: Map}. */
export function buildTree(rootName, entries, folders = []) {
  const root = { name: rootName, path: '', size: 0, count: 0, files: [], children: new Map(), isDir: true }
  const dirOf = (path) => {
    let node = root
    if (!path) return node
    let acc = ''
    for (const part of path.split('/')) {
      acc = acc ? `${acc}/${part}` : part
      let c = node.children.get(part)
      if (!c) { c = { name: part, path: acc, size: 0, count: 0, files: [], children: new Map(), isDir: true }; node.children.set(part, c) }
      node = c
    }
    return node
  }
  for (const f of folders) dirOf(f.path)
  for (const e of entries) {
    const d = dirOf(e.dir)
    d.files.push(e)
    for (const n of pathChain(root, e.dir)) { n.size += e.size; n.count++ }
  }
  return root
}
function pathChain(root, dirPath) {
  const chain = [root]
  let node = root
  if (dirPath) for (const part of dirPath.split('/')) { node = node.children.get(part); chain.push(node) }
  return chain
}

/** Pass a file to another tool in this tab (e.g. Inspector -> Hex viewer). Held in memory only. */
let handoffFile = null
export const setHandoff = (file) => { handoffFile = file }
export const takeHandoff = () => { const f = handoffFile; handoffFile = null; return f }

// ---------- Photo metadata (exifr, pinned) ----------
const EXIFR_URL = 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs'
let exifrPromise = null
/** exifr 7.1.3 (MIT): reads EXIF, GPS, XMP, IPTC from JPEG, HEIC, TIFF, PNG, AVIF. Loaded on demand. */
export const exifr = () => (exifrPromise ||= import(EXIFR_URL).catch((e) => {
  exifrPromise = null
  throw Object.assign(new Error('Could not load the photo metadata reader. Check your connection and try again.'), { cause: e })
}))
const EXIF_OPTS = { tiff: true, xmp: true, icc: false, iptc: true, jfif: true, ihdr: true, gps: true, exif: true, interop: false, ifd1: false, makerNote: false, userComment: true, mergeOutput: true, translateKeys: true, translateValues: true, reviveValues: true }
/** All readable photo metadata of an image as one flat object, or null when there is none. */
export async function readExif(file) {
  const lib = await exifr()
  try {
    const data = await lib.parse(file, EXIF_OPTS)
    return data && Object.keys(data).length ? data : null
  } catch { return null }
}
