// @font-face generator: turns fonts into WOFF2 and WOFF files plus the CSS that loads them, packaged as a ZIP. Local only.
import { h, dropzone, button, busy, alert, clear, field, input, select, toggle, progress, download, copyButton, panel } from '../../lib/ui.js'
import { baseName, safeName, zip } from '../../lib/files.js'
import { readFont, writeSfnt, writeWoff } from './_sfnt.js'
import { fontInfo } from './_info.js'
import { call } from './_run.js'
import { injectStyle, COMMON_CSS } from './_ui.js'

const CSS = `
.t-ffg .frow { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto; gap: 10px; align-items: end; padding: 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
.t-ffg .frow .fname { grid-column: 1 / -1; font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
@media (max-width: 640px) { .t-ffg .frow { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
`
const WEIGHTS = [[100, '100 Thin'], [200, '200 Extra Light'], [300, '300 Light'], [400, '400 Regular'], [500, '500 Medium'], [600, '600 Semi Bold'], [700, '700 Bold'], [800, '800 Extra Bold'], [900, '900 Black']]
const q = (s) => `'${s.replace(/['\\]/g, '\\$&')}'`
const fmt = (n) => String(Math.round(n * 100) / 100)

/** Build the CSS text for a list of {family, weight ('400' or '100 900'), style, stretch?, files: [{path, format}]}. */
export function fontFaceCss(items, { display = 'swap' } = {}) {
  return items.map((it) => [
    '@font-face {',
    `  font-family: ${q(it.family)};`,
    `  src: ${it.files.map((f) => `url(${q(f.path)}) format(${q(f.format)})`).join(',\n       ')};`,
    `  font-weight: ${it.weight};`,
    `  font-style: ${it.style};`,
    it.stretch ? `  font-stretch: ${it.stretch};` : null,
    `  font-display: ${display};`,
    '}',
  ].filter(Boolean).join('\n')).join('\n\n') + '\n'
}

export function mount(root, { signal }) {
  injectStyle('t-font-common', COMMON_CSS)
  injectStyle('t-ffg', CSS)
  const rows = [] // {file, font, info, family, weight, style, wght, wdth}
  const list = h('div', { class: 'stack' })
  const css = h('pre', { class: 'code-out', 'aria-label': 'Generated CSS', style: 'white-space:pre-wrap;overflow-wrap:anywhere;margin:0' })
  const folder = input({ value: 'fonts/', 'aria-label': 'Font folder in the CSS' })
  const display = select([['swap', 'swap (show text right away)'], ['fallback', 'fallback'], ['optional', 'optional'], ['block', 'block'], ['auto', 'auto']], 'swap', () => refresh())
  const withWoff = toggle('Also make WOFF (for older browsers)', true, () => refresh())
  const prog = progress('Building fonts')
  const go = button('Download ZIP (fonts and CSS)', { icon: 'file-archive', variant: 'primary', size: 'lg', block: true })
  const out = h('div', { class: 'stack' })
  const work = h('div', { class: 'stack', hidden: true }, list,
    panel(h('div', { class: 'stack' }, h('div', { class: 'row' }, field('Font folder in the CSS', folder, 'Where the font files will live next to your CSS.'), field('font-display', display)), withWoff)),
    h('div', { class: 'panel stack' }, h('h2', 'CSS'), css, h('div', { class: 'row' }, copyButton(() => css.textContent, 'Copy CSS'))), go, prog.el, out)
  const zone = dropzone({ multiple: true, accept: '.ttf,.otf,.woff,.woff2,.eot', icon: 'file-code', label: 'Drop fonts here or click to choose', hint: 'TTF, OTF, WOFF, WOFF2 or EOT. Add all weights and styles of a family together.', onFiles: addFiles })
  root.append(h('div', { class: 't-ffg t-font stack' }, zone, work, h('p', { class: 'small muted' }, 'Everything is converted on your device. Fonts are never uploaded.')))
  folder.addEventListener('input', () => refresh())

  async function addFiles(files) {
    for (const file of files) {
      try {
        const font = await readFont(new Uint8Array(await file.arrayBuffer()))
        const info = fontInfo(font.tables)
        const wght = info.fvar?.axes.find((a) => a.tag === 'wght'), wdth = info.fvar?.axes.find((a) => a.tag === 'wdth')
        const range = wght ? `${fmt(wght.min)} ${fmt(wght.max)}` : ''
        const r = {
          file, font, info, wght, wdth,
          family: input({ value: info.family, 'aria-label': `Family name for ${file.name}`, oninput: () => refresh() }),
          weight: select(wght ? [[range, `${fmt(wght.min)} to ${fmt(wght.max)} (variable)`]] : WEIGHTS, wght ? range : String(Math.min(900, Math.max(100, Math.round(info.weight / 100) * 100)) || 400), () => refresh()),
          style: select([['normal', 'normal'], ['italic', 'italic']], info.italic ? 'italic' : 'normal', () => refresh()),
        }
        rows.push(r)
        const el = h('div', { class: 'frow' },
          field('Family', r.family), field('Weight', r.weight), field('Style', r.style),
          button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${file.name}`, onClick: () => { rows.splice(rows.indexOf(r), 1); el.remove(); refresh() } }),
          h('div', { class: 'fname' }, `${file.name} · ${font.source.toUpperCase()}${info.fvar ? ' · variable font' : ''}`))
        list.append(el)
      } catch (e) { console.error(e); list.append(alert('error', `${file.name}: ${e.userMessage || e.message}`)) }
    }
    refresh()
  }

  function names() {
    const used = new Set()
    return rows.map((r) => {
      const base = safeName(baseName(r.file.name)).replace(/\s+/g, '-')
      let n = base, i = 2
      while (used.has(n)) n = `${base}-${i++}`
      used.add(n)
      return n
    })
  }
  const dir = () => { const f = folder.value.trim().replace(/^\.?\//, ''); return f && !f.endsWith('/') ? f + '/' : f }
  function items() {
    const nm = names()
    return rows.map((r, i) => ({
      family: r.family.value.trim() || r.info.family, weight: r.weight.value, style: r.style.value,
      stretch: r.wdth ? `${fmt(r.wdth.min)}% ${fmt(r.wdth.max)}%` : null,
      files: [{ path: `${dir()}${nm[i]}.woff2`, format: 'woff2' }, ...(withWoff.input.checked ? [{ path: `${dir()}${nm[i]}.woff`, format: 'woff' }] : [])],
    }))
  }
  function refresh() {
    work.hidden = !rows.length
    css.textContent = fontFaceCss(items(), { display: display.value })
  }

  go.addEventListener('click', () => busy(go, async () => {
    const nm = names(), entries = []
    clear(out)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      prog.set(i / rows.length, `Compressing ${r.file.name} (WOFF2 can take a moment)`)
      const sfnt = writeSfnt(r.font.tables)
      entries.push({ name: `${dir()}${nm[i]}.woff2`, data: await call('woff2Compress', [sfnt], { signal }) })
      if (withWoff.input.checked) entries.push({ name: `${dir()}${nm[i]}.woff`, data: await writeWoff(r.font.tables) })
    }
    entries.push({ name: 'fonts.css', data: css.textContent })
    download(await zip(entries), 'webfonts.zip')
    clear(out, alert('success', `Saved webfonts.zip with ${rows.length} font${rows.length === 1 ? '' : 's'}${withWoff.input.checked ? ' as WOFF2 and WOFF' : ' as WOFF2'} and fonts.css.`))
  }, { label: 'Building', progress: prog, errorTo: out }))
}
