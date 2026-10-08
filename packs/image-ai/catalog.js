// Pack image-ai: on-device ML image tools (background removal, upscaling, OCR, ID photos). Default category: image.
export const cat = 'image'
export default [
  { id: 'remove-background', name: 'Remove background', desc: 'Cut out the subject and get a transparent PNG, on your device.', icon: 'eraser', mode: 'model', also: ['ai'], tags: 'transparent cutout bg remover' },
  { id: 'change-background', name: 'Change background', desc: 'Swap the background for a color, blur or another photo.', icon: 'paint-bucket', mode: 'model', tags: 'background replace color white' },
  { id: 'remove-objects', name: 'Remove objects from photo', desc: 'Brush over unwanted objects or text and fill them in.', icon: 'wand-sparkles', mode: 'model', also: ['ai'], tags: 'inpaint erase cleanup magic eraser' },
  { id: 'image-upscaler', name: 'Image upscaler', desc: 'Enlarge images 2x or 4x with an AI super-resolution model.', icon: 'zoom-in', mode: 'model', also: ['ai'], tags: 'upscale enlarge super resolution hd' },
  { id: 'enhance-image', name: 'Photo quality enhancer', desc: 'Auto-fix exposure, contrast, sharpness and noise in one click.', icon: 'sparkles', tags: 'enhance auto fix sharpen denoise' },
  { id: 'image-to-text', name: 'Image to text (OCR)', desc: 'Copy text out of photos, scans and screenshots in 25+ languages.', icon: 'scan-text', mode: 'model', also: ['student'], tags: 'ocr extract text recognize' },
  { id: 'screenshot-to-text', name: 'Screenshot to text', module: 'image-to-text', params: { paste: true }, desc: 'Paste a screenshot (Ctrl+V) and copy the text from it.', icon: 'clipboard-paste', mode: 'model', also: ['screen'], tags: 'paste screenshot ocr' },
  { id: 'passport-photo', name: 'Passport photo maker', desc: 'Make passport and visa photos for 30+ countries, with print sheets.', icon: 'contact-round', mode: 'model', also: ['india'], tags: 'passport visa photo 35x45 2x2 print sheet' },
  { id: 'id-photo-maker', name: 'ID photo maker', module: 'passport-photo', params: { preset: 'id' }, desc: 'ID card, license and form photos with a clean white background.', icon: 'id-card', mode: 'model', tags: 'id card license stamp size photo' },
  { id: 'blur-faces', name: 'Auto blur faces', desc: 'Detect and blur every face in a photo automatically.', icon: 'scan-face', mode: 'model', also: ['security'], tags: 'privacy faces anonymize' },
]
