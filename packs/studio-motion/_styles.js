// Motion Studio styles. Injected once; every rule is scoped under .ms-app (or a class owned by this tool) and uses the site's colour variables.
const CSS = `
.ms-app { --ms-r: 12px; display: grid; grid-template-columns: 52px minmax(0, 1fr) 316px; grid-template-rows: auto minmax(200px, 1fr) auto var(--tl-h, 300px) auto;
  grid-template-areas: "bar bar bar" "rail stage insp" "split split split" "tl tl tl" "foot foot foot";
  height: max(780px, calc(100dvh - 150px)); min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
  overflow: hidden; position: relative; color: var(--text); font-size: 13px; box-shadow: var(--shadow); }
.tool-body:fullscreen .ms-app { height: calc(100dvh - 20px); }
.ms-app *, .ms-app *::before, .ms-app *::after { box-sizing: border-box; }
.ms-app button { font-family: inherit; }
.ms-app[data-size="m"] { grid-template-columns: 48px minmax(0, 1fr) 270px; }

/* buttons + tooltips */
.ms-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; min-width: 34px; padding: 0 9px; border-radius: 9px; border: 1px solid transparent; background: transparent;
  color: var(--text-2); font-weight: 550; font-size: 13px; cursor: pointer; position: relative; flex: none; transition: background .15s, color .15s, transform .1s; }
.ms-btn:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.ms-btn:active:not(:disabled) { transform: scale(.94); }
.ms-btn:disabled { opacity: .38; cursor: default; }
.ms-btn:focus-visible, .ms-chip:focus-visible, .tl-ic:focus-visible, .tl-sw:focus-visible, .ms-sw:focus-visible, .ms-kn:focus-visible, .tl-twirl:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.ms-btn[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, transparent); }
.ms-btn.sm { height: 28px; min-width: 28px; padding: 0 6px; border-radius: 8px; }
.ms-btn .icon { width: 17px; height: 17px; }
.ms-btn.sm .icon { width: 15px; height: 15px; }
.ms-btn.primary { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); color: var(--accent-text); box-shadow: 0 8px 20px -10px var(--accent); padding: 0 14px; }
.ms-btn.primary:hover:not(:disabled) { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); color: var(--accent-text); filter: brightness(1.08); }
.ms-btn.play { background: var(--accent); color: var(--accent-text); border-radius: 50%; width: 32px; height: 32px; min-width: 32px; padding: 0; }
.ms-btn.play:hover:not(:disabled) { background: var(--accent); color: var(--accent-text); filter: brightness(1.1); }
[data-tip]:hover::after, [data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; top: calc(100% + 7px); left: 50%; transform: translateX(-50%); z-index: 60; white-space: nowrap;
  background: #14141c; color: #f6f6fb; font-size: 12px; font-weight: 500; padding: 5px 9px; border-radius: 7px; pointer-events: none; box-shadow: 0 6px 20px rgba(0, 0, 0, .35); }
.ms-rail [data-tip]:hover::after, .ms-rail [data-tip]:focus-visible::after { top: 50%; left: calc(100% + 9px); transform: translateY(-50%); }
.ms-transport [data-tip]:hover::after, .ms-zoombar [data-tip]:hover::after { top: auto; bottom: calc(100% + 7px); }
@media (hover: none) { [data-tip]::after { display: none !important; } }

/* toolbar */
.ms-bar { grid-area: bar; display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-bottom: 1px solid var(--border); background: var(--surface); flex-wrap: wrap; min-width: 0; }
.ms-group { display: flex; align-items: center; gap: 2px; }
.ms-sep { width: 1px; height: 22px; background: var(--border); margin: 0 4px; flex: none; }
.ms-grow { flex: 1; min-width: 4px; }
.ms-saved { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; padding: 0 6px; white-space: nowrap; }
.ms-saved .icon { width: 14px; height: 14px; color: var(--success); }
.ms-saved.bad .icon { color: var(--danger); }
.ms-app[data-size="m"] .ms-btn.txt:not(.primary) span, .ms-app[data-size="s"] .ms-btn.txt:not(.primary) span, .ms-app[data-size="m"] .ms-saved span, .ms-app[data-size="s"] .ms-saved span { display: none; }
.ms-app[data-size="s"] .ms-bar { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; }
.ms-app[data-size="s"] .ms-bar .ms-btn.primary { order: -1; position: sticky; left: 0; z-index: 2; }
.ms-app[data-size="s"] .ms-bar .ms-saved { display: none; }

/* tool rail */
.ms-rail { grid-area: rail; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 5px; border-right: 1px solid var(--border); background: var(--surface); min-height: 0; overflow: visible; }
.ms-app[data-size="s"] .ms-rail { flex-direction: row; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); padding: 4px 6px; gap: 2px; justify-content: flex-start; }
.ms-app[data-size="s"] .ms-rail .ms-btn { flex: 1 1 0; min-width: 30px; padding: 0; }

/* stage */
.ms-stagewrap { grid-area: stage; position: relative; min-width: 0; min-height: 0; background: var(--bg-2); }
.ms-stage { position: absolute; inset: 0; overflow: hidden; outline: none; touch-action: none; user-select: none; -webkit-user-select: none;
  background: radial-gradient(circle, var(--border-strong) 1px, transparent 1.2px) 0 0 / 22px 22px, var(--bg-2); }
.ms-stage.drop { box-shadow: inset 0 0 0 3px var(--accent); }
.ms-cv { position: absolute; box-shadow: 0 18px 60px -20px rgba(0, 0, 0, .45), 0 0 0 1px rgba(128, 128, 140, .3); background: #000; }
.ms-cv.transparent { background: var(--checker); }
.ms-ov { position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }
.ms-stage[data-cursor="move"] { cursor: move; } .ms-stage[data-cursor="resize"] { cursor: nwse-resize; } .ms-stage[data-cursor="rotate"] { cursor: alias; }
.ms-stage[data-cursor="grab"] { cursor: grab; } .ms-stage[data-cursor="crosshair"] { cursor: crosshair; }
.ms-zoombar { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; align-items: center; gap: 2px; padding: 3px; z-index: 2; border-radius: 12px;
  background: var(--glass); backdrop-filter: blur(12px); border: 1px solid var(--border); box-shadow: var(--shadow); max-width: calc(100% - 16px); }
.ms-zoombar .select { height: 28px; min-height: 0; padding: 0 22px 0 8px; font-size: 12px; border: 0; background-color: transparent; box-shadow: none; width: auto; background-position: right 4px center; }
.ms-zoom-label { border: 0; background: transparent; color: var(--text-2); font: 500 12px var(--mono); min-width: 46px; height: 28px; cursor: pointer; border-radius: 8px; }
.ms-zoom-label:hover { background: var(--surface-2); }

/* inspector */
.ms-insp { grid-area: insp; overflow-y: auto; overflow-x: hidden; border-left: 1px solid var(--border); background: var(--surface); min-height: 0; min-width: 0; }
.ms-sec { border-bottom: 1px solid var(--border); }
.ms-sec > summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; font-size: 11.5px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); user-select: none; }
.ms-sec > summary::-webkit-details-marker { display: none; }
.ms-sec > summary > span { display: inline-flex; align-items: center; gap: 4px; }
.ms-sec > summary .icon { width: 14px; height: 14px; transition: transform .15s; }
.ms-sec[open] > summary .icon { transform: rotate(90deg); }
.ms-sec > summary:hover { color: var(--text); }
.ms-sec-body { padding: 2px 12px 12px; min-width: 0; }
.ms-field { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 8px; align-items: center; margin: 6px 0; min-width: 0; }
.ms-field.wide { grid-template-columns: minmax(0, 1fr); }
.ms-fl { color: var(--text-2); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-fc { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ms-fc > .select, .ms-fc > .input { width: 100%; min-width: 0; }
.ms-app .input, .ms-app .select { height: 30px; min-height: 0; padding: 0 9px; font-size: 13px; border-radius: 8px; }
.ms-app .select { padding-right: 28px; background-position: right 8px center; }
.ms-app .textarea { min-height: 70px; font-size: 14px; padding: 8px 10px; border-radius: 8px; }
.ms-app .switch { min-height: 28px; font-size: 13px; gap: 8px; }
.ms-app .seg { border-radius: 9px; padding: 2px; }
.ms-app .seg button { min-height: 26px; padding: 0 9px; font-size: 12.5px; border-radius: 7px; }
.ms-color { width: 100%; height: 30px; padding: 2px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); cursor: pointer; }
.ms-numwrap { display: flex; align-items: center; flex: 1; min-width: 0; height: 28px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }
.ms-numwrap:hover { border-color: var(--border-strong); }
.ms-numwrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.ms-scrub { padding: 0 0 0 7px; color: var(--muted); font: 600 10px var(--mono); cursor: ew-resize; user-select: none; touch-action: none; }
.ms-num { width: 100%; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--text); font: 12.5px var(--mono); padding: 0 6px; outline: none; appearance: textfield; -moz-appearance: textfield; }
.ms-num::-webkit-inner-spin-button, .ms-num::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.ms-prop { display: grid; grid-template-columns: 24px minmax(40px, 58px) minmax(0, 1fr) auto; gap: 4px; align-items: center; margin: 5px 0; min-width: 0; }
.ms-pl { font-size: 12.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-pv { display: flex; gap: 4px; min-width: 0; align-items: center; }
.ms-nav { display: flex; align-items: center; }
.ms-sw, .ms-kn, .tl-sw { width: 24px; height: 24px; display: inline-grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; padding: 0; }
.ms-kn { width: 20px; }
.ms-sw:hover, .ms-kn:hover:not(:disabled), .tl-sw:hover { background: var(--surface-2); color: var(--text); }
.ms-kn:disabled { opacity: .3; cursor: default; }
.ms-sw .icon, .tl-sw .icon { width: 15px; height: 15px; }
.ms-kn .icon { width: 13px; height: 13px; }
.ms-sw.on, .tl-sw.on { color: var(--accent); background: var(--accent-soft); }
.ms-kn.dia.on { color: var(--accent); } .ms-kn.dia.on .icon { fill: currentColor; }
.ms-kn.link[aria-pressed="true"] { color: var(--accent); }
.ms-note { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 4px 0 8px; }
.ms-note.warn { color: var(--warning); }
.ms-acts { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.ms-card { border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px 6px; margin: 8px 0; background: var(--surface-2); }
.ms-card-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.ms-card-h strong { font-size: 12.5px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ms-pg { margin: 8px 0; } .ms-pg > span { display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
.ms-pg > div { display: flex; flex-wrap: wrap; gap: 4px; }
.ms-chip { border: 1px solid var(--border); background: var(--surface); color: var(--text-2); border-radius: 999px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-weight: 500; transition: border-color .15s, color .15s, background .15s; }
.ms-chip:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.ms-help { padding: 12px; font-size: 12.5px; color: var(--text-2); line-height: 1.55; } .ms-help ol { margin: 6px 0 0; padding-left: 18px; } .ms-help li { margin: 4px 0; }
.ms-bz { display: grid; place-items: center; margin: 6px 0; }
.bz { width: 100%; max-width: 190px; height: auto; touch-action: none; }
.bz-box { fill: var(--surface); stroke: var(--border-strong); } .bz-diag { stroke: var(--border); stroke-dasharray: 3 3; }
.bz-curve { stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; } .bz-line { stroke: var(--muted); stroke-width: 1; }
.bz-pt { fill: var(--accent-2); stroke: #fff; stroke-width: 2; cursor: grab; } .bz-pt:focus-visible { outline: none; stroke: var(--accent); }
.bz-hold { fill: var(--muted); font-size: 9px; }

/* splitter + tabs + footer */
.ms-split { grid-area: split; height: 8px; cursor: row-resize; background: var(--bg-2); border-top: 1px solid var(--border); position: relative; touch-action: none; }
.ms-split::after { content: ""; position: absolute; left: 50%; top: 2px; width: 44px; height: 3px; border-radius: 3px; background: var(--border-strong); transform: translateX(-50%); }
.ms-split:hover::after { background: var(--accent); }
.ms-tabs { grid-area: tabs; display: none; border-top: 1px solid var(--border); background: var(--surface); }
.ms-tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 40px; border: 0; background: transparent; color: var(--muted); font-weight: 600; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; }
.ms-tab[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
.ms-tab .icon { width: 16px; height: 16px; }
.ms-foot { grid-area: foot; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 7px 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); background: var(--surface); }

/* small screens: stack everything, switch between timeline and inspector */
.ms-app[data-size="s"] { height: auto; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto auto auto auto auto; grid-template-areas: "bar" "rail" "stage" "tabs" "panel" "foot"; }
.ms-app[data-size="s"] .ms-stagewrap { height: clamp(240px, 38dvh, 380px); }
.ms-app[data-size="s"] .ms-split { display: none; }
.ms-app[data-size="s"] .ms-tabs { display: flex; }
.ms-app[data-size="s"] .ms-tl, .ms-app[data-size="s"] .ms-insp { grid-area: panel; height: 360px; border-left: 0; }
.ms-app[data-size="s"][data-tab="timeline"] .ms-insp, .ms-app[data-size="s"][data-tab="inspector"] .ms-tl { display: none; }
.ms-app[data-size="s"] .ms-field { grid-template-columns: 74px minmax(0, 1fr); }
@media (pointer: coarse) { .ms-app input, .ms-app select, .ms-app textarea, .ms-num { font-size: 16px !important; } .ms-btn { min-width: 40px; height: 40px; } .ms-btn.sm { height: 36px; min-width: 36px; } }

/* transport */
.ms-tl { grid-area: tl; display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--surface); }
.ms-transport { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-bottom: 1px solid var(--border); flex: none; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.ms-tc { display: flex; flex-direction: column; line-height: 1.15; margin-left: 8px; font-family: var(--mono); white-space: nowrap; }
.ms-tc-main { font-size: 15px; font-weight: 600; color: var(--text); } .ms-tc-frame { font-size: 11px; color: var(--muted); }
.ms-app .ms-zoomr { width: 110px; max-width: 110px; accent-color: var(--accent); flex: none; padding: 0; }
.ms-app[data-size="s"] .ms-zoomr { display: none; }

/* timeline */
.tl { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.tl-scroll { flex: 1; min-height: 0; overflow: auto; position: relative; overscroll-behavior: contain; }
.tl-grid { position: relative; min-height: 100%; --head: 240px; --pps: 100px; }
.tl-row { display: flex; height: 30px; border-bottom: 1px solid var(--border); }
.tl-row.prop, .tl-row.grp { height: 26px; }
.tl-head { position: sticky; left: 0; z-index: 3; flex: none; width: var(--head); display: flex; align-items: center; gap: 3px; padding-right: 6px; background: var(--surface); border-right: 1px solid var(--border); min-width: 0; font-size: 12.5px; cursor: default; }
.tl-row.layer > .tl-head { cursor: pointer; }
.tl-track, .tl-ruler-area { margin-left: var(--pad, 10px); }
.tl-track { position: relative; flex: none; height: 100%; background-image: linear-gradient(to right, var(--border) 1px, transparent 1px); background-size: var(--pps) 100%; }
.tl-row.sel > .tl-head, .tl-row.sel > .tl-track { background-color: color-mix(in srgb, var(--accent) 9%, var(--surface)); }
.tl-row.prop > .tl-track, .tl-row.grp > .tl-track { background-color: color-mix(in srgb, var(--surface-2) 60%, var(--surface)); }
.tl-row.prop > .tl-head, .tl-row.grp > .tl-head { background: color-mix(in srgb, var(--surface-2) 60%, var(--surface)); }
.tl-row.sel.prop > .tl-head, .tl-row.sel.prop > .tl-track { background-color: color-mix(in srgb, var(--accent) 6%, var(--surface-2)); }
.tl-row.locked .tl-name { opacity: .6; }
.tl-ruler { position: sticky; top: 0; z-index: 5; height: 28px; background: var(--surface); border-bottom: 1px solid var(--border-strong); }
.tl-corner { align-items: center; padding-left: 12px; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; font-weight: 650; z-index: 6; }
.tl-ruler-area { position: relative; flex: none; height: 100%; cursor: ew-resize; touch-action: none; }
.tick { position: absolute; bottom: 0; height: 5px; width: 0; border-left: 1px solid var(--border-strong); pointer-events: none; }
.tick.major { height: 11px; } .tick.frame { height: 3px; opacity: .55; }
.tick.major span { position: absolute; bottom: 11px; left: 4px; font: 10px var(--mono); color: var(--muted); white-space: nowrap; }
.tl-ph { position: absolute; top: 28px; bottom: 0; width: 0; z-index: 2; pointer-events: none; }
.tl-ph::before { content: ""; position: absolute; left: -1px; top: 0; bottom: 0; width: 2px; background: var(--accent-2); }
.tl-ph-head { position: absolute; top: 0; bottom: 0; width: 0; z-index: 3; pointer-events: none; }
.tl-ph-head::before { content: ""; position: absolute; left: -1px; top: 0; bottom: 0; width: 2px; background: var(--accent-2); }
.tl-ph-head::after { content: ""; position: absolute; left: -6px; top: 0; width: 12px; height: 12px; background: var(--accent-2); border-radius: 2px 2px 6px 6px; clip-path: polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%); }
.tl-ic, .tl-twirl { width: 22px; height: 22px; display: inline-grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--muted); cursor: pointer; padding: 0; flex: none; }
.tl-ic:hover, .tl-twirl:hover { background: var(--surface-2); color: var(--text); }
.tl-ic.on { color: var(--text-2); } .tl-ic:not(.on) { opacity: .6; }
.tl-ic .icon, .tl-twirl .icon, .tl-type .icon { width: 14px; height: 14px; }
.tl-twirl .icon { transition: transform .15s; } .tl-twirl.open .icon { transform: rotate(90deg); }
.tl-type { color: var(--c, var(--accent)); display: inline-grid; place-items: center; flex: none; }
.tl-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.tl-rename { flex: 1; min-width: 0; height: 22px; font: inherit; border: 1px solid var(--accent); border-radius: 5px; background: var(--surface); color: var(--text); padding: 0 5px; }
.tl-pname, .tl-gname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); font-size: 12px; }
.tl-gname { color: var(--muted); font-weight: 650; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
.tl-val { font: 11px var(--mono); color: var(--muted); white-space: nowrap; max-width: 90px; overflow: hidden; text-overflow: ellipsis; }
.tl-bar { position: absolute; top: 5px; height: 20px; border-radius: 6px; cursor: grab; background: color-mix(in srgb, var(--c, var(--accent)) 38%, var(--surface)); border: 1px solid color-mix(in srgb, var(--c, var(--accent)) 70%, transparent); }
.tl-bar.text { --c: #a855f7; } .tl-bar.shape { --c: #6366f1; } .tl-bar.image { --c: #14b8a6; } .tl-bar.solid { --c: #f59e0b; } .tl-bar.group { --c: #64748b; }
.tl-bar.off { opacity: .4; }
.tl-row.layer.sel .tl-bar { box-shadow: 0 0 0 2px color-mix(in srgb, var(--c, var(--accent)) 55%, transparent); }
.tl-bar .h { position: absolute; top: 0; bottom: 0; width: 8px; cursor: ew-resize; } .tl-bar .h-l { left: 0; } .tl-bar .h-r { right: 0; }
.tl-bar .h::after { content: ""; position: absolute; top: 5px; bottom: 5px; width: 2px; border-radius: 2px; background: color-mix(in srgb, var(--c, var(--accent)) 90%, #fff); opacity: 0; }
.tl-bar:hover .h::after { opacity: .9; } .tl-bar .h-l::after { left: 2px; } .tl-bar .h-r::after { right: 2px; }
.kf { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; transform: rotate(45deg); background: var(--surface); border: 2px solid var(--accent); border-radius: 2px; cursor: grab; z-index: 1; }
.kf:hover { transform: rotate(45deg) scale(1.25); }
.kf.sel { background: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.kf.hold { border-radius: 0; border-color: var(--warning); } .kf.hold.sel { background: var(--warning); }
.kf.sum { width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; background: var(--text-2); border-color: var(--text-2); opacity: .6; pointer-events: none; z-index: 2; top: 75%; }
.tl-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 36px 16px; color: var(--muted); text-align: center; position: sticky; left: 0; width: min(100%, 520px); }
.tl-empty .icon { width: 26px; height: 26px; opacity: .6; }

/* dialogs */
.ms-tpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.ms-tpl { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 8px; border-radius: 12px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: 550 13px var(--font); cursor: pointer; transition: border-color .15s, background .15s, transform .15s; }
.ms-tpl:hover { border-color: var(--accent); transform: translateY(-1px); }
.ms-tpl[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.ms-tpl .icon { width: 22px; height: 22px; }
.ms-result-media { max-width: 100%; max-height: 300px; border-radius: 10px; border: 1px solid var(--border); background: var(--checker); display: block; margin-top: 10px; }
@media (prefers-reduced-motion: reduce) { .ms-app * { transition: none !important; } }
`

export function injectStyles() {
  if (document.getElementById('ms-style')) return
  const s = document.createElement('style')
  s.id = 'ms-style'
  s.textContent = CSS
  document.head.append(s)
}
