// Shared look and building blocks for the image tools: styles (scoped under .ie-*), drop zone with a fan of photos,
// chips, filled sliders, before/after compare, animated results masonry with a sticky download dock, confetti and counters.
import {
  h, icon, button, busy, dropzone, field, rangeField, toast, clear, download, downloadButton, modal, onCleanup, formatBytes, formatNumber,
  yieldToMain, fileType, errorMessage, alert, copyText,
} from '../../lib/ui.js'
import { loadImage, MAX_PIXELS, canvas as makeCanvas, toBlob } from '../../lib/image.js'
import { zip, ext as extOf, baseName, safeName } from '../../lib/files.js'
import { encode, FORMATS, canWrite, resample } from './_encode.js'

export { h, icon, button, busy, field, toast, clear, download, downloadButton, modal, onCleanup, formatBytes, formatNumber, yieldToMain, fileType, errorMessage, alert, copyText, MAX_PIXELS }

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// ---------- Styles ----------
const CSS = `
@property --ie-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
@property --ie-p { syntax: '<number>'; inherits: false; initial-value: 0; }
.ie { display: flex; flex-direction: column; gap: 18px; min-width: 0; --ie-grad: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, var(--accent-2))); }
.ie-glass { background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 94%, transparent), color-mix(in srgb, var(--surface) 80%, transparent)); backdrop-filter: blur(14px) saturate(140%); -webkit-backdrop-filter: blur(14px) saturate(140%); border-radius: 24px; box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,.55); }
:root[data-theme="dark"] .ie-glass { box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,.05); }

/* Drop zone: a fan of photo cards that spreads on hover, with a travelling gradient edge */
.ie-dz { min-height: 270px; gap: 8px; background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--c, var(--accent)) 13%, var(--surface)), var(--surface) 68%); }
.ie-dz::after { content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 2px; pointer-events: none; opacity: 0; transition: opacity .3s;
  background: conic-gradient(from var(--ie-a), transparent 0 52%, var(--accent) 70%, var(--c, #ec4899) 86%, transparent 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; animation: ie-spin 3.4s linear infinite; }
.ie-dz:hover::after, .ie-dz.drag::after, .ie-dz:focus-visible::after { opacity: 1; }
.ie-dz:hover, .ie-dz.drag { border-color: transparent; }
.ie-dz .dz-icon { display: none; }
.ie-dz.compact .dz-icon { display: grid; }
.ie-dz.compact .ie-fan { display: none; }
.ie-dz.compact { min-height: 0; padding: 12px 18px; }
.ie-dz.compact .ie-formats, .ie-dz.compact .ie-private { display: none; }
.ie-dz.compact strong { font-size: 15px; }
@keyframes ie-spin { to { --ie-a: 360deg; } }
.ie-fan { position: relative; width: 200px; height: 116px; margin-bottom: 4px; pointer-events: none; }
.ie-fan i { position: absolute; left: 50%; top: 50%; width: 76px; height: 94px; margin: -47px 0 0 -38px; border-radius: 16px; display: grid; place-items: center; color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--c, var(--accent)) 28%, var(--border)); box-shadow: 0 16px 26px -16px rgba(20,20,50,.45);
  background: linear-gradient(155deg, color-mix(in srgb, var(--c, var(--accent)) 34%, var(--surface)), color-mix(in srgb, var(--accent) 12%, var(--surface)));
  transform: translateX(var(--x)) rotate(var(--r)); transition: transform .7s cubic-bezier(.34, 1.56, .64, 1); }
.ie-fan i:nth-child(1) { --x: -46px; --r: -13deg; opacity: .9; }
.ie-fan i:nth-child(2) { --x: 46px; --r: 13deg; opacity: .9; background: linear-gradient(155deg, color-mix(in srgb, #f59e0b 30%, var(--surface)), color-mix(in srgb, var(--c, #ec4899) 14%, var(--surface))); }
.ie-fan i:nth-child(3) { --x: 0px; --r: 0deg; z-index: 1; background: var(--ie-grad); color: var(--accent-text); box-shadow: 0 20px 30px -14px var(--accent); animation: ie-float 4.5s ease-in-out infinite; }
.ie-fan .icon { width: 30px; height: 30px; }
.ie-dz:hover .ie-fan i:nth-child(1), .ie-dz.drag .ie-fan i:nth-child(1) { --x: -78px; --r: -20deg; }
.ie-dz:hover .ie-fan i:nth-child(2), .ie-dz.drag .ie-fan i:nth-child(2) { --x: 78px; --r: 20deg; }
.ie-dz.drag .ie-fan i:nth-child(3) { transform: translateY(-8px) scale(1.12); }
@keyframes ie-float { 50% { transform: translateY(-6px); } }
.ie-dz strong { font-size: 18px; letter-spacing: -.02em; }
.ie-formats { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; margin-top: 8px; }
.ie-formats span { font-size: 11px; font-weight: 600; letter-spacing: .04em; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 9%, var(--surface-2)); color: var(--text-2); border: 1px solid var(--border); }
.ie-private { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-top: 6px; }
.ie-private .icon { width: 14px; height: 14px; color: var(--success); }

/* Layout */
.ie-work { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
.ie-work.wide-side { grid-template-columns: minmax(0, 1fr) 400px; }
.ie-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.ie-work > * { animation: ie-rise .6s var(--ease) backwards; }
.ie-work > :nth-child(2) { animation-delay: .09s; }
@keyframes ie-rise { from { opacity: 0; transform: translateY(16px); } }
.ie-side { padding: 18px; display: flex; flex-direction: column; gap: 18px; border: 1px solid var(--border); }
.ie-main.pin { position: sticky; top: calc(var(--header-h) + 14px); }
.ie-sec { display: flex; flex-direction: column; gap: 12px; }
.ie-sec + .ie-sec { padding-top: 16px; border-top: 1px dashed var(--border); }
.ie-sec-title { display: flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.ie-sec-title .icon { width: 15px; height: 15px; color: var(--c, var(--accent)); }
.panel > .ie-sec-title { margin-bottom: 12px; }
.ie-sec-title::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, var(--border), transparent); }
.ie-foot { display: flex; flex-direction: column; gap: 10px; }
.ie-row2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ie-row3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.ie-note { font-size: 12.5px; color: var(--muted); line-height: 1.5; }
.ie-note b { color: var(--text-2); font-weight: 600; }

/* Stage */
.ie-stage { position: relative; border-radius: 24px; border: 1px solid var(--border); background: radial-gradient(120% 100% at 50% 0%, color-mix(in srgb, var(--accent) 7%, var(--surface-2)), var(--surface-2)); display: grid; place-items: center; overflow: hidden; min-height: 220px; padding: 12px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.35), inset 0 20px 50px -30px rgba(0,0,0,.25); }
.ie-stage > canvas, .ie-stage > img { display: block; max-width: 100%; max-height: min(68vh, calc(100vh - var(--header-h) - 210px)); min-height: 60px; height: auto; width: auto; border-radius: 8px; background: var(--checker); box-shadow: 0 22px 44px -22px rgba(0,0,0,.45); animation: ie-in .55s var(--ease) both; }
.ie-stage.bare > canvas, .ie-stage.bare > img { box-shadow: none; border-radius: 0; }
.ie-stage.busy::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.28) 50%, transparent 70%); background-size: 200% 100%; animation: ie-shimmer 1.1s linear infinite; pointer-events: none; }
@keyframes ie-in { from { opacity: 0; transform: scale(.965); filter: blur(8px); } }
@keyframes ie-shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }

/* Chips */
.ie-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.ie-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 13px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2);
  font-size: 13.5px; font-weight: 550; cursor: pointer; white-space: nowrap; transition: transform .25s var(--spring), border-color .2s, background .2s, color .2s, box-shadow .25s; }
.ie-chip:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); transform: translateY(-1px); }
.ie-chip:active { transform: scale(.96); }
.ie-chip .icon { width: 15px; height: 15px; }
.ie-chip small { font-size: 11.5px; opacity: .7; font-weight: 500; }
.ie-chip[aria-pressed="true"] { background: var(--ie-grad); color: var(--accent-text); border-color: transparent; box-shadow: 0 10px 20px -12px var(--accent); }
.ie-chip[aria-pressed="true"] small { opacity: .85; }
.ie-chip:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.ie-chips.stretch .ie-chip { flex: 1 1 0; justify-content: center; padding: 0 8px; }

/* Sliders */
.ie input[type="range"] { -webkit-appearance: none; appearance: none; height: 26px; background: transparent; cursor: pointer; --p: 50%; }
.ie input[type="range"]::-webkit-slider-runnable-track { height: 6px; border-radius: 999px; background: linear-gradient(90deg, var(--accent) var(--p), var(--surface-3) var(--p)); }
.ie input[type="range"]::-moz-range-track { height: 6px; border-radius: 999px; background: var(--surface-3); }
.ie input[type="range"]::-moz-range-progress { height: 6px; border-radius: 999px; background: var(--accent); }
.ie input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 20px; height: 20px; margin-top: -7px; border-radius: 50%; background: #fff; border: 2px solid var(--accent); box-shadow: 0 3px 10px -2px rgba(20,20,50,.4); transition: transform .2s var(--spring); }
.ie input[type="range"]::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid var(--accent); box-shadow: 0 3px 10px -2px rgba(20,20,50,.4); }
.ie input[type="range"]:hover::-webkit-slider-thumb, .ie input[type="range"]:active::-webkit-slider-thumb { transform: scale(1.18); }
.ie input[type="range"]:focus-visible { outline: none; }
.ie input[type="range"]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 5px var(--ring); }
.ie .field-label output { font-weight: 600; color: var(--accent); background: var(--accent-soft); padding: 1px 8px; border-radius: 999px; font-size: 12px; }
.ie-color { display: flex; align-items: center; gap: 10px; }
.ie-color input[type="color"] { width: 42px; height: 38px; padding: 3px; border-radius: 11px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; }
.ie-color code { font-size: 12.5px; color: var(--muted); }
.ie-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.ie-swatches button { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; padding: 0; transition: transform .2s var(--spring); }
.ie-swatches button:hover { transform: scale(1.2); }
.ie-swatches button.none { background: var(--checker); }

/* Position grid */
.ie-anchor { display: grid; grid-template-columns: repeat(3, 36px); gap: 5px; padding: 7px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface-2); width: max-content; }
.ie-anchor button { width: 36px; height: 36px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; padding: 0; display: grid; place-items: center; transition: transform .2s var(--spring), background .2s; }
.ie-anchor button::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--border-strong); transition: all .25s var(--spring); }
.ie-anchor button:hover { transform: scale(1.08); }
.ie-anchor button[aria-pressed="true"] { background: var(--ie-grad); border-color: transparent; }
.ie-anchor button[aria-pressed="true"]::after { background: var(--accent-text); width: 11px; height: 11px; }

/* File strip */
.ie-strip { display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px 8px; scrollbar-width: thin; }
.ie-tile { position: relative; flex: none; width: 92px; border-radius: 16px; overflow: hidden; border: 2px solid transparent; background: var(--surface-2); cursor: pointer; padding: 0; text-align: left;
  box-shadow: var(--shadow-sm); transition: transform .3s var(--spring), border-color .2s, box-shadow .3s; animation: ie-pop .45s var(--spring) both; }
.ie-tile:hover { transform: translateY(-3px) rotate(-1deg); }
.ie-tile[aria-current="true"] { border-color: var(--accent); box-shadow: 0 12px 22px -12px var(--accent); }
.ie-tile img, .ie-tile .ph { display: block; width: 100%; height: 72px; object-fit: cover; background: var(--surface-2); }
.ie-tile .ph { display: grid; place-items: center; color: var(--muted); }
.ie-tile .nm { font-size: 11px; padding: 4px 7px 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); }
.ie-tile .x { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 50%; border: 0; display: grid; place-items: center; background: rgba(10,10,20,.62); color: #fff; cursor: pointer; opacity: 0; transform: scale(.7); transition: all .2s var(--spring); }
.ie-tile:hover .x, .ie-tile:focus-within .x { opacity: 1; transform: none; }
@media (hover: none) { .ie-tile .x { opacity: 1; transform: none; } }
.ie-tile .x .icon { width: 13px; height: 13px; }
.ie-tile.add { display: grid; place-items: center; width: 70px; border: 1.5px dashed var(--border-strong); background: transparent; color: var(--muted); box-shadow: none; }
.ie-tile.add:hover { color: var(--accent); border-color: var(--accent); }
.ie-bar { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); animation: ie-in .4s var(--ease) both; }
.ie-bar img, .ie-bar .ph { width: 46px; height: 46px; border-radius: 12px; object-fit: cover; flex: none; background: var(--surface-2); display: grid; place-items: center; color: var(--muted); }
.ie-bar .meta { flex: 1; min-width: 0; }
.ie-bar .nm { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ie-bar .sub { font-size: 12.5px; color: var(--muted); }

/* Compare */
.ie-compare { position: relative; --p: 50%; width: min(100%, calc(var(--maxh, 68vh) * var(--ar, 1.5))); aspect-ratio: var(--ar, 1.5); margin: 0 auto; border-radius: 20px; overflow: hidden; background: var(--checker); touch-action: pan-y; cursor: ew-resize; user-select: none; -webkit-user-select: none; border: 1px solid var(--border); box-shadow: var(--shadow); }
.ie-cmp-layer { position: absolute; inset: 0; }
.ie-cmp-layer > * { display: block; width: 100%; height: 100%; object-fit: fill; max-width: none; max-height: none; pointer-events: none; }
.ie-cmp-before { clip-path: inset(0 calc(100% - var(--p)) 0 0); }
.ie-cmp-knob { position: absolute; top: 0; bottom: 0; left: var(--p); width: 3px; margin-left: -1.5px; background: #fff; border: 0; padding: 0; cursor: ew-resize; box-shadow: 0 0 0 1px rgba(0,0,0,.18), 0 0 20px rgba(0,0,0,.35); }
.ie-cmp-knob::after { content: ""; position: absolute; left: 50%; top: 50%; width: 42px; height: 42px; margin: -21px 0 0 -21px; border-radius: 50%; background: rgba(255,255,255,.92); box-shadow: 0 8px 24px -6px rgba(0,0,0,.5); backdrop-filter: blur(6px); transition: transform .25s var(--spring); }
.ie-cmp-knob .icon { position: absolute; left: 50%; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px; z-index: 1; color: #222; }
.ie-compare:hover .ie-cmp-knob::after, .ie-cmp-knob:focus-visible::after { transform: scale(1.12); }
.ie-cmp-knob:focus-visible { outline: none; }
.ie-cmp-knob:focus-visible::after { box-shadow: 0 0 0 4px var(--ring), 0 8px 24px -6px rgba(0,0,0,.5); }
.ie-tag { position: absolute; top: 12px; padding: 4px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 650; letter-spacing: .04em; color: #fff; background: rgba(12,12,24,.55); backdrop-filter: blur(8px); pointer-events: none; z-index: 2; }
.ie-tag.l { left: 12px; } .ie-tag.r { right: 12px; background: color-mix(in srgb, var(--accent) 75%, #000 10%); }

/* Results masonry */
.ie-results { display: flex; flex-direction: column; gap: 14px; scroll-margin-top: calc(var(--header-h) + 12px); }
.ie-masonry { columns: 3 230px; column-gap: 14px; }
.ie-card { position: relative; break-inside: avoid; margin: 0 0 14px; border-radius: 22px; overflow: hidden; isolation: isolate; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm);
  animation: ie-pop .55s var(--spring) both; animation-delay: calc(var(--i, 0) * 55ms); transition: transform .35s var(--ease), box-shadow .35s var(--ease), border-color .3s; }
.ie-card:hover { transform: translateY(-4px); box-shadow: 0 24px 40px -24px color-mix(in srgb, var(--accent) 60%, rgba(0,0,0,.4)); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
@keyframes ie-pop { from { opacity: 0; transform: translateY(18px) scale(.94); filter: blur(6px); } }
.ie-card-media { position: relative; aspect-ratio: var(--ar, 1.3); background: var(--checker); overflow: hidden; }
.ie-card-media img { display: block; width: 100%; height: 100%; object-fit: cover; transition: transform .8s var(--ease); }
.ie-card:hover .ie-card-media img { transform: scale(1.05); }
.ie-card-over { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: flex-end; gap: 8px; padding: 10px; opacity: 0; transition: opacity .25s;
  background: linear-gradient(180deg, transparent 45%, rgba(8,8,20,.6)); }
.ie-card:hover .ie-card-over, .ie-card:focus-within .ie-card-over { opacity: 1; }
@media (hover: none) { .ie-card-over { opacity: 1; background: none; } }
.ie-fab { width: 38px; height: 38px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; background: rgba(255,255,255,.94); color: #15151f; box-shadow: 0 8px 18px -6px rgba(0,0,0,.5); transition: transform .25s var(--spring); }
.ie-fab:hover { transform: scale(1.12); }
.ie-fab.primary { background: var(--ie-grad); color: var(--accent-text); }
.ie-badge { position: absolute; top: 10px; left: 10px; z-index: 2; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: .01em; color: #fff; background: rgba(12,12,24,.6); backdrop-filter: blur(8px); font-variant-numeric: tabular-nums; }
.ie-badge.good { background: linear-gradient(135deg, #16a34a, #22c55e); }
.ie-badge.warn { background: linear-gradient(135deg, #d97706, #f59e0b); }
.ie-card-body { padding: 11px 14px 13px; }
.ie-card-name { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ie-card-meta { font-size: 12.5px; color: var(--muted); margin-top: 2px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ie-card-meta s { opacity: .65; }
.ie-card-meta b { color: var(--text); font-weight: 600; }
.ie-card.pending .ie-card-media { background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%); background-size: 200% 100%; animation: ie-shimmer 1.2s linear infinite; }
.ie-card.failed { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.ie-card.failed .ie-card-media { display: grid; place-items: center; color: var(--danger); background: var(--danger-soft); aspect-ratio: 2.2; }
.ie-card.failed .icon { width: 28px; height: 28px; }
.ie-dock { position: sticky; bottom: calc(14px + var(--safe-b)); z-index: 20; display: flex; align-items: center; gap: 14px; padding: 10px 10px 10px 14px; border-radius: 22px; border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 84%, transparent); backdrop-filter: blur(16px) saturate(170%); -webkit-backdrop-filter: blur(16px) saturate(170%); box-shadow: var(--shadow-lg); animation: ie-in .5s var(--ease) both; }
.ie-dock-sum { flex: 1; min-width: 0; font-size: 14px; line-height: 1.35; }
.ie-dock-sum b { font-size: 16px; font-variant-numeric: tabular-nums; }
.ie-dock-sum .sub { display: block; font-size: 12.5px; color: var(--muted); }
.ie-dock .btn { flex: none; }
.ie-ring { --ie-p: 0; position: relative; flex: none; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text);
  background: conic-gradient(var(--success) calc(var(--ie-p) * 1%), var(--surface-3) 0); transition: --ie-p 1s var(--ease); -webkit-mask: radial-gradient(circle, transparent 17px, #000 18px); mask: radial-gradient(circle, transparent 17px, #000 18px); }
.ie-ring-wrap { position: relative; flex: none; width: 52px; height: 52px; display: grid; place-items: center; }
.ie-ring-wrap > b { position: absolute; font-size: 12px; font-variant-numeric: tabular-nums; }
.ie-ring.accent { background: conic-gradient(var(--accent) calc(var(--ie-p) * 1%), var(--surface-3) 0); }

/* Stat tiles with a flourish */
.ie-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 168px), 1fr)); gap: 10px; }
.ie-tilestat { position: relative; padding: 14px 15px; border-radius: 18px; border: 1px solid var(--border); background: var(--surface); overflow: hidden; animation: ie-pop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 45ms); }
.ie-tilestat .l { font-size: 12px; color: var(--muted); }
.ie-tilestat .v { font-size: 20px; font-weight: 650; letter-spacing: -.03em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; line-height: 1.2; margin-top: 2px; }
.ie-tilestat .s { font-size: 12px; color: var(--muted); margin-top: 2px; }
.ie-tilestat.hot { background: var(--ie-grad); border-color: transparent; color: var(--accent-text); }
.ie-tilestat.hot .l, .ie-tilestat.hot .s { color: inherit; opacity: .8; }
.ie-tilestat.bad .v { color: var(--danger); }
.ie-tilestat.good .v { color: var(--success); }

.ie-confetti { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 600; }
.ie-hint { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
.ie-hint .icon { width: 15px; height: 15px; color: var(--accent); flex: none; }
.ie-kbd-row { display: flex; flex-wrap: wrap; gap: 8px 14px; }
.ie-pad { padding: 16px; }
.ie-center { text-align: center; }
.ie-modal-img { display: block; max-width: 100%; max-height: 60vh; margin: 0 auto; border-radius: 12px; background: var(--checker); }

@media (max-width: 1000px) {
  .ie-work, .ie-work.wide-side { grid-template-columns: minmax(0, 1fr); } .ie-main.pin { position: static; }
  /* tools with live sliders keep the preview pinned under the header while you scroll the controls */
  .ie-main.pin.live { position: sticky; top: calc(var(--header-h) + 4px); z-index: 12; padding: 6px 0 10px; background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
  .ie-main.live .ie-stage > canvas, .ie-main.live .ie-stage > img { max-height: 32vh; }
  .ie-main.live .ie-stage { padding: 6px; min-height: 100px; }
  .ie-main.live .ie-compare { --maxh: 32vh; }
  .ie-main.live .ie-tiles, .ie-main.live .ie-hint, .ie-main.live > .ie-note { display: none; }
}
@media (max-width: 720px) {
  .ie-masonry { columns: 2; column-gap: 10px; } .ie-card { margin-bottom: 10px; border-radius: 18px; }
  .ie-dz { min-height: 220px; } .ie-fan { transform: scale(.88); }
  .ie-row3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ie-dock { padding: 8px 8px 8px 12px; gap: 10px; } .ie-ring-wrap, .ie-ring { width: 44px; height: 44px; }
  .ie-side { padding: 14px; }
  .ie-stage { padding: 8px; border-radius: 18px; }
}
@media (max-width: 340px) { .ie-masonry { columns: 1; } }
@media (prefers-reduced-motion: reduce) { .ie-dz::after, .ie-fan i:nth-child(3) { animation: none; } .ie-card, .ie-tilestat, .ie-tile, .ie-work > *, .ie-stage > canvas, .ie-stage > img { animation: none; } }
`

export function ensureStyle() {
  if (document.getElementById('ie-style')) return
  document.head.append(h('style', { id: 'ie-style' }, CSS))
}

/** Root wrapper every image tool mounts into. */
export function shell(...kids) {
  ensureStyle()
  return h('div', { class: 'ie' }, ...kids)
}

// ---------- Small components ----------
export const section = (title, ic, ...kids) => h('div', { class: 'ie-sec' }, title && h('div', { class: 'ie-sec-title' }, ic && icon(ic), h('span', title)), ...kids)
export const box = (...kids) => h('section', { class: 'panel ie-glass' }, ...kids)
export const note = (...kids) => h('p', { class: 'ie-note' }, ...kids)
export const hint = (text, ic = 'lightbulb') => h('div', { class: 'ie-hint' }, icon(ic), h('span', text))

/** chips([['a','A'], ['b','B', 'icon-name']], 'a', onChange) -> element with .value and .set(v). */
export function chips(options, value, onChange, { label, stretch = false } = {}) {
  const el = h('div', { class: ['ie-chips', stretch && 'stretch'], role: 'group', 'aria-label': label || null })
  el.value = value
  const render = (opts) => {
    el.replaceChildren(...opts.map((o) => {
      const [v, l, ic, sub] = Array.isArray(o) ? o : [o, o]
      const b = h('button', { type: 'button', class: 'ie-chip', 'aria-pressed': String(v === el.value), disabled: !!o.disabled,
        onclick: () => { if (el.value === v) return; el.set(v); onChange?.(v) } }, ic && icon(ic), h('span', l), sub && h('small', sub))
      b._v = v
      return b
    }))
  }
  el.set = (v) => { el.value = v; for (const b of el.children) b.setAttribute('aria-pressed', String(b._v === v)) }
  el.setOptions = (opts) => render(opts)
  render(options)
  return el
}

/** Toggle chips for picking several values. multiChips([[16,'16'],...], [16,32], onChange(values)) -> element with .values. */
export function multiChips(options, values, onChange, { label } = {}) {
  const el = h('div', { class: 'ie-chips', role: 'group', 'aria-label': label || null })
  el.values = [...values]
  const btns = options.map(([v, l]) => h('button', { type: 'button', class: 'ie-chip', 'aria-pressed': String(el.values.includes(v)), onclick: (e) => {
    el.values = el.values.includes(v) ? el.values.filter((x) => x !== v) : [...el.values, v]
    e.currentTarget.setAttribute('aria-pressed', String(el.values.includes(v)))
    onChange?.(el.values)
  } }, l))
  el.append(...btns)
  el.set = (vals) => { el.values = [...vals]; options.forEach(([v], i) => btns[i].setAttribute('aria-pressed', String(el.values.includes(v)))) }
  return el
}

const fillSlider = (inp) => {
  const min = +inp.min || 0, max = +inp.max || 100
  inp.style.setProperty('--p', `${((inp.valueAsNumber - min) / (max - min || 1)) * 100}%`)
}
/** slider('Quality', {min, max, step, value, onInput, format, hint}) -> field with a filled track. el.input, el.set(v), el.get(). */
export function slider(label, opts) {
  const el = rangeField(label, opts)
  fillSlider(el.input)
  el.input.addEventListener('input', () => fillSlider(el.input))
  const set = el.set
  el.set = (v) => { set(v); fillSlider(el.input) }
  el.get = () => el.input.valueAsNumber
  return el
}

/** colorField('Background', '#ffffff', onInput, {swatches: ['#fff', ...], none}) -> element with .value and .set(). */
export function colorField(label, value, onInput, { swatches = [], none = false } = {}) {
  const inp = h('input', { type: 'color', value: value && value !== 'transparent' ? value : '#ffffff', 'aria-label': label })
  const code = h('code', value || '')
  const el = field(label, h('div', { class: 'ie-color' }, inp, code,
    swatches.length || none ? h('div', { class: 'ie-swatches' }, none && h('button', { type: 'button', class: 'none', 'aria-label': 'Transparent', title: 'Transparent', onclick: () => el.set('transparent', true) }),
      swatches.map((c) => h('button', { type: 'button', style: { background: c }, 'aria-label': c, title: c, onclick: () => el.set(c, true) }))) : null))
  el.value = value
  el.set = (v, fire) => { el.value = v; if (v !== 'transparent') inp.value = v; code.textContent = v; if (fire) onInput?.(v) }
  inp.addEventListener('input', () => el.set(inp.value, true))
  code.textContent = value || ''
  return el
}

export function countUp(el, to, { format = (n) => Math.round(n).toLocaleString(), ms = 850, from = 0 } = {}) {
  if (reduced() || !Number.isFinite(to)) { el.textContent = format(to); return }
  const t0 = performance.now()
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms)
    el.textContent = format(from + (to - from) * (1 - (1 - k) ** 3))
    if (k < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  setTimeout(() => { el.textContent = format(to) }, ms + 150)
}

/** Circular gauge. ring(72) -> {el, set(pct)}. */
export function ring(pct = 0, { accent = false, label } = {}) {
  const r = h('div', { class: ['ie-ring', accent && 'accent'], style: { '--ie-p': 0 } })
  const text = h('b', label ?? `${Math.round(pct)}%`)
  const el = h('div', { class: 'ie-ring-wrap', role: 'img', 'aria-label': 'progress' }, r, text)
  const set = (v, t) => {
    const p = Math.max(0, Math.min(100, v))
    text.textContent = t ?? `${Math.round(p)}%`
    el.setAttribute('aria-label', text.textContent)
    requestAnimationFrame(() => r.style.setProperty('--ie-p', p))
  }
  set(pct, label)
  return { el, set }
}

export function confetti(x = innerWidth / 2, y = innerHeight * 0.7, n = 80) {
  if (reduced() || document.hidden) return
  const c = h('canvas', { class: 'ie-confetti', 'aria-hidden': 'true' })
  c.width = innerWidth; c.height = innerHeight
  document.body.append(c)
  const ctx = c.getContext('2d')
  const colors = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#22c55e', '#0ea5e9']
  const ps = Array.from({ length: n }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9, v = 7 + Math.random() * 9
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 5 + Math.random() * 6, hgt: 3 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: colors[(Math.random() * colors.length) | 0] }
  })
  const t0 = performance.now()
  let alive = true
  const stop = () => { alive = false; c.remove() }
  onCleanup(stop)
  const frame = (t) => {
    if (!alive) return
    const k = (t - t0) / 1500
    ctx.clearRect(0, 0, c.width, c.height)
    for (const p of ps) {
      p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.hgt / 2, p.w, p.hgt); ctx.restore()
    }
    if (k < 1) requestAnimationFrame(frame)
    else stop()
  }
  requestAnimationFrame(frame)
  setTimeout(stop, 2200)
}

// ---------- Object URLs ----------
const urls = new Set()
export function objURL(blob) {
  const u = URL.createObjectURL(blob)
  urls.add(u)
  return u
}
export function revokeURL(u) { if (u && urls.delete(u)) URL.revokeObjectURL(u) }
export function trackCleanup() { onCleanup(() => { for (const u of urls) URL.revokeObjectURL(u); urls.clear() }) }

// ---------- Drop zone ----------
const FORMAT_PILLS = { image: ['JPG', 'PNG', 'WebP', 'GIF', 'AVIF', 'HEIC', 'BMP', 'SVG'] }
/** The tool's drop zone: fan of photo cards, animated edge, paste support. */
export function intake({ accept = 'image/*', multiple = false, label, hint: hintText, onFiles, formats = FORMAT_PILLS.image, ic = 'image-plus', paste = true, compact = false } = {}) {
  ensureStyle()
  trackCleanup()
  const canHover = matchMedia('(hover: hover)').matches
  const zone = dropzone({ accept, multiple, onFiles, label: label || (canHover ? (multiple ? 'Drop images here or click to choose' : 'Drop an image here or click to choose') : (multiple ? 'Tap to choose images' : 'Tap to choose an image')), hint: ' ', icon: 'image-plus', paste, compact })
  zone.classList.add('ie-dz')
  zone.prepend(h('div', { class: 'ie-fan', 'aria-hidden': 'true' }, h('i', icon('image')), h('i', icon('sparkles')), h('i', icon(ic))))
  const hintEl = zone.querySelector('.dz-hint')
  hintEl.textContent = ''
  hintEl.append(...[
    hintText ? h('div', hintText) : null,
    formats?.length ? h('div', { class: 'ie-formats' }, formats.map((f) => h('span', f))) : null,
    h('div', { class: 'ie-private' }, icon('shield-check'), 'Stays on your device. Nothing is uploaded.')].filter(Boolean))
  return zone
}

/** Let any element accept dropped files and forward them to a dropzone. */
export function dropOn(el, zone) {
  el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault() })
  el.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); zone._take([...e.dataTransfer.files]) } })
}

// ---------- Source images ----------
export const isSvg = (file) => /svg/.test(fileType(file)) || extOf(file.name) === 'svg'

const UNIT = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, '': 1 }
const parseLen = (v) => {
  const m = /^\s*([\d.]+)\s*([a-z%]*)\s*$/i.exec(v || '')
  if (!m || m[2] === '%' || !(m[2].toLowerCase() in UNIT)) return null
  return parseFloat(m[1]) * UNIT[m[2].toLowerCase()]
}
/** Intrinsic size of an SVG document string, plus the parsed root. */
export function svgSize(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('This does not look like a valid SVG file.')
  let w = parseLen(root.getAttribute('width')), hh = parseLen(root.getAttribute('height'))
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0
  let guessed = false
  if (!w && !hh && hasVb) { w = vb[2]; hh = vb[3] } else if (w && !hh) hh = hasVb ? (w * vb[3]) / vb[2] : w * 0.5 ; else if (hh && !w) w = hasVb ? (hh * vb[2]) / vb[3] : hh * 2
  if (!w || !hh) { w = 300; hh = 150; guessed = true }
  return { w, h: hh, viewBox: hasVb ? vb : null, root, guessed }
}
/** Render SVG text to a decoded image at w x h pixels. */
export async function rasterSvg(text, w, hh, info = svgSize(text)) {
  const root = info.root.cloneNode(true)
  if (!info.viewBox) root.setAttribute('viewBox', `0 0 ${info.w} ${info.h}`)
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  root.setAttribute('width', String(Math.round(w))); root.setAttribute('height', String(Math.round(hh)))
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }))
  const img = new Image()
  img.src = url
  try { await img.decode() } catch { throw new Error('This SVG could not be drawn. It may reference external files.') } finally { setTimeout(() => URL.revokeObjectURL(url), 2000) }
  return img
}

/** Decode any supported file. Returns {file, img, w, h, name, size, type}. SVGs are rasterised at their intrinsic size. */
export async function readSource(file, { svgScale = 1 } = {}) {
  let img, w, hh
  if (isSvg(file)) {
    const text = await file.text()
    const info = svgSize(text)
    w = Math.round(info.w * svgScale); hh = Math.round(info.h * svgScale)
    img = await rasterSvg(text, w, hh, info)
  } else {
    img = await loadImage(file)
    w = img.naturalWidth; hh = img.naturalHeight
  }
  if (!w || !hh) throw new Error('This image has no size. It may be empty or damaged.')
  if (w * hh > MAX_PIXELS * 1.5) throw new Error(`This image is very large (${w} x ${hh}). Use a smaller one, or shrink it first with Resize image.`)
  return { file, img, w, h: hh, name: file.name, size: file.size, type: fileType(file) }
}

/** An object URL an <img> can always show. Browser-native files use the file itself; HEIC, SVG and others are redrawn smaller as JPG or PNG. */
export async function displayURL(src, max = 2000) {
  if (/^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(src.type)) return objURL(src.file)
  const k = Math.min(1, max / Math.max(src.w, src.h))
  const c = makeCanvas(src.w * k, src.h * k)
  c.getContext('2d').drawImage(src.img, 0, 0, c.width, c.height)
  const png = /svg|png|gif/.test(src.type)
  return objURL(await toBlob(c, png ? 'image/png' : 'image/jpeg', 0.92))
}

/** Scaled-down canvas for responsive live previews. */
export function previewCanvas(img, max = 1400) {
  const w = img.naturalWidth || img.width, hh = img.naturalHeight || img.height
  const k = Math.min(1, max / Math.max(w, hh))
  return resample(img, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(hh * k)))
}

// ---------- Output format ----------
export function sameFormat(type = '', name = '') {
  const t = type.toLowerCase() || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' })[extOf(name)] || ''
  if (t === 'image/jpeg') return 'jpg'
  if (t === 'image/webp') return 'webp'
  if (t === 'image/avif') return canWrite('avif') ? 'avif' : 'webp'
  if (/hei[cf]/.test(t)) return 'jpg'
  return 'png'
}

/**
 * Output chooser: format chips (+ "Same as original"), quality slider for lossy formats, background for JPG.
 * outputPicker({formats: ['jpg','png','webp'], value: 'same', same: true, quality: .92, onChange}) -> {el, get(), resolve(src)}
 */
export function outputPicker({ formats = ['jpg', 'png', 'webp'], value = 'same', same = true, quality = 0.92, background = '#ffffff', onChange, title = 'Save as', showBg = true } = {}) {
  const opts = [...(same ? [['same', 'Same as original']] : []), ...formats.filter(canWrite).map((f) => [f, FORMATS[f].label])]
  if (!opts.some((o) => o[0] === value)) value = opts[0][0]
  const state = { fmt: value, quality, bg: background }
  const q = slider('Quality', { min: 40, max: 100, value: Math.round(quality * 100), format: (v) => `${v}%`, onInput: (v) => { state.quality = v / 100; onChange?.() } })
  const bg = colorField('Background (replaces transparency)', background, (v) => { state.bg = v; onChange?.() }, { swatches: ['#ffffff', '#000000', '#f3f4f6'] })
  const sync = () => {
    const lossy = state.fmt === 'same' || FORMATS[state.fmt]?.lossy
    q.hidden = !lossy
    bg.hidden = !showBg || !(state.fmt === 'jpg' || state.fmt === 'same' || state.fmt === 'bmp')
  }
  const picker = chips(opts, state.fmt, (v) => { state.fmt = v; sync(); onChange?.() }, { label: title })
  const el = section(title, 'file-output', picker, q, bg)
  sync()
  return {
    el, state,
    get: () => ({ ...state }),
    /** Concrete {fmt, quality, bg} for a decoded source (resolves "Same as original"). */
    resolve: (src) => ({ fmt: state.fmt === 'same' ? sameFormat(src?.type, src?.name) : state.fmt, quality: state.quality, bg: state.bg }),
    setFormat: (f) => { state.fmt = f; picker.set(f); sync() },
  }
}
/** Encode with an outputPicker choice. */
export const encodeWith = (canvas, o) => encode(canvas, o.fmt, { quality: o.quality, background: o.fmt === 'jpg' || o.fmt === 'bmp' ? o.bg : undefined })

export const outName = (name, suffix, fmt) => `${safeName(baseName(name) || 'image')}${suffix ? `-${suffix}` : ''}.${FORMATS[fmt]?.ext || fmt}`

// ---------- Single and batch image slots ----------
const thumbIcon = () => h('div', { class: 'ph' }, icon('file-image'))
const canThumb = (f) => /^image\/(jpeg|png|webp|gif|bmp|avif|svg\+xml|x-icon)/.test(fileType(f))

/** A strip of picked files. Click a tile to preview it; the x removes it. */
export function filmstrip({ files = [], onChange, onSelect, accept, zone }) {
  const state = { files: [...files], active: 0 }
  const el = h('div', { class: 'ie-strip', role: 'list', 'aria-label': 'Selected images' })
  const thumbs = new Map()
  const thumb = (f) => {
    if (!canThumb(f)) return thumbIcon(f)
    if (!thumbs.has(f)) thumbs.set(f, objURL(f))
    return h('img', { src: thumbs.get(f), alt: '', decoding: 'async' })
  }
  const render = () => {
    if (state.active >= state.files.length) state.active = Math.max(0, state.files.length - 1)
    for (const [f, u] of thumbs) if (!state.files.includes(f)) { revokeURL(u); thumbs.delete(f) }
    el.replaceChildren(...[...state.files.map((f, i) => h('div', { class: 'ie-tile', role: 'listitem', style: { animationDelay: `${Math.min(i, 8) * 40}ms` }, 'aria-current': String(i === state.active), tabindex: 0, title: `${f.name} (${formatBytes(f.size)})`,
      onclick: () => { state.active = i; render(); onSelect?.(f, i) },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.active = i; render(); onSelect?.(f, i) } } },
    thumb(f), h('div', { class: 'nm' }, f.name),
    h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${f.name}`, onclick: (e) => { e.stopPropagation(); const wasActive = i === state.active; state.files.splice(i, 1); render(); onChange?.(state.files); if (wasActive) onSelect?.(state.files[state.active], state.active) } }, icon('x')))),
    zone && state.files.length ? h('button', { type: 'button', class: 'ie-tile add', 'aria-label': 'Add more images', onclick: () => zone.open() }, icon('plus')) : null].filter(Boolean))
  }
  const api = {
    el, get files() { return state.files }, get active() { return state.files[state.active] },
    add(more) { state.files.push(...more); render(); onChange?.(state.files); if (state.files.length === more.length) onSelect?.(state.files[0], 0) },
    clear() { state.files = []; render(); onChange?.(state.files) },
  }
  render()
  return api
}

/**
 * Multi-file input: drop zone that shrinks once files are picked, plus the strip.
 * batchSlot({accept, onChange(files), onSelect(file), ...intake options}) -> {el, files, active, add, zone}
 */
export function batchSlot({ accept = 'image/*', onChange, onSelect, multiple = true, label, hint: hintText, formats, ic } = {}) {
  let strip
  const zone = intake({ accept, multiple, label, hint: hintText, formats, ic, onFiles: (fs) => { if (!multiple) strip.clear(); strip.add(fs); zone.classList.add('compact') } })
  strip = filmstrip({ zone, onChange: (fs) => { zone.classList.toggle('compact', fs.length > 0); onChange?.(fs) }, onSelect })
  const el = h('div', { class: 'stack' }, zone, strip.el)
  dropOn(strip.el, zone)
  return { el, zone, get files() { return strip.files }, get active() { return strip.active }, add: (fs) => strip.add(fs), clear: () => strip.clear() }
}

/** Single image input. Shows the drop zone until an image is loaded, then a summary bar with Change / Remove. */
export function imageSlot({ accept = 'image/*', onImage, onClear, label, hint: hintText, formats, ic, svgScale } = {}) {
  let src = null
  const zone = intake({ accept, multiple: false, label, hint: hintText, formats, ic, onFiles: ([f]) => load(f) })
  const bar = h('div', { class: 'ie-bar', hidden: true })
  const el = h('div', { class: 'stack' }, zone, bar)
  const showBar = (s) => clear(bar, s.url ? h('img', { src: s.url, alt: '' }) : thumbIcon(),
    h('div', { class: 'meta' }, h('div', { class: 'nm', title: s.name }, s.name), h('div', { class: 'sub' }, `${s.w} x ${s.h} px · ${formatBytes(s.size)}`)),
    button('Change', { icon: 'image-up', size: 'sm', onClick: () => zone.open() }),
    button('', { icon: 'x', variant: 'ghost', size: 'sm', ariaLabel: 'Remove image', onClick: reset }))
  async function load(file) {
    zone.classList.add('compact')
    bar.hidden = false
    clear(bar, h('span', { class: 'spinner' }), h('div', { class: 'meta' }, h('div', { class: 'nm' }, file.name), h('div', { class: 'sub' }, 'Reading image...')))
    try {
      const s = await readSource(file, { svgScale })
      if (src?.url) revokeURL(src.url)
      src = s
      s.url = canThumb(file) ? objURL(file) : null
      showBar(s)
      await onImage?.(s)
    } catch (e) {
      console.error(e)
      toast(errorMessage(e), 'error')
      if (src) showBar(src)
      else reset()
    }
  }
  function reset() { src = null; bar.hidden = true; zone.classList.remove('compact'); onClear?.() }
  return { el, zone, load, reset, get src() { return src } }
}

// ---------- Compare slider ----------
/** compare({before, after, labels}) -> element. before/after are <img> or <canvas>. el.setAspect(w, h), el.setPos(0..100). */
export function compare({ before, after, labels = ['Before', 'After'], aspect = 1.5, maxh } = {}) {
  ensureStyle()
  const knob = h('button', { type: 'button', class: 'ie-cmp-knob', role: 'slider', 'aria-label': 'Drag to compare before and after', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '50' }, icon('chevrons-left-right'))
  const el = h('div', { class: 'ie-compare', style: { '--ar': String(aspect), ...(maxh ? { '--maxh': maxh } : {}) } },
    h('div', { class: 'ie-cmp-layer' }, after), h('div', { class: 'ie-cmp-layer ie-cmp-before' }, before),
    h('span', { class: 'ie-tag l' }, labels[0]), h('span', { class: 'ie-tag r' }, labels[1]), knob)
  const setPos = (p) => { p = Math.max(0, Math.min(100, p)); el.style.setProperty('--p', `${p}%`); knob.setAttribute('aria-valuenow', String(Math.round(p))); el._p = p }
  const fromEvent = (e) => { const r = el.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100) }
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); el._drag = true; fromEvent(e) })
  el.addEventListener('pointermove', (e) => { if (el._drag) fromEvent(e) })
  const end = () => { el._drag = false }
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end)
  knob.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100 }[e.key]
    if (d) { e.preventDefault(); setPos((el._p ?? 50) + d) }
  })
  el.setPos = setPos
  el.setAspect = (w, hh) => el.style.setProperty('--ar', String(w / hh))
  el.setLabels = (a, b) => { el.querySelector('.ie-tag.l').textContent = a; el.querySelector('.ie-tag.r').textContent = b }
  setPos(50)
  return el
}

const ANCHORS = ['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br']
const ANCHOR_NAMES = { tl: 'top left', tc: 'top', tr: 'top right', cl: 'left', cc: 'center', cr: 'right', bl: 'bottom left', bc: 'bottom', br: 'bottom right' }
/** 3 x 3 position picker. Values: tl tc tr cl cc cr bl bc br (vertical then horizontal). el.value, el.set(v). */
export function anchorGrid(value = 'cc', onChange) {
  const el = h('div', { class: 'ie-anchor', role: 'group', 'aria-label': 'Position' })
  el.value = value
  const btns = ANCHORS.map((a) => h('button', { type: 'button', 'aria-label': ANCHOR_NAMES[a], title: ANCHOR_NAMES[a], 'aria-pressed': String(a === value), onclick: () => { el.set(a); onChange?.(a) } }))
  btns.forEach((b, i) => { b._v = ANCHORS[i] })
  el.append(...btns)
  el.set = (v) => { el.value = v; for (const b of btns) b.setAttribute('aria-pressed', String(b._v === v)) }
  return el
}

/** Stage wrapper for a preview element (canvas or img) on a checkerboard. */
export function stage(child, { bare = false } = {}) {
  return h('div', { class: ['ie-stage', bare && 'bare'] }, child)
}

/** Tiles of numbers: tiles([{label, value, sub, hot, good, bad}]). */
export function tiles(items) {
  return h('div', { class: 'ie-tiles', 'aria-live': 'polite' }, items.map((s, i) => h('div', { class: ['ie-tilestat', s.hot && 'hot', s.good && 'good', s.bad && 'bad'], style: { '--i': i } },
    h('div', { class: 'l' }, s.label), h('div', { class: 'v' }, s.value), s.sub && h('div', { class: 's' }, s.sub))))
}

// ---------- Results ----------
const pctChange = (from, to) => (from > 0 ? Math.round((1 - to / from) * 100) : 0)
/**
 * Pinterest-style results with skeletons, a sticky download dock and ZIP.
 * results({zipName, compare: true, noun: 'image'}) -> {el, reset(), pending(file) -> {resolve(item), fail(msg)}, add(item), done(), items}
 * item: {name, blob, w, h, inSize, original?: File, note?, badge?}
 */
export function results({ zipName = 'images.zip', compare: showSavings = true, noun = 'image', cardHint } = {}) {
  ensureStyle()
  trackCleanup()
  const grid = h('div', { class: 'ie-masonry' })
  const sum = h('div', { class: 'ie-dock-sum' })
  const gauge = ring(0)
  const zipBtn = button('Download all (ZIP)', { icon: 'archive', variant: 'primary', size: 'lg' })
  const dock = h('div', { class: 'ie-dock', hidden: true }, gauge.el, sum, zipBtn)
  const el = h('section', { class: 'ie-results', hidden: true, 'aria-live': 'polite', 'aria-label': 'Results' }, grid, dock)
  const api = { el, items: [] }
  let count = 0

  api.reset = () => {
    for (const it of api.items) revokeURL(it.url)
    api.items.length = 0; count = 0
    grid.replaceChildren(); dock.hidden = true; el.hidden = true
  }
  const cardFor = (item, i) => {
    item.url = objURL(item.blob)
    const delta = showSavings && item.inSize ? pctChange(item.inSize, item.blob.size) : null
    const ar = item.w && item.h ? Math.max(0.55, Math.min(1.9, item.w / item.h)) : 1.3
    const dl = () => download(item.blob, item.name)
    return h('article', { class: 'ie-card', style: { '--i': i, '--ar': String(ar) } },
      h('div', { class: 'ie-card-media' },
        h('img', { src: item.url, alt: item.name, loading: 'lazy', decoding: 'async' }),
        item.badge ? h('span', { class: ['ie-badge', item.badgeKind] }, item.badge)
          : delta !== null ? h('span', { class: ['ie-badge', delta > 0 ? 'good' : delta < 0 ? 'warn' : ''] }, delta > 0 ? `-${delta}%` : delta < 0 ? `+${-delta}%` : 'same size') : null,
        h('div', { class: 'ie-card-over' },
          h('button', { type: 'button', class: 'ie-fab', 'aria-label': `Preview ${item.name}`, title: 'Preview', onclick: () => openPreview(item) }, icon('maximize-2')),
          h('button', { type: 'button', class: 'ie-fab primary', 'aria-label': `Download ${item.name}`, title: 'Download', onclick: dl }, icon('download')))),
      h('div', { class: 'ie-card-body' }, h('div', { class: 'ie-card-name', title: item.name }, item.name),
        h('div', { class: 'ie-card-meta' },
          item.inSize ? [h('s', formatBytes(item.inSize)), ' → '] : null, h('b', formatBytes(item.blob.size)),
          item.w ? ` · ${item.w} x ${item.h}` : null, item.note ? ` · ${item.note}` : null)))
  }
  function openPreview(item) {
    const body = [h('img', { class: 'ie-modal-img', src: item.url, alt: item.name }),
      h('div', { class: 'ie-note ie-center' }, `${formatBytes(item.blob.size)}${item.w ? ` · ${item.w} x ${item.h} px` : ''}${item.note ? ` · ${item.note}` : ''}`)]
    modal({ title: item.name, body, actions: [button('Download', { icon: 'download', variant: 'primary', onClick: () => download(item.blob, item.name) })] })
  }
  api.pending = (file) => {
    const i = count++
    const card = h('article', { class: 'ie-card pending', style: { '--i': Math.min(i, 10), '--ar': String([1.3, 0.85, 1.6, 1][i % 4]) } },
      h('div', { class: 'ie-card-media' }), h('div', { class: 'ie-card-body' }, h('div', { class: 'ie-card-name', title: file?.name }, file?.name || 'Image'), h('div', { class: 'ie-card-meta' }, 'Working...')))
    grid.append(card)
    el.hidden = false
    return {
      resolve(item) { api.items.push(item); const c = cardFor(item, 0); c.style.animationDelay = '0ms'; card.replaceWith(c) },
      fail(msg) { card.className = 'ie-card failed'; card.replaceChildren(h('div', { class: 'ie-card-media' }, icon('circle-alert')), h('div', { class: 'ie-card-body' }, h('div', { class: 'ie-card-name', title: file?.name }, file?.name || 'Image'), h('div', { class: 'ie-card-meta' }, msg))) },
    }
  }
  api.add = (item) => { const p = api.pending({ name: item.name }); p.resolve(item) }
  api.done = ({ celebrate = true } = {}) => {
    const n = api.items.length
    if (!n) { dock.hidden = true; return }
    dock.hidden = false
    const total = api.items.reduce((a, b) => a + b.blob.size, 0)
    const before = api.items.reduce((a, b) => a + (b.inSize || 0), 0)
    const cmp = showSavings && before > 0
    const saved = cmp ? pctChange(before, total) : null
    const b1 = h('b')
    const label = `${noun}${n === 1 ? '' : 's'}`
    clear(sum, h('b', `${n} ${label} ready`), h('span', { class: 'sub' }, cmp ? ['Total ', b1, ' (was ', formatBytes(before), ')'] : ['Total ', b1]))
    countUp(b1, total, { format: formatBytes })
    if (cmp && saved > 0) gauge.set(saved, `-${saved}%`)
    else gauge.set(100, `${n}`)
    clear(zipBtn, icon(n === 1 ? 'download' : 'archive'), h('span', n === 1 ? 'Download' : 'Download all (ZIP)'))
    zipBtn.onclick = () => busy(zipBtn, async () => {
      if (n === 1) return download(api.items[0].blob, api.items[0].name)
      download(await zip(api.items.map((it) => ({ name: it.name, data: it.blob }))), zipName)
    }, { label: 'Zipping' })
    if (celebrate) {
      const r = dock.getBoundingClientRect()
      setTimeout(() => confetti(r.left + 40, r.top, 70), 250)
      el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
    }
  }
  return api
}

/**
 * Run a worker over files one by one with skeleton cards, progress and per-file errors.
 * worker(src-file, index) -> item for results.add. Returns the number that succeeded.
 */
export async function runBatch(files, worker, { out, prog, signal, label = 'Processing' }) {
  out.reset()
  const cards = files.map((f) => out.pending(f))
  let ok = 0
  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) break
    prog?.set(i / files.length, `${label} ${files[i].name} (${i + 1} of ${files.length})`)
    await yieldToMain()
    try { cards[i].resolve(await worker(files[i], i)); ok++ } catch (e) { console.error(e); cards[i].fail(errorMessage(e)) }
  }
  if (signal?.aborted) return ok
  prog?.set(1, 'Done')
  out.done({ celebrate: ok > 0 })
  return ok
}

export { zip, resample, encode, FORMATS, canWrite, extOf, baseName, safeName }
