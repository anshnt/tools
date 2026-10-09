// YAML formatter and YAML <-> JSON converter (one module, params.convert switches to the converter, params.validate to the validator wording).
// js-yaml parses and reports errors; Prettier prints, so comments, blank lines and anchors survive formatting.
import { studio, opt, seg, toggle, select, loadOnce, jsd, DevError, INDENTS, indentUnit, focusOnDesktop, button } from './_shared.js'
import { prettify } from './_prettier.js'
import { parseJson, toValue } from './_json.js'
import { USERS_JSON } from './_samples.js'
import { baseName } from '../../lib/files.js'
import { formatBytes, formatNumber } from '../../lib/ui.js'

const yamlLib = () => loadOnce('js-yaml', () => import(jsd('js-yaml@5.4.2/+esm')))

const HINTS = [
  [/tab character/i, 'YAML indents with spaces only. Replace the tab with spaces (two per level is the usual choice).'],
  [/duplicated mapping key/i, 'Each key can appear only once inside the same mapping. Rename or remove one of them.'],
  [/bad indentation|deficient indentation|wrong indentation/i, 'Keys at the same level must start in exactly the same column, and children must be indented further than their parent.'],
  [/flow (collection|mapping|sequence)|unexpected end of the stream/i, 'A [ or { was opened but never closed. Check for a missing ] or }.'],
  [/unidentified alias|undefined alias/i, 'An alias (*name) needs an anchor (&name) defined earlier in the document.'],
  [/can not read a block mapping entry|could not find expected ':'|mapping values are not allowed/i, 'A key needs a colon followed by a space ("key: value"). Values containing ": " or "#" should be quoted.'],
  [/unacceptable|invalid|unknown/i, 'This character or escape is not allowed here. Wrap the text in quotes if it should be taken literally.'],
]
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
function toDevError(e) {
  if (e?.name !== 'YAMLException') return e
  const reason = String(e.reason || e.message || '').split('\n')[0].replace(/\s*\(\d+:\d+\)\s*$/, '')
  const m = e.mark
  return new DevError(`${cap(reason)}.`, { line: m ? m.line + 1 : undefined, col: m ? m.column + 1 : undefined, hint: HINTS.find(([re]) => re.test(reason))?.[1] })
}

/** Parse every document in the text. Merge keys (<<: *anchor) are applied. Throws DevError with line and column. */
export async function parseYaml(text) {
  const y = await yamlLib()
  try {
    return y.loadAll(text, { schema: y.CORE_SCHEMA.withTags(y.mergeTag) })
  } catch (e) {
    throw toDevError(e)
  }
}

/** Counts for the stat tiles. */
export function yamlStats(docs) {
  const s = { docs: docs.length, maps: 0, lists: 0, keys: 0, scalars: 0, depth: 0 }
  const go = (v, d) => {
    s.depth = Math.max(s.depth, d)
    if (Array.isArray(v)) { s.lists++; for (const x of v) go(x, d + 1) } else if (v && typeof v === 'object' && !(v instanceof Date)) {
      s.maps++
      for (const k of Object.keys(v)) { s.keys++; go(v[k], d + 1) }
    } else s.scalars++
  }
  for (const d of docs) go(d, 1)
  return s
}
/** Integers beyond 2^53 and non-finite numbers do not survive JSON. */
function jsonLosses(v) {
  const l = { big: 0, nonFinite: 0 }
  const go = (x) => {
    if (typeof x === 'number') { if (!Number.isFinite(x)) l.nonFinite++; else if (Number.isInteger(x) && !Number.isSafeInteger(x)) l.big++ } else if (Array.isArray(x)) x.forEach(go)
    else if (x && typeof x === 'object') Object.values(x).forEach(go)
  }
  go(v)
  return l
}
function dumpDocs(y, docs, o) {
  return docs.map((d) => y.dump(d, { indent: o.indent, lineWidth: o.width, sortKeys: o.sort, quotingType: o.single ? "'" : '"', noRefs: !!o.noRefs })).join('---\n')
}

const SAMPLES = {
  k8s: `# Deployment for the web app\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n    name: web\n    labels: {app: web,tier: frontend}\nspec:\n    replicas: 3\n    selector:\n        matchLabels: {app: web}\n    template:\n        spec:\n            containers:\n                - name: web\n                  image:   "nginx:1.27"\n                  ports: [ {containerPort: 80} ]\n                  env:\n                      - {name: LOG_LEVEL, value: 'info'}   # change for debugging\n`,
  compose: `services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: example\n    volumes: [ "pgdata:/var/lib/postgresql/data" ]\n  web:\n    build: .\n    ports:\n      - "8080:80"\n    depends_on: [db]\nvolumes:\n  pgdata: {}\n`,
  anchors: `defaults: &defaults\n  adapter: postgres\n  pool: 5\ndevelopment:\n  <<: *defaults\n  database: app_dev\nproduction:\n  <<: *defaults\n  database: app_prod\n  pool: 20\n`,
  broken: `services:\n  web:\n    image: nginx\n\tports:\n      - "80:80"\n  db:\n   image: postgres\n  image: mysql\n`,
}

export function mount(root, { params }) {
  const convert = !!params.convert
  const validate = !!params.validate
  const state = { indent: '2', width: '80', single: false, sort: false, dir: 'auto', jsonIndent: '2' }
  const rerun = () => s.run(true)
  const dirSeg = seg([['auto', 'Auto-detect'], ['yaml', 'YAML to JSON'], ['json', 'JSON to YAML']], 'auto', (v) => { state.dir = v; rerun() }, 'Direction')
  const swap = button('Swap', { icon: 'arrow-left-right', size: 'sm', title: 'Use the output as the input and flip the direction', ariaLabel: 'Swap input and output', onClick: () => {
    if (!s.view.text) return
    const was = s.lastDir
    state.dir = was === 'yaml' ? 'json' : 'yaml'
    dirSeg.set(state.dir)
    // the output of a YAML to JSON run is JSON, so the next input is JSON going to YAML (and the other way round)
    s.ed.set(s.view.text, { emit: false })
    rerun()
  } })
  const indentCtl = seg(INDENTS.slice(0, 2).concat([['min', 'Minified']]), '2', (v) => { state.jsonIndent = v; rerun() }, 'JSON indentation')
  const sortT = toggle('Sort keys', false, (v) => { state.sort = v; rerun() })
  const quoteT = toggle('Single quotes', false, (v) => { state.single = v; rerun() })
  const widthSel = select([['40', 'Wrap at 40'], ['80', 'Wrap at 80'], ['120', 'Wrap at 120'], ['9999', 'No wrapping']], '80', (v) => { state.width = v; rerun() })
  const yamlOnly = [opt('Indent', seg([['2', '2 spaces'], ['4', '4 spaces']], '2', (v) => { state.indent = v; rerun() }, 'YAML indentation')), widthSel, quoteT]

  const s = studio({
    inputTitle: convert ? 'YAML or JSON' : 'YAML input', outputTitle: convert ? 'Converted' : validate ? 'Formatted YAML' : 'Formatted YAML', inputIcon: 'file-cog', outputIcon: 'sparkles',
    runLabel: convert ? 'Convert' : validate ? 'Validate' : 'Format', runIcon: convert ? 'arrow-left-right' : validate ? 'circle-check' : 'wand-sparkles',
    accept: '.yml,.yaml,.json,text/yaml,application/json,text/plain',
    placeholder: convert ? 'Paste YAML or JSON. The direction is detected for you, or pick one above.' : 'Paste YAML here, drop a .yml file, or pick an example below...',
    empty: ['file-cog', convert ? 'The converted result shows up here' : validate ? 'Paste YAML to check it' : 'Your formatted YAML shows up here'],
    mime: 'text/yaml', outLang: (r) => r.lang,
    filename: (name) => {
      const b = name ? baseName(name) : 'converted'
      if (!convert) return `${name ? `${b}.formatted` : 'formatted'}.yaml`
      return `${b}.${s.lastDir === 'yaml' ? 'json' : 'yaml'}`
    },
    indent: () => (convert && s.lastDir === 'yaml' ? ' '.repeat(2) : ' '.repeat(Number(state.indent))),
    samples: convert
      ? [{ label: 'Docker compose', icon: 'container', text: SAMPLES.compose }, { label: 'With anchors', icon: 'anchor', text: SAMPLES.anchors }, { label: 'JSON data', icon: 'braces', text: USERS_JSON }, { label: 'Broken YAML', icon: 'bug', text: SAMPLES.broken }]
      : [{ label: 'Kubernetes', icon: 'boxes', text: SAMPLES.k8s }, { label: 'Docker compose', icon: 'container', text: SAMPLES.compose }, { label: 'With anchors', icon: 'anchor', text: SAMPLES.anchors }, { label: 'Broken YAML', icon: 'bug', text: SAMPLES.broken }],
    options: convert
      ? [opt('Direction', dirSeg), opt('JSON', indentCtl), ...yamlOnly.slice(0, 2), sortT, swap]
      : [...yamlOnly, sortT],
    async process(text) {
      const y = await yamlLib()
      const before = new Blob([text]).size

      if (!convert) {
        const docs = await parseYaml(text)
        const st = yamlStats(docs)
        let out, notice = null
        if (state.sort) {
          out = dumpDocs(y, docs, { indent: Number(state.indent), width: Number(state.width), sort: true, single: state.single })
          notice = { type: 'info', text: 'Sorting keys rebuilds the file, so comments, anchors and blank lines are not kept. Turn it off to keep them.' }
        } else {
          out = await prettify(text, 'yaml', { tabWidth: Number(state.indent), printWidth: Number(state.width), singleQuote: state.single })
        }
        return {
          output: out, lang: 'yaml', chip: validate ? 'Valid YAML' : 'Formatted', notice,
          verdict: validate ? { title: docs.length ? 'Valid YAML' : 'Valid, but empty', text: `${formatNumber(st.docs)} document${st.docs === 1 ? '' : 's'}, ${formatNumber(st.keys)} keys, ${formatNumber(st.lists)} lists, ${st.depth} levels deep, ${formatBytes(before)}.` } : null,
          stats: [{ label: 'Documents', value: st.docs, accent: true }, { label: 'Keys', value: st.keys }, { label: 'Lists', value: st.lists }, { label: 'Values', value: st.scalars }, { label: 'Depth', value: st.depth }],
        }
      }

      // converter: decide the direction
      let dir = state.dir
      let asJson = null
      if (dir === 'auto' || dir === 'json') {
        try { asJson = parseJson(text) } catch (e) { if (dir === 'json') throw e }
        if (dir === 'auto') dir = asJson ? 'json' : 'yaml'
      }
      s.lastDir = dir
      s.view.setTitle(dir === 'yaml' ? 'JSON' : 'YAML')
      if (dir === 'json') {
        const value = toValue(asJson)
        const st = yamlStats([value])
        const out = dumpDocs(y, [value], { indent: Number(state.indent), width: Number(state.width), sort: state.sort, single: state.single })
        return {
          output: out, lang: 'yaml', chip: state.dir === 'auto' ? 'JSON to YAML' : 'Converted',
          notice: state.dir === 'auto' ? { type: 'info', text: 'Detected JSON, so it was converted to YAML. Use the direction switch to force YAML to JSON.' } : null,
          stats: [{ label: 'Output size', value: formatBytes(new Blob([out]).size), accent: true, hint: `${formatBytes(before)} as JSON` }, { label: 'Keys', value: st.keys }, { label: 'Lists', value: st.lists }, { label: 'Depth', value: st.depth }],
        }
      }
      const docs = await parseYaml(text)
      const st = yamlStats(docs)
      const value = docs.length <= 1 ? (docs[0] ?? null) : docs
      const sorted = state.sort ? sortDeep(value) : value
      const out = state.jsonIndent === 'min' ? JSON.stringify(sorted) : JSON.stringify(sorted, null, Number(state.jsonIndent))
      const lost = jsonLosses(value)
      const notes = []
      if (docs.length > 1) notes.push(`The file has ${docs.length} YAML documents, so the JSON is an array with one item per document.`)
      if (lost.nonFinite) notes.push(`${lost.nonFinite} value${lost.nonFinite === 1 ? ' is' : 's are'} .inf or .nan, which JSON cannot hold, so ${lost.nonFinite === 1 ? 'it became' : 'they became'} null.`)
      if (lost.big) notes.push(`${lost.big} integer${lost.big === 1 ? ' is' : 's are'} larger than 2^53 and may have lost precision. Quote such IDs in the YAML to keep them exact.`)
      return {
        output: out, lang: 'json', chip: state.dir === 'auto' ? 'YAML to JSON' : 'Converted',
        notice: notes.length ? { type: 'warn', text: notes.join(' ') } : null,
        stats: [{ label: 'Output size', value: formatBytes(new Blob([out]).size), accent: true, hint: `${formatBytes(before)} as YAML` }, { label: 'Documents', value: st.docs }, { label: 'Keys', value: st.keys }, { label: 'Depth', value: st.depth }],
      }
    },
  })
  root.append(s.el)
  focusOnDesktop(s.ed)
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
  return v
}
