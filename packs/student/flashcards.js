// Flashcards: decks saved on this device, flip-card study with Leitner boxes, import, auto-generation from notes (local or AI), Anki export, print.
import { h, button, busy, field, segmented, toggle, alert, clear, debounce, download, toast, select, copyText, formatNumber } from '../../lib/ui.js'
import * as ai from '../../lib/ai.js'
import { load, save } from '../../lib/store.js'
import { openPdf, extractText } from '../../lib/pdf.js'
import { stage, tile, toolStyle, pill, emptyState, TINTS, confetti, ring, printNode, uid, esc, confirmModal, askText, takeHandoff, acceptTextFiles, reduceMotion } from './_kit.js'
import { parsePairs, shuffle } from './_text.js'
import { buildCards } from './_qgen.js'

const DAY = 86400000
export const BOX_DAYS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 }
const BOX_NAMES = ['New / missed', 'Box 2', 'Box 3', 'Box 4', 'Mastered']

const SAMPLE = [
  ['Photosynthesis', 'The process plants use to turn light, water and carbon dioxide into glucose and oxygen.'],
  ['Chlorophyll', 'The green pigment in chloroplasts that absorbs red and blue light.'],
  ['Stomata', 'Tiny pores on leaves that let carbon dioxide in and oxygen out.'],
  ['Mitochondria', 'Organelles that release energy from glucose during cellular respiration.'],
  ['Osmosis', 'Movement of water across a semi-permeable membrane from low to high solute concentration.'],
  ['What does ATP stand for?', 'Adenosine triphosphate'],
  ['Enzyme', 'A protein that speeds up a chemical reaction without being used up.'],
  ['Diffusion', 'Net movement of particles from a region of high concentration to low concentration.'],
]

const CSS = `
.t-fc .deckbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.t-fc .deckbar .sel { min-width: 180px; flex: 1 1 200px; max-width: 320px; }
.t-fc .boxes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.t-fc .bx { border-radius: 12px; padding: 7px 4px 6px; text-align: center; background: color-mix(in srgb, var(--bc) 12%, var(--surface)); border: 1px solid color-mix(in srgb, var(--bc) 30%, var(--border)); font-size: 11px; color: var(--muted); line-height: 1.2; }
.t-fc .bx b { display: block; font-size: 20px; letter-spacing: -.03em; color: var(--text); font-variant-numeric: tabular-nums; }
.t-fc .stagebox { display: grid; gap: 14px; justify-items: center; }
.t-fc .flip { perspective: 1400px; width: 100%; max-width: 680px; min-height: 280px; cursor: pointer; outline: none; touch-action: pan-y; -webkit-tap-highlight-color: transparent; }
.t-fc .flip:focus-visible .inner { box-shadow: 0 0 0 3px var(--accent); }
.t-fc .inner { position: relative; display: grid; width: 100%; min-height: 280px; transform-style: preserve-3d; transition: transform .6s var(--ease), box-shadow .3s; border-radius: 26px; box-shadow: 0 18px 40px -24px rgba(30,30,60,.45); }
.t-fc .flip.on .inner { transform: rotateY(180deg); }
.t-fc .flip.enter { animation: fc-in .4s var(--ease) backwards; }
@keyframes fc-in { from { opacity: 0; transform: translateY(14px) scale(.97); } }
.t-fc .face { grid-area: 1 / 1; position: relative; min-height: 280px; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 26px; padding: 40px 28px 34px; display: grid; place-items: center; text-align: center;
  background: linear-gradient(150deg, color-mix(in srgb, var(--tint, #6366f1) 14%, var(--surface)), var(--surface) 70%); border: 1px solid color-mix(in srgb, var(--tint, #6366f1) 32%, var(--border)); }
.t-fc .face.back { transform: rotateY(180deg); --tint: #10b981; }
.t-fc .face .tag { position: absolute; top: 14px; left: 18px; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; font-weight: 650; color: var(--tint); }
.t-fc .face .txt { font-size: clamp(20px, 3.4vw, 30px); line-height: 1.35; font-weight: 600; letter-spacing: -.02em; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 100%; }
.t-fc .face .txt.long { font-size: clamp(16px, 2.4vw, 21px); font-weight: 520; }
.t-fc .face .hintline { position: absolute; bottom: 12px; left: 0; right: 0; font-size: 12px; color: var(--muted); }
.t-fc .flip.fly-r .inner { animation: fc-fly-r .35s var(--ease) forwards; }
.t-fc .flip.fly-l .inner { animation: fc-fly-l .35s var(--ease) forwards; }
@keyframes fc-fly-r { to { transform: translateX(60%) rotate(8deg); opacity: 0; } }
@keyframes fc-fly-l { to { transform: translateX(-60%) rotate(-8deg); opacity: 0; } }
.t-fc .flip.on.fly-r .inner { animation-name: fc-fly-r2; } .t-fc .flip.on.fly-l .inner { animation-name: fc-fly-l2; }
@keyframes fc-fly-r2 { from { transform: rotateY(180deg); } to { transform: rotateY(180deg) translateX(-60%); opacity: 0; } }
@keyframes fc-fly-l2 { from { transform: rotateY(180deg); } to { transform: rotateY(180deg) translateX(60%); opacity: 0; } }
.t-fc .rate { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; max-width: 680px; }
.t-fc .rate .btn { min-height: 52px; font-size: 15.5px; }
.t-fc .bar { height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; width: 100%; max-width: 680px; }
.t-fc .bar i { display: block; height: 100%; width: 0; background: var(--brand); border-radius: inherit; transition: width .4s var(--ease); }
.t-fc .row-card { display: grid; grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr) auto; gap: 8px; align-items: start; padding: 8px 0; border-bottom: 1px dashed var(--border); }
.t-fc .row-card .n { padding-top: 10px; font-size: 12px; color: var(--muted); text-align: right; }
.t-fc .row-card .textarea { min-height: 44px; height: 44px; resize: vertical; padding: 8px 10px; font-size: 14px; }
@media (max-width: 640px) { .t-fc .row-card { grid-template-columns: minmax(0, 1fr) auto; } .t-fc .row-card .n { display: none; } .t-fc .row-card .textarea { grid-column: 1 / -1; } .t-fc .row-card > .rm { grid-row: 1; grid-column: 2; } }
.t-fc .pv { display: grid; gap: 6px; max-height: 360px; overflow: auto; }
.t-fc .pv label { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); cursor: pointer; font-size: 13.5px; }
.t-fc .pv label b { display: block; font-weight: 600; } .t-fc .pv label span { color: var(--text-2); }
.t-fc .summary { text-align: center; display: grid; gap: 12px; justify-items: center; padding: 10px; animation: stu-pop .5s var(--ease) both; }
.t-fc .missed li { text-align: left; }
`

const BOX_TINT = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#6366f1']

export function mount(root) {
  toolStyle('fc', CSS)
  let S = load('fc:state', null)
  if (!S?.decks?.length) S = { decks: [{ id: uid(), name: 'My first deck', cards: [] }], active: null }
  S.active = S.decks.find((d) => d.id === S.active) ? S.active : S.decks[0].id
  const prefs = { shuffle: true, mode: 'due', reverse: false, ...load('fc:prefs', {}) }
  const persist = () => save('fc:state', S)
  const persistPrefs = () => save('fc:prefs', prefs)
  const deck = () => S.decks.find((d) => d.id === S.active)
  const now = () => Date.now()
  const mkCard = (front, back) => ({ id: uid(), front: String(front).trim(), back: String(back).trim(), box: 1, due: 0, seen: 0 })
  const dueCards = () => deck().cards.filter((c) => c.due <= now())

  const wrap = stage('t-fc')
  const deckSel = h('div', { class: 'sel' })
  const statsEl = h('div', { class: 'row' })
  const boxesEl = h('div', { class: 'boxes' })
  const body = h('div', { class: 'stack' })
  let tab = load('fc:tab', 'study')
  let session = null
  let cleanupKey = null

  // ---------------- deck bar ----------------
  function renderDeckBar() {
    const sel = select(S.decks.map((d) => [d.id, `${d.name} (${d.cards.length})`]), S.active, (v) => { S.active = v; persist(); session = null; renderAll() })
    clear(deckSel, sel)
    const d = deck()
    const due = dueCards().length
    const mastered = d.cards.filter((c) => c.box >= 4).length
    clear(statsEl, pill(`${d.cards.length} card${d.cards.length === 1 ? '' : 's'}`, '', 'layers'), pill(`${due} due`, due ? 'warn' : 'ok', 'clock'), pill(`${mastered} known`, mastered ? 'ok' : '', 'circle-check'))
    clear(boxesEl, [1, 2, 3, 4, 5].map((b) => h('div', { class: 'bx', style: { '--bc': BOX_TINT[b - 1] }, title: b === 1 ? 'Every session' : `Reviewed every ${BOX_DAYS[b]} days` }, h('b', d.cards.filter((c) => c.box === b).length), BOX_NAMES[b - 1])))
  }
  const newDeck = () => askText({ title: 'New deck', label: 'Give the deck a name', value: `Deck ${S.decks.length + 1}`, ok: 'Create deck' }, (name) => {
    const d = { id: uid(), name: name.slice(0, 60), cards: [] }
    S.decks.push(d); S.active = d.id; persist(); session = null; tab = 'add'; save('fc:tab', tab); tabsBar.set(tab); renderAll()
  })
  const renameDeck = () => askText({ title: 'Rename deck', value: deck().name, ok: 'Rename' }, (name) => { deck().name = name.slice(0, 60); persist(); renderDeckBar() })
  const removeDeck = () => confirmModal({ title: `Delete "${deck().name}"?`, text: `This deletes the deck and its ${deck().cards.length} cards from this device. Export first if you want a backup.`, yes: 'Delete deck', danger: true }, () => {
    S.decks = S.decks.filter((d) => d.id !== S.active)
    if (!S.decks.length) S.decks.push({ id: uid(), name: 'My first deck', cards: [] })
    S.active = S.decks[0].id; persist(); session = null; renderAll()
  })

  // ---------------- tabs ----------------
  const tabsBar = segmented([['study', 'Study'], ['cards', 'Cards'], ['add', 'Add cards']], tab, (v) => setTab(v), 'Section')
  function setTab(v) { tab = v; save('fc:tab', v); tabsBar.set(v); renderBody() }

  function renderAll() { renderDeckBar(); renderBody() }
  function renderBody() {
    cleanupKey?.(); cleanupKey = null
    if (tab === 'study') clear(body, studyView())
    else if (tab === 'cards') clear(body, cardsView())
    else clear(body, addView())
  }

  // ---------------- study ----------------
  function studyView() {
    const d = deck()
    if (!d.cards.length) {
      return tile({ tint: TINTS[0] }, emptyState('layers', 'This deck is empty', 'Add cards by pasting "term - definition" lines, or turn your notes into cards.',
        button('Add cards', { variant: 'primary', icon: 'plus', onClick: () => setTab('add') }), button('Try a sample deck', { icon: 'wand-sparkles', onClick: () => { for (const [f, b] of SAMPLE) d.cards.push(mkCard(f, b)); persist(); renderAll() } })))
    }
    if (session?.done) return summaryView()
    if (session) return cardView()
    const due = dueCards().length
    const modeSeg = segmented([['due', `Due now (${due})`], ['learning', 'Still learning'], ['all', 'All cards']], prefs.mode, (v) => { prefs.mode = v; persistPrefs() }, 'Which cards')
    const go = button('Start studying', { variant: 'primary', size: 'lg', icon: 'play', onClick: () => start(prefs.mode) })
    return tile({ tint: TINTS[0], title: 'Study', icon: 'graduation-cap' },
      h('div', { class: 'stack' },
        boxesEl,
        h('div', { class: 'stu-hint' }, 'Cards you miss go back to box 1 and come up every session. Cards you know move up and return less often: 1, 3, 7, then 14 days.'),
        field('Which cards', modeSeg),
        h('div', { class: 'row' }, toggle('Shuffle', prefs.shuffle, (v) => { prefs.shuffle = v; persistPrefs() }), toggle('Show the answer side first', prefs.reverse, (v) => { prefs.reverse = v; persistPrefs() })),
        due === 0 && prefs.mode === 'due' ? alert('success', 'Nothing is due right now. Nice work. Pick "All cards" to practise anyway.') : null,
        h('div', { class: 'row' }, go)))
  }

  function start(mode, ids) {
    const d = deck()
    let list = ids ? d.cards.filter((c) => ids.includes(c.id)) : mode === 'due' ? dueCards() : mode === 'learning' ? d.cards.filter((c) => c.box <= 3) : [...d.cards]
    if (!list.length) { toast(mode === 'due' ? 'Nothing is due. Try "All cards".' : 'No cards to study in that group', 'info'); return }
    list = prefs.shuffle ? shuffle(list) : list.sort((a, b) => a.box - b.box)
    session = { queue: list.map((c) => c.id), i: 0, got: 0, missed: [], total: list.length, flipped: false, undo: [], retries: {} }
    renderBody()
  }

  function cardView() {
    const s = session
    const d = deck()
    const c = d.cards.find((x) => x.id === s.queue[s.i])
    if (!c) { s.done = true; return summaryView() }
    const frontText = prefs.reverse ? c.back : c.front, backText = prefs.reverse ? c.front : c.back
    const mk = (cls, tag, text) => h('div', { class: ['face', cls] }, h('span', { class: 'tag' }, tag), h('div', { class: ['txt', text.length > 140 && 'long'] }, text), cls === 'front' ? h('div', { class: 'hintline' }, 'Tap or press Space to flip') : null)
    const flip = h('div', { class: ['flip enter', s.flipped && 'on'], tabindex: 0, role: 'button', 'aria-label': 'Flashcard. Press space to flip.', 'aria-pressed': String(s.flipped) },
      h('div', { class: 'inner' }, mk('front', prefs.reverse ? 'Answer' : 'Question', frontText), mk('back', prefs.reverse ? 'Question' : 'Answer', backText)))
    const bar = h('i'); bar.style.width = `${(s.i / s.queue.length) * 100}%`
    const rate = (got) => {
      if (!s.flipped) return doFlip()
      flip.classList.add(got ? 'fly-r' : 'fly-l')
      const advance = () => { applyRating(c, got); s.flipped = false; s.i++; renderBody(); renderDeckBar() }
      reduceMotion() ? advance() : setTimeout(advance, 260)
    }
    const doFlip = () => { s.flipped = !s.flipped; flip.classList.toggle('on', s.flipped); flip.setAttribute('aria-pressed', String(s.flipped)); missBtn.disabled = gotBtn.disabled = false; missBtn.style.opacity = gotBtn.style.opacity = '' }
    flip.addEventListener('click', doFlip)
    let sx = null
    flip.addEventListener('pointerdown', (e) => { sx = e.clientX })
    flip.addEventListener('pointerup', (e) => { if (sx != null && Math.abs(e.clientX - sx) > 90 && s.flipped) { e.preventDefault(); rate(e.clientX > sx) } sx = null })
    const missBtn = button('Missed it', { variant: 'secondary', icon: 'x', onClick: () => rate(false), attrs: { 'aria-keyshortcuts': '1' } })
    const gotBtn = button('Got it', { variant: 'primary', icon: 'check', onClick: () => rate(true), attrs: { 'aria-keyshortcuts': '2' } })
    if (!s.flipped) { missBtn.style.opacity = gotBtn.style.opacity = '.55' }
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return
      if (e.key === ' ' || e.key === 'Enter') { if (document.activeElement?.tagName === 'BUTTON') return; e.preventDefault(); doFlip() }
      else if (e.key === 'ArrowRight' || e.key === '2') rate(true)
      else if (e.key === 'ArrowLeft' || e.key === '1') rate(false)
      else if (e.key === 'z' || e.key === 'Backspace') undo()
    }
    document.addEventListener('keydown', onKey)
    cleanupKey = () => document.removeEventListener('keydown', onKey)
    const undo = () => {
      const u = s.undo.pop()
      if (!u) return
      const cc = d.cards.find((x) => x.id === u.id)
      Object.assign(cc, u.prev)
      s.i = u.i; s.queue = u.queue; s.got = u.got; s.missed = u.missed; s.flipped = false
      persist(); renderBody(); renderDeckBar()
    }
    setTimeout(() => flip.focus({ preventScroll: true }), 30)
    return tile({ tint: TINTS[0], title: `Card ${s.i + 1} of ${s.queue.length}`, icon: 'layers', actions: h('div', { class: 'row', style: 'gap:6px' }, button('', { icon: 'undo-2', variant: 'ghost', size: 'sm', ariaLabel: 'Undo last answer', disabled: !s.undo.length, onClick: undo }), button('End', { variant: 'ghost', size: 'sm', onClick: () => { session = null; renderBody(); renderDeckBar() } })) },
      h('div', { class: 'stagebox' }, h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': s.queue.length, 'aria-valuenow': s.i }, bar), flip,
        h('div', { class: 'rate' }, missBtn, gotBtn),
        h('div', { class: 'stu-hint' }, h('span', { class: 'stu-kbd' }, 'Space'), ' flip  ', h('span', { class: 'stu-kbd' }, '1'), ' missed  ', h('span', { class: 'stu-kbd' }, '2'), ' got it  ', h('span', { class: 'stu-kbd' }, 'Z'), ' undo')))
  }

  function applyRating(c, got) {
    const s = session
    s.undo.push({ id: c.id, prev: { box: c.box, due: c.due, seen: c.seen }, i: s.i, queue: [...s.queue], got: s.got, missed: [...s.missed] })
    c.seen++
    if (got) { c.box = Math.min(5, c.box + 1); c.due = now() + BOX_DAYS[c.box] * DAY; s.got++ } else {
      c.box = 1; c.due = now()
      if (!s.missed.includes(c.id)) s.missed.push(c.id)
      if ((s.retries[c.id] = (s.retries[c.id] || 0) + 1) <= 1) s.queue.push(c.id) // ask once more at the end
    }
    persist()
  }

  function summaryView() {
    const s = session
    const d = deck()
    const firstTry = s.total - s.missed.length
    const pct = s.total ? Math.round((firstTry / s.total) * 100) : 0
    const r = ring({ value: pct, max: 100, size: 150, stroke: 13, label: 'first try', fmt: (v) => `${Math.round(v)}%`, color: pct >= 80 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)' })
    setTimeout(() => { if (pct >= 80 && session === s) confetti(r) }, 300)
    const missedCards = s.missed.map((id) => d.cards.find((c) => c.id === id)).filter(Boolean)
    return tile({ tint: pct >= 80 ? TINTS[3] : TINTS[2], title: 'Session complete', icon: 'trophy' },
      h('div', { class: 'summary' }, r,
        h('div', null, h('b', { style: 'font-size:18px' }, pct >= 80 ? 'Great session!' : pct >= 50 ? 'Good progress' : 'Keep going, repetition works'), h('div', { class: 'muted' }, `${firstTry} of ${s.total} right the first time`)),
        missedCards.length ? h('div', { class: 'stack', style: 'width:100%;max-width:520px' }, h('div', { class: 'small muted' }, 'Cards to revisit'), h('ul', { class: 'missed', style: 'margin:0;padding-left:18px' }, missedCards.slice(0, 12).map((c) => h('li', c.front.length > 90 ? c.front.slice(0, 88) + '...' : c.front)))) : null,
        h('div', { class: 'row', style: 'justify-content:center' },
          missedCards.length ? button('Study missed cards', { variant: 'primary', icon: 'rotate-ccw', onClick: () => start('all', missedCards.map((c) => c.id)) }) : null,
          button('Back to deck', { variant: missedCards.length ? 'secondary' : 'primary', onClick: () => { session = null; renderAll() } }))))
  }

  // ---------------- cards ----------------
  let cardsShown = 100, filterQ = ''
  function cardsView() {
    const d = deck()
    const q = h('input', { class: 'input', type: 'search', placeholder: `Search ${d.cards.length} cards`, value: filterQ, 'aria-label': 'Search cards', oninput: debounce((e) => { filterQ = e.target.value; cardsShown = 100; draw() }, 150) })
    const list = h('div')
    const fIn = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Front (question or term)', 'aria-label': 'New card front' })
    const bIn = h('textarea', { class: 'textarea', rows: 2, placeholder: 'Back (answer or definition)', 'aria-label': 'New card back' })
    const addOne = () => {
      if (!fIn.value.trim() || !bIn.value.trim()) return toast('Fill in both sides', 'error')
      d.cards.unshift(mkCard(fIn.value, bIn.value)); fIn.value = bIn.value = ''; persist(); renderDeckBar(); draw(); fIn.focus()
    }
    bIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addOne() })
    function draw() {
      const nq = filterQ.trim().toLowerCase()
      const cs = d.cards.filter((c) => !nq || `${c.front} ${c.back}`.toLowerCase().includes(nq))
      clear(list, cs.slice(0, cardsShown).map((c, i) => {
        const f = h('textarea', { class: 'textarea', value: c.front, 'aria-label': `Front of card ${i + 1}`, oninput: (e) => { c.front = e.target.value; persist() } })
        const b = h('textarea', { class: 'textarea', value: c.back, 'aria-label': `Back of card ${i + 1}`, oninput: (e) => { c.back = e.target.value; persist() } })
        return h('div', { class: 'row-card' }, h('span', { class: 'n' }, i + 1), f, b,
          h('div', { class: 'rm', style: 'display:flex;flex-direction:column;align-items:center;gap:2px' }, button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: `Delete card ${i + 1}`, onClick: () => { d.cards = d.cards.filter((x) => x !== c); persist(); renderDeckBar(); draw() } }),
            h('span', { class: 'stu-pill', style: { '--tint': BOX_TINT[c.box - 1], padding: '1px 8px', fontSize: '11px' }, title: 'Leitner box' }, `B${c.box}`)))
      }), cs.length > cardsShown ? button(`Show ${Math.min(100, cs.length - cardsShown)} more`, { variant: 'ghost', onClick: () => { cardsShown += 100; draw() } }) : null,
      !cs.length ? emptyState('search', d.cards.length ? 'No cards match' : 'No cards yet', d.cards.length ? 'Try a different search.' : 'Add your first card above, or use the Add cards tab.') : null)
    }
    draw()
    return h('div', { class: 'stack' },
      tile({ tint: TINTS[1], title: 'Add a card', icon: 'plus' }, h('div', { class: 'stack' }, h('div', { class: 'tool-split' }, fIn, bIn), h('div', { class: 'row' }, button('Add card', { variant: 'primary', icon: 'plus', onClick: addOne }), h('span', { class: 'stu-hint' }, 'Ctrl+Enter in the back box adds it too.')))),
      tile({ tint: TINTS[4], title: `Cards in ${d.name}`, icon: 'list', actions: h('div', { class: 'row', style: 'gap:6px' }, button('Reset progress', { size: 'sm', variant: 'ghost', icon: 'rotate-ccw', onClick: () => confirmModal({ title: 'Reset progress?', text: 'All cards go back to box 1 and are due again.', yes: 'Reset' }, () => { for (const c of d.cards) { c.box = 1; c.due = 0; c.seen = 0 } persist(); renderAll() }) })) },
        h('div', { class: 'stack' }, q, list)),
      exportTile())
  }

  function exportTile() {
    const d = deck()
    const need = () => { if (!d.cards.length) { toast('This deck has no cards yet', 'error'); return false } return true }
    const csvQ = (s) => `"${String(s).replace(/"/g, '""').replace(/\r?\n/g, '<br>')}"`
    const name = () => d.name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'deck'
    return tile({ tint: TINTS[3], title: 'Export, print and back up', icon: 'share-2' },
      h('div', { class: 'stack' },
        h('div', { class: 'row' },
          button('Anki CSV', { variant: 'primary', icon: 'download', onClick: () => { if (need()) download('﻿' + d.cards.map((c) => `${csvQ(c.front)},${csvQ(c.back)}`).join('\r\n') + '\r\n', `${name()}-anki.csv`, 'text/csv;charset=utf-8') } }),
          button('Anki text (tab)', { icon: 'download', onClick: () => { if (need()) download('#separator:tab\n#html:true\n' + d.cards.map((c) => `${esc(c.front).replace(/\r?\n/g, '<br>')}\t${esc(c.back).replace(/\r?\n/g, '<br>')}`).join('\n') + '\n', `${name()}-anki.txt`, 'text/plain;charset=utf-8') } }),
          button('Print cards', { icon: 'printer', onClick: () => { if (need()) printCards(d) } }),
          button('Backup (JSON)', { icon: 'file-json', onClick: () => download(JSON.stringify(d, null, 1), `${name()}.json`, 'application/json') }),
          button('Restore backup', { icon: 'upload', onClick: restore })),
        h('div', { class: 'stu-hint' }, 'In Anki: File > Import, pick the file, choose the Basic note type. Card progress is not exported, only the text.'),
        h('div', { class: 'row' }, button('Rename deck', { size: 'sm', variant: 'ghost', icon: 'pencil', onClick: renameDeck }), button('Delete deck', { size: 'sm', variant: 'ghost', icon: 'trash-2', onClick: removeDeck }))))
  }
  function restore() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' })
    inp.onchange = async () => {
      try {
        const j = JSON.parse(await inp.files[0].text())
        const cards = (j.cards || []).filter((c) => c?.front && c?.back).map((c) => ({ ...mkCard(c.front, c.back), box: Math.min(5, Math.max(1, +c.box || 1)), due: +c.due || 0, seen: +c.seen || 0 }))
        if (!cards.length) throw new Error('empty')
        S.decks.push({ id: uid(), name: `${String(j.name || 'Restored deck').slice(0, 50)} (restored)`, cards }); S.active = S.decks.at(-1).id; persist(); session = null; renderAll(); toast(`Restored ${cards.length} cards`, 'success')
      } catch { toast('That file is not a deck backup from this tool.', 'error') }
    }
    inp.click()
  }
  function printCards(d) {
    const rows = d.cards.map((c) => `<div style="display:grid;grid-template-columns:1fr 1fr;border:1px dashed #9aa0b4;break-inside:avoid;margin:0 0 6px"><div style="padding:10px 14px;border-right:1px dashed #9aa0b4"><div style="font:600 9px sans-serif;color:#6b7188;letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px">Front</div><div style="font:600 14px/1.35 sans-serif;color:#111">${esc(c.front)}</div></div><div style="padding:10px 14px"><div style="font:600 9px sans-serif;color:#6b7188;letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px">Back</div><div style="font:400 13px/1.4 sans-serif;color:#222">${esc(c.back)}</div></div></div>`).join('')
    const node = h('div', { html: `<h2 style="font:700 20px sans-serif;margin:0 0 10px;color:#111">${esc(d.name)}</h2>${rows}` })
    printNode(node, d.name)
  }

  // ---------------- add ----------------
  function addView() {
    const sub = load('fc:addtab', 'paste')
    const body2 = h('div')
    const seg = segmented([['paste', 'Paste or import'], ['notes', 'From notes']], sub, (v) => { save('fc:addtab', v); drawSub(v) }, 'How to add')
    function drawSub(v) { clear(body2, v === 'paste' ? pasteView() : notesView()) }
    drawSub(sub)
    return h('div', { class: 'stack' }, h('div', { class: 'row' }, seg), body2)
  }

  function addCards(pairs) {
    const d = deck()
    const have = new Set(d.cards.map((c) => c.front.toLowerCase()))
    let added = 0, dup = 0
    for (const { front, back } of pairs) { if (have.has(front.toLowerCase())) { dup++; continue } d.cards.push(mkCard(front, back)); have.add(front.toLowerCase()); added++ }
    persist(); renderDeckBar()
    toast(added ? `Added ${added} card${added === 1 ? '' : 's'}${dup ? `, skipped ${dup} already in the deck` : ''}` : 'Those cards are already in the deck', added ? 'success' : 'info')
    return added
  }

  function pasteView() {
    const ta = h('textarea', { class: 'textarea', rows: 9, placeholder: 'Mitosis - cell division that makes two identical cells\nOsmosis: movement of water across a membrane\nParis, France\nor paste two columns from a spreadsheet', 'aria-label': 'Cards to import' })
    const info = h('div', { class: 'stu-hint' })
    const pv = h('div', { class: 'pv' })
    let pairs = []
    const upd = debounce(() => {
      pairs = parsePairs(ta.value)
      const lines = ta.value.split(/\n/).filter((l) => l.trim()).length
      info.textContent = ta.value.trim() ? `${pairs.length} card${pairs.length === 1 ? '' : 's'} found${lines > pairs.length ? ` (${lines - pairs.length} line${lines - pairs.length === 1 ? '' : 's'} skipped: no separator)` : ''}` : 'Use "term - definition", "term: definition", a tab between columns, or CSV.'
      clear(pv, pairs.slice(0, 6).map((p) => h('label', { style: 'cursor:default;grid-template-columns:1fr' }, h('span', h('b', p.front), p.back))), pairs.length > 6 ? h('div', { class: 'stu-hint' }, `and ${pairs.length - 6} more`) : null)
    }, 150)
    ta.addEventListener('input', upd)
    acceptTextFiles(ta, (t) => { ta.value = t; upd() })
    const fileBtn = button('Load a CSV, TSV or text file', { icon: 'file-up', variant: 'secondary', onClick: () => { const inp = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.md,text/*' }); inp.onchange = async () => { ta.value = await inp.files[0].text(); upd() }; inp.click() } })
    const add = button('Add cards', { variant: 'primary', icon: 'plus', onClick: () => { if (!pairs.length) return toast('Nothing to add yet', 'error'); if (addCards(pairs)) { ta.value = ''; upd(); setTab('study') } } })
    return tile({ tint: TINTS[1], title: 'Paste "term - definition" lines', icon: 'clipboard-paste' }, h('div', { class: 'stack' }, ta, info, pv, h('div', { class: 'row' }, add, fileBtn)))
  }

  function notesView() {
    const ta = h('textarea', { class: 'textarea', rows: 10, placeholder: 'Paste your notes or textbook paragraph. Definitions like "Mitosis is the process of..." and facts with numbers become cards.', 'aria-label': 'Notes to turn into cards' })
    const out = h('div')
    const ready = takeHandoff('flashcards')
    const fileBtn = button('Load a .txt, .md or PDF', { icon: 'file-up', variant: 'secondary', onClick: () => { const inp = h('input', { type: 'file', accept: '.txt,.md,.pdf,text/*,application/pdf' }); inp.onchange = () => busy(fileBtn, async () => { const f = inp.files[0]; ta.value = /\.pdf$/i.test(f.name) ? (await extractText(await openPdf(f))).map((p) => p.text).join('\n\n') : await f.text() }, 'Reading'); inp.click() } })
    acceptTextFiles(ta, (t) => { ta.value = t })
    let found = []
    function showFound(list, source) {
      found = list
      if (!list.length) { clear(out, alert('info', 'No definitions or facts were found. Try notes written as full sentences ("X is ...", "X refers to ..."), or use "term - definition" lines in the Paste tab. AI can handle looser notes.')); return }
      const boxes = list.map((c) => h('input', { type: 'checkbox', checked: true }))
      clear(out, h('div', { class: 'stack' },
        h('div', { class: 'row' }, pill(`${list.length} card${list.length === 1 ? '' : 's'} ${source}`, 'ok', 'sparkles'), h('span', { class: 'stu-hint' }, 'Untick any you do not want, then add them.')),
        h('div', { class: 'pv' }, list.map((c, i) => h('label', boxes[i], h('span', h('b', c.front), c.back)))),
        h('div', { class: 'row' }, button('Add selected', { variant: 'primary', icon: 'plus', onClick: () => { const pick = list.filter((_, i) => boxes[i].checked); if (!pick.length) return toast('Select at least one card', 'error'); addCards(pick); setTab('study') } }),
          button('Select all', { size: 'sm', variant: 'ghost', onClick: () => boxes.forEach((b) => (b.checked = true)) }), button('Select none', { size: 'sm', variant: 'ghost', onClick: () => boxes.forEach((b) => (b.checked = false)) }))))
    }
    const local = button('Make cards (on this device)', { variant: 'primary', icon: 'wand-sparkles', onClick: () => {
      if (ta.value.trim().length < 40) return toast('Paste a few sentences of notes first', 'error')
      showFound(buildCards(ta.value, { max: 60 }).map((c) => ({ front: c.front, back: c.back })), 'found in your notes')
    } })
    const aiBtn = button('Make cards with AI', { icon: 'sparkles', onClick: () => busy(aiBtn, async () => {
      if (ta.value.trim().length < 40) throw new Error('Paste a few sentences of notes first.')
      if (!(await ai.ensureKey())) return
      clear(out)
      const res = await ai.ask({
        system: 'You write high-quality study flashcards. Each card tests one idea. Fronts are short questions or terms; backs are concise, accurate answers taken from the notes. Do not invent facts that are not supported by the notes. Skip trivia.',
        prompt: `Create up to 30 flashcards from these notes. Keep the language of the notes.\n\nNOTES:\n${ta.value.slice(0, 40000)}`,
        json: { type: 'object', properties: { cards: { type: 'array', items: { type: 'object', properties: { front: { type: 'string' }, back: { type: 'string' } }, required: ['front', 'back'], additionalProperties: false } } }, required: ['cards'], additionalProperties: false },
        effort: 'low', maxTokens: 8000,
      })
      showFound((res.cards || []).filter((c) => c.front && c.back), 'written by AI')
    }, { label: 'Writing cards', errorTo: out }) })
    if (typeof ready === 'string' && ready) { ta.value = ready; setTimeout(() => local.click(), 60) }
    return tile({ tint: TINTS[2], title: 'Turn notes into cards', icon: 'wand-sparkles' },
      h('div', { class: 'stack' }, ta, h('div', { class: 'row' }, local, aiBtn, fileBtn), ai.notice('AI option uses Claude'), out))
  }

  // ---------------- shell ----------------
  const head = tile({ tint: TINTS[5] },
    h('div', { class: 'stack' }, h('div', { class: 'deckbar' }, deckSel, button('New deck', { icon: 'plus', size: 'sm', onClick: newDeck }), tabsBar), statsEl))
  wrap.append(h('div', { class: 'stack' }, head, body))
  root.append(wrap)
  const handoffPending = load('student:handoff:flashcards', null)
  if (handoffPending) { tab = 'add'; save('fc:addtab', 'notes') }
  tabsBar.set(tab)
  renderAll()
  return () => cleanupKey?.()
}
