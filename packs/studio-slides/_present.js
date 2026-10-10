// Present mode (full screen, keyboard, click and swipe navigation, transitions) and the presenter window
// (current slide, next slide, speaker notes, timer) opened with window.open.
import { h, icon, toast } from '../../lib/ui.js'
import { renderSlide } from './_render.js'
import { SLIDE_CSS, PRESENTER_CSS } from './_styles.js'

const DUR = 520

export function createPresenter(app) {
  const { store } = app
  let st = null // active session

  const url = (id) => store.assetUrl(id)
  const slideNode = (i) => renderSlide(store.deck, store.deck.slides[i], { mode: 'view', url })

  function start({ from = 'start', presenter = false } = {}) {
    if (st) stop()
    const deck = store.deck
    const index = from === 'current' ? store.cur : 0
    const stageEl = h('div', { class: 'ss-pstage' })
    const veil = h('div', { class: 'ss-pveil', hidden: true })
    const counter = h('span', { class: 'ss-pcount' })
    const bar = h('div', { class: 'ss-pbar' },
      h('button', { type: 'button', 'aria-label': 'Previous slide', onclick: (e) => { e.stopPropagation(); go(st.i - 1) } }, icon('chevron-left')),
      counter,
      h('button', { type: 'button', 'aria-label': 'Next slide', onclick: (e) => { e.stopPropagation(); go(st.i + 1) } }, icon('chevron-right')),
      h('button', { type: 'button', 'aria-label': 'Open presenter view', title: 'Presenter view', onclick: (e) => { e.stopPropagation(); openPresenterView() } }, icon('monitor')),
      h('button', { type: 'button', 'aria-label': 'Exit presentation', title: 'Exit (Esc)', onclick: (e) => { e.stopPropagation(); stop() } }, icon('x')))
    const prog = h('div', { class: 'ss-pprog' }, h('i'))
    const el = h('div', { class: 'ss-present', role: 'dialog', 'aria-label': 'Presentation', tabindex: -1 }, stageEl, veil, bar, prog)
    document.body.append(el)
    st = { el, stageEl, veil, counter, prog, i: index, layer: null, anims: [], timer: 0, pw: null, hideT: 0, startedAt: Date.now(), deck }
    app.presenting = true
    app.stage.drawOverlay()

    const showLayer = (i) => {
      const k = fit()
      const slide = slideNode(i)
      Object.assign(slide.style, { position: 'absolute', left: `${(innerWidth - deck.w * k) / 2}px`, top: `${(innerHeight - deck.h * k) / 2}px`, transform: `scale(${k})`, transformOrigin: '0 0' })
      const layer = h('div', { class: 'ss-pl' }, slide)
      stageEl.append(layer)
      return layer
    }
    st.showLayer = showLayer
    st.layer = showLayer(index)
    update()

    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('mousemove', wake)
    document.addEventListener('fullscreenchange', onFs)
    wake()
    el.focus({ preventScroll: true })
    el.requestFullscreen?.().catch(() => {})
    if (presenter) openPresenterView()
  }

  const fit = () => Math.min(innerWidth / st.deck.w, innerHeight / st.deck.h)

  function update() {
    const n = st.deck.slides.length
    st.counter.textContent = `${st.i + 1} / ${n}`
    st.prog.firstChild.style.width = `${((st.i + 1) / n) * 100}%`
    st.pw && !st.pw.closed && st.pwUpdate?.()
  }

  function go(to) {
    if (!st) return
    const n = st.deck.slides.length
    if (to >= n) { stop(); return }
    to = Math.max(0, to)
    if (to === st.i) return
    for (const a of st.anims) { try { a.finish() } catch { /* already done */ } }
    st.anims = []
    const dir = to > st.i ? 1 : -1
    const tr = store.deck.slides[Math.max(st.i, to)].tr || 'none' // the transition belongs to the slide you arrive at going forward
    const old = st.layer
    st.i = to
    const neu = st.showLayer(to)
    st.layer = neu
    const done = () => { old.remove() }
    const opts = { duration: DUR, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
    const run = (target, frames) => { const a = target.animate(frames, opts); st.anims.push(a); return a.finished.catch(() => {}) }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || tr === 'none') done()
    else if (tr === 'fade') { run(neu, [{ opacity: 0 }, { opacity: 1 }]).then(done) }
    else if (tr === 'slide') { run(neu, [{ transform: `translateX(${100 * dir}%)` }, { transform: 'none' }]); run(old, [{ transform: 'none' }, { transform: `translateX(${-100 * dir}%)` }]).then(done) }
    else if (tr === 'zoom') { run(neu, [{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'none' }]); run(old, [{ opacity: 1 }, { opacity: 0 }]).then(done) }
    else done()
    update()
  }

  function onKey(e) {
    if (!st) return
    const k = e.key
    const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)
    const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k)
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); return }
    if (next) go(st.i + 1)
    else if (prev) go(st.i - 1)
    else if (k === 'Home') go(0)
    else if (k === 'End') go(st.deck.slides.length - 1)
    else if (k === 'b' || k === 'B' || k === '.') toggleVeil('black')
    else if (k === 'w' || k === 'W' || k === ',') toggleVeil('white')
    else if (k === 'f' || k === 'F') { if (document.fullscreenElement) document.exitFullscreen?.(); else st.el.requestFullscreen?.().catch(() => {}) }
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  function toggleVeil(c) {
    const on = st.veil.hidden || st.veil.dataset.c !== c
    st.veil.hidden = !on
    st.veil.dataset.c = c
    st.veil.style.background = c === 'white' ? '#fff' : '#000'
  }
  let down = null
  function onDown(e) { if (e.target.closest('.ss-pbar')) return; down = { x: e.clientX, y: e.clientY, t: Date.now() } }
  function onUp(e) {
    if (!down || !st) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    const d = down; down = null
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) return go(st.i + (dx < 0 ? 1 : -1))
    if (Math.hypot(dx, dy) < 12 && Date.now() - d.t < 600) go(e.clientX < innerWidth * 0.28 ? st.i - 1 : st.i + 1)
  }
  function wake() {
    if (!st) return
    st.el.classList.add('awake')
    clearTimeout(st.hideT)
    st.hideT = setTimeout(() => st?.el.classList.remove('awake'), 2200)
  }
  function onResize() {
    if (!st) return
    const k = fit()
    for (const s of st.stageEl.querySelectorAll('.ss-slide')) Object.assign(s.style, { left: `${(innerWidth - st.deck.w * k) / 2}px`, top: `${(innerHeight - st.deck.h * k) / 2}px`, transform: `scale(${k})` })
  }
  function onFs() { if (st && !document.fullscreenElement && st.wentFull) stop(); else if (st && document.fullscreenElement === st.el) st.wentFull = true }

  function stop() {
    if (!st) return
    const s = st
    st = null
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('fullscreenchange', onFs)
    clearTimeout(s.hideT)
    clearInterval(s.timer)
    if (s.pw && !s.pw.closed) s.pw.close()
    if (document.fullscreenElement === s.el) document.exitFullscreen?.().catch(() => {})
    s.el.remove()
    app.presenting = false
    store.goto(s.i)
    app.stage.drawOverlay()
    app.root.focus({ preventScroll: true })
  }

  // ---------- Presenter window ----------
  function openPresenterView() {
    if (!st) return
    if (st.pw && !st.pw.closed) { st.pw.focus(); return }
    const pw = window.open('', 'slides-studio-presenter', 'popup=yes,width=1180,height=720')
    if (!pw) { toast('Pop-ups are blocked. Allow pop-ups for this site to use presenter view.', 'error'); return }
    st.pw = pw
    const doc = pw.document
    doc.open()
    doc.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Presenter view</title></head><body></body></html>')
    doc.close()
    const style = doc.createElement('style')
    style.textContent = SLIDE_CSS + PRESENTER_CSS
    doc.head.append(style)
    const dark = document.documentElement.dataset.theme === 'dark'
    doc.documentElement.dataset.theme = dark ? 'dark' : 'light'

    const cur = h('div', { class: 'pv-cur' }), nxt = h('div', { class: 'pv-next' }), notes = h('div', { class: 'pv-notes', tabindex: 0 })
    const nextLabel = h('div', { class: 'pv-label' }, 'Next')
    const info = h('div', { class: 'pv-info' })
    const clock = h('div', { class: 'pv-clock' }), elapsed = h('div', { class: 'pv-elapsed' }, '00:00')
    let secs = 0, running = true
    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    let fontSize = 22
    const bigger = (d) => { fontSize = Math.max(12, Math.min(60, fontSize + d)); notes.style.fontSize = `${fontSize}px` }
    notes.style.fontSize = `${fontSize}px`
    const btn = (label, ic, fn) => h('button', { type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(ic), h('span', label))
    const pause = btn('Pause', 'pause', () => { running = !running; pause.replaceChildren(icon(running ? 'pause' : 'play'), h('span', running ? 'Pause' : 'Resume')) })
    const ui = h('div', { class: 'pv' },
      h('div', { class: 'pv-main' }, h('div', { class: 'pv-label' }, info), cur),
      h('aside', { class: 'pv-side' },
        h('div', { class: 'pv-timer' }, h('div', h('small', 'Elapsed'), elapsed), h('div', h('small', 'Time'), clock), pause, btn('Reset', 'rotate-ccw', () => { secs = 0; elapsed.textContent = '00:00' })),
        nextLabel, nxt,
        h('div', { class: 'pv-label' }, 'Speaker notes', h('span', { class: 'pv-fs' }, btn('Smaller text', 'zoom-out', () => bigger(-2)), btn('Larger text', 'zoom-in', () => bigger(2)))), notes,
        h('div', { class: 'pv-nav' }, btn('Previous', 'chevron-left', () => go(st.i - 1)), btn('Next', 'chevron-right', () => go(st.i + 1)), btn('Blank', 'square', () => toggleVeil('black')), btn('End', 'x', () => stop()))))
    doc.body.append(doc.adoptNode(ui))

    const scaleInto = (box, slide, deck) => {
      const k = Math.min(box.clientWidth / deck.w, box.clientHeight / deck.h) || 0.3
      Object.assign(slide.style, { transform: `scale(${k})`, transformOrigin: '0 0', position: 'absolute', left: `${(box.clientWidth - deck.w * k) / 2}px`, top: `${(box.clientHeight - deck.h * k) / 2}px` })
    }
    st.pwUpdate = () => {
      if (!st || pw.closed) return
      const d = st.deck, i = st.i
      info.textContent = `Slide ${i + 1} of ${d.slides.length}`
      cur.replaceChildren()
      nxt.replaceChildren()
      const a = slideNode(i)
      cur.append(doc.adoptNode(a)); scaleInto(cur, a, d)
      if (i + 1 < d.slides.length) { const b = slideNode(i + 1); nxt.append(doc.adoptNode(b)); scaleInto(nxt, b, d); nextLabel.textContent = 'Next' } else { nextLabel.textContent = 'Next: end of show' }
      notes.textContent = d.slides[i].notes || 'No notes for this slide.'
      notes.classList.toggle('empty', !d.slides[i].notes)
    }
    st.timer = setInterval(() => {
      if (pw.closed) { clearInterval(st?.timer); if (st) st.pw = null; return }
      if (running) { secs++; elapsed.textContent = fmt(secs) }
      clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }, 1000)
    clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    pw.addEventListener('keydown', (e) => {
      const k = e.key
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) go(st.i + 1)
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) go(st.i - 1)
      else if (k === 'Escape') stop()
      else return
      e.preventDefault()
    })
    pw.addEventListener('resize', () => st?.pwUpdate?.())
    pw.addEventListener('pagehide', () => { if (st) { clearInterval(st.timer); st.pw = null } })
    st.pwUpdate()
  }

  return { start, stop, go, openPresenterView, get active() { return !!st }, get index() { return st?.i }, get presenterOpen() { return !!(st?.pw && !st.pw.closed) } }
}
