// Email signature generator: six email-safe, table-based templates with a live preview, copied as rich HTML (ClipboardItem text/html)
// so it pastes into Gmail, Outlook and Apple Mail with its formatting. Also copy the HTML code or download it.
import { h, icon, button, busy, toast, alert, segmented, field, input, select, clear, copyText, debounce, tabs, dropzone, errorMessage } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { loadImage } from '../../lib/image.js'
import { shell, banner, card, fi, fs, getProfile, setProfile, esc, burst, saveAs, saveIndicator } from './_kit.js'

const KEY = 'signature:data'
const FONTS = [['Arial, Helvetica, sans-serif', 'Arial'], ['Verdana, Geneva, sans-serif', 'Verdana'], ['Tahoma, Geneva, sans-serif', 'Tahoma'], ['"Trebuchet MS", Helvetica, sans-serif', 'Trebuchet MS'], ['Georgia, "Times New Roman", serif', 'Georgia'], ['"Courier New", monospace', 'Courier New']]
const SOCIALS = [['linkedin', 'LinkedIn', 'in', '#0a66c2'], ['x', 'X (Twitter)', 'X', '#111111'], ['github', 'GitHub', 'GH', '#24292f'], ['instagram', 'Instagram', 'IG', '#e1306c'], ['youtube', 'YouTube', 'YT', '#ff0000'], ['facebook', 'Facebook', 'f', '#1877f2'], ['whatsapp', 'WhatsApp', 'WA', '#25d366']]
const SWATCHES = ['#0d9b8a', '#5b4cf0', '#2563eb', '#e5484d', '#f76b15', '#18181b']
export const TEMPLATES = [['classic', 'Classic', 'Photo left, details right'], ['bar', 'Accent bar', 'Colored vertical rule'], ['minimal', 'Minimal', 'Two clean lines'], ['card', 'Card', 'Top accent, two columns'], ['bold', 'Bold name', 'Big accent name'], ['stacked', 'Stacked', 'Centered logo on top']]

const safeUrl = (u) => { const t = String(u || '').trim(); return /^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(t) ? t : /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) ? `https://${t}` : '' }
const link = (u) => { const t = String(u || '').trim(); return /^https?:\/\//i.test(t) ? t : t ? `https://${t}` : '' }
const telHref = (p) => `tel:${String(p).replace(/[^\d+]/g, '')}`
const shortLink = (u) => String(u).replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '')

/** Build the signature HTML (inline styles, tables). `f` are the fields, `o` options {tpl, font, size, accent, social}. */
export function buildSignature(f, o) {
  const A = o.accent, size = o.size, font = o.font
  const txt = '#27272a', mut = '#6b7280'
  const S = (n) => `${n}px`
  const base = `font-family:${font.replace(/"/g, "'")};font-size:${S(size)};line-height:1.45;color:${txt}`
  const photo = safeUrl(f.photo)
  const name = f.name ? `<span style="font-size:${S(size + 4)};font-weight:bold;color:${txt}">${esc(f.name)}</span>` : ''
  const title = [f.title, f.company].filter(Boolean).map(esc).join(` <span style="color:${A}">|</span> `)
  const dept = f.department ? esc(f.department) : ''
  const contact = (sep) => {
    const parts = []
    if (f.phone) parts.push(`<a href="${esc(telHref(f.phone))}" style="color:${txt};text-decoration:none">${esc(f.phone)}</a>`)
    if (f.mobile) parts.push(`<a href="${esc(telHref(f.mobile))}" style="color:${txt};text-decoration:none">${esc(f.mobile)}</a>`)
    if (f.email) parts.push(`<a href="mailto:${esc(f.email)}" style="color:${A};text-decoration:none">${esc(f.email)}</a>`)
    if (f.website) parts.push(`<a href="${esc(link(f.website))}" style="color:${A};text-decoration:none">${esc(shortLink(f.website))}</a>`)
    return parts.join(sep)
  }
  const labelled = () => {
    const L = []
    const lab = (k, v) => `<span style="color:${A};font-weight:bold">${k}</span>&nbsp;${v}`
    if (f.phone) L.push(lab('P', `<a href="${esc(telHref(f.phone))}" style="color:${txt};text-decoration:none">${esc(f.phone)}</a>`))
    if (f.mobile) L.push(lab('M', `<a href="${esc(telHref(f.mobile))}" style="color:${txt};text-decoration:none">${esc(f.mobile)}</a>`))
    if (f.email) L.push(lab('E', `<a href="mailto:${esc(f.email)}" style="color:${txt};text-decoration:none">${esc(f.email)}</a>`))
    if (f.website) L.push(lab('W', `<a href="${esc(link(f.website))}" style="color:${txt};text-decoration:none">${esc(shortLink(f.website))}</a>`))
    if (f.address) L.push(lab('A', esc(f.address)))
    return L.join('<br>')
  }
  const socials = () => {
    const items = SOCIALS.filter(([k]) => f[`s_${k}`]).map(([k, label, abbr, color]) => ({ href: link(f[`s_${k}`]), label, abbr, color }))
    if (!items.length) return ''
    if (o.social === 'badge') return items.map((s) => `<a href="${esc(s.href)}" title="${esc(s.label)}" style="display:inline-block;background:${s.color};color:#ffffff;font-family:Arial,sans-serif;font-size:10px;font-weight:bold;line-height:1;text-decoration:none;padding:5px 6px;margin:0 4px 0 0;border-radius:4px">${esc(s.abbr)}</a>`).join('')
    return items.map((s) => `<a href="${esc(s.href)}" style="color:${A};text-decoration:none">${esc(s.label)}</a>`).join(` <span style="color:#c4c8cf">&middot;</span> `)
  }
  const photoImg = (px, round = true) => (photo ? `<img src="${esc(photo)}" alt="${esc(f.name || 'Photo')}" width="${px}" height="${px}" style="display:block;width:${px}px;height:${px}px;${round ? 'border-radius:50%;' : ''}object-fit:cover;border:0">` : '')
  const tagline = f.tagline ? `<div style="color:${mut};font-style:italic;margin-top:6px">${esc(f.tagline)}</div>` : ''
  const disc = f.disclaimer ? `<div style="color:#9ca3af;font-size:${S(Math.max(9, size - 3))};line-height:1.4;margin-top:10px;max-width:460px">${esc(f.disclaimer)}</div>` : ''
  const so = socials()
  const wrap = (inner) => `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="${base};border-collapse:collapse"><tbody>${inner}</tbody></table>`
  const td = (style, inner, attrs = '') => `<td ${attrs} style="${style}">${inner}</td>`
  const lines = (arr) => arr.filter(Boolean).join('')
  const block = (tag, style, inner) => (inner ? `<${tag} style="${style}">${inner}</${tag}>` : '')

  let html = ''
  switch (o.tpl) {
    case 'minimal':
      html = wrap(`<tr><td style="padding:0">${lines([
        block('div', '', `${name}${title ? `<span style="color:${mut}">&nbsp;&nbsp;${title}</span>` : ''}`),
        block('div', 'margin-top:3px', contact(`<span style="color:#c4c8cf">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`)),
        block('div', 'margin-top:6px', so), tagline, disc])}</td></tr>`)
      break
    case 'bar':
      html = wrap(`<tr>${photo ? td('padding:0 14px 0 0;vertical-align:top', photoImg(72), 'valign="top"') : ''}${td(`border-left:3px solid ${A};padding:2px 0 2px 14px;vertical-align:top`, lines([
        block('div', '', name), block('div', `color:${mut};margin-top:1px`, `${title}${dept ? ` &middot; ${dept}` : ''}`), block('div', 'margin-top:8px', labelled()), block('div', 'margin-top:8px', so), tagline, disc]), 'valign="top"')}</tr>`)
      break
    case 'card':
      html = wrap(`<tr><td colspan="2" style="border-top:4px solid ${A};padding:12px 0 0 0">${block('div', '', name)}${block('div', `color:${mut}`, title)}</td></tr><tr>${td('padding:10px 22px 0 0;vertical-align:top', `${photo ? photoImg(64, false) : ''}`, 'valign="top"')}${td('padding:10px 0 0 0;vertical-align:top', lines([block('div', '', labelled()), block('div', 'margin-top:8px', so)]), 'valign="top"')}</tr>${f.tagline || f.disclaimer ? `<tr><td colspan="2">${tagline}${disc}</td></tr>` : ''}`)
      break
    case 'bold':
      html = wrap(`<tr>${td('padding:0;vertical-align:top', lines([
        block('div', `font-size:${S(size + 9)};font-weight:bold;color:${A};letter-spacing:.5px;text-transform:uppercase;line-height:1.1`, esc(f.name || '')),
        block('div', `color:${txt};font-weight:bold;margin-top:3px`, title),
        block('div', `height:2px;width:46px;background:${A};margin:9px 0`, '&nbsp;'),
        block('div', '', labelled()), block('div', 'margin-top:8px', so), tagline, disc]), 'valign="top"')}${photo ? td('padding:0 0 0 20px;vertical-align:top', photoImg(86), 'valign="top"') : ''}</tr>`)
      break
    case 'stacked':
      html = wrap(`<tr><td align="center" style="text-align:center;padding:0">${lines([
        photo ? `<div style="margin:0 auto 8px;width:80px">${photoImg(80)}</div>` : '', block('div', '', name), block('div', `color:${mut}`, title),
        block('div', `height:2px;width:40px;background:${A};margin:8px auto`, '&nbsp;'), block('div', '', contact(`<span style="color:#c4c8cf">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`)), f.address ? block('div', `color:${mut}`, esc(f.address)) : '', block('div', 'margin-top:8px', so), tagline, disc])}</td></tr>`)
      break
    default: // classic
      html = wrap(`<tr>${photo ? td('padding:0 16px 0 0;vertical-align:top', photoImg(84), 'valign="top"') : ''}${td(`${photo ? `border-left:1px solid #e5e7eb;padding:0 0 0 16px;` : ''}vertical-align:top`, lines([
        block('div', '', name), block('div', `color:${mut};margin-bottom:6px`, `${title}${dept ? ` &middot; ${dept}` : ''}`), block('div', '', contact(`<span style="color:#c4c8cf">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`)), f.address ? block('div', `color:${mut}`, esc(f.address)) : '', block('div', 'margin-top:8px', so), tagline, disc]), 'valign="top"')}</tr>`)
  }
  return html
}
async function shrinkImage(file, px = 220) {
  const img = await loadImage(file)
  const k = Math.min(1, px / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.86)
}

export async function mount(root, { signal }) {
  const prof = getProfile()
  const f = { name: prof.name, title: prof.title, company: prof.company, department: '', phone: prof.phone, mobile: '', email: prof.email, website: prof.website, address: prof.location, photo: '', tagline: '', disclaimer: '', s_linkedin: prof.linkedin, ...load(KEY, {}) }
  const o = { tpl: f.tpl || 'classic', font: f.font || FONTS[0][0], size: f.size || 13, accent: f.accent || '#0d9b8a', social: f.social || 'text', dark: false }
  const saved = saveIndicator('Saved on this device')
  const persist = debounce(() => { save(KEY, { ...f, tpl: o.tpl, font: o.font, size: o.size, accent: o.accent, social: o.social }); setProfile({ name: f.name, title: f.title, email: f.email, phone: f.phone, website: f.website, company: f.company }); saved.saved() }, 400)
  const mailbox = h('div', { class: 'cr-mailbox' })
  const photoWarn = alert('warn', 'The photo could not be loaded. Use a public address that starts with https:// and points straight to the image.')
  photoWarn.hidden = true
  const draw = () => {
    const html = buildSignature(f, o)
    mailbox.innerHTML = f.name || f.email || f.title ? html : ''
    if (!mailbox.innerHTML) mailbox.append(h('div', { class: 'small muted' }, 'Fill in your details and your signature appears here.'))
    mailbox.classList.toggle('dark', o.dark)
    photoWarn.hidden = true
    mailbox.querySelectorAll('img').forEach((img) => img.addEventListener('error', () => { img.style.display = 'none'; photoWarn.hidden = false }, { once: true }))
  }
  const onField = () => { saved.dirty(); persist(); draw() }
  const html = () => buildSignature(f, o)
  const plain = () => mailbox.innerText.replace(/\n{3,}/g, '\n\n').trim()

  const copyRich = button('Copy signature', { icon: 'copy', variant: 'primary', size: 'lg' })
  copyRich.addEventListener('click', () => busy(copyRich, async () => {
    const markup = html()
    try {
      if (!window.ClipboardItem) throw new Error('no ClipboardItem')
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([markup], { type: 'text/html' }), 'text/plain': new Blob([plain()], { type: 'text/plain' }) })])
    } catch {
      // fallback: select the rendered preview and copy it
      const r = document.createRange(); r.selectNodeContents(mailbox)
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
      const ok = document.execCommand('copy')
      sel.removeAllRanges()
      if (!ok) throw new Error('Copy was blocked. Use "Copy HTML code" instead.')
    }
    toast('Signature copied. Paste it into your email settings.', 'success')
    burst(copyRich)
  }, { label: 'Copying' }))

  const photoUrl = fi(f, 'photo', 'Photo or logo URL (best for Gmail)', { ph: 'https://yoursite.com/me.jpg' }, onField)
  const zone = dropzone({ accept: 'image/*', compact: true, paste: false, label: 'Or upload a photo', hint: 'Embedded in the signature', onFiles: async ([file]) => {
    try { f.photo = await shrinkImage(file); photoUrl.ctl.value = f.photo.slice(0, 40) + '...'; onField(); toast('Photo added. Gmail may need a hosted URL instead.', 'info', 5000) } catch (e) { toast(errorMessage(e), 'error') }
  } })

  const tplPick = h('div', { class: 'cr-chips' }, TEMPLATES.map(([id, name, blurb]) => h('button', { type: 'button', class: 'cr-chip btn-chip', title: blurb, 'aria-pressed': String(o.tpl === id), onclick: (e) => { o.tpl = id; for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); onField() } }, name)))
  const sw = h('div', { class: 'cr-swatches' }, SWATCHES.map((c) => h('button', { type: 'button', class: 'cr-sw', style: { '--k': c }, 'aria-label': `Accent ${c}`, 'aria-pressed': String(o.accent === c), onclick: (e) => { o.accent = c; for (const b of sw.querySelectorAll('.cr-sw')) b.setAttribute('aria-pressed', String(b === e.currentTarget)); onField() } })),
    h('input', { type: 'color', class: 'input', value: o.accent, 'aria-label': 'Custom accent color', oninput: (e) => { o.accent = e.target.value; for (const b of sw.querySelectorAll('.cr-sw')) b.setAttribute('aria-pressed', 'false'); onField() } }))
  const help = tabs([
    { id: 'gmail', label: 'Gmail', render: () => steps(['Click Copy signature above.', 'In Gmail open Settings (gear) > See all settings > General > Signature.', 'Click Create new, name it, click in the box and paste (Ctrl+V).', 'Scroll down and click Save changes.']) },
    { id: 'outlook', label: 'Outlook', render: () => steps(['Click Copy signature above.', 'Outlook on the web: Settings > Accounts > Signatures. Desktop: File > Options > Mail > Signatures.', 'Create a new signature and paste (Ctrl+V) into the editor.', 'Choose it as the default for new messages and replies, then save.']) },
    { id: 'apple', label: 'Apple Mail', render: () => steps(['Click Download .html or Copy HTML code.', 'Mail > Settings > Signatures, add a signature and uncheck "Always match my default message font".', 'Paste the rich text. If formatting is lost, open the .html file in Safari, select all, copy and paste again.']) },
  ])
  function steps(list) { return h('ol', { style: 'margin:0;padding-left:20px;display:grid;gap:6px;font-size:14px' }, list.map((s) => h('li', s))) }

  root.append(shell(
    banner({ icon: 'pen-tool', text: '<b>A signature that looks right everywhere.</b> Email-safe tables with inline styles, copied as rich text so Gmail and Outlook keep the formatting.', steps: ['Fill in details', 'Pick a style', 'Copy and paste'] }),
    h('div', { class: 'cr-work' },
      h('div', { class: 'stack' },
        card('Your details', 'user-round', h('div', { class: 'stack tight' },
          h('div', { class: 'grid-2' }, fi(f, 'name', 'Full name', { ph: 'Aarav Mehta', ac: 'name' }, onField), fi(f, 'title', 'Job title', { ph: 'Senior Software Engineer' }, onField)),
          h('div', { class: 'grid-2' }, fi(f, 'company', 'Company', { ph: 'Northwind Labs' }, onField), fi(f, 'department', 'Department (optional)', { ph: 'Platform' }, onField)),
          h('div', { class: 'grid-2' }, fi(f, 'phone', 'Phone', { ph: '+91 80 1234 5678', ac: 'tel' }, onField), fi(f, 'mobile', 'Mobile (optional)', { ph: '+91 98765 43210' }, onField)),
          h('div', { class: 'grid-2' }, fi(f, 'email', 'Email', { ph: 'aarav@northwind.example', type: 'email', ac: 'email' }, onField), fi(f, 'website', 'Website', { ph: 'northwind.example' }, onField)),
          fi(f, 'address', 'Address (optional)', { ph: 'Bengaluru, India' }, onField), photoUrl, zone)),
        card('Social links', 'share-2', h('div', { class: 'grid-2' }, SOCIALS.map(([k, label]) => fi(f, `s_${k}`, label, { ph: k === 'whatsapp' ? 'wa.me/919876543210' : `${k === 'x' ? 'x.com' : k + '.com'}/yourname` }, onField)))),
        card('Extras', 'quote', h('div', { class: 'stack tight' }, fi(f, 'tagline', 'Tagline (optional)', { ph: 'Building payments that just work' }, onField), fi(f, 'disclaimer', 'Disclaimer (optional)', { area: true, rows: 2, ph: 'This email and any attachments are confidential...' }, onField)))),
      h('div', { class: 'cr-sticky stack tight' },
        card('Style', 'palette', h('div', { class: 'stack tight' }, tplPick,
          h('div', { class: 'row', style: 'gap:18px' }, field('Accent', sw), fs(o, 'font', 'Font', FONTS, onField), fs(o, 'size', 'Size', [[12, '12 px'], [13, '13 px'], [14, '14 px'], [15, '15 px']], (k, v) => { o.size = +v; onField() })),
          field('Social links as', segmented([['text', 'Text links'], ['badge', 'Color badges']], o.social, (v) => { o.social = v; onField() }, 'Social style')))),
        card('Preview', 'eye', h('div', { class: 'stack tight' }, mailbox, photoWarn,
          h('div', { class: 'row' }, field('', segmented([['light', 'Light mail'], ['dark', 'Dark mail']], 'light', (v) => { o.dark = v === 'dark'; draw() }, 'Preview background'))),
          h('div', { class: 'row' }, copyRich, button('Copy HTML code', { icon: 'code', variant: 'secondary', onClick: () => copyText(html()) }), button('Download .html', { icon: 'download', variant: 'ghost', size: 'sm', onClick: () => saveAs(`<!doctype html><meta charset="utf-8"><title>Email signature</title><body style="margin:20px">${html()}</body>`, 'email-signature.html', 'text/html;charset=utf-8') })),
          h('div', { class: 'small muted' }, 'Photos hosted at a public web address work everywhere. Uploaded photos are embedded and work in Outlook and Apple Mail, but Gmail may drop them.'), saved.el)),
        card('How to add it', 'circle-help', help)))))
  draw()
}
