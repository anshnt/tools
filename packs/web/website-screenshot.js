// Website screenshot (viewport or full page, params.full) through the free Microlink API. Download, copy or open the image.
import { h, icon, button, alert, clear, toggle, select, number, segmented, download, toast, onCleanup, formatBytes, field } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { ensureStyle, pill, note, chipGroup, omnibar, microlink, quotaNote, parseWebUrl, recents, recentChips, skeleton, hashParam, setHashParams, slug, copyImage } from './_shared.js'

export const DEVICES = {
  desktop: { label: 'Desktop', w: 1280, h: 800, ic: 'monitor' },
  laptop: { label: 'Laptop', w: 1440, h: 900, ic: 'laptop' },
  tablet: { label: 'Tablet', w: 768, h: 1024, ic: 'tablet', mobile: true },
  phone: { label: 'Phone', w: 390, h: 844, ic: 'smartphone', mobile: true },
  custom: { label: 'Custom', ic: 'ruler' },
}

/** Build the Microlink query for the chosen options. Pure. */
export function buildParams(url, o) {
  const d = DEVICES[o.device]
  const w = d.w || o.w, hh = d.h || o.h
  const p = { url, screenshot: true, meta: false, 'viewport.width': w, 'viewport.height': hh, 'viewport.deviceScaleFactor': o.retina ? 2 : 1, adblock: o.adblock ? 'true' : 'false' }
  if (d.mobile) { p['viewport.isMobile'] = true; p['viewport.hasTouch'] = true }
  if (o.full) p['screenshot.fullPage'] = true
  if (o.format === 'jpeg') p['screenshot.type'] = 'jpeg'
  if (o.dark) p.colorScheme = 'dark'
  if (o.delay) p.waitForTimeout = o.delay * 1000
  return p
}

/** The clipboard only accepts PNG, so convert JPEG captures first. */
async function pngOf(b) {
  if (b.type === 'image/png') return b
  const bmp = await createImageBitmap(b)
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  c.getContext('2d').drawImage(bmp, 0, 0)
  return new Promise((res, rej) => c.toBlob((x) => (x ? res(x) : rej(new Error('encode failed'))), 'image/png'))
}

const CSS = `
.t-shot .frame { border: 1px solid var(--border); border-radius: 18px; overflow: hidden; background: var(--surface); box-shadow: var(--shadow); max-width: 100%; margin-inline: auto; }
.t-shot .frame .bar { display: flex; align-items: center; gap: 6px; padding: 10px 14px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.t-shot .frame .bar i { width: 10px; height: 10px; border-radius: 50%; background: var(--border-strong); }
.t-shot .frame .bar .u { margin-left: 10px; flex: 1; min-width: 0; font: 12px var(--mono); color: var(--muted); background: var(--surface); border-radius: 999px; padding: 4px 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--border); }
.t-shot .frame .view { max-height: 680px; overflow: auto; background: var(--checker); }
.t-shot .frame .view img { display: block; width: 100%; height: auto; }
.t-shot .frame.phone { max-width: 340px; border-radius: 30px; border-width: 6px; }
.t-shot .frame.phone .bar { justify-content: center; padding: 8px; } .t-shot .frame.phone .bar i, .t-shot .frame.phone .bar .u { display: none; }
.t-shot .frame.phone .bar::before { content: ""; width: 70px; height: 6px; border-radius: 999px; background: var(--border-strong); }
.t-shot .frame.tablet { max-width: 560px; }
.t-shot .shimmer { aspect-ratio: 16 / 10; }
.t-shot .opts { display: grid; gap: 14px; }
`

export function mount(root, { params, signal }) {
  ensureStyle()
  if (!document.getElementById('t-shot-style')) document.head.append(h('style', { id: 't-shot-style' }, CSS))
  const full = !!params.full
  const rec = recents(full ? 'fullshot' : 'shot', 8)
  const o = { device: 'desktop', w: 1280, h: 800, retina: false, dark: false, format: 'png', delay: 0, adblock: true, ...load('shot:opts', {}), full }
  o.full = full ? true : !!load('shot:full', false)
  const err = h('div'), out = h('div', { class: 'stack' })
  let blobUrl = null, blob = null
  let chipsRecent
  onCleanup(() => { if (blobUrl) URL.revokeObjectURL(blobUrl) })
  const persist = () => { save('shot:opts', { ...o, full: undefined }); if (!full) save('shot:full', o.full) }

  const devChips = chipGroup(Object.entries(DEVICES).map(([k, d]) => [k, d.label, d.ic, d.w ? `${d.w} x ${d.h}` : 'Choose your own size']), o.device, (v) => { o.device = v; customBox.hidden = v !== 'custom'; persist() }, { label: 'Device' })
  const wIn = number(o.w, { min: 200, max: 3840, step: 1, ariaLabel: 'Width in pixels', onInput: (n) => { if (n >= 200) { o.w = Math.min(3840, n); persist() } } })
  const hIn = number(o.h, { min: 200, max: 3000, step: 1, ariaLabel: 'Height in pixels', onInput: (n) => { if (n >= 200) { o.h = Math.min(3000, n); persist() } } })
  const customBox = h('div', { class: 'grid-2', hidden: o.device !== 'custom' }, field('Width (px)', wIn), field('Height (px)', hIn))
  const opts = h('section', { class: 'panel opts' },
    h('div', { class: 'wt-kicker' }, 'Capture options'), devChips, customBox,
    h('div', { class: 'row' },
      full ? pill('Whole page, top to bottom', 'accent', 'scroll') : toggle('Full page (scroll the whole page)', o.full, (c) => { o.full = c; persist() }),
      toggle('Dark mode', o.dark, (c) => { o.dark = c; persist() }), toggle('Sharper (2x)', o.retina, (c) => { o.retina = c; persist() }), toggle('Hide ads and cookie banners', o.adblock, (c) => { o.adblock = c; persist() })),
    h('div', { class: 'grid-2' }, field('Wait before capturing', select([['0', 'No wait'], ['1', '1 second'], ['3', '3 seconds'], ['6', '6 seconds']], String(o.delay), (v) => { o.delay = +v; persist() }), 'Gives animations and lazy images time to appear.'),
      field('Format', segmented([['png', 'PNG'], ['jpeg', 'JPEG (smaller)']], o.format, (v) => { o.format = v; persist() }, 'Image format'))))

  async function capture(raw) {
    clear(err)
    const u = parseWebUrl(raw)
    if (o.device === 'custom' && !(o.w >= 200 && o.h >= 200)) throw new Error('Width and height must be at least 200 pixels.')
    clear(out, h('div', { class: 'panel stack' }, h('div', { class: 'wt-skel shimmer' }), h('div', { class: 'small muted' }, `Loading ${u.hostname} in a real browser and taking the picture. This usually takes 5 to 20 seconds${o.full ? ', a little longer for full pages' : ''}.`)))
    let r
    try { r = await microlink(buildParams(u.href, o), { signal }) } catch (e) { clear(out); throw e }
    const shot = r.data.screenshot
    if (!shot?.url) { clear(out); throw new Error('The service did not return an image for that page. It may block automated visitors.') }
    let res
    try { res = await fetch(shot.url, { signal }) } catch { res = null }
    if (res?.ok) { const b = await res.blob(); if (blobUrl) URL.revokeObjectURL(blobUrl); blob = b; blobUrl = URL.createObjectURL(b) } else { blob = null; blobUrl = null }
    rec.add(u.href); chipsRecent.refresh(); setHashParams({ q: u.href })
    const src = blobUrl || shot.url
    const ext = (shot.type || o.format) === 'jpeg' || o.format === 'jpeg' ? 'jpg' : 'png'
    const fname = `screenshot-${slug(u.hostname + u.pathname, 40)}-${new Date().toISOString().slice(0, 10)}.${ext}`
    const d = DEVICES[o.device]
    const frameCls = ['frame', o.device === 'phone' ? 'phone' : o.device === 'tablet' ? 'tablet' : '']
    const dl = button('Download', { icon: 'download', variant: 'primary', onClick: async () => {
      if (blob) return download(blob, fname)
      try { const b = await (await fetch(shot.url)).blob(); download(b, fname) } catch { window.open(shot.url, '_blank', 'noopener'); toast('Opened the image in a new tab. Right-click it to save.', 'info') }
    } })
    clear(out,
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'wt-chips' }, pill(`${shot.width} x ${shot.height} px`, 'accent', 'image'), shot.size ? pill(formatBytes(shot.size)) : null, pill(d.label), o.dark ? pill('Dark mode') : null, o.full ? pill('Full page', '', 'scroll') : null, quotaNote(r.quota)),
        h('div', { class: 'row' }, dl, button('Copy image', { icon: 'copy', onClick: async () => { if (!blob) return toast('Open the image and copy it from there.', 'info'); try { copyImage(await pngOf(blob)) } catch { toast('This image is too large to copy. Use Download.', 'error') } } }),
          h('a', { class: 'btn btn-ghost btn-sm', href: shot.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), h('span', 'Open full size')))),
      h('div', { class: frameCls.filter(Boolean).join(' ') }, h('div', { class: 'bar' }, h('i'), h('i'), h('i'), h('div', { class: 'u' }, u.href)),
        h('div', { class: 'view' }, h('img', { src, alt: `Screenshot of ${u.hostname}`, width: shot.width, height: shot.height, onerror: (e) => e.target.replaceWith(h('div', { class: 'muted', style: 'padding:24px' }, 'The image could not be shown here. Use "Open full size".')) }))),
      shot.height > 6000 ? alert('info', 'This is a very tall page. Some apps cannot open images this large.') : null)
  }

  const omni = omnibar({ icon: 'camera', placeholder: 'https://example.com', label: 'Take screenshot', buttonIcon: 'camera', busyLabel: 'Capturing', errorTo: err, onSubmit: capture })
  chipsRecent = recentChips(rec, (v) => { omni.set(v); omni.run() }, { label: 'Recent', fmt: (v) => v.replace(/^https?:\/\//, '') })
  root.append(h('div', { class: 't-shot stack' }, omni.el, err, opts, chipsRecent, out,
    note('Pictures are taken by the free Microlink service (about 25 to 50 per day per network): it opens the address you enter in a real Chrome browser and returns the image. The page must be public, so logins and private networks will not work. The address is sent to Microlink.')))
  const q = hashParam('q')
  if (q) { omni.set(q); omni.run() }
}
