// Pack studio-cad: CAD Studio, a browser 2D drafting editor. Default category: studio.
export const cat = 'studio'
export default [
  { id: 'cad-studio', name: 'CAD Studio', desc: '2D drafting with lines, arcs, polylines, snaps, layers and dimensions; open and save DXF.', icon: 'drafting-compass', layout: 'app', tags: 'autocad alternative cad dxf drafting floor plan', ready: true },
  { id: 'dxf-viewer', name: 'DXF Viewer', desc: 'Open a DXF drawing, pan and zoom, measure distances and areas, then save it as PDF, SVG or PNG.', icon: 'ruler', layout: 'app', module: 'cad-studio', params: { start: 'open' }, also: ['files'], tags: 'dxf viewer open cad file measure autocad', ready: true },
  { id: 'dxf-to-pdf', name: 'DXF to PDF', desc: 'Convert a DXF drawing to a to-scale vector PDF, SVG or PNG in your browser. Nothing is uploaded.', icon: 'file-output', layout: 'app', module: 'cad-studio', params: { start: 'open', export: 'pdf' }, also: ['pdf', 'files'], tags: 'dxf to pdf svg png convert cad drawing plot print', ready: true },
  { id: 'floor-plan-drawing', name: 'Floor Plan Drafter', desc: 'Start from a sample floor plan, edit walls and doors to scale, add dimensions and export to PDF or DXF.', icon: 'house', layout: 'app', module: 'cad-studio', params: { template: 'floorplan' }, tags: 'floor plan house architecture drawing walls doors rooms layout', ready: true },
  { id: 'plate-part-drawing', name: 'Part Drawing Starter', desc: 'Start from a dimensioned plate with holes and centre lines, then edit it and export a DXF or PDF drawing.', icon: 'cog', layout: 'app', module: 'cad-studio', params: { template: 'plate' }, tags: 'mechanical part drawing plate holes dimensions machining engineering', ready: true },
]
