// Pack studio-docs: Docs, a browser editor in the spirit of Microsoft Word (see the open-source WordCraft by ArtCraft:
// https://github.com/storytold/wordcraft). Default category: studio.
export const cat = 'studio'
export default [
  { id: 'docs-studio', name: 'Docs', desc: 'Write documents with styles, tables and images on A4 or Letter pages. Open and save Word, PDF, Markdown and HTML.', icon: 'file-text', layout: 'app', tags: 'word alternative document editor docx writer processor', ready: true },
  { id: 'docs-resume', name: 'Resume Writer', desc: 'Start from a clean resume layout, edit it like a Word document, then download DOCX or PDF.', icon: 'briefcase', layout: 'app', module: 'docs-studio', params: { template: 'resume' }, tags: 'cv resume template word docx writer', ready: true },
  { id: 'docs-letter', name: 'Letter Writer', desc: 'A formal letter layout with sender, recipient and subject. Edit it, then download DOCX or PDF.', icon: 'mail', layout: 'app', module: 'docs-studio', params: { template: 'letter' }, tags: 'letter cover letter template word docx writer', ready: true },
  { id: 'docs-meeting-notes', name: 'Meeting Notes', desc: 'Agenda, notes, decisions and an action checklist in one page. Download as DOCX, PDF or Markdown.', icon: 'clipboard-list', layout: 'app', module: 'docs-studio', params: { template: 'meeting' }, tags: 'meeting minutes notes agenda template docx', ready: true },
  { id: 'docs-docx-editor', name: 'DOCX Editor', desc: 'Open a Word file, edit it in your browser, and save it back as DOCX or PDF. Nothing is uploaded.', icon: 'file-pen', layout: 'app', module: 'docs-studio', params: { start: 'open' }, tags: 'docx editor word open edit online', ready: true },
]
