// Pack studio-pdf: PDF Studio, a browser PDF editor. Default category: studio.
// The focused entries below open the same editor module with a different starting tool.
export const cat = 'studio'
export default [
  { id: 'pdf-studio', name: 'PDF Studio', desc: 'View, annotate, highlight, comment, add text and images, fill and sign PDFs in one editor.', icon: 'file-pen-line', layout: 'app', tags: 'acrobat alternative pdf editor annotate highlight comment markup stamp signature redact form organize pages', ready: true },
  { id: 'pdf-studio-sign', name: 'Sign PDF (studio)', desc: 'Open a PDF, draw, type or upload a signature, place it anywhere and save a signed copy.', icon: 'signature', layout: 'app', module: 'pdf-studio', params: { start: 'sign' }, tags: 'sign pdf signature esign initials stamp date fill and sign', ready: true },
  { id: 'pdf-studio-redact', name: 'Redact PDF (studio)', desc: 'Mark text or areas, search and redact every match, and save a copy with the content removed for good.', icon: 'eye-off', layout: 'app', module: 'pdf-studio', params: { start: 'redact' }, tags: 'redact pdf blackout remove sensitive text hide personal data', ready: true },
  { id: 'pdf-studio-organize', name: 'Organize PDF pages (studio)', desc: 'Rotate, delete, reorder and insert blank pages from thumbnails, with live preview and undo.', icon: 'layout-grid', layout: 'app', module: 'pdf-studio', params: { start: 'organize' }, tags: 'organize pdf pages rotate delete reorder insert blank thumbnails', ready: true },
  { id: 'pdf-studio-forms', name: 'Fill PDF forms (studio)', desc: 'Fill in text fields, checkboxes, radio buttons and dropdowns in a PDF form and save a copy.', icon: 'text-cursor-input', layout: 'app', module: 'pdf-studio', params: { start: 'forms' }, tags: 'fill pdf form acroform fields checkbox radio dropdown', ready: true },
]
