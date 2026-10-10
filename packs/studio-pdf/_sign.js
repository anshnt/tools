// Images, signatures (draw / type / upload) and stamps. Everything becomes a PNG or JPEG "asset" that annotations reference.
import { h, button, modal, tabs, input, field, toggle, toast, empty, errorMessage } from '../../lib/ui.js'
import * as idb from '../../lib/idb.js'
import { loadImage, toBlob } from '../../lib/image.js'
import { pickFiles } from '../../lib/files.js'
import { uid, smoothSegs } from './_geom.js'

const SIG_KEY = 'pdf-studio:signatures'
const SCRIPT_FONTS = [['Dancing Script', 600], ['Caveat', 700], ['Great Vibes', 400], ['Sacramento', 400]]
const INKS = [['#111827', 'Black'], ['#1d4ed8', 'Blue'], ['#7c2d12', 'Brown']]
const STAMPS = [
  ['APPROVED', '#16a34a'], ['REJECTED', '#dc2626'], ['DRAFT', '#2563eb'], ['CONFIDENTIAL', '#dc2626'], ['FINAL', '#16a34a'], ['PAID', '#16a34a'],
  ['VOID', '#dc2626'], ['REVIEWED', '#2563eb'], ['COPY', '#6b7280'], ['URGENT', '#ea580c'],
]
let fontsLinked = false
function linkFonts() {
  if (fontsLinked) return
  fontsLinked = true
  const q = SCRIPT_FONTS.map(([f, w]) => `family=${f.replace(/ /g, '+')}${w !== 400 ? `:wght@${w}` : ''}`).join('&')
  document.head.append(h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${q}&display=swap`, 'data-pdfs-fonts': '' }))
}

/** Crop transparent margins (plus a little padding). */
function trim(canvas, pad = 6) {
  const { width: w, height: ht } = canvas
  const d = canvas.getContext('2d').getImageData(0, 0, w, ht).data
  let x1 = w, y1 = ht, x2 = -1, y2 = -1
  for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y }
  if (x2 < 0) return null
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(w - 1, x2 + pad); y2 = Math.min(ht - 1, y2 + pad)
  const out = Object.assign(document.createElement('canvas'), { width: x2 - x1 + 1, height: y2 - y1 + 1 })
  out.getContext('2d').drawImage(canvas, x1, y1, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export function createSign(app) {
  async function addAsset(blobOrCanvas, mime = 'image/png', w, h2) {
    const blob = blobOrCanvas instanceof Blob ? blobOrCanvas : await toBlob(blobOrCanvas, mime, 0.92)
    const id = uid('img')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const asset = { id, mime: blob.type || mime, bytes, w: w ?? blobOrCanvas.width, h: h2 ?? blobOrCanvas.height, url: URL.createObjectURL(blob) }
    app.assets.set(id, asset)
    return asset
  }
  app.addAsset = addAsset

  // ---------- plain images ----------
  async function chooseImage() {
    const [file] = await pickFiles({ accept: 'image/*' })
    if (!file) return null
    try {
      const img = await loadImage(file)
      const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight))
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) })
      const ctx = c.getContext('2d')
      const jpeg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name)
      if (jpeg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height) }
      ctx.drawImage(img, 0, 0, c.width, c.height)
      const asset = await addAsset(c, jpeg ? 'image/jpeg' : 'image/png')
      return { assetId: asset.id, w: img.naturalWidth * 0.75, h: img.naturalHeight * 0.75, kind: 'image' }
    } catch (e) {
      toast(errorMessage(e), 'error')
      return null
    }
  }

  // ---------- signature dialog ----------
  const loadSaved = async () => (await idb.get(SIG_KEY)) || []
  const saveSaved = (list) => idb.set(SIG_KEY, list.slice(0, 8))

  function drawPad() {
    const W = 640, H = 210, S = 2
    const canvas = h('canvas', { class: 'sig-canvas', width: W * S, height: H * S, 'aria-label': 'Draw your signature here' })
    const ctx = canvas.getContext('2d')
    let strokes = [], ink = INKS[0][0], active = null
    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.strokeStyle = ink; ctx.lineWidth = 3.4 * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      for (const s of strokes) {
        ctx.beginPath()
        for (const [t, ...v] of smoothSegs(s)) t === 'M' ? ctx.moveTo(...v) : t === 'L' ? ctx.lineTo(...v) : ctx.bezierCurveTo(...v)
        ctx.stroke()
      }
    }
    const pt = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W * S, ((e.clientY - r.top) / r.height) * H * S] }
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); active = [pt(e)]; strokes.push(active); redraw(); e.preventDefault() })
    canvas.addEventListener('pointermove', (e) => { if (!active) return; active.push(pt(e)); redraw() })
    const end = () => { active = null }
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end)
    const el = h('div', { class: 'sig-pad' }, canvas, h('div', { class: 'sig-line' }, h('span', 'Sign above the line')))
    return {
      el, isEmpty: () => !strokes.length,
      clear() { strokes = []; redraw() }, undo() { strokes.pop(); redraw() },
      setInk(c) { ink = c; redraw() },
      toCanvas: () => trim(canvas),
    }
  }

  async function typedCanvas(text, font, ink) {
    linkFonts()
    const [fam, wt] = font
    try { await document.fonts.load(`${wt} 90px "${fam}"`, text) } catch { /* fallback font */ }
    const size = 110
    const m = Object.assign(document.createElement('canvas'), { width: 10, height: 10 }).getContext('2d')
    m.font = `${wt} ${size}px "${fam}", cursive`
    const w = Math.ceil(m.measureText(text).width) + 40
    const c = Object.assign(document.createElement('canvas'), { width: w, height: size * 1.9 })
    const ctx = c.getContext('2d')
    ctx.font = `${wt} ${size}px "${fam}", cursive`
    ctx.fillStyle = ink; ctx.textBaseline = 'alphabetic'
    ctx.fillText(text, 20, size * 1.25)
    return trim(c)
  }

  function chooseSignature() {
    return new Promise((resolve) => {
      let done = false
      const finish = (v) => { if (done) return; done = true; dlg.close(); resolve(v) }
      const pad = drawPad()
      let tab = 'draw'
      let ink = INKS[0][0], typeFont = SCRIPT_FONTS[0], typed = '', uploaded = null
      const savedBox = h('div', { class: 'sig-saved' })
      const keep = toggle('Save on this device for next time', true)
      const inkSeg = h('div', { class: 'sig-inks', role: 'group', 'aria-label': 'Ink colour' }, INKS.map(([c, n]) => h('button', {
        type: 'button', class: 'ink-dot', style: { '--c': c }, 'aria-label': n, 'aria-pressed': String(c === ink),
        onclick: (e) => { ink = c; pad.setInk(c); for (const b of inkSeg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); renderFonts() },
      })))
      const typedIn = input({ placeholder: 'Type your name', 'aria-label': 'Your name', oninput: (e) => { typed = e.target.value; renderFonts() } })
      const fontsBox = h('div', { class: 'sig-fonts' })
      function renderFonts() {
        linkFonts()
        fontsBox.replaceChildren(...SCRIPT_FONTS.map((f) => h('button', {
          type: 'button', class: 'sig-font', 'aria-pressed': String(f === typeFont), style: { fontFamily: `"${f[0]}", cursive`, fontWeight: f[1], color: ink }, onclick: () => { typeFont = f; renderFonts() },
        }, typed || 'Your Name')))
      }
      const upPreview = h('div', { class: 'sig-up' }, empty('Choose a photo or scan of your signature.', 'image-up'))
      const whiteOut = toggle('Remove white background', true, () => { if (uploaded) renderUpload() })
      async function renderUpload() {
        const img = uploaded
        const sc = Math.min(1, 900 / img.naturalWidth)
        const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.naturalWidth * sc), height: Math.round(img.naturalHeight * sc) })
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, c.width, c.height)
        if (whiteOut.input.checked) {
          const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
            d[i + 3] = lum > 235 ? 0 : Math.min(255, (235 - lum) * 3.4)
          }
          ctx.putImageData(id, 0, 0)
        }
        uploaded._canvas = whiteOut.input.checked ? trim(c) : c
        upPreview.replaceChildren(h('div', { class: 'sig-checker' }, uploaded._canvas || empty('No ink found in that image.', 'image-off')))
      }
      const pickBtn = button('Choose image', { icon: 'upload', onClick: async () => {
        const [f] = await pickFiles({ accept: 'image/*' })
        if (!f) return
        try { uploaded = await loadImage(f); await renderUpload() } catch (e) { toast(errorMessage(e), 'error') }
      } })

      const tabsEl = tabs([
        { id: 'draw', label: 'Draw', render: () => h('div', { class: 'stack' }, pad.el, h('div', { class: 'row' }, inkSeg, button('Undo', { icon: 'undo-2', size: 'sm', onClick: () => pad.undo() }), button('Clear', { icon: 'eraser', size: 'sm', onClick: () => pad.clear() }))) },
        { id: 'type', label: 'Type', render: () => { renderFonts(); return h('div', { class: 'stack' }, field('Name', typedIn), fontsBox) } },
        { id: 'upload', label: 'Upload', render: () => h('div', { class: 'stack' }, h('div', { class: 'row' }, pickBtn, whiteOut), upPreview) },
      ], 'draw', (id) => { tab = id })

      const use = async (c) => {
        const asset = await addAsset(c, 'image/png')
        if (keep.input.checked) {
          const list = await loadSaved()
          list.unshift({ id: asset.id, bytes: asset.bytes, w: c.width, h: c.height, t: Date.now() })
          await saveSaved(list)
        }
        finish({ assetId: asset.id, w: c.width, h: c.height, kind: 'signature', defW: Math.min(170, c.width / 2.2) })
      }
      const useBtn = button('Use signature', { variant: 'primary', icon: 'check', onClick: async () => {
        let c = null
        if (tab === 'draw') c = pad.isEmpty() ? null : pad.toCanvas()
        else if (tab === 'type') c = typed.trim() ? await typedCanvas(typed.trim(), typeFont, ink) : null
        else c = uploaded?._canvas || null
        if (!c) return toast(tab === 'draw' ? 'Draw your signature first.' : tab === 'type' ? 'Type your name first.' : 'Choose an image first.', 'error')
        await use(c)
      } })

      async function renderSaved() {
        const list = await loadSaved()
        savedBox.replaceChildren()
        if (!list.length) return
        savedBox.append(h('div', { class: 'small muted' }, 'Your saved signatures'),
          h('div', { class: 'sig-grid' }, list.map((s) => {
            const url = URL.createObjectURL(new Blob([s.bytes], { type: 'image/png' }))
            return h('div', { class: 'sig-card' },
              h('button', { type: 'button', class: 'sig-use', 'aria-label': 'Use this signature', onclick: async () => {
                const asset = await addAsset(new Blob([s.bytes], { type: 'image/png' }), 'image/png', s.w, s.h)
                finish({ assetId: asset.id, w: s.w, h: s.h, kind: 'signature', defW: Math.min(170, s.w / 2.2) })
              } }, h('img', { src: url, alt: 'Saved signature', onload: () => URL.revokeObjectURL(url) })),
              button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Delete saved signature', onClick: async () => { await saveSaved(list.filter((x) => x.id !== s.id)); renderSaved() } }))
          })))
      }
      const dlg = modal({ title: 'Signature', icon: 'signature', body: h('div', { class: 'stack sig-dialog' }, savedBox, tabsEl, keep), actions: [button('Cancel', { onClick: () => finish(null) }), useBtn], onClose: () => finish(null) })
      renderSaved()
    })
  }

  // ---------- stamps ----------
  function stampCanvas(text, color, sub) {
    const S = 3
    const m = document.createElement('canvas').getContext('2d')
    m.font = 'bold 40px Helvetica, Arial, sans-serif'
    m.letterSpacing = '3px'
    const tw = Math.ceil(m.measureText(text).width)
    m.font = '600 17px Helvetica, Arial, sans-serif'
    const sw = sub ? Math.ceil(m.measureText(sub).width) : 0
    const w = Math.max(tw, sw) + 44, hh = sub ? 98 : 72
    const c = Object.assign(document.createElement('canvas'), { width: w * S, height: hh * S })
    const ctx = c.getContext('2d')
    ctx.scale(S, S)
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 4
    ctx.beginPath(); ctx.roundRect(4, 4, w - 8, hh - 8, 10); ctx.stroke()
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = 'bold 40px Helvetica, Arial, sans-serif'; ctx.letterSpacing = '3px'
    ctx.fillText(text, w / 2 + 1.5, sub ? 36 : hh / 2 + 1)
    if (sub) { ctx.font = '600 17px Helvetica, Arial, sans-serif'; ctx.letterSpacing = '0px'; ctx.fillText(sub, w / 2, 71) }
    return c
  }
  function chooseStamp() {
    return new Promise((resolve) => {
      let done = false
      const finish = (v) => { if (done) return; done = true; dlg.close(); resolve(v) }
      let text = 'APPROVED', color = '#16a34a'
      const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      const withDate = toggle(`Add today's date (${today})`, false, () => renderPreview())
      const preview = h('div', { class: 'stamp-preview sig-checker' })
      const custom = input({ placeholder: 'Custom text', 'aria-label': 'Custom stamp text', maxlength: 28, oninput: (e) => { text = e.target.value.toUpperCase() || ' '; renderPreview() } })
      const colorIn = h('input', { type: 'color', value: color, 'aria-label': 'Stamp colour', oninput: (e) => { color = e.target.value; renderPreview() } })
      const renderPreview = () => preview.replaceChildren(stampCanvas(text.trim() || ' ', color, withDate.input.checked ? today : ''))
      const grid = h('div', { class: 'stamp-grid' }, STAMPS.map(([t, c]) => h('button', {
        type: 'button', class: 'stamp-btn', style: { '--c': c }, onclick: () => { text = t; color = c; colorIn.value = c; custom.value = ''; renderPreview() },
      }, t)))
      const useBtn = button('Use stamp', { variant: 'primary', icon: 'check', onClick: async () => {
        const c = stampCanvas(text.trim() || ' ', color, withDate.input.checked ? today : '')
        const asset = await addAsset(c, 'image/png')
        finish({ assetId: asset.id, w: c.width / 3, h: c.height / 3, kind: 'stamp', defW: Math.min(190, c.width / 3) })
      } })
      const dlg = modal({ title: 'Stamp', icon: 'stamp', body: h('div', { class: 'stack' }, grid, h('div', { class: 'row' }, field('Custom text', custom), field('Colour', colorIn)), withDate, preview), actions: [button('Cancel', { onClick: () => finish(null) }), useBtn], onClose: () => finish(null) })
      renderPreview()
    })
  }

  /** Click on a signature form field: pick a signature and fit it into the field. */
  async function fillField(pv, w) {
    const res = await chooseSignature()
    if (!res) return
    const ratio = res.w / res.h
    let ww = w.w, hh = ww / ratio
    if (hh > w.h) { hh = w.h; ww = hh * ratio }
    app.tools.addAnnot(pv, 'image', { x: w.x + (w.w - ww) / 2, y: w.y + (w.h - hh) / 2, w: ww, h: hh, asset: res.assetId, kind: 'signature' }, { select: true })
  }

  return { chooseImage, chooseSignature, chooseStamp, fillField }
}
