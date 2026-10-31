// Edit the metadata of an EPUB in place (title, authors, language, publisher, description, date, cover) without touching the book itself:
// every other file is copied byte for byte and the "mimetype" entry stays first and stored.
import { jszip } from '../../lib/libs.js'
import { fail, resolvePath, sniffImage, IMAGE_EXT } from './_book.js'

const DC = 'http://purl.org/dc/elements/1.1/'
const OPF = 'http://www.idpf.org/2007/opf'
const local = (el, n) => [...el.getElementsByTagNameNS('*', n)]
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '')

/** Open an EPUB and return its editable fields and cover. */
export async function loadEpubForEdit(file) {
  const JSZip = await jszip()
  let zip
  try { zip = await JSZip.loadAsync(file) } catch { throw fail('This EPUB could not be opened. It may be damaged.', 'BAD') }
  const container = zip.file('META-INF/container.xml')
  const opfPath = container && (await container.async('string')).match(/full-path\s*=\s*"([^"]+)"/)?.[1]
  if (!opfPath || !zip.file(opfPath)) throw fail('This file has no EPUB package (OPF), so its details cannot be edited.', 'BAD')
  const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml')
  if (opf.querySelector('parsererror')) throw fail('The package file of this EPUB is damaged.', 'BAD')
  const md = local(opf, 'metadata')[0]
  if (!md) throw fail('This EPUB has no metadata section.', 'BAD')
  const one = (n) => txt(local(md, n)[0])
  const items = local(opf, 'item')
  const coverId = local(md, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
  const coverItem = items.find((i) => i.getAttribute('id') === coverId) || items.find((i) => /\bcover-image\b/.test(i.getAttribute('properties') || ''))
  let cover = null
  if (coverItem) {
    const path = resolvePath(opfPath, coverItem.getAttribute('href') || '')
    const f = zip.file(path)
    if (f) { const data = await f.async('uint8array'); cover = { path, data, type: sniffImage(data) || coverItem.getAttribute('media-type') } }
  }
  const encrypted = !!zip.file('META-INF/encryption.xml') && /Algorithm\s*=\s*"(?!http:\/\/www\.idpf\.org\/2008\/embedding|http:\/\/ns\.adobe\.com\/pdf\/enc#RC)/.test(await zip.file('META-INF/encryption.xml').async('string'))
  return {
    zip, opfPath, opf, cover, encrypted, names: Object.keys(zip.files).filter((n) => !zip.files[n].dir),
    fields: {
      title: one('title'), authors: local(md, 'creator').map(txt).filter(Boolean), language: one('language'),
      publisher: one('publisher'), description: one('description'), date: one('date'), identifier: one('identifier'),
    },
  }
}

function setDc(opf, md, name, value) {
  const existing = local(md, name)[0]
  if (!value) { for (const e of local(md, name)) e.remove(); return }
  if (existing) { existing.textContent = value; return }
  const el = opf.createElementNS(DC, `dc:${name}`)
  el.textContent = value
  md.append(el)
}

/**
 * Write the edited EPUB. fields: { title, authors: [], language, publisher, description, date }.
 * newCover: { data, type } to replace the cover, 'remove' to drop it, or null to keep it. Returns a Blob.
 */
export async function saveEpubEdit(state, fields, newCover = null) {
  const JSZip = await jszip()
  const { zip, opfPath, opf } = state
  const md = local(opf, 'metadata')[0]
  const manifest = local(opf, 'manifest')[0]
  const version = opf.documentElement.getAttribute('version') || '2.0'
  if (!fields.title?.trim()) throw fail('Enter a title.', 'INVALID')
  setDc(opf, md, 'title', fields.title.trim())
  for (const e of local(md, 'creator')) e.remove()
  for (const a of fields.authors.filter(Boolean)) {
    const el = opf.createElementNS(DC, 'dc:creator')
    el.textContent = a
    md.append(el)
  }
  setDc(opf, md, 'language', fields.language.trim() || 'en')
  setDc(opf, md, 'publisher', fields.publisher.trim())
  setDc(opf, md, 'description', fields.description.trim())
  setDc(opf, md, 'date', fields.date.trim())
  const modified = local(md, 'meta').find((m) => m.getAttribute('property') === 'dcterms:modified')
  if (modified) modified.textContent = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const replaced = new Map() // path -> bytes
  const removed = new Set()
  let rename = null // pages that show the cover keep working when its file name changes
  if (newCover) {
    const items = local(opf, 'item')
    const coverId = local(md, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content')
    const item = items.find((i) => i.getAttribute('id') === coverId) || items.find((i) => /\bcover-image\b/.test(i.getAttribute('properties') || ''))
    if (newCover === 'remove') {
      if (item) { removed.add(resolvePath(opfPath, item.getAttribute('href'))); item.remove() }
      for (const m of local(md, 'meta').filter((x) => x.getAttribute('name') === 'cover')) m.remove()
    } else {
      const type = sniffImage(newCover.data) || newCover.type
      if (!/^image\/(jpeg|png|gif|webp)$/.test(type || '')) throw fail('Use a JPG, PNG, GIF or WebP picture for the cover.', 'INVALID')
      const ext = IMAGE_EXT[type]
      if (item) {
        const oldPath = resolvePath(opfPath, item.getAttribute('href'))
        const newPath = oldPath.replace(/\.[^./]+$/, `.${ext}`)
        if (newPath !== oldPath) { rename = [oldPath.split('/').pop(), newPath.split('/').pop()]; removed.add(oldPath); item.setAttribute('href', item.getAttribute('href').replace(/\.[^./]+$/, `.${ext}`)) }
        item.setAttribute('media-type', type)
        replaced.set(newPath, newCover.data)
      } else {
        let id = 'cover-image'
        while (items.some((i) => i.getAttribute('id') === id)) id += '-x'
        const href = `images/cover.${ext}`
        const el = opf.createElementNS(OPF, 'item')
        el.setAttribute('id', id)
        el.setAttribute('href', href)
        el.setAttribute('media-type', type)
        if (version.startsWith('3')) el.setAttribute('properties', 'cover-image')
        manifest.append(el)
        const meta = opf.createElementNS(OPF, 'meta')
        meta.setAttribute('name', 'cover')
        meta.setAttribute('content', id)
        md.append(meta)
        replaced.set(resolvePath(opfPath, href), newCover.data)
      }
    }
  }

  let xml = new XMLSerializer().serializeToString(opf)
  if (!/^<\?xml/.test(xml)) xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`
  const out = new JSZip()
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE', createFolders: false })
  const written = new Set(['mimetype'])
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name]
    if (entry.dir || name === 'mimetype' || removed.has(name)) continue
    let data = name === opfPath ? xml : replaced.has(name) ? replaced.get(name) : await entry.async('uint8array')
    if (rename && name !== opfPath && !replaced.has(name) && /\.(x?html?|css|svg|ncx)$/i.test(name)) {
      const t = new TextDecoder().decode(data)
      if (t.includes(rename[0])) data = t.split(rename[0]).join(rename[1])
    }
    out.file(name, data, { createFolders: false, compression: /\.(jpe?g|png|gif|webp|mp3|mp4|woff2?)$/i.test(name) ? 'STORE' : 'DEFLATE' })
    written.add(name)
  }
  for (const [name, data] of replaced) if (!written.has(name)) out.file(name, data, { createFolders: false, compression: 'STORE' })
  return out.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
}

