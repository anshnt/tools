// Formula sheet generator: pick from 300+ formulas (maths, physics, chemistry), preview a tidy sheet, print it or save a PDF.
import { h, button, busy, field, segmented, toggle, progress, alert, clear, debounce, formatBytes, download, rangeField, copyText, toast, select, yieldToMain } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { safeName } from '../../lib/files.js'
import { stage, tile, toolStyle, emptyState, TINTS, confetti } from './_kit.js'
import { katexReady, tex, htmlToPdf, printDoc, fitOverflow, DOC_CSS } from './_pages.js'
import { FORMULAS, SUBJECTS } from './_formulas.js'

const CSS = `
.t-fs .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
.t-fs .bar .grow { flex: 1 1 200px; min-width: 0; }
.t-fs .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.t-fs .pick { max-height: 760px; overflow: auto; padding-right: 4px; }
.t-fs .grp-h { display: flex; align-items: center; gap: 8px; margin: 14px 0 8px; position: sticky; top: 0; z-index: 2; padding: 6px 2px; background: linear-gradient(var(--surface) 70%, transparent); }
.t-fs .grp-h:first-child { margin-top: 0; }
.t-fs .grp-h b { font-size: 13px; letter-spacing: .02em; flex: 1; min-width: 0; }
.t-fs .grp-h .sub { font-weight: 500; color: var(--muted); }
.t-fs .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 8px; }
.t-fs .fc { text-align: left; border: 1px solid var(--border); background: var(--surface); border-radius: 14px; padding: 9px 12px 8px; cursor: pointer; display: grid; gap: 4px; min-width: 0; position: relative; color: var(--text); font: inherit;
  transition: transform .2s var(--ease), border-color .2s, background .2s, box-shadow .2s; content-visibility: auto; contain-intrinsic-size: auto 96px; }
.t-fs .fc:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: var(--shadow-sm); }
.t-fs .fc .nm { font-size: 12px; color: var(--muted); line-height: 1.25; padding-right: 22px; }
.t-fs .fc .tx { overflow-x: auto; overflow-y: hidden; padding: 2px 0 4px; font-size: 15px; min-height: 34px; display: flex; align-items: center; }
.t-fs .fc .tx .katex { white-space: nowrap; }
.t-fs .fc .tick { position: absolute; right: 8px; top: 8px; width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--border-strong); display: grid; place-items: center; color: transparent; transition: all .25s var(--pop); }
.t-fs .fc .tick .icon { width: 12px; height: 12px; }
.t-fs .fc[aria-pressed="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.t-fs .fc[aria-pressed="true"] .tick { background: var(--accent); border-color: var(--accent); color: #fff; transform: scale(1.1); }
.t-fs .paper { background: #fff; border-radius: 10px; box-shadow: 0 1px 2px rgba(0,0,0,.1), 0 18px 40px -22px rgba(20,22,40,.5); padding: 22px 22px; max-height: 680px; overflow: auto; border: 1px solid var(--border); }
.t-fs .side { position: sticky; top: calc(var(--header-h) + 12px); display: flex; flex-direction: column; gap: 12px; }
@media (max-width: 900px) { .t-fs .side { position: static; } .t-fs .pick { max-height: 560px; } }
.t-fs .opt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.t-fs .none { text-align: center; color: var(--muted); padding: 26px 10px; font-size: 14px; }
/* the sheet itself (fixed colours: it is printed and exported) */
.fs-sheet-grid { display: grid; gap: 8px 10px; }
.fs-item { border: 1px solid #e1e4ee; border-radius: 8px; padding: 6px 10px 4px; background: #fafbff; min-width: 0; overflow: hidden; }
.fs-item .fs-name { font-size: .7em; color: #5a607a; line-height: 1.25; margin-bottom: 1px; }
.fs-item .fit { overflow: hidden; }
.fs-item .fit .katex-display { margin: .3em 0; }
.fs-item .fit .katex { font-size: 1.02em; }
.fs-nonames .fs-item { padding-top: 4px; }
.pgdoc .fs-topic { margin-bottom: .7em; }
.pgdoc .fs-topic h3 { margin: 0 0 .4em; font-size: .98em; color: #3a4057; text-transform: uppercase; letter-spacing: .05em; }
.pgdoc h2.fs-subject { margin-top: .3em; }
`

const norm = (s) => s.toLowerCase()
const subjTint = (s) => TINTS[SUBJECTS.indexOf(s) % TINTS.length]

/** Sheet HTML for the chosen formula ids. */
export async function sheetHtml(ids, { title = 'Formula sheet', cols = 2, names = true } = {}) {
  const k = await katexReady()
  const picked = FORMULAS.filter((f) => ids.has(f.id))
  const parts = [`<h1>${esc(title)}</h1>`]
  let subject = ''
  const bySubject = new Map()
  for (const f of picked) {
    if (!bySubject.has(f.subject)) bySubject.set(f.subject, new Map())
    const t = bySubject.get(f.subject)
    if (!t.has(f.topic)) t.set(f.topic, [])
    t.get(f.topic).push(f)
  }
  for (const [s, topics] of bySubject) {
    if (s !== subject) { parts.push(`<h2 class="fs-subject">${esc(s)}</h2>`); subject = s }
    for (const [topic, list] of topics) {
      parts.push(`<section class="fs-topic ${names ? '' : 'fs-nonames'}"><h3>${esc(topic)}</h3><div class="fs-sheet-grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">` +
        list.map((f) => `<div class="fs-item">${names ? `<div class="fs-name">${esc(f.name)}</div>` : ''}<div class="fit">${tex(k, f.tex, true)}</div></div>`).join('') + '</div></section>')
    }
  }
  return parts.join('')
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export function mount(root) {
  toolStyle('fs', CSS)
  toolStyle('pgdoc', DOC_CSS)
  const st = { ids: new Set(load('fs:ids', [])), subject: 'All', q: '', cols: 2, names: true, fs: 13, size: 'a4', title: 'Formula sheet', ...load('fs:opts', {}) }
  st.ids = new Set([...st.ids].filter((i) => FORMULAS[i]))
  const persist = () => { save('fs:ids', [...st.ids]); save('fs:opts', { cols: st.cols, names: st.names, fs: st.fs, size: st.size, title: st.title }) }

  const search = h('input', { class: 'input grow', type: 'search', placeholder: 'Search formulas: kinetic, sine rule, pH...', 'aria-label': 'Search formulas', oninput: debounce((e) => { st.q = e.target.value; renderPick() }, 120) })
  const countPill = h('span')
  const chips = h('div', { class: 'chips' })
  const pickBox = h('div', { class: 'pick' })
  const paper = h('div', { class: 'paper' })
  const sheetCount = h('span', { class: 'stu-hint' })
  const result = h('div')
  const prog = progress('Building PDF')
  let renderToken = 0
  const kref = { k: null }

  const matches = (f) => (st.subject === 'All' || f.subject === st.subject) && (!st.q.trim() || norm(`${f.name} ${f.topic} ${f.subject} ${f.tex}`).includes(norm(st.q.trim())))
  const shown = () => FORMULAS.filter(matches)

  function renderChips() {
    clear(chips, ['All', ...SUBJECTS].map((s) => {
      const n = s === 'All' ? FORMULAS.length : FORMULAS.filter((f) => f.subject === s).length
      const sel = FORMULAS.filter((f) => (s === 'All' || f.subject === s) && st.ids.has(f.id)).length
      const b = h('button', { type: 'button', class: 'stu-chip-btn', 'aria-pressed': String(st.subject === s), onclick: () => { st.subject = s; renderChips(); renderPick() } },
        s.replace('Physics: ', 'Phys: '), h('span', { style: 'opacity:.65;font-weight:500' }, ` ${sel ? sel + '/' : ''}${n}`))
      return b
    }))
  }

  const cards = new Map()
  function card(f) {
    let c = cards.get(f.id)
    if (c) return c
    const tx = h('div', { class: 'tx' })
    c = h('button', { type: 'button', class: 'fc', 'aria-pressed': String(st.ids.has(f.id)), 'aria-label': f.name, onclick: () => toggleId(f.id) },
      h('span', { class: 'tick' }, tickIcon()), h('div', { class: 'nm' }, f.name), tx)
    c._tx = tx; c._f = f
    cards.set(f.id, c)
    return c
  }
  const tickIcon = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'icon'); s.innerHTML = '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>'; return s }

  async function renderPick() {
    const tok = ++renderToken
    const list = shown()
    renderChips()
    countPill.textContent = `${st.ids.size} selected`
    if (!list.length) { clear(pickBox, h('div', { class: 'none' }, 'No formula matches that search. Try a shorter word like "energy" or "area".')); return }
    const groups = new Map()
    for (const f of list) { const key = `${f.subject}\u0000${f.topic}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(f) }
    const frag = document.createDocumentFragment()
    const toRender = []
    for (const [key, fs] of groups) {
      const [subject, topic] = key.split('\u0000')
      const all = fs.every((f) => st.ids.has(f.id))
      frag.append(h('div', { class: 'grp-h' }, h('b', subject.startsWith('Physics') || st.subject === 'All' ? `${subject} ` : '', h('span', { class: 'sub' }, topic)),
        button(all ? 'Clear topic' : 'Add topic', { size: 'sm', variant: 'ghost', onClick: () => { for (const f of fs) all ? st.ids.delete(f.id) : st.ids.add(f.id); afterChange(fs.map((f) => f.id)) } })),
      h('div', { class: 'cards' }, fs.map((f) => { const c = card(f); c.setAttribute('aria-pressed', String(st.ids.has(f.id))); if (!c._done) toRender.push(c); return c })))
    }
    clear(pickBox, frag)
    // render formulas in small batches so the page stays responsive
    kref.k ||= await katexReady()
    for (let i = 0; i < toRender.length; i += 36) {
      if (tok !== renderToken) return
      for (const c of toRender.slice(i, i + 36)) { c._tx.innerHTML = tex(kref.k, c._f.tex, false); c._done = true }
      await yieldToMain()
    }
  }

  function toggleId(id) {
    st.ids.has(id) ? st.ids.delete(id) : st.ids.add(id)
    afterChange([id])
  }
  function afterChange(ids) {
    for (const id of ids) cards.get(id)?.setAttribute('aria-pressed', String(st.ids.has(id)))
    for (const b of pickBox.querySelectorAll('.grp-h button')) { /* topic buttons are refreshed on the next full render */ }
    countPill.textContent = `${st.ids.size} selected`
    renderChips(); persist(); paintSheet()
    syncTopicButtons()
  }
  function syncTopicButtons() {
    pickBox.querySelectorAll('.grp-h').forEach((hd) => {
      const cs = [...hd.nextElementSibling.children]
      const all = cs.length && cs.every((c) => c.getAttribute('aria-pressed') === 'true')
      hd.querySelector('button span').textContent = all ? 'Clear topic' : 'Add topic'
    })
  }

  let sheetTok = 0
  const paintSheet = debounce(async () => {
    const tok = ++sheetTok
    if (!st.ids.size) {
      clear(paper, emptyState('sigma', 'Pick some formulas', 'Tap formulas on the left to add them here. Your picks are remembered on this device.')); sheetCount.textContent = ''; return
    }
    const html = await sheetHtml(st.ids, { title: st.title, cols: st.cols, names: st.names })
    if (tok !== sheetTok) return
    sheetCount.textContent = `${st.ids.size} formula${st.ids.size === 1 ? '' : 's'}`
    const doc = h('div', { class: 'pgdoc', style: { '--pg-fs': `${st.fs}px`, '--pg-accent': '#6366f1' }, html })
    clear(paper, doc)
    requestAnimationFrame(() => fitOverflow(doc))
  }, 160)

  const pageOpts = () => ({ size: st.size, margin: 44, fontSize: st.fs, accent: '#6366f1', footer: { left: st.title, right: (i, n) => `Page ${i} of ${n}` } })
  const getHtml = () => sheetHtml(st.ids, { title: st.title, cols: st.cols, names: st.names })
  const dl = button('Download PDF', { variant: 'primary', icon: 'download', size: 'lg' })
  dl.addEventListener('click', () => busy(dl, async () => {
    if (!st.ids.size) throw new Error('Pick at least one formula first.')
    clear(result)
    const { blob, pages } = await htmlToPdf(await getHtml(), { ...pageOpts(), onProgress: (f, t) => prog.set(f, t) })
    download(blob, `${safeName(st.title)}.pdf`)
    clear(result, alert('success', `Saved ${pages} page${pages === 1 ? '' : 's'} (${formatBytes(blob.size)}). Use Print for a vector copy with selectable text.`))
    confetti(dl, { count: 50 })
  }, { label: 'Building PDF', errorTo: result, progress: prog }))
  const pr = button('Print', { icon: 'printer', onClick: async () => { if (!st.ids.size) return toast('Pick at least one formula first', 'error'); printDoc(await getHtml(), { size: st.size, marginMm: 12, fontSize: st.fs, title: st.title }) } })
  const cp = button('Copy LaTeX', { icon: 'copy', onClick: () => {
    if (!st.ids.size) return toast('Pick at least one formula first', 'error')
    copyText(FORMULAS.filter((f) => st.ids.has(f.id)).map((f) => `% ${f.name}\n$$${f.tex}$$`).join('\n\n'))
  } })

  const titleIn = h('input', { class: 'input', value: st.title, 'aria-label': 'Sheet title', oninput: (e) => { st.title = e.target.value || 'Formula sheet'; persist(); paintSheet() } })
  const colSeg = segmented([['1', '1'], ['2', '2'], ['3', '3']], String(st.cols), (v) => { st.cols = +v; persist(); paintSheet() }, 'Columns')
  const fsR = rangeField('Text size', { min: 10, max: 17, step: 1, value: st.fs, format: (v) => v + ' px', onInput: (v) => { st.fs = v; persist(); paintSheet() } })
  const sizeSel = select([['a4', 'A4'], ['letter', 'US Letter']], st.size, (v) => { st.size = v; persist() })
  const namesT = toggle('Show formula names', st.names, (v) => { st.names = v; persist(); paintSheet() })

  const left = tile({ tint: TINTS[0], title: 'Choose formulas', icon: 'list-checks', actions: countPill },
    h('div', { class: 'bar' }, search,
      button('Select shown', { size: 'sm', variant: 'secondary', onClick: () => { const l = shown(); for (const f of l) st.ids.add(f.id); afterChange(l.map((f) => f.id)) } }),
      button('Clear all', { size: 'sm', variant: 'ghost', onClick: () => { const ids = [...st.ids]; st.ids.clear(); afterChange(ids) } })),
    chips, pickBox)
  const right = h('div', { class: 'side' },
    tile({ tint: TINTS[4], title: 'Your sheet', icon: 'file-text', actions: sheetCount }, paper),
    tile({ tint: TINTS[2], title: 'Layout', icon: 'layout-grid' },
      h('div', { class: 'opt-grid' }, field('Columns', colSeg), field('Paper', sizeSel), fsR, field('Title', titleIn)), h('div', { style: 'margin-top:10px' }, namesT)),
    h('div', { class: 'row' }, dl, pr, cp), prog.el, result)

  root.append(stage('t-fs', h('div', { class: 'stu-bento' }, h('div', { class: 's7', style: 'min-width:0' }, left), h('div', { class: 's5', style: 'min-width:0' }, right))))
  renderPick()
  paintSheet()
}
