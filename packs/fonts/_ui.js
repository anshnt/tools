// Small UI helpers shared by the font tools: scoped styles, a results list with ZIP download, and loading a font into the page for previews.
import { h, icon, clear, button, busy, downloadButton, download, formatBytes, alert, onCleanup, toast, errorMessage } from '../../lib/ui.js'
import { zip } from '../../lib/files.js'
import { writeSfnt } from './_sfnt.js'

const injected = new Set()
export function injectStyle(id, css) {
  if (injected.has(id) && document.getElementById(id)) return
  injected.add(id)
  document.head.append(h('style', { id }, css))
}

export const COMMON_CSS = `
.t-font .res-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.t-font .res { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.t-font .res .meta { flex: 1 1 200px; min-width: 0; }
.t-font .res .nm { font-weight: 600; overflow-wrap: anywhere; }
.t-font .res .sub { font-size: 12.5px; color: var(--muted); }
.t-font .res.err { border-color: var(--danger); }
.t-font .res .glyph { font-size: 26px; line-height: 1; min-width: 44px; text-align: center; }
.t-font .target-note { font-size: 13px; color: var(--muted); }
.t-font .samplebox { width: 100%; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); padding: 12px 14px; resize: vertical; }
`

/** A list of finished files: name, sizes, a download button each, and Download all (ZIP) when there are several. */
export function resultList({ zipName = 'fonts.zip', zipLabel = 'Download all (ZIP)' } = {}) {
  const ul = h('ul', { class: 'res-list' })
  const zipBtn = button(zipLabel, { icon: 'file-archive', variant: 'secondary' })
  const bar = h('div', { class: 'row', hidden: true }, zipBtn)
  const el = h('div', { class: 'stack' }, ul, bar)
  const files = []
  zipBtn.addEventListener('click', () => busy(zipBtn, async () => { download(await zip(files.map((f) => ({ name: f.name, data: f }))), zipName) }, 'Zipping'))
  return {
    el, files,
    clear() { clear(ul); files.length = 0; bar.hidden = true },
    add(file, { from, note, lead } = {}) {
      files.push(file)
      const pct = from ? ` (${Math.round((file.size / from) * 100)}%)` : ''
      ul.append(h('li', { class: 'res' }, lead || null,
        h('div', { class: 'meta' }, h('div', { class: 'nm' }, file.name), h('div', { class: 'sub' }, from ? `${formatBytes(from)} to ${formatBytes(file.size)}${pct}` : formatBytes(file.size), note ? ` · ${note}` : '')),
        downloadButton(file, file.name, 'Download', { size: 'sm' })))
      bar.hidden = files.length < 2
    },
    error(name, err) {
      ul.append(h('li', { class: 'res err' }, icon('circle-alert'), h('div', { class: 'meta' }, h('div', { class: 'nm' }, name), h('div', { class: 'sub' }, errorMessage(err)))))
    },
  }
}

let faceCount = 0
/**
 * Load a font into the page so it can be previewed. Returns {family, dispose}. The browser can read TTF, OTF, WOFF and WOFF2 directly;
 * EOT is rebuilt as a plain font first. Throws when the browser refuses the font file.
 */
export async function loadFace(bytes, source, tables) {
  const family = `tfont-${++faceCount}`
  const data = ['ttf', 'otf', 'woff', 'woff2'].includes(source) ? bytes : writeSfnt(tables)
  const face = new FontFace(family, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  try { await face.load() } catch { throw new Error('Your browser could not use this font for the preview, but it can still be converted.') }
  document.fonts.add(face)
  const dispose = () => document.fonts.delete(face)
  onCleanup(dispose)
  return { family, dispose }
}

export { h, icon, clear, button, busy, alert, toast, onCleanup }
