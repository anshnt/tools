// Font subsetter: keep only the characters you pick (typed text, Unicode blocks or code point lists) and save as WOFF2, WOFF or TTF/OTF.
// Uses the HarfBuzz subsetter (WebAssembly), so composite glyphs, kerning, ligatures and variable font data are handled properly.
import { h, dropzone, button, busy, alert, clear, field, input, select, toggle, stats, progress, download, downloadButton, formatBytes, formatNumber, debounce, textarea } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'
import { readFont, writeSfnt, writeWoff } from './_sfnt.js'
import { fontInfo, parseCmap } from './_info.js'
import { PRESETS, parseRanges, uplus } from './_blocks.js'
import { call } from './_run.js'
import { loadFace, injectStyle, COMMON_CSS } from './_ui.js'

/** Subset SFNT bytes to a set of code points. Returns SFNT bytes. */
export const subsetSfnt = (sfnt, opts, ctx) => call('subset', [sfnt, { ...opts, unicodes: [...opts.unicodes] }], ctx)

const CSS = `
.t-sub .presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px 14px; }
.t-sub .preview-out { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 14px 16px; font-size: 32px; line-height: 1.3; overflow-wrap: anywhere; }
`
const OUT = { woff2: 'WOFF2 (best for the web)', woff: 'WOFF', sfnt: 'TTF / OTF (same outlines as the original)' }

export function mount(root, { signal }) {
  injectStyle('t-font-common', COMMON_CSS)
  injectStyle('t-sub', CSS)
  const holder = h('div', { class: 'stack' })
  const zone = dropzone({ multiple: false, accept: '.ttf,.otf,.woff,.woff2,.eot', icon: 'scissors', label: 'Drop a font here or click to choose', hint: 'TTF, OTF, WOFF, WOFF2 or EOT. The subset is made on your device.', onFiles: ([f]) => open(f) })
  root.append(h('div', { class: 't-sub t-font stack' }, zone, holder))

  async function open(file) {
    clear(holder, h('div', { class: 'muted' }, 'Reading font...'))
    try {
      const font = await readFont(new Uint8Array(await file.arrayBuffer()))
      const sfnt = writeSfnt(font.tables)
      const info = fontInfo(font.tables)
      const cmap = parseCmap(font.tables.get('cmap'))
      if (!cmap.size) throw Object.assign(new Error('This font has no Unicode character map, so characters cannot be chosen.'), { userMessage: 'This font has no Unicode character map, so characters cannot be chosen.' })
      zone.classList.add('compact')
      build(file, font, sfnt, info, cmap)
    } catch (e) { console.error(e); clear(holder, alert('error', e.userMessage || e.message)) }
  }

  function build(file, font, sfnt, info, cmap) {
    const text = textarea({ rows: 3, placeholder: 'Paste the text your page uses. Every different character in it is kept.', 'aria-label': 'Characters to keep' })
    const ranges = input({ placeholder: 'U+0041-005A, U+00E9, 2022', 'aria-label': 'Unicode ranges' })
    const picked = new Set(['Basic Latin'])
    const presetBox = h('div', { class: 'presets' }, PRESETS.map(([name]) => toggle(name, picked.has(name), (on) => { on ? picked.add(name) : picked.delete(name); update() })))
    const layout = select([['default', 'Keep common features (recommended)'], ['all', 'Keep all features'], ['none', 'Remove layout features']], 'default')
    const out = select(Object.entries(OUT), 'woff2')
    const hinting = toggle('Keep hinting instructions (larger files)', false)
    const pin = info.fvar ? toggle('Freeze variable axes at their defaults (much smaller)', false) : null
    const summary = h('div', { class: 'stack' })
    const result = h('div', { class: 'stack' })
    const prog = progress('Subsetting')
    const go = button('Create subset', { icon: 'scissors', variant: 'primary', size: 'lg', block: true })
    let rangeError = ''

    function selection() {
      const set = new Set()
      for (const ch of text.value) set.add(ch.codePointAt(0))
      for (const [name, rs] of PRESETS) if (picked.has(name)) for (const [a, b] of rs) for (let c = a; c <= b; c++) set.add(c)
      rangeError = ''
      try { for (const c of parseRanges(ranges.value)) set.add(c) } catch (e) { rangeError = e.message }
      set.delete(0)
      return set
    }
    function update() {
      const sel = selection()
      const have = [...sel].filter((c) => cmap.has(c))
      const missing = [...sel].filter((c) => !cmap.has(c) && c > 0x20)
      const shown = missing.slice(0, 24).map((c) => (c > 0x20 && c !== 0x7f ? String.fromCodePoint(c) : uplus(c))).join(' ')
      clear(summary,
        stats([{ label: 'Characters chosen', value: formatNumber(sel.size, 0) }, { label: 'Found in this font', value: formatNumber(have.length, 0), accent: true }, { label: 'Font has', value: formatNumber(cmap.size, 0) }]),
        rangeError ? alert('error', rangeError) : null,
        missing.length && have.length ? alert('info', `${missing.length} chosen character${missing.length === 1 ? ' is' : 's are'} not in this font and will be skipped: ${shown}${missing.length > 24 ? ' ...' : ''}`) : null,
        !have.length ? alert('warn', 'None of the chosen characters exist in this font. Pick a block or paste some text.') : null)
      go.disabled = !have.length || !!rangeError
      return have
    }
    text.addEventListener('input', debounce(update, 150))
    ranges.addEventListener('input', debounce(update, 150))

    go.addEventListener('click', () => busy(go, async () => {
      const have = update()
      clear(result)
      prog.set(null, 'Subsetting')
      const t0 = performance.now()
      const sub = await subsetSfnt(sfnt, { unicodes: have, noHinting: !hinting.input.checked, layout: layout.value, pinAxes: !!pin?.input.checked }, { signal })
      let bytes, ext
      if (out.value === 'woff2') { prog.set(null, 'Compressing to WOFF2 (large fonts take a while)'); bytes = await call('woff2Compress', [sub], { signal }); ext = 'woff2' }
      else if (out.value === 'woff') { bytes = await writeWoff((await readFont(sub)).tables); ext = 'woff' }
      else { bytes = sub; ext = font.flavor === 'otf' ? 'otf' : 'ttf' }
      const name = `${baseName(file.name)}-subset.${ext}`
      const blob = new File([bytes], name, { type: { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' }[ext] })
      let face = null
      try { face = await loadFace(bytes, ext, (await readFont(sub)).tables) } catch { /* preview is optional */ }
      const kept = [...new Set(have)].map((c) => String.fromCodePoint(c))
      const sample = (text.value.trim() ? [...text.value].slice(0, 120).join('') : kept.filter((c) => c.trim()).slice(0, 80).join('')) || kept.join('')
      clear(result,
        alert('success', `Done in ${Math.max(1, Math.round((performance.now() - t0) / 100) / 10)} s.`),
        stats([{ label: 'Original', value: formatBytes(file.size) }, { label: 'Subset', value: formatBytes(blob.size), accent: true }, { label: 'Saved', value: `${Math.max(0, Math.round((1 - blob.size / file.size) * 100))}%` }]),
        face ? h('div', { class: 'preview-out', style: `font-family:'${face.family}',sans-serif`, 'aria-label': 'Preview using the subset font' }, sample) : null,
        h('div', { class: 'row' }, downloadButton(blob, name, `Download ${name}`)))
    }, { label: 'Subsetting', progress: prog, errorTo: result }))

    clear(holder,
      h('div', { class: 'panel stack' }, h('strong', info.fullName || info.family), h('div', { class: 'small muted' }, `${file.name} · ${formatBytes(file.size)} · ${formatNumber(info.maxp.numGlyphs, 0)} glyphs · ${cmap.size} characters`)),
      h('div', { class: 'panel stack' }, h('h2', 'Characters to keep'), field('Text', text), h('strong', { class: 'small' }, 'Unicode blocks'), presetBox, field('Code points or ranges', input.call ? ranges : ranges, 'Hexadecimal, separated by commas or spaces.')),
      summary,
      h('div', { class: 'panel stack' }, h('h2', 'Options'), field('Layout features (kerning, ligatures, ...)', layout), field('Save as', out), hinting, pin),
      go, prog.el, result)
    update()
  }
}
