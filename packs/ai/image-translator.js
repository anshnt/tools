// Image translator: Claude vision reads the text in a photo, sign, menu or screenshot and translates it line by line.
import { h, button, field, select, toggle, dropzone, alert, clear, panel, split, row, table, preview, download, copyButton, empty, icon } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { baseName } from '../../lib/files.js'
import { loadImage, toCanvas, fitSize } from '../../lib/image.js'
import { injectStyle, runner, LANGUAGES, RTL_LANGS, UNTRUSTED } from './_shared.js'

const CONTEXTS = [['auto', 'Auto-detect'], ['menu', 'Restaurant menu'], ['sign', 'Street or shop sign'], ['document', 'Document or form'], ['screenshot', 'Screenshot or app'], ['label', 'Product label'], ['handwriting', 'Handwritten note'], ['comic', 'Comic or manga']]
const SCHEMA = {
  type: 'object',
  properties: {
    source_language: { type: 'string' },
    summary: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { original: { type: 'string' }, translation: { type: 'string' }, pronunciation: { type: 'string' } }, required: ['original', 'translation', 'pronunciation'], additionalProperties: false } },
  },
  required: ['source_language', 'summary', 'items'],
  additionalProperties: false,
}

export const csvEscape = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v))

export function buildSystem({ target, context, pronunciation }) {
  const ctx = context === 'auto' ? '' : ` The image is a ${CONTEXTS.find((c) => c[0] === context)?.[1].toLowerCase()}.`
  return `You read text in images and translate it into ${target}.${ctx} ${UNTRUSTED}
List every piece of visible text in reading order, one item per line, label or sentence (keep each menu item and its price together). For each item give the exact original text, its natural ${target} translation (keep numbers, prices and brand names), and ${pronunciation ? 'a romanized pronunciation of the original when it is not written in the Latin alphabet' : 'an empty string for pronunciation'}. Set source_language to the main language you detected and summary to one short sentence about what the image shows. If the text is already in ${target}, still list it. If there is no text, return an empty items array.`
}

const placeholder = () => h('div', { class: 'empty' }, icon('languages'), h('strong', { style: 'color:var(--text-2)' }, 'Original and translated lines appear here'), h('div', 'Add an image and press Translate image.'))

export function mount(root, { signal }) {
  injectStyle()
  let file = null
  let data = null
  const status = h('div')
  const stage = h('div')
  const results = h('div', { class: 'stack' })
  const zone = dropzone({ accept: 'image/*,.heic,.heif', label: 'Drop a photo, sign, menu or screenshot', icon: 'image', hint: 'JPG, PNG, WebP, HEIC · or paste with Ctrl+V', onFiles: ([f]) => load(f) })
  const target = select(LANGUAGES, 'English')
  const context = select(CONTEXTS, 'auto')
  const pron = toggle('Add pronunciation (romanized)', false)
  const go = button('Translate image', { icon: 'languages', variant: 'primary', size: 'lg', disabled: true })
  const run = runner({ btn: go, errorTo: status, signal, label: 'Reading the image' })

  async function load(f) {
    clear(status); clear(results, placeholder()); data = null
    try {
      const img = await loadImage(f)
      const { width, height } = fitSize(img.naturalWidth, img.naturalHeight, 1100, 800)
      const c = toCanvas(img, width, height)
      c.setAttribute('role', 'img'); c.setAttribute('aria-label', f.name)
      clear(stage, preview(c))
      file = f; go.disabled = false
      zone.classList.add('compact')
    } catch (e) { file = null; go.disabled = true; clear(status, alert('error', e.message || 'Could not open that image.')) }
  }

  const lines = (withOriginal) => data.items.map((i) => (withOriginal ? `${i.original}\t${i.translation}` : i.translation)).join('\n')

  function show() {
    const rtl = RTL_LANGS.has(target.value)
    const showPron = data.items.some((i) => i.pronunciation?.trim())
    clear(results,
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', { class: 'stack', style: 'gap:2px' }, h('strong', data.summary || 'Translation'), h('span', { class: 'small muted' }, `Detected: ${data.source_language || 'unknown'} → ${target.value}`)),
        h('div', { class: 'row' }, copyButton(() => lines(false), 'Copy translation'), copyButton(() => lines(true), 'Copy both'),
          button('CSV', { icon: 'download', size: 'sm', onClick: () => download(['Original,Translation' + (showPron ? ',Pronunciation' : ''), ...data.items.map((i) => [i.original, i.translation, ...(showPron ? [i.pronunciation] : [])].map(csvEscape).join(','))].join('\n'), `${baseName(file.name)}-translation.csv`, 'text/csv') }))),
      data.items.length
        ? table({ columns: ['Original', 'Translation', ...(showPron ? ['Pronunciation'] : [])], rows: data.items.map((i) => [i.original, h('span', { dir: rtl ? 'rtl' : 'auto', style: 'font-weight:600;color:var(--text)' }, i.translation), ...(showPron ? [i.pronunciation] : [])]) })
        : empty('No text was found in this image. Try a sharper or closer photo.', 'search-x'))
  }

  go.addEventListener('click', () => run.go(async (sig) => {
    clear(results)
    const block = await ai.imageBlock(file)
    data = await ai.ask({
      system: buildSystem({ target: target.value, context: context.value, pronunciation: pron.input.checked }), json: SCHEMA, effort: 'low', signal: sig,
      messages: [{ role: 'user', content: [block, ai.textBlock(`Translate all the text in this image into ${target.value}.`)] }],
    })
    data.items = (data.items || []).filter((i) => i && (i.original || i.translation))
    show()
  }, { label: 'Reading the image' }))

  root.append(h('div', { class: 'stack' }, ai.notice(),
    split(
      panel(h('div', { class: 'stack' }, zone, stage,
        h('div', { class: 'grid-auto' }, field('Translate to', target), field('What is it?', context)),
        pron, row(go, run.stop), status,
        h('p', { class: 'small muted' }, 'Works with photos of signs, menus, labels, documents and screenshots. Handwriting and stylized fonts are read less reliably.'))),
      panel(results))))
  clear(results, placeholder())
}
