// Pack studio-photo: Photo Studio, a browser layered photo editor. Default category: studio.
// The focused entries below open the same editor module with a different starting point (params), each with its own autosave slot.
export const cat = 'studio'
export default [
  { id: 'photo-studio', name: 'Photo Studio', desc: 'Layered photo editor: layers, masks, brushes, selections, adjustments, text and PSD import and export.', icon: 'image', layout: 'app', tags: 'photoshop alternative photo editor layers masks psd retouch brush clone stamp curves levels', ready: true },
  { id: 'psd-editor', name: 'PSD Editor', desc: 'Open a PSD, edit its layers and masks in your browser, then export PSD, PNG, JPG or WebP.', icon: 'layers-2', layout: 'app', module: 'photo-studio', params: { mode: 'psd', slot: 'psd' }, tags: 'psd viewer open photoshop file layers online edit export', ready: true },
  { id: 'social-post-maker', name: 'Social Post Maker', desc: 'Start from an editable social post template with text, shapes and gradients, then export a PNG or JPG.', icon: 'layout-template', layout: 'app', module: 'photo-studio', params: { template: 'social', slot: 'social' }, tags: 'instagram post story template text design canva alternative', ready: true },
  { id: 'thumbnail-maker', name: 'Thumbnail Maker', desc: 'Design a 1280 x 720 video thumbnail with bold text, shapes, cutouts and effects.', icon: 'monitor-play', layout: 'app', module: 'photo-studio', params: { template: 'thumbnail', slot: 'thumbnail' }, tags: 'youtube thumbnail template design text cover', ready: true },
]
