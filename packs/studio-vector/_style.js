// Styles for Vector Studio, injected once. Everything is scoped under .t-vs (plus .vs-tip for the floating tooltip).
const CSS = `
.t-vs { --panel: 300px; position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow);
  height: max(560px, calc(100dvh - var(--header-h) - 150px)); font-size: 13px; color: var(--text); }
.tool-body.app:fullscreen .t-vs { height: calc(100dvh - 20px); }
.t-vs *:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.t-vs .icon { width: 18px; height: 18px; flex: none; }

/* top bar and options bar */
.t-vs .vs-bar { display: flex; align-items: center; gap: 3px; padding: 6px 8px; border-bottom: 1px solid var(--border); background: var(--glass); backdrop-filter: blur(10px); overflow-x: auto; scrollbar-width: none; flex: none; }
.t-vs .vs-bar::-webkit-scrollbar, .t-vs .vs-opts::-webkit-scrollbar, .t-vs .vs-rail::-webkit-scrollbar { display: none; }
.t-vs .vs-tb { color: var(--text); display: inline-flex; align-items: center; gap: 6px; height: 32px; min-width: 32px; padding: 0 9px; border-radius: 9px; border: 1px solid transparent; background: transparent; cursor: pointer; font-weight: 550; font-size: 13px; white-space: nowrap; flex: none; transition: background .15s, border-color .15s, color .15s, transform .12s; }
.t-vs .vs-tb:hover:not(:disabled) { background: var(--surface-2); border-color: var(--border); }
.t-vs .vs-tb:active:not(:disabled) { transform: scale(.96); }
.t-vs .vs-tb:disabled { opacity: .38; cursor: default; }
.t-vs .vs-tb.on { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, transparent); }
.t-vs .vs-tb.primary { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); color: var(--accent-text); box-shadow: 0 8px 18px -10px var(--accent); }
.t-vs .vs-tb.primary:hover:not(:disabled) { filter: brightness(1.06); border-color: transparent; background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); }
.t-vs .vs-sepv { width: 1px; height: 20px; background: var(--border); margin: 0 5px; flex: none; }
.t-vs .vs-grow { flex: 1; min-width: 6px; }
.t-vs .vs-zoom { min-width: 54px; justify-content: center; font-variant-numeric: tabular-nums; }
.t-vs .vs-only-m { display: none; }
.t-vs .vs-opts { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 4px 12px; border-bottom: 1px solid var(--border); background: var(--surface); color: var(--muted); font-size: 12.5px; overflow-x: auto; scrollbar-width: none; flex: none; white-space: nowrap; }
.t-vs .vs-opts strong { color: var(--text); font-weight: 600; }
.t-vs .vs-opts label { display: inline-flex; align-items: center; gap: 6px; }
.t-vs .vs-opts .vs-num { width: 64px; }
.t-vs .vs-opts select { height: 28px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); font: inherit; padding: 0 6px; max-width: 150px; }

/* body */
.t-vs .vs-body { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: 84px minmax(0, 1fr) var(--panel); }
.t-vs .vs-rail { display: grid; grid-template-columns: repeat(2, 38px); justify-content: center; align-content: start; gap: 4px; padding: 10px 0; border-right: 1px solid var(--border); overflow-y: auto; scrollbar-width: none; background: var(--surface); }
.t-vs .vs-tool { position: relative; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 11px; border: 1px solid transparent; background: transparent; cursor: pointer; color: var(--text-2); transition: background .15s, color .15s, transform .12s var(--spring); }
.t-vs .vs-tool:hover { background: var(--surface-2); color: var(--text); }
.t-vs .vs-tool:active { transform: scale(.92); }
.t-vs .vs-tool.on { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); box-shadow: 0 6px 14px -8px var(--accent); }
.t-vs .vs-rule { grid-column: 1 / -1; height: 1px; background: var(--border); margin: 4px 6px; }
.t-vs .vs-fs { grid-column: 1 / -1; justify-self: center; position: relative; width: 40px; height: 40px; margin-top: 10px; }
.t-vs .vs-fs .sw { position: absolute; width: 23px; height: 23px; border-radius: 7px; cursor: pointer; overflow: hidden; }
.t-vs .vs-fs .sw input { position: absolute; inset: -6px; width: 40px; height: 40px; opacity: 0; cursor: pointer; }
.t-vs .vs-fs .fill { left: 1px; top: 1px; z-index: 2; border: 2px solid var(--surface); box-shadow: 0 0 0 1px var(--border-strong); }
.t-vs .vs-fs .stroke { right: 1px; bottom: 1px; z-index: 1; border: 5px solid var(--text); background: var(--surface); box-shadow: 0 0 0 1px var(--border-strong); }
.t-vs .vs-fsb { grid-column: 1 / -1; justify-self: center; display: flex; gap: 2px; }
.t-vs .vs-fsb button { width: 19px; height: 19px; display: grid; place-items: center; border: 0; background: transparent; border-radius: 5px; cursor: pointer; color: var(--muted); }
.t-vs .vs-fsb button:hover { background: var(--surface-2); color: var(--text); }
.t-vs .vs-fsb .icon { width: 13px; height: 13px; }

.t-vs .vs-main { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.t-vs .vs-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; touch-action: none; outline: none; user-select: none; -webkit-user-select: none;
  background-color: color-mix(in srgb, var(--surface-3) 55%, var(--bg-2));
  background-image: radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 0); background-size: 22px 22px; }
.t-vs .vs-stage.drop { box-shadow: inset 0 0 0 3px var(--accent); }
.t-vs .vs-svg, .t-vs .vs-ov { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.t-vs .vs-ov { pointer-events: none; }
.t-vs .vs-svg { overflow: hidden; }
.t-vs .vs-shadow { fill: #fff; filter: drop-shadow(0 10px 26px rgba(10, 10, 30, .3)); }
.t-vs .vs-art [data-lock] { pointer-events: none; }
.t-vs .vs-art text { user-select: none; }
.t-vs .ov-box { fill: none; stroke: var(--accent); stroke-width: 1.2; }
.t-vs .ov-sub { fill: none; stroke: var(--accent); stroke-width: 1; stroke-dasharray: 3 3; opacity: .75; }
.t-vs .ov-h { fill: #fff; stroke: var(--accent); stroke-width: 1.5; }
.t-vs .ov-outline { fill: none; stroke: var(--accent); stroke-width: 1.2; }
.t-vs .ov-anchor { fill: #fff; stroke: var(--accent); stroke-width: 1.5; }
.t-vs .ov-anchor.sel { fill: var(--accent); }
.t-vs .ov-hline { stroke: var(--accent); stroke-width: 1; }
.t-vs .ov-hdot { fill: #fff; stroke: var(--accent); stroke-width: 1.5; }
.t-vs .ov-hover { fill: none; stroke: var(--accent); stroke-width: 1.2; opacity: .5; }
.t-vs .ov-ctx { fill: none; stroke: var(--accent); stroke-width: 1; stroke-dasharray: 6 4; opacity: .8; }
.t-vs .ov-marquee { fill: color-mix(in srgb, var(--accent) 13%, transparent); stroke: var(--accent); stroke-width: 1; stroke-dasharray: 4 3; }
.t-vs .ov-gline { stroke: #fff; stroke-width: 2.4; paint-order: stroke; filter: drop-shadow(0 0 1px var(--accent)); }
.t-vs .ov-gdot { fill: var(--accent); stroke: #fff; stroke-width: 2; }
.t-vs .ov-guide { stroke: #ec4899; stroke-width: 1; }
.t-vs .ov-grid { stroke: color-mix(in srgb, var(--text) 16%, transparent); stroke-width: 1; fill: none; }
.t-vs .ov-rubber { fill: none; stroke: var(--accent); stroke-width: 1.4; stroke-dasharray: 5 3; }
.t-vs .ov-ring { fill: none; stroke: var(--accent); stroke-width: 1.6; }
.t-vs .vs-textedit { position: absolute; left: 0; top: 0; transform-origin: 0 0; margin: 0; padding: 0; border: 0; outline: 1px dashed var(--accent); outline-offset: 2px; background: transparent; resize: none; overflow: hidden; white-space: pre; min-width: 20px; z-index: 5; font-synthesis: none; }
.t-vs .vs-empty { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; pointer-events: none; padding: 16px; }
.t-vs .vs-empty-card { pointer-events: none; width: 100%; max-width: 340px; text-align: center; padding: 22px 24px; border-radius: 22px; background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(14px); border: 1px solid var(--border); box-shadow: var(--shadow); display: grid; gap: 10px; justify-items: center; }
.t-vs .vs-empty-card button { pointer-events: auto; }
.t-vs .vs-empty-card h3 { font-size: 16px; letter-spacing: -.01em; }
.t-vs .vs-empty-card p { color: var(--muted); font-size: 13px; line-height: 1.5; }
.t-vs .vs-empty-card > .icon { width: 30px; height: 30px; color: var(--accent); }
.t-vs .vs-status { display: flex; align-items: center; gap: 14px; height: 28px; padding: 0 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); background: var(--surface); flex: none; white-space: nowrap; overflow: hidden; }
.t-vs .vs-status .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.t-vs .vs-status .num { font-variant-numeric: tabular-nums; }
.t-vs .vs-saved { display: inline-flex; align-items: center; gap: 5px; }
.t-vs .vs-saved i { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.t-vs .vs-saved.busy i { background: var(--warning); }

/* side panel */
.t-vs .vs-side { min-width: 0; min-height: 0; overflow-y: auto; border-left: 1px solid var(--border); background: var(--surface); padding: 8px 12px 16px; overscroll-behavior: contain; }
.t-vs .vs-tabs > .tabs { margin: 0 -2px; }
.t-vs .vs-tabs > div:last-child { padding-top: 8px !important; }
.t-vs .vs-summary { font-size: 12.5px; color: var(--text-2); padding: 2px 0 8px; font-weight: 550; }
.t-vs .vs-sec { border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 4px; }
.t-vs .vs-sec > summary { cursor: pointer; font-weight: 650; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: 9px 0 8px; list-style: none; display: flex; align-items: center; justify-content: space-between; user-select: none; }
.t-vs .vs-sec > summary::-webkit-details-marker { display: none; }
.t-vs .vs-sec > summary::after { content: ""; width: 7px; height: 7px; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(45deg); transition: transform .2s; margin-right: 3px; }
.t-vs .vs-sec[open] > summary::after { transform: rotate(-135deg); }
.t-vs .vs-sec-body { display: flex; flex-direction: column; gap: 8px; }
.t-vs .vs-label { font-size: 12px; color: var(--muted); font-weight: 550; margin-top: 2px; }
.t-vs .vs-hint { font-size: 12px; color: var(--muted); line-height: 1.45; margin: 0; }
.t-vs .vs-row2 { display: flex; align-items: center; gap: 8px; }
.t-vs .vs-row2 > * { flex: 1; min-width: 0; }
.t-vs .vs-row2 > .vs-ib, .t-vs .vs-row2 > .btn { flex: none; }
.t-vs .vs-mini { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); min-width: 0; }
.t-vs .vs-mini > span { flex: none; }
.t-vs .vs-mini > em { font-style: normal; font-size: 11px; opacity: .8; }
.t-vs .vs-num, .t-vs .vs-hex, .t-vs .vs-textarea, .t-vs .vs-rename, .t-vs .vs-side select { width: 100%; min-width: 0; height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); font: inherit; font-size: 13px; }
.t-vs .vs-side select { cursor: pointer; padding-right: 22px; }
.t-vs .vs-num:focus, .t-vs .vs-hex:focus, .t-vs .vs-textarea:focus, .t-vs .vs-rename:focus, .t-vs .vs-side select:focus { border-color: var(--accent); outline: 2px solid var(--ring); outline-offset: 0; }
.t-vs .vs-num:disabled { opacity: .45; }
.t-vs .vs-textarea { height: auto; padding: 6px 8px; resize: vertical; min-height: 54px; }
.t-vs .vs-colorrow { display: flex; gap: 8px; align-items: center; }
.t-vs .vs-color { width: 34px; height: 30px; padding: 0; border: 1px solid var(--border-strong); border-radius: 8px; background: transparent; cursor: pointer; flex: none; }
.t-vs .vs-color::-webkit-color-swatch-wrapper { padding: 2px; }
.t-vs .vs-color::-webkit-color-swatch { border: 0; border-radius: 5px; }
.t-vs .vs-ibs { display: flex; gap: 2px; align-items: center; }
.t-vs .vs-ibs.wrap { flex-wrap: wrap; }
.t-vs .vs-ib { width: 30px; height: 30px; flex: none; display: inline-grid; place-items: center; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-2); cursor: pointer; transition: background .15s, color .15s; }
.t-vs .vs-ib:hover:not(:disabled) { background: var(--surface-2); border-color: var(--border); color: var(--text); }
.t-vs .vs-ib.on { background: var(--accent-soft); color: var(--accent); }
.t-vs .vs-ib:disabled { opacity: .4; }
.t-vs .vs-ib .icon { width: 17px; height: 17px; }
.t-vs .vs-wide { color: var(--text); display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 34px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); cursor: pointer; font-weight: 550; font-size: 13px; }
.t-vs .vs-wide:hover { border-color: var(--border-strong); background: var(--surface-3); }
.t-vs .vs-wide.primary { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); color: var(--accent-text); border-color: transparent; }
.t-vs .vs-seg, .t-vs .seg { display: flex; padding: 2px; gap: 2px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
.t-vs .vs-seg button, .t-vs .seg button { flex: 1; min-width: 0; height: 26px; padding: 0 6px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 12px; font-weight: 550; color: var(--text-2); white-space: nowrap; }
.t-vs .vs-seg button[aria-pressed="true"], .t-vs .seg button[aria-pressed="true"] { background: var(--surface); color: var(--accent); box-shadow: var(--shadow-sm), 0 0 0 1px var(--border); }
.t-vs .switch { font-size: 13px; }
.t-vs .vs-paintbox { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.t-vs .vs-paintbox > summary { display: flex; align-items: center; gap: 8px; padding: 7px 10px; cursor: pointer; list-style: none; font-weight: 600; font-size: 12.5px; user-select: none; }
.t-vs .vs-paintbox > summary::-webkit-details-marker { display: none; }
.t-vs .vs-paintbox > summary::after { content: ""; width: 7px; height: 7px; margin-left: auto; border-right: 1.6px solid var(--muted); border-bottom: 1.6px solid var(--muted); transform: rotate(45deg); transition: transform .2s; }
.t-vs .vs-paintbox[open] > summary::after { transform: rotate(-135deg); }
.t-vs .vs-paintbox > .vs-paint { padding: 2px 10px 10px; }
.t-vs .vs-ptitle { min-width: 44px; }
.t-vs .vs-chip { width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--border-strong); flex: none; }
.t-vs .vs-what { color: var(--muted); font-weight: 500; font-size: 12px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-vs .vs-paint { display: flex; flex-direction: column; gap: 8px; }
.t-vs .vs-paint-body { display: flex; flex-direction: column; gap: 8px; }
.t-vs .vs-gwrap { padding: 0 7px 14px; }
.t-vs .vs-gbar { position: relative; height: 22px; border-radius: 7px; border: 1px solid var(--border-strong); cursor: copy; }
.t-vs .vs-gstop { position: absolute; top: 100%; margin: -1px 0 0 -7px; width: 14px; height: 14px; border-radius: 4px; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .4), 0 2px 5px rgba(0, 0, 0, .25); cursor: grab; padding: 0; touch-action: none; }
.t-vs .vs-gstop.on { box-shadow: 0 0 0 2px var(--accent), 0 2px 6px rgba(0, 0, 0, .3); z-index: 1; }
.t-vs .vs-swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.t-vs .vs-sw { aspect-ratio: 1; min-height: 20px; border-radius: 6px; border: 1px solid var(--border-strong); cursor: pointer; padding: 0; transition: transform .12s var(--spring); }
.t-vs .vs-sw:hover { transform: scale(1.15); }
.t-vs .vs-bools { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.t-vs .vs-bool { color: var(--text); display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); cursor: pointer; font-size: 12.5px; font-weight: 550; }
.t-vs .vs-bool:hover { border-color: var(--accent); color: var(--accent); }

.t-vs .vs-hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; max-height: 220px; overflow-y: auto; }
.t-vs .vs-hist li { padding: 5px 8px; border-radius: 7px; font-size: 12.5px; cursor: pointer; color: var(--text-2); }
.t-vs .vs-hist li:hover { background: var(--surface-2); }
.t-vs .vs-hist li.redo { color: var(--muted); font-style: italic; }
.t-vs .vs-hist li.now { background: var(--accent-soft); color: var(--accent); font-weight: 600; cursor: default; }

/* layers */
.t-vs .vs-layers-wrap { display: flex; flex-direction: column; gap: 8px; }
.t-vs .vs-layers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
.t-vs .vs-layer { display: flex; align-items: center; gap: 3px; min-height: 32px; padding: 2px 4px 2px calc(4px + var(--d, 0) * 16px); border-radius: 9px; cursor: default; font-size: 13px; user-select: none; }
.t-vs .vs-layer:hover { background: var(--surface-2); }
.t-vs .vs-layer.sel { background: var(--accent-soft); }
.t-vs .vs-layer.off .vs-lname, .t-vs .vs-layer.off .vs-licon { opacity: .45; }
.t-vs .vs-layer.ctx .vs-lname { color: var(--accent); }
.t-vs .vs-layer.drop-above { box-shadow: 0 -2px 0 var(--accent); }
.t-vs .vs-layer.drop-below { box-shadow: 0 2px 0 var(--accent); }
.t-vs .vs-layer.drop-into { outline: 2px solid var(--accent); }
.t-vs .vs-mask { color: var(--muted); font-style: normal; font-size: 11px; }
.t-vs .vs-lname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.t-vs .vs-licon { display: grid; place-items: center; color: var(--muted); }
.t-vs .vs-licon .icon { width: 15px; height: 15px; }
.t-vs .vs-lgap { width: 24px; flex: none; }
.t-vs .vs-lbtn { width: 24px; height: 24px; flex: none; display: grid; place-items: center; border: 0; background: transparent; border-radius: 6px; color: var(--muted); cursor: pointer; }
.t-vs .vs-lbtn:hover { background: var(--surface-3); color: var(--text); }
.t-vs .vs-lbtn .icon { width: 15px; height: 15px; }
.t-vs .vs-layer.locked .vs-lbtn:last-child { color: var(--accent); }
.t-vs .vs-lempty { color: var(--muted); font-size: 12.5px; padding: 14px 4px; line-height: 1.5; }
.t-vs .vs-rename { height: 26px; flex: 1; }

.t-vs .vs-credit { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 7px 14px; border-top: 1px solid var(--border); background: var(--surface-2); color: var(--muted); font-size: 12px; flex: none; }
.t-vs .vs-credit a { color: var(--accent); font-weight: 550; text-decoration: none; }
.t-vs .vs-credit a:hover { text-decoration: underline; }

.vs-tip { position: fixed; z-index: 9999; pointer-events: none; padding: 5px 9px; border-radius: 8px; font: 550 12px/1.2 var(--font, system-ui); background: #14141c; color: #fff; box-shadow: 0 8px 24px rgba(0, 0, 0, .3); opacity: 0; transform: translateY(2px); transition: opacity .12s, transform .12s; white-space: nowrap; }
.vs-tip.on { opacity: 1; transform: none; }
.vs-tip kbd { margin-left: 8px; padding: 1px 5px; border-radius: 5px; background: rgba(255, 255, 255, .16); font: 600 11px var(--mono, monospace); }
.vs-keys { display: grid; grid-template-columns: 1fr auto; gap: 6px 18px; font-size: 13.5px; }
.vs-keys kbd { padding: 2px 7px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--border); font: 600 12px var(--mono, monospace); }
.vs-keys h4 { grid-column: 1 / -1; margin: 8px 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.vs-dlg { display: grid; gap: 12px; min-width: min(380px, 78vw); }
.vs-dlg .vs-row2 { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.vs-dlg .vs-row2 > * { flex: 1 1 120px; }

@media (max-width: 860px) {
  .t-vs { height: max(520px, calc(100dvh - var(--header-h) - 120px)); border-radius: var(--radius); }
  .t-vs .vs-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .t-vs .vs-opts.plain { display: none; }
  .t-vs .vs-rail { display: flex; justify-content: flex-start; flex-direction: row; border-right: 0; border-bottom: 1px solid var(--border); overflow-x: auto; overflow-y: hidden; padding: 4px 6px; gap: 2px; align-items: center; }
  .t-vs .vs-tool { flex: none; }
  .t-vs .vs-rail.more-r { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 30px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 30px), transparent); }
  .t-vs .vs-rail.more-l { -webkit-mask-image: linear-gradient(270deg, #000 calc(100% - 30px), transparent); mask-image: linear-gradient(270deg, #000 calc(100% - 30px), transparent); }
  .t-vs .vs-rail.more-l.more-r { -webkit-mask-image: linear-gradient(90deg, transparent, #000 30px, #000 calc(100% - 30px), transparent); mask-image: linear-gradient(90deg, transparent, #000 30px, #000 calc(100% - 30px), transparent); }
  .t-vs .vs-rule { width: 1px; height: 24px; margin: 0 4px; flex: none; }
  .t-vs .vs-fs { margin: 0 4px 0 auto; flex: none; }
  .t-vs .vs-fsb { flex: none; }
  .t-vs .vs-side { position: absolute; left: 0; right: 0; bottom: 0; z-index: 20; max-height: 62%; border-left: 0; border-top: 1px solid var(--border); border-radius: 18px 18px 0 0; box-shadow: 0 -20px 50px -20px rgba(0, 0, 0, .35); transform: translateY(104%); visibility: hidden; transition: transform .26s var(--ease), visibility .26s; }
  .t-vs .vs-side.open { transform: none; visibility: visible; }
  .t-vs .vs-only-m { display: inline-flex; }
  .t-vs .vs-hide-m { display: none; }
  .t-vs .vs-num, .t-vs .vs-hex, .t-vs .vs-textarea, .t-vs .vs-rename, .t-vs .vs-side select, .t-vs .vs-opts select { font-size: 16px; height: 36px; }
  .t-vs .vs-ib { width: 36px; height: 36px; }
  .t-vs .vs-tool { width: 42px; height: 42px; }
  .t-vs .vs-layer { min-height: 40px; }
  .t-vs .vs-lbtn { width: 32px; height: 32px; }
  .t-vs .vs-status .hide-m { display: none; }
  .t-vs .vs-credit { padding: 6px 10px; font-size: 11.5px; }
}
@media (prefers-reduced-motion: reduce) { .t-vs *, .vs-tip { transition: none !important; } }
`

export function ensureStyle() {
  if (document.getElementById('vs-style')) return
  const s = document.createElement('style')
  s.id = 'vs-style'
  s.textContent = CSS
  document.head.append(s)
}
