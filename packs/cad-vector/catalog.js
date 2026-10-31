// Pack cad-vector: DWG, DXF, SVG, SVGZ, EMF, WMF, PDF, EPS and AI conversions in the browser. Default category: image.
export const cat = 'image'
const conv = (id, name, desc, tags, params, extra = {}) => ({ id, name, desc, icon: 'repeat-2', module: 'vector-converter', params, tags, ready: true, ...extra })
export default [
  { id: 'vector-converter', name: 'Vector Converter', desc: 'Convert DWG, DXF, SVG, SVGZ, EMF, WMF, PDF, EPS and AI files into each other, right in your browser.', icon: 'repeat-2', also: ['files'], tags: 'vector converter dwg dxf svg svgz emf wmf pdf eps ai ps cad convert all formats', ready: true },
  { id: 'dwg-viewer', name: 'DWG Viewer', desc: 'Open a DWG or DXF drawing, pan and zoom, switch layers, then save it as DXF, PDF, SVG or PNG.', icon: 'ruler', cat: 'files', also: ['image'], tags: 'dwg viewer open autocad cad drawing online dxf view', ready: true },
  conv('dwg-to-dxf', 'DWG to DXF', 'Convert a DWG drawing (R13 to 2018 and newer) to a DXF in your browser. Nothing is uploaded.', 'dwg to dxf autocad convert cad', { from: 'dwg', to: 'dxf' }, { cat: 'files', also: ['image'] }),
  conv('dwg-to-pdf', 'DWG to PDF', 'Turn a DWG drawing into a to-scale vector PDF on the paper size you pick.', 'dwg to pdf autocad convert plot print cad', { from: 'dwg', to: 'pdf' }, { cat: 'files', also: ['pdf'] }),
  conv('dwg-to-svg', 'DWG to SVG', 'Convert a DWG drawing to clean SVG that scales without losing sharpness.', 'dwg to svg autocad convert cad vector', { from: 'dwg', to: 'svg' }, { cat: 'files', also: ['image'] }),
  conv('dwg-to-png', 'DWG to PNG', 'Save a DWG drawing as a PNG picture, up to 8000 pixels wide.', 'dwg to png jpg image autocad convert cad preview', { from: 'dwg', to: 'png' }, { cat: 'files', also: ['image'] }),
  conv('dxf-to-svg', 'DXF to SVG', 'Convert a DXF drawing to SVG with layers, lines, arcs, text and hatches kept.', 'dxf to svg convert cad vector', { from: 'dxf', to: 'svg' }, { cat: 'files', also: ['image'] }),
  conv('dxf-to-png', 'DXF to PNG', 'Save a DXF drawing as a PNG picture at the width you choose.', 'dxf to png image convert cad preview', { from: 'dxf', to: 'png' }, { cat: 'files', also: ['image'] }),
  conv('svg-to-dxf', 'SVG to DXF', 'Turn an SVG into a DXF with real lines, circles, splines and text, in millimetres and right way up.', 'svg to dxf cad cnc laser cutting convert vector', { from: 'svg,svgz', to: 'dxf' }, { cat: 'files', also: ['image'] }),
  conv('pdf-to-dxf', 'PDF to DXF', 'Convert the vector shapes and text of a PDF into a DXF drawing, one file per page.', 'pdf to dxf cad convert vector drawing', { from: 'pdf', to: 'dxf' }, { cat: 'files', also: ['pdf'] }),
  conv('emf-to-svg', 'EMF to SVG', 'Convert a Windows EMF metafile to SVG with shapes, text and pictures kept.', 'emf to svg windows metafile convert vector emz', { from: 'emf,emz', to: 'svg' }),
  conv('emf-to-png', 'EMF to PNG', 'Turn a Windows EMF metafile into a PNG picture at screen or print resolution.', 'emf to png windows metafile image convert emz', { from: 'emf,emz', to: 'png' }),
  conv('emf-to-pdf', 'EMF to PDF', 'Convert a Windows EMF metafile to a vector PDF.', 'emf to pdf windows metafile convert emz', { from: 'emf,emz', to: 'pdf' }, { also: ['pdf'] }),
  conv('wmf-to-svg', 'WMF to SVG', 'Convert a classic Windows WMF metafile (with or without a placeable header) to SVG.', 'wmf to svg windows metafile clipart convert vector wmz', { from: 'wmf,wmz', to: 'svg' }),
  conv('wmf-to-png', 'WMF to PNG', 'Turn a classic Windows WMF metafile into a PNG picture.', 'wmf to png windows metafile clipart image convert wmz', { from: 'wmf,wmz', to: 'png' }),
  conv('svg-to-emf', 'SVG to EMF', 'Convert an SVG to an EMF metafile that Windows programs and office documents can place.', 'svg to emf windows metafile word powerpoint convert vector', { from: 'svg,svgz', to: 'emf' }),
  conv('svg-to-wmf', 'SVG to WMF', 'Convert an SVG to a classic WMF metafile. Curves become short straight segments.', 'svg to wmf windows metafile convert vector clipart', { from: 'svg,svgz', to: 'wmf' }),
  conv('svgz-converter', 'SVG to SVGZ and back', 'Compress an SVG into an SVGZ, or unpack an SVGZ into a plain SVG, in your browser.', 'svgz svg gzip compress decompress convert vector', { from: 'svg,svgz', only: 'svg,svgz' }),
  conv('pdf-to-svg', 'PDF to SVG', 'Turn each page of a PDF into a vector SVG with paths, text and pictures kept.', 'pdf to svg vector convert page', { from: 'pdf', to: 'svg' }, { also: ['pdf'] }),
  conv('pdf-to-eps', 'PDF to EPS', 'Convert PDF pages to EPS or PS for print shops and older design programs.', 'pdf to eps ps postscript convert vector', { from: 'pdf', to: 'eps' }, { also: ['pdf'] }),
  conv('eps-to-svg', 'EPS to SVG', 'Convert an EPS or PS file to SVG, PNG, PDF or DXF in your browser.', 'eps to svg postscript ps convert vector', { from: 'eps,ps', to: 'svg' }),
  conv('ai-to-svg', 'AI to SVG', 'Convert an AI file (the PDF-compatible kind) to SVG, PNG or PDF.', 'ai to svg illustrator convert vector', { from: 'ai', to: 'svg' }),
]
