// Pack studio-develop: Photo Develop, a browser editor in the spirit of Adobe Lightroom (see the open-source LightCraft by ArtCraft:
// https://github.com/storytold/lightcraft). Default category: studio. Focused entries open the same editor with a different start.
export const cat = 'studio'
export default [
  { id: 'photo-develop', name: 'Photo Develop', desc: 'Edit and batch-process photos: exposure, color, tone curve, HSL, presets and before/after.', icon: 'aperture', layout: 'app', tags: 'lightroom alternative develop presets color grading batch raw photo editor', ready: true },
  { id: 'batch-photo-editor', name: 'Batch Photo Editor', desc: 'Edit one photo, copy its settings onto many, then export the whole set resized to a ZIP.', icon: 'images', layout: 'app', module: 'photo-develop', params: { start: 'batch' }, tags: 'batch edit photos resize export zip sync settings lightroom', ready: true },
  { id: 'bw-photo-editor', name: 'Black and White Photo Editor', desc: 'Turn photos black and white with a color filter mix, contrast, tone curve and film grain.', icon: 'contrast', layout: 'app', module: 'photo-develop', params: { look: 'bw-classic' }, tags: 'black and white monochrome grayscale convert photo film grain', ready: true },
  { id: 'photo-color-grading', name: 'Photo Color Grading', desc: 'Grade photos with shadows, midtones and highlights wheels, HSL, curves and presets.', icon: 'palette', layout: 'app', module: 'photo-develop', params: { section: 'grading' }, tags: 'color grade teal orange cinematic look wheels hsl curves', ready: true },
  { id: 'film-look-editor', name: 'Film Look Photo Editor', desc: 'Give photos a warm film look with faded blacks, grain and gentle color shifts, then export.', icon: 'film', layout: 'app', module: 'photo-develop', params: { look: 'film-warm' }, tags: 'film vintage fade grain analog retro presets photo', ready: true },
]
