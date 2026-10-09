// JSON to TypeScript: interfaces with optional fields, nested types, arrays and unions, inferred from one or many samples.
import { studio, opt, toggle, seg, INDENTS, indentUnit, focusOnDesktop } from './_shared.js'
import { parseOrRepair } from './_json.js'
import { infer, toTypeScript } from './_infer.js'
import { USERS_JSON, EVENTS_JSON, ORDER_JSON } from './_samples.js'
import { input } from '../../lib/ui.js'

/** Pure core: node -> TypeScript source. */
export const generateTs = (node, o) => toTypeScript(infer(node), o)

export function mount(root) {
  const state = { kind: 'interface', exp: true, ro: false, semi: true, indent: '2', name: 'Root' }
  const rerun = () => s.run(true)
  const name = input({ value: 'Root', placeholder: 'Root', 'aria-label': 'Root type name', oninput: (e) => { state.name = e.target.value.trim() || 'Root'; s.schedule() } })
  const s = studio({
    inputTitle: 'Sample JSON', outputTitle: 'TypeScript', inputIcon: 'braces', outputIcon: 'file-code', runLabel: 'Generate', runIcon: 'sparkles',
    accept: '.json,application/json,text/plain', placeholder: 'Paste a sample JSON document. Arrays of objects are merged, so keys missing from some items become optional.',
    empty: ['file-code', 'Your TypeScript types show up here'], mime: 'text/typescript', outLang: 'typescript', filename: () => 'types.ts',
    indent: () => indentUnit(state.indent),
    samples: [{ label: 'API response', icon: 'server', text: USERS_JSON }, { label: 'Event log', icon: 'activity', text: EVENTS_JSON }, { label: 'Order', icon: 'shopping-cart', text: ORDER_JSON }],
    options: [
      opt('Root name', name),
      opt('Declare with', seg([['interface', 'interface'], ['type', 'type']], 'interface', (v) => { state.kind = v; rerun() }, 'Declaration style')),
      opt('Indent', seg(INDENTS, '2', (v) => { state.indent = v; rerun() }, 'Indentation')),
      toggle('export', true, (v) => { state.exp = v; rerun() }),
      toggle('readonly', false, (v) => { state.ro = v; rerun() }),
      toggle('Semicolons', true, (v) => { state.semi = v; rerun() }),
    ],
    async process(text) {
      const { node } = await parseOrRepair(text, false)
      const ts = generateTs(node, { rootName: state.name, kind: state.kind, exportKeyword: state.exp, readonly: state.ro, semicolons: state.semi, indent: indentUnit(state.indent) })
      const decls = (ts.match(/^(?:export )?(?:interface|type) /gm) || []).length
      const fields = (ts.match(/^\s+(?:readonly )?[^\s:?]+\??: /gm) || []).length
      return { output: ts, chip: `${decls} type${decls === 1 ? '' : 's'}`, stats: [
        { label: 'Types declared', value: decls, accent: true }, { label: 'Fields', value: fields }, { label: 'Optional fields', value: (ts.match(/\?: /g) || []).length }, { label: 'Lines', value: ts.trimEnd().split('\n').length },
      ] }
    },
  })
  root.append(s.el)
  focusOnDesktop(s.ed)
}
