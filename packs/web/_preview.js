// Link and search previews (Google, X, Facebook, LinkedIn, WhatsApp) shared by url-metadata and meta-tag-generator.
// All colors come from CSS variables so they follow light and dark mode.
import { h, icon } from '../../lib/ui.js'
import { textWidth } from './_shared.js'

const CSS = `
.wt-pv { --pv-r: 14px; font-family: var(--font); color: var(--text); min-width: 0; }
.wt-pv img { display: block; width: 100%; height: 100%; object-fit: cover; }
.wt-pv .ph { display: grid; place-items: center; width: 100%; height: 100%; color: var(--muted); background: var(--surface-3); }
.wt-pv .ph .icon { width: 28px; height: 28px; opacity: .7; }
.wt-pv .ph small { display: block; margin-top: 4px; font-size: 12px; }
.wt-pv .img { background: var(--surface-3); overflow: hidden; position: relative; }
.wt-pv .clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.wt-pv .clamp1 { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wt-pv.serp { max-width: 600px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--pv-r); background: var(--surface); }
.wt-pv.serp.mobile { max-width: 390px; }
.wt-pv.serp .site { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; min-width: 0; }
.wt-pv.serp .fav { width: 26px; height: 26px; border-radius: 50%; background: var(--surface-3); display: grid; place-items: center; flex: none; overflow: hidden; border: 1px solid var(--border); }
.wt-pv.serp .fav img { width: 18px; height: 18px; object-fit: contain; }
.wt-pv.serp .fav .icon { width: 14px; height: 14px; color: var(--muted); }
.wt-pv.serp .sn { font-size: 14px; line-height: 1.3; min-width: 0; }
.wt-pv.serp .sn b { font-weight: 400; display: block; }
.wt-pv.serp .sn span { color: var(--muted); font-size: 12px; display: block; }
.wt-pv.serp .t { font: 400 20px/1.3 Arial, sans-serif; color: var(--info); margin: 2px 0 4px; overflow-wrap: anywhere; }
.wt-pv.serp.mobile .t { font-size: 18px; }
.wt-pv.serp .d { font: 400 14px/1.58 Arial, sans-serif; color: var(--text-2); overflow-wrap: anywhere; }
.wt-pv.card { max-width: 520px; border: 1px solid var(--border); border-radius: var(--pv-r); overflow: hidden; background: var(--surface); }
.wt-pv.card .img { aspect-ratio: 1.91 / 1; }
.wt-pv.card .body { padding: 10px 14px 12px; display: grid; gap: 2px; min-width: 0; }
.wt-pv .dom { font-size: 12px; color: var(--muted); letter-spacing: .02em; }
.wt-pv .ttl { font-weight: 650; font-size: 15px; line-height: 1.3; }
.wt-pv .desc { font-size: 13.5px; color: var(--text-2); line-height: 1.4; }
.wt-pv.fb .body { background: var(--surface-2); border-top: 1px solid var(--border); }
.wt-pv.fb .dom { text-transform: uppercase; font-size: 11.5px; }
.wt-pv.x { border-radius: 16px; }
.wt-pv.x .body { padding: 8px 12px 10px; }
.wt-pv.x .dom { font-size: 13px; letter-spacing: 0; }
.wt-pv.x .ttl { font-weight: 500; font-size: 14.5px; }
.wt-pv.x .desc { font-size: 13.5px; }
.wt-pv.x.small { display: grid; grid-template-columns: 124px minmax(0, 1fr); }
.wt-pv.x.small .img { aspect-ratio: 1; height: 100%; }
.wt-pv.li .body { padding: 10px 14px 12px; }
.wt-pv.li .ttl { font-weight: 600; font-size: 14.5px; }
.wt-pv.li .dom { font-size: 12.5px; }
.wt-pv.wa { max-width: 400px; padding: 6px; border-radius: 4px 14px 14px 14px; background: #d9fdd3; color: #111b21; box-shadow: 0 1px 1px rgba(0,0,0,.12); }
:root[data-theme="dark"] .wt-pv.wa { background: #005c4b; color: #e9edef; }
.wt-pv.wa .inner { border-radius: 10px; overflow: hidden; background: rgba(0,0,0,.06); }
:root[data-theme="dark"] .wt-pv.wa .inner { background: rgba(0,0,0,.22); }
.wt-pv.wa .img { aspect-ratio: 1.91 / 1; }
.wt-pv.wa .body { padding: 8px 10px 9px; display: grid; gap: 2px; }
.wt-pv.wa .ttl { font-size: 14px; font-weight: 600; color: inherit; }
.wt-pv.wa .desc { font-size: 13px; color: inherit; opacity: .78; }
.wt-pv.wa .dom { color: inherit; opacity: .6; }
.wt-pv.wa .link { padding: 6px 4px 2px; font-size: 14px; color: #027eb5; overflow-wrap: anywhere; }
:root[data-theme="dark"] .wt-pv.wa .link { color: #53bdeb; }
.wt-pv.wa .link small { opacity: 0; }
`

export const PREVIEW_KINDS = [
  ['google', 'Google'],
  ['x', 'X / Twitter'],
  ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'],
  ['whatsapp', 'WhatsApp'],
]

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const crumbs = (u) => {
  try {
    const x = new URL(u)
    const parts = x.pathname.split('/').filter(Boolean)
    return [`${x.protocol}//${x.hostname}`, ...parts].join(' › ')
  } catch { return u || '' }
}

/** Cut text so it fits maxPx in the given font, adding an ellipsis. */
export function fitText(text, maxPx, font) {
  if (!text || textWidth(text, font) <= maxPx) return { text: text || '', cut: false }
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textWidth(text.slice(0, mid).trimEnd() + '…', font) <= maxPx) lo = mid
    else hi = mid - 1
  }
  return { text: text.slice(0, lo).trimEnd() + '…', cut: true }
}

function imageBox(src, cls = 'img') {
  const box = h('div', { class: cls })
  const placeholder = () => h('div', { class: 'ph' }, h('div', icon('image-off'), h('small', 'No image')))
  if (!src) { box.append(placeholder()); return box }
  let reserved = false
  try { reserved = /\.(example|test|invalid|localhost)$/i.test(new URL(src).hostname) } catch { /* ignore */ }
  if (reserved) { box.append(h('div', { class: 'ph', style: 'background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 22%,var(--surface-3)),color-mix(in srgb,var(--accent-2) 22%,var(--surface-3)))' }, h('div', icon('image'), h('small', 'Your share image')))); return box }
  const img = h('img', { src, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy', decoding: 'async' })
  img.onerror = () => { img.replaceWith(h('div', { class: 'ph' }, h('div', icon('image-off'), h('small', 'Image could not load')))) }
  box.append(img)
  return box
}

/**
 * previewCard(kind, {title, description, image, url, siteName, favicon, large, mobile})
 * kind: 'google' | 'x' | 'facebook' | 'linkedin' | 'whatsapp'
 */
export function previewCard(kind, d = {}) {
  ensureStyle()
  const url = d.url || ''
  const host = hostOf(url) || 'example.com'
  const title = d.title || (d.empty ? '' : 'Untitled page')
  const desc = d.description || ''
  if (kind === 'google') {
    const t = fitText(title, d.mobile ? 340 : 600, `400 ${d.mobile ? 18 : 20}px Arial`)
    const dsc = d.description ? (desc.length > 160 ? desc.slice(0, 157).trimEnd() + '...' : desc) : 'No description. Search engines will pick text from the page instead.'
    return h('div', { class: ['wt-pv', 'serp', d.mobile && 'mobile'] },
      h('div', { class: 'site' },
        h('div', { class: 'fav' }, d.favicon ? h('img', { src: d.favicon, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(icon('globe')) }) : icon('globe')),
        h('div', { class: 'sn' }, h('b', { class: 'clamp1' }, d.siteName || host), h('span', { class: 'clamp1' }, crumbs(url)))),
      h('div', { class: 't' }, t.text || 'Your page title'),
      h('div', { class: 'd', style: d.description ? '' : 'opacity:.6' }, dsc))
  }
  if (kind === 'x') {
    const large = d.large !== false
    return h('div', { class: ['wt-pv', 'card', 'x', !large && 'small'] },
      imageBox(d.image),
      h('div', { class: 'body' }, h('div', { class: 'dom' }, host), h('div', { class: ['ttl', 'clamp1'] }, title), h('div', { class: ['desc', 'clamp2'] }, desc)))
  }
  if (kind === 'facebook') {
    return h('div', { class: 'wt-pv card fb' }, imageBox(d.image),
      h('div', { class: 'body' }, h('div', { class: 'dom clamp1' }, host), h('div', { class: 'ttl clamp2' }, title), h('div', { class: 'desc clamp1' }, desc)))
  }
  if (kind === 'linkedin') {
    return h('div', { class: 'wt-pv card li' }, imageBox(d.image), h('div', { class: 'body' }, h('div', { class: 'ttl clamp2' }, title), h('div', { class: 'dom' }, host)))
  }
  return h('div', { class: 'wt-pv wa' },
    h('div', { class: 'inner' }, imageBox(d.image), h('div', { class: 'body' }, h('div', { class: 'ttl clamp2' }, title), h('div', { class: 'desc clamp2' }, desc), h('div', { class: 'dom' }, host))),
    h('div', { class: 'link' }, url || `https://${host}/`))
}

function ensureStyle() {
  if (!document.getElementById('wt-pv-style')) document.head.append(h('style', { id: 'wt-pv-style' }, CSS))
}
