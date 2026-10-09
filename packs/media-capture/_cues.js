// Shared subtitle UI: an editable list of cues (text and timings, split, merge, delete) and a media player that shows the
// cues as a real text track, so they also appear in fullscreen. Used by the subtitle generator, the transcript tool and the editor.
import { h, icon, button, debounce, formatDuration } from '../../lib/ui.js'
import { parseTime, formatTime, cps, stripTags } from './_subs.js'

const PAGE = 160
const fmt = (t) => formatTime(t, 'vtt')

/** Find the cue showing at time t (linear scan starting near the last hit, since playback moves forward). */
export function findCue(cues, t, hint = 0) {
  for (let k = 0; k < cues.length; k++) {
    const i = (hint + k) % cues.length
    const c = cues[i]
    if (t >= c.start && t < c.end) return { cue: c, index: i }
  }
  return null
}

/**
 * cueEditor({ cues, onChange(cues), seek(t), getTime() }) -> { el, cues(), set(cues), setTime(t), add() }
 * seek adds a play button on each row; getTime adds "set start/end to the playhead" buttons.
 */
export function cueEditor({ cues = [], onChange, seek, getTime, emptyText = 'No subtitles yet.' } = {}) {
  let list = cues.map((c) => ({ ...c }))
  let shown = PAGE
  let activeIdx = -1
  const wrap = h('div', { class: 'mc-cues', role: 'list', 'aria-label': 'Subtitle lines' })
  const info = h('div', { class: 'small muted', role: 'status' })
  const moreBtn = button('Show more lines', { icon: 'chevrons-down', variant: 'secondary', size: 'sm', onClick: () => { shown += PAGE; render() } })
  const el = h('div', { class: 'stack tight' }, wrap, h('div', { class: 'row' }, moreBtn, info))
  const rows = new Map()
  const changed = debounce(() => onChange?.(api.cues()), 150)
  const touch = () => { changed(); summarize() }

  function summarize() {
    const bad = list.filter((c, i) => c.end < c.start || (list[i + 1] && c.end > list[i + 1].start + 0.001)).length
    info.textContent = `${list.length} line${list.length === 1 ? '' : 's'}${list.length ? `, ${formatDuration(list.at(-1).end)} long` : ''}${bad ? `, ${bad} with overlapping or reversed times` : ''}`
  }

  function flagsFor(c, i) {
    const out = []
    const rate = cps(c)
    if (c.end < c.start) out.push(['err', 'Ends before it starts'])
    else if (list[i + 1] && c.end > list[i + 1].start + 0.001) out.push(['', 'Overlaps the next line'])
    if (c.end >= c.start && rate > 21 && Number.isFinite(rate)) out.push(['', `Fast to read (${Math.round(rate)} characters a second)`])
    if (!c.text.trim()) out.push(['', 'Empty line'])
    return out
  }

  function makeRow(c) {
    const idx = () => list.indexOf(c)
    const n = h('div', { class: 'mc-cue-n' })
    const dur = h('div', { class: 'dur' })
    const flags = h('div', { class: 'mc-cue-flags' })
    const timeInput = (key, label) => {
      const inp = h('input', { class: 'input mono', value: fmt(c[key]), inputmode: 'decimal', spellcheck: false, 'aria-label': label })
      inp.addEventListener('input', () => inp.classList.toggle('invalid', !Number.isFinite(parseTime(inp.value))))
      inp.addEventListener('change', () => {
        const t = parseTime(inp.value)
        if (Number.isFinite(t) && t >= 0) c[key] = t
        inp.value = fmt(c[key])
        inp.classList.remove('invalid')
        refresh()
        touch()
      })
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        c[key] = Math.max(0, Math.round((c[key] + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1)) * 1000) / 1000)
        inp.value = fmt(c[key])
        refresh()
        touch()
      })
      return inp
    }
    const start = timeInput('start', 'Start time'), end = timeInput('end', 'End time')
    const ta = h('textarea', { class: 'textarea', rows: 2, value: c.text, 'aria-label': 'Subtitle text', spellcheck: true })
    ta.addEventListener('input', () => { c.text = ta.value; refresh(); touch() })
    const act = h('div', { class: 'mc-cue-act' },
      seek && button('', { icon: 'play', variant: 'ghost', size: 'sm', ariaLabel: 'Play from this line', onClick: () => seek(c.start) }),
      button('', { icon: 'scissors', variant: 'ghost', size: 'sm', ariaLabel: 'Split this line at the cursor', onClick: () => split(c, ta.selectionStart) }),
      button('', { icon: 'merge', variant: 'ghost', size: 'sm', ariaLabel: 'Join with the next line', onClick: () => merge(c) }),
      button('', { icon: 'trash-2', variant: 'ghost', size: 'sm', ariaLabel: 'Delete this line', onClick: () => remove(c) }))
    const nowBtns = getTime ? h('div', { class: 'row', style: 'gap:4px' },
      button('', { icon: 'arrow-left-to-line', variant: 'ghost', size: 'sm', ariaLabel: 'Set the start to the current playback time', title: 'Start here', onClick: () => { c.start = Math.round(getTime() * 1000) / 1000; start.value = fmt(c.start); refresh(); touch() } }),
      button('', { icon: 'arrow-right-to-line', variant: 'ghost', size: 'sm', ariaLabel: 'Set the end to the current playback time', title: 'End here', onClick: () => { c.end = Math.round(getTime() * 1000) / 1000; end.value = fmt(c.end); refresh(); touch() } })) : null
    const row = h('div', { class: 'mc-cue', role: 'listitem' }, n, h('div', { class: 'mc-cue-times' }, start, end, dur, nowBtns), ta, act, flags)
    function refresh() {
      const i = idx()
      n.textContent = String(i + 1)
      dur.textContent = c.end >= c.start ? `${(c.end - c.start).toFixed(1)} s` : 'check times'
      flags.replaceChildren(...flagsFor(c, i).map(([k, t]) => h('span', { class: ['mc-flag', k], role: 'note' }, t)))
    }
    row.refresh = refresh
    row.start = start; row.end = end; row.ta = ta
    refresh()
    return row
  }

  function render(focus) {
    rows.clear()
    const frag = list.slice(0, shown).map((c) => { const r = makeRow(c); rows.set(c, r); return r })
    wrap.replaceChildren(...(frag.length ? frag : [h('div', { class: 'empty' }, icon('captions'), emptyText)]))
    moreBtn.hidden = list.length <= shown
    summarize()
    if (focus && rows.has(focus)) rows.get(focus).ta.focus()
    activeIdx = -1
  }
  const refreshAll = () => { for (const r of rows.values()) r.refresh() }

  function split(c, caret) {
    const i = list.indexOf(c)
    const text = c.text
    let at = caret
    if (!(at > 0 && at < text.length)) { // cursor at an edge: break near the middle, between words
      const mid = Math.floor(text.length / 2)
      const sp = [...text.matchAll(/\s/g)].map((m) => m.index).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0]
      if (sp == null) return
      at = sp
    }
    const left = text.slice(0, at).trim(), right = text.slice(at).trim()
    if (!left || !right) return
    const ratio = Math.min(0.9, Math.max(0.1, left.length / (left.length + right.length)))
    const cut = Math.round((c.start + (c.end - c.start) * ratio) * 1000) / 1000
    const next = { start: cut, end: c.end, text: right }
    c.text = left
    c.end = cut
    list.splice(i + 1, 0, next)
    shown = Math.max(shown, i + 3)
    render(next)
    touch()
  }
  function merge(c) {
    const i = list.indexOf(c)
    const nx = list[i + 1]
    if (!nx) return
    c.text = `${c.text.trim()} ${nx.text.trim()}`.replace(/\s*\n\s*/g, ' ').trim()
    c.end = Math.max(c.end, nx.end)
    list.splice(i + 1, 1)
    render(c)
    touch()
  }
  function remove(c) {
    const i = list.indexOf(c)
    list.splice(i, 1)
    render()
    const r = rows.get(list[Math.min(i, list.length - 1)])
    r?.ta.focus()
    touch()
  }

  const api = {
    el,
    cues: () => list.map((c) => ({ start: c.start, end: c.end, text: c.text })),
    set(next) { list = next.map((c) => ({ ...c })); shown = PAGE; render(); onChange?.(api.cues()) },
    get length() { return list.length },
    add(at) {
      const last = list.at(-1)
      const start = at ?? (last ? last.end : 0)
      const c = { start, end: start + 2, text: '' }
      list.push(c)
      list.sort((a, b) => a.start - b.start)
      shown = Math.max(shown, list.length)
      render(c)
      wrap.scrollTop = rows.get(c).offsetTop - 40
      touch()
    },
    /** Highlight the cue showing at time t and keep it in view. */
    setTime(t, follow = true) {
      const hit = findCue(list, t, Math.max(0, activeIdx))
      const idx = hit ? hit.index : -1
      if (idx === activeIdx) return
      activeIdx = idx
      if (idx >= shown) { shown = idx + PAGE; const keep = activeIdx; render(); activeIdx = keep }
      for (const r of rows.values()) r.classList.remove('active')
      if (idx < 0) return
      const row = rows.get(list[idx])
      if (!row) return
      row.classList.add('active')
      if (follow && !wrap.contains(document.activeElement)) {
        const rr = row.getBoundingClientRect(), cr = wrap.getBoundingClientRect()
        if (rr.top < cr.top || rr.bottom > cr.bottom) wrap.scrollTop += rr.top - cr.top - cr.height / 3
      }
    },
    refreshFlags: refreshAll,
  }
  render()
  return api
}

/** VTT-safe text for a text track cue. */
const trackText = (t) => stripTags(t, { keepBasic: true })

/**
 * mediaPlayer({ url, video, getCues }) -> { el, media, update(), onTime(fn), seek(t), play(t), dispose() }
 * Video shows the cues natively through a text track; audio shows the current line under the player.
 */
export function mediaPlayer({ url, video: isVideo, cues = [] }) {
  const media = h(isVideo ? 'video' : 'audio', { controls: true, preload: 'metadata', src: url, playsInline: true, 'aria-label': isVideo ? 'Video preview' : 'Audio preview' })
  const now = isVideo ? null : h('div', { class: 'mc-now', 'aria-live': 'off' })
  const el = h('div', { class: ['mc-player', !isVideo && 'audio'] }, media, now)
  let list = cues
  let track = null
  const listeners = new Set()
  let raf = 0
  let hint = 0
  if (isVideo && media.addTextTrack) {
    track = media.addTextTrack('subtitles', 'Subtitles', 'und')
    track.mode = 'showing'
  }
  const emit = () => {
    const t = media.currentTime
    const hit = findCue(list, t, hint)
    if (hit) hint = hit.index
    if (now) now.textContent = hit ? stripTags(hit.cue.text) : ''
    for (const f of listeners) f(t, hit?.cue)
  }
  const loop = () => { emit(); raf = requestAnimationFrame(loop) }
  media.addEventListener('timeupdate', emit)
  media.addEventListener('seeked', emit)
  media.addEventListener('play', () => { cancelAnimationFrame(raf); loop() })
  for (const ev of ['pause', 'ended']) media.addEventListener(ev, () => { cancelAnimationFrame(raf); emit() })
  const api = {
    el, media,
    /** Replace the cues shown (call after edits). */
    update(next) {
      list = next
      if (track) {
        for (const c of [...(track.cues || [])]) track.removeCue(c)
        for (const c of list) { try { if (c.end > c.start && c.text.trim()) track.addCue(new VTTCue(c.start, c.end, trackText(c.text))) } catch { /* bad cue */ } }
      }
      emit()
    },
    onTime: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
    seek(t) { media.currentTime = Math.max(0, t) },
    play(t) { media.currentTime = Math.max(0, t); media.play().catch(() => {}) },
    dispose() { cancelAnimationFrame(raf); media.pause(); media.removeAttribute('src'); media.load(); listeners.clear() },
  }
  api.update(list)
  return api
}
