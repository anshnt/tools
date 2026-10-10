// Node test for the CDR reader on synthetic files from gen_cdr.py (RIFF containers only; ZIP containers need JSZip, see the browser tests).
//   python gen_cdr.py /tmp/cdr-samples && node parse.test.mjs /tmp/cdr-samples
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { readCdr } from '../_cdr.js'
import { buildDoc, pageModel, leaves } from '../_cdrdoc.js'

const dir = process.argv[2]
if (!dir) throw new Error('usage: node parse.test.mjs <dir with .cdr files and manifest.json>')
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
let n = 0
for (const [name, m] of Object.entries(manifest)) {
  if (m.container !== 'riff') continue
  const r = await readCdr(readFileSync(join(dir, name)))
  assert.equal(r.failed, false, name)
  assert.equal(r.version, m.version, name)
  assert.equal(r.pages.length, m.pages, name)
  const page = r.pages.find((p) => !p.master)
  assert.equal([...leaves(page.layers[0].objects)].length >= m.objects, true, name)
  const doc = buildDoc(r)
  const model = pageModel(doc.pages.findIndex((p) => !p.master) >= 0 ? doc.pages.find((p) => !p.master) : doc.pages[0], { bitmapHref: () => 'data:image/png;base64,AA==' })
  assert.ok(model.page.items.length >= m.objects, name)
  n++
}
// damaged files must not throw and must say what is wrong
for (const f of readdirSync(dir).filter((x) => x.startsWith('bad-') || x.startsWith('old-'))) {
  const r = await readCdr(readFileSync(join(dir, f)), {})
  assert.ok(r.warnings.length > 0, `${f} should warn`)
  n++
}
console.log(`ok - ${n} files`)
