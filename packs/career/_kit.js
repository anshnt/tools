// Shared look and helpers for the career pack: one scoped stylesheet (.cr-*), score rings, chips, count-up numbers,
// a pointer-based sortable list (works on touch), a save indicator and small utilities. Nothing here touches the shell.
import { h, svg, icon, button, toast, clear, onCleanup, download, field, input, textarea, select } from '../../lib/ui.js'
import { marked, dompurify } from '../../lib/libs.js'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
export const uid = () => Math.random().toString(36).slice(2, 9)
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const CSS = String.raw`
.cr { --cr: var(--c, #0d9b8a); --cr-soft: color-mix(in srgb, var(--cr) 9%, var(--surface)); --cr-line: color-mix(in srgb, var(--cr) 24%, var(--border)); }
.cr .stack { gap: 16px; }
@keyframes crDrift { 0% { background-position: 0% 30%, 100% 70%, 0 0; } 100% { background-position: 100% 70%, 0% 30%, 0 0; } }
@keyframes crPop { from { opacity: 0; transform: translateY(8px) scale(.86); } to { opacity: 1; transform: none; } }
@keyframes crRise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes crShine { to { transform: translateX(120%); } }
@keyframes crFly { 0% { transform: translate(0, 0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(.4); opacity: 0; } }
@keyframes crBlink { 50% { opacity: .35; } }

.cr-banner {
  position: relative; overflow: hidden; isolation: isolate; display: flex; align-items: center; gap: 12px 18px; flex-wrap: wrap; padding: 14px 18px;
  border-radius: var(--radius-xl); border: 1px solid var(--cr-line); background: var(--surface);
}
.cr-banner::before {
  content: ""; position: absolute; inset: 0; z-index: -1; opacity: .9; background-size: 160% 160%, 160% 160%, 100% 100%;
  background-image:
    radial-gradient(60% 120% at 0% 0%, color-mix(in srgb, var(--cr) 26%, transparent), transparent 70%),
    radial-gradient(50% 110% at 100% 100%, color-mix(in srgb, #a855f7 18%, transparent), transparent 70%),
    linear-gradient(var(--surface), var(--surface));
  animation: crDrift 16s ease-in-out infinite alternate;
}
.cr-banner .cr-b-ic { width: 40px; height: 40px; border-radius: 13px; display: grid; place-items: center; color: #fff; flex: none;
  background: linear-gradient(140deg, color-mix(in srgb, var(--cr) 70%, #fff), var(--cr) 55%, color-mix(in srgb, var(--cr) 70%, #000)); box-shadow: 0 10px 22px -10px var(--cr); }
.cr-banner .cr-b-text { flex: 1 1 240px; min-width: 0; font-size: 14px; color: var(--text-2); }
.cr-banner .cr-b-text b { color: var(--text); font-weight: 650; }
.cr-steps { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
.cr-steps li { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px 0 5px; border-radius: 999px; font-size: 12.5px; font-weight: 550; color: var(--text-2);
  background: color-mix(in srgb, var(--surface) 78%, transparent); border: 1px solid var(--border); backdrop-filter: blur(6px); animation: crPop .5s var(--spring) both; animation-delay: calc(var(--i, 0) * 90ms + 120ms); }
.cr-steps li b { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; color: #fff; background: var(--cr); }

.cr-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; min-width: 0; box-shadow: var(--shadow-sm); }
.cr-card.tint { background: linear-gradient(160deg, var(--cr-soft), var(--surface) 70%); border-color: var(--cr-line); }
.cr-card > .cr-h, .cr-h { display: flex; align-items: center; gap: 10px; margin: 0 0 14px; font-size: 15.5px; font-weight: 650; letter-spacing: -.02em; }
.cr-h .tile { width: 32px; height: 32px; border-radius: 10px; --c: var(--cr); }
.cr-h .tile .icon { width: 16px; height: 16px; }
.cr-h .aside { margin-left: auto; font-size: 12.5px; font-weight: 500; color: var(--muted); display: inline-flex; align-items: center; gap: 8px; letter-spacing: 0; }
.cr-rise { animation: crRise .55s var(--ease) both; animation-delay: calc(var(--i, 0) * 70ms); }

/* score ring */
.cr-ring { position: relative; display: inline-grid; place-items: center; width: var(--sz, 148px); height: var(--sz, 148px); color: var(--danger); }
.cr-ring.mid { color: var(--warning); } .cr-ring.hi { color: var(--success); }
.cr-ring svg { width: 100%; height: 100%; display: block; overflow: visible; }
.cr-ring .track { stroke: var(--surface-3); }
.cr-ring .arc { stroke: currentColor; transition: stroke-dashoffset 1.2s var(--ease), stroke .4s; filter: drop-shadow(0 4px 8px color-mix(in srgb, currentColor 40%, transparent)); }
.cr-ring .mid-text { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; }
.cr-ring .num { font-size: calc(var(--sz, 148px) * .3); font-weight: 700; letter-spacing: -.04em; line-height: 1; color: var(--text); font-variant-numeric: tabular-nums; }
.cr-ring .lab { font-size: 11.5px; color: var(--muted); margin-top: 4px; font-weight: 550; text-transform: uppercase; letter-spacing: .08em; }

/* chips */
.cr-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.cr-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 11px; border-radius: 999px; font-size: 13px; font-weight: 550; color: var(--text-2);
  border: 1px solid var(--border); background: var(--surface); animation: crPop .45s var(--spring) both; animation-delay: calc(min(var(--i, 0), 30) * 18ms); max-width: 100%; overflow-wrap: anywhere; }
.cr-chip .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); flex: none; }
.cr-chip small { font-size: 11px; font-weight: 600; color: var(--muted); }
.cr-chip.ok { background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 28%, transparent); color: var(--text); }
.cr-chip.ok .dot { background: var(--success); }
.cr-chip.miss { background: var(--danger-soft); border-color: color-mix(in srgb, var(--danger) 28%, transparent); color: var(--text); }
.cr-chip.miss .dot { background: var(--danger); }
.cr-chip.warn { background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 30%, transparent); color: var(--text); }
.cr-chip.warn .dot { background: var(--warning); }
.cr-chip.info { background: var(--info-soft); border-color: color-mix(in srgb, var(--info) 26%, transparent); color: var(--text); }
.cr-chip.info .dot { background: var(--info); }
.cr-chip.btn-chip { cursor: pointer; font: inherit; font-size: 13px; font-weight: 550; }
.cr-chip.btn-chip:hover { border-color: var(--cr); color: var(--text); transform: translateY(-1px); }
.cr-chip.btn-chip[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }

/* bento tiles */
.cr-bento { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 176px), 1fr)); gap: 12px; }
.cr-tile { position: relative; overflow: hidden; padding: 16px; border-radius: 22px; min-width: 0; --t: var(--cr);
  background: linear-gradient(155deg, color-mix(in srgb, var(--t) 11%, var(--surface)), var(--surface) 70%); border: 1px solid color-mix(in srgb, var(--t) 24%, var(--border));
  transition: transform .3s var(--ease), box-shadow .3s var(--ease); animation: crRise .55s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms); }
.cr-tile:hover { transform: translateY(-3px); box-shadow: 0 18px 36px -22px color-mix(in srgb, var(--t) 70%, rgba(0, 0, 0, .3)); }
.cr-tile .k { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
.cr-tile .k .icon { width: 16px; height: 16px; color: var(--t); }
.cr-tile .v { font-size: 26px; font-weight: 700; letter-spacing: -.035em; margin-top: 6px; line-height: 1.15; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.cr-tile .d { font-size: 12.5px; color: var(--muted); margin-top: 4px; overflow-wrap: anywhere; }
.cr-tile.ok { --t: var(--success); } .cr-tile.warn { --t: var(--warning); } .cr-tile.bad { --t: var(--danger); } .cr-tile.info { --t: var(--info); }
.cr-tile.wide { grid-column: span 2; }

/* checks */
.cr-checks { display: grid; gap: 8px; }
.cr-check { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border-radius: 16px; border: 1px solid var(--border); background: var(--surface); animation: crRise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 40ms); }
.cr-check .ic { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; flex: none; background: var(--surface-2); color: var(--muted); }
.cr-check .ic .icon { width: 16px; height: 16px; }
.cr-check.ok .ic { background: var(--success-soft); color: var(--success); }
.cr-check.warn .ic { background: var(--warning-soft); color: var(--warning); }
.cr-check.bad .ic { background: var(--danger-soft); color: var(--danger); }
.cr-check .t { font-weight: 600; font-size: 14px; }
.cr-check .t small { font-weight: 500; color: var(--muted); margin-left: 6px; }
.cr-check .d { font-size: 13px; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }

/* editor items */
.cr-list { display: flex; flex-direction: column; gap: 10px; }
.cr-item { position: relative; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); transition: box-shadow .25s, border-color .25s, transform .2s; animation: crRise .4s var(--ease) both; }
.cr-item.open { border-color: var(--cr-line); box-shadow: var(--shadow-sm); }
.cr-item.dragging { z-index: 20; box-shadow: var(--shadow-lg); border-color: var(--accent); transition: none; animation: none; }
.cr-item.hidden-sec { opacity: .55; }
.cr-item-h { display: flex; align-items: center; gap: 4px; padding: 6px 8px 6px 4px; min-height: 48px; }
.cr-item-h .lbl { flex: 1; min-width: 0; cursor: pointer; padding: 6px 4px; display: flex; flex-direction: column; background: none; border: 0; text-align: left; font: inherit; color: inherit; }
.cr-item-h .lbl b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-item-h .lbl small { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cr-item-b { padding: 4px 14px 16px; display: none; }
.cr-item.open > .cr-item-b { display: block; animation: crRise .3s var(--ease) both; }
.cr-item .chev { transition: transform .25s var(--ease); }
.cr-item.open > .cr-item-h .chev { transform: rotate(180deg); }
.cr-handle { cursor: grab; touch-action: none; width: 30px; height: 36px; display: grid; place-items: center; color: var(--muted); border-radius: 8px; border: 0; background: none; flex: none; }
.cr-handle:hover { color: var(--text); background: var(--surface-2); }
.cr-handle:active { cursor: grabbing; }
.cr-sec-ic { width: 30px; height: 30px; border-radius: 10px; display: grid; place-items: center; flex: none; color: var(--cr); background: color-mix(in srgb, var(--cr) 12%, transparent); margin-right: 6px; }
.cr-sec-ic .icon { width: 16px; height: 16px; }
.cr-sub { border-top: 1px dashed var(--border); margin-top: 12px; padding-top: 12px; }
.cr-add { width: 100%; justify-content: center; border-style: dashed; }

/* save indicator */
.cr-saved { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); }
.cr-saved i { width: 8px; height: 8px; border-radius: 50%; background: var(--success); display: block; }
.cr-saved.dirty i { background: var(--warning); animation: crBlink 1s infinite; }

/* preview stage */
.cr-stage { position: relative; isolation: isolate; border-radius: var(--radius-xl); border: 1px solid var(--cr-line); padding: 16px; overflow: auto; }
.cr-stage::before { content: ""; position: absolute; inset: 0; z-index: -1; background-size: 180% 180%, 180% 180%, 100% 100%; animation: crDrift 22s ease-in-out infinite alternate;
  background-image: radial-gradient(60% 50% at 10% 0%, color-mix(in srgb, var(--cr) 22%, transparent), transparent 70%), radial-gradient(50% 50% at 100% 100%, color-mix(in srgb, #a855f7 16%, transparent), transparent 70%), linear-gradient(var(--surface-2), var(--surface-2)); }
.cr-paper { background: #fff; border-radius: 4px; box-shadow: 0 1px 2px rgba(0, 0, 0, .08), 0 28px 60px -28px rgba(16, 16, 40, .5); line-height: 0; overflow: hidden; margin: 0 auto; animation: crRise .5s var(--ease) both; }
.cr-paper + .cr-paper { margin-top: 14px; }
.cr-paper canvas { display: block; width: 100%; height: auto; }
.cr-wait { position: absolute; top: 12px; right: 12px; z-index: 3; }
.cr-pages { font-size: 12px; color: var(--muted); text-align: center; margin-top: 10px; }

/* template picker */
.cr-tpls { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 10px; }
.cr-tpl { display: flex; flex-direction: column; gap: 8px; align-items: stretch; padding: 8px; border-radius: 16px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; font: inherit; color: inherit; text-align: left; transition: border-color .2s, box-shadow .2s, transform .25s var(--spring); }
.cr-tpl:hover { transform: translateY(-3px); border-color: var(--border-strong); }
.cr-tpl[aria-pressed="true"] { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.cr-tpl span { font-size: 12.5px; font-weight: 600; padding: 0 2px; }
.cr-tpl small { font-weight: 450; color: var(--muted); display: block; font-size: 11.5px; }
.cr-thumb { aspect-ratio: 3 / 4; border-radius: 8px; background: #fff; border: 1px solid var(--border); padding: 9% 10%; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
.cr-thumb i { display: block; height: 3px; border-radius: 2px; background: #cfd2d8; }
.cr-thumb i.h { height: 6px; width: 55%; background: var(--k, #222); }
.cr-thumb i.s { height: 2px; width: 90%; background: var(--k, #222); opacity: .6; margin-top: 3px; }
.cr-thumb i.w60 { width: 60%; } .cr-thumb i.w80 { width: 80%; } .cr-thumb i.c { margin-inline: auto; }
.cr-swatches { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.cr-sw { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; background: var(--k); padding: 0; transition: transform .2s var(--spring); }
.cr-sw:hover { transform: scale(1.12); }
.cr-sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); transform: scale(1.1); }

/* responsive two-pane workspace */
.cr-work { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
.cr-work.wide-left { grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); }
.cr-sticky { position: sticky; top: calc(var(--header-h) + 12px); max-height: calc(100vh - var(--header-h) - 24px); overflow: auto; }
.cr-switch { display: none; position: sticky; top: calc(var(--header-h) + 6px); z-index: 25; justify-content: center; padding: 6px 0; }
.cr-switch .seg { background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(10px); box-shadow: var(--shadow); }
@media (max-width: 900px) {
  .cr-work, .cr-work.wide-left { grid-template-columns: minmax(0, 1fr); }
  .cr-switch { display: flex; }
  .cr-work[data-pane="edit"] > .cr-pane-preview, .cr-work[data-pane="preview"] > .cr-pane-edit { display: none; }
  .cr-sticky { position: static; max-height: none; overflow: visible; }
  .cr-tile.wide { grid-column: auto; }
}
.cr-burst { position: fixed; z-index: 500; pointer-events: none; width: 0; height: 0; }
.cr-burst i { position: absolute; left: 0; top: 0; width: 8px; height: 8px; border-radius: 2px; animation: crFly .9s var(--ease) both; }
.cr-kbd-hint { font-size: 12px; color: var(--muted); }
.cr-md { color: var(--text-2); overflow-wrap: anywhere; font-size: 14.5px; }
.cr-md h1, .cr-md h2, .cr-md h3 { color: var(--text); margin: 1.1em 0 .4em; font-size: 1.05em; }
.cr-md p, .cr-md ul, .cr-md ol { margin: 0 0 .75em; } .cr-md ul, .cr-md ol { padding-left: 1.3em; }
.cr-out { font-size: 14.5px; line-height: 1.6; }
.cr-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 22px; padding: 6px 2px; }
.cr-tilt { transition: transform .25s var(--ease); transform-style: preserve-3d; will-change: transform; }
.cr-cardface { display: block; width: 100%; height: auto; border-radius: 12px; box-shadow: 0 2px 4px rgba(0, 0, 0, .12), 0 28px 50px -24px rgba(16, 16, 40, .55); background: #fff; }
.cr-mailbox { background: #fff; color: #27272a; border: 1px solid var(--border); border-radius: 14px; padding: 22px 22px 20px; min-height: 140px; overflow-x: auto; line-height: normal; transition: background .25s, color .25s; }
.cr-mailbox.dark { filter: invert(.9) hue-rotate(180deg); }
.cr-mailbox.dark img { filter: invert(1) hue-rotate(180deg); }
.cr-mailbox a { text-decoration: none; }
.cr-logo { max-height: 48px; max-width: 130px; border-radius: 8px; border: 1px solid var(--border); background: #fff; padding: 4px; object-fit: contain; }
.cr-slide { container-type: inline-size; position: relative; aspect-ratio: 16 / 9; width: 100%; overflow: hidden; border-radius: 10px; box-shadow: 0 1px 2px rgba(0, 0, 0, .1), 0 22px 44px -26px rgba(16, 16, 40, .55); text-align: left; }
.cr-slide.small { border-radius: 6px; box-shadow: 0 1px 2px rgba(0, 0, 0, .12); pointer-events: none; }
.cr-sl-el { position: absolute; overflow: hidden; }
.cr-sl-li { position: relative; }
.cr-sl-b { position: absolute; top: 0; opacity: .85; }
.cr-stage-deck { border-radius: 16px; background: var(--surface-2); padding: 12px; border: 1px solid var(--border); display: grid; place-items: center; }
.cr-stage-deck:fullscreen { background: #000; padding: 0; border: 0; border-radius: 0; }
.cr-stage-deck:fullscreen .cr-slide { width: min(100vw, 177.78vh); border-radius: 0; }
.cr-strip { display: flex; gap: 10px; overflow-x: auto; padding: 6px 2px 10px; scroll-snap-type: x proximity; }
.cr-thumb-s { flex: none; width: 150px; position: relative; padding: 3px; border: 2px solid transparent; background: none; border-radius: 12px; cursor: pointer; scroll-snap-align: start; transition: transform .2s var(--spring), border-color .2s; animation: crRise .4s var(--ease) both; animation-delay: calc(var(--i, 0) * 40ms); }
.cr-strip.settled .cr-thumb-s { animation: none; }
.cr-thumb-s:hover { transform: translateY(-2px); }
.cr-thumb-s.on { border-color: var(--accent); }
.cr-thumb-s .n { position: absolute; left: 9px; bottom: 9px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 7px; display: grid; place-items: center; font-size: 11px; font-weight: 600; color: #fff; background: rgba(0, 0, 0, .55); }
.cr-cat { display: grid; grid-template-columns: 138px minmax(0, 1fr); gap: 6px 14px; align-items: start; padding: 8px 0; border-top: 1px dashed var(--border); }
.cr-cat:first-of-type { border-top: 0; }
.cr-cat > .k { font-size: 12.5px; font-weight: 600; color: var(--muted); padding-top: 6px; }
@media (max-width: 600px) { .cr-cat { grid-template-columns: minmax(0, 1fr); } .cr-cat > .k { padding-top: 0; } }
.cr-menu { position: relative; }
.cr-menu > summary { list-style: none; cursor: pointer; }
.cr-menu > summary::-webkit-details-marker { display: none; }
.cr-menu-list { position: absolute; left: 0; top: calc(100% + 6px); z-index: 40; min-width: 220px; padding: 6px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-lg); display: grid; gap: 2px; animation: crPop .2s var(--spring) both; }
.cr-menu-list .btn { justify-content: flex-start; width: 100%; }
.cr-diff { border: 1px solid var(--border); border-radius: 16px; background: var(--surface); overflow: hidden; min-width: 0; }
.cr-diff-h { padding: 8px 14px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); background: var(--surface-2); border-bottom: 1px solid var(--border); }
.cr-diff > div:last-child { padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14.5px; line-height: 1.65; min-height: 120px; }
.cr-diff ins { text-decoration: none; background: color-mix(in srgb, var(--success) 20%, transparent); border-radius: 4px; padding: 0 2px; animation: crPop .35s var(--spring) both; }
.cr-diff del { background: color-mix(in srgb, var(--danger) 18%, transparent); border-radius: 4px; padding: 0 2px; text-decoration-color: var(--danger); }
.cr-search { position: relative; max-width: 560px; }
.cr-search > .icon { position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; width: 20px; height: 20px; }
.cr-search .input { height: 52px; padding-left: 46px; border-radius: 16px; box-shadow: var(--shadow); font-size: 15.5px; }
.cr-masonry { columns: 3 240px; column-gap: 14px; }
.cr-tcard { break-inside: avoid; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; text-align: left; margin: 0 0 14px; padding: 16px; border-radius: 22px; border: 1px solid var(--border);
  background: linear-gradient(160deg, color-mix(in srgb, var(--cr) 9%, var(--surface)), var(--surface) 65%); cursor: pointer; font: inherit; color: inherit; position: relative; overflow: hidden;
  transition: transform .3s var(--ease), box-shadow .3s var(--ease), border-color .3s; animation: crRise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 35ms); }
.cr-tcard:nth-child(3n + 1) { padding-bottom: 24px; }
.cr-tcard:hover { transform: translateY(-4px); border-color: var(--cr-line); box-shadow: 0 20px 38px -22px color-mix(in srgb, var(--cr) 70%, rgba(0, 0, 0, .3)); }
.cr-tcard b { font-size: 15px; letter-spacing: -.015em; }
.cr-tcard small { color: var(--muted); font-size: 13px; line-height: 1.45; }
.cr-tcard .tile { margin-bottom: 4px; --c: var(--cr); }
.cr-snip { display: -webkit-box; -webkit-line-clamp: var(--clamp, 3); -webkit-box-orient: vertical; overflow: hidden; font-size: 12.5px; line-height: 1.5; color: var(--text-2); opacity: .75; padding: 9px 11px; margin-top: 6px; border-radius: 12px; background: color-mix(in srgb, var(--surface) 70%, transparent); border: 1px dashed color-mix(in srgb, var(--cr) 30%, var(--border)); font-style: italic; }
.cr-tag { margin-top: 4px; font-size: 11.5px; font-weight: 600; color: var(--muted); padding: 2px 9px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); }
.cr-letter.textarea { font-family: Georgia, "Times New Roman", serif; font-size: 15px; line-height: 1.7; background: #fff; color: #1b1b1f; padding: 26px 28px; border-radius: 6px; min-height: 420px; border-color: var(--border); box-shadow: 0 1px 2px rgba(0, 0, 0, .06), 0 22px 44px -26px rgba(16, 16, 40, .45); }
.cr-letter.textarea:focus { border-color: var(--accent); }
.cr-letter.textarea::placeholder { color: #8a8a94; }
.cr-meter { height: 6px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.cr-meter i { display: block; height: 100%; width: var(--w, 0%); border-radius: inherit; background: var(--cr); transition: width .5s var(--ease), background .3s; }
.cr-meter.over i { background: var(--danger); } .cr-meter.warn i { background: var(--warning); }
@media (prefers-reduced-motion: reduce) { .cr *, .cr *::before, .cr *::after { animation: none !important; } }
`

let injected = false
export function injectCss() {
  if (injected || document.getElementById('cr-style')) { injected = true; return }
  injected = true
  document.head.append(h('style', { id: 'cr-style' }, CSS))
}

/** Wrapper element every career tool mounts into. */
export function shell(...kids) {
  injectCss()
  return h('div', { class: 'cr stack' }, ...kids)
}

/** Studio banner: icon + one line of value + numbered flow pills. */
export function banner({ icon: ic, text, steps = [] }) {
  return h('div', { class: 'cr-banner' },
    h('div', { class: 'cr-b-ic' }, icon(ic)),
    h('div', { class: 'cr-b-text', html: text }),
    steps.length ? h('ol', { class: 'cr-steps' }, steps.map((s, i) => h('li', { style: { '--i': i } }, h('b', i + 1), s))) : null)
}

/** Card with a tinted icon tile heading. */
export function card(title, ic, ...kids) {
  let aside = null
  if (kids[0] && kids[0].__aside) aside = kids.shift().__aside
  return h('section', { class: ['cr-card'] },
    title && h('h2', { class: 'cr-h' }, ic && h('span', { class: 'tile' }, icon(ic)), h('span', title), aside ? h('span', { class: 'aside' }, aside) : null), kids)
}
export const aside = (...n) => ({ __aside: n })

export const bandOf = (v) => (v >= 75 ? 'hi' : v >= 50 ? 'mid' : 'lo')

/** Animated number. */
export function countUp(el, to, { dur = 900, decimals = 0, suffix = '', from = 0 } = {}) {
  const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix
  if (reduced() || !Number.isFinite(to) || dur <= 0) { el.textContent = fmt(to); return }
  const t0 = performance.now()
  const tick = () => {
    const p = Math.min(1, (performance.now() - t0) / dur)
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)))
    if (p < 1) setTimeout(tick, 16)
  }
  tick()
}

/** Score ring 0-100. Returns element with .set(value). */
export function ring(value = 0, { label = 'score', size = 148, stroke = 10 } = {}) {
  const R = 60 - stroke / 2 - 2
  const C = 2 * Math.PI * R
  const arc = svg('circle', { class: 'arc', cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': C, 'stroke-dashoffset': C, transform: 'rotate(-90 60 60)' })
  const num = h('div', { class: 'num' }, '0')
  const el = h('div', { class: 'cr-ring', role: 'img', style: { '--sz': `${size}px` } },
    svg('svg', { viewBox: '0 0 120 120', 'aria-hidden': 'true' }, svg('circle', { class: 'track', cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': stroke }), arc),
    h('div', { class: 'mid-text' }, num, h('div', { class: 'lab' }, label)))
  el.set = (v) => {
    const n = Math.max(0, Math.min(100, Math.round(v)))
    el.className = `cr-ring ${bandOf(n)}`
    el.setAttribute('aria-label', `${label}: ${n} out of 100`)
    setTimeout(() => { arc.style.strokeDashoffset = C * (1 - n / 100) }, 40)
    countUp(num, n, { dur: 1100 })
  }
  el.set(value)
  return el
}

export const chip = (text, kind = '', opts = {}) => h('span', { class: ['cr-chip', kind], style: { '--i': opts.i ?? 0 }, title: opts.title },
  kind && h('span', { class: 'dot' }), h('span', text), opts.count > 1 ? h('small', `x${opts.count}`) : null)

export function tile({ icon: ic, label, value, hint, kind = '', i = 0, wide = false }) {
  return h('div', { class: ['cr-tile', kind, wide && 'wide'], style: { '--i': i } },
    h('div', { class: 'k' }, ic && icon(ic), label), h('div', { class: 'v' }, value), hint ? h('div', { class: 'd' }, hint) : null)
}

export function check(kind, title, detail, extra, i = 0) {
  const ic = { ok: 'check', warn: 'triangle-alert', bad: 'x', info: 'info' }[kind] || 'info'
  return h('div', { class: ['cr-check', kind], style: { '--i': i } }, h('div', { class: 'ic' }, icon(ic)),
    h('div', { style: 'min-width:0;flex:1' }, h('div', { class: 't' }, title, extra ? h('small', extra) : null), detail ? h('div', { class: 'd' }, detail) : null))
}

/** Little confetti burst from an element (or the screen centre). */
export function burst(anchor) {
  if (reduced()) return
  const r = anchor?.getBoundingClientRect?.()
  const cx = r ? r.left + r.width / 2 : innerWidth / 2
  const cy = r ? r.top + r.height / 2 : innerHeight / 3
  const colors = ['#6366f1', '#a855f7', '#ec4899', '#f97316', '#0d9b8a', '#eab308']
  const box = h('div', { class: 'cr-burst', style: { left: `${cx}px`, top: `${cy}px` }, 'aria-hidden': 'true' })
  for (let i = 0; i < 18; i++) {
    const a = (Math.PI * 2 * i) / 18 + Math.random() * 0.4
    const d = 50 + Math.random() * 70
    box.append(h('i', { style: { background: colors[i % colors.length], '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d - 20}px`, '--rot': `${Math.random() * 360}deg` } }))
  }
  document.body.append(box)
  setTimeout(() => box.remove(), 1000)
}

/** Debounced autosave indicator: const s = saveIndicator(); s.dirty(); s.saved(). */
export function saveIndicator(label = 'Saved on this device') {
  const text = h('span', label)
  const el = h('span', { class: 'cr-saved', 'aria-live': 'polite' }, h('i'), text)
  return { el, dirty() { el.classList.add('dirty'); text.textContent = 'Saving...' }, saved(t = label) { el.classList.remove('dirty'); text.textContent = t } }
}

/**
 * Pointer-based sortable list (mouse, touch and keyboard). Children matching `item` need a data-id; handles matching `handle`
 * start the drag. onSort(ids) is called with the new order of data-ids.
 */
export function sortable(container, { handle = '.cr-handle', item = '.cr-item', onSort } = {}) {
  const items = () => [...container.children].filter((c) => c.matches(item))
  const ids = () => items().map((c) => c.dataset.id)
  container.addEventListener('pointerdown', (e) => {
    const hd = e.target.closest(handle)
    if (!hd || (e.button && e.button !== 0)) return
    const it = hd.closest(item)
    if (!it || it.parentElement !== container) return
    e.preventDefault()
    hd.setPointerCapture?.(e.pointerId)
    let startY = e.clientY + scrollY, lastY = e.clientY, moved = false
    it.classList.add('dragging')
    const apply = () => {
      const y = lastY + scrollY
      it.style.transform = `translateY(${y - startY}px)`
      const mid = it.getBoundingClientRect().top + it.offsetHeight / 2
      for (const dir of [-1, 1]) {
        const sib = dir < 0 ? it.previousElementSibling : it.nextElementSibling
        if (!sib || !sib.matches(item)) continue
        const sr = sib.getBoundingClientRect()
        if ((dir < 0 && mid < sr.top + sr.height / 2) || (dir > 0 && mid > sr.top + sr.height / 2)) {
          const before = it.offsetTop
          if (dir < 0) container.insertBefore(it, sib)
          else container.insertBefore(sib, it)
          startY += it.offsetTop - before
          it.style.transform = `translateY(${y - startY}px)`
          moved = true
          break
        }
      }
    }
    const timer = setInterval(() => {
      if (lastY < 70) scrollBy(0, -14)
      else if (lastY > innerHeight - 70) scrollBy(0, 14)
      else return
      apply()
    }, 16)
    const move = (ev) => { lastY = ev.clientY; apply() }
    const up = () => {
      clearInterval(timer)
      hd.removeEventListener('pointermove', move)
      hd.removeEventListener('pointerup', up)
      hd.removeEventListener('pointercancel', up)
      it.classList.remove('dragging')
      it.style.transform = ''
      if (moved) onSort?.(ids())
    }
    hd.addEventListener('pointermove', move)
    hd.addEventListener('pointerup', up)
    hd.addEventListener('pointercancel', up)
  })
  container.addEventListener('keydown', (e) => {
    const hd = e.target.closest(handle)
    if (!hd || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    const it = hd.closest(item)
    const sib = e.key === 'ArrowUp' ? it.previousElementSibling : it.nextElementSibling
    if (!sib || !sib.matches(item)) return
    e.preventDefault()
    if (e.key === 'ArrowUp') container.insertBefore(it, sib)
    else container.insertBefore(sib, it)
    hd.focus()
    onSort?.(ids())
  })
}

/** Grip handle button (keyboard: arrow up/down moves the item). */
export const handle = (label = 'Drag to reorder (or use the up and down arrow keys)') =>
  h('button', { type: 'button', class: 'cr-handle', 'aria-label': label, title: label }, icon('grip-vertical'))

/** Save a Blob or string as a file. Deferred one tick so a download started from a click handler never races the page (headless Edge closes the tab otherwise). */
export const saveAs = (data, name, type) => setTimeout(() => download(data, name, type), 250)

/** Download text content. */
export const textBlob = (text, type = 'text/plain;charset=utf-8') => new Blob([text], { type })

/** Render Markdown safely (marked + DOMPurify) into an element. */
export async function renderMarkdown(el, md) {
  const [m, purify] = await Promise.all([marked(), dompurify()])
  el.innerHTML = purify.sanitize(m.parse(md))
}

/** Open a mailto: link (warns when the body is long enough that mail clients may cut it). */
export function openMail({ to = '', subject = '', body = '' }) {
  const url = `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body).replace(/%0A/g, '%0D%0A')}`
  if (url.length > 1900) toast('This email is long, so your mail app may cut it off. Copy the text instead if that happens.', 'info', 6000)
  location.href = url
}

/** Dropdown menu button: moreMenu('More', 'ellipsis', [{label, icon, onClick}]). Closes on outside click and Escape. */
export function moreMenu(label, ic, items) {
  const det = h('details', { class: 'cr-menu' })
  const sum = h('summary', { class: 'btn btn-ghost btn-sm', 'aria-haspopup': 'menu' }, icon(ic), h('span', label), icon('chevron-down'))
  const list = h('div', { class: 'cr-menu-list', role: 'menu' }, items.map((it) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', role: 'menuitem', onclick: () => { det.open = false; it.onClick() } }, icon(it.icon), h('span', it.label))))
  det.append(sum, list)
  const away = (e) => { if (det.open && !det.contains(e.target)) det.open = false }
  const esc_ = (e) => { if (e.key === 'Escape' && det.open) { det.open = false; sum.focus() } }
  document.addEventListener('click', away)
  document.addEventListener('keydown', esc_)
  onCleanup(() => { document.removeEventListener('click', away); document.removeEventListener('keydown', esc_) })
  return det
}

/** Clear and fill a container, returning it. */
export const fill = (el, ...kids) => clear(el, ...kids)

/** Count characters like LinkedIn does (code points). */
export const len = (s) => [...(s || '')].length

export { onCleanup, button }

/**
 * Two-way bound text field: fi(state, 'name', 'Full name', {ph, area, rows, type, hint, ac, mode}, onChange) -> field element.
 * state[key] is read once and updated on every keystroke.
 */
export function fi(state, key, label, o = {}, onChange) {
  const ctl = o.area ? textarea({ rows: o.rows || 3, placeholder: o.ph }) : input({ placeholder: o.ph, type: o.type || 'text', autocomplete: o.ac || 'off', inputmode: o.mode })
  ctl.value = state[key] ?? ''
  ctl.addEventListener('input', () => { state[key] = ctl.value; onChange?.(key, ctl.value) })
  const el = field(label, ctl, o.hint)
  el.ctl = ctl
  return el
}

/** Bound select: fs(state, 'tone', 'Tone', [['a','A']], onChange). */
export function fs(state, key, label, options, onChange, hint) {
  const el = field(label, select(options, state[key], (v) => { state[key] = v; onChange?.(key, v) }), hint)
  return el
}

/** Shared "who am I" profile: remembered by the letter, email, signature and bio tools; falls back to the saved resume contact. */
import { load as loadStore, save as saveStore } from '../../lib/store.js'
export function getProfile() {
  const p = loadStore('career:profile', {}) || {}
  const r = loadStore('resume:data', null)
  const c = r && !r.sample && r.contact ? r.contact : {}
  const pick = (k, alt) => p[k] || c[alt || k] || ''
  return { name: pick('name'), title: pick('title'), email: pick('email'), phone: pick('phone'), location: pick('location'), website: pick('website'), linkedin: pick('linkedin'), company: p.company || '' }
}
export const setProfile = (patch) => saveStore('career:profile', { ...(loadStore('career:profile', {}) || {}), ...patch })
export const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
export const firstName = (n) => (n || '').trim().split(/\s+/)[0] || ''

/** Styled runs ({text, bold, italic, code}) -> DOM nodes. */
export const runsToHtml = (rs) => rs.map((r) => (r.bold || r.italic || r.code ? h('span', { style: { fontWeight: r.bold ? 700 : null, fontStyle: r.italic ? 'italic' : null, fontFamily: r.code ? 'var(--mono)' : null } }, r.text) : r.text))
