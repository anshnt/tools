// Pack career: resumes, letters, emails, meetings and presentations. Default category: career.
export const cat = 'career'
export default [
  { id: 'resume-builder', name: 'Resume / CV builder', desc: 'Build a clean resume with live preview and export to PDF or Word.', icon: 'file-user', tags: 'cv resume builder template' },
  { id: 'resume-to-pdf', name: 'Resume to PDF', module: 'resume-builder', params: { export: 'pdf' }, desc: 'Turn your resume content into a polished, ATS-friendly PDF.', icon: 'file-down', tags: 'cv pdf export' },
  { id: 'resume-to-word', name: 'Resume to Word', module: 'resume-builder', params: { export: 'docx' }, desc: 'Export your resume as an editable .docx file.', icon: 'file-type', tags: 'cv docx export' },
  { id: 'resume-formatter', name: 'Resume formatter', module: 'resume-builder', params: { import: true }, also: ['text'], desc: 'Paste an existing resume and reformat it into a clean template.', icon: 'wand-sparkles', tags: 'reformat cv clean template' },
  { id: 'ats-checker', name: 'Resume ATS checker', desc: 'Score your resume against a job description and find missing keywords.', icon: 'scan-search', tags: 'ats keywords score job match' },
  { id: 'cover-letter', name: 'Cover letter generator', desc: 'Draft a tailored cover letter from templates or with AI.', icon: 'mail-open', tags: 'cover letter application' },
  { id: 'jd-analyzer', name: 'Job description analyzer', desc: 'Pull out skills, requirements, red flags and keywords from a JD.', icon: 'file-search', tags: 'job description skills keywords' },
  { id: 'linkedin-bio', name: 'LinkedIn bio generator', desc: 'Write a strong headline and About section with templates or AI.', icon: 'user-round-pen', tags: 'linkedin headline about summary' },
  { id: 'email-generator', name: 'Email generator', desc: 'Professional emails for common situations: leave, follow-up, request and more.', icon: 'mail-plus', tags: 'email template professional' },
  { id: 'email-rewriter', name: 'Email rewriter', desc: 'Make an email clearer, politer, shorter or more formal.', icon: 'pen-line', mode: 'ai', tags: 'rewrite tone polite formal' },
  { id: 'meeting-notes', name: 'Meeting notes generator', desc: 'Structured notes with agenda, decisions and action items; export to doc.', icon: 'notebook-pen', tags: 'minutes mom action items' },
  { id: 'presentation-generator', name: 'Presentation generator', desc: 'Turn an outline or notes into a .pptx slide deck.', icon: 'presentation', also: ['ai', 'student'], tags: 'ppt pptx slides deck text to presentation' },
  { id: 'invoice-generator', name: 'Invoice generator', desc: 'Create GST or simple invoices and download a PDF.', icon: 'receipt', also: ['india'], tags: 'invoice bill gst freelance' },
  { id: 'email-signature', name: 'Email signature generator', desc: 'Design an HTML email signature for Gmail and Outlook.', icon: 'pen-tool', tags: 'signature gmail outlook html' },
  { id: 'business-card', name: 'Business card maker', desc: 'Design a printable business card with a QR code.', icon: 'contact', tags: 'visiting card print qr' },
]
