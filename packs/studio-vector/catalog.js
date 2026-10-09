// Pack studio-vector: Vector Studio, a browser editor in the spirit of Adobe Illustrator (see the open-source VectorCraft by ArtCraft:
// https://github.com/storytold/vectorcraft). Default category: studio.
export const cat = 'studio'
export default [
  { id: 'vector-studio', name: 'Vector Studio', desc: 'Draw vector art with the pen tool, shapes, paths, gradients, text and boolean ops; export SVG, PNG, PDF.', icon: 'pen-tool', layout: 'app', tags: 'illustrator alternative vector svg logo pen tool', ready: true },
  { id: 'svg-editor', name: 'SVG Editor', desc: 'Open an SVG, edit its points, colours and text, then export a clean SVG, PNG or PDF.', icon: 'file-code', layout: 'app', module: 'vector-studio', params: { start: 'import' }, also: ['dev'], tags: 'edit svg online vector editor inkscape alternative', ready: true },
  { id: 'logo-maker', name: 'Logo Maker', desc: 'Start from a badge logo, restyle it with gradients and text, and export SVG or PNG.', icon: 'shapes', layout: 'app', module: 'vector-studio', params: { template: 'logo' }, tags: 'logo designer brand badge vector', ready: true },
  { id: 'icon-designer', name: 'Icon Designer', desc: 'Draw a 64 px icon on a snapping grid with the pen and shape tools, then export SVG or PNG.', icon: 'component', layout: 'app', module: 'vector-studio', params: { template: 'icon' }, tags: 'icon design svg pixel grid favicon', ready: true },
  { id: 'social-graphic-maker', name: 'Social Graphic Maker', desc: 'Make a 1080 px social post with gradients, shapes and text, and export PNG, SVG or PDF.', icon: 'image', layout: 'app', module: 'vector-studio', params: { template: 'social' }, tags: 'instagram post banner graphic design canva alternative', ready: true },
]
