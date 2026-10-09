// Add text to image: several draggable text layers with font, size, color, stroke, shadow, label background, opacity and rotation.
import { textarea, toggle } from '../../lib/ui.js'
import { canvas } from '../../lib/image.js'
import {
  shell, h, icon, button, busy, field, chips, section, hint, stage, slider, colorField, imageSlot, previewCanvas, outputPicker, encodeWith, outName,
  clear, toast, download,
} from './_kit.js'
import { FONTS, STYLES, newLayer, drawLayer, hitBox } from './_text.js'

export function mount(root) {
  let src = null, base = null // base = preview canvas
  const layers = []
  let sel = null
  let font = FONTS

  const view = h('canvas', { tabindex: 0, 'aria-label': 'Image with text. Drag text to move it. Arrow keys nudge the selected text.', class: 'ie-textcanvas' })
  const host = stage(view)
  const layerBar = h('div', { class: 'ie-chips', role: 'group', 'aria-label': 'Text layers' })

  // ----- controls (bound to the selected layer)
  const text = textarea({ rows: 3, placeholder: 'Type your text', 'aria-label': 'Text', oninput: (e) => edit({ text: e.target.value }) })
  const fontSel = h('select', { class: 'select', 'aria-label': 'Font', onchange: (e) => { edit({ font: e.target.value }); ensureFont() } }, FONTS.map(([v, l]) => h('option', { value: v }, l)))
  const fileFont = h('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', hidden: true, onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = ''
    if (!f) return
    try {
      const name = `UserFont${Date.now()}`
      const face = new FontFace(name, await f.arrayBuffer())
      await face.load(); document.fonts.add(face)
      fontSel.append(h('option', { value: `"${name}", sans-serif` }, f.name.replace(/\.[^.]+$/, '')))
      fontSel.value = `"${name}", sans-serif`
      edit({ font: fontSel.value })
    } catch { toast('That font file could not be loaded.', 'error') }
  } })
  const size = slider('Size', { min: 1, max: 40, step: 0.5, value: 8, format: (v) => `${v}%`, onInput: (v) => edit({ size: v }), hint: 'Relative to the image width, so it prints the same at any resolution.' })
  const boldT = toggle('Bold', true, (v) => edit({ bold: v })), italicT = toggle('Italic', false, (v) => edit({ italic: v })), upperT = toggle('UPPERCASE', false, (v) => edit({ upper: v }))
  const align = chips([['left', 'Left', 'align-left'], ['center', 'Center', 'align-center'], ['right', 'Right', 'align-right']], 'center', (v) => edit({ align: v }), { label: 'Alignment' })
  const color = colorField('Text color', '#ffffff', (v) => edit({ color: v }), { swatches: ['#ffffff', '#000000', '#facc15', '#ef4444', '#22c55e', '#3b82f6'] })
  const opacity = slider('Opacity', { min: 5, max: 100, value: 100, format: (v) => `${v}%`, onInput: (v) => edit({ opacity: v / 100 }) })
  const rotation = slider('Rotation', { min: -180, max: 180, value: 0, format: (v) => `${v}°`, onInput: (v) => edit({ rotation: v }) })
  const spacing = slider('Letter spacing', { min: -5, max: 30, value: 0, format: (v) => `${v}%`, onInput: (v) => edit({ spacing: v / 100 }) })
  const strokeT = toggle('Outline', false, (v) => { edit({ stroke: v }); strokeBox.hidden = !v })
  const strokeColor = colorField('Outline color', '#000000', (v) => edit({ strokeColor: v }))
  const strokeW = slider('Outline width', { min: 1, max: 30, value: 8, format: (v) => `${v}%`, onInput: (v) => edit({ strokeWidth: v }) })
  const strokeBox = h('div', { class: 'stack', hidden: true }, strokeColor, strokeW)
  const shadowT = toggle('Shadow', true, (v) => edit({ shadow: v }))
  const bgT = toggle('Label background', false, (v) => { edit({ bg: v }); bgBox.hidden = !v })
  const bgColor = colorField('Label color', '#000000', (v) => edit({ bgColor: v }), { swatches: ['#000000', '#ffffff', '#111827', '#dc2626'] })
  const bgOpacity = slider('Label opacity', { min: 10, max: 100, value: 55, format: (v) => `${v}%`, onInput: (v) => edit({ bgOpacity: v / 100 }) })
  const bgBox = h('div', { class: 'stack', hidden: true }, bgColor, bgOpacity)
  const styleChips = chips([['classic', 'Classic'], ['meme', 'Meme'], ['label', 'Label'], ['neon', 'Neon'], ['elegant', 'Elegant'], ['stamp', 'Stamp']], null, (v) => { edit(STYLES[v]); syncControls() }, { label: 'Quick styles' })
  const out = outputPicker({ formats: ['png', 'jpg', 'webp'], value: 'same' })

  const cur = () => layers.find((l) => l.id === sel)
  function edit(patch) {
    const l = cur()
    if (!l) return
    Object.assign(l, patch)
    if ('text' in patch) renderBar()
    draw()
  }
  function syncControls() {
    const l = cur()
    controls.hidden = !l
    if (!l) return
    if (document.activeElement !== text) text.value = l.text
    fontSel.value = l.font; if (fontSel.value !== l.font) fontSel.selectedIndex = 0
    size.set(l.size); boldT.input.checked = l.bold; italicT.input.checked = l.italic; upperT.input.checked = l.upper
    align.set(l.align); color.set(l.color); opacity.set(Math.round(l.opacity * 100)); rotation.set(l.rotation); spacing.set(Math.round(l.spacing * 100))
    strokeT.input.checked = l.stroke; strokeBox.hidden = !l.stroke; strokeColor.set(l.strokeColor); strokeW.set(l.strokeWidth)
    shadowT.input.checked = l.shadow; bgT.input.checked = l.bg; bgBox.hidden = !l.bg; bgColor.set(l.bgColor); bgOpacity.set(Math.round(l.bgOpacity * 100))
    draw()
  }
  function renderBar() {
    const chipsEls = layers.map((l, i) => h('button', { type: 'button', class: 'ie-chip', 'aria-pressed': String(l.id === sel), onclick: () => { sel = l.id; renderBar(); syncControls() } },
      h('span', (l.text.split(String.fromCharCode(10))[0] || `Text ${i + 1}`).slice(0, 14))))
    clear(layerBar, chipsEls,
      button('Add text', { icon: 'plus', size: 'sm', onClick: () => addLayer() }),
      layers.length ? button('Delete', { icon: 'trash-2', size: 'sm', variant: 'danger', onClick: removeLayer }) : null)
  }
  function addLayer(over = {}) {
    const l = newLayer({ y: layers.length ? Math.min(0.9, 0.5 + layers.length * 0.12) : 0.5, ...over })
    layers.push(l); sel = l.id; renderBar(); syncControls()
    text.focus({ preventScroll: true }); text.select()
  }
  function removeLayer() {
    const i = layers.findIndex((l) => l.id === sel)
    if (i < 0) return
    layers.splice(i, 1)
    sel = layers[Math.max(0, i - 1)]?.id ?? null
    renderBar(); syncControls(); draw()
  }
  const ensureFont = async () => { try { await document.fonts.load(`700 24px ${cur()?.font || FONTS[0][0]}`); draw() } catch { /* fine */ } }

  // ----- drawing
  let boxes = new Map()
  function paint(ctx, W, H, withUi) {
    boxes = new Map()
    for (const l of layers) boxes.set(l.id, drawLayer(ctx, l, W, H))
    const l = cur()
    if (withUi && l) {
      const b = boxes.get(l.id)
      ctx.save(); ctx.translate(b.cx, b.cy); ctx.rotate((l.rotation * Math.PI) / 180)
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = Math.max(1.5, W / 700); ctx.setLineDash([W / 120, W / 160])
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3
      ctx.strokeRect(-b.w / 2 - 6, -b.h / 2 - 6, b.w + 12, b.h + 12)
      ctx.setLineDash([]); ctx.shadowBlur = 0
      const r = Math.max(7, W / 110)
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#5b4cf0'; ctx.lineWidth = r / 3
      ctx.beginPath(); ctx.arc(b.w / 2 + 6, b.h / 2 + 6, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.restore()
    }
  }
  let raf = 0
  function draw() {
    if (!base) return
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const W = view.width, H = view.height
      const ctx = view.getContext('2d')
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(base, 0, 0, W, H)
      paint(ctx, W, H, true)
    })
  }
  const handlePos = (l) => {
    const b = boxes.get(l.id), a = (l.rotation * Math.PI) / 180
    const lx = b.w / 2 + 6, ly = b.h / 2 + 6
    return { x: b.cx + lx * Math.cos(a) - ly * Math.sin(a), y: b.cy + lx * Math.sin(a) + ly * Math.cos(a) }
  }
  const toImg = (e) => { const r = view.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * view.width, y: ((e.clientY - r.top) / r.height) * view.height } }
  let drag = null
  view.addEventListener('pointerdown', (e) => {
    if (!base) return
    const p = toImg(e)
    const l = cur()
    if (l) {
      const hp = handlePos(l)
      if (Math.hypot(p.x - hp.x, p.y - hp.y) < Math.max(18, view.width / 50)) {
        const b = boxes.get(l.id)
        drag = { kind: 'size', l, size0: l.size, d0: Math.max(1, Math.hypot(p.x - b.cx, p.y - b.cy)), id: e.pointerId }
        view.setPointerCapture(e.pointerId); e.preventDefault(); return
      }
    }
    for (let i = layers.length - 1; i >= 0; i--) {
      const t = layers[i]
      if (hitBox(boxes.get(t.id), p.x, p.y, 6)) {
        sel = t.id; renderBar(); syncControls()
        drag = { kind: 'move', l: t, ox: p.x - t.x * view.width, oy: p.y - t.y * view.height, id: e.pointerId }
        view.setPointerCapture(e.pointerId); view.classList.add('grabbing'); e.preventDefault(); return
      }
    }
    sel = null; renderBar(); syncControls(); draw()
  })
  view.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const p = toImg(e)
    if (drag.kind === 'move') { drag.l.x = Math.max(0, Math.min(1, (p.x - drag.ox) / view.width)); drag.l.y = Math.max(0, Math.min(1, (p.y - drag.oy) / view.height)) }
    else {
      const b = boxes.get(drag.l.id)
      drag.l.size = Math.max(1, Math.min(40, drag.size0 * (Math.hypot(p.x - b.cx, p.y - b.cy) / drag.d0)))
      size.set(Math.round(drag.l.size * 2) / 2)
    }
    draw()
  })
  const end = () => { drag = null; view.classList.remove('grabbing') }
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end)
  view.addEventListener('keydown', (e) => {
    const l = cur(); if (!l) return
    const step = e.shiftKey ? 0.02 : 0.004
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (d) { e.preventDefault(); l.x = Math.max(0, Math.min(1, l.x + d[0])); l.y = Math.max(0, Math.min(1, l.y + d[1])); draw() }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeLayer() }
  })

  // ----- export
  async function exportBlob() {
    const pick = out.resolve(src)
    const c = canvas(src.w, src.h)
    const ctx = c.getContext('2d')
    ctx.drawImage(src.img, 0, 0, src.w, src.h)
    paint(ctx, c.width, c.height, false)
    return { blob: await encodeWith(c, pick), pick }
  }
  const goBtn = button('Download image', { icon: 'download', variant: 'primary', size: 'lg', block: true })
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    if (!layers.length) return toast('Add some text first.', 'error')
    const { blob, pick } = await exportBlob()
    download(blob, outName(src.name, 'text', pick.fmt))
  }, { label: 'Rendering' }))
  const copyBtn = button('Copy to clipboard', { icon: 'copy', block: true, onClick: () => busy(copyBtn, async () => {
    const c = canvas(src.w, src.h); const ctx = c.getContext('2d'); ctx.drawImage(src.img, 0, 0, src.w, src.h); paint(ctx, c.width, c.height, false)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Image copied', 'success') } catch { toast('Your browser would not copy the image. Use Download instead.', 'error') }
  }, { label: 'Copying' }) })

  const slot = imageSlot({
    ic: 'type',
    onImage: async (s) => {
      src = s
      base = previewCanvas(s.img, 1400)
      view.width = base.width; view.height = base.height
      if (!layers.length) addLayer({ text: 'Your text', y: 0.5 })
      work.hidden = false
      draw()
    },
    onClear: () => { src = null; base = null; work.hidden = true },
  })
  const style = h('style', `.ie-textcanvas{cursor:grab;touch-action:none;outline:none}.ie-textcanvas.grabbing{cursor:grabbing}.ie-textcanvas:focus-visible{box-shadow:0 0 0 4px var(--ring)}`)
  const controls = h('div', { class: 'stack' },
    section('Text', 'type', text, styleChips),
    section('Font', 'a-large-small', field('Typeface', fontSel), h('div', { class: 'row' }, button('Upload a font', { icon: 'upload', size: 'sm', onClick: () => fileFont.click() }), fileFont), size, h('div', { class: 'ie-chips' }, boldT, italicT, upperT), align, spacing),
    section('Color', 'palette', color, opacity),
    section('Effects', 'sparkles', h('div', { class: 'ie-chips' }, strokeT, shadowT, bgT), strokeBox, bgBox, rotation))
  const side = h('aside', { class: 'ie-side ie-glass' }, section('Layers', 'layers', layerBar), controls, out.el, h('div', { class: 'ie-foot' }, goBtn, copyBtn))
  const work = h('div', { class: 'ie-work wide-side', hidden: true }, h('div', { class: 'ie-main pin live' }, host, hint('Drag the text to move it. Drag the round handle to resize. Arrow keys nudge.', 'move')), side)
  root.append(shell(style, slot.el, work))
  renderBar()
}
