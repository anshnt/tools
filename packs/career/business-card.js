// Business card maker: six front/back designs drawn at 300 dpi, a QR code with your vCard, PNG export and a print-ready PDF sheet
// (10 per A4 or Letter page with crop marks and a mirrored back sheet for two-sided printing).
import { h, icon, button, busy, toast, alert, segmented, field, clear, copyText, debounce, onCleanup } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { safeName } from '../../lib/files.js'
import { jspdf } from '../../lib/libs.js'
import { shell, banner, card, fi, fs, getProfile, setProfile, burst, saveAs, saveIndicator } from './_kit.js'
import { SIZES, DESIGNS, FONTS, drawFront, drawBack, vcard } from './_card.js'
import { qrModel } from './_qr.js'

const KEY = 'bcard:data'
const SWATCHES = ['#0d9b8a', '#5b4cf0', '#2563eb', '#e5484d', '#f76b15', '#18181b']
const PAPER = { a4: [210, 297], letter: [215.9, 279.4] }

/** Pointer-driven 3D tilt for a card (skipped for reduced motion and touch). */
function tilt(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover)').matches) return
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `perspective(900px) rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 10).toFixed(2)}deg) scale(1.015)`
  })
  el.addEventListener('pointerleave', () => { el.style.transform = '' })
}

export async function mount(root, { signal }) {
  const prof = getProfile()
  const d = { name: prof.name, title: prof.title, company: prof.company, phone: prof.phone, email: prof.email, website: prof.website, address: prof.location, tagline: '', ...load(KEY, {}) }
  const o = { design: d.design || 'gradient', accent: d.accent || '#0d9b8a', font: d.font || 'sans', size: d.size || 'us', qrKind: d.qrKind || 'vcard', paper: d.paper || 'a4', backSheet: d.backSheet !== false, marks: d.marks !== false }
  const saved = saveIndicator('Saved on this device')
  const persist = debounce(() => { save(KEY, { ...d, ...o }); setProfile({ name: d.name, title: d.title, company: d.company, phone: d.phone, email: d.email, website: d.website }); saved.saved() }, 400)
  const front = h('canvas', { class: 'cr-face', 'aria-label': 'Card front preview' })
  const back = h('canvas', { class: 'cr-face back', 'aria-label': 'Card back preview' })
  const warn = h('div')
  let qr = null, qrKey = ''
  let fontsReady = ''

  async function paint() {
    const S = SIZES[o.size]
    try {
      const fam = FONTS[o.font].css
      if (fontsReady !== o.font) { await Promise.all(['400', '500', '600', '700', '800'].map((w) => document.fonts.load(`${w} 32px ${fam}`).catch(() => {}))); fontsReady = o.font }
      const payload = o.qrKind === 'vcard' ? vcard(d) : o.qrKind === 'url' ? (/^https?:/i.test(d.website || '') ? d.website : d.website ? `https://${d.website}` : '') : ''
      if (payload && (d.name || d.email || d.phone || d.website)) {
        if (qrKey !== payload) { qr = await qrModel(payload, 'M'); qrKey = payload }
      } else { qr = null; qrKey = '' }
      for (const c of [front, back]) { if (c.width !== S.w) c.width = S.w; if (c.height !== S.h) c.height = S.h }
      const f = front.getContext('2d'), b = back.getContext('2d')
      f.clearRect(0, 0, S.w, S.h); b.clearRect(0, 0, S.w, S.h)
      drawFront(f, S.w, S.h, d, o)
      drawBack(b, S.w, S.h, d, o, qr)
      flip.style.setProperty('--ar', `${S.w} / ${S.h}`)
      clear(warn)
    } catch (e) { console.error(e); clear(warn, alert('error', e.message)) }
  }
  const redraw = debounce(paint, 60)
  const onField = () => { saved.dirty(); persist(); redraw() }

  const designs = h('div', { class: 'cr-chips' }, DESIGNS.map(([id, name]) => h('button', { type: 'button', class: 'cr-chip btn-chip', 'aria-pressed': String(o.design === id), onclick: (e) => { o.design = id; for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); onField() } }, name)))
  const sw = h('div', { class: 'cr-swatches' }, SWATCHES.map((c) => h('button', { type: 'button', class: 'cr-sw', style: { '--k': c }, 'aria-label': `Accent ${c}`, 'aria-pressed': String(o.accent === c), onclick: (e) => { o.accent = c; for (const b of sw.querySelectorAll('.cr-sw')) b.setAttribute('aria-pressed', String(b === e.currentTarget)); onField() } })),
    h('input', { type: 'color', class: 'input', value: o.accent, 'aria-label': 'Custom accent color', oninput: (e) => { o.accent = e.target.value; for (const b of sw.querySelectorAll('.cr-sw')) b.setAttribute('aria-pressed', 'false'); onField() } }))

  const fileBase = () => `${safeName(d.name || 'business-card').replace(/\s+/g, '-')}-card`
  const png = (c, name) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image'))), 'image/png'))
  const mk = (label, ic, variant, fn, size) => { const b = button(label, { icon: ic, variant, size }); b.addEventListener('click', () => busy(b, async () => { await paint(); await fn(); burst(b) }, { label: 'Preparing' })); return b }

  async function sheetPdf() {
    const JsPDF = await jspdf()
    const [pw, ph] = PAPER[o.paper]
    const [cw, ch] = SIZES[o.size].mm
    const cols = Math.max(1, Math.floor((pw - 20) / cw)), rows = Math.max(1, Math.floor((ph - 20) / ch))
    const x0 = (pw - cols * cw) / 2, y0 = (ph - rows * ch) / 2
    const doc = new JsPDF({ unit: 'mm', format: [pw, ph], compress: true })
    doc.setProperties({ title: `Business cards - ${d.name || ''}`, author: d.name || '' })
    const marks = () => {
      if (!o.marks) return
      doc.setDrawColor(150); doc.setLineWidth(0.15)
      for (let c = 0; c <= cols; c++) { const x = x0 + c * cw; doc.line(x, y0 - 6, x, y0 - 2); doc.line(x, y0 + rows * ch + 2, x, y0 + rows * ch + 6) }
      for (let r = 0; r <= rows; r++) { const y = y0 + r * ch; doc.line(x0 - 6, y, x0 - 2, y); doc.line(x0 + cols * cw + 2, y, x0 + cols * cw + 6, y) }
    }
    const faces = { front: front.toDataURL('image/png'), back: back.toDataURL('image/png') }
    const page = (key, mirror) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) doc.addImage(faces[key], 'PNG', x0 + (mirror ? cols - 1 - c : c) * cw, y0 + r * ch, cw, ch, key)
      marks()
      doc.setFontSize(7); doc.setTextColor(150); doc.text(`${key === 'front' ? 'Fronts' : 'Backs'}: ${cols * rows} cards, ${cw} x ${ch} mm. Print at 100% (actual size).`, pw / 2, ph - 6, { align: 'center' })
    }
    page('front', false)
    if (o.backSheet) { doc.addPage(); page('back', true) }
    return { blob: doc.output('blob'), count: cols * rows }
  }

  const sheetBtn = mk('Print sheet (PDF)', 'printer', 'primary', async () => { const { blob, count } = await sheetPdf(); saveAs(blob, `${fileBase()}-sheet.pdf`); toast(`${count} cards per sheet${o.backSheet ? ', fronts then backs (flip on the long edge)' : ''}`, 'success', 5000) }, 'lg')

  const flip = h('div', { class: 'cr-flip', dataset: { side: 'front' }, title: 'Click to flip the card', onclick: () => setSide(flip.dataset.side === 'front' ? 'back' : 'front') }, h('div', { class: 'cr-flip-in' }, front, back))
  const sideSeg = segmented([['front', 'Front'], ['back', 'Back']], 'front', (v) => setSide(v), 'Card side')
  function setSide(v) { flip.dataset.side = v; sideSeg.set(v) }
  const tiltWrap = h('div', { class: 'cr-tilt' }, flip)
  tilt(tiltWrap)
  const stage = h('div', { class: 'stack tight' }, tiltWrap, h('div', { class: 'row', style: 'justify-content:center' }, sideSeg))

  root.append(shell(
    banner({ icon: 'contact', text: '<b>Design it, scan it, print it.</b> Six styles, a QR code that saves your contact in one tap, and a print sheet with crop marks. Nothing is uploaded.', steps: ['Your details', 'Pick a design', 'Print or download'] }),
    h('div', { class: 'cr-work' },
      h('div', { class: 'stack' },
        card('Your details', 'user-round', h('div', { class: 'stack tight' },
          h('div', { class: 'grid-2' }, fi(d, 'name', 'Full name', { ph: 'Aarav Mehta', ac: 'name' }, onField), fi(d, 'title', 'Job title', { ph: 'Senior Software Engineer' }, onField)),
          fi(d, 'company', 'Company', { ph: 'Northwind Labs' }, onField),
          h('div', { class: 'grid-2' }, fi(d, 'phone', 'Phone', { ph: '+91 98765 43210', ac: 'tel' }, onField), fi(d, 'email', 'Email', { ph: 'aarav@northwind.example', type: 'email', ac: 'email' }, onField)),
          h('div', { class: 'grid-2' }, fi(d, 'website', 'Website', { ph: 'northwind.example' }, onField), fi(d, 'address', 'Address or city', { ph: 'Bengaluru, India' }, onField)),
          fi(d, 'tagline', 'Tagline for the back (optional)', { ph: 'Software that stays out of your way' }, onField))),
        card('Design', 'palette', h('div', { class: 'stack' }, designs,
          h('div', { class: 'row', style: 'gap:18px' }, field('Accent', sw), field('Typeface', segmented(Object.entries(FONTS).map(([id, f]) => [id, f.label]), o.font, (v) => { o.font = v; onField() }, 'Typeface'))),
          h('div', { class: 'grid-2' }, fs(o, 'size', 'Card size', Object.entries(SIZES).map(([id, s]) => [id, s.label]), onField), fs(o, 'qrKind', 'QR code on the back', [['vcard', 'Saves my contact (vCard)'], ['url', 'Opens my website'], ['none', 'No QR code']], onField)))),
        card('Printing', 'printer', h('div', { class: 'stack tight' },
          h('div', { class: 'grid-2' }, fs(o, 'paper', 'Paper', [['a4', 'A4'], ['letter', 'Letter']], () => { persist() }), h('div', { class: 'stack tight' }, h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: o.backSheet, onchange: (e) => { o.backSheet = e.target.checked; persist() } }), h('span', 'Add a back sheet')), h('label', { class: 'switch' }, h('input', { type: 'checkbox', role: 'switch', checked: o.marks, onchange: (e) => { o.marks = e.target.checked; persist() } }), h('span', 'Crop marks')))),
          h('div', { class: 'small muted' }, 'Print at 100% (actual size) on card stock, cut along the marks. For two-sided printing choose "flip on long edge".')))),
      h('div', { class: 'cr-sticky stack' },
        card('Preview', 'eye', h('div', { class: 'stack' }, stage, warn, h('div', { class: 'small muted' }, 'Click the card to flip it. Move your pointer over it to tilt.'), saved.el)),
        card('Download', 'download', h('div', { class: 'stack tight' },
          h('div', { class: 'row' }, sheetBtn),
          h('div', { class: 'row' },
            mk('Front PNG', 'image', 'secondary', async () => saveAs(await png(front), `${fileBase()}-front.png`), 'sm'),
            mk('Back PNG', 'image', 'secondary', async () => saveAs(await png(back), `${fileBase()}-back.png`), 'sm'),
            mk('Contact (.vcf)', 'contact', 'ghost', async () => saveAs(vcard(d), `${safeName(d.name || 'contact').replace(/\s+/g, '-')}.vcf`, 'text/vcard;charset=utf-8'), 'sm'),
            button('Copy vCard', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copyText(vcard(d)) }))))))))
  paint()
}
