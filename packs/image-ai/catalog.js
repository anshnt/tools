// Pack image-ai: on-device ML image tools (background removal, upscaling, OCR, ID photos). Default category: image.
export const cat = 'image'
export default [
  { id: 'remove-background', name: 'Remove background', desc: 'Cut out the subject and get a transparent PNG, on your device.', icon: 'eraser', mode: 'model', also: ['ai'], tags: 'transparent cutout bg remover', ready: true },
  { id: 'change-background', name: 'Change background', desc: 'Swap the background for a color, blur or another photo.', icon: 'paint-bucket', mode: 'model', tags: 'background replace color white', ready: true },
  { id: 'white-background', name: 'White background maker', module: 'change-background', params: { mode: 'white' }, desc: 'Put any photo on a clean white background, ideal for products and listings.', icon: 'square', mode: 'model', tags: 'white background product photo amazon ecommerce listing', ready: true },
  { id: 'blur-background', name: 'Blur photo background', module: 'change-background', params: { mode: 'blur' }, desc: 'Add a portrait-mode blur behind the subject of any photo.', icon: 'aperture', mode: 'model', tags: 'bokeh portrait mode depth of field blur background', ready: true },
  { id: 'remove-objects', name: 'Remove objects from photo', desc: 'Brush over unwanted objects or text and fill them in.', icon: 'wand-sparkles', mode: 'model', also: ['ai'], tags: 'inpaint erase cleanup magic eraser', ready: true },
  { id: 'remove-text-from-image', name: 'Remove text from photo', module: 'remove-objects', params: { focus: 'text' }, desc: 'Paint over a caption, date stamp or watermark and fill it in.', icon: 'type', mode: 'model', tags: 'remove text watermark date stamp caption logo erase', ready: true },
  { id: 'image-upscaler', name: 'Image upscaler', desc: 'Enlarge images 2x or 4x with an AI super-resolution model.', icon: 'zoom-in', mode: 'model', also: ['ai'], tags: 'upscale enlarge super resolution hd', ready: true },
  { id: 'enhance-image', name: 'Photo quality enhancer', desc: 'Auto-fix exposure, contrast, sharpness and noise in one click.', icon: 'sparkles', tags: 'enhance auto fix sharpen denoise', ready: true },
  { id: 'image-to-text', name: 'Image to text (OCR)', desc: 'Copy text out of photos, scans and screenshots in 25+ languages.', icon: 'scan-text', mode: 'model', also: ['student'], tags: 'ocr extract text recognize', ready: true },
  { id: 'screenshot-to-text', name: 'Screenshot to text', module: 'image-to-text', params: { paste: true }, desc: 'Paste a screenshot (Ctrl+V) and copy the text from it.', icon: 'clipboard-paste', mode: 'model', also: ['screen'], tags: 'paste screenshot ocr', ready: true },
  { id: 'passport-photo', name: 'Passport photo maker', desc: 'Make passport and visa photos for 30+ countries, with print sheets.', icon: 'contact-round', mode: 'model', also: ['india'], tags: 'passport visa photo 35x45 2x2 print sheet', ready: true },
  { id: 'id-photo-maker', name: 'ID photo maker', module: 'passport-photo', params: { preset: 'id' }, desc: 'ID card, license and form photos with a clean white background.', icon: 'id-card', mode: 'model', tags: 'id card license stamp size photo', ready: true },
  { id: 'blur-faces', name: 'Auto blur faces', desc: 'Detect and blur every face in a photo automatically.', icon: 'scan-face', mode: 'model', also: ['security'], tags: 'privacy faces anonymize', ready: true },
]
