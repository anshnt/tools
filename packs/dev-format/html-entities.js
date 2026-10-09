// HTML entity encoder and decoder with a searchable entity reference. Encoding writes named, decimal or hex references;
// decoding uses the browser's HTML parser so every named entity works (see _entities.js).
import { studio, opt, seg, focusOnDesktop, h, button } from './_shared.js'
import { ENTITIES, encodeEntities, decodeEntities, groupOf } from './_entities.js'
import { copyText, input, formatNumber } from '../../lib/ui.js'

const SAMPLE_ENCODE = `<p class="note">Café "Müller" & Söhne - © 2025</p>\nPrice: €5 ½ kg → ✓ 😀 5 < 7 && 9 > 3`
const SAMPLE_DECODE = `&lt;p class=&quot;note&quot;&gt;Caf&eacute; &amp; cr&egrave;me &mdash; &#8364;5 &#x1F600; &copy; 2025 &hearts;&lt;/p&gt;\nUnknown: &foo; and a lone &amp ampersand`

const GROUPS = [['all', 'All'], ['markup', 'Markup'], ['symbols', 'Symbols'], ['currency', 'Currency'], ['arrows', 'Arrows'], ['math', 'Math'], ['greek', 'Greek'], ['letters', 'Letters']]

export function mount(root) {
  const state = { mode: 'encode', scope: 'basic', format: 'named' }
  const rerun = () => s.run(true)
  const modeSeg = seg([['encode', 'Encode'], ['decode', 'Decode']], 'encode', (v) => { setMode(v); rerun() }, 'Direction')
  const scopeOpt = opt('Encode', seg([['basic', 'Special characters'], ['non-ascii', 'Plus non-ASCII'], ['all', 'Everything']], 'basic', (v) => { state.scope = v; rerun() }, 'What to encode'))
  const formatOpt = opt('As', seg([['named', 'Names'], ['dec', 'Decimal'], ['hex', 'Hex']], 'named', (v) => { state.format = v; rerun() }, 'Reference style'))
  function setMode(v) {
    state.mode = v
    modeSeg.set(v)
    scopeOpt.hidden = formatOpt.hidden = v !== 'encode'
    s.view.setTitle(v === 'encode' ? 'Encoded text' : 'Decoded text')
  }

  const s = studio({
    inputTitle: 'Text', outputTitle: 'Encoded text', inputIcon: 'ampersand', outputIcon: 'sparkles', runLabel: 'Convert', runIcon: 'arrow-left-right', noRun: false,
    accept: '.txt,.html,.htm,.xml,text/plain,text/html', placeholder: 'Type or paste text. Special characters like & < > " are encoded, or switch to Decode to turn entities back into characters.',
    empty: ['ampersand', 'The converted text shows up here'], mime: 'text/plain', outLang: 'plain',
    filename: () => (state.mode === 'encode' ? 'encoded.txt' : 'decoded.txt'),
    samples: [{ label: 'Text with symbols', icon: 'type', text: SAMPLE_ENCODE, mode: 'encode' }, { label: 'Entities to decode', icon: 'ampersand', text: SAMPLE_DECODE, mode: 'decode' }],
    onSample: (smp) => setMode(smp.mode),
    options: [opt('Mode', modeSeg), scopeOpt, formatOpt],
    async process(text) {
      if (state.mode === 'encode') {
        const { out, count } = encodeEntities(text, state)
        return {
          output: out, chip: count ? `${formatNumber(count, 0)} encoded` : 'Nothing to encode',
          notice: count ? null : { type: 'info', text: 'No special characters found. Choose "Plus non-ASCII" or "Everything" to encode more.' },
          stats: [{ label: 'Characters in', value: [...text].length, accent: true }, { label: 'References written', value: count }, { label: 'Characters out', value: out.length }],
        }
      }
      const { out, count, unknown } = decodeEntities(text)
      return {
        output: out, chip: count ? `${formatNumber(count, 0)} decoded` : 'Nothing to decode',
        notice: unknown.length ? { type: 'warn', text: `${unknown.length} reference${unknown.length === 1 ? '' : 's'} not recognized and left as written: ${unknown.slice(0, 6).join(' ')}${unknown.length > 6 ? ' ...' : ''}` } : count ? null : { type: 'info', text: 'No entities found in the text.' },
        stats: [{ label: 'Entities decoded', value: count, accent: true }, { label: 'Characters in', value: text.length }, { label: 'Characters out', value: out.length }],
      }
    },
  })

  // ---- reference ----
  const grid = h('div', { class: 'df-ent-grid' })
  let group = 'all', q = '', expanded = false
  const list = ENTITIES.map(([name, cp]) => ({ name, cp, ch: String.fromCodePoint(cp), group: groupOf(name, cp) }))
  function renderGrid() {
    const needle = q.trim().toLowerCase().replace(/^&|;$/g, '')
    const shown = list.filter((e) => (group === 'all' || e.group === group) && (!needle || e.name.toLowerCase().includes(needle) || e.ch === q.trim() || String(e.cp) === needle || `u+${e.cp.toString(16)}` === needle))
    const cut = !expanded && group === 'all' && !needle && shown.length > 60 // the full table is long, so start with the first rows
    grid.replaceChildren(...(cut ? shown.slice(0, 60) : shown).map((e) => h('button', { type: 'button', class: 'df-ent', title: `Copy &${e.name};`, 'aria-label': `Copy &${e.name};, the ${e.name} character`, onclick: () => copyText(`&${e.name};`) },
      h('span', { class: 'g' }, e.ch === ' ' ? '␣' : e.ch), h('span', { class: 'nm' }, `&${e.name};`), h('span', { class: 'nu' }, `&#${e.cp};`))))
    if (cut) grid.append(button(`Show all ${shown.length} entities`, { icon: 'chevrons-down', attrs: { style: 'grid-column:1/-1' }, onClick: () => { expanded = true; renderGrid() } }))
    if (!shown.length) grid.append(h('div', { class: 'muted', style: 'grid-column:1/-1;padding:14px' }, 'No entity matches that. Try a name like "copy", a character, or a number like 169.'))
  }
  renderGrid()
  const search = input({ placeholder: 'Search by name, character or number...', 'aria-label': 'Search entities', oninput: (e) => { q = e.target.value; renderGrid() } })
  const groupSeg = seg(GROUPS, 'all', (v) => { group = v; renderGrid() }, 'Entity group')
  const ref = h('section', { class: 'panel' },
    h('h2', 'Entity reference'),
    h('p', { class: 'muted small', style: 'margin:0 0 12px' }, `${ENTITIES.length} common named entities. Click one to copy it. Decoding understands every HTML5 name, not just these.`),
    h('div', { class: 'row', style: 'margin-bottom:12px' }, h('div', { style: 'flex:1;min-width:200px' }, search), groupSeg), grid)
  s.el.append(ref)
  root.append(s.el)
  focusOnDesktop(s.ed)
}
