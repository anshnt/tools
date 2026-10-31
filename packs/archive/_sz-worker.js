// Module worker around 7-Zip compiled to WebAssembly (7z-wasm, LGPL with the unRAR restriction, loaded from the CDN as a separate program).
// Used where the MIT engine cannot go: password-protected 7z, RAR and ZIP, WIM, ARJ and friends, huge archives (the archive is mounted
// from disk, not copied into memory), and writing 7z, XZ and BZIP2. A fresh 7-Zip instance runs for every operation.
// Messages: {id, op, ...} in, {id, ok, result | error} or {id, entry} out.
import SevenZip from 'https://cdn.jsdelivr.net/npm/7z-wasm@1.2.0/7zz.es6.js'

const post = (msg, transfer) => self.postMessage(msg, transfer || [])
let src = null // {file, password}
const BATCH = 256 * 1024 * 1024

async function run(args, { mount, setup } = {}) {
  const out = []
  const err = []
  let sz
  try { sz = await SevenZip({ print: (s) => out.push(s), printErr: (s) => err.push(s), stdin: () => null }) } catch (e) { throw new Error(`7-Zip init failed: ${e?.message ?? JSON.stringify(e)}`) }
  let step = 'mkdir'
  try {
    sz.FS.mkdirTree('/in')
    sz.FS.mkdirTree('/out')
    step = 'mount'
    if (mount) mount(sz)
    step = 'setup'
    if (setup) setup(sz)
  } catch (e) { throw new Error(`7-Zip setup failed at ${step}: ${e?.errno ?? ''} ${e?.message ?? ''} ${JSON.stringify(e)}`) }
  let code = 0
  try { step = 'main'; sz.callMain(args); code = 0 } catch (e) { code = typeof e?.status === 'number' ? e.status : (e instanceof WebAssembly.RuntimeError ? -1 : 0); if (code === -1) throw e }
  return { sz, out, err, code, step }
}

function failure(r, hasPass) {
  const text = [...r.err, ...r.out].join('\n')
  if (/wrong password|enter password|cannot open encrypted|headers error|can not open encrypted/i.test(text)) {
    return Object.assign(new Error(hasPass ? 'That password did not work.' : 'This archive is password protected.'), { code: hasPass ? 'BADPW' : 'NEEDPW' })
  }
  const line = text.split('\n').find((l) => /^ERROR:|Can not open|Cannot open|is not supported|Unsupported/i.test(l)) || 'Could not read this archive. It may be damaged or in an unsupported format.'
  return Object.assign(new Error(line.replace(/^ERROR:\s*/, '')), { code: 'READ' })
}

const pw = (p) => (p ? [`-p${p}`] : [])
const mountSrc = (sz) => {
  sz.FS.mount(sz.WORKERFS, { blobs: [{ name: src.name, data: src.file }] }, '/in')
}
let SRC = '/in/a'

function parseList(lines) {
  const info = {}
  const entries = []
  let cur = info
  let started = false
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (line === '----------') { started = true; cur = null; continue }
    if (line.trim() === '') { if (started && cur) { entries.push(cur); cur = null } continue }
    const m = line.match(/^([A-Za-z ]+?) = (.*)$/)
    if (!m) continue
    if (started && !cur) cur = {}
    ;(cur || info)[m[1]] = m[2]
  }
  if (started && cur && Object.keys(cur).length) entries.push(cur)
  return { info, entries }
}

const safeName = (n) => (n || 'archive').replace(/[\\/:*?"<>|\p{C}]+/gu, '_').replace(/^-+/, '_') || 'archive'
async function open({ file, password }) {
  src = { file, password: password || '', name: safeName(file.name) }
  SRC = `/in/${src.name}`
  const r = await run(['l', '-slt', '-bd', '-y', '-sccUTF-8', ...pw(src.password), SRC], { mount: mountSrc })
  const { info, entries } = parseList(r.out)
  if (r.code && !entries.length) throw failure(r, !!src.password)
  if (!info.Type && !entries.length) throw failure(r, !!src.password)
  // The archive file itself shows up in the listing for some container types; drop that header block
  const list = entries.filter((e) => e.Path !== SRC).map((e, i) => {
    const attr = e.Attributes || ''
    const dir = e.Folder === '+' || /^D/.test(attr) || /\bd[r-][w-]/.test(attr)
    return {
      path: e.Path ?? src.name.replace(/\.(gz|bz2|xz|z|zst|lzma)$/i, ''), size: dir ? 0 : Number(e.Size || 0), packed: Number(e['Packed Size'] || 0), type: dir ? 'dir' : /l[r-][w-]/.test(attr) && !/^A/.test(attr) && e['Symbolic Link'] ? 'link' : 'file',
      date: parseDate(e.Modified), encrypted: e.Encrypted === '+', crc: e.CRC || '', method: e.Method || '', index: i,
    }
  })
  return { format: info.Type || '', method: info.Method || '', solid: info.Solid === '+', physical: Number(info['Physical Size'] || 0), entries: list, err: r.err.join('\n') }
}

function parseDate(s) {
  if (!s) return null
  const m = s.match(/^(\d{4})-(\d\d)-(\d\d)(?: (\d\d):(\d\d):(\d\d))?/)
  if (!m || m[1] === '0000') return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
}

function readTree(sz, base, rel = '') {
  const out = []
  for (const name of sz.FS.readdir(rel ? `${base}/${rel}` : base)) {
    if (name === '.' || name === '..') continue
    const p = rel ? `${rel}/${name}` : name
    const st = sz.FS.stat(`${base}/${p}`)
    if (sz.FS.isDir(st.mode)) out.push(...readTree(sz, base, p))
    else out.push(p)
  }
  return out
}

/** Extract: paths = explicit list or null. all = [{path,size}] (used to split a huge extraction into batches). */
async function extract(id, { paths, all, test }) {
  let groups = [paths && paths.length ? paths : null]
  if (!paths && all?.length) {
    const files = all.filter((e) => e.type === 'file')
    const total = files.reduce((s, e) => s + e.size, 0)
    if (total > BATCH) {
      groups = []
      let cur = []
      let acc = 0
      for (const e of files) {
        if (acc + e.size > BATCH && cur.length) { groups.push(cur); cur = []; acc = 0 }
        cur.push(e.path); acc += e.size
      }
      if (cur.length) groups.push(cur)
    }
  }
  let count = 0
  const bad = []
  for (const g of groups) {
    const args = test ? ['t', '-bb1'] : ['x', '-aoa']
    const r = await run([...args, '-y', '-bd', '-sccUTF-8', '-spd', ...pw(src.password), ...(test ? [] : ['-o/out']), SRC, ...(g || [])], { mount: mountSrc })
    if (test) {
      for (const l of [...r.err, ...r.out]) { const m = l.match(/^ERROR: (.*?) : (.+)$/) || l.match(/^ERROR: (.+)$/); if (m && !/^(Errors|Warnings)/.test(m[1])) bad.push({ path: m[2] ? m[2].replace(/^\/in\/a$/, '') : m[1], error: m[2] ? m[1] : 'Error' }) }
      if (r.code && !bad.length) throw failure(r, !!src.password)
      count += g ? g.length : all?.length || 0
      post({ id, tick: { path: '', size: 0 } })
      continue
    }
    const errText = [...r.err, ...r.out].join('\n')
    const files = readTree(r.sz, '/out')
    if (/wrong password|data error in encrypted|crc failed in encrypted|enter password/i.test(errText)) throw failure({ err: ['wrong password'], out: [] }, !!src.password)
    if (r.code && !files.length) throw failure(r, !!src.password)
    for (const p of files) {
      const data = r.sz.FS.readFile(`/out/${p}`)
      r.sz.FS.unlink(`/out/${p}`)
      const copy = new Uint8Array(data) // own buffer so it can be transferred
      post({ id, entry: { path: p, size: copy.length, type: 'file', data: copy } }, [copy.buffer])
      count++
    }
    if (/ERROR:|CRC Failed|Data Error/.test(errText)) bad.push({ path: '', error: errText.split('\n').find((l) => /ERROR:|CRC Failed|Data Error/.test(l)) })
  }
  return { count, bad }
}

/** Create 7z, zip, tar, gzip, bzip2 or xz. files: [{path, file}], dirs: [path]. */
async function create({ kind, files, dirs = [], level = 5, password = '', encryptNames = false, solid = true }) {
  const single = ['gzip', 'bzip2', 'xz'].includes(kind)
  const ext = { '7z': '7z', zip: 'zip', tar: 'tar', gzip: 'gz', bzip2: 'bz2', xz: 'xz' }[kind]
  const target = `/out/result.${ext}`
  const args = ['a', `-t${kind}`, '-y', '-bd', '-sccUTF-8', `-mx=${level}`]
  if (kind === '7z') { if (!solid) args.push('-ms=off'); if (password && encryptNames) args.push('-mhe=on') }
  if (password) args.push(`-p${password}`)
  if (kind === 'zip' && password) args.push('-mem=AES256')
  args.push(target)
  const r = await run(args, {
    mount: (sz) => {
      sz.FS.mkdirTree('/w')
      sz.FS.mount(sz.WORKERFS, { blobs: files.map((f, i) => ({ name: `f${i}`, data: f.file })) }, '/w')
      if (single) { args.push('/w/f0'); return }
      for (const d of dirs) sz.FS.mkdirTree(`/in/${d}`)
      files.forEach((f, i) => {
        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
        if (dir) sz.FS.mkdirTree(`/in/${dir}`)
        sz.FS.symlink(`/w/f${i}`, `/in/${f.path}`)
      })
      sz.FS.chdir('/in')
      args.push('.')
    },
  })
  const files2 = readTree(r.sz, '/out')
  if (!files2.includes(`result.${ext}`)) throw failure(r, false)
  const data = new Uint8Array(r.sz.FS.readFile(target))
  return { __transfer: [data.buffer], data }
}

self.onmessage = async (ev) => {
  const { id, op, ...args } = ev.data
  try {
    let result
    let transfer = []
    if (op === 'open') result = await open(args)
    else if (op === 'extract') result = await extract(id, args)
    else if (op === 'create') { const r = await create(args); transfer = r.__transfer; result = r.data }
    else if (op === 'close') { src = null; result = true }
    post({ id, ok: true, result }, transfer)
  } catch (e) {
    post({ id, ok: false, error: { message: typeof e?.message === 'string' ? e.message : (() => { try { return JSON.stringify(e) + ' ' + String(e?.stack) } catch { return String(e) } })(), code: e?.code } })
  }
}
