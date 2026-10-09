// Resume -> PDF with real selectable text (jsPDF text API, wrapping, page breaks, clickable links).
import { newDoc, Writer, hexRgb, tint, winAnsi, unsupportedChars } from './_pdf.js'
import { contactItems, visibleSections, sectionLabel, periodOf, cleanBullets, skillItems, fullUrl, shortUrl } from './_resume.js'

export const TEMPLATES = {
  modern: { name: 'Modern', blurb: 'Accent headings, left aligned', font: 'helvetica', margin: [44, 48, 44, 48] },
  classic: { name: 'Classic', blurb: 'Serif, centered header', font: 'times', margin: [50, 56, 50, 56] },
  compact: { name: 'Compact', blurb: 'Tight, fits more on a page', font: 'helvetica', margin: [34, 38, 34, 38] },
}
const SIZES = { s: 0.93, m: 1, l: 1.07 }
const INK = [24, 24, 27]
const MUTED = [98, 102, 112]

export function textIssues(r) {
  const all = JSON.stringify(r)
  return unsupportedChars(all)
}

/** Build the PDF. Resolves {blob, pages}. */
export async function buildResumePdf(r) {
  const st = r.style || {}
  const T = TEMPLATES[st.template] ? st.template : 'modern'
  const k = SIZES[st.size] || 1
  const accent = hexRgb(st.accent)
  const c = r.contact
  const doc = await newDoc({ page: st.page, title: `${c.name || 'Resume'} - Resume`, author: c.name, subject: c.title || 'Resume' })
  const w = new Writer(doc, { margin: TEMPLATES[T].margin, font: TEMPLATES[T].font })

  const body = { size: (T === 'compact' ? 9.3 : T === 'classic' ? 10.8 : 10) * k, color: INK }
  const small = { ...body, size: body.size - 0.6, color: MUTED }
  const bold = { ...body, bold: true }
  const lhBody = T === 'compact' ? 1.22 : 1.32
  const headColor = T === 'classic' ? INK : accent

  // ---------- header ----------
  const items = contactItems(c)
  if (T === 'classic') {
    if (c.name) w.para(c.name, { size: 23 * k, bold: true, color: INK }, { align: 'center', lh: 1.15 })
    if (c.title) w.para(c.title, { size: 11.5 * k, italic: true, color: MUTED }, { align: 'center', gapAfter: 1 })
    if (items.length) w.inline(items, { size: 9.8 * k, color: INK }, { align: 'center', sep: '   |   ' })
    w.space(5)
    w.rule(INK, 0.9)
    w.space(2)
  } else if (T === 'compact') {
    w.runs([{ text: c.name || 'Your Name', st: { size: 19 * k, bold: true, color: accent } }], { right: c.title, stR: { size: 10.2 * k, color: MUTED }, lh: 1.2 })
    if (items.length) w.inline(items, { size: 8.8 * k, color: MUTED }, { sep: '   |   ' })
    w.space(4)
  } else {
    w.para(c.name || 'Your Name', { size: 26 * k, bold: true, color: accent }, { lh: 1.12 })
    if (c.title) w.para(c.title, { size: 12.5 * k, color: MUTED }, { gapAfter: 2 })
    if (items.length) w.inline(items, { size: 9.4 * k, color: MUTED }, { sep: '   |   ' })
    w.space(2)
  }

  // ---------- helpers ----------
  const heading = (label) => {
    const before = T === 'compact' ? 8 : 13
    w.keep(before + 46)
    if (w.y > w.m.t + 1) w.space(before)
    const txt = label.toUpperCase()
    if (T === 'compact') {
      const h = 14.5 * k
      w.rect(w.x, w.y, w.cw, h, tint(accent, 0.88))
      w.rect(w.x, w.y, 2.6, h, accent)
      w.style({ size: 9.4 * k, bold: true, color: accent })
      doc.text(txt, w.x + 7, w.y + h * 0.72)
      w.y += h + 4
    } else if (T === 'classic') {
      w.para(txt, { size: 11.2 * k, bold: true, color: INK }, { lh: 1.2 })
      w.rule(INK, 0.5)
      w.space(5)
    } else {
      w.para(txt, { size: 10.2 * k, bold: true, color: headColor }, { lh: 1.2 })
      w.space(1)
      w.rule(tint(accent, 0.55), 0.9)
      w.space(5)
    }
  }
  const bullets = (list) => {
    for (const b of cleanBullets(list)) w.bullet(b, body, { lh: lhBody, indent: 12 })
  }
  const period = (e) => periodOf(e)

  // ---------- sections ----------
  const render = {
    summary() {
      w.para(r.summary.trim(), body, { lh: lhBody })
    },
    experience() {
      const list = r.experience.filter((e) => e.role || e.company)
      list.forEach((e, i) => {
        w.keep(body.size * lhBody * 3.2)
        if (i) w.space(T === 'compact' ? 4 : 7)
        const where = [e.company, e.location].filter(Boolean).join(', ')
        if (T === 'classic') {
          w.lr(where || e.role, period(e), { ...bold, size: body.size + 0.4 }, { ...small, italic: true }, { lh: lhBody })
          if (where && e.role) w.para(e.role, { ...body, italic: true }, { lh: lhBody })
        } else if (T === 'compact') {
          w.runs([{ text: e.role, st: bold }, ...(where ? [{ text: `  |  ${where}`, st: { ...body, color: MUTED } }] : [])], { right: period(e), stR: small, lh: lhBody })
        } else {
          w.lr(e.role || e.company, period(e), { ...bold, size: body.size + 0.7 }, small, { lh: lhBody })
          if (where && e.role) w.para(where, { ...body, bold: true, color: accent }, { lh: lhBody })
        }
        bullets(e.bullets)
      })
    },
    education() {
      const list = r.education.filter((e) => e.school || e.degree)
      list.forEach((e, i) => {
        w.keep(body.size * lhBody * 2.6)
        if (i) w.space(T === 'compact' ? 3 : 6)
        const deg = [e.degree, e.field].filter(Boolean).join(' in ')
        const loc = [e.school, e.location].filter(Boolean).join(', ')
        if (T === 'compact') {
          w.runs([{ text: loc || deg, st: bold }, ...(loc && deg ? [{ text: `  |  ${deg}${e.grade ? `  |  ${e.grade}` : ''}`, st: { ...body, color: MUTED } }] : [])], { right: period(e), stR: small, lh: lhBody })
        } else {
          w.lr(loc || deg, period(e), { ...bold, size: body.size + 0.5 }, small, { lh: lhBody })
          const sub = [loc ? deg : '', e.grade].filter(Boolean).join('  |  ')
          if (sub) w.para(sub, T === 'classic' ? { ...body, italic: true } : { ...body, color: MUTED }, { lh: lhBody })
        }
        if (e.notes) w.para(e.notes, body, { lh: lhBody })
      })
    },
    skills() {
      for (const s of r.skills.filter((x) => x.items.trim())) {
        const txt = skillItems(s).join(', ')
        if (s.group) w.labelPara(`${s.group}: `, txt, bold, body, { lh: lhBody })
        else w.para(txt, body, { lh: lhBody })
        w.space(1)
      }
    },
    projects() {
      r.projects.filter((p) => p.name).forEach((p, i) => {
        w.keep(body.size * lhBody * 3)
        if (i) w.space(T === 'compact' ? 3 : 6)
        const link = p.link ? shortUrl(p.link) : ''
        w.runs([{ text: p.name, st: bold }, ...(p.tech ? [{ text: `  |  ${p.tech}`, st: { ...body, color: MUTED, italic: T === 'classic' } }] : [])], { right: link, stR: { ...small, color: T === 'classic' ? INK : accent }, rightLink: p.link ? fullUrl(p.link) : '', lh: lhBody })
        bullets(p.bullets)
      })
    },
    certifications() { creds(r.certifications) },
    awards() { creds(r.awards) },
    languages() {
      const txt = r.languages.filter((l) => l.name).map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join('   |   ')
      w.para(txt, body, { lh: lhBody })
    },
    links() {
      w.inline(r.links.filter((l) => l.url).map((l) => ({ text: l.label ? `${l.label}: ${shortUrl(l.url)}` : shortUrl(l.url), url: fullUrl(l.url) })), { ...body, color: T === 'classic' ? INK : accent }, { sep: '   |   ' })
    },
  }
  function creds(list) {
    list.filter((x) => x.name).forEach((x) => {
      w.runs([{ text: x.name, st: bold }, ...(x.issuer ? [{ text: `  |  ${x.issuer}`, st: { ...body, color: MUTED } }] : [])], { right: x.date, stR: small, lh: lhBody })
    })
  }

  for (const id of visibleSections(r)) {
    heading(sectionLabel(id))
    render[id]()
  }
  if (!visibleSections(r).length && !c.name) w.para('Start filling in your details on the left and your resume will appear here.', { size: 11, color: MUTED }, { align: 'center' })

  return { blob: doc.output('blob'), pages: w.pages, doc }
}

export { winAnsi }
