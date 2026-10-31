// Font viewer and character map: type tester, glyph grid, names, metrics, OpenType features, Unicode coverage and variable axes. Local only.
// Also serves the focused "Character map" entry (params.tab = 'chars').
import { h, dropzone, button, alert, clear, field, input, select, rangeField, toggle, segmented, tabs, stats, table, copyButton, formatBytes, formatNumber } from '../../lib/ui.js'
import { readFont } from './_sfnt.js'
import { fontInfo, parseCmap, featureLabel, DEFAULT_ON, weightName, widthName, embeddingText, fontDate, NAME_IDS } from './_info.js'
import { BLOCKS, groupByBlock, uplus, hex } from './_blocks.js'
import { loadFace, injectStyle, COMMON_CSS } from './_ui.js'
import { loadOpentype } from './_engine.js'

const CSS = `
.t-view .v-file { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 14px 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
.t-view .v-file .big { font-size: 40px; line-height: 1; min-width: 56px; text-align: center; }
.t-view .v-file .info { flex: 1 1 220px; min-width: 0; }
.t-view .v-file .name { font-weight: 650; font-size: 17px; overflow-wrap: anywhere; }
.t-view .v-file .sub { color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
.t-view .v-sample { width: 100%; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--text); padding: 14px 16px; resize: vertical; min-height: 120px; line-height: 1.25; overflow-wrap: anywhere; }
.t-view .v-water > div { padding: 6px 0; border-bottom: 1px dashed var(--border); overflow-wrap: anywhere; display: flex; gap: 12px; align-items: baseline; }
.t-view .v-water small { color: var(--muted); font-size: 11px; min-width: 38px; flex: none; font-variant-numeric: tabular-nums; }
.t-view .v-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 6px; }
.t-view .v-cell { aspect-ratio: 1 / 1; min-width: 0; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--text); cursor: pointer; display: grid; grid-template-rows: 1fr auto; place-items: center; padding: 4px 2px 3px; transition: border-color .15s, transform .15s; }
.t-view .v-cell:hover, .t-view .v-cell:focus-visible { border-color: var(--accent); transform: translateY(-1px); }
.t-view .v-cell .g { font-size: 28px; line-height: 1; max-width: 100%; overflow: hidden; }
.t-view .v-cell small { font: 10px ui-monospace, monospace; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-view .v-cell svg { width: 70%; height: 70%; fill: currentColor; }
.t-view .v-detail { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
.t-view .v-detail .huge { font-size: 72px; line-height: 1; min-width: 90px; text-align: center; }
.t-view .v-detail .facts { display: grid; gap: 4px; font-size: 13px; min-width: 0; }
.t-view .v-detail code { font: 12.5px ui-monospace, monospace; background: var(--surface-2); padding: 1px 6px; border-radius: 6px; }
.t-view .v-bar { height: 8px; border-radius: 6px; background: var(--surface-2); overflow: hidden; min-width: 80px; }
.t-view .v-bar i { display: block; height: 100%; background: var(--accent); }
.t-view .v-feat { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 14px; }
.t-view .tagchip { display: inline-block; font: 12px ui-monospace, monospace; padding: 2px 8px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--border); margin: 0 6px 6px 0; }
.t-view .pager { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
`

const PANGRAM = 'The quick brown fox jumps over the lazy dog. 0123456789'
const SIZES = [12, 14, 16, 18, 24, 36, 48, 72]
const cssChar = (cp) => (/\p{M}/u.test(String.fromCodePoint(cp)) ? '◌' + String.fromCodePoint(cp) : String.fromCodePoint(cp))
const utf8Hex = (cp) => [...new TextEncoder().encode(String.fromCodePoint(cp))].map((b) => hex(b, 2)).join(' ')
const date = (secs) => { const d = fontDate(secs); return d ? d.toISOString().slice(0, 10) : '-' }

export function mount(root, { params }) {
  injectStyle('t-font-common', COMMON_CSS)
  injectStyle('t-view', CSS)
  const holder = h('div', { class: 'stack' })
  let current = null
  const zone = dropzone({
    multiple: false, accept: '.ttf,.otf,.woff,.woff2,.eot', icon: 'type', label: 'Drop a font here or click to choose', hint: 'TTF, OTF, WOFF, WOFF2 or EOT. Nothing is uploaded.',
    onFiles: ([f]) => open(f),
  })
  root.append(h('div', { class: 't-view t-font stack' }, zone, holder))

  async function open(file) {
    current?.face?.dispose()
    clear(holder, h('div', { class: 'muted' }, 'Reading font...'))
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const font = await readFont(bytes)
      const info = fontInfo(font.tables)
      const cmap = parseCmap(font.tables.get('cmap'))
      let face = null, faceError = ''
      try { face = await loadFace(bytes, font.source, font.tables) } catch (e) { faceError = e.message }
      current = { file, bytes, font, info, cmap, face, faceError }
      zone.classList.add('compact')
      render()
    } catch (e) {
      console.error(e)
      clear(holder, alert('error', e.userMessage || e.message || 'This file could not be read as a font.'))
    }
  }

  function render() {
    const { file, font, info, cmap, face, faceError } = current
    const style = face ? `font-family:'${face.family}',sans-serif` : ''
    const sampleGlyph = cmap.has(0x41) ? 'Aa' : String.fromCodePoint([...cmap.keys()].sort((a, b) => a - b).find((c) => c > 32) || 63)
    const header = h('div', { class: 'v-file' },
      h('div', { class: 'big', style }, sampleGlyph),
      h('div', { class: 'info' }, h('div', { class: 'name' }, info.fullName || info.family), h('div', { class: 'sub' }, `${file.name} · ${font.source.toUpperCase()} · ${formatBytes(file.size)} · ${info.isCff ? 'OpenType (CFF) outlines' : 'TrueType outlines'}${info.fvar ? ' · variable' : ''}`)))
    const tiles = stats([
      { label: 'Glyphs', value: formatNumber(info.maxp.numGlyphs, 0), accent: true }, { label: 'Characters', value: formatNumber(cmap.size, 0) },
      { label: 'Weight', value: info.os2 ? `${info.os2.weight} ${weightName(info.os2.weight)}` : '-' }, { label: 'Units per em', value: info.head ? String(info.head.unitsPerEm) : '-' },
    ])
    const items = [
      { id: 'preview', label: 'Preview', render: () => previewTab() }, { id: 'chars', label: 'Characters', render: () => charsTab() },
      { id: 'info', label: 'Names and metrics', render: () => infoTab() }, { id: 'features', label: 'Features', render: () => featuresTab() }, { id: 'coverage', label: 'Coverage', render: () => coverageTab() },
    ]
    clear(holder, header, faceError ? alert('warn', faceError) : null, tiles, tabs(items, params?.tab && items.some((t) => t.id === params.tab) ? params.tab : 'preview'))
  }

  // ---------- Preview ----------
  function sampleFor(cmap) {
    if (cmap.has(0x54) && cmap.has(0x61)) return PANGRAM
    const cps = [...cmap.keys()].filter((c) => c > 0x20 && !(c >= 0x7f && c <= 0xa0)).sort((a, b) => a - b)
    const groups = groupByBlock(cps).sort((a, b) => b.cps.length - a.cps.length)
    return String.fromCodePoint(...(groups[0]?.cps || [63]).slice(0, 48)) || PANGRAM
  }

  function previewTab() {
    const { info, cmap, face } = current
    if (!face) return alert('warn', 'The preview needs the browser to accept this font.')
    const st = { size: 56, axes: Object.fromEntries((info.fvar?.axes || []).map((a) => [a.tag, a.def])), off: new Set(), on: new Set() }
    const sample = h('textarea', { class: 'v-sample', value: sampleFor(cmap), rows: 3, spellcheck: false, 'aria-label': 'Sample text, editable' })
    const water = h('div', { class: 'v-water' })
    const axisBox = h('div', { class: 'stack' })
    const apply = () => {
      const feats = [...st.on].map((t) => `"${t}" 1`).concat([...st.off].map((t) => `"${t}" 0`)).join(', ')
      const va = info.fvar ? Object.entries(st.axes).map(([t, v]) => `"${t}" ${v}`).join(', ') : ''
      for (const el of [sample, water]) {
        el.style.fontFamily = `'${face.family}', sans-serif`
        el.style.fontFeatureSettings = feats || 'normal'
        el.style.fontVariationSettings = va || 'normal'
        el.style.fontWeight = 'normal'; el.style.fontStyle = 'normal'
      }
      sample.style.fontSize = `${st.size}px`
    }
    const renderWater = () => {
      clear(water, SIZES.map((s) => h('div', h('small', `${s}px`), h('span', { style: `font-size:${s}px` }, (sample.value.split('\n')[0] || ' ').slice(0, 90)))))
      apply()
    }
    sample.addEventListener('input', renderWater)
    const sizeCtl = rangeField('Size', { min: 8, max: 200, value: st.size, format: (v) => `${v}px`, onInput: (v) => { st.size = v; apply() } })

    const sliders = new Map()
    if (info.fvar) {
      for (const a of info.fvar.axes) {
        const ctl = rangeField(`${info.axisName(a)} (${a.tag})`, { min: a.min, max: a.max, step: a.max - a.min > 20 ? 1 : 0.01, value: a.def, format: (v) => String(Math.round(v * 100) / 100), onInput: (v) => { st.axes[a.tag] = v; apply() } })
        sliders.set(a.tag, ctl)
        axisBox.append(ctl)
      }
      if (info.fvar.instances.length) {
        axisBox.append(h('div', { class: 'row' }, info.fvar.instances.map((inst) => button(info.names.length ? (info.axisName({ nameId: inst.nameId, tag: 'Instance' })) : 'Instance', {
          size: 'sm', onClick: () => info.fvar.axes.forEach((a, i) => { st.axes[a.tag] = inst.coords[i]; sliders.get(a.tag).set(inst.coords[i]); apply() }),
        }))))
      }
    }
    const feats = [...new Set([...info.gsub.features, ...(info.gpos.features.includes('kern') ? ['kern'] : [])])].filter((t) => !['ccmp', 'locl', 'rlig', 'rclt', 'calt'].includes(t) || t === 'calt')
    const featBox = feats.length ? h('details', h('summary', `OpenType features (${feats.length})`), h('div', { class: 'v-feat', style: 'padding-top:10px' }, feats.map((t) => {
      const base = DEFAULT_ON.has(t)
      return toggle(`${t}${featureLabel(t) ? ' - ' + featureLabel(t) : ''}`, base, (on) => {
        st.on.delete(t); st.off.delete(t)
        if (on !== base) (on ? st.on : st.off).add(t)
        apply()
      })
    }))) : null
    const el = h('div', { class: 'stack' }, sample, h('div', { class: 'row' }, sizeCtl), axisBox.childElementCount ? h('div', { class: 'panel stack' }, h('strong', 'Variable font axes'), axisBox) : null, featBox, h('h3', { style: 'margin:6px 0 0' }, 'Sizes'), water)
    renderWater()
    return el
  }

  // ---------- Characters ----------
  function charsTab() {
    const { info, cmap, face, font } = current
    const groups = groupByBlock(cmap.keys())
    const PAGE = 256
    let gi = 0, off = 0, mode = 'chars', ot = null
    const blockSel = select(groups.map((g, i) => [i, `${g.block.name} (${g.cps.length})`]), 0, (v) => { gi = +v; off = 0; draw() })
    const search = input({ placeholder: 'Find: type a character or U+0041', 'aria-label': 'Find a character' })
    const grid = h('div', { class: 'v-grid' })
    const pager = h('div', { class: 'pager' })
    const detail = h('div', { class: 'v-detail' }, h('span', { class: 'muted' }, 'Click a character to see its details and add it to the text box below.'))
    const tray = h('textarea', { class: 'samplebox', rows: 2, placeholder: 'Clicked characters collect here', 'aria-label': 'Selected characters' })
    const fam = face ? `font-family:'${face.family}',sans-serif` : ''
    const gids = [...Array(info.maxp.numGlyphs).keys()]

    function pick(cp) {
      tray.value += String.fromCodePoint(cp)
      const ch = String.fromCodePoint(cp)
      const gid = cmap.get(cp)
      clear(detail,
        h('div', { class: 'huge', style: fam }, cssChar(cp)),
        h('div', { class: 'facts' },
          h('div', h('strong', uplus(cp)), ` · decimal ${cp} · glyph #${gid}`),
          h('div', 'HTML ', h('code', `&#x${hex(cp, 1)};`), '  CSS ', h('code', `\\${hex(cp, 1)}`), '  UTF-8 ', h('code', utf8Hex(cp))),
          h('div', { class: 'row' }, copyButton(ch, 'Copy character'), copyButton(uplus(cp), 'Copy U+code'), copyButton(`&#x${hex(cp, 1)};`, 'Copy HTML'))))
    }
    function glyphCell(gid) {
      const g = ot.glyphs.get(gid)
      const upm = info.head.unitsPerEm, asc = info.hhea?.ascender || upm * 0.8, desc = Math.abs(info.hhea?.descender || upm * 0.2)
      const d = g.path.toPathData(1)
      return h('div', { class: 'v-cell', title: g.name || `glyph ${gid}`, style: 'cursor:default' }, h('svg', { viewBox: `${-upm * 0.1} ${-asc * 1.05} ${upm * 1.2} ${(asc + desc) * 1.1}` }, h('path', { d, transform: 'scale(1,-1)' })), h('small', `#${gid}`))
    }
    async function draw() {
      if (mode === 'glyphs') {
        pager.hidden = false
        if (!ot) { clear(grid, h('div', { class: 'muted' }, 'Reading outlines...')); const { writeSfnt } = await import('./_sfnt.js'); ot = (await loadOpentype()).parse(writeSfnt(font.tables).slice().buffer) }
        const slice = gids.slice(off, off + PAGE)
        clear(grid, slice.map(glyphCell))
        pageInfo(gids.length)
        return
      }
      const g = groups[gi]
      const slice = g.cps.slice(off, off + PAGE)
      clear(grid, slice.map((cp) => h('button', { type: 'button', class: 'v-cell', title: uplus(cp), 'aria-label': `${uplus(cp)} ${String.fromCodePoint(cp)}`, onclick: () => pick(cp) }, h('span', { class: 'g', style: fam }, cssChar(cp)), h('small', hex(cp)))))
      pageInfo(g.cps.length)
    }
    function pageInfo(total) {
      clear(pager)
      if (total <= PAGE) return
      pager.append(button('Previous', { size: 'sm', icon: 'chevron-left', disabled: off === 0, onClick: () => { off = Math.max(0, off - PAGE); draw() } }),
        h('span', { class: 'small muted' }, `${off + 1}-${Math.min(total, off + PAGE)} of ${formatNumber(total, 0)}`),
        button('Next', { size: 'sm', icon: 'chevron-right', disabled: off + PAGE >= total, onClick: () => { off += PAGE; draw() } }))
    }
    search.addEventListener('input', () => {
      const q = search.value.trim()
      if (!q) return
      const m = q.match(/^(?:u\+|0x|\\u)([0-9a-f]{1,6})$/i)
      const cp = m ? parseInt(m[1], 16) : [...q][0].codePointAt(0)
      const gIdx = groups.findIndex((g) => g.cps.includes(cp))
      if (gIdx < 0) return
      gi = gIdx; blockSel.value = String(gi); off = Math.floor(groups[gi].cps.indexOf(cp) / PAGE) * PAGE
      mode = 'chars'; modeSeg.set('chars'); draw()
      const cell = grid.querySelector(`button[title="${uplus(cp)}"]`)
      cell?.focus()
    })
    const modeSeg = segmented([['chars', 'By character'], ['glyphs', 'All glyphs by number']], mode, (v) => { mode = v; off = 0; blockSel.parentElement.hidden = v === 'glyphs'; search.parentElement.hidden = v === 'glyphs'; draw() }, 'Grid mode')
    const el = h('div', { class: 'stack' },
      h('div', { class: 'row' }, modeSeg, field('Block', blockSel), field('Find', search)),
      grid, pager, h('div', { class: 'panel' }, detail),
      field('Selected text', tray), h('div', { class: 'row' }, copyButton(() => tray.value, 'Copy text'), button('Clear', { size: 'sm', onClick: () => { tray.value = '' } })))
    if (!groups.length) return alert('info', 'This font has no mapped Unicode characters. Use "All glyphs by number" to browse its glyphs.')
    draw()
    return el
  }

  // ---------- Names and metrics ----------
  function infoTab() {
    const { info, font } = current
    const { head, hhea, os2, post } = info
    const dash = (v) => (v == null || v === '' ? '-' : v)
    const tiles = stats([
      { label: 'Ascender / descender', value: hhea ? `${hhea.ascender} / ${hhea.descender}` : '-' }, { label: 'Line gap', value: dash(hhea?.lineGap) },
      { label: 'Typo ascender / descender', value: os2?.typoAscender != null ? `${os2.typoAscender} / ${os2.typoDescender}` : '-' }, { label: 'Win ascent / descent', value: os2?.winAscent != null ? `${os2.winAscent} / ${os2.winDescent}` : '-' },
      { label: 'x-height', value: dash(os2?.xHeight || null) }, { label: 'Cap height', value: dash(os2?.capHeight || null) },
      { label: 'Bounding box', value: head ? `${head.xMin}, ${head.yMin}, ${head.xMax}, ${head.yMax}` : '-' }, { label: 'Italic angle', value: post ? `${post.italicAngle}` : '-' },
      { label: 'Width class', value: os2 ? widthName(os2.width) : '-' }, { label: 'Monospaced', value: post ? (post.isFixedPitch ? 'Yes' : 'No') : '-' },
      { label: 'Vendor ID', value: dash(os2?.vendor) }, { label: 'Version', value: head ? String(Math.round(head.fontRevision * 1000) / 1000) : '-' },
      { label: 'Created', value: head ? date(head.created) : '-' }, { label: 'Modified', value: head ? date(head.modified) : '-' },
    ])
    const names = table({ columns: ['Name', 'Value', 'Platform'], rows: info.names.slice().sort((a, b) => a.id - b.id).map((r) => [NAME_IDS[r.id] || `ID ${r.id}`, h('span', { style: 'overflow-wrap:anywhere' }, r.value.length > 400 ? r.value.slice(0, 400) + '...' : r.value), `${{ 0: 'Unicode', 1: 'Mac', 3: 'Windows' }[r.platform] || r.platform} / ${r.lang}`]) })
    const tbl = table({ columns: ['Table', { label: 'Size', num: true }], rows: [...font.tables].sort((a, b) => a[0].localeCompare(b[0])).map(([t, d]) => [t, formatBytes(d.length)]) })
    return h('div', { class: 'stack' },
      os2 ? alert('info', `Embedding: ${embeddingText(os2.fsType)}. Check the license before you embed or convert a font.`) : null,
      tiles, h('h3', { style: 'margin:6px 0 0' }, 'Name table'), names, h('h3', { style: 'margin:6px 0 0' }, `Tables (${font.tables.size})`), tbl)
  }

  // ---------- Features ----------
  function featuresTab() {
    const { info } = current
    const chips = (tags) => h('div', tags.map((t) => h('span', { class: 'tagchip', title: featureLabel(t) || t }, featureLabel(t) ? `${t} · ${featureLabel(t)}` : t)))
    const none = h('p', { class: 'muted small' }, 'None')
    return h('div', { class: 'stack' },
      h('h3', { style: 'margin:0' }, 'Scripts'), info.gsub.scripts.length || info.gpos.scripts.length ? chips([...new Set([...info.gsub.scripts, ...info.gpos.scripts])]) : none,
      h('h3', { style: 'margin:6px 0 0' }, `Substitution features (GSUB, ${info.gsub.features.length})`), info.gsub.features.length ? chips(info.gsub.features) : none,
      h('h3', { style: 'margin:6px 0 0' }, `Positioning features (GPOS, ${info.gpos.features.length})`), info.gpos.features.length ? chips(info.gpos.features) : none,
      info.isColor.length ? h('div', [h('h3', { style: 'margin:6px 0' }, 'Color tables'), chips(info.isColor)]) : null,
      info.fvar ? h('div', { class: 'stack' }, h('h3', { style: 'margin:6px 0 0' }, 'Variable axes'),
        table({ columns: ['Axis', 'Tag', { label: 'Min', num: true }, { label: 'Default', num: true }, { label: 'Max', num: true }], rows: info.fvar.axes.map((a) => [info.axisName(a), a.tag, a.min, a.def, a.max]) }),
        info.fvar.instances.length ? table({ columns: ['Named instance', ...info.fvar.axes.map((a) => a.tag)], rows: info.fvar.instances.map((i) => [info.axisName({ nameId: i.nameId, tag: 'Instance' }), ...i.coords.map((c) => Math.round(c * 100) / 100)]) }) : null) : null)
  }

  // ---------- Coverage ----------
  function coverageTab() {
    const { cmap } = current
    const rows = BLOCKS.map((b) => {
      let n = 0
      for (const c of cmap.keys()) if (c >= b.start && c <= b.end) n++
      return { b, n, total: b.end - b.start + 1 }
    }).filter((r) => r.n)
    const covered = rows.reduce((a, r) => a + r.n, 0)
    const other = cmap.size - covered
    if (!rows.length && !other) return alert('info', 'No Unicode characters are mapped in this font.')
    return h('div', { class: 'stack' },
      h('p', { class: 'small muted' }, `${formatNumber(cmap.size, 0)} characters mapped${other > 0 ? `, ${formatNumber(other, 0)} outside the blocks listed here` : ''}.`),
      table({ columns: ['Block', 'Range', { label: 'Covered', num: true }, 'Share'], rows: rows.map(({ b, n, total }) => [b.name, `${uplus(b.start)}-${hex(b.end)}`, `${formatNumber(n, 0)} / ${formatNumber(total, 0)}`, h('div', { class: 'v-bar', title: `${Math.round((n / total) * 100)}%` }, h('i', { style: `width:${(n / total) * 100}%` }))]) }))
  }
}
