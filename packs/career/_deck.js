// Outline -> slides model shared by the live preview and the .pptx export. Pure logic (no DOM).
// Outline syntax: "# Deck title" (title slide), "## Slide title", "- bullets" (indent to nest), "1. numbered", "### Sub heading",
// "Notes: ..." or "> ..." for speaker notes, a second "# Heading" makes a section divider.

export const THEMES = {
  aurora: { name: 'Aurora', blurb: 'Dark gradient, violet and pink', dark: true, bg: ['#0f1024', '#2b1a52'], text: 'F5F5FF', muted: 'B9B6D9', accent: 'A78BFA', accent2: 'F472B6', head: 'Calibri', body: 'Calibri' },
  paper: { name: 'Paper', blurb: 'Clean white with a teal accent', dark: false, bg: ['#ffffff', '#ffffff'], text: '18181B', muted: '5B616B', accent: '0D9B8A', accent2: '7C5CF0', head: 'Georgia', body: 'Calibri', panel: 'E7F6F4' },
  sunset: { name: 'Sunset', blurb: 'Warm cream with orange and rose', dark: false, bg: ['#fff7ed', '#ffe8d2'], text: '3B1D0F', muted: '8A5A44', accent: 'F97316', accent2: 'E11D48', head: 'Georgia', body: 'Calibri', panel: 'FFE1C7' },
  mono: { name: 'Mono', blurb: 'Black and white with a lime pop', dark: true, bg: ['#0c0c0c', '#1a1a1a'], text: 'FAFAFA', muted: 'A3A3A3', accent: 'D4FF3A', accent2: 'FFFFFF', head: 'Arial', body: 'Arial' },
}

const inline = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')

/** Split text with **bold**, *italic* and `code` into runs [{text, bold?, italic?, code?}]. */
export function runs(text) {
  const out = []
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    const t = m[0]
    if (t.startsWith('**') || t.startsWith('__')) out.push({ text: t.slice(2, -2), bold: true })
    else if (t.startsWith('`')) out.push({ text: t.slice(1, -1), code: true })
    else out.push({ text: t.slice(1, -1), italic: true })
    last = m.index + t.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out.length ? out : [{ text: '' }]
}
export const plain = (s) => runs(s).map((r) => r.text).join('')

/** Parse an outline into slides: [{type, title, subtitle, items:[{text, level, num?, label?}], notes}]. */
export function parseOutline(md) {
  const slides = []
  let cur = null
  let seenTitle = false
  const push = (s) => { cur = { type: 'content', title: '', subtitle: '', items: [], notes: '', ...s }; slides.push(cur); return cur }
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    let m
    if ((m = line.match(/^#\s+(.+)$/))) {
      if (!seenTitle) { push({ type: 'title', title: inline(m[1]).trim() }); seenTitle = true } else push({ type: 'section', title: inline(m[1]).trim() })
      continue
    }
    if ((m = line.match(/^##\s+(.+)$/))) { push({ type: 'content', title: inline(m[1]).trim() }); seenTitle ||= false; continue }
    if (!cur) { push({ type: 'title', title: 'Untitled presentation' }); seenTitle = true }
    if ((m = line.match(/^\s*(?:notes?|speaker notes?)\s*:\s*(.*)$/i)) || (m = line.match(/^>\s?(.*)$/))) { cur.notes = [cur.notes, m[1].trim()].filter(Boolean).join('\n'); continue }
    if ((m = line.match(/^###\s+(.+)$/))) { cur.items.push({ text: inline(m[1]).trim(), level: 0, label: true }); continue }
    if (/^---+$/.test(line.trim())) { push({ type: 'content', title: '' }); continue }
    const b = line.match(/^(\s*)(?:([-*+•])|(\d{1,3})[.)])\s+(.+)$/)
    if (b) {
      const level = Math.min(2, Math.floor(b[1].replace(/\t/g, '  ').length / 2))
      cur.items.push({ text: inline(b[4]).trim(), level, num: b[3] ? +b[3] : undefined })
      continue
    }
    if (cur.type === 'title' || cur.type === 'section') cur.subtitle = [cur.subtitle, inline(line.trim())].filter(Boolean).join(' ')
    else cur.items.push({ text: inline(line.trim()), level: 0, plain: true })
  }
  return slides
}

/** Split crowded content slides into "(cont.)" slides. */
export function paginate(slides, { maxItems = 7, maxChars = 560 } = {}) {
  const out = []
  for (const s of slides) {
    if (s.type !== 'content') { out.push(s); continue }
    const chunks = []
    let cur = [], chars = 0
    for (const it of s.items) {
      if (cur.length && (cur.filter((x) => !x.label).length >= maxItems || chars + it.text.length > maxChars) && it.level === 0 && !it.label) { chunks.push(cur); cur = []; chars = 0 }
      cur.push(it); chars += it.text.length
    }
    if (cur.length || !chunks.length) chunks.push(cur)
    chunks.forEach((items, i) => out.push({ ...s, items, title: i ? `${s.title} (cont.)` : s.title, notes: i ? '' : s.notes }))
  }
  return out
}

/** Body font size (pt) for a content slide, shrinking with the amount of text. */
export function bodySize(s) {
  const chars = s.items.reduce((n, it) => n + it.text.length, 0)
  const n = s.items.length
  if (n <= 3 && chars < 170) return 28
  if (chars < 260 && n <= 5) return 25
  if (chars < 400) return 22
  if (chars < 520) return 19
  return 17
}
export const titleSize = (t) => (t.length > 60 ? 28 : t.length > 40 ? 32 : 36)

export const STARTERS = [
  { id: 'pitch', name: 'Startup pitch', icon: 'rocket', md: `# Acme Robotics\nAutomating the warehouse floor\nNotes: Open with the story of the founding team and why now.\n\n## The problem\n- Warehouses lose 18% of labor hours to repetitive picking\n- Staff turnover above 40% a year\n- Peak season demand spikes 3x\nNotes: Use one customer quote here.\n\n## Our solution\n- **PickBot**: a mobile robot that learns your layout in a day\n- Works with existing shelves and WMS software\n- Pays back in under 10 months\n\n## Traction\n- 12 paying customers across 3 countries\n- $1.4M in annual recurring revenue\n- 96% pilot to contract conversion\n\n## Business model\n1. Robot subscription per unit per month\n2. Software platform fee per site\n3. Premium support and analytics\n\n## The ask\n- Raising $4M seed\n- Hiring 6 engineers and 2 sales leads\n- 18 months of runway to reach Series A metrics\n` },
  { id: 'update', name: 'Project update', icon: 'activity', md: `# Checkout Rebuild: Status Update\nQ4 review for the leadership team\n\n## Where we are\n- On track for the 15 November launch\n- 8 of 11 milestones complete\n- Budget at 82% with 78% of scope done\nNotes: Highlight that scope is slightly ahead of spend.\n\n## Wins this month\n- Payment form shipped to staging\n- Load test passed at 5x expected traffic\n- Conversion in the beta cohort is up 14%\n\n## Risks\n- Legal sign-off on new terms is pending\n- One engineer is out for two weeks\n  - Mitigation: pairing plan agreed\n\n## Next steps\n1. Security review (week 1)\n2. Rollout to 10% of users (week 2)\n3. Full launch (week 4)\n` },
  { id: 'lesson', name: 'Lesson or workshop', icon: 'graduation-cap', md: `# Intro to Data Visualization\nA 45 minute workshop\n\n## Learning goals\n- Pick the right chart for your data\n- Remove clutter and highlight the story\n- Avoid the five most common mistakes\n\n## Choosing a chart\n### Compare\n- Bar charts for categories\n### Trend\n- Line charts for time\n### Parts of a whole\n- Stacked bars, not pie charts, when parts are many\n\n## Activity\n- In pairs, redraw the sample chart in 10 minutes\n- Share one change you made and why\nNotes: Walk around and ask pairs to explain their choices.\n\n## Key takeaways\n- Start with the question, then the chart\n- Less ink, more insight\n- Always label the message in the title\n` },
  { id: 'review', name: 'Quarterly review', icon: 'chart-no-axes-combined', md: `# Q3 Business Review\nSales and Marketing\n\n## Highlights\n- Revenue: **$2.4M**, up 18% quarter on quarter\n- New customers: 142\n- Net revenue retention: 112%\n\n## What worked\n- Webinar series generated 31% of qualified leads\n- Partner channel doubled in size\n\n## What did not\n- Outbound reply rates fell to 2.1%\n- Onboarding time grew to 21 days\n\n## Q4 priorities\n1. Fix onboarding to under 14 days\n2. Launch the annual plan\n3. Expand into two new regions\n` },
  { id: 'launch', name: 'Product launch', icon: 'sparkles', md: `# Introducing Nova\nOur biggest release yet\n\n## Why we built it\n- Customers told us reporting takes hours\n- Nova turns raw data into answers in seconds\n\n## What is new\n- **Instant dashboards** from any spreadsheet\n- **Alerts** when a metric moves\n- **Sharing** with one click\n\n## Pricing and availability\n- Free for up to 3 users\n- Team plan at $12 per user per month\n- Available worldwide today\n\n## Get started\n- Visit nova.example.com\n- Book a 20 minute walkthrough\n` },
]

/** Plain notes without markdown headings -> an outline. */
export function structurePlain(text) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  if (!paras.length) return ''
  const first = paras[0].split('\n')
  const title = first[0].replace(/^#+\s*/, '')
  const out = [`# ${title}`, ...(first.slice(1).length ? [first.slice(1).join(' ')] : [])]
  for (const p of paras.slice(1)) {
    const lines = p.split('\n').map((l) => l.trim()).filter(Boolean)
    const head = lines.length > 1 && lines[0].length <= 60 && !/^[-*•\d]/.test(lines[0]) ? lines.shift() : lines[0].split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:]+$/, '')
    out.push('', `## ${head.replace(/[.:]+$/, '')}`)
    const items = lines.flatMap((l) => (/^[-*•\d]/.test(l) ? [l.replace(/^[-*•\d.)\s]+/, '')] : l.split(/(?<=[.!?])\s+/)))
    for (const it of items.filter(Boolean)) out.push(`- ${it.replace(/[.]+$/, '')}`)
  }
  return out.join('\n')
}
