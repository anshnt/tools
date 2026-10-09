// Styles for Photo Studio, injected once. Everything is scoped under .ps and uses the site's CSS variables (light and dark).
const CSS = `
.ps { --bar: color-mix(in srgb, var(--surface) 82%, var(--bg-2)); --stage: color-mix(in srgb, var(--text) 7%, var(--bg-2)); position: relative; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto;
  height: clamp(540px, calc(100dvh - 215px), 1080px); border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); overflow: hidden; font-size: 13px; color: var(--text); box-shadow: var(--shadow); }
.tool-body:fullscreen .ps { height: calc(100dvh - 20px); }
.ps * { scrollbar-width: thin; }
.ps button { font: inherit; }
.ps-top, .ps-opts { display: flex; align-items: center; gap: 4px; padding: 6px 10px; background: var(--bar); border-bottom: 1px solid var(--border); }
.ps-top { overflow-x: auto; scrollbar-width: none; flex-wrap: nowrap; }
.ps-top::-webkit-scrollbar, .ps-opts::-webkit-scrollbar { display: none; }
.ps-opts { gap: 14px; min-height: 48px; overflow-x: auto; }
.ps-sp { flex: 1; min-width: 6px; }
.ps-sep { width: 1px; height: 22px; background: var(--border); margin: 0 4px; flex: none; }
.ps-mb { height: 32px; padding: 0 10px; border-radius: 9px; border: 0; background: transparent; color: var(--text); cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; flex: none; }
.ps-mb:hover, .ps-mb[aria-expanded="true"] { background: var(--surface-3); }
.ps-ib { width: 32px; height: 32px; padding: 0; border-radius: 9px; border: 0; background: transparent; color: var(--text-2); cursor: pointer; display: inline-grid; place-items: center; flex: none; }
.ps-ib:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
.ps-ib:disabled { opacity: .35; cursor: default; }
.ps-ib .icon, .ps-mb .icon, .ps-tool .icon { width: 17px; height: 17px; }
.ps-ib.sm { width: 26px; height: 26px; border-radius: 7px; } .ps-ib.sm .icon { width: 15px; height: 15px; }
.ps-ib[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.ps-go { height: 32px; padding: 0 14px; border-radius: 10px; border: 0; background: var(--accent); color: var(--accent-text); font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; flex: none; }
.ps-go:hover { filter: brightness(1.08); }
.ps-go .icon { width: 16px; height: 16px; }
.ps-zoomtxt { min-width: 52px; text-align: center; font-variant-numeric: tabular-nums; color: var(--text-2); font-size: 12.5px; }
.ps-dock-btn { display: none; }

.ps-main { display: grid; grid-template-columns: auto minmax(0, 1fr) 304px; min-height: 0; position: relative; }
.ps-rail { display: flex; flex-direction: column; gap: 2px; padding: 8px 6px; background: var(--bar); border-right: 1px solid var(--border); overflow-y: auto; scrollbar-width: none; align-items: center; }
.ps-rail::-webkit-scrollbar { display: none; }
.ps-tool { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: 10px; border: 0; background: transparent; color: var(--text-2); cursor: pointer; transition: background .15s, color .15s, transform .15s var(--spring); }
.ps-tool:hover { background: var(--surface-3); color: var(--text); }
.ps-tool:active { transform: scale(.92); }
.ps-tool[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent); }
.ps-rail .ps-gap { height: 6px; flex: none; }
.ps-colors { position: relative; width: 36px; height: 40px; margin-top: 8px; flex: none; }
.ps-colors label { position: absolute; width: 22px; height: 22px; border-radius: 6px; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; overflow: hidden; }
.ps-colors label.fg { left: 1px; top: 0; z-index: 2; } .ps-colors label.bg { left: 14px; top: 14px; }
.ps-colors input { position: absolute; inset: -6px; width: 40px; height: 40px; opacity: 0; cursor: pointer; }
.ps-colors .sw { position: absolute; inset: 0; pointer-events: none; }
.ps-colors button { position: absolute; width: 14px; height: 14px; padding: 0; border: 0; background: transparent; color: var(--muted); cursor: pointer; display: grid; place-items: center; }
.ps-colors button .icon { width: 12px; height: 12px; }
.ps-colors .swap { left: 24px; top: -2px; } .ps-colors .reset { left: 0; top: 26px; }

.ps-center { position: relative; min-width: 0; min-height: 0; background: var(--stage); }
.ps-stage { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; outline: none; cursor: crosshair; background: var(--stage); }
.ps-stage.panning, .ps-stage[data-grab="1"] { cursor: grabbing !important; }
.ps-stage canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.ps-ants, .ps-over { pointer-events: none; }
.ps-ants { image-rendering: pixelated; }
.ps-ants.a { animation: ps-ants-a .9s steps(1) infinite; }
.ps-ants.b { animation: ps-ants-b .9s steps(1) infinite; }
@keyframes ps-ants-a { 0% { opacity: 1 } 50% { opacity: 0 } }
@keyframes ps-ants-b { 0% { opacity: 0 } 50% { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .ps-ants.b { display: none; } .ps-ants.a { animation: none; } .ps-tool { transition: none; } }
.ps-ring { position: absolute; pointer-events: none; border: 1.5px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.65), inset 0 0 0 1px rgba(0,0,0,.35); transform: translate(-50%, -50%); z-index: 3; display: none; }
.ps-start { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; overflow: auto; z-index: 5; background: color-mix(in srgb, var(--stage) 92%, transparent); backdrop-filter: blur(6px); }
.ps-start-card { width: min(640px, 100%); display: grid; gap: 14px; padding: 22px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-lg); }
.ps-start-card h2 { margin: 0; font-size: 20px; letter-spacing: -.01em; }
.ps-start-card p { margin: 0; color: var(--muted); }
.ps-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.ps-preset { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; text-align: left; cursor: pointer; border-radius: 12px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text); transition: border-color .2s, transform .2s var(--ease); }
.ps-preset:hover { border-color: var(--accent); transform: translateY(-2px); }
.ps-preset b { font-size: 13px; } .ps-preset span { font-size: 12px; color: var(--muted); }
.ps-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

.ps-dock { display: grid; grid-template-rows: minmax(190px, 47%) minmax(0, 1fr); border-left: 1px solid var(--border); background: var(--surface); min-height: 0; min-width: 0; }
.ps-sec { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.ps-sec + .ps-sec { border-top: 1px solid var(--border); }
.ps-tabs { display: flex; gap: 2px; padding: 6px 8px; background: var(--bar); border-bottom: 1px solid var(--border); align-items: center; flex: none; }
.ps-tab { height: 28px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; font-weight: 500; }
.ps-tab:hover { color: var(--text); }
.ps-tab[aria-selected="true"] { background: var(--surface-3); color: var(--text); }
.ps-body { overflow: auto; padding: 10px; flex: 1; min-height: 0; }
.ps-note { color: var(--muted); font-size: 12.5px; line-height: 1.45; }

.ps-lhead { display: grid; grid-template-columns: 1fr 64px; gap: 8px; padding: 8px; border-bottom: 1px solid var(--border); flex: none; align-items: center; }
.ps-lhead .ps-rng { grid-column: 1 / -1; }
.ps-layers { overflow: auto; flex: 1; padding: 6px; display: flex; flex-direction: column; gap: 2px; min-height: 0; }
.ps-layer { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; flex: none; }
.ps-layer:hover { background: var(--surface-2); }
.ps-layer.sel { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 38%, transparent); }
.ps-layer.dim .ps-name { opacity: .5; }
.ps-layer.over { box-shadow: 0 -2px 0 var(--accent); }
.ps-thumb { width: 38px; height: 38px; border-radius: 7px; overflow: hidden; flex: none; background: repeating-conic-gradient(#8c8c99 0 25%, #c6c6d0 0 50%) 50% / 10px 10px; border: 1px solid var(--border); display: grid; place-items: center; color: var(--text-2); }
.ps-thumb canvas { width: 100%; height: 100%; display: block; }
.ps-thumb.mask { background: #000; margin-left: -2px; }
.ps-thumb.mask.on { outline: 2px solid var(--accent); outline-offset: 1px; }
.ps-thumb .icon { width: 18px; height: 18px; }
.ps-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.ps-name input { width: 100%; font: inherit; padding: 2px 4px; border-radius: 6px; border: 1px solid var(--accent); background: var(--surface); color: var(--text); }
.ps-lfoot { display: flex; gap: 2px; padding: 6px 8px; border-top: 1px solid var(--border); background: var(--bar); flex: none; flex-wrap: wrap; }

.ps-f { display: grid; gap: 4px; margin-bottom: 10px; min-width: 0; }
.ps-f > label, .ps-f > .l { display: flex; justify-content: space-between; align-items: baseline; color: var(--text-2); font-size: 12.5px; gap: 8px; }
.ps-f output { color: var(--muted); font-variant-numeric: tabular-nums; }
.ps-f2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ps-in, .ps-sel { height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); font: inherit; min-width: 0; max-width: 100%; }
textarea.ps-in { height: auto; min-height: 64px; padding: 6px 8px; resize: vertical; width: 100%; }
.ps-in:focus-visible, .ps-sel:focus-visible, .ps input[type=range]:focus-visible, .ps-form input[type=range]:focus-visible, .ps-tool:focus-visible, .ps-ib:focus-visible, .ps-mb:focus-visible, .ps-tab:focus-visible, .ps-go:focus-visible, .ps-layer:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
.ps input[type=range], .ps-form input[type=range] { accent-color: var(--accent); width: 100%; min-width: 0; margin: 0; height: 22px; }
.ps input[type=color], .ps-form input[type=color] { width: 34px; height: 30px; padding: 2px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); cursor: pointer; }
.ps-oc { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; flex: none; }
.ps-oc > span.l { color: var(--muted); font-size: 12.5px; }
.ps-oc input[type=range] { width: 104px; }
.ps-oc output { min-width: 42px; font-variant-numeric: tabular-nums; color: var(--text-2); font-size: 12.5px; }
.ps-oc .ps-sel { height: 28px; }
.ps-seg { display: inline-flex; padding: 2px; border-radius: 9px; background: var(--surface-3); gap: 2px; }
.ps-seg button { height: 26px; padding: 0 9px; border: 0; border-radius: 7px; background: transparent; color: var(--text-2); cursor: pointer; font-size: 12.5px; white-space: nowrap; }
.ps-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); font-weight: 600; }
.ps-chk { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; color: var(--text-2); font-size: 12.5px; }
.ps-chk input { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; }
.ps-btn { height: 28px; padding: 0 11px; border-radius: 8px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex: none; }
.ps-btn:hover { background: var(--surface-3); }
.ps-btn.primary { background: var(--accent); color: var(--accent-text); border-color: transparent; font-weight: 600; }
.ps-btn .icon { width: 14px; height: 14px; }
.ps-toolname { font-weight: 600; display: inline-flex; align-items: center; gap: 6px; flex: none; }
.ps-toolname .icon { width: 16px; height: 16px; color: var(--accent); }
.ps-hint { color: var(--muted); font-size: 12px; flex: none; max-width: 38ch; white-space: normal; line-height: 1.25; }

.ps-hist { display: flex; flex-direction: column; gap: 1px; }
.ps-h { display: flex; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: 8px; border: 0; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
.ps-h:hover { background: var(--surface-2); }
.ps-h.cur { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.ps-h.redo { color: var(--muted); }
.ps-h small { color: var(--muted); flex: none; }
.ps-sw { display: grid; grid-template-columns: repeat(auto-fill, 24px); gap: 6px; margin-top: 8px; }
.ps-sw button { width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--border-strong); cursor: pointer; padding: 0; }
.ps-curve { width: 100%; aspect-ratio: 1; border-radius: 10px; border: 1px solid var(--border-strong); background: var(--surface-2); touch-action: none; display: block; cursor: crosshair; }
.ps-stops { display: grid; gap: 6px; }
.ps-stop { display: grid; grid-template-columns: 34px 1fr 34px; gap: 8px; align-items: center; }

.ps-status { display: flex; gap: 16px; align-items: center; padding: 4px 12px; background: var(--bar); border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; white-space: nowrap; overflow-x: auto; scrollbar-width: none; }
.ps-status b { color: var(--text-2); font-weight: 500; font-variant-numeric: tabular-nums; }
.ps-menu { position: absolute; z-index: 40; min-width: 220px; max-height: 70%; overflow: auto; padding: 5px; border-radius: 12px; border: 1px solid var(--border-strong); background: var(--surface); box-shadow: var(--shadow-lg); animation: ps-pop .14s var(--ease); }
@keyframes ps-pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
.ps-mi { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; border: 0; background: transparent; color: var(--text); border-radius: 8px; cursor: pointer; text-align: left; }
.ps-mi:hover:not(:disabled), .ps-mi:focus-visible { background: var(--accent-soft); outline: none; }
.ps-mi:disabled { opacity: .38; cursor: default; }
.ps-mi .icon { width: 15px; height: 15px; color: var(--muted); }
.ps-mi kbd { margin-left: auto; padding-left: 18px; font: 11.5px var(--mono); color: var(--muted); }
.ps-ms { height: 1px; background: var(--border); margin: 4px 6px; }
.ps-mh { padding: 6px 10px 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.ps-tip { position: fixed; z-index: 60; pointer-events: none; padding: 5px 9px; border-radius: 8px; background: var(--text); color: var(--bg); font-size: 12px; white-space: nowrap; box-shadow: var(--shadow); opacity: 0; transition: opacity .12s; }
.ps-tip.on { opacity: 1; }
.ps-tip kbd { margin-left: 8px; opacity: .65; font: 11px var(--mono); }
.ps-form { display: grid; gap: 12px; min-width: min(420px, 78vw); }
.ps-anchor { display: grid; grid-template-columns: repeat(3, 28px); gap: 4px; }
.ps-anchor button { width: 28px; height: 28px; border-radius: 7px; border: 1px solid var(--border-strong); background: var(--surface-2); cursor: pointer; padding: 0; }
.ps-anchor button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); }
.ps-foot { padding: 6px 12px; border-top: 1px solid var(--border); background: var(--bar); color: var(--muted); font-size: 12px; }
.ps-foot a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

@media (max-width: 860px) {
  .ps { height: clamp(480px, calc(100dvh - 150px), 900px); }
  .ps-main { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .ps-rail { grid-row: 2; flex-direction: row; border-right: 0; border-top: 1px solid var(--border); padding: 6px 8px; overflow-x: auto; overflow-y: hidden; justify-content: flex-start; }
  .ps-rail .ps-gap { width: 6px; height: 36px; }
  .ps-colors { margin: 0 4px 0 8px; }
  .ps-dock { position: absolute; left: 0; right: 0; bottom: 56px; height: min(50%, 400px); transform: translateY(calc(100% + 60px)); transition: transform .28s var(--ease); z-index: 20; border-left: 0; border-top: 1px solid var(--border-strong); box-shadow: 0 -18px 40px -20px rgba(0,0,0,.4); grid-template-rows: minmax(0, 1fr); }
  .ps[data-dock="open"] .ps-dock { transform: none; }
  .ps-dock .ps-sec.layers-sec { display: none; }
  .ps-body .ps-lt { display: none; }
  .ps-dock-btn { display: inline-grid; }
  .ps-start { padding: 10px; }
  .ps-opts { padding: 6px 8px; gap: 10px; }
  .ps-oc input[type=range] { width: 84px; }
  .ps-hint { display: none; }
  .ps-ib, .ps-mb { min-height: 36px; }
}
@media (hover: none) { .ps-tip { display: none; } }
`
let injected = false
export function injectStyle() {
  if (injected && document.querySelector('style[data-ps]')) return
  const s = document.createElement('style')
  s.dataset.ps = ''
  s.textContent = CSS
  document.head.append(s)
  injected = true
}
