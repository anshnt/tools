// The site catalog: categories + every pack's tool list. Packs own their entries in packs/<pack>/catalog.js.
// Entry fields: id, name, desc, icon, cat?, also?, module?, params?, mode?, tags?, ready?
import pdfEdit, * as pdfEditMeta from '../packs/pdf-edit/catalog.js'
import pdfConvert, * as pdfConvertMeta from '../packs/pdf-convert/catalog.js'
import pdfPages, * as pdfPagesMeta from '../packs/pdf-pages/catalog.js'
import textUtils, * as textUtilsMeta from '../packs/text-utils/catalog.js'
import textWrite, * as textWriteMeta from '../packs/text-write/catalog.js'
import imageEdit, * as imageEditMeta from '../packs/image-edit/catalog.js'
import imageAi, * as imageAiMeta from '../packs/image-ai/catalog.js'
import imageStudio, * as imageStudioMeta from '../packs/image-studio/catalog.js'
import mediaConvert, * as mediaConvertMeta from '../packs/media-convert/catalog.js'
import mediaCapture, * as mediaCaptureMeta from '../packs/media-capture/catalog.js'
import data, * as dataMeta from '../packs/data/catalog.js'
import calcMoney, * as calcMoneyMeta from '../packs/calc-money/catalog.js'
import calcTime, * as calcTimeMeta from '../packs/calc-time/catalog.js'
import career, * as careerMeta from '../packs/career/catalog.js'
import student, * as studentMeta from '../packs/student/catalog.js'
import web, * as webMeta from '../packs/web/catalog.js'
import security, * as securityMeta from '../packs/security/catalog.js'
import devFormat, * as devFormatMeta from '../packs/dev-format/catalog.js'
import devUtils, * as devUtilsMeta from '../packs/dev-utils/catalog.js'
import personal, * as personalMeta from '../packs/personal/catalog.js'
import files, * as filesMeta from '../packs/files/catalog.js'
import screen, * as screenMeta from '../packs/screen/catalog.js'
import india, * as indiaMeta from '../packs/india/catalog.js'
import ai, * as aiMeta from '../packs/ai/catalog.js'

export const CATEGORIES = [
  { id: 'pdf', name: 'PDF', title: 'PDF tools', icon: 'file-text', color: '#e5484d', blurb: 'Merge, split, compress, convert, sign and secure PDFs.' },
  { id: 'image', name: 'Image', title: 'Image tools', icon: 'image', color: '#d6409f', blurb: 'Resize, compress, convert, remove backgrounds and more.' },
  { id: 'media', name: 'Video & Audio', title: 'Video & audio tools', icon: 'clapperboard', color: '#8e4ec6', blurb: 'Convert, trim, compress, record and transcribe.' },
  { id: 'text', name: 'Text & Writing', title: 'Text & writing tools', icon: 'type', color: '#3e63dd', blurb: 'Counters, converters, cleaners, grammar and speech.' },
  { id: 'data', name: 'Excel & Data', title: 'Excel & data tools', icon: 'sheet', color: '#30a46c', blurb: 'CSV, Excel and JSON conversion, cleaning and charts.' },
  { id: 'calc', name: 'Calculators', title: 'Calculators & converters', icon: 'calculator', color: '#f76b15', blurb: 'Money, dates, units, percentages and everyday maths.' },
  { id: 'dev', name: 'Developer', title: 'Developer tools', icon: 'code', color: '#6e56cf', blurb: 'Formatters, encoders, regex, JWT, cron and API helpers.' },
  { id: 'security', name: 'Security', title: 'Security & privacy tools', icon: 'shield', color: '#12a594', blurb: 'Passwords, hashes, encryption and privacy cleanup.' },
  { id: 'web', name: 'Web & Internet', title: 'Web & internet tools', icon: 'globe', color: '#0090ff', blurb: 'QR codes, links, screenshots and network lookups.' },
  { id: 'files', name: 'Files', title: 'File & folder tools', icon: 'folder', color: '#6f6e77', blurb: 'Inspect, compare, rename, zip and search local files.' },
  { id: 'screen', name: 'Screen & Browser', title: 'Screen & browser tools', icon: 'monitor', color: '#7c66dc', blurb: 'Screenshots, color picker, rulers and floating helpers.' },
  { id: 'career', name: 'Work & Career', title: 'Work & career tools', icon: 'briefcase', color: '#0d9b8a', blurb: 'Resumes, cover letters, emails, meetings and slides.' },
  { id: 'student', name: 'Student', title: 'Student tools', icon: 'graduation-cap', color: '#e2a336', blurb: 'Notes, flashcards, quizzes, citations and maths.' },
  { id: 'personal', name: 'Everyday Life', title: 'Everyday life tools', icon: 'heart', color: '#e54666', blurb: 'Lists, planners, budgets, timers and health.' },
  { id: 'india', name: 'India', title: 'India tools', icon: 'landmark', color: '#ef7d1a', blurb: 'Govt form photos, income tax, GST, IFSC, PIN and more.' },
  { id: 'ai', name: 'AI', title: 'AI tools', icon: 'sparkles', color: '#8b5cf6', blurb: 'Summarize, chat with PDFs, extract data and more with Claude.' },
]

const PACKS = [
  ['pdf-edit', pdfEdit, pdfEditMeta], ['pdf-convert', pdfConvert, pdfConvertMeta], ['pdf-pages', pdfPages, pdfPagesMeta],
  ['text-utils', textUtils, textUtilsMeta], ['text-write', textWrite, textWriteMeta],
  ['image-edit', imageEdit, imageEditMeta], ['image-ai', imageAi, imageAiMeta], ['image-studio', imageStudio, imageStudioMeta],
  ['media-convert', mediaConvert, mediaConvertMeta], ['media-capture', mediaCapture, mediaCaptureMeta],
  ['data', data, dataMeta], ['calc-money', calcMoney, calcMoneyMeta], ['calc-time', calcTime, calcTimeMeta],
  ['career', career, careerMeta], ['student', student, studentMeta], ['web', web, webMeta], ['security', security, securityMeta],
  ['dev-format', devFormat, devFormatMeta], ['dev-utils', devUtils, devUtilsMeta], ['personal', personal, personalMeta],
  ['files', files, filesMeta], ['screen', screen, screenMeta], ['india', india, indiaMeta], ['ai', ai, aiMeta],
]

export const TOOLS = PACKS.flatMap(([pack, list, meta]) => list.map((t) => ({
  mode: meta.mode || 'local',
  ...t,
  pack,
  cat: t.cat || meta.cat,
  module: t.module || t.id,
  also: t.also || [],
  ready: !!t.ready,
})))

export const byId = new Map(TOOLS.map((t) => [t.id, t]))
export const catById = new Map(CATEGORIES.map((c) => [c.id, c]))
export const toolsIn = (cat) => TOOLS.filter((t) => t.cat === cat || t.also.includes(cat))

/** Shown first on the home page. */
export const POPULAR = [
  'merge-pdf', 'compress-pdf', 'pdf-to-word', 'image-to-pdf', 'compress-image', 'image-to-kb', 'remove-background', 'resize-image',
  'heic-to-jpg', 'video-to-mp3', 'qr-generator', 'json-formatter', 'word-counter', 'password-generator', 'emi-calculator',
  'income-tax-calculator', 'govt-photo-resizer', 'unit-converter', 'pdf-summary', 'screen-recorder', 'age-calculator', 'sign-pdf',
  'case-converter', 'currency-converter',
]

export const MODES = {
  local: { label: 'On-device', icon: 'shield-check', cls: 'local', title: 'Runs entirely in your browser. Your files never leave your device.' },
  model: { label: 'On-device AI', icon: 'cpu', cls: 'model', title: 'Runs an AI model in your browser. The model downloads once; your files stay on your device.' },
  online: { label: 'Online', icon: 'cloud', cls: 'online', title: 'Uses a public web service for lookups. Only what you type is sent.' },
  ai: { label: 'Claude AI', icon: 'sparkles', cls: 'ai', title: 'Uses Claude with your own Anthropic API key. Content you submit is sent to Anthropic.' },
}

/** Simple ranked search over name, tags, description and category. */
export function search(query, list = TOOLS) {
  const q = query.toLowerCase().trim()
  if (!q) return list
  const terms = q.split(/[\s/]+/).map((s) => s.replace(/[^\p{L}\p{N}.+#-]/gu, '')).filter(Boolean)
  if (!terms.length) return []
  const scored = []
  for (const t of list) {
    const name = t.name.toLowerCase()
    const hay = `${name} ${t.tags || ''} ${t.desc} ${catById.get(t.cat)?.name || ''} ${t.id}`.toLowerCase()
    let score = 0
    let all = true
    for (const term of terms) {
      if (!hay.includes(term)) { all = false; break }
      score += name.startsWith(term) ? 6 : name.includes(term) ? 4 : (t.tags || '').toLowerCase().includes(term) ? 2 : 1
    }
    if (!all) continue
    if (name === q) score += 20
    else if (name.startsWith(q)) score += 8
    if (t.ready) score += 1.5
    scored.push([score, t])
  }
  return scored.sort((a, b) => b[0] - a[0]).map((s) => s[1])
}
