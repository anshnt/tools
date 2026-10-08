// Favicon generator: favicon.ico (16/32/48), PNG sizes, apple-touch-icon, Android icons, site.webmanifest and the HTML snippet, as one ZIP.
import { toggle, input as textInput } from '../../lib/ui.js'
import { canvas } from '../../lib/image.js'
import { zip } from '../../lib/files.js'
import {
  shell, h, icon, button, busy, field, chips, section, note, slider, colorField, imageSlot, resample, clear, toast, download, copyText, rasterSvg,
  svgSize, isSvg,
} from './_kit.js'
import { encodeIco } from './_encode.js'
import { toBlob } from '../../lib/image.js'

/** One icon: the artwork contained in a square with padding, optional rounded or circle clip and background. */
export function renderIcon(art, size, { padding = 0.08, shape = 'square', bg = 'transparent', opaque = false } = {}) {
  const c = canvas(size, size)
  const ctx = c.getContext('2d')
  ctx.save()
  if (!opaque && shape !== 'square') {
    ctx.beginPath()
    if (shape === 'circle') ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    else ctx.roundRect(0, 0, size, size, size * 0.22)
    ctx.clip()
  }
  if (bg !== 'transparent' || opaque) { ctx.fillStyle = bg !== 'transparent' ? bg : '#ffffff'; ctx.fillRect(0, 0, size, size) }
  const inner = size * (1 - 2 * padding)
  const k = Math.min(inner / art.width, inner / art.height)
  const dw = Math.max(1, Math.round(art.width * k)), dh = Math.max(1, Math.round(art.height * k))
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(resample(art, dw, dh), Math.round((size - dw) / 2), Math.round((size - dh) / 2))
  ctx.restore()
  return c
}

export function manifest({ name, shortName, theme, bg, maskable }) {
  const icons = [{ src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }]
  if (maskable) icons.push({ src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' })
  return JSON.stringify({ name, short_name: shortName, icons, theme_color: theme, background_color: bg, display: 'standalone' }, null, 2)
}

export function htmlSnippet({ svg, theme }) {
  return [svg ? '<link rel="icon" type="image/svg+xml" href="/favicon.svg">' : null,
    '<link rel="icon" href="/favicon.ico" sizes="48x48">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
    `<meta name="theme-color" content="${theme}">`].filter(Boolean).join('\n')
}

export function mount(root) {
  const o = { padding: 8, shape: 'square', bg: 'transparent', appBg: '#ffffff', theme: '#5b4cf0', name: 'My Website', short: 'Site', maskable: true }
  let art = null, svgText = null, srcName = 'icon'
  const pad = slider('Padding', { min: 0, max: 30, value: 8, format: (v) => `${v}%`, onInput: (v) => { o.padding = v; paint() } })
  const shape = chips([['square', 'Square', 'square'], ['rounded', 'Rounded', 'app-window'], ['circle', 'Circle', 'circle']], 'square', (v) => { o.shape = v; paint() }, { label: 'Shape' })
  const bg = colorField('Background', 'transparent', (v) => { o.bg = v; paint() }, { swatches: ['#ffffff', '#000000', '#5b4cf0', '#f97316'], none: true })
  const appBg = colorField('Apple icon background', '#ffffff', (v) => { o.appBg = v; paint() }, { swatches: ['#ffffff', '#000000', '#5b4cf0'] })
  const theme = colorField('Theme color', '#5b4cf0', (v) => { o.theme = v; paint() }, { swatches: ['#5b4cf0', '#111827', '#ffffff', '#16a34a'] })
  const name = textInput({ value: o.name, 'aria-label': 'App name', oninput: (e) => { o.name = e.target.value; paint() } })
  const short = textInput({ value: o.short, 'aria-label': 'Short name', oninput: (e) => { o.short = e.target.value; paint() } })
  const maskT = toggle('Also make a maskable Android icon', true, (v) => { o.maskable = v; paint() })

  const tabMock = h('div', { class: 'ie-tabmock' })
  const phones = h('div', { class: 'ie-phones' })
  const sizeRow = h('div', { class: 'ie-sizes' })
  const code = h('pre', { class: 'code-out', tabindex: 0, 'aria-label': 'HTML to paste in your head tag' })

  const icons = () => {
    const base = { padding: o.padding / 100, shape: o.shape, bg: o.bg }
    return {
      16: renderIcon(art, 16, base), 32: renderIcon(art, 32, base), 48: renderIcon(art, 48, base), 180: renderIcon(art, 180, { padding: Math.max(o.padding, 8) / 100, bg: o.appBg, opaque: true }),
      192: renderIcon(art, 192, base), 512: renderIcon(art, 512, base), 256: renderIcon(art, 256, base),
      mask: renderIcon(art, 512, { padding: 0.2, bg: o.bg !== 'transparent' ? o.bg : o.appBg, opaque: true }),
    }
  }
  function paint() {
    if (!art) return
    const ic = icons()
    const clone = (c, px) => { const n = h('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); n.style.width = n.style.height = `${px}px`; n.setAttribute('aria-hidden', 'true'); return n }
    clear(tabMock, h('div', { class: 'ie-tab' }, clone(ic[32], 16), h('span', o.name || 'My Website'), icon('x')), h('div', { class: 'ie-tab ghost' }, h('span', 'New tab')))
    clear(phones,
      h('div', { class: 'ie-phone' }, h('div', { class: 'ie-ios' }, clone(ic[180], 60)), h('span', o.short || 'Site')),
      h('div', { class: 'ie-phone' }, h('div', { class: 'ie-and' }, clone(o.maskable ? ic.mask : ic[192], 56)), h('span', 'Android')),
      h('div', { class: 'ie-phone' }, h('div', { class: 'ie-win' }, clone(ic[48], 48)), h('span', 'Desktop')))
    clear(sizeRow, [[16, '16'], [32, '32'], [48, '48'], [180, '180 apple'], [192, '192'], [512, '512']].map(([k, l]) => h('div', { class: 'ie-size' }, clone(ic[k], Math.min(k, 96)), h('span', `${l}`))))
    code.textContent = htmlSnippet({ svg: !!svgText, theme: o.theme })
  }

  async function build() {
    const ic = icons()
    const png = (c) => toBlob(c, 'image/png')
    const files = [
      { name: 'favicon.ico', data: await encodeIco(ic[256], [16, 32, 48], 'contain') },
      { name: 'favicon-16x16.png', data: await png(ic[16]) }, { name: 'favicon-32x32.png', data: await png(ic[32]) },
      { name: 'apple-touch-icon.png', data: await png(ic[180]) },
      { name: 'android-chrome-192x192.png', data: await png(ic[192]) }, { name: 'android-chrome-512x512.png', data: await png(ic[512]) },
    ]
    if (o.maskable) files.push({ name: 'maskable-icon-512x512.png', data: await png(ic.mask) })
    files.push({ name: 'site.webmanifest', data: manifest({ name: o.name, shortName: o.short, theme: o.theme, bg: o.appBg, maskable: o.maskable }) })
    if (svgText) files.push({ name: 'favicon.svg', data: svgText })
    files.push({ name: 'favicon-snippet.html', data: `<!-- Paste inside <head>. Upload the files to your site root. -->\n${htmlSnippet({ svg: !!svgText, theme: o.theme })}\n` })
    return files
  }
  const zipBtn = button('Download all (ZIP)', { icon: 'archive', variant: 'primary', size: 'lg', block: true })
  zipBtn.addEventListener('click', () => busy(zipBtn, async () => { download(await zip(await build()), 'favicons.zip') }, { label: 'Packing' }))
  const icoBtn = button('Only favicon.ico', { icon: 'download', block: true, onClick: () => busy(icoBtn, async () => { download(await encodeIco(icons()[256], [16, 32, 48], 'contain'), 'favicon.ico') }, { label: 'Saving' }) })

  const slot = imageSlot({
    ic: 'app-window', formats: ['PNG', 'SVG', 'JPG', 'WebP'], label: 'Drop your logo here or click to choose',
    onImage: async (s) => {
      srcName = s.name
      if (isSvg(s.file)) {
        svgText = await s.file.text()
        const info = svgSize(svgText)
        const k = 1024 / Math.max(info.w, info.h)
        art = await rasterSvg(svgText, Math.round(info.w * k), Math.round(info.h * k), info)
      } else {
        svgText = null
        const k = Math.min(1, 1024 / Math.max(s.w, s.h))
        art = resample(s.img, Math.round(s.w * k), Math.round(s.h * k))
      }
      if (Math.abs(s.w / s.h - 1) > 0.05) toast('Your image is not square. It will be centered with space around it.', 'info')
      work.hidden = false
      paint()
    },
    onClear: () => { art = null; work.hidden = true },
  })

  const style = h('style', `
.ie-tabmock{display:flex;gap:4px;padding:10px 10px 0;border-radius:14px 14px 0 0;background:var(--surface-3);align-items:flex-end}
.ie-tab{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:12px 12px 0 0;background:var(--surface);font-size:13px;min-width:150px;max-width:220px;box-shadow:0 -2px 10px -6px rgba(0,0,0,.3)}
.ie-tab span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ie-tab .icon{width:14px;height:14px;color:var(--muted)}.ie-tab.ghost{background:transparent;box-shadow:none;color:var(--muted)}
.ie-tab canvas{image-rendering:auto;flex:none}
.ie-phones{display:flex;gap:26px;flex-wrap:wrap;justify-content:center;padding:22px;border-radius:20px;background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 22%,var(--surface-2)),color-mix(in srgb,var(--c,#ec4899) 20%,var(--surface-2)))}
.ie-phone{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:12px;color:var(--text-2);font-weight:600}
.ie-ios canvas{border-radius:22%;display:block;box-shadow:0 10px 20px -8px rgba(0,0,0,.5)}.ie-and canvas{border-radius:50%;display:block;box-shadow:0 10px 20px -8px rgba(0,0,0,.5)}
.ie-win canvas{display:block;border-radius:6px;box-shadow:0 10px 20px -8px rgba(0,0,0,.4)}
.ie-sizes{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}.ie-size{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11.5px;color:var(--muted)}
.ie-size canvas{background:var(--checker);border-radius:6px;display:block;border:1px solid var(--border)}`)
  const side = h('aside', { class: 'ie-side ie-glass' },
    section('Style', 'palette', shape, pad, bg, appBg),
    section('Your site', 'globe', field('Site name', name), field('Short name', short), theme, maskT),
    h('div', { class: 'ie-foot' }, zipBtn, icoBtn))
  const work = h('div', { class: 'ie-work', hidden: true }, h('div', { class: 'ie-main' },
    section('Browser tab', 'app-window', tabMock),
    section('Home screens', 'smartphone', phones),
    section('Every size', 'layout-grid', sizeRow),
    section('Paste this in your <head>', 'code', code, h('div', { class: 'row' }, button('Copy HTML', { icon: 'copy', size: 'sm', onClick: () => copyText(code.textContent) }))),
    note('The ZIP holds favicon.ico, PNGs at 16, 32, 180, 192 and 512 px, site.webmanifest and the snippet above. Upload them to your site root.')), side)
  root.append(shell(style, slot.el, work))
}
