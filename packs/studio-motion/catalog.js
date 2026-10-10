// Pack studio-motion: Motion Studio, a browser editor in the spirit of Adobe After Effects (see the open-source EffectCraft by ArtCraft:
// https://github.com/storytold/effectcraft). Default category: studio.
export const cat = 'studio'
export default [
  { id: 'motion-studio', name: 'Motion Studio', desc: 'Keyframe motion graphics with text and shapes; export video or GIF.', icon: 'film', layout: 'app', tags: 'after effects alternative animation keyframes motion graphics timeline video editor gif', module: 'motion-studio', ready: true },
  { id: 'motion-title-reveal', name: 'Animated title maker', desc: 'Start from a kinetic title template: type your text, tweak the timing, export MP4, WebM or GIF.', icon: 'type', layout: 'app', module: 'motion-studio', params: { template: 'title-reveal' }, tags: 'animated text title intro kinetic typography gif video maker', ready: true },
  { id: 'motion-lower-third', name: 'Lower third maker', desc: 'Animated name and title bar for videos: edit the text and colours, then export with a transparent background.', icon: 'rectangle-horizontal', layout: 'app', module: 'motion-studio', params: { template: 'lower-third' }, tags: 'lower third name tag caption overlay streaming youtube png sequence', ready: true },
  { id: 'motion-logo-reveal', name: 'Logo reveal maker', desc: 'Animated logo sting with a drawn-on ring, popping shape and letter-by-letter wordmark.', icon: 'hexagon', layout: 'app', module: 'motion-studio', params: { template: 'logo-reveal' }, tags: 'logo animation intro sting reveal square video gif', ready: true },
]
