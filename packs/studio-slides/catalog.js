// Pack studio-slides: Slides Studio, a browser slide deck editor. Default category: studio.
export const cat = 'studio'
export default [
  { id: 'slides-studio', name: 'Slides Studio', desc: 'Design slide decks with themes, text, images and shapes; present full screen; export PPTX and PDF.', icon: 'presentation', layout: 'app', tags: 'powerpoint keynote alternative slides deck presentation pptx present speaker notes', module: 'slides-studio', ready: true },
  { id: 'pitch-deck-maker', name: 'Pitch Deck Maker', desc: 'Start from a ready pitch deck with problem, solution, traction, team and ask. Edit it, present it, export PPTX or PDF.', icon: 'rocket', layout: 'app', tags: 'startup investor pitch deck template slides presentation pptx', module: 'slides-studio', params: { template: 'pitch', ns: 'pitch' }, ready: true },
  { id: 'lesson-slides-maker', name: 'Lesson Slides Maker', desc: 'Start from a lesson template with goals, key ideas, practice and a summary. Present full screen or export PPTX.', icon: 'graduation-cap', layout: 'app', tags: 'teacher lesson plan class slides presentation template school pptx', module: 'slides-studio', params: { template: 'lesson', ns: 'lesson' }, ready: true },
  { id: 'outline-to-slides', name: 'Outline to Slides', desc: 'Type or paste an outline and get a themed slide deck you can edit, present and download as PPTX or PDF.', icon: 'list-tree', layout: 'app', tags: 'outline text to slides powerpoint generate deck bullets markdown', module: 'slides-studio', params: { start: 'outline', ns: 'outline' }, ready: true },
]
