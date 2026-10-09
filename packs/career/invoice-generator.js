// Invoice generator: seller and buyer details, logo, items with HSN/SAC, discount and GST (CGST + SGST within a state, IGST between states),
// Indian amount in words, bank and UPI details with a pay QR, saved seller profile, live PDF preview and download.
import { h, icon, button, busy, toast, alert, segmented, field, input, textarea, select, toggle, dropzone, clear, debounce, stats, errorMessage } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { safeName } from '../../lib/files.js'
import { loadImage } from '../../lib/image.js'
import { shell, banner, card, fi, uid, sortable, handle, burst, saveAs, saveIndicator, countUp } from './_kit.js'
import { STATES, GST_RATES, UNITS, CURRENCIES, blankInvoice, calcInvoice, gstinStatus, money, nextNumber, amountInWords, stateName } from './_invoice.js'
import { buildInvoicePdf } from './_invoice-pdf.js'
import { pdfPreview } from './_pdfview.js'

const KEY = 'invoice:draft', SELLER = 'invoice:seller'
const SWATCHES = ['#0d9b8a', '#5b4cf0', '#2563eb', '#e5484d', '#f76b15', '#18181b']
const stateOpts = [['', 'Select state'], ...STATES.map(([c, n]) => [c, `${c} - ${n}`])]

async function shrinkLogo(file) {
  const img = await loadImage(file)
  const k = Math.min(1, 360 / img.naturalWidth, 160 / img.naturalHeight)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k))
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

export async function mount(root, { signal }) {
  const stored = load(KEY, null)
  const base = blankInvoice()
  const savedSeller = load(SELLER, null)
  const inv = stored ? { ...base, ...stored, seller: { ...base.seller, ...(stored.seller || {}) }, buyer: { ...base.buyer, ...(stored.buyer || {}) } } : { ...base, seller: { ...base.seller, ...(savedSeller || {}) } }
  if (!inv.items?.length) inv.items = base.items
  const saved = saveIndicator('Saved on this device')
  const view = pdfPreview({ maxWidth: 700 })
  const totalsHost = h('div')
  const warn = h('div')
  let buyerStateWas = inv.buyer.state
  let posSel = null

  const persist = debounce(() => { save(KEY, inv); save(SELLER, inv.seller); saved.saved() }, 400)
  let seq = 0
  const render = debounce(async () => {
    const my = ++seq
    try {
      const { blob } = await buildInvoicePdf(inv)
      if (my !== seq) return
      await view.show(blob)
      clear(warn)
    } catch (e) { console.error(e); clear(warn, alert('error', errorMessage(e))) }
    drawTotals()
  }, 300)
  const touch = () => { saved.dirty(); persist(); render(); drawTotals() }

  function drawTotals() {
    const c = calcInvoice(inv)
    const T = c.totals
    const sym = CURRENCIES[inv.currency].sym
    clear(totalsHost, h('div', { class: 'stack tight' }, stats([
      { label: c.gst ? 'Taxable value' : 'Subtotal', value: `${sym}${money(T.taxable, inv.currency)}` },
      ...(c.gst ? [{ label: c.intra ? 'CGST + SGST' : 'IGST', value: `${sym}${money(T.tax, inv.currency)}`, hint: c.intra ? 'Same state' : inv.placeOfSupply ? 'Different state' : 'Set place of supply' }] : []),
      { label: 'Total payable', value: `${sym}${money(T.payable, inv.currency)}`, accent: true, hint: c.lines.length ? `${c.lines.length} item${c.lines.length > 1 ? 's' : ''}` : 'Add items' },
    ]), h('div', { class: 'small muted' }, T.payable ? amountInWords(T.payable, inv.currency) : '')))
  }

  // ---------- helpers ----------
  const gstinField = (obj, label, after) => {
    const note = h('div', { class: 'small', 'aria-live': 'polite' })
    const f = fi(obj, 'gstin', label, { ph: '27AAPFU0939F1ZV', hint: undefined }, () => { check(); after?.(); touch() })
    function check() {
      const s = gstinStatus(obj.gstin)
      obj.gstin = (obj.gstin || '').toUpperCase()
      f.ctl.value = obj.gstin
      if (s.state === 'ok') {
        clear(note, h('span', { style: 'color:var(--success)' }, `Valid GSTIN. ${stateName(s.stateCode)}`))
        return s
      }
      clear(note, s.state === 'empty' ? '' : h('span', { style: `color:var(--${s.state === 'bad' ? 'danger' : 'muted'})` }, s.msg))
      return s
    }
    f.append(note)
    check()
    f.check = check
    return f
  }
  const stateSelect = (obj, key, label, onChange) => {
    const sel = select(stateOpts, obj[key], (v) => { obj[key] = v; onChange?.(v); touch() })
    const f = field(label, sel)
    f.sel = sel
    return f
  }

  // ---------- sections ----------
  function invoiceCard() {
    const number = fi(inv, 'number', 'Invoice number', { ph: 'INV-0001' }, touch)
    const next = button('Next', { icon: 'arrow-right', variant: 'ghost', size: 'sm', title: 'Increase the number', onClick: () => { inv.number = nextNumber(inv.number); number.ctl.value = inv.number; touch() } })
    const cur = field('Currency', select(Object.keys(CURRENCIES).map((c) => [c, `${c} (${CURRENCIES[c].sym.trim()})`]), inv.currency, (v) => { inv.currency = v; touch() }))
    const pos = stateSelect(inv, 'placeOfSupply', 'Place of supply', (v) => { buyerStateWas = v })
    posSel = pos.sel
    const posWrap = h('div', { class: 'grow' }, pos, h('div', { class: 'small muted', style: 'margin-top:4px' }, 'Follows the customer\'s state. Change it only if goods or services go elsewhere.'))
    const syncGst = () => { posWrap.hidden = !inv.gst }
    syncGst()
    return card('Invoice', 'receipt', h('div', { class: 'stack tight' },
      h('div', { class: 'grid-2' }, h('div', { class: 'stack tight' }, number, h('div', { class: 'row' }, next)), cur),
      h('div', { class: 'grid-3' }, fi(inv, 'date', 'Invoice date', { type: 'date' }, touch), fi(inv, 'due', 'Due date', { type: 'date' }, touch), fi(inv, 'po', 'PO number (optional)', { ph: 'PO-2291' }, touch)),
      h('div', { class: 'row', style: 'gap:18px' }, toggle('GST invoice (HSN, CGST / SGST / IGST)', inv.gst, (v) => { inv.gst = v; syncGst(); touch() }), toggle('Round off to nearest rupee', inv.roundOff, (v) => { inv.roundOff = v; touch() })),
      posWrap))
  }
  function sellerCard() {
    const s = inv.seller
    const g = gstinField(s, 'GSTIN', () => { const st = gstinStatus(s.gstin); if (st.state === 'ok') { s.state = st.stateCode; s.pan ||= st.pan; stateF.sel.value = s.state; panF.ctl.value = s.pan } })
    const stateF = stateSelect(s, 'state', 'State', () => {})
    const panF = fi(s, 'pan', 'PAN', { ph: 'AAPFU0939F' }, touch)
    const logoNote = h('div', { class: 'small muted' }, s.logo ? 'Logo added.' : 'PNG or JPG. It is resized and kept on this device.')
    const logoPrev = h('img', { class: 'cr-logo', alt: 'Logo preview', hidden: !s.logo, src: s.logo || '' })
    const zone = dropzone({ accept: 'image/*', compact: true, paste: false, label: 'Add your logo', hint: 'Optional', onFiles: async ([f]) => {
      try { s.logo = await shrinkLogo(f); logoPrev.src = s.logo; logoPrev.hidden = false; rm.hidden = false; logoNote.textContent = 'Logo added.'; touch() } catch (e) { toast(errorMessage(e), 'error') }
    } })
    const rm = button('Remove logo', { icon: 'trash-2', variant: 'ghost', size: 'sm', onClick: () => { s.logo = ''; logoPrev.hidden = true; rm.hidden = true; logoNote.textContent = 'Logo removed.'; touch() } })
    rm.hidden = !s.logo
    return card('From (your business)', 'building-2', h('div', { class: 'stack tight' },
      h('div', { class: 'grid-2' }, fi(s, 'name', 'Business name', { ph: 'Northwind Studio' }, touch), g),
      fi(s, 'address', 'Address', { area: true, rows: 2, ph: '12 MG Road, Bengaluru 560001' }, touch),
      h('div', { class: 'grid-2' }, panF, stateF),
      h('div', { class: 'grid-2' }, fi(s, 'email', 'Email', { ph: 'billing@northwind.example', type: 'email' }, touch), fi(s, 'phone', 'Phone', { ph: '+91 98765 43210' }, touch)),
      h('div', { class: 'row' }, h('div', { class: 'grow', style: 'min-width:200px' }, zone), logoPrev, rm), logoNote,
      h('div', { class: 'small muted' }, 'Your business details are remembered on this device for the next invoice.')))
  }
  function buyerCard() {
    const b = inv.buyer
    const stateF = stateSelect(b, 'state', 'State', (v) => { followState(v) })
    const followState = (v) => { if (!inv.placeOfSupply || inv.placeOfSupply === buyerStateWas) { inv.placeOfSupply = v; posSelSync() } buyerStateWas = v }
    const g = gstinField(b, 'Customer GSTIN (optional)', () => { const st = gstinStatus(b.gstin); if (st.state === 'ok') { b.state = st.stateCode; stateF.sel.value = b.state; followState(b.state) } })
    return card('Bill to', 'user-round', h('div', { class: 'stack tight' },
      h('div', { class: 'grid-2' }, fi(b, 'name', 'Customer name', { ph: 'Acme Traders Pvt Ltd' }, touch), g),
      fi(b, 'address', 'Address', { area: true, rows: 2, ph: '45 Park Street, Mumbai 400001' }, touch),
      h('div', { class: 'grid-3' }, stateF, fi(b, 'email', 'Email', { ph: 'accounts@acme.example', type: 'email' }, touch), fi(b, 'phone', 'Phone', { ph: '+91 99887 76655' }, touch))))
  }
  const posSelSync = () => { if (posSel) posSel.value = inv.placeOfSupply }

  function itemsCard() {
    const list = h('div', { class: 'cr-list' })
    const lineTotal = (it) => { const c = calcInvoice({ ...inv, items: [it] }); return c.lines[0] ? `${CURRENCIES[inv.currency].sym}${money(c.lines[0].total, inv.currency)}` : '-' }
    function draw() {
      clear(list, inv.items.map((it, i) => {
        const tot = h('b', { class: 'small' }, lineTotal(it))
        const up = () => { tot.textContent = lineTotal(it); touch() }
        const el = h('div', { class: 'cr-item open', dataset: { id: it.id }, style: 'animation:none' },
          h('div', { class: 'cr-item-h' }, handle('Drag to reorder this item'), h('div', { class: 'lbl', style: 'cursor:default' }, h('b', { style: 'font-size:13px' }, `Item ${i + 1}`), h('small', ' ')), tot,
            button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Delete item ${i + 1}`, onClick: () => { inv.items = inv.items.filter((x) => x.id !== it.id); if (!inv.items.length) inv.items = [{ ...blankInvoice().items[0], id: uid() }]; draw(); touch() } })),
          h('div', { class: 'cr-item-b stack tight', style: 'display:block' }, h('div', { class: 'stack tight' },
            fi(it, 'desc', 'Description', { area: true, rows: 2, ph: 'Website design (5 pages)' }, up),
            h('div', { class: 'grid-3' }, fi(it, 'hsn', 'HSN / SAC', { ph: '998314' }, up), fi(it, 'qty', 'Quantity', { ph: '1', mode: 'decimal' }, up), field('Unit', select(UNITS, it.unit, (v) => { it.unit = v; touch() }))),
            h('div', { class: 'grid-3' }, fi(it, 'rate', 'Rate', { ph: '12500', mode: 'decimal' }, up), fi(it, 'disc', 'Discount %', { ph: '0', mode: 'decimal' }, up), field('GST %', select(GST_RATES.map((r) => [String(r), `${r}%`]), String(it.gst), (v) => { it.gst = v; up() }))))))
        return el
      }))
    }
    sortable(list, { onSort: (ids) => { inv.items = ids.map((id) => inv.items.find((x) => x.id === id)); draw(); touch() } })
    draw()
    return card('Items', 'list', h('div', { class: 'stack tight' }, list, button('Add item', { icon: 'plus', variant: 'secondary', onClick: () => { inv.items.push({ ...blankInvoice().items[0], id: uid() }); draw(); touch(); list.lastElementChild?.querySelector('textarea')?.focus() } })))
  }
  function paymentCard() {
    const s = inv.seller
    return card('Payment and notes', 'landmark', h('div', { class: 'stack tight' },
      h('div', { class: 'grid-2' }, fi(s, 'holder', 'Account name', { ph: 'Northwind Studio' }, touch), fi(s, 'bankName', 'Bank', { ph: 'HDFC Bank' }, touch)),
      h('div', { class: 'grid-3' }, fi(s, 'account', 'Account number', { ph: '50100123456789', mode: 'numeric' }, touch), fi(s, 'ifsc', 'IFSC', { ph: 'HDFC0001234' }, touch), fi(s, 'branch', 'Branch', { ph: 'MG Road' }, touch)),
      fi(s, 'upi', 'UPI ID (adds a pay QR for INR invoices)', { ph: 'northwind@okhdfcbank' }, touch),
      fi(inv, 'notes', 'Notes (optional)', { area: true, rows: 2, ph: 'Thank you for your business.' }, touch),
      fi(inv, 'terms', 'Terms', { area: true, rows: 2 }, touch),
      fi(inv, 'signatory', 'Signatory name (optional)', { ph: 'Aarav Mehta, Proprietor' }, touch)))
  }
  function lookCard() {
    const sw = h('div', { class: 'cr-swatches' }, SWATCHES.map((c) => h('button', { type: 'button', class: 'cr-sw', style: { '--k': c }, 'aria-label': `Accent ${c}`, 'aria-pressed': String(inv.accent === c), onclick: (e) => { inv.accent = c; for (const b of sw.querySelectorAll('.cr-sw')) b.setAttribute('aria-pressed', String(b === e.currentTarget)); touch() } })))
    return card('Look', 'palette', h('div', { class: 'row', style: 'gap:18px' }, field('Style', segmented([['clean', 'Clean'], ['bold', 'Bold header']], inv.look, (v) => { inv.look = v; touch() }, 'Style')), field('Accent', sw)))
  }

  const dl = button('Download PDF', { icon: 'file-down', variant: 'primary', size: 'lg' })
  dl.addEventListener('click', () => busy(dl, async () => {
    const c = calcInvoice(inv)
    if (!c.lines.length) { toast('Add at least one item first', 'error'); return }
    const { blob, unicode } = await buildInvoicePdf(inv)
    saveAs(blob, `${safeName(inv.number || 'invoice').replace(/\s+/g, '-')}${inv.buyer.name ? `-${safeName(inv.buyer.name).replace(/\s+/g, '-')}` : ''}.pdf`)
    burst(dl)
    toast(unicode || inv.currency !== 'INR' ? 'Invoice PDF downloaded' : 'Invoice downloaded (rupee sign shown as Rs. because the font could not load)', 'success')
  }, { label: 'Preparing' }))
  const fresh = button('New invoice', { icon: 'file-plus', variant: 'secondary', onClick: () => {
    const keep = { seller: { ...inv.seller }, look: inv.look, accent: inv.accent, currency: inv.currency, gst: inv.gst, roundOff: inv.roundOff, terms: inv.terms, signatory: inv.signatory }
    const n = nextNumber(inv.number)
    Object.assign(inv, blankInvoice(), keep, { number: n })
    save(KEY, inv)
    location.reload()
  } })

  const work = h('div', { class: 'cr-work wide-left', dataset: { pane: 'edit' } },
    h('div', { class: 'cr-pane-edit stack' }, invoiceCard(), sellerCard(), buyerCard(), itemsCard(), paymentCard(), lookCard()),
    h('div', { class: 'cr-pane-preview' }, h('div', { class: 'cr-sticky stack tight' }, totalsHost, view.el, warn, h('div', { class: 'row small muted', style: 'justify-content:space-between' }, saved.el))))
  const sw = h('div', { class: 'cr-switch' }, segmented([['edit', 'Edit'], ['preview', 'Preview']], 'edit', (v) => { work.dataset.pane = v; if (v === 'preview') render() }, 'Pane'))

  root.append(shell(
    banner({ icon: 'receipt', text: '<b>GST-ready invoices in minutes.</b> Pick the states and the CGST, SGST or IGST split is done for you, with the amount in words, bank details and a UPI QR. Your business details are remembered.', steps: ['Your details', 'Add items', 'Download PDF'] }),
    h('div', { class: 'row' }, dl, fresh, h('span', { class: 'small muted' }, 'Everything stays on this device.')), sw, work))
  drawTotals()
  render()
}
