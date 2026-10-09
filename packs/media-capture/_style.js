// One scoped stylesheet for the whole pack. Everything lives under .mc so nothing leaks into the rest of the site.
// Colors come from the site's CSS variables, so light and dark both work. Motion is switched off by the site's
// prefers-reduced-motion rule (animation and transition durations are clamped globally).
export const CSS = `
.mc { --mc-c: var(--c, var(--accent)); --mc-rec: #ff453a; --mc-glass: rgba(14, 14, 24, .58); --mc-glass-b: rgba(255, 255, 255, .16); }
.mc svg { max-width: none; }

/* ---------- Stage: the dark "monitor" every recorder is built around ---------- */
.mc-stage {
  position: relative; display: grid; isolation: isolate; overflow: hidden; border-radius: 28px; max-height: 76vh; aspect-ratio: 16 / 9;
  background: #09090f; color: #fff; border: 1px solid rgba(255, 255, 255, .08);
  box-shadow: 0 34px 80px -40px color-mix(in srgb, var(--mc-c) 60%, #000), var(--shadow-lg); transition: box-shadow .5s var(--ease);
}
.mc-stage:has(.mc-live) { min-height: 290px; }
.mc-stage.tall { aspect-ratio: auto; min-height: 380px; max-height: none; }
.mc-stage[data-state="rec"] { box-shadow: 0 0 0 2px rgba(255, 69, 58, .55), 0 0 60px -6px rgba(255, 69, 58, .45), var(--shadow-lg); animation: mc-recglow 2.4s ease-in-out infinite; }
.mc-stage[data-state="paused"] { box-shadow: 0 0 0 2px rgba(251, 191, 36, .55), var(--shadow-lg); }
.mc-aurora { position: absolute; inset: 0; z-index: -1; overflow: hidden; }
.mc-aurora i { position: absolute; width: 62%; aspect-ratio: 1; border-radius: 50%; filter: blur(64px); opacity: .55; animation: mc-drift 20s ease-in-out infinite alternate; }
.mc-aurora i:nth-child(1) { left: -12%; top: -34%; background: radial-gradient(circle, #6366f1, transparent 66%); }
.mc-aurora i:nth-child(2) { right: -16%; top: -16%; background: radial-gradient(circle, #ec4899, transparent 66%); animation-duration: 24s; animation-delay: -6s; }
.mc-aurora i:nth-child(3) { left: 24%; bottom: -50%; background: radial-gradient(circle, #f97316, transparent 66%); animation-duration: 28s; animation-delay: -11s; opacity: .38; }
.mc-aurora::after {
  content: ""; position: absolute; inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, .05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, .05) 1px, transparent 1px);
  background-size: 44px 44px; mask-image: radial-gradient(70% 75% at 50% 45%, #000, transparent 82%); -webkit-mask-image: radial-gradient(70% 75% at 50% 45%, #000, transparent 82%);
}
@keyframes mc-drift { 0% { transform: translate(0, 0) scale(1); } 50% { transform: translate(6%, 5%) scale(1.1); } 100% { transform: translate(-5%, 2%) scale(.94); } }
@keyframes mc-recglow { 50% { box-shadow: 0 0 0 2px rgba(255, 69, 58, .3), 0 0 90px -4px rgba(255, 69, 58, .55), var(--shadow-lg); } }
.mc-idle { position: relative; grid-area: 1 / 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px 20px 28px; text-align: center; animation: mc-fade .5s var(--ease) both; }
.mc-idle h2 { font-size: clamp(22px, 3.6vw, 34px); letter-spacing: -.035em; color: #fff; max-width: 560px; }
.mc-idle p { color: rgba(255, 255, 255, .72); font-size: clamp(13.5px, 1.6vw, 15.5px); max-width: 470px; }
.mc-idle .btn { margin-top: 6px; }
.mc-bubble {
  position: relative; width: 76px; height: 76px; border-radius: 24px; display: grid; place-items: center; color: #fff; margin-bottom: 4px;
  background: linear-gradient(140deg, rgba(255, 255, 255, .22), rgba(255, 255, 255, .06)); border: 1px solid rgba(255, 255, 255, .25);
  box-shadow: 0 20px 50px -18px rgba(168, 85, 247, .9), inset 0 1px 0 rgba(255, 255, 255, .35); backdrop-filter: blur(10px); animation: mc-float 5s ease-in-out infinite;
}
.mc-bubble::after { content: ""; position: absolute; inset: -9px; border-radius: 30px; border: 1px dashed rgba(255, 255, 255, .22); animation: mc-spin 24s linear infinite; }
.mc-bubble .icon { width: 34px; height: 34px; }
@keyframes mc-float { 50% { transform: translateY(-8px) rotate(-3deg); } }
@keyframes mc-spin { to { transform: rotate(360deg); } }
@keyframes mc-fade { from { opacity: 0; transform: translateY(10px) scale(.985); } }
.mc-live { position: absolute; inset: 0; width: 100%; height: 100%; max-width: none; object-fit: contain; background: #000; animation: mc-fade .5s var(--ease) both; }
.mc-live.cover { object-fit: cover; }
.mc-live.mirror { transform: scaleX(-1); }
.mc-live.soft { background: transparent; }
.mc-rec-btn.shutter .mc-rec-core { background: #fff; }
.mc-rec-btn.shutter:active .mc-rec-core { transform: scale(.82); }
.mc-hud { position: absolute; left: 14px; right: 14px; top: 14px; z-index: 3; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; pointer-events: none; }
.mc-hud .grow { flex: 1; }
.mc-chip {
  display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 13px; border-radius: 999px; font-size: 13px; font-weight: 600; color: #fff; white-space: nowrap;
  background: var(--mc-glass); border: 1px solid var(--mc-glass-b); backdrop-filter: blur(14px) saturate(160%); -webkit-backdrop-filter: blur(14px) saturate(160%); font-variant-numeric: tabular-nums;
  animation: mc-chip-in .5s var(--spring) both;
}
.mc-chip .icon { width: 15px; height: 15px; }
.mc-chip.mono { font-family: var(--mono); font-size: 13.5px; letter-spacing: .02em; }
@keyframes mc-chip-in { from { opacity: 0; transform: translateY(-8px) scale(.9); } }
.mc-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--mc-rec); box-shadow: 0 0 0 0 rgba(255, 69, 58, .7); animation: mc-ping 1.4s infinite; flex: none; }
.mc-stage[data-state="paused"] .mc-dot { background: #fbbf24; animation: none; }
@keyframes mc-ping { 70% { box-shadow: 0 0 0 9px rgba(255, 69, 58, 0); } 100% { box-shadow: 0 0 0 0 rgba(255, 69, 58, 0); } }
.mc-dock {
  position: absolute; left: 50%; bottom: 16px; z-index: 4; display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 999px; transform: translateX(-50%); max-width: calc(100% - 24px);
  background: var(--mc-glass); border: 1px solid var(--mc-glass-b); backdrop-filter: blur(16px) saturate(170%); -webkit-backdrop-filter: blur(16px) saturate(170%);
  box-shadow: 0 22px 44px -18px rgba(0, 0, 0, .7); animation: mc-dock-in .55s var(--spring) both;
}
@keyframes mc-dock-in { from { opacity: 0; transform: translate(-50%, 24px) scale(.9); } }
.mc-dbtn {
  position: relative; width: 46px; height: 46px; flex: none; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; color: #fff; background: rgba(255, 255, 255, .13);
  transition: transform .2s var(--spring), background .2s, box-shadow .2s;
}
.mc-dbtn:hover:not(:disabled) { background: rgba(255, 255, 255, .24); transform: translateY(-2px); }
.mc-dbtn:active:not(:disabled) { transform: scale(.9); }
.mc-dbtn:disabled { opacity: .4; cursor: not-allowed; }
.mc-dbtn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.mc-dbtn[aria-pressed="true"] { background: #fff; color: #111; }
.mc-dbtn.danger[aria-pressed="true"] { background: var(--mc-rec); color: #fff; }
.mc-dbtn.stop { width: 58px; height: 58px; background: var(--mc-rec); box-shadow: 0 10px 26px -8px rgba(255, 69, 58, .9); }
.mc-dbtn.stop:hover:not(:disabled) { background: #ff5e54; }
.mc-dbtn .icon { width: 20px; height: 20px; }
.mc-square { width: 20px; height: 20px; border-radius: 6px; background: #fff; animation: mc-morph .35s var(--spring) both; }
@keyframes mc-morph { from { border-radius: 50%; transform: scale(1.3); } }
.mc-rec-btn { width: 62px; height: 62px; background: transparent; box-shadow: inset 0 0 0 3px #fff; }
.mc-rec-btn:hover:not(:disabled) { background: rgba(255, 255, 255, .1); }
.mc-rec-core { width: 44px; height: 44px; border-radius: 50%; background: var(--mc-rec); transition: border-radius .35s var(--spring), transform .35s var(--spring); }
.mc-rec-btn[aria-pressed="true"] .mc-rec-core { border-radius: 9px; transform: scale(.55); }
.mc-dock .sep { width: 1px; height: 26px; background: rgba(255, 255, 255, .2); }
.mc-count { position: absolute; inset: 0; z-index: 6; display: grid; place-items: center; background: rgba(5, 5, 10, .58); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: mc-fade .25s both; }
.mc-count-wrap { position: relative; display: grid; place-items: center; width: min(46vw, 230px); aspect-ratio: 1; }
.mc-count-wrap svg { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.mc-count-wrap circle { fill: none; stroke-width: 3; }
.mc-count-wrap circle:first-child { stroke: rgba(255, 255, 255, .14); }
.mc-count-wrap circle:last-child { stroke: url(#mc-grad); stroke-linecap: round; stroke-dasharray: 289; stroke-dashoffset: 289; animation: mc-ring 1s linear both; }
.mc-count b { font-size: clamp(84px, 20vw, 150px); line-height: 1; font-weight: 700; letter-spacing: -.05em; background: var(--brand); -webkit-background-clip: text; background-clip: text; color: transparent; animation: mc-num 1s var(--ease) both; }
@keyframes mc-num { 0% { transform: scale(1.7); opacity: 0; filter: blur(14px); } 22% { transform: scale(1); opacity: 1; filter: blur(0); } 78% { opacity: 1; } 100% { transform: scale(.82); opacity: 0; } }
@keyframes mc-ring { to { stroke-dashoffset: 0; } }
.mc-flash { position: absolute; inset: 0; z-index: 5; background: #fff; opacity: 0; pointer-events: none; }
.mc-flash.go { animation: mc-flash .5s ease-out both; }
@keyframes mc-flash { 0% { opacity: .95; } 100% { opacity: 0; } }
.mc-badge-row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; margin-top: 2px; }
.mc-badge-row span { font-size: 12px; padding: 4px 10px; border-radius: 999px; color: rgba(255, 255, 255, .78); border: 1px solid rgba(255, 255, 255, .16); background: rgba(255, 255, 255, .07); display: inline-flex; align-items: center; gap: 5px; }
.mc-badge-row .icon { width: 13px; height: 13px; }
.mc-meter { display: inline-flex; align-items: flex-end; gap: 2px; height: 16px; }
.mc-meter i { width: 3px; border-radius: 2px; background: rgba(255, 255, 255, .28); height: 30%; transition: height .08s linear, background .1s; }
.mc-meter i.on { background: #4ade80; }
.mc-meter i.hot { background: #fbbf24; }
.mc-meter i.clip { background: var(--mc-rec); }

/* ---------- Option tiles (bento) ---------- */
.mc-opts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 10px; }
.mc-opt {
  position: relative; display: flex; align-items: flex-start; flex-wrap: wrap; gap: 6px 12px; padding: 14px; border-radius: 18px; cursor: pointer; min-width: 0; user-select: none;
  border: 1px solid var(--border); background: var(--surface); transition: border-color .25s, background .25s, transform .25s var(--ease), box-shadow .25s;
}
.mc-opt:hover { transform: translateY(-2px); box-shadow: var(--shadow); border-color: var(--border-strong); }
.mc-opt input[type="checkbox"], .mc-opt input[type="radio"] { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
.mc-opt.sel { cursor: default; }
.mc-opt-ic { width: 38px; height: 38px; flex: none; border-radius: 12px; display: grid; place-items: center; color: var(--mc-c); background: color-mix(in srgb, var(--mc-c) 12%, transparent); border: 1px solid color-mix(in srgb, var(--mc-c) 22%, transparent); transition: all .35s var(--spring); }
.mc-opt-t { min-width: 0; flex: 1; padding-right: 36px; }
.mc-opt-t b { display: block; font-size: 14px; font-weight: 600; }
.mc-opt-t span { display: block; font-size: 12.5px; color: var(--muted); margin-top: 1px; overflow-wrap: anywhere; }
.mc-opt.sel .mc-opt-t { padding-right: 0; }
.mc-opt.sel select, .mc-opt.sel input:not([type="checkbox"]):not([type="radio"]) { flex-basis: 100%; height: 38px; font-size: 14px; }
.mc-opt-sw { position: absolute; top: 14px; right: 14px; width: 34px; height: 20px; border-radius: 99px; background: var(--border-strong); transition: background .25s; }
.mc-opt-sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .3); transition: transform .3s var(--spring); }
.mc-opt:has(input:checked) { border-color: color-mix(in srgb, var(--mc-c) 58%, var(--border)); background: linear-gradient(150deg, color-mix(in srgb, var(--mc-c) 12%, var(--surface)), var(--surface) 72%); }
.mc-opt:has(input:checked) .mc-opt-ic { background: linear-gradient(140deg, var(--mc-c), color-mix(in srgb, var(--mc-c) 55%, var(--accent-2))); color: #fff; border-color: transparent; transform: rotate(-6deg) scale(1.06); box-shadow: 0 10px 22px -10px var(--mc-c); }
.mc-opt:has(input:checked) .mc-opt-sw { background: var(--mc-c); }
.mc-opt:has(input:checked) .mc-opt-sw::after { transform: translateX(14px); }
.mc-opt:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
.mc-opt.off { opacity: .55; pointer-events: none; }
.mc-opt.off .mc-opt-sw { display: none; }
.mc-opt.radio .mc-opt-sw { border-radius: 50%; width: 20px; height: 20px; background: transparent; border: 2px solid var(--border-strong); }
.mc-opt.radio .mc-opt-sw::after { inset: 3px; width: auto; height: auto; top: 3px; left: 3px; transform: scale(0); background: var(--mc-c); box-shadow: none; transition: transform .3s var(--spring); }
.mc-opt.radio:has(input:checked) .mc-opt-sw { background: transparent; border-color: var(--mc-c); }
.mc-opt.radio:has(input:checked) .mc-opt-sw::after { transform: scale(1); }
.mc-opt .mc-speed { flex-basis: 100%; display: flex; gap: 3px; margin-top: 2px; }
.mc-opt .mc-speed i { flex: 1; height: 4px; border-radius: 2px; background: var(--border); transition: background .3s; }
.mc-opt .mc-speed i.on { background: var(--mc-c); }

/* ---------- Takes (Pinterest-style cards) ---------- */
.mc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.mc-head h3 { font-size: 16px; display: flex; align-items: center; gap: 8px; }
.mc-head h3 .count { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.mc-takes { columns: 2 340px; column-gap: 14px; }
.mc-take {
  position: relative; break-inside: avoid; margin: 0 0 14px; border-radius: 22px; overflow: hidden; background: var(--surface); border: 1px solid var(--border);
  box-shadow: var(--shadow-sm); animation: mc-pop .65s var(--spring) both; transition: box-shadow .3s, transform .3s var(--ease), border-color .3s;
}
.mc-take:hover { box-shadow: var(--shadow); transform: translateY(-3px); border-color: color-mix(in srgb, var(--mc-c) 35%, var(--border)); }
.mc-take.fresh::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; background: linear-gradient(110deg, transparent 30%, color-mix(in srgb, var(--mc-c) 38%, transparent) 50%, transparent 70%); animation: mc-sweep 1.3s .25s var(--ease) both; }
@keyframes mc-pop { from { opacity: 0; transform: translateY(22px) scale(.93); filter: blur(5px); } }
@keyframes mc-sweep { from { transform: translateX(-100%); } to { transform: translateX(100%); opacity: 0; } }
.mc-take-media { display: block; width: 100%; background: #000; max-height: 380px; }
.mc-take-media.img { object-fit: contain; background: var(--checker); }
.mc-take-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.mc-take-name { border: 0; background: transparent; font: inherit; font-weight: 600; font-size: 15px; letter-spacing: -.01em; padding: 3px 6px; margin: -3px -6px; border-radius: 8px; width: calc(100% + 12px); min-width: 0; color: var(--text); text-overflow: ellipsis; }
.mc-take-name:hover { background: var(--surface-2); }
.mc-take-name:focus { outline: 2px solid var(--accent); background: var(--surface-2); }
.mc-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.mc-act { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.mc-act .grow { flex: 1; }
.mc-shots { columns: 3 150px; column-gap: 10px; }
.mc-shot { position: relative; break-inside: avoid; margin: 0 0 10px; border-radius: 16px; overflow: hidden; border: 1px solid var(--border); background: var(--checker); animation: mc-pop .6s var(--spring) both; }
.mc-shot img { display: block; width: 100%; height: auto; }
.mc-shot .mc-shot-act { position: absolute; right: 6px; bottom: 6px; display: flex; gap: 6px; opacity: 0; transform: translateY(6px); transition: opacity .25s, transform .25s var(--ease); }
.mc-shot:hover .mc-shot-act, .mc-shot:focus-within .mc-shot-act { opacity: 1; transform: none; }
@media (hover: none) { .mc-shot .mc-shot-act { opacity: 1; transform: none; } }
.mc-shot .btn { box-shadow: 0 6px 16px -6px rgba(0, 0, 0, .5); }

/* ---------- Voice recorder ---------- */
.mc-voice { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 30px 18px 26px; text-align: center; min-height: 380px; }
.mc-orb-wrap { position: relative; width: 150px; height: 150px; display: grid; place-items: center; --lvl: 0; }
.mc-ring { position: absolute; inset: 0; border-radius: 50%; border: 2px solid rgba(255, 255, 255, .22); opacity: 0; }
.mc-stage[data-state="rec"] .mc-ring { animation: mc-ripple 2.6s ease-out infinite; }
.mc-stage[data-state="rec"] .mc-ring:nth-child(2) { animation-delay: .85s; }
.mc-stage[data-state="rec"] .mc-ring:nth-child(3) { animation-delay: 1.7s; }
@keyframes mc-ripple { 0% { transform: scale(.7); opacity: .8; } 100% { transform: scale(1.5); opacity: 0; } }
.mc-orb {
  position: relative; width: 104px; height: 104px; border-radius: 50%; border: 0; cursor: pointer; display: grid; place-items: center; color: #fff;
  background: radial-gradient(circle at 30% 25%, #ff7a6e, #ff453a 55%, #d92d20); box-shadow: 0 24px 50px -16px rgba(255, 69, 58, .85), inset 0 2px 0 rgba(255, 255, 255, .4);
  transform: scale(calc(1 + var(--lvl) * .22)); transition: transform .09s linear, box-shadow .3s, background .3s;
}
.mc-orb:hover { box-shadow: 0 28px 60px -14px rgba(255, 69, 58, 1), inset 0 2px 0 rgba(255, 255, 255, .4); }
.mc-orb:focus-visible { outline: 3px solid #fff; outline-offset: 5px; }
.mc-orb .icon { width: 40px; height: 40px; }
.mc-orb .mc-square { width: 34px; height: 34px; border-radius: 10px; }
.mc-stage[data-state="paused"] .mc-orb { background: radial-gradient(circle at 30% 25%, #fde68a, #fbbf24 55%, #d97706); box-shadow: 0 24px 50px -16px rgba(251, 191, 36, .7), inset 0 2px 0 rgba(255, 255, 255, .5); }
.mc-time { font-family: var(--mono); font-size: clamp(38px, 8vw, 56px); font-weight: 500; letter-spacing: -.02em; line-height: 1; font-variant-numeric: tabular-nums; color: #fff; }
.mc-time small { font-size: .42em; opacity: .55; margin-left: 2px; }
.mc-wave { width: 100%; max-width: 640px; height: 92px; display: block; }
.mc-level { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 420px; font-size: 12px; color: rgba(255, 255, 255, .65); font-variant-numeric: tabular-nums; }
.mc-level-bar { position: relative; flex: 1; height: 8px; border-radius: 99px; background: rgba(255, 255, 255, .13); overflow: hidden; }
.mc-level-bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; border-radius: inherit; background: linear-gradient(90deg, #4ade80 0%, #4ade80 68%, #fbbf24 82%, #ff453a 100%); background-size: 420px 100%; transition: width .06s linear; }
.mc-level-bar b { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; left: 0; transition: left .06s linear; opacity: .9; }
.mc-level output { min-width: 52px; text-align: right; font-family: var(--mono); }
.mc-voice-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.mc-ghost { background: rgba(255, 255, 255, .12); color: #fff; border: 1px solid rgba(255, 255, 255, .2); }
.mc-ghost:hover:not(:disabled) { background: rgba(255, 255, 255, .22); }

/* ---------- Trim editor ---------- */
.mc-trim { position: relative; height: 130px; border-radius: 16px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--border); touch-action: none; user-select: none; cursor: crosshair; }
.mc-trim canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.mc-trim-shade { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--bg) 62%, transparent); backdrop-filter: grayscale(1); pointer-events: none; }
.mc-handle { position: absolute; top: 0; bottom: 0; width: 22px; margin-left: -11px; cursor: ew-resize; display: grid; place-items: center; z-index: 2; touch-action: none; }
.mc-handle::before { content: ""; width: 3px; height: 100%; background: var(--mc-c); border-radius: 2px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--bg) 60%, transparent); }
.mc-handle::after { content: ""; position: absolute; top: 50%; width: 16px; height: 34px; margin-top: -17px; border-radius: 8px; background: var(--mc-c); box-shadow: 0 6px 14px -4px color-mix(in srgb, var(--mc-c) 80%, #000); }
.mc-handle:focus-visible { outline: none; }
.mc-handle:focus-visible::after { outline: 2px solid var(--text); outline-offset: 2px; }
.mc-playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text); pointer-events: none; opacity: 0; z-index: 1; }
.mc-playhead.on { opacity: .85; }

/* ---------- Transcription ---------- */
.mc-models { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 10px; }
.mc-work { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 14px; padding: 22px; border-radius: 22px; border: 1px solid color-mix(in srgb, var(--mc-c) 30%, var(--border)); background: linear-gradient(150deg, color-mix(in srgb, var(--mc-c) 10%, var(--surface)), var(--surface) 70%); animation: mc-fade .4s var(--ease) both; }
.mc-work-top { display: flex; align-items: center; gap: 14px; }
.mc-eq { display: flex; align-items: flex-end; gap: 4px; height: 38px; flex: none; }
.mc-eq i { width: 6px; border-radius: 3px; background: linear-gradient(var(--mc-c), var(--accent-2)); height: 40%; animation: mc-eq 1s ease-in-out infinite; }
.mc-eq i:nth-child(2) { animation-delay: -.2s; } .mc-eq i:nth-child(3) { animation-delay: -.45s; } .mc-eq i:nth-child(4) { animation-delay: -.7s; } .mc-eq i:nth-child(5) { animation-delay: -.1s; }
@keyframes mc-eq { 0%, 100% { height: 22%; } 50% { height: 100%; } }
.mc-work h3 { font-size: 16px; } .mc-work p { font-size: 13px; color: var(--muted); }
.mc-steps { display: flex; gap: 6px; flex-wrap: wrap; }
.mc-step { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 4px 11px; border-radius: 999px; color: var(--muted); border: 1px solid var(--border); background: var(--surface); transition: all .3s; }
.mc-step .icon { width: 13px; height: 13px; }
.mc-step.now { color: var(--text); border-color: color-mix(in srgb, var(--mc-c) 55%, var(--border)); background: color-mix(in srgb, var(--mc-c) 10%, var(--surface)); }
.mc-step.now .icon { animation: mc-spin 1.4s linear infinite; color: var(--mc-c); }
.mc-step.done { color: var(--success); }
.mc-media { display: flex; gap: 14px; align-items: center; padding: 12px; border-radius: 20px; border: 1px solid var(--border); background: var(--surface); animation: mc-fade .4s var(--ease) both; flex-wrap: wrap; }
.mc-media .meta { flex: 1; min-width: 160px; }
.mc-media .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-media .sub { font-size: 12.5px; color: var(--muted); }
.mc-player { position: relative; border-radius: 20px; overflow: hidden; background: #000; border: 1px solid var(--border); }
.mc-player video { display: block; width: 100%; max-height: 420px; background: #000; }
.mc-player audio { display: block; width: 100%; }
.mc-player.audio { background: var(--surface); padding: 12px; }
.mc-sub { position: absolute; left: 50%; bottom: 52px; transform: translateX(-50%); max-width: 88%; padding: 5px 12px; border-radius: 8px; background: rgba(0, 0, 0, .72); color: #fff; font-size: clamp(14px, 2.4vw, 20px); line-height: 1.35; text-align: center; white-space: pre-line; pointer-events: none; transition: opacity .12s; }
.mc-sub:empty { opacity: 0; }
.mc-player video::cue { background: rgba(0, 0, 0, .72); color: #fff; }
.mc-now:empty::before { content: 'Subtitles show here as it plays'; color: var(--muted); font-size: 13px; }
.mc-now { margin-top: 10px; padding: 10px 14px; border-radius: 14px; background: var(--surface-2); text-align: center; min-height: 44px; white-space: pre-line; color: var(--text-2); font-size: 15px; }

/* ---------- Cue editor ---------- */
.mc-cues { position: relative; display: flex; flex-direction: column; gap: 8px; max-height: 560px; overflow: auto; padding: 2px; scroll-behavior: smooth; }
.mc-cue { position: relative; display: grid; grid-template-columns: 34px 138px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 10px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border); transition: border-color .2s, background .2s, box-shadow .2s; }
.mc-cue:hover { box-shadow: var(--shadow-sm); }
.mc-cue.active { border-color: color-mix(in srgb, var(--mc-c) 60%, var(--border)); background: linear-gradient(90deg, color-mix(in srgb, var(--mc-c) 12%, var(--surface)), var(--surface) 60%); box-shadow: inset 3px 0 0 var(--mc-c); }
.mc-cue-n { font-family: var(--mono); font-size: 12px; color: var(--muted); padding-top: 11px; text-align: center; }
.mc-cue-times { display: flex; flex-direction: column; gap: 5px; }
.mc-cue-times .input { height: 34px; padding: 0 9px; font-size: 13px; border-radius: 10px; }
.mc-cue-times .dur { font-size: 11.5px; color: var(--muted); text-align: center; }
.mc-cue textarea { min-height: 0; height: 68px; padding: 8px 10px; font-size: 14px; border-radius: 10px; resize: vertical; }
.mc-cue-act { display: grid; grid-template-columns: repeat(2, 32px); gap: 4px; }
.mc-cue-act .btn { width: 32px; height: 32px; padding: 0; }
.mc-cue-flags { grid-column: 2 / -1; display: flex; gap: 6px; flex-wrap: wrap; empty-cells: hide; }
.mc-cue-flags:empty { display: none; }
.mc-flag { font-size: 11.5px; padding: 2px 8px; border-radius: 99px; background: var(--warning-soft); color: var(--warning); border: 1px solid color-mix(in srgb, var(--warning) 28%, transparent); }
.mc-flag.err { background: var(--danger-soft); color: var(--danger); border-color: color-mix(in srgb, var(--danger) 28%, transparent); }
.mc-cue-tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.mc-seg-list { display: flex; flex-direction: column; gap: 4px; max-height: 480px; overflow: auto; }
.mc-seg { display: flex; gap: 10px; align-items: baseline; padding: 8px 10px; border-radius: 12px; cursor: pointer; border: 1px solid transparent; transition: background .2s, border-color .2s; text-align: left; background: transparent; width: 100%; }
.mc-seg:hover { background: var(--surface-2); }
.mc-seg.active { background: color-mix(in srgb, var(--mc-c) 10%, var(--surface)); border-color: color-mix(in srgb, var(--mc-c) 40%, var(--border)); }
.mc-seg time { font-family: var(--mono); font-size: 12px; color: var(--accent); flex: none; padding: 1px 8px; border-radius: 99px; background: var(--accent-soft); }

/* ---------- Converter ---------- */
.mc-tl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 10px; align-items: center; padding: 12px; border-radius: 16px; background: var(--surface-2); border: 1px solid var(--border); }
.mc-tl > b { font-size: 12px; font-weight: 600; color: var(--muted); }
.mc-tl-lane { position: relative; height: 26px; border-radius: 9px; overflow: hidden; background: color-mix(in srgb, var(--text) 5%, transparent); }
.mc-tl-lane i { position: absolute; top: 4px; bottom: 4px; min-width: 2px; border-radius: 4px; background: var(--muted); opacity: .5; transition: left .55s var(--ease), width .55s var(--ease); }
.mc-tl-lane.after i { background: linear-gradient(90deg, var(--mc-c), var(--accent-2)); opacity: .95; }
.mc-tl-ruler { grid-column: 2; display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); font-family: var(--mono); }
.mc-diff { display: grid; grid-template-columns: auto 1fr 1fr; gap: 4px 12px; font-family: var(--mono); font-size: 12.5px; }
.mc-diff .h { font-family: var(--font); font-size: 12px; color: var(--muted); font-weight: 600; }
.mc-diff .to { color: var(--accent); }
.mc-chipbar { display: flex; gap: 6px; flex-wrap: wrap; }
.mc-pill-btn { height: 30px; padding: 0 11px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); font-size: 12.5px; font-weight: 550; cursor: pointer; font-family: var(--mono); color: var(--text-2); transition: all .2s var(--ease); }
.mc-pill-btn:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.mc-pill-btn:active { transform: scale(.95); }
.mc-big-out { font-family: var(--mono); font-size: 13px; }

@media (max-width: 720px) {
  .mc-stage { border-radius: 22px; max-height: none; }
  .mc-stage:has(.mc-live) { min-height: 270px; }
  .mc-stage:not(:has(.mc-live)) { aspect-ratio: auto; min-height: 300px; }
  .mc-dock { gap: 8px; padding: 6px; bottom: 12px; }
  .mc-dbtn { width: 42px; height: 42px; }
  .mc-dbtn.stop { width: 52px; height: 52px; }
  .mc-hud { left: 10px; right: 10px; top: 10px; }
  .mc-chip { height: 30px; padding: 0 10px; font-size: 12px; }
  .mc-cue { grid-template-columns: 28px minmax(0, 1fr) auto; }
  .mc-cue-times { grid-column: 2 / 3; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .mc-cue-times .input { flex: 1; min-width: 104px; }
  .mc-cue-act { flex-direction: row; grid-row: 1; grid-column: 3; }
  .mc-cue textarea { grid-column: 2 / -1; }
  .mc-cue-flags { grid-column: 2 / -1; }
  .mc-cue-act .btn { width: 30px; height: 30px; }
  .mc-takes { columns: 1; }
  .mc-orb-wrap { width: 128px; height: 128px; }
  .mc-orb { width: 92px; height: 92px; }
  .mc-voice { min-height: 340px; padding-top: 24px; }
}
`
