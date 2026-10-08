// Pack pdf-edit: page operations, security and signing. Default category: pdf.
export const cat = 'pdf'
export default [
  { id: 'merge-pdf', name: 'Merge PDF', desc: 'Combine several PDFs into one file, in any order you choose.', icon: 'combine', tags: 'join combine append concatenate', ready: true },
  { id: 'split-pdf', name: 'Split PDF', desc: 'Split a PDF by page ranges, every N pages, or into single pages.', icon: 'scissors', tags: 'separate break divide' },
  { id: 'compress-pdf', name: 'Compress PDF', desc: 'Shrink a PDF with presets: max quality, balanced, email, WhatsApp, portal, under 1 MB.', icon: 'minimize-2', tags: 'reduce size optimize smaller optimizer whatsapp email' },
  { id: 'rotate-pdf', name: 'Rotate PDF', desc: 'Rotate all pages or just the ones you pick by 90, 180 or 270 degrees.', icon: 'rotate-cw', tags: 'turn orientation' },
  { id: 'crop-pdf', name: 'Crop PDF', desc: 'Trim margins or crop pages to a custom box.', icon: 'crop', tags: 'trim margins' },
  { id: 'delete-pdf-pages', name: 'Delete PDF pages', desc: 'Remove the pages you do not need from a PDF.', icon: 'trash-2', tags: 'remove pages' },
  { id: 'rearrange-pdf-pages', name: 'Rearrange PDF pages', desc: 'Drag page thumbnails into a new order and save.', icon: 'layout-grid', tags: 'reorder organize move pages' },
  { id: 'extract-pdf-pages', name: 'Extract PDF pages', desc: 'Pull selected pages out into a new PDF.', icon: 'file-output', tags: 'select pages save' },
  { id: 'add-pdf-pages', name: 'Add pages to PDF', desc: 'Insert blank pages, images or pages from another PDF anywhere.', icon: 'file-plus', tags: 'insert append blank' },
  { id: 'protect-pdf', name: 'Password-protect PDF', desc: 'Encrypt a PDF with a password and set print/copy permissions.', icon: 'lock', tags: 'encrypt secure password' },
  { id: 'unlock-pdf', name: 'Remove PDF password', desc: 'Unlock a PDF you know the password for and save an unprotected copy.', icon: 'lock-open', tags: 'decrypt unlock remove password' },
  { id: 'sign-pdf', name: 'Sign PDF', desc: 'Draw, type or upload a signature and place it on any page.', icon: 'signature', tags: 'esign signature initials' },
  { id: 'fill-pdf-form', name: 'Fill PDF form', desc: 'Fill in PDF form fields, then save or flatten the result.', icon: 'text-cursor-input', tags: 'form fields acroform fill' },
  { id: 'watermark-pdf', name: 'Add watermark to PDF', desc: 'Stamp text or an image across pages with opacity and rotation.', icon: 'stamp', tags: 'watermark stamp confidential draft' },
  { id: 'remove-pdf-watermark', name: 'Remove PDF watermark', desc: 'Best-effort removal of text and annotation watermarks.', icon: 'eraser', tags: 'remove watermark clean' },
  { id: 'pdf-page-numbers', name: 'Add page numbers', desc: 'Number pages with position, style, start number and range.', icon: 'list-ordered', tags: 'pagination numbering footer header bates' },
  { id: 'pdf-metadata-remover', name: 'PDF metadata remover', desc: 'View, edit or wipe title, author, dates and other PDF metadata.', icon: 'file-minus', cat: 'security', also: ['pdf'], tags: 'metadata privacy author properties' },
  { id: 'flatten-pdf', name: 'Flatten PDF', desc: 'Bake form fields and annotations into the page so they cannot be edited.', icon: 'layers', tags: 'flatten forms annotations' },
  { id: 'grayscale-pdf', name: 'Grayscale PDF', desc: 'Convert a color PDF to black and white for printing.', icon: 'contrast', tags: 'black white monochrome print' },
  { id: 'header-footer-pdf', name: 'Add header & footer', desc: 'Add custom text headers and footers with dates and page numbers.', icon: 'panel-top', tags: 'header footer text' },
]
