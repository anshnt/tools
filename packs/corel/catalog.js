// Pack corel: CorelDRAW file tools (convert to CorelDRAW-ready vectors, open and edit .cdr). Default category: studio.
export const cat = 'studio'
export default [
  { id: 'convert-to-coreldraw', name: 'Convert to CorelDRAW format', desc: 'Turn PDF, SVG, PNG or JPG into CorelDRAW-ready EPS, AI, PDF or SVG, tracing photos and logos into vectors.', icon: 'file-output', also: ['image', 'pdf'], tags: 'corel coreldraw cdr eps ai convert vector trace png to cdr pdf to cdr svg to cdr' },
  { id: 'cdr-viewer', name: 'CorelDRAW (CDR) viewer & editor', desc: 'Open .cdr files in your browser, see every page, edit them and save CorelDRAW-ready EPS, SVG or PDF.', icon: 'pen-tool', also: ['image'], tags: 'corel coreldraw cdr open view edit cdr to svg cdr to pdf cdr to png' },
]
