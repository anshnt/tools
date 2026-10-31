// Routes for the File Converter hub: every readable archive can be repacked as ZIP, TAR, TAR.GZ, TAR.XZ, TAR.BZ2 or 7Z, or unpacked
// into its files ("extract"). Libraries are loaded inside run(), so importing this module is cheap.

const LEVELS = [['1', 'Fast'], ['6', 'Normal'], ['9', 'Maximum']]
const OPTIONS = [
  { key: 'password', label: 'Password of the archive (if it has one)', type: 'text' },
  { key: 'level', label: 'Compression', type: 'select', choices: LEVELS, default: '6' },
]
const TARGETS = ['zip', 'tar', 'tar.gz', 'tar.xz', 'tar.bz2', '7z', 'extract']
const NAMES = { zip: 'zip', tar: 'tar', 'tar.gz': 'tar.gz', 'tar.xz': 'tar.xz', 'tar.bz2': 'tar.bz2', '7z': '7z' }

/** Flatten a path into one file name so the hub can list extracted files in a single level. */
const flat = (path) => path.replace(/\//g, ' - ')

async function run(file, to, opts = {}, { signal, onProgress } = {}) {
  const ops = await import('./_ops.js')
  const password = (opts.password || '').trim()
  if (to === 'extract') {
    const items = await ops.extractFiles(file, { password, signal, onProgress })
    if (!items.length) throw new Error('There are no files inside this archive.')
    const seen = new Set()
    return items.map((it) => {
      let name = flat(it.path)
      for (let i = 2; seen.has(name); i++) name = name.replace(/(\.[^.]*)?$/, ` (${i})$1`)
      seen.add(name)
      return new File([it.file], name, { lastModified: it.date || Date.now() })
    })
  }
  const blob = await ops.repack(file, to, { password, level: Number(opts.level ?? 6), signal, onProgress })
  const base = file.name.replace(/\.(tar\.(gz|bz2|xz|zst|z)|tgz|tbz2?|txz|tzst|[^./\\]+)$/i, '') || 'archive'
  return new File([blob], `${base}.${NAMES[to]}`, { type: blob.type })
}

const ARCHIVES = ['zip', '7z', 'rar', 'tar', 'tar.gz', 'tgz', 'tar.bz2', 'tbz2', 'tar.xz', 'txz', 'tar.zst', 'tzst', 'iso', 'cab', 'lzh', 'lha', 'cpio', 'ar', 'deb', 'rpm', 'xar', 'pkg', 'wim', 'arj']
// ZIP-based formats are already ZIP files: the useful route is to open them up
const ZIP_BASED = ['jar', 'war', 'apk', 'aab', 'xpi', 'wbpz', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp']
const SINGLE = ['gz', 'bz2', 'xz', 'z', 'zst']
const without = (self) => TARGETS.filter((t) => t !== self && !(self === 'tgz' && t === 'tar.gz') && !(self === 'tbz2' && t === 'tar.bz2') && !(self === 'txz' && t === 'tar.xz'))

export const CONVERTERS = [
  ...ARCHIVES.map((from) => ({ from: [from], to: without(from), group: 'Archives', options: OPTIONS, run })),
  { from: ZIP_BASED, to: ['extract'], group: 'Archives', options: [OPTIONS[0]], run },
  { from: SINGLE, to: ['extract'], group: 'Archives', options: [OPTIONS[0]], run },
]

export const SNIFF = [
  { ext: '7z', test: (b) => b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf },
  { ext: 'rar', test: (b) => b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 },
  { ext: 'cab', test: (b) => b[0] === 0x4d && b[1] === 0x53 && b[2] === 0x43 && b[3] === 0x46 },
  { ext: 'wim', test: (b) => b[0] === 0x4d && b[1] === 0x53 && b[2] === 0x57 && b[3] === 0x49 && b[4] === 0x4d },
  { ext: 'xz', test: (b) => b[0] === 0xfd && b[1] === 0x37 && b[2] === 0x7a && b[3] === 0x58 && b[4] === 0x5a },
  { ext: 'bz2', test: (b) => b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68 },
  { ext: 'gz', test: (b) => b[0] === 0x1f && b[1] === 0x8b },
  { ext: 'zst', test: (b) => b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd },
]
