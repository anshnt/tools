// JSON formatter and JSON validator (one module, params.mode = 'validate' for the validator).
// Uses our own parser (see _json.js) so exact numbers, key order and escapes survive, and errors point at the right line and column.
import { studio, opt, seg, toggle, INDENTS, indentUnit, DevError, byteLength, focusOnDesktop } from './_shared.js'
import { parseOrRepair, printJson, jsonStats } from './_json.js'
import { USERS_JSON, PACKAGE_JSON, BROKEN_JSON } from './_samples.js'
import { formatBytes, formatNumber } from '../../lib/ui.js'
import { baseName } from '../../lib/files.js'

/** Pure core: text -> {out, node, stats, repaired}. Exported for tests. */
export async function formatJson(text, o = {}) {
  const { node, repaired } = await parseOrRepair(text, o.repair)
  const out = printJson(node, { indent: o.minify ? '' : o.indent ?? '  ', sort: o.sort, ascii: o.ascii })
  return { out, node, stats: jsonStats(node), repaired }
}

export function mount(root, { params }) {
  const validate = params.mode === 'validate'
  const startMin = params.mode === 'minify' // the JSON minifier entry opens in Minify mode
  const state = { mode: startMin ? 'minify' : 'format', indent: '2', sort: false, ascii: false, repair: false }
  const rerun = () => s.run(true)
  const repairToggle = toggle('Repair common mistakes', false, (v) => { state.repair = v; rerun() })
  const modeSeg = seg([['format', 'Format'], ['minify', 'Minify']], state.mode, (v) => { state.mode = v; s.view.setTitle(v === 'minify' ? 'Minified JSON' : 'Formatted JSON'); rerun() }, 'Output style')
  const indentSeg = seg(INDENTS, '2', (v) => { state.indent = v; rerun() }, 'Indentation')

  const s = studio({
    inputTitle: validate ? 'JSON to check' : 'JSON input', outputTitle: startMin ? 'Minified JSON' : 'Formatted JSON', inputIcon: 'braces', outputIcon: 'sparkles',
    runLabel: validate ? 'Validate' : startMin ? 'Minify' : 'Format', runIcon: validate ? 'circle-check' : startMin ? 'minimize' : 'wand-sparkles',
    accept: '.json,.jsonc,.geojson,.har,.webmanifest,application/json,text/plain',
    placeholder: 'Paste JSON here, drop a .json file, or pick an example below...',
    empty: ['braces', validate ? 'Paste JSON to see if it is valid' : startMin ? 'Your minified JSON shows up here' : 'Your formatted JSON shows up here'],
    mime: 'application/json', outLang: 'json',
    filename: (name) => (name ? `${baseName(name)}${state.mode === 'minify' ? '.min' : '.formatted'}.json` : state.mode === 'minify' ? 'data.min.json' : 'formatted.json'),
    indent: () => indentUnit(state.indent),
    samples: [
      { label: 'API response', icon: 'server', text: USERS_JSON },
      { label: 'package.json', icon: 'package', text: PACKAGE_JSON },
      { label: 'Broken JSON', icon: 'bug', text: BROKEN_JSON },
    ],
    options: [
      validate ? null : opt('Output', modeSeg),
      opt('Indent', indentSeg),
      toggle('Sort keys', false, (v) => { state.sort = v; rerun() }),
      toggle('ASCII only', false, (v) => { state.ascii = v; rerun() }),
      repairToggle,
    ],
    async process(text) {
      let r
      try {
        r = await formatJson(text, { repair: state.repair, minify: state.mode === 'minify', indent: indentUnit(state.indent), sort: state.sort, ascii: state.ascii })
      } catch (e) {
        if (e instanceof DevError && e.repairable && !state.repair) {
          e.actions = [{ label: 'Repair automatically', icon: 'wrench', primary: true, onClick: () => { repairToggle.input.checked = true; state.repair = true; rerun() } }]
        }
        throw e
      }
      const st = r.stats
      const inBytes = byteLength(text), outBytes = byteLength(r.out)
      const tiles = [
        { label: 'Size', value: formatBytes(outBytes), accent: true, hint: state.mode === 'minify' && inBytes ? `${inBytes > outBytes ? 'saved' : 'added'} ${formatNumber(Math.abs(1 - outBytes / inBytes) * 100, 1)}%` : `${formatBytes(inBytes)} before` },
        { label: 'Keys', value: st.keys }, { label: 'Objects', value: st.objects }, { label: 'Arrays', value: st.arrays },
        { label: 'Strings', value: st.strings }, { label: 'Numbers', value: st.numbers }, { label: 'Depth', value: st.depth },
      ]
      let notice = null
      if (r.repaired) notice = { type: 'warn', text: `Repaired automatically. The original had a problem at line ${r.repaired.line}: ${r.repaired.message} Check the result before you rely on it.` }
      else if (st.duplicates.length) notice = { type: 'warn', text: `Duplicate keys found (${st.duplicates.map((k) => `"${k}"`).join(', ')}). Most parsers keep only the last value.` }
      return {
        output: r.out, chip: r.repaired ? 'Repaired' : validate ? 'Valid JSON' : state.mode === 'minify' ? 'Minified' : 'Formatted', stats: tiles, notice,
        verdict: validate ? { title: r.repaired ? 'Valid after repair' : 'Valid JSON', text: `${formatNumber(st.keys)} keys, ${formatNumber(st.objects)} objects, ${formatNumber(st.arrays)} arrays, ${st.depth} levels deep, ${formatBytes(inBytes)}.` } : null,
      }
    },
  })
  root.append(s.el)
  focusOnDesktop(s.ed)
}
