// Pack studio-video: Video Studio, a browser editor in the spirit of Adobe Premiere Pro (see the open-source FilmCraft by ArtCraft:
// https://github.com/storytold/filmcraft). Default category: studio. Focused entries open the same editor with a quick start.
export const cat = 'studio'
export default [
  { id: 'video-studio', name: 'Video Studio', desc: 'Multi-track video editor: cut, trim and arrange clips, titles, transitions and music; export MP4.', icon: 'clapperboard', layout: 'app', tags: 'premiere alternative video editor timeline cut trim multitrack', ready: true },
  { id: 'vertical-video-editor', name: 'Vertical Video Editor', desc: 'Edit 9:16 clips for Reels, Shorts and TikTok: trim, add captions and music, export MP4.', icon: 'smartphone', layout: 'app', module: 'video-studio', params: { aspect: '9:16' }, tags: 'reels shorts tiktok portrait 9:16 vertical video edit', ready: true },
  { id: 'photo-slideshow-maker', name: 'Photo Slideshow Maker', desc: 'Turn photos into a slideshow video with crossfades, titles and music; export MP4.', icon: 'images', layout: 'app', module: 'video-studio', params: { template: 'slideshow' }, tags: 'slideshow photo video maker crossfade music memories', ready: true },
  { id: 'video-title-maker', name: 'Video Title and Caption Maker', desc: 'Add titles, lower thirds and captions with fades to a video clip; export MP4.', icon: 'captions', layout: 'app', module: 'video-studio', params: { template: 'titles' }, tags: 'titles captions lower third text overlay subtitles video', ready: true },
]
