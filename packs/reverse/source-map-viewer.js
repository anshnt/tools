// Source map viewer: decodes Base64 VLQ mappings (also index maps with sections), lists the original sources, looks up positions
// in both directions, shows the generated code around a position and zips the recovered sources with their folder structure.
import { h, dropzone, textarea, field, alert, clear, stats, button, input, number, select, table, tabs, download, formatBytes, formatNumber, debounce, yieldToMain, progress, errorMessage, card, busy, onCleanup } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { baseName } from '../../lib/files.js'
import { b64decode } from './_pkg-plist.js'
import { useCss, kv, pill, pills, codeLines, sectionTitle } from './_pkg-ui.js'

const MAX_BYTES = 300 * 1024 * 1024
const fail = (msg) => { throw Object.assign(new Error(msg), { userMessage: msg }) }

// ---------- Pure helpers (exported for tests) ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_VAL = new Int8Array(128).fill(-1)
for (let i = 0; i < 64; i++) B64_VAL[B64.charCodeAt(i)] = i

/** Decode one VLQ-encoded segment string ("AAgBC") into an array of signed integers. */
export function decodeVlq(str) {
  const out = []
  let v = 0, shift = 0
  for (let i = 0; i < str.length; i++) {
    const d = B64_VAL[str.charCodeAt(i)]
    if (d === undefined || d < 0) fail(`The mappings contain an invalid character "${str[i]}".`)
    v += (d & 31) * 2 ** shift
    if (d & 32) { shift += 5; continue }
    out.push(v % 2 === 1 ? -(v - 1) / 2 : v / 2)
    v = 0; shift = 0
  }
  if (shift) fail('The mappings end in the middle of a number.')
  return out
}

/** Encode integers as VLQ (used by tests and handy for debugging). */
export function encodeVlq(nums) {
  let s = ''
  for (const n of nums) {
    let v = n < 0 ? (-n << 1) | 1 : n << 1
    do { let d = v & 31; v >>>= 5; if (v) d |= 32; s += B64[d] } while (v)
  }
  return s
}

/**
 * Decode a "mappings" string into per-line arrays of segments with absolute values:
 * {gc (generated column), s (source index or -1), l (original line, 0-based), c (original column), n (name index or -1)}.
 */
export function decodeMappings(mappings, state = { s: 0, l: 0, c: 0, n: 0 }) {
  const lines = []
  let row = []
  let gc = 0
  const f = [0, 0, 0, 0, 0]
  let nf = 0, v = 0, shift = 0
  const flush = () => {
    if (shift) fail('The mappings end in the middle of a number.')
    if (!nf) return
    if (nf !== 1 && nf !== 4 && nf !== 5) fail(`A mapping segment has ${nf} fields; it should have 1, 4 or 5.`)
    gc += f[0]
    if (nf === 1) row.push({ gc, s: -1, l: -1, c: -1, n: -1 })
    else {
      state.s += f[1]; state.l += f[2]; state.c += f[3]
      if (nf === 5) state.n += f[4]
      row.push({ gc, s: state.s, l: state.l, c: state.c, n: nf === 5 ? state.n : -1 })
    }
    nf = 0
  }
  const len = mappings.length
  for (let i = 0; i <= len; i++) {
    const code = i < len ? mappings.charCodeAt(i) : 59
    if (code === 44 || code === 59) { // ',' or ';'
      flush()
      if (code === 59) {
        if (row.length > 1) { let sorted = true; for (let k = 1; k < row.length; k++) if (row[k].gc < row[k - 1].gc) { sorted = false; break } if (!sorted) row.sort((a, b) => a.gc - b.gc) }
        lines.push(row)
        row = []
        gc = 0
      }
      continue
    }
    const d = code < 128 ? B64_VAL[code] : -1
    if (d < 0) fail(`The mappings contain an invalid character "${mappings[i]}".`)
    v += (d & 31) * 2 ** shift
    if (d & 32) { shift += 5; continue }
    if (nf >= 5) fail('A mapping segment has more than 5 fields.')
    f[nf++] = v % 2 === 1 ? -(v - 1) / 2 : v / 2
    v = 0; shift = 0
  }
  return lines
}

/** Normalize a source map object (regular or index map) into {file, sources, sourcesContent, names, lines, sections, mappingsCount}. */
export function parseSourceMap(input) {
  let m = input
  if (typeof input === 'string') {
    const t = input.replace(/^\)\]\}'[^\n]*\n/, '').trim() // XSSI prefix some servers add
    try { m = JSON.parse(t) } catch (e) { fail('This is not valid JSON, so it is not a source map: ' + e.message) }
  }
  if (!m || typeof m !== 'object') fail('This is not a source map.')
  if (m.version !== 3 && m.version !== '3') fail(m.version ? `Source map version ${m.version} is not supported (only version 3).` : 'This JSON has no "version": 3, so it is not a source map.')
  if (Array.isArray(m.sections)) return flattenIndexMap(m)
  if (typeof m.mappings !== 'string' || !Array.isArray(m.sources)) fail('This source map has no "mappings" string or "sources" list.')
  const root = typeof m.sourceRoot === 'string' && m.sourceRoot ? m.sourceRoot.replace(/\/?$/, '/') : ''
  const sources = m.sources.map((s) => (s == null ? '' : root && !/^[a-z][\w+.-]*:|^\//i.test(s) ? root + s : String(s)))
  const lines = decodeMappings(m.mappings)
  return finish({ file: m.file || '', sources, sourcesContent: (m.sourcesContent || []).slice(0, sources.length), names: m.names || [], lines, sections: 0, ignoreList: m.ignoreList || m.x_google_ignoreList || [] })
}

function flattenIndexMap(m) {
  const sources = [], sourcesContent = [], names = [], lines = []
  let sections = 0
  const ignoreList = []
  for (const sec of m.sections) {
    if (!sec.map) fail('This index map has a section that points to another URL. Only sections with an embedded "map" can be read here.')
    const sub = parseSourceMap(sec.map)
    const so = sources.length, no = names.length
    sources.push(...sub.sources)
    sub.sources.forEach((_, i) => sourcesContent.push(sub.sourcesContent[i] ?? null))
    names.push(...sub.names)
    ignoreList.push(...sub.ignoreList.map((i) => i + so))
    const lo = sec.offset?.line || 0, co = sec.offset?.column || 0
    sub.lines.forEach((row, i) => {
      const L = lo + i
      while (lines.length <= L) lines.push([])
      for (const seg of row) lines[L].push({ gc: seg.gc + (i === 0 ? co : 0), s: seg.s < 0 ? -1 : seg.s + so, l: seg.l, c: seg.c, n: seg.n < 0 ? -1 : seg.n + no })
    })
    sections++
  }
  for (const row of lines) row.sort((a, b) => a.gc - b.gc)
  return finish({ file: m.file || '', sources, sourcesContent, names, lines, sections, ignoreList })
}

function finish(map) {
  map.mappingsCount = map.lines.reduce((a, r) => a + r.length, 0)
  map.bySource = null // built lazily for reverse lookups
  return map
}

/** Generated (line 1-based, column 0-based) -> original {source, sourceIndex, line (1-based), column (0-based), name} or null. */
export function originalPositionFor(map, line, column) {
  const row = map.lines[line - 1]
  if (!row || !row.length) return null
  let lo = 0, hi = row.length - 1, best = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (row[mid].gc <= column) { best = mid; lo = mid + 1 } else hi = mid - 1 }
  if (best < 0) return null
  const seg = row[best]
  if (seg.s < 0) return null
  return { source: map.sources[seg.s], sourceIndex: seg.s, line: seg.l + 1, column: seg.c, name: seg.n >= 0 ? map.names[seg.n] ?? null : null, generatedColumn: seg.gc }
}

function bySource(map) {
  if (map.bySource) return map.bySource
  const idx = map.sources.map(() => [])
  map.lines.forEach((row, gl) => { for (const seg of row) if (seg.s >= 0 && idx[seg.s]) idx[seg.s].push({ l: seg.l, c: seg.c, gl, gc: seg.gc }) })
  for (const list of idx) list.sort((a, b) => a.l - b.l || a.c - b.c || a.gl - b.gl || a.gc - b.gc)
  map.bySource = idx
  return idx
}

/**
 * Original (source index, line 1-based, column 0-based) -> generated positions.
 * Returns {best: {line, column}, all: [{line, column, origColumn}]} for that original line, or null when the line has no mappings.
 */
export function generatedPositionsFor(map, sourceIndex, line, column = 0) {
  const list = bySource(map)[sourceIndex]
  if (!list) return null
  const onLine = list.filter((x) => x.l === line - 1)
  if (!onLine.length) return null
  let best = null
  for (const x of onLine) if (x.c <= column && (!best || x.c > best.c)) best = x
  best ||= onLine[0]
  return { best: { line: best.gl + 1, column: best.gc, origColumn: best.c }, all: onLine.map((x) => ({ line: x.gl + 1, column: x.gc, origColumn: x.c })) }
}

/** Nearest original line at or after `line` that has mappings (for helpful hints). */
export function nextMappedLine(map, sourceIndex, line) {
  const list = bySource(map)[sourceIndex] || []
  const x = list.find((p) => p.l >= line - 1)
  return x ? x.l + 1 : null
}

/** Make a safe relative ZIP path from a source URL: drops webpack://, protocols, queries, leading slashes and ../ segments. */
export function sanitizePath(src, i = 0) {
  let p = String(src || '')
  p = p.replace(/^webpack:\/\/[^/]*\//, '').replace(/^[a-z][\w+.-]*:\/\/\/?/i, '').replace(/^[a-z][\w+.-]*:(?!\/)/i, '')
  p = p.replace(/[?#].*$/, '').replace(/\\/g, '/')
  const parts = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.' || seg === '..') continue
    parts.push(seg.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^\.+$/, '_').slice(0, 120))
  }
  return parts.join('/') || `source-${i + 1}.txt`
}

/** Find a sourceMappingURL in generated code. Returns {inline: mapText} or {url} or null. */
export function findSourceMappingURL(code) {
  const re = /(?:\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$)|(?:\/\*[#@]\s*sourceMappingURL=([^\s*'"]+)\s*\*\/\s*$)/gm
  let last = null, m
  while ((m = re.exec(code))) last = m[1] || m[2]
  if (!last) return null
  const d = last.match(/^data:([^,]*),(.*)$/s)
  if (!d) return { url: last }
  const isB64 = /;base64$/i.test(d[1]) || /;base64;/i.test(d[1])
  const text = isB64 ? new TextDecoder().decode(b64decode(d[2])) : decodeURIComponent(d[2])
  return { inline: text }
}

/** Lines around a position, cropping long (minified) lines to a window around the column. Returns {text, firstLine, focus}. */
export function windowAround(code, line, column, ctx = 3, width = 160) {
  const all = code.split(/\r\n|\r|\n/)
  const first = Math.max(1, line - ctx), last = Math.min(all.length, line + ctx)
  const out = []
  let focus = null
  for (let n = first; n <= last; n++) {
    let s = all[n - 1] ?? ''
    if (n === line) {
      let col = column
      if (s.length > width) {
        const start = Math.max(0, column - Math.floor(width / 2))
        const pre = start > 0 ? '... ' : ''
        s = pre + s.slice(start, start + width) + (start + width < s.length ? ' ...' : '')
        col = column - start + pre.length
      }
      focus = { line: n, col }
    } else if (s.length > width) s = s.slice(0, width) + ' ...'
    out.push(s)
  }
  return { text: out.join('\n'), firstLine: first, focus }
}

// ---------- UI ----------

export function mount(root) {
  root.classList.add(useCss())
  const result = h('div', { class: 'stack' })
  const prog = progress()
  let state = null // {map, name, generated: {name, text}}
  let pendingCode = null

  const zone = dropzone({ accept: '.map,.json,.js,.mjs,.cjs,.css', multiple: true, label: 'Drop a .map file here', hint: 'A .js.map or .css.map, optionally with its generated .js · or a .js with an inline map', icon: 'map', onFiles: (files) => openFiles(files) })
  const paste = textarea({ rows: 4, mono: true, spellcheck: false, placeholder: '{"version":3,"sources":[...],"mappings":"AAAA,..."}' })
  const onPaste = debounce(() => {
    const t = paste.value.trim()
    if (!t) return
    try { load(parseSourceMap(t), 'pasted.map', pendingCode) } catch (e) { clear(result, alert('error', errorMessage(e))) }
  }, 400)
  paste.addEventListener('input', onPaste)
  onCleanup(() => paste.removeEventListener('input', onPaste))

  async function openFiles(files) {
    clear(result)
    const big = files.find((f) => f.size > MAX_BYTES)
    if (big) { result.append(alert('error', `${big.name} is ${formatBytes(big.size)}. The limit is ${formatBytes(MAX_BYTES)}.`)); return }
    prog.set(null, 'Reading files')
    try {
      await yieldToMain()
      let mapFile = files.find((f) => /\.map$/i.test(f.name)) || files.find((f) => /\.json$/i.test(f.name))
      const codeFile = files.find((f) => /\.(m|c)?js$|\.css$/i.test(f.name))
      const code = codeFile ? { name: codeFile.name, text: await codeFile.text() } : null
      let map, name
      if (mapFile) {
        prog.set(null, `Decoding ${mapFile.name}`)
        await yieldToMain()
        map = parseSourceMap(await mapFile.text())
        name = mapFile.name
      } else if (code) {
        const ref = findSourceMappingURL(code.text)
        if (ref?.inline) { map = parseSourceMap(ref.inline); name = `${code.name} (inline map)` } else {
          pendingCode = code
          if (state) { state.generated = code; render(); return }
          clear(result, alert('info', ref?.url ? `${code.name} points to an external map: "${ref.url}". Drop that .map file too (you can drop both at once).` : `${code.name} has no sourceMappingURL comment. Drop its .map file to look up positions.`))
          return
        }
      }
      load(map, name, code || (state && !mapFile ? state.generated : null))
    } catch (e) {
      if (!e?.userMessage) console.error(e)
      clear(result, alert('error', errorMessage(e)))
    } finally { prog.hide() }
  }

  function load(map, name, generated) {
    state = { map, name, generated: generated || null }
    pendingCode = null
    render()
  }

  function render() {
    const { map, name } = state
    const withContent = map.sourcesContent.filter((c) => typeof c === 'string').length
    const viewer = h('div')
    const showSource = (i, focus) => {
      const c = map.sourcesContent[i]
      clear(viewer, card(sectionTitle(map.sources[i] || `source ${i + 1}`, button('Download', { icon: 'download', size: 'sm', disabled: typeof c !== 'string', onClick: () => download(c, sanitizePath(map.sources[i], i).split('/').pop(), 'text/plain') })),
        typeof c === 'string' ? codeLines(c, { focus }) : alert('warn', 'This source map does not include the content of this file (no sourcesContent entry), so only its name is known.')))
      viewer.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    }

    const sourcesTab = () => {
      const q = input({ type: 'search', placeholder: `Filter ${map.sources.length} sources`, 'aria-label': 'Filter sources' })
      const listBox = h('div')
      const zipOut = h('div')
      const zprog = progress()
      const zipBtn = button('Download sources as ZIP', { icon: 'file-archive', variant: 'primary', disabled: !withContent })
      zipBtn.addEventListener('click', () => busy(zipBtn, async () => {
        const JSZip = await jszip()
        const z = new JSZip()
        const used = new Set()
        let n = 0
        for (let i = 0; i < map.sources.length; i++) {
          const c = map.sourcesContent[i]
          if (typeof c !== 'string') continue
          let p = sanitizePath(map.sources[i], i)
          for (let k = 2; used.has(p); k++) p = p.replace(/(\.[^./]+)?$/, (e) => ` (${k})${e}`)
          used.add(p)
          z.file(p, c)
          n++
          if (i % 200 === 0) { zprog.set((i / map.sources.length) * 0.3, 'Collecting sources'); await yieldToMain() }
        }
        const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (m) => zprog.set(0.3 + (m.percent / 100) * 0.7, 'Compressing'))
        download(blob, `${baseName(baseName(name.replace(/ \(inline map\)$/, ''))) || 'sources'}-sources.zip`)
        clear(zipOut, alert('success', `ZIP ready: ${n} source files, ${formatBytes(blob.size)}.${n < map.sources.length ? ` ${map.sources.length - n} sources had no content and were skipped.` : ''}`))
      }, { label: 'Zipping', errorTo: zipOut, progress: zprog }))
      const draw = () => {
        const f = q.value.trim().toLowerCase()
        const rows = []
        map.sources.forEach((s, i) => {
          if (f && !s.toLowerCase().includes(f)) return
          const c = map.sourcesContent[i]
          rows.push([h('code', { style: 'overflow-wrap:anywhere' }, s || '(empty)'),
            typeof c === 'string' ? formatBytes(new Blob([c]).size) : pill('missing', 'warn'),
            map.ignoreList.includes(i) ? pill('ignored') : '',
            button('View', { icon: 'eye', size: 'sm', variant: 'ghost', ariaLabel: `View ${s}`, onClick: () => showSource(i) })])
        })
        clear(listBox, rows.length ? table({ columns: ['Source', { label: 'Size', num: true }, '', ''], rows, max: 2000 }) : h('p', { class: 'muted' }, 'No sources match.'))
      }
      q.addEventListener('input', debounce(draw, 150))
      draw()
      return h('div', { class: 'stack' }, h('div', { class: 'row' }, zipBtn, withContent < map.sources.length ? h('span', { class: 'small muted' }, `${map.sources.length - withContent} without content will be skipped.`) : null), zprog.el, zipOut, q, listBox)
    }

    const lookupTab = () => {
      const genLine = number(1, { min: 1, step: 1, ariaLabel: 'Generated line' })
      const genCol = number(1, { min: 1, step: 1, ariaLabel: 'Generated column' })
      const out1 = h('div', { class: 'stack' })
      const srcSel = select(map.sources.map((s, i) => [String(i), s || `source ${i + 1}`]), '0')
      const origLine = number(1, { min: 1, step: 1, ariaLabel: 'Original line' })
      const origCol = number(1, { min: 1, step: 1, ariaLabel: 'Original column' })
      const out2 = h('div', { class: 'stack' })
      const genSnippet = (line, col0) => {
        if (!state.generated) return h('div', { class: 'small muted' }, 'Drop the generated .js together with the map to see the code at this position.')
        const w = windowAround(state.generated.text, line, col0)
        return h('div', { class: 'stack' }, h('strong', `Generated code (${state.generated.name})`), codeLines(w.text, { firstLine: w.firstLine, focus: w.focus }))
      }
      const origSnippet = (i, line, col0) => {
        const c = map.sourcesContent[i]
        if (typeof c !== 'string') return h('div', { class: 'small muted' }, 'This source has no embedded content.')
        const w = windowAround(c, line, col0, 4, 200)
        return h('div', { class: 'stack' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('strong', 'Original code'), button('Open full source', { icon: 'file-code', size: 'sm', variant: 'ghost', onClick: () => showSource(i, { line, col: col0 }) })), codeLines(w.text, { firstLine: w.firstLine, focus: w.focus }))
      }
      const run1 = () => {
        const L = genLine.valueAsNumber, C = genCol.valueAsNumber
        if (!(L >= 1) || !(C >= 1)) { clear(out1, h('div', { class: 'small muted' }, 'Enter a line and column (both start at 1).')); return }
        const r = originalPositionFor(map, Math.floor(L), Math.floor(C) - 1)
        if (!r) { clear(out1, alert('warn', map.lines[L - 1]?.length ? 'No original position for this column (it is before the first mapping on the line, or the segment has no source).' : `Line ${L} has no mappings.${map.lines.length < L ? ` The map covers ${map.lines.length} generated lines.` : ''}`), genSnippet(L, C - 1)); return }
        clear(out1, kv([['Source', r.source], ['Line', r.line], ['Column', r.column + 1], ['Name', r.name], ['Segment starts at', `generated column ${r.generatedColumn + 1}`]]), origSnippet(r.sourceIndex, r.line, r.column), genSnippet(L, C - 1))
      }
      const run2 = () => {
        const i = +srcSel.value, L = origLine.valueAsNumber, C = origCol.valueAsNumber
        if (!(L >= 1) || !(C >= 1)) { clear(out2, h('div', { class: 'small muted' }, 'Enter a line and column (both start at 1).')); return }
        const r = generatedPositionsFor(map, i, Math.floor(L), Math.floor(C) - 1)
        if (!r) { const nx = nextMappedLine(map, i, L); clear(out2, alert('warn', `Line ${L} of this source has no mappings.${nx ? ` The next mapped line is ${nx}.` : ''}`)); return }
        clear(out2, kv([['Generated line', r.best.line], ['Generated column', r.best.column + 1], ['Mappings on this line', r.all.length]]),
          r.all.length > 1 ? h('div', { class: 'small muted' }, 'All: ' + r.all.slice(0, 30).map((p) => `${p.line}:${p.column + 1} (col ${p.origColumn + 1})`).join(', ') + (r.all.length > 30 ? ' ...' : '')) : null,
          genSnippet(r.best.line, r.best.column))
      }
      const d1 = debounce(run1, 150), d2 = debounce(run2, 150)
      for (const el of [genLine, genCol]) el.addEventListener('input', d1)
      for (const el of [srcSel, origLine, origCol]) el.addEventListener(el === srcSel ? 'change' : 'input', d2)
      run1(); run2()
      return h('div', { class: 'stack' },
        card(sectionTitle('Generated to original'), h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('Line', genLine), field('Column', genCol)), out1)),
        card(sectionTitle('Original to generated'), h('div', { class: 'stack' }, field('Source', srcSel), h('div', { class: 'grid-2' }, field('Line', origLine), field('Column', origCol)), out2)),
        h('div', { class: 'small muted' }, 'Lines and columns start at 1, like in browser dev tools and stack traces.'))
    }

    const mappingsTab = () => {
      const rows = []
      outer: for (let gl = 0; gl < map.lines.length; gl++) {
        for (const seg of map.lines[gl]) {
          rows.push([`${gl + 1}:${seg.gc + 1}`, seg.s >= 0 ? h('code', { style: 'overflow-wrap:anywhere' }, map.sources[seg.s]) : h('span', { class: 'muted' }, '(none)'), seg.s >= 0 ? `${seg.l + 1}:${seg.c + 1}` : '', seg.n >= 0 ? h('code', map.names[seg.n]) : ''])
          if (rows.length >= 1000) break outer
        }
      }
      return h('div', { class: 'stack' }, h('div', { class: 'small muted' }, `First ${formatNumber(rows.length)} of ${formatNumber(map.mappingsCount)} mappings.`), table({ columns: ['Generated', 'Source', 'Original', 'Name'], rows }))
    }

    clear(result,
      stats([
        { label: 'Sources', value: formatNumber(map.sources.length), accent: true, hint: `${withContent} with content` },
        { label: 'Mappings', value: formatNumber(map.mappingsCount) },
        { label: 'Names', value: formatNumber(map.names.length) },
        { label: 'Generated lines', value: formatNumber(map.lines.length) },
      ]),
      pills(pill(name, 'info', 'file'), map.file ? pill(`file: ${map.file}`) : null, map.sections ? pill(`index map, ${map.sections} sections`) : null, state.generated ? pill(`code: ${state.generated.name}`, 'ok') : null,
        withContent < map.sources.length ? pill(`${map.sources.length - withContent} sources without content`, 'warn') : null),
      tabs([{ id: 's', label: 'Sources', render: sourcesTab }, { id: 'l', label: 'Lookup', render: lookupTab }, { id: 'm', label: 'Mappings', render: mappingsTab }]),
      viewer)
  }

  root.append(h('div', { class: 'stack' }, zone, field('Or paste source map JSON', paste), prog.el, result))
}
