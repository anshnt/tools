// Styles for CAD Studio. Everything is scoped under .t-cad and uses the site's CSS variables so light and dark both work.
const CSS = `
.t-cad { --cad-bg: #ffffff; --cad-rail: var(--surface); position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; height: clamp(540px, calc(100dvh - 215px), 1000px);
  border: 1px solid var(--border); border-radius: 16px; background: var(--surface); box-shadow: var(--shadow); overflow: hidden; font-size: 13px; color: var(--text); isolation: isolate; }
:root[data-theme="dark"] .t-cad { --cad-bg: #0b0c11; }
.tool-body:fullscreen .t-cad { height: calc(100dvh - 20px); }
.t-cad *, .t-cad *::before, .t-cad *::after, .t-cad-dlg *, .t-cad-dlg *::before, .t-cad-dlg *::after { box-sizing: border-box; }
.t-cad button { font: inherit; color: inherit; }
.t-cad .cad-top { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 92%, var(--bg-2)); overflow-x: auto; scrollbar-width: none; }
.t-cad .cad-top::-webkit-scrollbar { display: none; }
.t-cad .cad-sep { width: 1px; align-self: stretch; margin: 4px 4px; background: var(--border); flex: none; }
.t-cad .cad-grow { flex: 1 1 auto; min-width: 8px; }
.t-cad .cad-name { width: 150px; flex: none; height: 32px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text); font-weight: 600; font-size: 13px; }
.t-cad .cad-name:hover { background: var(--surface-2); }
.t-cad .cad-name:focus { border-color: var(--accent); background: var(--surface); outline: none; box-shadow: 0 0 0 3px var(--ring); }
.t-cad .cad-saved { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; white-space: nowrap; padding: 0 6px; flex: none; }
.t-cad .cad-saved i { width: 7px; height: 7px; border-radius: 50%; background: var(--success); display: inline-block; }
.t-cad .cad-saved.dirty i { background: var(--warning); }
.t-cad .cad-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 32px; height: 32px; padding: 0 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; cursor: pointer; flex: none; white-space: nowrap; transition: background .15s, color .15s, border-color .15s; }
.t-cad .cad-btn .icon { width: 17px; height: 17px; flex: none; }
.t-cad .cad-btn:hover:not(:disabled) { background: var(--surface-3); }
.t-cad .cad-btn:disabled { opacity: .38; cursor: default; }
.t-cad .cad-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
.t-cad .cad-btn[aria-pressed="true"], .t-cad .cad-btn.on { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
.t-cad .cad-btn.primary { background: var(--accent); color: var(--accent-text); }
.t-cad .cad-btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, #000); }
.t-cad .cad-btn.lbl { padding: 0 11px; font-weight: 600; }
.t-cad [data-tip]::after { content: attr(data-tip); position: absolute; z-index: 40; pointer-events: none; opacity: 0; transform: translateY(2px); transition: opacity .12s, transform .12s; background: #15151c; color: #f4f4f8; padding: 5px 8px; border-radius: 7px; font-size: 11.5px; font-weight: 500; line-height: 1.25; white-space: nowrap; box-shadow: 0 6px 20px rgba(0,0,0,.25); top: calc(100% + 6px); left: 50%; translate: -50% 0; }
.t-cad [data-tip]:hover::after, .t-cad [data-tip]:focus-visible::after { opacity: 1; transform: none; transition-delay: .35s; }
.t-cad .cad-rail [data-tip]::after { top: 50%; left: calc(100% + 8px); translate: 0 -50%; }
.t-cad .cad-status [data-tip]::after { top: auto; bottom: calc(100% + 6px); }
@media (hover: none) { .t-cad [data-tip]::after { display: none; } }

.t-cad .cad-main { display: grid; grid-template-columns: auto minmax(0, 1fr) 300px; min-height: 0; position: relative; overflow: hidden; }
.t-cad .cad-rail { display: flex; flex-direction: column; gap: 2px; padding: 6px; width: 50px; border-right: 1px solid var(--border); background: var(--cad-rail); overflow-y: auto; overflow-x: hidden; scrollbar-width: none; }
.t-cad .cad-rail::-webkit-scrollbar { display: none; }
.t-cad .cad-rail .cad-btn { width: 36px; height: 36px; padding: 0; }
.t-cad .cad-rail .cad-btn .icon { width: 18px; height: 18px; }
.t-cad .cad-rail .cad-hr { height: 1px; background: var(--border); margin: 5px 6px; flex: none; }
.t-cad .cad-rail .cad-corner { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; border: 0; padding: 0; background: transparent; color: var(--muted); cursor: pointer; border-radius: 5px; display: grid; place-items: center; opacity: .6; }
.t-cad .cad-rail .cad-corner::before { content: ""; border: 3px solid transparent; border-right-color: currentColor; border-bottom-color: currentColor; transform: translate(1px, 1px); }
.t-cad .cad-ri { position: relative; flex: none; display: flex; }
.t-cad .cad-ri:hover .cad-corner { opacity: .9; background: var(--surface-3); }
.t-cad .cad-stage { position: relative; min-width: 0; min-height: 0; background: var(--cad-bg); overflow: hidden; touch-action: none; }
.t-cad canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; outline: none; cursor: none; }
.t-cad canvas.pan { cursor: grabbing; }
.t-cad canvas.touch { cursor: default; }
.t-cad .cad-hud { position: absolute; left: 10px; top: 10px; display: flex; flex-direction: column; gap: 6px; pointer-events: none; max-width: calc(100% - 20px); }
.t-cad .cad-chip { align-self: flex-start; background: color-mix(in srgb, var(--surface) 88%, transparent); border: 1px solid var(--border); backdrop-filter: blur(8px); border-radius: 10px; padding: 5px 10px; font-size: 12px; font-weight: 600; box-shadow: var(--shadow-sm); }
.t-cad .cad-chip small { font-weight: 500; color: var(--muted); margin-left: 6px; }
.t-cad .cad-measure { pointer-events: auto; padding: 9px 34px 9px 12px; min-width: 170px; position: relative; }
.t-cad .cad-measure b { display: block; font-size: 17px; letter-spacing: -.01em; }
.t-cad .cad-measure div { color: var(--muted); font-weight: 500; font-size: 12px; }
.t-cad .cad-measure .cad-btn { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; min-width: 26px; padding: 0; }
.t-cad .cad-zoomctl { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; background: color-mix(in srgb, var(--surface) 90%, transparent); border: 1px solid var(--border); border-radius: 12px; padding: 3px; box-shadow: var(--shadow-sm); backdrop-filter: blur(8px); }
.t-cad .cad-zoomctl .cad-btn { width: 32px; }
.t-cad .cad-zoomctl [data-tip]::after { top: 50%; left: auto; right: calc(100% + 8px); translate: 0 -50%; }
.t-cad .cad-textbox { position: absolute; z-index: 6; min-width: 120px; min-height: 28px; padding: 4px 6px; border: 1.5px solid var(--accent); border-radius: 6px; background: color-mix(in srgb, var(--surface) 94%, transparent); color: var(--text); font-family: Helvetica, Arial, sans-serif; line-height: 1.25; resize: both; outline: none; box-shadow: 0 0 0 4px var(--ring); }

.t-cad .cad-welcome { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; pointer-events: none; z-index: 3; }
.t-cad .cad-welcome[hidden] { display: none; }
.t-cad .cad-welcome-card { pointer-events: auto; width: min(440px, 100%); background: color-mix(in srgb, var(--surface) 94%, transparent); border: 1px solid var(--border); border-radius: 18px; padding: 18px; box-shadow: var(--shadow-lg); backdrop-filter: blur(10px); display: grid; gap: 12px; max-height: 100%; overflow: auto; }
.t-cad .cad-welcome-card h3 { margin: 0; font-size: 17px; letter-spacing: -.01em; }
.t-cad .cad-welcome-card p { margin: 0; color: var(--text-2); line-height: 1.5; }
.t-cad .cad-welcome-card kbd { font-family: var(--mono); font-size: 12px; background: var(--surface-3); padding: 1px 6px; border-radius: 5px; }
.t-cad .cad-welcome-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.t-cad .cad-welcome-card .dropzone { padding: 14px; }
.t-cad .cad-welcome-card .dropzone .dz-icon { width: 40px; height: 40px; border-radius: 12px; }

.t-cad .cad-panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: 1px solid var(--border); background: var(--surface); }
.t-cad .cad-tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--border); }
.t-cad .cad-tab { flex: 1; height: 34px; border: 0; background: transparent; border-radius: 8px 8px 0 0; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
.t-cad .cad-tab[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.t-cad .cad-tab:hover { color: var(--text); }
.t-cad .cad-body { flex: 1 1 auto; overflow: auto; padding: 10px; min-height: 0; }
:is(.t-cad, .t-cad-dlg) .cad-sec { margin: 0 0 14px; }
:is(.t-cad, .t-cad-dlg) .cad-sec h4 { margin: 0 0 8px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
:is(.t-cad, .t-cad-dlg) .cad-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
:is(.t-cad, .t-cad-dlg) .cad-f { display: grid; gap: 3px; min-width: 0; }
:is(.t-cad, .t-cad-dlg) .cad-f > span { font-size: 11.5px; color: var(--muted); font-weight: 600; }
:is(.t-cad, .t-cad-dlg) .cad-f.wide { grid-column: 1 / -1; }
:is(.t-cad, .t-cad-dlg) .cad-in, :is(.t-cad, .t-cad-dlg) .cad-sel, :is(.t-cad, .t-cad-dlg) .cad-ta { width: 100%; min-width: 0; height: 32px; padding: 0 9px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; font-size: 13px; }
:is(.t-cad, .t-cad-dlg) .cad-ta { height: auto; min-height: 64px; padding: 7px 9px; resize: vertical; }
:is(.t-cad, .t-cad-dlg) .cad-in:focus, :is(.t-cad, .t-cad-dlg) .cad-sel:focus, :is(.t-cad, .t-cad-dlg) .cad-ta:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
:is(.t-cad, .t-cad-dlg) .cad-in[readonly] { background: var(--surface-2); color: var(--muted); }
:is(.t-cad, .t-cad-dlg) .cad-hint { color: var(--muted); font-size: 12px; line-height: 1.45; margin: 0 0 10px; }
:is(.t-cad, .t-cad-dlg) .cad-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
:is(.t-cad, .t-cad-dlg) .cad-sw { width: 24px; height: 24px; border-radius: 7px; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); cursor: pointer; padding: 0; position: relative; }
:is(.t-cad, .t-cad-dlg) .cad-sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--accent); }
:is(.t-cad, .t-cad-dlg) .cad-sw.auto { background: linear-gradient(135deg, #fff 50%, #111 50%); }
:is(.t-cad, .t-cad-dlg) .cad-sw.bylayer { background: var(--surface-2); display: grid; place-items: center; font-size: 10px; font-weight: 700; width: auto; padding: 0 7px; }
.t-cad .cad-pop { position: absolute; z-index: 30; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 12px; padding: 10px; box-shadow: var(--shadow-lg); min-width: 190px; max-width: 280px; }
.t-cad .cad-pop .cad-menu-item { display: flex; align-items: center; gap: 9px; width: 100%; height: 34px; padding: 0 10px; border: 0; background: transparent; border-radius: 8px; cursor: pointer; text-align: left; }
.t-cad .cad-pop .cad-menu-item:hover { background: var(--surface-3); }
.t-cad .cad-pop .cad-menu-item .icon { width: 16px; height: 16px; color: var(--muted); }
.t-cad .cad-pop .cad-menu-item kbd { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--muted); }
.t-cad .cad-pop.menu { padding: 4px; min-width: 210px; }

.t-cad .cad-layers { display: grid; gap: 3px; }
.t-cad .cad-layer { display: grid; grid-template-columns: 26px 26px 22px minmax(0, 1fr) 26px; align-items: center; gap: 3px; padding: 3px 4px; border-radius: 9px; border: 1px solid transparent; }
.t-cad .cad-layer:hover { background: var(--surface-2); }
.t-cad .cad-layer.cur { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 28%, transparent); }
.t-cad .cad-layer .cad-btn { width: 26px; height: 26px; min-width: 26px; padding: 0; }
.t-cad .cad-layer .cad-btn .icon { width: 15px; height: 15px; }
.t-cad .cad-layer .cad-btn.dim { color: var(--muted); opacity: .65; }
.t-cad .cad-layer .nm { text-align: left; border: 0; background: transparent; height: 28px; padding: 0 6px; border-radius: 6px; cursor: pointer; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.t-cad .cad-layer.off .nm { color: var(--muted); font-weight: 500; text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--muted) 50%, transparent); }
.t-cad .cad-layer .chip { width: 18px; height: 18px; border-radius: 6px; border: 1px solid var(--border-strong); cursor: pointer; padding: 0; }
.t-cad .cad-layer-sub { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 2px 4px 6px 4px; }
.t-cad .cad-layer-sub .cad-sel { height: 28px; font-size: 12px; }
.t-cad .cad-add { display: flex; gap: 6px; margin-top: 10px; }
.t-cad .cad-verts { max-height: 190px; overflow: auto; display: grid; gap: 4px; padding-right: 2px; }
.t-cad .cad-verts .cad-grid2 { grid-template-columns: 22px 1fr 1fr; align-items: center; }
.t-cad .cad-verts small { color: var(--muted); text-align: right; }
:is(.t-cad, .t-cad-dlg) .cad-kv { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; color: var(--text-2); }
:is(.t-cad, .t-cad-dlg) .cad-kv b { color: var(--text); font-weight: 600; }

.t-cad .cad-cmd { border-top: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 92%, var(--bg-2)); padding: 6px 10px 6px; display: grid; gap: 4px; }
.t-cad .cad-log { font-family: var(--mono); font-size: 12px; line-height: 1.5; height: 3.2em; overflow-y: auto; color: var(--text-2); scrollbar-width: thin; overscroll-behavior: contain; }
.t-cad .cad-log.big { height: 14em; }
.t-cad .cad-log div { white-space: pre-wrap; word-break: break-word; }
.t-cad .cad-log .prompt { color: var(--accent); }
.t-cad .cad-log .in { color: var(--text); font-weight: 600; }
.t-cad .cad-log .cmd { color: var(--text); font-weight: 700; }
.t-cad .cad-log .muted { color: var(--muted); }
.t-cad .cad-log .err { color: var(--danger); }
.t-cad .cad-log .warn { color: var(--warning); }
.t-cad .cad-log .result { color: var(--success); font-weight: 700; }
.t-cad .cad-cmdline { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: 10px; padding: 0 4px 0 10px; height: 36px; }
.t-cad .cad-cmdline:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.t-cad .cad-cmdline label { font-family: var(--mono); font-size: 12px; color: var(--accent); white-space: nowrap; max-width: 55%; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.t-cad .cad-cmdline input { flex: 1; min-width: 40px; border: 0; background: transparent; color: var(--text); font-family: var(--mono); font-size: 13px; height: 100%; outline: none; }
.t-cad .cad-cmdline .cad-btn { height: 28px; min-width: 28px; }
.t-cad .cad-keys { display: none; }

.t-cad .cad-status { display: flex; align-items: center; gap: 2px; padding: 4px 8px; border-top: 1px solid var(--border); background: var(--surface-2); overflow-x: auto; scrollbar-width: none; }
.t-cad .cad-status::-webkit-scrollbar { display: none; }
.t-cad .cad-coord { font-family: var(--mono); font-size: 12px; color: var(--text-2); min-width: 200px; flex: none; padding: 0 8px; white-space: nowrap; }
.t-cad .cad-tog { height: 26px; padding: 0 9px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--muted); font-size: 11.5px; font-weight: 700; letter-spacing: .03em; cursor: pointer; position: relative; flex: none; display: inline-flex; align-items: center; gap: 4px; }
.t-cad .cad-tog:hover { background: var(--surface-3); color: var(--text); }
.t-cad .cad-tog[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 28%, transparent); }
.t-cad .cad-tog .icon { width: 12px; height: 12px; }
.t-cad-credit { padding: 10px 4px 0; }

@media (max-width: 900px) { .t-cad .cad-main { grid-template-columns: auto minmax(0, 1fr); } .t-cad .cad-panel { position: absolute; z-index: 12; right: 0; top: 0; bottom: 0; width: min(330px, 92%); transform: translateX(105%); transition: transform .25s var(--ease); box-shadow: var(--shadow-lg); } .t-cad.panel-open .cad-panel { transform: none; } }
@media (min-width: 901px) { .t-cad .cad-panel-toggle, .t-cad .cad-panel-close { display: none !important; } }
.t-cad .cad-tabs { align-items: center; }
.t-cad .cad-panel-close { flex: none; margin: 0 0 3px 4px; }
@media (max-width: 640px) {
  .t-cad { height: calc(100dvh - 130px); min-height: 520px; border-radius: 12px; }
  .t-cad .cad-main { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
  .t-cad .cad-rail { grid-row: 2; flex-direction: row; width: auto; border-right: 0; border-top: 1px solid var(--border); overflow-x: auto; overflow-y: hidden; padding: 4px 6px; }
  .t-cad .cad-rail .cad-hr { width: 1px; height: auto; margin: 4px; align-self: stretch; }
  .t-cad .cad-rail .cad-btn { flex: none; }
  .t-cad .cad-panel { width: 100%; top: auto; height: 62%; border-left: 0; border-top: 1px solid var(--border); border-radius: 16px 16px 0 0; transform: translateY(105%); }
  .t-cad.panel-open .cad-panel { transform: none; }
  .t-cad .cad-name { width: 96px; }
  .t-cad .cad-saved span, .t-cad .cad-top .cad-sep { display: none; }
  .t-cad .cad-top { gap: 2px; padding: 6px; }
  .t-cad .cad-log { height: 3.1em; }
  .t-cad .cad-coord { min-width: 150px; }
  .t-cad .cad-hide-sm { display: none !important; }
  .t-cad .cad-cmdline label { max-width: 46%; font-size: 11px; }
}
@media (prefers-reduced-motion: reduce) { .t-cad .cad-panel, .t-cad [data-tip]::after { transition: none; } }
`
export function injectStyle() {
  if (document.getElementById('t-cad-style')) return
  const s = document.createElement('style')
  s.id = 't-cad-style'
  s.textContent = CSS
  document.head.append(s)
}
