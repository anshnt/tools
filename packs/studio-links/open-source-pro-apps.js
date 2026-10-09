// Directory of the ArtCraft native apps (https://github.com/storytold). Data is hardcoded from the org's repos and homepages.
import { h, icon } from '../../lib/ui.js'

const SITE = 'https://getartcraft.com'

// site: getartcraft.com page (only where it loads). studio: our browser version (a studio tool id).
const APPS = [
  { name: 'PhotoCraft', repo: 'photocraft', c: '#0ea5e9', icon: 'camera', like: 'Photoshop-style image editing', desc: 'Retouch and edit photos and images in a free, native app written in Rust.', site: `${SITE}/apps/photocraft`, studio: 'photo-studio' },
  { name: 'LightCraft', repo: 'lightcraft', c: '#f59e0b', icon: 'sliders-horizontal', like: 'Lightroom-style photo editing', desc: 'Organize and adjust your photo library in a free, native app written in Rust.', site: `${SITE}/apps/lightcraft`, studio: 'photo-develop' },
  { name: 'VectorCraft', repo: 'vectorcraft', c: '#f97316', icon: 'pen-tool', like: 'Illustrator-style vector art', desc: 'Draw and edit logos, icons and illustrations as vectors in a free, native app.', site: `${SITE}/apps/vectorcraft`, studio: 'vector-studio' },
  { name: 'FilmCraft', repo: 'filmcraft', c: '#ef4444', icon: 'film', like: 'Premiere-style video editing', desc: 'Cut and arrange video footage on a timeline in a free, native app.', site: `${SITE}/apps/filmcraft`, studio: 'video-studio' },
  { name: 'EffectCraft', repo: 'effectcraft', c: '#a855f7', icon: 'wand-sparkles', like: 'After Effects-style motion', desc: 'Build motion graphics and visual effects with layers and keyframes. Early and moving fast.', studio: 'motion-studio' },
  { name: 'DesignCraft', repo: 'designcraft', c: '#ec4899', icon: 'layout-template', like: 'InDesign-style page layout', desc: 'Lay out pages and publications for print and screen in a free, native app.', studio: 'layout-studio' },
  { name: 'PDFCraft', repo: 'pdfcraft', c: '#dc2626', icon: 'file-text', like: 'Acrobat-style PDF editing', desc: 'Read, edit and organize PDF files in a free, native app written in Rust.', site: `${SITE}/apps/printcraft`, studio: 'pdf-studio' },
  { name: 'SoundCraft', repo: 'soundcraft', c: '#14b8a6', icon: 'audio-waveform', like: 'Pro Tools-style audio', desc: 'Record, edit and mix audio in a free, native app written in Rust.', studio: 'audio-studio' },
  { name: 'DeckCraft', repo: 'deckcraft', c: '#eab308', icon: 'presentation', like: 'PowerPoint-style slides', desc: 'Build presentations and slide shows in a free, native app written in Rust.', studio: 'slides-studio' },
  { name: 'WordCraft', repo: 'wordcraft', c: '#2563eb', icon: 'file-pen', like: 'Word-style documents', desc: 'Write and format documents in a free, native app written in Rust.', studio: 'docs-studio' },
  { name: 'GridCraft', repo: 'gridcraft', c: '#16a34a', icon: 'table', like: 'Excel-style spreadsheets', desc: 'Work with numbers, formulas and tables in a free, native spreadsheet app.', studio: 'sheets-studio' },
  { name: 'CADCraft', repo: 'cadcraft', c: '#64748b', icon: 'drafting-compass', like: 'AutoCAD-style drafting', desc: 'Design and draft technical drawings with computer-aided tools in a free, native app.', studio: 'cad-studio' },
  { name: 'ArtCraft engine', repo: 'artcraft', c: '#5b4cf0', icon: 'sparkles', like: 'An IDE for artists', desc: 'The ArtCraft crafting engine for artists, designers and filmmakers. Its source is public under a fair-source license.', site: SITE, license: 'ArtCraft License (fair source, WIP)' },
]

const STYLE = `
.t-pro-apps .pro-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); }
.t-pro-apps .tool-card { margin: 0; display: flex; flex-direction: column; }
.t-pro-apps .tool-card h3 { padding-right: 0; }
.t-pro-apps .tool-card p { display: block; margin: 0; }
.t-pro-apps .card-body { display: flex; flex: 1; flex-direction: column; gap: 10px; }
.t-pro-apps .card-badges { margin-top: 0; }
.t-pro-apps .card-badges .badge { height: auto; padding: 3px 8px; white-space: normal; }
.t-pro-apps .pro-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; padding-top: 4px; }
.t-pro-apps .pro-intro { margin: 0 0 18px; }
.t-pro-apps .pro-note { margin-top: 20px; }
`

function card(a) {
  return h('article', { class: 'tool-card', style: { '--c': a.c, '--art': '84px', '--rot': '-14deg', '--bx': '45%' } },
    h('div', { class: 'card-art', 'aria-hidden': 'true' }, h('span', { class: 'art-blob' }), h('span', { class: 'art-ring' }), h('div', { class: 'art-icon' }, icon(a.icon))),
    h('div', { class: 'card-body' },
      h('h3', a.name),
      h('p', a.desc),
      h('div', { class: 'card-badges' },
        h('span', { class: 'badge' }, icon('sparkles'), a.like),
        h('span', { class: 'badge' }, icon('scale'), a.license || 'Apache-2.0')),
      h('div', { class: 'pro-links' },
        a.studio && h('a', { class: ['btn', 'btn-primary', 'btn-sm'], href: `#/${a.studio}` }, icon('app-window'), h('span', 'Try a browser version here')),
        h('a', { class: ['btn', 'btn-secondary', 'btn-sm'], href: `https://github.com/storytold/${a.repo}`, target: '_blank', rel: 'noopener noreferrer' }, icon('code'), h('span', 'GitHub repo')),
        a.site && h('a', { class: ['btn', 'btn-secondary', 'btn-sm'], href: a.site, target: '_blank', rel: 'noopener noreferrer' }, icon('globe'), h('span', 'getartcraft.com')))))
}

export function mount(root) {
  root.classList.add('t-pro-apps')
  if (!document.getElementById('t-pro-apps-css')) document.head.append(h('style', { id: 't-pro-apps-css' }, STYLE))
  root.append(
    h('p', { class: 'muted pro-intro' }, 'ArtCraft makes free native apps for photos, video, vectors, layout, audio, office and CAD. Each card links to the project. Where we have a browser version, you can try it here.'),
    h('div', { class: 'pro-grid' }, APPS.map(card)),
    h('p', { class: 'small muted pro-note' }, 'This site is not affiliated with ArtCraft. The native apps are separate downloads, and the browser versions here are separate tools built for this site.'),
  )
}
