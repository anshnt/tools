// Word lookup on the free Datamuse API: synonym finder (params.mode 'syn'), rhyme finder ('rhy') and crossword / word-pattern solver ('pat').
import { h, button, clear, toast, empty, debounce, icon, copyText, onCleanup, alert } from '../../lib/ui.js'
import { toolRoot, addStyle, chips, kicker, note } from './_shared.js'

const API = 'https://api.datamuse.com/words'
const POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' }
const MODES = {
  syn: {
    placeholder: 'Type a word, for example happy', label: 'Word', start: 'happy',
    rels: [['rel_syn', 'Synonyms', 'equal'], ['rel_ant', 'Antonyms', 'arrow-left-right'], ['ml', 'Related words', 'network'], ['rel_jjb', 'Describing words', 'palette'], ['rel_spc', 'More general', 'arrow-up'], ['rel_gen', 'More specific', 'arrow-down']],
    hint: 'Click a word to look it up, or the copy button to copy it.',
  },
  rhy: {
    placeholder: 'Type a word to rhyme, for example light', label: 'Rhymes with', start: 'light',
    rels: [['rel_rhy', 'Perfect rhymes', 'music'], ['rel_nry', 'Near rhymes', 'audio-waveform'], ['sl', 'Sounds like', 'ear']],
    hint: 'Grouped by number of syllables. Click a word to rhyme that one instead.',
  },
  pat: {
    placeholder: 'Pattern, for example t??k or *tion', label: 'Pattern', start: 'c?o??',
    rels: [['sp', 'Fits the pattern', 'grid-3x3']],
    hint: 'Use ? for one unknown letter and * for any run of letters (c?o?s, *ing, b*ful). Add a clue to narrow it down.',
  },
}

const CSS = `
.tw-wl .tw-q { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; }
.tw-wl .tw-q .field { flex: 1; min-width: 200px; }
.tw-wl .tw-big { height: 54px; font-size: 18px; padding: 0 18px; border-radius: 16px; }
.tw-wl .tw-words { display: flex; flex-wrap: wrap; gap: 8px; }
.tw-wl .tw-w { display: inline-flex; align-items: stretch; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); overflow: hidden; animation: tw-rise .35s var(--ease) both; animation-delay: calc(var(--i, 0) * 12ms); transition: border-color .2s, box-shadow .2s, transform .25s var(--spring); }
.tw-wl .tw-w:hover { border-color: var(--accent); box-shadow: var(--shadow); transform: translateY(-1px); }
.tw-wl .tw-w .go { padding: 0 6px 0 14px; min-height: 36px; border: 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
.tw-wl .tw-w .go small { font-size: 11px; color: var(--muted); }
.tw-wl .tw-w .cp { width: 34px; border: 0; border-left: 1px solid var(--border); background: transparent; color: var(--muted); cursor: pointer; display: grid; place-items: center; }
.tw-wl .tw-w .cp:hover { color: var(--accent); background: var(--surface-2); }
.tw-wl .tw-w .cp .icon { width: 14px; height: 14px; }
.tw-wl .tw-def { padding: 14px 16px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--border); font-size: 14.5px; line-height: 1.6; }
.tw-wl .tw-def ol { margin: 6px 0 0; padding-left: 20px; } .tw-wl .tw-def b { font-size: 18px; letter-spacing: -.02em; }
.tw-wl .tw-def i { font-style: normal; font-size: 12px; color: var(--accent); font-weight: 600; margin-right: 6px; text-transform: uppercase; letter-spacing: .06em; }
.tw-wl .tw-grp { display: flex; flex-direction: column; gap: 8px; }
`

/** Datamuse query for a mode. Exported for tests. */
export function buildQuery(rel, word, clue = '') {
  const p = new URLSearchParams({ md: 'ps', max: '120' })
  if (rel === 'sp') { p.set('sp', word.trim().toLowerCase()); if (clue.trim()) p.set('ml', clue.trim()) } else p.set(rel, word.trim().toLowerCase())
  return `${API}?${p}`
}

export function mount(root, { params, signal }) {
  addStyle('tw-wl-css', CSS)
  const mode = MODES[params?.mode] || MODES.syn
  const st = { rel: mode.rels[0][0], pos: 'all', syl: 'all', word: '', clue: '', data: [], abort: null }
  const input = h('input', { class: 'input tw-big', type: 'search', placeholder: mode.placeholder, 'aria-label': mode.label, autocomplete: 'off', autocapitalize: 'off', spellcheck: false, oninput: () => later() })
  const clueInp = h('input', { class: 'input tw-big', type: 'search', placeholder: 'Optional clue, for example "ringing sound"', 'aria-label': 'Clue', autocomplete: 'off', oninput: () => later() })
  const relChips = mode.rels.length > 1 ? chips(mode.rels.map(([id, label, ic]) => [id, label, ic]), st.rel, (v) => { st.rel = v; run() }, { ariaLabel: 'Kind of words' }) : null
  const filters = h('div', { class: 'stack tight' })
  const defBox = h('div')
  const out = h('div', { class: 'stack' })
  const status = h('div', { class: 'tw-sub', 'aria-live': 'polite' })

  async function run() {
    const word = input.value.trim()
    if (!word) { clear(out, empty('Type above to see results as you go.', mode.rels[0][2])); clear(defBox); clear(filters); clear(status); return }
    st.abort?.abort()
    const ctl = (st.abort = new AbortController())
    clear(status, 'Searching...')
    try {
      const res = await fetch(buildQuery(st.rel, word, params?.mode === 'pat' ? clueInp.value : ''), { signal: ctl.signal })
      if (!res.ok) throw new Error(`The word service returned an error (${res.status}).`)
      st.data = await res.json()
    } catch (e) {
      if (e.name === 'AbortError') return
      clear(status)
      clear(out, alert('error', e.message?.startsWith('The word') ? e.message : 'Could not reach the Datamuse word service. Check your internet connection and try again.'))
      return
    }
    if (ctl.signal.aborted) return
    clear(status)
    draw()
    if (params?.mode !== 'pat') define(word, ctl.signal)
  }
  async function define(word, sig) {
    try {
      const r = await (await fetch(`${API}?sp=${encodeURIComponent(word.toLowerCase())}&md=dr&max=1`, { signal: sig })).json()
      const defs = r[0]?.word === word.toLowerCase() ? r[0].defs : null
      if (!defs?.length || sig.aborted) return clear(defBox)
      clear(defBox, h('div', { class: 'tw-def tw-result-in' }, h('b', word.toLowerCase()), h('ol', defs.slice(0, 3).map((d) => { const [p, ...t] = d.split('\t'); return h('li', h('i', POS[p] || p), t.join(' ')) }))))
    } catch { clear(defBox) }
  }

  function draw() {
    const all = st.data
    const poses = [...new Set(all.flatMap((w) => (w.tags || []).filter((t) => POS[t])))]
    const syls = [...new Set(all.map((w) => w.numSyllables).filter(Boolean))].sort((a, b) => a - b)
    clear(filters,
      poses.length > 1 && all.length >= 12 ? chips([['all', 'All types'], ...poses.map((p) => [p, POS[p]])], st.pos, (v) => { st.pos = v; draw() }, { ariaLabel: 'Word type' }) : null,
      params?.mode === 'rhy' && syls.length > 1 ? chips([['all', 'Any length'], ...syls.slice(0, 6).map((n) => [String(n), `${n} syllable${n > 1 ? 's' : ''}`])], st.syl, (v) => { st.syl = v; draw() }, { ariaLabel: 'Syllables' }) : null)
    const spaced = /\s/.test(input.value.trim()) // a pattern with a space can match phrases; otherwise a space would be counted as a letter
    const pat = input.value.trim()
    let list = all.filter((w) => (params?.mode !== 'pat' || ((spaced || !/\s/.test(w.word)) && (pat.includes('*') || w.word.length === pat.length))) && (st.pos === 'all' || (w.tags || []).includes(st.pos)) && (st.syl === 'all' || String(w.numSyllables) === st.syl))
    if (!list.length) { clear(out, empty(all.length ? 'Nothing matches those filters.' : `No ${mode.rels.find((r) => r[0] === st.rel)[1].toLowerCase()} found for "${input.value.trim()}".`, 'search-x')); return }
    const pill = (w, i) => {
      const pos = (w.tags || []).find((t) => POS[t])
      return h('span', { class: 'tw-w', style: { '--i': Math.min(i, 30) } },
        h('button', { type: 'button', class: 'go', title: 'Look this word up', onclick: () => { input.value = w.word; run() } }, w.word, pos && params?.mode !== 'rhy' ? h('small', pos) : null),
        h('button', { type: 'button', class: 'cp', 'aria-label': `Copy ${w.word}`, title: 'Copy', onclick: () => copyText(w.word) }, icon('copy')))
    }
    if (params?.mode === 'rhy') {
      const g = new Map()
      for (const w of list) { const k = w.numSyllables || 0; if (!g.has(k)) g.set(k, []); g.get(k).push(w) }
      clear(out, [...g].sort((a, b) => a[0] - b[0]).map(([n, ws]) => h('div', { class: 'tw-grp' }, kicker(n ? `${n} syllable${n > 1 ? 's' : ''}` : 'Other', 'music-2'), h('div', { class: 'tw-words' }, ws.map(pill)))))
    } else clear(out, h('div', { class: 'tw-words' }, list.map(pill)))
    clear(status, `${list.length} word${list.length === 1 ? '' : 's'}`)
  }
  const later = debounce(() => { st.pos = 'all'; st.syl = 'all'; run() }, 380)
  signal?.addEventListener('abort', () => st.abort?.abort())
  onCleanup(() => st.abort?.abort())

  input.value = mode.start
  run()
  root.append(toolRoot('wl',
    h('section', { class: 'tw-stage' }, h('div', { class: 'stack' },
      h('div', { class: 'tw-q' }, input, params?.mode === 'pat' ? clueInp : null), relChips, h('div', { class: 'tw-sub' }, mode.hint))),
    defBox, filters, status, out,
    note('Words come from the free Datamuse service (api.datamuse.com). Only the word you type is sent.', 'cloud')))
}
