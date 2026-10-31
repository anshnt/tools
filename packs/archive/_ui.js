// Shared UI pieces for the archive tools: folder tree from archive entries, labels, styles. Files starting with "_" are never tools.
import { h, icon, formatBytes, button, alert } from '../../lib/ui.js'
import { injectStyle, useFx } from '../files/_ui.js'
import { cleanPath } from './_write.js'

export const FORMAT_NAMES = {
  zip: 'ZIP', '7z': '7z', rar: 'RAR', rar5: 'RAR 5', tar: 'TAR', gz: 'GZIP', gzip: 'GZIP', bz2: 'BZIP2', bzip2: 'BZIP2', xz: 'XZ', z: 'Z (compress)', zst: 'Zstandard',
  iso: 'ISO 9660', cab: 'CAB', lzh: 'LZH', cpio: 'CPIO', ar: 'AR', deb: 'DEB', rpm: 'RPM', xar: 'XAR', pkg: 'PKG', wim: 'WIM', arj: 'ARJ', dmg: 'DMG',
}
export const formatLabel = (arc) => {
  const f = String(arc.format || '').toLowerCase()
  const base = FORMAT_NAMES[f] || (f ? f.toUpperCase() : 'Archive')
  return /\.(tar\.|tgz|tbz|txz|tzst)/i.test(arc.name) && !/^TAR/.test(base) ? `TAR + ${base}` : base
}
const ARCHIVE_EXT = /\.(zip|zipx|jar|war|apk|aab|xpi|7z|rar|tar|tgz|tbz2?|txz|tzst|gz|bz2|xz|z|zst|iso|cab|lzh|lha|cpio|ar|deb|rpm|xar|pkg|wim|arj)$/i
export const looksLikeArchive = (name) => ARCHIVE_EXT.test(name)

/** Folder tree. Node: {name, path (as stored), dir, children: Map, size, files, date, entry?}. Returns {root, unsafe}. */
export function buildTree(entries) {
  const root = { name: '', path: '', dir: true, children: new Map(), size: 0, files: 0, date: null }
  let unsafe = 0
  for (const e of entries) {
    if (e.type !== 'file' && e.type !== 'dir' && e.type !== 'link') continue
    const clean = cleanPath(e.path)
    if (clean !== e.path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')) unsafe++
    const parts = clean.split('/').filter(Boolean)
    if (!parts.length) continue
    let node = root
    const chain = [root]
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1
      const dir = !last || e.type === 'dir'
      const key = parts[i] + (dir ? '/' : '')
      let c = node.children.get(key)
      if (!c) { c = { name: parts[i], path: parts.slice(0, i + 1).join('/'), dir, children: new Map(), size: 0, files: 0, date: null }; node.children.set(key, c) }
      node = c
      chain.push(c)
    }
    if (e.type !== 'dir') {
      node.entry = e
      node.date = e.date || null
      for (const n of chain) { n.size += e.size; n.files += e.type === 'file' ? 1 : 0 }
    } else if (!node.date) node.date = e.date || null
  }
  return { root, unsafe }
}
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
export const sortedKids = (node) => [...node.children.values()].sort((a, b) => (a.dir === b.dir ? collator.compare(a.name, b.name) : a.dir ? -1 : 1))
export function filesUnder(node, out = []) { if (!node.dir) out.push(node); for (const c of node.children.values()) filesUnder(c, out); return out }

export const fmtDate = (ms) => {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const CSS = `
.ax-tree { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); overflow: hidden; }
.ax-scroll { max-height: 560px; overflow: auto; }
.ax-r { display: grid; grid-template-columns: minmax(0, 1fr) 88px 132px auto; gap: 8px; align-items: center; padding: 4px 10px; border-top: 1px solid var(--border); font-size: 13.5px; min-height: 40px; }
.ax-r:first-child { border-top: 0; }
.ax-r.head { background: var(--surface-2); color: var(--muted); font: 600 12px var(--font, inherit); text-transform: uppercase; letter-spacing: .04em; position: sticky; top: 0; z-index: 1; }
.ax-r .nm { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ax-r .nm .t { overflow-wrap: anywhere; min-width: 0; }
.ax-r .nm .t.dir { font-weight: 600; }
.ax-r input[type=checkbox] { width: 17px; height: 17px; accent-color: var(--accent); margin: 0; flex: none; }
.ax-r .tg { display: inline-grid; place-items: center; width: 24px; height: 24px; flex: none; border: 0; background: transparent; color: var(--muted); border-radius: 8px; cursor: pointer; padding: 0; transition: transform .2s var(--ease); }
.ax-r .tg:hover { background: var(--surface-3); }
.ax-r .tg[aria-expanded=true] { transform: rotate(90deg); }
.ax-r .tg .icon { width: 16px; height: 16px; }
.ax-r .sp { width: 24px; flex: none; }
.ax-r .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-2); font-size: 12.5px; }
.ax-r .acts { display: flex; gap: 2px; justify-content: flex-end; }
.ax-r .acts button { border: 0; background: transparent; color: var(--muted); cursor: pointer; padding: 6px; border-radius: 8px; display: inline-grid; }
.ax-r .acts button:hover:not(:disabled) { color: var(--accent); background: var(--surface-3); }
.ax-r .acts button:disabled { opacity: .35; cursor: not-allowed; }
.ax-r .acts .icon { width: 16px; height: 16px; }
.ax-r.lock .t { color: var(--muted); }
.ax-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.ax-res { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.ax-res .nm { min-width: 0; overflow-wrap: anywhere; font-weight: 550; }
.ax-res .sz { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.ax-fmt { display: flex; flex-wrap: wrap; gap: 6px; }
@media (max-width: 640px) {
  .ax-r { grid-template-columns: minmax(0, 1fr) auto auto; gap: 4px; }
  .ax-r .n.d, .ax-r .n.p { display: none; }
  .ax-res { grid-template-columns: minmax(0, 1fr) auto; }
  .ax-res .sz { grid-column: 1; }
}
`
export const useAx = () => { useFx(); injectStyle('ax-archive', CSS) }

/** Password box shown when an archive is locked. onSubmit(password) may throw; the message is shown under the box. */
export function passwordPrompt({ message, onSubmit }) {
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'off', 'aria-label': 'Archive password', placeholder: 'Password', onkeydown: (e) => { if (e.key === 'Enter') go() } })
  const out = h('div')
  const btn = button('Unlock', { icon: 'lock-keyhole-open', variant: 'primary', onClick: () => go() })
  async function go() {
    if (!pw.value) { out.replaceChildren(alert('warn', 'Type the password first.')); return }
    btn.disabled = true
    out.replaceChildren()
    try { await onSubmit(pw.value) } catch (e) { out.replaceChildren(alert('error', e.message)); pw.select() } finally { btn.disabled = false }
  }
  const el = h('div', { class: 'stack' }, alert('warn', h('strong', 'Password protected. '), message || 'Type the password to open this archive. It never leaves your device.'),
    h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { style: 'flex:1;min-width:200px' }, pw), btn), out)
  setTimeout(() => pw.focus(), 50)
  return el
}

export const sizeText = (n) => formatBytes(n)
export { icon }
