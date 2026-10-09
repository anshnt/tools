// Teleprompter: scrolls your script at a true words-per-minute pace, with mirror, reading line, countdown and full screen.
import { h, icon, button, toast, toggle, segmented, rangeField, select, clear, formatDuration, textarea } from '../../lib/ui.js'
import { persisted } from '../../lib/store.js'
import { baseCss, injectCss, listen, clamp, isTyping } from './_shared.js'

/** Remove director notes (lines that start with //) and trailing spaces. */
export const cleanScript = (t) => String(t).replace(/\r\n?/g, '\n').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/[ \t]+$/gm, '').trim()
export const countWords = (t) => (t.trim().match(/\S+/g) || []).length
/** Seconds to read `words` at `wpm`. */
export const readSeconds = (words, wpm) => (wpm > 0 ? (words / wpm) * 60 : 0)

const THEMES = { dark: ['#000000', '#ffffff', 'Light on dark'], light: ['#ffffff', '#111111', 'Dark on light'], amber: ['#0a0700', '#ffd24a', 'Amber'], green: ['#001208', '#7dff9b', 'Green'] }
const SAMPLE = `Hello and welcome. Today I want to show you how a teleprompter keeps you looking at the camera while you speak naturally.

// Director note: smile here. Lines that start with two slashes are hidden from the prompter.

Paste your own script into the box, choose how fast you read in words per minute, and press Start. The text scrolls at exactly that pace, so a one minute script takes about one minute.

Use the arrow keys to change the speed while you read, press the space bar to pause, and open full screen when you are ready to record. If you are using a mirror or a piece of glass in front of the lens, switch on mirror mode.

Thank you for watching, and good luck with your talk.`

const CSS = `
.t-tp .layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);grid-template-areas:"script stage" "settings stage";gap:16px;align-items:start}
.t-tp .a-script{grid-area:script}.t-tp .a-settings{grid-area:settings}.t-tp .a-stage{grid-area:stage;position:sticky;top:calc(var(--header-h) + 12px)}
.t-tp .script{min-height:230px;font-size:15px;line-height:1.6}
.t-tp .meta{display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;font:12.5px var(--mono);color:var(--muted)}
.t-tp .stage{touch-action:none;position:relative;overflow:hidden;border-radius:var(--radius-xl);height:clamp(320px,62vh,620px);background:var(--bg);color:var(--fg);box-shadow:var(--shadow-lg);border:1px solid var(--border-strong);outline:none;isolation:isolate}
.t-tp .stage:focus-visible{box-shadow:0 0 0 4px var(--ring),var(--shadow-lg)}
.t-tp .view{position:absolute;inset:0;overflow:hidden}
.t-tp .view.fade{-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 14%,#000 86%,transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,#000 14%,#000 86%,transparent 100%)}
.t-tp .roll{position:absolute;left:0;right:0;top:0;will-change:transform}
.t-tp .text{margin:0 auto;white-space:pre-wrap;overflow-wrap:break-word;font-family:var(--font);font-weight:600;letter-spacing:-.01em;text-align:var(--align,left)}
.t-tp .text:empty::before{content:"Your script appears here";opacity:.35}
.t-tp .line{position:absolute;left:0;right:0;height:0;z-index:2;pointer-events:none;border-top:2px solid var(--accent-line,#ff3b5c);opacity:.9}
.t-tp .line::before,.t-tp .line::after{content:"";position:absolute;top:-9px;border:8px solid transparent}
.t-tp .line::before{left:0;border-left-color:var(--accent-line,#ff3b5c)}
.t-tp .line::after{right:0;border-right-color:var(--accent-line,#ff3b5c)}
.t-tp .count{position:absolute;inset:0;z-index:4;display:grid;place-items:center;font:700 clamp(96px,28vw,260px)/1 var(--font);color:var(--fg);background:color-mix(in srgb,var(--bg) 72%,transparent);animation:sc-fade .25s var(--ease)}
.t-tp .count span{animation:sc-pop .5s var(--spring)}
.t-tp .ctl{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:max-content;z-index:5;display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:center;padding:6px;border-radius:20px;max-width:calc(100% - 20px);background:rgba(16,16,24,.78);color:#fff;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 14px 34px -10px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.12);transition:opacity .35s,transform .35s}
.t-tp .ctl .btn{color:#fff;background:transparent;border-color:transparent;box-shadow:none}
.t-tp .ctl .btn:hover:not(:disabled){background:rgba(255,255,255,.16)}
.t-tp .ctl .btn-primary{background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff}
.t-tp .ctl .wpm{font:600 13px var(--mono);padding:0 8px;min-width:78px;text-align:center}
.t-tp .bar{position:absolute;left:0;top:0;height:4px;width:100%;z-index:5;background:rgba(127,127,127,.25)}
.t-tp .bar i{display:block;height:100%;width:0;background:var(--brand)}
.t-tp .time{position:absolute;top:12px;right:14px;z-index:5;font:600 12.5px var(--mono);padding:4px 10px;border-radius:999px;background:rgba(16,16,24,.6);color:#fff}
.t-tp .stage.full{position:fixed;inset:0;z-index:2147483000;height:auto;border-radius:0;border:0}
.t-tp .stage.full.idle{cursor:none}
.t-tp .stage.full.idle .ctl,.t-tp .stage.full.idle .time{opacity:0;pointer-events:none;transform:translateX(-50%) translateY(14px)}
.t-tp .stage.full.idle .time{transform:none}
.t-tp .opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:14px 20px}
.t-tp .swatches{display:flex;gap:8px;flex-wrap:wrap}
.t-tp .sw{width:44px;height:34px;border-radius:10px;border:2px solid var(--surface);box-shadow:0 0 0 1px var(--border-strong);cursor:pointer;font:700 15px var(--font);background:var(--bg);color:var(--fg);padding:0;transition:transform .2s var(--spring)}
.t-tp .sw:hover{transform:translateY(-2px)}
.t-tp .sw[aria-pressed="true"]{box-shadow:0 0 0 2px var(--accent)}
.t-tp .keys{display:flex;gap:6px 12px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.t-tp kbd{font:600 11.5px var(--mono);padding:1px 6px;border-radius:6px;border:1px solid var(--border-strong);border-bottom-width:2px;background:var(--surface)}
@media (max-width:900px){.t-tp .layout{grid-template-columns:minmax(0,1fr);grid-template-areas:"script" "stage" "settings"}.t-tp .a-stage{position:static}.t-tp .stage{height:clamp(300px,58vh,520px)}}
@media (prefers-reduced-motion:reduce){.t-tp .count span,.t-tp .count{animation:none}}
`

export function mount(root) {
  baseCss()
  injectCss('tp', CSS)
  const store = persisted('teleprompter', { text: SAMPLE, wpm: 140, size: 56, lh: 1.5, width: 84, count: 3, theme: 'dark', marker: 38, mirror: false, line: true, fade: true, align: 'left' })
  const s = () => store.get()
  const set = (patch) => { store.update((x) => ({ ...x, ...patch })); relayout() }
  let pos = 0, maxPos = 0, pxPerWord = 0, words = 0, playing = false, raf = 0, last = 0, countTimer = 0, idleTimer = 0, tShown = 0, full = false

  // ----- stage -----
  const text = h('div', { class: 'text' })
  const padTop = h('div'), padBot = h('div')
  const roll = h('div', { class: 'roll' }, padTop, text, padBot)
  const view = h('div', { class: 'view' }, roll)
  const line = h('div', { class: 'line' })
  const barFill = h('i')
  const bar = h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Script progress', 'aria-valuemin': 0, 'aria-valuemax': 100 }, barFill)
  const timeEl = h('div', { class: 'time' })
  const playBtn = button('', { icon: 'play', variant: 'primary', ariaLabel: 'Play or pause (Space)', title: 'Play / pause (Space)', onClick: () => toggle$() })
  const wpmEl = h('span', { class: 'wpm' })
  const ctl = h('div', { class: 'ctl', role: 'toolbar', 'aria-label': 'Teleprompter controls' },
    playBtn,
    button('', { icon: 'rotate-ccw', ariaLabel: 'Back to the start (Home)', title: 'Back to the start (Home)', onClick: () => restart() }),
    button('', { icon: 'minus', ariaLabel: 'Slower (Arrow down)', title: 'Slower (Arrow down)', onClick: () => speed(-5) }), wpmEl,
    button('', { icon: 'plus', ariaLabel: 'Faster (Arrow up)', title: 'Faster (Arrow up)', onClick: () => speed(5) }),
    button('', { icon: 'a-arrow-down', ariaLabel: 'Smaller text (Arrow left)', title: 'Smaller text (Arrow left)', onClick: () => font(-4) }),
    button('', { icon: 'a-arrow-up', ariaLabel: 'Larger text (Arrow right)', title: 'Larger text (Arrow right)', onClick: () => font(4) }),
    button('', { icon: 'flip-horizontal-2', ariaLabel: 'Mirror (M)', title: 'Mirror for glass (M)', onClick: () => set({ mirror: !s().mirror }) }),
    button('', { icon: 'maximize', ariaLabel: 'Full screen (F)', title: 'Full screen (F)', onClick: () => setFull(!full) }))
  const stage = h('div', { class: 'stage', tabindex: 0, role: 'region', 'aria-label': 'Teleprompter. Space plays and pauses, arrow keys change speed and text size.' }, view, line, bar, timeEl, ctl)
  let countEl = null
  // while full screen the stage lives directly under <body>, so no transformed ancestor can shrink a position:fixed box
  const host = h('div', { class: 't-tp' }, stage)
  const slot = document.createComment('teleprompter')

  function applyTheme() {
    const [bg, fg] = THEMES[s().theme] || THEMES.dark
    stage.style.setProperty('--bg', bg); stage.style.setProperty('--fg', fg)
    stage.style.setProperty('--align', s().align)
    for (const b of themeBtns) b.setAttribute('aria-pressed', String(b.dataset.t === s().theme))
  }
  function relayout() {
    const st = s()
    applyTheme()
    text.textContent = cleanScript(st.text)
    words = countWords(text.textContent)
    const H = stage.clientHeight || 400
    const markerY = Math.round((H * st.marker) / 100)
    text.style.width = `${st.width}%`
    text.style.fontSize = `${st.size}px`
    text.style.lineHeight = String(st.lh)
    padTop.style.height = `${markerY}px`
    padBot.style.height = `${Math.max(0, H - markerY)}px`
    view.style.transform = st.mirror ? 'scaleX(-1)' : ''
    view.classList.toggle('fade', st.fade)
    line.hidden = !st.line
    line.style.top = `${markerY}px`
    const th = text.offsetHeight
    pxPerWord = words ? th / words : 0
    maxPos = th
    pos = clamp(pos, 0, maxPos)
    wpmEl.textContent = `${st.wpm} WPM`
    playBtn.disabled = !words
    meta.textContent = words ? `${words} words · about ${formatDuration(readSeconds(words, st.wpm))} at ${st.wpm} WPM` : 'Add a script to begin'
    render(true)
  }
  const pxPerSec = () => (s().wpm / 60) * pxPerWord
  function render(force) {
    roll.style.transform = `translate3d(0, ${-pos}px, 0)`
    const frac = maxPos ? pos / maxPos : 0
    barFill.style.width = `${frac * 100}%`
    bar.setAttribute('aria-valuenow', String(Math.round(frac * 100)))
    const now = performance.now()
    if (force || now - tShown > 250) {
      tShown = now
      const left = pxPerSec() ? (maxPos - pos) / pxPerSec() : 0
      timeEl.textContent = `${formatDuration((pxPerSec() ? pos / pxPerSec() : 0))} / ${formatDuration(readSeconds(words, s().wpm))}  ·  ${formatDuration(left)} left`
    }
  }
  function frame(now) {
    if (!playing) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    pos += pxPerSec() * dt
    if (pos >= maxPos) { pos = maxPos; pause(); render(true); toast('End of script', 'success', 1600); return }
    render()
    raf = requestAnimationFrame(frame)
  }
  function play() {
    if (!words || playing || countEl) return
    const begin = () => { playing = true; last = performance.now(); setPlayIcon(); raf = requestAnimationFrame(frame); wake() }
    if (pos <= 1 && s().count > 0) {
      let n = s().count
      countEl = h('div', { class: 'count', 'aria-live': 'assertive' }, h('span', String(n)))
      stage.append(countEl)
      setPlayIcon()
      countTimer = setInterval(() => {
        n--
        if (n <= 0) { clearInterval(countTimer); countEl?.remove(); countEl = null; begin() } else countEl.firstChild.textContent = String(n)
      }, 1000)
    } else begin()
  }
  function pause() {
    playing = false
    cancelAnimationFrame(raf)
    clearInterval(countTimer); countEl?.remove(); countEl = null
    setPlayIcon()
  }
  const toggle$ = () => (playing || countEl ? pause() : play())
  function restart() { pause(); pos = 0; render(true) }
  function setPlayIcon() {
    const on = playing || !!countEl
    playBtn.replaceChildren(icon(on ? 'pause' : 'play'))
  }
  function speed(d) { set({ wpm: clamp(s().wpm + d, 40, 400) }); wpmRange.set(s().wpm) }
  function font(d) { set({ size: clamp(s().size + d, 20, 200) }); sizeRange.set(s().size) }

  // ----- full screen -----
  function wake() {
    stage.classList.remove('idle')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => { if (full && playing) stage.classList.add('idle') }, 2600)
  }
  function setFull(on) {
    full = on
    stage.classList.toggle('full', on)
    document.documentElement.style.overflow = on ? 'hidden' : ''
    if (on && !slot.parentNode) { host.replaceWith(slot); document.body.append(host) } else if (!on && slot.parentNode) { slot.replaceWith(host) }
    if (on) { stage.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {}); stage.focus({ preventScroll: true }); wake() } else {
      if (document.fullscreenElement === stage) document.exitFullscreen?.().catch(() => {})
      stage.classList.remove('idle')
    }
    ctl.querySelector('[aria-label^="Full screen"]')?.replaceChildren(icon(on ? 'minimize' : 'maximize'))
    requestAnimationFrame(relayout)
  }
  listen(document, 'fullscreenchange', () => { if (full && !document.fullscreenElement) setFull(false) })
  stage.addEventListener('pointermove', wake)
  stage.addEventListener('wheel', (e) => { e.preventDefault(); pos = clamp(pos + e.deltaY, 0, maxPos); render(true); wake() }, { passive: false })
  let drag = null
  stage.addEventListener('pointerdown', (e) => { if (e.target.closest('.ctl')) return; drag = { y: e.clientY, pos }; stage.setPointerCapture(e.pointerId); stage.focus({ preventScroll: true }); wake() })
  stage.addEventListener('pointermove', (e) => { if (drag) { pos = clamp(drag.pos - (e.clientY - drag.y), 0, maxPos); render(true) } })
  const endDrag = () => { drag = null }
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag)
  stage.addEventListener('dblclick', (e) => { if (!e.target.closest('.ctl')) setFull(!full) })

  // keys work while the prompter has focus (or is full screen), so typing in the script box is never hijacked
  listen(document, 'keydown', (e) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return
    if (!full && !stage.contains(document.activeElement)) return
    if (e.target.closest?.('button') && (e.key === ' ' || e.key === 'Enter')) return
    const k = e.key
    const acts = {
      ' ': toggle$, ArrowUp: () => speed(5), ArrowDown: () => speed(-5), ArrowRight: () => font(4), ArrowLeft: () => font(-4), '+': () => speed(5), '=': () => speed(5), '-': () => speed(-5),
      Home: restart, PageDown: () => { pos = clamp(pos + stage.clientHeight * 0.8, 0, maxPos); render(true) }, PageUp: () => { pos = clamp(pos - stage.clientHeight * 0.8, 0, maxPos); render(true) },
      m: () => set({ mirror: !s().mirror }), M: () => set({ mirror: !s().mirror }), f: () => setFull(!full), F: () => setFull(!full), Escape: () => { if (full) setFull(false) },
    }
    const fn = acts[k]
    if (!fn) return
    e.preventDefault(); e.stopPropagation()
    fn(); wake()
  }, true)

  // ----- settings -----
  const ta = textarea({ class: 'script', placeholder: 'Paste your script here. Lines that start with // are private notes and are not shown.', 'aria-label': 'Script', value: s().text, oninput: (e) => { store.update((x) => ({ ...x, text: e.target.value })); relayout() } })
  const meta = h('div', { class: 'meta' })
  const wpmRange = rangeField('Speed', { min: 40, max: 300, step: 5, value: s().wpm, format: (v) => `${v} WPM`, hint: 'Words per minute: 130 is a calm talk, 160 is conversational.', onInput: (v) => set({ wpm: v }) })
  const sizeRange = rangeField('Text size', { min: 20, max: 160, step: 2, value: s().size, format: (v) => `${v}px`, onInput: (v) => set({ size: v }) })
  const lhRange = rangeField('Line spacing', { min: 1.1, max: 2.4, step: 0.05, value: s().lh, format: (v) => v.toFixed(2), onInput: (v) => set({ lh: v }) })
  const widthRange = rangeField('Text width', { min: 40, max: 100, step: 2, value: s().width, format: (v) => `${v}%`, onInput: (v) => set({ width: v }) })
  const markRange = rangeField('Reading line height', { min: 15, max: 70, step: 1, value: s().marker, format: (v) => `${v}% from top`, onInput: (v) => set({ marker: v }) })
  const countSel = select([['0', 'No countdown'], ['3', '3 seconds'], ['5', '5 seconds'], ['10', '10 seconds']], String(s().count), (v) => set({ count: Number(v) }))
  const themeBtns = Object.entries(THEMES).map(([id, [, , label]]) => h('button', { type: 'button', class: 'sw', 'data-t': id, title: label, 'aria-label': label, 'aria-pressed': 'false', onclick: () => set({ theme: id }) }, 'Aa'))
  themeBtns.forEach((b) => { const [bg, fg] = THEMES[b.dataset.t]; b.style.setProperty('--bg', bg); b.style.setProperty('--fg', fg) })
  const alignSeg = segmented([['left', 'Left'], ['center', 'Center']], s().align, (v) => set({ align: v }), 'Text alignment')

  const scriptPanel = h('section', { class: 'panel stack a-script' }, h('h2', 'Your script'), ta, meta,
    h('div', { class: 'row' },
      button('Use a sample', { icon: 'file-text', size: 'sm', onClick: () => { ta.value = SAMPLE; ta.dispatchEvent(new Event('input')) } }),
      button('Clear', { icon: 'eraser', size: 'sm', variant: 'ghost', onClick: () => { ta.value = ''; ta.dispatchEvent(new Event('input')); pause(); pos = 0 } }),
      button('Start in full screen', { icon: 'maximize', variant: 'primary', onClick: () => { setFull(true); restart(); play() } })))
  const settingsPanel = h('section', { class: 'panel stack a-settings' }, h('h2', 'Settings'),
    h('div', { class: 'opts' }, wpmRange, sizeRange, lhRange, widthRange, markRange,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Countdown'), countSel),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colors'), h('div', { class: 'swatches' }, themeBtns)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Alignment'), alignSeg)),
    h('div', { class: 'row', style: 'gap:18px' },
      toggle('Mirror for glass', s().mirror, (v) => set({ mirror: v })),
      toggle('Reading line', s().line, (v) => set({ line: v })),
      toggle('Fade edges', s().fade, (v) => set({ fade: v }))),
    h('div', { class: 'keys' }, h('span', h('kbd', 'Space'), ' play or pause'), h('span', h('kbd', '↑'), h('kbd', '↓'), ' speed'), h('span', h('kbd', '←'), h('kbd', '→'), ' text size'),
      h('span', h('kbd', 'Home'), ' restart'), h('span', h('kbd', 'M'), ' mirror'), h('span', h('kbd', 'F'), ' full screen'), h('span', 'Scroll or drag to move')))
  root.append(h('div', { class: 't-tp stack' }, h('div', { class: 'layout' }, scriptPanel, h('div', { class: 'a-stage stack' }, host, h('p', { class: 'small muted' }, 'Click the prompter first, then use the keyboard. Double-click for full screen.')), settingsPanel)))
  setPlayIcon()
  relayout()
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => relayout()).observe(stage)
  document.fonts?.ready?.then(relayout)

  return () => {
    pause()
    document.documentElement.style.overflow = ''
    clearTimeout(idleTimer)
    if (slot.parentNode) slot.replaceWith(host)
    host.remove()
    if (document.fullscreenElement === stage) document.exitFullscreen?.().catch(() => {})
  }
}
