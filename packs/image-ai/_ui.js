// Shared look and feel for the image-ai pack: studio layout, animated stage, before/after slider, option cards, swatches,
// queue strip and small delights. Everything is scoped under `.ia` so it never leaks into the rest of the site.
import { h, icon, button, dropzone, onCleanup, clear } from '../../lib/ui.js'

const CSS = `
@property --ia-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.ia { --ia-glass: color-mix(in srgb, var(--surface) 76%, transparent); --ia-line: color-mix(in srgb, var(--border) 75%, transparent); --ia-glow: color-mix(in srgb, var(--accent) 38%, transparent); display: flex; flex-direction: column; gap: 16px; }
.ia * { box-sizing: border-box; }

/* ---------- Steps ---------- */
.ia-steps { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.ia-step { display: inline-flex; align-items: center; gap: 8px; padding: 4px 13px 4px 5px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); transition: all .35s var(--ease); }
.ia-step b { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 650; background: var(--surface-2); color: var(--text-2); transition: all .35s var(--spring); }
.ia-step.on { color: var(--text); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); box-shadow: 0 8px 20px -12px var(--accent); }
.ia-step.on b { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff; transform: scale(1.08); }
.ia-step.done b { background: var(--success); color: #fff; }
.ia-step-sep { width: 16px; height: 1px; background: var(--border-strong); }

/* ---------- Hero drop ---------- */
.ia-hero { position: relative; border-radius: 30px; padding: 2px; animation: ia-spin 9s linear infinite;
  background: conic-gradient(from var(--ia-a), color-mix(in srgb, var(--accent) 80%, transparent), transparent 22%, color-mix(in srgb, var(--accent-2) 70%, transparent) 48%, transparent 72%, color-mix(in srgb, var(--accent) 80%, transparent)); }
@keyframes ia-spin { to { --ia-a: 360deg; } }
.ia-hero .dropzone { border: 0; border-radius: 28px; min-height: 320px; background: radial-gradient(520px 260px at 50% 0%, color-mix(in srgb, var(--accent) 11%, transparent), transparent 70%), var(--surface); }
.ia-hero .dropzone strong { font-size: 20px; letter-spacing: -.02em; }
.ia-hero .dropzone .dz-hint { max-width: 420px; margin-inline: auto; }
.ia-art { position: absolute; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
.ia-art i { position: absolute; width: 58px; height: 58px; border-radius: 18px; display: grid; place-items: center; color: var(--c, var(--accent)); background: color-mix(in srgb, var(--surface) 86%, transparent); border: 1px solid color-mix(in srgb, var(--c, var(--accent)) 28%, var(--border)); box-shadow: 0 16px 34px -18px color-mix(in srgb, var(--c, var(--accent)) 75%, transparent); animation: ia-float 7s ease-in-out infinite; animation-delay: calc(var(--d, 0) * -1s); }
.ia-art i .icon { width: 24px; height: 24px; }
.ia-art i:nth-child(1) { left: 7%; top: 14%; --c: #8b5cf6; --d: 1; }
.ia-art i:nth-child(2) { right: 8%; top: 18%; --c: #ec4899; --d: 3; width: 50px; height: 50px; }
.ia-art i:nth-child(3) { left: 14%; bottom: 14%; --c: #0ea5e9; --d: 5; width: 46px; height: 46px; }
.ia-art i:nth-child(4) { right: 13%; bottom: 12%; --c: #f59e0b; --d: 2; }
@keyframes ia-float { 0%, 100% { transform: translateY(0) rotate(-5deg); } 50% { transform: translateY(-14px) rotate(5deg); } }
.ia-feats { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.ia-feat { display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px 6px 10px; border-radius: 999px; font-size: 13px; color: var(--text-2); background: var(--ia-glass); border: 1px solid var(--border); backdrop-filter: blur(8px); }
.ia-feat .icon { width: 15px; height: 15px; color: var(--accent); }

/* ---------- Studio layout ---------- */
.ia-studio { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
.ia-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.ia-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; position: sticky; top: calc(var(--header-h) + 14px); }
.ia-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 22px; padding: 6px 16px; box-shadow: var(--shadow-sm); min-width: 0; }
.ia-sec { border-bottom: 1px solid var(--border); padding: 4px 0; }
.ia-sec:last-child { border-bottom: 0; }
.ia-sec > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 9px; min-height: 44px; font-weight: 600; font-size: 14.5px; letter-spacing: -.01em; user-select: none; }
.ia-sec > summary::-webkit-details-marker { display: none; }
.ia-sec > summary .icon { width: 17px; height: 17px; color: var(--accent); }
.ia-sec > summary .chev { margin-left: auto; color: var(--muted); transition: transform .3s var(--ease); }
.ia-sec[open] > summary .chev { transform: rotate(180deg); }
.ia-sec-body { display: flex; flex-direction: column; gap: 13px; padding: 2px 0 16px; animation: ia-rise .35s var(--ease) both; }
@keyframes ia-rise { from { opacity: 0; transform: translateY(8px); } }
@keyframes ia-pop { from { opacity: 0; transform: scale(.6); } }

/* ---------- Stage ---------- */
.ia-stage { position: relative; border-radius: 26px; overflow: hidden; isolation: isolate; border: 1px solid var(--border); background: var(--checker); display: grid; place-items: center; padding: 14px; min-height: 280px; box-shadow: var(--shadow-sm); }
.ia-stage.on-white { background: #fff; }
.ia-stage.on-dark { background: #0d0d12; }
.ia-stage.on-plain { background: var(--surface-2); }
.ia-stage canvas, .ia-stage img.ia-img { display: block; max-width: 100%; height: auto; max-height: 72vh; border-radius: 10px; }
.ia-fit { position: relative; width: min(100%, calc(72vh * var(--ar, 1))); aspect-ratio: var(--ar, 1); margin: 0 auto; }
.ia-fit > canvas, .ia-fit > img { position: absolute; inset: 0; width: 100%; height: 100%; max-height: none; border-radius: 0; }
.ia-chip { position: absolute; z-index: 5; display: inline-flex; align-items: center; gap: 7px; max-width: calc(100% - 28px); padding: 5px 11px 5px 9px; border-radius: 999px; font-size: 12.5px; color: var(--text); background: var(--ia-glass); border: 1px solid var(--ia-line); backdrop-filter: blur(14px) saturate(160%); -webkit-backdrop-filter: blur(14px) saturate(160%); box-shadow: var(--shadow-sm); }
.ia-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ia-chip .icon { width: 14px; height: 14px; color: var(--accent); flex: none; }
.ia-chip.tl { top: 12px; left: 12px; }
.ia-chip.tr { top: 12px; right: 12px; }
.ia-chip.bl { bottom: 12px; left: 12px; }
.ia-chip.br { bottom: 12px; right: 12px; }
.ia-chip.bc { bottom: 12px; left: 50%; transform: translateX(-50%); }
.ia-tools { position: absolute; z-index: 6; top: 10px; right: 10px; display: flex; gap: 4px; padding: 4px; border-radius: 14px; background: var(--ia-glass); border: 1px solid var(--ia-line); backdrop-filter: blur(14px); box-shadow: var(--shadow-sm); }
.ia-tools .btn { height: 32px; }
.ia-reveal { animation: ia-reveal 1s var(--ease) both; }
@keyframes ia-reveal { from { clip-path: circle(0% at 50% 50%); filter: saturate(1.6) brightness(1.15); } to { clip-path: circle(80% at 50% 50%); } }

/* ---------- Scan FX ---------- */
.ia-scan { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; overflow: hidden; pointer-events: none; opacity: 0; transition: opacity .35s; }
.ia-scan.on { opacity: 1; pointer-events: auto; }
.ia-scan::before { content: ""; position: absolute; left: 0; right: 0; height: 38%; top: -38%; background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--accent) 34%, transparent) 70%, color-mix(in srgb, var(--accent-2) 70%, transparent) 99%, transparent); border-bottom: 2px solid color-mix(in srgb, var(--accent-2) 90%, #fff); box-shadow: 0 6px 24px 0 var(--ia-glow); animation: ia-sweep 2.1s var(--ease) infinite; }
.ia-scan::after { content: ""; position: absolute; inset: 0; background-image: radial-gradient(circle, color-mix(in srgb, var(--accent) 40%, transparent) 1px, transparent 1.5px); background-size: 18px 18px; mask-image: radial-gradient(70% 70% at 50% 50%, #000, transparent); -webkit-mask-image: radial-gradient(70% 70% at 50% 50%, #000, transparent); opacity: .6; animation: ia-twinkle 2.4s ease-in-out infinite; }
@keyframes ia-sweep { 0% { top: -38%; } 100% { top: 100%; } }
@keyframes ia-twinkle { 50% { opacity: .25; } }
.ia-scan-card { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 9px; min-width: min(300px, 86%); padding: 14px 16px; border-radius: 18px; background: var(--ia-glass); border: 1px solid var(--ia-line); backdrop-filter: blur(16px) saturate(170%); -webkit-backdrop-filter: blur(16px) saturate(170%); box-shadow: var(--shadow-lg); }
.ia-scan-row { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 550; }
.ia-scan-row .spinner { color: var(--accent); }
.ia-scan-bar { height: 5px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.ia-scan-bar i { display: block; height: 100%; width: 0; background: var(--brand); background-size: 200% 100%; border-radius: inherit; transition: width .25s var(--ease); animation: shimmer 2s linear infinite; }
.ia-scan-bar.ind i { width: 40%; animation: indet 1.2s ease-in-out infinite; }
.ia-scan-sub { font-size: 12px; color: var(--muted); }
.ia-scan-cancel { position: absolute; z-index: 3; bottom: 14px; left: 50%; transform: translateX(-50%); }

/* ---------- Compare slider ---------- */
.ia-cmp { --p: 50%; position: relative; width: min(100%, calc(72vh * var(--ar, 1))); aspect-ratio: var(--ar, 1); margin: 0 auto; border-radius: 12px; overflow: hidden; touch-action: pan-y; cursor: ew-resize; user-select: none; -webkit-user-select: none; outline-offset: 3px; }
.ia-cmp > .ia-cmp-layer { position: absolute; inset: 0; }
.ia-cmp > .ia-cmp-layer > canvas, .ia-cmp > .ia-cmp-layer > img { width: 100%; height: 100%; display: block; max-height: none; border-radius: 0; object-fit: fill; }
.ia-cmp-b { clip-path: inset(0 calc(100% - var(--p)) 0 0); }
.ia-cmp-bar { position: absolute; top: 0; bottom: 0; left: var(--p); width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .12), 0 0 18px rgba(0, 0, 0, .35); z-index: 3; pointer-events: none; }
.ia-cmp-knob { position: absolute; top: 50%; left: 50%; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; display: grid; place-items: center; background: var(--ia-glass); color: var(--text); border: 1px solid var(--ia-line); backdrop-filter: blur(10px); box-shadow: var(--shadow); transition: transform .25s var(--spring); }
.ia-cmp:hover .ia-cmp-knob, .ia-cmp:focus-visible .ia-cmp-knob, .ia-cmp.drag .ia-cmp-knob { transform: scale(1.14); }
.ia-cmp-knob .icon { width: 18px; height: 18px; }
.ia-cmp-tag { position: absolute; bottom: 10px; z-index: 4; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 550; color: #fff; background: rgba(10, 10, 16, .55); backdrop-filter: blur(8px); pointer-events: none; }
.ia-cmp.static { cursor: default; touch-action: auto; }
.ia-cmp.static .ia-cmp-bar, .ia-cmp.static .ia-cmp-tag { opacity: 0; }
.ia-cmp.static.ia-movable[data-view="result"] { cursor: grab; touch-action: none; }
.ia-cmp.static.ia-movable[data-view="result"]:active { cursor: grabbing; }
.ia-cmp-bar, .ia-cmp-tag { transition: opacity .3s; }
.ia-cmp-tag.l { left: 10px; }
.ia-cmp-tag.r { right: 10px; }

/* ---------- Option cards ---------- */
.ia-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 8px; }
.ia-opts.col { grid-template-columns: minmax(0, 1fr); }
.ia-opt { position: relative; text-align: left; display: flex; flex-direction: column; gap: 5px; padding: 11px 12px; border-radius: 15px; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text); transition: border-color .2s, box-shadow .25s, transform .25s var(--spring), background .2s; min-width: 0; }
.ia-opt:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow); }
.ia-opt[aria-checked="true"] { border-color: var(--accent); background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 10%, var(--surface)), var(--surface) 70%); box-shadow: 0 0 0 3px var(--ring), var(--shadow); }
.ia-opt[aria-checked="true"]::after { content: ""; position: absolute; top: 9px; right: 9px; width: 18px; height: 18px; border-radius: 50%; background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 12.5 4.5 4.5L19 7.5'/%3E%3C/svg%3E") center / 11px no-repeat; animation: ia-pop .35s var(--spring); }
.ia-opt-t { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 14px; letter-spacing: -.01em; padding-right: 22px; }
.ia-opt-t .icon { width: 16px; height: 16px; color: var(--accent); flex: none; }
.ia-opt-d { font-size: 12.5px; color: var(--muted); line-height: 1.4; }
.ia-opt-m { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; font-size: 11.5px; color: var(--text-2); }
.ia-tag { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11px; font-weight: 550; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); white-space: nowrap; }
.ia-tag.ok { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 25%, transparent); }
.ia-tag.hot { color: var(--accent); background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 25%, transparent); }
.ia-dots { display: inline-flex; gap: 2px; align-items: center; }
.ia-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--surface-3); }
.ia-dots i.on { background: var(--accent); }

/* ---------- Swatches ---------- */
.ia-sws { display: flex; flex-wrap: wrap; gap: 8px; }
.ia-sw { position: relative; width: 34px; height: 34px; border-radius: 50%; border: 0; padding: 0; cursor: pointer; background: var(--sw); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .14); transition: transform .25s var(--spring), box-shadow .2s; overflow: hidden; }
.ia-sw:hover { transform: scale(1.12); }
.ia-sw[aria-pressed="true"] { transform: scale(1.1); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .14), 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
.ia-sw.rainbow { background: conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e); }
.ia-sw input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.ia-sw.none { background: var(--checker); }

/* ---------- Queue strip ---------- */
.ia-strip { display: flex; gap: 8px; overflow-x: auto; padding: 4px 2px 6px; scrollbar-width: thin; }
.ia-th { position: relative; flex: none; width: 66px; height: 66px; border-radius: 15px; overflow: hidden; border: 2px solid transparent; padding: 0; cursor: pointer; background: var(--surface-2); transition: transform .25s var(--spring), border-color .2s; animation: ia-pop .35s var(--spring) both; }
.ia-th:hover { transform: translateY(-2px); }
.ia-th.active { border-color: var(--accent); box-shadow: 0 8px 18px -10px var(--accent); }
.ia-th img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ia-th .dot { position: absolute; left: 5px; bottom: 5px; width: 12px; height: 12px; border-radius: 50%; background: var(--border-strong); border: 2px solid var(--surface); }
.ia-th .dot.run { background: var(--accent); animation: pulse 1.4s infinite; }
.ia-th .dot.done { background: var(--success); }
.ia-th .dot.error { background: var(--danger); }
.ia-thw { position: relative; flex: none; }
.ia-x { position: absolute; top: 3px; right: 3px; z-index: 2; width: 20px; height: 20px; border-radius: 50%; display: none; place-items: center; background: rgba(10, 10, 16, .65); color: #fff; border: 0; cursor: pointer; padding: 0; }
.ia-thw:hover .ia-x, .ia-thw:focus-within .ia-x { display: grid; }
@media (hover: none) { .ia-x { display: grid; } }
.ia-x .icon { width: 12px; height: 12px; }
.ia-add { flex: none; width: 66px; height: 66px; border-radius: 15px; border: 1.5px dashed var(--border-strong); background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; transition: all .2s; }
.ia-add:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }

/* ---------- Result / done ---------- */
.ia-done { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border-radius: 20px; border: 1px solid color-mix(in srgb, var(--success) 28%, var(--border)); background: linear-gradient(135deg, color-mix(in srgb, var(--success) 9%, var(--surface)), var(--surface) 65%); animation: ia-rise .45s var(--ease) both; }
.ia-done-h { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.ia-done-h .ok { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: var(--success); color: #fff; animation: ia-pop .5s var(--spring) both; }
.ia-done-h .ok .icon { width: 17px; height: 17px; }
.ia-done-h small { font-weight: 400; color: var(--muted); }
.ia-next { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: var(--muted); }
.ia-next a, .ia-next button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); cursor: pointer; font-size: 13px; transition: all .2s var(--ease); }
.ia-next a:hover, .ia-next button:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.ia-next .icon { width: 14px; height: 14px; }
.ia-dev { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 11.5px; font-weight: 550; color: var(--text-2); background: var(--surface-2); border: 1px solid var(--border); }
.ia-dev .icon { width: 13px; height: 13px; }
.ia-dev.gpu { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 25%, transparent); }
.ia-spark { position: absolute; z-index: 20; pointer-events: none; width: 14px; height: 14px; margin: -7px 0 0 -7px; color: var(--c, #f59e0b); animation: ia-spark .9s var(--ease) both; }
@keyframes ia-spark { 0% { opacity: 1; transform: translate(0, 0) scale(.2) rotate(0); } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(1) rotate(160deg); } }

/* ---------- Misc ---------- */
.ia-note { font-size: 12.5px; color: var(--muted); display: flex; gap: 7px; align-items: flex-start; line-height: 1.45; }
.ia-note .icon { width: 14px; height: 14px; margin-top: 2px; flex: none; }
.ia-actionbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.ia-actionbar .grow { flex: 1 1 auto; }
.ia-sticky { position: sticky; bottom: calc(10px + var(--safe-b)); z-index: 12; padding: 8px; border-radius: 20px; background: var(--ia-glass); border: 1px solid var(--ia-line); backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: blur(16px) saturate(160%); box-shadow: var(--shadow-lg); }
.ia-kbd { display: inline-flex; gap: 6px; align-items: center; }
.ia-kbd kbd { font-size: 15px; padding: 6px 12px; border-radius: 10px; box-shadow: 0 3px 0 var(--border-strong); animation: ia-key 2.4s ease-in-out infinite; }
.ia-kbd kbd + span + kbd { animation-delay: .25s; }
@keyframes ia-key { 0%, 70%, 100% { transform: none; box-shadow: 0 3px 0 var(--border-strong); } 80% { transform: translateY(3px); box-shadow: 0 0 0 var(--border-strong); } }
.ia-grid-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 10px; }
.ia-tile { position: relative; border-radius: 16px; overflow: hidden; border: 1px solid var(--border); background: var(--checker); aspect-ratio: 1; display: grid; place-items: center; animation: ia-pop .4s var(--spring) both; }
.ia-tile img, .ia-tile canvas { max-width: 100%; max-height: 100%; display: block; }
.ia-tile .ia-chip { max-width: calc(100% - 12px); }
.ia-range-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.ia .field-label { font-weight: 550; }
.ia-sec .seg { display: flex; width: 100%; }
.ia-sec .seg button { flex: 1 1 auto; padding: 0 8px; font-size: 13px; }
.ia-sec .ia-sw { width: 30px; height: 30px; }
.ia-sws { gap: 7px; }
@media (max-width: 1020px) {
  .ia-studio { grid-template-columns: minmax(0, 1fr); }
  .ia-side { position: static; }
  .ia-side > .stack { order: -1; }
}
@media (max-width: 720px) {
  .ia-hero .dropzone { min-height: 250px; }
  .ia-art i { width: 44px; height: 44px; border-radius: 14px; }
  .ia-art i:nth-child(n + 3) { display: none; }
  .ia-art i .icon { width: 19px; height: 19px; }
  .ia-stage { padding: 8px; border-radius: 20px; min-height: 220px; }
  .ia-panel { padding: 4px 13px; border-radius: 18px; }
  .ia-chip { font-size: 11.5px; }
  .ia-step-sep { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ia-hero, .ia-art i, .ia-scan::before, .ia-scan::after, .ia-kbd kbd, .ia-reveal { animation: none !important; }
  .ia-hero { background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 50%, transparent), color-mix(in srgb, var(--accent-2) 50%, transparent)); }
}
`

let styled = false
/** Inject the pack stylesheet once. */
export function ensureStyles() {
  if (styled || document.getElementById('ia-styles')) { styled = true; return }
  styled = true
  document.head.append(h('style', { id: 'ia-styles' }, CSS))
}

/** Create the root container every tool in the pack renders into. */
export function shell(root, ...kids) {
  ensureStyles()
  root.classList.add('ia')
  root.append(...kids.flat().filter(Boolean))
  return root
}

/** Step indicator: steps(['Add photo', 'Process', 'Download']).set(1) */
export function steps(labels, active = 0) {
  const el = h('div', { class: 'ia-steps', 'aria-label': 'Progress' })
  const render = () => {
    clear(el, labels.map((l, i) => [
      i > 0 && h('span', { class: 'ia-step-sep' }),
      h('span', { class: ['ia-step', i === active && 'on', i < active && 'done'], 'aria-current': i === active ? 'step' : null },
        h('b', i < active ? icon('check') : String(i + 1)), l),
    ]))
  }
  el.set = (i) => { active = i; render() }
  render()
  return el
}

/**
 * Hero dropzone with an animated gradient ring, floating tiles and feature chips.
 * heroDrop({ ...dropzone options, icons: ['image', 'sparkles'], features: [['shield-check', 'Stays on your device']] })
 * -> element with .zone (the dropzone)
 */
export function heroDrop({ icons = ['image', 'sparkles', 'wand-sparkles', 'layers'], features = [], ...dz }) {
  ensureStyles()
  const zone = dropzone(dz)
  zone.append(h('div', { class: 'ia-art', 'aria-hidden': 'true' }, icons.slice(0, 4).map((n) => h('i', icon(n)))))
  const el = h('div', { class: 'stack' },
    h('div', { class: 'ia-hero' }, zone),
    features.length ? h('div', { class: 'ia-feats' }, features.map(([ic, t]) => h('span', { class: 'ia-feat' }, icon(ic), t))) : null)
  el.zone = zone
  return el
}

/** Collapsible section for the side panel. */
export function section(title, ic, kids, open = true) {
  return h('details', { class: 'ia-sec', open }, h('summary', ic && icon(ic), h('span', title), icon('chevron-down', 'chev')), h('div', { class: 'ia-sec-body' }, kids))
}
export const panelOf = (...secs) => h('div', { class: 'ia-panel' }, secs)

/** A stage (framed canvas area). variant: '' (checkerboard) | 'on-white' | 'on-dark' | 'on-plain'. */
export function stage(variant = '') {
  const el = h('div', { class: ['ia-stage', variant] })
  el.setVariant = (v) => { el.classList.remove('on-white', 'on-dark', 'on-plain'); if (v) el.classList.add(v) }
  return el
}

/** Wrap a canvas/img so it keeps its aspect ratio inside the stage (sets --ar). */
export function fit(child, w, h2) {
  const el = h('div', { class: 'ia-fit', style: { '--ar': String(w / h2) } }, child)
  el.setSize = (ww, hh) => el.style.setProperty('--ar', String(ww / hh))
  return el
}

/** Glass chip that floats on a stage. pos: tl | tr | bl | br | bc */
export const chip = (pos, ic, text) => h('div', { class: ['ia-chip', pos] }, ic && icon(ic), h('span', text))

/**
 * Animated "AI is working" overlay for a stage.
 * const fx = scanFx(); stage.append(fx.el); fx.start('Finding the subject'); fx.update(0.4, 'Downloading model'); fx.stop()
 * fx.onCancel = () => ... shows a Cancel button.
 */
export function scanFx() {
  const label = h('span', 'Working')
  const sub = h('div', { class: 'ia-scan-sub' })
  const barI = h('i')
  const bar = h('div', { class: 'ia-scan-bar ind' }, barI)
  const cancel = button('Cancel', { variant: 'secondary', size: 'sm', icon: 'x', onClick: () => api.onCancel?.() })
  cancel.classList.add('ia-scan-cancel')
  cancel.hidden = true
  const el = h('div', { class: 'ia-scan', 'aria-live': 'polite' },
    h('div', { class: 'ia-scan-card' }, h('div', { class: 'ia-scan-row' }, h('span', { class: 'spinner' }), label), bar, sub), cancel)
  const api = {
    el,
    onCancel: null,
    start(text, canCancel = false) { label.textContent = text || 'Working'; sub.textContent = ''; bar.classList.add('ind'); barI.style.width = ''; cancel.hidden = !canCancel || !api.onCancel; el.classList.add('on') },
    update(fraction, text, subText) {
      if (text != null) label.textContent = text
      if (subText != null) sub.textContent = subText
      const ind = fraction == null || !Number.isFinite(fraction)
      bar.classList.toggle('ind', ind)
      barI.style.width = ind ? '' : `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
      if (!el.classList.contains('on')) el.classList.add('on')
    },
    stop() { el.classList.remove('on'); cancel.hidden = true },
  }
  return api
}

/** Little burst of sparkles around the center of `host` (skipped for reduced motion). */
export function burst(host, count = 14) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const colors = ['#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#22c55e']
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5
    const d = 60 + Math.random() * 90
    const s = h('span', { class: 'ia-spark', style: { left: '50%', top: '50%', '--tx': `${Math.cos(a) * d}px`, '--ty': `${Math.sin(a) * d}px`, '--c': colors[i % colors.length], animationDelay: `${Math.random() * 120}ms` } }, icon('sparkle'))
    host.append(s)
    s.addEventListener('animationend', () => s.remove(), { once: true })
    setTimeout(() => s.remove(), 1600)
  }
}

/**
 * Before/after slider. before/after are canvas or img elements of the same aspect ratio.
 * const c = compare(beforeEl, afterEl, { before: 'Original', after: 'Result' }); c.setAspect(w, h); c.set(0.5)
 */
export function compare(before, after, { beforeLabel = 'Original', afterLabel = 'Result', start = 0.5 } = {}) {
  ensureStyles()
  const bar = h('div', { class: 'ia-cmp-bar' }, h('div', { class: 'ia-cmp-knob' }, icon('chevrons-left-right')))
  const el = h('div', {
    class: 'ia-cmp', role: 'slider', tabindex: 0, 'aria-label': 'Before and after comparison', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(start * 100),
  },
  h('div', { class: 'ia-cmp-layer' }, after),
  h('div', { class: 'ia-cmp-layer ia-cmp-b' }, before),
  bar,
  h('span', { class: 'ia-cmp-tag l' }, beforeLabel),
  h('span', { class: 'ia-cmp-tag r' }, afterLabel))
  let value = start
  const set = (p) => {
    value = Math.max(0, Math.min(1, p))
    el.style.setProperty('--p', `${(value * 100).toFixed(2)}%`)
    el.setAttribute('aria-valuenow', String(Math.round(value * 100)))
  }
  const fromEvent = (e) => { const r = el.getBoundingClientRect(); set((e.clientX - r.left) / r.width) }
  el.addEventListener('pointerdown', (e) => { if (el.classList.contains('static')) return; el.setPointerCapture(e.pointerId); el.classList.add('drag'); fromEvent(e) })
  el.addEventListener('pointermove', (e) => { if (el.classList.contains('drag')) fromEvent(e) })
  const end = () => el.classList.remove('drag')
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  el.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -0.05, ArrowRight: 0.05, Home: -1, End: 1 }[e.key]
    if (d === undefined) return
    e.preventDefault()
    set(e.key === 'Home' ? 0 : e.key === 'End' ? 1 : value + d)
  })
  el.set = set
  el.get = () => value
  /** Static mode hides the handle and labels (used to show just one side). */
  el.setStatic = (b) => { el.classList.toggle('static', !!b); el.tabIndex = b ? -1 : 0 }
  el.animateTo = (target, ms = 520) => {
    const from = value
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !el.isConnected) return set(target)
    const t0 = performance.now()
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms)
      set(from + (target - from) * (1 - Math.pow(1 - k, 3)))
      if (k < 1 && el.isConnected) setTimeout(tick, 16)
    }
    tick()
  }
  el.setAspect = (w, hh) => el.style.setProperty('--ar', String(w / hh))
  /** Sweep the divider across once (a small delight when a result appears). */
  el.sweep = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return set(0.5)
    const t0 = performance.now()
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1100)
      set(1 - (1 - 0.5) * (1 - Math.pow(1 - k, 3)))
      if (k < 1 && el.isConnected) setTimeout(() => tick(performance.now()), 16)
    }
    set(1)
    tick(performance.now())
  }
  set(start)
  return el
}

/**
 * Radio cards. optionCards([{value, title, desc, icon, tags: ['26 MB'], dots: 3, dotsLabel}], value, onChange, {cols: true})
 */
export function optionCards(options, value, onChange, { col = false, label } = {}) {
  const el = h('div', { class: ['ia-opts', col && 'col'], role: 'radiogroup', 'aria-label': label || null })
  el.value = value
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', class: 'ia-opt', role: 'radio', 'aria-checked': String(o.value === value), disabled: o.disabled || null,
      onclick: () => { el.set(o.value); onChange?.(o.value) },
      onkeydown: (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
        if (!d) return
        e.preventDefault()
        const i = options.findIndex((x) => x.value === el.value)
        const n = options[(i + d + options.length) % options.length]
        el.set(n.value)
        onChange?.(n.value)
        btns[options.indexOf(n)].focus()
      } },
    h('div', { class: 'ia-opt-t' }, o.icon && icon(o.icon), h('span', o.title)),
    o.desc && h('div', { class: 'ia-opt-d' }, o.desc),
    (o.tags || o.dots) && h('div', { class: 'ia-opt-m' },
      (o.tags || []).map((t) => h('span', { class: ['ia-tag', typeof t === 'object' && t.cls], title: typeof t === 'object' ? t.title : null }, typeof t === 'object' ? t.text : t)),
      o.dots ? h('span', { class: 'ia-dots', title: o.dotsLabel || null, 'aria-label': o.dotsLabel || null }, [1, 2, 3].map((n) => h('i', { class: n <= o.dots && 'on' }))) : null))
    b._v = o.value
    return b
  })
  el.append(...btns)
  const sync = () => btns.forEach((b) => { b.setAttribute('aria-checked', String(b._v === el.value)); b.tabIndex = b._v === el.value ? 0 : -1 })
  el.set = (v) => { el.value = v; sync() }
  /** Replace a tag (e.g. "Ready" after download) without re-rendering. */
  el.refresh = (opts) => { opts.forEach((o, i) => { const m = btns[i]?.querySelector('.ia-opt-m'); if (m && o.tags) m.replaceChildren(...o.tags.map((t) => h('span', { class: ['ia-tag', typeof t === 'object' && t.cls] }, typeof t === 'object' ? t.text : t))) }) }
  sync()
  return el
}

/** Color swatches. swatches(['#fff', '#000'], '#fff', onChange, {custom: true, none: false}) -> element with .value and .set(v) */
export function swatches(colors, value, onChange, { custom = true, none = false } = {}) {
  const el = h('div', { class: 'ia-sws', role: 'group', 'aria-label': 'Colors' })
  el.value = value
  const btns = []
  const add = (v, style, cls, ariaLabel) => {
    const b = h('button', { type: 'button', class: ['ia-sw', cls], style: style ? { '--sw': style } : null, 'aria-label': ariaLabel, title: ariaLabel, onclick: () => { el.set(v); onChange?.(v) } })
    b._v = v
    btns.push(b)
    el.append(b)
    return b
  }
  if (none) add('none', null, 'none', 'No background (transparent)')
  for (const c of colors) add(c, c, '', c)
  let picker = null
  if (custom) {
    const b = add('custom', null, 'rainbow', 'Custom color')
    picker = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value) ? value : '#5b4cf0', 'aria-label': 'Pick a custom color', oninput: (e) => { el.set(e.target.value); onChange?.(e.target.value) } })
    b.append(picker)
    b.addEventListener('click', () => picker.click())
  }
  const sync = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b._v === el.value || (b._v === 'custom' && !colors.includes(el.value) && el.value !== 'none'))))
  el.set = (v) => { el.value = v; if (picker && /^#[0-9a-f]{6}$/i.test(v)) picker.value = v; sync() }
  sync()
  return el
}

/**
 * Thumbnail strip for a queue of images. const q = strip({onSelect(i), onRemove(i), onAdd()});
 * q.render([{name, thumb: url, status: 'queued'|'run'|'done'|'error'}], activeIndex)
 */
export function strip({ onSelect, onRemove, onAdd }) {
  const el = h('div', { class: 'ia-strip', role: 'list', 'aria-label': 'Your images' })
  const api = {
    el,
    render(items, active) {
      clear(el, items.map((it, i) => h('div', { role: 'listitem', class: 'ia-thw' },
        h('button', { type: 'button', class: ['ia-th', i === active && 'active'], title: it.name, 'aria-label': `${it.name} (${it.status || 'queued'})`, 'aria-current': i === active ? 'true' : null, onclick: () => onSelect?.(i) },
          it.thumb ? h('img', { src: it.thumb, alt: '' }) : null, h('span', { class: ['dot', it.status || ''] })),
        onRemove ? h('button', { type: 'button', class: 'ia-x', 'aria-label': `Remove ${it.name}`, onclick: (e) => { e.stopPropagation(); onRemove(i) } }, icon('x')) : null)),
      onAdd ? h('button', { type: 'button', class: 'ia-add', 'aria-label': 'Add more images', title: 'Add more images', onclick: onAdd }, icon('plus')) : null)
    },
  }
  return api
}

/** Small pill showing where the model runs. */
export function devicePill(device) {
  const gpu = device === 'webgpu'
  return h('span', { class: ['ia-dev', gpu && 'gpu'], title: gpu ? 'Running on your graphics card (WebGPU)' : 'Running on your processor (WebAssembly). It works everywhere, just a bit slower.' },
    icon(gpu ? 'zap' : 'cpu'), gpu ? 'GPU' : 'CPU')
}

/** "Done" card with a title, stats line, actions and optional next-step links. */
export function doneCard({ title, sub, actions = [], next = [] }) {
  return h('div', { class: 'ia-done' },
    h('div', { class: 'ia-done-h' }, h('span', { class: 'ok' }, icon('check')), h('div', title, sub ? [h('br'), h('small', sub)] : null)),
    h('div', { class: 'row' }, actions),
    next.length ? h('div', { class: 'ia-next' }, h('span', 'Next:'), next) : null)
}

/** A "next step" pill that hands a file to another tool (see handoff in _ml.js). */
export function nextLink(id, label, ic, onClick) {
  return h('button', { type: 'button', onclick: () => { onClick?.(); location.hash = `#/${id}` } }, ic && icon(ic), label)
}

export const note = (ic, ...kids) => h('div', { class: 'ia-note' }, icon(ic), h('div', kids))

/** Register a pointer-drag handler on an element. cb(type 'down'|'move'|'up', event) */
export function drag(el, cb) {
  let active = false
  el.addEventListener('pointerdown', (e) => { if (e.button > 0) return; active = true; el.setPointerCapture(e.pointerId); cb('down', e) })
  el.addEventListener('pointermove', (e) => { if (active) cb('move', e) })
  const up = (e) => { if (!active) return; active = false; cb('up', e) }
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
}

/** Keep an object URL alive for the page and revoke on leave. */
export function trackedURL(blob) {
  const url = URL.createObjectURL(blob)
  onCleanup(() => URL.revokeObjectURL(url))
  return url
}
