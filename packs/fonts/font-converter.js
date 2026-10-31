// Font converter: TTF, OTF, WOFF, WOFF2 and EOT in any direction. One module serves the generic tool and the focused entries (params.from / params.to).
import { h, dropzone, fileList, segmented, panel, field, select, button, busy, progress } from '../../lib/ui.js'
import { ext } from '../../lib/files.js'
import { convertFont, FONT_LABEL } from './_convert.js'
import { resultList, injectStyle, COMMON_CSS } from './_ui.js'

const ORDER = ['woff2', 'woff', 'ttf', 'otf', 'eot']
const NOTE = {
  woff2: 'Smallest web font, supported by every current browser. Best choice for websites.',
  woff: 'Compressed web font that also works in older browsers.',
  ttf: 'Plain TrueType for desktop apps, Windows and most tools. OpenType (CFF) outlines are converted to TrueType curves.',
  otf: 'OpenType with PostScript (CFF) outlines. TrueType curves are converted to cubic curves, hinting is dropped.',
  eot: 'The old Internet Explorer web font format (uncompressed). Only needed for very old browsers.',
}

export function mount(root, { params, signal }) {
  injectStyle('t-font-common', COMMON_CSS)
  const { from, to: fixedTo } = params || {}
  let target = fixedTo || params?.start || 'woff2'
  const accept = from ? `.${from}` : '.ttf,.otf,.woff,.woff2,.eot'
  const note = h('div', { class: 'target-note' }, NOTE[target])
  const seg = fixedTo ? null : segmented(ORDER.map((f) => [f, FONT_LABEL[f]]), target, (v) => { target = v; sync() }, 'Convert to')
  const accuracy = select([['1', 'Standard'], ['0.3', 'High (bigger file)']], '1')
  const accField = field('Curve accuracy', accuracy, 'Used when OpenType (CFF) curves become TrueType curves.')
  const btn = button('Convert', { icon: 'repeat-2', variant: 'primary', size: 'lg', block: true })
  const prog = progress('Converting')
  const results = resultList({ zipName: `fonts-${target}.zip` })
  const list = fileList({ sortable: false, onChange: () => sync() })
  const zone = dropzone({
    multiple: true, accept, icon: 'type',
    label: from ? `Drop ${FONT_LABEL[from]} fonts here or click to choose` : 'Drop fonts here or click to choose',
    hint: from ? `${FONT_LABEL[from]} files` : 'TTF, OTF, WOFF, WOFF2 or EOT, as many as you like',
    onFiles: (fs) => { list.add(fs); results.clear() },
  })
  const opts = panel(
    h('div', { class: 'stack' }, seg ? field('Convert to', seg) : h('strong', `${from ? FONT_LABEL[from] : 'Font'} to ${FONT_LABEL[fixedTo]}`), note, accField),
  )
  const work = h('div', { class: 'stack', hidden: true }, list.el, opts, btn, prog.el)
  root.append(h('div', { class: 't-font stack' }, zone, work, results.el, h('p', { class: 'small muted' }, 'Everything is converted on your device. Fonts are never uploaded.')))

  function sync() {
    const n = list.files.length
    work.hidden = !n
    note.textContent = NOTE[target]
    accField.hidden = !(target === 'ttf' || target === 'eot')
    btn.querySelector('span').textContent = n > 1 ? `Convert ${n} fonts to ${FONT_LABEL[target]}` : `Convert to ${FONT_LABEL[target]}`
  }

  btn.addEventListener('click', () => busy(btn, async () => {
    const files = [...list.files], to = target
    results.clear()
    list.setDisabled(true)
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        prog.set(i / files.length, `Converting ${f.name}`)
        try {
          const out = await convertFont(f, to, { accuracy: accuracy.value }, { signal, onProgress: (p) => prog.set((i + p) / files.length, `Converting ${f.name}`) })
          const kind = ext(f.name) === to ? 'rewritten as a clean ' + FONT_LABEL[to] : ''
          results.add(out, { from: f.size, note: kind })
        } catch (e) {
          if (e.code === 'ABORT') return
          console.error(e)
          results.error(f.name, e)
        }
      }
    } finally { list.setDisabled(false) }
  }, { label: 'Converting', progress: prog }))

  sync()
}
