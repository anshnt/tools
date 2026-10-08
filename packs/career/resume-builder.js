// Resume builder (also serves resume-to-pdf, resume-to-word and resume-formatter via params).
// Structured editor with drag-to-reorder sections and entries, three ATS-friendly templates, a live PDF preview that is the real file,
// autosave to this device, JSON backup, DOCX export and paste/upload import (heuristic parser, or Claude when a key is set).
import { h, icon, button, busy, toast, alert, modal, field, input, textarea, segmented, download, debounce, clear, onCleanup, copyText, errorMessage } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { pickFiles, safeName } from '../../lib/files.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, saveIndicator, sortable, handle, burst, saveAs } from './_kit.js'
import { SECTIONS, emptyResume, sampleResume, normalizeResume, newEntry, parseResumeText, resumeToText, hasContent, RESUME_SCHEMA, RESUME_AI_SYSTEM, cleanBullets } from './_resume.js'
import { buildResumePdf, TEMPLATES, textIssues } from './_resume-pdf.js'
import { buildResumeDocx } from './_resume-docx.js'
import { pdfPreview } from './_pdfview.js'
import { textSource } from './_source.js'

const KEY = 'resume:data'
const SWATCHES = ['#0d9b8a', '#5b4cf0', '#2563eb', '#e5484d', '#f76b15', '#18181b']
const TPL_THUMB = {
  modern: () => [h('i', { class: 'h', style: '--k:#0d9b8a;width:62%' }), h('i', { class: 'w60' }), h('i', { class: 's', style: '--k:#0d9b8a' }), h('i'), h('i', { class: 'w80' }), h('i', { class: 's', style: '--k:#0d9b8a' }), h('i'), h('i', { class: 'w60' })],
  classic: () => [h('i', { class: 'h c', style: '--k:#222;width:50%' }), h('i', { class: 'w60 c' }), h('i', { class: 's', style: '--k:#222' }), h('i'), h('i', { class: 'w80' }), h('i', { class: 's', style: '--k:#222' }), h('i'), h('i', { class: 'w60' })],
  compact: () => [h('i', { class: 'h', style: '--k:#0d9b8a;width:44%' }), h('i', { style: 'height:5px;background:#d6efec;width:100%' }), h('i'), h('i', { class: 'w80' }), h('i', { style: 'height:5px;background:#d6efec;width:100%' }), h('i'), h('i'), h('i', { class: 'w60' })],
}
const ENTRY_LABELS = {
  experience: (e) => [e.role || 'New position', [e.company, e.start && `${e.start} - ${e.current ? 'Present' : e.end || '?'}`].filter(Boolean).join('  ·  ')],
  education: (e) => [e.school || 'New education', [e.degree, e.end].filter(Boolean).join('  ·  ')],
  skills: (e) => [e.group || 'Skill group', e.items.slice(0, 60)],
  projects: (e) => [e.name || 'New project', e.tech],
  certifications: (e) => [e.name || 'New certification', [e.issuer, e.date].filter(Boolean).join('  ·  ')],
  awards: (e) => [e.name || 'New award', [e.issuer, e.date].filter(Boolean).join('  ·  ')],
  languages: (e) => [e.name || 'New language', e.level],
  links: (e) => [e.label || e.url || 'New link', e.label ? e.url : ''],
}
const ADD_LABEL = { experience: 'Add position', education: 'Add education', skills: 'Add skill group', projects: 'Add project', certifications: 'Add certification', awards: 'Add award', languages: 'Add language', links: 'Add link' }

export async function mount(root, { params, signal }) {
  const mode = params.import ? 'import' : params.export || 'build'
  const stored = load(KEY, null)
  let data = stored ? normalizeResume(stored) : sampleResume()
  const openSec = new Set(['experience'])
  const openEntry = new Set()
  if (data.experience[0]) openEntry.add(data.experience[0].id)

  const saved = saveIndicator()
  const view = pdfPreview({ maxWidth: 760 })
  const warn = h('div')
  let lastPages = 1
  let editorHost = h('div')
  let sampleNote = h('div')

  // ---------- state ----------
  const persist = debounce(() => { save(KEY, data); saved.saved('Saved on this device') }, 350)
  let renderSeq = 0
  const renderPreview = debounce(async () => {
    const my = ++renderSeq
    try {
      const { blob, pages } = await buildResumePdf(data)
      if (my !== renderSeq) return
      lastPages = pages
      await view.show(blob)
      const bad = textIssues(data)
      clear(warn, bad.length ? alert('warn', `The PDF uses built-in fonts, so ${bad.slice(0, 6).join(' ')} cannot be drawn. Use Word export for non-Latin text.`) : null)
    } catch (e) {
      console.error(e)
      clear(warn, alert('error', errorMessage(e)))
    }
  }, 260)
  function touch() {
    if (data.sample) { data.sample = false; clear(sampleNote) }
    saved.dirty()
    persist()
    renderPreview()
  }
  signal?.addEventListener('abort', () => persist.flush?.())

  // ---------- form helpers ----------
  const bind = (obj, key, ctl, after) => {
    ctl.value = obj[key] ?? ''
    ctl.addEventListener('input', () => { obj[key] = ctl.value; after?.(); touch() })
    return ctl
  }
  const fi = (label, obj, key, o = {}) => field(label, bind(obj, key, o.area ? textarea({ rows: o.rows || 3, placeholder: o.ph }) : input({ placeholder: o.ph, type: o.type || 'text', autocomplete: o.ac || 'off', inputmode: o.mode }), o.after), o.hint)

  function bulletsField(e, label = 'Bullet points (one per line)') {
    const hint = h('span')
    const ta = textarea({ rows: 5, placeholder: 'Led a team of 5 to ship X, increasing Y by 30%\nReduced Z from 4 hours to 20 minutes' })
    const refresh = () => {
      const bl = cleanBullets(e.bullets)
      const num = bl.filter((b) => /\d/.test(b)).length
      hint.textContent = bl.length ? `${bl.length} bullet${bl.length > 1 ? 's' : ''}, ${num} with numbers. Start with a strong verb and show the result.` : 'Start with a strong verb and show the result.'
    }
    ta.value = e.bullets.join('\n')
    ta.addEventListener('input', () => { e.bullets = ta.value.split('\n'); refresh(); touch() })
    refresh()
    return field(label, ta, hint)
  }

  // ---------- entry editors ----------
  const BODY = {
    experience: (e, up) => [
      h('div', { class: 'grid-2' }, fi('Job title', e, 'role', { ph: 'Senior Software Engineer', after: up }), fi('Company', e, 'company', { ph: 'Acme Corp', after: up })),
      h('div', { class: 'grid-2' }, fi('Location', e, 'location', { ph: 'Bengaluru' }), h('div', { class: 'grid-2' }, fi('Start', e, 'start', { ph: 'Jan 2021', after: up }), endField(e, up))),
      bulletsField(e),
    ],
    education: (e, up) => [
      h('div', { class: 'grid-2' }, fi('School', e, 'school', { ph: 'Pune Institute of Technology', after: up }), fi('Location', e, 'location', { ph: 'Pune' })),
      h('div', { class: 'grid-2' }, fi('Degree', e, 'degree', { ph: 'B.Tech', after: up }), fi('Field of study', e, 'field', { ph: 'Computer Engineering' })),
      h('div', { class: 'grid-3' }, fi('Start', e, 'start', { ph: '2014' }), fi('End', e, 'end', { ph: '2018', after: up }), fi('Grade', e, 'grade', { ph: 'CGPA 8.7 / 10' })),
      fi('Notes (optional)', e, 'notes', { area: true, rows: 2, ph: 'Honors, relevant coursework, activities' }),
    ],
    skills: (e, up) => [
      fi('Group name (optional)', e, 'group', { ph: 'Languages', after: up }),
      fi('Skills (comma separated)', e, 'items', { area: true, rows: 2, ph: 'JavaScript, Python, SQL', after: up }),
    ],
    projects: (e, up) => [
      h('div', { class: 'grid-2' }, fi('Project name', e, 'name', { ph: 'OpenInvoice', after: up }), fi('Link', e, 'link', { ph: 'github.com/you/project' })),
      fi('Tech used', e, 'tech', { ph: 'Next.js, PostgreSQL', after: up }),
      bulletsField(e, 'What it does (one point per line)'),
    ],
    certifications: (e, up) => [h('div', { class: 'grid-3' }, fi('Name', e, 'name', { ph: 'AWS Solutions Architect', after: up }), fi('Issuer', e, 'issuer', { ph: 'Amazon', after: up }), fi('Date', e, 'date', { ph: '2022', after: up }))],
    awards: (e, up) => [h('div', { class: 'grid-3' }, fi('Award', e, 'name', { ph: 'Employee of the Year', after: up }), fi('Given by', e, 'issuer', { ph: 'Northwind Labs', after: up }), fi('Date', e, 'date', { ph: '2023', after: up }))],
    languages: (e, up) => [h('div', { class: 'grid-2' }, fi('Language', e, 'name', { ph: 'English', after: up }), fi('Level', e, 'level', { ph: 'Fluent', after: up }))],
    links: (e, up) => [h('div', { class: 'grid-2' }, fi('Label', e, 'label', { ph: 'Portfolio', after: up }), fi('URL', e, 'url', { ph: 'yoursite.com', after: up }))],
  }
  function endField(e, up) {
    const end = fi('End', e, 'end', { ph: 'Feb 2021', after: up })
    const cur = h('input', { type: 'checkbox', checked: e.current, onchange: (ev) => { e.current = ev.target.checked; end.querySelector('input').disabled = e.current; up(); touch() } })
    end.querySelector('input').disabled = e.current
    return h('div', { class: 'stack tight' }, end, h('label', { class: 'switch', style: 'min-height:24px;font-size:13px' }, cur, h('span', 'I work here now')))
  }

  function entryCard(kind, e, listEl, rerender) {
    const [t0, s0] = ENTRY_LABELS[kind](e)
    const title = h('b', t0)
    const sub = h('small', s0 || '')
    const up = () => { const [a, b] = ENTRY_LABELS[kind](e); title.textContent = a; sub.textContent = b || '' }
    const item = h('div', { class: ['cr-item', openEntry.has(e.id) && 'open'], dataset: { id: e.id } },
      h('div', { class: 'cr-item-h' },
        handle(),
        h('button', { type: 'button', class: 'lbl', 'aria-expanded': String(openEntry.has(e.id)), onclick: () => {
          const o = item.classList.toggle('open')
          o ? openEntry.add(e.id) : openEntry.delete(e.id)
          item.querySelector('.lbl').setAttribute('aria-expanded', String(o))
        } }, title, sub),
        button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Delete this entry', onClick: () => { data[kind] = data[kind].filter((x) => x.id !== e.id); touch(); rerender() } }),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chevron-down'))),
      h('div', { class: 'cr-item-b stack tight' }, BODY[kind](e, up)))
    return item
  }

  function entryList(kind) {
    const wrap = h('div', { class: 'stack tight' })
    const list = h('div', { class: 'cr-list' })
    const rerender = () => draw()
    function draw() {
      clear(list, data[kind].map((e) => entryCard(kind, e, list, rerender)))
      if (!data[kind].length) list.append(h('div', { class: 'small muted', style: 'padding:6px 2px' }, 'Nothing here yet.'))
    }
    sortable(list, { onSort: (ids) => { data[kind] = ids.map((id) => data[kind].find((x) => x.id === id)); touch() } })
    draw()
    wrap.append(list, button(ADD_LABEL[kind], { icon: 'plus', variant: 'secondary', attrs: { class: 'btn btn-secondary cr-add' }, onClick: () => {
      const e = newEntry(kind)
      data[kind].push(e)
      openEntry.add(e.id)
      draw()
      touch()
      list.lastElementChild?.querySelector('input, textarea')?.focus()
    } }))
    return wrap
  }

  function sectionCard(def) {
    const id = def.id
    const eye = button('', { icon: data.hidden[id] ? 'eye-off' : 'eye', variant: 'ghost', size: 'sm', ariaLabel: data.hidden[id] ? `Show ${def.label} in the resume` : `Hide ${def.label} from the resume`, onClick: () => {
      data.hidden[id] = !data.hidden[id]
      item.classList.toggle('hidden-sec', !!data.hidden[id])
      eye.replaceChildren(icon(data.hidden[id] ? 'eye-off' : 'eye'))
      eye.setAttribute('aria-label', data.hidden[id] ? `Show ${def.label} in the resume` : `Hide ${def.label} from the resume`)
      touch()
    } })
    const body = id === 'summary' ? summaryBody() : entryList(id)
    const item = h('div', { class: ['cr-item cr-sec', openSec.has(id) && 'open', data.hidden[id] && 'hidden-sec'], dataset: { id } },
      h('div', { class: 'cr-item-h' },
        handle(`Drag to move the ${def.label} section (or use the up and down arrow keys)`),
        h('span', { class: 'cr-sec-ic' }, icon(def.icon)),
        h('button', { type: 'button', class: 'lbl', 'aria-expanded': String(openSec.has(id)), onclick: () => {
          const o = item.classList.toggle('open')
          o ? openSec.add(id) : openSec.delete(id)
          item.querySelector('.cr-item-h .lbl').setAttribute('aria-expanded', String(o))
        } }, h('b', def.label), h('small', sectionCount(id))),
        eye,
        h('span', { class: 'chev', 'aria-hidden': 'true' }, icon('chevron-down'))),
      h('div', { class: 'cr-item-b' }, body))
    return item
  }
  function sectionCount(id) {
    if (id === 'summary') return data.summary ? `${data.summary.length} characters` : 'Empty'
    const n = data[id].length
    return n ? `${n} ${n === 1 ? 'entry' : 'entries'}` : 'Empty'
  }
  function summaryBody() {
    const ta = textarea({ rows: 5, placeholder: '2-3 sentences: who you are, your strongest results, and what you want next.' })
    const hint = h('span')
    ta.value = data.summary
    const r = () => { hint.textContent = `${data.summary.length} characters. About 300 to 450 reads best.` }
    ta.addEventListener('input', () => { data.summary = ta.value; r(); touch() })
    r()
    return field('Professional summary', ta, hint)
  }

  function contactCard() {
    const c = data.contact
    return card('Contact', 'user-round', h('div', { class: 'stack tight' },
      h('div', { class: 'grid-2' }, fi('Full name', c, 'name', { ph: 'Aarav Mehta', ac: 'name' }), fi('Headline', c, 'title', { ph: 'Senior Software Engineer' })),
      h('div', { class: 'grid-2' }, fi('Email', c, 'email', { ph: 'you@example.com', type: 'email', ac: 'email' }), fi('Phone', c, 'phone', { ph: '+91 98765 43210', ac: 'tel' })),
      h('div', { class: 'grid-2' }, fi('Location', c, 'location', { ph: 'Bengaluru, India', ac: 'off' }), fi('Website', c, 'website', { ph: 'yoursite.com' })),
      h('div', { class: 'grid-2' }, fi('LinkedIn', c, 'linkedin', { ph: 'linkedin.com/in/you' }), fi('GitHub', c, 'github', { ph: 'github.com/you' }))))
  }

  function styleCard() {
    const st = data.style
    const tpls = h('div', { class: 'cr-tpls' }, Object.entries(TEMPLATES).map(([id, t]) => h('button', { type: 'button', class: 'cr-tpl', 'aria-pressed': String(st.template === id), onclick: (ev) => {
      st.template = id
      for (const b of tpls.children) b.setAttribute('aria-pressed', String(b === ev.currentTarget))
      touch()
    } }, h('div', { class: 'cr-thumb' }, TPL_THUMB[id]()), h('span', t.name, h('small', t.blurb)))))
    const sw = h('div', { class: 'cr-swatches' }, SWATCHES.map((c) => h('button', { type: 'button', class: 'cr-sw', style: { '--k': c }, 'aria-label': `Accent color ${c}`, 'aria-pressed': String(st.accent === c), onclick: () => { setAccent(c) } })),
      h('input', { type: 'color', class: 'input', value: st.accent, 'aria-label': 'Custom accent color', oninput: (ev) => setAccent(ev.target.value, true) }))
    function setAccent(c, custom) {
      st.accent = c
      for (const b of sw.querySelectorAll('.cr-sw')) b.setAttribute('aria-pressed', String(b.style.getPropertyValue('--k') === c))
      if (!custom) sw.querySelector('input').value = c
      touch()
    }
    return card('Look', 'palette', h('div', { class: 'stack' }, tpls,
      h('div', { class: 'row', style: 'gap:18px' },
        field('Accent', sw),
        field('Text size', segmented([['s', 'Small'], ['m', 'Medium'], ['l', 'Large']], st.size, (v) => { st.size = v; touch() }, 'Text size')),
        field('Paper', segmented([['a4', 'A4'], ['letter', 'Letter']], st.page, (v) => { st.page = v; touch() }, 'Paper size')))))
  }

  // ---------- editor ----------
  function renderEditor() {
    const secs = h('div', { class: 'cr-list' }, data.order.map((id) => sectionCard(SECTIONS.find((s) => s.id === id))))
    sortable(secs, { onSort: (ids) => { data.order = ids; touch() } })
    clear(editorHost, h('div', { class: 'stack' }, contactCard(), styleCard(), h('div', { class: 'stack tight' }, h('h2', { class: 'cr-h', style: 'margin:6px 2px 4px' }, h('span', { class: 'tile' }, icon('layers')), 'Sections', h('span', { class: 'aside' }, 'Drag to reorder')), secs)))
    clear(sampleNote, data.sample ? alert('info', h('strong', 'Sample content. '), 'Edit anything to make it yours, or ', h('button', { type: 'button', class: 'link', style: 'background:none;border:0;padding:0;font:inherit;cursor:pointer', onclick: startBlank }, 'start from scratch'), '.') : null)
  }
  function replaceData(next, { keepStyle = true } = {}) {
    data = normalizeResume(keepStyle ? { ...next, style: data.style } : next)
    openEntry.clear()
    if (data.experience[0]) openEntry.add(data.experience[0].id)
    renderEditor()
    touch()
  }
  function startBlank() {
    replaceData(emptyResume())
    openSec.add('experience'); renderEditor()
    toast('Started a blank resume')
  }

  // ---------- export ----------
  const fileBase = () => `${safeName(data.contact.name || 'resume').replace(/\s+/g, '-')}-resume`
  const exportBtn = (label, ic, variant, fn) => {
    const b = button(label, { icon: ic, variant, size: mode === (label.includes('PDF') ? 'pdf' : 'docx') ? 'lg' : undefined })
    b.addEventListener('click', () => busy(b, async () => {
      if (!hasContent(data)) { toast('Add some details first', 'error'); return }
      await fn()
      burst(b)
    }, { label: 'Preparing' }))
    return b
  }
  const pdfBtn = exportBtn('Download PDF', 'file-down', mode === 'docx' ? 'secondary' : 'primary', async () => {
    const { blob } = await buildResumePdf(data)
    download(blob, `${fileBase()}.pdf`)
    toast('PDF downloaded. The text is selectable, so ATS software can read it.', 'success')
  })
  const docxBtn = exportBtn('Download Word', 'file-type', mode === 'docx' ? 'primary' : 'secondary', async () => {
    download(await buildResumeDocx(data), `${fileBase()}.docx`)
    toast('Word file downloaded', 'success')
  })
  const exportBar = h('div', { class: 'row', style: 'gap:8px' }, pdfBtn, docxBtn,
    button('Copy text', { icon: 'copy', variant: 'ghost', size: 'sm', onClick: () => copyText(resumeToText(data)) }),
    button('Save backup', { icon: 'save', variant: 'ghost', size: 'sm', title: 'Download your resume data as JSON', onClick: () => saveAs(JSON.stringify(data, null, 2), `${fileBase()}.json`, 'application/json') }),
    button('Load backup', { icon: 'folder-open', variant: 'ghost', size: 'sm', onClick: async () => {
      const [f] = await pickFiles({ accept: '.json,application/json' })
      if (!f) return
      try {
        const obj = JSON.parse(await f.text())
        if (!obj || typeof obj !== 'object' || (!obj.contact && !obj.experience)) throw new Error('This file does not look like a resume backup.')
        replaceData(obj, { keepStyle: false })
        toast('Backup loaded', 'success')
      } catch (e) { toast(e instanceof SyntaxError ? 'That file is not valid JSON.' : errorMessage(e), 'error') }
    } }),
    button('Import resume', { icon: 'import', variant: 'ghost', size: 'sm', onClick: openImportModal }),
    button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => {
      const yes = button('Clear everything', { variant: 'danger', icon: 'trash-2' })
      const m = modal({ title: 'Clear this resume?', icon: 'triangle-alert', body: h('p', 'This removes all your details from this device. Tip: use Save backup first if you want to keep a copy.'), actions: [button('Cancel', { onClick: () => m.close() }), yes] })
      yes.addEventListener('click', () => { m.close(); replaceData(emptyResume()); toast('Cleared') })
    } }))

  // ---------- import ----------
  function importPanel({ onDone, compact }) {
    const src = textSource({ rows: compact ? 8 : 10, placeholder: 'Paste your resume text here. Headings like Experience, Education and Skills help the parser.', label: 'Drop your resume (PDF, DOCX or TXT) or click to choose', paste: !compact })
    const result = h('div')
    const doParse = (viaAi) => async () => {
      const text = src.text.trim()
      if (text.length < 40) { clear(result, alert('error', 'Paste or upload your resume text first.')); return }
      let parsed, report
      if (viaAi) {
        if (!(await ai.ensureKey())) return
        parsed = await ai.ask({ system: RESUME_AI_SYSTEM, prompt: text, json: RESUME_SCHEMA, effort: 'low', maxTokens: 12000, signal })
        parsed = normalizeResume(parsed)
        report = { found: { experience: parsed.experience.length, education: parsed.education.length, skills: parsed.skills.reduce((n, s) => n + s.items.split(',').filter(Boolean).length, 0), projects: parsed.projects.length }, warnings: [] }
      } else {
        const r = parseResumeText(text)
        parsed = r.data; report = r.report
      }
      const f = report.found
      clear(result, h('div', { class: 'stack tight' },
        alert(report.warnings.length ? 'warn' : 'success', h('strong', viaAi ? 'Parsed with Claude. ' : 'Parsed. '), `Found ${f.experience} job${f.experience === 1 ? '' : 's'}, ${f.education} education entr${f.education === 1 ? 'y' : 'ies'}, ${f.skills} skills and ${f.projects} project${f.projects === 1 ? '' : 's'}.`,
          report.warnings.length ? h('ul', { style: 'margin:6px 0 0;padding-left:18px' }, report.warnings.map((w) => h('li', w))) : null,
          report.skipped?.length ? h('div', { class: 'small muted', style: 'margin-top:4px' }, `Not imported: ${report.skipped.join(', ')}`) : null),
        h('div', { class: 'row' }, button('Use this in the builder', { icon: 'check', variant: 'primary', onClick: () => { onDone(parsed); } }))))
    }
    const bLocal = button('Parse', { icon: 'wand-sparkles', variant: 'primary' })
    const bAi = button('Parse with Claude', { icon: 'sparkles', variant: 'secondary', title: 'More accurate on messy layouts. Uses your Anthropic key.' })
    bLocal.addEventListener('click', () => busy(bLocal, doParse(false), { label: 'Parsing', errorTo: result }))
    bAi.addEventListener('click', () => busy(bAi, doParse(true), { label: 'Asking Claude', errorTo: result }))
    return h('div', { class: 'stack' }, src.el, h('div', { class: 'row' }, bLocal, bAi, h('span', { class: 'small muted' }, 'Parsing happens in your browser. Claude parsing sends the text to Anthropic.')), ai.notice('Optional AI parsing uses Claude'), result)
  }
  function openImportModal() {
    const m = modal({ title: 'Import an existing resume', icon: 'import', body: importPanel({ compact: true, onDone: (parsed) => { m.close(); applyImported(parsed) } }) })
  }
  function applyImported(parsed) {
    replaceData(parsed)
    openSec.add('experience')
    renderEditor()
    revealBuilder()
    toast('Imported. Review each section below.', 'success')
    setTimeout(() => editorHost.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  // ---------- layout ----------
  const work = h('div', { class: 'cr-work wide-left', dataset: { pane: 'edit' } },
    h('div', { class: 'cr-pane-edit stack' }, sampleNote, editorHost),
    h('div', { class: 'cr-pane-preview' }, h('div', { class: 'cr-sticky stack tight' }, view.el, warn,
      h('div', { class: 'row small muted', style: 'justify-content:space-between' }, saved.el, h('a', { class: 'link', href: '#/ats-checker' }, 'Check ATS score')))))
  const sw = h('div', { class: 'cr-switch' }, segmented([['edit', 'Edit'], ['preview', 'Preview']], 'edit', (v) => { work.dataset.pane = v; if (v === 'preview') renderPreview() }, 'Pane'))
  const builder = h('div', { class: 'stack' }, exportBar, sw, work)
  const steps = mode === 'import' ? ['Paste or upload', 'Review sections', 'Download']
    : mode === 'pdf' ? ['Add details', 'Pick a look', 'Download PDF'] : mode === 'docx' ? ['Add details', 'Pick a look', 'Download Word'] : ['Add details', 'Pick a look', 'Download']
  const blurb = {
    import: '<b>Bring your old resume.</b> Paste the text or upload a PDF or DOCX and it is reformatted into a clean, ATS-friendly template. Nothing leaves your device unless you pick Claude.',
    pdf: '<b>A real PDF, not a screenshot.</b> The text is selectable and searchable, so applicant tracking systems read it properly.',
    docx: '<b>A clean, editable Word file.</b> Real bullet lists and tab-aligned dates, ready for any recruiter or ATS.',
    build: '<b>Autosaved on this device.</b> Three ATS-friendly templates, drag to reorder, and a live preview of the exact PDF you will download.',
  }[mode === 'build' ? 'build' : mode]
  const intro = banner({ icon: mode === 'import' ? 'wand-sparkles' : 'file-user', text: blurb, steps })

  let builderShown = true
  const importHost = h('div')
  function revealBuilder() {
    if (builderShown) return
    builderShown = true
    builder.hidden = false
    clear(importHost)
    renderPreview()
  }
  const el = shell(intro)
  if (mode === 'import') {
    const freshStart = !stored || data.sample || !hasContent(data)
    importHost.append(card('Paste or upload your resume', 'import', importPanel({ onDone: (p) => applyImported(p) }),
      freshStart ? h('div', { class: 'row', style: 'margin-top:12px' }, button('Or start from a blank resume', { variant: 'ghost', size: 'sm', icon: 'file-plus', onClick: () => { startBlank(); revealBuilder() } })) : null))
    el.append(importHost)
    if (freshStart) { builderShown = false; builder.hidden = true }
  }
  el.append(builder)
  root.append(el)
  renderEditor()
  renderPreview()
  onCleanup(() => { save(KEY, data) })
}
