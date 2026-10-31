// Names and kinds of file formats, used by the File Converter hub to label, group and order choices.
// Unknown extensions still work: they are labelled with their upper-case extension and kind 'other'.

export const KINDS = {
  image: 'Pictures', vector: 'Vector graphics', pdf: 'PDF', doc: 'Documents', sheet: 'Spreadsheets', slide: 'Presentations', text: 'Text and markup',
  ebook: 'E-books', video: 'Video', audio: 'Audio', subtitle: 'Subtitles', archive: 'Archives', cad: 'CAD drawings', font: 'Fonts', data: 'Data files',
  model: '3D models', geo: 'Maps and geodata', other: 'Other files',
}
export const KIND_ICON = {
  image: 'image', vector: 'pen-tool', pdf: 'file-text', doc: 'file-type', sheet: 'sheet', slide: 'presentation', text: 'type', ebook: 'book-open', video: 'file-video',
  audio: 'file-audio', subtitle: 'captions', archive: 'file-archive', cad: 'ruler', font: 'a-large-small', data: 'braces', model: 'box', geo: 'map', other: 'file',
}
/** Site categories a kind is listed under (for the catalog `also`). */
export const KIND_CATEGORY = { image: 'image', vector: 'image', pdf: 'pdf', doc: 'pdf', slide: 'pdf', text: 'text', ebook: 'text', sheet: 'data', data: 'data', video: 'media', audio: 'media', subtitle: 'media' }

const KIND_EXTS = {
  image: 'jpg png webp avif gif bmp ico heic heif tiff tga psd dds jp2 jxl pnm ppm pgm pbm xpm icns cur exr hdr dng cr2 nef arw',
  vector: 'svg eps ai cdr wmf emf svgz',
  pdf: 'pdf',
  doc: 'docx doc odt rtf hwp hwpx pages wpd dotx abw fodt',
  sheet: 'xlsx xls ods csv tsv xlsm xlsb numbers fods dif',
  slide: 'pptx ppt odp key ppsx fodp',
  text: 'txt md html xml rst tex org adoc log ini yaml toml',
  ebook: 'epub mobi azw3 azw fb2 lit cbz cbr djvu',
  video: 'mp4 mov avi mkv webm wmv flv m4v mpg mpeg 3gp ogv ts mts m2ts vob gifv',
  audio: 'mp3 wav flac ogg m4a aac wma opus aiff amr mid midi ac3 caf',
  subtitle: 'srt vtt ass ssa sub sbv ttml lrc',
  archive: 'zip tar gz tgz bz2 xz 7z rar zst cab iso jar apk',
  cad: 'dxf dwg stl-cad plt hpgl',
  font: 'ttf otf woff woff2 eot ttc',
  data: 'json csv-data ndjson jsonl sql sqlite db parquet avro plist bson msgpack cbor properties',
  model: 'stl obj ply gltf glb 3mf off fbx dae x3d',
  geo: 'geojson kml kmz gpx shp topojson wkt gml',
}
const kindOf = new Map()
for (const [k, list] of Object.entries(KIND_EXTS)) for (const e of list.split(' ')) if (!kindOf.has(e)) kindOf.set(e, k)
kindOf.set('csv', 'sheet'); kindOf.set('json', 'data'); kindOf.set('stl', 'model')
// formats added by the engine packs that the lists above do not name (first match wins above, so set them here)
for (const [k, list] of Object.entries({
  data: 'yaml toml ini env properties json5 hjson msgpack cbor vcf ics',
  image: 'fits fts dcm tga pcx qoi mng xcf pam jxl j2k raw orf raf rw2 cr3',
  ebook: 'kepub cb7 azw4 prc pdb fbz htmlz txtz',
  model: '3ds usdz', geo: 'fit wkb', vector: 'wmz emz', doc: 'eml msg ott', text: 'ipynb mhtml mht',
})) for (const e of list.split(' ')) kindOf.set(e, k)

export const ALIAS = { jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', tif: 'tiff', htm: 'html', xhtml: 'html', markdown: 'md', mkd: 'md', mdown: 'md', yml: 'yaml', text: 'txt', tab: 'tsv', jsonl: 'ndjson', mpg: 'mpeg', oga: 'ogg', ps: 'eps' }
export const canon = (ext = '') => { const e = ext.toLowerCase().replace(/^\./, ''); return ALIAS[e] || e }

export const kindOfExt = (ext) => kindOf.get(canon(ext)) || 'other'

const SPECIAL = {
  'pdf-merge': 'Merge into one PDF', 'pdf-split': 'Split into pages', 'pdf-compress': 'Smaller PDF',
  md: 'Markdown', txt: 'Plain text', html: 'HTML', json: 'JSON', csv: 'CSV', tsv: 'TSV', xlsx: 'Excel (XLSX)', docx: 'Word (DOCX)', pptx: 'PowerPoint (PPTX)',
  jpg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', gif: 'GIF', bmp: 'BMP', ico: 'ICO', heic: 'HEIC', pdf: 'PDF', svg: 'SVG', mp4: 'MP4', mp3: 'MP3',
  wav: 'WAV', zip: 'ZIP', geojson: 'GeoJSON', topojson: 'TopoJSON', vtt: 'WebVTT', kepub: 'Kobo EPUB', 'tar.gz': 'TAR.GZ', xml: 'XML', yaml: 'YAML', epub: 'EPUB', rtf: 'RTF', odt: 'ODT', ods: 'ODS', odp: 'ODP', tiff: 'TIFF', webm: 'WebM', mov: 'MOV',
}
export const label = (ext) => SPECIAL[ext] || String(ext).toUpperCase()
/** Short label (just the extension) for tight places like file badges. */
export const shortLabel = (ext) => (SPECIAL[ext] && !/ /.test(SPECIAL[ext]) ? SPECIAL[ext] : String(ext).toUpperCase())
export const HINT = {
  'pdf-merge': 'PDFs and pictures in the order you choose', 'pdf-split': 'One PDF per page, or by ranges', 'pdf-compress': 'Same pages, smaller file',
}
/** Pseudo targets are actions, not file types; this is the extension the result gets. */
export const OUT_EXT = { 'pdf-merge': 'pdf', 'pdf-split': 'pdf', 'pdf-compress': 'pdf' }
export const outExt = (t) => OUT_EXT[t] || t

/** Most useful targets first. Anything not listed comes after, in route order. */
export const POPULAR = ['pdf', 'jpg', 'png', 'webp', 'docx', 'txt', 'xlsx', 'csv', 'mp4', 'mp3', 'html', 'md', 'json', 'gif', 'wav', 'pptx', 'zip', 'avif', 'svg', 'epub', 'ico', 'bmp',
  'pdf-merge', 'pdf-compress', 'pdf-split']

/** What people usually want from each kind of file, ahead of POPULAR (a 3D model wants GLB or STL before a picture of it). */
export const PREFER = {
  model: ['glb', 'stl', 'obj', '3mf', 'ply', 'gltf', 'usdz', 'png'], geo: ['geojson', 'kml', 'gpx', 'kmz', 'shp', 'csv', 'xlsx'],
  font: ['woff2', 'ttf', 'woff', 'otf', 'eot'], ebook: ['epub', 'pdf', 'kepub', 'docx', 'txt', 'cbz'], archive: ['zip', 'extract', '7z', 'tar.gz', 'tar'],
  subtitle: ['srt', 'vtt', 'ass', 'txt'], data: ['json', 'yaml', 'csv', 'xlsx', 'toml', 'xml'], cad: ['pdf', 'svg', 'dxf', 'png'],
  vector: ['svg', 'pdf', 'png', 'emf', 'dxf'], doc: ['pdf', 'docx', 'odt', 'txt', 'html'], text: ['pdf', 'html', 'md', 'docx', 'txt'],
}
/** Sort key for a target when converting from `kind`: the kind's favourites, then the site-wide popular list. */
export const rankFor = (kind) => (t) => { const k = PREFER[kind]?.indexOf(t) ?? -1; if (k >= 0) return k; const i = POPULAR.indexOf(t); return i < 0 ? 999 : 100 + i }

/** Types a browser can decode to a picture, so the crop step can open them. */
export const CROPPABLE = new Set(['jpg', 'png', 'webp', 'gif', 'bmp', 'avif', 'svg', 'heic', 'heif', 'ico'])
