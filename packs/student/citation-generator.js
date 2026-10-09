// Citation generator: book, article, website, video and report in APA 7, MLA 9, Chicago, Harvard and IEEE.
// One module serves five catalog entries: params.style locks the style, params.list opens on the bibliography.
import { h, button, busy, field, select, segmented, alert, clear, copyText, download, toast, modal, textarea } from '../../lib/ui.js'
import { docx as loadDocx } from '../../lib/libs.js'
import { load, save } from '../../lib/store.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, confirmModal, uid } from './_kit.js'
import * as C from './_cite.js'

const CSS = `
.t-cite .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.t-cite .a-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto; gap: 6px; align-items: center; margin-bottom: 6px; }
.t-cite .a-row .input { height: 38px; }
.t-cite .a-row.org { grid-template-columns: minmax(0, 1fr) auto auto; }
.t-cite .org-t { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; }
.t-cite .ref { padding: 14px 16px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); line-height: 1.6; font-size: 15px; overflow-wrap: anywhere; }
.t-cite .ref.hang { padding-left: calc(16px + 1.8em); text-indent: -1.8em; }
.t-cite .ref i { font-style: italic; }
.t-cite .ref.live { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 8%, transparent); }
.t-cite .it { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 12px; border-radius: 12px; background: var(--surface-2); font-size: 14px; }
.t-cite .it .lbl { font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; min-width: 72px; }
.t-cite .it .val { flex: 1; min-width: 120px; overflow-wrap: anywhere; }
.t-cite .bib-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; padding: 10px 0; border-bottom: 1px dashed var(--border); animation: stu-pop .35s var(--ease) both; }
.t-cite .bib-item:last-child { border-bottom: 0; }
.t-cite .bib-ref { line-height: 1.55; font-size: 14.5px; overflow-wrap: anywhere; }
.t-cite .bib-ref.hang { padding-left: 1.8em; text-indent: -1.8em; }
.t-cite .tips { margin: 0; padding-left: 18px; font-size: 13px; color: var(--text-2); display: grid; gap: 4px; }
.t-cite .fine { font-size: 12px; color: var(--muted); margin-top: 6px; }
.t-cite .casing { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
`

const TIPS = {
  apa: ['Book, report, web page and video titles are in italics. Article titles are plain, in sentence case.', 'List up to 20 authors, with an ampersand before the last one. No author? The title moves to the front.', 'Give the DOI as a link (https://doi.org/...). The reference list is alphabetical with a hanging indent.'],
  mla: ['Article, web page and video titles go in quotation marks. Books and websites (the container) are in italics.', 'Three or more authors become "First Author, et al." in the list and in the text.', 'Drop https:// from web addresses. An access date is optional but helpful for pages that change.'],
  chicago: ['Author-date style: the year comes right after the author in the list and in the text, for example (Smith 2020, 12).', 'Up to ten authors are listed. More than ten: list seven, then "et al."', 'Titles of articles and pages are in quotation marks; books and journals are italic.'],
  harvard: ['This follows the widely used Cite Them Right layout: Author (Year) Title. Place: Publisher.', 'Web sources need an "Available at" link and the date you accessed them.', 'Four or more authors become "First Author et al." Check whether your university has its own variation.'],
  ieee: ['References are numbered in the order they are first cited: [1], [2], ... and the text cites just the number.', 'Authors use initials first: J. K. Smith. Article titles are in quotation marks, journal names in italics.', 'Web sources end with "[Online]. Available: URL (accessed Mon. DD, YYYY)."'],
}
const LIST_TITLE = { apa: 'References', mla: 'Works Cited', chicago: 'References', harvard: 'Reference list', ieee: 'References' }

const ORIGIN = { crossref: 'https://api.crossref.org/works/', ol: 'https://openlibrary.org' }

async function getJson(url, signal) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 12000)
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } })
    if (r.status === 404) throw Object.assign(new Error('No match found. Check the number and try again.'), { code: 'NOTFOUND' })
    if (r.status === 429) throw new Error('The lookup service is busy. Wait a moment and try again.')
    if (!r.ok) throw new Error(`The lookup service answered with an error (${r.status}).`)
    return await r.json()
  } catch (e) {
    if (e?.code === 'NOTFOUND' || /lookup service|No match/.test(e?.message || '')) throw e
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'ABORT' })
    throw new Error(ctl.signal.aborted ? 'The lookup service took too long to answer. Try again, or fill the fields in by hand.' : 'Could not reach the lookup service. Check your connection, or fill the fields in by hand.')
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** DOI or ISBN text -> source (or a website stub for a URL). Throws readable errors. */
export async function lookupSource(text, signal) {
  const q = C.detectLookup(text)
  if (q.kind === 'doi') {
    const j = await getJson(ORIGIN.crossref + encodeURI(q.value).replace(/[?#]/g, encodeURIComponent), signal)
    return { src: C.fromCrossref(j.message), note: 'Found on Crossref. Check the details, especially capitalisation.' }
  }
  if (q.kind === 'isbn') {
    const ed = await getJson(`${ORIGIN.ol}/isbn/${q.value}.json`, signal)
    let keys = (ed.authors || []).map((a) => a.key)
    if (!keys.length && ed.works?.[0]?.key) {
      try { keys = ((await getJson(`${ORIGIN.ol}${ed.works[0].key}.json`, signal)).authors || []).map((a) => a.author?.key).filter(Boolean) } catch { /* authors stay empty */ }
    }
    const names = (await Promise.all(keys.slice(0, 8).map((k) => getJson(`${ORIGIN.ol}${k}.json`, signal).then((a) => a.name).catch(() => null)))).filter(Boolean)
    return { src: C.fromOpenLibrary(ed, names), note: 'Found on Open Library. Add the edition or city if you need them.' }
  }
  if (q.kind === 'url') {
    const s = C.emptySource('website')
    Object.assign(s, { url: q.value, container: C.siteFromUrl(q.value), accessed: C.todayISO(), authors: [{ first: '', last: '', org: false }] })
    return { src: s, note: 'Browsers cannot read other websites, so add the page title, author and date from the page itself.' }
  }
  throw new Error('Paste a DOI (10.1000/xyz123), an ISBN (10 or 13 digits) or a web address.')
}

const richCopy = async (html, text) => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
    toast('Copied with formatting', 'success')
  } catch { copyText(text) }
}
const hangHtml = (items, style) => items.map((f) => `<p style="margin:0 0 8px;${style === 'ieee' ? '' : 'padding-left:0.5in;text-indent:-0.5in;'}">${f.html}</p>`).join('')

function textRuns(html, TextRun) {
  return html.split(/(<i>.*?<\/i>)/g).filter(Boolean).map((part) => {
    const it = part.startsWith('<i>')
    const t = C.htmlText(it ? part.slice(3, -4) : part)
    return new TextRun({ text: t, italics: it, font: 'Times New Roman', size: 24 })
  })
}
async function bibDocx(items, style) {
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = await loadDocx()
  const doc = new Document({
    sections: [{ children: [
      new Paragraph({ alignment: style === 'mla' || style === 'apa' ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 240 }, children: [new TextRun({ text: LIST_TITLE[style], bold: true, font: 'Times New Roman', size: 28 })] }),
      ...items.map((f) => new Paragraph({ spacing: { after: 120, line: 360 }, indent: style === 'ieee' ? undefined : { left: 720, hanging: 720 }, children: textRuns(f.html, TextRun) })),
    ] }],
  })
  return Packer.toBlob(doc)
}

export function mount(root, { params = {} } = {}) {
  toolStyle('cite', CSS)
  const lockedStyle = params.style || null
  const saved = load('cite:state', {})
  const st = {
    style: lockedStyle || saved.style || 'apa',
    list: (saved.list || []).filter((x) => x?.src),
    src: C.emptySource('book'), page: '', editing: null,
  }
  const persist = () => save('cite:state', { style: lockedStyle ? saved.style : st.style, list: st.list })
  const styleName = () => C.STYLES.find((s) => s[0] === st.style)[1]

  const lookupIn = h('input', { class: 'input', type: 'text', placeholder: 'Paste a DOI or ISBN, e.g. 10.1038/nature14539 or 9780132350884', 'aria-label': 'DOI, ISBN or web address', onkeydown: (e) => { if (e.key === 'Enter') lookupBtn.click() } })
  const lookupBtn = button('Look up', { variant: 'primary', icon: 'search' })
  const lookupOut = h('div')
  const formBox = h('div', { class: 'stack' })
  const refBox = h('div', { class: 'stack' })
  const bibBox = h('div')
  const bibHead = h('div')

  // ---------- form ----------
  const bind = (key, props = {}) => h('input', { class: 'input', type: 'text', value: st.src[key] ?? '', 'aria-label': props.label, placeholder: props.ph || '', inputmode: props.mode || null, oninput: (e) => { st.src[key] = e.target.value; update() } })
  const F = (label, key, props = {}) => field(label, bind(key, { label, ...props }), props.hint)
  const dateFields = (withDay) => h('div', { class: 'grid2' }, F('Year', 'year', { ph: '2024', mode: 'numeric' }),
    field('Month', select([['', '-'], ...C_MONTHS.map((m, i) => [String(i + 1), m])], st.src.month, (v) => { st.src.month = v; update() })),
    withDay ? F('Day', 'day', { ph: '1-31', mode: 'numeric' }) : null)
  const C_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  function authorRows() {
    const box = h('div')
    const draw = () => {
      clear(box, st.src.authors.map((a, i) => h('div', { class: ['a-row', a.org && 'org'] },
        a.org ? h('input', { class: 'input', value: a.last, placeholder: 'Organisation or channel name', 'aria-label': `Organisation ${i + 1}`, oninput: (e) => { a.last = e.target.value; update() } })
          : h('input', { class: 'input', value: a.first, placeholder: 'First name', 'aria-label': `Author ${i + 1} first name`, oninput: (e) => { a.first = e.target.value; update() } }),
        a.org ? null : h('input', { class: 'input', value: a.last, placeholder: 'Last name', 'aria-label': `Author ${i + 1} last name`, oninput: (e) => { a.last = e.target.value; update() } }),
        h('label', { class: 'org-t', title: 'Group author such as a company, agency or YouTube channel' }, h('input', { type: 'checkbox', checked: !!a.org, 'aria-label': `Author ${i + 1} is an organisation`, onchange: (e) => { a.org = e.target.checked; if (a.org) { a.last = [a.first, a.last].filter(Boolean).join(' '); a.first = '' } draw(); update() } }), 'Group'),
        button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: `Remove author ${i + 1}`, onClick: () => { st.src.authors.splice(i, 1); if (!st.src.authors.length) st.src.authors.push({ first: '', last: '', org: false }); draw(); update() } }))))
    }
    draw()
    const pasteBtn = button('Paste names', { size: 'sm', variant: 'ghost', icon: 'clipboard-paste', onClick: () => {
      const ta = textarea({ rows: 5, placeholder: 'Jane Smith; Alan Lee\nor one name per line, or "Smith, Jane"', 'aria-label': 'Author names' })
      const m = modal({ title: 'Paste author names', icon: 'users', body: [h('div', { class: 'stack' }, ta, h('div', { class: 'small muted' }, 'Separate people with a semicolon, a new line or "and". We split first and last names for you, and you can fix them afterwards.'))],
        actions: [button('Cancel', { variant: 'ghost', onClick: () => m.close() }), button('Add names', { variant: 'primary', onClick: () => {
          const names = ta.value.split(/\n|;|\s+and\s+|\s*&\s*/i).map((s) => s.trim()).filter(Boolean).map(C.parseName)
          if (names.length) { st.src.authors = [...st.src.authors.filter((a) => a.first || a.last), ...names]; draw(); update() }
          m.close()
        } })] })
      setTimeout(() => ta.focus(), 60)
    } })
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', 'Authors')), box,
      h('div', { class: 'row' }, button('Add author', { size: 'sm', variant: 'secondary', icon: 'plus', onClick: () => { st.src.authors.push({ first: '', last: '', org: false }); draw(); box.querySelector('.a-row:last-child input')?.focus() } }), pasteBtn))
  }

  function titleField(label, ph) {
    const inp = bind('title', { label, ph })
    const set = (fn) => () => { inp.value = fn(inp.value); st.src.title = inp.value; update() }
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', label)), inp,
      h('div', { class: 'casing' }, button('Sentence case', { size: 'sm', variant: 'ghost', onClick: set(C.sentenceCase), title: 'Capitalise only the first word and acronyms. APA and Harvard want this for article and book titles.' }),
        button('Title Case', { size: 'sm', variant: 'ghost', onClick: set(C.titleCase), title: 'Capitalise the main words. MLA, Chicago and IEEE want this.' })))
  }

  function renderForm() {
    const t = st.src.type
    const typeSeg = segmented(C.TYPES, t, (v) => {
      const keep = { authors: st.src.authors, year: st.src.year, month: st.src.month, day: st.src.day, title: st.src.title, url: st.src.url, doi: st.src.doi, accessed: st.src.accessed }
      st.src = Object.assign(C.emptySource(v), keep)
      if (v === 'website' || v === 'video') st.src.accessed ||= C.todayISO()
      renderForm(); update()
    }, 'Source type')
    const parts = [authorRows(), titleField(t === 'article' ? 'Article title' : t === 'website' ? 'Page title' : t === 'video' ? 'Video title' : t === 'report' ? 'Report title' : 'Book title')]
    if (t === 'article') parts.push(F('Journal name', 'container'), h('div', { class: 'grid2' }, F('Volume', 'volume', { mode: 'numeric' }), F('Issue', 'issue'), F('Pages', 'pages', { ph: '12-34' })), dateFields(false), F('DOI', 'doi', { ph: '10.1000/xyz123' }), F('URL (if no DOI)', 'url'))
    if (t === 'book') parts.push(h('div', { class: 'grid2' }, F('Publisher', 'publisher'), F('City (Chicago, Harvard, IEEE)', 'city'), F('Edition', 'edition', { ph: '2' })), dateFields(false), F('DOI or URL (optional)', 'url'))
    if (t === 'website') parts.push(h('div', { class: 'grid2' }, F('Website name', 'container', { ph: 'BBC News' }), F('Publisher (if different)', 'publisher')), dateFields(true), F('URL', 'url', { ph: 'https://...' }),
      field('Date you accessed it', h('div', { class: 'row' }, h('input', { class: 'input', type: 'date', value: st.src.accessed, 'aria-label': 'Access date', style: 'flex:1;min-width:150px', oninput: (e) => { st.src.accessed = e.target.value; update() } }), button('Today', { size: 'sm', variant: 'ghost', onClick: () => { st.src.accessed = C.todayISO(); renderForm(); update() } }))))
    if (t === 'video') parts.push(h('div', { class: 'grid2' }, F('Platform', 'platform', { ph: 'YouTube' })), dateFields(true), F('URL', 'url', { ph: 'https://...' }),
      field('Date you accessed it', h('div', { class: 'row' }, h('input', { class: 'input', type: 'date', value: st.src.accessed, 'aria-label': 'Access date', style: 'flex:1;min-width:150px', oninput: (e) => { st.src.accessed = e.target.value; update() } }), button('Today', { size: 'sm', variant: 'ghost', onClick: () => { st.src.accessed = C.todayISO(); renderForm(); update() } }))))
    if (t === 'report') parts.push(h('div', { class: 'grid2' }, F('Publisher or institution', 'publisher'), F('Report number', 'reportNo'), F('City (Chicago, Harvard, IEEE)', 'city')), dateFields(false), F('URL or DOI', 'url'))
    if (t === 'video') parts.splice(1, 0, h('div', { class: 'stu-hint', style: 'margin-top:-6px' }, 'For videos, tick "Group" and enter the channel name as the author.'))
    clear(formBox, field('Source type', typeSeg), ...parts)
  }

  // ---------- result ----------
  const hang = () => st.style !== 'ieee'
  function update() {
    const miss = C.missing(st.src)
    const idx = st.style === 'ieee' ? Math.max(1, st.list.length + 1) : undefined
    const f = C.format(st.src, st.style, { index: st.editing ? undefined : idx })
    const it = C.inText(st.src, st.style, { page: st.page, index: st.editing ? st.list.findIndex((x) => x.id === st.editing) + 1 : idx })
    const empty = !st.src.title.trim() && !st.src.authors.some((a) => a.last || a.first)
    const ref = h('div', { class: ['ref live', hang() && 'hang'], html: empty ? '<span style="color:var(--muted)">Your citation appears here as you type.</span>' : f.html })
    const pageIn = h('input', { class: 'input', style: 'width:84px;height:34px', value: st.page, placeholder: 'e.g. 12', 'aria-label': 'Page number for the in-text citation', oninput: (e) => { st.page = e.target.value; updateIntext() } })
    const parenEl = h('span', { class: 'val', html: it.paren }), narrEl = h('span', { class: 'val', html: it.narrative })
    const updateIntext = () => { const t = C.inText(st.src, st.style, { page: st.page, index: idx }); parenEl.innerHTML = t.paren; narrEl.innerHTML = t.narrative }
    clear(refBox,
      ref,
      !empty && miss.length ? h('div', { class: 'stu-hint' }, `Still to add: ${miss.join(', ')}.`) : null,
      h('div', { class: 'row' },
        button('Copy citation', { variant: 'primary', icon: 'copy', disabled: empty, onClick: () => richCopy(f.html, f.text) }),
        button('Copy plain text', { variant: 'secondary', icon: 'clipboard', disabled: empty, onClick: () => copyText(f.text) }),
        button(st.editing ? 'Save changes' : 'Add to bibliography', { variant: 'secondary', icon: st.editing ? 'check' : 'library-big', disabled: empty, onClick: addToList })),
      h('div', { class: 'stack', style: 'gap:6px' },
        h('div', { class: 'it' }, h('span', { class: 'lbl' }, 'In text'), parenEl, button('', { icon: 'copy', variant: 'ghost', size: 'sm', ariaLabel: 'Copy in-text citation', onClick: () => copyText(C.htmlText(parenEl.innerHTML.replace(/&amp;/g, '&'))) })),
        h('div', { class: 'it' }, h('span', { class: 'lbl' }, 'Narrative'), narrEl, st.style !== 'ieee' ? h('label', { class: 'org-t' }, 'Page', pageIn) : null)))
  }

  // ---------- bibliography ----------
  function ordered() {
    const items = st.style === 'ieee' ? [...st.list] : [...st.list].sort((a, b) => (C.sortKey(a.src) < C.sortKey(b.src) ? -1 : 1))
    return items.map((x, i) => ({ ...x, ...C.format(x.src, st.style, { index: i + 1 }) }))
  }
  function renderBib() {
    const items = ordered()
    clear(bibHead, h('div', { class: 'row', style: 'margin-bottom:8px' }, pill(`${items.length} source${items.length === 1 ? '' : 's'}`, '', 'library'), h('span', { class: 'stu-hint' }, `${LIST_TITLE[st.style]} in ${styleName()}${st.style === 'ieee' ? ', in the order you added them' : ', sorted A to Z'}`)))
    if (!items.length) { clear(bibBox, emptyState('library', 'No sources yet', 'Fill in a source above and press "Add to bibliography". The list is saved on this device and re-formats if you change the style.')); return }
    const html = hangHtml(items, st.style)
    const text = items.map((f) => f.text).join('\n\n')
    clear(bibBox,
      h('div', { class: 'row', style: 'margin-bottom:6px' },
        button('Copy list', { variant: 'primary', size: 'sm', icon: 'copy', onClick: () => richCopy(`<h3>${LIST_TITLE[st.style]}</h3>${html}`, `${LIST_TITLE[st.style]}\n\n${text}`) }),
        button('Plain text', { size: 'sm', icon: 'clipboard', onClick: () => copyText(text) }),
        button('.txt', { size: 'sm', icon: 'file-text', onClick: () => download(`${LIST_TITLE[st.style]}\n\n${text}\n`, `${LIST_TITLE[st.style].toLowerCase().replace(/ /g, '-')}.txt`, 'text/plain') }),
        (() => { const b = button('.docx', { size: 'sm', icon: 'file-type', onClick: () => busy(b, async () => download(await bibDocx(items, st.style), `${LIST_TITLE[st.style].toLowerCase().replace(/ /g, '-')}.docx`), 'Building') }); return b })(),
        button('Clear all', { size: 'sm', variant: 'ghost', icon: 'trash-2', onClick: () => confirmModal({ title: 'Clear the whole list?', text: `This removes all ${items.length} saved sources from this device.`, yes: 'Clear list', danger: true }, () => { st.list = []; persist(); renderBib(); update() }) })),
      h('div', items.map((f) => h('div', { class: 'bib-item' },
        h('div', { class: ['bib-ref', hang() && 'hang'], html: f.html }),
        h('div', { class: 'row', style: 'gap:2px;flex-wrap:nowrap' },
          button('', { icon: 'pencil', variant: 'ghost', size: 'sm', ariaLabel: 'Edit this source', onClick: () => { st.src = structuredClone(f.src); st.editing = f.id; renderForm(); update(); formBox.scrollIntoView({ behavior: 'smooth', block: 'start' }) } }),
          button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Remove this source', onClick: () => { st.list = st.list.filter((x) => x.id !== f.id); if (st.editing === f.id) st.editing = null; persist(); renderBib(); update() } }))))))
  }
  function addToList() {
    const copy = structuredClone(st.src)
    if (st.editing) { st.list = st.list.map((x) => (x.id === st.editing ? { ...x, src: copy } : x)); st.editing = null; toast('Source updated', 'success') } else { st.list.push({ id: uid(), src: copy }); toast('Added to your bibliography', 'success') }
    persist(); renderBib(); update()
  }
  const newBtn = button('New source', { variant: 'ghost', size: 'sm', icon: 'file-plus', onClick: () => { st.src = C.emptySource(st.src.type); st.editing = null; st.page = ''; clear(lookupOut); lookupIn.value = ''; renderForm(); update() } })

  lookupBtn.addEventListener('click', () => busy(lookupBtn, async () => {
    clear(lookupOut)
    const { src, note } = await lookupSource(lookupIn.value)
    st.src = src; st.editing = null
    renderForm(); update()
    clear(lookupOut, alert(src.title ? 'success' : 'info', note))
  }, { label: 'Looking up', errorTo: lookupOut }))

  const styleSel = lockedStyle ? pill(styleName(), '', 'quote') : select(C.STYLES, st.style, (v) => { st.style = v; persist(); tipsBox.replaceChildren(...tipsList()); renderBib(); update() })
  const tipsList = () => [h('ul', { class: 'tips' }, TIPS[st.style].map((t) => h('li', t)))]
  const tipsBox = h('div')
  tipsBox.append(...tipsList())

  const sourceTile = tile({ tint: TINTS[0], title: 'Your source', icon: 'book-open', actions: newBtn },
    h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', 'Fill in from a DOI or ISBN (optional)')), h('div', { class: 'row', style: 'flex-wrap:nowrap' }, h('div', { style: 'flex:1;min-width:0' }, lookupIn), lookupBtn),
        h('div', { class: 'fine' }, 'Looks up Crossref (DOIs) and Open Library (ISBNs). Only the number you type is sent.')),
      lookupOut, formBox))
  const resultTile = tile({ tint: TINTS[3], title: 'Citation', icon: 'quote', actions: lockedStyle ? styleSel : h('div', { style: 'min-width:170px' }, styleSel) }, refBox)
  const tipsTile = tile({ tint: TINTS[2], title: `${styleName()} in short`, icon: 'lightbulb' }, tipsBox)
  const bibTile = tile({ tint: TINTS[4], title: 'Bibliography', icon: 'library' }, bibHead, bibBox)

  const right = params.list ? [bibTile, resultTile, tipsTile] : [resultTile, bibTile, tipsTile]
  root.append(stage('t-cite', h('div', { class: 'stu-bento' }, h('div', { class: 's6', style: 'min-width:0' }, sourceTile), h('div', { class: 's6 stack', style: 'min-width:0' }, ...right))))
  renderForm(); update(); renderBib()
}
