// Split & join files. Split a big file by part size or number of parts (parts are named name.ext.001, .002 ...), with a JSON manifest
// that holds SHA-256 checksums. Join puts parts back in order and verifies the result by hash. Also serves join-files (params.mode = 'join').
// Parts are lazy slices of the original, so nothing is copied into memory until you save.
import { h, icon, clear, dropzone, fileList, button, busy, alert, stats, field, input, number, select, segmented, tabs, table, progress, download, formatBytes, toast, errorMessage, onCleanup, yieldToMain } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { makeHasher, hashBlob, ensurePermission, canPickDirectory, naturalCompare, throwIfAborted } from './_core.js'
import { useFx, card, chip, chips, hashRow, celebrate, checkRing, injectStyle } from './_ui.js'

const MB = 1024 * 1024
const UNITS = { KB: 1024, MB: MB, GB: MB * 1024 }
const MAX_PARTS = 10000
const ZIP_LIMIT = 2 * 1024 ** 3

// ---------- Pure helpers (exported for tests) ----------
/** Part boundaries for a file. Returns [{start, end}] or throws a plain-words Error. */
export function planParts(size, { by = 'size', partSize = 0, count = 0 }) {
  if (!size) throw new Error('This file is empty, so there is nothing to split.')
  let each
  if (by === 'count') {
    if (!Number.isInteger(count) || count < 2) throw new Error('Choose at least 2 parts.')
    if (count > MAX_PARTS) throw new Error(`That would make more than ${MAX_PARTS.toLocaleString()} parts. Choose fewer.`)
    if (count > size) throw new Error('There are more parts than bytes in the file. Choose fewer parts.')
    each = Math.ceil(size / count)
  } else {
    each = Math.floor(partSize)
    if (!(each >= 1024)) throw new Error('Parts must be at least 1 KB.')
    if (each >= size) throw new Error(`The part size is as big as the whole file (${formatBytes(size)}), so there is nothing to split. Choose a smaller size.`)
    if (Math.ceil(size / each) > MAX_PARTS) throw new Error(`That would make more than ${MAX_PARTS.toLocaleString()} parts. Choose a bigger part size.`)
  }
  const parts = []
  for (let s = 0; s < size; s += each) parts.push({ start: s, end: Math.min(size, s + each) })
  return parts
}

/** name.ext + index -> name.ext.001 (3 digits, or more when there are over 999 parts). */
export const partName = (name, i, total) => `${name}.${String(i + 1).padStart(Math.max(3, String(total).length), '0')}`

/** Work out the original file name from a part name: movie.mp4.001, movie.part01.mp4, movie_01.zip -> ... */
export function baseFromPart(name) {
  let m = name.match(/^(.*)\.(\d{2,5})$/)
  if (m) return m[1]
  m = name.match(/^(.*)\.part\d+(\.[^.]+)?$/i)
  if (m) return m[1] + (m[2] || '')
  m = name.match(/^(.*?)[._-]?(\d{2,5})(\.[^.]+)$/)
  if (m && m[1]) return m[1] + m[3]
  return name.replace(/\.(part|piece|chunk)$/i, '')
}

/** The last number in a name, used to put parts in order and spot gaps. */
export const partNumber = (name) => { const m = name.match(/(\d+)(?!.*\d)/); return m ? parseInt(m[1], 10) : NaN }

/** Natural ordering by the number in the name when every name has one and they share a prefix, else natural name order. */
export function orderParts(files) {
  const list = [...files]
  const nums = list.map((f) => partNumber(f.name))
  if (nums.every(Number.isFinite)) return list.sort((a, b) => partNumber(a.name) - partNumber(b.name) || naturalCompare(a.name, b.name))
  return list.sort((a, b) => naturalCompare(a.name, b.name))
}

/** Gaps in the numbering of ordered parts: returns an array of missing numbers (empty when complete or not numbered). */
export function missingNumbers(files) {
  const nums = files.map((f) => partNumber(f.name))
  if (nums.length < 2 || !nums.every(Number.isFinite)) return []
  const first = Math.min(...nums), last = Math.max(...nums)
  if (last - first > 20000) return []
  const have = new Set(nums)
  const out = []
  const from = first <= 1 ? 1 : first
  for (let n = from; n <= last; n++) if (!have.has(n)) out.push(n)
  return out
}

const HOWTO = (name, parts) => `How to join "${name}"

The ${parts} files ${name}.001, ${name}.002 ... are consecutive pieces of one file. Put them in one folder, then:

Windows (Command Prompt)
  copy /b "${name}.001"+"${name}.002"+... "${name}"
  or, for all of them:  copy /b "${name}.0*" "${name}"

macOS and Linux (Terminal)
  cat "${name}".0* > "${name}"

Or use the Join tool on this site (it also checks the SHA-256 in ${name}.manifest.json).
`

export function mount(root, { params }) {
  useFx()
  injectStyle('fx-split', '.fx-part-name { font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; }')
  if (params?.mode === 'join') return root.append(h('div', { class: 'stack fx' }, joinView()))
  root.append(h('div', { class: 'stack fx' }, tabs([{ id: 'split', label: 'Split a file', render: () => splitView() }, { id: 'join', label: 'Join parts', render: () => joinView() }], 'split')))
}

// ---------- Split ----------
function splitView() {
  let file = null, ctl = null
  const s = { by: 'size', value: 25, unit: 'MB', count: 4, hashes: true }
  const out = h('div', { class: 'stack' })
  const prog = progress('Splitting')
  const zone = dropzone({ multiple: false, label: 'Drop the file to split here or click to choose', hint: 'Any file, any size. It is cut into pieces on this device.', onFiles: ([f]) => { file = f; zone.classList.add('compact'); form.hidden = false; show() } })
  const byRow = segmented([['size', 'By part size'], ['count', 'By number of parts']], 'size', (v) => { s.by = v; sizeBox.hidden = v !== 'size'; countBox.hidden = v !== 'count'; show() }, 'How to split')
  const valueIn = number(25, { min: 0, step: 'any', ariaLabel: 'Part size', onInput: (n) => { s.value = n; show() } })
  const unitSel = select(Object.keys(UNITS), 'MB', (v) => { s.unit = v; show() })
  const countIn = number(4, { min: 2, step: 1, ariaLabel: 'Number of parts', onInput: (n) => { s.count = n; show() } })
  const presets = h('div', { class: 'fx-chips' }, [['10 MB', 10, 'MB'], ['25 MB (email)', 25, 'MB'], ['100 MB', 100, 'MB'], ['650 MB (CD)', 650, 'MB'], ['4 GB (FAT32)', 4, 'GB']].map(([l, v, u]) =>
    h('button', { type: 'button', class: 'fx-chip accent', style: 'cursor:pointer', onclick: () => { s.value = v; s.unit = u; valueIn.value = v; unitSel.value = u; show() } }, l)))
  const sizeBox = h('div', { class: 'stack tight' }, h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { style: 'width:150px' }, field('Size of each part', valueIn)), h('div', { style: 'width:110px' }, field('Unit', unitSel))), presets)
  const countBox = h('div', { style: 'max-width:200px' }, field('Number of parts', countIn))
  countBox.hidden = true
  const hashBox = h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: true, onchange: (e) => { s.hashes = e.target.checked } }), h('span', 'Add SHA-256 checksums to the manifest (slower, lets Join prove the result is exact)'))
  const planEl = h('div', { 'aria-live': 'polite' })
  const goBtn = button('Split file', { icon: 'split', variant: 'primary', size: 'lg', onClick: () => go() })
  const form = card('Split settings', 'scissors', '#3e63dd', h('div', { class: 'stack' }, byRow, sizeBox, countBox, hashBox, planEl, h('div', { class: 'row' }, goBtn)))
  form.hidden = true
  onCleanup(() => ctl?.abort())

  const currentPlan = () => planParts(file.size, { by: s.by, partSize: s.value * UNITS[s.unit], count: s.count })
  function show() {
    if (!file) return
    try {
      const parts = currentPlan()
      const last = parts.at(-1)
      goBtn.disabled = false
      clear(planEl, h('div', { class: 'fx-chips' }, chip(`${file.name} · ${formatBytes(file.size)}`, '', 'file'), chip(`${parts.length.toLocaleString()} parts`, 'accent', 'split'), chip(`${formatBytes(parts[0].end - parts[0].start)} each`, '', 'ruler'),
        last.end - last.start !== parts[0].end - parts[0].start ? chip(`last one ${formatBytes(last.end - last.start)}`, '', 'corner-down-right') : null),
      h('div', { class: 'small muted', style: 'margin-top:6px' }, parts.length > 1 ? `${partName(file.name, 0, parts.length)}  ...  ${partName(file.name, parts.length - 1, parts.length)}` : ''))
    } catch (e) { goBtn.disabled = true; clear(planEl, h('div', { class: 'small', style: 'color:var(--danger)', role: 'alert' }, e.message)) }
  }

  async function go() {
    ctl?.abort()
    const mine = (ctl = new AbortController())
    const f = file
    let plan
    try { plan = currentPlan() } catch (e) { return toast(e.message, 'error') }
    await busy(goBtn, async () => {
      clear(out)
      const total = plan.length
      const parts = plan.map((p, i) => ({ name: partName(f.name, i, total), blob: f.slice(p.start, p.end), size: p.end - p.start, sha256: '' }))
      let wholeSha = ''
      if (s.hashes) {
        const whole = await makeHasher('sha256')
        let done = 0
        for (const p of parts) {
          throwIfAborted(mine.signal)
          const ph = await makeHasher('sha256')
          const reader = p.blob.stream().getReader()
          for (;;) {
            const { done: end, value } = await reader.read()
            if (end) break
            throwIfAborted(mine.signal)
            ph.update(value); whole.update(value)
            done += value.length
            if (done % (8 * MB) < value.length) { prog.set(done / f.size, `Fingerprinting ${Math.round((done / f.size) * 100)}%`); await yieldToMain() }
          }
          p.sha256 = ph.digest()
        }
        wholeSha = whole.digest()
      }
      const manifest = {
        tool: 'tools split-file', version: 1,
        file: { name: f.name, size: f.size, sha256: wholeSha || undefined, modified: new Date(f.lastModified).toISOString() },
        partCount: total, partSize: parts[0].size,
        parts: parts.map((p) => ({ name: p.name, size: p.size, sha256: p.sha256 || undefined })),
      }
      showResult(f, parts, manifest)
    }, { label: 'Splitting', errorTo: out, progress: prog })
  }

  function showResult(f, parts, manifest) {
    const manifestBlob = new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' })
    const manifestName = `${f.name}.manifest.json`
    const howto = new Blob([HOWTO(f.name, parts.length)], { type: 'text/plain' })
    const resultEl = h('div')
    const folderBtn = canPickDirectory() ? button('Save all to a folder', { icon: 'folder-output', variant: 'primary', size: 'lg', onClick: (e) => saveFolder(e.currentTarget) }) : null
    const zipBtn = button('Download all as ZIP', { icon: 'file-archive', variant: folderBtn ? 'secondary' : 'primary', size: 'lg', onClick: (e) => saveZip(e.currentTarget) })
    async function saveFolder(btn) {
      let dir
      try { dir = await window.showDirectoryPicker({ id: 'tools-files', mode: 'readwrite' }) } catch (e) { if (e?.name === 'AbortError') return; return toast(errorMessage(e), 'error') }
      await busy(btn, async () => {
        if (!(await ensurePermission(dir, 'readwrite'))) throw new Error('Permission to write to that folder was not granted.')
        const target = await dir.getDirectoryHandle(`${f.name}.parts`, { create: true })
        const all = [...parts.map((p) => [p.name, p.blob]), [manifestName, manifestBlob], ['HOW-TO-JOIN.txt', howto]]
        let n = 0
        for (const [nm, blob] of all) {
          prog.set(n++ / all.length, `Writing ${nm}`)
          const w = await (await target.getFileHandle(nm, { create: true })).createWritable()
          await blob.stream().pipeTo(w)
        }
        prog.set(1, 'Done')
        clear(resultEl, alert('success', h('strong', 'Saved. '), `${parts.length} parts, the manifest and a how-to are in the folder "${f.name}.parts" inside the folder you picked.`))
        celebrate(btn, 16)
      }, { label: 'Saving', errorTo: resultEl, progress: prog })
    }
    async function saveZip(btn) {
      if (f.size > ZIP_LIMIT) return toast('A ZIP of this size is too big for a browser. Use "Save all to a folder", or download the parts one at a time.', 'error')
      await busy(btn, async () => {
        const JSZip = await jszip()
        const z = new JSZip()
        for (const p of parts) z.file(p.name, p.blob)
        z.file(manifestName, manifestBlob)
        z.file('HOW-TO-JOIN.txt', howto)
        const blob = await z.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true }, (m) => prog.set(m.percent / 100, 'Packing ZIP'))
        download(blob, `${f.name}.parts.zip`)
        clear(resultEl, alert('success', h('strong', 'Done. '), `The ZIP has all ${parts.length} parts, the manifest and a how-to (${formatBytes(blob.size)}).`))
        celebrate(btn, 16)
      }, { label: 'Packing', errorTo: resultEl, progress: prog })
    }
    clear(out,
      h('div', { class: 'fx-hero fx-in', style: { '--k': 'var(--success)' } }, checkRing('fx-pop'), h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, `Split into ${parts.length.toLocaleString()} parts`),
        h('div', { class: 'fx-sub' }, `${formatBytes(f.size)} cut into pieces of ${formatBytes(parts[0].size)}. They are ready to save.`),
        chips(chip('Nothing uploaded', 'ok', 'shield-check'), manifest.file.sha256 ? chip('SHA-256 recorded', 'accent', 'fingerprint') : null))),
      manifest.file.sha256 ? hashRow('Whole file SHA-256', manifest.file.sha256) : null,
      h('div', { class: 'row' }, folderBtn, zipBtn, button('Manifest only', { icon: 'file-json', variant: 'ghost', onClick: () => download(manifestBlob, manifestName) })),
      resultEl,
      table({
        columns: ['Part', { label: 'Size', num: true }, 'SHA-256', ''],
        rows: parts.slice(0, 500).map((p) => [h('span', { class: 'fx-part-name' }, p.name), formatBytes(p.size), p.sha256 ? h('span', { class: 'fx-mono', title: p.sha256 }, p.sha256.slice(0, 12) + '...') : '-',
          button('', { icon: 'download', variant: 'ghost', size: 'sm', ariaLabel: `Download ${p.name}`, onClick: () => download(p.blob, p.name) })]), max: 500,
      }),
      h('div', { class: 'small muted' }, 'To join the parts later, use the Join tab, or run copy /b on Windows or cat on macOS and Linux. HOW-TO-JOIN.txt has the exact commands.'))
  }

  return h('div', { class: 'stack' }, zone, form, prog.el, out)
}

// ---------- Join ----------
function joinView() {
  let manifest = null, ctl = null
  const out = h('div', { class: 'stack' })
  const prog = progress('Joining')
  const list = fileList({ sortable: true, onChange: () => update() })
  const outName = input({ 'aria-label': 'Joined file name', placeholder: 'joined-file' })
  const expected = input({ 'aria-label': 'Expected SHA-256', placeholder: 'Optional: paste the SHA-256 you expect', mono: true, spellcheck: false, autocomplete: 'off' })
  const note = h('div', { class: 'stack tight' })
  const nameTouched = { v: false }
  outName.addEventListener('input', () => { nameTouched.v = true })
  const joinBtn = button('Join parts', { icon: 'merge', variant: 'primary', size: 'lg', disabled: true, onClick: () => go() })
  const zone = dropzone({
    multiple: true, label: 'Drop all the parts here (and the .manifest.json if you have it)', hint: 'name.ext.001, .002 ... in any order. They are sorted for you.',
    onFiles: async (files) => {
      const man = files.find((f) => /\.manifest\.json$/i.test(f.name) || (f.type === 'application/json' && f.size < 5e6))
      const parts = files.filter((f) => f !== man)
      if (man) {
        try { const m = JSON.parse(await man.text()); if (m?.file?.name && Array.isArray(m.parts)) { manifest = m; toast('Manifest loaded', 'success') } else toast('That JSON is not a split manifest.', 'error') } catch { toast('Could not read the manifest file.', 'error') }
      }
      if (parts.length) { const merged = [...list.files, ...parts]; list.set(orderPartsWith(merged)) }
      else update()
    },
  })
  const orderPartsWith = (files) => {
    if (manifest) {
      const idx = new Map(manifest.parts.map((p, i) => [p.name, i]))
      if (files.every((f) => idx.has(f.name))) return [...files].sort((a, b) => idx.get(a.name) - idx.get(b.name))
    }
    return orderParts(files)
  }

  function update() {
    const files = list.files
    joinBtn.disabled = files.length < 1
    zone.classList.toggle('compact', files.length > 0)
    if (!nameTouched.v && files.length) outName.value = manifest?.file?.name || baseFromPart(files[0].name)
    const total = files.reduce((s, f) => s + f.size, 0)
    const gaps = manifest ? [] : missingNumbers(files)
    const notes = []
    if (manifest) {
      const have = new Set(files.map((f) => f.name))
      const missing = manifest.parts.filter((p) => !have.has(p.name)).map((p) => p.name)
      notes.push(alert(missing.length ? 'warn' : 'info', h('strong', 'Manifest loaded. '), missing.length ? `${missing.length} part${missing.length === 1 ? ' is' : 's are'} still missing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '...' : ''}.` : `It lists ${manifest.parts.length} parts for ${manifest.file.name}${manifest.file.sha256 ? ' and the SHA-256 of the whole file, which will be checked' : ''}.`))
    }
    if (gaps.length) notes.push(alert('warn', h('strong', 'Some parts look missing. '), `The numbering skips ${gaps.slice(0, 6).join(', ')}${gaps.length > 6 ? '...' : ''}. The result will be incomplete unless you add them.`))
    if (files.length === 1) notes.push(alert('info', 'Only one part so far. Add the rest of the parts to join them.'))
    clear(note, notes, files.length ? h('div', { class: 'fx-chips' }, chip(`${files.length} part${files.length === 1 ? '' : 's'}`, 'accent', 'files'), chip(formatBytes(total), '', 'weight')) : null)
    clear(out)
  }

  async function go() {
    ctl?.abort()
    const mine = (ctl = new AbortController())
    const files = [...list.files]
    if (!files.length) return
    await busy(joinBtn, async () => {
      clear(out)
      list.setDisabled(true)
      try {
        const blob = new Blob(files)
        const want = (expected.value.trim().toLowerCase() || manifest?.file?.sha256 || '').replace(/^sha-?256[:=\s]*/i, '')
        const sha = (await hashBlob(blob, ['sha256'], { signal: mine.signal, onProgress: (f) => prog.set(f, `Verifying ${Math.round(f * 100)}%`) })).sha256
        const sizeOk = manifest?.file?.size == null || manifest.file.size === blob.size
        const ok = want ? want === sha : null
        const fname = outName.value.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'joined-file'
        let problem = ''
        if (manifest && !sizeOk) problem = `The joined size is ${blob.size.toLocaleString()} bytes but the manifest says ${manifest.file.size.toLocaleString()}.`
        if (ok === false && manifest?.parts?.some((p) => p.sha256)) {
          // find the damaged or wrong parts
          const bad = []
          for (const f of files) {
            const mp = manifest.parts.find((p) => p.name === f.name)
            if (!mp?.sha256) continue
            const hsh = (await hashBlob(f, ['sha256'], { signal: mine.signal })).sha256
            if (hsh !== mp.sha256) bad.push(f.name)
          }
          problem = bad.length ? `These parts do not match their checksums: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '...' : ''}.` : 'Every part matches its own checksum, so a part may be missing or out of order.'
        }
        const verdict = ok === true ? 'ok' : ok === false ? 'bad' : 'none'
        const row = hashRow('SHA-256', sha)
        if (ok === true) row.classList.add('match')
        clear(out,
          h('div', { class: 'fx-hero fx-in', style: { '--k': verdict === 'bad' ? 'var(--danger)' : 'var(--success)' } },
            verdict === 'bad' ? h('div', { class: 'fx-tile lg fx-pop', style: { '--k': 'var(--danger)' } }, icon('circle-alert')) : checkRing('fx-pop'),
            h('div', { class: 'fx-body' }, h('div', { class: 'fx-title' }, verdict === 'ok' ? 'Joined and verified' : verdict === 'bad' ? 'Joined, but the checksum does not match' : 'Parts joined'),
              h('div', { class: 'fx-sub' }, `${fname} · ${formatBytes(blob.size)} from ${files.length} part${files.length === 1 ? '' : 's'}`),
              chips(verdict === 'ok' ? chip('SHA-256 matches', 'ok', 'circle-check') : verdict === 'bad' ? chip('SHA-256 differs', 'bad', 'circle-x') : chip('No checksum to compare', '', 'info'), manifest ? chip('Manifest checked', 'accent', 'file-json') : null))),
          problem ? alert('error', problem) : null,
          verdict === 'bad' && !problem ? alert('error', 'The joined file is not what was expected. A part may be missing, damaged or in the wrong order.') : null,
          row,
          h('div', { class: 'row' }, button(`Download ${fname}`, { icon: 'download', variant: 'primary', size: 'lg', onClick: () => download(blob, fname) })))
        if (verdict !== 'bad') celebrate(joinBtn, 16)
      } finally { list.setDisabled(false) }
    }, { label: 'Joining', errorTo: out, progress: prog })
  }

  onCleanup(() => ctl?.abort())
  return h('div', { class: 'stack' }, zone, list.el, note, card('Joined file', 'merge', '#12a594', h('div', { class: 'stack' },
    h('div', { class: 'grid-2' }, field('File name', outName), field('Expected SHA-256', expected, 'Filled in automatically from a manifest')),
    h('div', { class: 'row' }, joinBtn, h('span', { class: 'small muted' }, 'Drag the parts to reorder if the automatic order is wrong.')))), prog.el, out)
}
