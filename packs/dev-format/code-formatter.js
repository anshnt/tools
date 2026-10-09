// Code formatter module: HTML, CSS and JavaScript formatters plus the all-language code beautifier (params.lang picks the focus).
// Formatting is done by Prettier (standalone build, loaded from a pinned CDN URL on first use, see _prettier.js).
import { studio, opt, seg, toggle, select, INDENTS, focusOnDesktop } from './_shared.js'
import { prettify, LANGS, detectLang, langFromName } from './_prettier.js'
import { baseName } from '../../lib/files.js'
import { formatBytes, formatNumber } from '../../lib/ui.js'

const SAMPLES = {
  html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Pricing</title><style>body{margin:0;font-family:system-ui}.card{padding:16px;border:1px solid #ddd}</style></head><body><nav class="top"><a href="/">Home</a><a href="/pricing" class="active">Pricing</a></nav><main><h1>Simple pricing</h1><ul class="plans"><li class="card"><h2>Free</h2><p>For <b>hobby</b> projects.</p></li><li class="card"><h2>Pro</h2><p>Everything in Free, plus <a href="/support">priority support</a>.</p><button onclick="buy('pro')" disabled>Buy now</button></li></ul></main><script>function buy(p){console.log("buying",p)}</script></body></html>`,
  vue: `<template><div class="counter"><button @click="count++" :disabled="count>=limit">Clicked {{count}} times</button><p v-if="count>=limit">Limit reached</p></div></template><script setup>import {ref} from 'vue'
const props=defineProps({limit:{type:Number,default:5}})
const count=ref(0)</script><style scoped>.counter{display:flex;gap:8px}button{padding:6px 12px}</style>`,
  css: `:root{--brand:#6366f1;--radius:12px}*,*::before,*::after{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#111}.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;border-radius:var(--radius);background:linear-gradient(135deg,var(--brand),#ec4899);color:#fff}.btn:hover{filter:brightness(1.1)}@media (max-width:600px){.btn{width:100%;justify-content:center}}`,
  scss: `$brand:#6366f1;@mixin card($pad:16px){padding:$pad;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.12)}.card{@include card(20px);color:darken($brand,20%);&:hover{box-shadow:0 4px 12px rgba(0,0,0,.2)}.title{font-weight:600;&.small{font-size:12px}}}`,
  less: `@brand:#6366f1;.rounded(@r:8px){border-radius:@r}.card{.rounded(12px);color:darken(@brand,15%);&:hover{color:@brand}.title{font-weight:600}}`,
  javascript: `import {readFile} from "node:fs/promises"
const DEFAULTS={retries:3,delay:250,verbose:false}
export async function load(path,opts={}){const {retries,delay}={...DEFAULTS,...opts};for(let i=0;i<=retries;i++){try{const text=await readFile(path,"utf8");return JSON.parse(text)}catch(err){if(i===retries)throw new Error('Failed to load '+path+': '+err.message);await new Promise(r=>setTimeout(r,delay*2**i))}}}
export const sum=(a,b)=>a+b, double=x=>x*2`,
  jsx: `export function Cart({items,onRemove}){const total=items.reduce((s,i)=>s+i.price*i.qty,0);return <ul className="cart">{items.map(i=><li key={i.id}>{i.name} x{i.qty}<button onClick={()=>onRemove(i.id)}>Remove</button></li>)}<li>Total: {total.toFixed(2)}</li></ul>}`,
  typescript: `interface User{id:number;name:string;email?:string;roles:Array<'admin'|'editor'|'viewer'>}
type Result<T>={ok:true;value:T}|{ok:false;error:string}
export function parseUser(raw:unknown):Result<User>{if(typeof raw!=='object'||raw===null)return {ok:false,error:'Expected an object'};const r=raw as Record<string,unknown>;if(typeof r.id!=='number')return {ok:false,error:'id must be a number'};return {ok:true,value:{id:r.id,name:String(r.name??''),roles:[]}}}`,
  tsx: `import {useState} from 'react'
type Props={title:string;initial?:number}
export default function Counter({title,initial=0}:Props){const [n,setN]=useState<number>(initial);return <button onClick={()=>setN(n+1)} aria-label={title}>{title}: {n}</button>}`,
  json: '{"name":"demo","version":"1.0.0","scripts":{"build":"vite build","test":"vitest"},"keywords":["a","b"],"nested":{"deep":{"list":[1,2,3,{"x":null}]}}}',
  markdown: `# Release notes\n* Faster startup\n* New dark mode\n   * follows system setting\n\n|Name|Qty|\n|--|--:|\n|Apples|3|\n|Pears|12|\n\nSome *emphasis* and __strong__ text.\n1) first\n1) second`,
  yaml: `name: CI\non:\n    push:\n        branches: [ main ]\njobs:\n    test:\n        runs-on: ubuntu-latest\n        steps:\n            - uses: actions/checkout@v4\n            - run:   npm ci && npm test   # run tests\n`,
  graphql: `query User($id:ID!,$first:Int=10){user(id:$id){id name friends(first:$first){edges{node{id name}}}}}\nmutation{addStar(input:{repo:"a/b"}){starrable{stargazerCount}}}`,
}
const LABEL = { html: 'HTML', vue: 'Vue component', css: 'CSS', scss: 'SCSS', less: 'Less', javascript: 'JavaScript', jsx: 'React JSX', tsx: 'React TSX', typescript: 'TypeScript', json: 'JSON', markdown: 'Markdown', yaml: 'YAML', graphql: 'GraphQL' }
const SAMPLE_ICON = { html: 'code', vue: 'component', css: 'paintbrush', scss: 'paintbrush', less: 'paintbrush', javascript: 'file-code-2', jsx: 'atom', tsx: 'atom', typescript: 'file-code', json: 'braces', markdown: 'file-text', yaml: 'file-cog', graphql: 'share-2' }
const SAMPLE_LANG = { jsx: 'javascript', tsx: 'typescript' }

const FOCUS = {
  html: { langs: ['html', 'vue'], samples: ['html', 'vue'], inputTitle: 'HTML input', outputTitle: 'Formatted HTML', ic: 'code', accept: '.html,.htm,.xhtml,.vue,text/html', ph: 'Paste messy HTML, drop an .html file, or pick an example below...', empty: ['code', 'Your beautified HTML shows up here'], auto: false },
  css: { langs: ['css', 'scss', 'less'], samples: ['css', 'scss', 'less'], inputTitle: 'CSS input', outputTitle: 'Formatted CSS', ic: 'paintbrush', accept: '.css,.scss,.sass,.less,text/css', ph: 'Paste CSS, SCSS or Less here, drop a file, or pick an example below...', empty: ['paintbrush', 'Your beautified stylesheet shows up here'], auto: true },
  js: { langs: ['javascript', 'typescript'], samples: ['javascript', 'jsx', 'typescript'], inputTitle: 'JavaScript or TypeScript', outputTitle: 'Formatted code', ic: 'file-code-2', accept: '.js,.mjs,.cjs,.jsx,.ts,.tsx,.mts,.cts,text/javascript', ph: 'Paste JavaScript, TypeScript or JSX here, drop a file, or pick an example below...', empty: ['file-code-2', 'Your beautified code shows up here'], auto: true },
  ts: { langs: ['typescript', 'javascript'], samples: ['typescript', 'tsx'], inputTitle: 'TypeScript input', outputTitle: 'Formatted TypeScript', ic: 'file-code', accept: '.ts,.tsx,.mts,.cts,.js,.jsx,.mjs,.cjs', ph: 'Paste TypeScript or TSX here, drop a .ts file, or pick an example below...', empty: ['file-code', 'Your beautified TypeScript shows up here'], auto: false },
  graphql: { langs: ['graphql'], samples: ['graphql'], inputTitle: 'GraphQL input', outputTitle: 'Formatted GraphQL', ic: 'share-2', accept: '.graphql,.gql,text/plain', ph: 'Paste a GraphQL query or schema, drop a .graphql file, or pick an example below...', empty: ['share-2', 'Your beautified GraphQL shows up here'], auto: false },
  markdown: { langs: ['markdown'], samples: ['markdown'], inputTitle: 'Markdown input', outputTitle: 'Formatted Markdown', ic: 'file-text', accept: '.md,.markdown,.mdx,text/markdown,text/plain', ph: 'Paste Markdown, drop a .md file, or pick an example below...', empty: ['file-text', 'Your tidy Markdown shows up here'], auto: false },
  all: { langs: ['javascript', 'typescript', 'json', 'css', 'scss', 'less', 'html', 'vue', 'markdown', 'yaml', 'graphql'], samples: ['javascript', 'typescript', 'json', 'css', 'html', 'markdown', 'yaml', 'graphql'], inputTitle: 'Code input', outputTitle: 'Beautified code', ic: 'wand-sparkles', accept: '.js,.mjs,.cjs,.jsx,.ts,.tsx,.json,.jsonc,.css,.scss,.less,.html,.htm,.vue,.md,.markdown,.yml,.yaml,.graphql,.gql,text/plain', ph: 'Paste code in any supported language. The language is detected automatically, or pick one above.', empty: ['wand-sparkles', 'Your beautified code shows up here'], auto: true },
}

/** Pure core: text + language id (or 'auto') + options -> {out, lang}. Exported for tests. */
export async function formatCode(text, lang, o = {}) {
  if (lang !== 'auto') return { out: await prettify(text, lang, o), lang }
  const first = detectLang(text)
  const alt = { javascript: ['typescript'], typescript: ['javascript'], scss: ['css', 'less'], css: ['scss', 'less'], less: ['scss', 'css'], markdown: ['yaml'], yaml: ['markdown'], html: ['vue'] }[first] || []
  let firstErr
  for (const l of [first, ...alt]) {
    try { return { out: await prettify(text, l, o), lang: l } } catch (e) { firstErr ??= e }
  }
  throw firstErr
}

export function mount(root, { params }) {
  const F = FOCUS[params.lang] || FOCUS.all
  const state = { lang: F.auto ? 'auto' : F.langs[0], width: '80', indent: '2', semi: true, single: false, comma: 'all', prose: 'preserve', ws: 'css' }
  const rerun = () => s.run(true)
  const langOpts = [...(F.auto ? [['auto', 'Auto-detect']] : []), ...F.langs.map((l) => [l, LABEL[l]])]
  const langCtl = F.langs.length > 1 ? (langOpts.length <= 4 ? seg(langOpts, state.lang, (v) => { state.lang = v; sync(); rerun() }, 'Language') : select(langOpts, state.lang, (v) => { state.lang = v; sync(); rerun() })) : null
  const setLang = (l) => { state.lang = l; if (langCtl) { if (langCtl.set) langCtl.set(l); else langCtl.value = l } sync() }
  const widthSel = select([['60', '60 columns'], ['80', '80 columns'], ['100', '100 columns'], ['120', '120 columns']], '80', (v) => { state.width = v; rerun() })
  const commaSel = select([['all', 'Trailing commas: all'], ['es5', 'Trailing commas: ES5'], ['none', 'Trailing commas: none']], 'all', (v) => { state.comma = v; rerun() })
  const proseSel = select([['preserve', 'Keep line wraps'], ['always', 'Wrap prose'], ['never', 'Unwrap prose']], 'preserve', (v) => { state.prose = v; rerun() })
  const wsSel = select([['css', 'Inline spacing: CSS default'], ['strict', 'Inline spacing: strict'], ['ignore', 'Inline spacing: ignore']], 'css', (v) => { state.ws = v; rerun() })
  const semiT = toggle('Semicolons', true, (v) => { state.semi = v; rerun() })
  const quoteT = toggle('Single quotes', false, (v) => { state.single = v; rerun() })
  const wrap = (kind, el) => { const d = opt('', el); d.dataset.kind = kind; return d }
  const optEls = [wrap('semi', semiT), wrap('quote', quoteT), wrap('semi', commaSel), wrap('prose', proseSel), wrap('ws', wsSel)]
  function activeLang() { return state.lang }
  function sync() {
    const L = LANGS[activeLang()] || {}
    const auto = state.lang === 'auto'
    const show = { semi: auto || !!L.code, quote: auto || !!(L.code || L.quotes), prose: auto || state.lang === 'markdown', ws: auto || state.lang === 'html' || state.lang === 'vue' }
    for (const el of optEls) el.hidden = !show[el.dataset.kind]
  }
  const sampleList = F.samples.map((k) => ({ label: LABEL[k], icon: SAMPLE_ICON[k], text: SAMPLES[k], lang: SAMPLE_LANG[k] || k }))

  const s = studio({
    inputTitle: F.inputTitle, outputTitle: F.outputTitle, inputIcon: F.ic, outputIcon: 'sparkles', runLabel: 'Format', runIcon: 'wand-sparkles',
    accept: F.accept, placeholder: F.ph, empty: F.empty, mime: 'text/plain',
    outLang: (r) => LANGS[r.lang]?.out || 'plain',
    filename: (name) => {
      const l = s.lastLang || state.lang
      const ext = LANGS[l]?.ext[0] || 'txt'
      return name ? `${baseName(name)}.formatted.${ext}` : `formatted.${ext}`
    },
    indent: () => (state.indent === 'tab' ? '\t' : ' '.repeat(Number(state.indent))),
    samples: sampleList,
    onSample: (smp) => { if (langCtl && state.lang !== 'auto' && F.langs.includes(smp.lang)) setLang(smp.lang) },
    onFile: (file) => { const l = langFromName(file.name); if (l && F.langs.includes(l)) { setLang(l); s.run(true) } },
    options: [
      langCtl ? opt(F.langs.length > 4 ? 'Language' : '', langCtl) : null,
      opt('Indent', seg(INDENTS, '2', (v) => { state.indent = v; rerun() }, 'Indentation')),
      opt('', widthSel),
      ...optEls,
    ],
    async process(text) {
      const o = { printWidth: Number(state.width), tabWidth: state.indent === 'tab' ? 2 : Number(state.indent), useTabs: state.indent === 'tab', semi: state.semi, singleQuote: state.single, trailingComma: state.comma, proseWrap: state.prose, htmlWhitespaceSensitivity: state.ws }
      const { out, lang } = await formatCode(text, state.lang, o)
      s.lastLang = lang
      const before = new Blob([text]).size, after = new Blob([out]).size
      const lines = (t) => t.trimEnd().split('\n').length
      return {
        output: out, lang, chip: state.lang === 'auto' ? `Detected ${LABEL[lang]}` : 'Formatted',
        stats: [
          { label: 'Language', value: LABEL[lang], accent: true, hint: state.lang === 'auto' ? 'auto-detected' : 'Prettier' },
          { label: 'Lines', value: lines(out), hint: `${formatNumber(lines(text), 0)} before` },
          { label: 'Size', value: formatBytes(after), hint: `${formatBytes(before)} before` },
        ],
      }
    },
  })
  sync()
  root.append(s.el)
  focusOnDesktop(s.ed)
}
