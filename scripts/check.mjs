// CI check: catalog integrity, module contract, icons, syntax and house rules. Run: node scripts/check.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const errors = []
const fail = (msg) => errors.push(msg)

const { TOOLS, CATEGORIES, POPULAR, MODES } = await import(new URL('../assets/catalog.js', import.meta.url))
const cats = new Set(CATEGORIES.map((c) => c.id))

// --- Catalog ---
const seen = new Set()
for (const t of TOOLS) {
  const where = `${t.pack}/${t.id}`
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id || '')) fail(`${where}: id must be kebab-case`)
  if (seen.has(t.id)) fail(`${where}: duplicate id "${t.id}"`)
  seen.add(t.id)
  for (const k of ['name', 'desc', 'icon']) if (!t[k] || typeof t[k] !== 'string') fail(`${where}: missing ${k}`)
  if (t.desc && t.desc.length > 130) fail(`${where}: desc is ${t.desc.length} chars (max 130)`)
  if (!cats.has(t.cat)) fail(`${where}: unknown cat "${t.cat}"`)
  for (const a of t.also) if (!cats.has(a) || a === t.cat) fail(`${where}: bad also "${a}"`)
  if (!MODES[t.mode]) fail(`${where}: unknown mode "${t.mode}"`)
  if (t.params && (typeof t.params !== 'object' || Array.isArray(t.params))) fail(`${where}: params must be an object`)
  if (t.ready) {
    const file = join(root, 'packs', t.pack, `${t.module}.js`)
    if (!existsSync(file)) fail(`${where}: ready but packs/${t.pack}/${t.module}.js is missing`)
    else if (!/export\s+(async\s+)?function\s+mount\b|export\s*\{[^}]*\bmount\b/.test(readFileSync(file, 'utf8'))) fail(`${where}: packs/${t.pack}/${t.module}.js must export mount(root, ctx)`)
  }
}
for (const id of POPULAR) if (!seen.has(id)) fail(`POPULAR: unknown tool "${id}"`)

// --- Files: syntax, icons, house rules ---
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  if (f === '.git' || f === 'node_modules') return []
  const p = join(dir, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const all = walk(root)
const jsFiles = all.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }) } catch (e) { fail(`${relative(root, f)}: syntax error\n${e.stderr}`) }
}

const lucideVersion = readFileSync(join(root, 'index.html'), 'utf8').match(/lucide@([\d.]+)/)?.[1]
let iconNames = null
try {
  const code = await (await fetch(`https://cdn.jsdelivr.net/npm/lucide@${lucideVersion}/dist/umd/lucide.min.js`)).text()
  const ctx = vm.createContext({})
  vm.runInContext(code, ctx)
  iconNames = new Set(Object.keys(ctx.lucide.icons))
} catch (e) {
  console.warn(`! Skipping icon check (could not load lucide ${lucideVersion}): ${e.message}`)
}
const pascal = (s) => s.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase())
if (iconNames) {
  for (const t of TOOLS) if (!iconNames.has(pascal(t.icon))) fail(`${t.pack}/${t.id}: unknown lucide icon "${t.icon}"`)
  for (const c of CATEGORIES) if (!iconNames.has(pascal(c.icon))) fail(`category ${c.id}: unknown icon "${c.icon}"`)
  for (const f of [...jsFiles, ...all.filter((x) => x.endsWith('.html'))]) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/(?:\bicon\(\s*|\bicon:\s*|data-icon=")['"]?([a-z0-9]+(?:-[a-z0-9]+)*)['"]/g)) {
      if (!iconNames.has(pascal(m[1]))) fail(`${relative(root, f)}: unknown lucide icon "${m[1]}"`)
    }
  }
}

const textFiles = all.filter((f) => /\.(js|mjs|html|css|md|json|yml)$/.test(f))
for (const f of textFiles) {
  const src = readFileSync(f, 'utf8')
  if (src.includes(String.fromCharCode(0x2014))) fail(`${relative(root, f)}: contains an em dash (house style: use a hyphen or comma)`)
  if (/https?:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com|esm\.sh)\/(?!\$)(@[^/@'"\s`]+\/)?[^/@'"\s`]+(?=[/'"`])/.test(src)) fail(`${relative(root, f)}: CDN import without a pinned @version`)
}

const ready = TOOLS.filter((t) => t.ready).length
if (errors.length) {
  console.error(errors.map((e) => `x ${e}`).join('\n'))
  console.error(`\n${errors.length} problem(s). ${ready}/${TOOLS.length} tools ready.`)
  process.exitCode = 1
} else {
  console.log(`ok - ${TOOLS.length} tools (${ready} ready) in ${CATEGORIES.length} categories, ${jsFiles.length} JS files checked`)
}
