// Styles for Photo Develop, scoped under .pd. Colors come from the site's CSS variables so light and dark both work.
const CSS = `
.pd { --pd-stage: #17171c; --pd-panel: var(--surface); --pd-hist: #121216; --pd-h: clamp(580px, calc(100dvh - var(--header-h) - 150px), 1180px);
  position: relative; display: flex; flex-direction: column; height: var(--pd-h); min-height: 0; background: var(--pd-panel); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; font-size: 13px; box-shadow: var(--shadow); }
:fullscreen > .pd { height: calc(100dvh - 20px); }
.pd *, .pd *::before, .pd *::after { box-sizing: border-box; }
.pd [hidden] { display: none !important; }
.pd button, .pd input, .pd select { font: inherit; color: inherit; }
.pd svg.icon { width: 17px; height: 17px; flex: none; }
.pd :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) { .pd * { transition: none !important; animation: none !important; } }

/* tooltips */
@media (hover: hover) {
  .pd [data-tip] { position: relative; }
  .pd [data-tip]::after { content: attr(data-tip); position: absolute; z-index: 60; top: calc(100% + 7px); left: 50%; transform: translate(-50%, 4px); opacity: 0; pointer-events: none; white-space: nowrap;
    padding: 5px 9px; border-radius: 8px; background: #17171c; color: #f6f6fb; font-size: 12px; font-weight: 500; box-shadow: 0 8px 24px -8px rgba(0, 0, 0, .5); transition: opacity .15s, transform .15s; }
  .pd [data-tip]:hover::after, .pd [data-tip]:focus-visible::after { opacity: 1; transform: translate(-50%, 0); transition-delay: .35s; }
  .pd .pd-rail [data-tip]::after { top: 50%; left: calc(100% + 8px); transform: translate(4px, -50%); }
  .pd .pd-rail [data-tip]:hover::after, .pd .pd-rail [data-tip]:focus-visible::after { transform: translate(0, -50%); }
  .pd .pd-toolbar .end [data-tip]::after, .pd .pd-inspector [data-tip]::after { left: auto; right: 0; transform: translate(0, 4px); }
  .pd .pd-toolbar .end [data-tip]:hover::after, .pd .pd-inspector [data-tip]:hover::after { transform: none; }
}

/* toolbar */
.pd-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); background: var(--pd-panel); flex: none; min-height: 52px; }
.pd-toolbar .grow { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
.pd-toolbar .end { display: flex; align-items: center; gap: 4px; flex: none; }
.pd-brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: -.01em; padding: 0 6px 0 2px; }
.pd-brand .logo { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
.pd-brand .logo svg { width: 16px; height: 16px; }
.pd-views { display: inline-flex; padding: 3px; gap: 2px; border-radius: 11px; background: var(--surface-2); border: 1px solid var(--border); }
.pd-views button { border: 0; background: transparent; height: 28px; padding: 0 12px; border-radius: 8px; cursor: pointer; font-weight: 600; color: var(--muted); display: inline-flex; align-items: center; gap: 6px; }
.pd-views button:hover { color: var(--text); }
.pd-views button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
:root[data-theme="dark"] .pd-views button[aria-pressed="true"] { background: var(--surface-3); }
.pd-views button:disabled { opacity: .45; cursor: default; }
.pd-title { margin: 0 6px; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-weight: 500; }
.pd-ib { min-width: 34px; height: 34px; padding: 0; border: 0; border-radius: 10px; background: transparent; color: var(--text-2); display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; transition: background .15s, color .15s; flex: none; }
.pd-ib.with-text { padding: 0 11px; font-weight: 600; }
.pd-ib:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.pd-ib[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent); }
.pd-ib:disabled { opacity: .4; cursor: default; }
.pd-ib.primary { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); color: var(--accent-text); padding: 0 14px; }
.pd-ib.primary:hover:not(:disabled) { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--accent-2))); color: var(--accent-text); filter: brightness(1.08); }
.pd-sep { width: 1px; height: 22px; background: var(--border); margin: 0 4px; flex: none; }
.pd-busybar { position: absolute; left: 0; right: 0; top: 51px; height: 3px; z-index: 30; background: transparent; }
.pd-busybar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width .25s; }
.pd-busytext { position: absolute; top: 58px; right: 12px; z-index: 30; padding: 6px 11px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); font-size: 12px; color: var(--text-2); }

/* popover menu */
.pd-menu { position: absolute; z-index: 80; min-width: 230px; padding: 6px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow-lg); animation: pd-pop .14s var(--ease); }
@keyframes pd-pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
.pd-menu button { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 0; border-radius: 9px; background: transparent; cursor: pointer; text-align: left; }
.pd-menu button:hover, .pd-menu button:focus-visible { background: var(--surface-2); }
.pd-menu button kbd { margin-left: auto; color: var(--muted); font: 11px var(--mono); }
.pd-menu hr { border: 0; border-top: 1px solid var(--border); margin: 5px 4px; }
.pd-menu .danger { color: var(--danger); }

/* views */
.pd-main { flex: 1; min-height: 0; position: relative; display: flex; }
.pd-view { flex: 1; min-width: 0; min-height: 0; display: none; }
.pd-view.on { display: flex; }

/* library */
.pd-library { flex-direction: column; }
.pd-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 10px 12px; border-bottom: 1px solid var(--border); flex: none; }
.pd-search { height: 32px; min-width: 150px; max-width: 220px; flex: 1; padding: 0 11px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); outline: none; }
.pd-search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--ring); }
.pd-filter-item { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); }
.pd-filter-item .select { height: 32px; width: auto; padding-right: 30px; font-size: 13px; border-radius: 10px; }
.pd-filter-item.size .icon { width: 13px; height: 13px; }
.pd-filter-item.size .icon.big { width: 18px; height: 18px; }
.pd-filter-item .pd-range { width: 90px; }
.pd .seg button { min-height: 28px; padding: 0 10px; font-size: 12.5px; }
.pd-check { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; user-select: none; }
.pd-check input { accent-color: var(--accent); width: 15px; height: 15px; }
.pd-checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px 12px; }
.pd-count { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.pd-selbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px 12px; border-bottom: 1px solid var(--border); background: var(--accent-soft); flex: none; }
.pd-selbar .label { font-weight: 600; margin-right: 6px; color: var(--accent); }
.pd-libbody { position: relative; flex: 1; min-height: 0; display: flex; }

.pd-grid { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: auto; outline: none; background: var(--bg-2); overscroll-behavior: contain; }
.pd-grid-inner { position: relative; }
.pd-cell { position: absolute; left: 0; top: 0; padding: 5px; cursor: pointer; will-change: transform; -webkit-tap-highlight-color: transparent; }
.pd-thumb { position: relative; width: 100%; height: 100%; border-radius: 10px; overflow: hidden; background: #111; outline: 2px solid transparent; outline-offset: -2px; transition: outline-color .12s, transform .15s var(--ease); }
.pd-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; user-select: none; -webkit-user-drag: none; }
.pd-cell:hover .pd-thumb { transform: scale(1.015); }
.pd-cell.selected .pd-thumb { outline-color: color-mix(in srgb, var(--accent) 70%, transparent); }
.pd-cell.active .pd-thumb { outline-color: var(--accent); outline-width: 3px; box-shadow: 0 0 0 3px var(--ring); }
.pd-cell.rejected .pd-thumb img { opacity: .38; filter: grayscale(.8); }
.pd-cell-foot { position: absolute; left: 5px; right: 5px; bottom: 5px; padding: 18px 8px 6px; border-radius: 0 0 10px 10px; display: flex; align-items: center; justify-content: space-between; gap: 6px; color: #fff;
  background: linear-gradient(transparent, rgba(0, 0, 0, .72)); opacity: 0; transition: opacity .15s; pointer-events: none; }
.pd-cell-name { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }
.pd-cell:hover .pd-cell-foot, .pd-cell.active .pd-cell-foot, .pd-cell:focus-within .pd-cell-foot { opacity: 1; pointer-events: auto; }
.pd-grid.strip .pd-cell-foot { padding: 10px 4px 3px; }
.pd-grid.strip .pd-cell-name { display: none; }
.pd-flag { position: absolute; top: 11px; left: 11px; width: 22px; height: 22px; border-radius: 50%; display: none; place-items: center; color: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, .4); }
.pd-flag svg { width: 12px; height: 12px; }
.pd-flag.pick { background: #16a34a; }
.pd-flag.reject { background: #dc2626; }
.pd-cell.picked .pd-flag.pick, .pd-cell.rejected .pd-flag.reject { display: grid; }
.pd-edited { position: absolute; top: 11px; right: 11px; width: 22px; height: 22px; border-radius: 50%; display: none; place-items: center; background: rgba(0, 0, 0, .55); color: #fff; backdrop-filter: blur(4px); }
.pd-edited svg { width: 12px; height: 12px; }
.pd-cell.edited .pd-edited { display: grid; }
.pd-grid.strip { overflow-x: auto; overflow-y: hidden; height: 100%; background: var(--pd-panel); }
.pd-stars { display: inline-flex; gap: 1px; }
.pd-stars button { border: 0; background: transparent; padding: 1px; cursor: pointer; color: rgba(255, 255, 255, .45); line-height: 0; border-radius: 4px; }
.pd-stars button svg { width: 14px; height: 14px; }
.pd-stars.md button svg { width: 18px; height: 18px; }
.pd-stars button.on { color: #fbbf24; }
.pd-stars button.on svg { fill: currentColor; }
.pd-stars button:hover { color: #fcd34d; }
.pd-filter-item .pd-stars button, .pd-bar .pd-stars button { color: var(--border-strong); }
.pd-filter-item .pd-stars button.on, .pd-bar .pd-stars button.on { color: #f59e0b; }

.pd-empty { flex: 1; display: grid; place-items: center; padding: 24px; overflow: auto; background: var(--bg-2); }
.pd-empty-card { width: min(640px, 100%); display: grid; gap: 18px; text-align: center; }
.pd-empty-card h3 { font-size: 22px; letter-spacing: -.02em; }
.pd-empty-card p { color: var(--muted); }
.pd-empty-card .dropzone { background: var(--surface); }
.pd-samples { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; align-items: center; }
.pd-points { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; text-align: left; }
.pd-points div { padding: 12px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); font-size: 12.5px; color: var(--muted); }
.pd-points b { display: block; color: var(--text); margin-bottom: 2px; font-size: 13px; }

/* the shared drop zone is a slim strip above the grid once photos exist */
.pd-library > .dropzone { margin: 8px 12px 0; flex: none; min-height: 0; padding: 7px 14px; border-radius: 12px; }
.pd-library > .dropzone .dz-icon { width: 30px; height: 30px; border-radius: 10px; }
.pd-library > .dropzone .dz-icon .icon { width: 16px; height: 16px; }
.pd-library > .dropzone strong { font-size: 13.5px; }
.pd-library > .dropzone .dz-hint { display: none; }
/* develop layout */
.pd-develop { display: none; grid-template-columns: 46px 236px minmax(0, 1fr) 316px; grid-template-areas: "rail side center insp"; }
.pd-develop.on { display: grid; }
.pd-rail { grid-area: rail; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; border-right: 1px solid var(--border); background: var(--pd-panel); }
.pd-rail .pd-ib { width: 36px; height: 36px; }
.pd-rail .pd-sep { width: 22px; height: 1px; margin: 4px 0; }
.pd-side { grid-area: side; overflow: auto; border-right: 1px solid var(--border); min-width: 0; }
.pd-inspector-wrap { grid-area: insp; overflow: auto; border-left: 1px solid var(--border); min-width: 0; }
.pd-center { grid-area: center; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.pd-tabs { grid-area: tabs; display: none; }
.pd-develop[data-left="0"] { grid-template-columns: 46px 0 minmax(0, 1fr) 316px; }
.pd-develop[data-left="0"] .pd-side { display: none; }
@media (max-width: 1180px) { .pd-develop { grid-template-columns: 46px 0 minmax(0, 1fr) 300px; } .pd-develop .pd-side { display: none; } .pd-develop[data-left="1"] { grid-template-columns: 46px 220px minmax(0, 1fr) 300px; } .pd-develop[data-left="1"] .pd-side { display: block; } }

.pd-stage { position: relative; flex: 1; min-height: 120px; }
.pd-viewport { position: absolute; inset: 0; background: var(--pd-stage); overflow: hidden; touch-action: none; user-select: none; outline: none; }
.pd-viewport.zoomed { cursor: grab; }
.pd-viewport.grab { cursor: grab; }
.pd-viewport.panning { cursor: grabbing; }
.pd-pane { position: absolute; box-shadow: 0 10px 40px rgba(0, 0, 0, .5); }
.pd-viewport.cropping .pd-pane { box-shadow: none; background: repeating-conic-gradient(#26262e 0 25%, #1f1f26 0 50%) 50% / 14px 14px; }
.pd-gl, .pd-before { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.pd-split { position: absolute; width: 3px; margin-left: -1.5px; background: #fff; box-shadow: 0 0 0 1px rgba(0, 0, 0, .35); cursor: ew-resize; z-index: 5; }
.pd-split::before { content: ""; position: absolute; inset: 0 -12px; }
.pd-split i { position: absolute; top: 50%; left: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px; border-radius: 50%; background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, .5); }
.pd-split i::before, .pd-split i::after { content: ""; position: absolute; top: 50%; width: 0; height: 0; margin-top: -4px; border: 4px solid transparent; }
.pd-split i::before { left: 4px; border-right-color: #333; }
.pd-split i::after { right: 4px; border-left-color: #333; }
.pd-tag { position: absolute; z-index: 4; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; background: rgba(0, 0, 0, .6); color: #fff; backdrop-filter: blur(4px); pointer-events: none; }
.pd-hud { position: absolute; left: 10px; bottom: 8px; z-index: 4; color: rgba(255, 255, 255, .7); font: 11.5px var(--mono); pointer-events: none; text-shadow: 0 1px 2px rgba(0, 0, 0, .7); }
.pd-loading { position: absolute; inset: 0; z-index: 6; display: flex; align-items: center; justify-content: center; gap: 10px; color: #fff; background: rgba(10, 10, 14, .38); backdrop-filter: blur(2px); }
.pd-note { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 7; display: flex; gap: 10px; align-items: center; padding: 14px 18px; border-radius: 14px; max-width: 80%; background: var(--surface); border: 1px solid var(--border); }
.pd-crop { position: absolute; z-index: 8; border: 1.5px solid #fff; box-shadow: 0 0 0 9999px rgba(8, 8, 12, .62); cursor: move; touch-action: none; outline: none; }
.pd-crop-grid { position: absolute; inset: 0; pointer-events: none; opacity: .55;
  background: linear-gradient(90deg, transparent calc(33.33% - .5px), #fff calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), #fff calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)),
    linear-gradient(0deg, transparent calc(33.33% - .5px), #fff calc(33.33% - .5px) calc(33.33% + .5px), transparent calc(33.33% + .5px) calc(66.66% - .5px), #fff calc(66.66% - .5px) calc(66.66% + .5px), transparent calc(66.66% + .5px)); }
.pd-crop.dragging .pd-crop-grid { opacity: .8; }
.pd-handle { position: absolute; width: 14px; height: 14px; background: #fff; border-radius: 4px; box-shadow: 0 1px 4px rgba(0, 0, 0, .6); margin: -7px 0 0 -7px; }
.pd-handle::after { content: ""; position: absolute; inset: -9px; }
.pd-handle.h-nw { left: 0; top: 0; cursor: nwse-resize; } .pd-handle.h-n { left: 50%; top: 0; cursor: ns-resize; } .pd-handle.h-ne { left: 100%; top: 0; cursor: nesw-resize; }
.pd-handle.h-e { left: 100%; top: 50%; cursor: ew-resize; } .pd-handle.h-se { left: 100%; top: 100%; cursor: nwse-resize; } .pd-handle.h-s { left: 50%; top: 100%; cursor: ns-resize; }
.pd-handle.h-sw { left: 0; top: 100%; cursor: nesw-resize; } .pd-handle.h-w { left: 0; top: 50%; cursor: ew-resize; }
.pd-cropbar { position: absolute; z-index: 9; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border-strong); box-shadow: var(--shadow-lg); }

.pd-bar { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-top: 1px solid var(--border); flex: none; min-height: 40px; }
.pd-bar .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.pd-bar .pd-flagbtn.pick[aria-pressed="true"] { color: #16a34a; background: color-mix(in srgb, #16a34a 14%, transparent); }
.pd-bar .pd-flagbtn.reject[aria-pressed="true"] { color: #dc2626; background: color-mix(in srgb, #dc2626 14%, transparent); }
.pd-zoomlabel { font: 12px var(--mono); color: var(--muted); min-width: 42px; text-align: right; }
.pd .pd-film.pd-grid { height: 92px; flex: none; border-top: 1px solid var(--border); background: var(--pd-panel); }

/* inspector */
.pd-inspector { display: flex; flex-direction: column; }
.pd-histbox { position: relative; margin: 10px 12px 6px; padding: 8px; background: var(--pd-hist); border-radius: 12px; border: 1px solid rgba(255, 255, 255, .06); }
.pd-hist { width: 100%; height: 84px; display: block; }
.pd-hist-tools { position: absolute; left: 12px; right: 8px; top: 6px; display: flex; justify-content: space-between; align-items: center; pointer-events: none; }
.pd-hist-tools > * { pointer-events: auto; }
.pd-hist-title { font-size: 11px; color: rgba(255, 255, 255, .5); text-transform: uppercase; letter-spacing: .06em; }
.pd-hist-tools .pd-ib { width: 26px; min-width: 26px; height: 26px; color: rgba(255, 255, 255, .6); }
.pd-hist-tools .pd-ib svg { width: 14px; height: 14px; }
.pd-hist-tools .pd-ib:hover:not(:disabled) { background: rgba(255, 255, 255, .1); color: #fff; }
.pd-hist-tools .pd-ib[aria-pressed="true"] { background: rgba(255, 255, 255, .18); color: #fff; }
.pd-sec { border-bottom: 1px solid var(--border); }
.pd-sec-bar { display: flex; align-items: center; }
.pd-sec-head { flex: 1; display: flex; align-items: center; gap: 8px; padding: 11px 6px 11px 12px; border: 0; background: transparent; cursor: pointer; text-align: left; font-weight: 650; min-width: 0; }
.pd-sec-head:hover { background: var(--surface-2); }
.pd-chev { width: 14px !important; height: 14px !important; transition: transform .2s var(--ease); color: var(--muted); }
.pd-sec[data-open="1"] .pd-chev { transform: rotate(90deg); }
.pd-sec-ic { color: var(--muted); width: 16px !important; height: 16px !important; }
.pd-sec.changed .pd-sec-ic { color: var(--accent); }
.pd-sec-reset { border: 0; background: transparent; color: var(--muted); width: 30px; height: 30px; border-radius: 9px; cursor: pointer; margin-right: 6px; display: grid; place-items: center; }
.pd-sec-reset:hover { background: var(--surface-2); color: var(--accent); }
.pd-sec-reset svg { width: 14px; height: 14px; }
.pd-sec-body { display: none; padding: 2px 14px 16px; }
.pd-sec[data-open="1"] .pd-sec-body { display: block; }
.pd-stack { display: flex; flex-direction: column; gap: 9px; }
.pd-sub { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); font-weight: 650; }
.pd-hint { font-size: 12px; color: var(--muted); line-height: 1.45; }
.pd-row { display: flex; align-items: center; gap: 6px; }
.pd-row.wrap { flex-wrap: wrap; }
.pd-mini { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); cursor: pointer; font-size: 11.5px; font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--text-2); }
.pd-mini:hover { border-color: var(--accent); color: var(--accent); }
.pd-mini svg { width: 13px; height: 13px; }
.pd-seg { display: flex; padding: 3px; gap: 2px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
.pd-seg button { flex: 1; border: 0; background: transparent; height: 28px; padding: 0 6px; border-radius: 7px; cursor: pointer; font-weight: 600; font-size: 12px; color: var(--muted); white-space: nowrap; }
.pd-seg button:hover { color: var(--text); }
.pd-seg button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
:root[data-theme="dark"] .pd-seg button[aria-pressed="true"] { background: var(--surface-3); }
.pd-select { height: 32px; flex: 1; min-width: 0; border-radius: 9px; border: 1px solid var(--border); background: var(--surface); padding: 0 8px; }

.pd-sl { display: block; }
.pd-sl-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.pd-sl-label { color: var(--text-2); cursor: default; user-select: none; }
.pd-sl.changed .pd-sl-label { color: var(--text); font-weight: 600; }
.pd-sl-val { display: inline-flex; align-items: center; }
.pd-sl-val i { font-style: normal; color: var(--muted); font-size: 11px; }
.pd-num { width: 58px; height: 22px; padding: 0 4px; border: 1px solid transparent; border-radius: 6px; background: transparent; text-align: right; font: 12px var(--mono); color: var(--muted); -moz-appearance: textfield; appearance: textfield; }
.pd-num::-webkit-inner-spin-button, .pd-num::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.pd-num:hover { border-color: var(--border); }
.pd-num:focus { border-color: var(--accent); outline: none; color: var(--text); background: var(--surface); }
.pd-sl.changed .pd-num { color: var(--accent); }
.pd-range { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; margin: 0; background: transparent; cursor: pointer; touch-action: pan-y; }
.pd-range::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: var(--track, linear-gradient(90deg, var(--border-strong) var(--a, 0%), var(--accent) var(--a, 0%) var(--b, 0%), var(--border-strong) var(--b, 0%))); }
.pd-range::-moz-range-track { height: 4px; border-radius: 4px; background: var(--track, linear-gradient(90deg, var(--border-strong) var(--a, 0%), var(--accent) var(--a, 0%) var(--b, 0%), var(--border-strong) var(--b, 0%))); }
.pd-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; margin-top: -5px; border-radius: 50%; background: #fff; border: 1.5px solid var(--border-strong); box-shadow: 0 1px 3px rgba(0, 0, 0, .35); transition: transform .12s var(--spring), border-color .12s; }
.pd-range::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 1.5px solid var(--border-strong); box-shadow: 0 1px 3px rgba(0, 0, 0, .35); }
.pd-sl.changed .pd-range::-webkit-slider-thumb { border-color: var(--accent); }
.pd-range:hover::-webkit-slider-thumb { transform: scale(1.15); }
.pd-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px var(--ring); }
.pd-range:disabled { opacity: .4; cursor: default; }

.pd-curve-wrap { padding: 2px; }
.pd-curve { display: block; width: 100%; max-width: 292px; margin: 0 auto; aspect-ratio: 1; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; touch-action: none; cursor: crosshair; }
.pd-curve-bg line { stroke: var(--border-strong); stroke-width: 1; opacity: .5; }
.pd-curve-bg .diag { stroke-dasharray: 3 4; opacity: .7; }
.pd-curve-hist { fill: var(--muted); opacity: .22; }
.pd-curve-line { stroke-width: 2.2; stroke-linejoin: round; }
.pd-curve-pt { fill: var(--surface); stroke-width: 2.2; cursor: grab; }
.pd-curve-pt:focus-visible { outline: none; fill: var(--accent); }
.pd-wheel-wrap { display: grid; place-items: center; padding: 4px 0; }
.pd-wheel { position: relative; width: 152px; height: 152px; border-radius: 50%; touch-action: none; cursor: crosshair; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .15), var(--shadow-sm);
  background: radial-gradient(circle closest-side, rgba(128, 128, 128, 1), rgba(128, 128, 128, 0)), conic-gradient(from 0deg, hsl(0 85% 55%), hsl(60 85% 55%), hsl(120 85% 50%), hsl(180 85% 50%), hsl(240 85% 60%), hsl(300 85% 55%), hsl(360 85% 55%)); }
.pd-puck { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2.5px solid #fff; background: hsl(var(--ph, 0) var(--ps, 25%) 50%); box-shadow: 0 1px 5px rgba(0, 0, 0, .6); pointer-events: none; left: 50%; top: 50%; }
.pd-puck.active { box-shadow: 0 0 0 1.5px var(--accent), 0 1px 5px rgba(0, 0, 0, .6); }

/* side panel */
.pd-side .pd-search[type="search"] { max-width: none; width: 100%; flex: none; }
.pd-presets { display: flex; flex-direction: column; gap: 4px; }
.pd-preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 6px; }
.pd-preset-wrap { position: relative; min-width: 0; }
.pd-preset { width: 100%; display: flex; flex-direction: column; gap: 4px; padding: 0; border: 0; background: transparent; cursor: pointer; text-align: left; min-width: 0; }
.pd-preset-cv { width: 100%; height: auto; aspect-ratio: 168 / 114; border-radius: 9px; background: #17171c; display: block; transition: transform .15s var(--ease), box-shadow .15s; box-shadow: 0 0 0 1px var(--border); }
.pd-preset:hover .pd-preset-cv, .pd-preset:focus-visible .pd-preset-cv { transform: translateY(-2px); box-shadow: 0 0 0 2px var(--accent), var(--shadow); }
.pd-preset span { font-size: 11.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-preset-del { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, .6); color: #fff; display: grid; place-items: center; cursor: pointer; opacity: 0; }
.pd-preset-wrap:hover .pd-preset-del, .pd-preset-del:focus-visible { opacity: 1; }
.pd-preset-del svg { width: 12px; height: 12px; }
.pd-history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 260px; overflow: auto; }
.pd-history button { width: 100%; text-align: left; border: 0; background: transparent; padding: 6px 9px; border-radius: 8px; cursor: pointer; font-size: 12.5px; color: var(--text-2); }
.pd-history button:hover { background: var(--surface-2); }
.pd-history button[aria-current="step"] { background: var(--accent-soft); color: var(--accent); font-weight: 650; }
.pd-history button.future { opacity: .5; }
.pd-info { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; font-size: 12.5px; }
.pd-info dt { color: var(--muted); } .pd-info dd { margin: 0; overflow-wrap: anywhere; }
.pd-side .pd-sec-body, .pd-inspector .pd-sec-body { padding-left: 12px; padding-right: 12px; }

/* export dialog */
.pd-export .seg { width: 100%; } .pd-export .seg button { flex: 1; }

/* phones and small tablets: the page scrolls, the photo stays pinned while the panels move underneath */
@media (max-width: 900px) {
  .pd { --stage-h: clamp(210px, 38vh, 400px); --pin: calc(var(--header-h) + 2px); height: auto; overflow: clip; }
  .pd-main { display: block; flex: none; }
  .pd-view.on { display: block; }
  .pd-library.on { display: flex; flex-direction: column; }
  .pd-libbody { flex: none; height: clamp(320px, 64vh, 640px); }
  .pd-develop.on { display: flex; flex-direction: column; }
  .pd-center { display: contents; }
  .pd-rail { order: 0; } .pd-stage { order: 1; } .pd-bar { order: 2; } .pd-film { order: 3; } .pd-tabs { order: 4; } .pd-side, .pd-inspector-wrap { order: 5; }
  .pd-rail { position: sticky; top: var(--pin); z-index: 9; height: 44px; flex: none; flex-direction: row; justify-content: center; padding: 3px 6px; border-right: 0; border-bottom: 1px solid var(--border); overflow-x: auto; }
  .pd-rail .pd-sep { width: 1px; height: 22px; margin: 0 4px; }
  .pd-rail .pd-ib { flex: none; }
  .pd-stage { position: sticky; top: calc(var(--pin) + 44px); z-index: 8; height: var(--stage-h); min-height: 0; flex: none; }
  .pd-bar { position: sticky; top: calc(var(--pin) + 44px + var(--stage-h)); z-index: 8; background: var(--pd-panel); }
  .pd-bar .name, .pd-zoomlabel, .pd-bar .pd-ib[data-tip^="Zoom in"], .pd-bar .pd-ib[data-tip^="Zoom out"] { display: none; }
  .pd .pd-film.pd-grid { height: 76px; }
  .pd-tabs { display: flex; border-top: 1px solid var(--border); background: var(--pd-panel); position: relative; z-index: 6; }
  .pd-tabs button { flex: 1; height: 42px; border: 0; background: transparent; font-weight: 650; color: var(--muted); display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; border-bottom: 2px solid transparent; }
  .pd-tabs button[aria-selected="true"] { color: var(--accent); border-bottom-color: var(--accent); }
  .pd-develop .pd-side, .pd-develop .pd-inspector-wrap { display: none !important; border: 0; border-top: 1px solid var(--border); overflow: visible; }
  .pd-develop[data-tab="presets"] .pd-side { display: block !important; }
  .pd-develop[data-tab="edit"] .pd-inspector-wrap { display: block !important; }
  .pd-viewport.cropping ~ .pd-cropbar { bottom: 8px; }
  .pd-toolbar { padding: 6px 8px; gap: 4px; flex-wrap: wrap; }
  .pd-brand span, .pd-title, .pd-ib.with-text span.lbl { display: none; }
  .pd-views button { padding: 0 9px; }
  .pd-filters { gap: 8px; padding: 8px; }
  .pd-filter-item.size, .pd-filter-item.sort-item, .pd-filter-item.rate-item, .pd-library > .dropzone, .pd-selbar .pd-hide-s { display: none !important; }
  .pd-search { max-width: none; }
  .pd-bar { padding: 4px 8px; }
  .pd-hide-s { display: none !important; }
  .pd-empty { padding: 14px; }
  .pd-empty .dropzone { min-height: 130px; }
}
@media (max-width: 480px) {
  .pd-ib { min-width: 32px; height: 32px; }
  .pd-views button span { display: none; }
  .pd-search { min-width: 0; }
}
`
export function injectCss() {
  if (document.getElementById('pd-css')) return
  const s = document.createElement('style')
  s.id = 'pd-css'
  s.textContent = CSS
  document.head.append(s)
}
