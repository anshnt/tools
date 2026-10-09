// Office metadata remover: inspect and strip personal data from .docx, .xlsx and .pptx (and their macro-enabled twins). Runs locally with JSZip.
import { h, icon, panel, button, dropzone, alert, clear, busy, progress, stats, formatBytes, download, toast, table } from '../../lib/ui.js'
import { jszip } from '../../lib/libs.js'
import { ext, baseName, zip as zipFiles } from '../../lib/files.js'
import { useStyles, chip, burst } from './_shared.js'

const MAX_FILE = 300 * 1024 * 1024
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', docm: 'application/vnd.ms-word.document.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
}
const KIND = { docx: 'Word', docm: 'Word', xlsx: 'Excel', xlsm: 'Excel', pptx: 'PowerPoint', pptm: 'PowerPoint' }
const KIND_ICON = { Word: 'file-text', Excel: 'file-spreadsheet', PowerPoint: 'presentation' }

const CORE_LABELS = {
  'dc:title': 'Title', 'dc:subject': 'Subject', 'dc:creator': 'Author', 'cp:keywords': 'Keywords', 'dc:description': 'Comments', 'cp:lastModifiedBy': 'Last modified by', 'cp:revision': 'Revision',
  'dcterms:created': 'Created', 'dcterms:modified': 'Modified', 'cp:lastPrinted': 'Last printed', 'cp:category': 'Category', 'cp:contentStatus': 'Status',
}
const APP_LABELS = { Application: 'Application', AppVersion: 'App version', Company: 'Company', Manager: 'Manager', Template: 'Template', TotalTime: 'Editing time (min)', HyperlinkBase: 'Hyperlink base' }
const PERSONAL = new Set(['dc:creator', 'cp:lastModifiedBy', 'Company', 'Manager'])

/** What each option removes. core = tags in docProps/core.xml, app = tags in docProps/app.xml. */
export const OPTIONS = [
  { id: 'people', label: 'Author and last modified by', core: ['dc:creator', 'cp:lastModifiedBy'], on: true },
  { id: 'org', label: 'Company and manager', app: ['Company', 'Manager'], on: true },
  { id: 'descr', label: 'Title, subject, keywords, comments', core: ['dc:title', 'dc:subject', 'cp:keywords', 'dc:description', 'cp:category', 'cp:contentStatus'], on: true },
  { id: 'revision', label: 'Revision, editing time, template', core: ['cp:revision'], app: ['TotalTime', 'Template', 'HyperlinkBase'], on: true },
  { id: 'dates', label: 'Created, modified and printed dates', core: ['dcterms:created', 'dcterms:modified', 'cp:lastPrinted'], on: true },
  { id: 'custom', label: 'Custom properties', on: true },
  { id: 'thumb', label: 'Preview thumbnail', on: true },
  { id: 'anon', label: 'Names on comments and tracked changes', on: true },
  { id: 'app', label: 'Application name and version', app: ['Application', 'AppVersion'], on: false },
]

const tagRe = (tag) => new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</${tag}>)`, 'g')
const textOf = (xml, tag) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml); return m ? unescapeXml(m[1]).trim() : '' }
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const count = (xml, re) => (xml.match(re) || []).length

async function readText(zip, path) { const f = zip.file(path); return f ? f.async('string') : '' }
const names = (zip, re) => Object.keys(zip.files).filter((n) => !zip.files[n].dir && re.test(n))

/** Open an Office file and report everything personal in it. */
export async function analyze(blob, fileName) {
  const JSZip = await jszip()
  let zip
  try { zip = await JSZip.loadAsync(blob) } catch { throw new Error('This is not a valid Office Open XML file. Older .doc, .xls and .ppt files are not supported: open them in Office and save as .docx, .xlsx or .pptx first.') }
  if (!zip.file('[Content_Types].xml')) throw new Error('This does not look like an Office document (no [Content_Types].xml).')
  const e = ext(fileName)
  const core = {}, app = {}
  const coreXml = await readText(zip, 'docProps/core.xml')
  const appXml = await readText(zip, 'docProps/app.xml')
  for (const t of Object.keys(CORE_LABELS)) core[t] = textOf(coreXml, t)
  for (const t of Object.keys(APP_LABELS)) app[t] = textOf(appXml, t)
  const customXml = await readText(zip, 'docProps/custom.xml')
  const custom = [...customXml.matchAll(/<property\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/property>/g)].map((m) => ({ name: unescapeXml(m[1]), value: unescapeXml(m[2].replace(/<[^>]+>/g, '')).trim() }))
  const thumb = names(zip, /^docProps\/thumbnail\./i).length > 0

  const authors = new Set()
  let comments = 0, tracked = 0, hiddenSheets = 0, notes = 0, extLinks = 0
  const embedded = names(zip, /\/embeddings\//i).length
  const macros = names(zip, /vbaProject\.bin$/i).length > 0
  for (const n of names(zip, /^word\/[^/]+\.xml$/)) {
    const x = await readText(zip, n)
    for (const m of x.matchAll(/\bw(?:15)?:author="([^"]*)"/g)) authors.add(unescapeXml(m[1]))
    if (n === 'word/comments.xml') comments += count(x, /<w:comment\s/g)
    tracked += count(x, /<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange)\s/g)
  }
  for (const n of names(zip, /^xl\/(?:comments(?:\/[^/]+|[^/]*)\.xml|threadedComments\/[^/]+\.xml)$/)) {
    const x = await readText(zip, n)
    comments += count(x, /<(?:comment|threadedComment)\s/g)
    for (const m of x.matchAll(/<author>([^<]*)<\/author>/g)) authors.add(unescapeXml(m[1]))
  }
  for (const n of names(zip, /^xl\/persons\/[^/]+\.xml$/)) for (const m of (await readText(zip, n)).matchAll(/\bdisplayName="([^"]*)"/g)) authors.add(unescapeXml(m[1]))
  tracked += count(await readText(zip, 'xl/revisions/revisionHeaders.xml'), /<header\s/g)
  const wb = await readText(zip, 'xl/workbook.xml')
  hiddenSheets = count(wb, /<sheet\b[^>]*\bstate="(?:hidden|veryHidden)"/g)
  extLinks = names(zip, /^xl\/externalLinks\/[^/]+\.xml$/).length
  for (const n of names(zip, /^ppt\/comments\/[^/]+\.xml$/)) comments += count(await readText(zip, n), /<(?:\w+:)?cm\s/g)
  for (const n of names(zip, /^ppt\/(?:commentAuthors|authors)\.xml$/)) for (const m of (await readText(zip, n)).matchAll(/\bname="([^"]*)"/g)) authors.add(unescapeXml(m[1]))
  for (const n of names(zip, /^ppt\/notesSlides\/[^/]+\.xml$/)) if (/<a:t>[^<]*\S[^<]*<\/a:t>/.test(await readText(zip, n))) notes++
  authors.delete('')
  return { zip, ext: e, kind: KIND[e] || 'Office', core, app, custom, thumb, authors: [...authors], comments, tracked, hiddenSheets, notes, extLinks, embedded, macros, hasCore: !!coreXml, hasApp: !!appXml }
}

/** Apply the chosen options to an analysed file. Returns { blob, removed }. */
export async function clean(info, opts, fileName) {
  const { zip } = info
  const on = (id) => !!opts[id]
  const coreTags = OPTIONS.filter((o) => on(o.id)).flatMap((o) => o.core || [])
  const appTags = OPTIONS.filter((o) => on(o.id)).flatMap((o) => o.app || [])
  let removed = 0
  const edit = async (path, fn) => {
    const f = zip.file(path)
    if (!f) return
    const before = await f.async('string')
    const after = fn(before)
    if (after !== before) zip.file(path, after)
  }
  const dropTags = (tags) => (xml) => tags.reduce((x, t) => x.replace(tagRe(t), (m) => { if (m.replace(/^<[^>]*>/, '').replace(/<\/[^>]*>$/, '').trim()) removed++; return '' }), xml)
  if (coreTags.length) await edit('docProps/core.xml', dropTags(coreTags))
  if (appTags.length) await edit('docProps/app.xml', dropTags(appTags))
  if (on('custom') && info.custom.length) {
    removed += info.custom.length
    await edit('docProps/custom.xml', (x) => x.replace(/(<Properties\b[^>]*[^/]>)[\s\S]*(<\/Properties>)/, '$1$2'))
  }
  if (on('thumb') && info.thumb) {
    for (const n of names(zip, /^docProps\/thumbnail\./i)) zip.remove(n)
    await edit('_rels/.rels', (x) => x.replace(/<Relationship\b[^>]*Type="[^"]*\/thumbnail"[^>]*\/>/g, ''))
    removed++
  }
  if (on('anon')) {
    const anonWord = (x) => x.replace(/(\bw(?:15)?:author=")[^"]*"/g, '$1Author"').replace(/(\bw:initials=")[^"]*"/g, '$1A"').replace(/<w15:presenceInfo\b[^>]*\/>/g, '')
    for (const n of names(zip, /^word\/[^/]+\.xml$/)) await edit(n, anonWord)
    removed += info.authors.length
    for (const n of names(zip, /^xl\/comments(?:\/[^/]+|[^/]*)\.xml$/)) await edit(n, (x) => x.replace(/<author>[^<]*<\/author>/g, '<author>Author</author>'))
    for (const n of names(zip, /^xl\/persons\/[^/]+\.xml$/)) await edit(n, (x) => x.replace(/\b(displayName|userId|providerId)="[^"]*"/g, (m, k) => `${k}="${k === 'displayName' ? 'Author' : ''}"`))
    for (const n of names(zip, /^ppt\/(?:commentAuthors|authors)\.xml$/)) await edit(n, (x) => x.replace(/\bname="[^"]*"/g, 'name="Author"').replace(/\binitials="[^"]*"/g, 'initials="A"').replace(/\b(userId|providerId)="[^"]*"/g, '$1=""'))
  }
  const mime = MIME[ext(fileName)] || 'application/octet-stream'
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: mime })
  return { blob, removed }
}

const CSS = `
.sx-om-file{display:flex;flex-direction:column;gap:12px}
.sx-om-head{display:flex;gap:12px;align-items:center}
.sx-om-head .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);flex:none}
.sx-om-head .meta{min-width:0;flex:1}.sx-om-head .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sx-om-head .size{font-size:12.5px;color:var(--muted)}
.sx-om-tags{display:flex;flex-wrap:wrap;gap:6px}
.sx-om-tag{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:4px 10px;border-radius:99px;border:1px solid var(--border);background:var(--surface-2);max-width:100%}
.sx-om-tag .icon{width:13px;height:13px;flex:none}
.sx-om-tag.warn{background:var(--warning-soft,rgba(245,158,11,.12));border-color:color-mix(in srgb,#f59e0b 45%,var(--border));color:var(--text)}
.sx-om-tag.ok{background:var(--success-soft);border-color:color-mix(in srgb,var(--success) 40%,transparent);color:var(--success)}
.sx-om-tag span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sx-om-kv{display:grid;grid-template-columns:minmax(120px,170px) 1fr;gap:6px 14px;font-size:13.5px}
.sx-om-kv dt{color:var(--muted)}.sx-om-kv dd{margin:0;overflow-wrap:anywhere;font-family:var(--mono);font-size:13px}
.sx-om-kv dd.personal{color:var(--danger);font-weight:600}.sx-om-kv dd.none{color:var(--muted);font-family:var(--font)}
.sx-om-done{animation:sx-in .45s var(--ease) both}
@media (max-width:560px){.sx-om-kv{grid-template-columns:1fr}.sx-om-kv dt{margin-top:6px}}
`

export function mount(root) {
  useStyles('sx-office', CSS)
  /** @type {{id:number,file:File,info:object,result?:object}[]} */
  let items = []
  let nextId = 1
  const opts = Object.fromEntries(OPTIONS.map((o) => [o.id, o.on]))
  const listHost = h('div', { class: 'stack' })
  const resultHost = h('div', { class: 'stack' })
  const prog = progress('Cleaning')
  const go = button('Clean files', { icon: 'eraser', variant: 'primary', size: 'lg' })
  const optPanel = panel(h('div', { class: 'stack' }, h('div', { class: 'sx-k' }, icon('list-checks'), 'What to remove'),
    h('div', { class: 'sx-chips' }, OPTIONS.map((o) => chip(o.label, o.on, (v) => { opts[o.id] = v }))),
    h('div', { class: 'sx-hint' }, 'Page content, text, images and formatting are never touched. Comments and tracked changes stay, but their author names are replaced when "Names on comments" is on.')))
  const actions = h('div', { class: 'stack' }, optPanel, h('div', { class: 'row' }, go), prog.el, resultHost)
  actions.hidden = true

  const tag = (ic, text, cls = '') => h('span', { class: ['sx-om-tag', cls] }, icon(ic), h('span', { title: text }, text))
  function summaryTags(i, after) {
    const t = []
    const people = [i.core['dc:creator'], i.core['cp:lastModifiedBy']].filter(Boolean)
    if (people.length) t.push(tag('user', [...new Set(people)].join(', '), after ? 'warn' : 'warn'))
    if (i.app.Company) t.push(tag('building-2', i.app.Company, 'warn'))
    if (i.authors.length) t.push(tag('users', `${i.authors.length} name${i.authors.length === 1 ? '' : 's'} in comments or edits: ${i.authors.slice(0, 3).join(', ')}${i.authors.length > 3 ? '...' : ''}`, 'warn'))
    if (i.custom.length) t.push(tag('tags', `${i.custom.length} custom propert${i.custom.length === 1 ? 'y' : 'ies'}`, 'warn'))
    if (i.thumb) t.push(tag('image', 'Preview thumbnail'))
    if (i.comments) t.push(tag('message-square', `${i.comments} comment${i.comments === 1 ? '' : 's'} (kept)`))
    if (i.tracked) t.push(tag('git-compare', `${i.tracked} tracked change${i.tracked === 1 ? '' : 's'} (kept)`))
    if (i.hiddenSheets) t.push(tag('eye-off', `${i.hiddenSheets} hidden sheet${i.hiddenSheets === 1 ? '' : 's'} (kept)`))
    if (i.notes) t.push(tag('sticky-note', `${i.notes} slide${i.notes === 1 ? '' : 's'} with speaker notes (kept)`))
    if (i.extLinks) t.push(tag('link', `${i.extLinks} external link${i.extLinks === 1 ? '' : 's'} (kept)`))
    if (i.embedded) t.push(tag('paperclip', `${i.embedded} embedded object${i.embedded === 1 ? '' : 's'} (kept)`))
    if (i.macros) t.push(tag('code', 'Contains macros'))
    if (!t.length) t.push(tag('shield-check', 'No personal metadata found', 'ok'))
    return h('div', { class: 'sx-om-tags' }, t)
  }
  function kv(i, before) {
    const rows = []
    for (const [t, label] of Object.entries(CORE_LABELS)) if (i.core[t] || before?.core[t]) rows.push([t, label, i.core[t], before?.core[t]])
    for (const [t, label] of Object.entries(APP_LABELS)) if (i.app[t] || before?.app[t]) rows.push([t, label, i.app[t], before?.app[t]])
    const dl = h('dl', { class: 'sx-om-kv' })
    for (const [t, label, v] of rows) dl.append(h('dt', label), h('dd', { class: [PERSONAL.has(t) && v && 'personal', !v && 'none'] }, v || (before ? 'removed' : '(empty)')))
    for (const c of i.custom) dl.append(h('dt', `Custom: ${c.name}`), h('dd', c.value || '(empty)'))
    if (!rows.length && !i.custom.length) dl.append(h('dt', 'Properties'), h('dd', { class: 'none' }, 'None stored in this file'))
    return dl
  }

  function render() {
    actions.hidden = !items.length
    clear(listHost, items.map((it) => h('section', { class: 'panel sx-om-file' },
      h('div', { class: 'sx-om-head' }, h('div', { class: 'ic' }, icon(KIND_ICON[it.info.kind] || 'file')), h('div', { class: 'meta' }, h('div', { class: 'name', title: it.file.name }, it.file.name), h('div', { class: 'size' }, `${it.info.kind} - ${formatBytes(it.file.size)}`)),
        button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove ${it.file.name}`, onClick: () => { items = items.filter((x) => x !== it); clear(resultHost); render() } })),
      summaryTags(it.info),
      h('details', {}, h('summary', { style: 'cursor:pointer;font-weight:600;font-size:14px' }, 'Show the stored properties'), h('div', { style: 'margin-top:12px' }, kv(it.info))))))
  }

  async function addFiles(files) {
    for (const f of files) {
      if (f.size > MAX_FILE) { toast(`${f.name} is larger than ${formatBytes(MAX_FILE)}`, 'error'); continue }
      try {
        const info = await analyze(f, f.name)
        items.push({ id: nextId++, file: f, info })
      } catch (e) { toast(`${f.name}: ${e.message}`, 'error') }
    }
    clear(resultHost)
    render()
  }

  go.addEventListener('click', () => busy(go, async () => {
    clear(resultHost)
    if (!items.length) throw new Error('Add a file first.')
    const out = []
    let n = 0
    for (const it of items) {
      prog.set(n / items.length, `Cleaning ${it.file.name}`)
      // analyse afresh each time so changing options and cleaning again always starts from the original
      const info = await analyze(it.file, it.file.name)
      const { blob, removed } = await clean(info, opts, it.file.name)
      const after = await analyze(blob, it.file.name)
      out.push({ it, blob, removed, after, name: `${baseName(it.file.name)}-clean.${ext(it.file.name)}` })
      n++
    }
    prog.set(1)
    const total = out.reduce((a, r) => a + r.removed, 0)
    clear(resultHost, h('div', { class: 'stack sx-om-done' },
      alert('success', h('strong', `${out.length} file${out.length === 1 ? '' : 's'} cleaned. `), total ? `Removed ${total} item${total === 1 ? '' : 's'} of personal metadata.` : 'There was nothing selected to remove.'),
      ...out.map((r) => h('section', { class: 'panel sx-om-file' },
        h('div', { class: 'sx-om-head' }, h('div', { class: 'ic' }, icon('shield-check')), h('div', { class: 'meta' }, h('div', { class: 'name', title: r.name }, r.name), h('div', { class: 'size' }, `${formatBytes(r.it.file.size)} to ${formatBytes(r.blob.size)}`)),
          button('Download', { icon: 'download', variant: 'primary', size: 'sm', onClick: () => download(r.blob, r.name) })),
        summaryTags(r.after, true),
        h('details', {}, h('summary', { style: 'cursor:pointer;font-weight:600;font-size:14px' }, 'Check what is left'), h('div', { style: 'margin-top:12px' }, kv(r.after, r.it.info))))),
      out.length > 1 ? h('div', { class: 'row' }, button('Download all as ZIP', { icon: 'folder-archive', variant: 'primary', onClick: async () => download(await zipFiles(out.map((r) => ({ name: r.name, data: r.blob }))), 'cleaned-documents.zip') })) : null))
    burst(go)
  }, { label: 'Cleaning', errorTo: resultHost, progress: prog }))

  root.append(h('div', { class: 'sx stack' },
    dropzone({ accept: '.docx,.xlsx,.pptx,.docm,.xlsm,.pptm', multiple: true, label: 'Drop Word, Excel or PowerPoint files', hint: '.docx, .xlsx and .pptx. Files never leave your device.', onFiles: addFiles }),
    listHost, actions,
    h('div', { class: 'sx-hint' }, 'Tip: also check headers, footers, hidden sheets, speaker notes and comments yourself before sharing. Office\'s own Document Inspector can remove those.')))
}
