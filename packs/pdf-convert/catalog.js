// Pack pdf-convert: converting to and from PDF, OCR, text extraction and comparison. Default category: pdf.
export const cat = 'pdf'
export default [
  { id: 'pdf-to-word', name: 'PDF to Word', desc: 'Convert a PDF into an editable .docx document.', icon: 'file-text', tags: 'docx doc convert editable', ready: true },
  { id: 'pdf-to-excel', name: 'PDF to Excel', desc: 'Pull tables out of a PDF into an .xlsx spreadsheet.', icon: 'sheet', also: ['data'], tags: 'xlsx tables spreadsheet', ready: true },
  { id: 'pdf-to-powerpoint', name: 'PDF to PowerPoint', desc: 'Turn each PDF page into a slide in a .pptx deck.', icon: 'presentation', tags: 'pptx slides', ready: true },
  { id: 'pdf-to-image', name: 'PDF to JPG / PNG', desc: 'Export PDF pages as high-resolution JPG or PNG images.', icon: 'image', tags: 'jpg png images export render', ready: true },
  { id: 'image-to-pdf', name: 'JPG / PNG to PDF', desc: 'Combine images into a PDF with page size, margins and order.', icon: 'file-image', also: ['image'], tags: 'jpg png images photos convert', ready: true },
  { id: 'photo-to-pdf', name: 'Photo to PDF', module: 'image-to-pdf', params: { scan: true }, cat: 'image', desc: 'Turn phone photos or scans into a clean multi-page PDF.', icon: 'camera', tags: 'scan photos camera document', ready: true },
  { id: 'word-to-pdf', name: 'Word to PDF', desc: 'Convert .docx documents to PDF in your browser.', icon: 'file-type', tags: 'docx doc convert' },
  { id: 'powerpoint-to-pdf', name: 'PowerPoint to PDF', desc: 'Convert .pptx slides to a PDF.', icon: 'presentation', also: ['career'], tags: 'pptx ppt slides convert' },
  { id: 'ppt-to-images', name: 'PowerPoint to images', desc: 'Export every slide of a .pptx as PNG or JPG images.', icon: 'images', also: ['career'], tags: 'pptx slides png jpg' },
  { id: 'pdf-ocr', name: 'OCR PDF', desc: 'Make scanned PDFs searchable and copy out the text (many languages).', icon: 'scan-text', mode: 'model', also: ['student'], tags: 'scanned ocr recognize text searchable' },
  { id: 'pdf-to-text', name: 'PDF to text', desc: 'Extract all the text from a PDF, page by page.', icon: 'text', tags: 'extract text txt copy', ready: true },
  { id: 'compare-pdf', name: 'Compare two PDFs', desc: 'See text and visual differences between two versions of a PDF.', icon: 'git-compare', tags: 'diff difference versions' },
  { id: 'html-to-pdf', name: 'HTML to PDF', desc: 'Paste or upload HTML and save it as a PDF.', icon: 'code', also: ['web'], tags: 'html web page' },
  { id: 'markdown-to-pdf', name: 'Markdown to PDF', desc: 'Write or upload Markdown and export a nicely styled PDF.', icon: 'file-code', tags: 'md markdown export' },
  { id: 'pdf-to-markdown', name: 'PDF to Markdown', desc: 'Convert PDF text into clean Markdown with headings and lists.', icon: 'file-code-2', tags: 'md convert', ready: true },
  { id: 'text-to-pdf', name: 'Text to PDF', desc: 'Turn plain text into a PDF with font, size and margins.', icon: 'file-type-2', tags: 'txt convert' },
]
