// Code minifier: JavaScript (Terser), CSS (csso), HTML (html-minifier-terser) and JSON (our parser). One module;
// params.lang focuses it on a single language (js-minifier, css-minifier, html-minifier, json-minifier entries).
// Each minifier loads from a pinned CDN URL the first time it is used. Nothing is uploaded.
import { studio, opt, seg, toggle, loadOnce, jsd, DevError, h, focusOnDesktop } from './_shared.js'
import { parseJson, printJson } from './_json.js'
import { script } from '../../lib/libs.js'
import { baseName, ext } from '../../lib/files.js'
import { formatBytes, formatNumber } from '../../lib/ui.js'

const terser = () => loadOnce('Terser', async () => { await script(jsd('terser@5.51.0/dist/bundle.min.js')); return window.Terser })
const csso = () => loadOnce('csso', () => import(jsd('csso@5.0.5/+esm')))
const htmlMin = () => loadOnce('the HTML minifier', () => import(jsd('html-minifier-terser@7.2.0/dist/htmlminifier.esm.bundle.js')))

const LANGS = { js: 'JavaScript', css: 'CSS', html: 'HTML', json: 'JSON' }
const OUT = { js: 'javascript', css: 'css', html: 'html', json: 'json' }
const EXT = { js: 'js', css: 'css', html: 'html', json: 'json' }

/** Best guess of the language of pasted code (or a file name). */
export function detectMinLang(text, name = '') {
  const e = ext(name).toLowerCase()
  if (['js', 'mjs', 'cjs'].includes(e)) return 'js'
  if (['css'].includes(e)) return 'css'
  if (['html', 'htm'].includes(e)) return 'html'
  if (['json', 'webmanifest'].includes(e)) return 'json'
  const t = text.trim()
  if (/^<(!doctype|html|head|body|div|section|main|p|ul|nav|header|footer|span|table|form|h[1-6]|a|img|button|script|style|template|!--)/i.test(t)) return 'html'
  if (/^[{[]/.test(t)) { try { JSON.parse(t); return 'json' } catch { /* JavaScript or CSS */ } }
  const code = t.replace(/^(?:\s*\/\*[\s\S]*?\*\/|\s*\/\/[^\n]*)+/, '').trim() // skip leading comments
  if (/^(?:@[\w-]+[^{;]*[{;]|[.#:*\w[][^{}();=]*\{\s*[\w-]+\s*:)/.test(code) && !/\b(function|const|let|var|return|import|export|class)\b|=>/.test(code)) return 'css'
  return 'js'
}

export async function gzipSize(text) {
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
    return (await new Response(stream).arrayBuffer()).byteLength
  } catch { return null }
}

/** Minify JavaScript with Terser. o: {mangle, compress, dropConsole, module, license}. Throws DevError at the syntax error. */
export async function minifyJs(code, o = {}) {
  const T = await terser()
  try {
    const r = await T.minify(code, {
      compress: o.compress === false ? false : { drop_console: !!o.dropConsole, passes: 2 },
      mangle: o.mangle !== false, module: !!o.module, toplevel: !!o.module,
      format: { comments: o.license === false ? false : /@license|@preserve|@cc_on|^\s*!/i },
    })
    return r.code || ''
  } catch (e) {
    if (e && e.line != null) throw new DevError(`JavaScript syntax error: ${e.message}.`, { line: e.line, col: (e.col ?? 0) + 1, hint: 'Terser only minifies code that parses. Fix the marked spot, or tick "ES module" if the code uses import or export.' })
    throw e
  }
}
/** Minify CSS with csso. o: {restructure, license}. Returns {out, warning}. */
export async function minifyCss(css, o = {}) {
  const c = await csso()
  let warning = null
  try {
    c.syntax.parse(css, { positions: true, onParseError: (e) => { warning ||= { line: e.line, col: e.column, message: e.parseError?.message || e.message } } })
  } catch { /* csso recovers from bad CSS, so the minifier below still runs */ }
  const out = c.minify(css, { restructure: o.restructure !== false, comments: o.license === false ? false : 'exclamation' }).css
  return { out, warning }
}
/** Minify HTML (and inline CSS and JS) with html-minifier-terser. */
export async function minifyHtml(html, o = {}) {
  const m = await htmlMin()
  try {
    return await m.minify(html, {
      collapseWhitespace: true, conservativeCollapse: !!o.conservative, removeComments: o.comments !== false, minifyCSS: o.inline !== false, minifyJS: o.inline !== false,
      useShortDoctype: true, collapseBooleanAttributes: true, removeAttributeQuotes: !!o.unquote, removeScriptTypeAttributes: true, removeStyleLinkTypeAttributes: true, decodeEntities: true,
    })
  } catch (e) {
    const msg = String(e.message || e).split('\n')[0].replace(/^Parse Error:\s*/, '')
    throw new DevError(`HTML problem: ${msg}`, { hint: 'Check for a tag that is opened but never closed, or a stray < or > character.' })
  }
}
export function minifyJson(text) { return printJson(parseJson(text), { indent: '' }) }

const SAMPLES = {
  js: `/*! Cart helpers - MIT */\n// Calculate the total of a shopping cart\nexport function calculateCartTotal(cartItems, discountRate = 0) {\n  const subtotal = cartItems.reduce((runningTotal, item) => {\n    return runningTotal + item.unitPrice * item.quantity\n  }, 0)\n\n  console.log('Subtotal is', subtotal)\n  const discountAmount = subtotal * discountRate\n  return Math.round((subtotal - discountAmount) * 100) / 100\n}\n\nexport const formatMoney = (amount, currency = 'USD') =>\n  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)\n`,
  css: `/*! Theme - MIT */\n:root {\n  --brand: #6366f1;\n  --radius: 12px;\n}\n\n/* buttons */\n.btn {\n  display: inline-flex;\n  padding: 10px 18px;\n  margin: 0px 0px 0px 0px;\n  border-radius: var(--radius);\n  background-color: #ffffff;\n  color: rgba(0, 0, 0, 1);\n}\n.btn:hover { background-color: #ffffff; opacity: 0.80 }\n.btn.primary { background: var(--brand); color: #fff; }\n\n@media (max-width: 600px) {\n  .btn { width: 100%; }\n}\n`,
  html: `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8">\n    <title>Landing page</title>\n    <!-- page styles -->\n    <style>\n      .hero   { padding: 40px; color: #333333; }\n    </style>\n  </head>\n  <body>\n    <!-- main content -->\n    <main class="hero">\n      <h1>  Hello,   <em>world</em>!  </h1>\n      <p>Welcome to the   demo page.</p>\n      <button type="button" disabled="disabled" onclick="greet()">Say hi</button>\n    </main>\n    <script>\n      // greet the visitor\n      function greet() {\n        alert('Hello there');\n      }\n    </script>\n  </body>\n</html>\n`,
  json: `{\n  "name": "demo",\n  "version": "1.0.0",\n  "scripts": {\n    "build": "vite build",\n    "test": "vitest run"\n  },\n  "keywords": [ "alpha", "beta" ],\n  "nested": { "deep": { "list": [ 1, 2, 3, { "x": null } ] } }\n}\n`,
}
const SAMPLE_ICON = { js: 'file-code-2', css: 'paintbrush', html: 'code', json: 'braces' }
const ACCEPT = { js: '.js,.mjs,.cjs,text/javascript', css: '.css,text/css', html: '.html,.htm,text/html', json: '.json,.webmanifest,application/json' }

function meterRow(label, value, pct, cls = '') {
  const i = h('i', { style: { width: '0%' } })
  setTimeout(() => { i.style.width = `${Math.max(1.5, Math.min(100, pct))}%` }, 30)
  return h('div', { class: ['df-meter-row', cls] }, h('span', label), h('div', { class: 'df-meter-bar' }, i), h('b', value))
}

export function mount(root, { params }) {
  const fixed = LANGS[params.lang] ? params.lang : null
  const state = { lang: fixed || 'auto', mangle: true, compress: true, drop: false, module: false, license: true, restructure: true, comments: true, inline: true, conservative: false, unquote: false }
  const rerun = () => s.run(true)
  const picker = fixed ? null : seg([['auto', 'Auto-detect'], ...Object.entries(LANGS)], 'auto', (v) => { state.lang = v; sync(); rerun() }, 'Language')
  const wrap = (kind, el) => { const d = opt('', el); d.dataset.kind = kind; return d }
  const optEls = [
    wrap('js', toggle('Mangle names', true, (v) => { state.mangle = v; rerun() })),
    wrap('js', toggle('Compress code', true, (v) => { state.compress = v; rerun() })),
    wrap('js', toggle('Drop console calls', false, (v) => { state.drop = v; rerun() })),
    wrap('js', toggle('ES module', false, (v) => { state.module = v; rerun() })),
    wrap('css', toggle('Merge and reorder rules', true, (v) => { state.restructure = v; rerun() })),
    wrap('js css', toggle('Keep /*! license */ comments', true, (v) => { state.license = v; rerun() })),
    wrap('html', toggle('Remove comments', true, (v) => { state.comments = v; rerun() })),
    wrap('html', toggle('Minify inline CSS and JS', true, (v) => { state.inline = v; rerun() })),
    wrap('html', toggle('Keep one space between tags', false, (v) => { state.conservative = v; rerun() })),
    wrap('html', toggle('Unquote attributes', false, (v) => { state.unquote = v; rerun() })),
  ]
  let current = fixed || 'js'
  function sync() {
    const l = state.lang === 'auto' ? (s?.detected || 'js') : state.lang
    for (const el of optEls) el.hidden = !el.dataset.kind.split(' ').includes(l)
  }
  const meterHost = h('div', { class: 'df-meter panel', hidden: true })

  const s = studio({
    inputTitle: fixed ? `${LANGS[fixed]} to minify` : 'Code to minify', outputTitle: 'Minified code', inputIcon: fixed ? SAMPLE_ICON[fixed] : 'minimize', outputIcon: 'sparkles', runLabel: 'Minify', runIcon: 'minimize',
    accept: fixed ? ACCEPT[fixed] : Object.values(ACCEPT).join(','), placeholder: fixed ? `Paste ${LANGS[fixed]} here, drop a file, or pick an example below...` : 'Paste JavaScript, CSS, HTML or JSON. The language is detected, or pick one above.',
    empty: ['minimize', 'Your minified code shows up here'], mime: 'text/plain', outLang: (r) => OUT[r.lang] || 'plain',
    filename: (name) => `${name ? baseName(name) : 'code'}.min.${EXT[current] || 'txt'}`,
    samples: (fixed ? [fixed] : ['js', 'css', 'html', 'json']).map((k) => ({ label: LANGS[k], icon: SAMPLE_ICON[k], text: SAMPLES[k], lang: k })),
    onSample: (smp) => { if (picker && state.lang !== 'auto') { state.lang = smp.lang; picker.set(smp.lang) } },
    onFile: (file) => { if (picker) { const l = detectMinLang('', file.name); if (state.lang !== 'auto' && l) { state.lang = l; picker.set(l) } } },
    options: [picker ? opt('Language', picker) : null, ...optEls],
    async process(text) {
      const lang = state.lang === 'auto' ? detectMinLang(text, s.ed.fileName) : state.lang
      s.detected = lang
      current = lang
      sync()
      let out, notice = null
      if (lang === 'js') out = await minifyJs(text, { mangle: state.mangle, compress: state.compress, dropConsole: state.drop, module: state.module, license: state.license })
      else if (lang === 'css') {
        const r = await minifyCss(text, { restructure: state.restructure, license: state.license })
        out = r.out
        if (r.warning) notice = { type: 'warn', text: `The CSS has a problem near line ${r.warning.line}: ${r.warning.message} The minifier skipped what it could not read, so check the result.` }
      } else if (lang === 'html') out = await minifyHtml(text, state)
      else out = minifyJson(text)
      const before = new Blob([text]).size, after = new Blob([out]).size
      const [gb, ga] = await Promise.all([gzipSize(text), gzipSize(out)])
      const saved = before ? (1 - after / before) * 100 : 0
      return {
        output: out, lang, chip: `${LANGS[lang]} ${formatNumber(Math.max(0, saved), 0)}% smaller`, notice, meter: { before, after, gb, ga },
        stats: [
          { label: 'Minified size', value: formatBytes(after), accent: true, hint: `${formatBytes(before)} before` },
          { label: saved >= 0 ? 'Saved' : 'Grew by', value: `${formatNumber(Math.abs(saved), 1)}%`, hint: `${formatBytes(Math.abs(before - after))} ${saved >= 0 ? 'less' : 'more'}` },
          { label: 'Gzipped', value: ga == null ? 'n/a' : formatBytes(ga), hint: gb == null ? '' : `${formatBytes(gb)} before` },
          { label: 'Language', value: LANGS[lang], hint: state.lang === 'auto' ? 'auto-detected' : '' },
        ],
      }
    },
    afterShow: (r) => {
      if (!r.meter) return
      const { before, after, gb, ga } = r.meter
      meterHost.hidden = false
      meterHost.replaceChildren(
        meterRow('Original', formatBytes(before), 100),
        meterRow('Minified', formatBytes(after), before ? (after / before) * 100 : 100, 'good'),
        ...(gb && ga ? [meterRow('Gzip original', formatBytes(gb), 100 * (gb / before)), meterRow('Gzip minified', formatBytes(ga), 100 * (ga / before), 'good')] : []))
    },
  })
  s.el.append(meterHost)
  s.ed.ta.addEventListener('input', () => { if (!s.ed.value.trim()) meterHost.hidden = true })
  sync()
  root.append(s.el)
  focusOnDesktop(s.ed)
}
