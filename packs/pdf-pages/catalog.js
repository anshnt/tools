// Pack pdf-pages: PDF inspection and page-layout tools with a twist. Default category: pdf.
export const cat = 'pdf'
export default [
  { id: 'pdf-page-size', name: 'PDF page-size detector', desc: 'List every page size (A4, Letter, custom) and orientation.', icon: 'ruler', tags: 'dimensions paper size a4 letter', ready: true },
  { id: 'pdf-normalize-size', name: 'Normalize page size', desc: 'Make every page the same size, like A4, without distortion.', icon: 'scaling', tags: 'resize pages a4 letter uniform', ready: true },
  { id: 'pdf-fix-orientation', name: 'PDF orientation fixer', desc: 'Automatically turn landscape pages to portrait (or the reverse).', icon: 'rectangle-vertical', tags: 'landscape portrait rotate auto', ready: true },
  { id: 'pdf-booklet', name: 'PDF booklet maker', desc: 'Reorder and impose pages for fold-and-staple booklet printing.', icon: 'book-open', tags: 'imposition saddle stitch print', ready: true },
  { id: 'pdf-poster', name: 'PDF poster printer', desc: 'Tile one big page across several A4 sheets to print a poster.', icon: 'grid-2x2', tags: 'tile poster enlarge print', ready: true },
  { id: 'pdf-n-up', name: 'N-up pages per sheet', desc: 'Put 2, 4, 6 or 9 pages on each sheet to save paper.', icon: 'columns-2', tags: '2up 4up handout pages per sheet', ready: true },
  { id: 'pdf-contact-sheet', name: 'PDF contact sheet', desc: 'One overview image or page with thumbnails of every page.', icon: 'layout-dashboard', tags: 'thumbnails overview', ready: true },
  { id: 'pdf-extract-images', name: 'Extract images from PDF', desc: 'Save every embedded image in a PDF as files or a ZIP.', icon: 'images', tags: 'images pictures extract' },
  { id: 'pdf-extract-links', name: 'Extract links from PDF', desc: 'List every URL and email link in a PDF, with page numbers.', icon: 'link', tags: 'urls hyperlinks' },
  { id: 'pdf-keyword-pages', name: 'Extract pages with keyword', desc: 'Find the pages that contain a word or phrase and save them.', icon: 'search', tags: 'find search keyword filter pages' },
  { id: 'pdf-blank-pages', name: 'Blank page remover', desc: 'Detect and remove blank or nearly blank pages (great for scans).', icon: 'file', tags: 'blank empty pages scan' },
  { id: 'pdf-duplicate-pages', name: 'Duplicate page finder', desc: 'Spot pages that repeat and remove the copies.', icon: 'copy', tags: 'duplicates repeated pages' },
  { id: 'pdf-page-sorter', name: 'PDF page sorter', desc: 'Reverse, interleave odd/even scans, or sort pages by printed number.', icon: 'arrow-down-wide-narrow', tags: 'sort reverse interleave duplex' },
  { id: 'pdf-chapter-split', name: 'Split PDF by chapters', desc: 'Split a PDF into one file per bookmark or chapter.', icon: 'book-marked', tags: 'bookmarks outline chapters split' },
  { id: 'pdf-size-analyzer', name: 'PDF size analyzer', desc: 'See what makes a PDF big: images, fonts, text and metadata.', icon: 'chart-pie', tags: 'analyze breakdown why big' },
  { id: 'pdf-info', name: 'PDF info viewer', desc: 'Pages, version, fonts, encryption, metadata and more at a glance.', icon: 'info', tags: 'properties details metadata' },
  { id: 'pdf-bookmarks', name: 'PDF bookmark editor', desc: 'Add, rename and nest bookmarks (outline) in a PDF.', icon: 'bookmark', tags: 'outline toc table of contents' },
]
