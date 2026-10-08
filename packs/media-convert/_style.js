// Styles for the media-convert tools. One <style> element, every rule scoped under .mc, colors only through the
// site's CSS variables so light and dark both work. Motion is switched off globally by prefers-reduced-motion.
const CSS = `
@property --mc-p { syntax: '<number>'; inherits: false; initial-value: 0; }
@property --mc-a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
.mc { --mc: var(--c, var(--accent)); display: flex; flex-direction: column; gap: 18px; position: relative; }
.mc [hidden] { display: none !important; }

/* ---------- Empty state ---------- */
.mc-trust { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mc-trust > div { display: flex; gap: 11px; align-items: flex-start; padding: 13px 15px; border-radius: 18px; border: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 82%, transparent); font-size: 13px; color: var(--muted); line-height: 1.4; animation: rise .55s var(--ease) both; animation-delay: calc(var(--i, 0) * 80ms + 80ms); transition: transform .3s var(--ease), border-color .3s, box-shadow .3s; }
.mc-trust > div:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--mc) 35%, var(--border)); box-shadow: var(--shadow); }
.mc-trust b { display: block; color: var(--text); font-weight: 600; font-size: 13.5px; margin-bottom: 1px; }
.mc-trust .t-ic { flex: none; width: 32px; height: 32px; border-radius: 11px; display: grid; place-items: center; color: var(--mc); background: color-mix(in srgb, var(--mc) 12%, transparent); }
.mc-engine-pill { display: inline-flex; align-items: center; gap: 8px; align-self: center; min-height: 30px; padding: 5px 12px; text-align: left; line-height: 1.35; border-radius: 999px; font-size: 12.5px; color: var(--muted); border: 1px solid var(--border); background: var(--surface); animation: rise .4s var(--ease) both; }
.mc-engine-pill .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); }
.mc-engine-pill.ready .dot { background: var(--success); }
.mc-engine-pill.loading .dot { animation: pulse 1.4s infinite; }

/* ---------- Stage: preview + file facts ---------- */
.mc-stage { position: relative; isolation: isolate; border-radius: 28px; padding: 12px; border: 1px solid color-mix(in srgb, var(--mc) 22%, var(--border)); background: linear-gradient(160deg, color-mix(in srgb, var(--mc) 11%, var(--surface)), var(--surface) 58%); box-shadow: var(--shadow); animation: rise .5s var(--ease) both; }
.mc-stage::before { content: ""; position: absolute; inset: -1px; z-index: -1; border-radius: inherit; padding: 2px; pointer-events: none; opacity: 0; transition: opacity .5s; background: conic-gradient(from var(--mc-a), transparent 0 55%, var(--accent) 78%, var(--accent-2) 90%, transparent 100%); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); mask-composite: exclude; animation: mc-turn 3.2s linear infinite; }
.mc-stage.busy::before { opacity: 1; }
@keyframes mc-turn { to { --mc-a: 360deg; } }
.mc-view { position: relative; border-radius: 19px; overflow: hidden; background: #08080d; display: grid; place-items: center; min-height: 150px; }
.mc-view video { display: block; width: 100%; height: auto; max-height: min(54vh, 460px); background: #000; object-fit: contain; }
.mc-view .mc-fx { transition: transform .45s var(--spring); }
.mc-float { position: absolute; z-index: 2; left: 10px; top: 10px; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 550; color: #fff; background: rgba(10, 10, 16, .55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, .14); pointer-events: none; }
.mc-float .icon { width: 13px; height: 13px; }
.mc-nopreview { display: grid; place-items: center; gap: 8px; padding: 34px 20px; text-align: center; color: #b9b9c6; font-size: 13.5px; }
.mc-nopreview .icon { width: 34px; height: 34px; color: color-mix(in srgb, var(--mc) 70%, #fff); }
.mc-meta { display: flex; align-items: center; gap: 10px; padding: 12px 4px 2px 6px; }
.mc-fname { flex: 1; min-width: 0; font-weight: 600; font-size: 15px; letter-spacing: -.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-fname small { display: block; font-weight: 400; font-size: 12.5px; color: var(--muted); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; }
.mc-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 4px 2px; }
.mc-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 999px; font-size: 12.5px; color: var(--text-2); font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--mc) 9%, var(--surface-2)); border: 1px solid color-mix(in srgb, var(--mc) 16%, var(--border)); animation: mc-chip .45s var(--spring) both; animation-delay: calc(var(--i, 0) * 45ms); }
.mc-chip .icon { width: 13px; height: 13px; color: var(--mc); }
@keyframes mc-chip { from { opacity: 0; transform: translateY(6px) scale(.9); } }
.mc-status { display: flex; flex-direction: column; gap: 8px; padding: 6px 4px 2px; }
.mc-status:empty { display: none; }
.mc-bar { height: 8px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.mc-bar > i { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--brand); background-size: 200% 100%; animation: shimmer 2.2s linear infinite; transition: width .25s var(--ease); }
.mc-bar.ind > i { width: 35%; animation: indet 1.2s ease-in-out infinite; }
.mc-bar-text { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; color: var(--muted); }
.mc-over { display: contents; }

/* ---------- Audio player ---------- */
.mc-aud { position: relative; width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 14px 16px; align-items: center; padding: 20px; background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--mc) 38%, #0b0b12), #0b0b12 70%); color: #fff; }
.mc-play { width: 56px; height: 56px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; color: #101018; background: #fff; box-shadow: 0 10px 28px -8px color-mix(in srgb, var(--mc) 80%, #000); transition: transform .25s var(--spring); }
.mc-play:hover { transform: scale(1.07); }
.mc-play:active { transform: scale(.94); }
.mc-play .icon { width: 24px; height: 24px; fill: currentColor; }
.mc-aud-main { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.mc-eq { display: flex; align-items: flex-end; justify-content: space-between; gap: 3px; height: 42px; overflow: hidden; }
.mc-eq i { flex: 1 1 0; max-width: 8px; min-width: 2px; border-radius: 3px; height: calc(25% + var(--h, .5) * 75%); transform-origin: bottom; background: linear-gradient(to top, color-mix(in srgb, var(--mc) 70%, #fff), #fff); opacity: .55; transform: scaleY(.3); transition: transform .4s var(--ease), opacity .4s; }
.mc-aud.playing .mc-eq i { opacity: .95; animation: mc-eq 1.05s ease-in-out infinite; animation-delay: calc(var(--i, 0) * -70ms); }
@keyframes mc-eq { 0%, 100% { transform: scaleY(.28); } 50% { transform: scaleY(1); } }
.mc-aud-bar { display: flex; align-items: center; gap: 10px; font-size: 12.5px; font-variant-numeric: tabular-nums; color: #d6d6e2; grid-column: 1 / -1; }
.mc-aud-bar input[type="range"] { flex: 1; accent-color: #fff; height: 20px; }

/* ---------- Option panels ---------- */
.mc-panel { display: flex; flex-direction: column; gap: 24px; padding: 22px; border-radius: 26px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-sm); animation: rise .5s .05s var(--ease) both; }
.mc-step { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.mc-step > header { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14.5px; letter-spacing: -.01em; }
.mc-step > header .n { width: 24px; height: 24px; flex: none; border-radius: 8px; display: grid; place-items: center; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--mc); background: color-mix(in srgb, var(--mc) 13%, transparent); border: 1px solid color-mix(in srgb, var(--mc) 26%, transparent); }
.mc-step > header small { margin-left: auto; font-weight: 400; font-size: 12.5px; color: var(--muted); text-align: right; }
.mc-note { font-size: 12.5px; color: var(--muted); line-height: 1.45; overflow-wrap: anywhere; }
.mc-note.warn { color: var(--warning); }
.mc-note b { color: var(--text-2); font-weight: 600; }
.mc-skel { display: flex; flex-direction: column; gap: 12px; padding: 22px; border-radius: 26px; border: 1px solid var(--border); background: var(--surface); }
.mc-skel i { display: block; height: 16px; border-radius: 8px; background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.6s linear infinite; }
.mc-skel i:nth-child(1) { width: 38%; } .mc-skel i:nth-child(2) { height: 64px; border-radius: 16px; } .mc-skel i:nth-child(3) { width: 62%; }

.mc-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 132px), 1fr)); gap: 10px; }
.mc-tile { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 84px; padding: 12px; text-align: left; border-radius: 17px; border: 1px solid var(--border); background: var(--surface); cursor: pointer; color: var(--text); transition: transform .28s var(--spring), border-color .2s, background .2s, box-shadow .25s; }
.mc-tile:hover:not(:disabled) { transform: translateY(-3px); border-color: var(--border-strong); box-shadow: var(--shadow); }
.mc-tile:active:not(:disabled) { transform: scale(.97); }
.mc-tile:disabled { opacity: .45; cursor: not-allowed; }
.mc-tile .t-ic { width: 30px; height: 30px; margin-bottom: 4px; display: grid; place-items: center; border-radius: 10px; color: var(--mc); background: color-mix(in srgb, var(--mc) 12%, transparent); transition: transform .3s var(--spring); }
.mc-tile:hover:not(:disabled) .t-ic { transform: rotate(-8deg) scale(1.1); }
.mc-tile .t-ic .icon { width: 17px; height: 17px; }
.mc-tile b { font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
.mc-tile small { font-size: 12px; line-height: 1.3; color: var(--muted); overflow-wrap: anywhere; }
.mc-tile[aria-pressed="true"] { border-color: var(--accent); background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 13%, var(--surface)), var(--surface) 75%); box-shadow: 0 0 0 3px var(--ring), var(--shadow); }
.mc-tile[aria-pressed="true"]::after { content: ""; position: absolute; top: 10px; right: 10px; width: 18px; height: 18px; border-radius: 50%; background: var(--accent) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 12 5 5L20 7'/%3E%3C/svg%3E") center / 11px no-repeat; animation: mc-pop .4s var(--spring); }
@keyframes mc-pop { from { transform: scale(0) rotate(-40deg); opacity: 0; } }
.mc-tiles.compact { grid-template-columns: repeat(auto-fill, minmax(min(100%, 96px), 1fr)); }
.mc-tiles.compact .mc-tile { min-height: 58px; padding: 10px 12px; }
.mc-tiles.compact .t-ic { display: none; }

.mc-fixed { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 18px; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border)); background: linear-gradient(150deg, color-mix(in srgb, var(--accent) 9%, var(--surface)), var(--surface) 75%); }
.mc-fixed .t-ic { flex: none; width: 40px; height: 40px; border-radius: 13px; display: grid; place-items: center; color: var(--mc); background: color-mix(in srgb, var(--mc) 13%, transparent); }
.mc-fixed b { display: block; font-size: 15px; letter-spacing: -.01em; }
.mc-fixed small { display: block; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
.mc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.mc-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.mc-switches { display: flex; flex-direction: column; gap: 6px; }
.mc-sw { display: flex; align-items: flex-start; gap: 10px; }
.mc-sw .mc-note { margin: 0 0 0 50px; }
.mc-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.mc-pill { height: 32px; padding: 0 13px; border-radius: 999px; font-size: 13px; font-weight: 550; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text-2); transition: all .2s var(--ease); }
.mc-pill:hover { border-color: var(--border-strong); transform: translateY(-1px); }
.mc-pill[aria-pressed="true"] { background: var(--text); color: var(--bg); border-color: var(--text); }

/* ---------- Dock + run + result ---------- */
.mc-dock { position: sticky; bottom: calc(12px + var(--safe-b)); z-index: 6; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 12px 12px 18px; border-radius: 24px; border: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 84%, transparent); backdrop-filter: blur(16px) saturate(160%); -webkit-backdrop-filter: blur(16px) saturate(160%); box-shadow: var(--shadow); animation: rise .5s .1s var(--ease) both; }
.mc-dock-info { flex: 1; min-width: 150px; display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--muted); line-height: 1.35; }
.mc-dock-info b { color: var(--text); font-weight: 600; font-size: 14px; font-variant-numeric: tabular-nums; }
.mc-go { min-width: 190px; }
.mc-run { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; padding: 20px; border-radius: 26px; border: 1px solid color-mix(in srgb, var(--mc) 28%, var(--border)); background: linear-gradient(155deg, color-mix(in srgb, var(--mc) 10%, var(--surface)), var(--surface) 70%); animation: rise .4s var(--ease) both; }
.mc-ring { --mc-p: 0; position: relative; flex: none; width: 96px; height: 96px; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--accent) calc(var(--mc-p) * 1%), var(--surface-3) 0); transition: --mc-p .35s var(--ease); box-shadow: 0 0 40px -12px var(--accent); }
.mc-ring::before { content: ""; position: absolute; inset: 9px; border-radius: 50%; background: var(--surface); }
.mc-ring b { position: relative; font-size: 21px; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.mc-ring.ind { background: var(--surface-3); }
.mc-ring.ind::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0 62%, var(--accent)); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px)); mask: radial-gradient(farthest-side, transparent calc(100% - 9px), #000 calc(100% - 8px)); animation: spin 1.1s linear infinite; }
.mc-run-text { flex: 1; min-width: 160px; display: flex; flex-direction: column; gap: 3px; }
.mc-run-text b { font-size: 16.5px; letter-spacing: -.02em; }
.mc-run-text span { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }

.mc-done { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 18px; padding: 22px; border-radius: 28px; border: 1px solid color-mix(in srgb, var(--success) 30%, var(--border)); background: linear-gradient(160deg, color-mix(in srgb, var(--success) 10%, var(--surface)), var(--surface) 55%); animation: rise .5s var(--ease) both; }
.mc-done-head { display: flex; align-items: center; gap: 14px; }
.mc-check { position: relative; flex: none; width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--success); box-shadow: 0 10px 26px -8px var(--success); animation: mc-pop .6s var(--spring) both; }
.mc-check svg { width: 24px; height: 24px; }
.mc-check path { stroke-dasharray: 26; stroke-dashoffset: 26; animation: mc-draw .5s .28s var(--ease) forwards; }
@keyframes mc-draw { to { stroke-dashoffset: 0; } }
:root[data-theme="dark"] .mc-check { color: #06210f; }
.mc-done h3 { font-size: 21px; letter-spacing: -.03em; }
.mc-done-head p { font-size: 13.5px; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }
.mc-confetti { position: absolute; left: 46px; top: 46px; width: 0; height: 0; pointer-events: none; }
.mc-confetti i { position: absolute; width: 8px; height: 8px; border-radius: 2px; background: var(--k); opacity: 0; animation: mc-fly .95s var(--ease) forwards; animation-delay: calc(var(--d, 0) * 1ms); }
@keyframes mc-fly { 0% { opacity: 1; transform: translate(0, 0) rotate(0) scale(.4); } 70% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--x), var(--y)) rotate(var(--r)) scale(1); } }
.mc-cmp { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px; border-radius: 18px; background: color-mix(in srgb, var(--surface-2) 70%, transparent); border: 1px solid var(--border); }
.mc-cmp-row { display: grid; grid-template-columns: 74px minmax(0, 1fr) auto; align-items: center; gap: 12px; font-size: 13px; color: var(--muted); }
.mc-cmp-row b { color: var(--text); font-variant-numeric: tabular-nums; min-width: 64px; text-align: right; font-weight: 600; }
.mc-cmp-bar { height: 12px; border-radius: 99px; background: var(--surface-3); overflow: hidden; }
.mc-cmp-bar i { display: block; height: 100%; width: var(--w); border-radius: inherit; background: var(--border-strong); animation: mc-grow 1s var(--ease) both; }
.mc-cmp-row.new .mc-cmp-bar i { background: var(--brand); animation-delay: .25s; }
@keyframes mc-grow { from { width: 0; } }
.mc-delta { font-weight: 650; font-variant-numeric: tabular-nums; }
.mc-delta.down { color: var(--success); } .mc-delta.up { color: var(--warning); }
.mc-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }

/* ---------- Timeline (trim, GIF range) ---------- */
.mc-tl { display: flex; flex-direction: column; gap: 12px; padding: 12px 4px 4px; }
.mc-track { position: relative; height: 84px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--border); touch-action: none; user-select: none; -webkit-user-select: none; cursor: pointer; margin: 0 14px; }
.mc-track.tall { height: 104px; }
.mc-track canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: inherit; pointer-events: none; }
.mc-film { position: absolute; inset: 0; display: flex; border-radius: inherit; overflow: hidden; pointer-events: none; opacity: .85; }
.mc-film canvas { position: static; flex: 1; width: 0; height: 100%; object-fit: cover; border-radius: 0; }
.mc-shade { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--bg) 62%, transparent); pointer-events: none; backdrop-filter: grayscale(.8); }
.mc-shade.l { left: 0; border-radius: 15px 0 0 15px; } .mc-shade.r { right: 0; border-radius: 0 15px 15px 0; }
.mc-sel { position: absolute; top: -2px; bottom: -2px; border-top: 3px solid var(--accent); border-bottom: 3px solid var(--accent); pointer-events: none; box-shadow: 0 0 24px -4px var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.mc-handle { position: absolute; top: -6px; bottom: -6px; width: 28px; margin-left: -14px; z-index: 3; display: grid; place-items: center; cursor: ew-resize; touch-action: none; outline: none; }
.mc-handle::before { content: ""; width: 12px; height: 100%; border-radius: 8px; background: var(--accent); box-shadow: 0 6px 18px -4px var(--accent); transition: transform .2s var(--spring), width .2s; }
.mc-handle::after { content: ""; position: absolute; width: 2px; height: 22px; border-radius: 2px; background: rgba(255, 255, 255, .85); }
.mc-handle:hover::before, .mc-handle:focus-visible::before, .mc-handle.drag::before { transform: scaleX(1.25); }
.mc-handle:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; border-radius: 8px; }
.mc-handle.s::before { border-radius: 10px 4px 4px 10px; } .mc-handle.e::before { border-radius: 4px 10px 10px 4px; }
.mc-tip { position: absolute; bottom: calc(100% + 4px); left: 50%; transform: translate(-50%, 6px) scale(.9); padding: 3px 8px; border-radius: 8px; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--accent-text); background: var(--accent); opacity: 0; pointer-events: none; transition: opacity .15s, transform .2s var(--spring); }
.mc-handle:hover .mc-tip, .mc-handle.drag .mc-tip, .mc-handle:focus-visible .mc-tip { opacity: 1; transform: translate(-50%, 0) scale(1); }
.mc-head { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: var(--text); border-radius: 2px; pointer-events: none; z-index: 2; box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg) 70%, transparent); }
.mc-head::before { content: ""; position: absolute; top: -3px; left: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--text); }
.mc-ticks { display: flex; justify-content: space-between; margin: 0 14px; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.mc-times { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mc-times .field-label { font-size: 12px; }
.mc-times .input { text-align: center; font-variant-numeric: tabular-nums; font-family: var(--mono); }
.mc-times .field.len .input { background: color-mix(in srgb, var(--accent) 8%, var(--surface-2)); border-color: color-mix(in srgb, var(--accent) 25%, var(--border)); font-weight: 600; }
.mc-tl-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

/* ---------- Misc ---------- */
.mc-list { display: flex; flex-direction: column; gap: 8px; }
.mc-kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 14px; font-size: 13px; }
.mc-kv dt { color: var(--muted); } .mc-kv dd { margin: 0; color: var(--text-2); overflow-wrap: anywhere; }
.mc-cues { display: flex; flex-direction: column; max-height: 230px; overflow: auto; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
.mc-cue { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; padding: 9px 12px; border-bottom: 1px solid var(--border); font-size: 13px; transition: background .2s; }
.mc-cue:last-child { border-bottom: 0; }
.mc-cue time { font-family: var(--mono); font-size: 12px; color: var(--muted); padding-top: 1px; }
.mc-cue.on { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.mc-cue span { white-space: pre-line; overflow-wrap: anywhere; }
.mc-sub-overlay { position: absolute; left: 6%; right: 6%; z-index: 3; text-align: center; pointer-events: none; font-family: "Noto Sans", var(--font); font-weight: 500; line-height: 1.25; color: #fff; text-shadow: 0 0 3px #000, 0 0 3px #000, 1px 1px 2px #000; white-space: pre-line; }
.mc-zip-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); animation: rise .4s var(--ease) both; }
.mc-zip-row .nm { min-width: 0; font-weight: 550; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-zip-row small { display: block; color: var(--muted); font-weight: 400; font-size: 12px; }
.mc-zip-row.bad { border-color: color-mix(in srgb, var(--danger) 35%, var(--border)); background: var(--danger-soft); }
.mc-story { display: flex; gap: 3px; height: 40px; border-radius: 14px; overflow: hidden; }
.mc-story > i { flex: var(--w, 1) 1 0; min-width: 26px; display: grid; place-items: center; font-style: normal; font-size: 12.5px; font-weight: 650; color: #fff; background: color-mix(in srgb, var(--accent) calc((1 - var(--k, 0)) * 100%), var(--accent-2)); transition: flex .45s var(--ease), background .3s; animation: mc-chip .45s var(--spring) both; }
.mc-orient { display: grid; place-items: center; }
.mc-shape { position: relative; flex: none; border-radius: 10px; overflow: hidden; background: repeating-linear-gradient(45deg, #15151c 0 8px, #1b1b24 8px 16px); border: 1px solid var(--border-strong); display: grid; place-items: center; margin: 0 auto; }
.mc-shape-in { flex: none; background: linear-gradient(135deg, var(--accent), var(--accent-2)); opacity: .92; border-radius: 3px; transition: width .35s var(--ease), height .35s var(--ease); box-shadow: 0 0 0 1px rgba(255, 255, 255, .25) inset; }
.mc-preview-pane { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: center; }
.mc-preview-pane canvas { display: block; width: 100%; max-height: 240px; object-fit: contain; border-radius: 12px; background: #08080d; border: 1px solid var(--border); }
.mc-dim-row { display: flex; align-items: center; gap: 8px; }
.mc-dim-row span { color: var(--muted); }
.mc-spinbox { display: grid; place-items: center; padding: 14px; border-radius: 18px; background: var(--surface-2); border: 1px dashed var(--border-strong); }

@media (max-width: 720px) {
  .mc { gap: 14px; }
  .mc-trust { grid-template-columns: minmax(0, 1fr); }
  .mc-panel { padding: 16px; gap: 20px; border-radius: 22px; }
  .mc-stage { border-radius: 22px; padding: 8px; }
  .mc-grid, .mc-grid.three { grid-template-columns: minmax(0, 1fr); }
  .mc-times { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .mc-times .input { padding: 0 4px; font-size: 14px; }
  .mc-dock { padding: 10px; border-radius: 22px; }
  .mc-dock .mc-dock-info { min-width: 100%; order: 2; }
  .mc-go { flex: 1; min-width: 0; }
  .mc-run { padding: 16px; gap: 14px; }
  .mc-ring { width: 84px; height: 84px; }
  .mc-done { padding: 16px; border-radius: 22px; }
  .mc-cmp-row { grid-template-columns: 58px minmax(0, 1fr) auto; gap: 8px; }
  .mc-aud { padding: 14px; }
  .mc-eq { gap: 2px; }
  .mc-eq i:nth-child(n + 41) { display: none; }
  .mc-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mc-preview-pane { grid-template-columns: minmax(0, 1fr); }
  .mc-zip-row { grid-template-columns: minmax(0, 1fr) auto; }
  .mc-zip-row > :nth-child(3) { grid-column: 1 / -1; }
}
`

export function injectStyles() {
  if (document.getElementById('mc-style')) return
  const el = document.createElement('style')
  el.id = 'mc-style'
  el.textContent = CSS
  document.head.append(el)
}
