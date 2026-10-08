// Image to text (OCR) with tesseract.js: many images, a language picker (several languages are joined with +),
// word highlights, copy and download. params.paste turns it into a paste-first screenshot reader.
import { h, icon, button, alert, clear, segmented, toggle, select as selectEl, toast, download, copyText, formatNumber, fileType, textarea } from '../../lib/ui.js'
import { baseName, zip } from '../../lib/files.js'
import { canvas as makeCanvas } from '../../lib/image.js'
import { recognize, OCR_LANGS, terminateOcr } from '../../lib/ocr.js'
import { load as getPref, save as setPref } from '../../lib/store.js'
import { loadWorking, thumbOf, fitCanvas, friendlyError } from './_ml.js'
import { shell, steps, heroDrop, strip, burst, scanFx, stage } from './_ui.js'

const MAX_FILES = 40
const LANG_NAME = new Map(OCR_LANGS)

/** Join the lines of each paragraph into one line (and undo word-wrap hyphenation). */
export function reflow(text) {
  return text.split(/\n\s*\n/).map((p) => p.replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2').replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n\n')
}

/** Words with boxes from a tesseract result, whichever shape (blocks or flat words) this version returns. */
export function wordsOf(data) {
  const words = []
  const walk = (o) => {
    if (!o) return
    if (Array.isArray(o.words)) for (const w of o.words) words.push(w)
    for (const k of ['blocks', 'paragraphs', 'lines']) if (Array.isArray(o[k])) o[k].forEach(walk)
  }
  walk(data)
  return words.filter((w) => w.bbox && w.text?.trim())
}

/** Grayscale and stretch contrast: helps faint, scanned or photographed text. */
function boost(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = id.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8; d[i] = d[i + 1] = d[i + 2] = g; hist[g]++ }
  const n = d.length / 4
  let lo = 0, hi = 255, c = 0
  for (; lo < 255; lo++) { c += hist[lo]; if (c > n * 0.01) break }
  c = 0
  for (; hi > 0; hi--) { c += hist[hi]; if (c > n * 0.01) break }
  const span = Math.max(40, hi - lo)
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, ((d[i] - lo) / span) * 255)); d[i] = d[i + 1] = d[i + 2] = v }
  ctx.putImageData(id, 0, 0)
}

export function mount(root, { params, signal }) {
  const pasteMode = !!params.paste
  const saved = getPref('image-ai:ocr', {})
  const st = { langs: saved.langs?.length ? saved.langs : ['eng'], reflow: false, boost: false, boxes: false, autoCopy: pasteMode, doneLangs: null }
  const items = []
  let active = null
  let seq = 0
  let running = false
  let view = 'one'
  const ctl = new AbortController()
  signal.addEventListener('abort', () => ctl.abort())

  injectStyle()
  const stepper = steps(pasteMode ? ['Paste', 'Read', 'Copy'] : ['Add images', 'Read', 'Copy'], 0)

  // ---------- language picker
  const chips = h('div', { class: 'ia-ocr-langs', 'aria-label': 'Languages' })
  const addSel = selectEl([['', 'Add a language...'], ...OCR_LANGS.map(([c, n]) => [c, n])], '', (v) => { if (v) addLang(v); addSel.value = '' })
  addSel.setAttribute('aria-label', 'Add a language')
  function renderLangs() {
    clear(chips, st.langs.map((c) => h('span', { class: 'ia-ocr-lang' }, LANG_NAME.get(c) || c, st.langs.length > 1 ? h('button', { type: 'button', 'aria-label': `Remove ${LANG_NAME.get(c)}`, onclick: () => removeLang(c) }, icon('x')) : null)))
    for (const o of addSel.options) o.disabled = !!o.value && st.langs.includes(o.value)
    addSel.disabled = st.langs.length >= 3
    setPref('image-ai:ocr', { langs: st.langs })
    syncReread()
  }
  function addLang(c) { if (!st.langs.includes(c) && st.langs.length < 3) { st.langs.push(c); renderLangs() } }
  function removeLang(c) { st.langs = st.langs.filter((x) => x !== c); renderLangs() }

  const rereadBtn = button('Read again with these languages', { icon: 'refresh-cw', variant: 'primary', size: 'sm' })
  rereadBtn.hidden = true
  rereadBtn.addEventListener('click', () => { for (const it of items) { it.status = ''; it.text = null } runQueue(true) })
  function syncReread() { rereadBtn.hidden = !st.doneLangs || st.doneLangs === st.langs.join('+') || !items.length }

  const boostT = toggle('Boost faint or small text', false, (v) => { st.boost = v; for (const it of items) { it.status = ''; it.text = null } if (items.length) runQueue(true) })
  const reflowT = toggle('Join lines into paragraphs', false, (v) => { st.reflow = v; showText() })
  const boxesT = toggle('Show where each word was found', false, (v) => { st.boxes = v; drawBoxes() })
  const copyT = toggle('Copy the text automatically', st.autoCopy, (v) => { st.autoCopy = v })
  const panel = h('div', { class: 'ia-panel ia-ocr-options' }, reflowT, boostT, boxesT, copyT)
  const langBar = h('div', { class: 'ia-panel ia-ocr-langbar' },
    h('div', { class: 'ia-ocr-langhead' }, icon('languages'), h('b', 'Language')),
    chips, addSel, rereadBtn,
    h('div', { class: 'ia-note' }, icon('info'), h('div', 'Pick every language in the image, up to 3. More languages read slower.')))

  // ---------- result area
  const pv = document.createElement('canvas')
  pv.className = 'ia-ocr-pv'
  const boxLayer = h('div', { class: 'ia-ocr-boxes' })
  const pvWrap = h('div', { class: 'ia-ocr-pvwrap' }, pv, boxLayer)
  const scan = scanFx()
  const stg = stage('on-plain')
  stg.append(pvWrap, scan.el)
  const out = textarea({ rows: 14, placeholder: 'The text will appear here. You can edit it before copying.', 'aria-label': 'Recognized text', class: 'ia-ocr-out' })
  out.addEventListener('input', () => { if (active && view === 'one') { active.edited = out.value; stats() } })
  const statsEl = h('div', { class: 'ia-ocr-stats' })
  const copyBtn = button('Copy text', { icon: 'copy', variant: 'primary', onClick: () => copyText(out.value) })
  const txtBtn = button('Download .txt', { icon: 'file-down', variant: 'secondary', onClick: () => downloadTxt() })
  const zipBtn = button('ZIP of .txt files', { icon: 'archive', variant: 'secondary', onClick: () => downloadZip() })
  zipBtn.hidden = true
  const viewSeg = segmented([['one', 'This image'], ['all', 'All images']], view, (v) => { view = v; showText() }, 'Show text for')
  viewSeg.hidden = true
  const textPane = h('div', { class: 'ia-ocr-pane stack tight' }, viewSeg, out, statsEl, h('div', { class: 'ia-actionbar' }, copyBtn, txtBtn, zipBtn))
  const thumbs = strip({ onSelect: (i) => select(items[i]), onRemove: (i) => removeItem(items[i]), onAdd: () => hero.zone.open() })
  const msgSlot = h('div')
  const more = button(pasteMode ? 'Paste or add another' : 'Add more images', { icon: 'plus', variant: 'secondary', size: 'sm', onClick: () => hero.zone.open() })
  const startOver = button('Start over', { icon: 'rotate-ccw', variant: 'ghost', size: 'sm', onClick: reset })
  const studioEl = h('div', { class: 'ia-ocr-studio', hidden: true },
    h('div', { class: 'ia-ocr-top' }, thumbs.el, h('div', { class: 'row' }, more, startOver)),
    msgSlot,
    h('div', { class: 'ia-ocr-split' }, stg, textPane),
    panel)

  // ---------- intake
  const hero = heroDrop({
    accept: 'image/*', multiple: true, label: pasteMode ? 'Press Ctrl+V to paste a screenshot' : 'Drop images with text here',
    hint: pasteMode ? 'Or drop, click to choose, or tap "Paste from clipboard". We read the text right away.' : 'Photos, scans and screenshots in 25+ languages. Paste with Ctrl+V works too.',
    icons: ['scan-text', 'clipboard-paste', 'languages', 'file-text'],
    features: [['shield-check', 'Reads on your device'], ['languages', '25+ languages'], ['copy', 'Copy or download']],
    onFiles: addFiles,
  })
  const pasteBtn = button('Paste from clipboard', { icon: 'clipboard-paste', variant: pasteMode ? 'primary' : 'secondary', onClick: pasteFromClipboard })
  const keys = h('div', { class: 'ia-kbd', 'aria-hidden': 'true' }, h('kbd', 'Ctrl'), h('span', '+'), h('kbd', 'V'))
  const pasteRow = h('div', { class: 'ia-ocr-pasterow' }, pasteMode ? keys : null, pasteBtn)
  shell(root, stepper, langBar, hero, pasteRow, studioEl)
  renderLangs()

  async function pasteFromClipboard() {
    try {
      const list = await navigator.clipboard.read()
      const files = []
      for (const it of list) {
        const type = it.types.find((t) => t.startsWith('image/'))
        if (type) files.push(new File([await it.getType(type)], `pasted-${Date.now()}.png`, { type }))
      }
      if (!files.length) return toast('No image on the clipboard. Take a screenshot first (Win+Shift+S or Cmd+Shift+4).')
      addFiles(files)
    } catch {
      toast('Your browser did not allow clipboard access. Press Ctrl+V (or Cmd+V) instead.')
    }
  }

  async function addFiles(files) {
    files = files.slice(0, MAX_FILES - items.length)
    if (!files.length) return toast(`That is the limit for one batch (${MAX_FILES} images).`)
    const added = []
    for (const f of files) {
      const it = { id: ++seq, file: f, name: f.name || `image-${seq}.png`, thumb: null, status: '', text: null, conf: 0, words: [], dims: null }
      if (/^image\/(jpeg|png|webp|gif|avif|bmp)/.test(fileType(f))) it.thumb = URL.createObjectURL(f)
      items.push(it); added.push(it)
    }
    hero.hidden = true; pasteRow.hidden = true; studioEl.hidden = false
    zipBtn.hidden = items.length < 2; viewSeg.hidden = items.length < 2
    await select(added[0])
    runQueue()
  }

  function removeItem(it) {
    items.splice(items.indexOf(it), 1)
    if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb)
    if (!items.length) return reset()
    zipBtn.hidden = items.length < 2; viewSeg.hidden = items.length < 2
    if (it === active) select(items[0]); else renderThumbs()
  }

  function reset() {
    for (const it of items) if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb)
    items.length = 0; active = null; st.doneLangs = null
    studioEl.hidden = true; hero.hidden = false; pasteRow.hidden = false
    out.value = ''; clear(msgSlot, statsEl); stepper.set(0)
  }

  const renderThumbs = () => thumbs.render(items.map((it) => ({ name: it.name, thumb: it.thumb, status: it.status })), items.indexOf(active))

  async function prepare(it) {
    if (it.canvas) return it
    const w = await loadWorking(it.file, { maxSide: 4000 })
    it.dims = [w.width, w.height]
    it.canvas = w.canvas
    it.thumb = it.thumb || await thumbOf(w.canvas)
    return it
  }

  async function select(it) {
    active = it
    renderThumbs()
    try { await prepare(it) } catch (e) { clear(msgSlot, alert('error', `${it.name}: ${friendlyError(e).message}`)); return }
    if (active !== it) return
    const pc = fitCanvas(it.canvas, 1200)
    pv.width = pc.width; pv.height = pc.height
    pv.getContext('2d').drawImage(pc, 0, 0)
    pvWrap.style.setProperty('--ar', String(pc.width / pc.height))
    showText(); drawBoxes()
    if (it.status === 'run') scan.update(null, 'Reading text')
    else scan.stop()
    renderThumbs()
  }

  // ---------- OCR
  async function runQueue(force = false) {
    if (running) return
    running = true
    clear(msgSlot)
    const langKey = st.langs.join('+')
    try {
      for (const it of [...items]) {
        if (!items.includes(it) || it.text != null && !force) continue
        if (it.status === 'done' && !force) continue
        await ocrOne(it, langKey)
      }
      st.doneLangs = langKey
      syncReread()
      stepper.set(2)
      if (st.autoCopy && active?.text) { try { await navigator.clipboard.writeText(out.value); toast('Text copied to the clipboard', 'success') } catch { /* needs a click: the Copy button is right there */ } }
    } finally { running = false }
  }

  async function ocrOne(it, lang) {
    it.status = 'run'
    renderThumbs()
    stepper.set(1)
    if (it === active) { scan.start('Loading the OCR engine'); scan.onCancel = null }
    try {
      await prepare(it)
      // tesseract does best with text about 30 px tall, so small images are enlarged
      let c = it.canvas
      let k = 1
      const m = Math.max(c.width, c.height)
      if (m < 1400) k = Math.min(3, 1400 / m)
      if (k > 1.05 || st.boost) {
        const w = Math.round(c.width * k), hh = Math.round(c.height * k)
        const t = makeCanvas(w, hh)
        const x = t.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, hh)
        if (st.boost) boost(t)
        c = t
      }
      const res = await recognize(c, { lang, onProgress: (f, l) => { if (it === active) scan.update(f, l) } })
      it.text = res.text
      it.conf = res.confidence
      it.edited = null
      it.words = wordsOf(res.data).map((w) => ({ t: w.text, c: w.confidence, x0: w.bbox.x0 / c.width, y0: w.bbox.y0 / c.height, x1: w.bbox.x1 / c.width, y1: w.bbox.y1 / c.height }))
      it.status = 'done'
      if (it === active) { scan.stop(); showText(); drawBoxes(); if (it.text) burst(stg, 8) }
    } catch (e) {
      it.status = 'error'
      if (it === active) { scan.stop(); clear(msgSlot, alert('error', `${it.name}: ${friendlyError(e).message}`)) }
    }
    renderThumbs()
  }

  // ---------- showing and exporting text
  const textOf = (it) => (it.edited != null ? it.edited : st.reflow && it.text ? reflow(it.text) : it.text || '')
  function showText() {
    if (!active) return
    if (view === 'all') {
      out.value = items.map((it) => `${items.length > 1 ? `----- ${it.name} -----\n` : ''}${textOf(it)}`).join('\n\n')
      out.readOnly = true
    } else {
      out.readOnly = false
      out.value = active.status === 'done' ? textOf(active) : ''
      out.placeholder = active.status === 'run' ? 'Reading...' : active.status === 'error' ? 'Could not read this image.' : 'The text will appear here. You can edit it before copying.'
    }
    stats()
  }
  function stats() {
    const t = out.value
    const words = (t.match(/\S+/g) || []).length
    clear(statsEl, active?.status === 'done' && view === 'one'
      ? [h('span', `${formatNumber(words, 0)} words`), h('span', `${formatNumber(t.length, 0)} characters`), h('span', { class: ['ia-conf', active.conf >= 80 ? 'good' : active.conf >= 60 ? 'ok' : 'low'] }, `${Math.round(active.conf)}% confidence`)]
      : words ? [h('span', `${formatNumber(words, 0)} words`), h('span', `${formatNumber(t.length, 0)} characters`)] : null)
    if (active?.status === 'done' && !t.trim() && view === 'one') clear(msgSlot, alert('warn', 'No text was found in this image. Try "Boost faint or small text", or pick the right language.'))
    else if (!msgSlot.querySelector('.alert.error')) clear(msgSlot)
  }
  function drawBoxes() {
    clear(boxLayer)
    if (!st.boxes || !active?.words?.length) return
    for (const w of active.words) {
      boxLayer.append(h('i', { class: w.c < 60 ? 'low' : '', title: `${w.t} (${Math.round(w.c)}%)`, style: { left: `${w.x0 * 100}%`, top: `${w.y0 * 100}%`, width: `${(w.x1 - w.x0) * 100}%`, height: `${(w.y1 - w.y0) * 100}%` } }))
    }
  }
  function downloadTxt() {
    const name = view === 'all' ? 'recognized-text.txt' : `${baseName(active?.name || 'text')}.txt`
    download(new Blob([out.value], { type: 'text/plain;charset=utf-8' }), name)
  }
  async function downloadZip() {
    const files = items.filter((it) => it.status === 'done').map((it) => ({ name: `${baseName(it.name)}.txt`, data: textOf(it) }))
    if (!files.length) return toast('Nothing has been read yet.')
    download(await zip(files), 'recognized-text.zip')
  }

  return () => { ctl.abort(); for (const it of items) if (it.thumb?.startsWith('blob:')) URL.revokeObjectURL(it.thumb); terminateOcr() }
}

let styled = false
function injectStyle() {
  if (styled || document.getElementById('ia-ocr-style')) return
  styled = true
  document.head.append(h('style', { id: 'ia-ocr-style' }, `
.ia-ocr-pasterow { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; justify-content: center; }
.ia-ocr-pre { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; }
.ia-ocr-prechips { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ia-ocr-change { border: 0; background: transparent; color: var(--accent); cursor: pointer; font-size: 13px; text-decoration: underline; text-underline-offset: 2px; min-height: 32px; padding: 0 6px; }
.ia-ocr-langs { display: flex; flex-wrap: wrap; gap: 6px; }
.ia-ocr-lang { display: inline-flex; align-items: center; gap: 4px; height: 30px; padding: 0 6px 0 12px; border-radius: 999px; font-size: 13px; font-weight: 550; background: var(--accent-soft); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent); animation: ia-pop .3s var(--spring) both; }
.ia-ocr-lang button { width: 22px; height: 22px; border-radius: 50%; border: 0; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; padding: 0; }
.ia-ocr-lang button:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.ia-ocr-lang .icon { width: 13px; height: 13px; }
.ia-ocr-studio { display: flex; flex-direction: column; gap: 14px; }
.ia-ocr-top { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
.ia-ocr-split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.ia-ocr-pane { min-width: 0; }
.ia-ocr-out { min-height: 320px; font-size: 14.5px; line-height: 1.6; }
.ia-ocr-pvwrap { position: relative; width: min(100%, calc(60vh * var(--ar, 1))); aspect-ratio: var(--ar, 1); margin: 0 auto; }
.ia-ocr-pv { position: absolute; inset: 0; width: 100% !important; height: 100% !important; max-height: none !important; border-radius: 6px !important; box-shadow: 0 10px 30px -14px rgba(0, 0, 0, .4); background: #fff; }
.ia-ocr-boxes { position: absolute; inset: 0; pointer-events: none; }
.ia-ocr-boxes i { position: absolute; border: 1.5px solid var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); border-radius: 3px; animation: ia-pop .35s var(--spring) both; }
.ia-ocr-boxes i.low { border-color: #f59e0b; background: rgba(245, 158, 11, .18); }
.ia-ocr-stats { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--muted); }
.ia-conf.good { color: var(--success); } .ia-conf.ok { color: var(--warning); } .ia-conf.low { color: var(--danger); }
.ia-ocr-langbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 12px 16px; }
.ia-ocr-langhead { display: flex; align-items: center; gap: 8px; }
.ia-ocr-langhead .icon { color: var(--accent); }
.ia-ocr-langbar .select { width: auto; min-width: 190px; height: 34px; }
.ia-ocr-langbar .ia-note { flex-basis: 100%; }
.ia-ocr-options { display: flex; flex-wrap: wrap; gap: 8px 22px; padding: 10px 16px; }
@media (max-width: 900px) { .ia-ocr-split { grid-template-columns: minmax(0, 1fr); } }
`))
}
