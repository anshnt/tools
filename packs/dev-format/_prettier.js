// Prettier (standalone build) loaded lazily from a pinned CDN URL, with the language table the formatters share.
import { loadOnce, jsd, DevError } from './_shared.js'

const V = '3.9.8'
const core = () => loadOnce('Prettier', () => import(jsd(`prettier@${V}/standalone.mjs`)))
const plugin = (name) => loadOnce(`the Prettier ${name} plugin`, () => import(jsd(`prettier@${V}/plugins/${name}.mjs`)))

/** id -> {label, parser, plugins, out (highlight language), ext, mime, opts: which option groups apply} */
export const LANGS = {
  javascript: { label: 'JavaScript', parser: 'babel', plugins: ['babel', 'estree'], out: 'javascript', ext: ['js', 'mjs', 'cjs', 'jsx'], code: true },
  typescript: { label: 'TypeScript', parser: 'typescript', plugins: ['typescript', 'estree'], out: 'typescript', ext: ['ts', 'tsx', 'mts', 'cts'], code: true },
  json: { label: 'JSON', parser: 'json', plugins: ['babel', 'estree'], out: 'json', ext: ['json', 'jsonc', 'json5', 'webmanifest'], mime: 'application/json' },
  css: { label: 'CSS', parser: 'css', plugins: ['postcss'], out: 'css', ext: ['css'], quotes: true },
  scss: { label: 'SCSS', parser: 'scss', plugins: ['postcss'], out: 'scss', ext: ['scss', 'sass'], quotes: true },
  less: { label: 'Less', parser: 'less', plugins: ['postcss'], out: 'less', ext: ['less'], quotes: true },
  html: { label: 'HTML', parser: 'html', plugins: ['html', 'postcss', 'babel', 'estree'], out: 'html', ext: ['html', 'htm', 'xhtml'], quotes: true },
  vue: { label: 'Vue', parser: 'vue', plugins: ['html', 'postcss', 'babel', 'estree', 'typescript'], out: 'html', ext: ['vue'], quotes: true },
  markdown: { label: 'Markdown', parser: 'markdown', plugins: ['markdown'], out: 'markdown', ext: ['md', 'markdown', 'mdx'] },
  yaml: { label: 'YAML', parser: 'yaml', plugins: ['yaml'], out: 'yaml', ext: ['yml', 'yaml'], quotes: true },
  graphql: { label: 'GraphQL', parser: 'graphql', plugins: ['graphql'], out: 'graphql', ext: ['graphql', 'gql'] },
}
export const langFromName = (name = '') => {
  const e = name.toLowerCase().split('.').pop()
  return Object.keys(LANGS).find((k) => LANGS[k].ext.includes(e)) || null
}

/** Best guess of the language of a pasted snippet. */
export function detectLang(text) {
  const t = text.trim()
  if (!t) return 'javascript'
  if (/^[{[]/.test(t)) { try { JSON.parse(t); return 'json' } catch { /* maybe JS */ } }
  if (/^<template[\s>]|^<script\s+setup|^<script[^>]*lang=/.test(t) && /<\/template>|<\/script>/.test(t)) return 'vue'
  if (/^<!doctype html|^<html[\s>]|^<(div|section|main|body|head|p|ul|nav|header|footer|span|table|form|h[1-6]|a|img|button|script|style)[\s>/]/i.test(t)) return 'html'
  const lines = t.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l))
  // Markdown-only markers: code fences, table rules, links, bold text, block quotes
  const mdOnly = /^```|^\s*\|?\s*:?-{3,}:?\s*\|/m.test(t) || /\[[^\]]+\]\([^)]+\)/.test(t) || /(\*\*|__)\S.*?\1/.test(t) || /^>\s/m.test(t)
  const yamlLine = (l) => /^\s*(-\s+)?("[^"]*"|'[^']*'|[\w.$/@-][\w .$/@-]*):(\s|$)/.test(l) || /^\s*-\s+\S/.test(l) || /^\s*---\s*$/.test(l) || /^\s+\S/.test(l)
  const yamlLike = lines.length > 0 && !mdOnly && lines.every((l) => !/;\s*$|=>/.test(l) && !/^\s*(const|let|var|function|import|export|return|if|for|while|class|interface|type|enum|query|mutation)\b(?!\s*:)/.test(l))
    && lines.filter(yamlLine).length / lines.length >= 0.8 && lines.some((l) => /^([\w"'.-][\w .$/@"'-]*:(\s|$)|---)/.test(l))
  if (yamlLike) return 'yaml'
  // TypeScript-only syntax. Plain ES modules (import/export) stay JavaScript.
  if (/:\s*(string|number|boolean|unknown|any|void|never)\b|\bas\s+(const|string|number|unknown|any)\b|\btype\s+\w+(<[^>]*>)?\s*=|<[A-Z]\w*>\(|\b(implements|readonly|abstract)\s+\w|^\s*(declare|namespace)\s/m.test(t)) return 'typescript'
  if (/^(query|mutation|subscription|fragment|schema|type|input|enum|interface|union|scalar|directive|extend)\b[^=;]*[{(@]/m.test(t) && !/\b(const|let|var|function|=>|import|export)\b/.test(t)) return 'graphql'
  if (/^\s*(interface|enum)\s+\w+[^{]*\{[^}]*;/m.test(t)) return 'typescript'
  if (/^\s*(@(use|import|mixin|include|function)|\$[\w-]+\s*:)|^\s*[.#]?[\w-]+\s*\{[^}]*&:|@mixin|@include/m.test(t)) return 'scss'
  if (/^\s*@[\w-]+\s*:\s*[^;]+;|\.[\w-]+\s*\(.*\)\s*;?$/m.test(t) && /^\s*[.#@][\w-]/m.test(t) && !/\b(function|const|let)\b/.test(t)) return 'less'
  if (/^\s*[@.#:\w\][*>~+, -]+\s*\{\s*[\w-]+\s*:/m.test(t) && !/\b(function|const|let|var|=>|return)\b/.test(t)) return 'css'
  if (/^#{1,6}\s\S|^\s*[-*+]\s\S.*\n|^```|^\[[^\]]+\]\([^)]+\)|^>\s/m.test(t) && !/[;{}]\s*$/m.test(t)) return 'markdown'
  return 'javascript'
}

/** Turn a Prettier syntax error into a DevError with line and column. */
function toDevError(e, lang) {
  const text = String(e.message || e)
  const m = text.match(/\((\d+):(\d+)\)/)
  const line = e.loc?.start?.line ?? (m ? +m[1] : undefined)
  const col = e.loc?.start?.column ?? (m ? +m[2] : undefined)
  const first = text.split('\n')[0].replace(/\s*\(\d+:\d+\)\s*$/, '').replace(/^SyntaxError:\s*/, '').trim()
  return new DevError(`${LANGS[lang]?.label || 'Code'} syntax error: ${first}`, { line, col, hint: 'Fix the code at the marked line. Prettier only formats code that parses.' })
}

/**
 * Format with Prettier. o: {printWidth, tabWidth, useTabs, semi, singleQuote, trailingComma, proseWrap}
 * Throws DevError (with a position when Prettier gives one).
 */
export async function prettify(text, lang, o = {}) {
  const L = LANGS[lang]
  const [prettier, ...plugins] = await Promise.all([core(), ...L.plugins.map(plugin)])
  try {
    return await (prettier.format ? prettier : prettier.default).format(text, { parser: L.parser, plugins, ...o })
  } catch (e) {
    throw toDevError(e, lang)
  }
}
