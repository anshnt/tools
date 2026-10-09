// Simple document builder: an array of blocks becomes a real-text PDF or an editable .docx. Used by letters and notes.
// Blocks: {t:'name'|'title'|'h'|'p'|'li'|'meta'|'rule'|'space'|'kv', text, label?, h?}
import { docx } from '../../lib/libs.js'
import { newDoc, Writer, hexRgb } from './_pdf.js'

const INK = [24, 24, 27], MUTED = [98, 102, 112]

export async function blocksToPdf(blocks, { font = 'helvetica', accent = '#0d9b8a', size = 11, page = 'a4', title = '', author = '', margin = 64 } = {}) {
  const doc = await newDoc({ page, title, author })
  const w = new Writer(doc, { margin: [margin - 8, margin, margin - 8, margin], font })
  const acc = hexRgb(accent)
  for (const b of blocks) {
    const text = b.text ?? ''
    switch (b.t) {
      case 'name': w.para(text, { size: size + 11, bold: true, color: acc }, { lh: 1.15, gapAfter: 2 }); break
      case 'title': w.para(text, { size: size + 7, bold: true, color: INK }, { lh: 1.2, gapAfter: 4 }); break
      case 'h': w.space(6); w.keep(40); w.para(text.toUpperCase(), { size: size - 1, bold: true, color: acc }, { lh: 1.3 }); w.rule([210, 214, 220], 0.7); w.space(5); break
      case 'meta': w.para(text, { size: size - 1, color: MUTED }, { lh: 1.4 }); break
      case 'kv': w.labelPara(`${b.label}: `, text, { size, bold: true, color: INK }, { size, color: INK }, { lh: 1.4 }); break
      case 'li': w.bullet(text, { size, color: INK }, { lh: 1.4, indent: 14 }); break
      case 'rule': w.space(4); w.rule([200, 204, 210], 0.8); w.space(8); break
      case 'space': w.space(b.h ?? size); break
      default:
        for (const para of text.split('\n')) { if (para.trim()) w.para(para, { size, color: INK, bold: b.bold }, { lh: 1.45 }); else w.space(size * 0.9) }
        w.space(size * 0.85)
    }
  }
  return doc.output('blob')
}

export async function blocksToDocx(blocks, { font = 'Calibri', accent = '#0d9b8a', size = 11, page = 'a4', title = '', author = '' } = {}) {
  const D = await docx()
  const { Document, Packer, Paragraph, TextRun, BorderStyle, LevelFormat, AlignmentType } = D
  const acc = accent.replace('#', '').toUpperCase()
  const hp = (n) => Math.round(n * 2)
  const run = (text, o = {}) => new TextRun({ text, font, size: hp(o.size || size), bold: o.bold, color: o.color || '18181B' })
  const out = []
  for (const b of blocks) {
    const text = b.text ?? ''
    switch (b.t) {
      case 'name': out.push(new Paragraph({ spacing: { after: 40 }, children: [run(text, { size: size + 11, bold: true, color: acc })] })); break
      case 'title': out.push(new Paragraph({ spacing: { after: 80 }, children: [run(text, { size: size + 7, bold: true })] })); break
      case 'h': out.push(new Paragraph({ keepNext: true, spacing: { before: 200, after: 100 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D2D6DC', space: 2 } }, children: [run(text.toUpperCase(), { size: size - 1, bold: true, color: acc })] })); break
      case 'meta': out.push(new Paragraph({ spacing: { after: 20 }, children: [run(text, { size: size - 1, color: '62666F' })] })); break
      case 'kv': out.push(new Paragraph({ spacing: { after: 40 }, children: [run(`${b.label}: `, { bold: true }), run(text)] })); break
      case 'li': out.push(new Paragraph({ numbering: { reference: 'bul', level: 0 }, spacing: { after: 40 }, children: [run(text)] })); break
      case 'rule': out.push(new Paragraph({ spacing: { before: 60, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'C8CCD2', space: 1 } }, children: [] })); break
      case 'space': out.push(new Paragraph({ spacing: { after: Math.round((b.h ?? size) * 20) }, children: [] })); break
      default:
        for (const para of text.split('\n')) out.push(new Paragraph({ spacing: { after: para.trim() ? 160 : 40, line: 300 }, children: para.trim() ? [run(para, { bold: b.bold })] : [] }))
    }
  }
  const [pw, ph] = page === 'letter' ? [12240, 15840] : [11906, 16838]
  const d = new Document({
    creator: author || 'Tools', title,
    styles: { default: { document: { run: { font, size: hp(size) } } } },
    numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] }] },
    sections: [{ properties: { page: { size: { width: pw, height: ph }, margin: { top: 1200, bottom: 1200, left: 1300, right: 1300 } } }, children: out }],
  })
  return Packer.toBlob(d)
}
