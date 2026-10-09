// Presentation generator: write an outline in Markdown (headings become slides, bullets become points), preview every slide live in
// four themes and download a real .pptx with speaker notes. Claude can draft the outline from a topic.
import { h, icon, button, busy, toast, alert, segmented, field, input, select, textarea, toggle, clear, debounce, onCleanup } from '../../lib/ui.js'
import { load, save } from '../../lib/store.js'
import { safeName } from '../../lib/files.js'
import * as ai from '../../lib/ai.js'
import { shell, banner, card, burst, saveAs, runsToHtml } from './_kit.js'
import { THEMES, STARTERS, parseOutline, paginate, bodySize, titleSize, runs, structurePlain } from './_deck.js'
import { buildPptx } from './_deck-pptx.js'

const KEY = 'deck:state'
const SYNTAX = `Use this Markdown outline format only:
# Deck title (first line, becomes the title slide)
A one line subtitle under it
## Slide title
- Short bullet (max 12 words, up to 5 bullets per slide)
  - Optional nested bullet
Notes: one or two sentences of speaker notes for that slide
Use "# Section name" for section dividers, "1." for numbered steps, **bold** for key terms. No tables, no images, no code fences.`

const css = (c) => `#${c}`
const U = 0.10417 // cqw per point on a 13.333in wide slide

/** One slide as HTML, scaled with container query units so it matches the exported deck. */
export function slideEl(sl, T, { footer = '', number = 0, small = false } = {}) {
  const bg = T.bg[0] === T.bg[1] ? T.bg[0] : `linear-gradient(135deg, ${T.bg[0]}, ${T.bg[1]})`
  const pos = (x, y, w, hh) => ({ left: `${(x / 13.333) * 100}%`, top: `${(y / 7.5) * 100}%`, width: `${(w / 13.333) * 100}%`, height: `${(hh / 7.5) * 100}%` })
  const pt = (n) => `${n * U}cqw`
  const el = (style, ...kids) => h('div', { class: 'cr-sl-el', style: { ...style } }, ...kids)
  const kids = []
  if (sl.type === 'title') {
    kids.push(el({ ...pos(9, -1.8, 6.6, 6.6), borderRadius: '50%', background: css(T.accent), opacity: 0.18 }), el({ ...pos(10.6, 3.9, 4.4, 4.4), borderRadius: '50%', background: css(T.accent2), opacity: 0.14 }),
      el({ ...pos(0.9, 2.35, 1.1, 0.09), background: css(T.accent) }),
      el({ ...pos(0.9, 2.6, 10.4, 2.3), fontSize: pt(sl.title.length > 50 ? 38 : 48), fontWeight: 700, color: css(T.text), fontFamily: T.head, lineHeight: 1.1 }, runsToHtml(runs(sl.title))),
      sl.subtitle ? el({ ...pos(0.9, 5.0, 10.4, 1.2), fontSize: pt(22), color: css(T.muted), fontFamily: T.body }, sl.subtitle) : null)
  } else if (sl.type === 'section') {
    kids.push(el({ ...pos(0, 0, 13.333, 7.5), background: css(T.accent), opacity: T.dark ? 0.12 : 0.2 }), el({ ...pos(-1.6, 3.8, 5.4, 5.4), borderRadius: '50%', background: css(T.accent2), opacity: 0.2 }),
      el({ ...pos(1.2, 2.6, 10.9, 2.0), fontSize: pt(44), fontWeight: 700, color: css(T.text), fontFamily: T.head, display: 'flex', alignItems: 'center' }, runsToHtml(runs(sl.title))),
      sl.subtitle ? el({ ...pos(1.2, 4.7, 10.9, 1.0), fontSize: pt(20), color: css(T.muted), fontFamily: T.body }, sl.subtitle) : null)
  } else {
    kids.push(el({ ...pos(0, 0, 0.22, 7.5), background: css(T.accent) }))
    if (sl.title) kids.push(el({ ...pos(0.8, 0.4, 11.8, 1.0), fontSize: pt(titleSize(sl.title)), fontWeight: 700, color: css(T.text), fontFamily: T.head, display: 'flex', alignItems: 'center', lineHeight: 1.1 }, runsToHtml(runs(sl.title))), el({ ...pos(0.8, 1.5, 0.9, 0.06), background: css(T.accent) }))
    const size = bodySize(sl)
    let n = 0
    const list = sl.items.map((it) => {
      if (it.num != null) n = it.num; else n = 0
      const s = it.label ? Math.max(14, size - 4) : Math.max(12, size - it.level * 3)
      return h('div', { class: 'cr-sl-li', style: { fontSize: pt(s), marginLeft: pt(it.level * 26), color: css(it.label ? T.accent : T.text), fontWeight: it.label ? 700 : 400, marginBottom: pt(it.label ? 4 : 9), paddingLeft: it.label || it.plain ? 0 : pt(24) } },
        it.label || it.plain ? null : h('span', { class: 'cr-sl-b', style: { fontSize: pt(s), left: 0 } }, it.num != null ? `${it.num}.` : '•'), runsToHtml(runs(it.text)))
    })
    kids.push(el({ ...pos(0.8, 1.85, 11.7, 4.9), fontFamily: T.body, overflow: 'hidden', lineHeight: 1.25 }, ...list))
  }
  if (footer && sl.type !== 'title') kids.push(el({ ...pos(0.8, 6.95, 8, 0.3), fontSize: pt(11), color: css(T.muted), fontFamily: T.body }, footer))
  if (number && sl.type !== 'title') kids.push(el({ ...pos(12.0, 6.95, 0.8, 0.3), fontSize: pt(11), color: css(T.muted), textAlign: 'right', fontFamily: T.body }, String(number)))
  const root = h('div', { class: ['cr-slide', small && 'small'], style: { background: bg } }, kids)
  return root
}

export async function mount(root, { signal }) {
  const prev = load(KEY, {})
  const st = { theme: THEMES[prev.theme] ? prev.theme : 'aurora', footer: prev.footer || '', numbers: prev.numbers !== false, notes: prev.notes !== false, split: prev.split !== false }
  const ta = textarea({ rows: 22, mono: true, placeholder: '# My presentation\nA short subtitle\n\n## First slide\n- Point one\n- Point two\nNotes: what to say here', value: prev.md ?? STARTERS[0].md, 'aria-label': 'Presentation outline' })
  const stage = h('div', { class: 'cr-stage-deck' })
  const strip = h('div', { class: 'cr-strip' })
  const counter = h('span', { class: 'small muted' })
  const notesBox = h('div', { class: 'small muted', style: 'min-height:20px' })
  let slides = [], sel = 0

  const model = () => {
    const parsed = parseOutline(ta.value)
    return st.split ? paginate(parsed) : parsed
  }
  const keep = () => save(KEY, { md: ta.value.slice(0, 60000), ...st })
  function draw() {
    slides = model()
    sel = Math.min(sel, Math.max(0, slides.length - 1))
    const T = THEMES[st.theme]
    if (!slides.length) {
      clear(stage, h('div', { class: 'empty' }, icon('presentation'), h('div', 'Start your outline with "# Title", then add "## Slide title" lines with "- bullets".')))
      clear(strip); counter.textContent = ''; notesBox.textContent = ''
      return
    }
    showStage()
    clear(strip, slides.map((s, i) => h('button', { type: 'button', class: ['cr-thumb-s', i === sel && 'on'], 'aria-label': `Slide ${i + 1}: ${s.title || 'untitled'}`, 'aria-current': i === sel ? 'true' : null, style: { '--i': Math.min(i, 12) }, onclick: () => { sel = i; showStage(); markStrip() } },
      slideEl(s, T, { footer: st.footer, number: st.numbers ? i + 1 : 0, small: true }), h('span', { class: 'n' }, i + 1))))
  }
  function markStrip() { [...strip.children].forEach((b, i) => { b.classList.toggle('on', i === sel); b.setAttribute('aria-current', i === sel ? 'true' : 'false'); if (i === sel) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }) }
  function showStage() {
    const T = THEMES[st.theme]
    const s = slides[sel]
    clear(stage, slideEl(s, T, { footer: st.footer, number: st.numbers ? sel + 1 : 0 }))
    counter.textContent = `Slide ${sel + 1} of ${slides.length}`
    notesBox.textContent = st.notes && s.notes ? `Speaker notes: ${s.notes}` : ''
  }
  const live = debounce(() => { keep(); draw() }, 220)
  ta.addEventListener('input', live)
  const go = (d) => { if (!slides.length) return; sel = (sel + d + slides.length) % slides.length; showStage(); markStrip() }
  const onKey = (e) => {
    if (document.fullscreenElement && (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown')) { e.preventDefault(); go(1) }
    else if (document.fullscreenElement && (e.key === 'ArrowLeft' || e.key === 'PageUp')) { e.preventDefault(); go(-1) }
  }
  document.addEventListener('keydown', onKey)
  onCleanup(() => { document.removeEventListener('keydown', onKey); if (document.fullscreenElement) document.exitFullscreen?.() })

  const themes = h('div', { class: 'cr-tpls' }, Object.entries(THEMES).map(([id, T]) => h('button', { type: 'button', class: 'cr-tpl', 'aria-pressed': String(st.theme === id), onclick: (e) => { st.theme = id; for (const b of e.currentTarget.parentElement.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); keep(); draw() } },
    h('div', { class: 'cr-thumb', style: { background: T.bg[0] === T.bg[1] ? css(T.bg[0].replace('#', '')) : `linear-gradient(135deg, ${T.bg[0]}, ${T.bg[1]})`, aspectRatio: '16 / 10', padding: '12% 10%' } }, h('i', { class: 'h', style: { '--k': css(T.accent), width: '55%', background: css(T.accent) } }), h('i', { style: { background: css(T.text), opacity: 0.5, width: '80%' } }), h('i', { style: { background: css(T.text), opacity: 0.35, width: '65%' } })), h('span', T.name, h('small', T.blurb)))))

  const fileName = () => `${safeName(slides.find((s) => s.type === 'title')?.title || 'presentation').replace(/\s+/g, '-')}.pptx`
  const dl = button('Download .pptx', { icon: 'download', variant: 'primary', size: 'lg' })
  const dlErr = h('div')
  dl.addEventListener('click', () => busy(dl, async () => {
    if (!slides.length) { toast('Write an outline first', 'error'); return }
    const title = slides.find((s) => s.type === 'title')?.title || 'Presentation'
    saveAs(await buildPptx(slides, { theme: st.theme, footer: st.footer, numbers: st.numbers, notes: st.notes, title }), fileName())
    burst(dl)
    toast(`Saved ${slides.length} slides`, 'success')
  }, { label: 'Building deck', errorTo: dlErr }))

  // starters + AI
  const starters = h('div', { class: 'cr-chips' }, STARTERS.map((s) => h('button', { type: 'button', class: 'cr-chip btn-chip', onclick: () => { ta.value = s.md; sel = 0; keep(); draw() } }, icon(s.icon), s.name)))
  const ag = { topic: '', audience: '', count: '8', tone: 'professional' }
  const topic = input({ placeholder: 'e.g. How AI is changing customer support', 'aria-label': 'Topic' })
  const aud = input({ placeholder: 'Audience, e.g. leadership team, students', 'aria-label': 'Audience' })
  const count = select([['5', '5 slides'], ['8', '8 slides'], ['10', '10 slides'], ['12', '12 slides'], ['15', '15 slides']], '8', (v) => { ag.count = v })
  const toneSeg = segmented([['professional', 'Professional'], ['friendly', 'Friendly'], ['persuasive', 'Persuasive'], ['educational', 'Educational']], 'professional', (v) => { ag.tone = v }, 'Tone')
  const aiBtn = button('Generate outline with AI', { icon: 'sparkles', variant: 'primary' })
  const aiErr = h('div')
  aiBtn.addEventListener('click', () => busy(aiBtn, async () => {
    if (topic.value.trim().length < 3) { toast('Enter a topic first', 'error'); return }
    if (!(await ai.ensureKey())) return
    const before = ta.value
    ta.value = ''
    try {
      const text = await ai.ask({
        system: `You create presentation outlines. ${SYNTAX}\nWrite concrete, specific content, not filler. Always include Notes: lines. Do not use em dashes.`,
        prompt: `Create a ${ag.count} slide presentation (including the title slide) on: ${topic.value.trim()}\nAudience: ${aud.value.trim() || 'a general professional audience'}\nTone: ${ag.tone}`,
        effort: 'low', maxTokens: 5000, signal, onText: (t) => { ta.value = t.replace(/^```\w*\n?|```$/g, ''); live() },
      })
      ta.value = text.replace(/^```\w*\n?|\n?```$/g, '').trim(); sel = 0; keep(); draw()
    } catch (e) { ta.value = before; draw(); throw e }
  }, { label: 'Writing outline', errorTo: aiErr }))

  const structure = button('Turn plain notes into an outline', { icon: 'wand-sparkles', variant: 'ghost', size: 'sm', onClick: () => {
    if (/^#{1,3}\s/m.test(ta.value)) return toast('This already has headings. Edit them directly.', 'info')
    ta.value = structurePlain(ta.value); keep(); draw()
  } })
  const present = button('Present', { icon: 'maximize', variant: 'secondary', size: 'sm', onClick: () => { if (stage.requestFullscreen) stage.requestFullscreen().catch(() => toast('Full screen is blocked in this browser', 'error')) } })

  root.append(shell(
    banner({ icon: 'presentation', text: '<b>Outline in, deck out.</b> Type headings and bullets, watch the slides appear, and download a real PowerPoint file with speaker notes.', steps: ['Write the outline', 'Pick a theme', 'Download'] }),
    h('div', { class: 'cr-work' },
      h('div', { class: 'stack' },
        card('Outline', 'list-tree', h('div', { class: 'stack tight' }, ta,
          h('div', { class: 'small muted' }, 'Lines starting with # become the title or a section, ## a slide, - a bullet (indent to nest), 1. a numbered step, Notes: speaker notes.'),
          h('div', { class: 'row' }, structure, button('Clear', { icon: 'eraser', variant: 'ghost', size: 'sm', onClick: () => { ta.value = ''; keep(); draw(); ta.focus() } })))),
        card('Start from an example', 'layout-template', starters),
        card('Draft with AI', 'sparkles', h('div', { class: 'stack tight' }, ai.notice('Optional: uses AI'), field('Topic', topic), h('div', { class: 'grid-2' }, field('Audience', aud), field('Length', count)), field('Tone', toneSeg), h('div', { class: 'row' }, aiBtn), aiErr))),
      h('div', { class: 'stack cr-sticky-lite' },
        card('Preview', 'monitor-play', h('div', { class: 'stack tight' },
          stage,
          h('div', { class: 'row between' }, h('div', { class: 'row' }, button('', { icon: 'chevron-left', variant: 'secondary', size: 'sm', ariaLabel: 'Previous slide', onClick: () => go(-1) }), counter, button('', { icon: 'chevron-right', variant: 'secondary', size: 'sm', ariaLabel: 'Next slide', onClick: () => go(1) })), present),
          notesBox, strip)),
        card('Theme and options', 'palette', h('div', { class: 'stack' }, themes,
          h('div', { class: 'grid-2' }, field('Footer text (optional)', Object.assign(input({ placeholder: 'Acme Inc. | Confidential', value: st.footer }), { oninput: (e) => { st.footer = e.target.value; keep(); draw() } }))),
          h('div', { class: 'row', style: 'gap:18px' }, toggle('Slide numbers', st.numbers, (v) => { st.numbers = v; keep(); draw() }), toggle('Speaker notes in file', st.notes, (v) => { st.notes = v; keep(); draw() }), toggle('Split long slides', st.split, (v) => { st.split = v; keep(); draw() })))),
        h('div', { class: 'row' }, dl, h('span', { class: 'small muted' }, 'Opens in PowerPoint, Keynote and Google Slides.')), dlErr))))
  draw()
  setTimeout(() => strip.classList.add('settled'), 900)
}
