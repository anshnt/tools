// Resume -> editable .docx (real bullet lists, right-aligned date tabs, clickable links) using the docx library.
import { docx } from '../../lib/libs.js'
import { contactItems, visibleSections, sectionLabel, periodOf, cleanBullets, skillItems, fullUrl, shortUrl } from './_resume.js'

const SIZE = { s: 0.93, m: 1, l: 1.07 }
const FONT = { modern: 'Calibri', classic: 'Georgia', compact: 'Arial' }
const PAGE = { a4: [11906, 16838], letter: [12240, 15840] }
const MARGIN = { modern: 900, classic: 1080, compact: 760 }
const hex = (c) => (c || '#0d9b8a').replace('#', '').toUpperCase()

export async function buildResumeDocx(r) {
  const D = await docx()
  const { Document, Packer, Paragraph, TextRun, TabStopType, AlignmentType, BorderStyle, LevelFormat, ExternalHyperlink, Tab, ShadingType } = D
  const st = r.style || {}
  const T = FONT[st.template] ? st.template : 'modern'
  const k = SIZE[st.size] || 1
  const font = FONT[T]
  const accent = hex(st.accent)
  const ink = '18181B', muted = '62666F'
  const [pw, ph] = PAGE[st.page] || PAGE.a4
  const mg = MARGIN[T]
  const cw = pw - mg * 2
  const hp = (pt) => Math.round(pt * 2 * k) // font size in half-points
  const body = T === 'compact' ? 9.3 : T === 'classic' ? 10.8 : 10
  const run = (text, o = {}) => new TextRun({ text, font, size: hp(o.size || body), bold: o.bold, italics: o.italic, color: o.color || ink })
  const link = (text, url, o = {}) => new ExternalHyperlink({ link: url, children: [new TextRun({ text, font, size: hp(o.size || body), color: o.color || accent, underline: {} })] })
  const sp = (before = 0, after = 0) => ({ before: Math.round(before * 20), after: Math.round(after * 20), line: T === 'compact' ? 252 : 270 })
  const out = []
  const c = r.contact

  // header
  const center = T === 'classic'
  if (c.name) out.push(new Paragraph({ alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: sp(0, 2), children: [run(c.name, { size: T === 'compact' ? 19 : T === 'classic' ? 23 : 26, bold: true, color: T === 'classic' ? ink : accent })] }))
  if (c.title) out.push(new Paragraph({ alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: sp(0, 3), children: [run(c.title, { size: T === 'compact' ? 10.2 : 12, italic: T === 'classic', color: muted })] }))
  const items = contactItems(c)
  if (items.length) {
    const kids = []
    items.forEach((it, i) => {
      if (i) kids.push(run('   |   ', { size: body - 0.6, color: 'A0A4AB' }))
      kids.push(it.url ? link(it.text, it.url, { size: body - 0.6, color: T === 'classic' ? ink : muted }) : run(it.text, { size: body - 0.6, color: muted }))
    })
    out.push(new Paragraph({ alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: sp(0, 4), children: kids }))
  }
  if (T === 'classic') out.push(new Paragraph({ spacing: sp(0, 0), border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ink, space: 1 } }, children: [] }))

  const heading = (label) => {
    const txt = label.toUpperCase()
    const base = { keepNext: true, spacing: sp(T === 'compact' ? 8 : 12, 4) }
    if (T === 'compact') out.push(new Paragraph({ ...base, shading: { type: ShadingType.CLEAR, fill: 'E3F3F1', color: 'auto' }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: accent, space: 4 } }, children: [run(txt, { size: 9.4, bold: true, color: accent })] }))
    else if (T === 'classic') out.push(new Paragraph({ ...base, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ink, space: 1 } }, children: [run(txt, { size: 11.2, bold: true })] }))
    else out.push(new Paragraph({ ...base, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 2 } }, children: [run(txt, { size: 10.2, bold: true, color: accent })] }))
  }
  const lr = (leftKids, right, o = {}) => out.push(new Paragraph({ keepNext: o.keepNext, spacing: sp(o.before || 0, 0), tabStops: [{ type: TabStopType.RIGHT, position: cw }], children: [...leftKids, ...(right ? [new TextRun({ children: [new Tab()], font }), run(right, { size: body - 0.6, color: muted, italic: T === 'classic' })] : [])] }))
  const bullets = (list) => {
    for (const b of cleanBullets(list)) out.push(new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: sp(0, 0), children: [run(b)] }))
  }
  const para = (children, o = {}) => out.push(new Paragraph({ spacing: sp(o.before || 0, o.after || 0), keepNext: o.keepNext, children }))

  const render = {
    summary: () => para([run(r.summary.trim())]),
    experience: () => r.experience.filter((e) => e.role || e.company).forEach((e, i) => {
      const where = [e.company, e.location].filter(Boolean).join(', ')
      const before = i ? (T === 'compact' ? 4 : 7) : 0
      if (T === 'classic') {
        lr([run(where || e.role, { bold: true, size: body + 0.4 })], periodOf(e), { before, keepNext: true })
        if (where && e.role) para([run(e.role, { italic: true })], { keepNext: true })
      } else if (T === 'compact') {
        lr([run(e.role, { bold: true }), ...(where ? [run(`  |  ${where}`, { color: muted })] : [])], periodOf(e), { before, keepNext: true })
      } else {
        lr([run(e.role || e.company, { bold: true, size: body + 0.7 })], periodOf(e), { before, keepNext: true })
        if (where && e.role) para([run(where, { bold: true, color: accent })], { keepNext: true })
      }
      bullets(e.bullets)
    }),
    education: () => r.education.filter((e) => e.school || e.degree).forEach((e, i) => {
      const deg = [e.degree, e.field].filter(Boolean).join(' in ')
      const loc = [e.school, e.location].filter(Boolean).join(', ')
      const before = i ? 5 : 0
      lr([run(loc || deg, { bold: true, size: body + 0.5 })], periodOf(e), { before, keepNext: !!(loc && deg) })
      const sub = [loc ? deg : '', e.grade].filter(Boolean).join('  |  ')
      if (sub) para([run(sub, { italic: T === 'classic', color: T === 'classic' ? ink : muted })])
      if (e.notes) para([run(e.notes)])
    }),
    skills: () => r.skills.filter((s) => s.items.trim()).forEach((s) => {
      const txt = skillItems(s).join(', ')
      para(s.group ? [run(`${s.group}: `, { bold: true }), run(txt)] : [run(txt)], { after: 1 })
    }),
    projects: () => r.projects.filter((p) => p.name).forEach((p, i) => {
      const before = i ? 5 : 0
      const kids = [run(p.name, { bold: true }), ...(p.tech ? [run(`  |  ${p.tech}`, { color: muted, italic: T === 'classic' })] : [])]
      if (p.link) kids.push(new TextRun({ children: [new Tab()], font }), link(shortUrl(p.link), fullUrl(p.link), { size: body - 0.6 }))
      out.push(new Paragraph({ keepNext: true, spacing: sp(before, 0), tabStops: [{ type: TabStopType.RIGHT, position: cw }], children: kids }))
      bullets(p.bullets)
    }),
    certifications: () => creds(r.certifications),
    awards: () => creds(r.awards),
    languages: () => para([run(r.languages.filter((l) => l.name).map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join('   |   '))]),
    links: () => {
      const kids = []
      r.links.filter((l) => l.url).forEach((l, i) => {
        if (i) kids.push(run('   |   ', { color: 'A0A4AB' }))
        kids.push(link(l.label ? `${l.label}: ${shortUrl(l.url)}` : shortUrl(l.url), fullUrl(l.url)))
      })
      para(kids)
    },
  }
  function creds(list) {
    list.filter((x) => x.name).forEach((x) => lr([run(x.name, { bold: true }), ...(x.issuer ? [run(`  |  ${x.issuer}`, { color: muted })] : [])], x.date))
  }
  for (const id of visibleSections(r)) { heading(sectionLabel(id)); render[id]() }
  if (!out.length) out.push(new Paragraph({ children: [run('Your resume is empty.')] }))

  const doc = new Document({
    creator: c.name || 'Tools', title: `${c.name || 'Resume'} - Resume`, description: c.title || 'Resume',
    styles: { default: { document: { run: { font, size: hp(body), color: ink } } } },
    numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 340, hanging: 220 } } } }] }] },
    sections: [{ properties: { page: { size: { width: pw, height: ph }, margin: { top: mg - 100, bottom: mg - 100, left: mg, right: mg } } }, children: out }],
  })
  return Packer.toBlob(doc)
}
