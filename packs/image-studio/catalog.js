// Pack image-studio: creative and analysis image tools. Default category: image.
export const cat = 'image'
export default [
  { id: 'aspect-ratio-calculator', name: 'Aspect ratio calculator', desc: 'Find the ratio of any size, or the missing width/height for a ratio.', icon: 'ratio', also: ['calc'], tags: '16:9 4:3 ratio resize' },
  { id: 'print-size-calculator', name: 'Print size calculator', module: 'print-size', desc: '1200 x 1800 px at 300 DPI = 4 x 6 in. Work out print sizes and quality.', icon: 'printer', also: ['calc'], tags: 'print dpi inches cm photo size' },
  { id: 'dpi-calculator', name: 'Image DPI calculator', module: 'print-size', params: { solve: 'dpi' }, desc: 'Work out the DPI an image will print at for a given size.', icon: 'scan', tags: 'dpi ppi print' },
  { id: 'pixel-converter', name: 'Pixel, inch & cm converter', desc: 'Convert between px, in, cm, mm and pt at any DPI.', icon: 'ruler', also: ['calc'], tags: 'px inch cm mm dpi convert' },
  { id: 'image-splitter', name: 'Image splitter', desc: 'Split a big image into 2x2, 3x3, custom grids or an Instagram grid.', icon: 'grid-3x3', tags: 'split grid instagram tiles slice' },
  { id: 'collage-maker', name: 'Collage & montage maker', desc: 'Arrange photos into grids and collages with spacing and borders.', icon: 'layout-template', tags: 'collage montage grid photos' },
  { id: 'image-tiler', name: 'Image tiler', desc: 'Repeat an image as a seamless pattern or tile it onto a page.', icon: 'grid-2x2', tags: 'pattern tile repeat wallpaper' },
  { id: 'sprite-sheet', name: 'Sprite sheet generator', desc: 'Pack images into a sprite sheet with CSS and JSON coordinates.', icon: 'layout-grid', also: ['dev'], tags: 'sprites css game atlas' },
  { id: 'contact-sheet', name: 'Contact sheet generator', desc: 'Make a printable sheet of thumbnails with file names.', icon: 'layout-dashboard', tags: 'thumbnails proof sheet' },
  { id: 'before-after', name: 'Before / after image', desc: 'Make side-by-side or slider comparison images.', icon: 'columns-2', tags: 'comparison side by side' },
  { id: 'color-palette', name: 'Color palette extractor', desc: 'Pull a palette of the main colors from any image, with HEX codes.', icon: 'palette', also: ['dev'], tags: 'colors palette hex scheme' },
  { id: 'dominant-color', name: 'Dominant color finder', module: 'color-palette', params: { dominant: true }, desc: 'Find the single most dominant color in an image.', icon: 'pipette', tags: 'main color average' },
  { id: 'color-blindness-simulator', name: 'Color blindness simulator', desc: 'See images as people with protanopia, deuteranopia and more see them.', icon: 'eye', also: ['dev'], tags: 'accessibility protanopia deuteranopia tritanopia' },
  { id: 'ascii-art', name: 'ASCII art generator', desc: 'Turn images or text into ASCII art you can copy.', icon: 'terminal', tags: 'ascii text art' },
  { id: 'duplicate-images', name: 'Find duplicate images', desc: 'Find duplicate and near-duplicate photos with perceptual hashing.', icon: 'copy', also: ['files'], tags: 'duplicates similar photos phash' },
  { id: 'meme-generator', name: 'Meme generator', desc: 'Add top and bottom captions to any image in classic meme style.', icon: 'laugh', tags: 'meme caption funny' },
  { id: 'gif-maker', name: 'GIF maker', desc: 'Turn a set of images into an animated GIF.', icon: 'film', also: ['media'], tags: 'animated gif animation' },
  { id: 'image-compare', name: 'Image diff', desc: 'Highlight pixel differences between two images.', icon: 'git-compare', tags: 'difference compare pixels' },
]
