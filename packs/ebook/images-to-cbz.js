// Pictures to a CBZ comic book: drop images, put them in reading order, save one .cbz that every comic reader opens.
import { h, dropzone, fileList, button, busy, progress, alert, panel, field, input, toggle, downloadButton, clear, formatBytes } from '../../lib/ui.js'
import { naturalCompare } from './_book.js'
import { imagesToCbz } from './_convert.js'

export function mount(root) {
  const result = h('div')
  const prog = progress()
  const list = fileList({ onChange: () => update() })
  const title = input({ placeholder: 'Comic', 'aria-label': 'File name' })
  const sortBtn = button('Sort by name', { icon: 'arrow-down-a-z', size: 'sm', onClick: () => list.set([...list.files].sort((a, b) => naturalCompare(a.name, b.name))) })
  const auto = toggle('Put the pictures in natural name order (page2 before page10)', true)
  const goBtn = button('Create CBZ', { icon: 'book-image', variant: 'primary', size: 'lg' })
  const zone = dropzone({ accept: 'image/*,.heic,.heif,.avif,.bmp,.tif,.tiff', multiple: true, label: 'Drop pictures here or click to choose', hint: 'JPG, PNG, WebP, GIF, BMP, AVIF, HEIC. Pages follow the order below.', onFiles: (fs) => { list.add(fs); if (auto.input.checked) list.set([...list.files].sort((a, b) => naturalCompare(a.name, b.name))) } })


  function update() {
    const n = list.files.length
    goBtn.disabled = !n
    zone.classList.toggle('compact', n > 0)
    goBtn.querySelector('span').textContent = n ? `Create CBZ from ${n} picture${n === 1 ? '' : 's'}` : 'Create CBZ'
  }
  goBtn.addEventListener('click', () => busy(goBtn, async () => {
    const files = [...list.files]
    clear(result)
    list.setDisabled(true)
    try {
      const name = title.value.trim().replace(/[\/:*?"<>|]+/g, '_') || 'comic'
      const out = await imagesToCbz(files, { sort: false, name, title: title.value.trim() }, (p, t) => prog.set(p, t || 'Working'))
      clear(result, alert('success', h('strong', 'Done. '), `${files.length} pages, ${formatBytes(out.size)}.`),
        h('div', { class: 'row', style: 'margin-top:12px' }, downloadButton(out, out.name, 'Download CBZ', { size: 'lg' })))
    } finally { list.setDisabled(false) }
  }, { label: 'Creating', errorTo: result, progress: prog }))
  update()
  root.append(h('div', { class: 'stack' }, zone, list.el,
    panel(h('div', { class: 'stack' }, field('Comic title (also the file name)', title), auto, h('div', { class: 'row' }, goBtn, sortBtn, h('span', { class: 'small muted' }, 'Drag or use the arrows to reorder. Pictures never leave your device.')))),
    prog.el, result))
}
