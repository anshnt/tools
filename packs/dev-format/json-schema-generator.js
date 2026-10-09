// JSON Schema generator: infers a draft 2020-12 schema from sample JSON (arrays of objects merge into one shape).
import { studio, opt, toggle, seg, INDENTS, indentUnit, focusOnDesktop } from './_shared.js'
import { parseOrRepair } from './_json.js'
import { infer, toJsonSchema } from './_infer.js'
import { USERS_JSON, EVENTS_JSON, ORDER_JSON } from './_samples.js'
import { input } from '../../lib/ui.js'

export const SCHEMA_URL = 'https://json-schema.org/draft/2020-12/schema'

/** Pure core: JSON text -> schema object. */
export function generateSchema(node, o = {}) {
  const schema = toJsonSchema(infer(node), o)
  return { $schema: SCHEMA_URL, ...(o.title ? { title: o.title } : {}), ...schema }
}

/** Counts for the stat tiles. */
export function countSchema(schema) {
  const c = { nodes: 0, props: 0, required: 0, formats: 0 }
  const go = (x) => {
    if (!x || typeof x !== 'object') return
    if (x.type) c.nodes++
    if (x.format) c.formats++
    if (x.required) c.required += x.required.length
    if (x.properties) for (const v of Object.values(x.properties)) { c.props++; go(v) }
    if (x.items) go(x.items)
  }
  go(schema)
  return c
}

export function mount(root) {
  const state = { required: true, formats: true, strict: false, indent: '2', title: '' }
  const rerun = () => s.run(true)
  const title = input({ placeholder: 'Schema title (optional)', 'aria-label': 'Schema title', oninput: (e) => { state.title = e.target.value.trim(); s.schedule() } })
  const s = studio({
    inputTitle: 'Sample JSON', outputTitle: 'JSON Schema (2020-12)', inputIcon: 'braces', outputIcon: 'file-json', runLabel: 'Generate', runIcon: 'sparkles',
    accept: '.json,application/json,text/plain', placeholder: 'Paste a sample JSON document. The more examples in an array, the better the schema (optional keys are detected).',
    empty: ['file-json', 'The inferred schema shows up here'], mime: 'application/json', outLang: 'json', filename: () => 'schema.json',
    indent: () => indentUnit(state.indent),
    samples: [{ label: 'API response', icon: 'server', text: USERS_JSON }, { label: 'Event log', icon: 'activity', text: EVENTS_JSON }, { label: 'Order', icon: 'shopping-cart', text: ORDER_JSON }],
    options: [
      opt('', title),
      opt('Indent', seg(INDENTS, '2', (v) => { state.indent = v; rerun() }, 'Indentation')),
      toggle('Required keys', true, (v) => { state.required = v; rerun() }),
      toggle('Detect formats', true, (v) => { state.formats = v; rerun() }),
      toggle('No extra properties', false, (v) => { state.strict = v; rerun() }),
    ],
    async process(text) {
      const { node } = await parseOrRepair(text, false)
      const schema = generateSchema(node, state)
      const out = JSON.stringify(schema, null, state.indent === 'tab' ? '	' : Number(state.indent))
      const c = countSchema(schema)
      return { output: out, chip: 'Schema ready', stats: [
        { label: 'Typed nodes', value: c.nodes, accent: true }, { label: 'Properties', value: c.props }, { label: 'Required keys', value: c.required },
        { label: 'Formats found', value: c.formats }, { label: 'Top-level type', value: [].concat(schema.type || 'any').join(' | ') },
      ] }
    },
  })
  root.append(s.el)
  focusOnDesktop(s.ed)
}
