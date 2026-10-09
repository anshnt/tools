// Folder to file list: pick a folder and export what is in it as CSV, JSON, a Markdown table, a text tree or plain paths,
// with size, dates, type and an optional SHA-256 per file. Read-only and local: nothing is uploaded.
import { h, clear, button, alert, stats, field, select, toggle, progress, copyButton, download, textarea, formatBytes, errorMessage, onCleanup } from '../../lib/ui.js'
import { hashBlob, extOf, kindOfName, fmtDateTime, buildTree, naturalCompare } from './_core.js'
import { useFx, folderZone, card } from './_ui.js'

const SHOW = 200_000
const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

export const COLUMNS = [['path', 'Path'], ['name', 'Name'], ['folder', 'Folder'], ['ext', 'Extension'], ['kind', 'Kind'], ['size', 'Size (bytes)'], ['modified', 'Modified'], ['sha256', 'SHA-256']]

/** rows: [{path, name, folder, ext, kind, size, modified, sha256}], cols: keys to include. */
export function toCsv(rows, cols) {
  const label = Object.fromEntries(COLUMNS)
  return [cols.map((c) => label[c]).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n'
}
export function toJson(rows, cols) {
  return JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), null, 2) + '\n'
}
export function toMarkdown(rows, cols) {
  const label = Object.fromEntries(COLUMNS)
  const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  return [`| ${cols.map((c) => label[c]).join(' | ')} |`, `| ${cols.map((c) => (c === 'size' ? '---:' : '---')).join(' | ')} |`, ...rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(' | ')} |`)].join('\n') + '\n'
}
/** Text tree like the `tree` command. withSize adds sizes after names. */
export function toTree(rootName, rows, { withSize = false } = {}) {
  const root = { name: rootName, children: new Map(), size: 0 }
  for (const r of rows) {
    let n = root
    const parts = r.path.split('/')
    parts.forEach((p, i) => {
      const last = i === parts.length - 1
      const key = (last ? 'f:' : 'd:') + p
      if (!n.children.has(key)) n.children.set(key, { name: p, dir: !last, children: new Map(), size: 0 })
      n = n.children.get(key)
      n.size += r.size
    })
  }
  const lines = [`${rootName}/`]
  const walk = (node, prefix) => {
    const kids = [...node.children.values()].sort((a, b) => (a.dir === b.dir ? naturalCompare(a.name, b.name) : a.dir ? -1 : 1))
    kids.forEach((k, i) => {
      const last = i === kids.length - 1
      lines.push(`${prefix}${last ? '└── ' : '├── '}${k.name}${k.dir ? '/' : ''}${withSize ? `  (${formatBytes(k.size)})` : ''}`)
      if (k.dir) walk(k, prefix + (last ? '    ' : '│   '))
    })
  }
  walk(root, '')
  return lines.join('\n') + '\n'
}

export function mount(root) {
  useFx()
  const out = h('div', { class: 'stack' })
  const prog = progress('Fingerprinting files')
  let scan = null, ctl = null
  const hashes = new Map()
  const s = { format: 'csv', sort: 'path', hidden: true, junk: true, withSize: true }
  const colBoxes = Object.fromEntries(COLUMNS.map(([k, l]) => [k, toggle(l, ['path', 'size', 'modified'].includes(k), () => draw())]))
  const zone = folderZone({ write: false, label: 'Drop a folder here or click to choose one', onFolder: (res) => { scan = res; hashes.clear(); form.hidden = false; zone.classList.add('compact'); draw() } })
  const fmt = select([['csv', 'CSV (opens in Excel)'], ['json', 'JSON'], ['md', 'Markdown table'], ['tree', 'Text tree (like the tree command)'], ['paths', 'Plain paths, one per line']], s.format, (v) => { s.format = v; draw() })
  const sort = select([['path', 'By path'], ['size', 'Largest first'], ['date', 'Newest first'], ['name', 'By file name']], s.sort, (v) => { s.sort = v; draw() })
  const hiddenBox = toggle('Include hidden files (names starting with a dot)', true, (v) => { s.hidden = v; draw() })
  const junkBox = toggle('Include node_modules and .git folders', true, (v) => { s.junk = v; draw() })
  const sizeInTree = toggle('Show sizes in the tree', true, (v) => { s.withSize = v; draw() })
  const area = textarea({ readonly: true, mono: true, rows: 14, 'aria-label': 'File list', spellcheck: false })
  const note = h('div', { class: 'small muted' })
  const statsEl = h('div')
  const colsEl = h('div', { class: 'stack tight' }, h('div', { class: 'small muted', style: 'font-weight:600' }, 'Columns (CSV, JSON and Markdown)'), h('div', { class: 'grid-auto' }, Object.values(colBoxes)))
  let text = '', ext = 'csv'
  const form = h('div', { class: 'stack' },
    card('What to list', 'list-tree', '#3e63dd', h('div', { class: 'stack' }, h('div', { class: 'grid-2' }, field('Format', fmt), field('Order', sort)), colsEl, h('div', { class: 'stack tight' }, hiddenBox, junkBox, sizeInTree))),
    card('Result', 'file-text', '#12a594', h('div', { class: 'stack tight' }, statsEl, area, note, h('div', { class: 'row' }, copyButton(() => text, 'Copy all', { variant: 'primary', size: '' }), button('Download', { icon: 'download', onClick: () => download('﻿'.slice(s.format === 'csv' ? 0 : 1) + text, `${scan.name}-files.${ext}`, 'text/plain;charset=utf-8') })))), prog.el)
  form.hidden = true
  root.append(h('div', { class: 'stack fx' }, zone, form, out))
  onCleanup(() => ctl?.abort())

  let drawToken = 0
  async function draw() {
    if (!scan) return
    const my = ++drawToken
    const cols = COLUMNS.map(([k]) => k).filter((k) => colBoxes[k].input.checked)
    const wantSha = colBoxes.sha256.input.checked && ['csv', 'json', 'md'].includes(s.format)
    let entries = scan.entries.filter((e) => (s.hidden || !e.path.split('/').some((p) => p.startsWith('.'))) && (s.junk || !e.path.split('/').some((p) => p === 'node_modules' || p === '.git')))
    const by = { path: (a, b) => naturalCompare(a.path, b.path), size: (a, b) => b.size - a.size, date: (a, b) => b.mtime - a.mtime, name: (a, b) => naturalCompare(a.name, b.name) }[s.sort]
    entries = [...entries].sort(by)
    if (wantSha) {
      ctl?.abort()
      const mine = (ctl = new AbortController())
      try {
        let n = 0
        for (const e of entries) {
          if (!hashes.has(e)) hashes.set(e, (await hashBlob(e.file, ['sha256'], { signal: mine.signal })).sha256)
          if (++n % 5 === 0) prog.set(n / entries.length, `Fingerprinting ${n.toLocaleString()} of ${entries.length.toLocaleString()} files`)
        }
        prog.hide()
      } catch (err) { prog.hide(); if (err?.code === 'ABORT') return; return clear(out, alert('error', errorMessage(err))) }
      if (mine.signal.aborted || my !== drawToken) return
    } else { ctl?.abort(); prog.hide() }
    if (my !== drawToken) return
    clear(out)
    const rows = entries.map((e) => ({ path: e.path, name: e.name, folder: e.dir, ext: extOf(e.name), kind: kindOfName(e.name), size: e.size, modified: fmtDateTime(e.mtime, true), sha256: hashes.get(e) || '' }))
    const useCols = cols.length ? cols : ['path']
    if (s.format === 'csv') { text = toCsv(rows, useCols); ext = 'csv' }
    else if (s.format === 'json') { text = toJson(rows, useCols); ext = 'json' }
    else if (s.format === 'md') { text = toMarkdown(rows, useCols); ext = 'md' }
    else if (s.format === 'tree') { text = toTree(scan.name, rows, { withSize: s.withSize }); ext = 'txt' }
    else { text = rows.map((r) => r.path).join('\n') + '\n'; ext = 'txt' }
    colsEl.hidden = !['csv', 'json', 'md'].includes(s.format)
    sizeInTree.hidden = s.format !== 'tree'
    area.value = text.length > SHOW ? text.slice(0, SHOW) : text
    note.textContent = text.length > SHOW ? `Showing the first ${SHOW.toLocaleString()} of ${text.length.toLocaleString()} characters. Copy and Download use the whole list.` : ''
    const total = entries.reduce((a, e) => a + e.size, 0)
    clear(statsEl, stats([{ label: 'Files listed', value: entries.length.toLocaleString(), accent: true }, { label: 'Folders', value: new Set(entries.map((e) => e.dir).filter(Boolean)).size.toLocaleString() }, { label: 'Total size', value: formatBytes(total) }]))
  }
}
